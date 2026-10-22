// Real Pi CLI and real tools, with a deterministic local model server.
// This does not claim coverage of a real cloud model or the Relayune UI.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiAdapter } from "../relay/pi-adapter.mjs";

const home = await mkdtemp(join(tmpdir(), "relayune-pi-live-"));
const started = Date.now();
const toolAnswers = new Map();
const server = createServer(async (req, res) => {
  try {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    const first = input.messages.findLast(m => m.role === "user")?.content;
    const prompt = typeof first === "string" ? first : first?.find(b => b.type === "text")?.text ?? "";
    const lastUser = input.messages.findLastIndex(m => m.role === "user");
    const toolResult = input.messages.slice(lastUser + 1).find(m => m.role === "tool");
    const hasResult = Boolean(toolResult);
    if (toolResult) toolAnswers.set(prompt, toolResult.content);
    let delta, finish;
    if (hasResult) { delta = { content: "Fixture completed" }; finish = "stop"; }
    else {
      const name = prompt.startsWith("ask") ? "relayune_ask" : "write";
      const args = name === "write" ? { path: join(home, `${prompt}.txt`), content: `EXACT:${prompt}` }
        : { question: "Choose a marker", ...(prompt === "ask-choice" ? { options: ["ALPHA", "BETA"] } : {}) };
      delta = { tool_calls: [{ index: 0, id: "fixture_call", type: "function", function: { name, arguments: JSON.stringify(args) } }] };
      finish = "tool_calls";
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (d, reason) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture",
      choices: [{ index: 0, delta: d, finish_reason: reason }] })}\n\n`;
    res.write(chunk({ reasoning_content: "Synthetic private reasoning fixture" }, null));
    await new Promise(resolve => setTimeout(resolve, 75));
    res.end(chunk(delta, null) + chunk({}, finish) + "data: [DONE]\n\n");
  } catch { res.writeHead(500); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
await writeFile(join(home, "models.json"), JSON.stringify({ providers: { "relayune-test": {
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: "openai-completions", apiKey: "local-fixture-only",
  models: [{ id: "fixture", name: "Fixture", reasoning: true, input: ["text"], contextWindow: 32000, maxTokens: 1000 }],
} } }));
await writeFile(join(home, "settings.json"), JSON.stringify({ defaultProvider: "relayune-test", defaultModel: "fixture", defaultThinkingLevel: "high" }));

const events = [], approvals = [];
let decision = "approved", answer = "BETA", choice = "1";
const adapter = new PiAdapter({ piBin: process.env.PI_TEST_BIN ?? "pi",
  piArgs: process.env.PI_TEST_CLI ? [process.env.PI_TEST_CLI] : [], piHome: home, workspace: home });
const results = [];
async function run(name, existing = null) {
  const session = existing ?? await adapter.createSession({ cwd: home, name });
  const before = approvals.length;
  const submitted = await adapter.submitMessage({ sessionId: session.id, requestId: name, content: name });
  const deadline = Date.now() + 20000;
  while (!events.some(e => e.id === session.id && e.turn_id === submitted.turnId && ["turn.completed", "turn.failed"].includes(e.kind)) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(events.find(e => e.id === session.id && e.turn_id === submitted.turnId && e.kind === "turn.completed")?.status, "completed", `${name}: task must settle`);
  assert.equal(approvals.length - before, 1, `${name}: must produce one real UI request`);
  assert.ok(submitted.turnId);
  const history = await adapter.readHistory({ sessionId: session.id });
  assert.ok(events.some(e => e.id === session.id && e.turn_id === submitted.turnId && e.kind === "turn.thinking" && e.active), `${name}: native thinking must be exposed as a phase`);
  assert.doesNotMatch(JSON.stringify(events), /Synthetic private reasoning fixture/);
  assert.doesNotMatch(JSON.stringify(history), /Synthetic private reasoning fixture/);
  assert.equal(history.messages.findLast(m => m.role === "user")?.id, adapter.userMessageId({ sessionId: session.id, requestId: name }));
  if (name !== "rejected") assert.equal(history.messages.findLast(m => m.role === "codex")?.id, `codex_${submitted.turnId}`);
  results.push({ case: name, passed: true });
  return session;
}
try {
  await adapter.start({ emitEvent: async (id, event) => events.push({ id, ...event }),
    requestApproval: async approval => {
      approvals.push(approval);
      if (decision) await adapter.resolveApproval({ approvalId: approval.approval_id, decision, optionId: choice, answer });
    } });
  const original = await run("approved");
  assert.equal(await readFile(join(home, "approved.txt"), "utf8"), "EXACT:approved");
  decision = "rejected"; await run("rejected");
  await assert.rejects(access(join(home, "rejected.txt")));
  decision = "approved"; await run("ask-choice"); await run("ask-text");
  assert.equal(toolAnswers.get("ask-choice"), "BETA");
  assert.equal(toolAnswers.get("ask-text"), "BETA");
  decision = null;
  const stopped = await adapter.createSession({ cwd: home, name: "stop" });
  await adapter.submitMessage({ sessionId: stopped.id, requestId: "stop", content: "stop" });
  const deadline = Date.now() + 20000;
  while (!approvals.some(a => a.session_id === stopped.id) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  const pending = approvals.find(a => a.session_id === stopped.id);
  assert.ok(pending, "stop must reach a real pending tool approval");
  await adapter.interruptTurn({ sessionId: stopped.id });
  await assert.rejects(adapter.resolveApproval({ approvalId: pending.approval_id, decision: "approved" }));
  await assert.rejects(access(join(home, "stop.txt")));
  decision = "approved";
  await run("resumed", stopped);
  assert.equal(await readFile(join(home, "resumed.txt"), "utf8"), "EXACT:resumed");
  results.push({ case: "stop-and-resume", passed: true });
  const history = await adapter.readHistory({ sessionId: original.id });
  assert.ok(history.messages.some(m => m.content === "approved"));
  assert.ok(history.messages.some(m => m.content === "Fixture completed"));
  const reloaded = await readFile((await adapter.metadata(original.id)).path, "utf8");
  assert.equal(JSON.parse(reloaded.split("\n")[0]).relayuneManaged, true);
  console.log(JSON.stringify({ version: adapter.version, node: process.version,
    layer: "real-cli-with-scripted-local-model", results, history: "passed",
    thinking_phase_events: events.filter(e => e.kind === "turn.thinking").length,
    duration_ms: Date.now() - started }));
} finally {
  await adapter.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(home, { recursive: true, force: true });
}
