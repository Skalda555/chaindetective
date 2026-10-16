export function createPilotSchema(db) {
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS pilot_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS factory_cursors (
      chain TEXT PRIMARY KEY, last_scanned_block INTEGER NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS factory_pools (
      chain TEXT NOT NULL, pool_address TEXT NOT NULL, factory TEXT NOT NULL, dex_family TEXT NOT NULL,
      token0 TEXT NOT NULL, token1 TEXT NOT NULL, created_block INTEGER NOT NULL, created_at TEXT NOT NULL,
      detected_at TEXT NOT NULL, target_contract TEXT, quote_contract TEXT,
      PRIMARY KEY (chain, pool_address)
    );
    CREATE INDEX IF NOT EXISTS factory_pools_target ON factory_pools(chain, target_contract, created_at);
    CREATE TABLE IF NOT EXISTS tokens (
      chain TEXT NOT NULL, contract TEXT NOT NULL, first_detected_at TEXT NOT NULL, oldest_pool_created_at TEXT NOT NULL,
      last_detected_at TEXT NOT NULL, dex_checked_at TEXT, dex_retry_after TEXT, dex_resolved INTEGER NOT NULL DEFAULT 0,
      classification TEXT NOT NULL DEFAULT 'UNKNOWN', primary_pool_address TEXT, primary_factory TEXT, primary_dex_family TEXT,
      pool_created_at TEXT, pair_json TEXT, pairs_json TEXT,
      quality_json TEXT, first_cg_trending_at TEXT, canonical_checked_at TEXT,
      PRIMARY KEY (chain, contract)
    );
    CREATE TABLE IF NOT EXISTS token_observations (
      chain TEXT NOT NULL, contract TEXT NOT NULL, observed_at TEXT NOT NULL, primary_pool_address TEXT,
      classification TEXT, price_usd REAL, liquidity_usd REAL, market_cap_usd REAL, fdv_usd REAL,
      volume_h1_usd REAL, volume_h6_usd REAL, volume_h24_usd REAL,
      buys_h1 INTEGER, sells_h1 INTEGER, buys_h6 INTEGER, sells_h6 INTEGER, buys_h24 INTEGER, sells_h24 INTEGER,
      quality_json TEXT, vol_accel_ratio REAL, unique_buyers_250 INTEGER, unique_buyers_500 INTEGER,
      smart_wallet_overlap_250 INTEGER, smart_wallet_overlap_500 INTEGER,
      historical_hit_overlap_250 INTEGER, historical_hit_overlap_500 INTEGER,
      first_cg_trending_at TEXT, lead_time_hours REAL,
      PRIMARY KEY (chain, contract, observed_at)
    );
    CREATE TABLE IF NOT EXISTS coingecko_trending_observations (
      observed_at TEXT NOT NULL, rank INTEGER NOT NULL, coin_id TEXT NOT NULL, symbol TEXT,
      chain TEXT, contract TEXT, PRIMARY KEY (observed_at, coin_id)
    );
    CREATE INDEX IF NOT EXISTS trending_identity ON coingecko_trending_observations(chain, contract, observed_at);
    CREATE TABLE IF NOT EXISTS pilot_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at TEXT NOT NULL, phase TEXT NOT NULL, chain TEXT, message TEXT NOT NULL
    );
  `);
}

export function withTransaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = operation(); db.exec('COMMIT'); return result; }
  catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
}

export function initializePilotMeta(db, { startedAt, endsAt, configJson }) {
  const get = db.prepare('SELECT value FROM pilot_meta WHERE key=?');
  if (!get.get('startedAt')) {
    const insert = db.prepare('INSERT INTO pilot_meta(key,value) VALUES(?,?)');
    withTransaction(db, () => {
      insert.run('startedAt', startedAt); insert.run('endsAt', endsAt); insert.run('config', configJson);
    });
  }
  return { startedAt: get.get('startedAt').value, endsAt: get.get('endsAt').value, config: JSON.parse(get.get('config').value) };
}

export function seedFactoryCursor(db, chain, height, now = new Date().toISOString()) {
  db.prepare('INSERT OR IGNORE INTO factory_cursors(chain,last_scanned_block,updated_at) VALUES(?,?,?)').run(chain, height, now);
  return Number(db.prepare('SELECT last_scanned_block FROM factory_cursors WHERE chain=?').get(chain).last_scanned_block);
}

export function commitFactoryRange(db, { chain, expectedFromBlock, toBlock, pools, now = new Date().toISOString() }) {
  if (!Number.isSafeInteger(expectedFromBlock) || !Number.isSafeInteger(toBlock) || toBlock < expectedFromBlock) throw new Error('Invalid factory cursor range.');
  const insertPool = db.prepare(`INSERT INTO factory_pools(chain,pool_address,factory,dex_family,token0,token1,created_block,created_at,detected_at,target_contract,quote_contract)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(chain,pool_address) DO NOTHING`);
  const insertToken = db.prepare(`INSERT INTO tokens(chain,contract,first_detected_at,oldest_pool_created_at,last_detected_at)
    VALUES(?,?,?,?,?) ON CONFLICT(chain,contract) DO UPDATE SET
      first_detected_at=MIN(tokens.first_detected_at,excluded.first_detected_at),
      oldest_pool_created_at=MIN(tokens.oldest_pool_created_at,excluded.oldest_pool_created_at),
      last_detected_at=MAX(tokens.last_detected_at,excluded.last_detected_at)`);
  const updateCursor = db.prepare(`UPDATE factory_cursors SET last_scanned_block=?,updated_at=? WHERE chain=? AND last_scanned_block=?`);
  withTransaction(db, () => {
    const cursor = db.prepare('SELECT last_scanned_block FROM factory_cursors WHERE chain=?').get(chain);
    if (!cursor || Number(cursor.last_scanned_block) !== expectedFromBlock) throw new Error(`Factory cursor changed for ${chain}; expected ${expectedFromBlock}.`);
    for (const pool of pools) {
      insertPool.run(chain, pool.pool_address, pool.factory, pool.dex_family, pool.token0, pool.token1, pool.created_block,
        pool.created_at, now, pool.target_contract ?? null, pool.quote_contract ?? null);
      if (pool.target_contract) insertToken.run(chain, pool.target_contract, now, pool.created_at, now);
    }
    const moved = updateCursor.run(toBlock, now, chain, expectedFromBlock);
    if (Number(moved.changes) !== 1) throw new Error(`Could not atomically advance ${chain} factory cursor.`);
  });
}

export function upsertTrendingObservation(db, row) {
  db.prepare(`INSERT INTO coingecko_trending_observations(observed_at,rank,coin_id,symbol,chain,contract) VALUES(?,?,?,?,?,?)
    ON CONFLICT(observed_at,coin_id) DO UPDATE SET rank=excluded.rank,symbol=excluded.symbol,chain=excluded.chain,contract=excluded.contract`)
    .run(row.observedAt, row.rank, row.coinId, row.symbol ?? null, row.chain ?? null, row.contract ?? null);
}

export function upsertTokenObservation(db, row) {
  const columns = ['chain','contract','observedAt','primaryPoolAddress','classification','priceUsd','liquidityUsd','marketCapUsd','fdvUsd',
    'volumeH1Usd','volumeH6Usd','volumeH24Usd','buysH1','sellsH1','buysH6','sellsH6','buysH24','sellsH24','qualityJson',
    'volAccelRatio','uniqueBuyers250','uniqueBuyers500','smartWalletOverlap250','smartWalletOverlap500','historicalHitOverlap250','historicalHitOverlap500','firstCgTrendingAt','leadTimeHours'];
  const values = columns.map((key) => row[key] ?? null);
  db.prepare(`INSERT INTO token_observations(chain,contract,observed_at,primary_pool_address,classification,price_usd,liquidity_usd,market_cap_usd,fdv_usd,
    volume_h1_usd,volume_h6_usd,volume_h24_usd,buys_h1,sells_h1,buys_h6,sells_h6,buys_h24,sells_h24,quality_json,vol_accel_ratio,
    unique_buyers_250,unique_buyers_500,smart_wallet_overlap_250,smart_wallet_overlap_500,historical_hit_overlap_250,historical_hit_overlap_500,first_cg_trending_at,lead_time_hours)
    VALUES(${columns.map(() => '?').join(',')}) ON CONFLICT(chain,contract,observed_at) DO UPDATE SET
    primary_pool_address=excluded.primary_pool_address,classification=excluded.classification,price_usd=excluded.price_usd,
    liquidity_usd=excluded.liquidity_usd,market_cap_usd=excluded.market_cap_usd,fdv_usd=excluded.fdv_usd,
    volume_h1_usd=excluded.volume_h1_usd,volume_h6_usd=excluded.volume_h6_usd,volume_h24_usd=excluded.volume_h24_usd,
    buys_h1=excluded.buys_h1,sells_h1=excluded.sells_h1,buys_h6=excluded.buys_h6,sells_h6=excluded.sells_h6,
    buys_h24=excluded.buys_h24,sells_h24=excluded.sells_h24,quality_json=excluded.quality_json,vol_accel_ratio=excluded.vol_accel_ratio,
    unique_buyers_250=COALESCE(excluded.unique_buyers_250,token_observations.unique_buyers_250),
    unique_buyers_500=COALESCE(excluded.unique_buyers_500,token_observations.unique_buyers_500),
    smart_wallet_overlap_250=COALESCE(excluded.smart_wallet_overlap_250,token_observations.smart_wallet_overlap_250),
    smart_wallet_overlap_500=COALESCE(excluded.smart_wallet_overlap_500,token_observations.smart_wallet_overlap_500),
    historical_hit_overlap_250=COALESCE(excluded.historical_hit_overlap_250,token_observations.historical_hit_overlap_250),
    historical_hit_overlap_500=COALESCE(excluded.historical_hit_overlap_500,token_observations.historical_hit_overlap_500),
    first_cg_trending_at=COALESCE(excluded.first_cg_trending_at,token_observations.first_cg_trending_at),
    lead_time_hours=COALESCE(excluded.lead_time_hours,token_observations.lead_time_hours)`)
    .run(...values);
}

export function floorTimeBucket(dateMs, intervalMs) {
  if (!Number.isFinite(dateMs) || !Number.isSafeInteger(intervalMs) || intervalMs <= 0) throw new Error('Invalid observation bucket input.');
  return new Date(Math.floor(dateMs / intervalMs) * intervalMs).toISOString();
}

export function quantile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * Math.max(0, Math.min(1, p));
  const lo = Math.floor(position); const hi = Math.ceil(position);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}
