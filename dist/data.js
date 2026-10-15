/** ChainDetective data boundary. Demo data is synthetic. Live data is a bounded indexer sample. */
export const NETWORKS = [
  {id:'ethereum',chainId:1,name:'Ethereum',short:'ETH',color:'#8799d3',explorer:'https://eth.blockscout.com',api:'https://eth.blockscout.com/api/v2',live:true},
  {id:'base',chainId:8453,name:'Base',short:'BASE',color:'#3568f5',explorer:'https://base.blockscout.com',api:'https://base.blockscout.com/api/v2',live:true},
  {id:'arbitrum',chainId:42161,name:'Arbitrum',short:'ARB',color:'#49a8dc',explorer:'https://arbitrum.blockscout.com',api:'https://arbitrum.blockscout.com/api/v2',live:true},
  {id:'optimism',chainId:10,name:'Optimism',short:'OP',color:'#f05663',explorer:'https://explorer.optimism.io',api:'https://explorer.optimism.io/api/v2',live:true},
  {id:'zksync',chainId:324,name:'zkSync Era',short:'ZK',color:'#a692e1',explorer:'https://explorer.zksync.io',api:null,live:false},
  {id:'scroll',chainId:534352,name:'Scroll',short:'SCR',color:'#d7ab83',explorer:'https://scrollscan.com',api:null,live:false},
  {id:'linea',chainId:59144,name:'Linea',short:'LINEA',color:'#b1d6cc',explorer:'https://lineascan.build',api:null,live:false},
];
const token = (chainId,address,symbol,name,decimals,price,color) => ({id:`${chainId}:${address.toLowerCase()}`,chainId,address:address.toLowerCase(),symbol,name,decimals,price,color});
/** Prices below are fixed illustration values ONLY, never used to price live results. */
export const TOKENS = [
 token('arbitrum','0x912CE59144191C1204E64559FE8253a0e49E6548','ARB','Arbitrum',18,.57,'#4b9ee5'),
 token('arbitrum','0x82aF49447D8a07e3bd95BD0d56f35241523fBab1','WETH','Wrapped Ether',18,3260,'#99a1ce'),
 token('arbitrum','0xaf88d065e77c8cC2239327C5EDb3A432268e5831','USDC','USD Coin',6,1,'#478bce'),
 token('ethereum','0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2','WETH','Wrapped Ether',18,3260,'#99a1ce'),
 token('ethereum','0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48','USDC','USD Coin',6,1,'#478bce'),
 token('ethereum','0x6B175474E89094C44Da98b954EedeAC495271d0F','DAI','Dai Stablecoin',18,1,'#e2b659'),
 token('ethereum','0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984','UNI','Uniswap',18,7.24,'#dc78aa'),
 token('ethereum','0x514910771AF9Ca656af840dff83E8264EcF986CA','LINK','Chainlink',18,13.8,'#5e83dc'),
 token('ethereum','0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9','AAVE','Aave',18,152.4,'#ba88cf'),
 token('base','0x4200000000000000000000000000000000000006','WETH','Wrapped Ether',18,3260,'#99a1ce'),
 token('base','0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913','USDC','USD Coin',6,1,'#478bce'),
 token('optimism','0x4200000000000000000000000000000000000042','OP','Optimism',18,1.62,'#ee6672'),
 token('optimism','0x4200000000000000000000000000000000000006','WETH','Wrapped Ether',18,3260,'#99a1ce'),
 token('optimism','0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85','USDC','USD Coin',6,1,'#478bce'),
 token('zksync','0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91','WETH','Wrapped Ether',18,3260,'#99a1ce'),
 token('scroll','0x5300000000000000000000000000000000000004','WETH','Wrapped Ether',18,3260,'#99a1ce'),
 token('linea','0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f','WETH','Wrapped Ether',18,3260,'#99a1ce'),
];
const tokenById = new Map(TOKENS.map(t=>[t.id,t]));
const round = n => Math.round(n*100)/100;
const sumKnown = entries => {const priced=entries.filter(h=>Number.isFinite(h.value));return priced.length?round(priced.reduce((s,h)=>s+h.value,0)):null;};
const chainList = holdings => [...new Set(holdings.map(h=>h.chainId))];
const findToken = (symbol,chainId) => TOKENS.find(t=>t.symbol===symbol&&t.chainId===chainId);
function demoHolding(symbol,chainId,amount){const t=findToken(symbol,chainId);return {...t,tokenId:t.id,amount,value:round(amount*t.price)};}
const labels=['Atlas','Northstar','Cedar','Orbit','Meridian','Lumen','Vector','Aster','Pioneer','Summit','Nomad','Sierra','Quartz','Halo','Delta','Echo','Copper','Finch','Acorn','Solstice','Harbor','Willow','Ember','Mosaic'];
/** Invented identities/addresses and holdings: no real address is classified or labelled. */
export const DEMO_WALLETS = Array.from({length:24},(_,i)=>{
 const holdings=[];
 const scale=[24,18,15,12,10,8,6,5,4,3.2,2.7,2.2,1.8,1.5,1.2,1,.8,.65,.5,.4,.3,.2,.15,.1][i];
 if(i<20)holdings.push(demoHolding('ARB','arbitrum',round((92000+i*4931)*scale)));
 if(i<16||i>=20)holdings.push(demoHolding('WETH','arbitrum',round((17+i*1.43)*scale)));
 if(i%3!==2)holdings.push(demoHolding('USDC','arbitrum',round((12300+i*3930)*scale)));
 if(i%2===0||i<4)holdings.push(demoHolding('WETH','ethereum',round((3.6+i*.38)*scale)));
 if(i%3===0||i<3)holdings.push(demoHolding('USDC','ethereum',round((8000+i*1000)*scale)));
 if(i%4===0)holdings.push(demoHolding('LINK','ethereum',round((560+i*70)*scale)));
 if(i%5===0)holdings.push(demoHolding('UNI','ethereum',round((1200+i*100)*scale)));
 if(i%6===0)holdings.push(demoHolding('AAVE','ethereum',round((26+i*4)*scale)));
 if(i%4===1)holdings.push(demoHolding('DAI','ethereum',round((3700+i*900)*scale)));
 if(i%2===1||i<5)holdings.push(demoHolding('USDC','base',round((13500+i*1850)*scale)));
 if(i%3===1)holdings.push(demoHolding('WETH','base',round((2.5+i*.6)*scale)));
 if(i%3===0||i<4)holdings.push(demoHolding('OP','optimism',round((7500+i*2130)*scale)));
 if(i%4===2)holdings.push(demoHolding('WETH','optimism',round((1.6+i*.3)*scale)));
 if(i%6===1)holdings.push(demoHolding('USDC','optimism',round(4310*scale)));
 if(i%5===2)holdings.push(demoHolding('WETH','zksync',round((.8+i*.13)*scale)));
 if(i%5===3)holdings.push(demoHolding('WETH','scroll',round((.4+i*.1)*scale)));
 if(i%5===4)holdings.push(demoHolding('WETH','linea',round((.5+i*.1)*scale)));
 const address='0x'+Array.from({length:5},(_,j)=>(Math.imul(i+17,0x9e3779b1+j*0x13579b)>>>0).toString(16).padStart(8,'0')).join('');
 return {address,label:`${labels[i]} · demo`,chainIds:chainList(holdings),holdings,value:sumKnown(holdings),matchedTokens:[],matchCount:0,isDemo:true};
});
export const isAddress = value => /^0x[0-9a-fA-F]{40}$/.test(value||'');
export const normalizeAddress = value => isAddress(value)?value.toLowerCase():null;
export const getToken = (address,chainId) => TOKENS.find(t=>t.chainId===chainId&&t.address===String(address).toLowerCase());
export const getNetwork = id => NETWORKS.find(n=>n.id===id||n.chainId===Number(id));
const abort = signal => {if(signal?.aborted)throw new DOMException('Sken byl zrušen.','AbortError');};
const progress = (callback,message,completed,total) => callback?.({message,completed,total});
function chains(ids){const selected=ids?.length?[...new Set(ids.map(id=>getNetwork(id)?.id||id))]:NETWORKS.map(n=>n.id);if(selected.some(id=>!getNetwork(id)))throw new Error('Neznámá síť.');return selected;}
function inputs(tokens,chainIds){
 if(!tokens?.length)throw new Error('Vyberte alespoň jeden token.');
 if(tokens.length>5)throw new Error('Jeden sken podporuje nejvýše pět tokenů.');
 const result=tokens.map(t=>{
  if(typeof t==='string')t=tokenById.get(t)||{address:t};
  if(!isAddress(t.address))throw new Error('Neplatná adresa kontraktu.');
  let chainId=getNetwork(t.chainId)?.id;
  if(!chainId){const found=TOKENS.filter(x=>x.address===t.address.toLowerCase()&&chainIds.includes(x.chainId));if(found.length===1)chainId=found[0].chainId;else if(chainIds.length===1)chainId=chainIds[0];else throw new Error('Ke každému kontraktu přiřaďte konkrétní síť.');}
  if(!chainIds.includes(chainId))throw new Error('Síť vybraného tokenu není zapnutá.');
  return {...getToken(t.address,chainId),...t,chainId,address:t.address.toLowerCase(),id:`${chainId}:${t.address.toLowerCase()}`};
 });
 return [...new Map(result.map(t=>[t.id,t])).values()];
}
function makeCoverage(source,message,details=[]){return {source,message,details,bounded:source==='live',complete:false,asOf:new Date().toISOString()};}
function walletResult(w,selected,chainIds,match,minValue){
 const holdings=w.holdings.filter(h=>chainIds.includes(h.chainId));
 const matchedTokens=selected.filter(t=>holdings.some(h=>h.tokenId===t.id&&h.amount>0));
 if(!(match==='any'?matchedTokens.length:matchedTokens.length===selected.length))return null;
 const value=sumKnown(holdings.filter(h=>selected.some(t=>t.id===h.tokenId)));
 if(minValue>0&&(value===null||value<minValue))return null;
 return {...w,holdings,chainIds:chainList(holdings),value,matchedTokens,matchCount:matchedTokens.length};
}
/** AND/OR across exact (network, contract) identities; wallet.value sums matching selected positions. */
export async function searchHolders({tokens,chainIds,match='all',minValue=0,source='demo',onProgress,signal,refresh=false,provider='auto'}={}){
 abort(signal);const selectedChains=chains(chainIds);const selected=inputs(tokens,selectedChains);
 if(!['all','any'].includes(match))throw new Error('Neznámý režim průniku.');
 if(!['demo','live'].includes(source))throw new Error('Neznámý zdroj dat.');
 if(source==='demo'){
  const unknown=selected.filter(t=>!tokenById.has(t.id));
  const wallets=DEMO_WALLETS.map(w=>walletResult(w,selected,selectedChains,match,minValue)).filter(Boolean).sort((a,b)=>(b.value??-1)-(a.value??-1));
  progress(onProgress,'Ukázkový dataset je připravený.',selected.length,selected.length);
  return {wallets,tokens:selected,source,warnings:unknown.map(t=>`Kontrakt ${t.address} na síti ${getNetwork(t.chainId).name} není součástí demo datasetu. Pro vlastní kontrakty přepněte na Live API.`),coverage:makeCoverage(source,`Syntetický dataset: ${DEMO_WALLETS.length} ukázkových peněženek. Kontrakty slouží pro orientaci; zůstatky, adresy, štítky i ceny jsou ilustrační.`)};
 }
 return runServerScan('holders',{tokens:selected,chainIds:selectedChains,match,refresh,onProgress,signal,provider});
}
/** Group by exact network+contract, not ticker; share is holderCount / submitted unique addresses (0..1). */
export function aggregateHoldings(wallets,addressCount=wallets.length){
 const groups=new Map();
 for(const w of wallets){for(const h of w.holdings){if(!(h.amount>0))continue;let g=groups.get(h.tokenId);if(!g){g={...h,amount:0,totalValue:null,holders:[],holderCount:0,share:0,pricedPositions:0,unpricedPositions:0};delete g.value;groups.set(h.tokenId,g);}g.amount+=h.amount;if(Number.isFinite(h.value)){g.totalValue=(g.totalValue??0)+h.value;g.pricedPositions++;}else g.unpricedPositions++;if(!g.holders.includes(w.address))g.holders.push(w.address);}}
 return [...groups.values()].map(g=>({...g,totalValue:g.totalValue===null?null:round(g.totalValue),holderCount:g.holders.length,share:addressCount?g.holders.length/addressCount:0})).sort((a,b)=>(b.totalValue??-1)-(a.totalValue??-1));
}
export async function analyzeWallets({addresses,chainIds,source='demo',onProgress,signal,refresh=false,provider='auto'}={}){
 abort(signal);const selectedChains=chains(chainIds);const submitted=[...new Set((addresses||[]).map(a=>String(a).toLowerCase()))];
 if(!submitted.length)throw new Error('Vložte alespoň jednu adresu peněženky.');
 if(submitted.length>20)throw new Error('Lze analyzovat nejvýše 20 adres najednou.');
 if(submitted.some(a=>!isAddress(a)))throw new Error('V seznamu je neplatná EVM adresa.');
 if(!['demo','live'].includes(source))throw new Error('Neznámý zdroj dat.');
 if(source==='demo'){
  const wallets=DEMO_WALLETS.filter(w=>submitted.includes(w.address)).map(w=>{const holdings=w.holdings.filter(h=>selectedChains.includes(h.chainId));return {...w,holdings,chainIds:chainList(holdings),value:sumKnown(holdings)};});
  const unknown=submitted.filter(a=>!DEMO_WALLETS.some(w=>w.address===a));
  progress(onProgress,'Ukázkové pozice jsou připravené.',submitted.length,submitted.length);
  return {wallets,tokens:aggregateHoldings(wallets,submitted.length),source,warnings:unknown.length?[`${unknown.length} adres není součástí demo datasetu. Nejsou jim přiřazeny žádné vymyšlené pozice; pro vlastní adresy použijte Live API.`]:[],coverage:makeCoverage(source,`Syntetická analýza ${wallets.length} známých demo adres z ${submitted.length} zadaných. Podíl adres používá počet všech zadaných unikátních adres. Zůstatky a USD ceny jsou ilustrační.`)};
 }
 return runServerScan('wallets',{addresses:submitted,chainIds:selectedChains,refresh,onProgress,signal,provider});
}

/** Live data is fetched only by the local server; the browser polls persisted scans. */
async function scanApi(route,{method='GET',body,signal,keepalive=false}={}){
 if(globalThis.location?.protocol==='file:')throw new Error('Live API vyžaduje lokální server. Spusťte npm run dev a otevřete http://127.0.0.1:4173.');
 const response=await fetch('/api/scans'+route,{method,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal,keepalive,credentials:'same-origin'});
 if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('Server nepodporuje ukládané skeny. Restartujte jej příkazem npm run dev.');
 const result=await response.json();if(!response.ok)throw new Error(result.error||'Serverový sken se nepodařilo načíst.');return result;
}
export const listServerScans=()=>scanApi('');
export const getServerScan=id=>scanApi('/'+encodeURIComponent(id));
export const pauseServerScan=id=>scanApi('/'+encodeURIComponent(id)+'/pause',{method:'POST',body:{}});
export const resumeServerScan=id=>scanApi('/'+encodeURIComponent(id)+'/resume',{method:'POST',body:{}});
function pollingDelay(signal){return new Promise((resolve,reject)=>{const finish=()=>{signal?.removeEventListener('abort',cancel);resolve();};const timer=setTimeout(finish,1000);const cancel=()=>{clearTimeout(timer);reject(signal.reason||new DOMException('Zrušeno','AbortError'));};if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});});}
async function readServerResult(job,{onProgress,signal}={}){
 const wallets=[];let offset=0,first;
 do{
  abort(signal);const result=await scanApi('/'+job.id+'/result?limit=500&offset='+offset+(first?'&revision='+first.pagination.revision:''),{signal});
  first||=result;wallets.push(...result.wallets);offset=result.pagination.nextOffset;
  onProgress?.({message:'Načítám uložený výsledek: '+wallets.length+' / '+result.pagination.total+' adres',job});
 }while(offset!==null);
 return {...first,wallets,tokens:job.query.kind==='wallets'?aggregateHoldings(wallets,job.query.addresses.length):first.tokens};
}
export async function openServerScan(id,{onProgress,signal}={}){
 const cancel=()=>{scanApi('/'+id+'/pause',{method:'POST',body:{},keepalive:true}).catch(()=>{});};
 signal?.addEventListener('abort',cancel,{once:true});
 try{
  for(;;){abort(signal);const job=await scanApi('/'+encodeURIComponent(id),{signal});onProgress?.({message:job.message,job});if(job.status!=='running')return await readServerResult(job,{onProgress,signal});await pollingDelay(signal);}
 }finally{signal?.removeEventListener('abort',cancel);}
}
async function runServerScan(kind,{tokens,addresses,chainIds,match='all',refresh=false,onProgress,signal,provider='auto'}){
 // Keep the creation response so cancellation can pause the accepted job by id.
 abort(signal);const job=await scanApi('',{method:'POST',body:{kind,tokens,addresses,chainIds,match,refresh,provider}});
 if(signal?.aborted){await scanApi('/'+job.id+'/pause',{method:'POST',body:{},keepalive:true});abort(signal);}
 onProgress?.({message:job.cached?'Načítám uložený dokončený sken.':job.message,job});
 return openServerScan(job.id,{onProgress,signal});
}
