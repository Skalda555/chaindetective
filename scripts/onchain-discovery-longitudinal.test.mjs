import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  commitFactoryRange, createPilotSchema, floorTimeBucket, initializePilotMeta, seedFactoryCursor,
  upsertTokenObservation, upsertTrendingObservation,
} from './onchain-discovery-longitudinal-store.mjs';

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
commitFactoryRange(db, { chain: 'base', expectedFromBlock: 100, toBlock: 120, pools: [pool] });
assert.equal(Number(db.prepare('SELECT last_scanned_block AS n FROM factory_cursors WHERE chain=?').get('base').n), 120);
commitFactoryRange(db, { chain: 'base', expectedFromBlock: 120, toBlock: 120, pools: [pool] });
assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM factory_pools').get().n), 1, 'replayed factory logs are idempotent');

const observation = { chain: 'base', contract: pool.target_contract, observedAt: '2026-10-16T00:30:00.000Z',
  primaryPoolAddress: pool.pool_address, classification: 'NEW_TOKEN_CANDIDATE', liquidityUsd: 15_000, qualityJson: '{"LOOSE":true}' };
upsertTokenObservation(db, observation);
upsertTokenObservation(db, { ...observation, liquidityUsd: 20_000 });
assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM token_observations').get().n), 1, 'same observation bucket upserts once');
assert.equal(Number(db.prepare('SELECT liquidity_usd AS n FROM token_observations').get().n), 20_000);
upsertTrendingObservation(db, { observedAt: observation.observedAt, rank: 1, coinId: 'test-coin', symbol: 'TST', chain: 'base', contract: pool.target_contract });
upsertTrendingObservation(db, { observedAt: observation.observedAt, rank: 2, coinId: 'test-coin', symbol: 'TST', chain: 'base', contract: pool.target_contract });
assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM coingecko_trending_observations').get().n), 1, 'same CoinGecko time bucket upserts once');
assert.equal(floorTimeBucket(Date.parse('2026-10-16T00:07:42.000Z'), 5 * 60_000), '2026-10-16T00:05:00.000Z');

db.close();
console.log('On-chain Discovery longitudinal worker fixtures passed (atomic cursor resume, idempotent events and observations, stable polling buckets).');
