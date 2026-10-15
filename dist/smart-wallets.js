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
   if(!seen.has(entry.address)){seen.add(entry.address);entries.push(entry);}
  }
 }
 if(!entries.length)throw Error('Vložte 1 až 200 platných EVM adres.');
 if(entries.length>200)throw Error('Vložte nejvýše 200 unikátních EVM adres.');
 return entries;
}
export function initSmartWallets({networks,legacyNetworks=[],toast,analyze,getLiveWatchlist,getAnalysisAddresses=()=>[],onChange=()=>{},supportsWalletChain=id=>!!networks.find(n=>n.id===id)?.live}){
 const el=id=>document.getElementById(id);
 const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const networkName=id=>networks.find(n=>n.id===id)?.name||legacyNetworks.find(n=>n.id===id)?.name||id;
 const labels={candidate:'Kandidát',reviewed:'Prověřená ručně',excluded:'Vyřazená'};
 let wallets=[],selected=new Set(),editing=null,loaded=false,loading=false,saving=false,page=1,requestId=0;
 let pickerSelected=new Set(),pickerBase=new Set(),pickerLoading=false,pickerRevision=0,pickerPage=1;
 async function api(path='',options={}){
  if(location.protocol==='file:')throw new Error('Evidence vyžaduje lokální server. Spusťte npm run dev a otevřete http://127.0.0.1:4173/.');
  const response=await fetch('/api/smart-wallets'+path,{credentials:'same-origin',...options,headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{})}});
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('Restartujte lokální server, aby se načetla evidence peněženek.');
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Evidence není dostupná.');return result;
 }
 function error(message=''){el('smart-error').textContent=message;el('smart-error').hidden=!message;}
 function filtered(){const q=el('smart-search').value.trim().toLowerCase(),status=el('smart-status-filter').value,tag=el('smart-tag-filter').value;
  return wallets.filter(w=>(!status||w.status===status)&&(!tag||w.tags.includes(tag))&&(!q||[w.address,w.name,w.source,w.note,...w.tags].join(' ').toLowerCase().includes(q)));
 }
 function render(){
  const tags=[...new Set(wallets.flatMap(w=>w.tags))].sort(),current=el('smart-tag-filter').value;
  el('smart-tag-filter').innerHTML='<option value="">Všechny štítky</option>'+tags.map(t=>`<option value="${html(t)}">${html(t)}</option>`).join('');el('smart-tag-filter').value=tags.includes(current)?current:'';
  const rows=filtered(),pages=Math.max(1,Math.ceil(rows.length/20));page=Math.min(page,pages);const visible=rows.slice((page-1)*20,page*20);
  const pageSelected=visible.filter(w=>selected.has(w.address)).length,pageCheckbox=el('smart-select-page');pageCheckbox.checked=visible.length>0&&pageSelected===visible.length;pageCheckbox.indeterminate=pageSelected>0&&pageSelected<visible.length;pageCheckbox.disabled=!visible.length;
  const filterActive=!!(el('smart-search').value.trim()||el('smart-status-filter').value||el('smart-tag-filter').value),filterSelection=rows.filter(w=>selected.has(w.address)).length;
  el('smart-select-filtered').hidden=!filterActive||!rows.length||filterSelection===rows.length;el('smart-select-filtered').textContent=`Vybrat všechny filtrované (${rows.length})`;
  el('smart-count').textContent=wallets.length;el('smart-total').textContent=wallets.length;el('smart-candidates').textContent=wallets.filter(w=>w.status==='candidate').length;el('smart-reviewed').textContent=wallets.filter(w=>w.status==='reviewed').length;
  el('smart-table-body').innerHTML=visible.map(w=>`<tr><td><input type="checkbox" data-smart-select="${w.address}" aria-label="Vybrat ${html(w.name||w.address)}" ${selected.has(w.address)?'checked':''}></td><td><button class="address-button" data-smart-edit="${w.address}">${html(w.name||w.address.slice(0,6)+'…'+w.address.slice(-4))}</button><div class="smart-address">${w.address}</div>${w.source?`<div class="smart-source">Zdroj: ${html(w.source)}</div>`:''}</td><td><span class="smart-status ${w.status}">${labels[w.status]}</span></td><td><div class="smart-tags">${w.tags.map(t=>`<span>${html(t)}</span>`).join('')||'<span class="pending-dot">Bez štítku</span>'}</div><div class="smart-networks">${w.chainIds.map(id=>html(networkName(id))).join(' · ')}</div></td><td><div class="smart-note">${html(w.note||'—')}</div><small class="smart-date">${html(new Date(w.updatedAt).toLocaleDateString('cs-CZ'))}</small></td><td><div class="smart-row-tools"><button class="subtle-button" data-smart-edit="${w.address}">Upravit</button><button class="text-button" data-smart-analyze="${w.address}">Analyzovat ↗</button><button class="text-button" data-smart-delete="${w.address}">Smazat</button></div></td></tr>`).join('');
  el('smart-empty').hidden=!!rows.length;el('smart-empty').innerHTML=loading?'Načítám evidenci…':!loaded?'Evidence zatím není načtená. Zkuste obnovit seznam.':wallets.length?'Žádné adresy neodpovídají filtru.':'<strong>Váš výzkum začíná první adresou.</strong><p>Přidejte kandidáta, poznamenejte si důvod a postupně budujte vlastní seznam.</p><button class="primary-button" data-smart-new>Přidat peněženku +</button>';
  el('smart-range').textContent=rows.length?`${(page-1)*20+1}–${Math.min(page*20,rows.length)} z ${rows.length}`:'0 adres';el('smart-page').textContent=page;el('smart-prev').disabled=page===1;el('smart-next').disabled=page===pages;
  el('smart-selection').hidden=!selected.size;el('smart-selection-count').textContent=`Vybráno: ${selected.size}${selected.size>500?' · jeden sken max. 500':''}`;el('smart-analyze-selected').disabled=!selected.size||selected.size>500;el('smart-analyze-selected').title=selected.size>500?'Jeden sken je omezený na 500 adres. Hromadní správa limit nemá.':'';
  el('smart-export').disabled=!loaded||!wallets.length;el('smart-refresh').disabled=loading;
 }
 async function refresh({quiet=false}={}){const id=++requestId;loading=true;if(!quiet)error();render();try{const result=await api();if(id!==requestId)return false;wallets=[...new Map(result.wallets.map(w=>[w.address.toLowerCase(),{...w,address:w.address.toLowerCase()}])).values()];loaded=true;selected=new Set([...selected].filter(a=>wallets.some(w=>w.address===a)));onChange();return true;}catch(e){if(id===requestId&&!quiet)error(e.message);return false;}finally{if(id===requestId){loading=false;render();}}}
 function open(address='',chainIds){
  const existing=wallets.find(w=>w.address===address.toLowerCase());editing=existing?.address||null;
  el('smart-form').reset();el('smart-form-error').hidden=true;el('smart-dialog-title').textContent=editing?'Upravit peněženku':'Přidat peněženky';
  el('smart-addresses').value=existing?.address||address;el('smart-addresses').readOnly=!!editing;el('smart-addresses').rows=editing?2:3;
  el('smart-name').value=existing?.name||'';el('smart-tags').value=existing?.tags.join(', ')||'';el('smart-source').value=existing?.source||'';el('smart-note').value=existing?.note||'';el('smart-status').value=existing?.status||'candidate';
  const chains=existing?.chainIds||chainIds?.filter(id=>networks.some(n=>n.id===id))||networks.filter(n=>supportsWalletChain(n.id)).map(n=>n.id);
  const legacyNames={zksync:'zkSync Era',scroll:'Scroll',linea:'Linea'};
  const archived=(existing?.chainIds||[]).filter(id=>legacyNames[id]&&!networks.some(n=>n.id===id));
  el('smart-chains').innerHTML=[...networks.map(n=>`<label><input type="checkbox" name="smart-chain" value="${html(n.id)}" ${chains.includes(n.id)?'checked':''}> ${html(n.name)}</label>`),...archived.map(id=>`<label><input type="checkbox" name="smart-chain" value="${html(id)}" checked> ${html(legacyNames[id])} <small>(archivní síť uloženého záznamu)</small></label>`)].join('');
  el('smart-form-submit').textContent=editing?'Uložit změny':'Uložit do evidence';el('smart-dialog').showModal();el('smart-addresses').focus();
 }
 function importChoice(preview){
  const dialog=el('smart-import-conflict-dialog'),keepMode=el('smart-import-mode-keep'),updateMode=el('smart-import-mode-update'),continueButton=el('smart-import-continue'),close=el('smart-import-cancel');
  el('smart-import-conflict-counts').textContent=`Nových adres: ${preview.newCount}. Již evidovaných adres: ${preview.existingCount}.`;
  el('smart-import-tags-mode').value='add';el('smart-import-networks-mode').value='replace';keepMode.checked=true;updateMode.checked=false;el('smart-import-update-options').hidden=true;
  const changeMode=()=>{const updating=updateMode.checked;el('smart-import-update-options').hidden=!updating;continueButton.textContent=updating?'Aktualizovat existující':'Ponechat existující beze změny';};
  keepMode.onchange=changeMode;updateMode.onchange=changeMode;changeMode();
  dialog.showModal();
  return new Promise(resolve=>{
   let settled=false;const finish=value=>{if(settled)return;settled=true;dialog.close();resolve(value);};
   continueButton.onclick=()=>finish({updateExisting:updateMode.checked,tagsMode:el('smart-import-tags-mode').value,networksMode:el('smart-import-networks-mode').value});
   close.onclick=()=>finish(null);el('smart-import-cancel-bottom').onclick=()=>finish(null);dialog.oncancel=event=>{event.preventDefault();finish(null);};
  });
 }
 async function save(event){event.preventDefault();if(saving)return;saving=true;el('smart-form-submit').disabled=true;el('smart-form-error').hidden=true;
  try{
   const entries=parseBulkWalletEntries(el('smart-addresses').value);
   const chainIds=[...el('smart-chains').querySelectorAll('input:checked')].map(n=>n.value);if(!chainIds.length)throw new Error('Vyberte alespoň jednu síť.');
   const record={entries,name:el('smart-name').value,tags:el('smart-tags').value.split(',').map(t=>t.trim()).filter(Boolean),source:el('smart-source').value,note:el('smart-note').value,status:el('smart-status').value,chainIds};
   let result;
   if(editing)result=await api('/'+editing,{method:'PUT',body:JSON.stringify(record)});
   else{
    const preview=await api('/import-preview',{method:'POST',body:JSON.stringify({entries})});
    const choice=preview.existingCount?await importChoice(preview):{updateExisting:false,tagsMode:'add',networksMode:'replace'};
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
  el('smart-bulk-chains-enabled').onchange=event=>el('smart-bulk-chains').querySelectorAll('input').forEach(input=>{input.disabled=!event.target.checked;});
  el('smart-bulk-edit-dialog').showModal();
 }
 async function saveBulkEdit(event){
  event.preventDefault();const changes={};el('smart-bulk-edit-error').hidden=true;
  try{
   if(el('smart-bulk-tags-enabled').checked){const values=el('smart-bulk-tags').value.split(',').map(tag=>tag.trim()).filter(Boolean);if(values.length>12)throw Error('Použijte nejvýše 12 štítků.');if(values.some(tag=>tag.length>40))throw Error('Každý štítek může mít nejvýše 40 znaků.');if(el('smart-bulk-tags-mode').value!=='replace'&&!values.length)throw Error('Zadejte alespoň jeden štítek.');changes.tags={mode:el('smart-bulk-tags-mode').value,values};}
   if(el('smart-bulk-status-enabled').checked)changes.status=el('smart-bulk-status').value;
   if(el('smart-bulk-source-enabled').checked)changes.source=el('smart-bulk-source').value;
   if(el('smart-bulk-chains-enabled').checked){const chainIds=[...el('smart-bulk-chains').querySelectorAll('input:checked')].map(input=>input.value);if(!chainIds.length)throw Error('Vyberte alespoň jednu sledovanou síť.');changes.chainIds=chainIds;}
   if(el('smart-bulk-note-enabled').checked)changes.note=el('smart-bulk-note').value;
   if(!Object.keys(changes).length)throw Error('Zaškrtněte alespoň jedno pole, které chcete změnit.');
   const result=await api('',{method:'PATCH',body:JSON.stringify({addresses:[...selected],changes})});
   selected.clear();el('smart-bulk-edit-dialog').close();toast(`Upraveno ${result.updated.length} peněženek.`);await refresh();
  }catch(error){el('smart-bulk-edit-error').textContent=error.message;el('smart-bulk-edit-error').hidden=false;}
 }
 let deleting=[];
 function requestDelete(addresses){
  deleting=[...new Set(addresses)];if(!deleting.length)return;
  el('smart-delete-error').hidden=true;
  if(deleting.length===1){const wallet=wallets.find(item=>item.address===deleting[0]);el('smart-delete-message').textContent=`Opravdu chcete trvale smazat „${wallet?.name||deleting[0]}“ (${deleting[0]})?`;}else el('smart-delete-message').textContent=`Opravdu chcete trvale smazat ${deleting.length} Smart wallets?`;
  el('smart-delete-dialog').showModal();
 }
 async function confirmDelete(){
  if(!deleting.length)return;const requested=[...deleting],button=el('smart-delete-confirm');button.disabled=true;el('smart-delete-error').hidden=true;
  try{
   const result=requested.length===1?await api('/'+requested[0],{method:'DELETE'}):await api('',{method:'DELETE',body:JSON.stringify({addresses:requested})});
   const count=requested.length===1?(result.deleted?1:0):result.deleted.length,unit=count===1?'peněženka':count>=2&&count<=4?'peněženky':'peněženek';selected.clear();deleting=[];el('smart-delete-dialog').close();await refresh();toast(`Smazáno ${count} ${unit}.`);
  }catch(error){el('smart-delete-error').textContent=error.message;el('smart-delete-error').hidden=false;}finally{button.disabled=false;}
 }
 function analyzeRecords(records,{append=false}={}){
  const unique=[...new Map(records.map(w=>[w.address.toLowerCase(),w])).values()];
  if(!unique.length||unique.length>500){toast('Pro jeden sken vyberte 1 až 500 adres.');return false;}
  const requested=[...new Set(unique.flatMap(w=>w.chainIds))],chainIds=requested.filter(supportsWalletChain),skipped=requested.filter(id=>!supportsWalletChain(id));
  if(!chainIds.length){const message='Vybrané adresy nemají síť s dostupnou živou analýzou. Dostupné: '+networks.filter(n=>supportsWalletChain(n.id)).map(n=>n.name).join(', ')+'.';if(append)el('smart-picker-error').textContent=message;else error(message);return false;}
  try{return analyze(unique.map(w=>w.address.toLowerCase()),chainIds,{append,skippedChainIds:skipped,walletMetadata:unique})!==false;}catch(e){if(append)el('smart-picker-error').textContent=e.message;else error(e.message);return false;}
 }
 function renderPicker(){
  const q=el('smart-picker-search').value.trim().toLowerCase(),tag=el('smart-picker-tag').value,status=el('smart-picker-status').value,chain=el('smart-picker-chain').value;
  const rows=wallets.filter(w=>(!q||[w.name,w.address].join(' ').toLowerCase().includes(q))&&(!tag||w.tags.includes(tag))&&(!status||w.status===status)&&(!chain||w.chainIds.includes(chain)));
  const total=new Set([...pickerBase,...pickerSelected]).size;
  const matchingSelected=rows.filter(w=>pickerSelected.has(w.address)||pickerBase.has(w.address)).length,pages=Math.max(1,Math.ceil(rows.length/100));pickerPage=Math.min(pickerPage,pages);const visible=rows.slice((pickerPage-1)*100,pickerPage*100);
  el('smart-picker-count').textContent=`Vybráno ${total} / 500`;
  el('smart-picker-filter-count').textContent=`Filtru odpovídá: ${rows.length} · vybráno: ${matchingSelected}`;
  el('smart-picker-select-filter').textContent=`Vybrat všech ${rows.length} výsledků`;
  el('smart-picker-select-filter').disabled=pickerLoading||!rows.length||matchingSelected===rows.length||total>=500;
  el('smart-picker-remove-filter').disabled=pickerLoading||!matchingSelected;
  const pageLabel=el('smart-picker-page');if(pageLabel)pageLabel.textContent=`${rows.length?((pickerPage-1)*100+1):0}–${Math.min(pickerPage*100,rows.length)} z ${rows.length}`;
  if(el('smart-picker-prev'))el('smart-picker-prev').disabled=pickerPage===1;
  if(el('smart-picker-next'))el('smart-picker-next').disabled=pickerPage===pages;
  const requested=[...new Set(wallets.filter(w=>pickerSelected.has(w.address)).flatMap(w=>w.chainIds))],available=networks.filter(n=>supportsWalletChain(n.id)),skipped=requested.filter(id=>!supportsWalletChain(id));
  el('smart-picker-summary').textContent=`Ve formuláři ${pickerBase.size} adres · po přidání ${total} / 500. Dostupné sítě: ${available.map(n=>n.name).join(', ')||'žádné'}.${skipped.length?' Nepoužijí se: '+skipped.map(id=>networks.find(n=>n.id===id)?.name||id).join(', ')+'.':''}`;
  el('smart-picker-list').innerHTML=visible.map(w=>{const existing=pickerBase.has(w.address),checked=existing||pickerSelected.has(w.address);return `<label class="smart-picker-row"><input type="checkbox" data-picker-address="${html(w.address)}" aria-label="Vybrat ${html(w.name||w.address)}" ${checked?'checked':''} ${existing||pickerLoading||(!checked&&total>=500)?'disabled':''}><span><strong>${html(w.name||w.address.slice(0,6)+'…'+w.address.slice(-4))}</strong><span class="smart-address">${html(w.address)}</span><span class="smart-tags"><span class="smart-status ${w.status}">${labels[w.status]}</span>${w.tags.map(t=>`<span>${html(t)}</span>`).join('')}</span><span class="smart-networks">${w.chainIds.map(id=>html(networkName(id))+(supportsWalletChain(id)?'':' · nelze analyzovat')).join(' / ')}${existing?' · Již ve formuláři':''}</span></span></label>`;}).join('')||`<p class="socials-footnote">${pickerLoading?'Načítám Smart wallets…':!loaded?'Evidenci se nepodařilo načíst.':wallets.length?'Žádné adresy neodpovídají filtrům.':'Zatím nemáte uložené Smart wallets.'}</p>`;
  el('smart-picker-apply').disabled=pickerLoading||!total||total>500||!requested.some(supportsWalletChain);el('smart-picker-clear').disabled=!pickerSelected.size;
 }
 async function pick(){
  const dialog=el('smart-picker-dialog');if(dialog.open)return;
  const revision=++pickerRevision;pickerSelected.clear();pickerPage=1;pickerBase=new Set(getAnalysisAddresses().map(a=>a.toLowerCase()));pickerLoading=true;
  el('smart-picker-search').value='';el('smart-picker-status').value='';el('smart-picker-error').textContent='';
  el('smart-picker-tag').innerHTML='<option value="">Všechny štítky</option>';el('smart-picker-tag').value='';
  el('smart-picker-chain').innerHTML='<option value="">Všechny sítě</option>'+networks.map(n=>`<option value="${html(n.id)}">${html(n.name)}</option>`).join('');el('smart-picker-chain').value='';
  renderPicker();dialog.showModal();el('smart-picker-search').focus();
  const success=await refresh({quiet:true});if(revision!==pickerRevision||!dialog.open)return;
  pickerLoading=false;el('smart-picker-tag').innerHTML='<option value="">Všechny štítky</option>'+[...new Set(wallets.flatMap(w=>w.tags))].sort().map(t=>`<option value="${html(t)}">${html(t)}</option>`).join('');el('smart-picker-tag').value='';
  if(!success)el('smart-picker-error').textContent='Smart wallets se nepodařilo obnovit. '+(loaded?'Zobrazená evidence může být starší.':'Zavřete výběr a zkuste to znovu.');renderPicker();
 }
 el('smart-picker-search').oninput=()=>{pickerPage=1;renderPicker();};
 for(const id of ['smart-picker-tag','smart-picker-status','smart-picker-chain'])el(id).onchange=()=>{pickerPage=1;renderPicker();};
 el('smart-picker-list').addEventListener('change',event=>{const address=event.target.dataset.pickerAddress;if(!address||pickerLoading||pickerBase.has(address)||!wallets.some(w=>w.address===address))return;
  if(event.target.checked){if(new Set([...pickerBase,...pickerSelected,address]).size>500){event.target.checked=false;el('smart-picker-error').textContent='Jeden sken může obsahovat nejvýše 500 unikátních adres.';return;}pickerSelected.add(address);}else pickerSelected.delete(address);el('smart-picker-error').textContent='';renderPicker();
 });
 el('smart-picker-select-filter').onclick=()=>{const q=el('smart-picker-search').value.trim().toLowerCase(),tag=el('smart-picker-tag').value,status=el('smart-picker-status').value,chain=el('smart-picker-chain').value,rows=wallets.filter(w=>(!q||[w.name,w.address].join(' ').toLowerCase().includes(q))&&(!tag||w.tags.includes(tag))&&(!status||w.status===status)&&(!chain||w.chainIds.includes(chain)));for(const w of rows)if(!pickerBase.has(w.address))pickerSelected.add(w.address);el('smart-picker-error').textContent=pickerBase.size+pickerSelected.size>500?'Výběr obsahuje více než 500 adres. Odeberte část výsledků před předvyplněním.':'';renderPicker();};
 el('smart-picker-remove-filter').onclick=()=>{const q=el('smart-picker-search').value.trim().toLowerCase(),tag=el('smart-picker-tag').value,status=el('smart-picker-status').value,chain=el('smart-picker-chain').value;for(const w of wallets)if((!q||[w.name,w.address].join(' ').toLowerCase().includes(q))&&(!tag||w.tags.includes(tag))&&(!status||w.status===status)&&(!chain||w.chainIds.includes(chain)))pickerSelected.delete(w.address);renderPicker();};
 el('smart-picker-prev').onclick=()=>{pickerPage=Math.max(1,pickerPage-1);renderPicker();};el('smart-picker-next').onclick=()=>{pickerPage++;renderPicker();};
 el('smart-picker-clear').onclick=()=>{pickerSelected.clear();el('smart-picker-error').textContent='';renderPicker();};
 el('smart-picker-apply').onclick=()=>{if(pickerLoading)return;try{if(new Set([...pickerBase,...pickerSelected]).size>500)throw Error('Jeden sken může obsahovat nejvýše 500 unikátních adres. Odeberte část výběru.');if(analyzeRecords(wallets.filter(w=>pickerSelected.has(w.address)),{append:true}))el('smart-picker-dialog').close();}catch(e){el('smart-picker-error').textContent=e.message;}};
 el('smart-form').addEventListener('submit',save);
 el('smart-bulk-edit-form').addEventListener('submit',saveBulkEdit);el('smart-delete-confirm').onclick=confirmDelete;el('smart-delete-cancel').onclick=()=>el('smart-delete-dialog').close();
 el('smart-refresh').onclick=refresh;el('smart-new').onclick=()=>open();
 el('smart-search').oninput=()=>{page=1;render();};el('smart-status-filter').onchange=()=>{page=1;render();};el('smart-tag-filter').onchange=()=>{page=1;render();};
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
 return {show:refresh,pick,refreshMetadata:()=>refresh({quiet:true}),lookup(address){const row=wallets.find(w=>w.address===String(address).toLowerCase());return row?{...row,statusLabel:labels[row.status]}:null;},async add(address,chainIds){if(!/^0x[\da-fA-F]{40}$/.test(address))return;await refresh();if(!loaded){toast('Evidenci se nepodařilo načíst. Otevřete Smart wallets a zkuste obnovit seznam.');return;}open(address,chainIds);}};
}
