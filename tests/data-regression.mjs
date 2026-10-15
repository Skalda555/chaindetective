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

// Client transport must use the local server and collect all stored result pages.
{
 const previous=globalThis.fetch;const routes=[];const job={id:'fixture',status:'complete',message:'Done',query:{kind:'holders'},revision:7};
 const json=body=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>body});
 globalThis.fetch=async(route,options={})=>{routes.push(route);assert.ok(route.startsWith('/api/scans'),'live browser requests must stay on the local server');
  if(route==='/api/scans'){const body=JSON.parse(options.body);assert.equal(body.kind,'holders');assert.equal(body.provider,'blockscout');return json(job);}
  if(route==='/api/scans/fixture')return json(job);
  const offset=Number(new URL(route,'http://localhost').searchParams.get('offset'));
  return json({wallets:Array.from({length:offset===0?500:101},(_,i)=>({address:'0x'+(offset+i+1).toString(16).padStart(40,'0')})),tokens:[baseWeth],coverage:{complete:true},warnings:[],pagination:{revision:7,total:601,nextOffset:offset===0?500:null}});
 };
 try{const r=await searchHolders({tokens:[baseWeth],chainIds:['base'],source:'live',provider:'blockscout'});assert.equal(r.wallets.length,601);assert.equal(new Set(r.wallets.map(w=>w.address)).size,601);assert.equal(routes.filter(r=>r.includes('/result?')).length,2);assert.ok(routes.some(r=>r.includes('revision=7')));}finally{globalThis.fetch=previous;}
}
// Cancelling while the server accepts a new scan must pause that exact scan.
{
 const previous=globalThis.fetch,controller=new AbortController(),routes=[];
 const json=body=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>body});
 globalThis.fetch=async(route,options={})=>{routes.push(route);
  if(route==='/api/scans'){assert.equal(options.signal,undefined);controller.abort();return json({id:'newly-accepted'});}
  assert.equal(route,'/api/scans/newly-accepted/pause');return json({status:'paused'});
 };
 try{await assert.rejects(searchHolders({tokens:[baseWeth],chainIds:['base'],source:'live',signal:controller.signal}),{name:'AbortError'});assert.deepEqual(routes,['/api/scans','/api/scans/newly-accepted/pause']);}finally{globalThis.fetch=previous;}
}
console.log('Data regressions passed: demo AND/OR, chain identity, aggregation, paginated server results and cancellation during creation.');
