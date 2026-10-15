export function initSocials(){
 const el=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const num=v=>v===null||v===undefined?'—':new Intl.NumberFormat('cs-CZ').format(v);
 let handle='',part='profile',revision=0,status=null;const results=new Map();
 async function api(path,body){const r=await fetch('/api/socials/moni/'+path,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.error||'Moni se nepodařilo načíst.');return data;}
 function usage(value){if(value)status=value.month===status?.month?{...value,estimatedPoints:Math.max(value.estimatedPoints,status.estimatedPoints)}:value;el('moni-budget').textContent=status?`Odhad aplikace tento měsíc: ${num(status.estimatedPoints)} / ${num(status.monthlyBudget)} bodů místního rozpočtu. Nejde o zůstatek účtu Moni.`:'';}
 async function show(){
  if(location.protocol==='file:'){el('moni-status').textContent='Moni vyžaduje lokální server';el('moni-search-button').disabled=true;return;}
  refreshWatchlist();
  try{const s=await api('status');usage(s);el('moni-status').textContent=s.configured?'Moni · klíč nastavený':'Moni · chybí serverový klíč';el('moni-search-button').disabled=!s.configured;el('moni-project-load').disabled=!s.configured;}catch{el('moni-status').textContent='Lokální server není dostupný';}
 }
 function render(result){
  usage(result.usage);el('moni-status').textContent='Moni · připojeno';
  el('moni-meta').textContent=`@${result.handle} · ${result.cached?'Uložená data':'Načteno z Moni'} · ${new Date(result.fetchedAt).toLocaleString('cs-CZ')} · platnost cache do ${new Date(result.expiresAt).toLocaleString('cs-CZ')}`;
  const d=result.data;
  if(result.part==='profile')el('moni-result').innerHTML=`<div class="moni-profile"><div><span class="eyebrow">PROFIL ÚČTU</span><h2>@${esc(result.handle)}</h2>${d.url?`<a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Otevřít profil na X ↗</a>`:''}<div class="smart-tags">${[...d.tags,...d.categories,...d.chains].map(t=>`<span>${esc(t)}</span>`).join('')}</div></div><div class="moni-metrics">${[['Moni Score',d.score],['Smarts',d.smartsCount],['Smart Mentions',d.smartMentionsCount],['Všechny zmínky',d.mentionsCount]].map(([title,n])=>`<div><span>${title}</span><strong>${num(n)}</strong></div>`).join('')}</div></div><p class="socials-footnote">Skóre a počty dodává Moni. Vyjadřují sociální kontext, nikoli ziskovost peněženky. Historické počty nejsou omezené na posledních 7 dní.</p>`;
  else if(result.part==='mentions')el('moni-result').innerHTML=`<h2>Smart Mentions · posledních 7 dní</h2><p class="socials-footnote">Nejvýše 20 posledních zmínek účtu @${esc(result.handle)}. Moni vrací odkazy na příspěvky; jejich text zde nenačítáme.</p>${d.items.length?d.items.map(row=>`<div class="moni-list-row"><strong>${esc(row.authorUrl?new URL(row.authorUrl).pathname.slice(1):'Účet na X')}</strong><span>${row.at?esc(new Date(row.at*1000).toLocaleString('cs-CZ')):'Datum není dostupné'}</span>${row.postUrl?`<a href="${esc(row.postUrl)}" target="_blank" rel="noopener noreferrer">Otevřít příspěvek ↗</a>`:'<span>Odkaz není dostupný</span>'}</div>`).join(''):'<p>Moni pro toto období nevrátilo žádné zmínky.</p>'}`;
  else el('moni-result').innerHTML=`<h2>Významní sledující · Smarts</h2><p class="socials-footnote">Zobrazeno ${d.items.length}${d.total!==null?' z '+num(d.total):''}. První stránka podle pořadí Moni, nejvýše 20 účtů.</p>${d.items.length?d.items.map(row=>`<div class="moni-list-row"><strong>@${esc(row.handle)}</strong><span>Moni Score ${num(row.score)} · ${num(row.smartsCount)} Smarts</span>${row.url?`<a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">Profil na X ↗</a>`:''}</div>`).join(''):'<p>Moni nevrátilo žádné významné sledující.</p>'}`;
 }
 async function load(nextPart){
  if(!handle)return;
  part=nextPart;const current=++revision,requested=handle;
  el('moni-error').hidden=true;el('moni-meta').textContent='';
  document.querySelectorAll('[data-moni-part]').forEach(b=>{b.classList.toggle('active',b.dataset.moniPart===part);b.setAttribute('aria-selected',String(b.dataset.moniPart===part));});
  el('moni-result').innerHTML='<p role="status">Načítám data z Moni…</p>';
  const key=handle+':'+part,cached=results.get(key);
  try{
   const result=cached&&Date.parse(cached.expiresAt)>Date.now()?cached:await api('account',{handle:requested,part:nextPart});
   results.set(key,result);if(current!==revision)return;
   render(result);
  }catch(error){if(current!==revision)return;el('moni-result').innerHTML='';el('moni-error').textContent=error.message;el('moni-error').hidden=false;show();}
 }
 el('moni-form').addEventListener('submit',event=>{
  event.preventDefault();const input=el('moni-handle').value.trim().replace(/^@/,'');
  if(!/^[a-z0-9_]{1,15}$/i.test(input)){el('moni-error').textContent='Zadejte @handle účtu na X, ne adresu kontraktu.';el('moni-error').hidden=false;return;}
  handle=input.toLowerCase();el('moni-tabs').hidden=false;load('profile');
 });
 el('socials-section').addEventListener('click',event=>{const button=event.target.closest('[data-moni-part]');if(button)load(button.dataset.moniPart);});
 async function watchApi(method='GET',handle=''){
  const r=await fetch('/api/socials/watchlist'+(method==='DELETE'?'/'+encodeURIComponent(handle):''),{method,...(method==='POST'?{headers:{'Content-Type':'application/json'},body:JSON.stringify({handle})}:{})});const d=await r.json();if(!r.ok)throw Error(d.error||'Seznam nelze uložit.');return d.items;
 }
 function drawWatchlist(items){el('moni-watchlist').innerHTML=items.length?items.map(x=>'<div class="moni-list-row"><strong>@'+esc(x.handle)+'</strong><button class="subtle-button" data-open-account="'+esc(x.handle)+'">Profil · 8 bodů</button><button class="subtle-button" data-remove-account="'+esc(x.handle)+'">Odebrat</button></div>').join(''):'<p class="socials-footnote">Zatím nesledujete žádný účet.</p>';}
 async function refreshWatchlist(){try{drawWatchlist(await watchApi());}catch(e){el('moni-watch-error').textContent=e.message;}}
 async function saveWatch(value){try{drawWatchlist(await watchApi('POST',value));el('moni-watch-input').value='';el('moni-watch-error').textContent='';}catch(e){el('moni-watch-error').textContent=e.message;}}
 el('moni-watch-form').addEventListener('submit',e=>{e.preventDefault();saveWatch(el('moni-watch-input').value);});
 el('socials-section').addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.openAccount){handle=b.dataset.openAccount.toLowerCase();el('moni-handle').value='@'+handle;el('moni-tabs').hidden=false;load('profile');}
  if(b.dataset.watchAccount)saveWatch(b.dataset.watchAccount);
  if(b.dataset.removeAccount){b.disabled=true;try{drawWatchlist(await watchApi('DELETE',b.dataset.removeAccount));}catch(e){el('moni-watch-error').textContent=e.message;b.disabled=false;}}
 });
 el('moni-project-load').addEventListener('click',async()=>{
  const button=el('moni-project-load');button.disabled=true;const chain=el('moni-project-chain').value;
  el('moni-project-meta').textContent='Načítám projekty…';el('moni-projects').innerHTML='';
  try{const r=await api('account',{handle:chain,part:'projects'});usage(r.usage);el('moni-project-meta').textContent=(r.cached?'Uložená data':'Načteno z Moni')+' · '+new Date(r.fetchedAt).toLocaleString('cs-CZ')+' · filtr: '+chain;
   el('moni-projects').innerHTML=r.data.items.length?r.data.items.map(x=>'<div class="moni-project-card"><div><h3>@'+esc(x.handle)+'</h3><p>Moni Score '+num(x.score)+' · '+num(x.smartsCount)+' Smarts · změna za 24 h: '+num(x.smartsChange)+'</p><p class="socials-footnote">'+esc([...x.categories,...x.chains].join(' · '))+'</p></div><div><button class="subtle-button" data-open-account="'+esc(x.handle)+'">Profil · 8 bodů</button> <button class="subtle-button" data-watch-account="'+esc(x.handle)+'">Sledovat</button></div></div>').join(''):'<p>Moni pro tento filtr nevrátilo projekty.</p>';
  }catch(e){el('moni-project-meta').textContent=e.message;}finally{button.disabled=!status?.configured;}
 });
 return {show};
}
