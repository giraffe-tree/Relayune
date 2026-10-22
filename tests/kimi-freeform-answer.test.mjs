import test from 'node:test';
import assert from 'node:assert/strict';
import { KimiCodeAdapter } from '../relay/kimi-adapter.mjs';

async function fixture() {
  const adapter = new KimiCodeAdapter();
  const events = [], calls = [], approvals = [];
  adapter.handlers = { emitEvent: async (session, event) => events.push({ session, ...event }),
    requestApproval: async approval => approvals.push(approval) };
  adapter.client = { notify: (method, params) => calls.push({ method, params }),
    respond: (id, value) => calls.push({ id, value }) };
  adapter.activeTurns.set('session', 'old');
  adapter.activeTurns.set('peer', 'other');
  adapter.submitMessageUnlocked = async options => { calls.push({ prompt: options }); return { turnId: 'next' }; };
  await adapter.handleServerRequest({ id: 9, method: 'session/request_permission', params: {
    sessionId: 'session', toolCall: { title: 'AskUserQuestion', toolCallId: 'question',
      content: [{ type: 'content', content: { type: 'text', text: 'Your label?' } }] },
    options: [{ optionId: 'q0_opt_0', name: 'Green', kind: 'allow_once' },
      { optionId: 'q0_skip', name: 'Skip', kind: 'reject_once' }],
  } });
  return { adapter, events, calls, approvals, id: approvals[0].approval_id };
}

test('Kimi free text cancels the native question and waits before same-session continuation', async () => {
  const f = await fixture();
  assert.equal(f.approvals[0].action.allows_freeform, true);
  assert.equal(f.approvals[0].action.freeform_delivery, 'followup');
  const result = f.adapter.resolveApproval({ approvalId: f.id, decision: 'approved', answer: 'BLUE\nPINE' });
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(f.calls[0].method, 'session/cancel');
  assert.deepEqual(f.calls[1].value, { outcome: { outcome: 'cancelled' } });
  assert.equal(f.calls.some(call => call.prompt), false);
  await f.adapter.finishTurn('session');
  await result;
  assert.equal(f.calls[2].prompt.sessionId, 'session');
  assert.match(f.calls[2].prompt.content, /BLUE\nPINE$/);
  assert.equal(f.events.find(event => event.kind === 'user.message').text, f.calls[2].prompt.content);
  assert.equal(f.events.some(event => event.kind === 'approval.resolved'), false);
  assert.equal(f.adapter.activeTurns.get('peer'), 'other');
  await assert.rejects(f.adapter.resolveApproval({ approvalId: f.id, decision: 'approved', answer: 'duplicate' }), /no longer pending/);
});

test('Kimi unconfirmed stop never sends the answer', async () => {
  const f = await fixture(); f.adapter.controlTimeoutMs = 10;
  await assert.rejects(f.adapter.resolveApproval({ approvalId: f.id, decision: 'approved', answer: 'custom' }), /not confirmed/);
  assert.equal(f.calls.some(call => call.prompt), false);
});

test('Kimi freeform does not widen command approval or accept invalid mixed decisions', async () => {
  for (const value of [{ answer: '' }, { answer: 'x'.repeat(4001) }, { answer: 'x', optionId: 'q0_opt_0' },
    { answer: 'x', decision: 'rejected' }]) {
    const f = await fixture();
    await assert.rejects(f.adapter.resolveApproval({ approvalId: f.id, decision: 'approved', ...value }), /does not accept/);
    assert.equal(f.calls.length, 0);
    assert.ok(f.adapter.pendingApprovals.has(f.id));
  }
  const f = await fixture(); f.adapter.pendingApprovals.get(f.id).action = { type: 'command.execute' };
  await assert.rejects(f.adapter.resolveApproval({ approvalId: f.id, decision: 'approved', answer: 'yes' }), /does not accept/);
  assert.equal(f.calls.length, 0);
});

test('Kimi predefined options still resolve through the native option protocol', async () => {
  const f = await fixture();
  await f.adapter.resolveApproval({ approvalId: f.id, decision: 'approved', optionId: 'q0_opt_0' });
  assert.deepEqual(f.calls, [{ id: 9, value: { outcome: { outcome: 'selected', optionId: 'q0_opt_0' } } }]);
});
