import './load-env.mjs';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const parts={profile:{path:'info/full/',cost:8,ttl:86400000},mentions:{path:'feed/smart_mentions/',cost:4,ttl:3600000},smarts:{path:'smarts/full/',cost:5,ttl:86400000},projects:{path:'projects/',cost:10,ttl:21600000}};
const timeframeValues=new Set(['ALL','M1','M5','H1','H24','D3','D7','D30','D90','D180','Y1']);
const orderValues=new Set(['CREATED_AT','SCORE','SMART_FOLLOWERS_COUNT','FOLLOWERS_COUNT','FOLLOWERS_COUNT_CHANGE','SMART_MENTIONS_COUNT','MENTIONS_COUNT','MENTIONS_COUNT_CHANGE','ML_PROJECT_PREDICTION','SCORE_CHANGE','SMART_MENTIONS_COUNT_CHANGE','SMART_FOLLOWERS_COUNT_CHANGE']);
const failure=(status,message)=>Object.assign(new Error(message),{status});
const defaultProjectFilters=Object.freeze({endpointMode:'curated',feedTimeframe:'D7',changesTimeframe:'H24',orderBy:'SCORE',orderByDirection:'DESC',limit:10,offset:0});
const curatedParams=new Set(['changesTimeframe','feedTimeframe','limit','offset','orderBy','orderByDirection','tags','chains','excludeTags','excludeChains','minSmartFollowersCount','maxSmartFollowersCount','minFollowersCount','maxFollowersCount','showOnlyContracts','showOnlyPublic']);
const rawParams=new Set(['changesTimeframe','feedTimeframe','limit','offset','orderBy','orderByDirection','minMlProjectPredictionPercents','maxMlProjectPredictionPercents','showOnlyContracts']);
export const MONI_PROJECT_PARAM_COVERAGE=Object.freeze({
 curated:{...Object.fromEntries([...curatedParams].map(key=>[key,'ui'])),technical:{apiKey:'auth header; never part of query',responsePagination:'offset is supported; client uses 10-row pages',unknown:'rejected by strict allowlist'}},
 raw:{...Object.fromEntries([...rawParams].map(key=>[key,'ui'])),technical:{apiKey:'auth header; never part of query',unknown:'rejected by strict allowlist'}}
});
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function csv(value,key){if(value===undefined||value===null||value==='')return [];if(!Array.isArray(value)&&typeof value!=='string')throw failure(400,`Neplatná hodnota ${key}.`);const list=(Array.isArray(value)?value:String(value).split(',')).map(x=>String(x).trim().toLowerCase()).filter(Boolean);if(list.some(x=>!/^[a-z0-9_-]{1,80}$/.test(x)))throw failure(400,`Neplatná hodnota ${key}.`);return [...new Set(list)].sort();}
function optionalInt(value,key,{min=0,max=2147483647}={}){if(value===undefined||value===null||value==='')return undefined;const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)throw failure(400,`Neplatná číselná hodnota ${key}.`);return n;}
function triBool(value,key){if(value===undefined||value===null||value==='')return undefined;if(value===true||value==='true')return true;if(value===false||value==='false')return false;throw failure(400,`Neplatná boolean hodnota ${key}.`);}
function projectFilters(value={},modeHint){
 if(!value||typeof value!=='object'||Array.isArray(value))throw failure(400,'Filtry Moni musí být objekt.');
 const mode=String(value.endpointMode||modeHint||defaultProjectFilters.endpointMode);if(!['curated','raw'].includes(mode))throw failure(400,'Neznámý režim Projects Feed.');
 const allowed=mode==='curated'?curatedParams:rawParams;
 for(const key of Object.keys(value))if(key!=='endpointMode'&&!allowed.has(key))throw failure(400,`Neznámý parametr Moni: ${key}.`);
 const filters={endpointMode:mode,feedTimeframe:String(value.feedTimeframe??defaultProjectFilters.feedTimeframe),changesTimeframe:String(value.changesTimeframe??defaultProjectFilters.changesTimeframe),orderBy:String(value.orderBy??defaultProjectFilters.orderBy),orderByDirection:String(value.orderByDirection??defaultProjectFilters.orderByDirection),limit:optionalInt(value.limit,'limit',{min:1,max:10})??10,offset:optionalInt(value.offset,'offset')??0};
 if(!timeframeValues.has(filters.feedTimeframe)||!timeframeValues.has(filters.changesTimeframe))throw failure(400,'Neplatný timeframe Moni Projects Feed.');
 if(!orderValues.has(filters.orderBy)||!['ASC','DESC'].includes(filters.orderByDirection))throw failure(400,'Neplatné řazení Moni Projects Feed.');
 for(const key of ['tags','chains','excludeTags','excludeChains'])if(mode==='curated'){const values=csv(value[key],key);if(values.length)filters[key]=values;}
 const numericKeys=mode==='curated'?['minSmartFollowersCount','maxSmartFollowersCount','minFollowersCount','maxFollowersCount']:['minMlProjectPredictionPercents','maxMlProjectPredictionPercents'];
 for(const key of numericKeys){const v=optionalInt(value[key],key,{min:0,max:mode==='raw'?100:2147483647});if(v!==undefined)filters[key]=v;}
 if(mode==='curated'||mode==='raw'){const contracts=triBool(value.showOnlyContracts,'showOnlyContracts');if(contracts!==undefined)filters.showOnlyContracts=contracts;}
 if(mode==='curated'){const isPublic=triBool(value.showOnlyPublic,'showOnlyPublic');if(isPublic!==undefined)filters.showOnlyPublic=isPublic;}
 for(const [minKey,maxKey] of (mode==='curated'?[['minSmartFollowersCount','maxSmartFollowersCount'],['minFollowersCount','maxFollowersCount']]:[['minMlProjectPredictionPercents','maxMlProjectPredictionPercents']]))if(filters[minKey]!==undefined&&filters[maxKey]!==undefined&&filters[minKey]>filters[maxKey])throw failure(400,`${minKey} nesmí být vyšší než ${maxKey}.`);
 return stable(filters);
}
const canonicalProjectQuery=(filters)=>stable({version:'projects-v3',...filters});
const projectCacheHandle=(handle,filters)=>`projects-v3|${createHash('sha256').update(JSON.stringify(canonicalProjectQuery({...filters,chainScope:handle}))).digest('hex')}`;
const safeJson=value=>{try{return JSON.parse(value);}catch{return null;}};
const count=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const delta=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const names=v=>Array.isArray(v)?v.slice(0,20).map(x=>String(x?.name||'').slice(0,100)).filter(Boolean):[];
function xUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname)?u.href:null;}catch{return null;}}
function profile(data,handle){
 const e=data?.smartEngagement,p=data?.smartProfile||{};
 if(!e||typeof e!=='object')throw failure(502,'Moni vrátilo neznámý formát profilu.');
 return {handle,url:xUrl(data.meta?.userUrl),score:count(e.moniScore),smartsCount:count(e.smartsCount),mentionsCount:count(e.mentionsCount),smartMentionsCount:count(e.smartMentionsCount),tier:count(p.smartTier?.tier),tags:names(p.smartTags),categories:names(p.projectTags),chains:names(p.chains)};
}
function normalize(data,part,handle,filters){
 if(part==='profile')return profile(data,handle);
 if(!Array.isArray(data?.items))throw failure(502,'Moni vrátilo neznámý formát seznamu.');
 if(part==='projects')return {items:data.items.slice(0,filters.limit).map(row=>{const url=xUrl(row.meta?.userUrl),handle=url?new URL(url).pathname.split('/')[1]:'';if(!/^[a-z0-9_]{1,15}$/i.test(handle))throw failure(502,'Moni vrátilo neplatný účet projektu.');const e=row.smartEngagement||{};return {...profile(row,handle),createdAt:row.meta?.createdAt||row.meta?.created_at||null,followersCount:count(e.followersCount),followersCountChange:delta(e.followersCountChange),smartFollowersCountChange:delta(e.smartFollowersCountChange),mentionsCountChange:delta(e.mentionsCountChange),scoreChange:null,smartsChange:null,smartMentionsChange:delta(e.smartMentionsCountChange),accountAgeDays:count(row.meta?.accountAgeDays)};}),limit:filters.limit,offset:filters.offset};
 if(part==='smarts')return {items:data.items.slice(0,20).map(row=>profile(row,new URL(xUrl(row.meta?.userUrl)||'https://x.com/unknown').pathname.slice(1))),total:count(data.totalCount),limit:20};
 return {items:data.items.slice(0,20).map(row=>({at:count(row.createdAt),authorUrl:xUrl(row.data?.mentionBy?.userUrl),postUrl:xUrl(row.data?.postUrl)})),periodDays:7,limit:20};
}
export class MoniService{
 #key;
 constructor(db,{apiKey=process.env.MONI_API_KEY||'',budget=Number(process.env.MONI_MONTHLY_BUDGET||300),fetchImpl=globalThis.fetch,now=Date.now,intervalMs=1100,timeoutMs=35000}={}){
  this.db=db;this.#key=apiKey.trim();this.scope=createHash('sha256').update(this.#key).digest('hex').slice(0,16);
  Object.assign(this,{budget:Number.isFinite(budget)&&budget>=0?Math.floor(budget):300,fetchImpl,now,intervalMs,timeoutMs});this.inflight=new Map();this.dashboardRefreshes=new Map();this.dashboardCooldowns=new Map();this.dashboardTtl=Math.max(60_000,Number(process.env.MONI_DASHBOARD_TTL)||parts.projects.ttl);this.queue=Promise.resolve();this.nextAt=0;this.blockedUntil=0;
  db.exec('CREATE TABLE IF NOT EXISTS moni_cache(scope TEXT,handle TEXT,part TEXT,payload TEXT NOT NULL,fetched_at INTEGER NOT NULL,PRIMARY KEY(scope,handle,part)); CREATE TABLE IF NOT EXISTS moni_usage(scope TEXT,month TEXT,points INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(scope,month));');
  db.exec('CREATE TABLE IF NOT EXISTS social_watchlist(handle TEXT PRIMARY KEY,created_at TEXT NOT NULL)');
 }
 async projectOptions(){
  if(this.projectOptionsCache&&this.now()-this.projectOptionsCache.at<86400000)return this.projectOptionsCache.value;
  if(!this.#key)return {chains:[],tags:[],available:false};
  const get=async name=>{const response=await this.fetchImpl(new URL(`https://api.discover.getmoni.io/api/v3/basics/${name}/`),{headers:{Accept:'application/json','Api-Key':this.#key},signal:AbortSignal.timeout(this.timeoutMs),redirect:'error'});if(!response.ok)throw new Error('options unavailable');const body=await response.json(),rows=Array.isArray(body)?body:Array.isArray(body.items)?body.items:[];return rows.map(row=>({slug:String(row.slug||row.key||'').toLowerCase(),name:String(row.name||row.label||row.slug||'').slice(0,100)})).filter(row=>/^[a-z0-9_-]{1,80}$/.test(row.slug)).slice(0,500);};
  try{const [chains,tags]=await Promise.all([get('project_chains'),get('project_categories')]);const value={chains,tags,available:true};this.projectOptionsCache={at:this.now(),value};return value;}catch{return {chains:[],tags:[],available:false};}
 }
 watchlist(){return this.db.prepare('SELECT handle,created_at AS createdAt FROM social_watchlist ORDER BY created_at DESC,handle').all();}
 dashboard(filters={}){
  filters=projectFilters(filters);
  const accounts=this.watchlist();
  const cached=this.db.prepare('SELECT handle,payload,fetched_at AS fetchedAt FROM moni_cache WHERE scope=? AND part=\'profile\' ORDER BY fetched_at DESC LIMIT 20').all(this.scope);
  const byHandle=new Map(cached.map(row=>[row.handle,{...safeJson(row.payload),fetchedAt:new Date(row.fetchedAt).toISOString()}]));
  const identity=projectCacheHandle('all',filters);
  let projectCache=this.db.prepare("SELECT handle,payload,fetched_at AS fetchedAt FROM moni_cache WHERE scope=? AND part='projects' AND handle=?").get(this.scope,identity);
  // Read the original Socials cache for the unchanged default feed until it is
  // next explicitly refreshed into the filter-specific identity.
  if(!projectCache&&filters.orderBy==='CREATED_AT'&&JSON.stringify({...filters,orderBy:'CREATED_AT'})===JSON.stringify({...defaultProjectFilters,orderBy:'CREATED_AT'}))projectCache=this.db.prepare("SELECT handle,payload,fetched_at AS fetchedAt FROM moni_cache WHERE scope=? AND part='projects' AND handle='all'").get(this.scope);
  const projectPayload=projectCache?safeJson(projectCache.payload):null;
  const fetchedAt=projectCache?new Date(projectCache.fetchedAt).toISOString():null;
  const trending={
   filter:projectCache?'all':null,
   items:Array.isArray(projectPayload?.items)?projectPayload.items.slice(0,6):[],
   fetchedAt,
   stale:projectCache?this.now()-projectCache.fetchedAt>=parts.projects.ttl:false,
   filters,
   cacheStatus:!projectCache?'missing':this.now()-projectCache.fetchedAt>=parts.projects.ttl?'stale':'fresh',
   estimatedPoints:parts.projects.cost,
  };
  return {watchlistCount:accounts.length,accounts:accounts.slice(0,5).map(item=>({handle:item.handle,createdAt:item.createdAt,profile:byHandle.get(item.handle)||null})),trending};
 }
 async dashboardFeed(query={}, {force=false}={}){
  const filters=projectFilters(query),cached=this.projectCache(filters),identity=projectCacheHandle('all',filters),now=this.now();
  if(cached.fetchedAt){cached.stale=now-Date.parse(cached.fetchedAt)>=this.dashboardTtl;cached.cacheStatus=cached.stale?'stale':'fresh';}
  const toFeed=(entry,extra={})=>({filter:'all',items:entry.data?.items||[],fetchedAt:entry.fetchedAt,stale:!!entry.stale,filters,cacheStatus:entry.cacheStatus,estimatedPoints:filters.limit,...extra});
  if(cached.cacheStatus==='fresh'&&!force)return toFeed(cached,{refreshing:false});
  let request=this.dashboardRefreshes.get(identity);
  const cooldown=this.dashboardCooldowns.get(identity)||0;
  if(!request&&!force&&now<cooldown)return toFeed(cached,{refreshing:false,refreshError:cached.cacheStatus==='stale'?'Automatická obnova se nepodařila; ponechána starší data.':'Automatická obnova se nedávno nepodařila.'});
  if(!request){
   this.dashboardCooldowns.set(identity,now+60_000);
   request=this.get('all','projects',{filters,force:true}).then(result=>{this.dashboardCooldowns.delete(identity);return {filter:'all',items:result.data.items||[],fetchedAt:result.fetchedAt,stale:false,filters,cacheStatus:'fresh',estimatedPoints:filters.limit,refreshing:false};}).catch(error=>{this.dashboardCooldowns.set(identity,this.now()+60_000);return {filter:'all',items:cached.data?.items||[],fetchedAt:cached.fetchedAt,stale:!!cached.fetchedAt,filters,cacheStatus:cached.cacheStatus,estimatedPoints:filters.limit,refreshing:false,refreshError:error.message};}).finally(()=>this.dashboardRefreshes.delete(identity));
   this.dashboardRefreshes.set(identity,request);
  }
  if(cached.fetchedAt&&!force)return toFeed(cached,{refreshing:true});
  return request;
 }
 watch(handle){handle=String(handle||'').trim().replace(/^@/,'').toLowerCase();if(!/^[a-z0-9_]{1,15}$/.test(handle))throw failure(400,'Neplatný účet na X.');if(!this.db.prepare('SELECT 1 FROM social_watchlist WHERE handle=?').get(handle)&&this.watchlist().length>=100)throw failure(400,'Seznam může obsahovat nejvýše 100 účtů.');this.db.prepare('INSERT OR IGNORE INTO social_watchlist VALUES(?,?)').run(handle,new Date(this.now()).toISOString());return this.watchlist();}
 unwatch(handle){this.db.prepare('DELETE FROM social_watchlist WHERE handle=?').run(String(handle).toLowerCase());return this.watchlist();}
 status(){const month=new Date(this.now()).toISOString().slice(0,7);return {configured:!!this.#key,verified:!!this.db.prepare('SELECT 1 FROM moni_cache WHERE scope=? LIMIT 1').get(this.scope),estimatedPoints:this.db.prepare('SELECT points FROM moni_usage WHERE scope=? AND month=?').get(this.scope,month)?.points||0,monthlyBudget:this.budget,month,costs:Object.fromEntries(Object.entries(parts).map(([k,v])=>[k,v.cost]))};}
 projectCache(query='all',legacyFilters={}){
  let filters,handle='all';
  if(typeof query==='string'){handle=String(query||'all').toLowerCase();const input={...legacyFilters};if(handle!=='all'&&!input.chains)input.chains=[handle];filters=projectFilters(input);}
  else{filters=projectFilters(query);}
  const cacheHandle=projectCacheHandle('all',filters),row=this.db.prepare('SELECT * FROM moni_cache WHERE scope=? AND handle=? AND part=\'projects\'').get(this.scope,cacheHandle);
  if(!row)return {handle,part:'projects',filters,data:{items:[],limit:filters.limit,offset:filters.offset},fetchedAt:null,expiresAt:null,cached:true,stale:false,cacheStatus:'missing',usage:this.status()};
  const stale=this.now()-row.fetched_at>=parts.projects.ttl;
  return {handle,part:'projects',filters,data:JSON.parse(row.payload),fetchedAt:new Date(row.fetched_at).toISOString(),expiresAt:new Date(row.fetched_at+parts.projects.ttl).toISOString(),cached:true,stale,cacheStatus:stale?'stale':'fresh',usage:this.status()};
 }
 async get(handle,part,options={}){
  handle=String(handle||'').replace(/^@/,'').toLowerCase();
  if(!/^[a-z0-9_]{1,15}$/.test(handle)||!parts[part])throw failure(400,'Zadejte platný účet na X (1 až 15 znaků) a typ dat.');
  if(part==='projects'&&!['all','ethereum','base','arbitrum'].includes(handle))throw failure(400,'Neplatný filtr sítě.');
  const projectInput=part==='projects'?{...(options.filters||{}),...(handle!=='all'&&!(options.filters||{}).chains?{chains:[handle]}:{})}:null;
  const filters=part==='projects'?projectFilters(projectInput):null,cacheHandle=part==='projects'?projectCacheHandle('all',filters):handle;
  if(!this.#key)throw failure(503,'Moni API klíč není nastavený na serveru.');
  let cached=this.db.prepare('SELECT * FROM moni_cache WHERE scope=? AND handle=? AND part=?').get(this.scope,cacheHandle,part);
  if(options.force===true)cached=null;
  if(cached&&this.now()-cached.fetched_at<parts[part].ttl)return {handle,part,data:JSON.parse(cached.payload),filters,fetchedAt:new Date(cached.fetched_at).toISOString(),expiresAt:new Date(cached.fetched_at+parts[part].ttl).toISOString(),cached:true,source:'Moni',usage:this.status()};
  const envelope=(row,hit)=>({handle,part,data:JSON.parse(row.payload),filters, fetchedAt:new Date(row.fetched_at).toISOString(),expiresAt:new Date(row.fetched_at+parts[part].ttl).toISOString(),cached:hit,source:'Moni',usage:this.status()});
  if(cached&&this.now()-cached.fetched_at<parts[part].ttl)return envelope(cached,true);
  const id=cacheHandle+':'+part;if(this.inflight.has(id))return this.inflight.get(id);
  const request=this.queue.catch(()=>{}).then(async()=>{
   if(this.now()<this.blockedUntil)throw failure(429,'Moni dočasně omezilo přístup. Zkuste to později.');
   const status=this.status(),spec=parts[part],requestCost=part==='projects'?filters.limit:spec.cost;if(status.estimatedPoints+requestCost>this.budget)throw failure(429,'Byl dosažen místní měsíční rozpočet Moni. Změnit jej lze na serveru.');
   await delay(Math.max(0,this.nextAt-this.now()));this.nextAt=this.now()+this.intervalMs;
   if(part!=='projects')this.db.prepare('INSERT INTO moni_usage(scope,month,points) VALUES(?,?,?) ON CONFLICT(scope,month) DO UPDATE SET points=points+excluded.points').run(this.scope,status.month,requestCost);
   const projectPath=filters?.endpointMode==='raw'?'projects/raw/':'projects/';
   const url=new URL('https://api.discover.getmoni.io/api/v3/'+(part==='projects'?projectPath:'accounts/'+handle+'/'+spec.path));
   if(part==='projects'){for(const [key,value] of Object.entries(filters))if(key!=='endpointMode'&&value!==undefined&&value!==null&&value!==''&&key!=='offset'&&key!=='limit'){url.searchParams.set(key,Array.isArray(value)?value.join(','):String(value));}url.searchParams.set('limit',String(filters.limit));url.searchParams.set('offset',String(filters.offset));}
   else if(part!=='profile')url.searchParams.set('limit','20');
   if(part==='mentions')url.searchParams.set('fromDate',String(Math.floor(this.now()/1000)-7*86400));
   let response;try{response=await this.fetchImpl(url,{headers:{Accept:'application/json','Api-Key':this.#key},signal:AbortSignal.timeout(this.timeoutMs),redirect:'error'});}catch{throw failure(502,'Moni neodpovědělo včas nebo připojení selhalo. Požadavek neopakujeme automaticky.');}
   if(!response.ok){
    if([401,402,403,429].includes(response.status))this.blockedUntil=this.now()+60000;
    throw failure(response.status===404?404:502,({401:'Moni odmítlo API klíč.',402:'Moni hlásí nedostatek kreditů.',403:'Klíč nemá oprávnění k této funkci Moni.',404:'Moni tento účet nenašlo.',429:'Moni hlásí limit požadavků.'})[response.status]||'Moni je dočasně nedostupné.');
   }
   let payload;try{payload=await response.json();}catch{throw failure(502,'Moni vrátilo neplatnou odpověď.');}
   if(part==='projects'&&Array.isArray(payload.items))this.db.prepare('INSERT INTO moni_usage(scope,month,points) VALUES(?,?,?) ON CONFLICT(scope,month) DO UPDATE SET points=points+excluded.points').run(this.scope,status.month,payload.items.length);
   const data=normalize(payload,part,handle,filters);if(part==='projects')data.filters=filters;const row={payload:JSON.stringify(data),fetched_at:this.now()};
   this.db.prepare('INSERT INTO moni_cache(scope,handle,part,payload,fetched_at) VALUES(?,?,?,?,?) ON CONFLICT(scope,handle,part) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at').run(this.scope,cacheHandle,part,row.payload,row.fetched_at);
   return envelope(row,false);
  });
  this.queue=request.catch(()=>{});this.inflight.set(id,request);try{return await request;}finally{this.inflight.delete(id);}
 }
 async close(){await this.queue;}
}
