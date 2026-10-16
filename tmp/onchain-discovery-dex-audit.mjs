import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const dir = 'tmp/onchain-discovery-2026-10-16T160211-275Z';
const report = JSON.parse(await readFile(`${dir}/report.json`, 'utf8'));
const targets = JSON.parse(await readFile(`${dir}/candidates.json`, 'utf8'));
const csv = await readFile(`${dir}/factory-pools.csv`, 'utf8');
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/); const parse = (line) => {
    const out = []; let value = ''; let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (c === '"' && quoted && line[i + 1] === '"') { value += '"'; i += 1; }
      else if (c === '"') quoted = !quoted;
      else if (c === ',' && !quoted) { out.push(value); value = ''; }
      else value += c;
    }
    out.push(value); return out;
  };
  const keys = parse(lines[0]); return lines.slice(1).map((line) => Object.fromEntries(parse(line).map((v, i) => [keys[i], v])));
}
const poolsByToken = new Map();
for (const pool of parseCsv(csv)) {
  const key = `${pool.chain}:${pool.target_contract.toLowerCase()}`;
  const rows = poolsByToken.get(key) ?? []; rows.push(pool); poolsByToken.set(key, rows);
}
const unresolved = targets.filter((x) => x.classification === 'UNKNOWN' && x.poolCount === 0);
const deterministic = (items) => [...items].sort((a, b) => createHash('sha256').update(`${a.chain}:${a.contract}`).digest('hex')
  .localeCompare(createHash('sha256').update(`${b.chain}:${b.contract}`).digest('hex')));
const bucketFor = (ageHours) => ageHours < 1 ? '<1h' : ageHours < 6 ? '1-6h' : ageHours < 24 ? '6-24h'
  : ageHours < 72 ? '1-3d' : '3-7d';
const mapped = unresolved.map((target) => {
    const chain = target.chain;
    const pools = (poolsByToken.get(`${chain}:${target.contract.toLowerCase()}`) ?? [])
      .sort((a, b) => Number(a.created_block) - Number(b.created_block));
    const pool = pools[0] ?? null;
    const ageHours = pool?.created_at ? Math.max(0, (Date.parse(report.detectionAt) - Date.parse(pool.created_at)) / 3_600_000) : null;
    return { chain, contract: target.contract.toLowerCase(), firstDetectedAt: target.firstDetectedAt,
      pool, poolCount: pools.length, ageHours, ageBucket: ageHours === null ? null : bucketFor(ageHours) };
  });
const ageBuckets = ['<1h', '1-6h', '6-24h', '1-3d', '3-7d'];
const sample = [];
for (const chain of ['ethereum', 'base']) {
  const chainRows = mapped.filter((x) => x.chain === chain); const chosen = new Map();
  for (const bucket of ageBuckets) {
    for (const item of deterministic(chainRows.filter((x) => x.ageBucket === bucket)).slice(0, 10)) chosen.set(item.contract, item);
  }
  for (const item of deterministic(chainRows.filter((x) => !chosen.has(x.contract)))) {
    if (chosen.size >= 50) break; chosen.set(item.contract, item);
  }
  if (chosen.size !== 50) throw new Error(`Expected 50 unresolved ${chain} targets, got ${chosen.size}.`);
  sample.push(...chosen.values());
}
if (sample.length !== 100 || sample.filter((x) => x.chain === 'ethereum').length !== 50 || sample.filter((x) => x.chain === 'base').length !== 50) {
  throw new Error(`Expected deterministic 50/50 sample; got ${sample.filter((x) => x.chain === 'ethereum').length}/${sample.filter((x) => x.chain === 'base').length}.`);
}
const request = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return JSON.parse(body);
};
const tokenPairsByTarget = new Map(); const tokenErrors = new Map();
for (const chain of ['ethereum', 'base']) {
  const list = sample.filter((x) => x.chain === chain);
  for (let i = 0; i < list.length; i += 30) {
    const chunk = list.slice(i, i + 30);
    try {
      const value = await request(`https://api.dexscreener.com/tokens/v1/${chain}/${chunk.map((x) => x.contract).join(',')}`);
      for (const item of chunk) tokenPairsByTarget.set(`${chain}:${item.contract}`, []);
      for (const pair of Array.isArray(value) ? value : Array.isArray(value?.pairs) ? value.pairs : []) {
        for (const address of [pair.baseToken?.address, pair.quoteToken?.address].map((x) => String(x ?? '').toLowerCase())) {
          const key = `${chain}:${address}`; if (tokenPairsByTarget.has(key)) tokenPairsByTarget.get(key).push(pair);
        }
      }
    } catch (error) { for (const item of chunk) tokenErrors.set(`${chain}:${item.contract}`, String(error.message)); }
    await new Promise((r) => setTimeout(r, 350));
  }
}
let cursor = 0; const directResults = new Map(); const errors = [];
const workers = Array.from({ length: 4 }, async () => {
  while (cursor < sample.length) {
    const item = sample[cursor++];
    if (!item.pool) { directResults.set(`${item.chain}:${item.contract}`, { error: 'missing factory pool row' }); continue; }
    try {
      const value = await request(`https://api.dexscreener.com/latest/dex/pairs/${item.chain}/${item.pool.pool_address}`);
      const pairs = Array.isArray(value?.pairs) ? value.pairs : [];
      directResults.set(`${item.chain}:${item.contract}`, { pairs, exact: pairs.some((pair) => pair.chainId === item.chain
        && String(pair.pairAddress ?? '').toLowerCase() === item.pool.pool_address.toLowerCase()) });
    } catch (error) { directResults.set(`${item.chain}:${item.contract}`, { error: String(error.message) }); errors.push({ key: `${item.chain}:${item.contract}`, error: String(error.message) }); }
  }
});
await Promise.all(workers);
const rows = sample.map((item) => {
  const key = `${item.chain}:${item.contract}`; const tokenPairs = tokenPairsByTarget.get(key) ?? [];
  const pairAddress = item.pool?.pool_address?.toLowerCase();
  const tokenExact = tokenPairs.some((pair) => pair.chainId === item.chain && String(pair.pairAddress ?? '').toLowerCase() === pairAddress);
  const direct = directResults.get(key) ?? { error: 'missing result' };
  const ageHours = item.ageHours;
  let category;
  if (tokenErrors.has(key) || direct.error) category = 'request_error';
  else if (tokenExact && direct.exact) category = 'token_and_direct_exact';
  else if (tokenExact) category = 'token_exact_direct_miss';
  else if (direct.exact) category = tokenPairs.length ? 'token_other_pairs_direct_exact' : 'direct_only_exact';
  else if (tokenPairs.length) category = 'token_pairs_without_sampled_pool';
  else category = 'neither_endpoint_finds_pool';
  return { ...item, tokenPairCount: tokenPairs.length, tokenEndpointExact: tokenExact,
    directExact: direct.exact ?? false, directPairCount: direct.pairs?.length ?? null, ageHours,
    ageBucket: item.ageBucket, category,
    tokenError: tokenErrors.get(key) ?? null, directError: direct.error ?? null };
});
const counts = Object.fromEntries([...new Set(rows.map((x) => x.category))].sort().map((category) => [category, rows.filter((x) => x.category === category).length]));
const byAge = Object.fromEntries(['<1h', '1-6h', '6-24h', '1-3d', '3-7d'].map((bucket) => {
  const group = rows.filter((x) => x.ageBucket === bucket); return [bucket, { n: group.length,
    tokenExact: group.filter((x) => x.tokenEndpointExact).length, tokenPairAny: group.filter((x) => x.tokenPairCount > 0).length,
    directExact: group.filter((x) => x.directExact).length,
    tokenExactRate: group.length ? group.filter((x) => x.tokenEndpointExact).length / group.length : null,
    directExactRate: group.length ? group.filter((x) => x.directExact).length / group.length : null }];
}));
const controls = {};
for (const chain of ['ethereum', 'base']) {
  const target = targets.find((x) => x.chain === chain && x.classification === 'NEW_TOKEN_CANDIDATE' && x.newPools.length);
  if (!target) { controls[chain] = { error: 'No active indexed control token in source run.' }; continue; }
  const pool = target.newPools[0];
  try {
    const [tokenValue, pairValue] = await Promise.all([
      request(`https://api.dexscreener.com/tokens/v1/${chain}/${target.contract}`),
      request(`https://api.dexscreener.com/latest/dex/pairs/${chain}/${pool.pairAddress}`),
    ]);
    const tokenPairs = Array.isArray(tokenValue) ? tokenValue : Array.isArray(tokenValue?.pairs) ? tokenValue.pairs : [];
    const pairRows = Array.isArray(pairValue?.pairs) ? pairValue.pairs : [];
    controls[chain] = { token: target.contract, pool: pool.pairAddress,
      tokenPairCount: tokenPairs.length,
      tokenExact: tokenPairs.some((pair) => String(pair.pairAddress ?? '').toLowerCase() === pool.pairAddress.toLowerCase()),
      directPairCount: pairRows.length,
      directExact: pairRows.some((pair) => pair.chainId === chain && String(pair.pairAddress ?? '').toLowerCase() === pool.pairAddress.toLowerCase()) };
  } catch (error) { controls[chain] = { error: String(error.message) }; }
}
const result = { auditAt: new Date().toISOString(), sourceRun: report.runId, sourceDetectionAt: report.detectionAt,
  officialEndpoints: { token: 'https://api.dexscreener.com/tokens/v1/{chainId}/{tokenAddresses}',
    directPool: 'https://api.dexscreener.com/latest/dex/pairs/{chainId}/{pairId}', documentation: 'https://docs.dexscreener.com/api/reference' },
  deterministicSample: { method: 'SHA-256(chain:contract), stratified by age bucket where possible, exactly 50 per chain', size: rows.length, ethereum: 50, base: 50 },
  unresolvedAgeUniverse: Object.fromEntries(ageBuckets.map((bucket) => [bucket, Object.fromEntries(['ethereum', 'base'].map((chain) => [chain,
    mapped.filter((x) => x.chain === chain && x.ageBucket === bucket).length]))])),
  controls, counts, totals: { tokenExact: rows.filter((x) => x.tokenEndpointExact).length,
    tokenPairsAny: rows.filter((x) => x.tokenPairCount > 0).length, directExact: rows.filter((x) => x.directExact).length,
    errors: errors.length, tokenBatchErrors: tokenErrors.size }, byAge, errors, rows };
await writeFile('tmp/onchain-discovery-dex-audit.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, rows: rows.map(({ chain, contract, pool, poolCount, tokenPairCount, tokenEndpointExact,
  directExact, ageHours, ageBucket, category, tokenError, directError }) => ({ chain, contract, pool: pool?.pool_address ?? null,
  poolCount, tokenPairCount, tokenEndpointExact, directExact, ageHours, ageBucket, category, tokenError, directError })) }, null, 2));
