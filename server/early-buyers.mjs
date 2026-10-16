import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';

const ACTIVE=new Set(['running']);
const FINAL=new Set(['complete','complete_with_warnings','failed']);
const THRESHOLDS=new Set([250,500]);
const now=()=>new Date().toISOString();
const parse=value=>{try{return value?JSON.parse(value):null;}catch{return null;}};
const asThreshold=value=>{const n=Number(value??250);if(!THRESHOLDS.has(n))throw Object.assign(new Error('Threshold musí být 250 nebo 500 USD.'),{status:400});return n;};

export class EarlyBuyerService{
 constructor(db,{apiToken=()=>process.env.ENVIO_API_TOKEN,runScan=null,nowFn=now}={}){
  this.db=db;this.apiToken=typeof apiToken==='function'?apiToken:()=>apiToken;this.runScan=runScan||((options)=>this.runWorker(options));this.now=nowFn;this.job=null;this.worker=null;
  db.exec(`PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS early_buyer_snapshots(
    id TEXT PRIMARY KEY,captured_at TEXT NOT NULL,window_start TEXT NOT NULL,window_end TEXT NOT NULL,status TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,trending_count INTEGER NOT NULL DEFAULT 15,analyzed_token_count INTEGER NOT NULL DEFAULT 0,
    confirmed_wallet_count INTEGER NOT NULL DEFAULT 0,warning_count INTEGER NOT NULL DEFAULT 0,query_count INTEGER NOT NULL DEFAULT 0,
    response_pages INTEGER NOT NULL DEFAULT 0,response_bytes INTEGER NOT NULL DEFAULT 0,swap_log_count INTEGER NOT NULL DEFAULT 0,
    transfer_log_count INTEGER NOT NULL DEFAULT 0,candidate_buy_count INTEGER NOT NULL DEFAULT 0,confirmed_buy_count INTEGER NOT NULL DEFAULT 0,
    uncertain_count INTEGER NOT NULL DEFAULT 0,unpriced_count INTEGER NOT NULL DEFAULT 0,phase_timings_json TEXT NOT NULL DEFAULT '{}',
    diagnostics_json TEXT NOT NULL DEFAULT '{}',exclude_top_100 INTEGER NOT NULL DEFAULT 1,error_summary TEXT,progress_phase TEXT,progress_token TEXT,updated_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS early_buyer_snapshots_history ON early_buyer_snapshots(captured_at DESC);
   CREATE TABLE IF NOT EXISTS early_buyer_tokens(
    snapshot_id TEXT NOT NULL,coingecko_id TEXT NOT NULL,symbol TEXT NOT NULL,chain TEXT,contract_address TEXT,rank INTEGER NOT NULL,
    pair_address TEXT,dex_id TEXT,liquidity_usd REAL NOT NULL DEFAULT 0,volume_24h_usd REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL,skip_reason TEXT,market_cap_rank INTEGER,PRIMARY KEY(snapshot_id,rank),
    FOREIGN KEY(snapshot_id) REFERENCES early_buyer_snapshots(id) ON DELETE CASCADE);
   CREATE INDEX IF NOT EXISTS early_buyer_tokens_contract ON early_buyer_tokens(chain,contract_address);
   CREATE TABLE IF NOT EXISTS early_buyer_wallet_tokens(
    snapshot_id TEXT NOT NULL,wallet_address TEXT NOT NULL,chain TEXT NOT NULL,token_contract TEXT NOT NULL,token_symbol TEXT NOT NULL,
    first_buy_at TEXT NOT NULL,last_buy_at TEXT NOT NULL,buy_count INTEGER NOT NULL,total_usd_bought REAL NOT NULL,
    lead_time_hours REAL NOT NULL,threshold_250 INTEGER NOT NULL,threshold_500 INTEGER NOT NULL,sample_tx_hash TEXT,
    first_buy_at_250 TEXT,last_buy_at_250 TEXT,buy_count_250 INTEGER NOT NULL DEFAULT 0,total_usd_250 REAL NOT NULL DEFAULT 0,lead_time_hours_250 REAL,
    first_buy_at_500 TEXT,last_buy_at_500 TEXT,buy_count_500 INTEGER NOT NULL DEFAULT 0,total_usd_500 REAL NOT NULL DEFAULT 0,lead_time_hours_500 REAL,
    PRIMARY KEY(snapshot_id,wallet_address,chain,token_contract),
    FOREIGN KEY(snapshot_id) REFERENCES early_buyer_snapshots(id) ON DELETE CASCADE);
   CREATE INDEX IF NOT EXISTS early_buyer_wallet ON early_buyer_wallet_tokens(wallet_address,snapshot_id);`);
  const ensureColumn=(table,column,definition)=>{
   const columns=db.prepare(`PRAGMA table_info(${table})`).all();
   if(!columns.some(item=>item.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  // Legacy snapshots predate this filter, so their effective setting is false.
  ensureColumn('early_buyer_snapshots','exclude_top_100','INTEGER NOT NULL DEFAULT 0');
  ensureColumn('early_buyer_tokens','market_cap_rank','INTEGER');
 }
 active(){return this.job&&ACTIVE.has(this.job.status)?this.job:null;}
 status(){return this.job?{...this.job}:null;}
 async start({excludeTop100=true}={}){
  excludeTop100=excludeTop100!==false;
  if(!this.apiToken())throw Object.assign(new Error('Chybí ENVIO_API_TOKEN. Doplňte serverovou konfiguraci a restartujte aplikaci.'),{status:503,code:'missing_envio_token'});
  if(this.active())return {existing:true,job:{...this.job}};
  const id=randomUUID(),capturedAt=this.now(),startMs=Date.parse(capturedAt),windowStart=new Date(startMs-7*86_400_000).toISOString(),windowEnd=new Date(startMs-86_400_000).toISOString();
  this.job={id,status:'running',phase:'trending',phaseLabel:'Trending tokeny',tokenProgress:null,startedAt:capturedAt,error:null};
  this.db.prepare(`INSERT INTO early_buyer_snapshots(id,captured_at,window_start,window_end,status,trending_count,exclude_top_100,progress_phase,updated_at)
   VALUES(?,?,?,?,'running',15,?,'trending',?)`).run(id,capturedAt,windowStart,windowEnd,excludeTop100?1:0,capturedAt);
  this.runScan({apiToken:this.apiToken(),snapshotAt:capturedAt,excludeTop100,onProgress:line=>this.updateProgress(line)}).then(snapshot=>{this.updateProgress('Ukládám snapshot');this.complete(id,snapshot,startMs);}).catch(error=>this.fail(id,error,startMs));
  return {existing:false,job:{...this.job}};
 }
 updateProgress(line){
  const text=String(line||''),job=this.job;if(!job||job.status!=='running')return;
  let phase=job.phase,tokenProgress=job.tokenProgress;
  if(/Discovery token|Trending TOKEN|token pairs/i.test(text)){phase='pools';const match=text.match(/(?:Discovery token|Token)\s+(\d+\/\d+)/i);if(match)tokenProgress=match[1];}
  else if(/Resolving .* block range|Block range/i.test(text))phase='swaps';
  else if(/Swap pages|Swap phase/i.test(text))phase='swaps';
  else if(/Transfer pages|Transfer phase/i.test(text))phase='transfers';
  else if(/Transaction metadata|Pricing|DATA QUALITY/i.test(text))phase='resolution';
  else if(/BUY >=|TOP \d+ WALLETS/i.test(text))phase='aggregation';
  else if(/Ukládám snapshot|Saving snapshot/i.test(text))phase='saving';
  job.phase=phase;job.tokenProgress=tokenProgress;job.phaseLabel=({trending:'Trending tokeny',pools:'Pool discovery',swaps:'Swap data',transfers:'Transfer data',resolution:'Wallet resolution',aggregation:'Agregace',saving:'Uložení snapshotu'})[phase];
  const at=this.now();this.db.prepare('UPDATE early_buyer_snapshots SET progress_phase=?,progress_token=?,updated_at=? WHERE id=? AND status=\'running\'').run(phase,tokenProgress,at,job.id);
 }
 async runWorker({snapshotAt,excludeTop100=true}={}){
  return await new Promise((resolve,reject)=>{
   const worker=new Worker(new URL('./early-buyers-worker.mjs',import.meta.url),{env:process.env,workerData:{snapshotAt,excludeTop100}});this.worker=worker;let settled=false;
   worker.on('message',message=>{
    if(message.type==='log')this.updateProgress(message.line);
    else if(message.type==='error')this.updateProgress(message.line);
    else if(message.type==='result'){settled=true;resolve(message.snapshot);worker.terminate();}
    else if(message.type==='failure'){settled=true;reject(new Error(message.message));worker.terminate();}
   });
   worker.on('error',error=>{this.worker=null;if(!settled){settled=true;reject(error);}});
   worker.on('exit',code=>{this.worker=null;if(!settled){settled=true;reject(new Error(`Early Buyers worker skončil s kódem ${code}.`));}});
  });
 }
 async close(){if(this.worker){const worker=this.worker;this.worker=null;await worker.terminate();}}
 complete(id,snapshot,startedAt){
  const row=this.db.prepare('SELECT * FROM early_buyer_snapshots WHERE id=?').get(id);if(!row)return;
  try{
   const diagnostics=snapshot.diagnostics||{},coverage=Array.isArray(snapshot.tokenCoverage)?snapshot.tokenCoverage:[],tokens=[...coverage];
   const known=new Set(tokens.map(item=>item.rank));for(const item of snapshot.tokens||[])if(!known.has(item.rank))tokens.push({...item,status:'analyzed'});
   const warnings=[...(snapshot.warnings||[])];const skipped=tokens.filter(item=>item.status!=='analyzed').length;if(skipped&&!warnings.length)warnings.push(`${skipped} tokenů z Top 15 nebylo analyzováno.`);
   const status=warnings.length?'complete_with_warnings':'complete',updated=this.now(),duration=Math.max(0,Date.parse(updated)-startedAt),db=this.db;
   db.exec('BEGIN IMMEDIATE');try{
    db.prepare(`UPDATE early_buyer_snapshots SET status=?,duration_ms=?,trending_count=?,analyzed_token_count=?,confirmed_wallet_count=?,warning_count=?,query_count=?,response_pages=?,response_bytes=?,swap_log_count=?,transfer_log_count=?,candidate_buy_count=?,confirmed_buy_count=?,uncertain_count=?,unpriced_count=?,phase_timings_json=?,diagnostics_json=?,exclude_top_100=?,error_summary=NULL,progress_phase='complete',progress_token=NULL,updated_at=? WHERE id=?`)
     .run(status,duration,tokens.length,(snapshot.tokens||[]).length,snapshot.thresholds?.['250']?.uniqueWallets||0,warnings.length,diagnostics.hypersyncQueries||0,diagnostics.responsePages||0,diagnostics.responseBytes||0,diagnostics.swapEventsFetched||0,diagnostics.transferLogsFetched||0,diagnostics.candidateBuys||0,diagnostics.confirmedBuys||0,diagnostics.unresolvedWalletTrades||0,diagnostics.unpricedTrades||0,JSON.stringify(snapshot.timing||{}),JSON.stringify({...diagnostics,warnings,validation:snapshot.validation||null,validationSemantics:'not run in production; UNVERIFIED is not INVALID'}),row.exclude_top_100,updated,id);
    const tokenInsert=db.prepare(`INSERT INTO early_buyer_tokens(snapshot_id,coingecko_id,symbol,chain,contract_address,rank,pair_address,dex_id,liquidity_usd,volume_24h_usd,status,skip_reason,market_cap_rank)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for(const item of tokens){const pool=item.pools?.[0]||{};tokenInsert.run(id,String(item.id||`rank-${item.rank}`),String(item.symbol||'').slice(0,32),item.chain||null,item.contract||null,Number(item.rank)||0,pool.pairAddress||null,pool.dexId||null,Number(pool.liquidityUsd??pool.liquidity?.usd)||0,Number(pool.volume24hUsd??pool.volume?.h24)||0,item.status||'failed',item.skipReason||null,Number.isInteger(item.marketCapRank)?item.marketCapRank:null);}
    const walletInsert=db.prepare(`INSERT INTO early_buyer_wallet_tokens(snapshot_id,wallet_address,chain,token_contract,token_symbol,first_buy_at,last_buy_at,buy_count,total_usd_bought,lead_time_hours,threshold_250,threshold_500,sample_tx_hash,
     first_buy_at_250,last_buy_at_250,buy_count_250,total_usd_250,lead_time_hours_250,first_buy_at_500,last_buy_at_500,buy_count_500,total_usd_500,lead_time_hours_500)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for(const item of snapshot.walletTokenCombinations||[]){const a=item.threshold250Stats||{},b=item.threshold500Stats||{};walletInsert.run(id,String(item.wallet).toLowerCase(),item.chain,String(item.contract).toLowerCase(),item.token,item.firstBuyAt,item.lastBuyAt,item.buyCount,item.totalUsdBought,item.leadTimeHours,item.threshold250?1:0,item.threshold500?1:0,item.sampleTxHash||null,
     a.firstBuyAt||null,a.lastBuyAt||null,a.buyCount||0,a.totalUsdBought||0,a.leadTimeHours??null,b.firstBuyAt||null,b.lastBuyAt||null,b.buyCount||0,b.totalUsdBought||0,b.leadTimeHours??null);}
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   if(this.job?.id===id)this.job={...this.job,status,phase:'complete',phaseLabel:'Snapshot uložen',finishedAt:updated,tokenProgress:null,error:null};
  }catch(error){this.fail(id,error,startedAt);}
 }
 fail(id,error,startedAt){
  const message=String(error?.message||'Early Buyers scan selhal.').slice(0,1000),at=this.now();
  this.db.prepare(`UPDATE early_buyer_snapshots SET status='failed',duration_ms=?,error_summary=?,progress_phase='failed',progress_token=NULL,updated_at=? WHERE id=? AND status='running'`).run(Math.max(0,Date.parse(at)-startedAt),message,at,id);
  if(this.job?.id===id)this.job={...this.job,status:'failed',phase:'failed',phaseLabel:'Scan selhal',finishedAt:at,tokenProgress:null,error:message};
 }
 snapshots(){return this.db.prepare(`SELECT id,captured_at AS capturedAt,window_start AS windowStart,window_end AS windowEnd,status,duration_ms AS durationMs,trending_count AS trendingCount,analyzed_token_count AS analyzedTokenCount,confirmed_wallet_count AS confirmedWalletCount,warning_count AS warningCount,query_count AS queryCount,response_pages AS responsePages,response_bytes AS responseBytes,exclude_top_100 AS excludeTop100,error_summary AS errorSummary FROM early_buyer_snapshots ORDER BY captured_at DESC`).all().map(item=>({...item,excludeTop100:item.excludeTop100!==0}));}
 snapshot(id){const row=this.db.prepare('SELECT * FROM early_buyer_snapshots WHERE id=?').get(id);return row?this.decodeSnapshot(row):null;}
 decodeSnapshot(row){
  const tokens=this.db.prepare('SELECT coingecko_id AS id,symbol,chain,contract_address AS contract,rank,pair_address AS pairAddress,dex_id AS dexId,liquidity_usd AS liquidityUsd,volume_24h_usd AS volume24hUsd,status,skip_reason AS skipReason,market_cap_rank AS marketCapRank FROM early_buyer_tokens WHERE snapshot_id=? ORDER BY rank').all(row.id);
  const timing=parse(row.phase_timings_json)||{},diagnostics=parse(row.diagnostics_json)||{};
  return {id:row.id,capturedAt:row.captured_at,windowStart:row.window_start,windowEnd:row.window_end,status:row.status,durationMs:row.duration_ms,
   trendingCount:row.trending_count,analyzedTokenCount:row.analyzed_token_count,confirmedWalletCount:row.confirmed_wallet_count,warningCount:row.warning_count,excludeTop100:row.exclude_top_100!==0,
   queryCount:row.query_count,responsePages:row.response_pages,responseBytes:row.response_bytes,swapLogCount:row.swap_log_count,transferLogCount:row.transfer_log_count,
   candidateBuyCount:row.candidate_buy_count,confirmedBuyCount:row.confirmed_buy_count,uncertainCount:row.uncertain_count,unpricedCount:row.unpriced_count,
   phaseTimings:timing,diagnostics,errorSummary:row.error_summary,tokens};
 }
 results({snapshotId=null,threshold=250}={}){
  const t=asThreshold(threshold),currentId=snapshotId||this.db.prepare("SELECT id FROM early_buyer_snapshots WHERE status IN ('complete','complete_with_warnings') ORDER BY captured_at DESC LIMIT 1").get()?.id||null;
  if(!currentId)return {snapshot:null,summary:{analyzedTokenCount:0,trendingCount:15,confirmedEarlyBuyers:0,historicalRepeaters:0,avgLeadHours:null,threshold:t},wallets:[],tokens:[],history:this.snapshots(),coverage:[],job:this.status()};
  const snapshot=this.snapshot(currentId);if(!snapshot)return {snapshot:null,summary:{analyzedTokenCount:0,trendingCount:15,confirmedEarlyBuyers:0,historicalRepeaters:0,avgLeadHours:null,threshold:t},wallets:[],tokens:[],history:this.snapshots(),coverage:[],job:this.status()};
  const included=t===250?'threshold_250':'threshold_500';
  const suffix=t===250?'250':'500';
  const rows=this.db.prepare(`SELECT w.snapshot_id AS snapshotId,w.wallet_address AS wallet,w.chain,w.token_contract AS contract,w.token_symbol AS symbol,w.first_buy_at_${suffix} AS firstBuyAt,w.last_buy_at_${suffix} AS lastBuyAt,w.buy_count_${suffix} AS buyCount,w.total_usd_${suffix} AS totalUsdBought,w.lead_time_hours_${suffix} AS leadTimeHours,w.sample_tx_hash AS sampleTxHash,s.captured_at AS capturedAt
   FROM early_buyer_wallet_tokens w JOIN early_buyer_snapshots s ON s.id=w.snapshot_id WHERE w.${included}=1 AND s.status IN ('complete','complete_with_warnings') ORDER BY s.captured_at DESC`).all();
  const historical=new Map(),currentByWallet=new Map(),snapshotsByWallet=new Map();
  for(const row of rows){const wallet=row.wallet.toLowerCase(),tokenKey=`${row.chain}:${row.contract.toLowerCase()}`,key=`${wallet}:${tokenKey}`;
   let entry=historical.get(key);if(!entry){entry={...row,wallet,tokenKey};historical.set(key,entry);}
   const seenSnapshots=snapshotsByWallet.get(wallet)||new Set();seenSnapshots.add(row.snapshotId);snapshotsByWallet.set(wallet,seenSnapshots);
   if(row.snapshotId===currentId){const list=currentByWallet.get(wallet)||[];list.push(row);currentByWallet.set(wallet,list);}
  }
  const byWallet=new Map();for(const row of historical.values()){let item=byWallet.get(row.wallet);if(!item){item={wallet:row.wallet,tokenMap:new Map(),snapshots:snapshotsByWallet.get(row.wallet)||new Set(),totalUsdBought:0,lead:0,lastHitAt:null};byWallet.set(row.wallet,item);}
   item.tokenMap.set(row.tokenKey,row);item.totalUsdBought+=Number(row.totalUsdBought)||0;item.lead+=Number(row.leadTimeHours)||0;
   if(!item.lastHitAt||row.firstBuyAt>item.lastHitAt)item.lastHitAt=row.firstBuyAt;
  }
  const wallets=[...byWallet.values()].map(item=>{const all=[...item.tokenMap.values()],current=currentByWallet.get(item.wallet)||[],currentUnique=[...new Map(current.map(row=>[`${row.chain}:${row.contract.toLowerCase()}`,row])).values()];return {
    wallet:item.wallet,historicalHits:all.length,currentHits:currentUnique.length,snapshotsHit:item.snapshots.size,
    tokens:all.map(row=>({chain:row.chain,contract:row.contract,symbol:row.symbol,isCurrent:currentUnique.some(c=>c.chain===row.chain&&c.contract.toLowerCase()===row.contract.toLowerCase()),firstBuyAt:row.firstBuyAt,lastBuyAt:row.lastBuyAt,buyCount:row.buyCount,totalUsdBought:row.totalUsdBought,leadTimeHours:row.leadTimeHours,sampleTxHash:row.sampleTxHash})),
    currentTokens:currentUnique.map(row=>row.symbol),totalUsdBought:item.totalUsdBought,avgLeadHours:all.length?item.lead/all.length:0,lastHitAt:item.lastHitAt,
  };}).sort((a,b)=>b.historicalHits-a.historicalHits||b.currentHits-a.currentHits||b.totalUsdBought-a.totalUsdBought||b.avgLeadHours-a.avgLeadHours);
  const currentWallets=new Set(currentByWallet.keys()),avgLead=wallets.filter(w=>currentWallets.has(w.wallet));
  return {snapshot,summary:{analyzedTokenCount:snapshot.analyzedTokenCount,trendingCount:snapshot.trendingCount,confirmedEarlyBuyers:currentWallets.size,
   historicalRepeaters:wallets.filter(w=>w.historicalHits>=2).length,avgLeadHours:avgLead.length?avgLead.reduce((sum,w)=>sum+w.avgLeadHours,0)/avgLead.length:null,threshold:t},
   wallets,tokens:snapshot.tokens,coverage:snapshot.tokens,history:this.snapshots(),job:this.status()};
 }
 removeSnapshot(id){const row=this.db.prepare('SELECT id,status FROM early_buyer_snapshots WHERE id=?').get(id);if(!row)throw Object.assign(new Error('Snapshot nebyl nalezen.'),{status:404});if(ACTIVE.has(row.status))throw Object.assign(new Error('Běžící snapshot nelze smazat.'),{status:409});this.db.prepare('DELETE FROM early_buyer_snapshots WHERE id=?').run(id);return {deleted:id};}
}

export function earlyBuyersWorkerUrl(){return new URL('./early-buyers-worker.mjs',import.meta.url);}
