import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {ScanEngine,SCAN_CONFIG,validateQuery} from '../server/scans.mjs';
import {ZERO_ADDRESS,DEAD_ADDRESS,isIgnoredWalletAddress,isSystemWalletAddress} from '../dist/data.js';

const address=i=>'0x'+i.toString(16).padStart(40,'0');
const chains=['ethereum','base','optimism','arbitrum'];
const contract=address(900001);
const fixtureToken=chainId=>({address_hash:contract,decimals:'0',symbol:'SHARED',name:`Shared ${chainId}`,exchange_rate:chainId==='base'?'2':null});
const finished=async(engine,id)=>{await engine.active.get(id)?.promise;return engine.store.describe(id);};
const addressesFor=n=>Array.from({length:n},(_,i)=>address(100000+i));
assert.equal(SCAN_CONFIG.maxWallets,500);assert.equal(SCAN_CONFIG.taskConcurrency,4);
assert.equal(isIgnoredWalletAddress(ZERO_ADDRESS),true);assert.equal(isIgnoredWalletAddress(DEAD_ADDRESS),true);assert.equal(isIgnoredWalletAddress('0x000000000000000000000000000000000000dEaD'),true);assert.equal(isSystemWalletAddress(address(1)),false,'an address is not rejected merely for its leading zeroes');
for(const count of [1,20,100,214])assert.equal(validateQuery({kind:'wallets',chainIds:['base'],addresses:addressesFor(count)}).addresses.length,count);
assert.equal(validateQuery({kind:'wallets',chainIds:['base'],addresses:[...addressesFor(500),addressesFor(1)[0]]}).addresses.length,500,'duplicates do not consume the unique-address limit');
assert.throws(()=>validateQuery({kind:'wallets',chainIds:['base'],addresses:addressesFor(501)}),/500/);

// Burn/dead addresses never create provider tasks; mixed scans keep valid wallets and report the exclusion.
{
 let requested=[];const systemEngine=new ScanEngine({filename:':memory:',provider:{metadata:async()=>null,page:async task=>{requested.push(task.address);return {items:[],cursor:null};}}});
 try{
  assert.throws(()=>systemEngine.start({kind:'wallets',chainIds:['base'],addresses:[DEAD_ADDRESS]}),/burn\/dead/);
  assert.equal(systemEngine.store.db.prepare('SELECT COUNT(*) AS n FROM scans').get().n,0);assert.equal(systemEngine.store.db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,0);assert.deepEqual(requested,[]);
  const mixed=systemEngine.start({kind:'wallets',chainIds:['base'],addresses:[ZERO_ADDRESS,DEAD_ADDRESS,addressesFor(1)[0]]});assert.equal(mixed.taskCount,1);assert.deepEqual(mixed.query.addresses,[addressesFor(1)[0]]);assert.deepEqual(mixed.query.excludedSystemAddresses,[ZERO_ADDRESS,DEAD_ADDRESS]);
  await finished(systemEngine,mixed.id);const result=systemEngine.result(mixed.id);assert.deepEqual(requested,[addressesFor(1)[0]]);assert.ok(result.warnings.some(w=>/burn\/dead/.test(w)));
 }finally{await systemEngine.close();}
}

// A 214-wallet × 4-network job persists 856 wallet/network tasks and never exceeds four active tasks.
const addresses=addressesFor(214),addressIndex=new Map(addresses.map((a,i)=>[a,i]));let active=0,peak=0,calls=0;
const provider={metadata:async()=>null,async page(task){active++;peak=Math.max(peak,active);calls++;await delay(1);active--;
 const i=addressIndex.get(task.address);if(task.chainId==='base'&&i<14)throw Error('fixture provider failure');
 const hasToken=task.chainId!=='base'||i<114;
 return {items:hasToken?[{token:fixtureToken(task.chainId),value:'1'}]:[],cursor:null};}};
const engine=new ScanEngine({filename:':memory:',provider});const started=Date.now();
try{
 const job=engine.start({kind:'wallets',chainIds:chains,addresses,walletMetadata:[{address:addresses[0],name:'Cohort leader',tags:['Moni Wizards','DeFi'],status:'reviewed'}]});
 assert.equal(job.taskCount,214*4);assert.equal(job.query.walletMetadata.length,1);
 await finished(engine,job.id);const elapsedMs=Date.now()-started;assert.equal(engine.store.describe(job.id).status,'partial');assert.equal(calls,856);assert.ok(peak<=4);assert.ok(peak>1,'the worker queue performs bounded parallel work');
 const base=engine.result(job.id,{view:'tokens',chainId:'base',limit:100});assert.equal(base.pagination.total,1);assert.equal(base.tokens[0].symbol,'SHARED');assert.equal(base.tokens[0].holderCount,100);assert.equal(base.tokens[0].analyzedWalletCount,200);assert.equal(base.tokens[0].share,.5);assert.equal(base.tokens[0].totalValue,200);assert.equal(base.tokens[0].unpricedPositions,0);
 const all=engine.result(job.id,{view:'tokens',limit:100});assert.equal(all.pagination.total,4,'same ticker and contract address on separate chains remain four distinct tokens');assert.equal(all.coverage.analyzedWalletCount,200,'overall coverage counts wallets completed on every selected network');assert.equal(all.coverage.requestedWalletCount,214);assert.deepEqual(all.coverage.networks.find(n=>n.chainId==='base'),{chainId:'base',analyzed:200,requested:214,share:200/214,reliableWalletCount:200,warningWalletCount:0,unknownWalletCount:14,reliableShare:200/214});
 const unpriced=all.tokens.find(t=>t.chainId==='ethereum');assert.equal(unpriced.unpricedPositions,214);assert.equal(unpriced.totalValue,null);
 const filtered=engine.result(job.id,{view:'tokens',minHolders:100,minShare:49,search:'SHARED',limit:100});assert.equal(filtered.pagination.total,4);
 console.log(`Large wallet scan fixture: 214 wallets × 4 networks = 856 tasks, ${calls} provider pages, peak concurrency ${peak}/${SCAN_CONFIG.taskConcurrency}, ${elapsedMs} ms; Base popularity ${base.tokens[0].holderCount}/${base.tokens[0].analyzedWalletCount} = ${base.tokens[0].share*100}%.`);
}finally{await engine.close();}

// Pause aborts in-flight workers, preserves the page cursor, and resume completes remaining tasks.
{
 let pageCalls=0;const pauseEngine=new ScanEngine({filename:':memory:',taskConcurrency:4,provider:{metadata:async()=>null,async page(task,signal){const page=task.cursor?.page||0;await delay(8,undefined,{signal});pageCalls++;return {items:[{token:fixtureToken(task.chainId),value:'1'}],cursor:page===0?{page:1}:null};}}});
 try{const scan=pauseEngine.start({kind:'wallets',chainIds:['base'],addresses:addressesFor(20)});await until(()=>pauseEngine.store.db.prepare('SELECT COUNT(*) AS n FROM positions WHERE scan_id=?').get(scan.id).n>0);await pauseEngine.pause(scan.id);assert.equal(pauseEngine.store.describe(scan.id).status,'paused');assert.ok(pauseEngine.store.tasks(scan.id).some(t=>t.pages>0&&t.cursor));assert.equal(pauseEngine.active.has(scan.id),false);pauseEngine.resume(scan.id);await finished(pauseEngine,scan.id);assert.equal(pauseEngine.store.describe(scan.id).status,'complete');assert.equal(pauseEngine.result(scan.id,{view:'tokens'}).tokens[0].holderCount,20);assert.ok(pageCalls>=40);}finally{await pauseEngine.close();}
}
async function until(check){const deadline=Date.now()+5000;while(!check()){if(Date.now()>deadline)throw Error('Pause/resume fixture timed out');await delay(2);}}
console.log('Large wallet scan regressions passed: 1/20/100/214 validation, 500 cap, task concurrency, partial coverage/popularity, pagination filters, metadata persistence and pause/resume.');
