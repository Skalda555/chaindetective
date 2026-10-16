import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {MoniService,MONI_PROJECT_PARAM_COVERAGE} from '../server/moni.mjs';

const key='fixture-secret',row={meta:{userUrl:'https://x.com/example',createdAt:'2026-10-01T00:00:00Z'},smartEngagement:{moniScore:55,smartsCount:9,smartMentionsCount:4,smartMentionsCountChange:2,followersCount:100,followersCountChange:5},smartProfile:{projectTags:[{name:'DeFi'}],chains:[{name:'Base'}]}};
const json=data=>({ok:true,status:200,json:async()=>data});
const ui=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const socialUi=await readFile(new URL('../dist/socials.js',import.meta.url),'utf8');
for(const key of ['changesTimeframe','feedTimeframe','limit','offset','orderBy','orderByDirection','tags','chains','excludeTags','excludeChains','minSmartFollowersCount','maxSmartFollowersCount','minFollowersCount','maxFollowersCount','showOnlyContracts','showOnlyPublic'])assert.equal(MONI_PROJECT_PARAM_COVERAGE.curated[key],'ui',`Curated API parameter coverage: ${key}`);
for(const key of ['changesTimeframe','feedTimeframe','limit','offset','orderBy','orderByDirection','minMlProjectPredictionPercents','maxMlProjectPredictionPercents','showOnlyContracts'])assert.equal(MONI_PROJECT_PARAM_COVERAGE.raw[key],'ui',`Raw API parameter coverage: ${key}`);
for(const id of ['moni-project-mode','moni-project-feed-timeframe','moni-project-order-by','moni-project-changes-timeframe','moni-project-order-direction','moni-project-advanced','moni-project-min-smart-followers','moni-project-max-smart-followers','moni-project-min-followers','moni-project-max-followers','moni-project-min-ml','moni-project-max-ml','moni-project-contracts','moni-project-public','moni-project-raw-contracts','moni-project-preset','moni-project-reset','moni-project-prev','moni-project-next'])assert.ok(ui.includes(`id="${id}"`),`UI control exists for ${id}`);
for(const enumValue of ['CREATED_AT','SCORE','SMART_FOLLOWERS_COUNT','FOLLOWERS_COUNT','FOLLOWERS_COUNT_CHANGE','SMART_MENTIONS_COUNT','MENTIONS_COUNT','MENTIONS_COUNT_CHANGE','ML_PROJECT_PREDICTION','SCORE_CHANGE','SMART_MENTIONS_COUNT_CHANGE','SMART_FOLLOWERS_COUNT_CHANGE'])assert.ok(ui.includes(`value="${enumValue}"`),`all MONI orderBy values available: ${enumValue}`);
assert.match(socialUi,/fetch\('\/api\/socials\/moni\/projects\?'/,'filter changes consult only the local cache');
assert.match(socialUi,/api\('projects',\{query\}\)/,'only explicit load posts a paid feed request');

const db=new DatabaseSync(':memory:');let calls=0;const service=new MoniService(db,{apiKey:key,budget:5000,intervalMs:0,fetchImpl:async url=>{calls++;assert.equal(url.searchParams.get('limit'),'10');return json({items:[row]});}});
try{
 const baseline={endpointMode:'curated',feedTimeframe:'D7',changesTimeframe:'H24',orderBy:'SCORE',orderByDirection:'DESC',limit:10,offset:0};
 assert.equal(service.projectCache(baseline).cacheStatus,'missing');assert.equal(calls,0,'cache reads make no external request');
 const variants=[{chains:['base']},{chains:['ethereum']},{tags:['defi']},{tags:['ai']},{minSmartFollowersCount:100},{minSmartFollowersCount:200},{feedTimeframe:'D30'},{orderBy:'FOLLOWERS_COUNT'},{orderByDirection:'ASC'},{changesTimeframe:'D7'},{offset:10},{showOnlyPublic:true},{showOnlyContracts:false},{excludeTags:['nft']},{excludeChains:['base']},{maxSmartFollowersCount:100},{minFollowersCount:10},{maxFollowersCount:100}];
 for(const variant of variants)await service.get('all','projects',{filters:{...baseline,...variant},force:true});
 const keys=db.prepare("SELECT handle FROM moni_cache WHERE part='projects'").all().map(x=>x.handle);assert.equal(new Set(keys).size,variants.length,'every differing canonical query has its own cache identity');assert.ok(keys.every(x=>x.startsWith('projects-v3|')),'cache methodology version is projects-v3');
 const raw={endpointMode:'raw',feedTimeframe:'D7',changesTimeframe:'H24',orderBy:'ML_PROJECT_PREDICTION',orderByDirection:'DESC',limit:10,offset:0,minMlProjectPredictionPercents:20,maxMlProjectPredictionPercents:80,showOnlyContracts:true};
 const rawResult=await service.get('all','projects',{filters:raw,force:true});assert.equal(rawResult.data.items[0].score,55);assert.equal(service.projectCache(raw).cacheStatus,'fresh');
 const rawCache=db.prepare("SELECT handle FROM moni_cache WHERE part='projects' AND payload LIKE '%ML_PROJECT_PREDICTION%'").get();assert.ok(rawCache.handle.startsWith('projects-v3|'));
 assert.equal(calls,variants.length+1);assert.equal(service.status().estimatedPoints,calls,'one fixture result costs one simulated point');
 for(const invalid of [
  {...baseline,orderBy:'UNKNOWN'}, {...baseline,feedTimeframe:'D2'}, {...baseline,chains:['not valid']}, {...baseline,minFollowersCount:-1}, {...baseline,minFollowersCount:5,maxFollowersCount:2}, {...baseline,limit:11}, {...baseline,notAParameter:'x'}, {...raw,showOnlyPublic:true}, {...baseline,minMlProjectPredictionPercents:10},
 ])assert.throws(()=>service.projectCache(invalid),undefined,'invalid or unsupported input is rejected');
 const emptyMin={...baseline,minMlProjectPredictionPercents:101,endpointMode:'raw'};assert.throws(()=>service.projectCache(emptyMin));
}finally{await service.close();db.close();}

console.log('MONI screener regressions passed: complete documented parameter coverage, v3 query identity, Raw/Curated separation, strict validation, cache-only filter changes and explicit paid-load wiring.');
