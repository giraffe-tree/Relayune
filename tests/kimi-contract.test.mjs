import { fakeKimiHistory } from './fixtures/kimi-history.mjs';
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { KimiCodeAdapter } from "../relay/kimi-adapter.mjs";

const fixture = fileURLToPath(
  new URL("./fixtures/fake-kimi-acp.mjs", import.meta.url),
);

async function startHarness({ scenario, adapterOptions = {} } = {}) {
  const events = [];
  const approvals = [];
  const adapter = new KimiCodeAdapter({
    kimiBin: process.execPath,
    kimiArgs: scenario ? [fixture, scenario] : [fixture],
    workspace: process.cwd(),
    historyReader: fakeKimiHistory,
    agentStateReader: async () => [],
    sessionStateReader: async () => new Map(),
    ...adapterOptions,
  });
  await adapter.start({
    emitEvent: async (sessionId, event) => {
      events.push({ sessionId, event });
    },
    requestApproval: async (approval) => {
      approvals.push(approval);
    },
  });
  return { adapter, events, approvals };
}

test("Kimi rejects simultaneous sends while a session is loading", async () => {
  const { adapter, events } = await startHarness();
  let release;
  const loading = new Promise(resolve => { release = resolve; });
  const ensureActive = adapter.ensureSessionActive.bind(adapter);
  adapter.ensureSessionActive = async id => { await loading; return ensureActive(id); };
  try {
    const first = adapter.submitMessage({ sessionId: "kimi_existing", requestId: "first", content: "first message" });
    const second = adapter.submitMessage({ sessionId: "kimi_existing", requestId: "second", content: "second message" });
    const outcomes = Promise.allSettled([first, second]);
    release();
    const results = await outcomes;
    assert.equal(results[0].status, "fulfilled");
    assert.equal(results[1].status, "rejected", "a concurrent message must not overwrite the active turn");
    assert.match(results[1].reason.message, /stop it before sending another message/);
    assert.equal(events.filter(({ event }) => event.kind === "turn.started").length, 1);
  } finally { release(); await adapter.close(); }
});

test("Kimi permission cards retain command and diff content when rawInput is omitted", async () => {
  const { adapter, approvals } = await startHarness();
  try {
    for (const [id, toolCall, expected] of [
      [901, { title: "Bash", content: [{ type: "content", content: { type: "text", text: "printf test > result.txt" } }] }, /printf test > result\.txt/],
      [902, { title: "WriteFile", content: [{ type: "diff", path: "/workspace/file.txt", oldText: "old", newText: "new" }] }, /\/workspace\/file\.txt\nold\nnew/],
    ]) {
      await adapter.handleServerRequest({ id, method: "session/request_permission", params: {
        sessionId: "kimi_existing", toolCall: { toolCallId: `tool-${id}`, ...toolCall },
        options: [{ optionId: "approve", name: "Approve once", kind: "allow_once" }, { optionId: "reject", name: "Reject", kind: "reject_once" }],
      } });
      assert.match(approvals.at(-1).action.display, expected);
    }
  } finally { await adapter.close(); }
});

test("Kimi releases failed startup reservations and does not send after close", async () => {
  const { adapter, events } = await startHarness();
  const ensureActive = adapter.ensureSessionActive.bind(adapter);
  try {
    adapter.ensureSessionActive = async () => { throw new Error("load failed"); };
    const payload = { sessionId: "kimi_existing", requestId: "retry", content: "hello" };
    await assert.rejects(adapter.submitMessage(payload), /load failed/);
    adapter.ensureSessionActive = ensureActive;
    await adapter.submitMessage(payload);
    assert.equal(events.filter(({ event }) => event.kind === "turn.started").length, 1);
  } finally { await adapter.close(); }
  await assert.rejects(adapter.submitMessage({ sessionId: "kimi_existing", content: "late" }), /adapter is closed/);
});

test("Kimi closing during session load prevents a late prompt", async () => {
  const { adapter, events } = await startHarness();
  let release;
  adapter.ensureSessionActive = () => new Promise(resolve => { release = resolve; });
  const pending = adapter.submitMessage({ sessionId: "kimi_existing", requestId: "late", content: "hello" });
  const rejected = assert.rejects(pending, /adapter is closed/);
  await adapter.close();
  release();
  await rejected;
  assert.equal(events.filter(({ event }) => event.kind === "turn.started").length, 0);
});

test("Kimi interruption invalidates pending approvals without touching another session", async () => {
  const { adapter, events, approvals } = await startHarness();
  try {
    await adapter.submitMessage({ sessionId: "kimi_existing", requestId: "interrupt", content: "approval" });
    await waitFor(() => approvals.length === 1);
    const approvalId = approvals[0].approval_id;
    adapter.pendingApprovals.set("other", { sessionId: "other-session", rpcId: 1234 });
    await adapter.interruptTurn({ sessionId: "kimi_existing" });
    await waitFor(() => events.some(({ event }) => event.kind === "turn.completed" && event.status === "interrupted"));
    assert.equal(adapter.pendingApprovals.has(approvalId), false);
    assert.ok(events.some(({ event }) => event.kind === "approval.resolved" && event.approval_id === approvalId && event.decision === "expired"));
    assert.ok(!events.some(({ event }) => event.kind === "approval.resolved" && event.approval_id === "other"));
    assert.equal(adapter.pendingApprovals.has("other"), true);
    await assert.rejects(adapter.resolveApproval({ approvalId, decision: "approved" }), /no longer pending/);
  } finally { adapter.pendingApprovals.delete("other"); await adapter.close(); }
});

test("[KIMI-ACP-001] initialization rejects unsupported protocol and missing session/list", async () => {
  for (const [scenario, expected] of [
    ["unsupported-protocol", /unsupported ACP protocol 2/],
    ["missing-session-list", /does not support ACP session\/list/],
  ]) {
    const adapter = new KimiCodeAdapter({
      kimiBin: process.execPath,
      kimiArgs: [fixture, scenario],
      workspace: process.cwd(),
    });
    try {
      await assert.rejects(
        adapter.start({ emitEvent: async () => {}, requestApproval: async () => {} }),
        expected,
      );
    } finally {
      await adapter.close();
    }
  }
});

test("[KIMI-ACP-002] paginated catalog is filtered, sorted, unique, and capped", async () => {
  const { adapter } = await startHarness({ scenario: "catalog-pages" });
  try {
    const sessions = await adapter.listSessions();
    assert.equal(sessions.length, 300);
    assert.equal(new Set(sessions.map((session) => session.id)).size, 300);
    assert.equal(sessions[0].id, "kimi_catalog_349");
    assert.equal(sessions.at(-1).id, "kimi_catalog_050");
    assert.ok(sessions.every((session) => session.cwd.startsWith("/workspace/")));
    assert.ok(sessions.every((session) => session.provider === "kimi"));
    assert.equal(sessions.some((session) => session.id === "missing-cwd"), false);
  } finally {
    await adapter.close();
  }

  const repeated = await startHarness({ scenario: "repeated-cursor" });
  try {
    await assert.rejects(
      repeated.adapter.listSessions(),
      /repeated session pagination cursor/,
    );
  } finally {
    await repeated.adapter.close();
  }

  const invalid = await startHarness({ scenario: "invalid-cursor" });
  try {
    await assert.rejects(
      invalid.adapter.listSessions(),
      /invalid session pagination cursor/,
    );
  } finally {
    await invalid.adapter.close();
  }
});

test("[KIMI-ACP-003] loaded history coalesces chunks and paginates with stable cursors", async () => {
  const { adapter } = await startHarness();
  try {
    const newest = await adapter.readHistory({
      sessionId: "kimi_existing",
      limit: 1,
    });
    assert.deepEqual(
      newest.messages.map(({ role, content }) => ({ role, content })),
      [{ role: "codex", content: "historical answer" }],
    );
    assert.equal(newest.has_more, true);
    assert.ok(newest.next_cursor);
    assert.doesNotMatch(JSON.stringify(newest), /private reasoning/);

    const older = await adapter.readHistory({
      sessionId: "kimi_existing",
      limit: 1,
      before: newest.next_cursor,
    });
    assert.deepEqual(
      older.messages.map(({ role, content }) => ({ role, content })),
      [{ role: "user", content: "historical question" }],
    );
    assert.equal(older.messages[0].turn_id, newest.messages[0].turn_id);
    assert.equal(older.has_more, false);
    assert.equal(older.agents.length, 2);

    await assert.rejects(
      adapter.readHistory({
        sessionId: "kimi_existing",
        before: "not-a-cursor",
      }),
      /Invalid history cursor/,
    );
    const missingCursor = Buffer.from(
      JSON.stringify({ v: 1, before_id: "missing-message" }),
    ).toString("base64url");
    await assert.rejects(
      adapter.readHistory({
        sessionId: "kimi_existing",
        before: missingCursor,
      }),
      /History cursor is no longer valid/,
    );
  } finally {
    await adapter.close();
  }
});

test("[KIMI-ACP-004] commands, model, Thinking, mode, and usage stay synchronized", async () => {
  const { adapter } = await startHarness();
  try {
    for (const [configId, value] of [
      ["model", "kimi-code/k2"],
      ["thinking", "off"],
      ["mode", "yolo"],
    ]) {
      const result = await adapter.configureSession({
        sessionId: "kimi_existing",
        configId,
        value,
      });
      assert.equal(
        result.configOptions.find((option) => option.id === configId).currentValue,
        value,
      );
    }

    const session = (await adapter.listSessions()).find(
      (candidate) => candidate.id === "kimi_existing",
    );
    assert.deepEqual(
      Object.fromEntries(
        session.kimi_config_options.map((option) => [option.id, option.currentValue]),
      ),
      { model: "kimi-code/k2", thinking: "off", mode: "yolo" },
    );
    assert.deepEqual(session.kimi_commands, [
      { name: "usage", description: "Show session token usage", input_hint: null },
      {
        name: "review",
        description: "Review the current changes",
        input_hint: "optional focus",
      },
    ]);
    assert.deepEqual(session.usage, {
      used: 81_234,
      size: 131_072,
      cost: { amount: 0.42, currency: "USD" },
    });
    await assert.rejects(
      adapter.configureSession({
        sessionId: "kimi_existing",
        configId: "swarm",
        value: true,
      }),
      /did not advertise the swarm setting/,
    );
  } finally {
    await adapter.close();
  }
});

test("[KIMI-ACP-006] approval rejects invalid decisions and cannot be replayed", async () => {
  const { adapter, events, approvals } = await startHarness();
  try {
    await adapter.submitMessage({
      sessionId: "kimi_existing",
      requestId: "req_reject",
      content: "reject approval",
    });
    await waitFor(() => approvals.length === 1);
    const approvalId = approvals[0].approval_id;
    await assert.rejects(
      adapter.resolveApproval({ approvalId, decision: "maybe" }),
      /approval decision is invalid/,
    );
    await adapter.resolveApproval({
      approvalId,
      decision: "rejected",
      optionId: "reject",
    });
    await waitFor(() =>
      events.some(({ event }) => event.kind === "turn.completed"),
    );
    const rejectedOutput = events.find(
      ({ event }) =>
        event.kind === "command.output" && event.item_id === "1:tool-1",
    )?.event;
    assert.equal(rejectedOutput.status, "failed");
    assert.match(rejectedOutput.text, /tool rejected/);
    await assert.rejects(
      adapter.resolveApproval({ approvalId, decision: "rejected" }),
      /no longer pending/,
    );
  } finally {
    await adapter.close();
  }
});

test("[KIMI-ACP-007] cancelling an active turn emits an interrupted terminal state", async () => {
  const { adapter, events } = await startHarness();
  try {
    await adapter.submitMessage({
      sessionId: "kimi_existing",
      requestId: "req_cancel",
      content: "cancel the turn",
    });
    await waitFor(() =>
      events.some(({ event }) => event.kind === "message.delta"),
    );
    await assert.rejects(
      adapter.submitMessage({
        sessionId: "kimi_existing",
        requestId: "req_steer_not_supported",
        content: "must not steer",
      }),
      /does not support steering an active turn/,
    );
    await adapter.interruptTurn({ sessionId: "kimi_existing" });
    await waitFor(() =>
      events.some(
        ({ event }) =>
          event.kind === "turn.completed" && event.status === "interrupted",
      ),
    );
    const session = (await adapter.listSessions()).find(
      (candidate) => candidate.id === "kimi_existing",
    );
    assert.equal(session.status, "idle");
    assert.equal(session.can_interrupt, false);
    await assert.rejects(
      adapter.interruptTurn({ sessionId: "kimi_existing" }),
      /No active Kimi Code turn/,
    );
  } finally {
    await adapter.close();
  }
});

test("[KIMI-ACP-008] prompt errors and process exits converge without stale approvals", async () => {
  {
    const { adapter, events } = await startHarness();
    try {
      await adapter.submitMessage({
        sessionId: "kimi_existing",
        requestId: "req_failure",
        content: "fail the turn",
      });
      await waitFor(() =>
        events.some(({ event }) => event.kind === "turn.failed"),
      );
      assert.match(
        events.find(({ event }) => event.kind === "turn.failed").event.error,
        /deterministic prompt failure/,
      );
    } finally {
      await adapter.close();
    }
  }

  {
    const { adapter, events, approvals } = await startHarness();
    try {
      await adapter.submitMessage({
        sessionId: "kimi_existing",
        requestId: "req_disconnect",
        content: "disconnect with approval pending",
      });
      await waitFor(() => approvals.length === 1);
      await waitFor(() =>
        events.some(({ event }) => event.kind === "turn.failed"),
      );
      assert.match(
        events.find(({ event }) => event.kind === "turn.failed").event.error,
        /kimi acp exited with 23/,
      );
      await assert.rejects(
        adapter.resolveApproval({
          approvalId: approvals[0].approval_id,
          decision: "rejected",
        }),
        /no longer pending/,
      );
    } finally {
      await adapter.close();
    }
  }
});

test("[KIMI-ACP-009] terminal updates from an old tool cannot pollute a fresh turn", async () => {
  const { adapter, events } = await startHarness();
  try {
    await adapter.submitMessage({
      sessionId: "kimi_existing",
      requestId: "req_stale",
      content: "stale tool event",
    });
    await waitFor(() =>
      events.some(({ event }) => event.kind === "turn.completed"),
    );
    assert.equal(
      events.some(
        ({ event }) =>
          event.kind === "command.output" &&
          event.item_id === "0:tool-from-an-old-turn",
      ),
      false,
    );
    assert.equal(
      events.find(({ event }) => event.kind === "message.completed").event.text,
      "fresh response",
    );
  } finally {
    await adapter.close();
  }
});

test("[KIMI-ACP-010] malformed and duplicate session state is normalized to bounded data", async () => {
  const { adapter, events } = await startHarness();
  try {
    await adapter.submitMessage({
      sessionId: "kimi_existing",
      requestId: "req_boundary",
      content: "boundary state",
    });
    await waitFor(() =>
      events.some(({ event }) => event.kind === "turn.completed"),
    );
    const session = (await adapter.listSessions()).find(
      (candidate) => candidate.id === "kimi_existing",
    );
    assert.deepEqual(
      session.kimi_config_options.map((option) => ({
        id: option.id,
        currentValue: option.currentValue,
        optionCount: option.options?.length ?? null,
      })),
      [
        { id: "model", currentValue: null, optionCount: 1 },
        { id: "thinking", currentValue: null, optionCount: null },
      ],
    );
    assert.deepEqual(
      session.kimi_commands.map((command) => command.name),
      ["usage", "review"],
    );
    assert.equal(session.kimi_commands[1].description.length, 301);
    assert.equal(session.kimi_commands[1].input_hint.length, 161);
    assert.deepEqual(session.usage, { used: 0, size: 100, cost: null });
  } finally {
    await adapter.close();
  }
});

test("[KIMI-ACP-011] authentication failures explain the local login recovery", async () => {
  const { adapter } = await startHarness({ scenario: "auth-required" });
  try {
    await assert.rejects(
      adapter.listSessions(),
      /authentication is required.*kimi login.*restart Relayune/i,
    );
  } finally {
    await adapter.close();
  }
});

test("[KIMI-ACP-012] createAgents delegates the exact task set to native AgentSwarm", async () => {
  const { adapter, events } = await startHarness();
  try {
    const submitted = await adapter.createAgents({
      sessionId: "kimi_existing",
      tasks: ["审计更新流程", "验证回滚路径"],
    });
    assert.equal(submitted.mode, "started");
    await waitFor(() =>
      events.some(({ event }) => event.kind === "turn.completed"),
    );
    const agentEvents = events.filter(({ event }) =>
      event.kind.startsWith("agent."),
    );
    assert.deepEqual(
      agentEvents.map(({ event }) => ({
        kind: event.kind,
        task: event.task,
        status: event.agent_status,
      })),
      [
        { kind: "agent.updated", task: "审计更新流程", status: "running" },
        { kind: "agent.updated", task: "验证回滚路径", status: "running" },
        { kind: "agent.completed", task: "审计更新流程", status: "completed" },
        { kind: "agent.completed", task: "验证回滚路径", status: "completed" },
      ],
    );
    assert.equal(
      events.find(({ event }) => event.kind === "message.completed").event.text,
      "并行任务汇总完成",
    );
  } finally {
    await adapter.close();
  }
});

test("Kimi fixed contract manifest has a unique automated test for every case", async () => {
  const [manifestText, source] = await Promise.all([
    readFile(new URL("./cases/kimi-code-contract.json", import.meta.url), "utf8"),
    Promise.all([
      readFile(new URL("./kimi-contract.test.mjs", import.meta.url), "utf8"),
      readFile(new URL("./kimi-adapter.test.mjs", import.meta.url), "utf8"),
    ]).then((parts) => parts.join("\n")),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.network_account_required, false);
  assert.equal(new Set(manifest.cases.map((item) => item.id)).size, manifest.cases.length);
  for (const item of manifest.cases) {
    assert.match(item.id, /^KIMI-ACP-\d{3}$/);
    assert.ok(["P0", "P1"].includes(item.priority));
    assert.ok(source.includes(`[${item.id}]`), `${item.id} has no automated test`);
  }
});

async function waitFor(predicate, timeoutMs = 3_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for Kimi contract state.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('Kimi applies the advertised permission mode before new or resumed sessions can prompt', async () => {
  const { adapter } = await startHarness();
  const calls = [];
  const request = adapter.requestAuthenticated.bind(adapter);
  adapter.requestAuthenticated = async (method, params, options) => {
    calls.push({ method, params });
    return request(method, params, options);
  };
  try {
    const created = await adapter.createSession({ cwd: '/workspace', name: 'Mode test' });
    assert.ok(calls.some(c => c.method === 'session/set_config_option' && c.params.sessionId === created.id && c.params.configId === 'mode' && c.params.value === 'default'));
    calls.length = 0;
    await adapter.ensureSessionActive('kimi_existing');
    assert.ok(calls.some(c => c.method === 'session/set_config_option' && c.params.sessionId === 'kimi_existing' && c.params.value === 'default'));
    const failure = await startHarness();
    try {
      const original = failure.adapter.requestAuthenticated.bind(failure.adapter);
      failure.adapter.requestAuthenticated = async (method, params, options) => {
        if (method === 'session/set_config_option') throw Error('mode could not be applied');
        return original(method, params, options);
      };
      await assert.rejects(failure.adapter.createSession({ cwd: '/workspace' }), /mode could not be applied/);
      await assert.rejects(failure.adapter.submitMessage({ sessionId: 'kimi_existing', content: 'must not execute' }), /mode could not be applied/);
      assert.equal(failure.events.some(({event}) => event.kind === 'turn.started'), false);
    } finally { await failure.adapter.close(); }
  } finally { await adapter.close(); }
});
