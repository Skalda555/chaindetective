import assert from 'node:assert/strict';
import {existsSync, statSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';

const scriptPath=fileURLToPath(import.meta.url);
const defaultRoot=path.resolve(path.dirname(scriptPath),'..');
const statuses=new Set(['not-started','in-progress','done']);
const forbiddenEvidenceFields=['commit','deployed','deployment_target'];

export function validateRoadmap({root=defaultRoot,data,html,script,distData,standaloneHtml}){
 const fail=(condition,message)=>assert.ok(condition,`Roadmap validation: ${message}`);
 fail(data&&typeof data==='object'&&data.schema_version===1,'schema_version must be 1');
 fail(Array.isArray(data.phases)&&data.phases.length>0,'phases must be a non-empty array');
 fail(Array.isArray(data.tasks)&&data.tasks.length>0,'tasks must be a non-empty array');
 fail(isDeepStrictEqual(distData,data),'dist/roadmap-data.json is out of sync; run npm run bundle');

 const phaseIds=new Set(),phaseNumbers=new Set();
 for(const phase of data.phases){
  fail(typeof phase.id==='string'&&phase.id.length>0,`invalid phase id: ${phase.id}`);
  fail(!phaseIds.has(phase.id),`duplicate phase id: ${phase.id}`);phaseIds.add(phase.id);
  fail(Number.isInteger(phase.number)&&phase.number>0,`invalid phase number for ${phase.id}`);
  fail(!phaseNumbers.has(phase.number),`duplicate phase number: ${phase.number}`);phaseNumbers.add(phase.number);
  fail(typeof phase.title==='string'&&phase.title.trim(),`missing title for ${phase.id}`);
  fail(typeof phase.description==='string'&&phase.description.trim(),`missing description for ${phase.id}`);
  fail(typeof phase.done_definition==='string'&&phase.done_definition.trim(),`missing done definition for ${phase.id}`);
  fail(Number.isInteger(phase.priority)&&phase.priority>0,`invalid priority for ${phase.id}`);
 }

 const taskIds=new Set();
 for(const task of data.tasks){
  fail(typeof task.id==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(task.id),`invalid task id: ${task.id}`);
  fail(!taskIds.has(task.id),`duplicate task id: ${task.id}`);taskIds.add(task.id);
  fail(phaseIds.has(task.phase_id),`unknown phase_id ${task.phase_id} on ${task.id}`);
  fail(typeof task.title==='string'&&task.title.trim(),`missing title on ${task.id}`);
  fail(typeof task.description==='string'&&task.description.trim(),`missing description on ${task.id}`);
  fail(Number.isInteger(task.priority)&&task.priority>0,`invalid priority on ${task.id}`);
  fail(statuses.has(task.status),`invalid status on ${task.id}: ${task.status}`);
  fail(Array.isArray(task.dependencies),`dependencies must be an array on ${task.id}`);
  fail(Array.isArray(task.acceptance_criteria)&&task.acceptance_criteria.every(value=>typeof value==='string'&&value.trim()),`acceptance_criteria must be an array of non-empty strings on ${task.id}`);
  if(task.status!=='done')fail(task.acceptance_criteria.length>0,`active task ${task.id} needs acceptance criteria`);
  fail(task.evidence&&typeof task.evidence==='object'&&!Array.isArray(task.evidence),`evidence must be an object on ${task.id}`);
  for(const key of forbiddenEvidenceFields)fail(!(key in task)&&!(key in task.evidence),`removed evidence field ${key} is still present on ${task.id}`);
  const evidence=task.evidence;
  fail(typeof evidence.verified==='boolean',`evidence.verified must be boolean on ${task.id}`);
  fail(Array.isArray(evidence.tests)&&evidence.tests.every(value=>typeof value==='string'&&value.trim()),`evidence.tests must be an array of repo-relative paths on ${task.id}`);
  for(const testPath of evidence.tests){
   fail(!path.isAbsolute(testPath),`evidence test path must be repo-relative on ${task.id}: ${testPath}`);
   const resolved=path.resolve(root,testPath);
   const relative=path.relative(root,resolved);
   fail(relative!== '..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative),`evidence test path escapes repository on ${task.id}: ${testPath}`);
   fail(existsSync(resolved)&&statSync(resolved).isFile(),`evidence test file does not exist on ${task.id}: ${testPath}`);
  }
  fail(evidence.completed_at===null||validIsoTimestamp(evidence.completed_at),`invalid evidence.completed_at on ${task.id}`);
  fail(evidence.notes===null||typeof evidence.notes==='string',`evidence.notes must be text or null on ${task.id}`);
  if(typeof evidence.notes==='string')fail(evidence.notes.length<=300,`evidence.notes exceeds 300 characters on ${task.id}`);
  if(task.status==='done'){
   fail(evidence.verified===true,`done task ${task.id} must have verified=true`);
   fail(evidence.tests.length>0,`done task ${task.id} must cite relevant test files`);
  }else{
   fail(evidence.verified===false,`non-done task ${task.id} must have verified=false`);
   fail(evidence.completed_at===null,`non-done task ${task.id} must have completed_at=null`);
  }
 }

 const taskById=new Map(data.tasks.map(task=>[task.id,task]));
 for(const task of data.tasks)for(const dependency of task.dependencies){
  fail(typeof dependency==='string',`dependency IDs must be strings on ${task.id}`);
  fail(dependency!==task.id,`self-dependency on ${task.id}`);
  fail(taskById.has(dependency),`unknown dependency ${dependency} on ${task.id}`);
  if(task.status==='in-progress'||task.status==='done')fail(taskById.get(dependency).status==='done',`${task.status} task ${task.id} has unfinished dependency ${dependency}`);
 }
 const state=new Map();
 const visit=(id,chain=[])=>{
  if(state.get(id)===1)fail(false,`dependency cycle: ${[...chain,id].join(' -> ')}`);
  if(state.get(id)===2)return;
  state.set(id,1);
  for(const dependency of taskById.get(id).dependencies)visit(dependency,[...chain,id]);
  state.set(id,2);
 };
 for(const id of taskIds)visit(id);

 const itemReferences=[...html.matchAll(/data-roadmap-item\s*=\s*["']([^"']+)["']/g),...script.matchAll(/data-roadmap-item\s*=\s*["']([^"'$`]+)["']/g)].map(match=>match[1]);
 for(const id of itemReferences)fail(taskIds.has(id),`UI references missing task ${id}`);
 fail(/dataset\.roadmapItem\s*=\s*task\.id/.test(script),'UI must render task IDs from canonical JSON');
 fail(/fetch\(['"]\.\/roadmap-data\.json['"]/.test(script),'served UI must load its generated runtime JSON');
 fail(!/localStorage|chaindetective\.roadmap\.state\.v1/.test(script),'browser code must not read or write roadmap state in localStorage');

 const htmlPhaseNumbers=new Set([...html.matchAll(/data-roadmap-stage-card=["'](\d+)["']/g)].map(match=>Number(match[1])));
 const taskContainers=new Set([...html.matchAll(/data-roadmap-stage-tasks=["'](\d+)["']/g)].map(match=>Number(match[1])));
 for(const phase of data.phases){
  fail(htmlPhaseNumbers.has(phase.number),`HTML has no card for ${phase.id}`);
  fail(taskContainers.has(phase.number),`HTML has no task container for ${phase.id}`);
 }
 fail(data.phases.length===htmlPhaseNumbers.size,'HTML phase cards and canonical phase count differ');
 fail(data.phases.length===taskContainers.size,'HTML task containers and canonical phase count differ');
 const embedded=standaloneHtml.match(/<script type="application\/json" id="roadmap-canonical-data">([\s\S]*?)<\/script>/)?.[1];
 fail(Boolean(embedded),'standalone roadmap must embed canonical data');
 let embeddedData;
 try{embeddedData=JSON.parse(embedded);}catch{fail(false,'standalone embedded roadmap JSON is invalid');}
 fail(isDeepStrictEqual(embeddedData,data),'standalone embedded roadmap differs from canonical data; run npm run bundle');
 return {phases:data.phases.length,tasks:data.tasks.length,done:data.tasks.filter(task=>task.status==='done').length};
}

function validIsoTimestamp(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))return false;
 const timestamp=Date.parse(value);
 if(!Number.isFinite(timestamp))return false;
 return new Date(timestamp).toISOString()===(value.length===20?value.replace('Z','.000Z'):value);
}

async function main(){
 const [raw,distRaw,html,script,standaloneHtml]=await Promise.all([
  readFile(path.join(defaultRoot,'roadmap','roadmap-data.json'),'utf8'),
  readFile(path.join(defaultRoot,'dist','roadmap-data.json'),'utf8'),
  readFile(path.join(defaultRoot,'dist','roadmap.html'),'utf8'),
  readFile(path.join(defaultRoot,'dist','roadmap.js'),'utf8'),
  readFile(path.join(defaultRoot,'standalone','roadmap.html'),'utf8'),
 ]);
 const data=JSON.parse(raw),distData=JSON.parse(distRaw);
 const result=validateRoadmap({root:defaultRoot,data,distData,html,script,standaloneHtml});
 console.log(`Roadmap data valid: ${result.phases} phases, ${result.tasks} tasks, ${result.done} verified done.`);
}

if(process.argv[1]&&path.resolve(process.argv[1])===scriptPath)await main();
