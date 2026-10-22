import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { hashAction } from "./protocol.mjs";
import { AcpJsonRpcClient, KimiCodeAdapter, acpHistoryForkTailSafe } from "./kimi-adapter.mjs";

/** Beta integration using public ACP only; never reads MiniMax/Kimi credential files. */
export class MCodeAdapter extends KimiCodeAdapter {
  constructor(options = {}) {
    const command = resolveMCodeBinary(options.mcodeBin);
    const env = options.env ?? process.env;
    super({
      ...options,
      provider: "mcode",
      agentName: "MiniMax Code",
      kimiBin: command,
      kimiArgs: options.mcodeArgs ?? ["acp"],
      sessionStateReader: async () => new Map(),
      agentStateReader: async () => [],
      usageReader: async () => [],
      historyReader: options.historyReader ?? (params => readMCodeHistory({ ...params, env })),
    });
    this.env = env;
    this.approvalTimers = new Map();
  }

  createClient(handlers) {
    return new AcpJsonRpcClient({
      command: this.kimiBin, args: this.kimiArgs, cwd: this.workspace,
      env: this.env, spawnProcess: this.spawnProcess, agentName: this.agentName,
      ...handlers,
    });
  }

  async start(handlers) {
    this.closed = false;
    this.connectionId = randomUUID();
    try {
      await super.start({ ...handlers, requestApproval: async approval => {
        const pending = this.pendingApprovals.get(approval.approval_id);
        const approvalId = `apr_mcode_${this.connectionId}_${pending.rpcId}`;
        this.pendingApprovals.delete(approval.approval_id);
        this.pendingApprovals.set(approvalId, pending);
        let action = approval.action;
        if (action.options.some(option => option.option_id.startsWith("questionnaire:"))) {
          const question = { ...action };
          delete question.command_hash;
          question.type = "question.select";
          action = { ...question, command_hash: hashAction(question) };
        }
        try { await handlers.requestApproval({ ...approval, action, approval_id: approvalId, provider: "mcode" }); }
        catch (error) { this.pendingApprovals.delete(approvalId); throw error; }
      } });
      if (!this.capabilities.loadSession || !this.capabilities.sessionCapabilities?.resume) {
        throw new Error("MiniMax Code requires ACP history loading and session resume. Update mcode locally.");
      }
      // initialize alone is allowed without login. Do not publish a false ready state.
      await this.listSessions();
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async requestAuthenticated(method, params, options) {
    try { return await this.client.request(method, params, options); }
    catch (error) { throw mcodeError(error); }
  }

  submitMessageUnlocked(options) {
    if (options.attachments?.length) {
      return Promise.reject(new Error("MiniMax Code beta supports text messages only; image input is not available through this ACP integration."));
    }
    return super.submitMessageUnlocked(options);
  }

  toRelaySession(session) {
    const result = super.toRelaySession(session);
    delete result.kimi_config_options;
    delete result.kimi_commands;
    return result;
  }

  async readUsage() { return {}; }
  async readAgents() { return []; }
  // Do not infer MiniMax child agents from Kimi-specific tool names.
  async emitAgentEvent() {}
  async createAgents() { throw new Error("MiniMax Code beta does not expose remote subagent creation."); }
  async configureSession() { throw new Error("Configure MiniMax Code models and permissions locally in mcode."); }

  async handleServerRequest(request) {
    if (request.method !== "session/request_permission") {
      this.client.respondError(request.id, -32601, "Unsupported MiniMax Code client request.");
      return;
    }
    const sessionId = request.params?.sessionId;
    if (!this.activeTurns.has(sessionId)) {
      this.client.respond(request.id, { outcome: { outcome: "cancelled" } });
      return;
    }
    // Beta exposes one-time decisions only; persistent permission policy stays local.
    const options = (request.params?.options ?? []).filter(option =>
      ["allow_once", "reject_once"].includes(option.kind));
    await super.handleServerRequest({ ...request, params: { ...request.params, options } });
    const approvalId = `apr_mcode_${this.connectionId}_${request.id}`;
    if (this.pendingApprovals.has(approvalId)) {
      const timer = setTimeout(() => {
        const pending = this.pendingApprovals.get(approvalId);
        if (!pending) return;
        void this.resolveApproval({ approvalId, decision: "rejected" }).then(() =>
          this.handlers.emitEvent(sessionId, { kind: "approval.resolved", approval_id: approvalId,
            decision: "expired", provider: "mcode" })).catch(() => {});
      }, 5 * 60_000);
      timer.unref();
      this.approvalTimers.set(approvalId, timer);
    }
  }

  async resolveApproval(options) {
    const pending = this.pendingApprovals.get(options.approvalId);
    if (options.optionId && !pending?.options.some(option => option.option_id === options.optionId &&
      (options.decision === "approved" ? option.kind === "allow_once" : option.kind === "reject_once"))) {
      throw new Error("MiniMax Code permission option is invalid or no longer pending.");
    }
    await super.resolveApproval(options);
    clearTimeout(this.approvalTimers.get(options.approvalId));
    this.approvalTimers.delete(options.approvalId);
  }

  async finishTurn(sessionId) {
    for (const [id, pending] of this.pendingApprovals) if (pending.sessionId === sessionId) {
      clearTimeout(this.approvalTimers.get(id));
      this.approvalTimers.delete(id);
    }
    await super.finishTurn(sessionId);
  }

  handleExit(error) {
    for (const timer of this.approvalTimers.values()) clearTimeout(timer);
    this.approvalTimers.clear();
    this.activeSessions.clear();
    if (!this.closed) for (const [id, pending] of this.pendingApprovals) {
      void this.handlers?.emitEvent(pending.sessionId, { kind: "approval.resolved",
        approval_id: id, decision: "expired", provider: "mcode" });
    }
    super.handleExit(error);
  }

  async close() {
    for (const timer of this.approvalTimers.values()) clearTimeout(timer);
    this.approvalTimers.clear();
    await super.close();
    this.activeSessions.clear();
  }
}

function mcodeError(error) {
  if (error?.code === -32000) return new Error("MiniMax Code authentication is required. Run `mcode login` or configure a model locally, then reconnect Relayune.");
  return new Error(`MiniMax Code: ${error.message}`);
}

export function resolveMCodeBinary(explicit) {
  if (explicit || process.env.MCODE_BIN) return explicit || process.env.MCODE_BIN;
  // GUI launches may lack the installer directory in PATH.
  const root = process.env.MCODE_INSTALL_DIR || join(homedir(), ".minimax-code");
  const path = process.platform === "win32" ? join(root, "mcode.cmd") : join(root, "bin", "mcode");
  return existsSync(path) ? path : "mcode";
}

/** A separate ACP connection keeps history replay out of the live turn stream. */
async function readMCodeHistory({ kimiBin, kimiArgs, workspace, sessionId, cwd, updatedAt, spawnProcess, env }) {
  const updates = [];
  const client = new AcpJsonRpcClient({
    command: kimiBin, args: kimiArgs, cwd: workspace, env, spawnProcess, agentName: "MiniMax Code",
    onNotification(message) {
      if (message.method === "session/update" && message.params?.sessionId === sessionId) updates.push(message.params.update);
    },
    onRequest(request) {
      if (request.method === "session/request_permission") client.respond(request.id, { outcome: { outcome: "cancelled" } });
      else client.respondError(request.id, -32601, "History reader exposes no reverse capabilities.");
    },
  });
  try {
    await client.start();
    const result = await client.request("initialize", { protocolVersion: 1, clientCapabilities: {},
      clientInfo: { name: "relayune-history-reader", version: "0.3.29" } });
    if (result.protocolVersion !== 1 || !result.agentCapabilities?.loadSession) throw new Error("ACP history replay is unavailable.");
    await client.request("session/load", { sessionId, cwd, mcpServers: [] });
    return { messages: mcodeHistoryMessages(sessionId, updates, updatedAt), agents: [],
      fork_tail_safe: acpHistoryForkTailSafe(updates) };
  } catch (error) { throw mcodeError(error); }
  finally { await client.close(); }
}

export function mcodeHistoryMessages(sessionId, updates, updatedAt) {
  const messages = [];
  let pending = null;
  let turn = 0;
  const flush = () => {
    if (pending?.content) messages.push(pending);
    pending = null;
  };
  for (const update of updates) {
    if (!["user_message_chunk", "agent_message_chunk"].includes(update?.sessionUpdate) || update.content?.type !== "text") continue;
    const role = update.sessionUpdate === "user_message_chunk" ? "user" : "codex";
    const nativeId = update.messageId ?? null;
    if (pending && pending.role === role && pending.native_id === nativeId) { pending.content += update.content.text; continue; }
    flush();
    if (role === "user" || !turn) turn++;
    pending = { native_id: nativeId, role, content: update.content.text ?? "", provider: "mcode",
      created_at: updatedAt, turn_id: `turn_mcode_history_${sessionId}_${turn}` };
  }
  flush();
  return messages.map(({ native_id, ...message }, index) => ({ ...message,
    id: `msg_mcode_${createHash("sha256").update(`${sessionId}\0${native_id ?? index}`).digest("hex").slice(0, 24)}` }));
}
