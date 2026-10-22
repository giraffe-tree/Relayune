import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const directory=mkdtempSync(join(tmpdir(),'relayune-log-auth-'));
const outfile=join(directory,'api.cjs');
await build({stdin:{contents:'export {EmailAuth} from "./server/email-auth.ts"; export {FeedbackApi} from "./server/feedback-api.ts"; export * from "./server/request-log.mjs";',resolveDir:process.cwd()},outfile,bundle:true,platform:'node',format:'cjs'});
const {EmailAuth,FeedbackApi,runRequestLog,userReference}=createRequire(import.meta.url)(outfile);
test.after(()=>rmSync(directory,{recursive:true,force:true}));
const identity={version:'v1',key:Buffer.alloc(32,7)};
function res(){return Object.assign(new EventEmitter(),{statusCode:200,writableFinished:true});}

test('actual session authentication marks only a verified session account',async()=>{
  for(const valid of [true,false]){
    const db={collection(name){assert.ok(['auth_sessions','auth_users'].includes(name));return{
      async findOne(){return valid?(name==='auth_users'?{_id:'alice@example.com'}:{email:'alice@example.com',expires_at:new Date(Date.now()+30*86400000)}):null;},
    };}};
    const auth=new EmailAuth(db,{publicOrigin:'https://relayune.test',mailFrom:'test@relayune.test'});
    const request={method:'GET',url:'/api/account/agent-order',headers:{cookie:'relay_session='+'a'.repeat(43)}};
    const response=res(),rows=[];
    await runRequestLog(request,response,()=>auth.authenticate(request),{identity,write:row=>rows.push(row)});
    response.emit('finish');
    assert.equal(rows[0].auth_type,valid?'email_session':'anonymous');
    assert.equal(rows[0].user_ref,valid?userReference('alice@example.com',identity):undefined);
  }
});

test('actual feedback device authentication resolves the same account ref; invalid token stays anonymous',async()=>{
  for(const valid of [true,false]){
    const db={collection(name){return{async findOne(){
      if(name==='relay_devices')return valid?{user_id:'usr_owner'}:null;
      if(name==='relay_users')return{email:'alice@example.com'};
      throw new Error('unexpected lookup');
    }};}};
    const api=new FeedbackApi(db,'https://relayune.test');
    // GET stops at method validation after auth, avoiding any feedback writes.
    const request=new Request('https://relayune.test/api/feedback',{headers:{authorization:'Bearer '+'a'.repeat(43)}});
    const response=res(),rows=[];
    await runRequestLog({method:'GET',url:'/api/feedback'},response,async()=>{
      const result=await api.handle(request,null);response.statusCode=result.status;
    },{identity,write:row=>rows.push(row)});
    response.emit('finish');
    assert.equal(rows[0].status,valid?405:401);
    assert.equal(rows[0].user_ref,valid?userReference('alice@example.com',identity):undefined);
    assert.equal(rows[0].auth_type,valid?'device_token':'anonymous');
  }
});
