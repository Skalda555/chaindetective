import assert from 'node:assert/strict';
import { NETWORKS, LEGACY_NETWORKS, getNetwork, isSupportedNetwork, TOKENS, DEMO_WALLETS, searchHolders, analyzeWallets, aggregateHoldings, isAddress, debankProfileUrl, ZERO_ADDRESS, isSystemWalletAddress, readServerScanResult, openServerScan, classifyTokenSpam, SPAM_TOKEN_NAME_MAX_LENGTH } from '../dist/data.js';

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
for(const [name,symbol,expected] of [
 ['OriginEther rewards on https://stkether.org','ORI',true],['Claim at example.com','CLAIM',true],['FREE AIRDROP','FREE',true],['Visit www.example.org','VISIT',true],['x'.repeat(SPAM_TOKEN_NAME_MAX_LENGTH+1),'LONG',true],['Freedom','FREEDOM',false],['Ethereum','ETH',false],['Wrapped Ether','WETH',false],['USD Coin','USDC',false],['Chainlink','LINK',false],
])assert.equal(classifyTokenSpam({name,symbol}).likelySpam,expected,`${name} classification`);
assert.deepEqual(classifyTokenSpam({name:'Claim at example.com',symbol:'CLAIM'}).spamReasons,['url-in-name','keyword:claim']);
assert.equal(debankProfileUrl('0xAbCd000000000000000000000000000000001234'),'https://debank.com/profile/0xAbCd000000000000000000000000000000001234','DeBank URL preserves the exact EVM address');
assert.equal(debankProfileUrl('not-an-EVM-address'),null,'invalid and non-EVM addresses never receive a DeBank profile URL');
assert.equal(isSystemWalletAddress(ZERO_ADDRESS),true);assert.equal(isSystemWalletAddress('0x0000000000000000000000000000000000000001'),false);
assert.deepEqual(NETWORKS.map(n=>n.name),['Ethereum','Base','Optimism','Arbitrum','Robinhood Chain']);
assert.ok(NETWORKS.every(n=>n.live&&n.api?.startsWith('https://')),'all selectable networks have a live Blockscout API');
assert.equal(LEGACY_NETWORKS.length,3);assert.ok(LEGACY_NETWORKS.every(n=>getNetwork(n.id)?.legacy&&!isSupportedNetwork(n.id)),'retired chains stay resolvable but are not selectable');
assert.equal(getNetwork(4663).id,'robinhood');assert.equal(getNetwork(4663).explorer,'https://robinhoodchain.blockscout.com');
await assert.rejects(searchHolders({tokens:[{chainId:'linea',address:UNKNOWN}],chainIds:['linea']}),/podporovanou síť/);
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
const mixedSystemWallets=await analyzeWallets({addresses:[ZERO_ADDRESS,A],chainIds:['base']});assert.ok(mixedSystemWallets.warnings.some(w=>/Neplatná systémová adresa \(zero address\) byla přeskočena/.test(w)));
await assert.rejects(analyzeWallets({addresses:[ZERO_ADDRESS],chainIds:['base']}),/Nebyla spuštěna žádná portfolio analýza/);

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
const spamGroup=aggregateHoldings([{address:A,holdings:[holding({...baseWeth,name:'FREE AIRDROP'},1,null)]}],1)[0];assert.equal(spamGroup.likelySpam,true);assert.ok(spamGroup.spamReasons.includes('keyword:free'));assert.equal(spamGroup.holderCount,1,'spam annotation never removes aggregate/raw data');

// Client transport must use the local server and collect all stored result pages.
{
 const previous=globalThis.fetch;const routes=[];const job={id:'fixture',status:'complete',message:'Done',query:{kind:'holders'},revision:7};
 const json=body=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>body});
 globalThis.fetch=async(route,options={})=>{routes.push(route);assert.ok(route.startsWith('/api/scans'),'live browser requests must stay on the local server');
  if(route==='/api/scans'){const body=JSON.parse(options.body);assert.equal(body.kind,'holders');assert.equal(body.provider,'blockscout');assert.equal(body.minPositionUsd,500);return json(job);}
  if(route==='/api/scans/fixture')return json(job);
  const offset=Number(new URL(route,'http://localhost').searchParams.get('offset'));
  return json({wallets:Array.from({length:offset===0?500:101},(_,i)=>({address:'0x'+(offset+i+1).toString(16).padStart(40,'0')})),tokens:[baseWeth],coverage:{complete:true},warnings:[],pagination:{revision:7,total:601,nextOffset:offset===0?500:null}});
 };
 try{const r=await searchHolders({tokens:[baseWeth],chainIds:['base'],source:'live',provider:'blockscout',minPositionUsd:500});assert.equal(r.wallets.length,601);assert.equal(new Set(r.wallets.map(w=>w.address)).size,601);assert.equal(routes.filter(r=>r.includes('/result?')).length,2);assert.ok(routes.some(r=>r.includes('revision=7')));}finally{globalThis.fetch=previous;}
}
// A running scan's stored result can be read without changing its server-side state.
{
 const previous=globalThis.fetch,routes=[],job={id:'live-result',status:'running',revision:9,query:{kind:'wallets',addresses:[A],chainIds:['base']}};
 const result={job,tokens:[baseWeth],wallets:[],coverage:{complete:false,analyzedWalletCount:0,requestedWalletCount:1},warnings:['Průběžný výsledek'],pagination:{total:1,revision:9}};
 globalThis.fetch=async route=>{routes.push(route);return {ok:true,headers:{get:()=> 'application/json'},json:async()=>result};};
 try{const opened=await readServerScanResult(job);assert.equal(opened.job.status,'running');assert.equal(opened.tokens.length,1);assert.equal(routes.length,1);assert.match(routes[0],/view=tokens/);assert.match(routes[0],/hideSpam=true/,'the default server result request hides likely spam');assert.ok(!routes.some(route=>route.includes('/pause')),'reading results must not call pause');}finally{globalThis.fetch=previous;}
}
// Aborting the local observer must not silently pause a running server job.
{
 const previous=globalThis.fetch,routes=[],controller=new AbortController(),job={id:'observer',status:'running',message:'Working',query:{kind:'holders'}};
 globalThis.fetch=async route=>{routes.push(route);return {ok:true,headers:{get:()=> 'application/json'},json:async()=>job};};
 try{await assert.rejects(openServerScan(job.id,{signal:controller.signal,onProgress:()=>controller.abort()}),{name:'AbortError'});assert.deepEqual(routes,['/api/scans/observer']);}finally{globalThis.fetch=previous;}
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
console.log('Data regressions passed: demo AND/OR, chain identity, aggregation, live result reads without pause, paginated results and explicit cancellation.');
