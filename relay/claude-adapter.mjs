import { withThinkingState } from "./turn-thinking.mjs";
import { serializeSessionControl, stopBeforeSending } from "./interrupt-and-send.mjs";
import { permissionOptions, readClaudePermissionModes, verifyClaudePermissionMode, samePermissionMode } from "./claude-permissions.mjs";
import { mergeClaudeQuota } from "./agent-quota.mjs";
import { isFileAccessError, rethrowFileAccessError } from "./file-access.mjs";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { agentSpawnOptions } from "./platform-process.mjs";
import { createId, hashAction } from "./protocol.mjs";
import { customSessionTitle } from "./session-titles.mjs";

const MAX_SESSIONS = 300;
const MAX_HISTORY_MESSAGES = 5_000;
const MAX_APPROVAL_TEXT = 12_000;
const MAX_AGENT_SUMMARY_TEXT = 1_200;
const APPROVAL_TIMEOUT_MS = 5 * 60_000;
const PROBE_TIMEOUT_MS = 15_000;
const USAGE_REFRESH_MS = 30_000;
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ClaudeCodeAdapter {
  constructor(options = {}) {
    this.provider = options.provider ?? "claude";
    this.providerLabel = options.providerLabel ?? "Claude Code";
    this.approvalPrefix = options.approvalPrefix ?? "apr_claude_";
    this.turnPrefix = options.turnPrefix ?? "turn_claude";
    this.sourceAgentName = options.sourceAgentName ?? "Claude 主会话";
    this.claudeBin = resolveClaudeBinary(options.claudeBin);
    this.claudeArgs = options.claudeArgs ?? [];
    this.workspace = options.workspace ?? process.cwd();
    this.claudeHome =
      options.claudeHome ??
      process.env.CLAUDE_CONFIG_DIR ??
      join(homedir(), ".claude");
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.probe = options.probe ?? probeClaudeBinary;
    this.catalogReader = options.catalogReader ?? readClaudeSessionCatalog;
    this.historyReader = options.historyReader ?? readClaudeTranscript;
    this.handlers = null;
    this.version = null;
    this.sessionMetadata = new Map();
    this.createdSessions = new Map();
    this.activeTurns = new Map();
    this.startingSessions = new Set();
    this.activeTurnStartedAt = new Map();
    this.processes = new Map();
    this.pendingApprovals = new Map();
    this.agentSnapshots = new Map();
    this.catalogLoadPromise = null;
    this.catalogFileAccessLimited = false;
    this.usageSnapshot = null;
    this.quotaWindows = [];
    this.usageLoadedAt = 0;
    this.usageRefreshMs = options.usageRefreshMs ?? USAGE_REFRESH_MS;
    this.closed = false;
    this.modelCatalogReader = options.modelCatalogReader ?? readClaudeModels;
    this.modelCatalogs = new Map();
    this.modelOverrides = new Map();
    this.permissionModesReader = options.permissionModesReader ?? readClaudePermissionModes;
    this.permissionModeVerifier = options.permissionModeVerifier ?? verifyClaudePermissionMode;
    this.permissionModes = [];
    this.observedPermissionModes = new Map();
    this.permissionModesPromise = null;
    this.configuringSessions = new Set();
  }

  async start(handlers) {
    this.handlers = withThinkingState(handlers);
    try {
      this.version = await this.probe({
        command: this.claudeBin,
        args: this.claudeArgs,
        cwd: this.workspace,
        spawnProcess: this.spawnProcess,
      });
    } catch (error) {
      throw new Error(
        `${this.providerLabel} is unavailable. Install it or set its path in Relayune${
          error?.message ? `: ${error.message}` : "."
        }`,
      );
    }
  }

  async listProjectSessions({ cwd, cursor = null }) {
    const offset = cursor === null ? 0 : Number(cursor);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid cursor");
    const catalog = await this.catalogReader({ claudeHome: this.claudeHome,
      cwd, offset, limit: 6 });
    const sessions = catalog.slice(0, 5).map(metadata => {
      this.rememberSession(metadata);
      return this.toRelaySession(this.sessionMetadata.get(metadata.sessionId));
    });
    return { sessions, next_cursor: catalog.length > 5 ? String(offset + 5) : null };
  }

  catalogWatchPaths() { return [join(this.claudeHome, 'projects')]; }

  async listSessions() {
    const catalog = await this.loadCatalog();
    const seen = new Set();
    const sessions = [];
    for (const metadata of catalog) {
      if (!metadata?.sessionId || seen.has(metadata.sessionId)) continue;
      seen.add(metadata.sessionId);
      this.rememberSession(metadata);
      this.createdSessions.delete(metadata.sessionId);
      sessions.push(
        this.toRelaySession(this.sessionMetadata.get(metadata.sessionId)),
      );
    }
    if (this.catalogFileAccessLimited) {
      for (const metadata of this.sessionMetadata.values()) {
        if (seen.has(metadata.sessionId)) continue;
        seen.add(metadata.sessionId);
        sessions.push(this.toRelaySession(metadata));
      }
    }
    for (const metadata of this.createdSessions.values()) {
      if (sessions.length >= MAX_SESSIONS || seen.has(metadata.sessionId)) continue;
      sessions.push(this.toRelaySession(metadata));
    }
    return sessions
      .sort(
        (left, right) =>
          Date.parse(right.updated_at) - Date.parse(left.updated_at),
      )
      .slice(0, MAX_SESSIONS);
  }

  async readUsage({ refresh = false } = {}) {
    if (
      this.usageSnapshot &&
      !refresh &&
      Date.now() - this.usageLoadedAt < this.usageRefreshMs
    ) {
      return { claude: { ...this.usageSnapshot, quota_windows: this.quotaWindows } };
    }
    try {
      const catalog = await this.loadCatalog();
      const daily = mergeProviderDailyUsage(
        catalog.map((metadata) => metadata.usageDaily ?? []),
      );
      this.usageSnapshot = {
        as_of: new Date().toISOString(),
        source: "local_transcripts",
        complete: false,
        daily,
      };
      this.usageLoadedAt = Date.now();
      return { claude: { ...this.usageSnapshot, quota_windows: this.quotaWindows } };
    } catch {
      return this.usageSnapshot || this.quotaWindows.length
        ? { claude: { ...(this.usageSnapshot ?? { as_of: "", daily: [] }), quota_windows: this.quotaWindows } } : {};
    }
  }

  fileAccessLimited() { return this.catalogFileAccessLimited; }

  async loadCatalog() {
    if (this.catalogLoadPromise) return this.catalogLoadPromise;
    let limited = false;
    this.catalogLoadPromise = this.catalogReader({
      claudeHome: this.claudeHome,
      workspace: this.workspace,
      limit: MAX_SESSIONS,
      onFileAccessError: () => { limited = true; },
    }).then(catalog => {
      this.catalogFileAccessLimited = limited;
      return catalog;
    });
    try {
      return await this.catalogLoadPromise;
    } finally {
      this.catalogLoadPromise = null;
    }
  }

  async createSession({ cwd, name }) {
    if (this.provider === "claude") await Promise.all([this.loadModels(cwd || this.workspace), this.loadPermissionModes()]);
    const now = new Date().toISOString();
    const metadata = {
      sessionId: randomUUID(),
      cwd: cwd || this.workspace,
      title: name || "新建远程 Claude 会话",
      updatedAt: now,
      transcriptPath: null,
      persisted: false,
      model: null,
      permissionMode: null,
    };
    this.createdSessions.set(metadata.sessionId, metadata);
    this.rememberSession(metadata);
    return {
      ...this.toRelaySession(metadata),
      sync_state: "pending",
      sync_verified_at: null,
    };
  }

  async readHistory({ sessionId, limit = 100, before = null }) {
    let metadata = await this.ensureSessionMetadata(sessionId);
    // New sessions are cached before the CLI creates their transcript. Discover
    // that file on demand instead of requiring an unrelated catalog refresh.
    if (!metadata.transcriptPath) {
      await this.listSessions();
      metadata = this.sessionMetadata.get(sessionId) ?? metadata;
    }
    if (this.provider === "claude") await Promise.all([this.loadModels(metadata.cwd), this.loadPermissionModes()]);
    if (!metadata.transcriptPath) {
      return {
        ...paginateHistory([], { limit, before }),
        agents: this.agentSnapshots.get(sessionId) ?? [],
        sessions: [this.toRelaySession(metadata)],
      };
    }
    const replay = await this.historyReader({
      sessionId,
      transcriptPath: metadata.transcriptPath,
      cwd: metadata.cwd,
    });
    const agents = mergeAgents(
      replay.agents ?? [],
      this.agentSnapshots.get(sessionId) ?? [],
    );
    this.agentSnapshots.set(sessionId, agents);
    return {
      ...paginateHistory(replay.messages ?? [], { limit, before }),
      agents,
      sessions: [this.toRelaySession(metadata)],
    };
  }

  async readAgents({ sessionId }) {
    const history = await this.readHistory({
      sessionId,
      limit: 1,
      before: null,
    });
    return history.agents ?? [];
  }

  userMessageId({ sessionId, requestId }) {
    if (!requestId) return null;
    // UUIDv5 in the URL namespace binds live events to the CLI transcript.
    const digest = createHash("sha1")
      .update(Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex"))
      .update(JSON.stringify(["relayune:user-message", this.provider, sessionId, requestId]))
      .digest();
    digest[6] = (digest[6] & 0x0f) | 0x50;
    digest[8] = (digest[8] & 0x3f) | 0x80;
    const hex = digest.subarray(0, 16).toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  submitMessage(options) {
    if (options.interruptRunning) return stopBeforeSending(this, options, () => this.submitMessageUnlocked(options));
    return this.submitMessageUnlocked(options);
  }

  async submitMessageUnlocked({
    sessionId,
    requestId,
    content,
    attachments = [],
  }) {
    if (this.activeTurns.has(sessionId) || this.startingSessions.has(sessionId) || this.configuringSessions.has(sessionId)) {
      throw new Error(
        "Claude Code is already working in this session; stop the current task before sending another message.",
      );
    }
    this.startingSessions.add(sessionId);
    let metadata;
    try {
      metadata = await this.ensureSessionMetadata(sessionId);
    } catch (error) {
      this.startingSessions.delete(sessionId);
      throw error;
    }
    if (this.closed) {
      this.startingSessions.delete(sessionId);
      throw new Error(`${this.providerLabel} adapter is closed.`);
    }
    if (!metadata.persisted && !customSessionTitle(metadata.title) && content.trim()) {
      metadata = { ...metadata, title: sessionTitleFromPrompt(content) };
      this.rememberSession(metadata);
      this.createdSessions.set(sessionId, metadata);
    }
    const inputId = this.userMessageId({ sessionId, requestId });
    const turnId = inputId ? `${this.turnPrefix}_${inputId}` : createId(this.turnPrefix);
    const startedAt = new Date().toISOString();
    this.activeTurns.set(sessionId, turnId);
    this.activeTurnStartedAt.set(sessionId, startedAt);
    let connection;
    try {
      await this.handlers.emitEvent(sessionId, {
        kind: "turn.started",
        turn_id: turnId,
        request_id: requestId,
        provider: this.provider,
      });
      connection = await this.startTurnProcess(metadata, { turnId, requestId });
      this.processes.set(sessionId, connection);
      connection.writeUserMessage(content, attachments, this.userMessageId({ sessionId, requestId }));
    } catch (error) {
      try {
        await this.handlers.emitEvent(sessionId, {
          kind: "turn.failed",
          turn_id: turnId,
          error:
            error instanceof Error
              ? error.message
              : `${this.providerLabel} could not start.`,
          provider: this.provider,
        });
      } catch {}
      this.finishTurn(sessionId);
      throw error;
    } finally {
      this.startingSessions.delete(sessionId);
    }
    return {
      mode: "started",
      turnId,
      persisted: metadata.persisted,
      syncVerifiedAt: metadata.persisted ? startedAt : null,
    };
  }

  interruptTurn(options) {
    return serializeSessionControl(this, options.sessionId, () => this.interruptTurnUnlocked(options));
  }

  async interruptTurnUnlocked({ sessionId }) {
    const turnId = this.activeTurns.get(sessionId);
    const connection = this.processes.get(sessionId);
    if (!turnId || !connection) {
      throw new Error("No active Claude Code turn to interrupt.");
    }
    const expiredApprovalIds = [];
    for (const [approvalId, pending] of this.pendingApprovals) {
      if (pending.connection !== connection) continue;
      clearTimeout(pending.timeout);
      this.pendingApprovals.delete(approvalId);
      expiredApprovalIds.push(approvalId);
    }
    await connection.interrupt();
    for (const approvalId of expiredApprovalIds) {
      await this.handlers.emitEvent(sessionId, {
        kind: "approval.resolved",
        approval_id: approvalId,
        decision: "expired",
        turn_id: turnId,
      });
    }
    await this.handlers.emitEvent(sessionId, {
      kind: "turn.completed",
      turn_id: turnId,
      status: "interrupted",
      provider: this.provider,
    });
    this.finishTurn(sessionId);
  }

  async resolveApproval({ approvalId, decision, optionId = null, answer = null }) {
    if (!["approved", "rejected"].includes(decision)) {
      throw new Error("Claude Code approval decision is invalid.");
    }
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) {
      throw new Error("Claude Code approval is no longer pending.");
    }
    if (pending.questions) {
      if (decision === "rejected") {
        clearTimeout(pending.timeout);
        this.pendingApprovals.delete(approvalId);
        pending.connection.respondToControlRequest(pending.controlRequestId, {
          behavior: "deny",
          message: "The user skipped this Claude Code question in Relayune.",
          interrupt: false,
        });
        return;
      }
      const question = pending.questions[pending.questionIndex];
      const selected = pending.options.find(
        (option) => option.option_id === optionId,
      );
      const freeform = optionId === null && typeof answer === "string" &&
        answer.length <= 4_000 && answer.trim() ? answer.trim() : null;
      if (!question || (!selected && !freeform)) {
        throw new Error("Claude Code question selection is invalid.");
      }
      clearTimeout(pending.timeout);
      this.pendingApprovals.delete(approvalId);
      pending.answers[question.question] = selected?.value ?? freeform;
      pending.questionIndex += 1;
      if (pending.questionIndex < pending.questions.length) {
        await this.requestClaudeQuestion(pending);
        return;
      }
      pending.connection.respondToControlRequest(pending.controlRequestId, {
        behavior: "allow",
        updatedInput: {
          questions: pending.questions,
          answers: pending.answers,
        },
      });
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingApprovals.delete(approvalId);
    pending.connection.respondToControlRequest(
      pending.controlRequestId,
      decision === "approved"
        ? {
            behavior: "allow",
            // Claude treats an omitted input differently from an empty object.
            // Passing the original input is safe across current and older CLIs.
            updatedInput: pending.input,
          }
        : {
            behavior: "deny",
            message: "The user rejected this operation in Relayune.",
            interrupt: false,
          },
    );
  }

  async createAgents({ sessionId, tasks }) {
    return this.submitMessage({
      sessionId,
      content: `Use Claude Code's native Task or Agent tool to run these independent tasks in parallel. Wait for every subagent, then summarize the results:\n${tasks
        .map((task, index) => `${index + 1}. ${task}`)
        .join("\n")}`,
    });
  }

  async close() {
    this.closed = true;
    for (const pending of this.pendingApprovals.values()) {
      clearTimeout(pending.timeout);
      try {
        pending.connection.respondToControlRequest(pending.controlRequestId, {
          behavior: "deny",
          message: "Relayune disconnected before the user decided.",
          interrupt: true,
        });
      } catch {}
    }
    this.pendingApprovals.clear();
    for (const connection of this.processes.values()) connection.close();
    this.processes.clear();
    this.activeTurns.clear();
    this.startingSessions.clear();
    this.activeTurnStartedAt.clear();
  }

  async startTurnProcess(metadata, { turnId, requestId }) {
    const runtime = await this.turnRuntime(metadata);
    if (this.closed) {
      throw new Error(`${this.providerLabel} adapter is closed.`);
    }
    const args = [
      ...this.claudeArgs,
      "--print",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-prompt-tool",
      "stdio",
    ];
    if (supportsForwardedSubagentText(this.version)) {
      args.push("--forward-subagent-text");
    }
    args.push(...(runtime.extraArgs ?? []));
    if (metadata.persisted || metadata.transcriptPath) {
      args.push("--resume", runtime.resumeSessionId ?? metadata.sessionId);
    } else {
      args.push("--session-id", metadata.sessionId);
      const title = customSessionTitle(metadata.title);
      if (title) args.push("--name", title);
    }
    return new ClaudeTurnConnection({
      command: this.claudeBin,
      args,
      cwd: runtime.cwd ?? metadata.cwd,
      env: runtime.env ?? process.env,
      spawnProcess: this.spawnProcess,
      sessionId: metadata.sessionId,
      wireSessionId: runtime.resumeSessionId ?? metadata.sessionId,
      turnId,
      requestId,
      onMessage: (message, connection) =>
        this.handleTurnMessage(metadata.sessionId, message, connection),
      onExit: (error, connection) =>
        this.handleTurnExit(metadata.sessionId, error, connection),
    });
  }

  async turnRuntime(metadata) {
    const override = this.modelOverrides.get(metadata.sessionId);
    if (override?.permissionMode) {
      await this.permissionModeVerifier({
        command: this.claudeBin, args: this.claudeArgs, cwd: metadata.cwd,
        claudeHome: this.claudeHome, spawnProcess: this.spawnProcess,
        mode: override.permissionMode, model: override.model,
      });
    }
    return {
      resumeSessionId: metadata.cliSessionId ?? metadata.sessionId,
      cwd: metadata.cwd,
      env: { ...process.env, CLAUDE_CONFIG_DIR: this.claudeHome },
      extraArgs: [
        ...(override?.model ? ["--model", override.model] : []),
        ...(override?.effort ? ["--effort", override.effort] : []),
        ...(override?.permissionMode ? ["--permission-mode", override.permissionMode] : []),
      ],
    };
  }

  async loadModels(cwd = this.workspace) {
    let entry = this.modelCatalogs.get(cwd);
    if (entry && Date.now() - entry.loadedAt < 60_000) return entry.promise;
    entry = { loadedAt: Date.now() };
    entry.promise = Promise.resolve().then(() => this.modelCatalogReader({
      command: this.claudeBin, args: this.claudeArgs, cwd,
      claudeHome: this.claudeHome, spawnProcess: this.spawnProcess,
    })).then((models) => {
      entry.models = models;
      return models;
    }).catch(() => {
      entry.models = [];
      return [];
    });
    this.modelCatalogs.set(cwd, entry);
    return entry.promise;
  }

  async loadPermissionModes() {
    if (!this.permissionModesPromise) {
      this.permissionModesPromise = this.permissionModesReader({
        command: this.claudeBin, args: this.claudeArgs, cwd: this.workspace,
        claudeHome: this.claudeHome, spawnProcess: this.spawnProcess,
      }).then(modes => { this.permissionModes = modes; }).catch(() => {
        this.permissionModesPromise = null;
      });
    }
    await this.permissionModesPromise;
  }

  configOptionsForSession(metadata) {
    const models = this.modelCatalogs.get(metadata.cwd)?.models ?? [];

    const override = this.modelOverrides.get(metadata.sessionId) ?? {};
    const current = override.model ?? metadata.model ?? "default";
    const selected = models.find((model) => model.value === current);
    const options = models.length ? [{
      type: "select", id: "model", name: "Model",
      currentValue: current,
      options: models.map((model) => ({
        value: model.value,
        name: models.filter((peer) => peer.displayName === model.displayName).length > 1
          ? `${model.displayName} (${model.value})` : model.displayName || model.value,
        description: model.description,
      })),
    }] : [];
    if (selected?.supportedEffortLevels?.length) options.push({
      type: "select", id: "reasoning", name: "Reasoning effort",
      currentValue: selected.supportedEffortLevels.includes(override.effort ?? metadata.effort)
        ? override.effort ?? metadata.effort : "",
      options: selected.supportedEffortLevels.map((value) => ({ value, name: value })),
    });
    const observedMode = this.observedPermissionModes.get(metadata.sessionId) ?? metadata.permissionMode;
    options.push({
      type: "select", id: "permissions", name: "审批模式", category: "permissions",
      description: `仅作用于当前会话的后续消息，Relay 重启后需重新选择。${observedMode ? `最近一次运行模式：${observedMode}。` : "实际模式将在运行后确认。"}`,
      currentValue: override.permissionMode ?? "inherit",
      options: permissionOptions(this.permissionModes),
    });
    return options;
  }

  async configureSession({ sessionId, configId, value }) {
    const assertIdle = () => {
      if (this.closed) throw new Error("Claude Code adapter is closed.");
      if (this.activeTurns.has(sessionId) || this.startingSessions.has(sessionId)) {
        throw new Error("Claude Code settings cannot change while the session is running.");
      }
    };
    assertIdle();
    if (this.configuringSessions.has(sessionId)) throw new Error("Claude Code settings are already being changed.");
    this.configuringSessions.add(sessionId);
    try {
      const metadata = await this.ensureSessionMetadata(sessionId);
      await Promise.all([this.loadModels(metadata.cwd), this.loadPermissionModes()]);
      assertIdle();
      const option = this.configOptionsForSession(metadata).find((item) => item.id === configId);
      if (typeof value !== "string" || !option?.options.some((item) => item.value === value)) {
        throw new Error("Claude Code did not advertise the selected setting.");
      }
      const next = { ...(this.modelOverrides.get(sessionId) ?? {}) };
      if (configId === "model") {
        next.model = value;
        const model = this.modelCatalogs.get(metadata.cwd).models.find((item) => item.value === value);
        if (!model.supportedEffortLevels?.includes(next.effort)) delete next.effort;
      } else if (configId === "reasoning") next.effort = value;
      else if (configId === "permissions") {
        if (value === "inherit") delete next.permissionMode;
        else next.permissionMode = value;
      }
      if (next.permissionMode) {
        await this.permissionModeVerifier({
          command: this.claudeBin, args: this.claudeArgs, cwd: metadata.cwd,
          claudeHome: this.claudeHome, spawnProcess: this.spawnProcess,
          mode: next.permissionMode, model: next.model,
        });
        assertIdle();
      }
      this.modelOverrides.set(sessionId, next);
      return { configOptions: this.configOptionsForSession(metadata) };
    } finally { this.configuringSessions.delete(sessionId); }
  }

  async handleTurnMessage(sessionId, message, connection) {
    if (this.processes.get(sessionId) !== connection || connection.interrupted) return;
    if (message?.type === "rate_limit_event") {
      this.quotaWindows = mergeClaudeQuota(this.quotaWindows, message.rate_limit_info);
      return;
    }
    if (message?.type === "system" && message.subtype === "init") {
      const requested = this.modelOverrides.get(sessionId)?.permissionMode;
      if (requested && !samePermissionMode(requested, message.permissionMode)) {
        throw new Error("Claude 未采用所选审批模式，已停止本轮；请检查本机策略或重新选择模式。");
      }
      if (message.permissionMode) this.observedPermissionModes.set(sessionId, message.permissionMode);
      this.rememberSession({
        sessionId,
        cwd: message.cwd,
        persisted: true,
        model: message.model,
        permissionMode: message.permissionMode,
        updatedAt: new Date().toISOString(),
      });
      connection.model = message.model ?? null;
      return;
    }
    if (message?.type === "system" &&
        ["task_started", "task_progress"].includes(message.subtype)) {
      connection.taskAgentIds ??= new Map();
      if (message.tool_use_id && message.task_id) {
        connection.taskAgentIds.set(message.task_id, message.tool_use_id);
      }
      const toolId = message.tool_use_id ?? connection.taskAgentIds.get(message.task_id);
      const agent = connection.agents.get(toolId);
      if (agent?.status === "running") {
        const updated = {
          ...agent,
          tool_count: message.usage?.tool_uses ?? agent.tool_count,
          token_count: message.usage?.total_tokens ?? agent.token_count,
          current_activity: message.summary ?? message.description ?? agent.current_activity,
          updated_at: new Date().toISOString(),
        };
        connection.agents.set(toolId, updated);
        await this.emitAgentEvent(sessionId, updated);
      }
      return;
    }
    if (message?.type === "system" && message.subtype === "task_notification") {
      const toolId = message.tool_use_id ?? connection.taskAgentIds?.get(message.task_id);
      const agent = connection.agents.get(toolId);
      const status = { completed: "completed", failed: "errored", stopped: "interrupted" }[message.status];
      // Background Bash tasks use the same event family; only update a known Agent.
      if (agent && status) {
        const updated = { ...agent, status, progress: 100,
          summary: typeof message.summary === "string" ? truncate(message.summary, MAX_AGENT_SUMMARY_TEXT) : agent.summary,
          tool_count: message.usage?.tool_uses ?? agent.tool_count,
          token_count: message.usage?.total_tokens ?? agent.token_count,
          updated_at: new Date().toISOString() };
        connection.agents.set(toolId, updated);
        await this.emitAgentEvent(sessionId, updated);
      }
      return;
    }
    if (message?.type === "control_request") {
      await this.handleControlRequest(sessionId, message, connection);
      return;
    }
    if (message?.type === "stream_event") {
      const event = message.event ?? {};
      if (!message.parent_tool_use_id && connection.turnId) {
        if ((event.type === "content_block_start" && event.content_block?.type === "thinking") ||
            (event.type === "content_block_delta" && event.delta?.type === "thinking_delta")) {
          connection.thinkingBlock = event.index;
          await this.handlers.emitEvent(sessionId, { kind: "turn.thinking",
            turn_id: connection.turnId, active: true, provider: this.provider });
        } else if (event.type === "content_block_stop" && connection.thinkingBlock === event.index) {
          connection.thinkingBlock = null;
          await this.handlers.emitEvent(sessionId, { kind: "turn.thinking",
            turn_id: connection.turnId, active: false, provider: this.provider });
        }
      }
      if (
        !message.parent_tool_use_id &&
        event.type === "content_block_delta" &&
        event.delta?.type === "text_delta" &&
        typeof event.delta.text === "string" &&
        event.delta.text
      ) {
        connection.partialSinceAssistant = true;
        connection.text += event.delta.text;
        await this.handlers.emitEvent(sessionId, {
          kind: "message.delta",
          turn_id: connection.turnId,
          text: event.delta.text,
          provider: this.provider,
        });
      }
      return;
    }
    if (message?.type === "assistant") {
      await this.handleAssistantMessage(sessionId, message, connection);
      return;
    }
    if (message?.type === "user") {
      await this.handleToolResults(sessionId, message, connection);
      return;
    }
    if (message?.type === "result") {
      await this.completeTurn(sessionId, message, connection);
    }
  }

  async handleAssistantMessage(sessionId, message, connection) {
    const rootMessage = !message.parent_tool_use_id;
    const blocks = Array.isArray(message.message?.content)
      ? message.message.content
      : [];
    const text = blocks
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
    if (rootMessage && text && !connection.partialSinceAssistant) {
      connection.text += text;
      await this.handlers.emitEvent(sessionId, {
        kind: "message.delta",
        turn_id: connection.turnId,
        text,
        provider: this.provider,
      });
    }
    connection.partialSinceAssistant = false;
    const child = connection.agents.get(message.parent_tool_use_id);
    if (child?.status === "running" && (text || message.message?.model)) {
      const updated = { ...child,
        model: message.message?.model ?? child.model,
        summary: text ? truncate(text, MAX_AGENT_SUMMARY_TEXT) : child.summary,
        updated_at: new Date().toISOString() };
      connection.agents.set(message.parent_tool_use_id, updated);
      await this.emitAgentEvent(sessionId, updated);
    }

    for (const block of blocks) {
      if (block?.type !== "tool_use" || !block.id) continue;
      connection.activeTools.set(block.id, {
        ...block, relayParentToolUseId: message.parent_tool_use_id ?? null,
      });
      const display = claudeToolDisplay(block.name, block.input);
      await this.handlers.emitEvent(sessionId, {
        kind: "command.started",
        turn_id: connection.turnId,
        item_id: block.id,
        command: display,
        cwd: this.sessionMetadata.get(sessionId)?.cwd ?? this.workspace,
        status: "in_progress",
        provider: this.provider,
      });
      if (message.parent_tool_use_id) {
        await this.updateAgentToolActivity(sessionId, connection,
          message.parent_tool_use_id, block.id, display, "in_progress");
      }
      if (isClaudeSubagentTool(block.name)) {
        const agent = claudeAgentFromToolUse(
          sessionId,
          block,
          connection.model,
        );
        connection.agents.set(block.id, agent);
        await this.emitAgentEvent(sessionId, agent);
      }
    }
  }

  async handleToolResults(sessionId, message, connection) {
    const blocks = Array.isArray(message.message?.content)
      ? message.message.content
      : [];
    for (const block of blocks) {
      if (block?.type !== "tool_result" || !block.tool_use_id) continue;
      const tool = connection.activeTools.get(block.tool_use_id);
      if (!tool) continue;
      connection.activeTools.delete(block.tool_use_id);
      const text = textFromClaudeContent(block.content);
      const failed = Boolean(block.is_error);
      await this.handlers.emitEvent(sessionId, {
        kind: "command.output",
        turn_id: connection.turnId,
        item_id: block.tool_use_id,
        command: claudeToolDisplay(tool.name, tool.input),
        text: text || `${tool.name} ${failed ? "failed" : "completed"}.`,
        attachments: attachmentsFromClaudeContent(block.content, sessionId, block.tool_use_id),
        status: failed ? "failed" : "completed",
        provider: this.provider,
      });
      const parentToolId = message.parent_tool_use_id ?? tool.relayParentToolUseId;
      if (parentToolId) {
        await this.updateAgentToolActivity(sessionId, connection, parentToolId,
          block.tool_use_id, claudeToolDisplay(tool.name, tool.input),
          failed ? "failed" : "completed");
      }
      const agent = connection.agents.get(block.tool_use_id);
      const backgroundLaunch = !failed && (tool.input?.run_in_background === true ||
        message.tool_use_result?.status === "async_launched");
      if (agent && !backgroundLaunch) {
        const completed = {
          ...agent,
          status: failed ? "errored" : "completed",
          progress: 100,
          summary: text ? truncate(text, MAX_AGENT_SUMMARY_TEXT) : agent.summary,
          updated_at: new Date().toISOString(),
        };
        connection.agents.set(block.tool_use_id, completed);
        await this.emitAgentEvent(sessionId, completed);
      }
    }
  }

  async updateAgentToolActivity(sessionId, connection, parentToolId, itemId, command, status) {
    const agent = connection.agents.get(parentToolId);
    if (!agent || agent.status !== "running") return;
    const now = new Date().toISOString();
    const label = truncate(command, 1000);
    const log = agent.activity_log ?? [];
    const entry = {
      id: itemId,
      kind: "command",
      label: status === "in_progress" ? label : `${label} · ${status}`,
      occurred_at: now,
    };
    const updated = {
      ...agent,
      current_activity: entry.label,
      tool_count: (agent.tool_count ?? 0) + (status === "in_progress" && !log.some((item) => item.id === itemId) ? 1 : 0),
      activity_log: [...log.filter((item) => item.id !== itemId), entry].slice(-40),
      updated_at: now,
    };
    connection.agents.set(parentToolId, updated);
    await this.emitAgentEvent(sessionId, updated);
  }

  async handleControlRequest(sessionId, message, connection) {
    const request = message.request ?? {};
    if (request.subtype !== "can_use_tool" || !message.request_id) {
      connection.respondToControlRequest(message.request_id, {
        behavior: "deny",
        message: "Relayune does not support this Claude Code control request.",
        interrupt: false,
      });
      return;
    }
    const input = request.input && typeof request.input === "object"
      ? request.input
      : {};
    const questions = normalizeClaudeQuestions(request.tool_name, input);
    if (questions.length) {
      await this.requestClaudeQuestion({
        sessionId,
        connection,
        controlRequestId: message.request_id,
        input,
        questions,
        questionIndex: 0,
        answers: {},
        turnId: connection.turnId,
      });
      return;
    }
    const action = actionFromClaudePermission(
      request.tool_name,
      input,
      this.sessionMetadata.get(sessionId)?.cwd ?? this.workspace,
      request.tool_use_id,
    );
    const approvalId = `${this.approvalPrefix}${message.request_id}`;
    const timeout = setTimeout(() => {
      const pending = this.pendingApprovals.get(approvalId);
      if (!pending) return;
      this.pendingApprovals.delete(approvalId);
      try {
        connection.respondToControlRequest(message.request_id, {
          behavior: "deny",
          message: "The Relayune approval request expired.",
          interrupt: false,
        });
      } catch {}
    }, APPROVAL_TIMEOUT_MS);
    timeout.unref?.();
    this.pendingApprovals.set(approvalId, {
      connection,
      controlRequestId: message.request_id,
      input,
      timeout,
    });
    await this.handlers.requestApproval({
      approval_id: approvalId,
      request_id: `control_${message.request_id}`,
      session_id: sessionId,
      root_session_id: sessionId,
      source_thread_id: sessionId,
      source_agent_id: null,
      source_agent_name: this.sourceAgentName,
      turn_id: connection.turnId,
      action: { ...action, command_hash: hashAction(action) },
      risk_level: riskLevelFromClaudeTool(request.tool_name),
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + APPROVAL_TIMEOUT_MS).toISOString(),
    });
  }

  async requestClaudeQuestion(pending) {
    const question = pending.questions[pending.questionIndex];
    const options = question.options.map((option, optionIndex) => ({
      option_id: `question_${pending.questionIndex}_${optionIndex}`,
      name: truncate(option.label, 200),
      kind: "allow_once",
      value: option.label,
    }));
    const action = {
      type: "question.select",
      allows_freeform: true,
      display: truncate(question.question),
      cwd:
        this.sessionMetadata.get(pending.sessionId)?.cwd ?? this.workspace,
      tool_call_id: null,
      options: options.map(({ option_id, name, kind }) => ({
        option_id,
        name,
        kind,
      })),
    };
    const approvalId = `${this.approvalPrefix}${pending.controlRequestId}_q${pending.questionIndex}`;
    const timeout = setTimeout(() => {
      const current = this.pendingApprovals.get(approvalId);
      if (!current) return;
      this.pendingApprovals.delete(approvalId);
      try {
        current.connection.respondToControlRequest(current.controlRequestId, {
          behavior: "deny",
          message: "The Relayune question expired.",
          interrupt: false,
        });
      } catch {}
    }, APPROVAL_TIMEOUT_MS);
    timeout.unref?.();
    const current = { ...pending, options, timeout };
    this.pendingApprovals.set(approvalId, current);
    await this.handlers.requestApproval({
      approval_id: approvalId,
      request_id: `control_${pending.controlRequestId}`,
      session_id: pending.sessionId,
      root_session_id: pending.sessionId,
      source_thread_id: pending.sessionId,
      source_agent_id: null,
      source_agent_name: this.sourceAgentName,
      turn_id: pending.turnId,
      action: { ...action, command_hash: hashAction(action) },
      risk_level: "medium",
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + APPROVAL_TIMEOUT_MS).toISOString(),
    });
  }

  async completeTurn(sessionId, result, connection) {
    if (this.processes.get(sessionId) !== connection) return;
    if (!connection.text && typeof result.result === "string" && result.result) {
      connection.text = result.result;
      await this.handlers.emitEvent(sessionId, {
        kind: "message.delta",
        turn_id: connection.turnId,
        text: result.result,
        provider: this.provider,
      });
    }
    if (connection.text) {
      await this.handlers.emitEvent(sessionId, {
        kind: "message.completed",
        turn_id: connection.turnId,
        text: connection.text,
        provider: this.provider,
      });
    }
    if (result.is_error || String(result.subtype ?? "").startsWith("error")) {
      await this.handlers.emitEvent(sessionId, {
        kind: "turn.failed",
        turn_id: connection.turnId,
        error: authenticationAwareClaudeError(
          new Error(
            typeof result.result === "string" && result.result
              ? result.result
              : "Claude Code could not complete this turn.",
          ),
          typeof result.error === "string" ? result.error : "",
          this.provider,
        ),
        provider: this.provider,
      });
    } else {
      await this.handlers.emitEvent(sessionId, {
        kind: "turn.completed",
        turn_id: connection.turnId,
        status: result.stop_reason ?? "completed",
        provider: this.provider,
      });
    }
    this.rememberSession({
      sessionId,
      persisted: true,
      updatedAt: new Date().toISOString(),
      model: connection.model,
    });
    connection.endInput();
    this.finishTurn(sessionId);
  }

  async emitAgentEvent(sessionId, agent) {
    const current = this.agentSnapshots.get(sessionId) ?? [];
    this.agentSnapshots.set(
      sessionId,
      mergeAgents(
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
        tool: agent.tool,
        started_at: agent.started_at,
        current_activity: agent.current_activity,
        activity_log: agent.activity_log,
        tool_count: agent.tool_count,
        token_count: agent.token_count,
        updated_at: agent.updated_at,
        can_open: false,
        terminal,
        provider: this.provider,
      },
      { agent_id: agent.id },
    );
  }

  handleTurnExit(sessionId, error, connection) {
    if (this.processes.get(sessionId) !== connection) return;
    const turnId = this.activeTurns.get(sessionId);
    if (turnId && !connection.completed && !connection.interrupted) {
      void this.handlers.emitEvent(sessionId, {
        kind: "turn.failed",
        turn_id: turnId,
        error: authenticationAwareClaudeError(error, connection.stderr, this.provider),
        provider: this.provider,
      });
    }
    this.finishTurn(sessionId);
  }

  finishTurn(sessionId) {
    this.usageLoadedAt = 0;
    const connection = this.processes.get(sessionId);
    if (connection) connection.completed = true;
    this.processes.delete(sessionId);
    this.activeTurns.delete(sessionId);
    this.activeTurnStartedAt.delete(sessionId);
    for (const [approvalId, pending] of this.pendingApprovals) {
      if (pending.connection !== connection) continue;
      clearTimeout(pending.timeout);
      this.pendingApprovals.delete(approvalId);
    }
    const metadata = this.sessionMetadata.get(sessionId);
    if (metadata) {
      this.rememberSession({
        sessionId,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  rememberSession(metadata) {
    if (!metadata?.sessionId) return;
    const current = this.sessionMetadata.get(metadata.sessionId) ?? {};
    this.sessionMetadata.set(metadata.sessionId, {
      ...current,
      ...metadata,
      cwd: metadata.cwd || current.cwd || this.workspace,
      title: metadata.title || current.title || "Claude Code 会话",
      updatedAt:
        metadata.updatedAt || current.updatedAt || new Date().toISOString(),
    });
  }

  async ensureSessionMetadata(sessionId) {
    const cached = this.sessionMetadata.get(sessionId);
    if (cached?.cwd) return cached;
    await this.listSessions();
    const loaded = this.sessionMetadata.get(sessionId);
    if (!loaded?.cwd) {
      throw new Error(`Claude Code session ${sessionId} was not found.`);
    }
    return loaded;
  }

  toRelaySession(metadata) {
    const cwd = metadata.cwd || this.workspace;
    const relayTurnActive = this.activeTurns.has(metadata.sessionId);
    return {
      id: metadata.sessionId,
      name: metadata.title || "Claude Code 会话",
      project: basename(cwd),
      branch: "—",
      cwd,
      status: relayTurnActive ? "active" : "idle",
      can_interrupt: relayTurnActive,
      running_started_at:
        this.activeTurnStartedAt.get(metadata.sessionId) ?? null,
      updated_at: normalizeTimestamp(metadata.updatedAt),
      provider: this.provider,
      supports_steering: false,
      supports_interrupt_and_send: true,
      model: this.modelOverrides.get(metadata.sessionId)?.model ?? metadata.model ?? null,
      ...(this.provider === "claude" ? {
        session_config_options: this.configOptionsForSession(metadata),
      } : {}),
      reasoning_effort: metadata.effort ?? null,
      permission_mode: this.observedPermissionModes.get(metadata.sessionId) ?? metadata.permissionMode ?? null,
    };
  }
}

// Ask the native CLI for this workspace's choices without sending a user turn.
// Only model metadata leaves this probe; initialization can also contain account data.
export function readClaudeModels({ command, args = [], cwd, claudeHome, spawnProcess = spawn }) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, [
      ...args, "--print", "--input-format", "stream-json",
      "--output-format", "stream-json", "--verbose", "--no-session-persistence",
    ], agentSpawnOptions(command, {
      cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome },
      stdio: ["pipe", "pipe", "pipe"],
    }));
    const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let settled = false;
    const finish = (error, models) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reader.close();
      child.stdin.end();
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
      killTimer.unref?.();
      child.once("exit", () => clearTimeout(killTimer));
      if (error) reject(error);
      else resolve(models);
    };
    const timer = setTimeout(() => finish(new Error("Claude model discovery timed out.")), PROBE_TIMEOUT_MS);
    child.stderr.resume();
    child.stdin.on("error", () => finish(new Error("Claude model discovery failed.")));
    child.once("error", () => finish(new Error("Claude model discovery failed.")));
    child.once("exit", () => finish(new Error("Claude model discovery exited.")));
    reader.on("line", (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.type !== "control_response" || message.response?.request_id !== "relayune_models") return;
      const raw = message.response?.response?.models;
      if (message.response.subtype !== "success" || !Array.isArray(raw)) {
        finish(new Error("Claude model discovery is unavailable."));
        return;
      }
      const seen = new Set();
      const models = raw.filter((model) => {
        if (typeof model?.value !== "string" || !model.value || seen.has(model.value)) return false;
        seen.add(model.value);
        return true;
      }).map((model) => ({
        value: model.value,
        displayName: typeof model.displayName === "string" ? model.displayName : model.value,
        description: typeof model.description === "string" ? model.description : "",
        supportedEffortLevels: model.supportsEffort === true && Array.isArray(model.supportedEffortLevels)
          ? model.supportedEffortLevels.filter((level) => typeof level === "string" && level) : [],
      }));
      finish(null, models);
    });
    child.stdin.write(`${JSON.stringify({
      type: "control_request", request_id: "relayune_models", request: { subtype: "initialize" },
    })}\n`);
  });
}

class ClaudeTurnConnection {
  constructor(options) {
    this.command = options.command;
    this.args = options.args;
    this.cwd = options.cwd;
    this.env = options.env;
    this.spawnProcess = options.spawnProcess;
    this.sessionId = options.sessionId;
    this.wireSessionId = options.wireSessionId ?? options.sessionId;
    this.turnId = options.turnId;
    this.requestId = options.requestId;
    this.onMessage = options.onMessage;
    this.onExit = options.onExit;
    this.text = "";
    this.stderr = "";
    this.model = null;
    this.partialSinceAssistant = false;
    this.activeTools = new Map();
    this.agents = new Map();
    this.completed = false;
    this.interrupted = false;
    this.closed = false;
    this.incomingQueue = Promise.resolve();

    this.child = this.spawnProcess(
      this.command,
      this.args,
      agentSpawnOptions(this.command, {
        cwd: this.cwd,
        env: this.env,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
    this.exitPromise = new Promise(resolve => this.child.once("exit", resolve));
    this.readline = createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });
    this.readline.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      this.incomingQueue = this.incomingQueue
        .then(() => this.onMessage(message, this))
        .catch((error) => this.fail(error));
    });
    this.child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-8_192);
    });
    this.child.once("error", (error) => this.fail(error));
    this.child.once("exit", (code, signal) => {
      if (this.closed || this.completed || this.interrupted) return;
      this.fail(
        new Error(`claude exited with ${signal ?? code ?? 1}.`),
      );
    });
  }

  writeUserMessage(content, attachments, messageId) {
    const blocks = [
      ...(content ? [{ type: "text", text: content }] : []),
      ...attachments.map((attachment) => ({
        type: "image",
        source: {
          type: "base64",
          media_type: attachment.mime_type,
          data: attachment.base64,
        },
      })),
    ];
    this.write({
      type: "user",
      ...(messageId ? { uuid: messageId } : {}),
      message: { role: "user", content: blocks },
      parent_tool_use_id: null,
      session_id: this.wireSessionId,
    });
  }

  respondToControlRequest(requestId, response) {
    if (!requestId) return;
    this.write({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response,
      },
    });
  }

  write(message) {
    if (!this.child?.stdin?.writable) {
      throw new Error("Claude Code input stream is not writable.");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  endInput() {
    if (this.child?.stdin?.writable) this.child.stdin.end();
  }

  async interrupt() {
    this.interrupted = true;
    this.child?.kill("SIGINT");
    let timer;
    const escalation = setTimeout(() => this.child?.kill("SIGTERM"), 2_000);
    try {
      await Promise.race([
        this.exitPromise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Claude Code stop was not confirmed.")), 8_000);
        }),
      ]);
    } finally { clearTimeout(timer); clearTimeout(escalation); }
  }

  close() {
    this.closed = true;
    this.endInput();
    this.child?.kill("SIGTERM");
  }

  fail(error) {
    if (this.closed || this.completed || this.interrupted) return;
    this.closed = true;
    this.readline?.close();
    this.endInput();
    this.child?.kill("SIGTERM");
    this.onExit(error, this);
  }
}

export async function readClaudeSessionCatalog({
  claudeHome = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
  limit = MAX_SESSIONS,
  cwd = null,
  offset = 0,
  onFileAccessError = rethrowFileAccessError,
} = {}) {
  const projectsRoot = join(claudeHome, "projects");
  let projectDirectories;
  try {
    projectDirectories = await readdir(projectsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const project of projectDirectories) {
    if (!project.isDirectory()) continue;
    const directory = join(projectsRoot, project.name);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isFileAccessError(error)) onFileAccessError(error);
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const sessionId = entry.name.slice(0, -6);
      if (!SESSION_ID_PATTERN.test(sessionId)) continue;
      const transcriptPath = join(directory, entry.name);
      try {
        const info = await stat(transcriptPath);
        files.push({ sessionId, transcriptPath, info });
      } catch (error) {
        if (isFileAccessError(error)) onFileAccessError(error);
      }
    }
  }
  files.sort((left, right) => right.info.mtimeMs - left.info.mtimeMs);
  const sessions = [];
  for (const file of (cwd ? files : files.slice(0, Math.max(limit * 2, limit)))) {
    try {
      const metadata = await readClaudeTranscriptMetadata(file);
      if (metadata?.cwd && (!cwd || metadata.cwd === cwd)) sessions.push(metadata);
      if (sessions.length >= offset + limit) break;
    } catch (error) {
      if (isFileAccessError(error)) onFileAccessError(error);
      // A partially written or future transcript must not hide other sessions.
    }
  }
  return sessions.slice(offset, offset + limit);
}

async function readClaudeTranscriptMetadata({
  sessionId,
  transcriptPath,
  info,
}) {
  const text = await readFile(transcriptPath, "utf8");
  let cwd = "";
  let title = "";
  let summary = "";
  let firstPrompt = "";
  let updatedAt = info.mtime.toISOString();
  let model = null;
  let permissionMode = null;
  const usageByMessage = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    cwd ||= typeof record.cwd === "string" ? record.cwd : "";
    const timestamp = record.timestamp ?? record.created_at;
    if (timestamp && !Number.isNaN(Date.parse(timestamp))) {
      updatedAt = new Date(timestamp).toISOString();
    }
    if (record.type === "custom-title" || record.type === "summary") {
      const candidate = customSessionTitle(
        record.customTitle ?? record.title ?? record.summary ?? "",
      );
      if (candidate && record.type === "custom-title") title = candidate;
      if (candidate && record.type === "summary") summary = candidate;
    }
    if (record.type === "system" && record.subtype === "init") {
      model ||= record.model ?? null;
      permissionMode ||= record.permissionMode ?? null;
    }
    if (record.type === "assistant") {
      model ||= record.message?.model ?? null;
      collectClaudeMessageUsage(usageByMessage, record);
    }
    if (!firstPrompt && record.type === "user" && !record.parent_tool_use_id) {
      firstPrompt = textFromClaudeContent(record.message?.content).trim();
    }
  }
  await collectClaudeSubagentUsage({
    directory: join(dirname(transcriptPath), sessionId, "subagents"),
    usageByMessage,
  });
  return {
    sessionId,
    cwd,
    title: title || summary || sessionTitleFromPrompt(firstPrompt),
    updatedAt,
    transcriptPath,
    persisted: true,
    model,
    permissionMode,
    usageDaily: claudeUsageDaily(usageByMessage),
  };
}

async function collectClaudeSubagentUsage({ directory, usageByMessage }) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const input = createReadStream(join(directory, entry.name), {
      encoding: "utf8",
    });
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
        if (record?.type === "assistant") {
          collectClaudeMessageUsage(usageByMessage, record);
        }
      }
    } catch {
      // A partially written subagent transcript must not hide root usage.
    } finally {
      lines.close();
    }
  }
}

function collectClaudeMessageUsage(usageByMessage, record) {
  const messageId =
    typeof record?.message?.id === "string" ? record.message.id.trim() : "";
  if (!messageId) return;
  const timestamp = Date.parse(record.timestamp ?? record.created_at ?? "");
  if (!Number.isFinite(timestamp)) return;
  const usage = normalizeClaudeTokenUsage(record.message?.usage);
  if (!usage) return;
  const current = usageByMessage.get(messageId);
  if (!current) {
    usageByMessage.set(messageId, { ...usage, timestamp });
    return;
  }
  usageByMessage.set(messageId, {
    input: Math.max(current.input, usage.input),
    cacheCreation: Math.max(current.cacheCreation, usage.cacheCreation),
    cacheRead: Math.max(current.cacheRead, usage.cacheRead),
    output: Math.max(current.output, usage.output),
    timestamp: Math.min(current.timestamp, timestamp),
  });
}

function normalizeClaudeTokenUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const fields = [
    ["input", usage.input_tokens],
    ["cacheCreation", usage.cache_creation_input_tokens],
    ["cacheRead", usage.cache_read_input_tokens],
    ["output", usage.output_tokens],
  ];
  if (fields.every(([, value]) => value === undefined || value === null)) {
    return null;
  }
  const normalized = {};
  for (const [name, value] of fields) {
    if (value === undefined || value === null) {
      normalized[name] = 0;
      continue;
    }
    if (!Number.isSafeInteger(value) || value < 0) return null;
    normalized[name] = value;
  }
  return normalized;
}

function claudeUsageDaily(usageByMessage) {
  const totals = new Map();
  for (const usage of usageByMessage.values()) {
    let total = 0;
    for (const value of [
      usage.input,
      usage.cacheCreation,
      usage.cacheRead,
      usage.output,
    ]) {
      total = safeClaudeTokenSum(total, value);
      if (total === null) break;
    }
    if (total === null) continue;
    const date = localClaudeDateKey(new Date(usage.timestamp));
    const next = safeClaudeTokenSum(totals.get(date) ?? 0, total);
    if (next !== null) totals.set(date, next);
  }
  return [...totals]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, total_tokens]) => ({ date, total_tokens }));
}

function mergeProviderDailyUsage(groups) {
  const totals = new Map();
  for (const daily of groups) {
    for (const bucket of daily) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(bucket?.date) ||
        !Number.isSafeInteger(bucket?.total_tokens) ||
        bucket.total_tokens < 0
      ) {
        continue;
      }
      const next = safeClaudeTokenSum(
        totals.get(bucket.date) ?? 0,
        bucket.total_tokens,
      );
      if (next !== null) totals.set(bucket.date, next);
    }
  }
  return [...totals]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, total_tokens]) => ({ date, total_tokens }));
}

function localClaudeDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function safeClaudeTokenSum(left, right) {
  const total = left + right;
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

export async function readClaudeTranscript({ sessionId, transcriptPath }) {
  const messages = [];
  const agents = new Map();
  const backgroundTools = new Set();
  const input = createReadStream(transcriptPath, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let index = 0;
  let currentTurnId = null;
  const transcriptTurns = new Map();
  for await (const line of lines) {
    index += 1;
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const timestamp = normalizeTimestamp(
      record.timestamp ?? record.created_at ?? Date.now(),
    );
    const attachment = record.type === "attachment" ? record.attachment : null;
    if (attachment?.type === "queued_command" &&
        attachment.commandMode === "task-notification" &&
        typeof attachment.prompt === "string") {
      // Only native task-notification attachments may update an existing child.
      // Do not interpret assistant prose or follow paths from the notification.
      const field = (name) => attachment.prompt.match(
        new RegExp(`<${name}>([\\s\\S]*?)</${name}>`),
      )?.[1]?.trim();
      const toolId = field("tool-use-id");
      const agent = agents.get(toolId);
      const status = { completed: "completed", failed: "errored", stopped: "interrupted" }[field("status")];
      if (agent && status) {
        agents.set(toolId, { ...agent, status, progress: 100,
          summary: truncate(field("result") || field("summary") || agent.summary || "", MAX_AGENT_SUMMARY_TEXT),
          updated_at: timestamp });
      }
    }
    if (
      ["user", "assistant"].includes(record.type) &&
      !record.parent_tool_use_id &&
      !record.isSidechain
    ) {
      const content = textFromClaudeContent(record.message?.content);
      const attachments = attachmentsFromClaudeContent(
        record.message?.content,
        sessionId,
        index,
      );
      const hasToolResult = claudeContentBlocks(record.message?.content).some(
        (block) => block?.type === "tool_result",
      );
      if (record.type === "user" && !hasToolResult && record.uuid &&
          (content || attachments.length)) {
        currentTurnId = `turn_claude_${record.uuid}`;
      } else if (record.parentUuid && transcriptTurns.has(record.parentUuid)) {
        currentTurnId = transcriptTurns.get(record.parentUuid);
      }
      if (record.uuid && currentTurnId) transcriptTurns.set(record.uuid, currentTurnId);
      if ((content || attachments.length) && !hasToolResult) {
        messages.push({
          id:
            record.uuid ||
            stableId("msg_claude_history", sessionId, index, timestamp),
          role: record.type === "user" ? "user" : "codex",
          content,
          created_at: timestamp,
          turn_id:
            currentTurnId || record.parentUuid ||
            stableId("turn_claude_history", sessionId, index),
          provider: "claude",
          attachments,
        });
      }
    }
    if (record.type === "assistant") {
      for (const block of claudeContentBlocks(record.message?.content)) {
        if (block?.type !== "tool_use" || !block.id) continue;
        if (isClaudeSubagentTool(block.name)) {
          if (block.input?.run_in_background === true) backgroundTools.add(block.id);
          agents.set(
            block.id,
            claudeAgentFromToolUse(sessionId, block, record.message?.model, timestamp),
          );
        }
      }
    }
    if (record.type === "user") {
      for (const block of claudeContentBlocks(record.message?.content)) {
        if (block?.type !== "tool_result" || !block.tool_use_id) continue;
        const toolAttachments = attachmentsFromClaudeContent(block.content, sessionId, block.tool_use_id);
        if (toolAttachments.length && !record.parent_tool_use_id && !record.isSidechain) {
          messages.push({
            id: `command_${currentTurnId}_${block.tool_use_id}`,
            role: "codex", content: textFromClaudeContent(block.content),
            created_at: timestamp, turn_id: currentTurnId,
            provider: "claude", kind: "command.output",
            attachments: toolAttachments,
          });
        }
        const agent = agents.get(block.tool_use_id);
        if (!agent) continue;
        const backgroundLaunch = !block.is_error && (
          backgroundTools.has(block.tool_use_id) ||
          record.toolUseResult?.status === "async_launched" ||
          record.tool_use_result?.status === "async_launched"
        );
        if (backgroundLaunch) continue;
        agents.set(block.tool_use_id, {
          ...agent,
          status: block.is_error ? "errored" : "completed",
          progress: 100,
          summary: truncate(
            textFromClaudeContent(block.content),
            MAX_AGENT_SUMMARY_TEXT,
          ),
          updated_at: timestamp,
        });
      }
    }
  }
  return {
    messages: messages.slice(-MAX_HISTORY_MESSAGES),
    agents: [...agents.values()],
  };
}

async function probeClaudeBinary({
  command,
  args,
  cwd,
  spawnProcess = spawn,
}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let output = "";
    const child = spawnProcess(
      command,
      [...args, "--version"],
      agentSpawnOptions(command, {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error("version check timed out"));
    }, PROBE_TIMEOUT_MS);
    timer.unref?.();
    child.stdout.on("data", (chunk) => {
      output = `${output}${String(chunk)}`.slice(-1_024);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(output.trim() || "unknown");
      else reject(new Error(`version check exited with ${code ?? 1}`));
    });
  });
}

function supportsForwardedSubagentText(version) {
  const match = String(version ?? "").match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number);
  return (
    major > 2 ||
    (major === 2 && (minor > 1 || (minor === 1 && patch >= 211)))
  );
}

function actionFromClaudePermission(toolName, input, cwd, toolUseId) {
  return {
    type: actionTypeFromClaudeTool(toolName),
    display: truncate(claudeToolDisplay(toolName, input)),
    cwd,
    tool_call_id: toolUseId ?? null,
  };
}

function normalizeClaudeQuestions(toolName, input) {
  if (toolName !== "AskUserQuestion" || !Array.isArray(input?.questions)) {
    return [];
  }
  return input.questions
    .filter(
      (question) =>
        question &&
        typeof question.question === "string" &&
        question.question.trim() &&
        Array.isArray(question.options),
    )
    .slice(0, 4)
    .map((question) => ({
      question: truncate(question.question, 1_000),
      header: truncate(question.header ?? "Question", 100),
      multiSelect: Boolean(question.multiSelect),
      options: question.options
        .filter(
          (option) =>
            option &&
            typeof option.label === "string" &&
            option.label.trim(),
        )
        .slice(0, 4)
        .map((option) => ({
          label: truncate(option.label, 200),
          description: truncate(option.description ?? "", 500),
        })),
    }))
    .filter((question) => question.options.length);
}

function actionTypeFromClaudeTool(toolName) {
  if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(toolName)) {
    return "file.change";
  }
  if (["Bash", "PowerShell", "KillShell"].includes(toolName)) {
    return "command.execute";
  }
  if (toolName === "AskUserQuestion") return "question.select";
  return "tool.execute";
}

function riskLevelFromClaudeTool(toolName) {
  return [
    "Bash",
    "PowerShell",
    "KillShell",
    "Write",
    "Edit",
    "MultiEdit",
    "NotebookEdit",
    "ExitPlanMode",
  ].includes(toolName)
    ? "high"
    : "medium";
}

function claudeToolDisplay(toolName, input) {
  const value = input && typeof input === "object" ? input : {};
  const detail = [
    value.command,
    value.file_path,
    value.path,
    value.query,
    value.url,
    value.description,
    value.prompt,
  ].find((candidate) => typeof candidate === "string" && candidate.trim());
  if (detail) return `${toolName}: ${detail}`;
  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized !== "{}"
      ? `${toolName}: ${serialized}`
      : toolName || "Claude Code tool";
  } catch {
    return toolName || "Claude Code tool";
  }
}

function claudeAgentFromToolUse(
  sessionId,
  block,
  model,
  timestamp = new Date().toISOString(),
) {
  const task = String(
    block.input?.prompt ?? block.input?.description ?? "Claude 子 Agent",
  ).trim();
  const role =
    typeof block.input?.subagent_type === "string"
      ? block.input.subagent_type
      : null;
  return {
    id: stableId("agt_claude", sessionId, block.id),
    thread_id: stableId("thr_claude", sessionId, block.id),
    parent_session_id: sessionId,
    parent_thread_id: sessionId,
    name: truncate(
      String(block.input?.description ?? role ?? task.split(/\r?\n/)[0]),
      48,
    ),
    role,
    task,
    status: "running",
    progress: 10,
    summary: null,
    model: block.input?.model ?? null,
    reasoning_effort: null,
    tool: block.name,
    started_at: normalizeTimestamp(timestamp),
    updated_at: normalizeTimestamp(timestamp),
    can_open: false,
  };
}

function mergeAgents(historyAgents, liveAgents) {
  const merged = new Map();
  for (const agent of [...(historyAgents ?? []), ...(liveAgents ?? [])]) {
    const current = merged.get(agent.id);
    if (!current || Date.parse(agent.updated_at) >= Date.parse(current.updated_at)) {
      merged.set(agent.id, { ...current, ...agent });
    }
  }
  return [...merged.values()].sort(
    (left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at),
  );
}

function claudeContentBlocks(content) {
  if (Array.isArray(content)) return content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return [];
}

function textFromClaudeContent(content) {
  if (typeof content === "string") return content;
  return claudeContentBlocks(content)
    .map((block) => {
      if (block?.type === "text" && typeof block.text === "string") {
        return block.text;
      }
      if (block?.type === "tool_result") {
        return textFromClaudeContent(block.content);
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function attachmentsFromClaudeContent(content, sessionId, recordIndex) {
  return claudeContentBlocks(content)
    .map((block, index) => {
      if (
        block?.type !== "image" ||
        block.source?.type !== "base64" ||
        typeof block.source.data !== "string" ||
        !block.source.data
      ) {
        return null;
      }
      const mimeType = block.source.media_type || "image/png";
      return {
        id: stableId("att_claude", sessionId, recordIndex, index),
        type: "image",
        name: `Claude image ${index + 1}`,
        mime_type: mimeType,
        detail: "auto",
        relay_source: {
          type: "data_url",
          url: `data:${mimeType};base64,${block.source.data}`,
        },
      };
    })
    .filter(Boolean);
}

function sessionTitleFromPrompt(prompt) {
  const first = String(prompt ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return truncate(first || "Claude Code 会话", 80);
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
    return new Date(value > 10_000_000_000 ? value : value * 1_000).toISOString();
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

function authenticationAwareClaudeError(error, stderr, provider = "claude") {
  const detail = `${error?.message ?? ""}\n${stderr ?? ""}`;
  if (/login|auth(?:entication)?|oauth|api key|not logged/i.test(detail)) {
    if (provider === "claude-cowork") {
      return "Claude Cowork authorization is required. Keep Claude Desktop open and signed in, then retry.";
    }
    return "Claude Code authentication is required. Open Claude Code locally, run `/login`, then restart Relayune.";
  }
  return error instanceof Error
    ? error.message
    : "Claude Code turn failed.";
}

function isClaudeSubagentTool(toolName) {
  return toolName === "Agent" || toolName === "Task";
}

function resolveClaudeBinary(explicit) {
  if (explicit) return explicit;
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const candidates = [
    ...(process.platform === "win32"
      ? [
          join(homedir(), ".local", "bin", "claude.exe"),
          join(homedir(), ".local", "bin", "claude.cmd"),
        ]
      : []),
    join(homedir(), ".local", "bin", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? "claude";
}
