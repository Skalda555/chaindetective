import '../server/load-env.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { isIgnoredWalletAddress } from '../dist/data.js';
import {
  CHAINS, FACTORY_TOPICS, QUALITY_PROFILES, accelerationDistribution, applyQualityProfile,
  confirmedBuyerMetrics, decodeFactoryLog, dedupePools, deterministicSample, maskAddress,
  normalizeDexPair, sensitivityCounts, uniqueTargets,
} from './onchain-discovery-core.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).filter((arg) => arg.startsWith('--')).map((arg) => {
  const [key, ...parts] = arg.slice(2).split('='); return [key, parts.join('=') || true];
}));
const DAYS = Number(args.days ?? 7);
const CANONICAL_LIMIT = Number(args['max-canonical-candidates'] ?? 250);
const DETECTION_AT = new Date().toISOString();
const DETECTION_MS = Date.parse(DETECTION_AT);
const WINDOW_START = DETECTION_MS - DAYS * 86_400_000;
const RUN_ID = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-');
const OUT_DIR = resolve(ROOT, 'tmp', `onchain-discovery-${RUN_ID}`);
const DEX_BASE = 'https://api.dexscreener.com';
const stats = { hypersyncRequests: 0, hypersyncQueryRequests: 0, hypersyncResponseBytes: 0, dexRequests: 0, dexResponseBytes: 0,
  dexRetries: 0, startedAt: Date.now(), memory: { peakRssBytes: 0, peakHeapUsedBytes: 0, peakExternalBytes: 0, peakArrayBuffersBytes: 0 } };
const dexPairCache = new Map();
const dexExactPairs = new Map();
let consoleCapture = [];

function memorySample() {
  const m = process.memoryUsage();
  for (const [key, value] of Object.entries({ peakRssBytes: m.rss, peakHeapUsedBytes: m.heapUsed, peakExternalBytes: m.external, peakArrayBuffersBytes: m.arrayBuffers })) {
    stats.memory[key] = Math.max(stats.memory[key], value);
  }
}
const pause = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function fetchJson(url, options = {}, metric = 'dex') {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(120_000) });
    const body = await response.text();
    if (metric === 'dex') { stats.dexRequests += 1; stats.dexResponseBytes += Buffer.byteLength(body); }
    else { stats.hypersyncRequests += 1; stats.hypersyncQueryRequests += url.endsWith('/query') ? 1 : 0; stats.hypersyncResponseBytes += Buffer.byteLength(body); }
    if (response.ok) {
      try { return { value: JSON.parse(body), response }; }
      catch { throw new Error(`Invalid JSON from ${new URL(url).host} (${response.status}).`); }
    }
    if ((response.status !== 429 && response.status < 500) || attempt === 5) {
      throw new Error(`${new URL(url).host} returned HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    if (metric === 'dex') stats.dexRetries += 1;
    const retry = Number(response.headers.get('retry-after')) * 1000 || Math.min(30_000, 2_000 * 2 ** attempt);
    await pause(retry);
  }
  throw new Error('Request retry limit reached.');
}

async function queryHyperSync(chain, query) {
  const { value } = await fetchJson(`${CHAINS[chain].hypersync}/query`, { method: 'POST',
    headers: { Authorization: `Bearer ${process.env.ENVIO_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(query) }, 'hyper');
  const batches = Array.isArray(value.data) ? value.data : [value.data ?? {}];
  const flatten = (key) => batches.flatMap((batch) => batch?.[key] ?? []);
  return { raw: value, logs: flatten('logs'), blocks: flatten('blocks') };
}

async function exactBlockBounds(chain) {
  const { value: heightBody } = await fetchJson(`${CHAINS[chain].hypersync}/height`, {
    headers: { Authorization: `Bearer ${process.env.ENVIO_API_TOKEN}` },
  }, 'hyper');
  const height = Number(heightBody.height);
  if (!Number.isSafeInteger(height)) throw new Error(`Invalid ${chain} HyperSync height.`);
  const recent = await queryHyperSync(chain, { from_block: Math.max(0, height - 2048), to_block: height,
    blocks: [{}], include_all_blocks: true, field_selection: { block: ['number', 'timestamp'] }, join_mode: 'JoinNothing', max_num_blocks: 4096 });
  const blocks = recent.blocks.map((b) => ({ number: Number(b.number ?? b.block_number), timestamp: Number(b.timestamp) }))
    .filter((b) => Number.isFinite(b.timestamp)).sort((a, b) => a.number - b.number);
  if (blocks.length < 2) throw new Error(`Insufficient ${chain} block timestamp samples.`);
  const blockSeconds = (blocks.at(-1).timestamp - blocks[0].timestamp) / (blocks.at(-1).number - blocks[0].number);
  const targetSeconds = Math.floor(WINDOW_START / 1000);
  const estimatedStart = Math.max(0, Math.floor(blocks.at(-1).number - (blocks.at(-1).timestamp - targetSeconds) / blockSeconds));
  let padding = 256; let boundaryBlocks;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const from = Math.max(0, estimatedStart - padding); const to = Math.min(height, estimatedStart + padding + 1);
    const boundary = await queryHyperSync(chain, { from_block: from, to_block: to, blocks: [{}], include_all_blocks: true,
      field_selection: { block: ['number', 'timestamp'] }, join_mode: 'JoinNothing', max_num_blocks: 50_000 });
    boundaryBlocks = boundary.blocks.map((block) => ({ number: Number(block.number ?? block.block_number), timestamp: Number(block.timestamp) }))
      .filter((block) => Number.isFinite(block.timestamp)).sort((a, b) => a.number - b.number);
    if (boundaryBlocks.length >= 2 && boundaryBlocks[0].timestamp <= targetSeconds && boundaryBlocks.at(-1).timestamp >= targetSeconds) break;
    if (attempt === 5) throw new Error(`Could not bracket exact ${chain} discovery window start.`);
    padding *= 2;
  }
  let low = 0; let high = boundaryBlocks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (boundaryBlocks[middle].timestamp >= targetSeconds) high = middle;
    else low = middle + 1;
  }
  const fromBlock = boundaryBlocks[low]?.number;
  if (!Number.isSafeInteger(fromBlock)) throw new Error(`Could not resolve ${chain} block at discovery window start.`);
  return { fromBlock, toBlock: height, height, avgBlockSeconds: blockSeconds, estimatedStartBlock: estimatedStart,
    startBlockTimestamp: boundaryBlocks[low].timestamp, startBoundaryExact: true };
}

async function scanFactoryEvents(chain) {
  const bounds = await exactBlockBounds(chain);
  console.log(`${chain}: estimated block window ${bounds.fromBlock}..${bounds.toBlock} (height ${bounds.height}, recent avg ${bounds.avgBlockSeconds.toFixed(3)} sec/block).`);
  const byFactory = CHAINS[chain].factories.map((item) => item.address);
  const topics = Object.values(FACTORY_TOPICS);
  const factoryAddresses = new Set(byFactory);
  const allEvents = [];
  let returnedLogs = 0; let matchedEventsInWindow = 0;
  let cursor = bounds.fromBlock;
  while (cursor < bounds.toBlock) {
    const result = await queryHyperSync(chain, {
      from_block: cursor, to_block: bounds.toBlock,
      logs: [{ address: byFactory, topics: [topics] }],
      field_selection: { log: ['address', 'topic0', 'topic1', 'topic2', 'topic3', 'data', 'block_number', 'log_index'] },
      join_mode: 'JoinNothing', max_num_blocks: 50_000,
    });
    const next = Number(result.raw.next_block);
    if (!Number.isSafeInteger(next) || next <= cursor) throw new Error(`HyperSync factory event pagination stopped at ${cursor} on ${chain}.`);
    returnedLogs += result.logs.length;
    const timestamps = new Map();
    for (const block of result.blocks) timestamps.set(Number(block.number ?? block.block_number), Number(block.timestamp));
    const missingBlocks = [...new Set(result.logs.map((log) => Number(log.block_number ?? log.blockNumber))
      .filter((number) => Number.isSafeInteger(number) && !timestamps.has(number)))];
    if (missingBlocks.length) {
      let blockCursor = Math.min(...missingBlocks); const maxBlock = Math.max(...missingBlocks);
      while (blockCursor <= maxBlock) {
        const headers = await queryHyperSync(chain, { from_block: blockCursor, to_block: maxBlock + 1, blocks: [{}], include_all_blocks: true,
          field_selection: { block: ['number', 'timestamp'] }, join_mode: 'JoinNothing', max_num_blocks: 50_000 });
        for (const block of headers.blocks) timestamps.set(Number(block.number ?? block.block_number), Number(block.timestamp));
        const nextHeader = Number(headers.raw.next_block);
        if (!Number.isSafeInteger(nextHeader) || nextHeader <= blockCursor) throw new Error(`HyperSync timestamp pagination stopped at ${blockCursor} on ${chain}.`);
        blockCursor = nextHeader;
      }
    }
    for (const log of result.logs) {
      if (!factoryAddresses.has(String(log.address ?? '').toLowerCase())) continue;
      const normalized = { ...log, block_number: Number(log.block_number ?? log.blockNumber),
        topics: log.topics ?? [log.topic0, log.topic1, log.topic2, log.topic3].filter(Boolean) };
      const decoded = decodeFactoryLog(normalized, chain, timestamps);
      if (decoded.event?.created_at && Date.parse(decoded.event.created_at) >= WINDOW_START && Date.parse(decoded.event.created_at) < DETECTION_MS) {
        allEvents.push(decoded.event); matchedEventsInWindow += 1;
      }
    }
    cursor = next;
    memorySample();
    if (returnedLogs && returnedLogs % 100_000 < result.logs.length) console.log(`${chain}: read ${returnedLogs.toLocaleString()} factory logs so far; retained ${allEvents.length.toLocaleString()} timestamped events.`);
  }
  return { bounds, totalLogs: matchedEventsInWindow, events: dedupePools(allEvents) };
}

async function enrichTokens(targets) {
  const grouped = new Map();
  for (const target of targets) {
    const list = grouped.get(target.chain) ?? [];
    list.push(target); grouped.set(target.chain, list);
  }
  for (const [chain, items] of grouped) {
    for (let i = 0; i < items.length; i += 30) {
      const chunk = items.slice(i, i + 30);
      await pause(260); // Official /tokens/v1 limit is 300 requests per minute.
      const { value, response } = await fetchJson(`${DEX_BASE}/tokens/v1/${chain}/${chunk.map((item) => item.contract).join(',')}`);
      const pairs = Array.isArray(value) ? value : Array.isArray(value?.pairs) ? value.pairs : [];
      const requested = new Set(chunk.map((item) => item.contract.toLowerCase()));
      for (const pair of pairs) {
        const address = String(pair.pairAddress ?? '').toLowerCase();
        if (!address) continue;
        dexPairCache.set(`${chain}:${address}`, pair);
        for (const tokenAddress of [pair.baseToken?.address, pair.quoteToken?.address].map((x) => String(x ?? '').toLowerCase())) {
          if (requested.has(tokenAddress)) {
            const key = `${chain}:${tokenAddress}`; const list = dexExactPairs.get(key) ?? [];
            list.push(pair); dexExactPairs.set(key, list);
          }
        }
      }
      stats.dexRateLimit = response.headers.get('x-ratelimit-limit') ?? response.headers.get('ratelimit-limit') ?? null;
      stats.dexRateRemaining = response.headers.get('x-ratelimit-remaining') ?? response.headers.get('ratelimit-remaining') ?? null;
      memorySample();
    }
  }
}

function pairBelongs(pair, chain, contract) {
  return pair.chainId === chain && [pair.baseToken?.address, pair.quoteToken?.address].some((item) => String(item ?? '').toLowerCase() === contract.toLowerCase());
}
function typeDexPair(pair, chain, detectedAt) { return normalizeDexPair(pair, chain, detectedAt); }
function summarizeDex(target, detectionAt) {
  const rows = (dexExactPairs.get(`${target.chain}:${target.contract}`) ?? []).filter((pair) => pairBelongs(pair, target.chain, target.contract));
  const unique = [...new Map(rows.map((pair) => [String(pair.pairAddress).toLowerCase(), pair])).values()];
  const oldest = unique.map((p) => Number(p.pairCreatedAt)).filter(Number.isFinite).sort((a, b) => a - b)[0] ?? null;
  const newPools = target.pools.map((pool) => {
    const match = unique.find((pair) => String(pair.pairAddress).toLowerCase() === pool.pool_address);
    return match ? { ...typeDexPair(match, target.chain, detectionAt), onchainCreatedAt: pool.created_at, dexFamily: pool.dex_family, quoteContract: pool.quote_contract } : null;
  }).filter(Boolean);
  const firstDetectedAt = target.firstDetectedAt;
  const earliestOnchain = Date.parse(firstDetectedAt);
  const hasEarlier = oldest !== null && oldest < earliestOnchain - 60_000;
  const classification = !unique.length ? 'UNKNOWN' : hasEarlier ? 'NEW_POOL_OLD_TOKEN' : newPools.length ? 'NEW_TOKEN_CANDIDATE' : 'UNKNOWN';
  return { chain: target.chain, contract: target.contract, firstDetectedAt, oldestRelevantPoolCreatedAt: oldest === null ? null : new Date(oldest).toISOString(),
    poolCount: unique.length, classification, newPools, dexPairs: unique };
}

function aggregateValues(rows, field) {
  const values = rows.map((item) => item[field]).filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return null;
  const at = (p) => values[Math.floor((values.length - 1) * p)];
  return { n: values.length, p50: at(0.5), p25: at(0.25), p75: at(0.75) };
}

function readLocalOverlap() {
  const dbPath = resolve(ROOT, '.data', 'chaindetective.sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    const smart = tables.has('smart_wallets') ? db.prepare("SELECT address,status FROM smart_wallets WHERE status IN ('candidate','reviewed')").all()
      .map((row) => String(row.address).toLowerCase()).filter((address) => !isIgnoredWalletAddress(address)) : [];
    const historical = tables.has('early_buyer_wallet_tokens') && tables.has('early_buyer_snapshots')
      ? db.prepare(`SELECT DISTINCT LOWER(w.wallet_address) AS wallet FROM early_buyer_wallet_tokens w
        JOIN early_buyer_snapshots s ON s.id=w.snapshot_id WHERE w.threshold_250=1 AND s.status IN ('complete','complete_with_warnings')`).all()
        .map((row) => row.wallet).filter((address) => !isIgnoredWalletAddress(address)) : [];
    const coverage = tables.has('early_buyer_tokens') && tables.has('early_buyer_snapshots')
      ? db.prepare(`SELECT s.captured_at AS capturedAt,s.status,t.chain,LOWER(t.contract_address) AS contract,t.symbol
        FROM early_buyer_tokens t JOIN early_buyer_snapshots s ON s.id=t.snapshot_id
        WHERE s.status IN ('complete','complete_with_warnings') AND t.chain IN ('ethereum','base') AND t.contract_address IS NOT NULL ORDER BY s.captured_at`).all() : [];
    const overview = tables.has('early_buyer_snapshots') ? db.prepare(`SELECT COUNT(*) AS snapshots,MIN(captured_at) AS firstAt,MAX(captured_at) AS lastAt,
        SUM(CASE WHEN status IN ('complete','complete_with_warnings') THEN 1 ELSE 0 END) AS complete
        FROM early_buyer_snapshots`).get() : null;
    return { smartWallets: new Set(smart), historicalHits: new Set(historical), coverageRows: coverage, overview };
  } finally { db.close(); }
}

function benchmark(targets, coverageRows) {
  const map = new Map();
  for (const row of coverageRows) {
    const key = `${row.chain}:${String(row.contract).toLowerCase()}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row.capturedAt);
  }
  return targets.map((target) => {
    const detectedAt = Date.parse(target.firstDetectedAt);
    const firstSeen = (map.get(`${target.chain}:${target.contract}`) ?? []).find((at) => Date.parse(at) >= detectedAt) ?? null;
    return { chain: target.chain, contract: target.contract, firstDetectedAt: target.firstDetectedAt,
      firstCoinGeckoTrendingAt: firstSeen, leadTimeHours: firstSeen ? (Date.parse(firstSeen) - detectedAt) / 3_600_000 : null };
  });
}

async function runCanonical(candidates, smartWallets, historicalHits) {
  if (!candidates.length || !process.env.ENVIO_API_TOKEN) return { metrics: new Map(), diagnostics: { skipped: candidates.length ? 'ENVIO_API_TOKEN missing' : 'No LOOSE candidates' } };
  const selected = [...candidates].sort((a, b) => (b.bestNewPool?.liquidityUsd ?? 0) - (a.bestNewPool?.liquidityUsd ?? 0))
    .slice(0, CANONICAL_LIMIT);
  const replayTokens = selected.map((candidate, index) => ({ id: `onchain-${candidate.chain}-${candidate.contract}`, name: candidate.symbol || candidate.contract,
    symbol: candidate.symbol || candidate.contract.slice(2, 8), chain: candidate.chain, contract: candidate.contract, rank: index + 1, marketCapRank: null,
    pools: candidate.newPools.slice(0, 3).map((pool) => ({ pairAddress: pool.pairAddress, decoder: pool.dexFamily })) }));
  const replay = { snapshotAt: DETECTION_AT, windowStart: new Date(Math.min(...selected.map((item) => Date.parse(item.firstDetectedAt)))).toISOString(),
    windowEndExclusive: DETECTION_AT, tokens: replayTokens };
  const replayPath = resolve(OUT_DIR, 'canonical-replay-input.json');
  await writeFile(replayPath, JSON.stringify(replay));
  const replayFlag = `--replay-artifact=${replayPath}`;
  process.argv.push(replayFlag);
  const engineUrl = `${pathToFileURL(resolve(ROOT, 'server', 'early-buyers-engine.mjs')).href}?onchain=${Date.now()}`;
  const originalFetch = globalThis.fetch;
  const originalLog = console.log; const originalError = console.error;
  const perPoolLookup = new Map();
  for (const candidate of selected) for (const pair of candidate.dexPairs) perPoolLookup.set(`${candidate.chain}:${String(pair.pairAddress).toLowerCase()}`, pair);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const match = url.match(/\/latest\/dex\/pairs\/([^/]+)\/([^/?]+)/i);
    if (match) {
      const pair = perPoolLookup.get(`${match[1]}:${match[2].toLowerCase()}`);
      if (pair) return new Response(JSON.stringify({ schemaVersion: '1.0.0', pair }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(input, init);
  };
  console.log = (...items) => { if (consoleCapture.length < 200) consoleCapture.push(items.map(String).join(' ').slice(0, 600)); };
  console.error = (...items) => { if (consoleCapture.length < 200) consoleCapture.push(items.map(String).join(' ').slice(0, 600)); };
  try {
    const { runEarlyBuyersScan } = await import(engineUrl);
    const snapshot = await runEarlyBuyersScan({ apiToken: process.env.ENVIO_API_TOKEN, captureOracle: true, writeArtifact: false, excludeTop100: false });
    const oracle = snapshot.oracleParityFixture ?? {};
    const txTimestamps = new Map();
    for (const [chain, group] of Object.entries(oracle.resolverInput ?? {})) for (const candidate of group.candidates ?? []) {
      if (candidate.block?.timestamp) txTimestamps.set(`${chain}:${String(candidate.txHash).toLowerCase()}`, Number(candidate.block.timestamp));
    }
    const metrics = confirmedBuyerMetrics({ outcomes: oracle.outcomes ?? [], txTimestamps, candidates: selected,
      smartWallets, historicalHits, days: DAYS });
    const outcomeCounts = { CONFIRMED: 0, UNCERTAIN: 0, REJECTED: 0 };
    for (const outcome of oracle.outcomes ?? []) if (outcomeCounts[outcome.verdict] !== undefined) outcomeCounts[outcome.verdict] += 1;
    const resolverMemory = snapshot.diagnostics?.memory;
    if (resolverMemory) {
      stats.memory.peakRssBytes = Math.max(stats.memory.peakRssBytes, resolverMemory.peakRssBytes ?? 0);
      stats.memory.peakHeapUsedBytes = Math.max(stats.memory.peakHeapUsedBytes, resolverMemory.peakHeapUsedBytes ?? 0);
      stats.memory.peakExternalBytes = Math.max(stats.memory.peakExternalBytes, resolverMemory.peakExternalBytes ?? 0);
      stats.memory.peakArrayBuffersBytes = Math.max(stats.memory.peakArrayBuffersBytes, resolverMemory.peakArrayBuffersBytes ?? 0);
    }
    return { metrics, diagnostics: { selectedCandidateCount: selected.length, skippedCandidateCount: candidates.length - selected.length,
      outcomeCounts, resolverQueries: snapshot.diagnostics?.hypersyncQueries ?? null, resolverResponseBytes: snapshot.diagnostics?.responseBytes ?? null,
      authVerified: snapshot.diagnostics?.authVerified ?? null, memory: resolverMemory ? {
        peakRssBytes: resolverMemory.peakRssBytes, peakHeapUsedBytes: resolverMemory.peakHeapUsedBytes,
        peakExternalBytes: resolverMemory.peakExternalBytes, peakArrayBuffersBytes: resolverMemory.peakArrayBuffersBytes,
      } : null } };
  } finally {
    globalThis.fetch = originalFetch; console.log = originalLog; console.error = originalError;
    process.argv = process.argv.filter((arg) => arg !== replayFlag);
  }
}

function csv(rows, columns) {
  const q = (value) => { const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value); return `"${text.replaceAll('"', '""')}"`; };
  return [columns.join(','), ...rows.map((row) => columns.map((key) => q(row[key])).join(','))].join('\n');
}

async function main() {
  if (![7, 14].includes(DAYS)) throw new Error('--days must be 7 or 14.');
  if (!Number.isInteger(CANONICAL_LIMIT) || CANONICAL_LIMIT < 1 || CANONICAL_LIMIT > 1000) throw new Error('--max-canonical-candidates must be 1..1000.');
  if (!process.env.ENVIO_API_TOKEN) throw new Error('ENVIO_API_TOKEN is required for the authenticated HyperSync PoC.');
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`On-chain discovery PoC | ${DAYS} day window | detection ${DETECTION_AT} | output ${OUT_DIR}`);
  console.log('Aerodrome Base: unsupported (factory/event decoder not independently verified for this experiment).');
  const factoryResults = {};
  const rawEvents = [];
  for (const chain of ['ethereum', 'base']) {
    factoryResults[chain] = await scanFactoryEvents(chain);
    rawEvents.push(...factoryResults[chain].events);
    console.log(`${chain}: ${factoryResults[chain].totalLogs} matching factory logs; ${factoryResults[chain].events.length} unique in-window pools.`);
  }
  const targets = uniqueTargets(rawEvents);
  const candidateByKey = new Map(targets.map((target) => [`${target.chain}:${target.contract}`, target]));
  const quoteTally = Object.fromEntries(['ethereum', 'base'].map((chain) => [chain, {
    matchingFactoryLogs: factoryResults[chain].totalLogs,
    uniquePools: factoryResults[chain].events.length,
    knownQuotePairs: factoryResults[chain].events.filter((pool) => pool.quote_classification === 'KNOWN_QUOTE').length,
    exoticPairs: factoryResults[chain].events.filter((pool) => pool.quote_classification === 'EXOTIC_PAIR').length,
    bothKnownQuotes: factoryResults[chain].events.filter((pool) => pool.quote_classification === 'BOTH_KNOWN_QUOTES').length,
    uniqueTargetTokens: new Set(targets.filter((target) => target.chain === chain).map((target) => target.contract)).size,
  }]));
  console.log(`Discovered ${targets.length} canonical chain+contract targets; fetching documented DEX Screener token batches.`);
  await enrichTokens(targets);
  let enriched = targets.map((target) => summarizeDex(target, DETECTION_MS));
  const dexResolved = enriched.filter((item) => item.dexPairs.length > 0);
  const looseCandidates = [];
  for (const token of dexResolved) {
    const candidate = { ...token, symbol: token.dexPairs[0]?.baseToken?.address?.toLowerCase() === token.contract ? token.dexPairs[0]?.baseToken?.symbol : token.dexPairs[0]?.quoteToken?.symbol,
      detectionAt: DETECTION_AT, newPools: token.newPools.map((pool) => ({ ...pool, poolAgeHours: pool.onchainCreatedAt ? Math.max(0, (DETECTION_MS - Date.parse(pool.onchainCreatedAt)) / 3_600_000) : pool.poolAgeHours })) };
    candidate.bestNewPool = [...candidate.newPools].sort((a, b) => (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1))[0] ?? null;
    candidate.qualityProfilePass = Object.fromEntries(Object.entries(QUALITY_PROFILES).map(([name, profile]) => [name, Boolean(applyQualityProfile(candidate, profile))]));
    if (candidate.qualityProfilePass.LOOSE) { candidate.bestNewPool = applyQualityProfile(candidate, QUALITY_PROFILES.LOOSE); looseCandidates.push(candidate); }
    Object.assign(token, candidate);
  }
  const local = readLocalOverlap();
  const canonical = await runCanonical(looseCandidates, local.smartWallets, local.historicalHits);
  for (const candidate of enriched) {
    candidate.canonicalBuyMetrics = canonical.metrics.get(`${candidate.chain}:${candidate.contract}`) ?? null;
    candidate.acceleration = accelerationDistribution(candidate.newPools);
  }
  const firstCoinGecko = benchmark(enriched, local.coverageRows);
  const matchedBench = new Map(firstCoinGecko.map((row) => [`${row.chain}:${row.contract}`, row]));
  for (const candidate of enriched) candidate.benchmark = matchedBench.get(`${candidate.chain}:${candidate.contract}`);

  const liquiditySurvivors = enriched.filter((item) => item.newPools.some((pool) => pool.liquidityUsd !== null && pool.liquidityUsd >= QUALITY_PROFILES.LOOSE.liquidityUsd[item.chain]));
  const ageSurvivors = liquiditySurvivors.filter((item) => item.newPools.some((pool) => pool.liquidityUsd !== null
    && pool.liquidityUsd >= QUALITY_PROFILES.LOOSE.liquidityUsd[item.chain] && pool.poolAgeHours !== null && pool.poolAgeHours <= QUALITY_PROFILES.LOOSE.poolAgeHours));
  const activitySurvivors = ageSurvivors.filter((item) => item.newPools.some((pool) => pool.liquidityUsd !== null
    && pool.liquidityUsd >= QUALITY_PROFILES.LOOSE.liquidityUsd[item.chain] && pool.poolAgeHours !== null && pool.poolAgeHours <= QUALITY_PROFILES.LOOSE.poolAgeHours
    && pool.sellsH6 !== null && pool.sellsH6 >= QUALITY_PROFILES.LOOSE.sellsH6 && pool.volumeH6Usd !== null && pool.volumeH6Usd >= QUALITY_PROFILES.LOOSE.volumeH6Usd));
  const stages = {
    discovered: targets.length,
    dexScreenerResolved: dexResolved.length,
    liquidityGate: liquiditySurvivors.length,
    ageGate: ageSurvivors.length,
    activityGate: activitySurvivors.length,
    acceleratingDiagnostic: activitySurvivors.filter((item) => item.newPools.some((pool) => Number.isFinite(pool.volAccelRatio) && pool.volAccelRatio > 1)).length,
    canonicalValidated: canonical.diagnostics?.selectedCandidateCount ?? 0,
  };
  const profileComparison = Object.entries(QUALITY_PROFILES).map(([name, profile]) => {
    const selected = enriched.filter((candidate) => candidate.qualityProfilePass?.[name]);
    const metrics = selected.map((item) => item.canonicalBuyMetrics?.confirmedBuys250?.uniqueConfirmedWallets ?? 0);
    const smart = selected.map((item) => item.canonicalBuyMetrics?.confirmedBuys250?.knownSmartWalletCount ?? 0);
    const buyers = selected.map((item) => item.canonicalBuyMetrics?.confirmedBuys250?.uniqueConfirmedWallets ?? 0);
    const pools = selected.map((item) => item.bestNewPool ?? item.newPools[0]).filter(Boolean);
    const trending = selected.map((item) => item.benchmark).filter((row) => row?.firstCoinGeckoTrendingAt && row.leadTimeHours >= 0);
    return { profile: name, candidateCount: selected.length, candidatesPerDay: selected.length / DAYS,
      validatedCandidateCount: selected.filter((item) => item.canonicalBuyMetrics).length,
      validatedPerDay: selected.filter((item) => item.canonicalBuyMetrics).length / DAYS,
      medianLiquidityUsd: aggregateValues(pools, 'liquidityUsd')?.p50 ?? null,
      medianFdvUsd: aggregateValues(pools, 'fdvUsd')?.p50 ?? null,
      medianVolumeH6Usd: aggregateValues(pools, 'volumeH6Usd')?.p50 ?? null,
      medianPoolAgeHours: aggregateValues(pools, 'poolAgeHours')?.p50 ?? null,
      medianConfirmedBuyers250: aggregateValues(buyers, 'value')?.p50 ?? (buyers.length ? buyers.sort((a, b) => a - b)[Math.floor((buyers.length - 1) / 2)] : null),
      smartWalletOverlapTokens: smart.filter((n) => n > 0).length,
      knownTrendingTokens: trending.length,
      detectedBeforeTrending: trending.length,
      recallPercent: null,
      medianLeadTimeHours: aggregateValues(trending.map((item) => ({ value: item.leadTimeHours })), 'value')?.p50 ?? null,
      p25LeadTimeHours: aggregateValues(trending.map((item) => ({ value: item.leadTimeHours })), 'value')?.p25 ?? null,
      p75LeadTimeHours: aggregateValues(trending.map((item) => ({ value: item.leadTimeHours })), 'value')?.p75 ?? null,
    };
  });
  const historicalTrending = new Set(local.coverageRows.filter((row) => Date.parse(row.capturedAt) >= WINDOW_START && Date.parse(row.capturedAt) <= DETECTION_MS)
    .map((row) => `${row.chain}:${String(row.contract).toLowerCase()}`));
  const detectedProfileKeys = Object.fromEntries(Object.keys(QUALITY_PROFILES).map((name) => [name,
    new Set(enriched.filter((candidate) => candidate.qualityProfilePass?.[name] && candidate.benchmark?.leadTimeHours >= 0)
      .map((candidate) => `${candidate.chain}:${candidate.contract}`))]));
  for (const row of profileComparison) {
    const caught = [...historicalTrending].filter((key) => detectedProfileKeys[row.profile].has(key)).length;
    row.knownTrendingTokens = historicalTrending.size;
    row.detectedBeforeTrending = caught;
    row.recallPercent = historicalTrending.size ? 100 * caught / historicalTrending.size : null;
  }
  const acceleration = accelerationDistribution(enriched.flatMap((item) => item.newPools));
  const noiseSample = Object.fromEntries(Object.keys(QUALITY_PROFILES).map((name) => [name, deterministicSample(enriched.filter((candidate) => candidate.qualityProfilePass?.[name]), 20).map((candidate) => ({
    chain: candidate.chain, contract: maskAddress(candidate.contract), symbol: candidate.symbol, classification: candidate.classification,
    survivedLiquidity: candidate.newPools.some((pool) => pool.liquidityUsd >= QUALITY_PROFILES[name].liquidityUsd[candidate.chain]),
    stillTrading: candidate.newPools.some((pool) => pool.buysH6 > 0 && pool.sellsH6 > 0),
    bidirectionalActivity: candidate.newPools.some((pool) => pool.bidirectionalActivity),
    confirmedBuyers250: candidate.canonicalBuyMetrics?.confirmedBuys250?.uniqueConfirmedWallets ?? null,
    smartWalletOverlap: candidate.canonicalBuyMetrics?.confirmedBuys250?.knownSmartWalletCount ?? null,
    laterCoinGeckoTrending: candidate.benchmark?.leadTimeHours >= 0,
  }))]));
  const snapshotDates = [...new Set(local.coverageRows.map((row) => row.capturedAt))].map(Date.parse).filter(Number.isFinite).sort((a, b) => a - b);
  const benchmarkGaps = snapshotDates.slice(1).map((date, index) => (date - snapshotDates[index]) / 3_600_000);
  const benchmarkCoverage = { historicalSnapshotRows: local.coverageRows.length, snapshotOverview: local.overview,
    uniqueSnapshotTimes: snapshotDates.length, observedSpanHours: snapshotDates.length > 1 ? (snapshotDates.at(-1) - snapshotDates[0]) / 3_600_000 : 0,
    maxGapHours: benchmarkGaps.length ? Math.max(...benchmarkGaps) : null,
    knownTrendingTokensInWindow: historicalTrending.size,
    limitation: 'Persisted Early Buyers CoinGecko snapshots are periodic observations of current trending lists, not a complete historical feed; times are first observed only.' };
  const report = { schemaVersion: 1, runId: RUN_ID, detectionAt: DETECTION_AT, window: { days: DAYS, start: new Date(WINDOW_START).toISOString(), endExclusive: DETECTION_AT },
    chainCoverage: quoteTally, factoryCoverage: { supported: CHAINS, unsupported: { aerodromeBase: 'Factory and event semantics were not independently verified for this PoC.' }, blockBounds: Object.fromEntries(Object.entries(factoryResults).map(([chain, result]) => [chain, result.bounds])) },
    rawUniverse: { discoveredTargets: targets.length, uniqueFactoryPools: rawEvents.length, sensitivity: sensitivityCounts(enriched), quoteClassificationCounts: quoteTally },
    dexScreener: { resolvedTargets: dexResolved.length, targetsWithExactNewPool: enriched.filter((item) => item.newPools.length).length,
      responseRequests: stats.dexRequests, responseBytes: stats.dexResponseBytes, retries: stats.dexRetries, rateLimit: stats.dexRateLimit, rateRemaining: stats.dexRateRemaining,
      classificationCounts: Object.fromEntries(['NEW_TOKEN_CANDIDATE', 'NEW_POOL_OLD_TOKEN', 'UNKNOWN'].map((name) => [name, enriched.filter((item) => item.classification === name).length])) },
    funnel: Object.fromEntries(Object.entries(stages).map(([stage, count]) => [stage, { count, percentOfDiscovered: targets.length ? 100 * count / targets.length : null }])),
    profiles: profileComparison, acceleration: { formula: 'h1 / max((h6 - h1) / 5, $1)', ...acceleration,
      candidatePriceChangeH1: aggregateValues(enriched.flatMap((item) => item.newPools), 'priceChangeH1'), candidatePriceChangeH6: aggregateValues(enriched.flatMap((item) => item.newPools), 'priceChangeH6'),
      buySellCountRatioH6: aggregateValues(enriched.flatMap((item) => item.newPools), 'buySellCountRatioH6'), rawBuyCountsAreQualityEvidence: false },
    canonicalBuyers: { resolver: 'server/early-buyers-engine.mjs runEarlyBuyersScan(captureOracle:true)', limits: canonical.diagnostics,
      buyerMetricsAvailableFor: canonical.metrics.size, buyWindow: `max(poolCreatedAt, detectionAt - ${DAYS}d) <= txTimestamp < detectionAt`,
      confirmedBuy250Count: [...canonical.metrics.values()].reduce((sum, row) => sum + row.confirmedBuys250.confirmedBuys, 0),
      confirmedBuy500Count: [...canonical.metrics.values()].reduce((sum, row) => sum + row.confirmedBuys500.confirmedBuys, 0),
      uniqueConfirmedWallets250AcrossCandidateTokens: [...canonical.metrics.values()].reduce((sum, row) => sum + row.confirmedBuys250.uniqueConfirmedWallets, 0),
      note: 'Smart-wallet and historical-hit matches require canonical CONFIRMED outcomes; UNCERTAIN/REJECTED outcomes are excluded.' },
    overlaps: { activeSmartWallets: local.smartWallets.size, historicalHitWallets: local.historicalHits.size,
      tokensWithSmartOverlap250: [...canonical.metrics.values()].filter((row) => row.confirmedBuys250.knownSmartWalletCount > 0).length,
      tokensWithHistoricalHitOverlap250: [...canonical.metrics.values()].filter((row) => row.confirmedBuys250.historicalHitWalletCount > 0).length },
    coingeckoBenchmark: benchmarkCoverage, noiseSample, performance: { hypersyncRequests: stats.hypersyncRequests, hypersyncQueryRequests: stats.hypersyncQueryRequests,
      hypersyncResponseBytes: stats.hypersyncResponseBytes, dexScreenerRequests: stats.dexRequests, dexScreenerResponseBytes: stats.dexResponseBytes,
      runtimeMs: Date.now() - stats.startedAt, memory: stats.memory },
    correctness: { productionSqliteWrites: false, historicalHitSemanticsChanged: false, newBuyerResolverAdded: false, bidirectionalActivityIsNotHoneypotVerdict: true,
      supportedDexFamilies: ['Uniswap V2', 'Uniswap V3'], canonicalBuyWindowUsesMax: true } };
  const safeCandidates = enriched;
  await Promise.all([
    writeFile(resolve(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2)),
    writeFile(resolve(OUT_DIR, 'factory-pools.csv'), csv(rawEvents,
      ['chain', 'factory', 'dex_family', 'pool_address', 'token0', 'token1', 'created_block', 'created_at', 'quote_classification', 'target_contract', 'quote_contract'])),
    writeFile(resolve(OUT_DIR, 'candidates.json'), JSON.stringify(safeCandidates, null, 2)),
    writeFile(resolve(OUT_DIR, 'candidates.csv'), csv(safeCandidates.map((item) => ({ chain: item.chain, contract: item.contract, symbol: item.symbol,
      firstDetectedAt: item.firstDetectedAt, oldestRelevantPoolCreatedAt: item.oldestRelevantPoolCreatedAt, poolCount: item.poolCount, classification: item.classification,
      loose: item.qualityProfilePass?.LOOSE, balanced: item.qualityProfilePass?.BALANCED, strict: item.qualityProfilePass?.STRICT,
      liquidityUsd: item.bestNewPool?.liquidityUsd, fdvUsd: item.bestNewPool?.fdvUsd, volumeH6Usd: item.bestNewPool?.volumeH6Usd,
      poolAgeHours: item.bestNewPool?.poolAgeHours, volAccelRatio: item.bestNewPool?.volAccelRatio,
      confirmedBuys250: item.canonicalBuyMetrics?.confirmedBuys250?.confirmedBuys, confirmedBuys500: item.canonicalBuyMetrics?.confirmedBuys500?.confirmedBuys,
      smartWalletCount: item.canonicalBuyMetrics?.confirmedBuys250?.knownSmartWalletCount, historicalHitCount: item.canonicalBuyMetrics?.confirmedBuys250?.historicalHitWalletCount,
      firstCoinGeckoTrendingAt: item.benchmark?.firstCoinGeckoTrendingAt, leadTimeHours: item.benchmark?.leadTimeHours })),
      ['chain', 'contract', 'symbol', 'firstDetectedAt', 'oldestRelevantPoolCreatedAt', 'poolCount', 'classification', 'loose', 'balanced', 'strict', 'liquidityUsd', 'fdvUsd', 'volumeH6Usd', 'poolAgeHours', 'volAccelRatio', 'confirmedBuys250', 'confirmedBuys500', 'smartWalletCount', 'historicalHitCount', 'firstCoinGeckoTrendingAt', 'leadTimeHours'])),
    writeFile(resolve(OUT_DIR, 'noise-sample.json'), JSON.stringify(noiseSample, null, 2)),
  ]);
  console.log(`Run complete. Report: ${resolve(OUT_DIR, 'report.json')}`);
  console.log(`Universe ${targets.length}; DEX resolved ${dexResolved.length}; LOOSE candidates ${looseCandidates.length}; resolver validated ${canonical.diagnostics?.selectedCandidateCount ?? 0}.`);
}

main().catch((error) => { console.error(`On-chain discovery PoC failed: ${error.stack ?? error.message}`); process.exitCode = 1; });
