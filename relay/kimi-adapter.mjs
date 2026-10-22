import { withThinkingState } from "./turn-thinking.mjs";
import { serializeSessionControl, stopBeforeSending } from "./interrupt-and-send.mjs";
import { readKimiQuota } from "./kimi-quota.mjs";
import { rethrowFileAccessError } from "./file-access.mjs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { agentSpawnOptions } from "./platform-process.mjs";
import { createId, hashAction } from "./protocol.mjs";

const ACP_PROTOCOL_VERSION = 1;
const DEFAULT_RPC_TIMEOUT_MS = 60_000;
const MAX_SESSIONS = 300;
const MAX_APPROVAL_TEXT = 12_000;
const MAX_AGENT_SUMMARY_TEXT = 1_200;
const MAX_AGENT_ACTIVITIES = 80;
const KIMI_ACTIVE_FRESHNESS_MS = 30 * 60_000;
const USAGE_REFRESH_MS = 30_000;
const kimiWireCache = new Map();
const kimiUsageCache = new Map();
const acpForkError = code => Object.assign(new Error(code), { code });

export class KimiCodeAdapter {
  constructor(options = {}) {
    this.provider = options.provider ?? "kimi";
    this.agentName = options.agentName ?? "Kimi Code";
    this.kimiBin = resolveKimiBinary(options.kimiBin);
    this.kimiArgs = options.kimiArgs ?? ["acp"];
    this.workspace = options.workspace ?? process.cwd();
    this.kimiHome =
      options.kimiHome ??
      process.env.KIMI_CODE_HOME ??
      join(homedir(), ".kimi-code");
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.historyReader = options.historyReader ?? readKimiHistoryFromLocalWire;
    this.agentStateReader = options.agentStateReader ?? readKimiAgentSnapshot;
    this.sessionStateReader =
      options.sessionStateReader ?? readKimiSessionExecutionSnapshots;
    this.usageReader = options.usageReader ?? readKimiDailyUsage;
    this.usageRefreshMs = options.usageRefreshMs ?? USAGE_REFRESH_MS;
    this.quotaReader = options.quotaReader ?? readKimiQuota;
    this.quotaWindows = [];
    this.quotaLoadedAt = 0;
    this.quotaReadPromise = null;
    this.usageSnapshot = null;
    this.usageLoadedAt = 0;
    this.client = null;
    this.handlers = null;
    this.capabilities = {};
    this.sessionMetadata = new Map();
    this.createdSessions = new Map();
    this.activeSessions = new Set();
    this.activeTurns = new Map();
    this.startingSessions = new Set();
    this.activeTurnStartedAt = new Map();
    this.turnBuffers = new Map();
    this.pendingApprovals = new Map();
    this.toolAgentGroups = new Map();
    this.activeToolCalls = new Map();
    this.agentSnapshots = new Map();
    this.sessionConfigOptions = new Map();
    this.sessionAvailableCommands = new Map();
    this.sessionUsage = new Map();
    this.operations = new Set();
    this.forkingSessions = new Set();
    this.completedForkTurns = new Map();
    this.nativeCompletedForkSessions = new Set();
    this.closed = false;
  }

  async start(handlers) {
    this.handlers = withThinkingState(handlers);
    this.client = this.createClient({
      onNotification: (notification) => this.handleNotification(notification),
      onRequest: (request) => this.handleServerRequest(request),
      onExit: (error) => this.handleExit(error),
    });
    await this.client.start();
    const initialized = await this.client.request(
      "initialize",
      {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: {
          name: "relayune",
          title: "Relayune",
          version: "0.3.33",
        },
      },
      { timeoutMs: DEFAULT_RPC_TIMEOUT_MS },
    );
    if (initialized?.protocolVersion !== ACP_PROTOCOL_VERSION) {
      throw new Error(
        `${this.agentName} selected unsupported ACP protocol ${initialized?.protocolVersion ?? "unknown"}.`,
      );
    }
    this.capabilities = initialized.agentCapabilities ?? {};
    if (!this.capabilities.sessionCapabilities?.list) {
      throw new Error(`Installed ${this.agentName} does not support ACP session/list.`);
    }
  }

  async listProjectSessions({ cwd, cursor = null }) {
    const position = cursor ? JSON.parse(cursor) : { native: null, skip: 0 };
    if ((position.native !== null && typeof position.native !== "string") ||
        !Number.isSafeInteger(position.skip) || position.skip < 0) throw new Error("Invalid cursor");
    const result = await this.requestAuthenticated("session/list",
      position.native ? { cursor: position.native } : {});
    const matches = (result.sessions ?? []).filter(session => session.cwd === cwd);
    const selected = matches.slice(position.skip, position.skip + 5);
    const sessions = selected.map(session => {
      this.rememberSession(session);
      return this.toRelaySession(session);
    });
    const next = position.skip + 5 < matches.length
      ? { native: position.native, skip: position.skip + 5 }
      : result.nextCursor ? { native: result.nextCursor, skip: 0 } : null;
    if (result.nextCursor && result.nextCursor === position.native) throw new Error("Repeated cursor");
    return { sessions, next_cursor: next ? JSON.stringify(next) : null };
  }

  catalogWatchPaths() { return [join(this.kimiHome, 'sessions')]; }

  async listSessions() {
    const sessions = [];
    const collectedSessionIds = new Set();
    const seenCursors = new Set();
    let cursor = null;
    do {
      const result = await this.requestAuthenticated(
        "session/list",
        cursor ? { cursor } : {},
      );
      for (const session of result.sessions ?? []) {
        if (
          !session?.sessionId ||
          !session?.cwd ||
          collectedSessionIds.has(session.sessionId)
        ) {
          continue;
        }
        collectedSessionIds.add(session.sessionId);
        this.createdSessions.delete(session.sessionId);
        sessions.push(session);
      }
      // ACP does not guarantee cross-page ordering. Keep only the newest
      // headers in memory, but inspect remaining native pages before publishing.
      sessions.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
      sessions.splice(MAX_SESSIONS);
      if (
        result.nextCursor !== undefined &&
        result.nextCursor !== null &&
        (typeof result.nextCursor !== "string" ||
          !result.nextCursor ||
          result.nextCursor.length > 4_096)
      ) {
        throw new Error(`${this.agentName} returned an invalid session pagination cursor.`);
      }
      const nextCursor = result.nextCursor ?? null;
      if (nextCursor && seenCursors.has(nextCursor)) {
        throw new Error(`${this.agentName} returned a repeated session pagination cursor.`);
      }
      if (nextCursor) seenCursors.add(nextCursor);
      cursor = nextCursor;
    } while (cursor);

    const seen = new Set(sessions.map((session) => session.sessionId));
    for (const session of this.createdSessions.values()) {
      if (!seen.has(session.sessionId)) sessions.push(session);
    }
    sessions.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
    sessions.splice(MAX_SESSIONS);
    for (const session of sessions) this.rememberSession(session);
    let executionSnapshots = new Map();
    try {
      executionSnapshots = await this.sessionStateReader({
        sessionIds: sessions.map((session) => session.sessionId),
        kimiHome: this.kimiHome,
      });
    } catch {
      // Local Kimi wire files are advisory. ACP sessions remain usable when a
      // Kimi version changes its on-disk layout.
    }
    return sessions
      .map((session) => {
        const execution = executionSnapshotFor(executionSnapshots, session.sessionId);
        if (this.provider === "kimi" && execution?.turn_status === "completed" && execution?.fork_tail_safe === true)
          this.nativeCompletedForkSessions.add(session.sessionId);
        else this.nativeCompletedForkSessions.delete(session.sessionId);
        return this.toRelaySession(session, execution);
      })
      .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
  }

  async readUsage(options = {}) {
    const [usage] = await Promise.all([this.readTokenUsage(options), this.readQuota(options)]);
    if (!usage.kimi && !this.quotaWindows.length) return usage;
    return { kimi: { ...(usage.kimi ?? {as_of: "", daily: []}), quota_windows: this.quotaWindows } };
  }

  async readQuota({ refresh = false } = {}) {
    if (this.quotaReadPromise) return this.quotaReadPromise;
    if (!refresh && Date.now() - this.quotaLoadedAt < this.usageRefreshMs) return;
    this.quotaLoadedAt = Date.now();
    this.quotaReadPromise = this.quotaReader({kimiBin:this.kimiBin, kimiHome:this.kimiHome, workspace:this.workspace})
      .then(windows => { this.quotaWindows = windows; })
      .catch(() => { this.quotaWindows = []; });
    try { await this.quotaReadPromise; } finally { this.quotaReadPromise = null; }
  }

  async readTokenUsage({ refresh = false } = {}) {
    if (
      this.usageSnapshot &&
      !refresh &&
      Date.now() - this.usageLoadedAt < this.usageRefreshMs
    ) {
      return { kimi: this.usageSnapshot };
    }
    try {
      const daily = await this.usageReader({ kimiHome: this.kimiHome });
      this.usageSnapshot = {
        as_of: new Date().toISOString(),
        source: "local_wire",
        complete: false,
        daily,
      };
      this.usageLoadedAt = Date.now();
      return { kimi: this.usageSnapshot };
    } catch {
      return this.usageSnapshot ? { kimi: this.usageSnapshot } : {};
    }
  }

  async createSession({ cwd, name }) {
    const sessionCwd = cwd || this.workspace;
    const result = await this.requestAuthenticated("session/new", {
      cwd: sessionCwd,
      mcpServers: [],
    });
    if (!result?.sessionId) {
      throw new Error(`${this.agentName} did not return a session id.`);
    }
    await this.rememberSessionConfig(result.sessionId, result.configOptions);
    await this.applyAdvertisedKimiMode(result.sessionId);
    const now = new Date().toISOString();
    const session = {
      sessionId: result.sessionId,
      cwd: sessionCwd,
      title: name || `新建远程 ${this.agentName} 会话`,
      updatedAt: now,
    };
    this.createdSessions.set(session.sessionId, session);
    this.rememberSession(session);
    this.activeSessions.add(session.sessionId);
    return {
      ...this.toRelaySession(session),
      sync_state: "persisted",
      sync_verified_at: now,
    };
  }

  forkCapabilities(session) {
    if (!["kimi", "mcode", "opencode"].includes(this.provider) ||
        !this.capabilities.sessionCapabilities?.fork) return null;
    const id = session?.sessionId ?? session?.id;
    if (id && !this.completedForkTurns.has(id) && !this.nativeCompletedForkSessions.has(id)) return null;
    return { mode: "latest", worktree: false };
  }

  async forkSource(options) { return (await this.validateForkSource(options)).source; }

  async validateForkSource({ sessionId, messageId, turnId }) {
    if (!this.forkCapabilities()) throw acpForkError("session_fork_unsupported");
    if (this.activeTurns.has(sessionId) || this.startingSessions.has(sessionId))
      throw acpForkError("session_fork_busy");
    let metadata;
    try { metadata = await this.ensureSessionMetadata(sessionId); }
    catch { throw acpForkError("session_not_found"); }
    const snapshots = await this.sessionStateReader({ sessionIds: [sessionId], kimiHome: this.kimiHome });
    const execution = executionSnapshotFor(snapshots, sessionId);
    if (execution?.status === "active" || execution?.turn_status === "running")
      throw acpForkError("session_fork_busy");
    const observed = this.completedForkTurns.get(sessionId);
    if (this.provider === "kimi" ? execution?.turn_status !== "completed" : !observed)
      throw acpForkError("session_fork_invalid_reply");
    const replay = await this.historyReader({ kimiBin: this.kimiBin, kimiArgs: this.kimiArgs,
      workspace: this.workspace, sessionId, cwd: metadata.cwd, updatedAt: metadata.updatedAt,
      kimiHome: this.kimiHome, spawnProcess: this.spawnProcess });
    const messages = Array.isArray(replay) ? replay : replay.messages ?? [];
    const selected = messages.find(message => message.id === messageId && message.turn_id === turnId &&
      message.role === "codex");
    const latest = messages.at(-1);
    // ACP exposes no native cutoff ID for Relay's live turn alias. Matching
    // text cannot prove which turn was clicked when another client has sent
    // the same reply. Wait for the existing native history normalization.
    if (!selected) throw acpForkError("session_fork_invalid_reply");
    if (selected && selected !== latest) throw acpForkError("session_fork_latest_only");
    if (latest?.role !== "codex" || replay.fork_tail_safe !== true ||
        (this.provider !== "kimi" && latest.content !== observed.text))
      throw acpForkError("session_fork_invalid_reply");
    if (this.activeTurns.has(sessionId) || this.startingSessions.has(sessionId))
      throw acpForkError("session_fork_busy");
    return { source: this.toRelaySession(metadata, execution),
      boundary: JSON.stringify(messages.map(message => [message.role, message.content])) };
  }

  async forkSession(options) {
    if (this.forkingSessions.has(options.sessionId)) throw acpForkError("session_fork_busy");
    this.forkingSessions.add(options.sessionId);
    try {
      const { source, boundary } = await this.validateForkSource(options);
      if (options.cwd && options.cwd !== source.cwd) throw acpForkError("session_fork_unsupported");
      let result;
      try {
        // Use the same authenticated ACP connection; no secondary transport.
        result = await this.client.request("session/fork", { sessionId: options.sessionId,
          cwd: source.cwd, mcpServers: [] });
      } catch (error) {
        if (error?.code === -32601) throw acpForkError("session_fork_unsupported");
        if (/active|busy|running|in progress/i.test(error?.message ?? "")) throw acpForkError("session_fork_busy");
        throw acpForkError("session_fork_outcome_unknown");
      }
      if (!result?.sessionId || result.sessionId === options.sessionId)
        throw acpForkError("session_fork_outcome_unknown");
      const verifiedAt = new Date().toISOString();
      try {
        const replay = await this.historyReader({ kimiBin: this.kimiBin, kimiArgs: this.kimiArgs,
          workspace: this.workspace, sessionId: result.sessionId, cwd: source.cwd, updatedAt: verifiedAt,
          kimiHome: this.kimiHome, spawnProcess: this.spawnProcess });
        const messages = Array.isArray(replay) ? replay : replay.messages ?? [];
        if (JSON.stringify(messages.map(message => [message.role, message.content])) !== boundary ||
            replay.fork_tail_safe !== true)
          throw new Error("Native fork boundary changed");
      } catch { throw acpForkError("session_fork_outcome_unknown"); }
      await this.rememberSessionConfig(result.sessionId, result.configOptions);
      const metadata = { sessionId: result.sessionId, cwd: source.cwd,
        title: source.name, updatedAt: verifiedAt };
      this.rememberSession(metadata);
      this.createdSessions.set(result.sessionId, metadata);
      // Resume through ensureSessionActive before the first prompt so Kimi's
      // existing advertised manual-mode gate is applied to the new session.
      // The inherited tail is native history, but must be revalidated before
      // another fork. Preserve only the existing observed native completion.
      const observed = this.completedForkTurns.get(options.sessionId);
      if (observed) this.completedForkTurns.set(result.sessionId, { ...observed });
      if (this.nativeCompletedForkSessions.has(options.sessionId)) this.nativeCompletedForkSessions.add(result.sessionId);
      return { ...this.toRelaySession(metadata), sync_state: "persisted", sync_verified_at: verifiedAt };
    } finally { this.forkingSessions.delete(options.sessionId); }
  }

  async readHistory({ sessionId, limit = 100, before = null, includeAgentDetails = true }) {
    const metadata = await this.ensureSessionMetadata(sessionId);
    const replay = await this.historyReader({
      kimiBin: this.kimiBin,
      kimiArgs: this.kimiArgs,
      workspace: this.workspace,
      sessionId,
      cwd: metadata.cwd,
      updatedAt: metadata.updatedAt,
      kimiHome: this.kimiHome,
      spawnProcess: this.spawnProcess,
    });
    const messages = Array.isArray(replay) ? replay : (replay.messages ?? []);
    const replayAgents = Array.isArray(replay) ? [] : (replay.agents ?? []);
    let localAgents = [];
    let execution = null;
    if (includeAgentDetails) {
      // Both advisory readers may load entire child wire files; a main-history
      // size check does not bound that optional work during background warming.
      try {
        localAgents = await this.agentStateReader({
          sessionId,
          kimiHome: this.kimiHome,
        });
      } catch {
        // Agent status is advisory; failure must not hide the main transcript.
      }
      try {
        const snapshots = await this.sessionStateReader({
          sessionIds: [sessionId],
          kimiHome: this.kimiHome,
        });
        execution = executionSnapshotFor(snapshots, sessionId);
      } catch {
        // Keep history readable even if the local execution marker is unavailable.
      }
    }
    const agents = includeAgentDetails ? mergeKimiAgentSnapshots(replayAgents, localAgents) : [];
    const latest = messages.at(-1);
    const observed = this.completedForkTurns.get(sessionId);
    if (latest?.role === "codex" && ((execution?.turn_status === "completed" && replay.fork_tail_safe === true) ||
        (observed && replay.fork_tail_safe === true && latest.content === observed.text))) {
      latest.turn_status = "completed"; latest.message_phase = "final_answer";
      if (this.provider === "kimi") this.nativeCompletedForkSessions.add(sessionId);
    }
    if (includeAgentDetails) this.agentSnapshots.set(sessionId, agents);
    return {
      ...paginateHistory(messages, { limit, before }),
      agents,
      sessions: includeAgentDetails ? [this.toRelaySession(metadata, execution)] : [],
    };
  }

  async readAgents({ sessionId }) {
    await this.ensureSessionMetadata(sessionId);
    const localAgents = await this.agentStateReader({
      sessionId,
      kimiHome: this.kimiHome,
    });
    const agents = mergeKimiAgentSnapshots(
      this.agentSnapshots.get(sessionId) ?? [],
      localAgents,
    );
    this.agentSnapshots.set(sessionId, agents);
    return agents;
  }

  submitMessage(options) {
    if (options.interruptRunning) return stopBeforeSending(this, options, () => this.submitMessageUnlocked(options));
    return this.submitMessageUnlocked(options);
  }

  async submitMessageUnlocked({ sessionId, requestId, content, attachments = [] }) {
    if (this.closed) throw new Error(`${this.agentName} adapter is closed.`);
    if (this.activeTurns.has(sessionId) || this.startingSessions.has(sessionId) || this.forkingSessions.has(sessionId)) {
      throw new Error(
        `${this.agentName} ACP does not support steering an active turn; stop it before sending another message.`,
      );
    }
    this.startingSessions.add(sessionId);
    this.completedForkTurns.delete(sessionId);
    this.nativeCompletedForkSessions.delete(sessionId);
    try {
      await this.ensureSessionActive(sessionId);
      if (this.closed) throw new Error(`${this.agentName} adapter is closed.`);
    } finally {
      this.startingSessions.delete(sessionId);
    }
    const turnId = createId(`turn_${this.provider}`);
    const startedAt = new Date().toISOString();
    this.activeTurns.set(sessionId, turnId);
    this.activeTurnStartedAt.set(sessionId, startedAt);
    this.turnBuffers.set(sessionId, "");
    try {
      await this.handlers.emitEvent(sessionId, {
        kind: "turn.started",
        turn_id: turnId,
        request_id: requestId,
        provider: this.provider,
      });
      if (this.closed) throw new Error(`${this.agentName} adapter is closed.`);
    } catch (error) {
      await this.finishTurn(sessionId);
      throw error;
    }

    const operation = this.client
      .request(
        "session/prompt",
        {
          sessionId,
          prompt: [
            ...(content ? [{ type: "text", text: content }] : []),
            ...attachments.map((attachment) => ({
              type: "image",
              data: attachment.base64,
              mimeType: attachment.mime_type,
            })),
          ],
        },
        { timeoutMs: null },
      )
      .then((result) => this.completePrompt(sessionId, turnId, result))
      .catch((error) => this.failPrompt(sessionId, turnId, error));
    this.operations.add(operation);
    void operation.finally(() => this.operations.delete(operation));
    return {
      mode: "started",
      turnId,
      persisted: true,
      syncVerifiedAt: new Date().toISOString(),
    };
  }

  interruptTurn(options) {
    return serializeSessionControl(this, options.sessionId, () => this.interruptTurnUnlocked(options));
  }

  async interruptTurnUnlocked({ sessionId }) {
    if (!this.activeTurns.has(sessionId)) {
      throw new Error(`No active ${this.agentName} turn to interrupt.`);
    }
    this.client.notify("session/cancel", { sessionId });
  }

  async configureSession({ sessionId, configId, value }) {
    await this.ensureSessionActive(sessionId);
    const options = this.sessionConfigOptions.get(sessionId) ?? [];
    const config = options.find((candidate) => candidate.id === configId);
    if (!config || !["model", "thinking", "mode"].includes(configId)) {
      throw new Error(`${this.agentName} did not advertise the ${configId} setting.`);
    }
    const allowed =
      config.type === "boolean"
        ? typeof value === "boolean"
        : config.options.some((option) => option.value === value);
    if (!allowed) {
      throw new Error(`${this.agentName} did not advertise the selected ${configId} value.`);
    }
    const result = await this.requestAuthenticated(
      "session/set_config_option",
      { sessionId, configId, value },
      { timeoutMs: DEFAULT_RPC_TIMEOUT_MS },
    );
    await this.rememberSessionConfig(sessionId, result?.configOptions);
    return {
      configOptions: this.sessionConfigOptions.get(sessionId) ?? [],
    };
  }

  async resolveApproval({ approvalId, decision, optionId, answer }) {
    if (!["approved", "rejected"].includes(decision)) {
      throw new Error(`${this.agentName} ACP approval decision is invalid.`);
    }
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) {
      throw new Error(`${this.agentName} ACP approval is no longer pending.`);
    }
    if (answer != null) {
      if (this.provider !== "kimi" || pending.action?.allows_freeform !== true ||
          decision !== "approved" || optionId || typeof answer !== "string" ||
          !answer.trim() || answer.length > 4000) {
        throw new Error("This Kimi request does not accept a custom answer.");
      }
      return serializeSessionControl(this, pending.sessionId, async () => {
        if (this.pendingApprovals.get(approvalId) !== pending) throw new Error("Kimi question is no longer pending.");
        const oldTurn = this.activeTurns.get(pending.sessionId);
        if (!oldTurn) throw new Error("Kimi question has no active turn.");
        // ACP only accepts declared option IDs. Cancel first, wait for the real
        // terminal acknowledgement, then deliver the user's text as a new user
        // message in the same session. Never fabricate an option or tool answer.
        this.pendingApprovals.delete(approvalId);
        this.client.notify("session/cancel", { sessionId: pending.sessionId });
        this.client.respond(pending.rpcId, { outcome: { outcome: "cancelled" } });
        const deadline = Date.now() + (this.controlTimeoutMs ?? 10000);
        while (this.activeTurns.get(pending.sessionId) === oldTurn) {
          if (this.closed || Date.now() >= deadline) {
            throw new Error("Kimi stop was not confirmed; custom answer was not sent.");
          }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        const content = `My answer to your question (${pending.action.display}) is:\n${answer}`;
        const requestId = createId("answer_kimi");
        const result = await this.submitMessageUnlocked({ sessionId: pending.sessionId,
          requestId, content });
        await this.handlers.emitEvent(pending.sessionId, {
          kind: "user.message", turn_id: result.turnId, text: content,
          client_message_id: requestId, provider: this.provider,
        });
        return result;
      });
    }
    const selected = selectPermissionOption(pending.options, decision, optionId);
    this.pendingApprovals.delete(approvalId);
    if (selected) {
      this.client.respond(pending.rpcId, {
        outcome: {
          outcome: "selected",
          optionId: selected.optionId,
        },
      });
      return;
    }
    this.client.respond(pending.rpcId, {
      outcome: { outcome: "cancelled" },
    });
  }

  async createAgents({ sessionId, tasks }) {
    return this.submitMessage({
      sessionId,
      content: `请使用 Kimi Code 的原生子 Agent 并行处理以下任务，等待全部完成后汇总结果：\n${tasks
        .map((task, index) => `${index + 1}. ${task}`)
        .join("\n")}`,
    });
  }

  async close() {
    this.closed = true;
    for (const pending of this.pendingApprovals.values()) {
      this.client?.respond(pending.rpcId, {
        outcome: { outcome: "cancelled" },
      });
    }
    this.pendingApprovals.clear();
    this.toolAgentGroups.clear();
    this.activeToolCalls.clear();
    this.agentSnapshots.clear();
    this.sessionConfigOptions.clear();
    this.sessionAvailableCommands.clear();
    this.sessionUsage.clear();
    this.usageSnapshot = null;
    this.usageLoadedAt = 0;
    await this.client?.close();
    this.client = null;
    await Promise.allSettled([...this.operations]);
  }

  createClient(handlers) {
    return new AcpJsonRpcClient({
      command: this.kimiBin,
      args: this.kimiArgs,
      cwd: this.workspace,
      env: process.env,
      spawnProcess: this.spawnProcess,
      debug: process.env.KIMI_RELAY_DEBUG === "1",
      ...handlers,
    });
  }

  async requestAuthenticated(method, params, options) {
    try {
      return await this.client.request(method, params, options);
    } catch (error) {
      if (error?.code === -32000) {
        throw new Error(
          `${this.agentName} authentication is required. Run \`kimi login\` locally, then restart Relayune.`,
        );
      }
      throw error;
    }
  }

  rememberSession(session) {
    if (!session?.sessionId) return;
    const current = this.sessionMetadata.get(session.sessionId) ?? {};
    this.sessionMetadata.set(session.sessionId, {
      ...current,
      ...session,
    });
  }

  async ensureSessionMetadata(sessionId) {
    const cached = this.sessionMetadata.get(sessionId);
    if (cached?.cwd) return cached;
    await this.listSessions();
    const loaded = this.sessionMetadata.get(sessionId);
    if (!loaded?.cwd) {
      throw new Error(`${this.agentName} session ${sessionId} was not found.`);
    }
    return loaded;
  }

  async ensureSessionActive(sessionId) {
    if (this.activeSessions.has(sessionId)) return;
    const metadata = await this.ensureSessionMetadata(sessionId);
    const method = this.capabilities.sessionCapabilities?.resume
      ? "session/resume"
      : "session/load";
    const result = await this.requestAuthenticated(method, {
      sessionId,
      cwd: metadata.cwd,
      mcpServers: [],
    });
    await this.rememberSessionConfig(sessionId, result?.configOptions);
    await this.applyAdvertisedKimiMode(sessionId);
    this.activeSessions.add(sessionId);
  }

  async applyAdvertisedKimiMode(sessionId) {
    if (this.provider !== "kimi") return;
    const mode = this.sessionConfigOptions.get(sessionId)?.find(option => option.id === "mode");
    if (!mode || !mode.options?.some(option => option.value === mode.currentValue)) return;
    // Kimi can inherit auto execution while advertising default/manual after
    // new/load. Apply the advertised value before any prompt is allowed through.
    const result = await this.requestAuthenticated("session/set_config_option", {
      sessionId, configId: "mode", value: mode.currentValue,
    });
    await this.rememberSessionConfig(sessionId, result?.configOptions);
  }

  async rememberSessionConfig(sessionId, configOptions) {
    const normalized = normalizeSessionConfigOptions(configOptions);
    if (!normalized || JSON.stringify(this.sessionConfigOptions.get(sessionId)) === JSON.stringify(normalized)) return;
    this.sessionConfigOptions.set(sessionId, normalized);
    await this.handlers?.emitEvent(sessionId, {
      kind: "session.config_updated",
      provider: this.provider,
      config_options: structuredClone(normalized),
    });
  }

  toRelaySession(session, execution = null) {
    const cwd = session.cwd || this.workspace;
    const relayTurnActive = this.activeTurns.has(session.sessionId);
    const locallyActive = execution?.status === "active";
    return {
      id: session.sessionId,
      ...(this.forkCapabilities(session) ? { fork_mode: "latest" } : {}),
      name: session.title || `${this.agentName} 会话`,
      project: basename(cwd),
      branch: "—",
      cwd,
      status: relayTurnActive || locallyActive ? "active" : "idle",
      can_interrupt: relayTurnActive,
      running_started_at:
        (relayTurnActive && this.activeTurnStartedAt.get(session.sessionId)) ||
        (locallyActive ? execution.running_started_at : null) ||
        null,
      updated_at: normalizeTimestamp(session.updatedAt),
      provider: this.provider,
      supports_steering: false,
      supports_interrupt_and_send: true,
      kimi_config_options: this.sessionConfigOptions.get(session.sessionId) ?? [],
      kimi_commands: this.sessionAvailableCommands.get(session.sessionId) ?? [],
      usage: this.sessionUsage.get(session.sessionId) ?? execution?.usage ?? null,
      agent_role: execution?.role ?? null,
      model: execution?.model ?? null,
      reasoning_effort: execution?.reasoning_effort ?? null,
      permission_mode: execution?.permission_mode ?? null,
      swarm_mode: execution?.swarm_mode ?? null,
    };
  }

  async handleNotification(notification) {
    if (notification.method !== "session/update") return;
    const sessionId = notification.params?.sessionId;
    const update = notification.params?.update;
    if (!sessionId || !update) return;
    if (update.sessionUpdate === "session_info_update") {
      this.rememberSession({
        sessionId,
        title: update.title ?? undefined,
        updatedAt: update.updatedAt ?? new Date().toISOString(),
      });
      return;
    }
    if (update.sessionUpdate === "config_option_update") {
      await this.rememberSessionConfig(sessionId, update.configOptions);
      return;
    }
    if (update.sessionUpdate === "available_commands_update") {
      this.sessionAvailableCommands.set(
        sessionId,
        normalizeAvailableCommands(update.availableCommands),
      );
      return;
    }
    if (update.sessionUpdate === "usage_update") {
      this.sessionUsage.set(sessionId, normalizeUsage(update));
      this.usageLoadedAt = 0;
      return;
    }
    const turnId = this.activeTurns.get(sessionId);
    if (!turnId) return;
    switch (update.sessionUpdate) {
      case "agent_thought_chunk":
        await this.handlers.emitEvent(sessionId, {
          kind: "turn.thinking", turn_id: turnId, active: true, provider: this.provider,
        });
        break;
      case "agent_message_chunk": {
        const text = textFromContentBlock(update.content);
        if (!text) return;
        this.turnBuffers.set(
          sessionId,
          `${this.turnBuffers.get(sessionId) ?? ""}${text}`,
        );
        await this.handlers.emitEvent(sessionId, {
          kind: "message.delta",
          turn_id: turnId,
          text,
          provider: this.provider,
        });
        break;
      }
      case "tool_call": {
        if (typeof update.toolCallId !== "string" || !update.toolCallId) break;
        const toolCallId = normalizeKimiToolCallId(update.toolCallId);
        const activeToolCalls = this.activeToolCalls.get(sessionId) ?? new Set();
        if (activeToolCalls.has(toolCallId)) break;
        activeToolCalls.add(toolCallId);
        this.activeToolCalls.set(sessionId, activeToolCalls);
        const toolAgents = kimiAgentsFromToolCall(
          sessionId,
          update,
          new Date().toISOString(),
        );
        if (toolAgents.length) {
          this.toolAgentGroups.set(
            kimiToolGroupKey(sessionId, update.toolCallId),
            toolAgents,
          );
          for (const agent of toolAgents) {
            await this.emitAgentEvent(sessionId, agent);
          }
        }
        await this.handlers.emitEvent(sessionId, {
          kind: "command.started",
          turn_id: turnId,
          item_id: update.toolCallId,
          command: toolDisplay(update),
          cwd: this.sessionMetadata.get(sessionId)?.cwd ?? this.workspace,
          status: update.status,
          provider: this.provider,
        });
        break;
      }
      case "tool_call_update": {
        const toolCallId = normalizeKimiToolCallId(update.toolCallId);
        const activeToolCalls = this.activeToolCalls.get(sessionId);
        if (!activeToolCalls?.has(toolCallId)) break;
        if (!["completed", "failed"].includes(update.status)) break;
        activeToolCalls.delete(toolCallId);
        if (!activeToolCalls.size) this.activeToolCalls.delete(sessionId);
        const text = textFromToolContent(update.content);
        const groupKey = kimiToolGroupKey(sessionId, update.toolCallId);
        const toolAgents = this.toolAgentGroups.get(groupKey) ?? [];
        for (const agent of toolAgents) {
          await this.emitAgentEvent(sessionId, {
            ...agent,
            status: update.status === "completed" ? "completed" : "errored",
            progress: 100,
            summary: text ? truncate(text, MAX_AGENT_SUMMARY_TEXT) : agent.summary,
            updated_at: new Date().toISOString(),
          });
        }
        if (toolAgents.length) this.toolAgentGroups.delete(groupKey);
        await this.handlers.emitEvent(sessionId, {
          kind: "command.output",
          turn_id: turnId,
          item_id: update.toolCallId,
          text: text || `${this.agentName} 工具调用${update.status === "failed" ? "失败" : "完成"}。`,
          status: update.status,
          provider: this.provider,
        });
        break;
      }
      case "plan":
        await this.handlers.emitEvent(sessionId, {
          kind: "plan.updated",
          turn_id: turnId,
          explanation: null,
          plan: (update.entries ?? []).map((entry) => ({
            step: entry.content,
            status:
              entry.status === "in_progress"
                ? "inProgress"
                : entry.status === "completed"
                  ? "completed"
                  : "pending",
          })),
          provider: this.provider,
        });
        break;
    }
  }

  async emitAgentEvent(sessionId, agent) {
    const current = this.agentSnapshots.get(sessionId) ?? [];
    this.agentSnapshots.set(
      sessionId,
      mergeKimiAgentSnapshots(
        current.filter((candidate) => candidate.id !== agent.id),
        [agent],
      ),
    );
    const terminal = !["pendingInit", "running"].includes(agent.status);
    await this.handlers.emitEvent(
      sessionId,
      {
        kind:
          agent.status === "completed"
            ? "agent.completed"
            : agent.status === "errored"
              ? "agent.failed"
              : agent.status === "interrupted"
                ? "agent.interrupted"
                : "agent.updated",
        thread_id: agent.thread_id,
        parent_thread_id: agent.parent_thread_id,
        root_session_id: agent.parent_session_id,
        name: agent.name,
        role: agent.role,
        task: agent.task,
        agent_status: agent.status,
        progress: agent.progress,
        summary: agent.summary,
        model: agent.model,
        reasoning_effort: agent.reasoning_effort,
        tool: agent.tool,
        current_activity: agent.current_activity,
        tool_count: agent.tool_count,
        token_count: agent.token_count,
        context_tokens: agent.context_tokens,
        permission_mode: agent.permission_mode,
        swarm_mode: agent.swarm_mode,
        activity_log: agent.activity_log,
        started_at: agent.started_at,
        updated_at: agent.updated_at,
        can_open: agent.can_open,
        terminal,
        provider: this.provider,
      },
      { agent_id: agent.id },
    );
  }

  async handleServerRequest(request) {
    if (request.method !== "session/request_permission") {
      this.client.respondError(
        request.id,
        -32601,
        `Unsupported Kimi ACP client request: ${request.method}`,
      );
      return;
    }
    const params = request.params ?? {};
    const sessionId = params.sessionId;
    const options = sanitizePermissionOptions(params.options);
    if (!sessionId || !options.length) {
      this.client.respond(request.id, {
        outcome: { outcome: "cancelled" },
      });
      return;
    }
    const action = actionFromPermission(
      params,
      this.sessionMetadata.get(sessionId)?.cwd ?? this.workspace,
    );
    if (this.provider === "kimi" && action.type === "question.select" &&
        options.some(option => /^q\d+_/.test(option.option_id))) {
      action.allows_freeform = true;
      action.freeform_delivery = "followup";
    }
    const approvalId = `apr_${this.provider}_${request.id}`;
    this.pendingApprovals.set(approvalId, {
      rpcId: request.id,
      sessionId,
      options,
      action,
    });
    await this.handlers.requestApproval({
      approval_id: approvalId,
      request_id: `rpc_${request.id}`,
      session_id: sessionId,
      root_session_id: sessionId,
      source_thread_id: sessionId,
      source_agent_id: null,
      source_agent_name: `${this.agentName} 主会话`,
      turn_id: this.activeTurns.get(sessionId) ?? null,
      action: { ...action, command_hash: hashAction(action) },
      risk_level: riskLevelFromToolCall(params.toolCall),
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
  }

  async completePrompt(sessionId, turnId, result) {
    if (this.activeTurns.get(sessionId) !== turnId) return;
    const text = this.turnBuffers.get(sessionId) ?? "";
    if (text) {
      await this.handlers.emitEvent(sessionId, {
        kind: "message.completed",
        turn_id: turnId,
        text,
        provider: this.provider,
      });
    }
    const stopReason = result?.stopReason ?? "end_turn";
    if (["end_turn", "stop", "stop_sequence"].includes(result?.stopReason) && text)
      this.completedForkTurns.set(sessionId, { turnId, text });
    await this.handlers.emitEvent(sessionId, {
      kind: "turn.completed",
      turn_id: turnId,
      status: stopReason === "cancelled" ? "interrupted"
        : stopReason === "end_turn" ? "completed" : stopReason,
      provider: this.provider,
    });
    await this.finishTurn(sessionId);
  }

  async failPrompt(sessionId, turnId, error) {
    if (this.activeTurns.get(sessionId) !== turnId) return;
    await this.handlers.emitEvent(sessionId, {
      kind: "turn.failed",
      turn_id: turnId,
      error: error instanceof Error ? error.message : `${this.agentName} ACP turn failed.`,
      provider: this.provider,
    });
    await this.finishTurn(sessionId);
  }

  async finishTurn(sessionId) {
    this.usageLoadedAt = 0;
    for (const [approvalId, pending] of this.pendingApprovals) {
      if (pending.sessionId !== sessionId) continue;
      this.pendingApprovals.delete(approvalId);
      this.client?.respond(pending.rpcId, { outcome: { outcome: "cancelled" } });
      await this.handlers.emitEvent(sessionId, {
        kind: "approval.resolved", approval_id: approvalId, decision: "expired",
        turn_id: this.activeTurns.get(sessionId) ?? null, provider: this.provider,
      });
    }
    this.activeTurns.delete(sessionId);
    this.activeTurnStartedAt.delete(sessionId);
    this.turnBuffers.delete(sessionId);
    for (const key of this.toolAgentGroups.keys()) {
      if (key.startsWith(`${sessionId}\0`)) this.toolAgentGroups.delete(key);
    }
    this.activeToolCalls.delete(sessionId);
    const metadata = this.sessionMetadata.get(sessionId);
    if (metadata) {
      this.rememberSession({
        ...metadata,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  handleExit(error) {
    if (this.closed || !this.handlers) return;
    for (const [sessionId, turnId] of this.activeTurns) {
      void this.handlers.emitEvent(sessionId, {
        kind: "turn.failed",
        turn_id: turnId,
        error: error.message,
        provider: this.provider,
      });
    }
    this.activeTurns.clear();
    this.activeTurnStartedAt.clear();
    this.turnBuffers.clear();
    this.toolAgentGroups.clear();
    this.activeToolCalls.clear();
    this.pendingApprovals.clear();
  }
}

export class AcpJsonRpcClient {
  constructor(options) {
    this.command = options.command;
    this.args = options.args;
    this.cwd = options.cwd;
    this.env = options.env;
    this.spawnProcess = options.spawnProcess;
    this.onNotification = options.onNotification ?? (() => {});
    this.onRequest = options.onRequest ?? (() => {});
    this.onExit = options.onExit ?? (() => {});
    this.debug = options.debug;
    this.agentName = options.agentName ?? "Kimi";
    this.child = null;
    this.readline = null;
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
    this.incomingQueue = Promise.resolve();
    this.childExit = null;
    this.closePromise = null;
    this.shutdownGraceMs = options.shutdownGraceMs ?? 1000;
    this.shutdownKillMs = options.shutdownKillMs ?? 1000;
    for (const timeout of [this.shutdownGraceMs, this.shutdownKillMs]) {
      if (!Number.isFinite(timeout) || timeout < 1 || timeout > 10000)
        throw new Error("ACP shutdown timeout must be between 1 and 10000 ms.");
    }
  }

  async start() {
    if (this.closed) throw new Error(`${this.agentName} ACP connection closed.`);
    this.child = this.spawnProcess(
      this.command,
      this.args,
      agentSpawnOptions(this.command, {
        cwd: this.cwd,
        env: this.env,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
    const child = this.child;
    // Register before RPC work: a process that exits (or fails to spawn) before
    // close() still has a resolved termination promise and must not time out.
    this.childExit = new Promise(resolve => {
      child.once("exit", resolve);
      child.once("error", () => { if (!child.pid) resolve(); });
    });
    this.readline = createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });
    this.readline.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk) => {
      if (this.debug) process.stderr.write(chunk);
    });
    this.child.stdin.on("error", (error) => this.fail(error));
    this.child.once("error", (error) => this.fail(error));
    this.child.once("exit", (code, signal) => {
      if (this.closed) return;
      this.fail(
        new Error(`${this.agentName === "Kimi" ? "kimi acp" : `${this.agentName} ACP`} exited with ${signal ?? code ?? 1}.`),
      );
    });
  }

  request(method, params, { timeoutMs = DEFAULT_RPC_TIMEOUT_MS } = {}) {
    if (this.closed || !this.child?.stdin?.writable) {
      return Promise.reject(new Error(`${this.agentName} ACP connection is not writable.`));
    }
    const id = this.nextId++;
    this.write({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      let timeout = null;
      if (timeoutMs !== null) {
        timeout = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`${this.agentName} ACP ${method} timed out.`));
        }, timeoutMs);
      }
      this.pending.set(id, { resolve, reject, timeout });
    });
  }

  notify(method, params) {
    this.write({ jsonrpc: "2.0", method, params });
  }

  respond(id, result) {
    this.write({ jsonrpc: "2.0", id, result });
  }

  respondError(id, code, message) {
    this.write({
      jsonrpc: "2.0",
      id,
      error: { code, message },
    });
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.readline?.close();
    this.rejectAll(new Error(`${this.agentName} ACP connection closed.`));
    const child = this.child;
    this.closePromise = (async () => {
      if (!child) return;
      if (child.exitCode === null && child.signalCode === null && child.pid) {
        child.stdin?.end();
        child.kill("SIGTERM");
        if (!await this.waitForExit(this.shutdownGraceMs)) {
          child.kill("SIGKILL");
          if (!await this.waitForExit(this.shutdownKillMs)) {
            throw new Error(`${this.agentName} ACP shutdown timed out.`);
          }
        }
      }
      // No PID means spawn failed; non-null exit/signal codes mean Node has
      // already reaped the process. Neither case needs another event or timer.
      this.child = null;
    })();
    return this.closePromise;
  }

  async waitForExit(timeoutMs) {
    let timer;
    try {
      return await Promise.race([
        this.childExit.then(() => true),
        new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  }

  write(message) {
    if (!this.closed) this.child?.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      const priorIncoming = this.incomingQueue;
      void priorIncoming.then(() => {
        if (message.error) {
          const error = new Error(message.error.message ?? `${this.agentName} ACP request failed.`);
          error.code = message.error.code;
          error.data = message.error.data;
          pending.reject(error);
        } else {
          pending.resolve(message.result);
        }
      });
      return;
    }
    if (message.id !== undefined && message.method) {
      this.incomingQueue = this.incomingQueue
        .then(() => this.onRequest(message))
        .catch((error) => {
          this.respondError(
            message.id,
            -32603,
            error instanceof Error
              ? error.message
              : `${this.agentName} ACP client request failed.`,
          );
        });
      return;
    }
    if (message.method) {
      this.incomingQueue = this.incomingQueue
        .then(() => this.onNotification(message))
        .catch(() => {});
    }
  }

  fail(error) {
    if (this.closed) return;
    this.rejectAll(error);
    this.onExit(error);
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

// History must never load a session in a second ACP process: Kimi 0.42
// persists auto permission mode during session/load, even for a read-only client.
export async function readKimiHistoryFromLocalWire({
  sessionId,
  kimiHome = process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code"),
  updatedAt,
}) {
  const sessionDir = await findKimiSessionDirectory(kimiHome, sessionId);
  if (!sessionDir) throw new Error("Kimi local session history is unavailable.");
  const wire = await readFile(join(sessionDir, "agents", "main", "wire.jsonl"), "utf8");
  return { messages: historyMessagesFromKimiWire(sessionId, wire, updatedAt), agents: [],
    fork_tail_safe: kimiForkTailSafeFromWire(wire) };
}

export function kimiForkTailSafeFromWire(wire) {
  let tail = null, completed = false;
  for (const line of String(wire ?? "").split("\n")) {
    let record; try { record = JSON.parse(line); } catch { continue; }
    if (record.agentId && record.agentId !== "main") continue;
    // Include image-only/internal/steered input even when its text projection
    // is hidden. A whole-session fork would still inherit that later input.
    if (["turn.prompt", "turn.steer", "turn.cancel"].includes(record.type) ||
        (record.type === "context.append_message" && record.message?.role === "user")) {
      tail = "other"; completed = false;
    }
    const event = record.type === "context.append_loop_event" && record.event;
    if (!event) continue;
    if (event.type === "step.begin" || event.type === "tool.call" || event.type === "tool.result") {
      tail = "other"; completed = false;
    } else if (event.type === "content.part" && event.part?.type === "text" && event.part.text?.trim()) {
      tail = "reply";
    } else if (event.type === "step.end") {
      completed = event.finishReason === "end_turn";
    }
  }
  return tail === "reply" && completed;
}

export function historyMessagesFromKimiWire(sessionId, wire, timestamp) {
  const updates = [];
  const seenPrompts = new Set();
  const seenEvents = new Set();
  const pushText = (sessionUpdate, parts) => {
    for (const part of parts ?? []) {
      // Never forward reasoning, tool outputs, or internal system messages.
      if (part?.type === "text" && typeof part.text === "string") {
        updates.push({ sessionUpdate, content: part });
      }
    }
  };
  for (const line of String(wire ?? "").split("\n")) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (record.agentId && record.agentId !== "main") continue;
    if (record.type === "context.append_message" && record.message?.role === "user") {
      const message = record.message;
      if (message.origin?.kind && message.origin.kind !== "user") continue;
      if (message.id && seenPrompts.has(message.id)) continue;
      if (message.id) seenPrompts.add(message.id);
      updates.push({ sessionUpdate: "history_turn_boundary" });
      pushText("user_message_chunk", message.content);
    } else if (record.type === "turn.prompt") {
      if (record.origin?.kind && record.origin.kind !== "user") continue;
      if (record.promptId && seenPrompts.has(record.promptId)) continue;
      if (record.promptId) seenPrompts.add(record.promptId);
      updates.push({ sessionUpdate: "history_turn_boundary" });
      pushText("user_message_chunk", record.input);
    } else if (record.type === "context.append_loop_event") {
      const event = record.event;
      if (event?.type !== "content.part") continue;
      if (event.uuid && seenEvents.has(event.uuid)) continue;
      if (event.uuid) seenEvents.add(event.uuid);
      pushText("agent_message_chunk", [event.part]);
    }
  }
  return historyMessagesFromKimiUpdates(sessionId, updates, timestamp);
}

// OpenCode still uses ACP replay; Kimi must use the read-only wire reader above.
export async function readKimiHistoryFromIndependentAcp({
  kimiBin,
  kimiArgs,
  workspace,
  sessionId,
  cwd,
  updatedAt,
  spawnProcess = spawn,
}) {
  const updates = [];
  const client = new AcpJsonRpcClient({
    command: kimiBin,
    args: kimiArgs,
    cwd: workspace,
    env: process.env,
    spawnProcess,
    debug: process.env.KIMI_RELAY_DEBUG === "1",
    onNotification: (notification) => {
      if (
        notification.method === "session/update" &&
        notification.params?.sessionId === sessionId
      ) {
        updates.push(notification.params.update);
      }
    },
    onRequest: (request) => {
      client.respondError(
        request.id,
        -32601,
        "History reader does not expose reverse ACP capabilities.",
      );
    },
  });
  try {
    await client.start();
    const initialized = await client.request("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: {
        name: "relayune-history-reader",
        title: "Relayune History Reader",
        version: "0.3.33",
      },
    });
    if (!initialized?.agentCapabilities?.loadSession) {
      throw new Error("Installed Kimi Code cannot replay ACP session history.");
    }
    await client.request(
      "session/load",
      {
        sessionId,
        cwd,
        mcpServers: [],
      },
      { timeoutMs: 30_000 },
    );
    return {
      messages: historyMessagesFromKimiUpdates(sessionId, updates, updatedAt),
      agents: kimiAgentsFromUpdates(sessionId, updates, updatedAt),
      fork_tail_safe: acpHistoryForkTailSafe(updates),
    };
  } catch (error) {
    if (error?.code === -32000) {
      throw new Error(
        "Kimi Code authentication is required. Run `kimi login` locally, then restart Relayune.",
      );
    }
    throw error;
  } finally {
    await client.close();
  }
}

export function acpHistoryForkTailSafe(updates) {
  let tail = null;
  const pendingTools = new Set();
  for (const update of updates) {
    if (["user_message_chunk", "agent_thought_chunk", "history_turn_boundary"].includes(update?.sessionUpdate))
      tail = "other";
    else if (update?.sessionUpdate === "agent_message_chunk") tail = "reply";
    else if (["tool_call", "tool_call_update"].includes(update?.sessionUpdate)) {
      tail = "tool";
      if (["completed", "failed"].includes(update.status)) pendingTools.delete(update.toolCallId);
      else if (update.status || update.sessionUpdate === "tool_call") pendingTools.add(update.toolCallId);
    }
  }
  return tail === "reply" && pendingTools.size === 0;
}

export function historyMessagesFromKimiUpdates(
  sessionId,
  updates,
  timestamp = new Date().toISOString(),
) {
  const messages = [];
  let turnIndex = 0;
  let currentTurnId = null;
  let messageIndex = 0;
  let pendingMessage = null;
  const flushMessage = () => {
    if (!pendingMessage?.content) return;
    messageIndex += 1;
    messages.push({
      id: stableId(
        "msg_kimi_history",
        sessionId,
        messageIndex,
        pendingMessage.role,
        pendingMessage.content,
      ),
      role: pendingMessage.role,
      content: pendingMessage.content,
      created_at: normalizeTimestamp(timestamp),
      turn_id: pendingMessage.turnId,
      provider: "kimi",
    });
    pendingMessage = null;
  };
  for (const update of updates) {
    const kind = update?.sessionUpdate;
    if (kind === "history_turn_boundary") { flushMessage(); continue; }
    if (!["user_message_chunk", "agent_message_chunk"].includes(kind)) continue;
    const content = textFromContentBlock(update.content);
    if (!content) continue;
    const role = kind === "user_message_chunk" ? "user" : "codex";
    if (pendingMessage?.role === role) {
      pendingMessage.content += content;
      continue;
    }
    flushMessage();
    if (role === "user") {
      turnIndex += 1;
      currentTurnId = stableId(
        "turn_kimi_history",
        sessionId,
        turnIndex,
      );
    } else if (!currentTurnId) {
      turnIndex += 1;
      currentTurnId = stableId(
        "turn_kimi_history",
        sessionId,
        turnIndex,
      );
    }
    pendingMessage = {
      role,
      content,
      turnId: currentTurnId,
    };
  }
  flushMessage();
  return messages;
}

export function kimiAgentsFromUpdates(
  sessionId,
  updates,
  timestamp = new Date().toISOString(),
) {
  const agents = new Map();
  const groups = new Map();
  for (const update of updates ?? []) {
    if (update?.sessionUpdate === "tool_call") {
      const group = kimiAgentsFromToolCall(sessionId, update, timestamp);
      if (!group.length) continue;
      groups.set(normalizeKimiToolCallId(update.toolCallId), group.map((agent) => agent.id));
      for (const agent of group) agents.set(agent.id, agent);
      continue;
    }
    if (update?.sessionUpdate !== "tool_call_update") continue;
    const ids = groups.get(normalizeKimiToolCallId(update.toolCallId)) ?? [];
    const status = kimiAgentStatusFromToolStatus(update.status);
    const summary = textFromToolContent(update.content);
    for (const id of ids) {
      const current = agents.get(id);
      if (!current) continue;
      agents.set(id, {
        ...current,
        status,
        progress: ["pendingInit", "running"].includes(status) ? current.progress : 100,
        summary: summary ? truncate(summary, MAX_AGENT_SUMMARY_TEXT) : current.summary,
        updated_at: normalizeTimestamp(timestamp),
      });
    }
  }
  return [...agents.values()];
}

function kimiAgentsFromToolCall(sessionId, update, timestamp) {
  const title = String(update?.title ?? "");
  if (!/^Agent(?:Swarm)?$/i.test(title)) return [];
  const input = update.rawInput && typeof update.rawInput === "object"
    ? update.rawInput
    : {};
  const isSwarm = /^AgentSwarm$/i.test(title);
  const tasks = isSwarm
    ? (Array.isArray(input.items) ? input.items : [])
    : [input.prompt || input.description || "Kimi 子 Agent"];
  const toolCallId = normalizeKimiToolCallId(update.toolCallId);
  const status = kimiAgentStatusFromToolStatus(update.status);
  return tasks.map((item, index) => {
    const task = taskTextFromKimiItem(item);
    const id = stableId("agt_kimi", sessionId, toolCallId, index);
    return {
      id,
      thread_id: sessionId,
      parent_session_id: sessionId,
      parent_thread_id: sessionId,
      name: kimiAgentTaskLabel(
        isSwarm ? task : (input.description || task),
        index,
      ),
      role: typeof input.subagent_type === "string" ? input.subagent_type : null,
      task: truncate(task, 800),
      status,
      progress: ["pendingInit", "running"].includes(status) ? 18 : 100,
      summary: null,
      model: null,
      reasoning_effort: null,
      tool: isSwarm ? "AgentSwarm" : "Agent",
      can_open: false,
      started_at: normalizeTimestamp(timestamp),
      updated_at: normalizeTimestamp(timestamp),
    };
  });
}

function kimiAgentStatusFromToolStatus(status) {
  if (status === "completed") return "completed";
  if (status === "failed") return "errored";
  return "running";
}

function normalizeKimiToolCallId(toolCallId) {
  return String(toolCallId ?? "unknown").replace(/^\d+:/, "");
}

function kimiToolGroupKey(sessionId, toolCallId) {
  return `${sessionId}\0${normalizeKimiToolCallId(toolCallId)}`;
}

function taskTextFromKimiItem(item) {
  if (typeof item === "string") return item;
  try {
    return JSON.stringify(item);
  } catch {
    return "Kimi 子 Agent";
  }
}

function kimiAgentTaskLabel(task, index = 0) {
  const text = String(task ?? "").trim();
  const chineseName = text.match(/(?:中文名|名称)\s*[=:]\s*([^|,，;；]+)/i)?.[1]?.trim();
  if (chineseName) return truncate(chineseName, 36);
  const slug = text.match(/slug\s*=\s*([^|,，;；\s]+)/i)?.[1]?.trim();
  if (slug) return truncate(slug, 36);
  const firstSegment = text.split(/[|（(\n]/, 1)[0]?.trim();
  return truncate(firstSegment || `Kimi Agent ${index + 1}`, 36);
}

function kimiAgentRoleLabel(role, task, index = 0) {
  const normalized = String(role ?? "").trim();
  if (!normalized) return kimiAgentTaskLabel(task, index);
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)} Agent`;
}

export async function readKimiAgentSnapshot({
  sessionId,
  kimiHome = process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code"),
}) {
  const sessionDir = await findKimiSessionDirectory(kimiHome, sessionId);
  if (!sessionDir) return [];
  let state;
  try {
    state = JSON.parse(await readFile(join(sessionDir, "state.json"), "utf8"));
  } catch {
    return [];
  }
  const entries = Object.entries(state?.agents ?? {}).filter(
    ([agentKey, agent]) =>
      agentKey !== "main" && agent && agent.type === "sub",
  );
  return Promise.all(
    entries.map(async ([agentKey, agent], index) => {
      const details = await readKimiAgentWire(
        join(sessionDir, "agents", agentKey, "wire.jsonl"),
      );
      const task = typeof agent.swarmItem === "string" && agent.swarmItem.trim()
        ? agent.swarmItem.trim()
        : details.task || "Kimi 子 Agent";
      const id = stableId("agt_kimi_local", sessionId, agentKey);
      return {
        id,
        thread_id: sessionId,
        parent_session_id: sessionId,
        parent_thread_id: sessionId,
        name: kimiAgentRoleLabel(details.role, task, index),
        role: details.role,
        task: truncate(task, 800),
        status: details.status,
        progress: details.progress,
        summary: details.summary,
        model: details.model,
        reasoning_effort: details.reasoningEffort,
        tool: agent.swarmItem ? "AgentSwarm" : "Agent",
        current_activity: details.currentActivity,
        tool_count: details.toolCount,
        token_count: details.tokenCount,
        context_tokens: details.contextTokens,
        permission_mode: details.permissionMode,
        swarm_mode: Boolean(agent.swarmItem) || details.swarmMode,
        activity_log: details.activityLog,
        can_open: false,
        started_at: details.startedAt ?? normalizeTimestamp(state.createdAt),
        updated_at: details.updatedAt ?? normalizeTimestamp(state.updatedAt),
      };
    }),
  );
}

export async function readKimiSessionExecutionSnapshots({
  sessionIds,
  kimiHome = process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code"),
  now = Date.now(),
  activeFreshnessMs = KIMI_ACTIVE_FRESHNESS_MS,
}) {
  const ids = new Set((sessionIds ?? []).filter(Boolean));
  const snapshots = new Map();
  if (!ids.size) return snapshots;
  const directories = await findKimiSessionDirectories(kimiHome, ids);
  await Promise.all(
    [...directories].map(async ([sessionId, sessionDir]) => {
      const details = await readKimiAgentWire(
        join(sessionDir, "agents", "main", "wire.jsonl"),
      );
      const stateUpdatedAt = await readKimiStateUpdatedAt(sessionDir);
      const mainActivityAt = latestTimestamp(details.updatedAt, stateUpdatedAt);
      const mainActivityTime = mainActivityAt
        ? Date.parse(mainActivityAt)
        : Number.NaN;
      const mainFresh =
        Number.isFinite(mainActivityTime) &&
        now - mainActivityTime <= activeFreshnessMs;
      const childActivityAt =
        details.status === "running" && !mainFresh
          ? await readFreshActiveKimiChildUpdatedAt(
              sessionDir,
              now,
              activeFreshnessMs,
            )
          : null;
      const activityAt = latestTimestamp(mainActivityAt, childActivityAt);
      const active =
        details.status === "running" &&
        Boolean(details.activeStartedAt || details.startedAt) &&
        (mainFresh || Boolean(childActivityAt));
      snapshots.set(sessionId, {
        status: active ? "active" : "idle",
        turn_status: details.status,
        fork_tail_safe: details.forkTailSafe,
        running_started_at: active
          ? details.activeStartedAt ?? details.startedAt
          : null,
        updated_at: activityAt,
        role: details.role,
        model: details.model,
        reasoning_effort: details.reasoningEffort,
        permission_mode: details.permissionMode,
        swarm_mode: details.swarmMode,
        usage:
          details.contextTokens !== null || details.tokenCount !== null
            ? {
                used: details.contextTokens ?? 0,
                size: null,
                total_tokens: details.tokenCount,
              }
            : null,
      });
    }),
  );
  return snapshots;
}

export async function readKimiDailyUsage({
  kimiHome = process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code"),
  now = Date.now(),
  days = 30,
} = {}) {
  const dayCount = Number.isSafeInteger(days) && days > 0 ? days : 30;
  const wantedDays = recentLocalDateKeys(now, dayCount);
  const firstDate = localStartOfDay(new Date(now));
  firstDate.setDate(firstDate.getDate() - (dayCount - 1));
  const firstDay = firstDate.getTime();
  const totals = new Map();
  const directories = await indexedKimiSessionDirectories(kimiHome);

  for (const sessionDir of directories.values()) {
    let agents;
    try {
      agents = await readdir(join(sessionDir, "agents"), {
        withFileTypes: true,
      });
    } catch {
      continue;
    }
    for (const agent of agents) {
      if (!agent.isDirectory()) continue;
      const path = join(sessionDir, "agents", agent.name, "wire.jsonl");
      let info;
      try {
        info = await stat(path);
      } catch {
        continue;
      }
      if (info.mtimeMs < firstDay) continue;
      let daily;
      try {
        daily = await readKimiWireDailyUsage(path, info);
      } catch {
        continue;
      }
      for (const [date, total] of daily) {
        if (!wantedDays.has(date)) continue;
        const next = safeTokenSum(totals.get(date) ?? 0, total);
        if (next !== null) totals.set(date, next);
      }
    }
  }

  return [...totals]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, total_tokens]) => ({ date, total_tokens }));
}

async function readKimiWireDailyUsage(path, info) {
  const cached = kimiUsageCache.get(path);
  if (cached?.mtimeMs === info.mtimeMs && cached?.size === info.size) {
    return cached.daily;
  }
  const daily = new Map();
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record?.type !== "usage.record" || record.usageScope !== "turn") {
        continue;
      }
      const timestamp = kimiUsageTimestamp(record);
      const total = totalKimiUsage(record.usage);
      if (timestamp === null || total === null) continue;
      const date = localDateKey(new Date(timestamp));
      const next = safeTokenSum(daily.get(date) ?? 0, total);
      if (next !== null) daily.set(date, next);
    }
  } finally {
    lines.close();
  }
  kimiUsageCache.set(path, {
    mtimeMs: info.mtimeMs,
    size: info.size,
    daily,
  });
  return daily;
}

function totalKimiUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const values = [
    usage.inputOther ?? usage.input_other,
    usage.inputCacheRead ?? usage.input_cache_read,
    usage.inputCacheCreation ?? usage.input_cache_creation,
    usage.output ?? usage.output_tokens,
  ].map(safeTokenCount);
  if (values.some((value) => value === null)) return null;
  let total = 0;
  for (const value of values) {
    total = safeTokenSum(total, value);
    if (total === null) return null;
  }
  return total;
}

function kimiUsageTimestamp(record) {
  const value = record?.time ?? record?.created_at;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recentLocalDateKeys(now, days) {
  const reference = localStartOfDay(new Date(now));
  return new Set(
    Array.from({ length: days }, (_, index) => {
      const date = new Date(reference);
      date.setDate(reference.getDate() - index);
      return localDateKey(date);
    }),
  );
}

function localStartOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function localDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function safeTokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeTokenSum(left, right) {
  const total = left + right;
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

async function readFreshActiveKimiChildUpdatedAt(
  sessionDir,
  now,
  activeFreshnessMs,
) {
  let state;
  try {
    state = JSON.parse(await readFile(join(sessionDir, "state.json"), "utf8"));
  } catch {
    return null;
  }
  const agentKeys = Object.entries(state?.agents ?? {})
    .filter(([agentKey, agent]) =>
      agentKey !== "main" && agent && agent.type === "sub"
    )
    .map(([agentKey]) => agentKey);
  const details = await Promise.all(
    agentKeys.map((agentKey) =>
      readKimiAgentWire(join(sessionDir, "agents", agentKey, "wire.jsonl")),
    ),
  );
  return latestTimestamp(
    ...details
      .filter((agent) => ["pendingInit", "running"].includes(agent.status))
      .map((agent) => agent.updatedAt)
      .filter((updatedAt) => {
        const timestamp = updatedAt ? Date.parse(updatedAt) : Number.NaN;
        return (
          Number.isFinite(timestamp) &&
          now - timestamp <= activeFreshnessMs
        );
      }),
  );
}

async function readKimiStateUpdatedAt(sessionDir) {
  try {
    const state = JSON.parse(await readFile(join(sessionDir, "state.json"), "utf8"));
    return typeof state.updatedAt === "string" && !Number.isNaN(Date.parse(state.updatedAt))
      ? new Date(state.updatedAt).toISOString()
      : null;
  } catch {
    return null;
  }
}

function latestTimestamp(...values) {
  const timestamps = values
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

async function findKimiSessionDirectories(kimiHome, sessionIds) {
  const indexed = await indexedKimiSessionDirectories(kimiHome);
  return new Map(
    [...indexed].filter(([sessionId]) => sessionIds.has(sessionId)),
  );
}

async function indexedKimiSessionDirectories(kimiHome) {
  let indexText;
  try {
    indexText = await readFile(join(kimiHome, "session_index.jsonl"), "utf8");
  } catch (error) {
    rethrowFileAccessError(error);
    return new Map();
  }
  const sessionsRoot = resolve(kimiHome, "sessions");
  const matches = new Map();
  const lines = indexText.trim().split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]);
      if (
        typeof entry.sessionId !== "string" ||
        !entry.sessionId ||
        matches.has(entry.sessionId) ||
        !isAbsolute(entry.sessionDir)
      ) {
        continue;
      }
      const candidate = resolve(entry.sessionDir);
      const relativePath = relative(sessionsRoot, candidate);
      if (
        relativePath &&
        !relativePath.startsWith("..") &&
        !isAbsolute(relativePath)
      ) {
        matches.set(entry.sessionId, candidate);
      }
    } catch {
      // Ignore partially-written or older index records.
    }
  }
  return matches;
}

async function findKimiSessionDirectory(kimiHome, sessionId) {
  const matches = await findKimiSessionDirectories(kimiHome, new Set([sessionId]));
  return matches.get(sessionId) ?? null;
}

async function readKimiAgentWire(path) {
  try {
    const info = await stat(path);
    const cached = kimiWireCache.get(path);
    if (cached?.mtimeMs === info.mtimeMs && cached?.size === info.size) {
      return cached.details;
    }
    const details = kimiAgentDetailsFromWire(await readFile(path, "utf8"));
    kimiWireCache.set(path, { mtimeMs: info.mtimeMs, size: info.size, details });
    return details;
  } catch (error) {
    rethrowFileAccessError(error);
    return {
      status: "pendingInit",
      progress: 5,
      summary: null,
      task: null,
      role: null,
      model: null,
      reasoningEffort: null,
      currentActivity: null,
      toolCount: 0,
      tokenCount: null,
      contextTokens: null,
      permissionMode: null,
      swarmMode: false,
      activityLog: [],
      startedAt: null,
      updatedAt: null,
    };
  }
}

export function kimiAgentDetailsFromWire(wireText) {
  let startedAt = null;
  let updatedAt = null;
  let task = null;
  let role = null;
  let model = null;
  let reasoningEffort = null;
  let currentActivity = null;
  let toolCount = 0;
  let tokenCount = null;
  let contextTokens = null;
  let permissionMode = null;
  let swarmMode = false;
  const activityLog = [];
  let lastTurnInputAt = 0;
  let lastCancelAt = 0;
  let lastStepBeginAt = 0;
  let lastStepEnd = null;
  let currentStepText = "";
  let completedSummary = null;
  let todos = null;
  for (const [recordIndex, line] of String(wireText ?? "").split("\n").entries()) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const time = kimiRecordTime(record);
    if (time) updatedAt = normalizeTimestamp(time);
    if (record.type === "metadata" && record.created_at) {
      startedAt = normalizeTimestamp(record.created_at);
    } else if (record.type === "config.update") {
      if (typeof record.profileName === "string") role = record.profileName;
      if (typeof record.modelAlias === "string") model = record.modelAlias;
      if (typeof record.thinkingEffort === "string") {
        reasoningEffort = record.thinkingEffort;
      }
    } else if (record.type === "turn.prompt") {
      lastTurnInputAt = Math.max(lastTurnInputAt, time);
      const prompt = (record.input ?? [])
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (prompt) task = truncate(prompt, 800);
      appendKimiAgentActivity(activityLog, {
        recordIndex,
        time,
        kind: "status",
        code: "task_received",
        label: "已接收子任务",
      });
    } else if (record.type === "turn.steer") {
      lastTurnInputAt = Math.max(lastTurnInputAt, time);
    } else if (record.type === "turn.cancel") {
      lastCancelAt = Math.max(lastCancelAt, time);
    } else if (record.type === "permission.set_mode") {
      if (typeof record.mode === "string") permissionMode = record.mode;
    } else if (record.type === "swarm_mode.enter") {
      swarmMode = true;
    } else if (record.type === "swarm_mode.exit") {
      swarmMode = false;
    } else if (record.type === "usage.record") {
      const usage = usageFromKimiWire(record.usage);
      if (usage) {
        tokenCount = usage.total;
        contextTokens = usage.input;
      }
    } else if (record.type === "tools.update_store" && record.key === "todo") {
      if (Array.isArray(record.value)) {
        todos = record.value;
        const completed = todos.filter((todo) =>
          ["done", "completed"].includes(todo?.status),
        ).length;
        appendKimiAgentActivity(activityLog, {
          recordIndex,
          time,
          kind: "progress",
          code: "plan_progress",
          label: `计划进度 ${completed}/${todos.length}`,
          completed,
          total: todos.length,
        });
      }
    }
    const event = record.event;
    if (record.type !== "context.append_loop_event" || !event) continue;
    if (event.type === "step.begin") {
      lastStepBeginAt = Math.max(lastStepBeginAt, time);
      currentStepText = "";
      appendKimiAgentActivity(activityLog, {
        recordIndex,
        time,
        kind: "status",
        code: "started",
        label: "开始处理",
      });
    } else if (event.type === "tool.call") {
      toolCount += 1;
      currentActivity = kimiToolActivity(event);
      appendKimiAgentActivity(activityLog, {
        recordIndex,
        time,
        kind: "tool",
        label: currentActivity,
      });
    } else if (
      event.type === "content.part" &&
      event.part?.type === "text" &&
      typeof event.part.text === "string"
    ) {
      currentStepText += event.part.text;
    } else if (event.type === "step.end") {
      lastStepEnd = { time, finishReason: event.finishReason };
      if (event.finishReason === "end_turn" && currentStepText.trim()) {
        completedSummary = truncate(currentStepText.trim(), MAX_AGENT_SUMMARY_TEXT);
      }
      const endActivity = kimiStepEndActivity(event.finishReason);
      appendKimiAgentActivity(activityLog, {
        recordIndex,
        time,
        kind: "status",
        ...endActivity,
      });
    }
  }

  let status = "pendingInit";
  const lastStepEndAt = lastStepEnd?.time ?? 0;
  if (lastCancelAt > Math.max(lastTurnInputAt, lastStepEndAt)) {
    status = "interrupted";
  } else if (lastStepBeginAt > lastStepEndAt || lastTurnInputAt > lastStepEndAt) {
    status = "running";
  } else if (lastStepEnd?.finishReason === "end_turn") {
    status = "completed";
  } else if (["cancelled", "interrupted"].includes(lastStepEnd?.finishReason)) {
    status = "interrupted";
  } else if (["error", "failed", "max_tokens"].includes(lastStepEnd?.finishReason)) {
    status = "errored";
  } else if (lastTurnInputAt || lastStepBeginAt || lastStepEndAt) {
    status = "running";
  }

  let progress = status === "pendingInit" ? 5 : 35;
  if (Array.isArray(todos) && todos.length) {
    const completed = todos.filter((todo) =>
      ["done", "completed"].includes(todo?.status),
    ).length;
    progress = Math.max(12, Math.min(92, Math.round((completed / todos.length) * 92)));
  }
  if (!["pendingInit", "running"].includes(status)) progress = 100;
  return {
    status,
    forkTailSafe: status === "completed" && kimiForkTailSafeFromWire(wireText),
    progress,
    summary: status === "completed" ? completedSummary : null,
    task,
    role,
    model,
    reasoningEffort,
    currentActivity,
    toolCount,
    tokenCount,
    contextTokens,
    permissionMode,
    swarmMode,
    activityLog: activityLog.slice(-MAX_AGENT_ACTIVITIES),
    startedAt,
    activeStartedAt:
      status === "running" && lastTurnInputAt
        ? normalizeTimestamp(lastTurnInputAt)
        : null,
    updatedAt,
  };
}

function appendKimiAgentActivity(
  activities,
  { recordIndex, time, kind, code, label, completed, total },
) {
  if (!time || !label) return;
  const normalizedLabel = truncate(label, 240);
  const previous = activities.at(-1);
  if (previous?.kind === kind && previous.label === normalizedLabel) return;
  activities.push({
    id: stableId("act_kimi", recordIndex, time, kind, code, normalizedLabel),
    kind,
    code,
    label: normalizedLabel,
    ...(Number.isInteger(completed) ? { completed } : {}),
    ...(Number.isInteger(total) ? { total } : {}),
    occurred_at: normalizeTimestamp(time),
  });
  if (activities.length > MAX_AGENT_ACTIVITIES) activities.shift();
}

function kimiStepEndActivity(finishReason) {
  if (finishReason === "end_turn") {
    return { code: "completed", label: "子任务处理完成" };
  }
  if (["cancelled", "interrupted"].includes(finishReason)) {
    return { code: "stopped", label: "子任务已停止" };
  }
  if (["error", "failed", "max_tokens"].includes(finishReason)) {
    return { code: "failed", label: "子任务处理失败" };
  }
  return { code: "step_completed", label: "完成一个处理步骤" };
}

function kimiRecordTime(record) {
  const value = record?.time ?? record?.created_at;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function usageFromKimiWire(usage) {
  if (!usage || typeof usage !== "object") return null;
  const inputOther = finiteNumber(usage.inputOther ?? usage.input_other);
  const cacheRead = finiteNumber(
    usage.inputCacheRead ?? usage.input_cache_read,
  );
  const cacheCreation = finiteNumber(
    usage.inputCacheCreation ?? usage.input_cache_creation,
  );
  const output = finiteNumber(usage.output ?? usage.output_tokens);
  const values = [inputOther, cacheRead, cacheCreation, output];
  if (values.every((value) => value === null)) return null;
  const input = (inputOther ?? 0) + (cacheRead ?? 0) + (cacheCreation ?? 0);
  return { input, total: input + (output ?? 0) };
}

function kimiToolActivity(event) {
  const label = [event.name, event.display, event.description]
    .find((value) => typeof value === "string" && value.trim());
  const args = event.args ?? event.arguments ?? event.input;
  let target = null;
  if (args && typeof args === "object") {
    target = ["path", "file", "command", "cmd", "query"]
      .map((key) => args[key])
      .find((value) => typeof value === "string" && value.trim());
  }
  return truncate(
    [label || "本地工具", target].filter(Boolean).join(" · "),
    240,
  );
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function normalizeUsage(update) {
  const used = finiteNumber(update?.used) ?? 0;
  const size = finiteNumber(update?.size);
  return {
    used,
    size,
    cost: normalizeUsageCost(update?.cost),
  };
}

function normalizeSessionConfigOptions(configOptions) {
  if (!Array.isArray(configOptions)) return null;
  const normalized = [];
  const seenIds = new Set();
  for (const config of configOptions) {
    if (normalized.length >= 12) break;
    const id = typeof config?.id === "string" ? config.id.trim() : "";
    const name = typeof config?.name === "string" ? config.name.trim() : "";
    if (
      !config ||
      !["select", "boolean"].includes(config.type) ||
      !/^[a-zA-Z0-9:._-]{1,64}$/.test(id) ||
      !name ||
      seenIds.has(id)
    ) {
      continue;
    }
    seenIds.add(id);
    const base = {
      type: config.type,
      id,
      name: truncate(name, 120),
      category:
        typeof config.category === "string"
          ? truncate(config.category, 64)
          : null,
      description:
        typeof config.description === "string"
          ? truncate(config.description, 300)
          : null,
    };
    if (config.type === "boolean") {
      normalized.push({
        ...base,
        currentValue:
          typeof config.currentValue === "boolean" ? config.currentValue : null,
      });
      continue;
    }
    const options = [];
    const seenValues = new Set();
    for (const option of config.options ?? []) {
      if (options.length >= 100) break;
      const value = typeof option?.value === "string" ? option.value.trim() : "";
      const optionName = typeof option?.name === "string" ? option.name.trim() : "";
      if (!value || !optionName || seenValues.has(value)) continue;
      seenValues.add(value);
      options.push({
        value: truncate(value, 120),
        name: truncate(optionName, 160),
        description:
          typeof option.description === "string"
            ? truncate(option.description, 300)
            : null,
      });
    }
    if (!options.length) continue;
    normalized.push({
      ...base,
      currentValue: options.some(
        (option) => option.value === config.currentValue,
      )
        ? config.currentValue
        : null,
      options,
    });
  }
  return normalized;
}

function normalizeAvailableCommands(commands) {
  if (!Array.isArray(commands)) return [];
  const normalized = [];
  const seenNames = new Set();
  for (const command of commands) {
    if (normalized.length >= 100) break;
    const name = typeof command?.name === "string" ? command.name.trim() : "";
    if (
      !/^[a-zA-Z0-9:_-]{1,100}$/.test(name) ||
      typeof command?.description !== "string" ||
      seenNames.has(name)
    ) {
      continue;
    }
    seenNames.add(name);
    normalized.push({
      name,
      description: truncate(command.description, 300),
      input_hint:
        typeof command.input?.hint === "string"
          ? truncate(command.input.hint, 160)
          : null,
    });
  }
  return normalized;
}

function normalizeUsageCost(cost) {
  if (!cost || typeof cost !== "object" || Array.isArray(cost)) return null;
  const amount = cost.amount;
  const currency = typeof cost.currency === "string"
    ? cost.currency.trim().toUpperCase()
    : "";
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    return null;
  }
  return { amount, currency };
}

function mergeKimiAgentSnapshots(replayAgents, localAgents) {
  const merged = [...(replayAgents ?? [])];
  const claimed = new Set();
  for (const local of localAgents ?? []) {
    const matchIndex = merged.findIndex(
      (candidate, index) => !claimed.has(index) && candidate.task === local.task,
    );
    if (matchIndex < 0) {
      merged.push(local);
      continue;
    }
    claimed.add(matchIndex);
    const replay = merged[matchIndex];
    merged[matchIndex] = {
      ...replay,
      ...local,
      id: replay.id,
      thread_id: replay.thread_id,
      parent_session_id: replay.parent_session_id,
      parent_thread_id: replay.parent_thread_id,
      tool: replay.tool,
      can_open: false,
    };
  }
  return merged.sort((left, right) => {
    const leftActive = ["pendingInit", "running"].includes(left.status) ? 1 : 0;
    const rightActive = ["pendingInit", "running"].includes(right.status) ? 1 : 0;
    if (leftActive !== rightActive) return rightActive - leftActive;
    return Date.parse(right.updated_at ?? 0) - Date.parse(left.updated_at ?? 0);
  });
}

function executionSnapshotFor(snapshots, sessionId) {
  if (snapshots instanceof Map) return snapshots.get(sessionId) ?? null;
  if (Array.isArray(snapshots)) {
    return snapshots.find((snapshot) => snapshot?.session_id === sessionId) ?? null;
  }
  return snapshots?.[sessionId] ?? null;
}

function actionFromPermission(params, fallbackWorkspace) {
  const toolCall = params.toolCall ?? {};
  const options = sanitizePermissionOptions(params.options);
  const display = truncate(
    toolDisplay(toolCall) ||
      textFromToolContent(toolCall.content) ||
      toolCall.title ||
      "Kimi Code permission request",
  );
  return {
    type: actionTypeFromToolCall(toolCall, options),
    display,
    cwd: fallbackWorkspace,
    tool_call_id: toolCall.toolCallId ?? null,
    options,
  };
}

function actionTypeFromToolCall(toolCall, options) {
  if (
    toolCall.title === "AskUserQuestion" ||
    options.some((option) =>
      /^(q\d+_|plan_)/.test(option.option_id),
    )
  ) {
    return "question.select";
  }
  if (toolCall.kind === "edit") return "file.change";
  if (toolCall.kind === "execute") return "command.execute";
  return "tool.execute";
}

function riskLevelFromToolCall(toolCall) {
  return ["edit", "execute", "delete", "move"].includes(toolCall?.kind)
    ? "high"
    : "medium";
}

function sanitizePermissionOptions(options) {
  return (options ?? [])
    .filter(
      (option) =>
        option &&
        typeof option.optionId === "string" &&
        typeof option.name === "string" &&
        typeof option.kind === "string",
    )
    .slice(0, 12)
    .map((option) => ({
      option_id: option.optionId,
      name: truncate(option.name, 200),
      kind: option.kind,
    }));
}

function selectPermissionOption(options, decision, explicitOptionId) {
  const explicit = explicitOptionId
    ? options.find((option) => option.option_id === explicitOptionId)
    : null;
  if (
    explicit &&
    ((decision === "approved" && !isRejectOption(explicit)) ||
      (decision === "rejected" && isRejectOption(explicit)))
  ) {
    return { optionId: explicit.option_id };
  }
  const selected =
    decision === "approved"
      ? options.find(
          (option) =>
            option.kind === "allow_once" && !isRejectOption(option),
        ) ?? options.find((option) => !isRejectOption(option))
      : options.find(
          (option) =>
            option.kind === "reject_once" || option.kind === "reject_always",
        );
  return selected ? { optionId: selected.option_id } : null;
}

function isRejectOption(option) {
  return String(option?.kind).startsWith("reject");
}

function toolDisplay(toolCall) {
  const rawInput = toolCall?.rawInput;
  if (rawInput && typeof rawInput === "object") {
    for (const key of ["command", "path", "query", "url"]) {
      if (typeof rawInput[key] === "string" && rawInput[key]) {
        return `${toolCall.title ?? "Kimi 工具"}: ${rawInput[key]}`;
      }
    }
    try {
      return `${toolCall.title ?? "Kimi 工具"}: ${JSON.stringify(rawInput)}`;
    } catch {
      // Fall through to the title/content surface.
    }
  }
  if (typeof rawInput === "string" && rawInput) {
    return `${toolCall.title ?? "Kimi 工具"}: ${rawInput}`;
  }
  // ACP permission requests may omit rawInput and put the command/diff only
  // in content. A generic tool title must not hide what the user is approving.
  const content = textFromToolContent(toolCall?.content);
  return content
    ? `${toolCall?.title ? `${toolCall.title}: ` : ""}${content}`
    : toolCall?.title ?? "";
}

function textFromContentBlock(content) {
  return content?.type === "text" && typeof content.text === "string"
    ? content.text
    : "";
}

function textFromToolContent(content) {
  if (!Array.isArray(content)) return "";
  return content
    .map((entry) => {
      if (entry?.type === "content") return textFromContentBlock(entry.content);
      if (entry?.type === "diff") {
        return [entry.path, entry.oldText, entry.newText].filter(Boolean).join("\n");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function paginateHistory(messages, { limit, before }) {
  const pageSize = Math.min(500, Math.max(1, Number(limit) || 100));
  let end = messages.length;
  if (before) {
    const beforeId = decodeHistoryCursor(before);
    const index = messages.findIndex((message) => message.id === beforeId);
    if (index < 0) throw new Error("History cursor is no longer valid.");
    end = index;
  }
  const start = Math.max(0, end - pageSize);
  const page = messages.slice(start, end);
  return {
    messages: page,
    next_cursor:
      start > 0 && page.length ? encodeHistoryCursor(page[0].id) : null,
    has_more: start > 0,
  };
}

function encodeHistoryCursor(beforeId) {
  return Buffer.from(
    JSON.stringify({ v: 1, before_id: beforeId }),
  ).toString("base64url");
}

function decodeHistoryCursor(cursor) {
  try {
    const decoded = JSON.parse(
      Buffer.from(String(cursor), "base64url").toString("utf8"),
    );
    if (decoded.v !== 1 || typeof decoded.before_id !== "string") {
      throw new Error();
    }
    return decoded.before_id;
  } catch {
    throw new Error("Invalid history cursor.");
  }
}

function stableId(prefix, ...parts) {
  return `${prefix}_${createHash("sha256")
    .update(parts.map(String).join("\0"))
    .digest("hex")
    .slice(0, 40)}`;
}

function normalizeTimestamp(value) {
  if (typeof value === "number") {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return new Date().toISOString();
}

function truncate(value, limit = MAX_APPROVAL_TEXT) {
  const text = String(value ?? "");
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function resolveKimiBinary(explicit) {
  if (explicit) return explicit;
  if (process.env.KIMI_BIN) return process.env.KIMI_BIN;
  const candidates = [
    ...(process.platform === "win32"
      ? [
          join(homedir(), ".kimi-code", "bin", "kimi.exe"),
          join(homedir(), ".kimi-code", "bin", "kimi.cmd"),
        ]
      : []),
    join(homedir(), ".kimi-code", "bin", "kimi"),
    "/opt/homebrew/bin/kimi",
    "/usr/local/bin/kimi",
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? "kimi";
}
