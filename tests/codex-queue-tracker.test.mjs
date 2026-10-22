import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexQueueTracker } from '../relay/codex-queue-tracker.mjs';
import { RelayOutbox } from '../relay/outbox.mjs';

function fixture(t) {
  const state = { queue: [], turns: [], calls: [], events: [], saved: new Map(), addError: null };
  const tracker = new CodexQueueTracker({
    request: async (method, params) => {
      state.calls.push({method, params});
      if (method === 'thread/queue/list') return {data: state.queue};
      if (method === 'thread/read') return {thread: {turns: state.turns}};
      if (method === 'thread/queue/add') {
        const queued = {id: `q_${params.clientUserMessageId}`, clientUserMessageId: params.clientUserMessageId};
        if (!state.addError?.code) state.queue.push(queued);
        if (state.addError) throw state.addError;
        return {queuedSubmission: queued};
      }
      throw new Error(`Tracking must not acquire a writer: ${method}`);
    },
    readTurnStatuses: async () => new Map(state.turns.map(t => [t.id, t.status === "inProgress" ? "running" : t.status])),
    emit: async (sessionId, event) => state.events.push({sessionId, ...event}),
    save: async r => state.saved.set(r.clientMessageId, structuredClone(r)),
    remove: async r => state.saved.delete(r.clientMessageId),
    intervalMs: 100_000,
  });
  t.after(() => tracker.close());
  return {state, tracker, send: id => tracker.enqueue({sessionId:'thread',clientMessageId:id,requestId:`req_${id}`,input:[{type:'text',text:'same text'}]})};
}
const turn = (id, status = 'inProgress') => ({id:`turn_${id}`,status,items:[{type:'userMessage',clientId:id,content:[{type:'text',text:'same text'}]}]});

test('queue follows exact messages through running and completion without resume', async t => {
  const {state, tracker, send} = fixture(t);
  await send('a'); await send('b');
  await tracker.poll('thread');
  state.queue = state.queue.filter(q => q.clientUserMessageId !== 'a');
  state.turns = [turn('a')];
  await tracker.poll('thread');
  assert.equal(state.events.at(-1).status, 'running');
  state.turns = [turn('a','completed')];
  await tracker.poll('thread');
  assert.equal(state.events.at(-1).status, 'completed');
  assert.equal(tracker.receipts.size, 1);
  assert.ok(state.saved.has('b')); assert.ok(!state.saved.has('a'));
  assert.ok(state.calls.every(c => ['thread/queue/list','thread/read','thread/queue/add'].includes(c.method)));
});

test('queue disappearance and identical old text cannot manufacture a successful turn', async t => {
  const {state, tracker, send} = fixture(t); await send('a');
  state.queue=[]; state.turns=[turn('different','completed')];
  await tracker.poll('thread');
  assert.equal(state.events.at(-1).status,'unconfirmed');
  assert.equal(state.events.at(-1).turn_id,null);
  assert.equal(tracker.receipts.size,1);
});

test('concurrent duplicate sends add once and keep stable client ID', async t => {
  const {state, send} = fixture(t);
  const [a,b] = await Promise.all([send('same'),send('same')]);
  assert.deepEqual(a,b);
  await send('same');
  assert.equal(state.calls.filter(c=>c.method==='thread/queue/add').length,1);
});

test('already queued and already executed messages are not added again', async t => {
  const {state, send} = fixture(t);
  state.queue=[{id:'existing',clientUserMessageId:'a'}];
  assert.equal((await send('a')).queuedSubmissionId,'existing');
  state.turns=[turn('b','completed')];
  assert.equal((await send('b')).turnId,'turn_b');
  assert.equal(state.calls.some(c=>c.method==='thread/queue/add'),false);
});

test('ambiguous add timeout is reconciled, never resent', async t => {
  const {state, tracker, send} = fixture(t);
  state.addError=new Error('transport timeout after commit');
  assert.equal((await send('a')).persisted,false);
  await send('a'); await tracker.poll('thread');
  assert.equal(state.events.at(-1).status,'queued');
  assert.equal(state.calls.filter(c=>c.method==='thread/queue/add').length,1);
});

test('definitive unsupported queue errors are reported without claiming queued delivery', async t => {
  const {state, tracker, send} = fixture(t);
  state.addError=Object.assign(new Error('Method not found'),{code:-32601});
  await assert.rejects(send('a'),/Method not found/);
  assert.equal(tracker.receipts.size,0); assert.equal(state.saved.size,0);
});

test('a failed history read cannot turn a missing queue item into completion', async t => {
  const {state, tracker, send} = fixture(t); await send('a'); state.queue=[];
  const original=tracker.request;
  tracker.request=async(method,params)=>{if(method==='thread/read')throw new Error('temporarily unavailable');return original(method,params);};
  await tracker.poll('thread');
  assert.equal(state.events.at(-1).status,'unconfirmed');
  assert.equal(tracker.receipts.size,1);
});

test('tracking timeout is unconfirmed, not completed or a reason to take ownership', async t => {
  const {state, tracker, send} = fixture(t); await send('a'); tracker.maxMs=0;
  await tracker.poll('thread');
  assert.equal(state.events.at(-1).status,'unconfirmed');
  assert.equal(tracker.receipts.size,0);
  assert.equal(state.calls.some(c=>c.method==='thread/resume'),false);
});

test('failed and interrupted history terminate only the matching receipt', async t => {
  const {state, tracker, send} = fixture(t); await send('a');await send('b');
  state.queue=[];state.turns=[turn('a','failed'),turn('b','interrupted')];
  await tracker.poll('thread');
  assert.deepEqual(state.events.map(e=>e.status),['failed','interrupted']);
  assert.equal(tracker.receipts.size,0);
});

test('outbox persists identifiers only and restart resumes read-only tracking', async t => {
  const dir=await mkdtemp(join(tmpdir(),'codex-queue-receipts-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const outbox=new RelayOutbox(join(dir,'outbox.json'));
  await outbox.saveCodexQueueReceipt({sessionId:'thread',clientMessageId:'a',requestId:'r',createdAt:Date.now(),queuedSubmissionId:'q',input:'PRIVATE_MESSAGE'});
  assert.equal((await readFile(outbox.path,'utf8')).includes('PRIVATE_MESSAGE'),false);
  const restarted=new RelayOutbox(outbox.path);await restarted.load();
  const {state,tracker,send}=fixture(t);
  await tracker.restore(Object.values(restarted.codexQueueReceipts));
  await send('a');state.turns=[turn('a','completed')];
  await tracker.poll('thread');
  assert.equal(state.calls.some(c=>c.method==='thread/queue/add'),false);
  assert.equal(state.events.at(-1).status,'completed');
});

// Real Codex 0.153.4 returned interrupted from the non-owner reader while the
// owner was still executing. The rollout's explicit lifecycle is authoritative.
test('external reader pseudo-interruption cannot retire a running queued message', async t => {
  const {state, tracker, send} = fixture(t); await send('a');
  state.queue=[]; state.turns=[turn('a','interrupted')];
  tracker.readTurnStatuses=async()=>new Map([['turn_a','running']]);
  await tracker.poll('thread');
  assert.equal(state.events.at(-1).status,'running');
  assert.equal(tracker.receipts.size,1);
  tracker.readTurnStatuses=async()=>new Map([['turn_a','completed']]);
  await tracker.poll('thread');
  assert.equal(state.events.at(-1).status,'completed');
  assert.equal(tracker.receipts.size,0);
});

test('terminal history without readable lifecycle remains unconfirmed', async t => {
  const {state, tracker, send} = fixture(t); await send('a');
  state.turns=[turn('a','completed')];
  tracker.readTurnStatuses=async()=>{throw new Error('file unavailable');};
  await tracker.poll('thread');
  assert.equal(state.events.at(-1).status,'unconfirmed');
  assert.equal(tracker.receipts.size,1);
});

test('queue reconciles exact snake_case client IDs from completed history', async t => {
  const { state, tracker, send } = fixture(t);
  await send('snake');
  state.queue = [];
  state.turns = [{ id: 'turn_snake', status: 'completed', items: [
    { type: 'userMessage', client_id: 'snake', content: [{ type: 'text', text: 'same text' }] },
  ] }];
  await tracker.poll('thread');
  assert.equal(state.events.at(-1).status, 'completed');
  assert.equal(tracker.receipts.size, 0);
});
