import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:net';
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopStatePool, desktopInterruptTurn, desktopStartMessage, desktopRuntime,
  desktopPermissions, desktopPendingApprovals, desktopResolveApproval } from '../relay/codex-desktop-settings.mjs';
import { permissionSettings } from '../relay/codex-permissions.mjs';
import { hashAction } from '../relay/protocol.mjs';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-000000000002';
const initial = permissionSettings('default', null, '/workspace');
const state = (runtime = 'idle') => ({ cwd: '/workspace', latestThreadSettings: structuredClone(initial),
  currentPermissions: structuredClone(initial), threadRuntimeStatus: { type: runtime }, turns: [], requests: [] });

async function fixture(t, { states = new Map([[A, state()]]), idleTimeoutMs = 30_000, maxEntries = 16,
  stopDelayMs = 0, stopSettles = true, stopRuntimeType = 'idle', responseDelayMs = 0, snapshotDelayMs = 0 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'codex-state-'));
  await chmod(dir, 0o700);
  const socketPath = join(dir, 'ipc.sock'), pool = createDesktopStatePool({ idleTimeoutMs, maxEntries });
  const sessions = new Map([...states].map(([id, value]) => [id, { value, owner: `owner-${id}`, revision: 0 }]));
  const sockets = new Set(), requests = [];
  let clientNumber = 0, snapshots = 0;
  function send(socket, message) {
    if (socket.destroyed) return;
    const body = Buffer.from(JSON.stringify(message)), head = Buffer.alloc(4); head.writeUInt32LE(body.length);
    socket.write(Buffer.concat([head, body]));
  }
  function patch(id, patches, overrides = {}) {
    const source = sessions.get(id);
    const change = { type: 'patches', baseRevision: source.revision, revision: ++source.revision, patches, ...overrides };
    for (const socket of sockets) if (socket.sessionId === id && socket.following) send(socket, {
      type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: source.owner,
      params: { hostId: 'local', conversationId: id, change },
    });
  }
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.clientId = `client-${++clientNumber}`;
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
        const n = buffer.readUInt32LE(0), message = JSON.parse(buffer.subarray(4, n + 4)); buffer = buffer.subarray(n + 4);
        if (message.type === 'request') {
          requests.push(message);
          const id = message.params?.conversationId;
          const source = sessions.get(id);
          if (message.method === 'thread-owner-discovery') socket.sessionId = id;
          let result = { ok: true };
          if (message.method === 'initialize') result = { clientId: socket.clientId };
          if (message.method === 'thread-follower-start-turn') {
            source.value.threadRuntimeStatus = { type: 'active' };
            source.value.turns.push({ id: 'new-turn', status: 'inProgress', items: [] });
            patch(id, [{ op: 'replace', path: ['threadRuntimeStatus'], value: { type: 'active' } },
              { op: 'add', path: ['turns', source.value.turns.length - 1], value: source.value.turns.at(-1) }]);
            result = { result: { turn: { id: 'new-turn' } } };
          }
          if (message.method === 'thread-follower-interrupt-turn') {
            result = { ok: true, interruptedTurnId: message.params.expectedTurnId };
            if (stopSettles) setTimeout(() => {
              source.value.threadRuntimeStatus = { type: stopRuntimeType };
              const active = source.value.turns.findIndex(turn => turn.id === message.params.expectedTurnId);
              const changes = [{ op: 'replace', path: ['threadRuntimeStatus', 'type'], value: stopRuntimeType }];
              if (active >= 0) { source.value.turns[active].status = 'interrupted'; changes.push({ op: 'replace', path: ['turns', active, 'status'], value: 'interrupted' }); }
              patch(id, changes);
            }, stopDelayMs);
          }
          if (message.method === 'thread-follower-update-thread-settings') {
            source.value.latestThreadSettings = message.params.threadSettings;
            patch(id, [{ op: 'replace', path: ['latestThreadSettings'], value: message.params.threadSettings }]);
          }
          const respond = () => send(socket, { type: 'response', requestId: message.requestId, method: message.method, resultType: 'success',
            handledByClientId: message.method === 'initialize' ? socket.clientId : source?.owner, result });
          if (responseDelayMs) setTimeout(respond, responseDelayMs); else respond();
        } else if (message.type === 'broadcast' && message.params?.following) {
          const id = message.params.conversationId, source = sessions.get(id);
          socket.following = true; socket.sessionId = id; snapshots++;
          const snapshot = () => send(socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: source.owner,
            params: { hostId: 'local', conversationId: id, change: { type: 'snapshot', revision: source.revision, conversationState: source.value } } });
          if (snapshotDelayMs) setTimeout(snapshot, snapshotDelayMs); else snapshot();
        } else if (message.params?.following === false) socket.following = false;
      }
    });
  });
  await new Promise(resolve => server.listen(socketPath, resolve)); await chmod(socketPath, 0o600);
  t.after(async () => { pool.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const options = { socketPath, statePool: pool, timeoutMs: 500, settleTimeoutMs: 250 };
  return { pool, options, sessions, requests, patch, get snapshots() { return snapshots; },
    runtime: (id = A) => desktopRuntime(id, options), permissions: (settings, id = A) => desktopPermissions(id, settings, options),
    approvals: () => desktopPendingApprovals(A, options), decide: reply => desktopResolveApproval(A, reply, options),
    stop: () => desktopInterruptTurn(A, options), start: message => desktopStartMessage(A, message, options),
    disconnect() { for (const socket of sockets) socket.destroy(); },
    reset() { for (const socket of sockets) send(socket, { type: 'broadcast', method: 'ipc-connection-reset', version: 1, params: {} }); },
  };
}

const nextEvent = () => new Promise(resolve => setTimeout(resolve, 20));

test('queued read deadline expires without closing another caller or releasing its native operation', async t => {
  const f = await fixture(t);
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const entered = new Promise(resolve => { started = resolve; });
  const order = [];
  const first = f.pool.run(A, f.options, async () => {
    order.push('first'); started(); await gate; order.push('first complete'); return 'first';
  });
  await entered;
  const second = f.pool.run(A, { ...f.options, timeoutMs: 20 }, async () => { order.push('expired'); });
  await assert.rejects(second, /无法确认/);
  assert.equal(f.pool.stats.entries, 1);
  assert.equal(f.pool.stats.invalidations, 0);
  const third = f.pool.run(A, f.options, async () => { order.push('third'); return 'third'; });
  assert.deepEqual(order, ['first']);
  release();
  assert.deepEqual(await Promise.all([first, third]), ['first', 'third']);
  assert.deepEqual(order, ['first', 'first complete', 'third']);
  assert.equal(f.snapshots, 1);
  assert.equal(f.pool.stats.invalidations, 0);
});

test('native initialization and owner discovery share one total read deadline', async t => {
  const f = await fixture(t, { responseDelayMs: 50, snapshotDelayMs: 50 });
  await assert.rejects(desktopRuntime(A, { ...f.options, timeoutMs: 80 }), /无法确认/);
  assert.equal(f.pool.stats.entries, 0);
  assert.equal(f.requests.some(request => request.method === 'thread-follower-start-turn'), false);
});

test('an operation completing in a microtask past its absolute deadline is rejected', async t => {
  const f = await fixture(t);
  await f.runtime();
  const now = Date.now.bind(Date);
  let advanced = false;
  t.mock.method(Date, 'now', () => now() + (advanced ? 1_000 : 0));
  await assert.rejects(f.pool.run(A, f.options, async () => {
    // Model a busy JS turn without sleeping or letting the timeout callback
    // run first. The absolute clock still has to reject its late result.
    advanced = true;
    return { type: 'idle' };
  }), /无法确认/);
  assert.equal(f.pool.stats.entries, 0);
});

test('concurrent runtime, permissions and approvals share one source snapshot and retain no tool payloads', async t => {
  const value = state(); value.turns = [{ id: 'turn', status: 'completed', items: [{ type: 'image', url: `data:image/png;base64,${'x'.repeat(1024 * 1024)}` }] }];
  value.turnHistory = { kind: 'canonical', history: { entitiesByKey: { key: value.turns[0] }, islands: [{ entries: [{ key: 'a', value: 'key' }] }] } };
  value.requests = [{ method: 'unrelated', params: { image: 'x'.repeat(1024 * 1024) } }];
  const f = await fixture(t, { states: new Map([[A, value]]) });
  const [runtime, permissions, approvals] = await Promise.all([f.runtime(), f.permissions(), f.approvals()]);
  assert.deepEqual(runtime, { type: 'idle' }); assert.equal(permissions.approvalPolicy, initial.approvalPolicy); assert.deepEqual(approvals, []);
  assert.equal(f.snapshots, 1); assert.equal(f.pool.stats.snapshots, 1); assert.equal(f.pool.stats.reuses, 2);
  assert.ok(f.pool.stats.snapshotBytes > 2 * 1024 * 1024); assert.ok(f.pool.stats.retainedBytes < 2048);
});

test('idle stop then start uses one subscription and native start acknowledgement', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.stop(), { turnId: null });
  assert.deepEqual(await f.start({ input: [{ type: 'text', text: 'next' }], clientMessageId: 'm' }), { mode: 'started', turnId: 'new-turn', persisted: false });
  assert.equal(f.snapshots, 1); assert.deepEqual(await f.runtime(), { type: 'active' }); assert.equal(f.snapshots, 1);
});

test('unloaded completed canonical Desktop thread can stop and start without an interrupt', async t => {
  const value = state('notLoaded');
  value.turnHistory = { kind: 'canonical', history: {
    entitiesByKey: { tail: { turnId: 'completed-turn', status: 'completed' } },
    islands: [{ id: 'tail', entries: [{ key: 'tail', value: 'tail' }] }],
  } };
  const f = await fixture(t, { states: new Map([[A, value]]) });
  assert.deepEqual(await f.runtime(), { type: 'idle' });
  assert.deepEqual(await f.stop(), { turnId: null });
  assert.deepEqual(await f.start({ input: [{ type: 'text', text: 'next' }], clientMessageId: 'm' }),
    { mode: 'started', turnId: 'new-turn', persisted: false });
  assert.equal(f.requests.some(request => request.method === 'thread-follower-interrupt-turn'), false);
  assert.equal(f.requests.filter(request => request.method === 'thread-follower-start-turn').length, 1);
  assert.equal(f.snapshots, 1);
});

for (const runtime of ['notLoaded', 'systemError', 'unknown']) test(`${runtime} with an in-progress canonical turn cannot authorize a replacement`, async t => {
  const value = state(runtime);
  value.turnHistory = { kind: 'canonical', history: {
    entitiesByKey: { tail: { turnId: 'running-turn', status: 'inProgress' } },
    islands: [{ entries: [{ value: 'tail' }] }],
  } };
  const f = await fixture(t, { states: new Map([[A, value]]) });
  await assert.rejects(f.stop());
  await assert.rejects(f.start({ input: [] }));
  assert.equal(f.requests.some(request => request.method.startsWith('thread-follower-')), false);
});

test('active stop waits for source idle patch and does not resubscribe before next start', async t => {
  const value = state('active'); value.turns = [{ id: 'old-turn', status: 'inProgress' }];
  const f = await fixture(t, { states: new Map([[A, value]]), stopDelayMs: 25 });
  await f.stop(); await f.start({ input: [], clientMessageId: 'new' });
  assert.equal(f.snapshots, 1);
  assert.deepEqual(f.requests.filter(request => request.method === 'thread-follower-interrupt-turn').map(request => request.params.expectedTurnId), ['old-turn']);
});

test('confirmed interrupt may unload its finished runtime before the replacement starts', async t => {
  const value = state('active'); value.turns = [{ id: 'old-turn', status: 'inProgress' }];
  const f = await fixture(t, { states: new Map([[A, value]]), stopRuntimeType: 'notLoaded' });
  assert.deepEqual(await f.stop(), { turnId: 'old-turn' });
  await f.start({ input: [], clientMessageId: 'next' });
  assert.equal(f.requests.filter(request => request.method === 'thread-follower-interrupt-turn').length, 1);
  assert.equal(f.requests.filter(request => request.method === 'thread-follower-start-turn').length, 1);
});

test('stop acknowledgement without a source idle transition cannot start a replacement turn', async t => {
  const value = state('active'); value.turns = [{ id: 'old-turn', status: 'inProgress' }];
  const f = await fixture(t, { states: new Map([[A, value]]), stopSettles: false });
  await assert.rejects(f.stop(), /stop could not be confirmed/);
  await assert.rejects(f.start({ input: [] }), /still running/);
  assert.equal(f.requests.some(request => request.method === 'thread-follower-start-turn'), false); assert.equal(f.snapshots, 1);
});

test('continuous settings patches refresh permissions without snapshot reads', async t => {
  const f = await fixture(t); await f.permissions();
  const desired = permissionSettings('manual', initial, '/workspace'); f.sessions.get(A).value.latestThreadSettings = desired;
  f.patch(A, [{ op: 'replace', path: ['latestThreadSettings'], value: desired }]); await nextEvent();
  assert.equal((await f.permissions()).approvalPolicy, 'untrusted'); assert.equal(f.snapshots, 1);
});

test('per-message permission overrides use latest source roots with no second snapshot', async t => {
  const f = await fixture(t); await f.stop();
  const desired = { ...initial, sandboxPolicy: { ...initial.sandboxPolicy, writableRoots: ['/workspace', '/newly-authorized'] } };
  f.sessions.get(A).value.latestThreadSettings = desired;
  f.patch(A, [{ op: 'replace', path: ['latestThreadSettings', 'sandboxPolicy', 'writableRoots'], value: desired.sandboxPolicy.writableRoots }]);
  await nextEvent();
  await f.start({ input: [], clientMessageId: 'm', runtimeSettings: { permissions: 'manual' } });
  const params = f.requests.find(request => request.method === 'thread-follower-start-turn').params.turnStart.request;
  assert.deepEqual(params.sandboxPolicy.writableRoots, ['/workspace', '/newly-authorized']); assert.equal(params.approvalPolicy, 'untrusted');
  assert.equal(params.permissions, undefined); assert.equal(f.snapshots, 1);
});

test('permission mutation invalidates live state and obtains fresh authoritative readback', async t => {
  const f = await fixture(t); await f.permissions();
  const desired = permissionSettings('auto', initial, '/workspace');
  assert.equal((await f.permissions(desired)).approvalsReviewer, 'auto_review');
  assert.equal(f.snapshots, 3); assert.equal(f.pool.stats.entries, 0);
  assert.equal((await f.permissions()).approvalsReviewer, 'auto_review'); assert.equal(f.snapshots, 4);
});

test('approval decisions use fresh native validation after a cached request disappears', async t => {
  const value = state('active'); const approval = { id: 12, method: 'item/commandExecution/requestApproval', params: { threadId: A, command: 'true' } };
  value.requests = [approval]; const f = await fixture(t, { states: new Map([[A, value]]) }); await f.approvals();
  f.sessions.get(A).value.requests = [];
  await assert.rejects(f.decide({ method: approval.method, requestId: approval.id, decision: 'accept', paramsHash: hashAction(approval.params) }), /no longer pending/);
  assert.equal(f.requests.some(request => request.method === 'thread-follower-command-approval-decision'), false); assert.equal(f.snapshots, 2);
});

for (const event of ['gap', 'disconnect', 'reset']) test(`${event} invalidates native authority and forces a new snapshot`, async t => {
  const f = await fixture(t); await f.runtime(); f.sessions.get(A).value.threadRuntimeStatus = { type: 'active' };
  if (event === 'gap') f.patch(A, [{ op: 'replace', path: ['threadRuntimeStatus', 'type'], value: 'active' }], { baseRevision: 9, revision: 10 });
  else if (event === 'disconnect') f.disconnect(); else f.reset();
  await nextEvent(); assert.equal(f.pool.stats.entries, 0);
  assert.deepEqual(await f.runtime(), { type: 'active' }); assert.equal(f.snapshots, 2);
});

test('owner changes cannot reuse previous authority or issue a mutation to its replacement', async t => {
  const f = await fixture(t); await f.runtime(); f.sessions.get(A).owner = 'replacement';
  await assert.rejects(f.start({ input: [] }), /无法确认/);
  assert.equal(f.requests.some(request => request.method === 'thread-follower-start-turn'), false); assert.equal(f.pool.stats.entries, 0);
  assert.deepEqual(await f.runtime(), { type: 'idle' }); assert.equal(f.snapshots, 2);
});

test('sessions isolate runtime and settings despite sharing the same IPC socket path', async t => {
  const f = await fixture(t, { states: new Map([[A, state()], [B, state('active')]]) });
  assert.deepEqual(await f.runtime(A), { type: 'idle' }); assert.deepEqual(await f.runtime(B), { type: 'active' });
  f.sessions.get(B).value.threadRuntimeStatus = { type: 'idle' }; f.patch(B, [{ op: 'replace', path: ['threadRuntimeStatus', 'type'], value: 'idle' }]); await nextEvent();
  assert.deepEqual(await f.runtime(A), { type: 'idle' }); assert.deepEqual(await f.runtime(B), { type: 'idle' }); assert.equal(f.snapshots, 2);
});

test('native history item patches advance revision without retaining image payloads', async t => {
  const value = state(); value.turns = [{ id: 't', status: 'completed', items: [] }];
  const f = await fixture(t, { states: new Map([[A, value]]) }); await f.runtime(); const before = f.pool.stats.retainedBytes;
  f.patch(A, [{ op: 'add', path: ['turns', 0, 'items', 0], value: { url: `data:image/png;base64,${'x'.repeat(1024 * 1024)}` } }]); await nextEvent();
  assert.deepEqual(await f.runtime(), { type: 'idle' }); assert.equal(f.pool.stats.retainedBytes, before); assert.equal(f.snapshots, 1);
});

test('unrelated RPC patches retain placeholders and cannot manufacture partial approvals', async t => {
  const value = state(); value.requests = [{ method: 'item/tool/call', params: { content: 'private-tool-output' } }];
  const f = await fixture(t, { states: new Map([[A, value]]) }); await f.approvals(); const before = f.pool.stats.retainedBytes;
  f.patch(A, [{ op: 'replace', path: ['requests', 0, 'params', 'content'], value: `data:image/png;base64,${'x'.repeat(1024 * 1024)}` }]); await nextEvent();
  assert.deepEqual(await f.approvals(), []); assert.equal(f.pool.stats.retainedBytes, before); assert.equal(f.snapshots, 1);
  f.patch(A, [{ op: 'replace', path: ['requests', 0, 'method'], value: 'item/fileChange/requestApproval' }]); await nextEvent();
  assert.equal(f.pool.stats.entries, 0);
});

test('idle expiry and pool capacity bound retained native subscriptions', async t => {
  const f = await fixture(t, { states: new Map([[A, state()], [B, state()]]), maxEntries: 1, idleTimeoutMs: 25 });
  await f.runtime(A); await f.runtime(B); assert.equal(f.pool.stats.entries, 1); assert.equal(f.snapshots, 2);
  await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(f.pool.stats.entries, 0); assert.equal(f.pool.stats.retainedBytes, 0);
  await f.runtime(B); assert.equal(f.snapshots, 3);
});
