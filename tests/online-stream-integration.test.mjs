import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import test, {after} from 'node:test';
import {build} from 'esbuild';
import WebSocket from 'ws';
import {MacRelay} from '../relay/mac-relay.mjs';
import {MockCodexAdapter} from '../relay/codex-adapters.mjs';
import {generateE2eeKey, importE2eeKey} from '../relay/e2ee.mjs';

const temporary = await mkdtemp(join(tmpdir(), 'relayune-online-integration-'));
const entries = ['server/cipher-stream.ts', 'app/online-stream.ts', 'app/e2ee.ts'];
const modules = await Promise.all(entries.map(async (entry, index) => {
  const outfile = join(temporary, `${index}.cjs`);
  await build({entryPoints: [entry], bundle: true, platform: 'node', target: 'node22', format: 'cjs', outfile, logLevel: 'silent'});
  return import(pathToFileURL(outfile).href);
}));
const [{attachCipherStreamServer}, {OnlineStream}, browserCrypto] = modules;
after(() => rm(temporary, {recursive: true, force: true}));
const deviceId = `dev_${'a'.repeat(32)}`, browserId = `web_${'b'.repeat(32)}`;
const sessionId = 'ses_codex_remote';
const canary = 'CIPHER_STREAM_INTEGRATION_PRIVATE';
async function until(condition, label, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`);
    await delay(5);
  }
}

async function fixture(t) {
  const rawKey = generateE2eeKey();
  const browserKey = await browserCrypto.importRelayKey(rawKey);
  const key = await importE2eeKey(rawKey);
  let httpRequests = 0, authorizations = 0;
  const server = createServer((_request, response) => {httpRequests++; response.writeHead(500).end();});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const hub = attachCipherStreamServer(server, {
    publicOrigin: origin,
    authenticateSession: async () => 'fixture@example.test',
    authorizeRelay: async (_request, value) => {
      assert.equal(value.deviceId, deviceId); assert.equal(value.relayToken, 'fixture-relay'); authorizations++;
      return {deviceId};
    },
    authorizeBrowser: async (_request, _email, value) => {
      assert.equal(value.deviceId, deviceId); assert.equal(value.browserToken, 'fixture-browser'); authorizations++;
      return {deviceId, browserId, keyId: browserKey.kid};
    },
  });
  const adapter = new MockCodexAdapter({workspace: temporary, historyMessages: [{
    id: 'msg_baseline', role: 'codex', content: `${canary} history`, created_at: new Date().toISOString(), turn_id: 'turn_test',
  }]});
  adapter.mockSessions[0].name = `${canary} catalog`;
  const relay = new MacRelay({deviceId, deviceToken: 'fixture-relay', serverUrl: origin, statePath: null,
    adapter, readAgentRuntimeInfo: async () => ({})});
  relay.ready = true;
  relay.onlineTransportEnabled = true;
  relay.authorizationObservedAt = Date.now();
  relay.browserKeys.set(browserId, {browserId, key, keyId: browserKey.kid});
  relay.syncBrowserAuthorizations([{id: browserId, key_id: browserKey.kid}]);
  const wire = [], received = [], clients = [];
  relay.startOnlineTransport();
  const relaySocket = relay.onlineTransport.socket;
  const relaySend = relaySocket.send.bind(relaySocket);
  relaySocket.send = (value, ...args) => {wire.push(String(value)); return relaySend(value, ...args);};
  await until(() => relay.onlineTransport.expiresAt > Date.now(), 'relay subscription ready');
  let current, serial = 0;
  function connect() {
    let stream;
    stream = new OnlineStream({origin, deviceId, browserId, browserToken: 'fixture-browser',
      socketFactory: url => {
        const socket = new WebSocket(url, {origin});
        const send = socket.send.bind(socket);
        socket.send = (value, ...args) => {wire.push(String(value)); return send(value, ...args);};
        socket.on('message', value => wire.push(String(value)));
        return socket;
      },
      onOnline() {}, onClosed() {},
      onFrame: async frame => {
        const value = await browserCrypto.openJson(browserKey, frame.envelope, frame.aad);
        received.push({frame, value, stream});
      },
    });
    clients.push(stream); current = stream; stream.connect(); return stream;
  }
  async function ready(stream) {
    await until(() => stream.available && relay.onlineTransport.peer(browserId)?.connectionId === stream.connectionId, 'browser subscription ready');
  }
  async function frame(type, payload = {}, session = null) {
    const requestId = `req_integration_${++serial}`, createdAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 60_000).toISOString();
    const aad = {direction: 'web_to_relay', type, device_id: deviceId, session_id: session,
      request_id: requestId, event_seq: null, created_at: createdAt, expires_at: expiresAt};
    const value = {type, device_id: deviceId, session_id: session, request_id: requestId, payload, issued_at: createdAt, expires_at: expiresAt};
    return {device_id: deviceId, session_id: session, request_id: requestId, command_type: type,
      created_at: createdAt, expires_at: expiresAt, aad, envelope: await browserCrypto.sealJson(browserKey, value, aad)};
  }
  async function request(type, payload = {}, session = null, stream = current) {
    const response = await stream.request(await frame(type, payload, session), 3000);
    return browserCrypto.openJson(browserKey, response.envelope, response.aad);
  }
  const resume = async (stream = current) => {
    const response = await request('transport.resume', {connection_id: stream.connectionId}, null, stream);
    assert.equal(response.type, 'transport.ready'); assert.equal(response.connection_id, stream.connectionId);
    return response;
  };
  const ack = async (event, stream = current, generation = stream.connectionId) => {
    stream.send(await frame('transport.event_ack', {connection_id: generation, event_id: event.event_id, event_seq: event.event_seq}));
  };
  const event = value => relay.writeEvent(sessionId, {kind: 'message.delta', ...value});
  t.after(async () => {
    for (const stream of clients) stream.close();
    await relay.stop(); hub.close();
    await new Promise(resolve => server.close(resolve));
  });
  const stream = connect(); await ready(stream);
  await until(() => received.some(value => value.value.type === 'relay.sync_sessions'), 'encrypted initial catalog');
  return {relay, adapter, wire, received, connect, ready, request, frame, resume, ack, event,
    get stream() {return current;}, httpRequests: () => httpRequests, authorizations: () => authorizations};
}

test('production browser, relay and WebSocket server exchange encrypted catalog, directory, history and ACK with zero HTTP', {timeout: 15000}, async t => {
  const f = await fixture(t);
  const initialCatalog = f.received.find(item => item.value.type === 'relay.sync_sessions').value;
  assert.ok(initialCatalog.desktop.transports.includes('online-stream-v1'));
  assert.equal(initialCatalog.desktop.directory_push_version, 1);
  assert.ok(initialCatalog.directory_revision);
  const directory = await f.request('project.sessions', {directory_sync: true, batch_size: 300});
  assert.equal(directory.type, 'project.result');
  assert.equal(directory.directory.sessions[0].name, `${canary} catalog`);
  const history = await f.request('session.read_history', {limit: 100}, sessionId);
  assert.equal(history.type, 'session.history'); assert.equal(history.messages[0].content, `${canary} history`);
  await f.resume();
  const record = await f.event({text: `${canary} live`});
  await until(() => f.received.some(item => item.frame.event_id === record.variants[0].event_id), 'live event');
  assert.equal(f.relay.outbox.pending.size, 1);
  await f.ack(record.variants[0]);
  await until(() => f.relay.outbox.pending.size === 0, 'encrypted ACK retires durable event');
  assert.equal(f.httpRequests(), 0);
  assert.equal(f.authorizations(), 2);
  assert.ok(!f.wire.join('').includes(canary));
});

test('catalog revision changes are pushed over the real wire without directory polling or HTTP', {timeout: 15000}, async t => {
  const f = await fixture(t);
  const revision = f.received.find(item => item.value.type === 'relay.sync_sessions').value.directory_revision;
  await f.request('project.sessions', {directory_sync: true, batch_size: 300});
  f.adapter.mockSessions[0].name = `${canary} renamed`;
  await f.relay.syncSessionCatalog();
  await until(() => f.received.some(item => item.value.type === 'relay.sync_sessions' && item.value.directory_revision !== revision), 'directory revision push');
  const pushed = f.received.findLast(item => item.value.type === 'relay.sync_sessions').value;
  assert.deepEqual(pushed.sessions, []);
  const delta = await f.request('project.sessions', {directory_sync: true, batch_size: 300, revision});
  assert.equal(delta.directory.sessions[0].name, `${canary} renamed`);
  assert.equal(f.httpRequests(), 0);
});

test('disconnect stops copies and reconnect rejects stale ACK generations before explicit resync', {timeout: 15000}, async t => {
  const f = await fixture(t); await f.resume();
  const record = await f.event({text: `${canary} unconsumed`});
  await until(() => f.received.some(item => item.frame.event_id === record.variants[0].event_id), 'unconsumed event');
  const old = f.stream, generation = old.connectionId;
  old.close();
  await until(() => !f.relay.onlineTransport.peer(browserId), 'offline subscription removed');
  assert.equal(await f.event({text: 'offline'}), null);
  for (const pending of f.relay.outbox.after(0)) f.relay.send(pending, {replay: true});
  await Promise.all([...f.relay.operations]);
  const replacement = f.connect(); await f.ready(replacement);
  assert.notEqual(replacement.connectionId, generation);
  await f.ack(record.variants[0], replacement, generation);
  await delay(30);
  assert.equal(f.relay.outbox.pending.size, 1);
  await f.resume(replacement);
  await until(() => f.relay.outbox.pending.size === 0, 'baseline supersedes old generation');
  const next = await f.event({text: 'new generation'});
  await until(() => f.received.some(item => item.stream === replacement && item.frame.event_id === next.variants[0].event_id), 'replacement event');
  await f.ack(next.variants[0], replacement);
  await until(() => f.relay.outbox.pending.size === 0, 'replacement ACK');
  assert.equal(f.httpRequests(), 0);
});

test('post-resume authoritative history covers an event generated between initial snapshot and activation', {timeout: 15000}, async t => {
  const f = await fixture(t);
  const before = await f.request('session.read_history', {limit: 100}, sessionId);
  assert.equal(before.messages.length, 1);
  f.adapter.historyMessages.push({id: 'msg_gap', role: 'codex', content: `${canary} gap`, created_at: new Date().toISOString(), turn_id: 'turn_gap'});
  assert.equal(await f.event({text: `${canary} gap`}), null);
  await f.resume();
  const after = await f.request('session.read_history', {limit: 100}, sessionId);
  assert.ok(after.messages.some(message => message.id === 'msg_gap' && message.content === `${canary} gap`));
  const live = await f.event({text: 'after baseline'});
  await until(() => f.received.some(item => item.frame.event_id === live.variants[0].event_id), 'post-baseline live event');
  await f.ack(live.variants[0]);
  await until(() => f.relay.outbox.pending.size === 0, 'post-baseline ACK');
  assert.equal(f.httpRequests(), 0);
});

test('real encrypted resync control crosses the router when a subscribed browser stops acknowledging', {timeout: 15000}, async t => {
  const f = await fixture(t); await f.resume();
  for (let index = 0; index < 64; index++) await f.event({text: `fragment_${index}`});
  assert.equal(await f.event({text: 'exceeds credit'}), null);
  await until(() => f.received.some(item => item.value.type === 'transport.resync_required'), 'encrypted resync control');
  const control = f.received.findLast(item => item.value.type === 'transport.resync_required');
  assert.equal(control.value.connection_id, f.stream.connectionId);
  assert.equal(control.frame.request_id, null);
  assert.equal(f.relay.onlineTransport.peer(browserId).paused, true);
  await f.request('session.read_history', {limit: 100}, sessionId);
  await f.resume();
  assert.equal(f.relay.onlineTransport.peer(browserId).paused, false);
  assert.equal(f.relay.outbox.pending.size, 0);
  assert.equal(f.httpRequests(), 0);
});
