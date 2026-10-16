import { createHash } from 'node:crypto';
import { decodeEventLog, parseAbiItem, toEventSelector } from 'viem';

export const CHAINS = Object.freeze({
  ethereum: {
    label: 'Ethereum',
    hypersync: 'https://eth.hypersync.xyz',
    factories: [
      { address: '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f', family: 'uniswap-v2' },
      { address: '0x1f98431c8ad98523631ae4a59f267346ea31f984', family: 'uniswap-v3' },
    ],
    quotes: {
      weth: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      usdt: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    },
  },
  base: {
    label: 'Base',
    hypersync: 'https://base.hypersync.xyz',
    factories: [
      { address: '0x8909dc15e40173ff4699343b6eb8132c65e18ec6', family: 'uniswap-v2' },
      { address: '0x33128a8fc17869897dce68ed026d694621f6fdfd', family: 'uniswap-v3' },
    ],
    quotes: {
      weth: '0x4200000000000000000000000000000000000006',
      usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      usdbc: '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca',
    },
  },
});

export const FACTORY_ABIS = Object.freeze({
  'uniswap-v2': parseAbiItem('event PairCreated(address indexed token0, address indexed token1, address pair, uint256)'),
  'uniswap-v3': parseAbiItem('event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)'),
});
export const FACTORY_TOPICS = Object.freeze(Object.fromEntries(Object.entries(FACTORY_ABIS)
  .map(([family, abi]) => [family, toEventSelector(abi).toLowerCase()])));

export const QUALITY_PROFILES = Object.freeze({
  LOOSE: Object.freeze({ liquidityUsd: { base: 10_000, ethereum: 20_000 }, poolAgeHours: 24, fdvCeilingUsd: null, sellsH6: 1, volumeH6Usd: 5_000 }),
  BALANCED: Object.freeze({ liquidityUsd: { base: 20_000, ethereum: 35_000 }, poolAgeHours: 12, fdvCeilingUsd: 100_000_000, sellsH6: 1, volumeH6Usd: 10_000 }),
  STRICT: Object.freeze({ liquidityUsd: { base: 30_000, ethereum: 50_000 }, poolAgeHours: 3, fdvCeilingUsd: 20_000_000, sellsH6: 5, volumeH6Usd: 25_000 }),
});

const ADDRESS_RE = /^0x[\da-f]{40}$/i;
const lower = (value) => String(value ?? '').toLowerCase();
const finiteNumber = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

function topicsOf(log) {
  if (Array.isArray(log.topics)) return log.topics;
  return [log.topic0, log.topic1, log.topic2, log.topic3].filter((value) => value !== null && value !== undefined);
}

export function decodeFactoryLog(log, chain, blockTimestamps = new Map()) {
  const config = CHAINS[chain];
  if (!config) return { event: null, error: 'unsupported_chain' };
  const factory = lower(log.address);
  const source = config.factories.find((item) => item.address === factory);
  if (!source) return { event: null, error: 'unknown_factory' };
  const topics = topicsOf(log).map(lower);
  if (topics[0] !== FACTORY_TOPICS[source.family]) return { event: null, error: 'unknown_event_signature' };
  try {
    const decoded = decodeEventLog({ abi: [FACTORY_ABIS[source.family]], data: log.data, topics, strict: true });
    const args = decoded.args;
    const poolAddress = lower(source.family === 'uniswap-v2' ? (args.pair ?? args[2]) : (args.pool ?? args[4]));
    const token0 = lower(args.token0 ?? args[0]);
    const token1 = lower(args.token1 ?? args[1]);
    if (![poolAddress, token0, token1].every((value) => ADDRESS_RE.test(value)) || token0 === token1) {
      return { event: null, error: 'invalid_factory_event_addresses' };
    }
    const createdBlock = Number(log.block_number ?? log.blockNumber);
    if (!Number.isSafeInteger(createdBlock) || createdBlock < 0) return { event: null, error: 'invalid_block_number' };
    const rawTimestamp = blockTimestamps.get(createdBlock) ?? blockTimestamps.get(String(createdBlock)) ?? log.timestamp ?? null;
    const timestampSeconds = finiteNumber(rawTimestamp);
    return { event: {
      chain,
      factory,
      dex_family: source.family,
      pool_address: poolAddress,
      token0,
      token1,
      created_block: createdBlock,
      created_at: timestampSeconds === null ? null : new Date(timestampSeconds * 1000).toISOString(),
      log_index: finiteNumber(log.log_index ?? log.logIndex),
    }, error: null };
  } catch {
    return { event: null, error: 'factory_event_decode_failed' };
  }
}

export function dedupePools(events) {
  const unique = new Map();
  for (const event of events) {
    if (!event || !CHAINS[event.chain] || !ADDRESS_RE.test(lower(event.pool_address))) continue;
    const key = `${event.chain}:${lower(event.pool_address)}`;
    const previous = unique.get(key);
    if (!previous || event.created_block < previous.created_block
      || (event.created_block === previous.created_block && Number(event.log_index ?? 0) < Number(previous.log_index ?? 0))) {
      unique.set(key, { ...event, pool_address: lower(event.pool_address), token0: lower(event.token0), token1: lower(event.token1) });
    }
  }
  return [...unique.values()].sort((a, b) => a.chain.localeCompare(b.chain) || a.created_block - b.created_block || a.pool_address.localeCompare(b.pool_address));
}

export function classifyQuotePair(chain, token0, token1) {
  const quotes = CHAINS[chain]?.quotes;
  if (!quotes) return { classification: 'UNSUPPORTED_CHAIN', targetContract: null, quoteContract: null };
  const known = new Set(Object.values(quotes).map(lower));
  const a = lower(token0); const b = lower(token1);
  if (!ADDRESS_RE.test(a) || !ADDRESS_RE.test(b)) return { classification: 'INVALID_ADDRESS', targetContract: null, quoteContract: null };
  const aKnown = known.has(a); const bKnown = known.has(b);
  if (aKnown && bKnown) return { classification: 'BOTH_KNOWN_QUOTES', targetContract: null, quoteContract: null };
  if (!aKnown && !bKnown) return { classification: 'EXOTIC_PAIR', targetContract: null, quoteContract: null };
  return { classification: 'KNOWN_QUOTE', targetContract: aKnown ? b : a, quoteContract: aKnown ? a : b };
}

export function uniqueTargets(pools) {
  const targets = new Map();
  for (const pool of pools) {
    const quote = classifyQuotePair(pool.chain, pool.token0, pool.token1);
    pool.quote_classification = quote.classification;
    if (quote.classification !== 'KNOWN_QUOTE') continue;
    pool.target_contract = quote.targetContract;
    pool.quote_contract = quote.quoteContract;
    const key = `${pool.chain}:${quote.targetContract}`;
    const target = targets.get(key) ?? { chain: pool.chain, contract: quote.targetContract, firstDetectedAt: pool.created_at, pools: [] };
    if (!target.firstDetectedAt || (pool.created_at && pool.created_at < target.firstDetectedAt)) target.firstDetectedAt = pool.created_at;
    target.pools.push(pool);
    targets.set(key, target);
  }
  return [...targets.values()].sort((a, b) => a.chain.localeCompare(b.chain) || a.contract.localeCompare(b.contract));
}

export function normalizeDexPair(pair, chain, detectionAtMs) {
  const h1 = finiteNumber(pair?.volume?.h1);
  const h6 = finiteNumber(pair?.volume?.h6);
  const buysH1 = finiteNumber(pair?.txns?.h1?.buys);
  const sellsH1 = finiteNumber(pair?.txns?.h1?.sells);
  const buysH6 = finiteNumber(pair?.txns?.h6?.buys);
  const sellsH6 = finiteNumber(pair?.txns?.h6?.sells);
  const buysH24 = finiteNumber(pair?.txns?.h24?.buys);
  const sellsH24 = finiteNumber(pair?.txns?.h24?.sells);
  const liquidityUsd = finiteNumber(pair?.liquidity?.usd);
  const poolCreatedAtMs = finiteNumber(pair?.pairCreatedAt);
  const poolAgeHours = poolCreatedAtMs === null ? null : Math.max(0, (detectionAtMs - poolCreatedAtMs) / 3_600_000);
  const acceleration = volumeAcceleration(h1, h6);
  return {
    chain,
    dexId: String(pair?.dexId ?? ''),
    pairAddress: lower(pair?.pairAddress),
    baseToken: pair?.baseToken ?? null,
    quoteToken: pair?.quoteToken ?? null,
    pairCreatedAt: poolCreatedAtMs === null ? null : new Date(poolCreatedAtMs).toISOString(),
    pairCreatedAtMs: poolCreatedAtMs,
    liquidityUsd,
    volumeH1Usd: h1,
    volumeH6Usd: h6,
    volumeH24Usd: finiteNumber(pair?.volume?.h24),
    buysH1,
    sellsH1,
    buysH6,
    sellsH6,
    buysH24,
    sellsH24,
    priceChangeH1: finiteNumber(pair?.priceChange?.h1),
    priceChangeH6: finiteNumber(pair?.priceChange?.h6),
    fdvUsd: finiteNumber(pair?.fdv),
    marketCapUsd: finiteNumber(pair?.marketCap),
    priceUsd: finiteNumber(pair?.priceUsd),
    poolAgeHours,
    volAccelRatio: acceleration,
    buySellCountRatioH6: buysH6 === null || sellsH6 === null ? null : buysH6 / Math.max(sellsH6, 1),
    bidirectionalActivity: Boolean(buysH6 > 0 && sellsH6 > 0),
  };
}

export function volumeAcceleration(volumeH1, volumeH6, floorUsd = 1) {
  const h1 = finiteNumber(volumeH1); const h6 = finiteNumber(volumeH6);
  if (h1 === null || h6 === null) return null;
  return h1 / Math.max((h6 - h1) / 5, floorUsd);
}

export function passesQualityProfile(pair, profile, chain) {
  const liquidityThreshold = profile.liquidityUsd?.[chain];
  if (pair.liquidityUsd === null || liquidityThreshold === undefined || pair.liquidityUsd < liquidityThreshold) return false;
  if (pair.poolAgeHours === null || pair.poolAgeHours > profile.poolAgeHours) return false;
  if (profile.fdvCeilingUsd !== null && (pair.fdvUsd === null || pair.fdvUsd > profile.fdvCeilingUsd)) return false;
  if (pair.sellsH6 === null || pair.sellsH6 < profile.sellsH6) return false;
  if (pair.volumeH6Usd === null || pair.volumeH6Usd < profile.volumeH6Usd) return false;
  return true;
}

export function applyQualityProfile(candidate, profile) {
  const qualified = candidate.newPools.filter((pool) => passesQualityProfile(pool, profile, candidate.chain));
  if (!qualified.length) return null;
  return [...qualified].sort((a, b) => (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1)
    || (b.volumeH6Usd ?? -1) - (a.volumeH6Usd ?? -1))[0];
}

export function effectiveBuyWindow(poolCreatedAt, detectionAt, days = 7) {
  const poolMs = typeof poolCreatedAt === 'number' ? poolCreatedAt : Date.parse(poolCreatedAt);
  const detectedMs = typeof detectionAt === 'number' ? detectionAt : Date.parse(detectionAt);
  if (!Number.isFinite(poolMs) || !Number.isFinite(detectedMs) || !Number.isFinite(days) || days <= 0) throw new Error('Invalid buyer window input.');
  const startMs = Math.max(poolMs, detectedMs - days * 86_400_000);
  return { start: new Date(startMs).toISOString(), endExclusive: new Date(detectedMs).toISOString() };
}

export function quantile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lowerIndex = Math.floor(position); const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sorted[lowerIndex];
  const fraction = position - lowerIndex;
  return sorted[lowerIndex] * (1 - fraction) + sorted[upperIndex] * fraction;
}

export function accelerationDistribution(pairs) {
  const values = pairs.map((item) => item.volAccelRatio).filter((value) => Number.isFinite(value));
  return { n: values.length, p50: quantile(values, 0.5), p75: quantile(values, 0.75), p90: quantile(values, 0.9), p95: quantile(values, 0.95) };
}

export function deterministicSample(items, limit = 20) {
  return [...items].sort((a, b) => createHash('sha256').update(`${a.chain}:${a.contract}`).digest('hex')
    .localeCompare(createHash('sha256').update(`${b.chain}:${b.contract}`).digest('hex'))).slice(0, limit);
}

export function maskAddress(address) {
  const normalized = lower(address);
  return ADDRESS_RE.test(normalized) ? `${normalized.slice(0, 8)}…${normalized.slice(-6)}` : null;
}

export function confirmedBuyerMetrics({ outcomes, txTimestamps, candidates, smartWallets, historicalHits, days = 7 }) {
  const candidateMap = new Map(candidates.map((item) => [`${item.chain}:${lower(item.contract)}`, item]));
  const byToken = new Map([...candidateMap.keys()].map((key) => [key, []]));
  for (const outcome of outcomes ?? []) {
    if (outcome.verdict !== 'CONFIRMED') continue;
    const chain = String(outcome.chain ?? ''); const contract = lower(outcome.tokenContract);
    const key = `${chain}:${contract}`; const candidate = candidateMap.get(key);
    if (!candidate) continue;
    const txHash = lower(outcome.txHash);
    const timestamp = txTimestamps.get(`${chain}:${txHash}`);
    const timestampMs = typeof timestamp === 'number' ? timestamp * 1000 : Date.parse(timestamp);
    const { start, endExclusive } = effectiveBuyWindow(candidate.firstDetectedAt, candidate.detectionAt, days);
    if (!Number.isFinite(timestampMs) || timestampMs < Date.parse(start) || timestampMs >= Date.parse(endExclusive)) continue;
    byToken.get(key).push({ ...outcome, buyerWallet: lower(outcome.buyerWallet), timestamp: new Date(timestampMs).toISOString() });
  }
  const result = new Map();
  for (const [key, candidate] of candidateMap) {
    const trades = byToken.get(key);
    const thresholdResult = (threshold) => {
      const qualified = trades.filter((trade) => Number(trade.amountUsd) >= threshold);
      const wallets = new Set(qualified.map((trade) => trade.buyerWallet));
      const smart = [...wallets].filter((wallet) => smartWallets.has(wallet));
      const historical = [...wallets].filter((wallet) => historicalHits.has(wallet));
      return {
        confirmedBuys: qualified.length,
        uniqueConfirmedWallets: wallets.size,
        knownSmartWalletCount: smart.length,
        historicalHitWalletCount: historical.length,
        smartWalletAddresses: smart.map(maskAddress),
        historicalHitAddresses: historical.map(maskAddress),
      };
    };
    result.set(key, { chain: candidate.chain, contract: lower(candidate.contract),
      confirmedBuys250: thresholdResult(250), confirmedBuys500: thresholdResult(500),
      confirmedBuysAll: thresholdResult(0), effectiveWindow: effectiveBuyWindow(candidate.firstDetectedAt, candidate.detectionAt, days) });
  }
  return result;
}

export function sensitivityCounts(candidates) {
  return {
    liquidity: Object.fromEntries(Object.entries({ base: [10_000, 20_000, 30_000], ethereum: [20_000, 35_000, 50_000] })
      .map(([chain, thresholds]) => [chain, Object.fromEntries(thresholds.map((threshold) => [threshold,
        candidates.filter((item) => item.chain === chain && item.bestNewPool?.liquidityUsd >= threshold).length]))])),
    poolAgeHours: Object.fromEntries([0, 3, 6, 12, 24].map((hours) => [hours,
      candidates.filter((item) => item.newPools.some((pool) => pool.poolAgeHours !== null && pool.poolAgeHours <= hours)).length])),
    fdvCeilingUsd: Object.fromEntries([null, 100_000_000, 50_000_000, 20_000_000].map((ceiling) => [ceiling ?? 'none',
      candidates.filter((item) => item.newPools.some((pool) => ceiling === null || (pool.fdvUsd !== null && pool.fdvUsd <= ceiling))).length])),
    sellsH6: Object.fromEntries([1, 5].map((threshold) => [threshold,
      candidates.filter((item) => item.newPools.some((pool) => pool.sellsH6 !== null && pool.sellsH6 >= threshold)).length])),
    volumeH6Usd: Object.fromEntries([5_000, 10_000, 25_000].map((threshold) => [threshold,
      candidates.filter((item) => item.newPools.some((pool) => pool.volumeH6Usd !== null && pool.volumeH6Usd >= threshold)).length])),
  };
}
