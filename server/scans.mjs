import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {getNetwork,isAddress,aggregateHoldings} from '../dist/data.js';
import {decodeToken,decodeHolding} from './provider.mjs';
import {WalletProviderRouter} from './wallet-provider.mjs';

const stamp=()=>new Date().toISOString();
const parse=value=>value?JSON.parse(value):null;
const knownSum=holdings=>{const priced=holdings.filter(h=>Number.isFinite(h.value));return priced.length?priced.reduce((s,h)=>s+h.value,0):null;};
export function validateQuery(input){
 if(!input||!['holders','wallets'].includes(input.kind))throw new Error('Neplatný typ skenu.');
 const chainIds=[...new Set(input.chainIds||[])].sort();
 if(!chainIds.length||chainIds.some(id=>!getNetwork(id)))throw new Error('Vyberte platné sítě.');
 const query={kind:input.kind,chainIds,match:input.match||'all'};
 if(input.provider!==undefined&&!['auto','blockscout','alchemy'].includes(input.provider))throw new Error('Tento poskytovatel není připojený.');
 if(input.provider&&input.provider!=='auto')query.provider=input.provider;
 if(query.kind==='holders'&&query.provider==='alchemy')throw new Error('Alchemy adaptér podporuje portfolio peněženky, nikoli hledání držitelů ERC-20.');
 if(!['all','any'].includes(query.match))throw new Error('Neplatný režim průniku.');
 if(query.kind==='holders'){
  if(!Array.isArray(input.tokens)||!input.tokens.length||input.tokens.length>5)throw new Error('Vyberte 1 až 5 kontraktů.');
  query.tokens=[...new Map(input.tokens.map(t=>{if(!isAddress(t.address)||!chainIds.includes(t.chainId))throw new Error('Neplatný kontrakt nebo jeho síť.');const address=t.address.toLowerCase();return [`${t.chainId}:${address}`,{chainId:t.chainId,address}];})).values()].sort((a,b)=>`${a.chainId}:${a.address}`.localeCompare(`${b.chainId}:${b.address}`));
 }else{
  if(!Array.isArray(input.addresses)||!input.addresses.length||input.addresses.length>20||input.addresses.some(a=>!isAddress(a)))throw new Error('Vložte 1 až 20 platných adres.');
  query.addresses=[...new Set(input.addresses.map(a=>a.toLowerCase()))].sort();
 }
 return query;
}
export class ScanStore{
 constructor(filename){
  if(filename!==':memory:')mkdirSync(path.dirname(filename),{recursive:true});
  this.db=new DatabaseSync(filename);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS scans(id TEXT PRIMARY KEY,query_key TEXT NOT NULL,query_json TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,finished_at TEXT,message TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0);
   CREATE INDEX IF NOT EXISTS scans_query ON scans(query_key,created_at);
   CREATE TABLE IF NOT EXISTS tasks(scan_id TEXT NOT NULL,task_key TEXT NOT NULL,kind TEXT NOT NULL,chain_id TEXT NOT NULL,address TEXT NOT NULL,status TEXT NOT NULL,metadata TEXT,cursor TEXT,pages INTEGER NOT NULL DEFAULT 0,invalid_rows INTEGER NOT NULL DEFAULT 0,error TEXT,PRIMARY KEY(scan_id,task_key),FOREIGN KEY(scan_id) REFERENCES scans(id) ON DELETE CASCADE);
   CREATE TABLE IF NOT EXISTS positions(scan_id TEXT NOT NULL,task_key TEXT NOT NULL,owner TEXT NOT NULL,token_id TEXT NOT NULL,holding TEXT NOT NULL,PRIMARY KEY(scan_id,task_key,owner,token_id),FOREIGN KEY(scan_id,task_key) REFERENCES tasks(scan_id,task_key) ON DELETE CASCADE);
   CREATE INDEX IF NOT EXISTS positions_wallet ON positions(scan_id,owner);
   CREATE TABLE IF NOT EXISTS cursors(scan_id TEXT NOT NULL,task_key TEXT NOT NULL,signature TEXT NOT NULL,PRIMARY KEY(scan_id,task_key,signature),FOREIGN KEY(scan_id,task_key) REFERENCES tasks(scan_id,task_key) ON DELETE CASCADE);
   UPDATE scans SET status='paused',message='Server byl restartován. Pokračujte od uložené stránky.' WHERE status='running';
   UPDATE tasks SET status='pending' WHERE status='running';`);
  const columns=this.db.prepare('PRAGMA table_info(tasks)').all().map(c=>c.name);
  if(!columns.includes('provider'))this.db.exec("ALTER TABLE tasks ADD COLUMN provider TEXT NOT NULL DEFAULT 'blockscout'");
  if(!columns.includes('fallback_reason'))this.db.exec('ALTER TABLE tasks ADD COLUMN fallback_reason TEXT');
 }
 get(id){return this.db.prepare('SELECT * FROM scans WHERE id=?').get(id);}
 tasks(id){return this.db.prepare('SELECT * FROM tasks WHERE scan_id=? ORDER BY task_key').all(id).map(t=>({...t,chainId:t.chain_id,cursor:parse(t.cursor),metadata:parse(t.metadata)}));}
 describe(id){
  const row=this.get(id);if(!row)return null;const tasks=this.tasks(id);
  const positions=this.db.prepare('SELECT COUNT(*) AS n FROM positions WHERE scan_id=?').get(id).n;
  return {id,status:row.status,query:parse(row.query_json),createdAt:row.created_at,updatedAt:row.updated_at,finishedAt:row.finished_at,message:row.message,revision:row.revision,pages:tasks.reduce((s,t)=>s+t.pages,0),positions,tasks:tasks.map(t=>({key:t.task_key,kind:t.kind,chainId:t.chainId,address:t.address,provider:t.provider,fallbackReason:t.fallback_reason,status:t.status,pages:t.pages,complete:t.status==='complete',invalidRows:t.invalid_rows,error:t.error,token:t.metadata,nextPageAvailable:t.status!=='complete'}))};
 }
 list(){return this.db.prepare('SELECT id FROM scans ORDER BY created_at DESC LIMIT 12').all().map(r=>this.describe(r.id));}
 touch(id,status,message){this.db.prepare('UPDATE scans SET status=?,message=?,updated_at=?,revision=revision+1 WHERE id=?').run(status,message,stamp(),id);}
 close(){this.db.close();}
}
export class ScanEngine{
 constructor({filename,store,provider=new WalletProviderRouter(),cacheMs=15*60*1000}={}){this.store=store||new ScanStore(filename);this.provider=provider;this.cacheMs=cacheMs;this.active=new Map();}
 start(input){
  const query=validateQuery(input),json=JSON.stringify(query),key=createHash('sha256').update(json+(this.provider.cacheKey?.(query.kind)||'')).digest('hex');
  this.provider.validate?.(query);
  if(!input.refresh){
   const previous=this.store.db.prepare('SELECT * FROM scans WHERE query_key=? ORDER BY created_at DESC LIMIT 1').get(key);
   if(previous&&(previous.status!=='complete'||Date.now()-Date.parse(previous.finished_at)<this.cacheMs)){
    if(previous.status!=='complete')this.resume(previous.id);return {...this.store.describe(previous.id),cached:previous.status==='complete'};
   }
  }
  const id=randomUUID(),now=stamp(),db=this.store.db;
  const tasks=query.kind==='holders'?query.tokens.map(t=>({...t,kind:'holders'})):query.addresses.flatMap(address=>query.chainIds.map(chainId=>({kind:'wallets',address,chainId})));
  db.exec('BEGIN');try{
   db.prepare('INSERT INTO scans(id,query_key,query_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,key,json,'paused',now,now);
   const insert=db.prepare('INSERT INTO tasks(scan_id,task_key,kind,chain_id,address,status,error,provider) VALUES(?,?,?,?,?,?,?,?)');
   for(const t of tasks){t.requestedProvider=query.provider||'auto';const supported=this.provider.supports?.(t)??getNetwork(t.chainId).live;insert.run(id,`${t.chainId}:${t.address}`,t.kind,t.chainId,t.address,supported?'pending':'unsupported',supported?null:'Zvolený poskytovatel tuto síť nepodporuje.',this.provider.choose?.(t)||'blockscout');}
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  this.resume(id);return this.store.describe(id);
 }
 resume(id){
  const job=this.store.get(id);if(!job)throw new Error('Sken nebyl nalezen.');
  if(this.active.has(id)||job.status==='complete')return this.store.describe(id);
  if(this.active.size>=2){const error=new Error('Běží dva skeny. Nejdříve některý pozastavte.');error.status=409;throw error;}
  this.store.db.prepare("UPDATE tasks SET status='pending',error=NULL WHERE scan_id=? AND status IN ('error','pending')").run(id);
  this.store.touch(id,'running','Načítám další stránky indexeru…');
  const controller=new AbortController();const entry={controller,promise:null};this.active.set(id,entry);
  entry.promise=this.work(id,controller.signal).finally(()=>this.active.delete(id));
  return this.store.describe(id);
 }
 async pause(id){const entry=this.active.get(id);if(entry){this.store.touch(id,'paused','Pozastaveno. Načtené stránky jsou uložené.');entry.controller.abort();await entry.promise;}return this.store.describe(id);}
 async work(id,signal){
  try{
   for(;;){
    signal.throwIfAborted();const pending=this.store.tasks(id).filter(t=>t.status==='pending');if(!pending.length)break;
    for(const task of pending){
     signal.throwIfAborted();try{
      if(task.kind==='holders'&&!task.metadata){task.metadata=await this.provider.metadata(task,signal);this.store.db.prepare('UPDATE tasks SET metadata=? WHERE scan_id=? AND task_key=?').run(JSON.stringify(task.metadata),id,task.task_key);}
      const page=await this.provider.page(task,signal);signal.throwIfAborted();this.commitPage(id,task,page);
      const snapshot=this.store.describe(id);this.store.touch(id,'running',`${getNetwork(task.chainId).name} · ${task.metadata?.symbol||task.address.slice(0,10)} · ${snapshot.pages} stran · ${snapshot.positions} pozic uloženo`);
     }catch(error){
      if(signal.aborted)throw error;
      const fallback=this.provider.fallback?.(task,error);
      if(fallback){
       const db=this.store.db;db.exec('BEGIN');try{
        db.prepare('DELETE FROM positions WHERE scan_id=? AND task_key=?').run(id,task.task_key);
        db.prepare('DELETE FROM cursors WHERE scan_id=? AND task_key=?').run(id,task.task_key);
        db.prepare("UPDATE tasks SET provider=?,fallback_reason=?,cursor=NULL,pages=0,invalid_rows=0,status='pending',error=NULL WHERE scan_id=? AND task_key=?").run(fallback,error.message,id,task.task_key);
        db.exec('COMMIT');
       }catch(resetError){db.exec('ROLLBACK');throw resetError;}
       this.store.touch(id,'running',`${getNetwork(task.chainId).name}: přepínám na Blockscout od první stránky. ${error.message}`);
      }else this.store.db.prepare("UPDATE tasks SET status='error',error=? WHERE scan_id=? AND task_key=?").run(error.message+(task.provider==='alchemy'&&!getNetwork(task.chainId).live?' Záloha Blockscout není na této síti dostupná.':''),id,task.task_key);
     }
    }
   }
   const tasks=this.store.tasks(id),complete=tasks.every(t=>t.status==='complete'&&!t.invalid_rows);
   this.store.touch(id,complete?'complete':'partial',complete?'Všechny stránky indexeru jsou načtené.':'Částečný sken. Uložená data lze otevřít nebo pokračovat.');
   this.store.db.prepare('UPDATE scans SET finished_at=? WHERE id=?').run(stamp(),id);
  }catch(error){if(!signal.aborted)this.store.touch(id,'partial',error.message);}
 }
 commitPage(id,task,page){
  const db=this.store.db,signature=JSON.stringify(task.cursor||{});
  if(page.cursor&&typeof page.cursor!=='object')throw new Error('Neplatný kurzor další stránky.');
  const next=page.cursor?JSON.stringify(page.cursor):null;
  if(next&&(next===signature||db.prepare('SELECT 1 FROM cursors WHERE scan_id=? AND task_key=? AND signature=?').get(id,task.task_key,next)))throw new Error('Indexer opakuje kurzor. Sken zůstává částečný.');
  const rows=[];let invalid=0;
  for(const item of page.items){try{
   const token=task.kind==='holders'?task.metadata:decodeToken(item.token||{},task.chainId);
   const owner=task.kind==='holders'?String(item.address?.hash||item.address_hash||item.address||'').toLowerCase():task.address;
   if(!isAddress(owner))throw new Error('Neplatná adresa držitele.');
   const holding=decodeHolding(token,item.value);if(holding)rows.push({owner,holding});
  }catch{invalid++;}}
  db.exec('BEGIN');try{
   const insert=db.prepare('INSERT OR IGNORE INTO positions(scan_id,task_key,owner,token_id,holding) VALUES(?,?,?,?,?)');
   for(const row of rows)insert.run(id,task.task_key,row.owner,row.holding.tokenId,JSON.stringify(row.holding));
   db.prepare('INSERT OR IGNORE INTO cursors(scan_id,task_key,signature) VALUES(?,?,?)').run(id,task.task_key,signature);
   db.prepare('UPDATE tasks SET cursor=?,pages=pages+1,invalid_rows=invalid_rows+?,status=? WHERE scan_id=? AND task_key=?').run(next,invalid,next?'pending':'complete',id,task.task_key);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 result(id,{offset=0,limit=500,revision}={}){
  const job=this.store.describe(id);if(!job)throw new Error('Sken nebyl nalezen.');
  if(job.status==='running'){const error=new Error('Pro otevření průběžných výsledků sken nejprve pozastavte.');error.status=409;throw error;}
  if(revision!==undefined&&Number(revision)!==job.revision){const error=new Error('Výsledky se změnily. Otevřete sken znovu.');error.status=409;throw error;}
  offset=Math.max(0,Math.floor(Number(offset)||0));limit=Math.min(1000,Math.max(1,Math.floor(Number(limit)||500)));
  const db=this.store.db,query=job.query,required=query.kind==='holders'&&query.match==='all'?query.tokens.length:1;
  const grouped='SELECT owner FROM positions WHERE scan_id=? GROUP BY owner HAVING COUNT(DISTINCT token_id)>=?';
  const successful=query.kind==='wallets'?query.addresses.filter(address=>job.tasks.some(t=>t.address===address&&t.pages>0)):null;
  const total=successful?successful.length:db.prepare(`SELECT COUNT(*) AS n FROM (${grouped})`).get(id,required).n;
  const owners=successful?successful.slice(offset,offset+limit):db.prepare(`${grouped} ORDER BY owner LIMIT ? OFFSET ?`).all(id,required,limit,offset).map(r=>r.owner);
  const rows=owners.length?db.prepare(`SELECT owner,holding FROM positions WHERE scan_id=? AND owner IN (${owners.map(()=>'?').join(',')}) ORDER BY owner,token_id`).all(id,...owners):[];
  const map=new Map(owners.map(address=>[address,{address,label:null,isDemo:false,holdings:[]} ]));
  for(const r of rows)map.get(r.owner).holdings.push(parse(r.holding));
  const wallets=[...map.values()].map(w=>({...w,value:w.holdings.length?knownSum(w.holdings):0,chainIds:[...new Set(w.holdings.map(h=>h.chainId))],matchedTokens:query.kind==='holders'?w.holdings.map(h=>job.tasks.find(t=>t.token?.id===h.tokenId)?.token).filter(Boolean):[],matchCount:query.kind==='holders'?w.holdings.length:0}));
  const warnings=job.tasks.flatMap(t=>[...(t.fallbackReason?[`${getNetwork(t.chainId).name}: ${t.fallbackReason} Použit Blockscout.`]:[]),...(t.error?[`${getNetwork(t.chainId).name}: ${t.error}`]:[]),...(t.invalidRows?[`${t.invalidRows} neplatných pozic nebylo možné zahrnout.`]:[])]);
  if(job.status!=='complete')warnings.unshift('Sken není dokončený. Výsledky a průnik pokrývají pouze dosud načtené stránky.');
  const providerLabel=[...new Set(job.tasks.map(t=>t.provider==='alchemy'?'Alchemy':'Blockscout'))].join(' + ');
  const coverage={source:'live',providerLabel,complete:job.status==='complete',bounded:job.status!=='complete',asOf:job.updatedAt,startedAt:job.createdAt,snapshotConsistent:false,details:job.tasks,message:`${job.status==='complete'?'Všechny stránky indexeru načteny':'Částečný sken'} · ${job.pages} stran · ${job.positions} pozic. Data byla načítána mezi ${job.createdAt} a ${job.updatedAt}; nejde o snapshot jednoho bloku.`};
  return {wallets,tokens:query.kind==='holders'?job.tasks.map(t=>t.token).filter(Boolean):aggregateHoldings(wallets,query.addresses.length),source:'live',warnings,coverage,job,pagination:{offset,limit,total,nextOffset:offset+owners.length<total?offset+owners.length:null,revision:job.revision}};
 }
 async close(){await Promise.all([...this.active.keys()].map(id=>this.pause(id)));this.store.close();}
}
