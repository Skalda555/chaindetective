import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';

const A='0x11111111111111111111111111111111111111aA',B='0x2222222222222222222222222222222222222222';
const temp=await mkdtemp(path.join(os.tmpdir(),'chaindetective-wallet-tests-')),dbPath=path.join(temp,'wallets.sqlite');
let app;
async function start(){app=createApp({dbPath});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${app.server.address().port}`;}
try{
 let origin=await start();
 const call=async(method,route='',body)=>{const r=await fetch(origin+'/api/smart-wallets'+route,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
 const record={name:'Výzkum <script>',tags:['DEX trader','DEX trader'],source:'Vlastní průzkum',note:'Nákup před růstem; ověřit historii.',status:'candidate',chainIds:['base','ethereum','base']};
 assert.deepEqual((await call('GET')).body.wallets,[]);
 const added=await call('POST','',{...record,addresses:[A,A.toLowerCase(),B]});assert.equal(added.status,201);assert.equal(added.body.created.length,2);
 let rows=(await call('GET')).body.wallets;assert.equal(rows.length,2);assert.ok(rows.some(w=>w.address===A.toLowerCase()));assert.deepEqual(rows[0].chainIds,['base','ethereum']);assert.deepEqual(rows[0].tags,['DEX trader']);
 const duplicate=await call('POST','',{...record,name:'Should not replace',note:'Lost note',addresses:[A]});assert.deepEqual(duplicate.body.created,[]);assert.deepEqual(duplicate.body.existing,[A.toLowerCase()]);assert.equal((await call('GET')).body.wallets.find(w=>w.address===A.toLowerCase()).note,record.note);
 const invalidBatch=await call('POST','',{...record,addresses:['0x3333333333333333333333333333333333333333','invalid']});assert.equal(invalidBatch.status,400);assert.equal((await call('GET')).body.wallets.length,2,'invalid batch must not insert its valid subset');
 for(const override of [{status:'smartmoney-guaranteed'},{chainIds:['not-a-chain']},{chainIds:[]},{tags:Array(13).fill('x')},{name:'a'.repeat(101)}])assert.equal((await call('POST','',{...record,...override,addresses:[A]})).status,400);
 const updated=await call('PUT','/'+A,{...record,status:'reviewed',name:'Ručně prověřená',note:'Poznámka po úpravě'});assert.equal(updated.status,200);assert.equal(updated.body.wallet.status,'reviewed');const createdAt=updated.body.wallet.createdAt;
 assert.equal((await call('PUT','/0x4444444444444444444444444444444444444444',record)).status,404);
 assert.equal((await fetch(origin+'/api/smart-wallets',{method:'POST',headers:{Origin:'https://foreign.example','Content-Type':'application/json'},body:JSON.stringify({...record,addresses:[A]})})).status,403);
 await app.close();app=null;origin=await start();
 rows=(await call('GET')).body.wallets;assert.equal(rows.length,2);const saved=rows.find(w=>w.address===A.toLowerCase());assert.equal(saved.note,'Poznámka po úpravě');assert.equal(saved.createdAt,createdAt);assert.equal(saved.status,'reviewed');
 await call('PUT','/'+A,{...record,status:'excluded'});await call('PUT','/'+A,{...record,status:'candidate'});assert.equal((await call('GET')).body.wallets.length,2,'excluding and reactivating must preserve the record');
 console.log('Smart wallet regressions passed: atomic batch validation, normalized deduplication, preserved notes, updates, status changes, SQLite restart and HTTP origin isolation.');
}finally{if(app)await app.close();const resolved=path.resolve(temp);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep+'chaindetective-wallet-tests-'));await rm(resolved,{recursive:true,force:true});}
