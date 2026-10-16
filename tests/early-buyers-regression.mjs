import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {EarlyBuyerService} from '../server/early-buyers.mjs';
import {SmartWalletStore} from '../server/smart-wallets.mjs';
import {marketCapRankDecision} from '../server/early-buyers-engine.mjs';

const A='0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',B='0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',C='0xcccccccccccccccccccccccccccccccccccccccc';
const addr=n=>`0x${String(n).padStart(40,'0')}`;
const db=new DatabaseSync(':memory:');let runCount=0,time=Date.parse('2026-10-16T12:00:00.000Z'),scenario;
const nowFn=()=>new Date(time+=1000).toISOString();
function fixture(snapshotAt,tokens,walletTokenCombinations,{warnings=[],validation=null,skipped=[],excludeTop100=true}={}){
 const tokensOutput=tokens.map(token=>({rank:token.rank,id:token.id,name:token.symbol,symbol:token.symbol,marketCapRank:token.marketCapRank??null,chain:'ethereum',contract:token.contract,pools:[{pairAddress:addr(token.rank+100),dexId:'uniswap',decoder:'uniswap-v2',liquidityUsd:25000,volume24hUsd:9000}]}));
 const coverage=[...tokens.map(token=>({...tokensOutput.find(item=>item.rank===token.rank),status:token.status||'analyzed',skipReason:token.skipReason||null})),...skipped];
 return {snapshotAt,excludeTop100,windowStart:new Date(Date.parse(snapshotAt)-7*86400000).toISOString(),windowEnd:new Date(Date.parse(snapshotAt)-86400000).toISOString(),tokens:tokensOutput,tokenCoverage:coverage,walletTokenCombinations,thresholds:{250:{uniqueWallets:walletTokenCombinations.filter(item=>item.threshold250).length}},diagnostics:{hypersyncQueries:2,responsePages:3,responseBytes:42,swapEventsFetched:4,transferLogsFetched:5,candidateBuys:3,confirmedBuys:2,unresolvedWalletTrades:1,unpricedTrades:0},timing:{transferQueryMs:1000,totalMs:1500},warnings,validation,rawLogs:[{secretFixture:'must never be persisted'}]};
}
const token=(rank,symbol='TKN')=>({rank,id:`token-${rank}`,symbol,contract:addr(rank)});
const combo=(wallet,tokenInfo,{at='2026-10-10T12:00:00.000Z',usd250=800,usd500=600,lead=144}={})=>({wallet,token:tokenInfo.symbol,chain:'ethereum',contract:tokenInfo.contract,firstBuyAt:at,lastBuyAt:at,buyCount:1,totalUsdBought:usd250,leadTimeHours:lead,threshold250:usd250>=250,threshold500:usd500>=500,sampleTxHash:addr(700),threshold250Stats:usd250>=250?{firstBuyAt:at,lastBuyAt:at,buyCount:1,totalUsdBought:usd250,leadTimeHours:lead}:null,threshold500Stats:usd500>=500?{firstBuyAt:at,lastBuyAt:at,buyCount:1,totalUsdBought:usd500,leadTimeHours:lead}:null});
const p1=token(1,'ONE'),p2=token(2,'TWO'),p3=token(3,'THREE');
const service=new EarlyBuyerService(db,{apiToken:'test-token',nowFn,runScan:async options=>{runCount++;return scenario(options);}});
async function startSnapshot(make,options={}){scenario=scanOptions=>make(scanOptions.snapshotAt,scanOptions);const started=await service.start(options);assert.equal(started.existing,false);const id=started.job.id;for(let i=0;i<80;i++){const row=db.prepare('SELECT status FROM early_buyer_snapshots WHERE id=?').get(id);if(row.status!=='running')return id;await new Promise(resolve=>setTimeout(resolve,2));}throw new Error('fixture scan did not complete');}
const sameToken=(snapshotAt)=>fixture(snapshotAt,[p1],[combo(A,p1),combo(B,p1,{usd250:300,usd500:200})],{validation:{valid:7,invalid:0,uncertain:3,unverified:3},skipped:[{rank:2,id:'unsupported-token',symbol:'SKIP',chain:'base',contract:addr(22),pools:[{pairAddress:addr(101),dexId:'supernova',liquidityUsd:20000}],status:'unsupported_dex',skipReason:'DEX decoder is not supported.'}]});
assert.equal(marketCapRankDecision(25).excluded,true,'A: market_cap_rank 25 skips');
assert.equal(marketCapRankDecision(100).excluded,true,'B: market_cap_rank 100 skips');
assert.equal(marketCapRankDecision(101).excluded,false,'C: market_cap_rank 101 analyzes');
assert.equal(marketCapRankDecision(500).excluded,false,'D: market_cap_rank 500 analyzes');
assert.deepEqual(marketCapRankDecision(null),{marketCapRank:null,excluded:false},'E: unknown market-cap rank analyzes');
assert.equal(marketCapRankDecision(25,false).excluded,false,'F: disabling toggle allows Top 100 token');
const firstId=await startSnapshot(sameToken);
assert.equal(service.snapshot(firstId).status,'complete_with_warnings','unsupported/failed token rows produce warning completion');
assert.equal(service.snapshot(firstId).warningCount,1);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM early_buyer_tokens WHERE snapshot_id=? AND status='unsupported_dex' AND skip_reason IS NOT NULL").get(firstId).n,1,'unsupported token has an explicit skip reason');
const validation=service.snapshot(firstId).diagnostics.validation;assert.equal(validation.unverified,3);assert.equal(validation.invalid,0,'UNVERIFIED is not converted to INVALID');
assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%raw%'").all(),[],'raw HyperSync log table is absent');
assert.equal(JSON.stringify(service.snapshot(firstId)).includes('must never be persisted'),false,'raw log fixture payload is not persisted');
const callsBeforeToggle=runCount;
assert.equal(service.results({snapshotId:firstId,threshold:250}).wallets.length,2,'$250 layer includes the smaller wallet');
assert.equal(service.results({snapshotId:firstId,threshold:500}).wallets.length,1,'$500 layer excludes wallet without qualifying buy');
assert.equal(runCount,callsBeforeToggle,'threshold toggle reads stored aggregates without a new scan');

const secondId=await startSnapshot(sameToken),thirdId=await startSnapshot(sameToken);
let result=service.results({snapshotId:firstId,threshold:250});assert.equal(result.wallets.find(wallet=>wallet.wallet===A).historicalHits,1,'same canonical token in three snapshots is one historical hit');
assert.equal(result.wallets.find(wallet=>wallet.wallet===A).snapshotsHit,3);
assert.equal(result.wallets.find(wallet=>wallet.wallet===A).currentHits,1,'current hits are limited to selected snapshot');
assert.equal(service.snapshot(secondId).status,'complete_with_warnings');assert.equal(service.snapshot(thirdId).status,'complete_with_warnings');

const fourthId=await startSnapshot(at=>fixture(at,[p1,p2,p3],[combo(A,p1),combo(A,p2),combo(A,p3)],{warnings:['Token #4 failed.']}));
result=service.results({snapshotId:fourthId,threshold:250});assert.equal(result.wallets.find(wallet=>wallet.wallet===A).historicalHits,3,'three distinct chain+contract tokens yield three historical hits');assert.equal(result.wallets.find(wallet=>wallet.wallet===A).currentHits,3);
assert.equal(service.snapshot(fourthId).status,'complete_with_warnings','one failed token does not discard usable token data');
const historic=service.results({snapshotId:firstId,threshold:250}).wallets.find(wallet=>wallet.wallet===A);assert.equal(historic.currentHits,1,'historical selection does not inflate current hits');
const beforeDelete=service.results({snapshotId:fourthId,threshold:250}).wallets.find(wallet=>wallet.wallet===A).historicalHits;assert.equal(beforeDelete,3);
service.removeSnapshot(fourthId);assert.equal(service.results({snapshotId:firstId,threshold:250}).wallets.find(wallet=>wallet.wallet===A).historicalHits,1,'deleting a snapshot recalculates historical hits');

const ranked150={...p1,marketCapRank:150};
const rankedSnapshot=await startSnapshot(at=>fixture(at,[ranked150],[combo(A,ranked150)],{excludeTop100:true}));
assert.equal(db.prepare('SELECT market_cap_rank AS rank FROM early_buyer_tokens WHERE snapshot_id=? AND coingecko_id=?').get(rankedSnapshot,'token-1').rank,150,'G: token snapshot persists the market-cap rank');
assert.equal(service.snapshot(rankedSnapshot).excludeTop100,true,'snapshot persists the market-cap filter setting');
const ranked70={...ranked150,marketCapRank:70};
await startSnapshot(at=>fixture(at,[ranked70],[combo(A,ranked70)],{excludeTop100:true}));
assert.equal(service.snapshot(rankedSnapshot).tokens.find(item=>item.id==='token-1').marketCapRank,150,'H: a later market-cap rank does not rewrite the historical snapshot');
assert.equal(service.snapshot(rankedSnapshot).tokens.find(item=>item.id==='token-1').status,'analyzed','a later rank change does not remove a historical analyzed token');
const excludedSnapshot=await startSnapshot(at=>fixture(at,[ranked150],[combo(A,ranked150)],{skipped:[{rank:2,id:'large-project',symbol:'LARGE',marketCapRank:25,status:'excluded_top_100',skipReason:'Vyloučen · Market cap #25'}]}));
assert.equal(service.snapshot(excludedSnapshot).tokens.find(item=>item.id==='large-project').status,'excluded_top_100','Top 100 exclusion is visible in persisted coverage');
assert.equal(service.snapshot(excludedSnapshot).tokens.find(item=>item.id==='large-project').skipReason,'Vyloučen · Market cap #25');
assert.equal(service.snapshot(excludedSnapshot).tokens.find(item=>item.id==='large-project').marketCapRank,25);
let scanOption;
const top100WhenDisabled=await startSnapshot((at,options)=>{scanOption=options.excludeTop100;return fixture(at,[{...p1,marketCapRank:25}],[combo(A,p1)],{excludeTop100:options.excludeTop100});},{excludeTop100:false});
assert.equal(scanOption,false,'new scan passes the toggle to discovery');
assert.equal(service.snapshot(top100WhenDisabled).excludeTop100,false,'toggle-off choice is persisted with its snapshot');

const store=new SmartWalletStore(db);const addInput={addresses:[C],tags:['research'],status:'candidate',chainIds:['base']};
const once=store.quickAdd(addInput),twice=store.quickAdd(addInput);assert.deepEqual(once.created,[C]);assert.deepEqual(twice.unchanged,[C]);assert.equal(store.list().filter(wallet=>wallet.address===C).length,1,'quick-add does not duplicate an existing Smart wallet');

let missingRuns=0;const missing=new EarlyBuyerService(db,{apiToken:'',runScan:async()=>{missingRuns++;}});
await assert.rejects(()=>missing.start(),error=>error.code==='missing_envio_token');assert.equal(missingRuns,0,'missing ENVIO_API_TOKEN prevents the scan from starting');
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM early_buyer_snapshots WHERE status=\'running\'').get().n,0);
const legacyDb=new DatabaseSync(':memory:');
legacyDb.exec('CREATE TABLE early_buyer_snapshots(id TEXT PRIMARY KEY,captured_at TEXT NOT NULL); CREATE TABLE early_buyer_tokens(chain TEXT,contract_address TEXT);');
new EarlyBuyerService(legacyDb,{apiToken:'legacy-test'});
assert.equal(legacyDb.prepare("SELECT dflt_value AS value FROM pragma_table_info('early_buyer_snapshots') WHERE name='exclude_top_100'").get().value,'0','legacy snapshots migrate with the old filter recorded as off');
assert.equal(legacyDb.prepare("SELECT name FROM pragma_table_info('early_buyer_tokens') WHERE name='market_cap_rank'").get().name,'market_cap_rank','existing token tables gain the rank column');
legacyDb.close();
db.close();
console.log('Early Buyers regression fixtures passed (market-cap Top 100 filter, null rank, toggle, snapshot rank persistence, historical rank immutability, no raw logs, threshold filtering, historical dedupe, current hits, quick-add, coverage warnings, delete recalculation, missing token, validation semantics).');
