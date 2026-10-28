import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexAppServerAdapter } from '../relay/codex-adapters.mjs';
import { RelayOutbox } from '../relay/outbox.mjs';

const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));
const message = (id = 'm', text = 'same text') => ({ sessionId: 'S', requestId: 'req_' + id, clientMessageId: id, content: text });

async function fixture(t, { owned = true, outbox, dir } = {}) {
  dir ??= await mkdtemp(join(tmpdir(), 'codex-lifecycle-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'rollout.jsonl');
  await writeFile(path, JSON.stringify({ type: 'session_meta', payload: { id: 'S' } }) + '\n');
  outbox ??= new RelayOutbox(join(dir, 'outbox.json'));
  const a = new CodexAppServerAdapter({ workspace: dir, idleReleaseDelayMs: 60_000,
    desktopPermissions: async () => { throw Error('not owned by Desktop'); } });
  a.handlers = { emitEvent: async () => {}, requestApproval: async () => {},
    saveCodexMessageReceipt: r => outbox.saveCodexMessageReceipt(r),
    removeCodexMessageReceipt: r => outbox.removeCodexMessageReceipt(r),
    saveCodexQueueReceipt: r => outbox.saveCodexQueueReceipt(r),
    removeCodexQueueReceipt: r => outbox.removeCodexQueueReceipt(r) };
  a.messageSubmissions.restore(Object.values(outbox.codexMessageReceipts));
  await a.queueTracker.restore(Object.values(outbox.codexQueueReceipts));
  a.verifyUserMessage = async () => true;
  const state = { calls: [], queue: [], turns: [{ id: 'old', status: 'completed', items: [] }],
    nativeLoaded: owned, background: [], children: [], unsubscribed: gate(), failStart: null, blockRead: null };
  const thread = () => ({ id: 'S', path, status: { type: state.nativeLoaded ? 'idle' : 'notLoaded' }, turns: state.turns });
  const addTurn = (id, content) => {
    const turn = { id: 'turn_' + id, status: 'completed', items: [
      { type: 'userMessage', clientId: id, content: [{ type: 'text', text: content }] },
    ] };
    state.turns.push(turn); return turn;
  };
  a.request = async (method, params) => {
    state.calls.push({ method, params });
    if (method === 'thread/read') {
      if (state.blockRead) await state.blockRead.promise;
      const child = state.children.find(c => c.id === params.threadId);
      return { thread: child ? { ...child, turns: child.turns ?? [{ id:'child_turn', status:'completed', items:[] }] } : thread() };
    }
    if (method === 'thread/queue/list') return { data: state.queue };
    if (method === 'thread/queue/add') {
      const queued = { id: 'q_' + params.clientUserMessageId, clientUserMessageId: params.clientUserMessageId };
      state.queue.push(queued);return { queuedSubmission: queued };
    }
    if (method === 'thread/resume') {
      if (state.resumeError) throw state.resumeError;
      state.nativeLoaded = true;
      for (const queued of state.queue) addTurn(queued.clientUserMessageId, 'queued');
      state.queue = [];return { thread: thread() };
    }
    if (method === 'turn/start' || method === 'turn/steer') {
      const turn = addTurn(params.clientUserMessageId, params.input[0]?.text);
      if (state.failStart) throw state.failStart;
      return { turn };
    }
    if (method === 'thread/list') return { data: state.children };
    if (method === 'thread/backgroundTerminals/list') return { data: state.childBackground?.[params.threadId] ?? state.background };
    if (method === 'thread/loaded/list') return { data: state.nativeLoaded ? ['S'] : [] };
    if (method === 'thread/unsubscribe') { state.unsubscribed.resolve();return { status: 'unsubscribed' }; }
    throw Error('Unexpected test RPC: ' + method);
  };
  a.rememberThread(thread());
  if (owned) a.markThreadSubscribed('S');
  t.after(() => a.close());
  return { a, state, outbox, dir, thread, addTurn,
    writes: () => state.calls.filter(r => ['turn/start', 'turn/steer', 'thread/queue/add'].includes(r.method)) };
}

test('concurrent retries use one native mutation, while equal text with a new ID executes separately', async t => {
  const f = await fixture(t);
  const results = await Promise.all([f.a.submitMessage(message()), f.a.submitMessage(message()), f.a.submitMessage(message())]);
  assert.equal(f.writes().length, 1);
  assert.equal(new Set(results.map(r => r.turnId)).size, 1);
  await f.a.submitMessage(message('different'));
  assert.equal(f.writes().length, 2);
});

test('native acceptance followed by a timeout is reconciled by ID without another mutation', async t => {
  const f = await fixture(t);f.state.failStart = Error('timeout after commit');
  await assert.rejects(f.a.submitMessage(message()), /timeout/);
  f.state.failStart = null;
  const result = await f.a.submitMessage(message());
  assert.equal(result.turnId, 'turn_m');
  assert.equal(f.writes().length, 1);
  assert.equal(f.a.messageSubmissions.get('S', 'm').state, 'accepted');
});

test('an unresolved dispatch is not blindly sent again when history cannot prove acceptance', async t => {
  const f = await fixture(t);f.state.failStart = Error('connection closed');
  await assert.rejects(f.a.submitMessage(message()));
  f.state.turns = [];
  await assert.rejects(f.a.submitMessage(message()), /still being confirmed/);
  assert.equal(f.writes().length, 1);
});

test('native user-message acceptance settles an ambiguous receipt without another send', async t => {
  const f = await fixture(t);
  await f.a.messageSubmissions.reserve('S','m');
  await f.a.handleNotification({ method:'item/completed', params:{ threadId:'S', turnId:'native_turn',
    item:{type:'userMessage',id:'native_message',clientId:'m',content:[{type:'text',text:'accepted'}]} } });
  assert.equal(f.a.messageSubmissions.get('S','m').state,'accepted');
  assert.equal((await f.a.submitMessage(message())).turnId,'native_turn');
  assert.equal(f.writes().length,0);
});

test('exact queue execution confirmation settles pending admission without acquiring a writer', async t => {
  const f = await fixture(t, { owned:false });
  await f.a.messageSubmissions.reserve('S','m');
  await f.a.queueTracker.emit('S',{kind:'codex.queue.updated',client_message_id:'m',turn_id:'queued_turn',status:'completed'});
  assert.equal((await f.a.submitMessage(message())).turnId,'queued_turn');
  assert.equal(f.state.calls.some(c=>c.method==='thread/resume'),false);
});

test('authoritative history settles a missing dispatch acknowledgement without background takeover', async t => {
  const f = await fixture(t, { owned:false });
  await f.a.messageSubmissions.reserve('S','m');f.addTurn('m','accepted earlier');
  f.a.rememberThread(f.thread(), { turnsAuthoritative:true });
  const deadline = Date.now()+2000;
  while (f.a.messageSubmissions.get('S','m').state==='pending' && Date.now()<deadline)
    await new Promise(r=>setTimeout(r,5));
  assert.equal(f.a.messageSubmissions.get('S','m').state,'accepted');
  assert.equal(f.state.calls.some(c=>c.method==='thread/resume'),false);
});

test('a provably undispatched request can retry without leaving an ambiguous admission', async t => {
  const f = await fixture(t);const original=f.a.request;
  f.a.request=async(method,params)=>{
    if(method==='turn/start') throw Object.assign(Error('server is not running'),{codexRequestNotDispatched:true});
    return original(method,params);
  };
  await assert.rejects(f.a.submitMessage(message()),/not running/);
  assert.equal(f.a.messageSubmissions.get('S','m'),undefined);
  f.a.request=original;
  await f.a.submitMessage(message());
  assert.equal(f.writes().length,1);
});

test('receipt disk failure before dispatch prevents execution, and failure after acceptance cannot replay it', async t => {
  const f = await fixture(t);const save = f.a.handlers.saveCodexMessageReceipt;
  f.a.handlers.saveCodexMessageReceipt = async () => { throw Error('disk full'); };
  await assert.rejects(f.a.submitMessage(message()),/disk full/);
  assert.equal(f.writes().length,0);
  f.a.handlers.saveCodexMessageReceipt = async r => { if(r.state==='accepted')throw Error('disk full');return save(r); };
  await assert.rejects(f.a.submitMessage(message()),/disk full/);
  assert.equal(f.writes().length,1);
  f.a.handlers.saveCodexMessageReceipt = save;
  await f.a.submitMessage(message());
  assert.equal(f.writes().length,1);
});

test('accepted receipts survive a Relay restart and contain no plaintext or arbitrary provider fields', async t => {
  const f = await fixture(t);
  await f.a.submitMessage(message('m', 'DO_NOT_PERSIST_MESSAGE_TEXT'));
  const raw = await readFile(f.outbox.path, 'utf8');
  assert.equal(raw.includes('DO_NOT_PERSIST_MESSAGE_TEXT'), false);
  const restored = new RelayOutbox(f.outbox.path);await restored.load();
  const next = await fixture(t, { outbox: restored, dir: f.dir });
  const result = await next.a.submitMessage(message());
  assert.equal(result.turnId, 'turn_m');assert.equal(next.writes().length, 0);
  await restored.saveCodexMessageReceipt({ sessionId: 'S', clientMessageId: 'x', createdAt: Date.now(), state: 'accepted',
    content: 'PRIVATE', result: { mode: 'started', turnId: 't', secret: 'PRIVATE' } });
  assert.equal((await readFile(f.outbox.path, 'utf8')).includes('PRIVATE'), false);
});

test('an already queued message is resumed and consumed without turn/start or a second queue/add', async t => {
  const f = await fixture(t, { owned: false });
  f.state.queue.push({ id: 'existing', clientUserMessageId: 'm' });
  const result = await f.a.submitMessage(message());
  assert.equal(result.mode, 'queued');assert.equal(f.writes().length, 0);
  assert.equal(f.state.calls.filter(r => r.method === 'thread/resume').length, 1);
  assert.equal(f.state.turns.filter(r => r.id === 'turn_m').length, 1);
});

test('a receipt write failure after resume consumes an old queue cannot make a retry send it again', async t => {
  const f = await fixture(t,{owned:false});
  f.state.queue.push({id:'existing',clientUserMessageId:'m'});
  const save=f.a.handlers.saveCodexMessageReceipt;
  f.a.handlers.saveCodexMessageReceipt=async r=>{if(r.state==='accepted')throw Error('disk full');return save(r);};
  await assert.rejects(f.a.submitMessage(message()),/disk full/);
  assert.equal(f.a.messageSubmissions.get('S','m').state,'pending');
  f.a.queueTracker.receipts.clear(); // Native execution may retire its queue-tracking receipt.
  f.a.handlers.saveCodexMessageReceipt=save;
  await f.a.submitMessage(message());
  assert.equal(f.state.turns.filter(r=>r.id==='turn_m').length,1);
  assert.equal(f.writes().length,0);
});

test('a competing writer receives one queued submission and retries never force ownership', async t => {
  const f = await fixture(t, { owned: false });
  f.state.resumeError = Object.assign(Error('thread S already has an active writer'), { code: -32600 });
  await f.a.submitMessage(message());await f.a.submitMessage(message());
  assert.deepEqual(f.writes().map(r => r.method), ['thread/queue/add']);
  assert.equal(f.a.resumedThreads.has('S'), false);
});

test('an idle Desktop owner and a definitive queue refusal leave no ambiguous submission', async t => {
  const f = await fixture(t, { owned:false });
  f.a.readDesktopPermissions=async()=>({running:false});
  f.a.submitDesktopMessage=async()=>({awaitingNewTurn:true});
  const original=f.a.request;
  f.a.request=async(method,params)=>{
    if(method==='thread/queue/add')throw Object.assign(Error('queue unavailable'),{code:-32601});
    return original(method,params);
  };
  await assert.rejects(f.a.submitMessage(message()),/queue unavailable/);
  assert.equal(f.a.messageSubmissions.get('S','m'),undefined);
  assert.equal(f.a.queueTracker.receipts.size,0);
});

test('idle unsubscribe retains ownership until native notLoaded/closed is verified', async t => {
  const f = await fixture(t);
  f.a.scheduleIdleRelease('S', 0);await f.state.unsubscribed.promise;await tick();
  assert.equal(f.a.idleUnsubscribed.has('S'), true);
  assert.equal(f.a.resumedThreads.has('S'), true);
  f.state.nativeLoaded = false;
  await f.a.handleNotification({ method: 'thread/closed', params: { threadId: 'S' } });
  assert.equal(f.a.resumedThreads.has('S'), false);
  assert.equal(f.a.idleUnsubscribed.has('S'), false);
});

test('a send during the unload grace period resubscribes before executing', async t => {
  const f = await fixture(t);
  f.a.idleUnsubscribed.add('S');
  await f.a.submitMessage(message());
  const operations = f.state.calls.map(r => r.method);
  assert.ok(operations.indexOf('thread/resume') < operations.indexOf('turn/start'));
  assert.equal(f.a.idleUnsubscribed.has('S'), false);
  assert.equal(f.writes().length, 1);
});

test('an existing queued ID is not repeated when resubscribing itself starts consumption', async t => {
  const f = await fixture(t);f.a.idleUnsubscribed.add('S');
  f.state.queue.push({ id: 'q', clientUserMessageId: 'm' });
  await f.a.submitMessage(message());
  assert.equal(f.writes().length, 0);
  assert.equal(f.state.turns.filter(r => r.id === 'turn_m').length, 1);
});

test('Desktop acquiring the writer before close notification falls back to the queue after stale ownership is cleared', async t => {
  const f = await fixture(t);f.a.idleUnsubscribed.add('S');
  f.state.resumeError = Object.assign(Error('thread S already has an active writer'), { code: -32600 });
  await f.a.submitMessage(message());
  assert.equal(f.a.resumedThreads.has('S'), false);
  assert.deepEqual(f.writes().map(r => r.method), ['thread/queue/add']);
});

test('retrying an already executed queued ID does not load the thread or submit another turn', async t => {
  const f = await fixture(t, { owned: false });
  const receipt = await f.a.messageSubmissions.reserve('S','m');
  await f.a.messageSubmissions.accept(receipt, { mode:'queued', queuedSubmissionId:'q', persisted:true });
  f.addTurn('m','original');
  const result = await f.a.submitMessage(message());
  assert.equal(result.turnId,'turn_m');
  assert.equal(f.state.calls.some(r => r.method === 'thread/resume'), false);
  assert.equal(f.writes().length,0);
});

test('late closed notifications cannot clear ownership acquired by a fresh resume', async t => {
  const f = await fixture(t);
  await f.a.handleNotification({ method: 'thread/closed', params: { threadId: 'S' } });
  await f.a.handleNotification({ method: 'thread/status/changed', params: { threadId: 'S', status: { type: 'notLoaded' } } });
  assert.equal(f.a.resumedThreads.has('S'), true);
  assert.equal(f.a.threadMetadata.get('S').status.type, 'idle');
});

test('closing one unloaded thread preserves another owned session and its controls', async t => {
  const f = await fixture(t);f.a.markThreadSubscribed('other');f.a.activeTurns.set('other','other_turn');
  f.state.nativeLoaded=false;
  await f.a.handleNotification({method:'thread/closed',params:{threadId:'S'}});
  assert.equal(f.a.resumedThreads.has('other'),true);
  assert.equal(f.a.activeTurns.get('other'),'other_turn');
});

for (const [name, block] of [
  ['approval', f => f.a.pendingApprovals.set('p', { sessionId: 'S' })],
  ['async question', f => f.a.asyncQuestions.entries.set('p', { sessionId: 'S', state: 'pending' })],
  ['persistence', f => f.a.pendingPersistenceChecks.set('t', [{ sessionId: 'S' }])],
  ['background terminal', f => f.state.background.push({ processId: 'p' })],
  ['running child', f => f.state.children.push({ id: 'child', status: { type: 'active' } })],
  ['child background terminal', f => {
    f.state.children.push({ id:'child', status:{type:'idle'} });
    f.state.childBackground = { child:[{processId:'background'}] };
  }],
  ['new unmaterialized thread', f => { f.state.turns=[]; }],
  ['unknown terminal state', f => { f.state.turns[0].status='unknown'; }],
  ['interrupted continuation', f => { f.state.turns[0].status='interrupted'; }],
]) test(`pending ${name} retains the subscription`, async t => {
  const f = await fixture(t);block(f);f.a.scheduleIdleRelease('S', 0);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(f.state.calls.some(r => r.method === 'thread/unsubscribe'), false);
});

test('a send queued while idle verification is in flight cancels the unsubscribe', async t => {
  const f = await fixture(t);f.state.blockRead = gate();
  f.a.scheduleIdleRelease('S', 0);await new Promise(r => setTimeout(r, 10));
  const sending = f.a.submitMessage(message());
  f.state.blockRead.resolve();await sending;
  assert.equal(f.state.calls.some(r => r.method === 'thread/unsubscribe'), false);
  assert.equal(f.writes().length, 1);
});

test('background completion is rechecked without a new user send and does not interrupt another thread', async t => {
  const f=await fixture(t);f.a.idleReleaseRetryMs=10;
  f.state.background.push({processId:'background'});
  f.a.markThreadSubscribed('other');f.a.activeTurns.set('other','other_turn');
  f.a.scheduleIdleRelease('S',0);
  await new Promise(r=>setTimeout(r,30));
  assert.equal(f.state.calls.some(c=>c.method==='thread/unsubscribe'),false);
  f.state.background=[];
  await Promise.race([f.state.unsubscribed.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('idle recheck timed out')),2000))]);
  assert.equal(f.a.activeTurns.get('other'),'other_turn');
  assert.equal(f.state.calls.some(c=>['turn/interrupt','thread/archive','thread/delete'].includes(c.method)),false);
});

test('child activity invalidates a parent release and parent rechecks after the child finishes', async t => {
  const f = await fixture(t);
  f.a.idleReleaseDelayMs=10;f.a.idleReleaseRetryMs=10;
  const child={id:'child',parentThreadId:'S',status:{type:'idle'}};
  f.state.children.push(child);f.a.rememberThread(child);
  f.state.blockRead=gate();f.a.scheduleIdleRelease('S',0);
  await new Promise(r=>setTimeout(r,10));
  child.status={type:'active'};
  await f.a.handleNotification({method:'turn/started',params:{threadId:'child',turn:{id:'child_live',status:'inProgress'}}});
  f.state.blockRead.resolve();
  await new Promise(r=>setTimeout(r,30));
  assert.equal(f.state.calls.some(c=>c.method==='thread/unsubscribe'),false);
  child.status={type:'idle'};
  await f.a.handleNotification({method:'turn/completed',params:{threadId:'child',turn:{id:'child_live',status:'completed',items:[]}}});
  await Promise.race([f.state.unsubscribed.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('parent recheck timed out')),2000))]);
  assert.equal(f.a.resumedThreads.has('S'),true);
});
