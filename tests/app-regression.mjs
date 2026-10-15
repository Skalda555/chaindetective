import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// A small DOM boundary stub exercises request and persistence logic; visual QA
// runs in a browser. Requests deliberately ignore abort to model late providers.
const source = (await readFile(new URL('../dist/app.js', import.meta.url), 'utf8'))
  .replace(/^import \* as data from '\.\/data\.js';\s*/, '')
  .replace("import {initSmartWallets} from './smart-wallets.js';",'')
  .replace("import {initSocials} from './socials.js';",'')
  .replace(/renderTokens\(\);renderChains\(\);renderResults\(\);(?:refreshProviders\(\);)?run\(\);\s*$/, '');
const indexHtml=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const styleCss=await readFile(new URL('../dist/style.css',import.meta.url),'utf8');
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

function harness({confirmImpl=()=>true,deleteImpl,listImpl,getScanImpl,pageTokensImpl,readResultImpl,pauseImpl,timerImpl,useRealConfirmation=false,smartRecords=[]}={}) {
  const elements = new Map(), events = new Map(), requests = [], storage = new Map(),pickerCalls=[];
  const globalDialogs = ['token-dialog','smart-dialog'].map(id=>{const listeners=new Map();return {id,open:true,closeCount:0,addEventListener(type,listener){listeners.set(type,listener);},getBoundingClientRect(){return {left:100,right:500,top:100,bottom:400};},close(){this.open=false;this.closeCount++;},emit(type,init={}){listeners.get(type)?.({target:this,...init});}};});
  const document = {
    activeElement: null,
    getElementById(id) {
      if (!elements.has(id)) {
        const listeners = new Map();
        elements.set(id, {
          id, value: id === 'sort-select' ? 'value' : '', checked:id==='hide-spam', hidden: true,
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
    addEventListener(type, listener) { events.set(type, listener); },
  };
  const request = options => new Promise(resolve => requests.push({ options, resolve }));
  const context = vm.createContext({
    document, AbortController, Intl, Blob, URL,initSocials:()=>({show(){}}),initSmartWallets:()=>({show(){},pick:options=>pickerCalls.push(options),add(){},lookup:address=>smartRecords.find(w=>w.address.toLowerCase()===String(address).toLowerCase())||null}),
    setTimeout(fn,ms) { return timerImpl?timerImpl(fn,ms):0; }, clearTimeout() {},
    confirm:confirmImpl,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    data: { NETWORKS: [{ id: 'base', name: 'Base', live:true, explorer: 'https://base.blockscout.com' }],debankProfileUrl:address=>/^0x[0-9a-fA-F]{40}$/.test(address)?`https://debank.com/profile/${address}`:null,isSystemWalletAddress:address=>String(address).toLowerCase()===ZERO,
      TOKENS: [token],MAX_WALLET_SCAN:500, DEMO_WALLETS: [{ address: A, holdings: [{...token,tokenId:token.id,amount:1}] }], searchHolders: request, analyzeWallets: request,
      ...(deleteImpl?{deleteServerScan:deleteImpl}:{}),...(listImpl?{listServerScans:listImpl}:{}),...(getScanImpl?{getServerScan:getScanImpl}:{}),...(readResultImpl?{readServerScanResult:readResultImpl}:{}),...(pauseImpl?{pauseServerScan:pauseImpl}:{}) },
  });
  if(pageTokensImpl)context.data.getServerTokenPage=pageTokensImpl;
  vm.runInContext(source + (useRealConfirmation?'':'\nconfirmScanDeletion=()=>confirm();') + '\nglobalThis.app = {state, run, setSource, setView, normalizeWallet, saveSearch, savedQueries, savedWallets, currentRows, toggleBookmark, renderResults, addCustomToken,changeProvider,renderProviderStatus,deleteBackendScan,refreshServerScans,renderBackendScan,renderServerScanPanels,scanRow,openBackendScan,openLiveBackendScan,pauseBackendScan,confirmScanDeletion,prepareWalletAnalysis,renderWalletInputContext,analysisAddresses,manualAddresses,loadServerTokenPage,openWallet};', context);
  const app = context.app, get = id => document.getElementById(id);
  Object.assign(app.state, { view: 'wallets', source: 'live', chainIds: ['base'], selectedTokens: [{ ...token }] });
  get('wallet-addresses').value = A;
  const clickQuery = id => events.get('click')({ target: { closest: () => ({ dataset: { loadQuery: String(id) } }) } });
  return { app, get, requests, clickQuery, globalDialogs,pickerCalls };
}

// The global backdrop handler keeps ordinary modal behavior while explicitly exempting smart-dialog.
{
 const {globalDialogs}=harness(),[ordinary,smart]=globalDialogs;
 ordinary.emit('click',{clientX:50,clientY:250});assert.equal(ordinary.open,false);assert.equal(ordinary.closeCount,1,'ordinary dialogs still close on outside click');
 smart.emit('click',{clientX:50,clientY:250});assert.equal(smart.open,true);assert.equal(smart.closeCount,0,'smart-dialog ignores the global backdrop close handler');
 smart.emit('click',{clientX:250,clientY:250});assert.equal(smart.open,true,'clicks inside smart-dialog leave it open');
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
 let resolveOpen;const {app,get}=harness({deleteImpl:async()=>{},getScanImpl:()=>new Promise(r=>{resolveOpen=r;})});
 const opening=app.openBackendScan('late');await app.deleteBackendScan('late');resolveOpen({id:'late',query:{kind:'holders'}});await opening;assert.notEqual(app.state.backendJob?.id,'late');assert.equal(get('active-server-scan').innerHTML,'');
}
{
 const {app}=harness();const job={id:'fixture',status:'running',query:{kind:'holders'},tasks:[],pages:0,positions:0,updatedAt:new Date().toISOString()};assert.match(app.scanRow(job),/data-delete-scan="fixture"[^>]*disabled/);assert.doesNotMatch(app.scanRow({...job,status:'paused'}),/data-delete-scan="fixture"[^>]*disabled/);
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
 const scans=[{id:'running',status:'running',query:{kind:'wallets',addresses:[A]},tasks:[],progress:{completedTasks:1,totalTasks:3},updatedAt:'2026-10-15T10:00:00Z',pages:1,positions:2,message:'Running scan'},{id:'paused',status:'paused',query:{kind:'wallets',addresses:[B]},tasks:[],updatedAt:'2026-10-14T10:00:00Z',pages:1,positions:1,message:'Paused'},{id:'done',status:'complete',query:{kind:'wallets',addresses:[A]},tasks:[],updatedAt:'2026-10-13T10:00:00Z',pages:2,positions:4,message:'Done'}];let pauses=0;
 const {app,get}=harness({listImpl:async()=>({scans}),pauseImpl:async()=>{pauses++;}});app.state.backendJob=scans[0];app.state.smartDatasetAddresses=new Set([A]);get('wallet-addresses').value=B;app.state.result={job:scans[0],tokens:[],wallets:[]};
 await app.refreshServerScans();assert.equal(get('server-scan-history').hidden,true);assert.match(get('active-server-scan').innerHTML,/Zobrazit průběžné výsledky/);assert.match(get('active-server-scan').innerHTML,/Pozastavit/);assert.equal(get('server-scan-history-count').textContent,'3');assert.equal(pauses,0);
 get('server-scan-history-toggle').onclick();assert.equal(get('server-scan-history').hidden,false);assert.match(get('server-scan-history').innerHTML,/Otevřít výsledek/);assert.equal(get('active-server-scan').innerHTML.includes('Pozastavit'),true);assert.equal(app.analysisAddresses().length,2);assert.equal(app.state.result.job.id,'running');assert.equal(pauses,0,'toggling history never pauses or resets the scan');
}
{
 let options;const pageTokensImpl=async(_id,query)=>{options=query;return {tokens:[{...token,holderCount:100,analyzedWalletCount:200,share:.5,totalValue:40}],wallets:[],coverage:{analyzedWalletCount:200,requestedWalletCount:214,networks:[]},warnings:[],pagination:{offset:query.offset,limit:query.limit,total:17,nextOffset:null,revision:9},job:{id:'large-job'}};};
 const {app,get}=harness({pageTokensImpl});app.state.result={job:{id:'large-job'},serverPaginated:true,tokens:[{...token}],wallets:[],pagination:{revision:9,total:17},coverage:{analyzedWalletCount:200,requestedWalletCount:214},warnings:[]};
 get('result-search').value='SHARED';get('min-holders').value='20';get('min-share').value='50';get('result-network').value='base';get('sort-select').value='holders';await app.loadServerTokenPage(2);
 assert.deepEqual(JSON.parse(JSON.stringify(options)),{offset:8,limit:8,revision:9,sort:'holders',minHolders:'20',minShare:'50',chainId:'base',search:'SHARED',hideSpam:true});assert.equal(app.state.page,2);assert.equal(app.state.result.tokens[0].analyzedWalletCount,200);assert.equal(app.state.result.pagination.total,17);
}
{
 const spam={...token,symbol:'FREE',name:'FREE AIRDROP',likelySpam:true,spamReasons:['keyword:free','keyword:airdrop']};
 let query;const pageTokensImpl=async(_id,options)=>{query=options;return {tokens:[],wallets:[],coverage:{},warnings:[],pagination:{total:0,nextOffset:null,revision:1}};};const {app,get}=harness({pageTokensImpl});app.state.result={tokens:[spam,{...token,symbol:'GOOD',name:'Wrapped Ether',likelySpam:false}],wallets:[],coverage:{analyzedWalletCount:1,requestedWalletCount:1},warnings:[]};app.renderResults();
 assert.doesNotMatch(get('table-body').innerHTML,/FREE AIRDROP/,'default local filter hides spam without deleting the raw result');assert.equal(app.state.result.tokens.length,2);
 get('hide-spam').checked=false;app.renderResults();assert.match(get('table-body').innerHTML,/Podezřelý spam/,'turning the filter off reveals spam and its explanation');assert.match(get('table-body').innerHTML,/Podezřelé slovo: free · Podezřelé slovo: airdrop/);
 app.state.result={job:{id:'spam-job'},serverPaginated:true,tokens:[],pagination:{revision:1,total:0},coverage:{},warnings:[]};get('hide-spam').checked=false;await app.loadServerTokenPage(1);assert.equal(query.hideSpam,false,'server page requests carry the explicit filter state');
}
{
 const {app,get,requests}=harness();get('wallet-addresses').value=`${ZERO}\n${B}`;
 const mixed=app.run();assert.equal(requests.length,1);assert.deepEqual(Array.from(requests[0].options.addresses),[B]);requests[0].resolve({wallets:[],tokens:[],warnings:[]});await mixed;
 assert.match(app.state.result.warnings[0],/Neplatná systémová adresa \(zero address\) byla přeskočena/);
 get('wallet-addresses').value=ZERO;const allSystem=app.run();assert.equal(requests.length,1,'a zero-only input never calls the portfolio API');assert.match(get('query-error').textContent,/Neplatná systémová adresa.*zero address/);await allSystem;
}
