import assert from "node:assert/strict";
import test from "node:test";
import {
  isToolActivityEvent,
  toolActivityLabel,
  toolActivityMessageId,
  toolActivityStatus,
} from "../app/tool-activity.mjs";

test("tool activity lifecycle updates share one stable message id per tool call", () => {
  const first = toolActivityMessageId(
    { item_id: "turn-1/tool-1" },
    "turn-1",
  );
  const second = toolActivityMessageId(
    { item_id: "turn-1/tool-1" },
    "turn-1",
  );
  const otherTool = toolActivityMessageId(
    { item_id: "turn-1/tool-2" },
    "turn-1",
  );

  assert.equal(first, second);
  assert.notEqual(first, otherTool);
  assert.equal(
    first,
    toolActivityMessageId(
      { item_id: "turn-1/tool-1" },
      "turn-1",
    ),
  );
  assert.notEqual(
    first,
    toolActivityMessageId(
      { item_id: "turn-1/tool-1" },
      "turn-2",
    ),
  );
});

test("structured Codex activities use Codex-style localized action labels", () => {
  assert.equal(
    toolActivityLabel(
      { activity_type: "web_search", activity_subject: "Relayune" },
      "本机操作",
      "zh-CN",
    ),
    "搜索网页：Relayune",
  );
  assert.equal(
    toolActivityLabel(
      { activity_type: "mcp_tool", activity_name: "browser / open" },
      "local operation",
      "en",
    ),
    "Use tool: browser / open",
  );
  assert.equal(
    toolActivityLabel(
      { activity_type: "context_compaction" },
      "本机操作",
      "zh-CN",
    ),
    "自动压缩上下文",
  );
  assert.equal(
    toolActivityLabel(
      { activity_type: "image_view", activity_subject: "screen.png" },
      "本机操作",
      "zh-CN",
    ),
    "查看图像：screen.png",
  );
  assert.equal(
    toolActivityLabel(
      {
        activity_type: "file_read",
        activity_subject: "workbench_screen.dart",
        activity_count: 1,
      },
      "本机操作",
      "zh-CN",
    ),
    "读取文件：workbench_screen.dart",
  );
  assert.equal(
    toolActivityLabel(
      {
        activity_type: "file_change",
        activity_subject: "workbench-page.tsx、workbench_screen.dart",
        activity_count: 2,
      },
      "本机操作",
      "zh-CN",
    ),
    "修改 2 个文件：workbench-page.tsx、workbench_screen.dart",
  );
});

test("tool activity falls back to the turn id for legacy events", () => {
  assert.equal(
    toolActivityMessageId({}, "turn-legacy"),
    "command_turn-legacy_legacy",
  );
});

test("Codex and Claude tool events normalize to the same visible lifecycle", () => {
  assert.equal(toolActivityStatus({ kind: "command.started" }), "running");
  assert.equal(toolActivityStatus({ kind: "command.output" }), "running");
  assert.equal(
    toolActivityStatus({ kind: "command.output", status: "completed" }),
    "completed",
  );
  assert.equal(
    toolActivityStatus({ kind: "command.completed", status: "failed" }),
    "failed",
  );
  assert.equal(
    toolActivityStatus({ kind: "command.completed" }),
    "completed",
  );
  assert.equal(isToolActivityEvent({ kind: "command.completed" }), true);
  assert.equal(isToolActivityEvent({ kind: "message.completed" }), false);
});
