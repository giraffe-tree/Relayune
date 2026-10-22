import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ClaudeCodeAdapter } from '../relay/claude-adapter.mjs';
import { readClaudePermissionModes, verifyClaudePermissionMode, permissionOptions, samePermissionMode } from '../relay/claude-permissions.mjs';
const fixture = fileURLToPath(new URL('./fixtures/fake-claude-code.mjs', import.meta.url));
const native = { command: process.execPath, args: [fixture], cwd: process.cwd() };
const options = { claudeBin: process.execPath, claudeArgs: [fixture], catalogReader: async () => [] };

test('Claude permission discovery uses native help, maps manual/default, and verifies initialization without a user turn', async () => {
  const modes = await readClaudePermissionModes(native);
  assert.ok(modes.includes('auto'));
  assert.equal(permissionOptions(modes)[1].value, 'default');
  assert.equal(permissionOptions(['manual'])[1].value, 'manual');
  assert.ok(samePermissionMode('manual', 'default'));
  assert.equal(await verifyClaudePermissionMode({ ...native, mode: 'acceptEdits' }), 'acceptEdits');
  await assert.rejects(verifyClaudePermissionMode({ ...native, args: [fixture, '--fixture-permission-fallback'], mode: 'auto' }), /未采用/);
});

test('Claude permissions are independent of models, session scoped, reversible and passed on resume', async () => {
  const adapter = new ClaudeCodeAdapter({ ...options, modelCatalogReader: async () => [] });
  try {
    const a = await adapter.createSession({ cwd: process.cwd() });
    const b = await adapter.createSession({ cwd: process.cwd() });
    assert.equal(a.permission_mode, null);
    assert.equal(a.session_config_options[0].currentValue, 'inherit');
    await adapter.configureSession({ sessionId: a.id, configId: 'permissions', value: 'acceptEdits' });
    const metadata = adapter.sessionMetadata.get(a.id);
    adapter.rememberSession({ sessionId: a.id, permissionMode: 'default' });
    assert.equal(adapter.toRelaySession(metadata).session_config_options[0].currentValue, 'acceptEdits');
    assert.deepEqual((await adapter.turnRuntime(metadata)).extraArgs, ['--permission-mode', 'acceptEdits']);
    assert.deepEqual((await adapter.turnRuntime(adapter.sessionMetadata.get(b.id))).extraArgs, []);
    await adapter.configureSession({ sessionId: a.id, configId: 'permissions', value: 'inherit' });
    assert.deepEqual((await adapter.turnRuntime(metadata)).extraArgs, []);
    await assert.rejects(adapter.configureSession({ sessionId: a.id, configId: 'permissions', value: 'invented' }), /advertise/);
  } finally { await adapter.close(); }
});

test('unavailable auto and model changes preserve the prior setting; capability is rechecked before each turn', async () => {
  let unavailable = false;
  const adapter = new ClaudeCodeAdapter({ ...options, permissionModeVerifier: async ({ mode, model }) => {
    if (mode === 'auto' && (unavailable || model === 'haiku')) throw new Error('auto unavailable');
  }});
  try {
    const a = await adapter.createSession({ cwd: process.cwd() });
    const configure = (configId, value) => adapter.configureSession({ sessionId: a.id, configId, value });
    await configure('permissions', 'auto');
    await assert.rejects(configure('model', 'haiku'), /unavailable/);
    assert.equal(adapter.modelOverrides.get(a.id).model, undefined);
    unavailable = true;
    await assert.rejects(adapter.turnRuntime(adapter.sessionMetadata.get(a.id)), /unavailable/);
    await configure('permissions', 'inherit');
    await assert.rejects(configure('permissions', 'auto'), /unavailable/);
    assert.equal(adapter.modelOverrides.get(a.id).permissionMode, undefined);
  } finally { await adapter.close(); }
});

test('permission verification blocks concurrent sends and settings, and never commits after close', async () => {
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const adapter = new ClaudeCodeAdapter({ ...options, permissionModeVerifier: async () => { entered(); await gate; } });
  const a = await adapter.createSession({ cwd: process.cwd() });
  const change = adapter.configureSession({ sessionId: a.id, configId: 'permissions', value: 'auto' });
  await ready;
  await assert.rejects(adapter.submitMessage({ sessionId: a.id, content: 'hello' }), /already working/);
  await assert.rejects(adapter.configureSession({ sessionId: a.id, configId: 'permissions', value: 'inherit' }), /already being changed/);
  await adapter.close();
  release();
  await assert.rejects(change, /closed/);
  assert.equal(adapter.modelOverrides.has(a.id), false);
  assert.equal(adapter.configuringSessions.size, 0);
});


test('actual permission mode survives stale catalog reads and mismatched init is rejected', async () => {
  const adapter = new ClaudeCodeAdapter(options);
  try {
    const a = await adapter.createSession({ cwd: process.cwd() });
    await adapter.configureSession({ sessionId: a.id, configId: 'permissions', value: 'acceptEdits' });
    const connection = {};
    adapter.processes.set(a.id, connection);
    await assert.rejects(adapter.handleTurnMessage(a.id, { type: 'system', subtype: 'init', permissionMode: 'default' }, connection), /未采用/);
    await adapter.handleTurnMessage(a.id, { type: 'system', subtype: 'init', permissionMode: 'acceptEdits' }, connection);
    adapter.rememberSession({ sessionId: a.id, permissionMode: null });
    assert.equal(adapter.toRelaySession(adapter.sessionMetadata.get(a.id)).permission_mode, 'acceptEdits');
    adapter.processes.delete(a.id);
  } finally { await adapter.close(); }
});
