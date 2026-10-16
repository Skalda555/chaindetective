import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// A small DOM boundary stub exercises request and persistence logic; visual QA
// runs in a browser. Requests deliberately ignore abort to model late providers.
const source = (await readFile(new URL('../dist/app.js', import.meta.url), 'utf8'))
  .replace(/^import \* as data from '\.\/data\.js';\s*/, '')
  .replace("import {initSmartWallets} from './smart-wallets.js';",'')
  .replace("import {initSocials} from './socials.js';",'')
  .replace("import {initEarlyBuyers} from './early-buyers.js';",'')
  .replace(/renderTokens\(\);renderChains\(\);renderProviderStatus\(\);renderResults\(\);setView\('dashboard'\);\s*$/, '');
const indexHtml=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const styleCss=await readFile(new URL('../dist/style.css',import.meta.url),'utf8');
assert.match(indexHtml,/id="scan-min-position"[\s\S]*?<option value="0">Bez minima<\/option>[\s\S]*?<option value="100">\$100<\/option>[\s\S]*?<option value="500">\$500<\/option>[\s\S]*?<option value="1000">\$1 000<\/option>[\s\S]*?<option value="custom">Vlastní<\/option>/,'Token Screener exposes the requested position thresholds with no minimum as the default');
assert.match(indexHtml,/id="scan-min-position-custom" type="number" min="0\.01"/,'custom position thresholds require a positive USD amount');
assert.match(indexHtml,/id="scan-max-holders"[\s\S]*?<option value="10000">10 000<\/option>[\s\S]*?<option value="20000" selected>20 000<\/option>[\s\S]*?<option value="30000">30 000<\/option>[\s\S]*?<option value="40000">40 000<\/option>[\s\S]*?<option value="50000">50 000<\/option>[\s\S]*?<option value="0">Bez limitu · pokročilé<\/option>[\s\S]*?Úplný scan může u tokenů s velkým počtem holderů trvat desítky minut/,'Token Screener defaults to 20,000 holders and marks unlimited scans as advanced with a warning');
assert.match(indexHtml,/data-view="dashboard"[^>]*>.*?Dashboard/,'Dashboard is part of the main navigation');
assert.match(indexHtml,/id="dashboard-section"[\s\S]*?Analyzovat Smart wallets[\s\S]*?Najít držitele tokenů/,'Dashboard opens with the two read-only research entry actions');
assert.match(indexHtml,/id="delete-all-scans"[^>]*>Smazat vše/,'server scan history exposes a bulk delete action');assert.match(indexHtml,/id="delete-all-scans-dialog"[\s\S]*?Smazat všechny serverové skeny\?[\s\S]*?id="delete-all-scans-confirm"/,'bulk scan deletion uses a dedicated confirmation dialog');
assert.match(styleCss,/\.destructive-button\{/,'bulk deletion confirmation has a visually distinct destructive action');
assert.match(styleCss,/\.dashboard-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,'Dashboard has a compact desktop two-column grid');
assert.match(styleCss,/@media\(max-width:980px\)\{\.dashboard-grid\{grid-template-columns:minmax\(0,1fr\)\}/,'Dashboard panels stack responsively');
const walletLayoutOrder=['class="wallet-input-actions"','id="wallet-dataset-summary"','id="analyze-button"','class="chain-row"'].map(id=>indexHtml.indexOf(id));
assert.ok(walletLayoutOrder.every((index,i)=>index>=0&&(!i||index>walletLayoutOrder[i-1])),'Wallet Analyzer input actions, dataset summary and analyze action precede the network row');
assert.match(indexHtml,/class="wallet-action-primary"[^>]*id="wallet-load-smart"/,'Smart-wallet loading is the emphasized entry action');
assert.match(indexHtml,/class="wallet-action-secondary"[^>]*id="wallet-manual-toggle"/,'manual input remains visible as the secondary entry action');
assert.match(styleCss,/#wallet-query\{padding:12px 21px\}/,'Wallet Analyzer uses compact vertical panel padding');
assert.match(styleCss,/\.wallet-main-row\{display:grid;grid-template-columns:max-content minmax\(160px,1fr\) max-content/,'entry actions, dataset summary and Analyze share a content-sized row');
assert.match(styleCss,/@media\(max-width:1080px\)\{\.wallet-main-row\{grid-template-columns:minmax\(0,1fr\) max-content\}/,'the input row rearranges before its controls collide');
const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const ZERO = '0x0000000000000000000000000000000000000000';
const token = { id: `base:${A}`, address: A, chainId: 'base', symbol: 'TEST', name: 'Test token' };

function harness({confirmImpl=()=>true,deleteImpl,deleteAllImpl,listImpl,getScanImpl,repeatImpl,pageTokensImpl,readResultImpl,pauseImpl,timerImpl,clipboardImpl,useRealConfirmation=false,smartRecords=[],storageValues={},dashboardData,dashboardTopics,dashboardTopicImpl,quickAddImpl}={}) {
  const elements = new Map(), events = new Map(), requests = [], storage = new Map(Object.entries(storageValues)),pickerCalls=[],quickAddCalls=[],timers=[],copied=[],externalLinks=[],csvBlobs=[];
  const globalDialogs = ['token-dialog','smart-dialog'].map(id=>{const listeners=new Map();return {id,open:true,closeCount:0,addEventListener(type,listener){listeners.set(type,listener);},getBoundingClientRect(){return {left:100,right:500,top:100,bottom:400};},close(){this.open=false;this.closeCount++;},emit(type,init={}){listeners.get(type)?.({target:this,...init});}};});
  const document = {
    activeElement: null,
    body: {append(){}},
    createElement(tagName) { return {tagName,href:'',target:'',rel:'',hidden:false,title:'',click(){externalLinks.push({href:this.href,target:this.target,rel:this.rel,title:this.title});},remove(){}}; },
    getElementById(id) {
      if (!elements.has(id)) {
        const listeners = new Map();
        elements.set(id, {
          id, value: id === 'sort-select' ? 'value' : id==='scan-max-holders'?'20000' : '', checked:id==='hide-spam', hidden: true, open:false,
          innerHTML: '', textContent: '', disabled: false, dataset: {},
          classList: { toggle() {}, remove() {}, add() {} },
          addEventListener(type, listener) { listeners.set(type, listener); },
          emit(type) { listeners.get(type)?.({ target: this }); },
          setAttribute() {}, querySelectorAll() { return []; },
          focus() { document.activeElement = this; }, close() {this.open=false;listeners.get('close')?.({target:this});}, showModal() {this.open=true;},
        });
      }
      return elements.get(id);
    },
    querySelectorAll(selector) { return selector==='dialog'?globalDialogs:[]; },
    addEventListener(type, listener, options) { const listeners=events.get(type)||[];listeners.push({listener,capture:options===true||!!options?.capture});events.set(type,listeners); },
  };
  const request = options => new Promise(resolve => requests.push({ options, resolve }));const dashboardCalls=[];
  class BlobStub{constructor(parts,options){this.parts=parts;this.type=options?.type;csvBlobs.push(this);}}
  class URLStub extends URL{static createObjectURL(){return `blob:csv-${csvBlobs.length}`;}static revokeObjectURL(){}}
  const context = vm.createContext({
    document, AbortController, Intl, Blob:BlobStub, URL:URLStub,navigator:{clipboard:{writeText:clipboardImpl|| (async value=>{copied.push(value);})}},initSocials:()=>({show(){}}),initEarlyBuyers:()=>({show(){}}),initSmartWallets:()=>({show(){},pick:options=>pickerCalls.push(options),add(){},quickAdd:(address,chainIds)=>{quickAddCalls.push({address,chainIds});return quickAddImpl?quickAddImpl(address,chainIds):Promise.resolve({created:true});},lookup:address=>smartRecords.find(w=>w.address.toLowerCase()===String(address).toLowerCase())||null}),
    setTimeout(fn,ms) { if(timerImpl)return timerImpl(fn,ms);timers.push({fn,ms});return timers.length; }, clearTimeout() {},
    confirm:confirmImpl,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    data: { NETWORKS: [{ id: 'base', name: 'Base', live:true, explorer: 'https://base.blockscout.com' },{id:'robinhood',name:'Robinhood Chain',live:true}],debankProfileUrl:address=>/^0x[0-9a-fA-F]{40}$/.test(address)?`https://debank.com/profile/${address}`:null,isSystemWalletAddress:address=>String(address).toLowerCase()===ZERO,isIgnoredWalletAddress:address=>[ZERO,'0x000000000000000000000000000000000000dead'].includes(String(address||'').trim().toLowerCase()),IGNORED_WALLET_ADDRESS_ERROR:'Tato adresa je systémová burn/dead adresa a nelze ji přidat jako peněženku.',
      TOKENS: [token],MAX_WALLET_SCAN:500, DEMO_WALLETS: [{ address: A, holdings: [{...token,tokenId:token.id,amount:1}] }], searchHolders: request, analyzeWallets: request,getDashboard:async()=>{dashboardCalls.push('overview');return dashboardData||{scans:[],walletAnalysis:null,correlations:[],moni:{watchlistCount:0,accounts:[]}};},getDashboardTopics:async()=>{dashboardCalls.push('topics');return dashboardTopics||{available:false,error:'AIXBT test unavailable'};},getDashboardTopic:dashboardTopicImpl||(async()=>({available:false,error:'not found'})),
      ...(deleteImpl?{deleteServerScan:deleteImpl}:{}),...(deleteAllImpl?{deleteAllServerScans:deleteAllImpl}:{}),...(listImpl?{listServerScans:listImpl}:{}),...(getScanImpl?{getServerScan:getScanImpl}:{}),...(repeatImpl?{repeatServerScan:repeatImpl}:{}),...(readResultImpl?{readServerScanResult:readResultImpl}:{}),...(pauseImpl?{pauseServerScan:pauseImpl}:{}) },
  });
  if(pageTokensImpl)context.data.getServerTokenPage=pageTokensImpl;
  vm.runInContext(source + (useRealConfirmation?'':'\nconfirmScanDeletion=()=>confirm();') + '\nglobalThis.app = {state, run, setSource, setView, normalizeWallet, saveSearch, savedQueries, savedWallets, currentRows, toggleBookmark, renderResults, exportCSV, addCustomToken,changeProvider,renderProviderStatus,deleteBackendScan,deleteAllBackendScans,refreshServerScans,renderBackendScan,renderServerScanPanels,scanRow,openBackendScan,editBackendScan,repeatBackendScan,openLiveBackendScan,pauseBackendScan,confirmScanDeletion,confirmDeleteAllScans,prepareWalletAnalysis,renderWalletInputContext,analysisAddresses,manualAddresses,loadServerTokenPage,openWallet,dexScreenerUrl,tokenNameHtml,tokenContractHtml,renderDashboard,renderDashboardWallets,renderDashboardCorrelations,renderDashboardResearch,renderDashboardMoni,renderDashboardTopics,loadDashboard,openDashboardTopic};', context);
  const app = context.app, get = id => document.getElementById(id),initialView=app.state.view;
  Object.assign(app.state, { view: 'wallets', source: 'live', chainIds: ['base'], selectedTokens: [{ ...token }] });
  get('wallet-addresses').value = A;
  const clickQuery = id => {const button={dataset:{loadQuery:String(id)},hasAttribute:()=>false};return events.get('click').find(item=>!item.capture).listener({target:{closest:selector=>selector==='button'?button:null},preventDefault(){},stopPropagation(){}});};
  return { app, get, requests, clickQuery, globalDialogs,pickerCalls,quickAddCalls,timers,copied,externalLinks,events,storage,dashboardCalls,csvBlobs,initialView };
}

{
 const {app,get,initialView,dashboardCalls,requests}=harness();assert.equal(initialView,'dashboard','new app sessions start on Dashboard');app.setView('dashboard');await app.loadDashboard();
 assert.equal(dashboardCalls.filter(call=>call==='overview').length,2);assert.equal(dashboardCalls.filter(call=>call==='topics').length,2);assert.equal(requests.length,0,'Dashboard loading never submits a screener or wallet scan');assert.match(get('dashboard-wallets').innerHTML,/Zatím není uložená použitelná Wallet Analyzer analýza/);assert.match(get('dashboard-correlations').innerHTML,/Zatím nejsou uložené výsledky/);assert.equal(get('dashboard-moni-panel').hidden,true,'empty Moni content does not render a panel');
}
{
 const created='2026-10-15T12:00:00.000Z',overview={scans:[{id:'running-dashboard',status:'running',query:{kind:'wallets',addresses:['0x1111111111111111111111111111111111111111'],chainIds:['base']},progress:{completedWallets:0,totalWallets:1},tasks:[],runtimeMs:1000,createdAt:created}],walletAnalysis:{datasetName:'1 wallet',networks:['base'],coverage:{successful:1,requested:1,walletNetworkCount:1,perNetwork:[{chainId:'base',successful:1,oldest:created,newest:created}]},quality:{invalidRows:0,warningTasks:0,failedTasks:0},freshness:{newest:created,oldest:'2026-10-15T10:00:00.000Z',wallets:{fresh:0,aging:1,stale:0},walletNetworks:{fresh:0,aging:1,stale:0}},snapshot:{persisted:true,merged:true},tokens:[{id:'base:token',address:A,chainId:'base',symbol:'TEST',name:'Test token',holderCount:1,analyzedWalletCount:1,share:1,totalValue:5,unpricedPositions:0}]},correlations:[{id:'holder-saved',status:'complete',createdAt:created,match:'all',query:{match:'all',minPositionUsd:500,holderCap:20000},resultCount:1,tokens:[{symbol:'TEST'}],warnings:['Top 20 000 holders limited']}],moni:{watchlistCount:0,accounts:[]}};
 const {app,get}=harness({dashboardData:overview,dashboardTopics:{available:true,fetchedAt:created,snapshot:{completedAt:created},items:[{id:'topic-id',rank:1,name:'RWA',summary:'Real-world assets',trend:88,postCount:12,authorCount:4}]}});app.setView('dashboard');await app.loadDashboard();
 assert.equal(get('dashboard-scans').innerHTML,'','running scans are not summarized on the current Dashboard');assert.doesNotMatch(get('dashboard-scans').innerHTML,/running-dashboard|data-pause-scan/,'the removed running-scan overview is not rendered');assert.match(get('dashboard-wallets').innerHTML,/TEST/);assert.match(get('dashboard-wallets').innerHTML,/Analyzováno: 1 wallet/,'the card presents count from the merged wallet dataset');assert.match(get('dashboard-wallets').innerHTML,/0 aktuálních · 1 starších · 0 k obnovení/,'wallet-level freshness breakdown is compact and shown once');assert.match(get('dashboard-wallet-freshness').textContent,/Nejnovější data/,'the card describes freshness across the merged dataset');assert.match(get('dashboard-wallet-freshness').textContent,/nejstarší/,'the card makes differing data times explicit');assert.doesNotMatch(get('dashboard-wallets').innerHTML,/data-open-scan/,'merged data does not falsely link to one scan');assert.match(get('dashboard-correlations').innerHTML,/PONS|TEST/);assert.match(get('dashboard-correlations').innerHTML,/Top 20 000 holders/);assert.match(get('dashboard-topics').innerHTML,/RWA/);assert.match(get('dashboard-aixbt-freshness').textContent,/AIXBT/);
}

{
 const {app,get,externalLinks}=harness({dashboardTopicImpl:async()=>({available:true,topic:{name:'Topic without summary',summary:'',url:'https://aixbt.tech/rankings?entity=topics&id=topic-1'},projects:[]})});await app.openDashboardTopic('topic-1');assert.equal(get('aixbt-topic-dialog').open,false,'missing summary with a usable URL opens the source instead of leaving an empty detail modal');assert.deepEqual(externalLinks,[{href:'https://aixbt.tech/rankings?entity=topics&id=topic-1',target:'_blank',rel:'noopener noreferrer',title:'Otevřít zdroj na AIXBT'}]);
}
{
 const {app,get,externalLinks}=harness({dashboardTopicImpl:async()=>({available:true,topic:{name:'Topic with summary',summary:'Useful context',url:'https://aixbt.tech/topic/topic-2'},projects:[]})});await app.openDashboardTopic('topic-2');assert.equal(get('aixbt-topic-dialog').open,true,'valid detail summary keeps the internal detail open');assert.match(get('aixbt-topic-content').innerHTML,/Useful context/);assert.deepEqual(externalLinks,[]);
}

// The global backdrop handler keeps ordinary modal behavior while explicitly exempting smart-dialog.
{
 const {globalDialogs}=harness(),[ordinary,smart]=globalDialogs;
 ordinary.emit('click',{clientX:50,clientY:250});assert.equal(ordinary.open,false);assert.equal(ordinary.closeCount,1,'ordinary dialogs still close on outside click');
 smart.emit('click',{clientX:50,clientY:250});assert.equal(smart.open,true);assert.equal(smart.closeCount,0,'smart-dialog ignores the global backdrop close handler');
 smart.emit('click',{clientX:250,clientY:250});assert.equal(smart.open,true,'clicks inside smart-dialog leave it open');
}

{
 const {app,events,copied,timers,get}=harness();const tokenClick=events.get('click').find(item=>item.capture).listener;
 const cases=[['base','https://dexscreener.com/base/'],['ethereum','https://dexscreener.com/ethereum/'],['arbitrum','https://dexscreener.com/arbitrum/'],['optimism','https://dexscreener.com/optimism/']];
 for(const [chainId,prefix] of cases){
  const link=app.tokenNameHtml({...token,chainId});assert.ok(link.includes(`href="${prefix}${A}"`),`${chainId} uses its explicit DexScreener slug`);assert.match(link,/target="_blank" rel="noopener noreferrer"/,'token link opens safely in a new tab');
 }
 assert.equal(app.dexScreenerUrl('robinhood',A),`https://dexscreener.com/search?q=${A}`,'unsupported chain uses exact-contract DexScreener search');
 assert.equal(app.dexScreenerUrl('base','not-an-evm-address'),null,'invalid EVM contract produces no DexScreener link');
 assert.doesNotMatch(app.tokenNameHtml({...token,address:'not-an-evm-address'}),/<a\b/,'invalid contract renders token symbol without an external link');
 const contract=app.tokenContractHtml(token);assert.match(contract,new RegExp(`data-copy-contract="${A}"`),'copy control stores the complete contract address');assert.match(contract,/0x1111…1111/,'copy control displays only the shortened address');
 const button={dataset:{copyContract:A,copyLabel:'0x1111…1111'},textContent:'0x1111…1111'};let stopped=false,prevented=false;
 await tokenClick({target:{closest:selector=>selector==='[data-copy-contract]'||selector==='button'?button:null},stopPropagation(){stopped=true;},preventDefault(){prevented=true;}});
 assert.deepEqual(copied,[A],'clipboard receives the complete contract, not the shortened display text');assert.equal(button.textContent,'✓ Zkopírováno');assert.equal(timers.at(-1).ms,1500,'copy confirmation expires after 1.5 seconds');timers.at(-1).fn();assert.equal(button.textContent,'0x1111…1111','copy label is restored after confirmation');assert.equal(stopped,true,'copy action stops propagation before a parent row handler');assert.equal(prevented,true,'copy action does not navigate');
 let linkStopped=false,linkPrevented=false;const anchor={};
 await tokenClick({target:{closest:selector=>selector==='[data-token-link]'?anchor:null},stopPropagation(){linkStopped=true;},preventDefault(){linkPrevented=true;}});
 assert.equal(linkStopped,true,'DexScreener action stops parent-row click handlers');assert.equal(linkPrevented,false,'DexScreener anchor keeps its normal new-tab navigation');
 let debankStopped=false,debankPrevented=false;const debankAnchor={};
 await tokenClick({target:{closest:selector=>selector==='[data-debank-link]'?debankAnchor:null},stopPropagation(){debankStopped=true;},preventDefault(){debankPrevented=true;}});
 assert.equal(debankStopped,true,'DeBank links stop parent row handlers');assert.equal(debankPrevented,false,'DeBank anchors keep normal new-tab navigation');
 app.state.result={wallets:[],tokens:[{...token,symbol:'BASE'}],coverage:{},warnings:[]};app.renderResults();assert.match(get('table-body').innerHTML,/data-token-link/,'Wallet Analyzer result rows use the shared token link renderer');assert.match(get('table-body').innerHTML,/data-copy-contract/,'Wallet Analyzer result rows use the shared contract-copy renderer');
 const failed=harness({clipboardImpl:async()=>{throw new Error('clipboard denied');}}),failedClick=failed.events.get('click').find(item=>item.capture).listener;
 await failedClick({target:{closest:selector=>selector==='[data-copy-contract]'?button:null},stopPropagation(){},preventDefault(){}});assert.match(failed.get('toast').textContent,/nepodařilo zkopírovat/,'clipboard failures produce a clear user-facing message');
}

// Token Screener wallet rows link the shortened address to DeBank without duplicating the same action.
{
 const known={address:B,name:'ARB Whale',tags:['DeFi'],status:'reviewed',statusLabel:'Prověřená'};
 const {app,get}=harness({smartRecords:[known]});
 app.state.view='screener';app.state.source='live';app.state.result={wallets:[{address:A,matchedTokens:[],holdings:[],chainIds:['base'],value:0},{address:B,matchedTokens:[],holdings:[],chainIds:['base'],value:0}],tokens:[],coverage:{},warnings:[]};app.renderResults();
 const html=get('table-body').innerHTML;
 assert.match(html,new RegExp(`<a class="smart-address smart-address-link result-wallet-address" data-debank-link href="https://debank\\.com/profile/${A}" target="_blank" rel="noopener noreferrer" title="Otevřít v DeBank"[^>]*>0x1111…1111</a>`),'public wallet address displays shortened text and opens the exact full DeBank profile safely');
 assert.doesNotMatch(html,/class="debank-action"/,'row actions do not duplicate the DeBank link');
 assert.match(html,new RegExp(`<button type="button" class="quick-add-button[^\"]*" data-smart-quick-add="${A}" data-quick-networks="base"[^>]*title="Rychle přidat do Smart wallets`),'Token Screener exposes a direct quick-add action for the result network');assert.match(html,new RegExp(`<button class="bookmark-button[^>]*data-bookmark="${A}"`),'Watchlist action remains in the row');assert.match(html,new RegExp(`<button class="open-detail" data-wallet="${A}" aria-label="Detail`),'the external-arrow action still opens the internal wallet detail');
 assert.match(html,/data-wallet="0x2222222222222222222222222222222222222222">ARB Whale<\/button>/,'named Smart wallet keeps its independent internal detail action');
 assert.match(html,/class="smart-address smart-address-link result-wallet-address" data-debank-link href="https:\/\/debank\.com\/profile\/0x2222222222222222222222222222222222222222"[^>]*>0x2222…2222<\/a>/,'Smart wallet address is shortened as well while retaining full profile URL');
 assert.match(html,/data-wallet="0x2222222222222222222222222222222222222222" aria-label="Detail/,'internal detail remains a separate row action');
 app.state.result.wallets=[{address:'not-an-evm-address',matchedTokens:[],holdings:[],chainIds:['base'],value:0}];app.renderResults();assert.doesNotMatch(get('table-body').innerHTML,/data-debank-link|debank\.com\/profile/,'invalid wallet values never receive DeBank links');
}

// Token Screener quick-add preserves current result context and reports backend-confirmed success/failure.
{
 const wallets=Array.from({length:10},(_,index)=>({address:`0x${(index+100).toString(16).padStart(40,'0')}`,matchedTokens:[token],holdings:[],chainIds:['robinhood'],value:0})),target=wallets[8];let finish;
 const pending=new Promise(resolve=>{finish=resolve;});const {app,get,events,quickAddCalls,pickerCalls}=harness({quickAddImpl:()=>pending});
 app.state.view='screener';app.state.source='live';app.state.result={wallets,tokens:[],coverage:{},warnings:[]};app.state.page=2;app.renderResults();get('result-search').value=target.address.slice(0,8);get('sort-select').value='holders';
 assert.match(get('table-body').innerHTML,new RegExp(`data-smart-quick-add="${target.address}" data-quick-networks="robinhood"`),'result network is passed into the quick-add action');
 const action={dataset:{smartQuickAdd:target.address,quickNetworks:'robinhood'},hasAttribute:()=>false};let stopped=false,prevented=false;
 events.get('click').find(entry=>!entry.capture&&entry.listener.toString().includes('smartQuickAdd')).listener({target:{closest:selector=>selector==='button'?action:null},preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
 await Promise.resolve();assert.equal(stopped,true);assert.equal(prevented,true);assert.deepEqual(JSON.parse(JSON.stringify(quickAddCalls)),[{address:target.address,chainIds:['robinhood']}]);assert.equal(pickerCalls.length,0,'quick-add never opens the add form');
 assert.match(get('table-body').innerHTML,/quick-add-button pending[^>]*disabled/,'the row reports loading while awaiting backend confirmation');
 finish({created:true});await pending;await Promise.resolve();await Promise.resolve();
 assert.match(get('table-body').innerHTML,/quick-add-button saved[^>]*title="Ve Smart wallets"[^>]*>✓/,'success indicator appears only after the server confirms persistence');assert.equal(app.state.view,'screener');assert.equal(app.state.page,2);assert.equal(get('result-search').value,target.address.slice(0,8));assert.equal(get('sort-select').value,'holders');
 const failed=harness({quickAddImpl:async()=>{throw Error('server rejected quick add');}});failed.app.state.view='screener';failed.app.state.source='live';failed.app.state.result={wallets:[{...target}],tokens:[],coverage:{},warnings:[]};failed.app.renderResults();const failAction={dataset:{smartQuickAdd:target.address,quickNetworks:'robinhood'},hasAttribute:()=>false};failed.events.get('click').find(entry=>!entry.capture&&entry.listener.toString().includes('smartQuickAdd')).listener({target:{closest:selector=>selector==='button'?failAction:null},preventDefault(){},stopPropagation(){}});await new Promise(resolve=>setTimeout(resolve,20));assert.match(failed.get('table-body').innerHTML,/quick-add-button error[^>]*title="Přidání selhalo · opakovat"[^>]*>\+</,'failed add returns to plus without success state');assert.match(failed.get('toast').textContent,/server rejected quick add/);
 const system=harness();system.app.state.view='screener';system.app.state.source='live';system.app.state.result={wallets:[{address:ZERO,matchedTokens:[],holdings:[],chainIds:['base'],value:0}],tokens:[],coverage:{},warnings:[]};system.app.renderResults();assert.doesNotMatch(system.get('table-body').innerHTML,/data-smart-quick-add=/,'ignored system addresses are excluded before a quick-add control can be rendered');
}

{
 const {app,get}=harness();
 app.state.result={wallets:[],tokens:[],warnings:['Base: Indexer odpověděl HTTP 403.'],coverage:{complete:false,details:[{chainId:'base',status:'error',error:'Indexer odpověděl HTTP 403.'}]}};
 app.renderResults();
 assert.match(get('scan-notice').innerHTML,/Base: Indexer odpověděl HTTP 403/,'partial scan banner identifies the failed network and reason');
 assert.doesNotMatch(get('scan-notice').innerHTML,/dotazů se nepodařilo načíst/,'partial scan banner no longer hides the cause behind a generic count');
 app.state.result={wallets:[],tokens:[{...token,id:'base:'+A,address:A,chainId:'base',symbol:'LIVE',name:'Live token',amount:7,totalValue:14,holderCount:1,share:1}],warnings:[],coverage:{complete:false,details:[{chainId:'base',status:'error'}]}};
 app.renderResults();assert.match(get('table-body').innerHTML,/LIVE/,'successful network token rows remain visible in the Wallet Analyzer table after a partial failure');
}

{
 const {app,get,requests}=harness();app.setView('smart');
 assert.equal(get('smart-section').hidden,false);assert.equal(get('research-results').hidden,true);assert.equal(get('source-controls').hidden,true);
 await app.run();assert.equal(requests.length,0,'opening Smart wallets must not start a token scan');
 app.setView('wallets');assert.equal(get('smart-section').hidden,true);assert.equal(get('research-results').hidden,false);assert.equal(get('query-panel').hidden,false);
}

{
  const {app,get,requests}=harness();
  app.state.source='demo';app.state.view='screener';
  app.state.selectedTokens=[{...token,id:`base:${B}`,address:B}];
  await app.run();
  assert.equal(requests.length,0,'custom contracts must not report demo zero holders');
  assert.equal(app.state.result,null);
  assert.match(get('empty-state').innerHTML,/use-live-api/);
  assert.match(get('results-title').innerHTML,/—/);
  get('use-live-api').onclick();
  assert.equal(app.state.source,'live');
  assert.equal(requests.length,1,'the explicit live action must start the real holder lookup');
  requests[0].resolve({wallets:[],tokens:[]});
  await Promise.resolve();
}

// Token Screener passes the selected holder cap to the server scan unchanged.
{
 const {app,get,requests,events}=harness();app.state.view='screener';app.state.source='live';get('scan-max-holders').value='30000';
 const scan=app.run();assert.equal(requests.length,1);assert.equal(requests[0].options.holderCap,30000);requests[0].resolve({wallets:[],tokens:[],warnings:[],coverage:{complete:true},job:{status:'complete',query:{holderCap:30000},tasks:[]}});await scan;
 get('scan-max-holders').value='0';events.get('change').at(-1).listener({target:get('scan-max-holders')});assert.equal(get('holder-cap-warning').hidden,false,'the advanced unlimited choice reveals the long-scan warning');const unlimited=app.run();assert.equal(requests[1].options.holderCap,0,'unlimited is transmitted as zero, not replaced by the default');requests[1].resolve({wallets:[],tokens:[],warnings:[],coverage:{complete:true},job:{status:'complete',query:{holderCap:0},tasks:[]}});await unlimited;
}

// Holder-cap completion and unsafe-ordering warnings remain visible in results.
{
 const {app,get}=harness();app.state.view='screener';app.state.result={wallets:[],tokens:[],warnings:['Výsledek používá Top 20 000 holders u 1 z 1 tokenů. Korelace nemusí zahrnovat menší držitele mimo tento rozsah.'],coverage:{complete:true},job:{status:'complete',query:{holderCap:20000},tasks:[{completionReason:'holder_cap',token:{symbol:'TEST',holdersAccepted:20000}}]}};app.renderResults();
 assert.match(get('scan-notice').innerHTML,/Top 20\s?000 holders/,'capped holder sets are called out above the result');assert.match(get('results-subtitle').textContent,/výsledek omezen holder limitem/);assert.match(get('results-subtitle').textContent,/Limit 20\s?000 holderů \/ token/);
 app.state.result={wallets:[],tokens:[],warnings:['Limit holderů nebylo možné bezpečně použít u 1 tokenů, protože pořadí není ověřeno; jejich kompletní holder list byl načten.'],coverage:{complete:true},job:{status:'complete',query:{holderCap:20000},tasks:[{completionReason:'all_holders',token:{symbol:'TEST',holderCapDisabledReason:'ordering failure'}}]}};app.renderResults();assert.match(get('scan-notice').innerHTML,/kompletní holder list/);assert.match(get('results-subtitle').textContent,/TEST · Kompletní dataset/);assert.doesNotMatch(get('results-subtitle').textContent,/Top 20 000 holders/,'unsafe ordering is never labeled Top-N');
}

// Server-scan rows format runtime consistently for short, long, active, paused and legacy scans.
{
 const {app}=harness(),base={id:'duration',query:{kind:'holders'},tasks:[],pages:156,positions:7754,updatedAt:'2026-10-15T20:28:46.000Z'};
 assert.match(app.scanRow({...base,status:'complete',runtimeMs:42000}),/Trvání 42 s/);
 assert.match(app.scanRow({...base,status:'complete',runtimeMs:393000}),/Trvání 6 min 33 s/);
 assert.match(app.scanRow({...base,status:'complete',runtimeMs:3780000}),/Trvání 1 h 03 min/);
 assert.match(app.scanRow({...base,status:'running',runtimeMs:252000}),/Běží 4 min 12 s/);
 assert.match(app.scanRow({...base,status:'paused',runtimeMs:728000}),/Běželo 12 min 08 s/);
 assert.match(app.scanRow({...base,status:'complete',runtimeMs:null}),/Trvání neznámé/);
 const tasks=[{completionReason:'all_holders',address:'0x1111111111111111111111111111111111111111',token:{symbol:'HOOKR'}},{completionReason:'holder_cap',address:'0x2222222222222222222222222222222222222222',token:{symbol:'PONS'}},{completionReason:'usd_threshold',address:'0x3333333333333333333333333333333333333333',token:{symbol:'BONER'}}];
 const reasons=app.scanRow({...base,status:'complete',query:{kind:'holders',holderCap:20000,minPositionUsd:500},tasks});
 assert.match(reasons,/HOOKR · Kompletní dataset/);assert.match(reasons,/PONS · Limit 20\s?000 holderů \/ token/);assert.match(reasons,/BONER · Pozice pod \$500 již nebyly načítány/,'scan history shows task completion metadata individually');
}

{
  const {app,get,requests}=harness();
  app.state.source='demo';app.state.view='screener';app.state.selectedTokens=[];
  get('token-search').value=B;get('custom-chain').value='base';
  app.addCustomToken();
  assert.equal(app.state.source,'live','adding a custom contract must leave demo mode');
  assert.equal(app.state.selectedTokens[0].decimals,null,'custom token decimals must come from live metadata');
  assert.equal(requests.length,0,'adding a contract waits for the explicit scan');
  const pending=app.run();
  const liveToken={...app.state.selectedTokens[0],symbol:'ZRO',name:'LayerZero',decimals:18};
  requests[0].resolve({wallets:[],tokens:[liveToken]});
  await pending;
  assert.equal(app.state.selectedTokens[0].symbol,'ZRO','live metadata must update the selected token chip');
}

{
  const { app } = harness();
  const wallet = holdings => ({ address: A, holdings });
  assert.equal(app.normalizeWallet({ ...wallet([{ ...token, value: null }]), value: null }).value, null);
  assert.equal(app.normalizeWallet(wallet([{ ...token, value: null }])).value, null);
  assert.equal(app.normalizeWallet(wallet([{ ...token, value: 0 }])).value, 0);
  assert.equal(app.normalizeWallet(wallet([{ ...token, value: 25 }, { ...token, value: null }])).value, 25);
}

{
  const { app, get, requests } = harness();
  const scan = app.run();
  assert.equal(app.state.busy, true);
  assert.equal(get('export-button').disabled, true);
  const loading = get('empty-state').innerHTML;
  get('result-search').emit('input');
  assert.equal(get('empty-state').innerHTML, loading, 'filter rendering must preserve pending scan/cancel UI');
  get('wallet-addresses').value = B;
  get('wallet-addresses').emit('input');
  assert.equal(requests[0].options.signal.aborted, true);
  assert.equal(app.state.busy, false);
  requests[0].resolve({ wallets: [{ address: A, value: 100 }], tokens: [] });
  await scan;
  assert.equal(app.state.result, null, 'edited inputs must reject old completion');
}

{
  const { app, get, requests } = harness();
  const oldScan = app.run();
  get('wallet-addresses').value = B;
  const newScan = app.run();
  assert.equal(requests[0].options.signal.aborted, true);
  requests[1].resolve({ wallets: [], tokens: [{ ...token, totalValue: 7 }] });
  await newScan;
  requests[0].resolve({ wallets: [], tokens: [{ ...token, totalValue: 99 }] });
  await oldScan;
  assert.equal(app.state.result.tokens[0].totalValue, 7, 'latest request must win over late completion');
  assert.equal(app.state.busy, false);
  const cancelled = app.run();
  get('cancel-scan').onclick();
  assert.equal(requests[2].options.signal.aborted, true);
  requests[2].resolve({ wallets: [], tokens: [{ ...token, totalValue: 1 }] });
  await cancelled;
  assert.equal(app.state.result, null, 'cancelled response must not return results');
}

{
  const { app, get, requests, clickQuery } = harness();
  app.state.result = { wallets: [], tokens: [] };
  get('wallet-addresses').value = B;
  app.saveSearch();
  const saved = app.savedQueries[0];
  app.state.selectedTokens[0].symbol = 'CHANGED';
  app.state.selectedTokens.push({ ...token, id: 'another' });
  app.state.chainIds.push('ethereum');
  assert.equal(saved.tokens[0].symbol, 'TEST');
  assert.equal(saved.tokens.length, 1);
  assert.equal(saved.chainIds.length, 1);
  app.state.source = 'demo';
  app.state.view = 'screener';
  app.state.activeWallet = { address: A };
  get('wallet-drawer').hidden = false;
  clickQuery(saved.id);
  assert.equal(app.state.source, 'live');
  assert.equal(app.state.view, 'wallets');
  assert.equal(get('wallet-addresses').value, B, 'restoration must retain saved addresses across source/view changes');
  assert.equal(requests.length, 0, 'restoring a live query must wait for an explicit scan');
  assert.equal(get('wallet-drawer').hidden, true, 'source changes must close obsolete details');
  app.state.selectedTokens.push({ ...token, id: 'another' });
  app.state.chainIds.push('ethereum');
  assert.equal(saved.tokens.length, 1);
  assert.equal(saved.chainIds.length, 1);
}

{
  const { app, get, requests, clickQuery } = harness();
  app.state.result = { wallets: [], tokens: [] };
  get('wallet-addresses').value = B;
  app.saveSearch();
  get('wallet-addresses').value = A;
  const scan = app.run();
  clickQuery(app.savedQueries[0].id);
  assert.equal(get('wallet-addresses').value, B);
  assert.equal(requests[0].options.signal.aborted, true, 'restoring same-mode live query must abort a pending scan');
  requests[0].resolve({ wallets: [], tokens: [{ ...token, totalValue: 99 }] });
  await scan;
  assert.equal(app.state.result, null, 'old results must not populate a restored live query');
  assert.equal(app.state.busy, false);
}

{
  const { app } = harness();
  app.state.source = 'demo';
  app.state.view = 'screener';
  app.state.result = { wallets: [app.normalizeWallet({ address: A, value: 10, holdings: [{ ...token, value: 10 }] })], tokens: [] };
  app.toggleBookmark(A);
  app.state.source = 'live';
  app.state.result = { wallets: [app.normalizeWallet({ address: A, value: 20, holdings: [{ ...token, value: 20 }] })], tokens: [] };
  app.toggleBookmark(A);
  app.state.view = 'watchlist';
  assert.equal(app.currentRows().length, 1);
  assert.equal(app.currentRows()[0].value, 20);
  app.state.source = 'demo';
  assert.equal(app.currentRows().length, 1);
  assert.equal(app.currentRows()[0].value, 10, 'watchlist snapshots must remain source isolated');
}

console.log('App regressions passed: unknown USD, stale requests, cancellation, live-result opening and polling, final-state refresh, explicit pause and watchlist isolation.');

// Production starts with on-chain data and waits for an explicit scan.
{
 const {app,get,requests}=harness();
 assert.equal(app.state.source,'live');assert.equal(requests.length,0);
 app.setSource('demo');assert.equal(app.state.source,'live');
 app.changeProvider('blockscout');assert.equal(app.state.provider,'blockscout');
 const scan=app.run();assert.equal(requests[0].options.provider,'blockscout');
 requests[0].resolve({wallets:[],tokens:[]});await scan;
 app.saveSearch();assert.equal(app.savedQueries[0].provider,'blockscout');
 app.state.provider='auto';app.renderProviderStatus();assert.match(get('provider-select').innerHTML,/Chainbase · nepřipojeno/);
}

// Manual deletion is confirmed, isolated, and clears the deleted result even with late responses.
{
 let deletes=0;const {app}=harness({confirmImpl:()=>false,deleteImpl:async()=>{deletes++;}});
 await app.deleteBackendScan('cancelled');assert.equal(deletes,0);
}
{
 const {app,get}=harness({deleteImpl:async id=>({id,deleted:true}),listImpl:async()=>({scans:[]})});
 app.state.backendJob={id:'removed'};app.state.result={job:{id:'removed'},wallets:[],tokens:[]};app.state.selected.add(A);app.state.activeWallet={address:A};app.state.controller=new AbortController();
 get('result-search').value='old filter';get('min-value').value='123';get('active-server-scan').innerHTML='old scan';
 await app.deleteBackendScan('removed');assert.equal(app.state.result,null);assert.equal(app.state.backendJob,null);assert.equal(app.state.activeWallet,null);assert.equal(app.state.selected.size,0);assert.equal(app.state.busy,false);assert.equal(get('result-search').value,'');assert.equal(get('min-value').value,'');assert.equal(get('active-server-scan').innerHTML,'');assert.equal(get('table-body').innerHTML,'');assert.match(get('empty-state').innerHTML,/Začněte/);
}
{
 const {app}=harness({deleteImpl:async()=>{},listImpl:async()=>({scans:[]})});const result={job:{id:'kept'},wallets:[],tokens:[]};app.state.result=result;app.state.backendJob={id:'kept'};
 await app.deleteBackendScan('other');assert.equal(app.state.result,result);assert.equal(app.state.backendJob.id,'kept');
}
{
 const {app,get}=harness({deleteImpl:async()=>{throw Error('Nejprve pozastavte sken');}});const result={job:{id:'running'},wallets:[],tokens:[]};app.state.result=result;
 await app.deleteBackendScan('running');assert.equal(app.state.result,result);assert.match(get('query-error').textContent,/pozastavte/);
}
{
 const scans=[{id:'done',status:'complete',query:{kind:'holders'},tasks:[]},{id:'paused',status:'paused',query:{kind:'holders'},tasks:[]},{id:'partial',status:'partial',query:{kind:'holders'},tasks:[]}];let calls=0;
 const {app,get,storage}=harness({useRealConfirmation:true,deleteAllImpl:async()=>{calls++;return {deleted:3,ids:scans.map(scan=>scan.id)};},listImpl:async()=>({scans:[]})});app.state.serverScans=scans;app.state.backendJob=scans[0];app.state.result={job:scans[1],wallets:[],tokens:[]};app.state.rows=[{address:A}];app.state.scanHistoryOpen=true;app.renderServerScanPanels();
 const deletion=app.deleteAllBackendScans();assert.equal(get('delete-all-scans-dialog').open,true);assert.match(get('delete-all-scans-count').textContent,/3 uložených skenů/);assert.equal(get('delete-all-scans-confirm').textContent,'Smazat všech 3');get('delete-all-scans-dialog').returnValue='delete';get('delete-all-scans-dialog').close();await deletion;
 assert.equal(calls,1);assert.equal(app.state.serverScans.length,0);assert.equal(app.state.backendJob,null);assert.equal(app.state.result,null);assert.equal(app.state.rows.length,0);assert.equal(app.state.scanHistoryOpen,false);assert.equal(storage.get('cd:scan-history-open'),'false');assert.equal(get('server-scan-total-count').textContent,'0');assert.equal(get('server-scan-history-disclosure').hidden,true);
}
{
 let calls=0;const {app,get}=harness({deleteAllImpl:async()=>{calls++;return {deleted:0,ids:[]};}});app.state.serverScans=[{id:'active',status:'running',query:{kind:'holders'},tasks:[]}];app.renderServerScanPanels();assert.equal(get('delete-all-scans').disabled,true);assert.equal(get('delete-all-scans').title,'Nejdřív pozastavte běžící skeny.');await app.deleteAllBackendScans();assert.equal(calls,0,'running scans stop the bulk delete before confirmation/API');assert.equal(get('delete-all-scans-dialog').open,false);
}
{
 let resolveOpen;const {app,get}=harness({deleteImpl:async()=>{},getScanImpl:()=>new Promise(r=>{resolveOpen=r;})});
 const opening=app.openBackendScan('late');await app.deleteBackendScan('late');resolveOpen({id:'late',query:{kind:'holders'}});await opening;assert.notEqual(app.state.backendJob?.id,'late');assert.equal(get('active-server-scan').innerHTML,'');
}
{
 const {app}=harness();const job={id:'fixture',status:'running',query:{kind:'holders'},tasks:[],pages:0,positions:0,updatedAt:new Date().toISOString()};const running=app.scanRow(job);assert.match(running,/data-delete-scan="fixture"[^>]*disabled/);assert.match(running,/data-view-scan="fixture"[\s\S]*data-pause-scan="fixture"[\s\S]*data-delete-scan="fixture"/,'running actions stay visible and delete stays disabled');const paused=app.scanRow({...job,status:'paused'});assert.doesNotMatch(paused,/data-delete-scan="fixture"[^>]*disabled/);assert.doesNotMatch(paused,/data-repeat-scan="fixture"/,'repeat/edit actions appear only for finished Token Screener scans');
 for(const status of ['complete','partial']){const html=app.scanRow({...job,id:`${status}-scan`,status,tasks:[{status:'complete',token:{symbol:'KUDO'}}]});assert.match(html,/data-open-scan="(?:complete|partial)-scan"[\s\S]*data-delete-scan="(?:complete|partial)-scan"[\s\S]*<details class="scan-row-more"/,'open result, delete, then secondary menu order is preserved');const menu=html.match(/<details class="scan-row-more">([\s\S]*?)<\/details>/)?.[1]||'';assert.match(menu,/data-repeat-scan=/);assert.match(menu,/data-edit-scan="(?:complete|partial)-scan">Upravit dotaz/,'the secondary action clarifies that only the query is edited');assert.doesNotMatch(menu,/data-edit-scan="(?:complete|partial)-scan">Upravit</);assert.doesNotMatch(menu,/data-delete-scan=/,'delete stays directly visible outside the menu');}
}

{
 const job={id:'running-live',status:'running',query:{kind:'wallets',chainIds:['base'],addresses:[A],provider:'blockscout'},tasks:[],taskCount:1,progress:{completedTasks:0,totalTasks:1},pages:0,positions:0,revision:3,updatedAt:new Date().toISOString()};let paused=0;
 const {app,get}=harness({getScanImpl:async()=>job,readResultImpl:async current=>({job:current,wallets:[],tokens:[{...token,totalValue:null,holderCount:0,share:0}],coverage:{complete:false,analyzedWalletCount:0,requestedWalletCount:1,message:'0 / 1 wallets'},warnings:[],pagination:{total:1,revision:3},serverPaginated:true}),pauseImpl:async()=>{paused++;return {...job,status:'paused'};}});
 await app.openLiveBackendScan(job.id);assert.equal(paused,0,'opening an in-progress result must not pause the server scan');assert.equal(app.state.backendJob.status,'running');assert.match(get('scan-live-status').innerHTML,/Sken stále probíhá/);assert.match(get('scan-live-status').innerHTML,/0 \/ 1 tasks dokončeno/);
 assert.match(app.scanRow(job),/Zobrazit průběžné výsledky/);assert.match(app.scanRow(job),/data-pause-scan="running-live">Pozastavit/);
}

{
 const job={id:'poll-to-finish',status:'running',query:{kind:'wallets',chainIds:['base'],addresses:[A],provider:'blockscout'},tasks:[],taskCount:1,progress:{completedTasks:0,totalTasks:1},pages:0,positions:0,revision:4,updatedAt:new Date().toISOString()};let timer;let fetches=0;
 const {app,get}=harness({timerImpl:(fn,ms)=>{timer={fn,ms};return 1;},getScanImpl:async()=>({...job,status:'complete',progress:{completedTasks:1,totalTasks:1},revision:5}),readResultImpl:async current=>({job:current,wallets:[],tokens:[],coverage:{complete:false,analyzedWalletCount:0,requestedWalletCount:1},warnings:[],pagination:{total:0,revision:4},serverPaginated:true}),pageTokensImpl:async()=>{fetches++;return {job:{...job,status:'complete',progress:{completedTasks:1,totalTasks:1}},tokens:[],coverage:{complete:true,analyzedWalletCount:1,requestedWalletCount:1},warnings:[],pagination:{total:0,revision:5},serverPaginated:true};}});
 await app.openLiveBackendScan(job.id,job);assert.equal(timer.ms,3000,'live results use a modest three second polling interval');await timer.fn();assert.equal(fetches,1);assert.equal(app.state.result.job.status,'complete','an open live result switches to final status without a manual refresh');assert.equal(get('scan-live-status').hidden,true);
}

{
 const job={id:'pause-only',status:'paused',query:{kind:'wallets',chainIds:['base'],addresses:[A]},tasks:[],taskCount:1,progress:{completedTasks:0,totalTasks:1},pages:0,positions:0,updatedAt:new Date().toISOString()};let reads=0,pauses=0;
 const {app}=harness({pauseImpl:async()=>{pauses++;return job;},readResultImpl:async()=>{reads++;return {};}});
 await app.pauseBackendScan(job.id);assert.equal(pauses,1);assert.equal(reads,0,'the standalone pause action must not automatically open results');assert.equal(app.state.result,null);
}

{
 let resolveList,lists=0;const {app,get}=harness({deleteImpl:async()=>{},listImpl:()=>++lists===1?new Promise(r=>{resolveList=r;}):Promise.resolve({scans:[]})});
 const stale=app.refreshServerScans();await app.deleteBackendScan('stale');resolveList({scans:[{id:'stale',status:'paused'}]});await stale;assert.doesNotMatch(get('server-scan-history').innerHTML,/data-delete-scan/);
}

{
 const {app,get}=harness({useRealConfirmation:true});const cancelled=app.confirmScanDeletion('fixture','Testovací sken');assert.equal(get('delete-scan-name').textContent,'Testovací sken');assert.equal(get('delete-scan-dialog').returnValue,'cancel');assert.equal(await app.confirmScanDeletion('other'),false);get('delete-scan-dialog').close();assert.equal(await cancelled,false);
 const confirmed=app.confirmScanDeletion('fixture');get('delete-scan-dialog').returnValue='delete';get('delete-scan-dialog').close();assert.equal(await confirmed,true);
}

// Smart-wallet prefill is explicit, deduplicated and keeps local identity out of scan addresses.
{
 const {app,get}=harness();get('wallet-addresses').value='';app.renderWalletInputContext();assert.equal(get('wallet-dataset-summary').hidden,false,'the compact dataset summary remains visible before any wallets are selected');assert.equal(get('wallet-dataset-count').textContent,'0 peněženek');assert.match(get('wallet-dataset-work').textContent,/1 síť · až 0 wallet\/network úloh/);
}
{
 const known={address:A,name:'ARB Whale <research>',tags:['DeFi','ARB'],status:'reviewed',statusLabel:'Prověřená ručně',chainIds:['base']};
 const {app,get,requests}=harness({smartRecords:[known]});
 get('wallet-addresses').value=B+'\n'+B.toUpperCase().replace('0X','0x');
 app.prepareWalletAnalysis([A,A],['base','linea'],{append:true,skippedChainIds:['linea']});
 assert.equal(requests.length,0,'prefill must never start analysis');assert.equal(get('wallet-addresses').value,B);assert.deepEqual(Array.from(app.analysisAddresses()),[B,A]);assert.deepEqual(Array.from(app.state.smartDatasetAddresses),[A]);assert.deepEqual(Array.from(app.state.chainIds),['base']);assert.match(get('wallet-smart-note').textContent,/linea/);
 assert.equal(get('wallet-input-identities').hidden,true,'Smart wallet identities stay in data and are not rendered as a large preview grid');assert.equal(get('wallet-input-identities').innerHTML,'');assert.match(get('wallet-dataset-count').textContent,/2 peněženky · 1 Smart wallet \+ 1 ruční adresa/);
 const pending=app.run();assert.equal(requests.length,1);assert.deepEqual(Array.from(requests[0].options.addresses),[B,A]);assert.deepEqual(Array.from(requests[0].options.chainIds),['base']);
 requests[0].resolve({wallets:[{address:A,holdings:[{...token,amount:2,value:3}]},{address:B,holdings:[]}],tokens:[]});await pending;
 assert.equal(app.state.result.wallets[0].smartWallet.name,known.name);assert.deepEqual(app.state.result.wallets[0].smartWallet.tags,known.tags);assert.equal(app.state.result.wallets[0].smartWallet.status,'reviewed');
 assert.match(get('wallet-result-context').innerHTML,/ARB Whale &lt;research&gt;/);assert.match(get('wallet-result-context').innerHTML,/DeFi/);assert.match(get('wallet-result-context').innerHTML,/Prověřená/);
 assert.match(get('wallet-result-context').innerHTML,new RegExp(`<a class="smart-address smart-address-link" href="https://debank\\.com/profile/${A}" target="_blank" rel="noopener noreferrer">${A}</a>`),'result wallet identity links only the exact address with safe new-tab attributes');
 app.openWallet(A);assert.match(get('wallet-drawer').innerHTML,/ARB Whale &lt;research&gt;/);assert.match(get('wallet-drawer').innerHTML,/Prověřená/);
 assert.match(get('wallet-drawer').innerHTML,new RegExp(`<a class="full-address smart-address-link" href="https://debank\\.com/profile/${A}" target="_blank" rel="noopener noreferrer">${A}</a>`));
}
{
 const {app,get}=harness();const position={...token,tokenId:token.id,amount:4,value:null},wallet={address:A,label:null,holdings:[position],value:null,chainIds:['base'],matchedTokens:[token],matchCount:1};
 app.state.view='screener';app.state.source='live';app.state.rows=[wallet];app.state.result={wallets:[wallet],job:{id:'partial-holder',status:'paused',query:{kind:'holders',match:'all',tokens:[token]},progress:{completedTasks:0,totalTasks:1},taskCount:1,positions:1,pagination:{total:1},quality:{invalidRows:0}},coverage:{complete:false},warnings:['Sken je pozastavený.']};
 app.renderResults();assert.match(get('scan-live-status').innerHTML,/potvrzených pozic z načtených stránek/);assert.match(get('scan-live-status').innerHTML,/po pokračování mohou přibýt další wallets/);
 app.openWallet(A);assert.match(get('wallet-drawer').innerHTML,/Načtené tokenové pozice <span class="count-badge">1/);assert.match(get('wallet-drawer').innerHTML,/Cena neznámá/,'unknown USD value is not rendered as zero');assert.match(get('wallet-drawer').innerHTML,/potvrzené pozice z již načtených holder stránek; další wallets mohou přibýt/);assert.doesNotMatch(get('wallet-drawer').innerHTML,/\$0(?:\.00)?/);
}
{
 const {app,get,requests}=harness();get('wallet-addresses').value=B;
 app.prepareWalletAnalysis([A,A],['base']);assert.equal(get('wallet-addresses').value,'','Smart-wallet addresses live in the compact selected dataset, not the manual textarea');assert.deepEqual(Array.from(app.analysisAddresses()),[A]);assert.equal(requests.length,0);
 assert.equal(app.prepareWalletAnalysis(Array.from({length:127},(_,i)=>'0x'+(i+100).toString(16).padStart(40,'0')),['base']),true);assert.equal(app.state.smartDatasetAddresses.size,127);assert.equal(app.analysisAddresses().length,127);assert.match(get('wallet-dataset-count').textContent,/127 peněženek/);assert.match(get('wallet-dataset-work').textContent,/1 síť · až 127 wallet\/network úloh/);assert.equal(requests.length,0,'prefilling a large dataset must not start an analysis');assert.throws(()=>app.prepareWalletAnalysis(Array.from({length:501},(_,i)=>'0x'+(i+1000).toString(16).padStart(40,'0')),['base']),/500/);const before=get('wallet-addresses').value;
 assert.throws(()=>app.prepareWalletAnalysis([B],['linea']),/síť/);assert.equal(get('wallet-addresses').value,before);
 get('wallet-addresses').value='invalid';assert.throws(()=>app.prepareWalletAnalysis([A],['base'],{append:true}),/neplatná/);assert.equal(get('wallet-addresses').value,'invalid');
}
{
 const {app,get,requests}=harness();const smart=Array.from({length:127},(_,i)=>'0x'+(i+3000).toString(16).padStart(40,'0'));
 app.prepareWalletAnalysis(smart,['base']);assert.equal(app.state.smartDatasetAddresses.size,127);get('wallet-addresses').value=[A,B,smart[0]].join('\n');app.state.chainIds=['ethereum','base','optimism','arbitrum','robinhood'];app.renderWalletInputContext();
 assert.equal(app.analysisAddresses().length,129,'manual addresses deduplicate against the Smart-wallet dataset');assert.match(get('wallet-dataset-count').textContent,/127 Smart wallets \+ 2 ruční adresy/);assert.match(get('wallet-dataset-work').textContent,/5 sítí · až 645 wallet\/network úloh/);assert.equal(requests.length,0);
 get('wallet-addresses').value=A;app.prepareWalletAnalysis([B],['base'],{append:true,replaceSmartSelection:true});assert.deepEqual(Array.from(app.state.smartDatasetAddresses),[B]);assert.deepEqual(Array.from(app.manualAddresses()),[A]);assert.deepEqual(Array.from(app.analysisAddresses()),[A,B]);assert.equal(requests.length,0,'editing the dataset only prefills; it does not start a scan');
}
{
 const {app,get,pickerCalls}=harness();app.state.smartDatasetAddresses=new Set([A]);get('wallet-addresses').value=B;get('wallet-edit-smart').onclick();await Promise.resolve();
 assert.deepEqual(JSON.parse(JSON.stringify(pickerCalls[0])),{baseAddresses:[B],selectedAddresses:[A],replaceSmartSelection:true},'the picker receives the selected Smart wallets separately from manual addresses');
}
{
 const scans=[{id:'running',status:'running',query:{kind:'wallets',addresses:[A]},tasks:[],progress:{completedTasks:1,totalTasks:3},updatedAt:'2026-10-15T10:00:00Z',pages:1,positions:2,message:'Running scan'},{id:'paused',status:'paused',query:{kind:'wallets',addresses:[B]},tasks:[],pausedAt:'2026-10-14T10:00:00Z',updatedAt:'2026-10-14T10:00:00Z',pages:1,positions:1,message:'Paused'},{id:'done',status:'complete',query:{kind:'wallets',addresses:[A]},tasks:[],finishedAt:'2026-10-13T10:00:00Z',updatedAt:'2026-10-13T10:00:00Z',pages:2,positions:4,message:'Done'}];let pauses=0;
 const {app,get}=harness({listImpl:async()=>({scans}),pauseImpl:async()=>{pauses++;}});app.state.backendJob=scans[0];app.state.smartDatasetAddresses=new Set([A]);get('wallet-addresses').value=B;app.state.result={job:scans[0],tokens:[],wallets:[]};
 await app.refreshServerScans();assert.match(get('active-server-scan').innerHTML,/Zobrazit průběžné výsledky/);assert.match(get('active-server-scan').innerHTML,/Pozastavit/);assert.match(get('active-server-scan').innerHTML,/Pozastaveno/,'paused scans stay visible beside running scans');assert.match(get('latest-server-scan').innerHTML,/data-open-scan="done"/);assert.equal(get('server-scan-total-count').textContent,'3');assert.equal(get('server-scan-history-count').textContent,'0');assert.equal(get('server-scan-history-disclosure').hidden,true);assert.equal(pauses,0);
 assert.equal(app.analysisAddresses().length,2);assert.equal(app.state.result.job.id,'running');assert.equal(pauses,0,'rendering scan sections never pauses or resets the scan');
}

{
 const one={id:'only-complete',status:'complete',query:{kind:'holders'},tasks:[],finishedAt:'2026-10-15T10:00:00Z',updatedAt:'2026-10-15T10:00:00Z'};const {app,get}=harness({listImpl:async()=>({scans:[one]})});await app.refreshServerScans();assert.match(get('latest-server-scan').innerHTML,/data-open-scan="only-complete"/);assert.match(get('latest-server-scan').innerHTML,/scan-latest-badge">Poslední/,'latest scan receives a compact inline label');assert.doesNotMatch(get('latest-server-scan').innerHTML,/server-scan-section-label|Poslední dokončený sken/,'latest scan has no separate heading row');assert.equal(get('server-scan-history-disclosure').hidden,true,'a single completed scan needs no history accordion');assert.equal(get('server-scan-total-count').textContent,'1');
}

{
 const partial={id:'latest-partial',status:'partial',query:{kind:'holders'},tasks:[],finishedAt:'2026-10-15T11:00:00Z',updatedAt:'2026-10-15T11:00:00Z'};const {app,get}=harness({listImpl:async()=>({scans:[partial]})});await app.refreshServerScans();assert.match(get('latest-server-scan').innerHTML,/scan-latest-badge">Poslední/,'latest partial result is marked inline too');assert.match(get('latest-server-scan').innerHTML,/scan-status partial/);assert.doesNotMatch(get('latest-server-scan').innerHTML,/server-scan-section-label/);
}

{
 const complete=(id,day,status='complete')=>({id,status,query:{kind:'holders'},tasks:[],finishedAt:`2026-10-${String(day).padStart(2,'0')}T10:00:00Z`,updatedAt:`2026-10-${String(day).padStart(2,'0')}T10:00:00Z`,pages:1,positions:1});
 const scans=Array.from({length:10},(_,i)=>complete(`done-${i+1}`,15-i));const {app,get}=harness({listImpl:async()=>({scans})});await app.refreshServerScans();
 assert.match(get('latest-server-scan').innerHTML,/data-open-scan="done-1"/,'one newest completed scan remains visible as quick access');assert.match(get('latest-server-scan').innerHTML,/scan-latest-badge">Poslední/,'the newest completed scan is labeled inline');assert.doesNotMatch(get('server-scan-history').innerHTML,/scan-latest-badge/,'older history rows do not receive the latest badge');assert.equal(get('server-scan-history-count').textContent,'9','ten completed scans leave nine older scans inside history');assert.equal(get('server-scan-history-disclosure').hidden,false);assert.equal(get('server-scan-history-disclosure').open,false,'older history is collapsed by default');assert.equal((get('server-scan-history').innerHTML.match(/server-scan-row/g)||[]).length,9,'history is not truncated to five items');
}

{
 const complete=(id,day,status='complete')=>({id,status,query:{kind:'holders'},tasks:[],finishedAt:`2026-10-${String(day).padStart(2,'0')}T10:00:00Z`,updatedAt:`2026-10-${String(day).padStart(2,'0')}T10:00:00Z`,pages:1,positions:1});
 const scans=[{id:'running-1',status:'running',query:{kind:'holders'},tasks:[],updatedAt:'2026-10-15T12:00:00Z',pages:1,positions:1},{...complete('paused-1',14),'status':'paused',finishedAt:null,pausedAt:'2026-10-14T10:00:00Z'},...Array.from({length:10},(_,i)=>complete(`old-${i+1}`,13-i))];
 const {app,get}=harness({listImpl:async()=>({scans})});await app.refreshServerScans();assert.match(get('active-server-scan').innerHTML,/data-view-scan="running-1"/);assert.match(get('active-server-scan').innerHTML,/data-open-scan="paused-1"/);assert.doesNotMatch(get('active-server-scan').innerHTML,/scan-latest-badge/,'running and paused scans never receive the latest badge');assert.equal(get('server-scan-history-count').textContent,'9');assert.match(get('latest-server-scan').innerHTML,/data-open-scan="old-1"/,'latest completed remains visible while all running and paused jobs stay above history');assert.match(get('latest-server-scan').innerHTML,/scan-latest-badge">Poslední/,'latest completed receives inline badge despite active jobs');
}

{
 const scans=[{id:'run-a',status:'running',query:{kind:'holders'},tasks:[],updatedAt:'2026-10-15T12:00:00Z'},{id:'run-b',status:'running',query:{kind:'holders'},tasks:[],updatedAt:'2026-10-15T11:00:00Z'}];const {app,get}=harness({listImpl:async()=>({scans})});await app.refreshServerScans();assert.match(get('active-server-scan').innerHTML,/Běžící a pozastavené skeny \(2\)/);assert.match(get('active-server-scan').innerHTML,/data-view-scan="run-a"/);assert.match(get('active-server-scan').innerHTML,/data-view-scan="run-b"/);assert.equal(get('latest-server-scan').innerHTML,'');assert.equal(get('server-scan-history-disclosure').hidden,true,'multiple running scans remain visible without opening history');
}

{
 const older={id:'older',status:'complete',query:{kind:'holders'},tasks:[],finishedAt:'2026-10-13T10:00:00Z',updatedAt:'2026-10-13T10:00:00Z'},latest={id:'latest',status:'complete',query:{kind:'holders'},tasks:[],finishedAt:'2026-10-14T10:00:00Z',updatedAt:'2026-10-14T10:00:00Z'};let current=[latest,older];
 const {app,get,storage}=harness({listImpl:async()=>({scans:current}),deleteImpl:async id=>{current=current.filter(s=>s.id!==id);}});await app.refreshServerScans();const disclosure=get('server-scan-history-disclosure');disclosure.open=true;disclosure.emit('toggle');assert.equal(app.state.scanHistoryOpen,true);assert.equal(storage.get('cd:scan-history-open'),'true','expanded state persists in localStorage');
 await app.deleteBackendScan('older');assert.match(get('server-scan-history').innerHTML,/server-scan-empty|^$/);assert.equal(get('server-scan-history-count').textContent,'0','deleting the only old scan updates the accordion count');assert.equal(get('server-scan-history-disclosure').hidden,true);
 const restored=harness({storageValues:{'cd:scan-history-open':'true'}});assert.equal(restored.app.state.scanHistoryOpen,true,'expanded history survives page initialization');
}

{
 const latest={id:'latest-done',status:'complete',query:{kind:'holders'},tasks:[],finishedAt:'2026-10-14T10:00:00Z',updatedAt:'2026-10-14T10:00:00Z'},running={id:'becoming-done',status:'running',query:{kind:'holders'},tasks:[],updatedAt:'2026-10-15T10:00:00Z'};const {app,get}=harness();app.state.serverScans=[latest,running];app.renderServerScanPanels();assert.match(get('active-server-scan').innerHTML,/data-view-scan="becoming-done"/);running.status='complete';running.finishedAt='2026-10-15T10:05:00Z';running.updatedAt=running.finishedAt;app.renderServerScanPanels();assert.equal(get('active-server-scan').innerHTML,'');assert.match(get('latest-server-scan').innerHTML,/data-open-scan="becoming-done"/,'completed running job moves into last-completed quick access');assert.equal(get('server-scan-history-count').textContent,'1','previous latest result moves into older history');
}
{
 const saved={id:'edit-config',status:'complete',query:{kind:'holders',chainIds:['base'],tokens:[{chainId:'base',address:A}],match:'any',minPositionUsd:777,holderCap:40000,provider:'blockscout'},tasks:[{token:{id:`base:${A}`,chainId:'base',address:A,symbol:'KUDO',name:'Kudo'}}]};
 let current=saved;const savedQuery=JSON.stringify(saved.query),savedTasks=JSON.stringify(saved.tasks);const {app,get,requests}=harness({getScanImpl:async()=>current,listImpl:async()=>({scans:[]})});await app.editBackendScan(saved.id);
 assert.equal(app.state.view,'screener');assert.equal(app.state.source,'live');assert.deepEqual(Array.from(app.state.chainIds),['base']);assert.equal(app.state.match,'any');assert.equal(app.state.selectedTokens[0].symbol,'KUDO');assert.equal(app.state.provider,'blockscout');assert.equal(get('scan-min-position').value,'custom');assert.equal(get('scan-min-position-custom').value,'777');assert.equal(get('scan-max-holders').value,'40000');assert.equal(requests.length,0,'editing a saved query never submits or starts a scan');
 assert.equal(JSON.stringify(saved.query),savedQuery,'editing a query does not mutate the original scan configuration');assert.equal(JSON.stringify(saved.tasks),savedTasks,'editing a query preserves the original scan results');assert.match(app.scanRow(saved),/data-edit-scan="edit-config">Upravit dotaz/);
 const legacy={...saved,id:'edit-legacy',query:{kind:'holders',chainIds:['base'],tokens:[{chainId:'base',address:A}],match:'all'},tasks:saved.tasks};current=legacy;await app.editBackendScan(legacy.id);assert.equal(get('scan-min-position').value,'0','legacy query without USD threshold uses no minimum');assert.equal(get('scan-max-holders').value,'20000','legacy query without holder cap uses the current default');assert.equal(requests.length,0);
}
{
 const original={id:'repeat-source',status:'complete',query:{kind:'holders',chainIds:['base'],tokens:[{chainId:'base',address:A}],match:'all',minPositionUsd:500,holderCap:30000},tasks:[{token:{id:`base:${A}`,chainId:'base',address:A,symbol:'KUDO'}}]};
 const repeated={...original,id:'repeat-new',status:'running',createdAt:'2026-10-16T10:00:00Z',tasks:original.tasks};let prompts=[];
 const {app}=harness({confirmImpl:message=>{prompts.push(message);return true;},getScanImpl:async()=>original,repeatImpl:async id=>{assert.equal(id,original.id);return repeated;},readResultImpl:async job=>({job,wallets:[],tokens:[],coverage:{},warnings:[]})});
 await app.repeatBackendScan(original.id);assert.equal(prompts.length,1);assert.match(prompts[0],/Zopakovat scan KUDO se stejnými parametry/);assert.equal(app.state.result.job.id,repeated.id,'repeat opens the new scan for live progress');
}
{
 const query={kind:'holders',chainIds:['base'],tokens:[{chainId:'base',address:A}],match:'all'};
 const run=(id,date)=>({id,status:'complete',query,queryFingerprint:'same-fingerprint',tasks:[{token:{id:`base:${A}`,symbol:'KUDO'}}],createdAt:date,finishedAt:date,updatedAt:date});
 const {app,get}=harness({listImpl:async()=>({scans:[run('newer','2026-10-16T10:00:00Z'),run('older','2026-10-15T10:00:00Z')]})});await app.refreshServerScans();
 const html=get('latest-server-scan').innerHTML;assert.match(html,/Předchozí běhy \(1\)/);assert.match(html,/data-open-scan="older"/);assert.match(html,/data-delete-scan="older"/);assert.equal((html.match(/scan-latest-badge/g)||[]).length,1,'only the newest completed run receives the latest badge');assert.equal(get('server-scan-history-count').textContent,'0','previous same-query run is nested below the latest run');
}
{
 let options;const pageTokensImpl=async(_id,query)=>{options=query;return {tokens:[{...token,holderCount:100,analyzedWalletCount:200,share:.5,totalValue:40}],wallets:[],coverage:{analyzedWalletCount:200,requestedWalletCount:214,networks:[]},warnings:[],pagination:{offset:query.offset,limit:query.limit,total:17,nextOffset:null,revision:9},job:{id:'large-job'}};};
 const {app,get}=harness({pageTokensImpl});app.state.result={job:{id:'large-job'},serverPaginated:true,tokens:[{...token}],wallets:[],pagination:{revision:9,total:17},coverage:{analyzedWalletCount:200,requestedWalletCount:214},warnings:[]};
 get('result-search').value='SHARED';get('min-holders').value='20';get('min-share').value='50';get('result-network').value='base';get('sort-select').value='holders';await app.loadServerTokenPage(2);
 assert.deepEqual(JSON.parse(JSON.stringify(options)),{offset:8,limit:8,revision:9,sort:'holders',minHolders:'20',minShare:'50',chainId:'base',search:'SHARED',hideSpam:true});assert.equal(app.state.page,2);assert.equal(app.state.result.tokens[0].analyzedWalletCount,200);assert.equal(app.state.result.pagination.total,17);
}
{
 const tokens=Array.from({length:25},(_,i)=>{const address='0x'+(50000+i).toString(16).padStart(40,'0'),holderCount=25-i;return {...token,id:`base:${address}`,address,chainId:'base',symbol:`T${i}`,name:`Fixture token ${i}`,holderCount,analyzedWalletCount:25,share:holderCount/25,totalValue:holderCount*(i+1),unpricedPositions:0,amount:holderCount*(i+1)};});
 const summarize=rows=>({filteredTotal:rows.length,uniqueContracts:rows.length,knownUsdValue:rows.reduce((sum,row)=>sum+row.totalValue,0),pricedTokens:rows.length,unpricedPositions:0,networks:['base'],topToken:rows[0]?{...rows[0]}:null});let activeSummary=summarize(tokens),activeRows=tokens,requests=[];
 const pageTokensImpl=async(_id,options)=>{requests.push(options);let filtered=tokens.filter(row=>row.holderCount>=Number(options.minHolders||0)&&row.share*100>=Number(options.minShare||0)&&(!options.chainId||row.chainId===options.chainId)&&(!options.search||`${row.symbol} ${row.name} ${row.address}`.toLowerCase().includes(options.search.toLowerCase()))&&(!options.hideSpam||!row.likelySpam));activeSummary=summarize(filtered);activeRows=[...filtered].sort(options.sort==='value'?(a,b)=>b.totalValue-a.totalValue:(a,b)=>b.holderCount-a.holderCount||b.share-a.share||b.totalValue-a.totalValue);return {tokens:activeRows.slice(options.offset,options.offset+options.limit),wallets:[],summary:activeSummary,coverage:{analyzedWalletCount:25,requestedWalletCount:25,reliableWalletCount:25,networks:[{chainId:'base'}]},warnings:[],pagination:{offset:options.offset,limit:options.limit,total:activeSummary.filteredTotal,filteredTotal:activeSummary.filteredTotal,pageRows:Math.min(options.limit,Math.max(0,activeSummary.filteredTotal-options.offset)),nextOffset:options.offset+options.limit<activeSummary.filteredTotal?options.offset+options.limit:null,revision:9},job:app.state.result.job};};
 const {app,get}=harness({pageTokensImpl});app.state.view='wallets';app.state.source='live';app.state.pageSize=10;app.state.result={job:{id:'full-summary',status:'complete',query:{kind:'wallets',addresses:[],chainIds:['base']},tasks:[]},serverPaginated:true,tokens:tokens.slice(0,10),wallets:[],summary:activeSummary,pagination:{offset:0,limit:10,total:25,filteredTotal:25,pageRows:10,revision:9},coverage:{analyzedWalletCount:25,requestedWalletCount:25,reliableWalletCount:25,networks:[{chainId:'base'}]},warnings:[]};
 app.renderResults();const statsPage1=get('stats').innerHTML,insightPage1=get('insight-panel').innerHTML;assert.match(statsPage1,/Agregované tokeny/);assert.match(statsPage1,/25/);assert.match(statsPage1,/USD hodnota výsledků/);assert.match(insightPage1,/T0/);assert.match(insightPage1,/25 držitelů/);assert.match(insightPage1,/Unikátní kontrakty<\/span><strong>25/);
 await app.loadServerTokenPage(2);assert.equal(app.state.result.tokens.length,10);assert.equal(app.state.result.pagination.filteredTotal,25);assert.equal(get('stats').innerHTML,statsPage1,'page 2 keeps all summary cards unchanged');assert.equal(get('insight-panel').innerHTML,insightPage1,'page 2 keeps Shared conviction unchanged');
 await app.loadServerTokenPage(3);assert.equal(app.state.result.tokens.length,5);assert.equal(get('stats').innerHTML,statsPage1,'page 3 keeps full-result metrics unchanged');assert.equal(get('insight-panel').innerHTML,insightPage1);
 get('min-holders').value='19';await app.loadServerTokenPage(1);assert.equal(app.state.result.pagination.filteredTotal,7);assert.match(get('stats').innerHTML,/Agregované tokeny[\s\S]*?<div class="stat-value">7</);assert.match(get('insight-panel').innerHTML,/Unikátní kontrakty<\/span><strong>7/,'filter recalculates summary over seven tokens');
 get('min-holders').value='';get('sort-select').value='value';await app.loadServerTokenPage(1);assert.equal(activeRows[0].symbol,'T12','value sort changes visible row order');assert.equal(app.state.result.summary.topToken.symbol,'T0','summary leader is independent of visible sort');assert.equal(get('stats').innerHTML,statsPage1,'changing sort leaves the summary unchanged');assert.equal(get('insight-panel').innerHTML,insightPage1);
}
{
 const spam={...token,symbol:'FREE',name:'FREE AIRDROP',likelySpam:true,spamReasons:['keyword:free','keyword:airdrop']};
 let query;const pageTokensImpl=async(_id,options)=>{query=options;return {tokens:[],wallets:[],coverage:{},warnings:[],pagination:{total:0,nextOffset:null,revision:1}};};const {app,get}=harness({pageTokensImpl});app.state.result={tokens:[spam,{...token,symbol:'GOOD',name:'Wrapped Ether',likelySpam:false}],wallets:[],coverage:{analyzedWalletCount:1,requestedWalletCount:1},warnings:[]};app.renderResults();
 assert.doesNotMatch(get('table-body').innerHTML,/FREE AIRDROP/,'default local filter hides spam without deleting the raw result');assert.equal(app.state.result.tokens.length,2);
 get('hide-spam').checked=false;app.renderResults();assert.match(get('table-body').innerHTML,/Podezřelý spam/,'turning the filter off reveals spam and its explanation');assert.match(get('table-body').innerHTML,/Podezřelé slovo: free · Podezřelé slovo: airdrop/);
 app.state.result={job:{id:'spam-job'},serverPaginated:true,tokens:[],pagination:{revision:1,total:0},coverage:{},warnings:[]};get('hide-spam').checked=false;await app.loadServerTokenPage(1);assert.equal(query.hideSpam,false,'server page requests carry the explicit filter state');
}
{
 const {app,get}=harness();app.state.result={job:{id:'quality-warning',status:'complete_with_warnings',query:{kind:'wallets',addresses:[A,B],chainIds:['base']},quality:{invalidRows:7},progress:{completedTasks:2,totalTasks:2},tasks:[]},serverPaginated:true,tokens:[{...token,holderCount:1,analyzedWalletCount:1,completedWalletCount:2,requestedWalletCount:2,warningWalletCount:1,share:1,totalValue:5,unpricedPositions:0}],wallets:[],pagination:{revision:1,total:1},coverage:{analyzedWalletCount:2,requestedWalletCount:2,reliableWalletCount:1,complete:true},warnings:['Stránkování dokončeno, ale data obsahují warning.']};app.renderResults();
 assert.match(app.scanRow(app.state.result.job),/Dokončeno s upozorněním/,'scan history labels completed data with warnings separately from partial scans');assert.match(get('scan-live-status').innerHTML,/Stránkování dokončeno s upozorněním/);assert.match(get('results-subtitle').textContent,/Coverage 2 \/ 2 dokončených wallets.*popularita používá pouze spolehlivé/);assert.match(get('table-body').innerHTML,/1 \/ 1/);assert.match(get('table-body').innerHTML,/Coverage 2\/2 · 1 s upozorněním/,'token row explains its reliable denominator alongside completed coverage');
}
{
 const {app,get,requests}=harness();get('wallet-addresses').value=`${ZERO}\n${B}`;
 const mixed=app.run();assert.equal(requests.length,1);assert.deepEqual(Array.from(requests[0].options.addresses),[B]);requests[0].resolve({wallets:[],tokens:[],warnings:[]});await mixed;
 assert.match(app.state.result.warnings[0],/Systémová burn\/dead adresa \(zero address nebo dead address\) byla přeskočena/);
 get('wallet-addresses').value=ZERO;const allSystem=app.run();assert.equal(requests.length,1,'a zero-only input never calls the portfolio API');assert.match(get('query-error').textContent,/Systémovou burn\/dead adresu nelze analyzovat/);await allSystem;
}
{
 const priced={...token,symbol:'PRICED',name:'Priced token',address:A,chainId:'base',holderCount:2,analyzedWalletCount:3,reliableWalletCount:3,share:2/3,amount:8,totalValue:24,unpricedPositions:0,warningWalletCount:1};
 const unpriced={...token,symbol:'UNKNOWN',name:'Unknown price token',address:B,chainId:'base',holderCount:1,analyzedWalletCount:3,reliableWalletCount:3,share:1/3,amount:12,totalValue:null,unpricedPositions:1,warningWalletCount:0};
 const pages=[];const pageTokensImpl=async(_id,options)=>{pages.push(options);return {tokens:[priced,unpriced],pagination:{filteredTotal:2},coverage:{provenance:[{chainId:'base',provider:'blockscout',providerProvidedData:true,providerAttempts:[{provider:'alchemy',status:'retryable_failure'},{provider:'blockscout',status:'success'}]}]}};};
 const {app,csvBlobs}=harness({pageTokensImpl});app.state.view='wallets';app.state.source='live';app.state.rows=[priced];app.state.result={job:{id:'csv-scan',status:'complete_with_warnings'},serverPaginated:true,pagination:{filteredTotal:2,revision:7},coverage:{provenance:[{chainId:'base',provider:'blockscout',providerProvidedData:true,providerAttempts:[{provider:'alchemy',status:'retryable_failure'},{provider:'blockscout',status:'success'}]}]}};
 await app.exportCSV();assert.deepEqual(pages.map(page=>page.offset),[0],'CSV requests the entire filtered result from server pagination');assert.equal(csvBlobs.length,1);const csv=csvBlobs[0].parts[0];assert.match(csv,/"symbol","token_name","contract","network","holder_count","reliable_wallet_count","share","amount","known_usd_value","unpriced_positions","provider","provider_provenance","data_quality","scan_status","source","coverage"/);assert.match(csv,/"UNKNOWN","Unknown price token","0x2222[^,]*","base","1","3","0\.3333333333333333","12","","1","Blockscout REST v2","Alchemy \(retryable_failure\) → Blockscout REST v2 \(success\)","reliable","complete_with_warnings"/,'unknown USD is empty rather than zero and the reliable denominator/provenance use canonical result fields');assert.match(csv,/"PRICED","Priced token"[^\r\n]*"0","Blockscout REST v2","Alchemy \(retryable_failure\) → Blockscout REST v2 \(success\)","warning"/,'known unpriced position count and warning quality are exported');assert.doesNotMatch(csv,/undefined|null/,'CSV does not serialize absent result properties as JavaScript sentinel strings');
}
{
 const {app,get}=harness();app.state.view='wallets';app.state.source='live';app.state.rows=[{...token,holderCount:1,analyzedWalletCount:1,share:1,totalValue:1,unpricedPositions:0}];app.state.result={job:{status:'complete'},tokens:app.state.rows,wallets:[],warnings:[],coverage:{providerLabel:'Blockscout',provenance:[{chainId:'base',provider:'blockscout',providerProvidedData:true,providerProvenanceComplete:true,fallbackUsed:true,fallbackFrom:'alchemy',fallbackReason:'Alchemy rate limit.',lastSuccessAt:'2026-10-16T12:00:00.000Z',status:'complete',providerAttempts:[{provider:'alchemy',status:'retryable_failure'},{provider:'blockscout',status:'success'}]}]}};app.renderResults();assert.match(get('provider-provenance').innerHTML,/Alchemy · chyba → Blockscout REST v2 · data/,'provider panel presents the actual primary failure followed by the successful fallback');assert.match(get('provider-provenance').innerHTML,/Data poskytl Blockscout REST v2/);assert.equal(get('scan-notice').hidden,true,'successful fallback information is not presented as a data-quality warning banner');
}
