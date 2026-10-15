import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const parts={profile:{path:'info/full/',cost:8,ttl:86400000},mentions:{path:'feed/smart_mentions/',cost:4,ttl:3600000},smarts:{path:'smarts/full/',cost:5,ttl:86400000},projects:{path:'projects/',cost:10,ttl:21600000}};
const failure=(status,message)=>Object.assign(new Error(message),{status});
const count=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const names=v=>Array.isArray(v)?v.slice(0,20).map(x=>String(x?.name||'').slice(0,100)).filter(Boolean):[];
function xUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname)?u.href:null;}catch{return null;}}
function profile(data,handle){
 const e=data?.smartEngagement,p=data?.smartProfile||{};
 if(!e||typeof e!=='object')throw failure(502,'Moni vrátilo neznámý formát profilu.');
 return {handle,url:xUrl(data.meta?.userUrl),score:count(e.moniScore),smartsCount:count(e.smartsCount),mentionsCount:count(e.mentionsCount),smartMentionsCount:count(e.smartMentionsCount),tier:count(p.smartTier?.tier),tags:names(p.smartTags),categories:names(p.projectTags),chains:names(p.chains)};
}
function normalize(data,part,handle){
 if(part==='profile')return profile(data,handle);
 if(!Array.isArray(data?.items))throw failure(502,'Moni vrátilo neznámý formát seznamu.');
 if(part==='projects')return {items:data.items.slice(0,10).map(row=>{const url=xUrl(row.meta?.userUrl),handle=url?new URL(url).pathname.split('/')[1]:'';if(!/^[a-z0-9_]{1,15}$/i.test(handle))throw failure(502,'Moni vrátilo neplatný účet projektu.');return {...profile(row,handle),smartsChange:Number.isFinite(row.smartEngagement?.smartFollowersCountChange)?row.smartEngagement.smartFollowersCountChange:null};}),limit:10,periodDays:7};
 if(part==='smarts')return {items:data.items.slice(0,20).map(row=>profile(row,new URL(xUrl(row.meta?.userUrl)||'https://x.com/unknown').pathname.slice(1))),total:count(data.totalCount),limit:20};
 return {items:data.items.slice(0,20).map(row=>({at:count(row.createdAt),authorUrl:xUrl(row.data?.mentionBy?.userUrl),postUrl:xUrl(row.data?.postUrl)})),periodDays:7,limit:20};
}
export class MoniService{
 #key;
 constructor(db,{apiKey=process.env.MONI_API_KEY||'',budget=Number(process.env.MONI_MONTHLY_BUDGET||300),fetchImpl=globalThis.fetch,now=Date.now,intervalMs=1100,timeoutMs=35000}={}){
  this.db=db;this.#key=apiKey.trim();this.scope=createHash('sha256').update(this.#key).digest('hex').slice(0,16);
  Object.assign(this,{budget:Number.isFinite(budget)&&budget>=0?Math.floor(budget):300,fetchImpl,now,intervalMs,timeoutMs});this.inflight=new Map();this.queue=Promise.resolve();this.nextAt=0;this.blockedUntil=0;
  db.exec('CREATE TABLE IF NOT EXISTS moni_cache(scope TEXT,handle TEXT,part TEXT,payload TEXT NOT NULL,fetched_at INTEGER NOT NULL,PRIMARY KEY(scope,handle,part)); CREATE TABLE IF NOT EXISTS moni_usage(scope TEXT,month TEXT,points INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(scope,month));');
  db.exec('CREATE TABLE IF NOT EXISTS social_watchlist(handle TEXT PRIMARY KEY,created_at TEXT NOT NULL)');
 }
 watchlist(){return this.db.prepare('SELECT handle,created_at AS createdAt FROM social_watchlist ORDER BY created_at DESC,handle').all();}
 watch(handle){handle=String(handle||'').trim().replace(/^@/,'').toLowerCase();if(!/^[a-z0-9_]{1,15}$/.test(handle))throw failure(400,'Neplatný účet na X.');if(!this.db.prepare('SELECT 1 FROM social_watchlist WHERE handle=?').get(handle)&&this.watchlist().length>=100)throw failure(400,'Seznam může obsahovat nejvýše 100 účtů.');this.db.prepare('INSERT OR IGNORE INTO social_watchlist VALUES(?,?)').run(handle,new Date(this.now()).toISOString());return this.watchlist();}
 unwatch(handle){this.db.prepare('DELETE FROM social_watchlist WHERE handle=?').run(String(handle).toLowerCase());return this.watchlist();}
 status(){const month=new Date(this.now()).toISOString().slice(0,7);return {configured:!!this.#key,verified:!!this.db.prepare('SELECT 1 FROM moni_cache WHERE scope=? LIMIT 1').get(this.scope),estimatedPoints:this.db.prepare('SELECT points FROM moni_usage WHERE scope=? AND month=?').get(this.scope,month)?.points||0,monthlyBudget:this.budget,month,costs:Object.fromEntries(Object.entries(parts).map(([k,v])=>[k,v.cost]))};}
 async get(handle,part){
  handle=String(handle||'').replace(/^@/,'').toLowerCase();
  if(!/^[a-z0-9_]{1,15}$/.test(handle)||!parts[part])throw failure(400,'Zadejte platný účet na X (1 až 15 znaků) a typ dat.');
  if(part==='projects'&&!['all','ethereum','base','arbitrum'].includes(handle))throw failure(400,'Neplatný filtr sítě.');
  if(!this.#key)throw failure(503,'Moni API klíč není nastavený na serveru.');
  const cached=this.db.prepare('SELECT * FROM moni_cache WHERE scope=? AND handle=? AND part=?').get(this.scope,handle,part);
  const envelope=(row,hit)=>({handle,part,data:JSON.parse(row.payload),fetchedAt:new Date(row.fetched_at).toISOString(),expiresAt:new Date(row.fetched_at+parts[part].ttl).toISOString(),cached:hit,source:'Moni',usage:this.status()});
  if(cached&&this.now()-cached.fetched_at<parts[part].ttl)return envelope(cached,true);
  const id=handle+':'+part;if(this.inflight.has(id))return this.inflight.get(id);
  const request=this.queue.catch(()=>{}).then(async()=>{
   if(this.now()<this.blockedUntil)throw failure(429,'Moni dočasně omezilo přístup. Zkuste to později.');
   const status=this.status(),spec=parts[part];if(status.estimatedPoints+spec.cost>this.budget)throw failure(429,'Byl dosažen místní měsíční rozpočet Moni. Změnit jej lze na serveru.');
   await delay(Math.max(0,this.nextAt-this.now()));this.nextAt=this.now()+this.intervalMs;
   this.db.prepare('INSERT INTO moni_usage(scope,month,points) VALUES(?,?,?) ON CONFLICT(scope,month) DO UPDATE SET points=points+excluded.points').run(this.scope,status.month,spec.cost);
   const url=new URL('https://api.discover.getmoni.io/api/v3/'+(part==='projects'?spec.path:'accounts/'+handle+'/'+spec.path));
   if(part==='projects'){url.searchParams.set('limit','10');url.searchParams.set('offset','0');url.searchParams.set('feedTimeframe','D7');url.searchParams.set('changesTimeframe','H24');if(handle!=='all')url.searchParams.set('chains',handle);}
   else if(part!=='profile')url.searchParams.set('limit','20');
   if(part==='mentions')url.searchParams.set('fromDate',String(Math.floor(this.now()/1000)-7*86400));
   let response;try{response=await this.fetchImpl(url,{headers:{Accept:'application/json','Api-Key':this.#key},signal:AbortSignal.timeout(this.timeoutMs),redirect:'error'});}catch{throw failure(502,'Moni neodpovědělo včas nebo připojení selhalo. Požadavek neopakujeme automaticky.');}
   if(!response.ok){
    if([401,402,403,429].includes(response.status))this.blockedUntil=this.now()+60000;
    throw failure(response.status===404?404:502,({401:'Moni odmítlo API klíč.',402:'Moni hlásí nedostatek kreditů.',403:'Klíč nemá oprávnění k této funkci Moni.',404:'Moni tento účet nenašlo.',429:'Moni hlásí limit požadavků.'})[response.status]||'Moni je dočasně nedostupné.');
   }
   let payload;try{payload=await response.json();}catch{throw failure(502,'Moni vrátilo neplatnou odpověď.');}
   const data=normalize(payload,part,handle),row={payload:JSON.stringify(data),fetched_at:this.now()};
   if(part==='projects'&&payload.items.length<10)this.db.prepare('UPDATE moni_usage SET points=points-? WHERE scope=? AND month=?').run(10-payload.items.length,this.scope,status.month);
   this.db.prepare('INSERT INTO moni_cache(scope,handle,part,payload,fetched_at) VALUES(?,?,?,?,?) ON CONFLICT(scope,handle,part) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at').run(this.scope,handle,part,row.payload,row.fetched_at);
   return envelope(row,false);
  });
  this.queue=request.catch(()=>{});this.inflight.set(id,request);try{return await request;}finally{this.inflight.delete(id);}
 }
 async close(){await this.queue;}
}
