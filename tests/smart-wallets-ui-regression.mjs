import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {ZERO_ADDRESS,DEAD_ADDRESS,IGNORED_WALLET_ADDRESS_ERROR,isIgnoredWalletAddress,isSystemWalletAddress,debankProfileUrl} from '../dist/data.js';

const source=(await readFile(new URL('../dist/smart-wallets.js',import.meta.url),'utf8')).replace("import {MAX_WALLET_SCAN,IGNORED_WALLET_ADDRESS_ERROR,debankProfileUrl,isIgnoredWalletAddress} from './data.js';",'').replace('export function initSmartWallets','function initSmartWallets');
const pickerHtml=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const styles=await readFile(new URL('../dist/style.css',import.meta.url),'utf8');
assert.match(pickerHtml,/id="smart-delete-impact"[^>]*class="smart-form-hint"/,'Smart-wallet deletion confirmation exposes its scope and impact separately');assert.match(pickerHtml,/class="primary-button destructive-button"[^>]*id="smart-delete-confirm"/,'delete confirmation is visually distinguished as destructive');assert.match(styles,/\.drawer-tools \.drawer-delete-button\{[^}]*color:#d5a39a/,'wallet drawer delete action uses a restrained destructive treatment');
const pickerOrder=['id="smart-picker-filter-count"','id="smart-picker-summary"','class="smart-picker-selection"','id="smart-picker-list"'].map(id=>pickerHtml.indexOf(id));
assert.ok(pickerOrder.every((index,i)=>index>=0&&(!i||index>pickerOrder[i-1])),'filter summary, form info, selection toolbar, then independently scrollable wallet list');
assert.match(pickerHtml,/id="smart-picker-select-filter"[^>]*class="primary-button"|class="primary-button"[^>]*id="smart-picker-select-filter"/);
assert.match(pickerHtml,/id="smart-picker-limit-note"/);
assert.match(pickerHtml,/class="smart-picker-result-meta"><strong id="smart-picker-result-count"[^]*id="smart-picker-limit-note"/,'the filter count and cap explanation share the compact toolbar summary column');
assert.match(pickerHtml,/class="smart-picker-selection-actions"><button class="primary-button"[^]*id="smart-picker-remove-filter"[^]*id="smart-picker-clear"/,'selection actions remain grouped horizontally');
assert.match(pickerHtml,/class="smart-picker-field smart-picker-field-search"[^]*class="smart-picker-field smart-picker-field-tags"[^]*class="smart-picker-field smart-picker-field-count"[^]*class="smart-picker-field smart-picker-field-status"[^]*class="smart-picker-field smart-picker-field-chain"/,'all five picker filters use the same field wrapper structure and requested order');
assert.equal((pickerHtml.match(/class="smart-picker-filter-control"/g)||[]).length,4,'search and the three select filters share the control class');
assert.match(styles,/#smart-picker-dialog\[open\]\s*\{[^}]*overflow\s*:\s*visible/,'picker dialog permits its dropdown to extend past the dialog box');
assert.match(styles,/#smart-picker-dialog\{width:min\(1180px,calc\(100vw - 40px\)\);max-width:1180px/,'picker dialog keeps its readable viewport-bounded width');
assert.match(styles,/\.smart-picker-filters\{[^}]*grid-template-columns:minmax\(260px,1\.25fr\) minmax\(260px,1\.35fr\) minmax\(170px,\.8fr\) minmax\(190px,\.9fr\) minmax\(190px,\.9fr\);gap:16px/,'desktop filters use one stable five-column grid');
assert.match(styles,/\.smart-picker-filters \.smart-picker-filter-control\{[^}]*height:40px[^}]*border:1px solid[^}]*border-radius:6px/,'search, selects and tag trigger share control height and geometry with selector strength above the generic summary style');
assert.match(styles,/select\.smart-picker-filter-control\{appearance:none;background-image:var\(--picker-chevron\)/,'select filters use the shared chevron asset');
assert.match(source,/smart-picker-chevron[\s\S]*?viewBox="0 0 12 8"/,'tag trigger uses the matching SVG chevron, not a text glyph');
assert.match(styles,/@media\(max-width:1100px\)\{\.smart-picker-filters\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/,'filters wrap into two rows before controls become too narrow');
assert.doesNotMatch(styles,/\.smart-picker-filters input,\.smart-picker-filters select\{/,'the old broad picker input rule no longer overrides filter controls and checkboxes');
assert.doesNotMatch(styles,/\.smart-picker-filters \.smart-tag-filter>summary\{/,'the old independent tag-trigger styling was removed');
assert.doesNotMatch(styles,/\.picker-filter-control/,'the old picker-only wrapper selector was removed');
assert.match(styles,/\.smart-picker-selection\{grid-template-columns:minmax\(180px,1fr\) auto;align-items:center;gap:14px;min-height:64px/,'bulk selection toolbar keeps its compact responsive layout');
assert.match(styles,/\.smart-tag-filter-menu\{[^}]*z-index:25[^}]*border:1px solid var\(--border\)[^}]*background:var\(--panel\)/,'main and picker tag dropdowns share the same neutral dark shell');
assert.match(styles,/\.smart-tag-options input\[type=checkbox\]\{appearance:none[^}]*border:1px solid #[0-9a-f]{6}/,'main and picker tag checkboxes share a visible unchecked outline');
assert.match(styles,/\.smart-tag-options input\[type=checkbox\]:checked\{border-color:var\(--lime\);background:var\(--lime\)\}/,'main and picker checked tag boxes share the lime accent');
assert.match(styles,/\.smart-tag-options\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,'both dropdowns use the same responsive two-column tag list');
assert.match(source,/document\.addEventListener\('pointerdown'/,'outside pointer handling is shared by both tag filters');
assert.match(source,/document\.addEventListener\('keydown',[^]*event\.key!=='Escape'/,'Escape closes either tag dropdown');
assert.doesNotMatch(styles,/\.smart-filters \.smart-tag-filter>summary:after|\.smart-tag-filter-menu\{[^}]*background:#17201c/,'the old green main dropdown and text chevron rules are gone');
assert.equal(isIgnoredWalletAddress(ZERO_ADDRESS),true);assert.equal(isIgnoredWalletAddress(DEAD_ADDRESS),true);assert.equal(isSystemWalletAddress('0x0000000000000000000000000000000000000001'),false);
const address=i=>'0x'+i.toString(16).padStart(40,'0');
const records=Array.from({length:23},(_,i)=>({address:address(i+10),name:i===0?'ARB Whale':'Wallet '+i,tags:i===0?['DeFi','ARB']:['Other'],status:i===0?'reviewed':i===22?'excluded':'candidate',chainIds:i===22?['linea']:['base'],source:'Fixture',note:'',updatedAt:new Date().toISOString()}));

function harness({base=[],rows=records,fail=false,deleteFail=false}={}){
 const elements=new Map(),calls=[],analyses=[],toasts=[],documentListeners=new Map();let serverRows=[...rows];
 const document={getElementById(id){if(!elements.has(id)){const listeners=new Map(),attributes=new Map();elements.set(id,{value:'',innerHTML:'',textContent:'',hidden:false,disabled:false,checked:false,open:false,addEventListener(type,handler){listeners.set(type,handler);},setAttribute(name,value){attributes.set(name,value);},getAttribute(name){return attributes.get(name)||null;},emit(type,target={}){const event={target,...target,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};return listeners.get(type)?.(event)??event;},showModal(){this.open=true;},close(){this.open=false;},focus(){},reset(){},querySelector(selector){if(selector==='details'&&this.innerHTML.includes('<details')){this.details??={open:false};return this.details;}return null;},contains(target){return target===this||target?.containerId===id||target?.parentElement===this;},querySelectorAll(selector){return id==='smart-chains'&&selector==='input:checked'?[{value:'base'}]:[];}});}return elements.get(id);},addEventListener(type,handler){const listeners=documentListeners.get(type)||[];listeners.push(handler);documentListeners.set(type,listeners);}};
 const context=vm.createContext({document,location:{protocol:'http:'},URL,Blob,setTimeout,MAX_WALLET_SCAN:500,IGNORED_WALLET_ADDRESS_ERROR,isIgnoredWalletAddress,debankProfileUrl,fetch:async(path,options={})=>{calls.push({path,options});if(fail||options.method==='DELETE'&&deleteFail)throw Error('offline');const payload=options.body?JSON.parse(options.body):{};let result;
  if(options.method==='POST'&&path.endsWith('/import-preview')){const existingCount=payload.entries.filter(entry=>serverRows.some(row=>row.address===entry.address)).length;result={newCount:payload.entries.length-existingCount,existingCount};}
  else if(options.method==='POST'&&path.endsWith('/quick-add')){const entry=payload.entries?.[0]||{address:payload.addresses?.[0]},row=serverRows.find(w=>w.address===entry.address);let created=[],updated=[],unchanged=[];if(!row){created=[entry.address];serverRows.push({address:entry.address,name:'',tags:['research'],source:'Token Screener',note:'',status:'candidate',chainIds:payload.chainIds,updatedAt:new Date().toISOString()});}else{const seen=new Set(row.tags.map(tag=>tag.toLowerCase())),tags=[...row.tags,...payload.tags.filter(tag=>{const key=tag.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;})],chainIds=[...new Set([...row.chainIds,...payload.chainIds])];if(tags.length===row.tags.length&&chainIds.length===row.chainIds.length)unchanged=[entry.address];else{updated=[entry.address];row.tags=tags;row.chainIds=chainIds;}}result={created,updated,unchanged,wallet:serverRows.find(w=>w.address===entry.address)};}
  else if(options.method==='POST'){const created=[],updated=[],unchanged=[];for(const entry of payload.entries){const row=serverRows.find(w=>w.address===entry.address);if(!row){created.push(entry.address);serverRows.push({...entry,name:entry.name||payload.name,tags:payload.tags,source:payload.source,note:payload.note,status:payload.status,chainIds:payload.chainIds});}else if(payload.conflictMode==='merge-tags'){const seen=new Set(row.tags.map(tag=>tag.toLowerCase()));const tags=[...row.tags,...payload.tags.filter(tag=>{const key=tag.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;})];if(tags.length===row.tags.length)unchanged.push(entry.address);else{updated.push(entry.address);row.tags=tags;}}else if(payload.updateExisting){updated.push(entry.address);row.name=entry.name||payload.name||row.name;row.tags=payload.tagsMode==='replace'?payload.tags:[...new Set([...row.tags,...payload.tags])];row.source=payload.source||row.source;row.note=payload.note||row.note;row.status=payload.status;row.chainIds=payload.networksMode==='add'?[...new Set([...row.chainIds,...payload.chainIds])]:payload.chainIds;}else unchanged.push(entry.address);}result={created,updated,unchanged};}
  else if(options.method==='PATCH'){for(const row of serverRows.filter(w=>payload.addresses.includes(w.address))){const change=payload.changes;if(change.tags){if(change.tags.mode==='replace')row.tags=[...change.tags.values];else if(change.tags.mode==='add')row.tags=[...new Set([...row.tags,...change.tags.values])];else row.tags=row.tags.filter(t=>!change.tags.values.includes(t));}for(const key of ['status','source','chainIds','note'])if(Object.hasOwn(change,key))row[key]=change[key];}result={updated:payload.addresses,missing:[]};}
  else if(options.method==='DELETE'){const ids=path==='/api/smart-wallets'?payload.addresses:[path.split('/').at(-1)];const deleted=serverRows.filter(w=>ids.includes(w.address)).map(w=>w.address);serverRows=serverRows.filter(w=>!ids.includes(w.address));result=path==='/api/smart-wallets'?{deleted,missing:ids.filter(id=>!deleted.includes(id))}:{deleted:true,address:deleted[0]};}
  else result={wallets:serverRows};return {ok:true,headers:{get:()=> 'application/json'},json:async()=>result};}});
 vm.runInContext(source+'\nglobalThis.init=initSmartWallets;globalThis.parseBulkWalletEntries=parseBulkWalletEntries;',context);
 const module=context.init({networks:[{id:'ethereum',name:'Ethereum',live:true},{id:'base',name:'Base',live:true},{id:'optimism',name:'Optimism',live:true},{id:'arbitrum',name:'Arbitrum',live:true},{id:'robinhood',name:'Robinhood Chain',live:true}],legacyNetworks:[{id:'linea',name:'Linea',live:false,legacy:true}],toast:x=>toasts.push(x),getLiveWatchlist:()=>[],getAnalysisAddresses:()=>base,supportsWalletChain:id=>['base','ethereum','optimism','arbitrum','robinhood'].includes(id),analyze:(...args)=>{analyses.push(JSON.parse(JSON.stringify(args)));return true;}});
 const get=id=>document.getElementById(id);
 const choose=(id,checked=true,table='smart-picker-list')=>{const target={checked,dataset:table==='smart-picker-list'?{pickerAddress:id}:{smartSelect:id}};get(table).emit('change',target);return target;};
 const click=button=>documentListeners.get('click')?.forEach(handler=>handler({target:{closest:()=>button}}));
 const tag=(scope,value,checked=true)=>get(scope==='main'?'smart-tags-filter':'smart-picker-tags-filter').emit('change',{dataset:{[scope==='main'?'mainTagOption':'pickerTagOption']:value},checked});
 const enterTag=(id,value)=>{const input=get(id);input.value=value;input.onkeydown({key:'Enter',preventDefault(){},stopPropagation(){}});};
 const mode=(scope,value)=>get(scope==='main'?'smart-tags-filter':'smart-picker-tags-filter').emit('change',{dataset:{[scope==='main'?'mainTagMode':'pickerTagMode']:''},value});
 const removeTag=(scope,value)=>get(scope==='main'?'smart-tags-filter':'smart-picker-tags-filter').emit('click',{dataset:{[scope==='main'?'mainTagRemove':'pickerTagRemove']:value}});
 const clearTags=scope=>get(scope==='main'?'smart-tags-filter':'smart-picker-tags-filter').emit('click',{dataset:{[scope==='main'?'mainTagClear':'pickerTagClear']:''}});
 const pointerdown=target=>documentListeners.get('pointerdown')?.forEach(handler=>handler({target,composedPath:()=>[target]}));
 const keydown=key=>documentListeners.get('keydown')?.forEach(handler=>handler({key,preventDefault(){},stopPropagation(){}}));
 return {module,get,calls,analyses,toasts,choose,parse:context.parseBulkWalletEntries,click,getRows:()=>serverRows,tag,mode,removeTag,clearTags,enterTag,pointerdown,keydown};
}

// Bulk line parsing retains labels, default-name fallbacks, normalized deduplication and row errors.
{
 const h=harness(),A=address(1),B=address(2),C=address(3),D=address(4);
 assert.deepEqual(JSON.parse(JSON.stringify(h.parse(A))),[{address:A}]);
 assert.deepEqual(JSON.parse(JSON.stringify(h.parse(`${A} artur2`))),[{address:A,name:'artur2'}]);
 assert.deepEqual(JSON.parse(JSON.stringify(h.parse(`${A} - MoniWizard`))),[{address:A,name:'MoniWizard'}]);
 assert.deepEqual(JSON.parse(JSON.stringify(h.parse(`${A} Spartan group`))),[{address:A,name:'Spartan group'}]);
 assert.deepEqual(JSON.parse(JSON.stringify(h.parse(`${A} artur2\n${B} Spartan group\n${C}`))),[{address:A,name:'artur2'},{address:B,name:'Spartan group'},{address:C}]);
 assert.deepEqual(JSON.parse(JSON.stringify(h.parse(`${A}, ${B}; ${C}`))),[{address:A},{address:B},{address:C}]);
 assert.deepEqual(JSON.parse(JSON.stringify(h.parse(`${A} Same\n${A} Ignored\n${D}`))),[{address:A,name:'Same'},{address:D}]);
 assert.throws(()=>h.parse(`${A}\nnot-an-address`),/řádku 2/);
}

// The form sends per-address names to the server while retaining the common fallback fields.
{
 const h=harness(),A=address(301),B=address(302),C=address(303);await h.module.show();
 h.get('smart-addresses').value=`${A} artur2\n${B} Spartan group\n${C}`;h.get('smart-name').value='DeBank wallet';
 h.enterTag('smart-tags','whale');h.enterTag('smart-tags','defi');h.get('smart-source').value='DeBank';h.get('smart-note').value='Imported';h.get('smart-status').value='reviewed';
 await h.get('smart-form').emit('submit',{preventDefault(){}});assert.equal(h.get('smart-dialog').open,false,'successful save closes the add dialog as before');
 const post=h.calls.find(c=>c.options.method==='POST'&&c.path==='/api/smart-wallets');assert.ok(post,`expected successful save; form error: ${h.get('smart-form-error').textContent}`);const body=JSON.parse(post.options.body);
 assert.deepEqual(body.entries,[{address:A,name:'artur2'},{address:B,name:'Spartan group'},{address:C}]);assert.equal(body.name,'DeBank wallet');
 assert.deepEqual(body.tags,['whale','DeFi']);assert.equal(body.source,'DeBank');assert.equal(body.note,'Imported');assert.equal(body.status,'reviewed');assert.deepEqual(body.chainIds,['base']);assert.equal(body.updateExisting,false);assert.ok(h.calls.some(c=>c.path.endsWith('/import-preview')));assert.ok(h.toasts.includes('Přidáno 3, aktualizováno 0, beze změny 0.'));
}

// Token Screener quick add persists one wallet directly through the canonical Smart-wallet API and never opens a form.
{
 const addedAddress=address(95001),h=harness();await h.module.show();h.get('smart-dialog').open=false;
 const added=await h.module.quickAdd(addedAddress,['robinhood']);assert.equal(added.created,true);assert.equal(h.get('smart-dialog').open,false,'quick add never opens the full add/edit dialog');assert.equal(h.getRows().length,records.length+1);assert.equal(h.get('smart-count').textContent,records.length+1,'a new address updates the Smart-wallet sidebar count');
 const saved=h.getRows().find(wallet=>wallet.address===addedAddress);assert.equal(saved.status,'candidate');assert.deepEqual(saved.tags,['research']);assert.equal(saved.source,'Token Screener');assert.equal(saved.note,'');assert.deepEqual(saved.chainIds,['robinhood']);assert.deepEqual(h.calls.filter(call=>call.options.method==='POST').map(call=>call.path),['/api/smart-wallets/quick-add'],'quick add uses the dedicated canonical upsert route without an import preview');
 const existing={...records[0],address:address(95002),name:'Reviewed keeper',tags:['Research','DeFi'],status:'reviewed',source:'Curated list',note:'Keep this note',chainIds:['base']},existingHarness=harness({rows:[existing]});await existingHarness.module.show();const enriched=await existingHarness.module.quickAdd(existing.address,['robinhood']);assert.equal(enriched.created,false);assert.deepEqual(enriched.wallet.tags,['Research','DeFi'],'research tag merges case-insensitively and preserves existing casing');assert.equal(enriched.wallet.name,'Reviewed keeper');assert.equal(enriched.wallet.status,'reviewed');assert.equal(enriched.wallet.source,'Curated list');assert.equal(enriched.wallet.note,'Keep this note');assert.deepEqual(enriched.wallet.chainIds,['base','robinhood']);assert.equal(existingHarness.get('smart-count').textContent,1,'adding metadata to an existing wallet does not increase the count');
 await assert.rejects(()=>existingHarness.module.quickAdd(ZERO_ADDRESS,['base']),/systémová burn\/dead/,'quick add refuses the zero address before making a request');assert.equal(existingHarness.calls.filter(call=>call.options.method==='POST').length,1);
 const failed=harness({fail:true});await failed.module.show();const failedCount=failed.get('smart-count').textContent;await assert.rejects(()=>failed.module.quickAdd(addedAddress,['base']),/offline/);assert.equal(failed.get('smart-count').textContent,failedCount,'backend failure does not optimistically increment the count');assert.equal(failed.getRows().length,records.length,'backend failure does not create a local success record');
}

// Tag input suggests persisted tags, creates new tags on Enter, canonicalizes case, removes chips, and enforces 12.
{
 const h=harness();await h.module.show();h.get('smart-tags').onfocus();assert.match(h.get('smart-tags-suggestions').innerHTML,/Existující štítky/);assert.match(h.get('smart-tags-suggestions').innerHTML,/DeFi/);
 h.get('smart-tags-suggestions').emit('click',{target:{dataset:{tagOption:'DeFi'}}});assert.match(h.get('smart-tags-chips').innerHTML,/DeFi/);
 h.enterTag('smart-tags','defi');assert.equal((h.get('smart-tags-chips').innerHTML.match(/smart-value-chip/g)||[]).length,1,'case-insensitive duplicate uses the existing spelling');assert.match(h.get('smart-tags-chips').innerHTML,/DeFi/);
 h.enterTag('smart-tags','New Fund');assert.match(h.get('smart-tags-chips').innerHTML,/New Fund/);h.get('smart-tags-chips').emit('click',{target:{dataset:{tagRemove:'0'}}});assert.doesNotMatch(h.get('smart-tags-chips').innerHTML,/DeFi/);assert.match(h.get('smart-tags-chips').innerHTML,/New Fund/);
 for(let index=0;index<11;index++)h.enterTag('smart-tags',`Tag ${index}`);assert.equal((h.get('smart-tags-chips').innerHTML.match(/smart-value-chip/g)||[]).length,12);h.get('smart-tags').value='Tag 12';h.get('smart-tags').oninput();assert.match(h.get('smart-tags-suggestions').innerHTML,/Limit 12 štítků je dosažen/);h.enterTag('smart-tags','Tag 12');assert.equal((h.get('smart-tags-chips').innerHTML.match(/smart-value-chip/g)||[]).length,12);
 const edit=harness();await edit.module.add(records[0].address,['base']);assert.equal(edit.get('smart-dialog').open,true);assert.match(edit.get('smart-tags-chips').innerHTML,/DeFi/);assert.match(edit.get('smart-tags-chips').innerHTML,/ARB/);
}

// Smart-wallet addresses alone link to the exact DeBank profile in a safe new tab.
{
 const exact='0xabcd000000000000000000000000000000001234',wallet={...records[0],address:exact};const h=harness({rows:[wallet]});await h.module.show();
 const row=h.get('smart-table-body').innerHTML;assert.match(row,new RegExp(`<a class="smart-address smart-address-link" href="https://debank\\.com/profile/${exact}" target="_blank" rel="noopener noreferrer">${exact}</a>`));
 assert.match(row,/button class="address-button" data-smart-edit=/,'the name remains the edit action while the address itself is a separate link');
 const invalid=harness({rows:[{...wallet,address:'not-an-EVM-address'}]});await invalid.module.show();assert.doesNotMatch(invalid.get('smart-table-body').innerHTML,/href="https:\/\/debank\.com\/profile\//,'invalid addresses stay plain text');
}

// The DeBank anchor stays on its own second line without changing any other table-cell layout.
{
 const fixtures=[
  {...records[0],address:address(990),name:'Moni Wizards',tags:['Moni Wizards','AlfaDAO'],note:'A long research note '.repeat(14)},
  {...records[1],address:address(991),name:'',tags:['Fund','Whale'],note:'Another long note '.repeat(12)},
 ];
 const h=harness({rows:fixtures});await h.module.show();const markup=h.get('smart-table-body').innerHTML;
 for(const wallet of fixtures){const row=markup.slice(markup.indexOf(`<tr><td><input type="checkbox" data-smart-select="${wallet.address}"`));
  const title=wallet.name||wallet.address.slice(0,6)+'…'+wallet.address.slice(-4);assert.ok(row.indexOf(`>${title}</button>`)<row.indexOf(`<a class="smart-address smart-address-link"`),'wallet title is rendered before the DeBank address on a separate block line');
  assert.match(row,new RegExp(`<a class="smart-address smart-address-link" href="https://debank\\.com/profile/${wallet.address}" target="_blank" rel="noopener noreferrer">${wallet.address}</a>`));
  assert.match(row,/class="smart-tags"><span>/,'multiple tag chips remain in their own column');assert.match(row,/class="smart-note">A long research note|class="smart-note">Another long note/,'long notes remain in the note column');
 }
 assert.match(styles,/\.smart-table \.smart-address-link\s*\{\s*display\s*:\s*block\s*\}/,'table address link is block-level and remains below the name');
 assert.match(styles,/\.smart-table \.smart-address-link::after\s*\{\s*content\s*:\s*none\s*\}/,'the optional arrow does not add width or height to the original address line');
 assert.doesNotMatch(styles,/\.smart-table \.smart-address-link\s*\{[^}]*inline-flex/,'table address link does not introduce inline-flex layout');
}

// Important Smart-wallet dialogs ignore Escape and backdrop interaction; the add form closes only from its X.
{
 const h=harness();await h.module.add(address(899),['base']);const dialog=h.get('smart-dialog');assert.equal(dialog.open,true);assert.equal(dialog.getAttribute('closedby'),'none');
 assert.equal(dialog.emit('cancel').defaultPrevented,true);assert.equal(dialog.open,true,'Escape does not close the add form');
 assert.equal(dialog.emit('click',{target:dialog}).defaultPrevented,true);assert.equal(dialog.open,true,'backdrop click does not close the add form');
 h.get('smart-dialog-close').onclick();assert.equal(dialog.open,false,'the explicit X closes the add form even with unsaved input');
}

// Existing addresses default to adding tags only and preserve all other metadata.
{
 const existing={...records[0],address:address(901),name:'Original name',tags:['DeBank'],source:'Old source',note:'Keep this note',chainIds:['base','ethereum']};
 const h=harness({rows:[existing]});await h.module.show();h.get('smart-addresses').value=`${existing.address} - Arthur Hayes`;h.get('smart-name').value='Common fallback';h.enterTag('smart-tags','MoniWizards');h.get('smart-source').value='Cielo';h.get('smart-note').value='';h.get('smart-status').value='reviewed';
  const save=h.get('smart-form').emit('submit',{preventDefault(){}});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(h.get('smart-import-conflict-dialog').open,true);const conflict=h.get('smart-import-conflict-dialog');assert.equal(conflict.emit('cancel').defaultPrevented,true);assert.equal(conflict.open,true,'Escape leaves import conflict dialog open');assert.equal(conflict.emit('click',{target:conflict}).defaultPrevented,true);assert.equal(conflict.open,true,'backdrop click leaves import conflict dialog open');assert.match(h.get('smart-import-conflict-counts').textContent,/Nových adres: 0\. Již evidovaných adres: 1/);assert.equal(h.get('smart-import-mode-merge-tags').checked,true);assert.equal(h.get('smart-import-mode-keep').checked,false);assert.equal(h.get('smart-import-mode-update').checked,false);assert.equal(h.get('smart-import-continue').textContent,'Doplnit nové štítky');assert.equal(h.get('smart-import-update-options').hidden,true);
 h.get('smart-import-continue').onclick();await save;
 const payload=JSON.parse(h.calls.find(c=>c.options.method==='POST'&&c.path==='/api/smart-wallets').options.body);assert.equal(payload.conflictMode,'merge-tags');assert.equal(payload.updateExisting,false);
 assert.equal(h.getRows()[0].name,'Original name');assert.deepEqual(h.getRows()[0].tags,['DeBank','MoniWizards']);assert.equal(h.getRows()[0].source,'Old source');assert.equal(h.getRows()[0].note,'Keep this note');assert.deepEqual(h.getRows()[0].chainIds,['base','ethereum']);assert.equal(h.getRows()[0].status,'reviewed');assert.ok(h.toasts.includes('Přidáno 0, aktualizováno 1, beze změny 0.'));
}

// Bulk management has no 20-wallet cap, sends only checked fields, and preserves imported names.
{
 const bulkRows=Array.from({length:24},(_,i)=>({...records[i%records.length],address:address(700+i),name:`Imported wallet ${i}`,tags:['seed'],source:'DeBank',note:`private ${i}`,status:'candidate',chainIds:['base']}));
 const h=harness({rows:bulkRows});await h.module.show();for(const row of bulkRows)h.choose(row.address,true,'smart-table-body');
 assert.equal(h.get('smart-selection').hidden,false);assert.equal(h.get('smart-selection-count').textContent,'Vybráno: 24');assert.equal(h.get('smart-analyze-selected').disabled,false);
 h.get('smart-bulk-edit').onclick();assert.equal(h.get('smart-bulk-edit-dialog').open,true);assert.equal(h.get('smart-bulk-edit-dialog').getAttribute('closedby'),'none');assert.equal(h.get('smart-bulk-edit-dialog').emit('cancel').defaultPrevented,true);assert.equal(h.get('smart-bulk-edit-dialog').open,true);assert.equal(h.get('smart-bulk-edit-dialog').emit('click',{target:h.get('smart-bulk-edit-dialog')}).defaultPrevented,true);assert.equal(h.get('smart-bulk-edit-dialog').open,true);assert.equal(h.get('smart-bulk-edit-count').textContent,'Upravit 24 peněženek');
 h.get('smart-bulk-tags-enabled').checked=true;h.get('smart-bulk-tags-enabled').onchange({target:{checked:true}});h.get('smart-bulk-tags-mode').value='add';h.enterTag('smart-bulk-tags','fonds&whales');
 await h.get('smart-bulk-edit-form').emit('submit',{preventDefault(){}});const request=h.calls.find(c=>c.options.method==='PATCH'),payload=JSON.parse(request.options.body);
 assert.equal(payload.addresses.length,24);assert.deepEqual(Object.keys(payload.changes),['tags']);assert.deepEqual(payload.changes.tags,{mode:'add',values:['fonds&whales']});
 assert.ok(h.getRows().every(w=>w.tags.includes('seed')&&w.tags.includes('fonds&whales')&&w.name.startsWith('Imported wallet')&&w.source==='DeBank'&&w.note.startsWith('private ')));
 assert.equal(h.get('smart-selection').hidden,true);assert.ok(h.toasts.includes('Upraveno 24 peněženek.'));
}

// Single deletion names the wallet in its confirmation; bulk deletion confirms and removes selected rows.
{
 const h=harness({rows:records.slice(0,3)});await h.module.show();
 await h.click({dataset:{smartDelete:records[0].address},hasAttribute:()=>false});assert.equal(h.get('smart-delete-dialog').open,true);assert.equal(h.get('smart-delete-dialog').emit('cancel').defaultPrevented,true);assert.equal(h.get('smart-delete-dialog').open,true);assert.equal(h.get('smart-delete-dialog').emit('click',{target:h.get('smart-delete-dialog')}).defaultPrevented,true);assert.equal(h.get('smart-delete-dialog').open,true);assert.match(h.get('smart-delete-message').textContent,/ARB Whale/);
 await h.get('smart-delete-confirm').onclick();assert.equal(h.getRows().some(w=>w.address===records[0].address),false);assert.ok(h.toasts.includes('Smazáno 1 peněženka.'));
 h.choose(records[1].address,true,'smart-table-body');h.choose(records[2].address,true,'smart-table-body');h.get('smart-bulk-delete').onclick();assert.match(h.get('smart-delete-message').textContent,/trvale smazat 2 Smart wallets/);
 await h.get('smart-delete-confirm').onclick();const bulkDelete=h.calls.find(c=>c.options.method==='DELETE'&&c.path==='/api/smart-wallets');assert.deepEqual(JSON.parse(bulkDelete.options.body).addresses,[records[1].address,records[2].address]);assert.equal(h.getRows().length,0);assert.equal(h.get('smart-selection').hidden,true);
}

// The wallet-detail drawer uses the canonical Smart-wallet delete confirmation and leaves the drawer open on API failure.
{
 const row={...records[0],status:'candidate'},h=harness({rows:[row]});await h.module.show();let afterSuccess=0;
 assert.equal(h.module.removeFromDrawer(row.address,{afterSuccess:()=>afterSuccess++}),true);assert.equal(h.get('smart-delete-dialog').open,true);
 assert.match(h.get('smart-delete-message').textContent,/ARB Whale/);assert.match(h.get('smart-delete-impact').textContent,/pouze evidenční záznam Smart wallets/);assert.match(h.get('smart-delete-impact').textContent,/Historické výsledky skenů zůstanou zachované/);assert.equal(h.get('smart-delete-confirm').textContent,'Smazat peněženku');
 h.get('smart-delete-cancel').onclick();assert.equal(h.get('smart-delete-dialog').open,false);assert.equal(h.calls.some(call=>call.options.method==='DELETE'),false,'cancel never sends a delete request');assert.equal(afterSuccess,0);
 h.module.removeFromDrawer(row.address,{afterSuccess:()=>afterSuccess++});await h.get('smart-delete-confirm').onclick();assert.equal(afterSuccess,1,'drawer success callback fires only after the API confirms deletion');assert.equal(h.getRows().length,0);assert.equal(h.get('smart-count').textContent,0,'Smart-wallet sidebar count is refreshed immediately');assert.equal(h.get('smart-delete-dialog').open,false);assert.deepEqual(h.calls.filter(call=>call.options.method==='DELETE').map(call=>call.path),[`/api/smart-wallets/${row.address}`],'deletion targets only the canonical Smart-wallet record endpoint');
}
{
 const row={...records[1],status:'reviewed'},h=harness({rows:[row],deleteFail:true});await h.module.show();let afterSuccess=0;h.module.removeFromDrawer(row.address,{afterSuccess:()=>afterSuccess++});await h.get('smart-delete-confirm').onclick();
 assert.equal(h.get('smart-delete-dialog').open,true,'backend failure keeps the confirmation surface open');assert.equal(h.get('smart-delete-error').hidden,false);assert.match(h.get('smart-delete-error').textContent,/offline/);assert.equal(h.getRows().length,1,'failed deletion keeps the wallet in the list');assert.equal(h.get('smart-count').textContent,1);assert.equal(afterSuccess,0,'failed deletion cannot close the wallet drawer');
 assert.equal(h.module.removeFromDrawer('not-an-address'),false,'invalid addresses cannot enter the drawer deletion path');
}

// Header selects the current page; filtered selection can include matches across pages.
{
 const h=harness();await h.module.show();const pageToggle=h.get('smart-select-page');assert.equal(pageToggle.disabled,false);pageToggle.onchange({target:{checked:true}});
 assert.equal(h.get('smart-selection-count').textContent,'Vybráno: 20');assert.equal(pageToggle.checked,true);pageToggle.onchange({target:{checked:false}});assert.equal(h.get('smart-selection').hidden,true);
 h.get('smart-search').value='ARB Whale';h.get('smart-search').oninput();assert.equal(h.get('smart-select-filtered').hidden,false);h.get('smart-select-filtered').onclick();assert.equal(h.get('smart-selection-count').textContent,'Vybráno: 1');assert.equal(h.get('smart-select-filtered').hidden,true);
}

// New Smart wallet forms expose the supported list and never offer retired networks.
{
 const h=harness();await h.module.add(address(987),['linea','robinhood']);assert.match(h.get('smart-chains').innerHTML,/Robinhood Chain/);assert.doesNotMatch(h.get('smart-chains').innerHTML,/Linea|Scroll|zkSync/);
}

// Filter-wide selection spans the complete dataset even though the picker renders only one page.
{
 const large=Array.from({length:214},(_,i)=>({...records[i%records.length],address:address(3000+i),name:`Cohort Wallet ${i}`,tags:['Moni Wizards','AlfaDAO'],status:'reviewed',chainIds:['base']}));
 const h=harness({rows:large});await h.module.pick();h.tag('picker','Moni Wizards');h.tag('picker','AlfaDAO');h.mode('picker','all');h.get('smart-picker-tag-count-filter').value='2';h.get('smart-picker-tag-count-filter').onchange();h.get('smart-picker-status').value='reviewed';h.get('smart-picker-chain').value='base';h.get('smart-picker-chain').onchange();
 assert.match(h.get('smart-picker-tags-filter').innerHTML,/Moni Wizards \+ AlfaDAO/,'closed filter summarizes both selected tags');assert.match(h.get('smart-picker-tags-filter').innerHTML,/Všechny \(ALL\)/,'ANY/ALL mode remains available in the tag dropdown');
 assert.equal(h.get('smart-picker-filter-count').textContent,'Filtru odpovídá 214 · Vybráno 0 / 500');assert.equal(h.get('smart-picker-result-count').textContent,'214 výsledků');assert.equal((h.get('smart-picker-list').innerHTML.match(/data-picker-address=/g)||[]).length,100,'the picker renders one page only');
 h.get('smart-picker-select-filter').onclick();assert.equal(h.get('smart-picker-count').textContent,'Vybráno 214 / 500');assert.equal(h.get('smart-picker-filter-count').textContent,'Filtru odpovídá 214 · Vybráno 214 / 500');
 h.get('smart-picker-search').value=large[213].address;h.get('smart-picker-search').oninput();assert.equal(h.get('smart-picker-filter-count').textContent,'Filtru odpovídá 1 · Vybráno 214 / 500');assert.equal(h.get('smart-picker-result-count').textContent,'1 výsledek');h.get('smart-picker-remove-filter').onclick();assert.equal(h.get('smart-picker-count').textContent,'Vybráno 213 / 500');
 h.get('smart-picker-clear').onclick();assert.equal(h.get('smart-picker-count').textContent,'Vybráno 0 / 500');h.get('smart-picker-search').value='';h.get('smart-picker-status').value='reviewed';h.get('smart-picker-chain').value='base';h.tag('picker','Moni Wizards');h.get('smart-picker-select-filter').onclick();h.get('smart-picker-apply').onclick();
 assert.equal(h.analyses[0][0].length,214);assert.equal(h.analyses[0][2].walletMetadata.length,214);assert.deepEqual(Array.from(h.analyses[0][2].walletMetadata[0].tags),['Moni Wizards','AlfaDAO']);assert.equal(h.analyses[0][2].walletMetadata[0].status,'reviewed');
}

// The picker tag control clearly summarizes none/one/two/many selections and preserves them after rerenders.
{
 const h=harness();await h.module.pick();const container=h.get('smart-picker-tags-filter'),control=()=>container.innerHTML,details=()=>container.querySelector('details');
 assert.match(control(),/<details class="smart-tag-filter smart-tag-filter-picker"><summary class="smart-tag-trigger smart-picker-filter-control"/,'picker uses the common Smart-wallet tag filter component');assert.match(control(),/type="checkbox" data-picker-tag-option="DeFi"/,'tag choices remain real checkbox inputs');
 assert.match(control(),/<span class="smart-picker-filter-summary-text">Všechny štítky<\/span>/,'zero selected tags have a compact empty summary');details().open=true;h.tag('picker','DeFi');assert.match(control(),/<span class="smart-picker-filter-summary-text">DeFi<\/span>/,'one selected tag is named in the trigger');assert.equal(details().open,true,'selecting a tag rerenders options without closing the dropdown');h.tag('picker','ARB');assert.match(control(),/<span class="smart-picker-filter-summary-text">DeFi \+ ARB<\/span>/,'two selected tags are shown together');assert.match(control(),/Alespoň jeden \(ANY\)/);h.mode('picker','all');assert.match(control(),/DeFi \+ ARB/);assert.match(control(),/Všechny \(ALL\)/);h.tag('picker','Other');assert.match(control(),/<span class="smart-picker-filter-summary-text">3 štítky<\/span>/,'three or more tags use a count');h.clearTags('picker');assert.match(control(),/Všechny štítky/);
 details().open=true;h.pointerdown({containerId:'smart-picker-tags-filter'});assert.equal(details().open,true,'pointerdown inside the trigger or dropdown keeps it open');
 for(const outside of ['smart-picker-status','smart-picker-chain','smart-picker-search','smart-picker-list','smart-picker-dialog']){details().open=true;h.pointerdown({containerId:outside});assert.equal(details().open,false,`pointerdown outside closes the picker tag dropdown (${outside})`);}
}

// The main Smart-wallet filter reuses the picker dropdown shell and keeps its additional controls intact.
{
 const h=harness();await h.module.show();const container=h.get('smart-tags-filter'),details=()=>container.querySelector('details');
 assert.match(container.innerHTML,/<details class="smart-tag-filter smart-tag-filter-main"><summary class="smart-tag-trigger smart-picker-filter-control"/,'main filter uses the same trigger and dropdown component as the picker');
 assert.match(container.innerHTML,/type="checkbox" data-main-tag-option="DeFi"/,'main filter choices remain native visible checkbox controls');
 details().open=true;h.pointerdown({containerId:'smart-tags-filter'});assert.equal(details().open,true,'interaction inside the main dropdown leaves it open');
 h.tag('main','DeFi');h.tag('main','Other');assert.equal(details().open,true,'checking main-filter tags rerenders without closing the menu');h.pointerdown({containerId:'smart-tags-filter'});h.mode('main','all');assert.equal(details().open,true,'using the ANY/ALL selector does not count as outside interaction');
 for(const outside of ['smart-status-filter','smart-chain-filter','smart-search','smart-table-body']){details().open=true;h.pointerdown({containerId:outside});assert.equal(details().open,false,`outside pointer closes the main tag dropdown (${outside})`);}
 details().open=true;h.keydown('Escape');assert.equal(details().open,false,'Escape closes the main tag dropdown');
 h.get('smart-status-filter').value='reviewed';h.get('smart-chain-filter').value='base';h.get('smart-tag-count-filter').value='2';h.get('smart-search').value='Whale';h.clearTags('main');
 assert.equal(h.get('smart-status-filter').value,'reviewed');assert.equal(h.get('smart-chain-filter').value,'base');assert.equal(h.get('smart-tag-count-filter').value,'2');assert.equal(h.get('smart-search').value,'Whale','clearing tags leaves all other filters unchanged');
 assert.match(styles,/\.smart-tag-filter-menu\{[^}]*width:max\(100%,min\(360px,calc\(100vw - 32px\)\)\);max-width:calc\(100vw - 32px\)/,'shared dropdown is bounded by the viewport and cannot create page-level horizontal overflow');
 assert.match(styles,/\.smart-panel\{overflow:visible\}/,'main Smart-wallet panel does not clip the shared dropdown overlay');
 assert.match(styles,/@media\(max-width:700px\)\{\.smart-tag-filter-main \.smart-tag-filter-menu\{left:auto;right:0\}/,'main dropdown aligns to its trigger within narrow viewports');
}

// A long selected tag remains available in the title while the shared trigger keeps its text constrained.
{
 const longTag='Library on chain · wallets collected from public research';const h=harness({rows:[{...records[0],address:address(80001),tags:[longTag]}]});await h.module.pick();h.tag('picker',longTag);const html=h.get('smart-picker-tags-filter').innerHTML;assert.ok(html.includes(`<span class="smart-picker-filter-summary-text">${longTag}</span>`));assert.ok(html.includes(`title="${longTag}"`));
}

// Picker bulk selection always respects the remaining 500-wallet scan capacity.
{
 const small=Array.from({length:104},(_,i)=>({...records[i%records.length],address:address(19000+i),name:`Small cohort ${i}`,tags:['Alpha'],chainIds:['base']}));const all=harness({rows:small});await all.module.pick();assert.equal(all.get('smart-picker-select-filter').textContent,'Vybrat všechny 104');all.get('smart-picker-select-filter').onclick();assert.equal(all.get('smart-picker-count').textContent,'Vybráno 104 / 500');
 const large=Array.from({length:907},(_,i)=>({...records[i%records.length],address:address(20000+i),name:`Large cohort ${i}`,tags:i%2?['Alpha']:['Alpha','Fund'],status:'candidate',chainIds:['base']}));
 const h=harness({rows:[...large,large[0]]});await h.module.pick();assert.equal(h.get('smart-picker-result-count').textContent,'907 výsledků','duplicate stored rows do not inflate the filter count');
 assert.equal(h.get('smart-picker-select-filter').textContent,'Vybrat max. 500');assert.equal(h.get('smart-picker-limit-note').hidden,false);h.get('smart-picker-select-filter').onclick();assert.equal(h.get('smart-picker-count').textContent,'Vybráno 500 / 500');assert.equal(h.get('smart-picker-apply').disabled,false);

 const base=large.slice(0,120).map(w=>w.address),partial=harness({base,rows:large});await partial.module.pick();assert.equal(partial.get('smart-picker-select-filter').textContent,'Vybrat max. 380');partial.get('smart-picker-select-filter').onclick();assert.equal(partial.get('smart-picker-count').textContent,'Vybráno 500 / 500','existing 120 plus at most 380 new unique addresses reaches but never exceeds the cap');assert.equal(partial.get('smart-picker-filter-count').textContent,'Filtru odpovídá 907 · Vybráno 500 / 500');
}

// Main Smart wallets filters compose multi-tag ANY/ALL, exact/minimum tag counts, status, chain and search.
{
 const rows=[
  {...records[0],address:address(910),name:'Alpha target',tags:['Moni Wizards','AlfaDAO','Fund'],status:'reviewed',chainIds:['base']},
  {...records[1],address:address(911),name:'Moni single',tags:['Moni Wizards'],status:'candidate',chainIds:['base']},
  {...records[2],address:address(912),name:'Alfa single',tags:['AlfaDAO'],status:'reviewed',chainIds:['ethereum']},
  {...records[3],address:address(913),name:'Fund whale',tags:['Fund','Whale'],status:'reviewed',chainIds:['base']},
  {...records[4],address:address(914),name:'Case variant target',tags:['moni wizards','AlfaDAO','Venture'],status:'reviewed',chainIds:['base']},
  {...records[5],address:address(915),name:'No tags',tags:[],status:'candidate',chainIds:['base']},
  {...records[6],address:address(916),name:'Fund single',tags:['Fund'],status:'candidate',chainIds:['base']}
 ];
 const h=harness({rows});await h.module.show();assert.match(h.get('smart-range').textContent,/z 7$/);
 h.get('smart-tag-count-filter').value='1';h.get('smart-tag-count-filter').onchange();assert.match(h.get('smart-range').textContent,/z 3$/);
 h.get('smart-tag-count-filter').value='2';h.get('smart-tag-count-filter').onchange();assert.match(h.get('smart-range').textContent,/z 3$/);
 h.get('smart-tag-count-filter').value='3';h.get('smart-tag-count-filter').onchange();assert.match(h.get('smart-range').textContent,/z 2$/);
 h.get('smart-tag-count-filter').value='';h.get('smart-tag-count-filter').onchange();h.tag('main','Moni Wizards');h.tag('main','AlfaDAO');assert.match(h.get('smart-range').textContent,/z 4$/,'multi-tag defaults to ANY');
 assert.equal((h.get('smart-tags-filter').innerHTML.match(/data-main-tag-option="Moni Wizards"/g)||[]).length,1,'case variants produce one tag option, preserving first spelling');
 h.mode('main','all');assert.match(h.get('smart-range').textContent,/z 2$/,'ALL requires every selected tag');
 h.get('smart-tag-count-filter').value='3';h.get('smart-tag-count-filter').onchange();assert.match(h.get('smart-range').textContent,/z 2$/,'ALL composes with minimum tag count');
 h.get('smart-status-filter').value='reviewed';h.get('smart-status-filter').onchange();h.get('smart-chain-filter').value='base';h.get('smart-chain-filter').onchange();h.get('smart-search').value='Case variant';h.get('smart-search').oninput();assert.match(h.get('smart-range').textContent,/z 1$/,'text, tags, count, status and network compose');
 h.removeTag('main','Moni Wizards');assert.match(h.get('smart-range').textContent,/z 1$/,'removing one selected tag keeps the remaining filters active');
 h.clearTags('main');h.get('smart-search').value='';h.get('smart-status-filter').value='';h.get('smart-chain-filter').value='';h.get('smart-tag-count-filter').value='';h.get('smart-tag-count-filter').onchange();assert.match(h.get('smart-range').textContent,/z 7$/,'clear all tags removes the tag constraint');
}

// Main filter-wide selection includes filtered matches beyond the visible page.
{
 const rows=Array.from({length:140},(_,i)=>({...records[i%records.length],address:address(5000+i),name:`Overlap ${i}`,tags:i%2?['Moni Wizards','AlfaDAO']:['Moni Wizards','AlfaDAO','Fund'],status:'reviewed',chainIds:['base']}));
 const h=harness({rows});await h.module.show();h.tag('main','Moni Wizards');h.tag('main','AlfaDAO');h.mode('main','all');h.get('smart-tag-count-filter').value='2';h.get('smart-tag-count-filter').onchange();h.get('smart-status-filter').value='reviewed';h.get('smart-status-filter').onchange();h.get('smart-chain-filter').value='base';h.get('smart-chain-filter').onchange();
 assert.match(h.get('smart-range').textContent,/z 140$/);assert.equal((h.get('smart-table-body').innerHTML.match(/data-smart-select=/g)||[]).length,20);h.get('smart-select-filtered').onclick();assert.equal(h.get('smart-selection-count').textContent,'Vybráno: 140','select all matches every filtered wallet across pages');
}

// Picker ANY/ALL and tag-count filters also compose and feed filter-wide selection.
{
 const rows=[
  {...records[0],address:address(920),name:'Both reviewed',tags:['Moni Wizards','AlfaDAO','Fund'],status:'reviewed',chainIds:['base']},
  {...records[1],address:address(921),name:'Moni reviewed',tags:['Moni Wizards'],status:'reviewed',chainIds:['base']},
  {...records[2],address:address(922),name:'Alfa reviewed',tags:['AlfaDAO','Fund'],status:'reviewed',chainIds:['base']},
  {...records[3],address:address(923),name:'Both other network',tags:['Moni Wizards','AlfaDAO'],status:'reviewed',chainIds:['ethereum']},
  {...records[4],address:address(924),name:'Both candidate',tags:['Moni Wizards','AlfaDAO'],status:'candidate',chainIds:['base']}
 ];
 const h=harness({rows});await h.module.pick();h.tag('picker','Moni Wizards');h.tag('picker','AlfaDAO');h.get('smart-picker-status').value='reviewed';h.get('smart-picker-chain').value='base';h.get('smart-picker-tag-count-filter').value='2';h.get('smart-picker-tag-count-filter').onchange();
 assert.equal(h.get('smart-picker-result-count').textContent,'2 výsledků','ANY includes wallets with either selected tag');h.mode('picker','all');assert.equal(h.get('smart-picker-result-count').textContent,'1 výsledek','ALL excludes wallets missing either tag');h.get('smart-picker-search').value='Both';h.get('smart-picker-search').oninput();assert.equal(h.get('smart-picker-result-count').textContent,'1 výsledek','search is combined with ALL, count, status and chain');
 h.get('smart-picker-select-filter').onclick();assert.equal(h.get('smart-picker-count').textContent,'Vybráno 1 / 500');h.get('smart-picker-search').value='';h.get('smart-picker-search').oninput();h.removeTag('picker','Moni Wizards');assert.equal(h.get('smart-picker-result-count').textContent,'2 výsledků','individual chip removal leaves the other tag active');h.clearTags('picker');assert.equal(h.get('smart-picker-result-count').textContent,'2 výsledků','clear all removes tag constraints');
}

// Real picker events: metadata-only request, combined filters, retained selection, explicit prefill.
{
 const h=harness();await h.module.pick();assert.equal(h.analyses.length,0);assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/smart-wallets');assert.equal(h.get('smart-picker-dialog').open,true);assert.equal(h.get('smart-picker-dialog').getAttribute('closedby'),'none');assert.equal(h.get('smart-picker-dialog').emit('cancel').defaultPrevented,true);assert.equal(h.get('smart-picker-dialog').open,true);assert.equal(h.get('smart-picker-dialog').emit('click',{target:h.get('smart-picker-dialog')}).defaultPrevented,true);assert.equal(h.get('smart-picker-dialog').open,true);
 h.get('smart-picker-search').value='ARB Whale';h.get('smart-picker-search').oninput();assert.match(h.get('smart-picker-list').innerHTML,/ARB Whale/);assert.doesNotMatch(h.get('smart-picker-list').innerHTML,/Wallet 1</);
 h.tag('picker','DeFi');h.get('smart-picker-status').value='reviewed';h.get('smart-picker-chain').value='base';h.get('smart-picker-chain').onchange();assert.equal((h.get('smart-picker-list').innerHTML.match(/data-picker-address=/g)||[]).length,1);
 h.choose(records[0].address);h.get('smart-picker-search').value=records[1].address;h.clearTags('picker');h.get('smart-picker-status').value='';h.get('smart-picker-search').oninput();h.choose(records[1].address);assert.equal(h.get('smart-picker-count').textContent,'Vybráno 2 / 500');assert.equal(h.analyses.length,0);
 h.get('smart-picker-apply').onclick();assert.equal(h.analyses.length,1);assert.deepEqual(h.analyses[0][0],[records[0].address,records[1].address]);assert.deepEqual(h.analyses[0][1],['base']);assert.equal(h.analyses[0][2].append,true);assert.equal(h.get('smart-picker-dialog').open,false);
 const known=h.module.lookup(records[0].address.toUpperCase());assert.equal(known.name,'ARB Whale');assert.equal(known.status,'reviewed');assert.deepEqual(Array.from(known.tags),['DeFi','ARB']);
}

// The limit applies to the union with manually entered addresses, across hidden filtered rows.
{
 const h=harness({base:[address(999)]});await h.module.pick();for(const row of records.slice(0,19))h.choose(row.address);
 assert.equal(h.get('smart-picker-count').textContent,'Vybráno 20 / 500');assert.match(h.get('smart-picker-summary').textContent,/po přidání 20 \/ 500/);
 h.choose(records[19].address);assert.equal(h.get('smart-picker-count').textContent,'Vybráno 21 / 500');
 h.get('smart-picker-apply').onclick();assert.equal(h.analyses[0][0].length,20);
}
// Editing the selected Smart-wallet dataset reopens checked entries as editable while manual addresses stay fixed.
{
 const manual=address(9001),h=harness({base:[manual]});await h.module.pick({baseAddresses:[manual],selectedAddresses:[records[0].address,records[1].address],replaceSmartSelection:true});
 assert.match(h.get('smart-picker-list').innerHTML,/checked/);assert.match(h.get('smart-picker-summary').textContent,/Ve formuláři 1 adres/);h.choose(records[0].address,false);h.get('smart-picker-apply').onclick();
 assert.equal(h.analyses.length,1);assert.deepEqual(h.analyses[0][0],[records[1].address]);assert.equal(h.analyses[0][2].replaceSmartSelection,true);assert.equal(h.analyses[0][2].append,true);
 const clear=harness({base:[manual]});await clear.module.pick({baseAddresses:[manual],selectedAddresses:[records[0].address],replaceSmartSelection:true});clear.choose(records[0].address,false);assert.equal(clear.get('smart-picker-apply').disabled,false,'edit mode can confirm an empty Smart-wallet selection while preserving manual entries');clear.get('smart-picker-apply').onclick();assert.deepEqual(clear.analyses[0][0],[]);assert.equal(clear.analyses[0][2].replaceSmartSelection,true);
}
{
 const h=harness({base:[records[0].address.toUpperCase()],rows:[...records,records[0]]});await h.module.pick();assert.match(h.get('smart-picker-list').innerHTML,/Již ve formuláři/);h.choose(records[0].address);assert.equal(h.get('smart-picker-count').textContent,'Vybráno 1 / 500');
 h.choose(records[1].address);h.choose(records[1].address);assert.equal(h.get('smart-picker-count').textContent,'Vybráno 2 / 500');h.get('smart-picker-apply').onclick();assert.deepEqual(h.analyses[0][0],[records[1].address]);
}

// Unsupported networks are shown and never handed to the scan form.
{
 const h=harness();await h.module.pick();h.get('smart-picker-status').value='excluded';h.get('smart-picker-chain').value='linea';h.get('smart-picker-chain').onchange();assert.match(h.get('smart-picker-list').innerHTML,/nelze analyzovat/);assert.doesNotMatch(h.get('smart-picker-list').innerHTML,/ARB Whale/);
 h.choose(records[22].address);assert.equal(h.get('smart-picker-apply').disabled,true);h.get('smart-picker-apply').onclick();assert.equal(h.analyses.length,0);assert.equal(h.get('smart-picker-dialog').open,true);
 h.choose(records[0].address);h.get('smart-picker-apply').onclick();assert.deepEqual(h.analyses[0][1],['base']);assert.deepEqual(h.analyses[0][2].skippedChainIds,['linea']);
}

// Existing reverse workflow accepts larger cohorts while retaining the 500-address scan cap.
{
 const h=harness();await h.module.show();for(const row of records)h.choose(row.address,true,'smart-table-body');h.get('smart-analyze-selected').onclick();assert.equal(h.analyses.length,1);assert.equal(h.analyses[0][0].length,23);assert.deepEqual(h.analyses[0][1],['base']);assert.equal(h.analyses[0][2].append,false);assert.ok(h.calls.every(x=>x.path==='/api/smart-wallets'));
}
{
 const h=harness({fail:true});await h.module.pick();assert.equal(h.get('smart-picker-apply').disabled,true);assert.match(h.get('smart-picker-error').textContent,/nepodařilo/);assert.equal(h.analyses.length,0);
}
{
 const h=harness();assert.throws(()=>h.parse(`${DEAD_ADDRESS} Moni Wizards`),error=>error.message===IGNORED_WALLET_ADDRESS_ERROR);
 const legacy=harness({rows:[{...records[0],address:DEAD_ADDRESS,name:'Legacy system row'}]});await legacy.module.show();assert.doesNotMatch(legacy.get('smart-table-body').innerHTML,/Legacy system row|0x0{36}dead/,'persisted burn candidates are hidden from the table');assert.equal(legacy.module.lookup(DEAD_ADDRESS),null);
 await legacy.module.pick();assert.doesNotMatch(legacy.get('smart-picker-list').innerHTML,/Legacy system row|0x0{36}dead/,'persisted burn candidates are hidden from discovery selection');
}
console.log('Smart wallet UI regressions passed: multi-tag ANY/ALL and count filters, cross-page selection, picker limits, network/status/search combinations, supported networks, prefill and identity.');
