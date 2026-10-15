import {isAddress,NETWORKS} from '../dist/data.js';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const text=(value,max,label)=>{if(value===undefined)return '';if(typeof value!=='string'||value.length>max)fail(`${label}: nejvýše ${max} znaků.`);return value.trim();};
const statuses=new Set(['candidate','reviewed','excluded']);
function fields(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Neplatný záznam.');
 const status=input.status??'candidate';if(!statuses.has(status))fail('Neplatný stav hodnocení.');
 if(!Array.isArray(input.chainIds)||!input.chainIds.length||input.chainIds.some(id=>!NETWORKS.some(n=>n.id===id)))fail('Vyberte alespoň jednu platnou síť.');
 if(!Array.isArray(input.tags)||input.tags.length>12)fail('Použijte nejvýše 12 štítků.');
 const tags=[...new Set(input.tags.map(t=>text(t,40,'Štítek')).filter(Boolean))];
 return {name:text(input.name,100,'Název'),tags,source:text(input.source,300,'Zdroj'),note:text(input.note,4000,'Poznámka'),status,chainIds:[...new Set(input.chainIds)].sort()};
}
export class SmartWalletStore{
 constructor(db){this.db=db;db.exec(`CREATE TABLE IF NOT EXISTS smart_wallets(address TEXT PRIMARY KEY,name TEXT NOT NULL,tags_json TEXT NOT NULL,source TEXT NOT NULL,note TEXT NOT NULL,status TEXT NOT NULL,chains_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);}
 decode(row){return row?{address:row.address,name:row.name,tags:JSON.parse(row.tags_json),source:row.source,note:row.note,status:row.status,chainIds:JSON.parse(row.chains_json),createdAt:row.created_at,updatedAt:row.updated_at}:null;}
 get(address){return this.decode(this.db.prepare('SELECT * FROM smart_wallets WHERE address=?').get(address.toLowerCase()));}
 list(){return this.db.prepare('SELECT * FROM smart_wallets ORDER BY updated_at DESC,address').all().map(row=>this.decode(row));}
 add(input){
  const f=fields(input);
  if(!Array.isArray(input.addresses)||!input.addresses.length||input.addresses.length>200||input.addresses.some(a=>typeof a!=='string'||!isAddress(a)))fail('Vložte 1 až 200 platných EVM adres. Celý seznam musí být platný.');
  const addresses=[...new Set(input.addresses.map(a=>a.toLowerCase()))],created=[],existing=[],now=new Date().toISOString();
  const insert=this.db.prepare('INSERT INTO smart_wallets VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(address) DO NOTHING');
  this.db.exec('BEGIN IMMEDIATE');try{
   for(const address of addresses){const r=insert.run(address,f.name,JSON.stringify(f.tags),f.source,f.note,f.status,JSON.stringify(f.chainIds),now,now);(r.changes?created:existing).push(address);}
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
  return {created,existing};
 }
 update(address,input){
  if(!isAddress(address))fail('Neplatná adresa.');if(!this.get(address))fail('Peněženka nebyla nalezena.',404);
  const f=fields(input);this.db.prepare('UPDATE smart_wallets SET name=?,tags_json=?,source=?,note=?,status=?,chains_json=?,updated_at=? WHERE address=?').run(f.name,JSON.stringify(f.tags),f.source,f.note,f.status,JSON.stringify(f.chainIds),new Date().toISOString(),address.toLowerCase());
  return this.get(address);
 }
}
