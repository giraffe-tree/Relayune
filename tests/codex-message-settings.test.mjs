import test from 'node:test';
import assert from 'node:assert/strict';
import { permissionSettings } from '../relay/codex-permissions.mjs';
import { CodexAppServerAdapter } from '../relay/codex-adapters.mjs';

function fixture() {
  const adapter = new CodexAppServerAdapter({workspace:'/tmp/model-test'});
  adapter.modelCatalog = [
    {model:'first',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]},
    {model:'next',defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'}]},
  ];
  adapter.handlers = {emitEvent:async()=>{}};
  adapter.verifyUserMessage = async()=>true;
  const requests=[];
  adapter.request=async(method,params)=>{requests.push({method,params});return {turn:{id:'new'}};};
  return {adapter,requests};
}
const message = () => ({sessionId:'S',clientMessageId:'m',content:'continue',interruptRunning:true,
  runtimeSettings:{model:'next',effort:'high'}});

test('message settings override stale resume values and start without a separate configuration',async()=>{
  const {adapter:a,requests}=fixture();
  a.readDesktopPermissions=async()=>{throw Error('no owner');};
  const request=a.request;
  a.request=async(method,params)=>method==='thread/resume'?{thread:{id:'S',status:{type:'idle'}},model:'first',reasoningEffort:'low'}:request(method,params);
  const result=await a.submitMessage(message());
  assert.equal(result.mode,'started');
  const start=requests.find(r=>r.method==='turn/start').params;
  assert.equal(start.model,'next');assert.equal(start.effort,'high');
  assert.equal(start.clientUserMessageId,'m');
  assert.equal(requests.some(r=>r.method==='thread/settings/update'),false);
  assert.equal(a.threadSettings('S').model,'next');
});

test('running replacement validates first and applies the message settings only after stop',async()=>{
  const {adapter:a,requests}=fixture();a.resumedThreads.add('S');a.activeTurns.set('S','old');
  let release;const stopped=new Promise(r=>{release=r;});
  a.interruptOwnedTurn=async()=>{await stopped;a.activeTurns.delete('S');};
  const sending=a.submitMessage(message());await new Promise(r=>setImmediate(r));
  assert.equal(requests.length,0);release();await sending;
  assert.equal(requests[0].method,'turn/start');assert.equal(requests[0].params.model,'next');
});

for(const runtimeSettings of [null,{},[],{model:'unknown'}, {model:'next',effort:'low'},
  {model:'next',approvalPolicy:'never'}, {model:'next',effort:null}]) {
  test(`invalid message settings fail before interrupt: ${JSON.stringify(runtimeSettings)}`,async()=>{
    const {adapter:a,requests}=fixture();a.resumedThreads.add('S');a.activeTurns.set('S','old');
    a.interruptOwnedTurn=async()=>assert.fail('invalid settings must not stop a turn');
    await assert.rejects(a.submitMessage({...message(),runtimeSettings}));
    assert.equal(requests.length,0);assert.equal(a.activeTurns.get('S'),'old');
  });
}

test('Desktop replacement receives exact model and effort without taking writer',async()=>{
  const {adapter:a,requests}=fixture();const calls=[];
  a.readDesktopPermissions=async()=>({owned:true});
  a.interruptDesktopTurn=async()=>{calls.push('stop');};
  a.startDesktopMessage=async(id,params)=>{calls.push({id,params});return {mode:'started',turnId:'native'};};
  await a.submitMessage(message());assert.equal(requests.length,0);
  assert.equal(calls[0],'stop');assert.deepEqual(calls[1].params.runtimeSettings,{model:'next',effort:'high'});
  assert.equal(a.threadSettings('S').effort,'high');
});

test('an unavailable Desktop owner cannot silently queue a message with model settings',async()=>{
  const {adapter:a}=fixture();a.readDesktopPermissions=async()=>{throw Error('no owner');};
  a.request=async()=>{throw Error('thread already has an active writer');};
  a.queueTracker.enqueue=async()=>assert.fail('queue loses settings');
  await assert.rejects(a.submitMessage(message()),/所选设置/);
});

test('a failed start does not commit requested settings or fall back to queue',async()=>{
  const {adapter:a}=fixture();a.resumedThreads.add('S');
  a.replaceThreadSettings('S',{model:'first',effort:'low'});
  a.request=async()=>{throw Error('start denied');};
  await assert.rejects(a.submitMessage(message()),/start denied/);
  assert.equal(a.threadSettings('S').model,'first');
});

test('steer cannot silently ignore per-message model settings',async()=>{
  const {adapter:a,requests}=fixture();a.resumedThreads.add('S');a.activeTurns.set('S','old');
  await assert.rejects(a.submitMessage({...message(),interruptRunning:false}),/new turn/);
  assert.equal(requests.length,0);
});

test('catalog advertises per-model effort choices and message capability',()=>{
  const {adapter:a}=fixture();const session=a.toRelaySession({id:'S',cwd:'/tmp',status:{type:'idle'}});
  assert.equal(session.supports_message_model_settings,true);
  assert.equal(session.supports_message_permission_settings,true);
  const next=session.session_config_options.find(x=>x.id==='model').options.find(x=>x.value==='next');
  assert.deepEqual(next.reasoningOptions.map(x=>x.value),['medium','high']);
  assert.equal(next.defaultReasoningEffort,'medium');
});

for (const mode of ['default', 'auto', 'manual', 'full']) {
  test(`message permission mode ${mode} applies at start, preserving authorized roots`, async () => {
    const {adapter:a,requests}=fixture(); a.resumedThreads.add('S');
    const current=permissionSettings('default', null, '/authorized');
    a.threadPermissions.set('S', current);
    a.loadModelCatalog=async()=>assert.fail('permission-only selection needs no model discovery');
    await a.submitMessage({...message(),runtimeSettings:{permissions:mode}});
    const params=requests.find(r=>r.method==='turn/start').params;
    assert.equal(params.permissions,undefined, 'UI mode is not a native named permission profile');
    const expected=permissionSettings(mode,current,'/tmp/model-test');
    for(const key of Object.keys(expected)) assert.deepEqual(params[key],expected[key]);
    assert.equal(params.model,undefined);
    assert.equal(requests.some(r=>r.method==='thread/settings/update'),false);
    assert.equal(a.threadSettings('S').permissions,undefined);
    assert.equal(a.threadPermissions.get('S'),current,'requested settings are not reported as confirmed permissions');
  });
}
for(const runtimeSettings of [{permissions:'bogus'}, {permissions:null}, {permissions:'full',sandboxPolicy:{type:'dangerFullAccess'}}, {permissions:'default',effort:'high'}]) {
  test(`invalid permission message fails before interrupt: ${JSON.stringify(runtimeSettings)}`, async()=>{
    const {adapter:a,requests}=fixture();a.resumedThreads.add('S');a.activeTurns.set('S','old');
    a.interruptOwnedTurn=async()=>assert.fail('invalid settings must not interrupt');
    await assert.rejects(a.submitMessage({...message(),runtimeSettings}));assert.equal(requests.length,0);
  });
}
test('unknown permissions and subagent preselection fail before stopping the owned turn',async()=>{
  const {adapter:a,requests}=fixture();a.resumedThreads.add('S');a.activeTurns.set('S','old');
  a.interruptOwnedTurn=async()=>assert.fail('must not interrupt');
  await assert.rejects(a.submitMessage({...message(),runtimeSettings:{permissions:'full'}}),/尚未确认/);
  a.threadMetadata.set('S',{parentThreadId:'parent'});
  await assert.rejects(a.submitMessage({...message(),runtimeSettings:{permissions:'full'}}),/主会话/);
  assert.equal(requests.length,0);
});
test('owned message carries model, effort and permissions together after interrupt',async()=>{
  const {adapter:a,requests}=fixture();a.resumedThreads.add('S');a.activeTurns.set('S','old');
  a.threadPermissions.set('S',permissionSettings('full',null,'/tmp/model-test'));
  a.interruptOwnedTurn=async()=>{assert.equal(requests.length,0);a.activeTurns.delete('S');};
  await a.submitMessage({...message(),runtimeSettings:{...message().runtimeSettings,permissions:'manual'}});
  const p=requests[0].params;assert.equal(p.model,'next');assert.equal(p.effort,'high');
  assert.equal(p.approvalPolicy,'untrusted');assert.equal(p.sandboxPolicy.type,'workspaceWrite');
});
