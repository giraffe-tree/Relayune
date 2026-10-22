// [MOB-NOT-019][server]
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { IosPushState, iosPushKey, iosActivityRoute } from '../relay/ios-push.mjs';
import { openJson } from '../relay/e2ee.mjs';
import { validateIosPush, tokenBox, openTokenBox } from '../server/ios-push.mjs';

const now=Date.now();
const aad={direction:'relay_to_web',type:'session.event',device_id:'dev_test',session_id:'session_test',request_id:null,event_seq:1,created_at:new Date(now).toISOString(),expires_at:null};
test('push summary stays encrypted and omits source content',async()=>{
  const state=new IosPushState(),key=randomBytes(32).toString('base64url');
  state.transition('session_test',{kind:'turn.started',turn_id:'turn1'},now);
  const snapshot=state.transition('session_test',{kind:'approval.requested',turn_id:'turn1',approval_id:'approval1',expires_at:new Date(now+120000).toISOString(),action:{type:'shell',command:'PRIVATE_COMMAND'},message:'PRIVATE_MESSAGE'},now);
  const push=await state.seal(key,snapshot,aad);
  assert.equal(validateIosPush(push,aad,now),push);
  const pushKey=await iosPushKey(key);
  assert.notEqual(pushKey,key);
  const decoded=await openJson(pushKey,push.envelope,JSON.parse(Buffer.from(push.envelope.aad,'base64url')));
  assert.equal(decoded.state,'approval');assert.equal(decoded.sessionId,'session_test');
  assert.equal(push.activity_route,iosActivityRoute(pushKey,'session_test','turn1'));
  for(const value of ['PRIVATE_COMMAND','PRIVATE_MESSAGE','approval1']) assert.ok(!JSON.stringify(decoded).includes(value));
  assert.ok(!JSON.stringify(push).includes('"state"'));
  await assert.rejects(openJson(key,push.envelope,aad));
});
test('multiple child approvals do not replace parent turn or end parent',()=>{
  const state=new IosPushState();state.transition('root',{kind:'turn.started',turn_id:'parent'},now);
  for(const id of ['a','b']) state.transition('child',{kind:'approval.requested',root_session_id:'root',turn_id:'child-turn',approval_id:id,expires_at:new Date(now+60000).toISOString()},now);
  assert.equal(state.transition('child',{kind:'approval.resolved',root_session_id:'root',approval_id:'a'},now).state,'approval');
  assert.equal(state.transition('child',{kind:'approval.resolved',root_session_id:'root',approval_id:'b'},now).state,'running');
  assert.equal(state.transition('child',{kind:'turn.completed',root_session_id:'root',turn_id:'child-turn'},now),null);
  assert.equal(state.transition('root',{kind:'turn.completed',turn_id:'old-turn'},now),null);
  assert.equal(state.transition('root',{kind:'turn.completed',turn_id:'parent',status:'cancelled'},now).state,'stopped');
});
test('push validation rejects extra plaintext, route tampering, stale data and oversized envelopes',async()=>{
  const s=new IosPushState();const key=randomBytes(32).toString('base64url');
  const p=await s.seal(key,s.transition('session_test',{kind:'turn.started',turn_id:'t'},now),aad);
  assert.throws(()=>validateIosPush({...p,title:'private'},aad,now));
  assert.throws(()=>validateIosPush(p,{...aad,device_id:'other'},now));
  assert.equal(validateIosPush(p,aad,now+300001),null);
  assert.throws(()=>validateIosPush({...p,envelope:{...p.envelope,ciphertext:'a'.repeat(5000)}},aad,now));
});
test('APNs destination tokens are encrypted at rest and bound to the authorization',()=>{
  const key=randomBytes(32),value={token:'ab'.repeat(32),activities:[]};
  const box=tokenBox(key,value,'browser-a');
  assert.ok(!box.includes(value.token));assert.deepEqual(openTokenBox(key,box,'browser-a'),value);
  assert.throws(()=>openTokenBox(key,box,'browser-b'));
  assert.throws(()=>openTokenBox(randomBytes(32),box,'browser-a'));
});

test('delivery rechecks authorization and handles transient/permanent APNs failures without duplicate alerts',async()=>{
  const {IosPushService}=await import('../server/ios-push.mjs');
  const storageKey=randomBytes(32),record={environment:'sandbox',generation:'g',tokens:tokenBox(storageKey,{token:'ab'.repeat(32),activities:[]},'browser')};
  let authorized=true,registration=record,response={status:503},sends=0;
  const updates=[];
  const db={collection(name){return {
    async findOne(){return name==='relay_ios_push_registrations'?registration:name==='relay_browser_authorizations'?(authorized?{}:null):{};},
    async updateOne(filter,update){updates.push(update.$set);},async deleteOne(){registration=null;}
  };}};
  const service=new IosPushService(db,{sandbox:{async send(){sends++;return response;}}},storageKey);
  const job={_id:'a'.repeat(64),deviceId:'dev',browserId:'browser',generation:'g',attempts:1,push:{alert:true,envelope:{},expires_at:now+120000}};
  authorized=false;await service.deliver(job);assert.equal(sends,0);assert.equal(updates.at(-1).status,'cancelled');
  authorized=true;await service.deliver(job);assert.equal(sends,1);assert.ok(updates.at(-1).nextAttempt instanceof Date);
  response={status:200};await service.deliver(job);assert.equal(updates.at(-2).alertSent,true);assert.equal(updates.at(-1).status,'done');
  await service.deliver({...job,alertSent:true});assert.equal(sends,2);
  response={status:403,reason:'InvalidProviderToken'};await service.deliver(job);assert.equal(updates.at(-1).status,'failed');
  response={status:410,reason:'Unregistered'};await service.deliver(job);assert.equal(registration,null);
});

test('remote attention activities retain priority above ordinary running tasks',async()=>{
  const {IosPushService}=await import('../server/ios-push.mjs');
  const key=randomBytes(32),route='c'.repeat(64),requests=[];
  const registration={environment:'sandbox',tokens:tokenBox(key,{token:'ab'.repeat(32),activities:[{route,token:'cd'.repeat(32)}]},'browser')};
  const db={collection(name){return {async findOne(){return name==='relay_ios_push_registrations'?registration:{};},async updateOne(){}};}};
  const service=new IosPushService(db,{sandbox:{async send(request){requests.push(request);return {status:200};}}},key);
  const job={_id:'d'.repeat(64),deviceId:'dev',browserId:'browser',generation:'g',attempts:1,alertSent:true,push:{alert:true,activity_route:route,operation:'update',envelope:{aad:Buffer.from(JSON.stringify({created_at:new Date(now).toISOString()})).toString('base64url')},expires_at:now+120000}};
  await service.deliver(job);assert.equal(requests[0].payload.aps['relevance-score'],100);
  await service.deliver({...job,push:{...job.push,alert:false}});assert.equal(requests[1].payload.aps['relevance-score'],50);
});
