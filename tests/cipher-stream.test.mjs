import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test, { after } from 'node:test';
import { build } from 'esbuild';
import WebSocket from 'ws';

const temporary = await mkdtemp(join(tmpdir(), 'relayune-cipher-stream-'));
const outfile = join(temporary, 'cipher-stream.cjs');
await build({entryPoints:['server/cipher-stream.ts'],bundle:true,platform:'node',target:'node22',format:'cjs',outfile,logLevel:'silent'});
const {CipherStreamHub, attachCipherStreamServer, validateCipherStreamFrame} = await import(pathToFileURL(outfile).href);
after(() => rm(temporary,{recursive:true,force:true}));
const KEY = `sha256:${'a'.repeat(43)}`;
const ORIGIN = 'https://relayune.test';
const START = Date.parse('2026-09-23T12:00:00.000Z');
class Socket extends EventEmitter {
  readyState = WebSocket.OPEN;
  bufferedAmount = 0;
  sent = [];
  send(wire, callback) { this.sent.push(JSON.parse(wire)); callback?.(); }
  close(code) { this.code = code; this.readyState = WebSocket.CLOSING; }
  terminate() { this.readyState = WebSocket.CLOSED; this.emit('close'); }
  receive(value) { this.emit('message',Buffer.from(JSON.stringify(value)),false); }
}
function fixture(extra={}) {
  let time=START;
  const options={publicOrigin:ORIGIN,now:()=>time,authenticateSession:async()=>null,authorizeRelay:async()=>{throw Error();},authorizeBrowser:async()=>{throw Error();},...extra};
  const hub=new CipherStreamHub({clients:new Set(),close(){}},options);
  const sockets=[];
  return {hub,now:()=>time,setTime:t=>{time=t;},
    peer(role,browserId='web_a',revalidate=async()=>true,deviceId='dev_a') {
      const socket=new Socket(); sockets.push(socket);
      hub.subscribe(socket,role,{deviceId,...(role==='browser'?{browserId,keyId:KEY}:{})},revalidate);
      return {socket,connectionId:socket.sent.find(f=>f.type==='ready')?.connection_id,browserId};
    },
    close(){hub.close();for(const socket of sockets)socket.terminate();},
  };
}
function frame({kind='command',browserId='web_a',deviceId='dev_a',requestId='req_a',at=START}={}) {
  const aad={created_at:new Date(at).toISOString(),device_id:deviceId,direction:kind==='command'?'web_to_relay':'relay_to_web',
    event_seq:kind==='event'?1:null,expires_at:kind==='command'?new Date(at+60_000).toISOString():null,
    request_id:kind==='catalog'?null:requestId,session_id:kind==='catalog'?null:'session_a',
    type:kind==='command'?'session.read_history':kind==='event'?'session.event':kind==='catalog'?'relay.sync_sessions':kind==='receipt'?'command.ack':'session.history'};
  return {device_id:deviceId,browser_id:browserId,session_id:aad.session_id,request_id:aad.request_id,
    ...(kind==='command'?{command_type:aad.type}:{kind}),...(kind==='event'?{event_id:'evt_a',event_seq:1,created_at:aad.created_at}:{}),
    aad,envelope:{v:2,alg:'A256GCM',kid:KEY,iv:Buffer.alloc(12).toString('base64url'),aad:Buffer.from(JSON.stringify(aad)).toString('base64url'),ciphertext:Buffer.alloc(16).toString('base64url')}};
}
function routed(peer, encrypted) {return {type:'frame',browser_id:peer.browserId,connection_id:peer.connectionId,frame:encrypted};}

test('live commands and events route opaque envelopes with no per-frame authorization or persistence',()=>{
  const f=fixture();let checks=0;
  const relay=f.peer('relay',undefined,async()=>{checks++;return true;});
  const browser=f.peer('browser',undefined,async()=>{checks++;return true;});
  assert.equal(relay.socket.sent.findLast(x=>x.type==='subscriptions').peers[0].connection_id,browser.connectionId);
  for(let i=0;i<250;i++) {
    browser.socket.receive(routed(browser,frame({requestId:`req_${i}`})));
    relay.socket.receive(routed(browser,frame({kind:'event',requestId:`req_${i}`})));
  }
  assert.equal(relay.socket.sent.filter(x=>x.type==='frame').length,250);
  assert.equal(browser.socket.sent.filter(x=>x.type==='frame').length,250);
  assert.equal(checks,0);
  assert.deepEqual(browser.socket.sent.find(x=>x.type==='frame').frame.envelope,frame({kind:'event',requestId:'req_0'}).envelope);
  f.close();
});

test('TCP pongs and ordinary data do not renew a browser application lease',()=>{
  const f=fixture();const relay=f.peer('relay');const browser=f.peer('browser');
  f.setTime(START+20_000);relay.socket.receive({type:'renew'});browser.socket.emit('pong');
  browser.socket.receive(routed(browser,frame()));
  f.setTime(START+30_000);f.hub.tick();
  assert.equal(browser.socket.code,4408);
  assert.deepEqual(relay.socket.sent.findLast(x=>x.type==='subscriptions').peers,[]);
  assert.equal(relay.socket.readyState,WebSocket.OPEN);
  f.close();
});

test('late close and stale routing generation cannot remove or deliver to a replacement connection',()=>{
  const f=fixture();const relay=f.peer('relay');const old=f.peer('browser');const fresh=f.peer('browser');
  assert.notEqual(old.connectionId,fresh.connectionId);old.socket.terminate();
  relay.socket.receive(routed(old,frame({kind:'event'})));
  assert.equal(fresh.socket.sent.filter(x=>x.type==='frame').length,0);
  relay.socket.receive(routed(fresh,frame({kind:'event'})));
  assert.equal(fresh.socket.sent.filter(x=>x.type==='frame').length,1);
  assert.deepEqual(f.hub.activeBrowserIds('dev_a'),['web_a']);
  f.close();
});

test('authorization is single-flight and a stalled check expires at 45 seconds despite lease renewals',async()=>{
  const f=fixture();let checks=0,resolve;
  const browser=f.peer('browser',undefined,()=>{checks++;return new Promise(r=>{resolve=r;});});
  f.setTime(START+20_000);browser.socket.receive({type:'renew'});
  f.setTime(START+30_000);f.hub.tick();f.hub.tick();
  assert.equal(checks,1);
  f.setTime(START+40_000);browser.socket.receive({type:'renew'});f.hub.tick();assert.equal(checks,1);
  f.setTime(START+45_000);f.hub.tick();assert.equal(browser.socket.code,4408);
  resolve(true);await nextTurn();assert.deepEqual(f.hub.activeBrowserIds('dev_a'),[]);
  f.close();
});

test('revocation and cross-client routing fail closed',()=>{
  const f=fixture();const relay=f.peer('relay');const a=f.peer('browser');const b=f.peer('browser','web_b');
  a.socket.receive(routed(b,frame({browserId:'web_b'})));
  assert.equal(a.socket.code,4400);assert.equal(relay.socket.sent.filter(x=>x.type==='frame').length,0);
  f.hub.revokeBrowser('dev_a','web_b');assert.equal(b.socket.code,4401);
  assert.deepEqual(relay.socket.sent.findLast(x=>x.type==='subscriptions').peers,[]);
  f.hub.revokeDevice('dev_a');assert.equal(relay.socket.code,4401);f.close();
});

test('authentication key, signed routing and strict event/response windows are checked before forwarding',()=>{
  const auth={deviceId:'dev_a',browserId:'web_a',keyId:KEY};
  assert.throws(()=>validateCipherStreamFrame(frame(), 'browser',{...auth,keyId:`sha256:${'b'.repeat(43)}`},START));
  const changed=frame();changed.aad.device_id='dev_b';assert.throws(()=>validateCipherStreamFrame(changed,'browser',auth,START));
  assert.throws(()=>validateCipherStreamFrame(frame({kind:'event',at:START-600_000}),'relay',auth,START));
  assert.throws(()=>validateCipherStreamFrame(frame({kind:'response',at:START-300_000}),'relay',auth,START));
  const plain=frame();plain.plaintext='must not be forwarded';
  assert.throws(()=>validateCipherStreamFrame(plain,'browser',auth,START));
  assert.equal(validateCipherStreamFrame(frame({kind:'catalog'}),'relay',auth,START).kind,'catalog');
});

test('server bounds aggregate socket buffering and drops a slow target without retaining payload queues',()=>{
  const f=fixture({maxBufferedBytes:8192,maxGlobalBufferedBytes:4096});const relay=f.peer('relay');const browser=f.peer('browser');
  browser.socket.bufferedAmount=4000;
  relay.socket.receive(routed(browser,frame({kind:'event'})));
  assert.equal(browser.socket.code,1013);
  assert.equal(browser.socket.sent.filter(x=>x.type==='frame').length,0);
  assert.deepEqual(f.hub.activeBrowserIds('dev_a'),[]);f.close();
});

test('stream arrival suppresses parallel legacy delivery before first subscription snapshot',()=>{
  let suppressed=false;
  const f=fixture({activeBrowsers:()=>suppressed?[]:['web_a','web_legacy'],onBrowserStream:()=>{suppressed=true;}});
  const relay=f.peer('relay');
  assert.equal(relay.socket.sent.findLast(x=>x.type==='subscriptions').peers.length,2);
  const browser=f.peer('browser');
  assert.equal(relay.socket.sent.findLast(x=>x.type==='subscriptions').peers.length,1);
  browser.socket.terminate();
  assert.deepEqual(relay.socket.sent.findLast(x=>x.type==='subscriptions').peers,[]);f.close();
});

test('100 simultaneous users streaming 100 events each need no authorization query per event',()=>{
  const f=fixture();let authChecks=0;
  for(let i=0;i<100;i++) {
    const relay=f.peer('relay',undefined,async()=>{authChecks++;return true;},`dev_${i}`);
    const browser=f.peer('browser',`web_${i}`,async()=>{authChecks++;return true;},`dev_${i}`);
    for(let n=0;n<100;n++) relay.socket.receive(routed(browser,frame({kind:'event',deviceId:`dev_${i}`,browserId:`web_${i}`,requestId:`req_${n}`})));
    assert.equal(browser.socket.sent.filter(x=>x.type==='frame').length,100);
  }
  assert.equal(authChecks,0);f.close();
});

test('real websocket hello requires browser session and origin, while relay uses its own token',async()=>{
  const server=createServer((_req,res)=>res.end('ok'));let browserChecks=0;
  const hub=attachCipherStreamServer(server,{publicOrigin:ORIGIN,
    authenticateSession:async request=>request.headers.cookie==='session=valid'?'owner':null,
    authorizeBrowser:async(_request,email,payload)=>{browserChecks++;if(email!=='owner'||payload.browserToken!=='browser')throw Error();return{deviceId:payload.deviceId,browserId:'web_a',keyId:KEY};},
    authorizeRelay:async(_request,payload)=>{if(payload.relayToken!=='relay')throw Error();return{deviceId:payload.deviceId};},
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`ws://127.0.0.1:${server.address().port}/api/stream`;const sockets=[];
  const connect=async(options={})=>{const ws=new WebSocket(url,options);sockets.push(ws);await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});return ws;};
  const hello=async(ws,payload)=>{const ready=new Promise(resolve=>ws.once('message',raw=>resolve(JSON.parse(raw.toString()))));ws.send(JSON.stringify(payload));return ready;};
  try {
    const relay=await connect();assert.equal((await hello(relay,{type:'hello',role:'relay',device_id:'dev_a',relay_token:'relay'})).type,'ready');
    const browser=await connect({origin:ORIGIN,headers:{Cookie:'session=valid'}});
    const ready=await hello(browser,{type:'hello',role:'browser',device_id:'dev_a',browser_token:'browser'});
    assert.equal(ready.browser_id,'web_a');assert.equal(browserChecks,1);
    const unauth=await connect({origin:ORIGIN});const closed=new Promise(resolve=>unauth.once('close',resolve));
    unauth.send(JSON.stringify({type:'hello',role:'browser',device_id:'dev_a',browser_token:'browser'}));
    assert.equal(await closed,4401);assert.equal(browserChecks,1);
    const bad=new WebSocket(url,{origin:'https://evil.example'});sockets.push(bad);
    assert.match((await new Promise(resolve=>bad.once('error',resolve))).message,/403/);
  } finally {for(const socket of sockets)socket.terminate();hub.close();await new Promise(resolve=>server.close(resolve));}
});
