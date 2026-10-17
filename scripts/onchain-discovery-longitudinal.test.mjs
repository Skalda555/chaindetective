import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  commitFactoryRange, CONFIG_DEFAULTS, createPilotSchema, floorTimeBucket, initializePilotMeta, migratePilotConfig, migratePilotMetaConfig,
  seedFactoryCursor, upsertGeckoTrendingObservation, upsertTokenObservation, upsertTrendingObservation,
} from './onchain-discovery-longitudinal-store.mjs';
import { normalizeGeckoTrending, recordGeckoFirstSeen, saveDexToken, summarizeBenchmark } from './onchain-discovery-longitudinal.mjs';
import { resolveFirstBlockAtOrAfter, resolveTimestampWindow, unixSecondAtOrAfter } from './onchain-discovery-block-bounds.mjs';

const db = new DatabaseSync(':memory:');
createPilotSchema(db);
const meta = initializePilotMeta(db, { startedAt: '2026-10-16T00:00:00.000Z', endsAt: '2026-10-30T00:00:00.000Z', configJson: '{"durationDays":14}' });
assert.equal(meta.endsAt, '2026-10-30T00:00:00.000Z');
assert.equal(seedFactoryCursor(db, 'base', 100), 100);
assert.equal(seedFactoryCursor(db, 'base', 140), 100, 'restarts preserve the committed cursor');

const pool = { pool_address: '0x0000000000000000000000000000000000000001', factory: '0x0000000000000000000000000000000000000002',
  dex_family: 'uniswap-v2', token0: '0x0000000000000000000000000000000000000003',
  token1: '0x0000000000000000000000000000000000000004', created_block: 101,
  created_at: '2026-10-16T00:01:00.000Z', target_contract: '0x0000000000000000000000000000000000000004',
  quote_contract: '0x0000000000000000000000000000000000000003' };
assert.throws(() => commitFactoryRange(db, { chain: 'base', expectedFromBlock: 100, toBlock: 120,
  pools: null }));
assert.equal(Number(db.prepare('SELECT last_scanned_block AS n FROM factory_cursors WHERE chain=?').get('base').n), 100,
  'failed range transaction never advances cursor');
assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM factory_pools').get().n), 0, 'failed range transaction rolls back inserted pools');
commitFactoryRange(db, { chain: 'base', expectedFromBlock: 100, toBlock: 120, pools: [pool], now: '2026-10-16T00:05:00.000Z' });
assert.equal(Number(db.prepare('SELECT last_scanned_block AS n FROM factory_cursors WHERE chain=?').get('base').n), 120);
const tokenTimes = db.prepare('SELECT first_detected_at,oldest_pool_created_at FROM tokens WHERE chain=? AND contract=?')
  .get('base', pool.target_contract);
assert.equal(tokenTimes.first_detected_at, '2026-10-16T00:05:00.000Z', 'first detected records when the worker observed the factory log');
assert.equal(tokenTimes.oldest_pool_created_at, pool.created_at, 'pool creation time remains a separate field');
commitFactoryRange(db, { chain: 'base', expectedFromBlock: 120, toBlock: 120, pools: [pool] });
assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM factory_pools').get().n), 1, 'replayed factory logs are idempotent');

const observation = { chain: 'base', contract: pool.target_contract, observedAt: '2026-10-16T00:30:00.000Z',
  primaryPoolAddress: pool.pool_address, classification: 'NEW_TOKEN_CANDIDATE', liquidityUsd: 15_000, qualityJson: '{"LOOSE":true}', volAccelRatio: 2.5 };
upsertTokenObservation(db, observation);
upsertTokenObservation(db, { ...observation, liquidityUsd: 20_000 });
assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM token_observations').get().n), 1, 'same observation bucket upserts once');
assert.equal(Number(db.prepare('SELECT liquidity_usd AS n FROM token_observations').get().n), 20_000);
assert.equal(Number(db.prepare('SELECT vol_accel_ratio AS n FROM token_observations').get().n), 2.5, 'volume acceleration is persisted in the observation');
upsertTrendingObservation(db, { observedAt: observation.observedAt, rank: 1, coinId: 'test-coin', symbol: 'TST', chain: 'base', contract: pool.target_contract });
upsertTrendingObservation(db, { observedAt: observation.observedAt, rank: 2, coinId: 'test-coin', symbol: 'TST', chain: 'base', contract: pool.target_contract });
assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM coingecko_trending_observations').get().n), 1, 'same CoinGecko time bucket upserts once');
assert.equal(floorTimeBucket(Date.parse('2026-10-16T00:07:42.000Z'), 5 * 60_000), '2026-10-16T00:05:00.000Z');

const ethTarget = '0xb3198fd8d281c8536adf2fe00fe2f985fe619000';
const gtPayload = { data: [
  { id: `eth_${pool.pool_address}`, attributes: { address: pool.pool_address, name: 'FTR / WETH',
    pool_created_at: '2026-10-15T16:42:59Z', reserve_in_usd: '1234.5', volume_usd: { h1: '40' }, transactions: { h1: { buys: 2, sells: 1 } } },
    relationships: { base_token: { data: { id: `eth_${ethTarget}`, type: 'token' } }, quote_token: { data: { id: 'eth_0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', type: 'token' } } } },
  { id: `eth_${pool.pool_address}`, attributes: { address: pool.pool_address }, relationships: {
    base_token: { data: { id: 'eth_0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', type: 'token' } },
    quote_token: { data: { id: 'eth_0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', type: 'token' } } } },
  { id: `eth_${pool.pool_address}`, attributes: { address: pool.pool_address }, relationships: {
    base_token: { data: { id: 'eth_0x0000000000000000000000000000000000000001', type: 'token' } },
    quote_token: { data: { id: 'eth_0x0000000000000000000000000000000000000002', type: 'token' } } } },
] };
const gtRows5m = normalizeGeckoTrending(gtPayload, 'ethereum', '5m', '2026-10-16T00:04:00.000Z');
assert.equal(gtRows5m.length, 3, 'JSON:API pool rows normalize to canonical pool addresses');
assert.equal(gtRows5m[0].targetContract, ethTarget, 'Ethereum eth_ network identity resolves contract address');
assert.equal(gtRows5m[0].baseTokenAddress, ethTarget);
assert.equal(gtRows5m[0].reserveInUsd, 1234.5);
assert.equal(gtRows5m[1].targetContract, null, 'both quote tokens do not infer a target');
assert.equal(gtRows5m[1].quoteClassification, 'BOTH_KNOWN_QUOTES');
assert.equal(gtRows5m[2].targetContract, null, 'neither quote token does not infer a target');
assert.equal(gtRows5m[2].quoteClassification, 'EXOTIC_PAIR');
assert.equal(normalizeGeckoTrending(gtPayload, 'base', '5m', observation.observedAt).length, 0,
  'Ethereum token IDs are not cross-assigned to Base');
const basePayload = { data: [{ id: `base_${pool.pool_address}`, attributes: { address: pool.pool_address }, relationships: {
  base_token: { data: { id: `base_${pool.target_contract}`, type: 'token' } },
  quote_token: { data: { id: 'base_0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', type: 'token' } } } }] };
assert.equal(normalizeGeckoTrending(basePayload, 'base', '1h', observation.observedAt)[0].targetContract, pool.target_contract,
  'Base network mapping resolves the Base target contract');
const gtRows1h = normalizeGeckoTrending({ data: [gtPayload.data[0]] }, 'ethereum', '1h', observation.observedAt);
upsertGeckoTrendingObservation(db, gtRows5m[0]);
upsertGeckoTrendingObservation(db, gtRows5m[0]);
upsertGeckoTrendingObservation(db, gtRows1h[0]);
assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM geckoterminal_trending_observations WHERE chain=? AND pool_address=?').get('ethereum', pool.pool_address).n), 2,
  'duration is part of the idempotent key');
upsertTrendingObservation(db, { observedAt: '2026-10-16T00:03:00.000Z', rank: 1, coinId: 'fixture-eth',
  symbol: 'FTR', chain: 'ethereum', contract: ethTarget });
recordGeckoFirstSeen(db, gtRows5m[0]);
recordGeckoFirstSeen(db, { ...gtRows5m[0], observedAt: '2026-10-16T00:06:00.000Z' });
seedFactoryCursor(db, 'ethereum', 500);
const ethPool = { ...pool, pool_address: '0x0000000000000000000000000000000000000021', target_contract: ethTarget,
  created_at: '2026-10-15T16:42:59.000Z' };
commitFactoryRange(db, { chain: 'ethereum', expectedFromBlock: 500, toBlock: 501, pools: [ethPool], now: '2026-10-16T00:05:00.000Z' });
assert.equal(db.prepare('SELECT first_gt_trending_5m_at AS at FROM tokens WHERE chain=? AND contract=?').get('base', pool.target_contract).at,
  null, 'a GeckoTerminal observation for another chain must not update this token');
const ethFirsts = db.prepare('SELECT first_cg_trending_at,first_gt_trending_5m_at,first_gt_trending_1h_at FROM tokens WHERE chain=? AND contract=?')
  .get('ethereum', ethTarget);
assert.equal(ethFirsts.first_cg_trending_at, '2026-10-16T00:03:00.000Z', 'pre-discovery CoinGecko evidence is reconciled on token discovery');
assert.equal(ethFirsts.first_gt_trending_5m_at, '2026-10-16T00:04:00.000Z', 'pre-discovery GT 5m evidence is reconciled on discovery');
assert.equal(ethFirsts.first_gt_trending_1h_at, observation.observedAt, '5m and 1h first-seen fields remain distinct');
const gtLead = summarizeBenchmark([{ first_detected_at: '2026-10-16T00:05:00.000Z', first_gt: '2026-10-16T00:04:00.000Z' }], 'first_gt', 5 * 60_000);
assert.ok(gtLead.min < 0, 'negative lead time is preserved when GT trends before ChainDetective detection');
assert.equal(gtLead.externalSourceEarlierCount, 1);

const legacy = new DatabaseSync(':memory:');
legacy.exec(`
  CREATE TABLE pilot_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
  CREATE TABLE factory_cursors(chain TEXT PRIMARY KEY,last_scanned_block INTEGER NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE factory_pools(chain TEXT NOT NULL,pool_address TEXT NOT NULL,factory TEXT NOT NULL,dex_family TEXT NOT NULL,
    token0 TEXT NOT NULL,token1 TEXT NOT NULL,created_block INTEGER NOT NULL,created_at TEXT NOT NULL,detected_at TEXT NOT NULL,
    target_contract TEXT,quote_contract TEXT,PRIMARY KEY(chain,pool_address));
  CREATE TABLE tokens(chain TEXT NOT NULL,contract TEXT NOT NULL,first_detected_at TEXT NOT NULL,oldest_pool_created_at TEXT NOT NULL,
    last_detected_at TEXT NOT NULL,dex_checked_at TEXT,dex_retry_after TEXT,dex_resolved INTEGER NOT NULL DEFAULT 0,
    classification TEXT NOT NULL DEFAULT 'UNKNOWN',primary_pool_address TEXT,primary_factory TEXT,primary_dex_family TEXT,pool_created_at TEXT,
    pair_json TEXT,pairs_json TEXT,quality_json TEXT,first_cg_trending_at TEXT,canonical_checked_at TEXT,PRIMARY KEY(chain,contract));
  CREATE TABLE token_observations(chain TEXT NOT NULL,contract TEXT NOT NULL,observed_at TEXT NOT NULL,primary_pool_address TEXT,
    classification TEXT,price_usd REAL,liquidity_usd REAL,market_cap_usd REAL,fdv_usd REAL,volume_h1_usd REAL,volume_h6_usd REAL,
    volume_h24_usd REAL,buys_h1 INTEGER,sells_h1 INTEGER,buys_h6 INTEGER,sells_h6 INTEGER,buys_h24 INTEGER,sells_h24 INTEGER,
    quality_json TEXT,vol_accel_ratio REAL,unique_buyers_250 INTEGER,unique_buyers_500 INTEGER,smart_wallet_overlap_250 INTEGER,
    smart_wallet_overlap_500 INTEGER,historical_hit_overlap_250 INTEGER,historical_hit_overlap_500 INTEGER,first_cg_trending_at TEXT,
    lead_time_hours REAL,PRIMARY KEY(chain,contract,observed_at));
  CREATE TABLE coingecko_trending_observations(observed_at TEXT NOT NULL,rank INTEGER NOT NULL,coin_id TEXT NOT NULL,symbol TEXT,
    chain TEXT,contract TEXT,PRIMARY KEY(observed_at,coin_id));
  CREATE TABLE pilot_errors(id INTEGER PRIMARY KEY AUTOINCREMENT,occurred_at TEXT NOT NULL,phase TEXT NOT NULL,chain TEXT,message TEXT NOT NULL);
`);
legacy.prepare('INSERT INTO pilot_meta(key,value) VALUES(?,?)').run('startedAt', '2026-10-16T17:12:39.000Z');
legacy.prepare('INSERT INTO pilot_meta(key,value) VALUES(?,?)').run('endsAt', '2026-10-30T17:12:39.000Z');
legacy.prepare('INSERT INTO pilot_meta(key,value) VALUES(?,?)').run('config', JSON.stringify({ durationDays: 14, factoryPollMs: 300000, coingeckoPollMs: 300000, dexRetryMs: 1800000, canonicalPollMs: 3600000 }));
legacy.prepare('INSERT INTO factory_cursors(chain,last_scanned_block,updated_at) VALUES(?,?,?)').run('ethereum', 123456, '2026-10-16T17:10:00.000Z');
legacy.prepare('INSERT INTO coingecko_trending_observations(observed_at,rank,coin_id,symbol,chain,contract) VALUES(?,?,?,?,?,?)')
  .run('2026-10-16T17:10:00.000Z', 1, 'fixture-coin', 'FIX', 'ethereum', ethTarget);
legacy.prepare('INSERT INTO token_observations(chain,contract,observed_at,classification,liquidity_usd) VALUES(?,?,?,?,?)')
  .run('ethereum', ethTarget, '2026-10-16T17:10:00.000Z', 'NEW_TOKEN_CANDIDATE', 12345);
const oldStartedAt = legacy.prepare("SELECT value FROM pilot_meta WHERE key='startedAt'").get().value;
const oldEndsAt = legacy.prepare("SELECT value FROM pilot_meta WHERE key='endsAt'").get().value;
createPilotSchema(legacy);
const migratedMeta = initializePilotMeta(legacy, { startedAt: '2099-01-01T00:00:00.000Z', endsAt: '2099-01-15T00:00:00.000Z', configJson: '{}' });
assert.equal(migratedMeta.startedAt, oldStartedAt);
assert.equal(migratedMeta.endsAt, oldEndsAt);
const migratedConfig = migratePilotMetaConfig(legacy, CONFIG_DEFAULTS);
assert.equal(migratedConfig.coingeckoPollMs, 3_600_000, 'legacy config migrates CoinGecko to hourly');
assert.equal(migratedConfig.geckoterminalPollMs, 300_000, 'legacy config adds 5m GeckoTerminal polling');
assert.equal(migratedConfig.dexRetryMs, 1_800_000, 'legacy non-CG intervals are preserved');
assert.equal(migratePilotConfig({ ...migratedConfig, coingeckoPollMs: 12345 }).coingeckoPollMs, 12345, 'current-version explicit overrides remain stable');
assert.equal(migratePilotConfig({ configVersion: 1, coingeckoPollMs: 300_000 }).coingeckoPollMs, 3_600_000,
  'config.json v1 migrates old CoinGecko cadence');
assert.throws(() => migratePilotConfig({ configVersion: 99 }), /Unsupported pilot config version/);
assert.equal(legacy.prepare('SELECT last_scanned_block AS n FROM factory_cursors WHERE chain=?').get('ethereum').n, 123456);
assert.equal(legacy.prepare('SELECT liquidity_usd AS n FROM token_observations').get().n, 12345);
assert.equal(Number(legacy.prepare('SELECT COUNT(*) AS n FROM coingecko_trending_observations').get().n), 1);
assert.ok(legacy.prepare('PRAGMA table_info(tokens)').all().some((row) => row.name === 'first_gt_trending_5m_at'));
assert.ok(legacy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='geckoterminal_trending_observations'").get());
legacy.close();

const dexPool = { ...pool, pool_address: '0x0000000000000000000000000000000000000011',
  target_contract: '0x0000000000000000000000000000000000000012',
  token0: '0x0000000000000000000000000000000000000013', token1: '0x0000000000000000000000000000000000000012',
  created_at: '2026-10-16T00:10:00.000Z', factory: '0x0000000000000000000000000000000000000014', dex_family: 'uniswap-v2' };
commitFactoryRange(db, { chain: 'base', expectedFromBlock: 120, toBlock: 121, pools: [dexPool], now: '2026-10-16T00:11:00.000Z' });
const dexPair = { chainId: 'base', pairAddress: dexPool.pool_address, dexId: 'uniswap',
  baseToken: { address: dexPool.target_contract, symbol: 'TEST', name: 'Test' },
  quoteToken: { address: dexPool.token0, symbol: 'WETH', name: 'Wrapped Ether' }, pairCreatedAt: Date.parse(dexPool.created_at),
  priceUsd: '2', liquidity: { usd: 30_000 }, marketCap: 100_000, fdv: 110_000,
  volume: { h1: 1_000, h6: 3_000, h24: 5_000 }, txns: { h1: { buys: 2, sells: 1 }, h6: { buys: 5, sells: 3 }, h24: { buys: 8, sells: 4 } } };
const dexToken = db.prepare('SELECT * FROM tokens WHERE chain=? AND contract=?').get('base', dexPool.target_contract);
saveDexToken(db, dexToken, [dexPair], [dexPool], '2026-10-16T00:30:00.000Z');
const enriched = db.prepare('SELECT * FROM tokens WHERE chain=? AND contract=?').get('base', dexPool.target_contract);
assert.equal(enriched.primary_factory, dexPool.factory);
assert.equal(enriched.primary_dex_family, dexPool.dex_family);
assert.equal(enriched.pool_created_at, dexPool.created_at);
const dexObservation = db.prepare('SELECT * FROM token_observations WHERE chain=? AND contract=?').get('base', dexPool.target_contract);
assert.equal(dexObservation.vol_accel_ratio, 2.5, 'Dex enrichment persists volume acceleration');
assert.equal(dexObservation.quality_json !== null, true, 'Dex enrichment persists quality-profile results');

async function resolveSynthetic(target, estimate, head, timestampAt, waitForNextHead = async (current) => current + 1) {
  return resolveFirstBlockAtOrAfter({ targetTimestamp: target, initialEstimate: estimate, headBlock: head,
    getBlockTimestamp: timestampAt, waitForNextHead });
}
assert.equal(unixSecondAtOrAfter(12_000), 12, 'exact second timestamps remain exact');
assert.equal(unixSecondAtOrAfter(12_001), 13, 'sub-second target rounds up to preserve at-or-after semantics');
assert.equal(await resolveSynthetic(120, 9, 30, (block) => block * 12), 10, 'exact timestamp hit resolves to its first block');
assert.equal(await resolveSynthetic(121, 9, 30, (block) => block * 12), 11, 'target between blocks resolves to the first later block');
assert.equal(await resolveSynthetic(1000, 1, 100, (block) => block * 12), 84, 'too-low initial estimate expands toward the target');
assert.equal(await resolveSynthetic(1000, 150, 150, (block) => block * 12), 84, 'too-high initial estimate expands backward toward the target');

const driftTimestamps = (block) => block < 150_000 ? block * 12 : (150_000 * 12) + ((block - 150_000) * 6);
const driftHead = 300_000;
const driftTarget = driftTimestamps(driftHead) - 14 * 86_400;
const driftEstimate = Math.round(driftHead - (driftTimestamps(driftHead) - driftTarget) / 6);
let legacyPadding = Math.max(200, Math.ceil((driftHead - driftEstimate) * 0.002));
let legacyBracketed = false;
for (let attempt = 0; attempt < 5; attempt += 1) {
  const from = Math.max(0, driftEstimate - legacyPadding); const to = Math.min(driftHead, driftEstimate + legacyPadding);
  legacyBracketed ||= driftTimestamps(from) <= driftTarget && driftTimestamps(to) >= driftTarget;
  legacyPadding *= 2;
}
assert.equal(legacyBracketed, false, 'large historical block-time drift defeats the old five local expansions');
assert.equal(await resolveSynthetic(driftTarget, driftEstimate, driftHead, driftTimestamps),
  Math.ceil(driftTarget / 12),
  'adaptive expansion and binary refinement resolve drift beyond the old five attempts');

for (const [chain, secondsPerBlock] of [['ethereum-like', 12], ['base-like', 2]]) {
  const snapshot = 2_000_000_000;
  const start = snapshot - 14 * 86_400;
  let head = Math.floor(snapshot / secondsPerBlock);
  const timestampAt = (block) => {
    if (block > head) throw new Error(`block ${block} is not available for ${chain}`);
    return block * secondsPerBlock;
  };
  const bounds = await resolveTimestampWindow(start, snapshot, {
    initialEstimate: (target) => Math.floor(target / secondsPerBlock), headBlock: head,
    getBlockTimestamp: timestampAt,
    waitForNextHead: async (current) => { head = Math.max(head, current + 1); return head; },
  });
  assert.ok(bounds.fromBlock <= bounds.toBlock, `${chain} 14-day window boundaries are ordered`);
  assert.ok(timestampAt(bounds.fromBlock - 1) < start && timestampAt(bounds.fromBlock) >= start,
    `${chain} 14-day start is the first block at-or-after its timestamp`);
  assert.ok(timestampAt(bounds.toBlock - 1) < snapshot && timestampAt(bounds.toBlock) >= snapshot,
    `${chain} 14-day end is the first block at-or-after its exclusive timestamp`);
}
await assert.rejects(resolveTimestampWindow(200, 100, {
  initialEstimate: 0, headBlock: 10, getBlockTimestamp: (block) => block, waitForNextHead: async (head) => head + 1,
}), /end precedes its start/, 'reversed timestamp windows are rejected');

db.close();
console.log('On-chain Discovery longitudinal worker fixtures passed (atomic cursor resume, idempotent events and observations, stable polling buckets).');
