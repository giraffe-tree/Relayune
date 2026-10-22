import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const dir = mkdtempSync(join(tmpdir(), 'relayune-client-versions-'));
await build({ stdin: { contents: 'export * from "./server/client-observations.ts"; export * from "./server/monitoring-users.ts"; export * from "./server/request-log.mjs";', resolveDir: process.cwd() }, outfile: join(dir,'api.cjs'), bundle: true, platform: 'node', format: 'cjs' });
const { createClientObserver, cleanClientVersions, createMonitoringDirectory, runRequestLog, markAuthenticated } = createRequire(import.meta.url)(join(dir,'api.cjs'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
test('metadata updates only the authenticated account, bounds fields and throttles repeat versions', async () => {
  let time=100000; const writes=[];
  const observe=createClientObserver({collection(name){assert.equal(name,'auth_users');return {async updateOne(...args){writes.push(args);}};}},()=>time);
  const header=(platform='macos',version='0.3.22+42')=>({'x-relay-client-platform':platform,'x-relay-client-version':version});
  for(const headers of [{},header('linux'),header('__proto__'),header('web','secret@example.test'),header('web','1.2.3\nsecret'),header('web',['1.2.3'])]) await observe('alice@example.test',headers);
  assert.equal(writes.length,0);
  await observe('alice@example.test',header()); await observe('alice@example.test',header());
  assert.equal(writes.length,1);assert.deepEqual(writes[0],[{_id:'alice@example.test'},{$set:{'client_versions.macos':{version:'0.3.22+42',seen_at:time}}},{maxTimeMS:5000}]);
  await observe('alice@example.test',header('ios')); await observe('alice@example.test',header('macos','0.3.23'));
  time+=60001;await observe('alice@example.test',header('macos','0.3.23'));assert.equal(writes.length,4);
});
test('database failure stays best effort and can retry; output strips unknown nested fields', async()=>{
 let calls=0;const observe=createClientObserver({collection(){return {async updateOne(){if(++calls===1)throw Error('private');}};}});
 const headers={'x-relay-client-platform':'web','x-relay-client-version':'1.2.3'};
 await observe('a@example.test',headers);await observe('a@example.test',headers);assert.equal(calls,2);
 assert.deepEqual(cleanClientVersions({web:{version:'1.2.3',seen_at:123,token:'secret'},ios:{version:'bad',seen_at:123},unknown:{version:'1.2.3',seen_at:123},macos:{version:'1.2.3',seen_at:null}}),{web:{version:'1.2.3',seen_at:123}});
});
test('observer receives only verified successful accounts and never adds email or headers to logs',async()=>{
 for(const [authenticated,status] of [[false,200],[true,401],[true,200]]) {
  const rows=[],observed=[];const response=Object.assign(new EventEmitter(),{statusCode:status,writableFinished:true});
  runRequestLog({method:'GET',url:'/api/devices',headers:{'x-relay-client-platform':'web','x-relay-client-version':'1.2.3',cookie:'private'}},response,()=>{if(authenticated)markAuthenticated('alice@example.test','email_session');},{write:row=>rows.push(row),observeClient:async(email,metadata)=>{assert.equal(metadata.cookie,undefined);observed.push(email);}});
  response.emit('finish');response.emit('close');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(observed.length,authenticated&&status===200?1:0);assert.equal(rows.length,1);
  assert.ok(!JSON.stringify(rows).includes('alice'));assert.ok(!JSON.stringify(rows).includes('private'));assert.equal(rows[0].client_type,'unknown');
 }
});
test('admin version lookup projects only requested accounts and public version fields',async()=>{
 let closed=false;const directory=createMonitoringDirectory({collection(name){assert.equal(name,'auth_users');return {find(filter,options){assert.deepEqual(filter,{_id:{$in:['alice@example.test']}});assert.deepEqual(options.projection,{_id:1,client_versions:1});return {async *[Symbol.asyncIterator](){yield {_id:'alice@example.test',client_versions:{ios:{version:'0.3.22+42',seen_at:123,token:'secret'}}};},async close(){closed=true;}};}};}},{version:'v1',key:Buffer.alloc(32,7)});
 assert.deepEqual(await directory.versions(['alice@example.test']),new Map([['alice@example.test',{ios:{version:'0.3.22+42',seen_at:123}}]]));assert.ok(closed);
});
