import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ScanEngine} from '../server/scans.mjs';
import {DashboardService,AixbtService} from '../server/dashboard.mjs';
import {MoniService} from '../server/moni.mjs';
import {createApp} from '../server.mjs';
import {resolveAixbtTopicText} from '../dist/data.js';

const A='0x1111111111111111111111111111111111111111',B='0x2222222222222222222222222222222222222222',TOKEN='0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const jsonResponse=(data,status=200)=>({ok:status===200,status,json:async()=>data});
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const moniCacheHandle=filters=>`projects-v3|${createHash('sha256').update(JSON.stringify(stable({version:'projects-v3',chainScope:'all',...filters}))).digest('hex')}`;
const db=new DatabaseSync(':memory:');const engine=new ScanEngine({filename:':memory:'});const moni=new MoniService(db,{apiKey:'',intervalMs:0});
const dashboard=new DashboardService({store:engine.store,engine,moni});
try{
 const store=engine.store,now='2026-10-15T12:00:00.000Z';
 const walletQuery={kind:'wallets',chainIds:['base'],match:'all',addresses:[A,B],walletMetadata:[{address:A,name:'Group member',tags:['Alpha'],status:'reviewed'}]};
 const walletId='11111111-1111-4111-8111-111111111111';
 store.db.prepare('INSERT INTO scans(id,query_key,query_json,status,created_at,updated_at,finished_at,runtime_ms) VALUES(?,?,?,?,?,?,?,?)').run(walletId,'wallet-key',JSON.stringify(walletQuery),'complete_with_warnings',now,now,now,45000);
 store.db.prepare('INSERT INTO tasks(scan_id,task_key,kind,chain_id,address,status,invalid_rows,provider,as_of) VALUES(?,?,?,?,?,?,?,?,?)').run(walletId,`base:${A}`,'wallets','base',A,'complete',0,'alchemy',now);
 store.db.prepare('INSERT INTO tasks(scan_id,task_key,kind,chain_id,address,status,invalid_rows,provider,as_of) VALUES(?,?,?,?,?,?,?,?,?)').run(walletId,`base:${B}`,'wallets','base',B,'complete',1,'alchemy',now);
 const walletHolding={id:`base:${TOKEN}`,tokenId:`base:${TOKEN}`,address:TOKEN,chainId:'base',symbol:'ALPHA',name:'Alpha Token',decimals:18,amount:5,value:25};
 store.db.prepare('INSERT INTO positions(scan_id,task_key,owner,token_id,holding) VALUES(?,?,?,?,?)').run(walletId,`base:${A}`,A,walletHolding.tokenId,JSON.stringify(walletHolding));
 store.db.prepare('INSERT INTO positions(scan_id,task_key,owner,token_id,holding) VALUES(?,?,?,?,?)').run(walletId,`base:${B}`,B,walletHolding.tokenId,JSON.stringify(walletHolding));
 const holderId='22222222-2222-4222-8222-222222222222',holderQuery={kind:'holders',chainIds:['base'],match:'all',tokens:[{chainId:'base',address:TOKEN}],holderCap:20000};
 store.db.prepare('INSERT INTO scans(id,query_key,query_json,status,created_at,updated_at,finished_at,runtime_ms) VALUES(?,?,?,?,?,?,?,?)').run(holderId,'holder-key',JSON.stringify(holderQuery),'complete',now,now,now,12000);
 const metadata={id:`base:${TOKEN}`,chainId:'base',address:TOKEN,symbol:'ALPHA',name:'Alpha Token',decimals:18};
 store.db.prepare('INSERT INTO tasks(scan_id,task_key,kind,chain_id,address,status,metadata,provider,as_of) VALUES(?,?,?,?,?,?,?,?,?)').run(holderId,`base:${TOKEN}`,'holders','base',TOKEN,'complete',JSON.stringify(metadata),'blockscout',now);
 for(const owner of [A,B])store.db.prepare('INSERT INTO positions(scan_id,task_key,owner,token_id,holding) VALUES(?,?,?,?,?)').run(holderId,`base:${TOKEN}`,owner,metadata.id,JSON.stringify({...walletHolding,tokenId:metadata.id}));
 const overview=dashboard.overview();assert.equal(overview.walletAnalysis.scan.id,walletId);assert.equal(overview.walletAnalysis.scan.status,'complete_with_warnings');assert.equal(overview.walletAnalysis.scan.lastSuccessAt,now,'dashboard data freshness comes from last successful task data');assert.equal(overview.walletAnalysis.scan.lastAttemptAt,null,'legacy tasks without attempt timestamps do not invent one');assert.equal(overview.walletAnalysis.coverage.successful,2);assert.equal(overview.walletAnalysis.coverage.perNetwork[0].reliable,1);assert.equal(overview.walletAnalysis.coverage.perNetwork[0].warnings,1);assert.equal(overview.walletAnalysis.tokens[0].holderCount,1,'warning task holdings are not counted toward the popularity numerator');assert.equal(overview.walletAnalysis.tokens[0].analyzedWalletCount,1,'dashboard popularity denominator includes only reliable wallet/network tasks');assert.equal(overview.walletAnalysis.tokens[0].share,1);assert.equal(overview.walletAnalysis.quality.warningTasks,1);assert.equal(overview.walletAnalysis.quality.invalidRows,1,'data quality is visible separately from wallet coverage');assert.ok(!JSON.stringify(overview).includes(A),'dashboard summaries never serialize wallet address datasets');
  assert.equal(overview.correlations[0].id,holderId);assert.equal(overview.correlations[0].resultCount,2);assert.equal(overview.correlations[0].tokens[0].symbol,'ALPHA');
 assert.equal(overview.moni.watchlistCount,0);assert.deepEqual(overview.moni.accounts,[],'Moni dashboard data is empty without a watchlist');
}finally{await engine.close();await moni.close();db.close();}

{
 let calls=0,now=1000,fail=false,empty=false;const service=new AixbtService({now:()=>now,ttlMs:900000,fetchImpl:async url=>{calls++;assert.equal(url.origin,'https://api.aixbt.tech');assert.equal(url.pathname,'/v3/topics');if(fail)throw new Error('offline');if(empty)return jsonResponse({data:[],meta:{}});return jsonResponse({data:Array.from({length:25},(_,i)=>({id:`topic-${i}`,rank:i+1,name:`Topic ${i+1}`,trend:70,summary:'Brief context',postCount:12,authorCount:5,lastSeenAt:'2026-10-15T09:00:00Z'})),meta:{snapshot:{completedAt:'2026-10-15T10:00:00Z'}}});}});
 const limited=await service.topics(6);assert.equal(limited.items.length,6,'requested limit is honored for the caller');const first=await service.topics(25);assert.equal(first.available,true);assert.equal(first.items.length,25,'a prior limited request does not poison the shared topics cache');assert.equal(first.items[0].rank,1);assert.equal(first.snapshot.completedAt,'2026-10-15T10:00:00Z');
 const cached=await service.topics();assert.equal(cached.cached,true);assert.equal(calls,1,'15 minute cache avoids repeat AIXBT requests');
 now+=900001;empty=true;const preserved=await service.topics();assert.equal(preserved.available,true);assert.equal(preserved.stale,true);assert.equal(preserved.items.length,25,'an empty response does not overwrite the last good topics cache');assert.equal(calls,2,'expired cache is attempted once before stale fallback');
 fail=true;const stale=await service.topics();assert.equal(stale.available,true);assert.equal(stale.stale,true);assert.equal(stale.items.length,25);assert.equal(calls,3,'expired cache is attempted once before stale fallback');
}
{
 const translated=resolveAixbtTopicText({name:'Original',summary:'Original summary',translations:{cz:{name:'Překlad',summary:'Přeložené shrnutí'}}},'cz');assert.deepEqual(translated,{name:'Překlad',summary:'Přeložené shrnutí',translated:true},'provided cached Czech translations are selected');
 const fallback=resolveAixbtTopicText({name:'Original',summary:'English summary'},'cz');assert.deepEqual(fallback,{name:'Original',summary:'English summary',translated:false},'English source content remains the fallback without a translation service');
}
{
 const timeoutService=new AixbtService({fetchImpl:async()=>{const error=new Error('timed out');error.name='TimeoutError';throw error;}});const result=await timeoutService.topics();assert.equal(result.available,false);assert.match(result.error,/včas/);
 const service=new AixbtService({fetchImpl:async url=>url.pathname.endsWith('/projects')?jsonResponse({data:{items:[{id:'p1',name:'Protocol',observedPosts:4}]}}):jsonResponse({data:{id:'topic-1',name:'Topic detail',summary:'  Detail  ',url:'http://unsafe.example',sourceUrl:'https://aixbt.tech/rankings?entity=topics&topic=topic-1'}})});const detail=await service.topic('topic-1');assert.equal(detail.topic.name,'Topic detail');assert.equal(detail.topic.summary,'Detail','whitespace-only padding is removed from detail summaries');assert.equal(detail.topic.url,'https://aixbt.tech/rankings?entity=topics&topic=topic-1','the first usable HTTPS source URL is preserved');assert.equal(detail.projects[0].name,'Protocol');
 const noSafeUrl=new AixbtService({fetchImpl:async()=>jsonResponse({id:'topic-2',name:'No link',summary:'',url:'javascript:alert(1)'})});const absent=await noSafeUrl.topic('topic-2');assert.equal(absent.topic.url,null,'unsafe external protocols are discarded');
}

{
 let calls=0;const app=createApp({dbPath:':memory:',moniOptions:{apiKey:'',intervalMs:0},aixbtOptions:{fetchImpl:async url=>{calls++;if(url.pathname==='/v3/topics')return jsonResponse({data:[{id:'a',rank:1,name:'A'}],meta:{}});if(url.pathname.endsWith('/projects'))return jsonResponse({items:[]});return jsonResponse({id:'a',name:'A detail'});}}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${app.server.address().port}`;
 try{const data=await fetch(origin+'/api/dashboard').then(response=>response.json());assert.equal(data.walletAnalysis,null);assert.deepEqual(data.correlations,[]);assert.equal(app.scans.store.db.prepare('SELECT COUNT(*) AS n FROM scans').get().n,0,'opening dashboard creates no blockchain scan');const topics=await fetch(origin+'/api/dashboard/topics').then(response=>response.json());assert.equal(topics.items[0].name,'A');assert.equal(calls,1);const detail=await fetch(origin+'/api/dashboard/topics/a').then(response=>response.json());assert.equal(detail.available,true);assert.equal(calls,3,'topic detail and linked-project lookup use keyless endpoints');}finally{await app.close();}
}

{
 const ttl=6*60*60*1000,now=Date.parse('2026-10-16T08:50:00.000Z'),key='dashboard-moni-cache-first-key';let moniCalls=0,aixbtCalls=0,fail=true;
 const app=createApp({dbPath:':memory:',moniOptions:{apiKey:key,now:()=>now,intervalMs:0,fetchImpl:async()=>{moniCalls++;if(fail)throw new Error('fixture offline');return jsonResponse({items:[]});}},aixbtOptions:{now:()=>now,fetchImpl:async()=>{aixbtCalls++;return jsonResponse({topics:[]});}}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${app.server.address().port}`,scope=createHash('sha256').update(key).digest('hex').slice(0,16),fetchedAt=now-30_000;
 const items=Array.from({length:8},(_,index)=>({handle:`project${index+1}`,url:`https://x.com/project${index+1}`,score:1405-index*100,categories:index===0?['NFT']:['Tools'],chains:index===0?['Ethereum']:['Base']})),filters={endpointMode:'curated',feedTimeframe:'D7',changesTimeframe:'H24',orderBy:'SCORE_CHANGE',orderByDirection:'DESC',limit:10,offset:0},identity=moniCacheHandle(filters);
 app.scans.store.db.prepare('INSERT INTO moni_cache(scope,handle,part,payload,fetched_at) VALUES(?,?,?,?,?)').run(scope,identity,'projects',JSON.stringify({items,limit:10,periodDays:7}),fetchedAt);
 try{
  const first=await fetch(origin+'/api/dashboard').then(response=>response.json()),again=await fetch(origin+'/api/dashboard').then(response=>response.json()),feed=first.moni.trending;
  assert.equal(moniCalls,0,'fresh dashboard cache avoids a Moni request');assert.equal(app.moni.status().estimatedPoints,0,'fresh dashboard cache consumes no Moni points');assert.equal(feed.filter,'all');assert.equal(feed.items.length,8,'the dashboard preserves cached feed order');assert.deepEqual(feed.items.map(item=>item.handle),items.map(item=>item.handle));assert.equal(feed.items[0].score,1405);assert.deepEqual(feed.items[0].categories,['NFT']);assert.deepEqual(feed.items[0].chains,['Ethereum']);assert.equal(feed.fetchedAt,new Date(fetchedAt).toISOString());assert.equal(feed.stale,false);assert.deepEqual(again.moni.trending.items.map(item=>item.handle),items.map(item=>item.handle));assert.equal(moniCalls,0,'reload during TTL uses fresh cache');assert.equal(aixbtCalls,0);
  app.scans.store.db.prepare('UPDATE moni_cache SET fetched_at=? WHERE scope=? AND handle=? AND part=\'projects\'').run(now-ttl-1,scope,identity);const stale=(await fetch(origin+'/api/dashboard').then(response=>response.json())).moni.trending;assert.equal(stale.stale,true,'stale cache is returned before refresh');assert.equal(stale.items.length,8,'stale projects remain displayable');assert.equal(stale.refreshing,true);await new Promise(resolve=>setTimeout(resolve,5));assert.equal(moniCalls,1,'expired cache triggers one bounded background refresh');const failed=(await fetch(origin+'/api/dashboard').then(response=>response.json())).moni.trending;assert.match(failed.refreshError,/Automatická obnova/);assert.equal(failed.items.length,8,'failed refresh preserves stale cache');
 }finally{await app.close();}
}

{
 const key='dashboard-moni-empty-cache-key';let moniCalls=0;
 const app=createApp({dbPath:':memory:',moniOptions:{apiKey:key,intervalMs:0,fetchImpl:async()=>{moniCalls++;throw new Error('fixture offline');}},aixbtOptions:{fetchImpl:async()=>jsonResponse({topics:[]})}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${app.server.address().port}`;
 try{const empty=(await fetch(origin+'/api/dashboard').then(response=>response.json())).moni.trending;assert.deepEqual(empty.items,[]);assert.equal(empty.fetchedAt,null);assert.match(empty.refreshError,/Moni neodpovědělo/);assert.equal(moniCalls,1,'missing cache attempts one automatic request and reports failure');}finally{await app.close();}
}

{
 const key='dashboard-moni-view-cache-key',now=Date.parse('2026-10-16T10:00:00.000Z');let moniCalls=0,requestUrl=null;
 const app=createApp({dbPath:':memory:',moniOptions:{apiKey:key,now:()=>now,budget:20,intervalMs:0,fetchImpl:async url=>{moniCalls++;requestUrl=url;return jsonResponse({items:[1,2,3].map(i=>({meta:{userUrl:`https://x.com/loaded${i}`},smartEngagement:{moniScore:100+i,smartMentionsCountChange:i*2},smartProfile:{projectTags:[{name:'DeFi'}],chains:[{name:'Base'}]}}))});}},aixbtOptions:{fetchImpl:async()=>jsonResponse({topics:[]})}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${app.server.address().port}`,scope=createHash('sha256').update(key).digest('hex').slice(0,16),growing={endpointMode:'curated',feedTimeframe:'D7',changesTimeframe:'H24',orderBy:'SCORE_CHANGE',orderByDirection:'DESC',limit:10,offset:0},top={...growing,orderBy:'SCORE'},newest={...growing,orderBy:'CREATED_AT'},saved=handle=>({items:[{handle,score:875,scoreChange:null,categories:['NFT'],chains:['Ethereum']}],filters:top,limit:10});
 app.scans.store.db.prepare('INSERT INTO moni_cache(scope,handle,part,payload,fetched_at) VALUES(?,?,?,?,?)').run(scope,moniCacheHandle(growing),'projects',JSON.stringify(saved('growing-cache')),now-60_000);
 app.scans.store.db.prepare('INSERT INTO moni_cache(scope,handle,part,payload,fetched_at) VALUES(?,?,?,?,?)').run(scope,moniCacheHandle(top),'projects',JSON.stringify(saved('top-cache')),now-60_000);
 try{
  const defaultFeed=(await fetch(origin+'/api/dashboard').then(r=>r.json())).moni.trending;assert.equal(defaultFeed.items[0].handle,'growing-cache');assert.equal(moniCalls,0,'default Growing view is served from fresh cache');
  const otherFeed=(await fetch(origin+'/api/dashboard?view=top').then(r=>r.json())).moni.trending;assert.equal(otherFeed.items[0].handle,'top-cache');assert.equal(otherFeed.filters.orderBy,'SCORE');assert.equal(moniCalls,0,'switching to another fresh view costs zero');
  const loaded=(await fetch(origin+'/api/dashboard?view=new').then(r=>r.json())).moni.trending;assert.equal(loaded.items.length,3);assert.equal(loaded.items[0].score,101);assert.equal(loaded.items[0].scoreChange,null,'no Moni Score change is fabricated');assert.equal(requestUrl.pathname,'/api/v3/projects/');for(const [key,value] of Object.entries({limit:'10',offset:'0',feedTimeframe:'D7',changesTimeframe:'H24',orderBy:'CREATED_AT',orderByDirection:'DESC'}))assert.equal(requestUrl.searchParams.get(key),value,`new-view request sends ${key}`);assert.equal(moniCalls,1);assert.equal(app.moni.status().estimatedPoints,3,'only returned projects are charged');assert.ok(app.scans.store.db.prepare('SELECT 1 FROM moni_cache WHERE scope=? AND handle=? AND part=\'projects\'').get(scope,moniCacheHandle(newest)),'auto refresh stores the selected canonical query');
  const afterLoad=(await fetch(origin+'/api/dashboard?view=new').then(r=>r.json())).moni.trending;assert.equal(afterLoad.items[0].handle,'loaded1');assert.equal(moniCalls,1,'reload within TTL reuses fresh cache');
  const loadedManually=await fetch(origin+'/api/dashboard/moni/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filters:top})}).then(r=>r.json());assert.equal(loadedManually.items[0].handle,'loaded1');assert.equal(moniCalls,2,'explicit refresh can bypass the dashboard TTL');
 }finally{await app.close();}
}

{
 const source=await (await import('node:fs/promises')).readFile(new URL('../dist/style.css',import.meta.url),'utf8');
 const htmlSource=await (await import('node:fs/promises')).readFile(new URL('../dist/index.html',import.meta.url),'utf8');
 const appSource=await (await import('node:fs/promises')).readFile(new URL('../dist/app.js',import.meta.url),'utf8');
 const dataSource=await (await import('node:fs/promises')).readFile(new URL('../dist/data.js',import.meta.url),'utf8');
 assert.match(source,/\.dashboard-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,'desktop dashboard uses a compact two-column grid');
 assert.match(source,/\.dashboard-grid\{[^}]*align-items:stretch/,'desktop dashboard grid stretches peer cards to equal row height');
 assert.match(source,/\.dashboard-wallets-panel\{overflow:visible;max-height:none\}/,'wallet card keeps natural height and does not scroll or clip its content');
 assert.match(source,/\.dashboard-aixbt-panel\{[^}]*display:flex;flex-direction:column/,'AIXBT card keeps its header above the list in a column layout');
  assert.match(source,/\.dashboard-aixbt-list\{[^}]*flex:1;min-height:0;[^}]*overflow-y:auto;overflow-x:hidden/,'AIXBT topics scroll vertically without horizontal overflow');
 assert.ok(source.includes('@media(max-width:980px){.dashboard-grid{grid-template-columns:minmax(0,1fr)}.dashboard-grid>.dashboard-moni{grid-column:auto}.dashboard-aixbt-panel{max-height:none}.dashboard-aixbt-panel>.dashboard-panel-heading{flex:0 0 auto}.dashboard-aixbt-list{contain:none}}'),'internal dashboard cards stack responsively');
 assert.match(appSource,/payload\.items\?\.length\?payload\.items\.map\(topic/,'AIXBT renderer renders every returned topic without a six-row cap');
 assert.match(dataSource,/getDashboardTopics=\(\)=>dashboardApi\('\/topics\?limit=25'\)/,'dashboard requests all 25 AIXBT topics');
  assert.match(source,/\.dashboard-topic-rank\{[^}]*font:11px/,'topic rank typography is increased about 10 percent');
  assert.match(source,/\.dashboard-topic-copy strong\{font-size:13px/,'topic titles are increased about 10 percent');
  assert.match(source,/\.dashboard-topic-copy small\{font-size:11px/,'topic previews are increased about 10 percent');
  assert.match(source,/\.dashboard-topic-metrics\{[^}]*font:12px/,'topic trend metrics are increased about 10 percent');
  assert.match(source,/\.dashboard-topic-metrics small\{display:block;margin-top:3px;font:10px/,'topic metadata is increased about 10 percent');
  assert.match(source,/\.dashboard-aixbt-panel\{[^}]*overflow-x:hidden/,'AIXBT card clips horizontal overflow');
  assert.match(source,/\.dashboard-topic-metrics small\{[^}]*white-space:normal;overflow-wrap:anywhere/,'narrow metric labels can wrap without widening the card');
  assert.match(source,/\.dashboard-aixbt-list\{scrollbar-width:thin/,'AIXBT scrollbar uses a thin dark-theme style');
  assert.match(htmlSource,/<h2><a class="dashboard-aixbt-title-link" href="https:\/\/aixbt\.tech\/rankings\?entity=topics" target="_blank" rel="noopener noreferrer"[^>]*>Trending · AIXBT<span class="dashboard-aixbt-title-external"/,'the full AIXBT heading is a safe external link to topic rankings');
  assert.match(source,/\.dashboard-aixbt-title-link:hover[^}]*text-decoration:underline/,'AIXBT title link has a subtle hover affordance');
  assert.match(htmlSource,/<div class="dashboard-aixbt-language"[^>]*><button type="button" data-aixbt-language="cz" aria-pressed="true">CZ<\/button><button type="button" data-aixbt-language="en" aria-pressed="false">EN<\/button><\/div>/,'the language switch defaults to Czech in the existing AIXBT header');
  assert.match(htmlSource,/dashboard-aixbt-header-meta/,'language switch shares the freshness metadata row instead of adding a new header row');
  assert.match(appSource,/AIXBT_LANGUAGE_KEY='cd:aixbt-language'/,'AIXBT language preference has a stable localStorage key');
  assert.match(appSource,/savedAixbtLanguage==='en'\|\|savedAixbtLanguage==='cz'/,'the saved language is restored after page reload');
  assert.match(appSource,/function setAixbtLanguage\(language\).*?renderDashboardTopics\(state\.dashboardTopics\)/,'changing language rerenders the cached topic payload without fetching the API');
  assert.match(appSource,/posts:'příspěvky'/,'CZ mode translates AIXBT interface labels');
  assert.match(appSource,/authors:'autoři'/,'CZ mode translates author metadata labels');
  assert.match(appSource,/aixbt-translation-fallback/,'untranslated source content is clearly marked EN in CZ mode');
  assert.match(htmlSource,/Discovery · MONI/,'Dashboard names the cached Projects Feed as discovery, not Trending');
  assert.doesNotMatch(htmlSource,/Trending · MONI/,'Dashboard does not label Projects Feed as MONI Trending');
  assert.match(appSource,/payload\?\.refreshing\?'Načítám vybraný MONI pohled…'/,'missing dashboard data displays the automatic refresh state');
  assert.match(appSource,/function renderDashboardMoniTrending\(payload\)/,'MONI projects are rendered from the dashboard cache payload');
  assert.match(htmlSource,/data-moni-view="growing"/,'Growing is a dashboard view');assert.match(htmlSource,/data-moni-view="top"/,'Top Score is a dashboard view');assert.match(htmlSource,/data-moni-view="new"/,'New is a dashboard view');assert.match(appSource,/cd:dashboard-moni-view/,'dashboard view persists locally');assert.match(appSource,/data-moni-load/,'a manual dashboard refresh remains available');assert.match(htmlSource,/Obnovit · až 10 bodů/,'manual refresh displays its maximum cost');
  assert.match(appSource,/fresh\.textContent=payload\?\.fetchedAt\?`MONI · \$\{stateLabel\} \$\{dashboardDate\(payload\.fetchedAt\)\}`/,'MONI cache displays its source, freshness timestamp, and stale label');
  assert.match(appSource,/items\.map\(\(item,index\)=>/,'MONI ranking follows the stored feed order');
  assert.match(appSource,/item\.url\?`<a class="dashboard-moni-row" href="\$\{esc\(item\.url\)\}" target="_blank" rel="noopener noreferrer"/,'project link uses the cached X URL and safe new-tab attributes');
  assert.match(appSource,/dashboard-moni-avatar/,'a neutral initial avatar is used instead of a claimed project logo');assert.match(appSource,/Number\.isFinite\(item\.smartMentionsChange\)/,'dashboard shows only real Smart Mentions change and never invents Score Change');assert.match(appSource,/function dashboardMoniContext\(filters\)/,'MONI view context is generated from active filters');assert.match(appSource,/D7:'7denní feed'/,'D7 is rendered as a seven-day feed');assert.match(appSource,/H24:'změna za 24 h'/,'H24 is rendered as a 24-hour change interval');assert.match(appSource,/SCORE_CHANGE:'řazeno podle růstu Score'/,'score-change ranking has a global explanation');assert.match(appSource,/SCORE:'řazeno podle Moni Score'/,'score ranking has a global explanation');assert.match(appSource,/CREATED_AT:'řazeno podle novosti projektu'/,'new-project ranking has a global explanation');assert.match(appSource,/context\.textContent=dashboardMoniContext\(filters\)/,'context follows active query filters');assert.doesNotMatch(appSource,/řazení: změna Score/,'project rows do not repeat the global ranking explanation');assert.match(htmlSource,/id="dashboard-moni-view-context" class="dashboard-moni-view-context"/,'context is placed below the view switches');
  assert.match(htmlSource,/data-dashboard-view="socials">Discovery · MONI/,'MONI title opens the Socials section');
  assert.match(source,/\.dashboard-moni-list\{[^}]*overflow-x:hidden/,'MONI project list clips horizontal overflow');
  assert.doesNotMatch(source,/\.dashboard-moni-list\{[^}]*overflow-x:auto/,'MONI list does not create a horizontal scrollbar');
  assert.match(source,/\.dashboard-moni-row\{display:grid/,'MONI projects use a compact vertical list');
  assert.doesNotMatch(appSource,/accounts\/\$\{[^}]+\}\/info\/full/,'dashboard does not enrich profiles');
  assert.match(htmlSource,/EXTERNÍ SIGNÁLY[\s\S]*?Discovery z externích zdrojů[\s\S]*?dashboard-source-grid[\s\S]*?Trending · AIXBT[\s\S]*?Discovery · MONI[\s\S]*?MOJE DATA/,'External Signals, including AIXBT and MONI discovery, precede My Data');
  assert.match(htmlSource,/MOJE DATA[\s\S]*?dashboard-internal-grid[\s\S]*?Co drží moje wallets[\s\S]*?Poslední korelace[\s\S]*?<\/section>[\s\S]*?id="dashboard-research-title">MŮJ RESEARCH/,'My Research is a separate section after the My Data panels');
  assert.doesNotMatch(htmlSource,/Pokračovat ve výzkumu/,'the removed Continue research block is absent from Dashboard');
  assert.match(htmlSource,/dashboard-aixbt-panel dashboard-source-card/,'AIXBT is an extensible external source card');
  assert.match(htmlSource,/dashboard-moni-trending dashboard-source-card/,'MONI is an extensible external source card');
  assert.match(source,/\.dashboard-source-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:16px;align-items:stretch/,'external source cards share equal desktop grid columns and stretch to equal row height');
  assert.match(source,/\.dashboard-source-card\{[^}]*height:900px;max-height:none;min-height:600px/,'external cards share an expanded desktop height that fits up to ten entries');
  assert.match(source,/@media\(max-width:980px\)\{\.dashboard-source-grid\{grid-template-columns:minmax\(0,1fr\)\}\.dashboard-source-card\{height:680px;max-height:none;min-height:480px\}\}/,'external cards stack responsively and remain equally sized');
  assert.match(source,/\.dashboard-source-card \.dashboard-aixbt-list,\.dashboard-source-card \.dashboard-moni-list\{[^}]*overflow-y:auto;overflow-x:hidden/,'both external card bodies scroll vertically and clip horizontal overflow');
  assert.match(source,/\.dashboard-source-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:16px;align-items:stretch/,'external source cards stay side by side on desktop and stretch to equal height');
  assert.doesNotMatch(source,/\.dashboard-aixbt-list\{[^}]*contain:size/,'AIXBT list does not use size containment that can clip content');
  assert.match(source,/\.dashboard-section-heading\{display:flex/,'section labels use a quiet heading row');
  assert.match(source,/\.dashboard-section-rule\{height:1px;flex:1;background:linear-gradient/,'section divider remains subtle');
}
console.log('Dashboard regressions passed: saved wallet data, partial/quality coverage, correlations, cache-first MONI views and refresh states, AIXBT cache/stale/error/topic projects and responsive layout.');
