import '../server/load-env.mjs';
import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';

const db=new DatabaseSync('.data/chaindetective.sqlite',{readOnly:true});
const row=db.prepare("SELECT t.address,t.metadata,s.created_at,s.id FROM scans s JOIN tasks t ON t.scan_id=s.id WHERE t.chain_id='robinhood' AND t.metadata LIKE '%PONS%' ORDER BY s.created_at DESC LIMIT 1").get();
db.close();
if(!row)throw new Error('PONS kontrakt nebyl nalezen v read-only SQLite historii.');
const token=JSON.parse(row.metadata),contract=row.address,key=process.env.BLOCKSCOUT_API_KEY?.trim()||'';
const hosts={public:'https://robinhoodchain.blockscout.com',pro:'https://api.blockscout.com/4663'};
const timeoutMs=25000;
const results=[];
function headersOf(response){const wanted=['retry-after','x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-reset','ratelimit-limit','ratelimit-remaining','ratelimit-reset'];return Object.fromEntries(wanted.map(name=>[name,response.headers.get(name)]).filter(([,value])=>value!==null));}
async function request(label,url,expectedOffset){
 const start=performance.now();let response,body,text='';
 try{
  response=await fetch(url,{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
  text=await response.text();try{body=JSON.parse(text);}catch{}
 }catch(error){const result={label,status:null,latencyMs:+(performance.now()-start).toFixed(1),error:`${error.name}: ${error.message}`,rows:[]};results.push(result);return result;}
 const elapsed=+(performance.now()-start).toFixed(1),items=Array.isArray(body?.items)?body.items:Array.isArray(body?.result)?body.result:[];
 const rows=items.map(item=>({address:String(item.address?.hash||item.address_hash||item.address||'').toLowerCase(),balance:String(item.value??item.balance??'')}));
 const valid=rows.filter(item=>/^0x[0-9a-f]{40}$/.test(item.address)&&/^\d+$/.test(item.balance));
 const duplicates=valid.length-new Set(valid.map(item=>item.address)).size;
 let desc=true;for(let i=1;i<valid.length;i++){if(BigInt(valid[i-1].balance)<BigInt(valid[i].balance)){desc=false;break;}}
 const result={label,status:response.status,ok:response.ok,latencyMs:elapsed,contentType:response.headers.get('content-type'),headers:headersOf(response),message:body?.message??null,apiStatus:body?.status??null,nextCursor:body?.next_page_params??null,rows:valid,actualRows:items.length,validRows:valid.length,duplicates,descending:valid.length>1?desc:null,requestedOffset:expectedOffset??null,fewerThanRequested:expectedOffset?items.length<expectedOffset:null,...(!body?{bodyPreview:text.slice(0,250)}:{})};
 results.push(result);return result;
}
function v2Url(host,pageCursor){const url=new URL(`${host}/api/v2/tokens/${contract}/holders`);if(pageCursor)for(const [name,value]of Object.entries(pageCursor))if(value!==null)url.searchParams.set(name,String(value));if(host===hosts.pro&&key)url.searchParams.set('apikey',key);return url;}
function legacyUrl(host,{page,offset,apiKey=false}){const url=new URL(`${host}/api`);url.searchParams.set('module','token');url.searchParams.set('action','getTokenHolders');url.searchParams.set('contractaddress',contract);url.searchParams.set('page',String(page));url.searchParams.set('offset',String(offset));if(apiKey&&key)url.searchParams.set('apikey',key);return url;}
function normalizedPair(row){return `${row.address}:${row.balance}`;}
function compare(a,b,count){const left=a?.rows.slice(0,count)||[],right=b?.rows.slice(0,count)||[],leftByAddress=new Map(left.map(item=>[item.address,item.balance])),rightByAddress=new Map(right.map(item=>[item.address,item.balance]));let matched=0,mismatched=0,missing=0,extra=0;for(const [address,balance]of leftByAddress){if(!rightByAddress.has(address))missing++;else if(rightByAddress.get(address)===balance)matched++;else mismatched++;}for(const address of rightByAddress.keys())if(!leftByAddress.has(address))extra++;return {compared:Math.min(count,left.length,right.length),matched,mismatched,missing,extra,completeBoth:left.length>=count&&right.length>=count,exactOrderAndBalanceMatch:left.length>=count&&right.length>=count&&left.every((item,index)=>normalizedPair(item)===normalizedPair(right[index]))};}
const baseline=[];
let cursor=null;
for(let page=1;page<=2;page++){
 const r=await request(`REST v2 PRO page ${page}`,v2Url(hosts.pro,cursor));baseline.push(r);
 // The REST v2 cursor is passed forward exactly as returned by the endpoint.
 cursor=r.nextCursor||null;
 if(!cursor)break;
}

const publicLegacy=[];
for(const offset of [100,500,1000])publicLegacy.push(await request(`Legacy public offset=${offset} page=1`,legacyUrl(hosts.public,{page:1,offset}),offset));
const publicPage2=await request('Legacy public offset=500 page=2',legacyUrl(hosts.public,{page:2,offset:500}),500);
const proNoKey=await request('Legacy PRO no key offset=100 page=1',legacyUrl(hosts.pro,{page:1,offset:100}),100);
const proLegacy=[];
for(const offset of [100,500,1000])proLegacy.push(await request(`Legacy PRO with key offset=${offset} page=1`,legacyUrl(hosts.pro,{page:1,offset,apiKey:true}),offset));
const proPage2=await request('Legacy PRO with key offset=500 page=2',legacyUrl(hosts.pro,{page:2,offset:500,apiKey:true}),500);

const v2Rows=baseline.flatMap(r=>r.rows||[]),legacy100=proLegacy[0],legacy500=proLegacy[1];
const comparison=compare({rows:v2Rows.slice(0,100)},legacy100,100);
const legacy500Rows=legacy500?.rows||[],page2Rows=proPage2.rows||[];
const page2Duplicate=page2Rows.filter(x=>legacy500Rows.some(y=>x.address===y.address)).length;
const boundary=legacy500Rows.length&&page2Rows.length?{lastPage1:legacy500Rows.at(-1),firstPage2:page2Rows[0],descending:BigInt(legacy500Rows.at(-1).balance)>=BigInt(page2Rows[0].balance)}:null;
console.log(JSON.stringify({
 benchmark:'Robinhood Blockscout legacy token holders (read-only)',
 pons:{contract,symbol:token.symbol,decimals:token.decimals,referenceScan:{id:row.id,createdAt:row.created_at}},
 configuration:{publicHost:hosts.public,proHost:hosts.pro,apiKeyConfigured:!!key,keyPrinted:false},
 requests:results.map(({label,status,ok,latencyMs,contentType,headers,message,apiStatus,nextCursor,actualRows,validRows,duplicates,descending,requestedOffset,fewerThanRequested,error,bodyPreview,rows})=>({label,status,ok,latencyMs,contentType,headers,message,apiStatus,nextCursor,actualRows,validRows,duplicates,descending,requestedOffset,fewerThanRequested,error,bodyPreview,first:rows?.[0]||null,last:rows?.at(-1)||null})),
 comparisons:{restV2ProFirst100VsLegacyProOffset100:comparison,legacyProOffset500Pagination:{page1Rows:legacy500?.validRows||0,page2Rows:proPage2.validRows,duplicateAddressesAcrossPages:page2Duplicate,boundary,first100MatchWithRest:compare({rows:v2Rows.slice(0,100)},legacy500,100)}},
 priorPonsEstimate:{observedInCurrentDb:{pages:token.thresholdDiagnostics?.pagesFetched||null,positions:7750},historicalReferencePositions:64549,requestEstimateAtPages:{restV2_50:Math.ceil(64549/50),legacy100:Math.ceil(64549/100),legacy500:Math.ceil(64549/500),legacy1000:Math.ceil(64549/1000)}}
},null,2));
