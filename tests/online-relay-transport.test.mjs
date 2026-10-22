import test from 'node:test';
import assert from 'node:assert/strict';
import {MacRelay} from '../relay/mac-relay.mjs';
import {OnlineRelayTransport, ONLINE_EVENT_BYTES} from '../relay/online-transport.mjs';
import {generateE2eeKey, importE2eeKey, keyIdForKey, sealJson, openJson} from '../relay/e2ee.mjs';

async function fixture(t) {
  const relay = new MacRelay({deviceId: 'dev_test', statePath: null, adapter: {close: async () => {}}});
  relay.ready = true;
  relay.onlineTransportEnabled = true;
  relay.authorizationObservedAt = Date.now();
  const browsers = [];
  for (const id of ['web_live', 'web_offline']) {
    const key = await importE2eeKey(generateE2eeKey());
    const browser = {browserId: id, key, keyId: await keyIdForKey(key)};
    relay.activeBrowserKeys.set(id, browser);
    browsers.push(browser);
  }
  const wire = [], uploads = [];
  let now = Date.now();
  const online = new OnlineRelayTransport({serverUrl: 'https://example.test', deviceId: relay.deviceId, token: 'test',
    authorized: id => relay.activeBrowserKeys.has(id), now: () => now,
    receive: (peer, frame) => relay.receiveOnlineCommand(peer, frame),
    paused: peer => relay.sendOnlineControl(peer, null, 'transport.resync_required')});
  online.socket = {readyState: 1, bufferedAmount: 0, send: raw => wire.push(JSON.parse(raw)), terminate() {}};
  relay.onlineTransport = online;
  relay.enqueueRemoteMessages = frames => uploads.push(...frames);
  relay.flushRemoteUploads = async () => {};
  relay.syncSessionCatalog = async () => {};
  const subscriptions = (generation = 'conn_1') => online.handle({type: 'subscriptions',
    peers: [{browser_id: 'web_live', connection_id: generation, transport: 'stream'}], expires_at: now + 30_000});
  await subscriptions();
  const peer = () => online.peer('web_live');
  let sequence = 0;
  async function command(type, payload = {}, extras = {}) {
    const request_id = `req_${++sequence}`;
    const aad = {direction: 'web_to_relay', type, device_id: relay.deviceId, session_id: null,
      request_id, event_seq: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString()};
    const value = {type, device_id: relay.deviceId, session_id: null, request_id,
      issued_at: aad.created_at, expires_at: aad.expires_at, payload};
    const frame = {device_id: relay.deviceId, session_id: null, request_id, command_type: type, aad,
      envelope: await sealJson(browsers[0].key, value, aad), ...extras};
    await relay.receiveOnlineCommand(peer(), frame);
  }
  const resume = () => command('transport.resume', {connection_id: peer().connectionId});
  const event = () => relay.writeEvent('ses_test', {type: 'message.delta', text: 'PRIVATE_CANARY'});
  const settle = () => Promise.all([...relay.operations]);
  t.after(async () => {relay.closed = true; online.close(); await settle();});
  return {relay, online, wire, uploads, peer, command, resume, event, settle, subscriptions,
    advance(ms) {now += ms;}, browsers};
}

test('only resumed live subscribers produce ciphertext and only their encrypted ACK retires it', async t => {
  const f = await fixture(t);
  assert.equal(await f.event(), null);
  assert.equal(f.relay.outbox.pending.size, 0);
  await f.resume();
  const record = await f.event(); await f.settle();
  assert.equal(record.variants.length, 1);
  const frame = record.variants[0];
  assert.equal(frame.browser_id, 'web_live');
  assert.equal(f.uploads.length, 0);
  assert.ok(!JSON.stringify(f.wire).includes('PRIVATE_CANARY'));
  assert.equal(f.relay.outbox.pending.size, 1);
  await f.command('transport.event_ack', {event_id: frame.event_id, event_seq: frame.event_seq, connection_id: 'wrong_generation'});
  assert.equal(f.relay.outbox.pending.size, 1);
  await f.command('transport.event_ack', {event_id: frame.event_id, event_seq: frame.event_seq, connection_id: f.peer().connectionId});
  assert.equal(f.relay.outbox.pending.size, 0);
  assert.equal(f.online.pendingBytes, 0);
  assert.equal(f.online.pending.size, 0);
});

test('64 unconsumed events pause producer without falling back to Mongo', async t => {
  const f = await fixture(t); await f.resume();
  for (let i = 0; i < 64; i++) await f.event();
  await f.settle();
  assert.equal(f.relay.outbox.pending.size, 64);
  assert.equal(await f.event(), null);
  assert.equal(f.peer().paused, true);
  assert.equal(f.uploads.length, 0);
  assert.ok(f.online.pendingBytes <= ONLINE_EVENT_BYTES);
  await f.peer().pauseTask;
  await f.settle();
  const controls = await Promise.all(f.wire.filter(value => value.frame?.kind === 'response').map(value =>
    openJson(f.browsers[0].key, value.frame.envelope, value.frame.aad)));
  assert.ok(controls.some(value => value.type === 'transport.resync_required'));
});

test('silent subscribers pause after ten seconds without consumer progress', async t => {
  const f = await fixture(t); await f.resume(); await f.event(); await f.settle();
  f.advance(10_001); f.online.sweep();
  assert.equal(f.peer().paused, true);
  assert.equal(await f.event(), null);
  assert.equal(f.uploads.length, 0);
});

test('lost offline notifications and expired subscription feed stop production', async t => {
  const f = await fixture(t); await f.resume(); await f.event(); await f.settle();
  f.advance(30_001); f.online.sweep();
  assert.equal(f.peer(), null);
  assert.equal(await f.event(), null);
  for (const record of f.relay.outbox.after(0)) f.relay.send(record, {replay: true});
  await f.settle();
  assert.equal(f.uploads.length, 0);
});

test('replacement connection cannot ACK old generation; baseline resume releases only its own copies', async t => {
  const f = await fixture(t); await f.resume();
  const record = await f.event(); await f.settle();
  const old = f.peer(), frame = record.variants[0];
  await f.subscriptions('conn_2');
  assert.notEqual(f.peer(), old);
  await f.command('transport.event_ack', {event_id: frame.event_id, event_seq: frame.event_seq, connection_id: 'conn_2'});
  assert.equal(f.relay.outbox.pending.size, 1);
  await f.resume();
  assert.equal(f.relay.outbox.pending.size, 0);
  assert.equal(f.online.pendingBytes, 0);
  await f.online.handle({type: 'peer', browser_id: 'web_live', connection_id: 'conn_1', state: 'offline'});
  assert.ok(f.peer());
});

test('encrypted stream directory read reaches local snapshot without HTTP or durable write receipt', async t => {
  const f = await fixture(t);
  await f.command('project.sessions', {directory_sync: true, batch_size: 300});
  await f.settle();
  assert.equal(f.uploads.length, 0);
  assert.equal(Object.keys(f.relay.outbox.transportRequests).length, 0);
  const response = f.wire.find(value => value.frame?.kind === 'response');
  const clear = await openJson(f.browsers[0].key, response.frame.envelope, response.frame.aad);
  assert.equal(clear.type, 'project.result');
  assert.equal(clear.directory.version, 1);
});

for (const rejected of [false, true]) {
  test(`HTTPS session creation ${rejected ? 'error' : 'result'} remains recoverable with a live stream subscriber`, async t => {
    const f = await fixture(t);
    let creations = 0;
    f.relay.adapter.createSession = async ({cwd, name, provider}) => {
      creations++;
      if (rejected) throw new Error('Test provider rejection');
      return {id: 'ses_created', cwd, name, provider};
    };
    f.relay.finalizeCreatedSession = async () => {};
    const command = {type: 'session.create', device_id: f.relay.deviceId,
      browser_id: f.browsers[0].browserId, session_id: null, request_id: 'req_http_create',
      issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(),
      payload: {cwd: '/tmp/relayune-route-test', name: 'Route test', provider: 'codex'}};
    f.relay.dispatchRemoteCommand(command, f.browsers[0], Date.now());
    await f.relay.remoteCommandTasks.get(command.request_id);
    await f.settle();
    const response = f.uploads.find(frame => frame.kind === 'response');
    assert.ok(response, 'HTTPS caller must be able to read its authoritative response');
    assert.equal(f.wire.filter(value => value.frame?.kind === 'response').length, 0);
    const clear = await openJson(f.browsers[0].key, response.envelope, response.aad);
    assert.equal(clear.type, rejected ? 'session.create_error' : 'session.create_result');
    assert.equal(clear.request_id, command.request_id);
    assert.equal(response.session_id, rejected ? null : 'ses_created');
    assert.ok(!JSON.stringify(f.uploads).includes('Route test'));
    f.uploads.length = 0;
    f.relay.dispatchRemoteCommand(command, f.browsers[0], Date.now());
    await f.settle();
    assert.equal(creations, 1);
    assert.deepEqual(f.uploads.find(frame => frame.kind === 'response'), response);
  });
}

test('route tampering is rejected before local data access', async t => {
  const f = await fixture(t);
  await assert.rejects(f.command('project.sessions', {directory_sync: true}, {device_id: 'dev_other'}), /invalid_route/);
  assert.equal(f.wire.length, 0);
});

test('legacy peers preserve HTTPS delivery while offline grants remain excluded', async t => {
  const f = await fixture(t);
  await f.online.handle({type: 'subscriptions', peers: [{browser_id: 'web_live', connection_id: 'legacy:web_live', transport: 'legacy'}], expires_at: Date.now() + 30_000});
  const record = await f.event(); await f.settle();
  assert.equal(record.variants.length, 1);
  assert.equal(record.variants[0].online_only, undefined);
  assert.equal(f.uploads.length, 1);
  assert.equal(f.uploads[0].browser_id, 'web_live');
});

test('offline completion uses one small durable notification without retaining generated content', async t => {
  const f = await fixture(t); await f.resume();
  f.relay.lastSessionCatalog = [{id: 'ses_test'}];
  const record = await f.relay.writeEvent('ses_test', {kind: 'turn.completed', turn_id: 'turn_test', status: 'completed',
    output: 'SECRET_OUTPUT'.repeat(100000)});
  await f.settle();
  // The oversized live payload requests resync; its offline notification stays small.
  assert.equal(record.variants.length, 1);
  assert.equal(f.uploads.length, 1);
  const notification = f.uploads[0];
  assert.equal(notification.browser_id, 'web_offline');
  assert.equal(notification.notification_hint, true);
  assert.ok(Buffer.byteLength(JSON.stringify(notification)) < 16 * 1024);
  const plaintext = await openJson(f.browsers[1].key, notification.envelope, notification.aad);
  assert.equal(plaintext.event.kind, 'turn.completed');
  assert.equal(plaintext.event.output, undefined);
  assert.equal(f.relay.notificationEvents.size, 1);
});

test('byte pressure pauses producer even below the event-count limit', async t => {
  const f = await fixture(t); await f.resume();
  assert.equal(await f.relay.writeEvent('ses_test', {kind: 'message.delta', text: 'x'.repeat(300000)}), null);
  assert.equal(f.peer().paused, true);
  assert.equal(f.online.pendingBytes, 0);
  assert.equal(f.relay.outbox.pending.size, 0);
  assert.equal(f.uploads.length, 0);
});
