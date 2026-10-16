import assert from 'node:assert/strict';
import { aggregateSnapshots } from './trending-early-buyers-longitudinal.mjs';

const wallet = '0x1111111111111111111111111111111111111111';
const tokenA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const tokenB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const snapshots = [
  { snapshotAt: '2026-10-10T00:00:00Z', walletTokenCombinations: [
    { wallet, token: 'AAA', chain: 'ethereum', contract: tokenA, threshold250: true, threshold500: true, leadTimeHours: 20, totalUsdBought: 900,
      threshold250Stats: { leadTimeHours: 80, totalUsdBought: 600 }, threshold500Stats: { leadTimeHours: 80, totalUsdBought: 600 } },
    { wallet, token: 'BBB', chain: 'ethereum', contract: tokenB, threshold250: true, threshold500: false, leadTimeHours: 12, totalUsdBought: 400,
      threshold250Stats: { leadTimeHours: 40, totalUsdBought: 300 }, threshold500Stats: null },
  ] },
  { snapshotAt: '2026-10-11T00:00:00Z', walletTokenCombinations: [
    { wallet, token: 'AAA', chain: 'ethereum', contract: tokenA, threshold250: true, threshold500: true, leadTimeHours: 25, totalUsdBought: 1_000,
      threshold250Stats: { leadTimeHours: 90, totalUsdBought: 700 }, threshold500Stats: { leadTimeHours: 90, totalUsdBought: 700 } },
    { wallet, token: 'AAA', chain: 'base', contract: tokenA, threshold250: true, threshold500: false, leadTimeHours: 18, totalUsdBought: 500,
      threshold250Stats: { leadTimeHours: 50, totalUsdBought: 350 }, threshold500Stats: null },
  ] },
];

const result250 = aggregateSnapshots(snapshots, { threshold: 250 });
assert.equal(result250.length, 1);
assert.equal(result250[0].uniqueTrendingTokensHit, 3, 'same address on different chains is a distinct canonical token');
assert.equal(result250[0].snapshotsHit, 2);
assert.equal(result250[0].avgLeadTimeHours, 60, 'repeated Ethereum AAA contributes once, using the maximum observed lead time');
assert.equal(result250[0].totalUsdBought, 1_350, 'repeated appearances do not sum the same canonical token again');

const result500 = aggregateSnapshots(snapshots, { threshold: 500 });
assert.equal(result500[0].uniqueTrendingTokensHit, 1);
assert.equal(result500[0].snapshotsHit, 2);

console.log('Trending Early Buyers longitudinal snapshot fixtures passed (thresholds, chain+contract identity, repeat-token dedupe).');
