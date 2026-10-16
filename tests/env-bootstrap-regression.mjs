import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,rm,stat,writeFile} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temporaryRoot=await mkdtemp(path.join(os.tmpdir(),'chaindetective-env-'));
const cleanEnv={...process.env};
for(const name of ['SCAN_MAX_WALLETS','SCAN_TASK_CONCURRENCY','ALCHEMY_REQUEST_CONCURRENCY','ALCHEMY_MIN_REQUEST_INTERVAL_MS','BLOCKSCOUT_REQUEST_CONCURRENCY','BLOCKSCOUT_MIN_REQUEST_INTERVAL_MS','ALCHEMY_API_KEY','BLOCKSCOUT_API_KEY','MONI_API_KEY','MONI_MONTHLY_BUDGET','MONI_DASHBOARD_TTL','CHAINDETECTIVE_ENV_FILE','HOST','PORT','CHAINDETECTIVE_ALLOW_LAN'])delete cleanEnv[name];
const scanModule=pathToFileURL(path.join(projectRoot,'server','scans.mjs')).href;
const providerModule=pathToFileURL(path.join(projectRoot,'server','wallet-provider.mjs')).href;
const moniModule=pathToFileURL(path.join(projectRoot,'server','moni.mjs')).href;
const probe=`
 const [{SCAN_CONFIG},{PROVIDER_LIMITS,WalletProviderRouter},{MoniService},{DatabaseSync}]=await Promise.all([
  import(${JSON.stringify(scanModule)}),import(${JSON.stringify(providerModule)}),import(${JSON.stringify(moniModule)}),import('node:sqlite')
 ]);
 const router=new WalletProviderRouter();const db=new DatabaseSync(':memory:');const moni=new MoniService(db);
 console.log(JSON.stringify({scan:SCAN_CONFIG,limits:PROVIDER_LIMITS,keys:{alchemy:router.alchemy.configured,blockscout:!!router.blockscout.proApiKey,moni:moni.status().configured}}));db.close();
`;
function runProbe(envFile){
 const childEnv={...cleanEnv,CHAINDETECTIVE_ENV_FILE:envFile};
 const result=spawnSync(process.execPath,['--input-type=module','-e',probe],{cwd:projectRoot,env:childEnv,encoding:'utf8'});
 assert.equal(result.status,0,`config probe failed: ${result.stderr}`);
 return JSON.parse(result.stdout.trim());
}
async function freePort(){const server=net.createServer();await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));return port;}
try{
 const overrideFile=path.join(temporaryRoot,'override.env');
 await writeFile(overrideFile,'SCAN_MAX_WALLETS=321\nSCAN_TASK_CONCURRENCY=7\nALCHEMY_REQUEST_CONCURRENCY=9\nALCHEMY_MIN_REQUEST_INTERVAL_MS=37\nBLOCKSCOUT_REQUEST_CONCURRENCY=2\nBLOCKSCOUT_MIN_REQUEST_INTERVAL_MS=83\nALCHEMY_API_KEY=test-alchemy-key\nBLOCKSCOUT_API_KEY=test-blockscout-key\nMONI_API_KEY=test-moni-key\n','utf8');
 const configured=runProbe(overrideFile);
 assert.deepEqual(configured.scan,{maxWallets:321,taskConcurrency:7},'dotenv scan values load before SCAN_CONFIG initializes');
 assert.deepEqual(configured.limits,{alchemy:{concurrency:9,intervalMs:37},blockscout:{concurrency:2,intervalMs:83}},'dotenv provider limits load before PROVIDER_LIMITS initializes');
 assert.deepEqual(configured.keys,{alchemy:true,blockscout:true,moni:true},'dummy provider keys are available at initialization without exposing their values');

 const missingFile=path.join(temporaryRoot,'missing.env');
 const defaults=runProbe(missingFile);
 assert.deepEqual(defaults.scan,{maxWallets:500,taskConcurrency:4});
 assert.deepEqual(defaults.limits,{alchemy:{concurrency:4,intervalMs:200},blockscout:{concurrency:1,intervalMs:400}});
 assert.deepEqual(defaults.keys,{alchemy:false,blockscout:false,moni:false});

 const invalidFile=path.join(temporaryRoot,'invalid.env');
 await writeFile(invalidFile,'SCAN_MAX_WALLETS=-1\nSCAN_TASK_CONCURRENCY=abc\nALCHEMY_REQUEST_CONCURRENCY=0\nALCHEMY_MIN_REQUEST_INTERVAL_MS=abc\nBLOCKSCOUT_REQUEST_CONCURRENCY=-5\nBLOCKSCOUT_MIN_REQUEST_INTERVAL_MS=0\n','utf8');
 const invalid=runProbe(invalidFile);
 assert.deepEqual(invalid.scan,{maxWallets:500,taskConcurrency:4},'invalid scan values fall back to valid defaults');
 assert.deepEqual(invalid.limits,{alchemy:{concurrency:4,intervalMs:200},blockscout:{concurrency:1,intervalMs:400}},'invalid provider values fall back to valid defaults');

 // Exercise the actual standard entrypoint in a disposable project copy so its
 // SQLite file and listener cannot affect the user's working server/database.
 const isolatedProject=path.join(temporaryRoot,'project');
 await mkdir(isolatedProject,{recursive:true});
 await cp(path.join(projectRoot,'server.mjs'),path.join(isolatedProject,'server.mjs'));
 await cp(path.join(projectRoot,'server'),path.join(isolatedProject,'server'),{recursive:true});
 await cp(path.join(projectRoot,'dist'),path.join(isolatedProject,'dist'),{recursive:true});
 const startupEnv=path.join(isolatedProject,'.env');await writeFile(startupEnv,'SCAN_MAX_WALLETS=321\nSCAN_TASK_CONCURRENCY=7\nALCHEMY_API_KEY=test-only\n','utf8');
 const port=await freePort();const child=spawn(process.execPath,['server.mjs'],{cwd:isolatedProject,env:{...cleanEnv,CHAINDETECTIVE_ENV_FILE:startupEnv,PORT:String(port)},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 const deadline=Date.now()+10000;let health;
 while(Date.now()<deadline){
  if(child.exitCode!==null)throw new Error(`standard server exited early (${child.exitCode}): ${output}`);
  try{const response=await fetch(`http://127.0.0.1:${port}/api/health`);if(response.ok){health=await response.json();break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 assert.deepEqual(health,{service:'chaindetective',backendVersion:2},`standard server startup smoke failed: ${output}`);
 assert.match(output,/ChainDetective v0\.3/,'standard entrypoint reached listening state');
 assert.match(output,/Listening: http:\/\/127\.0\.0\.1:/,'default HOST keeps the standard server loopback-only');
 assert.ok((await stat(path.join(isolatedProject,'.data','chaindetective.sqlite'))).size>0,'default SQLite storage creates .data and preserves the production path when it does not exist');
 child.kill('SIGTERM');await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('isolated server did not stop')),5000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
 console.log('Env bootstrap regressions passed: dotenv-before-import overrides, provider credentials (boolean only), defaults, invalid-value fallback, and isolated standard server startup/health/shutdown.');
}finally{
 const resolved=path.resolve(temporaryRoot);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep+'chaindetective-env-'));await rm(resolved,{recursive:true,force:true});
}
