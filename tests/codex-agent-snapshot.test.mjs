import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CodexAppServerAdapter } from '../relay/codex-adapters.mjs';

function adapterFor(t) {
  const adapter = new CodexAppServerAdapter({ workspace: '/fixture' });
  t.after(() => adapter.close());
  adapter.rememberThread({ id: 'root', cwd: '/fixture' });
  return adapter;
}

test('all 88 stored children recover their terminal state, task path and configured model', async t => {
  const adapter = adapterFor(t);
  const children = Array.from({ length: 88 }, (_, index) => ({
    id: `child-${index}`, parentThreadId: 'root', sessionId: `child-${index}`,
    agentNickname: `Nickname ${index}`, name: null, preview: '',
    model: 'fixture-sol', reasoningEffort: 'high', status: { type: 'notLoaded' },
    source: { subAgent: { thread_spawn: { agent_path: `/root/bench_r3_${index}_high` } } },
  }));
  adapter.rememberThread({ id: 'root', turns: [{ items: children.map(child => ({
    type: 'subAgentActivity', kind: 'started', agentThreadId: child.id,
    agentPath: `/root/stale_${child.id}`,
  })) }] });
  let reads = 0, inFlight = 0, peak = 0;
  adapter.request = async (method, params) => {
    if (method === 'thread/list') return params.cursor
      ? { data: children.slice(50), nextCursor: null }
      : { data: children.slice(0, 50), nextCursor: 'next' };
    assert.equal(method, 'thread/read');
    reads++; inFlight++; peak = Math.max(peak, inFlight);
    await new Promise(resolve => setImmediate(resolve));
    inFlight--;
    return { thread: { id: params.threadId, turns: [{ id: 'turn',
      status: params.threadId === 'child-87' ? 'interrupted' : 'completed',
      items: [{ type: 'agentMessage', text: `Reply ${params.threadId}` }],
    }] } };
  };
  const agents = await adapter.readAgents({ sessionId: 'root' });
  assert.equal(reads, 88);
  assert.ok(peak <= 8);
  assert.equal(agents.filter(agent => agent.status === 'completed').length, 87);
  assert.equal(agents.filter(agent => agent.status === 'interrupted').length, 1);
  assert.equal(agents.filter(agent => agent.status === 'running').length, 0);
  for (const [index, agent] of agents.entries()) {
    assert.equal(agent.name, `bench r3 ${index} high`);
    assert.equal(agent.nickname, `Nickname ${index}`);
    assert.equal(agent.model, 'fixture-sol');
    assert.equal(agent.reasoning_effort, 'high');
    assert.equal(agent.summary, `Reply child-${index}`);
    assert.equal(adapter.threadMetadata.get(agent.id).agentPath, `/root/bench_r3_${index}_high`);
  }
});

test('live child events, collaboration items and snapshots keep the same root with independent session IDs', async t => {
  const adapter = adapterFor(t);
  adapter.rememberThread({ id: 'root', sessionId: 'fork-origin' });
  adapter.rememberThread({ id: 'parent', parentThreadId: 'root', sessionId: 'parent' });
  adapter.rememberThread({ id: 'child', parentThreadId: 'parent', sessionId: 'child' });
  const events = [];
  adapter.handlers = { emitEvent: async (sessionId, event, extra) => events.push({ sessionId, event, extra }) };
  await adapter.emitAgentThreadEvent('child', { kind: 'agent.progress', agent_status: 'running' });
  await adapter.handleItem('parent', 'turn', {
    type: 'subAgentActivity', kind: 'interacted', agentThreadId: 'child', agentPath: '/root/parent/child',
  }, true);
  await adapter.handleItem('parent', 'turn', {
    type: 'collabAgentToolCall', tool: 'wait', senderThreadId: 'parent',
    receiverThreadIds: ['child'], agentsStates: { child: { status: 'completed' } },
  }, true);
  assert.equal(events.length, 3);
  for (const { sessionId, event, extra } of events) {
    assert.equal(sessionId, 'root');
    assert.equal(event.root_session_id, 'root');
    assert.equal(event.parent_thread_id, 'parent');
    assert.equal(extra.agent_id, 'child');
  }
  adapter.syncExternalRolloutActivity = async () => {};
  adapter.request = async (method, params) => {
    if (method === 'thread/list') {
      assert.equal(params.ancestorThreadId, 'root');
      return { data: [adapter.threadMetadata.get('parent'), adapter.threadMetadata.get('child')] };
    }
    return { thread: { id: params.threadId, turns: [{ status: 'completed', items: [] }] } };
  };
  const snapshot = await adapter.readAgents({ sessionId: 'parent' });
  assert.deepEqual(snapshot.map(agent => agent.parent_session_id), ['root', 'root']);
});

test('unknown or cyclic parents never route a child as its own root', async t => {
  const adapter = adapterFor(t);
  adapter.request = async () => { throw new Error('Parent unavailable'); };
  adapter.rememberThread({ id: 'child', parentThreadId: 'missing', sessionId: 'child' });
  adapter.rememberThread({ id: 'a', parentThreadId: 'b', sessionId: 'a' });
  adapter.rememberThread({ id: 'b', parentThreadId: 'a', sessionId: 'b' });
  const events = [];
  adapter.handlers = { emitEvent: async (...args) => events.push(args) };
  await adapter.emitAgentThreadEvent('child', { kind: 'agent.started' });
  await adapter.emitAgentThreadEvent('a', { kind: 'agent.started' });
  assert.deepEqual(events, []);
});

test('external rollout items without a thread_id keep the source parent and canonical root', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'relayune-agent-root-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'parent.jsonl');
  await writeFile(path, '{}\n');
  const adapter = adapterFor(t);
  const parent = { id: 'parent', parentThreadId: 'root', sessionId: 'parent', path };
  adapter.rememberThread(parent);
  adapter.rememberThread({ id: 'child', parentThreadId: 'parent', sessionId: 'child' });
  adapter.syncExternalQuestions = async () => {};
  adapter.refreshExternalDesktopState = async () => {};
  const events = [];
  adapter.handlers = { emitEvent: async (sessionId, event, extra) => events.push({ sessionId, event, extra }) };
  await adapter.pollExternalRolloutActivity(parent);
  await appendFile(path, JSON.stringify({ type: 'event_msg', payload: {
    type: 'item_completed', turn_id: 'turn', item: {
      type: 'SubAgentActivity', kind: 'started', agent_thread_id: 'child', agent_path: '/root/parent/child',
    },
  } }) + '\n');
  await adapter.pollExternalRolloutActivity(parent);
  assert.equal(events.length, 1);
  assert.equal(events[0].sessionId, 'root');
  assert.equal(events[0].event.root_session_id, 'root');
  assert.equal(events[0].event.parent_thread_id, 'parent');
});

test('a child read failure is unknown without hiding successfully recovered siblings', async t => {
  const adapter = adapterFor(t);
  adapter.request = async (method, params) => {
    if (method === 'thread/list') return { data: ['a', 'b'].map(id => ({
      id, parentThreadId: 'root', status: { type: 'notLoaded' },
    })) };
    if (params.threadId === 'a') throw new Error('Read failed');
    return { thread: { id: 'b', turns: [{ status: 'completed', items: [] }] } };
  };
  const agents = await adapter.readAgents({ sessionId: 'root' });
  assert.deepEqual(agents.map(agent => agent.status), ['unknown', 'completed']);
});

test('child conversation configuration uses its stored model instead of the catalog default', t => {
  const adapter = adapterFor(t);
  adapter.modelCatalog = [
    { model: 'default-model', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] },
    { model: 'child-model', defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] },
  ];
  adapter.rememberThread({ id: 'child', parentThreadId: 'root', model: 'child-model', reasoningEffort: 'high' });
  const child = adapter.toRelaySession({ id: 'child' });
  assert.equal(child.model, 'child-model');
  assert.equal(child.reasoning_effort, 'high');
  assert.equal(child.session_config_options.find(option => option.id === 'model').currentValue, 'child-model');
});

test('terminal detail cache invalidates on appended source and never retains full turns', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'relayune-agent-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'child.jsonl');
  await writeFile(path, '{}\n');
  const adapter = adapterFor(t);
  let reads = 0;
  const children = [{ id: 'child', path, updatedAt: 42 }];
  const request = async () => {
    reads++;
    return { thread: { id: 'child', turns: [{ status: 'completed', items: [
      { type: 'commandExecution', aggregatedOutput: 'PRIVATE_TOOL_OUTPUT' },
      { type: 'agentMessage', text: `Reply ${reads}` },
    ] }] } };
  };
  await adapter.loadAgentDetails(children, { request });
  assert.equal((await adapter.loadAgentDetails(children, { request })).get('child').summary, 'Reply 1');
  assert.equal(reads, 1);
  assert.doesNotMatch(JSON.stringify([...adapter.agentDetailCache.values()]), /PRIVATE_TOOL_OUTPUT|turns/);
  await appendFile(path, '{}\n');
  assert.equal((await adapter.loadAgentDetails(children, { request })).get('child').summary, 'Reply 2');
  adapter.advanceThreadRuntimeRevision('child');
  await adapter.loadAgentDetails(children, { request });
  assert.equal(reads, 3);
});

test('a live Desktop child is not misreported as interrupted by an independent reader', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'relayune-agent-live-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'child.jsonl');
  await writeFile(path, JSON.stringify({ type: 'event_msg', payload: {
    type: 'task_started', turn_id: 'live',
  } }) + '\n');
  const adapter = adapterFor(t);
  const children = [{ id: 'child', path, status: { type: 'notLoaded' } }];
  const request = async () => ({ thread: { id: 'child', status: { type: 'notLoaded' },
    turns: [{ id: 'live', status: 'interrupted', items: [] }],
  } });
  const details = await adapter.loadAgentDetails(children, { request });
  assert.equal(details.get('child').turnStatus, 'inProgress');
  assert.equal(adapter.agentDetailCache.size, 0);
});
