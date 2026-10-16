import '../server/load-env.mjs';
import { decodeEventLog, formatUnits, parseAbiItem, toEventSelector } from 'viem';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeSwap, inferTargetSideFromOutput, quoteInputRaw, resolvePositiveTokenRecipients, sumBlockscoutTransfers, swapEventFor } from './trending-early-buyers-decode.mjs';

const CG = 'https://api.coingecko.com/api/v3';
const DEX = 'https://api.dexscreener.com';
const REPLAY_PATH = process.argv.find((arg) => arg.startsWith('--replay-artifact='))?.split('=').slice(1).join('=');
const REPLAY_DATA = REPLAY_PATH ? JSON.parse(readFileSync(REPLAY_PATH, 'utf8')) : null;
const SNAPSHOT_AT = REPLAY_DATA ? Date.parse(REPLAY_DATA.snapshotAt) : Date.now();
const WINDOW_START = REPLAY_DATA ? Date.parse(REPLAY_DATA.windowStart) : SNAPSHOT_AT - 7 * 86_400_000;
const WINDOW_END = REPLAY_DATA ? Date.parse(REPLAY_DATA.windowEndExclusive) : SNAPSHOT_AT - 1 * 86_400_000;
const SAMPLE_VALIDATION_MIN_USD = 500;
const MIN_LIQUIDITY_USD = 10_000;
const MAX_TOKENS = Number(process.argv.find((arg) => arg.startsWith('--max-tokens='))?.split('=')[1] ?? 15);
const MAX_POOLS_PER_TOKEN = 3;
const ADDRESS_RE = /^0x[\da-f]{40}$/i;
const CHAINS = {
  ethereum: { platform: 'ethereum', url: 'https://eth.hypersync.xyz', explorer: 'https://eth.blockscout.com/api/v2', label: 'Ethereum' },
  base: { platform: 'base', url: 'https://base.hypersync.xyz', explorer: 'https://base.blockscout.com/api/v2', label: 'Base' },
};
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const LIQUIDITY_EVENTS = [
  parseAbiItem('event Mint(address indexed sender, uint256 amount0, uint256 amount1)'),
  parseAbiItem('event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)'),
  parseAbiItem('event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)'),
  parseAbiItem('event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)'),
];
const LIQUIDITY_TOPICS = new Set(LIQUIDITY_EVENTS.map((abi) => toEventSelector(abi).toLowerCase()));
const TRANSFER_TOPIC = toEventSelector(TRANSFER).toLowerCase();
const ZERO = '0x0000000000000000000000000000000000000000';
const STABLES = new Map([
  ['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 6], // Ethereum USDC
  ['0xdac17f958d2ee523a2206206994597c13d831ec7', 6], // Ethereum USDT
  ['0x6b175474e89094c44da98b954eedeac495271d0f', 18], // Ethereum DAI
  ['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 6], // Base USDC
  ['0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', 6], // Base USDbC
]);
const WETH = new Set([
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // Ethereum WETH
  '0x4200000000000000000000000000000000000006', // Base WETH
]);
const ENTRYPOINTS = new Set([
  '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789',
  '0x0000000071727de22e5e9d8baf0edac6f37da032',
]);
const ROUTER_SENDERS = new Set([
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', // Uniswap V2 router
  '0xe592427a0aece92de3edee1f18e0157c05861564', // Uniswap V3 SwapRouter
  '0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b', // Universal Router
]);

const timing = { coingeckoMs: 0, dexMs: 0, blockRangeResolutionMs: 0, swapQueryMs: 0, transferQueryMs: 0, txMetadataMs: 0, pricingMs: 0, walletResolutionMs: 0, aggregationMs: 0, totalMs: 0 };
const diagnostics = { poolsScanned: 0, swapEventsFetched: 0, transferLogsFetched: 0, candidateBuys: 0, confirmedBuys: 0, unresolvedWalletTrades: 0, unpricedTrades: 0, skippedLiquidity: 0, skippedNoWalletFlow: 0, buyDirectionResolved: 0, walletResolved: 0, uncertainReasons: {}, uncertainCandidates: [], logs: 0, transactions: 0, hypersyncQueries: 0, responsePages: 0, swapPages: 0, transferPages: 0, metadataPages: 0, hypersyncServerMs: 0, bytes: 0, responseBytes: 0, swapResponseBytes: 0, transferResponseBytes: 0, metadataResponseBytes: 0, boundaries: {}, attemptedChains: [], authVerified: false };
const clockStart = Date.now();
let lastHyperSyncRequestAt = 0;

async function json(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(45_000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} at ${url}: ${body.slice(0, 500)}`);
  try { return JSON.parse(body); } catch { throw new Error(`Invalid JSON from ${url}: ${body.slice(0, 200)}`); }
}

function recordUncertain(reasonCode, context, stat = null) {
  diagnostics.unresolvedWalletTrades += 1;
  if (stat) stat.unresolved += 1;
  diagnostics.uncertainReasons[reasonCode] = (diagnostics.uncertainReasons[reasonCode] ?? 0) + 1;
  diagnostics.uncertainCandidates.push({ ...context, reasonCode });
}

function protocolFor(pair) {
  const id = String(pair.dexId ?? '').toLowerCase();
  const labels = (pair.labels ?? []).map((label) => String(label).toLowerCase());
  if (['aerodrome', 'velodrome', 'velodrome-v2'].includes(id)) return null;
  if (id === 'supernova') return null; // Nonstandard DEX; skip until its pool ABI and event semantics are independently verified.
  if (id === 'uniswap-v2' || labels.includes('v2')) return 'uniswap-v2';
  if (id === 'uniswap-v3' || labels.includes('v3') || labels.includes('cl')) return 'uniswap-v3';
  return null;
}

function pairHasToken(pair, address) {
  return [pair.baseToken?.address, pair.quoteToken?.address].some((item) => String(item ?? '').toLowerCase() === address.toLowerCase());
}

async function discoverTokens() {
  if (REPLAY_DATA) {
    const dexStart = Date.now();
    const replayTokens = await Promise.all(REPLAY_DATA.tokens.map(async (saved) => {
      const pools = await Promise.all(saved.pools.map(async (savedPool) => {
        const response = await json(`${DEX}/latest/dex/pairs/${saved.chain}/${savedPool.pairAddress}`);
        const pair = response.pair ?? response.pairs?.find((item) => item.pairAddress.toLowerCase() === savedPool.pairAddress.toLowerCase());
        if (!pair) throw new Error(`Could not restore saved DEX pair ${savedPool.pairAddress} from DexScreener.`);
        return { ...pair, decoder: savedPool.decoder };
      }));
      return { ...saved, pools, eligiblePoolCount: pools.length, liquidityCoveragePct: 100,
        activeNetworks: [{ chain: saved.chain, liquidity: pools.reduce((sum, pair) => sum + Number(pair.liquidity?.usd || 0), 0),
          volume: pools.reduce((sum, pair) => sum + Number(pair.volume?.h24 || 0), 0) }] };
    }));
    timing.dexMs = Date.now() - dexStart;
    console.log(`Replay mode: restored ${replayTokens.length} saved tokens/pools and exact window ${new Date(WINDOW_START).toISOString()} – ${new Date(WINDOW_END).toISOString()}.`);
    return replayTokens;
  }
  const cgStart = Date.now();
  const [trending, list] = await Promise.all([
    json(`${CG}/search/trending`),
    json(`${CG}/coins/list?include_platform=true`),
  ]);
  timing.coingeckoMs = Date.now() - cgStart;
  const platforms = new Map(list.map((coin) => [coin.id, coin.platforms ?? {}]));
  const coins = (trending.coins ?? []).map((record, index) => ({ rank: index + 1, ...record.item, contracts: platforms.get(record.item.id) ?? {} }));
  const selected = [];
  const rejected = [];
  const dexStart = Date.now();
  for (const coin of coins) {
    if (selected.length === MAX_TOKENS) break;
    console.log(`Discovery token ${coin.rank}/${coins.length}: ${coin.symbol} (${selected.length}/${MAX_TOKENS} eligible selected)`);
    const contracts = Object.entries(CHAINS).map(([chain, config]) => ({ chain, address: coin.contracts[config.platform] }))
      .filter(({ address }) => typeof address === 'string' && ADDRESS_RE.test(address));
    if (!contracts.length) {
      rejected.push(`#${coin.rank} ${coin.symbol} (${coin.id}) no Ethereum/Base ERC20 contract`);
      continue;
    }
    const networkResults = await Promise.all(contracts.map(async ({ chain, address }) => {
      const pairs = await json(`${DEX}/token-pairs/v1/${chain}/${address}`);
      const eligible = (Array.isArray(pairs) ? pairs : []).filter((pair) => pair.chainId === chain
        && ADDRESS_RE.test(pair.pairAddress ?? '') && pairHasToken(pair, address)
        && Number(pair.liquidity?.usd) >= MIN_LIQUIDITY_USD && protocolFor(pair));
      const liquid = (Array.isArray(pairs) ? pairs : []).filter((pair) => Number(pair.liquidity?.usd) >= MIN_LIQUIDITY_USD && pairHasToken(pair, address));
      return { chain, address, eligible, liquid };
    }));
    const networks = networkResults.map((item) => ({ ...item,
      volume: item.eligible.reduce((sum, pair) => sum + (Number(pair.volume?.h24) || 0), 0),
      liquidity: item.eligible.reduce((sum, pair) => sum + (Number(pair.liquidity?.usd) || 0), 0),
    })).filter((item) => item.eligible.length).sort((a, b) => b.liquidity - a.liquidity || b.volume - a.volume);
    if (!networks.length) {
      const detail = networkResults.map(({ chain, address, eligible, liquid }) => `${chain}:${address} eligible=${eligible.length}; liquid pairs=${liquid.slice(0, 4).map((pair) => `${pair.dexId}[${(pair.labels ?? []).join(',')}] $${Math.round(Number(pair.liquidity?.usd))}`).join('/') || 'none'}`).join(', ');
      rejected.push(`#${coin.rank} ${coin.symbol} (${coin.id}) ${detail || 'no Ethereum/Base ERC20 contract'}`);
      continue;
    }
    const network = networks[0];
    const sorted = [...network.eligible].sort((a, b) =>
      (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0)
      || (Number(b.volume?.h24) || 0) - (Number(a.volume?.h24) || 0));
    const dominant = [];
    let covered = 0;
    for (const pair of sorted) {
      if (dominant.length >= MAX_POOLS_PER_TOKEN) break;
      dominant.push({ ...pair, decoder: protocolFor(pair) });
      covered += Number(pair.liquidity?.usd) || 0;
      if (covered >= network.liquidity * 0.8) break;
    }
    selected.push({ rank: coin.rank, id: coin.id, name: coin.name, symbol: coin.symbol,
      chain: network.chain, contract: network.address.toLowerCase(), pools: dominant,
      eligiblePoolCount: network.eligible.length,
      liquidityCoveragePct: network.liquidity > 0 ? covered / network.liquidity * 100 : 0,
      activeNetworks: networks.map(({ chain, volume, liquidity }) => ({ chain, volume, liquidity })) });
  }
  timing.dexMs = Date.now() - dexStart;
  if (!selected.length) throw new Error(`No CoinGecko Trending token had an eligible Ethereum/Base pool among ${coins.length} coins.`);
  if (selected.length < MAX_TOKENS) console.log(`Trending token discovery found ${selected.length}/${MAX_TOKENS} eligible tokens; skipped: ${rejected.join(' | ')}`);
  return selected;
}

function printTokens(tokens) {
  console.log('\nTRENDING TOKENS / DEX POOLS');
  for (const token of tokens) {
    console.log(`#${token.rank} ${token.name} (${token.symbol}) | CoinGecko ID ${token.id} | ${CHAINS[token.chain].label} ${token.contract}`);
    for (const pool of token.pools) {
      const age = pool.pairCreatedAt ? `${((Date.now() - pool.pairCreatedAt) / 86_400_000).toFixed(1)} days` : 'NEOVĚŘENO';
      console.log(`  ${pool.decoder} / ${pool.dexId} pool ${pool.pairAddress} | $${Number(pool.liquidity?.usd).toLocaleString()} liq | $${Number(pool.volume?.h24).toLocaleString()} 24h | age ${age} | ${pool.baseToken?.symbol}/${pool.quoteToken?.symbol}`);
    }
    console.log(`  Network decision: ${token.activeNetworks.map((item) => `${item.chain} liquidity $${Math.round(item.liquidity).toLocaleString()} / 24h volume $${Math.round(item.volume).toLocaleString()}`).join('; ')}`);
    console.log(`  Pool coverage: selected ${token.pools.length} of ${token.eligiblePoolCount} eligible supported pools, ${token.liquidityCoveragePct.toFixed(1)}% of eligible liquidity.`);
  }
  console.log(`Pool selection: liquidity >= $${MIN_LIQUIDITY_USD}; ranked by liquidity then h24 volume; take up to ${MAX_POOLS_PER_TOKEN} until >=80% of eligible liquidity represented.`);
}

async function hyperSyncGet(chain, apiToken, query) {
  const started = Date.now();
  let response;
  let body = '';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    diagnostics.hypersyncQueries += 1;
    try {
      const spacing = 500 - (Date.now() - lastHyperSyncRequestAt);
      if (spacing > 0) await new Promise((resolve) => setTimeout(resolve, spacing));
      lastHyperSyncRequestAt = Date.now();
      response = await fetch(`${CHAINS[chain].url}/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
        signal: AbortSignal.timeout(120_000),
      });
      body = await response.text();
    } catch (error) {
      if (attempt === 5) throw new Error(`HyperSync request failed (${chain}): ${error.cause?.code ?? error.cause?.message ?? error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
      continue;
    }
    if (response.ok) break;
    if (response.status !== 429 && response.status < 500) throw new Error(`HyperSync ${response.status} ${response.statusText} (${chain}): ${body.slice(0, 700)}`);
    if (attempt === 5) throw new Error(`HyperSync ${response.status} ${response.statusText} (${chain}): ${body.slice(0, 700)} (Retry-After ${response.headers.get('retry-after') ?? 'not provided'})`);
    const retryAfterMs = Number(response.headers.get('retry-after')) * 1000 || 0;
    await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfterMs, Math.min(30_000, 3_000 * (2 ** attempt)))));
  }
  timing.hypersyncMs += Date.now() - started;
  diagnostics.authVerified = true;
  let raw;
  try { raw = JSON.parse(body); } catch { throw new Error(`HyperSync returned invalid JSON (${chain}): ${body.slice(0, 250)}`); }
  const responseBytes = Buffer.byteLength(body);
  diagnostics.responseBytes += responseBytes;
  const batches = Array.isArray(raw.data) ? raw.data : (raw.data ? [raw.data] : []);
  const flatten = (key) => batches.flatMap((batch) => batch[key] ?? []);
  const logs = flatten('logs').map((item) => ({
    ...item,
    transactionHash: item.transaction_hash ?? item.transactionHash,
    blockNumber: item.block_number ?? item.blockNumber,
    transactionIndex: item.transaction_index ?? item.transactionIndex,
    logIndex: item.log_index ?? item.logIndex,
    topics: item.topics ?? [item.topic0, item.topic1, item.topic2, item.topic3].filter(Boolean),
  }));
  const transactions = flatten('transactions').map((item) => ({
    ...item, hash: String(item.hash ?? '').toLowerCase(), from: String(item.from ?? '').toLowerCase(),
    to: String(item.to ?? '').toLowerCase(), blockNumber: Number(item.block_number ?? item.blockNumber),
  }));
  const blocks = flatten('blocks').map((item) => ({
    ...item, number: Number(item.number ?? item.block_number), timestamp: Number(item.timestamp),
  }));
  return {
    data: { logs, transactions, blocks, traces: flatten('traces') },
    nextBlock: Number(raw.next_block),
    totalExecutionTime: raw.total_execution_time ?? 0,
    archiveHeight: raw.archive_height,
    responseBytes,
  };
}

async function hyperSyncHeight(chain, apiToken) {
  const started = Date.now();
  diagnostics.httpRequests = (diagnostics.httpRequests ?? 0) + 1;
  let response;
  try {
    response = await fetch(`${CHAINS[chain].url}/height`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(`HyperSync height request failed (${chain}): ${error.cause?.code ?? error.cause?.message ?? error.message}`);
  }
  const body = await response.text();
  timing.hypersyncMs += Date.now() - started;
  if (!response.ok) throw new Error(`HyperSync height ${response.status} (${chain}): ${body.slice(0, 500)}`);
  const value = JSON.parse(body).height;
  if (!Number.isSafeInteger(value)) throw new Error(`HyperSync returned invalid chain height for ${chain}.`);
  return value;
}

async function getBlockBounds(chain, apiToken) {
  const savedBounds = REPLAY_DATA?.blockBounds?.[chain];
  if (savedBounds) {
    diagnostics.boundaries[chain] = { ...savedBounds };
    return { fromBlock: savedBounds.fromBlock, toBlock: savedBounds.toBlock };
  }
  const phaseStart = Date.now();
  console.log(`Resolving ${chain} block range for ${new Date(WINDOW_START).toISOString()}..${new Date(WINDOW_END).toISOString()}.`);
  const start = Math.floor(WINDOW_START / 1000);
  const end = Math.floor(WINDOW_END / 1000);
  const height = await hyperSyncHeight(chain, apiToken);
  const recent = await hyperSyncGet(chain, apiToken, {
    from_block: Math.max(0, height - 2048), to_block: height, blocks: [{}], include_all_blocks: true,
    field_selection: { block: ['number', 'timestamp'] }, join_mode: 'JoinNothing', max_num_blocks: 4096,
  });
  const recentBlocks = recent.data.blocks.filter((block) => Number.isFinite(Number(block.timestamp))).sort((a, b) => a.number - b.number);
  if (recentBlocks.length < 2) throw new Error(`Could not sample recent block timestamps for ${chain}.`);
  const avgBlockSeconds = (Number(recentBlocks.at(-1).timestamp) - Number(recentBlocks[0].timestamp))
    / (Number(recentBlocks.at(-1).number) - Number(recentBlocks[0].number));
  if (!(avgBlockSeconds > 0)) throw new Error(`Invalid recent block-time estimate for ${chain}.`);
  const headBlock = Number(recentBlocks.at(-1).number);
  const headTimestamp = Number(recentBlocks.at(-1).timestamp);
  const estimatedStart = Math.max(0, Math.round(headBlock - (headTimestamp - start) / avgBlockSeconds));
  const estimatedEnd = Math.max(0, Math.round(headBlock - (headTimestamp - end) / avgBlockSeconds));
  const readBlockSlice = async (center, padding, label) => {
    const from = Math.max(0, center - padding);
    const to = Math.min(height, center + padding + 1);
    const blocks = [];
    let cursor = from;
    while (cursor < to) {
      const response = await hyperSyncGet(chain, apiToken, {
        from_block: cursor, to_block: to, blocks: [{}], include_all_blocks: true,
        field_selection: { block: ['number', 'timestamp'] }, join_mode: 'JoinNothing', max_num_blocks: 50_000,
      });
      diagnostics.hypersyncServerMs += response.totalExecutionTime || 0;
      diagnostics.responsePages += 1;
      diagnostics.metadataPages += 1;
      diagnostics.metadataResponseBytes += response.responseBytes ?? 0;
      blocks.push(...response.data.blocks);
      const next = response.nextBlock;
      if (!Number.isInteger(next) || next <= cursor) throw new Error(`HyperSync ${label} timestamp pagination stopped at block ${cursor} (${chain}).`);
      cursor = next;
      console.log(`Block timestamp ${label} (${chain}): ${blocks.length} headers, next ${cursor}/${to}.`);
    }
    return blocks.sort((a, b) => Number(a.number) - Number(b.number));
  };
  const bracket = (blocks, target) => blocks.length >= 2
    && Number(blocks[0].timestamp) <= target && Number(blocks.at(-1).timestamp) >= target;
  let padding = Math.max(200, Math.ceil((headBlock - estimatedStart) * 0.002));
  let startSamples; let endSamples;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    [startSamples, endSamples] = await Promise.all([
      readBlockSlice(estimatedStart, padding, `window-start attempt ${attempt}`),
      readBlockSlice(estimatedEnd, padding, `window-end attempt ${attempt}`),
    ]);
    if (bracket(startSamples, start) && bracket(endSamples, end)) break;
    if (attempt === 5) throw new Error(`Recent block-time estimates did not bracket the ${chain} time window after 5 expansions.`);
    padding *= 2;
  }
  const firstAtOrAfter = (blocks, target) => {
    let low = 0; let high = blocks.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (Number(blocks[middle].timestamp) >= target) high = middle;
      else low = middle + 1;
    }
    return Number(blocks[low]?.number);
  };
  const fromBlock = firstAtOrAfter(startSamples, start);
  const toBlock = firstAtOrAfter(endSamples, end);
  diagnostics.boundaries[chain] = { fromBlock, toBlock, windowStart: new Date(WINDOW_START).toISOString(), windowEndExclusive: new Date(WINDOW_END).toISOString() };
  timing.blockRangeResolutionMs += Date.now() - phaseStart;
  console.log(`Block range ${chain}: ${fromBlock}..${toBlock} resolved in ${Date.now() - phaseStart} ms (${diagnostics.hypersyncQueries} query calls so far).`);
  return { fromBlock, toBlock };
}

async function fetchWindow(apiToken, tokens, chain) {
  if (!diagnostics.attemptedChains.includes(chain)) diagnostics.attemptedChains.push(chain);
  const targetTokens = tokens.filter((token) => token.chain === chain);
  targetTokens.forEach((token, index) => console.log(`Token ${index + 1}/${targetTokens.length} on ${chain}: ${token.symbol} rank #${token.rank}.`));
  const pools = targetTokens.flatMap((token) => token.pools.map((pair) => ({ token, pair })));
  const poolAddresses = pools.map(({ pair }) => pair.pairAddress.toLowerCase());
  const swapTopics = [...new Set(pools.map(({ pair }) => swapEventFor(pair.decoder)).filter(Boolean).map((entry) => toEventSelector(entry.abi).toLowerCase()))];
  const liquidityTopics = [...LIQUIDITY_TOPICS];
  const swapLogSelections = [
    { address: poolAddresses, topics: [swapTopics] },
    { address: poolAddresses, topics: [liquidityTopics] },
  ];
  const bounds = await getBlockBounds(chain, apiToken);
  const swapLogs = [];
  let cursor = bounds.fromBlock;
  const swapStart = Date.now();
  while (cursor < bounds.toBlock) {
    const response = await hyperSyncGet(chain, apiToken, {
      from_block: cursor, to_block: bounds.toBlock, logs: swapLogSelections,
      field_selection: {
        log: ['address', 'topic0', 'topic1', 'topic2', 'topic3', 'data', 'transaction_hash', 'block_number', 'transaction_index', 'log_index'],
      },
      join_mode: 'JoinNothing',
      max_num_logs: 50_000,
    });
    diagnostics.hypersyncServerMs += response.totalExecutionTime || 0;
    diagnostics.responsePages += 1;
    diagnostics.swapPages += 1;
    diagnostics.logs += response.data.logs.length;
    diagnostics.swapEventsFetched += response.data.logs.filter((log) => swapTopics.includes(String(log.topics?.[0] ?? '').toLowerCase())).length;
    diagnostics.swapResponseBytes += response.responseBytes ?? 0;
    swapLogs.push(...response.data.logs);
    const next = response.nextBlock;
    if (!Number.isInteger(next) || next <= cursor) throw new Error(`HyperSync pagination stopped at block ${cursor} (${chain}).`);
    cursor = next;
    console.log(`Swap pages ${diagnostics.swapPages} (${chain}): next block ${cursor}/${bounds.toBlock}, ${response.data.logs.length} logs this page.`);
  }
  timing.swapQueryMs += Date.now() - swapStart;
  const pairMap = new Map(pools.map(({ token, pair }) => [pair.pairAddress.toLowerCase(), { token, pair }]));
  const candidateHashes = new Set();
  for (const log of swapLogs) {
    const hash = String(log.transactionHash ?? '').toLowerCase();
    const pool = pairMap.get(String(log.address ?? '').toLowerCase());
    const decoded = decodeSwap(log);
    if (pool && decoded) {
      if (decoded.amount0Out > 0n || decoded.amount1Out > 0n) candidateHashes.add(hash);
    }
  }
  console.log(`Swap phase ${chain}: ${swapLogs.length} pool logs; ${candidateHashes.size} candidate tx hashes; ${Date.now() - swapStart} ms.`);

  const transferLogSelections = targetTokens.map((token) => ({ address: [token.contract], topics: [[TRANSFER_TOPIC]] }));
  for (const { token, pair } of pools) {
    const quoteAddress = [pair.baseToken?.address, pair.quoteToken?.address]
      .map((address) => String(address ?? '').toLowerCase()).find((address) => address && address !== token.contract);
    if (!quoteAddress) continue;
    const poolTopic = `0x${pair.pairAddress.slice(2).toLowerCase().padStart(64, '0')}`;
    transferLogSelections.push(
      { address: [quoteAddress], topics: [[TRANSFER_TOPIC], [poolTopic], []] },
      { address: [quoteAddress], topics: [[TRANSFER_TOPIC], [], [poolTopic]] },
    );
  }
  const transactions = new Map();
  const blocks = new Map();
  const transferLogs = [];
  const transferStart = Date.now();
  if (candidateHashes.size) {
    cursor = bounds.fromBlock;
    while (cursor < bounds.toBlock) {
      const response = await hyperSyncGet(chain, apiToken, {
        from_block: cursor, to_block: bounds.toBlock, logs: transferLogSelections,
        field_selection: { log: ['address', 'topic0', 'topic1', 'topic2', 'topic3', 'data', 'transaction_hash', 'block_number', 'transaction_index', 'log_index'] },
        join_mode: 'JoinNothing', max_num_logs: 50_000,
      });
      diagnostics.hypersyncServerMs += response.totalExecutionTime || 0;
      diagnostics.responsePages += 1;
      diagnostics.transferPages += 1;
      diagnostics.logs += response.data.logs.length;
      diagnostics.transferLogsFetched += response.data.logs.length;
      diagnostics.transferResponseBytes += response.responseBytes ?? 0;
      transferLogs.push(...response.data.logs);
      const next = response.nextBlock;
      if (!Number.isInteger(next) || next <= cursor) throw new Error(`HyperSync transfer pagination stopped at block ${cursor} (${chain}).`);
      cursor = next;
      console.log(`Transfer pages ${diagnostics.transferPages} (${chain}): next block ${cursor}/${bounds.toBlock}, ${response.data.logs.length} transfer logs.`);
    }
  }
  timing.transferQueryMs += Date.now() - transferStart;
  const metadataStart = Date.now();
  if (candidateHashes.size) {
    cursor = bounds.fromBlock;
    while (cursor < bounds.toBlock) {
      const response = await hyperSyncGet(chain, apiToken, {
        from_block: cursor, to_block: bounds.toBlock, transactions: [{ hash: [...candidateHashes] }],
        field_selection: { transaction: ['hash', 'from', 'to', 'block_number', 'block_hash', 'status', 'type'] },
        join_mode: 'JoinNothing', max_num_transactions: 50_000,
      });
      diagnostics.hypersyncServerMs += response.totalExecutionTime || 0;
      diagnostics.responsePages += 1;
      diagnostics.metadataPages += 1;
      diagnostics.metadataResponseBytes += response.responseBytes ?? 0;
      for (const tx of response.data.transactions) transactions.set(tx.hash, tx);
      diagnostics.transactions += response.data.transactions.length;
      const next = response.nextBlock;
      if (!Number.isInteger(next) || next <= cursor) throw new Error(`HyperSync transaction metadata pagination stopped at block ${cursor} (${chain}).`);
      cursor = next;
      console.log(`Transaction metadata pages ${diagnostics.metadataPages} (${chain}): next block ${cursor}/${bounds.toBlock}, ${response.data.transactions.length} candidate txs.`);
    }
  }
  const blockHashes = [...new Set([...transactions.values()].map((tx) => String(tx.block_hash ?? tx.blockHash ?? '').toLowerCase()).filter((hash) => /^0x[\da-f]{64}$/i.test(hash)))];
  if (blockHashes.length) {
    cursor = bounds.fromBlock;
    while (cursor < bounds.toBlock) {
      const response = await hyperSyncGet(chain, apiToken, {
        from_block: cursor, to_block: bounds.toBlock, blocks: [{ hash: blockHashes }],
        field_selection: { block: ['number', 'hash', 'timestamp'] }, join_mode: 'JoinNothing', max_num_blocks: 50_000,
      });
      diagnostics.hypersyncServerMs += response.totalExecutionTime || 0;
      diagnostics.responsePages += 1;
      diagnostics.metadataPages += 1;
      diagnostics.metadataResponseBytes += response.responseBytes ?? 0;
      for (const block of response.data.blocks) blocks.set(Number(block.number), block);
      const next = response.nextBlock;
      if (!Number.isInteger(next) || next <= cursor) throw new Error(`HyperSync block metadata pagination stopped at block ${cursor} (${chain}).`);
      cursor = next;
    }
  }
  timing.txMetadataMs += Date.now() - metadataStart;
  const uniqueLogs = new Map([...swapLogs, ...transferLogs].map((log) => [`${log.transactionHash}:${log.logIndex}`, log]));
  const dedupedLogs = [...uniqueLogs.values()];
  const bytes = diagnostics.swapResponseBytes + diagnostics.transferResponseBytes + diagnostics.metadataResponseBytes;
  diagnostics.bytes += Buffer.byteLength(JSON.stringify({ logs: dedupedLogs, transactions: [...transactions.values()], blocks: [...blocks.values()] }));
  diagnostics.poolsScanned += pools.length;
  return { logs: dedupedLogs, transactions, blocks, pools, bounds, candidateHashes: candidateHashes.size,
    transferLogsFetched: transferLogs.length, responseBytes: bytes };
}

function decodeTransfer(log) {
  const topics = log.topics ?? [];
  if ((topics[0] ?? '').toLowerCase() !== TRANSFER_TOPIC || topics.length < 3) return null;
  try {
    const decoded = decodeEventLog({ abi: [TRANSFER], data: log.data, topics });
    return { token: log.address.toLowerCase(), from: decoded.args.from.toLowerCase(), to: decoded.args.to.toLowerCase(), amount: decoded.args.value };
  } catch { return null; }
}

async function historicalEthPrices() {
  const from = Math.floor(WINDOW_START / 1000);
  const to = Math.floor(WINDOW_END / 1000);
  const started = Date.now();
  try {
    const result = await json(`${CG}/coins/ethereum/market_chart/range?vs_currency=usd&from=${from}&to=${to}`);
    timing.coingeckoMs += Date.now() - started;
    return result.prices ?? [];
  } catch (error) {
    timing.coingeckoMs += Date.now() - started;
    console.error(`CoinGecko historical ETH/USD unavailable; WETH-quoted trades will be unpriced: ${error.message}`);
    return [];
  }
}

function priceAt(prices, timestampMs) {
  let latestPrior = null;
  for (const point of prices) {
    if (point[0] <= timestampMs && (!latestPrior || point[0] > latestPrior.timestamp)) {
      latestPrior = { timestamp: point[0], price: Number(point[1]) };
    }
  }
  return latestPrior && timestampMs - latestPrior.timestamp <= 60 * 60_000 ? latestPrior.price : null;
}

function runAggregations(trades, snapshotAt = SNAPSHOT_AT) {
  const byWalletToken = new Map();
  for (const trade of trades) {
    const key = `${trade.walletAddress}:${trade.chain}:${trade.tokenContract}`;
    let agg = byWalletToken.get(key);
    if (!agg) {
      agg = { walletAddress: trade.walletAddress, chain: trade.chain, tokenContract: trade.tokenContract,
        tokenSymbol: trade.tokenSymbol, firstBuyAt: trade.timestamp, lastBuyAt: trade.timestamp, buyCount: 0, totalUsdBought: 0, sampleTxHash: trade.txHash };
      byWalletToken.set(key, agg);
    }
    agg.firstBuyAt = trade.timestamp < agg.firstBuyAt ? trade.timestamp : agg.firstBuyAt;
    agg.lastBuyAt = trade.timestamp > agg.lastBuyAt ? trade.timestamp : agg.lastBuyAt;
    agg.buyCount += 1;
    agg.totalUsdBought += trade.amountUsd;
  }
  const wallets = new Map();
  for (const item of byWalletToken.values()) {
    let wallet = wallets.get(item.walletAddress);
    if (!wallet) {
      wallet = { wallet: item.walletAddress, tokens: [], totalUsdBought: 0, earliestBuyAt: item.firstBuyAt, latestBuyAt: item.lastBuyAt, leadTimeHours: 0 };
      wallets.set(item.walletAddress, wallet);
    }
    wallet.tokens.push(item);
    wallet.totalUsdBought += item.totalUsdBought;
    wallet.earliestBuyAt = item.firstBuyAt < wallet.earliestBuyAt ? item.firstBuyAt : wallet.earliestBuyAt;
    wallet.latestBuyAt = item.lastBuyAt > wallet.latestBuyAt ? item.lastBuyAt : wallet.latestBuyAt;
      wallet.leadTimeHours += (snapshotAt - Date.parse(item.firstBuyAt)) / 3_600_000;
  }
  return [...wallets.values()].map((wallet) => ({ ...wallet,
    trendingTokensCount: wallet.tokens.length,
    averageLeadTimeHours: wallet.leadTimeHours / wallet.tokens.length,
    tokens: wallet.tokens.sort((a, b) => a.firstBuyAt.localeCompare(b.firstBuyAt)),
  })).sort((a, b) => b.trendingTokensCount - a.trendingTokensCount || b.totalUsdBought - a.totalUsdBought);
}

function thresholdLayer(allTrades, threshold) {
  const trades = allTrades.filter((trade) => trade.amountUsd >= threshold);
  return { threshold, trades, wallets: runAggregations(trades), uniqueWallets: new Set(trades.map((trade) => trade.walletAddress)).size };
}

function intersectionCounts(wallets) {
  return { exactly1: wallets.filter((wallet) => wallet.trendingTokensCount === 1).length,
    atLeast2: wallets.filter((wallet) => wallet.trendingTokensCount >= 2).length,
    atLeast3: wallets.filter((wallet) => wallet.trendingTokensCount >= 3).length,
    atLeast4: wallets.filter((wallet) => wallet.trendingTokensCount >= 4).length };
}

async function validateSamples(trades, confirmedTrades = trades, sampleLimit = 10) {
  const samples = trades.slice(0, sampleLimit);
  const selected = new Set(samples.map((trade) => `${trade.chain}:${trade.txHash}:${trade.tokenContract}`));
  const supplemental = sampleLimit === 10 ? confirmedTrades.filter((trade) => trade.amountUsd < SAMPLE_VALIDATION_MIN_USD
    && !selected.has(`${trade.chain}:${trade.txHash}:${trade.tokenContract}`)).slice(0, sampleLimit - samples.length) : [];
  samples.push(...supplemental);
  const qualifiedAttempted = samples.filter((trade) => trade.amountUsd >= SAMPLE_VALIDATION_MIN_USD).length;
  console.log(`\nMANUAL SAMPLE SANITY CHECKS (${samples.length}/${sampleLimit}; ${qualifiedAttempted} >= $${SAMPLE_VALIDATION_MIN_USD}, ${samples.length - qualifiedAttempted} below threshold)`);
  for (const trade of samples) {
    try {
      const base = CHAINS[trade.chain].explorer;
      const [tx, transferData] = await Promise.all([
        json(`${base}/transactions/${trade.txHash}`),
        json(`${base}/transactions/${trade.txHash}/token-transfers?type=ERC-20`),
      ]);
      const tokenRawReceived = trade.flowMethod === 'transaction-net-flow'
        ? sumBlockscoutTransfers(transferData.items, { tokenAddress: trade.tokenContract, toAddress: trade.walletAddress })
          - sumBlockscoutTransfers(transferData.items, { tokenAddress: trade.tokenContract, fromAddress: trade.walletAddress })
        : sumBlockscoutTransfers(transferData.items, { tokenAddress: trade.tokenContract, fromAddress: trade.pairAddress, toAddress: trade.walletAddress });
      const received = tokenRawReceived > 0n;
      const targetAmountMatches = tokenRawReceived > 0n && tokenRawReceived === BigInt(trade.tokenAmount);
      const quoteRawNet = sumBlockscoutTransfers(transferData.items, {
        tokenAddress: trade.quoteTokenContract, toAddress: trade.pairAddress,
      }) - sumBlockscoutTransfers(transferData.items, {
        tokenAddress: trade.quoteTokenContract, fromAddress: trade.pairAddress,
      });
      const quoteAmountMatches = quoteRawNet > 0n && quoteRawNet === BigInt(trade.quoteAmountRaw);
      const recomputedUsd = Number(quoteRawNet) / (10 ** trade.quoteDecimals) * trade.quotePriceUsd;
      const usdMatches = quoteAmountMatches && Number.isFinite(recomputedUsd)
        && Math.abs(recomputedUsd - trade.amountUsd) <= Math.max(0.02, trade.amountUsd * 0.00001);
      const timestamp = Date.parse(tx.timestamp);
      const inWindow = timestamp >= WINDOW_START && timestamp < WINDOW_END;
      const walletMatch = String(tx.from?.hash ?? '').toLowerCase() === trade.walletAddress;
      const poolSwapVerified = trade.swapVerified === true && trade.poolAddress.toLowerCase() === trade.pairAddress;
      const result = received && targetAmountMatches && quoteAmountMatches && usdMatches && inWindow && walletMatch && poolSwapVerified ? 'VALID'
        : (!received || !inWindow || !poolSwapVerified ? 'INVALID' : 'UNCERTAIN');
      console.log(`${result} ${trade.chain} ${trade.txHash} | target-to-wallet=${received} | target amount matches=${targetAmountMatches} | tx.from matches=${walletMatch} | time=${inWindow} | quote amount matches=${quoteAmountMatches} | USD recomputes=${usdMatches} ($${trade.amountUsd.toFixed(2)}, ${trade.priceMethod})`);
      trade.validation = result;
    } catch (error) { console.log(`UNCERTAIN ${trade.chain} ${trade.txHash} | validation error: ${error.message}`); }
  }
  return { attempted: samples.length, qualifiedAttempted, supplementalAttempted: samples.length - qualifiedAttempted,
    valid: samples.filter((trade) => trade.validation === 'VALID').length,
    invalid: samples.filter((trade) => trade.validation === 'INVALID').length,
    uncertain: samples.length - samples.filter((trade) => ['VALID', 'INVALID'].includes(trade.validation)).length,
    successRate: samples.length ? samples.filter((trade) => trade.validation === 'VALID').length / samples.length : null };
}

function printReport(tokens, perToken, layers) {
  console.log('\nDATA QUALITY');
  for (const token of tokens) {
    const key = `${token.chain}:${token.contract}`;
    const stat = perToken.get(key) ?? { candidates: 0, confirmed: 0, unresolved: 0, unpriced: 0, swaps: 0, unique: 0 };
    console.log(`${token.symbol} ${token.chain}: pools scanned ${token.pools.length}; swap events fetched ${stat.swaps}; candidate buys ${stat.candidates}; confirmed buys ${stat.confirmed}; uncertain wallet/flow ${stat.unresolved}; unpriced ${stat.unpriced}; >=$250 buys ${stat.qualified250 ?? 0}; >=$500 buys ${stat.qualified500 ?? 0}`);
  }
  for (const layer of layers) {
    const { threshold, trades, wallets } = layer;
    console.log(`\nBUY >= $${threshold}: ${trades.length} buys; ${layer.uniqueWallets} unique wallets`);
    console.log(`wallets exactly 1 token=${wallets.filter((wallet) => wallet.trendingTokensCount === 1).length}; >=2=${wallets.filter((wallet) => wallet.trendingTokensCount >= 2).length}; >=3=${wallets.filter((wallet) => wallet.trendingTokensCount >= 3).length}; >=4=${wallets.filter((wallet) => wallet.trendingTokensCount >= 4).length}`);
    console.log(`TOP ${Math.min(20, wallets.length)} WALLETS`);
    console.log('| Rank | Wallet | Trending tokens | Tokens | Total USD bought | First buy | Last buy | Avg lead hours |');
    console.log('|---:|---|---:|---|---:|---|---|---:|');
    wallets.slice(0, 20).forEach((wallet, index) => console.log(`| ${index + 1} | ${wallet.wallet} | ${wallet.trendingTokensCount} | ${wallet.tokens.map((item) => item.tokenSymbol).join(', ')} | $${wallet.totalUsdBought.toFixed(2)} | ${wallet.earliestBuyAt} | ${wallet.latestBuyAt} | ${wallet.averageLeadTimeHours.toFixed(1)} |`));
  }
  console.log('wallet intersection alone != smart money');
  console.log(`\nRESOLUTION SPLIT: buyDirectionResolved=${diagnostics.buyDirectionResolved}/${diagnostics.candidateBuys}; walletResolved=${diagnostics.walletResolved}/${diagnostics.candidateBuys}.`);
  console.log('\nUNCERTAIN REASONS');
  console.log('| Reason | Count | % uncertain |');
  console.log('|---|---:|---:|');
  Object.entries(diagnostics.uncertainReasons).sort((a, b) => b[1] - a[1])
    .forEach(([reason, count]) => console.log(`| ${reason} | ${count} | ${diagnostics.unresolvedWalletTrades ? (count / diagnostics.unresolvedWalletTrades * 100).toFixed(1) : '0.0'}% |`));
}

async function main() {
  const token = process.env.ENVIO_API_TOKEN;
  try {
    const tokens = await discoverTokens();
    printTokens(tokens);
    if (!token) {
      console.log('\nENVIO_API_TOKEN chybí.');
      console.log('Nebyl odeslán žádný HyperSync request. Žádný DEX swap event ani wallet výsledek nebyl předstírán.');
      console.log('MANUAL SAMPLE SANITY CHECKS: neprovedeny, protože chybí HyperSync token.');
      return;
    }
    const queryStart = Date.now();
    const chainData = new Map();
    for (const chain of new Set(tokens.map((item) => item.chain))) {
      chainData.set(chain, await fetchWindow(token, tokens, chain));
    }
    timing.hypersyncMs = Date.now() - queryStart;
    const pricingStart = Date.now();
    const ethPrices = await historicalEthPrices();
    timing.pricingMs = Date.now() - pricingStart;
    const decoderStart = Date.now();
    const perToken = new Map();
    const candidates = new Map();
    const newlyConfirmed = new Map();
    const legacyConfirmedKeys = new Set();
    for (const [chain, data] of chainData) {
      const pairMap = new Map(data.pools.map(({ token: parent, pair }) => [pair.pairAddress.toLowerCase(), { token: parent, pair }]));
      const transferLogs = new Map();
      const txLogs = new Map();
      for (const log of data.logs) {
        const hash = String(log.transactionHash ?? '').toLowerCase();
        const topic = String(log.topics?.[0] ?? '').toLowerCase();
        if (topic === TRANSFER_TOPIC) {
          const transfer = decodeTransfer(log);
          if (!transfer) continue;
          const list = transferLogs.get(hash) ?? [];
          list.push(transfer);
          transferLogs.set(hash, list);
        }
        const pool = pairMap.get(String(log.address).toLowerCase());
        const decoded = decodeSwap(log);
        if (pool && decoded && decoded.kind === pool.pair.decoder) {
          const list = txLogs.get(hash) ?? [];
          list.push({ type: 'swap', pool, log, decoded });
          txLogs.set(hash, list);
          const stat = perToken.get(`${chain}:${pool.token.contract}`) ?? { candidates: 0, confirmed: 0, unresolved: 0, unpriced: 0, swaps: 0, unique: 0 };
          stat.swaps += 1; perToken.set(`${chain}:${pool.token.contract}`, stat);
        } else if (pool && LIQUIDITY_TOPICS.has(topic)) {
          const list = txLogs.get(hash) ?? [];
          list.push({ type: 'liquidity', pool, log });
          txLogs.set(hash, list);
        }
      }
      for (const [hash, events] of txLogs) {
        const swaps = events.filter((event) => event.type === 'swap');
        if (!swaps.length) continue;
        if (events.some((event) => event.type === 'liquidity')) { diagnostics.skippedLiquidity += 1; continue; }
        const tx = data.transactions.get(hash);
        if (!tx || tx.status === 0 || tx.status === '0x0' || !tx.from || !Number.isInteger(tx.blockNumber)) {
          for (const { token, pair } of swaps.map((item) => item.pool)) {
            const stat = perToken.get(`${chain}:${token.contract}`);
            recordUncertain('missing_transaction', { chain, token: token.symbol, tokenContract: token.contract, txHash: hash,
              poolAddress: pair.pairAddress.toLowerCase(), txFrom: null, txTo: null, buyDirectionResolved: false, walletResolved: false }, stat);
          }
          continue;
        }
        const wallet = tx.from.toLowerCase();
        const block = data.blocks.get(Number(tx.blockNumber));
        if (!block?.timestamp) {
          for (const { token, pair } of swaps.map((item) => item.pool)) {
            recordUncertain('missing_transaction', { chain, token: token.symbol, tokenContract: token.contract, txHash: hash,
              poolAddress: pair.pairAddress.toLowerCase(), txFrom: wallet, txTo: tx.to, buyDirectionResolved: false, walletResolved: false });
          }
          continue;
        }
        const timestamp = new Date(block.timestamp * 1000).toISOString();
        const timeMs = block.timestamp * 1000;
        if (timeMs < WINDOW_START || timeMs >= WINDOW_END) continue;
        const transfers = transferLogs.get(hash) ?? [];
        for (const swap of swaps) {
          const walletStart = Date.now();
          const { token, pair } = swap.pool;
          const stat = perToken.get(`${chain}:${token.contract}`) ?? { candidates: 0, confirmed: 0, unresolved: 0, unpriced: 0, swaps: 0, unique: 0 };
          perToken.set(`${chain}:${token.contract}`, stat);
          const pairAddress = pair.pairAddress.toLowerCase();
          const targetOut = transfers.filter((item) => item.token === token.contract && item.from === pairAddress)
            .reduce((sum, item) => sum + item.amount, 0n);
          if (targetOut <= 0n) { diagnostics.skippedNoWalletFlow += 1; continue; }
          diagnostics.candidateBuys += 1;
          stat.candidates += 1;
          const walletIn = transfers.filter((item) => item.token === token.contract && item.from === pairAddress && item.to === wallet)
            .reduce((sum, item) => sum + item.amount, 0n);
          const recipient = String(swap.decoded.args.to ?? swap.decoded.args.recipient ?? '').toLowerCase();
          const targetTransfers = transfers.filter((item) => item.token === token.contract);
          const flowRecipients = resolvePositiveTokenRecipients(targetTransfers, {
            tokenAddress: token.contract,
            excludedAddresses: [...pairMap.keys(), ...ROUTER_SENDERS],
          });
          const uniqueRecipient = flowRecipients.length === 1 ? flowRecipients[0] : null;
          const terminalDelta = uniqueRecipient?.netDelta ?? 0n;
          const legacyFlowResolved = walletIn > 0n && walletIn === targetOut && recipient === wallet;
          const txFlowResolved = uniqueRecipient?.address === wallet && terminalDelta === targetOut;
          const buyDirectionResolved = flowRecipients.length > 0;
          const walletResolved = legacyFlowResolved || flowRecipients.some((item) => item.address === wallet);
          timing.walletResolutionMs += Date.now() - walletStart;
          if (buyDirectionResolved) diagnostics.buyDirectionResolved += 1;
          if (walletResolved) diagnostics.walletResolved += 1;
          const uncertainContext = { chain, token: token.symbol, tokenContract: token.contract, txHash: hash, blockNumber: tx.blockNumber,
            poolAddress: pairAddress, txFrom: wallet, txTo: String(tx.to ?? '').toLowerCase(),
            swapRecipient: recipient, targetOut: targetOut.toString(), targetTransfers: targetTransfers.map((item) => ({
              from: item.from, to: item.to, amount: item.amount.toString(), logIndex: item.logIndex,
            })), recipients: flowRecipients.map((item) => ({ address: item.address, received: item.received.toString(), sent: item.sent.toString(), netDelta: item.netDelta.toString() })),
            buyDirectionResolved, walletResolved };
          if (!legacyFlowResolved && !txFlowResolved) {
              const reason = flowRecipients.length > 1 ? 'multiple_possible_recipients'
                : !flowRecipients.length ? 'target_flow_not_resolved'
                  : ENTRYPOINTS.has(String(tx.to ?? '').toLowerCase()) || Number(tx.type) === 4 ? 'smart_account'
                    : ROUTER_SENDERS.has(String(tx.to ?? '').toLowerCase()) ? 'aggregator'
                      : flowRecipients[0].address !== wallet ? 'multihop_ambiguous'
                        : recipient !== wallet ? 'multihop_ambiguous' : 'target_flow_not_resolved';
              recordUncertain(reason, uncertainContext, stat);
            continue;
          }
          const targetSide = inferTargetSideFromOutput(swap.decoded, targetOut);
          if (!targetSide) {
            recordUncertain('unsupported_swap_shape', uncertainContext, stat);
            continue;
          }
          const quote = [pair.baseToken, pair.quoteToken].find((item) => String(item.address).toLowerCase() !== token.contract);
          const quoteAddress = String(quote?.address ?? '').toLowerCase();
          const quoteIn = quoteInputRaw(swap.decoded, targetSide);
          const quoteTransferIn = transfers.filter((item) => item.token === quoteAddress && item.to === pairAddress)
            .reduce((sum, item) => sum + item.amount, 0n)
            - transfers.filter((item) => item.token === quoteAddress && item.from === pairAddress)
              .reduce((sum, item) => sum + item.amount, 0n);
          if (quoteIn <= 0n || quoteTransferIn !== quoteIn || targetOut !== (targetSide === 'token0' ? swap.decoded.amount0Out : swap.decoded.amount1Out)) {
            recordUncertain('target_flow_not_resolved', uncertainContext, stat);
            continue;
          }
          let amountUsd = null;
          let priceMethod = 'unpriced';
          if (quoteIn > 0n && STABLES.has(quoteAddress)) {
            amountUsd = Number(quoteIn) / (10 ** STABLES.get(quoteAddress));
            priceMethod = `stablecoin ${quote?.symbol}`;
          } else if (quoteIn > 0n && WETH.has(quoteAddress)) {
            const ethPrice = priceAt(ethPrices, timeMs);
            if (ethPrice) { amountUsd = Number(quoteIn) / 1e18 * ethPrice; priceMethod = `historical ETH/USD ${ethPrice.toFixed(2)}`; }
          }
          if (amountUsd === null || !Number.isFinite(amountUsd)) {
            diagnostics.unpricedTrades += 1;
            const stat = perToken.get(`${chain}:${token.contract}`) ?? { candidates: 0, confirmed: 0, unresolved: 0, unpriced: 0, swaps: 0, unique: 0 };
            stat.unpriced += 1; perToken.set(`${chain}:${token.contract}`, stat);
            continue;
          }
          const txType = typeof tx.type === 'string' ? Number(tx.type) : Number(tx.type ?? 0);
          const resolution = ENTRYPOINTS.has(String(tx.to ?? '').toLowerCase()) || ENTRYPOINTS.has(wallet)
            || ROUTER_SENDERS.has(wallet) || txType === 4 ? 'uncertain' : 'confirmed';
          if (resolution !== 'confirmed') {
            recordUncertain(ENTRYPOINTS.has(String(tx.to ?? '').toLowerCase()) || txType === 4 ? 'smart_account'
              : ROUTER_SENDERS.has(wallet) ? 'tx_from_router' : 'other', uncertainContext, stat);
            continue;
          }
          const normalized = { chain, tokenContract: token.contract, tokenSymbol: token.symbol, pairAddress, poolAddress: pairAddress,
            dexId: pair.dexId, walletAddress: wallet, blockNumber: tx.blockNumber, timestamp,
            txHash: hash, tokenAmount: (legacyFlowResolved ? walletIn : terminalDelta).toString(), tokenAmountUnit: 'raw base units',
            quoteTokenContract: quoteAddress, quoteAmount: formatUnits(quoteIn, STABLES.get(quoteAddress) ?? 18), quoteAmountRaw: quoteIn.toString(),
            quoteDecimals: STABLES.get(quoteAddress) ?? 18,
            quotePriceUsd: STABLES.has(quoteAddress) ? 1 : priceAt(ethPrices, timeMs),
            amountUsd, walletResolution: resolution, flowMethod: legacyFlowResolved ? 'direct-pool-transfer' : 'transaction-net-flow',
            pricingSource: priceMethod.startsWith('historical ETH/USD') ? 'CoinGecko historical ETH/USD' : priceMethod.startsWith('stablecoin') ? 'stablecoin quote ≈ $1' : 'unpriced', priceMethod, swapVerified: true };
          const key = `${chain}:${hash}:${token.contract}:${wallet}`;
          const old = candidates.get(key);
          if (!old || amountUsd > old.amountUsd) candidates.set(key, normalized);
          if (legacyFlowResolved) legacyConfirmedKeys.add(key);
          else newlyConfirmed.set(key, normalized);
          if (!legacyFlowResolved) diagnostics.newlyConfirmedBuys = (diagnostics.newlyConfirmedBuys ?? 0) + 1;
        }
      }
    }
    const confirmed = [...candidates.values()];
    const newlyConfirmedTrades = [...newlyConfirmed.entries()].filter(([key]) => !legacyConfirmedKeys.has(key)).map(([, trade]) => trade);
    diagnostics.newlyConfirmedBuys = newlyConfirmedTrades.length;
    diagnostics.confirmedBuys = confirmed.length;
    for (const trade of confirmed) {
      const stat = perToken.get(`${trade.chain}:${trade.tokenContract}`);
      if (stat) stat.confirmed += 1;
    }
    const aggregationStart = Date.now();
    const layer250 = thresholdLayer(confirmed, 250);
    const layer500 = thresholdLayer(confirmed, 500);
    for (const trade of confirmed) {
      const stat = perToken.get(`${trade.chain}:${trade.tokenContract}`);
      if (stat && trade.amountUsd >= 250) stat.qualified250 = (stat.qualified250 ?? 0) + 1;
      if (stat && trade.amountUsd >= 500) stat.qualified500 = (stat.qualified500 ?? 0) + 1;
    }
    for (const token of tokens) {
      const stat = perToken.get(`${token.chain}:${token.contract}`);
      if (stat) {
        stat.below250 = Math.max(0, stat.confirmed - (stat.qualified250 ?? 0));
        stat.below500 = Math.max(0, stat.confirmed - (stat.qualified500 ?? 0));
      }
    }
    const allWallets = runAggregations(confirmed);
    const thresholdCombinations = (layer) => new Map(layer.wallets.flatMap((wallet) => wallet.tokens.map((item) => {
      const key = `${wallet.wallet}:${item.chain}:${item.tokenContract}`;
      return [key, { firstBuyAt: item.firstBuyAt, lastBuyAt: item.lastBuyAt, buyCount: item.buyCount,
        totalUsdBought: item.totalUsdBought, leadTimeHours: (SNAPSHOT_AT - Date.parse(item.firstBuyAt)) / 3_600_000 }];
    })));
    const byThreshold250 = thresholdCombinations(layer250);
    const byThreshold500 = thresholdCombinations(layer500);
    const walletTokenCombinations = allWallets.flatMap((wallet) => wallet.tokens.map((item) => {
      const key = `${wallet.wallet}:${item.chain}:${item.tokenContract}`;
      const threshold250Stats = byThreshold250.get(key) ?? null;
      const threshold500Stats = byThreshold500.get(key) ?? null;
      return { wallet: wallet.wallet, token: item.tokenSymbol, chain: item.chain, contract: item.tokenContract,
        firstBuyAt: item.firstBuyAt, lastBuyAt: item.lastBuyAt, buyCount: item.buyCount, totalUsdBought: item.totalUsdBought,
        threshold250: Boolean(threshold250Stats), threshold500: Boolean(threshold500Stats),
        leadTimeHours: (SNAPSHOT_AT - Date.parse(item.firstBuyAt)) / 3_600_000,
        threshold250Stats, threshold500Stats };
    }));
    for (const token of tokens) {
      const stat = perToken.get(`${token.chain}:${token.contract}`);
      if (stat) {
        stat.uniqueWallets250 = new Set(layer250.trades.filter((trade) => trade.tokenContract === token.contract).map((trade) => trade.walletAddress)).size;
        stat.uniqueWallets500 = new Set(layer500.trades.filter((trade) => trade.tokenContract === token.contract).map((trade) => trade.walletAddress)).size;
      }
    }
    timing.aggregationMs = Date.now() - aggregationStart;
    timing.decodeAggregateMs = Date.now() - decoderStart;
    const validationStart = Date.now();
    const validation = await validateSamples(layer500.trades, confirmed, 10);
    printReport(tokens, perToken, [layer250, layer500]);
    console.log(`\nSAMPLE VALIDATION: ${validation.valid}/${validation.attempted} VALID; ${validation.invalid} INVALID; ${validation.uncertain} UNCERTAIN; success rate ${validation.successRate === null ? 'N/A' : `${(validation.successRate * 100).toFixed(1)}%`}${validation.attempted < 10 ? ' (méně než 10 dostupných trades; cíl 10 nedosažen)' : ''}`);
    diagnostics.validationMs = Date.now() - validationStart;
    timing.totalMs = Date.now() - clockStart;
    const tokenWalletSets = (layer) => layer.wallets.slice(0, 20).map((wallet) => ({ wallet: wallet.wallet, trendingTokensCount: wallet.trendingTokensCount,
      tokens: wallet.tokens.map((item) => item.tokenSymbol), totalUsdBought: wallet.totalUsdBought,
      firstBuyAt: wallet.earliestBuyAt, lastBuyAt: wallet.latestBuyAt, avgLeadTimeHours: wallet.averageLeadTimeHours }));
    const tokenSnapshot = tokens.map((item) => ({ rank: item.rank, id: item.id, name: item.name, symbol: item.symbol, chain: item.chain, contract: item.contract,
      pools: item.pools.map((pair) => ({ pairAddress: pair.pairAddress, dexId: pair.dexId, decoder: pair.decoder,
        liquidityUsd: Number(pair.liquidity?.usd), volume24hUsd: Number(pair.volume?.h24), quoteToken: pair.baseToken?.address?.toLowerCase() === item.contract ? pair.quoteToken : pair.baseToken })) }));
    const { uncertainCandidates, ...snapshotDiagnostics } = diagnostics;
    snapshotDiagnostics.uncertainCandidateCount = uncertainCandidates.length;
    await saveSnapshotArtifact({ schemaVersion: 1, snapshotAt: new Date(SNAPSHOT_AT).toISOString(), windowStart: new Date(WINDOW_START).toISOString(),
      windowEnd: new Date(WINDOW_END).toISOString(), tokens: tokenSnapshot, chains: [...new Set(tokens.map((item) => item.chain))],
      walletTokenCombinations, thresholds: {
        250: { buyCount: layer250.trades.length, uniqueWallets: layer250.uniqueWallets, intersectionCounts: intersectionCounts(layer250.wallets), topWallets: tokenWalletSets(layer250) },
        500: { buyCount: layer500.trades.length, uniqueWallets: layer500.uniqueWallets, intersectionCounts: intersectionCounts(layer500.wallets), topWallets: tokenWalletSets(layer500) },
      }, blockBounds: diagnostics.boundaries, diagnostics: snapshotDiagnostics, timing, dataVolume: { approximateSerializedBytes: diagnostics.bytes, responseBytes: diagnostics.responseBytes,
        swapResponseBytes: diagnostics.swapResponseBytes, transferResponseBytes: diagnostics.transferResponseBytes, metadataResponseBytes: diagnostics.metadataResponseBytes }, validation });
  } catch (error) {
    console.error(`PoC failed: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  } finally {
    timing.totalMs = Date.now() - clockStart;
    console.log('\nPERFORMANCE / COST');
    console.log(`CoinGecko discovery ${timing.coingeckoMs} ms | DEX Screener ${timing.dexMs} ms | block-range resolution ${timing.blockRangeResolutionMs} ms | Swap query ${timing.swapQueryMs} ms | Transfer query ${timing.transferQueryMs} ms | tx metadata ${timing.txMetadataMs} ms | pricing ${timing.pricingMs} ms | wallet resolution ${timing.walletResolutionMs} ms | aggregation ${timing.aggregationMs} ms | validation ${diagnostics.validationMs ?? 0} ms | total ${timing.totalMs} ms`);
    console.log(`HyperSync POST /query ${diagnostics.hypersyncQueries} | HTTP requests incl. /height ${diagnostics.hypersyncQueries + (diagnostics.httpRequests ?? 0)} | pages total ${diagnostics.responsePages} (Swap ${diagnostics.swapPages}, Transfer ${diagnostics.transferPages}, block metadata ${diagnostics.metadataPages}) | Swap logs ${diagnostics.swapEventsFetched} | Transfer logs ${diagnostics.transferLogsFetched} | transactions ${diagnostics.transactions} | response bytes ${diagnostics.responseBytes} | approximate in-memory dataset ${diagnostics.bytes}`);
    console.log(`Response bytes by phase: Swap ${diagnostics.swapResponseBytes}; Transfer+transaction metadata ${diagnostics.transferResponseBytes}; block metadata ${diagnostics.metadataResponseBytes}.`);
    console.log(`HyperSync server execution time (sum) ${diagnostics.hypersyncServerMs} ms`);
    console.log(`HyperSync endpoints: ${diagnostics.attemptedChains.map((chain) => `${chain} ${CHAINS[chain].url}/height and ${CHAINS[chain].url}/query`).join('; ') || 'none'}.`);
    console.log('HyperSync auth: HTTP Authorization: Bearer $ENVIO_API_TOKEN (secret value suppressed).');
    for (const [chain, bounds] of Object.entries(diagnostics.boundaries)) {
      console.log(`${chain} block window: fromBlock=${bounds.fromBlock}, toBlock=${bounds.toBlock} (exclusive), ${bounds.windowStart} <= timestamp < ${bounds.windowEndExclusive}`);
    }
    console.log(`ENVIO_API_TOKEN authentication: ${diagnostics.authVerified ? 'VERIFIED' : (process.env.ENVIO_API_TOKEN ? 'not verified (HyperSync query not successful)' : 'MISSING')}.`);
    const uncertaintyDenominator = diagnostics.confirmedBuys + diagnostics.unresolvedWalletTrades;
    console.log(`Wallet/flow uncertainty rate: ${uncertaintyDenominator ? `${(diagnostics.unresolvedWalletTrades / uncertaintyDenominator * 100).toFixed(1)}%` : 'N/A'} (${diagnostics.unresolvedWalletTrades}/${uncertaintyDenominator} classified candidates); unpriced rate ${diagnostics.candidateBuys ? `${(diagnostics.unpricedTrades / diagnostics.candidateBuys * 100).toFixed(1)}%` : 'N/A'} (${diagnostics.unpricedTrades}/${diagnostics.candidateBuys} candidates).`);
    console.log(`Services used: CoinGecko public API, official DEX Screener API${diagnostics.hypersyncQueries ? ', Envio HyperSync free plan (fair-use), Blockscout public read API for samples' : ''}.`);
    console.log(`Service cost: $0 paid-plan purchases; HyperSync usage ${diagnostics.hypersyncQueries ? 'occurred on the free/fair-use plan; billing impact NEOVĚŘENO' : (process.env.ENVIO_API_TOKEN ? 'none; live chain requests not reached' : 'none; ENVIO_API_TOKEN absent')}.`);
  }
}

async function saveSnapshotArtifact(result) {
  const directory = join(process.cwd(), 'tmp');
  await mkdir(directory, { recursive: true });
  const date = new Date(Date.parse(result.snapshotAt));
  const stamp = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}-${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}`;
  const path = join(directory, `trending-early-buyers-snapshot-${stamp}.json`);
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`Snapshot JSON saved to ${path} (no raw log dataset or API token included).`);
}

await main();
