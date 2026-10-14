import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// A small DOM boundary stub exercises request and persistence logic; visual QA
// runs in a browser. Requests deliberately ignore abort to model late providers.
const source = (await readFile(new URL('../dist/app.js', import.meta.url), 'utf8'))
  .replace(/^import \* as data from '\.\/data\.js';\s*/, '')
  .replace(/renderTokens\(\);renderChains\(\);renderResults\(\);run\(\);\s*$/, '');
const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const token = { id: `base:${A}`, address: A, chainId: 'base', symbol: 'TEST', name: 'Test token' };

function harness() {
  const elements = new Map(), events = new Map(), requests = [], storage = new Map();
  const document = {
    activeElement: null,
    getElementById(id) {
      if (!elements.has(id)) {
        const listeners = new Map();
        elements.set(id, {
          id, value: id === 'sort-select' ? 'value' : '', hidden: true,
          innerHTML: '', textContent: '', disabled: false, dataset: {},
          classList: { toggle() {}, remove() {}, add() {} },
          addEventListener(type, listener) { listeners.set(type, listener); },
          emit(type) { listeners.get(type)?.({ target: this }); },
          setAttribute() {}, querySelectorAll() { return []; },
          focus() { document.activeElement = this; }, close() {}, showModal() {},
        });
      }
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    addEventListener(type, listener) { events.set(type, listener); },
  };
  const request = options => new Promise(resolve => requests.push({ options, resolve }));
  const context = vm.createContext({
    document, AbortController, Intl, Blob, URL,
    setTimeout() { return 0; }, clearTimeout() {},
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    data: { NETWORKS: [{ id: 'base', name: 'Base', explorer: 'https://base.blockscout.com' }],
      TOKENS: [token], DEMO_WALLETS: [{ address: A }], searchHolders: request, analyzeWallets: request },
  });
  vm.runInContext(source + '\nglobalThis.app = {state, run, setSource, setView, normalizeWallet, saveSearch, savedQueries, savedWallets, currentRows, toggleBookmark, renderResults};', context);
  const app = context.app, get = id => document.getElementById(id);
  Object.assign(app.state, { view: 'wallets', source: 'live', chainIds: ['base'], selectedTokens: [{ ...token }] });
  get('wallet-addresses').value = A;
  const clickQuery = id => events.get('click')({ target: { closest: () => ({ dataset: { loadQuery: String(id) } }) } });
  return { app, get, requests, clickQuery };
}

{
  const { app } = harness();
  const wallet = holdings => ({ address: A, holdings });
  assert.equal(app.normalizeWallet({ ...wallet([{ ...token, value: null }]), value: null }).value, null);
  assert.equal(app.normalizeWallet(wallet([{ ...token, value: null }])).value, null);
  assert.equal(app.normalizeWallet(wallet([{ ...token, value: 0 }])).value, 0);
  assert.equal(app.normalizeWallet(wallet([{ ...token, value: 25 }, { ...token, value: null }])).value, 25);
}

{
  const { app, get, requests } = harness();
  const scan = app.run();
  assert.equal(app.state.busy, true);
  assert.equal(get('export-button').disabled, true);
  const loading = get('empty-state').innerHTML;
  get('result-search').emit('input');
  assert.equal(get('empty-state').innerHTML, loading, 'filter rendering must preserve pending scan/cancel UI');
  get('wallet-addresses').value = B;
  get('wallet-addresses').emit('input');
  assert.equal(requests[0].options.signal.aborted, true);
  assert.equal(app.state.busy, false);
  requests[0].resolve({ wallets: [{ address: A, value: 100 }], tokens: [] });
  await scan;
  assert.equal(app.state.result, null, 'edited inputs must reject old completion');
}

{
  const { app, get, requests } = harness();
  const oldScan = app.run();
  get('wallet-addresses').value = B;
  const newScan = app.run();
  assert.equal(requests[0].options.signal.aborted, true);
  requests[1].resolve({ wallets: [], tokens: [{ ...token, totalValue: 7 }] });
  await newScan;
  requests[0].resolve({ wallets: [], tokens: [{ ...token, totalValue: 99 }] });
  await oldScan;
  assert.equal(app.state.result.tokens[0].totalValue, 7, 'latest request must win over late completion');
  assert.equal(app.state.busy, false);
  const cancelled = app.run();
  get('cancel-scan').onclick();
  assert.equal(requests[2].options.signal.aborted, true);
  requests[2].resolve({ wallets: [], tokens: [{ ...token, totalValue: 1 }] });
  await cancelled;
  assert.equal(app.state.result, null, 'cancelled response must not return results');
}

{
  const { app, get, requests, clickQuery } = harness();
  app.state.result = { wallets: [], tokens: [] };
  get('wallet-addresses').value = B;
  app.saveSearch();
  const saved = app.savedQueries[0];
  app.state.selectedTokens[0].symbol = 'CHANGED';
  app.state.selectedTokens.push({ ...token, id: 'another' });
  app.state.chainIds.push('ethereum');
  assert.equal(saved.tokens[0].symbol, 'TEST');
  assert.equal(saved.tokens.length, 1);
  assert.equal(saved.chainIds.length, 1);
  app.state.source = 'demo';
  app.state.view = 'screener';
  app.state.activeWallet = { address: A };
  get('wallet-drawer').hidden = false;
  clickQuery(saved.id);
  assert.equal(app.state.source, 'live');
  assert.equal(app.state.view, 'wallets');
  assert.equal(get('wallet-addresses').value, B, 'restoration must retain saved addresses across source/view changes');
  assert.equal(requests.length, 0, 'restoring a live query must wait for an explicit scan');
  assert.equal(get('wallet-drawer').hidden, true, 'source changes must close obsolete details');
  app.state.selectedTokens.push({ ...token, id: 'another' });
  app.state.chainIds.push('ethereum');
  assert.equal(saved.tokens.length, 1);
  assert.equal(saved.chainIds.length, 1);
}

{
  const { app, get, requests, clickQuery } = harness();
  app.state.result = { wallets: [], tokens: [] };
  get('wallet-addresses').value = B;
  app.saveSearch();
  get('wallet-addresses').value = A;
  const scan = app.run();
  clickQuery(app.savedQueries[0].id);
  assert.equal(get('wallet-addresses').value, B);
  assert.equal(requests[0].options.signal.aborted, true, 'restoring same-mode live query must abort a pending scan');
  requests[0].resolve({ wallets: [], tokens: [{ ...token, totalValue: 99 }] });
  await scan;
  assert.equal(app.state.result, null, 'old results must not populate a restored live query');
  assert.equal(app.state.busy, false);
}

{
  const { app } = harness();
  app.state.source = 'demo';
  app.state.view = 'screener';
  app.state.result = { wallets: [app.normalizeWallet({ address: A, value: 10, holdings: [{ ...token, value: 10 }] })], tokens: [] };
  app.toggleBookmark(A);
  app.state.source = 'live';
  app.state.result = { wallets: [app.normalizeWallet({ address: A, value: 20, holdings: [{ ...token, value: 20 }] })], tokens: [] };
  app.toggleBookmark(A);
  app.state.view = 'watchlist';
  assert.equal(app.currentRows().length, 1);
  assert.equal(app.currentRows()[0].value, 20);
  app.state.source = 'demo';
  assert.equal(app.currentRows().length, 1);
  assert.equal(app.currentRows()[0].value, 10, 'watchlist snapshots must remain source isolated');
}

console.log('App regressions passed: unknown USD, stale requests, cancellation, query snapshots, source restoration, watchlist isolation.');
