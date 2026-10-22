/** Real mcode CLI with an isolated local mock model. No cloud login or API credits. */
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MCodeAdapter, resolveMCodeBinary } from "../relay/mcode-adapter.mjs";

const directory = await mkdtemp(join(tmpdir(), "relayune-mcode-local-"));
const workspace = join(directory, "project");
await mkdir(workspace);
const env = { ...process.env, MINIMAX_DATA_DIR: join(directory, "data"),
  MAVIS_DATA_DIR: join(directory, "data"), MCODE_LOCAL_TEST_KEY: "local-fixture-only" };
const command = resolveMCodeBinary();
let target = null, sentTool = false;
const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const part of req) body += part;
  const data = JSON.parse(body);
  if (req.url.endsWith("/input_tokens")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ input_tokens: 100 })); return;
  }
  let delta = { role: "assistant", content: "Relayune local model smoke OK" }, reason = "stop";
  if (target && !sentTool && JSON.stringify(data.messages?.filter(m => m.role === "user").at(-1)).includes(target) && data.tools?.some(t => t.function?.name === "write")) {
    sentTool = true; reason = "tool_calls";
    delta = { role: "assistant", tool_calls: [{ index: 0, id: `call-${Date.now()}`, type: "function",
      function: { name: "write", arguments: JSON.stringify({ path: target, content: "approved" }) } }] };
  }
  if (data.stream) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const [content, finish_reason] of [[delta, null], [{}, reason]]) res.write(`data: ${JSON.stringify({
      id: "chat-fixture", object: "chat.completion.chunk", created: 1, model: "relayune-test-model",
      choices: [{ index: 0, delta: content, finish_reason }],
    })}\n\n`);
    res.end("data: [DONE]\n\n");
  } else {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "chat-fixture", object: "chat.completion", created: 1, model: "relayune-test-model",
      choices: [{ index: 0, message: delta, finish_reason: reason }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }));
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
async function cli(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd: workspace, stdio: "ignore" });
    const timer = setTimeout(() => { child.kill(); reject(new Error("mcode setup timed out")); }, 30_000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`mcode setup exited ${code}`)); });
  });
}
async function waitFor(check) {
  const deadline = Date.now() + 30_000;
  while (!check()) { if (Date.now() > deadline) throw new Error("mcode smoke timed out"); await new Promise(r => setTimeout(r, 25)); }
}
let adapter;
const events = [], approvals = [];
const handlers = { emitEvent: async (_, event) => events.push(event), requestApproval: async a => approvals.push(a) };
const make = () => new MCodeAdapter({ mcodeBin: command, workspace, env });
try {
  adapter = make();
  await assert.rejects(adapter.start(handlers), /mcode login/);
  await cli(["provider", "add", "--name", "relayune-test", "--base-url", `http://127.0.0.1:${server.address().port}/v1`,
    "--api-format", "openai-completions", "--model", "relayune-test-model", "--api-key-env", "MCODE_LOCAL_TEST_KEY",
    "--context-limit", "32768", "--output-limit", "4096", "--use"]);
  adapter = make(); await adapter.start(handlers);
  const session = await adapter.createSession({ cwd: workspace });
  await adapter.submitMessage({ sessionId: session.id, content: "Respond with the smoke confirmation." });
  await waitFor(() => !adapter.activeTurns.size);
  assert.ok(events.some(e => e.kind === "message.delta" && e.text.includes("smoke OK")));
  assert.equal(events.filter(e => e.kind === "turn.failed").length, 0);
  for (const decision of ["approved", "rejected", "cancelled"]) {
    target = join(directory, `${decision}.txt`); sentTool = false;
    const before = approvals.length;
    const testSession = await adapter.createSession({ cwd: workspace });
    await adapter.submitMessage({ sessionId: testSession.id, content: `Write approved to the test file ${target}.` });
    await waitFor(() => approvals.length > before || !adapter.activeTurns.size);
    assert.equal(approvals.length, before + 1, `real CLI must request permission for ${decision}; events=${JSON.stringify(events.slice(-6))}`);
    const approval = approvals.at(-1);
    assert.match(approval.action.display, new RegExp(`${decision}\\.txt`));
    if (decision === "cancelled") await adapter.interruptTurn({ sessionId: testSession.id });
    else await adapter.resolveApproval({ approvalId: approval.approval_id, decision });
    await waitFor(() => !adapter.activeTurns.size);
    if (decision === "approved") assert.equal(await readFile(target, "utf8"), "approved");
    else await assert.rejects(access(target));
    assert.equal(adapter.pendingApprovals.size, 0);
  }
  const eventCount = events.length;
  const history = await adapter.readHistory({ sessionId: session.id });
  assert.ok(history.messages.some(m => m.content.includes("smoke OK")));
  assert.equal(events.length, eventCount, "replay must stay separate from live events");
  await adapter.close(); adapter = make(); await adapter.start(handlers);
  assert.ok((await adapter.listSessions()).some(s => s.id === session.id));
  target = null;
  await adapter.submitMessage({ sessionId: session.id, content: "Continue this recovered session." });
  await waitFor(() => !adapter.activeTurns.size);
  assert.equal(events.filter(e => e.kind === "turn.failed").length, 0);
  console.log("PASS: real mcode ACP authentication gate, streaming, allow/deny/cancel side effects, history, restart and resumed turn (local mock model).");
} finally {
  await adapter?.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
