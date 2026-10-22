import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CodexAppServerAdapter,
  codexRolloutActivityEvents,
  codexToolActivityEventFromItem,
} from "../relay/codex-adapters.mjs";

test("[relay] current Codex v2 tool items share one privacy-safe activity shape", () => {
  const mcp = codexToolActivityEventFromItem(
    {
      id: "mcp-1",
      type: "mcpToolCall",
      server: "browser",
      tool: "open",
      arguments: { token: "must-not-leave-the-computer" },
      result: { content: [{ type: "text", text: "private result" }] },
      status: "completed",
      durationMs: 42,
    },
    { completed: true, turnId: "turn-1" },
  );
  assert.deepEqual(
    {
      kind: mcp.kind,
      type: mcp.activity_type,
      name: mcp.activity_name,
      status: mcp.status,
      duration: mcp.duration_ms,
    },
    {
      kind: "command.completed",
      type: "mcp_tool",
      name: "browser / open",
      status: "completed",
      duration: 42,
    },
  );
  assert.doesNotMatch(JSON.stringify(mcp), /must-not-leave|private result/);

  const web = codexToolActivityEventFromItem(
    { id: "web-1", type: "webSearch", query: "Relayune docs" },
    { completed: false, turnId: "turn-1" },
  );
  assert.equal(web.kind, "command.started");
  assert.equal(web.activity_type, "web_search");
  assert.equal(web.activity_subject, "Relayune docs");

  const command = codexToolActivityEventFromItem(
    {
      id: "command-1",
      type: "CommandExecution",
      command: ["/bin/zsh", "-lc", "npm run mobile:check"],
      status: "completed",
    },
    { completed: true, turnId: "turn-1" },
  );
  assert.equal(command.command, "npm run mobile:check");

  const read = codexToolActivityEventFromItem(
    {
      id: "read-1",
      type: "CommandExecution",
      command: [
        "/bin/zsh",
        "-lc",
        "sed -n '1,120p' mobile/lib/src/ui/workbench_screen.dart",
      ],
      status: "completed",
    },
    { completed: true, turnId: "turn-1" },
  );
  assert.equal(read.activity_type, "file_read");
  assert.equal(read.activity_subject, "workbench_screen.dart");
  assert.equal(read.activity_count, 1);

  const files = codexToolActivityEventFromItem(
    {
      id: "files-1",
      type: "FileChange",
      changes: [
        { path: "/workspace/app/workbench-page.tsx" },
        { path: "/workspace/mobile/workbench_screen.dart" },
      ],
      status: "completed",
    },
    { completed: true, turnId: "turn-1" },
  );
  assert.equal(files.activity_type, "file_change");
  assert.equal(
    files.activity_subject,
    "workbench-page.tsx、workbench_screen.dart",
  );
  assert.equal(files.activity_count, 2);

  const image = codexToolActivityEventFromItem(
    { id: "image-1", type: "ImageView", path: "/tmp/screen.png" },
    { completed: true, turnId: "turn-1" },
  );
  assert.equal(image.activity_type, "image_view");
  assert.equal(image.activity_subject, "screen.png");
  assert.equal(image.status, "completed");

  assert.equal(
    codexToolActivityEventFromItem({ id: "reason-1", type: "reasoning" }),
    null,
  );
});

test("[relay] external Codex rollout exec calls expose only the nested command preview", () => {
  const state = { currentTurnId: null, pendingCalls: new Map() };
  codexRolloutActivityEvents(
    {
      type: "turn_context",
      payload: { turn_id: "turn-external" },
    },
    state,
  );
  const started = codexRolloutActivityEvents(
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        call_id: "call-1",
        name: "exec",
        input:
          'const result = await tools.exec_command({cmd:"npm run mobile:check",workdir:"/relay-workspace"}); text(result.output);',
      },
    },
    state,
  );
  const completed = codexRolloutActivityEvents(
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: "call-1",
        output: "secret tool output",
      },
    },
    state,
  );
  assert.equal(started[0].kind, "command.started");
  assert.equal(started[0].turn_id, "turn-external");
  assert.equal(started[0].activity_type, "command");
  assert.equal(started[0].command, "npm run mobile:check");
  assert.equal(completed[0].kind, "command.completed");
  assert.equal(completed[0].item_id, started[0].item_id);
  assert.equal(completed[0].command, "npm run mobile:check");
  assert.doesNotMatch(
    JSON.stringify([...started, ...completed]),
    /secret tool output/,
  );

  const search = codexRolloutActivityEvents(
    {
      type: "event_msg",
      payload: {
        type: "item_completed",
        turn_id: "turn-external",
        item: {
          id: "web-2",
          type: "Extension",
          kind: "WebSearch",
          query: "OpenAI docs",
        },
      },
    },
    state,
  );
  assert.equal(search[0].activity_type, "web_search");
  assert.equal(search[0].activity_subject, "OpenAI docs");
  assert.equal(search[0].status, "completed");

  const finalAnswer = codexRolloutActivityEvents(
    {
      type: "event_msg",
      payload: {
        type: "item_completed",
        turn_id: "turn-external",
        item: {
          id: "message-final",
          type: "AgentMessage",
          phase: "final_answer",
          content: [{ type: "Text", text: "最终总结已同步到手机。" }],
        },
      },
    },
    state,
  );
  assert.deepEqual(finalAnswer, [
    {
      kind: "message.completed",
      turn_id: "turn-external",
      item_id: "message-final",
      text: "最终总结已同步到手机。",
      message_phase: "final_answer",
    },
  ]);
});

test("[relay] native command completion updates the matching rollout command once", () => {
  const state = { currentTurnId: "turn-command", pendingCalls: new Map() };
  const [started] = codexRolloutActivityEvents(
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        call_id: "call-short",
        name: "exec",
        input:
          'const r = await tools.exec_command({cmd:"npm test"}); text(r.output);',
      },
    },
    state,
  );
  const completed = codexRolloutActivityEvents(
    {
      type: "event_msg",
      payload: {
        type: "item_completed",
        turn_id: "turn-command",
        item: {
          type: "CommandExecution",
          id: "native-short",
          process_id: "101",
          command: ["/bin/zsh", "-lc", "npm test"],
          status: "completed",
          exit_code: 0,
        },
      },
    },
    state,
  );
  const wrapperOutput = codexRolloutActivityEvents(
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: "call-short",
        output: "All tests passed.",
      },
    },
    state,
  );

  assert.equal(completed.length, 1);
  assert.equal(completed[0].kind, "command.completed");
  assert.equal(completed[0].item_id, started.item_id);
  assert.deepEqual(wrapperOutput, []);
});

test("[relay] yielded commands stay running until their native process exits", () => {
  const state = { currentTurnId: "turn-background", pendingCalls: new Map() };
  const [started] = codexRolloutActivityEvents(
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        call_id: "call-background",
        name: "exec",
        input:
          'const r = await tools.exec_command({cmd:"npm run build",yield_time_ms:250}); text(r.output); if (r.session_id) text(`SESSION_ID=${r.session_id}`);',
      },
    },
    state,
  );
  const yielded = codexRolloutActivityEvents(
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: "call-background",
        output: [
          { type: "input_text", text: "Script completed\nOutput:\n" },
          { type: "input_text", text: "SESSION_ID=77874" },
        ],
      },
    },
    state,
  );

  assert.deepEqual(yielded, []);

  const completed = codexRolloutActivityEvents(
    {
      type: "event_msg",
      payload: {
        type: "item_completed",
        turn_id: "turn-background",
        item: {
          type: "CommandExecution",
          id: "native-background",
          process_id: "77874",
          command: ["/bin/zsh", "-lc", "npm run build"],
          status: "completed",
          exit_code: 0,
        },
      },
    },
    state,
  );

  assert.equal(completed.length, 1);
  assert.equal(completed[0].kind, "command.completed");
  assert.equal(completed[0].status, "completed");
  assert.equal(completed[0].item_id, started.item_id);
});

test("[relay] orchestration exec calls retain their nested activity meaning", () => {
  const state = { currentTurnId: "turn-orchestration", pendingCalls: new Map() };
  const eventFor = (callId, input) =>
    codexRolloutActivityEvents(
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          call_id: callId,
          name: "exec",
          input,
        },
      },
      state,
    )[0];

  const patch = eventFor(
    "patch",
    "const result = await tools.apply_patch(patch); text(result);",
  );
  assert.equal(patch.activity_type, "file_change");
  assert.equal(patch.command, null);

  const namedPatch = eventFor(
    "named-patch",
    `const patch = "*** Begin Patch\\n*** Update File: /workspace/app/workbench-page.tsx\\n*** Update File: /workspace/mobile/workbench_screen.dart\\n*** End Patch"; await tools.apply_patch(patch);`,
  );
  assert.equal(namedPatch.activity_type, "file_change");
  assert.equal(namedPatch.activity_count, 2);
  assert.equal(
    namedPatch.activity_subject,
    "workbench-page.tsx、workbench_screen.dart",
  );

  const readFile = eventFor(
    "read-file",
    `await tools.exec_command({cmd: "sed -n '1,120p' mobile/lib/src/ui/workbench_screen.dart"});`,
  );
  assert.equal(readFile.activity_type, "file_read");
  assert.equal(readFile.activity_count, 1);
  assert.equal(readFile.activity_subject, "workbench_screen.dart");

  const plan = eventFor(
    "plan",
    "const result = await tools.update_plan({plan: []}); text(result);",
  );
  assert.equal(plan.activity_type, "tool_call");
  assert.equal(plan.activity_name, "update_plan");

  const variableCommand = eventFor(
    "variable-command",
    "const command = 'npm test'; await tools.exec_command({cmd: command});",
  );
  assert.equal(variableCommand.activity_type, "command");
  assert.equal(variableCommand.command, "exec_command");
});

test("[relay] app-server assistant deltas retain item identity for real streaming", async () => {
  const events = [];
  const adapter = new CodexAppServerAdapter({ workspace: "/relay-workspace" });
  adapter.handlers = {
    emitEvent: async (sessionId, event) => events.push({ sessionId, event }),
  };

  await adapter.handleNotification({
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-stream",
      turnId: "turn-stream",
      itemId: "answer-stream",
      delta: "真实增量",
      item: { phase: "final_answer" },
    },
  });

  assert.deepEqual(events, [
    {
      sessionId: "thread-stream",
      event: {
        kind: "message.delta",
        turn_id: "turn-stream",
        item_id: "answer-stream",
        text: "真实增量",
        message_phase: "final_answer",
      },
    },
  ]);
});

test("[relay] external Codex user messages are forwarded with stable item identity", () => {
  const state = { currentTurnId: "turn-external", pendingCalls: new Map() };
  const record = {
    type: "event_msg",
    payload: {
      type: "item_completed",
      thread_id: "thread-external",
      turn_id: "turn-external",
      item: {
        id: "user-item-external",
        type: "UserMessage",
        client_id: "desktop-client-message",
        content: [
          { type: "text", text: "ios 模拟器能输入中文么?\n" },
        ],
      },
    },
  };

  assert.deepEqual(codexRolloutActivityEvents(record, state), [
    {
      kind: "user.message",
      turn_id: "turn-external",
      item_id: "user-item-external",
      client_message_id: "desktop-client-message",
      text: "ios 模拟器能输入中文么?",
      attachments: [],
    },
  ]);
  assert.deepEqual(
    codexRolloutActivityEvents(record, state, { seed: true }),
    [],
  );
});

test("[relay] current SubAgentActivity rollout items become routed agent events", () => {
  const state = { currentTurnId: "turn-agents", pendingCalls: new Map() };
  const started = codexRolloutActivityEvents(
    {
      type: "event_msg",
      payload: {
        type: "item_completed",
        thread_id: "thread-root",
        turn_id: "turn-agents",
        item: {
          type: "SubAgentActivity",
          id: "call-layout",
          kind: "started",
          agent_thread_id: "thread-layout",
          agent_path: "/root/layout_audit",
        },
      },
    },
    state,
  );
  assert.equal(started.length, 1);
  assert.deepEqual(
    {
      kind: started[0].kind,
      agentId: started[0].agent_id,
      threadId: started[0].thread_id,
      rootId: started[0].root_session_id,
      name: started[0].name,
      status: started[0].agent_status,
      progress: started[0].progress,
    },
    {
      kind: "agent.started",
      agentId: "thread-layout",
      threadId: "thread-layout",
      rootId: "thread-root",
      name: "layout audit",
      status: "running",
      progress: 10,
    },
  );

  const [completed] = codexRolloutActivityEvents(
    {
      type: "event_msg",
      payload: {
        type: "item_completed",
        thread_id: "thread-root",
        turn_id: "turn-agents",
        item: {
          type: "SubAgentActivity",
          id: "subagent-completed-layout",
          kind: "completed",
          agent_thread_id: "thread-layout",
          agent_path: "/root/layout_audit",
        },
      },
    },
    state,
  );
  assert.equal(completed.kind, "agent.completed");
  assert.equal(completed.agent_status, "completed");
  assert.equal(completed.progress, 100);
});

test("[relay] app-server SubAgentActivity notifications route to the root task", async () => {
  const events = [];
  const adapter = new CodexAppServerAdapter({ workspace: "/relay-workspace" });
  adapter.handlers = {
    emitEvent: async (sessionId, event, extra) =>
      events.push({ sessionId, event, extra }),
  };
  adapter.rememberThread({
    id: "thread-root",
    sessionId: "thread-root",
    cwd: "/relay-workspace",
  });

  await adapter.handleNotification({
    method: "item/completed",
    params: {
      threadId: "thread-root",
      turnId: "turn-agents",
      item: {
        type: "subAgentActivity",
        id: "call-mobile",
        kind: "interacted",
        agentThreadId: "thread-mobile",
        agentPath: "/root/mobile_check",
      },
    },
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].sessionId, "thread-root");
  assert.deepEqual(events[0].extra, { agent_id: "thread-mobile" });
  assert.equal(events[0].event.kind, "agent.progress");
  assert.equal(events[0].event.name, "mobile check");
  assert.equal(events[0].event.agent_status, "running");
});

test("[relay] external Codex rollout lifecycle is explicit, terminal, and idempotent", () => {
  const state = { currentTurnId: null, pendingCalls: new Map() };
  const startedRecord = {
    timestamp: "2026-08-29T08:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "task_started",
      turn_id: "turn-lifecycle",
      started_at: 1_788_000_000,
    },
  };
  assert.deepEqual(codexRolloutActivityEvents(startedRecord, state), [
    { kind: "turn.started", turn_id: "turn-lifecycle" },
  ]);
  assert.equal(state.activeTurnId, "turn-lifecycle");
  assert.deepEqual(codexRolloutActivityEvents(startedRecord, state), []);

  const abortedRecord = {
    type: "event_msg",
    payload: {
      type: "turn_aborted",
      turn_id: "turn-lifecycle",
      reason: "interrupted",
    },
  };
  assert.deepEqual(codexRolloutActivityEvents(abortedRecord, state), [
    {
      kind: "turn.completed",
      turn_id: "turn-lifecycle",
      status: "interrupted",
    },
  ]);
  assert.equal(state.activeTurnId, null);
  assert.deepEqual(codexRolloutActivityEvents(abortedRecord, state), []);
});

test("[relay] rollout seed folds history to only the final lifecycle state", () => {
  const state = { currentTurnId: null, pendingCalls: new Map() };
  const seed = (type, turnId) =>
    codexRolloutActivityEvents(
      {
        type: "event_msg",
        payload: { type, turn_id: turnId, started_at: 1_788_000_000 },
      },
      state,
      { seed: true },
    );

  assert.deepEqual(seed("task_started", "turn-old"), []);
  assert.deepEqual(seed("task_complete", "turn-old"), []);
  assert.deepEqual(seed("task_started", "turn-current"), []);
  assert.equal(state.lifecycleKnown, true);
  assert.equal(state.activeTurnId, "turn-current");
});

test("[relay] notLoaded Codex desktop tasks derive catalog status from the rollout lifecycle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relayune-codex-rollout-"));
  const rolloutPath = join(directory, "rollout.jsonl");
  const events = [];
  const adapter = new CodexAppServerAdapter({ workspace: "/relay-workspace" });
  adapter.handlers = {
    emitEvent: async (sessionId, event) => events.push({ sessionId, event }),
  };
  adapter.request = async (method) => {
    if (method !== "thread/list") throw new Error(`Unexpected ${method}`);
    return {
      data: [
        {
          id: "thread-external",
          cwd: "/relay-workspace",
          name: "[已完成] Codex desktop task",
          path: rolloutPath,
          status: { type: "notLoaded" },
          updatedAt: 1_787_821_130,
        },
      ],
    };
  };
  try {
    await writeFile(
      rolloutPath,
      `${JSON.stringify({
        type: "event_msg",
        payload: {
          type: "task_started",
          turn_id: "turn-live",
          started_at: 1_788_000_000,
        },
      })}\n`,
    );
    let [session] = await adapter.listSessions();
    assert.equal(events.length, 0);
    assert.equal(session.status, "active");
    assert.equal(session.can_interrupt, true, "an active Desktop rollout supports owner interruption");

    await appendFile(
      rolloutPath,
      `${JSON.stringify({
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-live",
          name: "open_in_codex",
          arguments: "private arguments",
        },
      })}\n`,
    );
    [session] = await adapter.listSessions();
    assert.equal(events.at(-1).event.kind, "command.started");
    assert.equal(events.at(-1).event.activity_name, "open_in_codex");
    assert.equal(session.status, "active");

    await appendFile(
      rolloutPath,
      `${JSON.stringify({
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-live",
          output: "private output",
        },
      })}\n`,
    );
    [session] = await adapter.listSessions();
    assert.equal(events.at(-1).event.kind, "command.completed");
    assert.equal(session.status, "active");
    assert.doesNotMatch(JSON.stringify(events), /private arguments|private output/);

    await appendFile(
      rolloutPath,
      `${JSON.stringify({
        type: "event_msg",
        payload: {
          type: "item_completed",
          turn_id: "turn-live",
          item: {
            id: "final-live",
            type: "AgentMessage",
            phase: "final_answer",
            content: [{ type: "Text", text: "手机端不可丢失的最终回复" }],
          },
        },
      })}\n`,
    );
    [session] = await adapter.listSessions();
    assert.equal(events.at(-1).event.kind, "message.completed");
    assert.equal(events.at(-1).event.text, "手机端不可丢失的最终回复");
    assert.equal(events.at(-1).event.message_phase, "final_answer");
    assert.equal(session.status, "active");

    await appendFile(
      rolloutPath,
      `${JSON.stringify({
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-live" },
      })}\n`,
    );
    [session] = await adapter.listSessions();
    assert.equal(events.at(-1).event.kind, "turn.completed");
    assert.equal(events.at(-1).event.turn_id, "turn-live");
    assert.equal(session.status, "idle");

    [session] = await adapter.listSessions();
    assert.equal(events.filter(({ event }) => event.kind === "turn.completed").length, 1);
    assert.equal(session.status, "idle");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("[relay] rollout seed finds an active turn that started before the activity tail", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relayune-codex-rollout-"));
  const rolloutPath = join(directory, "long-rollout.jsonl");
  const adapter = new CodexAppServerAdapter({ workspace: "/relay-workspace" });
  adapter.handlers = { emitEvent: async () => {} };
  adapter.request = async () => ({
    data: [
      {
        id: "thread-long-running",
        cwd: "/relay-workspace",
        path: rolloutPath,
        status: { type: "notLoaded" },
      },
    ],
  });
  try {
    await writeFile(
      rolloutPath,
      `${JSON.stringify({
        type: "event_msg",
        payload: {
          type: "task_started",
          turn_id: "turn-before-tail",
          started_at: 1_788_000_000,
        },
      })}\n${JSON.stringify({
        type: "response_item",
        payload: { type: "reasoning", encrypted_content: "x".repeat(600_000) },
      })}\n`,
    );

    const [session] = await adapter.listSessions();
    assert.equal(session.status, "active");
    assert.equal(session.running_started_at, "2026-08-29T10:40:00.000Z");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("[relay] latest Codex history restores compact tool activity cards", async () => {
  const adapter = new CodexAppServerAdapter({ workspace: "/relay-workspace" });
  adapter.handlers = { emitEvent: async () => {} };
  adapter.request = async (method, params) => {
    if (method === "thread/read") {
      return {
        thread: {
          id: "thread-history",
          cwd: "/relay-workspace",
          status: { type: "notLoaded" },
          turns: [
            {
              id: "turn-history",
              status: "inProgress",
              startedAt: 1_787_821_130,
              items: [
                {
                  id: "user-1",
                  type: "userMessage",
                  content: [{ type: "text", text: "continue" }],
                },
                {
                  id: "web-history",
                  type: "webSearch",
                  query: "Relayune",
                },
                {
                  id: "command-history",
                  type: "commandExecution",
                  command: ["/bin/zsh", "-lc", "npm test"],
                  status: "completed",
                },
                { id: "compact-history", type: "contextCompaction" },
              ],
            },
          ],
        },
      };
    }
    if (method === "thread/list" && params.ancestorThreadId) {
      return { data: [], nextCursor: null };
    }
    throw new Error(`Unexpected ${method}`);
  };

  const page = await adapter.readHistory({ sessionId: "thread-history" });
  const tools = page.messages.filter((message) => message.kind === "tool_activity");
  assert.equal(tools.length, 3);
  assert.equal(tools[0].tool_activity_type, "web_search");
  assert.equal(tools[0].tool_activity_status, "completed");
  assert.equal(tools[1].tool_activity_type, "command");
  assert.equal(tools[1].tool_activity_command, "npm test");
  assert.equal(tools[2].tool_activity_type, "context_compaction");
  assert.equal(tools[2].tool_activity_status, "running");
});

test("[relay] history restores agents from current SubAgentActivity items", async () => {
  const adapter = new CodexAppServerAdapter({ workspace: "/relay-workspace" });
  adapter.handlers = { emitEvent: async () => {} };
  adapter.request = async (method, params) => {
    if (method === "thread/read") {
      return {
        thread: {
          id: "thread-agent-history",
          cwd: "/relay-workspace",
          status: { type: "active" },
          createdAt: 1_788_000_000,
          updatedAt: 1_788_000_100,
          turns: [
            {
              id: "turn-agent-history",
              status: "inProgress",
              items: [
                {
                  type: "subAgentActivity",
                  id: "call-layout",
                  kind: "started",
                  agentThreadId: "thread-layout",
                  agentPath: "/root/layout_audit",
                },
                {
                  type: "subAgentActivity",
                  id: "call-animation",
                  kind: "started",
                  agentThreadId: "thread-animation",
                  agentPath: "/root/animation_check",
                },
                {
                  type: "subAgentActivity",
                  id: "subagent-completed-layout",
                  kind: "completed",
                  agentThreadId: "thread-layout",
                  agentPath: "/root/layout_audit",
                },
              ],
            },
          ],
        },
      };
    }
    if (method === "thread/list" && params.ancestorThreadId) {
      return { data: [], nextCursor: null };
    }
    throw new Error(`Unexpected ${method}`);
  };

  const page = await adapter.readHistory({ sessionId: "thread-agent-history" });
  assert.equal(page.agents.length, 2);
  assert.deepEqual(
    page.agents.map(({ name, status, progress }) => ({
      name,
      status,
      progress,
    })),
    [
      { name: "layout audit", status: "completed", progress: 100 },
      { name: "animation check", status: "running", progress: 10 },
    ],
  );
});

 test("[relay] history recovers external user items once and before their reply", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relayune-user-history-"));
  const path = join(directory, "rollout.jsonl");
  const user = { type: "UserMessage", id: "external-user", client_id: "client-user",
    content: [{ type: "text", text: "install on my phone" }] };
  const adapter = new CodexAppServerAdapter({ workspace: directory });
  adapter.handlers = { emitEvent: async () => {} };
  let materialized = false;
  adapter.request = async method => method === "thread/read" ? { thread: {
    id: "thread-user", cwd: directory, path, turns: [{ id: "turn-user",
      startedAt: 1788970231, completedAt: 1788970240, status: "completed",
      items: materialized ? [{ ...user, type: "userMessage" }] : [] }],
  } } : { data: [], nextCursor: null };
  try {
    await writeFile(path, [
      { timestamp: "2026-09-09T16:10:31.924Z", type: "event_msg", payload: {
        type: "item_completed", turn_id: "turn-user", item: user } },
      { timestamp: "2026-09-09T16:10:40.000Z", type: "event_msg", payload: {
        type: "item_completed", turn_id: "turn-user", item: {
          type: "AgentMessage", id: "reply", phase: "final_answer", text: "ready" } } },
    ].map(JSON.stringify).join("\n") + "\n");
    for (const present of [false, true]) {
      materialized = present;
      const page = await adapter.readHistory({ sessionId: "thread-user", includeAgentDetails: true });
      assert.deepEqual(page.messages.map(m => m.id), ["external-user", "reply"]);
      assert.equal(page.messages[0].content, "install on my phone");
      assert.equal(page.messages[0].turn_id, "turn-user");
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const materialized of [false, true]) {
  test(`[relay] cold history preserves an image-bearing first user message (materialized=${materialized})`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'relayune-first-image-message-'));
    const path = join(directory, 'rollout.jsonl');
    const user = { type: 'UserMessage', id: 'first-user', content: [
      { type: 'text', text: 'Please inspect this screenshot.' },
      { type: 'image', url: 'data:image/png;base64,aGVsbG8=' },
    ] };
    const adapter = new CodexAppServerAdapter({ workspace: directory });
    adapter.request = async method => method === 'thread/read' ? { thread: {
      id: 'thread-image', cwd: directory, path, turns: [{ id: 'turn-image',
        startedAt: 1788970231, completedAt: 1788970240, status: 'completed',
        items: materialized ? [{ ...user, type: 'userMessage' }] : [] }],
    } } : { data: [], nextCursor: null };
    try {
      await writeFile(path, [
        { timestamp: '2026-09-09T16:10:31.000Z', type: 'event_msg', payload: {
          type: 'item_completed', turn_id: 'turn-image', item: user } },
        { timestamp: '2026-09-09T16:10:40.000Z', type: 'event_msg', payload: {
          type: 'item_completed', turn_id: 'turn-image', item: {
            type: 'AgentMessage', id: 'reply', phase: 'final_answer', text: 'Inspected.' } } },
      ].map(JSON.stringify).join('\n') + '\n');
      const page = await adapter.readHistory({ sessionId: 'thread-image', includeAgentDetails: false, maxBytes: 262144 });
      assert.equal(page.has_more, false);
      assert.deepEqual(page.messages.map(m => m.id), ['first-user', 'reply']);
      assert.equal(page.messages[0].content, 'Please inspect this screenshot.');
      assert.equal(page.messages[0].role, 'user');
      assert.equal(page.messages[0].attachments.length, 1);
      assert.equal(page.messages[1].attachments?.length ?? 0, 0);
    } finally { await adapter.close(); await rm(directory, { recursive: true, force: true }); }
  });
}

test('subagent tool starts and completion reach the root immediately without tool output', async () => {
  const adapter = new CodexAppServerAdapter({ workspace: '/fixture' });
  const events = [];
  adapter.handlers = { emitEvent: async (sessionId, event, meta) => events.push({ sessionId, event, meta }) };
  adapter.rememberThread({ id: 'root', sessionId: 'root' });
  adapter.rememberThread({ id: 'parent', parentThreadId: 'root', sessionId: 'parent' });
  adapter.rememberThread({ id: 'child', parentThreadId: 'parent', sessionId: 'child', agentNickname: 'Worker' });
  const item = { id: 'tool', type: 'commandExecution', command: 'npm test', status: 'inProgress' };
  await adapter.handleItem('child', 'turn', item, false);
  assert.equal(events.at(-1).sessionId, 'root');
  assert.equal(events.at(-1).meta.agent_id, 'child');
  assert.match(events.at(-1).event.current_activity, /正在执行命令.*npm test/);
  assert.ok(Date.parse(events.at(-1).event.updated_at));
  await adapter.handleItem('child', 'turn', { ...item, status: 'completed', aggregatedOutput: 'private output' }, true);
  assert.match(events.at(-1).event.current_activity, /已完成/);
  assert.doesNotMatch(JSON.stringify(events.at(-1)), /private output/);
  await adapter.handleItem('root', 'turn', item, false);
  assert.equal(events.at(-1).event.kind, 'command.started');
});

test('external subagent rollout forwards tool activity and original timestamps to its root', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'relayune-child-activity-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'child.jsonl');
  const timestamp = '2026-09-18T10:01:02.000Z';
  const start = { timestamp, type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn' } };
  const call = { timestamp, type: 'response_item', payload: { type: 'function_call', call_id: 'call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'npm test' }) } };
  await writeFile(path, [start, call].map(JSON.stringify).join('\n') + '\n');
  const adapter = new CodexAppServerAdapter({ workspace: dir });
  const events = [];
  adapter.handlers = { emitEvent: async (sessionId, event, meta) => events.push({ sessionId, event, meta }) };
  adapter.syncExternalQuestions = async () => {};
  adapter.reconcileExternalRuntime = async () => {};
  adapter.rememberThread({ id: 'root', sessionId: 'root' });
  const thread = { id: 'child', parentThreadId: 'root', sessionId: 'child', path, status: { type: 'notLoaded' } };
  adapter.rememberThread(thread);
  await adapter.pollExternalRolloutActivity(thread);
  assert.equal(events.at(-1).sessionId, 'root');
  assert.equal(events.at(-1).event.updated_at, timestamp);
  assert.match(events.at(-1).event.current_activity, /npm test/);
  const completedAt = '2026-09-18T10:01:04.000Z';
  await appendFile(path, JSON.stringify({ timestamp: completedAt, type: 'response_item', payload: { type: 'function_call_output', call_id: 'call', output: 'Process exited with code 0' } }) + '\n');
  await adapter.pollExternalRolloutActivity(thread);
  assert.equal(events.at(-1).event.updated_at, completedAt);
  assert.match(events.at(-1).event.current_activity, /已完成/);
  const count = events.length;
  await adapter.pollExternalRolloutActivity(thread);
  assert.equal(events.length, count);
});

test('agent snapshots include current tool activity before any live notification', async () => {
  const adapter = new CodexAppServerAdapter({ workspace: '/fixture' });
  adapter.rememberThread({ id: 'root' });
  adapter.request = async (method, params) => method === 'thread/list'
    ? { data: [{ id: 'child', parentThreadId: 'root', status: { type: 'active' }, updatedAt: 1789725662 }] }
    : { thread: { id: 'child', updatedAt: 1789725662, turns: [{ id: 'turn', status: 'inProgress', items: [{ id: 'read', type: 'fileRead', path: '/fixture/example.dart', status: 'inProgress' }] }] } };
  const agents = await adapter.readAgents({ sessionId: 'root' });
  assert.equal(agents.length, 1);
  assert.match(agents[0].current_activity, /正在读取文件.*example.dart/);
  assert.equal(agents[0].activity_log[0].occurred_at, agents[0].updated_at);
});

test('concurrent catalog and panel polls share one rollout read', async () => {
  const adapter = new CodexAppServerAdapter({ workspace: '/fixture' });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  adapter.pollExternalRolloutActivityOnce = async () => { calls++; await gate; };
  const first = adapter.pollExternalRolloutActivity({ id: 'child' });
  const second = adapter.pollExternalRolloutActivity({ id: 'child' });
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);
  await adapter.pollExternalRolloutActivity({ id: 'child' });
  assert.equal(calls, 2);
});

test('failed task_complete preserves the terminal error and cannot stop a newer turn', () => {
  const state = { pendingCalls: new Map() };
  const record = (type, extra = {}) => ({ type: 'event_msg', timestamp: '2026-10-08T01:00:00Z',
    payload: { type, turn_id: 'old', ...extra } });
  codexRolloutActivityEvents(record('task_started'), state);
  codexRolloutActivityEvents(record('task_started', { turn_id: 'new' }), state);
  const failure = record('task_complete', { error: { message: 'stream disconnected before completion: error sending request' } });
  assert.deepEqual(codexRolloutActivityEvents(failure, state), [{ kind: 'turn.failed', turn_id: 'old',
    status: 'failed', error: failure.payload.error.message }]);
  assert.equal(state.activeTurnId, 'new');
  assert.equal(state.terminalTurnStatuses.get('old'), 'failed');
  assert.deepEqual(codexRolloutActivityEvents(failure, state), []);
  assert.deepEqual(codexRolloutActivityEvents(record('task_complete', { turn_id: 'new', error: null }), state),
    [{ kind: 'turn.completed', turn_id: 'new', status: 'completed' }]);
});

test('native turn failure forwards the error through the same terminal contract', async t => {
  const adapter = new CodexAppServerAdapter({ workspace: '/tmp' });
  t.after(() => adapter.close());
  const events = [];
  adapter.handlers = { emitEvent: async (_id, event) => events.push(event) };
  adapter.verifyCompletedTurnPersistence = async () => {};
  adapter.activeTurns.set('thread', 'turn');
  adapter.liveTurns.set('thread', 'turn');
  await adapter.handleNotification({ method: 'turn/completed', params: { threadId: 'thread',
    turn: { id: 'turn', status: 'failed', error: { message: 'stream disconnected before completion' } } } });
  assert.deepEqual(events, [{ kind: 'turn.failed', turn_id: 'turn', status: 'failed',
    error: 'stream disconnected before completion' }]);
  assert.equal(adapter.activeTurns.has('thread'), false);
  assert.equal(adapter.liveTurns.has('thread'), false);
});
