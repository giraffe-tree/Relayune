import { performance } from 'node:perf_hooks';

export const PERFORMANCE_PREFIX = 'relayune:performance:';
const OPERATIONS = new Set(['local_state', 'agents', 'registration', 'initial_sync', 'polling', 'hooks',
  'history_read', 'catalog_sync', 'remote_fetch', 'history_warm', 'attachment_recovery']);
const PHASES = new Set(['local_state', 'agents', 'registration', 'initial_sync', 'polling', 'hooks', 'bootstrap']);
const noop = () => {};
export const DISABLED_PERFORMANCE_DIAGNOSTICS = Object.freeze({
  startOperation: () => noop, startPhase: () => noop, measure: (_name, work) => work(), close: noop,
});
const number = value => typeof value === 'number' && Number.isFinite(value)
  ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, value)) : 0;

/** Fixed, content-free metrics only. Probes and output must never fail business work. */
export function createPerformanceDiagnostics({
  enabled = false, now = () => performance.now(), memoryUsage = () => process.memoryUsage(),
  cpuUsage = () => process.cpuUsage(), uptime = () => process.uptime() * 1000,
  emit = line => { if (!process.stdout.destroyed && !process.stdout.writableNeedDrain) console.log(line); },
  setInterval: interval = globalThis.setInterval, clearInterval: clear = globalThis.clearInterval,
} = {}) {
  if (!enabled) return DISABLED_PERFORMANCE_DIAGNOSTICS;
  let closed = false;
  let closing = false;
  const readClock = () => { try { return number(now()); } catch { return 0; } };
  const readCpu = () => {
    try {
      const value = cpuUsage();
      return [value.user, value.system].every(part => typeof part === 'number' && Number.isFinite(part) && part >= 0)
        ? value.user + value.system : null;
    } catch { return null; }
  };
  let sampledAt = readClock();
  let lastTick = sampledAt;
  let sampledCpu = readCpu();
  let lagMax = 0;
  let sampleTimer, lagTimer;
  const totals = new Map();
  const send = event => {
    if (closed) return;
    try { emit(`${PERFORMANCE_PREFIX}${JSON.stringify(event)}`); } catch { /* Optional diagnostics. */ }
  };
  const record = (operation, duration, failed) => {
    if (closed || !OPERATIONS.has(operation)) return;
    const current = totals.get(operation) ?? { count: 0, failed: 0, total_ms: 0, max_ms: 0 };
    current.count = number(current.count + 1);
    current.failed = number(current.failed + (failed ? 1 : 0));
    current.total_ms = number(current.total_ms + duration);
    current.max_ms = Math.max(current.max_ms, duration);
    totals.set(operation, current);
  };
  function startOperation(operation) {
    if (closed || !OPERATIONS.has(operation)) return noop;
    const started = readClock();
    let finished = false;
    return (failed = false) => {
      if (finished || closed) return;
      finished = true;
      record(operation, number(readClock() - started), failed === true);
    };
  }
  function startPhase(phase) {
    if (closed || !PHASES.has(phase)) return noop;
    const started = readClock();
    let finished = false;
    return (status = 'ok') => {
      if (finished || closed) return;
      finished = true;
      const duration_ms = number(readClock() - started);
      const safeStatus = status === 'failed' ? 'failed' : 'ok';
      record(phase, duration_ms, safeStatus === 'failed');
      send({ event: 'startup_phase', phase, duration_ms, status: safeStatus });
    };
  }
  function measure(operation, work) {
    const finish = startOperation(operation);
    let result;
    try { result = work(); } catch (error) { finish(true); throw error; }
    if (result && typeof result.then === 'function') {
      return Promise.resolve(result).then(value => { finish(); return value; }, error => { finish(true); throw error; });
    }
    finish();
    return result;
  }
  function sample() {
    if (closed) return;
    const current = readClock();
    const elapsed = number(current - sampledAt);
    const cpu = readCpu();
    if (elapsed > 0 && cpu !== null && sampledCpu !== null && cpu >= sampledCpu) try {
      const memory = memoryUsage();
      send({ event: 'relay_sample', rss_bytes: Math.floor(number(memory.rss)),
        heap_used_bytes: Math.floor(number(memory.heapUsed)), heap_total_bytes: Math.floor(number(memory.heapTotal)),
        external_bytes: Math.floor(number(memory.external)), cpu_percent: number((cpu - sampledCpu) / (elapsed * 10)),
        event_loop_delay_max_ms: Math.max(lagMax, number(current - lastTick - 1000)),
        uptime_ms: number(uptime()), sample_interval_ms: elapsed });
    } catch { /* A failed resource probe does not suppress operation timings. */ }
    sampledAt = current;
    sampledCpu = cpu;
    lagMax = 0;
    const entries = [...totals];
    totals.clear();
    for (const [operation, values] of entries) send({ event: 'operation_timing', operation, ...values });
  }
  function close() {
    if (closed || closing) return;
    closing = true;
    sample();
    closed = true;
    totals.clear();
    try { clear(sampleTimer); } catch { /* Optional diagnostics. */ }
    try { clear(lagTimer); } catch { /* Optional diagnostics. */ }
  }
  try {
    lagTimer = interval(() => {
      if (closed) return;
      const current = readClock();
      lagMax = Math.max(lagMax, number(current - lastTick - 1000));
      lastTick = current;
    }, 1000);
    lagTimer.unref?.();
    sampleTimer = interval(sample, 15_000);
    sampleTimer.unref?.();
  } catch { close(); return DISABLED_PERFORMANCE_DIAGNOSTICS; }
  return { startOperation, startPhase, measure, close };
}
