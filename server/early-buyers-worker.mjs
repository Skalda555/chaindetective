import {parentPort,workerData} from 'node:worker_threads';
import {runEarlyBuyersScan} from './early-buyers-engine.mjs';

const send=(type,payload)=>parentPort?.postMessage({type,...payload});
const capture=(type,original)=>(...args)=>{const line=args.map(value=>typeof value==='string'?value:JSON.stringify(value)).join(' ');send(type,{line});};
console.log=capture('log',console.log);
console.error=capture('error',console.error);
try{
 const snapshot=await runEarlyBuyersScan({apiToken:process.env.ENVIO_API_TOKEN,snapshotAt:workerData?.snapshotAt,excludeTop100:workerData?.excludeTop100!==false,validate:false,writeArtifact:false});
 send('result',{snapshot});
}catch(error){send('failure',{message:error?.message||'Early Buyers scan failed.'});}
