import {MAX_WALLET_SCAN,IGNORED_WALLET_ADDRESS_ERROR,debankProfileUrl,isIgnoredWalletAddress} from './data.js';
function parseBulkWalletEntries(value){
 const entries=[],seen=new Set();
 for(const [index,line] of String(value).split(/\r?\n/).entries()){
  const source=line.trim();if(!source)continue;
  const match=source.match(/^(0x[\da-fA-F]{40})(.*)$/);
  if(!match||match[2]&&!/^[\s,;-]/.test(match[2]))throw Error(`Neplatná EVM adresa na řádku ${index+1}.`);
  const address=match[1].toLowerCase(),suffix=match[2].replace(/^\s*(?:-\s*|[,;]\s*)?/,'').trim();
  if(suffix.length>100&&!suffix.split(/[\s,;]+/).every(item=>/^0x[\da-fA-F]{40}$/.test(item)))throw Error(`Vlastní název na řádku ${index+1} je delší než 100 znaků.`);
  const bareAddresses=suffix?suffix.split(/[\s,;]+/):[];
  const lineEntries=!suffix?[{address}]:bareAddresses.every(item=>/^0x[\da-fA-F]{40}$/.test(item))?[{address},...bareAddresses.map(item=>({address:item.toLowerCase()}))]:[{address,name:suffix}];
  for(const entry of lineEntries){
   if(!/^0x[\da-f]{40}$/.test(entry.address))throw Error(`Neplatná EVM adresa na řádku ${index+1}.`);
   if(isIgnoredWalletAddress(entry.address))throw Error(IGNORED_WALLET_ADDRESS_ERROR);
   if(!seen.has(entry.address)){seen.add(entry.address);entries.push(entry);}
  }
 }
 if(!entries.length)throw Error('Vložte 1 až 200 platných EVM adres.');
 if(entries.length>200)throw Error('Vložte nejvýše 200 unikátních EVM adres.');
 return entries;
}
export function initSmartWallets({networks,legacyNetworks=[],toast,analyze,getLiveWatchlist,getAnalysisAddresses=()=>[],onChange=()=>{},supportsWalletChain=id=>!!networks.find(n=>n.id===id)?.live}){
 const el=id=>document.getElementById(id);
 function protectDialog(id){const dialog=el(id);dialog.setAttribute('closedby','none');dialog.addEventListener('cancel',event=>event.preventDefault());dialog.addEventListener('click',event=>{if(event.target===dialog)event.preventDefault();});}
 for(const id of ['smart-dialog','smart-import-conflict-dialog','smart-picker-dialog','smart-bulk-edit-dialog','smart-delete-dialog'])protectDialog(id);
 el('smart-dialog-close').onclick=()=>el('smart-dialog').close();
 const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const walletAddressHtml=address=>{const url=debankProfileUrl(address);return url?`<a class="smart-address smart-address-link" href="${html(url)}" target="_blank" rel="noopener noreferrer">${html(address)}</a>`:`<div class="smart-address">${html(address)}</div>`;};
 const networkName=id=>networks.find(n=>n.id===id)?.name||legacyNetworks.find(n=>n.id===id)?.name||id;
 const labels={candidate:'Kandidát',reviewed:'Prověřená ručně',excluded:'Vyřazená'};
 let wallets=[],selected=new Set(),editing=null,loaded=false,loading=false,saving=false,page=1,requestId=0,mainTags=new Set(),mainTagMode='any',pickerTags=new Set(),pickerTagMode='any',pickerReplaceSmartMode=false;
 let pickerSelected=new Set(),pickerBase=new Set(),pickerLoading=false,pickerRevision=0,pickerPage=1;
 async function api(path='',options={}){
  if(location.protocol==='file:')throw new Error('Evidence vyžaduje lokální server. Spusťte npm run dev a otevřete http://127.0.0.1:4173/.');
  const response=await fetch('/api/smart-wallets'+path,{credentials:'same-origin',...options,headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{})}});
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('Restartujte lokální server, aby se načetla evidence peněženek.');
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Evidence není dostupná.');return result;
 }
 function error(message=''){el('smart-error').textContent=message;el('smart-error').hidden=!message;}
 const tagKey=tag=>String(tag).trim().toLocaleLowerCase('en-US');
 function uniqueTags(){const result=[],seen=new Set();for(const tag of wallets.flatMap(w=>w.tags)){const key=tagKey(tag);if(key&&!seen.has(key)){seen.add(key);result.push(tag);}}return result.sort((a,b)=>a.localeCompare(b,'cs',{sensitivity:'base'}));}
 function createTagInput(inputId,chipsId,suggestionsId,editorId){
  const input=el(inputId),chips=el(chipsId),suggestions=el(suggestionsId),editor=el(editorId);let values=[],opened=false,activeIndex=-1,choices=[];
  const exactTag=value=>uniqueTags().find(tag=>tagKey(tag)===tagKey(value));
  function render(){
   chips.innerHTML=values.map((tag,index)=>`<span class="smart-value-chip">${html(tag)}<button type="button" data-tag-remove="${index}" aria-label="Odebrat štítek ${html(tag)}">×</button></span>`).join('');
   const query=input.value.trim(),queryKey=tagKey(query),remaining=uniqueTags().filter(tag=>!values.some(value=>tagKey(value)===tagKey(tag))&&(!query||tagKey(tag).includes(queryKey))),alreadySelected=values.some(tag=>tagKey(tag)===queryKey),canAdd=values.length<12;
   choices=remaining.map(value=>({kind:'existing',value}));if(query&&!exactTag(query)&&!alreadySelected)choices.push({kind:'new',value:query});
   activeIndex=Math.min(activeIndex,choices.length-1);
   suggestions.innerHTML=`<strong class="smart-tag-suggestions-title">Existující štítky</strong>${remaining.map((tag,index)=>`<button type="button" role="option" data-tag-option="${html(tag)}" aria-selected="${activeIndex===index}" ${canAdd?'':'disabled'}>${html(tag)}</button>`).join('')}${query&&!exactTag(query)&&!alreadySelected?`<button type="button" class="smart-tag-create" role="option" data-tag-create="" aria-selected="${activeIndex===choices.length-1}" ${canAdd?'':'disabled'}>Vytvořit nový štítek „${html(query)}“</button>`:''}${!remaining.length&&!query?'<span class="smart-tag-empty">Zatím nejsou uložené žádné štítky.</span>':''}${!canAdd?'<span class="smart-tag-limit">Limit 12 štítků je dosažen.</span>':''}`;
   suggestions.hidden=!opened||input.disabled;input.setAttribute('aria-expanded',String(!suggestions.hidden));
  }
  function add(raw){const value=String(raw||'').trim();if(!value)return false;if(values.length>=12)return false;const canonical=exactTag(value)||value;if(values.some(tag=>tagKey(tag)===tagKey(canonical))){input.value='';activeIndex=-1;render();return true;}if(canonical.length>40)return false;values.push(canonical);input.value='';activeIndex=-1;render();return true;}
  function choose(index){const choice=choices[index];if(!choice)return;add(choice.value);input.focus();opened=true;render();}
  input.onfocus=()=>{opened=true;activeIndex=-1;render();};input.oninput=()=>{opened=true;activeIndex=-1;render();};
  input.onkeydown=event=>{if(event.key==='ArrowDown'&&choices.length){event.preventDefault();activeIndex=(activeIndex+1)%choices.length;render();}else if(event.key==='ArrowUp'&&choices.length){event.preventDefault();activeIndex=activeIndex<=0?choices.length-1:activeIndex-1;render();}else if(event.key==='Enter'){event.preventDefault();if(activeIndex>=0)choose(activeIndex);else add(input.value);}else if(event.key==='Escape'&&!suggestions.hidden){event.preventDefault();event.stopPropagation?.();opened=false;render();}};
  input.onblur=()=>setTimeout(()=>{opened=false;activeIndex=-1;render();},120);
  suggestions.addEventListener('click',event=>{const target=event.target.closest?.('[data-tag-option]')||event.target.closest?.('[data-tag-create]')||event.target,dataset=target.dataset||{};if(dataset.tagOption!==undefined)choose(choices.findIndex(choice=>choice.kind==='existing'&&tagKey(choice.value)===tagKey(dataset.tagOption)));else if(dataset.tagCreate!==undefined)choose(choices.findIndex(choice=>choice.kind==='new'));});
  chips.addEventListener('click',event=>{const target=event.target.closest?.('[data-tag-remove]')||event.target,index=Number(target.dataset?.tagRemove);if(Number.isInteger(index)&&index>=0&&index<values.length){values.splice(index,1);render();input.focus();}});
  return {getTags:()=>[...values],setTags(tags=[]){values=[];for(const raw of tags){const value=String(raw||'').trim(),canonical=exactTag(value)||value;if(value&&value.length<=40&&!values.some(tag=>tagKey(tag)===tagKey(canonical))&&values.length<12)values.push(canonical);}input.value='';opened=false;activeIndex=-1;render();},setDisabled(disabled){input.disabled=disabled;editor.setAttribute('aria-disabled',String(disabled));if(disabled){opened=false;activeIndex=-1;}render();}};
 }
 const formTagInput=createTagInput('smart-tags','smart-tags-chips','smart-tags-suggestions','smart-tags-editor'),bulkTagInput=createTagInput('smart-bulk-tags','smart-bulk-tags-chips','smart-bulk-tags-suggestions','smart-bulk-tags-editor');
 function tagsMatch(wallet,selection,mode){const tags=new Set(wallet.tags.map(tagKey));return !selection.size||(mode==='all'?[...selection].every(tag=>tags.has(tagKey(tag))):[...selection].some(tag=>tags.has(tagKey(tag))));}
 function countMatch(wallet,value){const count=new Set(wallet.tags.map(tagKey)).size;if(!value)return true;const min=Number(value);return min===1?count===1:count>=min;}
 function renderTagFilter(containerId,scope,selection,mode){
  const container=el(containerId),opened=container.querySelector?.('details')?.open||false,tags=uniqueTags(),removeAttr=scope==='main'?'data-main-tag-remove':'data-picker-tag-remove',optionAttr=scope==='main'?'data-main-tag-option':'data-picker-tag-option',modeAttr=scope==='main'?'data-main-tag-mode':'data-picker-tag-mode',clearAttr=scope==='main'?'data-main-tag-clear':'data-picker-tag-clear';
  const selected=[...selection],summary=scope==='picker'?(!selected.length?'Všechny štítky':selected.length===1?selected[0]:selected.length===2?selected.join(' + '):`${selected.length} štítky`):`Štítky${selected.length?` · ${selected.length}`:''}`;
  container.innerHTML=`<details class="smart-tag-filter smart-tag-filter-${scope}"><summary class="smart-tag-trigger smart-picker-filter-control" title="${html(selected.join(' + ')||'Všechny štítky')}"><span class="smart-picker-filter-summary-text">${html(summary)}</span><svg class="smart-picker-chevron" viewBox="0 0 12 8" aria-hidden="true"><path d="m1 1 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></summary><div class="smart-tag-filter-menu"><div class="smart-tag-chips">${selected.map(tag=>`<button type="button" class="smart-tag-chip" ${removeAttr}="${html(tag)}" aria-label="Odebrat štítek ${html(tag)}">${html(tag)} <span aria-hidden="true">×</span></button>`).join('')||'<span class="smart-filter-hint">Bez omezení štítků</span>'}</div>${selected.length>1?`<label class="smart-tag-mode"><span>Shoda</span><select ${modeAttr}><option value="any" ${mode==='any'?'selected':''}>Alespoň jeden (ANY)</option><option value="all" ${mode==='all'?'selected':''}>Všechny (ALL)</option></select></label>`:''}<div class="smart-tag-options">${tags.map(tag=>`<label><input type="checkbox" ${optionAttr}="${html(tag)}" ${selected.some(value=>tagKey(value)===tagKey(tag))?'checked':''}> <span>${html(tag)}</span></label>`).join('')||'<span class="smart-filter-hint">Zatím bez štítků</span>'}</div><button type="button" class="text-button smart-tag-clear" ${clearAttr}>Zrušit všechny štítky</button></div></details>`;
  const details=container.querySelector?.('details');if(details)details.open=opened;
 }
 function bindTagFilter(containerId,scope,selection,setMode,onChange){const container=el(containerId),optionAttr=scope==='main'?'mainTagOption':'pickerTagOption',removeAttr=scope==='main'?'mainTagRemove':'pickerTagRemove',clearAttr=scope==='main'?'mainTagClear':'pickerTagClear',modeAttr=scope==='main'?'mainTagMode':'pickerTagMode';
  document.addEventListener('pointerdown',event=>{const details=container.querySelector?.('details');if(!details?.open)return;const path=event.composedPath?.();if(path?.includes(container)||container.contains?.(event.target))return;details.open=false;});
  document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;const details=container.querySelector?.('details');if(details?.open){details.open=false;}});
  container.addEventListener('change',event=>{const target=event.target,dataset=target.dataset||{};if(dataset[optionAttr]!==undefined){const tag=dataset[optionAttr],existing=[...selection].find(value=>tagKey(value)===tagKey(tag));if(target.checked&&!existing)selection.add(tag);else if(!target.checked&&existing)selection.delete(existing);onChange();}else if(dataset[modeAttr]!==undefined){setMode(target.value);onChange();}});
  container.addEventListener('click',event=>{const dataset=event.target.dataset||{};if(dataset[removeAttr]!==undefined){const tag=[...selection].find(value=>tagKey(value)===tagKey(dataset[removeAttr]));if(tag)selection.delete(tag);onChange();}else if(dataset[clearAttr]!==undefined){selection.clear();onChange();}});
 }
 function filtered(){const q=el('smart-search').value.trim().toLowerCase(),status=el('smart-status-filter').value,chain=el('smart-chain-filter').value,count=el('smart-tag-count-filter').value;
  return wallets.filter(w=>(!status||w.status===status)&&(!chain||w.chainIds.includes(chain))&&tagsMatch(w,mainTags,mainTagMode)&&countMatch(w,count)&&(!q||[w.address,w.name,w.source,w.note,...w.tags].join(' ').toLowerCase().includes(q)));
 }
 function filteredPicker(){const q=el('smart-picker-search').value.trim().toLowerCase(),status=el('smart-picker-status').value,chain=el('smart-picker-chain').value,count=el('smart-picker-tag-count-filter').value;
  return wallets.filter(w=>(!q||[w.name,w.address].join(' ').toLowerCase().includes(q))&&tagsMatch(w,pickerTags,pickerTagMode)&&countMatch(w,count)&&(!status||w.status===status)&&(!chain||w.chainIds.includes(chain)));
 }
 function render(){
  renderTagFilter('smart-tags-filter','main',mainTags,mainTagMode);
  const chain=el('smart-chain-filter').value,chains=[...new Set(wallets.flatMap(w=>w.chainIds))].sort();el('smart-chain-filter').innerHTML='<option value="">Všechny sítě</option>'+chains.map(id=>`<option value="${html(id)}">${html(networkName(id))}</option>`).join('');el('smart-chain-filter').value=chains.includes(chain)?chain:'';
  const rows=filtered(),pages=Math.max(1,Math.ceil(rows.length/20));page=Math.min(page,pages);const visible=rows.slice((page-1)*20,page*20);
  const pageSelected=visible.filter(w=>selected.has(w.address)).length,pageCheckbox=el('smart-select-page');pageCheckbox.checked=visible.length>0&&pageSelected===visible.length;pageCheckbox.indeterminate=pageSelected>0&&pageSelected<visible.length;pageCheckbox.disabled=!visible.length;
  const filterActive=!!(el('smart-search').value.trim()||el('smart-status-filter').value||el('smart-chain-filter').value||el('smart-tag-count-filter').value||mainTags.size),filterSelection=rows.filter(w=>selected.has(w.address)).length;
  el('smart-select-filtered').hidden=!filterActive||!rows.length||filterSelection===rows.length;el('smart-select-filtered').textContent=`Vybrat všechny filtrované (${rows.length})`;
  el('smart-count').textContent=wallets.length;el('smart-total').textContent=wallets.length;el('smart-candidates').textContent=wallets.filter(w=>w.status==='candidate').length;el('smart-reviewed').textContent=wallets.filter(w=>w.status==='reviewed').length;
  el('smart-table-body').innerHTML=visible.map(w=>{const systemAddress=isIgnoredWalletAddress(w.address);return `<tr><td><input type="checkbox" data-smart-select="${w.address}" aria-label="Vybrat ${html(w.name||w.address)}" ${selected.has(w.address)?'checked':''}></td><td><button class="address-button" data-smart-edit="${w.address}">${html(w.name||w.address.slice(0,6)+'…'+w.address.slice(-4))}</button>${walletAddressHtml(w.address)}${systemAddress?'<span class="smart-system-warning">Systémová burn/dead adresa</span>':''}${w.source?`<div class="smart-source">Zdroj: ${html(w.source)}</div>`:''}</td><td><span class="smart-status ${w.status}">${labels[w.status]}</span></td><td><div class="smart-tags">${w.tags.map(t=>`<span>${html(t)}</span>`).join('')||'<span class="pending-dot">Bez štítku</span>'}</div><div class="smart-networks">${w.chainIds.map(id=>html(networkName(id))).join(' · ')}</div></td><td><div class="smart-note">${html(w.note||'—')}</div><small class="smart-date">${html(new Date(w.updatedAt).toLocaleDateString('cs-CZ'))}</small></td><td><div class="smart-row-tools"><button class="subtle-button" data-smart-edit="${w.address}">Upravit</button><button class="text-button" data-smart-analyze="${w.address}" ${systemAddress?'disabled':''}>Analyzovat ↗</button><button class="text-button" data-smart-delete="${w.address}">Smazat</button></div></td></tr>`;}).join('');
  el('smart-empty').hidden=!!rows.length;el('smart-empty').innerHTML=loading?'Načítám evidenci…':!loaded?'Evidence zatím není načtená. Zkuste obnovit seznam.':wallets.length?'Žádné adresy neodpovídají filtru.':'<strong>Váš výzkum začíná první adresou.</strong><p>Přidejte kandidáta, poznamenejte si důvod a postupně budujte vlastní seznam.</p><button class="primary-button" data-smart-new>Přidat peněženku +</button>';
  el('smart-range').textContent=rows.length?`${(page-1)*20+1}–${Math.min(page*20,rows.length)} z ${rows.length}`:'0 adres';el('smart-page').textContent=page;el('smart-prev').disabled=page===1;el('smart-next').disabled=page===pages;
  el('smart-selection').hidden=!selected.size;el('smart-selection-count').textContent=`Vybráno: ${selected.size}${selected.size>MAX_WALLET_SCAN?` · jeden sken max. ${MAX_WALLET_SCAN}`:''}`;el('smart-analyze-selected').disabled=!selected.size||selected.size>MAX_WALLET_SCAN;el('smart-analyze-selected').title=selected.size>MAX_WALLET_SCAN?`Jeden sken je omezený na ${MAX_WALLET_SCAN} adres. Hromadní správa limit nemá.`:'';
  el('smart-export').disabled=!loaded||!wallets.length;el('smart-refresh').disabled=loading;
 }
 async function refresh({quiet=false}={}){const id=++requestId;loading=true;if(!quiet)error();render();try{const result=await api();if(id!==requestId)return false;wallets=[...new Map((result.wallets||[]).filter(w=>!isIgnoredWalletAddress(w.address)).map(w=>[w.address.toLowerCase(),{...w,address:w.address.toLowerCase()}])).values()];loaded=true;selected=new Set([...selected].filter(a=>wallets.some(w=>w.address===a)));onChange();return true;}catch(e){if(id===requestId&&!quiet)error(e.message);return false;}finally{if(id===requestId){loading=false;render();}}}
 function open(address='',chainIds){
  const existing=wallets.find(w=>w.address===address.toLowerCase());editing=existing?.address||null;
  el('smart-form').reset();el('smart-form-error').hidden=true;el('smart-dialog-title').textContent=editing?'Upravit peněženku':'Přidat peněženky';
  el('smart-addresses').value=existing?.address||address;el('smart-addresses').readOnly=!!editing;el('smart-addresses').rows=editing?2:3;
  el('smart-name').value=existing?.name||'';formTagInput.setTags(existing?.tags||[]);el('smart-source').value=existing?.source||'';el('smart-note').value=existing?.note||'';el('smart-status').value=existing?.status||'candidate';
  const chains=existing?.chainIds||chainIds?.filter(id=>networks.some(n=>n.id===id))||networks.filter(n=>supportsWalletChain(n.id)).map(n=>n.id);
  const legacyNames={zksync:'zkSync Era',scroll:'Scroll',linea:'Linea'};
  const archived=(existing?.chainIds||[]).filter(id=>legacyNames[id]&&!networks.some(n=>n.id===id));
  el('smart-chains').innerHTML=[...networks.map(n=>`<label><input type="checkbox" name="smart-chain" value="${html(n.id)}" ${chains.includes(n.id)?'checked':''}> ${html(n.name)}</label>`),...archived.map(id=>`<label><input type="checkbox" name="smart-chain" value="${html(id)}" checked> ${html(legacyNames[id])} <small>(archivní síť uloženého záznamu)</small></label>`)].join('');
  el('smart-form-submit').textContent=editing?'Uložit změny':'Uložit do evidence';el('smart-dialog').showModal();el('smart-addresses').focus();
 }
 function importChoice(preview){
  const dialog=el('smart-import-conflict-dialog'),mergeMode=el('smart-import-mode-merge-tags'),keepMode=el('smart-import-mode-keep'),updateMode=el('smart-import-mode-update'),continueButton=el('smart-import-continue'),close=el('smart-import-cancel');
  el('smart-import-conflict-counts').textContent=`Nových adres: ${preview.newCount}. Již evidovaných adres: ${preview.existingCount}.`;
  el('smart-import-tags-mode').value='add';el('smart-import-networks-mode').value='replace';mergeMode.checked=true;keepMode.checked=false;updateMode.checked=false;el('smart-import-update-options').hidden=true;
  const changeMode=()=>{const updating=updateMode.checked;el('smart-import-update-options').hidden=!updating;continueButton.textContent=updating?'Aktualizovat existující':keepMode.checked?'Ponechat existující beze změny':'Doplnit nové štítky';};
  mergeMode.onchange=changeMode;keepMode.onchange=changeMode;updateMode.onchange=changeMode;changeMode();
  dialog.showModal();
  return new Promise(resolve=>{
   let settled=false;const finish=value=>{if(settled)return;settled=true;dialog.close();resolve(value);};
   continueButton.onclick=()=>{const conflictMode=updateMode.checked?'update':keepMode.checked?'keep':'merge-tags';finish({conflictMode,updateExisting:conflictMode==='update',tagsMode:el('smart-import-tags-mode').value,networksMode:el('smart-import-networks-mode').value});};
   close.onclick=()=>finish(null);el('smart-import-cancel-bottom').onclick=()=>finish(null);
  });
 }
 async function save(event){event.preventDefault();if(saving)return;saving=true;el('smart-form-submit').disabled=true;el('smart-form-error').hidden=true;
  try{
   const entries=parseBulkWalletEntries(el('smart-addresses').value);
   const chainIds=[...el('smart-chains').querySelectorAll('input:checked')].map(n=>n.value);if(!chainIds.length)throw new Error('Vyberte alespoň jednu síť.');
   const record={entries,name:el('smart-name').value,tags:formTagInput.getTags(),source:el('smart-source').value,note:el('smart-note').value,status:el('smart-status').value,chainIds};
   let result;
   if(editing)result=await api('/'+editing,{method:'PUT',body:JSON.stringify(record)});
   else{
    const preview=await api('/import-preview',{method:'POST',body:JSON.stringify({entries})});
    const choice=preview.existingCount?await importChoice(preview):{conflictMode:'keep',updateExisting:false,tagsMode:'add',networksMode:'replace'};
    if(!choice)return;
    result=await api('',{method:'POST',body:JSON.stringify({...record,...choice})});
   }
   el('smart-dialog').close();
   if(editing)toast('Změny uloženy.');
   else{const updated=result.updated?.length||0,unchanged=result.unchanged?.length||0;toast(`Přidáno ${result.created.length}, aktualizováno ${updated}, beze změny ${unchanged}.`);}
   await refresh();
  }catch(e){el('smart-form-error').textContent=e.message;el('smart-form-error').hidden=false;}finally{saving=false;el('smart-form-submit').disabled=false;}
 }
 function openBulkEdit(){
  if(!selected.size)return;
  const form=el('smart-bulk-edit-form');form.reset();el('smart-bulk-edit-error').hidden=true;el('smart-bulk-edit-count').textContent=`Upravit ${selected.size} peněženek`;
  el('smart-bulk-chains').innerHTML=networks.map(n=>`<label><input type="checkbox" value="${html(n.id)}" disabled> ${html(n.name)}</label>`).join('');
  const controls={tags:['smart-bulk-tags-mode','smart-bulk-tags'],status:['smart-bulk-status'],source:['smart-bulk-source'],note:['smart-bulk-note']};
  for(const [key,ids] of Object.entries(controls))el(`smart-bulk-${key}-enabled`).onchange=event=>ids.forEach(id=>{el(id).disabled=!event.target.checked;});
  bulkTagInput.setTags([]);bulkTagInput.setDisabled(true);el('smart-bulk-tags-mode').disabled=true;
  el('smart-bulk-tags-enabled').onchange=event=>{el('smart-bulk-tags-mode').disabled=!event.target.checked;bulkTagInput.setDisabled(!event.target.checked);};
  el('smart-bulk-chains-enabled').onchange=event=>el('smart-bulk-chains').querySelectorAll('input').forEach(input=>{input.disabled=!event.target.checked;});
  el('smart-bulk-edit-dialog').showModal();
 }
 async function saveBulkEdit(event){
  event.preventDefault();const changes={};el('smart-bulk-edit-error').hidden=true;
  try{
   if(el('smart-bulk-tags-enabled').checked){const values=bulkTagInput.getTags();if(el('smart-bulk-tags-mode').value!=='replace'&&!values.length)throw Error('Zadejte alespoň jeden štítek.');changes.tags={mode:el('smart-bulk-tags-mode').value,values};}
   if(el('smart-bulk-status-enabled').checked)changes.status=el('smart-bulk-status').value;
   if(el('smart-bulk-source-enabled').checked)changes.source=el('smart-bulk-source').value;
   if(el('smart-bulk-chains-enabled').checked){const chainIds=[...el('smart-bulk-chains').querySelectorAll('input:checked')].map(input=>input.value);if(!chainIds.length)throw Error('Vyberte alespoň jednu sledovanou síť.');changes.chainIds=chainIds;}
   if(el('smart-bulk-note-enabled').checked)changes.note=el('smart-bulk-note').value;
   if(!Object.keys(changes).length)throw Error('Zaškrtněte alespoň jedno pole, které chcete změnit.');
   const result=await api('',{method:'PATCH',body:JSON.stringify({addresses:[...selected],changes})});
   selected.clear();el('smart-bulk-edit-dialog').close();toast(`Upraveno ${result.updated.length} peněženek.`);await refresh();
  }catch(error){el('smart-bulk-edit-error').textContent=error.message;el('smart-bulk-edit-error').hidden=false;}
 }
 let deleting=[],deleteAfterSuccess=null,deleteImpact='Smazání odstraní záznamy z databáze a nelze jej vrátit zpět. „Vyřazená“ pouze ponechá peněženku v evidenci.',deleteConfirmLabel='Smazat trvale';
 function requestDelete(addresses,{afterSuccess=null,impact=null,confirmLabel=null}={}){
  deleting=[...new Set(addresses)];if(!deleting.length)return;
  deleteAfterSuccess=afterSuccess;deleteImpact=impact||'Smazání odstraní záznamy z databáze a nelze jej vrátit zpět. „Vyřazená“ pouze ponechá peněženku v evidenci.';deleteConfirmLabel=confirmLabel||'Smazat trvale';
  el('smart-delete-error').hidden=true;
  el('smart-delete-impact').textContent=deleteImpact;el('smart-delete-confirm').textContent=deleteConfirmLabel;
  if(deleting.length===1){const wallet=wallets.find(item=>item.address===deleting[0]);el('smart-delete-message').textContent=`Opravdu chcete trvale smazat „${wallet?.name||deleting[0]}“ (${deleting[0]})?`;}else el('smart-delete-message').textContent=`Opravdu chcete trvale smazat ${deleting.length} Smart wallets?`;
  el('smart-delete-dialog').showModal();
 }
 async function confirmDelete(){
  if(!deleting.length)return;const requested=[...deleting],button=el('smart-delete-confirm');button.disabled=true;el('smart-delete-error').hidden=true;
  try{
   const result=requested.length===1?await api('/'+requested[0],{method:'DELETE'}):await api('',{method:'DELETE',body:JSON.stringify({addresses:requested})});
   const deleted=Array.isArray(result.deleted)?result.deleted:(result.deleted?[result.address||requested[0]]:[]);if(!deleted.length)throw Error('Peněženka nebyla nalezena.');
   const count=deleted.length,unit=count===1?'peněženka':count>=2&&count<=4?'peněženky':'peněženek',afterSuccess=deleteAfterSuccess;wallets=wallets.filter(wallet=>!deleted.includes(wallet.address));selected=new Set([...selected].filter(address=>!deleted.includes(address)));deleting=[];deleteAfterSuccess=null;el('smart-delete-dialog').close();button.textContent='Smazat trvale';el('smart-delete-impact').textContent='Smazání odstraní záznamy z databáze a nelze jej vrátit zpět. „Vyřazená“ pouze ponechá peněženku v evidenci.';render();onChange();if(afterSuccess)afterSuccess({deleted,count});toast(`Smazáno ${count} ${unit}.`);await refresh({quiet:true});
  }catch(error){el('smart-delete-error').textContent=error.message;el('smart-delete-error').hidden=false;}finally{button.disabled=false;}
 }
 function cancelDelete(){deleting=[];deleteAfterSuccess=null;el('smart-delete-confirm').textContent='Smazat trvale';el('smart-delete-impact').textContent='Smazání odstraní záznamy z databáze a nelze jej vrátit zpět. „Vyřazená“ pouze ponechá peněženku v evidenci.';el('smart-delete-dialog').close();}
 function removeFromDrawer(address,{afterSuccess}={}){const normalized=String(address||'').toLowerCase();if(!/^0x[\da-f]{40}$/.test(normalized)||!wallets.some(wallet=>wallet.address===normalized))return false;requestDelete([normalized],{afterSuccess,impact:'Odstraní se pouze evidenční záznam Smart wallets. Historické výsledky skenů zůstanou zachované.',confirmLabel:'Smazat peněženku'});return true;}
 function analyzeRecords(records,{append=false}={}){
  const submitted=[...new Map(records.map(w=>[w.address.toLowerCase(),w])).values()],excluded=submitted.filter(w=>isIgnoredWalletAddress(w.address)),unique=submitted.filter(w=>!isIgnoredWalletAddress(w.address));
  if(excluded.length){const message=`Systémová burn/dead adresa (zero address nebo dead address) přeskočena: ${excluded.length}.`;toast(message);if(append)el('smart-picker-error').textContent=message;}
  if(!unique.length){if(append)el('smart-picker-error').textContent=IGNORED_WALLET_ADDRESS_ERROR;return false;}
  if(!unique.length||unique.length>MAX_WALLET_SCAN){toast(`Pro jeden sken vyberte 1 až ${MAX_WALLET_SCAN} adres.`);return false;}
  const requested=[...new Set(unique.flatMap(w=>w.chainIds))],chainIds=requested.filter(supportsWalletChain),skipped=requested.filter(id=>!supportsWalletChain(id));
  if(!chainIds.length){const message='Vybrané adresy nemají síť s dostupnou živou analýzou. Dostupné: '+networks.filter(n=>supportsWalletChain(n.id)).map(n=>n.name).join(', ')+'.';if(append)el('smart-picker-error').textContent=message;else error(message);return false;}
  try{return analyze(unique.map(w=>w.address.toLowerCase()),chainIds,{append,skippedChainIds:skipped,walletMetadata:unique})!==false;}catch(e){if(append)el('smart-picker-error').textContent=e.message;else error(e.message);return false;}
 }
 function renderPicker(){
  renderTagFilter('smart-picker-tags-filter','picker',pickerTags,pickerTagMode);
  const rows=filteredPicker();
  const total=new Set([...pickerBase,...pickerSelected]).size,remaining=Math.max(0,MAX_WALLET_SCAN-total),matchingSelected=rows.filter(w=>pickerSelected.has(w.address)||pickerBase.has(w.address)).length,eligible=rows.filter(w=>!pickerSelected.has(w.address)&&!pickerBase.has(w.address)&&!isIgnoredWalletAddress(w.address)),pages=Math.max(1,Math.ceil(rows.length/100));pickerPage=Math.min(pickerPage,pages);const visible=rows.slice((pickerPage-1)*100,pickerPage*100);
  el('smart-picker-count').textContent=`Vybráno ${total} / ${MAX_WALLET_SCAN}`;
  el('smart-picker-filter-count').textContent=`Filtru odpovídá ${rows.length} · Vybráno ${total} / ${MAX_WALLET_SCAN}`;
  el('smart-picker-result-count').textContent=`${rows.length} ${rows.length===1?'výsledek':'výsledků'}`;
  el('smart-picker-select-filter').textContent=!rows.length?'Vybrat všechny 0':!eligible.length?'Výsledky už jsou vybrané':eligible.length>remaining?remaining?`Vybrat max. ${remaining}`:`Limit ${MAX_WALLET_SCAN} dosažen`:`Vybrat všechny ${rows.length}`;
  el('smart-picker-select-filter').disabled=pickerLoading||!eligible.length||remaining===0;
  const limitNote=el('smart-picker-limit-note');if(limitNote){limitNote.hidden=eligible.length<=remaining;limitNote.textContent=`Jeden sken může obsahovat nejvýše ${MAX_WALLET_SCAN} peněženek.${remaining?` Lze přidat nejvýše ${remaining}.`:' Limit je naplněný.'}`;}
  el('smart-picker-remove-filter').disabled=pickerLoading||!matchingSelected;
  const pageLabel=el('smart-picker-page');if(pageLabel)pageLabel.textContent=`${rows.length?((pickerPage-1)*100+1):0}–${Math.min(pickerPage*100,rows.length)} z ${rows.length}`;
  if(el('smart-picker-prev'))el('smart-picker-prev').disabled=pickerPage===1;
  if(el('smart-picker-next'))el('smart-picker-next').disabled=pickerPage===pages;
  const requested=[...new Set(wallets.filter(w=>pickerSelected.has(w.address)).flatMap(w=>w.chainIds))],available=networks.filter(n=>supportsWalletChain(n.id)),skipped=requested.filter(id=>!supportsWalletChain(id));
  el('smart-picker-summary').textContent=`Ve formuláři ${pickerBase.size} adres · po přidání ${total} / ${MAX_WALLET_SCAN}. Dostupné sítě: ${available.map(n=>n.name).join(', ')||'žádné'}.${skipped.length?' Nepoužijí se: '+skipped.map(id=>networks.find(n=>n.id===id)?.name||id).join(', ')+'.':''}`;
  el('smart-picker-list').innerHTML=visible.map(w=>{const existing=pickerBase.has(w.address),checked=existing||pickerSelected.has(w.address),systemAddress=isIgnoredWalletAddress(w.address);return `<label class="smart-picker-row"><input type="checkbox" data-picker-address="${html(w.address)}" aria-label="Vybrat ${html(w.name||w.address)}" ${checked?'checked':''} ${existing||pickerLoading||systemAddress||(!checked&&total>=MAX_WALLET_SCAN)?'disabled':''}><span><strong>${html(w.name||w.address.slice(0,6)+'…'+w.address.slice(-4))}</strong><span class="smart-address">${html(w.address)}</span>${systemAddress?'<span class="smart-system-warning">Systémová burn/dead adresa · nelze analyzovat</span>':''}<span class="smart-tags"><span class="smart-status ${w.status}">${labels[w.status]}</span>${w.tags.map(t=>`<span>${html(t)}</span>`).join('')}</span><span class="smart-networks">${w.chainIds.map(id=>html(networkName(id))+(supportsWalletChain(id)?'':' · nelze analyzovat')).join(' / ')}${existing?' · Již ve formuláři':''}</span></span></label>`;}).join('')||`<p class="socials-footnote">${pickerLoading?'Načítám Smart wallets…':!loaded?'Evidenci se nepodařilo načíst.':wallets.length?'Žádné adresy neodpovídají filtrům.':'Zatím nemáte uložené Smart wallets.'}</p>`;
  el('smart-picker-apply').disabled=pickerLoading||(!total&&!pickerReplaceSmartMode)||total>MAX_WALLET_SCAN||(!pickerReplaceSmartMode&&!requested.some(supportsWalletChain));el('smart-picker-clear').disabled=!pickerSelected.size;
 }
 async function pick({baseAddresses,selectedAddresses=[],replaceSmartSelection=false}={}){
  const dialog=el('smart-picker-dialog');if(dialog.open)return;
  const revision=++pickerRevision;pickerSelected=new Set(selectedAddresses.map(a=>a.toLowerCase()));pickerPage=1;pickerBase=new Set((baseAddresses??getAnalysisAddresses()).map(a=>a.toLowerCase()));pickerReplaceSmartMode=replaceSmartSelection;pickerLoading=true;
  el('smart-picker-search').value='';el('smart-picker-status').value='';el('smart-picker-tag-count-filter').value='';el('smart-picker-error').textContent='';pickerTags.clear();pickerTagMode='any';
  el('smart-picker-chain').innerHTML='<option value="">Všechny sítě</option>'+networks.map(n=>`<option value="${html(n.id)}">${html(n.name)}</option>`).join('');el('smart-picker-chain').value='';
  renderPicker();dialog.showModal();el('smart-picker-search').focus();
  const success=await refresh({quiet:true});if(revision!==pickerRevision||!dialog.open)return;
  pickerLoading=false;
  if(!success)el('smart-picker-error').textContent='Smart wallets se nepodařilo obnovit. '+(loaded?'Zobrazená evidence může být starší.':'Zavřete výběr a zkuste to znovu.');renderPicker();
 }
 el('smart-picker-search').oninput=()=>{pickerPage=1;renderPicker();};
 bindTagFilter('smart-picker-tags-filter','picker',pickerTags,mode=>pickerTagMode=mode,()=>{pickerPage=1;renderPicker();});
 for(const id of ['smart-picker-status','smart-picker-chain','smart-picker-tag-count-filter'])el(id).onchange=()=>{pickerPage=1;renderPicker();};
 el('smart-picker-list').addEventListener('change',event=>{const address=event.target.dataset.pickerAddress;if(!address||pickerLoading||pickerBase.has(address)||!wallets.some(w=>w.address===address))return;
  if(event.target.checked){if(new Set([...pickerBase,...pickerSelected,address]).size>MAX_WALLET_SCAN){event.target.checked=false;el('smart-picker-error').textContent=`Jeden sken může obsahovat nejvýše ${MAX_WALLET_SCAN} unikátních adres.`;return;}pickerSelected.add(address);}else pickerSelected.delete(address);el('smart-picker-error').textContent='';renderPicker();
 });
 el('smart-picker-select-filter').onclick=()=>{let cap=Math.max(0,MAX_WALLET_SCAN-new Set([...pickerBase,...pickerSelected]).size);for(const w of filteredPicker()){if(cap<=0)break;if(pickerBase.has(w.address)||pickerSelected.has(w.address)||isIgnoredWalletAddress(w.address))continue;pickerSelected.add(w.address);cap--;}el('smart-picker-error').textContent='';renderPicker();};
 el('smart-picker-remove-filter').onclick=()=>{for(const w of filteredPicker())pickerSelected.delete(w.address);renderPicker();};
 el('smart-picker-prev').onclick=()=>{pickerPage=Math.max(1,pickerPage-1);renderPicker();};el('smart-picker-next').onclick=()=>{pickerPage++;renderPicker();};
 el('smart-picker-clear').onclick=()=>{pickerSelected.clear();el('smart-picker-error').textContent='';renderPicker();};
 el('smart-picker-apply').onclick=()=>{if(pickerLoading)return;try{if(new Set([...pickerBase,...pickerSelected]).size>MAX_WALLET_SCAN)throw Error(`Jeden sken může obsahovat nejvýše ${MAX_WALLET_SCAN} unikátních adres. Odeberte část výběru.`);const records=wallets.filter(w=>pickerSelected.has(w.address));const applied=pickerReplaceSmartMode?analyze(records.map(w=>w.address.toLowerCase()),[...new Set(records.flatMap(w=>w.chainIds))],{append:true,replaceSmartSelection:true,walletMetadata:records})!==false:analyzeRecords(records,{append:true});if(applied)el('smart-picker-dialog').close();}catch(e){el('smart-picker-error').textContent=e.message;}};
 el('smart-form').addEventListener('submit',save);
 el('smart-bulk-edit-form').addEventListener('submit',saveBulkEdit);el('smart-delete-confirm').onclick=confirmDelete;el('smart-delete-cancel').onclick=cancelDelete;
 el('smart-refresh').onclick=refresh;el('smart-new').onclick=()=>open();
 bindTagFilter('smart-tags-filter','main',mainTags,mode=>mainTagMode=mode,()=>{page=1;render();});
 el('smart-search').oninput=()=>{page=1;render();};for(const id of ['smart-status-filter','smart-chain-filter','smart-tag-count-filter'])el(id).onchange=()=>{page=1;render();};
 el('smart-prev').onclick=()=>{page--;render();};el('smart-next').onclick=()=>{page++;render();};
 el('smart-select-page').onchange=event=>{const current=filtered().slice((page-1)*20,page*20);for(const wallet of current)if(event.target.checked)selected.add(wallet.address);else selected.delete(wallet.address);render();};el('smart-select-filtered').onclick=()=>{for(const wallet of filtered())selected.add(wallet.address);render();};
 el('smart-clear-selected').onclick=()=>{selected.clear();render();};el('smart-analyze-selected').onclick=()=>analyzeRecords(wallets.filter(w=>selected.has(w.address)));el('smart-bulk-edit').onclick=openBulkEdit;el('smart-bulk-delete').onclick=()=>requestDelete([...selected]);
 el('smart-import-watchlist').onclick=()=>{const records=getLiveWatchlist();if(!records.length){toast('Live watchlist zatím neobsahuje žádné adresy. Demo adresy se nepřenášejí.');return;}open([...new Set(records.map(w=>w.address))].join('\n'),[...new Set(records.flatMap(w=>w.chainIds))]);el('smart-source').value='Live watchlist';};
 el('smart-export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),wallets},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='chaindetective-smart-wallets.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 document.addEventListener('click',async event=>{const b=event.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-smart-new'))open();
  if(b.dataset.smartEdit)open(b.dataset.smartEdit);
  if(b.dataset.smartAnalyze)analyzeRecords(wallets.filter(w=>w.address===b.dataset.smartAnalyze));
  if(b.dataset.smartDelete)requestDelete([b.dataset.smartDelete]);
 });
 el('smart-table-body').addEventListener('change',event=>{const address=event.target.dataset.smartSelect;if(!address)return;if(event.target.checked)selected.add(address);else selected.delete(address);render();});
 async function quickAdd(address,chainIds,{allowAnyNetwork=false,source='Token Screener'}={}){
  if(!/^0x[\da-fA-F]{40}$/.test(String(address||'')))throw new Error('Neplatná EVM adresa.');
  const normalized=address.toLowerCase();if(isIgnoredWalletAddress(normalized))throw new Error(IGNORED_WALLET_ADDRESS_ERROR);
  const requested=[...new Set((Array.isArray(chainIds)?chainIds:[]).filter(id=>networks.some(network=>network.id===id)&&(allowAnyNetwork||supportsWalletChain(id))))];
  if(!requested.length)throw new Error('Pro tuto peněženku není dostupná podporovaná síť.');
  const result=await api('/quick-add',{method:'POST',body:JSON.stringify({addresses:[normalized],name:'',tags:['research'],source,note:'',status:'candidate',chainIds:requested})});
  const wallet=result.wallet;if(!wallet||wallet.address!==normalized)throw new Error('Server nevrátil potvrzený záznam Smart wallet.');
  wallets=[...new Map([...wallets.filter(item=>item.address!==normalized),{...wallet,address:normalized}].map(item=>[item.address.toLowerCase(),{...item,address:item.address.toLowerCase()}])).values()];loaded=true;render();onChange();
  return {created:(result.created||[]).includes(normalized),updated:(result.updated||[]).includes(normalized),unchanged:(result.unchanged||[]).includes(normalized),wallet:{...wallet,statusLabel:labels[wallet.status]}};
 }
 return {show:refresh,pick,refreshMetadata:()=>refresh({quiet:true}),lookup(address){if(isIgnoredWalletAddress(address))return null;const row=wallets.find(w=>w.address===String(address).toLowerCase());return row?{...row,statusLabel:labels[row.status]}:null;},removeFromDrawer,quickAdd,async add(address,chainIds){if(isIgnoredWalletAddress(address)){toast(IGNORED_WALLET_ADDRESS_ERROR);return;}if(!/^0x[\da-fA-F]{40}$/.test(address))return;await refresh();if(!loaded){toast('Evidenci se nepodařilo načíst. Otevřete Smart wallets a zkuste obnovit seznam.');return;}open(address,chainIds);}};
}
