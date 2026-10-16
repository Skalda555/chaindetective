import '../server/load-env.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { parseAbiItem, toEventSelector } from 'viem';

const audit = JSON.parse(await readFile('tmp/onchain-discovery-dex-audit.json', 'utf8'));
const source = JSON.parse(await readFile('tmp/onchain-discovery-2026-10-16T160211-275Z/report.json', 'utf8'));
const swapTopics = [
  toEventSelector(parseAbiItem('event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)')).toLowerCase(),
  toEventSelector(parseAbiItem('event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)')).toLowerCase(),
];
if (!process.env.ENVIO_API_TOKEN) throw new Error('ENVIO_API_TOKEN is missing.');
const rows = audit.rows.filter((row) => row.pool);
const results = [];
for (const chain of ['ethereum', 'base']) {
  const group = rows.filter((x) => x.chain === chain);
  const from = Math.min(...group.map((x) => Number(x.pool.created_block)));
  const to = Number(source.factoryCoverage.blockBounds[chain].toBlock);
  const address = chain === 'ethereum' ? 'https://eth.hypersync.xyz/query' : 'https://base.hypersync.xyz/query';
  let cursor = from; const logs = [];
  while (cursor < to) {
    const response = await fetch(address, { method: 'POST', headers: { Authorization: `Bearer ${process.env.ENVIO_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_block: cursor, to_block: to, logs: [{ address: group.map((x) => x.pool.pool_address), topics: [swapTopics] }],
        field_selection: { log: ['address', 'topic0', 'block_number', 'transaction_hash', 'log_index'] }, join_mode: 'JoinNothing', max_num_logs: 50_000 }) });
    const body = await response.text(); if (!response.ok) throw new Error(`${chain} HyperSync HTTP ${response.status}: ${body.slice(0, 300)}`);
    const page = JSON.parse(body); const batches = Array.isArray(page.data) ? page.data : [page.data ?? {}];
    for (const batch of batches) logs.push(...(batch.logs ?? []));
    const next = Number(page.next_block); if (!Number.isSafeInteger(next) || next <= cursor) throw new Error(`${chain} pagination stopped at ${cursor}.`);
    cursor = next;
  }
  const byAddress = new Map(group.map((x) => [x.pool.pool_address.toLowerCase(), x]));
  const countMap = new Map();
  for (const log of logs) {
    const key = String(log.address ?? '').toLowerCase(); if (!byAddress.has(key)) continue;
    countMap.set(key, (countMap.get(key) ?? 0) + 1);
  }
  for (const item of group) {
    const swapCount = countMap.get(item.pool.pool_address.toLowerCase()) ?? 0;
    results.push({ chain, contract: item.contract, pool: item.pool.pool_address, dexFamily: item.pool.dex_family,
      createdBlock: Number(item.pool.created_block), createdAt: item.pool.created_at, ageBucket: item.ageBucket,
      swapCount, hasSwap: swapCount > 0, dexTokenPairCount: item.tokenPairCount, dexDirectPairFound: item.directExact });
  }
}
const summary = Object.fromEntries(['<1h', '1-6h', '6-24h', '1-3d', '3-7d'].map((ageBucket) => {
  const group = results.filter((x) => x.ageBucket === ageBucket); return [ageBucket, { n: group.length,
    anySwap: group.filter((x) => x.hasSwap).length, noSwap: group.filter((x) => !x.hasSwap).length,
    dexFoundAmongSwapPools: group.filter((x) => x.hasSwap && x.dexDirectPairFound).length }];
}));
const result = { auditAt: new Date().toISOString(), queried: results.length, summary,
  totalSwapLogs: results.reduce((sum, item) => sum + item.swapCount, 0), results };
await writeFile('tmp/onchain-discovery-sample-swaps.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ auditAt: result.auditAt, queried: result.queried, totalSwapLogs: result.totalSwapLogs, summary }, null, 2));
