const TRANSPORT_FIXTURE_TIME = new Date().toISOString();
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { hashAction } from '../relay/protocol.mjs';
import { RelayOutbox } from '../relay/outbox.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RTCPeerConnection } from 'werift';
import { WebRtcReadHost, RTC_LABEL } from '../relay/webrtc-transport.mjs';
import { MacRelay } from '../relay/mac-relay.mjs';
import { generateE2eeKey, importE2eeKey, keyIdForKey, sealJson, openJson } from '../relay/e2ee.mjs';

function bounded(promise, ms = 15000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('test timeout')), ms); })])
    .finally(() => clearTimeout(timer));
}
async function fixture(t) {
  const key = await importE2eeKey(generateE2eeKey());
  const browser = { browserId: 'web_test', key, keyId: await keyIdForKey(key) };
  const relay = new MacRelay({ deviceId: 'dev_test', statePath: null, adapter: {} });
  relay.ready = true;
  relay.authorizationObservedAt = Date.now();
  relay.browserKeys.set(browser.browserId, browser);
  relay.activeBrowserKeys.set(browser.browserId, browser);
  let uploads = 0;
  const uploaded = [];
  relay.enqueueRemoteMessages = frames => { uploads++; uploaded.push(...frames); };
  relay.flushRemoteUploads = async () => {};
  const host = new WebRtcReadHost({ iceServers: [],
    authorized: (id, kid) => relay.ready && Date.now() - relay.authorizationObservedAt < 45000 && relay.activeBrowserKeys.get(id)?.keyId === kid,
    receive: (peer, frame) => relay.receiveDirectRead(peer, frame), onDrop: peer => relay.fallbackDirectEvents(peer) });
  relay.directHost = host;
  const pc = new RTCPeerConnection({ iceServers: [] });
  t.after(async () => { host.close(); await pc.close(); await Promise.allSettled([...relay.operations]); });
  const channel = pc.createDataChannel(RTC_LABEL);
  const opened = new Promise(resolve => channel.stateChanged.subscribe(state => { if (state === 'open') resolve(); }));
  await pc.setLocalDescription(await pc.createOffer());
  const sdp = await host.offer(browser, 'req_offer', pc.localDescription.sdp);
  await pc.setRemoteDescription({ type: 'answer', sdp });
  await bounded(opened);
  async function frame({ type = 'session.read_history', id = 'req_read', expires = Date.now() + 60000, payload = {limit: 100}, sessionId = 'ses_test' } = {}) {
    const aad = { direction: 'web_to_relay', type, device_id: 'dev_test', session_id: sessionId,
      request_id: id, event_seq: null, created_at: TRANSPORT_FIXTURE_TIME, expires_at: new Date(expires).toISOString() };
    return { device_id: 'dev_test', session_id: sessionId, request_id: id, command_type: type, aad,
      envelope: await sealJson(key, { type, device_id: 'dev_test', session_id: sessionId, request_id: id,
        issued_at: aad.created_at, expires_at: aad.expires_at, payload }, aad) };
  }
  return { relay, host, pc, channel, frame, browser, uploaded, uploads: () => uploads };
}

test('real WebRTC transfers chunked encrypted history without uploading response or ACK', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  const content = 'PRIVATE_CANARY_'.repeat(40000);
  f.relay.readAccessibleHistory = async () => ({ messages: [], has_more: false, next_cursor: null });
  f.relay.registerHistoryAttachments = () => [{ id: 'msg_test', content }];
  const chunks = [];
  const received = new Promise(resolve => f.channel.onMessage.subscribe(raw => {
    const chunk = JSON.parse(raw);
    assert.equal(chunk.index, chunks.length);
    chunks.push(chunk.data);
    if (chunks.length === chunk.total) resolve(JSON.parse(chunks.join('')));
  }));
  f.channel.send(JSON.stringify(await f.frame()));
  const response = await bounded(received);
  assert.ok(chunks.length > 20);
  assert.ok(!JSON.stringify(response).includes('PRIVATE_CANARY'));
  const clear = await openJson(f.browser.key, response.envelope, response.aad);
  assert.equal(clear.messages[0].content, content);
  assert.equal(clear.request_id, 'req_read');
  assert.equal(f.uploads(), 0);
});

test('direct ingress rejects route tampering and expired reads before adapter access', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  f.relay.readAccessibleHistory = () => assert.fail('must not read');
  const peer = f.host.peers.get('web_test');
  const wrong = await f.frame();
  wrong.aad.device_id = 'dev_other';
  await assert.rejects(f.relay.receiveDirectRead(peer, wrong), /invalid_route/);
  await assert.rejects(f.relay.receiveDirectRead(peer, await f.frame({ expires: Date.now() - 1 })), /invalid_request/);
  await assert.rejects(f.relay.receiveDirectRead(peer, await f.frame({ type: 'transport.offer' })), /invalid_route/);
});

test('revocation and stale server authorization close direct peers', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  f.relay.syncBrowserAuthorizations([]);
  assert.equal(f.host.peers.size, 0);
  assert.equal(f.uploads(), 0);
});

test('authorization lease cannot survive a lost control connection', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  f.relay.authorizationObservedAt = Date.now() - 45001;
  f.host.prune();
  assert.equal(f.host.peers.size, 0);
});

function receiver(channel) {
  const frames = [];
  const parts = new Map();
  channel.onMessage.subscribe(raw => {
    const chunk = JSON.parse(raw);
    const id = chunk.stream_id ?? chunk.request_id;
    const list = parts.get(id) ?? []; list.push(chunk.data); parts.set(id, list);
    if (list.length === chunk.total) { frames.push(JSON.parse(list.join(''))); parts.delete(id); }
  });
  return frames;
}
async function until(condition) { await bounded((async () => { while (!condition()) await delay(10); })()); }
async function sendLarge(channel, frame) {
  const wire = JSON.stringify(frame), total = Math.ceil(wire.length / 12000);
  for (let index = 0; index < total; index++) {
    channel.send(JSON.stringify({type: 'chunk', request_id: frame.request_id, index, total,
      length: wire.length, data: wire.slice(index * 12000, (index + 1) * 12000)}));
    while (channel.bufferedAmount > 256000) await delay(10);
  }
}

test('chunked direct mutations, encrypted receipts and HTTP retries execute only once, including after restart', {timeout: 25000}, async t => {
  const f = await fixture(t), received = receiver(f.channel);
  const directory = await mkdtemp(join(tmpdir(), 'relayune-rtc-receipts-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  f.relay.outbox = new RelayOutbox(join(directory, 'outbox.json'));
  let executions = 0;
  f.relay.adapter.interruptTurn = async () => { executions++; };
  const frame = await f.frame({type: 'session.interrupt_turn', id: 'req_mutation', payload: {padding: 'private-canary'.repeat(15000)}});
  await sendLarge(f.channel, frame);
  await until(() => executions === 1 && !f.relay.remoteCommandTasks.size);
  await until(() => received.some(frame => frame.kind === 'receipt'));
  const ack = received.find(frame => frame.kind === 'receipt');
  assert.equal((await openJson(f.browser.key, ack.envelope, ack.aad)).status, 'accepted');
  assert.equal(f.uploads(), 0);
  const command = await openJson(f.browser.key, frame.envelope, frame.aad);
  command.browser_id = f.browser.browserId;
  f.relay.dispatchRemoteCommand(command, f.browser, Date.now());
  await delay(30);
  assert.equal(executions, 1);
  assert.equal(f.uploaded.at(-1).status, 'duplicate');
  const restored = new RelayOutbox(f.relay.outbox.path); await restored.load(); f.relay.outbox = restored;
  f.relay.dispatchRemoteCommand(command, f.browser, Date.now());
  await delay(30);
  assert.equal(executions, 1);
  const count = f.uploads();
  f.relay.dispatchRemoteCommand({...command, payload: {different: true}}, f.browser, Date.now());
  assert.equal(f.uploads(), count, 'same ID with changed payload must be rejected');
});

test('events stay encrypted, require the exact recipient ACK, and fall back from the durable outbox', {timeout: 25000}, async t => {
  const f = await fixture(t), received = receiver(f.channel), peer = f.host.peers.get(f.browser.browserId);
  peer.eventsState = 'direct';
  const record = await f.relay.writeEvent('ses_test', {kind: 'message.delta', text: 'PRIVATE_EVENT'});
  await until(() => received.some(frame => frame.kind === 'event'));
  const event = received.find(frame => frame.kind === 'event');
  assert.ok(!JSON.stringify(event).includes('PRIVATE_EVENT'));
  assert.equal(f.uploads(), 0);
  assert.ok(f.relay.outbox.pending.has(record.event_seq));
  await f.relay.receiveDirectRead(peer, await f.frame({type: 'transport.event_ack', id: 'req_bad_ack',
    payload: {event_id: event.event_id, event_seq: event.event_seq + 1}}));
  assert.ok(f.relay.outbox.pending.has(record.event_seq));
  await f.relay.receiveDirectRead(peer, await f.frame({type: 'transport.event_ack', id: 'req_ack',
    payload: {event_id: event.event_id, event_seq: event.event_seq}}));
  assert.ok(!f.relay.outbox.pending.has(record.event_seq));
  const next = await f.relay.writeEvent('ses_test', {kind: 'message.delta', text: 'fallback'});
  await until(() => f.relay.directEvents.size === 1);
  f.host.drop(peer);
  assert.equal(f.relay.directEvents.size, 0);
  assert.ok(f.uploaded.some(frame => frame.event_seq === next.event_seq));
  assert.ok(f.relay.outbox.pending.has(next.event_seq), 'HTTP delivery must confirm the remaining copy');
});

test('approval decisions reach the existing validator and resolver once over WebRTC', {timeout: 25000}, async t => {
  const f = await fixture(t), peer = f.host.peers.get(f.browser.browserId);
  peer.eventsState = 'direct'; receiver(f.channel);
  let decisions = 0;
  f.relay.adapter.resolveApproval = async () => { decisions++; };
  const action = {command: 'fixture'}, commandHash = hashAction(action);
  const expires = new Date(Date.now() + 60000).toISOString();
  f.relay.pendingApprovals.set('approval_test', {approval_id: 'approval_test', session_id: 'ses_test', device_id: 'dev_test',
    expires_at: expires, action: {...action, command_hash: commandHash}});
  const frame = await f.frame({type: 'approval.resolve', id: 'req_approval', payload: {
    approval_id: 'approval_test', session_id: 'ses_test', device_id: 'dev_test', expires_at: expires,
    command_hash: commandHash, nonce: 'fixture_nonce_12345678', decision: 'approved'}});
  f.channel.send(JSON.stringify(frame));
  await until(() => decisions === 1 && !f.relay.remoteCommandTasks.size);
  const command = await openJson(f.browser.key, frame.envelope, frame.aad); command.browser_id = f.browser.browserId;
  f.relay.dispatchRemoteCommand(command, f.browser, Date.now());
  await delay(30); assert.equal(decisions, 1);
});

test('resume barrier buffers live events until HTTP catch-up activation', {timeout: 25000}, async t => {
  const f = await fixture(t), peer = f.host.peers.get(f.browser.browserId), received = receiver(f.channel);
  await f.relay.receiveDirectRead(peer, await f.frame({type: 'transport.resume', id: 'req_resume', sessionId: null}));
  assert.equal(peer.eventsState, 'preparing');
  await f.relay.writeEvent('ses_test', {kind: 'message.delta', text: 'buffered'});
  await Promise.all([...f.relay.operations]);
  assert.equal(received.filter(frame => frame.kind === 'event').length, 0);
  assert.equal(f.uploads(), 0);
  const buffered = [...f.relay.directEvents.values()].find(entry => entry.peer === peer);
  assert.equal(buffered.timer, null, 'unsent events must not start the ACK clock');
  await delay(10500);
  assert.equal(f.host.valid(peer), true, 'slow HTTP catch-up must not be mistaken for a missing event ACK');
  await f.relay.receiveDirectRead(peer, await f.frame({type: 'transport.activate', id: 'req_activate', sessionId: null}));
  assert.ok(buffered.timer, 'ACK deadline begins after the buffered event is sent');
  await until(() => received.some(frame => frame.kind === 'event'));
  assert.equal(peer.eventsState, 'direct');
});


test('revocation while persisting a mutation prevents adapter execution', {timeout: 25000}, async t => {
  const f = await fixture(t), peer = f.host.peers.get(f.browser.browserId);
  let entered;
  const persisting = new Promise(resolve => { entered = resolve; });
  let release;
  f.relay.outbox.persist = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  f.relay.adapter.interruptTurn = () => assert.fail('revoked command must not execute');
  const operation = f.relay.receiveDirectRead(peer, await f.frame({type: 'session.interrupt_turn', id: 'req_revoke_race'}));
  await persisting;
  f.relay.activeBrowserKeys.clear();
  release();
  await operation;
});


test('authenticated probes verify both directions, keep idle peers alive, and have reserved capacity', {timeout: 25000}, async t => {
  const f = await fixture(t), received = receiver(f.channel), peer = f.host.peers.get(f.browser.browserId);
  peer.pending = 4;
  for (let n = 0; n < 8; n++) f.relay.directRequests.set(`busy_${n}`, peer);
  peer.usedAt = Date.now() - 119000;
  const nonce = '1234567890abcdef1234567890abcdef';
  f.channel.send(JSON.stringify(await f.frame({type: 'transport.ping', id: 'probe_before', sessionId: null, payload: {nonce}})));
  await until(() => received.length === 1);
  const clear = await openJson(f.browser.key, received[0].envelope, received[0].aad);
  assert.equal(clear.nonce, nonce); assert.equal(clear.type, 'transport.pong'); assert.equal(clear.active, false);
  assert.ok(Date.now() - peer.usedAt < 1000);
  assert.equal(f.uploads(), 0);
  assert.equal(Object.keys(f.relay.outbox.transportRequests).length, 0);
  peer.eventsState = 'direct';
  f.channel.send(JSON.stringify(await f.frame({type: 'transport.ping', id: 'probe_active', sessionId: null, payload: {nonce}})));
  await until(() => received.length === 2);
  assert.equal((await openJson(f.browser.key, received[1].envelope, received[1].aad)).active, true);
  await assert.rejects(f.relay.receiveDirectRead(peer, await f.frame({type: 'transport.ping', id: 'probe_invalid', sessionId: null, payload: {nonce: 'bad'}})), /invalid_probe/);
});

 test('ACK arriving before send completion does not leave a stale deadline', async () => {
  const relay = new MacRelay({deviceId:'test',statePath:null,adapter:{}});
  const peer={eventsState:'direct'};
  relay.directHost={send:async(_,frame)=>relay.directEvents.delete(frame.event_id)};
  await relay.deliverDirectEvent(peer,{event_id:'ack_race'});
  assert.equal(relay.directEvents.size,0);
});


test('resume waits for an active HTTP upload and all queued event batches', {timeout: 25000}, async t => {
  const f = await fixture(t), peer = f.host.peers.get(f.browser.browserId);
  f.relay.flushRemoteUploads = MacRelay.prototype.flushRemoteUploads;
  f.relay.outbox.acknowledgeVariants = async () => {};
  const releases = [];
  f.relay.remoteFetch = async () => {
    await new Promise(resolve => releases.push(resolve));
    return new Response(JSON.stringify({ack_seq: 0}));
  };
  const entry = n => ({key: `old_${n}`, message: {kind: 'event', created_at: TRANSPORT_FIXTURE_TIME, browser_id: f.browser.browserId, event_seq: n}});
  f.relay.uploadBatchLimit = 1;
  f.relay.uploadQueue.push(entry(1), entry(2));
  f.relay.uploadKeys.add('old_1'); f.relay.uploadKeys.add('old_2');
  const uploading = f.relay.flushRemoteUploads();
  let result;
  const resume = f.relay.receiveDirectRead(peer, await f.frame({type: 'transport.resume', id: 'req_drain', sessionId: null}))
    .then(() => { result = 'ready'; }, error => { result = error.message; });
  try {
    await delay(40);
    assert.equal(result, undefined, 'must wait instead of rejecting a healthy in-flight upload');
    releases.shift()();
    await until(() => releases.length === 1);
    assert.equal(result, undefined, 'ready must not overtake the final HTTP batch');
    releases.shift()();
    await bounded(resume);
    assert.equal(result, 'ready');
    assert.equal(f.relay.uploadKeys.size, 0);
  } finally {
    f.host.drop(peer);
    f.relay.closed = true;
    for (const release of releases) release();
    await uploading;
    await resume;
  }
});

test('resume drain includes quarantined events and fails closed on permanent rejection', async () => {
  const relay = new MacRelay({deviceId: 'dev_test', statePath: null, adapter: {}});
  const peer = {browserId: 'web_test', eventsState: 'preparing'};
  relay.directHost = {valid: () => true};
  const entry = {key: 'isolated', message: {kind: 'event', created_at: TRANSPORT_FIXTURE_TIME, browser_id: peer.browserId}};
  relay.uploadIsolationBatches = [[entry]];
  relay.uploading = true;
  let result;
  const drain = relay.drainDirectUploads(peer).then(() => { result = 'ready'; }, e => { result = e.message; });
  await delay(40);
  assert.equal(result, undefined);
  relay.uploadIsolationBatches = [];
  relay.rejectedUploadKeys.add(entry.key);
  await drain;
  assert.equal(result, 'webrtc_resume_unavailable', 'a rejected event is not a delivered event');
});

test('resume drain stops on revocation without changing upload retry state', async () => {
  const relay = new MacRelay({deviceId: 'dev_test', statePath: null, adapter: {}});
  const peer = {browserId: 'web_test', eventsState: 'preparing'};
  let valid = true;
  relay.directHost = {valid: () => valid};
  relay.uploadRetryTimer = {pending: true};
  const retry = relay.uploadRetryTimer;
  const entry = {key: 'retry', message: {kind: 'event', created_at: TRANSPORT_FIXTURE_TIME, browser_id: peer.browserId}};
  relay.uploadQueue = [entry];
  relay.flushRemoteUploads = () => assert.fail('must respect upload backoff');
  const drain = relay.drainDirectUploads(peer);
  const rejection = assert.rejects(drain, /webrtc_resume_unavailable/);
  await delay(40);
  valid = false;
  await rejection;
  assert.equal(relay.uploadRetryTimer, retry);
  assert.deepEqual(relay.uploadQueue, [entry], 'fallback retains undelivered events');
});

test('resume drain does not wait for another recipient or non-event uploads', async () => {
  const relay = new MacRelay({deviceId: 'dev_test', statePath: null, adapter: {}});
  const peer = {browserId: 'web_test', eventsState: 'preparing'};
  relay.directHost = {valid: () => true};
  relay.uploading = true;
  relay.uploadingEntries = [{key: 'other', message: {kind: 'event', created_at: TRANSPORT_FIXTURE_TIME, browser_id: 'web_other'}}];
  relay.uploadQueue = [{key: 'catalog', message: {kind: 'catalog', browser_id: peer.browserId}}];
  await bounded(relay.drainDirectUploads(peer), 1000);
  assert.equal(relay.uploadingEntries.length, 1);
  assert.equal(relay.uploadQueue.length, 1);
});

test('resume drain has a deadline and retains events for HTTP fallback', async t => {
  t.mock.timers.enable({apis: ['Date'], now: Date.now()});
  const relay = new MacRelay({deviceId: 'dev_test', statePath: null, adapter: {}});
  const peer = {browserId: 'web_test', eventsState: 'preparing'};
  relay.directHost = {valid: () => true};
  relay.uploading = true;
  const entry = {key: 'slow', message: {kind: 'event', created_at: TRANSPORT_FIXTURE_TIME, browser_id: peer.browserId}};
  relay.uploadingEntries = [entry];
  const rejection = assert.rejects(relay.drainDirectUploads(peer), /webrtc_resume_unavailable/);
  t.mock.timers.tick(15001);
  await rejection;
  assert.deepEqual(relay.uploadingEntries, [entry]);
});

test('trickle exchanges authenticated connection-scoped candidates and opens a real channel', { timeout: 15000 }, async t => {
  const browser = { browserId: 'trickle_browser', keyId: 'key' };
  const host = new WebRtcReadHost({ iceServers: [], authorized: () => true, receive: () => {} });
  const pc = new RTCPeerConnection({ iceServers: [] });
  t.after(async () => { host.close(); await pc.close(); });
  const local = [];
  pc.onIceCandidate.subscribe(c => { if (c) local.push(c.toJSON()); });
  const channel = pc.createDataChannel(RTC_LABEL);
  const opened = new Promise(resolve => channel.stateChanged.subscribe(s => { if (s === 'open') resolve(); }));
  const setting = pc.setLocalDescription(await pc.createOffer());
  while (!pc.localDescription) await delay(1);
  const offer = pc.localDescription.sdp.replace(/^a=candidate:.*\r?\n/gm, '').replace(/^a=end-of-candidates\r?\n/gm, '');
  const answer = await host.offer(browser, 'trickle_connection', offer, true);
  await pc.setRemoteDescription({ type: 'answer', sdp: answer });
  await setting;
  await assert.rejects(host.exchangeCandidates(browser, 'stale_connection', [], 0), /invalid/);
  await assert.rejects(host.exchangeCandidates({ ...browser, keyId: 'other' }, 'trickle_connection', [], 0), /invalid/);
  await assert.rejects(host.exchangeCandidates(browser, 'trickle_connection', [{ candidate: 'invalid' }], 0), /invalid/);
  let cursor = 0;
  for (let i = 0; i < 50 && channel.readyState !== 'open'; i++) {
    const response = await host.exchangeCandidates(browser, 'trickle_connection', local, cursor);
    for (const c of response.candidates) await pc.addIceCandidate(c);
    cursor = response.cursor;
    await delay(20);
  }
  await bounded(opened, 3000);
  assert.equal(channel.readyState, 'open');
  assert.equal(host.peers.get(browser.browserId).remoteCandidates.size, local.length);
});
