import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { isFileAccessError } from '../relay/file-access.mjs';
import { MacRelay } from '../relay/mac-relay.mjs';
import { MultiAgentAdapter } from '../relay/multi-agent-adapter.mjs';
import { CodexAppServerAdapter } from '../relay/codex-adapters.mjs';
import { permissionSettings } from '../relay/codex-permissions.mjs';
import { readClaudeSessionCatalog } from '../relay/claude-adapter.mjs';
import { generateE2eeKey, importE2eeKey, keyIdForKey, openJson } from '../relay/e2ee.mjs';

const denied = () => Object.assign(new Error("EPERM: operation not permitted, open '/private/session.jsonl'"), { code: 'EPERM' });
const page = { messages: [], has_more: false, next_cursor: null };
function createRelay(adapter = {}) {
  return new MacRelay({ adapter, statePath: null, deviceId: 'device', workspace: '/tmp' });
}
function command(sessionId) {
  return { type: 'session.read_history', device_id: 'device', session_id: sessionId,
    request_id: `history_${sessionId}`, expires_at: new Date(Date.now() + 60000).toISOString() };
}

test('permission classification recognizes OS and RPC errors without mistaking missing files or network failures', () => {
  for (const error of [denied(), { code: 'EACCES' }, new Error('Permission denied (os error 13)'), new Error('Operation not permitted (os error 1)'), new AggregateError([denied()])]) {
    assert.equal(isFileAccessError(error), true);
  }
  for (const error of [null, { code: 'ENOENT', message: 'No such file' }, new Error('request timed out'), new Error('Unauthorized API key')]) {
    assert.equal(isFileAccessError(error), false);
  }
  const cyclic = new Error('unrelated'); cyclic.cause = cyclic;
  assert.equal(isFileAccessError(cyclic), false);
});

test('history denial has a stable error code, preserves separate failures and recovers only after successful reads', async (t) => {
  const blocked = new Set(['a', 'b']);
  const relay = createRelay({ readHistory: async ({ sessionId }) => { if (blocked.has(sessionId)) throw denied(); return page; }, listSessions: async () => [] });
  const messages = []; const diagnostics = [];
  relay.send = message => { messages.push(message); return true; };
  t.mock.method(console, 'log', line => diagnostics.push(line));
  await relay.readHistory(command('a'));
  await relay.readHistory(command('b'));
  const failure = messages.find(message => message.type === 'session.history_error');
  assert.equal(failure.error_code, 'file_access_denied');
  assert.equal(JSON.stringify(failure).includes('/private/'), false);
  blocked.delete('a');
  await relay.readHistory(command('a'));
  assert.equal(relay.fileAccessWarningActive, true);
  assert.deepEqual(diagnostics, ['Relayune file access limited']);
  blocked.clear(); relay.ready = true;
  await relay.retryFileAccess();
  assert.equal(relay.fileAccessWarningActive, false);
  assert.deepEqual(diagnostics, ['Relayune file access limited', 'Relayune file access recovered']);
  assert.equal(messages.at(-1).type, 'relay.sync_sessions');
});

test('catalog denial preserves the last successful records while other providers stay usable', async (t) => {
  t.mock.method(console, 'log', () => {});
  let blocked = false;
  const multi = new MultiAgentAdapter({ adapters: {
    claude: { listSessions: async () => { if (blocked) throw denied(); return [{ id: 'claude', updated_at: '2026-01-01' }]; } },
    codex: { listSessions: async () => [{ id: 'codex', updated_at: '2026-01-01' }] },
  } });
  multi.readyProviders = new Set(['claude', 'codex']);
  const relay = createRelay(multi);
  assert.equal((await relay.readSessionCatalog()).length, 2);
  blocked = true;
  assert.equal((await relay.readSessionCatalog()).length, 2);
  assert.equal(relay.fileAccessWarningActive, true);
  blocked = false;
  await relay.readSessionCatalog();
  assert.equal(relay.fileAccessWarningActive, false);
});

test('file-access status stays inside the encrypted catalog and changes its delivery fingerprint', async (t) => {
  t.mock.method(console, 'log', () => {});
  const relay = createRelay();
  const key = await importE2eeKey(generateE2eeKey());
  const browser = { browserId: 'browser', key, keyId: await keyIdForKey(key) };
  relay.activeBrowserKeys.set('browser', browser);
  const catalog = { type: 'relay.sync_sessions', sessions: [], projects: [] };
  const [healthy] = await relay.encodeRemoteMessage(catalog);
  relay.rememberSuccessfulCatalogUpload(healthy);
  assert.deepEqual(await relay.encodeRemoteMessage(catalog), []);
  relay.updateFileAccess('catalog', true);
  const [limited] = await relay.encodeRemoteMessage(catalog);
  assert.ok(limited);
  assert.equal('file_access_limited' in limited, false);
  assert.equal((await openJson(key, limited.envelope, limited.aad)).file_access_limited, true);
  relay.rememberSuccessfulCatalogUpload(limited);
  relay.updateFileAccess('catalog', false);
  assert.equal((await relay.encodeRemoteMessage(catalog)).length, 1);
});

test('Codex RPC permission denial is returned immediately rather than retried as an empty history', async () => {
  const adapter = new CodexAppServerAdapter({
    workspace: '/tmp',
    desktopPermissions: async () => permissionSettings('default', null, '/tmp'),
  });
  const requests = [];
  const error = new Error('Permission denied (os error 13)');
  adapter.request = async (method, params) => { requests.push({ method, params }); throw error; };
  await assert.rejects(adapter.readHistory({ sessionId: 'denied' }), actual => actual === error);
  assert.deepEqual(requests, [{ method: 'thread/read', params: { threadId: 'denied', includeTurns: false } }]);
});

test('Claude unreadable project folders do not silently become an empty catalog', async (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) return t.skip('POSIX permission fixture');
  const root = await mkdtemp(join(tmpdir(), 'relayune-file-access-'));
  const project = join(root, 'projects', 'protected');
  await mkdir(project, { recursive: true });
  await writeFile(join(project, 'session.jsonl'), '{}\n');
  try {
    await chmod(project, 0);
    await assert.rejects(readClaudeSessionCatalog({ claudeHome: root }), isFileAccessError);
    await chmod(project, 0o700);
    assert.deepEqual(await readClaudeSessionCatalog({ claudeHome: root }), []);
  } finally {
    await chmod(project, 0o700);
    await rm(root, { recursive: true, force: true });
  }
});

test('a provider blocked during startup recovers without restarting a healthy agent', async () => {
  let blocked = true; let healthyStarts = 0;
  const adapter = new MultiAgentAdapter({ adapters: {
    claude: { start: async () => { if (blocked) throw denied(); }, close: async () => {} },
    codex: { start: async () => { healthyStarts++; } },
  } });
  await adapter.start({ emitEvent: async () => {}, requestApproval: async () => {} });
  assert.equal(adapter.fileAccessLimited(), true);
  blocked = false;
  await adapter.retryFileAccess();
  assert.equal(adapter.fileAccessLimited(), false);
  assert.deepEqual([...adapter.readyProviders].sort(), ['claude', 'codex']);
  assert.equal(healthyStarts, 1);
});

test('all providers denied file access still allow relay to connect and deliver recovery guidance', async () => {
  const adapter = new MultiAgentAdapter({ adapters: { claude: { start: async () => { throw denied(); } } } });
  await adapter.start({ emitEvent: async () => {}, requestApproval: async () => {} });
  assert.deepEqual(await adapter.listSessions(), []);
  assert.equal(adapter.fileAccessLimited(), true);
});

test('an unreadable Claude folder does not hide other readable projects', async (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) return t.skip('POSIX permission fixture');
  const root = await mkdtemp(join(tmpdir(), 'relayune-partial-access-'));
  const blocked = join(root, 'projects', 'blocked');
  const readable = join(root, 'projects', 'readable');
  await mkdir(blocked, { recursive: true });
  await mkdir(readable, { recursive: true });
  await writeFile(join(readable, '11111111-1111-4111-8111-111111111111.jsonl'), JSON.stringify({ type: 'user', cwd: '/tmp/project', message: { content: 'Hello' } }) + '\n');
  try {
    await chmod(blocked, 0);
    let denials = 0;
    const sessions = await readClaudeSessionCatalog({ claudeHome: root, onFileAccessError: () => { denials++; } });
    assert.equal(denials, 1);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].sessionId, '11111111-1111-4111-8111-111111111111');
  } finally {
    await chmod(blocked, 0o700);
    await rm(root, { recursive: true, force: true });
  }
});

test('closing the relay during a permission retry never starts an agent afterwards', async () => {
  let releaseClose; let starts = 0;
  const adapter = new MultiAgentAdapter({ adapters: { claude: {
    start: async () => { starts++; throw denied(); },
    close: () => new Promise(resolve => { releaseClose = resolve; }),
  } } });
  await adapter.start({ emitEvent: async () => {}, requestApproval: async () => {} });
  const retry = adapter.retryFileAccess();
  const finishFirstClose = releaseClose;
  const closing = adapter.close();
  releaseClose();
  finishFirstClose();
  await Promise.all([retry, closing]);
  assert.equal(starts, 1);
});
