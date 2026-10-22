const TRANSPORT_FIXTURE_TIME = new Date().toISOString();
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { MockCodexAdapter } from "../relay/codex-adapters.mjs";
import {
  generateE2eeKey,
  keyIdForKey,
  openJson,
  sealJson,
} from "../relay/e2ee.mjs";
import { MacRelay } from "../relay/mac-relay.mjs";

const CANARY = "REMOTE_E2EE_CANARY_7fd919b4";
const ATTACHMENT_NAME = `${CANARY}-private-upload.png`;
const DEVICE_ID = "dev_remote_e2ee";
const DEVICE_TOKEN = "remote-e2ee-device-token";
const SESSION_ID = "ses_codex_remote";
const BROWSER_ID = `web_${"a".repeat(32)}`;

test("[MOB-PRJ-008][server] remote polling relay keeps catalog, events, responses, and outbox opaque", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "codex-relay-remote-e2ee-"));
  const statePath = join(temp, "outbox.json");
  const e2eeKey = generateE2eeKey();
  const browserKeyId = await keyIdForKey(e2eeKey);
  const now = Date.now();
  const submitCommand = {
    type: "session.submit_message",
    request_id: "req_remote_submit",
    device_id: DEVICE_ID,
    session_id: SESSION_ID,
    payload: {
      content: `${CANARY} private command`,
      client_message_id: "msg_remote_private",
      runtime_settings: {model: `${CANARY}-model`, effort: "high", permissions: "manual"},
      attachments: [
        {
          id: "upload_remote_private",
          type: "image",
          name: ATTACHMENT_NAME,
          mime_type: "image/png",
          detail: "auto",
          base64: Buffer.concat([
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
            Buffer.from(`${CANARY} private image bytes`),
          ]).toString("base64"),
        },
      ],
    },
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + 60_000).toISOString(),
  };
  const historyCommand = {
    type: "session.read_history",
    request_id: "req_remote_history",
    device_id: DEVICE_ID,
    session_id: SESSION_ID,
    payload: { limit: 100, before: null, performance_trace_id: `history_${"d".repeat(32)}` },
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + 60_000).toISOString(),
  };
  const agentsCommand = {
    type: "session.read_agents",
    request_id: "req_remote_agents",
    device_id: DEVICE_ID,
    session_id: SESSION_ID,
    payload: {},
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + 60_000).toISOString(),
  };
  const configureCommand = {
    type: "session.configure",
    request_id: "req_remote_configure",
    device_id: DEVICE_ID,
    session_id: SESSION_ID,
    payload: {
      config_id: "mode",
      value: `${CANARY}-private-mode`,
    },
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + 60_000).toISOString(),
  };
  const createCommand = {
    type: "session.create",
    request_id: "req_remote_create",
    device_id: DEVICE_ID,
    session_id: null,
    payload: {
      cwd: temp,
      name: `${CANARY} named session`,
      provider: "codex",
    },
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + 60_000).toISOString(),
  };
  const commandFrames = await Promise.all([
    sealedCommandFrame(e2eeKey, submitCommand),
    sealedCommandFrame(e2eeKey, historyCommand),
    sealedCommandFrame(e2eeKey, agentsCommand),
    sealedCommandFrame(e2eeKey, configureCommand),
    sealedCommandFrame(e2eeKey, createCommand),
  ]);
  const serverState = {
    helloBodies: [],
    commandFrames,
    pushedBodies: [],
    authorizationHeaders: [],
    commandsDelivered: false,
    browserKeyId,
  };
  const server = createFakePollingServer(serverState);
  await listen(server);
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const serverUrl = `http://127.0.0.1:${address.port}`;

  const adapter = new MockCodexAdapter({
    workspace: temp,
    historyMessages: [
      {
        id: "history_private",
        role: "codex",
        content: `${CANARY} private history response`,
        created_at: new Date(now - 1_000).toISOString(),
        turn_id: "turn_history_private",
      },
    ],
  });
  const submittedSettings = [];
  const submit = adapter.submitMessage.bind(adapter);
  adapter.submitMessage = async options => {
    submittedSettings.push(options.runtimeSettings);
    return submit(options);
  };
  adapter.userMessageId = () => `${CANARY}-input-identity`;
  adapter.mockSessions[0].name = `${CANARY} private catalog`;
  adapter.mockAgents = [
    {
      id: "agent_private",
      thread_id: "agent_private",
      parent_session_id: SESSION_ID,
      name: "Private agent",
      task: "Verify activity",
      status: "running",
      progress: 50,
      activity_log: [
        {
          id: "activity_private",
          kind: "tool",
          label: `${CANARY} private agent activity`,
          occurred_at: new Date(now).toISOString(),
        },
      ],
    },
  ];
  const quota = { as_of: new Date(now).toISOString(), daily: [], quota_windows: [
    { id: "five_hour", used_percent: 23, resets_at: new Date(now + 3600000).toISOString(), as_of: new Date(now).toISOString() },
    { id: "seven_day", used_percent: 54, resets_at: new Date(now + 86400000).toISOString(), as_of: new Date(now).toISOString() },
  ] };
  adapter.readUsage = async () => ({codex: quota, claude: quota, kimi: quota});
  const configuredSessions = [];
  adapter.configureSession = async (request) => {
    configuredSessions.push(request);
    return {
      configOptions: [
        {
          type: "select",
          id: request.configId,
          name: "Mode",
          currentValue: request.value,
          options: [],
        },
      ],
    };
  };

  const historyTimings = [];
  const relay = new MacRelay({
    historyPerformance: sample => historyTimings.push(sample),
    readAgentRuntimeInfo: async () => [{ provider: "zcode", version: "0.16.5", status: "ready" }],
    serverUrl,
    deviceId: DEVICE_ID,
    deviceToken: DEVICE_TOKEN,
    transport: "poll",
    pollIntervalMs: 20,
    browserKeys: [{ browserId: BROWSER_ID, e2eeKey }],
    adapter,
    statePath,
  });
  let relayStopped = false;
  t.after(async () => {
    if (!relayStopped) await relay.stop().catch(() => {});
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  });

  await relay.start();
  await relay.waitUntilReady();
  await waitFor(async () => {
    const decrypted = await decryptPushedMessages(e2eeKey, serverState);
    return (
      decrypted.catalogs.some((message) =>
        message.sessions.some((session) => session.name.includes(CANARY)),
      ) &&
      decrypted.catalogs.some(message => JSON.stringify(message.usage?.codex) === JSON.stringify(quota) && JSON.stringify(message.usage?.claude) === JSON.stringify(quota) && JSON.stringify(message.usage?.kimi) === JSON.stringify(quota)) &&
      decrypted.catalogs.some(message => message.desktop?.agents?.some(agent => agent.provider === "zcode" && agent.version === "0.16.5" && agent.status === "ready")) &&
      decrypted.catalogs.some((message) =>
        message.sessions.some(
          (session) =>
            session.name === `${CANARY} named session` &&
            session.cwd === temp,
        ),
      ) &&
      decrypted.responses.some((message) =>
        message.messages?.some((entry) => entry.content.includes(CANARY)),
      ) &&
      decrypted.responses.some((message) =>
        message.agents?.some((agent) =>
          agent.activity_log?.some((activity) => activity.label.includes(CANARY)),
        ),
      ) &&
      decrypted.responses.some(
        (message) =>
          message.type === "session.create_result" &&
          message.request_id === createCommand.request_id &&
          message.session?.name === `${CANARY} named session`,
      ) &&
      decrypted.responses.some(
        (message) =>
          message.type === "session.configure_result" &&
          message.request_id === configureCommand.request_id &&
          message.session_id === SESSION_ID &&
          message.config_options?.[0]?.currentValue ===
            `${CANARY}-private-mode`,
      ) &&
      decrypted.events.some(
        (message) =>
          message.event.kind === "user.message" &&
          message.event.text.includes(CANARY) &&
          message.event.attachments?.[0]?.name === ATTACHMENT_NAME,
      ) &&
      decrypted.events.some(
        (message) =>
          message.event.kind === "message.completed" &&
          message.event.text.includes("本次本地链路验证完成"),
      ) &&
      decrypted.events.some(
        (message) =>
          message.event.kind === "turn.completed" &&
          message.event.status === "completed",
      ) &&
      decrypted.events.some(
        (message) =>
          message.event.kind === "session.config_updated" &&
          message.event.config_options?.[0]?.currentValue ===
            `${CANARY}-private-mode`,
      )
    );
  });

  await relay.stop();
  relayStopped = true;

  const timing = historyTimings.find(sample => sample.stage === 'uploaded');
  assert.ok(timing, 'upload completion must be observed after server acceptance');
  assert.ok(timing.desktop_received_at_ms <= timing.history_ready_at_ms);
  assert.ok(timing.history_ready_at_ms <= timing.queued_at_ms);
  assert.ok(timing.queued_at_ms <= timing.upload_started_at_ms);
  assert.ok(timing.upload_started_at_ms <= timing.upload_completed_at_ms);
  assert.ok(timing.response_wire_bytes > 0);
  assert.doesNotMatch(JSON.stringify(historyTimings), new RegExp(CANARY));
  const serverVisibleJson = JSON.stringify({
    helloBodies: serverState.helloBodies,
    commandFrames: serverState.commandFrames,
    pushedBodies: serverState.pushedBodies,
  });
  assert.doesNotMatch(serverVisibleJson, new RegExp(CANARY));
  assert.doesNotMatch(serverVisibleJson, /desktop_received_at_ms|history_read_ms|queued_at_ms|upload_completed_at_ms/);
  assert.doesNotMatch(serverVisibleJson, /quota_windows|used_percent|five_hour|seven_day/);
  assert.doesNotMatch(
    serverVisibleJson,
    /private command|private catalog|private history response|private-upload|private image bytes/,
  );
  assert.ok(
    serverState.authorizationHeaders.every(
      (header) => header === `Bearer ${DEVICE_TOKEN}`,
    ),
  );

  const pushedMessages = serverState.pushedBodies.flatMap(
    (body) => body.messages ?? [],
  );
  assert.ok(pushedMessages.some((message) => message.kind === "catalog"));
  assert.ok(pushedMessages.some((message) => message.kind === "event"));
  assert.ok(pushedMessages.some((message) => message.kind === "response"));
  assert.ok(
    pushedMessages.some(
      (message) =>
        message.kind === "command_ack" &&
        message.request_id === submitCommand.request_id &&
        message.status === "accepted",
      ),
  );
  assert.ok(
    pushedMessages.some(
      (message) =>
        message.kind === "command_ack" &&
        message.request_id === createCommand.request_id &&
        message.status === "accepted",
    ),
  );
  assert.ok(
    pushedMessages.some(
      (message) =>
        message.kind === "command_ack" &&
        message.request_id === configureCommand.request_id &&
        message.status === "accepted",
    ),
  );

  const persistedOutbox = await readFile(statePath, "utf8");
  assert.doesNotMatch(persistedOutbox, new RegExp(CANARY));
  assert.doesNotMatch(persistedOutbox, /private command/);
  const stored = JSON.parse(persistedOutbox);
  assert.equal(stored.pending.length, 0, "successful pushes retire delivered ciphertext even with a lagging cursor");

  const decrypted = await decryptPushedMessages(e2eeKey, serverState);
  assert.ok(
    decrypted.catalogs.some((message) =>
      message.sessions.some(
        (session) => session.name === `${CANARY} private catalog`,
      ),
    ),
  );
  assert.ok(
    decrypted.catalogs.some((message) =>
      message.sessions?.some(
        (session) =>
          session.name === `${CANARY} named session` && session.cwd === temp,
      ),
    ),
  );
  assert.ok(
    decrypted.catalogs.some(
      (message) =>
        message.sessions.some(
          (session) => session.name === `${CANARY} private catalog`,
        ) &&
        message.sessions.some(
          (session) => session.name === `${CANARY} named session`,
        ),
    ),
  );
  assert.ok(
    decrypted.responses.some(
      (message) =>
        message.type === "session.create_result" &&
        message.request_id === createCommand.request_id &&
        message.session_id === message.session?.id &&
        message.session?.name === `${CANARY} named session`,
    ),
  );
  assert.ok(
    decrypted.responses.some(
      (message) =>
        message.type === "session.configure_result" &&
        message.request_id === configureCommand.request_id &&
        message.session_id === SESSION_ID &&
        message.config_id === "mode" &&
        message.config_options?.[0]?.currentValue ===
          `${CANARY}-private-mode`,
    ),
  );
  assert.ok(
    decrypted.responses.some((message) =>
      message.messages?.some(
        (entry) => entry.content === `${CANARY} private history response`,
      ),
    ),
  );
  assert.ok(
    decrypted.responses.some((message) =>
      message.agents?.some((agent) =>
        agent.activity_log?.some(
          (activity) => activity.label === `${CANARY} private agent activity`,
        ),
      ),
    ),
  );
  assert.ok(
    decrypted.events.some(
      (message) =>
        message.event.kind === "user.message" &&
        message.event.text === `${CANARY} private command` &&
        message.event.item_id === `${CANARY}-input-identity` &&
        message.event.attachments?.[0]?.name === ATTACHMENT_NAME,
    ),
  );
  assert.ok(
    decrypted.events.some(
      (message) =>
        message.event.kind === "message.completed" &&
        message.event.text.includes("本次本地链路验证完成"),
    ),
  );
  assert.deepEqual(submittedSettings, [{model: `${CANARY}-model`, effort: "high", permissions: "manual"}]);
  assert.deepEqual(configuredSessions, [
    {
      sessionId: SESSION_ID,
      configId: "mode",
      value: `${CANARY}-private-mode`,
    },
  ]);
  assert.ok(
    decrypted.events.some(
      (message) =>
        message.event.kind === "session.config_updated" &&
        message.event.config_options?.[0]?.currentValue ===
          `${CANARY}-private-mode`,
    ),
  );
});

test("[MOB-PRJ-008][relay] creation result is authoritative and a lagging list is merged into a complete catalog", async () => {
  const oldSession = {
    id: "session_old",
    name: "Old session",
    project: "relayune",
    cwd: "/workspace/relayune",
    provider: "codex",
  };
  const created = {
    id: "session_created",
    name: "New session",
    project: "relayune",
    cwd: "/workspace/relayune",
    provider: "codex",
  };
  const relay = new MacRelay({
    serverUrl: "https://relay.test",
    deviceId: DEVICE_ID,
    deviceToken: DEVICE_TOKEN,
    browserKeys: [],
    adapter: {
      createSession: async () => created,
      listSessions: async () => [oldSession],
    },
    statePath: null,
  });
  const sent = [];
  relay.validateCommand = () => true;
  relay.outbox.hasProcessedRequest = () => false;
  relay.outbox.markProcessedRequest = async () => {};
  relay.send = (message) => {
    sent.push(message);
    return true;
  };
  relay.emitEvent = async () => {};

  await relay.createSession({
    type: "session.create",
    request_id: "request_create",
    device_id: DEVICE_ID,
    session_id: null,
    payload: {
      cwd: created.cwd,
      name: created.name,
      provider: created.provider,
    },
  });
  await Promise.allSettled([...relay.operations]);

  assert.deepEqual(
    sent.find((message) => message.type === "session.create_result"),
    {
      type: "session.create_result",
      request_id: "request_create",
      session_id: created.id,
      session: created,
    },
  );
  assert.deepEqual(
    sent.find((message) => message.type === "relay.sync_sessions")?.sessions,
    [created, oldSession],
  );
});

test(
  "[MOB-PRJ-012][relay] creation frees the command loop before verification and preserves the first turn",
  { timeout: 2000 },
  async () => {
    const created = {
      id: "session_fast_created",
      name: "Fast session",
      project: "relayune",
      cwd: "/workspace/relayune",
      provider: "codex",
      sync_state: "pending",
      status: "idle",
    };
    let submitted = false;
    const running = { ...created, status: "running", model: "updated-model" };
    let finishFinalization;
    const finalizationGate = new Promise((resolve) => {
      finishFinalization = resolve;
    });
    const relay = new MacRelay({
      serverUrl: "https://relay.test",
      deviceId: DEVICE_ID,
      deviceToken: DEVICE_TOKEN,
      browserKeys: [],
      adapter: {
        createSession: async () => created,
        finalizeSessionCreation: async (session) => {
          await finalizationGate;
          return { ...session, sync_state: "persisted" };
        },
        listSessions: async () => [submitted ? running : created],
        submitMessage: async ({ sessionId }) => {
          assert.equal(sessionId, created.id);
          submitted = true;
          return { turnId: "first_turn" };
        },
      },
      statePath: null,
    });
    const sent = [];
    const events = [];
    relay.validateCommand = () => true;
    relay.outbox.hasProcessedRequest = () => false;
    relay.outbox.markProcessedRequest = async () => {};
    relay.send = (message) => {
      sent.push(message);
      return true;
    };
    relay.emitEvent = async (sessionId, event) => {
      events.push({ sessionId, event });
    };

    await relay.handleMessage(
      JSON.stringify({
        type: "session.create",
        request_id: "request_fast_create",
        device_id: DEVICE_ID,
        session_id: null,
        payload: {
          cwd: created.cwd,
          name: created.name,
          provider: created.provider,
        },
      }),
    );

    assert.equal(
      sent.some((message) => message.type === "session.create_result"),
      true,
    );
    assert.equal(
      sent.some((message) => message.type === "relay.sync_sessions"),
      false,
    );
    assert.equal(events.length, 0);

    await relay.handleMessage(
      JSON.stringify({
        type: "session.submit_message",
        request_id: "request_first_message",
        device_id: DEVICE_ID,
        session_id: created.id,
        payload: { content: "Start working" },
      }),
    );
    assert.equal(submitted, true);
    assert.equal(relay.operations.size, 1);

    finishFinalization();
    await Promise.allSettled([...relay.operations]);
    assert.deepEqual(
      sent.find((message) => message.type === "relay.sync_sessions")?.sessions,
      [running],
    );
    assert.equal(
      events.find(({ event }) => event.operation === "thread").event.persisted,
      true,
    );
    assert.equal(relay.operations.size, 0);
  },
);

for (const stage of ["verification", "catalog"]) {
  test(
    `[relay] shutdown cancels background creation during ${stage} without starting more work`,
    { timeout: 2000 },
    async () => {
      let rejectPending;
      const pending = new Promise((_, reject) => {
        rejectPending = reject;
      });
      let enteredStage;
      const entered = new Promise((resolve) => {
        enteredStage = resolve;
      });
      const created = { id: "shutdown_thread", sync_state: "pending" };
      let catalogCalls = 0;
      let closed = false;
      const relay = new MacRelay({
        serverUrl: "https://relay.test",
        deviceId: DEVICE_ID,
        deviceToken: DEVICE_TOKEN,
        browserKeys: [],
        adapter: {
          createSession: async () => created,
          finalizeSessionCreation: async () => {
            if (stage === "verification") {
              enteredStage();
              await pending;
            }
            return created;
          },
          listSessions: async () => {
            catalogCalls += 1;
            enteredStage();
            return pending;
          },
          close: async () => {
            closed = true;
            rejectPending(new Error("Adapter closed"));
          },
        },
        statePath: null,
      });
      const sent = [];
      relay.validateCommand = () => true;
      relay.outbox.hasProcessedRequest = () => false;
      relay.outbox.markProcessedRequest = async () => {};
      relay.send = (message) => sent.push(message);
      relay.emitEvent = async () =>
        assert.fail("No completion event after shutdown");
      await relay.createSession({
        request_id: "shutdown_create",
        payload: {
          cwd: "/workspace/relayune",
          name: "Shutdown",
          provider: "codex",
        },
      });
      await entered;
      await relay.stop();
      assert.equal(closed, true);
      assert.equal(catalogCalls, stage === "catalog" ? 1 : 0);
      assert.equal(relay.operations.size, 0);
      assert.equal(
        sent.some((message) => message.type === "session.create_result"),
        true,
      );
      assert.equal(
        sent.some(
          (message) =>
            message.type === "relay.sync_sessions" ||
            message.type === "session.create_error",
        ),
        false,
      );
    },
  );
}

test("[relay] failed background verification keeps the authoritative creation result", async () => {
  const relay = new MacRelay({
    serverUrl: "https://relay.test",
    deviceId: DEVICE_ID,
    deviceToken: DEVICE_TOKEN,
    browserKeys: [],
    adapter: {
      createSession: async () => ({
        id: "created_thread",
        sync_state: "pending",
      }),
      finalizeSessionCreation: async () => {
        throw new Error("Read-back failed");
      },
      listSessions: async () => {
        throw new Error("Catalog failed");
      },
    },
    statePath: null,
  });
  const sent = [];
  const events = [];
  relay.validateCommand = () => true;
  relay.outbox.hasProcessedRequest = () => false;
  relay.outbox.markProcessedRequest = async () => {};
  relay.send = (message) => sent.push(message);
  relay.emitEvent = async (_, event) => events.push(event);
  await relay.createSession({
    request_id: "failed_finalize",
    payload: { cwd: "/workspace/relayune", name: "Created", provider: "codex" },
  });
  await Promise.allSettled([...relay.operations]);
  assert.equal(
    sent.some((message) => message.type === "session.create_result"),
    true,
  );
  assert.equal(
    sent.some((message) => message.type === "session.create_error"),
    false,
  );
  assert.equal(events[0].persisted, false);
});

test("[RELAY-RETRY-002][relay] upload queue deduplicates retries and keeps browser variants atomic", () => {
  const relay = new MacRelay({
    serverUrl: "https://relay.test",
    deviceId: DEVICE_ID,
    deviceToken: DEVICE_TOKEN,
    browserKeys: [],
    adapter: {},
    statePath: null,
  });
  const messages = [];
  for (let eventSeq = 1; eventSeq <= 13; eventSeq += 1) {
    for (let browser = 0; browser < 4; browser += 1) {
      messages.push({
        kind: "event", created_at: TRANSPORT_FIXTURE_TIME,
        browser_id: `web_${browser}`,
        event_seq: eventSeq,
      });
    }
  }
  relay.enqueueRemoteMessages([...messages, structuredClone(messages[0])]);
  assert.equal(relay.uploadQueue.length, 52);
  assert.equal(relay.uploadKeys.size, 52);

  const firstBatch = relay.takeUploadBatch(50);
  assert.equal(firstBatch.length, 48);
  assert.equal(relay.uploadQueue.length, 4);
  assert.equal(
    new Set(firstBatch.map((entry) => entry.message.event_seq)).size,
    12,
  );
  assert.ok(firstBatch.every((entry) => entry.message.event_seq <= 12));
  assert.ok(relay.uploadQueue.every((entry) => entry.message.event_seq === 13));
});

test("[RELAY-RETRY-003][relay] rejected data stays separate from a healthy transport", async () => {
  const relay = new MacRelay({
    serverUrl: "https://relay.test",
    deviceId: DEVICE_ID,
    deviceToken: DEVICE_TOKEN,
    browserKeys: [],
    adapter: {},
    statePath: null,
  });
  relay.ready = true;
  let responseStatus = 400;
  relay.remoteFetch = async () =>
    Response.json(
      responseStatus === 400
        ? { error: { code: "invalid_aad", message: "Invalid data." } }
        : { accepted: true, ack_seq: 0 },
      { status: responseStatus },
    );

  relay.enqueueRemoteMessages([
    { kind: "heartbeat", device_id: DEVICE_ID, last_event_seq: 1 },
  ]);
  await relay.flushRemoteUploads();
  assert.equal(relay.ready, true);
  assert.equal(relay.uploadQueue.length, 0);
  assert.equal(relay.deliveryWarningActive, true);
  assert.ok(relay.rejectedUploadKeys.has("heartbeat"));

  responseStatus = 200;
  relay.enqueueRemoteMessages([
    { kind: "heartbeat", device_id: DEVICE_ID, last_event_seq: 1 },
  ]);
  await relay.flushRemoteUploads();
  assert.equal(relay.ready, true);
  assert.equal(relay.deliveryWarningActive, false);
  assert.equal(relay.rejectedUploadKeys.size, 0);
});

test("[RELAY-RETRY-004][relay] a transient upload failure backs off without duplicating or disconnecting", async () => {
  const relay = new MacRelay({
    serverUrl: "https://relay.test",
    deviceId: DEVICE_ID,
    deviceToken: DEVICE_TOKEN,
    browserKeys: [],
    adapter: {},
    statePath: null,
  });
  relay.ready = true;
  relay.remoteFetch = async () => {
    throw new Error("temporary network failure");
  };
  const heartbeat = {
    kind: "heartbeat",
    device_id: DEVICE_ID,
    last_event_seq: 1,
  };
  relay.enqueueRemoteMessages([heartbeat]);
  await relay.flushRemoteUploads();
  relay.enqueueRemoteMessages([structuredClone(heartbeat)]);

  assert.equal(relay.ready, true);
  assert.equal(relay.uploadQueue.length, 1);
  assert.equal(relay.uploadKeys.size, 1);
  assert.notEqual(relay.uploadRetryTimer, null);
  clearTimeout(relay.uploadRetryTimer);
  relay.uploadRetryTimer = null;
  relay.closed = true;
});

for (const rejectionStatus of [400, 413]) {
test(`[RELAY-RETRY-005][relay] rejected ${rejectionStatus} item is isolated while healthy batch data continues`, async (t) => {
  const relay = new MacRelay({
    serverUrl: "https://relay.test",
    deviceId: DEVICE_ID,
    deviceToken: DEVICE_TOKEN,
    browserKeys: [],
    adapter: {},
    statePath: null,
  });
  t.after(() => { relay.closed = true; clearTimeout(relay.uploadRetryTimer); });
  relay.ready = true;
  const batches = [];
  relay.remoteFetch = async (_path, options) => {
    const batch = JSON.parse(options.body).messages;
    batches.push(batch.map((message) => message.kind));
    if (batch.some((message) => message.kind === "catalog")) {
      return Response.json(
        { error: { code: rejectionStatus === 413 ? "envelope_too_large" : "invalid_aad", message: "Invalid data." } },
        { status: rejectionStatus },
      );
    }
    return Response.json({ accepted: true, ack_seq: 0 });
  };
  relay.enqueueRemoteMessages([
    { kind: "catalog", browser_id: BROWSER_ID },
    { kind: "heartbeat", device_id: DEVICE_ID, last_event_seq: 1 },
  ]);

  await relay.flushRemoteUploads();
  await waitFor(() => relay.uploading === false && relay.uploadQueue.length === 0);

  assert.deepEqual(batches, [
    ["catalog", "heartbeat"],
    ["catalog"],
    ["heartbeat"],
  ]);
  assert.equal(relay.ready, true);
  assert.ok(relay.rejectedUploadKeys.has(`catalog:${BROWSER_ID}`));
  assert.equal(relay.uploadKeys.size, 0);
});

}

async function sealedCommandFrame(key, command) {
  const aad = {
    direction: "web_to_relay",
    type: command.type,
    device_id: command.device_id,
    session_id: command.session_id ?? null,
    request_id: command.request_id,
    event_seq: null,
    created_at: command.issued_at,
    expires_at: command.expires_at,
  };
  return {
    browser_id: BROWSER_ID,
    device_id: command.device_id,
    session_id: command.session_id ?? null,
    request_id: command.request_id,
    command_type: command.type,
    aad,
    envelope: await sealJson(key, command, aad),
  };
}

function createFakePollingServer(state) {
  return createServer(async (request, response) => {
    try {
      state.authorizationHeaders.push(request.headers.authorization ?? null);
      if (request.headers.authorization !== `Bearer ${DEVICE_TOKEN}`) {
        sendJson(response, 401, {
          error: { message: "Invalid device token." },
        });
        return;
      }

      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "POST" && url.pathname === "/api/relay/hello") {
        state.helloBodies.push(await readJson(request));
        sendJson(response, 200, {
          ack_seq: 0,
          browser_authorizations: [
            { id: BROWSER_ID, key_id: state.browserKeyId },
          ],
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/relay/commands") {
        assert.equal(url.searchParams.get("device_id"), DEVICE_ID);
        const commands = state.commandsDelivered ? [] : state.commandFrames;
        state.commandsDelivered = true;
        sendJson(response, 200, {
          commands,
          ack_seq: 0,
          browser_authorizations: [
            { id: BROWSER_ID, key_id: state.browserKeyId },
          ],
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/relay/push") {
        state.pushedBodies.push(await readJson(request));
        // Keep ack_seq at zero so the encrypted event records remain in the
        // on-disk outbox and can be inspected by this test.
        sendJson(response, 200, { accepted: true, ack_seq: 0 });
        return;
      }
      sendJson(response, 404, { error: { message: "Not found." } });
    } catch (error) {
      sendJson(response, 500, {
        error: {
          message: error instanceof Error ? error.message : "Fake server error.",
        },
      });
    }
  });
}

async function decryptPushedMessages(key, state) {
  const decrypted = {
    catalogs: [],
    events: [],
    responses: [],
  };
  const messages = state.pushedBodies.flatMap((body) => body.messages ?? []);
  for (const message of messages) {
    if (!["catalog", "event", "response"].includes(message.kind)) continue;
    const plaintext = await openJson(key, message.envelope, message.aad);
    if (message.kind === "catalog") decrypted.catalogs.push(plaintext);
    if (message.kind === "event") decrypted.events.push(plaintext);
    if (message.kind === "response") decrypted.responses.push(plaintext);
  }
  return decrypted;
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await delay(20);
  }
  throw new Error("Timed out waiting for encrypted polling relay output.");
}

test('new client receives its encrypted catalog before an existing event replay drains', async () => {
  let releaseRuntimeInfo;
  const runtimeInfo = new Promise(resolve => { releaseRuntimeInfo = resolve; });
  const relay = new MacRelay({
    serverUrl: 'https://relay.test', deviceId: DEVICE_ID, adapter: {}, statePath: null,
    readAgentRuntimeInfo: () => runtimeInfo,
  });
  const key = generateE2eeKey();
  const keyId = await keyIdForKey(key);
  relay.activeBrowserKeys.set(BROWSER_ID, { browserId: BROWSER_ID, key, keyId });
  const encoding = relay.encodeRemoteMessage({
    type: 'relay.sync_sessions', sessions: [], projects: [], usage: {},
  });
  // Startup starts encoding the catalog before replaying the outbox, but
  // version probes can let thousands of old events reach the queue first.
  const events = Array.from({ length: 3000 }, (_, index) => ({
    kind: 'event', created_at: TRANSPORT_FIXTURE_TIME, browser_id: `old_browser_${index % 3}`,
    event_seq: Math.floor(index / 3) + 1,
  }));
  relay.enqueueRemoteMessages(events);
  const delivered = [];
  relay.remoteFetch = async (_path, options) => {
    delivered.push(...JSON.parse(options.body).messages);
    return Response.json({ accepted: true, ack_seq: 0 });
  };
  await relay.flushRemoteUploads();
  releaseRuntimeInfo([]);
  relay.enqueueRemoteMessages(await encoding);
  await relay.flushRemoteUploads();
  const catalog = delivered.find(message => message.kind === 'catalog');
  assert.ok(catalog, 'the next upload must include the first catalog');
  assert.ok(relay.uploadQueue.length > 0, 'history replay is still pending');
  assert.equal(catalog.browser_id, BROWSER_ID);
  assert.equal((await openJson(key, catalog.envelope, catalog.aad)).type, 'relay.sync_sessions');
  const remaining = [];
  while (relay.uploadQueue.length) remaining.push(...relay.takeUploadBatch(50).map(entry => entry.message));
  assert.deepEqual([...delivered, ...remaining].filter(message => message.kind === 'event'), events);
});

test('catalog priority is bounded and preserves complete per-event browser groups', () => {
  const relay = new MacRelay({ serverUrl: 'https://relay.test', adapter: {}, statePath: null });
  relay.enqueueRemoteMessages([
    ...Array.from({ length: 60 }, (_, index) => ({
      kind: 'event', created_at: TRANSPORT_FIXTURE_TIME, browser_id: `browser_${index % 3}`, event_seq: Math.floor(index / 3) + 1,
    })),
    ...Array.from({ length: 60 }, (_, index) => ({ kind: 'catalog', browser_id: `new_browser_${index}` })),
  ]);
  const first = relay.takeUploadBatch(50).map(entry => entry.message);
  assert.equal(first.filter(message => message.kind === 'catalog').length, 8);
  assert.equal(first.filter(message => message.kind === 'event').length, 42);
  for (let sequence = 1; sequence <= 14; sequence += 1) {
    assert.equal(first.filter(message => message.event_seq === sequence).length, 3);
  }
});

test('interactive history responses bypass an event backlog without dropping or reordering events', () => {
  const relay = new MacRelay({serverUrl: 'https://relay.test', adapter: {}, statePath: null});
  const events = Array.from({length: 3000}, (_, i) => ({
    kind: 'event', created_at: TRANSPORT_FIXTURE_TIME, browser_id: `browser_${i % 3}`, event_seq: Math.floor(i / 3) + 1,
  }));
  relay.enqueueRemoteMessages([...events,
    {kind: 'command_ack', request_id: 'history_request', status: 'accepted'},
    {kind: 'response', created_at: TRANSPORT_FIXTURE_TIME, request_id: 'history_request'},
  ]);
  const first = relay.takeUploadBatch(50);
  assert.deepEqual(first.slice(0, 2).map(entry => entry.message.kind), ['command_ack', 'response']);
  const collected = [...first];
  while (relay.uploadQueue.length) collected.push(...relay.takeUploadBatch(50));
  assert.deepEqual(collected.filter(entry => entry.message.kind === 'event').map(entry => entry.message), events);
  assert.equal(collected.length, 3002);
});

test('interactive priority leaves room for complete event groups under sustained responses', () => {
  const relay = new MacRelay({serverUrl: 'https://relay.test', adapter: {}, statePath: null});
  relay.enqueueRemoteMessages([
    ...Array.from({length: 6}, (_, i) => ({kind: 'event', created_at: TRANSPORT_FIXTURE_TIME, browser_id: `b${i % 3}`, event_seq: Math.floor(i / 3) + 1})),
    ...Array.from({length: 60}, (_, i) => ({kind: 'response', created_at: TRANSPORT_FIXTURE_TIME, request_id: `r${i}`})),
  ]);
  const first = relay.takeUploadBatch(50).map(entry => entry.message);
  assert.equal(first.filter(message => message.kind === 'event').length, 6);
  assert.equal(first[0].kind, 'response');
});


test('live events bypass other sessions replay without reordering their own session or splitting recipients', () => {
  const relay = new MacRelay({ serverUrl: 'https://relay.test', adapter: {}, statePath: null });
  const event = (seq, session) => Array.from({length: 9}, (_, i) => ({
    kind: 'event', created_at: TRANSPORT_FIXTURE_TIME, event_seq: seq, session_id: session, browser_id: `browser_${i}`,
  }));
  relay.enqueueRemoteMessages([...event(1, 'old'), ...event(2, 'current'), ...event(3, 'old')]);
  relay.enqueueRemoteMessages(event(4, 'current'), {live: true});
  const first = relay.takeUploadBatch(9).map(x => x.message);
  assert.deepEqual(first, event(2, 'current'), 'earlier same-session event precedes the new live event');
  const second = relay.takeUploadBatch(9).map(x => x.message);
  assert.deepEqual(second, event(4, 'current'));
  assert.deepEqual(relay.takeUploadBatch(50).map(x => x.message), [...event(1, 'old'), ...event(3, 'old')]);
});

test('only successful event batches are retired when the server cursor is stuck', async () => {
  const relay = new MacRelay({ serverUrl: 'https://relay.test', adapter: {}, statePath: null });
  const event = {kind: 'event', created_at: TRANSPORT_FIXTURE_TIME, event_seq: 5, browser_id: 'browser', session_id: 'session'};
  relay.outbox.pending.set(5, {event_seq: 5, variants: [event]});
  relay.enqueueRemoteMessages([event]);
  relay.scheduleUploadRetry = () => {};
  relay.remoteFetch = async () => Response.json({}, {status: 503});
  await relay.flushRemoteUploads();
  assert.equal(relay.outbox.pending.size, 1);
  assert.equal(relay.uploadQueue.length, 1);
  relay.remoteFetch = async () => Response.json({accepted: true, ack_seq: 0});
  await relay.flushRemoteUploads();
  assert.equal(relay.outbox.pending.size, 0);
  assert.equal(relay.outbox.lastAcked, 0, 'do not fabricate contiguous acknowledgement');
});


test('one active session with a large replay cannot starve another live session', () => {
  const relay = new MacRelay({ serverUrl: 'https://relay.test', adapter: {}, statePath: null });
  relay.enqueueRemoteMessages(Array.from({length: 1000}, (_, i) => ({
    kind: 'event', created_at: TRANSPORT_FIXTURE_TIME, event_seq: i + 1, browser_id: 'browser', session_id: 'busy',
  })));
  relay.enqueueRemoteMessages([
    {kind: 'event', created_at: TRANSPORT_FIXTURE_TIME, event_seq: 1001, browser_id: 'browser', session_id: 'busy'},
    {kind: 'event', created_at: TRANSPORT_FIXTURE_TIME, event_seq: 1002, browser_id: 'browser', session_id: 'interactive'},
  ], {live: true});
  assert.equal(relay.takeUploadBatch(1)[0].message.event_seq, 1);
  assert.equal(relay.takeUploadBatch(1)[0].message.event_seq, 1002);
});


test('successful uploads recover batch capacity before a historical backlog is empty', async () => {
  const relay = new MacRelay({ serverUrl: 'https://relay.test', adapter: {}, statePath: null });
  relay.uploadBatchLimit = 1;
  relay.enqueueRemoteMessages(Array.from({length: 100}, (_, i) => ({
    kind: 'event', created_at: TRANSPORT_FIXTURE_TIME, event_seq: i + 1, browser_id: 'browser', session_id: 'session',
  })));
  relay.remoteFetch = async () => Response.json({accepted: true, ack_seq: 0});
  await relay.flushRemoteUploads();
  assert.equal(relay.uploadBatchLimit, 2);
  await relay.flushRemoteUploads();
  assert.equal(relay.uploadBatchLimit, 4);
  assert.equal(relay.uploadQueue.length, 97);
});

test('[relay] stalled usage cannot block connection and catalog refresh, and shares one reader', async () => {
  let resolveUsage;
  let reads = 0;
  const usage = new Promise(resolve => { resolveUsage = resolve; });
  const relay = new MacRelay({
    serverUrl: 'https://example.invalid', usageCatalogTimeoutMs: 10,
    adapter: { readUsage: () => { reads++; return usage; } },
  });
  const sent = [];
  relay.readSessionCatalog = async () => [];
  relay.readProjectCatalog = async () => [];
  relay.send = message => { sent.push(message); return true; };
  try {
    await relay.handleMessage(JSON.stringify({ type: 'relay.connected', resume_cursor: 0 }));
    assert.equal(relay.ready, true);
    assert.deepEqual(sent[0].usage, {});
    await relay.syncSessionCatalog();
    assert.equal(sent.length, 2);
    assert.equal(reads, 1);
    resolveUsage({ codex: { daily: [] } });
    assert.deepEqual(await relay.readUsageCatalog(), { codex: { daily: [] } });
  } finally {
    clearInterval(relay.heartbeat);
    clearInterval(relay.sessionSyncTimer);
  }
});

test('live sessions use available batch capacity while historical replay still progresses', () => {
  const relay = new MacRelay({serverUrl: 'https://relay.test', adapter: {}, statePath: null});
  const event = (seq, session) => Array.from({length: 10}, (_, i) => ({
    kind: 'event', created_at: TRANSPORT_FIXTURE_TIME, event_seq: seq, session_id: session, browser_id: `b${i}`,
  }));
  relay.enqueueRemoteMessages(Array.from({length: 100}, (_, i) => event(i + 1, 'history')).flat());
  relay.enqueueRemoteMessages([event(101, 'S'), event(102, 'T'), event(103, 'S'), event(104, 'T')].flat(), {live: true});
  const batch = relay.takeUploadBatch(50).map(entry => entry.message);
  assert.equal(batch.filter(message => message.session_id !== 'history').length, 40);
  assert.equal(batch.filter(message => message.session_id === 'history').length, 10);
  for (const seq of new Set(batch.map(message => message.event_seq))) {
    assert.equal(batch.filter(message => message.event_seq === seq).length, 10);
  }
  assert.deepEqual(batch.filter(message => message.browser_id === 'b0').map(message => message.event_seq), [101, 102, 103, 104, 1]);
});

test('a stalled remote operation does not block another session stop or the next poll', async () => {
  const key = generateE2eeKey();
  const relay = new MacRelay({serverUrl: 'https://relay.test', adapter: {}, statePath: null, deviceId: DEVICE_ID});
  relay.ready = true;
  relay.activeBrowserKeys.set(BROWSER_ID, {browserId: BROWSER_ID, key});
  const command = (type, id, session) => ({type, request_id: id, device_id: DEVICE_ID,
    session_id: session, payload: {}, issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60000).toISOString()});
  const slow = await sealedCommandFrame(key, command('session.create', 'slow-create', null));
  const stop = await sealedCommandFrame(key, command('session.interrupt_turn', 'stop-T', 'T'));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const handled = [];
  relay.handleMessage = async raw => {
    const value = JSON.parse(raw); handled.push(value.request_id);
    if (value.request_id === 'slow-create') await gate;
  };
  let polls = 0;
  relay.remoteFetch = async () => new Response(JSON.stringify({commands: ++polls === 1 ? [slow] : [slow, stop]}));
  try {
    const first = relay.pollRemoteCommands();
    await delay(20);
    await relay.pollRemoteCommands();
    await delay(20);
    assert.deepEqual(handled, ['slow-create', 'stop-T']);
    assert.equal(polls, 2);
    release(); await first;
  } finally { release(); relay.closed = true; }
});

test('remote commands preserve session mutations while reads and stop remain independent', async () => {
  const relay = new MacRelay({serverUrl: 'https://relay.test', adapter: {}, statePath: null});
  const browser = {key: generateE2eeKey()}; relay.activeBrowserKeys.set(BROWSER_ID, browser);
  let release; const gate = new Promise(resolve => { release = resolve; }); const seen = [];
  relay.handleMessage = async raw => { const c = JSON.parse(raw); seen.push(c.request_id); if(c.request_id === 'configure') await gate; };
  const dispatch = (type, id) => relay.dispatchRemoteCommand({type, request_id:id, session_id:'S', browser_id:BROWSER_ID}, browser, Date.now());
  dispatch('session.configure','configure'); dispatch('session.submit_message','submit');
  dispatch('session.read_history','history'); dispatch('session.interrupt_turn','stop');
  await delay(0);
  assert.deepEqual([...seen].sort(),['configure','history','stop']);
  release(); await Promise.all(relay.remoteCommandTasks.values());
  assert.equal(seen.at(-1),'submit');
  assert.deepEqual([...seen].sort(),['configure','history','stop','submit']);
  assert.equal(relay.remoteCommandTasks.size,0); assert.equal(relay.remoteSessionCommands.size,0);
});

test('queued remote mutations do not execute after authorization revocation or shutdown', async () => {
  for (const close of [false,true]) {
    const relay = new MacRelay({serverUrl:'https://relay.test',adapter:{},statePath:null});
    const browser={key:generateE2eeKey()};relay.activeBrowserKeys.set(BROWSER_ID,browser);
    let release;const gate=new Promise(resolve=>{release=resolve;});const seen=[];
    relay.handleMessage=async raw=>{const c=JSON.parse(raw);seen.push(c.request_id);await gate;};
    for(const id of ['first','queued'])relay.dispatchRemoteCommand({type:'session.submit_message',request_id:id,session_id:'S',browser_id:BROWSER_ID},browser,Date.now());
    await delay(0);
    if(close)relay.closed=true;else relay.activeBrowserKeys.clear();
    release();await Promise.all(relay.remoteCommandTasks.values());
    assert.deepEqual(seen,['first']);
  }
});

test('recent client interaction reserves capacity among 19 live streams with 12 recipients', async () => {
  const relay = new MacRelay({serverUrl: 'https://relay.test', adapter: {}, statePath: null, deviceId: 'device'});
  relay.deviceId = 'device';
  relay.readHistory = async () => {};
  await relay.handleMessage(JSON.stringify({type: 'session.read_history', session_id: 'watched',
    device_id: 'device', request_id: 'read', expires_at: new Date(Date.now() + 60_000).toISOString()}));
  const event = (seq, session) => Array.from({length: 12}, (_, i) => ({
    kind: 'event', created_at: TRANSPORT_FIXTURE_TIME, event_seq: seq, session_id: session, browser_id: `browser_${i}`,
  }));
  let seq = 1;
  for (let i = 0; i < 18; i++) relay.enqueueRemoteMessages(event(seq++, `background_${i}`), {live: true});
  const watched = [event(seq++, 'watched'), event(seq++, 'watched'), event(seq++, 'watched')];
  relay.enqueueRemoteMessages(watched.flat(), {live: true});
  const first = relay.takeUploadBatch(50).map(entry => entry.message);
  assert.deepEqual(first.filter(message => message.session_id === 'watched'), watched.slice(0, 2).flat());
  assert.ok(first.some(message => message.session_id.startsWith('background_')), 'background still progresses');
  const second = relay.takeUploadBatch(50).map(entry => entry.message);
  assert.deepEqual(second.filter(message => message.session_id === 'watched'), watched[2]);
  assert.equal(first.length, 48, 'recipient groups remain complete');
});

test('expired and invalid client commands cannot retain interactive priority', async () => {
  const relay = new MacRelay({serverUrl: 'https://relay.test', adapter: {}, statePath: null});
  relay.deviceId = 'device';
  relay.readHistory = async () => {};
  await relay.handleMessage(JSON.stringify({type: 'session.read_history', session_id: 'invalid',
    device_id: 'other', request_id: 'read', expires_at: new Date(Date.now() + 60_000).toISOString()}));
  assert.equal(relay.interactiveSessions.size, 0);
  relay.interactiveSessions.set('expired', Date.now() - 1);
  relay.enqueueRemoteMessages([
    {kind: 'event', created_at: TRANSPORT_FIXTURE_TIME, event_seq: 1, session_id: 'background', browser_id: 'b'},
    {kind: 'event', created_at: TRANSPORT_FIXTURE_TIME, event_seq: 2, session_id: 'expired', browser_id: 'b'},
  ]);
  assert.equal(relay.takeUploadBatch(1)[0].message.event_seq, 1);
  assert.equal(relay.interactiveSessions.size, 0);
});

test('catalog backlog cannot starve a live event after rejection shrinks batches', () => {
  const relay = new MacRelay({serverUrl: 'https://relay.test', deviceId: DEVICE_ID,
    deviceToken: DEVICE_TOKEN, browserKeys: [], adapter: {}, statePath: null});
  relay.enqueueRemoteMessages(Array.from({length: 13}, (_, i) =>
    ({kind: 'catalog', browser_id: `web_backlog_${i}`})));
  relay.enqueueRemoteMessages([{kind: 'event', created_at: TRANSPORT_FIXTURE_TIME, browser_id: BROWSER_ID,
    session_id: 'session_interactive', event_seq: 1}], {live: true});
  const first = relay.takeUploadBatch(1);
  const second = relay.takeUploadBatch(1);
  assert.ok([...first, ...second].some(entry => entry.message.kind === 'event'));
});

for (const provider of ["pi", "uninstalled-agent"]) {
  test(`session creation preserves explicit provider: ${provider}`, async () => {
    const calls = [], sent = [];
    const relay = new MacRelay({ serverUrl: "https://relay.test", deviceId: DEVICE_ID,
      deviceToken: DEVICE_TOKEN, browserKeys: [], statePath: null,
      adapter: { createSession: async (options) => {
        calls.push(options); return { id: "pi_test", ...options };
      }, listSessions: async () => [] },
    });
    relay.validateCommand = () => true;
    relay.outbox.hasProcessedRequest = () => false;
    relay.outbox.markProcessedRequest = async () => {};
    relay.send = message => { sent.push(message); return true; };
    relay.emitEvent = async () => {};
    await relay.createSession({ type: "session.create", request_id: "provider-test",
      payload: { cwd: "/workspace", name: "test", provider } });
    await Promise.allSettled([...relay.operations]);
    if (provider === "pi") {
      assert.equal(calls[0].provider, "pi");
      assert.equal(sent.find(m => m.type === "session.create_result").session.provider, "pi");
    } else {
      assert.equal(calls.length, 0);
      assert.ok(sent.some(m => m.type === "session.create_error"));
    }
  });
}

test('negotiated command wait starts promptly, renews immediately, and aborts on stop', async () => {
  const relay = new MacRelay({serverUrl: 'https://relay.test', adapter: {close: async () => {}},
    statePath: null, pollIntervalMs: 10_000});
  relay.handleMessage = async () => { relay.ready = true; };
  relay.flushRemoteUploads = async () => {};
  const polls = [];
  let release;
  let aborted = false;
  relay.remoteFetch = async (path, options) => {
    if (path === '/api/relay/hello') return Response.json({command_wait_ms: 20_000, browser_authorizations: []});
    polls.push(path);
    if (polls.length === 1) return Response.json({commands: [], browser_authorizations: []});
    return new Promise((resolve, reject) => {
      release = () => resolve(Response.json({commands: [], browser_authorizations: []}));
      options.signal.addEventListener('abort', () => { aborted = true; reject(options.signal.reason); }, {once: true});
    });
  };
  try {
    await relay.connectPolling();
    assert.equal(polls[0].includes('wait_ms'), false, 'startup must not wait for a command');
    await waitFor(() => polls.length === 2);
    assert.match(polls[1], /wait_ms=20000/);
    release();
    await waitFor(() => polls.length === 3);
    assert.equal(relay.polling, true);
    await relay.stop();
    await delay(10);
    assert.equal(aborted, true);
    assert.equal(polls.length, 3);
    assert.equal(relay.reconnectAttempt, 0);
  } finally { if (!relay.closed) await relay.stop(); }
});

test('old servers keep bounded polling instead of an empty-response busy loop', async () => {
  const relay = new MacRelay({serverUrl: 'https://relay.test', adapter: {close: async () => {}},
    statePath: null, pollIntervalMs: 750});
  relay.handleMessage = async () => { relay.ready = true; };
  relay.flushRemoteUploads = async () => {};
  let polls = 0;
  relay.remoteFetch = async path => Response.json(path === '/api/relay/hello'
    ? {browser_authorizations: []} : (++polls, {commands: [], browser_authorizations: []}));
  try {
    await relay.connectPolling();
    await delay(40);
    assert.equal(relay.commandWaitMs, 0);
    assert.equal(polls, 1);
  } finally { await relay.stop(); }
});

test('failed command waits use reconnect backoff instead of immediate retry', async () => {
  const relay = new MacRelay({serverUrl: 'https://relay.test', adapter: {close: async () => {}}, statePath: null});
  relay.ready = true;
  relay.commandPolling = true;
  relay.commandWaitMs = 20_000;
  let reconnects = 0;
  relay.remoteFetch = async () => { throw new Error('synthetic network failure'); };
  relay.schedulePollingReconnect = () => { reconnects++; };
  try {
    assert.equal(await relay.pollRemoteCommands(), false);
    assert.equal(relay.ready, false);
    assert.equal(relay.polling, false);
    assert.equal(relay.pollTimer, null);
    assert.equal(reconnects, 1);
  } finally { await relay.stop(); }
});

test('superseded command waits honor server backoff', async () => {
  const relay = new MacRelay({serverUrl: 'https://relay.test', adapter: {close: async () => {}}, statePath: null});
  relay.ready = true;
  relay.commandPolling = true;
  relay.commandWaitMs = 20_000;
  let polls = 0;
  relay.remoteFetch = async () => {
    polls++;
    return Response.json({commands: [], browser_authorizations: [], poll_retry_after_ms: 750});
  };
  try {
    await relay.pollRemoteCommands();
    await delay(40);
    assert.equal(polls, 1);
  } finally { await relay.stop(); }
});
