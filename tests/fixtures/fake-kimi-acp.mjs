import { createInterface } from "node:readline";

const scenario = process.argv[2] ?? "default";
const sessions = [
  {
    sessionId: "kimi_existing",
    cwd: "/workspace/project",
    title: "Existing Kimi session",
    updatedAt: "2026-07-29T10:00:00.000Z",
  },
];
let pendingPrompt = null;
let pendingPermissionId = null;
let configOptions = [
  {
    type: "select",
    id: "model",
    name: "Model",
    category: "model",
    currentValue: "kimi-code/k3",
    options: [
      { value: "kimi-code/k3", name: "K3" },
      { value: "kimi-code/k2", name: "K2" },
    ],
  },
  {
    type: "select",
    id: "thinking",
    name: "Thinking",
    category: "thought_level",
    currentValue: "max",
    options: [
      { value: "off", name: "Off" },
      { value: "max", name: "Max" },
    ],
  },
  {
    type: "select",
    id: "mode",
    name: "Mode",
    category: "mode",
    currentValue: "default",
    options: [
      { value: "default", name: "Default" },
      { value: "plan", name: "Plan" },
      { value: "auto", name: "Auto" },
      { value: "yolo", name: "YOLO" },
    ],
  },
];

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === pendingPermissionId && !message.method) {
    const optionId = message.result?.outcome?.optionId;
    emitUpdate("kimi_existing", {
      sessionUpdate: "tool_call_update",
      toolCallId: "1:tool-agents",
      status: "completed",
      content: [
        {
          type: "content",
          content: { type: "text", text: "Both delegated tasks finished." },
        },
      ],
    });
    emitUpdate("kimi_existing", {
      sessionUpdate: "tool_call_update",
      toolCallId: "1:tool-1",
      status: optionId === "reject" ? "failed" : "completed",
      content: [
        {
          type: "content",
          content: {
            type: "text",
            text: optionId === "approve_once" ? "tool approved" : "tool rejected",
          },
        },
      ],
    });
    emitUpdate("kimi_existing", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Kimi " },
    });
    emitUpdate("kimi_existing", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "finished." },
    });
    respond(pendingPrompt, { stopReason: "end_turn" });
    pendingPrompt = null;
    pendingPermissionId = null;
    return;
  }
  if (!message.method) return;
  if (message.method === "initialize") {
    if (scenario === "unsupported-protocol") {
      respond(message.id, {
        protocolVersion: 2,
        agentCapabilities: { sessionCapabilities: { list: {} } },
      });
      return;
    }
    if (scenario === "missing-session-list") {
      respond(message.id, {
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: {} },
      });
      return;
    }
    respond(message.id, {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true },
        sessionCapabilities: { list: {}, resume: {} },
      },
      agentInfo: { name: "Fake Kimi Code", version: "0.30.0-test" },
      authMethods: [{ id: "login", name: "Login" }],
    });
    return;
  }
  if (message.method === "session/list") {
    if (scenario === "auth-required") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32000, message: "Login required" },
      });
      return;
    }
    if (scenario === "catalog-pages") {
      const offset = message.params.cursor === "page-2" ? 150 : 0;
      const count = offset ? 200 : 150;
      const catalog = Array.from({ length: count }, (_, index) => {
        const item = offset + index;
        return {
          sessionId: `kimi_catalog_${String(item).padStart(3, "0")}`,
          cwd: `/workspace/catalog-${item % 3}`,
          title: `Catalog session ${item}`,
          updatedAt: new Date(Date.UTC(2026, 6, 29, 10, 0, item)).toISOString(),
        };
      });
      if (!offset) {
        catalog.splice(3, 0, { sessionId: "missing-cwd" }, null);
      } else {
        catalog.unshift({
          sessionId: "kimi_catalog_149",
          cwd: "/workspace/catalog-2",
          title: "Duplicate across pages",
          updatedAt: "2026-07-29T10:02:29.000Z",
        });
      }
      respond(message.id, {
        sessions: catalog,
        nextCursor: offset ? null : "page-2",
      });
      return;
    }
    if (scenario === "repeated-cursor") {
      respond(message.id, { sessions: [], nextCursor: "same-cursor" });
      return;
    }
    if (scenario === "invalid-cursor") {
      respond(message.id, { sessions: [], nextCursor: { opaque: false } });
      return;
    }
    respond(message.id, { sessions, nextCursor: null });
    return;
  }
  if (message.method === "session/new") {
    const session = {
      sessionId: `kimi_new_${sessions.length}`,
      cwd: message.params.cwd,
      title: null,
      updatedAt: "2026-07-29T10:05:00.000Z",
    };
    sessions.push(session);
    respond(message.id, { sessionId: session.sessionId, configOptions });
    return;
  }
  if (message.method === "session/load") {
    emitUpdate(message.params.sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "8:tool-history-agents",
      title: "AgentSwarm",
      kind: "other",
      status: "in_progress",
      rawInput: {
        description: "历史并行任务",
        subagent_type: "coder",
        prompt_template: "Handle {{item}}",
        items: ["中文名=银杏 | slug=ginkgo", "中文名=红杉 | slug=redwood"],
      },
      content: [],
    });
    emitUpdate(message.params.sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: "8:tool-history-agents",
      status: "completed",
      content: [],
    });
    emitUpdate(message.params.sessionId, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "historical " },
    });
    emitUpdate(message.params.sessionId, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "question" },
    });
    emitUpdate(message.params.sessionId, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "private reasoning must stay hidden" },
    });
    emitUpdate(message.params.sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "historical " },
    });
    emitUpdate(message.params.sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "answer" },
    });
    respond(message.id, { configOptions });
    return;
  }
  if (message.method === "session/resume") {
    emitUpdate(message.params.sessionId, {
      sessionUpdate: "available_commands_update",
      availableCommands: [
        { name: "usage", description: "Show session token usage" },
        {
          name: "review",
          description: "Review the current changes",
          input: { hint: "optional focus" },
        },
      ],
    });
    emitUpdate(message.params.sessionId, {
      sessionUpdate: "config_option_update",
      configOptions,
    });
    emitUpdate(message.params.sessionId, {
      sessionUpdate: "usage_update",
      used: 81_234,
      size: 131_072,
      cost: { amount: 0.42, currency: "USD" },
    });
    respond(message.id, { configOptions });
    return;
  }
  if (message.method === "session/set_config_option") {
    const config = configOptions.find(
      (candidate) => candidate.id === message.params.configId,
    );
    if (!config?.options.some((option) => option.value === message.params.value)) {
      write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32602, message: "Unknown config option" },
      });
      return;
    }
    configOptions = configOptions.map((candidate) =>
      candidate.id === message.params.configId
        ? { ...candidate, currentValue: message.params.value }
        : candidate,
    );
    emitUpdate(message.params.sessionId, {
      sessionUpdate: "config_option_update",
      configOptions,
    });
    respond(message.id, { configOptions });
    return;
  }
  if (message.method === "session/prompt") {
    const promptText = message.params.prompt
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("") ?? "";
    if (promptText === "fail the turn") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: "deterministic prompt failure" },
      });
      return;
    }
    if (promptText === "stale tool event") {
      emitUpdate(message.params.sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: "0:tool-from-an-old-turn",
        status: "completed",
        content: [
          {
            type: "content",
            content: { type: "text", text: "must not leak into this turn" },
          },
        ],
      });
      emitUpdate(message.params.sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "fresh response" },
      });
      respond(message.id, { stopReason: "end_turn" });
      return;
    }
    if (promptText === "boundary state") {
      emitUpdate(message.params.sessionId, {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "usage", description: "first definition" },
          { name: "usage", description: "duplicate definition" },
          { name: "bad command", description: "invalid name" },
          { name: "review", description: "R".repeat(500), input: { hint: "H".repeat(300) } },
          null,
        ],
      });
      emitUpdate(message.params.sessionId, {
        sessionUpdate: "config_option_update",
        configOptions: [
          {
            type: "select",
            id: "model",
            name: "Model",
            currentValue: { unexpected: true },
            options: [
              { value: "kimi-code/k3", name: "K3" },
              { value: "kimi-code/k3", name: "duplicate" },
              { value: "", name: "empty" },
            ],
          },
          {
            type: "boolean",
            id: "thinking",
            name: "Thinking",
            currentValue: "yes",
          },
          {
            type: "select",
            id: "model",
            name: "Duplicate model",
            currentValue: "other",
            options: [{ value: "other", name: "Other" }],
          },
          { type: "select", id: "bad id", name: "Bad", options: [] },
          { type: "unsupported", id: "mode", name: "Mode" },
        ],
      });
      emitUpdate(message.params.sessionId, {
        sessionUpdate: "usage_update",
        used: Number.MAX_SAFE_INTEGER + 1,
        size: 100,
        cost: { amount: -1, currency: "usd" },
      });
      emitUpdate(message.params.sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "boundary state applied" },
      });
      respond(message.id, { stopReason: "end_turn" });
      return;
    }
    if (
      promptText ===
      "请使用 Kimi Code 的原生子 Agent 并行处理以下任务，等待全部完成后汇总结果：\n1. 审计更新流程\n2. 验证回滚路径"
    ) {
      emitUpdate(message.params.sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: "4:tool-created-agents",
        title: "AgentSwarm",
        kind: "other",
        status: "in_progress",
        rawInput: {
          description: "用户委派的并行任务",
          subagent_type: "coder",
          items: ["审计更新流程", "验证回滚路径"],
        },
        content: [],
      });
      emitUpdate(message.params.sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: "4:tool-created-agents",
        status: "completed",
        content: [
          {
            type: "content",
            content: { type: "text", text: "两项任务均已完成" },
          },
        ],
      });
      emitUpdate(message.params.sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "并行任务汇总完成" },
      });
      respond(message.id, { stopReason: "end_turn" });
      return;
    }
    if (promptText === "cancel the turn") {
      pendingPrompt = message.id;
      emitUpdate(message.params.sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "partial response" },
      });
      return;
    }
    if (promptText === "disconnect with approval pending") {
      pendingPrompt = message.id;
      pendingPermissionId = 901;
      write({
        jsonrpc: "2.0",
        id: pendingPermissionId,
        method: "session/request_permission",
        params: {
          sessionId: message.params.sessionId,
          toolCall: {
            toolCallId: "9:tool-disconnect",
            title: "Bash",
            kind: "execute",
            rawInput: { command: "npm run disconnected" },
          },
          options: [
            {
              optionId: "approve_once",
              name: "Approve once",
              kind: "allow_once",
            },
            { optionId: "reject", name: "Reject", kind: "reject_once" },
          ],
        },
      });
      setTimeout(() => process.exit(23), 75);
      return;
    }
    if (
      promptText === "run the tests" &&
      !message.params.prompt.some(
        (part) =>
          part.type === "image" &&
          part.mimeType === "image/png" &&
          part.data === "iVBORw0KGgo=",
      )
    ) {
      write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32602, message: "Expected encrypted upload image block" },
      });
      return;
    }
    pendingPrompt = message.id;
    emitUpdate(message.params.sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "1:tool-agents",
      title: "AgentSwarm",
      kind: "other",
      status: "in_progress",
      rawInput: {
        description: "并行检查",
        subagent_type: "coder",
        prompt_template: "Check {{item}}",
        items: ["typecheck", "unit tests"],
      },
      content: [],
    });
    emitUpdate(message.params.sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "1:tool-1",
      title: "Bash",
      kind: "execute",
      status: "in_progress",
      rawInput: { command: "npm test" },
      content: [],
    });
    emitUpdate(message.params.sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: "1:tool-1",
      title: "Bash",
      status: "in_progress",
      content: [
        {
          type: "content",
          content: { type: "text", text: '{"command":"n' },
        },
      ],
    });
    emitUpdate(message.params.sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: "1:tool-1",
      title: "Bash: npm test",
      status: "in_progress",
      content: [
        {
          type: "content",
          content: { type: "text", text: '{"command":"npm test"}' },
        },
      ],
    });
    pendingPermissionId = 900;
    write({
      jsonrpc: "2.0",
      id: pendingPermissionId,
      method: "session/request_permission",
      params: {
        sessionId: message.params.sessionId,
        toolCall: {
          toolCallId: "1:tool-1",
          title: "Bash",
          kind: "execute",
          rawInput: { command: "npm test" },
        },
        options: [
          {
            optionId: "approve_once",
            name: "Approve once",
            kind: "allow_once",
          },
          {
            optionId: "approve_always",
            name: "Approve for this session",
            kind: "allow_always",
          },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
      },
    });
    return;
  }
  if (message.method === "session/cancel") {
    if (pendingPrompt !== null) {
      respond(pendingPrompt, { stopReason: "cancelled" });
      pendingPrompt = null;
    }
    return;
  }
  if (message.id !== undefined) {
    write({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `Unsupported: ${message.method}` },
    });
  }
});

function emitUpdate(sessionId, update) {
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId, update },
  });
}

function respond(id, result) {
  write({ jsonrpc: "2.0", id, result });
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
