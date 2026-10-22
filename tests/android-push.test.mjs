import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { shouldNotifyPhone } from '../relay/push-hint.mjs';
const directory = await mkdtemp(join(tmpdir(), 'relayune-push-test-'));
const bundle = join(directory, 'push.mjs');
await build({entryPoints:['server/android-push.ts'], bundle:true, platform:'node', format:'esm', outfile:bundle});
const { AndroidPush, encryptRegistration, decryptRegistration, jpushPayload, readPushConfig } = await import(pathToFileURL(bundle));
test.after(() => rm(directory, {recursive:true, force:true}));
const config = { appKey:'a'.repeat(24), masterSecret:'test-only-secret', storageKey: Buffer.alloc(32, 7).toString('base64') };

test('[MOB-NOT-018][server] push payload contains only a generic alert and opaque receipt', () => {
 const payload = jpushPayload('rid_fixture', 'opaque_receipt', 'zh-CN', config);
 assert.deepEqual(payload.audience, {registration_id:['rid_fixture']});
 assert.equal(payload.notification.android.alert, '有新的任务动态，轻点查看。');
 assert.deepEqual(payload.notification.android.extras, {relayune_receipt:'opaque_receipt'});
 assert.doesNotMatch(JSON.stringify(payload), /test-only-secret|session|approval|command|storageKey/);
 assert.equal(payload.options.time_to_live, 120);
 assert.equal(payload.options.third_party_channel.vivo.push_mode, 0);
 assert.equal(jpushPayload('rid','x','en',{...config,vivoTest:true}).options.third_party_channel.vivo.push_mode, 1);
});
test('registration storage uses authenticated randomized encryption', () => {
 const one = encryptRegistration('rid-private', config.storageKey);
 const two = encryptRegistration('rid-private', config.storageKey);
 assert.notEqual(one, two);
 assert.equal(decryptRegistration(one, config.storageKey), 'rid-private');
 const corrupt = Buffer.from(one,'base64'); corrupt[30] ^= 1;
 assert.throws(() => decryptRegistration(corrupt.toString('base64'), config.storageKey));
 assert.throws(() => decryptRegistration(one, Buffer.alloc(32,8).toString('base64')));
});
test('malformed configuration never echoes secret JSON', async () => {
 const file=join(directory,'config.json');
 await writeFile(file, '{"masterSecret":"DO_NOT_ECHO', {mode:0o600});
 assert.throws(() => readPushConfig(file), {message:'Invalid push configuration.'});
});
test('only actionable attention and root task completion request a phone alert', () => {
 const sessions=[{id:'root'},{id:'child',is_subagent:true},{id:'child2',parent_session_id:'root'}];
 assert.equal(shouldNotifyPhone('root',{kind:'turn.completed'},sessions),true);
 assert.equal(shouldNotifyPhone('root',{kind:'turn.completed',status:'interrupted'},sessions),false);
 assert.equal(shouldNotifyPhone('child',{kind:'turn.completed'},sessions),false);
 assert.equal(shouldNotifyPhone('child2',{kind:'turn.failed'},sessions),false);
 assert.equal(shouldNotifyPhone('unknown',{kind:'turn.completed'},sessions),false);
 assert.equal(shouldNotifyPhone('child',{kind:'approval.requested'},sessions),true);
 assert.equal(shouldNotifyPhone('root',{kind:'message.delta'},sessions),false);
});
function database() {
 const rows=new Map();
 const match=(row,filter) => Object.entries(filter).every(([k,v]) => {
   if (v && typeof v==='object' && !(v instanceof Date)) return Object.entries(v).every(([op,x]) => op==='$gt'?row[k]>x:op==='$lte'?row[k]<=x:op==='$lt'?row[k]<x:op==='$ne'?row[k]!==x:false);
   return row[k]===v || v===null && row[k]==null;
 });
 return { rows, collection(name) {
   if(!rows.has(name)) rows.set(name,[]);
   const list=rows.get(name);
   const apply=(row,u) => { Object.assign(row,u.$set); for(const [k,v] of Object.entries(u.$inc||{})) row[k]=(row[k]||0)+v; };
   return {
    async findOne(f){ return list.find(r=>match(r,f)) || null; },
    async updateOne(f,u,o={}) { let r=list.find(r=>match(r,f)); if(!r&&o.upsert){r={...f,...u.$setOnInsert};list.push(r);} if(r) apply(r,u); },
    async deleteOne(f){ const i=list.findIndex(r=>match(r,f));if(i>=0)list.splice(i,1); },
    async deleteMany(f){ for(let i=list.length-1;i>=0;i--)if(match(list[i],f))list.splice(i,1); },
    async findOneAndUpdate(f,u){ const r=list.find(r=>match(r,f));if(r)apply(r,u);return r?{...r}:null; },
   };
 }};
}
async function fixture(send=async()=>new Response('{}')) {
 const db=database(); const push=new AndroidPush(db, config, send);
 db.collection('relay_browser_authorizations'); db.rows.get('relay_browser_authorizations').push({id:'browser',device_id:'device',user_id:'user',revoked_at:null});
 db.collection('relay_devices'); db.rows.get('relay_devices').push({id:'device',revoked_at:null});
 await push.register('browser','device','rid_fixture','zh');
 return {db,push};
}
test('duplicate events create one delivery job; stale events are dropped', async()=>{
 let sent=0;const {db,push}=await fixture(async()=>{sent++;return new Response('{}');});
 await push.enqueue('browser','device','event',Date.now());
 await push.enqueue('browser','device','event',Date.now());
 await push.enqueue('browser','device','old',Date.now()-121000);
 assert.equal(db.rows.get('relay_push_jobs').length,1);
 await push.drain();await push.drain();assert.equal(sent,1);
});
test('revocation, rotation and opt-out invalidate queued jobs', async()=>{
 for(const action of ['revoke','rotate','optout']) {
 let sent=0;const {db,push}=await fixture(async()=>{sent++;return new Response('{}');});
 await push.enqueue('browser','device','event',Date.now());
 if(action==='revoke') db.rows.get('relay_browser_authorizations')[0].revoked_at=Date.now();
 if(action==='rotate') await push.register('browser','device','rid_rotated','zh');
 if(action==='optout') await push.register('browser','device',null,'zh');
 await push.drain();assert.equal(sent,0,action);
 }
});
test('transient provider failure is retried without duplicate successful delivery', async()=>{
 let sent=0;const {db,push}=await fixture(async()=>new Response('{}',{status:++sent===1?503:200}));
 await push.enqueue('browser','device','event',Date.now());await push.drain();
 const job=db.rows.get('relay_push_jobs')[0];assert.equal(job.done,false);
 job.nextAttemptAt=new Date(0);await push.drain();await push.drain();assert.equal(sent,2);assert.equal(job.done,true);
});

test('Android manifest declares the SDK-required service and exact receiver action', async () => {
 const {readFile}=await import('node:fs/promises');
 const manifest=await readFile('mobile/android/app/src/main/AndroidManifest.xml','utf8');
 assert.match(manifest, /<service android:name="\.RelayPushService"[^>]*android:exported="false"[^>]*>/);
 assert.match(manifest, /cn\.jiguang\.user\.service\.action/);
 assert.match(manifest, /cn\.jpush\.android\.intent\.RECEIVER_MESSAGE/);
 assert.doesNotMatch(manifest, /cn\.jpush\.android\.intent\.RECEIVE_MESSAGE/);
 assert.match(manifest, /android:name="cn\.jpush\.android\.service\.InitProvider"[^>]*tools:node="remove"/);
});


test('one phone retains multiple computers of the same account and removes only the opted-out binding', async () => {
 const {db,push}=await fixture();
 db.rows.get('relay_browser_authorizations').push({id:'second', device_id:'other', user_id:'user', revoked_at:null});
 db.rows.get('relay_devices').push({id:'other',revoked_at:null});
 await push.register('second','other','rid_fixture','en');
 assert.equal(db.rows.get('relay_push_bindings').length,2);
 await push.enqueue('browser','device','one',Date.now());
 await push.enqueue('second','other','two',Date.now());
 assert.equal(db.rows.get('relay_push_jobs').length,2);
 await push.register('second','other',null,'en');
 assert.deepEqual(db.rows.get('relay_push_bindings').map(b=>b._id),['browser']);
});
test('account switch removes previous-account bindings and prevents queued delivery', async () => {
 let sent=0; const {db,push}=await fixture(async()=>{sent++;return new Response('{}');});
 await push.enqueue('browser','device','old-account-event',Date.now());
 db.rows.get('relay_browser_authorizations').push({id:'new-account',device_id:'new-device',user_id:'different',revoked_at:null});
 await push.register('new-account','new-device','rid_fixture','en');
 assert.deepEqual(db.rows.get('relay_push_bindings').map(b=>b._id),['new-account']);
 await push.drain(); assert.equal(sent,0);
});
test('concurrent same-phone registrations leave only one account owning all retained bindings', async () => {
 const {db,push}=await fixture();
 db.rows.get('relay_browser_authorizations').push({id:'b',device_id:'b-device',user_id:'different',revoked_at:null});
 await Promise.all([push.register('browser','device','rid_fixture','en'),push.register('b','b-device','rid_fixture','en')]);
 assert.deepEqual(db.rows.get('relay_push_bindings').map(b=>b.userId),['different']);
});


test('startup replaces only the obsolete unique phone-token index and is repeatable', async () => {
 const indexes = [{name:'_id_', key:{_id:1}, unique:true},
   {name:'registrationHash_1', key:{registrationHash:1}, unique:true}];
 const calls = [];
 const db = {collection(name) {return {
   async createIndex(key, options={}) {
     if(name !== 'relay_push_bindings') return;
     const indexName=Object.entries(key).map(([k,v])=>`${k}_${v}`).join('_');
     if(!indexes.some(i=>i.name===indexName)) indexes.push({name:indexName,key,...options});
   },
   listIndexes() {return {async toArray(){return [...indexes];}};},
   async dropIndex(indexName) {calls.push(indexName);indexes.splice(indexes.findIndex(i=>i.name===indexName),1);},
 };}};
 for (let attempt=0;attempt<2;attempt++) {
   const push=new AndroidPush(db,config); await push.initialize(); push.close();
 }
 assert.deepEqual(calls,['registrationHash_1']);
 assert.equal(indexes.find(i=>i.name==='_id_').unique,true);
 assert.equal(indexes.find(i=>i.name==='registrationHash_1').unique,undefined);
});

test('concurrent opt-out wins over the preceding registration', async () => {
 const {db,push}=await fixture();
 await Promise.all([push.register('browser','device','rid_fixture','en'),push.register('browser','device',null,'en')]);
 assert.equal(db.rows.get('relay_push_bindings').length,0);
});
