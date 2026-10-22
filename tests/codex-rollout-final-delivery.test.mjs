import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexAppServerAdapter, codexRolloutActivityEvents } from '../relay/codex-adapters.mjs';

const record = (type, payload) => ({ timestamp: '2026-09-11T02:26:05.560Z', type, payload });
const start = record('event_msg', { type: 'task_started', turn_id: 'turn' });
const final = record('response_item', { type: 'message', id: 'reply', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Final summary' }] });
const done = record('event_msg', { type: 'task_complete', turn_id: 'turn' });
const state = () => ({ pendingCalls: new Map() });

test('persisted response_item final is delivered before completion without waiting for history', () => {
  const s = state();
  const events = [start, record('event_msg', { type: 'agent_message', phase: 'final_answer', message: 'Final summary' }), final, done].flatMap(r => codexRolloutActivityEvents(r, s));
  assert.deepEqual(events.map(e => e.kind), ['turn.started', 'message.completed', 'turn.completed']);
  assert.equal(events[1].text, 'Final summary');
  assert.equal(events[1].message_phase, 'final_answer');
  assert.equal(events[1].turn_id, 'turn');
});

test('paired persisted message formats and repeated polls do not duplicate the final', () => {
  const s = state();
  const item = record('event_msg', { type: 'item_completed', turn_id: 'turn', item: { type: 'agentMessage', id: 'native-reply', text: 'Final summary', phase: 'final_answer' } });
  const events = [start, final, item, final, done].flatMap(r => codexRolloutActivityEvents(r, s));
  assert.equal(events.filter(e => e.kind === 'message.completed').length, 1);
  const seeded = state();
  for (const r of [start, final]) assert.deepEqual(codexRolloutActivityEvents(r, seeded, { seed: true }), []);
  assert.deepEqual(codexRolloutActivityEvents(final, seeded), []);
});

test('response_item parsing preserves commentary but excludes non-public messages', () => {
  const s = state();
  codexRolloutActivityEvents(start, s);
  for (const role of ['user', 'developer', 'system']) {
    assert.deepEqual(codexRolloutActivityEvents({ ...final, payload: { ...final.payload, role } }, s), []);
  }
  assert.deepEqual(codexRolloutActivityEvents({ ...final, payload: { ...final.payload, phase: 'analysis' } }, s), []);
  const events = codexRolloutActivityEvents({ ...final, payload: { ...final.payload, phase: 'commentary' } }, s);
  assert.equal(events[0]?.message_phase, 'commentary');
});

test('history recovers a response_item final immediately and deduplicates materialized history', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'relayune-final-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'rollout.jsonl');
  await writeFile(path, [start, final, done].map(JSON.stringify).join('\n') + '\n');
  const a = new CodexAppServerAdapter({ workspace: dir });
  a.readDesktopPermissions = async () => { throw new Error('unused'); };
  for (const items of [[], [{ type: 'agentMessage', id: 'native-read-id', text: 'Final summary', phase: 'final_answer' }]]) {
    a.request = async method => method === 'thread/read' ? { thread: { id: 'thread', path, cwd: dir, status: { type: 'notLoaded' }, turns: [{ id: 'turn', status: 'completed', items }] } } : { data: [] };
    const history = await a.readHistory({ sessionId: 'thread' });
    assert.equal(history.messages.length, 1);
    assert.equal(history.messages[0].content, 'Final summary');
    assert.equal(history.messages[0].message_phase, 'final_answer');
    assert.equal(history.messages[0].turn_id, 'turn');
  }
});
