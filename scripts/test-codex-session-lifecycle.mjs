// Opt-in native integration. Uses the actual Relayune adapter with an isolated
// CODEX_HOME and a deterministic loopback-only model fixture. No app is launched.
// Run with Node >=22.13 and --codex-bin /absolute/path/to/codex. Add --wait-idle
// to measure Codex's native unsubscribe grace period without shortening it.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { CodexAppServerAdapter } from '../relay/codex-adapters.mjs';
import { RelayOutbox } from '../relay/outbox.mjs';

const args = process.argv.slice(2);
const value = name => args[args.indexOf(name) + 1];
const bin = args.includes('--codex-bin') && value('--codex-bin');
if (!bin || !isAbsolute(bin)) throw new Error('Provide --codex-bin with an absolute Codex binary path.');
if (!args.includes('--worker')) {
  const root = await mkdtemp(join(tmpdir(), 'relayune-native-lifecycle-'));
  const home = join(root, 'home');await mkdir(home, { mode: 0o700 });
  const env = Object.fromEntries(['HOME', 'USER', 'PATH', 'TMPDIR', 'LANG'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  Object.assign(env, { CODEX_HOME: home, RUST_LOG: 'error' });
  console.log(JSON.stringify({ event: 'isolated_probe', root, fullIdleWait: args.includes('--wait-idle') }));
  const worker = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args, '--worker', '--root', root], { env, stdio: 'inherit' });
  const code = await new Promise(resolve => worker.once('exit', code => resolve(code ?? 1)));
  process.exitCode = code;
} else {
  const root = value('--root');
  assert.ok(basename(root).startsWith('relayune-native-lifecycle-'));
  assert.equal(process.env.CODEX_HOME, join(root, 'home'), 'Refuse to run the worker against a real Codex home.');
  const workspace = join(root, 'workspace');await mkdir(workspace, { mode: 0o700 });
  let inference = 0;
  const report = [];
  const log = (event, data = {}) => {
    const entry = { at: new Date().toISOString(), event, ...data };report.push(entry);console.log(JSON.stringify(entry));
  };
  const fixture = createServer(async (request, response) => {
    request.resume();
    await new Promise(resolve => request.once('end', resolve));
    assert.equal(request.headers.authorization, undefined, 'The fixture must receive no real credentials.');
    inference++;
    const item = { id: `msg_${inference}`, type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'LOCAL_ADAPTER_FIXTURE_OK', annotations: [] }] };
    const events = [
      { type: 'response.created', response: { id: `resp_${inference}`, status: 'in_progress', output: [] } },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: `resp_${inference}`, status: 'completed', output: [item],
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0,
          input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
    ];
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  await writeFile(join(process.env.CODEX_HOME, 'config.toml'), `model = "fixture-model"
model_provider = "fixture"
approval_policy = "on-request"
sandbox_mode = "read-only"
[model_providers.fixture]
name = "Local Relayune integration fixture"
base_url = "http://127.0.0.1:${fixture.address().port}/v1"
wire_api = "responses"
requires_openai_auth = false
[analytics]
enabled = false
[feedback]
enabled = false
`, { mode: 0o600 });

  class NativeClient {
    constructor() {
      this.pending = new Map();this.next = 1;
      this.child = spawn(bin, ['app-server'], { cwd: workspace, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
      this.child.stderr.resume();
      createInterface({ input: this.child.stdout }).on('line', line => {
        let r;try { r = JSON.parse(line); } catch { return; }
        const p = this.pending.get(r.id);
        if (p) {
          this.pending.delete(r.id);clearTimeout(p.timer);
          if (r.error) p.reject(Object.assign(Error(r.error.message), r.error));
          else p.resolve(r.result);
        }
      });
    }
    request(method, params = {}) {
      const id = this.next++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(id);reject(Error(`Test RPC timed out: ${method}`)); }, 15_000);
        this.pending.set(id, { resolve, reject, timer });
        this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
      });
    }
    async start() {
      await this.request('initialize', { clientInfo: { name: 'isolated_test_A', version: '0.0.1' }, capabilities: { experimentalApi: true } });
      this.child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    }
    async close() {
      if (this.child.exitCode === null) {
        this.child.stdin.end();
        await Promise.race([new Promise(resolve => this.child.once('exit', resolve)), delay(5000).then(() => this.child.kill())]);
      }
      for (const p of this.pending.values()) { clearTimeout(p.timer);p.reject(Error('Test client closed')); }
      this.pending.clear();
    }
  }
  let adapter, native;
  const outbox = new RelayOutbox(join(root, 'outbox.json'));
  const mutations = [];
  const events = [];
  const waitFor = async (predicate, timeout = 20_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await predicate()) return;await delay(100); }
    throw new Error('Native adapter condition timed out.');
  };
  const startAdapter = async () => {
    await outbox.load();
    const instance = new CodexAppServerAdapter({ codexBin: bin, workspace,
      idleReleaseDelayMs: 100, idleReleaseRetryMs: 500, queuePollIntervalMs: 100,
      desktopPermissions: async () => { throw Error('No real Desktop IPC in isolated test.'); },
      desktopRuntime: async () => ({ type: 'notOwned' }),
    });
    await instance.start({ emitEvent: async (id, event) => events.push({ id, ...event }), requestApproval: async () => { throw Error('Unexpected fixture approval'); },
      loadCodexQueueReceipts: () => Object.values(outbox.codexQueueReceipts), saveCodexQueueReceipt: r => outbox.saveCodexQueueReceipt(r), removeCodexQueueReceipt: r => outbox.removeCodexQueueReceipt(r),
      loadCodexMessageReceipts: () => Object.values(outbox.codexMessageReceipts), saveCodexMessageReceipt: r => outbox.saveCodexMessageReceipt(r), removeCodexMessageReceipt: r => outbox.removeCodexMessageReceipt(r) });
    const notification = instance.handleNotification.bind(instance);
    instance.handleNotification = async message => {
      if (message.method === 'thread/closed' || message.method === 'thread/status/changed' && message.params?.status?.type === 'notLoaded')
        log('native_unload_notification', { method: message.method, threadId: message.params?.threadId, B: instance.child?.pid });
      return notification(message);
    };
    const original = instance.request.bind(instance);
    instance.request = async (method, params, options) => {
      if (['thread/resume', 'thread/queue/add', 'turn/start', 'turn/steer', 'thread/unsubscribe'].includes(method)) mutations.push({ method, params });
      return original(method, params, options);
    };
    return instance;
  };
  const send = (sessionId, id) => adapter.submitMessage({ sessionId, clientMessageId: id, requestId: `req_${id}`, content: `Synthetic input ${id}` });
  const find = async (client, sessionId, id) => {
    const { thread } = await client.request('thread/read', { threadId: sessionId, includeTurns: true });
    return (thread.turns ?? []).filter(t => (t.items ?? []).some(i => i.type === 'userMessage' && (i.clientId ?? i.client_id) === id));
  };
  const completed = async (client, sessionId, id) => waitFor(async () => {
    const found = await find(client, sessionId, id);return found.length === 1 && found[0].status === 'completed';
  });
  try {
    adapter = await startAdapter();
    const { id: sessionId } = await adapter.createSession({ cwd: workspace });
    const before = inference;
    await Promise.all([send(sessionId, 'duplicate'), send(sessionId, 'duplicate'), send(sessionId, 'duplicate')]);
    await completed(adapter, sessionId, 'duplicate');
    assert.equal(inference - before, 1);
    assert.equal(mutations.filter(r => r.method === 'turn/start').length, 1);
    log('concurrent_duplicate_passed', { sessionId, modelRequests: inference - before });

    const original = adapter.request.bind(adapter);
    let loseAck = true;
    adapter.request = async (method, params, options) => {
      const result = await original(method, params, options);
      if (loseAck && method === 'turn/steer' && params.clientUserMessageId === 'lost_ack' ||
          loseAck && method === 'turn/start' && params.clientUserMessageId === 'lost_ack') {
        loseAck = false;throw Error('Synthetic timeout after native acceptance');
      }
      return result;
    };
    await assert.rejects(send(sessionId, 'lost_ack'), /Synthetic timeout/);
    await completed(adapter, sessionId, 'lost_ack');
    const afterLost = inference;
    await adapter.close();await outbox.flush();
    adapter = await startAdapter();
    await send(sessionId, 'lost_ack');
    assert.equal(inference, afterLost);
    assert.equal((await find(adapter, sessionId, 'lost_ack')).length, 1);
    log('restart_after_lost_ack_passed', { noReplay: true });

    await send(sessionId, 'grace_first');await completed(adapter, sessionId, 'grace_first');
    await adapter.listSessions();adapter.scheduleIdleRelease(sessionId, 0);
    await waitFor(() => adapter.idleUnsubscribed.has(sessionId));
    assert.equal(adapter.resumedThreads.has(sessionId), true);
    await send(sessionId, 'grace_second');await completed(adapter, sessionId, 'grace_second');
    assert.equal((await find(adapter, sessionId, 'grace_second')).length, 1);
    log('send_during_unload_grace_passed');

    await adapter.listSessions();adapter.scheduleIdleRelease(sessionId, 0);
    await waitFor(() => adapter.idleUnsubscribed.has(sessionId));
    const unsubscribedAt = Date.now();
    log('idle_unsubscribed', { sessionId, B: adapter.child.pid, stillOwned: adapter.resumedThreads.has(sessionId), fullIdleWait: args.includes('--wait-idle') });
    if (args.includes('--wait-idle')) {
      let nextProgress = Date.now() + 60_000;
      await waitFor(async () => {
        if (Date.now() >= nextProgress) { log('idle_wait_progress', { elapsedSeconds: Math.round((Date.now() - unsubscribedAt) / 1000) });nextProgress += 60_000; }
        return !adapter.resumedThreads.has(sessionId);
      }, 33 * 60_000);
      const loaded = await adapter.request('thread/loaded/list', {});
      assert.equal(loaded.data.includes(sessionId), false);
      assert.equal(adapter.child.exitCode, null);
      log('real_idle_unload_passed', { elapsedSeconds: Math.round((Date.now() - unsubscribedAt) / 1000),
        nativeLoaded: false, BStillRunning: true, noServerGraceOverride: true });
    } else {
      // A test-only process exit establishes unloaded state for the remaining
      // cases. It is not counted as validation of the 30-minute grace period.
      await adapter.close();adapter = await startAdapter();
      log('short_run_restarted_only_probe_B');
    }

    native = new NativeClient();await native.start();
    await native.request('thread/resume', { threadId: sessionId });
    const bWrites = mutations.length;
    await send(sessionId, 'A_owned');await completed(native, sessionId, 'A_owned');
    assert.equal(adapter.resumedThreads.has(sessionId), false);
    assert.equal(mutations.slice(bWrites).filter(r => r.method === 'turn/start' || r.method === 'turn/steer').length, 0);
    log('competing_A_writer_queue_passed');
    await native.close();native = null;

    await adapter.request('thread/queue/add', { threadId: sessionId, clientUserMessageId: 'persisted_queue', input: [{ type: 'text', text: 'Queued before resume.', text_elements: [] }] });
    const calls = mutations.length;
    await send(sessionId, 'persisted_queue');await completed(adapter, sessionId, 'persisted_queue');
    assert.equal(mutations.slice(calls).filter(r => ['turn/start', 'turn/steer', 'thread/queue/add'].includes(r.method)).length, 0);
    log('queued_resume_without_duplicate_passed');
    log('integration_passed', { modelRequests: inference, externalModelRequests: 0 });
  } catch (error) { log('integration_failed', { error: error.message });process.exitCode = 1; }
  finally {
    await native?.close();await adapter?.close();await outbox.flush();
    fixture.closeAllConnections();await new Promise(resolve => fixture.close(resolve));
    const path = join(root, 'result.json');await writeFile(path, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ event: 'probe_cleanup', report: path, onlyProbeProcessesStopped: true }));
  }
}
