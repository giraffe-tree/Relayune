import assert from "node:assert/strict";
import test from "node:test";

import { MacRelay } from "../relay/mac-relay.mjs";
import { hashAction } from "../relay/protocol.mjs";

function createRelay() {
  const submitted = [];
  const resolved = [];
  const integrationEvents = [];
  const integrationApprovals = [];
  const adapter = {
    async submitMessage(options) {
      submitted.push(options);
      return { turnId: "turn-local" };
    },
    async resolveApproval(options) {
      resolved.push(options);
    },
  };
  const relay = new MacRelay({
    serverUrl: "https://relayune.example",
    deviceId: "device-local",
    deviceToken: "token-local",
    adapter,
    integrations: [{
      handleAgentEvent(sessionId, event) {
        integrationEvents.push({ sessionId, event });
      },
      handleApproval(approval) {
        integrationApprovals.push(approval);
        return true;
      },
    }],
    statePath: null,
  });
  return {
    relay,
    submitted,
    resolved,
    integrationEvents,
    integrationApprovals,
  };
}

test("Feishu direct sessions submit locally without creating Relayune Server events", async () => {
  const fixture = createRelay();
  fixture.relay.registerLocalOnlySessions(["session-feishu"]);
  let remoteEventCount = 0;
  fixture.relay.emitEvent = async () => {
    remoteEventCount += 1;
  };

  const result = await fixture.relay.submitIntegrationMessage({
    sessionId: "session-feishu",
    requestId: "request-feishu",
    content: "只在本机处理",
    source: "feishu",
  });
  await fixture.relay.handleAdapterEvent("session-feishu", {
    kind: "message.completed",
    turn_id: "turn-local",
    text: "本机回复",
  });

  assert.deepEqual(result, { turnId: "turn-local" });
  assert.equal(remoteEventCount, 0);
  assert.deepEqual(fixture.submitted, [{
    sessionId: "session-feishu",
    requestId: "request-feishu",
    clientMessageId: "request-feishu",
    content: "只在本机处理",
    attachments: [],
  }]);
  assert.deepEqual(fixture.integrationEvents, [{
    sessionId: "session-feishu",
    event: {
      kind: "message.completed",
      turn_id: "turn-local",
      text: "本机回复",
    },
  }]);
});

test("approval-required actions in a direct session wait for a local integration decision", async () => {
  const fixture = createRelay();
  fixture.relay.registerLocalOnlySessions(["session-feishu"]);
  const action = {
    type: "command.execute",
    display: "npm test",
    cwd: "/Relayune QA Workspace",
    options: [
      { option_id: "allow-once", name: "允许一次", kind: "allow_once" },
      { option_id: "reject-once", name: "拒绝", kind: "reject_once" },
    ],
  };
  const approval = {
    approval_id: "approval-local",
    session_id: "session-feishu",
    root_session_id: "session-feishu",
    action: { ...action, command_hash: hashAction(action) },
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };

  await fixture.relay.handleAdapterApproval(approval);

  assert.equal(fixture.integrationApprovals.length, 1);
  assert.equal(
    fixture.integrationApprovals[0].local_session_id,
    "session-feishu",
  );
  assert.deepEqual(fixture.resolved, []);
  assert.equal(fixture.relay.localIntegrationApprovals.size, 1);

  assert.deepEqual(
    await fixture.relay.resolveLocalIntegrationApproval({
      approvalId: "approval-local",
      sessionId: "another-session",
      decision: "approved",
      optionId: "allow-once",
    }),
    { status: "invalid" },
  );
  assert.deepEqual(
    await fixture.relay.resolveLocalIntegrationApproval({
      approvalId: "approval-local",
      sessionId: "session-feishu",
      decision: "approved",
      optionId: "reject-once",
    }),
    { status: "invalid" },
  );
  assert.deepEqual(fixture.resolved, []);

  assert.deepEqual(
    await fixture.relay.resolveLocalIntegrationApproval({
      approvalId: "approval-local",
      sessionId: "session-feishu",
      decision: "approved",
      optionId: "allow-once",
    }),
    { status: "approved" },
  );
  assert.deepEqual(fixture.resolved, [{
    approvalId: "approval-local",
    decision: "approved",
    optionId: "allow-once",
  }]);
  assert.equal(fixture.relay.localIntegrationApprovals.size, 0);
  assert.equal(fixture.relay.pendingApprovals.size, 0);
});

test("direct approvals fail closed when no local integration owns the session", async () => {
  const fixture = createRelay();
  fixture.relay.integrations = [];
  fixture.relay.registerLocalOnlySessions(["session-feishu"]);
  const action = {
    type: "command.execute",
    display: "npm test",
    cwd: "/Relayune QA Workspace",
  };

  await fixture.relay.handleAdapterApproval({
    approval_id: "approval-unhandled",
    session_id: "session-feishu",
    action: { ...action, command_hash: hashAction(action) },
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });

  assert.deepEqual(fixture.resolved, [{
    approvalId: "approval-unhandled",
    decision: "rejected",
    optionId: null,
  }]);
  assert.equal(fixture.relay.localIntegrationApprovals.size, 0);
});

test("direct approvals expire in memory and reject the local adapter", async () => {
  const fixture = createRelay();
  fixture.relay.registerLocalOnlySessions(["session-feishu"]);
  const action = {
    type: "command.execute",
    display: "npm test",
    cwd: "/Relayune QA Workspace",
  };

  await fixture.relay.handleAdapterApproval({
    approval_id: "approval-expiring",
    session_id: "session-feishu",
    action: { ...action, command_hash: hashAction(action) },
    expires_at: new Date(Date.now() + 25).toISOString(),
  });
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.deepEqual(fixture.resolved, [{
    approvalId: "approval-expiring",
    decision: "rejected",
    optionId: null,
  }]);
  assert.equal(fixture.relay.localIntegrationApprovals.size, 0);
});

test("direct sessions are excluded from remote catalogs, stale bundles, and commands", async () => {
  const fixture = createRelay();
  fixture.relay.registerLocalOnlySessions(["session-feishu"]);
  fixture.relay.activeBrowserKeys.set("browser-1", {});

  assert.deepEqual(
    fixture.relay.remoteVisibleSessions([
      { id: "session-feishu" },
      { id: "session-browser" },
    ]),
    [{ id: "session-browser" }],
  );
  assert.deepEqual(
    await fixture.relay.encodeRemoteMessage({
      type: "opaque.event.bundle",
      variants: [
        { browser_id: "browser-1", session_id: "session-feishu" },
        { browser_id: "browser-1", session_id: "session-browser" },
      ],
    }),
    [{ browser_id: "browser-1", session_id: "session-browser" }],
  );

  fixture.relay.requestBrowsers.set("request-stale", "browser-1");
  await fixture.relay.handleMessage(JSON.stringify({
    type: "session.read_history",
    session_id: "session-feishu",
    request_id: "request-stale",
  }));
  assert.equal(fixture.relay.requestBrowsers.has("request-stale"), false);
});

test("integration submission fails closed unless the session is local-only", async () => {
  const fixture = createRelay();
  await assert.rejects(
    fixture.relay.submitIntegrationMessage({
      sessionId: "session-browser",
      requestId: "request-browser",
      content: "must not cross boundaries",
    }),
    /not registered as local-only/,
  );
  assert.equal(fixture.submitted.length, 0);
});
