import './load-env.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {NETWORKS,SYSTEM_WALLET_ADDRESSES,getNetwork,isAddress,isIgnoredWalletAddress,normalizeAddress,aggregateHoldings,classifyTokenSpam} from '../dist/data.js';
import {decodeToken,decodeHolding,BLOCKSCOUT_LEGACY_HOLDER_NETWORKS} from './provider.mjs';
import {WalletProviderRouter} from './wallet-provider.mjs';
import {getTokenUsdPrice,minimumTokenRawBalance,formatTokenRawAmount} from './token-prices.mjs';

const stamp=()=>new Date().toISOString();
const elapsedMs=(startedAt,endedAt=Date.now())=>{const start=Date.parse(startedAt);return Number.isFinite(start)?Math.max(0,Math.floor(endedAt-start)):0;};
const parse=value=>value?JSON.parse(value):null;
const providerAttemptList=task=>{
 const saved=parse(task.provider_attempts);
 if(Array.isArray(saved)&&saved.length)return saved;
 // Older databases only kept the fallback source/reason and the final provider.
 // Preserve what can be proven without inventing timestamps or attempt details.
 if(!task.provider)return [];
 return [{provider:task.provider,status:task.status==='complete'?'success':task.status==='error'?'failure':task.status==='unsupported'?'unsupported':task.status==='running'?'in_progress':'planned',error:task.error||null,startedAt:null,completedAt:null}];
};
const providerAttemptAt=attempt=>attempt.lastAttemptAt||attempt.completedAt||attempt.startedAt||null;
const FINAL_SCAN_STATUSES=new Set(['complete','complete_with_warnings']);
const taskQuality=t=>{const executionStatus=t.executionStatus||t.status,raw=t.invalid_rows,known=raw!==null&&raw!==undefined&&Number.isInteger(Number(raw))&&Number(raw)>=0,invalidRows=known?Number(raw):null,paginationComplete=executionStatus==='complete'&&!t.error,dataQuality=!paginationComplete||!known?'unknown':invalidRows?'warning':'reliable';return {executionStatus,status:executionStatus==='complete'&&dataQuality==='warning'?'complete_with_warnings':executionStatus,paginationComplete,invalidRows,dataQuality,usableForPopularity:t.kind==='wallets'&&paginationComplete&&dataQuality==='reliable'&&invalidRows===0};};
const knownSum=holdings=>{const priced=holdings.filter(h=>Number.isFinite(h.value));return priced.length?priced.reduce((s,h)=>s+h.value,0):null;};
const positiveInt=(value,fallback)=>Number.isInteger(Number(value))&&Number(value)>0?Number(value):fallback;
const USD_THRESHOLD_EARLY_STOP_NETWORKS=new Set(['robinhood']);
const holderOrderingSupported=(provider,chainId)=>provider==='blockscout_legacy'&&BLOCKSCOUT_LEGACY_HOLDER_NETWORKS.has(chainId)||provider==='blockscout'&&USD_THRESHOLD_EARLY_STOP_NETWORKS.has(chainId);
const providerDisplayName=provider=>provider==='alchemy'?'Alchemy':provider==='blockscout_legacy'?'Blockscout Legacy PRO':provider==='blockscout'?'Blockscout REST v2':provider||'Provider neznámý';
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
  const minPositionUsd=Number(input.minPositionUsd??0);
  if(!Number.isFinite(minPositionUsd)||minPositionUsd<0)throw new Error('Minimální hodnota pozice musí být nezáporná částka v USD.');
  if(minPositionUsd>0)query.minPositionUsd=minPositionUsd;
  const holderCap=input.holderCap===undefined?20000:Number(input.holderCap);
  if(![0,10000,20000,30000,40000,50000].includes(holderCap))throw new Error('Maximální počet holderů musí být 10 000, 20 000, 30 000, 40 000, 50 000 nebo bez limitu.');
  query.holderCap=holderCap;
  if(!Array.isArray(input.tokens)||!input.tokens.length||input.tokens.length>5)throw new Error('Vyberte 1 až 5 kontraktů.');
  query.tokens=[...new Map(input.tokens.map(t=>{if(!isAddress(t.address)||!chainIds.includes(t.chainId))throw new Error('Neplatný kontrakt nebo jeho síť.');const address=t.address.toLowerCase();return [`${t.chainId}:${address}`,{chainId:t.chainId,address}];})).values()].sort((a,b)=>`${a.chainId}:${a.address}`.localeCompare(`${b.chainId}:${b.address}`));
 }else{
  if(!Array.isArray(input.addresses)||!input.addresses.length||input.addresses.some(a=>!isAddress(a)))throw new Error('Vložte alespoň jednu platnou adresu.');
  const submitted=[...new Set(input.addresses.map(a=>a.toLowerCase()))].sort();
  if(submitted.length>SCAN_CONFIG.maxWallets)throw new Error(`Jeden sken může obsahovat nejvýše ${SCAN_CONFIG.maxWallets} unikátních peněženek.`);
  query.excludedSystemAddresses=submitted.filter(isIgnoredWalletAddress);
  query.addresses=submitted.filter(address=>!isIgnoredWalletAddress(address));
  if(!query.addresses.length)throw new Error('Systémovou burn/dead adresu nelze analyzovat; nebyla vytvořena žádná úloha peněženka × síť.');
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
   CREATE TABLE IF NOT EXISTS scans(id TEXT PRIMARY KEY,query_key TEXT NOT NULL,query_json TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,finished_at TEXT,started_at TEXT,paused_at TEXT,run_started_at TEXT,runtime_ms INTEGER DEFAULT 0,message TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0);
   CREATE INDEX IF NOT EXISTS scans_query ON scans(query_key,created_at);
   CREATE TABLE IF NOT EXISTS tasks(scan_id TEXT NOT NULL,task_key TEXT NOT NULL,kind TEXT NOT NULL,chain_id TEXT NOT NULL,address TEXT NOT NULL,status TEXT NOT NULL,metadata TEXT,cursor TEXT,pages INTEGER NOT NULL DEFAULT 0,invalid_rows INTEGER NOT NULL DEFAULT 0,error TEXT,completion_reason TEXT,last_success_at TEXT,PRIMARY KEY(scan_id,task_key),FOREIGN KEY(scan_id) REFERENCES scans(id) ON DELETE CASCADE);
   CREATE TABLE IF NOT EXISTS positions(scan_id TEXT NOT NULL,task_key TEXT NOT NULL,owner TEXT NOT NULL,token_id TEXT NOT NULL,holding TEXT NOT NULL,PRIMARY KEY(scan_id,task_key,owner,token_id),FOREIGN KEY(scan_id,task_key) REFERENCES tasks(scan_id,task_key) ON DELETE CASCADE);
   CREATE INDEX IF NOT EXISTS positions_wallet ON positions(scan_id,owner);
   CREATE TABLE IF NOT EXISTS cursors(scan_id TEXT NOT NULL,task_key TEXT NOT NULL,signature TEXT NOT NULL,PRIMARY KEY(scan_id,task_key,signature),FOREIGN KEY(scan_id,task_key) REFERENCES tasks(scan_id,task_key) ON DELETE CASCADE);
   `);
  const scanColumns=this.db.prepare('PRAGMA table_info(scans)').all().map(c=>c.name);
  if(!scanColumns.includes('started_at'))this.db.exec('ALTER TABLE scans ADD COLUMN started_at TEXT');
  if(!scanColumns.includes('paused_at'))this.db.exec('ALTER TABLE scans ADD COLUMN paused_at TEXT');
  if(!scanColumns.includes('run_started_at'))this.db.exec('ALTER TABLE scans ADD COLUMN run_started_at TEXT');
  if(!scanColumns.includes('runtime_ms'))this.db.exec('ALTER TABLE scans ADD COLUMN runtime_ms INTEGER');
  const columns=this.db.prepare('PRAGMA table_info(tasks)').all().map(c=>c.name);
  if(!columns.includes('provider'))this.db.exec("ALTER TABLE tasks ADD COLUMN provider TEXT NOT NULL DEFAULT 'blockscout'");
  if(!columns.includes('fallback_from'))this.db.exec('ALTER TABLE tasks ADD COLUMN fallback_from TEXT');
  if(!columns.includes('fallback_reason'))this.db.exec('ALTER TABLE tasks ADD COLUMN fallback_reason TEXT');
  if(!columns.includes('as_of'))this.db.exec('ALTER TABLE tasks ADD COLUMN as_of TEXT');
  if(!columns.includes('completion_reason'))this.db.exec('ALTER TABLE tasks ADD COLUMN completion_reason TEXT');
  if(!columns.includes('provider_attempts'))this.db.exec("ALTER TABLE tasks ADD COLUMN provider_attempts TEXT NOT NULL DEFAULT '[]'");
  if(!columns.includes('last_success_at'))this.db.exec('ALTER TABLE tasks ADD COLUMN last_success_at TEXT');
  this.db.exec('UPDATE tasks SET last_success_at=as_of WHERE last_success_at IS NULL AND as_of IS NOT NULL');
  const positionColumns=this.db.prepare('PRAGMA table_info(positions)').all().map(c=>c.name);
  if(!positionColumns.includes('threshold_eligible'))this.db.exec('ALTER TABLE positions ADD COLUMN threshold_eligible INTEGER NOT NULL DEFAULT 1');
  const recoveryTime=Date.now(),recoveryStamp=new Date(recoveryTime).toISOString();
  for(const row of this.db.prepare("SELECT id,runtime_ms,run_started_at FROM scans WHERE status='running'").all()){
   const runtimeMs=row.runtime_ms===null?null:Math.max(0,Number(row.runtime_ms)||0)+(row.run_started_at?elapsedMs(row.run_started_at,recoveryTime):0);
   this.db.prepare("UPDATE scans SET status='paused',message='Server byl restartován. Pokračujte od uložené stránky.',runtime_ms=?,run_started_at=NULL,paused_at=?,updated_at=?,revision=revision+1 WHERE id=?").run(runtimeMs,recoveryStamp,recoveryStamp,row.id);
  }
  this.db.prepare("UPDATE tasks SET status='pending' WHERE status='running'").run();
 }
 get(id){return this.db.prepare('SELECT * FROM scans WHERE id=?').get(id);}
 tasks(id){return this.db.prepare('SELECT * FROM tasks WHERE scan_id=? ORDER BY task_key').all(id).map(t=>({...t,chainId:t.chain_id,cursor:parse(t.cursor),metadata:parse(t.metadata)}));}
 describe(id){
  const row=this.get(id);if(!row)return null;const query=parse(row.query_json);
  if(query.kind==='wallets'){const ignored=(query.addresses||[]).filter(isIgnoredWalletAddress);query.addresses=(query.addresses||[]).filter(address=>!isIgnoredWalletAddress(address));query.excludedSystemAddresses=[...new Set([...(query.excludedSystemAddresses||[]),...ignored])];}
  const ignoredSql=SYSTEM_WALLET_ADDRESSES.map(()=>'?').join(','),taskFilter=query.kind==='wallets'?` AND lower(trim(address)) NOT IN (${ignoredSql})`:'',taskParams=query.kind==='wallets'?SYSTEM_WALLET_ADDRESSES:[];
  const count=this.db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE scan_id=?${taskFilter}`).get(id,...taskParams).n,compact=query.kind==='wallets'&&count>50;
  const all=compact?null:this.tasks(id).filter(task=>task.kind!=='wallets'||!isIgnoredWalletAddress(task.address)),tasks=compact?this.summarizeWalletTasks(id):all;
  const positions=this.db.prepare(`SELECT COUNT(*) AS n FROM positions WHERE scan_id=? AND lower(trim(owner)) NOT IN (${ignoredSql})`).get(id,...SYSTEM_WALLET_ADDRESSES).n;
  const progress=compact?this.db.prepare('SELECT COALESCE(SUM(pages),0) pages FROM tasks WHERE scan_id=?').get(id).pages:all.reduce((s,t)=>s+t.pages,0);
  const completedTasks=this.db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE scan_id=?${taskFilter} AND status='complete'`).get(id,...taskParams).n;
  const quality=this.db.prepare(`SELECT COUNT(*) AS totalTasks,COALESCE(SUM(CASE WHEN status='complete' THEN 1 ELSE 0 END),0) AS completedTasks,COALESCE(SUM(CASE WHEN status='complete' AND invalid_rows=0 THEN 1 ELSE 0 END),0) AS reliableTasks,COALESCE(SUM(CASE WHEN status='complete' AND invalid_rows>0 THEN 1 ELSE 0 END),0) AS warningTasks,COALESCE(SUM(CASE WHEN status!='complete' THEN 1 ELSE 0 END),0) AS unknownTasks,COALESCE(SUM(CASE WHEN status='complete' AND error IS NOT NULL THEN 1 ELSE 0 END),0) AS executionErrors,COALESCE(SUM(invalid_rows),0) AS invalidRows FROM tasks WHERE scan_id=?${taskFilter}`).get(id,...taskParams);
  const completedWallets=query.kind==='wallets'?this.db.prepare(`SELECT COUNT(*) AS n FROM (SELECT address FROM tasks WHERE scan_id=?${taskFilter} GROUP BY address HAVING SUM(CASE WHEN status='complete' THEN 1 ELSE 0 END)=?)`).get(id,...taskParams,query.chainIds.length).n:0;
  const runtimeMs=row.runtime_ms===null?null:Math.max(0,Number(row.runtime_ms)||0)+(row.status==='running'&&row.run_started_at?elapsedMs(row.run_started_at):0);
  const executionComplete=count>0&&quality.completedTasks===quality.totalTasks&&quality.unknownTasks===0&&quality.executionErrors===0;
  // Older wallet scans could persist `partial` solely because invalid rows were
  // treated as execution failures. Derive their presentation status from task
  // completion without mutating historical rows or changing scheduler state.
  const legacyWalletCompletion=row.status==='partial'&&query.kind==='wallets'&&executionComplete;
  const status=legacyWalletCompletion?(quality.warningTasks?'complete_with_warnings':'complete'):row.status;
  const message=legacyWalletCompletion?(quality.warningTasks?'Všechny stránky jsou načtené; část řádků obsahuje upozornění.':'Všechny stránky indexeru jsou načtené.'):row.message;
  return {id,queryFingerprint:row.query_key,status,query,createdAt:row.created_at,startedAt:row.started_at||null,updatedAt:row.updated_at,finishedAt:row.finished_at,pausedAt:row.paused_at||null,runtimeMs,message,revision:row.revision,pages:progress,positions,taskCount:count,quality:{...quality,executionComplete},progress:{completedTasks,totalTasks:count,completedWallets,totalWallets:query.kind==='wallets'?query.addresses.length:0},tasks:tasks.map(t=>{const attempts=providerAttemptList(t),lastAttemptAt=attempts.map(providerAttemptAt).filter(Boolean).sort().at(-1)||null;return {key:t.task_key,kind:t.kind,chainId:t.chainId,address:t.address,provider:t.provider,providerProvidedData:!!t.as_of,providerAttempts:attempts,providerProvenanceComplete:Array.isArray(parse(t.provider_attempts))&&parse(t.provider_attempts).length>0,fallbackUsed:!!t.fallback_from,fallbackFrom:t.fallback_from,fallbackReason:t.fallback_reason,asOf:t.as_of,lastSuccessAt:t.last_success_at||t.as_of,lastAttemptAt,pages:t.pages,complete:t.status==='complete',...taskQuality(t),completionReason:t.completion_reason||null,error:t.error,token:t.metadata,nextPageAvailable:t.status!=='complete',...(t.taskCount?{taskCount:t.taskCount,counts:t.counts}: {})};})};
 }
 summarizeWalletTasks(id){
  return this.db.prepare(`SELECT chain_id,provider,fallback_from,status,CASE WHEN invalid_rows>0 THEN 1 ELSE 0 END has_invalid_rows,COUNT(*) task_count,SUM(pages) pages,SUM(invalid_rows) invalid_rows,MAX(as_of) as_of,MAX(COALESCE(last_success_at,as_of)) last_success_at,MIN(error) error,MIN(fallback_reason) fallback_reason
   FROM tasks WHERE scan_id=? AND lower(trim(address)) NOT IN (${SYSTEM_WALLET_ADDRESSES.map(()=>'?').join(',')}) GROUP BY chain_id,provider,fallback_from,status,CASE WHEN invalid_rows>0 THEN 1 ELSE 0 END ORDER BY chain_id,provider,status,has_invalid_rows`).all(id,...SYSTEM_WALLET_ADDRESSES).map(t=>({task_key:`${t.chain_id}:${t.provider}:${t.status}:${t.has_invalid_rows}`,kind:'wallets',chainId:t.chain_id,provider:t.provider,fallback_from:t.fallback_from,fallback_reason:t.fallback_reason,as_of:t.as_of,lastSuccessAt:t.last_success_at,executionStatus:t.status,status:t.status==='complete'&&t.has_invalid_rows?'complete_with_warnings':t.status,pages:t.pages||0,invalid_rows:t.invalid_rows||0,dataQuality:t.status!=='complete'?'unknown':t.has_invalid_rows?'warning':'reliable',paginationComplete:t.status==='complete',usableForPopularity:t.status==='complete'&&!t.has_invalid_rows,error:t.error,taskCount:t.task_count,counts:{tasks:t.task_count,pages:t.pages||0}}));
 }
 list(){return this.db.prepare('SELECT id FROM scans ORDER BY created_at DESC').all().map(r=>this.describe(r.id));}
 startRuntime(id,message){const now=stamp();this.db.prepare("UPDATE scans SET status='running',message=?,started_at=COALESCE(started_at,?),run_started_at=?,paused_at=NULL,finished_at=NULL,updated_at=?,revision=revision+1 WHERE id=?").run(message,now,now,now,id);}
 stopRuntime(id,status,message,{finished=false}={}){
  const row=this.get(id);if(!row||row.status!=='running')return false;const nowMs=Date.now(),now=new Date(nowMs).toISOString(),delta=row.run_started_at?elapsedMs(row.run_started_at,nowMs):0,runtimeMs=row.runtime_ms===null?null:Math.max(0,Number(row.runtime_ms)||0)+delta;
  this.db.prepare('UPDATE scans SET status=?,message=?,runtime_ms=?,run_started_at=NULL,paused_at=?,finished_at=?,updated_at=?,revision=revision+1 WHERE id=?').run(status,message,runtimeMs,finished?null:now,finished?now:null,now,id);return true;
 }
 touch(id,status,message){this.db.prepare('UPDATE scans SET status=?,message=?,updated_at=?,revision=revision+1 WHERE id=?').run(status,message,stamp(),id);}
 close(){this.db.close();}
}
export class ScanEngine{
 constructor({filename,store,provider=new WalletProviderRouter(),priceResolver=getTokenUsdPrice,cacheMs=15*60*1000,taskConcurrency=SCAN_CONFIG.taskConcurrency}={}){this.store=store||new ScanStore(filename);this.provider=provider;this.priceResolver=priceResolver;this.cacheMs=cacheMs;this.active=new Map();this.taskConcurrency=positiveInt(taskConcurrency,SCAN_CONFIG.taskConcurrency);this.tokenCache=new Map();}
 start(input){
  const query=validateQuery(input),json=JSON.stringify(query),key=createHash('sha256').update(json+(this.provider.cacheKey?.(query.kind)||'')).digest('hex');
  this.provider.validate?.(query);
  // A query fingerprint is exclusive while its scan is still actionable. Keep this
  // lookup synchronous with creation so a rapid/double submit cannot fork a job.
  const active=this.store.db.prepare("SELECT * FROM scans WHERE query_key=? AND status IN ('running','paused','pending') ORDER BY created_at DESC LIMIT 1").get(key);
  if(active)return {...this.store.describe(active.id),duplicateActive:true};
  if(!input.refresh){
   const previous=this.store.db.prepare('SELECT * FROM scans WHERE query_key=? ORDER BY created_at DESC LIMIT 1').get(key);
   if(previous&&(!FINAL_SCAN_STATUSES.has(previous.status)||Date.now()-Date.parse(previous.finished_at)<this.cacheMs)){
    if(!FINAL_SCAN_STATUSES.has(previous.status))this.resume(previous.id);return {...this.store.describe(previous.id),cached:FINAL_SCAN_STATUSES.has(previous.status)};
   }
  }
  const id=randomUUID(),now=stamp(),db=this.store.db;
  const tasks=query.kind==='holders'?query.tokens.map(t=>({...t,kind:'holders'})):query.addresses.flatMap(address=>query.chainIds.map(chainId=>({kind:'wallets',address,chainId})));
  db.exec('BEGIN');try{
   db.prepare('INSERT INTO scans(id,query_key,query_json,status,created_at,updated_at,runtime_ms) VALUES(?,?,?,?,?,?,0)').run(id,key,json,'paused',now,now);
   const insert=db.prepare('INSERT INTO tasks(scan_id,task_key,kind,chain_id,address,status,error,provider,fallback_from,fallback_reason,provider_attempts) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
   for(const t of tasks){t.requestedProvider=query.provider||'auto';const route=this.provider.route?.(t);const supported=this.provider.supports?.(t)??getNetwork(t.chainId).live;insert.run(id,`${t.chainId}:${t.address}`,t.kind,t.chainId,t.address,supported?'pending':'unsupported',supported?null:`${getNetwork(t.chainId).name}: zvolený zdroj nepodporuje tuto operaci nebo síť.`,route?.provider||this.provider.choose?.(t)||'blockscout',route?.fallbackFrom||null,route?.fallbackReason||null,'[]');}
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  this.resume(id);return this.store.describe(id);
 }
 repeat(id){
  const original=this.store.get(id);
  if(!original){const error=new Error('Sken nebyl nalezen.');error.status=404;throw error;}
  const query=parse(original.query_json);
  if(query?.kind!=='holders'){const error=new Error('Zopakovat lze pouze Token Screener scan.');error.status=400;throw error;}
  // Stored query_json is the source of truth; refresh forces a new snapshot even
  // when a completed run with the same fingerprint is still inside the cache TTL.
  return this.start({...query,refresh:true});
 }
 resume(id){
  const job=this.store.get(id);if(!job)throw new Error('Sken nebyl nalezen.');
  if(this.active.has(id)||FINAL_SCAN_STATUSES.has(job.status))return this.store.describe(id);
  if(this.active.size>=2){const error=new Error('Běží dva skeny. Nejdříve některý pozastavte.');error.status=409;throw error;}
  this.store.db.prepare("UPDATE tasks SET status='pending',error=NULL WHERE scan_id=? AND status IN ('error','pending')").run(id);
  this.store.startRuntime(id,'Načítám další stránky indexeru…');
  const controller=new AbortController();const entry={controller,promise:null};this.active.set(id,entry);
  entry.promise=this.work(id,controller.signal).finally(()=>{this.store.db.prepare("UPDATE tasks SET status='pending' WHERE scan_id=? AND status='running'").run(id);this.active.delete(id);});
  return this.store.describe(id);
 }
 async pause(id){const entry=this.active.get(id);if(entry){if(this.store.stopRuntime(id,'paused','Pozastaveno. Načtené stránky jsou uložené.'))entry.controller.abort();await entry.promise;}return this.store.describe(id);}
 remove(id){
  const job=this.store.get(id);
  if(!job){const error=new Error('Sken nebyl nalezen.');error.status=404;throw error;}
  if(job.status==='running'||this.active.has(id)){const error=new Error('Běžící sken nelze smazat. Nejprve jej pozastavte a počkejte na dokončení zastavení.');error.status=409;throw error;}
  // One atomic DELETE; foreign keys cascade through tasks to positions and cursors.
  this.store.db.prepare('DELETE FROM scans WHERE id=?').run(id);
  return {id,deleted:true};
 }
 removeAll(){
  const db=this.store.db;db.exec('BEGIN IMMEDIATE');
  try{
   if(this.active.size||db.prepare("SELECT 1 FROM scans WHERE status='running' LIMIT 1").get()){
    const error=new Error('Nejdřív pozastavte běžící skeny.');error.status=409;throw error;
   }
   const ids=db.prepare('SELECT id FROM scans ORDER BY created_at DESC').all().map(row=>row.id);
   db.prepare('DELETE FROM scans').run();db.exec('COMMIT');
   return {deleted:ids.length,ids};
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 async work(id,signal){
  try{
   const worker=async()=>{for(;;){signal.throwIfAborted();const task=this.claimTask(id);if(!task)return;await this.processTask(id,task,signal);}};
   const outcomes=await Promise.allSettled(Array.from({length:this.taskConcurrency},worker));
   if(signal.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
   const failed=outcomes.find(o=>o.status==='rejected');if(failed)throw failed.reason;
   signal.throwIfAborted();const tasks=this.store.tasks(id),executionComplete=tasks.every(t=>t.status==='complete'),hasWarnings=tasks.some(t=>Number(t.invalid_rows)>0),status=executionComplete?(hasWarnings?'complete_with_warnings':'complete'):'partial';
   const finalized=this.store.stopRuntime(id,status,executionComplete?(hasWarnings?'Všechny stránky načteny; část pozic nebylo možné interpretovat.':'Všechny stránky indexeru jsou načtené.'):'Částečný sken. Uložená data lze otevřít nebo pokračovat.',{finished:true});
   if(finalized&&executionComplete&&this.store.describe(id)?.query.kind==='wallets'&&this.onScanFinished){try{this.onScanFinished(id,status);}catch{/* A dashboard snapshot failure must not change scan completion. */}}
  }catch(error){if(!signal.aborted)this.store.stopRuntime(id,'partial',error.message,{finished:true});}
 }
 claimTask(id){
  const db=this.store.db;const task=db.prepare("SELECT * FROM tasks WHERE scan_id=? AND status='pending' ORDER BY task_key LIMIT 1").get(id);if(!task)return null;
  // A newly created pending task has made no provider attempt yet. Avoid the
  // legacy display fallback in providerAttemptList(), which would otherwise
  // synthesize a `planned` item and persist it as if it were an actual attempt.
  const savedAttempts=parse(task.provider_attempts),attempts=Array.isArray(savedAttempts)?savedAttempts:providerAttemptList(task),last=attempts.at(-1),now=stamp();
  if(!last||last.provider!==task.provider||last.status!=='in_progress')attempts.push({provider:task.provider,status:'in_progress',startedAt:now,lastAttemptAt:now,completedAt:null,error:null});
  else if(!last.startedAt)last.startedAt=now;
  // Compare-and-set claim: the guarded UPDATE, not the preceding SELECT, grants
  // ownership. SQLite serializes writers and exactly one worker can change 1 row.
  const claimed=db.prepare("UPDATE tasks SET status='running',provider_attempts=? WHERE scan_id=? AND task_key=? AND status='pending'").run(JSON.stringify(attempts),id,task.task_key);if(claimed.changes!==1)return null;
  return {...task,chainId:task.chain_id,cursor:parse(task.cursor),metadata:parse(task.metadata),providerAttempts:attempts};
 }
 async processTask(id,task,signal){
  for(;;){signal.throwIfAborted();try{
   if(task.kind==='holders'&&!task.metadata){this.markProviderRequest(id,task);task.metadata=await this.provider.metadata(task,signal);const scanQuery=this.store.describe(id)?.query||{},threshold=scanQuery.minPositionUsd||0,holderCap=Number(scanQuery.holderCap)||0;task.metadata={...task.metadata,holderCap,holdersAccepted:0,truncatedByHolderCap:false,orderingVerified:false,...(holderCap>0&&!holderOrderingSupported(task.provider,task.chainId)?{holderCapDisabledReason:`Pořadí držitelů není ověřeno pro síť ${getNetwork(task.chainId).name} / ${task.provider}.`}:{})};if(threshold>0){const quote=await this.priceResolver(task.chainId,task.address,{signal});task.metadata={...task.metadata,minPositionUsd:threshold,priceUsd:quote?.priceUsd??null,priceSource:quote?.priceSource??null,priceAsOf:quote?.priceAsOf??null};if(quote?.priceUsd){task.metadata.price=quote.priceUsd;const raw=minimumTokenRawBalance(threshold,quote.priceUsd,task.metadata.decimals);task.metadata.minRawBalance=raw?.toString()??null;task.metadata.minTokenAmount=raw===null?null:formatTokenRawAmount(raw,task.metadata.decimals);}}this.store.db.prepare('UPDATE tasks SET metadata=? WHERE scan_id=? AND task_key=?').run(JSON.stringify(task.metadata),id,task.task_key);}
   this.markProviderRequest(id,task);const page=await this.provider.page(task,signal);signal.throwIfAborted();const committed=this.commitPage(id,task,page);this.tokenCache.delete(id);
  const summary=this.store.describe(id),thresholdProgress=task.metadata?.minPositionUsd?task.metadata.priceUsd?` · cena $${Number(task.metadata.priceUsd).toPrecision(5)} · minimum ${task.metadata.minTokenAmount||'—'} ${task.metadata.symbol||'tokenů'}`:' · Cena neznámá – threshold nelze použít':'',capProgress=task.metadata?.holderCap?` · limit ${Number(task.metadata.holderCap).toLocaleString('cs-CZ')} holderů / token`:'';this.store.touch(id,'running',`${getNetwork(task.chainId).name} · ${task.metadata?.symbol||task.address.slice(0,10)}${thresholdProgress}${capProgress} · ${summary.pages} stran · ${summary.positions} pozic uloženo`);
   if(committed.stopped){const detail=committed.completionReason==='holder_cap'?`Top ${Number(task.metadata.holderCap).toLocaleString('cs-CZ')} holders · limit dosažen · ${Number(task.metadata.holdersAccepted||0).toLocaleString('cs-CZ')} relevantních holders`:`dokončeno při hranici $${task.metadata.minPositionUsd} · ${Number(task.metadata.thresholdDiagnostics?.holdersAccepted||0).toLocaleString('cs-CZ')} relevantních holders`;this.store.touch(id,'running',`${getNetwork(task.chainId).name} · ${task.metadata?.symbol||task.address.slice(0,10)} · ${detail}`);return;}
   if(!page.cursor)return;task.cursor=page.cursor;task.status='pending';return;
  }catch(error){if(signal.aborted)throw error;const fallback=this.provider.fallback?.(task,error);if(fallback){const db=this.store.db;db.exec('BEGIN');try{
    db.prepare('DELETE FROM positions WHERE scan_id=? AND task_key=?').run(id,task.task_key);db.prepare('DELETE FROM cursors WHERE scan_id=? AND task_key=?').run(id,task.task_key);
    if(task.metadata){delete task.metadata.lastHolderBalance;delete task.metadata.holderOrderingVerified;delete task.metadata.orderingVerified;delete task.metadata.earlyStopDisabledReason;delete task.metadata.holderCapDiagnostics;delete task.metadata.holdersAccepted;delete task.metadata.truncatedByHolderCap;delete task.metadata.holderCapDisabledReason;delete task.metadata.thresholdDiagnostics;if(Number(task.metadata.holderCap)>0&&!holderOrderingSupported(fallback,task.chainId))task.metadata.holderCapDisabledReason=`Pořadí držitelů není ověřeno pro síť ${getNetwork(task.chainId).name} / ${fallback}.`;db.prepare('UPDATE tasks SET metadata=? WHERE scan_id=? AND task_key=?').run(JSON.stringify(task.metadata),id,task.task_key);}
   const failedAttempt=task.providerAttempts?.at(-1);if(failedAttempt){failedAttempt.status=error.retryable?'retryable_failure':'failure';failedAttempt.error=error.message;failedAttempt.completedAt=stamp();failedAttempt.lastAttemptAt=failedAttempt.completedAt;}
    const fallbackReason=this.provider.fallbackReason?.(task,error)||error.message;task.providerAttempts=[...(task.providerAttempts||[]),{provider:fallback,status:'in_progress',startedAt:stamp(),completedAt:null,error:null}];
    const switched=db.prepare("UPDATE tasks SET provider=?,fallback_from=?,fallback_reason=?,provider_attempts=?,as_of=NULL,last_success_at=CASE WHEN kind='holders' THEN NULL ELSE last_success_at END,cursor=NULL,pages=0,invalid_rows=0,status='running',error=NULL WHERE scan_id=? AND task_key=? AND status='running'").run(fallback,task.provider,fallbackReason,JSON.stringify(task.providerAttempts),id,task.task_key);if(switched.changes!==1)throw new Error('Task již nevlastní aktuální worker; fallback nebyl spuštěn.');db.exec('COMMIT');
   }catch(resetError){db.exec('ROLLBACK');throw resetError;}
   this.store.touch(id,'running',`${getNetwork(task.chainId).name}: přepínám na ${providerDisplayName(fallback)} od první stránky. ${error.message}`);task.provider=fallback;task.cursor=null;continue;
   }
   const finalError=error.message+(this.provider.fallbackUnavailable?.(task)||'');const lastAttempt=task.providerAttempts?.at(-1);if(lastAttempt){lastAttempt.status='failure';lastAttempt.error=finalError;lastAttempt.completedAt=stamp();lastAttempt.lastAttemptAt=lastAttempt.completedAt;}
   this.store.db.prepare("UPDATE tasks SET status='error',error=?,provider_attempts=? WHERE scan_id=? AND task_key=? AND status='running'").run(finalError,JSON.stringify(task.providerAttempts||[]),id,task.task_key);return;
  }}
 }
 markProviderRequest(id,task){const attempt=task.providerAttempts?.at(-1);if(!attempt)return;attempt.lastAttemptAt=stamp();this.store.db.prepare("UPDATE tasks SET provider_attempts=? WHERE scan_id=? AND task_key=? AND status='running'").run(JSON.stringify(task.providerAttempts),id,task.task_key);}
 commitPage(id,task,page){
  const db=this.store.db,signature=JSON.stringify(task.cursor||{});
  if(page.cursor&&typeof page.cursor!=='object')throw new Error('Neplatný kurzor další stránky.');
  const next=page.cursor?JSON.stringify(page.cursor):null;
  if(next&&(next===signature||db.prepare('SELECT 1 FROM cursors WHERE scan_id=? AND task_key=? AND signature=?').get(id,task.task_key,next)))throw new Error('Indexer opakuje kurzor. Sken zůstává částečný.');
  const rows=[];let invalid=0;
  const thresholdRaw=task.kind==='holders'&&task.metadata?.minRawBalance?BigInt(task.metadata.minRawBalance):null;
  const holderCap=task.kind==='holders'?Number(task.metadata?.holderCap)||0:0;
  const verifyOrdering=task.kind==='holders'&&(thresholdRaw!==null||holderCap>0)&&holderOrderingSupported(task.provider,task.chainId)&&!task.metadata.earlyStopDisabledReason;
  const capItems=task.kind==='holders'?page.items.filter(item=>{const address=normalizeAddress(item.address?.hash||item.address_hash||item.address||'');return address&&!isIgnoredWalletAddress(address);}):page.items;
  let orderingFailure=null,stopAtThreshold=false,stopAtHolderCap=false,thresholdBoundarySeen=false;
  if(verifyOrdering){
   const balances=capItems.map(item=>/^\d+$/.test(String(item.value??''))?BigInt(String(item.value)):null);
   if(balances.some(value=>value===null))orderingFailure='odpověď obsahovala nečíselný balance';
   else if(balances.some((value,index)=>index>0&&balances[index-1]<value))orderingFailure='zůstatky na stránce nebyly sestupné';
   else if(task.metadata.lastHolderBalance!==undefined&&balances.length&&BigInt(task.metadata.lastHolderBalance)<balances[0])orderingFailure='pořadí mezi stránkami nebylo sestupné';
   else{
    task.metadata.holderOrderingVerified=true;
    if(balances.length)task.metadata.lastHolderBalance=balances.at(-1).toString();
   }
  if(orderingFailure){task.metadata.holderOrderingVerified=false;task.metadata.earlyStopDisabledReason=orderingFailure;if(holderCap>0)task.metadata.holderCapDisabledReason=orderingFailure;}
  }
  let holdersAcceptedBefore=0;
  const ignoredSql=SYSTEM_WALLET_ADDRESSES.map(()=>'?').join(',');
  if(task.kind==='holders'&&holderCap>0){holdersAcceptedBefore=db.prepare(`SELECT COUNT(*) AS n FROM positions WHERE scan_id=? AND task_key=? AND threshold_eligible=1 AND lower(trim(owner)) NOT IN (${ignoredSql})`).get(id,task.task_key,...SYSTEM_WALLET_ADDRESSES).n;}
  const pageOwners=holderCap>0&&verifyOrdering&&!orderingFailure&&!task.metadata.holderCapDisabledReason?[...new Set(capItems.map(item=>normalizeAddress(item.address?.hash||item.address_hash||item.address||'')).filter(Boolean))]:[];
  const alreadyAcceptedOwners=pageOwners.length?new Set(db.prepare(`SELECT owner FROM positions WHERE scan_id=? AND task_key=? AND threshold_eligible=1 AND owner IN (${pageOwners.map(()=>'?').join(',')})`).all(id,task.task_key,...pageOwners).map(row=>row.owner)):new Set();
  let holdersAccepted=holdersAcceptedBefore;const acceptedThisPage=new Set();
  for(const item of page.items){try{
   const token=task.kind==='holders'?task.metadata:decodeToken(item.token||{},task.chainId);
   const owner=task.kind==='holders'?normalizeAddress(item.address?.hash||item.address_hash||item.address||''):task.address;
   if(!isAddress(owner))throw new Error('Neplatná adresa držitele.');
   if(task.kind==='holders'&&isIgnoredWalletAddress(owner))continue;
   const thresholdEligible=task.kind!=='holders'||!task.metadata?.minRawBalance||BigInt(String(item.value))>=BigInt(task.metadata.minRawBalance);
   const holding=decodeHolding(token,item.value);if(!holding)continue;
   if(task.kind==='holders'&&thresholdRaw!==null&&verifyOrdering&&!orderingFailure&&page.cursor&&!thresholdBoundarySeen&&BigInt(String(item.value))<thresholdRaw){thresholdBoundarySeen=true;stopAtThreshold=true;}
   const safeCap=holderCap>0&&verifyOrdering&&!orderingFailure&&!task.metadata.holderCapDisabledReason&&!thresholdBoundarySeen;
   if(safeCap&&thresholdEligible&&!acceptedThisPage.has(owner)){
    if(!alreadyAcceptedOwners.has(owner)){
     if(holdersAccepted>=holderCap){stopAtHolderCap=true;break;}
     holdersAccepted++;acceptedThisPage.add(owner);
     rows.push({owner,holding,thresholdEligible:1});
     if(holdersAccepted>=holderCap){stopAtHolderCap=true;break;}
     continue;
    }
   }
   rows.push({owner,holding,thresholdEligible:thresholdEligible?1:0});
  }catch{invalid++;}}
  db.exec('BEGIN');try{
   const insert=db.prepare('INSERT OR IGNORE INTO positions(scan_id,task_key,owner,token_id,holding,threshold_eligible) VALUES(?,?,?,?,?,?)');
   for(const row of rows)insert.run(id,task.task_key,row.owner,row.holding.tokenId,JSON.stringify(row.holding),row.thresholdEligible);
   db.prepare('INSERT OR IGNORE INTO cursors(scan_id,task_key,signature) VALUES(?,?,?)').run(id,task.task_key,signature);
   if(task.metadata?.minPositionUsd&&task.metadata?.minRawBalance){
    const holdersAccepted=db.prepare(`SELECT COUNT(*) AS n FROM positions WHERE scan_id=? AND task_key=? AND threshold_eligible=1 AND lower(trim(owner)) NOT IN (${ignoredSql})`).get(id,task.task_key,...SYSTEM_WALLET_ADDRESSES).n;
    task.metadata.thresholdDiagnostics={thresholdUsd:task.metadata.minPositionUsd,frozenPriceUsd:task.metadata.priceUsd,priceSource:task.metadata.priceSource,priceAsOf:task.metadata.priceAsOf,minimumTokenBalance:task.metadata.minTokenAmount,pagesFetched:Number(task.pages||0)+1,holdersAccepted,orderingVerified:!!task.metadata.holderOrderingVerified,earlyStopDisabledReason:task.metadata.earlyStopDisabledReason||null};
   }
   if(task.kind==='holders'){
    const acceptedCount=db.prepare(`SELECT COUNT(*) AS n FROM positions WHERE scan_id=? AND task_key=? AND threshold_eligible=1 AND lower(trim(owner)) NOT IN (${ignoredSql})`).get(id,task.task_key,...SYSTEM_WALLET_ADDRESSES).n;
    task.metadata.holdersAccepted=acceptedCount;task.metadata.orderingVerified=!!task.metadata.holderOrderingVerified;
    task.metadata.truncatedByHolderCap=!!stopAtHolderCap;
    task.metadata.holderCapDiagnostics={holderCap:holderCap||null,holdersAccepted:acceptedCount,truncatedByHolderCap:!!stopAtHolderCap,orderingVerified:!!task.metadata.holderOrderingVerified,disabledReason:task.metadata.holderCapDisabledReason||null};
   }
   const completionReason=stopAtThreshold?'usd_threshold':stopAtHolderCap?'holder_cap':!next&&task.kind==='holders'?'all_holders':null,taskStatus=stopAtThreshold||stopAtHolderCap||!next?'complete':'pending',nextCursor=stopAtThreshold||stopAtHolderCap?null:next,dataFetchedAt=stamp();
   if(task.providerAttempts?.length){const last=task.providerAttempts.at(-1);last.lastAttemptAt=dataFetchedAt;if(taskStatus==='complete'){last.status='success';last.error=null;last.completedAt=dataFetchedAt;}}
   if(task.kind==='holders')db.prepare('UPDATE tasks SET metadata=? WHERE scan_id=? AND task_key=?').run(JSON.stringify(task.metadata),id,task.task_key);
   const committed=db.prepare("UPDATE tasks SET cursor=?,pages=pages+1,invalid_rows=invalid_rows+?,status=?,as_of=?,last_success_at=?,completion_reason=?,provider_attempts=? WHERE scan_id=? AND task_key=? AND status='running'").run(nextCursor,invalid,taskStatus,dataFetchedAt,dataFetchedAt,completionReason,JSON.stringify(task.providerAttempts||[]),id,task.task_key);if(committed.changes!==1)throw new Error('Task již nevlastní aktuální worker; stránka nebyla uložena.');
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return {stopped:stopAtThreshold||stopAtHolderCap,completionReason:stopAtThreshold?'usd_threshold':stopAtHolderCap?'holder_cap':null,orderingFailure};
 }
 result(id,{offset=0,limit=100,revision,view='wallets',sort='holders',minHolders=0,minShare=0,chainId='',search='',hideSpam=true}={}){
  const job=this.store.describe(id);if(!job)throw new Error('Sken nebyl nalezen.');
  if(revision!==undefined&&Number(revision)!==job.revision){const error=new Error('Výsledky se změnily. Otevřete sken znovu.');error.status=409;throw error;}
  offset=Math.max(0,Math.floor(Number(offset)||0));limit=Math.min(200,Math.max(1,Math.floor(Number(limit)||100)));
  if(job.query.kind==='wallets'&&view==='tokens')return this.tokenResults(id,job,{offset,limit,revision,sort,minHolders,minShare,chainId,search,hideSpam});
  const db=this.store.db,query=job.query,required=query.kind==='holders'&&query.match==='all'?query.tokens.length:1,ignoredSql=SYSTEM_WALLET_ADDRESSES.map(()=>'?').join(',');
  const thresholdActive=query.kind==='holders'&&query.minPositionUsd?1:0,grouped=`SELECT owner FROM positions WHERE scan_id=? AND lower(trim(owner)) NOT IN (${ignoredSql}) AND (?=0 OR threshold_eligible=1) GROUP BY owner HAVING COUNT(DISTINCT token_id)>=?`;
  const taskRows=this.store.tasks(id).filter(task=>task.kind!=='wallets'||!isIgnoredWalletAddress(task.address));
  const successful=query.kind==='wallets'?query.addresses.filter(address=>!isIgnoredWalletAddress(address)&&taskRows.some(t=>t.address===address&&t.status==='complete')):null;
  const total=successful?successful.length:db.prepare(`SELECT COUNT(*) AS n FROM (${grouped})`).get(id,...SYSTEM_WALLET_ADDRESSES,thresholdActive,required).n;
  const owners=successful?successful.slice(offset,offset+limit):db.prepare(`${grouped} ORDER BY owner LIMIT ? OFFSET ?`).all(id,...SYSTEM_WALLET_ADDRESSES,thresholdActive,required,limit,offset).map(r=>r.owner);
  // Holder scans select owners from the positions already fetched, even while
  // their cursor task is still running/pending/failed. Hydrate from those same
  // persisted rows so a confirmed holder can never turn into empty holdings.
  // Wallet Analyzer keeps its existing rule: only completed wallet tasks are
  // returned as portfolios.
  const requireCompletedTask=query.kind==='holders'?0:1;
  const rows=owners.length?db.prepare(`SELECT p.owner,p.holding FROM positions p JOIN tasks t ON t.scan_id=p.scan_id AND t.task_key=p.task_key WHERE p.scan_id=? AND (?=0 OR t.status='complete') AND (?=0 OR p.threshold_eligible=1) AND lower(trim(p.owner)) NOT IN (${ignoredSql}) AND p.owner IN (${owners.map(()=>'?').join(',')}) ORDER BY p.owner,p.token_id`).all(id,requireCompletedTask,thresholdActive,...SYSTEM_WALLET_ADDRESSES,...owners):[];
  const map=new Map(owners.map(address=>[address,{address,label:null,isDemo:false,holdings:[]} ]));
  for(const r of rows)map.get(r.owner).holdings.push(parse(r.holding));
  const metadata=new Map((query.walletMetadata||[]).map(w=>[w.address,w]));
  const wallets=[...map.values()].map(w=>({...w,...(metadata.has(w.address)?{smartWallet:metadata.get(w.address)}:{}),value:w.holdings.length?knownSum(w.holdings):0,chainIds:[...new Set(w.holdings.map(h=>h.chainId))],matchedTokens:query.kind==='holders'?w.holdings.map(h=>taskRows.find(t=>t.metadata?.id===h.tokenId)?.metadata).filter(Boolean):[],matchCount:query.kind==='holders'?w.holdings.length:0}));
  const warnings=[...(query.excludedSystemAddresses||[]).map(()=>`Systémová burn/dead adresa byla přeskočena; nebyly pro ni vytvořeny žádné úlohy.`),...taskRows.flatMap(t=>[...(query.minPositionUsd&&!t.metadata?.priceUsd?[`${t.metadata?.symbol||t.address}: Cena neznámá – threshold nebylo možné použít; načetli jsme všechny holders.`]:[]),...(query.minPositionUsd&&t.metadata?.priceUsd&&!t.metadata?.minRawBalance?[`${t.metadata?.symbol||t.address}: decimals nebo zůstatek nebylo možné bezpečně přepočítat; pozice nebyly filtrovány.`]:[]),...(t.error?[`${getNetwork(t.chainId).name}: ${t.error}`]:[]),...(t.invalid_rows?[`${t.invalid_rows} neinterpretovaných řádků nebylo možné zahrnout.`]:[])])];
  if(query.kind==='holders'&&query.minPositionUsd){const stopped=taskRows.filter(t=>t.completion_reason==='usd_threshold').length,disabled=taskRows.filter(t=>t.metadata?.earlyStopDisabledReason).length;warnings.unshift(stopped?`USD threshold ukončil ${stopped} tokenových úloh po ověření sestupného pořadí. Korelace zahrnuje pouze pozice nad limitem a raw pozice zůstávají uložené.`:disabled?'Pořadí holderů nebylo spolehlivé, proto byl early-stop vypnut a načetli jsme celé seznamy. USD limit ovlivňuje výsledkovou korelaci.':'USD limit ovlivňuje výsledkovou korelaci. Early-stop používá pouze ověřené sestupné pořadí; jinak se načtou celé seznamy.');}
  if(query.kind==='holders'&&query.holderCap>0){const capped=taskRows.filter(t=>t.completion_reason==='holder_cap'),disabled=taskRows.filter(t=>t.status==='complete'&&t.completion_reason==='all_holders'&&t.metadata?.holderCapDisabledReason);if(capped.length)warnings.unshift(`Výsledek používá Top ${Number(query.holderCap).toLocaleString('cs-CZ')} holders u ${capped.length} z ${query.tokens.length} tokenů. Korelace nemusí zahrnovat menší držitele mimo tento rozsah.`);if(disabled.length)warnings.unshift(`Limit holderů nebylo možné bezpečně použít u ${disabled.length} tokenů, protože pořadí není ověřeno; jejich kompletní holder list byl načten.`);}
  if(job.status==='running')warnings.unshift(query.kind==='holders'?'Průběžný výsledek. Zahrnuje potvrzené pozice z již načtených holder stránek; holder listy se stále načítají a další wallets mohou přibýt.':'Průběžný výsledek. Data a průnik pokrývají pouze dosud dokončené úlohy a mohou se změnit.');
  else if(job.status==='paused')warnings.unshift(query.kind==='holders'?'Sken je pozastavený. Výsledek obsahuje potvrzené pozice z již načtených holder stránek; holder list není kompletní a po pokračování mohou přibýt další wallets.':'Sken je pozastavený. Výsledky pokrývají pouze dosud dokončené úlohy; sken lze později obnovit.');
  else if(job.status==='partial')warnings.unshift(query.kind==='holders'?'Sken skončil neúplně. Výsledek obsahuje potvrzené pozice z načtené části holder listů; další wallets mohou zůstat za kurzorem.':'Sken skončil s neúplnými daty. Výsledky pokrývají pouze úspěšně dokončené úlohy.');
  const coverage=this.coverage(id,job,taskRows);
  const providerLabel=[...new Set(taskRows.filter(t=>t.as_of).map(t=>providerDisplayName(t.provider)))].join(' + ')||'Provider dosud nedodal data';coverage.providerLabel=providerLabel;
  return {wallets,tokens:query.kind==='holders'?taskRows.map(t=>t.metadata).filter(Boolean):aggregateHoldings(wallets,query.addresses.length),source:'live',warnings,coverage,resultPartial:query.kind==='holders'&&['running','paused','partial'].includes(job.status),job,pagination:{offset,limit,total,nextOffset:offset+owners.length<total?offset+owners.length:null,revision:job.revision}};
 }
 coverage(id,job,taskRows=this.store.tasks(id)){
  taskRows=taskRows.filter(t=>t.kind!=='wallets'||!isIgnoredWalletAddress(t.address));
  const query=job.query,chainCoverage=query.kind==='wallets'?query.chainIds.map(id=>{const relevant=taskRows.filter(t=>t.chainId===id),analyzed=relevant.filter(t=>t.status==='complete').length,reliableWalletCount=relevant.filter(t=>taskQuality(t).usableForPopularity).length,warningWalletCount=relevant.filter(t=>t.status==='complete'&&Number(t.invalid_rows)>0).length;return {chainId:id,analyzed,requested:query.addresses.length,share:query.addresses.length?analyzed/query.addresses.length:0,reliableWalletCount,warningWalletCount,unknownWalletCount:Math.max(0,query.addresses.length-analyzed),reliableShare:query.addresses.length?reliableWalletCount/query.addresses.length:0};}):[];
  const fullyCompletedAddresses=query.kind==='wallets'?query.addresses.filter(address=>query.chainIds.every(chain=>taskRows.some(t=>t.address===address&&t.chainId===chain&&t.status==='complete'))):[];
  const quality={totalTasks:taskRows.length,completedTasks:taskRows.filter(t=>t.status==='complete').length,reliableTasks:taskRows.filter(t=>taskQuality(t).usableForPopularity).length,warningTasks:taskRows.filter(t=>t.status==='complete'&&Number(t.invalid_rows)>0).length,unknownTasks:taskRows.filter(t=>t.status!=='complete').length,invalidRows:taskRows.reduce((sum,t)=>sum+Math.max(0,Number(t.invalid_rows)||0),0)};
  const providers=new Map();for(const t of taskRows){const attempts=providerAttemptList(t),attemptPath=attempts.map(a=>`${a.provider}:${a.status}`).join('>'),hasInvalidRows=Number(t.invalid_rows)>0,key=[t.chain_id||t.chainId,t.provider,t.fallback_from,t.status,attemptPath,hasInvalidRows].join(':');if(!providers.has(key))providers.set(key,{chainId:t.chain_id||t.chainId,provider:t.status==='unsupported'||!t.as_of?null:t.provider,providerProvidedData:!!t.as_of,providerAttempts:attempts,providerProvenanceComplete:Array.isArray(parse(t.provider_attempts))&&parse(t.provider_attempts).length>0,fallbackUsed:!!t.fallback_from,fallbackFrom:t.fallback_from,fallbackReason:t.fallback_reason,asOf:t.as_of,lastSuccessAt:t.last_success_at||t.as_of,status:t.status,dataQuality:t.status!=='complete'?'unknown':hasInvalidRows?'warning':'reliable',invalidRows:0,error:t.error,taskCount:0});const p=providers.get(key);p.taskCount++;p.invalidRows+=Number(t.invalid_rows)||0;const successfulAt=t.last_success_at||t.as_of;if(successfulAt&&(!p.lastSuccessAt||successfulAt>p.lastSuccessAt))p.lastSuccessAt=successfulAt;if(t.error)p.error=t.error;}
  const failures=taskRows.filter(t=>t.status==='error'||t.status==='unsupported').map(t=>({chainId:t.chainId,address:t.address,status:t.status,error:t.error,provider:t.provider,fallbackFrom:t.fallback_from}));
  const analyzedWalletCount=query.kind==='wallets'?fullyCompletedAddresses.length:0,requestedWalletCount=query.kind==='wallets'?query.addresses.length:0,terminal=FINAL_SCAN_STATUSES.has(job.status);
  const networkText=chainCoverage.map(n=>`${getNetwork(n.chainId).name} coverage ${n.analyzed}/${n.requested}, spolehlivé ${n.reliableWalletCount}`).join(' · ');
  const dataQuality=quality.unknownTasks?(quality.warningTasks?'mixed':'unknown'):quality.warningTasks?'warning':'reliable';
  const lastSuccessAt=taskRows.map(t=>t.last_success_at||t.as_of).filter(Boolean).sort().at(-1)||null,lastAttemptAt=taskRows.flatMap(t=>providerAttemptList(t).map(providerAttemptAt)).filter(Boolean).sort().at(-1)||null;
  return {source:'live',complete:terminal,executionComplete:quality.completedTasks===quality.totalTasks,dataQuality,quality,bounded:!terminal,asOf:lastSuccessAt,lastSuccessAt,lastAttemptAt,startedAt:job.startedAt||job.createdAt,snapshotConsistent:false,details:failures.length<=50?failures:failures.slice(0,50),provenance:[...providers.values()],analyzedWalletCount,requestedWalletCount,reliableWalletCount:query.kind==='wallets'?query.addresses.filter(address=>query.chainIds.every(chain=>taskRows.some(t=>t.address===address&&t.chainId===chain&&taskQuality(t).usableForPopularity))).length:0,networks:chainCoverage,message:`Coverage: ${analyzedWalletCount} / ${requestedWalletCount} wallets má dokončenou stránkovaci. Data quality: ${quality.reliableTasks} spolehlivých · ${quality.warningTasks} s upozorněním · ${quality.unknownTasks} neúplných/neznámých tasků${networkText?` · ${networkText}`:''}. ${terminal?'Všechny tasky dokončeny':'Výsledky zahrnují dokončené úlohy; nedokončené lze obnovit.'}`};
 }
 tokenResults(id,job,{offset,limit,revision,sort,minHolders,minShare,chainId,search,hideSpam=true}){
  let rows=this.tokenCache.get(id)?.revision===job.revision?this.tokenCache.get(id).rows:null;
  if(!rows){
   const tasks=this.store.tasks(id).filter(task=>task.kind!=='wallets'||!isIgnoredWalletAddress(task.address)),analyzed=new Map(),warning=new Map(),requested=new Map(),completed=new Map();for(const task of tasks)if(task.kind==='wallets'){requested.set(task.chainId,(requested.get(task.chainId)||0)+1);if(task.status==='complete')completed.set(task.chainId,(completed.get(task.chainId)||0)+1);if(taskQuality(task).usableForPopularity)analyzed.set(task.chainId,(analyzed.get(task.chainId)||0)+1);if(task.status==='complete'&&Number(task.invalid_rows)>0)warning.set(task.chainId,(warning.get(task.chainId)||0)+1);}
   const grouped=new Map(),positions=this.store.db.prepare(`SELECT p.owner,p.token_id,p.holding,t.chain_id,t.status,t.invalid_rows FROM positions p JOIN tasks t ON t.scan_id=p.scan_id AND t.task_key=p.task_key WHERE p.scan_id=? AND lower(trim(p.owner)) NOT IN (${SYSTEM_WALLET_ADDRESSES.map(()=>'?').join(',')})`).all(id,...SYSTEM_WALLET_ADDRESSES);
   for(const row of positions){if(row.status!=='complete'||Number(row.invalid_rows)>0)continue;const holding=parse(row.holding),key=`${row.chain_id}:${holding.address||holding.id?.split(':').slice(1).join(':')||row.token_id.split(':').slice(1).join(':')}`;let group=grouped.get(key);if(!group){group={...holding,id:row.token_id,chainId:row.chain_id,holderCount:0,analyzedWalletCount:analyzed.get(row.chain_id)||0,reliableWalletCount:analyzed.get(row.chain_id)||0,completedWalletCount:completed.get(row.chain_id)||0,warningWalletCount:warning.get(row.chain_id)||0,requestedWalletCount:requested.get(row.chain_id)||0,unknownWalletCount:Math.max(0,(requested.get(row.chain_id)||0)-(completed.get(row.chain_id)||0)),share:0,totalValue:null,amount:0,unpricedPositions:0,pricedPositions:0,owners:new Set()};grouped.set(key,group);}if(group.owners.has(row.owner))continue;group.owners.add(row.owner);group.holderCount++;group.amount+=Number(holding.amount)||0;if(Number.isFinite(holding.value)){group.totalValue=(group.totalValue??0)+holding.value;group.pricedPositions++;}else group.unpricedPositions++;}
   rows=[...grouped.values()].map(g=>{const {owners,...row}=g;row.share=row.analyzedWalletCount?row.holderCount/row.analyzedWalletCount:0;row.totalValue=row.totalValue===null?null:Math.round(row.totalValue*100)/100;return row;});
   if(this.tokenCache.size>=6)this.tokenCache.delete(this.tokenCache.keys().next().value);this.tokenCache.set(id,{revision:job.revision,rows});
  }
  rows=rows.map(t=>({...t,...classifyTokenSpam(t)}));
  const minCount=Math.max(0,Number(minHolders)||0),minPercent=Math.max(0,Number(minShare)||0),needle=String(search||'').trim().toLowerCase();
  rows=rows.filter(t=>(!hideSpam||!t.likelySpam)&&(!chainId||t.chainId===chainId)&&t.holderCount>=minCount&&t.share*100>=minPercent&&(!needle||`${t.symbol} ${t.name} ${t.address}`.toLowerCase().includes(needle)));
  // Summary belongs to the complete filtered result. Sorting and pagination
  // below only affect the rows returned to the table, never these metrics.
  const filteredRows=rows,knownValueRows=filteredRows.filter(t=>Number.isFinite(t.totalValue)),topToken=filteredRows.reduce((top,t)=>!top||t.holderCount>top.holderCount||t.holderCount===top.holderCount&&t.share>top.share||t.holderCount===top.holderCount&&t.share===top.share&&(t.totalValue??-1)>(top.totalValue??-1)?t:top,null);
  const summary={filteredTotal:filteredRows.length,uniqueContracts:filteredRows.length,knownUsdValue:knownValueRows.length?knownValueRows.reduce((sum,t)=>sum+t.totalValue,0):null,pricedTokens:knownValueRows.length,unpricedPositions:filteredRows.reduce((sum,t)=>sum+(Number(t.unpricedPositions)||0),0),networks:[...new Set(filteredRows.map(t=>t.chainId).filter(Boolean))],topToken:topToken?{id:topToken.id,chainId:topToken.chainId,address:topToken.address,symbol:topToken.symbol,name:topToken.name,holderCount:topToken.holderCount,share:topToken.share,totalValue:topToken.totalValue}:null};
  rows.sort(sort==='value'?(a,b)=>(b.totalValue??-1)-(a.totalValue??-1)||b.holderCount-a.holderCount:(a,b)=>b.holderCount-a.holderCount||b.share-a.share||(b.totalValue??-1)-(a.totalValue??-1));
  const total=rows.length,tokens=rows.slice(offset,offset+limit),taskRows=this.store.tasks(id),coverage=this.coverage(id,job,taskRows),providerLabel=[...new Set(taskRows.filter(t=>t.as_of).map(t=>providerDisplayName(t.provider)))].join(' + ')||'Provider dosud nedodal data';coverage.providerLabel=providerLabel;
  const warnings=[...(job.query.excludedSystemAddresses||[]).map(()=>`Systémová burn/dead adresa byla přeskočena; nebyly pro ni vytvořeny žádné úlohy.`),...taskRows.flatMap(t=>[...(t.error?[`${getNetwork(t.chainId).name}: ${t.error}`]:[]),...(t.invalid_rows?[`${t.invalid_rows} neinterpretovaných řádků nebylo možné zahrnout.`]:[])])];
  if(job.status==='running')warnings.unshift('Průběžný výsledek. Popularita se během běhu může měnit; podíl vychází z úspěšně dokončených úloh v relevantní síti.');
  else if(job.status==='paused')warnings.unshift('Sken je pozastavený. Popularita vychází z úspěšně dokončených úloh v relevantní síti.');
  else if(job.status==='partial')warnings.unshift('Sken je částečný. Popularita vychází pouze ze spolehlivých dokončených tasků v relevantní síti.');
  else if(job.status==='complete_with_warnings')warnings.unshift(`Stránkování je dokončeno, ale ${taskRows.filter(t=>t.kind==='wallets'&&t.status==='complete'&&Number(t.invalid_rows)>0).length} wallet/network tasků obsahuje neinterpretované řádky. Tyto tasky se nezapočítávají jako absence tokenu; popularity používá pouze spolehlivé tasky.`);
  return {wallets:[],tokens,summary,source:'live',warnings,coverage,job,pagination:{offset,limit,total,filteredTotal:total,pageRows:tokens.length,nextOffset:offset+tokens.length<total?offset+tokens.length:null,revision:job.revision,view:'tokens'}};
 }
 async close(){await Promise.all([...this.active.keys()].map(id=>this.pause(id)));this.store.close();}
}
