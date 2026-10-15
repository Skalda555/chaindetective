import {isAddress,isSystemWalletAddress,NETWORKS} from '../dist/data.js';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const text=(value,max,label)=>{if(value===undefined)return '';if(typeof value!=='string'||value.length>max)fail(`${label}: nejvýše ${max} znaků.`);return value.trim();};
const statuses=new Set(['candidate','reviewed','excluded']);
const networksValid=ids=>Array.isArray(ids)&&ids.length>0&&ids.every(id=>NETWORKS.some(n=>n.id===id));
function mergeTags(...groups){const tags=[],seen=new Set();for(const tag of groups.flat()){const key=tag.toLocaleLowerCase('en-US');if(seen.has(key))continue;seen.add(key);tags.push(tag);}return tags;}
function addresses(input){
 if(!Array.isArray(input)||!input.length||input.some(address=>typeof address!=='string'||!isAddress(address)))fail('Vyberte alespoň jednu platnou EVM adresu.');
 return [...new Set(input.map(address=>address.toLowerCase()))];
}
function importEntries(input){
 const raw=Array.isArray(input?.entries)?input.entries:Array.isArray(input?.addresses)?input.addresses.map(address=>({address})):null;
 if(!raw?.length||raw.length>200||raw.some(entry=>!entry||typeof entry!=='object'||typeof entry.address!=='string'||!isAddress(entry.address)))fail('Vložte 1 až 200 platných EVM adres. Celý seznam musí být platný.');
 const system=raw.find(entry=>isSystemWalletAddress(entry.address));if(system)fail('Neplatná systémová adresa (zero address) nelze importovat jako Smart wallet.');
 const unique=new Map();for(const entry of raw){const address=entry.address.toLowerCase();if(unique.has(address))continue;const name=Object.hasOwn(entry,'name')?text(entry.name,100,'Název'):undefined;unique.set(address,{address,...(name?{name}:{})});}
 return [...unique.values()];
}
function fields(input,retainedLegacy=[]){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Neplatný záznam.');
 const status=input.status??'candidate';if(!statuses.has(status))fail('Neplatný stav hodnocení.');
 if(!Array.isArray(input.chainIds)||!input.chainIds.length||input.chainIds.some(id=>!NETWORKS.some(n=>n.id===id)&&!retainedLegacy.includes(id)))fail('Vyberte alespoň jednu platnou podporovanou síť.');
 if(!Array.isArray(input.tags)||input.tags.length>12)fail('Použijte nejvýše 12 štítků.');
 const tags=mergeTags(input.tags.map(t=>text(t,40,'Štítek')).filter(Boolean));
 return {name:text(input.name,100,'Název'),tags,source:text(input.source,300,'Zdroj'),note:text(input.note,4000,'Poznámka'),status,chainIds:[...new Set(input.chainIds)].sort()};
}
export class SmartWalletStore{
 constructor(db){this.db=db;db.exec(`CREATE TABLE IF NOT EXISTS smart_wallets(address TEXT PRIMARY KEY,name TEXT NOT NULL,tags_json TEXT NOT NULL,source TEXT NOT NULL,note TEXT NOT NULL,status TEXT NOT NULL,chains_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);}
 decode(row){return row?{address:row.address,name:row.name,tags:JSON.parse(row.tags_json),source:row.source,note:row.note,status:row.status,chainIds:JSON.parse(row.chains_json),createdAt:row.created_at,updatedAt:row.updated_at}:null;}
 get(address){return this.decode(this.db.prepare('SELECT * FROM smart_wallets WHERE address=?').get(address.toLowerCase()));}
 list(){return this.db.prepare('SELECT * FROM smart_wallets ORDER BY updated_at DESC,address').all().map(row=>this.decode(row));}
 previewImport(input){
  const entries=importEntries(input),existing=this.db.prepare(`SELECT address FROM smart_wallets WHERE address IN (${entries.map(()=>'?').join(',')})`).all(...entries.map(entry=>entry.address));
  return {newCount:entries.length-existing.length,existingCount:existing.length};
 }
 deleteMany(input){
  const selected=addresses(input),deleted=[],missing=[],remove=this.db.prepare('DELETE FROM smart_wallets WHERE address=?');
  this.db.exec('BEGIN IMMEDIATE');try{
   for(const address of selected)(remove.run(address).changes?deleted:missing).push(address);
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
  return {deleted,missing};
 }
 bulkUpdate(input,changes){
  const selected=addresses(input);
  if(!changes||typeof changes!=='object'||Array.isArray(changes))fail('Vyberte alespoň jedno pole k hromadné úpravě.');
  const allowed=new Set(['tags','status','source','chainIds','note']),keys=Object.keys(changes);
  if(!keys.length||keys.some(key=>!allowed.has(key)))fail('Hromadná úprava obsahuje nepodporované pole.');
  let tagChange;
  if(Object.hasOwn(changes,'tags')){
   const change=changes.tags;if(!change||typeof change!=='object'||Array.isArray(change)||!['add','remove','replace'].includes(change.mode)||!Array.isArray(change.values)||change.values.length>12)fail('Nastavte platný režim a nejvýše 12 štítků.');
   tagChange={mode:change.mode,values:[...new Set(change.values.map(value=>text(value,40,'Štítek')).filter(Boolean))]};
  }
  if(Object.hasOwn(changes,'status')&&!statuses.has(changes.status))fail('Neplatný stav hodnocení.');
  const source=Object.hasOwn(changes,'source')?text(changes.source,300,'Zdroj'):undefined;
  const note=Object.hasOwn(changes,'note')?text(changes.note,4000,'Poznámka'):undefined;
  let chainIds;if(Object.hasOwn(changes,'chainIds')){if(!networksValid(changes.chainIds))fail('Vyberte alespoň jednu platnou síť.');chainIds=[...new Set(changes.chainIds)].sort();}
  const updated=[],missing=[],now=new Date().toISOString();
  const get=this.db.prepare('SELECT * FROM smart_wallets WHERE address=?'),write=this.db.prepare('UPDATE smart_wallets SET tags_json=?,source=?,note=?,status=?,chains_json=?,updated_at=? WHERE address=?');
  this.db.exec('BEGIN IMMEDIATE');try{
   for(const address of selected){
    const row=get.get(address);if(!row){missing.push(address);continue;}
    const wallet=this.decode(row);let tags=wallet.tags;
    if(tagChange){
     if(tagChange.mode==='replace')tags=tagChange.values;
     else if(tagChange.mode==='add')tags=[...new Set([...tags,...tagChange.values])];
     else tags=tags.filter(tag=>!tagChange.values.includes(tag));
     if(tags.length>12)fail('Hromadná úprava by vytvořila více než 12 štítků u jedné peněženky.');
    }
    write.run(JSON.stringify(tags),source??wallet.source,note??wallet.note,changes.status??wallet.status,JSON.stringify(chainIds??wallet.chainIds),now,address);updated.push(address);
   }
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
  return {updated,missing};
 }
 add(input){
  const f=fields(input),entries=importEntries(input);
  if(input.updateExisting!==undefined&&typeof input.updateExisting!=='boolean')fail('Neplatná volba pro existující adresy.');
  if(input.conflictMode!==undefined&&!['merge-tags','keep','update'].includes(input.conflictMode))fail('Neplatný režim existujících adres.');
  const conflictMode=input.conflictMode??(input.updateExisting===true?'update':'keep'),tagsMode=input.tagsMode??'add',networksMode=input.networksMode??'replace';
  if(!['add','replace'].includes(tagsMode))fail('Neplatný režim štítků.');
  if(!['add','replace'].includes(networksMode))fail('Neplatný režim sledovaných sítí.');
  const created=[],updated=[],unchanged=[],now=new Date().toISOString();
  const get=this.db.prepare('SELECT * FROM smart_wallets WHERE address=?');
  const insert=this.db.prepare('INSERT INTO smart_wallets VALUES(?,?,?,?,?,?,?,?,?)');
  const write=this.db.prepare('UPDATE smart_wallets SET name=?,tags_json=?,source=?,note=?,status=?,chains_json=?,updated_at=? WHERE address=?');
  this.db.exec('BEGIN IMMEDIATE');try{
   for(const entry of entries){
    const row=get.get(entry.address);
    if(!row){insert.run(entry.address,entry.name||f.name,JSON.stringify(f.tags),f.source,f.note,f.status,JSON.stringify(f.chainIds),now,now);created.push(entry.address);continue;}
    const wallet=this.decode(row);
    if(conflictMode==='keep'){unchanged.push(entry.address);continue;}
    if(conflictMode==='merge-tags'){
     const tags=mergeTags(wallet.tags,f.tags);
     if(tags.length>12)fail('Doplnění by vytvořilo více než 12 štítků u jedné peněženky.');
     if(JSON.stringify(tags)===JSON.stringify(wallet.tags)){unchanged.push(entry.address);continue;}
     this.db.prepare('UPDATE smart_wallets SET tags_json=?,updated_at=? WHERE address=?').run(JSON.stringify(tags),now,entry.address);updated.push(entry.address);continue;
    }
    const name=entry.name||f.name||wallet.name;
    const tags=tagsMode==='replace'?f.tags:mergeTags(wallet.tags,f.tags);
    if(tags.length>12)fail('Aktualizace by vytvořila více než 12 štítků u jedné peněženky.');
    const source=f.source||wallet.source,note=f.note||wallet.note,status=f.status;
    const chainIds=[...new Set(networksMode==='replace'?f.chainIds:[...wallet.chainIds,...f.chainIds])].sort();
    const changed=name!==wallet.name||JSON.stringify(tags)!==JSON.stringify(wallet.tags)||source!==wallet.source||note!==wallet.note||status!==wallet.status||JSON.stringify(chainIds)!==JSON.stringify(wallet.chainIds);
    if(!changed){unchanged.push(entry.address);continue;}
    write.run(name,JSON.stringify(tags),source,note,status,JSON.stringify(chainIds),now,entry.address);updated.push(entry.address);
   }
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
  return {created,updated,unchanged};
 }
 update(address,input){
  if(!isAddress(address))fail('Neplatná adresa.');const current=this.get(address);if(!current)fail('Peněženka nebyla nalezena.',404);
  const retainedLegacy=current.chainIds.filter(id=>!NETWORKS.some(n=>n.id===id));
  const f=fields(input,retainedLegacy);this.db.prepare('UPDATE smart_wallets SET name=?,tags_json=?,source=?,note=?,status=?,chains_json=?,updated_at=? WHERE address=?').run(f.name,JSON.stringify(f.tags),f.source,f.note,f.status,JSON.stringify(f.chainIds),new Date().toISOString(),address.toLowerCase());
  return this.get(address);
 }
}
