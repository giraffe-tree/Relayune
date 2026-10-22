// Shapes match MiniMax Code 0.5.x ACP agent.ts / interactions.ts.
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const cwd = process.env.MCODE_TEST_DIR;
const file = join(cwd, "sessions.json");
const scenario = process.argv[2];
const pending = new Map(), permissions = new Map();
let rpcId = 500;
const read = () => existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
const write = value => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...value })}\n`);
const reply = (id, result) => write({ id, result });
const update = (sessionId, value) => write({ method: "session/update", params: { sessionId, update: value } });
const configs = [{ id: "permissionMode", name: "Permission mode", type: "select", currentValue: "default", options: [{ value: "default", name: "Default" }] }];
createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line), p = message.params ?? {};
  if (!message.method) {
    const permission = permissions.get(message.id);
    if (!permission) return;
    permissions.delete(message.id);
    const { sessionId, target } = permission;
    const prompt = pending.get(sessionId);
    if (!prompt) return;
    const allowed = message.result?.outcome?.optionId === "allow-once";
    if (allowed) writeFileSync(join(cwd, target), "approved");
    const text = allowed ? "File written" : "Permission denied";
    const sessions = read(), session = sessions.find(s => s.sessionId === sessionId);
    session.messages.push({ role: "assistant", text, id: `a${session.messages.length}` });
    writeFileSync(file, JSON.stringify(sessions));
    update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: `tool-${message.id}`, status: allowed ? "completed" : "failed", content: [{ type: "content", content: { type: "text", text } }] });
    update(sessionId, { sessionUpdate: "agent_message_chunk", messageId: "answer", content: { type: "text", text } });
    reply(prompt, { stopReason: "end_turn" }); pending.delete(sessionId); return;
  }
  switch (message.method) {
    case "initialize":
      reply(message.id, { protocolVersion: 1, agentCapabilities: { loadSession: true, promptCapabilities: { image: false, audio: false, embeddedContext: false }, sessionCapabilities: { ...(scenario === "missing-list" ? {} : { list: {} }), resume: {}, fork: {}, close: {} } } }); break;
    case "session/list":
      if (scenario === "auth") write({ id: message.id, error: { code: -32000, message: "Authentication required" } });
      else reply(message.id, { sessions: read().map(s => ({ sessionId: s.sessionId, cwd: s.cwd, title: s.title, updatedAt: s.updatedAt })) }); break;
    case "session/new": {
      const sessions = read(), session = { sessionId: `mcode-test-${sessions.length}`, cwd: p.cwd, title: "MiniMax session", updatedAt: new Date().toISOString(), messages: [] };
      sessions.push(session); writeFileSync(file, JSON.stringify(sessions)); reply(message.id, { sessionId: session.sessionId, configOptions: configs }); break;
    }
    case "session/load": {
      for (const m of read().find(s => s.sessionId === p.sessionId)?.messages ?? []) update(p.sessionId, { sessionUpdate: m.role === "user" ? "user_message_chunk" : "agent_message_chunk", messageId: m.id, content: { type: "text", text: m.text } });
      update(p.sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "PRIVATE" } });
      reply(message.id, { configOptions: configs }); break;
    }
    case "session/resume": reply(message.id, { configOptions: configs }); break;
    case "session/prompt": {
      const text = p.prompt.map(x => x.text ?? "").join("");
      const sessions = read(), session = sessions.find(s => s.sessionId === p.sessionId);
      session.messages.push({ role: "user", text, id: `u${session.messages.length}` }); writeFileSync(file, JSON.stringify(sessions));
      pending.set(p.sessionId, message.id);
      const id = ++rpcId;
      update(p.sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "PRIVATE" } });
      update(p.sessionId, { sessionUpdate: "tool_call", toolCallId: `tool-${id}`, title: "Write test file", kind: "edit", status: "pending", rawInput: { path: join(cwd, text), content: "approved" } });
      permissions.set(id, { sessionId: p.sessionId, target: text });
      write({ id, method: "session/request_permission", params: { sessionId: p.sessionId, toolCall: { toolCallId: `tool-${id}`, name: "Write", title: "Write test file", kind: "edit", status: "pending", rawInput: { path: join(cwd, text), content: "approved" } }, options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }, { optionId: "allow-always", name: "Always allow", kind: "allow_always" }, { optionId: "deny", name: "Deny", kind: "reject_once" }] } });
      if (text === "crash") setTimeout(() => process.exit(23), 50);
      break;
    }
    case "session/cancel": {
      const id = pending.get(p.sessionId); pending.delete(p.sessionId);
      if (id) reply(id, { stopReason: "cancelled" }); break;
    }
    default: write({ id: message.id, error: { code: -32601, message: "Unsupported" } });
  }
});
