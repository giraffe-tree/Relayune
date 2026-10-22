import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { readFileSync, writeFileSync } from 'node:fs';
import { CodexAppServerAdapter } from '../relay/codex-adapters.mjs';
import { PiAdapter } from '../relay/pi-adapter.mjs';
import { piHistoryMessages, piForkReply } from '../relay/pi-history.mjs';
import { KimiCodeAdapter, acpHistoryForkTailSafe, kimiForkTailSafeFromWire } from '../relay/kimi-adapter.mjs';

const rejects = (operation, code) => assert.rejects(operation, error => error.code === code && error.message === code);
const answer = id => ({ type: 'agentMessage', id, phase: 'final_answer', text: 'native ' + id });
function codexFixture() {
  const adapter = new CodexAppServerAdapter({ workspace: '/fixture' });
  const source = { id: 'source', cwd: '/fixture', status: { type: 'idle' }, turns: [
    { id: 'first', status: 'completed', items: [answer('reply-first')] },
    { id: 'later', status: 'completed', items: [answer('reply-later')] },
  ] };
  const records = new Map([['source', source]]), calls = [];
  adapter.request = async (method, params) => {
    calls.push({ method, params });
    if (method === 'thread/read') return { thread: structuredClone(records.get(params.threadId)) };
    if (method === 'thread/fork') {
      const fork = { ...structuredClone(source), id: 'fork-' + records.size, cwd: params.cwd,
        turns: structuredClone(source.turns.slice(0, source.turns.findIndex(t => t.id === params.lastTurnId) + 1)) };
      records.set(fork.id, fork); return { thread: fork };
    }
    assert.fail('Unexpected method ' + method);
  };
  return { adapter, source, records, calls };
}

test('Codex branches through the selected completed native reply, without later history or a prompt', async () => {
  const f = codexFixture(), before = structuredClone(f.source);
  const fork = await f.adapter.forkSession({ sessionId: 'source', turnId: 'first', messageId: 'reply-first', cwd: '/worktree' });
  assert.equal(fork.cwd, '/worktree'); assert.notEqual(fork.id, 'source'); assert.equal(fork.sync_state, 'persisted');
  assert.deepEqual(f.records.get(fork.id).turns.map(t => t.id), ['first']);
  assert.deepEqual(f.source, before);
  const call = f.calls.find(call => call.method === 'thread/fork');
  assert.equal(call.params.lastTurnId, 'first'); assert.equal(call.params.deferGoalContinuation, true);
  assert.equal(f.calls.some(call => call.method === 'turn/start'), false);
  assert.equal(f.adapter.resumedThreads.has(fork.id), true);
});

test('Codex permits the known live reply alias, rejects analysis, earlier same-turn replies, busy and goals', async () => {
  const f = codexFixture();
  await f.adapter.forkSource({ sessionId: 'source', turnId: 'first', messageId: 'codex_first' });
  await f.adapter.forkSource({ sessionId: 'source', turnId: 'first', messageId: 'agent_first' });
  await f.adapter.forkSource({ sessionId: 'source', turnId: 'first', messageId: 'agent_first_reply-first' });
  f.source.turns[0].items.unshift(answer('earlier-reply'));
  await rejects(f.adapter.forkSource({ sessionId: 'source', turnId: 'first', messageId: 'earlier-reply' }), 'session_fork_invalid_reply');
  await rejects(f.adapter.forkSource({ sessionId: 'source', turnId: 'first', messageId: 'agent_first_earlier-reply' }), 'session_fork_invalid_reply');
  f.source.turns[0].items.at(-1).phase = 'analysis';
  await rejects(f.adapter.forkSource({ sessionId: 'source', turnId: 'first', messageId: 'reply-first' }), 'session_fork_invalid_reply');
  f.source.turns[0].status = 'inProgress';
  await rejects(f.adapter.forkSource({ sessionId: 'source', turnId: 'first', messageId: 'reply-first' }), 'session_fork_busy');
  f.source.goal = { status: 'active' };
  await rejects(f.adapter.forkSource({ sessionId: 'source', turnId: 'first', messageId: 'reply-first' }), 'session_fork_unsupported');
  assert.equal(f.calls.some(call => call.method === 'thread/fork'), false);
});

test('Codex reports an uncertain dispatched fork rather than suggesting a safe retry', async () => {
  const f = codexFixture(), original = f.adapter.request;
  f.adapter.request = async (method, params) => { if (method === 'thread/fork') throw new Error('/private/source RPC timeout'); return original(method, params); };
  await rejects(f.adapter.forkSession({ sessionId: 'source', turnId: 'first', messageId: 'reply-first' }), 'session_fork_outcome_unknown');
});

test('Codex refuses success when a native version silently ignores the cutoff field', async () => {
  const f = codexFixture(), original = f.adapter.request;
  f.adapter.request = async (method, params) => {
    if (method === 'thread/fork') {
      const fork = { ...structuredClone(f.source), id: 'already-persisted-full-copy' };
      f.records.set(fork.id, fork); return { thread: fork };
    }
    return original(method, params);
  };
  await rejects(f.adapter.forkSession({ sessionId: 'source', turnId: 'first', messageId: 'reply-first' }),
    'session_fork_outcome_unknown');
});

async function piFixture(t) {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'relayune-native-fork-'))), children = [];
  const spawnProcess = (_bin, args) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.commands = [];
    const path = args[args.indexOf('--session') + 1];
    const records = readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse), header = records[0];
    child.send = message => child.stdout.write(JSON.stringify(message) + '\n');
    child.stdin = new Writable({ write(buffer, _encoding, done) {
      const command = JSON.parse(buffer); child.commands.push(command); let data = {};
      if (command.type === 'get_commands') data.commands = ['relayune-capabilities','relayune-turn','relayune-fork'].map(name => ({ name }));
      if (command.type === 'get_state') data = { sessionId: header.id, model: { id: 'test', provider: 'test' } };
      if (command.type === 'get_available_models') data.models = [];
      if (command.type === 'prompt') {
        assert.ok(command.message.startsWith('/relayune-fork '));
        const request = JSON.parse(command.message.slice('/relayune-fork '.length));
        const cutoff = records.findIndex(entry => entry.id === request.entryId), id = 'new-native-fork';
        const forkPath = join(request.sessionDir, id + '.jsonl');
        writeFileSync(forkPath, [ { type: 'session', version: 3, id, cwd: request.cwd }, ...records.slice(1, cutoff + 1),
          { type: 'custom', id: 'managed', parentId: request.entryId, customType: 'relayune-managed', data: { version: 1 } } ].map(JSON.stringify).join('\n') + '\n');
        // A wrong/late command cannot acknowledge this request; the matching
        // notification deliberately precedes the ordinary prompt response.
        child.send({ type: 'extension_ui_request', method: 'notify', message: JSON.stringify({ bridge: 'relayune-pi-fork-v1', requestId: 'other', id: 'wrong' }) });
        child.send({ type: 'extension_ui_request', method: 'notify', message: JSON.stringify({ bridge: 'relayune-pi-fork-v1', requestId: request.requestId, id, path: forkPath, cwd: request.cwd }) });
      }
      queueMicrotask(() => child.send({ type: 'response', id: command.id, command: command.type, success: true, data })); done();
    } });
    child.kill = () => { queueMicrotask(() => child.emit('close', 0)); return true; };
    children.push(child); return child;
  };
  const adapter = new PiAdapter({ piHome: folder, workspace: folder, spawnProcess, probe: async () => '0.85.1' });
  await adapter.start({ emitEvent: async () => {}, requestApproval: async () => {} });
  const created = await adapter.createSession({ cwd: folder, name: 'Fixture' });
  const source = await adapter.metadata(created.id);
  source.header.relayuneSourceId = 'external-original';
  const branch = [
    { type: 'custom', id: 'turn1', parentId: null, customType: 'relayune-turn', data: { turnId: 'turn_pi_one', userId: 'one' } },
    { type: 'message', id: 'u1', parentId: 'turn1', message: { role: 'user', content: 'first' } },
    { type: 'message', id: 'tool-call', parentId: 'u1', message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'text', text: 'reading' }] } },
    { type: 'message', id: 'tool-result', parentId: 'tool-call', message: { role: 'toolResult', content: 'tool context' } },
    { type: 'message', id: 'a1', parentId: 'tool-result', message: { role: 'assistant', stopReason: 'stop', content: 'first reply' } },
    { type: 'custom', id: 'turn2', parentId: 'a1', customType: 'relayune-turn', data: { turnId: 'turn_pi_two', userId: 'two' } },
    { type: 'message', id: 'u2', parentId: 'turn2', message: { role: 'user', content: 'later' } },
    { type: 'message', id: 'a2', parentId: 'u2', message: { role: 'assistant', stopReason: 'stop', content: 'later reply' } },
  ];
  await writeFile(source.path, [source.header, ...branch].map(JSON.stringify).join('\n') + '\n');
  const logicalId = 'pi_external-original'; adapter.sessions.clear(); await adapter.listSessions();
  t.after(async () => { await adapter.close(); await rm(folder, { recursive: true, force: true }); });
  return { adapter, source, branch, folder, children, logicalId };
}

test('Pi aggregates native reply/tool context and only marks the final completed assistant as branchable', () => {
  const session = { header: { id: 'source' }, branch: [
    { type: 'message', id: 'user', message: { role: 'user', content: 'prompt' } },
    { type: 'message', id: 'tool', message: { role: 'assistant', content: 'before', stopReason: 'toolUse' } },
    { type: 'message', id: 'result', message: { role: 'toolResult', content: 'tool result' } },
    { type: 'message', id: 'final', message: { role: 'assistant', content: 'after', stopReason: 'stop' } },
  ] };
  const options = { messageId: 'codex_turn_pi_user', turnId: 'turn_pi_user' };
  assert.equal(piForkReply(session, options).id, 'final');
  assert.equal(piForkReply(session, { ...options, messageId: 'agent_turn_pi_user' }).id, 'final');
  assert.equal(piHistoryMessages(session).find(m => m.role === 'codex').turn_status, 'completed');
  session.branch.push({ type: 'message', id: 'late-tool', message: { role: 'toolResult', content: 'pending' } });
  assert.equal(piForkReply(session, options), null);
});

test('Pi correlated native fork persists new identity/cwd and never inherits a continued-source alias', async t => {
  const f = await piFixture(t), cwd = join(f.folder, 'worktree'); await mkdir(cwd);
  const before = await readFile(f.source.path, 'utf8');
  const fork = await f.adapter.forkSession({ sessionId: f.logicalId, messageId: 'codex_turn_pi_one', turnId: 'turn_pi_one', cwd });
  assert.equal(fork.id, 'pi_new-native-fork'); assert.equal(fork.cwd, cwd); assert.equal(fork.sync_state, 'persisted');
  assert.equal(await readFile(f.source.path, 'utf8'), before); assert.equal(f.adapter.connections.size, 0);
  assert.equal(f.children[0].commands.filter(command => command.type === 'prompt').length, 1);
  assert.deepEqual((await f.adapter.readHistory({ sessionId: fork.id })).messages.map(m => m.content), ['first', 'readingfirst reply', 'tool context']);
  const restarted = new PiAdapter({ piHome: f.folder });
  assert.ok((await restarted.listSessions()).some(session => session.id === fork.id && session.cwd === cwd));
  f.adapter.activeTurns.set(f.logicalId, { id: 'active' });
  await rejects(f.adapter.forkSession({ sessionId: f.logicalId, messageId: 'codex_turn_pi_one', turnId: 'turn_pi_one' }), 'session_fork_busy');
  assert.equal(f.children.length, 1); f.adapter.activeTurns.clear();
});

function acpFixture(provider = 'kimi') {
  const messages = [ { id: 'old', role: 'codex', content: 'old', turn_id: 'old-turn' },
    { id: 'user-latest', role: 'user', content: 'new', turn_id: 'latest-turn' },
    { id: 'latest', role: 'codex', content: 'new reply', turn_id: 'latest-turn' } ];
  const adapter = new KimiCodeAdapter({ provider, historyReader: async () => ({ messages, fork_tail_safe: true }),
    sessionStateReader: async () => new Map(provider === 'kimi' ? [['source', { status: 'idle', turn_status: 'completed' }]] : []) });
  adapter.capabilities = { sessionCapabilities: { fork: {} } };
  adapter.rememberSession({ sessionId: 'source', cwd: '/fixture', updatedAt: '2026-10-06T00:00:00Z' });
  adapter.completedForkTurns.set('source', { turnId: 'live-turn', text: 'new reply' });
  const calls = []; adapter.client = { request: async (method, params) => { calls.push({ method, params }); return { sessionId: 'new-fork' }; } };
  return { adapter, messages, calls };
}

test('ACP latest-only validates native tail before fork and never offers worktree or ZCode inheritance', async () => {
  const f = acpFixture('mcode');
  await rejects(f.adapter.forkSource({ sessionId: 'source', messageId: 'old', turnId: 'old-turn' }), 'session_fork_latest_only');
  await rejects(f.adapter.forkSession({ sessionId: 'source', messageId: 'latest', turnId: 'latest-turn', cwd: '/worktree' }), 'session_fork_unsupported');
  assert.equal(f.calls.length, 0);
  const fork = await f.adapter.forkSession({ sessionId: 'source', messageId: 'latest', turnId: 'latest-turn' });
  assert.equal(fork.id, 'new-fork'); assert.equal(fork.cwd, '/fixture');
  assert.deepEqual(f.calls.map(call => call.method), ['session/fork']);
  const unknown = acpFixture('opencode'); unknown.adapter.completedForkTurns.clear();
  assert.equal(unknown.adapter.forkCapabilities({ id: 'source' }), null);
  await rejects(unknown.adapter.forkSource({ sessionId: 'source', messageId: 'latest', turnId: 'latest-turn' }), 'session_fork_invalid_reply');
  assert.equal(acpFixture('zcode').adapter.forkCapabilities(), null);
});

test('ACP never treats hidden pending tools, later user input or native active state as a completed latest reply', async () => {
  const text = { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'reply' } };
  assert.equal(acpHistoryForkTailSafe([text]), true);
  assert.equal(acpHistoryForkTailSafe([text, { sessionUpdate: 'tool_call', toolCallId: 'question', status: 'pending' }]), false);
  assert.equal(acpHistoryForkTailSafe([{ sessionUpdate: 'tool_call', toolCallId: 't', status: 'in_progress' }, text]), false);
  assert.equal(acpHistoryForkTailSafe([text, { sessionUpdate: 'user_message_chunk', content: { type: 'image' } }]), false);
  const f = acpFixture(); f.adapter.sessionStateReader = async () => new Map([['source', { status: 'idle', turn_status: 'running' }]]);
  await rejects(f.adapter.forkSession({ sessionId: 'source', messageId: 'latest', turnId: 'latest-turn' }), 'session_fork_busy');
  assert.equal(f.calls.length, 0);
});

test('ACP detects another writer changing the native tail between validation and whole-session fork', async () => {
  const f = acpFixture('mcode');
  f.adapter.client.request = async () => {
    f.messages.push({ id: 'racing-user', role: 'user', content: 'started elsewhere', turn_id: 'racing-turn' });
    return { sessionId: 'already-persisted-fork' };
  };
  await rejects(f.adapter.forkSession({ sessionId: 'source', messageId: 'latest', turnId: 'latest-turn' }),
    'session_fork_outcome_unknown');
});

test('ACP does not infer a native boundary from a stale live alias, even when a later reply repeats the same text', async () => {
  const f = acpFixture('kimi');
  f.messages.push({ id: 'other-user', role: 'user', content: 'another native turn', turn_id: 'other-turn' },
    { id: 'other-reply', role: 'codex', content: 'new reply', turn_id: 'other-turn' });
  await rejects(f.adapter.forkSession({ sessionId: 'source', messageId: 'codex_live-turn', turnId: 'live-turn' }),
    'session_fork_invalid_reply');
  await rejects(f.adapter.forkSession({ sessionId: 'source', messageId: 'latest', turnId: 'latest-turn' }),
    'session_fork_latest_only');
  assert.equal(f.calls.length, 0);
  assert.equal((await f.adapter.forkSource({ sessionId: 'source', messageId: 'other-reply', turnId: 'other-turn' })).id, 'source');
});

test('Kimi native wire tail includes hidden image-only input and later tool/question boundaries', async () => {
  const completed = [ { type: 'turn.prompt', input: [{ type: 'text', text: 'first' }] },
    { type: 'context.append_loop_event', event: { type: 'step.begin' } },
    { type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: 'reply' } } },
    { type: 'context.append_loop_event', event: { type: 'step.end', finishReason: 'end_turn' } } ];
  const encode = records => records.map(JSON.stringify).join('\n');
  assert.equal(kimiForkTailSafeFromWire(encode(completed)), true);
  assert.equal(kimiForkTailSafeFromWire(encode([...completed,
    { type: 'turn.prompt', input: [{ type: 'image_url', image_url: { url: 'fixture-image' } }] },
    { type: 'context.append_loop_event', event: { type: 'step.begin' } },
    { type: 'context.append_loop_event', event: { type: 'step.end', finishReason: 'end_turn' } } ])), false);
  assert.equal(kimiForkTailSafeFromWire(encode([...completed,
    { type: 'context.append_loop_event', event: { type: 'tool.call', name: 'AskUserQuestion' } }])), false);
  const f = acpFixture(); f.adapter.historyReader = async () => ({ messages: f.messages, fork_tail_safe: false });
  await rejects(f.adapter.forkSession({ sessionId: 'source', messageId: 'latest', turnId: 'latest-turn' }), 'session_fork_invalid_reply');
  assert.equal(f.calls.length, 0);
});

test('Kimi fork first continuation must pass the existing advertised manual-mode gate before prompting', async () => {
  const f = acpFixture();
  f.adapter.capabilities.sessionCapabilities.resume = {};
  const configOptions = [{ id: 'mode', name: 'Permissions', type: 'select', currentValue: 'default',
    options: [{ value: 'default', name: 'Manual' }] }];
  f.adapter.client.request = async (method, params) => {
    f.calls.push({ method, params });
    if (method === 'session/set_config_option') throw new Error('manual mode gate failed');
    return { sessionId: 'new-fork', configOptions };
  };
  const fork = await f.adapter.forkSession({ sessionId: 'source', messageId: 'latest', turnId: 'latest-turn' });
  assert.equal(f.adapter.activeSessions.has(fork.id), false);
  await assert.rejects(f.adapter.submitMessage({ sessionId: fork.id, content: 'continue' }), /manual mode gate failed/);
  assert.deepEqual(f.calls.map(call => call.method), ['session/fork', 'session/resume', 'session/set_config_option']);
});
