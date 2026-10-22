import { withThinkingState } from "./turn-thinking.mjs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { basename } from "node:path";
import { agentSpawnOptions } from "./platform-process.mjs";
import { createId, hashAction } from "./protocol.mjs";

const date = value => new Date(Number.isFinite(value) ? value : Date.parse(value) || Date.now()).toISOString();
const localId = id => `zcode:${id}`;
function backendId(id) {
  if (typeof id !== "string" || !id.startsWith("zcode:") || id.length <= 6) throw new Error("Invalid ZCode session id.");
  return id.slice(6);
}

/** Local stdio client for ZCode app-server 0.16.5. Never reads provider credentials. */
export class ZCodeAdapter {
  constructor(options = {}) {
    this.provider = "zcode";
    this.command = options.zcodeBin || process.env.ZCODE_BIN || "zcode";
    this.args = options.zcodeArgs ?? ["app-server", "--stdio"];
    this.workspace = options.workspace ?? process.cwd();
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.env = options.env ?? process.env;
    this.pending = new Map();
    this.sessions = new Map();
    this.active = new Map();
    this.loaded = new Set();
    this.loading = new Map();
    this.approvals = new Map();
    this.sequences = new Map();
    this.nextId = 0;
    this.closed = false;
    this.queue = Promise.resolve();
  }

  async start(handlers) {
    this.handlers = withThinkingState(handlers);
    this.closed = false;
    this.child = this.spawnProcess(this.command, this.args, agentSpawnOptions(this.command, {
      cwd: this.workspace, env: this.env, stdio: ["pipe", "pipe", "pipe"],
    }));
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id !== undefined && !message.method) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`ZCode: ${message.error.message ?? "request failed"}`));
        else pending.resolve(message.result);
      } else {
        this.queue = this.queue.then(() => this.receive(message)).catch(() => {
          if (message.id !== undefined) this.write({ id: message.id, error: { code: -32603, message: "Relayune could not handle this interaction." } });
        });
      }
    });
    // Runtime stderr may contain local provider diagnostics. Do not forward it.
    this.child.stderr.resume();
    this.child.stdin.on("error", () => this.fail(new Error("ZCode input stream closed.")));
    this.child.once("error", error => this.fail(error));
    this.child.once("exit", () => this.fail(new Error("ZCode app-server exited.")));
    try { await this.listSessions(); } catch (error) { await this.close(); throw error; }
  }

  write(message) {
    if (!this.child?.stdin?.writable) throw new Error("ZCode app-server is unavailable.");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`ZCode ${method} timed out.`)); }, 60_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  session(raw) {
    if (!raw?.sessionId || !raw.workspace?.workspacePath) throw new Error("ZCode returned an invalid session.");
    const id = localId(raw.sessionId), running = this.active.has(id);
    const session = {
      id, provider: "zcode", name: raw.title || "ZCode 会话", cwd: raw.workspace.workspacePath,
      project: basename(raw.workspace.workspacePath), branch: "—",
      status: running || ["running", "waiting"].includes(raw.status) ? "active" : "idle",
      can_interrupt: running, supports_steering: false,
      updated_at: date(raw.updatedAt), running_started_at: this.active.get(id)?.startedAt ?? null,
      model: raw.model?.modelId ?? null, permission_mode: raw.mode ?? null,
    };
    this.sessions.set(id, session);
    return session;
  }

  async listSessions() {
    const result = await this.request("session/list", { limit: 200 });
    if (!Array.isArray(result?.sessions)) throw new Error("ZCode does not expose session/list.");
    return result.sessions.map(raw => this.session(raw));
  }

  async createSession({ cwd }) {
    const path = cwd || this.workspace;
    const result = await this.request("session/create", {
      workspace: { workspacePath: path, workspaceKey: path }, mode: "build", persistence: "immediate",
    });
    const session = this.session(result.session);
    this.loaded.add(session.id);
    await this.subscribe(session.id);
    // app-server does not expose a title setter; keep its persisted title authoritative.
    return session;
  }

  async ensureLoaded(sessionId) {
    backendId(sessionId);
    if (this.loaded.has(sessionId)) return;
    if (this.loading.has(sessionId)) return this.loading.get(sessionId);
    const operation = (async () => {
      const result = await this.request("session/resume", { sessionId: backendId(sessionId) });
      this.session(result.session);
      await this.subscribe(sessionId);
      this.loaded.add(sessionId);
    })();
    this.loading.set(sessionId, operation);
    try { await operation; } finally { this.loading.delete(sessionId); }
  }

  async subscribe(sessionId) {
    const result = await this.request("session/subscribe", {
      sessionId: backendId(sessionId), deliveryKind: "desktop-continuous", includeSnapshot: false,
    });
    // Historical text is read through session/messages, never re-emitted as live output.
    if (!this.sequences.has(sessionId)) this.sequences.set(sessionId, result.eventSeq ?? 0);
  }

  async readHistory({ sessionId, limit = 100, before = null }) {
    await this.ensureLoaded(sessionId);
    const result = await this.request("session/messages", { sessionId: backendId(sessionId) });
    const messages = zcodeHistory(result.messages ?? []);
    const end = before ? messages.findIndex(m => m.id === before) : messages.length;
    if (end < 0) throw new Error("ZCode history cursor is no longer available.");
    const start = Math.max(0, end - Math.max(1, Math.min(Number(limit) || 100, 500)));
    const page = messages.slice(start, end);
    return { messages: page, has_more: start > 0, next_cursor: start > 0 ? page[0]?.id : null,
      agents: [], sessions: [this.sessions.get(sessionId)] };
  }

  async readAgents() { return []; }
  async readUsage() { return {}; }
  async createAgents() { throw new Error("ZCode remote subagent creation is not available."); }

  async submitMessage({ sessionId, requestId, content, attachments = [] }) {
    await this.ensureLoaded(sessionId);
    if (this.active.has(sessionId)) throw new Error("Stop the active ZCode turn before sending another message.");
    const turnId = createId("turn_zcode");
    this.active.set(sessionId, { turnId, requestId, startedAt: new Date().toISOString(), text: "" });
    await this.emit(sessionId, { kind: "turn.started", turn_id: turnId, request_id: requestId });
    try {
      const result = await this.request("session/send", { sessionId: backendId(sessionId), content, attachments: attachments.map(a => ({ kind: "image", filename: a.name, mimeType: a.mime_type, dataBase64: a.base64 })), ...(requestId ? { inputId: requestId } : {}) });
      if (!result?.accepted) throw new Error("ZCode did not accept the message.");
      return { mode: "started", turnId, persisted: true, syncVerifiedAt: new Date().toISOString() };
    } catch (error) {
      await this.finish(sessionId, { kind: "turn.failed", error: error.message });
      throw error;
    }
  }

  async interruptTurn({ sessionId }) {
    if (!this.active.has(sessionId)) throw new Error("No active ZCode turn to interrupt.");
    await this.request("session/stop", { sessionId: backendId(sessionId) });
  }

  emit(sessionId, event) { return this.handlers.emitEvent(sessionId, { ...event, provider: "zcode" }); }

  async receive(message) {
    if (message.id !== undefined) return this.interaction(message);
    if (message.method !== "session/event") return;
    const event = message.params ?? {}, sessionId = localId(event.sessionId), payload = event.payload ?? {};
    if (!this.sessions.has(sessionId)) return;
    if (Number.isInteger(event.seq)) {
      if (event.seq <= (this.sequences.get(sessionId) ?? -1)) return;
      this.sequences.set(sessionId, event.seq);
    }
    const turn = this.active.get(sessionId);
    if (!turn) return;
    if (event.type === "turn.started") {
      if (payload.inputSource === "background_task" || payload.inputVisibility === "model-only") return;
      if (event.turnId) turn.backendTurnId = event.turnId;
      return;
    }
    if (event.turnId && turn.backendTurnId && event.turnId !== turn.backendTurnId) return;
    if (event.type === "model.streaming" && payload.kind === "reasoning_delta") {
      await this.emit(sessionId, { kind: "turn.thinking", turn_id: turn.turnId, active: true });
    } else if (event.type === "model.streaming" && payload.kind === "text_delta" && typeof payload.delta === "string") {
      turn.text += payload.delta;
      await this.emit(sessionId, { kind: "message.delta", turn_id: turn.turnId, text: payload.delta });
    } else if (["turn.completed", "turn.terminal"].includes(event.type)) {
      if (!turn.text && typeof payload.response === "string") turn.text = payload.response;
      if (String(payload.resultType ?? "").startsWith("error")) {
        await this.finish(sessionId, { kind: "turn.failed", error: `ZCode stopped: ${payload.resultType}` });
        return;
      }
      await this.finish(sessionId, { kind: "turn.completed", status: ["cancelled", "interrupted"].includes(payload.status ?? payload.resultType) ? "interrupted" : "completed" });
    } else if (event.type === "turn.failed") {
      await this.finish(sessionId, { kind: "turn.failed", error: payload.error?.message ?? "ZCode turn failed." });
    } else if (event.type === "tool.updated") {
      const kind = payload.kind;
      if (["scheduled", "started"].includes(kind)) await this.emit(sessionId, {
        kind: "command.started", turn_id: turn.turnId, item_id: payload.toolCallId,
        command: payload.input?.command ?? payload.toolName ?? "ZCode tool", cwd: this.sessions.get(sessionId)?.cwd,
      });
      if (["progress", "result", "error"].includes(kind)) await this.emit(sessionId, {
        kind: "command.output", turn_id: turn.turnId, item_id: payload.toolCallId,
        text: toolOutput(payload),
        status: kind === "error" ? "failed" : kind === "result" ? "completed" : "in_progress",
      });
    }
  }

  async interaction(message) {
    const params = message.params ?? {};
    if (message.method === "session/requestRuntimePreferences") {
      this.write({ id: message.id, result: { nativeSearchEnhancementsEnabled: false } });
      return;
    }
    if (message.method !== "interaction/requestPermission") {
      this.write({ id: message.id, error: { code: -32601, message: "This ZCode interaction is not supported by Relayune." } });
      return;
    }
    const sessionId = localId(params.sessionId);
    if (!this.active.has(sessionId)) { this.write({ id: message.id, result: { decision: "deny", reason: "No active Relayune turn" } }); return; }
    // Offer one-time decisions only. Never synthesize persistent permission rules.
    const allow = params.options?.find(option => option.kind === "allow_once" && option.response?.decision === "allow");
    if (!allow) { this.write({ id: message.id, result: { decision: "deny", reason: "No one-time approval offered" } }); return; }
    const approvalId = createId("apr_zcode");
    const action = { type: params.toolName === "Bash" ? "command.execute" : "tool.execute", display: String(params.input?.command ?? params.reason ?? params.toolName ?? "ZCode permission").slice(0, 12000), cwd: this.sessions.get(sessionId)?.cwd };
    const timer = setTimeout(() => { void this.resolveApproval({ approvalId, decision: "rejected" }).catch(() => {}); }, 5 * 60_000);
    this.approvals.set(approvalId, { rpcId: message.id, sessionId, timer });
    await this.handlers.requestApproval({ approval_id: approvalId, request_id: params.requestId ?? String(message.id),
      session_id: sessionId, root_session_id: sessionId, source_thread_id: sessionId,
      source_agent_name: "ZCode", turn_id: this.active.get(sessionId).turnId, provider: "zcode",
      action: { ...action, command_hash: hashAction(action) }, risk_level: params.riskLevel ?? "high",
      requested_at: new Date().toISOString(), expires_at: new Date(Date.now() + 5 * 60_000).toISOString() });
  }

  async resolveApproval({ approvalId, decision }) {
    if (!["approved", "rejected"].includes(decision)) throw new Error("Invalid ZCode permission decision.");
    const pending = this.approvals.get(approvalId);
    if (!pending) throw new Error("ZCode permission is no longer pending.");
    clearTimeout(pending.timer); this.approvals.delete(approvalId);
    this.write({ id: pending.rpcId, result: { decision: decision === "approved" ? "allow" : "deny", reason: "Relayune one-time decision" } });
  }

  async finish(sessionId, event) {
    const turn = this.active.get(sessionId);
    if (!turn) return;
    this.active.delete(sessionId);
    for (const [id, pending] of this.approvals) if (pending.sessionId === sessionId) await this.resolveApproval({ approvalId: id, decision: "rejected" });
    if (turn.text) await this.emit(sessionId, { kind: "message.completed", turn_id: turn.turnId, text: turn.text });
    await this.emit(sessionId, { ...event, turn_id: turn.turnId });
    const session = this.sessions.get(sessionId);
    if (session) Object.assign(session, { status: "idle", can_interrupt: false, running_started_at: null, updated_at: new Date().toISOString() });
  }

  fail(error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    for (const pending of this.approvals.values()) clearTimeout(pending.timer);
    this.approvals.clear();
    for (const sessionId of this.active.keys()) void this.finish(sessionId, { kind: "turn.failed", error: "ZCode app-server disconnected." });
  }

  async close() {
    this.closed = true;
    for (const id of this.approvals.keys()) await this.resolveApproval({ approvalId: id, decision: "rejected" }).catch(() => {});
    this.lines?.close();
    this.child?.stdin?.end();
    this.child?.kill();
    this.child = null;
    this.loaded.clear();
    this.fail(new Error("ZCode app-server closed."));
  }
}

export function zcodeHistory(messages) {
  return messages.flatMap(message => {
    const info = message.info;
    if (!info || !["user", "assistant"].includes(info.role) || info.visibility === "model-only" || info.synthetic) return [];
    const content = (message.parts ?? []).filter(p => p.type === "text").map(p => p.text ?? "").join("");
    if (!content) return [];
    return [{ id: `msg_zcode_${info.messageId}`, provider: "zcode", role: info.role === "assistant" ? "codex" : "user",
      content, created_at: date(info.time?.created), turn_id: `turn_zcode_${info.parentMessageId ?? info.messageId}` }];
  });
}

function toolOutput(payload) {
  const result = payload.result ?? {};
  const text = payload.stdoutTail ?? payload.stderrTail ?? result.output ?? payload.error?.message;
  if (typeof text === "string") return text;
  if (Array.isArray(result.content)) return result.content.filter(part => part.type === "text").map(part => part.text ?? "").join("\n");
  return "";
}
