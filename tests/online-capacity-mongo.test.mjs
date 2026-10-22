import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createServer as createPortReservation} from 'node:net';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {createHash, randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {build} from 'esbuild';
import {MongoClient} from 'mongodb';
import WebSocket from 'ws';
import {generateE2eeKey, keyIdForKey, sealJson, openJson} from '../relay/e2ee.mjs';

const ORIGIN='https://capacity.relayune.test';
const digest=value=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const peakPerSecond=times=>{
  let left=0,peak=0;
  for(let right=0;right<times.length;right++) {while(times[right]-times[left]>=1000)left++;peak=Math.max(peak,right-left+1);}
  return peak;
};
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]??0;
const awaitUntil=async(condition,timeout=10_000)=>{const deadline=performance.now()+timeout;while(!condition()){if(performance.now()>deadline)throw Error('capacity_condition_timeout');await delay(10);}};

// Optional real dependency: never substitute an in-memory database and report it
// as Mongo capacity. This measures the encrypted router/auth path, not UI/Agent work.
test('100 real online clients: encrypted forwarding, production auth refresh and Mongo command budget',
  {skip:!process.env.RELAY_TEST_MONGOD,timeout:110_000}, async t=>{
  const root=await mkdtemp(join(tmpdir(),'relay-online-capacity-'));const dbpath=join(root,'db');await mkdir(dbpath);
  const reservation=createPortReservation();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const mongoProcess=spawn(process.env.RELAY_TEST_MONGOD,['--dbpath',dbpath,'--bind_ip','127.0.0.1','--port',String(port),'--wiredTigerCacheSizeGB','0.25','--logpath',join(root,'mongo.log')],{stdio:'ignore'});
  let client,server,hub,budget;const sockets=[];const timers=[];
  t.after(async()=>{
    for(const timer of timers)clearInterval(timer);
    for(const socket of sockets)socket.terminate();
    hub?.close();if(server?.listening)await new Promise(resolve=>server.close(resolve));
    budget?.close();await client?.close();
    if(mongoProcess.exitCode===null){const stopped=once(mongoProcess,'exit');mongoProcess.kill('SIGTERM');await stopped;}
    await rm(root,{recursive:true,force:true});
  });
  client=new MongoClient(`mongodb://127.0.0.1:${port}`,{serverSelectionTimeoutMS:200,retryReads:false,retryWrites:false,monitorCommands:true,maxPoolSize:30});
  for(let attempt=0;;attempt++){try{await client.connect();break;}catch(error){if(attempt===50||mongoProcess.exitCode!==null)throw error;await delay(100);}}
  const bundle=join(root,'capacity.cjs');
  await build({stdin:{contents:`export * from './server/mongo-store.ts'; export * from './server/mongo-budget.ts'; export * from './server/cipher-stream.ts'; export {authorizeCipherRelay,authorizeCipherBrowser} from './server/relay-api.ts'; export {EmailAuth} from './server/email-auth.ts';`,resolveDir:process.cwd()},bundle:true,format:'cjs',platform:'node',target:'node22',outfile:bundle,logLevel:'silent'});
  const {MongoStore,initializeRelayMongo,MongoBudget,budgetMongoDatabase,attachCipherStreamServer,authorizeCipherRelay,authorizeCipherBrowser,EmailAuth}=createRequire(import.meta.url)(bundle);
  const raw=client.db('isolated_online_capacity_test');await initializeRelayMongo(raw);
  const rawAuth=new EmailAuth(raw,{publicOrigin:ORIGIN,mailFrom:'test@example.invalid'});await rawAuth.initialize();
  const users=await Promise.all(Array.from({length:100},async(_,index)=>{
    const email=`capacity${index}@example.invalid`,key=generateE2eeKey();
    return{index,email,userId:`usr_${digest(email).slice(0,32)}`,deviceId:`dev_${index}`,browserId:`web_${index}`,key,keyId:await keyIdForKey(key),sessionToken:token(),relayToken:token(),browserToken:token()};
  }));
  const now=Date.now(),expiry=new Date(now+60*24*60*60_000);
  await raw.collection('relay_users').insertMany(users.map(u=>({_id:u.userId,id:u.userId,email:u.email,created_at:now,updated_at:now})));
  await raw.collection('auth_users').insertMany(users.map(u=>({_id:u.email})));
  await raw.collection('auth_sessions').insertMany(users.map(u=>({_id:`session_${u.index}`,email:u.email,token_hash:digest(u.sessionToken),expires_at:expiry,revoked_at:null})));
  await raw.collection('relay_devices').insertMany(users.map(u=>({_id:u.deviceId,id:u.deviceId,user_id:u.userId,name:'Capacity Desktop',relay_token_hash:digest(u.relayToken),identity_public_key:'opaque',key_epoch:1,protocol_version:2,ack_seq:0,created_at:now,last_seen_at:now,revoked_at:null})));
  await raw.collection('relay_browser_authorizations').insertMany(users.map(u=>({_id:u.browserId,id:u.browserId,user_id:u.userId,device_id:u.deviceId,name:'Capacity Browser',token_hash:digest(u.browserToken),key_id:u.keyId,created_at:now,last_seen_at:now,revoked_at:null})));
  budget=new MongoBudget();const db=budgetMongoDatabase(raw,budget),store=new MongoStore(db),emailAuth=new EmailAuth(db,{publicOrigin:ORIGIN,mailFrom:'test@example.invalid'});
  const env={DB:store,RELAY_BLOBS:{get:async()=>null,put:async()=>{throw Error('unexpected_blob_write');}}};
  let phase='connect',authRelay=0,authBrowser=0;const commands=[];
  client.on('commandStarted',event=>{budget.observeCommand(event.commandName);if(!['hello','ismaster','isMaster','endSessions'].includes(event.commandName))commands.push({at:performance.now(),phase,name:event.commandName});});
  server=createServer((_request,response)=>response.end('ok'));
  hub=attachCipherStreamServer(server,{publicOrigin:ORIGIN,
    authenticateSession:async request=>{const email=await emailAuth.authenticate(request);return email;},
    authorizeRelay:async(_request,payload)=>{authRelay++;return authorizeCipherRelay(new Request(`${ORIGIN}/api/stream`,{headers:{authorization:`Bearer ${payload.relayToken}`}}),env,payload.deviceId);},
    authorizeBrowser:async(request,email,payload)=>{
      authBrowser++;if(await emailAuth.authenticate(request)!==email)throw Error('session_expired');
      return authorizeCipherBrowser(new Request(`${ORIGIN}/api/stream`,{headers:{'oai-authenticated-user-email':email,'x-relay-browser-token':payload.browserToken}}),env,payload.deviceId);
    },
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`ws://127.0.0.1:${server.address().port}/api/stream`;
  let sentEvents=0,receivedEvents=0,receivedAcks=0,sentReads=0,receivedResponses=0,failed=0;const errors=[];const sentAt=new Map(),latencies=[];
  const operations=new Set();const work=operation=>{operations.add(operation);void operation.catch(error=>{failed++;errors.push(error.message);}).finally(()=>operations.delete(operation));};
  const aadFor=(u,type,requestId,{eventSeq=null,direction='relay_to_web'}={})=>({created_at:new Date().toISOString(),device_id:u.deviceId,direction,event_seq:eventSeq,expires_at:direction==='web_to_relay'?new Date(Date.now()+60_000).toISOString():null,request_id:requestId,session_id:null,type});
  const sendFrame=(socket,u,frame)=>socket.send(JSON.stringify({type:'frame',browser_id:u.browserId,connection_id:u.connectionId,frame}));
  const encryptedCommand=async(u,type,requestId,payload)=>{const aad=aadFor(u,type,requestId,{direction:'web_to_relay'});return{device_id:u.deviceId,session_id:null,request_id:requestId,command_type:type,aad,envelope:await sealJson(u.key,payload,aad)};};
  const connect=async(u,role)=>{
    const socket=new WebSocket(url,role==='browser'?{origin:ORIGIN,headers:{Cookie:`relay_session=${u.sessionToken}`}}:{});sockets.push(socket);
    socket.on('error',error=>{failed++;errors.push(error.message);});
    const ready=new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('hello_deadline')),7000);
      socket.on('message',rawFrame=>{
        let message;try{message=JSON.parse(rawFrame.toString());}catch(error){reject(error);return;}
        if(message.type==='ready'){clearTimeout(timeout);resolve(message);}
        if(message.type==='unavailable'){failed++;errors.push('unexpected_unavailable');}
        if(message.type!=='frame')return;
        work((async()=>{
          const frame=message.frame;const clear=await openJson(u.key,frame.envelope,frame.aad);
          if(role==='browser'&&frame.kind==='event') {
            receivedEvents++;latencies.push(performance.now()-sentAt.get(frame.event_id));sentAt.delete(frame.event_id);
            const ack=await encryptedCommand(u,'transport.event_ack',`ack_${frame.event_id}`,{type:'transport.event_ack',payload:{event_id:frame.event_id,event_seq:frame.event_seq,connection_id:u.connectionId}});
            sendFrame(socket,u,ack);
          } else if(role==='relay'&&frame.command_type==='transport.event_ack') {assert.ok(clear.payload.event_id);receivedAcks++;}
          else if(role==='relay'&&frame.command_type==='session.read_history') {
            const aad=aadFor(u,'session.history',frame.request_id);
            sendFrame(socket,u,{kind:'response',device_id:u.deviceId,browser_id:u.browserId,session_id:null,request_id:frame.request_id,aad,envelope:await sealJson(u.key,{type:'session.history',messages:[{text:'encrypted history'}]},aad)});
          } else if(role==='browser'&&frame.kind==='response'){assert.equal(clear.type,'session.history');receivedResponses++;}
        })());
      });
      socket.once('close',code=>{clearTimeout(timeout);if(phase!=='cleanup'){failed++;errors.push(`stream_closed_${code}`);reject(Error(`stream_closed_${code}`));}});
    });
    await once(socket,'open');socket.send(JSON.stringify({type:'hello',role,device_id:u.deviceId,...(role==='browser'?{browser_token:u.browserToken}:{relay_token:u.relayToken})}));
    const response=await ready;
    const renew=setInterval(()=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'renew'}));},10_000);timers.push(renew);
    return{socket,...response};
  };
  // Stagger ordinary connection establishment; no fake cache or auth bypass.
  for(const u of users) {
    u.relay=(await connect(u,'relay')).socket;
    const browser=await connect(u,'browser');u.browser=browser.socket;u.connectionId=browser.connection_id;
    await delay(80);
  }
  assert.equal(failed,0,errors.join(','));
  phase='steady';const steadyStarted=performance.now();
  const eventRounds=350;
  for(let round=0;round<eventRounds;round++) {
    await Promise.all(users.map(async u=>{
      const eventId=`evt_${u.index}_${round}`,aad=aadFor(u,'session.event',null,{eventSeq:round+1});
      const envelope=await sealJson(u.key,{type:'session.event',event:{kind:'message.delta',text:'x'.repeat(512)}},aad);
      sentAt.set(eventId,performance.now());sentEvents++;
      sendFrame(u.relay,u,{kind:'event',event_id:eventId,event_seq:round+1,device_id:u.deviceId,browser_id:u.browserId,session_id:null,request_id:null,created_at:aad.created_at,aad,envelope});
      if(round%10===0){const command=await encryptedCommand(u,'session.read_history',`read_${u.index}_${round}`,{type:'session.read_history'});sentReads++;sendFrame(u.browser,u,command);}
    }));
    const remaining=steadyStarted+(round+1)*100-performance.now();if(remaining>0)await delay(remaining);
  }
  await awaitUntil(()=>receivedEvents===sentEvents&&receivedAcks===sentEvents&&receivedResponses===sentReads&&operations.size===0);
  const steadyMs=performance.now()-steadyStarted;
  assert.equal(failed,0,errors.slice(0,10).join(','));assert.equal(sentEvents,35_000);assert.equal(sentReads,3500);
  assert.ok(authRelay>=200&&authBrowser>=200,`periodic auth missing: ${authRelay}/${authBrowser}`);
  const steadyCommands=commands.filter(row=>row.phase==='steady');
  assert.ok(peakPerSecond(commands.map(row=>row.at))<1000);
  assert.equal(await db.collection('relay_events').countDocuments({}),0);
  assert.equal(await db.collection('relay_responses').countDocuments({}),0);
  assert.equal(await db.collection('relay_commands').countDocuments({}),0);
  const p95=percentile(latencies,.95);assert.ok(p95<1000,`p95_delivery_ms=${p95}`);
  const steadyReport={users:100,connections:200,duration_ms:Math.round(steadyMs),events_sent:sentEvents,events_received:receivedEvents,encrypted_acks:receivedAcks,reads_sent:sentReads,responses_received:receivedResponses,failed,p95_delivery_ms:Number(p95.toFixed(2)),mongo_commands:steadyCommands.length,mongo_peak_rolling_1s:peakPerSecond(steadyCommands.map(row=>row.at)),relay_auth_checks:authRelay,browser_auth_checks:authBrowser};
  // Deliberate overload verifies bounded rejection instead of exceeding admission.
  phase='flood';const flood=[];
  // Fill most of the rolling budget first, then overflow both its remaining
  // capacity and the bounded wait queue. A single burst alone only hits queueLimit.
  for(let wave=0;wave<3;wave++) flood.push(...await Promise.allSettled(Array.from({length:250},()=>db.command({ping:1}))));
  flood.push(...await Promise.allSettled(Array.from({length:2000},()=>db.command({ping:1}))));
  const flooded=commands.filter(row=>row.phase==='flood');
  assert.ok(peakPerSecond(flooded.map(row=>row.at))<=800);
  assert.ok(flood.some(row=>row.status==='rejected'));
  assert.ok(flood.every(row=>row.status==='fulfilled'||row.reason.code==='database_busy'));
  assert.ok(peakPerSecond(commands.map(row=>row.at))<=800);
  t.diagnostic(JSON.stringify({steady:steadyReport,whole_test_mongo_peak_rolling_1s:peakPerSecond(commands.map(row=>row.at)),flood:{requests:flood.length,completed:flood.filter(row=>row.status==='fulfilled').length,rejected:flood.filter(row=>row.status==='rejected').length,mongo_peak_rolling_1s:peakPerSecond(flooded.map(row=>row.at))}}));
  phase='cleanup';
});
