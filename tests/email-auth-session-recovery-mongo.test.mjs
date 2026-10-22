import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { randomBytes, createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { build } from 'esbuild';
import WebSocket from 'ws';

const origin='https://isolated-email-auth.test';
const email='synthetic-owner@example.invalid';
const firstPassword='synthetic-old-password';
const secondPassword='synthetic-replacement-password';
const hash=value=>createHash('sha256').update(value).digest('hex');
function request(method,path,body,cookie=''){
 const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);
 return Object.assign(req,{method,url:path,headers:{origin,cookie},socket:{remoteAddress:'127.0.0.1'}});
}
function response(){return{status:0,headers:{},body:'',writeHead(status,headers){this.status=status;this.headers=headers;},end(body=''){this.body+=body;},json(){return JSON.parse(this.body);},cookie(){const value=this.headers['Set-Cookie'];return(Array.isArray(value)?value[0]:value).split(';')[0];}};}

test('email password recovery revokes account generations without restoring stale login authority', {skip:!process.env.RELAY_TEST_MONGOD,timeout:90000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'relayune-email-recovery-'));const dbpath=join(root,'db');await mkdir(dbpath);
 const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
 const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const mongo=spawn(process.env.RELAY_TEST_MONGOD,['--dbpath',dbpath,'--bind_ip','127.0.0.1','--port',String(port),'--wiredTigerCacheSizeGB','0.25','--logpath',join(root,'mongo.log')],{stdio:'ignore'});
 const client=new MongoClient(`mongodb://127.0.0.1:${port}`,{serverSelectionTimeoutMS:200,retryReads:false,retryWrites:false});
 t.after(async()=>{await client.close();if(mongo.exitCode===null){const stopped=once(mongo,'exit');mongo.kill('SIGTERM');await stopped;}await rm(root,{recursive:true,force:true});});
 for(let attempt=0;;attempt++){try{await client.connect();break;}catch(error){if(attempt>50||mongo.exitCode!==null)throw error;await delay(100);}}
 assert.equal(Number((await client.db('admin').command({serverStatus:1})).pid),mongo.pid);
 const outfile=join(root,'api.cjs');await build({stdin:{contents:`export {EmailAuth} from './server/email-auth.ts'; export {passwordRecord} from './server/password-hash.ts'; export {initializeLocalOwner,resetLocalOwnerPassword} from './server/local-accounts.ts';`,resolveDir:process.cwd()},outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
 const {EmailAuth,passwordRecord,initializeLocalOwner,resetLocalOwnerPassword}=createRequire(import.meta.url)(outfile);
 let sequence=0;
 async function fixture({generation,mode='email',seed=true}={}){
  const db=client.db(`isolated_recovery_${++sequence}`);const auth=new EmailAuth(db,{publicOrigin:origin,authMode:mode,...(mode==='email'?{mailFrom:'synthetic@example.invalid'}:{})});await auth.initialize();
  if(seed&&mode==='email')await db.collection('auth_users').insertOne({_id:email,email,...await passwordRecord(firstPassword),...(generation===undefined?{}:{auth_epoch:generation}),preferences:{theme:'fixture'},created_at:new Date('2026-01-01T00:00:00Z')});
  const call=async(method,path,body,cookie='',target=auth)=>{const res=response();await target.handle(request(method,path,body,cookie),res);return res;};
  const login=(password=firstPassword,target=auth)=>call('POST','/api/auth/password',{email,password},'',target);
  // A synthetic verified-email setup session replaces delivery only inside
  // this isolated fixture. No mail is sent and no real credentials are read.
  const recover=async password=>{const token=randomBytes(32).toString('base64url');await db.collection('auth_setup_sessions').insertOne({_id:hash(token),token_hash:hash(token),email,expires_at:new Date(Date.now()+60000),used_at:null});return call('POST','/api/auth/set-password',{password},`relay_setup=${token}`);};
  return {db,auth,call,login,recover};
 }
 await t.test('legacy account/session without generation works until password recovery, then only replacement password/session works',async()=>{
  const {db,auth,login,recover}=await fixture();const legacyToken=randomBytes(32).toString('base64url');
  await db.collection('auth_sessions').insertOne({_id:hash(legacyToken),token_hash:hash(legacyToken),email,expires_at:new Date(Date.now()+60000),revoked_at:null});
  const oldCookie=`relay_session=${legacyToken}`;assert.equal(await auth.authenticate(request('GET','/',undefined,oldCookie)),email);
  const oldLogin=await login();assert.equal(oldLogin.status,200);const reset=await recover(secondPassword);assert.equal(reset.status,200);
  assert.equal(await auth.authenticate(request('GET','/',undefined,oldCookie)),null);
  assert.equal(await auth.authenticate(request('GET','/',undefined,oldLogin.cookie())),null);
  assert.equal(await auth.authenticate(request('GET','/',undefined,reset.cookie())),email);
  assert.equal((await login()).status,401);const replacement=await login(secondPassword);assert.equal(replacement.status,200);assert.equal(await auth.authenticate(request('GET','/',undefined,replacement.cookie())),email);
  const saved=await db.collection('auth_users').findOne({_id:email});assert.equal(saved.auth_epoch,1);assert.equal(saved.preferences.theme,'fixture');assert.equal(saved.created_at.toISOString(),'2026-01-01T00:00:00.000Z');
 });
 await t.test('old-password validation racing recovery cannot mint valid renewed authority',async()=>{
  const {db,auth,login,recover}=await fixture();let release,captured;const waiting=new Promise(resolve=>{release=resolve;});const read=new Promise(resolve=>{captured=resolve;});
  const intercepted=new Proxy(db,{get(target,key){if(key!=='collection'){const value=target[key];return typeof value==='function'?value.bind(target):value;}return name=>{const collection=target.collection(name);if(name!=='auth_users')return collection;return new Proxy(collection,{get(source,property){if(property==='findOne')return async(...args)=>{const snapshot=await source.findOne(...args);if(args[0]._id===email){captured();await waiting;}return snapshot;};const value=source[property];return typeof value==='function'?value.bind(source):value;}});};}});
  const racingAuth=new EmailAuth(intercepted,{publicOrigin:origin,mailFrom:'synthetic@example.invalid'});
  const pending=login(firstPassword,racingAuth);await read;const reset=await recover(secondPassword);assert.equal(reset.status,200);release();const result=await pending;
  assert.equal(result.status,200);assert.equal(await auth.authenticate(request('GET','/',undefined,result.cookie())),null);
  assert.equal(await auth.authenticate(request('GET','/',undefined,reset.cookie())),email);
 });
 await t.test('generation validation rejects a stale session even when no cleanup deleted its row',async()=>{
  const {db,auth,login}=await fixture({generation:4});const result=await login();assert.equal(result.status,200);
  const cookie=result.cookie(),token=cookie.split('=')[1];assert.equal(await auth.authenticate(request('GET','/',undefined,cookie)),email);
  await db.collection('auth_users').updateOne({_id:email},{$inc:{auth_epoch:1}});
  assert.ok(await db.collection('auth_sessions').findOne({token_hash:hash(token)}));
  assert.equal(await auth.authenticate(request('GET','/',undefined,cookie)),null);
 });
 await t.test('concurrent recoveries increment atomically and cleanup never deletes a newer generation',async()=>{
  const {db,auth,recover}=await fixture();const resets=await Promise.all([recover(secondPassword),recover('third-synthetic-password')]);
  assert.ok(resets.every(result=>result.status===200));const user=await db.collection('auth_users').findOne({_id:email});assert.equal(user.auth_epoch,2);
  const accepted=await Promise.all(resets.map(result=>auth.authenticate(request('GET','/',undefined,result.cookie()))));assert.equal(accepted.filter(value=>value===email).length,1);
 });
 await t.test('new registration sets its initial generation, malformed generations fail closed',async()=>{
  const {db,auth,recover}=await fixture({seed:false});const result=await recover(secondPassword);assert.equal(result.status,200);
  assert.equal((await db.collection('auth_users').findOne({_id:email})).auth_epoch,1);assert.equal(await auth.authenticate(request('GET','/',undefined,result.cookie())),email);
  const token=result.cookie().split('=')[1];
  for(const invalid of [null,-1,1.5,'1',Number.MAX_SAFE_INTEGER+1]){
   await db.collection('auth_sessions').updateOne({token_hash:hash(token)},{$set:{auth_epoch:invalid}});
   assert.equal(await auth.authenticate(request('GET','/',undefined,result.cookie())),null);
  }
  await db.collection('auth_sessions').updateOne({token_hash:hash(token)},{$set:{auth_epoch:1}});
  await db.collection('auth_users').updateOne({_id:email},{$set:{auth_epoch:null}});assert.equal(await auth.authenticate(request('GET','/',undefined,result.cookie())),null);
 });
 await t.test('real Node server rejects a waiting response and reauthenticates both active WS channels after email recovery',{timeout:55000},async sub=>{
  const {db}=await fixture();
  await db.command({createUser:'fixture_recovery_app',pwd:'isolated-recovery-database-password',roles:[{role:'readWrite',db:db.databaseName}]});
  const deviceId='dev_'+'a'.repeat(32),browserId='web_'+'b'.repeat(32),browserToken=randomBytes(32).toString('base64url');
  const userId='usr_'+hash(email).slice(0,32),now=Date.now();
  await db.collection('relay_users').insertOne({_id:userId,id:userId,email,created_at:now,updated_at:now});
  await db.collection('relay_devices').insertOne({_id:deviceId,id:deviceId,user_id:userId,name:'synthetic Desktop',relay_token_hash:hash('synthetic-independent-device-token'),identity_public_key:'{}',encrypted_descriptor:null,key_epoch:1,protocol_version:2,ack_seq:0,created_at:now,last_seen_at:now,revoked_at:null});
  await db.collection('relay_browser_authorizations').insertOne({_id:browserId,id:browserId,user_id:userId,device_id:deviceId,name:'synthetic browser',token_hash:hash(browserToken),key_id:'sha256:'+'a'.repeat(43),created_at:now,last_seen_at:now,revoked_at:null});
  const serverBundle=join(root,'server.cjs');await build({entryPoints:['server/self-hosted.ts'],outfile:serverBundle,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const apiPort=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,[serverBundle],{env:{PATH:process.env.PATH,HOME:root,HOST:'127.0.0.1',PORT:String(apiPort),PUBLIC_ORIGIN:origin,RELAY_AUTH_MODE:'email',MAIL_FROM:'synthetic@example.invalid',SENDMAIL_PATH:join(root,'nonexistent-sendmail'),RELAY_BLOB_DIR:join(root,'http-blobs'),MONGO_HOST:'127.0.0.1',MONGO_PORT:String(port),MONGO_DATABASE:db.databaseName,MONGO_USER:'fixture_recovery_app',MONGO_PASSWORD:'isolated-recovery-database-password'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
  const sockets=[];let renew;
  sub.after(async()=>{clearInterval(renew);for(const socket of sockets)socket.terminate();if(child.exitCode===null){const stopped=once(child,'exit');child.kill('SIGTERM');await stopped;}});
  const base=`http://127.0.0.1:${apiPort}`;
  for(let attempt=0;;attempt++){try{if((await fetch(base+'/health')).ok)break;}catch{}if(attempt>60||child.exitCode!==null)assert.fail('isolated recovery server did not start');await delay(100);}
  const initial=await fetch(base+'/api/auth/password',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email,password:firstPassword})});assert.equal(initial.status,200);const cookie=initial.headers.get('set-cookie').split(';')[0];
  async function subscribe(path,payload){
   const socket=new WebSocket(`ws://127.0.0.1:${apiPort}${path}`,{headers:{origin,cookie}});sockets.push(socket);
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('fixture_ws_not_ready')),5000);socket.once('error',reject);socket.on('message',data=>{if(JSON.parse(data.toString()).type==='ready'){clearTimeout(timer);resolve();}});socket.once('open',()=>socket.send(JSON.stringify(payload)));});
   return socket;
  }
  const realtime=await subscribe('/api/realtime',{type:'subscribe',device_id:deviceId,browser_token:browserToken});
  const cipher=await subscribe('/api/stream',{type:'hello',role:'browser',device_id:deviceId,browser_token:browserToken});
  const realtimeClosed=once(realtime,'close'),cipherClosed=once(cipher,'close');
  renew=setInterval(()=>{if(cipher.readyState===WebSocket.OPEN)cipher.send(JSON.stringify({type:'renew'}));},8000);
  const waiting=fetch(base+`/api/responses/req_recovery_wait?device_id=${deviceId}&wait_ms=1000&pending_status=202`,{headers:{cookie,'X-Relay-Browser-Token':browserToken}});
  let responseFinished=false;void waiting.then(()=>{responseFinished=true;});await delay(200);assert.equal(responseFinished,false);
  const token=randomBytes(32).toString('base64url');await db.collection('auth_setup_sessions').insertOne({_id:hash(token),token_hash:hash(token),email,expires_at:new Date(Date.now()+60000),used_at:null});
  const reset=await fetch(base+'/api/auth/set-password',{method:'POST',headers:{origin,'content-type':'application/json',cookie:`relay_setup=${token}`},body:JSON.stringify({password:secondPassword})});assert.equal(reset.status,200);const freshCookie=reset.headers.get('set-cookie').split(';')[0];
  assert.equal((await waiting).status,401);
  assert.equal((await(await fetch(base+'/api/auth/session',{headers:{cookie}})).json()).authenticated,false);
  assert.equal((await(await fetch(base+'/api/auth/session',{headers:{cookie:freshCookie}})).json()).authenticated,true);
  const [realtimeClose,cipherClose]=await Promise.all([realtimeClosed,cipherClosed]);assert.equal(realtimeClose[0],4401);assert.equal(cipherClose[0],4401);
  assert.equal((await db.collection('relay_devices').findOne({_id:deviceId})).revoked_at,null);assert.equal((await db.collection('relay_browser_authorizations').findOne({_id:browserId})).revoked_at,null);
  for(const secret of [firstPassword,secondPassword,'isolated-recovery-database-password',browserToken,token])assert.ok(!output.includes(secret));
 });
 await t.test('username recovery retains its generation semantics and independent device grants',async()=>{
  const {db,auth,call}=await fixture({mode:'username',seed:false});const owner=await initializeLocalOwner(db,'admin',firstPassword);
  await db.collection('relay_devices').insertOne({_id:'dev_synthetic',user_id:owner._id,relay_token_hash:hash('synthetic-device-token'),revoked_at:null});
  const old=await call('POST','/api/auth/password',{username:'admin',password:firstPassword});assert.equal(old.status,200);assert.equal(await auth.authenticate(request('GET','/',undefined,old.cookie())),owner._id);
  await resetLocalOwnerPassword(db,secondPassword);assert.equal(await auth.authenticate(request('GET','/',undefined,old.cookie())),null);
  const fresh=await call('POST','/api/auth/password',{username:'admin',password:secondPassword});assert.equal(fresh.status,200);assert.equal(await auth.authenticate(request('GET','/',undefined,fresh.cookie())),owner._id);
  assert.equal((await db.collection('relay_devices').findOne({_id:'dev_synthetic'})).revoked_at,null);
 });
});
