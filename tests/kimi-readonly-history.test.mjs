import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { KimiCodeAdapter, historyMessagesFromKimiWire } from '../relay/kimi-adapter.mjs';

const records = [
  { type: 'permission.set_mode', mode: 'manual' },
  { type: 'context.append_message', agentId: 'main', message: { id: 'm1', role: 'user', origin: { kind: 'user' }, content: [{ type: 'text', text: 'First question' }] } },
  { type: 'turn.prompt', promptId: 'm1', origin: { kind: 'user' }, input: [{ type: 'text', text: 'First question' }] },
  { type: 'context.append_loop_event', event: { type: 'content.part', uuid: 'think1', part: { type: 'think', text: 'private reasoning' } } },
  { type: 'context.append_loop_event', event: { type: 'content.part', uuid: 'text1', part: { type: 'text', text: 'First answer' } } },
  { type: 'context.append_loop_event', event: { type: 'content.part', uuid: 'text1', part: { type: 'text', text: 'First answer' } } },
  { type: 'turn.prompt', promptId: 'm2', input: [{ type: 'text', text: 'Follow-up' }] },
  { type: 'context.append_loop_event', agentId: 'child', event: { type: 'content.part', part: { type: 'text', text: 'subagent internal text' } } },
  { type: 'context.append_loop_event', event: { type: 'tool.result', result: { output: 'tool secret' } } },
  { type: 'context.append_loop_event', event: { type: 'content.part', uuid: 'text2', part: { type: 'text', text: 'Second answer' } } },
];
const wire = records.map(JSON.stringify).join('\n') + '\n{"partial":';

test('local Kimi history deduplicates replay records and excludes internal content', () => {
  const messages = historyMessagesFromKimiWire('s1', wire, '2026-09-20T00:00:00Z');
  assert.deepEqual(messages.map(m => [m.role, m.content]), [
    ['user', 'First question'], ['codex', 'First answer'],
    ['user', 'Follow-up'], ['codex', 'Second answer'],
  ]);
  assert.equal(messages[0].turn_id, messages[1].turn_id);
  assert.notEqual(messages[0].turn_id, messages[2].turn_id);
  assert.doesNotMatch(JSON.stringify(messages), /private|secret|subagent/);
});

test('default history reader never starts ACP or changes native permission state', async () => {
  const home = await mkdtemp(join(tmpdir(), 'kimi-readonly-'));
  try {
    const sessionDir = join(home, 'sessions', 'project', 's1');
    await mkdir(join(sessionDir, 'agents', 'main'), { recursive: true });
    await writeFile(join(home, 'session_index.jsonl'), JSON.stringify({ sessionId: 's1', sessionDir }) + '\n');
    const path = join(sessionDir, 'agents', 'main', 'wire.jsonl');
    await writeFile(path, wire);
    const adapter = new KimiCodeAdapter({ kimiHome: home, spawnProcess: () => { throw Error('History must not spawn ACP'); }, agentStateReader: async () => [], sessionStateReader: async () => new Map() });
    adapter.rememberSession({ sessionId: 's1', cwd: '/fixture', updatedAt: '2026-09-20T00:00:00Z' });
    const first = await adapter.readHistory({ sessionId: 's1', limit: 1 });
    assert.equal(first.messages[0].content, 'Second answer');
    assert.equal(first.has_more, true);
    const older = await adapter.readHistory({ sessionId: 's1', limit: 3, before: first.next_cursor });
    assert.equal(older.messages.length, 3);
    assert.equal(await readFile(path, 'utf8'), wire);
    await assert.rejects(adapter.readHistory({ sessionId: 's1', before: 'bad' }), /Invalid history cursor/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('history without agent details skips advisory reads and preserves the foreground snapshot', async t => {
  const home = await mkdtemp(join(tmpdir(), 'kimi-history-no-details-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const sessionDir = join(home, 'sessions', 'project', 's1');
  await mkdir(join(sessionDir, 'agents', 'main'), { recursive: true });
  await writeFile(join(home, 'session_index.jsonl'), JSON.stringify({ sessionId: 's1', sessionDir }) + '\n');
  const path = join(sessionDir, 'agents', 'main', 'wire.jsonl');
  await writeFile(path, wire);
  const agent = { id: 'child', task: 'Fixture task', status: 'running' };
  let agentReads = 0;
  let executionReads = 0;
  const adapter = new KimiCodeAdapter({
    kimiHome: home,
    spawnProcess: () => { throw Error('History must not spawn ACP'); },
    agentStateReader: async () => { agentReads++; return [agent]; },
    sessionStateReader: async () => {
      executionReads++;
      return new Map([['s1', { status: 'active', running_started_at: '2026-09-20T00:00:00Z' }]]);
    },
  });
  adapter.rememberSession({ sessionId: 's1', cwd: '/fixture', updatedAt: '2026-09-20T00:00:00Z' });
  const previousAgents = [{ ...agent, status: 'completed' }];
  adapter.agentSnapshots.set('s1', previousAgents);
  const preview = await adapter.readHistory({ sessionId: 's1', limit: 1, includeAgentDetails: false });
  assert.equal(agentReads, 0, 'background history must not load child wire files');
  assert.equal(executionReads, 0, 'runtime reconciliation may also load child wire files');
  assert.equal(adapter.agentSnapshots.get('s1'), previousAgents);
  assert.deepEqual(preview.agents, []);
  assert.deepEqual(preview.sessions, [], 'unread runtime state must not mark an external session idle');
  assert.equal(preview.messages[0].content, 'Second answer');
  assert.equal(preview.has_more, true);

  const foreground = await adapter.readHistory({ sessionId: 's1', limit: 1 });
  assert.equal(agentReads, 1);
  assert.equal(executionReads, 1);
  assert.deepEqual(foreground.agents, [agent]);
  assert.equal(foreground.sessions[0].status, 'active');
  assert.deepEqual(foreground.messages, preview.messages);
  assert.equal(foreground.next_cursor, preview.next_cursor);
  const older = await adapter.readHistory({ sessionId: 's1', limit: 3, before: preview.next_cursor, includeAgentDetails: false });
  assert.deepEqual(older.messages.map(message => message.content), ['First question', 'First answer', 'Follow-up']);
  assert.equal(agentReads, 1);
  assert.equal(executionReads, 1);
  assert.deepEqual(older.agents, []);
  assert.deepEqual(older.sessions, []);
  assert.deepEqual(adapter.agentSnapshots.get('s1'), [agent]);
  assert.equal(await readFile(path, 'utf8'), wire);
});

 test('consecutive cancelled user turns remain separate history messages', () => {
  const input = [
    { type: 'turn.prompt', promptId: 'first', input: [{ type: 'text', text: 'Cancelled' }] },
    { type: 'turn.cancel' },
    { type: 'turn.prompt', promptId: 'second', input: [{ type: 'text', text: 'Replacement' }] },
  ].map(JSON.stringify).join('\n');
  const messages = historyMessagesFromKimiWire('s1', input);
  assert.deepEqual(messages.map(m => m.content), ['Cancelled', 'Replacement']);
  assert.notEqual(messages[0].turn_id, messages[1].turn_id);
});
