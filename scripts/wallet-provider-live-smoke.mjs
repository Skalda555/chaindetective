import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ScanEngine} from '../server/scans.mjs';
import {WalletProviderRouter} from '../server/wallet-provider.mjs';
import {BlockscoutProvider} from '../server/provider.mjs';
import {isAddress} from '../dist/data.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try{process.loadEnvFile(path.join(root,'.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
const address=process.argv[2]||'0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
if(!isAddress(address)){console.error('Použijte platnou EVM adresu jako argument.');process.exitCode=2;}
else if(!process.env.ALCHEMY_API_KEY?.trim()){console.error('ALCHEMY_API_KEY není nastavený; živý test všech pěti sítí nelze provést.');process.exitCode=2;}
else{
 const blockscoutRequests=[],nativeFetch=globalThis.fetch;
 const blockscout=new BlockscoutProvider({proApiKey:process.env.BLOCKSCOUT_API_KEY||'',intervalMs:0,fetchImpl:async(url,options)=>{const parsed=new URL(url);blockscoutRequests.push({host:parsed.hostname,path:parsed.pathname});return nativeFetch(url,options);}});
 const router=new WalletProviderRouter({blockscout}),engine=new ScanEngine({filename:':memory:',provider:router});
 try{
  const networks=['ethereum','base','optimism','arbitrum','robinhood'];
  const started=engine.start({kind:'wallets',chainIds:networks,addresses:[address],refresh:true});
  await engine.active.get(started.id)?.promise;
  const result=engine.result(started.id);
  const baseUsedBlockscout=blockscoutRequests.some(request=>request.host==='base.blockscout.com'||request.path.startsWith('/8453/'));
  const report={status:result.job.status,providerLabel:result.coverage.providerLabel,tokenGroups:result.tokens.length,positionCount:result.job.positions,baseBlockscoutRequests:baseUsedBlockscout?blockscoutRequests.filter(request=>request.host==='base.blockscout.com'||request.path.startsWith('/8453/')).length:0,warnings:result.warnings,networks:result.coverage.provenance.map(item=>{const task=result.job.tasks.find(task=>task.chainId===item.chainId);return {chainId:item.chainId,provider:item.provider,fallbackUsed:item.fallbackUsed,fallbackFrom:item.fallbackFrom,fallbackReason:item.fallbackReason,asOf:item.asOf,status:item.status,pages:task?.pages,invalidRows:task?.invalidRows,error:item.error};}),blockscoutRequests:blockscoutRequests.map(({host,path})=>({host,path}))};
  console.log(JSON.stringify(report,null,2));
  if(baseUsedBlockscout){console.error('Chyba: Base se pokusila použít Blockscout.');process.exitCode=1;}
 }catch(error){console.error(error.message);process.exitCode=1;}
 finally{await engine.close();}
}
