import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../dist/smart-wallets.js',import.meta.url),'utf8')).replace('export function initSmartWallets','function initSmartWallets');
const address=i=>'0x'+i.toString(16).padStart(40,'0');
const records=Array.from({length:23},(_,i)=>({address:address(i+10),name:i===0?'ARB Whale':'Wallet '+i,tags:i===0?['DeFi','ARB']:['Other'],status:i===0?'reviewed':i===22?'excluded':'candidate',chainIds:i===22?['linea']:['base'],source:'Fixture',note:'',updatedAt:new Date().toISOString()}));

function harness({base=[],rows=records,fail=false}={}){
 const elements=new Map(),calls=[],analyses=[],toasts=[],documentListeners=new Map();let serverRows=[...rows];
 const document={getElementById(id){if(!elements.has(id)){const listeners=new Map();elements.set(id,{value:'',innerHTML:'',textContent:'',hidden:false,disabled:false,checked:false,open:false,addEventListener(type,handler){listeners.set(type,handler);},emit(type,target={}){return listeners.get(type)?.({target,...target});},showModal(){this.open=true;},close(){this.open=false;},focus(){},reset(){},querySelectorAll(selector){return id==='smart-chains'&&selector==='input:checked'?[{value:'base'}]:[];}});}return elements.get(id);},addEventListener(type,handler){documentListeners.set(type,handler);}};
 const context=vm.createContext({document,location:{protocol:'http:'},URL,Blob,setTimeout,fetch:async(path,options={})=>{calls.push({path,options});if(fail)throw Error('offline');const payload=options.body?JSON.parse(options.body):{};let result;
  if(options.method==='POST'&&path.endsWith('/import-preview')){const existingCount=payload.entries.filter(entry=>serverRows.some(row=>row.address===entry.address)).length;result={newCount:payload.entries.length-existingCount,existingCount};}
  else if(options.method==='POST'){const created=[],updated=[],unchanged=[];for(const entry of payload.entries){const row=serverRows.find(w=>w.address===entry.address);if(!row){created.push(entry.address);serverRows.push({...entry,name:entry.name||payload.name,tags:payload.tags,source:payload.source,note:payload.note,status:payload.status,chainIds:payload.chainIds});}else if(payload.updateExisting){updated.push(entry.address);row.name=entry.name||payload.name||row.name;row.tags=payload.tagsMode==='replace'?payload.tags:[...new Set([...row.tags,...payload.tags])];row.source=payload.source||row.source;row.note=payload.note||row.note;row.status=payload.status;row.chainIds=payload.networksMode==='add'?[...new Set([...row.chainIds,...payload.chainIds])]:payload.chainIds;}else unchanged.push(entry.address);}result={created,updated,unchanged};}
  else if(options.method==='PATCH'){for(const row of serverRows.filter(w=>payload.addresses.includes(w.address))){const change=payload.changes;if(change.tags){if(change.tags.mode==='replace')row.tags=[...change.tags.values];else if(change.tags.mode==='add')row.tags=[...new Set([...row.tags,...change.tags.values])];else row.tags=row.tags.filter(t=>!change.tags.values.includes(t));}for(const key of ['status','source','chainIds','note'])if(Object.hasOwn(change,key))row[key]=change[key];}result={updated:payload.addresses,missing:[]};}
  else if(options.method==='DELETE'){const ids=path==='/api/smart-wallets'?payload.addresses:[path.split('/').at(-1)];const deleted=serverRows.filter(w=>ids.includes(w.address)).map(w=>w.address);serverRows=serverRows.filter(w=>!ids.includes(w.address));result=path==='/api/smart-wallets'?{deleted,missing:ids.filter(id=>!deleted.includes(id))}:{deleted:true,address:deleted[0]};}
  else result={wallets:serverRows};return {ok:true,headers:{get:()=> 'application/json'},json:async()=>result};}});
 vm.runInContext(source+'\nglobalThis.init=initSmartWallets;globalThis.parseBulkWalletEntries=parseBulkWalletEntries;',context);
 const module=context.init({networks:[{id:'ethereum',name:'Ethereum',live:true},{id:'base',name:'Base',live:true},{id:'optimism',name:'Optimism',live:true},{id:'arbitrum',name:'Arbitrum',live:true},{id:'robinhood',name:'Robinhood Chain',live:true}],legacyNetworks:[{id:'linea',name:'Linea',live:false,legacy:true}],toast:x=>toasts.push(x),getLiveWatchlist:()=>[],getAnalysisAddresses:()=>base,supportsWalletChain:id=>['base','ethereum','optimism','arbitrum','robinhood'].includes(id),analyze:(...args)=>{analyses.push(JSON.parse(JSON.stringify(args)));return true;}});
 const get=id=>document.getElementById(id);
 const choose=(id,checked=true,table='smart-picker-list')=>{const target={checked,dataset:table==='smart-picker-list'?{pickerAddress:id}:{smartSelect:id}};get(table).emit('change',target);return target;};
 const click=button=>documentListeners.get('click')?.({target:{closest:()=>button}});
 return {module,get,calls,analyses,toasts,choose,parse:context.parseBulkWalletEntries,click,getRows:()=>serverRows};
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
 h.get('smart-tags').value='whale, defi';h.get('smart-source').value='DeBank';h.get('smart-note').value='Imported';h.get('smart-status').value='reviewed';
 await h.get('smart-form').emit('submit',{preventDefault(){}});
 const body=JSON.parse(h.calls.find(c=>c.options.method==='POST'&&c.path==='/api/smart-wallets').options.body);
 assert.deepEqual(body.entries,[{address:A,name:'artur2'},{address:B,name:'Spartan group'},{address:C}]);assert.equal(body.name,'DeBank wallet');
 assert.deepEqual(body.tags,['whale','defi']);assert.equal(body.source,'DeBank');assert.equal(body.note,'Imported');assert.equal(body.status,'reviewed');assert.deepEqual(body.chainIds,['base']);assert.equal(body.updateExisting,false);assert.ok(h.calls.some(c=>c.path.endsWith('/import-preview')));assert.ok(h.toasts.includes('Přidáno 3, aktualizováno 0, beze změny 0.'));
}

// Existing addresses open a safe-choice dialog; update sends the selected merge modes.
{
 const existing={...records[0],address:address(901),name:'Original name',tags:['DeBank'],source:'Old source',note:'Keep this note',chainIds:['base','ethereum']};
 const h=harness({rows:[existing]});await h.module.show();h.get('smart-addresses').value=`${existing.address} - Arthur Hayes`;h.get('smart-name').value='Common fallback';h.get('smart-tags').value='MoniWizards';h.get('smart-source').value='Cielo';h.get('smart-note').value='';h.get('smart-status').value='reviewed';
  const save=h.get('smart-form').emit('submit',{preventDefault(){}});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(h.get('smart-import-conflict-dialog').open,true);assert.match(h.get('smart-import-conflict-counts').textContent,/Nových adres: 0\. Již evidovaných adres: 1/);assert.equal(h.get('smart-import-mode-keep').checked,true);assert.equal(h.get('smart-import-tags-mode').value,'add');assert.equal(h.get('smart-import-networks-mode').value,'replace');
 h.get('smart-import-mode-update').checked=true;h.get('smart-import-mode-update').onchange();h.get('smart-import-tags-mode').value='add';h.get('smart-import-networks-mode').value='add';h.get('smart-import-continue').onclick();await save;
 const payload=JSON.parse(h.calls.find(c=>c.options.method==='POST'&&c.path==='/api/smart-wallets').options.body);assert.equal(payload.updateExisting,true);assert.equal(payload.tagsMode,'add');assert.equal(payload.networksMode,'add');
 assert.equal(h.getRows()[0].name,'Arthur Hayes');assert.deepEqual(h.getRows()[0].tags,['DeBank','MoniWizards']);assert.equal(h.getRows()[0].source,'Cielo');assert.equal(h.getRows()[0].note,'Keep this note');assert.deepEqual(h.getRows()[0].chainIds,['base','ethereum']);assert.ok(h.toasts.includes('Přidáno 0, aktualizováno 1, beze změny 0.'));
}

// Bulk management has no 20-wallet cap, sends only checked fields, and preserves imported names.
{
 const bulkRows=Array.from({length:24},(_,i)=>({...records[i%records.length],address:address(700+i),name:`Imported wallet ${i}`,tags:['seed'],source:'DeBank',note:`private ${i}`,status:'candidate',chainIds:['base']}));
 const h=harness({rows:bulkRows});await h.module.show();for(const row of bulkRows)h.choose(row.address,true,'smart-table-body');
 assert.equal(h.get('smart-selection').hidden,false);assert.equal(h.get('smart-selection-count').textContent,'Vybráno: 24');assert.equal(h.get('smart-analyze-selected').disabled,false);
 h.get('smart-bulk-edit').onclick();assert.equal(h.get('smart-bulk-edit-dialog').open,true);assert.equal(h.get('smart-bulk-edit-count').textContent,'Upravit 24 peněženek');
 h.get('smart-bulk-tags-enabled').checked=true;h.get('smart-bulk-tags-enabled').onchange({target:{checked:true}});h.get('smart-bulk-tags-mode').value='add';h.get('smart-bulk-tags').value='fonds&whales';
 await h.get('smart-bulk-edit-form').emit('submit',{preventDefault(){}});const request=h.calls.find(c=>c.options.method==='PATCH'),payload=JSON.parse(request.options.body);
 assert.equal(payload.addresses.length,24);assert.deepEqual(Object.keys(payload.changes),['tags']);assert.deepEqual(payload.changes.tags,{mode:'add',values:['fonds&whales']});
 assert.ok(h.getRows().every(w=>w.tags.includes('seed')&&w.tags.includes('fonds&whales')&&w.name.startsWith('Imported wallet')&&w.source==='DeBank'&&w.note.startsWith('private ')));
 assert.equal(h.get('smart-selection').hidden,true);assert.ok(h.toasts.includes('Upraveno 24 peněženek.'));
}

// Single deletion names the wallet in its confirmation; bulk deletion confirms and removes selected rows.
{
 const h=harness({rows:records.slice(0,3)});await h.module.show();
 await h.click({dataset:{smartDelete:records[0].address},hasAttribute:()=>false});assert.equal(h.get('smart-delete-dialog').open,true);assert.match(h.get('smart-delete-message').textContent,/ARB Whale/);
 await h.get('smart-delete-confirm').onclick();assert.equal(h.getRows().some(w=>w.address===records[0].address),false);assert.ok(h.toasts.includes('Smazáno 1 peněženka.'));
 h.choose(records[1].address,true,'smart-table-body');h.choose(records[2].address,true,'smart-table-body');h.get('smart-bulk-delete').onclick();assert.match(h.get('smart-delete-message').textContent,/trvale smazat 2 Smart wallets/);
 await h.get('smart-delete-confirm').onclick();const bulkDelete=h.calls.find(c=>c.options.method==='DELETE'&&c.path==='/api/smart-wallets');assert.deepEqual(JSON.parse(bulkDelete.options.body).addresses,[records[1].address,records[2].address]);assert.equal(h.getRows().length,0);assert.equal(h.get('smart-selection').hidden,true);
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
 const large=Array.from({length:214},(_,i)=>({...records[i%records.length],address:address(3000+i),name:`Cohort Wallet ${i}`,tags:['Moni Wizards'],status:'reviewed',chainIds:['base']}));
 const h=harness({rows:large});await h.module.pick();h.get('smart-picker-tag').value='Moni Wizards';h.get('smart-picker-status').value='reviewed';h.get('smart-picker-chain').value='base';h.get('smart-picker-chain').onchange();
 assert.equal(h.get('smart-picker-filter-count').textContent,'Filtru odpovídá: 214 · vybráno: 0');assert.equal((h.get('smart-picker-list').innerHTML.match(/data-picker-address=/g)||[]).length,100,'the picker renders one page only');
 h.get('smart-picker-select-filter').onclick();assert.equal(h.get('smart-picker-count').textContent,'Vybráno 214 / 500');assert.match(h.get('smart-picker-filter-count').textContent,/vybráno: 214/);
 h.get('smart-picker-search').value=large[213].address;h.get('smart-picker-search').oninput();assert.equal(h.get('smart-picker-filter-count').textContent,'Filtru odpovídá: 1 · vybráno: 1');h.get('smart-picker-remove-filter').onclick();assert.equal(h.get('smart-picker-count').textContent,'Vybráno 213 / 500');
 h.get('smart-picker-clear').onclick();assert.equal(h.get('smart-picker-count').textContent,'Vybráno 0 / 500');h.get('smart-picker-tag').value='Moni Wizards';h.get('smart-picker-search').value='';h.get('smart-picker-status').value='reviewed';h.get('smart-picker-chain').value='base';h.get('smart-picker-chain').onchange();h.get('smart-picker-select-filter').onclick();h.get('smart-picker-apply').onclick();
 assert.equal(h.analyses[0][0].length,214);assert.equal(h.analyses[0][2].walletMetadata.length,214);assert.deepEqual(Array.from(h.analyses[0][2].walletMetadata[0].tags),['Moni Wizards']);assert.equal(h.analyses[0][2].walletMetadata[0].status,'reviewed');
}

// Real picker events: metadata-only request, combined filters, retained selection, explicit prefill.
{
 const h=harness();await h.module.pick();assert.equal(h.analyses.length,0);assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/smart-wallets');assert.equal(h.get('smart-picker-dialog').open,true);
 h.get('smart-picker-search').value='ARB Whale';h.get('smart-picker-search').oninput();assert.match(h.get('smart-picker-list').innerHTML,/ARB Whale/);assert.doesNotMatch(h.get('smart-picker-list').innerHTML,/Wallet 1</);
 h.get('smart-picker-tag').value='DeFi';h.get('smart-picker-status').value='reviewed';h.get('smart-picker-chain').value='base';h.get('smart-picker-chain').onchange();assert.equal((h.get('smart-picker-list').innerHTML.match(/data-picker-address=/g)||[]).length,1);
 h.choose(records[0].address);h.get('smart-picker-search').value=records[1].address;h.get('smart-picker-tag').value='';h.get('smart-picker-status').value='';h.get('smart-picker-search').oninput();h.choose(records[1].address);assert.equal(h.get('smart-picker-count').textContent,'Vybráno 2 / 500');assert.equal(h.analyses.length,0);
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
console.log('Smart wallet UI regressions passed: picker filters, multiple selection, combined limit, deduplication, supported networks, reverse prefill and identity.');
