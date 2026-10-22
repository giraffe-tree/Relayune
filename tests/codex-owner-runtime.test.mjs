import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, appendFile, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexAppServerAdapter } from '../relay/codex-adapters.mjs';

async function fixture(t, runtime) {
  const dir = await mkdtemp(join(tmpdir(), 'relayune-owner-runtime-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'rollout.jsonl');
  const record = id => JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: id } }) + '\n';
  await writeFile(path, record('old-turn'));
  await utimes(path, new Date(0), new Date(0));
  const events = [];
  let reads = 0;
  const adapter = new CodexAppServerAdapter({ desktopRuntime: async () => { reads++; return runtime(path, record); } });
  adapter.handlers = { emitEvent: async (_, event) => events.push(event) };
  const thread = { id: 'external', path, status: { type: 'notLoaded' } };
  const sync = () => adapter.syncExternalRolloutActivity([thread]);
  return { adapter, events, sync, thread, reads: () => reads };
}

test('owner idle closes an orphaned rollout once and permits the next desktop queue submission', async t => {
  const f = await fixture(t, () => ({ type: 'idle' }));
  await f.sync();
  assert.equal(f.adapter.toRelaySession(f.thread).status, 'idle');
  assert.deepEqual(f.events, [{ kind: 'turn.completed', turn_id: 'old-turn', status: 'interrupted' }]);
  await f.sync();
  assert.equal(f.events.length, 1);
  f.adapter.readDesktopPermissions = async () => ({ running: false });
  f.adapter.submitDesktopMessage = async () => ({awaitingNewTurn:true});
  f.adapter.queueTracker.enqueue = async request => ({ mode: 'queued', sessionId: request.sessionId });
  f.adapter.request = async () => assert.fail('must not acquire desktop writer');
  assert.deepEqual(await f.adapter.submitMessage({ sessionId: 'external', content: 'continue', clientMessageId: 'next' }),
    { mode: 'queued', sessionId: 'external' });
});

for (const [name, runtime] of [
  ['active owner', () => ({ type: 'active' })],
  ['unavailable owner', () => { throw new Error('offline'); }],
  ['unknown owner status', () => ({ type: 'unknown' })],
]) test(`${name} never treats elapsed time as completion`, async t => {
  const f = await fixture(t, runtime);
  await f.sync(); await f.sync();
  assert.equal(f.adapter.toRelaySession(f.thread).status, 'active');
  assert.equal(f.events.length, 0);
  assert.equal(f.reads(), 1);
});

test('rollout progress during owner read invalidates an idle snapshot', async t => {
  const f = await fixture(t, async (path, record) => {
    await appendFile(path, record('new-turn'));
    return { type: 'idle' };
  });
  await f.sync();
  assert.equal(f.events.length, 0);
  await f.sync();
  assert.equal(f.adapter.externalRolloutTails.get('external').activeTurnId, 'new-turn');
  assert.equal(f.adapter.toRelaySession(f.thread).status, 'active');
});

test('relay-owned turns are never retired using desktop state', async t => {
  const f = await fixture(t, () => ({ type: 'idle' }));
  f.adapter.resumedThreads.add('external');
  await f.sync();
  assert.equal(f.reads(), 0);
  assert.equal(f.events.length, 0);
});


test('settled owner turn does not resurrect unfinished history tools on refresh', async t => {
  const f = await fixture(t, () => ({ type: 'idle' }));
  await f.sync();
  f.adapter.readDesktopPermissions = async () => { throw new Error('no permissions'); };
  f.adapter.request = async method => {
    if (method === 'thread/read') return { thread: { ...f.thread, turns: [{
      id: 'old-turn', status: 'interrupted', items: [{
        id: 'command', type: 'commandExecution', command: 'build', status: 'inProgress',
      }],
    }] } };
    if (method === 'thread/list') return { data: [] };
    throw new Error(method);
  };
  const history = await f.adapter.readHistory({ sessionId: 'external' });
  assert.equal(history.messages.find(m => m.kind === 'tool_activity').tool_activity_status, 'completed');
});

for (const [name, originator, turnStatus, expected] of [
  ['abandoned Desktop turn', 'Codex Desktop', 'interrupted', 'idle'],
  ['live Desktop turn', 'Codex Desktop', 'inProgress', 'active'],
  ['abandoned Relayune turn', 'relayune_local_client', 'interrupted', 'idle'],
  ['live Relayune turn', 'relayune_local_client', 'inProgress', 'active'],
  ['missing Relayune turn', 'relayune_local_client', null, 'active'],
  ['external CLI turn', 'codex_cli_rs', 'interrupted', 'active'],
  ['missing turn', 'Codex Desktop', null, 'active'],
]) test(`owner absence reconciles only confirmed supported interruptions: ${name}`, async t => {
  const f = await fixture(t, () => ({ type: 'notOwned' }));
  const { path } = f.thread;
  const started = JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 'old-turn' } });
  await writeFile(path, JSON.stringify({ type: 'session_meta', payload: { id: 'external', originator } }) + '\n' + started + '\n');
  await utimes(path, new Date(0), new Date(0));
  f.adapter.request = async method => {
    assert.equal(method, 'thread/read');
    return { thread: { ...f.thread, turns: turnStatus ? [{ id: 'old-turn', status: turnStatus }] : [] } };
  };
  await f.sync();
  assert.equal(f.adapter.toRelaySession(f.thread).status, expected);
  if (expected === 'idle') assert.equal(f.adapter.toRelaySession(f.thread).running_started_at, null);
  assert.equal(f.events.filter(e => e.kind === 'turn.completed').length, expected === 'idle' ? 1 : 0);
  await f.sync();
  assert.equal(f.events.filter(e => e.kind === 'turn.completed').length, expected === 'idle' ? 1 : 0);
});

test('new progress during an absent-owner history check cannot stop the new turn', async t => {
  const f = await fixture(t, () => ({ type: 'notOwned' }));
  await writeFile(f.thread.path, JSON.stringify({ type: 'session_meta', payload: { id: 'external', originator: 'Codex Desktop' } }) + '\n' + JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 'old-turn' } }) + '\n');
  await utimes(f.thread.path, new Date(0), new Date(0));
  f.adapter.request = async () => {
    await appendFile(f.thread.path, JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 'new-turn' } }) + '\n');
    return { thread: { ...f.thread, turns: [{ id: 'old-turn', status: 'interrupted' }] } };
  };
  await f.sync();
  assert.equal(f.events.some(e => e.kind === 'turn.completed'), false);
  await f.sync();
  assert.equal(f.adapter.externalRolloutTails.get('external').activeTurnId, 'new-turn');
  assert.equal(f.adapter.toRelaySession(f.thread).status, 'active');
});

test('temporary catalog exclusion does not swallow a completed external reply', async t => {
  const f = await fixture(t, () => ({ type: 'active' }));
  await f.sync();
  await f.adapter.syncExternalRolloutActivity([]);
  await appendFile(f.thread.path, [
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'TEST_REPLY' }], phase: 'final_answer' } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'old-turn' } },
  ].map(record => JSON.stringify(record) + '\n').join(''));
  await f.sync();
  assert.equal(f.events.filter(event => event.kind === 'message.completed' && event.text === 'TEST_REPLY').length, 1);
  assert.equal(f.events.filter(event => event.kind === 'turn.completed').length, 1);
  await f.sync();
  assert.equal(f.events.filter(event => event.kind === 'turn.completed').length, 1);
});

test('opening live Desktop history does not expire its questions from a non-owner interrupted snapshot', async t => {
  const f = await fixture(t, () => ({ type: 'active' }));
  const approvals = [];
  f.adapter.handlers.requestApproval = async approval => approvals.push(approval);
  f.adapter.readDesktopApprovals = async () => [];
  f.adapter.readDesktopPermissions = async () => { throw Error('unused'); };
  f.adapter.request = async method => method === 'thread/read' ? { thread: {
    ...f.thread, turns: [{ id: 'old-turn', status: 'interrupted',
      startedAt: Date.now(), items: [{ type: 'agentMessage', id: 'question',
        questions: [{ title: 'Choose a color', options: ['Blue', 'Green'] }] }],
    }],
  } } : { data: [] };
  await f.adapter.readHistory({ sessionId: 'external' });
  assert.equal(approvals.length, 1);
  assert.equal(f.adapter.asyncQuestions.entries.get(approvals[0].approval_id).state, 'pending');
  assert.equal(f.events.some(e => e.kind === 'approval.resolved'), false);
  // A real terminal record still invalidates the exact pending question.
  await appendFile(f.thread.path, JSON.stringify({type:'event_msg',payload:{type:'turn_aborted',turn_id:'old-turn'}})+'\n');
  await f.adapter.readHistory({ sessionId: 'external' });
  assert.ok(f.events.some(e => e.kind === 'approval.resolved' && e.approval_id === approvals[0].approval_id && e.decision === 'expired'));
});
