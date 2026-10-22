import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const directory = await mkdtemp(join(tmpdir(), 'online-stream-client-'));
await build({entryPoints:['app/online-stream.ts'],bundle:true,platform:'node',format:'esm',outfile:join(directory,'stream.mjs'),logLevel:'silent'});
const {OnlineStream, ONLINE_READ_TYPES, readOnlineOrHttp} = await import(pathToFileURL(join(directory,'stream.mjs')));
await build({entryPoints:['app/history-reconciliation.ts'],bundle:true,platform:'node',format:'esm',outfile:join(directory,'history.mjs'),logLevel:'silent'});
const {mergeLatestHistory}=await import(pathToFileURL(join(directory,'history.mjs')));
test.after(() => rm(directory,{recursive:true,force:true}));
class Socket extends EventTarget {
  readyState = 1; bufferedAmount = 0; sent = [];
  send(value) { this.sent.push(JSON.parse(value)); }
  close(code=1000) { this.readyState = 3; const event=new Event('close'); event.code=code; this.dispatchEvent(event); }
  receive(value) { const event = new Event('message'); event.data = JSON.stringify(value); this.dispatchEvent(event); }
}
function fixture() {
  const socket = new Socket(); let time=0; const frames=[];
  const stream = new OnlineStream({origin:'https://relay.test',deviceId:'d',browserToken:'secret',browserId:'b',socketFactory:()=>socket,now:()=>time,onFrame:async f=>{frames.push(f)},onOnline:()=>{},onClosed:()=>{}});
  stream.connect(); socket.dispatchEvent(new Event('open'));
  socket.receive({type:'ready',connection_id:'c',browser_id:'b'}); socket.receive({type:'relay',state:'online'});
  return {stream,socket,frames,setTime:value=>time=value};
}
test('stream business renewal expires despite a socket that remains open',()=>{
 const f=fixture(); f.setTime(31_000); f.stream.renew();
 assert.equal(f.stream.available,false); assert.equal(f.socket.sent.some(x=>x.type==='renew'),false);
});
test('stream accepts only the current authenticated connection wrapper and bounds sends',async()=>{
 const f=fixture(); const pending=f.stream.request({request_id:'r',aad:{},envelope:{ciphertext:'sealed'}});
 const reply={type:'frame',connection_id:'old',browser_id:'b',frame:{kind:'response',request_id:'r',envelope:{ciphertext:'reply'}}};
 f.socket.receive(reply); let completed=false; pending.then(()=>completed=true); await Promise.resolve(); assert.equal(completed,false);
 f.socket.receive({...reply,connection_id:'c',browser_id:'another'}); await Promise.resolve(); assert.equal(completed,false);
 f.socket.receive({...reply,connection_id:'c'}); assert.equal((await pending).envelope.ciphertext,'reply');
 assert.equal(f.socket.sent[1].frame.kind,'command');
 assert.throws(()=>f.stream.send({ciphertext:'x'.repeat(1048576)}),/backpressure/);
 f.socket.bufferedAmount=262145; assert.throws(()=>f.stream.send({request_id:'r2'}),/backpressure/);
 f.stream.close();
});
test('missing desktop rejects bounded requests; user mutations remain durable HTTP',async()=>{
 const f=fixture(); const pending=f.stream.request({request_id:'r'});
 f.socket.receive({type:'unavailable',connection_id:'c',request_id:'r'}); await assert.rejects(pending,/unavailable/);
 f.socket.receive({type:'relay',state:'offline'}); await assert.rejects(f.stream.request({request_id:'r2'}),/unavailable/);
 for(const type of ['session.submit_message','approval.resolve','session.create']) assert.equal(ONLINE_READ_TYPES.has(type),false);
 f.stream.close();
});
test('stream never admits more than eight awaiting reads and closes every pending request',async()=>{
 const f=fixture(); const requests=Array.from({length:8},(_,i)=>f.stream.request({request_id:`r${i}`}));
 await assert.rejects(f.stream.request({request_id:'excess'}),/busy/); f.stream.close();
 for(const request of requests) await assert.rejects(request,/closed/);
});
test('aborting one read releases its waiter without closing other stream requests',async()=>{
 const f=fixture(); const cancellation=new AbortController();
 const cancelled=f.stream.request({request_id:'cancelled'},8000,cancellation.signal);
 const others=Array.from({length:7},(_,i)=>f.stream.request({request_id:`other${i}`}));
 await assert.rejects(f.stream.request({request_id:'full'}),/busy/);
 cancellation.abort(); await assert.rejects(cancelled,/request_cancelled/);
 assert.equal(f.stream.available,true);
 const replacement=f.stream.request({request_id:'replacement'});
 f.socket.receive({type:'frame',connection_id:'c',browser_id:'b',frame:{kind:'response',request_id:'replacement'}});
 assert.equal((await replacement).request_id,'replacement');
 f.stream.close(); for(const request of others)await assert.rejects(request,/closed/);
});
test('an already cancelled request is never sent and completed requests ignore later abort',async()=>{
 const f=fixture(); const cancelled=new AbortController(); cancelled.abort();
 const before=f.socket.sent.length;
 await assert.rejects(f.stream.request({request_id:'cancelled'},8000,cancelled.signal),/request_cancelled/);
 assert.equal(f.socket.sent.length,before);
 const completed=new AbortController(); const first=f.stream.request({request_id:'reused'},8000,completed.signal);
 f.socket.receive({type:'frame',connection_id:'c',browser_id:'b',frame:{kind:'response',request_id:'reused'}});
 await first;
 const second=f.stream.request({request_id:'reused'});
 completed.abort();
 f.socket.receive({type:'frame',connection_id:'c',browser_id:'b',frame:{kind:'response',request_id:'reused'}});
 assert.equal((await second).request_id,'reused'); f.stream.close();
});
test('reads never wait for an original HTTP result when stream backpressure prevented sending',async()=>{
 const f=fixture(); f.socket.bufferedAmount=262145; let httpReads=0;
 const before=f.socket.sent.length; const started=performance.now();
 await assert.rejects(readOnlineOrHttp({
   online:signal=>f.stream.request({request_id:'unsent'},8000,signal),
   http:async()=>{httpReads++;throw new Error('must_not_read');},
   assertActive:()=>{},isPending:()=>false,isFatal:()=>false,
 }),/All promises were rejected/);
 assert.ok(performance.now()-started<500);
 assert.equal(httpReads,0); assert.equal(f.socket.sent.length,before);
 assert.equal(f.stream.available,true); f.stream.close();
});
test('supported web clients disable legacy subscription and bind recovery to the stream',async()=>{
 const source=await readFile('app/workbench-page.tsx','utf8');
 assert.match(source,/onlineStreamSupported \|\|\s*!authenticated/);
 assert.match(source,/payload: \{ \.\.\.payload, connection_id: stream.connectionId \}/);
});

test('replacement close code survives cleanup so callers cannot reconnect-fight',()=>{
 const f=fixture(); f.socket.close(4001); assert.equal(f.stream.closeCode,4001); assert.equal(f.stream.available,false);
});

test('post-resume history closes a baseline gap without erasing newer received deltas',()=>{
 const baseline={id:'reply',role:'assistant',content:'base',createdAt:'2026-09-23T10:00:00Z',source:'history'};
 const afterGap={...baseline,content:'base + gap'};
 assert.deepEqual(mergeLatestHistory([afterGap],[baseline]).map(x=>x.content),['base + gap']);
 const live={...afterGap,source:'live',content:'base + gap + live'};
 assert.deepEqual(mergeLatestHistory([afterGap],[live]).map(x=>x.content),['base + gap + live']);
 const persisted={...baseline,content:'base + gap + live + complete'};
 assert.deepEqual(mergeLatestHistory([persisted],[live]).map(x=>x.content),['base + gap + live + complete']);
});
