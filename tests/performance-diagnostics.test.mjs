import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { createPerformanceDiagnostics, PERFORMANCE_PREFIX } from '../relay/performance-diagnostics.mjs';
import { MacRelay } from '../relay/mac-relay.mjs';
import { startRelay } from '../relay/startup.mjs';

function harness(t, overrides = {}) {
  let time = 0, cpu = 0;
  const lines = [], timers = new Map();
  let unrefs = 0;
  const diagnostics = createPerformanceDiagnostics({
    enabled: true, now: () => time, cpuUsage: () => ({ user: cpu, system: 0 }),
    uptime: () => 42_000,
    memoryUsage: () => ({ rss: 40_000, heapUsed: 20_000, heapTotal: 30_000, external: 10_000 }),
    emit: line => lines.push(line),
    setInterval: (callback, ms) => {
      const timer = { callback, unref() { unrefs++; } };
      timers.set(ms, timer);
      return timer;
    },
    clearInterval: timer => { for (const [key, value] of timers) if (value === timer) timers.delete(key); },
    ...overrides,
  });
  t.after(() => diagnostics.close());
  return { diagnostics, timers, lines, time: value => { time = value; }, cpu: value => { cpu = value; },
    events: () => lines.map(line => JSON.parse(line.slice(PERFORMANCE_PREFIX.length))),
    sample: () => timers.get(15_000)?.callback(), tick: () => timers.get(1000)?.callback(), unrefs: () => unrefs };
}

test('performance diagnostics default to no probes, timers or output', () => {
  const fail = () => assert.fail('disabled diagnostics must be inert');
  const diagnostics = createPerformanceDiagnostics({ now: fail, memoryUsage: fail, setInterval: fail, emit: fail });
  const value = {};
  assert.equal(diagnostics.measure('history_read', () => value), value);
  diagnostics.startPhase('bootstrap')();
  diagnostics.startOperation('remote_fetch')(true);
  diagnostics.close();
});

test('resource samples use monotonic CPU intervals and include event-loop drift', t => {
  const h = harness(t);
  assert.equal(h.unrefs(), 2);
  for (let ms = 1000; ms <= 14_000; ms += 1000) { h.time(ms); h.tick(); }
  h.time(19_000); h.tick();
  h.time(20_000); h.cpu(20_000_000); h.sample();
  assert.deepEqual(h.events(), [{ event: 'relay_sample', rss_bytes: 40_000, heap_used_bytes: 20_000,
    heap_total_bytes: 30_000, external_bytes: 10_000, cpu_percent: 100,
    event_loop_delay_max_ms: 4000, uptime_ms: 42_000, sample_interval_ms: 20_000 }]);
  h.time(21_000); h.tick(); h.cpu(21_000_000); h.sample();
  assert.equal(h.events().at(-1).cpu_percent, 100);
  assert.equal(h.events().at(-1).sample_interval_ms, 1000);
});

test('invalid resource values and backwards clocks never emit negative or nonfinite numbers', t => {
  const h = harness(t, { memoryUsage: () => ({ rss: -5, heapUsed: NaN, heapTotal: Infinity, external: undefined }),
    uptime: () => -1 });
  h.time(10); h.cpu(1000); h.sample();
  h.time(5); h.cpu(-20); h.tick(); h.sample();
  assert.equal(h.events().length, 1, 'invalid CPU/interval skips the resource row');
  const event = h.events().at(-1);
  for (const value of Object.values(event).filter(value => typeof value === 'number')) {
    assert.ok(Number.isFinite(value) && value >= 0);
  }
  assert.equal(event.sample_interval_ms, 10);
  assert.equal(event.rss_bytes, 0);
});

test('operations aggregate once, preserve success/failure semantics and reject dynamic labels', async t => {
  const h = harness(t);
  const result = {};
  assert.equal(h.diagnostics.measure('history_read', () => { h.time(10); return result; }), result);
  const secret = new Error('/private/session.jsonl Bearer fixture-token secret@example.invalid');
  await assert.rejects(h.diagnostics.measure('history_read', async () => { h.time(25); throw secret; }), error => error === secret);
  const finish = h.diagnostics.startOperation('history_read');
  h.time(30); finish(); finish(true);
  h.diagnostics.startOperation('https://private.invalid/session')();
  h.diagnostics.startPhase('private/session')();
  h.sample();
  assert.deepEqual(h.events().filter(event => event.event === 'operation_timing'), [
    { event: 'operation_timing', operation: 'history_read', count: 3, failed: 1, total_ms: 30, max_ms: 15 },
  ]);
  assert.doesNotMatch(h.lines.join('\n'), /private|Bearer|token|example/);
  h.sample();
  assert.equal(h.events().filter(event => event.event === 'operation_timing').length, 1);
});

test('startup phases complete exactly once and failed startup excludes cleanup duration', async t => {
  const h = harness(t);
  const bootstrap = h.diagnostics.startPhase('bootstrap');
  h.time(5); bootstrap(); bootstrap('failed');
  const relay = {
    performanceDiagnostics: h.diagnostics,
    async start() { h.time(10); this.onStartupPhase('agents'); h.time(20); throw new Error('private startup cause'); },
    async stop() { h.time(1000); },
  };
  await assert.rejects(startRelay(relay), /startup failed: agents/);
  assert.deepEqual(h.events(), [
    { event: 'startup_phase', phase: 'bootstrap', duration_ms: 5, status: 'ok' },
    { event: 'startup_phase', phase: 'local_state', duration_ms: 5, status: 'ok' },
    { event: 'startup_phase', phase: 'agents', duration_ms: 10, status: 'failed' },
  ]);
  assert.doesNotMatch(h.lines.join('\n'), /private/);
});

test('faulting resource probes, clocks, output and timer setup cannot break business work', async t => {
  const fail = () => { throw new Error('private diagnostics failure'); };
  const h = harness(t, { now: fail, cpuUsage: fail, memoryUsage: fail, emit: fail });
  assert.equal(await h.diagnostics.measure('history_read', async () => 7), 7);
  h.diagnostics.startPhase('hooks')(); h.tick(); h.sample();
  const disabled = createPerformanceDiagnostics({ enabled: true, setInterval: fail, clearInterval: fail, emit: fail });
  assert.equal(disabled.measure('catalog_sync', () => 8), 8);
  disabled.close();
});

test('close clears unreferenced timers and suppresses late operations and callbacks', async t => {
  const h = harness(t);
  let release;
  const pending = h.diagnostics.measure('history_read', () => new Promise(resolve => { release = resolve; }));
  const callbacks = [...h.timers.values()].map(timer => timer.callback);
  const phase = h.diagnostics.startPhase('hooks');
  h.diagnostics.close(); h.diagnostics.close();
  assert.equal(h.timers.size, 0);
  release('complete'); assert.equal(await pending, 'complete');
  phase(); for (const callback of callbacks) callback();
  assert.deepEqual(h.events(), []);
});

test('short-lived diagnostics flush completed timings once on close and preserve synchronous throws', t => {
  const h = harness(t);
  const secret = new Error('private synchronous error');
  assert.throws(() => h.diagnostics.measure('catalog_sync', () => { h.time(5); throw secret; }), error => error === secret);
  h.diagnostics.close();
  assert.equal(h.events().filter(event => event.event === 'relay_sample').length, 1);
  assert.deepEqual(h.events().filter(event => event.event === 'operation_timing'), [
    { event: 'operation_timing', operation: 'catalog_sync', count: 1, failed: 1, total_ms: 5, max_ms: 5 },
  ]);
  const count = h.lines.length;
  h.diagnostics.close();
  assert.equal(h.lines.length, count);
  assert.doesNotMatch(h.lines.join('\n'), /private/);
});

test('successful startup reports each fixed stage including hooks once', async t => {
  const h = harness(t);
  let ms = 0;
  const phases = ['agents', 'registration', 'initial_sync', 'polling'];
  const relay = { performanceDiagnostics: h.diagnostics,
    async start() { for (const phase of phases) { h.time(ms += 5); this.onStartupPhase(phase); } },
    async waitUntilReady() { h.time(ms += 5); },
  };
  await startRelay(relay, { configureHooks: async () => { h.time(ms += 5); } });
  assert.deepEqual(h.events().map(event => [event.phase, event.duration_ms, event.status]),
    ['local_state', ...phases, 'hooks'].map(phase => [phase, 5, 'ok']));
});

test('Relay records actual coalesced catalog/history/fetch work without request data', async t => {
  const h = harness(t);
  const relay = new MacRelay({ serverUrl: 'https://fixture.invalid', deviceToken: 'private-token', statePath: null,
    performanceDiagnostics: h.diagnostics,
    adapter: { async listSessions() { h.time(10); return []; }, async readHistory() { h.time(20); return { messages: [] }; } } });
  await Promise.all([relay.readSessionCatalog(), relay.readSessionCatalog()]);
  await relay.readAccessibleHistory('private-session', {});
  t.mock.method(globalThis, 'fetch', async () => { h.time(25); return new Response(null, { status: 503 }); });
  assert.equal((await relay.remoteFetch('/private-path')).status, 503);
  const privateFailure = new Error('private connection failure');
  globalThis.fetch = async () => { h.time(30); throw privateFailure; };
  await assert.rejects(relay.remoteFetch('/private-path'), error => error === privateFailure);
  h.sample();
  const operations = h.events().filter(event => event.event === 'operation_timing');
  assert.deepEqual(operations.map(event => [event.operation, event.count, event.failed]),
    [['catalog_sync', 1, 0], ['history_read', 1, 0], ['remote_fetch', 2, 2]]);
  assert.doesNotMatch(h.lines.join('\n'), /private|fixture/);
});


test('CLI opt-in covers bootstrap failure before AttachmentStore construction completes', async () => {
  const run = promisify(execFile);
  for (const enabled of ['0', '1']) {
    const result = await run(process.execPath, ['relay/cli.mjs', 'relay'], { env: {
      ...process.env, RELAY_PERFORMANCE_DIAGNOSTICS: enabled,
      RELAY_SERVER_URL: 'https://fixture.invalid', RELAY_DEVICE_ID: 'fixture-device',
      RELAY_DEVICE_TOKEN: 'fixture-secret-token', RELAY_BROWSER_KEYS: '',
      RELAY_E2EE_KEY: Buffer.alloc(32, 1).toString('base64url'),
      RELAY_ATTACHMENT_STORE_PATH: 'invalid-relative-path', RELAY_ATTACHMENT_STORE_KEY: Buffer.alloc(32, 2).toString('base64url'),
    } }).catch(error => error);
    assert.equal(result.code, 1);
    const lines = result.stdout.split('\n').filter(line => line.startsWith(PERFORMANCE_PREFIX));
    assert.equal(lines.length > 0, enabled === '1');
    const phases = lines.map(line => JSON.parse(line.slice(PERFORMANCE_PREFIX.length)))
      .filter(event => event.event === 'startup_phase');
    assert.equal(phases.length, enabled === '1' ? 1 : 0);
    if (phases.length) {
      const event = phases[0];
      assert.equal(event.event, 'startup_phase'); assert.equal(event.phase, 'bootstrap'); assert.equal(event.status, 'failed');
      assert.doesNotMatch(lines.join('\n'), /fixture|secret|path/);
    }
  }
});
