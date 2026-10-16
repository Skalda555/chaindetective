import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createApp} from '../server.mjs';

const key='dashboard-refresh-test-key',now=Date.parse('2026-10-16T10:00:00Z');
const row=(name,score)=>({meta:{userUrl:`https://x.com/${name}`,createdAt:'2026-10-01T00:00:00Z'},smartEngagement:{moniScore:score,smartsCount:9,smartMentionsCount:4,smartMentionsCountChange:2},smartProfile:{projectTags:[{name:'DeFi'}],chains:[{name:'Base'}]}});
const response=items=>({ok:true,status:200,json:async()=>({items})});
const start=async moniOptions=>{const app=createApp({dbPath:':memory:',moniOptions:{apiKey:key,intervalMs:0,now:()=>now,...moniOptions},aixbtOptions:{fetchImpl:async()=>({ok:true,status:200,json:async()=>({items:[]})})}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));return {app,origin:`http://127.0.0.1:${app.server.address().port}`};};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

{
 let calls=0;const {app,origin}=await start({fetchImpl:async()=>{calls++;return response([row('growing',8)]);}});
 try{const data=await fetch(origin+'/api/dashboard').then(r=>r.json());assert.equal(data.moni.trending.filters.orderBy,'SCORE_CHANGE');assert.equal(data.moni.trending.items[0].handle,'growing');assert.equal(data.moni.trending.items[0].scoreChange,null);assert.equal(calls,1,'missing default view automatically loads exactly once');const again=await fetch(origin+'/api/dashboard?view=growing').then(r=>r.json());assert.equal(again.moni.trending.cacheStatus,'fresh');assert.equal(calls,1,'fresh cache avoids paid requests');}finally{await app.close();}
}
{
 let calls=0;const {app,origin}=await start({fetchImpl:async()=>{calls++;await wait(15);return response([row('parallel',10)]);}});
 try{const results=await Promise.all(Array.from({length:4},()=>fetch(origin+'/api/dashboard?view=top').then(r=>r.json())));assert.equal(calls,1,'concurrent missing dashboard requests share the same paid refresh');assert.ok(results.every(x=>x.moni.trending.items[0]?.handle==='parallel'));assert.equal(app.moni.status().estimatedPoints,1);}finally{await app.close();}
}
{
 let calls=0,fail=false;const {app,origin}=await start({fetchImpl:async()=>{calls++;if(fail)throw Error('fixture offline');return response([row('old',20)]);}});
 const filters={endpointMode:'curated',feedTimeframe:'D7',changesTimeframe:'H24',orderBy:'SCORE_CHANGE',orderByDirection:'DESC',limit:10,offset:0};
 try{
  await fetch(origin+'/api/dashboard').then(r=>r.json());assert.equal(calls,1);
  const scope=createHash('sha256').update(key).digest('hex').slice(0,16),identity=app.scans.store.db.prepare("SELECT handle FROM moni_cache WHERE scope=? AND part='projects'").get(scope).handle;
  app.scans.store.db.prepare('UPDATE moni_cache SET fetched_at=? WHERE scope=? AND handle=? AND part=\'projects\'').run(now-7*60*60*1000,scope,identity);
  fail=true;const stale=await fetch(origin+'/api/dashboard').then(r=>r.json());assert.equal(stale.moni.trending.stale,true);assert.equal(stale.moni.trending.items[0].handle,'old');assert.equal(stale.moni.trending.refreshing,true,'stale data remains visible while background refresh runs');await wait(5);
  const after=await fetch(origin+'/api/dashboard').then(r=>r.json());assert.equal(after.moni.trending.items[0].handle,'old');assert.equal(after.moni.trending.stale,true);assert.match(after.moni.trending.refreshError,/Automatická obnova se nepodařila/);assert.equal(calls,2,'only one background refresh was attempted; failure preserves cached rows');
 }finally{await app.close();}
}
{
 let calls=0,orders=[];const {app,origin}=await start({fetchImpl:async url=>{calls++;orders.push(url.searchParams.get('orderBy'));return response([row('result'+calls,calls)]);}});
 try{
  const topFilters={endpointMode:'curated',feedTimeframe:'D7',changesTimeframe:'H24',orderBy:'SCORE',orderByDirection:'DESC',limit:10,offset:0};
  await app.moni.get('all','projects',{filters:topFilters,force:true});
  const top=await fetch(origin+'/api/dashboard?view=top').then(r=>r.json());assert.equal(top.moni.trending.items[0].handle,'result1');assert.equal(calls,1,'switch to fresh Top Score cache costs zero');
  const newest=await fetch(origin+'/api/dashboard?view=new').then(r=>r.json());assert.equal(newest.moni.trending.filters.orderBy,'CREATED_AT');assert.equal(newest.moni.trending.items[0].handle,'result2');assert.equal(calls,2,'only newly selected missing view refreshes');assert.deepEqual(orders,['SCORE','CREATED_AT']);
  const manual=await fetch(origin+'/api/dashboard/moni/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filters:{...topFilters,orderBy:'SCORE'}})}).then(r=>r.json());assert.equal(manual.items[0].handle,'result3');assert.equal(calls,3,'manual refresh can bypass freshness');
 }finally{await app.close();}
}
console.log('MONI dashboard refresh regressions passed: fresh cache, missing/stale auto-refresh, TTL, view isolation, request deduplication, manual refresh and stale-cache preservation.');
