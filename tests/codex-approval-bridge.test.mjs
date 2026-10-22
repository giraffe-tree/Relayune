import assert from "node:assert/strict";
import test from "node:test";
import { CodexAppServerAdapter } from "../relay/codex-adapters.mjs";
import { MacRelay } from "../relay/mac-relay.mjs";
import { hashAction } from "../relay/protocol.mjs";

function createAdapter() {
  const approvals = [];
  const events = [];
  const writes = [];
  const adapter = new CodexAppServerAdapter({ workspace: "/relay-workspace" });
  adapter.child = {
    stdin: {
      write(line) {
        writes.push(JSON.parse(line));
        return true;
      },
    },
  };
  adapter.handlers = {
    requestApproval: async (approval) => approvals.push(approval),
    emitEvent: async (sessionId, event) => events.push({ sessionId, event }),
  };
  return { adapter, approvals, events, writes };
}

test("[relay] Codex command approvals preserve advertised decisions until app-server confirms resolution", async () => {
  const fixture = createAdapter();
  fixture.adapter.handleLine(JSON.stringify({
    id: 17,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-command",
      turnId: "turn-command",
      command: "npm run deploy",
      cwd: "/relay-workspace",
      availableDecisions: [
        "accept",
        "acceptForSession",
        {
          acceptWithExecpolicyAmendment: {
            execpolicy_amendment: ["npm", "run", "deploy"],
          },
        },
        "decline",
        "cancel",
      ],
    },
  }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fixture.approvals.length, 1);
  assert.deepEqual(
    fixture.approvals[0].action.options.map((option) => option.kind),
    [
      "allow_once",
      "allow_always",
      "allow_policy",
      "reject_once",
      "reject_cancel",
    ],
  );

  const result = await fixture.adapter.resolveApproval({
    approvalId: "apr_rpc_17",
    decision: "approved",
    optionId: "codex_decision_1",
  });
  assert.deepEqual(result, { confirmation: "serverRequest/resolved" });
  assert.deepEqual(fixture.writes, [
    { id: 17, result: { decision: "acceptForSession" } },
  ]);
  assert.equal(fixture.events.length, 0);
  assert.equal(fixture.adapter.pendingApprovals.size, 1);

  await fixture.adapter.handleNotification({
    method: "serverRequest/resolved",
    params: { threadId: "thread-command", requestId: 17 },
  });
  assert.equal(fixture.adapter.pendingApprovals.size, 0);
  assert.deepEqual(fixture.events, [
    {
      sessionId: "thread-command",
      event: {
        kind: "approval.resolved",
        approval_id: "apr_rpc_17",
        decision: "approved",
        command_hash: fixture.approvals[0].action.command_hash,
      },
    },
  ]);
});

test("[relay] Codex requestUserInput forwards selected and free-form answers across sequential questions", async () => {
  const fixture = createAdapter();
  await fixture.adapter.handleServerRequest({
    id: "question-rpc",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-question",
      turnId: "turn-question",
      itemId: "item-question",
      isBlocking: true,
      questions: [
        {
          id: "theme",
          header: "Theme",
          question: "Which theme?",
          options: [
            { label: "Light", description: "Light colors" },
            { label: "Dark", description: "Dark colors" },
          ],
          isOther: false,
          isSecret: false,
        },
        {
          id: "note",
          header: "Note",
          question: "Add a private note",
          options: null,
          isOther: true,
          isSecret: true,
        },
      ],
    },
  });

  assert.equal(fixture.approvals[0].approval_id, "apr_rpc_question-rpc_q0");
  assert.equal(fixture.approvals[0].action.type, "question.select");
  assert.equal(fixture.approvals[0].risk_level, "medium");
  assert.equal(fixture.approvals[0].action.allows_freeform, false);

  const first = await fixture.adapter.resolveApproval({
    approvalId: "apr_rpc_question-rpc_q0",
    decision: "approved",
    optionId: "codex_question_0_1",
  });
  assert.deepEqual(first, { confirmation: "immediate" });
  assert.equal(fixture.approvals[1].approval_id, "apr_rpc_question-rpc_q1");
  assert.equal(fixture.approvals[1].action.allows_freeform, true);
  assert.equal(fixture.approvals[1].action.is_secret, true);

  const second = await fixture.adapter.resolveApproval({
    approvalId: "apr_rpc_question-rpc_q1",
    decision: "approved",
    answer: "  keep surrounding spaces  ",
  });
  assert.deepEqual(second, { confirmation: "serverRequest/resolved" });
  assert.deepEqual(fixture.writes, [
    {
      id: "question-rpc",
      result: {
        answers: {
          theme: { answers: ["Dark"] },
          note: { answers: ["  keep surrounding spaces  "] },
        },
      },
    },
  ]);
});

test("[relay] Codex serverRequest/resolved clears an unanswered prompt without auto-rejecting it", async () => {
  const fixture = createAdapter();
  await fixture.adapter.handleServerRequest({
    id: 31,
    method: "item/fileChange/requestApproval",
    params: {
      threadId: "thread-file",
      turnId: "turn-file",
      reason: "Update the release manifest",
      grantRoot: "/relay-workspace",
    },
  });

  await fixture.adapter.handleNotification({
    method: "serverRequest/resolved",
    params: { threadId: "thread-file", requestId: 31 },
  });

  assert.deepEqual(fixture.writes, []);
  assert.equal(fixture.adapter.pendingApprovals.size, 0);
  assert.equal(fixture.events[0].event.decision, "expired");
});

test("[relay] Desktop waits for adapter confirmation and publishes retryable failures as encrypted events", async () => {
  const action = {
    type: "command.execute",
    display: "npm run deploy",
    cwd: "/relay-workspace",
  };
  const approval = {
    approval_id: "apr_rpc_44",
    session_id: "thread-command",
    root_session_id: "thread-command",
    device_id: "dev-test",
    action: { ...action, command_hash: hashAction(action) },
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    resolving: false,
  };
  const calls = [];
  const events = [];
  const relay = new MacRelay({
    deviceId: "dev-test",
    adapter: {
      resolveApproval: async (options) => {
        calls.push(options);
        return { confirmation: "serverRequest/resolved" };
      },
    },
    browserKeys: [],
    statePath: null,
  });
  relay.emitEvent = async (sessionId, event) => events.push({ sessionId, event });
  relay.pendingApprovals.set(approval.approval_id, approval);

  await relay.resolveApproval({
    type: "approval.resolve",
    request_id: "request-approval",
    device_id: "dev-test",
    session_id: approval.session_id,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30_000).toISOString(),
    payload: {
      approval_id: approval.approval_id,
      device_id: "dev-test",
      session_id: approval.session_id,
      decision: "approved",
      command_hash: approval.action.command_hash,
      expires_at: approval.expires_at,
      nonce: "1234567890abcdef",
      option_id: "codex_decision_0",
      answer: null,
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(events.length, 0);
  assert.equal(relay.pendingApprovals.get(approval.approval_id).resolving, true);

  await relay.handleAdapterEvent(approval.root_session_id, {
    kind: "approval.resolved",
    approval_id: approval.approval_id,
    decision: "approved",
    command_hash: approval.action.command_hash,
  });
  assert.equal(relay.pendingApprovals.size, 0);
  assert.equal(events[0].event.kind, "approval.resolved");

  const failed = {
    ...approval,
    approval_id: "apr_rpc_45",
    resolving: false,
  };
  relay.pendingApprovals.set(failed.approval_id, failed);
  relay.adapter.resolveApproval = async () => {
    throw new Error("app-server rejected the decision payload");
  };
  await relay.resolveApproval({
    type: "approval.resolve",
    request_id: "request-failed",
    device_id: "dev-test",
    session_id: failed.session_id,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30_000).toISOString(),
    payload: {
      approval_id: failed.approval_id,
      device_id: "dev-test",
      session_id: failed.session_id,
      decision: "rejected",
      command_hash: failed.action.command_hash,
      expires_at: failed.expires_at,
      nonce: "fedcba0987654321",
      option_id: null,
      answer: null,
    },
  });
  assert.equal(relay.pendingApprovals.get(failed.approval_id).resolving, false);
  assert.equal(events.at(-1).event.kind, "approval.failed");
  assert.match(events.at(-1).event.error, /rejected the decision payload/);
});

test('[relay] decisions from a previous Relay generation expire instead of waiting forever', async () => {
  let adapterCalls = 0;
  const events = [];
  const relay = new MacRelay({ serverUrl: 'https://relay.test', deviceId: 'dev_test',
    deviceToken: 'test-token', adapter: { async resolveApproval() { adapterCalls++; } }, statePath: null });
  relay.emitEvent = async (sessionId, event) => events.push({ sessionId, event });
  const command = { device_id: 'dev_test', request_id: 'req_test', session_id: 'session_old',
    expires_at: new Date(Date.now() + 30000).toISOString(), payload: {
      device_id: 'dev_test', session_id: 'session_old', approval_id: 'apr_old',
      nonce: 'nonce_old_1234567890', decision: 'approved' } };
  await relay.resolveApproval(command);
  assert.deepEqual(events, [{ sessionId: 'session_old', event: {
    kind: 'approval.resolved', approval_id: 'apr_old', decision: 'expired' } }]);
  assert.equal(adapterCalls, 0);
  await relay.resolveApproval(command);
  assert.equal(events.length, 1, 'replay does not emit another event');
  await relay.resolveApproval({ ...command, payload: { ...command.payload,
    nonce: 'different_nonce_1234567890', session_id: 'another_session' } });
  assert.equal(events.length, 1, 'mismatched routing cannot expire another session request');
});
