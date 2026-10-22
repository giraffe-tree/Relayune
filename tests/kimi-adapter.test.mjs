import { fakeKimiHistory } from './fixtures/kimi-history.mjs';
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  KimiCodeAdapter,
  kimiAgentDetailsFromWire,
  kimiAgentsFromUpdates,
  historyMessagesFromKimiUpdates,
  readKimiDailyUsage,
  readKimiSessionExecutionSnapshots,
} from "../relay/kimi-adapter.mjs";

const fixture = fileURLToPath(
  new URL("./fixtures/fake-kimi-acp.mjs", import.meta.url),
);

function localDate(timestamp) {
  const date = new Date(timestamp);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

test("Kimi resume publishes advertised settings before the next turn", async () => {
  const events = [];
  const adapter = new KimiCodeAdapter({
    kimiBin: process.execPath,
    kimiArgs: [fixture],
    historyReader: fakeKimiHistory,
    workspace: process.cwd(),
  });
  await adapter.start({
    emitEvent: async (sessionId, event) => events.push({ sessionId, event }),
    requestApproval: async () => {},
  });
  try {
    await adapter.ensureSessionActive("kimi_existing");
    const updates = events.filter(({ event }) => event.kind === "session.config_updated");
    assert.equal(updates.length, 1);
    assert.equal(updates[0].sessionId, "kimi_existing");
    assert.equal(updates[0].event.provider, "kimi");
    assert.deepEqual(updates[0].event.config_options.map(({ id }) => id), ["model", "thinking", "mode"]);
    assert.equal(updates[0].event.config_options.find(({ id }) => id === "thinking").currentValue, "max");
    await adapter.ensureSessionActive("kimi_existing");
    assert.equal(events.filter(({ event }) => event.kind === "session.config_updated").length, 1);
  } finally {
    await adapter.close();
  }
});

test("Kimi forwards changed native configuration once and omits native extras", async () => {
  const events = [];
  const adapter = new KimiCodeAdapter({ kimiBin: process.execPath, kimiArgs: [fixture] });
  adapter.handlers = { emitEvent: async (sessionId, event) => events.push({ sessionId, event }) };
  const configOptions = [{
    id: "thinking", name: "Thinking", type: "select", currentValue: "high",
    options: [{ value: "high", name: "High" }, { value: "max", name: "Max" }],
    nativeSecret: "private-native-field",
  }];
  const notification = { method: "session/update", params: {
    sessionId: "owned-config-session", update: { sessionUpdate: "config_option_update", configOptions },
  } };
  await adapter.handleNotification(notification);
  await adapter.handleNotification(notification);
  configOptions[0].currentValue = "max";
  await adapter.handleNotification(notification);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(({ event }) => event.config_options[0].currentValue), ["high", "max"]);
  assert.doesNotMatch(JSON.stringify(events), /private-native-field|nativeSecret/);
  assert.ok(events.every(({ event }) => !Object.hasOwn(event, "turn_id")));
});

test("Kimi history replay maps user and assistant messages without thoughts", () => {
  const messages = historyMessagesFromKimiUpdates(
    "kimi_history",
    [
      {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "question" },
      },
      {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "hidden chain of thought" },
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "answer" },
      },
    ],
    "2026-07-29T10:00:00.000Z",
  );

  assert.deepEqual(
    messages.map(({ role, content, provider }) => ({
      role,
      content,
      provider,
    })),
    [
      { role: "user", content: "question", provider: "kimi" },
      { role: "codex", content: "answer", provider: "kimi" },
    ],
  );
  assert.equal(messages[0].turn_id, messages[1].turn_id);
  assert.doesNotMatch(JSON.stringify(messages), /chain of thought/);
});

test("Kimi AgentSwarm updates expand into stable child agent cards", () => {
  const agents = kimiAgentsFromUpdates(
    "kimi_swarm",
    [
      {
        sessionUpdate: "tool_call",
        toolCallId: "12:tool-swarm",
        title: "AgentSwarm",
        status: "in_progress",
        rawInput: {
          subagent_type: "coder",
          items: [
            "中文名=银杏 | slug=ginkgo",
            "中文名=红杉 | slug=redwood",
          ],
        },
      },
    ],
    "2026-07-31T09:00:00.000Z",
  );

  assert.equal(agents.length, 2);
  assert.deepEqual(agents.map(({ name, status }) => ({ name, status })), [
    { name: "银杏", status: "running" },
    { name: "红杉", status: "running" },
  ]);
  assert.ok(agents.every((agent) => agent.can_open === false));
});

test("Kimi local wire state reports progress and terminal summaries", () => {
  const wire = [
    { type: "metadata", created_at: 1785489051691 },
    {
      type: "config.update",
      profileName: "coder",
      modelAlias: "kimi-code/k3",
      thinkingEffort: "max",
      time: 1785489051772,
    },
    {
      type: "turn.prompt",
      input: [{ type: "text", text: "Build the ginkgo preset" }],
      time: 1785489051775,
    },
    {
      type: "permission.set_mode",
      mode: "auto",
      time: 1785489051800,
    },
    {
      type: "swarm_mode.enter",
      time: 1785489051900,
    },
    {
      type: "usage.record",
      usageScope: "turn",
      usage: {
        inputOther: 20_000,
        inputCacheRead: 70_000,
        inputCacheCreation: 8_000,
        output: 20_000,
      },
      time: 1785489052000,
    },
    {
      type: "tools.update_store",
      key: "todo",
      value: [
        { title: "Implement", status: "done" },
        { title: "Verify", status: "done" },
      ],
      time: 1785489060000,
    },
    {
      type: "context.append_loop_event",
      event: { type: "step.begin" },
      time: 1785489061000,
    },
    {
      type: "context.append_loop_event",
      event: {
        type: "tool.call",
        name: "Edit",
        args: { path: "tree-web/src/app/main.ts" },
      },
      time: 1785489061500,
    },
    {
      type: "context.append_loop_event",
      event: { type: "content.part", part: { type: "text", text: "Preset verified." } },
      time: 1785489062000,
    },
    {
      type: "context.append_loop_event",
      event: { type: "step.end", finishReason: "end_turn" },
      time: 1785489063000,
    },
  ].map((record) => JSON.stringify(record)).join("\n");

  const details = kimiAgentDetailsFromWire(wire);
  assert.equal(details.status, "completed");
  assert.equal(details.progress, 100);
  assert.equal(details.role, "coder");
  assert.equal(details.model, "kimi-code/k3");
  assert.equal(details.summary, "Preset verified.");
  assert.equal(details.toolCount, 1);
  assert.equal(details.currentActivity, "Edit · tree-web/src/app/main.ts");
  assert.equal(details.contextTokens, 98_000);
  assert.equal(details.tokenCount, 118_000);
  assert.equal(details.permissionMode, "auto");
  assert.equal(details.swarmMode, true);
  assert.deepEqual(
    details.activityLog.map(({ kind, label }) => ({ kind, label })),
    [
      { kind: "status", label: "已接收子任务" },
      { kind: "progress", label: "计划进度 2/2" },
      { kind: "status", label: "开始处理" },
      { kind: "tool", label: "Edit · tree-web/src/app/main.ts" },
      { kind: "status", label: "子任务处理完成" },
    ],
  );
  assert.doesNotMatch(JSON.stringify(details.activityLog), /Preset verified/);
});

test("Kimi daily usage sums main and subagent turn records without mirrored events", async () => {
  const kimiHome = await mkdtemp(join(tmpdir(), "relayune-kimi-usage-"));
  const sessionId = "kimi_usage";
  const sessionDir = join(kimiHome, "sessions", "workspace", sessionId);
  const mainDir = join(sessionDir, "agents", "main");
  const childDir = join(sessionDir, "agents", "agent-1");
  const now = Date.parse("2026-09-02T12:00:00.000Z");
  const previous = now - 24 * 60 * 60_000;
  await mkdir(mainDir, { recursive: true });
  await mkdir(childDir, { recursive: true });
  await writeFile(
    join(kimiHome, "session_index.jsonl"),
    `${JSON.stringify({ sessionId, sessionDir })}\n`,
  );
  const mainWire = join(mainDir, "wire.jsonl");
  const childWire = join(childDir, "wire.jsonl");
  await writeFile(
    mainWire,
    `${[
      {
        type: "usage.record",
        usageScope: "turn",
        time: now,
        usage: {
          inputOther: 10,
          inputCacheRead: 20,
          inputCacheCreation: 30,
          output: 40,
        },
      },
      {
        type: "context.append_loop_event",
        time: now,
        event: {
          type: "step.end",
          usage: {
            inputOther: 10,
            inputCacheRead: 20,
            inputCacheCreation: 30,
            output: 40,
          },
        },
      },
      {
        type: "usage.record",
        usageScope: "turn",
        time: now,
        usage: {
          inputOther: 1,
          inputCacheRead: 2,
          inputCacheCreation: 3,
          output: 4,
        },
      },
      {
        type: "usage.record",
        usageScope: "session",
        time: now,
        usage: {
          inputOther: 500,
          inputCacheRead: 0,
          inputCacheCreation: 0,
          output: 0,
        },
      },
      {
        type: "usage.record",
        usageScope: "turn",
        time: previous,
        usage: {
          inputOther: 5,
          inputCacheRead: 5,
          inputCacheCreation: 5,
          output: 5,
        },
      },
      {
        type: "usage.record",
        usageScope: "turn",
        time: previous,
        usage: {
          inputOther: -1,
          inputCacheRead: 0,
          inputCacheCreation: 0,
          output: 0,
        },
      },
    ].map(JSON.stringify).join("\n")}\n`,
  );
  await writeFile(
    childWire,
    `${JSON.stringify({
      type: "usage.record",
      usageScope: "turn",
      time: now,
      usage: {
        inputOther: 7,
        inputCacheRead: 7,
        inputCacheCreation: 7,
        output: 7,
      },
    })}\n`,
  );
  await utimes(mainWire, new Date(now), new Date(now));
  await utimes(childWire, new Date(now), new Date(now));

  try {
    const expected = [
      { date: localDate(previous), total_tokens: 20 },
      { date: localDate(now), total_tokens: 138 },
    ].sort((left, right) => left.date.localeCompare(right.date));
    assert.deepEqual(await readKimiDailyUsage({ kimiHome, now }), expected);
    assert.deepEqual(await readKimiDailyUsage({ kimiHome, now }), expected);
  } finally {
    await rm(kimiHome, { recursive: true, force: true });
  }
});

test("Kimi adapter reads usage from its configured local data directory", async () => {
  const calls = [];
  const adapter = new KimiCodeAdapter({
    kimiHome: "/tmp/relayune-kimi-home",
    usageReader: async (options) => {
      calls.push(options);
      return [];
    },
  });

  const usage = await adapter.readUsage();

  assert.equal(usage.kimi.source, "local_wire");
  assert.deepEqual(calls, [{ kimiHome: "/tmp/relayune-kimi-home" }]);
  await adapter.close();
});

test("Kimi session execution snapshot uses the latest unfinished turn start", async () => {
  const kimiHome = await mkdtemp(join(tmpdir(), "agent-relay-kimi-state-"));
  const sessionId = "kimi_running_session";
  const sessionDir = join(kimiHome, "sessions", "workspace", sessionId);
  try {
    await mkdir(join(sessionDir, "agents", "main"), { recursive: true });
    await writeFile(
      join(kimiHome, "session_index.jsonl"),
      `${JSON.stringify({ sessionId, sessionDir })}\n`,
    );
    await writeFile(
      join(sessionDir, "agents", "main", "wire.jsonl"),
      [
        { type: "metadata", created_at: 1785480000000 },
        {
          type: "turn.prompt",
          input: [{ type: "text", text: "old completed task" }],
          time: 1785480100000,
        },
        {
          type: "context.append_loop_event",
          event: { type: "step.begin" },
          time: 1785480100001,
        },
        {
          type: "context.append_loop_event",
          event: { type: "step.end", finishReason: "end_turn" },
          time: 1785480110000,
        },
        {
          type: "turn.prompt",
          input: [{ type: "text", text: "current task" }],
          time: 1785492884012,
        },
        {
          type: "context.append_loop_event",
          event: { type: "step.begin" },
          time: 1785492884013,
        },
      ].map((record) => JSON.stringify(record)).join("\n"),
    );

    const snapshots = await readKimiSessionExecutionSnapshots({
      sessionIds: [sessionId],
      kimiHome,
      now: 1785492944013,
    });
    assert.deepEqual(snapshots.get(sessionId), {
      status: "active",
      turn_status: "running",
      fork_tail_safe: false,
      running_started_at: new Date(1785492884012).toISOString(),
      updated_at: new Date(1785492884013).toISOString(),
      role: null,
      model: null,
      reasoning_effort: null,
      permission_mode: null,
      swarm_mode: false,
      usage: null,
    });
  } finally {
    await rm(kimiHome, { recursive: true, force: true });
  }
});

test("Kimi session execution snapshot does not revive stale unfinished turns", async () => {
  const kimiHome = await mkdtemp(join(tmpdir(), "agent-relay-kimi-stale-"));
  const sessionId = "kimi_stale_session";
  const sessionDir = join(kimiHome, "sessions", "workspace", sessionId);
  try {
    await mkdir(join(sessionDir, "agents", "main"), { recursive: true });
    await writeFile(
      join(kimiHome, "session_index.jsonl"),
      `${JSON.stringify({ sessionId, sessionDir })}\n`,
    );
    await writeFile(
      join(sessionDir, "state.json"),
      JSON.stringify({ updatedAt: "2026-07-30T10:00:00.000Z" }),
    );
    await writeFile(
      join(sessionDir, "agents", "main", "wire.jsonl"),
      [
        { type: "metadata", created_at: 1785390000000 },
        { type: "turn.prompt", time: 1785390010000 },
        {
          type: "context.append_loop_event",
          event: { type: "step.begin" },
          time: 1785390010001,
        },
      ].map((record) => JSON.stringify(record)).join("\n"),
    );

    const snapshots = await readKimiSessionExecutionSnapshots({
      sessionIds: [sessionId],
      kimiHome,
      now: Date.parse("2026-07-31T10:00:00.000Z"),
      activeFreshnessMs: 15 * 60_000,
    });
    assert.equal(snapshots.get(sessionId).status, "idle");
    assert.equal(snapshots.get(sessionId).running_started_at, null);
  } finally {
    await rm(kimiHome, { recursive: true, force: true });
  }
});

test("[MOB-AGT-004][web] Kimi session stays active while a fresh child agent continues a stale main turn", async () => {
  const kimiHome = await mkdtemp(join(tmpdir(), "agent-relay-kimi-child-live-"));
  const sessionId = "kimi_child_live_session";
  const sessionDir = join(kimiHome, "sessions", "workspace", sessionId);
  const turnStartedAt = Date.parse("2026-07-31T09:00:00.000Z");
  const now = Date.parse("2026-07-31T10:00:00.000Z");
  try {
    await mkdir(join(sessionDir, "agents", "main"), { recursive: true });
    await mkdir(join(sessionDir, "agents", "agent-1"), { recursive: true });
    await writeFile(
      join(kimiHome, "session_index.jsonl"),
      `${JSON.stringify({ sessionId, sessionDir })}\n`,
    );
    await writeFile(
      join(sessionDir, "state.json"),
      JSON.stringify({
        updatedAt: "2026-07-31T09:02:00.000Z",
        agents: {
          main: { type: "main" },
          "agent-1": { type: "sub", swarmItem: "long child task" },
        },
      }),
    );
    await writeFile(
      join(sessionDir, "agents", "main", "wire.jsonl"),
      [
        { type: "metadata", created_at: turnStartedAt - 60_000 },
        { type: "turn.prompt", time: turnStartedAt },
        {
          type: "context.append_loop_event",
          event: { type: "step.begin" },
          time: turnStartedAt + 1,
        },
      ].map((record) => JSON.stringify(record)).join("\n"),
    );
    await writeFile(
      join(sessionDir, "agents", "agent-1", "wire.jsonl"),
      [
        { type: "metadata", created_at: now - 10 * 60_000 },
        { type: "turn.prompt", time: now - 10 * 60_000 },
        {
          type: "context.append_loop_event",
          event: { type: "step.begin" },
          time: now - 1_000,
        },
      ].map((record) => JSON.stringify(record)).join("\n"),
    );

    const snapshots = await readKimiSessionExecutionSnapshots({
      sessionIds: [sessionId],
      kimiHome,
      now,
      activeFreshnessMs: 30 * 60_000,
    });
    assert.deepEqual(snapshots.get(sessionId), {
      status: "active",
      turn_status: "running",
      fork_tail_safe: false,
      running_started_at: new Date(turnStartedAt).toISOString(),
      updated_at: new Date(now - 1_000).toISOString(),
      role: null,
      model: null,
      reasoning_effort: null,
      permission_mode: null,
      swarm_mode: false,
      usage: null,
    });
  } finally {
    await rm(kimiHome, { recursive: true, force: true });
  }
});

test("[KIMI-ACP-005] Kimi ACP adapter lists, loads, prompts, approves, images, Swarm, and streams", async () => {
  const events = [];
  const approvals = [];
  const adapter = new KimiCodeAdapter({
    kimiBin: process.execPath,
    kimiArgs: [fixture],
    historyReader: fakeKimiHistory,
    workspace: process.cwd(),
  });
  await adapter.start({
    emitEvent: async (sessionId, event) => {
      events.push({ sessionId, event });
    },
    requestApproval: async (approval) => {
      approvals.push(approval);
    },
  });

  try {
    const sessions = await adapter.listSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].provider, "kimi");
    assert.equal(sessions[0].name, "Existing Kimi session");

    const history = await adapter.readHistory({
      sessionId: "kimi_existing",
      limit: 100,
    });
    assert.deepEqual(
      history.messages.map(({ role, content }) => ({ role, content })),
      [
        { role: "user", content: "historical question" },
        { role: "codex", content: "historical answer" },
      ],
    );
    assert.doesNotMatch(JSON.stringify(history), /private reasoning/);
    assert.equal(history.agents.length, 2);
    assert.ok(history.agents.every((agent) => agent.status === "completed"));
    assert.equal(history.sessions[0].status, "idle");
    assert.equal(history.sessions[0].can_interrupt, false);

    const configured = await adapter.configureSession({
      sessionId: "kimi_existing",
      configId: "mode",
      value: "plan",
    });
    assert.equal(
      configured.configOptions.find((option) => option.id === "mode").currentValue,
      "plan",
    );
    const configuredSession = (await adapter.listSessions()).find(
      (session) => session.id === "kimi_existing",
    );
    assert.equal(
      configuredSession.kimi_config_options.find((option) => option.id === "mode")
        .currentValue,
      "plan",
    );
    assert.equal(configuredSession.kimi_commands[0].name, "usage");
    await assert.rejects(
      adapter.configureSession({
        sessionId: "kimi_existing",
        configId: "mode",
        value: "invented",
      }),
      /did not advertise the selected mode value/,
    );

    const created = await adapter.createSession({
      cwd: "/workspace/project",
      name: "Remote Kimi",
    });
    assert.equal(created.provider, "kimi");
    assert.equal(created.sync_state, "persisted");

    const submitted = await adapter.submitMessage({
      sessionId: "kimi_existing",
      requestId: "req_kimi_test",
      content: "run the tests",
      attachments: [
        {
          id: "upload_kimi_test",
          name: "upload.png",
          mime_type: "image/png",
          base64: "iVBORw0KGgo=",
          dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        },
      ],
    });
    assert.equal(submitted.mode, "started");
    await waitFor(() => approvals.length === 1);
    const runningSession = (await adapter.listSessions()).find(
      (session) => session.id === "kimi_existing",
    );
    assert.equal(runningSession.status, "active");
    assert.equal(runningSession.can_interrupt, true);
    assert.ok(Number.isFinite(Date.parse(runningSession.running_started_at)));
    assert.equal(approvals[0].action.type, "command.execute");
    assert.match(approvals[0].action.display, /npm test/);
    assert.deepEqual(
      approvals[0].action.options.map((option) => option.option_id),
      ["approve_once", "approve_always", "reject"],
    );

    await adapter.resolveApproval({
      approvalId: approvals[0].approval_id,
      decision: "approved",
      optionId: "approve_once",
    });
    await waitFor(() =>
      events.some(({ event }) => event.kind === "turn.completed"),
    );

    const kinds = events.map(({ event }) => event.kind);
    assert.ok(kinds.includes("turn.started"));
    assert.ok(kinds.includes("command.started"));
    assert.ok(kinds.includes("command.output"));
    assert.ok(kinds.includes("agent.updated"));
    assert.ok(kinds.includes("agent.completed"));
    assert.ok(kinds.includes("message.delta"));
    assert.ok(kinds.includes("message.completed"));
    assert.ok(kinds.includes("turn.completed"));
    const commandOutputs = events.filter(
      ({ event }) =>
        event.kind === "command.output" && event.item_id === "1:tool-1",
    );
    assert.equal(commandOutputs.length, 1);
    assert.doesNotMatch(
      JSON.stringify(commandOutputs),
      /\{\\"command\\":\\"npm test/,
    );
    assert.equal(
      events.find(({ event }) => event.kind === "message.completed").event.text,
      "Kimi finished.",
    );
    const agentEvents = events.filter(({ event }) =>
      event.kind.startsWith("agent."),
    );
    assert.equal(
      agentEvents.filter(({ event }) => event.kind === "agent.updated").length,
      2,
    );
    assert.equal(
      agentEvents.filter(({ event }) => event.kind === "agent.completed").length,
      2,
    );
  } finally {
    await adapter.close();
  }
});

async function waitFor(predicate, timeoutMs = 3_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for Kimi adapter test state.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
