import assert from 'node:assert/strict';
import test from 'node:test';
import {MacRelay} from '../relay/mac-relay.mjs';
import {WebRtcReadHost} from '../relay/webrtc-transport.mjs';

const createdAt = new Date().toISOString();
const bulk = id => ({kind: 'response', browser_id: 'b', request_id: id,
  aad: {type: 'session.attachment', created_at: createdAt}, envelope: {ciphertext: 'x'.repeat(200_000)}});
const event = seq => ({kind: 'event', browser_id: 'b', session_id: 's', event_id: `e${seq}`,
  event_seq: seq, created_at: createdAt, envelope: {ciphertext: 'encrypted event'}});

test('a stalled bulk upload cannot block acceptance, stop, approvals or ordered live output', async () => {
  const relay = new MacRelay({serverUrl: 'https://relay.test', statePath: null, adapter: {}});
  let release;
  const gate = new Promise(resolve => {release = resolve;});
  const uploads = [];
  relay.remoteFetch = async (_, options) => {
    const messages = JSON.parse(options.body).messages;
    uploads.push(messages);
    if (messages.some(message => message.request_id === 'large_attachment')) await gate;
    return Response.json({ack_seq: 0});
  };
  await relay.outbox.append({type: 'opaque.event.bundle', event_seq: 1, variants: [event(1)]});
  await relay.outbox.append({type: 'opaque.event.bundle', event_seq: 2, variants: [event(2)]});
  relay.enqueueRemoteMessages([bulk('large_attachment'), event(1), event(2)], {live: true});
  await relay.flushRemoteUploads();
  assert.equal(relay.bulkUploading, true);
  assert.equal(relay.uploading, false);
  for (const id of ['accepted', 'stop', 'approval']) {
    relay.enqueueRemoteMessages([{kind: 'command_ack', request_id: id, status: 'accepted'}]);
    await relay.flushRemoteUploads();
  }
  assert.deepEqual(uploads.flat().filter(message => message.kind === 'command_ack').map(message => message.request_id),
    ['accepted', 'stop', 'approval']);
  assert.deepEqual(uploads.flat().filter(message => message.kind === 'event').map(message => message.event_seq), [1, 2]);
  assert.equal(relay.outbox.pending.size, 0);
  assert.ok(uploads.every(messages => !messages.some(message => message.kind === 'event') ||
    !messages.some(message => message.aad?.type === 'session.attachment')));
  release(); await Promise.all([...relay.operations]);
  assert.equal(relay.uploadKeys.size, 0);
});

test('bulk replies progress under sustained interactive traffic with one bulk request at a time', async () => {
  const relay = new MacRelay({serverUrl: 'https://relay.test', statePath: null, adapter: {}});
  relay.ready = true;
  let inFlight = 0;
  let peak = 0;
  const delivered = [];
  relay.remoteFetch = async (_, options) => {
    const messages = JSON.parse(options.body).messages;
    if (messages[0]?.aad?.type === 'session.attachment') {inFlight++; peak = Math.max(peak, inFlight);}
    await new Promise(resolve => setImmediate(resolve));
    delivered.push(...messages);
    if (messages[0]?.aad?.type === 'session.attachment') inFlight--;
    return Response.json({ack_seq: 0});
  };
  relay.enqueueRemoteMessages([bulk('a'), bulk('b'), bulk('c'), ...Array.from({length: 40}, (_, i) =>
    ({kind: 'command_ack', request_id: `interactive_${i}`, status: 'accepted'}))]);
  await relay.flushRemoteUploads();
  while (relay.operations.size || relay.uploading) await new Promise(resolve => setImmediate(resolve));
  assert.equal(peak, 1);
  assert.deepEqual(delivered.filter(message => message.kind === 'response').map(message => message.request_id), ['a', 'b', 'c']);
  assert.equal(delivered.filter(message => message.kind === 'command_ack').length, 40);
  assert.equal(relay.uploadQueue.length, 0);
});

test('a transient bulk failure preserves exact ciphertext/request ID and does not delay new controls', async () => {
  const relay = new MacRelay({serverUrl: 'https://relay.test', statePath: null, adapter: {}});
  const original = bulk('same_request');
  let fail = true;
  const uploads = [];
  relay.remoteFetch = async (_, options) => {
    const messages = JSON.parse(options.body).messages;
    uploads.push(messages);
    if (fail && messages[0]?.request_id === original.request_id) return Response.json({}, {status: 503});
    return Response.json({ack_seq: 0});
  };
  relay.enqueueRemoteMessages([original]); await relay.flushRemoteUploads();
  await Promise.all([...relay.operations]);
  assert.deepEqual(relay.uploadQueue[0].message, original);
  relay.enqueueRemoteMessages([{kind: 'command_ack', request_id: 'new_control', status: 'accepted'}]);
  await relay.flushRemoteUploads();
  assert.equal(uploads.at(-1)[0].request_id, 'new_control');
  clearTimeout(relay.bulkUploadRetryTimer); relay.bulkUploadRetryTimer = null; fail = false;
  await relay.flushRemoteUploads(); await Promise.all([...relay.operations]);
  assert.deepEqual(uploads.at(-1), [original]);
  assert.equal(relay.uploadKeys.size, 0);
});

test('WebRTC prioritizes controls at frame boundaries, preserves event order and cannot starve bulk', async t => {
  const host = new WebRtcReadHost({authorized: () => true, receive: () => {}});
  t.after(() => host.close());
  host.valid = () => true;
  const chunks = [];
  const peer = {channel: {bufferedAmount: 0, readyState: 'open', send: wire => chunks.push(JSON.parse(wire))}};
  const operations = [host.send(peer, bulk('history_first')), host.send(peer, bulk('history_second'))];
  for (let index = 0; index < 20; index++) operations.push(host.send(peer, {
    kind: index % 2 ? 'receipt' : 'event', request_id: `control_${index}`, event_id: `e_${index}`,
    aad: {type: index % 2 ? 'command.ack' : 'session.event'}, envelope: {ciphertext: 'encrypted'},
  }));
  await Promise.all(operations);
  const frames = chunks.filter(chunk => chunk.index === 0).map(chunk => chunk.request_id);
  assert.deepEqual(frames.slice(0, 8), Array.from({length: 8}, (_, index) => `control_${index}`));
  assert.equal(frames[8], 'history_first');
  assert.equal(frames[17], 'history_second');
  assert.deepEqual(frames.filter(id => id.startsWith('control_')), Array.from({length: 20}, (_, index) => `control_${index}`));
  let expected = 0;
  let active;
  for (const chunk of chunks) {
    if (!expected) active = chunk.request_id;
    assert.equal(chunk.request_id, active, 'one frame assembly must remain contiguous');
    assert.equal(chunk.index, expected);
    expected = chunk.index + 1 === chunk.total ? 0 : expected + 1;
  }
  assert.equal(expected, 0);
  assert.equal(peer.sendQueue.length, 0);
  assert.equal(peer.sendQueuedBytes, 0);
});

test('WebRTC completion callbacks can enqueue another reply without stranding it', async t => {
  const host = new WebRtcReadHost({authorized: () => true, receive: () => {}});
  t.after(() => host.close());
  host.valid = () => true;
  const sent = [];
  const peer = {channel: {bufferedAmount: 0, readyState: 'open', send: wire => sent.push(JSON.parse(wire).request_id)}};
  await host.send(peer, {kind: 'receipt', request_id: 'first'}).then(() =>
    host.send(peer, {kind: 'receipt', request_id: 'second'}));
  assert.deepEqual(sent, ['first', 'second']);
});

test('WebRTC full bulk admission preserves eight control slots and rejects every queued promise on drop', async t => {
  const host = new WebRtcReadHost({authorized: () => true, receive: () => {}});
  t.after(() => host.close());
  host.valid = () => true;
  const peer = {sendRunning: true, pc: {close: async () => {}}, sendQueue: []};
  const pending = [];
  // Keep the drain held so admission is tested independently of dequeueing.
  for (let index = 0; index < 56; index++) pending.push(host.send(peer, {
    kind: 'response', request_id: `bulk_${index}`, aad: {type: 'session.attachment'},
  }));
  await assert.rejects(host.send(peer, {kind: 'response', aad: {type: 'session.history'}}), /webrtc_too_large/);
  for (let index = 0; index < 8; index++) pending.push(host.send(peer, {kind: 'receipt', request_id: `control_${index}`}));
  assert.equal(peer.sendQueue.length, 64);
  assert.equal(peer.sendQueue.filter(entry => !entry.bulk).length, 8);
  await assert.rejects(host.send(peer, {kind: 'receipt', request_id: 'overflow'}), /webrtc_too_large/);
  const settled = Promise.allSettled(pending);
  host.drop(peer);
  const results = await settled;
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.message === 'webrtc_closed'));
  assert.equal(peer.sendQueue.length, 0);
  assert.equal(peer.sendQueuedBytes, 0);
});

test('WebRTC byte admission leaves one MiB for control even while a bulk frame is in flight', async t => {
  const host = new WebRtcReadHost({authorized: () => true, receive: () => {}});
  t.after(() => host.close());
  host.valid = () => true;
  const peer = {sendRunning: true, sendQueue: [], sendQueuedBytes: 31 * 1024 * 1024,
    sendActiveEntry: {bulk: true, wire: {length: 32 * 1024 * 1024}, reject: () => {}},
    pc: {close: async () => {}}};
  await assert.rejects(host.send(peer, {kind: 'response', aad: {type: 'session.attachment'}}), /webrtc_too_large/);
  const control = host.send(peer, {kind: 'receipt', request_id: 'accepted'});
  const rejected = assert.rejects(control, /webrtc_closed/);
  assert.equal(peer.sendQueue[0].frame.request_id, 'accepted');
  host.drop(peer); await rejected;
});
