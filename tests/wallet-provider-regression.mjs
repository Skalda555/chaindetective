import assert from 'node:assert/strict';
import {AlchemyWalletProvider,WalletProviderRouter} from '../server/wallet-provider.mjs';
import {ScanEngine} from '../server/scans.mjs';
import {createApp} from '../server.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const address=i=>'0x'+i.toString(16).padStart(40,'0');
const owner=address(1),old=address(10001),fresh=address(10002),secret='test-key-never-expose';
const task={kind:'wallets',chainId:'base',address:owner,provider:'alchemy',cursor:null};
const token=(contract=old,network='base-mainnet')=>({address:owner,network,tokenAddress:contract,tokenBalance:'0x64',tokenMetadata:{decimals:0,name:'Fixture',symbol:'FIX'},tokenPrices:[{currency:'usd',value:'2'}]});
const response=(status,payload)=>({ok:status>=200&&status<300,status,json:async()=>payload});
const provider=fetchImpl=>new AlchemyWalletProvider({apiKey:secret,fetchImpl,retryMs:0});
const done=async(e,id)=>{await e.active.get(id)?.promise;return e.result(id);};
const query={kind:'wallets',chainIds:['base'],addresses:[owner]};

// Manual selection affects execution and cache identity; unavailable adapters fail explicitly.
const selected=new ScanEngine({filename:':memory:',provider:new WalletProviderRouter({alchemy:provider(async()=>response(200,{data:{tokens:[token()]}})),blockscout:{async page(){return {items:[],cursor:null};}}})});
try{
 const manual=selected.start({...query,provider:'blockscout'}),b=await done(selected,manual.id);assert.equal(b.job.tasks[0].provider,'blockscout');assert.equal(b.wallets[0].holdings.length,0);assert.equal(b.job.query.provider,'blockscout');
 const automatic=selected.start(query),a=await done(selected,automatic.id);assert.notEqual(a.job.id,b.job.id);assert.equal(a.job.tasks[0].provider,'alchemy');assert.equal(a.wallets[0].holdings.length,1);
 const explicit=selected.start({...query,provider:'alchemy'}),c=await done(selected,explicit.id);assert.equal(c.job.query.provider,'alchemy');assert.notEqual(c.job.id,a.job.id);
 assert.throws(()=>selected.start({...query,provider:'chainbase'}),/není připojený/);
 assert.throws(()=>selected.start({kind:'holders',chainIds:['base'],tokens:[{chainId:'base',address:old}],provider:'alchemy'}),/nikoli hledání/);
 const unsupported=selected.start({...query,chainIds:['scroll'],provider:'blockscout'}),u=await done(selected,unsupported.id);assert.equal(u.job.tasks[0].status,'unsupported');assert.equal(u.coverage.complete,false);
}finally{await selected.close();}
const unconfigured=new ScanEngine({filename:':memory:',provider:new WalletProviderRouter({alchemy:new AlchemyWalletProvider()})});
try{assert.throws(()=>unconfigured.start({...query,provider:'alchemy'}),/klíč není nastavený/);}finally{await unconfigured.close();}

// Raw balances, metadata, USD prices and continuation keys survive normalization.
let calls=0;
const paged=provider(async(url,options)=>{assert.ok(url.startsWith('https://api.g.alchemy.com/'));const body=JSON.parse(options.body);assert.equal(body.includeNativeTokens,false);assert.equal(body.includeErc20Tokens,true);calls++;if(calls===2)assert.equal(body.pageKey,'next');return response(200,{data:{tokens:[token()],pageKey:calls===1?'next':null}});});
const p1=await paged.page(task);assert.equal(p1.items[0].value,'100');assert.equal(p1.items[0].token.exchange_rate,'2');await paged.page({...task,cursor:p1.cursor});assert.equal(calls,2);

// Throughput limits retry; empty successful responses are not failures.
let attempts=0;
const rate=provider(async()=>++attempts===1?response(429,{error:{message:'Compute units per second limit exceeded'}}):response(200,{data:{tokens:[]}}));
assert.deepEqual(await rate.page(task),{items:[],cursor:null});assert.equal(attempts,2);
await assert.rejects(()=>provider(async()=>response(403,{error:{message:'Monthly capacity limit exceeded'}})).page(task),e=>e.kind==='quota');
await assert.rejects(()=>provider(async()=>response(403,{error:{message:'App access denied'}})).page(task),e=>e.kind==='access');
await assert.rejects(()=>provider(async()=>response(200,{error:{partialErrors:[{message:'network failed'}]}})).page(task),e=>e.kind==='outage');
await assert.rejects(()=>provider(async()=>{throw new TypeError('fetch failed '+secret);}).page(task),e=>e.kind==='outage'&&!e.message.includes(secret));

// A quota failure after a committed page starts Blockscout at page one.
let alchemyCalls=0,backupCalls=0,clock=0;
const alchemy=provider(async()=>++alchemyCalls===1?response(200,{data:{tokens:[token()],pageKey:'alchemy-only'}}):response(403,{error:{message:'Monthly capacity limit exceeded'}}));
const backup={async page(t){backupCalls++;assert.equal(t.provider,'blockscout');assert.equal(t.cursor,null);return {items:[{token:{address_hash:fresh,decimals:0,symbol:'NEW',exchange_rate:'3'},value:'7'}],cursor:null};}};
const router=new WalletProviderRouter({alchemy,blockscout:backup,now:()=>clock});
const e=new ScanEngine({filename:':memory:',provider:router});
try{
 const j=e.start(query),r=await done(e,j.id);assert.equal(r.coverage.complete,true);assert.equal(r.job.pages,1);assert.equal(r.wallets[0].holdings.length,1);assert.equal(r.wallets[0].holdings[0].address,fresh);assert.equal(r.wallets[0].value,21);assert.equal(r.job.tasks[0].provider,'blockscout');assert.match(r.job.tasks[0].fallbackReason,/kredit/);assert.equal(r.coverage.providerLabel,'Blockscout');assert.equal(backupCalls,1);assert.equal(alchemyCalls,2);
 const next=e.start({...query,refresh:true});await done(e,next.id);assert.equal(alchemyCalls,2,'quota cooldown prevents repeated failing requests');
 assert.equal(router.choose({...task,kind:'holders'}),'blockscout');assert.equal(router.supports({...task,chainId:'scroll'}),true);
 clock=31*60*1000;assert.equal(router.status().walletProfiler.cooldownUntil,null);
 assert.ok(!JSON.stringify(r).includes(secret));
}finally{await e.close();}

// A chain without a backup retains partial data and reports the missing fallback.
let partialCalls=0;
const partial=new ScanEngine({filename:':memory:',provider:new WalletProviderRouter({alchemy:provider(async()=>++partialCalls===1?response(200,{data:{tokens:[token(old,'scroll-mainnet')],pageKey:'next'}}):response(402,{error:'Insufficient credit'})),blockscout:backup})});
try{const j=partial.start({...query,chainIds:['scroll']}),r=await done(partial,j.id);assert.equal(r.coverage.complete,false);assert.equal(r.wallets[0].holdings.length,1);assert.equal(r.job.tasks[0].provider,'alchemy');assert.match(r.warnings.join(' '),/Záloha Blockscout/);}finally{await partial.close();}

// Configuration exposes capabilities, never the credential; no key means Blockscout.
const noKey=new WalletProviderRouter({alchemy:new AlchemyWalletProvider()});assert.equal(noKey.status().walletProfiler.availableChains.length,4);assert.equal(noKey.choose(task),'blockscout');

// A paused fallback keeps its own cursor and provider across SQLite restart.
const temp=await mkdtemp(path.join(tmpdir(),'chaindetective-provider-'));
try{
 let entered;const waiting=new Promise(r=>entered=r);
 const persistedBackup={async page(t,signal){if(t.cursor){entered();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}return {items:[],cursor:{backupPage:2}};}};
 const first=new ScanEngine({filename:path.join(temp,'scan.sqlite'),provider:new WalletProviderRouter({alchemy:provider(async()=>response(402,{error:'Insufficient credit'})),blockscout:persistedBackup})});
 const j=first.start(query);await waiting;await first.pause(j.id);
 assert.equal(first.store.tasks(j.id)[0].provider,'blockscout');assert.equal(first.store.tasks(j.id)[0].pages,1);await first.close();
 const second=new ScanEngine({filename:path.join(temp,'scan.sqlite'),provider:new WalletProviderRouter({alchemy:provider(async()=>{throw Error('Must not switch providers on resume');}),blockscout:{async page(t){assert.deepEqual(t.cursor,{backupPage:2});return {items:[],cursor:null};}}})});
 try{second.resume(j.id);const r=await done(second,j.id);assert.equal(r.coverage.complete,true);assert.equal(r.job.pages,2);assert.equal(r.job.tasks[0].provider,'blockscout');}finally{await second.close();}
}finally{assert.ok(path.resolve(temp).startsWith(path.resolve(tmpdir())+path.sep+'chaindetective-provider-'));await rm(temp,{recursive:true,force:true});}

const app=createApp({dbPath:':memory:',provider:router});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
try{const config=await fetch(`http://127.0.0.1:${app.server.address().port}/api/providers`).then(r=>r.json());assert.equal(config.walletProfiler.alchemyConfigured,true);assert.equal(config.walletProfiler.availableChains.length,7);assert.ok(!JSON.stringify(config).includes(secret));}finally{await app.close();}
console.log('Wallet provider regressions passed.');
