import '../server/load-env.mjs';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseAbiItem, toEventSelector } from 'viem';
import { runEarlyBuyersScan } from '../server/early-buyers-engine.mjs';
import { swapEventFor } from './trending-early-buyers-decode.mjs';

const chain = process.argv.includes('--ethereum') ? 'ethereum' : 'base';
if (!process.env.ENVIO_API_TOKEN) throw new Error('ENVIO_API_TOKEN is missing.');
console.log(`ENVIO_API_TOKEN present: true; parity chain=${chain}.`);
const common = { apiToken: process.env.ENVIO_API_TOKEN, validate: false, writeArtifact: false, excludeTop100: true, captureOracle: true };

// Discover the candidate set once. Both retrieval modes receive this frozen chain+hash+block map.
const frozen = await runEarlyBuyersScan({ ...common, retrievalMode: 'freeze-only' });
const candidateFreeze = frozen.oracleFreeze;
const bounds = frozen.bounds;
const old = await runEarlyBuyersScan({ ...common, retrievalMode: 'legacy', candidateFreeze, blockBoundsOverride: bounds });
const fresh = await runEarlyBuyersScan({ ...common, retrievalMode: 'optimized', candidateFreeze, blockBoundsOverride: bounds });
const oldFixture = old.oracleParityFixture; const newFixture = fresh.oracleParityFixture;
assert.deepEqual(newFixture.candidateFreeze, candidateFreeze);
assert.deepEqual(oldFixture.candidateFreeze, candidateFreeze);

const poolRecords = oldFixture.pools;
const poolAddresses = new Set(poolRecords.map((pool) => pool.poolAddress.toLowerCase()));
const tokenAddresses = new Set(poolRecords.map((pool) => pool.tokenContract.toLowerCase()));
const liquidityTopics = new Set([
  'event Mint(address indexed sender, uint256 amount0, uint256 amount1)',
  'event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)',
  'event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
  'event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
].map((abi) => toEventSelector(parseAbiItem(abi)).toLowerCase()));
const poolResolverTopics = new Map(poolRecords.map((pool) => {
  const event = swapEventFor(pool.decoder);
  return [pool.poolAddress.toLowerCase(), new Set([event && toEventSelector(event.abi).toLowerCase(), ...liquidityTopics].filter(Boolean))];
}));
const quoteByAddress = new Map();
for (const pool of poolRecords) {
  const list = quoteByAddress.get(pool.quoteTokenContract) ?? [];
  list.push(pool.poolAddress.toLowerCase()); quoteByAddress.set(pool.quoteTokenContract, list);
}
const transferTopic = oldFixture.resolverInput[chain]?.candidates.flatMap((item) => item.logs).find((log) =>
  String(log.topics?.[0] ?? '').toLowerCase() === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef')?.topics?.[0]?.toLowerCase()
  ?? '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
function relevant(log) {
  const address = String(log.address ?? '').toLowerCase();
  const topic0 = String(log.topics?.[0] ?? '').toLowerCase();
  if (poolAddresses.has(address)) return poolResolverTopics.get(address)?.has(topic0) === true;
  if (topic0 !== transferTopic) return false;
  if (tokenAddresses.has(address)) return true; // all target-token flows
  const pools = quoteByAddress.get(address) ?? [];
  const from = `0x${String(log.topics?.[1] ?? '').slice(-40).toLowerCase()}`;
  const to = `0x${String(log.topics?.[2] ?? '').slice(-40).toLowerCase()}`;
  return pools.some((pool) => from === pool || to === pool);
}
const identity = (log) => `${chain}:${Number(log.blockNumber ?? log.block_number)}:${Number(log.logIndex ?? log.log_index)}`;
function contexts(fixture) {
  const result = new Map();
  for (const candidate of fixture.resolverInput[chain]?.candidates ?? []) {
    const logs = candidate.logs.filter(relevant);
    result.set(candidate.txHash.toLowerCase(), {
      blockNumber: candidate.blockNumber,
      transaction: candidate.transaction && { hash: candidate.transaction.hash, from: candidate.transaction.from, to: candidate.transaction.to,
        blockNumber: candidate.transaction.blockNumber, status: candidate.transaction.status, type: candidate.transaction.type },
      block: candidate.block && { number: candidate.block.number, hash: candidate.block.hash, timestamp: candidate.block.timestamp },
      logs: new Map(logs.map((log) => [identity(log), { address: log.address.toLowerCase(), topics: log.topics.map((topic) => topic.toLowerCase()), data: log.data.toLowerCase() }])),
    });
  }
  return result;
}
const oldContexts = contexts(oldFixture); const newContexts = contexts(newFixture);
const candidateHashes = Object.keys(candidateFreeze[chain] ?? {}).sort();
const contextDiffs = [];
for (const txHash of candidateHashes) {
  const before = oldContexts.get(txHash); const after = newContexts.get(txHash);
  const oldIds = new Set(before?.logs.keys() ?? []); const newIds = new Set(after?.logs.keys() ?? []);
  const missingInNew = [...oldIds].filter((id) => !newIds.has(id));
  const extraInNew = [...newIds].filter((id) => !oldIds.has(id));
  const contentMismatches = [...oldIds].filter((id) => newIds.has(id) && JSON.stringify(before.logs.get(id)) !== JSON.stringify(after.logs.get(id)));
  const metadataMismatch = JSON.stringify({ tx: before?.transaction, block: before?.block }) !== JSON.stringify({ tx: after?.transaction, block: after?.block });
  if (missingInNew.length || extraInNew.length || contentMismatches.length || metadataMismatch) contextDiffs.push({ txHash,
    missingInNew, extraInNew, contentMismatches, metadataMismatch });
}

const outcomeKey = (item) => [item.chain, item.txHash?.toLowerCase(), item.tokenContract?.toLowerCase(), item.poolAddress?.toLowerCase()].join(':');
const outcomeMap = (fixture) => {
  const groups = new Map();
  for (const item of fixture.outcomes) {
    const key = outcomeKey(item); const list = groups.get(key) ?? []; list.push(item); groups.set(key, list);
  }
  return new Map([...groups].flatMap(([key, items]) => items.map((item, index) => [`${key}:${index}`, item])));
};
const oldOutcomes = outcomeMap(oldFixture); const newOutcomes = outcomeMap(newFixture);
const outcomeDiffs = [];
for (const key of new Set([...oldOutcomes.keys(), ...newOutcomes.keys()])) {
  const before = oldOutcomes.get(key); const after = newOutcomes.get(key);
  const fields = ['verdict', 'reasonCode', 'buyerWallet', 'tokenAmount', 'quoteAmountRaw', 'amountUsd', 'quoteTokenContract', 'priceMethod'];
  const changed = fields.filter((field) => JSON.stringify(before?.[field] ?? null) !== JSON.stringify(after?.[field] ?? null));
  if (changed.length) outcomeDiffs.push({ key, changed, old: before ?? null, new: after ?? null });
}
const byReason = (fixture) => Object.fromEntries(Object.entries(fixture.outcomes.reduce((acc, item) => {
  const type = item.reasonCode ?? item.verdict;
  acc[type] = (acc[type] ?? 0) + 1; return acc;
}, {})).sort((a, b) => a[0].localeCompare(b[0])));
const report = {
  chain, window: { snapshotAt: frozen.snapshotAt, windowStart: frozen.windowStart, windowEnd: frozen.windowEnd, bounds },
  tokens: poolRecords.map(({ tokenSymbol, tokenContract, poolAddress, quoteTokenContract, decoder }) => ({ tokenSymbol, tokenContract, poolAddress, quoteTokenContract, decoder })),
  candidateCount: candidateHashes.length, exactCandidateSet: true,
  context: { exactContextMatch: contextDiffs.length === 0, comparisonScope: 'exact logs consumed by resolver (supported pool swap/liquidity topics and target/quote ERC-20 transfers)', contextMismatches: contextDiffs.length,
    missingInNew: contextDiffs.reduce((n, item) => n + item.missingInNew.length, 0), extraInNew: contextDiffs.reduce((n, item) => n + item.extraInNew.length, 0), diffs: contextDiffs.slice(0, 50) },
  resolver: { oldOutcomeCount: oldFixture.outcomes.length, newOutcomeCount: newFixture.outcomes.length,
    verdictMatches: oldFixture.outcomes.length - outcomeDiffs.length, verdictMismatches: outcomeDiffs.length,
    walletMismatches: outcomeDiffs.filter((item) => item.changed.includes('buyerWallet')).length,
    reasonMismatches: outcomeDiffs.filter((item) => item.changed.includes('reasonCode')).length,
    amountMismatches: outcomeDiffs.filter((item) => item.changed.some((field) => ['tokenAmount', 'quoteAmountRaw', 'amountUsd'].includes(field))).length,
    byReason: { old: byReason(oldFixture), new: byReason(newFixture) }, diffs: outcomeDiffs.slice(0, 50) },
  performance: { legacy: { queries: old.diagnostics.hypersyncQueries, pages: old.diagnostics.responsePages,
      fullRangeTransferLogs: old.diagnostics.legacyRangeTransferLogs, responseBytes: old.diagnostics.responseBytes, totalMs: old.timing.totalMs,
      transferMs: old.timing.transferQueryMs }, optimized: { queries: fresh.diagnostics.hypersyncQueries, pages: fresh.diagnostics.responsePages,
      candidateContextLogs: fresh.diagnostics.candidateContextLogs, relevantTransferLogs: fresh.diagnostics.transferLogsFetched,
      responseBytes: fresh.diagnostics.responseBytes, totalMs: fresh.timing.totalMs, transferMs: fresh.timing.transferQueryMs } },
  memory: { old: old.diagnostics.memory, optimized: fresh.diagnostics.memory },
};
const fixture = { schemaVersion: 1, source: 'same frozen candidate set; legacy and optimized retrieval; canonical resolver inputs and outputs',
  chain, window: report.window, tokens: report.tokens, candidates: candidateHashes.map((txHash) => ({ txHash, blockNumber: candidateFreeze[chain][txHash],
    old: oldContexts.get(txHash) ? { ...oldContexts.get(txHash), logs: Object.fromEntries(oldContexts.get(txHash).logs) } : null,
    new: newContexts.get(txHash) ? { ...newContexts.get(txHash), logs: Object.fromEntries(newContexts.get(txHash).logs) } : null,
    candidateTokens: poolRecords.filter((pool) => pool.chain === chain && (oldContexts.get(txHash)?.logs.values() ?? []).some((log) =>
      log.address === pool.tokenContract.toLowerCase() && log.topics[0] === transferTopic
      && `0x${log.topics[1].slice(-40)}` === pool.poolAddress.toLowerCase())).map((pool) => ({ tokenContract: pool.tokenContract,
        poolAddress: pool.poolAddress, targetOutRaw: [...(oldContexts.get(txHash)?.logs.values() ?? [])]
          .filter((log) => log.address === pool.tokenContract.toLowerCase() && log.topics[0] === transferTopic
            && `0x${log.topics[1].slice(-40)}` === pool.poolAddress.toLowerCase())
          .reduce((sum, log) => sum + BigInt(log.data), 0n).toString() })),
    outcomes: { old: oldFixture.outcomes.filter((item) => item.txHash?.toLowerCase() === txHash.toLowerCase()),
      new: newFixture.outcomes.filter((item) => item.txHash?.toLowerCase() === txHash.toLowerCase()) },
  })) };
const outDir = join(process.cwd(), 'tmp'); await mkdir(outDir, { recursive: true });
const outPath = join(outDir, `early-buyers-${chain}-oracle-golden.json.gz`);
await writeFile(outPath, gzipSync(Buffer.from(JSON.stringify(fixture))));
const reportPath = join(outDir, `early-buyers-${chain}-oracle-report.json`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Golden candidate fixture saved: ${basename(outPath)} (${(Buffer.byteLength(JSON.stringify(fixture)) / 1024 / 1024).toFixed(1)} MiB uncompressed); report ${basename(reportPath)}.`);
console.log(JSON.stringify(report, null, 2));
if (contextDiffs.length || outcomeDiffs.length) process.exitCode = 1;
