import assert from 'node:assert/strict';
import { NETWORKS, TOKENS, DEMO_WALLETS, searchHolders, analyzeWallets, aggregateHoldings, isAddress } from '../dist/data.js';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const UNKNOWN = '0x3333333333333333333333333333333333333333';
const arb = TOKENS.find(t => t.symbol === 'ARB');
const arbWeth = TOKENS.find(t => t.chainId === 'arbitrum' && t.symbol === 'WETH');
const baseWeth = TOKENS.find(t => t.chainId === 'base' && t.symbol === 'WETH');
const opWeth = TOKENS.find(t => t.chainId === 'optimism' && t.symbol === 'WETH');
const usdc = TOKENS.find(t => t.chainId === 'base' && t.symbol === 'USDC');
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const page = (items, next_page_params = null) => response({ items, next_page_params });
async function withFetch(mock, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, options) => mock(new URL(url), options);
  try { await run(); } finally { globalThis.fetch = previous; }
}

assert.ok(DEMO_WALLETS.every(w => isAddress(w.address)));
assert.ok(TOKENS.every(t => isAddress(t.address)));
assert.equal(new Set(DEMO_WALLETS.map(w => w.address)).size, DEMO_WALLETS.length);
const all = await searchHolders({ tokens: [arb, arbWeth], chainIds: ['arbitrum'], match: 'all' });
const any = await searchHolders({ tokens: [arb, arbWeth], chainIds: ['arbitrum'], match: 'any' });
assert.equal(all.wallets.length, 16);
assert.equal(any.wallets.length, 24);
for (const w of all.wallets) {
  assert.equal(w.matchCount, 2);
  const selectedValue = w.holdings.filter(h => [arb.id, arbWeth.id].includes(h.tokenId)).reduce((sum, h) => sum + h.value, 0);
  assert.ok(Math.abs(w.value - selectedValue) < 0.011, 'screener value must include selected positions only');
}
const unknown = await searchHolders({ tokens: [{ chainId: 'base', address: UNKNOWN }], chainIds: ['base'] });
assert.equal(unknown.wallets.length, 0);
assert.ok(unknown.warnings.length);
const unknownWallet = await analyzeWallets({ addresses: [UNKNOWN], chainIds: ['base'] });
assert.equal(unknownWallet.tokens.length, 0);
assert.ok(unknownWallet.warnings.length);

const holding = (t, amount, value) => ({ ...t, tokenId: t.id, amount, value });
const grouped = aggregateHoldings([
  { address: A, holdings: [holding(baseWeth, 1, null), holding(opWeth, 4, null)] },
  { address: B, holdings: [holding(baseWeth, 2, 5), holding(opWeth, 0, 0)] },
], 3);
assert.equal(grouped.length, 2, 'same contract and ticker on separate chains remain separate');
const baseGroup = grouped.find(t => t.chainId === 'base');
assert.equal(baseGroup.amount, 3);
assert.equal(baseGroup.holderCount, 2);
assert.equal(baseGroup.share, 2 / 3);
assert.equal(baseGroup.totalValue, 5);
assert.equal(baseGroup.unpricedPositions, 1);
assert.equal(grouped.find(t => t.chainId === 'optimism').totalValue, null);

await withFetch(url => {
  const isBase = url.host === new URL(NETWORKS.find(n => n.id === 'base').api).host;
  if (!url.pathname.endsWith('/holders')) return response({ type: 'ERC-20', decimals: '18', exchange_rate: '2', symbol: 'WETH' });
  return page(isBase ? [{ address: { hash: A }, value: '100000000000000000000' }, { address: { hash: B }, value: '50000000000000000000' }]
    : [{ address: { hash: A }, value: '10000000000000000000' }]);
}, async () => {
  const result = await searchHolders({ tokens: [baseWeth, opWeth], chainIds: ['base', 'optimism'], match: 'all', source: 'live' });
  assert.equal(result.wallets.length, 1, 'cross-chain AND must join the same wallet address');
  assert.equal(result.wallets[0].address, A);
  assert.equal(result.wallets[0].matchCount, 2);
  assert.equal(result.wallets[0].value, 220);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.bounded, true);
});

await withFetch(() => response({}, 503), async () => {
  await assert.rejects(searchHolders({ tokens: [baseWeth], chainIds: ['base'], source: 'live' }), /nepodařilo načíst/);
  await assert.rejects(analyzeWallets({ addresses: [A], chainIds: ['base'], source: 'live' }), /nepodařilo načíst/);
});

await withFetch(url => url.pathname.includes(B) ? response({}, 503) : page([
  { token: { address_hash: usdc.address, symbol: 'USDC', decimals: '6', exchange_rate: null }, value: '1230000' },
  { token: { address_hash: UNKNOWN, symbol: 'ZERO', decimals: '0', exchange_rate: '2' }, value: '17' },
]), async () => {
  const result = await analyzeWallets({ addresses: [A, B], chainIds: ['base'], source: 'live' });
  assert.equal(result.wallets.length, 1, 'failed wallet must not become a successful zero balance');
  assert.ok(result.warnings.length);
  const dollars = result.tokens.find(t => t.symbol === 'USDC');
  assert.equal(dollars.amount, 1.23);
  assert.equal(dollars.totalValue, null, 'null API exchange rate must stay unknown');
  assert.equal(dollars.share, 0.5, 'coverage denominator includes submitted unique addresses');
  const zero = result.tokens.find(t => t.symbol === 'ZERO');
  assert.equal(zero.amount, 17, 'zero decimal token must retain integer units');
  assert.equal(zero.totalValue, 34);
});

await withFetch(url => !url.pathname.endsWith('/holders')
  ? response({ type: 'ERC-20', decimals: null, exchange_rate: '1', symbol: 'BAD' })
  : page([{ address: { hash: A }, value: '1000000000000000000' }]), async () => {
  const result = await searchHolders({ tokens: [{ chainId: 'base', address: UNKNOWN, decimals: 18 }], chainIds: ['base'], source: 'live' })
    .catch(error => error);
  if (result instanceof Error) {
    assert.match(result.message, /decim|desetinn|nepodařilo načíst/i);
  } else {
    assert.equal(result.wallets.length, 0, 'unknown decimals must not become zero-decimal inflated balances');
    assert.ok(result.warnings.length, 'unusable decimal metadata must be disclosed');
  }
});

await withFetch(url => !url.pathname.endsWith('/holders')
  ? response({ type: 'ERC-20', decimals: '18', exchange_rate: '2', symbol: 'WETH' })
  : page([{ address: { hash: A }, value: '1000000000000000000' }], url.searchParams.has('cursor') ? null : { cursor: 'next' }), async () => {
  const result = await searchHolders({ tokens: [baseWeth], chainIds: ['base'], source: 'live' });
  assert.equal(result.wallets.length, 1);
  assert.equal(result.wallets[0].value, 2, 'holder repeated on overlapping pages must count once');
});

await withFetch(url => page([{ token: { address_hash: baseWeth.address, symbol: 'WETH', decimals: '18', exchange_rate: '2' }, value: '1000000000000000000' }],
  url.searchParams.has('cursor') ? null : { cursor: 'next' }), async () => {
  const result = await analyzeWallets({ addresses: [A], chainIds: ['base'], source: 'live' });
  assert.equal(result.tokens[0].amount, 1, 'same balance repeated on overlapping pages must count once');
  assert.equal(result.tokens[0].totalValue, 2);
});

console.log('Data regressions passed: AND/OR, chain identity, decimal units, unknown prices, API failures, coverage, overlapping pages.');
