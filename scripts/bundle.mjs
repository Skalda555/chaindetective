import {readFile,writeFile,mkdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const [html,css,data,app,favicon]=await Promise.all(['dist/index.html','dist/style.css','dist/data.js','dist/app.js','dist/favicon.svg'].map(read));
const exports=[...data.matchAll(/export\s+(?:const|async function|function)\s+(\w+)/g)].map(m=>m[1]);
const script=data.replace(/export /g,'')+`\nconst data={${exports.join(',')}};\n`+app.replace("import * as data from './data.js';",'');
new Function(script); // Compile without executing: standalone must contain no unresolved imports or duplicate bindings.
const standalone=html.replace('<link rel="stylesheet" href="./style.css">',`<style>${css}</style>`).replace('href="./favicon.svg"',`href="data:image/svg+xml;base64,${Buffer.from(favicon).toString('base64')}"`).replace('<script type="module" src="./app.js"></script>',`<script type="module">${script.replace(/<\/script/gi,'<\\/script')}</script>`);
await mkdir(new URL('standalone/',root),{recursive:true});
await writeFile(new URL('standalone/ChainDetective.html',root),standalone);
console.log('Standalone: standalone/ChainDetective.html');
