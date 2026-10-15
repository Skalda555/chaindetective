import http from 'node:http';
import {existsSync} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ScanEngine} from './server/scans.mjs';
import {SmartWalletStore} from './server/smart-wallets.mjs';
import {MoniService} from './server/moni.mjs';

const base=path.dirname(fileURLToPath(import.meta.url)),root=path.join(base,'dist');
try{process.loadEnvFile(path.join(base,'.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
const zip=promisify(gzip),types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json'};
async function body(request){
 if(!request.headers['content-type']?.startsWith('application/json'))throw new Error('Požadován JSON.');
 let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>2*1024*1024)throw new Error('Příliš velký dotaz.');chunks.push(chunk);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
}
export function createApp({dbPath=path.join(base,'.data','chaindetective.sqlite'),provider,cacheMs,moniOptions}={}){
 const scans=new ScanEngine({filename:dbPath,provider,cacheMs});
 const smartWallets=new SmartWalletStore(scans.store.db);
 const moni=new MoniService(scans.store.db,moniOptions);
 const server=http.createServer(async(request,response)=>{
  const json=async(status,data)=>{let bytes=Buffer.from(JSON.stringify(data));const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Accept-Encoding'};if(bytes.length>2048&&/\bgzip\b/.test(request.headers['accept-encoding']||'')){bytes=await zip(bytes);headers['Content-Encoding']='gzip';}response.writeHead(status,headers);response.end(bytes);};
  try{
   const url=new URL(request.url,'http://'+request.headers.host);
   if(url.pathname.startsWith('/api/')){
    if((!process.env.VERCEL&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))||request.headers.origin&&request.headers.origin!==url.origin){await json(403,{error:'API přijímá pouze požadavky z místní aplikace.'});return;}
    if(request.method==='GET'&&url.pathname==='/api/health'){await json(200,{service:'chaindetective',backendVersion:2});return;}
    if(request.method==='GET'&&url.pathname==='/api/providers'){await json(200,scans.provider.status?.()||{});return;}
    if(url.pathname==='/api/socials/watchlist'){
     if(request.method==='GET'){await json(200,{items:moni.watchlist()});return;}
     if(request.method==='POST'){await json(200,{items:moni.watch((await body(request)).handle)});return;}
    }
    if(request.method==='DELETE'&&url.pathname.startsWith('/api/socials/watchlist/')){await json(200,{items:moni.unwatch(decodeURIComponent(url.pathname.slice('/api/socials/watchlist/'.length)))});return;}
    if(request.method==='GET'&&url.pathname==='/api/socials/moni/status'){await json(200,moni.status());return;}
    if(request.method==='POST'&&url.pathname==='/api/socials/moni/account'){const input=await body(request);await json(200,await moni.get(input.handle,input.part));return;}
    if(request.method==='POST'&&url.pathname==='/api/smart-wallets/import-preview'){await json(200,smartWallets.previewImport(await body(request)));return;}
    if(url.pathname==='/api/smart-wallets'){
     if(request.method==='GET'){await json(200,{wallets:smartWallets.list()});return;}
     if(request.method==='POST'){await json(201,smartWallets.add(await body(request)));return;}
     if(request.method==='PATCH'){const input=await body(request);await json(200,smartWallets.bulkUpdate(input.addresses,input.changes));return;}
     if(request.method==='DELETE'){const input=await body(request);await json(200,smartWallets.deleteMany(input.addresses));return;}
    }
    const walletPath=url.pathname.match(/^\/api\/smart-wallets\/(0x[0-9a-fA-F]{40})$/);
    if(walletPath&&request.method==='PUT'){await json(200,{wallet:smartWallets.update(walletPath[1],await body(request))});return;}
    if(walletPath&&request.method==='DELETE'){const result=smartWallets.deleteMany([walletPath[1]]);if(!result.deleted.length){const error=new Error('Peněženka nebyla nalezena.');error.status=404;throw error;}await json(200,{address:result.deleted[0],deleted:true});return;}
    if(url.pathname==='/api/scans'){
     if(request.method==='GET'){await json(200,{scans:scans.store.list()});return;}
     if(request.method==='POST'){await json(202,scans.start(await body(request)));return;}
    }
    const match=url.pathname.match(/^\/api\/scans\/([a-f0-9-]{36})(?:\/(result|pause|resume))?$/);
    if(match){const [,id,action]=match;
     if(!scans.store.get(id)){await json(404,{error:'Sken nebyl nalezen.'});return;}
     if(request.method==='DELETE'&&!action){await json(200,scans.remove(id));return;}
     if(request.method==='GET'&&!action){await json(200,scans.store.describe(id));return;}
     if(request.method==='GET'&&action==='result'){await json(200,scans.result(id,{offset:url.searchParams.get('offset'),limit:url.searchParams.get('limit'),revision:url.searchParams.has('revision')?url.searchParams.get('revision'):undefined,view:url.searchParams.get('view')||'wallets',sort:url.searchParams.get('sort')||'holders',minHolders:url.searchParams.get('minHolders'),minShare:url.searchParams.get('minShare'),chainId:url.searchParams.get('chainId')||'',search:url.searchParams.get('search')||''}));return;}
     if(request.method==='POST'&&['pause','resume'].includes(action)){await body(request);await json(200,action==='pause'?await scans.pause(id):scans.resume(id));return;}
    }
    await json(404,{error:'API endpoint nebyl nalezen.'});return;
   }
   if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);response.end();return;}
   const pathname=decodeURIComponent(url.pathname),file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
   if(!file.startsWith(root+path.sep)||!(await stat(file)).isFile()){response.writeHead(404);response.end();return;}
   const bytes=await readFile(file);response.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});response.end(request.method==='HEAD'?undefined:bytes);
  }catch(error){if(!response.headersSent)await json(request.url.startsWith('/api/')?(error.status||400):404,{error:error.message});else response.end();}
 });
 return {server,scans,moni,async close(){await moni.close();await scans.close();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
let vercelApp;
export default function handler(request,response){
 if(!vercelApp){
  const dbPath=process.env.VERCEL?path.join('/tmp','chaindetective.sqlite'):path.join(base,'.data','chaindetective.sqlite');
  vercelApp=createApp({dbPath});
 }
 vercelApp.server.emit('request',request,response);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const envFile=path.join(base,'.env');if(existsSync(envFile))process.loadEnvFile(envFile);
 const app=createApp();const port=Number(process.env.PORT||4173);
 app.server.listen(port,'127.0.0.1',()=>console.log(`ChainDetective v0.3 · Local: http://127.0.0.1:${port} · PID ${process.pid}`));
 let closing=false;const shutdown=async()=>{if(closing)return;closing=true;await app.close();process.exit(0);};
 process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}
