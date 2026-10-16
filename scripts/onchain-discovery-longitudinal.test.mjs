import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  commitFactoryRange, createPilotSchema, floorTimeBucket, initializePilotMeta, seedFactoryCursor,
  upsertTokenObservation, upsertTrendingObservation,
} from './onchain-discovery-longitudinal-store.mjs';
import { saveDexToken } from './onchain-discovery-longitudinal.mjs';

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

db.close();
console.log('On-chain Discovery longitudinal worker fixtures passed (atomic cursor resume, idempotent events and observations, stable polling buckets).');
