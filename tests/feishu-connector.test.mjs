import assert from "node:assert/strict";
import test from "node:test";

import {
  FeishuConnectionError,
  FeishuConnector,
  feishuConsoleUrl,
  feishuPermissionJson,
  verifyFeishuConnection,
  verifyFeishuCredentials,
} from "../relay/feishu-connector.mjs";

function createFakeChannel() {
  const handlers = new Map();
  return {
    botIdentity: { name: "Relayune Bot" },
    connected: false,
    disconnected: false,
    sent: [],
    updatedCards: [],
    on(event, handler) {
      const listeners = handlers.get(event) ?? new Set();
      listeners.add(handler);
      handlers.set(event, listeners);
      return () => listeners.delete(handler);
    },
    emit(event, payload) {
      for (const handler of handlers.get(event) ?? []) handler(payload);
    },
    async connect() {
      this.connected = true;
    },
    async disconnect() {
      this.disconnected = true;
    },
    async send(chatId, content, options) {
      this.sent.push({ chatId, content, options });
      return { messageId: `sent-${this.sent.length}` };
    },
    async updateCard(messageId, card) {
      this.updatedCards.push({ messageId, card });
    },
  };
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test("Feishu credential verification selects the requested official API origin", async () => {
  let request;
  const result = await verifyFeishuCredentials(
    {
      platform: "lark",
      app_id: "cli_relayune",
      app_secret: "secret-value",
    },
    {
      fetchImpl: async (url, options) => {
        request = { url, options };
        return Response.json({ code: 0, tenant_access_token: "not-returned" });
      },
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(
    request.url,
    "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal",
  );
  assert.deepEqual(JSON.parse(request.options.body), {
    app_id: "cli_relayune",
    app_secret: "secret-value",
  });
  assert.equal(JSON.stringify(result).includes("secret-value"), false);
});

test("Feishu verification exposes only stable local error codes", async () => {
  await assert.rejects(
    verifyFeishuCredentials(
      {
        platform: "feishu",
        app_id: "cli_relayune",
        app_secret: "bad-secret",
      },
      {
        fetchImpl: async () => Response.json({ code: 10003 }, { status: 400 }),
      },
    ),
    (error) =>
      error instanceof FeishuConnectionError &&
      error.code === "feishu_credentials_invalid" &&
      !error.message.includes("bad-secret"),
  );
});

test("long-connection verification reports the bot name and always disconnects", async () => {
  const channel = createFakeChannel();
  const result = await verifyFeishuConnection(
    {
      platform: "feishu",
      app_id: "cli_relayune",
      app_secret: "secret-value",
    },
    { channelFactory: () => channel },
  );

  assert.deepEqual(result, { ok: true, bot_name: "Relayune Bot" });
  assert.equal(channel.connected, true);
  assert.equal(channel.disconnected, true);
});

test("restored Feishu chat bindings are registered as local-only sessions", async () => {
  const channel = createFakeChannel();
  let registered = [];
  const connector = new FeishuConnector({
    platform: "feishu",
    app_id: "cli_relayune",
    app_secret: "secret-value",
    workspace: "/Relayune QA Workspace",
    channelFactory: () => channel,
  });
  connector.bindings.set("chat-restored", "session-restored");

  await connector.start({
    async listSessions() {
      return [{ id: "session-restored" }];
    },
    registerLocalOnlySessions(sessionIds) {
      registered = sessionIds;
    },
    reportStatus() {},
  });

  assert.deepEqual(registered, ["session-restored"]);
  await connector.disconnect();
});

test("connector maps one chat to one local Agent session and replies with the final text", async () => {
  const channel = createFakeChannel();
  let channelOptions;
  let connector;
  const created = [];
  const submitted = [];
  const controller = {
    async listSessions() {
      return [];
    },
    async createSession(input) {
      created.push(input);
      return { id: "session-feishu-1" };
    },
    async submitMessage(input) {
      submitted.push(input);
      queueMicrotask(() => {
        connector.handleAgentEvent(input.sessionId, {
          kind: "turn.started",
          request_id: input.requestId,
          turn_id: `turn-${submitted.length}`,
        });
        if (submitted.length === 1) {
          connector.handleAgentEvent(input.sessionId, {
            kind: "message.completed",
            turn_id: "turn-1",
            text: "answer-1",
          });
        } else {
          connector.handleAgentEvent(input.sessionId, {
            kind: "message.delta",
            turn_id: "turn-2",
            text: "answer-2",
          });
          connector.handleAgentEvent(input.sessionId, {
            kind: "turn.completed",
            turn_id: "turn-2",
          });
        }
      });
      return { turnId: `turn-${submitted.length}` };
    },
    reportStatus() {},
  };
  connector = new FeishuConnector({
    platform: "feishu",
    app_id: "cli_relayune",
    app_secret: "secret-value",
    workspace: "/Relayune QA Workspace",
    channelFactory(options) {
      channelOptions = options;
      return channel;
    },
  });

  await connector.start(controller);
  channel.emit("message", {
    chatId: "chat-1",
    messageId: "message-1",
    senderId: "user-1",
    chatType: "group",
    content: "检查这个项目",
  });
  await waitFor(() => channel.sent.length === 1, "first reply was not sent");
  channel.emit("message", {
    chatId: "chat-1",
    messageId: "message-2",
    senderId: "user-1",
    chatType: "group",
    content: "继续",
  });
  await waitFor(() => channel.sent.length === 2, "second reply was not sent");

  assert.equal(created.length, 1);
  assert.deepEqual(created[0], {
    cwd: "/Relayune QA Workspace",
    name: "飞书 · 群聊",
    provider: "codex",
  });
  assert.equal(submitted.length, 2);
  assert.equal(submitted[0].sessionId, "session-feishu-1");
  assert.equal(submitted[0].source, "feishu");
  assert.deepEqual(channel.sent[0], {
    chatId: "chat-1",
    content: { markdown: "answer-1" },
    options: { replyTo: "message-1", replyInThread: false },
  });
  assert.equal(channelOptions.policy.requireMention, true);
  assert.equal(channelOptions.policy.dmMode, "open");
  assert.equal(channelOptions.policy.respondToMentionAll, false);

  await connector.disconnect();
  assert.equal(channel.disconnected, true);
});

test("approval cards resolve through the same long connection and only for the task owner", async () => {
  const channel = createFakeChannel();
  let connector;
  const resolved = [];
  const controller = {
    async listSessions() {
      return [];
    },
    async createSession() {
      return { id: "session-feishu-approval" };
    },
    async submitMessage(input) {
      queueMicrotask(() => {
        connector.handleAgentEvent(input.sessionId, {
          kind: "turn.started",
          request_id: input.requestId,
          turn_id: "turn-approval",
        });
      });
      return { turnId: "turn-approval" };
    },
    async resolveLocalApproval(input) {
      resolved.push(input);
      return { status: input.decision };
    },
    registerLocalOnlySessions() {},
    reportStatus() {},
  };
  connector = new FeishuConnector({
    platform: "feishu",
    app_id: "cli_relayune",
    app_secret: "secret-value",
    workspace: "/Relayune QA Workspace",
    channelFactory: () => channel,
  });
  await connector.start(controller);
  channel.emit("message", {
    chatId: "chat-approval",
    messageId: "message-owner",
    senderId: "owner-open-id",
    senderName: "发起人",
    chatType: "group",
    content: "执行需要审批的操作",
  });
  await waitFor(
    () => connector.pendingByRequest.size === 1,
    "approval request was not submitted",
  );

  const handled = await connector.handleApproval({
    approval_id: "approval-card-1",
    session_id: "session-feishu-approval",
    root_session_id: "session-feishu-approval",
    local_session_id: "session-feishu-approval",
    action: {
      type: "command.execute",
      display: "npm test -- private-command-must-not-enter-button-value",
      cwd: "/Relayune QA Workspace",
      command_hash: "local-hash",
      options: [
        { option_id: "allow-once", name: "允许一次", kind: "allow_once" },
        { option_id: "reject-once", name: "拒绝", kind: "reject_once" },
      ],
    },
    risk_level: "high",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });

  assert.equal(handled, true);
  assert.equal(channel.sent.length, 1);
  const card = channel.sent[0].content.card;
  const buttons = card.elements
    .filter((element) => element.tag === "action")
    .flatMap((element) => element.actions);
  const allowButton = buttons.find(
    (button) => button.value.option_id === "allow-once",
  );
  assert.ok(allowButton);
  assert.doesNotMatch(
    JSON.stringify(allowButton.value),
    /private-command-must-not-enter-button-value/,
  );

  channel.emit("cardAction", {
    messageId: "sent-1",
    chatId: "chat-approval",
    operator: { openId: "other-open-id", name: "其他成员" },
    action: { tag: "button", value: allowButton.value },
  });
  await waitFor(
    () => channel.sent.length === 2,
    "non-owner rejection notice was not sent",
  );
  assert.deepEqual(resolved, []);

  channel.emit("cardAction", {
    messageId: "sent-1",
    chatId: "chat-approval",
    operator: { openId: "owner-open-id", name: "发起人" },
    action: { tag: "button", value: allowButton.value },
  });
  await waitFor(
    () => channel.updatedCards.length === 1,
    "approval card was not updated",
  );
  assert.deepEqual(resolved, [{
    approvalId: "approval-card-1",
    sessionId: "session-feishu-approval",
    decision: "approved",
    optionId: "allow-once",
  }]);
  assert.equal(channel.updatedCards[0].messageId, "sent-1");
  assert.equal(channel.updatedCards[0].card.header.title.content, "已允许");

  await connector.handleApproval({
    approval_id: "approval-card-always",
    session_id: "session-feishu-approval",
    local_session_id: "session-feishu-approval",
    action: {
      type: "command.execute",
      display: "npm test",
      command_hash: "local-hash-always",
      options: [
        {
          option_id: "allow-always",
          name: "Always allow",
          kind: "allow_always",
        },
        { option_id: "reject", name: "Reject", kind: "reject_once" },
      ],
    },
    risk_level: "high",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  const alwaysCard = channel.sent[2].content.card;
  const alwaysButton = alwaysCard.elements
    .filter((element) => element.tag === "action")
    .flatMap((element) => element.actions)
    .find((button) => button.value.option_id === "allow-always");
  channel.emit("cardAction", {
    messageId: "sent-3",
    chatId: "chat-approval",
    operator: { openId: "owner-open-id", name: "发起人" },
    action: { tag: "button", value: alwaysButton.value },
  });
  await waitFor(
    () => channel.updatedCards.length === 2,
    "ongoing permission confirmation was not shown",
  );
  assert.equal(
    channel.updatedCards[1].card.header.title.content,
    "确认持续授权",
  );
  assert.equal(resolved.length, 1);
  const confirmButton = channel.updatedCards[1].card.elements
    .filter((element) => element.tag === "action")
    .flatMap((element) => element.actions)
    .find((button) => button.value.confirm_always === true);
  channel.emit("cardAction", {
    messageId: "sent-3",
    chatId: "chat-approval",
    operator: { openId: "owner-open-id", name: "发起人" },
    action: { tag: "button", value: confirmButton.value },
  });
  await waitFor(
    () => channel.updatedCards.length === 3,
    "confirmed ongoing permission was not resolved",
  );
  assert.deepEqual(resolved[1], {
    approvalId: "approval-card-always",
    sessionId: "session-feishu-approval",
    decision: "approved",
    optionId: "allow-always",
  });

  await connector.handleApproval({
    approval_id: "approval-card-expiring",
    session_id: "session-feishu-approval",
    local_session_id: "session-feishu-approval",
    action: {
      type: "command.execute",
      display: "npm test",
      command_hash: "local-hash-expiring",
    },
    risk_level: "medium",
    expires_at: new Date(Date.now() + 25).toISOString(),
  });
  await waitFor(
    () => channel.updatedCards.length === 4,
    "expired approval card was not updated",
  );
  assert.equal(
    channel.updatedCards[3].card.header.title.content,
    "已过期并拒绝",
  );
  assert.equal(resolved.length, 2);

  await connector.disconnect();
});

test("setup helpers expose only the minimum permission import and allowlisted consoles", () => {
  assert.deepEqual(JSON.parse(feishuPermissionJson()), {
    scopes: {
      tenant: [
        "im:message:send_as_bot",
        "im:message:readonly",
        "contact:user.id:readonly",
        "im:message.group_at_msg:readonly",
        "im:message.p2p_msg:readonly",
      ],
      user: [],
    },
  });
  assert.equal(feishuConsoleUrl("feishu", "apps"), "https://open.feishu.cn/app");
  assert.equal(feishuConsoleUrl("lark", "apps"), "https://open.larksuite.com/app");
});
