import './load-env.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {NETWORKS,getNetwork,isAddress} from '../dist/data.js';
import {BlockscoutProvider} from './provider.mjs';

const alchemyNetworks={ethereum:'eth-mainnet',base:'base-mainnet',arbitrum:'arb-mainnet',optimism:'opt-mainnet'};
const fallbackNetworks=new Set(['ethereum','optimism','arbitrum']);
const breakerThreshold=3,breakerCooldownMs=60_000,quotaCooldownMs=30*60_000,maxRetryAfterMs=10_000;
const envInt=(name,fallback)=>Number.isInteger(Number(process.env[name]))&&Number(process.env[name])>0?Number(process.env[name]):fallback;
export const PROVIDER_LIMITS=Object.freeze({alchemy:{concurrency:envInt('ALCHEMY_REQUEST_CONCURRENCY',4),intervalMs:envInt('ALCHEMY_MIN_REQUEST_INTERVAL_MS',200)},blockscout:{concurrency:envInt('BLOCKSCOUT_REQUEST_CONCURRENCY',1),intervalMs:envInt('BLOCKSCOUT_MIN_REQUEST_INTERVAL_MS',400)}});

class ProviderGate{
 constructor({concurrency,intervalMs}){this.concurrency=concurrency;this.intervalMs=intervalMs;this.active=0;this.nextAt=0;this.waiters=[];}
 async acquire(signal){
  signal?.throwIfAborted();if(this.active<this.concurrency){this.active++;return;}
  await new Promise((resolve,reject)=>{const waiter={resolve:()=>{signal?.removeEventListener('abort',abort);this.active++;resolve();},reject};const abort=()=>{this.waiters=this.waiters.filter(w=>w!==waiter);reject(signal.reason||new DOMException('Aborted','AbortError'));};waiter.abort=abort;this.waiters.push(waiter);signal?.addEventListener('abort',abort,{once:true});});
 }
 release(){this.active=Math.max(0,this.active-1);while(this.waiters.length){const waiter=this.waiters.shift();if(!waiter.abort||!waiter.signal?.aborted){waiter.resolve();break;}}}
 async run(fn,signal){await this.acquire(signal);try{signal?.throwIfAborted();const now=Date.now(),wait=Math.max(0,this.nextAt-now);this.nextAt=Math.max(now,this.nextAt)+this.intervalMs;if(wait)await delay(wait,undefined,{signal});signal?.throwIfAborted();return await fn();}finally{this.release();}}
}

export class AlchemyFailure extends Error{
 constructor(kind,message,{retryable=false,retryMs=0}={}){super(message);this.kind=kind;this.retryable=retryable;this.retryMs=retryMs;}
}
function retryAfterMs(value,now=Date.now()){
 if(!value)return 0;
 const seconds=Number(value);const ms=Number.isFinite(seconds)?seconds*1000:Date.parse(value)-now;
 return Number.isFinite(ms)?Math.max(0,Math.min(maxRetryAfterMs,ms)):0;
}
function classify(status,payload,{contentType='',retryAfter,now=Date.now()}={}){
 const message=JSON.stringify(payload||'').toLowerCase();
 const wait=retryAfterMs(retryAfter,now);
 if(/per second|per-second|throughput/.test(message)&&!/(monthly|credit|quota)/.test(message))return new AlchemyFailure('rate','Alchemy: krátkodobý limit požadavků.',{retryable:true,retryMs:wait});
 if(/monthly.{0,40}(capacity|limit|quota)|(?:credit|quota|compute units|compute unit|spending|spend).{0,50}(?:exhaust|exceed|deplet|limit reached|insufficient)|insufficient.{0,30}(?:credit|balance)|(?:exhaust|exceed).{0,40}(?:monthly|credit|quota)/.test(message)||status===402)return new AlchemyFailure('quota','Alchemy: vyčerpaný kredit nebo měsíční limit.');
 if(status===429||payload?.error?.code===429)return new AlchemyFailure('rate','Alchemy: krátkodobý limit požadavků.',{retryable:true,retryMs:wait});
 if(status===401||/invalid (?:access|api) key|must be authenticated/.test(message))return new AlchemyFailure('auth','Alchemy: neplatný nebo neautorizovaný API klíč.');
 if(status===403&&(/text\/html/i.test(contentType)||/cloudflare|challenge|temporarily blocked|security check/i.test(message)))return new AlchemyFailure('protection','Alchemy: upstream ochrana dočasně blokuje požadavek.',{retryable:true,retryMs:wait});
 if(status===403)return new AlchemyFailure('access','Alchemy: upstream nepovolil tento požadavek.');
 if(status>=500||payload?.error?.partialErrors)return new AlchemyFailure('outage','Alchemy: síť nebo služba je dočasně nedostupná.',{retryable:true,retryMs:wait});
 return new Error('Alchemy: požadavek se nepodařilo zpracovat.');
}

export class AlchemyWalletProvider{
 #key;
 constructor({apiKey='',fetchImpl=globalThis.fetch,timeoutMs=20_000,retries=2,retryMs=500,now=Date.now}={}){this.#key=apiKey.trim();Object.assign(this,{fetchImpl,timeoutMs,retries,retryMs,now});}
 get configured(){return !!this.#key;}
 supports(operation,chainId){return operation==='wallets'&&this.configured&&!!alchemyNetworks[chainId];}
 async metadata(task){if(!this.supports(task.kind,task.chainId))throw new AlchemyFailure('access','Alchemy není pro tuto operaci a síť nakonfigurované.');return null;}
 async page(task,signal){
  if(!this.supports(task.kind,task.chainId))throw new AlchemyFailure('access','Alchemy není pro tuto operaci a síť nakonfigurované.');
  if(!isAddress(task.address))throw new Error('Neplatná adresa peněženky.');
  if(task.cursor?.pageKey!==undefined&&(typeof task.cursor.pageKey!=='string'||task.cursor.pageKey.length>4096))throw new Error('Neplatný kurzor Alchemy.');
  const url='https://api.g.alchemy.com/data/v1/'+encodeURIComponent(this.#key)+'/assets/tokens/by-address';
  const body={addresses:[{address:task.address,networks:[alchemyNetworks[task.chainId]]}],withMetadata:true,withPrices:true,includeNativeTokens:false,includeErc20Tokens:true,...(task.cursor?.pageKey?{pageKey:task.cursor.pageKey}:{})};
  for(let attempt=0;;attempt++){
   signal?.throwIfAborted();
   try{
    const timeout=AbortSignal.timeout(this.timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    const response=await this.fetchImpl(url,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(body),signal:combined,redirect:'error'});
    let payload;try{payload=await response.json();}catch{throw new AlchemyFailure('outage','Alchemy: neplatná odpověď služby.',{retryable:true});}
    if(!response.ok||payload.error)throw classify(response.status,payload,{contentType:response.headers?.get?.('content-type')||'',retryAfter:response.headers?.get?.('retry-after'),now:this.now()});
    if(!Array.isArray(payload.data?.tokens))throw new AlchemyFailure('outage','Alchemy: odpověď neobsahuje seznam tokenů.',{retryable:true});
    const pageKey=payload.data.pageKey??payload.pageKey;
    if(pageKey!==undefined&&pageKey!==null&&(typeof pageKey!=='string'||pageKey.length>4096))throw new AlchemyFailure('outage','Alchemy: odpověď obsahuje neplatný kurzor.',{retryable:true});
    const items=payload.data.tokens.filter(t=>t.tokenAddress!==null).map(t=>{
     if(t.address?.toLowerCase()!==task.address.toLowerCase()||t.network!==alchemyNetworks[task.chainId])throw new AlchemyFailure('outage','Alchemy: odpověď obsahuje data jiné adresy nebo sítě.',{retryable:true});
     if(!isAddress(t.tokenAddress)||typeof t.tokenBalance!=='string'||!/^0x[\da-f]+$/i.test(t.tokenBalance))throw new AlchemyFailure('outage','Alchemy: odpověď obsahuje neplatný token nebo zůstatek.',{retryable:true});
     const metadata=t.tokenMetadata||{},usd=t.tokenPrices?.find(p=>p.currency?.toLowerCase()==='usd');
     return {token:{address_hash:t.tokenAddress,name:metadata.name,symbol:metadata.symbol,decimals:metadata.decimals,exchange_rate:usd?.value??null},value:BigInt(t.tokenBalance).toString()};
    });
    return {items,cursor:pageKey?{pageKey}:null};
   }catch(error){
    if(signal?.aborted)throw signal.reason;
    // Native fetch errors can contain the URL, including the secret API key.
    if(error.name==='TypeError'||error.name==='TimeoutError')error=new AlchemyFailure('outage','Alchemy: připojení selhalo nebo vypršel čas požadavku.',{retryable:true});
    if(!error.retryable||attempt>=this.retries)throw error;
    const exponential=Math.min(maxRetryAfterMs,this.retryMs*2**attempt);
    await delay(Math.max(exponential,error.retryMs||0),undefined,{signal});
   }
  }
 }
}

const supports=(provider,operation,chainId)=>typeof provider?.supports==='function'?(provider.supports.length>=2?provider.supports(operation,chainId):provider.supports(chainId)):false;
const breakerKey=(provider,chainId)=>`${provider}:${chainId}`;
export class WalletProviderRouter{
 constructor({alchemy=new AlchemyWalletProvider({apiKey:process.env.ALCHEMY_API_KEY||''}),blockscout=new BlockscoutProvider(),now=Date.now}={}){
  this.providers={alchemy,blockscout};this.alchemy=alchemy;this.blockscout=blockscout;this.now=now;this.health=new Map();this.gates=Object.fromEntries(Object.entries(PROVIDER_LIMITS).map(([name,config])=>[name,new ProviderGate(config)]));
 }
 validate(query){if(query.provider==='alchemy'&&!this.alchemy.configured)throw new Error('Alchemy API klíč není nastavený na serveru.');}
 #state(provider,chainId){const key=breakerKey(provider,chainId),state=this.health.get(key);if(state?.blockedUntil&&state.blockedUntil<=this.now()){const recovered={failures:0,blockedUntil:0,reason:null};this.health.set(key,recovered);return recovered;}return state||{failures:0,blockedUntil:0,reason:null};}
 #open(provider,chainId){const state=this.#state(provider,chainId);return state.blockedUntil>this.now()?state:null;}
 #blockscoutAllowed(operation,chainId){return operation==='wallets'?fallbackNetworks.has(chainId)||chainId==='robinhood'&&supports(this.blockscout,operation,chainId):supports(this.blockscout,operation,chainId);}
 #route(task){
  const operation=task.kind,chainId=task.chainId,requested=task.requestedProvider||'auto';
  if(requested==='blockscout')return this.#blockscoutAllowed(operation,chainId)?{provider:'blockscout'}:null;
  if(requested==='alchemy')return supports(this.alchemy,operation,chainId)?{provider:'alchemy'}:null;
  if(operation==='holders')return supports(this.blockscout,operation,chainId)?{provider:'blockscout'}:null;
  if(supports(this.alchemy,'wallets',chainId)){
   const opened=this.#open('alchemy',chainId);
   if(opened&&this.#blockscoutAllowed('wallets',chainId))return {provider:'blockscout',fallbackFrom:'alchemy',fallbackReason:opened.reason||'Jistič Alchemy je dočasně otevřen.'};
   return {provider:'alchemy'};
  }
  if(this.#blockscoutAllowed('wallets',chainId))return {provider:'blockscout'};
  return null;
 }
 supports(task){return !!this.#route(task);}
 route(task){return this.#route(task);}
 choose(task){return this.#route(task)?.provider||'blockscout';}
 cacheKey(kind){return kind==='wallets'?`wallet-router-v2:${this.alchemy.configured?'alchemy':'no-alchemy'}:${this.blockscout.proApiKey?'blockscout-pro':'blockscout-public'}`:'';}
 metadata(task,signal){return this.gates.blockscout.run(()=>this.blockscout.metadata(task,signal),signal);}
 async page(task,signal){
  const adapter=this.providers[task.provider];if(!adapter||!supports(adapter,task.kind,task.chainId))throw new Error(`${task.provider||'Zvolený poskytovatel'} nepodporuje tuto operaci a síť.`);
  const opened=this.#open(task.provider,task.chainId);if(opened)throw new AlchemyFailure('cooldown',opened.reason||'Poskytovatel je dočasně vyřazen z provozu.');
  try{const page=await this.gates[task.provider].run(()=>adapter.page(task,signal),signal);this.health.delete(breakerKey(task.provider,task.chainId));return page;}
  catch(error){
   if(signal?.aborted)throw error;
   const key=breakerKey(task.provider,task.chainId),previous=this.#state(task.provider,task.chainId),next={...previous,reason:error.message};
   if(error.retryable){next.failures=previous.failures+1;if(next.failures>=breakerThreshold){next.blockedUntil=this.now()+breakerCooldownMs;next.reason=`Jistič ${task.provider} pro ${getNetwork(task.chainId).name} otevřen po ${breakerThreshold} opakovaných chybách: ${error.message}`;}}
   else if(task.provider==='alchemy'&&error.kind==='quota'){next.blockedUntil=this.now()+quotaCooldownMs;next.reason=`Alchemy: kredit nebo měsíční limit; další pokus za 30 minut.`;}
   this.health.set(key,next);throw error;
  }
 }
 fallback(task,error){return task.provider==='alchemy'&&this.#blockscoutAllowed('wallets',task.chainId)&&(error.retryable||error.kind==='quota'||error.kind==='protection'||error.kind==='cooldown')?'blockscout':null;}
 fallbackReason(task,error){const state=this.#state(task.provider,task.chainId);return error.kind==='cooldown'?state.reason||error.message:error.message;}
 fallbackUnavailable(task){return task.provider==='alchemy'&&!this.#blockscoutAllowed('wallets',task.chainId)?' Záloha Blockscout pro tuto síť není dostupná.':'';}
 recordFailure(task,error){return this.health.get(breakerKey(task.provider,task.chainId));}
 status(){
  const chains=NETWORKS.map(n=>n.id),autoRoutes=chains.map(chainId=>({chainId,route:this.#route({kind:'wallets',chainId,requestedProvider:'auto'})}));
  const breakers=[...this.health.entries()].filter(([,v])=>v.blockedUntil>this.now()).map(([key,v])=>({provider:key.slice(0,key.indexOf(':')),chainId:key.slice(key.indexOf(':')+1),cooldownUntil:new Date(v.blockedUntil).toISOString(),failures:v.failures,reason:v.reason}));
  const alchemyChains=chains.filter(id=>supports(this.alchemy,'wallets',id)),blockscoutChains=chains.filter(id=>this.#blockscoutAllowed('wallets',id));
  return {walletProfiler:{alchemyConfigured:!!this.alchemy.configured,blockscoutConfigured:!!this.blockscout.proApiKey,blockscoutPublicAvailable:true,primary:this.alchemy.configured?'alchemy':'blockscout',availableChains:autoRoutes.filter(x=>x.route).map(x=>x.chainId),alchemyChains,fallbackChains:chains.filter(id=>fallbackNetworks.has(id)),blockscoutChains,routes:autoRoutes.map(({chainId,route})=>({chainId,provider:route?.provider||null,fallbackFrom:route?.fallbackFrom||null})),supportedOperations:{alchemy:{wallets:alchemyChains,holders:[]},blockscout:{wallets:blockscoutChains,holders:chains.filter(id=>supports(this.blockscout,'holders',id))}},circuitBreakers:breakers,message:breakers.length?breakers.map(b=>b.reason).join(' '):this.alchemy.configured?'Wallet Analyzer používá Alchemy s povoleným fallbackem podle sítě.':'Alchemy API klíč není nastavený; dostupné jsou pouze povolené trasy Blockscout.'}};
 }
}
