import {setTimeout as delay} from 'node:timers/promises';
import {getNetwork, getToken, isAddress} from '../dist/data.js';

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
 constructor({fetchImpl=globalThis.fetch,intervalMs=400,retries=3,timeoutMs=20000}={}){Object.assign(this,{fetchImpl,intervalMs,retries,timeoutMs});this.nextRequest=0;}
 async request(chainId,route,cursor,signal){
  const n=getNetwork(chainId);if(!n?.live)throw new Error(`${n?.name||chainId}: živý adaptér zatím není dostupný.`);
  const url=new URL(`${n.api}/${route}`);
  if(cursor){if(typeof cursor!=='object'||Array.isArray(cursor)||JSON.stringify(cursor).length>4096)throw new Error('Neplatný kurzor indexeru.');for(const [k,v]of Object.entries(cursor)){if(v!==null){if(!['string','number','boolean'].includes(typeof v))throw new Error('Neplatná položka kurzoru.');url.searchParams.set(k,String(v));}}}
  for(let attempt=0;attempt<=this.retries;attempt++){
   signal?.throwIfAborted();
   const now=Date.now(),wait=Math.max(0,this.nextRequest-now);this.nextRequest=Math.max(now,this.nextRequest)+this.intervalMs;
   if(wait)await delay(wait,undefined,{signal});
   try{
    const timeout=AbortSignal.timeout(this.timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    const response=await this.fetchImpl(url,{signal:combined,headers:{Accept:'application/json'},redirect:'error'});
    if(!response.ok){const error=new Error(response.status===429?'Limit indexeru (HTTP 429).':`Indexer odpověděl HTTP ${response.status}.`);error.retryable=response.status===429||response.status>=500;const after=Number(response.headers?.get?.('retry-after'));error.retryMs=Number.isFinite(after)?Math.min(60000,Math.max(0,after*1000)):0;throw error;}
    const body=await response.json();if(!body||typeof body!=='object')throw new Error('Neplatná odpověď indexeru.');return body;
   }catch(error){
    if(signal?.aborted)throw signal.reason;
    const retryable=error.retryable||error.name==='TimeoutError'||error.name==='TypeError';
    if(!retryable||attempt===this.retries)throw new Error(`${error.message} Uložený průběh lze obnovit.`);
    await delay(Math.max(error.retryMs||0,Math.min(8000,500*2**attempt)),undefined,{signal});
   }
  }
 }
 async metadata(task,signal){const item=await this.request(task.chainId,`tokens/${task.address}`,null,signal);if(item.type&&item.type!=='ERC-20')throw new Error('Podporovány jsou pouze ERC-20 tokeny.');return decodeToken(item,task.chainId,task.address);}
 async page(task,signal){
  const route=task.kind==='holders'?`tokens/${task.address}/holders`:`addresses/${task.address}/tokens?type=ERC-20`;
  const body=await this.request(task.chainId,route,task.cursor,signal);
  if(!Array.isArray(body.items))throw new Error('Indexer nevrátil seznam položek.');
  return {items:body.items,cursor:body.next_page_params&&Object.keys(body.next_page_params).length?body.next_page_params:null};
 }
}
