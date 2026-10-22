import test from 'node:test';
import assert from 'node:assert/strict';
import { MacRelay } from '../relay/mac-relay.mjs';
import { generateE2eeKey, keyIdForKey } from '../relay/e2ee.mjs';
import { handleLocalControl } from '../relay/local-control.mjs';

test('additional browser enrollment preserves running tasks and remains gated by server authorization', async () => {
  let starts = 0, closes = 0;
  const first = `web_${'1'.repeat(32)}`, second = `web_${'2'.repeat(32)}`;
  const oldKey = generateE2eeKey(), newKey = generateE2eeKey();
  const relay = new MacRelay({ serverUrl: 'https://relay.test', deviceId: 'dev_test',
    deviceToken: 'test-token', browserKeys: [{ browserId: first, e2eeKey: oldKey }],
    adapter: { async start() { starts++; }, async close() { closes++; } }, statePath: null });
  relay.connect = async () => {};
  await relay.start();
  const oldAuthorization = { id: first, key_id: await keyIdForKey(oldKey) };
  relay.syncBrowserAuthorizations([oldAuthorization]);
  const pending = { approval_id: 'apr_test', session_id: 'session_test', resolving: false };
  relay.pendingApprovals.set(pending.approval_id, pending);
  const output = [];
  await handleLocalControl(relay, JSON.stringify({ type: 'relayune:browser_key',
    request_id: '1-1', browser_id: second, key: newKey }), line => output.push(line));
  assert.deepEqual(output, ['relayune:browser_key:1-1:ok\n']);
  assert.equal(relay.activeBrowserKeys.has(second), false);
  assert.equal(relay.pendingApprovals.get(pending.approval_id), pending);
  assert.equal(starts, 1); assert.equal(closes, 0);
  relay.syncBrowserAuthorizations([oldAuthorization, { id: second, key_id: await keyIdForKey(newKey) }]);
  assert.equal(relay.activeBrowserKeys.size, 2);
  assert.notEqual(relay.activeBrowserKeys.get(first).keyId, relay.activeBrowserKeys.get(second).keyId);
  await assert.rejects(relay.updateBrowserKey(first, newKey));
  assert.equal(relay.browserKeys.get(first).keyId, oldAuthorization.key_id);
  await relay.updateBrowserKey(second, null);
  assert.equal(relay.browserKeys.has(second), false);
  assert.equal(relay.activeBrowserKeys.has(second), false);
  assert.equal(relay.activeBrowserKeys.has(first), true);
  assert.equal(relay.pendingApprovals.get(pending.approval_id), pending);
  await relay.stop();
});

test('control errors never echo keys and reject malformed or oversized commands', async () => {
  const key = generateE2eeKey();
  const output = [];
  const write = line => output.push(line);
  const relay = { async updateBrowserKey() { throw new Error(key); } };
  await handleLocalControl(relay, JSON.stringify({ type: 'relayune:browser_key', request_id: '2-1', key }), write);
  assert.deepEqual(output, ['relayune:browser_key:2-1:error\n']);
  await handleLocalControl(relay, key, write);
  await handleLocalControl(relay, '{', write);
  await handleLocalControl(relay, JSON.stringify({ type: 'relayune:browser_key', request_id: key }), write);
  await handleLocalControl(relay, 'x'.repeat(1025), write);
  assert.equal(output.length, 1);
  assert.equal(output.join('').includes(key), false);
});
