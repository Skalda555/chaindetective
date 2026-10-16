import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics } from 'viem';
import {
  CHAINS, FACTORY_ABIS, applyQualityProfile, classifyQuotePair, confirmedBuyerMetrics,
  decodeFactoryLog, dedupePools, effectiveBuyWindow, normalizeDexPair, passesQualityProfile,
  QUALITY_PROFILES, uniqueTargets, volumeAcceleration,
} from './onchain-discovery-core.mjs';

const a = (digit) => `0x${digit.repeat(40)}`;
const v2 = CHAINS.ethereum.factories.find((item) => item.family === 'uniswap-v2').address;
const v3 = CHAINS.base.factories.find((item) => item.family === 'uniswap-v3').address;
const token = a('1'); const pair = a('2'); const quote = CHAINS.ethereum.quotes.usdc;
const v2Topics = encodeEventTopics({ abi: [FACTORY_ABIS['uniswap-v2']], eventName: 'PairCreated', args: { token0: quote, token1: token } });
const v2Log = { address: v2, topics: v2Topics, data: encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [pair, 1n]), block_number: 100, log_index: 2 };
const decoded = decodeFactoryLog(v2Log, 'ethereum', new Map([[100, 1_800_000_000]]));
assert.equal(decoded.error, null);
assert.equal(decoded.event.dex_family, 'uniswap-v2');
assert.equal(decoded.event.pool_address, pair);
assert.equal(decoded.event.created_at, '2027-01-15T08:00:00.000Z');
assert.equal(decodeFactoryLog({ ...v2Log, address: a('3') }, 'ethereum').error, 'unknown_factory');

const v3Topics = encodeEventTopics({ abi: [FACTORY_ABIS['uniswap-v3']], eventName: 'PoolCreated', args: { token0: a('4'), token1: CHAINS.base.quotes.usdc, fee: 3000 } });
const v3Log = { address: v3, topics: v3Topics, data: encodeAbiParameters([{ type: 'int24' }, { type: 'address' }], [60, a('5')]), block_number: 101, log_index: 0 };
assert.equal(decodeFactoryLog(v3Log, 'base').event.dex_family, 'uniswap-v3');

assert.deepEqual(classifyQuotePair('ethereum', quote, token), { classification: 'KNOWN_QUOTE', targetContract: token, quoteContract: quote });
assert.equal(classifyQuotePair('ethereum', quote, CHAINS.ethereum.quotes.usdt).classification, 'BOTH_KNOWN_QUOTES');
assert.equal(classifyQuotePair('base', a('6'), a('7')).classification, 'EXOTIC_PAIR');
assert.equal(uniqueTargets([{ ...decoded.event }, { ...decoded.event, pool_address: a('8') }]).length, 1);
assert.equal(dedupePools([{ ...decoded.event, chain: 'ethereum' }, { ...decoded.event, chain: 'base' }]).length, 2);

const window = effectiveBuyWindow('2026-10-15T10:00:00.000Z', '2026-10-16T10:00:00.000Z', 7);
assert.deepEqual(window, { start: '2026-10-15T10:00:00.000Z', endExclusive: '2026-10-16T10:00:00.000Z' });
assert.equal(effectiveBuyWindow('2026-10-01T00:00:00.000Z', '2026-10-16T00:00:00.000Z', 7).start, '2026-10-09T00:00:00.000Z');

assert.equal(volumeAcceleration(120, 620), 1.2);
assert.equal(volumeAcceleration(20, 20), 20);
const basePool = normalizeDexPair({ pairAddress: pair, liquidity: { usd: 25_000 }, pairCreatedAt: Date.parse('2026-10-16T09:00:00Z'), volume: { h1: 12_000, h6: 32_000 }, txns: { h6: { buys: 8, sells: 3 } }, fdv: 5_000_000 }, 'base', Date.parse('2026-10-16T10:00:00Z'));
assert.equal(basePool.poolAgeHours, 1);
assert.equal(basePool.bidirectionalActivity, true);
assert.equal(passesQualityProfile(basePool, QUALITY_PROFILES.BALANCED, 'base'), true);
assert.equal(applyQualityProfile({ chain: 'base', newPools: [basePool] }, QUALITY_PROFILES.STRICT), null);

const smart = a('9'); const historical = a('a'); const txHash = `0x${'b'.repeat(64)}`;
const outcomes = [
  { chain: 'ethereum', txHash, tokenContract: token, verdict: 'CONFIRMED', buyerWallet: smart, amountUsd: 300 },
  { chain: 'ethereum', txHash: `0x${'c'.repeat(64)}`, tokenContract: token, verdict: 'UNCERTAIN', buyerWallet: historical, amountUsd: 900 },
];
const metrics = confirmedBuyerMetrics({ outcomes, txTimestamps: new Map([[`ethereum:${txHash}`, '2026-10-15T12:00:00.000Z']]),
  candidates: [{ chain: 'ethereum', contract: token, firstDetectedAt: '2026-10-15T00:00:00.000Z', detectionAt: '2026-10-16T00:00:00.000Z' }],
  smartWallets: new Set([smart]), historicalHits: new Set([historical]) }).get(`ethereum:${token}`);
assert.equal(metrics.confirmedBuys250.confirmedBuys, 1);
assert.equal(metrics.confirmedBuys500.confirmedBuys, 0);
assert.equal(metrics.confirmedBuys250.knownSmartWalletCount, 1);
assert.equal(metrics.confirmedBuys250.historicalHitWalletCount, 0);

const duplicateCanonicalRecords = confirmedBuyerMetrics({ outcomes: [outcomes[0], { ...outcomes[0], poolAddress: a('c') }],
  txTimestamps: new Map([[`ethereum:${txHash}`, '2026-10-15T12:00:00.000Z']]),
  candidates: [{ chain: 'ethereum', contract: token, firstDetectedAt: '2026-10-15T00:00:00.000Z', detectionAt: '2026-10-16T00:00:00.000Z' }],
  smartWallets: new Set([smart]), historicalHits: new Set(), days: 7 }).get(`ethereum:${token}`);
assert.equal(duplicateCanonicalRecords.confirmedBuys250.confirmedBuys, 2, 'both canonical records remain buy records');
assert.equal(duplicateCanonicalRecords.confirmedBuys250.uniqueConfirmedWallets, 1, 'same chain/token/wallet counts once across duplicate tx records');
assert.equal(duplicateCanonicalRecords.confirmedBuys250.knownSmartWalletCount, 1, 'overlap also remains wallet-deduplicated');

console.log('On-chain discovery PoC unit fixtures passed (factory decoding, quote and identity rules, MAX window, profiles, acceleration, CONFIRMED overlap, duplicate-record wallet dedupe).');
