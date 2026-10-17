import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const [html,script,data,standaloneHtml,standaloneScript]=await Promise.all([
 readFile(new URL('../dist/roadmap.html',import.meta.url),'utf8'),
 readFile(new URL('../dist/roadmap.js',import.meta.url),'utf8'),
 readFile(new URL('../roadmap/roadmap-data.json',import.meta.url),'utf8').then(JSON.parse),
 readFile(new URL('../standalone/roadmap.html',import.meta.url),'utf8'),
 readFile(new URL('../standalone/roadmap.js',import.meta.url),'utf8'),
]);
new Function(script);
assert.equal(data.phases.length,7);
assert.equal(data.tasks.length,32);
assert.deepEqual(data.tasks.slice(0,8).map(task=>task.id),[
 'm1-fallback-exclusive-owner','m1-invalid-rows-coverage','m1-holder-progress-denominator','m1-filtered-result-summary',
 'm1-provider-provenance-csv','m1-success-attempt-timestamps','m1-env-before-provider-init','m1-regression-tests',
],'current stable Etapa 1 IDs remain unchanged and in order');
assert.equal(new Set(data.tasks.map(task=>task.id)).size,data.tasks.length);
assert.ok(data.tasks.filter(task=>task.status==='done').every(task=>task.evidence.verified&&task.evidence.tests.length),'done tasks retain verified status and real test evidence');
assert.match(html,/roadmap-data-error/,'UI has a canonical-data load failure state');
assert.match(html,/<script src="\.\/roadmap\.js"><\/script>/,'served roadmap loads its renderer');
assert.match(html,/grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,320px\),1fr\)\)/,'stage cards keep a readable minimum width and auto-fit available columns');
assert.match(html,/\.roadmap-task-label\{[^}]*font-size:14px/,'task titles are more prominent than secondary metadata');
assert.match(html,/\.roadmap-task-id\{[^}]*font:10px/,'task IDs are subdued metadata');
assert.match(html,/@media\(max-width:700px\)[\s\S]*?\.roadmap-grid\{grid-template-columns:minmax\(0,1fr\)/,'mobile viewport switches to one column');
assert.doesNotMatch(html,/id="now-done-definition"/,'current phase does not repeat the full phase completion definition');
assert.doesNotMatch(html,/id="roadmap-reset"/,'read-only UI does not offer browser-only status reset');
assert.doesNotMatch(script,/localStorage|chaindetective\.roadmap\.state\.v1/,'UI does not read or write legacy localStorage state');
assert.doesNotMatch(standaloneScript,/localStorage|chaindetective\.roadmap\.state\.v1/,'standalone UI also does not use localStorage');
const embeddedRoadmap=standaloneHtml.match(/<script type="application\/json" id="roadmap-canonical-data">([\s\S]*?)<\/script>/)?.[1];
assert.ok(embeddedRoadmap,'standalone roadmap embeds the canonical data for file-based use');
assert.deepEqual(JSON.parse(embeddedRoadmap),data,'standalone roadmap embeds the same canonical data');

class Element {
 constructor({id='',dataset={},textContent='',tag='div'}={}){
  this.id=id;this.tagName=tag.toUpperCase();this.dataset={...dataset};this.textContent=textContent;this.value='';this.hidden=false;this.style={};this.children=[];this.attributes={};this.listeners={};this.parentElement=null;this.className='';
  this.classList={add:name=>{const names=new Set(this.className.split(/\s+/).filter(Boolean));names.add(name);this.className=[...names].join(' ');}};
 }
 append(...children){for(const child of children){this.children.push(child);if(child&&typeof child==='object')child.parentElement=this;}}
 replaceChildren(...children){this.children=[];this.textContent='';this.append(...children);}
 addEventListener(type,listener){this.listeners[type]=listener;}
 setAttribute(name,value){this.attributes[name]=String(value);}
 querySelector(selector){
  if(selector==='h3')return this.heading||null;
  if(selector==='[data-roadmap-stage-tasks]')return this.taskList||null;
  if(selector==='.roadmap-badge')return this.badge||null;
  return null;
 }
 querySelectorAll(selector){return selector==='p'?this.paragraphs||[]:[];}
 dispatch(type){return this.listeners[type]?.({target:this});}
}

const elements=new Map();
const add=(id,element=new Element({id}))=>(elements.set(id,element),element);
const phaseCards=new Map();
for(const phase of data.phases){
 const card=new Element({dataset:{roadmapStageCard:String(phase.number)}});
 card.badge=new Element({textContent:'ETAPA'});
 card.heading=new Element({tag:'h3'});
 card.paragraphs=[new Element({tag:'p'}),new Element({tag:'p'})];
 card.taskList=new Element({tag:'ul',dataset:{roadmapStageTasks:String(phase.number)}});
 phaseCards.set(String(phase.number),card);
 add(`roadmap-stage-${phase.number}-label`);
 const bar=add(`roadmap-stage-${phase.number}-bar`);bar.parentElement=new Element();
}
const now=add('now');now.badge=new Element({textContent:'PRÁVĚ TEĎ'});
for(const id of ['roadmap-total-label','roadmap-footer-status','now-title','now-description','now-tasks','roadmap-data-error'])add(id);
const statusFilter=add('roadmap-status-filter');statusFilter.value='all';
const totalBar=add('roadmap-total-bar');totalBar.parentElement=new Element();
const docListeners={};
const document={
 getElementById:id=>elements.get(id)||null,
 createElement:tag=>new Element({tag}),
 createTextNode:text=>({textContent:String(text)}),
 addEventListener:(type,listener)=>{docListeners[type]=listener;},
 querySelector:selector=>{const match=selector.match(/^\[data-roadmap-stage-card="(\d+)"\]$/);return match?phaseCards.get(match[1])||null:null;},
 querySelectorAll:selector=>selector==='[data-roadmap-item]'?data.tasks.flatMap(task=>{
  const list=phaseCards.get(String(data.phases.find(phase=>phase.id===task.phase_id).number)).taskList;
  return list.children.filter(row=>row.dataset.roadmapItem===task.id);
 }):[],
};
let fetchedUrl='';
const context={
 document,
 fetch:async(url,options)=>{fetchedUrl=url;assert.equal(options.cache,'no-store');return {ok:true,json:async()=>data};},
 Date,Map,Set,Math,Number,Boolean,Array,String,
};
runInNewContext(script,context);
assert.equal(typeof docListeners.DOMContentLoaded,'function','roadmap initializes after HTML parsing');
await docListeners.DOMContentLoaded();
assert.equal(fetchedUrl,'./roadmap-data.json');
assert.equal(elements.get('roadmap-data-error').textContent,'','canonical roadmap loads and renders without a UI error');
assert.equal(elements.get('roadmap-total-label').textContent,'8 / 32 hotovo · 25 %');
assert.equal(elements.get('roadmap-stage-1-label').textContent,'8 / 8 hotovo · 100 %');
assert.equal(elements.get('roadmap-stage-2-label').textContent,'0 / 5 hotovo · 0 %');
assert.equal(elements.get('now-title').textContent,data.phases[1].title,'first incomplete phase is derived from canonical status');
assert.equal(phaseCards.get('1').badge.textContent,'DOKONČENO');
assert.equal(phaseCards.get('2').badge.textContent,'AKTUÁLNÍ · NEJVYŠŠÍ PRIORITA');
const allTaskRows=data.phases.flatMap(phase=>phaseCards.get(String(phase.number)).taskList.children);
assert.equal(allTaskRows.length,32);
assert.ok(allTaskRows.every(row=>row.children.length===1&&row.children[0].tagName==='DETAILS'),'each phase task uses a native disclosure row');
const firstTaskRow=allTaskRows.find(row=>row.dataset.roadmapItem==='m1-fallback-exclusive-owner');
const firstTaskDetails=firstTaskRow.children[0];
assert.equal(firstTaskDetails.attributes.open,undefined,'task details are collapsed by default');
assert.equal(firstTaskDetails.children[0].tagName,'SUMMARY','the whole title/status row is the disclosure affordance');
const summaryMain=firstTaskDetails.children[0].children[0];
assert.equal(summaryMain.children[0].textContent,data.tasks[0].title,'collapsed task row prioritizes its title');
assert.equal(summaryMain.children[1].textContent,'HOTOVO','status badges use the compact uppercase labels');
assert.equal(firstTaskDetails.children[1].children[0].textContent,data.tasks[0].id,'stable ID is inside the collapsed detail');
assert.ok(firstTaskDetails.children[1].children[2].children.some(child=>child.textContent.includes('race test')),'acceptance criteria are rendered from canonical data');
assert.ok(elements.get('now-tasks').children.every(row=>row.children.length===1&&row.children[0].children.length===2),'current phase shows only task title and status');

statusFilter.value='done';statusFilter.dispatch('change');
assert.equal(phaseCards.get('1').hidden,false);
assert.equal(phaseCards.get('2').hidden,true);
assert.equal(now.hidden,true,'current-phase panel hides when its tasks do not match the selected status');
statusFilter.value='not-started';statusFilter.dispatch('change');
assert.equal(phaseCards.get('1').hidden,true);
assert.equal(phaseCards.get('2').hidden,false);
assert.ok(phaseCards.get('2').taskList.children.every(row=>!row.hidden));
assert.equal(elements.get('roadmap-total-label').textContent,'8 / 32 hotovo · 25 %','filtering does not change canonical progress');
console.log('Roadmap regressions passed: canonical JSON load, stable IDs, read-only status, evidence details, progress, active phase and status filters.');
