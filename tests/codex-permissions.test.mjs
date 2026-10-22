import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:net';
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopFrameDecoder, desktopStartMessage, desktopInterruptTurn, desktopSubmitMessage, desktopPermissions, desktopRuntime, desktopAnswerQuestion, desktopPendingApprovals, desktopResolveApproval } from '../relay/codex-desktop-settings.mjs';
import { hashAction } from '../relay/protocol.mjs';
import { permissionConfig, permissionMode, permissionSettings } from '../relay/codex-permissions.mjs';
import { CodexAppServerAdapter } from '../relay/codex-adapters.mjs';
const id = '00000000-0000-0000-0000-000000000001';
const initial = permissionSettings('default', null, '/workspace');

async function ipcFixture(t, {deny = false, stale = false, running = false, version = 11, runtimeType, missingPermissions = false, silentSnapshot = false, denySteer = false, denyStart = false, stopSettles = true, noOwner = false, turns = [{secret: 'never returned'}], turnHistory, collaborationMode, nativeRequests = []} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'codex-settings-'));
  await chmod(dir, 0o700);
  const path = join(dir, 'ipc.sock');
  const requests = [];
  let actual = structuredClone(initial);
  let stopped = false;
  const sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0), followed = false;
    const send = message => {
      const body = Buffer.from(JSON.stringify(message)), head = Buffer.alloc(4); head.writeUInt32LE(body.length);
      // Exercise partial headers and split frames.
      socket.write(head.subarray(0, 2)); socket.write(Buffer.concat([head.subarray(2), body]));
    };
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE()) {
        const n = buffer.readUInt32LE(), m = JSON.parse(buffer.subarray(4, 4+n)); buffer = buffer.subarray(4+n);
        if (m.type === 'request') {
          requests.push(m);
          if (noOwner && m.method === 'thread-owner-discovery') {
            send({ type: 'response', requestId: m.requestId, resultType: 'error', error: 'no-client-found' });
            continue;
          }
          if (m.method === 'thread-follower-interrupt-turn' && stopSettles) stopped = true;
          const denied = ((deny || m.version !== 3) && m.method === 'thread-follower-update-thread-settings') || (denySteer && m.method === 'thread-follower-steer-turn') || (denyStart && m.method === 'thread-follower-start-turn');
          if (m.method === 'thread-follower-update-thread-settings' && !deny && !stale) actual = m.params.threadSettings;
          send({type:'response',requestId:m.requestId,method:m.method,resultType:denied?'error':'success',handledByClientId:m.method==='initialize'?'client':'owner',result:m.method==='initialize'?{clientId:'client'}:m.method==='thread-follower-start-turn'?{result:{turn:{id:'new-native-turn'}}}:m.method==='thread-follower-interrupt-turn'?{ok:true,interruptedTurnId:m.params.expectedTurnId}:{ok:true}});
        } else if (m.params?.following && !silentSnapshot && !followed) {
          followed = true;
          send({type:'broadcast',method:'thread-stream-state-changed',version,sourceClientId:'owner',params:{hostId:'local',conversationId:id,change:{type:'snapshot',conversationState:{cwd:'/workspace',latestThreadSettings:missingPermissions ? null : actual,currentPermissions:initial,latestCollaborationMode:collaborationMode,threadRuntimeStatus:{type:stopped ? 'idle' : runtimeType ?? (running?'active':'idle')},turns,turnHistory,requests:nativeRequests}}}});
        }
      }
    });
  });
  await new Promise(resolve => server.listen(path, resolve)); await chmod(path, 0o600);
  t.after(async () => { for(const socket of sockets) socket.destroy(); await new Promise(resolve=>server.close(resolve)); await rm(dir,{recursive:true,force:true}); });
  return { requests, start: message => desktopStartMessage(id, message, {socketPath:path,timeoutMs:500}), stop: () => desktopInterruptTurn(id, {socketPath:path,timeoutMs:500,settleTimeoutMs:200}), submit: message => desktopSubmitMessage(id, message, {socketPath:path,timeoutMs:500}), pendingApprovals: () => desktopPendingApprovals(id,{socketPath:path,timeoutMs:500}),
    decide: reply => desktopResolveApproval(id,reply,{socketPath:path,timeoutMs:500}), answer: reply => desktopAnswerQuestion(id, reply, {socketPath:path,timeoutMs:500}), owner: settings => desktopPermissions(id, settings, {socketPath:path,timeoutMs:500,ownershipOnly:true}), runtime: () => desktopRuntime(id, {socketPath:path,timeoutMs:500}), run: settings => desktopPermissions(id, settings, {socketPath:path,timeoutMs:500}) };
}

test('Desktop IPC routes to owner and reads back settings, retaining no conversation data', async t => {
  const f = await ipcFixture(t);
  const desired = permissionSettings('auto', initial, '/workspace');
  const result = await f.run(desired);
  assert.equal(permissionMode(result),'auto'); assert.equal(permissionMode(result.current),'default');
  assert.equal(JSON.stringify(result).includes('secret'),false);
  const update = f.requests.find(r=>r.method==='thread-follower-update-thread-settings');
  assert.equal(update.version,3); assert.equal(update.targetClientId,'owner'); assert.equal(update.hostId,'local');
  assert.deepEqual(update.params,{conversationId:id,threadSettings:desired});
});
test('Desktop denial and unsupported stream versions do not claim success', async t => {
  const denied = await ipcFixture(t,{deny:true}); await assert.rejects(denied.run(initial));
  const unsupported = await ipcFixture(t,{version:12}); await assert.rejects(unsupported.run());
});
test('Desktop running session cannot change permissions',async t=>{
  const f=await ipcFixture(t,{running:true}); await assert.rejects(f.run(initial),/正在运行/);
  assert.equal(f.requests.some(r=>r.method==='thread-follower-update-thread-settings'),false);
});
test('unconfirmed or custom permissions never masquerade as defaults',()=>{
  assert.equal(permissionConfig(null).currentValue,'unknown'); assert.deepEqual(permissionConfig(null).options,[]);
  assert.equal(permissionMode({...initial,sandboxPolicy:{type:'readOnly'}}),'custom');
  assert.equal(permissionMode(permissionSettings('full',initial,'/workspace')),'full');
  assert.equal(permissionSettings('manual',initial,'/workspace').approvalPolicy,'untrusted');
  assert.throws(()=>permissionSettings('anything',initial,'/workspace'));
});
function adapterFixture() {
  const adapter = new CodexAppServerAdapter({workspace:'/workspace'});
  adapter.handlers={emitEvent:async()=>{}};
  adapter.threadMetadata.set(id,{id,cwd:'/workspace',status:{type:'idle'}});
  let actual=structuredClone(initial);
  adapter.readDesktopPermissions=async(_,settings)=>settings ? actual=structuredClone(settings) : actual;
  return adapter;
}
test('permissions are session scoped, verified and never written to global config',async()=>{
  const a=adapterFixture();
  const result=await a.configureSession({sessionId:id,configId:'permissions',value:'auto'});
  assert.equal(result.configOptions.find(x=>x.id==='permissions').currentValue,'auto');
  assert.equal(a.configOptionsForThread('other').find(x=>x.id==='permissions').currentValue,'unknown');
  assert.deepEqual(a.turnSettingsParams(id),{});
});
test('stale or policy-clamped readback cannot report selected mode',async()=>{
  const a=adapterFixture(); a.readDesktopPermissions=async()=>initial;
  await assert.rejects(a.configurePermissions(id,'full'),/实际权限/);
  assert.equal(permissionMode(a.threadPermissions.get(id)),'default');
});
test('relay-owned thread confirms authoritative settings notification after update',async()=>{
  const a=adapterFixture(); a.resumedThreads.add(id); let actual=initial; const calls=[];
  a.modelCatalog=[]; a.request=async(method,params)=>{calls.push(method);if(method==='thread/settings/update'){actual=params;await a.handleNotification({method:'thread/settings/updated',params:{threadId:id,threadSettings:actual}});return {};}return {...actual,sandbox:actual.sandboxPolicy};};
  await a.configurePermissions(id,'manual');
  assert.deepEqual(calls,['thread/resume','thread/settings/update']);
  assert.equal(permissionMode(a.threadPermissions.get(id)),'manual');
});
test('invalid, running and subagent requests are rejected before mutation',async()=>{
  const a=adapterFixture(); let calls=0; a.readDesktopPermissions=async()=>{calls++;return initial;};
  await assert.rejects(a.configurePermissions(id,'bogus'));
  a.activeTurns.set(id,'turn'); await assert.rejects(a.configurePermissions(id,'full')); a.activeTurns.clear();
  a.threadMetadata.get(id).parentThreadId='parent'; await assert.rejects(a.configurePermissions(id,'full'));
  assert.equal(calls,0);
});


test('history permission reads never resume dormant or unconfirmed owned sessions', async () => {
  for (const owned of [false, true]) {
    const a = adapterFixture();
    a.readDesktopPermissions = async () => { throw new Error('no owner'); };
    if (owned) a.resumedThreads.add(id);
    const calls = [];
    a.request = async (method, params) => { calls.push({method, params}); throw new Error('read must not request a writer'); };
    await a.refreshPermissions(id);
    assert.deepEqual(calls, []);
    assert.equal(a.threadPermissions.has(id), false);
    assert.equal(a.resumedThreads.has(id), owned);
  }
});

test('catalog retries failed permission reads without blocking, duplicating or acquiring a writer', async () => {
  const a = adapterFixture();
  a.loadModelCatalog = async () => [];
  const calls = [];
  a.request = async method => {
    calls.push(method);
    assert.equal(method, 'thread/list');
    return {data: [{id, cwd: '/workspace', status: {type: 'idle'}}]};
  };
  let reads = 0;
  a.readDesktopPermissions = async () => { reads++; throw new Error('no owner'); };
  await a.refreshPermissions(id);
  assert.equal(a.threadPermissions.has(id), false);
  await a.listSessions();
  assert.equal(reads, 1, 'failed reads still respect the retry interval');

  let release;
  a.readDesktopPermissions = () => { reads++; return new Promise(resolve => {release = resolve;}); };
  a.permissionRefreshAt.set(id, Date.now() - 30_001);
  const sessions = await a.listSessions();
  assert.equal(sessions[0].session_config_options.find(x => x.id === 'permissions').currentValue, 'unknown');
  assert.equal(reads, 2);
  a.permissionRefreshAt.set(id, Date.now() - 30_001);
  await a.listSessions();
  a.refreshHistoryPermissions(id);
  assert.equal(reads, 2, 'catalog and history share one pending IPC read');
  release(initial);
  await Promise.all(a.historyPermissionRefreshes.values());
  assert.equal(permissionMode(a.threadPermissions.get(id)), 'default');
  assert.equal(a.historyPermissionRefreshes.size, 0);
  assert.equal(a.resumedThreads.has(id), false);
  assert.ok(calls.every(method => method === 'thread/list'));
});


test('owner runtime read is independent of settings and exposes no conversation data', async t => {
  const f = await ipcFixture(t, { missingPermissions: true });
  assert.deepEqual(await f.runtime(), { type: 'idle' });
  assert.equal(f.requests.some(r => r.method === 'thread-follower-update-thread-settings'), false);
});

test('unknown owner runtime is not interpreted as idle', async t => {
  const f = await ipcFixture(t, { runtimeType: 'unknown' });
  await assert.rejects(f.runtime());
});


test('send ownership discovery does not wait for a dormant Desktop snapshot', async t => {
  const f = await ipcFixture(t, {silentSnapshot: true});
  assert.deepEqual(await f.owner(), {owned: true});
  assert.deepEqual(f.requests.map(r => r.method), ['initialize', 'thread-owner-discovery']);
  await assert.rejects(f.owner(initial), /cannot update permissions/);
  await assert.rejects(f.run(), /无法确认/);
});

test('reselecting the confirmed permission mode does not wait for a nonexistent change notification', async () => {
  const a = adapterFixture();
  a.resumedThreads.add(id);
  a.threadPermissions.set(id, initial);
  a.request = async () => { throw new Error('unchanged mode must not issue an update'); };
  const result = await a.configurePermissions(id, 'default');
  assert.equal(result.configOptions.find(x => x.id === 'permissions').currentValue, 'default');
  assert.equal(a.permissionUpdateWaiters.size, 0);
});

 test('explicit owner absence is available only to read-only runtime probes', async t => {
  const f = await ipcFixture(t, { noOwner: true });
  assert.deepEqual(await f.runtime(), { type: 'notOwned' });
  await assert.rejects(f.owner());
  await assert.rejects(f.run(initial));
});

const asyncReply = {turnId:'turn-1',itemId:'call-1',index:0,question:'Color?',answer:'Blue',clientMessageId:'answer-1'};
const questionTurns = [{turnId:'turn-1',status:'inProgress',items:[{id:'call-1',type:'agentMessage',questions:[{title:'Color?',options:['Blue']}]}]}];
test('Desktop async answer verifies native question and steers the owner with host protocol version', async t => {
  const f = await ipcFixture(t,{running:true,turns:questionTurns});
  assert.deepEqual(await f.answer(asyncReply),{accepted:true});
  const steer=f.requests.find(r=>r.method==='thread-follower-steer-turn');
  assert.equal(steer.version,2); assert.equal(steer.targetClientId,'owner');
  assert.equal(steer.params.clientUserMessageId,'answer-1');
  assert.match(steer.params.input[0].text,/request_user_input_async/);
});
test('Desktop does not send answers to ended, replaced or already answered questions', async t => {
  for (const config of [
    {running:false,turns:questionTurns},
    {running:true,turns:[]},
    {running:true,turns:[{...questionTurns[0],status:'interrupted'}]},
    {running:true,turns:[{...questionTurns[0],items:[...questionTurns[0].items,{type:'userMessage',content:[{text:'<send_user_message_question_reply>\n'+JSON.stringify([{questionItemId:JSON.stringify(['request_user_input_async','call-1',0]),question:'Color?',answer:'Red'}])+'\n</send_user_message_question_reply>'}]}]}]},
  ]) {
    const f=await ipcFixture(t,config);
    await assert.rejects(f.answer(asyncReply),/no longer pending/);
    assert.equal(f.requests.some(r=>r.method==='thread-follower-steer-turn'),false);
  }
});

test('Desktop canonical paginated history supports a question while legacy turns is empty', async t => {
  const f=await ipcFixture(t,{running:true,turns:[],turnHistory:{kind:'canonical',history:{
    entitiesByKey:{current:questionTurns[0]},islands:[{entries:[{value:'current'}]}],
  }}});
  assert.deepEqual(await f.answer(asyncReply),{accepted:true});
  assert.equal(f.requests.filter(r=>r.method==='thread-follower-steer-turn').length,1);
});

const nativeApproval = {id:102,method:'item/commandExecution/requestApproval',params:{threadId:id,turnId:'turn-1',command:'printf test > qa.txt',cwd:'/workspace',availableDecisions:['accept','cancel']}};
test('Desktop approval is read narrowly and verifies the exact native command before deciding', async t => {
  const f=await ipcFixture(t,{running:true,nativeRequests:[nativeApproval,{id:103,method:'unsupported',params:{threadId:id}}]});
  assert.deepEqual(await f.pendingApprovals(),[nativeApproval]);
  const reply={requestId:102,method:nativeApproval.method,paramsHash:hashAction(nativeApproval.params),decision:'accept'};
  await assert.rejects(f.decide({...reply,paramsHash:'changed'}),/changed/);
  await assert.rejects(f.decide({...reply,decision:'decline'}),/changed/);
  await f.decide(reply);
  const calls=f.requests.filter(r=>r.method==='thread-follower-command-approval-decision');
  assert.equal(calls.length,1); assert.equal(calls[0].version,2); assert.equal(calls[0].targetClientId,'owner');
  assert.deepEqual(calls[0].params,{conversationId:id,requestId:102,decision:'accept'});
  assert.throws(()=>f.decide({...reply,decision:'acceptForSession'}),/Invalid/);
});
test('permission readback uses a fresh subscription when Desktop coalesces following toggles',async t=>{
  const f=await ipcFixture(t); await f.run(permissionSettings('manual',initial,'/workspace'));
  assert.equal(f.requests.filter(r=>r.method==='initialize').length,2);
});

test('completed native async question validates for the durable next-turn queue without steering idle owner', async t => {
  const f=await ipcFixture(t,{running:false,turns:[{...questionTurns[0],status:'completed'}]});
  const result=await f.answer(asyncReply);
  assert.equal(result.awaitingNewTurn,true);
});


test('Desktop messages steer active owner with exact message ID and attachments', async t => {
  const f = await ipcFixture(t, {running:true, missingPermissions:true});
  const message = {content:'追加要求', clientMessageId:'mobile-1', input:[{type:'text',text:'追加要求'}, {type:'image',url:'data:image/png;base64,cG5n'}]};
  assert.deepEqual(await f.submit(message), {accepted:true});
  const request = f.requests.find(r => r.method === 'thread-follower-steer-turn');
  assert.equal(request.version, 2);
  assert.equal(request.targetClientId, 'owner');
  assert.equal(request.params.clientUserMessageId, message.clientMessageId);
  assert.deepEqual(request.params.input, message.input);
});
test('idle or silent Desktop owners retain queue fallback without steering', async t => {
  for (const options of [{running:false}, {silentSnapshot:true}]) {
    const f = await ipcFixture(t, options);
    assert.deepEqual(await f.submit({content:'next',clientMessageId:'m',input:[]}), {awaitingNewTurn:true});
    assert.equal(f.requests.some(r => r.method === 'thread-follower-steer-turn'), false);
  }
});

test('Desktop steering refusal does not claim acceptance or select queue fallback', async t => {
  const f = await ipcFixture(t, {running:true, denySteer:true});
  await assert.rejects(f.submit({content:'追加',clientMessageId:'m',input:[{type:'text',text:'追加'}]}));
  assert.equal(f.requests.filter(r => r.method === 'thread-follower-steer-turn').length, 1);
});


test('unversioned unloaded Desktop snapshot permits continuation with inherited message settings', async t => {
  const f = await ipcFixture(t, {runtimeType:'notLoaded', turnHistory:{kind:'canonical',history:{
    islands:[{entries:[{value:'tail'}]}], entitiesByKey:{tail:{turnId:'finished',status:'completed'}},
  }}});
  assert.deepEqual(await f.stop(), {turnId:null});
  await f.start({input:[{type:'text',text:'next'}],clientMessageId:'next',runtimeSettings:{permissions:'manual'}});
  const start=f.requests.find(r=>r.method==='thread-follower-start-turn');
  assert.equal(start.params.turnStart.request.approvalPolicy,'untrusted');
  assert.equal(f.requests.some(r=>r.method==='thread-follower-interrupt-turn'),false);
  assert.deepEqual(await f.submit({content:'queue',input:[],clientMessageId:'q'}),{awaitingNewTurn:true});
});

test('desktop stop uses the exact canonical turn and host protocol v5, then confirms idle', async t => {
  const f=await ipcFixture(t,{running:true,missingPermissions:true,turnHistory:{kind:'canonical',history:{islands:[{entries:[{value:'a'}]}],entitiesByKey:{a:{turnId:'active-turn',status:'inProgress'}}}}});
  assert.deepEqual(await f.stop(),{turnId:'active-turn'});
  const r=f.requests.find(r=>r.method==='thread-follower-interrupt-turn');
  assert.equal(r.version,5); assert.equal(r.targetClientId,'owner');
  assert.deepEqual(r.params,{conversationId:id,mode:'user-stop',expectedTurnId:'active-turn'});
});

test('stop acknowledgement without idle is not completion', async t=>{
  const f=await ipcFixture(t,{running:true,stopSettles:false,turns:[{id:'t',status:'inProgress'}]});
  await assert.rejects(f.stop(),/stop could not be confirmed/);
});


test('desktop continuation starts natively with original input, message ID and inherited settings',async t=>{
  const f=await ipcFixture(t,{missingPermissions:true});
  const input=[{type:'text',text:'new instruction'}, {type:'image',url:'data:image/png;base64,cG5n'}];
  const r=await f.start({input,clientMessageId:'mobile-new'});
  assert.equal(r.turnId,'new-native-turn');
  const request=f.requests.find(r=>r.method==='thread-follower-start-turn');
  assert.equal(request.version,3);assert.equal(request.targetClientId,'owner');
  assert.deepEqual(request.params.turnStart,{request:{threadId:id,input,clientUserMessageId:'mobile-new'},context:{inheritThreadSettings:true}});
});

test('a newly running desktop owner cannot be overwritten by replacement start',async t=>{
  const f=await ipcFixture(t,{running:true});
  await assert.rejects(f.start({input:[],clientMessageId:'m'}),/still running/);
  assert.equal(f.requests.some(r=>r.method==='thread-follower-start-turn'),false);
});


test('Desktop start applies message settings while preserving native collaboration mode instructions',async t=>{
  const mode={mode:'plan',settings:{model:'old',reasoning_effort:'low',developer_instructions:'preserve-native-mode'}};
  const f=await ipcFixture(t,{collaborationMode:mode});
  await f.start({input:[{type:'text',text:'continue'}],clientMessageId:'m',runtimeSettings:{model:'next',effort:'high'}});
  const request=f.requests.find(r=>r.method==='thread-follower-start-turn').params.turnStart;
  assert.equal(request.request.model,'next');assert.equal(request.request.effort,'high');
  assert.deepEqual(request.request.collaborationMode,{mode:'plan',settings:{model:'next',reasoning_effort:'high',developer_instructions:'preserve-native-mode'}});
  assert.deepEqual(request.context,{inheritThreadSettings:true});
  assert.equal(f.requests.some(r=>r.method==='thread-follower-update-thread-settings'),false);
});

test('Desktop message settings cannot smuggle permission changes',async t=>{
  const f=await ipcFixture(t);
  assert.throws(()=>f.start({input:[],runtimeSettings:{model:'next',approvalPolicy:'never'}}),/Invalid/);
  assert.equal(f.requests.length,0);
});

for(const mode of ['default','manual','auto','full']) {
  test(`Desktop start carries permission mode ${mode} with message instead of updating settings`,async t=>{
    const f=await ipcFixture(t,{collaborationMode:{mode:'plan',settings:{model:'old',reasoning_effort:'low',developer_instructions:'keep'}}});
    await f.start({input:[{type:'text',text:'next'}],runtimeSettings:{permissions:mode}});
    const p=f.requests.find(r=>r.method==='thread-follower-start-turn').params.turnStart.request;
    const expected=permissionSettings(mode,initial,'/workspace');
    for(const key of Object.keys(expected)) assert.deepEqual(p[key],expected[key]);
    assert.equal(p.model,undefined);assert.equal(p.collaborationMode,undefined);
    assert.equal(p.permissions,undefined);
    assert.equal(f.requests.some(r=>r.method==='thread-follower-update-thread-settings'),false);
  });
}
test('Desktop permission-only selection rejects unconfirmed state and native denial',async t=>{
  const missing=await ipcFixture(t,{missingPermissions:true});
  await assert.rejects(missing.start({input:[],runtimeSettings:{permissions:'full'}}));
  assert.equal(missing.requests.some(r=>r.method==='thread-follower-start-turn'),false);
  const denied=await ipcFixture(t,{denyStart:true});
  await assert.rejects(denied.start({input:[],runtimeSettings:{permissions:'full'}}));
  assert.equal(denied.requests.filter(r=>r.method==='thread-follower-start-turn').length,1);
  assert.equal(denied.requests.some(r=>r.method==='thread-follower-update-thread-settings'),false);
});
test('Desktop message rejects unsupported permission modes and raw sandbox injection',async t=>{
  const f=await ipcFixture(t);
  for(const runtimeSettings of [{permissions:'bad'},{permissions:'full',sandboxPolicy:{type:'dangerFullAccess'}},{permissions:'full',effort:'high'}])
    assert.throws(()=>f.start({input:[],runtimeSettings}),/Invalid/);
  assert.equal(f.requests.length,0);
});


test('Desktop frame decoder accepts a 46 MiB snapshot in bounded chunks', () => {
  const decode = createDesktopFrameDecoder();
  const payload = { history: 'x'.repeat(46 * 1024 * 1024), runtime: 'idle' };
  const body = Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
  assert.deepEqual([...decode(header.subarray(0, 2))], []);
  assert.deepEqual([...decode(header.subarray(2))], []);
  const frames = [];
  for (let offset = 0; offset < body.length; offset += 65536) {
    frames.push(...decode(body.subarray(offset, offset + 65536)));
  }
  assert.equal(frames.length, 1);
  assert.equal(frames[0].history.length, payload.history.length);
  assert.equal(frames[0].runtime, 'idle');
  const next = Buffer.from('{}');
  header.writeUInt32LE(next.length);
  assert.deepEqual([...decode(Buffer.concat([header, next, header, next]))], [{}, {}]);
});

test('Desktop frame decoder rejects oversized frames from the header alone', () => {
  const header = Buffer.alloc(4); header.writeUInt32LE(64 * 1024 * 1024 + 1);
  assert.throws(() => [...createDesktopFrameDecoder()(header)], /64 MiB/);
});
