import assert from "node:assert/strict";
import test from "node:test";
import {
  isSessionStatusRunning,
  mergeCatalogSessionsWithDetails,
  retainActiveSessionEntries,
  settleInactiveSessionActivities,
} from "../app/session-running-state.mjs";

test("Web 端只允许结构化状态决定会话是否运行", () => {
  for (const name of [
    "[进行中] 修复 Codex 状态",
    "[运行中] Kimi Code task",
    "[Running] Claude Code task",
    "[In progress] Agent task",
  ]) {
    assert.equal(isSessionStatusRunning({ name, status: "idle" }), false);
  }

  assert.equal(
    isSessionStatusRunning({ name: "[已完成] 修复 Codex 状态", status: "idle" }),
    false,
  );
  assert.equal(
    isSessionStatusRunning({ name: "[已完成] 普通会话", status: "active" }),
    true,
  );
  assert.equal(isSessionStatusRunning({ name: "[进行中] 缺少状态" }), false);
});

test("Catalog idle 清理陈旧 turn 与工具活动缓存", () => {
  const sessions = [
    { id: "idle", status: "idle" },
    { id: "active", status: "active" },
  ];
  assert.deepEqual(
    retainActiveSessionEntries(
      { idle: "turn_old", active: "turn_current", missing: "turn_orphan" },
      sessions,
    ),
    { active: "turn_current" },
  );

  const activeMessage = {
    id: "active_tool",
    toolActivity: { status: "running", label: "active" },
  };
  const idleMessage = {
    id: "idle_tool",
    toolActivity: { status: "running", label: "stale" },
  };
  const reconciled = settleInactiveSessionActivities(
    { active: [activeMessage], idle: [idleMessage] },
    sessions,
  );
  assert.equal(reconciled.active[0], activeMessage);
  assert.equal(reconciled.active[0].toolActivity.status, "running");
  assert.equal(reconciled.idle[0].toolActivity.status, "completed");
});

test("history 详情不能覆盖 Catalog 的运行状态", () => {
  const merged = mergeCatalogSessionsWithDetails(
    [
      {
        id: "root",
        name: "旧标题",
        status: "idle",
        running_started_at: null,
        can_interrupt: false,
      },
    ],
    [
      {
        id: "root",
        name: "新标题",
        status: "active",
        running_started_at: "2026-08-29T08:00:00.000Z",
        can_interrupt: true,
      },
      { id: "child", name: "子 Agent", status: "active" },
    ],
  );
  assert.deepEqual(merged[0], {
    id: "root",
    name: "新标题",
    status: "idle",
    running_started_at: null,
    can_interrupt: false,
  });
  assert.equal(merged[1].status, "active");
});
