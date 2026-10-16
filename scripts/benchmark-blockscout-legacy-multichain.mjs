import '../server/load-env.mjs';
import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';

// Read-only, one-off transport benchmark. The API key is only sent in the
// request query and is never printed or persisted.
const candidates = [
  {network: 'Ethereum', chainId: 1, symbol: 'PEAS', contract: '0x02f92800f57bcd74066f5709f1daa1a4302df875', source: 'local scan history'},
  {network: 'Base', chainId: 8453, symbol: 'USDC', contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', source: 'verified canonical contract'},
  {network: 'Optimism', chainId: 10, symbol: 'USDC', contract: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', source: 'verified canonical contract'},
  {network: 'Arbitrum', chainId: 42161, symbol: 'USDC', contract: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', source: 'verified canonical contract'},
];
const apiKey = process.env.BLOCKSCOUT_API_KEY?.trim() || '';
if (!apiKey) throw new Error('BLOCKSCOUT_API_KEY není nastaven; benchmark nebyl spuštěn.');
const timeoutMs = 12_000;
const pauseMs = 650;
const rateHeaderNames = ['retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset'];
const allRequests = [];

function parseRows(body) {
  const items = Array.isArray(body?.items) ? body.items : Array.isArray(body?.result) ? body.result : [];
  return items.map(item => ({
    address: String(item.address?.hash ?? item.address_hash ?? item.TokenHolderAddress ?? item.address ?? '').toLowerCase(),
    balance: String(item.value ?? item.balance ?? item.TokenHolderQuantity ?? item.quantity ?? ''),
  })).filter(row => /^0x[0-9a-f]{40}$/.test(row.address) && /^\d+$/.test(row.balance));
}
function duplicates(rows) { return rows.length - new Set(rows.map(row => row.address)).size; }
function descending(rows) {
  for (let i = 1; i < rows.length; i++) if (BigInt(rows[i - 1].balance) < BigInt(rows[i].balance)) return false;
  return rows.length > 1 ? true : null;
}
function boundaryDescending(left, right) {
  if (!left.length || !right.length) return null;
  return BigInt(left.at(-1).balance) >= BigInt(right[0].balance);
}
function pair(row) { return `${row.address}:${row.balance}`; }
function compareFirst100(a, b) {
  const left = a.slice(0, 100), right = b.slice(0, 100);
  const leftMap = new Map(left.map(row => [row.address, row.balance]));
  const rightMap = new Map(right.map(row => [row.address, row.balance]));
  let matchingAddressAndBalance = 0, balanceMismatches = 0, missing = 0, extra = 0;
  for (const [address, balance] of leftMap) {
    if (!rightMap.has(address)) missing++;
    else if (rightMap.get(address) === balance) matchingAddressAndBalance++;
    else balanceMismatches++;
  }
  for (const address of rightMap.keys()) if (!leftMap.has(address)) extra++;
  return {
    comparedRows: Math.min(left.length, right.length),
    matchingAddressAndBalance,
    balanceMismatches,
    missing,
    extra,
    exactSequence: left.length >= 100 && right.length >= 100 && left.every((row, i) => pair(row) === pair(right[i])),
  };
}
function makeUrl(chainId, legacy, {page = 1, offset = 100, cursor = null} = {}) {
  const base = `https://api.blockscout.com/${chainId}/api`;
  const url = legacy ? new URL(base) : new URL(`${base}/v2/tokens/${contractForCurrent}/holders`);
  if (legacy) {
    url.searchParams.set('module', 'token');
    url.searchParams.set('action', 'getTokenHolders');
    url.searchParams.set('contractaddress', contractForCurrent);
    url.searchParams.set('page', String(page));
    url.searchParams.set('offset', String(offset));
  } else if (cursor) {
    for (const [key, value] of Object.entries(cursor)) if (value !== null) url.searchParams.set(key, String(value));
  }
  url.searchParams.set('apikey', apiKey);
  return url;
}
let contractForCurrent = '';

async function request(label, url, requestedSize = null) {
  if (allRequests.length) await new Promise(resolve => setTimeout(resolve, pauseMs));
  const started = performance.now();
  let response, body, bodyPreview = '';
  try {
    response = await fetch(url, {headers: {accept: 'application/json'}, redirect: 'error', signal: AbortSignal.timeout(timeoutMs)});
    const text = await response.text();
    try { body = JSON.parse(text); } catch { bodyPreview = text.slice(0, 240); }
  } catch (error) {
    const result = {label, status: null, latencyMs: +(performance.now() - started).toFixed(1), errorName: error.name, rowCount: 0, rows: [], rateHeaders: {}};
    allRequests.push(result);
    console.log(JSON.stringify({...result, rows: undefined}));
    return result;
  }
  const rows = parseRows(body);
  const result = {
    label,
    status: response.status,
    ok: response.ok,
    latencyMs: +(performance.now() - started).toFixed(1),
    contentType: response.headers.get('content-type'),
    rateHeaders: Object.fromEntries(rateHeaderNames.map(name => [name, response.headers.get(name)]).filter(([, value]) => value !== null)),
    apiStatus: body?.status ?? null,
    apiMessage: body?.message ?? body?.result?.message ?? null,
    nextCursor: body?.next_page_params ?? null,
    rowCount: rows.length,
    rawItemCount: Array.isArray(body?.items) ? body.items.length : Array.isArray(body?.result) ? body.result.length : 0,
    duplicates: duplicates(rows),
    descendingWithinPage: descending(rows),
    requestedSize,
    fullPage: requestedSize === null ? null : rows.length === requestedSize,
    first: rows[0] ?? null,
    last: rows.at(-1) ?? null,
    rows,
    ...(bodyPreview ? {bodyPreview} : {}),
  };
  allRequests.push(result);
  console.log(JSON.stringify({...result, rows: undefined}));
  return result;
}

const report = [];
for (const token of candidates) {
  contractForCurrent = token.contract;
  const rest1 = await request(`${token.network} REST v2 page 1`, makeUrl(token.chainId, false));
  const restSecond = rest1.nextCursor ? await request(`${token.network} REST v2 page 2`, makeUrl(token.chainId, false, {cursor: rest1.nextCursor})) : null;
  const legacyPages = [];
  for (const offset of [100, 500, 1000]) legacyPages.push(await request(`${token.network} Legacy offset=${offset} page 1`, makeUrl(token.chainId, true, {page: 1, offset}), offset));
  const highest = [...legacyPages].reverse().find(result => result.status === 200 && result.rowCount > 0 && result.rowCount === result.requestedSize) ?? [...legacyPages].reverse().find(result => result.status === 200 && result.rowCount > 0);
  const page2 = highest ? await request(`${token.network} Legacy offset=${highest.requestedSize} page 2`, makeUrl(token.chainId, true, {page: 2, offset: highest.requestedSize}), highest.requestedSize) : null;
  report.push({token, rest1, rest2: restSecond, legacyPages, highestWorkingPage: highest?.requestedSize ?? null, legacyPage2: page2,
    orderingAcrossPageBoundary: page2 ? boundaryDescending(highest.rows, page2.rows) : null,
    duplicatesAcrossPages: page2 ? page2.rows.filter(row => highest.rows.some(first => first.address === row.address)).length : null,
    first100Comparison: compareFirst100(rest1.rows, legacyPages.find(page => page.requestedSize === 100)?.rows ?? []),
  });
}

const safeRequest = req => ({...req, rows: undefined});
console.log(JSON.stringify({
  benchmark: 'Blockscout Legacy token holders multi-chain (read-only)',
  apiKeyConfigured: true,
  apiKeyPrinted: false,
  pacingMs: pauseMs,
  publicHostsTested: false,
  requests: allRequests.map(safeRequest),
  chains: report.map(item => ({
    network: item.token.network,
    chainId: item.token.chainId,
    symbol: item.token.symbol,
    contract: item.token.contract,
    tokenSource: item.token.source,
    restV2: [item.rest1, item.rest2].map(safeRequest),
    legacyPage1: item.legacyPages.map(safeRequest),
    largestFullPageSize: item.highestWorkingPage,
    legacyPage2: item.legacyPage2 ? safeRequest(item.legacyPage2) : null,
    orderingAcrossPageBoundary: item.orderingAcrossPageBoundary,
    duplicateAddressesAcrossLegacyPages: item.duplicatesAcrossPages,
    first100ComparisonWithRestV2: item.first100Comparison,
  })),
}, null, 2));
