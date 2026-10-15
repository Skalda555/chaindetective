import {setTimeout as delay} from 'node:timers/promises';
import {NETWORKS,getNetwork,isAddress} from '../dist/data.js';
import {BlockscoutProvider} from './provider.mjs';

const networks={ethereum:'eth-mainnet',base:'base-mainnet',arbitrum:'arb-mainnet',optimism:'opt-mainnet',zksync:'zksync-mainnet',scroll:'scroll-mainnet',linea:'linea-mainnet'};
export class AlchemyFailure extends Error{
 constructor(kind,message){super(message);this.kind=kind;}
}
function classify(status,payload){
 const message=JSON.stringify(payload||'').toLowerCase();
 if(/per second|per-second|throughput/.test(message)&&!/(monthly|credit|quota)/.test(message))return new AlchemyFailure('rate','Alchemy: krátkodobý limit požadavků.');
 if(/monthly.{0,40}(capacity|limit|quota)|(?:credit|quota|compute units|compute unit|spending|spend).{0,50}(?:exhaust|exceed|deplet|limit reached|insufficient)|insufficient.{0,30}(?:credit|balance)|(?:exhaust|exceed).{0,40}(?:monthly|credit|quota)/.test(message)||status===402)return new AlchemyFailure('quota','Alchemy: vyčerpaný kredit nebo měsíční limit.');
 if(status===429||payload?.error?.code===429)return new AlchemyFailure('rate','Alchemy: krátkodobý limit požadavků.');
 if(status===401||/invalid (?:access|api) key|must be authenticated/.test(message))return new AlchemyFailure('auth','Alchemy: neplatný nebo neautorizovaný API klíč.');
 if(status===403)return new AlchemyFailure('access','Alchemy: přístup k endpointu nebyl povolen; nejde o potvrzené vyčerpání kreditu.');
 if(status>=500||payload?.error?.partialErrors)return new AlchemyFailure('outage','Alchemy: síť nebo služba je dočasně nedostupná.');
 return new Error('Alchemy: požadavek se nepodařilo zpracovat.');
}
export class AlchemyWalletProvider{
 #key;
 constructor({apiKey='',fetchImpl=globalThis.fetch,timeoutMs=20000,retries=2,retryMs=500}={}){this.#key=apiKey.trim();Object.assign(this,{fetchImpl,timeoutMs,retries,retryMs});}
 get configured(){return !!this.#key;}
 supports(chainId){return this.configured&&!!networks[chainId];}
 async page(task,signal){
  if(!this.supports(task.chainId))throw new AlchemyFailure('access','Alchemy není pro tuto síť nakonfigurované.');
  if(!isAddress(task.address))throw new Error('Neplatná adresa peněženky.');
  if(task.cursor?.pageKey!==undefined&&(typeof task.cursor.pageKey!=='string'||task.cursor.pageKey.length>4096))throw new Error('Neplatný kurzor Alchemy.');
  const url='https://api.g.alchemy.com/data/v1/'+encodeURIComponent(this.#key)+'/assets/tokens/by-address';
  const body={addresses:[{address:task.address,networks:[networks[task.chainId]]}],withMetadata:true,withPrices:true,includeNativeTokens:false,includeErc20Tokens:true,...(task.cursor?.pageKey?{pageKey:task.cursor.pageKey}:{})};
  for(let attempt=0;;attempt++){
   signal?.throwIfAborted();
   try{
    const timeout=AbortSignal.timeout(this.timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    const response=await this.fetchImpl(url,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(body),signal:combined,redirect:'error'});
    let payload;try{payload=await response.json();}catch{throw new AlchemyFailure('outage','Alchemy: neplatná odpověď služby.');}
    if(!response.ok||payload.error)throw classify(response.status,payload);
    if(!Array.isArray(payload.data?.tokens))throw new AlchemyFailure('outage','Alchemy: odpověď neobsahuje seznam tokenů.');
    const pageKey=payload.data.pageKey??payload.pageKey;
    if(pageKey!==undefined&&pageKey!==null&&(typeof pageKey!=='string'||pageKey.length>4096))throw new Error('Alchemy vrátilo neplatný kurzor.');
    const items=payload.data.tokens.filter(t=>t.tokenAddress!==null).map(t=>{
     if(t.address?.toLowerCase()!==task.address.toLowerCase()||t.network!==networks[task.chainId])throw new Error('Alchemy vrátilo data jiné adresy nebo sítě.');
     if(!isAddress(t.tokenAddress)||typeof t.tokenBalance!=='string'||!/^0x[\da-f]+$/i.test(t.tokenBalance))return {token:{},value:null};
     const metadata=t.tokenMetadata||{},usd=t.tokenPrices?.find(p=>p.currency?.toLowerCase()==='usd');
     return {token:{address_hash:t.tokenAddress,name:metadata.name,symbol:metadata.symbol,decimals:metadata.decimals,exchange_rate:usd?.value??null},value:BigInt(t.tokenBalance).toString()};
    });
    return {items,cursor:pageKey?{pageKey}:null};
   }catch(error){
    if(signal?.aborted)throw signal.reason;
    // Never expose native fetch errors: their URLs can contain the API key.
    if(error.name==='TypeError'||error.name==='TimeoutError')error=new AlchemyFailure('outage','Alchemy: připojení selhalo nebo vypršel čas požadavku.');
    if(!['rate','outage'].includes(error.kind)||attempt>=this.retries)throw error;
    await delay(this.retryMs*2**attempt,undefined,{signal});
   }
  }
 }
}
export class WalletProviderRouter{
 constructor({alchemy=new AlchemyWalletProvider({apiKey:process.env.ALCHEMY_API_KEY||''}),blockscout=new BlockscoutProvider(),now=Date.now}={}){Object.assign(this,{alchemy,blockscout,now});this.blockedUntil=0;this.blockedReason=null;}
 validate(query){if(query.provider==='alchemy'&&!this.alchemy.configured)throw new Error('Alchemy API klíč není nastavený na serveru.');}
 supports(task){if(task.requestedProvider==='blockscout')return !!getNetwork(task.chainId)?.live;if(task.requestedProvider==='alchemy')return task.kind==='wallets'&&this.alchemy.supports(task.chainId);return task.kind==='wallets'&&this.alchemy.supports(task.chainId)||!!getNetwork(task.chainId)?.live;}
 choose(task){if(task.requestedProvider==='blockscout')return 'blockscout';return task.kind==='wallets'&&this.alchemy.supports(task.chainId)?'alchemy':'blockscout';}
 cacheKey(kind){return kind==='wallets'&&this.alchemy.configured?'alchemy-first-v1':'';}
 metadata(task,signal){return this.blockscout.metadata(task,signal);}
 async page(task,signal){
  if(task.provider!=='alchemy')return this.blockscout.page(task,signal);
  if(this.now()<this.blockedUntil)throw new AlchemyFailure('cooldown',this.blockedReason);
  try{return await this.alchemy.page(task,signal);}catch(error){
   if(error instanceof AlchemyFailure&&!signal?.aborted){
    this.blockedReason=error.message;
    this.blockedUntil=this.now()+(['quota','auth','access'].includes(error.kind)?30*60*1000:60*1000);
   }throw error;
  }
 }
 fallback(task,error){return task.provider==='alchemy'&&error instanceof AlchemyFailure&&getNetwork(task.chainId)?.live?'blockscout':null;}
 status(){return {walletProfiler:{alchemyConfigured:this.alchemy.configured,primary:this.alchemy.configured?'alchemy':'blockscout',availableChains:NETWORKS.filter(n=>n.live||this.alchemy.supports(n.id)).map(n=>n.id),fallbackChains:NETWORKS.filter(n=>n.live).map(n=>n.id),cooldownUntil:this.now()<this.blockedUntil?new Date(this.blockedUntil).toISOString():null,message:this.now()<this.blockedUntil?this.blockedReason:this.alchemy.configured?'Alchemy je nakonfigurované. Při vyčerpání kreditu se použije dostupná záloha Blockscout.':'Alchemy API klíč není nastavený. Používá se Blockscout.'}};}
}
