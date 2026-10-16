import './load-env.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {IGNORED_WALLET_ADDRESS_ERROR,getNetwork, getToken, isAddress,isIgnoredWalletAddress} from '../dist/data.js';

export function decodeToken(item,chainId,fallback){
 const address=String(item.address_hash||item.address||fallback||'').toLowerCase();
 if(!isAddress(address))throw new Error('Indexer vrátil neplatný kontrakt.');
 const known=getToken(address,chainId);
 const d=item.decimals===null||item.decimals===undefined||item.decimals===''?null:Number(item.decimals);
 const rate=item.exchange_rate;
 return {id:`${chainId}:${address}`,address,chainId,symbol:item.symbol||known?.symbol||'ERC-20',name:item.name||known?.name||'Neznámý token',decimals:Number.isInteger(d)&&d>=0&&d<=255?d:known?.decimals??null,price:rate!==null&&rate!==undefined&&rate!==''&&Number.isFinite(Number(rate))&&Number(rate)>=0?Number(rate):null};
}
export function decodeHolding(token,raw){
 const rawAmount=String(raw??'');
 if(!/^\d+$/.test(rawAmount))throw new Error('Neplatný zůstatek z indexeru.');
 if(BigInt(rawAmount)===0n)return null;
 if(token.decimals===null)throw new Error('Nenulová pozice nemá údaj o desetinných místech.');
 const padded=rawAmount.padStart(token.decimals+1,'0');
 const amount=Number(token.decimals?`${padded.slice(0,-token.decimals)}.${padded.slice(-token.decimals)}`:padded);
 if(!Number.isFinite(amount)||amount<=0)throw new Error('Zůstatek nelze bezpečně zobrazit.');
 const value=token.price===null?null:amount*token.price;
 return {...token,tokenId:token.id,rawAmount,amount,value:Number.isFinite(value)?value:null};
}
export class BlockscoutProvider{
 constructor({fetchImpl=globalThis.fetch,intervalMs=400,retries=3,timeoutMs=20000,proApiKey=process.env.BLOCKSCOUT_API_KEY||''}={}){Object.assign(this,{fetchImpl,intervalMs,retries,timeoutMs,proApiKey:proApiKey.trim()});this.nextRequest=0;}
 supports(operation,chainId){return ['wallets','holders'].includes(operation)&&!!getNetwork(chainId)?.live;}
 async request(chainId,route,cursor,signal){
  const n=getNetwork(chainId);if(!n?.live)throw new Error(`${n?.name||chainId}: živý adaptér zatím není dostupný.`);
  if(cursor&&(typeof cursor!=='object'||Array.isArray(cursor)||JSON.stringify(cursor).length>4096))throw new Error('Neplatný kurzor indexeru.');
  const directPro=n.chainId===4663&&!!this.proApiKey;
  const makeUrl=pro=>{
   const url=new URL(pro?`https://api.blockscout.com/${n.chainId}/api/v2/${route}`:`${n.api}/${route}`);
   if(cursor)for(const [k,v]of Object.entries(cursor)){if(v!==null){if(!['string','number','boolean'].includes(typeof v))throw new Error('Neplatná položka kurzoru.');url.searchParams.set(k,String(v));}}
   if(pro)url.searchParams.set('apikey',this.proApiKey);
   return url;
  };
  // Robinhood's public explorer host returns an HTML 403 challenge; with a Pro key use its verified API directly.
  const url=makeUrl(directPro);
  for(let attempt=0;attempt<=this.retries;attempt++){
   signal?.throwIfAborted();
   const now=Date.now(),wait=Math.max(0,this.nextRequest-now);this.nextRequest=Math.max(now,this.nextRequest)+this.intervalMs;
   if(wait)await delay(wait,undefined,{signal});
   try{
    const timeout=AbortSignal.timeout(this.timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    let response=await this.fetchImpl(url,{signal:combined,headers:{Accept:'application/json'},redirect:'error'});
    if(response.status===403&&this.proApiKey&&!directPro){
     await response.body?.cancel();
     const proUrl=makeUrl(true);
     response=await this.fetchImpl(proUrl,{signal:combined,headers:{Accept:'application/json'},redirect:'error'});
    }
    if(!response.ok){const htmlChallenge=response.status===403&&/text\/html/i.test(response.headers?.get?.('content-type')||'');const error=new Error(response.status===429?'Limit indexeru (HTTP 429).':htmlChallenge?'Indexer odpověděl HTTP 403 (HTML challenge místo JSON).':`Indexer odpověděl HTTP ${response.status}.`);error.retryable=response.status===429||response.status>=500||htmlChallenge;const retryHeader=response.headers?.get?.('retry-after'),seconds=Number(retryHeader),retryDate=Date.parse(retryHeader||'');const retryMs=Number.isFinite(seconds)?seconds*1000:Number.isFinite(retryDate)?retryDate-Date.now():0;error.retryMs=Math.min(10000,Math.max(0,retryMs));throw error;}
    let body;try{body=await response.json();}catch{const error=new Error('Neplatná JSON odpověď indexeru.');error.retryable=true;throw error;}if(!body||typeof body!=='object'){const error=new Error('Neplatná odpověď indexeru.');error.retryable=true;throw error;}return body;
   }catch(error){
    if(signal?.aborted)throw signal.reason;
    if(error.name==='TypeError'){error=new Error('Indexer: připojení selhalo nebo vypršel čas požadavku.');error.retryable=true;}
    const retryable=error.retryable||error.name==='TimeoutError';
    if(!retryable||attempt===this.retries){const finalError=new Error(`${error.message} Uložený průběh lze obnovit.`);finalError.retryable=!!retryable;finalError.retryMs=error.retryMs||0;throw finalError;}
    await delay(Math.max(error.retryMs||0,Math.min(8000,500*2**attempt)),undefined,{signal});
   }
  }
 }
 async metadata(task,signal){const item=await this.request(task.chainId,`tokens/${task.address}`,null,signal);if(item.type&&item.type!=='ERC-20')throw new Error('Podporovány jsou pouze ERC-20 tokeny.');return decodeToken(item,task.chainId,task.address);}
 async page(task,signal){
  if(task.kind==='wallets'&&isIgnoredWalletAddress(task.address))throw new Error(IGNORED_WALLET_ADDRESS_ERROR);
  const route=task.kind==='holders'?`tokens/${task.address}/holders`:`addresses/${task.address}/tokens?type=ERC-20`;
  const body=await this.request(task.chainId,route,task.cursor,signal);
  if(!Array.isArray(body.items))throw new Error('Indexer nevrátil seznam položek.');
  return {items:body.items,cursor:body.next_page_params&&Object.keys(body.next_page_params).length?body.next_page_params:null};
 }
}

// Blockscout Legacy PRO exposes a larger, sequential page-number holder API.
// It is deliberately limited to the networks verified against Legacy PRO;
// wallet portfolio requests and token metadata continue through v2.
export const BLOCKSCOUT_LEGACY_HOLDER_NETWORKS=Object.freeze(new Set(['ethereum','optimism','robinhood']));
export const BLOCKSCOUT_LEGACY_HOLDER_PAGE_SIZE=1000;
export class BlockscoutLegacyHolderProvider{
 constructor({fetchImpl=globalThis.fetch,apiKey=process.env.BLOCKSCOUT_API_KEY||'',timeoutMs=20000,retries=2}={}){Object.assign(this,{fetchImpl,apiKey:apiKey.trim(),timeoutMs,retries});}
 supports(operation,chainId){return operation==='holders'&&!!this.apiKey&&BLOCKSCOUT_LEGACY_HOLDER_NETWORKS.has(chainId)&&!!getNetwork(chainId)?.live;}
 async page(task,signal){
  if(!this.supports(task.kind,task.chainId))throw new Error('Blockscout Legacy PRO není nakonfigurovaný pro tuto holder úlohu.');
  if(task.cursor&&(task.cursor.mode!=='blockscout_legacy'||!Number.isInteger(task.cursor.page)||task.cursor.page<1||task.cursor.pageSize!==BLOCKSCOUT_LEGACY_HOLDER_PAGE_SIZE))throw new Error('Neplatný Blockscout Legacy kurzor.');
  const page=task.cursor?.page||1,url=new URL(`https://api.blockscout.com/${getNetwork(task.chainId).chainId}/api`);
  url.searchParams.set('module','token');url.searchParams.set('action','getTokenHolders');url.searchParams.set('contractaddress',task.address);url.searchParams.set('page',String(page));url.searchParams.set('offset',String(BLOCKSCOUT_LEGACY_HOLDER_PAGE_SIZE));url.searchParams.set('apikey',this.apiKey);
  for(let attempt=0;attempt<=this.retries;attempt++){
   signal?.throwIfAborted();
   try{
    const timeout=AbortSignal.timeout(this.timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    const response=await this.fetchImpl(url,{signal:combined,headers:{Accept:'application/json'},redirect:'error'});
    let body;try{body=await response.json();}catch{const error=new Error('Blockscout Legacy vrátil neplatnou JSON odpověď.');error.retryable=true;throw error;}
    if(!response.ok){const error=new Error(response.status===429?'Blockscout Legacy limit požadavků (HTTP 429).':`Blockscout Legacy odpověděl HTTP ${response.status}.`);error.retryable=response.status===429||response.status>=500;const retry= response.headers?.get?.('retry-after'),seconds=Number(retry),date=Date.parse(retry||'');error.retryMs=Math.min(10000,Math.max(0,Number.isFinite(seconds)?seconds*1000:Number.isFinite(date)?date-Date.now():0));throw error;}
    if(!body||typeof body!=='object'){const error=new Error('Blockscout Legacy vrátil neplatnou odpověď.');error.retryable=true;throw error;}
    const records=Array.isArray(body.result)?body.result:Array.isArray(body.items)?body.items:null;
    if(!records){const message=String(body.message||body.result||body.error?.message||'Neznámá chyba API');if(/no records found|no holders found|no data found/i.test(message))return {items:[],cursor:null};const error=new Error(`Blockscout Legacy: ${message}`);error.retryable=body.status==='0'&&/rate|temporar|busy|limit/i.test(message);throw error;}
    const items=records.map(record=>({address:{hash:String(record.TokenHolderAddress??(typeof record.address==='string'?record.address:record.address?.hash)??record.address_hash??'').toLowerCase()},value:String(record.TokenHolderQuantity??record.value??record.balance??'')}));
    if(items.length>BLOCKSCOUT_LEGACY_HOLDER_PAGE_SIZE)throw new Error('Blockscout Legacy překročil ověřenou velikost stránky.');
    return {items,cursor:items.length===BLOCKSCOUT_LEGACY_HOLDER_PAGE_SIZE?{mode:'blockscout_legacy',page:page+1,pageSize:BLOCKSCOUT_LEGACY_HOLDER_PAGE_SIZE}:null};
   }catch(error){
    if(signal?.aborted)throw signal.reason;
    if(error.name==='TypeError'||error.name==='TimeoutError'){error=new Error('Blockscout Legacy: připojení selhalo nebo vypršel čas požadavku.');error.retryable=true;}
    if(!error.retryable||attempt===this.retries){const finalError=new Error(`${error.message} Uložený průběh lze obnovit.`);finalError.retryable=!!error.retryable;finalError.retryMs=error.retryMs||0;throw finalError;}
    await delay(Math.max(error.retryMs||0,Math.min(8000,500*2**attempt)),undefined,{signal});
   }
  }
 }
}
