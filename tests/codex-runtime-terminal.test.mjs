import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexAppServerAdapter } from '../relay/codex-adapters.mjs';

function adapterFixture(t) {
  const adapter = new CodexAppServerAdapter({ workspace: '/synthetic-runtime' });
  adapter.handlers = { emitEvent: async () => {} };
  t.after(() => adapter.close());
  return adapter;
}

async function live(adapter, id = 'current') {
  adapter.rememberThread({ id: 'synthetic', status: { type: 'active' } });
  await adapter.handleNotification({ method: 'turn/started', params: { threadId: 'synthetic',
    turn: { id, startedAt: '2026-10-22T12:11:32.000Z' } } });
}

for (const status of ['completed', 'failed']) test(`matching native ${status} snapshot clears a missed terminal notification`, async t => {
  const adapter = adapterFixture(t);
  await live(adapter);
  adapter.rememberThread({ id: 'synthetic', status: { type: 'active' }, turns: [
    { id: 'current', status, startedAt: '2026-10-22T12:11:32.000Z' },
  ] }, { turnsAuthoritative: true });
  assert.equal(adapter.liveTurns.has('synthetic'), false);
  assert.equal(adapter.activeTurns.has('synthetic'), false);
  const session = adapter.toRelaySession({ id: 'synthetic' });
  assert.equal(session.status, 'idle');
  assert.equal(session.can_interrupt, false);
  assert.equal(session.running_started_at, null);
});

test('completed historical turns without completedAt cannot start a running timer', t => {
  const adapter = adapterFixture(t);
  adapter.rememberThread({ id: 'synthetic', status: { type: 'active' }, updatedAt: '2026-10-22T12:11:32.000Z', turns: [
    { id: 'historical', status: 'completed', startedAt: '2026-10-22T10:51:59.000Z' },
  ] }, { turnsAuthoritative: true });
  assert.equal(adapter.toRelaySession({ id: 'synthetic' }).running_started_at, null);
  adapter.rememberThread({ id: 'synthetic', status: { type: 'active' }, turns: [
    { id: 'historical', status: 'completed', startedAt: '2026-10-22T10:51:59.000Z' },
    { id: 'new', status: 'inProgress', startedAt: '2026-10-22T12:11:32.000Z' },
  ] }, { turnsAuthoritative: true });
  assert.equal(adapter.toRelaySession({ id: 'synthetic' }).running_started_at, '2026-10-22T12:11:32.000Z');
});

test('stale idle/interrupted and different-turn terminals preserve the current live turn and timer', async t => {
  const adapter = adapterFixture(t);
  await live(adapter, 'new');
  adapter.rememberThread({ id: 'synthetic', status: { type: 'idle' }, turns: [
    { id: 'new', status: 'interrupted' },
  ] }, { turnsAuthoritative: true });
  adapter.rememberThread({ id: 'synthetic', status: { type: 'active' }, turns: [
    { id: 'old', status: 'completed', startedAt: '2026-10-22T10:51:59.000Z' },
  ] }, { turnsAuthoritative: true });
  adapter.reconcilePersistedRuntime('synthetic', { lifecycleKnown: true, currentTurnId: 'old', activeTurnId: null,
    terminalTurnStatuses: new Map([['old', 'completed']]) });
  assert.equal(adapter.liveTurns.get('synthetic'), 'new');
  assert.equal(adapter.activeTurns.get('synthetic'), 'new');
  const session = adapter.toRelaySession({ id: 'synthetic' });
  assert.equal(session.status, 'active');
  assert.equal(session.can_interrupt, true);
  assert.equal(session.running_started_at, '2026-10-22T12:11:32.000Z');
});

test('terminal notification commits runtime cleanup even when question settlement fails', async t => {
  const adapter = adapterFixture(t);
  await live(adapter);
  adapter.asyncQuestions.endTurn = async () => { throw new Error('synthetic question delivery failure'); };
  await assert.rejects(adapter.handleNotification({ method: 'turn/completed', params: {
    threadId: 'synthetic', turn: { id: 'current', status: 'completed' },
  } }));
  assert.equal(adapter.activeTurns.has('synthetic'), false);
  assert.equal(adapter.liveTurns.has('synthetic'), false);
  assert.equal(adapter.toRelaySession({ id: 'synthetic' }).status, 'idle');
});

test('a fresh turn/start response replaces an earlier timer while steer retains the live turn', async t => {
  const adapter = adapterFixture(t);
  adapter.resumedThreads.add('synthetic');
  adapter.activeTurnStartedAt.set('synthetic', '2026-10-22T10:51:59.000Z');
  adapter.verifyUserMessage = async () => true;
  adapter.request = async method => {
    assert.equal(method, 'turn/start');
    return { turn: { id: 'new', startedAt: '2026-10-22T12:11:32.000Z' } };
  };
  await adapter.submitMessage({ sessionId: 'synthetic', content: 'synthetic input', clientMessageId: 'first' });
  assert.equal(adapter.activeTurnStartedAt.get('synthetic'), '2026-10-22T12:11:32.000Z');
  adapter.request = async (method, params) => {
    assert.equal(method, 'turn/steer');
    assert.equal(params.expectedTurnId, 'new');
    return {};
  };
  assert.equal((await adapter.submitMessage({ sessionId: 'synthetic', content: 'synthetic follow-up', clientMessageId: 'second' })).mode, 'steered');
  assert.equal(adapter.activeTurnStartedAt.get('synthetic'), '2026-10-22T12:11:32.000Z');
});

test('catalog reconciles exact persisted task_complete for a Relay-owned live turn without stopping newer work', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'relayune-runtime-terminal-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'rollout.jsonl');
  await writeFile(path, [
    { timestamp: '2026-10-22T12:11:32Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'current' } },
    { timestamp: '2026-10-22T12:11:37Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'current' } },
  ].map(JSON.stringify).join('\n') + '\n');
  const adapter = adapterFixture(t);
  adapter.resumedThreads.add('synthetic');
  await live(adapter);
  const thread = { id: 'synthetic', path, status: { type: 'active' } };
  await adapter.syncExternalRolloutActivity([thread]);
  assert.equal(adapter.liveTurns.has('synthetic'), false);
  assert.equal(adapter.activeTurns.has('synthetic'), false);
  assert.equal(adapter.toRelaySession(thread).status, 'idle');
  assert.equal(adapter.toRelaySession(thread).running_started_at, null);
  await adapter.syncExternalRolloutActivity([thread]);
  assert.equal(adapter.toRelaySession(thread).status, 'idle', 'a stale active catalog must remain corrected on later polls');
  await live(adapter, 'new');
  await adapter.syncExternalRolloutActivity([thread]);
  assert.equal(adapter.activeTurns.get('synthetic'), 'new');
  assert.equal(adapter.toRelaySession(thread).status, 'active');
  assert.equal(adapter.toRelaySession(thread).running_started_at, '2026-10-22T12:11:32.000Z');
});


test('a native terminal snapshot older than a live notification cannot clear that turn', async t => {
  const adapter = adapterFixture(t);
  const revision = adapter.threadRuntimeRevisions.get('synthetic') ?? 0;
  await live(adapter);
  adapter.rememberThread({ id: 'synthetic', status: { type: 'idle' }, turns: [
    { id: 'current', status: 'completed' },
  ] }, { turnsAuthoritative: true, runtimeRevision: revision });
  assert.equal(adapter.activeTurns.get('synthetic'), 'current');
  assert.equal(adapter.toRelaySession({ id: 'synthetic' }).status, 'active');
});


test('a partial historical range cannot declare the current thread idle', t => {
  const adapter = adapterFixture(t);
  adapter.rememberThread({ id: 'synthetic', status: { type: 'active' } });
  adapter.reconcilePersistedRuntime('synthetic', { lifecycleKnown: true,
    currentTurnId: 'historical', activeTurnId: null,
    terminalTurnStatuses: new Map([['historical', 'completed']]),
  }, { complete: false });
  assert.equal(adapter.toRelaySession({ id: 'synthetic' }).status, 'active');
  adapter.liveTurns.set('synthetic', 'historical');
  adapter.activeTurns.set('synthetic', 'historical');
  adapter.reconcilePersistedRuntime('synthetic', { lifecycleKnown: true,
    currentTurnId: 'historical', activeTurnId: null,
    terminalTurnStatuses: new Map([['historical', 'completed']]),
  }, { complete: false });
  assert.equal(adapter.activeTurns.has('synthetic'), false, 'exact terminal still retires its own turn');
  assert.equal(adapter.toRelaySession({ id: 'synthetic' }).status, 'active', 'unread later records may contain another turn');
});
