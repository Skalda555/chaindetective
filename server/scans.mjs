import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {NETWORKS,getNetwork,isAddress,aggregateHoldings} from '../dist/data.js';
import {decodeToken,decodeHolding} from './provider.mjs';
import {WalletProviderRouter} from './wallet-provider.mjs';

const stamp=()=>new Date().toISOString();
const parse=value=>value?JSON.parse(value):null;
const knownSum=holdings=>{const priced=holdings.filter(h=>Number.isFinite(h.value));return priced.length?priced.reduce((s,h)=>s+h.value,0):null;};
const positiveInt=(value,fallback)=>Number.isInteger(Number(value))&&Number(value)>0?Number(value):fallback;
export const SCAN_CONFIG=Object.freeze({maxWallets:positiveInt(process.env.SCAN_MAX_WALLETS,500),taskConcurrency:positiveInt(process.env.SCAN_TASK_CONCURRENCY,4)});
export function validateQuery(input){
 if(!input||!['holders','wallets'].includes(input.kind))throw new Error('Neplatný typ skenu.');
 const chainIds=[...new Set(input.chainIds||[])].sort();
 if(!chainIds.length||chainIds.some(id=>!NETWORKS.some(network=>network.id===id)))throw new Error('Vyberte platné podporované sítě.');
 const query={kind:input.kind,chainIds,match:input.match||'all'};
 if(input.provider!==undefined&&!['auto','blockscout','alchemy'].includes(input.provider))throw new Error('Tento poskytovatel není připojený.');
 if(input.provider&&input.provider!=='auto')query.provider=input.provider;
 if(query.kind==='holders'&&query.provider==='alchemy')throw new Error('Alchemy adaptér podporuje portfolio peněženky, nikoli hledání držitelů ERC-20.');
 if(!['all','any'].includes(query.match))throw new Error('Neplatný režim průniku.');
 if(query.kind==='holders'){
  if(!Array.isArray(input.tokens)||!input.tokens.length||input.tokens.length>5)throw new Error('Vyberte 1 až 5 kontraktů.');
  query.tokens=[...new Map(input.tokens.map(t=>{if(!isAddress(t.address)||!chainIds.includes(t.chainId))throw new Error('Neplatný kontrakt nebo jeho síť.');const address=t.address.toLowerCase();return [`${t.chainId}:${address}`,{chainId:t.chainId,address}];})).values()].sort((a,b)=>`${a.chainId}:${a.address}`.localeCompare(`${b.chainId}:${b.address}`));
 }else{
  if(!Array.isArray(input.addresses)||!input.addresses.length||input.addresses.some(a=>!isAddress(a)))throw new Error('Vložte alespoň jednu platnou adresu.');
  query.addresses=[...new Set(input.addresses.map(a=>a.toLowerCase()))].sort();
  if(query.addresses.length>SCAN_CONFIG.maxWallets)throw new Error(`Jeden sken může obsahovat nejvýše ${SCAN_CONFIG.maxWallets} unikátních peněženek.`);
  const inputMetadata=Array.isArray(input.walletMetadata)?input.walletMetadata:[];
  query.walletMetadata=[...new Map(inputMetadata.filter(w=>w&&isAddress(w.address)&&query.addresses.includes(w.address.toLowerCase())).map(w=>[w.address.toLowerCase(),{
   address:w.address.toLowerCase(),name:typeof w.name==='string'?w.name.trim().slice(0,120):'',tags:[...new Set((Array.isArray(w.tags)?w.tags:[]).filter(t=>typeof t==='string').map(t=>t.trim().slice(0,64)).filter(Boolean))].slice(0,30),status:['candidate','reviewed','excluded'].includes(w.status)?w.status:null
  }])).values()].sort((a,b)=>a.address.localeCompare(b.address));
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
  if(!columns.includes('fallback_from'))this.db.exec('ALTER TABLE tasks ADD COLUMN fallback_from TEXT');
  if(!columns.includes('fallback_reason'))this.db.exec('ALTER TABLE tasks ADD COLUMN fallback_reason TEXT');
  if(!columns.includes('as_of'))this.db.exec('ALTER TABLE tasks ADD COLUMN as_of TEXT');
 }
 get(id){return this.db.prepare('SELECT * FROM scans WHERE id=?').get(id);}
 tasks(id){return this.db.prepare('SELECT * FROM tasks WHERE scan_id=? ORDER BY task_key').all(id).map(t=>({...t,chainId:t.chain_id,cursor:parse(t.cursor),metadata:parse(t.metadata)}));}
 describe(id){
  const row=this.get(id);if(!row)return null;const query=parse(row.query_json),count=this.db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE scan_id=?').get(id).n,compact=query.kind==='wallets'&&count>50;
  const all=compact?null:this.tasks(id),tasks=compact?this.summarizeWalletTasks(id):all;
  const positions=this.db.prepare('SELECT COUNT(*) AS n FROM positions WHERE scan_id=?').get(id).n;
  const progress=compact?this.db.prepare('SELECT COALESCE(SUM(pages),0) pages FROM tasks WHERE scan_id=?').get(id).pages:all.reduce((s,t)=>s+t.pages,0);
  return {id,status:row.status,query,createdAt:row.created_at,updatedAt:row.updated_at,finishedAt:row.finished_at,message:row.message,revision:row.revision,pages:progress,positions,taskCount:count,tasks:tasks.map(t=>({key:t.task_key,kind:t.kind,chainId:t.chainId,address:t.address,provider:t.provider,fallbackUsed:!!t.fallback_from,fallbackFrom:t.fallback_from, fallbackReason:t.fallback_reason,asOf:t.as_of,status:t.status,pages:t.pages,complete:t.status==='complete',invalidRows:t.invalid_rows,error:t.error,token:t.metadata,nextPageAvailable:t.status!=='complete',...(t.taskCount?{taskCount:t.taskCount,counts:t.counts}: {})}))};
 }
 summarizeWalletTasks(id){
  return this.db.prepare(`SELECT chain_id,provider,fallback_from,status,COUNT(*) task_count,SUM(pages) pages,SUM(invalid_rows) invalid_rows,MAX(as_of) as_of,MIN(error) error,MIN(fallback_reason) fallback_reason
   FROM tasks WHERE scan_id=? GROUP BY chain_id,provider,fallback_from,status ORDER BY chain_id,provider,status`).all(id).map(t=>({task_key:`${t.chain_id}:${t.provider}:${t.status}`,kind:'wallets',chainId:t.chain_id,provider:t.provider,fallback_from:t.fallback_from,fallback_reason:t.fallback_reason,as_of:t.as_of,status:t.status,pages:t.pages||0,invalid_rows:t.invalid_rows||0,error:t.error,taskCount:t.task_count,counts:{tasks:t.task_count,pages:t.pages||0}}));
 }
 list(){return this.db.prepare('SELECT id FROM scans ORDER BY created_at DESC LIMIT 12').all().map(r=>this.describe(r.id));}
 touch(id,status,message){this.db.prepare('UPDATE scans SET status=?,message=?,updated_at=?,revision=revision+1 WHERE id=?').run(status,message,stamp(),id);}
 close(){this.db.close();}
}
export class ScanEngine{
 constructor({filename,store,provider=new WalletProviderRouter(),cacheMs=15*60*1000,taskConcurrency=SCAN_CONFIG.taskConcurrency}={}){this.store=store||new ScanStore(filename);this.provider=provider;this.cacheMs=cacheMs;this.active=new Map();this.taskConcurrency=positiveInt(taskConcurrency,SCAN_CONFIG.taskConcurrency);this.tokenCache=new Map();}
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
   const insert=db.prepare('INSERT INTO tasks(scan_id,task_key,kind,chain_id,address,status,error,provider,fallback_from,fallback_reason) VALUES(?,?,?,?,?,?,?,?,?,?)');
   for(const t of tasks){t.requestedProvider=query.provider||'auto';const route=this.provider.route?.(t);const supported=this.provider.supports?.(t)??getNetwork(t.chainId).live;insert.run(id,`${t.chainId}:${t.address}`,t.kind,t.chainId,t.address,supported?'pending':'unsupported',supported?null:`${getNetwork(t.chainId).name}: zvolený zdroj nepodporuje tuto operaci nebo síť.`,route?.provider||this.provider.choose?.(t)||'blockscout',route?.fallbackFrom||null,route?.fallbackReason||null);}
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
  entry.promise=this.work(id,controller.signal).finally(()=>{this.store.db.prepare("UPDATE tasks SET status='pending' WHERE scan_id=? AND status='running'").run(id);this.active.delete(id);});
  return this.store.describe(id);
 }
 async pause(id){const entry=this.active.get(id);if(entry){this.store.touch(id,'paused','Pozastaveno. Načtené stránky jsou uložené.');entry.controller.abort();await entry.promise;}return this.store.describe(id);}
 remove(id){
  const job=this.store.get(id);
  if(!job){const error=new Error('Sken nebyl nalezen.');error.status=404;throw error;}
  if(job.status==='running'||this.active.has(id)){const error=new Error('Běžící sken nelze smazat. Nejprve jej pozastavte a počkejte na dokončení zastavení.');error.status=409;throw error;}
  // One atomic DELETE; foreign keys cascade through tasks to positions and cursors.
  this.store.db.prepare('DELETE FROM scans WHERE id=?').run(id);
  return {id,deleted:true};
 }
 async work(id,signal){
  try{
   const worker=async()=>{for(;;){signal.throwIfAborted();const task=this.claimTask(id);if(!task)return;await this.processTask(id,task,signal);}};
   const outcomes=await Promise.allSettled(Array.from({length:this.taskConcurrency},worker));
   if(signal.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
   const failed=outcomes.find(o=>o.status==='rejected');if(failed)throw failed.reason;
   signal.throwIfAborted();const tasks=this.store.tasks(id),complete=tasks.every(t=>t.status==='complete'&&!t.invalid_rows);
   this.store.touch(id,complete?'complete':'partial',complete?'Všechny stránky indexeru jsou načtené.':'Částečný sken. Uložená data lze otevřít nebo pokračovat.');
   this.store.db.prepare('UPDATE scans SET finished_at=? WHERE id=?').run(stamp(),id);
  }catch(error){if(!signal.aborted)this.store.touch(id,'partial',error.message);}
 }
 claimTask(id){
  const db=this.store.db;const task=db.prepare("SELECT * FROM tasks WHERE scan_id=? AND status='pending' ORDER BY task_key LIMIT 1").get(id);if(!task)return null;
  const claimed=db.prepare("UPDATE tasks SET status='running' WHERE scan_id=? AND task_key=? AND status='pending'").run(id,task.task_key);if(!claimed.changes)return null;
  return {...task,chainId:task.chain_id,cursor:parse(task.cursor),metadata:parse(task.metadata)};
 }
 async processTask(id,task,signal){
  for(;;){signal.throwIfAborted();try{
   if(task.kind==='holders'&&!task.metadata){task.metadata=await this.provider.metadata(task,signal);this.store.db.prepare('UPDATE tasks SET metadata=? WHERE scan_id=? AND task_key=?').run(JSON.stringify(task.metadata),id,task.task_key);}
   const page=await this.provider.page(task,signal);signal.throwIfAborted();this.commitPage(id,task,page);this.tokenCache.delete(id);
   const summary=this.store.describe(id);this.store.touch(id,'running',`${getNetwork(task.chainId).name} · ${task.metadata?.symbol||task.address.slice(0,10)} · ${summary.pages} stran · ${summary.positions} pozic uloženo`);
   if(!page.cursor)return;task.cursor=page.cursor;task.status='pending';return;
  }catch(error){if(signal.aborted)throw error;const fallback=this.provider.fallback?.(task,error);if(fallback){const db=this.store.db;db.exec('BEGIN');try{
    db.prepare('DELETE FROM positions WHERE scan_id=? AND task_key=?').run(id,task.task_key);db.prepare('DELETE FROM cursors WHERE scan_id=? AND task_key=?').run(id,task.task_key);
    db.prepare("UPDATE tasks SET provider=?,fallback_from=?,fallback_reason=?,as_of=NULL,cursor=NULL,pages=0,invalid_rows=0,status='pending',error=NULL WHERE scan_id=? AND task_key=?").run(fallback,task.provider,this.provider.fallbackReason?.(task,error)||error.message,id,task.task_key);db.exec('COMMIT');
   }catch(resetError){db.exec('ROLLBACK');throw resetError;}
   this.store.touch(id,'running',`${getNetwork(task.chainId).name}: přepínám na Blockscout od první stránky. ${error.message}`);task.provider=fallback;task.cursor=null;continue;
   }
   this.store.db.prepare("UPDATE tasks SET status='error',error=?,as_of=? WHERE scan_id=? AND task_key=?").run(error.message+(this.provider.fallbackUnavailable?.(task)||''),stamp(),id,task.task_key);return;
  }}
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
    db.prepare('UPDATE tasks SET cursor=?,pages=pages+1,invalid_rows=invalid_rows+?,status=?,as_of=? WHERE scan_id=? AND task_key=?').run(next,invalid,next?'pending':'complete',stamp(),id,task.task_key);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 result(id,{offset=0,limit=100,revision,view='wallets',sort='holders',minHolders=0,minShare=0,chainId='',search=''}={}){
  const job=this.store.describe(id);if(!job)throw new Error('Sken nebyl nalezen.');
  if(job.status==='running'){const error=new Error('Pro otevření průběžných výsledků sken nejprve pozastavte.');error.status=409;throw error;}
  if(revision!==undefined&&Number(revision)!==job.revision){const error=new Error('Výsledky se změnily. Otevřete sken znovu.');error.status=409;throw error;}
  offset=Math.max(0,Math.floor(Number(offset)||0));limit=Math.min(200,Math.max(1,Math.floor(Number(limit)||100)));
  if(job.query.kind==='wallets'&&view==='tokens')return this.tokenResults(id,job,{offset,limit,revision,sort,minHolders,minShare,chainId,search});
  const db=this.store.db,query=job.query,required=query.kind==='holders'&&query.match==='all'?query.tokens.length:1;
  const grouped='SELECT owner FROM positions WHERE scan_id=? GROUP BY owner HAVING COUNT(DISTINCT token_id)>=?';
  const taskRows=this.store.tasks(id);
  const successful=query.kind==='wallets'?query.addresses.filter(address=>taskRows.some(t=>t.address===address&&t.status==='complete')):null;
  const total=successful?successful.length:db.prepare(`SELECT COUNT(*) AS n FROM (${grouped})`).get(id,required).n;
  const owners=successful?successful.slice(offset,offset+limit):db.prepare(`${grouped} ORDER BY owner LIMIT ? OFFSET ?`).all(id,required,limit,offset).map(r=>r.owner);
  const rows=owners.length?db.prepare(`SELECT owner,holding FROM positions WHERE scan_id=? AND owner IN (${owners.map(()=>'?').join(',')}) ORDER BY owner,token_id`).all(id,...owners):[];
  const map=new Map(owners.map(address=>[address,{address,label:null,isDemo:false,holdings:[]} ]));
  for(const r of rows)map.get(r.owner).holdings.push(parse(r.holding));
  const metadata=new Map((query.walletMetadata||[]).map(w=>[w.address,w]));
  const wallets=[...map.values()].map(w=>({...w,...(metadata.has(w.address)?{smartWallet:metadata.get(w.address)}:{}),value:w.holdings.length?knownSum(w.holdings):0,chainIds:[...new Set(w.holdings.map(h=>h.chainId))],matchedTokens:query.kind==='holders'?w.holdings.map(h=>taskRows.find(t=>t.metadata?.id===h.tokenId)?.metadata).filter(Boolean):[],matchCount:query.kind==='holders'?w.holdings.length:0}));
  const warnings=taskRows.flatMap(t=>[...(t.fallbackReason?[`${getNetwork(t.chainId).name}: ${t.fallbackReason} Použit Blockscout.`]:[]),...(t.error?[`${getNetwork(t.chainId).name}: ${t.error}`]:[]),...(t.invalid_rows?[`${t.invalid_rows} neplatných pozic nebylo možné zahrnout.`]:[])]);
  if(job.status!=='complete')warnings.unshift('Sken není dokončený. Výsledky a průnik pokrývají pouze dosud načtené stránky.');
  const coverage=this.coverage(id,job,taskRows);
  const providerLabel=[...new Set(taskRows.filter(t=>t.status!=='unsupported').map(t=>t.provider==='alchemy'?'Alchemy':'Blockscout'))].join(' + ')||'Žádný zdroj nebyl dostupný';coverage.providerLabel=providerLabel;
  return {wallets,tokens:query.kind==='holders'?taskRows.map(t=>t.metadata).filter(Boolean):aggregateHoldings(wallets,query.addresses.length),source:'live',warnings,coverage,job,pagination:{offset,limit,total,nextOffset:offset+owners.length<total?offset+owners.length:null,revision:job.revision}};
 }
 coverage(id,job,taskRows=this.store.tasks(id)){
  const query=job.query,chainCoverage=query.kind==='wallets'?query.chainIds.map(id=>{const relevant=taskRows.filter(t=>t.chainId===id),analyzed=relevant.filter(t=>t.status==='complete').length;return {chainId:id,analyzed,requested:query.addresses.length,share:query.addresses.length?analyzed/query.addresses.length:0};}):[];
  const completedAddresses=new Set(taskRows.filter(t=>t.status==='complete').map(t=>t.address));
  const providers=new Map();for(const t of taskRows){const key=[t.chainId,t.provider,t.fallback_from,t.status].join(':');if(!providers.has(key))providers.set(key,{chainId:t.chainId,provider:t.status==='unsupported'?null:t.provider,fallbackUsed:!!t.fallback_from,fallbackFrom:t.fallback_from,fallbackReason:t.fallback_reason,asOf:t.as_of,status:t.status,error:t.error,taskCount:0});const p=providers.get(key);p.taskCount++;if(t.as_of&&(!p.asOf||t.as_of>p.asOf))p.asOf=t.as_of;if(t.error)p.error=t.error;}
  const failures=taskRows.filter(t=>t.status==='error'||t.status==='unsupported').map(t=>({chainId:t.chainId,address:t.address,status:t.status,error:t.error,provider:t.provider,fallbackFrom:t.fallback_from}));
  const analyzedWalletCount=query.kind==='wallets'?completedAddresses.size:0,requestedWalletCount=query.kind==='wallets'?query.addresses.length:0;
  const networkText=chainCoverage.map(n=>`${getNetwork(n.chainId).name} ${n.analyzed}/${n.requested}`).join(' · ');
  return {source:'live',complete:job.status==='complete',bounded:job.status!=='complete',asOf:job.updatedAt,startedAt:job.createdAt,snapshotConsistent:false,details:failures.length<=50?failures:failures.slice(0,50),provenance:[...providers.values()],analyzedWalletCount,requestedWalletCount,networks:chainCoverage,message:`${analyzedWalletCount} / ${requestedWalletCount} peněženek úspěšně analyzováno napříč vybranými sítěmi${networkText?` · ${networkText}`:''}. ${job.status==='complete'?'Všechny úlohy dokončeny':'Výsledky zahrnují dokončené úlohy; částečné úlohy lze obnovit.'}`};
 }
 tokenResults(id,job,{offset,limit,revision,sort,minHolders,minShare,chainId,search}){
  let rows=this.tokenCache.get(id)?.revision===job.revision?this.tokenCache.get(id).rows:null;
  if(!rows){
   const tasks=this.store.tasks(id),analyzed=new Map();for(const task of tasks)if(task.status==='complete')analyzed.set(task.chainId,(analyzed.get(task.chainId)||0)+1);
   const grouped=new Map(),positions=this.store.db.prepare(`SELECT p.owner,p.token_id,p.holding,t.chain_id,t.status FROM positions p JOIN tasks t ON t.scan_id=p.scan_id AND t.task_key=p.task_key WHERE p.scan_id=?`).all(id);
   for(const row of positions){if(row.status!=='complete')continue;const holding=parse(row.holding),key=`${row.chain_id}:${holding.address||holding.id?.split(':').slice(1).join(':')||row.token_id.split(':').slice(1).join(':')}`;let group=grouped.get(key);if(!group){group={...holding,id:row.token_id,chainId:row.chain_id,holderCount:0,analyzedWalletCount:analyzed.get(row.chain_id)||0,share:0,totalValue:null,amount:0,unpricedPositions:0,pricedPositions:0,owners:new Set()};grouped.set(key,group);}if(group.owners.has(row.owner))continue;group.owners.add(row.owner);group.holderCount++;group.amount+=Number(holding.amount)||0;if(Number.isFinite(holding.value)){group.totalValue=(group.totalValue??0)+holding.value;group.pricedPositions++;}else group.unpricedPositions++;}
   rows=[...grouped.values()].map(g=>{const {owners,...row}=g;row.share=row.analyzedWalletCount?row.holderCount/row.analyzedWalletCount:0;row.totalValue=row.totalValue===null?null:Math.round(row.totalValue*100)/100;return row;});
   if(this.tokenCache.size>=6)this.tokenCache.delete(this.tokenCache.keys().next().value);this.tokenCache.set(id,{revision:job.revision,rows});
  }
  const minCount=Math.max(0,Number(minHolders)||0),minPercent=Math.max(0,Number(minShare)||0),needle=String(search||'').trim().toLowerCase();
  rows=rows.filter(t=>(!chainId||t.chainId===chainId)&&t.holderCount>=minCount&&t.share*100>=minPercent&&(!needle||`${t.symbol} ${t.name} ${t.address}`.toLowerCase().includes(needle)));
  rows.sort(sort==='value'?(a,b)=>(b.totalValue??-1)-(a.totalValue??-1)||b.holderCount-a.holderCount:(a,b)=>b.holderCount-a.holderCount||b.share-a.share||(b.totalValue??-1)-(a.totalValue??-1));
  const total=rows.length,tokens=rows.slice(offset,offset+limit),taskRows=this.store.tasks(id),coverage=this.coverage(id,job,taskRows),providerLabel=[...new Set(taskRows.filter(t=>t.status!=='unsupported').map(t=>t.provider==='alchemy'?'Alchemy':'Blockscout'))].join(' + ')||'Žádný zdroj nebyl dostupný';coverage.providerLabel=providerLabel;
  const warnings=taskRows.flatMap(t=>[...(t.fallbackReason?[`${getNetwork(t.chainId).name}: ${t.fallbackReason} Použit Blockscout.`]:[]),...(t.error?[`${getNetwork(t.chainId).name}: ${t.error}`]:[]),...(t.invalid_rows?[`${t.invalid_rows} neplatných pozic nebylo možné zahrnout.`]:[])]);if(job.status!=='complete')warnings.unshift('Sken je částečný. Popularita se počítá pouze z úspěšně dokončených úloh v relevantní síti.');
  return {wallets:[],tokens,source:'live',warnings,coverage,job,pagination:{offset,limit,total,nextOffset:offset+tokens.length<total?offset+tokens.length:null,revision:job.revision,view:'tokens'}};
 }
 async close(){await Promise.all([...this.active.keys()].map(id=>this.pause(id)));this.store.close();}
}
