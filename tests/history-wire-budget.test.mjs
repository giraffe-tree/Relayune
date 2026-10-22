import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {MacRelay} from '../relay/mac-relay.mjs';
import {generateE2eeKey, importE2eeKey, keyIdForKey, openJson} from '../relay/e2ee.mjs';
import {encryptedHistoryWireBytes, utf8Preview} from '../relay/history-wire-budget.mjs';

async function fixture(messages, metadata = {}) {
  const key = await importE2eeKey(generateE2eeKey());
  const browser = {browserId: 'browser_unicode_测', key, keyId: await keyIdForKey(key)};
  const reads = [];
  const relay = new MacRelay({deviceId: 'desktop_测', statePath: null, adapter: {
    readHistory: async options => {
      reads.push(options);
      const end = options.before ? messages.findIndex(message => message.id === options.before) : messages.length;
      const start = Math.max(0, end - options.limit);
      return {messages: messages.slice(start, end), has_more: start > 0,
        next_cursor: start > 0 ? messages[start].id : null, ...metadata};
    },
  }});
  relay.activeBrowserKeys.set(browser.browserId, browser);
  relay.validateCommand = () => true;
  relay.acknowledgeCommand = () => {};
  const sent = [];
  relay.send = message => {sent.push(message); return true;};
  const command = (payload = {}, id = 'request_unicode_测') => {
    relay.requestBrowsers.set(id, browser.browserId);
    return {type: 'session.read_history', device_id: relay.deviceId,
      session_id: 'session_unicode_测', request_id: id, payload};
  };
  return {relay, browser, sent, command, reads};
}

test('history budget includes exact encrypted frame, Unicode metadata and HTTPS wrapper', async () => {
  const original = {id: 'message_测', role: 'codex', content: '你好🌱'.repeat(45_000),
    tool_details: {stdout: '完整工具记录'.repeat(30_000)}};
  const f = await fixture([original], {agents: [{id: 'child', summary: '完整子任务'.repeat(30_000)}]});
  await f.relay.readHistory(f.command({max_bytes: 16 * 1024}));
  const response = f.sent.at(-1);
  assert.equal(response.type, 'session.history');
  const [frame] = await f.relay.encodeRemoteMessage(response);
  const wireBytes = Buffer.byteLength(JSON.stringify({device_id: f.relay.deviceId, messages: [frame]}));
  assert.ok(wireBytes <= 16 * 1024, `${wireBytes} bytes exceeded the budget`);
  assert.equal(encryptedHistoryWireBytes(response, {deviceId: f.relay.deviceId,
    browserId: f.browser.browserId, aad: frame.aad}), wireBytes);
  const clear = await openJson(f.browser.key, frame.envelope, frame.aad);
  assert.equal(clear.messages[0].id, original.id);
  assert.equal(clear.messages[0].content_truncated, true);
  assert.ok(clear.messages[0].content_attachment);
  assert.ok(clear.messages[0].detail_attachment);
  assert.ok(clear.metadata_attachment);
  assert.ok(clear.messages[0].attachments.some(item => item.id === clear.metadata_attachment.id));
  assert.ok(!JSON.stringify(frame).includes('完整工具记录'));
});

test('bounded pages retain native cursors and every oversized message full content remains retrievable', async () => {
  const messages = Array.from({length: 30}, (_, index) => ({id: `m_${index}`, role: 'codex',
    content: `${index}你好🌱`.repeat(1800)}));
  const f = await fixture(messages);
  const collected = [];
  let before = null;
  do {
    await f.relay.readHistory(f.command({before, max_bytes: 16 * 1024}, `page_${collected.length}`));
    const response = f.sent.at(-1);
    assert.equal(response.type, 'session.history');
    const [frame] = await f.relay.encodeRemoteMessage(response);
    assert.ok(Buffer.byteLength(JSON.stringify({device_id: f.relay.deviceId, messages: [frame]})) <= 16 * 1024);
    for (const message of response.messages) {
      const original = messages.find(item => item.id === message.id);
      const attachment = f.relay.attachments.get(message.content_attachment.id);
      assert.equal(attachment.source.bytes.toString(), original.content);
    }
    collected.unshift(...response.messages);
    before = response.next_cursor;
    assert.equal(response.has_more, Boolean(before));
  } while (before);
  assert.deepEqual(collected.map(message => message.id), messages.map(message => message.id));
  assert.ok(f.reads.some(options => options.limit < 100), 'overflow must request a native smaller page');
});

test('explicit 500 crosses the Relay command boundary while defaults and encrypted byte limits remain bounded', async () => {
  const messages = Array.from({length: 1123}, (_, index) => ({id: `m_${index}`, role: 'codex', content: `消息 ${index}`}));
  const f = await fixture(messages);
  await f.relay.readHistory(f.command());
  assert.equal(f.sent.at(-1).messages.length, 100);
  await f.relay.readHistory(f.command({limit: 9999}));
  assert.equal(f.sent.at(-1).messages.length, 500);
  const collected = [];
  let before = null;
  do {
    await f.relay.readHistory(f.command({limit: 500, before, max_bytes: 1024 * 1024}));
    const response = f.sent.at(-1);
    assert.equal(response.type, 'session.history');
    assert.equal(response.messages.length, collected.length < 1000 ? 500 : 123);
    const [frame] = await f.relay.encodeRemoteMessage(response);
    assert.ok(Buffer.byteLength(JSON.stringify({device_id: f.relay.deviceId, messages: [frame]})) <= 1024 * 1024);
    collected.unshift(...response.messages);
    before = response.next_cursor;
    assert.equal(response.has_more, Boolean(before));
  } while (before);
  assert.deepEqual(collected.map(message => message.id), messages.map(message => message.id));

  // The count is an upper bound: smaller wire budgets shrink pages without
  // discarding the boundary needed to recover the remaining messages.
  await f.relay.readHistory(f.command({limit: 500, max_bytes: 16 * 1024}));
  const response = f.sent.at(-1);
  assert.ok(response.messages.length < 500);
  assert.equal(response.has_more, true);
  assert.ok(response.next_cursor);
  const [frame] = await f.relay.encodeRemoteMessage(response);
  assert.ok(Buffer.byteLength(JSON.stringify({device_id: f.relay.deviceId, messages: [frame]})) <= 16 * 1024);
});

test('range reads reconstruct a multi MiB UTF-8 document with stable digest and one materialization', async () => {
  const f = await fixture([]);
  const bytes = Buffer.from('跨分片🌱\n'.repeat(200_000));
  const attachment = f.relay.registerHistoryDocument('session_unicode_测', bytes, '完整消息.txt', 'text/plain');
  let offset = 0;
  const parts = [];
  const digest = createHash('sha256').update(bytes).digest('hex');
  do {
    const request = f.command({attachment_id: attachment.id, offset, max_bytes: 128 * 1024});
    await f.relay.readAttachment(request);
    const part = f.sent.at(-1);
    assert.equal(part.type, 'session.attachment');
    assert.equal(part.attachment_id, attachment.id);
    assert.equal(part.offset, offset);
    assert.equal(part.total_size, bytes.length);
    assert.equal(part.content_digest, digest);
    assert.equal(part.mime_type, 'text/plain');
    const decoded = Buffer.from(part.base64, 'base64');
    assert.equal(decoded.length, part.size);
    assert.ok(part.size <= 128 * 1024);
    assert.equal(part.next_offset, offset + decoded.length);
    parts.push(decoded); offset = part.next_offset;
    if (!part.has_more) break;
    // After the first materialization the source itself is no longer needed.
    f.relay.attachments.get(attachment.id).source.bytes = Buffer.from('changed source');
  } while (offset < bytes.length);
  assert.deepEqual(Buffer.concat(parts), bytes);
  assert.equal(f.relay.attachmentBodies.size, 1);
  assert.equal(f.relay.attachmentBodyBytes, bytes.length);
});

test('attachment range rejects invalid offsets/sizes without reading and old requests retain whole-body shape', async () => {
  const f = await fixture([]);
  const attachment = f.relay.registerHistoryDocument('session_unicode_测', Buffer.from('完整正文'), '完整消息.txt', 'text/plain');
  for (const payload of [{offset: -1, max_bytes: 10}, {offset: 0.5, max_bytes: 10},
    {offset: 0, max_bytes: 0}, {offset: 0, max_bytes: 192 * 1024 + 1}]) {
    await f.relay.readAttachment(f.command({attachment_id: attachment.id, ...payload}));
    assert.equal(f.sent.at(-1).error_code, 'attachment_range_invalid');
  }
  assert.equal(f.relay.attachmentBodies.size, 0);
  await f.relay.readAttachment(f.command({attachment_id: attachment.id}));
  assert.equal(f.sent.at(-1).type, 'session.attachment');
  assert.equal(Buffer.from(f.sent.at(-1).base64, 'base64').toString(), '完整正文');
  assert.equal(f.sent.at(-1).has_more, undefined);
});

test('UTF-8 previews never split an emoji or produce a replacement character', () => {
  for (let size = 0; size < 20; size++) {
    const preview = utf8Preview('你好🌱你好🌱', size);
    assert.ok(Buffer.byteLength(preview) <= size);
    assert.ok(!preview.includes('�'));
    assert.ok('你好🌱你好🌱'.startsWith(preview));
  }
});
