const parse=value=>{try{return value?JSON.parse(value):null;}catch{return null;}};
const stamp=value=>value?new Date(value).toISOString():null;
const numeric=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;

/** Read-only dashboard queries over data the app has already stored. */
export class DashboardService{
 constructor({store,engine,moni}){this.store=store;this.engine=engine;this.moni=moni;}
 overview(moniFilters){
  const walletAnalysis=this.#walletAnalysis();
  const correlations=this.#correlations();
  return {walletAnalysis,correlations,moni:this.moni?.dashboard?.(moniFilters)||{accounts:[],watchlistCount:0},generatedAt:new Date().toISOString()};
 }
 #walletAnalysis(){
  const db=this.store.db;
  const candidates=db.prepare("SELECT s.id FROM scans s WHERE json_extract(s.query_json,'$.kind')='wallets' AND s.status IN ('complete','complete_with_warnings','partial') AND EXISTS(SELECT 1 FROM positions p JOIN tasks t ON t.scan_id=p.scan_id AND t.task_key=p.task_key WHERE p.scan_id=s.id AND t.status='complete') ORDER BY s.created_at DESC LIMIT 30").all();
  for(const {id} of candidates){
   const job=this.store.describe(id),query=job?.query;if(!job||!query)continue;
   const analyzed=db.prepare(`SELECT chain_id,COUNT(DISTINCT CASE WHEN status='complete' THEN address END) AS wallets,COUNT(DISTINCT CASE WHEN status='complete' AND invalid_rows=0 THEN address END) AS reliable,COUNT(DISTINCT CASE WHEN status='complete' AND invalid_rows>0 THEN address END) AS warnings,COUNT(DISTINCT CASE WHEN status!='complete' THEN address END) AS unknown FROM tasks WHERE scan_id=? GROUP BY chain_id`).all(id);
   if(!analyzed.length)continue;
   const byNetwork=new Map(analyzed.map(row=>[row.chain_id,Number(row.reliable)]));
   const rows=db.prepare(`SELECT p.token_id,t.chain_id,
     COALESCE(json_extract(p.holding,'$.address'),substr(p.token_id,instr(p.token_id,':')+1)) AS address,
     COALESCE(json_extract(p.holding,'$.symbol'),'ERC-20') AS symbol,
     COALESCE(json_extract(p.holding,'$.name'),'') AS name,
     COUNT(DISTINCT p.owner) AS holderCount,
     SUM(CASE WHEN json_type(p.holding,'$.value') IN ('integer','real') THEN json_extract(p.holding,'$.value') ELSE 0 END) AS knownUsd,
     SUM(CASE WHEN json_type(p.holding,'$.value') IN ('integer','real') THEN 0 ELSE 1 END) AS unpricedPositions
     FROM positions p JOIN tasks t ON t.scan_id=p.scan_id AND t.task_key=p.task_key
     WHERE p.scan_id=? AND t.status='complete' AND t.invalid_rows=0 AND p.threshold_eligible=1
     GROUP BY p.token_id,t.chain_id ORDER BY holderCount DESC,knownUsd DESC LIMIT 8`).all(id);
   const requested=query.addresses?.length||0,success=job.progress?.completedWallets||0;
   const invalidRows=db.prepare('SELECT COALESCE(SUM(invalid_rows),0) AS n FROM tasks WHERE scan_id=?').get(id).n;
   const warningTasks=db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE scan_id=? AND status='complete' AND invalid_rows>0").get(id).n,reliableTasks=db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE scan_id=? AND status='complete' AND invalid_rows=0").get(id).n,unknownTasks=job.taskCount-job.progress.completedTasks;
   return {scan:{id,status:job.status,lastSuccessAt:job.tasks.map(task=>task.lastSuccessAt||task.asOf).filter(Boolean).sort().at(-1)||null,lastAttemptAt:job.tasks.map(task=>task.lastAttemptAt).filter(Boolean).sort().at(-1)||null,createdAt:job.createdAt,updatedAt:job.updatedAt,finishedAt:job.finishedAt,pausedAt:job.pausedAt,runtimeMs:job.runtimeMs,progress:job.progress,pages:job.pages,positions:job.positions,message:job.message},datasetName:query.walletMetadata?.length?`${query.walletMetadata.length} Smart wallets`:`${requested} peněženek`,networks:query.chainIds,coverage:{successful:success,requested,perNetwork:analyzed.map(row=>({chainId:row.chain_id,successful:Number(row.wallets),reliable:Number(row.reliable),warnings:Number(row.warnings),unknown:Number(row.unknown),requested}))},quality:{invalidRows,partial:job.status==='partial',reliableTasks,warningTasks,unknownTasks,failedTasks:unknownTasks},tokens:rows.map(row=>({id:row.token_id,chainId:row.chain_id,address:row.address,symbol:row.symbol,name:row.name,holderCount:Number(row.holderCount),analyzedWalletCount:byNetwork.get(row.chain_id)||0,reliableWalletCount:byNetwork.get(row.chain_id)||0,warningWalletCount:Number(analyzed.find(item=>item.chain_id===row.chain_id)?.warnings)||0,requestedWalletCount:requested,share:byNetwork.get(row.chain_id)?Number(row.holderCount)/byNetwork.get(row.chain_id):0,totalValue:Number(row.knownUsd)||0,unpricedPositions:Number(row.unpricedPositions)||0}))};
  }
  return null;
 }
 #correlations(){
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
const topicRow=(raw,index)=>{const row=object(raw),report=object(row.report),source=object(row.source),links=object(row.links),url=[row.primarySourceUrl,row.primary_source_url,row.sourceUrl,row.source_url,source.url,source.href,links.primarySourceUrl,links.primary_source_url,links.sourceUrl,links.source_url,links.source,links.canonicalUrl,links.canonical_url,row.canonicalUrl,row.canonical_url,row.topicUrl,row.topic_url,row.externalUrl,row.external_url,row.url,report.canonicalUrl,report.url].map(safeTopicUrl).find(Boolean)||null,summary=String(row.summary||row.description||row.content||report.summary||'').trim(),translations=object(row.translations),translation=object(row.translation),cs=object(translations.cs||translation.cs||translation.cz);return {id:String(row.id??row.topicId??row.slug??''),rank:numeric(row.rank)??index+1,name:String(row.name||row.title||'').slice(0,140),summary:summary.slice(0,500),translations:cs.name||cs.summary?{cz:{name:String(cs.name||'').slice(0,140),summary:String(cs.summary||'').slice(0,500)}}:undefined,url,trend:numeric(row.trend),postCount:numeric(row.postCount),authorCount:numeric(row.authorCount),lastSeenAt:row.lastSeenAt||row.last_seen_at||null};};

/** Keyless, official AIXBT v3 read adapter with bounded cache and stale fallback. */
export class AixbtService{
 constructor({fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=6000,ttlMs=15*60*1000}={}){Object.assign(this,{fetchImpl,now,timeoutMs,ttlMs});this.cache=new Map();this.inflight=new Map();this.base='https://api.aixbt.tech/v3';}
 async #get(path,normalize=value=>value){
  const key=path,cached=this.cache.get(key),now=this.now();if(cached&&now-cached.at<this.ttlMs)return {...cached.value,cached:true,stale:false};if(this.inflight.has(key))return this.inflight.get(key);
  const request=(async()=>{try{const response=await this.fetchImpl(new URL(this.base+path),{headers:{Accept:'application/json'},signal:AbortSignal.timeout(this.timeoutMs),redirect:'error'});if(!response.ok)throw new Error(`AIXBT odpovědělo HTTP ${response.status}.`);const body=await response.json(),value=normalize(body),entry={...value,fetchedAt:new Date(this.now()).toISOString(),cached:false,stale:false,available:true};this.cache.set(key,{at:this.now(),value:entry});return entry;}catch(error){if(cached)return {...cached.value,cached:true,stale:true,warning:'AIXBT není dostupné; zobrazena poslední uložená odpověď.'};return {available:false,cached:false,stale:false,items:[],error:error?.name==='TimeoutError'?'AIXBT neodpovědělo včas.':'AIXBT je momentálně nedostupné.'};}finally{this.inflight.delete(key);}})();this.inflight.set(key,request);return request;
 }
 topics(limit=25){limit=Math.min(25,Math.max(5,Number(limit)||25));return this.#get('/topics',body=>{const data=unwrapData(body),rows=asItems(data);if(!rows.length)throw new Error('AIXBT vrátilo prázdný nebo neplatný seznam témat.');const items=rows.map(topicRow).filter(topic=>topic.id||topic.name);if(!items.length)throw new Error('AIXBT nevrátilo žádná platná témata.');const meta=object(object(body).meta||object(data).meta);return {items:items.slice(0,25),snapshot:meta.snapshot||object(data).snapshot||null};}).then(result=>({...result,items:result.items.slice(0,limit)}));}
 async topic(id){id=String(id||'');if(!/^[a-zA-Z0-9_-]{1,120}$/.test(id))return {available:false,error:'Neplatné ID AIXBT tématu.'};const [detail,projects]=await Promise.all([this.#get(`/topics/${encodeURIComponent(id)}`,body=>({topic:topicRow(object(unwrapData(body)).topic||unwrapData(body),0)})),this.#get(`/topics/${encodeURIComponent(id)}/projects`,body=>({projects:asItems(unwrapData(body)).slice(0,20).map(raw=>{const row=object(raw);return {id:String(row.id||row.projectId||''),name:String(row.name||row.title||'Projekt').slice(0,120),slug:String(row.slug||'').slice(0,120),observedPosts:numeric(row.observedPosts),observedAuthors:numeric(row.observedAuthors),share:numeric(row.share)};})}))]);return {available:detail.available,topic:detail.topic||null,projects:projects.projects||[],fetchedAt:detail.fetchedAt,stale:!!(detail.stale||projects.stale),warning:detail.warning||projects.warning||detail.error||projects.error||null};}
}
