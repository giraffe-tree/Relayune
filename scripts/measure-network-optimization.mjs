// Loopback HTTP/WebSocket A/B measurement. Real handlers/codecs, synthetic DB data.
// Never connects to production, reads sessions, or prints bodies/credentials.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer, get } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import WebSocket from 'ws';
import { generateE2eeKey, sealJson, openJson } from '../relay/e2ee.mjs';
import { compressRelayResponse } from '../server/response-compression.mjs';

const BASE = '1794c42';
const temporary = await mkdtemp(join(tmpdir(), 'relayune-network-ab-'));
async function load(file, baseline = false) {
  const source = baseline ? execFileSync('git', ['show', `${BASE}:${file}`], { encoding: 'utf8' }) : null;
  const outfile = join(temporary, `${file.split('/').at(-1)}-${baseline ? 'before' : 'after'}.cjs`);
  await build({ ...(baseline ? { stdin: { contents: source, resolveDir: resolve('server'), loader: 'ts' } } : { entryPoints: [file] }),
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  return import(pathToFileURL(outfile));
}
const deviceId = 'dev_synthetic';
const browserId = 'web_synthetic';
const key = generateE2eeKey();
const timestamp = Date.now();
async function sealed(type, payload, index = 0) {
  const aad = { direction: 'relay_to_web', type, device_id: deviceId, session_id: 'ses_synthetic',
    request_id: `req_${index}`, event_seq: index, created_at: new Date(timestamp).toISOString() };
  return { aad: JSON.stringify(aad), envelope: JSON.stringify(await sealJson(key, payload, aad)),
    created_at: timestamp, updated_at: timestamp, device_id: deviceId, browser_id: browserId,
    session_id: 'ses_synthetic', request_id: `req_${index}`, event_id: `evt_${index}`,
    event_seq: index, cursor: index, agent_id: 'codex' };
}
const catalog = await sealed('catalog', { sessions: Array.from({ length: 80 }, (_, i) => ({ id: `ses_${i}`, name: `Synthetic session ${i}`, status: 'idle', cwd: '/synthetic/project' })), projects: [] });
const events = await Promise.all(Array.from({ length: 180 }, (_, i) => sealed('event', {
  id: `evt_${i + 1}`, text: `Synthetic output ${i + 1}: ` + '代码输出，用于带宽测量。'.repeat(40),
}, i + 1)));
const responseRow = await sealed('session.history', { messages: Array.from({ length: 100 }, (_, i) => ({ id: `m_${i}`, content: 'Synthetic history paragraph. '.repeat(100) })) });

function database() {
  return { prepare(sql) {
    let args = [];
    return { bind(...values) { args = values; return this; }, async run() { return { success: true, meta: { changes: 1 } }; },
      async first() {
        if (sql.includes('SELECT id, email FROM relay_users')) return { id: 'usr_synthetic', email: 'synthetic@example.com' };
        if (sql.includes('FROM relay_browser_authorizations')) return { id: browserId, device_id: deviceId, user_id: 'usr_synthetic' };
        if (sql.includes('FROM relay_devices')) return { id: deviceId, name: 'Synthetic Desktop', ack_seq: 0, last_seen_at: timestamp };
        if (sql.includes('FROM relay_catalogs')) return catalog;
        if (sql.includes('FROM relay_responses')) return responseRow;
        if (sql.includes('SUM(CASE')) return { queued: 2, pending: 2 };
        if (sql.includes('COALESCE(MAX')) return { cursor: events.length };
        throw Error('unsupported synthetic query');
      }, async all() {
        if (sql.includes('FROM relay_events')) return { results: sql.includes('LIMIT 200') ? events.slice(-200) : events.filter(x => x.cursor > args[2]).slice(0, args.at(-1)) };
        throw Error('unsupported synthetic list');
      } };
  } };
}

async function httpFixture(api, compressed) {
  const env = { DB: database(), RELAY_BLOBS: { get: async () => null } };
  const server = createServer(async (req, res) => {
    try {
      const response = await api.handleRelayApi(new Request(`http://localhost${req.url}`, { headers: {
        'oai-authenticated-user-email': 'synthetic@example.com', 'x-relay-browser-token': 'B'.repeat(43),
      } }), env);
      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      const body = Buffer.from(await response.arrayBuffer());
      res.end(compressed ? await compressRelayResponse(req, res, body) : body);
    } catch { res.statusCode = 500; res.end('synthetic fixture failed'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const samples = [];
  return { samples,
    request(path, encoding = 'gzip') { return new Promise((resolve, reject) => {
      get({ host: '127.0.0.1', port: server.address().port, path, headers: { 'Accept-Encoding': encoding } }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          try {
            assert.equal(res.statusCode, 200);
            const wire = Buffer.concat(chunks);
            const bytes = res.headers['content-encoding'] === 'gzip' ? gunzipSync(wire) : wire;
            samples.push({ route: path.split('?')[0], wire_bytes: wire.length, identity_bytes: bytes.length, gzip: res.headers['content-encoding'] === 'gzip' });
            resolve(JSON.parse(bytes));
          } catch (error) { reject(error); }
        });
        res.on('error', reject);
      }).on('error', reject);
    }); },
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

async function notificationScenario(api, queueModule, optimized, scopes) {
  const fixture = await httpFixture(api, optimized);
  // A queue-only invalidation starts from an already bootstrapped browser.
  // Mixed reconnect starts behind the server and must catch up every event.
  let cursor = scopes.includes('events') ? 0 : events.length;
  let latestCatalog; let queued;
  const applied = new Set(scopes.includes('events') ? [] : events.map(row => row.event_id));
  const consume = async rows => {
    for (const row of rows) { const value = await openJson(key, row.envelope, row.aad); applied.add(value.id); cursor = Math.max(cursor, row.cursor); }
  };
  async function sync(batch) {
    if (batch.includes('events')) {
      while (true) {
        const data = await fixture.request(`/api/events?device_id=${deviceId}&cursor=${cursor}`);
        await consume(data.events);
        if (!data.has_more) break;
      }
    }
    const mode = optimized ? batch.includes('catalog') ? '&include_events=0' : batch.includes('queue') ? '&summary_only=1' : null : '';
    if (mode !== null) {
      const data = await fixture.request(`/api/bootstrap?device_id=${deviceId}${mode}`);
      if (data.catalog) latestCatalog = await openJson(key, data.catalog.envelope, data.catalog.aad);
      await consume(data.events);
      queued = data.queued_commands;
    }
  }
  try {
    if (optimized) {
      let done; let failed;
      const finished = new Promise((resolve, reject) => { done = resolve; failed = reject; });
      const queue = queueModule.createInvalidationQueue({ run: async batch => { try { await sync(batch); done(); } catch (error) { failed(error); throw error; } }, onError() {} });
      try { for (let i = 0; i < 20; i++) queue.enqueue(scopes); await finished; }
      finally { queue.dispose(); }
    } else { for (let i = 0; i < 20; i++) await sync(scopes); }
    assert.equal(queued, 2);
    assert.equal(applied.size, 180);
    assert.equal(cursor, 180);
    if (scopes.includes('catalog')) assert.equal(latestCatalog.sessions.length, 80);
    return { requests: fixture.samples.length, wire_bytes: fixture.samples.reduce((sum, row) => sum + row.wire_bytes, 0),
      bootstrap_requests: fixture.samples.filter(row => row.route === '/api/bootstrap').length,
      applied_events: applied.size, cursor, queued_commands: queued };
  } finally { await fixture.close(); }
}

async function websocketScenario(module) {
  const server = createServer();
  const hub = module.attachRealtimeServer(server, { publicOrigin: 'http://synthetic.test', onlineWindowMs: 60_000,
    heartbeatIntervalMs: 60_000, authenticateSession: async () => 'synthetic@example.com',
    authorize: async () => ({ deviceId, browserId, lastSeenAt: Date.now() }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/realtime`, { origin: 'http://synthetic.test' });
  const frames = [];
  socket.on('message', data => { const value = JSON.parse(data); if (value.type === 'invalidate') frames.push({ bytes: data.byteLength, scopes: value.scopes }); });
  try {
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const ready = new Promise(resolve => socket.once('message', resolve));
    socket.send(JSON.stringify({ type: 'subscribe', device_id: deviceId, browser_token: 'B'.repeat(43) }));
    await ready;
    for (let i = 0; i < 20; i++) hub.invalidate(deviceId, ['catalog', 'events', 'queue', 'responses']);
    await delay(120);
    assert.ok(frames.length > 0);
    assert.deepEqual(frames.at(-1).scopes, ['catalog', 'events', 'queue', 'responses']);
    return { frames: frames.length, payload_bytes: frames.reduce((sum, row) => sum + row.bytes, 0) };
  } finally { socket.terminate(); hub.close(); await new Promise(resolve => server.close(resolve)); }
}

try {
  const [beforeApi, afterApi, beforeWs, afterWs, queueModule] = await Promise.all([
    load('server/relay-api.ts', true), load('server/relay-api.ts'), load('server/realtime.ts', true),
    load('server/realtime.ts'), load('app/invalidation-queue.ts'),
  ]);
  const single = await httpFixture(afterApi, true);
  const responseSizes = [];
  try {
    for (const path of [`/api/events?device_id=${deviceId}`, `/api/bootstrap?device_id=${deviceId}`, '/api/responses/synthetic']) {
      const plain = await single.request(path, 'identity');
      const plainSize = single.samples.at(-1).wire_bytes;
      const compressed = await single.request(path);
      // server_time is intentionally generated per request; envelopes must remain byte-for-byte identical.
      if (plain.envelope) assert.deepEqual(compressed.envelope, plain.envelope);
      if (plain.events) assert.deepEqual(compressed.events, plain.events);
      if (plain.catalog) assert.deepEqual(compressed.catalog, plain.catalog);
      const gzipSize = single.samples.at(-1).wire_bytes;
      responseSizes.push({ route: path.split('?')[0], identity_bytes: plainSize, gzip_bytes: gzipSize,
        saved_percent: +(100 * (1 - gzipSize / plainSize)).toFixed(2) });
    }
  } finally { await single.close(); }
  const scenarios = [];
  for (const [name, scopes] of [['queue_burst', ['queue']], ['mixed_burst', ['events', 'catalog', 'queue', 'responses']]]) {
    const before = await notificationScenario(beforeApi, queueModule, false, scopes);
    const after = await notificationScenario(afterApi, queueModule, true, scopes);
    assert.equal(after.applied_events, before.applied_events);
    assert.equal(after.cursor, before.cursor);
    assert.equal(after.queued_commands, before.queued_commands);
    scenarios.push({ name, notifications: 20, before, after, saved_percent: +(100 * (1 - after.wire_bytes / before.wire_bytes)).toFixed(4) });
  }
  const wsBefore = await websocketScenario(beforeWs);
  const wsAfter = await websocketScenario(afterWs);
  assert.equal(wsBefore.frames, 20); assert.equal(wsAfter.frames, 1);
  console.log(JSON.stringify({ baseline_commit: BASE, synthetic: true, transport: 'loopback HTTP/WebSocket',
    limitations: 'Synthetic DB, real API handlers and queue. Burst results are not production savings or a full browser UI test. Counts exclude TLS/TCP headers, retransmits and static assets. Queue-only preserves client history rather than replaying it.',
    response_sizes: responseSizes, scenarios, websocket: { before: wsBefore, after: wsAfter } }, null, 2));
} finally { await rm(temporary, { recursive: true, force: true }); }
