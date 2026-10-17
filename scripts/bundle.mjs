import {readFile,writeFile,mkdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const [html,css,data,app,favicon,brand,smart,socials,earlyBuyers]=await Promise.all(['dist/index.html','dist/style.css','dist/data.js','dist/app.js','dist/favicon.svg','dist/brand.svg','dist/smart-wallets.js','dist/socials.js','dist/early-buyers.js'].map(read));
const roadmapScript=await read('dist/roadmap.js');
const roadmapData=await read('roadmap/roadmap-data.json');
await writeFile(new URL('dist/roadmap-data.json',root),roadmapData.endsWith('\n')?roadmapData:roadmapData+'\n');
const exports=[...data.matchAll(/export\s+(?:const|async function|function)\s+(\w+)/g)].map(m=>m[1]);
const script=data.replace(/export /g,'')+`\nconst data={${exports.join(',')}};\n`+smart.replace(/import\s+\{[^}]+\}\s+from\s+'\.\/data\.js';/,'').replace('export function initSmartWallets','function initSmartWallets')+'\n'+socials.replace('export function initSocials','function initSocials')+'\n'+earlyBuyers.replace('export function initEarlyBuyers','function initEarlyBuyers')+'\n'+app.replace("import * as data from './data.js';",'').replace("import {initSmartWallets} from './smart-wallets.js';",'').replace("import {initSocials} from './socials.js';",'').replace("import {initEarlyBuyers} from './early-buyers.js';",'');
new Function(script); // Compile without executing: standalone must contain no unresolved imports or duplicate bindings.
const standalone=html.replace('<link rel="stylesheet" href="./style.css">',`<style>${css}</style>`).replace('href="./favicon.svg"',`href="data:image/svg+xml;base64,${Buffer.from(favicon).toString('base64')}"`).replace('src="./brand.svg"',`src="data:image/svg+xml;base64,${Buffer.from(brand).toString('base64')}"`).replace('<script type="module" src="./app.js"></script>',`<script type="module">${script.replace(/<\/script/gi,'<\\/script')}</script>`);
await mkdir(new URL('standalone/',root),{recursive:true});
await writeFile(new URL('standalone/ChainDetective.html',root),standalone);
for(const filename of ['roadmap.html','roadmap-v2-audit.html']){
 const roadmap=await read('dist/'+filename);
 const embeddedData=filename==='roadmap.html'?`<script type="application/json" id="roadmap-canonical-data">${JSON.stringify(JSON.parse(roadmapData)).replace(/</g,'\\u003c')}</script>`:'';
 await writeFile(new URL('standalone/'+filename,root),roadmap.replace('<link rel="stylesheet" href="./style.css">',`<style>${css}</style>`).replaceAll('href="./"','href="./ChainDetective.html"').replace('href="./favicon.svg"',`href="data:image/svg+xml;base64,${Buffer.from(favicon).toString('base64')}"`).replace('<script src="./roadmap.js"></script>',`${embeddedData}<script src="./roadmap.js"></script>`));
}
await writeFile(new URL('standalone/roadmap.js',root),roadmapScript);
console.log('Standalone: standalone/ChainDetective.html');
