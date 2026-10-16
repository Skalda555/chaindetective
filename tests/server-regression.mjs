import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {ScanEngine,ScanStore,validateQuery} from '../server/scans.mjs';
import {BlockscoutProvider,decodeToken,decodeHolding} from '../server/provider.mjs';
import handler,{createApp} from '../server.mjs';
assert.equal(typeof handler,'function','Vercel entrypoint must export a default HTTP handler');
const address=i=>'0x'+i.toString(16).padStart(40,'0');
const A=address(1),B=address(2),TA=address(10001),TB=address(10002),COMMON=address(9999);
const query={kind:'holders',chainIds:['base'],match:'all',tokens:[{chainId:'base',address:TA},{chainId:'base',address:TB}]};
assert.deepEqual(validateQuery({...query,chainIds:['robinhood'],tokens:[{chainId:'robinhood',address:TA}]}).chainIds,['robinhood']);
assert.equal(validateQuery({...query,tokens:[query.tokens[0]],minPositionUsd:500}).minPositionUsd,500);assert.throws(()=>validateQuery({...query,minPositionUsd:-1}),/nezáporná/);
assert.equal(validateQuery({...query,tokens:[query.tokens[0]]}).holderCap,20000,'holder cap defaults to 20,000');
for(const holderCap of [0,10000,20000,30000,40000,50000])assert.equal(validateQuery({...query,tokens:[query.tokens[0]],holderCap}).holderCap,holderCap);
assert.throws(()=>validateQuery({...query,holderCap:15000}),/Maximální počet holderů/);
for(const retired of ['zksync','scroll','linea'])assert.throws(()=>validateQuery({...query,chainIds:[retired],tokens:[{chainId:retired,address:TA}]}),/podporované sítě/);
const metadata=async t=>({id:`${t.chainId}:${t.address}`,chainId:t.chainId,address:t.address,symbol:t.address===TA?'ONE':'TWO',name:'Fixture token',decimals:0,price:2});
const finished=async(e,id)=>{await e.active.get(id)?.promise;return e.store.describe(id);};
async function until(check){const deadline=Date.now()+3000;while(!check()){if(Date.now()>deadline)throw Error('Test timed out');await delay(1);}}

// Token Screener hydrates holder identities from the exact persisted positions
// that selected them, including pages from running, paused, and partial tasks.
function seedHolderResult(engine,{id,status,match='all',taskStatuses,ownersByToken,prices=[]}){
 const contracts=[TA,TB].slice(0,taskStatuses.length),scanQuery={kind:'holders',chainIds:['base'],match,tokens:contracts.map(address=>({chainId:'base',address})),holderCap:20000};
 const now=new Date().toISOString(),db=engine.store.db;
 db.prepare('INSERT INTO scans(id,query_key,query_json,status,created_at,updated_at,message) VALUES(?,?,?,?,?,?,?)').run(id,id,JSON.stringify(scanQuery),status,now,now,'Fixture scan');
 for(let i=0;i<contracts.length;i++){
  const address=contracts[i],symbol=i?'TWO':'ONE',metadata={id:`base:${address}`,chainId:'base',address,symbol,name:`${symbol} fixture`,decimals:0,price:prices[i]===undefined?2:prices[i]};
  const taskKey=`base:${address}`;
  db.prepare('INSERT INTO tasks(scan_id,task_key,kind,chain_id,address,status,metadata,provider,cursor,pages) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,taskKey,'holders','base',address,taskStatuses[i],JSON.stringify(metadata),'blockscout',taskStatuses[i]==='complete'?null:'{"cursor":"next"}',taskStatuses[i]==='complete'?2:1);
  for(const owner of ownersByToken[i]||[]){
   const amount=i+1,holding={...metadata,tokenId:metadata.id,rawAmount:String(amount),amount,value:metadata.price===null?null:amount*metadata.price};
   db.prepare('INSERT INTO positions(scan_id,task_key,owner,token_id,holding) VALUES(?,?,?,?,?)').run(id,taskKey,owner,metadata.id,JSON.stringify(holding));
  }
 }
 return scanQuery;
}
// Wallet Analyzer separates completed pagination from clean data and excludes
// warning portfolios from both sides of popularity/prevalence calculations.
{
 const item=(contract,symbol,value)=>({token:{address_hash:contract,decimals:'0',symbol,name:`${symbol} token`},value});
 const provider={async page(task){if(task.address===A)return {items:[item(TA,'X','5')],cursor:null};return {items:[item(TB,'Y','3'),item(TA,'X','not-a-balance')],cursor:null};}};
 const e=new ScanEngine({filename:':memory:',provider});
 try{
  const job=e.start({kind:'wallets',chainIds:['base'],addresses:[A,B]});await finished(e,job.id);
  const described=e.store.describe(job.id),result=e.result(job.id,{view:'tokens'}),x=result.tokens.find(token=>token.address===TA);
  assert.equal(described.status,'complete_with_warnings','all completed pages with invalid rows are not a partial scan');
  assert.equal(described.quality.executionComplete,true);assert.equal(described.quality.warningTasks,1);assert.equal(described.quality.reliableTasks,1);
  const warningTask=described.tasks.find(task=>task.address===B);assert.equal(warningTask.executionStatus,'complete');assert.equal(warningTask.status,'complete_with_warnings');assert.equal(warningTask.paginationComplete,true);assert.equal(warningTask.invalidRows,1);assert.equal(warningTask.dataQuality,'warning');assert.equal(warningTask.usableForPopularity,false);
  const reliableTask=described.tasks.find(task=>task.address===A);assert.equal(reliableTask.status,'complete');assert.equal(reliableTask.dataQuality,'reliable');assert.equal(reliableTask.usableForPopularity,true);
  assert.equal(x.holderCount,1);assert.equal(x.analyzedWalletCount,1);assert.equal(x.reliableWalletCount,1);assert.equal(x.completedWalletCount,2);assert.equal(x.warningWalletCount,1);assert.equal(x.requestedWalletCount,2);assert.equal(x.share,1,'1 reliable holder / 1 reliable wallet; a warning wallet is unknown, not an absence');
  assert.ok(!result.tokens.some(token=>token.address===TB),'even valid rows from a warning portfolio do not enter popularity');
  assert.equal(result.coverage.analyzedWalletCount,2,'both wallet pages completed');assert.equal(result.coverage.reliableWalletCount,1);assert.equal(result.coverage.networks[0].analyzed,2);assert.equal(result.coverage.networks[0].reliableWalletCount,1);assert.equal(result.coverage.networks[0].warningWalletCount,1);
 }finally{await e.close();}
}
// Historical wallet scans saved as `partial` before complete_with_warnings was
// introduced are presented from their stored task evidence without a DB rewrite.
{
 const warningAddress=address(300),addresses=Array.from({length:51},(_,i)=>address(300+i));
 const provider={async page(task){return {items:[{token:{address_hash:TA,decimals:'0',symbol:'X',name:'Token X'},value:task.address===warningAddress?'not-a-balance':'5'}],cursor:null};}};
 const e=new ScanEngine({filename:':memory:',provider});
 try{
  const created=e.start({kind:'wallets',chainIds:['base'],addresses});await finished(e,created.id);
  e.store.db.prepare("UPDATE scans SET status='partial',message='Legacy scan incorrectly stored as partial' WHERE id=?").run(created.id);
  const described=e.store.describe(created.id),result=e.result(created.id,{view:'tokens'}),token=result.tokens.find(row=>row.address===TA);
  assert.equal(described.status,'complete_with_warnings','legacy fully paginated wallet scan with invalid rows is presented as complete_with_warnings');
  assert.equal(described.message,'Všechny stránky jsou načtené; část řádků obsahuje upozornění.');
  assert.equal(described.quality.executionComplete,true);assert.equal(described.quality.completedTasks,51);assert.equal(described.quality.reliableTasks,50);assert.equal(described.quality.warningTasks,1);assert.equal(described.quality.unknownTasks,0);assert.equal(described.quality.invalidRows,1);
  const warningSummary=described.tasks.find(task=>task.dataQuality==='warning');assert.equal(warningSummary.executionStatus,'complete');assert.equal(warningSummary.status,'complete_with_warnings');assert.equal(warningSummary.paginationComplete,true);assert.equal(warningSummary.invalidRows,1);assert.equal(warningSummary.usableForPopularity,false);
  assert.equal(result.job.status,'complete_with_warnings');assert.equal(result.coverage.complete,true);assert.equal(result.coverage.reliableWalletCount,50);assert.equal(result.coverage.quality.warningTasks,1);
  assert.equal(token.holderCount,50);assert.equal(token.reliableWalletCount,50);assert.equal(token.warningWalletCount,1);assert.equal(token.share,1,'the warning wallet is not treated as evidence of absence');
  assert.equal(e.store.get(created.id).status,'partial','legacy DB status is not destructively rewritten');
 }finally{await e.close();}
}
// A complete empty portfolio is still reliable negative evidence for its network.
{
 const e=new ScanEngine({filename:':memory:',provider:{async page(){return {items:[],cursor:null};}}});
 try{const job=e.start({kind:'wallets',chainIds:['base'],addresses:[A]});await finished(e,job.id);const result=e.result(job.id,{view:'tokens'});assert.equal(result.job.status,'complete');assert.equal(result.job.tasks[0].paginationComplete,true);assert.equal(result.job.tasks[0].invalidRows,0);assert.equal(result.job.tasks[0].usableForPopularity,true);assert.equal(result.coverage.networks[0].reliableWalletCount,1);assert.equal(result.pagination.total,0);}finally{await e.close();}
}
// Reliability is wallet/network scoped; a warning on Base does not disqualify Ethereum.
{
 const provider={async page(task){return task.chainId==='ethereum'?{items:[{token:{address_hash:TA,decimals:'0',symbol:'ETH-X'},value:'4'}],cursor:null}:{items:[{token:{address_hash:TB,decimals:'0',symbol:'BASE-Y'},value:'2'},{token:{address_hash:TA,decimals:'0',symbol:'BASE-X'},value:'bad'}],cursor:null};}};
 const e=new ScanEngine({filename:':memory:',provider});
 try{const job=e.start({kind:'wallets',chainIds:['base','ethereum'],addresses:[A]});await finished(e,job.id);const result=e.result(job.id,{view:'tokens'});assert.equal(result.job.status,'complete_with_warnings');assert.equal(result.tokens.length,1);assert.equal(result.tokens[0].chainId,'ethereum');assert.equal(result.tokens[0].holderCount,1);assert.equal(result.tokens[0].analyzedWalletCount,1);assert.equal(result.tokens[0].share,1);assert.equal(result.coverage.networks.find(network=>network.chainId==='ethereum').reliableWalletCount,1);assert.equal(result.coverage.networks.find(network=>network.chainId==='base').reliableWalletCount,0);assert.equal(result.coverage.networks.find(network=>network.chainId==='base').warningWalletCount,1);}finally{await e.close();}
}
// An interrupted provider request is genuinely partial and never popularity-usable.
{
 const e=new ScanEngine({filename:':memory:',provider:{async page(){throw new Error('fixture provider unavailable');}}});
 try{const job=e.start({kind:'wallets',chainIds:['base'],addresses:[A]});await finished(e,job.id);const result=e.result(job.id,{view:'tokens'});assert.equal(result.job.status,'partial');assert.equal(result.job.tasks[0].paginationComplete,false);assert.equal(result.job.tasks[0].dataQuality,'unknown');assert.equal(result.job.tasks[0].usableForPopularity,false);assert.equal(result.coverage.networks[0].reliableWalletCount,0);}finally{await e.close();}
}
// Partial Token Screener holders are hydrated from valid loaded positions, not
// discarded just because their holder-list task has not reached its final page.
{
 const e=new ScanEngine({filename:':memory:',provider:{metadata,page:async()=>({items:[],cursor:null})}});
 try{
  seedHolderResult(e,{id:'partial-holder-one',status:'running',taskStatuses:['running'],ownersByToken:[[A]]});
  const result=e.result('partial-holder-one'),wallet=result.wallets.find(row=>row.address===A);
  assert.equal(result.job.status,'running');assert.equal(result.job.tasks[0].paginationComplete,false);assert.equal(result.coverage.complete,false);assert.equal(result.resultPartial,true);
  assert.equal(wallet.holdings.length,1);assert.equal(wallet.holdings[0].amount,1);assert.equal(wallet.holdings[0].value,2);assert.equal(wallet.value,2);assert.equal(wallet.matchedTokens[0].symbol,'ONE');
  assert.match(result.warnings.join(' '),/potvrzené pozice z již načtených holder stránek.*další wallets mohou přibýt/);
  e.store.db.prepare("UPDATE scans SET status='paused' WHERE id=?").run('partial-holder-one');e.store.db.prepare("UPDATE tasks SET status='pending' WHERE scan_id=?").run('partial-holder-one');
  const paused=e.result('partial-holder-one');assert.equal(paused.job.status,'paused');assert.equal(paused.wallets[0].holdings.length,1);assert.match(paused.warnings.join(' '),/holder list není kompletní/);
 }finally{await e.close();}
}
// Partial AND includes a wallet only after both token positions are confirmed.
{
 const e=new ScanEngine({filename:':memory:',provider:{metadata,page:async()=>({items:[],cursor:null})}});
 try{
  seedHolderResult(e,{id:'partial-and-both',status:'paused',match:'all',taskStatuses:['pending','running'],ownersByToken:[[A],[A]]});
  const result=e.result('partial-and-both'),wallet=result.wallets.find(row=>row.address===A);assert.equal(wallet.holdings.length,2);assert.deepEqual(wallet.matchedTokens.map(token=>token.symbol),['ONE','TWO']);assert.equal(result.job.status,'paused');assert.equal(result.coverage.complete,false);assert.match(result.warnings.join(' '),/holder list není kompletní/);
  seedHolderResult(e,{id:'partial-and-one',status:'partial',match:'all',taskStatuses:['error','pending'],ownersByToken:[[A],[]]});
  const missing=e.result('partial-and-one');assert.equal(missing.pagination.total,0,'absence from the not-yet-loaded token is not asserted as a confirmed match');assert.equal(missing.wallets.length,0);assert.match(missing.warnings.join(' '),/další wallets mohou zůstat za kurzorem/);
 }finally{await e.close();}
}
// Partial OR retains any confirmed position, and unknown prices remain unknown.
{
 const e=new ScanEngine({filename:':memory:',provider:{metadata,page:async()=>({items:[],cursor:null})}});
 try{
  seedHolderResult(e,{id:'partial-or-one',status:'partial',match:'any',taskStatuses:['error','pending'],ownersByToken:[[A],[]],prices:[null,2]});
  const result=e.result('partial-or-one'),wallet=result.wallets.find(row=>row.address===A);assert.equal(result.pagination.total,1);assert.equal(wallet.holdings.length,1);assert.equal(wallet.holdings[0].symbol,'ONE');assert.equal(wallet.holdings[0].value,null);assert.equal(wallet.value,null,'no known USD price must not become a zero value');assert.match(result.warnings.join(' '),/potvrzené pozice z načtené části holder listů/);
 }finally{await e.close();}
}
// Complete holder scans preserve their previous full-result behavior.
{
 const e=new ScanEngine({filename:':memory:',provider:{metadata,page:async()=>({items:[],cursor:null})}});
 try{
  seedHolderResult(e,{id:'complete-holder',status:'complete',taskStatuses:['complete'],ownersByToken:[[A]]});const result=e.result('complete-holder');assert.equal(result.job.status,'complete');assert.equal(result.resultPartial,false);assert.equal(result.coverage.complete,true);assert.equal(result.wallets[0].holdings.length,1);assert.equal(result.wallets[0].value,2);assert.ok(!result.warnings.some(w=>/Průběžný výsledek|skončil neúplně/.test(w)));
 }finally{await e.close();}
}
// Holder thresholds use frozen USD prices and exact raw balances. Unverified networks still consume every page.
{
 let pageCalls=0,priceCalls=0;
 const provider={metadata:async task=>({...await metadata(task),decimals:0}),async page(task){pageCalls++;if(!task.cursor)return {items:[{address:{hash:A},value:'3000'},{address:{hash:B},value:'2000'},{address:{hash:COMMON},value:'1999'}],cursor:{page:2}};return {items:[{address:{hash:TB},value:'2500'},{address:{hash:address(3)},value:'100'}],cursor:null};}};
 const e=new ScanEngine({filename:':memory:',provider,priceResolver:async()=>{priceCalls++;return {priceUsd:0.25,priceSource:'defillama',priceAsOf:'2026-10-15T00:00:00.000Z'};}});
 try{
  const j=e.start({...query,tokens:[query.tokens[0]],minPositionUsd:500});await finished(e,j.id);const result=e.result(j.id);
  assert.equal(pageCalls,2,'a later page is read even when a page row falls below threshold');assert.equal(priceCalls,1,'price is resolved once and frozen for the whole task');
  assert.deepEqual(result.wallets.map(w=>w.address).sort(),[A,B,TB].sort(),'threshold-qualified holders are retained, including a later qualifying row after a lower balance');
  assert.equal(e.store.db.prepare('SELECT COUNT(*) AS n FROM positions WHERE scan_id=?').get(j.id).n,5,'raw scan positions stay stored');assert.equal(e.store.db.prepare('SELECT COUNT(*) AS n FROM positions WHERE scan_id=? AND threshold_eligible=1').get(j.id).n,3,'the threshold eligibility marker is separate from raw positions');
  assert.equal(result.job.status,'complete','filtering at the USD threshold does not make the task partial');assert.equal(result.job.tasks[0].token.priceUsd,0.25);assert.equal(result.job.tasks[0].token.priceSource,'defillama');assert.equal(result.job.tasks[0].token.minTokenAmount,'2000');
  assert.ok(result.warnings.some(w=>/Early-stop používáme pouze pro Robinhood/.test(w)),'the result explains that unverified networks consume every page');
  assert.equal(result.job.pages,2);
 }finally{await e.close();}
}
// Robinhood can stop at the first below-threshold row only after checking descending order within and across pages.
{
 let pageCalls=0;const provider={metadata:async task=>({...await metadata(task),decimals:0}),async page(task){pageCalls++;return task.cursor?{items:[{address:{hash:address(5)},value:'250'},{address:{hash:COMMON},value:'249'}],cursor:{page:3}}:{items:[{address:{hash:A},value:'300'},{address:{hash:B},value:'260'}],cursor:{page:2}};}};
 const e=new ScanEngine({filename:':memory:',provider,priceResolver:async()=>({priceUsd:2,priceSource:'defillama',priceAsOf:'2026-10-15T00:00:00.000Z'})});
 try{
  const j=e.start({...query,chainIds:['robinhood'],tokens:[{chainId:'robinhood',address:TA}],minPositionUsd:500});await finished(e,j.id);const result=e.result(j.id),task=result.job.tasks[0];
  assert.equal(pageCalls,2,'pagination ends on the page that crosses the threshold');assert.equal(task.pages,2);assert.equal(task.status,'complete');assert.equal(task.completionReason,'usd_threshold');
  assert.deepEqual(result.wallets.map(w=>w.address).sort(),[A,B,address(5)].sort());assert.equal(task.token.thresholdDiagnostics.holdersAccepted,3);assert.equal(task.token.thresholdDiagnostics.pagesFetched,2);assert.equal(task.token.thresholdDiagnostics.orderingVerified,true);
  assert.equal(e.store.db.prepare('SELECT completion_reason FROM tasks WHERE scan_id=?').get(j.id).completion_reason,'usd_threshold','threshold completion reason is persisted in SQLite');
  assert.ok(result.warnings.some(w=>/ukončil 1 Robinhood tokenových úloh/.test(w)));
 }finally{await e.close();}
}
{
 let pageCalls=0;const provider={metadata:async task=>({...await metadata(task),decimals:0}),async page(task){pageCalls++;return task.cursor?{items:[],cursor:null}:{items:[{address:{hash:A},value:'300'},{address:{hash:B},value:'100'},{address:{hash:COMMON},value:'200'}],cursor:{page:2}};}};
 const e=new ScanEngine({filename:':memory:',provider,priceResolver:async()=>({priceUsd:2,priceSource:'defillama',priceAsOf:'2026-10-15T00:00:00.000Z'})});
 try{const j=e.start({...query,chainIds:['robinhood'],tokens:[{chainId:'robinhood',address:TA}],minPositionUsd:500});await finished(e,j.id);const task=e.store.describe(j.id).tasks[0];assert.equal(pageCalls,2,'unsorted balances within a page disable early-stop');assert.equal(task.completionReason,'all_holders');assert.match(task.token.earlyStopDisabledReason,/na stránce/);}finally{await e.close();}
}
{
 let pageCalls=0;const provider={metadata:async task=>({...await metadata(task),decimals:0}),async page(task){pageCalls++;return task.cursor?{items:[{address:{hash:COMMON},value:'251'},{address:{hash:address(4)},value:'100'}],cursor:null}:{items:[{address:{hash:A},value:'300'},{address:{hash:B},value:'250'}],cursor:{page:2}};}};
 const e=new ScanEngine({filename:':memory:',provider,priceResolver:async()=>({priceUsd:2,priceSource:'defillama',priceAsOf:'2026-10-15T00:00:00.000Z'})});
 try{
  const j=e.start({...query,chainIds:['robinhood'],tokens:[{chainId:'robinhood',address:TA}],minPositionUsd:500});await finished(e,j.id);const result=e.result(j.id),task=result.job.tasks[0];
  assert.equal(pageCalls,2,'a rising balance across the cursor disables early-stop and loads the rest');assert.equal(task.completionReason,'all_holders');assert.equal(task.token.thresholdDiagnostics.orderingVerified,false);assert.match(task.token.thresholdDiagnostics.earlyStopDisabledReason,/mezi stránkami/);assert.ok(result.wallets.some(w=>w.address===COMMON));
 }finally{await e.close();}
}
{
 const provider={metadata:async task=>({...await metadata(task),symbol:task.address===TA?'ONE':'TWO',decimals:0}),async page(task){return {items:task.address===TA?[{address:{hash:A},value:'300'},{address:{hash:B},value:'100'}]:[{address:{hash:B},value:'300'},{address:{hash:A},value:'100'}],cursor:{page:2}};}};
 const e=new ScanEngine({filename:':memory:',provider,priceResolver:async()=>({priceUsd:2,priceSource:'defillama',priceAsOf:'2026-10-15T00:00:00.000Z'})});
 try{
  const input={...query,chainIds:['robinhood'],tokens:[{chainId:'robinhood',address:TA},{chainId:'robinhood',address:TB}],minPositionUsd:500};
  const all=e.start(input);await finished(e,all.id);assert.equal(e.result(all.id).wallets.length,0,'AND intersects only positions meeting threshold in each token');
  const any=e.start({...input,match:'any'});await finished(e,any.id);assert.deepEqual(e.result(any.id).wallets.map(w=>w.address).sort(),[A,B].sort(),'OR includes wallets qualifying for at least one token');
 }finally{await e.close();}
}
{
 let calls=0;const e=new ScanEngine({filename:':memory:',provider:{metadata,async page(){calls++;return {items:[{address:{hash:A},value:'1'},{address:{hash:B},value:'2'}],cursor:null};}},priceResolver:async()=>null});
 try{const j=e.start({...query,tokens:[query.tokens[0]],minPositionUsd:500});await finished(e,j.id);const r=e.result(j.id);assert.equal(calls,1);assert.equal(r.wallets.length,2,'unknown prices retain the complete holder set');assert.equal(r.job.status,'complete');assert.ok(r.warnings.some(w=>/Cena neznámá – threshold nebylo možné použít/.test(w)));}finally{await e.close();}
}
// Robinhood's verified descending order permits per-token caps by unique wallet address.
for(const cap of [10000,20000,30000,40000,50000]){
 let pageCalls=0;const provider={metadata:async task=>({...await metadata(task),decimals:0}),async page(task){pageCalls++;const pageIndex=task.cursor?.page||0,start=pageIndex*50;const items=Array.from({length:50},(_,i)=>({address:{hash:address(100000+start+i+1)},value:String(1000000-start-i)}));return {items,cursor:{page:pageIndex+1}};}};
 const e=new ScanEngine({filename:':memory:',provider});
 try{const j=e.start({...query,chainIds:['robinhood'],tokens:[{chainId:'robinhood',address:TA}],holderCap:cap});await finished(e,j.id);const result=e.result(j.id),task=result.job.tasks[0];assert.equal(pageCalls,cap/50,`${cap} cap stops on the exact page`);assert.equal(task.status,'complete');assert.equal(task.completionReason,'holder_cap');assert.equal(task.token.holdersAccepted,cap);assert.equal(task.token.truncatedByHolderCap,true);assert.equal(task.token.orderingVerified,true);assert.equal(result.job.status,'complete','cap completion is successful, not partial');assert.ok(Number.isFinite(result.job.runtimeMs)&&result.job.runtimeMs>=0);assert.ok(result.job.startedAt&&result.job.finishedAt);assert.equal(e.store.db.prepare('SELECT completion_reason FROM tasks WHERE scan_id=?').get(j.id).completion_reason,'holder_cap');assert.equal(e.store.db.prepare('SELECT COUNT(*) AS n FROM positions WHERE scan_id=?').get(j.id).n,cap);assert.ok(result.warnings.some(w=>w.includes(`Top ${cap.toLocaleString('cs-CZ')} holders`)));}finally{await e.close();}
}
// Duplicates from later pages do not increase the unique-address cap.
{
 let pageCalls=0;const cap=10000,duplicate=address(200001);const provider={metadata:async task=>({...await metadata(task),decimals:0}),async page(task){pageCalls++;const pageIndex=task.cursor?.page||0,start=pageIndex*50;const items=Array.from({length:50},(_,i)=>({address:{hash:pageIndex>0&&i===0?duplicate:address(200001+start+i)},value:String(1000000-start-i)}));return {items,cursor:{page:pageIndex+1}};}};
 const e=new ScanEngine({filename:':memory:',provider});try{const j=e.start({...query,chainIds:['robinhood'],tokens:[{chainId:'robinhood',address:TA}],holderCap:cap});await finished(e,j.id);const task=e.store.describe(j.id).tasks[0];assert.ok(pageCalls>cap/50,'duplicate records require additional pages to reach 10,000 unique wallets');assert.equal(task.token.holdersAccepted,cap);assert.equal(e.store.db.prepare('SELECT COUNT(*) AS n FROM positions WHERE scan_id=?').get(j.id).n,cap);assert.equal(task.completionReason,'holder_cap');}finally{await e.close();}
}
// Unlimited mode preserves complete pagination and reports its completion reason.
{
 let calls=0;const e=new ScanEngine({filename:':memory:',provider:{metadata:async task=>({...await metadata(task),decimals:0}),async page(task){calls++;return task.cursor?{items:[{address:{hash:B},value:'8'}],cursor:null}:{items:[{address:{hash:A},value:'9'}],cursor:{page:1}};}}});
 try{const j=e.start({...query,chainIds:['robinhood'],tokens:[{chainId:'robinhood',address:TA}],holderCap:0});await finished(e,j.id);const task=e.store.describe(j.id).tasks[0];assert.equal(calls,2);assert.equal(task.completionReason,'all_holders');assert.equal(task.token.truncatedByHolderCap,false);assert.equal(task.token.holdersAccepted,2);}finally{await e.close();}
}
// The first safe stop wins: USD boundary before cap, cap before USD boundary.
{
 let calls=0;const provider={metadata:async task=>({...await metadata(task),decimals:0}),async page(task){calls++;return task.cursor?{items:[{address:{hash:address(51)},value:'1999'},{address:{hash:address(52)},value:'1900'}],cursor:{page:3}}:{items:[{address:{hash:A},value:'3000'},{address:{hash:B},value:'2500'}],cursor:{page:2}};}};
 const e=new ScanEngine({filename:':memory:',provider,priceResolver:async()=>({priceUsd:.25,priceSource:'defillama',priceAsOf:'2026-10-15T00:00:00.000Z'})});try{const j=e.start({...query,chainIds:['robinhood'],tokens:[{chainId:'robinhood',address:TA}],minPositionUsd:500,holderCap:10000});await finished(e,j.id);const task=e.store.describe(j.id).tasks[0];assert.equal(calls,2);assert.equal(task.completionReason,'usd_threshold');assert.equal(task.token.truncatedByHolderCap,false);assert.equal(task.token.holdersAccepted,2);}finally{await e.close();}
}
{
 const cap=10000;let calls=0;const provider={metadata:async task=>({...await metadata(task),decimals:0}),async page(task){calls++;const pageIndex=task.cursor?.page||0,start=pageIndex*50;return {items:Array.from({length:50},(_,i)=>({address:{hash:address(300000+start+i+1)},value:String(1000000-start-i)})),cursor:{page:pageIndex+1}};}};
 const e=new ScanEngine({filename:':memory:',provider,priceResolver:async()=>({priceUsd:.25,priceSource:'dexscreener',priceAsOf:'2026-10-15T00:00:00.000Z'})});try{const j=e.start({...query,chainIds:['robinhood'],tokens:[{chainId:'robinhood',address:TA}],minPositionUsd:500,holderCap:cap});await finished(e,j.id);const task=e.store.describe(j.id).tasks[0];assert.equal(calls,cap/50);assert.equal(task.completionReason,'holder_cap','cap wins while every holder remains above the USD threshold');assert.equal(task.token.holdersAccepted,cap);}finally{await e.close();}
}
// An ordering failure disables the cap, retains the complete list, and avoids a false Top-N claim.
{
 let calls=0;const provider={metadata:async task=>({...await metadata(task),decimals:0}),async page(task){calls++;return task.cursor?{items:[{address:{hash:COMMON},value:'50'}],cursor:null}:{items:[{address:{hash:A},value:'100'},{address:{hash:B},value:'200'}],cursor:{page:1}};}};
 const e=new ScanEngine({filename:':memory:',provider});try{const j=e.start({...query,chainIds:['robinhood'],tokens:[{chainId:'robinhood',address:TA}],holderCap:10000});await finished(e,j.id);const result=e.result(j.id),task=result.job.tasks[0];assert.equal(calls,2);assert.equal(task.completionReason,'all_holders');assert.equal(task.token.truncatedByHolderCap,false);assert.equal(task.token.orderingVerified,false);assert.match(task.token.holderCapDisabledReason,/na stránce/);assert.ok(result.warnings.some(w=>/Limit holderů nebylo možné bezpečně použít/.test(w)));assert.ok(!result.warnings.some(w=>/Top 10 000 holders/.test(w)));}finally{await e.close();}
}
// AND/OR correlation is limited to the holders gathered for each capped token.
{
 const cap=10000,provider={metadata:async task=>({...await metadata(task),decimals:0}),async page(task){const pageIndex=task.cursor?.page||0,start=(task.address===TA?1:10001)+pageIndex*50;return {items:Array.from({length:50},(_,i)=>({address:{hash:address(start+i)},value:String(1000000-pageIndex*50-i)})),cursor:{page:pageIndex+1}};}};
 const e=new ScanEngine({filename:':memory:',provider});try{const input={...query,chainIds:['robinhood'],tokens:[{chainId:'robinhood',address:TA},{chainId:'robinhood',address:TB}],holderCap:cap};const all=e.start(input);await finished(e,all.id);assert.equal(e.result(all.id).pagination.total,0,'AND intersects only the capped holder sets');const any=e.start({...input,match:'any'});await finished(e,any.id);assert.equal(e.result(any.id).pagination.total,20000,'OR is the union of the capped holder sets');assert.ok(e.result(any.id).warnings.some(w=>/Korelace nemusí zahrnovat menší držitele/.test(w)));}finally{await e.close();}
}
// Unsupported ordering leaves the cap unused and loads all returned holders.
{
 let calls=0;const e=new ScanEngine({filename:':memory:',provider:{metadata,async page(){calls++;return {items:[{address:{hash:A},value:'2'},{address:{hash:B},value:'1'}],cursor:null};}}});
 try{const j=e.start({...query,tokens:[query.tokens[0]],holderCap:10000});await finished(e,j.id);const result=e.result(j.id),task=result.job.tasks[0];assert.equal(calls,1);assert.equal(task.completionReason,'all_holders');assert.equal(task.token.holdersAccepted,2);assert.equal(task.token.truncatedByHolderCap,false);assert.match(task.token.holderCapDisabledReason,/Base/);assert.ok(result.warnings.some(w=>/Limit holderů nebylo možné bezpečně použít/.test(w)));}finally{await e.close();}
}
{
 const e=new ScanEngine({filename:':memory:',provider:{metadata,page:async()=>({items:[],cursor:null})}}),id='legacy-linea-scan',legacyQuery={kind:'wallets',chainIds:['linea'],addresses:[A],provider:'blockscout'};
 const now=new Date().toISOString();e.store.db.prepare('INSERT INTO scans(id,query_key,query_json,status,created_at,updated_at,message) VALUES(?,?,?,?,?,?,?)').run(id,'legacy-fixture',JSON.stringify(legacyQuery),'partial',now,now,'Historic scan');
 e.store.db.prepare('INSERT INTO tasks(scan_id,task_key,kind,chain_id,address,status,error,provider) VALUES(?,?,?,?,?,?,?,?)').run(id,'linea:'+A,'wallets','linea',A,'error','Historic provider result','blockscout');
 try{const result=e.result(id);assert.deepEqual(result.job.query.chainIds,['linea']);assert.match(result.warnings.join(' '),/Linea/,'existing legacy scans still render with their archived network name');}finally{await e.close();}
}

// Spam classification filters the server-side page/count only; SQLite scan rows remain intact.
{
 const e=new ScanEngine({filename:':memory:',provider:{metadata,async page(){return {items:[
  {token:{address_hash:TA,decimals:'0',symbol:'CLAIM',name:'Claim at example.com'},value:'2'},
  {token:{address_hash:TB,decimals:'0',symbol:'WETH',name:'Wrapped Ether'},value:'3'},
 ],cursor:null};}}});
 try{
  const job=e.start({kind:'wallets',chainIds:['base'],addresses:[A]});await finished(e,job.id);
  const hidden=e.result(job.id,{view:'tokens'});assert.equal(hidden.pagination.total,1);assert.equal(hidden.tokens[0].symbol,'WETH');
  const shown=e.result(job.id,{view:'tokens',hideSpam:false});assert.equal(shown.pagination.total,2);const spam=shown.tokens.find(t=>t.symbol==='CLAIM');assert.equal(spam.likelySpam,true);assert.ok(spam.spamReasons.includes('url-in-name'));assert.ok(spam.spamReasons.includes('keyword:claim'));
  assert.equal(e.store.db.prepare('SELECT COUNT(*) AS n FROM positions WHERE scan_id=?').get(job.id).n,2,'toggling spam visibility never deletes saved positions');
  assert.equal(e.result(job.id).wallets[0].holdings.length,2,'wallet result and scan history retain the original raw holdings');
 }finally{await e.close();}
}

// Wallet Analyzer summaries describe the full filtered result, independent of
// which sorted page is currently returned to the table.
{
 const walletAddresses=Array.from({length:25},(_,i)=>address(40000+i)),tokenAddresses=Array.from({length:25},(_,i)=>address(50000+i)),walletIndex=new Map(walletAddresses.map((owner,i)=>[owner,i]));
 const provider={async page(task){const index=walletIndex.get(task.address);return {items:tokenAddresses.flatMap((contract,j)=>index<25-j?[{token:{address_hash:contract,decimals:'0',symbol:`T${j}`,name:`Fixture token ${j}`,exchange_rate:String(j+1)},value:'1'}]:[]),cursor:null};}};
 const e=new ScanEngine({filename:':memory:',provider});
 try{
  const job=e.start({kind:'wallets',chainIds:['base'],addresses:walletAddresses});await finished(e,job.id);
  const request={view:'tokens',limit:10,sort:'holders',hideSpam:false},p1=e.result(job.id,{...request,offset:0}),p2=e.result(job.id,{...request,offset:10}),p3=e.result(job.id,{...request,offset:20});
  assert.deepEqual([p1.tokens.length,p2.tokens.length,p3.tokens.length],[10,10,5]);
  for(const page of [p1,p2,p3]){assert.equal(page.pagination.filteredTotal,25);assert.equal(page.pagination.total,25);assert.equal(page.pagination.pageRows,page.tokens.length);assert.deepEqual(page.summary,p1.summary);}
  assert.equal(p1.summary.uniqueContracts,25);assert.equal(p1.summary.topToken.symbol,'T0');assert.equal(p1.summary.topToken.holderCount,25);assert.equal(p1.summary.knownUsdValue,tokenAddresses.reduce((sum,_,j)=>sum+(25-j)*(j+1),0));
  const filtered=e.result(job.id,{...request,offset:0,minHolders:19});assert.equal(filtered.pagination.filteredTotal,7);assert.equal(filtered.tokens.length,7);assert.equal(filtered.summary.uniqueContracts,7);assert.equal(filtered.summary.knownUsdValue,tokenAddresses.slice(0,7).reduce((sum,_,j)=>sum+(25-j)*(j+1),0));
  const restored=e.result(job.id,{...request,offset:0,minHolders:0});assert.equal(restored.pagination.filteredTotal,25);assert.deepEqual(restored.summary,p1.summary,'removing the filter restores the full summary');
  const byValue=e.result(job.id,{...request,offset:0,sort:'value'});assert.notEqual(byValue.tokens[0].symbol,p1.tokens[0].symbol,'sort changes visible row order');assert.deepEqual(byValue.summary,p1.summary,'sort does not change analytical summary');
 }finally{await e.close();}
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

// Query fingerprints are order-independent, include result-changing options, and active jobs are exclusive.
{
 let release;const gate=new Promise(resolve=>{release=resolve;});let calls=0;
 const provider={metadata,async page(_task,signal){calls++;await delay(10000,undefined,{signal});return {items:[],cursor:null};}};
 const e=new ScanEngine({filename:':memory:',provider});
 try{
  const activeQuery={...query,tokens:[query.tokens[0]]},base={...activeQuery,refresh:true};const first=e.start(base);await until(()=>e.store.describe(first.id).status==='running');
  const reordered=e.start({...base,tokens:[...activeQuery.tokens].reverse()});assert.equal(reordered.id,first.id);assert.equal(reordered.duplicateActive,true,'a duplicate submit gets the existing active job without resuming or creating tasks');assert.equal(calls,1,'only the original job issues provider work');
  const paused=await e.pause(first.id);assert.equal(paused.status,'paused');const stillExisting=e.start({...base,refresh:false});assert.equal(stillExisting.id,first.id);assert.equal(stillExisting.duplicateActive,true,'a paused identical job is offered rather than silently restarted');
  assert.equal(e.store.describe(first.id).queryFingerprint,e.store.describe(reordered.id).queryFingerprint);
  const repeat=e.repeat(first.id);assert.equal(repeat.id,first.id,'repeating while an identical paused job exists reuses that job');assert.equal(repeat.duplicateActive,true);
  const legacyId='legacy-holder-query',now=new Date().toISOString(),legacy={kind:'holders',chainIds:['base'],tokens:[{chainId:'base',address:TA}],match:'all'};
  e.store.db.prepare('INSERT INTO scans(id,query_key,query_json,status,created_at,updated_at,runtime_ms) VALUES(?,?,?,?,?,?,0)').run(legacyId,'legacy-key',JSON.stringify(legacy),'complete',now,now);
  // Repeat normalizes older saved queries using current safe defaults and creates a new snapshot.
  e.remove(first.id);provider.page=async()=>({items:[],cursor:null});release?.();
  const fresh=e.repeat(legacyId);assert.notEqual(fresh.id,legacyId);assert.equal(fresh.query.holderCap,20000);assert.equal(fresh.query.minPositionUsd,undefined);assert.deepEqual(fresh.query.tokens,[{chainId:'base',address:TA}]);await finished(e,fresh.id);
  const done=e.start({...query,refresh:true});await finished(e,done.id);
  const cached=e.start({...query,tokens:[...query.tokens].reverse()});assert.equal(cached.id,done.id,'A+B and B+A reuse the same normalized completed query');
  const andKey=done.queryFingerprint;
  const or=e.start({...query,match:'any',refresh:true});await finished(e,or.id);assert.notEqual(or.queryFingerprint,andKey,'AND and OR have distinct fingerprints');
  const usd=e.start({...query,minPositionUsd:500,refresh:true});await finished(e,usd.id);assert.notEqual(usd.queryFingerprint,andKey,'USD minimum is part of the query fingerprint');
  const cap=e.start({...query,holderCap:10000,refresh:true});await finished(e,cap.id);assert.notEqual(cap.queryFingerprint,andKey,'holder cap is part of the query fingerprint');
  assert.notEqual(usd.queryFingerprint,cap.queryFingerprint);
  assert.notEqual(fresh.id,done.id,'each deliberate repeat remains a distinct stored run');
  assert.ok(e.store.get(fresh.id));assert.ok(e.store.get(done.id));
 }finally{await e.close();}
}
{
 const store=new ScanStore(':memory:'),now=new Date().toISOString(),savedQuery={kind:'holders',chainIds:['base'],tokens:[{chainId:'base',address:TA}],match:'all'};
 try{for(let i=0;i<15;i++)store.db.prepare('INSERT INTO scans(id,query_key,query_json,status,created_at,updated_at,runtime_ms) VALUES(?,?,?,?,?,?,0)').run(`history-${i}`,`fingerprint-${i}`,JSON.stringify(savedQuery),'complete',new Date(Date.now()-i*1000).toISOString(),now);assert.equal(store.list().length,15,'server scan history retains older runs instead of silently truncating the list');}finally{store.close();}
}

// A committed page and cursor survive pause, provider failure, and a server restart.
const temp=await mkdtemp(path.join(os.tmpdir(),'chaindetective-tests-'));
try{
 // A live wallet scan exposes completed-network aggregates while another network is still running.
 {
  let releaseBase,baseCalls=0;const baseGate=new Promise(resolve=>{releaseBase=resolve;});
  const live=new ScanEngine({filename:':memory:',provider:{metadata:async task=>({id:`${task.chainId}:${TA}`,chainId:task.chainId,address:TA,symbol:task.chainId==='base'?'BASE':'ETH',name:'Live token',decimals:0}),async page(task){const item={token:{address_hash:TA,decimals:'0',symbol:task.chainId==='base'?'BASE':'ETH',name:'Live token',exchange_rate:null},value:'3'};if(task.chainId==='base'){baseCalls++;if(baseCalls===1)return {items:[item],cursor:{page:2}};await baseGate;}return {items:[item],cursor:null};}}});
  try{
   const job=live.start({kind:'wallets',chainIds:['base','ethereum'],addresses:[A]});await until(()=>baseCalls===2&&live.store.tasks(job.id).some(t=>t.chainId==='ethereum'&&t.status==='complete'));
   const inFlight=live.result(job.id,{view:'tokens'});assert.equal(inFlight.job.status,'running','reading a running result must not change the scan state');assert.ok(Number.isFinite(inFlight.job.runtimeMs)&&inFlight.job.runtimeMs>=0);assert.ok(inFlight.job.startedAt);assert.equal(inFlight.job.progress.completedTasks,1);assert.equal(inFlight.job.progress.totalTasks,2);assert.equal(inFlight.tokens.length,1);assert.equal(inFlight.tokens[0].chainId,'ethereum');assert.match(inFlight.warnings.join(' '),/Průběžný výsledek/);assert.equal(inFlight.coverage.networks.find(n=>n.chainId==='ethereum').analyzed,1);assert.equal(inFlight.coverage.networks.find(n=>n.chainId==='base').analyzed,0);
   const walletSnapshot=live.result(job.id);assert.equal(walletSnapshot.wallets[0].holdings.length,1,'positions from an incomplete task are excluded from the live wallet result');assert.equal(walletSnapshot.wallets[0].holdings[0].chainId,'ethereum');
   releaseBase();await finished(live,job.id);const completed=live.result(job.id,{view:'tokens'});assert.equal(completed.job.status,'complete');assert.equal(completed.tokens.length,2,'the result includes new data after the remaining task completes');assert.equal(live.store.describe(job.id).progress.completedTasks,2);
  }finally{releaseBase();await live.close();}
 }
 const filename=path.join(temp,'resume.sqlite');let firstCalls=0;
 const firstProvider={metadata,async page(task,signal){firstCalls++;if(!task.cursor)return {items:[{address:{hash:A},value:'2'}],cursor:{page:2}};await delay(10000,undefined,{signal});throw Error('unreachable');}};
 const e=new ScanEngine({filename,provider:firstProvider});const j=e.start({...query,tokens:[query.tokens[0]]});
 await until(()=>e.store.tasks(j.id)[0].pages===1);await e.pause(j.id);const pausedJob=e.store.describe(j.id),pausedRuntime=pausedJob.runtimeMs,actualStartedAt=pausedJob.startedAt;
 assert.ok(Number.isFinite(pausedRuntime)&&pausedRuntime>=0,'pause persists a nonnegative accumulated runtime');assert.ok(e.store.describe(j.id).startedAt,'the first actual run start is stored');assert.ok(e.store.describe(j.id).pausedAt,'pause time is stored');assert.equal(e.store.get(j.id).run_started_at,null,'paused jobs have no active runtime interval');
 assert.equal(e.result(j.id).wallets.length,1);assert.equal(e.result(j.id).coverage.complete,false);assert.equal(e.store.tasks(j.id)[0].cursor.page,2);
 e.store.touch(j.id,'running','Simulate process interruption');await e.close();
 let resumedCalls=0;
 const provider={metadata:async()=>{throw Error('Metadata must be reused');},async page(task){resumedCalls++;assert.equal(task.cursor.page,2);if(resumedCalls===1)throw Error('Temporary provider failure');return {items:[{address:{hash:A},value:'2'},{address:{hash:B},value:'3'}],cursor:null};}};
 const reopened=new ScanEngine({filename,provider});
 try{
  assert.equal(reopened.store.describe(j.id).status,'paused');reopened.resume(j.id);await finished(reopened,j.id);
  assert.equal(reopened.store.describe(j.id).status,'partial');assert.equal(reopened.result(j.id).wallets.length,1);
  reopened.resume(j.id);await finished(reopened,j.id);const result=reopened.result(j.id);
  assert.equal(result.coverage.complete,true);assert.equal(result.wallets.length,2);assert.equal(result.wallets.find(w=>w.address===A).value,4,'overlap must not double balances');assert.equal(result.job.pages,2);assert.ok(result.job.runtimeMs>=pausedRuntime,'pause/resume completion accumulates active runtime');assert.equal(result.job.startedAt,actualStartedAt,'resume retains the original actual start time');assert.ok(result.job.finishedAt,'completion time is persisted separately from update time');
 }finally{await reopened.close();}

 // A crash recovery closes an interrupted runtime interval without producing a negative duration; legacy rows remain explicitly unknown.
 {
  const legacyFile=path.join(temp,'legacy-runtime.sqlite'),legacyDb=new DatabaseSync(legacyFile),created='2026-10-15T10:00:00.000Z',finishedAt='2026-10-15T11:00:00.000Z',queryJson=JSON.stringify({kind:'holders',chainIds:['base'],tokens:[]});
  legacyDb.exec("CREATE TABLE scans(id TEXT PRIMARY KEY,query_key TEXT NOT NULL,query_json TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,finished_at TEXT,message TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0)");
  legacyDb.prepare('INSERT INTO scans(id,query_key,query_json,status,created_at,updated_at,finished_at) VALUES(?,?,?,?,?,?,?)').run('old-complete','old-complete',queryJson,'complete',created,finishedAt,finishedAt);
  legacyDb.prepare('INSERT INTO scans(id,query_key,query_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('old-running','old-running',queryJson,'running',created,created);legacyDb.close();
  const recovered=new ScanStore(legacyFile);try{const interrupted=recovered.describe('old-running'),historic=recovered.describe('old-complete');assert.equal(interrupted.status,'paused');assert.equal(interrupted.runtimeMs,null,'old running scans without an interval do not get guessed duration');assert.equal(historic.runtimeMs,null,'created/finished timestamps alone cannot prove pause-free active runtime');assert.equal(recovered.get('old-running').run_started_at,null);assert.ok(interrupted.pausedAt);assert.ok(interrupted.runtimeMs===null||interrupted.runtimeMs>=0);recovered.db.prepare('INSERT INTO scans(id,query_key,query_json,status,created_at,updated_at,finished_at,started_at,runtime_ms) VALUES(?,?,?,?,?,?,?,?,?)').run('hourly','hourly',queryJson,'complete',created,finishedAt,finishedAt,created,3780000);assert.equal(recovered.describe('hourly').runtimeMs,3780000,'stored hourly duration is surfaced exactly');}finally{recovered.close();}
 }

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
  const repeatedResponse=await fetch(origin+'/api/scans/'+created.id+'/repeat',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(repeatedResponse.status,202);const repeated=await repeatedResponse.json();assert.notEqual(repeated.id,created.id);assert.equal(repeated.queryFingerprint,created.queryFingerprint);await finished(app.scans,repeated.id);assert.deepEqual(repeated.query,created.query,'repeat endpoint reuses the stored normalized query');
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
  assert.equal((await fetch(origin+'/api/scans').then(r=>r.json())).scans.length,2);
  for(const suffix of ['','/result','/resume'])assert.equal((await fetch(origin+'/api/scans/'+created.id+suffix,{method:suffix==='/resume'?'POST':'GET'})).status,404);
  assert.equal((await fetch(origin+'/api/scans/'+created.id,{method:'DELETE'})).status,404);
  // Active writers must be rejected even during the pause/abort settling window.
  app.scans.provider={metadata,async page(task,signal){await delay(10000,undefined,{signal});return {items:[],cursor:null};}};
  const running=app.scans.start({...query,tokens:[query.tokens[0]],refresh:true});
  const duplicate=await fetch(origin+'/api/scans/'+running.id+'/repeat',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json());assert.equal(duplicate.id,running.id);assert.equal(duplicate.duplicateActive,true,'repeat API returns the active matching scan instead of creating another');
  const liveResult=await fetch(origin+'/'+ 'api/scans/'+running.id+'/result?view=tokens').then(async response=>({status:response.status,body:await response.json()}));assert.equal(liveResult.status,200);assert.equal(liveResult.body.job.status,'running','GET result must not pause or mark the job partial');
  assert.equal((await fetch(origin+'/api/scans/'+running.id,{method:'DELETE'})).status,409);
  const bulkRefused=await fetch(origin+'/api/scans',{method:'DELETE'});assert.equal(bulkRefused.status,409);assert.match((await bulkRefused.json()).error,/pozastavte běžící skeny/);assert.ok(app.scans.store.get(running.id),'bulk delete must preserve a running scan');
  const stopping=app.scans.pause(running.id);
  assert.throws(()=>app.scans.remove(running.id),error=>error.status===409);
  await stopping;
  assert.equal((await fetch(origin+'/api/scans/'+running.id,{method:'DELETE'})).status,200);
  assert.ok(app.scans.store.get(kept.id));assert.equal(app.scans.result(kept.id).wallets.length,1);
  // Bulk removal cascades scan-owned rows across all persisted states while retaining unrelated application data.
  const extra=[];for(const status of ['complete','complete_with_warnings','failed']){const scan=app.scans.start({...query,tokens:[query.tokens[0]],refresh:true});await finished(app.scans,scan.id);db.prepare('UPDATE scans SET status=? WHERE id=?').run(status,scan.id);extra.push(scan.id);}
  db.prepare("UPDATE scans SET status='paused' WHERE id=?").run(kept.id);db.prepare("UPDATE scans SET status='partial' WHERE id=?").run(repeated.id);
  db.prepare('CREATE TABLE IF NOT EXISTS smart_wallets(address TEXT PRIMARY KEY,name TEXT NOT NULL,tags_json TEXT NOT NULL,source TEXT NOT NULL,note TEXT NOT NULL,status TEXT NOT NULL,chains_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)').run();
  db.prepare('INSERT INTO smart_wallets(address,name,tags_json,source,note,status,chains_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(A,'Retain wallet','["Fund"]','test','keep','reviewed','["base"]',new Date().toISOString(),new Date().toISOString());
  app.moni.watch('retain_social');
  const bulkIds=[kept.id,repeated.id,...extra];for(const id of bulkIds){db.prepare('INSERT OR IGNORE INTO positions(scan_id,task_key,owner,token_id,holding) VALUES(?,?,?,?,?)').run(id,`base:${TA}`,A,`base:${TA}`,JSON.stringify({amount:'1',value:2}));db.prepare('INSERT OR IGNORE INTO cursors(scan_id,task_key,signature) VALUES(?,?,?)').run(id,`base:${TA}`,'fixture-cursor');}
  for(const id of bulkIds)for(const table of ['tasks','positions','cursors'])assert.ok(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE scan_id=?`).get(id).n>0,`bulk fixture has ${table} for ${id}`);
  const bulkDenied=await fetch(origin+'/api/scans',{method:'DELETE',headers:{Origin:'https://other.example'}});assert.equal(bulkDenied.status,403);
  const bulk=await fetch(origin+'/api/scans',{method:'DELETE'});assert.equal(bulk.status,200);const deleted=await bulk.json();assert.equal(deleted.deleted,bulkIds.length);assert.deepEqual(new Set(deleted.ids),new Set(bulkIds));assert.equal(app.scans.store.list().length,0,'bulk delete removes every persisted scan status');
  for(const table of ['tasks','positions','cursors'])assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,`bulk delete cascades every scan-owned ${table} row`);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM smart_wallets WHERE address=?').get(A).n,1,'bulk delete retains Smart wallets');assert.equal(app.moni.watchlist().length,1,'bulk delete retains the Social watchlist');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
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
 const routes=[],provider=new BlockscoutProvider({proApiKey:'',intervalMs:0,retries:0,fetchImpl:async url=>{routes.push(url.href);assert.equal(url.hostname,'robinhoodchain.blockscout.com');return {ok:true,json:async()=>url.pathname.endsWith('/holders')?{items:[{address:{hash:A},value:'7'}],next_page_params:null}:url.pathname.includes('/addresses/')?{items:[{token:{address_hash:TA},value:'7'}],next_page_params:null}:{address_hash:TA,decimals:'18',symbol:'RH',name:'Robinhood',type:'ERC-20'}};}});
 assert.equal((await provider.metadata({chainId:'robinhood',address:TA})).symbol,'RH');
 assert.equal((await provider.page({kind:'holders',chainId:'robinhood',address:TA,cursor:null})).items.length,1);
 assert.equal((await provider.page({kind:'wallets',chainId:'robinhood',address:A,cursor:null})).items.length,1);
 assert.deepEqual(routes.map(url=>new URL(url).pathname),[`/api/v2/tokens/${TA}`,`/api/v2/tokens/${TA}/holders`,`/api/v2/addresses/${A}/tokens`]);
}
console.log('Server regressions passed: late AND matches, unlimited pages, cache, SQLite resume, pause, API errors, cursor loops, deduplication and HTTP isolation.');
