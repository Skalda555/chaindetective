import '../server/load-env.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { confirmedBuyerMetrics } from '../scripts/onchain-discovery-core.mjs';

if (!process.env.ENVIO_API_TOKEN) throw new Error('ENVIO_API_TOKEN is missing.');
const runDir = 'tmp/onchain-discovery-2026-10-16T160211-275Z';
const report = JSON.parse(await readFile(`${runDir}/report.json`, 'utf8'));
const candidates = JSON.parse(await readFile(`${runDir}/candidates.json`, 'utf8'));
const replay = JSON.parse(await readFile(`${runDir}/canonical-replay-input.json`, 'utf8'));
const selected = candidates.filter((x) => x.qualityProfilePass?.LOOSE);
const pairByKey = new Map();
for (const token of selected) for (const pair of token.dexPairs) pairByKey.set(`${token.chain}:${String(pair.pairAddress).toLowerCase()}`, pair);
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input); const match = url.match(/\/latest\/dex\/pairs\/([^/]+)\/([^/?]+)/i);
  if (match) {
    const pair = pairByKey.get(`${match[1]}:${match[2].toLowerCase()}`);
    if (pair) return new Response(JSON.stringify({ schemaVersion: '1.0.0', pair }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return originalFetch(input, init);
};
process.argv.push(`--replay-artifact=${runDir}/canonical-replay-input.json`);
let result;
try {
  const { runEarlyBuyersScan } = await import(`../server/early-buyers-engine.mjs?canonicalAudit=${Date.now()}`);
  result = await runEarlyBuyersScan({ apiToken: process.env.ENVIO_API_TOKEN, captureOracle: true, writeArtifact: false, excludeTop100: false });
} finally { globalThis.fetch = originalFetch; }
const oracle = result.oracleParityFixture;
const timestamps = new Map();
for (const [chain, group] of Object.entries(oracle.resolverInput ?? {})) for (const candidate of group.candidates ?? []) {
  if (candidate.block?.timestamp) timestamps.set(`${chain}:${String(candidate.txHash).toLowerCase()}`, Number(candidate.block.timestamp));
}
const metricRows = confirmedBuyerMetrics({ outcomes: oracle.outcomes, txTimestamps: timestamps,
  candidates: selected.map((x) => ({ ...x, detectionAt: report.detectionAt })), smartWallets: new Set(), historicalHits: new Set(), days: 7 });
const summary = selected.map((candidate) => {
  const key = `${candidate.chain}:${candidate.contract.toLowerCase()}`; const metrics = metricRows.get(key);
  const outcomes = oracle.outcomes.filter((item) => item.chain === candidate.chain && item.tokenContract?.toLowerCase() === candidate.contract.toLowerCase());
  const counts = { CONFIRMED: 0, UNCERTAIN: 0, REJECTED: 0 };
  for (const item of outcomes) if (counts[item.verdict] !== undefined) counts[item.verdict] += 1;
  const timestampsMs = outcomes.filter((item) => item.verdict === 'CONFIRMED').map((item) => timestamps.get(`${candidate.chain}:${item.txHash.toLowerCase()}`) * 1000).filter(Number.isFinite);
  const lowerBound = Math.max(Date.parse(candidate.firstDetectedAt), Date.parse(report.detectionAt) - 7 * 86_400_000);
  const outOfWindowConfirmed = timestampsMs.filter((time) => time < lowerBound || time >= Date.parse(report.detectionAt)).length;
  return { chain: candidate.chain, contract: candidate.contract, symbol: candidate.symbol, pool: candidate.bestNewPool?.pairAddress,
    outcomes: counts, confirmedBuy250: metrics.confirmedBuys250.confirmedBuys, uniqueWallets250: metrics.confirmedBuys250.uniqueConfirmedWallets,
    confirmedBuy500: metrics.confirmedBuys500.confirmedBuys, uniqueWallets500: metrics.confirmedBuys500.uniqueConfirmedWallets,
    outOfWindowConfirmed, selectedPools: candidate.newPools.map((pool) => pool.pairAddress) };
});
const expected = new Map(candidates.filter((x) => x.qualityProfilePass?.LOOSE).map((x) => [`${x.chain}:${x.contract.toLowerCase()}`, x]));
for (const row of summary) {
  const original = expected.get(`${row.chain}:${row.contract.toLowerCase()}`);
  assert.equal(row.confirmedBuy250, original.canonicalBuyMetrics.confirmedBuys250.confirmedBuys, `${row.contract} buy count parity`);
  assert.equal(row.uniqueWallets250, original.canonicalBuyMetrics.confirmedBuys250.uniqueConfirmedWallets, `${row.contract} unique wallet parity`);
  assert.equal(row.confirmedBuy500, original.canonicalBuyMetrics.confirmedBuys500.confirmedBuys, `${row.contract} $500 buy count parity`);
  assert.equal(row.uniqueWallets500, original.canonicalBuyMetrics.confirmedBuys500.uniqueConfirmedWallets, `${row.contract} $500 wallet parity`);
  assert.equal(row.outOfWindowConfirmed, 0, `${row.contract} has no confirmed buys outside intended window`);
}
const totals = summary.reduce((acc, row) => {
  for (const [verdict, count] of Object.entries(row.outcomes)) acc.outcomes[verdict] += count;
  acc.confirmedBuy250 += row.confirmedBuy250; acc.confirmedBuy500 += row.confirmedBuy500;
  acc.uniqueWallets250 += row.uniqueWallets250; acc.uniqueWallets500 += row.uniqueWallets500;
  acc.multiPoolTokens += row.selectedPools.length > 1 ? 1 : 0; return acc;
}, { outcomes: { CONFIRMED: 0, UNCERTAIN: 0, REJECTED: 0 }, confirmedBuy250: 0, confirmedBuy500: 0, uniqueWallets250: 0, uniqueWallets500: 0, multiPoolTokens: 0 });
const output = { sourceRun: report.runId, auditedAt: new Date().toISOString(), window: report.window,
  queryDiagnostics: { queries: result.diagnostics.hypersyncQueries, responseBytes: result.diagnostics.responseBytes, memory: result.diagnostics.memory },
  totals, tokens: summary };
await writeFile('tmp/onchain-discovery-canonical-audit.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
