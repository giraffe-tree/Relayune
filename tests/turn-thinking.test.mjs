import assert from "node:assert/strict";
import test from "node:test";
import { withThinkingState } from "../relay/turn-thinking.mjs";
import { KimiCodeAdapter } from "../relay/kimi-adapter.mjs";
import { OpenCodeAdapter } from "../relay/opencode-adapter.mjs";
import { MCodeAdapter } from "../relay/mcode-adapter.mjs";
import { CodexAppServerAdapter } from "../relay/codex-adapters.mjs";
import { ClaudeCodeAdapter } from "../relay/claude-adapter.mjs";

test("thinking is scoped to a live turn, deduplicated and contains no reasoning text", async () => {
  const events = [];
  const handlers = withThinkingState({ emitEvent: async (id, event) => events.push({ id, ...event }) });
  const emit = (kind, rest = {}) => handlers.emitEvent("a", { kind, turn_id: "one", ...rest });
  await emit("turn.thinking", { active: true }); // No live turn yet.
  assert.equal(events.length, 0);
  await emit("turn.started");
  await emit("turn.thinking", { active: true, text: "private reasoning", provider: "kimi" });
  await emit("turn.thinking", { active: true });
  await handlers.emitEvent("a", { kind: "turn.thinking", turn_id: "old", active: false });
  await handlers.emitEvent("b", { kind: "turn.thinking", turn_id: "one", active: true });
  assert.deepEqual(events.at(-1), { id: "a", kind: "turn.thinking", turn_id: "one", active: true, provider: "kimi" });
  await emit("command.started");
  await emit("turn.thinking", { active: true });
  await emit("turn.thinking", { active: false });
  await emit("turn.thinking", { active: false });
  await emit("turn.completed");
  await emit("turn.thinking", { active: true });
  assert.deepEqual(events.filter(e => e.kind === "turn.thinking").map(e => e.active), [true, true, false]);
  assert.doesNotMatch(JSON.stringify(events), /private reasoning/);
});

test("approvals, replies and newer turns end a thinking interval", async () => {
  const events = [];
  const h = withThinkingState({ emitEvent: async (_, e) => events.push(e), requestApproval: async () => {} });
  const emit = (kind, active) => h.emitEvent("a", { kind, turn_id: "one", ...(active == null ? {} : { active }) });
  await emit("turn.started");
  await emit("turn.thinking", true);
  await h.requestApproval({ session_id: "a", turn_id: "one" });
  await emit("turn.thinking", true);
  await emit("message.delta");
  await emit("turn.thinking", true);
  await h.emitEvent("a", { kind: "turn.started", turn_id: "two" });
  await emit("turn.thinking", true);
  assert.equal(events.filter(e => e.kind === "turn.thinking").length, 3);
});

for (const Adapter of [KimiCodeAdapter, OpenCodeAdapter, MCodeAdapter]) {
  test(`${Adapter.name} converts live ACP thought chunks, excludes history replay`, async () => {
    const adapter = new Adapter(), events = [];
    adapter.handlers = withThinkingState({ emitEvent: async (_, e) => events.push(e) });
    const thought = { method: "session/update", params: { sessionId: "a", update: {
      sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "private reasoning" },
    } } };
    await adapter.handleNotification(thought);
    assert.equal(events.length, 0);
    adapter.activeTurns.set("a", "one");
    await adapter.handlers.emitEvent("a", { kind: "turn.started", turn_id: "one" });
    await adapter.handleNotification(thought);
    await adapter.handleNotification(thought);
    assert.deepEqual(events.at(-1), { kind: "turn.thinking", turn_id: "one", active: true, provider: adapter.provider });
    assert.equal(events.filter(e => e.kind === "turn.thinking").length, 1);
    assert.doesNotMatch(JSON.stringify(events), /private reasoning/);
  });
  test(`${Adapter.name} normalizes ACP's successful stop reason`, async () => {
    const adapter = new Adapter(), events = [];
    adapter.handlers = withThinkingState({ emitEvent: async (_, e) => events.push(e) });
    adapter.activeTurns.set("a", "one");
    await adapter.completePrompt("a", "one", { stopReason: "end_turn" });
    assert.equal(events.find(e => e.kind === "turn.completed").status, "completed");
  });
}

test("Codex reasoning item boundaries and delta-only signals have no body", async () => {
  const adapter = new CodexAppServerAdapter(), events = [];
  adapter.handlers = withThinkingState({ emitEvent: async (_, e) => events.push(e) });
  await adapter.handlers.emitEvent("a", { kind: "turn.started", turn_id: "one" });
  for (const method of ["item/started", "item/reasoning/summaryTextDelta", "item/completed"]) {
    await adapter.handleNotification({ method, params: { threadId: "a", turnId: "one",
      item: { id: "r", type: "reasoning", content: ["private reasoning"] }, delta: "private reasoning" } });
  }
  assert.deepEqual(events.filter(e => e.kind === "turn.thinking").map(e => e.active), [true, false]);
  assert.doesNotMatch(JSON.stringify(events), /private reasoning/);
});

test("Claude stream thinking blocks are transient and child blocks cannot change the root", async () => {
  const adapter = new ClaudeCodeAdapter(), events = [];
  adapter.handlers = withThinkingState({ emitEvent: async (_, e) => events.push(e) });
  const connection = { turnId: "one", text: "" };
  adapter.processes.set("a", connection);
  await adapter.handlers.emitEvent("a", { kind: "turn.started", turn_id: "one" });
  const native = event => adapter.handleTurnMessage("a", { type: "stream_event", event }, connection);
  await native({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "private reasoning" } });
  await adapter.handleTurnMessage("a", { type: "stream_event", parent_tool_use_id: "child",
    event: { type: "content_block_stop", index: 0 } }, connection);
  assert.equal(events.at(-1).active, true);
  await native({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "private reasoning" } });
  await native({ type: "content_block_stop", index: 0 });
  assert.deepEqual(events.filter(e => e.kind === "turn.thinking").map(e => e.active), [true, false]);
  assert.doesNotMatch(JSON.stringify(events), /private reasoning/);
});
