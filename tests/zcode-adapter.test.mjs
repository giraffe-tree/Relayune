import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {ZCodeAdapter, zcodeHistory} from '../relay/zcode-adapter.mjs';
import {MultiAgentAdapter} from '../relay/multi-agent-adapter.mjs';
const fixture=fileURLToPath(new URL('./fixtures/fake-zcode-app-server.mjs',import.meta.url));
const create=()=>new ZCodeAdapter({zcodeBin:process.execPath,zcodeArgs:[fixture]});
async function waitFor(predicate){for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}assert.fail('No expected ZCode event');}
test('ZCode routes sessions, history, image input, one-time approvals and text through the multi-agent adapter',async()=>{
 const zcode=create(), adapter=new MultiAgentAdapter({adapters:{zcode},defaultProvider:'zcode'}), events=[],approvals=[];
 try{
  await adapter.start({emitEvent:async(_,e)=>events.push(e),requestApproval:async a=>approvals.push(a)});
  const [session]=await adapter.listSessions();assert.equal(session.id,'zcode:sess_fixture');
  assert.equal((await adapter.createSession({provider:'zcode',cwd:process.cwd()})).provider,'zcode');
  const history=await adapter.readHistory({sessionId:session.id,limit:1});
  assert.deepEqual(history.messages.map(m=>m.content),['Answer']);assert.equal(history.has_more,true);
  const older=await adapter.readHistory({sessionId:session.id,before:history.next_cursor});assert.equal(older.messages[0].content,'Question');
  await adapter.submitMessage({sessionId:session.id,content:'test',attachments:[{name:'test.png',mime_type:'image/png',base64:'aGVsbG8='}]});
  await waitFor(()=>approvals.length===1);
  assert.equal(approvals[0].provider,'zcode');assert.match(approvals[0].approval_id,/^apr_zcode_/);
  await assert.rejects(adapter.submitMessage({sessionId:session.id,content:'again'}),/active ZCode/);
  await adapter.resolveApproval({approvalId:approvals[0].approval_id,decision:'approved'});
  await waitFor(()=>events.some(e=>e.kind==='turn.completed'));
  assert.ok(events.every(e=>e.provider==='zcode'));assert.ok(events.some(e=>e.text==='Allowed'));
  assert.doesNotMatch(JSON.stringify(events),/private reasoning/);
  assert.equal(events.filter(e=>e.kind==='turn.thinking'&&e.active).length,1);
  assert.equal((await adapter.listSessions())[0].can_interrupt,false);
 }finally{await adapter.close();}
});
test('ZCode stop clears pending permissions and marks the turn interrupted',async()=>{
 const adapter=create(),events=[],approvals=[];
 try{
 await adapter.start({emitEvent:async(_,e)=>events.push(e),requestApproval:async a=>approvals.push(a)});
 const [s]=await adapter.listSessions();await adapter.submitMessage({sessionId:s.id,content:'test'});
 await waitFor(()=>approvals.length===1);await adapter.interruptTurn({sessionId:s.id});
 await waitFor(()=>events.some(e=>e.kind==='turn.completed'&&e.status==='interrupted'));
 assert.equal(adapter.approvals.size,0);
 await assert.rejects(adapter.resolveApproval({approvalId:approvals[0].approval_id,decision:'approved'}),/no longer pending/);
 }finally{await adapter.close();}
});
test('ZCode history excludes model-only inputs, synthetic messages and reasoning',()=>{
 assert.deepEqual(zcodeHistory([{info:{role:'user',visibility:'model-only'},parts:[{type:'text',text:'internal'}]},{info:{role:'user',synthetic:true},parts:[{type:'text',text:'internal'}]},{info:{role:'assistant'},parts:[{type:'reasoning',text:'internal'}]}]),[]);
});
test('missing ZCode executable rejects startup and releases pending requests',async()=>{
 const adapter=new ZCodeAdapter({zcodeBin:'/nonexistent/relayune-zcode'});
 await assert.rejects(adapter.start({emitEvent:async()=>{},requestApproval:async()=>{}}));assert.equal(adapter.pending.size,0);
});
