import * as data from './data.js';
import {initSmartWallets} from './smart-wallets.js';
import {initSocials} from './socials.js';
import {initEarlyBuyers} from './early-buyers.js';

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
const walletMax=data.MAX_WALLET_SCAN||500;
const network = id => networks.find(n => n.id === id) || { id, name: id, explorer: '' };
const short = a => a ? `${a.slice(0,6)}…${a.slice(-4)}` : '—';
const number = n => new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:0}).format(n || 0);
const money = (n, compact = false) => n === null || n === undefined ? 'Cena neznámá' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:compact?'compact':'standard',maximumFractionDigits:compact?2:0}).format(n);
const amount = n => new Intl.NumberFormat('en-US',{maximumFractionDigits:4,notation:n > 100000?'compact':'standard'}).format(n || 0);
const tokenKey = t => t.id || `${t.chainId}:${t.address.toLowerCase()}`;
const chainChars = { ethereum:'♦',base:'━',arbitrum:'A',optimism:'OP',robinhood:'RH' };
const chainIcon = id => `<span class="chain-logo ${esc(id)}" title="${esc(network(id).name)}">${chainChars[id] || 'E'}</span>`;
const coinClass = t => ({WETH:'eth',ETH:'eth',USDC:'usdc',ARB:'arb',OP:'op',DAI:'dai',UNI:'uni'}[t.symbol] || '');
const coin = (t,size='') => `<span class="coin-icon ${coinClass(t)} ${size}" title="${esc(t.symbol)} · ${esc(network(t.chainId).name)}">${['WETH','ETH'].includes(t.symbol)?'♦':esc(t.symbol==='USDC'?'$':t.symbol==='ARB'?'Λ':(t.symbol||'?').slice(0,3))}</span>`;
const DEXSCREENER_CHAIN_SLUGS=Object.freeze({ethereum:'ethereum','1':'ethereum',base:'base','8453':'base',arbitrum:'arbitrum','42161':'arbitrum',optimism:'optimism','10':'optimism'});
const tokenCopyTimers=new WeakMap();
const isEvmContract=address=>/^0x[\da-fA-F]{40}$/.test(String(address||''));
function dexScreenerUrl(chainId,address){
 if(!isEvmContract(address))return null;
 const slug=DEXSCREENER_CHAIN_SLUGS[String(chainId).toLowerCase()];
 return slug?`https://dexscreener.com/${slug}/${address}`:`https://dexscreener.com/search?q=${encodeURIComponent(address)}`;
}
function tokenNameHtml(token){
 const symbol=esc(token.symbol||'Token'),url=dexScreenerUrl(token.chainId,token.address);
 if(!url)return `<span class="address-button">${symbol}</span>`;
 return `<a class="address-button token-name-link" data-token-link href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(token.name||token.symbol||'Otevřít na DexScreener')}" aria-label="Otevřít ${symbol} na DexScreener v nové záložce">${symbol}<span class="token-external-icon" aria-hidden="true">↗</span></a>`;
}
function tokenContractHtml(token){
 if(!isEvmContract(token.address))return `<div class="wallet-name">${esc(short(token.address))}</div>`;
 const label=short(token.address);
 return `<button type="button" class="wallet-name token-contract-copy" data-copy-contract="${esc(token.address)}" data-copy-label="${esc(label)}" title="Kliknutím zkopírovat kontrakt" aria-label="Zkopírovat celý kontrakt ${esc(token.address)}">${esc(label)}</button>`;
}
async function copyTokenContract(button){
 try{
  const clipboard=globalThis.navigator?.clipboard;
  if(!clipboard?.writeText)throw new Error('Clipboard API unavailable');
  await clipboard.writeText(button.dataset.copyContract);
  const previous=tokenCopyTimers.get(button);if(previous)clearTimeout(previous);
  button.textContent='✓ Zkopírováno';
  tokenCopyTimers.set(button,setTimeout(()=>{button.textContent=button.dataset.copyLabel;tokenCopyTimers.delete(button);},1500));
 }catch{toast('Kontrakt se nepodařilo zkopírovat.');}
}
function readLocal(key) { try { const v=JSON.parse(localStorage.getItem(key)||'[]'); return Array.isArray(v)?v:[]; } catch { return []; } }
function writeLocal(key,value) { try { localStorage.setItem(key,JSON.stringify(value)); } catch { toast('Prohlížeč nepovolil místní uložení.'); } }
const savedWallets = readLocal('cd:watchlist:v1');
const savedQueries = readLocal('cd:queries:v1');
const defaults = ['ARB','WETH'].map(s => tokens.find(t => t.symbol===s && t.chainId==='arbitrum')).filter(Boolean);
const standaloneDemo=globalThis.location?.protocol==='file:';
const AIXBT_LANGUAGE_KEY='cd:aixbt-language';
let aixbtLanguage='cz';try{const savedAixbtLanguage=globalThis.localStorage?.getItem(AIXBT_LANGUAGE_KEY);if(savedAixbtLanguage==='en'||savedAixbtLanguage==='cz')aixbtLanguage=savedAixbtLanguage;}catch{}
let dashboardAixbtTranslationPromise=null;
let scanHistoryOpen=false;try{const savedHistoryState=globalThis.localStorage?.getItem('cd:scan-history-open');scanHistoryOpen=savedHistoryState==='true';if(savedHistoryState===null&&globalThis.sessionStorage?.getItem('cd:scan-history-open')==='true'){scanHistoryOpen=true;globalThis.localStorage?.setItem('cd:scan-history-open','true');}}catch{}
const dashboardMoniViews={growing:{feedTimeframe:'D7',changesTimeframe:'H24',orderBy:'SCORE_CHANGE',orderByDirection:'DESC'},top:{feedTimeframe:'D7',changesTimeframe:'H24',orderBy:'SCORE',orderByDirection:'DESC'},new:{feedTimeframe:'D7',changesTimeframe:'H24',orderBy:'CREATED_AT',orderByDirection:'DESC'}};
const dashboardMoniFeedLabels={ALL:'celý feed',M1:'1minutový feed',M5:'5minutový feed',H1:'1hodinový feed',H24:'24hodinový feed',D3:'3denní feed',D7:'7denní feed',D30:'30denní feed',D90:'90denní feed',D180:'180denní feed',Y1:'roční feed'};
const dashboardMoniChangeLabels={ALL:'změna za celé období',M1:'změna za 1 min',M5:'změna za 5 min',H1:'změna za 1 h',H24:'změna za 24 h',D3:'změna za 3 dny',D7:'změna za 7 dní',D30:'změna za 30 dní',D90:'změna za 90 dní',D180:'změna za 180 dní',Y1:'změna za 1 rok'};
const dashboardMoniOrderLabels={SCORE_CHANGE:'řazeno podle růstu Score',SCORE:'řazeno podle Moni Score',CREATED_AT:'řazeno podle novosti projektu'};
function dashboardMoniContext(filters){const feed=dashboardMoniFeedLabels[filters.feedTimeframe]||`feed ${filters.feedTimeframe||'—'}`,changes=dashboardMoniChangeLabels[filters.changesTimeframe]||`změna za ${filters.changesTimeframe||'—'}`,order=dashboardMoniOrderLabels[filters.orderBy]||`řazeno podle ${filters.orderBy||'Score'}`;return `${feed} · ${changes} · ${order}`;}
let savedDashboardMoniView='growing';try{const saved=globalThis.localStorage?.getItem('cd:dashboard-moni-view');if(saved in dashboardMoniViews)savedDashboardMoniView=saved;}catch{}
const state = { view:'dashboard',source:standaloneDemo?'demo':'live',provider:'auto',selectedTokens:defaults,chainIds:networks.filter(n=>standaloneDemo||n.live).map(n=>n.id),match:'all',result:null,rows:[],page:1,pageSize:8,selected:new Set(),smartDatasetAddresses:new Set(),serverScans:[],scanHistoryOpen,busy:false,dirty:false,controller:null,runId:0,activeWallet:null,tokenPageRequest:0,tokenPageController:null,dashboard:null,dashboardTopics:null,dashboardRequest:0,dashboardMoniView:savedDashboardMoniView,dashboardMoniFilters:dashboardMoniViews[savedDashboardMoniView],dashboardMoniRequest:0 };
const quickAddStates=new Map();
let walletCapabilities=null;
const supportsWalletChain=id=>state.provider==='blockscout'?(walletCapabilities?.blockscoutChains?.includes(id)??!!network(id).live):state.provider==='alchemy'?(walletCapabilities?.alchemyChains?.includes(id)??false):(walletCapabilities?.availableChains?.includes(id)??!!network(id).live);
const supportsCurrentChain=id=>state.source==='demo'||(state.view==='wallets'?supportsWalletChain(id):!!network(id).live);
async function refreshProviders(){
 try{const response=await fetch('/api/providers');if(!response.ok)return;walletCapabilities=(await response.json()).walletProfiler||null;}catch{}
 renderProviderStatus();renderChains();
}
const dashboardDate=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('cs-CZ',{dateStyle:'short',timeStyle:'short'}):'čas neznámý';
const dashboardTokenName=t=>t.symbol||short(t.address);
function renderDashboard(){
 const overview=state.dashboard;
 renderDashboardWallets(overview?.walletAnalysis||null);
 renderDashboardCorrelations(overview?.correlations||[]);
 renderDashboardResearch();
 renderDashboardMoni(overview?.moni||null);
 renderDashboardMoniTrending(overview?.moni?.trending||null);
 renderDashboardTopics(state.dashboardTopics);
}
function renderDashboardWallets(dataSet){
 const root=$('dashboard-wallets'),fresh=$('dashboard-wallet-freshness');
 if(!dataSet){fresh.textContent='';root.innerHTML='<div class="dashboard-empty"><strong>Zatím není uložená použitelná Wallet Analyzer analýza.</strong><p>Po dokončení použitelných Wallet Analyzer scanů se jejich výsledky postupně sloučí sem. Dashboard sken sám nespustí.</p><button class="text-button" data-view="wallets">Analyzovat wallets →</button></div>';return;}
 const coverage=dataSet.coverage||{},freshness=dataSet.freshness||{},walletFreshness=freshness.wallets||{},newest=freshness.newest,oldest=freshness.oldest;
 fresh.textContent=`Nejnovější data: ${dashboardDate(newest)} · nejstarší: ${dashboardDate(oldest)}`;
 const walletCount=Number(coverage.successful)||0,networkCount=Number(coverage.walletNetworkCount)||walletCount,networks=(dataSet.networks||[]).map(id=>network(id).name).join(' · ');
 const tokenRows=(dataSet.tokens||[]).map(token=>`<div class="dashboard-token-row"><span><strong>${esc(token.symbol||'ERC-20')}</strong><small>${esc(network(token.chainId).name)} · ${esc(token.name||short(token.address))}</small></span><span><b>${number(token.holderCount)} / ${number(token.analyzedWalletCount)}</b><small>${(token.share*100).toLocaleString('cs-CZ',{maximumFractionDigits:1})} % drží · ${token.unpricedPositions?number(token.unpricedPositions)+' bez ceny':money(token.totalValue,true)}</small></span></div>`).join('');
 root.innerHTML=`<div class="dashboard-data-meta"><strong>Analyzováno: ${number(walletCount)} ${walletCount===1?'wallet':'walletů'}</strong><span>${number(walletFreshness.fresh)} aktuálních · ${number(walletFreshness.aging)} starších · ${number(walletFreshness.stale)} k obnovení</span><small>${number(networkCount)} uložených stavů wallet/network${networks?` · ${esc(networks)}`:''}</small></div>${tokenRows?`<div class="dashboard-token-list">${tokenRows}</div>`:'<div class="dashboard-empty">V uloženém datasetu nejsou interpretovatelné pozice.</div>'}`;
}function renderDashboardCorrelations(rows){
 $('dashboard-correlations').innerHTML=rows.length?rows.map(scan=>`<article class="dashboard-research-row"><div><strong>${esc(scan.tokens.map(token=>token.symbol).join(scan.match==='all'?' AND ':' OR '))}</strong><small>${number(scan.resultCount)} shod · ${scan.match==='all'?'Všechny tokeny (AND)':'Alespoň jeden (OR)'} · ${esc(dashboardDate(scan.createdAt))}</small><small>${scan.query.minPositionUsd?`Min. ${money(scan.query.minPositionUsd)} · `:''}${scan.query.holderCap?`cap ${number(scan.query.holderCap)}`:'bez limitu'}</small>${scan.warnings?.some(w=>/Top \d|limit holderů|nebylo možné bezpečně použít/i.test(w))?`<small class="dashboard-warning">${esc(scan.warnings.find(w=>/Top \d|limit holderů|nebylo možné bezpečně použít/i.test(w)))}</small>`:''}</div><button class="subtle-button" data-open-scan="${esc(scan.id)}">Otevřít</button></article>`).join(''):'<div class="dashboard-empty">Zatím nejsou uložené výsledky Token Screeneru.</div>';
}
function renderDashboardResearch(){
 const queries=savedQueries.filter(query=>query.source==='live').slice(0,3),wallets=savedWallets.filter(item=>item.source==='live'&&!data.isIgnoredWalletAddress(item.wallet?.address)).slice(0,3);
 const queryRows=queries.map(query=>`<article class="dashboard-research-row"><div><strong>${query.view==='wallets'?'Peněženky → tokeny':esc((query.tokens||[]).map(token=>token.symbol).join(query.match==='all'?' AND ':' OR '))||'Tokenový dotaz'}</strong><small>${esc(query.provider||'Automaticky')} · ${esc(query.match?.toUpperCase()||'')} · ${esc(dashboardDate(query.date))}</small></div><button class="subtle-button" data-load-query="${esc(query.id)}">Předvyplnit</button></article>`).join('');
 const walletRows=wallets.map(item=>`<button class="dashboard-research-row dashboard-watch-row" data-dashboard-wallet="${esc(item.wallet?.address||'')}"><span><strong>${esc(item.wallet?.label||item.wallet?.address||'Peněženka')}</strong><small>${esc(item.wallet?.address||'')} · Snapshot ${esc(dashboardDate(item.savedAt))}</small></span><span>Otevřít →</span></button>`).join('');
 $('dashboard-research').innerHTML=queryRows||walletRows?`${queryRows}${walletRows}<button class="text-button dashboard-more" data-dashboard-view="watchlist">Otevřít Watchlist →</button>`:'<div class="dashboard-empty">Ukládejte dotazy nebo peněženky do Watchlistu a vraťte se k nim později.</div>';
}
function renderDashboardMoni(moni){
 const panel=$('dashboard-moni-panel'),root=$('dashboard-moni'),accounts=moni?.accounts||[];panel.hidden=!moni?.watchlistCount;
 root.innerHTML=accounts.length?accounts.map(item=>`<div class="dashboard-research-row"><div><strong>@${esc(item.handle)}</strong><small>${item.profile?`Moni Score ${number(item.profile.score)} · cache ${esc(dashboardDate(item.profile.fetchedAt))}`:'Profil zatím není v místní cache'}</small></div><button class="text-button" data-dashboard-view="socials">Socials →</button></div>`).join(''):'<div class="dashboard-empty">Sledujete účty v Socials; jejich data se načtou až na výslovné vyžádání.</div>';
}
function renderDashboardMoniTrending(payload){
 const root=$('dashboard-moni-trending'),fresh=$('dashboard-moni-freshness'),context=$('dashboard-moni-view-context'),notice=$('dashboard-moni-cache-notice'),items=payload?.items||[];
 const filters=payload?.filters||state.dashboardMoniFilters;
 if(context)context.textContent=dashboardMoniContext(filters);
 const activeView=Object.keys(dashboardMoniViews).find(key=>dashboardMoniViews[key].orderBy===filters.orderBy)||state.dashboardMoniView;document.querySelectorAll('[data-moni-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.moniView===activeView)));
 const signature=JSON.stringify(items),resetCarousel=dashboardMoniCarouselView!==activeView||dashboardMoniCarouselSignature!==signature;dashboardMoniCarouselView=activeView;dashboardMoniCarouselSignature=signature;
 const stateLabel=payload?.refreshing?'obnova…':payload?.cacheStatus==='missing'?'nenačteno':payload?.stale?'zastaralá data':'aktualizováno';
 fresh.textContent=payload?.fetchedAt?`MONI · ${stateLabel} ${dashboardDate(payload.fetchedAt)}`:`MONI · ${payload?.refreshing?'načítám…':'nenačteno'}`;
 if(notice){notice.textContent=payload?.stale?`Zastaralá data${payload.refreshing?' · obnovuji na pozadí':''}${payload.refreshError?` · ${payload.refreshError}`:''}`:payload?.refreshError||'';notice.hidden=!notice.textContent;}
 if(!payload?.fetchedAt||!items.length){const missing=payload?.cacheStatus==='missing'||!payload;root.classList.add('is-empty');root.innerHTML=`<div class="dashboard-moni-empty"><span>${payload?.refreshing?'Načítám vybraný MONI pohled…':payload?.refreshError?esc(payload.refreshError):missing?'Pro tento pohled zatím není cache.':'MONI pro tento pohled nevrátilo projekty.'}</span>${missing&&!payload?.refreshing?'<button type="button" class="text-button" data-moni-load>Obnovit · až 10 bodů</button>':''}</div>`;renderDashboardMoniCarouselControls(resetCarousel);if(payload?.refreshing)window.setTimeout(()=>{if(state.view==='dashboard')updateDashboardMoniView(state.dashboardMoniView,{quiet:true});},1500);return;}
 root.classList.remove('is-empty');root.innerHTML=items.map((item,index)=>{
  const handle=String(item.handle||'').replace(/^@/,''),categories=Array.isArray(item.categories)?item.categories.filter(Boolean):[],chains=Array.isArray(item.chains)?item.chains.filter(Boolean):[],metadata=[...categories,...chains].filter(Boolean).join(' · '),score=item.score===null||item.score===undefined?'—':number(item.score),change=Number.isFinite(item.smartMentionsChange)?`${item.smartMentionsChange>0?'+':''}${number(item.smartMentionsChange)} / ${dashboardMoniChangeCompact(filters.changesTimeframe)}`:'',avatar=esc(handle.slice(0,1).toUpperCase()||'?'),contents=`<span class="dashboard-moni-card-heading"><span class="dashboard-moni-rank">#${index+1}</span><span class="dashboard-moni-avatar" aria-hidden="true">${avatar}</span><strong>@${esc(handle)}</strong></span><span class="dashboard-moni-score"><small>Moni Score</small>${score}</span><span class="dashboard-moni-card-stats"><span>Smarts <b>${number(item.smartsCount)}</b> · Smart Mentions <b>${number(item.smartMentionsCount)}</b></span>${change?`<span><em>${esc(change)}</em></span>`:''}</span><span class="dashboard-moni-copy"><small>${esc(metadata||'Kategorie neuvedena')}</small></span>`;
  return item.url?`<a class="dashboard-moni-row" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" title="Otevřít @${esc(handle)} na X">${contents}</a>`:`<div class="dashboard-moni-row">${contents}</div>`;
 }).join('');renderDashboardMoniCarouselControls(resetCarousel);if(payload?.refreshing)window.setTimeout(()=>{if(state.view==='dashboard')updateDashboardMoniView(state.dashboardMoniView,{quiet:true});},1500);
}
function dashboardMoniChangeCompact(code){return ({ALL:'ALL',M1:'1M',M5:'5M',H1:'1H',H24:'24H',D3:'3D',D7:'7D',D30:'30D',D90:'90D',D180:'180D',Y1:'1Y'})[code]||String(code||'');}
let dashboardMoniCarouselView='',dashboardMoniCarouselSignature='';
function renderDashboardMoniCarouselControls(reset=false){const root=$('dashboard-moni-trending'),nav=$('dashboard-moni-carousel-nav'),previous=$('dashboard-moni-carousel-prev'),next=$('dashboard-moni-carousel-next');if(!root||!nav||!previous||!next)return;if(reset)root.scrollLeft=0;const canScroll=root.scrollWidth>root.clientWidth+2;nav.hidden=!canScroll;previous.disabled=root.scrollLeft<=1;next.disabled=root.scrollLeft+root.clientWidth>=root.scrollWidth-2;}
function scrollDashboardMoniCarousel(direction){const root=$('dashboard-moni-trending');if(root)root.scrollBy({left:direction*root.clientWidth,behavior:'smooth'});}
function aixbtCopy(){return aixbtLanguage==='cz'?{fresh:'snapshot',stale:'poslední cache',outdated:'zastaralá',unavailable:'nedostupné',empty:'AIXBT nyní nevrátilo žádná témata.',noSummary:'AIXBT neposkytlo stručné shrnutí.',topic:'Téma',loading:'Načítám detail a propojené projekty…',updated:'Aktualizováno',cached:'Poslední uložená cache',projects:'Propojené projekty',noProjects:'K tématu zatím nejsou propojené projekty.',observedPosts:'pozorovaných příspěvků',authors:'autoři',footnote:'AIXBT projekty nejsou automaticky mapované na tokeny ani kontrakty. Před screenerem kontrakt ověřte.',external:'Otevřít detail nebo zdroj na AIXBT',posts:'příspěvky',noData:'Trending témata nejsou dostupná.',language:'Jazyk AIXBT',untranslated:'Originální text AIXBT — český překlad není dostupný'}:{fresh:'snapshot',stale:'latest cache',outdated:'stale',unavailable:'unavailable',empty:'AIXBT returned no topics.',noSummary:'AIXBT did not provide a summary.',topic:'Topic',loading:'Loading topic details and linked projects…',updated:'Updated',cached:'Last cached',projects:'Linked projects',noProjects:'No linked projects for this topic yet.',observedPosts:'observed posts',authors:'authors',footnote:'AIXBT projects are not automatically mapped to tokens or contracts. Verify the contract before using the screener.',external:'Open topic details or source on AIXBT',posts:'posts',noData:'Trending topics are unavailable.',language:'AIXBT language',untranslated:'Original AIXBT text — Czech translation is unavailable'};}
function ensureDashboardAixbtTranslations(){const source=state.dashboardTopics,items=source?.items||[];if(aixbtLanguage!=='cz'||!source?.available||!items.length||items.every(item=>item.translationStatus==='success'||item.translationStatus==='cached'||item.translationStatus==='fallback'||aixbtTopicText(item,'cz').translated))return dashboardAixbtTranslationPromise;if(dashboardAixbtTranslationPromise)return dashboardAixbtTranslationPromise;dashboardAixbtTranslationPromise=data.getDashboardTopics('cs').then(payload=>{if(state.dashboardTopics!==source||state.view!=='dashboard'||!payload?.available)return;state.dashboardTopics=payload;renderDashboardTopics(payload);}).catch(()=>{}).finally(()=>{dashboardAixbtTranslationPromise=null;});return dashboardAixbtTranslationPromise;}
function setAixbtLanguage(language){if(language!=='cz'&&language!=='en')return;aixbtLanguage=language;try{globalThis.localStorage?.setItem(AIXBT_LANGUAGE_KEY,language);}catch{}renderDashboardTopics(state.dashboardTopics);if(language==='cz')ensureDashboardAixbtTranslations();}
function aixbtTopicText(topic,language){return typeof data.resolveAixbtTopicText==='function'?data.resolveAixbtTopicText(topic,language):{name:String(topic?.name||''),summary:String(topic?.summary||''),translated:false};}
function renderDashboardTopics(payload){
 const root=$('dashboard-topics'),fresh=$('dashboard-aixbt-freshness'),copy=aixbtCopy(),eyebrow=$('dashboard-aixbt-eyebrow');if(eyebrow)eyebrow.textContent=aixbtLanguage==='cz'?'EXTERNÍ DISCOVERY':'EXTERNAL DISCOVERY';$('dashboard-aixbt-language')?.setAttribute('aria-label',copy.language);document.querySelectorAll('[data-aixbt-language]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.aixbtLanguage===aixbtLanguage)));if(!payload){root.innerHTML=`<div class="dashboard-empty">${esc(copy.noData)}</div>`;return;}
 if(payload.available){const snapshot=payload.snapshot?.completedAt||payload.snapshot?.latestEvidenceAt||payload.fetchedAt;fresh.textContent=`AIXBT · ${payload.stale?copy.stale:copy.fresh} ${dashboardDate(snapshot)}${payload.stale?` · ${copy.outdated}`:''}`;root.innerHTML=payload.items?.length?payload.items.map(topic=>{const localized=aixbtTopicText(topic,aixbtLanguage),hasOriginalText=!!(localized.name||localized.summary),fallback=aixbtLanguage==='cz'&&hasOriginalText&&!localized.translated?` <span class="aixbt-translation-fallback" title="${esc(copy.untranslated)}">EN</span>`:'';return `<button class="dashboard-topic-row" data-aixbt-topic="${esc(topic.id)}" title="${esc(copy.external)}"><span class="dashboard-topic-rank">#${number(topic.rank)}</span><span class="dashboard-topic-copy"><strong>${esc(localized.name||copy.topic)}${fallback} <span class="dashboard-topic-external" aria-hidden="true">↗</span></strong><small>${esc(localized.summary||copy.noSummary)}</small></span><span class="dashboard-topic-metrics">${topic.trend===null?'—':number(topic.trend)}<small>trend</small><small>${number(topic.postCount)} ${copy.posts} · ${number(topic.authorCount)} ${copy.authors}</small></span></button>`;}).join(''):`<div class="dashboard-empty">${esc(copy.empty)}</div>`;if(payload.warning)root.innerHTML+=`<small class="dashboard-warning">${esc(payload.warning)}</small>`;return;}
 fresh.textContent=`AIXBT · ${copy.unavailable}`;root.innerHTML=`<div class="dashboard-empty">${esc(payload.error||'Veřejné topic rankings se nepodařilo načíst.')}</div>`;
}
let dashboardTopicRequest=0;
function openAixbtExternal(url){if(typeof url!=='string'||!url)return false;try{const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password)return false;const link=document.createElement('a');link.href=parsed.href;link.target='_blank';link.rel='noopener noreferrer';link.title='Otevřít zdroj na AIXBT';link.hidden=true;document.body.append(link);link.click();link.remove();return true;}catch{return false;}}
async function loadDashboard(){
 const request=++state.dashboardRequest;renderDashboard();
 if(standaloneDemo){state.dashboardTopics={available:false,error:'Veřejné API je dostupné pouze při spuštění aplikace přes server.'};renderDashboard();return;}
 const [overviewResult,topicsResult]=await Promise.allSettled([data.getDashboard(state.dashboardMoniView),data.getDashboardTopics('en')]);if(request!==state.dashboardRequest||state.view!=='dashboard')return;
 state.dashboard=overviewResult.status==='fulfilled'?overviewResult.value:null;
 state.dashboardTopics=topicsResult.status==='fulfilled'?topicsResult.value:{available:false,error:topicsResult.reason?.message||'AIXBT není dostupné.'};renderDashboard();if(aixbtLanguage==='cz')ensureDashboardAixbtTranslations();
}
async function updateDashboardMoniView(view,{quiet=false}={}){
 if(!dashboardMoniViews[view])return;state.dashboardMoniView=view;state.dashboardMoniFilters=dashboardMoniViews[view];try{globalThis.localStorage?.setItem('cd:dashboard-moni-view',view);}catch{};
 const request=++state.dashboardMoniRequest,root=$('dashboard-moni-trending');if(!quiet){root.scrollLeft=0;root.classList.add('is-empty');root.innerHTML='<div class="dashboard-empty">Načítám vybraný MONI pohled…</div>';renderDashboardMoniCarouselControls(true);}
 if(standaloneDemo)return;
 try{const overview=await data.getDashboard(view);if(request!==state.dashboardMoniRequest||state.view!=='dashboard')return;state.dashboard=overview;renderDashboardMoniTrending(overview?.moni?.trending||null);}catch(error){if(request===state.dashboardMoniRequest){const fresh=$('dashboard-moni-freshness');fresh.textContent='MONI · nedostupné';root.classList.add('is-empty');root.innerHTML=`<div class="dashboard-moni-empty">${esc(error.message||'MONI discovery není dostupné.')}</div>`;renderDashboardMoniCarouselControls(true);}}
}
async function loadDashboardMoniManually(button){
 if(button.disabled)return;button.disabled=true;button.textContent='Načítám z MONI…';
 try{await data.loadDashboardMoniProjects(state.dashboardMoniFilters);const overview=await data.getDashboard(state.dashboardMoniView);if(state.view==='dashboard'){state.dashboard=overview;renderDashboardMoniTrending(overview?.moni?.trending||null);}}
 catch(error){toast(error.message||'Moni Projects Feed se nepodařilo načíst.');button.disabled=false;button.textContent='Zkusit znovu';}
}
async function openDashboardTopic(id){
 const request=++dashboardTopicRequest,dialog=$('aixbt-topic-dialog'),content=$('aixbt-topic-content'),listed=state.dashboardTopics?.items?.find(item=>String(item.id)===String(id)),copy=aixbtCopy(),listedText=aixbtTopicText(listed||{},aixbtLanguage);$('aixbt-topic-title').innerHTML=esc(listedText.name||copy.topic);$('aixbt-topic-eyebrow').textContent=aixbtLanguage==='cz'?'AIXBT / DETAIL TÉMATU':'AIXBT / TOPIC DETAIL';content.innerHTML=`<div class="loading-row"><span class="spinner"></span>${esc(copy.loading)}</div>`;dialog.showModal();
 try{const result=await data.getDashboardTopic(id);if(request!==dashboardTopicRequest)return;if(!result.available){if(!listedText.summary&&openAixbtExternal(listed?.url)){dialog.close();return;}throw new Error(result.error||'Detail tématu není dostupný.');}const topic=result.topic||{},topicText=aixbtTopicText(topic,aixbtLanguage),name=topicText.name||listedText.name||copy.topic,summary=topicText.summary||listedText.summary,projects=result.projects||[];$('aixbt-topic-title').textContent=name;if(!summary&&!projects.length){if(openAixbtExternal(topic.url)||openAixbtExternal(listed?.url)){dialog.close();return;}dialog.close();toast('Detail tématu neobsahuje další dostupné informace.');return;}content.innerHTML=`${summary?`<p class="dashboard-topic-summary">${esc(summary)}</p>`:''}<p class="dashboard-freshness">${result.stale?copy.cached:copy.updated} ${esc(dashboardDate(result.fetchedAt))}</p><h3>${esc(copy.projects)}</h3>${projects.length?projects.map(project=>`<div class="dashboard-research-row"><div><strong>${esc(project.name)}</strong><small>${project.observedPosts===null?'':`${number(project.observedPosts)} ${copy.observedPosts} · `}${project.observedAuthors===null?'':`${number(project.observedAuthors)} ${copy.authors}`}</small></div><span class="dashboard-freshness">AIXBT</span></div>`).join(''):`<p class="dashboard-empty">${esc(copy.noProjects)}</p>`}<p class="dashboard-footnote">${esc(copy.footnote)}</p>`;}catch(error){if(request===dashboardTopicRequest){if(!listedText.summary&&openAixbtExternal(listed?.url)){dialog.close();return;}dialog.close();toast(error.message||'Detail tématu není dostupný.');}}
}
function renderProviderStatus(){
 const configured=!!walletCapabilities?.alchemyConfigured,walletMode=state.view==='wallets';
 const select=$('provider-select');
 if(select){
   select.innerHTML='<option value="auto">Automaticky'+(walletMode&&configured?' · Alchemy + Blockscout':' · Blockscout')+'</option><option value="blockscout">Blockscout · podporované sítě</option><option value="alchemy" '+(!walletMode||!configured?'disabled':'')+'>Alchemy'+(!walletMode?' · pouze portfolio':!configured?' · chybí API klíč':' · Base bez fallbacku')+'</option>'+['Chainbase','Moralis','GoldRush','Codex','Bitquery','Dune'].map(name=>'<option disabled>'+name+' · nepřipojeno</option>').join('');
  if(state.provider==='alchemy'&&(!walletMode||!configured))state.provider='auto';
  select.value=state.provider;select.disabled=state.source==='demo';
 }
  const label=state.provider==='blockscout'||!walletMode?'Blockscout':state.provider==='alchemy'?'Alchemy':'Alchemy + Blockscout';
  const message=state.source==='demo'?'Samostatná ukázka se syntetickými daty. Pro skutečná data otevřete lokální server.':state.view==='watchlist'?'Uložené on-chain snapshoty. Aktuální zůstatky ověříte novou analýzou.':label+'. '+(state.provider==='blockscout'?'Dotaz použije pouze Blockscout na podporovaných sítích.':walletMode&&configured?'Ethereum, Optimism a Arbitrum mohou přejít na Blockscout; Base běží pouze přes Alchemy a Robinhood Chain přes Blockscout.':'')+(walletMode&&!configured?' Alchemy není nakonfigurované; Base proto není dostupná.':'')+' Dotaz se spustí až vaším tlačítkem.';
 const note=$('provider-note');if(note)note.textContent=message;
  const el=$('wallet-provider-status');if(el){el.hidden=state.source!=='live';const routes=walletCapabilities?.routes||[];const routeText=routes.map(r=>`${network(r.chainId).name} · ${r.provider==='alchemy'?'Alchemy':r.provider==='blockscout'?'Blockscout':'nedostupné'}${r.fallbackFrom?' (fallback)':''}`).join(' · ');el.textContent=!walletMode?'':state.provider==='blockscout'?`Ručně: Blockscout na podporovaných sítích. Base přes Blockscout analyzovat nelze.`:state.provider==='alchemy'?`Ručně: Alchemy pro Ethereum, Base, Optimism a Arbitrum; při chybě je povolen Blockscout fallback na Ethereum, Optimism a Arbitrum.`:walletCapabilities?.circuitBreakers?.length?`${walletCapabilities.message} ${routeText}`:routeText?`Automatické trasy: ${routeText}. Base nemá Blockscout fallback.`:'Dostupné trasy se zobrazí po připojení serveru.';}
}
function changeProvider(value){
 if(!['auto','blockscout','alchemy'].includes(value))return;
 state.provider=value;renderProviderStatus();
 state.chainIds=state.chainIds.filter(supportsCurrentChain);
 renderChains();markDirty();
}
let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
function setError(message=''){$('query-error').textContent=message;$('query-error').hidden=!message;}
function info(title,html){$('info-title').textContent=title;$('info-content').innerHTML=html;$('info-dialog').showModal();}
function guide(){info('Váš výzkum začíná tady.',`<p>Jeden pracovní prostor. Dva způsoby, jak propojit tokeny a adresy.</p><h3>01 / Tokeny → peněženky</h3><p>Vyberte až pět tokenů podle <strong>kontraktu a sítě</strong>. Režim <strong>AND</strong> najde adresy s každým z nich; <strong>OR</strong> adresy s alespoň jedním. Filtr minimální pozice se vztahuje na součet známých USD hodnot vybraných tokenů.</p><h3>02 / Peněženky → tokeny</h3><p>Analyzujte až 500 EVM adres v jednom skenu. Coverage znamená dokončené stránkování. Popularita se počítá zvlášť pro každou síť pouze z wallet/network tasků s dokončeným stránkováním a bez neinterpretovaných řádků; varovné nebo neúplné tasky nejsou považovány za absenci tokenu.</p><h3>03 / Navazujte na výsledky</h3><p>Otevřete detail adresy, uložte ji hvězdičkou do watchlistu nebo vyberte více řádků pro navazující analýzu. Dotazy i watchlist se ukládají lokálně v tomto prohlížeči.</p><p>Zdroj vyberte v roletce. Automaticky použije dostupný adaptér; Blockscout vynutí tento zdroj. Nepřipojené služby nelze vybrat. Rozsah výsledků ověřte v metodice.</p>`);}
function coverageText(){
  const c=state.result?.coverage;
  if(typeof c==='string')return c;
  return c?.message || c?.summary || (state.source==='demo'?'Syntetický ukázkový dataset. Zobrazené adresy, štítky a hodnoty neslouží jako reálné investiční signály.':'Stránkovaný sken indexeru. Úplnost a použitý zdroj se zobrazí po načtení.');
}
function dataInfo(){
 const warnings=(state.result?.warnings||[]).map(w=>`<li>${esc(typeof w==='string'?w:w.message||JSON.stringify(w))}</li>`).join('');
 info('Zdroje, rozsah a metodika',`<p><strong>Aktuální režim: ${state.source==='demo'?'Demo · syntetická data':'Live · serverové indexery'}</strong></p><p>${esc(coverageText())}</p>${warnings?`<h3>Upozornění k poslednímu skenu</h3><ul>${warnings}</ul>`:''}<h3>Co výsledky znamenají</h3><p>USD hodnota ve screeneru je součet <strong>vybraných pozic</strong>, nikoli celého portfolia. V analýze jde o načtené ERC-20 zůstatky. Token bez dostupné ceny má hodnotu <strong>neznámou</strong>. Nativní ETH, NFT a DeFi pozice tato verze neagreguje.</p><p>Veřejná API jsou stránkovaná a mohou být omezená, zpožděná nebo nedostupná. Průnik se počítá pouze nad načtenými držiteli. <strong>Prázdný výsledek neprokazuje, že žádní držitelé neexistují.</strong> Chyby se uvádějí odděleně od výsledků.</p><h3>Sítě</h3><p>${networks.map(n=>esc(n.name)).join(' · ')}. Holder scanner používá Blockscout. Wallet Analyzer běží přes Alchemy na Ethereum, Base, Optimism a Arbitrum; Ethereum, Optimism a Arbitrum mohou při chybě přejít na Blockscout Pro. Base Blockscout fallback nemá. Robinhood Chain používá Blockscout. zkSync Era, Scroll a Linea jsou archivní sítě dostupné pouze pro čtení starších dat. Adresy a kontrakty se odesílají veřejným indexerům pouze po spuštění živého dotazu.</p><h3>Serverové skeny</h3><p>Live dotazy načítá lokální server. Každou stránku, výsledky a bod pokračování ukládá do SQLite. Průběžné výsledky lze otevřít bez zastavení skenu; přehled se obnovuje každé 3 sekundy. Samostatná akce Pozastavit zastaví další načítání a uloží aktuální stránky i kurzory, sken pak lze později obnovit. Historie je dostupná v panelu Serverové skeny. Dokončené stejné dotazy se 15 minut používají z uložených dat; tlačítko Načíst čerstvá data založí nový sken.</p><p>Dokončené stránkování znamená, že indexer vrátil všechny stránky. Scan s neinterpretovanými řádky má stav Dokončeno s upozorněním; takové wallet/network tasky se nepoužijí pro popularitu ani jako důkaz, že wallet token nedrží. Popularita počítá holdery i jmenovatel pouze ze spolehlivých tasků dané sítě. Coverage a kvalita dat jsou oddělené údaje. Zůstatky pocházejí z časového intervalu skenu a nejsou snapshotem k jednomu bloku. Po restartu serveru zůstane rozpracovaný sken pozastavený.</p><h3>Lokální uložení</h3><p>Watchlist uchovává snapshot pozic s označením zdroje. Není průběžně aktualizovaný. Demo a live záznamy jsou vedené odděleně.</p><p>Dokumentace zdroje: <a href="https://docs.blockscout.com/devs/apis" target="_blank" rel="noopener noreferrer">Blockscout APIs ↗</a></p>`);
}
function renderTokens(){
 $('selected-tokens').innerHTML=state.selectedTokens.map(t=>`<div class="token-chip">${coin(t)}<span>${esc(t.symbol)}<small>${esc(network(t.chainId).name)}</small></span><button data-remove-token="${esc(tokenKey(t))}" aria-label="Odebrat ${esc(t.symbol)}">×</button></div>`).join('');
 $('token-count').textContent=`${state.selectedTokens.length} / 5`;
 $('add-token').hidden=state.selectedTokens.length>=5;
 document.querySelectorAll('[data-match]').forEach(b=>{b.classList.toggle('active',b.dataset.match===state.match);b.setAttribute('aria-pressed',b.dataset.match===state.match);});
}
function renderChains(){
 $('chain-filters').innerHTML=networks.map(n=>`<button class="chain-chip ${state.chainIds.includes(n.id)?'active':''}" data-chain="${esc(n.id)}" ${!supportsCurrentChain(n.id)?'disabled':''} aria-pressed="${state.chainIds.includes(n.id)}" title="${state.source==='live'&&!(state.view==='wallets'?supportsWalletChain(n.id):n.live)?'Zvolený zdroj tuto síť nepodporuje.':esc(n.name)}">${chainIcon(n.id)} ${esc(n.name.replace(' Era',''))}${state.source==='live'&&!(state.view==='wallets'?supportsWalletChain(n.id):n.live)?' <span class="demo-only">NEDOSTUPNÉ</span>':''}</button>`).join('');
 $('all-chains').textContent=state.chainIds.length===networks.filter(n=>supportsCurrentChain(n.id)).length?'Zrušit výběr':'Vybrat vše';
 const networkFilter=$('result-network');if(networkFilter){const current=networkFilter.value;networkFilter.innerHTML='<option value="">Všechny sítě</option>'+networks.filter(n=>state.chainIds.includes(n.id)).map(n=>`<option value="${esc(n.id)}">${esc(n.name)}</option>`).join('');networkFilter.value=state.chainIds.includes(current)?current:'';}
}
function setBusy(b){state.busy=b;['scan-button','scan-min-position','scan-min-position-custom','scan-max-holders','analyze-button','result-search','min-value','min-holders','min-share','result-network','hide-spam','sort-select','export-button','save-search','previous-page','next-page'].forEach(id=>$(id).disabled=b);if($('select-all'))$('select-all').disabled=b;$('scan-button').innerHTML=b?'<span class="spinner"></span> Hledám držitele…':`${icon('search')}<span>Najít peněženky</span><span class="button-arrow">↗</span>`;$('analyze-button').innerHTML=b?'<span class="spinner"></span> Analyzuji…':`${icon('chart')} Analyzovat peněženky <span class="button-arrow">↗</span>`;}
function updateHolderCapWarning(){$('holder-cap-warning').hidden=$('scan-max-holders').value!=='0';}
function markDirty(){
 state.runId++;state.controller?.abort();setBusy(false);state.dirty=true;state.result=null;state.selected.clear();state.page=1;setError();renderResults();
 if(state.source==='demo'&&state.view==='screener'&&state.selectedTokens.length&&state.chainIds.length)run();
}
function setSource(source){
 if(source==='demo'&&!standaloneDemo){toast('Demo dotazy jsou dostupné pouze v samostatné ukázce.');return;}
 if(source===state.source)return;
 closeDrawer();
 stopLiveResultPolling();
 state.source=source;state.result=null;state.dirty=true;state.rows=[];state.runId++;state.controller?.abort();setBusy(false);state.selected.clear();state.page=1;setError();
 document.querySelectorAll('[data-source]').forEach(b=>{b.classList.toggle('active',b.dataset.source===source);b.setAttribute('aria-pressed',b.dataset.source===source);});
 $('source-banner').classList.toggle('live-banner',source==='live');
 $('source-banner').innerHTML=icon('database')+'<span id="provider-note"></span>';
 $('load-wallet-demo').hidden=source==='live';
 renderChains();
 if(state.view==='wallets'){$('wallet-addresses').value=source==='demo'?demoAddresses().join('\n'):'';state.smartDatasetAddresses.clear();}
 renderProviderStatus();refreshProviders();refreshServerScans();renderResults();if(source==='demo'&&state.view!=='watchlist')run();
}
function setView(view){
 if(view===state.view&&view!=='dashboard')return;
 stopLiveResultPolling();
 closeDrawer();
 state.view=view;state.result=null;state.dirty=false;state.page=1;state.selected.clear();state.runId++;state.controller?.abort();setBusy(false);setError();$('result-search').value='';$('min-value').value='';
 const walletMode=view==='wallets';
 document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
 document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===view);b.setAttribute('aria-selected',b.dataset.mode===view);});
 const title={dashboard:'Dashboard',screener:'Token screener',wallets:'Analýza peněženek',watchlist:'Váš watchlist',smart:'Smart wallets',socials:'Socials','early-buyers':'Early buyers'}[view];
 $('breadcrumb-view').textContent=title;$('page-title').innerHTML=`${title}<span>.</span>`;
 $('page-description').textContent={dashboard:'Discovery z externích zdrojů vedle vašich uložených dat a research.',screener:'Najděte peněženky, které drží tokeny, na kterých vám záleží.',wallets:'Propojte adresy. Objevte společné pozice a koncentraci kapitálu.',watchlist:'Zajímavé adresy na jednom místě. Navazujte na svůj výzkum.',smart:'Budujte vlastní seznam peněženek, které stojí za pozornost.',socials:'Sledujte pozornost kolem tokenů, projektů a lidí.','early-buyers':'Sledujte potvrzené nákupy trending tokenů před jejich objevením v Trending.'}[view];
 const dashboard=view==='dashboard',smart=view==='smart',socials=view==='socials',early=view==='early-buyers',separate=smart||socials||early;$('dashboard-section').hidden=!dashboard;$('smart-section').hidden=!smart;$('socials-section').hidden=!socials;$('early-buyers-section').hidden=!early;$('research-results').hidden=separate||dashboard;$('source-controls').hidden=separate||dashboard||view==='watchlist';$('saved-searches').hidden=separate||dashboard||view==='watchlist';$('source-banner').hidden=separate||dashboard;
 if(dashboard){$('query-panel').hidden=true;$('sidebar').classList.remove('open');loadDashboard();return;}
 if(socials){$('query-panel').hidden=true;$('saved-searches').hidden=true;$('sidebar').classList.remove('open');socialsModule.show();return;}
 if(smart){$('query-panel').hidden=true;$('saved-searches').hidden=true;$('sidebar').classList.remove('open');smartWallets.show();return;}
 if(early){$('query-panel').hidden=true;$('saved-searches').hidden=true;$('sidebar').classList.remove('open');earlyBuyers.show();return;}
 $('query-panel').hidden=view==='watchlist';$('token-query').hidden=walletMode;$('wallet-query').hidden=!walletMode;
 $('save-search').hidden=view==='watchlist';$('saved-searches').hidden=view==='watchlist';
 $('sort-select').innerHTML=walletMode?'<option value="holders">Nejvíce držitelů / podíl</option><option value="value">Hodnota: nejvyšší</option>':'<option value="value">Hodnota: nejvyšší</option><option value="match">Počet tokenů</option><option value="address">Adresa A–Z</option>';
 $('sort-select').value=walletMode?'holders':'value';$('min-value-wrap').hidden=walletMode;document.querySelectorAll('.wallet-result-filter').forEach(el=>el.hidden=!walletMode);
 if(walletMode){$('result-network').innerHTML='<option value="">Všechny sítě</option>'+networks.filter(n=>state.chainIds.includes(n.id)).map(n=>`<option value="${esc(n.id)}">${esc(n.name)}</option>`).join('');$('min-holders').value='';$('min-share').value='';$('result-network').value='';}
 $('result-search').placeholder=walletMode?'Hledat token nebo kontrakt…':'Hledat adresu nebo štítek…';
 $('sidebar').classList.remove('open');
 if(walletMode&&state.source==='demo'&&!analysisAddresses().length){$('wallet-addresses').value=demoAddresses().join('\n');state.smartDatasetAddresses.clear();}
 renderChains();renderProviderStatus();refreshProviders();refreshServerScans();renderResults();if(walletMode){renderWalletInputContext();refreshSmartMetadata();}if(state.source==='demo'&&view!=='watchlist')run();
}
function manualAddresses(){return [...new Set($('wallet-addresses').value.trim().split(/[\s,;]+/).filter(Boolean).map(a=>a.toLowerCase()))];}
function analysisAddresses(){return [...new Set([...manualAddresses(),...state.smartDatasetAddresses])];}
function queryAddressList(value){return (Array.isArray(value)?value:String(value||'').trim().split(/[\s,;]+/).filter(Boolean)).map(a=>String(a).toLowerCase());}
function smartMetadataHtml(record){return record?`<span class="smart-tags"><span class="smart-status ${esc(record.status)}">${esc(record.statusLabel||record.status)}</span>${record.tags.map(t=>`<span>${esc(t)}</span>`).join('')}</span>`:'';}
function analysisIdentityHtml(address,clickable=false){
 const record=smartWallets.lookup?.(address),title=record?.name||short(address);
 const profileUrl=data.debankProfileUrl(address),addressHtml=profileUrl?`<a class="smart-address smart-address-link" href="${esc(profileUrl)}" target="_blank" rel="noopener noreferrer">${esc(address)}</a>`:`<span class="smart-address">${esc(address)}</span>`;
 return `<div class="analysis-wallet-card">${clickable?`<button class="address-button" data-wallet="${esc(address)}">${esc(title)}</button>`:`<strong>${esc(title)}</strong>`}${addressHtml}${smartMetadataHtml(record)}</div>`;
}
function renderWalletInputContext(){
 const all=analysisAddresses(),smart=[...state.smartDatasetAddresses].filter(a=>all.includes(a)),manual=manualAddresses().filter(a=>!state.smartDatasetAddresses.has(a)),count=all.length,chains=state.chainIds.length,tasks=count*chains;
 $('wallet-input-identities').hidden=true;$('wallet-input-identities').innerHTML='';
 $('wallet-dataset-summary').hidden=false;$('wallet-load-smart').hidden=standaloneDemo||smart.length>0;$('wallet-edit-smart').hidden=!smart.length;$('wallet-clear-dataset').hidden=!count;
 const walletLabel=count===1?'peněženka':count>=2&&count<5?'peněženky':'peněženek',manualLabel=n=>`${number(n)} ${n===1?'ruční adresa':n<5?'ruční adresy':'ručních adres'}`;
 const smartLabel=n=>`${number(n)} Smart ${n===1?'wallet':'wallets'}`,sourceLabel=smart.length&&manual.length?`${smartLabel(smart.length)} + ${manualLabel(manual.length)}`:smart.length?smartLabel(smart.length):manual.length?manualLabel(manual.length):'';
 $('wallet-dataset-count').textContent=`${number(count)} ${walletLabel}${sourceLabel?` · ${sourceLabel}`:''}`;
 $('wallet-dataset-work').textContent=`${number(chains)} ${chains===1?'síť':'sítí'} · až ${number(tasks)} wallet/network úloh`;
 const tagCounts=new Map();for(const address of smart){const record=smartWallets.lookup?.(address);for(const tag of record?.tags||[])tagCounts.set(tag,(tagCounts.get(tag)||0)+1);}
 $('wallet-dataset-tags').innerHTML=[...tagCounts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,3).map(([tag,n])=>`<span>${esc(tag)} <b>${number(n)}</b></span>`).join('');$('wallet-dataset-tags').hidden=!tagCounts.size;
 $('wallet-scan-estimate').textContent=count?`Coverage se počítá podle úspěšných úloh v každé síti.${count>walletMax?` Limit jednoho skenu je ${walletMax} unikátních peněženek.`:''}`:`Vyberte Smart wallets nebo přidejte ruční adresy. Limit jednoho skenu je ${walletMax} unikátních peněženek.`;
 $('wallet-manual-toggle').textContent=$('wallet-manual-entry').hidden?'+ Ručně zadat adresy':'Ručně zadané adresy';
}
async function refreshSmartMetadata(){
 if(standaloneDemo||!smartWallets.refreshMetadata)return;
 const ok=await smartWallets.refreshMetadata();
 $('wallet-metadata-note').textContent=ok?'':'Metadata Smart wallets se nepodařilo obnovit. Ručně zadané adresy lze dál analyzovat.';
}
function prepareWalletAnalysis(addresses,chainIds,{append=false,skippedChainIds=[],replaceSmartSelection=false}={}){
 const incoming=[...new Set((addresses||[]).map(a=>String(a).toLowerCase()))],existing=append?(replaceSmartSelection?manualAddresses():analysisAddresses()):[],nextSmart=replaceSmartSelection?new Set(incoming):append?new Set([...state.smartDatasetAddresses,...incoming]):new Set(incoming),unique=[...new Set([...existing,...incoming])];
 if(replaceSmartSelection&&!unique.length){state.smartDatasetAddresses.clear();$('wallet-addresses').value='';markDirty();renderWalletInputContext();$('wallet-smart-note').textContent='Výběr Smart wallets byl vyčištěn.';return true;}
 if(!unique.length||unique.length>walletMax)throw Error(`Pro jeden sken lze připravit 1 až ${walletMax} unikátních adres.`);
 if(unique.some(a=>!/^0x[\da-f]{40}$/.test(a)))throw Error('Ve formuláři je neplatná EVM adresa. Opravte ji před přidáním Smart wallets.');
 const requested=[...new Set([...chainIds,...(append&&existing.length?state.chainIds:[])])],supported=requested.filter(supportsWalletChain);
 if(!supported.length)throw Error('Pro vybrané adresy není dostupná žádná zvolená síť. Zkontrolujte datový zdroj.');
 const skipped=[...new Set([...skippedChainIds,...requested.filter(id=>!supportsWalletChain(id))])];
 setSource('live');setView('wallets');state.smartDatasetAddresses=nextSmart;state.chainIds=supported;renderChains();$('wallet-addresses').value=unique.filter(a=>!state.smartDatasetAddresses.has(a)).join('\n');state.backendJob=null;$('active-server-scan').innerHTML='';markDirty();renderWalletInputContext();
 $('wallet-smart-note').textContent=`Připraveno ${unique.length} adres. Zkontrolujte adresy a sítě a analýzu spusťte ručně. Vybrané sítě se použijí pro všechny adresy.${skipped.length?' Nepodporované sítě nebyly vybrány: '+skipped.map(id=>network(id).name||id).join(', ')+'.':''}`;
 toast('Adresy předvyplněny. Analýzu spustíte ručně.');return true;
}
function demoAddresses(){return (data.DEMO_WALLETS||[]).slice(0,6).map(w=>w.address);}
function unsupportedDemoTokens(){return state.selectedTokens.filter(t=>!(data.DEMO_WALLETS||[]).some(w=>(w.holdings||[]).some(h=>h.tokenId===tokenKey(t)&&h.amount>0)));}
function normalizeWallet(w){
 const holdings=(w.holdings||[]).map(h=>{const meta=tokens.find(t=>tokenKey(t)===h.tokenId)||tokens.find(t=>t.address?.toLowerCase()===h.address?.toLowerCase()&&t.chainId===h.chainId)||{};return {...meta,...h,value:h.value??h.usdValue??h.totalValue??null};});
 const matched=(w.matchedTokens||[]).map(t=>typeof t==='string'?(tokens.find(x=>tokenKey(x)===t)||holdings.find(x=>tokenKey(x)===t)):t).filter(Boolean);
 const knownHoldings=holdings.filter(h=>h.value!==null&&h.value!==undefined);
 const value=Object.hasOwn(w,'value')?w.value:Object.hasOwn(w,'totalValue')?w.totalValue:knownHoldings.length?knownHoldings.reduce((a,h)=>a+h.value,0):null;
 return {...w,smartWallet:state.source==='live'?smartWallets.lookup?.(w.address)||null:null,holdings,chainIds:w.chainIds||[...new Set(holdings.map(h=>h.chainId))],matchedTokens:matched,value,matchCount:w.matchCount??matched.length};
}
async function run(existingJobId=null){
 if(typeof existingJobId!=='string')existingJobId=null;
 if(['watchlist','smart','socials'].includes(state.view))return;
 setError();
 if(!state.chainIds.length){setError('Vyberte alespoň jednu síť.');return;}
 let minPositionUsd=0;
 let holderCap=20000;
 let addresses=[],skippedSystemAddresses=[];
 if(state.view==='screener'){
  if(!state.selectedTokens.length){setError('Přidejte alespoň jeden token nebo kontrakt.');return;}
  const thresholdChoice=$('scan-min-position').value;minPositionUsd=thresholdChoice==='custom'?Number($('scan-min-position-custom').value):Number(thresholdChoice)||0;
  holderCap=Number($('scan-max-holders').value)||0;
  if(thresholdChoice==='custom'&&(!Number.isFinite(minPositionUsd)||minPositionUsd<=0)){setError('Vlastní minimální hodnota pozice musí být větší než $0.');return;}
  if(minPositionUsd>0&&state.source!=='live'){setError('Minimální USD hodnota vyžaduje Live API a ověřenou cenu tokenu.');return;}
  if(state.source==='demo'&&unsupportedDemoTokens().length){state.runId++;state.controller?.abort();setBusy(false);state.result=null;state.dirty=true;renderResults();setError('Pro tento kontrakt nejsou demo data. Použijte Live API pro skutečné držitele.');return;}
  const missing=state.selectedTokens.filter(t=>!state.chainIds.includes(t.chainId));
  if(missing.length){setError(`Zapněte síť pro všechny vybrané tokeny: ${[...new Set(missing.map(t=>network(t.chainId).name))].join(', ')}.`);return;}
 }else{
  addresses=analysisAddresses();
  if(!addresses.length){setError('Vložte alespoň jednu adresu peněženky.');return;}
  if(addresses.length>walletMax){setError(`Najednou lze analyzovat nejvýše ${walletMax} různých adres.`);return;}
  const invalid=addresses.find(a=>!/^0x[0-9a-f]{40}$/.test(a));
  if(invalid){setError(`Neplatná EVM adresa: ${invalid.slice(0,70)}. Očekává se 0x a 40 hexadecimálních znaků.`);return;}
  skippedSystemAddresses=addresses.filter(data.isIgnoredWalletAddress);addresses=addresses.filter(address=>!data.isIgnoredWalletAddress(address));
  if(skippedSystemAddresses.length)toast(`Systémová burn/dead adresa (zero address nebo dead address) přeskočena: ${skippedSystemAddresses.length}.`);
  if(!addresses.length){setError('Systémovou burn/dead adresu nelze analyzovat; nebyla vytvořena žádná úloha.');return;}
  refreshSmartMetadata();
 }
 stopLiveResultPolling();state.controller?.abort();state.controller=new AbortController();const runId=++state.runId;setBusy(true);state.result=null;$('scan-live-status').hidden=true;$('scan-live-status').innerHTML='';state.page=1;state.selected.clear();state.dirty=false;
 $('wallet-result-context').hidden=true;
 if(state.source==='live'&&!existingJobId){state.backendJob=null;$('active-server-scan').innerHTML='';}
 $('empty-state').hidden=false;$('empty-state').innerHTML=`<div class="loading-row"><span class="spinner"></span> ${state.view==='screener'?'Načítám držitele vybraných kontraktů…':'Načítám pozice peněženek…'}<p id="scan-progress">${state.source==='demo'?'Ukázkový dataset':'Veřejné indexery mohou odpovídat pomaleji.'}</p><button class="subtle-button" id="cancel-scan">Zrušit sken</button></div>`;$('table-body').innerHTML='';renderStats();if(state.source==='live')$('cancel-scan').textContent='Pozastavit';$('cancel-scan').onclick=()=>{if(state.source==='live'&&state.backendJob){pauseBackendScan(state.backendJob.id);return;}state.runId++;state.controller.abort();setBusy(false);state.dirty=true;renderResults();toast('Sken byl zrušen.');};
 try{
  const options={chainIds:[...state.chainIds],source:state.source,provider:state.provider,signal:state.controller.signal,refresh:!!state.forceRefresh,onProgress:p=>{if(runId===state.runId){if($('scan-progress'))$('scan-progress').textContent=typeof p==='string'?p:p.message||`${p.completed||0} / ${p.total||'…'}`;if(p?.job)renderBackendScan(p.job);}}};
  state.forceRefresh=false;
  const walletMetadata=state.view==='wallets'?addresses.map(address=>smartWallets.lookup?.(address)).filter(Boolean).map(w=>({address:w.address,name:w.name||'',tags:w.tags||[],status:w.status||null})):[];
  const scanResult=existingJobId?await data.openServerScan(existingJobId,options):state.view==='screener'?await data.searchHolders({...options,tokens:state.selectedTokens,match:state.match,minValue:0,minPositionUsd,holderCap}):await data.analyzeWallets({...options,addresses,walletMetadata});
  if(scanResult.duplicateActive){
   state.dirty=true;state.result=null;state.backendJob=scanResult;toast('Stejný scan už existuje.');
   if(confirm('Stejný scan už existuje. Otevřít existující scan?'))await openLiveBackendScan(scanResult.id,scanResult);
   return;
  }
  const result=skippedSystemAddresses.length?{...scanResult,warnings:[`Systémová burn/dead adresa (zero address nebo dead address) byla přeskočena; nebyly pro ni vytvořeny žádné úlohy.`,...(scanResult.warnings||[])]}:scanResult;
  if(runId!==state.runId)return;
  if(state.view==='screener'&&state.source==='live'){state.selectedTokens=state.selectedTokens.map(t=>(result.tokens||[]).find(r=>tokenKey(r)===tokenKey(t))||t);renderTokens();}
  state.result={...result,wallets:(result.wallets||[]).map(normalizeWallet),tokens:(result.tokens||[]).map(t=>({...t,totalValue:t.totalValue??t.value??null,holderCount:t.holderCount??t.holders?.length??0,share:t.share??0}))};
  state.result.fetchedAt=new Date().toISOString();
  if(result.warnings?.length)toast(`Sken dokončen s upozorněním. Podrobnosti najdete v metodice.`);
 }catch(e){
  if(runId!==state.runId)return;
  setError(e.name==='AbortError'?'Sken byl zrušen.':e.message||'Data se nepodařilo načíst. Zkuste jinou síť nebo zdroj dat.');
  state.result=null;state.dirty=true;
 }finally{if(runId===state.runId){setBusy(false);renderResults();}refreshServerScans();}
}
const scanStatuses={running:'Probíhá',paused:'Pozastaveno',partial:'Částečný výsledek',complete:'Všechny stránky načteny',complete_with_warnings:'Dokončeno s upozorněním'};
function formatScanRuntime(runtimeMs){if(!Number.isFinite(Number(runtimeMs))||runtimeMs===null||runtimeMs===undefined)return null;const totalSeconds=Math.floor(Math.max(0,Number(runtimeMs))/1000);if(totalSeconds<60)return `${totalSeconds} s`;const seconds=totalSeconds%60,minutes=Math.floor(totalSeconds/60);if(minutes<60)return `${minutes} min ${String(seconds).padStart(2,'0')} s`;return `${Math.floor(minutes/60)} h ${String(minutes%60).padStart(2,'0')} min`;}
function scanRuntimeLabel(job){const duration=formatScanRuntime(job.runtimeMs);if(job.status==='running')return duration?`Běží ${duration}`:'Běží neznámou dobu';if(job.status==='paused')return duration?`Běželo ${duration}`:'Běželo neznámou dobu';return duration?`Trvání ${duration}`:'Trvání neznámé';}
const deletingScans=new Set(),deletedScans=new Set();let scanListRevision=0,bulkDeletingScans=false;
let liveResultTimer=null,liveResultRequest=0;
function stopLiveResultPolling(){clearTimeout(liveResultTimer);liveResultTimer=null;liveResultRequest++;}
function renderLiveScanStatus(job){
 const box=$('scan-live-status');if(!box)return;
 const isOpen=state.result?.job?.id===job?.id;
 if(!isOpen||!job){box.hidden=true;box.innerHTML='';return;}
 box.hidden=false;
 const holderScan=job.query?.kind==='holders',progress=`${number(job.progress?.completedTasks||0)} / ${number(job.progress?.totalTasks||job.taskCount||0)} ${holderScan?'tokenových úloh':'tasks'} dokončeno`,loaded=holderScan?` · ${number(job.positions||0)} potvrzených pozic z načtených stránek`:'';
 if(job.status==='running')box.innerHTML=`<strong>Sken stále probíhá · zobrazené výsledky jsou průběžné</strong><span>${progress}${loaded} · ${number(job.pagination?.total||0)} agregovaných ${holderScan?'wallets':'tokenů'}</span><small>${holderScan?'Zobrazují se pouze skutečně načtené pozice; další wallets mohou přibýt.':'Coverage se počítá z úspěšně dokončených úloh. Pořadí a popularita tokenů se během běhu mohou změnit.'}</small>`;
 else if(job.status==='paused')box.innerHTML=`<strong>Sken je pozastavený</strong><span>${progress}${loaded} · ${number(job.pagination?.total||0)} agregovaných ${holderScan?'wallets':'tokenů'}</span>${holderScan?'<small>Výsledek zahrnuje jen načtenou část holder listů; po pokračování mohou přibýt další wallets.</small>':''}`;
 else if(job.status==='partial')box.innerHTML=`<strong>Sken skončil s neúplnými daty</strong><span>${progress}${loaded} · ${number(job.pagination?.total||0)} agregovaných ${holderScan?'wallets':'tokenů'}</span>${holderScan?'<small>Jde o potvrzené pozice z načtené části; další wallets mohly zůstat za kurzorem.</small>':''}`;
 else if(job.status==='complete_with_warnings')box.innerHTML=`<strong>Stránkování dokončeno s upozorněním</strong><span>${progress} · ${number(job.quality?.invalidRows||0)} neinterpretovaných řádků</span><small>${holderScan?'Platné načtené holder pozice zůstávají ve výsledku dostupné.':'Wallet/network tasky s neinterpretovanými řádky se nepoužívají pro popularitu ani jako důkaz absence tokenu.'}</small>`;
 else {box.hidden=true;box.innerHTML='';}
}
function scheduleLiveResultPoll(id){
 stopLiveResultPolling();const request=liveResultRequest;
 const poll=async()=>{
  if(request!==liveResultRequest||state.result?.job?.id!==id)return;
  try{
   const job=await data.getServerScan(id);if(request!==liveResultRequest||state.result?.job?.id!==id)return;
   renderBackendScan(job);await refreshLiveScanResult(job,request);
   if(request===liveResultRequest&&job.status==='running')liveResultTimer=setTimeout(poll,3000);else liveResultTimer=null;
  }catch(error){if(request===liveResultRequest){setError(error.message||'Průběžný výsledek se nepodařilo obnovit.');liveResultTimer=setTimeout(poll,5000);}}
 };
 liveResultTimer=setTimeout(poll,3000);
}
async function refreshLiveScanResult(job,request=liveResultRequest){
 if(state.result?.job?.id!==job.id||request!==liveResultRequest)return;
 let result;
 if(job.query.kind==='wallets'&&data.getServerTokenPage){
  const page=state.page||1,pageRequest=++state.tokenPageRequest;state.tokenPageController?.abort();state.tokenPageController=new AbortController();
  result=await data.getServerTokenPage(job.id,{offset:(page-1)*state.pageSize,limit:state.pageSize,revision:job.status==='running'?undefined:job.revision,sort:$('sort-select').value,minHolders:$('min-holders').value,minShare:$('min-share').value,chainId:$('result-network').value,search:$('result-search').value,hideSpam:$('hide-spam').checked},state.tokenPageController.signal);
  if(pageRequest!==state.tokenPageRequest)return;
  result={...result,serverPaginated:true};
 }else result=await data.readServerScanResult(job);
 if(request!==liveResultRequest||state.result?.job?.id!==job.id)return;
 state.result={...state.result,...result,job};
 renderLiveScanStatus(state.result.job);renderResults();
}
function scanProviderDiagnostics(job){
 if(job.status!=='running'||job.query?.kind!=='holders')return '';
 const providerName=value=>value==='blockscout_legacy'?'Blockscout Legacy PRO':value==='blockscout'?'Blockscout REST v2':value==='alchemy'?'Alchemy':value||'Provider neznámý';
 const tasks=(job.tasks||[]).filter(task=>task.status==='running'&&task.provider);
 if(!tasks.length)return '';
 return `<p class="scan-provider-source">${tasks.map(task=>{
  const token=task.token?.symbol||short(task.address),chain=network(task.chainId).name,attempts=task.providerAttempts||[],current=attempts.findLast?.(attempt=>attempt.status==='in_progress'),provider=providerName(current?.provider||task.provider),pageCount=Number(task.pages)||0,pages=number(pageCount),holders=task.token?.holdersAccepted;
  return `${esc(chain)} · ${esc(token)} · ${esc(provider)} · ${pages} provider ${pageCount===1?'strana':'stran'}${holders===undefined?'':` · ${number(holders)} holders`}`;
 }).join(' | ')}</p>`;
}
function scanRow(job,active=false,isLatest=false,previousRuns=[]){
 const title=job.query.kind==='holders'?(job.tasks.map(t=>t.token?.symbol||short(t.address)).join(' + ')):`Analýza ${job.query.addresses.length} adres`;
 const progress=job.query.kind==='wallets'?` · ${number(job.progress?.completedTasks||0)} / ${number(job.progress?.totalTasks||job.taskCount||0)} tasks`:'';
 const date=job.finishedAt||job.pausedAt||job.updatedAt||job.createdAt;
 const tokenScan=job.query?.kind==='holders',deleteButton=`<button class="subtle-button scan-delete" data-delete-scan="${job.id}" data-scan-title="${esc(title)}" aria-label="Smazat sken ${esc(title)}" title="${job.status==='running'?'Nejprve sken pozastavte':'Trvale smazat sken a jeho načtená data'}" ${job.status==='running'||deletingScans.has(job.id)?'disabled':''}>${deletingScans.has(job.id)?'Mažu…':'Smazat'}</button>`;
 const more=tokenScan&&['complete','partial'].includes(job.status)?`${deleteButton}<details class="scan-row-more"><summary aria-label="Další akce" title="Další akce">⋯</summary><div class="scan-row-more-menu"><button type="button" data-repeat-scan="${job.id}">Zopakovat</button><button type="button" data-edit-scan="${job.id}">Upravit dotaz</button></div></details>`:deleteButton;
 const prior=previousRuns.length?`<details class="scan-previous-runs"><summary>Předchozí běhy (${number(previousRuns.length)})</summary>${previousRuns.map(run=>scanRow(run,false,false)).join('')}</details>`:'';
 const completionDetails=tokenScan?(job.tasks||[]).filter(task=>task.completionReason&&task.token).map(task=>{const cap=job.query?.holderCap||task.token?.holderCap||0,threshold=job.query?.minPositionUsd||task.token?.minPositionUsd||0,reason=task.completionReason==='all_holders'?'Kompletní dataset':task.completionReason==='holder_cap'?`Limit ${number(cap)} holderů / token`:task.completionReason==='usd_threshold'?`Pozice pod $${number(threshold)} již nebyly načítány`:'';return reason?`${task.token.symbol||short(task.address)} · ${reason}`:'';}).filter(Boolean):[];
 return `<div class="server-scan-group"><div class="server-scan-row ${active?'current':''}"><div><strong>${esc(title)}</strong>${isLatest?'<span class="scan-latest-badge">Poslední</span>':''}<span class="scan-status ${esc(job.status)}">${scanStatuses[job.status]||esc(job.status)}</span><p>${number(job.pages)} stran · ${number(job.positions)} pozic${progress} · ${esc(scanRuntimeLabel(job))} · ${date?esc(new Date(date).toLocaleString('cs-CZ')):'datum neznámé'}</p>${active?`<p>${esc(job.message)}</p>`:''}${scanProviderDiagnostics(job)}${completionDetails.length?`<p class="scan-completion-details">${completionDetails.map(esc).join(' · ')}</p>`:''}</div><div class="scan-row-actions">${job.status==='running'?`<button class="subtle-button" data-view-scan="${job.id}">Zobrazit průběžné výsledky</button><button class="subtle-button" data-pause-scan="${job.id}">Pozastavit</button>`:`<button class="subtle-button" data-open-scan="${job.id}">Otevřít výsledek</button>${job.tasks.some(t=>['pending','error'].includes(t.status))?`<button class="subtle-button" data-resume-scan="${job.id}">Pokračovat →</button>`:''}`}${more}</div></div>${prior}</div>`;
}
function renderGroupedScans(scans,latestId=null){
 const consumed=new Set(),html=[];
 for(const job of scans){if(consumed.has(job.id))continue;const fingerprint=job.query?.kind==='holders'?job.queryFingerprint:null;const runs=fingerprint?scans.filter(candidate=>candidate.query?.kind==='holders'&&candidate.queryFingerprint===fingerprint):[job];
  for(const run of runs)consumed.add(run.id);
  html.push(scanRow(job,false,job.id===latestId,runs.slice(1)));
 }
 return html.join('');
}
function renderServerScanPanels(){
 const scanTime=job=>job.status==='running'?job.updatedAt:job.finishedAt||job.pausedAt||job.updatedAt||job.createdAt;
 const all=[...new Map([...state.serverScans.filter(j=>!deletedScans.has(j.id)),...(state.backendJob&&!deletedScans.has(state.backendJob.id)?[state.backendJob]:[])].map(j=>[j.id,j])).values()].sort((a,b)=>String(scanTime(b)||'').localeCompare(String(scanTime(a)||'')));
 const active=all.filter(j=>j.status==='running'||j.status==='paused').sort((a,b)=>(a.status==='running'?0:1)-(b.status==='running'?0:1)||String(scanTime(b)||'').localeCompare(String(scanTime(a)||'')));
 const finished=all.filter(j=>j.status!=='running'&&j.status!=='paused'),latest=finished[0]||null,latestFingerprint=latest?.query?.kind==='holders'?latest.queryFingerprint:null,latestRuns=latestFingerprint?finished.filter(j=>j.query?.kind==='holders'&&j.queryFingerprint===latestFingerprint):[],history=finished.filter(j=>j!==latest&&!latestRuns.slice(1).some(run=>run.id===j.id));
 $('active-server-scan').innerHTML=(active.length>1?`<p class="server-scan-section-label">Běžící a pozastavené skeny (${number(active.length)})</p>`:'')+active.map(j=>scanRow(j,j.id===state.backendJob?.id)).join('');
 $('latest-server-scan').innerHTML=latest?scanRow(latest,latest.id===state.backendJob?.id,true,latestRuns.slice(1)):'';
 $('server-scan-history').innerHTML=renderGroupedScans(history);
 $('server-scan-total-count').textContent=number(all.length);$('server-scan-history-count').textContent=number(history.length);$('server-scan-history-disclosure').hidden=!history.length;$('server-scan-history-disclosure').open=!!history.length&&state.scanHistoryOpen;$('fresh-scan').disabled=state.busy;
 const running=all.some(job=>job.status==='running'),bulkDelete=$('delete-all-scans');bulkDelete.disabled=running||!all.length||bulkDeletingScans;bulkDelete.title=running?'Nejdřív pozastavte běžící skeny.':all.length?'Odstranit všechny uložené serverové skeny a jejich data':'Nejsou uložené žádné skeny';
}
function renderBackendScan(job){if(deletedScans.has(job.id))return;state.backendJob=job;state.serverScans=[...state.serverScans.filter(item=>item.id!==job.id),job];$('server-scans').hidden=state.source!=='live';renderServerScanPanels();}
async function refreshServerScans(){
 const revision=++scanListRevision;
 $('server-scans').hidden=state.source!=='live';if(state.source!=='live'||!data.listServerScans)return;
 try{const {scans}=await data.listServerScans();if(state.source!=='live'||revision!==scanListRevision)return;state.serverScans=scans.filter(j=>!deletedScans.has(j.id));if(state.backendJob){const current=state.serverScans.find(j=>j.id===state.backendJob.id);if(current)state.backendJob=current;}renderServerScanPanels();}
 catch(error){if(revision===scanListRevision)$('server-scan-history').textContent=error.message;}
}
function confirmScanDeletion(id,title){
 const dialog=$('delete-scan-dialog');if(dialog.open)return Promise.resolve(false);
 $('delete-scan-name').textContent=title||id;dialog.returnValue='cancel';
 return new Promise(resolve=>{dialog.addEventListener('close',()=>resolve(dialog.returnValue==='delete'),{once:true});dialog.showModal();$('delete-scan-cancel').focus();});
}
function confirmDeleteAllScans(count){
 const dialog=$('delete-all-scans-dialog');if(dialog.open)return Promise.resolve(false);
 $('delete-all-scans-count').textContent=`Bude odstraněno ${number(count)} uložených skenů včetně jejich výsledků.`;$('delete-all-scans-confirm').textContent=`Smazat všech ${number(count)}`;dialog.returnValue='cancel';
 return new Promise(resolve=>{dialog.addEventListener('close',()=>resolve(dialog.returnValue==='delete'),{once:true});dialog.showModal();$('delete-all-scans-cancel').focus();});
}
async function deleteAllBackendScans(){
 if(bulkDeletingScans)return;
 const all=[...new Map([...state.serverScans,...(state.backendJob?[state.backendJob]:[])].filter(job=>job&&!deletedScans.has(job.id)).map(job=>[job.id,job])).values()];
 if(all.some(job=>job.status==='running')){toast('Nejdřív pozastavte běžící skeny.');return;}
 if(!all.length||!await confirmDeleteAllScans(all.length))return;
 bulkDeletingScans=true;$('delete-all-scans').disabled=true;
 try{
  const result=await data.deleteAllServerScans(),ids=new Set(Array.isArray(result.ids)?result.ids:all.map(job=>job.id));
  for(const id of ids)deletedScans.add(id);scanListRevision++;
  if((state.backendJob&&ids.has(state.backendJob.id))||(state.result?.job?.id&&ids.has(state.result.job.id))){
   stopLiveResultPolling();state.runId++;state.controller?.abort();state.controller=null;state.backendJob=null;state.result=null;state.rows=[];state.selected.clear();state.page=1;state.dirty=false;state.forceRefresh=false;
   closeDrawer();setBusy(false);setError();$('result-search').value='';$('min-value').value='';$('active-server-scan').innerHTML='';renderResults();
  }
  state.serverScans=state.serverScans.filter(job=>!ids.has(job.id));state.scanHistoryOpen=false;try{globalThis.localStorage?.setItem('cd:scan-history-open','false');}catch{}
  toast(`${number(result.deleted)} serverových skenů smazáno`);
 }catch(error){toast(error.message||'Serverové skeny se nepodařilo smazat.');}
 finally{bulkDeletingScans=false;await refreshServerScans();}
}
async function deleteBackendScan(id,button){
 if(deletingScans.has(id)||deletedScans.has(id))return;
 if(!await confirmScanDeletion(id,button?.dataset.scanTitle))return;
 deletingScans.add(id);if(button)button.disabled=true;
 try{
  if(state.result?.job?.id===id)stopLiveResultPolling();
  await data.deleteServerScan(id);deletedScans.add(id);scanListRevision++;
  if(state.backendJob?.id===id||state.result?.job?.id===id){
   state.runId++;state.controller?.abort();state.controller=null;state.backendJob=null;state.result=null;state.rows=[];state.selected.clear();state.page=1;state.dirty=false;state.forceRefresh=false;
   closeDrawer();setBusy(false);setError();$('result-search').value='';$('min-value').value='';$('active-server-scan').innerHTML='';renderResults();
  }
  toast('Sken a jeho načtená data byly smazány.');
 }catch(error){setError(error.message);}
 finally{deletingScans.delete(id);if(button)button.disabled=false;await refreshServerScans();}
}
async function openBackendScan(id,resume=false){
 if(deletingScans.has(id)||deletedScans.has(id))return;
 try{
  if(state.busy&&state.backendJob?.id===id&&!resume)return;
  stopLiveResultPolling();
  state.runId++;state.controller?.abort();setBusy(false);
  const job=await data.getServerScan(id);if(!resume&&job.status==='running')return await openLiveBackendScan(id,job);const q=job.query;
  if(deletingScans.has(id)||deletedScans.has(id))return;
  setSource('live');setView(q.kind==='holders'?'screener':'wallets');state.provider=q.provider||'auto';renderProviderStatus();state.chainIds=[...q.chainIds];state.match=q.match;
  if(q.tokens)state.selectedTokens=q.tokens.map(t=>job.tasks.find(task=>task.token?.id===`${t.chainId}:${t.address}`)?.token||tokens.find(item=>tokenKey(item)===`${t.chainId}:${t.address}`)||{...t,id:`${t.chainId}:${t.address}`,symbol:'ERC-20'});
 if(q.addresses){state.smartDatasetAddresses=new Set((q.walletMetadata||[]).map(w=>w.address.toLowerCase()));$('wallet-addresses').value=queryAddressList(q.addresses).filter(a=>!state.smartDatasetAddresses.has(a)).join('\n');}
  $('result-search').value='';$('min-value').value='';renderTokens();renderChains();renderBackendScan(job);
  if(resume)await data.resumeServerScan(id);
  await run(id);
 }catch(error){setError(error.message);}
}
function tokenScanTitle(job){return (job.query?.tokens||[]).map(t=>job.tasks?.find(task=>task.token?.id===`${t.chainId}:${t.address}`)?.token?.symbol||short(t.address)).join(job.query?.match==='any'?' OR ':' AND ')||'Token Screener scan';}
async function editBackendScan(id){
 try{
  const job=await data.getServerScan(id);if(job.query?.kind!=='holders'){toast('Upravit lze pouze Token Screener scan.');return;}
  setSource('live');setView('screener');
  const q=job.query;state.provider=q.provider||'auto';state.chainIds=[...(q.chainIds||[])];state.match=q.match==='any'?'any':'all';
  state.selectedTokens=(q.tokens||[]).map(token=>job.tasks?.find(task=>task.token?.id===`${token.chainId}:${token.address}`)?.token||{...token,id:`${token.chainId}:${token.address}`,symbol:'ERC-20'});
  const minUsd=Number(q.minPositionUsd||0),threshold=$('scan-min-position'),custom=$('scan-min-position-custom');
  if([0,100,500,1000].includes(minUsd)){threshold.value=String(minUsd);custom.value='';custom.hidden=true;}else{threshold.value='custom';custom.value=String(minUsd);custom.hidden=false;}
  $('scan-max-holders').value=String(q.holderCap??20000);updateHolderCapWarning();
  state.backendJob=null;state.result=null;state.rows=[];state.dirty=true;state.page=1;state.selected.clear();
  renderTokens();renderChains();renderProviderStatus();renderResults();setError();toast('Konfigurace scanu načtena. Zkontrolujte ji a spusťte ručně.');
 }catch(error){setError(error.message||'Konfiguraci scanu se nepodařilo načíst.');}
}
async function repeatBackendScan(id){
 try{
  const original=await data.getServerScan(id);if(original.query?.kind!=='holders'){toast('Zopakovat lze pouze Token Screener scan.');return;}
  const title=tokenScanTitle(original);if(!confirm(`Zopakovat scan ${title} se stejnými parametry?`))return;
  const repeated=await data.repeatServerScan(id);
  if(repeated.duplicateActive){toast('Stejný scan už existuje.');if(confirm('Stejný scan už existuje. Otevřít existující scan?'))await openLiveBackendScan(repeated.id,repeated);return;}
  toast('Spustil se nový běh se stejnou konfigurací.');await openLiveBackendScan(repeated.id,repeated);
 }catch(error){setError(error.message||'Scan se nepodařilo zopakovat.');}
}
async function openLiveBackendScan(id,knownJob=null){
 if(deletingScans.has(id)||deletedScans.has(id))return;
 stopLiveResultPolling();state.runId++;state.controller?.abort();state.controller=null;state.tokenPageRequest++;state.tokenPageController?.abort();setBusy(false);
 try{
  const job=knownJob||await data.getServerScan(id);if(deletingScans.has(id)||deletedScans.has(id))return;
  const q=job.query;setSource('live');setView(q.kind==='holders'?'screener':'wallets');state.provider=q.provider||'auto';renderProviderStatus();state.chainIds=[...q.chainIds];state.match=q.match;
  if(q.tokens)state.selectedTokens=q.tokens.map(t=>job.tasks.find(task=>task.token?.id===`${t.chainId}:${t.address}`)?.token||tokens.find(item=>tokenKey(item)===`${t.chainId}:${t.address}`)||{...t,id:`${t.chainId}:${t.address}`,symbol:'ERC-20'});
  if(q.addresses){state.smartDatasetAddresses=new Set((q.walletMetadata||[]).map(w=>w.address.toLowerCase()));$('wallet-addresses').value=queryAddressList(q.addresses).filter(a=>!state.smartDatasetAddresses.has(a)).join('\n');}
  $('result-search').value='';$('min-value').value='';renderTokens();renderChains();renderBackendScan(job);setError();
  const result=await data.readServerScanResult(job);if(deletingScans.has(id)||deletedScans.has(id))return;
  state.result={...result,wallets:(result.wallets||[]).map(normalizeWallet),tokens:(result.tokens||[]).map(t=>({...t,totalValue:t.totalValue??t.value??null,holderCount:t.holderCount??t.holders?.length??0,share:t.share??0}))};state.result.fetchedAt=new Date().toISOString();state.dirty=false;state.page=1;
  const latestJob=state.result.job||job;renderBackendScan(latestJob);renderResults();if(latestJob.status==='running')scheduleLiveResultPoll(id);
 }catch(error){if(error.name!=='AbortError')setError(error.message||'Průběžný výsledek se nepodařilo otevřít.');}
}
async function pauseBackendScan(id){
 try{
  const isOpen=state.result?.job?.id===id;if(isOpen)stopLiveResultPolling();if(state.backendJob?.id===id&&state.busy){state.runId++;state.controller?.abort();state.controller=null;setBusy(false);}
  const job=await data.pauseServerScan(id);renderBackendScan(job);
  if(state.result?.job?.id===id){state.result.job=job;await refreshLiveScanResult(job,liveResultRequest);renderLiveScanStatus(state.result.job);}
  await refreshServerScans();
 }catch(error){setError(error.message);}
}
function currentRows(){
 if(state.view==='watchlist')return savedWallets.filter(w=>w.source===state.source&&!data.isIgnoredWalletAddress(w.wallet?.address)).map(w=>normalizeWallet({...w.wallet,savedAt:w.savedAt}));
 if(!state.result)return [];
 return state.view==='wallets'?state.result.tokens:(state.result.wallets||[]).filter(w=>!data.isIgnoredWalletAddress(w.address));
}
function filteredRows(){
 if(state.view==='wallets'&&state.result?.serverPaginated)return state.result.tokens||[];
 const q=$('result-search').value.toLowerCase().trim();const min=Math.max(0,Number($('min-value').value)||0);const mode=state.view==='wallets';const sort=$('sort-select').value;
 const rows=currentRows().filter(r=>{
  if(mode&&$('hide-spam')?.checked&&r.likelySpam)return false;
  const searchable=mode?`${r.symbol} ${r.name} ${r.address} ${network(r.chainId).name}`:`${r.address} ${r.label||''}`;
  const value=mode?r.totalValue:r.value;
  return searchable.toLowerCase().includes(q)&&(!min||(value!==null&&value>=min));
 });
 return rows.sort((a,b)=>sort==='holders'?b.holderCount-a.holderCount:sort==='match'?(b.matchCount||0)-(a.matchCount||0):sort==='address'?a.address.localeCompare(b.address):sort==='symbol'?a.symbol.localeCompare(b.symbol):(mode?(b.totalValue??-1)-(a.totalValue??-1):(b.value??-1)-(a.value??-1)));
}
function walletTokenSummary(rows){
 if(state.result?.serverPaginated&&state.result.summary)return state.result.summary;
 const known=rows.filter(token=>Number.isFinite(token.totalValue)),topToken=[...rows].sort((a,b)=>b.holderCount-a.holderCount||b.share-a.share||(b.totalValue??-1)-(a.totalValue??-1))[0]||null;
 return {filteredTotal:rows.length,uniqueContracts:rows.length,knownUsdValue:known.length?known.reduce((sum,token)=>sum+token.totalValue,0):null,pricedTokens:known.length,unpricedPositions:rows.reduce((sum,token)=>sum+(Number(token.unpricedPositions)||0),0),networks:[...new Set(rows.map(token=>token.chainId).filter(Boolean))],topToken};
}
async function loadServerTokenPage(page=state.page){
 if(!state.result?.serverPaginated||!data.getServerTokenPage)return;
 state.page=page;const request=++state.tokenPageRequest;state.tokenPageController?.abort();state.tokenPageController=new AbortController();
 try{
  const response=await data.getServerTokenPage(state.result.job.id,{offset:(page-1)*state.pageSize,limit:state.pageSize,revision:state.result.job.status==='running'?undefined:state.result.pagination?.revision,sort:$('sort-select').value,minHolders:$('min-holders').value,minShare:$('min-share').value,chainId:$('result-network').value,search:$('result-search').value,hideSpam:$('hide-spam').checked},state.tokenPageController.signal);
  if(request!==state.tokenPageRequest)return;state.result={...state.result,...response,serverPaginated:true};state.page=page;renderResults();
 }catch(error){if(error.name!=='AbortError'&&request===state.tokenPageRequest)setError(error.message||'Stránku výsledků se nepodařilo načíst.');}
}
function renderStats(){
 const rows=state.view==='wallets'?filteredRows():currentRows();const walletMode=state.view==='wallets';const walletRows=walletMode?(state.result?.wallets||[]).filter(w=>!data.isIgnoredWalletAddress(w.address)):rows;
 const summary=walletMode?walletTokenSummary(rows):null;const sum=walletMode?summary.knownUsdValue:rows.reduce((a,r)=>a+(r.value||0),0);const chains=walletMode?(summary.networks||[]):[...new Set(rows.flatMap(r=>r.chainIds))].filter(Boolean);
 const knownRows=rows.filter(r=>Number.isFinite(walletMode?r.totalValue:r.value));
 const stats=walletMode?[
  ['Agregované tokeny',number(summary.filteredTotal??state.result?.pagination?.filteredTotal??state.result?.pagination?.total??rows.length),'kontrakt + síť po filtrech','layers'],
  ['USD hodnota výsledků',summary.filteredTotal?money(sum,true):'—','součet známých cen celého filtrovaného výsledku','dollar'],
  ['Stránkování dokončeno',number(state.result?.coverage?.analyzedWalletCount??walletRows.length),`z ${number(state.result?.coverage?.requestedWalletCount??0)} zadaných · spolehlivých ve všech sítích ${number(state.result?.coverage?.reliableWalletCount??0)}`,'users'],
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
 const rows=state.view==='wallets'?filteredRows():currentRows();const total=rows.length;const walletMode=state.view==='wallets';const sum=rows.reduce((a,r)=>a+((walletMode?r.totalValue:r.value)||0),0);
 if(state.view==='watchlist'){
  const chains=[...new Set(rows.flatMap(w=>w.chainIds))];
  $('insight-panel').innerHTML=`<div class="insight-label">${icon('bookmark')} Váš výzkumný okruh</div><p>Adresy, ke kterým se chcete vrátit.</p><div class="venn-diagram"><div class="venn-circle"></div><div class="venn-circle second"></div><div class="venn-value"><strong>${total}</strong><small>uložených snapshotů</small></div></div><div class="insight-divider"></div><div class="insight-pair"><span>Zdroj</span><strong>${state.source==='demo'?'Demo':'Live API'}</strong></div><div class="insight-pair"><span>Zastoupené sítě</span><strong>${chains.length}</strong></div><div class="insight-note">${icon('history')} Pozice odpovídají okamžiku uložení. Novou analýzou získáte aktuální data.</div><button class="insight-link" id="insight-help">Jak číst snapshoty <span>↗</span></button>`;
  $('insight-help').onclick=dataInfo;return;
 }
 if(walletMode){
  const summary=walletTokenSummary(rows),top=summary.topToken;
  $('insight-panel').innerHTML=`<div class="insight-label">${icon('link')} Společné přesvědčení</div><p>Nejrozšířenější pozice ve vaší skupině peněženek.</p><div class="venn-diagram"><div class="venn-circle"></div><div class="venn-circle second"></div><div class="venn-value"><strong>${top?esc(top.symbol):'—'}</strong><small>${top?`${number(top.holderCount)} držitelů`:'spusťte analýzu'}</small></div></div><div class="insight-divider"></div><div class="insight-pair"><span>Unikátní kontrakty</span><strong>${number(summary.uniqueContracts??summary.filteredTotal??total)}</strong></div><div class="insight-pair"><span>Známá USD hodnota</span><strong>${money(summary.knownUsdValue,true)}</strong></div><div class="insight-note">${icon('help')} Stejný ticker na dvou sítích zůstává dvěma samostatnými kontrakty.</div><button class="insight-link" id="insight-help">Jak číst výsledky <span>↗</span></button>`;
 }else{
  const ts=state.selectedTokens;const counts=ts.map(t=>rows.filter(w=>w.holdings.some(h=>h.chainId===t.chainId&&h.address?.toLowerCase()===t.address.toLowerCase()&&h.amount>0)).length);
  const both=rows.filter(w=>ts.length&&ts.every(t=>w.holdings.some(h=>h.chainId===t.chainId&&h.address?.toLowerCase()===t.address.toLowerCase()&&h.amount>0))).length;
  const top=rows.length?Math.max(...rows.map(w=>w.value||0))/Math.max(1,sum)*100:0;
  $('insight-panel').innerHTML=`<div class="insight-label">${icon('link')} ${state.view==='watchlist'?'Váš výzkumný okruh':'Překryv držitelů'}</div><p>${state.view==='watchlist'?'Uložené adresy pro váš další průzkum.':'Tam, kde se vaše vybrané tokeny potkávají.'}</p><div class="venn-diagram"><div class="venn-circle">${esc(ts[0]?.symbol||'A')}</div><div class="venn-circle second">${esc(ts[1]?.symbol||(ts.length?'':'B'))}</div><div class="venn-value"><strong>${state.result||state.view==='watchlist'?number(both):'—'}</strong><small>${ts.length>2?'drží všechny tokeny':'společných adres'}</small></div></div><div class="insight-divider"></div>${ts.slice(0,2).map((t,i)=>`<div class="insight-pair"><span>${esc(t.symbol)} držitelé ve výsledku</span><strong>${number(counts[i])}</strong></div>`).join('')}<div class="mini-distribution" title="Poměr USD hodnot největších načtených pozic">${rows.filter(w=>w.value>0).sort((a,b)=>b.value-a.value).slice(0,8).map((w,i)=>`<span style="flex:${w.value};background:${['#b8db8b','#6d9366','#354e40'][i%3]}"></span>`).join('')}</div><div class="insight-pair"><span>Největší pozice / celek</span><strong>${top.toFixed(1)} %</strong></div><div class="insight-note">${icon('spark')} ${state.source==='demo'?'Ukázka souvislostí. Zobrazená data jsou syntetická.':state.result?.coverage?.complete?'Všechny stránky indexeru načteny. Data pocházejí z časového intervalu skenu.':'Průnik je zatím částečný. Úplnost vyžaduje dokončení všech stránek.'}</div><button class="insight-link" id="insight-help">Jak číst výsledky <span>↗</span></button>`;
 }
 $('insight-help').onclick=dataInfo;
}
function identicon(address){const colors=['#b7ba70','#8ca8ce','#b48cc2','#6fb6a6','#cc9b75','#85ad75'];const n=parseInt(address?.slice(2,6)||'0',16);return `<span class="identicon" style="--ident:${colors[n%colors.length]}">${icon(['grid','target','scan','layers','spark','link'][n%6])}</span>`;}
function saved(address){return savedWallets.some(w=>w.source===state.source&&!data.isIgnoredWalletAddress(w.wallet?.address)&&w.wallet?.address.toLowerCase()===address.toLowerCase());}
function renderProviderProvenance(){
 const box=$('provider-provenance');if(!box)return;
 const entries=state.result?.coverage?.provenance||state.result?.job?.tasks||[];
 if(state.view!=='wallets'||state.source!=='live'||!entries.length){box.hidden=true;box.innerHTML='';return;}
 const grouped=new Map();for(const item of entries){const key=[item.chainId,item.provider,item.fallbackFrom,item.status].join(':');if(!grouped.has(key))grouped.set(key,item);}
 box.hidden=false;box.innerHTML=`<strong>Zdroje dat podle sítě</strong><div class="provider-provenance-list">${[...grouped.values()].map(item=>{const providerName=value=>value==='alchemy'?'Alchemy':value==='blockscout_legacy'?'Blockscout Legacy PRO':value==='blockscout'?'Blockscout REST v2':value||'Provider neznámý';const attempts=item.providerAttempts||[];const path=attempts.length?attempts.map(attempt=>`${providerName(attempt.provider)}${attempt.status==='retryable_failure'?' · chyba':attempt.status==='failure'?' · selhal':attempt.status==='success'?' · data':attempt.status==='in_progress'?' · běží':''}`).join(' → '):providerName(item.provider||item.fallbackFrom);const delivered=item.providerProvidedData?` <small>Data poskytl ${esc(providerName(item.provider))}</small>`:'';const time=item.lastSuccessAt||item.asOf?` · ${esc(new Date(item.lastSuccessAt||item.asOf).toLocaleString('cs-CZ'))}`:'';const incomplete=item.providerProvenanceComplete===false?` <small title="Historický scan neuchoval všechny pokusy providerů.">· historie pokusů není dostupná</small>`:'';const reason=item.fallbackReason?`<small>${esc(item.fallbackReason)}</small>`:item.error?`<small>${esc(item.error)}</small>`:'';return `<div class="provider-provenance-item"><span>${esc(network(item.chainId).name)} · ${esc(path)}${delivered}${time}${incomplete}</span>${reason}</div>`;}).join('')}</div>`;
}
function renderResults(){
 if(state.busy||['smart','socials'].includes(state.view))return;
 renderLiveScanStatus(state.result?.job);
 if(state.view==='wallets')renderWalletInputContext();
 const warnings=state.view==='watchlist'?[]:(state.result?.warnings||[]);
 $('scan-notice').hidden=!warnings.length;
  if(warnings.length){const failures=(state.result?.coverage?.details||[]).filter(d=>d.status==='error'||d.status==='unsupported');const failureText=failures.map(d=>`${network(d.chainId)?.name||d.chainId}: ${d.error||'síť není dostupná pro zvoleného poskytovatele.'}`).join(' · '),query=state.result?.job?.query||{},threshold=query.minPositionUsd,priceUnknown=warnings.some(w=>w.includes('Cena neznámá')),tasks=state.result?.job?.tasks||[],stopped=tasks.filter(t=>t.completionReason==='usd_threshold'),capped=tasks.filter(t=>t.completionReason==='holder_cap'),capDisabled=warnings.some(w=>w.includes('Limit holderů nebylo možné bezpečně použít')),accepted=stopped.reduce((sum,t)=>sum+(Number(t.token?.thresholdDiagnostics?.holdersAccepted)||0),0);
   const summaryParts=[];if(capped.length)summaryParts.push(`Top ${number(query.holderCap)} holders · limit dosažen u ${capped.length} tokenů (${number(capped.reduce((sum,t)=>sum+(Number(t.token?.holdersAccepted)||0),0))} relevantních holders). Korelace může vynechat menší držitele mimo tento rozsah.`);if(capDisabled)summaryParts.push('Řazení holderů nebylo ověřeno; limit se nepoužil a načetl se kompletní holder list.');if(priceUnknown)summaryParts.push('U některých tokenů byla cena neznámá, proto se jejich USD limit nepoužil.');if(stopped.length)summaryParts.push(`${stopped.length} tokenových skenů skončilo při hranici $${number(threshold)}; ${number(accepted)} relevantních holders.`);if(!summaryParts.length)summaryParts.push(threshold?'USD limit ovlivňuje korelaci; sken načetl všechny stránky.':'Výsledek pokrývá pouze úspěšně načtená data.');
   const noticeTitle=capped.length?'Limit holderů dosažen':priceUnknown?'Cena neznámá':threshold?'USD limit dokončen':'Omezení výsledku';$('scan-notice').innerHTML=`${icon('help')}<span><strong>${noticeTitle}.</strong> ${failureText?`Selhalo: ${esc(failureText)}. `:''}${esc(summaryParts.join(' '))}</span><button class="text-button" id="notice-details">${warnings.length} upozornění ↗</button>`;$('notice-details').onclick=dataInfo;}
 const walletMode=state.view==='wallets';const watch=state.view==='watchlist';const rows=filteredRows();state.rows=rows;
 renderProviderProvenance();
  const cohort=walletMode&&state.source==='live'?(state.result?.wallets||[]).filter(w=>!data.isIgnoredWalletAddress(w.address)):[];
 $('wallet-result-context').hidden=!cohort.length;
 $('wallet-result-context').innerHTML=cohort.length?`<summary>Analyzované peněženky · ${cohort.length}</summary><div class="analysis-wallet-grid">${cohort.map(w=>analysisIdentityHtml(w.address,true)).join('')}</div>`:'';
 const serverPaged=walletMode&&state.result?.serverPaginated;const filteredTotal=serverPaged?(state.result.pagination?.filteredTotal??state.result.pagination?.total??0):rows.length;const total=filteredTotal;const pages=Math.max(1,Math.ceil(total/state.pageSize));state.page=Math.min(state.page,pages);const start=(state.page-1)*state.pageSize;const visible=serverPaged?rows:rows.slice(start,start+state.pageSize);
 $('results-title').innerHTML=`${walletMode?'Nejvíce držené tokeny':watch?'Uložené peněženky':'Nalezené peněženky'} <span class="count-badge" id="result-count">${state.result||watch?number(total):'—'}</span>`;
 const scanThreshold=state.result?.job?.query?.minPositionUsd,holderCap=state.result?.job?.query?.holderCap||0,scanTasks=state.result?.job?.tasks||[],thresholdStopped=scanTasks.some(t=>t.completionReason==='usd_threshold'),capStopped=scanTasks.some(t=>t.completionReason==='holder_cap'),thresholdDetails=scanThreshold||holderCap?scanTasks.filter(t=>t.token).map(t=>{const token=t.token,price=scanThreshold?(token.priceUsd?`${token.symbol}: $${Number(token.priceUsd).toPrecision(5)} (${token.priceSource||'cena'}) · min ${token.minTokenAmount||'—'} ${token.symbol}`:`${token.symbol}: cena neznámá`):token.symbol,diagnostics=token.thresholdDiagnostics;const outcome=t.completionReason==='holder_cap'?`Limit ${number(holderCap)} holderů / token`:t.completionReason==='usd_threshold'?`Pozice pod $${number(scanThreshold)} již nebyly načítány`:t.completionReason==='all_holders'?'Kompletní dataset':token.holderCapDisabledReason?'limit nelze bezpečně použít':'';return `${price}${outcome?` · ${outcome}`:''}${diagnostics?.earlyStopDisabledReason?' · USD early-stop vypnut':''}`;}).join(' · '):'';const coverage=state.result?.coverage||{};$('results-subtitle').textContent=watch?'Uložené snapshoty · zdroj: '+(state.source==='demo'?'Demo':'Live API'):walletMode?`Coverage ${coverage.analyzedWalletCount??0} / ${coverage.requestedWalletCount??analysisAddresses().length} dokončených wallets napříč sítěmi · popularita používá pouze spolehlivé wallet/network úkoly`: `${state.match==='all'?'Drží všechny vybrané tokeny':'Drží alespoň jeden vybraný token'} · ${state.source==='demo'?'demo dataset':thresholdStopped?'dokončeno při USD limitu':capStopped?'výsledek omezen holder limitem':state.result?.coverage?.complete?'všechny stránky indexeru načteny':'průběžný výsledek'}${scanThreshold?` · min. pozice $${number(scanThreshold)}`:''}${holderCap?` · max. ${number(holderCap)} holders / token`:''}${thresholdDetails?` · ${thresholdDetails}`:''}`;
 $('table-head').innerHTML=walletMode?'<tr><th>#</th><th>TOKEN / KONTRAKT</th><th>SÍŤ</th><th>DRŽITELÉ</th><th>PODÍL ADRES</th><th class="th-value">HODNOTA POZIC</th><th></th></tr>':'<tr><th><input type="checkbox" id="select-all" aria-label="Vybrat všechny zobrazené adresy"></th><th>PENĚŽENKA</th><th>SÍTĚ</th><th>VYBRANÉ TOKENY</th><th class="th-value">HODNOTA POZIC</th><th>POMĚR POZIC</th><th></th></tr>';
 $('table-body').innerHTML=visible.map((r,i)=>walletMode?tokenRow(r,start+i):walletRow(r)).join('');
 $('empty-state').hidden=!!total;
 if(!total)$('empty-state').innerHTML=`${icon(watch?'star':'search')}<strong>${!state.result&&!watch?(state.dirty?'Dotaz je připravený.':'Začněte svým průzkumem.'):watch?'Watchlist čeká na první adresu.':'Žádné výsledky pro tento výběr.'}</strong><p>${!state.result&&!watch?'Vyberte tokeny nebo vložte adresy a spusťte analýzu.':watch?'Uložte zajímavé peněženky ikonou záložky v tabulce. Zobrazují se uložené on-chain snapshoty.':state.source==='demo'?'Demo zná pouze ukázkové kontrakty a adresy. Změňte filtry nebo použijte Live API pro vlastní vstupy.':'Zkontrolujte zadané sítě, filtry a metodiku. Výsledek se vztahuje pouze na úspěšně načtená data.'}</p>${watch?'<button class="subtle-button" id="empty-go-screener">Otevřít token screener →</button>':''}`;
 $('empty-go-screener')?.addEventListener('click',()=>setView('screener'));
 if(state.source==='demo'&&state.view==='screener'&&unsupportedDemoTokens().length){$('empty-state').hidden=false;$('empty-state').innerHTML=`${icon('database')}<strong>Pro tento kontrakt nejsou demo data.</strong><p>Demo obsahuje pouze ukázkové pozice. Skutečné držitele vlastního kontraktu načtete přes Live API na vybrané síti.</p><button class="primary-button" id="use-live-api">Načíst skutečné držitele · Live API ↗</button>`;$('use-live-api').onclick=()=>{setSource('live');run();};}
 $('table-range').textContent=total?`${start+1}–${Math.min(start+state.pageSize,total)} z ${number(total)} ${walletMode?'tokenů':'peněženek'}`:'0 výsledků';
 $('page-number').textContent=state.page;$('previous-page').disabled=state.page===1;$('next-page').disabled=state.page>=pages;
 $('export-button').disabled=!total;$('save-search').disabled=!state.result;
 $('bulk-bar').hidden=walletMode||!state.selected.size;$('bulk-count').textContent=`Vybráno ${state.selected.size} adres`;
 $('watch-count').textContent=savedWallets.filter(w=>!data.isIgnoredWalletAddress(w.wallet?.address)).length;
 if($('select-all')){$('select-all').checked=!!visible.length&&visible.every(r=>state.selected.has(r.address));$('select-all').onchange=e=>{visible.forEach(r=>e.target.checked?state.selected.add(r.address):state.selected.delete(r.address));renderResults();};}
 $('coverage-label').textContent=watch?`Uložené snapshoty · ${state.source==='demo'?'syntetická demo data':'živá data v okamžiku uložení'}`:state.source==='demo'?'Ilustrační dataset · adresy, štítky a hodnoty jsou syntetické':state.result?`${state.result.coverage?.providerLabel||'Indexer'} · ${coverageText().slice(0,160)}`:`${state.view==='wallets'&&state.provider!=='blockscout'&&walletCapabilities?.alchemyConfigured?'Alchemy + Blockscout':'Blockscout'} přes lokální server · pokračování po stránkách`;
 renderStats();renderInsight();
}
function walletRow(w){
 const smart=state.source==='live'?smartWallets.lookup?.(w.address):null;
 const quickChains=[...new Set((w.chainIds?.length?w.chainIds:w.matchedTokens?.map(token=>token.chainId)?.length?w.matchedTokens.map(token=>token.chainId):state.selectedTokens.map(token=>token.chainId)).filter(id=>networks.some(n=>n.id===id&&n.live!==false)))],quickState=quickAddStates.get(w.address.toLowerCase()),hasResearch=smart?.tags?.some(tag=>String(tag).trim().toLowerCase()==='research'),quickSaved=quickState==='success'||(hasResearch&&quickChains.length>0&&quickChains.every(id=>smart.chainIds?.includes(id))),quickIgnored=data.isIgnoredWalletAddress(w.address),quickTitle=quickIgnored?data.IGNORED_WALLET_ADDRESS_ERROR:quickState==='error'?'Přidání selhalo · opakovat':quickState==='loading'?'Přidávám do Smart wallets…':quickSaved?'Ve Smart wallets':'Rychle přidat do Smart wallets';
 const matched=w.matchedTokens.length?w.matchedTokens:w.holdings.filter(h=>state.selectedTokens.some(t=>t.chainId===h.chainId&&t.address.toLowerCase()===h.address?.toLowerCase()));
 const values=matched.map(t=>w.holdings.find(h=>h.chainId===t.chainId&&h.address?.toLowerCase()===t.address?.toLowerCase())?.value).filter(v=>Number.isFinite(v)&&v>0);const sum=values.reduce((a,n)=>a+n,0);
 const profileUrl=data.debankProfileUrl(w.address),addressHtml=profileUrl?`<a class="smart-address smart-address-link result-wallet-address" data-debank-link href="${esc(profileUrl)}" target="_blank" rel="noopener noreferrer" title="Otevřít v DeBank" aria-label="Otevřít peněženku ${esc(short(w.address))} v DeBank">${esc(short(w.address))}</a>`:`<span class="smart-address result-wallet-address">${esc(short(w.address))}</span>`;
 return `<tr><td><input type="checkbox" data-select-wallet="${esc(w.address)}" aria-label="Vybrat ${esc(smart?.name||short(w.address))}" ${state.selected.has(w.address)?'checked':''}></td><td><div class="wallet-identity">${identicon(w.address)}<div>${smart?.name?`<button class="address-button" data-wallet="${esc(w.address)}">${esc(smart.name)}</button>`:''}${addressHtml}${smart?smartMetadataHtml(smart):''}<div class="wallet-name"><i></i>${state.source==='demo'?esc(w.label||'Ukázková adresa'):w.savedAt?'Snapshot '+esc(new Date(w.savedAt).toLocaleDateString('cs-CZ')):'Veřejná adresa'}</div></div></div></td><td><div class="row-networks">${w.chainIds.slice(0,5).map(chainIcon).join('')}${w.chainIds.length>5?`<span class="pending-dot">+${w.chainIds.length-5}</span>`:''}</div></td><td><div class="match-tokens">${matched.slice(0,4).map(t=>coin(t,'micro')).join('')}<span class="match-total">${matched.length}/${state.view==='watchlist'?matched.length:(state.selectedTokens.length||matched.length)}</span></div></td><td class="value-cell">${money(w.value)}<small>${state.source==='demo'?'ilustrační USD':'známé USD ceny'}</small></td><td><div class="allocation" title="Poměr známých hodnot vybraných pozic">${values.slice(0,5).map(v=>`<span style="flex:${v/sum}"></span>`).join('')||'<span style="background:#354740;flex:1"></span>'}</div></td><td><div class="row-actions">${state.source==='live'&&state.view==='screener'?`<button type="button" class="quick-add-button ${quickSaved?'saved':quickState==='loading'?'pending':quickState||''}" data-smart-quick-add="${esc(w.address)}" data-quick-networks="${esc(quickChains.join(','))}" aria-label="${quickTitle} ${esc(short(w.address))}" title="${quickTitle}" ${quickState==='loading'||quickSaved||quickIgnored?'disabled':''}>${quickState==='loading'?'…':quickSaved?'✓':'+'}</button>`:''}<button class="bookmark-button ${saved(w.address)?'saved':''}" data-bookmark="${esc(w.address)}" aria-label="${saved(w.address)?'Odebrat z watchlistu':'Uložit do watchlistu'} ${esc(short(w.address))}">${icon('bookmark')}</button><button class="open-detail" data-wallet="${esc(w.address)}" aria-label="Detail ${esc(short(w.address))}">↗</button></div></td></tr>`;
}
function quickAddWallet(address,chainIds){
 const normalized=String(address||'').toLowerCase();if(data.isIgnoredWalletAddress(normalized)){toast(data.IGNORED_WALLET_ADDRESS_ERROR);return false;}if(quickAddStates.get(normalized)==='loading'||quickAddStates.get(normalized)==='success')return false;
 if(!Array.isArray(chainIds)||!chainIds.length){toast('U této wallet není dostupná síť pro Smart wallets.');return false;}
 quickAddStates.set(normalized,'loading');renderResults();
 Promise.resolve().then(()=>smartWallets.quickAdd(normalized,chainIds)).then(result=>{quickAddStates.set(normalized,'success');renderResults();toast(result.created?'Přidáno do Smart wallets.':result.updated?'Doplněno do Smart wallets.':'Wallet už je ve Smart wallets.');}).catch(error=>{quickAddStates.set(normalized,'error');renderResults();toast(error?.message||'Wallet se nepodařilo přidat do Smart wallets.');setTimeout(()=>{if(quickAddStates.get(normalized)==='error'){quickAddStates.delete(normalized);renderResults();}},2500);});
 return true;
}
function tokenRow(t,i){
 let share=t.share||0;if(share<=1)share*=100;share=Math.min(100,share);
 const reasons=(t.spamReasons||[]).map(spamReasonLabel).join(' · ');
 return `<tr><td class="pending-dot">${(state.page-1)*state.pageSize+i+1}</td><td><div class="wallet-identity">${coin(t,'small')}<div>${tokenNameHtml(t)}${t.likelySpam?`<small class="spam-token-badge" title="${esc(reasons)}">Podezřelý spam</small>`:''}${tokenContractHtml(t)}</div></div></td><td><div class="row-networks">${chainIcon(t.chainId)}<span class="pending-dot">${esc(network(t.chainId).name)}</span></div></td><td class="value-cell" style="text-align:left">${number(t.holderCount)} / ${number(t.analyzedWalletCount??0)}<small>spolehlivých wallets · Coverage ${number(t.completedWalletCount||0)}/${number(t.requestedWalletCount||0)} · ${number(t.warningWalletCount||0)} s upozorněním</small></td><td><div class="holder-share"><span class="share-track"><i style="width:${share}%"></i></span>${share.toFixed(1)} %</div></td><td class="value-cell">${money(t.totalValue)}<small>${number(t.unpricedPositions||0)} pozic bez USD ceny · ${amount(t.amount)} ${esc(t.symbol)}</small></td><td><a class="open-detail" href="${esc(explorerUrl(t.chainId,'token',t.address))}" target="_blank" rel="noopener noreferrer" aria-label="Otevřít kontrakt ${esc(t.symbol)} v exploreru">↗</a></td></tr>`;
}
function spamReasonLabel(reason){if(reason==='url-in-name')return 'URL v názvu';if(reason==='url-in-symbol')return 'URL v symbolu';if(reason==='name-too-long')return 'Příliš dlouhý název';if(reason.startsWith('keyword:'))return `Podezřelé slovo: ${reason.slice(8)}`;return reason;}
function explorerUrl(chainId,type,address){const base=network(chainId).explorer||network(chainId).explorerUrl||'';return /^https:\/\//.test(base)&&/^0x[\da-fA-F]{40}$/.test(address)?`${base.replace(/\/$/,'')}/${type}/${address}`:'#';}
function toggleBookmark(address){
 const idx=savedWallets.findIndex(w=>w.source===state.source&&w.wallet?.address===address);
 if(idx>=0){savedWallets.splice(idx,1);toast('Adresa odebrána z watchlistu.');}
 else{if(data.isIgnoredWalletAddress(address)){toast(data.IGNORED_WALLET_ADDRESS_ERROR);return;}const wallet=currentRows().find(w=>w.address===address);if(!wallet)return;savedWallets.push({source:state.source,wallet,savedAt:new Date().toISOString()});toast('Adresa uložena do watchlistu.');}
 writeLocal('cd:watchlist:v1',savedWallets);renderResults();
 if(state.activeWallet?.address===address)openWallet(address,state.activeWallet);
}
function openWallet(address,existing){
 if(data.isIgnoredWalletAddress(address))return;
 const w=currentRows().find(w=>w.address===address)||state.result?.wallets?.find(w=>w.address===address)||existing;
 if(!w)return;state.activeWallet=w;
 const smartRecord=state.source==='live'?smartWallets.lookup?.(w.address):null;
 const profileUrl=data.debankProfileUrl(w.address),drawerAddress=profileUrl?`<a class="full-address smart-address-link" href="${esc(profileUrl)}" target="_blank" rel="noopener noreferrer">${esc(w.address)}</a>`:`<div class="full-address">${esc(w.address)}</div>`;
 const holderScan=state.result?.job?.query?.kind==='holders',partialHolderScan=holderScan&&['running','paused','partial'].includes(state.result?.job?.status),drawerScope=partialHolderScan?'Zobrazeny jsou pouze potvrzené pozice z již načtených holder stránek; další wallets mohou přibýt. Nejde o kompletní portfolio.':holderScan?'Zobrazeny jsou pozice nalezené tímto Token Screener scanem; nejde o kompletní portfolio wallet.':'Pouze pozice vrácené indexerem. Záznam nemusí obsahovat celé portfolio wallet.';
 $('wallet-drawer').innerHTML=`<div class="drawer-header"><span>WALLET INTELLIGENCE / ${state.source.toUpperCase()}</span><button class="icon-button" id="close-drawer" aria-label="Zavřít detail">×</button></div><div class="drawer-identity">${identicon(w.address)}<h2>${state.source==='demo'?esc(w.label||'Ukázková peněženka'):esc(smartRecord?.name||'Detail peněženky')}</h2>${drawerAddress}${state.source==='live'?smartMetadataHtml(smartRecord):''}</div><div class="drawer-tools">${state.source==='live'&&!smartRecord?`<button class="subtle-button" data-smart-add="${esc(w.address)}">+ Smart wallets</button>`:''}<button class="subtle-button" id="copy-address">${icon('copy')} Kopírovat</button><button class="subtle-button" data-bookmark="${esc(w.address)}">${icon('bookmark')} ${saved(w.address)?'Uloženo':'Watchlist'}</button>${w.chainIds[0]?`<a class="subtle-button" href="${esc(explorerUrl(w.chainIds[0],'address',w.address))}" target="_blank" rel="noopener noreferrer">Explorer ${icon('external')}</a>`:''}${smartRecord?`<button class="subtle-button drawer-delete-button" data-smart-delete-drawer="${esc(w.address)}" title="Smazat ze Smart wallets">Smazat</button>`:''}</div><div class="drawer-stat"><span>Hodnota vybraných pozic ve screeneru</span><strong>${money(w.value)}</strong><p class="drawer-footnote">${state.source==='demo'?'Ilustrační USD hodnoty · syntetická adresa':drawerScope}</p></div><h2>Načtené tokenové pozice <span class="count-badge">${w.holdings.length}</span></h2>${w.holdings.map(h=>`<div class="drawer-holding">${coin(h)}<span>${tokenNameHtml(h)}<small>${esc(network(h.chainId).name)}</small>${tokenContractHtml(h)}</span><span>${money(h.value)}<small>${amount(h.amount)} ${esc(h.symbol)}</small></span></div>`).join('')}<p class="drawer-footnote">Nativní ETH, NFT ani DeFi pozice nejsou zahrnuté. ${w.savedAt?'Snapshot: '+esc(new Date(w.savedAt).toLocaleString('cs-CZ')):''}</p><button class="primary-button" id="analyze-this-wallet" style="width:100%;margin-top:20px">Analyzovat tuto adresu →</button>`;
 $('wallet-drawer').hidden=false;$('drawer-backdrop').hidden=false;$('close-drawer').onclick=closeDrawer;
 $('copy-address').onclick=async()=>{try{await navigator.clipboard.writeText(w.address);toast('Adresa zkopírována.');}catch{toast('Kopírování není dostupné. Adresu lze označit v detailu.');}};
 $('analyze-this-wallet').onclick=()=>{closeDrawer();setView('wallets');state.smartDatasetAddresses.clear();$('wallet-manual-entry').hidden=false;$('wallet-addresses').value=w.address;renderWalletInputContext();run();};
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
 const q={id:Date.now(),source:state.source,provider:state.provider,view:state.view,tokens:state.selectedTokens.map(t=>({...t})),chainIds:[...state.chainIds],match:state.match,addresses:analysisAddresses(),walletMetadata:[...state.smartDatasetAddresses].map(address=>smartWallets.lookup?.(address)).filter(Boolean),date:new Date().toISOString()};
 savedQueries.unshift(q);savedQueries.splice(15);writeLocal('cd:queries:v1',savedQueries);toast('Dotaz uložen. Najdete ho v Uložených dotazech.');
}
function showSavedSearches(){
 const visible=savedQueries.filter(q=>standaloneDemo||q.source==='live');
 info('Uložené dotazy',visible.length?visible.map(q=>`<div class="saved-query"><button class="text-button" data-load-query="${q.id}"><span>${q.view==='wallets'?'Analýza peněženek':esc((q.tokens||[]).map(t=>t.symbol).join(' + '))}<small>${esc(q.source==='demo'?'DEMO':q.provider||'Automaticky')} · ${esc(q.match?.toUpperCase()||'')} · ${esc(new Date(q.date).toLocaleDateString('cs-CZ'))}</small></span> →</button><button data-delete-query="${q.id}" aria-label="Smazat uložený dotaz">×</button></div>`).join(''):'<p>Zatím tu nic není. Po spuštění analýzy použijte <strong>Uložit dotaz</strong> nad tabulkou výsledků.</p>');
}
async function exportCSV(){
 if(!state.rows.length)return;
 const walletMode=state.view==='wallets';
 let exportRows=state.rows;
 if(walletMode&&state.result?.serverPaginated){
  const button=$('export-button');button.disabled=true;
  try{
   const all=[];const total=state.result.pagination?.filteredTotal??state.result.pagination?.total??0;const pageSize=200;
   for(let offset=0;offset<total;offset+=pageSize){
    const response=await data.getServerTokenPage(state.result.job.id,{offset,limit:pageSize,revision:state.result.pagination?.revision,sort:$('sort-select').value,minHolders:$('min-holders').value,minShare:$('min-share').value,chainId:$('result-network').value,search:$('result-search').value,hideSpam:$('hide-spam').checked});
    all.push(...response.tokens);
   }
   exportRows=all;
  }catch(error){toast(error.message||'Všechny výsledky se nepodařilo načíst pro export.');button.disabled=false;return;}
  button.disabled=false;
 }
 const providerForChain=chainId=>{const entries=(state.result?.coverage?.provenance||[]).filter(item=>item.chainId===chainId&&item.providerProvidedData);const label=value=>value==='alchemy'?'Alchemy':value==='blockscout_legacy'?'Blockscout Legacy PRO':value==='blockscout'?'Blockscout REST v2':null;const names=[...new Set(entries.map(item=>label(item.provider)).filter(Boolean))];return {names:names.join(' + '),paths:[...new Set(entries.map(item=>(item.providerAttempts||[]).map(attempt=>`${label(attempt.provider)||'Provider neznámý'} (${attempt.status})`).join(' → ')).filter(Boolean))].join(' ; ')};};
 const rows=walletMode?[['symbol','token_name','contract','network','holder_count','reliable_wallet_count','share','amount','known_usd_value','unpriced_positions','provider','provider_provenance','data_quality','scan_status','source','coverage'],...exportRows.map(t=>{const provenance=providerForChain(t.chainId),warning=Number(t.warningWalletCount||0)>0,unknown=Number(t.unknownWalletCount||0)>0||Number(t.completedWalletCount??t.requestedWalletCount??0)<Number(t.requestedWalletCount||0),dataQuality=warning?(unknown?'mixed':'warning'):unknown?'unknown':Number(t.analyzedWalletCount||0)>0?'reliable':'unknown';return [t.symbol,t.name,t.address,t.chainId,t.holderCount,t.reliableWalletCount??t.analyzedWalletCount,t.share,t.amount,t.totalValue,t.unpricedPositions,provenance.names,provenance.paths,dataQuality,state.result?.job?.status,state.source,coverageText()];})]:[['address','label','chains','matched_tokens','known_usd_value','source','coverage'],...exportRows.map(w=>[w.address,state.source==='demo'?w.label||'':'',w.chainIds.join(';'),w.matchedTokens.map(t=>`${t.symbol}:${t.chainId}`).join(';'),w.value,state.source,coverageText()])];
 const cell=v=>`"${String(v??'').replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')}"`;
 const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`chaindetective-${state.view}-${state.source}-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('CSV export připraven.');
}

const smartWallets=initSmartWallets({networks,legacyNetworks:data.LEGACY_NETWORKS,toast,supportsWalletChain,getAnalysisAddresses:analysisAddresses,getLiveWatchlist:()=>savedWallets.filter(w=>w.source==='live'&&!data.isIgnoredWalletAddress(w.wallet?.address)).map(w=>w.wallet),analyze:prepareWalletAnalysis,onChange:()=>{
 if(state.result?.wallets)state.result.wallets=state.result.wallets.map(w=>({...w,smartWallet:smartWallets.lookup(w.address)}));
 renderWalletInputContext();renderResults();
}});
const socialsModule=initSocials();
const earlyBuyers=initEarlyBuyers({quickAdd:(address,chainIds)=>smartWallets.quickAdd(address,chainIds,{allowAnyNetwork:true,source:'Early Buyers'}),isSaved:address=>!!smartWallets.lookup?.(address),toast});
const dashboardMoniCarousel=$('dashboard-moni-trending');dashboardMoniCarousel?.addEventListener('scroll',()=>renderDashboardMoniCarouselControls(),{passive:true});globalThis.addEventListener?.('resize',()=>renderDashboardMoniCarouselControls());
document.addEventListener('click',async event=>{
 const debankLink=event.target.closest?.('[data-debank-link]');
 if(debankLink){event.stopPropagation();return;}
 const tokenLink=event.target.closest?.('[data-token-link]');
 if(tokenLink){event.stopPropagation();return;}
 const copyContract=event.target.closest?.('[data-copy-contract]');
 if(copyContract){event.preventDefault();event.stopPropagation();await copyTokenContract(copyContract);return;}
},true);
document.addEventListener('click',event=>{
 const b=event.target.closest('button');if(!b)return;
 if(b.dataset.smartQuickAdd){event.preventDefault?.();event.stopPropagation?.();quickAddWallet(b.dataset.smartQuickAdd,(b.dataset.quickNetworks||'').split(',').filter(Boolean));return;}
 if(b.hasAttribute('data-moni-carousel-prev')){scrollDashboardMoniCarousel(-1);return;}
 if(b.hasAttribute('data-moni-carousel-next')){scrollDashboardMoniCarousel(1);return;}
 if(b.hasAttribute('data-moni-load')){loadDashboardMoniManually(b);return;}
 if(b.dataset.moniView){updateDashboardMoniView(b.dataset.moniView);return;}
 if(b.dataset.aixbtLanguage){setAixbtLanguage(b.dataset.aixbtLanguage);return;}
 if(b.dataset.smartAdd&&state.source==='live'){const wallet=state.result?.wallets?.find(w=>w.address===b.dataset.smartAdd)||currentRows().find(w=>w.address===b.dataset.smartAdd)||state.activeWallet;closeDrawer();smartWallets.add(b.dataset.smartAdd,wallet?.chainIds);}
 if(b.dataset.smartDeleteDrawer&&state.source==='live')smartWallets.removeFromDrawer(b.dataset.smartDeleteDrawer,{afterSuccess:()=>closeDrawer()});
 if(b.dataset.viewScan)openLiveBackendScan(b.dataset.viewScan);if(b.dataset.openScan)openBackendScan(b.dataset.openScan);if(b.dataset.resumeScan)openBackendScan(b.dataset.resumeScan,true);if(b.dataset.pauseScan)pauseBackendScan(b.dataset.pauseScan);
 if(b.dataset.deleteScan)deleteBackendScan(b.dataset.deleteScan,b);
 if(b.dataset.repeatScan)repeatBackendScan(b.dataset.repeatScan);if(b.dataset.editScan)editBackendScan(b.dataset.editScan);
 if(b.dataset.view)setView(b.dataset.view);
 if(b.dataset.dashboardView)setView(b.dataset.dashboardView);
 if(b.dataset.aixbtTopic)openDashboardTopic(b.dataset.aixbtTopic);
 if(b.dataset.dashboardWallet){const item=savedWallets.find(entry=>entry.source==='live'&&entry.wallet?.address===b.dataset.dashboardWallet);if(item){setSource('live');setView('watchlist');openWallet(b.dataset.dashboardWallet,normalizeWallet({...item.wallet,savedAt:item.savedAt}));}}
 if(b.dataset.mode)setView(b.dataset.mode);
 if(b.dataset.source)setSource(b.dataset.source);
 if(b.dataset.match){state.match=b.dataset.match;renderTokens();markDirty();}
 if(b.dataset.chain){const id=b.dataset.chain;state.chainIds=state.chainIds.includes(id)?state.chainIds.filter(c=>c!==id):[...state.chainIds,id];renderChains();if(state.view==='wallets')renderWalletInputContext();markDirty();}
 if(b.dataset.removeToken){state.selectedTokens=state.selectedTokens.filter(t=>tokenKey(t)!==b.dataset.removeToken);renderTokens();markDirty();}
 if(b.dataset.addToken){const t=tokens.find(t=>tokenKey(t)===b.dataset.addToken);if(t)addToken(t);}
 if(b.dataset.close)$(b.dataset.close).close();
 if(b.dataset.wallet)openWallet(b.dataset.wallet);
 if(b.dataset.bookmark)toggleBookmark(b.dataset.bookmark);
 if(b.dataset.roadmap)info(b.dataset.roadmap,`<p>Tento modul je připravený v navigaci pro další etapu.</p><h3>${esc(b.dataset.roadmap)}</h3><p>${{'Smart money':'Skupiny sledovaných peněženek, ověřitelné štítky a historická úspěšnost.', 'Toky kapitálu':'Přírůstky a úbytky pozic, čisté toky tokenů a změny v čase.', 'Upozornění':'Pravidla nad uloženými adresami a změnami držených tokenů.'}[b.dataset.roadmap]}</p><p>V této první verzi jsou dostupné token screener, analýza peněženek a lokální watchlist.</p>`);
 if(b.dataset.loadQuery){const q=savedQueries.find(q=>String(q.id)===b.dataset.loadQuery);if(q){state.runId++;state.controller?.abort();setBusy(false);closeDrawer();$('info-dialog').close();state.selectedTokens=(q.tokens||[]).map(t=>({...t}));state.chainIds=[...q.chainIds];state.match=q.match;setSource(q.source);setView(q.view);state.provider=q.provider||'auto';renderProviderStatus();state.smartDatasetAddresses=new Set((q.walletMetadata||[]).map(w=>w.address.toLowerCase()));$('wallet-addresses').value=queryAddressList(q.addresses).filter(a=>!state.smartDatasetAddresses.has(a)).join('\n');renderTokens();renderChains();if(q.source==='demo'&&standaloneDemo)run();else{state.result=null;state.dirty=true;renderWalletInputContext();renderResults();toast('Dotaz načten. Spusťte živý sken.');}}}
 if(b.dataset.deleteQuery){const i=savedQueries.findIndex(q=>String(q.id)===b.dataset.deleteQuery);if(i>=0){savedQueries.splice(i,1);writeLocal('cd:queries:v1',savedQueries);$('info-dialog').close();showSavedSearches();}}
});
document.addEventListener('change',e=>{if(e.target.id==='scan-max-holders')updateHolderCapWarning();if(e.target.dataset.selectWallet){e.target.checked?state.selected.add(e.target.dataset.selectWallet):state.selected.delete(e.target.dataset.selectWallet);renderResults();}});
let resultFilterTimer;
const refreshResultsForFilters=()=>{state.page=1;if(state.view==='wallets'&&state.result?.serverPaginated){clearTimeout(resultFilterTimer);resultFilterTimer=setTimeout(()=>loadServerTokenPage(1),180);}else renderResults();};
 $('scan-min-position').onchange=()=>{$('scan-min-position-custom').hidden=$('scan-min-position').value!=='custom';if(!$('scan-min-position-custom').hidden)$('scan-min-position-custom').focus();};
['result-search','min-value','min-holders','min-share'].forEach(id=>$(id).addEventListener('input',refreshResultsForFilters));$('result-network').onchange=refreshResultsForFilters;$('sort-select').onchange=refreshResultsForFilters;$('hide-spam').onchange=refreshResultsForFilters;
 $('previous-page').onclick=()=>{state.page--;state.result?.serverPaginated?loadServerTokenPage(state.page):renderResults();};$('next-page').onclick=()=>{state.page++;state.result?.serverPaginated?loadServerTokenPage(state.page):renderResults();};
 $('refresh-scans').onclick=refreshServerScans;$('fresh-scan').onclick=()=>{state.forceRefresh=true;run();};$('delete-all-scans').onclick=()=>deleteAllBackendScans();
 $('server-scan-history-disclosure').addEventListener('toggle',()=>{state.scanHistoryOpen=$('server-scan-history-disclosure').open;try{globalThis.localStorage?.setItem('cd:scan-history-open',String(state.scanHistoryOpen));}catch{}});
 $('scan-button').onclick=run;$('analyze-button').onclick=run;
 $('wallet-addresses').addEventListener('input',()=>{state.runId++;state.controller?.abort();setBusy(false);state.result=null;state.dirty=true;$('wallet-smart-note').textContent='';renderWalletInputContext();renderResults();});
 $('wallet-load-smart').hidden=standaloneDemo;
 $('wallet-load-smart').onclick=async()=>{await refreshProviders();smartWallets.pick();};
 $('wallet-edit-smart').onclick=async()=>{await refreshProviders();smartWallets.pick({baseAddresses:manualAddresses(),selectedAddresses:[...state.smartDatasetAddresses],replaceSmartSelection:true});};
 $('wallet-clear-dataset').onclick=()=>{state.smartDatasetAddresses.clear();$('wallet-addresses').value='';$('wallet-manual-entry').hidden=true;state.result=null;state.rows=[];state.dirty=true;state.page=1;renderWalletInputContext();renderResults();};
 $('wallet-manual-toggle').onclick=()=>{$('wallet-manual-entry').hidden=!$('wallet-manual-entry').hidden;renderWalletInputContext();if(!$('wallet-manual-entry').hidden)$('wallet-addresses').focus();};
 $('wallet-manual-hide').onclick=()=>{$('wallet-manual-entry').hidden=true;renderWalletInputContext();};
 $('add-token').onclick=()=>{$('token-search').value='';renderTokenOptions();$('token-dialog').showModal();$('token-search').focus();};$('token-search').oninput=renderTokenOptions;
 $('custom-chain').innerHTML=networks.map(n=>`<option value="${esc(n.id)}">${esc(n.name)}</option>`).join('');
 $('add-custom-token').onclick=addCustomToken;
 $('clear-tokens').onclick=()=>{state.selectedTokens=[];renderTokens();markDirty();};
 $('all-chains').onclick=()=>{const available=networks.filter(n=>supportsCurrentChain(n.id));state.chainIds=state.chainIds.length===available.length?[]:available.map(n=>n.id);renderChains();if(state.view==='wallets')renderWalletInputContext();markDirty();};
 $('provider-select').onchange=e=>changeProvider(e.target.value);
 $('load-wallet-demo').hidden=!standaloneDemo;
 $('load-wallet-demo').onclick=()=>{state.smartDatasetAddresses.clear();$('wallet-manual-entry').hidden=false;$('wallet-addresses').value=demoAddresses().join('\n');renderWalletInputContext();run();};
 $('guide-button').onclick=guide;$('help-button').onclick=guide;$('workspace-info').onclick=guide;
 $('data-info').onclick=dataInfo;$('coverage-button').onclick=dataInfo;$('banner-info').onclick=dataInfo;
 $('saved-searches').onclick=showSavedSearches;$('save-search').onclick=saveSearch;$('export-button').onclick=exportCSV;
 $('menu-button').onclick=()=>$('sidebar').classList.toggle('open');
 $('drawer-backdrop').onclick=closeDrawer;
 $('analyze-selected').onclick=()=>{const addresses=[...state.selected];if(addresses.length>20){toast('Pro analýzu vyberte nejvýše 20 adres.');return;}state.smartDatasetAddresses.clear();setView('wallets');$('wallet-addresses').value=addresses.join('\n');$('wallet-manual-entry').hidden=false;renderWalletInputContext();run();};
 $('clear-selection').onclick=()=>{state.selected.clear();renderResults();};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeDrawer();$('sidebar').classList.remove('open');}if(e.key==='Tab'&&!$('wallet-drawer').hidden){const focusable=[...$('wallet-drawer').querySelectorAll('button,a[href]')];const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
 document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{if(dialog.id==='smart-dialog'||e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}));
renderTokens();renderChains();renderProviderStatus();renderResults();setView('dashboard');
