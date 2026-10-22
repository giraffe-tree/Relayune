import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as reserveServer } from 'node:net';
import { createServer as httpsServer, request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash, randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { MongoClient } from 'mongodb';
import { prepareSelfHostedInstance } from '../scripts/prepare-self-hosted.mjs';
import { sealJson, openJson, keyIdForKey } from '../relay/e2ee.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const password = 'isolated-https-fixture-password';
async function unusedPort() {
  const reservation=reserveServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));return port;
}
function call(instance, pathname, {method='GET',body,headers={},ca=instance.ca}={}) {
  return new Promise((resolve,reject)=>{
    const encoded=body===undefined?null:JSON.stringify(body);
    const request=httpsRequest(new URL(pathname,instance.origin),{method,ca,agent:false,
      headers:{...(encoded?{'content-type':'application/json','content-length':Buffer.byteLength(encoded)}:{}),...headers}},response=>{
      let text='';response.setEncoding('utf8');response.on('data',part=>{text+=part;if(text.length>5_000_000)request.destroy(new Error('fixture_response_too_large'));});
      response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,text,json:()=>JSON.parse(text),
        cookie:()=>response.headers['set-cookie'][0].split(';')[0]}));
    });
    request.setTimeout(8000,()=>request.destroy(new Error('fixture_request_timeout')));
    request.on('error',reject);if(encoded)request.write(encoded);request.end();
  });
}

// Generates no installer, changes no system trust and uses only temporary
// loopback processes. Every HTTPS request verifies the generated IP-SAN chain.
test('self-hosted HTTPS + real server/Mongo: independent instances, local account and PAKE', {skip:!process.env.RELAY_TEST_MONGOD,timeout:110000}, async t=>{
  const root=await mkdtemp(join(tmpdir(),'relayune-https-selfhost-'));
  const dbpath=join(root,'db');await mkdir(dbpath);const mongoPort=await unusedPort();
  const mongo=spawn(process.env.RELAY_TEST_MONGOD,['--dbpath',dbpath,'--bind_ip','127.0.0.1','--port',String(mongoPort),'--wiredTigerCacheSizeGB','0.25','--logpath',join(root,'mongo.log')],{stdio:'ignore'});
  const client=new MongoClient(`mongodb://127.0.0.1:${mongoPort}`,{serverSelectionTimeoutMS:200,retryReads:false,retryWrites:false});
  const instances=[];
  t.after(async()=>{
    for(const instance of instances){
      await new Promise(resolve=>instance.proxy.close(resolve));
      if(instance.child.exitCode===null){const stopped=once(instance.child,'exit');instance.child.kill('SIGTERM');await stopped;}
    }
    await client.close();if(mongo.exitCode===null){const stopped=once(mongo,'exit');mongo.kill('SIGTERM');await stopped;}
    await rm(root,{recursive:true,force:true});
  });
  for(let attempt=0;;attempt++){
    try{await client.connect();break;}catch(error){if(attempt>50||mongo.exitCode!==null)throw error;await delay(100);}
  }
  const status=await client.db('admin').command({serverStatus:1});
  assert.equal(Number(status.pid),mongo.pid,'must prove the target is the mongod spawned for this fixture before any writes');
  const helpersBundle=join(root,'helpers.cjs'),serverBundle=join(root,'server.cjs'),pakeBundle=join(root,'pake.cjs');
  await Promise.all([
    build({entryPoints:['server/local-accounts.ts'],outfile:helpersBundle,bundle:true,platform:'node',format:'cjs',logLevel:'silent'}),
    build({entryPoints:['server/self-hosted.ts'],outfile:serverBundle,bundle:true,platform:'node',format:'cjs',logLevel:'silent'}),
    build({entryPoints:['shared/pairing-pake.ts'],outfile:pakeBundle,bundle:true,platform:'node',format:'cjs',logLevel:'silent'}),
  ]);
  const {initializeLocalAccounts,initializeLocalOwner,resetLocalOwnerPassword}=createRequire(import.meta.url)(helpersBundle);
  const pake=createRequire(import.meta.url)(pakeBundle);
  const preload=join(root,'block-external.cjs');
  await writeFile(preload,`
    const net=require('node:net');
    const original=net.Socket.prototype.connect;
    net.Socket.prototype.connect=function(...args){
      let first=args[0];if(Array.isArray(first))first=first[0];
      let host=typeof first==='object'&&first?first.host:typeof args[1]==='string'?args[1]:'localhost';
      host=host||'localhost';
      if(!['127.0.0.1','::1','localhost'].includes(host))throw new Error('external_network_blocked');
      return original.apply(this,args);
    };
  `,{mode:0o600});
  async function startInstance(name){
    const apiPort=await unusedPort(),httpsPort=await unusedPort();const origin=`https://127.0.0.1:${httpsPort}`;
    const directory=join(root,`instance-${name}`);await prepareSelfHostedInstance({directory,projectRoot:process.cwd(),origin,apiPort,mongoPort,mongoDatabase:`isolated_https_${name}`,mongoUser:`fixture_${name}`});
    const db=client.db(`isolated_https_${name}`);await initializeLocalAccounts(db);const owner=await initializeLocalOwner(db,'admin',password);
    const dbPassword=`isolated-database-password-${name}`;
    await db.command({createUser:`fixture_${name}`,pwd:dbPassword,roles:[{role:'readWrite',db:db.databaseName}]});
    const ca=await readFile(join(directory,'tls/ca.pem'));
    const instance={origin,ca,db,owner,output:'',wire:[],child:null,proxy:null};
    instance.proxy=httpsServer({key:await readFile(join(directory,'tls/server-key.pem')),cert:await readFile(join(directory,'tls/server-chain.pem'))},(request,response)=>{
      const upstream=httpRequest({hostname:'127.0.0.1',port:apiPort,path:request.url,method:request.method,
        headers:{...request.headers,'x-real-ip':'127.0.0.1','x-forwarded-for':'127.0.0.1','x-forwarded-proto':'https'}},incoming=>{
        response.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(response);
      });
      upstream.on('error',()=>{response.writeHead(502);response.end();});
      request.on('data',data=>instance.wire.push(data.toString()));request.pipe(upstream);
    });
    await new Promise(resolve=>instance.proxy.listen(httpsPort,'127.0.0.1',resolve));
    instance.child=spawn(process.execPath,['--require',preload,serverBundle],{cwd:root,env:{
      PATH:process.env.PATH,HOME:root,HOST:'127.0.0.1',PORT:String(apiPort),PUBLIC_ORIGIN:origin,RELAY_AUTH_MODE:'username',
      RELAY_PROJECT_ROOT:process.cwd(),RELAY_BLOB_DIR:join(root,`blobs-${name}`),MONITOR_ADMIN_USERNAME:'admin',
      MONGO_HOST:'127.0.0.1',MONGO_PORT:String(mongoPort),MONGO_DATABASE:db.databaseName,MONGO_USER:`fixture_${name}`,MONGO_PASSWORD:dbPassword,
    },stdio:['ignore','pipe','pipe']});
    instance.child.stdout.on('data',data=>{instance.output+=data;});instance.child.stderr.on('data',data=>{instance.output+=data;});
    instances.push(instance);
    for(let attempt=0;;attempt++){
      try{if((await call(instance,'/health')).status===200)break;}catch{}
      if(attempt>70||instance.child.exitCode!==null)assert.fail(`isolated HTTPS instance ${name} did not start (exit ${instance.child.exitCode})`);
      await delay(100);
    }
    return instance;
  }
  const first=await startInstance('first'),second=await startInstance('second');
  const login=async instance=>{
    const result=await call(instance,'/api/auth/password',{method:'POST',headers:{origin:instance.origin},body:{username:'admin',password}});
    assert.equal(result.status,200);return result.cookie();
  };
  const cookie=await login(first);
  await t.test('trusted IP certificate, instance metadata and login session',async()=>{
    await assert.rejects(()=>call(first,'/health',{ca:second.ca}));
    const info=(await call(first,'/api/instance')).json();assert.equal(info.auth_mode,'username');assert.equal(info.setup_required,false);
    assert.equal(info.registration_enabled,false);assert.equal(info.account_deletion_enabled,false);
    const session=(await call(first,'/api/auth/session',{headers:{cookie}})).json();assert.equal(session.user.account_id,first.owner._id);assert.equal(session.user.email,null);
    const forged=await call(first,'/api/bootstrap',{headers:{'oai-authenticated-user-email':'fake@example.invalid','x-relayune-authenticated-account-id':first.owner._id,'x-relayune-account-username':'admin'}});
    assert.equal(forged.status,401);
    assert.equal((await call(first,'/api/auth/setup',{method:'POST',headers:{origin:first.origin},body:{username:'admin',password}})).status,403);
  });
  await t.test('same displayed username across two origins never shares cookie identity',async()=>{
    assert.notEqual(first.owner._id,second.owner._id);
    const foreign=(await call(second,'/api/auth/session',{headers:{cookie}})).json();assert.equal(foreign.authenticated,false);
    assert.equal((await call(second,'/api/bootstrap',{headers:{cookie}})).status,401);
    assert.equal((await call(second,'/api/auth/password',{method:'POST',headers:{origin:first.origin},body:{username:'admin',password}})).status,403);
    const own=await login(second);assert.equal((await call(second,'/api/auth/session',{headers:{cookie:own}})).json().user.account_id,second.owner._id);
  });
  const desktopToken=randomBytes(32).toString('base64url');let deviceId;
  await t.test('full Desktop browser approval binds this instance owner',async()=>{
    const start=await call(first,'/api/desktop-login/start',{method:'POST',body:{name:'isolated HTTPS Desktop',relay_token_hash:hash(desktopToken)}});assert.equal(start.status,201);
    const pending=start.json();
    assert.equal((await call(first,`/api/desktop-login/${pending.request_id}/approval`)).status,401);
    const approve=await call(first,`/api/desktop-login/${pending.request_id}/approve`,{method:'POST',headers:{cookie,origin:first.origin}});assert.equal(approve.status,200);
    assert.equal(approve.json().account_email,'admin');assert.equal(approve.json().account_id,first.owner._id);
    const poll=await call(first,`/api/desktop-login/${pending.request_id}`,{headers:{'X-Relay-Desktop-Login-Secret':pending.poll_secret}});assert.equal(poll.status,200);deviceId=poll.json().device_id;
    const hello=await call(first,'/api/relay/hello',{method:'POST',headers:{authorization:`Bearer ${desktopToken}`},body:{device_id:deviceId,protocol_version:2}});assert.equal(hello.status,200);
    assert.equal((await call(second,'/api/relay/hello',{method:'POST',headers:{authorization:`Bearer ${desktopToken}`},body:{device_id:deviceId,protocol_version:2}})).status,401);
  });
  const pairings=[];const canary='SESSION_PLAINTEXT_STAYS_OFF_THIS_SELFHOST_SERVER';
  await t.test('two independent PAKE clients receive distinct ciphertext catalogs',async()=>{
    for(let index=0;index<2;index++){
      const desktop=await pake.createPairingInitiator();const token=randomBytes(32).toString('base64url');
      const started=await call(first,'/api/relay/pairings/start',{method:'POST',headers:{authorization:`Bearer ${desktopToken}`},body:{pairing_id:desktop.pairingId,protocol:pake.PAIRING_PROTOCOL,initiator_share:desktop.initiatorShare}});assert.equal(started.status,201);
      const publicState=(await call(first,`/api/pairings/${desktop.pairingId}`)).json();
      const browser=await pake.respondToPairing(desktop.pairingId,desktop.code,publicState.initiator_share);
      const respond=await call(first,`/api/browser/pairings/${desktop.pairingId}/respond`,{method:'POST',headers:{cookie,origin:first.origin},body:{protocol:pake.PAIRING_PROTOCOL,responder_share:browser.responderShare,responder_confirm:browser.responderConfirm,browser_token_hash:hash(token),browser_key_id:await keyIdForKey(browser.contentKey),browser_name:`isolated ${index}`,client_identity:`web:${hash(`fixture-${index}`)}`}});assert.equal(respond.status,200);
      const peer=(await call(first,`/api/pairings/${desktop.pairingId}`)).json();
      const confirmed=await pake.finishPairingInitiator(desktop,peer.responder_share,peer.responder_confirm);
      const complete=await call(first,`/api/pairings/${desktop.pairingId}/complete`,{method:'POST',headers:{authorization:`Bearer ${desktopToken}`},body:{desktop_confirm:confirmed.desktopConfirm}});assert.equal(complete.status,201);
      pake.verifyDesktopConfirmation(browser.expectedDesktopConfirm,(await call(first,`/api/pairings/${desktop.pairingId}`)).json().desktop_confirm);
      const id=complete.json().browser_id;
      const aad={created_at:new Date().toISOString(),device_id:deviceId,direction:'relay_to_web',event_seq:null,expires_at:null,request_id:null,session_id:null,type:'relay.sync_sessions'};
      const envelope=await sealJson(browser.contentKey,{sessions:[{id:'ses_fixture',name:canary}]},aad);
      const push=await call(first,'/api/relay/push',{method:'POST',headers:{authorization:`Bearer ${desktopToken}`},body:{device_id:deviceId,messages:[{kind:'catalog',device_id:deviceId,browser_id:id,session_refs:['ses_fixture'],aad,envelope}]}});assert.equal(push.status,200);
      const bootstrap=await call(first,`/api/bootstrap?device_id=${deviceId}`,{headers:{cookie,'X-Relay-Browser-Token':token}});assert.equal(bootstrap.status,200);
      const catalog=bootstrap.json().catalog;assert.equal((await openJson(browser.contentKey,catalog.envelope,catalog.aad)).sessions[0].name,canary);
      pairings.push({id,token,key:browser.contentKey,code:desktop.code,catalog});
    }
    assert.notEqual(pairings[0].key,pairings[1].key);
    await assert.rejects(()=>openJson(pairings[0].key,pairings[1].catalog.envelope,pairings[1].catalog.aad));
    const catalogs=JSON.stringify(await first.db.collection('relay_catalogs').find({}).toArray());assert.ok(!catalogs.includes(canary));
    assert.ok(!first.wire.join('').includes(canary));
    assert.equal((await call(second,`/api/bootstrap?device_id=${deviceId}`,{headers:{cookie,'X-Relay-Browser-Token':pairings[0].token}})).status,401);
  });
  await t.test('session command, approval, event, history and large attachment remain ciphertext through real HTTP/Mongo/blob routes',async()=>{
    const client=pairings[0],now=new Date().toISOString(),expiry=new Date(Date.now()+60_000).toISOString();
    const requestId='req_content_blindness',sessionId='ses_fixture';
    const route={direction:'web_to_relay',type:'session.submit_message',device_id:deviceId,
      session_id:sessionId,request_id:requestId,event_seq:null,created_at:now,expires_at:expiry};
    const command={type:route.type,device_id:deviceId,session_id:sessionId,request_id:requestId,
      issued_at:now,expires_at:expiry,payload:{content:`${canary} user instruction`,
        cwd:`/synthetic/${canary}`,attachments:[{name:`${canary}.png`,base64:Buffer.from(canary.repeat(12000)).toString('base64')}]}};
    const queued=await call(first,'/api/commands',{method:'POST',headers:{cookie,origin:first.origin,
      'X-Relay-Browser-Token':client.token,'Idempotency-Key':requestId},body:{device_id:deviceId,
      session_id:sessionId,request_id:requestId,command_type:route.type,created_at:now,expires_at:expiry,
      aad:route,envelope:await sealJson(client.key,command,route)}});
    assert.equal(queued.status,202);
    const storedCommand=await first.db.collection('relay_commands').findOne({id:requestId});
    assert.equal(storedCommand.envelope,null);assert.match(storedCommand.blob_key,/^commands\//);
    const poll=await call(first,`/api/relay/commands?device_id=${deviceId}`,{headers:{authorization:`Bearer ${desktopToken}`}});
    assert.equal(poll.status,200);const frame=poll.json().commands.find(item=>item.request_id===requestId);
    assert.deepEqual(await openJson(client.key,frame.envelope,frame.aad),command);
    const eventAad={...route,direction:'relay_to_web',type:'session.event',request_id:null,event_seq:1,expires_at:null};
    const event={type:'session.event',event:{kind:'approval.requested',action:{command:`${canary} approval command`},
      message:{content:`${canary} Agent output`},approval_id:'approval_fixture'}};
    const historyAad={...route,direction:'relay_to_web',type:'session.history',expires_at:null};
    const history={type:'session.history',request_id:requestId,messages:[{content:`${canary} history`}],
      attachment:{name:`${canary}.png`,base64:Buffer.from(canary.repeat(12000)).toString('base64')}};
    const push=await call(first,'/api/relay/push',{method:'POST',headers:{authorization:`Bearer ${desktopToken}`},
      body:{device_id:deviceId,messages:[{kind:'event',device_id:deviceId,browser_id:client.id,session_id:sessionId,
        event_id:'evt_content_blindness',event_seq:1,created_at:now,aad:eventAad,envelope:await sealJson(client.key,event,eventAad)},
      {kind:'response',device_id:deviceId,browser_id:client.id,session_id:sessionId,request_id:requestId,
        aad:historyAad,envelope:await sealJson(client.key,history,historyAad)}]}});
    assert.equal(push.status,200);
    const storedResponse=await first.db.collection('relay_responses').findOne({request_id:requestId});
    assert.equal(storedResponse.envelope,null);assert.match(storedResponse.blob_key,/^responses\//);
    const events=await call(first,`/api/events?device_id=${deviceId}&cursor=0`,{headers:{cookie,'X-Relay-Browser-Token':client.token}});
    assert.equal(events.status,200);const forwarded=events.json().events.find(item=>item.event_id==='evt_content_blindness');
    assert.deepEqual(await openJson(client.key,forwarded.envelope,forwarded.aad),event);
    const response=await call(first,`/api/responses/${requestId}?device_id=${deviceId}`,{headers:{cookie,'X-Relay-Browser-Token':client.token}});
    assert.equal(response.status,200);const fetched=response.json();
    assert.deepEqual(await openJson(client.key,fetched.envelope,fetched.aad),history);
    assert.ok(!first.wire.join('').includes(canary));
  });
  await t.test('explicit feedback and local-only monitoring stay in this instance',async()=>{
    const id=randomBytes(16).toString('hex');
    const feedback=await call(first,'/api/feedback',{method:'POST',headers:{cookie,origin:first.origin},body:{id,category:'bug',description:'explicit local fixture feedback',client:'mobile',environment:{app_version:'0.0.0',device_model:'fixture',os_version:'fixture'},images:[]}});assert.equal(feedback.status,201);
    assert.equal((await first.db.collection('relay_feedback').findOne({_id:id})).description,'explicit local fixture feedback');assert.equal(await second.db.collection('relay_feedback').countDocuments(),0);
    const monitor=await call(first,'/api/monitoring',{headers:{cookie}});assert.equal(monitor.status,200);assert.equal(monitor.json().logs_available,false);assert.equal(monitor.json().runtime.database_ok,true);
  });
  await t.test('local password recovery rejects old cookies even with independent PAKE bearer',async()=>{
    let finished=false;
    const waiting=call(first,`/api/responses/req_fixture_reset_wait?device_id=${deviceId}&wait_ms=1000&pending_status=202`,{headers:{cookie,'X-Relay-Browser-Token':pairings[0].token}});
    void waiting.then(()=>{finished=true;});
    await delay(200);assert.equal(finished,false,'response request must be waiting before local recovery');
    await resetLocalOwnerPassword(first.db,'isolated-replacement-password');
    assert.equal((await waiting).status,401,'long poll must recheck the account generation after wake');
    assert.equal((await call(first,'/api/auth/session',{headers:{cookie}})).json().authenticated,false);
    assert.equal((await call(first,`/api/bootstrap?device_id=${deviceId}`,{headers:{cookie,'X-Relay-Browser-Token':pairings[0].token}})).status,401);
    assert.equal((await call(first,'/api/auth/password',{method:'POST',headers:{origin:first.origin},body:{username:'admin',password}})).status,401);
    const replacement=await call(first,'/api/auth/password',{method:'POST',headers:{origin:first.origin},body:{username:'admin',password:'isolated-replacement-password'}});assert.equal(replacement.status,200);assert.equal(replacement.json().user.account_id,first.owner._id);
    // Password recovery revokes account sessions, while independently approved
    // Desktop credentials remain operator-managed grants.
    assert.equal((await first.db.collection('relay_devices').findOne({id:deviceId})).revoked_at,null);
    await call(first,'/api/auth/logout',{method:'POST',headers:{cookie:replacement.cookie(),origin:first.origin},body:{}});
    assert.equal((await call(first,'/api/auth/session',{headers:{cookie:replacement.cookie()}})).json().authenticated,false);
  });
  for(const instance of instances){
    for(const value of [password,'isolated-replacement-password',desktopToken,canary,...pairings.flatMap(item=>[item.key,item.token,item.code])])assert.ok(!instance.output.includes(value));
    assert.ok(!instance.output.includes('external_network_blocked'));
  }
  await t.test('all server collections, private blob files and Mongo/app logs omit session canaries, PAKE codes and content keys',async()=>{
    const forbidden=[canary,...pairings.flatMap(item=>[item.key,item.code,item.code.replaceAll('-','')])];
    let documents=0,blobFiles=0;
    const check=(text,location)=>{for(const value of forbidden)assert.ok(!text.includes(value),`endpoint secret found in ${location}`);};
    async function scanBlobs(directory){
      let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
      for(const entry of entries){const filename=join(directory,entry.name);
        if(entry.isDirectory())await scanBlobs(filename);
        else if(entry.isFile()){check(await readFile(filename,'utf8'),'private blob');blobFiles++;}}
    }
    for(const [index,instance] of instances.entries()){
      for(const {name} of await instance.db.listCollections().toArray()){
        const rows=await instance.db.collection(name).find({}).toArray();documents+=rows.length;
        check(JSON.stringify(rows),`Mongo collection ${name}`);
      }
      await scanBlobs(join(root,`blobs-${index===0?'first':'second'}`));
      check(instance.output,'application logs');check(instance.wire.join(''),'HTTP session bodies');
    }
    check(await readFile(join(root,'mongo.log'),'utf8'),'Mongo logs');
    assert.ok(documents>0);assert.ok(blobFiles>=2,'must inspect actual command and response blob files');
    t.diagnostic(`Scanned ${documents} actual Mongo documents, ${blobFiles} private blobs, HTTP request bodies and Mongo/app logs; no session canary, PAKE code or content key.`);
  });
});
