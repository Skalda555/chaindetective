import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ScanEngine,ScanStore,validateQuery} from '../server/scans.mjs';
import {BlockscoutProvider,decodeToken,decodeHolding} from '../server/provider.mjs';
import handler,{createApp} from '../server.mjs';
assert.equal(typeof handler,'function','Vercel entrypoint must export a default HTTP handler');
const address=i=>'0x'+i.toString(16).padStart(40,'0');
const A=address(1),B=address(2),TA=address(10001),TB=address(10002),COMMON=address(9999);
const query={kind:'holders',chainIds:['base'],match:'all',tokens:[{chainId:'base',address:TA},{chainId:'base',address:TB}]};
assert.deepEqual(validateQuery({...query,chainIds:['robinhood'],tokens:[{chainId:'robinhood',address:TA}]}).chainIds,['robinhood']);
for(const retired of ['zksync','scroll','linea'])assert.throws(()=>validateQuery({...query,chainIds:[retired],tokens:[{chainId:retired,address:TA}]}),/podporované sítě/);
const metadata=async t=>({id:`${t.chainId}:${t.address}`,chainId:t.chainId,address:t.address,symbol:t.address===TA?'ONE':'TWO',name:'Fixture token',decimals:0,price:2});
const finished=async(e,id)=>{await e.active.get(id)?.promise;return e.store.describe(id);};
async function until(check){const deadline=Date.now()+3000;while(!check()){if(Date.now()>deadline)throw Error('Test timed out');await delay(1);}}
{
 const e=new ScanEngine({filename:':memory:',provider:{metadata,page:async()=>({items:[],cursor:null})}}),id='legacy-linea-scan',legacyQuery={kind:'wallets',chainIds:['linea'],addresses:[A],provider:'blockscout'};
 const now=new Date().toISOString();e.store.db.prepare('INSERT INTO scans(id,query_key,query_json,status,created_at,updated_at,message) VALUES(?,?,?,?,?,?,?)').run(id,'legacy-fixture',JSON.stringify(legacyQuery),'partial',now,now,'Historic scan');
 e.store.db.prepare('INSERT INTO tasks(scan_id,task_key,kind,chain_id,address,status,error,provider) VALUES(?,?,?,?,?,?,?,?)').run(id,'linea:'+A,'wallets','linea',A,'error','Historic provider result','blockscout');
 try{const result=e.result(id);assert.deepEqual(result.job.query.chainIds,['linea']);assert.match(result.warnings.join(' '),/Linea/,'existing legacy scans still render with their archived network name');}finally{await e.close();}
}

// A shared owner appears only on page four of both tokens, beyond the old 150 limit.
{
 let calls=0;
 const provider={metadata,async page(task){calls++;const n=task.cursor?.page||0;const start=task.address===TA?1:201;
  const items=Array.from({length:50},(_,i)=>({address:{hash:n===3&&i===49?COMMON:address(start+n*50+i)},value:'1'}));
  return {items,cursor:n<3?{page:n+1}:null};}};
 const e=new ScanEngine({filename:':memory:',provider});
 try{
  const j=e.start(query);await finished(e,j.id);
  const r=e.result(j.id);assert.equal(r.wallets.length,1);assert.equal(r.wallets[0].address,COMMON);assert.equal(r.wallets[0].value,4);
  assert.equal(r.coverage.complete,true);assert.equal(r.coverage.snapshotConsistent,false);assert.equal(r.job.pages,8);assert.equal(calls,8);
  const cached=e.start({...query,tokens:[...query.tokens].reverse()});assert.equal(cached.id,j.id);assert.equal(cached.cached,true);assert.equal(calls,8);
  const fresh=e.start({...query,refresh:true});assert.notEqual(fresh.id,j.id);await finished(e,fresh.id);assert.equal(calls,16);
  const or=e.start({...query,match:'any'});await finished(e,or.id);const p1=e.result(or.id,{limit:100});assert.equal(p1.pagination.total,399);assert.equal(p1.wallets.length,100);
  const p2=e.result(or.id,{offset:p1.pagination.nextOffset,limit:100,revision:p1.pagination.revision});assert.notEqual(p2.wallets[0].address,p1.wallets[0].address);
  assert.throws(()=>e.result(or.id,{revision:999}),/změnily/);
 }finally{await e.close();}
}

// A committed page and cursor survive pause, provider failure, and a server restart.
const temp=await mkdtemp(path.join(os.tmpdir(),'chaindetective-tests-'));
try{
 const filename=path.join(temp,'resume.sqlite');let firstCalls=0;
 const firstProvider={metadata,async page(task,signal){firstCalls++;if(!task.cursor)return {items:[{address:{hash:A},value:'2'}],cursor:{page:2}};await delay(10000,undefined,{signal});throw Error('unreachable');}};
 const e=new ScanEngine({filename,provider:firstProvider});const j=e.start({...query,tokens:[query.tokens[0]]});
 await until(()=>e.store.tasks(j.id)[0].pages===1);await e.pause(j.id);
 assert.equal(e.result(j.id).wallets.length,1);assert.equal(e.result(j.id).coverage.complete,false);assert.equal(e.store.tasks(j.id)[0].cursor.page,2);
 e.store.touch(j.id,'running','Simulate process interruption');await e.close();
 let resumedCalls=0;
 const provider={metadata:async()=>{throw Error('Metadata must be reused');},async page(task){resumedCalls++;assert.equal(task.cursor.page,2);if(resumedCalls===1)throw Error('Temporary provider failure');return {items:[{address:{hash:A},value:'2'},{address:{hash:B},value:'3'}],cursor:null};}};
 const reopened=new ScanEngine({filename,provider});
 try{
  assert.equal(reopened.store.describe(j.id).status,'paused');reopened.resume(j.id);await finished(reopened,j.id);
  assert.equal(reopened.store.describe(j.id).status,'partial');assert.equal(reopened.result(j.id).wallets.length,1);
  reopened.resume(j.id);await finished(reopened,j.id);const result=reopened.result(j.id);
  assert.equal(result.coverage.complete,true);assert.equal(result.wallets.length,2);assert.equal(result.wallets.find(w=>w.address===A).value,4,'overlap must not double balances');assert.equal(result.job.pages,2);
 }finally{await reopened.close();}

 // A repeated pagination cursor stops with explicit partial coverage, never loops forever.
 const looping=new ScanEngine({filename:':memory:',provider:{metadata,page:async()=>({items:[{address:{hash:A},value:'1'}],cursor:{page:1}})}});
 try{const job=looping.start({...query,tokens:[query.tokens[0]]});await finished(looping,job.id);assert.equal(looping.store.describe(job.id).status,'partial');assert.match(looping.result(job.id).warnings.join(' '),/kurzor/);assert.equal(looping.result(job.id).job.pages,1);}finally{await looping.close();}

 // Empty successful wallets and unknown prices are distinct from failed API queries.
 const wallets=new ScanEngine({filename:':memory:',provider:{metadata,async page(task){if(task.address===B)throw Error('API unavailable');return {items:[],cursor:null};}}});
 try{const j=wallets.start({kind:'wallets',chainIds:['base'],addresses:[A,B]});await finished(wallets,j.id);const r=wallets.result(j.id);assert.equal(r.wallets.length,1);assert.equal(r.wallets[0].address,A);assert.equal(r.wallets[0].value,0);assert.equal(r.coverage.complete,false);}finally{await wallets.close();}
 const partial=new ScanEngine({filename:':memory:',provider:{metadata,async page(task){if(task.chainId==='base')throw Error('Indexer odpověděl HTTP 403 (HTML challenge místo JSON).');return {items:[{token:{address_hash:TA,decimals:'0',symbol:'LIVE',name:'Live token',exchange_rate:'2'},value:'7'}],cursor:null};}}});
 try{const j=partial.start({kind:'wallets',chainIds:['base','ethereum'],addresses:[A],provider:'blockscout'});await finished(partial,j.id);const r=partial.result(j.id);assert.equal(r.job.status,'partial');assert.equal(r.wallets[0].holdings.length,1,'a failed network must not discard a successful network result');assert.equal(r.tokens.length,1);assert.equal(r.tokens[0].symbol,'LIVE');assert.match(r.warnings.join(' '),/Base: Indexer odpověděl HTTP 403/);assert.equal(r.coverage.details.find(d=>d.chainId==='base').status,'error');}finally{await partial.close();}
 const bad=decodeToken({address_hash:TA,decimals:null,exchange_rate:null},'base');assert.throws(()=>decodeHolding(bad,'1000'),/desetinn/);
 assert.equal(decodeHolding(decodeToken({address_hash:TA,decimals:0,exchange_rate:null},'base'),'17').value,null);
 assert.equal(decodeHolding(decodeToken({address_hash:TA,decimals:6,exchange_rate:'1'},'base'),'1230000').amount,1.23);

 // Test the real HTTP boundary, including stored results and request origin validation.
 const app=createApp({dbPath:path.join(temp,'http.sqlite'),provider:{metadata,page:async()=>({items:[{address:{hash:A},value:'1'}],cursor:null})}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${app.server.address().port}`;
 try{
  const health=await fetch(origin+'/api/health').then(r=>r.json());assert.equal(health.backendVersion,2);
  const invalid=await fetch(origin+'/api/scans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...query,tokens:[{chainId:'base',address:'https://example.com'}]})});assert.equal(invalid.status,400);
  const denied=await fetch(origin+'/api/scans',{headers:{Origin:'https://other.example'}});assert.equal(denied.status,403);
  assert.equal((await fetch(origin+'/.data/http.sqlite')).status,404);
  const created=await fetch(origin+'/api/scans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...query,tokens:[query.tokens[0]]})}).then(r=>r.json());
  await finished(app.scans,created.id);const result=await fetch(origin+'/api/scans/'+created.id+'/result').then(r=>r.json());assert.equal(result.wallets.length,1);assert.equal(result.coverage.complete,true);
  const history=await fetch(origin+'/api/scans').then(r=>r.json());assert.equal(history.scans.length,1);
  const kept=app.scans.start({...query,tokens:[query.tokens[0]],refresh:true});await finished(app.scans,kept.id);
  const db=app.scans.store.db;
  for(const table of ['tasks','positions','cursors'])assert.ok(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE scan_id=?`).get(created.id).n>0,table+' fixture must contain data');
  const refused=await fetch(origin+'/api/scans/'+created.id,{method:'DELETE',headers:{Origin:'https://other.example'}});assert.equal(refused.status,403);assert.ok(app.scans.store.get(created.id));
  const removed=await fetch(origin+'/api/scans/'+created.id,{method:'DELETE'});assert.equal(removed.status,200);assert.deepEqual(await removed.json(),{id:created.id,deleted:true});
  assert.equal(app.scans.store.get(created.id),undefined);
  for(const table of ['tasks','positions','cursors']){
   assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE scan_id=?`).get(created.id).n,0,table+' must cascade');
   assert.ok(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE scan_id=?`).get(kept.id).n>0,'other scan '+table+' must remain');
  }
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal((await fetch(origin+'/api/scans').then(r=>r.json())).scans.length,1);
  for(const suffix of ['','/result','/resume'])assert.equal((await fetch(origin+'/api/scans/'+created.id+suffix,{method:suffix==='/resume'?'POST':'GET'})).status,404);
  assert.equal((await fetch(origin+'/api/scans/'+created.id,{method:'DELETE'})).status,404);
  // Active writers must be rejected even during the pause/abort settling window.
  app.scans.provider={metadata,async page(task,signal){await delay(10000,undefined,{signal});return {items:[],cursor:null};}};
  const running=app.scans.start({...query,tokens:[query.tokens[0]],refresh:true});
  assert.equal((await fetch(origin+'/api/scans/'+running.id,{method:'DELETE'})).status,409);
  const stopping=app.scans.pause(running.id);
  assert.throws(()=>app.scans.remove(running.id),error=>error.status===409);
  await stopping;
  assert.equal((await fetch(origin+'/api/scans/'+running.id,{method:'DELETE'})).status,200);
  assert.ok(app.scans.store.get(kept.id));assert.equal(app.scans.result(kept.id).wallets.length,1);
 }finally{await app.close();}
}finally{
 const resolved=path.resolve(temp);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep+'chaindetective-tests-'));await rm(resolved,{recursive:true,force:true});
}

// Backoff retries transient failures; the provider never follows a user-supplied URL.
{
 let calls=0;const provider=new BlockscoutProvider({intervalMs:0,retries:1,fetchImpl:async url=>{calls++;assert.equal(url.hostname,'base.blockscout.com');if(calls===1)return {ok:false,status:429,headers:{get:()=>null}};return {ok:true,json:async()=>({items:[],next_page_params:null})};}});
 const r=await provider.page({kind:'holders',chainId:'base',address:TA,cursor:null});assert.deepEqual(r.items,[]);assert.equal(calls,2);
}
{
 const routes=[],provider=new BlockscoutProvider({intervalMs:0,retries:0,fetchImpl:async url=>{routes.push(url.href);assert.equal(url.hostname,'robinhoodchain.blockscout.com');return {ok:true,json:async()=>url.pathname.endsWith('/holders')?{items:[{address:{hash:A},value:'7'}],next_page_params:null}:url.pathname.includes('/addresses/')?{items:[{token:{address_hash:TA},value:'7'}],next_page_params:null}:{address_hash:TA,decimals:'18',symbol:'RH',name:'Robinhood',type:'ERC-20'}};}});
 assert.equal((await provider.metadata({chainId:'robinhood',address:TA})).symbol,'RH');
 assert.equal((await provider.page({kind:'holders',chainId:'robinhood',address:TA,cursor:null})).items.length,1);
 assert.equal((await provider.page({kind:'wallets',chainId:'robinhood',address:A,cursor:null})).items.length,1);
 assert.deepEqual(routes.map(url=>new URL(url).pathname),[`/api/v2/tokens/${TA}`,`/api/v2/tokens/${TA}/holders`,`/api/v2/addresses/${A}/tokens`]);
}
console.log('Server regressions passed: late AND matches, unlimited pages, cache, SQLite resume, pause, API errors, cursor loops, deduplication and HTTP isolation.');
