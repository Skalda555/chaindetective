import {createHash} from 'node:crypto';
import {isIgnoredWalletAddress} from '../dist/data.js';
const parse=value=>{try{return value?JSON.parse(value):null;}catch{return null;}};
const stamp=value=>value?new Date(value).toISOString():null;
const numeric=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
export const WALLET_FRESH_DAYS=7;
export const WALLET_STALE_DAYS=30;
const DAY_MS=24*60*60*1000;
const freshnessStatus=(lastSuccessAt,now)=>{const then=Date.parse(lastSuccessAt);if(!Number.isFinite(then))return 'stale';const age=Math.max(0,now-then);return age<=WALLET_FRESH_DAYS*DAY_MS?'fresh':age<=WALLET_STALE_DAYS*DAY_MS?'aging':'stale';};

/** Dashboard queries and compact persisted summaries over data already stored by the app. */
export class DashboardService{
 constructor({store,engine,moni,now=Date.now}){
  this.store=store;this.engine=engine;this.moni=moni;this.now=now;
  this.store.db.exec('CREATE TABLE IF NOT EXISTS dashboard_snapshots(snapshot_key TEXT PRIMARY KEY,payload TEXT NOT NULL,captured_at TEXT NOT NULL,source_scan_id TEXT)');
  // Dashboard wallet state is independent from scan history; source scan IDs
  // are provenance only and never cascade when history rows are deleted.
  this.store.db.exec(`CREATE TABLE IF NOT EXISTS dashboard_wallet_states(
   network TEXT NOT NULL,wallet_address TEXT NOT NULL,last_success_at TEXT NOT NULL,
   source_scan_id TEXT NOT NULL,data_quality TEXT NOT NULL DEFAULT 'reliable',
   timestamp_source TEXT NOT NULL DEFAULT 'task',PRIMARY KEY(network,wallet_address));
   CREATE INDEX IF NOT EXISTS dashboard_wallet_states_freshness ON dashboard_wallet_states(last_success_at);
   CREATE TABLE IF NOT EXISTS dashboard_wallet_positions(
   network TEXT NOT NULL,wallet_address TEXT NOT NULL,token_id TEXT NOT NULL,token_address TEXT NOT NULL,
   symbol TEXT NOT NULL,name TEXT NOT NULL,known_usd REAL,amount TEXT,
   PRIMARY KEY(network,wallet_address,token_id));
   CREATE INDEX IF NOT EXISTS dashboard_wallet_positions_token ON dashboard_wallet_positions(network,token_id);
   CREATE TABLE IF NOT EXISTS dashboard_dataset_meta(meta_key TEXT PRIMARY KEY,meta_value TEXT NOT NULL);`);
  this.#backfillWalletDataset();
  if(this.engine)this.engine.onScanFinished=(id,status)=>this.captureWalletAnalysis(id,status);
 }
 overview(moniFilters){
  const walletAnalysis=this.#walletAnalysis();
  const correlations=this.#correlations();
  return {walletAnalysis,correlations,moni:this.moni?.dashboard?.(moniFilters)||{accounts:[],watchlistCount:0},generatedAt:new Date(this.now()).toISOString()};
 }
 #walletAnalysis(){
  const db=this.store.db,count=Number(db.prepare('SELECT COUNT(*) AS n FROM dashboard_wallet_states').get().n);
  if(!count)return null;
  const perNetwork=db.prepare('SELECT network,COUNT(*) AS wallets,MIN(last_success_at) AS oldest,MAX(last_success_at) AS newest FROM dashboard_wallet_states GROUP BY network ORDER BY network').all();
  const freshness=db.prepare('SELECT MIN(last_success_at) AS oldest,MAX(last_success_at) AS newest FROM dashboard_wallet_states').get();
  const states=db.prepare('SELECT network,wallet_address,last_success_at FROM dashboard_wallet_states ORDER BY network,wallet_address').all(),now=this.now(),rank={fresh:0,aging:1,stale:2};
  const walletFreshness=new Map(),networkFreshness=new Map(),walletNetworkCounts={fresh:0,aging:0,stale:0},walletCounts={fresh:0,aging:0,stale:0};
  for(const state of states){const status=freshnessStatus(state.last_success_at,now),network=networkFreshness.get(state.network)||{fresh:0,aging:0,stale:0};network[status]++;networkFreshness.set(state.network,network);walletNetworkCounts[status]++;const previous=walletFreshness.get(state.wallet_address);if(!previous||rank[status]>rank[previous])walletFreshness.set(state.wallet_address,status);}
  for(const status of walletFreshness.values())walletCounts[status]++;
  const walletCount=Number(db.prepare('SELECT COUNT(DISTINCT wallet_address) AS n FROM dashboard_wallet_states').get().n);
  const rows=db.prepare(`SELECT p.token_id,p.network AS chain_id,p.token_address AS address,
    MAX(p.symbol) AS symbol,MAX(p.name) AS name,COUNT(*) AS holderCount,
    SUM(CASE WHEN p.known_usd IS NOT NULL THEN p.known_usd ELSE 0 END) AS knownUsd,
    SUM(CASE WHEN p.known_usd IS NULL THEN 1 ELSE 0 END) AS unpricedPositions
    FROM dashboard_wallet_positions p JOIN dashboard_wallet_states s
    ON s.network=p.network AND s.wallet_address=p.wallet_address
    GROUP BY p.network,p.token_id ORDER BY holderCount DESC,knownUsd DESC LIMIT 8`).all();
  const perNetworkMap=new Map(perNetwork.map(row=>[row.network,Number(row.wallets)]));
  const networks=perNetwork.map(row=>row.network),tokens=rows.map(row=>{const analyzed=perNetworkMap.get(row.chain_id)||0;return {id:row.token_id,chainId:row.chain_id,address:row.address,symbol:row.symbol,name:row.name,holderCount:Number(row.holderCount),analyzedWalletCount:analyzed,reliableWalletCount:analyzed,warningWalletCount:0,requestedWalletCount:analyzed,share:analyzed?Number(row.holderCount)/analyzed:0,totalValue:Number(row.knownUsd)||0,unpricedPositions:Number(row.unpricedPositions)||0};});
  return {datasetName:`${walletCount} peněženek`,networks,coverage:{successful:walletCount,requested:walletCount,walletNetworkCount:count,perNetwork:perNetwork.map(row=>({chainId:row.network,successful:Number(row.wallets),reliable:Number(row.wallets),warnings:0,unknown:0,requested:Number(row.wallets),oldest:stamp(row.oldest),newest:stamp(row.newest),freshness:networkFreshness.get(row.network)}))},quality:{invalidRows:0,partial:false,reliableTasks:count,warningTasks:0,unknownTasks:0,failedTasks:0},freshness:{newest:stamp(freshness.newest),oldest:stamp(freshness.oldest),wallets:walletCounts,walletNetworks:walletNetworkCounts,perNetwork:Object.fromEntries(networkFreshness)},snapshot:{persisted:true,merged:true},tokens};
 }
 walletRescanCandidates({limit=500,offset=0}={}){
  limit=Math.min(500,Math.max(1,Number(limit)||500));offset=Math.max(0,Math.floor(Number(offset)||0));
  const db=this.store.db,total=Number(db.prepare('SELECT COUNT(*) AS n FROM dashboard_wallet_states').get().n),rows=db.prepare('SELECT network,wallet_address,last_success_at,source_scan_id,data_quality FROM dashboard_wallet_states ORDER BY last_success_at ASC,network ASC,wallet_address ASC LIMIT ? OFFSET ?').all(limit,offset),now=this.now();
  return {total,limit,offset,items:rows.map(row=>({network:row.network,walletAddress:row.wallet_address,lastSuccessAt:stamp(row.last_success_at),freshness:freshnessStatus(row.last_success_at,now),sourceScanId:row.source_scan_id,dataQuality:row.data_quality}))};
 }
 #backfillWalletDataset(){
  const db=this.store.db;
  if(db.prepare("SELECT 1 FROM dashboard_dataset_meta WHERE meta_key='history_backfilled'").get())return;
  const ids=db.prepare("SELECT id FROM scans WHERE json_extract(query_json,'$.kind')='wallets' AND status IN ('complete','complete_with_warnings','partial','failed') ORDER BY COALESCE(finished_at,created_at),id").all();
  db.exec('BEGIN');try{
   for(const {id} of ids)this.#mergeScan(id,{backfill:true});
   db.prepare("INSERT OR REPLACE INTO dashboard_dataset_meta(meta_key,meta_value) VALUES('history_backfilled',?)").run(new Date().toISOString());
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 captureWalletAnalysis(id,status){
  if(!['complete','complete_with_warnings'].includes(status))return false;
  return this.#mergeScan(id);
 }
 #mergeScan(id,{backfill=false}={}){
  const db=this.store.db,job=this.store.describe(id),query=job?.query;
  if(!job||query?.kind!=='wallets'||!['complete','complete_with_warnings'].includes(job.status)||!job.quality?.executionComplete)return false;
  const eligible=db.prepare("SELECT task_key,chain_id,address,COALESCE(last_success_at,as_of,?) AS last_success_at,CASE WHEN last_success_at IS NULL AND as_of IS NULL THEN 0 ELSE 1 END AS has_task_timestamp FROM tasks WHERE scan_id=? AND kind='wallets' AND status='complete' AND invalid_rows=0 AND error IS NULL ORDER BY chain_id,address").all(job.finishedAt||job.createdAt,id);
  if(!eligible.length)return false;
  const upsertState=db.prepare(`INSERT INTO dashboard_wallet_states(network,wallet_address,last_success_at,source_scan_id,data_quality,timestamp_source)
   VALUES(?,?,?,?,?,?) ON CONFLICT(network,wallet_address) DO UPDATE SET last_success_at=excluded.last_success_at,
   source_scan_id=excluded.source_scan_id,data_quality=excluded.data_quality,timestamp_source=excluded.timestamp_source
   WHERE excluded.last_success_at>dashboard_wallet_states.last_success_at OR
   (excluded.last_success_at=dashboard_wallet_states.last_success_at AND excluded.source_scan_id>dashboard_wallet_states.source_scan_id)`);
  const current=db.prepare('SELECT last_success_at,source_scan_id FROM dashboard_wallet_states WHERE network=? AND wallet_address=?');
  const removePositions=db.prepare('DELETE FROM dashboard_wallet_positions WHERE network=? AND wallet_address=?');
  const insertPosition=db.prepare('INSERT INTO dashboard_wallet_positions(network,wallet_address,token_id,token_address,symbol,name,known_usd,amount) VALUES(?,?,?,?,?,?,?,?)');
  const selectPositions=db.prepare('SELECT token_id,holding FROM positions WHERE scan_id=? AND task_key=? AND threshold_eligible=1 ORDER BY token_id');
  const write=()=>{let changed=false;for(const task of eligible){
   const address=String(task.address||'').trim().toLowerCase(),network=String(task.chain_id||'');
   if(!address||!network||isIgnoredWalletAddress(address))continue;
   const previous=current.get(network,address);
   if(previous&&(task.last_success_at<previous.last_success_at||(task.last_success_at===previous.last_success_at&&id<=previous.source_scan_id)))continue;
   upsertState.run(network,address,task.last_success_at,id,'reliable',task.has_task_timestamp?'task':'scan-finished-fallback');
   removePositions.run(network,address);
   for(const row of selectPositions.all(id,task.task_key)){
    const holding=parse(row.holding)||{},tokenAddress=String(holding.address||String(row.token_id).split(':').slice(1).join(':')).trim().toLowerCase();
    if(!tokenAddress)continue;
    const value=numeric(holding.value),amount=holding.amount===null||holding.amount===undefined?null:String(holding.amount);
    insertPosition.run(network,address,String(row.token_id),tokenAddress,String(holding.symbol||'ERC-20').slice(0,64),String(holding.name||'').slice(0,160),value,amount);
   }
   changed=true;
  }return changed;};
  if(backfill)return write();
  db.exec('BEGIN IMMEDIATE');try{const changed=write();db.exec('COMMIT');return changed;}catch(error){db.exec('ROLLBACK');throw error;}
 } #correlations(){
  const ids=this.store.db.prepare("SELECT id FROM scans WHERE json_extract(query_json,'$.kind')='holders' AND status IN ('complete','complete_with_warnings','partial') ORDER BY COALESCE(finished_at,created_at) DESC LIMIT 12").all();
  const rows=[];
  for(const {id} of ids){
   const job=this.store.describe(id);if(!job||!job.tasks.some(task=>task.status==='complete'))continue;
   let resultCount=0,warnings=[];try{const result=this.engine.result(id,{offset:0,limit:1});resultCount=result.pagination.total;warnings=result.warnings||[];}catch{}
   rows.push({id,status:job.status,createdAt:job.finishedAt||job.createdAt,match:job.query.match,query:job.query,resultCount,tokens:job.query.tokens.map(token=>{const found=job.tasks.find(task=>task.token?.id===`${token.chainId}:${token.address}`)?.token;return {chainId:token.chainId,address:token.address,symbol:found?.symbol||'ERC-20',name:found?.name||''};}),warnings});
   if(rows.length>=3)break;
  }
  return rows;
 }
}

const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const asItems=value=>Array.isArray(value)?value:Array.isArray(value?.items)?value.items:Array.isArray(value?.topics)?value.topics:Array.isArray(value?.data)?value.data:[];
const unwrapData=value=>object(value).data??value;
const safeTopicUrl=value=>{try{const url=new URL(String(value||''));return url.protocol==='https:'&&!url.username&&!url.password?url.href.slice(0,1000):null;}catch{return null;}};
const maskAixbtText=text=>{const protectedValues=[];const value=String(text||'').replace(/https?:\/\/[^\s<>"']+|@[A-Za-z0-9_]{1,15}|\$[A-Za-z][A-Za-z0-9]{0,9}|\b0x[a-fA-F0-9]{8,}\b|\b[A-Z][A-Z0-9]{1,9}\b|(?<![A-Za-z0-9])\d+(?:[.,]\d+)*(?:%|x)?(?![A-Za-z0-9])/g,match=>{const marker=`CDXKEEP${String(protectedValues.length).padStart(3,'0')}X`;protectedValues.push({marker,value:match});return marker;});return {text:value,restore:translated=>{let result=String(translated||'');for(const entry of protectedValues){if(!result.includes(entry.marker))return null;result=result.replaceAll(entry.marker,entry.value);}return result;}};};
const topicRow=(raw,index)=>{const row=object(raw),report=object(row.report),source=object(row.source),links=object(row.links),url=[row.primarySourceUrl,row.primary_source_url,row.sourceUrl,row.source_url,source.url,source.href,links.primarySourceUrl,links.primary_source_url,links.sourceUrl,links.source_url,links.source,links.canonicalUrl,links.canonical_url,row.canonicalUrl,row.canonical_url,row.topicUrl,row.topic_url,row.externalUrl,row.external_url,row.url,report.canonicalUrl,report.url].map(safeTopicUrl).find(Boolean)||null,summary=String(row.summary||row.description||row.content||report.summary||'').trim(),translations=object(row.translations),translation=object(row.translation),cs=object(translations.cs||translation.cs||translation.cz);return {id:String(row.id??row.topicId??row.slug??''),rank:numeric(row.rank)??index+1,name:String(row.name||row.title||'').slice(0,140),summary:summary.slice(0,500),translations:cs.name||cs.summary?{cz:{name:String(cs.name||'').slice(0,140),summary:String(cs.summary||'').slice(0,500)}}:undefined,url,trend:numeric(row.trend),postCount:numeric(row.postCount),authorCount:numeric(row.authorCount),lastSeenAt:row.lastSeenAt||row.last_seen_at||null};};

/** Keyless, official AIXBT v3 read adapter with bounded cache and stale fallback. */
export class AixbtService{
 constructor({fetchImpl=globalThis.fetch,translationFetchImpl=globalThis.fetch,translationApiKey=process.env.GOOGLE_TRANSLATE_API_KEY||'',db=null,now=Date.now,timeoutMs=6000,ttlMs=15*60*1000,translationCooldownMs=5*60*1000}={}){Object.assign(this,{fetchImpl,translationFetchImpl,translationApiKey:String(translationApiKey||''),db,now,timeoutMs,ttlMs,translationCooldownMs});this.cache=new Map();this.inflight=new Map();this.translationInflight=new Map();this.translationCooldown=new Map();this.base='https://api.aixbt.tech/v3';db?.exec('CREATE TABLE IF NOT EXISTS aixbt_translation_cache(source TEXT NOT NULL,topic_id TEXT NOT NULL,source_hash TEXT NOT NULL,target_language TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(source,topic_id,source_hash,target_language))');this.translationCache=db?.prepare('SELECT title,description FROM aixbt_translation_cache WHERE source=? AND topic_id=? AND source_hash=? AND target_language=?');this.translationInsert=db?.prepare('INSERT INTO aixbt_translation_cache(source,topic_id,source_hash,target_language,title,description,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(source,topic_id,source_hash,target_language) DO UPDATE SET title=excluded.title,description=excluded.description,created_at=excluded.created_at');}
 async #get(path,normalize=value=>value){
  const key=path,cached=this.cache.get(key),now=this.now();if(cached&&now-cached.at<this.ttlMs)return {...cached.value,cached:true,stale:false};if(this.inflight.has(key))return this.inflight.get(key);
  const request=(async()=>{try{const response=await this.fetchImpl(new URL(this.base+path),{headers:{Accept:'application/json'},signal:AbortSignal.timeout(this.timeoutMs),redirect:'error'});if(!response.ok)throw new Error(`AIXBT odpovědělo HTTP ${response.status}.`);const body=await response.json(),value=normalize(body),entry={...value,fetchedAt:new Date(this.now()).toISOString(),cached:false,stale:false,available:true};this.cache.set(key,{at:this.now(),value:entry});return entry;}catch(error){if(cached)return {...cached.value,cached:true,stale:true,warning:'AIXBT není dostupné; zobrazena poslední uložená odpověď.'};return {available:false,cached:false,stale:false,items:[],error:error?.name==='TimeoutError'?'AIXBT neodpovědělo včas.':'AIXBT je momentálně nedostupné.'};}finally{this.inflight.delete(key);}})();this.inflight.set(key,request);return request;
 }
 topics(limit=25,language='en'){limit=Math.min(25,Math.max(5,Number(limit)||25));const result=this.#get('/topics',body=>{const data=unwrapData(body),rows=asItems(data);if(!rows.length)throw new Error('AIXBT vrátilo prázdný nebo neplatný seznam témat.');const items=rows.map(topicRow).filter(topic=>topic.id||topic.name);if(!items.length)throw new Error('AIXBT nevrátilo žádná platná témata.');const meta=object(object(body).meta||object(data).meta);return {items:items.slice(0,25),snapshot:meta.snapshot||object(data).snapshot||null};}).then(value=>({...value,items:value.items.slice(0,limit)}));return language==='cs'?result.then(payload=>this.#translateTopics(payload)):result;}
 async #translateTopics(payload){
  const items=payload.items||[],signature=createHash('sha256').update(JSON.stringify(items.map(item=>[item.id,item.name,item.summary]))).digest('hex');
  if(this.translationInflight.has(signature))return this.translationInflight.get(signature);
  const operation=(async()=>{
   const translated=[];for(const item of items){
    const existing=item.translations?.cz;
    const sourceHash=createHash('sha256').update(JSON.stringify([item.name||'',item.summary||''])).digest('hex');
    const topicId=String(item.id||sourceHash);
    if(existing&&(existing.name||existing.summary)){translated.push({...item,translationStatus:'cached'});continue;}
    const cached=this.translationCache?.get('AIXBT',topicId,sourceHash,'cs');
    if(cached){translated.push({...item,translations:{...(item.translations||{}),cz:{name:cached.title,summary:cached.description}},translationStatus:'cached'});continue;}
    translated.push({...item,translationStatus:'pending'});
   }
   const pending=translated.filter(item=>item.translationStatus==='pending');
   if(!pending.length)return {...payload,items:translated};
   if(!this.translationApiKey)return {...payload,items:translated.map(item=>item.translationStatus==='pending'?{...item,translationStatus:'fallback',translationError:'Google Cloud Translation není nakonfigurován.'}:item)};
   const cooldownKey=signature,cooldownUntil=this.translationCooldown.get(cooldownKey)||0;
   if(cooldownUntil>this.now())return {...payload,items:translated.map(item=>item.translationStatus==='pending'?{...item,translationStatus:'fallback',translationError:'Překlad do češtiny je dočasně nedostupný.'}:item)};
   const inputs=[],references=[];
   for(const item of pending){for(const field of ['name','summary']){const text=String(item[field]||'');if(!text)continue;const masked=maskAixbtText(text);references.push({topicId:item.id||createHash('sha256').update(JSON.stringify([item.name,item.summary])).digest('hex'),sourceHash:createHash('sha256').update(JSON.stringify([item.name||'',item.summary||''])).digest('hex'),item,field,masked});inputs.push(masked.text);}}
   try{
    if(inputs.length){const response=await this.translationFetchImpl('https://translation.googleapis.com/language/translate/v2?key='+encodeURIComponent(this.translationApiKey),{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({q:inputs,source:'en',target:'cs',format:'text'}),signal:AbortSignal.timeout(this.timeoutMs),redirect:'error'});if(!response.ok)throw new Error('Translation provider returned an error');const body=await response.json(),results=body?.data?.translations;if(!Array.isArray(results)||results.length!==inputs.length||results.some(row=>typeof row?.translatedText!=='string'))throw new Error('Translation provider returned an invalid response');
     const byTopic=new Map();for(let index=0;index<references.length;index++){const ref=references[index],value=ref.masked.restore(results[index].translatedText);if(value===null)throw new Error('A protected value was lost during translation');const entry=byTopic.get(ref.topicId)||{item:ref.item,sourceHash:ref.sourceHash,title:ref.item.name||'',description:ref.item.summary||''};if(ref.field==='name')entry.title=value;else entry.description=value;byTopic.set(ref.topicId,entry);}
     for(const [topicId,entry] of byTopic){this.translationInsert?.run('AIXBT',topicId,entry.sourceHash,'cs',entry.title,entry.description,this.now());for(let index=0;index<translated.length;index++){if(String(translated[index].id||createHash('sha256').update(JSON.stringify([translated[index].name,translated[index].summary])).digest('hex'))===topicId)translated[index]={...translated[index],translations:{...(translated[index].translations||{}),cz:{name:entry.title,summary:entry.description}},translationStatus:'success',translationError:null};}}
    }
    this.translationCooldown.delete(cooldownKey);
   }catch{this.translationCooldown.set(cooldownKey,this.now()+this.translationCooldownMs);for(let index=0;index<translated.length;index++){if(translated[index].translationStatus==='pending')translated[index]={...translated[index],translationStatus:'fallback',translationError:'Překlad do češtiny není dostupný.'};}}
   return {...payload,items:translated};
  })();
  this.translationInflight.set(signature,operation);try{return await operation;}finally{this.translationInflight.delete(signature);}
 }
 async topic(id){id=String(id||'');if(!/^[a-zA-Z0-9_-]{1,120}$/.test(id))return {available:false,error:'Neplatné ID AIXBT tématu.'};const [detail,projects]=await Promise.all([this.#get(`/topics/${encodeURIComponent(id)}`,body=>({topic:topicRow(object(unwrapData(body)).topic||unwrapData(body),0)})),this.#get(`/topics/${encodeURIComponent(id)}/projects`,body=>({projects:asItems(unwrapData(body)).slice(0,20).map(raw=>{const row=object(raw);return {id:String(row.id||row.projectId||''),name:String(row.name||row.title||'Projekt').slice(0,120),slug:String(row.slug||'').slice(0,120),observedPosts:numeric(row.observedPosts),observedAuthors:numeric(row.observedAuthors),share:numeric(row.share)};})}))]);return {available:detail.available,topic:detail.topic||null,projects:projects.projects||[],fetchedAt:detail.fetchedAt,stale:!!(detail.stale||projects.stale),warning:detail.warning||projects.warning||detail.error||projects.error||null};}
}
