import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexAppServerAdapter } from '../relay/codex-adapters.mjs';
import { findReplacementRollout } from '../relay/codex-rollout-path.mjs';

const id = 'thread-original';
const row = (type, payload) => JSON.stringify({ type, timestamp: '2026-10-01T10:00:00Z', payload }) + '\n';
const missing = () => Object.assign(new Error('ENOENT: no such file or directory, open missing.jsonl'), { code: 'ENOENT' });

async function fixture(t, { historyMode = 'legacy', policy = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'relayune-path-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'sessions', '2026', '10', '01');
  await mkdir(directory, { recursive: true });
  const path = join(directory, `rollout-new_${id}.jsonl`);
  const oldPath = join(directory, `rollout-deleted_${id}.jsonl`);
  const records = row('session_meta', { id, cwd: root, history_mode: historyMode, cli_version: '0.160.1' }) +
    (policy ? row('turn_context', { turn_id: 'turn', approval_policy: 'untrusted',
      sandbox_policy: { type: 'workspace-write', network_access: false, writable_roots: [root] } }) : '') +
    row('event_msg', { type: 'task_started', turn_id: 'turn' }) +
    row('event_msg', { type: 'item_completed', turn_id: 'turn', item: {
      type: 'UserMessage', id: 'original-user', content: [{ type: 'text', text: 'Original question' }] } }) +
    row('response_item', { type: 'message', id: 'original-answer', role: 'assistant', phase: 'final_answer',
      content: [{ type: 'output_text', text: 'Original answer' }], internal_chat_message_metadata_passthrough: { turn_id: 'turn' } }) +
    row('event_msg', { type: 'task_complete', turn_id: 'turn' });
  await writeFile(path, records);
  const a = new CodexAppServerAdapter({ workspace: root, codexSessionsRoot: join(root, 'sessions') });
  t.after(() => a.close());
  a.handlers = { emitEvent: async () => {} };
  a.refreshHistoryPermissions = () => {};
  a.readDesktopPermissions = async () => { throw new Error('No owner'); };
  a.verifyUserMessage = async () => true;
  a.rememberThread({ id, cwd: root, path: oldPath, historyMode, status: { type: 'notLoaded' } });
  const calls = [];
  const native = async (method, params) => {
    calls.push({ method, params });
    if (method === 'thread/queue/list') return { data: [] };
    if (method === 'thread/list') return { data: [] };
    if (method === 'thread/resume') return { thread: { id, path, cwd: root, status: { type: 'idle' } } };
    if (method === 'turn/start') return { turn: { id: 'new-turn' } };
    throw new Error(`Unexpected request: ${method}`);
  };
  return { a, root, path, oldPath, calls, native, records };
}

const history = a => a.readHistory({ sessionId: id, includeAgentDetails: false });
const send = a => a.submitMessage({ sessionId: id, content: 'Next question', clientMessageId: 'fixture-message' });

test('opening a stale catalog entry refreshes the path without acquiring a writer', async t => {
  const f = await fixture(t);
  f.a.nativeHistoryAvailable = false;
  f.a.request = async (method, params) => method === 'thread/read' ? { thread: {
    id, path: f.path, turns: params.includeTurns ? [{ id: 'turn', status: 'completed', items: [
      { id: 'native-answer', type: 'agentMessage', text: 'Original answer' },
    ] }] : undefined,
  } } : f.native(method, params);
  const page = await history(f.a);
  assert.ok(page.messages.some(message => message.content === 'Original answer'));
  assert.equal(f.a.threadMetadata.get(id).path, f.path);
  assert.ok(f.calls.every(call => call.method !== 'thread/resume'));
});

for (const limit of [100, 500]) test(`a stale native index recovers complete legacy history (${limit}) and then sends once with its original sandbox`, async t => {
  const f = await fixture(t);
  f.a.request = async (method, params) => {
    if (method === 'thread/read' || method === 'thread/turns/list') throw missing();
    return f.native(method, params);
  };
  const source = await readFile(f.path, 'utf8');
  const page = await f.a.readHistory({ sessionId: id, limit, includeAgentDetails: false });
  assert.deepEqual(page.messages.map(message => message.content), ['Original question', 'Original answer']);
  assert.equal(page.has_more, false);
  assert.equal(f.calls.some(call => call.method === 'thread/resume'), false);
  const result = await send(f.a);
  assert.equal(result.mode, 'started');
  const resumes = f.calls.filter(call => call.method === 'thread/resume');
  assert.equal(resumes.length, 1);
  assert.equal(resumes[0].params.path, f.path, 'bypass the stale provider path index after opening history');
  assert.equal(resumes[0].params.threadId, id);
  assert.equal(resumes[0].params.sandbox, 'workspace-write');
  assert.equal(resumes[0].params.approvalPolicy, 'untrusted');
  assert.equal(resumes[0].params.config['sandbox_workspace_write.network_access'], false);
  assert.deepEqual(resumes[0].params.config['sandbox_workspace_write.writable_roots'], [f.root]);
  assert.equal(f.calls.filter(call => call.method === 'turn/start').length, 1);
  assert.equal(await readFile(f.path, 'utf8'), source, 'recovery never rewrites native session files');
});

test('sending directly refreshes a missing path and preserves sandbox permissions', async t => {
  const f = await fixture(t);
  f.a.request = (method, params) => method === 'thread/read' ? { thread: { id, path: f.path } } : f.native(method, params);
  await send(f.a);
  const resume = f.calls.find(call => call.method === 'thread/resume');
  assert.equal(resume.params.path, f.path);
  assert.equal(resume.params.sandbox, 'workspace-write');
  assert.equal(resume.params.approvalPolicy, 'untrusted');
});

test('a matching filename containing a parent ID cannot redirect a send to its fork', async t => {
  const f = await fixture(t);
  const forkPath = join(f.root, 'sessions', `rollout-${id}_fork.jsonl`);
  await writeFile(forkPath, row('session_meta', { id: 'fork', forked_from_id: id }) + f.records);
  f.a.request = (method, params) => method === 'thread/read' ? { thread: { id, path: f.oldPath } } : f.native(method, params);
  await send(f.a);
  assert.equal(f.calls.find(call => call.method === 'thread/resume').params.path, f.path);
});

test('missing source, ambiguous copies, symlinks and missing policies never trigger a write', async t => {
  for (const kind of ['missing', 'ambiguous', 'symlink', 'no-policy', 'wrong-owner']) {
    await t.test(kind, async t => {
      const f = await fixture(t, { policy: kind !== 'no-policy' });
      if (kind === 'missing') await rm(f.path);
      if (kind === 'ambiguous') await copyFile(f.path, join(f.root, 'sessions', `copy-${id}.jsonl`));
      if (kind === 'symlink') {
        const outside = join(f.root, 'outside.jsonl');
        await copyFile(f.path, outside);
        await rm(f.path);
        await symlink(outside, f.path);
      }
      if (kind === 'wrong-owner') await writeFile(f.path, row('session_meta', { id: 'another-thread' }) + f.records);
      f.a.request = (method, params) => method === 'thread/read' ? { thread: { id, path: f.oldPath } } : f.native(method, params);
      await assert.rejects(send(f.a), /找不到|无法确认/);
      assert.equal(f.calls.filter(c => c.method !== 'thread/queue/list').length, 0);
      assert.equal(f.a.resumedThreads.size, 0);
    });
  }
});

test('a paginated source pointer cannot masquerade as complete recovered history', async t => {
  const f = await fixture(t, { historyMode: 'paginated' });
  f.a.request = async () => { throw missing(); };
  await assert.rejects(history(f.a), /ENOENT/);
});

test('provider-backed paginated history still opens when its JSONL is unavailable', async t => {
  const f = await fixture(t, { historyMode: 'paginated' });
  await rm(f.path);
  f.a.request = async (method, params) => {
    if (method === 'thread/read') return { thread: { id, path: f.oldPath, historyMode: 'paginated' } };
    if (method === 'thread/turns/list') return { data: [{ id: 'turn', status: 'completed', items: [] }], nextCursor: null };
    if (method === 'thread/items/list') return { data: [{ turnId: 'turn', item: {
      id: 'database-answer', type: 'agentMessage', text: 'Stored provider answer' } }], nextCursor: null };
    return f.native(method, params);
  };
  const page = await history(f.a);
  assert.deepEqual(page.messages.map(message => message.content), ['Stored provider answer']);
  assert.equal(f.calls.some(call => call.method === 'thread/resume'), false);
  await assert.rejects(send(f.a), /找不到/);
  assert.equal(f.calls.some(call => call.method === 'turn/start'), false);
});

test('a path resume returning another thread never starts a message', async t => {
  const f = await fixture(t);
  f.a.request = async (method, params) => {
    if (method === 'thread/read') return { thread: { id, path: f.path } };
    if (method === 'thread/resume') return { thread: { id: 'wrong-thread' } };
    return f.native(method, params);
  };
  await assert.rejects(send(f.a), /different conversation/);
  assert.equal(f.a.resumedThreads.size, 0);
  assert.equal(f.calls.some(call => call.method === 'turn/start'), false);
});

test('an unreadable current source remains an access error rather than being replaced', {
  skip: process.getuid?.() === 0 || process.platform === 'win32',
}, async t => {
  const f = await fixture(t);
  f.a.threadMetadata.get(id).path = f.path;
  f.a.request = async () => assert.fail('access denied must not trigger a recovery RPC');
  try {
    await chmod(f.path, 0);
    await assert.rejects(history(f.a), error => error.code === 'EACCES' || error.code === 'EPERM');
    await assert.rejects(send(f.a), error => error.code === 'EACCES' || error.code === 'EPERM');
  } finally { await chmod(f.path, 0o600); }
});

test('preferred recovery path must have the exact owner, even when its filename matches', async t => {
  const f = await fixture(t);
  await writeFile(f.oldPath, row('session_meta', { id: 'other' }));
  const found = await findReplacementRollout(join(f.root, 'sessions'), id, f.oldPath);
  assert.equal(found.path, f.path);
});

test('recovery accepts native instruction headers spanning multiple read chunks', async t => {
  const f = await fixture(t);
  const records = f.records.trim().split('\n').map(JSON.parse);
  records[0].payload.base_instructions = { text: 'Synthetic instructions '.repeat(10_000) };
  await writeFile(f.path, records.map(JSON.stringify).join('\n') + '\n');
  f.a.request = (method, params) => method === 'thread/read' ? { thread: { id, path: f.oldPath } } : f.native(method, params);
  await send(f.a);
  assert.equal(f.calls.find(call => call.method === 'thread/resume').params.path, f.path);
  assert.equal(f.calls.find(call => call.method === 'thread/resume').params.sandbox, 'workspace-write');
});
