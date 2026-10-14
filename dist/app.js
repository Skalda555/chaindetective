import * as data from './data.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
  scan:'<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 2v4m8-4v4M2 8h4m12 0h4M2 16h4m12 0h4M8 18v4m8-4v4"/><circle cx="12" cy="12" r="3"/>',
  wallet:'<path d="M19 7V5a2 2 0 0 0-2-2L5 6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H5"/><path d="M21 12h-6v5h6"/><path d="M17 14.5h.01"/>',
  star:'<path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3L12 17.4l-5.6 3 1.1-6.3L3 9.6l6.2-.9Z"/>',
  spark:'<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z"/><path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5Z"/>',
  flow:'<path d="M4 6h13m-3-3 3 3-3 3M20 18H7m3-3-3 3 3 3M4 12h16"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.7 8.7a2.5 2.5 0 1 1 3.8 2.2c-1.5.8-1.5 1.6-1.5 2.6m0 3h.01"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  layers:'<path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  history:'<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6M12 7v5l3 2"/>',
  download:'<path d="M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6"/>',
  bookmark:'<path d="M6 3h12v18l-6-4-6 4Z"/>',
  flask:'<path d="M9 3h6m-5 0v6L4 19a1.5 1.5 0 0 0 1.3 2h13.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10M9 18h.01"/>',
  chart:'<path d="M3 3v18h18M7 16v-4m5 4V7m5 9v-6"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  external:'<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  cross:'<path d="M6 6l12 12M18 6 6 18"/>',
  users:'<circle cx="9" cy="7" r="3"/><path d="M2 21v-3a7 7 0 0 1 14 0v3m0-17a3 3 0 0 1 0 6m4 11v-3a6 6 0 0 0-3-5"/>',
  link:'<path d="m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 12a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1" transform="translate(1 0) scale(.9)"/>',
  dollar:'<circle cx="12" cy="12" r="9"/><path d="M15 8c-6-3-8 3-3 4s3 7-3 4m3-11v14"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.wallet}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));

const networks = data.NETWORKS;
const tokens = data.TOKENS;
const network = id => networks.find(n => n.id === id) || { id, name: id, explorer: '' };
const short = a => a ? `${a.slice(0,6)}…${a.slice(-4)}` : '—';
const number = n => new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:0}).format(n || 0);
const money = (n, compact = false) => n === null || n === undefined ? 'Cena neznámá' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:compact?'compact':'standard',maximumFractionDigits:compact?2:0}).format(n);
const amount = n => new Intl.NumberFormat('en-US',{maximumFractionDigits:4,notation:n > 100000?'compact':'standard'}).format(n || 0);
const tokenKey = t => t.id || `${t.chainId}:${t.address.toLowerCase()}`;
const chainChars = { ethereum:'♦',base:'━',arbitrum:'A',optimism:'OP',zksync:'↔',scroll:'S',linea:'L' };
const chainIcon = id => `<span class="chain-logo ${esc(id)}" title="${esc(network(id).name)}">${chainChars[id] || 'E'}</span>`;
const coinClass = t => ({WETH:'eth',ETH:'eth',USDC:'usdc',ARB:'arb',OP:'op',DAI:'dai',UNI:'uni'}[t.symbol] || '');
const coin = (t,size='') => `<span class="coin-icon ${coinClass(t)} ${size}" title="${esc(t.symbol)} · ${esc(network(t.chainId).name)}">${['WETH','ETH'].includes(t.symbol)?'♦':esc(t.symbol==='USDC'?'$':t.symbol==='ARB'?'Λ':(t.symbol||'?').slice(0,3))}</span>`;
function readLocal(key) { try { const v=JSON.parse(localStorage.getItem(key)||'[]'); return Array.isArray(v)?v:[]; } catch { return []; } }
function writeLocal(key,value) { try { localStorage.setItem(key,JSON.stringify(value)); } catch { toast('Prohlížeč nepovolil místní uložení.'); } }
const savedWallets = readLocal('cd:watchlist:v1');
const savedQueries = readLocal('cd:queries:v1');
const defaults = ['ARB','WETH'].map(s => tokens.find(t => t.symbol===s && t.chainId==='arbitrum')).filter(Boolean);
const state = { view:'screener',source:'demo',selectedTokens:defaults,chainIds:networks.map(n=>n.id),match:'all',result:null,rows:[],page:1,pageSize:8,selected:new Set(),busy:false,dirty:false,controller:null,runId:0,activeWallet:null };
let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
function setError(message=''){$('query-error').textContent=message;$('query-error').hidden=!message;}
function info(title,html){$('info-title').textContent=title;$('info-content').innerHTML=html;$('info-dialog').showModal();}
function guide(){info('Váš výzkum začíná tady.',`<p>Jeden pracovní prostor. Dva způsoby, jak propojit tokeny a adresy.</p><h3>01 / Tokeny → peněženky</h3><p>Vyberte až pět tokenů podle <strong>kontraktu a sítě</strong>. Režim <strong>AND</strong> najde adresy s každým z nich; <strong>OR</strong> adresy s alespoň jedním. Filtr minimální pozice se vztahuje na součet známých USD hodnot vybraných tokenů.</p><h3>02 / Peněženky → tokeny</h3><p>Vložte až dvacet EVM adres. Stejné adresy napříč vybranými sítěmi se vyhodnotí společně. Tokeny se seskupují podle kontraktu a sítě, řadit je můžete podle USD hodnoty nebo počtu držitelů.</p><h3>03 / Navazujte na výsledky</h3><p>Otevřete detail adresy, uložte ji hvězdičkou do watchlistu nebo vyberte více řádků pro navazující analýzu. Dotazy i watchlist se ukládají lokálně v tomto prohlížeči.</p><p><strong>Demo</strong> obsahuje syntetická data. Pro skutečné adresy použijte <strong>Live API</strong> a zkontrolujte rozsah skenu v metodice.</p>`);}
function coverageText(){
  const c=state.result?.coverage;
  if(typeof c==='string')return c;
  return c?.message || c?.summary || (state.source==='demo'?'Syntetický ukázkový dataset. Zobrazené adresy, štítky a hodnoty neslouží jako reálné investiční signály.':'Veřejné API Blockscout. Omezený počet stran; výsledky nejsou úplným seznamem držitelů.');
}
function dataInfo(){
 const warnings=(state.result?.warnings||[]).map(w=>`<li>${esc(typeof w==='string'?w:w.message||JSON.stringify(w))}</li>`).join('');
 info('Zdroje, rozsah a metodika',`<p><strong>Aktuální režim: ${state.source==='demo'?'Demo · syntetická data':'Live · veřejné Blockscout API'}</strong></p><p>${esc(coverageText())}</p>${warnings?`<h3>Upozornění k poslednímu skenu</h3><ul>${warnings}</ul>`:''}<h3>Co výsledky znamenají</h3><p>USD hodnota ve screeneru je součet <strong>vybraných pozic</strong>, nikoli celého portfolia. V analýze jde o načtené ERC-20 zůstatky. Token bez dostupné ceny má hodnotu <strong>neznámou</strong>. Nativní ETH, NFT a DeFi pozice tato verze neagreguje.</p><p>Veřejná API jsou stránkovaná a mohou být omezená, zpožděná nebo nedostupná. Průnik se počítá pouze nad načtenými držiteli. <strong>Prázdný výsledek neprokazuje, že žádní držitelé neexistují.</strong> Chyby se uvádějí odděleně od výsledků.</p><h3>Sítě</h3><p>${networks.map(n=>esc(n.name)).join(' · ')}. Živé adaptéry jsou připravené pro Ethereum, Base, Arbitrum a Optimism. zkSync Era, Scroll a Linea jsou zatím dostupné pouze v demu. Dostupnost veřejného exploreru se ověřuje při skenu. Adresy a kontrakty se odesílají veřejným indexerům pouze po spuštění živého dotazu.</p><h3>Lokální uložení</h3><p>Watchlist uchovává snapshot pozic s označením zdroje. Není průběžně aktualizovaný. Demo a live záznamy jsou vedené odděleně.</p><p>Dokumentace zdroje: <a href="https://docs.blockscout.com/devs/apis" target="_blank" rel="noopener noreferrer">Blockscout APIs ↗</a></p>`);
}
function renderTokens(){
 $('selected-tokens').innerHTML=state.selectedTokens.map(t=>`<div class="token-chip">${coin(t)}<span>${esc(t.symbol)}<small>${esc(network(t.chainId).name)}</small></span><button data-remove-token="${esc(tokenKey(t))}" aria-label="Odebrat ${esc(t.symbol)}">×</button></div>`).join('');
 $('token-count').textContent=`${state.selectedTokens.length} / 5`;
 $('add-token').hidden=state.selectedTokens.length>=5;
 document.querySelectorAll('[data-match]').forEach(b=>{b.classList.toggle('active',b.dataset.match===state.match);b.setAttribute('aria-pressed',b.dataset.match===state.match);});
}
function renderChains(){
 $('chain-filters').innerHTML=networks.map(n=>`<button class="chain-chip ${state.chainIds.includes(n.id)?'active':''}" data-chain="${esc(n.id)}" aria-pressed="${state.chainIds.includes(n.id)}" title="${state.source==='live'&&n.live===false?'Živý adaptér zatím není dostupný; síť funguje v demu.':esc(n.name)}">${chainIcon(n.id)} ${esc(n.name.replace(' Era',''))}${state.source==='live'&&n.live===false?' <span class="demo-only">DEMO</span>':''}</button>`).join('');
 $('all-chains').textContent=state.chainIds.length===networks.length?'Zrušit výběr':'Vybrat vše';
}
function setBusy(b){state.busy=b;['scan-button','analyze-button','result-search','min-value','sort-select','export-button','save-search','previous-page','next-page'].forEach(id=>$(id).disabled=b);if($('select-all'))$('select-all').disabled=b;$('scan-button').innerHTML=b?'<span class="spinner"></span> Hledám držitele…':`${icon('search')}<span>Najít peněženky</span><span class="button-arrow">↗</span>`;$('analyze-button').innerHTML=b?'<span class="spinner"></span> Analyzuji…':`${icon('chart')} Analyzovat peněženky <span class="button-arrow">↗</span>`;}
function markDirty(){
 state.runId++;state.controller?.abort();setBusy(false);state.dirty=true;state.result=null;state.selected.clear();state.page=1;setError();renderResults();
 if(state.source==='demo'&&state.view==='screener'&&state.selectedTokens.length&&state.chainIds.length)run();
}
function setSource(source){
 if(source===state.source)return;
 closeDrawer();
 state.source=source;state.result=null;state.dirty=true;state.rows=[];state.runId++;state.controller?.abort();setBusy(false);state.selected.clear();state.page=1;setError();
 document.querySelectorAll('[data-source]').forEach(b=>{b.classList.toggle('active',b.dataset.source===source);b.setAttribute('aria-pressed',b.dataset.source===source);});
 $('source-banner').classList.toggle('live-banner',source==='live');
 $('source-banner').innerHTML=source==='demo'?`${icon('flask')}<span><strong>Prozkoumejte možnosti.</strong> Pracujete s ilustračními daty. Pro skutečné adresy přepněte na Live API.</span>`:`${icon('database')}<span><strong>Veřejné Live API · beta.</strong> Ethereum, Base, Arbitrum a Optimism. Omezený rozsah; ostatní sítě zatím jen v demu.</span>`;
 $('load-wallet-demo').hidden=source==='live';
 renderChains();
 if(state.view==='wallets')$('wallet-addresses').value=source==='demo'?demoAddresses().join('\n'):'';
 renderResults();if(source==='demo'&&state.view!=='watchlist')run();
}
function setView(view){
 if(view===state.view)return;
 closeDrawer();
 state.view=view;state.result=null;state.dirty=false;state.page=1;state.selected.clear();state.runId++;state.controller?.abort();setBusy(false);setError();$('result-search').value='';$('min-value').value='';
 const walletMode=view==='wallets';
 document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
 document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===view);b.setAttribute('aria-selected',b.dataset.mode===view);});
 const title={screener:'Token screener',wallets:'Analýza peněženek',watchlist:'Váš watchlist'}[view];
 $('breadcrumb-view').textContent=title;$('page-title').innerHTML=`${title}<span>.</span>`;
 $('page-description').textContent={screener:'Najděte peněženky, které drží tokeny, na kterých vám záleží.',wallets:'Propojte adresy. Objevte společné pozice a koncentraci kapitálu.',watchlist:'Zajímavé adresy na jednom místě. Navazujte na svůj výzkum.'}[view];
 $('query-panel').hidden=view==='watchlist';$('token-query').hidden=walletMode;$('wallet-query').hidden=!walletMode;
 $('save-search').hidden=view==='watchlist';$('saved-searches').hidden=view==='watchlist';
 $('sort-select').innerHTML=walletMode?'<option value="value">Hodnota: nejvyšší</option><option value="holders">Počet držitelů</option><option value="symbol">Token A–Z</option>':'<option value="value">Hodnota: nejvyšší</option><option value="match">Počet tokenů</option><option value="address">Adresa A–Z</option>';
 $('result-search').placeholder=walletMode?'Hledat token nebo kontrakt…':'Hledat adresu nebo štítek…';
 $('sidebar').classList.remove('open');
 if(walletMode&&state.source==='demo'&&!$('wallet-addresses').value.trim())$('wallet-addresses').value=demoAddresses().join('\n');
 renderResults();if(state.source==='demo'&&view!=='watchlist')run();
}
function demoAddresses(){return (data.DEMO_WALLETS||[]).slice(0,6).map(w=>w.address);}
function unsupportedDemoTokens(){return state.selectedTokens.filter(t=>!(data.DEMO_WALLETS||[]).some(w=>(w.holdings||[]).some(h=>h.tokenId===tokenKey(t)&&h.amount>0)));}
function normalizeWallet(w){
 const holdings=(w.holdings||[]).map(h=>{const meta=tokens.find(t=>tokenKey(t)===h.tokenId)||tokens.find(t=>t.address?.toLowerCase()===h.address?.toLowerCase()&&t.chainId===h.chainId)||{};return {...meta,...h,value:h.value??h.usdValue??h.totalValue??null};});
 const matched=(w.matchedTokens||[]).map(t=>typeof t==='string'?(tokens.find(x=>tokenKey(x)===t)||holdings.find(x=>tokenKey(x)===t)):t).filter(Boolean);
 const knownHoldings=holdings.filter(h=>h.value!==null&&h.value!==undefined);
 const value=Object.hasOwn(w,'value')?w.value:Object.hasOwn(w,'totalValue')?w.totalValue:knownHoldings.length?knownHoldings.reduce((a,h)=>a+h.value,0):null;
 return {...w,holdings,chainIds:w.chainIds||[...new Set(holdings.map(h=>h.chainId))],matchedTokens:matched,value,matchCount:w.matchCount??matched.length};
}
async function run(){
 if(state.view==='watchlist')return;
 setError();
 if(!state.chainIds.length){setError('Vyberte alespoň jednu síť.');return;}
 let addresses=[];
 if(state.view==='screener'){
  if(!state.selectedTokens.length){setError('Přidejte alespoň jeden token nebo kontrakt.');return;}
  if(state.source==='demo'&&unsupportedDemoTokens().length){state.runId++;state.controller?.abort();setBusy(false);state.result=null;state.dirty=true;renderResults();setError('Pro tento kontrakt nejsou demo data. Použijte Live API pro skutečné držitele.');return;}
  const missing=state.selectedTokens.filter(t=>!state.chainIds.includes(t.chainId));
  if(missing.length){setError(`Zapněte síť pro všechny vybrané tokeny: ${[...new Set(missing.map(t=>network(t.chainId).name))].join(', ')}.`);return;}
 }else{
  addresses=[...new Set($('wallet-addresses').value.trim().split(/[\s,;]+/).filter(Boolean).map(a=>a.toLowerCase()))];
  if(!addresses.length){setError('Vložte alespoň jednu adresu peněženky.');return;}
  if(addresses.length>20){setError('Najednou lze analyzovat nejvýše 20 různých adres.');return;}
  const invalid=addresses.find(a=>!/^0x[0-9a-f]{40}$/.test(a));
  if(invalid){setError(`Neplatná EVM adresa: ${invalid.slice(0,70)}. Očekává se 0x a 40 hexadecimálních znaků.`);return;}
 }
 state.controller?.abort();state.controller=new AbortController();const runId=++state.runId;setBusy(true);state.result=null;state.page=1;state.selected.clear();state.dirty=false;
 $('empty-state').hidden=false;$('empty-state').innerHTML=`<div class="loading-row"><span class="spinner"></span> ${state.view==='screener'?'Načítám držitele vybraných kontraktů…':'Načítám pozice peněženek…'}<p id="scan-progress">${state.source==='demo'?'Ukázkový dataset':'Veřejné indexery mohou odpovídat pomaleji.'}</p><button class="subtle-button" id="cancel-scan">Zrušit sken</button></div>`;$('table-body').innerHTML='';$('cancel-scan').onclick=()=>{state.runId++;state.controller.abort();setBusy(false);state.dirty=true;renderResults();toast('Sken byl zrušen.');};
 try{
  const options={chainIds:[...state.chainIds],source:state.source,signal:state.controller.signal,onProgress:p=>{if(runId===state.runId&&$('scan-progress'))$('scan-progress').textContent=typeof p==='string'?p:p.message||`${p.completed||0} / ${p.total||'…'}`;}};
  const result=state.view==='screener'?await data.searchHolders({...options,tokens:state.selectedTokens,match:state.match,minValue:0}):await data.analyzeWallets({...options,addresses});
  if(runId!==state.runId)return;
  if(state.view==='screener'&&state.source==='live'){state.selectedTokens=state.selectedTokens.map(t=>(result.tokens||[]).find(r=>tokenKey(r)===tokenKey(t))||t);renderTokens();}
  state.result={...result,wallets:(result.wallets||[]).map(normalizeWallet),tokens:(result.tokens||[]).map(t=>({...t,totalValue:t.totalValue??t.value??null,holderCount:t.holderCount??t.holders?.length??0,share:t.share??0}))};
  state.result.fetchedAt=new Date().toISOString();
  if(result.warnings?.length)toast(`Sken dokončen s upozorněním. Podrobnosti najdete v metodice.`);
 }catch(e){
  if(runId!==state.runId)return;
  setError(e.name==='AbortError'?'Sken byl zrušen.':e.message||'Data se nepodařilo načíst. Zkuste jinou síť nebo režim Demo.');
  state.result=null;state.dirty=true;
 }finally{if(runId===state.runId){setBusy(false);renderResults();}}
}
function currentRows(){
 if(state.view==='watchlist')return savedWallets.filter(w=>w.source===state.source).map(w=>normalizeWallet({...w.wallet,savedAt:w.savedAt}));
 if(!state.result)return [];
 return state.view==='wallets'?state.result.tokens:state.result.wallets;
}
function filteredRows(){
 const q=$('result-search').value.toLowerCase().trim();const min=Math.max(0,Number($('min-value').value)||0);const mode=state.view==='wallets';const sort=$('sort-select').value;
 const rows=currentRows().filter(r=>{
  const searchable=mode?`${r.symbol} ${r.name} ${r.address} ${network(r.chainId).name}`:`${r.address} ${r.label||''}`;
  const value=mode?r.totalValue:r.value;
  return searchable.toLowerCase().includes(q)&&(!min||(value!==null&&value>=min));
 });
 return rows.sort((a,b)=>sort==='holders'?b.holderCount-a.holderCount:sort==='match'?(b.matchCount||0)-(a.matchCount||0):sort==='address'?a.address.localeCompare(b.address):sort==='symbol'?a.symbol.localeCompare(b.symbol):(mode?(b.totalValue??-1)-(a.totalValue??-1):(b.value??-1)-(a.value??-1)));
}
function renderStats(){
 const rows=currentRows();const walletMode=state.view==='wallets';const walletRows=walletMode?(state.result?.wallets||[]):rows;
 const sum=rows.reduce((a,r)=>a+((walletMode?r.totalValue:r.value)||0),0);const chains=[...new Set(rows.flatMap(r=>walletMode?[r.chainId]:r.chainIds))].filter(Boolean);
 const knownRows=rows.filter(r=>Number.isFinite(walletMode?r.totalValue:r.value));
 const stats=walletMode?[
  ['Agregované tokeny',number(rows.length),'kontrakt + síť','layers'],
  ['Hodnota načtených pozic',rows.length?money(knownRows.length?sum:null,true):'—','pouze známé USD ceny','dollar'],
  ['Analyzované adresy',number(walletRows.length),'v rámci vybraných sítí','users'],
  ['Zastoupené sítě',number(chains.length),'Ethereum & L2','grid']
 ]:[
  [state.view==='watchlist'?'Uložené peněženky':'Nalezené peněženky',state.result||state.view==='watchlist'?number(rows.length):'—',state.view==='watchlist'?'lokální snapshoty':state.match==='all'?'průnik vybraných tokenů':'alespoň jeden vybraný token','wallet'],
  ['Hodnota vybraných pozic',rows.length?money(knownRows.length?sum:null,true):'—','součet známých USD hodnot','dollar'],
  ['Průměrná pozice',rows.length?money(knownRows.length?sum/knownRows.length:null,true):'—','z pozic se známou USD hodnotou','target'],
  ['Zastoupené sítě',state.result||state.view==='watchlist'?number(chains.length):'—','v načtených výsledcích','layers']
 ];
 $('stats').innerHTML=stats.map((s,i)=>`<div class="stat-card"><div class="stat-top">${s[0]}<span>${icon(s[3])}</span></div><div class="stat-value">${s[1]}${i===3?`<span class="stat-chains">${chains.slice(0,5).map(chainIcon).join('')}</span>`:''}</div><div class="stat-foot">${i===0?'<span class="accent">↗</span>':''}${s[2]}</div></div>`).join('');
}
function renderInsight(){
 const rows=currentRows();const total=rows.length;const walletMode=state.view==='wallets';const sum=rows.reduce((a,r)=>a+((walletMode?r.totalValue:r.value)||0),0);
 if(state.view==='watchlist'){
  const chains=[...new Set(rows.flatMap(w=>w.chainIds))];
  $('insight-panel').innerHTML=`<div class="insight-label">${icon('bookmark')} Váš výzkumný okruh</div><p>Adresy, ke kterým se chcete vrátit.</p><div class="venn-diagram"><div class="venn-circle"></div><div class="venn-circle second"></div><div class="venn-value"><strong>${total}</strong><small>uložených snapshotů</small></div></div><div class="insight-divider"></div><div class="insight-pair"><span>Zdroj</span><strong>${state.source==='demo'?'Demo':'Live API'}</strong></div><div class="insight-pair"><span>Zastoupené sítě</span><strong>${chains.length}</strong></div><div class="insight-note">${icon('history')} Pozice odpovídají okamžiku uložení. Novou analýzou získáte aktuální data.</div><button class="insight-link" id="insight-help">Jak číst snapshoty <span>↗</span></button>`;
  $('insight-help').onclick=dataInfo;return;
 }
 if(walletMode){
  const top=[...rows].sort((a,b)=>b.holderCount-a.holderCount)[0];
  $('insight-panel').innerHTML=`<div class="insight-label">${icon('link')} Společné přesvědčení</div><p>Nejrozšířenější pozice ve vaší skupině peněženek.</p><div class="venn-diagram"><div class="venn-circle"></div><div class="venn-circle second"></div><div class="venn-value"><strong>${top?esc(top.symbol):'—'}</strong><small>${top?`${number(top.holderCount)} držitelů`:'spusťte analýzu'}</small></div></div><div class="insight-divider"></div><div class="insight-pair"><span>Unikátní kontrakty</span><strong>${total}</strong></div><div class="insight-pair"><span>Známá USD hodnota</span><strong>${money(sum,true)}</strong></div><div class="insight-note">${icon('help')} Stejný ticker na dvou sítích zůstává dvěma samostatnými kontrakty.</div><button class="insight-link" id="insight-help">Jak číst výsledky <span>↗</span></button>`;
 }else{
  const ts=state.selectedTokens;const counts=ts.map(t=>rows.filter(w=>w.holdings.some(h=>h.chainId===t.chainId&&h.address?.toLowerCase()===t.address.toLowerCase()&&h.amount>0)).length);
  const both=rows.filter(w=>ts.length&&ts.every(t=>w.holdings.some(h=>h.chainId===t.chainId&&h.address?.toLowerCase()===t.address.toLowerCase()&&h.amount>0))).length;
  const top=rows.length?Math.max(...rows.map(w=>w.value||0))/Math.max(1,sum)*100:0;
  $('insight-panel').innerHTML=`<div class="insight-label">${icon('link')} ${state.view==='watchlist'?'Váš výzkumný okruh':'Překryv držitelů'}</div><p>${state.view==='watchlist'?'Uložené adresy pro váš další průzkum.':'Tam, kde se vaše vybrané tokeny potkávají.'}</p><div class="venn-diagram"><div class="venn-circle">${esc(ts[0]?.symbol||'A')}</div><div class="venn-circle second">${esc(ts[1]?.symbol||(ts.length?'':'B'))}</div><div class="venn-value"><strong>${state.result||state.view==='watchlist'?number(both):'—'}</strong><small>${ts.length>2?'drží všechny tokeny':'společných adres'}</small></div></div><div class="insight-divider"></div>${ts.slice(0,2).map((t,i)=>`<div class="insight-pair"><span>${esc(t.symbol)} držitelé ve výsledku</span><strong>${number(counts[i])}</strong></div>`).join('')}<div class="mini-distribution" title="Poměr USD hodnot největších načtených pozic">${rows.filter(w=>w.value>0).sort((a,b)=>b.value-a.value).slice(0,8).map((w,i)=>`<span style="flex:${w.value};background:${['#b8db8b','#6d9366','#354e40'][i%3]}"></span>`).join('')}</div><div class="insight-pair"><span>Největší pozice / celek</span><strong>${top.toFixed(1)} %</strong></div><div class="insight-note">${icon('spark')} ${state.source==='demo'?'Ukázka souvislostí. Zobrazená data jsou syntetická.':'Překryv je omezený rozsahem načtených stránek indexeru.'}</div><button class="insight-link" id="insight-help">Jak číst výsledky <span>↗</span></button>`;
 }
 $('insight-help').onclick=dataInfo;
}
function identicon(address){const colors=['#b7ba70','#8ca8ce','#b48cc2','#6fb6a6','#cc9b75','#85ad75'];const n=parseInt(address?.slice(2,6)||'0',16);return `<span class="identicon" style="--ident:${colors[n%colors.length]}">${icon(['grid','target','scan','layers','spark','link'][n%6])}</span>`;}
function saved(address){return savedWallets.some(w=>w.source===state.source&&w.wallet?.address.toLowerCase()===address.toLowerCase());}
function renderResults(){
 if(state.busy)return;
 const warnings=state.view==='watchlist'?[]:(state.result?.warnings||[]);
 $('scan-notice').hidden=!warnings.length;
 if(warnings.length){const failed=(state.result?.coverage?.details||[]).filter(d=>d.status==='error'||d.status==='unsupported').length;$('scan-notice').innerHTML=`${icon('help')}<span><strong>Omezení výsledku.</strong> ${failed?`${failed} dotazů se nepodařilo načíst. `:''}Výsledek pokrývá pouze načtená data.</span><button class="text-button" id="notice-details">${warnings.length} upozornění ↗</button>`;$('notice-details').onclick=dataInfo;}
 const walletMode=state.view==='wallets';const watch=state.view==='watchlist';const rows=filteredRows();state.rows=rows;
 const total=rows.length;const pages=Math.max(1,Math.ceil(total/state.pageSize));state.page=Math.min(state.page,pages);const start=(state.page-1)*state.pageSize;const visible=rows.slice(start,start+state.pageSize);
 $('results-title').innerHTML=`${walletMode?'Nejvíce držené tokeny':watch?'Uložené peněženky':'Nalezené peněženky'} <span class="count-badge" id="result-count">${state.result||watch?number(total):'—'}</span>`;
 $('results-subtitle').textContent=watch?'Uložené snapshoty · zdroj: '+(state.source==='demo'?'Demo':'Live API'):walletMode?'Souhrn ERC-20 pozic ze zadaných adres':`${state.match==='all'?'Drží všechny vybrané tokeny':'Drží alespoň jeden vybraný token'} · ${state.source==='demo'?'demo dataset':'načtené stránky indexeru'}`;
 $('table-head').innerHTML=walletMode?'<tr><th>#</th><th>TOKEN / KONTRAKT</th><th>SÍŤ</th><th>DRŽITELÉ</th><th>PODÍL ADRES</th><th class="th-value">HODNOTA POZIC</th><th></th></tr>':'<tr><th><input type="checkbox" id="select-all" aria-label="Vybrat všechny zobrazené adresy"></th><th>PENĚŽENKA</th><th>SÍTĚ</th><th>VYBRANÉ TOKENY</th><th class="th-value">HODNOTA POZIC</th><th>POMĚR POZIC</th><th></th></tr>';
 $('table-body').innerHTML=visible.map((r,i)=>walletMode?tokenRow(r,start+i):walletRow(r)).join('');
 $('empty-state').hidden=!!total;
 if(!total)$('empty-state').innerHTML=`${icon(watch?'star':'search')}<strong>${!state.result&&!watch?(state.dirty?'Dotaz je připravený.':'Začněte svým průzkumem.'):watch?'Watchlist čeká na první adresu.':'Žádné výsledky pro tento výběr.'}</strong><p>${!state.result&&!watch?'Vyberte tokeny nebo vložte adresy a spusťte analýzu.':watch?'Uložte zajímavé peněženky ikonou záložky v tabulce. Zobrazují se pouze záznamy aktuálně vybraného zdroje dat.':state.source==='demo'?'Demo zná pouze ukázkové kontrakty a adresy. Změňte filtry nebo použijte Live API pro vlastní vstupy.':'Zkontrolujte zadané sítě, filtry a metodiku. Výsledek se vztahuje pouze na úspěšně načtená data.'}</p>${watch?'<button class="subtle-button" id="empty-go-screener">Otevřít token screener →</button>':''}`;
 $('empty-go-screener')?.addEventListener('click',()=>setView('screener'));
 if(state.source==='demo'&&state.view==='screener'&&unsupportedDemoTokens().length){$('empty-state').hidden=false;$('empty-state').innerHTML=`${icon('database')}<strong>Pro tento kontrakt nejsou demo data.</strong><p>Demo obsahuje pouze ukázkové pozice. Skutečné držitele vlastního kontraktu načtete přes Live API na vybrané síti.</p><button class="primary-button" id="use-live-api">Načíst skutečné držitele · Live API ↗</button>`;$('use-live-api').onclick=()=>{setSource('live');run();};}
 $('table-range').textContent=total?`${start+1}–${Math.min(start+state.pageSize,total)} z ${number(total)} ${walletMode?'tokenů':'peněženek'}`:'0 výsledků';
 $('page-number').textContent=state.page;$('previous-page').disabled=state.page===1;$('next-page').disabled=state.page>=pages;
 $('export-button').disabled=!total;$('save-search').disabled=!state.result;
 $('bulk-bar').hidden=walletMode||!state.selected.size;$('bulk-count').textContent=`Vybráno ${state.selected.size} adres`;
 $('watch-count').textContent=savedWallets.length;
 if($('select-all')){$('select-all').checked=!!visible.length&&visible.every(r=>state.selected.has(r.address));$('select-all').onchange=e=>{visible.forEach(r=>e.target.checked?state.selected.add(r.address):state.selected.delete(r.address));renderResults();};}
 $('coverage-label').textContent=watch?`Uložené snapshoty · ${state.source==='demo'?'syntetická demo data':'živá data v okamžiku uložení'}`:state.source==='demo'?'Ilustrační dataset · adresy, štítky a hodnoty jsou syntetické':state.result?`Blockscout · ${coverageText().slice(0,160)}`:'Veřejné Blockscout API · omezený rozsah skenu';
 renderStats();renderInsight();
}
function walletRow(w){
 const matched=w.matchedTokens.length?w.matchedTokens:w.holdings.filter(h=>state.selectedTokens.some(t=>t.chainId===h.chainId&&t.address.toLowerCase()===h.address?.toLowerCase()));
 const values=matched.map(t=>w.holdings.find(h=>h.chainId===t.chainId&&h.address?.toLowerCase()===t.address?.toLowerCase())?.value).filter(v=>Number.isFinite(v)&&v>0);const sum=values.reduce((a,n)=>a+n,0);
 return `<tr><td><input type="checkbox" data-select-wallet="${esc(w.address)}" aria-label="Vybrat ${esc(short(w.address))}" ${state.selected.has(w.address)?'checked':''}></td><td><div class="wallet-identity">${identicon(w.address)}<div><button class="address-button" data-wallet="${esc(w.address)}">${esc(short(w.address))}</button><div class="wallet-name"><i></i>${state.source==='demo'?esc(w.label||'Ukázková adresa'):w.savedAt?'Snapshot '+esc(new Date(w.savedAt).toLocaleDateString('cs-CZ')):'Veřejná adresa'}</div></div></div></td><td><div class="row-networks">${w.chainIds.slice(0,5).map(chainIcon).join('')}${w.chainIds.length>5?`<span class="pending-dot">+${w.chainIds.length-5}</span>`:''}</div></td><td><div class="match-tokens">${matched.slice(0,4).map(t=>coin(t,'micro')).join('')}<span class="match-total">${matched.length}/${state.view==='watchlist'?matched.length:(state.selectedTokens.length||matched.length)}</span></div></td><td class="value-cell">${money(w.value)}<small>${state.source==='demo'?'ilustrační USD':'známé USD ceny'}</small></td><td><div class="allocation" title="Poměr známých hodnot vybraných pozic">${values.slice(0,5).map(v=>`<span style="flex:${v/sum}"></span>`).join('')||'<span style="background:#354740;flex:1"></span>'}</div></td><td><div class="row-actions"><button class="bookmark-button ${saved(w.address)?'saved':''}" data-bookmark="${esc(w.address)}" aria-label="${saved(w.address)?'Odebrat z watchlistu':'Uložit do watchlistu'} ${esc(short(w.address))}">${icon('bookmark')}</button><button class="open-detail" data-wallet="${esc(w.address)}" aria-label="Detail ${esc(short(w.address))}">↗</button></div></td></tr>`;
}
function tokenRow(t,i){
 let share=t.share||0;if(share<=1)share*=100;share=Math.min(100,share);
 return `<tr><td class="pending-dot">${i+1}</td><td><div class="wallet-identity">${coin(t,'small')}<div><span class="address-button">${esc(t.symbol)}</span><div class="wallet-name">${esc(short(t.address))}</div></div></div></td><td><div class="row-networks">${chainIcon(t.chainId)}<span class="pending-dot">${esc(network(t.chainId).name)}</span></div></td><td class="value-cell" style="text-align:left">${number(t.holderCount)}</td><td><div class="holder-share"><span class="share-track"><i style="width:${share}%"></i></span>${Math.round(share)} %</div></td><td class="value-cell">${money(t.totalValue)}<small>${amount(t.amount)} ${esc(t.symbol)}</small></td><td><a class="open-detail" href="${esc(explorerUrl(t.chainId,'token',t.address))}" target="_blank" rel="noopener noreferrer" aria-label="Otevřít kontrakt ${esc(t.symbol)} v exploreru">↗</a></td></tr>`;
}
function explorerUrl(chainId,type,address){const base=network(chainId).explorer||network(chainId).explorerUrl||'';return /^https:\/\//.test(base)&&/^0x[\da-fA-F]{40}$/.test(address)?`${base.replace(/\/$/,'')}/${type}/${address}`:'#';}
function toggleBookmark(address){
 const idx=savedWallets.findIndex(w=>w.source===state.source&&w.wallet?.address===address);
 if(idx>=0){savedWallets.splice(idx,1);toast('Adresa odebrána z watchlistu.');}
 else{const wallet=currentRows().find(w=>w.address===address);if(!wallet)return;savedWallets.push({source:state.source,wallet,savedAt:new Date().toISOString()});toast('Adresa uložena do watchlistu.');}
 writeLocal('cd:watchlist:v1',savedWallets);renderResults();
 if(state.activeWallet?.address===address)openWallet(address,state.activeWallet);
}
function openWallet(address,existing){
 const w=currentRows().find(w=>w.address===address)||state.result?.wallets?.find(w=>w.address===address)||existing;
 if(!w)return;state.activeWallet=w;
 $('wallet-drawer').innerHTML=`<div class="drawer-header"><span>WALLET INTELLIGENCE / ${state.source.toUpperCase()}</span><button class="icon-button" id="close-drawer" aria-label="Zavřít detail">×</button></div><div class="drawer-identity">${identicon(w.address)}<h2>${state.source==='demo'?esc(w.label||'Ukázková peněženka'):'Detail peněženky'}</h2><div class="full-address">${esc(w.address)}</div></div><div class="drawer-tools"><button class="subtle-button" id="copy-address">${icon('copy')} Kopírovat</button><button class="subtle-button" data-bookmark="${esc(w.address)}">${icon('bookmark')} ${saved(w.address)?'Uloženo':'Watchlist'}</button>${w.chainIds[0]?`<a class="subtle-button" href="${esc(explorerUrl(w.chainIds[0],'address',w.address))}" target="_blank" rel="noopener noreferrer">Explorer ${icon('external')}</a>`:''}</div><div class="drawer-stat"><span>Hodnota vybraných pozic ve screeneru</span><strong>${money(w.value)}</strong><p class="drawer-footnote">${state.source==='demo'?'Ilustrační USD hodnoty · syntetická adresa':'Pouze pozice vrácené indexerem. Záznam nemusí obsahovat celé portfolio.'}</p></div><h2>Načtené tokenové pozice <span class="count-badge">${w.holdings.length}</span></h2>${w.holdings.map(h=>`<div class="drawer-holding">${coin(h)}<span>${esc(h.symbol)}<small>${esc(network(h.chainId).name)}</small></span><span>${money(h.value)}<small>${amount(h.amount)} ${esc(h.symbol)}</small></span></div>`).join('')}<p class="drawer-footnote">Nativní ETH, NFT ani DeFi pozice nejsou zahrnuté. ${w.savedAt?'Snapshot: '+esc(new Date(w.savedAt).toLocaleString('cs-CZ')):''}</p><button class="primary-button" id="analyze-this-wallet" style="width:100%;margin-top:20px">Analyzovat tuto adresu →</button>`;
 $('wallet-drawer').hidden=false;$('drawer-backdrop').hidden=false;$('close-drawer').onclick=closeDrawer;
 $('copy-address').onclick=async()=>{try{await navigator.clipboard.writeText(w.address);toast('Adresa zkopírována.');}catch{toast('Kopírování není dostupné. Adresu lze označit v detailu.');}};
 $('analyze-this-wallet').onclick=()=>{closeDrawer();setView('wallets');$('wallet-addresses').value=w.address;run();};
 $('close-drawer').focus();
}
function closeDrawer(){$('wallet-drawer').hidden=true;$('drawer-backdrop').hidden=true;state.activeWallet=null;}
function renderTokenOptions(){
 const q=$('token-search').value.toLowerCase().trim();const found=tokens.filter(t=>`${t.symbol} ${t.name} ${t.address} ${network(t.chainId).name}`.toLowerCase().includes(q));
 $('token-options').innerHTML=found.map(t=>`<button class="token-option" data-add-token="${esc(tokenKey(t))}" ${state.selectedTokens.some(x=>tokenKey(x)===tokenKey(t))?'disabled':''}>${coin(t)}<span>${esc(t.symbol)}<small>${esc(short(t.address))}</small></span><span class="option-network">${chainIcon(t.chainId)} ${esc(network(t.chainId).name)}</span><span class="added">${state.selectedTokens.some(x=>tokenKey(x)===tokenKey(t))?'✓':'+'}</span></button>`).join('')||'<p class="modal-footnote">Token není v katalogu. Pro vlastní token vložte celou adresu kontraktu a vyberte jeho síť.</p>';
 $('custom-token-fields').hidden=!/^0x[\da-f]{40}$/i.test(q);
}
function addToken(t){if(state.selectedTokens.length>=5){toast('Lze vybrat nejvýše 5 tokenů.');return;}if(state.selectedTokens.some(x=>tokenKey(x)===tokenKey(t))){toast('Tento kontrakt už je vybraný.');return;}state.selectedTokens.push(t);if(!state.chainIds.includes(t.chainId))state.chainIds.push(t.chainId);renderTokens();renderChains();$('token-dialog').close();markDirty();}
function addCustomToken(){
 const address=$('token-search').value.trim(),chainId=$('custom-chain').value;
 if(!/^0x[\da-fA-F]{40}$/.test(address))return;
 if(network(chainId).live===false){toast('Pro tuto síť zatím není dostupný živý adaptér.');return;}
 if(state.selectedTokens.length>=5){toast('Lze vybrat nejvýše 5 tokenů.');return;}
 const known=tokens.find(t=>t.address.toLowerCase()===address.toLowerCase()&&t.chainId===chainId);
 const t=known||{id:`${chainId}:${address.toLowerCase()}`,address:address.toLowerCase(),chainId,symbol:'ERC-20',name:'Vlastní kontrakt',decimals:null,price:null};
 if(state.selectedTokens.some(x=>tokenKey(x)===tokenKey(t))){toast('Tento kontrakt už je vybraný.');return;}
 setSource('live');addToken(t);toast('Kontrakt přidán do Live API. Spusťte hledání peněženek.');
}
function saveSearch(){
 if(!state.result)return;
 const q={id:Date.now(),source:state.source,view:state.view,tokens:state.selectedTokens.map(t=>({...t})),chainIds:[...state.chainIds],match:state.match,addresses:$('wallet-addresses').value,date:new Date().toISOString()};
 savedQueries.unshift(q);savedQueries.splice(15);writeLocal('cd:queries:v1',savedQueries);toast('Dotaz uložen. Najdete ho v Uložených dotazech.');
}
function showSavedSearches(){
 info('Uložené dotazy',savedQueries.length?savedQueries.map(q=>`<div class="saved-query"><button class="text-button" data-load-query="${q.id}"><span>${q.view==='wallets'?'Analýza peněženek':esc((q.tokens||[]).map(t=>t.symbol).join(' + '))}<small>${esc(q.source.toUpperCase())} · ${esc(q.match?.toUpperCase()||'')} · ${esc(new Date(q.date).toLocaleDateString('cs-CZ'))}</small></span> →</button><button data-delete-query="${q.id}" aria-label="Smazat uložený dotaz">×</button></div>`).join(''):'<p>Zatím tu nic není. Po spuštění analýzy použijte <strong>Uložit dotaz</strong> nad tabulkou výsledků.</p>');
}
function exportCSV(){
 if(!state.rows.length)return;
 const walletMode=state.view==='wallets';
 const rows=walletMode?[['symbol','contract','chain','holder_count','share','amount','known_usd_value','source','coverage'],...state.rows.map(t=>[t.symbol,t.address,t.chainId,t.holderCount,t.share,t.amount,t.totalValue,state.source,coverageText()])]:[['address','label','chains','matched_tokens','known_usd_value','source','coverage'],...state.rows.map(w=>[w.address,state.source==='demo'?w.label||'':'',w.chainIds.join(';'),w.matchedTokens.map(t=>`${t.symbol}:${t.chainId}`).join(';'),w.value,state.source,coverageText()])];
 const cell=v=>`"${String(v??'').replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')}"`;
 const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`chaindetective-${state.view}-${state.source}-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('CSV export připraven.');
}

document.addEventListener('click',event=>{
 const b=event.target.closest('button');if(!b)return;
 if(b.dataset.view)setView(b.dataset.view);
 if(b.dataset.mode)setView(b.dataset.mode);
 if(b.dataset.source)setSource(b.dataset.source);
 if(b.dataset.match){state.match=b.dataset.match;renderTokens();markDirty();}
 if(b.dataset.chain){const id=b.dataset.chain;state.chainIds=state.chainIds.includes(id)?state.chainIds.filter(c=>c!==id):[...state.chainIds,id];renderChains();markDirty();}
 if(b.dataset.removeToken){state.selectedTokens=state.selectedTokens.filter(t=>tokenKey(t)!==b.dataset.removeToken);renderTokens();markDirty();}
 if(b.dataset.addToken){const t=tokens.find(t=>tokenKey(t)===b.dataset.addToken);if(t)addToken(t);}
 if(b.dataset.close)$(b.dataset.close).close();
 if(b.dataset.wallet)openWallet(b.dataset.wallet);
 if(b.dataset.bookmark)toggleBookmark(b.dataset.bookmark);
 if(b.dataset.roadmap)info(b.dataset.roadmap,`<p>Tento modul je připravený v navigaci pro další etapu.</p><h3>${esc(b.dataset.roadmap)}</h3><p>${{'Smart money':'Skupiny sledovaných peněženek, ověřitelné štítky a historická úspěšnost.', 'Toky kapitálu':'Přírůstky a úbytky pozic, čisté toky tokenů a změny v čase.', 'Upozornění':'Pravidla nad uloženými adresami a změnami držených tokenů.'}[b.dataset.roadmap]}</p><p>V této první verzi jsou dostupné token screener, analýza peněženek a lokální watchlist.</p>`);
 if(b.dataset.loadQuery){const q=savedQueries.find(q=>String(q.id)===b.dataset.loadQuery);if(q){state.runId++;state.controller?.abort();setBusy(false);closeDrawer();$('info-dialog').close();state.selectedTokens=(q.tokens||[]).map(t=>({...t}));state.chainIds=[...q.chainIds];state.match=q.match;setSource(q.source);setView(q.view);$('wallet-addresses').value=q.addresses||'';renderTokens();renderChains();if(q.source==='demo')run();else{state.result=null;state.dirty=true;renderResults();toast('Dotaz načten. Spusťte živý sken.');}}}
 if(b.dataset.deleteQuery){const i=savedQueries.findIndex(q=>String(q.id)===b.dataset.deleteQuery);if(i>=0){savedQueries.splice(i,1);writeLocal('cd:queries:v1',savedQueries);$('info-dialog').close();showSavedSearches();}}
});
document.addEventListener('change',e=>{if(e.target.dataset.selectWallet){e.target.checked?state.selected.add(e.target.dataset.selectWallet):state.selected.delete(e.target.dataset.selectWallet);renderResults();}});
['result-search','min-value'].forEach(id=>$(id).addEventListener('input',()=>{state.page=1;renderResults();}));$('sort-select').onchange=()=>{state.page=1;renderResults();};
 $('previous-page').onclick=()=>{state.page--;renderResults();};$('next-page').onclick=()=>{state.page++;renderResults();};
 $('scan-button').onclick=run;$('analyze-button').onclick=run;
 $('wallet-addresses').addEventListener('input',()=>{state.runId++;state.controller?.abort();setBusy(false);state.result=null;state.dirty=true;renderResults();});
 $('add-token').onclick=()=>{$('token-search').value='';renderTokenOptions();$('token-dialog').showModal();$('token-search').focus();};$('token-search').oninput=renderTokenOptions;
 $('custom-chain').innerHTML=networks.map(n=>`<option value="${esc(n.id)}">${esc(n.name)}</option>`).join('');
 $('add-custom-token').onclick=addCustomToken;
 $('clear-tokens').onclick=()=>{state.selectedTokens=[];renderTokens();markDirty();};
 $('all-chains').onclick=()=>{state.chainIds=state.chainIds.length===networks.length?[]:networks.map(n=>n.id);renderChains();markDirty();};
 $('load-wallet-demo').onclick=()=>{$('wallet-addresses').value=demoAddresses().join('\n');run();};
 $('guide-button').onclick=guide;$('help-button').onclick=guide;$('workspace-info').onclick=guide;
 $('data-info').onclick=dataInfo;$('coverage-button').onclick=dataInfo;$('banner-info').onclick=dataInfo;
 $('saved-searches').onclick=showSavedSearches;$('save-search').onclick=saveSearch;$('export-button').onclick=exportCSV;
 $('menu-button').onclick=()=>$('sidebar').classList.toggle('open');
 $('drawer-backdrop').onclick=closeDrawer;
 $('analyze-selected').onclick=()=>{const addresses=[...state.selected];if(addresses.length>20){toast('Pro analýzu vyberte nejvýše 20 adres.');return;}setView('wallets');$('wallet-addresses').value=addresses.join('\n');run();};
 $('clear-selection').onclick=()=>{state.selected.clear();renderResults();};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeDrawer();$('sidebar').classList.remove('open');}if(e.key==='Tab'&&!$('wallet-drawer').hidden){const focusable=[...$('wallet-drawer').querySelectorAll('button,a[href]')];const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
 document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}}));
renderTokens();renderChains();renderResults();run();
