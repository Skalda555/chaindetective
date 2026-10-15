export function initSmartWallets({networks,toast,analyze,getLiveWatchlist,supportsWalletChain=id=>!!supportsWalletChain(id)}){
 const el=id=>document.getElementById(id);
 const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const labels={candidate:'Kandidát',reviewed:'Prověřená ručně',excluded:'Vyřazená'};
 let wallets=[],selected=new Set(),editing=null,loaded=false,loading=false,saving=false,page=1,requestId=0;
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
  el('smart-count').textContent=wallets.length;el('smart-total').textContent=wallets.length;el('smart-candidates').textContent=wallets.filter(w=>w.status==='candidate').length;el('smart-reviewed').textContent=wallets.filter(w=>w.status==='reviewed').length;
  el('smart-table-body').innerHTML=visible.map(w=>`<tr><td><input type="checkbox" data-smart-select="${w.address}" aria-label="Vybrat ${html(w.name||w.address)}" ${selected.has(w.address)?'checked':''}></td><td><button class="address-button" data-smart-edit="${w.address}">${html(w.name||w.address.slice(0,6)+'…'+w.address.slice(-4))}</button><div class="smart-address">${w.address}</div>${w.source?`<div class="smart-source">Zdroj: ${html(w.source)}</div>`:''}</td><td><span class="smart-status ${w.status}">${labels[w.status]}</span></td><td><div class="smart-tags">${w.tags.map(t=>`<span>${html(t)}</span>`).join('')||'<span class="pending-dot">Bez štítku</span>'}</div><div class="smart-networks">${w.chainIds.map(id=>html(networks.find(n=>n.id===id)?.name||id)).join(' · ')}</div></td><td><div class="smart-note">${html(w.note||'—')}</div><small class="smart-date">${html(new Date(w.updatedAt).toLocaleDateString('cs-CZ'))}</small></td><td><div class="smart-row-tools"><button class="subtle-button" data-smart-edit="${w.address}">Upravit</button><button class="text-button" data-smart-analyze="${w.address}">Analyzovat ↗</button></div></td></tr>`).join('');
  el('smart-empty').hidden=!!rows.length;el('smart-empty').innerHTML=loading?'Načítám evidenci…':!loaded?'Evidence zatím není načtená. Zkuste obnovit seznam.':wallets.length?'Žádné adresy neodpovídají filtru.':'<strong>Váš výzkum začíná první adresou.</strong><p>Přidejte kandidáta, poznamenejte si důvod a postupně budujte vlastní seznam.</p><button class="primary-button" data-smart-new>Přidat peněženku +</button>';
  el('smart-range').textContent=rows.length?`${(page-1)*20+1}–${Math.min(page*20,rows.length)} z ${rows.length}`:'0 adres';el('smart-page').textContent=page;el('smart-prev').disabled=page===1;el('smart-next').disabled=page===pages;
  el('smart-selection-count').textContent=`Vybráno ${selected.size} / 20`;el('smart-analyze-selected').disabled=!selected.size;el('smart-clear-selected').disabled=!selected.size;
  el('smart-export').disabled=!loaded||!wallets.length;el('smart-refresh').disabled=loading;
 }
 async function refresh(){const id=++requestId;loading=true;error();render();try{const result=await api();if(id!==requestId)return;wallets=result.wallets;loaded=true;selected=new Set([...selected].filter(a=>wallets.some(w=>w.address===a)));}catch(e){if(id===requestId)error(e.message);}finally{if(id===requestId){loading=false;render();}}}
 function open(address='',chainIds){
  const existing=wallets.find(w=>w.address===address.toLowerCase());editing=existing?.address||null;
  el('smart-form').reset();el('smart-form-error').hidden=true;el('smart-dialog-title').textContent=editing?'Upravit peněženku':'Přidat peněženky';
  el('smart-addresses').value=existing?.address||address;el('smart-addresses').readOnly=!!editing;el('smart-addresses').rows=editing?2:3;
  el('smart-name').value=existing?.name||'';el('smart-tags').value=existing?.tags.join(', ')||'';el('smart-source').value=existing?.source||'';el('smart-note').value=existing?.note||'';el('smart-status').value=existing?.status||'candidate';
  const chains=existing?.chainIds||chainIds?.filter(id=>networks.some(n=>n.id===id))||networks.filter(n=>supportsWalletChain(n.id)).map(n=>n.id);
  el('smart-chains').innerHTML=networks.map(n=>`<label><input type="checkbox" name="smart-chain" value="${html(n.id)}" ${chains.includes(n.id)?'checked':''}> ${html(n.name)}</label>`).join('');
  el('smart-form-submit').textContent=editing?'Uložit změny':'Uložit do evidence';el('smart-dialog').showModal();el('smart-addresses').focus();
 }
 async function save(event){event.preventDefault();if(saving)return;saving=true;el('smart-form-submit').disabled=true;el('smart-form-error').hidden=true;
  try{
   const addresses=[...new Set(el('smart-addresses').value.split(/[\s,;]+/).filter(Boolean).map(a=>a.toLowerCase()))];
   if(!addresses.length||addresses.length>200||addresses.some(a=>!/^0x[\da-f]{40}$/.test(a)))throw new Error('Vložte 1 až 200 platných EVM adres. Neplatný řádek opravte; nic se neuloží částečně.');
   const chainIds=[...el('smart-chains').querySelectorAll('input:checked')].map(n=>n.value);if(!chainIds.length)throw new Error('Vyberte alespoň jednu síť.');
   const record={addresses,name:el('smart-name').value,tags:el('smart-tags').value.split(',').map(t=>t.trim()).filter(Boolean),source:el('smart-source').value,note:el('smart-note').value,status:el('smart-status').value,chainIds};
   const result=await api(editing?'/'+editing:'',{method:editing?'PUT':'POST',body:JSON.stringify(record)});
   el('smart-dialog').close();toast(editing?'Změny uloženy.':`Přidáno ${result.created.length} adres.${result.existing.length?` ${result.existing.length} už v evidenci bylo; jejich poznámky zůstaly zachované.`:''}`);await refresh();
  }catch(e){el('smart-form-error').textContent=e.message;el('smart-form-error').hidden=false;}finally{saving=false;el('smart-form-submit').disabled=false;}
 }
 function analyzeRecords(records){if(!records.length||records.length>20){toast('Pro analýzu vyberte 1 až 20 adres.');return;}const chainIds=[...new Set(records.flatMap(w=>w.chainIds))].filter(id=>supportsWalletChain(id));if(!chainIds.length){error('Vybrané adresy nemají síť s dostupnou živou analýzou. Upravte jejich sítě.');return;}if(records.some(w=>w.chainIds.some(id=>!networks.find(n=>n.id===id)?.live)))toast('Analýza použije pouze sítě s dostupným Live adaptérem.');analyze(records.map(w=>w.address),chainIds);}
 el('smart-form').addEventListener('submit',save);
 el('smart-refresh').onclick=refresh;el('smart-new').onclick=()=>open();
 el('smart-search').oninput=()=>{page=1;render();};el('smart-status-filter').onchange=()=>{page=1;render();};el('smart-tag-filter').onchange=()=>{page=1;render();};
 el('smart-prev').onclick=()=>{page--;render();};el('smart-next').onclick=()=>{page++;render();};
 el('smart-clear-selected').onclick=()=>{selected.clear();render();};el('smart-analyze-selected').onclick=()=>analyzeRecords(wallets.filter(w=>selected.has(w.address)));
 el('smart-import-watchlist').onclick=()=>{const records=getLiveWatchlist();if(!records.length){toast('Live watchlist zatím neobsahuje žádné adresy. Demo adresy se nepřenášejí.');return;}open([...new Set(records.map(w=>w.address))].join('\n'),[...new Set(records.flatMap(w=>w.chainIds))]);el('smart-source').value='Live watchlist';};
 el('smart-export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),wallets},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='chaindetective-smart-wallets.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 document.addEventListener('click',async event=>{const b=event.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-smart-new'))open();
  if(b.dataset.smartEdit)open(b.dataset.smartEdit);
  if(b.dataset.smartAnalyze)analyzeRecords(wallets.filter(w=>w.address===b.dataset.smartAnalyze));
 });
 el('smart-table-body').addEventListener('change',event=>{const address=event.target.dataset.smartSelect;if(!address)return;if(event.target.checked){if(selected.size>=20){event.target.checked=false;toast('Pro jednu analýzu lze vybrat nejvýše 20 adres.');return;}selected.add(address);}else selected.delete(address);render();});
 return {show:refresh,async add(address,chainIds){if(!/^0x[\da-fA-F]{40}$/.test(address))return;await refresh();if(!loaded){toast('Evidenci se nepodařilo načíst. Otevřete Smart wallets a zkuste obnovit seznam.');return;}open(address,chainIds);}};
}
