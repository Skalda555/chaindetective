import {readFile,writeFile,mkdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const [html,css,data,app,favicon,brand,smart,socials]=await Promise.all(['dist/index.html','dist/style.css','dist/data.js','dist/app.js','dist/favicon.svg','dist/brand.svg','dist/smart-wallets.js','dist/socials.js'].map(read));
const exports=[...data.matchAll(/export\s+(?:const|async function|function)\s+(\w+)/g)].map(m=>m[1]);
const script=data.replace(/export /g,'')+`\nconst data={${exports.join(',')}};\n`+smart.replace("import {MAX_WALLET_SCAN,debankProfileUrl,isSystemWalletAddress} from './data.js';",'').replace('export function initSmartWallets','function initSmartWallets')+'\n'+socials.replace('export function initSocials','function initSocials')+'\n'+app.replace("import * as data from './data.js';",'').replace("import {initSmartWallets} from './smart-wallets.js';",'').replace("import {initSocials} from './socials.js';",'');
new Function(script); // Compile without executing: standalone must contain no unresolved imports or duplicate bindings.
const standalone=html.replace('<link rel="stylesheet" href="./style.css">',`<style>${css}</style>`).replace('href="./favicon.svg"',`href="data:image/svg+xml;base64,${Buffer.from(favicon).toString('base64')}"`).replace('src="./brand.svg"',`src="data:image/svg+xml;base64,${Buffer.from(brand).toString('base64')}"`).replace('<script type="module" src="./app.js"></script>',`<script type="module">${script.replace(/<\/script/gi,'<\\/script')}</script>`);
await mkdir(new URL('standalone/',root),{recursive:true});
await writeFile(new URL('standalone/ChainDetective.html',root),standalone);
for(const filename of ['roadmap.html','roadmap-v2-audit.html']){
 const roadmap=await read('dist/'+filename);
 await writeFile(new URL('standalone/'+filename,root),roadmap.replace('<link rel="stylesheet" href="./style.css">',`<style>${css}</style>`).replaceAll('href="./"','href="./ChainDetective.html"').replace('href="./favicon.svg"',`href="data:image/svg+xml;base64,${Buffer.from(favicon).toString('base64')}"`));
}
console.log('Standalone: standalone/ChainDetective.html');
