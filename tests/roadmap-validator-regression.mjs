import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateRoadmap} from '../scripts/validate-roadmap.mjs';

const root=new URL('../',import.meta.url).pathname.replace(/^\//,'').replaceAll('/','\\');
const [data,html,script,standaloneHtml]=await Promise.all([
 readFile(new URL('../roadmap/roadmap-data.json',import.meta.url),'utf8').then(JSON.parse),
 readFile(new URL('../dist/roadmap.html',import.meta.url),'utf8'),
 readFile(new URL('../dist/roadmap.js',import.meta.url),'utf8'),
 readFile(new URL('../standalone/roadmap.html',import.meta.url),'utf8'),
]);

const clone=value=>JSON.parse(JSON.stringify(value));
const embeddedHtml=value=>standaloneHtml.replace(/(<script type="application\/json" id="roadmap-canonical-data">)[\s\S]*?(<\/script>)/,`$1${JSON.stringify(value)}$2`);
const check=(candidate=data,standalone=embeddedHtml(candidate))=>validateRoadmap({
 root,data:candidate,distData:clone(candidate),html,script,standaloneHtml:standalone,
});
const rejects=(mutate,pattern)=>{
 const fixture=clone(data);mutate(fixture);
 assert.throws(()=>check(fixture),pattern);
};

check();
rejects(fixture=>{fixture.tasks[1].id=fixture.tasks[0].id;},/duplicate task id/);
rejects(fixture=>{fixture.tasks[0].dependencies=[fixture.tasks[1].id];fixture.tasks[1].dependencies=[fixture.tasks[0].id];},/dependency cycle/);
rejects(fixture=>{fixture.tasks[8].status='in-progress';fixture.tasks[8].dependencies=[fixture.tasks[9].id];},/unfinished dependency/);
rejects(fixture=>{fixture.tasks[0].evidence.verified=false;},/must have verified=true/);
rejects(fixture=>{fixture.tasks[0].evidence.tests=[];},/must cite relevant test files/);
rejects(fixture=>{fixture.tasks[0].evidence.tests=['tests/does-not-exist-roadmap-fixture.mjs'];},/test file does not exist/);
rejects(fixture=>{fixture.tasks[0].evidence.notes='x'.repeat(301);},/exceeds 300 characters/);
const drift=clone(data);drift.tasks[0].title+=' drift';
assert.throws(()=>check(data,embeddedHtml(drift)),/standalone embedded roadmap differs/);

console.log('Roadmap validator regressions passed: duplicate IDs, dependency cycles/statuses, done evidence, missing test path, notes limit and standalone drift.');
