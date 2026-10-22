import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiAdapter, PI_SUPPORTED_VERSION } from "../relay/pi-adapter.mjs";
import { readPiSession, piHistoryMessages, paginatePiHistory } from "../relay/pi-history.mjs";

async function fixture(t, options = {}) {
  const home = await mkdtemp(join(tmpdir(), "relayune-pi-test-"));
  const children = [], events = [], approvals = [];
  const spawnProcess = (_bin, args) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.commands = [];
    const header = JSON.parse(readFileSync(args[args.indexOf("--session") + 1], "utf8").split("\n")[0]);
    child.send = event => child.stdout.write(JSON.stringify(event) + "\n");
    child.stdin = new Writable({ write(buffer, _encoding, done) {
      const command = JSON.parse(buffer); child.commands.push(command);
      if (command.type === "extension_ui_response") { done(); return; }
      let data = {};
      if (command.type === "get_commands") data = { commands: options.noBridge ? [] : [{ name: "relayune-capabilities" }, { name: "relayune-turn" }] };
      if (command.type === "get_state") data = { sessionId: header.id, model: { id: "test", provider: "test", input: ["text", "image"] } };
      if (command.type === "get_available_models") data = { models: [{ id: "test", provider: "test" }] };
      if (options.abortAsError && command.type === "abort") {
        child.send({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "This operation was aborted", content: [] } });
        child.send({ type: "agent_settled" });
      }
      queueMicrotask(() => child.send({ type: "response", id: command.id, command: command.type, success: true, data }));
      done();
    } });
    child.kill = () => { queueMicrotask(() => child.emit("close", 0)); return true; };
    children.push(child); return child;
  };
  const adapter = new PiAdapter({ piHome: home, workspace: home, spawnProcess, probe: async () => options.version ?? PI_SUPPORTED_VERSION });
  await adapter.start({ emitEvent: async (id, event) => events.push({ id, ...event }), requestApproval: async approval => approvals.push(approval) });
  t.after(async () => { await adapter.close(); await rm(home, { recursive: true, force: true }); });
  const session = await adapter.createSession({ cwd: home, name: "Fixture" });
  return { adapter, session, home, children, events, approvals };
}

async function send(f, event, index = 0) {
  f.children[index].send(event);
  const connection = [...f.adapter.connections.values()][index];
  await connection.chain;
}

test("Pi keeps existing 0.85.1 session support while current tests use the 1.x runtime", async t => {
  const f = await fixture(t, { version: "0.85.1" });
  assert.equal(f.adapter.version, "0.85.1");
  await f.adapter.submitMessage({ sessionId: f.session.id, content: "read" });
  await send(f, { type: "agent_start" });
  await send(f, { type: "agent_settled" });
  assert.equal(f.events.filter(e => e.kind === "turn.completed").length, 1);
});

test("Pi thinking has transient phase events without reasoning text", async t => {
  const f = await fixture(t);
  await f.adapter.submitMessage({ sessionId: f.session.id, content: "read" });
  await send(f, { type: "agent_start" });
  for (const type of ["thinking_start", "thinking_delta", "thinking_delta", "thinking_end"]) {
    await send(f, { type: "message_update", assistantMessageEvent: { type, delta: "private reasoning" } });
  }
  assert.deepEqual(f.events.filter(e => e.kind === "turn.thinking").map(e => e.active), [true, false]);
  assert.doesNotMatch(JSON.stringify(f.events), /private reasoning/);
  await send(f, { type: "agent_settled" });
  await send(f, { type: "message_update", assistantMessageEvent: { type: "thinking_delta" } });
  assert.equal(f.events.filter(e => e.kind === "turn.thinking").length, 2);
});

test("Pi accepts a task without declaring execution; only settled completes the root task", async t => {
  const f = await fixture(t);
  await f.adapter.submitMessage({ sessionId: f.session.id, content: "read" });
  assert.equal(f.events.length, 0);
  await send(f, { type: "agent_start" });
  await send(f, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } });
  await send(f, { type: "turn_end" }); await send(f, { type: "agent_end", willRetry: true });
  assert.equal(f.adapter.activeTurns.size, 1);
  assert.equal(f.events.filter(e => e.kind === "turn.completed").length, 0);
  await send(f, { type: "agent_settled" }); await send(f, { type: "agent_settled" });
  assert.equal(f.adapter.activeTurns.size, 0);
  assert.equal(f.events.filter(e => e.kind === "turn.completed").length, 1);
  assert.equal(f.events.find(e => e.kind === "message.completed").text, "hello");
});

test("Pi reserves startup before awaiting and does not spawn duplicate tasks", async t => {
  const f = await fixture(t);
  const first = f.adapter.submitMessage({ sessionId: f.session.id, content: "one" });
  await assert.rejects(f.adapter.submitMessage({ sessionId: f.session.id, content: "two" }), /already working/);
  await first;
  assert.equal(f.children.length, 1);
  assert.equal(f.children[0].commands.filter(c => c.type === "prompt" && !c.message.startsWith("/relayune-turn ")).length, 1);
});

test("Pi refuses to prompt when its approval extension is absent", async t => {
  const f = await fixture(t, { noBridge: true });
  await assert.rejects(f.adapter.submitMessage({ sessionId: f.session.id, content: "write" }), /bridge failed/);
  assert.equal(f.children[0].commands.some(c => c.type === "prompt"), false);
  assert.equal(f.adapter.activeTurns.size, 0);
});

test("Pi approval is exact, session-scoped and consumed once", async t => {
  const f = await fixture(t);
  await f.adapter.submitMessage({ sessionId: f.session.id, content: "write" });
  await send(f, { type: "agent_start" });
  await send(f, { type: "extension_ui_request", id: "request", method: "confirm", message: JSON.stringify({
    bridge: "relayune-pi-v1", tool: "write", toolCallId: "write1", input: { path: "a.txt", content: "EXACT" },
  }) });
  const approval = f.approvals[0];
  assert.equal(approval.session_id, f.session.id); assert.match(approval.action.display, /EXACT/);
  await f.adapter.resolveApproval({ approvalId: approval.approval_id, decision: "rejected" });
  assert.equal(f.children[0].commands.at(-1).confirmed, false);
  await assert.rejects(f.adapter.resolveApproval({ approvalId: approval.approval_id, decision: "approved" }), /no longer pending/);
});

test("Pi structured choice and free input return validated user answers", async t => {
  const f = await fixture(t);
  await f.adapter.submitMessage({ sessionId: f.session.id, content: "ask" });
  await send(f, { type: "extension_ui_request", id: "choice", method: "select", title: "Choose", options: ["A", "B"] });
  await assert.rejects(f.adapter.resolveApproval({ approvalId: f.approvals[0].approval_id, decision: "approved", optionId: "bad" }), /Invalid/);
  await f.adapter.resolveApproval({ approvalId: f.approvals[0].approval_id, decision: "approved", optionId: "1" });
  assert.equal(f.children[0].commands.at(-1).value, "B");
  await send(f, { type: "extension_ui_request", id: "input", method: "input", title: "Answer" });
  assert.equal(f.approvals[1].action.allows_freeform, true);
  await f.adapter.resolveApproval({ approvalId: f.approvals[1].approval_id, decision: "approved", answer: "Hello" });
  assert.equal(f.children[0].commands.at(-1).value, "Hello");
});

test("Pi stop invalidates only its own approval, clears queues before abort, and permits a new task", async t => {
  const f = await fixture(t), second = await f.adapter.createSession({ cwd: f.home, name: "second" });
  await f.adapter.submitMessage({ sessionId: f.session.id, content: "one" });
  await f.adapter.submitMessage({ sessionId: second.id, content: "two" });
  const request = { type: "extension_ui_request", id: "same", method: "input", title: "question" };
  await send(f, request, 0); await send(f, request, 1);
  await f.adapter.interruptTurn({ sessionId: f.session.id });
  assert.equal(f.adapter.pendingApprovals.size, 1);
  assert.equal(f.adapter.activeTurns.has(second.id), true);
  assert.deepEqual(f.children[0].commands.slice(-2).map(c => c.type), ["clear_queue", "abort"]);
  await assert.rejects(f.adapter.resolveApproval({ approvalId: f.approvals[0].approval_id, decision: "approved", answer: "late" }), /no longer pending/);
  await f.adapter.submitMessage({ sessionId: f.session.id, content: "again" });
});

test("Pi crash produces failure, invalidates dialogs and leaves no busy lock", async t => {
  const f = await fixture(t);
  await f.adapter.submitMessage({ sessionId: f.session.id, content: "one" });
  await send(f, { type: "extension_ui_request", id: "x", method: "input", title: "question" });
  await f.adapter.failConnection(f.session.id, f.adapter.connections.get(f.session.id));
  assert.equal(f.adapter.activeTurns.size, 0); assert.equal(f.adapter.pendingApprovals.size, 0);
  assert.equal(f.events.filter(e => e.kind === "turn.failed").length, 1);
});

test("Pi history selects the active tree branch, retains pre-compaction messages and paginates stably", async t => {
  const f = await fixture(t), path = join(f.home, "history.jsonl");
  const records = [
    { type: "session", version: 3, id: "history", cwd: f.home },
    { type: "message", id: "a", parentId: null, timestamp: "2026-09-10T00:00:00Z", message: { role: "user", content: "root" } },
    { type: "message", id: "old", parentId: "a", message: { role: "assistant", content: [{ type: "text", text: "abandoned" }] } },
    { type: "message", id: "b", parentId: "a", message: { role: "assistant", content: [{ type: "text", text: "active" }] } },
    { type: "compaction", id: "c", parentId: "b", summary: "summary", firstKeptEntryId: "b" },
  ];
  await writeFile(path, records.map(JSON.stringify).join("\n") + '\n{"partial":');
  const session = await readPiSession(path), messages = piHistoryMessages(session);
  assert.deepEqual(messages.map(m => m.content), ["root", "active"]);
  const page = paginatePiHistory(messages, { limit: 1 });
  assert.equal(page.messages[0].content, "active"); assert.equal(page.has_more, true);
  assert.equal(paginatePiHistory(messages, { before: page.next_cursor }).messages[0].content, "root");
  await assert.rejects(async () => paginatePiHistory(messages, { before: "stale" }), /cursor/);
});

test("Pi completed external history continues in a labelled copy without writing the source", async t => {
  const f = await fixture(t), original = await f.adapter.metadata(f.session.id);
  original.header.relayuneManaged = false;
  const source = [original.header, ...original.branch,
    { type: "message", id: "answer", parentId: original.branch.at(-1).id, timestamp: new Date().toISOString(),
      message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "retained context" }] } }];
  await writeFile(original.path, source.map(JSON.stringify).join("\n") + "\n");
  const before = readFileSync(original.path, "utf8");
  await f.adapter.submitMessage({ sessionId: f.session.id, content: "continue" });
  const managed = await f.adapter.metadata(f.session.id);
  assert.notEqual(managed.path, original.path);
  assert.notEqual(managed.header.id, original.header.id);
  assert.equal(managed.header.relayuneSourceId, original.header.id);
  assert.match(managed.title, /Relayune copy/);
  assert.ok(managed.branch.some(entry => entry.id === "answer"));
  assert.equal(readFileSync(original.path, "utf8"), before);
  const catalog = await f.adapter.listSessions();
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].id, f.session.id);
  assert.equal((await f.adapter.metadata(f.session.id)).path, managed.path);
});

test("Pi external unfinished tool exchange is never forked into a writable prompt", async t => {
  const f = await fixture(t), original = await f.adapter.metadata(f.session.id);
  original.header.relayuneManaged = false;
  await writeFile(original.path, [original.header, ...original.branch,
    { type: "message", id: "pending", parentId: original.branch.at(-1).id, timestamp: new Date().toISOString(),
      message: { role: "user", content: [{ type: "text", text: "pending task" }] } }].map(JSON.stringify).join("\n") + "\n");
  await assert.rejects(f.adapter.submitMessage({ sessionId: f.session.id, content: "continue" }), /native Pi/);
  assert.equal(f.children.length, 0);
});

test("Pi ownership lock rejects another writer before spawning", async t => {
  const f = await fixture(t);
  const metadata = await f.adapter.metadata(f.session.id);
  await writeFile(`${metadata.path}.relayune-lock`, "another owner", { flag: "wx" });
  await assert.rejects(f.adapter.submitMessage({ sessionId: f.session.id, content: "write" }), /owned by another/);
  assert.equal(f.children.length, 0);
  assert.equal(readFileSync(`${metadata.path}.relayune-lock`, "utf8"), "another owner");
});

test("Pi late events from an interrupted process cannot complete the next task", async t => {
  const f = await fixture(t);
  await f.adapter.submitMessage({ sessionId: f.session.id, content: "first" });
  const old = f.adapter.connections.get(f.session.id);
  await f.adapter.interruptTurn({ sessionId: f.session.id });
  const second = await f.adapter.submitMessage({ sessionId: f.session.id, content: "second" });
  await f.adapter.handleEvent(f.session.id, old, { type: "agent_settled" });
  assert.equal(f.adapter.activeTurns.get(f.session.id).id, second.turnId);
  assert.equal(f.children.length, 2);
  assert.equal(f.events.filter(e => e.kind === "turn.completed").length, 1);
});

test("Pi final-only assistant output is preserved without duplicating streamed text", async t => {
  const f = await fixture(t);
  await f.adapter.submitMessage({ sessionId: f.session.id, content: "answer" });
  await send(f, { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "first" }] } });
  await send(f, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "second" } });
  await send(f, { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "second" }] } });
  await send(f, { type: "agent_settled" });
  assert.equal(f.events.find(e => e.kind === "message.completed").text, "firstsecond");
});

test("Pi history uses persisted live identities across multiple assistant messages", () => {
  const session = { header: { id: "session" }, branch: [
    { type: "custom", customType: "relayune-turn", data: { turnId: "turn_pi_123", userId: "pi_user_123" } },
    { type: "message", id: "a", message: { role: "user", content: "question" } },
    { type: "message", id: "b", message: { role: "assistant", content: "before" } },
    { type: "message", id: "c", message: { role: "toolResult", content: "result", toolName: "read", toolCallId: "tool" } },
    { type: "message", id: "d", message: { role: "assistant", content: "after" } },
  ] };
  const messages = piHistoryMessages(session);
  assert.equal(messages[0].id, "pi_user_123");
  assert.equal(messages[1].id, "codex_turn_pi_123");
  assert.equal(messages[1].content, "beforeafter");
  assert.equal(messages[2].role, "system");
});

test("Pi image-only history retains attachment data for encrypted recovery", () => {
  const session = { header: { id: "session" }, branch: [
    { type: "message", id: "a", message: { role: "user", content: [{ type: "image", mimeType: "image/png", data: "YWJj" }] } },
  ] };
  const messages = piHistoryMessages(session);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].attachments[0].relay_source.url, "data:image/png;base64,YWJj");
  assert.equal(messages[0].role, "user");
});

test("Pi controlled extension fails closed for rejected, expired, oversized and non-RPC operations", async () => {
  const { PI_EXTENSION_SOURCE } = await import("../relay/pi-extension.mjs");
  // Native Pi resolves its own SessionManager package inside the extension
  // loader; this approval-only unit test does not invoke that command.
  const source = PI_EXTENSION_SOURCE.replace(/^import \{ SessionManager \}.*\n/m, "");
  const extension = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  let toolHook;
  extension.default({ registerCommand() {}, registerTool() {}, on(event, hook) { if (event === "tool_call") toolHook = hook; } });
  const event = { toolName: "bash", toolCallId: "call", input: { command: "echo fixture" } };
  for (const allowed of [false, undefined]) {
    const result = await toolHook(event, { mode: "rpc", ui: { confirm: async () => allowed } });
    assert.equal(result.block, true); assert.equal(result.terminate, true);
  }
  assert.equal(await toolHook(event, { mode: "rpc", ui: { confirm: async () => true } }), undefined);
  assert.equal((await toolHook(event, { mode: "interactive" })).block, true);
  assert.equal((await toolHook({ ...event, input: { command: "x".repeat(12001) } }, { mode: "rpc" })).block, true);
});

test("Pi cancelling during startup prevents the task prompt", async t => {
  const f = await fixture(t);
  const submitted = f.adapter.submitMessage({ sessionId: f.session.id, content: "write" });
  const rejected = assert.rejects(submitted, /cancelled/);
  await f.adapter.interruptTurn({ sessionId: f.session.id });
  await rejected;
  assert.equal(f.children[0].commands.some(c => c.type === "prompt"), false);
  assert.equal(f.adapter.activeTurns.size, 0);
});

test("Pi user stop remains interrupted when provider emits abort as error", async t => {
  const f = await fixture(t, { abortAsError: true });
  const turn = await f.adapter.submitMessage({ sessionId: f.session.id, content: "wait" });
  await send(f, { type: "agent_start" });
  await f.adapter.interruptTurn({ sessionId: f.session.id });
  const terminal = f.events.filter(e => e.turn_id === turn.turnId && ["turn.completed", "turn.failed"].includes(e.kind));
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].status, "interrupted");
});

test("Pi free text supports empty options as well as omitted options", async () => {
  const { PI_EXTENSION_SOURCE } = await import("../relay/pi-extension.mjs");
  const source = PI_EXTENSION_SOURCE.replace(/^import \{ SessionManager \}.*\n/m, "");
  const extension = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  let ask;
  extension.default({ registerCommand() {}, registerTool(tool) { ask = tool; }, on() {} });
  for (const options of [undefined, []]) {
    const calls = [];
    const result = await ask.execute("id", { question: "marker", options }, undefined, undefined,
      { ui: { input: async () => { calls.push("input"); return "marker"; }, select: async () => { calls.push("select"); } } });
    assert.deepEqual(calls, ["input"]);
    assert.equal(result.content[0].text, "marker");
  }
});
