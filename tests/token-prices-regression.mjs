import assert from 'node:assert/strict';
import {getTokenUsdPrice,minimumTokenRawBalance,formatTokenRawAmount} from '../server/token-prices.mjs';

const address='0x1111111111111111111111111111111111111111';
const response=(body,status=200)=>({ok:status===200,status,json:async()=>body});
{
 const calls=[],cache=new Map(),now=1_800_000_000_000;
 const quote=await getTokenUsdPrice('robinhood',address,{now:()=>now,cache,fetchImpl:async url=>{calls.push(new URL(url));return response({coins:{[`robinhood:${address}`]:{price:0.25,timestamp:1_799_999_000}}});}});
 assert.deepEqual(quote,{priceUsd:0.25,priceSource:'defillama',priceAsOf:new Date(1_799_999_000_000).toISOString()});
 assert.equal(calls.length,1);assert.match(calls[0].pathname,/robinhood%3A0x1111/i,'DeFiLlama identity includes the explicit Robinhood network and contract');
 await getTokenUsdPrice('robinhood',address,{now:()=>now+1000,cache,fetchImpl:async()=>{throw Error('5 minute cache should be used');}});assert.equal(calls.length,1);
}
{
 const urls=[],cache=new Map(),pairs=[
  {chainId:'robinhood',baseToken:{address},quoteToken:{address:'0x0000000000000000000000000000000000000001'},priceUsd:'0.20',liquidity:{usd:100}},
  {chainId:'ethereum',baseToken:{address},quoteToken:{address:'0x0000000000000000000000000000000000000001'},priceUsd:'9',liquidity:{usd:999999}},
  {chainId:'robinhood',baseToken:{address},quoteToken:{address:'0x0000000000000000000000000000000000000002'},priceUsd:'0.30',liquidity:{usd:500}},
 ];
 const quote=await getTokenUsdPrice('robinhood',address,{cache,now:()=>1_800_000_000_000,fetchImpl:async url=>{url=new URL(url);urls.push(url);return url.hostname==='coins.llama.fi'?response({coins:{}}):response(pairs);}});
 assert.equal(quote.priceUsd,0.3,'DexScreener fallback selects the most liquid pair on the exact chain and contract');assert.equal(quote.priceSource,'dexscreener');assert.equal(urls.length,2);
}
assert.equal(minimumTokenRawBalance(500,0.25,0),2000n,'zero decimals are handled exactly');
assert.equal(minimumTokenRawBalance(500,0.25,6),2_000_000_000n,'six decimals convert USD threshold to raw token units');
assert.equal(minimumTokenRawBalance('0.01','0.03',18),333333333333333334n,'fractional thresholds round up to the next spendable raw unit');
assert.equal(minimumTokenRawBalance(500,0.25,18),2_000_000_000_000_000_000_000n,'large 18-decimal raw balance uses BigInt exactly');
assert.equal(formatTokenRawAmount('2000000000',6),'2000');
assert.equal(formatTokenRawAmount('333333333333333334',18),'0.333333333333333334');
assert.equal(await getTokenUsdPrice('robinhood','not-an-address',{fetchImpl:async()=>{throw Error('invalid identity must not query price APIs');}}),null);
console.log('Token price regressions passed: exact chain+contract identity, liquidity-ranked DexScreener fallback, 5 minute cache, and exact decimal conversion.');
