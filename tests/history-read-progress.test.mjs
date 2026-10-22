import assert from 'node:assert/strict';
import test from 'node:test';
import { MacRelay } from '../relay/mac-relay.mjs';
import { generateE2eeKey, importE2eeKey, keyIdForKey, openJson } from '../relay/e2ee.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

async function fixture(readHistory = async () => ({ messages: [], has_more: false, next_cursor: null })) {
  const browsers = await Promise.all(['first', 'requester'].map(async browserId => {
    const key = await importE2eeKey(generateE2eeKey());
    return { browserId, key, keyId: await keyIdForKey(key) };
  }));
  const relay = new MacRelay({ deviceId: 'fixture-desktop', statePath: null,
    adapter: { readHistory, async close() {} } });
  for (const browser of browsers) relay.activeBrowserKeys.set(browser.browserId, browser);
  const frames = [], sends = [];
  relay.send = message => {
    sends.push(relay.encodeRemoteMessage(message).then(encoded => frames.push(...encoded)));
    return true;
  };
  const command = (payload = {}, requestId = 'history-request') => {
    relay.requestBrowsers.set(requestId, 'requester');
    return { type: 'session.read_history', session_id: 'fixture-session', device_id: relay.deviceId,
      request_id: requestId, expires_at: new Date(Date.now() + 60_000).toISOString(), payload };
  };
  const drain = async () => {
    await relay.outbox.appendChain;
    await Promise.all([...relay.operations]);
    await Promise.all(sends);
  };
  const progress = async () => {
    await drain();
    return Promise.all(frames.filter(frame => frame.kind === 'event').map(async frame => ({
      frame, clear: await openJson(browsers[1].key, frame.envelope, frame.aad),
    })));
  };
  return { relay, browsers, frames, command, drain, progress };
}

test('history progress is encrypted only for its requester and never resolves or consumes the response route', async () => {
  const entered = deferred(), reading = deferred();
  const f = await fixture(async () => { entered.resolve(); await reading.promise;
    return { messages: [{ id: 'fixture-message', role: 'codex', content: 'fixture answer' }], has_more: false }; });
  const operation = f.relay.readHistory(f.command({ include_progress: true }));
  await entered.promise;
  const initial = await f.progress();
  assert.deepEqual(initial.map(value => value.clear.event.stage), ['queued', 'reading']);
  assert.ok(initial.every(value => value.frame.browser_id === 'requester'));
  assert.equal(f.frames.filter(frame => frame.kind === 'response').length, 0);
  assert.equal(f.relay.requestBrowsers.get('history-request'), 'requester');
  for (const { frame, clear } of initial) {
    assert.equal(frame.aad.type, 'session.event');
    assert.equal(frame.aad.request_id, 'history-request');
    assert.equal(clear.request_id, 'history-request');
    assert.equal(clear.event.request_id, 'history-request');
    assert.equal(clear.event.kind, 'history.read_progress');
    assert.equal(clear.session_id, 'fixture-session');
    assert.ok(!JSON.stringify(frame).includes('history.read_progress'));
    assert.ok(!JSON.stringify(frame).includes('"stage"'));
    assert.equal(frame.ios_push, undefined);
    assert.equal(frame.notification_hint, undefined);
    await assert.rejects(openJson(f.browsers[0].key, frame.envelope, frame.aad));
  }
  reading.resolve(); await operation;
  const complete = await f.progress();
  assert.deepEqual(complete.map(value => value.clear.event.stage), ['queued', 'reading', 'preparing', 'sending']);
  assert.equal(new Set(complete.map(value => value.frame.event_id)).size, 4);
  const responses = f.frames.filter(frame => frame.kind === 'response');
  assert.equal(responses.length, 1);
  assert.equal(responses[0].aad.type, 'session.history');
  assert.equal(f.relay.requestBrowsers.has('history-request'), false);
  assert.equal((await openJson(f.browsers[1].key, responses[0].envelope, responses[0].aad)).messages.length, 1);
});

test('legacy requests and unmapped history progress leave sibling clients and normal events untouched', async () => {
  const f = await fixture();
  await f.relay.readHistory(f.command()); await f.drain();
  assert.equal(f.frames.filter(frame => frame.kind === 'event').length, 0);
  assert.equal(f.relay.outbox.nextSeq, 1);
  const unmapped = f.command({ include_progress: true }, 'unmapped');
  f.relay.requestBrowsers.delete(unmapped.request_id);
  await f.relay.readHistory(unmapped); await f.drain();
  assert.equal(f.frames.filter(frame => frame.kind === 'event').length, 0);
  assert.equal(f.relay.outbox.nextSeq, 1);
  assert.equal(await f.relay.writeEvent('fixture-session', { kind: 'history.read_progress', stage: 'reading' }), null);
  assert.equal(await f.relay.writeEvent('fixture-session', { kind: 'history.read_progress', request_id: 'fixture', stage: 'done' },
    { request_id: 'fixture', recipient: f.browsers[1] }), null);
  await f.relay.writeEvent('fixture-session', { kind: 'message.completed', item_id: 'fixture', text: 'ordinary event' });
  await f.drain();
  assert.deepEqual(f.frames.filter(frame => frame.kind === 'event').map(frame => frame.browser_id).sort(), ['first', 'requester']);
});

test('byte hints are bounded, encrypted and report the final compact frame rather than source bytes', async () => {
  let late;
  const f = await fixture(async ({onProgress}) => {
    late = onProgress;
    onProgress({source_read_bytes: 0, source_total_bytes: 212000000, private_field: 'fixture private'});
    for (let read = 1; read <= 1000; read++) onProgress({source_read_bytes: read * 212000, source_total_bytes: 212000000});
    onProgress({source_read_bytes: 5, source_total_bytes: 4});
    onProgress({source_read_bytes: 2.5, source_total_bytes: 10});
    return {messages: [{id: 'unicode', role: 'codex', content: '你好🌱'}], has_more: false};
  });
  await f.relay.readHistory(f.command({include_progress: true}));
  const hints = await f.progress();
  assert.ok(hints.length <= 6, 'chunk callbacks must not each become a network event');
  const preparing = hints.find(value => value.clear.event.stage === 'preparing').clear.event;
  assert.equal(preparing.source_read_bytes, 212000000);
  assert.equal(preparing.source_total_bytes, 212000000);
  assert.equal(preparing.private_field, undefined);
  const sending = hints.at(-1).clear.event;
  const response = f.frames.find(frame => frame.kind === 'response');
  assert.equal(sending.transfer_bytes, Buffer.byteLength(JSON.stringify(response)));
  assert.ok(sending.transfer_bytes < 4096);
  assert.ok(hints.every(({frame}) => !JSON.stringify(frame).includes('source_read_bytes')));
  late({source_read_bytes: 999, source_total_bytes: 999});
  assert.equal((await f.progress()).length, hints.length, 'completed source callbacks cannot revive progress');
});

test('revocation during a read prevents later progress and never redirects it to a sibling', async () => {
  const entered = deferred(), reading = deferred();
  const f = await fixture(async () => { entered.resolve(); await reading.promise; return { messages: [] }; });
  const operation = f.relay.readHistory(f.command({ include_progress: true }));
  await entered.promise;
  assert.equal((await f.progress()).length, 2);
  f.relay.activeBrowserKeys.delete('requester');
  reading.resolve(); await operation; await f.drain();
  assert.equal(f.frames.filter(frame => frame.kind === 'event').length, 2);
  assert.ok(f.frames.filter(frame => frame.kind === 'event').every(frame => frame.browser_id === 'requester'));
});

test('history progress retains its original recipient even if the response route changes during a read', async () => {
  const entered = deferred(), reading = deferred();
  const f = await fixture(async () => { entered.resolve(); await reading.promise; return { messages: [] }; });
  const operation = f.relay.readHistory(f.command({ include_progress: true }));
  await entered.promise; await f.progress();
  f.relay.requestBrowsers.set('history-request', 'first');
  reading.resolve(); await operation;
  const events = await f.progress();
  assert.equal(events.length, 4);
  assert.ok(events.every(value => value.frame.browser_id === 'requester'));
});

test('rotation while an encrypted progress event waits for persistence drops the old key variant', async () => {
  const persisting = deferred(), persisted = deferred(), reading = deferred();
  const f = await fixture(async () => { await reading.promise; return { messages: [] }; });
  f.relay.outbox.persist = async () => { persisting.resolve(); await persisted.promise; };
  const operation = f.relay.readHistory(f.command({ include_progress: true }));
  await persisting.promise;
  const key = await importE2eeKey(generateE2eeKey());
  f.relay.activeBrowserKeys.set('requester', { browserId: 'requester', key, keyId: await keyIdForKey(key) });
  persisted.resolve(); reading.resolve();
  await operation; await f.drain();
  assert.equal(f.frames.filter(frame => frame.kind === 'event').length, 0);
});

test('history failures stop at reading and optional progress persistence failures cannot fail the history response', async () => {
  const failed = await fixture(async () => { throw new Error('private provider diagnostic'); });
  await failed.relay.readHistory(failed.command({ include_progress: true }));
  const events = await failed.progress();
  assert.deepEqual(events.map(value => value.clear.event.stage), ['queued', 'reading']);
  const response = failed.frames.find(frame => frame.kind === 'response');
  assert.equal((await openJson(failed.browsers[1].key, response.envelope, response.aad)).type, 'session.history_error');
  const healthy = await fixture();
  healthy.relay.outbox.appendWithSequence = async () => { throw new Error('progress persistence failed'); };
  await healthy.relay.readHistory(healthy.command({ include_progress: true })); await healthy.drain();
  assert.equal(healthy.frames.filter(frame => frame.kind === 'event').length, 0);
  assert.equal(healthy.frames.filter(frame => frame.kind === 'response').length, 1);
});

test('wire budget retries report actual reads without monotonic fake progress and retain the final response budget', async () => {
  let reads = 0;
  const messages = Array.from({ length: 600 }, (_, index) => ({ id: `fixture-${index}`, role: 'codex', content: '汉字'.repeat(100) }));
  const f = await fixture(async options => { reads++;
    return { messages: messages.slice(-options.limit), has_more: true, next_cursor: `fixture-${600 - options.limit}` }; });
  await f.relay.readHistory(f.command({ include_progress: true, limit: 500, max_bytes: 16 * 1024 }));
  const events = await f.progress(), stages = events.map(value => value.clear.event.stage);
  assert.ok(reads > 1);
  assert.equal(stages.filter(stage => stage === 'reading').length, reads);
  assert.equal(stages.filter(stage => stage === 'preparing').length, reads);
  assert.equal(stages[0], 'queued');
  assert.equal(stages.at(-1), 'sending');
  assert.ok(stages.some((stage, index) => stage === 'preparing' && stages[index + 1] === 'reading'));
  const [response] = f.frames.filter(frame => frame.kind === 'response');
  assert.ok(Buffer.byteLength(JSON.stringify({ device_id: f.relay.deviceId, messages: [response] })) <= 16 * 1024);
});
