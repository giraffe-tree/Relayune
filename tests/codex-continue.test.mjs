import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexAppServerAdapter, MockCodexAdapter } from '../relay/codex-adapters.mjs';
import { MultiAgentAdapter } from '../relay/multi-agent-adapter.mjs';

const sessionId = 'synthetic';
const stoppedThread = () => ({ id: sessionId, cwd: '/synthetic', status: { type: 'idle' },
  // Stopping at 0 seconds need not produce an assistant message.
  turns: [{ id: 'stopped', status: 'interrupted', items: [] }] });
const continuation = extra => ({ sessionId, action: 'continue', expectedTurnId: 'stopped',
  content: '', clientMessageId: 'continue-client', ...extra });

function fixture(t, options = {}) {
  const adapter = new CodexAppServerAdapter({ workspace: '/synthetic', ...options });
  adapter.handlers = { emitEvent: async () => {} };
  adapter.verifyUserMessage = async () => assert.fail('empty continuation has no user message to verify');
  adapter.queueTracker.enqueue = async () => assert.fail('continuation must never queue');
  adapter.interruptDesktopTurn = async () => assert.fail('continuation must never interrupt');
  t.after(() => adapter.close());
  return adapter;
}

function ownedStopped(adapter) {
  adapter.resumedThreads.add(sessionId);
  adapter.rememberThread(stoppedThread(), { turnsAuthoritative: true });
}

test('zero-output stopped turn continues with empty native input and an acceptance receipt', async t => {
  const adapter = fixture(t);
  ownedStopped(adapter);
  assert.equal(adapter.toRelaySession({ id: sessionId }).continue_turn_id, 'stopped');
  assert.equal(adapter.toRelaySession({ id: sessionId }).capabilities.continue_supported, true);
  const calls = [];
  adapter.request = async (method, params) => {
    calls.push([method, params]);
    if (method === 'thread/read') return { thread: stoppedThread() };
    assert.equal(method, 'turn/start');
    return { turn: { id: 'next', status: 'inProgress' } };
  };
  assert.deepEqual(await adapter.submitMessage(continuation()), {
    action: 'continue', accepted: true, mode: 'started', turnId: 'next', persisted: false,
  });
  assert.deepEqual(calls[1][1].input, []);
  assert.equal(calls[1][1].turnTrigger, 'resume_interrupted_task');
  assert.equal(calls[1][1].clientUserMessageId, 'continue-client');
  assert.equal(adapter.pendingPersistenceChecks.size, 0);
  assert.equal(adapter.toRelaySession({ id: sessionId }).continue_turn_id, null);
});

test('non-owner interrupted snapshot alone cannot advertise or submit continuation', async t => {
  const adapter = fixture(t);
  adapter.rememberThread(stoppedThread(), { turnsAuthoritative: true });
  adapter.request = async () => assert.fail('unproven interruption must not acquire a writer');
  assert.equal(adapter.toRelaySession({ id: sessionId }).continue_turn_id, null);
  await assert.rejects(adapter.submitMessage(continuation()), /changed/);
});

test('caught-up persisted interruption supports the Desktop owner without writer takeover', async t => {
  const starts = [];
  const adapter = fixture(t, { desktopRuntime: async () => ({ type: 'idle' }),
    desktopStartMessage: async (id, message) => { starts.push([id, message]); return { turnId: 'owner-next' }; } });
  adapter.rememberThread({ id: sessionId, status: { type: 'idle' } });
  adapter.externalRolloutTails.set(sessionId, { lifecycleKnown: true, caughtUp: true,
    currentTurnId: 'stopped', terminalTurnStatuses: new Map([['stopped', 'interrupted']]) });
  adapter.request = async () => assert.fail('Desktop writer must remain owned by Desktop');
  assert.equal((await adapter.submitMessage(continuation())).turnId, 'owner-next');
  assert.deepEqual(starts, [[sessionId, { input: [], clientMessageId: 'continue-client',
    expectedTurnId: 'stopped', turnTrigger: 'resume_interrupted_task' }]]);
});

test('explicit continuation may resume an unowned thread, preserving permission/settings recovery', async t => {
  const adapter = fixture(t, { desktopRuntime: async () => ({ type: 'notOwned' }) });
  adapter.rememberThread({ id: sessionId, status: { type: 'idle' } });
  adapter.externalRolloutTails.set(sessionId, { lifecycleKnown: true, caughtUp: true,
    currentTurnId: 'stopped', terminalTurnStatuses: new Map([['stopped', 'interrupted']]) });
  const methods = [];
  adapter.request = async method => {
    methods.push(method);
    if (method === 'thread/resume' || method === 'thread/read') return { thread: stoppedThread() };
    assert.equal(method, 'turn/start');
    return { turn: { id: 'resumed-next' } };
  };
  assert.equal((await adapter.submitMessage(continuation())).turnId, 'resumed-next');
  assert.deepEqual(methods, ['thread/resume', 'thread/read', 'turn/start']);
});

for (const extra of [
  { expectedTurnId: 'older' }, { expectedTurnId: undefined }, { content: 'Continue' },
  { content: ' ' }, { attachments: [{}] }, { runtimeSettings: {} }, { interruptRunning: true },
]) test(`invalid continuation payload cannot send: ${JSON.stringify(extra)}`, async t => {
  const adapter = fixture(t);
  ownedStopped(adapter);
  adapter.request = async () => assert.fail('invalid continuation must fail before RPC');
  await assert.rejects(adapter.submitMessage(continuation(extra)));
});

for (const status of ['completed', 'failed', 'inProgress']) {
  test(`${status} never becomes a continuable interruption`, t => {
    const adapter = fixture(t);
    adapter.resumedThreads.add(sessionId);
    const thread = stoppedThread();
    thread.turns[0].status = status;
    adapter.rememberThread(thread, { turnsAuthoritative: true });
    assert.equal(adapter.toRelaySession({ id: sessionId }).continue_turn_id, null);
  });
}

test('approval and unanswered asynchronous question block the same empty action', async t => {
  const adapter = fixture(t);
  ownedStopped(adapter);
  adapter.pendingApprovals.set('approval', { sessionId });
  assert.equal(adapter.continueTurnId(sessionId), null);
  await assert.rejects(adapter.submitMessage(continuation()));
  adapter.pendingApprovals.clear();
  adapter.asyncQuestions.entries.set('question', { sessionId, state: 'pending' });
  assert.equal(adapter.continueTurnId(sessionId), null);
  await assert.rejects(adapter.submitMessage(continuation()));
});

test('newer turn in owner read rejects a stale button instead of steering or interrupting', async t => {
  const adapter = fixture(t);
  ownedStopped(adapter);
  adapter.request = async method => {
    assert.equal(method, 'thread/read');
    return { thread: { ...stoppedThread(), status: { type: 'active' },
      turns: [{ id: 'newer', status: 'inProgress' }] } };
  };
  await assert.rejects(adapter.submitMessage(continuation()), /changed/);
});

test('concurrent paired-client clicks serialize and start only one empty turn', async t => {
  const adapter = fixture(t);
  ownedStopped(adapter);
  let starts = 0;
  adapter.request = async method => {
    if (method === 'thread/read') return { thread: stoppedThread() };
    assert.equal(method, 'turn/start');
    starts++;
    return { turn: { id: 'one-next' } };
  };
  const results = await Promise.allSettled([
    adapter.submitMessage(continuation()), adapter.submitMessage(continuation({ clientMessageId: 'other-client' })),
  ]);
  assert.equal(starts, 1);
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected']);
});

test('a terminal notification received before start acknowledgement is not resurrected', async t => {
  const adapter = fixture(t);
  ownedStopped(adapter);
  adapter.request = async method => {
    if (method === 'thread/read') return { thread: stoppedThread() };
    await adapter.handleNotification({ method: 'turn/started', params: {
      threadId: sessionId, turn: { id: 'fast' } } });
    await adapter.handleNotification({ method: 'turn/completed', params: {
      threadId: sessionId, turn: { id: 'fast', status: 'completed' } } });
    return { turn: { id: 'fast' } };
  };
  await adapter.submitMessage(continuation());
  assert.equal(adapter.activeTurns.has(sessionId), false);
  assert.equal(adapter.continueTurnId(sessionId), null);
});

test('fresh rollout latest lifecycle replaces an old stop; an incomplete prefix cannot offer continue', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'relayune-continue-rollout-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'rollout.jsonl');
  await writeFile(path, [
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'stopped' } },
    { type: 'event_msg', payload: { type: 'turn_aborted', turn_id: 'stopped' } },
  ].map(JSON.stringify).join('\n') + '\n');
  const adapter = fixture(t);
  const thread = { id: sessionId, path, status: { type: 'notLoaded' } };
  adapter.rememberThread(thread);
  await adapter.pollExternalRolloutActivity(thread);
  assert.equal(adapter.continueTurnId(sessionId), 'stopped');
  adapter.externalRolloutTails.get(sessionId).caughtUp = false;
  assert.equal(adapter.continueTurnId(sessionId), null);
});

test('an older persisted interruption cannot replace a newer completed notification', async t => {
  const adapter = fixture(t);
  ownedStopped(adapter);
  await adapter.handleNotification({ method: 'turn/started', params: {
    threadId: sessionId, turn: { id: 'newer' } } });
  await adapter.handleNotification({ method: 'turn/completed', params: {
    threadId: sessionId, turn: { id: 'newer', status: 'completed' } } });
  adapter.reconcilePersistedRuntime(sessionId, { lifecycleKnown: true, currentTurnId: 'stopped',
    terminalTurnStatuses: new Map([['stopped', 'interrupted']]) });
  assert.equal(adapter.continueTurnId(sessionId), null);
});

test('owner-classified transient failure continues, while quota failure remains blocked', async t => {
  const adapter = fixture(t);
  adapter.resumedThreads.add(sessionId);
  const thread = stoppedThread();
  thread.turns[0] = { id: 'stopped', status: 'failed', error: {
    codexErrorInfo: { responseStreamDisconnected: {} }, message: 'stream disconnected' } };
  adapter.rememberThread(thread, { turnsAuthoritative: true });
  assert.equal(adapter.continueTurnId(sessionId), 'stopped');
  adapter.request = async method => method === 'thread/read' ? { thread } : { turn: { id: 'retry' } };
  assert.equal((await adapter.submitMessage(continuation())).accepted, true);
  adapter.activeTurns.clear();
  thread.turns[0].error = { codexErrorInfo: 'usageLimitExceeded', message: 'usage limit' };
  adapter.rememberThread(thread, { turnsAuthoritative: true });
  assert.equal(adapter.continueTurnId(sessionId), null);
});

test('trusted terminal notifications expose continuation eligibility without phone-side inference', async t => {
  const adapter = fixture(t);
  const events = [];
  adapter.handlers.emitEvent = async (_, event) => events.push(event);
  await adapter.handleNotification({ method: 'turn/started', params: {
    threadId: sessionId, turn: { id: 'network' } } });
  await adapter.handleNotification({ method: 'turn/completed', params: {
    threadId: sessionId, turn: { id: 'network', status: 'failed', error: {
      codexErrorInfo: { responseStreamDisconnected: {} }, message: 'stream disconnected' } } } });
  assert.equal(events.at(-1).continue_turn_id, 'network');
  await adapter.handleNotification({ method: 'turn/started', params: {
    threadId: sessionId, turn: { id: 'limited' } } });
  await adapter.handleNotification({ method: 'turn/completed', params: {
    threadId: sessionId, turn: { id: 'limited', status: 'failed', error: {
      codexErrorInfo: 'usageLimitExceeded', message: 'usage limit' } } } });
  assert.equal(events.at(-1).continue_turn_id, null);
});

test('rollout failure needs native error classification, not a message heuristic', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'relayune-continue-failed-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const adapter = fixture(t);
  for (const [suffix, error, expected] of [
    ['classified', { codex_error_info: { responseStreamDisconnected: {} }, message: 'connection lost' }, 'failed-turn'],
    ['unclassified', { message: 'model is temporarily unavailable' }, null],
    ['limited', { codex_error_info: 'other', message: 'model is temporarily unavailable due to quota' }, null],
  ]) {
    const id = `${sessionId}-${suffix}`;
    const path = join(directory, `${suffix}.jsonl`);
    await writeFile(path, [
      { type: 'event_msg', payload: { type: 'task_started', turn_id: 'failed-turn' } },
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'failed-turn', error } },
    ].map(JSON.stringify).join('\n') + '\n');
    const thread = { id, path, status: { type: 'notLoaded' } };
    adapter.rememberThread(thread);
    await adapter.pollExternalRolloutActivity(thread);
    assert.equal(adapter.continueTurnId(id), expected);
  }
});

test('only the real Codex adapter advertises native continuation to a single-provider Relay', t => {
  const adapter = fixture(t);
  assert.equal(adapter.supportsContinuation, true);
  assert.notEqual(new MockCodexAdapter().supportsContinuation, true);
});

test('unified routing rejects continuation for a non-Codex provider before adapter execution', async () => {
  const adapter = new MultiAgentAdapter({ adapters: {
    codex: { submitMessage: async options => options },
    kimi: { submitMessage: async () => assert.fail('Kimi must not receive a Codex continuation') },
  } });
  adapter.sessionProviders.set('older-codex', 'codex');
  adapter.sessionProviders.set('kimi-thread', 'kimi');
  const request = { sessionId: 'older-codex', action: 'continue', expectedTurnId: 'stopped', content: '' };
  assert.deepEqual(await adapter.submitMessage(request), request);
  await assert.rejects(adapter.submitMessage({ ...request, sessionId: 'kimi-thread' }), /only supported for Codex/);
});
