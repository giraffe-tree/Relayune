import assert from "node:assert/strict";
import test from "node:test";
import { MultiAgentAdapter } from "../relay/multi-agent-adapter.mjs";

class FakeAdapter {
  constructor(provider) {
    this.provider = provider;
    this.calls = [];
    this.handlers = null;
  }

  async start(handlers) {
    this.handlers = handlers;
  }

  async listSessions() {
    this.calls.push(["listSessions"]);
    return [
      {
        id: `${this.provider}_session`,
        name: `${this.provider} session`,
        cwd: `/workspace/${this.provider}`,
      updated_at:
          this.provider === "kimi"
            ? "2026-07-29T11:00:00.000Z"
            : this.provider === "claude"
              ? "2026-07-29T09:00:00.000Z"
            : "2026-07-29T10:00:00.000Z",
      },
    ];
  }

  async listProjects() {
    this.calls.push(["listProjects"]);
    return [
      {
        id: `${this.provider}_project`,
        name: `${this.provider} project`,
        cwd: `/projects/${this.provider}`,
      },
    ];
  }

  async readUsage() {
    this.calls.push(["readUsage"]);
    const totals = { codex: 1200, kimi: 3400, claude: 5600 };
    return {
      [this.provider]: {
        as_of: "2026-09-02T10:00:00.000Z",
        daily: [
          { date: "2026-09-02", total_tokens: totals[this.provider] },
        ],
      },
      ...(this.provider === "kimi"
        ? {
            codex: {
              as_of: "invalid-cross-provider-write",
              daily: [],
            },
          }
        : {}),
    };
  }

  async createSession(options) {
    this.calls.push(["createSession", options]);
    return {
      id: `${this.provider}_created`,
      name: options.name,
      cwd: options.cwd,
      updated_at: "2026-07-29T12:00:00.000Z",
    };
  }

  async finalizeSessionCreation(session) {
    this.calls.push(["finalizeSessionCreation", session]);
    return { ...session, sync_state: "persisted" };
  }

  async readHistory(options) {
    this.calls.push(["readHistory", options]);
    return {
      messages: [{ id: "message_1", role: "codex", content: "done" }],
      sessions: [],
    };
  }

  async submitMessage(options) {
    this.calls.push(["submitMessage", options]);
    return { mode: "started" };
  }

  async interruptTurn(options) {
    this.calls.push(["interruptTurn", options]);
  }

  async configureSession(options) {
    this.calls.push(["configureSession", options]);
    return { configOptions: [] };
  }

  async resolveApproval(options) {
    this.calls.push(["resolveApproval", options]);
  }

  async createAgents(options) {
    this.calls.push(["createAgents", options]);
    return [];
  }

  async close() {
    this.calls.push(["close"]);
  }
}

test("unified adapter decorates and routes Codex, Kimi, and Claude sessions", async () => {
  const codex = new FakeAdapter("codex");
  const kimi = new FakeAdapter("kimi");
  const claude = new FakeAdapter("claude");
  const events = [];
  const approvals = [];
  const adapter = new MultiAgentAdapter({
    defaultProvider: "kimi",
    adapters: { codex, kimi, claude },
  });

  await adapter.start({
    emitEvent: async (sessionId, event) => events.push({ sessionId, event }),
    requestApproval: async (approval) => approvals.push(approval),
  });

  try {
    const sessions = await adapter.listSessions();
    assert.deepEqual(
      sessions.map(({ id, provider }) => ({ id, provider })),
      [
        { id: "kimi_session", provider: "kimi" },
        { id: "codex_session", provider: "codex" },
        { id: "claude_session", provider: "claude" },
      ],
    );
    assert.equal(
      sessions.find(({ provider }) => provider === "codex").supports_steering,
      true,
    );
    assert.deepEqual(await adapter.readUsage(), {
      codex: {
        as_of: "2026-09-02T10:00:00.000Z",
        daily: [{ date: "2026-09-02", total_tokens: 1200 }],
      },
      kimi: {
        as_of: "2026-09-02T10:00:00.000Z",
        daily: [{ date: "2026-09-02", total_tokens: 3400 }],
      },
      claude: {
        as_of: "2026-09-02T10:00:00.000Z",
        daily: [{ date: "2026-09-02", total_tokens: 5600 }],
      },
    });
    assert.equal(
      sessions.find(({ provider }) => provider === "kimi").supports_steering,
      false,
    );
    assert.equal(
      sessions.find(({ provider }) => provider === "claude").supports_steering,
      false,
    );
    const projects = await adapter.listProjects();
    assert.deepEqual(
      projects.map(({ id, provider }) => ({ id, provider })),
      [
        { id: "codex_project", provider: "codex" },
        { id: "kimi_project", provider: "kimi" },
        { id: "claude_project", provider: "claude" },
      ],
    );

    const codexSession = await adapter.createSession({
      cwd: "/workspace/new",
      name: "new Codex",
      provider: "codex",
    });
    assert.equal(codexSession.provider, "codex");
    assert.deepEqual(codex.calls.at(-1), [
      "createSession",
      { cwd: "/workspace/new", name: "new Codex" },
    ]);
    const finalizedCodexSession = await adapter.finalizeSessionCreation(
      codexSession,
    );
    assert.equal(finalizedCodexSession.provider, "codex");
    assert.equal(finalizedCodexSession.sync_state, "persisted");
    assert.equal(codex.calls.at(-1)[0], "finalizeSessionCreation");

    const beforeUnknown = kimi.calls.length;
    await assert.rejects(adapter.createSession({
      cwd: "/workspace", name: "Pi", provider: "pi",
    }), /unavailable/);
    assert.equal(kimi.calls.length, beforeUnknown);

    const defaultSession = await adapter.createSession({
      cwd: "/workspace/default",
      name: "default",
    });
    assert.equal(defaultSession.provider, "kimi");

    const claudeSession = await adapter.createSession({
      cwd: "/workspace/claude",
      name: "new Claude",
      provider: "claude",
    });
    assert.equal(claudeSession.provider, "claude");

    await adapter.submitMessage({
      sessionId: "codex_session",
      requestId: "req_codex",
      content: "hello",
    });
    assert.equal(codex.calls.at(-1)[0], "submitMessage");

    const history = await adapter.readHistory({
      sessionId: "kimi_session",
      limit: 100,
    });
    assert.equal(history.messages[0].provider, "kimi");
    assert.equal(kimi.calls.at(-1)[0], "readHistory");

    await adapter.configureSession({
      sessionId: "kimi_session",
      configId: "mode",
      value: "plan",
    });
    assert.deepEqual(kimi.calls.at(-1), [
      "configureSession",
      { sessionId: "kimi_session", configId: "mode", value: "plan" },
    ]);

    await codex.handlers.emitEvent("codex_session", {
      kind: "message.completed",
      text: "done",
    });
    assert.equal(events[0].event.provider, "codex");

    await kimi.handlers.requestApproval({
      approval_id: "apr_shared",
      session_id: "kimi_session",
    });
    assert.equal(approvals[0].provider, "kimi");
    await adapter.resolveApproval({
      approvalId: "apr_shared",
      decision: "approved",
    });
    assert.equal(kimi.calls.at(-1)[0], "resolveApproval");

    await adapter.resolveApproval({
      approvalId: "apr_claude_control_1",
      decision: "rejected",
    });
    assert.equal(claude.calls.at(-1)[0], "resolveApproval");
  } finally {
    await adapter.close();
  }
});

test("unified adapter remains available when one provider cannot start", async () => {
  const kimi = new FakeAdapter("kimi");
  const brokenCodex = new FakeAdapter("codex");
  brokenCodex.start = async () => {
    throw new Error("codex unavailable");
  };
  const adapter = new MultiAgentAdapter({
    defaultProvider: "kimi",
    adapters: { codex: brokenCodex, kimi },
  });

  await adapter.start({
    emitEvent: async () => {},
    requestApproval: async () => {},
  });
  assert.deepEqual(adapter.status(), {
    codex: { ready: false, error: "codex unavailable" },
    kimi: { ready: true, error: null },
  });
  await assert.rejects(
    adapter.createSession({
      cwd: "/workspace",
      name: "Codex",
      provider: "codex",
    }),
    /Codex is unavailable: codex unavailable/,
  );
  await adapter.close();
});

test("unified adapter routes Cowork sessions and approval prefixes independently from Claude Code", async () => {
  const claude = new FakeAdapter("claude");
  const cowork = new FakeAdapter("claude-cowork");
  const adapter = new MultiAgentAdapter({
    defaultProvider: "claude-cowork",
    adapters: { claude, "claude-cowork": cowork },
  });
  await adapter.start({
    emitEvent: async () => {},
    requestApproval: async () => {},
  });
  try {
    await adapter.listSessions();
    await adapter.configureSession({
      sessionId: "claude-cowork_session",
      configId: "model",
      value: "observed-model",
    });
    assert.equal(cowork.calls.at(-1)[0], "configureSession");

    await adapter.resolveApproval({
      approvalId: "apr_claude_cowork_control_1",
      decision: "approved",
    });
    assert.equal(cowork.calls.at(-1)[0], "resolveApproval");
    assert.notEqual(claude.calls.at(-1)?.[0], "resolveApproval");
    assert.equal(adapter.status()["claude-cowork"].ready, true);
  } finally {
    await adapter.close();
  }
});

test("catalog misses resolve older sessions by read-only lookup and cache the provider", async () => {
  const codex = new FakeAdapter("codex");
  const kimi = new FakeAdapter("kimi");
  let lookups = 0;
  codex.findSession = async id => { lookups++; assert.equal(id, 'older'); return { id }; };
  const adapter = new MultiAgentAdapter({ adapters: { codex, kimi } });
  await adapter.start({});
  await adapter.submitMessage({ sessionId: 'older', content: 'hello' });
  await adapter.readHistory({ sessionId: 'older' });
  assert.equal(lookups, 1);
  assert.ok(codex.calls.some(([method]) => method === 'submitMessage'));
  assert.ok(codex.calls.some(([method]) => method === 'readHistory'));
  assert.ok(!kimi.calls.some(([method]) => method === 'submitMessage'));
});

test("missing and failed exact lookups never submit or guess a provider", async () => {
  const codex = new FakeAdapter('codex');
  const adapter = new MultiAgentAdapter({ adapters: { codex } });
  await adapter.start({});
  codex.findSession = async () => null;
  await assert.rejects(adapter.submitMessage({ sessionId: 'missing' }), /not available in any configured/);
  codex.findSession = async () => { throw new Error('transport disconnected'); };
  await assert.rejects(adapter.submitMessage({ sessionId: 'missing' }), /transport disconnected/);
  assert.ok(!codex.calls.some(([method]) => method === 'submitMessage'));
});
