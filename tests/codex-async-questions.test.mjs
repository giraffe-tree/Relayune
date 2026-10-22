import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexAsyncQuestions, asyncAnswerText, asyncQuestionId } from '../relay/codex-async-questions.mjs';
import { CodexAppServerAdapter, codexRolloutActivityEvents } from '../relay/codex-adapters.mjs';

const source = {turnId:'turn-1',itemId:'call-1',questions:[{title:'Color?',options:['Blue','Red']},{title:'Why?',options:null}]};
function fixture() {
  const approvals=[], events=[], sent=[];
  let now=Date.now();
  const manager=new CodexAsyncQuestions({publish:async a=>approvals.push(a),emit:async(s,e)=>events.push([s,e]),send:async(...args)=>sent.push(args),now:()=>now});
  return {manager,approvals,events,sent,advance:ms=>{now+=ms;}};
}
test('native multi-question cards deduplicate, accept options/free text and reject double submission',async()=>{
  const f=fixture();
  await f.manager.observe('session',source,{cwd:'/workspace',rootSessionId:'root'});
  await f.manager.observe('session',source);
  assert.equal(f.approvals.length,2);
  assert.equal(f.approvals[0].root_session_id,'root');
  assert.equal(f.approvals[1].action.allows_freeform,true);
  const a={approvalId:f.approvals[0].approval_id,decision:'approved',optionId:'async_option_0'};
  const results=await Promise.allSettled([f.manager.resolve(a),f.manager.resolve(a)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(f.sent[0][1],'Blue');
  assert.match(f.sent[0][2],/send_user_message_question_reply/);
  await f.manager.resolve({approvalId:f.approvals[1].approval_id,decision:'approved',answer:' A reason '});
  assert.equal(f.sent[1][1],'A reason');
});
test('other-device replies and turn completion invalidate outstanding cards',async()=>{
  const f=fixture(); await f.manager.observe('session',source);
  await f.manager.observeAnswers('unrelated',asyncAnswerText([{questionItemId:asyncQuestionId('call-1',0),question:'Color?',answer:'Red'}]));
  assert.equal(f.events.length,0);
  await f.manager.observeAnswers('session',asyncAnswerText([{questionItemId:asyncQuestionId('call-1',0),question:'Color?',answer:'Red'}]));
  await f.manager.endTurn('session','turn-1');
  assert.deepEqual(f.events.map(([,e])=>e.decision),['approved','expired']);
  await assert.rejects(f.manager.resolve({approvalId:f.approvals[1].approval_id,decision:'approved',answer:'late'}),/no longer pending/);
});
test('expiry, invalid selections and uncertain delivery do not replay a decision',async()=>{
  const f=fixture(); await f.manager.observe('session',source);
  const a={approvalId:f.approvals[0].approval_id,decision:'approved',optionId:'missing'};
  await assert.rejects(f.manager.resolve(a),/Invalid/);
  f.manager.send=async()=>{throw new Error('transport closed');};
  a.optionId='async_option_0';
  await assert.rejects(f.manager.resolve(a),/transport closed/);
  await assert.rejects(f.manager.resolve(a),/no longer pending/);
  await f.manager.observe('session',{...source,answers:new Map([[0,'Blue']])});
  assert.equal(f.events[0][1].decision,'approved');
  f.advance(600001);
  await assert.rejects(f.manager.resolve({approvalId:f.approvals[1].approval_id,decision:'approved',answer:'late'}),/no longer pending/);
});
test('external rollouts expose only accepted native calls, recover answers, and expire at turn end',async()=>{
  const state={pendingCalls:new Map()}; const timestamp=new Date().toISOString();
  const feed=(type,payload)=>codexRolloutActivityEvents({type,payload,timestamp},state,{seed:true});
  feed('event_msg',{type:'task_started',turn_id:'turn-1'});
  feed('event_msg',{type:'agent_message',message:'Color? Blue or Red'});
  assert.equal(state.asyncQuestions.size,0);
  feed('response_item',{type:'function_call',name:'request_user_input_async',call_id:'call-1',arguments:JSON.stringify({questions:source.questions})});
  assert.equal(state.asyncQuestions.get('call-1').accepted,false);
  feed('response_item',{type:'function_call_output',call_id:'call-1',output:'{"accepted":true}'});
  const f=fixture(); await f.manager.observe('session',state.asyncQuestions.get('call-1'));
  assert.equal(f.approvals.length,2);
  feed('event_msg',{type:'user_message',message:asyncAnswerText([{questionItemId:asyncQuestionId('call-1',0),question:'Color?',answer:'Blue'}])});
  await f.manager.observe('session',state.asyncQuestions.get('call-1'));
  assert.equal(f.events[0][1].decision,'approved');
  feed('event_msg',{type:'task_complete',turn_id:'turn-1'});
  assert.equal(state.asyncQuestions.size,1);
  feed('event_msg',{type:'turn_aborted',turn_id:'turn-1'});
  assert.equal(state.asyncQuestions.size,0);
});
test('owned app-server questions steer the exact originating turn',async()=>{
  const a=new CodexAppServerAdapter({workspace:'/workspace'}), approvals=[], requests=[];
  a.handlers={requestApproval:async p=>approvals.push(p),emitEvent:async()=>{}};
  a.resumedThreads.add('session'); a.activeTurns.set('session','turn-1');
  a.request=async(method,params)=>{requests.push({method,params});return {};};
  await a.handleItem('session','turn-1',{id:'call-1',type:'agentMessage',text:'Color?',questions:[source.questions[0]]},true);
  assert.equal(approvals.length,1);
  await a.resolveApproval({approvalId:approvals[0].approval_id,decision:'approved',optionId:'async_option_0'});
  assert.equal(requests[0].method,'turn/steer');
  assert.equal(requests[0].params.expectedTurnId,'turn-1');
  assert.equal(requests[0].params.threadId,'session');
});

test('native history closes stale phone cards after reconnect, including resolutions before requests',async()=>{
  const f=fixture();
  const turns=[{id:'turn-1',status:'interrupted',items:[
    {type:'agentMessage',id:'call-1',questions:source.questions},
    {type:'userMessage',content:[{type:'text',text:asyncAnswerText([{questionItemId:asyncQuestionId('call-1',0),question:'Color?',answer:'Blue'}])}]},
  ]}];
  await f.manager.settleHistory('session',turns,'root');
  assert.deepEqual(f.events.map(([s,e])=>[s,e.decision]),[['root','approved'],['root','expired']]);
  await f.manager.observe('session',source);
  assert.equal(f.events[0][1].approval_id,f.approvals[0].approval_id);
  assert.equal(f.approvals.length,2);
});

test('external native command approvals publish once and confirm only after the native request disappears',async()=>{
  const a=new CodexAppServerAdapter({workspace:'/workspace'}), approvals=[], events=[], sent=[];
  a.handlers={requestApproval:async p=>approvals.push(p),emitEvent:async(s,e)=>events.push(e)};
  const native={id:42,method:'item/commandExecution/requestApproval',params:{threadId:'session',turnId:'turn-1',command:'printf test > qa.txt',availableDecisions:['accept','acceptForSession','cancel']}};
  let requests=[native];
  a.readDesktopApprovals=async()=>requests;
  a.answerDesktopApproval=async(s,r)=>sent.push(r);
  const thread={id:'session',cwd:'/workspace'},state={activeTurnId:'turn-1'};
  await a.syncDesktopApprovals(thread,state);
  state.desktopApprovalsCheckedAt=0;await a.syncDesktopApprovals(thread,state);
  assert.equal(approvals.length,1);
  assert.equal(approvals[0].action.options.some(o=>o.kind==='allow_always'),false);
  assert.equal(approvals[0].action.options.length,2);
  const option=approvals[0].action.options.find(o=>o.kind==='allow_once');
  const outcome=await a.resolveApproval({approvalId:approvals[0].approval_id,decision:'approved',optionId:option.option_id});
  assert.equal(outcome.confirmation,'serverRequest/resolved');
  assert.equal(sent[0].decision,'accept'); assert.equal(events.length,0);
  requests=[];state.desktopApprovalsCheckedAt=0;await a.syncDesktopApprovals(thread,state);
  assert.equal(events[0].decision,'approved'); assert.equal(a.pendingApprovals.size,0);
});

test('phone-created multi questions survive normal completion and answers resume the same conversation', async () => {
  const a=new CodexAppServerAdapter({workspace:'/workspace'}), approvals=[], events=[], requests=[];
  a.handlers={requestApproval:async p=>approvals.push(p),emitEvent:async(s,e)=>events.push(e)};
  a.resumedThreads.add('session');
  a.activeTurns.set('session','turn-1');
  a.request=async(method,params)=>{requests.push({method,params});return {turn:{id:'answer-turn'}};};
  await a.handleItem('session','turn-1',{id:'call-1',type:'agentMessage',questions:source.questions},true);
  await a.asyncQuestions.endTurn('session','turn-1','completed');
  a.activeTurns.delete('session');
  assert.equal(events.length,0);
  await Promise.all(approvals.map((q,i)=>a.resolveApproval({approvalId:q.approval_id,decision:'approved',answer:i?'A reason':'Blue'})));
  assert.deepEqual(requests.map(r=>r.method),['turn/start','turn/steer']);
  assert.equal(requests[1].params.expectedTurnId,'answer-turn');
  assert.ok(requests.every(r=>r.params.threadId==='session'));
  assert.match(requests[0].params.input[0].text,/Color/);
  assert.match(requests[1].params.input[0].text,/A reason/);
});

test('history recovers unexpired unanswered questions after normal completion, never resurrects interrupted ones', async () => {
  const f=fixture(); const turn={id:'turn-1',status:'completed',startedAt:Date.now()/1000,items:[
    {type:'agentMessage',id:'call-1',questions:source.questions},
    {type:'userMessage',content:[{text:asyncAnswerText([{questionItemId:asyncQuestionId('call-1',0),question:'Color?',answer:'Blue'}])}]},
  ]};
  await f.manager.settleHistory('session',[turn]);
  assert.equal(f.approvals.length,1);
  assert.equal(f.approvals[0].action.display,'Why?');
  assert.deepEqual(f.events.map(([,e])=>e.decision),['approved']);
  await f.manager.settleHistory('session',[{...turn,status:'interrupted'}]);
  assert.equal(f.events.at(-1)[1].decision,'expired');
});
