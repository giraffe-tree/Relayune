import {createHistoryPerformanceRecorder} from '../relay/history-performance.mjs';
import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {mkdtemp, writeFile, readFile, stat, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';

test('history report joins local trace markers without copying private or unexpected fields', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'relayune-metrics-test-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const path = join(dir, 'fixture.log');
  const trace = `history_${'a'.repeat(32)}`;
  const samples = [
    {trace_id: trace, source: 'network', response_received_ms: 100, content: 'SECRET_CANARY',
      desktop: {history_read_ms: 20, session_id: 'SECRET_CANARY'}},
    {trace_id: trace, stage: 'uploaded', upload_ms: 10, request_body: 'SECRET_CANARY'},
    {trace_id: 'SECRET_CANARY', source: 'network', display_ms: 100},
  ];
  await writeFile(path, ['unrelated SECRET_CANARY', ...samples.map(sample =>
    `Relayune history performance ${JSON.stringify(sample)}`)].join('\n'));
  const {stdout} = await promisify(execFile)(process.execPath,
    ['scripts/summarize-history-performance.mjs', path]);
  assert.doesNotMatch(stdout, /SECRET_CANARY|request_body|session_id|content/);
  const report = JSON.parse(stdout);
  assert.equal(report.traces.length, 1);
  assert.equal(report.traces[0].samples.length, 2);
  assert.equal(report.traces[0].samples[0].desktop.history_read_ms, 20);
});

test('desktop persists only bounded private timing records even when stdout is discarded', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'relayune-private-metrics-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const path = join(dir, 'timings.jsonl');
  const record = createHistoryPerformanceRecorder(path, {maxBytes: 250});
  for (let i = 0; i < 4; i++) record({trace_id: `history_${'b'.repeat(32)}`, stage: 'uploaded',
    upload_ms: i, session_id: 'SECRET_CANARY', content: 'SECRET_CANARY'});
  await record.flush();
  const current = await readFile(path, 'utf8');
  const previous = await readFile(`${path}.previous`, 'utf8');
  assert.doesNotMatch(current + previous, /SECRET_CANARY|session_id|content/);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.ok(Buffer.byteLength(current) <= 250);
  assert.match(current, /"upload_ms":3/);
});

test('streaming stdin keeps current cache, phase and startup metrics and drops private fields', async () => {
  const child = spawn(process.execPath, ['scripts/summarize-history-performance.mjs', '-', '--stream']);
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr)));
  });
  const trace = `history_${'c'.repeat(32)}`;
  child.stdin.end([
    'unrelated SECRET_CANARY',
    'Relayune startup performance {"stage":"recent_list","dart_elapsed_ms":1104.7,"email":"SECRET_CANARY"}',
    `Relayune history performance ${JSON.stringify({trace_id: trace, source: 'sqlite-preview', selection_to_first_frame_ms: 168.6, cache_restored: true, desktop: {history_read_ms: 31, unknown_bytes: 999, token: 'SECRET_CANARY'}})}`,
    `Relayune history performance ${JSON.stringify({trace_id: trace, stage: 'history_load_phase', phase: 'reading', phase_ms: 3500, elapsed_ms: 4000, content: 'SECRET_CANARY'})}`,
    'Relayune history performance {"stage":"pending_input_save","write_ms":2,"success":true,"user_id":123}',
    'Relayune history performance {"trace_id":"SECRET_CANARY","stage":"cache_storage","bytes":200}',
    'Relayune startup performance {"stage":"SECRET_CANARY","dart_elapsed_ms":1}',
    'Relayune history performance {malformed}',
  ].join('\n'));
  await done;
  assert.doesNotMatch(stdout, /SECRET_CANARY|email|token|content|user_id|unknown_bytes/);
  const lines = stdout.trim().split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /recent_list/);
  assert.match(lines[1], /sqlite-preview/);
  assert.match(lines[2], /"phase":"reading"/);
  assert.match(lines[3], /pending_input_save/);
  // The streamed safe markers can be fed back to the existing summarizer.
  const reportChild = spawn(process.execPath, ['scripts/summarize-history-performance.mjs', '-']);
  let reportText = '';
  reportChild.stdout.on('data', chunk => { reportText += chunk; });
  const reportDone = new Promise((resolve, reject) => {
    reportChild.on('error', reject);
    reportChild.on('close', code => code === 0 ? resolve() : reject(new Error(`Exit ${code}`)));
  });
  reportChild.stdin.end(stdout);
  await reportDone;
  const report = JSON.parse(reportText);
  assert.equal(report.traces[0].samples.length, 2);
  assert.equal(report.startup_samples.length, 1);
  assert.equal(report.untraced_samples.length, 1);
});
