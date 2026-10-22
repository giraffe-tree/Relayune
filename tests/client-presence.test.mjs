import test from 'node:test';
import assert from 'node:assert/strict';
import { onlineBrowserIds } from '../relay/client-presence.mjs';

test('presence includes only live subscriptions and open authorized direct channels', () => {
  const stream = [{browserId: 'phone', live: true}, {browserId: 'stale', live: false}];
  const direct = [{browserId: 'phone', live: true, channel: {readyState: 'open'}},
    {browserId: 'tablet', live: true, channel: {readyState: 'open'}},
    {browserId: 'negotiating', live: true}, {browserId: 'revoked', live: false, channel: {readyState: 'open'}}];
  const relay = {ready: true, closed: false,
    onlineTransport: {peers: new Map(stream.map(p => [p.browserId, p])), valid: p => p.live},
    directHost: {peers: new Map(direct.map(p => [p.browserId, p])), valid: p => p.live}};
  assert.deepEqual(onlineBrowserIds(relay), ['phone', 'tablet']);
  stream[0].live = false; direct[0].channel.readyState = 'closed';
  assert.deepEqual(onlineBrowserIds(relay), ['tablet']);
  assert.deepEqual(onlineBrowserIds({...relay, ready: false}), []);
  assert.deepEqual(onlineBrowserIds({...relay, closed: true}), []);
  assert.deepEqual(onlineBrowserIds({ready: true}), []);
});
