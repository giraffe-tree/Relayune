import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

// Read exported local Desktop/mobile logs. Emit only an allowlist of timings;
// never copy other log lines or message/session/account fields into reports.
const numericFields = ['desktop_received_at_ms', 'history_started_at_ms',
  'history_ready_at_ms', 'encrypted_at_ms', 'history_read_ms', 'command_wait_ms', 'queued_at_ms',
  'upload_started_at_ms', 'upload_completed_at_ms', 'queue_wait_ms', 'upload_ms',
  'response_wire_bytes', 'queue_entries', 'request_started_at_ms',
  'command_posted_ms', 'response_received_ms', 'merged_ms', 'display_ms',
  'displayed_at_ms', 'deferred_display_since_request_ms', 'response_plaintext_bytes', 'message_count', 'cache_read_ms', 'failed_ms',
  'selection_started_at_ms', 'selection_request_offset_ms', 'selection_to_first_frame_ms',
  'phase_ms', 'elapsed_ms', 'write_ms', 'changed_messages', 'messages', 'pages', 'bytes',
  'sessions', 'queue_sessions', 'pending', 'evictions', 'index_read_bytes', 'index_parse_ms'];
const sources = ['selection', 'sqlite-preview', 'sqlite', 'sqlite-supplement', 'network', 'memory'];
const stages = ['queued', 'uploaded', 'history_load_phase', 'cache_storage',
  'cache_maintenance_unavailable', 'cache_checkpoint', 'cache_unavailable',
  'cache_write_failed', 'cache_read_failed', 'cache_cleanup_failed',
  'directory_cache_write_failed', 'offline_restore_unavailable',
  'background_memory_release', 'pending_input_save'];
const phases = ['sending', 'waiting', 'reading', 'preparing', 'transferring', 'restoring'];
const startupStages = ['first_frame', 'home_interactive', 'recent_list'];
const args = process.argv.slice(2);
const stream = args.includes('--stream');
if (stream) args.splice(args.indexOf('--stream'), 1);
const outputFlag = args.indexOf('--output');
const output = outputFlag >= 0 ? args.splice(outputFlag, 2)[1] : null;
if (!args.length || (stream && output)) throw new Error('Usage: node scripts/summarize-history-performance.mjs <local-log|->... [--output report.json | --stream]');
const traces = new Map();
const untracedSamples = [];
const startupSamples = [];
for (const path of args) {
  const lines = createInterface({ input: path === '-' ? process.stdin : createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    const match = line.match(/Relayune (history|startup) performance (\{.*\})/);
    if (!match) continue;
    let sample;
    try { sample = JSON.parse(match[2]); } catch { continue; }
    if (!sample || typeof sample !== 'object' || Array.isArray(sample)) continue;
    if (match[1] === 'startup') {
      if (!startupStages.includes(sample.stage) || !Number.isFinite(sample.dart_elapsed_ms)) continue;
      const safe = { stage: sample.stage, dart_elapsed_ms: sample.dart_elapsed_ms };
      if (stream) process.stdout.write(`Relayune startup performance ${JSON.stringify(safe)}\n`);
      else startupSamples.push(safe);
      continue;
    }
    const hasTrace = /^history_[a-f0-9]{32}$/.test(sample.trace_id ?? '');
    // A malformed identifier must never become an untraced record.
    if (!hasTrace && (sample.trace_id != null || !stages.includes(sample.stage))) continue;
    const safe = {};
    for (const name of numericFields) {
      if (Number.isFinite(sample[name])) safe[name] = sample[name];
    }
    if (sample.desktop && typeof sample.desktop === 'object') {
      safe.desktop = {};
      for (const name of numericFields) {
        if (Number.isFinite(sample.desktop[name])) safe.desktop[name] = sample.desktop[name];
      }
    }
    for (const name of ['request_visible', 'cache_restored', 'earlier', 'sealed', 'success']) {
      if (typeof sample[name] === 'boolean') safe[name] = sample[name];
    }
    if (sources.includes(sample.source)) safe.source = sample.source;
    if (stages.includes(sample.stage)) safe.stage = sample.stage;
    if (phases.includes(sample.phase)) safe.phase = sample.phase;
    if (stream) {
      process.stdout.write(`Relayune history performance ${JSON.stringify({ ...(hasTrace ? {trace_id: sample.trace_id} : {}), ...safe })}\n`);
      continue;
    }
    if (!hasTrace) { untracedSamples.push(safe); continue; }
    const trace = traces.get(sample.trace_id) ?? {trace_id: sample.trace_id, samples: []};
    trace.samples.push(safe);
    traces.set(sample.trace_id, trace);
  }
}
const report = {schema_version: 2, clock_scope: 'Compare same-device durations; cross-device wall times require clock alignment.',
  traces: [...traces.values()], startup_samples: startupSamples, untraced_samples: untracedSamples};
const json = `${JSON.stringify(report, null, 2)}\n`;
if (!stream) {
  if (output) await writeFile(output, json); else process.stdout.write(json);
}
