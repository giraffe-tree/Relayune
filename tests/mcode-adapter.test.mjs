import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MCodeAdapter, mcodeHistoryMessages } from "../relay/mcode-adapter.mjs";
import { MultiAgentAdapter } from "../relay/multi-agent-adapter.mjs";
const fixture = fileURLToPath(new URL("./fixtures/fake-mcode-acp.mjs", import.meta.url));
async function waitFor(check) {
  for (let i = 0; i < 300; i++) { if (check()) return; await new Promise(r => setTimeout(r, 10)); }
  assert.fail("Expected ACP event did not arrive");
}
async function setup(t, scenario) {
  const directory = await mkdtemp(join(tmpdir(), "relayune-mcode-test-"));
  const options = { mcodeBin: process.execPath, mcodeArgs: [fixture, ...(scenario ? [scenario] : [])], workspace: directory, env: { ...process.env, MCODE_TEST_DIR: directory } };
  const adapter = new MCodeAdapter(options), events = [], approvals = [];
  const handlers = { emitEvent: async (sessionId, event) => events.push({ sessionId, ...event }), requestApproval: async a => approvals.push(a) };
  t.after(async () => { await adapter.close(); await rm(directory, { recursive: true, force: true }); });
  return { adapter, directory, options, events, approvals, handlers };
}

test("mcode creates, streams, approves only once, persists and restores through real stdio", async t => {
  const { adapter, directory, options, events, approvals, handlers } = await setup(t);
  const multi = new MultiAgentAdapter({ adapters: { mcode: adapter }, defaultProvider: "mcode" });
  await multi.start(handlers);
  const session = await multi.createSession({ provider: "mcode", cwd: directory });
  assert.equal(session.provider, "mcode"); assert.equal(session.kimi_config_options, undefined);
  await multi.submitMessage({ sessionId: session.id, content: "allowed.txt" });
  await waitFor(() => approvals.length === 1);
  assert.equal(approvals[0].provider, "mcode");
  assert.match(approvals[0].action.display, /allowed\.txt/);
  assert.equal(approvals[0].action.type, "file.change");
  assert.deepEqual(approvals[0].action.options.map(o => o.option_id), ["allow-once", "deny"]);
  await assert.rejects(multi.resolveApproval({ approvalId: approvals[0].approval_id, decision: "approved", optionId: "allow-always" }), /invalid/);
  await multi.resolveApproval({ approvalId: approvals[0].approval_id, decision: "approved", optionId: "allow-once" });
  await waitFor(() => events.some(e => e.kind === "turn.completed"));
  assert.equal(await readFile(join(directory, "allowed.txt"), "utf8"), "approved");
  assert.ok(events.some(e => e.kind === "command.output"));
  assert.ok(events.every(e => e.provider === "mcode"));
  assert.ok(!JSON.stringify(events).includes("PRIVATE"));
  await multi.close();
  const restored = new MCodeAdapter(options);
  try {
    await restored.start(handlers);
    assert.equal((await restored.listSessions())[0].id, session.id);
    const before = events.length;
    const history = await restored.readHistory({ sessionId: session.id });
    assert.deepEqual(history.messages.map(m => m.content), ["allowed.txt", "File written"]);
    assert.ok(history.messages.every(m => m.provider === "mcode"));
    assert.equal(events.length, before, "history must not appear as live output");
    const page = await restored.readHistory({ sessionId: session.id, limit: 1 });
    assert.equal(page.has_more, true);
    const older = await restored.readHistory({ sessionId: session.id, before: page.next_cursor });
    assert.equal(older.messages[0].content, "allowed.txt");
    await restored.submitMessage({ sessionId: session.id, content: "denied.txt" });
    await waitFor(() => approvals.length === 2);
    assert.notEqual(approvals[1].approval_id, approvals[0].approval_id, "reused RPC IDs across processes must not revive stale approvals");
    await assert.rejects(restored.resolveApproval({ approvalId: approvals[0].approval_id, decision: "approved" }), /no longer pending/);
    await restored.resolveApproval({ approvalId: approvals[1].approval_id, decision: "rejected" });
    await waitFor(() => !restored.activeTurns.size);
    await assert.rejects(access(join(directory, "denied.txt")));
  } finally { await restored.close(); }
});

test("mcode cancellation expires only that session approval and permits a new turn", async t => {
  const { adapter, directory, approvals, events, handlers } = await setup(t);
  await adapter.start(handlers);
  const a = await adapter.createSession({ cwd: directory }), b = await adapter.createSession({ cwd: directory });
  await adapter.submitMessage({ sessionId: a.id, content: "cancelled.txt" });
  await adapter.submitMessage({ sessionId: b.id, content: "other.txt" });
  await waitFor(() => approvals.length === 2);
  await assert.rejects(adapter.submitMessage({ sessionId: a.id, content: "duplicate.txt" }), /active turn/);
  await adapter.interruptTurn({ sessionId: a.id });
  await waitFor(() => !adapter.activeTurns.has(a.id));
  await assert.rejects(adapter.resolveApproval({ approvalId: approvals[0].approval_id, decision: "approved" }), /no longer pending/);
  assert.equal(adapter.pendingApprovals.size, 1);
  assert.ok(events.some(e => e.kind === "turn.completed" && e.status === "interrupted"));
  await adapter.resolveApproval({ approvalId: approvals[1].approval_id, decision: "approved" });
  await waitFor(() => !adapter.activeTurns.size);
  await assert.rejects(access(join(directory, "cancelled.txt")));
  assert.equal(await readFile(join(directory, "other.txt"), "utf8"), "approved");
  await adapter.submitMessage({ sessionId: a.id, content: "after.txt" });
  await waitFor(() => approvals.length === 3);
  await adapter.resolveApproval({ approvalId: approvals[2].approval_id, decision: "rejected" });
  await waitFor(() => !adapter.activeTurns.size);
});

test("mcode rejects images before starting, handles process failure and expires approval", async t => {
  const { adapter, directory, approvals, events, handlers } = await setup(t);
  await adapter.start(handlers);
  const session = await adapter.createSession({ cwd: directory });
  const beforeRejectedImage = events.length;
  await assert.rejects(adapter.submitMessage({ sessionId: session.id, content: "image", attachments: [{}] }), /text messages only/);
  assert.equal(events.length, beforeRejectedImage, "rejected input must not emit turn events");
  await adapter.submitMessage({ sessionId: session.id, content: "crash" });
  await waitFor(() => approvals.length === 1 && events.some(e => e.kind === "turn.failed"));
  assert.equal(adapter.pendingApprovals.size, 0);
  assert.equal(adapter.activeTurns.size, 0);
  assert.ok(events.some(e => e.kind === "approval.resolved"));
  assert.ok(events.every(e => !JSON.stringify(e).includes("Kimi")));
});

for (const [scenario, message] of [["auth", /mcode login/], ["missing-list", /session\/list/]]) test(`mcode startup rejects ${scenario} and closes the child`, async t => {
  const { adapter, handlers } = await setup(t, scenario);
  await assert.rejects(adapter.start(handlers), message);
  assert.equal(adapter.client, null);
});

test("mcode preserves native message boundaries, stable IDs and hides thought chunks", () => {
  const updates = [
    { sessionUpdate: "user_message_chunk", messageId: "u1", content: { type: "text", text: "first" } },
    { sessionUpdate: "user_message_chunk", messageId: "u2", content: { type: "text", text: "second" } },
    { sessionUpdate: "agent_message_chunk", messageId: "a1", content: { type: "text", text: "hello " } },
    { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "PRIVATE" } },
    { sessionUpdate: "agent_message_chunk", messageId: "a1", content: { type: "text", text: "world" } },
  ];
  const messages = mcodeHistoryMessages("s", updates, "2026-09-27T00:00:00Z");
  assert.deepEqual(messages.map(m => m.content), ["first", "second", "hello world"]);
  assert.equal(new Set(messages.map(m => m.id)).size, 3);
  assert.deepEqual(mcodeHistoryMessages("s", updates, "2026-09-28T00:00:00Z").map(m => m.id), messages.map(m => m.id));
});
