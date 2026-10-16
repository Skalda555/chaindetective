import '../server/load-env.mjs';
import { DatabaseSync } from 'node:sqlite';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseAbiItem, toEventSelector } from 'viem';
import {
  CHAINS, FACTORY_ABIS, QUALITY_PROFILES, applyQualityProfile, classifyQuotePair, decodeFactoryLog,
  normalizeDexPair, uniqueTargets,
} from './onchain-discovery-core.mjs';
import {
  commitFactoryRange, CONFIG_DEFAULTS, createPilotSchema, floorTimeBucket, initializePilotMeta, migratePilotConfig,
  migratePilotMetaConfig, quantile, seedFactoryCursor, upsertGeckoTrendingObservation, upsertTokenObservation,
  upsertTrendingObservation, withTransaction,
} from './onchain-discovery-longitudinal-store.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = resolve(ROOT, 'tmp', 'onchain-discovery-longitudinal');
const DB_PATH = resolve(OUTPUT_DIR, 'pilot.sqlite');
const CONFIG_PATH = resolve(OUTPUT_DIR, 'config.json');
const REPORT_PATH = resolve(OUTPUT_DIR, 'report.json');
const args = new Set(process.argv.slice(2));
const ONCE = args.has('--once'); const REPORT_ONLY = args.has('--report');
const DAY = 86_400_000;
const DEFAULT_CONFIG = CONFIG_DEFAULTS;
const GECKOTERMINAL_BASE = 'https://api.geckoterminal.com/api/v2';
const GECKOTERMINAL_NETWORKS = Object.freeze({ ethereum: 'eth', base: 'base' });
const GECKOTERMINAL_DURATIONS = Object.freeze(['5m', '1h']);
const SWAP_V2_TOPIC = toEventSelector(parseAbiItem('event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)')).toLowerCase();
const FACTORY_SELECTIONS = Object.entries(CHAINS).map(([chain, config]) => [chain, config.factories.map((factory) => ({
  address: [factory.address], topics: [[toEventSelector(FACTORY_ABIS[factory.family]).toLowerCase()]],
}))]);
const ADDRESS_RE = /^0x[\da-f]{40}$/i;

function nowIso() { return new Date().toISOString(); }
function log(message) { console.log(`[${nowIso()}] ${message}`); }
function delay(ms) { return new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }

async function requestJson(url, { method = 'GET', headers = {}, body, phase = 'api' } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(45_000) });
      const text = await response.text();
      if (response.ok) return { value: text ? JSON.parse(text) : null, response };
      if ((response.status !== 429 && response.status < 500) || attempt === 3) throw new Error(`${phase} HTTP ${response.status}: ${text.slice(0, 250)}`);
      const retry = Number(response.headers.get('retry-after')) * 1000 || Math.min(15_000, 1_000 * 2 ** attempt);
      await delay(retry);
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      await delay(Math.min(10_000, 1_000 * 2 ** attempt));
    }
  }
  throw lastError ?? new Error(`${phase} request failed.`);
}

async function hyperRequest(chain, query) {
  if (!process.env.ENVIO_API_TOKEN) throw new Error('ENVIO_API_TOKEN is missing.');
  const endpoint = `${CHAINS[chain].hypersync}/query`;
  const { value } = await requestJson(endpoint, { method: 'POST', headers: {
    Authorization: `Bearer ${process.env.ENVIO_API_TOKEN}`, 'Content-Type': 'application/json',
  }, body: JSON.stringify(query), phase: `HyperSync ${chain}` });
  const data = Array.isArray(value.data) ? value.data : [value.data ?? {}];
  return { raw: value, logs: data.flatMap((item) => item.logs ?? []), blocks: data.flatMap((item) => item.blocks ?? []) };
}

async function chainHeight(chain) {
  const { value } = await requestJson(`${CHAINS[chain].hypersync}/height`, { headers: {
    Authorization: `Bearer ${process.env.ENVIO_API_TOKEN}`,
  }, phase: `HyperSync ${chain} height` });
  const height = Number(value?.height);
  if (!Number.isSafeInteger(height) || height < 0) throw new Error(`Invalid ${chain} HyperSync height response.`);
  return height;
}

function errorRow(db, phase, error, chain = null) {
  const message = String(error?.message ?? error).slice(0, 1000);
  db.prepare('INSERT INTO pilot_errors(occurred_at,phase,chain,message) VALUES(?,?,?,?)').run(nowIso(), phase, chain, message);
  log(`${phase}${chain ? ` (${chain})` : ''} failed: ${message}`);
}

function poolTarget(pool) {
  const result = classifyQuotePair(pool.chain, pool.token0, pool.token1);
  return { ...pool, target_contract: result.targetContract, quote_contract: result.quoteContract,
    quote_classification: result.classification };
}

async function fetchFactoryLogs(chain, fromBlock, toBlock) {
  const config = CHAINS[chain]; const logs = [];
  const selections = FACTORY_SELECTIONS.find(([name]) => name === chain)[1];
  let cursor = fromBlock;
  while (cursor < toBlock) {
    const response = await hyperRequest(chain, { from_block: cursor, to_block: toBlock, logs: selections,
      field_selection: { log: ['address','topic0','topic1','topic2','topic3','data','block_number','log_index'] },
      join_mode: 'JoinNothing', max_num_logs: 50_000 });
    logs.push(...response.logs);
    const next = Number(response.raw.next_block);
    if (!Number.isSafeInteger(next) || next <= cursor || next > toBlock) throw new Error(`Factory pagination invalid for ${chain} at ${cursor}.`);
    cursor = next;
  }
  return { logs, config };
}

async function fetchBlockTimestamps(chain, logs) {
  if (!logs.length) return new Map();
  const blocks = logs.map((log) => Number(log.block_number ?? log.blockNumber)).filter(Number.isSafeInteger);
  const from = Math.min(...blocks); const to = Math.max(...blocks) + 1; const result = new Map(); let cursor = from;
  while (cursor < to) {
    const response = await hyperRequest(chain, { from_block: cursor, to_block: to, blocks: [{}], include_all_blocks: true,
      field_selection: { block: ['number','timestamp'] }, join_mode: 'JoinNothing', max_num_blocks: 50_000 });
    for (const block of response.blocks) result.set(Number(block.number ?? block.block_number), Number(block.timestamp));
    const next = Number(response.raw.next_block);
    if (!Number.isSafeInteger(next) || next <= cursor || next > to) throw new Error(`Timestamp pagination invalid for ${chain} at ${cursor}.`);
    cursor = next;
  }
  return result;
}

async function scanFactoryChain(db, chain) {
  const height = await chainHeight(chain);
  const fromBlock = seedFactoryCursor(db, chain, height);
  if (height <= fromBlock) return { chain, fromBlock, toBlock: height, newPools: 0, seeded: true };
  const { logs } = await fetchFactoryLogs(chain, fromBlock, height);
  const timestamps = await fetchBlockTimestamps(chain, logs);
  const decoded = [];
  for (const logItem of logs) {
    const parsed = decodeFactoryLog({ ...logItem, block_number: Number(logItem.block_number ?? logItem.blockNumber),
      topics: logItem.topics ?? [logItem.topic0,logItem.topic1,logItem.topic2,logItem.topic3].filter(Boolean) }, chain, timestamps);
    if (parsed.event?.created_at) decoded.push(poolTarget(parsed.event));
  }
  commitFactoryRange(db, { chain, expectedFromBlock: fromBlock, toBlock: height, pools: decoded, now: nowIso() });
  return { chain, fromBlock, toBlock: height, newPools: decoded.length, seeded: false };
}

function tokenRows(db) {
  return db.prepare('SELECT * FROM tokens ORDER BY chain,contract').all();
}

function observationsBucket(now, interval) { return floorTimeBucket(now, interval); }

function pollTimestamp(db, key) {
  return db.prepare('SELECT value FROM pilot_meta WHERE key=?').get(`lastPoll:${key}`)?.value ?? null;
}

function pollDue(db, key, nowMs, interval) {
  const last = pollTimestamp(db, key);
  return !last || nowMs - Date.parse(last) >= interval;
}

function recordPoll(db, key, observedAt) {
  db.prepare(`INSERT INTO pilot_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .run(`lastPoll:${key}`, observedAt);
}

function recordGeckoFirstSeen(db, row) {
  if (!row.targetContract) return;
  const column = row.duration === '5m' ? 'first_gt_trending_5m_at' : 'first_gt_trending_1h_at';
  if (!GECKOTERMINAL_DURATIONS.includes(row.duration)) throw new Error('Unsupported GeckoTerminal duration.');
  db.prepare(`UPDATE tokens SET ${column}=CASE WHEN ${column} IS NULL OR ${column}>? THEN ? ELSE ${column} END WHERE chain=? AND contract=?`)
    .run(row.observedAt, row.observedAt, row.chain, row.targetContract);
}

function geckoTokenAddress(id, networkId) {
  const match = String(id ?? '').match(/^([a-z0-9]+)_(0x[\da-f]{40})$/i);
  return match && match[1] === networkId ? match[2].toLowerCase() : null;
}

function finiteMetric(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeGeckoTrending(payload, chain, duration, observedAt) {
  const networkId = GECKOTERMINAL_NETWORKS[chain];
  if (!networkId || !GECKOTERMINAL_DURATIONS.includes(duration)) throw new Error('Unsupported GeckoTerminal network or duration.');
  if (!Array.isArray(payload?.data)) throw new Error('Invalid GeckoTerminal response: expected JSON:API data array.');
  const included = new Map((payload.included ?? []).filter((item) => item?.type === 'token')
    .map((item) => [item.id, item.attributes ?? {}]));
  const rows = [];
  for (const [index, pool] of payload.data.entries()) {
    const attr = pool?.attributes ?? {};
    const rel = pool?.relationships ?? {};
    const baseRef = rel.base_token?.data;
    const quoteRef = rel.quote_token?.data;
    const baseAddress = geckoTokenAddress(baseRef?.id, networkId);
    const quoteAddress = geckoTokenAddress(quoteRef?.id, networkId);
    const poolAddress = String(attr.address ?? pool?.id?.slice(networkId.length + 1) ?? '').toLowerCase();
    if (!ADDRESS_RE.test(poolAddress) || !baseAddress || !quoteAddress || baseAddress === quoteAddress) continue;
    const quote = classifyQuotePair(chain, baseAddress, quoteAddress);
    const baseInfo = included.get(baseRef.id) ?? {};
    const quoteInfo = included.get(quoteRef.id) ?? {};
    rows.push({ observedAt, chain, duration, rank: index + 1, poolAddress,
      targetContract: quote.classification === 'KNOWN_QUOTE' ? quote.targetContract : null,
      baseTokenAddress: baseAddress, quoteTokenAddress: quoteAddress,
      baseTokenSymbol: baseInfo.symbol ?? null, baseTokenName: baseInfo.name ?? null,
      quoteTokenSymbol: quoteInfo.symbol ?? null, quoteTokenName: quoteInfo.name ?? null,
      poolCreatedAt: attr.pool_created_at && Number.isFinite(Date.parse(attr.pool_created_at)) ? new Date(attr.pool_created_at).toISOString() : null,
      reserveInUsd: finiteMetric(attr.reserve_in_usd), marketCapUsd: finiteMetric(attr.market_cap_usd), fdvUsd: finiteMetric(attr.fdv_usd),
      volume: attr.volume_usd ?? null, transactions: attr.transactions ?? null, quoteClassification: quote.classification });
  }
  return rows;
}

async function pollGeckoTerminal(db, nowMs, config) {
  const result = { checked: 0, pools: 0, canonicalTargets: 0, observations: [] };
  const observedAt = observationsBucket(nowMs, config.geckoterminalPollMs);
  for (const chain of Object.keys(GECKOTERMINAL_NETWORKS)) {
    for (const duration of GECKOTERMINAL_DURATIONS) {
      const key = `geckoterminal:${chain}:${duration}`;
      if (!pollDue(db, key, nowMs, config.geckoterminalPollMs)) continue;
      try {
        const network = GECKOTERMINAL_NETWORKS[chain];
        const url = `${GECKOTERMINAL_BASE}/networks/${network}/trending_pools?duration=${duration}&include=base_token%2Cquote_token`;
        const { value } = await requestJson(url, { headers: { accept: 'application/json' }, phase: `GeckoTerminal ${chain} ${duration}` });
        const rows = normalizeGeckoTrending(value, chain, duration, observedAt);
        withTransaction(db, () => {
          for (const row of rows) {
            upsertGeckoTrendingObservation(db, row);
            recordGeckoFirstSeen(db, row);
          }
          recordPoll(db, key, observedAt);
        });
        result.checked += 1; result.pools += rows.length; result.canonicalTargets += rows.filter((row) => row.targetContract).length;
        result.observations.push({ chain, duration, count: rows.length });
      } catch (error) {
        result.errors ??= [];
        result.errors.push({ chain, duration, message: String(error?.message ?? error).slice(0, 250) });
        errorRow(db, `geckoterminal-${duration}`, error, chain);
      }
      await delay(500);
    }
  }
  return result;
}

function dexApiError(db, chain, contract, error) {
  db.prepare('UPDATE tokens SET dex_retry_after=? WHERE chain=? AND contract=?').run(new Date(Date.now() + 5 * 60_000).toISOString(), chain, contract);
  errorRow(db, 'dex-enrichment', error, chain);
}

function saveDexToken(db, token, pairs, poolRows, observedAt) {
  const address = token.contract.toLowerCase();
  const tokenPairs = pairs.filter((pair) => pair.chainId === token.chain &&
    [pair.baseToken?.address, pair.quoteToken?.address].some((value) => String(value ?? '').toLowerCase() === address));
  const poolByAddress = new Map(poolRows.map((pool) => [pool.pool_address.toLowerCase(), pool]));
  const exact = tokenPairs.filter((pair) => poolByAddress.has(String(pair.pairAddress ?? '').toLowerCase()));
  const oldestDexCreated = tokenPairs.map((pair) => Number(pair.pairCreatedAt)).filter(Number.isFinite).sort((a, b) => a - b)[0] ?? null;
  const oldestOnchain = Date.parse(token.oldest_pool_created_at);
  const oldToken = oldestDexCreated !== null && oldestDexCreated < oldestOnchain - 60_000;
  const classification = !tokenPairs.length ? 'UNKNOWN' : oldToken ? 'NEW_POOL_OLD_TOKEN' : exact.length ? 'NEW_TOKEN_CANDIDATE' : 'UNKNOWN';
  const normalized = exact.map((pair) => {
    const pool = poolByAddress.get(String(pair.pairAddress).toLowerCase());
    return { ...normalizeDexPair(pair, token.chain, Date.parse(observedAt)), onchainCreatedAt: pool.created_at,
      dexFamily: pool.dex_family, targetContract: address, quoteContract: pool.quote_contract,
      decoder: pool.dex_family };
  });
  const primary = [...normalized].sort((a, b) => (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1))[0] ?? null;
  const quality = Object.fromEntries(Object.entries(QUALITY_PROFILES).map(([name, profile]) => [name,
    Boolean(primary && applyQualityProfile({ chain: token.chain, newPools: normalized }, profile))]));
  const rawPairByAddress = new Map(exact.map((pair) => [String(pair.pairAddress).toLowerCase(), pair]));
  const primaryRaw = primary ? rawPairByAddress.get(primary.pairAddress) : null;
  const primaryPool = primary ? poolByAddress.get(String(primary.pairAddress).toLowerCase()) : null;
  const serialize = primaryRaw ? JSON.stringify(primaryRaw) : null;
  db.prepare(`UPDATE tokens SET dex_checked_at=?,dex_retry_after=NULL,dex_resolved=?,classification=?,primary_pool_address=?,primary_factory=?,
    primary_dex_family=?,pool_created_at=?,pair_json=?,pairs_json=?,quality_json=?
    WHERE chain=? AND contract=?`).run(observedAt, tokenPairs.length ? 1 : 0, classification, primary?.pairAddress ?? null,
    primaryPool?.factory ?? null, primaryPool?.dex_family ?? null,
    primaryPool?.created_at ?? (primary?.pairCreatedAt ? new Date(primary.pairCreatedAt).toISOString() : null),
    serialize, JSON.stringify(tokenPairs), JSON.stringify(quality), token.chain, address);
  const firstCg = token.first_cg_trending_at ?? null;
  const lead = firstCg ? (Date.parse(firstCg) - Date.parse(token.first_detected_at)) / 3_600_000 : null;
  upsertTokenObservation(db, { chain: token.chain, contract: address, observedAt, primaryPoolAddress: primary?.pairAddress ?? null,
    classification, priceUsd: primary?.priceUsd, liquidityUsd: primary?.liquidityUsd, marketCapUsd: primary?.marketCapUsd,
    fdvUsd: primary?.fdvUsd, volumeH1Usd: primary?.volumeH1Usd, volumeH6Usd: primary?.volumeH6Usd, volumeH24Usd: primary?.volumeH24Usd,
    buysH1: primary?.buysH1, sellsH1: primary?.sellsH1, buysH6: primary?.buysH6, sellsH6: primary?.sellsH6,
    buysH24: primary?.buysH24, sellsH24: primary?.sellsH24, qualityJson: JSON.stringify(quality),
    volAccelRatio: primary?.volAccelRatio, firstCgTrendingAt: firstCg, leadTimeHours: lead });
  return { tokenPairs: tokenPairs.length, exactPools: normalized.length, quality, normalized, primary };
}

async function enrichDueTokens(db, nowMs, config) {
  const due = tokenRows(db).filter((token) => !token.dex_checked_at || Date.parse(token.dex_checked_at) <= nowMs - config.dexRetryMs)
    .filter((token) => !token.dex_retry_after || Date.parse(token.dex_retry_after) <= nowMs);
  const observedAt = observationsBucket(nowMs, config.dexRetryMs);
  let resolved = 0; let exactPools = 0;
  for (const chain of ['ethereum', 'base']) {
    const group = due.filter((token) => token.chain === chain);
    for (let index = 0; index < group.length; index += config.dexBatchSize) {
      const chunk = group.slice(index, index + config.dexBatchSize);
      try {
        const { value } = await requestJson(`https://api.dexscreener.com/tokens/v1/${chain}/${chunk.map((token) => token.contract).join(',')}`, { phase: 'DEX Screener token lookup' });
        const pairs = Array.isArray(value) ? value : Array.isArray(value?.pairs) ? value.pairs : [];
        for (const token of chunk) {
          const poolRows = db.prepare('SELECT * FROM factory_pools WHERE chain=? AND target_contract=? ORDER BY created_block,pool_address')
            .all(chain, token.contract.toLowerCase());
          const result = saveDexToken(db, token, pairs, poolRows, observedAt);
          if (result.tokenPairs) resolved += 1; exactPools += result.exactPools;
        }
        await delay(350);
      } catch (error) { for (const token of chunk) dexApiError(db, chain, token.contract, error); }
    }
  }
  return { checked: due.length, resolved, exactPools, observedAt };
}

let coinListCache = null; let coinListFetchedAt = 0;
async function getCoinList(nowMs) {
  if (coinListCache && nowMs - coinListFetchedAt < 6 * 60 * 60_000) return coinListCache;
  const { value } = await requestJson('https://api.coingecko.com/api/v3/coins/list?include_platform=true', { phase: 'CoinGecko coin list' });
  coinListCache = new Map((Array.isArray(value) ? value : []).map((coin) => [coin.id, coin.platforms ?? {}]));
  coinListFetchedAt = nowMs; return coinListCache;
}

async function pollCoinGecko(db, nowMs, config) {
  if (!pollDue(db, 'coingecko-search-trending', nowMs, config.coingeckoPollMs)) return { skipped: true, entries: 0, canonicalEntries: 0 };
  const [trendingResponse, coinList] = await Promise.all([
    requestJson('https://api.coingecko.com/api/v3/search/trending', { phase: 'CoinGecko trending' }), getCoinList(nowMs),
  ]);
  const observedAt = observationsBucket(nowMs, config.coingeckoPollMs);
  const mapping = { ethereum: 'ethereum', base: 'base' };
  const entries = (trendingResponse.value?.coins ?? []).slice(0, 15).map((record, index) => {
    const item = record.item ?? {}; const platforms = coinList.get(item.id) ?? {};
    const canonical = Object.entries(mapping).map(([chain, platform]) => ({ chain, contract: String(platforms[platform] ?? '').toLowerCase() }))
      .find(({ contract }) => ADDRESS_RE.test(contract));
    return { observedAt, rank: index + 1, coinId: String(item.id ?? ''), symbol: String(item.symbol ?? ''),
      chain: canonical?.chain ?? null, contract: canonical?.contract ?? null };
  }).filter((row) => row.coinId);
  withTransaction(db, () => {
    for (const row of entries) {
      upsertTrendingObservation(db, row);
      if (!row.chain || !row.contract) continue;
      db.prepare(`UPDATE tokens SET first_cg_trending_at=CASE WHEN first_cg_trending_at IS NULL OR first_cg_trending_at>? THEN ? ELSE first_cg_trending_at END
        WHERE chain=? AND contract=?`).run(observedAt, observedAt, row.chain, row.contract);
      const token = db.prepare('SELECT first_detected_at,first_cg_trending_at FROM tokens WHERE chain=? AND contract=?').get(row.chain, row.contract);
      const lead = token?.first_cg_trending_at ? (Date.parse(token.first_cg_trending_at) - Date.parse(token.first_detected_at)) / 3_600_000 : null;
      db.prepare('UPDATE token_observations SET first_cg_trending_at=?,lead_time_hours=? WHERE chain=? AND contract=?')
        .run(token?.first_cg_trending_at ?? null, lead, row.chain, row.contract);
    }
    recordPoll(db, 'coingecko-search-trending', observedAt);
  });
  return { observedAt, entries: entries.length, canonicalEntries: entries.filter((row) => row.chain).length };
}

function eligibleResolverTokens(db, nowMs, config) {
  return tokenRows(db).filter((token) => token.dex_checked_at && token.pair_json && token.quality_json
    && JSON.parse(token.quality_json).LOOSE
    && (!token.canonical_checked_at || Date.parse(token.canonical_checked_at) <= nowMs - config.canonicalPollMs));
}

function makeReplay(db, tokens, snapshotAt) {
  return { snapshotAt, windowStart: new Date(Date.parse(snapshotAt) - 14 * DAY).toISOString(), windowEndExclusive: snapshotAt,
    tokens: tokens.map((token, index) => {
      const poolRows = db.prepare('SELECT * FROM factory_pools WHERE chain=? AND target_contract=? ORDER BY created_block,pool_address')
        .all(token.chain, token.contract);
      const pairs = JSON.parse(token.pairs_json ?? '[]'); const pairMap = new Map(pairs.map((pair) => [String(pair.pairAddress ?? '').toLowerCase(), pair]));
      const pools = poolRows.map((pool) => pairMap.get(pool.pool_address.toLowerCase()) && ({ pairAddress: pool.pool_address,
        decoder: pool.dex_family })).filter(Boolean).slice(0, 3);
      const pair = JSON.parse(token.pair_json);
      return { id: `onchain-${token.chain}-${token.contract}`, name: pair.baseToken?.symbol ?? token.contract,
        symbol: pair.baseToken?.symbol ?? token.contract.slice(2, 8), chain: token.chain, contract: token.contract,
        rank: index + 1, marketCapRank: null, firstDetectedAt: token.oldest_pool_created_at, detectionAt: snapshotAt, pools };
    }).filter((token) => token.pools.length),
  };
}

async function runResolver(db, nowMs, config) {
  const candidates = eligibleResolverTokens(db, nowMs, config).slice(0, config.maxCanonicalTokensPerCycle);
  if (!candidates.length) return { candidates: 0 };
  const snapshotAt = new Date(nowMs).toISOString(); const replay = makeReplay(db, candidates, snapshotAt);
  if (!replay.tokens.length) return { candidates: 0 };
  const replayPath = resolve(OUTPUT_DIR, 'resolver-input-current.json'); const outputPath = resolve(OUTPUT_DIR, 'resolver-result-current.json');
  const logPath = resolve(OUTPUT_DIR, 'resolver.log');
  await writeFile(replayPath, JSON.stringify(replay));
  const childArgs = [resolve(ROOT, 'scripts/onchain-discovery-longitudinal-resolver.mjs'), `--replay-artifact=${replayPath}`, `--output=${outputPath}`];
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, childArgs, { cwd: ROOT, env: process.env, windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = ''; child.stderr.on('data', (chunk) => { errors += chunk.toString().slice(-2000); });
    child.on('error', reject); child.on('close', (code) => code === 0 ? resolvePromise() : reject(new Error(`Canonical resolver exited ${code}: ${errors.slice(-1000)}`)));
  }).catch(async (error) => { await writeFile(logPath, `${nowIso()} ${error.stack ?? error}\n`, { flag: 'a' }); throw error; });
  const result = JSON.parse(await readFile(outputPath, 'utf8'));
  const observedAt = observationsBucket(nowMs, config.canonicalPollMs);
  const update = db.prepare(`UPDATE token_observations SET unique_buyers_250=?,unique_buyers_500=?,smart_wallet_overlap_250=?,smart_wallet_overlap_500=?,
    historical_hit_overlap_250=?,historical_hit_overlap_500=? WHERE chain=? AND contract=? AND observed_at=?`);
  const updateToken = db.prepare('UPDATE tokens SET canonical_checked_at=? WHERE chain=? AND contract=?');
  withTransaction(db, () => {
    for (const row of result.perToken) {
      db.prepare(`INSERT OR IGNORE INTO token_observations(chain,contract,observed_at,classification) VALUES(?,?,?,?)`)
        .run(row.chain, row.contract, observedAt, 'NEW_TOKEN_CANDIDATE');
      update.run(row.uniqueBuyers250, row.uniqueBuyers500, row.smartWalletOverlap250, row.smartWalletOverlap500,
        row.historicalHitOverlap250, row.historicalHitOverlap500, row.chain, row.contract, observedAt);
      updateToken.run(snapshotAt, row.chain, row.contract);
    }
  });
  return { candidates: result.perToken.length, observedAt, queries: result.diagnostics?.hypersyncQueries ?? null };
}

function profileTotals(db) {
  const latest = db.prepare(`SELECT t.chain,t.contract,t.first_detected_at,t.first_cg_trending_at,
      t.first_gt_trending_5m_at,t.first_gt_trending_1h_at,t.classification,t.dex_resolved,t.quality_json,
      o.unique_buyers_250,o.unique_buyers_500,o.smart_wallet_overlap_250,o.historical_hit_overlap_250
    FROM tokens t LEFT JOIN token_observations o ON o.chain=t.chain AND o.contract=t.contract AND o.observed_at=(
      SELECT MAX(o2.observed_at) FROM token_observations o2 WHERE o2.chain=t.chain AND o2.contract=t.contract)` ).all();
  const count = (predicate) => latest.filter(predicate).length;
  return { tokenTargets: latest.length, dexResolved: count((row) => row.dex_resolved === 1),
    loose: count((row) => row.quality_json && JSON.parse(row.quality_json).LOOSE),
    balanced: count((row) => row.quality_json && JSON.parse(row.quality_json).BALANCED),
    strict: count((row) => row.quality_json && JSON.parse(row.quality_json).STRICT),
    canonicalConfirmed: count((row) => Number(row.unique_buyers_250) > 0),
    smartOverlap: count((row) => Number(row.smart_wallet_overlap_250) > 0),
    historicalOverlap: count((row) => Number(row.historical_hit_overlap_250) > 0),
    rows: latest };
}

function summarizeBenchmark(rows, field, bucketMs) {
  const matched = rows.filter((row) => row[field] && Number.isFinite(Date.parse(row[field])));
  const leads = matched.map((row) => (Date.parse(row[field]) - Date.parse(row.first_detected_at)) / 3_600_000);
  let chainDetectiveEarlierCount = 0; let sameBucketCount = 0; let externalEarlierCount = 0;
  for (const row of matched) {
    const externalMs = Date.parse(row[field]); const detectedMs = Date.parse(row.first_detected_at);
    if (Math.floor(externalMs / bucketMs) === Math.floor(detectedMs / bucketMs)) sameBucketCount += 1;
    else if (detectedMs < externalMs) chainDetectiveEarlierCount += 1;
    else externalEarlierCount += 1;
  }
  return { candidateMatches: matched.length, nLeadTimeObservations: leads.length,
    min: leads.length ? Math.min(...leads) : null, p25: quantile(leads, 0.25), median: quantile(leads, 0.5),
    p75: quantile(leads, 0.75), max: leads.length ? Math.max(...leads) : null,
    chainDetectiveEarlierCount, sameBucketCount, externalSourceEarlierCount: externalEarlierCount };
}

function makeReport(db, meta) {
  const rawPools = Number(db.prepare('SELECT COUNT(*) AS n FROM factory_pools').get().n);
  const overview = profileTotals(db); const trending = db.prepare('SELECT * FROM coingecko_trending_observations ORDER BY observed_at,rank').all();
  const identities = new Set(trending.filter((row) => row.chain && row.contract).map((row) => `${row.chain}:${row.contract}`));
  const found = overview.rows.filter((row) => identities.has(`${row.chain}:${row.contract}`));
  const leadTimes = found.map((row) => {
    const first = db.prepare('SELECT MIN(observed_at) AS at FROM coingecko_trending_observations WHERE chain=? AND contract=?')
      .get(row.chain, row.contract).at;
    return first ? (Date.parse(first) - Date.parse(row.first_detected_at)) / 3_600_000 : null;
  }).filter(Number.isFinite);
  const sourceBenchmarks = {
    chainDetective: { role: 'PRIMARY ON-CHAIN DISCOVERY', candidateMatches: overview.tokenTargets },
    geckoTerminalTrending5m: { role: 'DEX ATTENTION BENCHMARK', ...summarizeBenchmark(overview.rows, 'first_gt_trending_5m_at', configInterval(meta.config.geckoterminalPollMs, 5 * 60_000)) },
    geckoTerminalTrending1h: { role: 'DEX ATTENTION BENCHMARK', ...summarizeBenchmark(overview.rows, 'first_gt_trending_1h_at', configInterval(meta.config.geckoterminalPollMs, 5 * 60_000)) },
    coingeckoSearchTrending: { role: 'RETAIL / MARKET ATTENTION BENCHMARK', ...summarizeBenchmark(overview.rows, 'first_cg_trending_at', configInterval(meta.config.coingeckoPollMs, 60 * 60_000)) },
  };
  const byDay = db.prepare(`SELECT substr(first_detected_at,1,10) AS day,COUNT(*) AS candidates,
      SUM(CASE WHEN classification='NEW_TOKEN_CANDIDATE' THEN 1 ELSE 0 END) AS dexCandidates
    FROM tokens GROUP BY day ORDER BY day`).all();
  const survival = {};
  for (const hours of [24, 168, 336]) {
    const measured = [];
    for (const token of overview.rows) {
      const target = Date.parse(token.first_detected_at) + hours * 3_600_000;
      const row = db.prepare(`SELECT liquidity_usd,price_usd,observed_at FROM token_observations WHERE chain=? AND contract=?
        AND observed_at>=? AND observed_at<=? ORDER BY observed_at LIMIT 1`).get(token.chain, token.contract,
        new Date(target).toISOString(), new Date(target + configInterval(meta.config.dexRetryMs)).toISOString());
      if (!row) continue;
      const first = db.prepare('SELECT price_usd FROM token_observations WHERE chain=? AND contract=? ORDER BY observed_at LIMIT 1')
        .get(token.chain, token.contract);
      const initialPrice = Number(first?.price_usd); const laterPrice = Number(row.price_usd);
      measured.push({ ...row, priceChangePct: Number.isFinite(initialPrice) && initialPrice > 0 && Number.isFinite(laterPrice)
        ? (laterPrice / initialPrice - 1) * 100 : NaN });
    }
    survival[`${hours}h`] = { eligible: measured.length,
      liquiditySurvivors: measured.filter((row) => Number(row.liquidity_usd) > 0).length,
      medianPriceChangePct: quantile(measured.map((row) => row.priceChangePct), 0.5) };
  }
  return { generatedAt: nowIso(), pilot: meta, storage: { database: DB_PATH, productionDatabaseWritten: false },
    rawPools, dex: { canonicalTargets: overview.tokenTargets, resolvedTargets: overview.dexResolved,
      coverageRate: overview.tokenTargets ? overview.dexResolved / overview.tokenTargets : null },
    qualityFunnel: { dexResolved: overview.dexResolved, loose: overview.loose, balanced: overview.balanced, strict: overview.strict },
    candidatesPerDay: byDay.map((row) => ({ day: row.day, candidates: row.candidates, dexCandidates: row.dexCandidates })),
    confirmedCandidatesPerDay: byDay.map((day) => ({ day: day.day,
      confirmed: overview.rows.filter((row) => row.first_detected_at.startsWith(day.day) && Number(row.unique_buyers_250) > 0).length })),
    smartWalletOverlapTokens: overview.smartOverlap, historicalHitOverlapTokens: overview.historicalOverlap,
    attentionSources: { chainDetectiveRole: 'PRIMARY ON-CHAIN DISCOVERY', geckoTerminalRole: 'DEX ATTENTION BENCHMARK',
      coingeckoRole: 'RETAIL / MARKET ATTENTION BENCHMARK', geckoTerminalObservations: Number(db.prepare('SELECT COUNT(*) AS n FROM geckoterminal_trending_observations').get().n),
      coingeckoSearchTrending: { observations: trending.length, canonicalIdentities: identities.size,
        candidateMatches: found.length, recall: identities.size ? found.length / identities.size : null } },
    sourceBenchmarks,
    leadTimeHours: { n: leadTimes.length, min: leadTimes.length ? Math.min(...leadTimes) : null,
      p25: quantile(leadTimes, 0.25), median: quantile(leadTimes, 0.5), p75: quantile(leadTimes, 0.75),
      max: leadTimes.length ? Math.max(...leadTimes) : null },
    survival, priceOutcomesAreDiagnosticOnly: true,
    errors: db.prepare('SELECT occurred_at,phase,chain,message FROM pilot_errors ORDER BY id DESC LIMIT 100').all() };
}

function configInterval(value, fallback = DEFAULT_CONFIG.dexRetryMs) { return Number.isSafeInteger(value) && value > 0 ? value : fallback; }

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function setup() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const databaseExists = await fileExists(DB_PATH);
  if (!databaseExists && !args.has('--init')) {
    throw new Error(`No existing pilot database at ${DB_PATH}. Refusing to create a new pilot. Use --init only to intentionally initialize a new pilot.`);
  }
  let diskConfig = DEFAULT_CONFIG;
  if (await fileExists(CONFIG_PATH)) {
    try { diskConfig = migratePilotConfig(JSON.parse(await readFile(CONFIG_PATH, 'utf8'))); }
    catch (error) {
      if (!databaseExists) throw new Error(`Invalid pilot config ${CONFIG_PATH}: ${error.message}`);
      diskConfig = DEFAULT_CONFIG;
    }
  }
  const db = new DatabaseSync(DB_PATH); createPilotSchema(db);
  const startedAtRow = db.prepare("SELECT value FROM pilot_meta WHERE key='startedAt'").get();
  if (databaseExists && !startedAtRow && !args.has('--init')) {
    db.close();
    throw new Error(`Pilot database exists but has no startedAt metadata at ${DB_PATH}. Refusing to initialize it without --init.`);
  }
  const proposedStart = nowIso(); const meta = initializePilotMeta(db, { startedAt: proposedStart,
    endsAt: new Date(Date.parse(proposedStart) + diskConfig.durationDays * DAY).toISOString(), configJson: JSON.stringify(diskConfig) });
  const config = migratePilotMetaConfig(db, diskConfig);
  const stableMeta = { ...meta, config };
  const configTemp = `${CONFIG_PATH}.tmp`;
  await writeFile(configTemp, `${JSON.stringify(config, null, 2)}\n`);
  await rename(configTemp, CONFIG_PATH);
  return { db, config, meta: stableMeta };
}

async function reportExistingPilot() {
  await access(DB_PATH);
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const get = db.prepare('SELECT value FROM pilot_meta WHERE key=?');
    const meta = { startedAt: get.get('startedAt')?.value, endsAt: get.get('endsAt')?.value,
      config: JSON.parse(get.get('config')?.value ?? '{}') };
    if (!meta.startedAt || !meta.endsAt) throw new Error('Existing pilot database has incomplete metadata.');
    const report = makeReport(db, meta);
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally { db.close(); }
}

async function oneCycle(db, config) {
  const nowMs = Date.now();
  const factory = [];
  for (const chain of ['ethereum', 'base']) {
    try { factory.push(await scanFactoryChain(db, chain)); }
    catch (error) { errorRow(db, 'factory-scan', error, chain); }
  }
  let dex = { checked: 0, resolved: 0, exactPools: 0 };
  try { dex = await enrichDueTokens(db, nowMs, config); } catch (error) { errorRow(db, 'dex-enrichment', error); }
  let cg = { entries: 0, canonicalEntries: 0 };
  try { cg = await pollCoinGecko(db, nowMs, config); } catch (error) { errorRow(db, 'coingecko-trending', error); }
  let gt = { checked: 0, pools: 0, canonicalTargets: 0, observations: [] };
  try { gt = await pollGeckoTerminal(db, nowMs, config); } catch (error) { errorRow(db, 'geckoterminal-trending', error); }
  let canonical = { candidates: 0 };
  try { canonical = await runResolver(db, nowMs, config); } catch (error) { errorRow(db, 'canonical-resolver', error); }
  log(`cycle complete ${JSON.stringify({ factory, dex, cg, gt, canonical })}`);
  return { factory, dex, cg, gt, canonical };
}

async function main() {
  if (REPORT_ONLY) return reportExistingPilot();
  const { db, config, meta } = await setup();
  try {
    if (!process.env.ENVIO_API_TOKEN) throw new Error('ENVIO_API_TOKEN is required for the longitudinal worker.');
    log(`14-day isolated discovery pilot started=${meta.startedAt} ends=${meta.endsAt} database=${DB_PATH}`);
    do {
      await oneCycle(db, config);
      if (ONCE || Date.now() >= Date.parse(meta.endsAt)) break;
      await delay(config.factoryPollMs);
    } while (Date.now() < Date.parse(meta.endsAt));
    if (!ONCE) {
      const report = makeReport(db, meta); await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
      log(`14-day pilot ended; report=${REPORT_PATH}`);
    }
  } finally { db.close(); }
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\','/')}` || process.argv[1]?.endsWith('onchain-discovery-longitudinal.mjs')) {
  main().catch((error) => { console.error(error.stack ?? error); process.exitCode = 1; });
}

export { makeReport, normalizeGeckoTrending, recordGeckoFirstSeen, saveDexToken, scanFactoryChain, summarizeBenchmark };
