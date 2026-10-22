import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { OpenCodeAdapter } from "../relay/opencode-adapter.mjs";

// Shared ACP protocol fixture exercises stdio, not a live model provider.
const fixture = fileURLToPath(new URL("./fixtures/fake-kimi-acp.mjs", import.meta.url));
async function waitFor(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("ACP event did not arrive");
}

test("OpenCode ACP lists, replays, creates, streams and routes permission decisions", async () => {
  const adapter = new OpenCodeAdapter({ opencodeBin: process.execPath, opencodeArgs: [fixture] });
  const events = [], approvals = [];
  try {
    await adapter.start({
      emitEvent: async (_, event) => events.push(event),
      requestApproval: async approval => approvals.push(approval),
    });
    const sessions = await adapter.listSessions();
    assert.equal(sessions[0].provider, "opencode");
    assert.equal(sessions[0].supports_steering, false);
    assert.equal(sessions[0].kimi_config_options, undefined);
    const history = await adapter.readHistory({ sessionId: sessions[0].id });
    assert.deepEqual(history.messages.map(m => m.content), ["historical question", "historical answer"]);
    assert.ok(history.messages.every(m => m.provider === "opencode"));
    assert.deepEqual(history.agents, []);
    assert.equal((await adapter.createSession({ cwd: process.cwd() })).provider, "opencode");
    await adapter.submitMessage({ sessionId: sessions[0].id, content: "run tests" });
    await waitFor(() => approvals.length === 1);
    assert.match(approvals[0].approval_id, /^apr_opencode_/);
    assert.equal(approvals[0].source_agent_name, "OpenCode 主会话");
    await assert.rejects(adapter.submitMessage({ sessionId: sessions[0].id, content: "again" }), /active turn/);
    await adapter.resolveApproval({ approvalId: approvals[0].approval_id, decision: "approved", optionId: "approve_once" });
    await waitFor(() => events.some(e => e.kind === "turn.completed"));
    assert.ok(events.every(e => e.provider === "opencode"));
    assert.ok(events.some(e => e.kind === "message.delta"));
    assert.deepEqual(await adapter.readUsage(), {});
  } finally { await adapter.close(); }
});

test("OpenCode rejects missing ACP session discovery and closes its process", async () => {
  const adapter = new OpenCodeAdapter({ opencodeBin: process.execPath, opencodeArgs: [fixture, "missing-session-list"] });
  await assert.rejects(adapter.start({}), /OpenCode.*session\/list/);
  assert.equal(adapter.client, null);
});

test("OpenCode cancels a running turn through ACP", async () => {
  const adapter = new OpenCodeAdapter({ opencodeBin: process.execPath, opencodeArgs: [fixture] });
  const events = [], approvals = [];
  try {
    await adapter.start({ emitEvent: async (_, event) => events.push(event), requestApproval: async a => approvals.push(a) });
    const [session] = await adapter.listSessions();
    await adapter.submitMessage({ sessionId: session.id, content: "run tests" });
    await waitFor(() => approvals.length === 1);
    await adapter.interruptTurn({ sessionId: session.id });
    await waitFor(() => events.some(e => e.kind === "turn.completed" && e.status === "interrupted"));
    assert.equal((await adapter.listSessions())[0].can_interrupt, false);
  } finally { await adapter.close(); }
});
