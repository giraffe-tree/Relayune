import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,rm } from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RelayOutbox} from '../relay/outbox.mjs';
import {MacRelay} from '../relay/mac-relay.mjs';
const fixtureCreatedAt = new Date().toISOString();
const variants=seq=>Array.from({length:13},(_,i)=>({kind:'event', created_at: fixtureCreatedAt,aad:{created_at:fixtureCreatedAt},event_seq:seq,event_id:`e${seq}-${i}`,browser_id:`b${i}`,session_id:'s'}));

test('one recently active recipient receives successive events before offline copies',()=>{
 const relay=new MacRelay({serverUrl:'https://example.test',deviceId:'d',deviceToken:'test',adapter:{},statePath:null});
 relay.browserActivity=new Map([['b12',Date.now()]]);
 relay.enqueueRemoteMessages(Array.from({length:8},(_,i)=>variants(i+1)).flat(),{live:true});
 const batch=relay.takeUploadBatch(50);
 assert.deepEqual(batch.filter(e=>e.message.browser_id==='b12').map(e=>e.message.event_seq),[1,2,3,4,5,6,7,8]);
 assert.equal(batch.length+relay.uploadQueue.length,104);
});

test('partial receipts survive restart and larger unordered global ACKs',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'relay-recipient-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const outbox=new RelayOutbox(join(dir,'outbox.json'));
 await outbox.append({type:'opaque.event.bundle',variants:variants(1)});
 await outbox.acknowledgeVariants(5,[variants(1)[12]]);
 await outbox.acknowledge(99);
 const restored=new RelayOutbox(outbox.path);await restored.load();
 assert.equal(restored.after(99)[0].variants.length,12);
 assert.ok(restored.after(99)[0].variants.every(v=>v.browser_id!=='b12'));
 await restored.acknowledgeVariants(0,variants(1).slice(0,12));
 assert.equal(restored.after(0).length,0);
});

test('restored recipient activity promotes pending copies without changing authorization',()=>{
 const relay=new MacRelay({serverUrl:'https://example.test',deviceId:'d',deviceToken:'test',adapter:{},statePath:null});
 relay.browserKeys.set('b12',{keyId:'key12'});
 relay.syncBrowserAuthorizations([{id:'b12',key_id:'key12',last_seen_at:Date.now()-120000}]);
 relay.enqueueRemoteMessages(Array.from({length:8},(_,i)=>variants(i+1)).flat(),{live:true});
 relay.syncBrowserAuthorizations([{id:'b12',key_id:'key12',last_seen_at:Date.now()}]);
 assert.equal(relay.activeBrowserKeys.size,1);
 assert.equal(relay.takeUploadBatch(50).filter(e=>e.message.browser_id==='b12').length,8);
});

test('global ACK without local recipient receipts never retires pending copies',async()=>{
 const outbox=new RelayOutbox();
 await outbox.append({type:'opaque.event.bundle',variants:variants(1)});
 await outbox.acknowledge(100);
 assert.equal(outbox.after(100)[0].variants.length,13);
 await outbox.acknowledgeVariants(0,[variants(1)[0]]);
 await outbox.acknowledgeVariants(0,[variants(1)[0]]);
 assert.equal(outbox.after(100)[0].variants.length,12);
});

test('recent recipient priority favors interactive sessions over its old background stream',()=>{
 const relay=new MacRelay({serverUrl:'https://example.test',deviceId:'d',deviceToken:'test',adapter:{},statePath:null});
 relay.browserActivity.set('b12',Date.now());
 relay.interactiveSessions.set('current',Date.now()+60000);
 const background=Array.from({length:1000},(_,i)=>variants(i+1).map(v=>({...v,session_id:'background'}))).flat();
 const current=Array.from({length:8},(_,i)=>variants(i+1001).map(v=>({...v,session_id:'current'}))).flat();
 relay.enqueueRemoteMessages([...background,...current],{live:true});
 const batch=relay.takeUploadBatch(50).map(e=>e.message);
 assert.deepEqual(batch.filter(e=>e.browser_id==='b12'&&e.session_id==='current').map(e=>e.event_seq),[1001,1002,1003,1004,1005,1006,1007,1008]);
 assert.ok(batch.some(e=>e.session_id==='background'));
});

test('only explicit revocation removes pending copies durably; inactive authorized copies remain',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'relay-revoked-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const outbox=new RelayOutbox(join(dir,'outbox.json'));
 await outbox.append({type:'opaque.event.bundle',variants:variants(1)});
 await outbox.retainAuthorizedRecipients(Array.from({length:12},(_,i)=>({id:`b${i}`,last_seen_at:0})));
 const restored=new RelayOutbox(outbox.path);await restored.load();
 assert.equal(restored.after(0)[0].variants.length,12);
 assert.ok(restored.after(0)[0].variants.every(v=>v.browser_id!=='b12'));
});

test('two interactive sessions share recent-recipient slots while retaining each sequence order',()=>{
 const relay=new MacRelay({serverUrl:'https://example.test',deviceId:'d',deviceToken:'test',adapter:{},statePath:null});
 relay.browserActivity.set('b12',Date.now());
 relay.interactiveSessions.set('a',Date.now()+60000);relay.interactiveSessions.set('b',Date.now()+60000);
 for(const session of ['a','b']) relay.enqueueRemoteMessages(Array.from({length:30},(_,i)=>variants(i+1+(session==='b'?100:0)).map(v=>({...v,event_id:`${session}-${v.event_id}`,session_id:session}))).flat(),{live:true});
 const recent=relay.takeUploadBatch(50).map(e=>e.message).filter(e=>e.browser_id==='b12');
 for(const session of ['a','b']) {
  const seq=recent.filter(e=>e.session_id===session).map(e=>e.event_seq);
  assert.ok(seq.length>=12);assert.deepEqual(seq,[...seq].sort((a,b)=>a-b));
 }
});

test('changing oversized catalogs cannot repeatedly poison healthy live uploads', async () => {
 const relay=new MacRelay({serverUrl:'https://example.test',adapter:{},statePath:null});
 const delivered=[];let rejected=0;
 relay.remoteFetch=async (_,options)=>{
  const messages=JSON.parse(options.body).messages;
  if(messages.some(m=>Buffer.byteLength(JSON.stringify(m.envelope??{}))>512000)) {
   rejected++;return Response.json({error:{code:'envelope_too_large'}},{status:413});
  }
  delivered.push(...messages);return Response.json({ack_seq:0});
 };
 for(let i=1;i<=8;i++) {
  relay.enqueueRemoteMessages([
   {kind:'catalog',browser_id:'b',envelope:{ciphertext:'x'.repeat(512000),iv:String(i)}},
   {kind:'event', created_at: fixtureCreatedAt,event_seq:i,event_id:`e${i}`,browser_id:'b',session_id:'s',envelope:{ciphertext:'ok'}},
  ],{live:true});
  while(relay.uploadQueue.length)await relay.flushRemoteUploads();
 }
 assert.equal(rejected,0,'known route limit must be checked before mixing an oversized record with live events');
 assert.deepEqual(delivered.map(m=>m.event_seq),[1,2,3,4,5,6,7,8]);
 assert.equal(relay.uploadBatchLimit,50);
});

test('oversized event remains durable without suppressing healthy recipient copies or large responses',async()=>{
 const relay=new MacRelay({serverUrl:'https://example.test',adapter:{},statePath:null});
 const tooLarge={kind:'event', created_at: fixtureCreatedAt,event_seq:1,event_id:'bad',browser_id:'a',session_id:'s',envelope:{ciphertext:'x'.repeat(512000)}};
 const healthy={...tooLarge,event_id:'good',browser_id:'b',envelope:{ciphertext:'small'}};
 await relay.outbox.append({type:'opaque.event.bundle',variants:[tooLarge,healthy]});
 relay.enqueueRemoteMessages([tooLarge,healthy,{kind:'response', created_at: fixtureCreatedAt,browser_id:'b',request_id:'r',envelope:{ciphertext:'x'.repeat(600000)}}]);
 const batch=relay.takeUploadBatch(50).map(e=>e.message);
 assert.equal(batch.length,2);
 assert.ok(batch.some(m=>m.kind==='response'));
 await relay.outbox.acknowledgeVariants(1,batch.filter(m=>m.kind==='event'));
 assert.deepEqual(relay.outbox.after(1)[0].variants,[tooLarge]);
});

test('one conflicting recipient never causes healthy copies of that sequence to be discarded',async()=>{
 const relay=new MacRelay({serverUrl:'https://example.test',adapter:{},statePath:null});
 const copies=variants(1); const delivered=[];
 relay.remoteFetch=async(_,options)=>{const messages=JSON.parse(options.body).messages;
  if(messages.some(m=>m.browser_id==='b0'))return Response.json({error:{code:'event_seq_conflict'}},{status:409});
  delivered.push(...messages);return Response.json({ack_seq:0});
 };
 relay.enqueueRemoteMessages(copies,{live:true});
 for(let i=0;i<100&&(relay.uploadQueue.length||relay.uploadIsolationBatches?.length);i++)await relay.flushRemoteUploads();
 assert.deepEqual(delivered.map(m=>m.browser_id).sort(),copies.slice(1).map(m=>m.browser_id).sort());
 assert.equal(relay.rejectedUploadKeys.size,1);
});

test('authorization revocation also removes copies waiting in rejection isolation',()=>{
 const relay=new MacRelay({serverUrl:'https://example.test',adapter:{},statePath:null});
 const entry=id=>({key:`event:${id}:1`,message:{kind:'event', created_at: fixtureCreatedAt,event_seq:1,browser_id:id}});
 relay.uploadIsolationBatches=[[entry('revoked'),entry('valid')],[entry('revoked')]];
 relay.uploadKeys=new Set(['event:revoked:1','event:valid:1']);
 relay.syncBrowserAuthorizations([{id:'valid',key_id:'unavailable'}]);
 assert.deepEqual(relay.uploadIsolationBatches.map(b=>b.map(e=>e.message.browser_id)),[['valid']]);
 assert.equal(relay.uploadKeys.has('event:revoked:1'),false);
});

test('quarantined history yields to independent live output without overtaking its own stream',async()=>{
 const relay=new MacRelay({serverUrl:'https://example.test',deviceId:'d',deviceToken:'test',adapter:{},statePath:null});
 const old={...variants(1)[0],session_id:'old'};
 relay.enqueueRemoteMessages([old]);
 relay.uploadIsolationBatches.push(relay.takeUploadBatch(50));
 relay.enqueueRemoteMessages([{...variants(2)[0],session_id:'old'},{...variants(3)[0],session_id:'current'}],{live:true});
 const pushes=[];relay.ready=true;
 relay.remoteFetch=async (url,options)=>{const messages=JSON.parse(options.body).messages;pushes.push(messages);return {ok:true,json:async()=>({ack_seq:0})};};
 await relay.flushRemoteUploads();
 while(relay.uploading) await new Promise(r=>setTimeout(r,1));
 assert.equal(pushes[0][0].session_id,'current');
 assert.deepEqual(pushes.flat().filter(m=>m.session_id==='old').map(m=>m.event_seq),[1,2]);
});

test('permanent sequence conflicts remain encrypted on disk and do not replay after restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'relay-conflict-'));
 try {
  const path=join(dir,'outbox.json');
  const relay=new MacRelay({serverUrl:'https://example.test',deviceId:'d',adapter:{},statePath:path});
  const record=await relay.outbox.appendWithSequence(seq=>({type:'opaque.event.bundle',event_seq:seq,variants:variants(seq)}));
  const bad=record.variants[0], sibling=record.variants[1];
  relay.remoteFetch=async()=>Response.json({error:{code:'event_seq_conflict'}},{status:409});
  relay.enqueueRemoteMessages([bad]);
  await relay.flushRemoteUploads();
  const restored=new RelayOutbox(path); await restored.load();
  assert.deepEqual(restored.pending.get(1).variants,record.variants,'no ciphertext may be deleted or rewritten');
  assert.equal(restored.isQuarantinedEventVariant(bad),true);
  assert.equal(restored.isQuarantinedEventVariant(sibling),false);
  assert.equal(restored.isQuarantinedEventVariant({...bad,event_id:'different'}),false);
  assert.equal(restored.lastAcked,0,'conflict must not fabricate an ACK');
  const next=new MacRelay({adapter:{},statePath:null});next.outbox=restored;
  next.activeBrowserKeys.set(bad.browser_id,{});next.activeBrowserKeys.set(sibling.browser_id,{});
  assert.deepEqual(await next.encodeRemoteMessage(restored.pending.get(1)),[sibling]);
  next.enqueueRemoteMessages([bad,sibling]);
  assert.deepEqual(next.uploadQueue.map(e=>e.message),[sibling]);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('transient event upload failures remain retryable and are not persisted as conflicts',async()=>{
 const relay=new MacRelay({serverUrl:'https://example.test',adapter:{},statePath:null});
 const record=await relay.outbox.appendWithSequence(seq=>({type:'opaque.event.bundle',event_seq:seq,variants:variants(seq)}));
 const frame=record.variants[0];
 relay.remoteFetch=async()=>Response.json({error:{code:'temporary_failure'}},{status:503});
 relay.scheduleUploadRetry=()=>{};
 relay.enqueueRemoteMessages([frame]);await relay.flushRemoteUploads();
 assert.equal(relay.outbox.isQuarantinedEventVariant(frame),false);
 assert.deepEqual(relay.uploadQueue.map(e=>e.message),[frame]);
});
