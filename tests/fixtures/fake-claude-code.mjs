#!/usr/bin/env node
import { createInterface } from "node:readline";

if (process.argv.includes("--version")) {
  process.stdout.write("2.1.220 (Claude Code)\n");
  process.exit(0);
}

if (process.argv.includes("--help")) {
  process.stdout.write('Fixture help padding '.repeat(600) + '\n');
  process.stdout.write('--permission-mode <mode> Permission mode (choices: "default", "acceptEdits", "auto", "plan", "dontAsk", "bypassPermissions")\n  --model <model> Model\n');
  process.exit(0);
}

const sessionId =
  valueAfter("--session-id") ??
  valueAfter("--resume") ??
  "550e8400-e29b-41d4-a716-446655440000";
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let initialized = false;
let pendingPermission = null;

input.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.type === "control_request" && message.request?.subtype === "initialize") {
    emit({ type: "control_response", response: {
      subtype: "success", request_id: message.request_id,
      response: { current_permission_mode: process.argv.includes("--fixture-permission-fallback") ? "default" : valueAfter("--permission-mode") ?? "default", models: [
        { value: "default", displayName: "Default", supportsEffort: true, supportedEffortLevels: ["low", "high"] },
        { value: "sonnet", displayName: "Sonnet", supportsEffort: true, supportedEffortLevels: ["low", "high"] },
        { value: "haiku", displayName: "Haiku" },
      ], account: { email: "never-export@example.test" } },
    } });
    return;
  }
  if (message.type === "control_response" && pendingPermission) {
    const current = pendingPermission;
    pendingPermission = null;
    const response = message.response?.response;
    emit({
      type: "user",
      session_id: sessionId,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: current.toolUseId,
            content:
              response?.behavior === "allow"
                ? "command completed"
                : "command rejected",
            is_error: response?.behavior !== "allow",
          },
        ],
      },
    });
    current.resolve(response);
    return;
  }
  if (message.type !== "user") return;
  void runTurn(message);
});

input.on("close", () => process.exit(0));

async function runTurn(message) {
  if (!initialized) {
    initialized = true;
    emit({
      type: "system",
      subtype: "init",
      cwd: process.cwd(),
      session_id: sessionId,
      model: "claude-sonnet-4-6",
      permissionMode: valueAfter("--permission-mode") ?? "default",
      tools: ["Read", "Bash", "Agent"],
    });
  }
  const prompt = textFromContent(message.message?.content);
  let finalText = "已完成";
  if (/wire mapping/i.test(prompt)) {
    finalText = [
      message.session_id,
      valueAfter("--resume"),
      valueAfter("--model"),
      valueAfter("--permission-mode"),
    ].join("|");
  }
  if (/approval/i.test(prompt)) {
    const toolUseId = "toolu_permission_1";
    emit({
      type: "assistant",
      session_id: sessionId,
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [
          {
            type: "tool_use",
            id: toolUseId,
            name: "Bash",
            input: { command: "npm test", description: "Run tests" },
          },
        ],
      },
    });
    await new Promise((resolve) => {
      pendingPermission = { toolUseId, resolve };
      emit({
        type: "control_request",
        request_id: "control_permission_1",
        request: {
          subtype: "can_use_tool",
          tool_name: "Bash",
          input: { command: "npm test", description: "Run tests" },
          tool_use_id: toolUseId,
        },
      });
    });
  }
  if (/question/i.test(prompt)) {
    const toolUseId = "toolu_question_1";
    const questions = [
      {
        question: "Which theme?",
        header: "Theme",
        multiSelect: false,
        options: [
          { label: "Dark", description: "Use the dark theme" },
          { label: "Light", description: "Use the light theme" },
        ],
      },
      {
        question: "Which density?",
        header: "Density",
        multiSelect: false,
        options: [
          { label: "Compact", description: "Show more content" },
          { label: "Comfortable", description: "Use more spacing" },
        ],
      },
    ];
    emit({
      type: "assistant",
      session_id: sessionId,
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [
          {
            type: "tool_use",
            id: toolUseId,
            name: "AskUserQuestion",
            input: { questions },
          },
        ],
      },
    });
    const response = await new Promise((resolve) => {
      pendingPermission = { toolUseId, resolve };
      emit({
        type: "control_request",
        request_id: "control_question_1",
        request: {
          subtype: "can_use_tool",
          tool_name: "AskUserQuestion",
          input: { questions },
          tool_use_id: toolUseId,
        },
      });
    });
    const answers = response?.updatedInput?.answers ?? {};
    finalText = `${answers["Which theme?"] ?? "?"}/${answers["Which density?"] ?? "?"}`;
  }
  if (/subagent/i.test(prompt)) {
    const toolUseId = "toolu_agent_1";
    emit({
      type: "assistant",
      session_id: sessionId,
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [
          {
            type: "tool_use",
            id: toolUseId,
            name: "Task",
            input: {
              description: "Review tests",
              prompt: "Review the test coverage",
              subagent_type: "Explore",
            },
          },
        ],
      },
    });
    emit({ type: "system", subtype: "task_started", task_id: "task_review", tool_use_id: toolUseId, description: "Review tests" });
    emit({ type: "assistant", parent_tool_use_id: toolUseId, session_id: sessionId,
      message: { role: "assistant", content: [{type: "tool_use", id: "toolu_child_bash", name: "Bash", input: {command: "npm test"}}] } });
    emit({ type: "system", subtype: "task_progress", task_id: "task_review", description: "Running tests",
      usage: { tool_uses: 1, total_tokens: 1200, duration_ms: 1500 } });
    emit({ type: "user", parent_tool_use_id: toolUseId, session_id: sessionId,
      message: { role: "user", content: [{type: "tool_result", tool_use_id: "toolu_child_bash", content: "Tests passed"}] } });
    emit({
      type: "user",
      session_id: sessionId,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseId,
            content: "Coverage reviewed",
            is_error: false,
          },
        ],
      },
    });
  }
  if (/auth failure/i.test(prompt)) {
    emit({
      type: "result",
      subtype: "success",
      session_id: sessionId,
      is_error: true,
      error: "authentication_failed",
      result: "Not logged in · Please run /login",
      stop_reason: "stop_sequence",
    });
    return;
  }
  emit({
    type: "stream_event",
    session_id: sessionId,
    parent_tool_use_id: null,
    event: {
      type: "content_block_delta",
      delta: { type: "text_delta", text: finalText },
    },
  });
  emit({
    type: "assistant",
    session_id: sessionId,
    message: {
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: finalText }],
    },
  });
  emit({
    type: "result",
    subtype: "success",
    session_id: sessionId,
    is_error: false,
    result: finalText,
    stop_reason: "end_turn",
  });
}

function emit(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text")
    .map((block) => block.text)
    .join("\n");
}
