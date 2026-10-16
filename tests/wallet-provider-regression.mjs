import assert from 'node:assert/strict';
import {AlchemyWalletProvider,WalletProviderRouter,PROVIDER_LIMITS} from '../server/wallet-provider.mjs';
import {BlockscoutProvider,decodeHolding,decodeToken} from '../server/provider.mjs';
import {aggregateHoldings} from '../dist/data.js';
import {ScanEngine} from '../server/scans.mjs';
import {createApp} from '../server.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const address=i=>'0x'+i.toString(16).padStart(40,'0');
const breakerCooldownMs=60_000;
const owner=address(1),tokenAddress=address(10001),fresh=address(10002),secret='test-key-never-expose';
const response=(status,payload,headers={})=>({ok:status>=200&&status<300,status,json:async()=>payload,headers:{get:name=>headers[name.toLowerCase()]??null}});
const provider=(fetchImpl,options={})=>new AlchemyWalletProvider({apiKey:secret,retryMs:0,...options,fetchImpl});
const done=async(engine,id)=>{await engine.active.get(id)?.promise;return engine.result(id);};
const until=async(check)=>{const deadline=Date.now()+3000;while(!check()){if(Date.now()>deadline)throw Error('Test timed out waiting for scan state');await new Promise(resolve=>setTimeout(resolve,1));}};
const query=(chainIds=['ethereum'])=>({kind:'wallets',chainIds,addresses:[owner]});
const alchemyToken=(network='eth-mainnet',contract=tokenAddress)=>({address:owner,network,tokenAddress:contract,tokenBalance:'0x64',tokenMetadata:{decimals:0,name:'Fixture',symbol:'FIX'},tokenPrices:[{currency:'usd',value:'2'}]});
const payload=(network='eth-mainnet',contract=tokenAddress)=>({data:{tokens:[alchemyToken(network,contract)]}});
const emptyAlchemy=provider(async()=>response(200,{data:{tokens:[]}}));

// Provider-wide request gates pace requests and cap active Alchemy calls, even when scans queue work concurrently.
{
 let active=0,peak=0;const starts=[];const adapter=provider(async()=>{starts.push(Date.now());active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,320));active--;return response(200,{data:{tokens:[]}});});
 const router=new WalletProviderRouter({alchemy:adapter,blockscout:{supports:()=>false,page:async()=>({items:[],cursor:null})}});
 await Promise.all(Array.from({length:6},()=>router.page({kind:'wallets',chainId:'ethereum',address:owner,provider:'alchemy'})));
 assert.ok(peak<=PROVIDER_LIMITS.alchemy.concurrency);assert.ok(peak>1,'independent queued tasks may overlap within the configured provider concurrency');
 for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=PROVIDER_LIMITS.alchemy.intervalMs-20,'Alchemy requests respect the configured minimum interval');
}
const backup=(pageImpl=async()=>({items:[],cursor:null}),{allowed=['ethereum','optimism','arbitrum','robinhood','base']}={})=>({supports:(operation,chainId)=>['wallets','holders'].includes(operation)&&allowed.includes(chainId),page:pageImpl,metadata:async()=>{throw Error('Holder token metadata should stay on Blockscout');}});

// Blockscout Pro upgrades public-host 403s and keeps credentials out of cursors/results.
const blockscoutCalls=[],blockscoutKey='blockscout-test-key-never-expose';
const blockscoutPro=new BlockscoutProvider({proApiKey:blockscoutKey,intervalMs:0,retries:0,fetchImpl:async url=>{
 const parsed=new URL(url);blockscoutCalls.push(parsed);
 if(parsed.hostname!=='api.blockscout.com')return response(403,{error:'public host access denied'});
 assert.equal(parsed.searchParams.get('apikey'),blockscoutKey);
 return response(200,{items:[{token:{address_hash:tokenAddress,decimals:'18',exchange_rate:'2',name:'Fixture Token',symbol:'FIX',type:'ERC-20'},value:'2500000000000000000'}],next_page_params:{id:10,items_count:50}});
}});
const blockscoutPage=await blockscoutPro.page({kind:'wallets',chainId:'base',address:owner,provider:'blockscout',cursor:null});
assert.equal(blockscoutCalls.length,2);assert.equal(blockscoutCalls[0].hostname,'base.blockscout.com');assert.equal(blockscoutCalls[1].pathname,`/8453/api/v2/addresses/${owner}/tokens`);assert.deepEqual(blockscoutPage.cursor,{id:10,items_count:50});
await blockscoutPro.page({kind:'wallets',chainId:'base',address:owner,provider:'blockscout',cursor:blockscoutPage.cursor});
assert.equal(blockscoutCalls.length,4);assert.equal(blockscoutCalls[3].searchParams.get('id'),'10');assert.equal(blockscoutCalls[3].searchParams.get('apikey'),blockscoutKey);
const robinhoodCalls=[],robinhoodPro=new BlockscoutProvider({proApiKey:blockscoutKey,intervalMs:0,retries:0,fetchImpl:async url=>{const parsed=new URL(url);robinhoodCalls.push(parsed);assert.equal(parsed.hostname,'api.blockscout.com');return response(200,{items:[],next_page_params:null});}});
await robinhoodPro.page({kind:'holders',chainId:'robinhood',address:tokenAddress,provider:'blockscout',cursor:{value:'7',address_hash:owner,items_count:50}});
assert.equal(robinhoodCalls.length,1,'Robinhood Pro requests should bypass the known public-host 403 challenge');assert.equal(robinhoodCalls[0].pathname,`/4663/api/v2/tokens/${tokenAddress}/holders`);assert.equal(robinhoodCalls[0].searchParams.get('apikey'),blockscoutKey);assert.equal(robinhoodCalls[0].searchParams.get('value'),'7');assert.equal(robinhoodCalls[0].searchParams.get('address_hash'),owner);assert.equal(robinhoodCalls[0].searchParams.get('items_count'),'50');
const holding=decodeHolding(decodeToken(blockscoutPage.items[0].token,'base'),blockscoutPage.items[0].value);const tokenRows=aggregateHoldings([{address:owner,holdings:[holding]}],1);assert.equal(tokenRows.length,1);assert.equal(tokenRows[0].amount,2.5);assert.ok(!JSON.stringify({blockscoutPage,tokenRows}).includes(blockscoutKey));
let publicCalls=0;const publicOnly=new BlockscoutProvider({proApiKey:'',intervalMs:0,retries:0,fetchImpl:async()=>{publicCalls++;return {...response(403,{}),headers:{get:()=> 'text/html; charset=UTF-8'}};}});await assert.rejects(()=>publicOnly.page({kind:'wallets',chainId:'base',address:owner,provider:'blockscout'}),/HTTP 403/);assert.equal(publicCalls,1);

// Manual routes are validated by operation and chain. Base cannot use Blockscout for Wallet Analyzer.
const selected=new ScanEngine({filename:':memory:',provider:new WalletProviderRouter({alchemy:provider(async(_url,options)=>response(200,payload(JSON.parse(options.body).addresses[0].networks[0])),),blockscout:backup()})});
try{
 const automatic=selected.start(query()),result=await done(selected,automatic.id);assert.equal(result.job.tasks[0].provider,'alchemy');assert.deepEqual(result.job.tasks[0].providerAttempts.map(({provider,status})=>({provider,status})),[{provider:'alchemy',status:'success'}]);assert.equal(result.job.tasks[0].lastAttemptAt,result.job.tasks[0].lastSuccessAt,'successful completion records the same event time for attempt and usable data');assert.equal(result.job.tasks[0].fallbackUsed,false);assert.equal(result.coverage.providerLabel,'Alchemy');assert.equal(result.wallets[0].holdings.length,1);
 const manual=selected.start({...query(),provider:'blockscout'}),manualResult=await done(selected,manual.id);assert.equal(manualResult.job.tasks[0].provider,'blockscout');assert.equal(manualResult.job.query.provider,'blockscout');
 assert.equal(selected.provider.supports({kind:'wallets',chainId:'base',requestedProvider:'blockscout'}),false,'Blockscout must not be a Base wallet fallback');
 assert.equal(selected.provider.route({kind:'wallets',chainId:'base',requestedProvider:'auto'}).provider,'alchemy');
 assert.equal(selected.provider.supports({kind:'holders',chainId:'base'}),true,'holder scanner retains Blockscout');
  const baseAlchemy=selected.start({...query(['base']),provider:'alchemy'}),baseResult=await done(selected,baseAlchemy.id);assert.equal(baseResult.job.tasks[0].provider,'alchemy');assert.equal(baseResult.job.tasks[0].fallbackUsed,false);
 assert.throws(()=>selected.start({kind:'holders',chainIds:['base'],tokens:[{chainId:'base',address:tokenAddress}],provider:'alchemy'}),/nikoli hledání/);
   const explicitBase=selected.start({...query(['base']),provider:'blockscout'}),explicitBaseResult=await done(selected,explicitBase.id);assert.equal(explicitBaseResult.job.tasks[0].status,'unsupported');assert.match(explicitBaseResult.job.tasks[0].error,/Base/);
}finally{await selected.close();}
const unconfigured=new ScanEngine({filename:':memory:',provider:new WalletProviderRouter({alchemy:new AlchemyWalletProvider(),blockscout:backup()})});
try{const j=unconfigured.start(query(['base']));const r=await done(unconfigured,j.id);assert.equal(r.job.tasks[0].status,'unsupported');assert.match(r.job.tasks[0].error,/Base/);assert.equal(r.wallets.length,0);assert.throws(()=>unconfigured.start({...query(),provider:'alchemy'}),/klíč není nastavený/);}finally{await unconfigured.close();}

// Alchemy paging, normalization, retry-after, valid empty result, and non-retryable input errors.
let calls=0;const paged=provider(async(_url,options)=>{const body=JSON.parse(options.body);assert.equal(body.includeNativeTokens,false);assert.equal(body.includeErc20Tokens,true);calls++;if(calls===2)assert.equal(body.pageKey,'next');return response(200,{data:{tokens:[alchemyToken('base-mainnet')],pageKey:calls===1?'next':null}});});
const page1=await paged.page({kind:'wallets',chainId:'base',address:owner,cursor:null});assert.equal(page1.items[0].value,'100');assert.equal(page1.items[0].token.exchange_rate,'2');await paged.page({kind:'wallets',chainId:'base',address:owner,cursor:page1.cursor});assert.equal(calls,2);
let attempts=0;const rate=provider(async()=>++attempts===1?response(429,{error:{message:'Compute units per second limit exceeded'}},{'retry-after':'0'}):response(200,{data:{tokens:[]}}));assert.deepEqual(await rate.page({kind:'wallets',chainId:'base',address:owner}),{items:[],cursor:null});assert.equal(attempts,2);
let invalidCalls=0;const invalidAlchemy=provider(async()=>{invalidCalls++;return response(200,{data:{tokens:[]}});});await assert.rejects(()=>invalidAlchemy.page({kind:'wallets',chainId:'base',address:'not-an-address'}),/Neplatná adresa/);assert.equal(invalidCalls,0,'invalid wallet input never reaches a provider');
await assert.rejects(()=>provider(async()=>response(402,{error:'Insufficient credit'})).page({kind:'wallets',chainId:'base',address:owner}),e=>e.kind==='quota');
await assert.rejects(()=>provider(async()=>response(403,{error:'Cloudflare challenge'})).page({kind:'wallets',chainId:'base',address:owner}),e=>e.kind==='protection'&&e.retryable);
await assert.rejects(()=>provider(async()=>response(403,{error:{message:'App access denied'}})).page({kind:'wallets',chainId:'base',address:owner}),e=>e.kind==='access'&&!e.retryable);
await assert.rejects(()=>provider(async()=>response(400,{error:'Invalid address'})).page({kind:'wallets',chainId:'base',address:owner}),e=>!e.retryable);
await assert.rejects(()=>provider(async()=>response(200,{error:{partialErrors:[{message:'network failed'}]}})).page({kind:'wallets',chainId:'base',address:owner}),e=>e.kind==='outage'&&e.retryable);
await assert.rejects(()=>provider(async()=>{throw new TypeError('fetch failed '+secret);}).page({kind:'wallets',chainId:'base',address:owner}),e=>e.kind==='outage'&&!e.message.includes(secret));
await assert.rejects(()=>provider(async()=>response(200,{data:{tokens:[{...alchemyToken('base-mainnet'),address:address(99)}]}})).page({kind:'wallets',chainId:'base',address:owner}),e=>e.retryable);

// Alchemy 429 -> Blockscout fallback; fallback discards only that network's prior Alchemy pages.
let alchemyCalls=0,backupCalls=0,clock=0;
const alchemy=provider(async()=>++alchemyCalls===1?response(200,{data:{tokens:[alchemyToken('eth-mainnet')],pageKey:'alchemy-only'}}):response(429,{error:'rate limit'},{'retry-after':'0'}),{retries:0,now:()=>clock});
const backupAfterFailure=backup(async task=>{backupCalls++;assert.equal(task.provider,'blockscout');assert.equal(task.cursor,null);return {items:[{token:{address_hash:fresh,decimals:0,symbol:'NEW',exchange_rate:'3'},value:'7'}],cursor:null};},{allowed:['ethereum']});
const fallbackRouter=new WalletProviderRouter({alchemy,blockscout:backupAfterFailure,now:()=>clock});const fallbackEngine=new ScanEngine({filename:':memory:',provider:fallbackRouter});
try{
 const job=fallbackEngine.start(query(['ethereum'])),r=await done(fallbackEngine,job.id);const task=r.job.tasks[0];assert.equal(r.job.status,'complete','provider fallback alone is not a partial/data-quality status');assert.equal(task.provider,'blockscout');assert.equal(task.fallbackUsed,true);assert.equal(task.fallbackFrom,'alchemy');assert.match(task.fallbackReason,/limit/);assert.ok(task.asOf);assert.equal(task.lastAttemptAt,task.lastSuccessAt,'successful fallback records attempt and usable-data time together');assert.deepEqual(task.providerAttempts.map(({provider,status})=>({provider,status})),[{provider:'alchemy',status:'retryable_failure'},{provider:'blockscout',status:'success'}]);assert.equal(task.providerProvenanceComplete,true);assert.equal(r.coverage.provenance[0].chainId,'ethereum');assert.equal(r.coverage.provenance[0].fallbackUsed,true);assert.equal(r.coverage.provenance[0].provider,'blockscout');assert.deepEqual(r.coverage.provenance[0].providerAttempts.map(({provider,status})=>({provider,status})),[{provider:'alchemy',status:'retryable_failure'},{provider:'blockscout',status:'success'}]);assert.ok(!r.warnings.some(w=>w.includes('Použit Blockscout')),'successful fallback is informational provenance, not a data-quality warning');assert.equal(r.wallets[0].holdings[0].address,fresh);assert.equal(backupCalls,1);assert.equal(alchemyCalls,2);assert.ok(!JSON.stringify(r).includes(secret));
}finally{await fallbackEngine.close();}

// Successful fallback and data-quality warnings remain independent dimensions.
{
 const router={supports:()=>true,choose:()=> 'alchemy',fallback:(task,error)=>task.provider==='alchemy'&&error.retryable?'blockscout':null,fallbackReason:()=> 'Alchemy rate limit.',async page(task){if(task.provider==='alchemy'){const error=new Error('Alchemy rate limit');error.retryable=true;throw error;}return {items:[{address_hash:'invalid-wallet',token:{address_hash:tokenAddress,symbol:'BAD'},value:'1'}],cursor:null};}};
 const engine=new ScanEngine({filename:':memory:',provider:router});try{const result=await done(engine,engine.start(query(['ethereum'])).id),task=result.job.tasks[0];assert.equal(result.job.status,'complete_with_warnings');assert.equal(task.dataQuality,'warning');assert.deepEqual(task.providerAttempts.map(({provider,status})=>({provider,status})),[{provider:'alchemy',status:'retryable_failure'},{provider:'blockscout',status:'success'}]);assert.equal(result.coverage.provenance[0].provider,'blockscout');assert.equal(result.coverage.provenance[0].invalidRows,1);assert.equal(result.coverage.provenance[0].dataQuality,'warning');assert.ok(result.warnings.some(w=>w.includes('neinterpretovaných řádků')),'data-quality warning remains visible independently of fallback info');}finally{await engine.close();}
}

// A provider switch must stay inside the original atomic task claim while fallback I/O is pending.
{
 let releaseFallback,signalFallbackStarted,primaryCalls=0,fallbackCalls=0,successfulClaims=0,finalTransitions=0;
 const fallbackGate=new Promise(resolve=>releaseFallback=resolve),fallbackStarted=new Promise(resolve=>signalFallbackStarted=resolve);
 const raceProvider={supports:()=>true,choose:()=> 'alchemy',fallback(task,error){return task.provider==='alchemy'&&error.retryable?'blockscout':null;},fallbackReason:()=> 'Alchemy returned a retryable rate limit.',async page(task){if(task.provider==='alchemy'){primaryCalls++;const error=new Error('retryable provider failure');error.retryable=true;throw error;}fallbackCalls++;signalFallbackStarted();await fallbackGate;return {items:[{token:{address_hash:fresh,decimals:0,name:'Race Token',symbol:'RACE'},value:'1'}],cursor:null};}};
 const engine=new ScanEngine({filename:':memory:',provider:raceProvider,taskConcurrency:2});const originalClaim=engine.claimTask.bind(engine),originalStop=engine.store.stopRuntime.bind(engine.store);
 engine.claimTask=id=>{const task=originalClaim(id);if(task)successfulClaims++;return task;};engine.store.stopRuntime=(id,status,message,options)=>{if(options?.finished)finalTransitions++;return originalStop(id,status,message,options);};
 let job;
 try{
  job=engine.start(query(['ethereum']));await fallbackStarted;
  assert.equal(engine.store.tasks(job.id)[0].status,'running','the claimed task remains running during fallback I/O');
  assert.equal(engine.claimTask(job.id),null,'a second worker cannot claim the task during fallback');
  await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(fallbackCalls,1,'the fallback provider is not invoked by a second worker');
  assert.equal(engine.store.tasks(job.id)[0].status,'running','provider change never exposes a pending task');
  releaseFallback();const result=await done(engine,job.id),task=result.job.tasks[0];
  assert.equal(primaryCalls,1);assert.equal(successfulClaims,1,'exactly one worker successfully claimed this task');assert.equal(fallbackCalls,1);
  assert.equal(task.status,'complete');assert.equal(task.provider,'blockscout');assert.equal(task.fallbackUsed,true);assert.equal(task.fallbackFrom,'alchemy');assert.match(task.fallbackReason,/rate limit/);
  assert.equal(result.job.status,'complete');assert.equal(finalTransitions,1,'the scan reaches its final state once');
  assert.equal(engine.store.db.prepare('SELECT COUNT(*) AS n FROM positions WHERE scan_id=?').get(job.id).n,1,'one provider page produces one stored position');
  assert.equal(engine.store.db.prepare('SELECT COUNT(*) AS n FROM cursors WHERE scan_id=?').get(job.id).n,1,'the committed fallback page cursor is written once');
  assert.equal(task.pages,1);assert.equal(result.coverage.provenance[0].fallbackFrom,'alchemy');assert.match(result.coverage.provenance[0].fallbackReason,/rate limit/);assert.equal(result.coverage.provenance[0].provider,'blockscout');
 }finally{releaseFallback();if(job)await engine.active.get(job.id)?.promise;await engine.close();}
}

// The other configured fallback routes handle timeouts, server errors, and HTTP 402 as well.
for(const [chainId,failure] of [
 ['optimism',async()=>{const error=new Error('timeout');error.name='TimeoutError';throw error;}],
 ['arbitrum',async()=>response(500,{error:'temporary server failure'})],
 ['ethereum',async()=>response(402,{error:'credit payment required'})],
]){
 const fallbackCalls=[];const routeRouter=new WalletProviderRouter({alchemy:provider(failure,{retries:0}),blockscout:backup(async task=>{fallbackCalls.push(task.chainId);return {items:[],cursor:null};},{allowed:[chainId]})});const routeEngine=new ScanEngine({filename:':memory:',provider:routeRouter});
 try{const r=await done(routeEngine,routeEngine.start(query([chainId])).id);assert.equal(r.job.tasks[0].provider,'blockscout',`${chainId} falls back to Blockscout`);assert.equal(r.job.tasks[0].fallbackFrom,'alchemy');assert.ok(r.job.tasks[0].fallbackReason);assert.ok(r.job.tasks[0].asOf);assert.deepEqual(fallbackCalls,[chainId]);}finally{await routeEngine.close();}
}

// Base never sends a Blockscout request after Alchemy fails; 200 with zero tokens is still success.
// A later page failure advances lastAttemptAt but preserves the last committed data timestamp.
{
 let engine,scanId,pageCalls=0,priorSuccessAt=null;
 const router={supports:()=>true,choose:()=> 'alchemy',fallback:()=>null,async page(){if(pageCalls++===0)return {items:[{token:{address_hash:fresh,decimals:0,name:'Freshness Token',symbol:'FRESH'},value:'1'}],cursor:{page:2}};priorSuccessAt=engine.store.tasks(scanId)[0].as_of;await new Promise(resolve=>setTimeout(resolve,20));throw new Error('later page failed');}};
 engine=new ScanEngine({filename:':memory:',provider:router});try{const started=engine.start(query(['ethereum']));scanId=started.id;const result=await done(engine,scanId),task=result.job.tasks[0];assert.equal(result.job.status,'partial');assert.ok(priorSuccessAt);assert.equal(task.lastSuccessAt,priorSuccessAt);assert.equal(task.asOf,priorSuccessAt);assert.ok(task.lastAttemptAt>=priorSuccessAt);assert.equal(result.coverage.lastSuccessAt,priorSuccessAt);assert.equal(result.coverage.asOf,priorSuccessAt);assert.ok(result.coverage.lastAttemptAt>=result.coverage.lastSuccessAt);assert.equal(task.providerAttempts.at(-1).status,'failure');assert.ok(task.providerAttempts.at(-1).lastAttemptAt>=priorSuccessAt);}finally{await engine.close();}
}
// A primary failure followed by a failed fallback must not erase a prior
// successful page's freshness, even though fallback restarts that source's scan.
{
 let engine,scanId,priorSuccessAt=null,alchemyCalls=0,blockscoutCalls=0;
 const router={supports:()=>true,choose:()=> 'alchemy',fallback(task,error){return task.provider==='alchemy'&&error.retryable?'blockscout':null;},fallbackReason:()=> 'Alchemy retryable failure.',async page(task){
  if(task.provider==='alchemy'&&!task.cursor){alchemyCalls++;return {items:[{token:{address_hash:fresh,decimals:0,name:'Previously loaded',symbol:'OLD'},value:'1'}],cursor:{page:2}};}
  if(task.provider==='alchemy'){alchemyCalls++;priorSuccessAt=engine.store.tasks(scanId)[0].as_of;await new Promise(resolve=>setTimeout(resolve,25));const error=new Error('Alchemy later page failed');error.retryable=true;throw error;}
  blockscoutCalls++;await new Promise(resolve=>setTimeout(resolve,25));throw new Error('Blockscout fallback failed');
 }};
 engine=new ScanEngine({filename:':memory:',provider:router});try{
  const started=engine.start(query(['ethereum']));scanId=started.id;const result=await done(engine,scanId),task=result.job.tasks[0];
  assert.equal(result.job.status,'partial');assert.ok(priorSuccessAt);assert.equal(alchemyCalls,2);assert.equal(blockscoutCalls,1);
  assert.equal(task.lastSuccessAt,priorSuccessAt,'failed fallback preserves the last successful-data timestamp');
  assert.equal(result.coverage.lastSuccessAt,priorSuccessAt);assert.equal(result.coverage.asOf,priorSuccessAt,'failure does not move reported data freshness');
  assert.ok(task.lastAttemptAt>priorSuccessAt);assert.deepEqual(task.providerAttempts.map(({provider,status})=>({provider,status})),[{provider:'alchemy',status:'retryable_failure'},{provider:'blockscout',status:'failure'}]);
 }finally{await engine.close();}
}
// When another task has older usable data, failures at both providers advance only the attempt timestamp.
{
 const router={supports:()=>true,choose:()=> 'alchemy',fallback(task,error){return task.provider==='alchemy'&&error.retryable?'blockscout':null;},async page(task){if(task.address===owner)return {items:[],cursor:null};await new Promise(resolve=>setTimeout(resolve,40));const error=new Error(`${task.provider} unavailable`);if(task.provider==='alchemy')error.retryable=true;throw error;}};
 const engine=new ScanEngine({filename:':memory:',provider:router});try{const result=await done(engine,engine.start({kind:'wallets',chainIds:['ethereum'],addresses:[owner,fresh]}).id),successTask=result.job.tasks.find(task=>task.address===owner),failedTask=result.job.tasks.find(task=>task.address===fresh);assert.equal(result.job.status,'partial');assert.equal(successTask.status,'complete');assert.equal(failedTask.status,'error');assert.equal(failedTask.asOf,null);assert.equal(failedTask.providerAttempts.map(attempt=>attempt.status).join(','),'retryable_failure,failure');assert.ok(failedTask.lastAttemptAt);assert.equal(result.coverage.lastSuccessAt,successTask.lastSuccessAt,'failed primary and fallback calls do not replace the scan’s last successful data time');assert.equal(result.coverage.asOf,result.coverage.lastSuccessAt);assert.ok(result.coverage.lastAttemptAt>result.coverage.lastSuccessAt,'the latest failed request is observable separately from data freshness');}finally{await engine.close();}
}
let baseAlchemy=0,baseBackup=0;const baseRouter=new WalletProviderRouter({alchemy:provider(async()=>{baseAlchemy++;return response(503,{error:'temporary outage'});},{retries:0}),blockscout:backup(async()=>{baseBackup++;return {items:[],cursor:null};})});
const baseEngine=new ScanEngine({filename:':memory:',provider:baseRouter});try{const job=baseEngine.start(query(['base'])),r=await done(baseEngine,job.id);assert.equal(r.job.status,'partial');assert.equal(r.job.tasks[0].status,'error');assert.equal(r.job.tasks[0].provider,'alchemy');assert.equal(r.job.tasks[0].asOf,null,'provider failure does not refresh last-success timestamp');assert.equal(r.coverage.asOf,null);assert.ok(r.coverage.lastAttemptAt);assert.deepEqual(r.job.tasks[0].providerAttempts.map(({provider,status})=>({provider,status})),[{provider:'alchemy',status:'failure'}]);assert.match(r.job.tasks[0].error,/Záloha Blockscout pro tuto síť není dostupná/);assert.equal(baseAlchemy,1);assert.equal(baseBackup,0);}finally{await baseEngine.close();}
let zeroBackup=0;const zeroRouter=new WalletProviderRouter({alchemy:provider(async()=>response(200,{data:{tokens:[]}})),blockscout:backup(async()=>{zeroBackup++;return {items:[],cursor:null};})});const zeroEngine=new ScanEngine({filename:':memory:',provider:zeroRouter});try{const r=await done(zeroEngine,zeroEngine.start(query(['base'])).id);assert.equal(r.job.status,'complete');assert.equal(r.job.tasks[0].provider,'alchemy');assert.equal(r.job.tasks[0].fallbackUsed,false);assert.equal(zeroBackup,0);}finally{await zeroEngine.close();}

// Circuit breakers are isolated per provider + network and let the primary recover after cooldown.
clock=0;let recoverAlchemy=false;const attemptsByChain=new Map();const breakerAlchemy=provider(async(_url,options)=>{const chain=JSON.parse(options.body).addresses[0].networks[0];attemptsByChain.set(chain,(attemptsByChain.get(chain)||0)+1);return chain==='eth-mainnet'&&!recoverAlchemy?response(500,{error:'temporary outage'}):response(200,{data:{tokens:[]}});},{retries:0,now:()=>clock});
const breakerFallback=backup(async()=>({items:[],cursor:null}),{allowed:['ethereum']});const breakerRouter=new WalletProviderRouter({alchemy:breakerAlchemy,blockscout:breakerFallback,now:()=>clock});const breakerEngine=new ScanEngine({filename:':memory:',provider:breakerRouter});
try{
 for(let i=0;i<3;i++){const r=await done(breakerEngine,breakerEngine.start({...query(['ethereum']),refresh:true}).id);assert.equal(r.job.tasks[0].provider,'blockscout');}
 const routes=breakerRouter.status().walletProfiler;assert.equal(routes.circuitBreakers.length,1);assert.equal(routes.circuitBreakers[0].provider,'alchemy');assert.equal(routes.circuitBreakers[0].chainId,'ethereum');assert.equal(breakerRouter.route({kind:'wallets',chainId:'ethereum',requestedProvider:'auto'}).provider,'blockscout');assert.equal(breakerRouter.route({kind:'wallets',chainId:'base',requestedProvider:'auto'}).provider,'alchemy');
  const held=breakerEngine.start({...query(['ethereum']),refresh:true});assert.equal(held.tasks[0].provider,'blockscout');assert.equal(held.tasks[0].fallbackFrom,'alchemy');assert.match(held.tasks[0].fallbackReason,/Jistič/);await done(breakerEngine,held.id);
  const otherNetwork=await done(breakerEngine,breakerEngine.start({...query(['base']),refresh:true}).id);assert.equal(otherNetwork.job.tasks[0].provider,'alchemy');assert.equal(attemptsByChain.get('base-mainnet'),1,'Ethereum circuit does not affect Base');
  clock=breakerCooldownMs+1;recoverAlchemy=true;assert.equal(breakerRouter.route({kind:'wallets',chainId:'ethereum',requestedProvider:'auto'}).provider,'alchemy');const recovered=await done(breakerEngine,breakerEngine.start({...query(['ethereum']),refresh:true}).id);assert.equal(recovered.job.tasks[0].provider,'alchemy');assert.equal(breakerRouter.status().walletProfiler.circuitBreakers.length,0);
}finally{await breakerEngine.close();}

// A multi-network scan uses independent providers, retains successes, and reports per-network provenance.
const seen=[];const multiRouter=new WalletProviderRouter({alchemy:provider(async(_url,options)=>{const id=JSON.parse(options.body).addresses[0].networks[0];seen.push(['alchemy',id]);if(id==='base-mainnet')return response(429,{error:'rate limit'});return response(200,{data:{tokens:[alchemyToken(id)]}});},{retries:0}),blockscout:backup(async task=>{seen.push(['blockscout',task.chainId]);return {items:[{token:{address_hash:fresh,decimals:0,symbol:'RH',exchange_rate:'1'},value:'1'}],cursor:null};})});
const multiEngine=new ScanEngine({filename:':memory:',provider:multiRouter});try{
 const result=await done(multiEngine,multiEngine.start(query(['ethereum','base','optimism','arbitrum','robinhood'])).id);assert.equal(result.job.status,'partial');assert.deepEqual(result.job.tasks.map(t=>[t.chainId,t.provider]),[['arbitrum','alchemy'],['base','alchemy'],['ethereum','alchemy'],['optimism','alchemy'],['robinhood','blockscout']]);assert.equal(result.coverage.providerLabel,'Alchemy + Blockscout','scan summary names only providers that actually returned data');assert.equal(result.wallets.length,1);assert.deepEqual(result.wallets[0].chainIds.sort(),['arbitrum','ethereum','optimism','robinhood'].sort());assert.equal(result.coverage.provenance.length,5);assert.deepEqual(result.coverage.provenance.find(p=>p.chainId==='base').providerAttempts.map(({provider,status})=>({provider,status})),[{provider:'alchemy',status:'failure'}]);assert.ok(result.coverage.provenance.find(p=>p.chainId==='base'&&p.status==='error'));assert.ok(seen.some(x=>x[0]==='blockscout'&&x[1]==='robinhood'));assert.ok(!seen.some(x=>x[0]==='blockscout'&&x[1]==='base'));
}finally{await multiEngine.close();}

// A paused fallback retains provider/provenance/cursor across SQLite restart.
const temp=await mkdtemp(path.join(tmpdir(),'chaindetective-provider-'));
try{
 let entered;const waiting=new Promise(resolve=>entered=resolve);
 // Pause through the request signal while preserving the first committed page.
 const first=new ScanEngine({filename:path.join(temp,'scan.sqlite'),provider:new WalletProviderRouter({alchemy:provider(async()=>response(402,{error:'Insufficient credit'})),blockscout:backup(async(task,signal)=>task.cursor?new Promise((resolve,reject)=>{entered();signal.addEventListener('abort',()=>reject(signal.reason),{once:true});}):{items:[],cursor:{backupPage:2}},{allowed:['ethereum']})})});
 const started=first.start(query(['ethereum']));await waiting;await first.pause(started.id);assert.equal(first.store.tasks(started.id)[0].provider,'blockscout');assert.equal(first.store.tasks(started.id)[0].fallback_from,'alchemy');await first.close();
 const second=new ScanEngine({filename:path.join(temp,'scan.sqlite'),provider:new WalletProviderRouter({alchemy:provider(async()=>{throw Error('Must not switch providers on resume');}),blockscout:backup(async task=>{assert.deepEqual(task.cursor,{backupPage:2});return {items:[],cursor:null};},{allowed:['ethereum']})})});try{second.resume(started.id);const r=await done(second,started.id);assert.equal(r.job.status,'complete');assert.equal(r.job.tasks[0].provider,'blockscout');assert.equal(r.job.tasks[0].fallbackFrom,'alchemy');assert.ok(r.job.tasks[0].asOf);}finally{await second.close();}
}finally{assert.ok(path.resolve(temp).startsWith(path.resolve(tmpdir())+path.sep+'chaindetective-provider-'));await rm(temp,{recursive:true,force:true});}

// /api/providers reveals route/circuit status and configuration only, never credentials.
const apiRouter=new WalletProviderRouter({alchemy:provider(async()=>response(200,{data:{tokens:[]}})),blockscout:new BlockscoutProvider({proApiKey:blockscoutKey})});
const app=createApp({dbPath:':memory:',provider:apiRouter});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
try{const config=await fetch(`http://127.0.0.1:${app.server.address().port}/api/providers`).then(r=>r.json());assert.equal(config.walletProfiler.alchemyConfigured,true);assert.deepEqual(config.walletProfiler.alchemyChains,['ethereum','base','optimism','arbitrum']);assert.deepEqual(config.walletProfiler.blockscoutChains,['ethereum','optimism','arbitrum','robinhood']);assert.deepEqual(config.walletProfiler.fallbackChains,['ethereum','optimism','arbitrum']);assert.equal(config.walletProfiler.routes.find(r=>r.chainId==='base').provider,'alchemy');assert.ok(!JSON.stringify(config).includes(secret));assert.ok(!JSON.stringify(config).includes(blockscoutKey));}finally{await app.close();}

console.log('Wallet provider regressions passed: routing, atomic task claims, in-task fallback ownership, pause/resume, network-isolated circuit breakers, provenance, and secret-free diagnostics.');
