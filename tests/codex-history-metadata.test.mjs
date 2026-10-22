import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexAppServerAdapter } from '../relay/codex-adapters.mjs';

function createAdapter(t) {
  const adapter = new CodexAppServerAdapter({ workspace: '/fixture' });
  adapter.refreshHistoryPermissions = () => {};
  adapter.asyncQuestions.settleHistory = async () => {};
  t.after(() => adapter.close());
  return adapter;
}

for (const stage of ['approvals', 'runtime']) test(`cold history preserves a live rollout while catalog ${stage} IPC remains pending`, { timeout: 1_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'relayune-history-ipc-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'rollout.jsonl');
  const timestamp = new Date().toISOString();
  await writeFile(path, [
    { timestamp, type: 'session_meta', payload: { id: 'root', history_mode: 'legacy' } },
    { timestamp, type: 'event_msg', payload: { type: 'task_started', turn_id: 'live' } },
  ].map(JSON.stringify).join('\n') + '\n');
  if (stage === 'runtime') {
    const stale = new Date(Date.now() - 20_000);
    await utimes(path, stale, stale);
  }
  const adapter = createAdapter(t);
  const thread = { id: 'root', cwd: directory, path, status: { type: 'notLoaded' }, turns: [
    { id: 'live', status: 'interrupted', startedAt: timestamp, items: [
      { id: 'answer', type: 'agentMessage', text: 'Fixture answer' },
    ] },
  ] };
  adapter.request = async method => method === 'thread/list' ? { data: [] } : { thread: structuredClone(thread) };
  adapter.handlers = { emitEvent: async () => {} };
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  let reads = 0;
  adapter.readDesktopApprovals = async () => [];
  adapter[stage === 'approvals' ? 'readDesktopApprovals' : 'readDesktopRuntime'] = async () => {
    reads++; started(); await gate; return stage === 'approvals' ? [] : { type: 'active' };
  };
  t.after(() => release());
  const catalog = adapter.pollExternalRolloutActivity(thread);
  await entered;
  // The gate stays closed until the body is returned: a timeout would expose
  // the original head-of-line block instead of allowing the test to pass.
  const page = await adapter.readHistory({ sessionId: 'root', includeAgentDetails: false });
  assert.equal(reads, 1, 'concurrent owner enrichment is coalesced');
  assert.equal(page.messages.find(message => message.id === 'answer').turn_status, 'inProgress');
  assert.equal(adapter.activeTurns.get('root'), 'live');
  release();
  await catalog;
});

test('history pages remain complete while directory metadata releases full turns and image/tool bodies', async t => {
  const adapter = createAdapter(t);
  const oldAnswer = 'PRIVATE_OLD_ANSWER'.repeat(16_384);
  const imageUrl = `data:image/png;base64,${Buffer.alloc(512 * 1024, 42).toString('base64')}`;
  const thread = {
    id: 'root', name: 'Fixture', cwd: '/fixture', createdAt: 1_700_000_000,
    updatedAt: 1_700_000_010, status: { type: 'active', opaque: oldAnswer },
    gitInfo: { branch: 'main', opaque: oldAnswer },
    messages: [{ content: oldAnswer }], attachments: [{ body: imageUrl }],
    turns: [
      { id: 'old', status: 'completed', startedAt: 1_700_000_000, items: [
        { id: 'user', type: 'userMessage', content: [
          { type: 'text', text: 'Read this image' }, { type: 'image', url: imageUrl },
        ] },
        { id: 'old-answer', type: 'agentMessage', text: oldAnswer },
      ] },
      { id: 'live', status: 'inProgress', startedAt: 1_700_000_010, items: [
        { id: 'tool', type: 'commandExecution', command: 'cat fixture', status: 'completed',
          aggregatedOutput: 'PRIVATE_TOOL_OUTPUT'.repeat(131_072) },
        { id: 'answer', type: 'agentMessage', text: 'Latest answer' },
      ] },
    ],
  };
  adapter.request = async method => {
    if (method === 'thread/list') return { data: [] };
    assert.equal(method, 'thread/read');
    return { thread: structuredClone(thread) };
  };
  const latest = await adapter.readHistory({ sessionId: 'root', limit: 2, includeAgentDetails: false });
  assert.deepEqual(latest.messages.map(message => message.id), ['command_live_tool', 'answer']);
  assert.equal(latest.messages[1].content, 'Latest answer');
  const earlier = await adapter.readHistory({ sessionId: 'root', limit: 2,
    before: latest.next_cursor, includeAgentDetails: false });
  assert.deepEqual(earlier.messages.map(message => message.id), ['user', 'old-answer']);
  assert.equal(earlier.messages[1].content, oldAnswer);
  assert.equal(earlier.messages[0].attachments[0].relay_source.url, imageUrl);

  const remembered = adapter.threadMetadata.get('root');
  for (const key of ['turns', 'messages', 'attachments']) assert.equal(Object.hasOwn(remembered, key), false);
  assert.deepEqual(remembered.status, { type: 'active' });
  assert.deepEqual(remembered.gitInfo, { branch: 'main' });
  assert.ok(JSON.stringify(remembered).length < 1024);
  assert.equal(adapter.activeTurns.get('root'), 'live');
  const runningSince = new Date(1_700_000_010 * 1000).toISOString();
  assert.equal(adapter.toRelaySession({ id: 'root' }).running_started_at, runningSince);
  adapter.rememberThread({ id: 'root', status: { type: 'active' } });
  assert.equal(adapter.activeTurns.get('root'), 'live');
  assert.equal(adapter.toRelaySession({ id: 'root' }).running_started_at, runningSince);
});

test('agent panel keeps collaboration metadata after history without retaining root turns', async t => {
  const adapter = createAdapter(t);
  const root = { id: 'root', cwd: '/fixture', turns: [{ id: 'root-turn', items: [
    { id: 'spawn', type: 'collabAgentToolCall', tool: 'spawnAgent',
      receiverThreadIds: ['child'], prompt: 'Research the parser', model: 'fixture-model',
      reasoningEffort: 'high', agentsStates: { child: { status: 'pendingInit' } } },
  ] }] };
  adapter.request = async (method, params) => {
    if (method === 'thread/list') return { data: [
      { id: 'child', parentThreadId: 'root', status: { type: 'notLoaded' } },
    ] };
    assert.equal(method, 'thread/read');
    return { thread: params.threadId === 'root' ? structuredClone(root) : {
      id: 'child', turns: [{ status: 'completed', items: [
        { type: 'agentMessage', text: 'Research complete' },
      ] }],
    } };
  };
  await adapter.readHistory({ sessionId: 'root', includeAgentDetails: false });
  adapter.rememberThread({ id: 'root', status: { type: 'idle' } });
  assert.equal(Object.hasOwn(adapter.threadMetadata.get('root'), 'turns'), false);
  const [child] = await adapter.readAgents({ sessionId: 'root' });
  assert.equal(child.task, 'Research the parser');
  assert.equal(child.model, 'fixture-model');
  assert.equal(child.reasoning_effort, 'high');
  assert.equal(child.status, 'completed');
  assert.equal(child.summary, 'Research complete');
});

test('remembered collaboration metadata has count and byte limits and excludes arbitrary item payloads', t => {
  const adapter = createAdapter(t);
  const items = Array.from({ length: 200 }, (_, index) => ({
    id: `spawn-${index}`, type: 'collabAgentToolCall', tool: 'spawnAgent',
    receiverThreadIds: [`child-${index}`], prompt: 'p'.repeat(16_384),
    agentsStates: { [`child-${index}`]: { status: 'completed', message: 'm'.repeat(16_384),
      opaque: 'must-not-be-retained' } }, output: 'must-not-be-retained',
  }));
  adapter.rememberThread({ id: 'root', preview: 'v'.repeat(1_000_000),
    turns: [{ items }], opaque: 'must-not-be-retained' });
  const metadata = adapter.threadMetadata.get('root');
  assert.equal(metadata.preview.length, 2048);
  assert.ok(metadata.relayCollabItems.length <= 64);
  assert.ok(Buffer.byteLength(JSON.stringify(metadata.relayCollabItems)) <= 128 * 1024);
  assert.equal(metadata.relayCollabItems.at(-1).receiverThreadIds[0], 'child-199');
  assert.doesNotMatch(JSON.stringify(metadata), /must-not-be-retained/);
  for (const item of metadata.relayCollabItems) {
    assert.ok(item.prompt.length <= 2048);
    assert.ok(Object.values(item.agentsStates)[0].message.length <= 2048);
  }
  // The retained projection cannot mutate the caller's full history response.
  assert.equal(items.at(-1).prompt.length, 16_384);
  adapter.rememberThread({ id: 'root', turns: [] });
  assert.deepEqual(adapter.threadMetadata.get('root').relayCollabItems, []);
});
