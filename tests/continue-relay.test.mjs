import test from 'node:test';
import assert from 'node:assert/strict';
import { MacRelay } from '../relay/mac-relay.mjs';

function fixture(overrides = {}) {
  const events = [], submissions = [], processed = new Set();
  const adapter = { supportsContinuation: true, ...overrides,
    submitMessage: overrides.submitMessage ?? (async options => {
      submissions.push(options);
      return { turnId: 'new-turn', mode: 'started', action: 'continue', accepted: true, persisted: false };
    }),
  };
  const relay = new MacRelay({ serverUrl: 'https://relay.test', deviceId: 'device',
    deviceToken: 'synthetic-token', browserKeys: [], adapter, statePath: null });
  relay.validateCommand = () => true;
  relay.outbox.hasProcessedRequest = id => processed.has(id);
  relay.outbox.markProcessedRequest = async id => { processed.add(id); };
  relay.acknowledgeCommand = () => {};
  relay.emitEvent = async (sessionId, event) => { events.push({ sessionId, ...event }); };
  relay.syncSessionCatalog = async () => {};
  const command = (payload = {}, id = 'request') => ({ type: 'session.submit_message',
    request_id: id, session_id: 'session', payload: { action: 'continue', content: '',
      expected_turn_id: 'stopped-turn', client_message_id: 'client', attachments: [], ...payload } });
  return { relay, adapter, command, events, submissions };
}

test('continue reuses submit routing, emits exact native receipt and never a user message', async () => {
  const f = fixture();
  await f.relay.submitMessage(f.command());
  assert.equal(f.submissions.length, 1);
  assert.equal(f.submissions[0].action, 'continue');
  assert.equal(f.submissions[0].expectedTurnId, 'stopped-turn');
  assert.equal(f.submissions[0].interruptRunning, false);
  assert.deepEqual(f.events.map(e => e.kind), ['codex.persisted']);
  assert.equal(f.events[0].accepted, true);
  assert.equal(f.events[0].persisted, false);
  assert.equal(f.events[0].turn_id, 'new-turn');
  await f.relay.submitMessage(f.command());
  assert.equal(f.submissions.length, 1, 'redelivery preserves existing request de-duplication');
});

for (const payload of [ { content: 'continue' }, { attachments: [{}] }, { attachments: {} },
  { expected_turn_id: '' }, { runtime_settings: {} }, { interrupt_running: true }, { action: 'unknown' } ]) {
  test(`reject invalid continue without emitting a user message: ${JSON.stringify(payload)}`, async () => {
    const f = fixture();
    await f.relay.submitMessage(f.command(payload));
    assert.equal(f.submissions.length, 0);
    assert.equal(f.events.length, 1);
    assert.ok(['message.failed', 'turn.failed'].includes(f.events[0].kind));
  });
}

test('unsupported agent cannot silently turn continuation into an empty send', async () => {
  for (const overrides of [{ supportsContinuation: false }, { providerForSession: async () => 'kimi' }]) {
    const f = fixture(overrides);
    await f.relay.submitMessage(f.command());
    assert.equal(f.submissions.length, 0);
    assert.equal(f.events[0].kind, 'message.failed');
    assert.equal(f.events[0].action, 'continue');
  }
});

test('an exact Codex route outside the recent directory can continue', async () => {
  const f = fixture({ providerForSession: async () => 'codex',
    listSessions: async () => { throw Error('recent directory is irrelevant'); } });
  await f.relay.submitMessage(f.command());
  assert.equal(f.submissions.length, 1);
});

test('rejected continue is a delivery failure and never marks the stopped turn failed', async () => {
  const f = fixture({ submitMessage: async () => { throw Error('stale turn'); } });
  await f.relay.submitMessage(f.command());
  assert.equal(f.events[0].kind, 'message.failed');
  assert.equal(f.events[0].client_message_id, 'client');
  assert.equal(f.events.some(e => e.kind === 'turn.failed' || e.kind === 'user.message'), false);
});

test('ordinary messages retain the original user echo path', async () => {
  const f = fixture();
  await f.relay.submitMessage(f.command({ action: 'message', content: 'new instruction' }));
  assert.equal(f.events[0].kind, 'user.message');
  assert.equal(f.events[0].text, 'new instruction');
  assert.equal(f.submissions[0].action, undefined);
});
