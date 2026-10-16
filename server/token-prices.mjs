const TTL_MS=5*60*1000;
const LLAMA_CHAIN=Object.freeze({ethereum:'ethereum',base:'base',optimism:'optimism',arbitrum:'arbitrum',robinhood:'robinhood'});
const DEX_CHAIN=Object.freeze({ethereum:'ethereum',base:'base',optimism:'optimism',arbitrum:'arbitrum',robinhood:'robinhood'});
const sharedCache=new Map();

function validEvmAddress(address){return /^0x[\da-f]{40}$/i.test(String(address||''));}
function validPrice(value){const price=Number(value);return Number.isFinite(price)&&price>0?price:null;}
async function json(fetchImpl,url,signal){
 const timeout=AbortSignal.timeout(7000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
 const response=await fetchImpl(url,{headers:{Accept:'application/json'},signal:combined});
 if(!response.ok)throw new Error(`Price API HTTP ${response.status}`);
 return response.json();
}
function dexTokenPrice(pairs,chainId,address){
 if(!Array.isArray(pairs))return null;
 const target=address.toLowerCase(),chain=DEX_CHAIN[chainId];
 const candidates=[];
 for(const pair of pairs){
  if(String(pair.chainId||'').toLowerCase()!==chain||!pair.baseToken||!pair.quoteToken)continue;
  const base=String(pair.baseToken.address||'').toLowerCase(),quote=String(pair.quoteToken.address||'').toLowerCase();
  let price=null;
  if(base===target)price=validPrice(pair.priceUsd);
  else if(quote===target){const baseUsd=validPrice(pair.priceUsd),native=validPrice(pair.priceNative);if(baseUsd&&native)price=validPrice(baseUsd/native);}
  if(price)candidates.push({price,liquidity:Math.max(0,Number(pair.liquidity?.usd)||0)});
 }
 candidates.sort((a,b)=>b.liquidity-a.liquidity);
 return candidates[0]?.price??null;
}
export async function getTokenUsdPrice(chainId,address,{fetchImpl=globalThis.fetch,now=Date.now,cache=sharedCache,signal}={}){
 const normalized=String(address||'').toLowerCase();
 if(!validEvmAddress(normalized)||!LLAMA_CHAIN[chainId]||!DEX_CHAIN[chainId])return null;
 const key=`${chainId}:${normalized}`,cached=cache.get(key);
 if(cached&&now()-cached.cachedAt<TTL_MS)return cached.value;
 let price=null,source=null,asOf=null;
 try{
  const coin=`${LLAMA_CHAIN[chainId]}:${normalized}`,data=await json(fetchImpl,`https://coins.llama.fi/prices/current/${encodeURIComponent(coin)}`,signal),entry=data?.coins?.[coin]||data?.coins?.[Object.keys(data?.coins||{}).find(k=>k.toLowerCase()===coin.toLowerCase())];
  price=validPrice(entry?.price);
  if(price){source='defillama';const timestamp=Number(entry.timestamp);asOf=Number.isFinite(timestamp)&&timestamp>0?new Date(timestamp*1000).toISOString():new Date(now()).toISOString();}
 }catch{}
 if(!price){
  try{
   const chain=DEX_CHAIN[chainId],pairs=await json(fetchImpl,`https://api.dexscreener.com/token-pairs/v1/${chain}/${normalized}`,signal);
   price=dexTokenPrice(pairs,chainId,normalized);
   if(price){source='dexscreener';asOf=new Date(now()).toISOString();}
  }catch{}
 }
 const value=price?{priceUsd:price,priceSource:source,priceAsOf:asOf}:null;
 cache.set(key,{cachedAt:now(),value});
 return value;
}

function decimalRatio(value){
 const match=String(value).trim().toLowerCase().match(/^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/);
 if(!match)return null;
 const fraction=match[2]||'',exponent=Number(match[3]||0);let numerator=BigInt(match[1]+fraction),scale=fraction.length-exponent;
 if(scale<0){numerator*=10n**BigInt(-scale);scale=0;}
 return {numerator,denominator:10n**BigInt(scale)};
}
export function minimumTokenRawBalance(minUsd,priceUsd,decimals){
 const threshold=decimalRatio(minUsd),price=decimalRatio(priceUsd);
 if(!threshold||!price||threshold.numerator<=0n||price.numerator<=0n||!Number.isInteger(decimals)||decimals<0||decimals>255)return null;
 const numerator=threshold.numerator*price.denominator*10n**BigInt(decimals),denominator=threshold.denominator*price.numerator;
 return (numerator+denominator-1n)/denominator;
}
export function formatTokenRawAmount(rawAmount,decimals){
 if(!/^\d+$/.test(String(rawAmount))||!Number.isInteger(decimals)||decimals<0||decimals>255)return null;
 const raw=BigInt(rawAmount),base=10n**BigInt(decimals);if(decimals===0)return String(raw);
 const whole=raw/base,fraction=String(raw%base).padStart(decimals,'0').replace(/0+$/,'');
 return fraction?`${whole}.${fraction}`:String(whole);
}
