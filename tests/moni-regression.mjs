import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MoniService} from '../server/moni.mjs';
import {createApp} from '../server.mjs';
const secret='fixture-private-key';
const payload={meta:{userUrl:'https://x.com/ethereum'},smartEngagement:{moniScore:123,smartsCount:8,smartMentionsCount:4},smartProfile:{smartTags:[{name:'Project'}],chains:[{name:'Ethereum'}]}};
const response=(data=payload,status=200)=>({ok:status===200,status,json:async()=>data});
const db=new DatabaseSync(':memory:');let calls=0,now=Date.now();
const service=new MoniService(db,{apiKey:secret,budget:30,intervalMs:0,now:()=>now,fetchImpl:async(url,options)=>{calls++;assert.equal(url.hostname,'api.discover.getmoni.io');assert.equal(options.headers['Api-Key'],secret);assert.equal(options.redirect,'error');if(url.pathname.includes('smart_mentions')){assert.equal(url.searchParams.get('limit'),'20');assert.ok(url.searchParams.has('fromDate'));return response({items:[{createdAt:1,data:{mentionBy:{userUrl:'javascript:alert(1)'},postUrl:'https://attacker.example'}}]});}return response();}});
try{
 const [one,two]=await Promise.all([service.get('@Ethereum','profile'),service.get('ethereum','profile')]);assert.equal(calls,1);assert.equal(one.data.score,123);assert.equal(two.data.score,123);assert.equal(service.status().estimatedPoints,8);
 const cached=await service.get('ethereum','profile');assert.equal(cached.cached,true);assert.equal(calls,1);assert.equal(service.status().verified,true);assert.ok(!JSON.stringify(cached).includes(secret));
 const reopened=new MoniService(db,{apiKey:secret,intervalMs:0,now:()=>now,fetchImpl:()=>{throw Error('Cache must survive service restart');}});assert.equal((await reopened.get('ethereum','profile')).cached,true);
 const mentions=await service.get('ethereum','mentions');assert.equal(mentions.data.items[0].postUrl,null);assert.equal(mentions.data.items[0].authorUrl,null);assert.equal(service.status().estimatedPoints,12);
 await assert.rejects(()=>service.get('../secret','profile'),/platný/);await assert.rejects(()=>service.get('ethereum','other'),/platný/);assert.equal(calls,2);
 now+=86400001;assert.equal((await service.get('ethereum','profile')).cached,false);assert.equal(calls,3);
 await service.get('base','profile');assert.equal(service.status().estimatedPoints,28);await assert.rejects(()=>service.get('arb','profile'),/rozpočet/);assert.equal(calls,4);
 const changedKey=new MoniService(db,{apiKey:'different-key',intervalMs:0,fetchImpl:async()=>response()});assert.equal((await changedKey.get('ethereum','profile')).cached,false,'cache must be isolated after key changes');
}finally{await service.close();db.close();}

// Never expose provider error bodies or native fetch errors containing credentials.
for(const status of [401,402,403,429,500]){
 const db=new DatabaseSync(':memory:');let calls=0;
 const service=new MoniService(db,{apiKey:secret,intervalMs:0,fetchImpl:async()=>{calls++;return response({error:secret},status);}});
 try{await assert.rejects(()=>service.get('ethereum','profile'),error=>!error.message.includes(secret));assert.equal(calls,1);assert.equal(service.status().verified,false);assert.equal(service.status().estimatedPoints,8);}finally{await service.close();db.close();}
}
{
 const db=new DatabaseSync(':memory:');
 const service=new MoniService(db,{apiKey:secret,intervalMs:0,fetchImpl:async()=>{throw new TypeError('Network failed with '+secret);}});
 try{await assert.rejects(()=>service.get('ethereum','profile'),error=>error.status===502&&!error.message.includes(secret));}finally{await service.close();db.close();}
}
const app=createApp({dbPath:':memory:',moniOptions:{apiKey:secret,intervalMs:0,fetchImpl:async()=>response()}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${app.server.address().port}`;
try{
 const status=await fetch(origin+'/api/socials/moni/status').then(r=>r.json());assert.equal(status.configured,true);assert.equal(status.estimatedPoints,0);assert.ok(!JSON.stringify(status).includes(secret));
 const denied=await fetch(origin+'/api/socials/moni/account',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:JSON.stringify({handle:'ethereum',part:'profile'})});assert.equal(denied.status,403);assert.equal(app.moni.status().estimatedPoints,0);
 const result=await fetch(origin+'/api/socials/moni/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle:'ethereum',part:'profile'})}).then(r=>r.json());assert.equal(result.data.score,123);assert.ok(!JSON.stringify(result).includes(secret));
 assert.equal((await fetch(origin+'/.env')).status,404);
}finally{await app.close();}
console.log('Moni regressions passed: cache, concurrent deduplication, restart, budget, expiry, key isolation, safe errors and HTTP origin guard.');

{
 const db=new DatabaseSync(':memory:');let calls=0;
 const s=new MoniService(db,{apiKey:secret,budget:30,intervalMs:0,fetchImpl:async url=>{calls++;assert.equal(url.pathname,'/api/v3/projects/');assert.equal(url.searchParams.get('limit'),'10');assert.equal(url.searchParams.get('feedTimeframe'),'D7');assert.equal(url.searchParams.get('orderBy'),'SCORE');return response({items:[{...payload,smartEngagement:{...payload.smartEngagement,smartMentionsCountChange:2,smartFollowersCountChange:99}},{...payload,meta:{userUrl:'https://x.com/other'}}]});}});
 try{const feed=await s.get('all','projects');assert.equal(feed.data.items.length,2);assert.equal(feed.filters.orderBy,'SCORE');assert.equal(feed.data.items[0].score,123);assert.equal(feed.data.items[0].smartsCount,8);assert.equal(feed.data.items[0].scoreChange,null,'Projects Feed fixture does not expose Moni Score change');assert.equal(feed.data.items[0].smartsChange,null,'Smart follower count change is not Smarts change');assert.equal(feed.data.items[0].smartMentionsChange,2);assert.equal(s.status().estimatedPoints,2);assert.equal(s.projectCache('all').cacheStatus,'fresh');await s.get('all','projects');assert.equal(calls,1);await s.get('base','projects');assert.equal(calls,2);assert.equal(s.status().estimatedPoints,4);await assert.rejects(()=>s.get('bogus','projects'),/filtr/);
 s.watch('@Ethereum');s.watch('ethereum');assert.equal(s.watchlist().length,1);assert.equal(new MoniService(db,{apiKey:''}).watchlist()[0].handle,'ethereum');assert.throws(()=>s.watch('../bad'),/Neplatný/);s.unwatch('ethereum');assert.equal(s.watchlist().length,0);
 }finally{await s.close();db.close();}
}

{
 const db=new DatabaseSync(':memory:');let calls=0,now=Date.now();const raw={...payload,smartEngagement:{...payload.smartEngagement,smartMentionsCountChange:3}};
 const service=new MoniService(db,{apiKey:secret,intervalMs:0,now:()=>now,fetchImpl:async url=>{calls++;assert.equal(url.searchParams.get('orderBy'),'SCORE_CHANGE');return response({items:[raw]});}});
 try{
  const filters={feedTimeframe:'D7',changesTimeframe:'H24',orderBy:'SCORE_CHANGE',orderByDirection:'DESC'};
  const missing=service.projectCache('all',filters);assert.equal(missing.cacheStatus,'missing');assert.equal(calls,0,'cache lookup never triggers a paid request');
  const loaded=await service.get('all','projects',{filters,force:true});assert.equal(calls,1);assert.equal(loaded.data.items[0].scoreChange,null);assert.equal(loaded.data.items[0].smartMentionsChange,3);
  assert.equal(service.projectCache('all',filters).cacheStatus,'fresh');assert.equal(service.projectCache('base',filters).cacheStatus,'missing','chain has its own cache identity');
  assert.equal(service.projectCache('all',{...filters,orderBy:'SCORE'}).cacheStatus,'missing','sort mode has its own cache identity');
  now+=6*60*60*1000+1;const stale=service.projectCache('all',filters);assert.equal(stale.cacheStatus,'stale');assert.equal(stale.data.items.length,1);assert.equal(calls,1,'stale cache is served without auto-refresh');
 }finally{await service.close();db.close();}
}

{
 let calls=0,requestUrl=null;const app=createApp({dbPath:':memory:',moniOptions:{apiKey:secret,intervalMs:0,fetchImpl:async url=>{calls++;requestUrl=url;return response({items:[payload]});}}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${app.server.address().port}`;
 try{
  const filters={endpointMode:'curated',feedTimeframe:'D7',changesTimeframe:'H24',orderBy:'SCORE_CHANGE',orderByDirection:'DESC',limit:10,offset:0},query=new URLSearchParams({...filters});
  const missing=await fetch(origin+'/api/socials/moni/projects?'+query).then(r=>r.json());assert.equal(missing.cacheStatus,'missing');assert.equal(calls,0,'reading selected Socials cache must not spend Moni points');
  const loaded=await fetch(origin+'/api/socials/moni/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:filters})}).then(r=>r.json());assert.equal(loaded.data.items.length,1);assert.equal(requestUrl.searchParams.get('orderBy'),'SCORE_CHANGE');assert.equal(calls,1);
  const saved=await fetch(origin+'/api/socials/moni/projects?'+query).then(r=>r.json());assert.equal(saved.cacheStatus,'fresh');assert.equal(saved.data.items[0].score,123);assert.equal(calls,1,'reload serves matching SQLite cache without another request');
  const different=await fetch(origin+'/api/socials/moni/projects?'+new URLSearchParams({...filters,orderBy:'SCORE'})).then(r=>r.json());assert.equal(different.cacheStatus,'missing');assert.equal(calls,1,'different sort mode cannot use another query cache');
 }finally{await app.close();}
}
