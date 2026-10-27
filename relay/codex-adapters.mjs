import { withThinkingState } from "./turn-thinking.mjs";
import { CodexAsyncQuestions, trackRolloutQuestions, parseAsyncAnswers } from './codex-async-questions.mjs';
import { canContinueCodexTurn } from './codex-continuation.mjs';
import { resumePermissionsFromRollout } from "./codex-resume-permissions.mjs";
import { findReplacementRollout, isMissingRolloutError } from './codex-rollout-path.mjs';
import { CodexQueueTracker } from "./codex-queue-tracker.mjs";
import { CodexRolloutHistoryIndex, rolloutDataUrlSources } from './codex-rollout-history-index.mjs';
import { normalizeCodexQuota } from "./agent-quota.mjs";
import { createDesktopStatePool, desktopStartMessage, desktopInterruptTurn, desktopSubmitMessage, desktopPermissions, desktopRuntime, desktopAnswerQuestion, desktopPendingApprovals, desktopResolveApproval, pickPermissions } from './codex-desktop-settings.mjs';
import { permissionConfig, permissionSettings, permissionMode, CODEX_PERMISSION_MODES } from './codex-permissions.mjs';
import { isFileAccessError, rethrowFileAccessError } from "./file-access.mjs";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, createReadStream, existsSync } from "node:fs";
import { mkdtemp, open, readFile, readdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { promisify } from "node:util";
import { extname, isAbsolute, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import { StringDecoder } from "node:string_decoder";
import { setTimeout as delay } from "node:timers/promises";
import { agentSpawnOptions } from "./platform-process.mjs";
import { createId, hashAction } from "./protocol.mjs";
import { customSessionTitle } from "./session-titles.mjs";

const MAX_EXTERNAL_ROLLOUTS = 16;
const MAX_EXTERNAL_ROLLOUT_CURSORS = 80;
const MAX_ROLLOUT_READ_BYTES = 1024 * 1024;
const INITIAL_ROLLOUT_TAIL_BYTES = 512 * 1024;
const INITIAL_ATTACHMENT_RECOVERY_BYTES = 32 * 1024 * 1024;
const ATTACHMENT_RECOVERY_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_HISTORY_TOOL_ACTIVITIES = 32;
const CODEX_HISTORY_READ_ATTEMPTS = 3;
const CODEX_HISTORY_RETRY_DELAY_MS = 150;
const CODEX_HISTORY_RPC_TIMEOUT_MS = 8_000;
const CODEX_NATIVE_HISTORY_BUDGET_MS = 15_000;
const CODEX_MODEL_CATALOG_REFRESH_MS = 60_000;
const CODEX_USAGE_REFRESH_MS = 30_000;
const CODEX_INDEPENDENT_USAGE_TIMEOUT_MS = 10_000;
const CODEX_USAGE_FAILURE_RETRY_MS = 30_000;
const MAX_CODEX_PROJECTS = 500;
const MAX_HISTORY_IMAGE_DATA_URL_LENGTH = 28 * 1024 * 1024;

export class MockCodexAdapter {
  constructor(options = {}) {
    this.workspace = options.workspace ?? process.cwd();
    this.handlers = null;
    this.pendingApprovals = new Map();
    this.activeTurns = new Map();
    this.interruptedTurns = new Set();
    this.mockAgents = [];
    this.mockAgentSessions = [];
    this.mockSessions = [
      {
        id: "ses_codex_remote",
        name: "Codex Relay 技术验证",
        project: "codex-remote",
        branch: "main",
        cwd: this.workspace,
        status: "idle",
        updated_at: new Date().toISOString(),
      },
    ];
    this.historyMessages = options.historyMessages ?? [
      {
        id: "mock_history_user_1",
        role: "user",
        content: "验证 Codex Relay 的本地链路。",
        created_at: new Date(Date.now() - 120_000).toISOString(),
        turn_id: "mock_history_turn_1",
      },
      {
        id: "mock_history_codex_1",
        role: "codex",
        content: "本地 Relay 已连接，可以继续发送任务。",
        created_at: new Date(Date.now() - 118_000).toISOString(),
        turn_id: "mock_history_turn_1",
      },
    ];
  }

  async start(handlers) {
    this.handlers = withThinkingState(handlers);
  }

  async listSessions() {
    return this.mockSessions;
  }

  async readUsage() {
    return {};
  }

  async createSession({ cwd, name }) {
    const sessionCwd = cwd || this.workspace;
    const session = {
      id: createId("ses"),
      name: name || "新建远程会话",
      project: sessionCwd.split("/").filter(Boolean).at(-1) || "project",
      branch: null,
      cwd: sessionCwd,
      status: "idle",
      updated_at: new Date().toISOString(),
    };
    this.mockSessions.unshift(session);
    return session;
  }

  async readHistory({ limit = 100, before = null }) {
    return {
      ...paginateHistory(this.historyMessages, { limit, before }),
      agents: this.mockAgents,
      sessions: this.mockAgentSessions,
    };
  }

  async submitMessage({ sessionId, requestId, content, attachments = [] }) {
    const activeTurnId = this.activeTurns.get(sessionId);
    if (activeTurnId) {
      await this.handlers.emitEvent(sessionId, {
        kind: "turn.steered",
        turn_id: activeTurnId,
        request_id: requestId,
        text: content,
        attachments: attachmentMetadata(attachments),
      });
      return { mode: "steered", turnId: activeTurnId };
    }
    const turnId = createId("turn");
    this.activeTurns.set(sessionId, turnId);
    await this.handlers.emitEvent(sessionId, {
      kind: "turn.started",
      turn_id: turnId,
      request_id: requestId,
    });

    if (requiresApproval(content)) {
      const action = {
        type: "command.execute",
        display: commandFor(content),
        cwd: this.workspace,
      };
      const approvalId = createId("apr");
      const approval = {
        approval_id: approvalId,
        request_id: requestId,
        session_id: sessionId,
        turn_id: turnId,
        action: { ...action, command_hash: hashAction(action) },
      };
      this.pendingApprovals.set(approvalId, approval);
      await this.handlers.emitEvent(sessionId, {
        kind: "command.started",
        turn_id: turnId,
        command: action.display,
        cwd: action.cwd,
      });
      await this.handlers.requestApproval({
        ...approval,
        risk_level: "high",
        requested_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 2 * 60_000).toISOString(),
      });
      return;
    }

    const chunks = [
      "已通过 Server → 本机 Relay → Codex 适配器收到指令。",
      " 事件正以单调序号回传，并由浏览器通过 SSE 增量恢复。",
      " 本次本地链路验证完成。",
    ];
    let text = "";
    for (const chunk of chunks) {
      await delay(45);
      if (this.interruptedTurns.delete(turnId)) {
        this.activeTurns.delete(sessionId);
        await this.handlers.emitEvent(sessionId, {
          kind: "turn.completed",
          turn_id: turnId,
          status: "interrupted",
        });
        return;
      }
      text += chunk;
      await this.handlers.emitEvent(sessionId, {
        kind: "message.delta",
        turn_id: turnId,
        text: chunk,
      });
    }
    await this.handlers.emitEvent(sessionId, {
      kind: "message.completed",
      turn_id: turnId,
      text,
    });
    await this.handlers.emitEvent(sessionId, {
      kind: "turn.completed",
      turn_id: turnId,
      status: "completed",
    });
    this.activeTurns.delete(sessionId);
  }

  async interruptTurn({ sessionId }) {
    const turnId = this.activeTurns.get(sessionId);
    if (!turnId) throw new Error("No active turn to interrupt.");
    this.interruptedTurns.add(turnId);
  }

  async resolveApproval({ approvalId, decision }) {
    const approval = this.pendingApprovals.get(approvalId);
    if (!approval)
      throw new Error("Local Codex approval is no longer pending.");
    this.pendingApprovals.delete(approvalId);
    const accepted = decision === "approved";
    await this.handlers.emitEvent(approval.session_id, {
      kind: "command.output",
      turn_id: approval.turn_id,
      text: accepted
        ? "审批签名与命令摘要验证通过；模拟命令安全完成。"
        : "用户拒绝了该命令；未执行任何操作。",
    });
    await this.handlers.emitEvent(approval.session_id, {
      kind: "message.completed",
      turn_id: approval.turn_id,
      text: accepted
        ? `已批准并完成：${approval.action.display}`
        : `已拒绝：${approval.action.display}`,
    });
    await this.handlers.emitEvent(approval.session_id, {
      kind: "turn.completed",
      turn_id: approval.turn_id,
      status: accepted ? "completed" : "declined",
    });
    this.activeTurns.delete(approval.session_id);
  }

  async createAgents({ sessionId, tasks }) {
    const names = ["Explorer", "Builder", "Reviewer", "Verifier"];
    await Promise.all(
      tasks.map(async (task, index) => {
        const agentId = createId("agt");
        const name = names[index] ?? `Agent ${index + 1}`;
        const agentSession = {
          id: agentId,
          name,
          project: basename(this.workspace),
          branch: "main",
          cwd: this.workspace,
          status: "active",
          updated_at: new Date().toISOString(),
          is_subagent: true,
          parent_thread_id: sessionId,
          root_session_id: sessionId,
          agent_role: index === 0 ? "explorer" : "worker",
        };
        const agent = {
          id: agentId,
          thread_id: agentId,
          parent_session_id: sessionId,
          parent_thread_id: sessionId,
          name,
          role: agentSession.agent_role,
          task,
          status: "running",
          progress: 10,
          summary: null,
          model: "mock-codex",
          reasoning_effort: "medium",
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        this.mockAgentSessions.push(agentSession);
        this.mockAgents.push(agent);
        await this.handlers.emitEvent(
          sessionId,
          {
            kind: "agent.started",
            thread_id: agentId,
            parent_thread_id: sessionId,
            root_session_id: sessionId,
            name,
            role: agent.role,
            task,
            agent_status: "running",
            progress: 10,
            model: agent.model,
            reasoning_effort: agent.reasoning_effort,
            cwd: this.workspace,
            project: basename(this.workspace),
            branch: "main",
          },
          { agent_id: agentId },
        );
        for (const progress of [35, 72, 100]) {
          await delay(35 + index * 15);
          const completed = progress === 100;
          agent.status = completed ? "completed" : "running";
          agent.progress = progress;
          agent.summary = completed ? `${name} 已完成：${task}` : null;
          agent.updated_at = new Date().toISOString();
          agentSession.status = completed ? "idle" : "active";
          await this.handlers.emitEvent(
            sessionId,
            {
              kind: completed ? "agent.completed" : "agent.progress",
              thread_id: agentId,
              parent_thread_id: sessionId,
              root_session_id: sessionId,
              name,
              role: agent.role,
              task,
              agent_status: agent.status,
              progress,
              summary: agent.summary,
            },
            { agent_id: agentId },
          );
        }
      }),
    );
  }

  async close() {}
}

export class CodexAppServerAdapter {
  constructor(options = {}) {
    this.supportsContinuation = true;
    this.codexBin = resolveCodexBinary(options.codexBin);
    this.workspace = options.workspace ?? process.cwd();
    this.child = null;
    this.readline = null;
    this.handlers = null;
    this.nextId = 1;
    this.pending = new Map();
    this.pendingApprovals = new Map();
    this.asyncQuestions = new CodexAsyncQuestions({
      publish: approval => this.handlers.requestApproval(approval),
      emit: (id, event) => this.handlers.emitEvent(id, event),
      send: async (entry, answer, content) => {
        if (this.resumedThreads.has(entry.sessionId)) {
          const activeTurnId = this.activeTurns.get(entry.sessionId);
          const params = {threadId: entry.sessionId, clientUserMessageId: entry.id,
            input: [{type:'text',text:content,text_elements:[]}]};
          if (activeTurnId) await this.request('turn/steer', {...params, expectedTurnId:activeTurnId});
          else {
            const result = await this.request('turn/start', {...params,
              cwd:this.sessionCwds.get(entry.sessionId) ?? this.workspace, ...this.turnSettingsParams(entry.sessionId)});
            if (result.turn?.id) this.activeTurns.set(entry.sessionId,result.turn.id);
          }
        } else {
          const owner = await this.readDesktopPermissions(entry.sessionId, undefined, {
            ownershipOnly:true, timeoutMs:1000 }).then(() => true, () => false);
          if (!owner) await this.submitMessage({sessionId:entry.sessionId,clientMessageId:entry.id,content});
          else {
            const result = await this.answerDesktopQuestion(entry.sessionId, { turnId: entry.turnId, itemId: entry.itemId,
              index: entry.index, question: entry.question.title, answer, clientMessageId: entry.id });
            if (result.awaitingNewTurn) await this.submitMessage({sessionId:entry.sessionId,clientMessageId:entry.id,content});
          }
        }
      },
    });
    this.desktopStatePool = createDesktopStatePool();
    const desktopOptions = extra => ({ ...extra, statePool: this.desktopStatePool });
    this.answerDesktopQuestion = (id, reply, extra) => desktopAnswerQuestion(id, reply, desktopOptions(extra));
    this.readDesktopApprovals = (id, extra) => desktopPendingApprovals(id, desktopOptions(extra));
    this.answerDesktopApproval = (id, reply, extra) => desktopResolveApproval(id, reply, desktopOptions(extra));
    this.resumedThreads = new Set();
    this.sessionCwds = new Map();
    this.activeTurns = new Map();
    this.liveTurns = new Map();
    // Only owner notifications/snapshots populate this small lifecycle cursor.
    // Non-owner thread/read may misreport a running Desktop turn as interrupted.
    this.continueLifecycle = new Map();
    this.threadRuntimeRevisions = new Map();
    this.activeTurnStartedAt = new Map();
    this.observedUserMessages = new Map();
    this.emittedUserMessages = new Map();
    this.pendingPersistenceChecks = new Map();
    this.queueTracker = new CodexQueueTracker({
      request: (method, params) => this.request(method, params),
      readTurnStatuses: async thread => {
        if (!thread.path?.endsWith(".jsonl")) return new Map();
        await this.pollExternalRolloutActivity(thread);
        const state = this.externalRolloutTails.get(thread.id);
        const statuses = new Map(state?.terminalTurnStatuses);
        if (state?.activeTurnId) statuses.set(state.activeTurnId, "running");
        return statuses;
      },
      emit: (id, event) => this.handlers?.emitEvent(id, event),
      save: receipt => this.handlers?.saveCodexQueueReceipt?.(receipt),
      remove: receipt => this.handlers?.removeCodexQueueReceipt?.(receipt),
      intervalMs: options.queuePollIntervalMs,
      maxMs: options.queueTrackingMaxMs,
    });
    this.threadMetadata = new Map();
    this.agentDetailCache = new Map();
    this.unpublishedCreatedThreads = new Set();
    this.threadLoads = new Map();
    this.externalRolloutTails = new Map();
    this.catalogFileAccessLimited = false;
    this.modelCatalog = null;
    this.modelCatalogLoadedAt = 0;
    this.modelCatalogRefreshMs =
      options.modelCatalogRefreshMs ?? CODEX_MODEL_CATALOG_REFRESH_MS;
    this.accountUsage = null;
    this.quotaWindows = [];
    this.quotaReadAt = 0;
    this.quotaRevision = 0;
    this.quotaReadPromise = null;
    this.accountUsageLoadedAt = 0;
    this.accountUsageReadPromise = null;
    this.accountUsageRetryAt = 0;
    this.accountUsageRefreshMs =
      options.accountUsageRefreshMs ?? CODEX_USAGE_REFRESH_MS;
    this.codexSessionsRoot =
      options.codexSessionsRoot ??
      join(process.env.CODEX_HOME || join(homedir(), ".codex"), "sessions");
    this.localUsageDay = null;
    this.localUsageRollouts = new Map();
    this.threadPermissions = new Map();
    this.permissionUpdateWaiters = new Map();
    this.permissionConfigurations = new Set();
    this.permissionRefreshAt = new Map();
    this.historyPermissionRefreshes = new Map();
    this.historyPages = new Map();
    this.recoveredRolloutPaths = new Map();
    this.nativeHistoryAvailable = undefined;
    this.nativeHistorySourceFallbacks = new Map();
    this.rolloutHistoryIndex = new CodexRolloutHistoryIndex({
      createState: createRolloutHistoryState,
      fold: foldRolloutHistoryRecord,
    });
    this.closed = false;
    this.sessionControls = new Map();
    this.startDesktopMessage = options.desktopStartMessage ?? ((id, message, extra) => desktopStartMessage(id, message, desktopOptions(extra)));
    this.interruptDesktopTurn = options.desktopInterruptTurn ?? ((id, extra) => desktopInterruptTurn(id, desktopOptions(extra)));
    this.submitDesktopMessage = options.desktopSubmitMessage ?? ((id, message, extra) => desktopSubmitMessage(id, message, desktopOptions(extra)));
    this.readDesktopPermissions = options.desktopPermissions ?? ((id, settings, extra) => desktopPermissions(id, settings, desktopOptions(extra)));
    this.readDesktopRuntime = options.desktopRuntime ?? ((id, extra) => desktopRuntime(id, desktopOptions({ timeoutMs: 15_000, ...extra })));
    this.threadModelOverrides = new Map();
    this.threadReasoningEffortOverrides = new Map();
    this.threadServiceTierOverrides = new Map();
  }

  async start(handlers) {
    this.handlers = withThinkingState(handlers);
    this.closed = false;
    this.child = spawn(
      this.codexBin,
      ["app-server"],
      agentSpawnOptions(this.codexBin, {
        cwd: this.workspace,
        // This backend already delivers approvals over its owned app-server.
        env: { ...process.env, RELAYUNE_SKIP_CODEX_HOOKS: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
    this.readline = createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });
    this.readline.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk) => {
      if (process.env.CODEX_RELAY_DEBUG === "1") process.stderr.write(chunk);
    });
    this.child.once("exit", (code, signal) => {
      this.queueTracker.close();
      this.rejectAll(
        new Error(`codex app-server exited with ${signal ?? code ?? 1}.`),
      );
    });
    this.child.once("error", (error) => this.rejectAll(error));

    await this.request("initialize", {
      clientInfo: {
        name: "relayune_local_client",
        title: "Relayune Local Client",
        version: "0.3.33",
      },
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized", {});
    await this.queueTracker.restore(await this.handlers.loadCodexQueueReceipts?.() ?? []);
    await this.recoverRecentAttachmentRollouts();
  }

  async recoverRecentAttachmentRollouts() {
    if (
      typeof this.handlers?.registerRecoveredAttachments !== "function" ||
      typeof this.handlers?.readAttachmentCheckpoint !== "function" ||
      typeof this.handlers?.writeAttachmentCheckpoint !== "function"
    ) {
      return;
    }
    const recent = await findRecentCodexRolloutsWithInfo(
      this.codexSessionsRoot,
      Date.now() - ATTACHMENT_RECOVERY_LOOKBACK_MS,
    );
    const inspected = await Promise.allSettled(
      recent
        .sort((left, right) => right.info.mtimeMs - left.info.mtimeMs)
        .slice(0, MAX_EXTERNAL_ROLLOUTS)
        .map(async ({ path, info }) => ({
          path,
          info,
          sessionId: await readCodexRolloutSessionId(path),
        })),
    );
    const candidates = inspected
      .filter(
        (result) => result.status === "fulfilled" && result.value.sessionId,
      )
      .map((result) => result.value)
      .sort((left, right) => right.info.mtimeMs - left.info.mtimeMs);
    for (const candidate of candidates) {
      try {
        await this.recoverExternalRolloutAttachments(
          { id: candidate.sessionId, path: candidate.path },
          candidate.info,
        );
      } catch (error) {
        // Optional attachment recovery must not disable a healthy app-server
        // or prevent recovery of other threads. The failed checkpoint stays
        // unchanged and normal catalog polling retries that rollout.
        this.catalogFileAccessLimited ||= isFileAccessError(error);
      }
    }
  }

  // The recent catalog is bounded. Resolve an explicitly selected older thread
  // without resuming it or taking ownership away from another Codex client.
  async findSession(sessionId) {
    let result;
    try {
      result = await this.request("thread/read", {
        threadId: sessionId,
        includeTurns: false,
      });
    } catch (error) {
      if (/^(?:thread not found:|no rollout found for thread id)/i.test(error?.message ?? "")) return null;
      throw error;
    }
    const thread = result.thread ?? result;
    if (thread?.id !== sessionId) throw new Error("Codex returned an unexpected session.");
    this.rememberThread(thread);
    return this.toRelaySession(thread, this.workspace);
  }

  catalogWatchPaths() { return [this.codexSessionsRoot]; }

  async listSessions() {
    await this.loadModelCatalog({ refresh: true }).catch(() => []);
    const listed = [];
    const seenCursors = new Set();
    let cursor = null;
    do {
      const result = await this.request("thread/list", {
        limit: Math.min(100, 300 - listed.length), cursor,
        sortKey: "updated_at", sortDirection: "desc", sourceKinds: [], archived: false,
      });
      listed.push(...(result.data ?? []));
      cursor = result.nextCursor ?? null;
      if (cursor && (typeof cursor !== 'string' || seenCursors.has(cursor))) throw new Error('Repeated session cursor');
      if (cursor) seenCursors.add(cursor);
    } while (cursor && listed.length < 300 && seenCursors.size < 10);
    listed.splice(300);
    for (const thread of listed) this.unpublishedCreatedThreads.delete(thread.id);
    // Codex does not publish an empty thread in thread/list until its first
    // turn. Keep only locally created, not-yet-published threads discoverable.
    // Once observed in the native catalog, its normal visibility is authoritative.
    const threads = dedupeCodexThreads([
      ...listed,
      ...[...this.unpublishedCreatedThreads]
        .map(id => this.threadMetadata.get(id)).filter(Boolean),
    ]);
    for (const thread of threads) {
      this.rememberThread(thread);
    }
    await this.syncExternalRolloutActivity(threads);
    // Retry previously requested permissions even after an owner was unavailable.
    // Keep slow/offline IPC out of the catalog response and share the history
    // refresh guard so polling cannot launch duplicate reads for a thread.
    const permissionRetries = threads
      .filter(thread => this.permissionRefreshAt.has(thread.id) &&
        !this.historyPermissionRefreshes.has(thread.id) &&
        Date.now() - this.permissionRefreshAt.get(thread.id) >= 30_000)
      .sort((left, right) => this.permissionRefreshAt.get(left.id) - this.permissionRefreshAt.get(right.id))
      .slice(0, Math.max(0, 8 - this.historyPermissionRefreshes.size));
    for (const thread of permissionRetries) this.refreshHistoryPermissions(thread.id);
    return threads.map((thread) => this.toRelaySession(thread, this.workspace));
  }

  async listProjectSessions({ cwd, cursor = null }) {
    const result = await this.request("thread/list", {
      cwd, cursor, limit: 5, sortKey: "updated_at", sortDirection: "desc",
      sourceKinds: [], archived: false,
    });
    if (result.nextCursor && result.nextCursor === cursor) throw new Error("Repeated session cursor");
    const sessions = (result.data ?? []).map(thread => {
      this.rememberThread(thread);
      return this.toRelaySession(thread, this.workspace);
    }).filter(session => session.cwd === cwd && !session.is_subagent);
    return { sessions, next_cursor: result.nextCursor ?? null };
  }

  async readUsage(options = {}) {
    const [usage] = await Promise.all([
      this.readTokenUsage(options), this.readQuota(options),
    ]);
    if (!usage.codex && !this.quotaWindows.length) return usage;
    return { codex: { ...(usage.codex ?? { as_of: "", daily: [] }),
      quota_windows: this.quotaWindows } };
  }

  async readQuota({ refresh = false } = {}) {
    if (this.quotaReadPromise) return this.quotaReadPromise;
    if (!refresh && Date.now() - this.quotaReadAt < this.accountUsageRefreshMs) return;
    this.quotaReadAt = Date.now();
    const revision = this.quotaRevision;
    this.quotaReadPromise = (async () => {
      try {
        const result = await this.request("account/rateLimits/read", {}, { timeoutMs: 5000 });
        if (revision === this.quotaRevision) this.quotaWindows = normalizeCodexQuota(result);
      } catch {
        // Older CLI/API-key accounts may not expose subscription limits.
        // Keep the previous timestamp so clients can identify stale data.
      }
    })();
    try { await this.quotaReadPromise; } finally { this.quotaReadPromise = null; }
  }

  async readTokenUsage({ refresh = false } = {}) {
    const now = Date.now();
    if (
      this.accountUsage &&
      !refresh &&
      now - this.accountUsageLoadedAt < this.accountUsageRefreshMs
    ) {
      return { codex: this.accountUsage };
    }
    if (!refresh && now < this.accountUsageRetryAt) {
      return this.accountUsage ? { codex: this.accountUsage } : {};
    }
    if (this.accountUsageReadPromise) return this.accountUsageReadPromise;
    const operation = this.loadUsage();
    this.accountUsageReadPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.accountUsageReadPromise === operation) {
        this.accountUsageReadPromise = null;
      }
    }
  }

  async loadUsage() {
    try {
      let result;
      try {
        result = await this.request("account/usage/read", {}, { timeoutMs: 5000 });
      } catch (primaryError) {
        try {
          result = await this.readIndependentAccountUsage();
        } catch (fallbackError) {
          if (process.env.CODEX_RELAY_DEBUG === "1") {
            process.stderr.write(
              `[codex-usage] primary: ${errorMessage(primaryError)}; ` +
                `fallback: ${errorMessage(fallbackError)}\n`,
            );
          }
          throw fallbackError;
        }
      }
      const daily = normalizeCodexDailyUsage(result.dailyUsageBuckets);
      const now = new Date();
      const today = localDateKey(now);
      // Codex can leave the open calendar day out of account usage until it is
      // finalized. Local rollout deltas keep that one bucket live meanwhile.
      const localToday = await this.readLocalTodayUsage(now).catch(() => null);
      if (localToday !== null) {
        mergeDailyUsageMaximum(daily, today, localToday);
      }
      this.accountUsage = {
        as_of: now.toISOString(),
        daily,
      };
      this.accountUsageLoadedAt = Date.now();
      this.accountUsageRetryAt = 0;
      return { codex: this.accountUsage };
    } catch {
      this.accountUsageRetryAt = Date.now() + CODEX_USAGE_FAILURE_RETRY_MS;
      return this.accountUsage ? { codex: this.accountUsage } : {};
    }
  }

  async readIndependentAccountUsage() {
    return readCodexUsageFromIndependentAppServer({
      codexBin: this.codexBin,
      workspace: this.workspace,
    });
  }

  async readLocalTodayUsage(now) {
    const day = localDateKey(now);
    if (this.localUsageDay !== day) {
      this.localUsageDay = day;
      this.localUsageRollouts.clear();
    }
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const paths = await findRecentCodexRollouts(
      this.codexSessionsRoot,
      startOfDay,
    );
    for (const path of paths) {
      await this.updateLocalUsageRollout(path, day);
    }
    let total = 0;
    for (const state of this.localUsageRollouts.values()) {
      total = safeTokenSum(total, state.todayTokens);
      if (total === null) return null;
    }
    return total;
  }

  async updateLocalUsageRollout(path, day) {
    const info = await stat(path);
    let state = this.localUsageRollouts.get(path);
    if (!state || info.size < state.offset) {
      state = createCodexRolloutUsageState();
      this.localUsageRollouts.set(path, state);
    }
    if (info.size === state.offset) return;

    while (state.offset < info.size) {
      const length = Math.min(MAX_ROLLOUT_READ_BYTES, info.size - state.offset);
      const text = await readUtf8FileRange(path, state.offset, length);
      if (!text) break;
      state.offset += length;
      const lines = completeJsonLines(`${state.fragment}${text}`);
      state.fragment = lines.fragment;
      for (const line of lines.records) {
        foldCodexRolloutUsageLine(line, state, day, path);
      }
    }
  }

  async supportsProjects() {
    this.projectSupport ??= (async () => {
      const directory = await mkdtemp(join(tmpdir(), "relayune-project-schema-"));
      try {
        await promisify(execFile)(this.codexBin, ["app-server", "generate-json-schema", "--experimental", "--out", directory], { timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true });
        const schema = JSON.parse(await readFile(join(directory, "v2", "ProjectCreateParams.json"), "utf8"));
        return ["idempotencyKey", "name", "roots"].every(key => schema.required?.includes(key));
      } catch { return false; }
      finally { await rm(directory, { recursive: true, force: true }); }
    })();
    return this.projectSupport;
  }

  async createProject({ cwd, name, idempotencyKey }) {
    const { project } = await this.request("project/create", { name, roots: [{ path: cwd }], idempotencyKey });
    if (!project?.id || project.roots?.[0]?.path !== cwd) throw new Error("invalid_project_result");
    return { id: `${project.id}:0`, name: project.name, cwd, updated_at: normalizeTimestamp(project.updatedAt ?? project.createdAt), provider: "codex" };
  }

  async listProjects() {
    const projects = [];
    const seenCursors = new Set();
    let cursor = null;
    try {
      do {
        const result = await this.request("project/list", {
          limit: 100,
          cursor,
        });
        for (const project of result.data ?? []) {
          for (const [rootIndex, root] of (project.roots ?? []).entries()) {
            const cwd = typeof root?.path === "string" ? root.path.trim() : "";
            if (!project?.id || !cwd) continue;
            projects.push({
              id: `${project.id}:${rootIndex}`,
              name: project.name || basename(cwd),
              cwd,
              updated_at: normalizeTimestamp(
                project.updatedAt ?? project.createdAt,
              ),
            });
            if (projects.length >= MAX_CODEX_PROJECTS) return projects;
          }
        }
        const nextCursor = result.nextCursor ?? null;
        if (nextCursor && seenCursors.has(nextCursor)) break;
        if (nextCursor) seenCursors.add(nextCursor);
        cursor = nextCursor;
      } while (cursor);
    } catch {
      // Older app-server builds do not expose project/list. Session-derived
      // projects remain available through listSessions in that case.
      return [];
    }
    return projects;
  }

  async createSession({ cwd, name }) {
    const sessionCwd = cwd || this.workspace;
    const result = await this.request("thread/start", {
      cwd: sessionCwd,
      serviceName: "codex-relay",
      ephemeral: false,
      // Some app-server builds default to paginated storage while their
      // list_turns/resume implementation is still unavailable.
      historyMode: "legacy",
    });
    const thread = result.thread ?? result;
    if (!thread?.id) {
      throw new Error("Codex did not return a thread id.");
    }
    const createdThread = {
      ...thread,
      name: name || thread.name,
    };
    this.rememberThread(createdThread);
    this.unpublishedCreatedThreads.add(createdThread.id);
    this.rememberThreadSettingsFromResponse(createdThread.id, result);
    // thread/start already loads and subscribes this thread. Resuming before
    // its first message can fail because its rollout is not materialized yet.
    this.resumedThreads.add(createdThread.id);
    return {
      ...this.toRelaySession(createdThread, sessionCwd),
      sync_state: "pending",
      sync_verified_at: null,
    };
  }

  forkCapabilities() { return { mode: "turn", worktree: true }; }

  async forkSource(options) { return (await this.validateForkSource(options)).source; }

  async validateForkSource({ sessionId, messageId, turnId }) {
    if (!sessionId || !messageId || !turnId) throw codexForkError("session_fork_invalid_reply");
    let result;
    try {
      result = await this.request("thread/read", { threadId: sessionId, includeTurns: true },
        { timeoutMs: CODEX_HISTORY_RPC_TIMEOUT_MS });
    } catch (error) {
      if (/^(?:thread not found:|no rollout found for thread id)/i.test(error?.message ?? ""))
        throw codexForkError("session_not_found");
      throw codexForkError("session_fork_invalid_reply");
    }
    const thread = result.thread ?? result;
    if (thread?.id !== sessionId) throw codexForkError("session_not_found");
    // Older native builds do not expose a proven goal-continuation suppressor.
    // Do not create a branch that could start working before the user sends.
    if (thread.goal && !["completed", "cancelled", "failed", "paused"].includes(thread.goal.status))
      throw codexForkError("session_fork_unsupported");
    const turn = thread.turns?.find(value => value.id === turnId);
    if (turn?.status === "inProgress" || this.activeTurns.get(sessionId) === turnId)
      throw codexForkError("session_fork_busy");
    const reply = (turn?.items ?? []).filter(item => item.type === "agentMessage" &&
      (!item.phase || item.phase === "final_answer") && codexAgentMessageText(item)).at(-1);
    // A turn-level fork cannot cut between two messages in the same native turn.
    // Live Relay replies use this turn alias until native history is loaded.
    if (turn?.status !== "completed" || !reply ||
        ![reply.id, `codex_${turnId}`, `agent_${turnId}`, `agent_${turnId}_${reply.id}`].includes(messageId) ||
        turn.items.slice(turn.items.indexOf(reply) + 1).some(item => item.type !== "reasoning"))
      throw codexForkError("session_fork_invalid_reply");
    return { source: { ...this.toRelaySession(thread, this.workspace), cwd: thread.cwd || this.workspace },
      turnIds: thread.turns.slice(0, thread.turns.indexOf(turn) + 1).map(value => value.id) };
  }

  forkSession(options) {
    return this.serializeControl(options.sessionId, async () => {
      const { source, turnIds } = await this.validateForkSource(options);
      let result;
      try {
        result = await this.request("thread/fork", { threadId: options.sessionId,
          lastTurnId: options.turnId, cwd: options.cwd || source.cwd, ephemeral: false,
          deferGoalContinuation: true });
      } catch (error) {
        if (error?.code === -32601) throw codexForkError("session_fork_unsupported");
        if (/in progress|inProgress|active turn|busy/i.test(error?.message ?? ""))
          throw codexForkError("session_fork_busy");
        throw codexForkError("session_fork_outcome_unknown");
      }
      const thread = result.thread ?? result;
      if (!thread?.id || thread.id === options.sessionId)
        throw codexForkError("session_fork_outcome_unknown");
      this.rememberThread(thread);
      this.rememberThreadSettingsFromResponse(thread.id, result);
      this.resumedThreads.add(thread.id);
      // Native thread/fork persists immediately, without submitting a prompt.
      try {
        const read = await this.request("thread/read", { threadId: thread.id, includeTurns: true });
        const verified = read.thread ?? read;
        if (verified?.id !== thread.id ||
            JSON.stringify(verified.turns?.map(turn => turn.id)) !== JSON.stringify(turnIds))
          throw new Error("Unexpected fork identity or boundary");
      } catch { throw codexForkError("session_fork_outcome_unknown"); }
      return { ...this.toRelaySession(thread, source.cwd), sync_state: "persisted",
        sync_verified_at: new Date().toISOString() };
    });
  }

  async finalizeSessionCreation(session) {
    const thread = this.threadMetadata.get(session.id) ?? {
      id: session.id,
      cwd: session.cwd,
      name: session.name,
    };
    if (customSessionTitle(thread.name) && thread.id) {
      await this.request("thread/name/set", {
        threadId: thread.id,
        name: customSessionTitle(thread.name),
      });
    }
    const verified = await this.request("thread/read", {
      threadId: thread.id,
      includeTurns: false,
    });
    if ((verified.thread ?? verified)?.id !== session.id) {
      throw new Error("Codex did not verify the created thread id.");
    }
    // Read-back verifies existence only. A turn may have started meanwhile;
    // replaying this snapshot could clear its live status and active turn id.
    return {
      ...this.toRelaySession(thread, session.cwd || this.workspace),
      sync_state: "persisted",
      sync_verified_at: new Date().toISOString(),
    };
  }

  async readHistory({ sessionId, limit = 100, before = null, includeAgentDetails = true, maxBytes, onProgress }) {
    const runtimeRevision = this.threadRuntimeRevisions.get(sessionId) ?? 0;
    const historyBoundary = before ? decodeHistoryCursor(before) : null;
    if (historyBoundary?.session_id !== undefined && historyBoundary.session_id !== sessionId)
      throw new Error('History cursor belongs to another conversation.');
    if (includeAgentDetails) await this.refreshPermissions(sessionId);
    else this.refreshHistoryPermissions(sessionId);
    let rememberedThread = this.threadMetadata.get(sessionId);
    let metadataRead;
    if (rememberedThread?.path?.endsWith('.jsonl') && !await historyFileFingerprint(rememberedThread.path)) {
      metadataRead = await this.recoverRolloutThread(sessionId);
      rememberedThread = this.threadMetadata.get(sessionId);
    }
    if (!rememberedThread?.path?.endsWith('.jsonl')) {
      try { metadataRead = await this.readThreadHistoryWithRetry(sessionId, { includeTurns: false }); }
      catch (error) {
        if (!isMissingRolloutError(error)) throw error;
        metadataRead = await this.recoverRolloutThread(sessionId);
      }
      if (metadataRead.historyNotMaterialized) return { messages: [], next_cursor: null,
        has_more: false, agents: [], sessions: [] };
      const metadataThread = metadataRead.thread ?? metadataRead;
      if (metadataThread.id !== sessionId) throw new Error('Codex history source does not match this conversation.');
      this.rememberThread(metadataThread, { runtimeRevision });
      rememberedThread = this.threadMetadata.get(sessionId);
      if (rememberedThread?.path?.endsWith('.jsonl') && !await historyFileFingerprint(rememberedThread.path)) {
        metadataRead = await this.recoverRolloutThread(sessionId);
        rememberedThread = this.threadMetadata.get(sessionId);
      }
    }
    // A large latest page deliberately uses the complete compatibility read.
    // Probing many native pages first can end at an older source without a
    // lifecycle boundary, forcing the same large history to be read twice.
    // Existing native cursors still use their original bounded path.
    const completeLatest = !before && Number(limit) >= 500;
    const indexedEntry = this.rolloutHistoryIndex.entries.get(`${sessionId}\0${rememberedThread?.path}`);
    // Reuse the existing complete projection for smaller wire-budget retries
    // and later pages. A cursor created by the native path retains that path.
    const seededSource = indexedEntry?.state.providerSeed &&
      !Object.hasOwn(historyBoundary ?? {}, 'native_turn_cursor');
    // Modern app-server history is indexed by its owning provider. Ask for
    // bounded pages before touching the rollout; a local cold projection would
    // otherwise scan hundreds of megabytes just to return a small screenful.
    const nativeFallback = this.nativeHistorySourceFallbacks.get(sessionId);
    const sourceFallbackUnchanged = nativeFallback &&
      nativeFallback.fingerprint === await historyFileFingerprint(rememberedThread?.path);
    if (!completeLatest && !seededSource && this.nativeHistoryAvailable !== false && !sourceFallbackUnchanged &&
        ['legacy', 'paginated'].includes(rememberedThread?.historyMode)) {
      const cacheKey = JSON.stringify({ limit, maxBytes });
      const cached = !before && !includeAgentDetails && this.historyPages.get(sessionId);
      if (cached?.native && cached.key === cacheKey && cached.path === rememberedThread.path &&
          cached.fingerprint === await historyFileFingerprint(cached.path)) {
        let fresh = Date.now() - cached.createdAt < 30_000;
        if (!fresh) {
          const cacheDeadline = Date.now() + CODEX_NATIVE_HISTORY_BUDGET_MS;
          const refresh = async (method, params) => {
            const remaining = cacheDeadline - Date.now();
            if (remaining <= 0) throw new Error('Codex history read timed out.');
            const result = await this.request(method, params, { timeoutMs: Math.min(CODEX_HISTORY_RPC_TIMEOUT_MS, remaining) });
            if (Date.now() >= cacheDeadline) throw new Error('Codex history read timed out.');
            return result;
          };
          const snapshot = await refresh('thread/read', { threadId: sessionId, includeTurns: false });
          const current = snapshot.thread ?? snapshot;
          if (current.id !== sessionId) throw new Error('Codex history source does not match this conversation.');
          const latest = await refresh('thread/turns/list', { threadId: sessionId,
            limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' });
          validateNativeHistoryPage(latest);
          fresh = current.path === cached.path && latest.data[0]?.id === cached.latestTurnId &&
            latest.data[0]?.status === cached.latestTurnStatus &&
            cached.fingerprint === await historyFileFingerprint(cached.path);
          if (fresh) { cached.createdAt = Date.now(); this.rememberNativeHistoryThread(current, { runtimeRevision }); }
        }
        if (fresh && runtimeRevision === (this.threadRuntimeRevisions.get(sessionId) ?? 0)) return structuredClone(cached.page);
      }
      try {
        const page = await this.readNativeHistory({ sessionId, thread: rememberedThread,
          metadataRead, limit, before, includeAgentDetails, maxBytes, runtimeRevision });
        this.nativeHistoryAvailable = true;
        return page;
      } catch (error) {
        rethrowFileAccessError(error);
        if (error?.code === -32601) this.nativeHistoryAvailable = false;
        else if (error?.code === 'RELAY_NATIVE_HISTORY_SOURCE_UNAVAILABLE') {
          this.nativeHistorySourceFallbacks.delete(sessionId);
          if (this.nativeHistorySourceFallbacks.size >= 8)
            this.nativeHistorySourceFallbacks.delete(this.nativeHistorySourceFallbacks.keys().next().value);
          this.nativeHistorySourceFallbacks.set(sessionId, {
            fingerprint: await historyFileFingerprint(rememberedThread.path),
          });
        } else if (!isMissingRolloutError(error)) throw error;
      }
    }
    const indexedPath = rememberedThread?.path;
    let concurrentProviderRead;
    let providerReadFingerprint;
    // Only the first complete read needs provider calibration. Cached seeds
    // keep their existing incremental path without another full RPC.
    if (completeLatest && indexedPath?.endsWith('.jsonl') &&
        !this.rolloutHistoryIndex.entries.get(`${sessionId}\0${indexedPath}`)?.state.providerSeed &&
        !(metadataRead?.thread ?? metadataRead)?.turns?.length) {
      providerReadFingerprint = await historyFileFingerprint(indexedPath);
      concurrentProviderRead = this.readThreadHistoryWithRetry(sessionId).then(
        value => ({ value }), error => ({ error }),
      );
    }
    let projection;
    if (indexedPath?.endsWith('.jsonl')) {
      try { projection = await this.rolloutHistoryIndex.read(indexedPath, sessionId, { onProgress }); }
      catch (error) {
        rethrowFileAccessError(error);
        if (error?.code === 'RELAY_CODEX_HISTORY_SOURCE_MISMATCH') throw error;
      }
    }
    if (projection?.sessionId && projection.sessionId !== sessionId)
      throw new Error('Codex history source does not match this conversation.');
    if (projection?.sessionId === sessionId) this.reconcilePersistedRuntime(sessionId, projection.lifecycle);
    // The rollout is the owning provider's durable source. Once its identity
    // matches the thread (or a provider read seeded it), pagination and appends
    // use compact local projections without materializing thread/read turns.
    if (projection && projection.providerSeed &&
        (projection.providerSeedFingerprint === projection.fingerprint ||
          (!projection.requiresProvider && (projection.sourceComplete || projection.lifecycle.lifecycleKnown)))) {
      return this.readIndexedHistory({ sessionId, thread: rememberedThread, projection,
        limit, before, includeAgentDetails, maxBytes });
    }
    if (before && !includeAgentDetails) {
      const cached = this.historyPages.get(sessionId);
      if (cached && !cached.native && Date.now() - cached.createdAt < 30_000 &&
          cached.fingerprint === await historyFileFingerprint(cached.path)) {
        return {
          ...structuredClone(cached.metadata),
          ...structuredClone(paginateHistory(cached.messages, { limit, before, maxBytes })),
        };
      }
      this.historyPages.delete(sessionId);
    }
    // Compare before and after reading so a concurrently appended rollout is
    // never cached under a fingerprint newer than its message snapshot.
    const initialPath = rememberedThread?.path;
    const initialFingerprint = !includeAgentDetails && initialPath?.endsWith('.jsonl')
      ? providerReadFingerprint ?? await historyFileFingerprint(initialPath) : null;
    // This independent supplement can scan while app-server materializes its
    // thread response. Convert failures immediately to avoid unhandled rejections.
    const supplement = projection
      ? Promise.resolve({ messages: historySupplementMessages(projection) })
      : initialPath?.endsWith('.jsonl')
      ? readExternalRolloutFinalMessages(initialPath, sessionId).then(
          messages => ({ messages }), error => ({ error }),
        ) : null;
    const prefetched = concurrentProviderRead ? await concurrentProviderRead : null;
    let result;
    try {
      if (prefetched?.error) throw prefetched.error;
      result = (metadataRead?.thread ?? metadataRead)?.turns?.length
        ? metadataRead : prefetched?.value ?? await this.readThreadHistoryWithRetry(sessionId);
    } catch (error) {
      // Only legacy JSONL explicitly declares that it contains complete history.
      // Paginated sources can be mere pointers; never claim those are complete.
      if (!isMissingRolloutError(error) || projection?.sessionId !== sessionId ||
          !projection.sourceComplete || projection.requiresProvider) throw error;
      return this.readIndexedHistory({ sessionId, thread: rememberedThread, projection,
        limit, before, includeAgentDetails, maxBytes });
    }
    if (result.historyNotMaterialized) {
      // No persisted history exists before the first message. Do not replay
      // empty turn metadata over notifications from a concurrent turn/start.
      return {
        messages: [],
        next_cursor: null,
        has_more: false,
        agents: [],
        sessions: [],
      };
    }
    const thread = result.thread ?? result;
    // A non-owner app-server materializes a live Desktop turn as interrupted.
    // Reconcile its fresh rollout before using that snapshot to expire questions.
    if (this.handlers && !this.resumedThreads.has(sessionId) &&
        thread.status?.type === "notLoaded" && thread.path?.endsWith(".jsonl")) {
      await this.pollExternalRolloutActivity(thread, { includeDesktopState: false });
      const activeId = this.externalRolloutTails.get(sessionId)?.activeTurnId;
      if (activeId) {
        thread.turns = (thread.turns ?? []).map(turn =>
          turn.id === activeId && turn.status === "interrupted"
            ? { ...turn, status: "inProgress" } : turn);
      }
    }
    this.rememberThread(thread, { turnsAuthoritative: true, runtimeRevision });
    const messages = [];
    const collabItems = [];
    const turns = thread.turns ?? [];
    if (!before) await this.asyncQuestions.settleHistory(sessionId, turns, await this.rootSessionIdForThread(thread) ?? sessionId);
    const latestTurn = turns.at(-1);
    const latestToolIndexes = new Set(
      (latestTurn?.items ?? [])
        .map((item, index) => (isCodexToolActivityItem(item) ? index : null))
        .filter((index) => index != null)
        .slice(-MAX_HISTORY_TOOL_ACTIVITIES),
    );
    for (const turn of turns) {
      for (const [index, item] of (turn.items ?? []).entries()) {
        const message = historyMessageFromItem(item, turn, index, sessionId, {
          includeToolActivity:
            turn === latestTurn && latestToolIndexes.has(index),
        });
        if (message) messages.push({ ...message, turn_status: turn.status ?? null });
        if (
          item.type === "collabAgentToolCall" ||
          isSubAgentActivityItem(item)
        ) {
          collabItems.push(item);
        }
      }
      const failure = codexTurnFailureMessage(turn);
      if (failure) messages.push(failure);
    }
    let canSeedProjection = true;
    const rolloutPath = [thread.path, rememberedThread?.path].find(
      (path) => typeof path === "string" && path.endsWith(".jsonl"),
    );
    if (rolloutPath) {
      const recovered = supplement && rolloutPath === initialPath
        ? await supplement
        : await readExternalRolloutFinalMessages(rolloutPath, sessionId).then(
            messages => ({ messages }), error => ({ error }),
          );
      if (recovered.error) rethrowFileAccessError(recovered.error);
      const rolloutMessages = (recovered.messages ?? []).filter(message => message.role !== 'user' ||
        messages.length === 0 || message.turn_id === latestTurn?.id ||
        message.turn_id === projection?.lifecycle.currentTurnId ||
        messages.some(existing => existing.role === 'user' && existing.turn_id === message.turn_id &&
          existing.content === message.content));
      messages.splice(0, messages.length, ...mergeProjectedHistory(messages, rolloutMessages));
      messages.sort(
        (left, right) =>
          Date.parse(left.created_at) - Date.parse(right.created_at),
      );
      // Keep output images visible when clients collapse the tool timeline.
      // User attachments belong to the user's instruction. Moving them would
      // remove the instruction; mutating the reply must not make it a source
      // on the next loop iteration either.
      for (const imageMessage of rolloutMessages.filter(message =>
        message.role === "codex" && !message.content?.trim() &&
        message.attachments?.length && message.turn_id,
      )) {
        const reply = messages.findLast((message) =>
          message.role === "codex" &&
          message.turn_id === imageMessage.turn_id &&
          message.content?.trim() &&
          (!message.message_phase || message.message_phase === "final_answer"),
        );
        if (!reply) continue;
        const attachments = [...(reply.attachments ?? []), ...imageMessage.attachments];
        reply.attachments = attachments.filter((attachment, index) =>
          attachments.findIndex((candidate) => candidate.id === attachment.id) === index,
        );
        const imageIndex = messages.findIndex((message) => message.id === imageMessage.id);
        if (imageIndex >= 0) messages.splice(imageIndex, 1);
      }
      await recoverMissingHistoryImageSources(messages, {
        sessionId,
        rolloutPath,
        sessionsRoot: this.codexSessionsRoot,
      }).catch(() => {});
      if (!projection || rolloutPath !== indexedPath) {
        try { projection = await this.rolloutHistoryIndex.read(rolloutPath, sessionId, { onProgress }); }
        catch (error) {
          rethrowFileAccessError(error);
          if (error?.code === 'RELAY_CODEX_HISTORY_SOURCE_MISMATCH') throw error;
        }
      }
      if (projection) {
        externalizeHistoryImageSources(messages, projection.imageSources);
        // A file append/rewrite or lifecycle notification during the parallel
        // read cannot calibrate a different source snapshot with this seed.
        canSeedProjection = !concurrentProviderRead ||
          (providerReadFingerprint === projection.fingerprint &&
            providerReadFingerprint === await historyFileFingerprint(rolloutPath) &&
            runtimeRevision === (this.threadRuntimeRevisions.get(sessionId) ?? 0));
      }
      if (projection && canSeedProjection) {
        for (const turn of turns) {
          // Historical source files can end at task_started while the provider
          // has already finalized the turn elsewhere. Missing source terminal
          // records cannot make a native terminal snapshot run again.
          if (['completed', 'failed', 'interrupted'].includes(turn.status) &&
              (!projection.statuses.has(turn.id) || projection.statuses.get(turn.id) === 'inProgress'))
            projection.statuses.set(turn.id, turn.status);
        }
        projection.providerSeedFingerprint = projection.fingerprint;
        projection.seedOffset = projection.committedOffset ?? 0;
        projection.requiresProvider = false;
        projection.lastProviderTurnId = latestTurn?.id ?? projection.lifecycle.currentTurnId;
      }
    }
    // A tool without its own completion can survive an interrupted Desktop
    // turn in persisted history. Do not resurrect its spinner after refresh.
    const terminalStatuses = this.externalRolloutTails.get(sessionId)?.terminalTurnStatuses;
    for (const message of messages) {
      const terminal = terminalStatuses?.get(message.turn_id) ?? projection?.statuses.get(message.turn_id);
      if (terminal) message.turn_status = terminal;
      if (terminal && terminal !== 'inProgress' && message.tool_activity_status === 'running') {
        message.tool_activity_status = terminal === 'failed' ? 'failed' : 'completed';
      }
    }
    if (projection && canSeedProjection) {
      projection.providerSeed = { messages: structuredClone(messages),
        turns: compactHistoryQuestionTurns(turns), collabItems: threadCollabMetadata(turns) };
      this.rolloutHistoryIndex.enforceBudget();
    }
    const rootSessionId = await this.rootSessionIdForThread(thread) ?? thread.id;
    const descendants = await this.listDescendants(rootSessionId).catch(
      () => [],
    );
    const agentDetails = includeAgentDetails
      ? await this.loadAgentDetails(descendants) : new Map();
    const metadata = {
      agents: buildAgentSnapshot({
        rootSessionId,
        rootThread: thread,
        descendants,
        collabItems,
        agentDetails,
      }),
      sessions: descendants.map((descendant) => ({
        ...this.toRelaySession(descendant, thread.cwd || this.workspace),
        is_subagent: true,
        parent_thread_id: descendant.parentThreadId ?? null,
        root_session_id: rootSessionId,
        agent_role: descendant.agentRole ?? null,
      })),
    };
    if (!this.closed && !includeAgentDetails && rolloutPath === initialPath && initialFingerprint &&
        runtimeRevision === (this.threadRuntimeRevisions.get(sessionId) ?? 0) &&
        initialFingerprint === await historyFileFingerprint(rolloutPath)) {
      const bytes = Buffer.byteLength(JSON.stringify({ messages, metadata }));
      // Bound plaintext cache to 16 MiB and 8 sessions. It never leaves Relay.
      this.historyPages.delete(sessionId);
      if (bytes <= 16 * 1024 * 1024) {
        while (this.historyPages.size && (this.historyPages.size >= 8 ||
          [...this.historyPages.values()].reduce((sum, page) => sum + page.bytes, bytes) > 16 * 1024 * 1024)) {
          this.historyPages.delete(this.historyPages.keys().next().value);
        }
        this.historyPages.set(sessionId, {
          path: rolloutPath, fingerprint: initialFingerprint, createdAt: Date.now(),
          bytes, messages: structuredClone(messages), metadata: structuredClone(metadata),
        });
      }
    }
    return { ...metadata, ...paginateHistory(messages, { limit, before, maxBytes }) };
  }

  async readNativeHistory({ sessionId, thread, metadataRead, limit, before, includeAgentDetails, maxBytes,
    runtimeRevision = this.threadRuntimeRevisions.get(sessionId) ?? 0 }) {
    const deadline = Date.now() + CODEX_NATIVE_HISTORY_BUDGET_MS;
    const request = async (method, params) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Codex history read timed out.');
      const result = await this.request(method, params, { timeoutMs: Math.min(CODEX_HISTORY_RPC_TIMEOUT_MS, remaining) });
      if (Date.now() >= deadline) throw new Error('Codex history read timed out.');
      return result;
    };
    const snapshot = metadataRead ?? await request('thread/read', { threadId: sessionId, includeTurns: false });
    thread = snapshot.thread ?? snapshot;
    if (thread.id !== sessionId) throw new Error('Codex history source does not match this conversation.');
    const path = thread.path;
    const fingerprint = path?.endsWith('.jsonl') ? await historyFileFingerprint(path) : null;
    const externalTerminalFor = turnId => {
      const external = this.externalRolloutTails.get(sessionId);
      return fingerprint && external?.path === path && external.sourceIdentity === fingerprint.split(':').slice(0, 2).join(':')
        ? external.terminalTurnStatuses?.get(turnId) : null;
    };
    const boundary = before ? decodeHistoryCursor(before) : null;
    if (boundary?.session_id !== undefined && boundary.session_id !== sessionId)
      throw new Error('History cursor belongs to another conversation.');
    const turnCursorsRead = new Set();
    const readTurn = async cursor => {
      if (turnCursorsRead.has(cursor)) throw new Error('Codex turn history cursor did not advance.');
      turnCursorsRead.add(cursor);
      const result = await request('thread/turns/list', {
        threadId: sessionId, cursor, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded',
      });
      validateNativeHistoryPage(result);
      if (result.data.length > 1) throw new Error('Invalid Codex turn history page.');
      const turn = result.data[0];
      if (turn && (typeof turn.id !== 'string' || !Array.isArray(turn.items) ||
          !['completed', 'failed', 'interrupted', 'inProgress'].includes(turn.status)))
        throw new Error('Invalid Codex turn history page.');
      if (result.nextCursor && result.nextCursor === cursor) throw new Error('Codex turn history cursor did not advance.');
      return { turn, next: result.nextCursor ?? null };
    };
    const newest = await readTurn(null);
    const latestTurnId = newest.turn?.id;
    const latestProviderStatus = newest.turn?.status;
    const reconcileExternal = this.handlers && !this.resumedThreads.has(sessionId) &&
      thread.status?.type === 'notLoaded' && newest.turn?.status === 'interrupted';
    // A non-owner reports a running Desktop turn as interrupted. Wait for the
    // selected durable range instead of scanning the full external lifecycle,
    // and do not clear an already observed active turn while that read awaits.
    let latestSourceKnown = false;
    let latestPersistedLifecycle;
    const nativeCursor = boundary && Object.hasOwn(boundary, 'native_turn_cursor');
    let cursor = nativeCursor ? boundary.native_turn_cursor : null;
    let current = cursor == null ? newest : await readTurn(cursor);
    // Old v2 cursors carry a turn identity but no provider cursor. Resolve the
    // lightweight turn pages first; body pages are needed only from that turn.
    if (boundary?.v === 2 && !nativeCursor && boundary.turn_id) {
      while (current.turn && current.turn.id !== boundary.turn_id && current.next) {
        cursor = current.next;
        current = await readTurn(cursor);
      }
    }
    if (nativeCursor && current.turn?.id !== boundary.turn_id)
      throw new Error('History cursor is no longer valid.');
    const turns = [], turnCursors = new Map(), turnSources = new Map(), seed = [], rawSeed = [], collabItems = [];
    const validationRanges = [], sourceQuestions = [];
    let merged = [], page, sourceEnd, sourceRecords = 0, sourceBytes = 0, sourceRangeBytes = 0,
      sourceScanBytes = 0, sourceFoldBytes = 0, itemPages = 0;
    let sourceEndBoundary;
    if (nativeCursor && boundary.source_fingerprint === fingerprint && boundary.source_end_offset !== undefined) {
      sourceEnd = boundary.source_end_offset;
      sourceEndBoundary = { length: boundary.source_end_length, digest: boundary.source_end_digest };
    }
    while (current.turn) {
      const turn = { ...current.turn, items: [] };
      const supplement = fingerprint
        ? await readNativeHistorySupplement(path, sessionId, turn.id, { deadline, endOffset: sourceEnd,
          endBoundary: sourceEndBoundary, expectedIdentity: fingerprint.split(':').slice(0, 2).join(':') }) : null;
      sourceEnd = supplement?.startOffset;
      sourceEndBoundary = supplement?.startBoundary;
      sourceRecords += supplement?.records ?? 0;
      sourceBytes += supplement?.readBytes ?? 0;
      sourceRangeBytes += supplement?.rangeBytes ?? 0;
      sourceScanBytes += supplement?.scanBytes ?? 0;
      sourceFoldBytes += supplement?.foldBytes ?? 0;
      if (supplement) {
        if (turn.id === latestTurnId && supplement.state.lifecycle.terminalTurnStatuses?.has(turn.id))
          latestPersistedLifecycle = supplement.state.lifecycle;
        const externalTerminal = externalTerminalFor(turn.id) ??
          supplement.state.lifecycle.terminalTurnStatuses?.get(turn.id);
        if (externalTerminal) {
          turn.status = externalTerminal;
          if (turn.id === latestTurnId) newest.turn.status = turn.status;
        }
        if (turn.id === latestTurnId && reconcileExternal && supplement.state.lifecycle.lifecycleKnown) {
          if (!externalTerminal) turn.status = supplement.state.lifecycle.activeTurnId === turn.id
            ? 'inProgress' : supplement.state.statuses.get(turn.id) ?? turn.status;
          newest.turn.status = turn.status;
          latestSourceKnown = true;
        }
        for (const source of supplement.state.lifecycle.asyncQuestions?.values() ?? [])
          if (source.accepted) sourceQuestions.push({ source, status: turn.status });
        rawSeed.unshift(...historySupplementMessages(supplement.state));
        validationRanges.push(...supplement.validationRanges);
        turnSources.set(turn.id, { endOffset: supplement.endOffset, endBoundary: supplement.endBoundary });
      }
      let itemCursor = null;
      const itemCursorsRead = new Set();
      const items = [];
      do {
        if (itemCursorsRead.has(itemCursor)) throw new Error('Codex item history cursor did not advance.');
        itemCursorsRead.add(itemCursor);
        const result = await request('thread/items/list', {
          threadId: sessionId, turnId: turn.id, cursor: itemCursor, limit: 100, sortDirection: 'asc',
        });
        validateNativeHistoryPage(result);
        itemPages += 1;
        for (const entry of result.data) {
          if (entry?.turnId !== turn.id || typeof entry.item?.id !== 'string')
            throw new Error('Codex history item does not belong to this conversation.');
          items.push(entry.item);
        }
        const next = result.nextCursor ?? null;
        if (next && next === itemCursor) throw new Error('Codex item history cursor did not advance.');
        itemCursor = next;
      } while (itemCursor);
      const toolIndexes = new Set(turn.id === latestTurnId ? items
        .map((item, index) => isCodexToolActivityItem(item) ? index : null)
        .filter(index => index !== null).slice(-MAX_HISTORY_TOOL_ACTIVITIES) : []);
      // Keep one selected turn at a time. Its native IDs/order/timestamps seed
      // the same merge contract as the compatibility full-history reader.
      turn.items = items;
      const native = [];
      for (const [index, item] of items.entries()) {
        const message = historyMessageFromItem(item, turn, index, sessionId, { includeToolActivity: toolIndexes.has(index) });
        if (message) native.push({ ...message, turn_status: turn.status });
      }
      const failure = codexTurnFailureMessage(turn);
      if (failure) native.push(failure);
      collabItems.push(...threadCollabMetadata([turn]));
      seed.unshift(...native);
      turns.unshift(...compactHistoryQuestionTurns([turn]));
      turnCursors.set(turn.id, cursor);
      // Raw source metadata carries exact completion dates and image outputs
      // absent from native display items. Read only the selected lifecycle
      // range, preserving offset references instead of retaining image bodies.
      const raw = rawSeed.filter(message =>
        message.role !== 'user' || !seed.length || message.turn_id === latestTurnId ||
        seed.some(existing => existing.role === 'user' && existing.turn_id === message.turn_id && existing.content === message.content));
      merged = mergeProjectedHistory(seed, raw);
      moveRolloutImagesToFinalAnswers(merged);
      // Raw supplements can supply standalone image messages. Their lifecycle
      // state still comes from the native turn, rather than an absent page.
      for (const message of merged) {
        const status = message.turn_id === turn.id ? turn.status : seed.find(value => value.turn_id === message.turn_id)?.turn_status;
        if (status) message.turn_status = status;
        if (status && status !== 'inProgress' && message.tool_activity_status === 'running')
          message.tool_activity_status = status === 'failed' ? 'failed' : 'completed';
      }
      try { page = paginateHistory(merged, { limit, before, maxBytes }); }
      catch (error) {
        if (error.message !== 'History cursor is no longer valid.' || !current.next) throw error;
      }
      if (page?.has_more || !current.next) break;
      cursor = current.next;
      current = await readTurn(cursor);
    }
    page ??= paginateHistory([], { limit, before, maxBytes });
    const finalFingerprint = fingerprint ? await historyFileFingerprint(path) : null;
    if (fingerprint && finalFingerprint !== fingerprint) {
      const initial = fingerprint.split(':'), final = finalFingerprint?.split(':');
      if (!final || initial[0] !== final[0] || initial[1] !== final[1] || Number(final[2]) <= Number(initial[2]))
        throw new Error('Codex history source changed during read. Retry history.');
      await validateNativeHistorySnapshot(path, validationRanges, fingerprint, deadline);
    }
    const latestExternalTerminal = externalTerminalFor(latestTurnId);
    if (newest.turn && latestExternalTerminal) {
      newest.turn.status = latestExternalTerminal;
      latestSourceKnown = true;
      for (const turn of turns) if (turn.id === latestTurnId) turn.status = latestExternalTerminal;
      for (const message of page.messages) if (message.turn_id === latestTurnId) {
        message.turn_status = latestExternalTerminal;
        if (message.tool_activity_status === 'running')
          message.tool_activity_status = latestExternalTerminal === 'failed' ? 'failed' : 'completed';
      }
    }
    // Only after source identity/range validation may a persisted terminal
    // retire the matching live writer, including a durable turn_aborted.
    if (latestPersistedLifecycle) this.reconcilePersistedRuntime(sessionId, latestPersistedLifecycle,
      { complete: finalFingerprint === fingerprint });
    this.rememberNativeHistoryThread({ ...thread, ...(newest.turn ? { turns: [newest.turn] } : {}) }, {
      turnsAuthoritative: Boolean(newest.turn) && (!reconcileExternal || latestSourceKnown), runtimeRevision,
    });
    if (page.has_more) {
      const first = page.messages[0];
      const source = turnSources.get(first.turn_id);
      page.next_cursor = Buffer.from(JSON.stringify({
        v: 2, session_id: sessionId, before_id: first.id, turn_id: first.turn_id ?? null,
        after_ids: page.messages.slice(1).filter(message => message.kind !== 'tool_activity').slice(0, 8).map(message => message.id),
        native_turn_cursor: turnCursors.get(first.turn_id),
        ...(source ? { source_end_offset: source.endOffset, source_fingerprint: fingerprint,
          source_end_length: source.endBoundary?.length ?? 0, source_end_digest: source.endBoundary?.digest ?? null } : {}),
      })).toString('base64url');
    }
    if (!before && this.handlers) {
      await this.asyncQuestions.settleHistory(sessionId, turns, await this.rootSessionIdForThread(thread) ?? sessionId);
      for (const { source, status } of sourceQuestions)
        if (!['interrupted', 'failed'].includes(source.turnId === latestTurnId ? newest.turn.status : status))
          await this.asyncQuestions.observe(sessionId, source, { cwd: thread.cwd, rootSessionId: await this.rootSessionIdForThread(thread) ?? sessionId });
    }
    const remembered = this.threadMetadata.get(sessionId);
    const compactCollab = threadCollabMetadata([{ items: [...(remembered?.relayCollabItems ?? []), ...collabItems] }]);
    if (remembered) remembered.relayCollabItems = compactCollab;
    const rootSessionId = await this.rootSessionIdForThread(thread) ?? thread.id;
    const descendants = await this.listDescendants(rootSessionId, { request }).catch(error => { rethrowFileAccessError(error); return []; });
    const agentDetails = includeAgentDetails ? await this.loadAgentDetails(descendants, { request, strictFileAccess: true }) : new Map();
    if (Date.now() >= deadline) throw new Error('Codex history read timed out.');
    const result = {
      ...page,
      agents: buildAgentSnapshot({ rootSessionId, rootThread: thread, descendants, collabItems: compactCollab, agentDetails }),
      sessions: descendants.map(descendant => ({
        ...this.toRelaySession(descendant, thread.cwd || this.workspace), is_subagent: true,
        parent_thread_id: descendant.parentThreadId ?? null, root_session_id: rootSessionId, agent_role: descendant.agentRole ?? null,
      })),
    };
    this.nativeHistoryReadMetrics = { itemPages, selectedTurns: turnCursors.size, sourceRecords, sourceBytes,
      sourceRangeBytes, sourceScanBytes, sourceFoldBytes };
    if (!before && !includeAgentDetails && fingerprint && fingerprint === finalFingerprint &&
        runtimeRevision === (this.threadRuntimeRevisions.get(sessionId) ?? 0) &&
        fingerprint === await historyFileFingerprint(path)) {
      const bytes = Buffer.byteLength(JSON.stringify(result));
      if (bytes <= 16 * 1024 * 1024) {
        this.historyPages.delete(sessionId);
        while (this.historyPages.size && (this.historyPages.size >= 8 ||
          [...this.historyPages.values()].reduce((sum, cached) => sum + cached.bytes, bytes) > 16 * 1024 * 1024))
          this.historyPages.delete(this.historyPages.keys().next().value);
        this.historyPages.set(sessionId, { native: true, path, fingerprint, bytes,
          latestTurnId, latestTurnStatus: latestProviderStatus,
          key: JSON.stringify({ limit, maxBytes }), createdAt: Date.now(), page: structuredClone(result) });
      }
    }
    return result;
  }

  rememberNativeHistoryThread(thread, options) {
    const collab = this.threadMetadata.get(thread.id)?.relayCollabItems;
    this.rememberThread(thread, options);
    // notLoaded metadata establishes lifecycle, not absence of older spawn
    // items. Preserve the already compacted bounded agent directory.
    if (collab?.length) this.threadMetadata.get(thread.id).relayCollabItems = collab;
  }

  async readIndexedHistory({ sessionId, thread, projection, limit, before, includeAgentDetails, maxBytes }) {
    const turns = projection.turns;
    const seededTurns = projection.providerSeed?.turns ?? [];
    const questionTurns = [...seededTurns, ...turns].map(turn => ({ ...turn,
      status: projection.statuses.get(turn.id) ?? turn.status }));
    if (!before && this.handlers) {
      await this.asyncQuestions.settleHistory(sessionId, questionTurns, await this.rootSessionIdForThread(thread) ?? sessionId);
      for (const source of projection.lifecycle.asyncQuestions?.values() ?? []) {
        if (source.accepted && !['interrupted', 'failed'].includes(projection.statuses.get(source.turnId)))
          await this.asyncQuestions.observe(sessionId, source, { cwd: thread.cwd,
            rootSessionId: await this.rootSessionIdForThread(thread) ?? sessionId });
      }
    }
    const projected = projection.messages.filter(message =>
      (projection.messageOffsets.get(message.id) ?? -1) >= (projection.seedOffset ?? 0));
    const messages = mergeProjectedHistory(projection.providerSeed?.messages ?? [], projected, { preserveDistinctIds: true });
    const toolTurnId = (projection.lastLifecycleOffset ?? -1) >= (projection.seedOffset ?? 0)
      ? projection.lifecycle.currentTurnId : projection.lastProviderTurnId;
    if (toolTurnId) {
      const latestTools = messages.filter(message => message.kind === 'tool_activity' &&
        message.turn_id === toolTurnId).slice(-MAX_HISTORY_TOOL_ACTIVITIES);
      const retainedTools = new Set(latestTools.map(message => message.id));
      for (let index = messages.length - 1; index >= 0; index -= 1)
        if (messages[index].kind === 'tool_activity' && !retainedTools.has(messages[index].id)) messages.splice(index, 1);
    }
    for (const message of messages) {
      const status = projection.statuses.get(message.turn_id);
      if (status) message.turn_status = status;
      if (status && status !== 'inProgress' && message.tool_activity_status === 'running')
        message.tool_activity_status = status === 'failed' ? 'failed' : 'completed';
    }
    moveRolloutImagesToFinalAnswers(messages);
    const rootSessionId = await this.rootSessionIdForThread(thread) ?? thread.id;
    const descendants = await this.listDescendants(rootSessionId).catch(() => []);
    const agentDetails = includeAgentDetails ? await this.loadAgentDetails(descendants) : new Map();
    const collabItems = [...(projection.providerSeed?.collabItems ?? []), ...projection.collabItems];
    const metadata = {
      agents: buildAgentSnapshot({ rootSessionId, rootThread: thread, descendants, collabItems, agentDetails }),
      sessions: descendants.map(descendant => ({
        ...this.toRelaySession(descendant, thread.cwd || this.workspace), is_subagent: true,
        parent_thread_id: descendant.parentThreadId ?? null, root_session_id: rootSessionId,
        agent_role: descendant.agentRole ?? null,
      })),
    };
    return { ...metadata, ...paginateHistory(messages, { limit, before, maxBytes }) };
  }

  refreshHistoryPermissions(sessionId) {
    if (this.closed || this.historyPermissionRefreshes.has(sessionId) ||
        Date.now() - (this.permissionRefreshAt.get(sessionId) ?? 0) < 30_000) return;
    const operation = this.refreshPermissions(sessionId).catch(() => {}).finally(() => {
      this.historyPermissionRefreshes.delete(sessionId);
    });
    this.historyPermissionRefreshes.set(sessionId, operation);
  }

  async readAgents({ sessionId }) {
    const result = this.threadMetadata.get(sessionId) ??
      await this.request('thread/read', { threadId: sessionId, includeTurns: false });
    const thread = result.thread ?? result;
    const rootSessionId = await this.rootSessionIdForThread(thread);
    if (!rootSessionId) return [];
    const descendants = await this.listDescendants(rootSessionId);
    await this.syncExternalRolloutActivity(descendants);
    const agentDetails = await this.loadAgentDetails(descendants);
    const collabItems = thread.relayCollabItems ?? threadCollabMetadata(thread.turns);
    return buildAgentSnapshot({ rootSessionId, rootThread: thread, descendants, collabItems, agentDetails });
  }

  async readThreadHistoryWithRetry(sessionId, { includeTurns = true } = {}) {
    let lastError;
    for (let attempt = 0; attempt < CODEX_HISTORY_READ_ATTEMPTS; attempt += 1) {
      try {
        return await this.request("thread/read", {
          threadId: sessionId,
          includeTurns,
        }, { timeoutMs: CODEX_HISTORY_RPC_TIMEOUT_MS });
      } catch (error) {
        rethrowFileAccessError(error);
        if (
          /is not materialized yet; includeTurns is unavailable before first user message/.test(
            error?.message ?? "",
          )
        ) {
          return { historyNotMaterialized: true };
        }
        lastError = error;
        if (attempt + 1 < CODEX_HISTORY_READ_ATTEMPTS) {
          await delay(CODEX_HISTORY_RETRY_DELAY_MS * (attempt + 1));
        }
      }
    }
    throw lastError;
  }

  async recoverRolloutThread(sessionId, { requireFile = false } = {}) {
    const runtimeRevision = this.threadRuntimeRevisions.get(sessionId) ?? 0;
    let fresh;
    try {
      const result = await this.readThreadHistoryWithRetry(sessionId, { includeTurns: false });
      fresh = result.thread ?? result;
      if (fresh.id !== sessionId) throw new Error('Codex history source does not match this conversation.');
    } catch (error) {
      if (!isMissingRolloutError(error)) throw error;
    }
    const replacement = await findReplacementRollout(this.codexSessionsRoot, sessionId, fresh?.path);
    if (!replacement) {
      // Modern provider-backed history may remain available without a JSONL.
      if (fresh && !requireFile) {
        this.recoveredRolloutPaths.delete(sessionId);
        this.rememberThread({ ...fresh, path: fresh.path ?? null }, { runtimeRevision });
        return { thread: fresh };
      }
      throw new Error('找不到此 Codex 会话的历史文件，无法安全恢复。请确认会话仍在原电脑的 Codex 中。');
    }
    const thread = { ...this.threadMetadata.get(sessionId), ...fresh, id: sessionId,
      path: replacement.path, ...(fresh?.cwd ? {} : { cwd: replacement.owner.cwd }) };
    this.historyPages.delete(sessionId);
    this.nativeHistorySourceFallbacks.delete(sessionId);
    if (this.recoveredRolloutPaths.size >= 300)
      this.recoveredRolloutPaths.delete(this.recoveredRolloutPaths.keys().next().value);
    this.recoveredRolloutPaths.set(sessionId, replacement.path);
    this.rememberThread(thread, { runtimeRevision });
    return { thread };
  }

  async resumeRolloutParams(sessionId) {
    const path = this.threadMetadata.get(sessionId)?.path;
    try {
      const recovered = path && this.recoveredRolloutPaths.get(sessionId) === path;
      const permissions = await resumePermissionsFromRollout(path, recovered ? { sessionId, requirePolicy: true } : {});
      return { ...(recovered ? { path } : {}), ...permissions };
    }
    catch (error) {
      if (!isMissingRolloutError(error)) throw error;
      const { thread } = await this.recoverRolloutThread(sessionId, { requireFile: true });
      if (!thread.path?.endsWith('.jsonl'))
        throw new Error('无法确认此 Codex 会话原有的权限设置，请在 Codex 中打开后重试。');
      // The native path override bypasses a stale provider path index. Its first
      // header was checked above because resume by path can ignore threadId.
      return { path: thread.path,
        ...await resumePermissionsFromRollout(thread.path, { sessionId, requirePolicy: true }) };
    }
  }

  async resumeThreadFromRollout(sessionId) {
    const params = await this.resumeRolloutParams(sessionId);
    const result = await this.request('thread/resume', {
      threadId: sessionId, persistExtendedHistory: true, ...params,
    });
    if (params.path && result.thread?.id !== sessionId)
      throw new Error('Codex resumed a different conversation; message was not sent.');
    return result;
  }

  serializeControl(sessionId, operation) {
    const previous = this.sessionControls.get(sessionId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.sessionControls.set(sessionId, next);
    void next.finally(() => {
      if (this.sessionControls.get(sessionId) === next) this.sessionControls.delete(sessionId);
    }).catch(() => {});
    return next;
  }

  submitMessage(options) {
    return this.serializeControl(options.sessionId, () => this.submitMessageUnlocked(options));
  }

  async submitMessageUnlocked({
    action = "message",
    expectedTurnId,
    interruptRunning = false,
    sessionId,
    requestId,
    clientMessageId,
    content,
    attachments = [],
    runtimeSettings,
  }) {
    if (action === "continue") return this.continueMessageUnlocked({ sessionId, requestId,
      clientMessageId, expectedTurnId, content, attachments, runtimeSettings, interruptRunning });
    if (action !== "message") throw new Error("Invalid Codex message action.");
    // Validate before stopping an active turn or acquiring a writer.
    const requestedSettings = runtimeSettings === undefined
      ? null : await this.validateMessageSettings(runtimeSettings, sessionId);
    const input = [
      ...(content ? [{ type: "text", text: content, text_elements: [] }] : []),
      ...attachments.map((attachment) => ({
        type: "image",
        url: attachment.dataUrl,
      })),
    ];
    const clientUserMessageId = clientMessageId ?? requestId ?? createId("msg");
    if (!this.resumedThreads.has(sessionId)) {
      // Desktop ownership can be confirmed without resuming its thread. Keep
      // dormant/unsupported clients on the existing explicit-send fallback.
      const desktopOwner = await this.readDesktopPermissions(sessionId, undefined, {
        ownershipOnly: true,
        timeoutMs: 1_000,
      }).then(() => true, () => false);
      if (desktopOwner) {
        if (interruptRunning) {
          await this.interruptDesktopTurn(sessionId);
          const result = await this.startDesktopMessage(sessionId, {
            input, clientMessageId: clientUserMessageId,
            ...(requestedSettings ? { runtimeSettings: requestedSettings } : {}),
          });
          if (requestedSettings) this.replaceThreadSettings(sessionId, {
            ...this.threadSettings(sessionId),
            ...(requestedSettings.model ? {model: requestedSettings.model} : {}),
            ...(requestedSettings.effort ? {effort: requestedSettings.effort} : {}),
          });
          if (requestedSettings?.permissions) await this.refreshPermissions(sessionId);
          return result;
        }
        if (requestedSettings) throw new Error("Codex message settings require starting a new turn.");
        const delivery = await this.submitDesktopMessage(sessionId, {
          input, content, clientMessageId: clientUserMessageId,
        });
        if (delivery.accepted) return { mode: "steered", turnId: null, persisted: false,
          syncVerifiedAt: new Date().toISOString() };
        return this.queueTracker.enqueue({ sessionId, requestId, clientMessageId: clientUserMessageId, input });
      }
      let resumed;
      try {
        resumed = await this.resumeThreadFromRollout(sessionId);
      } catch (error) {
        if (!isActiveWriterError(error)) throw error;
        // Native queue items cannot carry runtime settings. Never silently drop them.
        if (requestedSettings) throw new Error("无法将所选设置应用到电脑端会话，请打开 Codex 电脑版后重试。");
        return this.queueTracker.enqueue({ sessionId, requestId, clientMessageId: clientUserMessageId, input });
      }
      if (resumed.thread) {
        this.rememberThread(resumed.thread, { turnsAuthoritative: true });
      }
      this.rememberThreadSettingsFromResponse(sessionId, resumed);
      this.resumedThreads.add(sessionId);
      await this.recoverActiveTurn(sessionId, resumed.thread);
    }
    const {permissions: requestedPermissionMode, ...modelSettings} = requestedSettings ?? {};
    const currentPermissions = this.threadPermissions.get(sessionId);
    if (requestedPermissionMode && !currentPermissions) {
      throw new Error("尚未确认电脑端权限，请刷新会话后重试。");
    }
    const permissionOverrides = requestedPermissionMode ? permissionSettings(
      requestedPermissionMode, currentPermissions, this.sessionCwds.get(sessionId) ?? this.workspace,
    ) : {};
    if (interruptRunning && this.activeTurns.has(sessionId)) {
      await this.interruptOwnedTurn(sessionId);
    }
    const activeTurnId = this.activeTurns.get(sessionId);
    if (activeTurnId) {
      if (requestedSettings) throw new Error("Codex message settings require starting a new turn.");
      this.rememberPersistenceCheck(activeTurnId, {
        sessionId,
        requestId,
        content,
        clientMessageId: clientUserMessageId,
      });
      await this.request("turn/steer", {
        threadId: sessionId,
        expectedTurnId: activeTurnId,
        input,
        clientUserMessageId,
      });
      await this.handlers.emitEvent(sessionId, {
        kind: "turn.steered",
        turn_id: activeTurnId,
        text: content,
      });
      const persisted = attachments.length
        ? true
        : await this.verifyUserMessage({
            sessionId,
            content,
            clientMessageId: clientUserMessageId,
          });
      if (persisted) this.forgetPersistenceCheck(activeTurnId, requestId);
      return {
        mode: "steered",
        turnId: activeTurnId,
        persisted,
        syncVerifiedAt: new Date().toISOString(),
      };
    }
    const result = await this.request("turn/start", {
      threadId: sessionId,
      cwd: this.sessionCwds.get(sessionId) ?? this.workspace,
      input,
      clientUserMessageId,
      ...this.turnSettingsParams(sessionId),
      ...modelSettings,
      ...permissionOverrides,
    });
    if (requestedSettings) this.replaceThreadSettings(sessionId, {
      ...this.threadSettings(sessionId), ...modelSettings,
    });
    const turnId = result.turn?.id ?? null;
    if (turnId) {
      this.activeTurns.set(sessionId, turnId);
      this.liveTurns.set(sessionId, turnId);
      this.activeTurnStartedAt.set(sessionId, normalizeTimestamp(result.turn?.startedAt ?? Date.now()));
    }
    if (turnId) {
      this.rememberPersistenceCheck(turnId, {
        sessionId,
        requestId,
        content,
        clientMessageId: clientUserMessageId,
      });
    }
    const persisted = attachments.length
      ? true
      : await this.verifyUserMessage({
          sessionId,
          content,
          clientMessageId: clientUserMessageId,
        });
    if (persisted && turnId) this.forgetPersistenceCheck(turnId, requestId);
    return {
      mode: "started",
      turnId,
      persisted,
      syncVerifiedAt: new Date().toISOString(),
    };
  }

  continueTurnId(sessionId) {
    const rollout = this.externalRolloutTails.get(sessionId);
    if (this.liveTurns.has(sessionId) || this.activeTurns.has(sessionId) ||
        rollout?.activeTurnId || rollout?.caughtUp === false ||
        this.threadMetadata.get(sessionId)?.status?.type === 'active' ||
        [...this.pendingApprovals.values()].some(value => value.sessionId === sessionId) ||
        [...this.asyncQuestions.entries.values()].some(value => value.sessionId === sessionId &&
          ['pending', 'sending', 'unconfirmed'].includes(value.state))) return null;
    const source = this.continueLifecycle.get(sessionId);
    if (source) return source.continuable || source.status === 'interrupted' ? source.turnId : null;
    return rollout?.lifecycleKnown && rollout.caughtUp === true && !rollout.activeTurnId &&
      (rollout.terminalTurnStatuses?.get(rollout.currentTurnId) === 'interrupted' ||
        rollout.terminalTurnContinuations?.get(rollout.currentTurnId) === true)
      ? rollout.currentTurnId : null;
  }

  async continueMessageUnlocked({ sessionId, requestId, clientMessageId, expectedTurnId,
    content, attachments, runtimeSettings, interruptRunning }) {
    if (typeof expectedTurnId !== 'string' || !expectedTurnId || expectedTurnId.length > 2048 ||
        (content !== undefined && content !== '') || attachments.length ||
        runtimeSettings !== undefined || interruptRunning) throw new Error('Invalid Codex continue action.');
    const assertCurrent = () => {
      if (this.continueTurnId(sessionId) !== expectedTurnId)
        throw new Error('Codex interrupted task changed; refresh before continuing.');
    };
    assertCurrent();
    const metadata = this.threadMetadata.get(sessionId);
    if (metadata?.path?.endsWith('.jsonl')) await this.pollExternalRolloutActivity(metadata);
    assertCurrent();
    const clientUserMessageId = clientMessageId ?? requestId ?? createId('msg');
    let result;
    if (!this.resumedThreads.has(sessionId)) {
      const runtime = await this.readDesktopRuntime(sessionId);
      assertCurrent();
      if (runtime.type === 'idle') {
        result = await this.startDesktopMessage(sessionId, { input: [], clientMessageId: clientUserMessageId,
          expectedTurnId, turnTrigger: 'resume_interrupted_task' });
      } else if (runtime.type === 'notOwned') {
        // Only this explicit user action may acquire an unowned writer. Never
        // queue or retry takeover when Desktop owns the conversation.
        const resumed = await this.resumeThreadFromRollout(sessionId);
        this.resumedThreads.add(sessionId);
        if (resumed.thread) this.rememberThread(resumed.thread, { turnsAuthoritative: true });
        this.rememberThreadSettingsFromResponse(sessionId, resumed);
      } else throw new Error('Codex is not idle; task was not continued.');
    }
    if (!result) {
      const revision = this.threadRuntimeRevisions.get(sessionId) ?? 0;
      const read = await this.request('thread/read', { threadId: sessionId, includeTurns: true });
      if (read.thread?.id !== sessionId) throw new Error('Codex continue state could not be confirmed.');
      this.rememberThread(read.thread, { turnsAuthoritative: true, runtimeRevision: revision });
      assertCurrent();
      result = await this.request('turn/start', { threadId: sessionId,
        cwd: this.sessionCwds.get(sessionId) ?? this.workspace, input: [],
        clientUserMessageId, turnTrigger: 'resume_interrupted_task', ...this.turnSettingsParams(sessionId) });
    }
    const turnId = result.turn?.id ?? result.turnId;
    if (!turnId) throw new Error('Codex continue acceptance could not be confirmed.');
    // An empty native turn has no userMessage to verify. The returned turn ID
    // acknowledges execution acceptance, never transcript persistence.
    const observed = this.continueLifecycle.get(sessionId);
    if (observed?.turnId !== turnId || observed.status === 'inProgress') {
      this.continueLifecycle.set(sessionId, { turnId, status: 'inProgress' });
      this.activeTurns.set(sessionId, turnId);
      this.rememberThread({ id: sessionId, status: { type: 'active' } });
    }
    this.advanceThreadRuntimeRevision(sessionId);
    return { action: 'continue', accepted: true, mode: 'started', turnId, persisted: false };
  }

  async validateMessageSettings(settings, sessionId) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings) ||
        Object.keys(settings).some(key => !["model", "effort", "permissions"].includes(key)) ||
        (settings.model === undefined && settings.permissions === undefined) ||
        (settings.model !== undefined && (typeof settings.model !== "string" || !settings.model)) ||
        (settings.effort !== undefined && (typeof settings.effort !== "string" || !settings.model)) ||
        (settings.permissions !== undefined && !CODEX_PERMISSION_MODES.includes(settings.permissions))) {
      throw new Error("Invalid Codex message settings.");
    }
    if (settings.permissions && this.threadMetadata.get(sessionId)?.parentThreadId) {
      throw new Error("仅可为 Codex 主会话预选权限。");
    }
    const result = settings.permissions ? {permissions: settings.permissions} : {};
    if (settings.model === undefined) return result;
    const models = await this.loadModelCatalog();
    const model = models.find(item => item.model === settings.model);
    if (!model) throw new Error("所选 Codex 模型已不可用，请刷新模型列表后重试。");
    const efforts = reasoningOptionsFromModel(model);
    if (settings.effort !== undefined && !efforts.some(item => item.value === settings.effort)) {
      throw new Error("所选 Codex 模型不支持该推理强度，请重新选择。");
    }
    const effort = settings.effort ?? (efforts.length ? advertisedDefaultValue(efforts, null, model.defaultReasoningEffort) : null);
    return { ...result, model: model.model, ...(effort ? { effort } : {}) };
  }

  async refreshPermissions(sessionId) {
    this.permissionRefreshAt.set(sessionId, Date.now());
    try {
      let actual = this.threadPermissions.get(sessionId);
      if (!this.resumedThreads.has(sessionId)) {
        actual = await this.readDesktopPermissions(sessionId);
      }
      // A display-only read must never acquire a writer, including when the
      // Desktop owner is unavailable or our cached settings are missing.
      const permissions = pickPermissions(actual);
      if (!permissions) throw new Error("Missing permission state");
      this.threadPermissions.set(sessionId, permissions);
    } catch {
      this.threadPermissions.delete(sessionId);
    }
    if (this.closed) return;
    await this.handlers?.emitEvent(sessionId, {
      kind: "session.config_updated", config_options: this.configOptionsForThread(sessionId),
    });
  }

  async configurePermissions(sessionId, value) {
    if (this.permissionConfigurations.has(sessionId)) throw new Error("会话权限正在更新，请稍候。");
    this.permissionConfigurations.add(sessionId);
    try {
      return await this.applyPermissions(sessionId, value);
    } finally {
      this.permissionConfigurations.delete(sessionId);
    }
  }

  async applyPermissions(sessionId, value) {
    if (!CODEX_PERMISSION_MODES.includes(value)) throw new Error("Unsupported Codex permission mode.");
    const thread = this.threadMetadata.get(sessionId);
    if (!thread || thread.parentThreadId || this.activeTurns.has(sessionId) || thread.status?.type === "active") {
      throw new Error("请在空闲的 Codex 主会话中切换权限。");
    }
    // This is an explicit settings mutation, unlike history/display reads.
    if (this.resumedThreads.has(sessionId) && !this.threadPermissions.has(sessionId)) {
      const actual = await this.request("thread/resume", { threadId: sessionId });
      this.rememberThreadSettingsFromResponse(sessionId, actual);
    }
    await this.refreshPermissions(sessionId);
    if (this.activeTurns.has(sessionId) || this.threadMetadata.get(sessionId)?.status?.type === "active") {
      throw new Error("Codex 正在运行，请等待任务结束后切换权限。");
    }
    const current = this.threadPermissions.get(sessionId);
    if (!current) throw new Error("尚未确认电脑端权限，请刷新会话后重试。");
    // The app-server emits settings/updated only for a real change. The
    // confirmed current mode already satisfies an idempotent selection.
    if (permissionMode(current) === value) {
      return { configOptions: this.configOptionsForThread(sessionId) };
    }
    const settings = permissionSettings(value, current, thread.cwd || this.workspace);
    let actual;
    try {
      if (this.resumedThreads.has(sessionId)) {
        if (this.permissionUpdateWaiters.has(sessionId)) throw new Error("会话权限正在更新，请稍候。");
        let timer;
        const confirmed = new Promise((resolve, reject) => {
          this.permissionUpdateWaiters.set(sessionId, {resolve, reject});
          timer = setTimeout(() => reject(new Error("未收到电脑端权限确认，请刷新会话后重试。")), 8000);
        });
        try {
          const results = await Promise.all([
            this.request("thread/settings/update", {threadId: sessionId, ...settings}), confirmed,
          ]);
          actual = results[1];
        } finally {
          clearTimeout(timer);
          this.permissionUpdateWaiters.delete(sessionId);
        }
      } else {
        actual = pickPermissions(await this.readDesktopPermissions(sessionId, settings));
      }
      if (!actual) throw new Error("无法确认电脑端权限，请刷新会话后重试。");
      this.threadPermissions.set(sessionId, actual);
      if (permissionMode(actual) !== value) throw new Error("电脑端实际权限与所选模式不同，请刷新查看；本机策略可能限制了此设置。");
      return {configOptions: this.configOptionsForThread(sessionId)};
    } catch (error) {
      this.threadPermissions.delete(sessionId);
      await this.refreshPermissions(sessionId);
      throw error;
    }
  }

  async configureSession({ sessionId, configId, value }) {
    if (configId === "permissions") return this.configurePermissions(sessionId, value);
    if (
      !["model", "reasoning", "speed"].includes(configId) ||
      typeof value !== "string"
    ) {
      throw new Error(`Codex did not advertise the ${configId} setting.`);
    }
    const models = await this.loadModelCatalog();
    const current = this.threadSettings(sessionId);
    let next = { ...current };
    if (configId === "model") {
      if (!models.some((model) => model.model === value)) {
        throw new Error("Codex did not advertise the selected model value.");
      }
      next.model = value;
    } else {
      const currentOptions = this.modelConfigOptions(
        current.model,
        current.effort,
        current.serviceTier,
      );
      const config = currentOptions.find((option) => option.id === configId);
      if (!config) {
        throw new Error(`Codex did not advertise the ${configId} setting.`);
      }
      if (!config.options.some((option) => option.value === value)) {
        throw new Error(
          `Codex did not advertise the selected ${configId} value.`,
        );
      }
      if (configId === "reasoning") next.effort = value;
      else next.serviceTier = value === "default" ? null : value;
    }

    const configOptions = this.modelConfigOptions(
      next.model,
      next.effort,
      next.serviceTier,
    );
    const effective = settingsFromConfigOptions(configOptions);
    const hasSpeedSetting = configOptions.some((option) => option.id === "speed");
    const update = {
      threadId: sessionId,
      ...(effective.model ? { model: effective.model } : {}),
      ...(effective.effort ? { effort: effective.effort } : {}),
      ...(hasSpeedSetting ? { serviceTier: effective.serviceTier } : {}),
    };
    try {
      await this.request("thread/settings/update", update);
    } catch (error) {
      // Catalog/history reads do not load a writer in this app-server. Only an
      // explicit setting change may restore an idle, non-Desktop-owned thread.
      if (!/^thread not found:/i.test(error?.message ?? "") || this.closed) throw error;
      const desktopOwned = await this.readDesktopPermissions(sessionId).then(() => true, () => false);
      if (desktopOwned || this.closed) throw error;
      const resumed = await this.resumeThreadFromRollout(sessionId);
      // An active writer is rejected by resume; never force ownership or alter permissions.
      if (this.closed) throw error;
      if (resumed.thread) this.rememberThread(resumed.thread, { turnsAuthoritative: true });
      this.rememberThreadSettingsFromResponse(sessionId, resumed);
      this.resumedThreads.add(sessionId);
      await this.request("thread/settings/update", update);
    }
    this.replaceThreadSettings(sessionId, effective);
    return {
      configOptions: this.configOptionsForThread(sessionId),
    };
  }

  async loadModelCatalog({ refresh = false } = {}) {
    if (
      this.modelCatalog &&
      (!refresh ||
        Date.now() - this.modelCatalogLoadedAt < this.modelCatalogRefreshMs)
    ) {
      return this.modelCatalog;
    }
    const models = [];
    let cursor = null;
    try {
      do {
        const result = await this.request("model/list", {
          cursor,
          limit: 100,
          includeHidden: false,
        });
        for (const model of result.data ?? []) {
          if (
            model &&
            model.hidden !== true &&
            typeof model.model === "string" &&
            model.model.trim() &&
            !models.some((item) => item.model === model.model)
          ) {
            models.push(model);
          }
        }
        cursor = result.nextCursor ?? null;
      } while (cursor);
    } catch (error) {
      if (this.modelCatalog) return this.modelCatalog;
      throw error;
    }
    this.modelCatalog = models;
    this.modelCatalogLoadedAt = Date.now();
    return models;
  }

  modelConfigOptions(
    currentModel = null,
    currentReasoningEffort = null,
    currentServiceTier = null,
  ) {
    const models = this.modelCatalog ?? [];
    if (!models.length) return [];
    const fallback = models.find((model) => model.isDefault) ?? models[0];
    const selectedModel =
      models.find((model) => model.model === currentModel) ?? fallback;
    const options = [
      {
        type: "select",
        id: "model",
        name: "模型",
        description: "用于此会话后续任务的 Codex 模型。",
        currentValue: selectedModel.model,
        options: models.map((model) => ({
          value: model.model,
          name: model.displayName || model.model,
          description: model.description || null,
          reasoningOptions: reasoningOptionsFromModel(model),
          defaultReasoningEffort: model.defaultReasoningEffort ?? null,
        })),
      },
    ];
    const reasoningOptions = reasoningOptionsFromModel(selectedModel);
    if (reasoningOptions.length) {
      options.push({
        type: "select",
        id: "reasoning",
        name: "推理强度",
        description: "用于此会话后续任务的推理强度。",
        currentValue: advertisedDefaultValue(
          reasoningOptions,
          currentReasoningEffort,
          selectedModel.defaultReasoningEffort,
        ),
        options: reasoningOptions,
      });
    }
    const serviceTierOptions = serviceTierOptionsFromModel(selectedModel);
    if (serviceTierOptions.length) {
      options.push({
        type: "select",
        id: "speed",
        name: "速度",
        description: "用于此会话后续任务的服务速度。",
        currentValue: advertisedDefaultValue(
          serviceTierOptions,
          currentServiceTier,
          selectedModel.defaultServiceTier,
        ),
        options: serviceTierOptions,
      });
    }
    return options;
  }

  threadSettings(sessionId) {
    return {
      model: this.threadModelOverrides.get(sessionId) ?? null,
      effort: this.threadReasoningEffortOverrides.get(sessionId) ?? null,
      serviceTier: this.threadServiceTierOverrides.get(sessionId) ?? null,
    };
  }

  replaceThreadSettings(sessionId, settings) {
    for (const [key, map] of [
      ["model", this.threadModelOverrides],
      ["effort", this.threadReasoningEffortOverrides],
      ["serviceTier", this.threadServiceTierOverrides],
    ]) {
      if (typeof settings[key] === "string" && settings[key]) {
        map.set(sessionId, settings[key]);
      } else {
        map.delete(sessionId);
      }
    }
  }

  rememberThreadSettingsFromResponse(sessionId, result = {}) {
    const permissions = pickPermissions(result);
    if (permissions) this.threadPermissions.set(sessionId, permissions);
    const current = this.threadSettings(sessionId);
    const thread = result.thread ?? {};
    this.replaceThreadSettings(sessionId, {
      model: Object.hasOwn(result, "model")
        ? result.model
        : Object.hasOwn(thread, "model")
          ? thread.model
          : current.model,
      effort: Object.hasOwn(result, "reasoningEffort")
        ? result.reasoningEffort
        : Object.hasOwn(thread, "reasoningEffort")
          ? thread.reasoningEffort
          : Object.hasOwn(thread, "effort")
            ? thread.effort
            : current.effort,
      serviceTier: Object.hasOwn(result, "serviceTier")
        ? result.serviceTier
        : Object.hasOwn(thread, "serviceTier")
          ? thread.serviceTier
          : current.serviceTier,
    });
  }

  configOptionsForThread(sessionId) {
    const settings = this.threadSettings(sessionId);
    const child = this.threadMetadata.get(sessionId);
    const model = settings.model ?? (child?.parentThreadId ? child.model : null);
    const effort = settings.effort ?? (child?.parentThreadId ? child.reasoningEffort : null);
    if (child?.parentThreadId && !model) return [];
    return [...this.modelConfigOptions(
      model,
      effort,
      settings.serviceTier,
    ), permissionConfig(this.threadPermissions.get(sessionId))];
  }

  turnSettingsParams(sessionId) {
    const sticky = this.threadSettings(sessionId);
    if (!this.modelCatalog?.length) {
      return {
        ...(sticky.model ? { model: sticky.model } : {}),
        ...(sticky.effort ? { effort: sticky.effort } : {}),
        ...(sticky.serviceTier ? { serviceTier: sticky.serviceTier } : {}),
      };
    }
    const effective = settingsFromConfigOptions(
      this.modelConfigOptions(
        sticky.model,
        sticky.effort,
        sticky.serviceTier,
      ),
    );
    return {
      ...(sticky.model && effective.model ? { model: effective.model } : {}),
      ...(sticky.effort && effective.effort
        ? { effort: effective.effort }
        : {}),
      ...(sticky.serviceTier && effective.serviceTier
        ? { serviceTier: effective.serviceTier }
        : {}),
    };
  }

  async verifyUserMessage({ sessionId, content, clientMessageId }) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (this.hasObservedUserMessage(sessionId, content, clientMessageId)) {
        return true;
      }
      let result;
      try {
        result = await this.request("thread/read", {
          threadId: sessionId,
          includeTurns: true,
        });
      } catch {
        // turn/start or turn/steer has already accepted the message. A failed
        // read-back is unconfirmed persistence, not a failed send to retry.
        if (this.hasObservedUserMessage(sessionId, content, clientMessageId)) {
          return true;
        }
        if (attempt < 2) await delay(80);
        continue;
      }
      const thread = result.thread ?? result;
      this.rememberThread(thread, { turnsAuthoritative: true });
      const matched = (thread.turns ?? []).some((turn) =>
        (turn.items ?? []).some((item) => {
          if (item.type !== "userMessage") return false;
          if (clientMessageId && item.clientId === clientMessageId) return true;
          return (item.content ?? []).some(
            (part) => part.type === "text" && part.text === content,
          );
        }),
      );
      if (matched) return true;
      if (attempt < 2) await delay(80);
    }
    return verifyUserMessageFromIndependentAppServer({
      codexBin: this.codexBin,
      workspace: this.workspace,
      sessionId,
      content,
      clientMessageId,
    });
  }

  hasObservedUserMessage(sessionId, content, clientMessageId) {
    const observed = this.observedUserMessages.get(sessionId);
    return Boolean(
      observed?.has(`client:${clientMessageId}`) ||
      observed?.has(`text:${content}`),
    );
  }

  rememberPersistenceCheck(turnId, check) {
    const checks = this.pendingPersistenceChecks.get(turnId) ?? [];
    checks.push(check);
    this.pendingPersistenceChecks.set(turnId, checks);
  }

  forgetPersistenceCheck(turnId, requestId) {
    const remaining = (this.pendingPersistenceChecks.get(turnId) ?? []).filter(
      (check) => check.requestId !== requestId,
    );
    if (remaining.length) this.pendingPersistenceChecks.set(turnId, remaining);
    else this.pendingPersistenceChecks.delete(turnId);
  }

  async verifyCompletedTurnPersistence(turnId) {
    const checks = this.pendingPersistenceChecks.get(turnId) ?? [];
    this.pendingPersistenceChecks.delete(turnId);
    for (const check of checks) {
      const persisted = await verifyUserMessageFromIndependentAppServer({
        codexBin: this.codexBin,
        workspace: this.workspace,
        sessionId: check.sessionId,
        content: check.content,
        clientMessageId: check.clientMessageId,
      });
      await this.handlers.emitEvent(check.sessionId, {
        kind: "codex.persisted",
        operation: "turn",
        request_id: check.requestId,
        turn_id: turnId,
        persisted,
        verified_at: new Date().toISOString(),
      });
    }
  }

  interruptTurn({ sessionId }) {
    return this.serializeControl(sessionId, async () => {
      if (!this.resumedThreads.has(sessionId)) {
        return this.interruptDesktopTurn(sessionId);
      }
      return this.interruptOwnedTurn(sessionId);
    });
  }

  async interruptOwnedTurn(sessionId) {
    const turnId = this.activeTurns.get(sessionId);
    if (!turnId) return;
    await this.request("turn/interrupt", { threadId: sessionId, turnId });
    const deadline = Date.now() + 10_000;
    while (this.activeTurns.get(sessionId) === turnId) {
      if (this.closed || Date.now() >= deadline) throw new Error("Codex stop could not be confirmed; new message was not sent.");
      await delay(25);
    }
  }

  async resolveApproval({ approvalId, decision, optionId = null, answer = null }) {
    if (!["approved", "rejected"].includes(decision)) {
      throw new Error("Codex app-server approval decision is invalid.");
    }
    if (approvalId?.startsWith('apr_async_')) return this.asyncQuestions.resolve({ approvalId, decision, optionId, answer });
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending)
      throw new Error("Codex app-server approval is no longer pending.");
    if (pending.method === "item/tool/requestUserInput") {
      return this.resolveCodexUserInput({
        approvalId,
        pending,
        decision,
        optionId,
        answer,
      });
    }
    if (pending.resolution) {
      throw new Error("Codex app-server approval is already being resolved.");
    }
    const selected = selectCodexApprovalOption(
      pending.decisionOptions,
      decision,
      optionId,
    );
    pending.resolution = { relayDecision: decision };
    try {
      if (pending.source === 'desktop') {
        await this.answerDesktopApproval(pending.sessionId, {requestId:pending.rpcId, method:pending.method,
          paramsHash:hashAction(pending.params), decision:selected.response.decision});
        return {confirmation:'serverRequest/resolved'};
      }
      this.respond(pending.rpcId, selected.response);
    } catch (error) {
      pending.resolution = null;
      throw error;
    }
    return { confirmation: "serverRequest/resolved" };
  }

  async resolveCodexUserInput({
    approvalId,
    pending,
    decision,
    optionId,
    answer,
  }) {
    if (pending.resolution) {
      throw new Error("Codex app-server question is already being resolved.");
    }
    if (decision === "rejected") {
      pending.resolution = { relayDecision: decision };
      try {
        this.respond(pending.rpcId, { answers: {} });
      } catch (error) {
        pending.resolution = null;
        throw error;
      }
      return { confirmation: "serverRequest/resolved" };
    }

    const question = pending.questions[pending.questionIndex];
    const value = selectCodexUserInputAnswer(
      question,
      pending.decisionOptions,
      optionId,
      answer,
    );
    const nextAnswers = {
      ...pending.answers,
      [question.id]: { answers: [value] },
    };
    if (pending.questionIndex + 1 < pending.questions.length) {
      this.pendingApprovals.delete(approvalId);
      try {
        await this.requestCodexUserInputQuestion({
          ...pending,
          answers: nextAnswers,
          questionIndex: pending.questionIndex + 1,
          resolution: null,
        });
      } catch (error) {
        this.pendingApprovals.set(approvalId, pending);
        throw error;
      }
      return { confirmation: "immediate" };
    }

    pending.answers = nextAnswers;
    pending.resolution = { relayDecision: decision };
    try {
      this.respond(pending.rpcId, { answers: nextAnswers });
    } catch (error) {
      pending.resolution = null;
      throw error;
    }
    return { confirmation: "serverRequest/resolved" };
  }

  async createAgents({ sessionId, tasks }) {
    await this.submitMessage({
      sessionId,
      content: `请实际创建并行子 Agent，每个任务使用一个独立 Agent；等待全部完成后，只在主线程汇总结果：\n${tasks
        .map((task, index) => `${index + 1}. ${task}`)
        .join("\n")}`,
    });
  }

  async listDescendants(rootSessionId, { request = this.request.bind(this) } = {}) {
    const descendants = [];
    const visited = new Set();
    let cursor = null;
    do {
      if (visited.has(cursor)) throw new Error('Codex descendant cursor did not advance.');
      visited.add(cursor);
      const result = await request("thread/list", {
        ancestorThreadId: rootSessionId,
        limit: 100,
        cursor,
        sortKey: "created_at",
        sortDirection: "asc",
        archived: false,
      }, { timeoutMs: CODEX_HISTORY_RPC_TIMEOUT_MS });
      for (const thread of result.data ?? []) {
        this.rememberThread(thread);
        descendants.push(thread);
      }
      cursor = result.nextCursor ?? null;
    } while (cursor);
    return descendants;
  }

  async loadAgentDetails(descendants, { request = this.request.bind(this), strictFileAccess = false } = {}) {
    const details = new Map();
    // Read every child with bounded concurrency; a fixed prefix leaves older
    // tasks permanently unknown despite their persisted terminal turns.
    for (let offset = 0; offset < descendants.length; offset += 8) {
      await Promise.all(descendants.slice(offset, offset + 8).map(async (thread) => {
        try {
          const fingerprint = thread.path?.endsWith('.jsonl')
            ? await historyFileFingerprint(thread.path).catch(error => {
              if (strictFileAccess) rethrowFileAccessError(error);
              return null;
            }) : null;
          const cacheKey = JSON.stringify([fingerprint, thread.updatedAt, thread.status?.type,
            this.liveTurns.get(thread.id),
            this.threadRuntimeRevisions.get(thread.id) ?? 0]);
          const cached = this.agentDetailCache.get(thread.id);
          if (cached?.key === cacheKey && fingerprint) {
            details.set(thread.id, cached.detail);
            return;
          }
          const result = await request("thread/read", {
            threadId: thread.id,
            includeTurns: true,
          }, { timeoutMs: 4000 });
          const loaded = result.thread ?? result;
          this.rememberThread(loaded);
          const turns = loaded.turns ?? [];
          const messages = turns
            .flatMap((turn) => turn.items ?? [])
            .map((item) => codexAgentMessageText(item))
            .filter(Boolean);
          const latest = turns.at(-1);
          let turnStatus = latest?.status ?? null;
          // Independent readers can materialize a Desktop-owned live turn as
          // interrupted. Only matching persisted lifecycle evidence repairs it.
          if (loaded.status?.type === 'notLoaded' && thread.path?.endsWith('.jsonl') &&
              ['interrupted', 'inProgress'].includes(turnStatus)) {
            const info = await stat(thread.path);
            const lifecycle = await readExternalRolloutLifecycle(thread.path, info.size);
            turnStatus = lifecycle.activeTurnId === latest?.id ? 'inProgress'
              : lifecycle.terminalTurnStatuses?.get(latest?.id) ?? turnStatus;
          }
          if (this.liveTurns.has(thread.id)) turnStatus = 'inProgress';
          const detail = {
            summary: messages.at(-1) ?? null,
            activity: this.threadMetadata.get(thread.id)?.relayAgentActivity ??
              agentActivityFromToolEvent(
                (turns.at(-1)?.items ?? []).map(item => codexToolActivityEventFromItem(item)).filter(Boolean).at(-1),
                loaded.updatedAt ? normalizeTimestamp(loaded.updatedAt) : null,
              ),
            turnStatus,
          };
          details.set(thread.id, detail);
          // Reuse terminal answers only while the source and live-event
          // revision match. Never retain entire child turns or tool outputs.
          if (fingerprint && ['completed', 'failed', 'interrupted'].includes(turnStatus)) {
            const bytes = Buffer.byteLength(JSON.stringify(detail));
            if (bytes <= 64 * 1024) {
              this.agentDetailCache.delete(thread.id);
              while (this.agentDetailCache.size && (this.agentDetailCache.size >= 256 ||
                  [...this.agentDetailCache.values()].reduce((sum, entry) => sum + entry.bytes, bytes) > 2 * 1024 * 1024)) {
                this.agentDetailCache.delete(this.agentDetailCache.keys().next().value);
              }
              this.agentDetailCache.set(thread.id, { key: cacheKey, detail, bytes });
            }
          }
        } catch (error) {
          if (strictFileAccess) rethrowFileAccessError(error);
          // A missing child thread must not prevent the parent history from loading.
          details.set(thread.id, { unavailable: true });
        }
      }));
    }
    return details;
  }

  rememberThread(thread, { turnsAuthoritative = false, runtimeRevision } = {}) {
    if (!thread?.id) return;
    const current = this.threadMetadata.get(thread.id) ?? {};
    const staleRuntime = runtimeRevision !== undefined && runtimeRevision !== (this.threadRuntimeRevisions.get(thread.id) ?? 0);
    // A thread/read response can contain the entire rollout, including tool
    // output and image bodies. Only directory/routing metadata may outlive it.
    const next = { ...threadDirectoryMetadata(current), ...threadDirectoryMetadata(thread) };
    if (staleRuntime) {
      if (current.status) next.status = threadDirectoryMetadata(current).status;
      else delete next.status;
    }
    if (!staleRuntime && turnsAuthoritative && Array.isArray(thread.turns)) {
      if (this.resumedThreads.has(thread.id) && thread.turns.length) {
        const latest = thread.turns.at(-1);
        const live = this.liveTurns.get(thread.id) ?? this.activeTurns.get(thread.id);
        if (!live || live === latest.id) this.continueLifecycle.set(thread.id,
          { turnId: latest.id, status: latest.status, continuable: canContinueCodexTurn(latest) });
      }
      // A non-owner can report a live turn as interrupted; that snapshot cannot
      // retire a live writer. Completed/failed identify a real terminal turn.
      for (const turn of thread.turns) {
        if (['completed', 'failed'].includes(turn?.status)) this.clearTerminalTurn(thread.id, turn.id);
      }
      const latest = thread.turns.at(-1);
      if (['completed', 'failed', 'interrupted'].includes(latest?.status) &&
          !thread.turns.some(turn => turn?.status === 'inProgress') &&
          !this.liveTurns.has(thread.id) && !this.activeTurns.has(thread.id) &&
          !this.externalRolloutTails.get(thread.id)?.activeTurnId) next.status = { type: 'idle' };
    }
    if (!staleRuntime && this.liveTurns.has(thread.id)) next.status = { type: 'active' };
    if (current.relayAgentActivity) next.relayAgentActivity = current.relayAgentActivity;
    next.relayCollabItems = Array.isArray(thread.turns)
      ? threadCollabMetadata(thread.turns)
      : current.relayCollabItems ?? [];
    this.threadMetadata.set(next.id, next);
    // Thread list/read snapshots are metadata, not an authoritative runtime
    // settings source. Older app-server versions may include lagging setting
    // fields here after thread/settings/update. Runtime settings are updated
    // only from configureSession, start/resume responses, or the dedicated
    // thread/settings/updated notification.
    if (next.cwd) this.sessionCwds.set(next.id, next.cwd);
    // A notification received while history awaits is newer than that read's
    // snapshot. Preserve its runtime routing even if persistence still lags.
    if (!staleRuntime) {
      this.syncActiveTurn({ ...thread, id: next.id }, { turnsAuthoritative });
      this.syncRunningStartedAt({ ...next, turns: thread.turns }, { turnsAuthoritative });
    }
  }

  clearTerminalTurn(sessionId, turnId) {
    if (!turnId) return false;
    let cleared = false;
    if (this.liveTurns.get(sessionId) === turnId) {
      this.liveTurns.delete(sessionId);
      cleared = true;
    }
    if (this.activeTurns.get(sessionId) === turnId) {
      this.activeTurns.delete(sessionId);
      this.activeTurnStartedAt.delete(sessionId);
      cleared = true;
    }
    return cleared;
  }

  reconcilePersistedRuntime(sessionId, lifecycle, { complete = true } = {}) {
    if (!lifecycle?.lifecycleKnown) return;
    let changed = false;
    for (const turnId of [this.liveTurns.get(sessionId), this.activeTurns.get(sessionId)]) {
      if (turnId && lifecycle.terminalTurnStatuses?.has(turnId))
        changed = this.clearTerminalTurn(sessionId, turnId) || changed;
    }
    const terminal = lifecycle.currentTurnId && lifecycle.terminalTurnStatuses?.has(lifecycle.currentTurnId);
    if (complete && terminal && !lifecycle.activeTurnId && !this.liveTurns.has(sessionId) && !this.activeTurns.has(sessionId)) {
      const observed = this.continueLifecycle.get(sessionId);
      // A live notification can reach us before its rollout append. Do not
      // replace that newer terminal with a previously persisted interruption.
      if (!observed || observed.turnId === lifecycle.currentTurnId ||
          lifecycle.terminalTurnStatuses.has(observed.turnId)) {
        this.continueLifecycle.set(sessionId, { turnId: lifecycle.currentTurnId,
          status: lifecycle.terminalTurnStatuses.get(lifecycle.currentTurnId),
          continuable: lifecycle.terminalTurnContinuations?.get(lifecycle.currentTurnId) === true });
      }
      if (this.threadMetadata.get(sessionId)?.status?.type === 'active') changed = true;
      this.rememberThread({ id: sessionId, status: { type: 'idle' } });
    }
    if (changed) this.advanceThreadRuntimeRevision(sessionId);
  }

  advanceThreadRuntimeRevision(sessionId) {
    if (!sessionId) return;
    this.threadRuntimeRevisions.set(sessionId, (this.threadRuntimeRevisions.get(sessionId) ?? 0) + 1);
    this.historyPages.delete(sessionId);
  }

  // Rebuild activeTurns from app-server thread state so a relay restart keeps
  // routing new messages to a still-running turn via turn/steer. Only acts on
  // authoritative signals carried by the incoming thread object: an explicit
  // turns list, or a terminal thread status.
  syncActiveTurn(thread, { turnsAuthoritative = false } = {}) {
    if (!thread?.id) return;
    // History/list responses can lag behind the writer (including an idle or
    // interrupted snapshot while a tool is still running). Once a turn has
    // been observed live, only matching terminal evidence can end it.
    if (this.liveTurns.has(thread.id)) {
      this.activeTurns.set(thread.id, detachedMetadataText(this.liveTurns.get(thread.id), Infinity));
      return;
    }
    const statusType = thread.status?.type;
    if (statusType === "idle" || statusType === "systemError") {
      this.activeTurns.delete(thread.id);
      return;
    }
    if (!turnsAuthoritative || !Array.isArray(thread.turns)) return;
    const inProgress = thread.turns.filter(
      (turn) => turn?.status === "inProgress" && turn.id,
    );
    const active = inProgress.at(-1);
    if (active) this.activeTurns.set(thread.id, detachedMetadataText(active.id, Infinity));
    else this.activeTurns.delete(thread.id);
  }

  syncRunningStartedAt(thread, { turnsAuthoritative = false } = {}) {
    if (!thread?.id) return;
    if (!isCodexThreadActive(thread)) {
      this.activeTurnStartedAt.delete(thread.id);
      return;
    }
    const turnStartedAt = turnsAuthoritative
      ? runningTurnStartedAt(thread.turns)
      : null;
    if (turnStartedAt) {
      this.activeTurnStartedAt.set(thread.id, turnStartedAt);
      return;
    }
    if (!this.activeTurnStartedAt.has(thread.id)) {
      this.activeTurnStartedAt.set(
        thread.id,
        normalizeTimestamp(thread.updatedAt ?? thread.createdAt),
      );
    }
  }

  toRelaySession(thread, fallbackWorkspace = this.workspace) {
    const metadata = this.threadMetadata.get(thread.id) ?? thread;
    const session = relaySessionFromThread(metadata, fallbackWorkspace, {
      canInterrupt: this.activeTurns.has(thread.id) || Boolean(this.externalRolloutTails.get(thread.id)?.activeTurnId),
      runningStartedAt: this.activeTurnStartedAt.get(thread.id) ?? null,
    });
    const sticky = this.threadSettings(thread.id);
    const configOptions = this.configOptionsForThread(thread.id);
    const effective = settingsFromConfigOptions(configOptions);
    return {
      ...session,
      continue_turn_id: this.continueTurnId(thread.id),
      capabilities: { continue_supported: true },
      model: sticky.model ?? (metadata.parentThreadId ? metadata.model ?? null : effective.model),
      reasoning_effort: sticky.effort ?? (metadata.parentThreadId ? metadata.reasoningEffort ?? null : effective.effort),
      service_tier: sticky.serviceTier ?? effective.serviceTier,
      session_config_options: configOptions,
      supports_message_model_settings: true,
      supports_message_permission_settings: true,
    };
  }

  // After a restart the resume response may report an active thread without
  // carrying its turns; only thread/read is authoritative for the turn id.
  async recoverActiveTurn(sessionId, thread) {
    if (this.activeTurns.has(sessionId)) return;
    const statusType =
      thread?.status?.type ?? this.threadMetadata.get(sessionId)?.status?.type;
    if (statusType !== "active") return;
    const result = await this.request("thread/read", {
      threadId: sessionId,
      includeTurns: true,
    });
    this.rememberThread(result.thread ?? result, { turnsAuthoritative: true });
  }

  async ensureThread(threadId) {
    if (!threadId) return null;
    const existing = this.threadMetadata.get(threadId);
    if (existing) return existing;
    const pending = this.threadLoads.get(threadId);
    if (pending) return pending;
    const load = this.request("thread/read", {
      threadId,
      includeTurns: false,
    })
      .then((result) => {
        const thread = result.thread ?? result;
        this.rememberThread(thread);
        return thread;
      })
      .catch(() => null)
      .finally(() => this.threadLoads.delete(threadId));
    this.threadLoads.set(threadId, load);
    return load;
  }

  fileAccessLimited() { return this.catalogFileAccessLimited; }

  async syncExternalRolloutActivity(threads) {
    if (!this.handlers) return;
    const candidates = threads
      .filter(
        (thread) =>
          (['notLoaded', 'active'].includes(thread?.status?.type) || this.liveTurns.has(thread?.id) || this.activeTurns.has(thread?.id)) &&
          typeof thread.path === "string" &&
          thread.path.endsWith(".jsonl"),
      )
      .slice(0, MAX_EXTERNAL_ROLLOUTS);
    // The catalog is a moving window. Keep recently observed cursors when a
    // thread temporarily drops out; reseeding would silently consume its reply.
    // Polling stays limited to 16 files and cursor retention stays bounded.
    for (const thread of candidates) {
      const state = this.externalRolloutTails.get(thread.id);
      if (state) {
        this.externalRolloutTails.delete(thread.id);
        this.externalRolloutTails.set(thread.id, state);
      }
    }
    const results = await Promise.allSettled(
      candidates.map((thread) => this.pollExternalRolloutActivity(thread)),
    );
    while (this.externalRolloutTails.size > MAX_EXTERNAL_ROLLOUT_CURSORS) {
      this.externalRolloutTails.delete(this.externalRolloutTails.keys().next().value);
    }
    this.catalogFileAccessLimited = results.some(result =>
      result.status === "rejected" && isFileAccessError(result.reason));
    for (const thread of candidates) {
      const state = this.externalRolloutTails.get(thread.id);
      if (!state?.lifecycleKnown) continue;
      // A bounded prefix is not the latest runtime: later records may contain
      // another turn/start. Keep catalog state until the cursor reaches EOF.
      if (state.caughtUp === false) continue;
      if (typeof state.model === "string" && state.model) {
        this.threadModelOverrides.set(thread.id, state.model);
      }
      const active = Boolean(state.activeTurnId || this.liveTurns.get(thread.id) || this.activeTurns.get(thread.id));
      this.rememberThread({
        id: thread.id,
        status: { type: active ? "active" : "idle" },
      });
      if (active && state.activeStartedAt && !this.liveTurns.has(thread.id)) {
        this.activeTurnStartedAt.set(thread.id, state.activeStartedAt);
      } else if (!active) {
        this.activeTurnStartedAt.delete(thread.id);
      }
    }
  }

  async pollExternalRolloutActivity(thread, { includeDesktopState = true } = {}) {
    this.externalActivityPolls ??= new Map();
    let poll = this.externalActivityPolls.get(thread.id);
    if (!poll) {
      poll = this.pollExternalRolloutActivityOnce(thread).finally(() => {
        this.externalActivityPolls.delete(thread.id);
      });
      this.externalActivityPolls.set(thread.id, poll);
    }
    const source = await poll;
    if (!source || this.closed) return;
    source.state.caughtUp = source.state.offset === source.info.size;
    this.reconcilePersistedRuntime(thread.id, source.state, { complete: source.state.caughtUp });
    // Rollout lifecycle is sufficient to repair a non-owner's interrupted
    // history snapshot. Optional native owner IPC must not delay that body,
    // including when a catalog poll is already waiting on the same owner.
    const desktop = this.refreshExternalDesktopState(thread, source);
    if (includeDesktopState) await desktop;
    else void desktop.catch(() => {});
  }

  refreshExternalDesktopState(thread, { state, info }) {
    this.externalDesktopRefreshes ??= new Map();
    const pending = this.externalDesktopRefreshes.get(thread.id);
    if (pending) return pending;
    const refresh = (async () => {
      if (this.closed || this.externalRolloutTails.get(thread.id) !== state) return;
      await this.reconcileExternalRuntime(thread, state, info);
      if (this.closed || this.externalRolloutTails.get(thread.id) !== state) return;
      await this.syncDesktopApprovals(thread, state);
      if (this.closed || this.externalRolloutTails.get(thread.id) !== state) return;
      await this.syncExternalQuestions(thread, state);
    })().finally(() => this.externalDesktopRefreshes.delete(thread.id));
    this.externalDesktopRefreshes.set(thread.id, refresh);
    return refresh;
  }

  async pollExternalRolloutActivityOnce(thread) {
    let info;
    try {
      info = await stat(thread.path);
    } catch (error) {
      rethrowFileAccessError(error);
      return;
    }
    await this.recoverExternalRolloutAttachments(thread, info);
    let state = this.externalRolloutTails.get(thread.id);
    const sourceIdentity = `${info.dev}:${info.ino}`;
    if (!state || state.path !== thread.path || info.size < state.offset ||
        (state.sourceIdentity && state.sourceIdentity !== sourceIdentity)) {
      const start = Math.max(0, info.size - INITIAL_ROLLOUT_TAIL_BYTES);
      const text =
        info.size > start
          ? await readUtf8FileRange(thread.path, start, info.size - start)
          : "";
      state = {
        path: thread.path,
        sourceIdentity,
        offset: info.size,
        fragment: "",
        currentTurnId: null,
        activeTurnId: null,
        activeStartedAt: null,
        model: null,
        lifecycleKnown: false,
        terminalTurnIds: new Set(),
        pendingCalls: new Map(),
      };
      const lines = completeJsonLines(text, { discardFirst: start > 0 });
      state.fragment = lines.fragment;
      for (const line of lines.records) {
        const record = parseJsonLine(line);
        if (record) codexRolloutActivityEvents(record, state, { seed: true });
      }
      if (!state.lifecycleKnown && start > 0) {
        const lifecycle = await readExternalRolloutLifecycle(
          thread.path,
          info.size,
        );
        if (lifecycle.lifecycleKnown) {
          state.currentTurnId = state.currentTurnId ?? lifecycle.currentTurnId;
          state.activeTurnId = lifecycle.activeTurnId;
          state.activeStartedAt = lifecycle.activeStartedAt;
          state.lifecycleKnown = true;
          state.terminalTurnIds = lifecycle.terminalTurnIds;
          state.terminalTurnStatuses = lifecycle.terminalTurnStatuses;
        }
      }
      this.externalRolloutTails.set(thread.id, state);
      if (!state.activeTurnId) {
        state.pendingCalls.clear();
        state.backgroundCommands?.clear();
      }
      for (const pending of [
        ...state.pendingCalls.values(),
        ...(state.backgroundCommands?.values() ?? []),
      ]) {
        if (pending.terminal) continue;
        if (pending.event.turn_id !== state.activeTurnId) continue;
        if (pending.emitted) continue;
        pending.emitted = true;
        await this.handlers.emitEvent(thread.id, pending.event);
        await this.forwardAgentActivity(thread.id, pending.event, pending.occurredAt);
      }
      await this.syncExternalQuestions(thread, state);
      return { state, info };
    }
    if (info.size === state.offset) {
      await this.syncExternalQuestions(thread, state);
      return { state, info };
    }

    const start = state.offset;
    const length = Math.min(MAX_ROLLOUT_READ_BYTES, info.size - start);
    state.decoder ??= new StringDecoder("utf8");
    const text = await readUtf8FileRange(thread.path, start, length, state.decoder);
    state.offset = start + length;
    const lines = completeJsonLines(`${state.fragment}${text}`);
    state.fragment = lines.fragment;
    for (const line of lines.records) {
      const record = parseJsonLine(line);
      if (!record) continue;
      const events = codexRolloutActivityEvents(record, state, { sessionId: thread.id });
      for (const event of events) {
        const { agent_id: agentId, ...relayEvent } = event;
        if (agentId) {
          const receiver = this.threadMetadata.get(agentId);
          const rootSessionId = await this.rootSessionIdForThread(receiver ?? thread);
          if (!rootSessionId) continue;
          await this.handlers.emitEvent(rootSessionId, {
            ...relayEvent, root_session_id: rootSessionId,
            parent_thread_id: receiver?.parentThreadId ?? thread.id,
          }, { agent_id: agentId });
        } else {
          await this.handlers.emitEvent(thread.id, relayEvent);
          await this.forwardAgentActivity(thread.id, relayEvent, record.timestamp);
        }
      }
    }
    await this.syncExternalQuestions(thread, state);
    return { state, info };
  }

  async syncExternalQuestions(thread, state) {
    for (const entry of [...this.asyncQuestions.entries.values()]) {
      if (entry.sessionId === thread.id && state.terminalTurnIds?.has(entry.turnId))
        await this.asyncQuestions.endTurn(thread.id, entry.turnId, state.terminalTurnStatuses?.get(entry.turnId) ?? 'interrupted');
    }
    for (const source of state.asyncQuestions?.values() ?? []) {
      if (source.accepted && !['interrupted','failed'].includes(state.terminalTurnStatuses?.get(source.turnId)))
        await this.asyncQuestions.observe(thread.id, source, { cwd: thread.cwd ?? this.workspace,
          rootSessionId: await this.rootSessionIdForThread(thread) ?? thread.id });
    }
  }

  async syncDesktopApprovals(thread, state) {
    if (this.resumedThreads.has(thread.id)) return;
    const existing = [...this.pendingApprovals.entries()].filter(([,p]) => p.source === 'desktop' && p.sessionId === thread.id);
    if ((!state.activeTurnId && !existing.length) || Date.now() - (state.desktopApprovalsCheckedAt ?? 0) < 3000) return;
    state.desktopApprovalsCheckedAt = Date.now();
    const requests = await this.readDesktopApprovals(thread.id, {timeoutMs:1500}).catch(() => null);
    if (!requests || this.closed) return;
    const current = new Set();
    for (const request of requests) {
      const id = `apr_desktop_${createHash('sha256').update(JSON.stringify([thread.id,request.params.turnId,request.id])).digest('hex')}`;
      current.add(id);
      if (this.pendingApprovals.has(id)) continue;
      const normalized = approvalFromCodexRequest(request.method, request.params, thread.cwd ?? this.workspace);
      // Native Desktop approvals expose only one-time decisions through Relayune.
      const decisionOptions = normalized.decisionOptions.filter(o => ['accept','decline','cancel'].includes(o.response?.decision));
      if (!decisionOptions.length) continue;
      const action = {...normalized.action, options:publicCodexApprovalOptions(decisionOptions)};
      const pending = {source:'desktop',sessionId:thread.id,rootSessionId:await this.rootSessionIdForThread(thread) ?? thread.id,
        rpcId:request.id,method:request.method,params:request.params,action,decisionOptions,resolution:null};
      this.pendingApprovals.set(id,pending);
      await this.requestCodexApproval(id,pending,action);
    }
    for (const [id,pending] of existing) if (!current.has(id)) {
      this.pendingApprovals.delete(id);
      await this.handlers.emitEvent(pending.rootSessionId,{kind:'approval.resolved',approval_id:id,
        turn_id:pending.params.turnId,decision:pending.resolution?.relayDecision ?? 'expired',command_hash:hashAction(pending.action)});
    }
  }

  async reconcileExternalRuntime(thread, state, info) {
    // An interrupted Desktop process may never append task_complete/turn_aborted.
    // A current owner can settle it. Explicit owner absence also requires a
    // supported-origin rollout and a matching interrupted turn; a non-owner
    // reader or elapsed time alone cannot prove completion. Relayune-created
    // threads retain their originator when later continued in Desktop.
    if (!state.activeTurnId || this.resumedThreads.has(thread.id) ||
        Date.now() - info.mtimeMs < 15_000 ||
        Date.now() - (state.runtimeCheckedAt ?? 0) < 10_000) return;
    state.runtimeCheckedAt = Date.now();
    const turnId = state.activeTurnId;
    const runtime = await this.readDesktopRuntime(thread.id).catch(() => null);
    if (!runtime || this.closed) return;
    if (runtime.type === 'notOwned') {
      const header = await readUtf8FileRange(thread.path, 0, Math.min(info.size, 64 * 1024));
      const meta = completeJsonLines(header).records.map(parseJsonLine)
        .find(record => record?.type === 'session_meta')?.payload;
      if (meta?.id !== thread.id ||
          !['Codex Desktop', 'relayune_local_client'].includes(meta?.originator)) return;
      const result = await this.request('thread/read', { threadId: thread.id, includeTurns: true }).catch(() => null);
      const snapshot = result?.thread ?? result;
      if (snapshot?.id !== thread.id || snapshot?.status?.type === 'active' ||
          snapshot?.turns?.some(turn => turn.status === 'inProgress') ||
          snapshot?.turns?.find(turn => turn.id === turnId)?.status !== 'interrupted') return;
    } else if (!['idle', 'systemError'].includes(runtime.type)) return;
    const latest = await stat(thread.path).catch(() => null);
    if (this.closed || this.resumedThreads.has(thread.id) || !latest || latest.size !== info.size || latest.mtimeMs !== info.mtimeMs ||
        this.externalRolloutTails.get(thread.id) !== state || state.activeTurnId !== turnId) return;
    this.advanceThreadRuntimeRevision(thread.id);
    if (!this.liveTurns.has(thread.id) && this.activeTurns.get(thread.id) === turnId) {
      this.activeTurns.delete(thread.id);
      this.activeTurnStartedAt.delete(thread.id);
    }
    const events = codexRolloutActivityEvents({ type: 'event_msg', payload: {
      type: 'turn_aborted', turn_id: turnId,
      reason: runtime.type === 'systemError' ? 'failed' : 'interrupted',
    } }, state);
    for (const event of events) await this.handlers?.emitEvent(thread.id, event);
  }

  async recoverExternalRolloutAttachments(thread, info) {
    if (
      typeof this.handlers?.registerRecoveredAttachments !== "function" ||
      typeof this.handlers?.readAttachmentCheckpoint !== "function" ||
      typeof this.handlers?.writeAttachmentCheckpoint !== "function"
    ) {
      return;
    }
    const source = `codex-rollout:${thread.path}`;
    const checkpoint = await this.handlers.readAttachmentCheckpoint(source);
    const hasUsableCheckpoint =
      Number.isSafeInteger(checkpoint) && checkpoint >= 0 && checkpoint <= info.size;
    let position = hasUsableCheckpoint
      ? checkpoint
      : Math.max(0, info.size - INITIAL_ATTACHMENT_RECOVERY_BYTES);
    if (position === info.size) return;

    const state = {
      currentTurnId: null,
      activeTurnId: null,
      activeStartedAt: null,
      model: null,
      lifecycleKnown: false,
      terminalTurnIds: new Set(),
      pendingCalls: new Map(),
    };
    let fragment = Buffer.alloc(0);
    let discardFirst = position > 0 && !hasUsableCheckpoint;
    while (position < info.size) {
      const length = Math.min(MAX_ROLLOUT_READ_BYTES, info.size - position);
      const bytes = await readBufferRange(thread.path, position, length);
      if (!bytes.length) break;
      position += bytes.length;
      const combined = fragment.length
        ? Buffer.concat([fragment, bytes])
        : bytes;
      const newline = combined.lastIndexOf(0x0a);
      if (newline < 0) {
        fragment = combined;
        continue;
      }
      let records = combined.subarray(0, newline).toString("utf8").split("\n");
      fragment = combined.subarray(newline + 1);
      if (discardFirst) records.shift();
      discardFirst = false;
      for (const line of records) {
        if (!line) continue;
        const record = parseJsonLine(line);
        if (!record) continue;
        const events = codexRolloutActivityEvents(record, state, {
          sessionId: thread.id,
        });
        for (const event of events) {
          if (!hasRecoverableAttachment(event)) continue;
          await this.handlers.registerRecoveredAttachments(thread.id, event);
        }
      }
    }
    const completeOffset = Math.max(
      0,
      position - fragment.length,
    );
    await this.handlers.writeAttachmentCheckpoint(source, completeOffset);
  }

  async close() {
    this.closed = true;
    this.desktopStatePool.close();
    this.historyPages.clear();
    this.recoveredRolloutPaths.clear();
    this.agentDetailCache.clear();
    this.threadRuntimeRevisions.clear();
    this.nativeHistorySourceFallbacks.clear();
    this.rolloutHistoryIndex.clear();
    this.unpublishedCreatedThreads.clear();
    this.queueTracker.close();
    this.asyncQuestions.entries.clear();
    this.readline?.close();
    this.child?.kill();
    this.child = null;
    this.externalRolloutTails.clear();
    this.localUsageRollouts.clear();
    this.emittedUserMessages.clear();
    this.rejectAll(new Error("Codex app-server adapter closed."));
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (
      process.env.CODEX_RELAY_DEBUG_EVENTS === "1" &&
      (message.method === "thread/started" ||
        message.method === "thread/status/changed" ||
        ["collabagenttoolcall", "subagentmessage", "subagentactivity"].includes(
          normalizeCodexItemType(message.params?.item?.type),
        ))
    ) {
      process.stderr.write(
        `[codex-event] ${JSON.stringify({
          method: message.method,
          threadId:
            message.params?.threadId ?? message.params?.thread?.id ?? null,
          thread: message.params?.thread,
          item: message.params?.item,
          status: message.params?.status,
        })}\n`,
      );
    }
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      void this.handleServerRequest(message);
      return;
    }
    if (message.method) void this.handleNotification(message);
  }

  async handleServerRequest(request) {
    if (!isApprovalRequest(request.method)) {
      this.respondError(
        request.id,
        -32601,
        `Unsupported server request: ${request.method}`,
      );
      return;
    }
    const params = request.params ?? {};
    const sessionId = params.threadId;
    const thread = this.threadMetadata.get(sessionId);
    const rootSessionId = await this.rootSessionIdForThread(thread) ?? sessionId;
    const pending = {
      rpcId: request.id,
      method: request.method,
      params,
      sessionId,
      rootSessionId,
      sourceAgentId: thread?.parentThreadId ? sessionId : null,
      sourceAgentName:
        thread?.agentNickname ??
        thread?.agentRole ??
        (thread?.parentThreadId ? sessionId : null),
      resolution: null,
    };
    if (request.method === "item/tool/requestUserInput") {
      const questions = normalizeCodexUserInputQuestions(params.questions);
      if (!questions.length) {
        this.respond(request.id, { answers: {} });
        return;
      }
      try {
        await this.requestCodexUserInputQuestion({
          ...pending,
          questions,
          questionIndex: 0,
          answers: {},
        });
      } catch {
        this.respondError(
          request.id,
          -32603,
          "Relayune could not publish the Codex question.",
        );
      }
      return;
    }

    let action;
    let decisionOptions;
    try {
      ({ action, decisionOptions } = approvalFromCodexRequest(
        request.method,
        params,
        this.workspace,
      ));
    } catch (error) {
      this.respondError(
        request.id,
        -32602,
        error instanceof Error
          ? error.message
          : "Codex approval payload is unsupported.",
      );
      return;
    }
    const approvalId = `apr_rpc_${request.id}`;
    this.pendingApprovals.set(approvalId, {
      ...pending,
      action,
      decisionOptions,
    });
    try {
      await this.requestCodexApproval(approvalId, pending, action);
    } catch {
      this.respondError(
        request.id,
        -32603,
        "Relayune could not publish the Codex approval.",
      );
    }
  }

  async requestCodexUserInputQuestion(pending) {
    const question = pending.questions[pending.questionIndex];
    const decisionOptions = question.options.map((option, optionIndex) => ({
      option_id: `codex_question_${pending.questionIndex}_${optionIndex}`,
      name: option.label,
      kind: "allow_once",
      value: option.label,
      description: option.description,
    }));
    const action = {
      type: "question.select",
      display: question.question,
      cwd: this.sessionCwds.get(pending.sessionId) ?? this.workspace,
      question_id: question.id,
      header: question.header,
      allows_freeform: question.isOther || decisionOptions.length === 0,
      is_secret: question.isSecret,
      options: decisionOptions.map(({ option_id, name, kind, description }) => ({
        option_id,
        name,
        kind,
        description,
      })),
    };
    const approvalId = `apr_rpc_${pending.rpcId}_q${pending.questionIndex}`;
    this.pendingApprovals.set(approvalId, {
      ...pending,
      action,
      decisionOptions,
    });
    await this.requestCodexApproval(approvalId, pending, action);
  }

  async requestCodexApproval(approvalId, pending, action) {
    try {
      await this.handlers.requestApproval({
        approval_id: approvalId,
        request_id: `rpc_${pending.rpcId}`,
        session_id: pending.sessionId,
        root_session_id: pending.rootSessionId,
        source_thread_id: pending.sessionId,
        source_agent_id: pending.sourceAgentId,
        source_agent_name: pending.sourceAgentName,
        turn_id: pending.params.turnId ?? null,
        action: { ...action, command_hash: hashAction(action) },
        risk_level: action.type === "question.select" ? "medium" : "high",
        requested_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 2 * 60_000).toISOString(),
      });
    } catch (error) {
      this.pendingApprovals.delete(approvalId);
      throw error;
    }
  }

  async handleNotification(notification) {
    const params = notification.params ?? {};
    if (notification.method === "account/updated") {
      this.quotaRevision += 1;
      this.quotaWindows = [];
      this.quotaReadAt = 0;
    }
    if (notification.method === "account/rateLimits/updated") {
      if (!params.rateLimits?.limitId || params.rateLimits.limitId === "codex") {
        this.quotaRevision += 1;
        this.quotaWindows = normalizeCodexQuota(params);
        this.quotaReadAt = Date.now();
      }
      return;
    }
    if (notification.method === "thread/tokenUsage/updated") {
      // This notification is a cumulative thread snapshot. It is only a
      // signal to refresh the account-level daily buckets; summing it would
      // count the same tokens repeatedly.
      this.accountUsageLoadedAt = 0;
      return;
    }
    if (notification.method === "serverRequest/resolved") {
      const entry = [...this.pendingApprovals].find(
        ([, pending]) =>
          pending.rpcId === params.requestId &&
          pending.sessionId === params.threadId,
      );
      if (!entry) return;
      const [approvalId, pending] = entry;
      this.pendingApprovals.delete(approvalId);
      await this.handlers.emitEvent(
        pending.rootSessionId ?? pending.sessionId,
        {
          kind: "approval.resolved",
          approval_id: approvalId,
          decision: pending.resolution?.relayDecision ?? "expired",
          command_hash: hashAction(pending.action),
        },
      );
      return;
    }
    if (notification.method === "thread/started" && params.thread) {
      this.rememberThread(params.thread);
      if (params.thread.parentThreadId) {
        await this.emitAgentThreadEvent(params.thread.id, {
          kind: "agent.started",
          agent_status: statusFromThread(params.thread.status),
        });
      }
      return;
    }
    if (notification.method === "thread/status/changed") {
      this.advanceThreadRuntimeRevision(params.threadId);
      const thread =
        this.threadMetadata.get(params.threadId) ??
        (await this.ensureThread(params.threadId));
      if (thread) {
        // Pass only id + status: spreading the cached thread would replay its
        // stale turns into syncActiveTurn and could resurrect a finished turn.
        this.rememberThread({ id: params.threadId, status: params.status });
        if (thread.parentThreadId) {
          await this.emitAgentThreadEvent(params.threadId, {
            kind: agentKindFromStatus(statusFromThread(params.status)),
            agent_status: statusFromThread(params.status),
          });
        }
      }
      return;
    }
    const sessionId =
      params.threadId ?? params.thread?.id ?? params.turn?.threadId;
    if (!sessionId) return;
    const item = params.item ?? {};
    const turnId = params.turnId ?? params.turn?.id ?? item.turnId ?? null;
    const thread = this.threadMetadata.get(sessionId);
    const isSubagent = Boolean(thread?.parentThreadId);
    switch (notification.method) {
      case "thread/settings/updated": {
        const settings = params.threadSettings ?? {};
        const permissions = pickPermissions(settings);
        if (permissions) {
          this.threadPermissions.set(sessionId, permissions);
          this.permissionUpdateWaiters.get(sessionId)?.resolve(permissions);
        }
        const currentSettings = this.threadSettings(sessionId);
        this.replaceThreadSettings(sessionId, {
          model: Object.hasOwn(settings, "model")
            ? settings.model
            : currentSettings.model,
          effort: Object.hasOwn(settings, "effort")
            ? settings.effort
            : currentSettings.effort,
          serviceTier: Object.hasOwn(settings, "serviceTier")
            ? settings.serviceTier
            : currentSettings.serviceTier,
        });
        if (
          !this.modelCatalog ||
          (typeof settings.model === "string" &&
            settings.model &&
            !this.modelCatalog.some((model) => model.model === settings.model))
        ) {
          await this.loadModelCatalog({
            refresh: Boolean(this.modelCatalog),
          }).catch(() => []);
        }
        const configOptions = this.configOptionsForThread(sessionId);
        const effective = settingsFromConfigOptions(configOptions);
        const sticky = this.threadSettings(sessionId);
        await this.handlers.emitEvent(sessionId, {
          kind: "session.config_updated",
          model: sticky.model ?? effective.model,
          reasoning_effort: sticky.effort ?? effective.effort,
          service_tier: sticky.serviceTier ?? effective.serviceTier,
          config_options: configOptions,
        });
        break;
      }
      case "turn/started":
        this.advanceThreadRuntimeRevision(sessionId);
        this.continueLifecycle.set(sessionId, { turnId, status: 'inProgress' });
        if (turnId) {
          this.activeTurns.set(sessionId, turnId);
          this.liveTurns.set(sessionId, turnId);
        }
        this.activeTurnStartedAt.set(
          sessionId,
          normalizeTimestamp(params.turn?.startedAt ?? Date.now()),
        );
        await this.handlers.emitEvent(sessionId, {
          kind: "turn.started",
          turn_id: turnId,
        });
        if (isSubagent) {
          await this.emitAgentThreadEvent(sessionId, {
            kind: "agent.started",
            agent_status: "running",
          });
        }
        break;
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta":
      case "item/reasoning/summaryPartAdded":
        await this.handlers.emitEvent(sessionId, {
          kind: "turn.thinking", turn_id: turnId, active: true,
        });
        break;
      case "item/agentMessage/delta":
        await this.handlers.emitEvent(sessionId, {
          kind: "message.delta",
          turn_id: turnId,
          item_id: params.itemId ?? item.id ?? null,
          text: adaptCodexFileCitations(params.delta ?? params.text ?? ""),
          message_phase: item.phase ?? params.phase ?? null,
        });
        break;
      case "item/commandExecution/outputDelta":
        await this.handlers.emitEvent(sessionId, {
          kind: "command.output",
          turn_id: turnId,
          item_id: params.itemId ?? item.id ?? null,
          activity_type: "command",
          text: params.delta ?? "",
        });
        break;
      case "item/mcpToolCall/progress":
        await this.handlers.emitEvent(sessionId, {
          kind: "command.output",
          turn_id: turnId,
          item_id: params.itemId ?? item.id ?? null,
          activity_type: "mcp_tool",
          text: params.message ?? "",
        });
        break;
      case "item/fileChange/patchUpdated":
        await this.handlers.emitEvent(sessionId, {
          kind: "command.output",
          turn_id: turnId,
          item_id: params.itemId ?? item.id ?? null,
          activity_type: "file_change",
          activity_count: params.changes?.length ?? null,
          text: "",
        });
        break;
      case "item/started":
        await this.handleItem(sessionId, turnId, item, false);
        break;
      case "item/completed":
        await this.handleItem(sessionId, turnId, item, true);
        break;
      case "turn/completed":
        this.advanceThreadRuntimeRevision(sessionId);
        if (!(this.liveTurns.get(sessionId) ?? this.activeTurns.get(sessionId)) ||
            (this.liveTurns.get(sessionId) ?? this.activeTurns.get(sessionId)) === turnId) {
          const latest = this.continueLifecycle.get(sessionId);
          if (!latest || latest.turnId === turnId) this.continueLifecycle.set(sessionId,
            { turnId, status: params.turn?.status ?? 'completed', continuable: canContinueCodexTurn(params.turn) });
        }
        // Local terminal state must commit even when question reconciliation
        // fails during a disconnected client/transport notification.
        if (this.clearTerminalTurn(sessionId, turnId) && !this.liveTurns.has(sessionId) && !this.activeTurns.has(sessionId))
          this.rememberThread({ id: sessionId, status: { type: 'idle' } });
        await this.asyncQuestions.endTurn(sessionId, turnId, params.turn?.status ?? 'completed');
        await this.handlers.emitEvent(sessionId, {
          kind:
            params.turn?.status === "failed" ? "turn.failed" : "turn.completed",
          turn_id: turnId,
          status: params.turn?.status ?? "completed",
          continue_turn_id: this.continueTurnId(sessionId),
          ...(params.turn?.status === "failed" && codexTurnErrorText(params.turn?.error)
            ? { error: codexTurnErrorText(params.turn.error) } : {}),
        });
        if (isSubagent) {
          const agentStatus = collabStatusFromTurn(params.turn?.status);
          await this.emitAgentThreadEvent(sessionId, {
            kind: agentKindFromStatus(agentStatus),
            agent_status: agentStatus,
            summary: params.turn?.error?.message ?? null,
          });
        }
        await this.verifyCompletedTurnPersistence(turnId);
        break;
      case "turn/diff/updated":
        await this.handlers.emitEvent(sessionId, {
          kind: "file.changed",
          turn_id: turnId,
          diff: params.diff ?? null,
        });
        break;
      case "turn/plan/updated":
        await this.handlers.emitEvent(sessionId, {
          kind: "plan.updated",
          turn_id: turnId,
          explanation: params.explanation ?? null,
          plan: params.plan ?? [],
        });
        break;
    }
  }

  async handleItem(sessionId, turnId, item, completed) {
    if (normalizeCodexItemType(item.type) === "reasoning") {
      await this.handlers.emitEvent(sessionId, {
        kind: "turn.thinking", turn_id: turnId, active: !completed,
      });
      return;
    }
    if (completed && item.type === 'agentMessage' && item.questions?.length) {
      await this.asyncQuestions.observe(sessionId, { itemId: item.id, turnId, questions: item.questions },
        { cwd: this.sessionCwds.get(sessionId) ?? this.workspace, rootSessionId: await this.rootSessionIdForThread(this.threadMetadata.get(sessionId)) ?? sessionId });
    }
    if (normalizeCodexItemType(item.type) === 'usermessage') {
      for (const part of item.content ?? []) await this.asyncQuestions.observeAnswers(sessionId, part.text);
    }
    const thread = this.threadMetadata.get(sessionId);
    const subAgentActivity = subAgentActivityFromItem(item);
    if (subAgentActivity) {
      const receiver = this.threadMetadata.get(subAgentActivity.threadId);
      const sender = thread ?? await this.ensureThread(sessionId);
      const rootSessionId = await this.rootSessionIdForThread(receiver ?? sender);
      if (!rootSessionId) return;
      await this.handlers.emitEvent(
        rootSessionId,
        subAgentActivityEvent(item, {
          rootSessionId,
          parentThreadId:
            receiver?.parentThreadId ?? thread?.id ?? sessionId,
          receiver,
          workspace: receiver?.cwd ?? thread?.cwd ?? this.workspace,
        }),
        { agent_id: subAgentActivity.threadId },
      );
      return;
    }
    if (normalizeCodexItemType(item.type) === "usermessage") {
      const observed = this.observedUserMessages.get(sessionId) ?? new Set();
      const clientMessageId = item.clientId ?? item.client_id ?? null;
      if (clientMessageId) observed.add(`client:${clientMessageId}`);
      for (const part of item.content ?? []) {
        if (part.type === "text" && part.text)
          observed.add(`text:${part.text}`);
      }
      while (observed.size > 200)
        observed.delete(observed.values().next().value);
      this.observedUserMessages.set(sessionId, observed);
      const event = userMessageEventFromCodexItem(item, {
        sessionId,
        turnId,
      });
      if (event) {
        const emitted = this.emittedUserMessages.get(sessionId) ?? new Set();
        const emissionKey =
          event.item_id ??
          event.client_message_id ??
          `${turnId ?? "turn"}:${createHash("sha256")
            .update(event.text)
            .digest("hex")}`;
        if (!emitted.has(emissionKey)) {
          emitted.add(emissionKey);
          while (emitted.size > 200)
            emitted.delete(emitted.values().next().value);
          this.emittedUserMessages.set(sessionId, emitted);
          await this.handlers.emitEvent(sessionId, event);
        }
      }
      return;
    }
    const agentMessageText = codexAgentMessageText(item);
    if (agentMessageText && completed) {
      await this.handlers.emitEvent(sessionId, {
        kind: "message.completed",
        turn_id: turnId,
        item_id: item.id,
        text: agentMessageText,
        message_phase: item.phase ?? null,
      });
      if (thread?.parentThreadId) {
        await this.emitAgentThreadEvent(sessionId, {
          kind: "agent.progress",
          agent_status: "running",
          summary: agentMessageText,
          current_activity: safeActivityText(agentMessageText, 160),
          updated_at: new Date().toISOString(),
        });
      }
      return;
    }
    if (item.type === "plan" && completed) {
      await this.handlers.emitEvent(sessionId, {
        kind: "plan.updated",
        turn_id: turnId,
        item_id: item.id,
        explanation: item.text ?? null,
        plan: [],
      });
      return;
    }
    const toolActivity = codexToolActivityEventFromItem(item, {
      completed,
      turnId,
    });
    if (toolActivity) {
      await this.handlers.emitEvent(sessionId, toolActivity);
      await this.forwardAgentActivity(sessionId, toolActivity);
      if (item.type === "fileChange" && completed) {
        await this.handlers.emitEvent(sessionId, {
          kind: "file.changed",
          turn_id: turnId,
          item_id: item.id,
          changes: item.changes,
        });
      }
      return;
    }
    if (item.type === "collabAgentToolCall") {
      const receivers = item.receiverThreadIds ?? [];
      for (const receiverId of receivers) {
        const receiver = this.threadMetadata.get(receiverId);
        const agentState = item.agentsStates?.[receiverId] ?? {};
        const agentStatus = collabStatusFromToolItem(
          item,
          agentState,
          completed,
        );
        const sender = this.threadMetadata.get(item.senderThreadId) ?? thread ??
          await this.ensureThread(item.senderThreadId ?? sessionId);
        const rootSessionId = await this.rootSessionIdForThread(receiver ?? sender);
        if (!rootSessionId) continue;
        await this.handlers.emitEvent(
          rootSessionId,
          {
            kind: agentKindFromStatus(agentStatus),
            thread_id: receiverId,
            parent_thread_id:
              receiver?.parentThreadId ?? item.senderThreadId ?? sessionId,
            root_session_id: rootSessionId,
            name: agentDisplayName(receiver, receiverId),
            role: receiver?.agentRole ?? null,
            task:
              item.tool === "spawnAgent"
                ? (item.prompt ?? "Codex 子 Agent")
                : undefined,
            agent_status: agentStatus,
            progress: progressFromCollabStatus(agentStatus),
            summary: agentState.message ?? null,
            model: item.model ?? null,
            reasoning_effort: item.reasoningEffort ?? null,
            tool: item.tool,
            tool_call_id: item.id,
            cwd: receiver?.cwd ?? thread?.cwd ?? this.workspace,
            project: basename(receiver?.cwd ?? thread?.cwd ?? this.workspace),
            branch: receiver?.gitInfo?.branch ?? thread?.gitInfo?.branch ?? "—",
          },
          { agent_id: receiverId },
        );
      }
    }
  }

  async forwardAgentActivity(threadId, event, occurredAt = new Date().toISOString()) {
    const thread = this.threadMetadata.get(threadId);
    if (!thread?.parentThreadId) return;
    const activity = agentActivityFromToolEvent(event, occurredAt);
    if (activity) {
      thread.relayAgentActivity = activity;
      await this.emitAgentThreadEvent(threadId, {
        kind: "agent.progress", agent_status: "running", ...activity,
      });
    } else if (event.kind === 'turn.started' || event.kind === 'turn.completed' || event.kind === 'turn.failed') {
      const status = event.kind === 'turn.started' ? 'running' : collabStatusFromTurn(event.status ?? (event.kind === 'turn.failed' ? 'failed' : 'completed'));
      await this.emitAgentThreadEvent(threadId, {
        kind: agentKindFromStatus(status), agent_status: status,
        updated_at: occurredAt,
      });
    } else if (event.kind === 'message.completed' && event.message_phase !== 'analysis') {
      await this.emitAgentThreadEvent(threadId, {
        kind: 'agent.progress', agent_status: 'running', summary: event.text,
        current_activity: safeActivityText(event.text, 160),
        updated_at: occurredAt,
      });
    }
  }

  async rootSessionIdForThread(thread) {
    // Codex persists a child's own sessionId. Root ownership comes from the
    // parentThreadId chain, including after forks and nested delegation.
    let current = this.threadMetadata.get(thread?.id) ?? thread;
    const visited = new Set();
    while (current?.id && !visited.has(current.id)) {
      visited.add(current.id);
      if (!current.parentThreadId) return current.id;
      const parentId = current.parentThreadId;
      current = await this.ensureThread(parentId);
      if (current?.id !== parentId) return null;
    }
    return null;
  }

  async emitAgentThreadEvent(threadId, event) {
    const thread = this.threadMetadata.get(threadId);
    if (!thread?.parentThreadId) return;
    if (event.current_activity) {
      thread.relayAgentActivity = {
        current_activity: event.current_activity,
        updated_at: event.updated_at,
        ...(event.activity_log ? { activity_log: event.activity_log } : {}),
      };
    }
    const rootSessionId = await this.rootSessionIdForThread(thread);
    if (!rootSessionId) return;
    await this.handlers.emitEvent(
      rootSessionId,
      {
        ...event,
        thread_id: thread.id,
        parent_thread_id: thread.parentThreadId,
        root_session_id: rootSessionId,
        name: event.name ?? agentDisplayName(thread, thread.id),
        nickname: thread.agentNickname ?? null,
        model: thread.model ?? event.model ?? null,
        reasoning_effort: thread.reasoningEffort ?? event.reasoning_effort ?? null,
        role: event.role ?? thread.agentRole ?? null,
        progress:
          event.progress ??
          progressFromCollabStatus(event.agent_status ?? "running"),
        cwd: thread.cwd ?? this.workspace,
        project: basename(thread.cwd ?? this.workspace),
        branch: thread.gitInfo?.branch ?? "—",
      },
      { agent_id: thread.id },
    );
  }

  request(method, params, { timeoutMs } = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs ? setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Codex request timed out."));
      }, timeoutMs) : null;
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      try {
        this.child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
      } catch (error) {
        this.pending.get(id)?.reject(error);
        this.pending.delete(id);
      }
    });
  }

  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  respond(id, result) {
    this.child.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  respondError(id, code, message) {
    this.child.stdin.write(
      `${JSON.stringify({ id, error: { code, message } })}\n`,
    );
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function requiresApproval(content) {
  return /部署|发布|删除|环境变量|deploy|delete|sudo|审批/i.test(content);
}

function isActiveWriterError(error) {
  return (
    error instanceof Error &&
    /already has an active writer/i.test(error.message)
  );
}

function commandFor(content) {
  if (/删除|delete/i.test(content)) return "rm -rf ./build-artifact";
  if (/环境变量/i.test(content)) return "printf 'RELAY_URL=…' >> .env.local";
  return "npm run deploy:staging";
}

function isApprovalRequest(method) {
  return (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval" ||
    method === "item/permissions/requestApproval" ||
    method === "item/tool/requestUserInput"
  );
}

function approvalFromCodexRequest(method, params, workspace) {
  let action;
  let decisions;
  if (method === "item/fileChange/requestApproval") {
    action = {
      type: "file.change",
      display: params.reason ?? "Approve file changes",
      cwd: params.grantRoot ?? workspace,
    };
    decisions = ["accept", "acceptForSession", "decline", "cancel"];
  } else if (method === "item/permissions/requestApproval") {
    action = {
      type: "permissions.grant",
      display: codexPermissionApprovalDisplay(params),
      cwd: params.cwd ?? workspace,
    };
    const requested = params.permissions ?? {};
    const decisionOptions = [
      {
        option_id: "codex_permissions_turn",
        name: "Allow for this turn",
        kind: "allow_once",
        relayDecision: "approved",
        response: {
          permissions: requested,
          scope: "turn",
          strictAutoReview: false,
        },
      },
      {
        option_id: "codex_permissions_session",
        name: "Allow for this session",
        kind: "allow_always",
        relayDecision: "approved",
        response: {
          permissions: requested,
          scope: "session",
          strictAutoReview: false,
        },
      },
      {
        option_id: "codex_permissions_decline",
        name: "Reject",
        kind: "reject_once",
        relayDecision: "rejected",
        response: {
          permissions: {},
          scope: "turn",
          strictAutoReview: true,
        },
      },
    ];
    action.options = publicCodexApprovalOptions(decisionOptions);
    return { action, decisionOptions };
  } else {
    action = {
      type: "command.execute",
      display: codexCommandApprovalDisplay(params),
      cwd: params.cwd ?? workspace,
    };
    decisions =
      Array.isArray(params.availableDecisions) &&
      params.availableDecisions.length
        ? params.availableDecisions
        : ["accept", "decline"];
  }

  const decisionOptions = decisions
    .map((candidate, index) => codexDecisionOption(candidate, index))
    .filter(Boolean);
  if (!decisionOptions.length) {
    throw new Error("Codex app-server did not provide a supported decision.");
  }
  action.options = publicCodexApprovalOptions(decisionOptions);
  return { action, decisionOptions };
}

function codexCommandApprovalDisplay(params) {
  const network = params.networkApprovalContext;
  if (network && typeof network === "object" && network.host) {
    const protocol = typeof network.protocol === "string"
      ? `${network.protocol}://`
      : "";
    const port = Number.isInteger(network.port) ? `:${network.port}` : "";
    return `Network access: ${protocol}${network.host}${port}`;
  }
  return params.command ?? params.reason ?? "Command execution";
}

function codexPermissionApprovalDisplay(params) {
  const reason = params.reason ?? "Approve additional permissions";
  try {
    const requested = JSON.stringify(params.permissions ?? {});
    return `${reason}: ${requested}`.slice(0, 2_000);
  } catch {
    return reason;
  }
}

function codexDecisionOption(candidate, index) {
  const optionId = `codex_decision_${index}`;
  if (candidate === "accept") {
    return {
      option_id: optionId,
      name: "Allow once",
      kind: "allow_once",
      relayDecision: "approved",
      response: { decision: "accept" },
    };
  }
  if (candidate === "acceptForSession") {
    return {
      option_id: optionId,
      name: "Always allow in this session",
      kind: "allow_always",
      relayDecision: "approved",
      response: { decision: "acceptForSession" },
    };
  }
  if (candidate === "decline") {
    return {
      option_id: optionId,
      name: "Reject",
      kind: "reject_once",
      relayDecision: "rejected",
      response: { decision: "decline" },
    };
  }
  if (candidate === "cancel") {
    return {
      option_id: optionId,
      name: "Reject and stop the turn",
      kind: "reject_cancel",
      relayDecision: "rejected",
      response: { decision: "cancel" },
    };
  }
  const execpolicy = candidate?.acceptWithExecpolicyAmendment;
  if (
    execpolicy &&
    Array.isArray(execpolicy.execpolicy_amendment) &&
    execpolicy.execpolicy_amendment.every((item) => typeof item === "string")
  ) {
    return {
      option_id: optionId,
      name: "Allow and remember this command rule",
      kind: "allow_policy",
      relayDecision: "approved",
      response: {
        decision: {
          acceptWithExecpolicyAmendment: {
            execpolicy_amendment: [...execpolicy.execpolicy_amendment],
          },
        },
      },
    };
  }
  const network = candidate?.applyNetworkPolicyAmendment
    ?.network_policy_amendment;
  if (
    network &&
    typeof network.host === "string" &&
    ["allow", "deny"].includes(network.action)
  ) {
    const accepted = network.action === "allow";
    return {
      option_id: optionId,
      name: accepted
        ? `Allow and remember ${network.host}`
        : `Reject and remember ${network.host}`,
      kind: accepted ? "allow_policy" : "reject_policy",
      relayDecision: accepted ? "approved" : "rejected",
      response: {
        decision: {
          applyNetworkPolicyAmendment: {
            network_policy_amendment: {
              host: network.host,
              action: network.action,
            },
          },
        },
      },
    };
  }
  return null;
}

function publicCodexApprovalOptions(decisionOptions) {
  return decisionOptions.map(({ option_id, name, kind }) => ({
    option_id,
    name,
    kind,
  }));
}

function selectCodexApprovalOption(options, decision, optionId) {
  const declared = Array.isArray(options) ? options : [];
  const explicit = optionId
    ? declared.find((option) => option.option_id === optionId)
    : null;
  if (optionId && !explicit) {
    throw new Error("Codex app-server approval option is invalid.");
  }
  if (explicit && explicit.relayDecision !== decision) {
    throw new Error("Codex app-server approval option conflicts with the decision.");
  }
  const fallback = declared.find(
    (option) =>
      option.relayDecision === decision &&
      (decision === "approved"
        ? option.kind === "allow_once"
        : option.kind === "reject_once"),
  );
  const selected = explicit ?? fallback ?? declared.find(
    (option) => option.relayDecision === decision,
  );
  if (!selected) {
    throw new Error("Codex app-server does not allow that approval decision.");
  }
  return selected;
}

function normalizeCodexUserInputQuestions(questions) {
  return (Array.isArray(questions) ? questions : [])
    .filter(
      (question) =>
        question &&
        typeof question.id === "string" &&
        question.id &&
        typeof question.header === "string" &&
        typeof question.question === "string" &&
        question.question,
    )
    .slice(0, 3)
    .map((question) => ({
      id: question.id,
      header: question.header.slice(0, 200),
      question: question.question.slice(0, 2_000),
      isOther: Boolean(question.isOther),
      isSecret: Boolean(question.isSecret),
      options: (Array.isArray(question.options) ? question.options : [])
        .filter(
          (option) =>
            option &&
            typeof option.label === "string" &&
            option.label,
        )
        .slice(0, 12)
        .map((option) => ({
          label: option.label.slice(0, 500),
          description:
            typeof option.description === "string"
              ? option.description.slice(0, 1_000)
              : "",
        })),
    }));
}

function selectCodexUserInputAnswer(question, options, optionId, answer) {
  const explicit = optionId
    ? options.find((option) => option.option_id === optionId)
    : null;
  if (optionId && !explicit) {
    throw new Error("Codex app-server question option is invalid.");
  }
  if (explicit) return explicit.value;
  const allowsFreeform = question.isOther || options.length === 0;
  if (
    !allowsFreeform ||
    typeof answer !== "string" ||
    !answer.trim() ||
    answer.length > 4_000
  ) {
    throw new Error("Codex app-server question answer is invalid.");
  }
  return question.isSecret ? answer : answer.trim();
}

function basename(path) {
  return (
    String(path).replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ??
    "workspace"
  );
}

function reasoningOptionsFromModel(model) {
  if (!Array.isArray(model?.supportedReasoningEfforts)) return [];
  const options = [];
  const seen = new Set();
  for (const item of model.supportedReasoningEfforts) {
    const value =
      typeof item === "string" ? item : item?.reasoningEffort;
    if (typeof value !== "string" || !value || seen.has(value)) continue;
    seen.add(value);
    options.push({
      value,
      name:
        typeof item?.name === "string" && item.name ? item.name : value,
      description:
        typeof item?.description === "string" ? item.description : null,
    });
  }
  return options;
}

function serviceTierOptionsFromModel(model) {
  if (!Array.isArray(model?.serviceTiers)) return [];
  const options = [
    {
      value: "default",
      name: "标准",
      description: "标准速度和额度消耗。",
    },
  ];
  const seen = new Set(["default"]);
  for (const tier of model.serviceTiers) {
    const value = tier?.id;
    if (typeof value !== "string" || !value || seen.has(value)) continue;
    seen.add(value);
    options.push({
      value,
      name:
        typeof tier.name === "string" && tier.name ? tier.name : value,
      description:
        typeof tier.description === "string" ? tier.description : null,
    });
  }
  return options;
}

function advertisedDefaultValue(options, currentValue, defaultValue) {
  if (options.some((option) => option.value === currentValue)) {
    return currentValue;
  }
  if (options.some((option) => option.value === defaultValue)) {
    return defaultValue;
  }
  return options[0].value;
}

function settingsFromConfigOptions(configOptions) {
  const currentValue = (id) => {
    const value = configOptions.find((option) => option.id === id)?.currentValue;
    return typeof value === "string" && value ? value : null;
  };
  return {
    model: currentValue("model"),
    effort: currentValue("reasoning"),
    serviceTier:
      currentValue("speed") === "default" ? null : currentValue("speed"),
  };
}

function detachedMetadataText(value, limit = 2048) {
  // A sliced V8 string can keep its entire input alive. Copy the small retained
  // text so a preview cannot pin a full JSON-RPC response or image data URL.
  return Buffer.from(value.slice(0, limit), "utf8").toString("utf8");
}

function threadDirectoryMetadata(thread) {
  const metadata = {};
  for (const key of [
    "id", "path", "cwd", "sessionId", "parentThreadId", "createdAt", "updatedAt", "historyMode",
  ]) {
    const value = thread[key];
    if (Object.hasOwn(thread, key) && (value == null ||
        typeof value === "string" || typeof value === "number")) metadata[key] =
      typeof value === "string" ? detachedMetadataText(value, Infinity) : value;
  }
  for (const key of ["name", "preview", "agentNickname", "agentRole", "model", "reasoningEffort"]) {
    if (Object.hasOwn(thread, key)) metadata[key] = typeof thread[key] === "string"
      ? detachedMetadataText(thread[key]) : null;
  }
  const agentPath = codexAgentPath(thread);
  if (agentPath) metadata.agentPath = detachedMetadataText(agentPath);
  if (Object.hasOwn(thread, "status")) metadata.status = typeof thread.status?.type === "string"
    ? { type: detachedMetadataText(thread.status.type, 64) } : null;
  if (Object.hasOwn(thread, "gitInfo")) metadata.gitInfo = typeof thread.gitInfo?.branch === "string"
    ? { branch: detachedMetadataText(thread.gitInfo.branch) } : null;
  return metadata;
}

// Preserve the agent panel's collaboration metadata without retaining the root
// turn tree. This is bounded even when a provider returns a large prompt/answer.
function threadCollabMetadata(turns) {
  const retained = [];
  let bytes = 2;
  for (let turnIndex = (turns?.length ?? 0) - 1; turnIndex >= 0; turnIndex -= 1) {
    const items = turns[turnIndex].items ?? [];
    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = items[itemIndex];
      const subagent = isSubAgentActivityItem(item);
      if (item.type !== "collabAgentToolCall" && !subagent) continue;
      const receivers = subagent ? [null] : (item.receiverThreadIds ?? []).slice(-64);
      for (let receiverIndex = receivers.length - 1; receiverIndex >= 0; receiverIndex -= 1) {
        const metadata = {};
        for (const key of ["id", "type", "tool", "senderThreadId", "model", "reasoningEffort",
          "status", "prompt", "kind", "agentThreadId", "agent_thread_id", "agentPath", "agent_path"]) {
          if (typeof item[key] === "string") metadata[key] = detachedMetadataText(item[key],
            ["id", "senderThreadId", "agentThreadId", "agent_thread_id", "agentPath", "agent_path"].includes(key)
              ? Infinity : 2048);
        }
        const receiverId = receivers[receiverIndex];
        if (!subagent) {
          if (typeof receiverId !== "string" || receiverId.length > 2048) continue;
          const retainedReceiverId = detachedMetadataText(receiverId, Infinity);
          metadata.receiverThreadIds = [retainedReceiverId];
          const state = item.agentsStates?.[receiverId];
          if (state) {
            const compact = {};
            for (const key of ["status", "message"]) {
              if (typeof state[key] === "string") compact[key] = detachedMetadataText(state[key]);
            }
            metadata.agentsStates = { [retainedReceiverId]: compact };
          }
        }
        const size = Buffer.byteLength(JSON.stringify(metadata)) + 1;
        if (retained.length >= 64 || bytes + size > 128 * 1024) return retained.reverse();
        retained.push(metadata);
        bytes += size;
      }
    }
  }
  return retained.reverse();
}

function relaySessionFromThread(
  thread,
  fallbackWorkspace,
  { canInterrupt = false, runningStartedAt = null } = {},
) {
  const cwd = thread.cwd || fallbackWorkspace;
  const active = isCodexThreadActive(thread);
  return {
    id: thread.id,
    name:
      customSessionTitle(thread.name) ||
      (thread.parentThreadId ? agentDisplayName(thread, thread.id) : null) ||
      thread.agentNickname ||
      thread.preview ||
      thread.name ||
      (thread.parentThreadId ? "Codex 子 Agent" : "Codex 会话"),
    project: basename(cwd),
    branch: thread.gitInfo?.branch ?? "—",
    cwd,
    status: active ? "active" : "idle",
    can_interrupt: active && canInterrupt,
    running_started_at: active ? runningStartedAt : null,
    updated_at: normalizeTimestamp(thread.updatedAt ?? thread.createdAt),
  };
}

function isCodexThreadActive(thread) {
  return thread?.status?.type === "active";
}

function runningTurnStartedAt(turns) {
  if (!Array.isArray(turns)) return null;
  const runningTurn = [...turns]
    .reverse()
    .find(
      (turn) =>
        turn?.startedAt != null &&
        turn.status === "inProgress",
    );
  return runningTurn ? normalizeTimestamp(runningTurn.startedAt) : null;
}

function agentActivityFromToolEvent(event, occurredAt) {
  if (!event || !['command.started', 'command.completed'].includes(event.kind)) return null;
  const action = {
    file_read: '读取文件', file_change: '修改文件', command: '执行命令',
    web_search: '搜索网页', image_view: '查看图片', image_generation: '生成图片',
    context_compaction: '整理上下文', wait: '等待',
  }[event.activity_type] ?? '调用工具';
  const subject = event.activity_subject || event.activity_name || event.command;
  const prefix = event.kind === 'command.started' ? '正在' : event.status === 'failed' ? '失败：' : '已完成：';
  const label = `${prefix}${action}${subject ? ` · ${safeActivityText(subject, 160)}` : ''}`;
  return {
    current_activity: label,
    ...(occurredAt ? { updated_at: normalizeTimestamp(occurredAt) } : {}),
    activity_log: [{ id: event.item_id ?? 'current', kind: 'tool', label,
      occurred_at: occurredAt ? normalizeTimestamp(occurredAt) : null }],
  };
}

function buildAgentSnapshot({
  rootSessionId,
  rootThread,
  descendants,
  collabItems,
  agentDetails = new Map(),
}) {
  const descendantsById = new Map(
    descendants.map((thread) => [thread.id, thread]),
  );
  const agents = new Map();
  for (const thread of descendants) {
    const detail = agentDetails.get(thread.id);
    const status =
      agentStatusFromTurn(detail?.turnStatus) ??
      statusFromThread(thread.status);
    agents.set(thread.id, {
      id: thread.id,
      thread_id: thread.id,
      parent_session_id: rootSessionId,
      parent_thread_id: thread.parentThreadId ?? rootThread.id,
      name: agentDisplayName(thread, thread.id),
      nickname: thread.agentNickname ?? null,
      role: thread.agentRole ?? null,
      task: thread.preview || "Codex 子 Agent",
      status,
      progress: progressFromCollabStatus(status),
      summary: detail?.summary ?? null,
      ...detail?.activity,
      model: thread.model ?? null,
      reasoning_effort: thread.reasoningEffort ?? null,
      tool: "spawnAgent",
      started_at: thread.createdAt ? normalizeTimestamp(thread.createdAt) : null,
      updated_at: (thread.updatedAt ?? thread.createdAt) ? normalizeTimestamp(thread.updatedAt ?? thread.createdAt) : null,
    });
  }
  for (const item of collabItems) {
    const subAgentActivity = subAgentActivityFromItem(item);
    if (subAgentActivity) {
      const receiverId = subAgentActivity.threadId;
      const thread = descendantsById.get(receiverId);
      const current = agents.get(receiverId) ?? {
        id: receiverId,
        thread_id: receiverId,
        parent_session_id: rootSessionId,
        parent_thread_id: rootThread.id,
        name: subAgentActivityName(item, thread, receiverId),
        nickname: thread?.agentNickname ?? null,
        role: thread?.agentRole ?? null,
        task: thread?.preview || "Codex 子 Agent",
        status: "pendingInit",
        progress: 10,
        summary: null,
        model: thread?.model ?? null,
        reasoning_effort: thread?.reasoningEffort ?? null,
        tool: "spawnAgent",
        started_at: null,
        updated_at: null,
      };
      agents.set(receiverId, {
        ...current,
        parent_thread_id: thread?.parentThreadId ?? current.parent_thread_id,
        name: subAgentActivityName(item, thread, receiverId),
        role: thread?.agentRole ?? current.role,
        status: subAgentActivity.status,
        progress: subAgentActivity.progress,
        tool: subAgentActivity.tool,
        updated_at: thread?.updatedAt ? normalizeTimestamp(thread.updatedAt) : current.updated_at,
      });
      continue;
    }
    for (const receiverId of item.receiverThreadIds ?? []) {
      const thread = descendantsById.get(receiverId);
      const current = agents.get(receiverId) ?? {
        id: receiverId,
        thread_id: receiverId,
        parent_session_id: rootSessionId,
        parent_thread_id: item.senderThreadId ?? rootThread.id,
        name: agentDisplayName(thread, receiverId),
        nickname: thread?.agentNickname ?? null,
        role: thread?.agentRole ?? null,
        task: "Codex 子 Agent",
        status: "pendingInit",
        progress: 10,
        summary: null,
        model: thread?.model ?? null,
        reasoning_effort: thread?.reasoningEffort ?? null,
        tool: item.tool,
        started_at: null,
        updated_at: null,
      };
      const agentState = item.agentsStates?.[receiverId] ?? {};
      const status =
        agentState.status ??
        (item.tool === "spawnAgent"
          ? current.status
          : collabStatusFromToolItem(item, agentState, true));
      agents.set(receiverId, {
        ...current,
        parent_thread_id: thread?.parentThreadId ?? current.parent_thread_id,
        name: agentDisplayName(thread, receiverId),
        role: thread?.agentRole ?? current.role,
        task:
          item.tool === "spawnAgent" && item.prompt
            ? item.prompt
            : current.task,
        status,
        progress: progressFromCollabStatus(status),
        summary: agentState.message ?? current.summary,
        model: thread?.model ?? item.model ?? current.model,
        reasoning_effort: thread?.reasoningEffort ?? item.reasoningEffort ?? current.reasoning_effort,
        tool: item.tool ?? current.tool,
        updated_at: thread?.updatedAt ? normalizeTimestamp(thread.updatedAt) : current.updated_at,
      });
    }
  }
  for (const [id, detail] of agentDetails) {
    const agent = agents.get(id);
    const status = agentStatusFromTurn(detail.turnStatus);
    if (agent && detail.unavailable) {
      agents.set(id, { ...agent, status: 'unknown' });
    } else if (agent && status) {
      agents.set(id, { ...agent, status, progress: progressFromCollabStatus(status),
        summary: detail.summary ?? agent.summary, ...detail.activity });
    }
  }
  return [...agents.values()];
}

const CODEX_TOOL_ACTIVITY_TYPES = new Set([
  "commandexecution",
  "fileread",
  "filechange",
  "mcptoolcall",
  "dynamictoolcall",
  "websearch",
  "imageview",
  "sleep",
  "imagegeneration",
  "contextcompaction",
]);

export function isCodexToolActivityItem(item) {
  return CODEX_TOOL_ACTIVITY_TYPES.has(normalizeCodexItemType(item?.type));
}

export function codexToolActivityEventFromItem(
  item,
  { completed = false, turnId = null } = {},
) {
  const itemType = normalizeCodexItemType(item?.type);
  if (!CODEX_TOOL_ACTIVITY_TYPES.has(itemType)) return null;
  const rawStatus = String(item?.status ?? "").toLowerCase();
  const failed = [
    "failed",
    "error",
    "errored",
    "declined",
    "cancelled",
    "canceled",
    "interrupted",
  ].includes(rawStatus);
  const terminal =
    completed ||
    failed ||
    ["completed", "success", "succeeded", "done"].includes(rawStatus);
  const changes = Array.isArray(item?.changes) ? item.changes : [];
  const changedFileNames = uniqueFileNames(
    changes.map((change) => change?.path),
  );
  const commandText =
    itemType === "commandexecution"
      ? codexCommandActivityText(item?.command)
      : null;
  const commandReadMetadata = rolloutReadCommandMetadata(commandText);
  const metadata = {
    commandexecution: {
      type: commandReadMetadata ? "file_read" : "command",
      name: null,
      subject: commandReadMetadata?.subject ?? null,
      count: commandReadMetadata?.count ?? null,
    },
    fileread: {
      type: "file_read",
      name: null,
      subject: item?.path ? basename(item.path) : null,
      count: null,
    },
    filechange: {
      type: "file_change",
      name: null,
      subject: compactFileNames(changedFileNames),
      count: changes.length || null,
    },
    mcptoolcall: {
      type: "mcp_tool",
      name: joinToolName(item?.server, item?.tool),
      subject: null,
    },
    dynamictoolcall: {
      type: "dynamic_tool",
      name: joinToolName(item?.namespace, item?.tool),
      subject: null,
    },
    websearch: {
      type: "web_search",
      name: null,
      subject: safeActivityText(item?.query, 160),
    },
    imageview: {
      type: "image_view",
      name: null,
      subject: item?.path ? basename(item.path) : null,
    },
    sleep: {
      type: "wait",
      name: null,
      subject: Number.isFinite(item?.durationMs)
        ? String(item.durationMs)
        : null,
    },
    imagegeneration: {
      type: "image_generation",
      name: null,
      subject: item?.savedPath ? basename(item.savedPath) : null,
    },
    contextcompaction: {
      type: "context_compaction",
      name: null,
      subject: null,
    },
  }[itemType];
  const relayAttachment =
    itemType === "imageview" || itemType === "imagegeneration"
      ? toolImageAttachmentFromItem(
          { ...item, path: item.path ?? item.savedPath },
          turnId,
        )
      : null;
  return {
    kind: terminal ? "command.completed" : "command.started",
    turn_id: turnId,
    item_id: item?.id ?? null,
    activity_type: metadata.type,
    activity_name: metadata.name,
    activity_subject: metadata.subject,
    activity_count: metadata.count ?? null,
    duration_ms: Number.isFinite(item?.durationMs) ? item.durationMs : null,
    command:
      itemType === "commandexecution" ? commandText : null,
    cwd: itemType === "commandexecution" ? (item?.cwd ?? null) : null,
    text:
      itemType === "commandexecution" && terminal
        ? limitToolActivityDetail(item?.aggregatedOutput)
        : "",
    status: failed ? "failed" : terminal ? "completed" : "inProgress",
    ...(relayAttachment ? { relay_attachment: relayAttachment } : {}),
  };
}

function toolImageAttachmentFromItem(item, turnId) {
  const path = typeof item?.path === "string" ? item.path.trim() : "";
  if (!path) return null;
  const name = basename(path) || "Codex 图片";
  return {
    id: `tool_asset_${createHash("sha256")
      .update(`${turnId ?? "turn"}\0${item?.id ?? "image"}\0${path}`)
      .digest("hex")
      .slice(0, 40)}`,
    type: "image",
    name,
    mime_type: imageMimeFromExtension(extname(name)),
    detail: "original",
    relay_source: { type: "local_path", path },
  };
}

export function codexRolloutActivityEvents(
  record,
  state,
  { seed = false, sessionId = null } = {},
) {
  trackRolloutQuestions(record, state);
  state.backgroundCommands ??= new Map();
  const payload = record?.payload ?? {};
  const model =
    (record?.type === "turn_context" && payload.model) ||
    (record?.type === "event_msg" &&
      payload.type === "thread_settings_applied" &&
      payload.thread_settings?.model) ||
    (record?.type === "world_state" && payload.state?.model);
  if (typeof model === "string" && model) state.model = model;
  if (record?.type === "event_msg" && payload.type === "task_started") {
    const turnId = payload.turn_id ?? state.currentTurnId ?? null;
    const duplicate = Boolean(turnId && state.activeTurnId === turnId);
    if (state.activeTurnId !== turnId) {
      state.pendingCalls.clear();
      state.backgroundCommands.clear();
    }
    state.currentTurnId = turnId;
    state.activeTurnId = turnId;
    state.activeStartedAt = normalizeTimestamp(
      payload.started_at ?? record.timestamp,
    );
    state.lifecycleKnown = true;
    if (seed || duplicate) return [];
    return [{ kind: "turn.started", turn_id: turnId }];
  }
  if (
    record?.type === "event_msg" &&
    ["task_complete", "turn_aborted"].includes(payload.type)
  ) {
    const turnId =
      payload.turn_id ?? state.activeTurnId ?? state.currentTurnId ?? null;
    // Desktop persists exhausted stream retries as task_complete + error.
    // Completion names the lifecycle boundary, not a successful outcome.
    const status = payload.error != null || payload.reason === "failed" ? "failed" :
      payload.type === "task_complete" ? "completed" : "interrupted";
    state.terminalTurnIds ??= new Set();
    state.terminalTurnStatuses ??= new Map();
    state.terminalTurnContinuations ??= new Map();
    const duplicate = Boolean(turnId && state.terminalTurnIds.has(turnId));
    if (turnId) {
      state.terminalTurnIds.add(turnId);
      state.terminalTurnStatuses.set(turnId, status);
      // Native rollout serialization can use the Rust field name. Preserve
      // only the policy result, never another copy of the error payload.
      const error = payload.error;
      const nativeError = error && typeof error === 'object' && error.codexErrorInfo === undefined
        ? { ...error, codexErrorInfo: error.codex_error_info } : error;
      state.terminalTurnContinuations.set(turnId, canContinueCodexTurn({ status, error: nativeError }));
      while (state.terminalTurnIds.size > 128) {
        const oldest = state.terminalTurnIds.values().next().value;
        state.terminalTurnIds.delete(oldest);
        state.terminalTurnStatuses.delete(oldest);
        state.terminalTurnContinuations.delete(oldest);
      }
    }
    if (!turnId || !state.activeTurnId || state.activeTurnId === turnId) {
      state.activeTurnId = null;
      state.activeStartedAt = null;
      state.pendingCalls.clear();
      state.backgroundCommands.clear();
    }
    state.currentTurnId = turnId;
    state.lifecycleKnown = true;
    if (seed || duplicate) return [];
    return [
      {
        kind: status === "failed" ? "turn.failed" : "turn.completed",
        turn_id: turnId,
        status,
        ...(status === "failed" && codexTurnErrorText(payload.error)
          ? { error: codexTurnErrorText(payload.error) } : {}),
      },
    ];
  }
  if (record?.type === "turn_context") {
    state.currentTurnId = payload.turn_id ?? state.currentTurnId ?? null;
    return [];
  }
  const assistantMessage = rolloutAssistantMessage(record, state.currentTurnId);
  if (assistantMessage) {
    state.currentTurnId = assistantMessage.turn_id ?? state.currentTurnId;
    state.seenAssistantMessages ??= new Set();
    const key = createHash('sha256').update(JSON.stringify([
      assistantMessage.turn_id, assistantMessage.message_phase,
      assistantMessage.message_phase === 'final_answer' ? assistantMessage.text : assistantMessage.item_id,
    ])).digest('hex');
    if (state.seenAssistantMessages.has(key)) return [];
    state.seenAssistantMessages.add(key);
    if (state.seenAssistantMessages.size > 512) {
      state.seenAssistantMessages.delete(state.seenAssistantMessages.values().next().value);
    }
    return seed ? [] : [assistantMessage];
  }
  if (record?.type === "event_msg" && payload.type === "item_completed") {
    state.currentTurnId = payload.turn_id ?? state.currentTurnId ?? null;
    const subAgentActivity = subAgentActivityFromItem(payload.item);
    if (subAgentActivity) {
      if (seed) return [];
      return [
        {
          ...subAgentActivityEvent(payload.item, {
            rootSessionId: sessionId ?? payload.thread_id ?? "external",
            parentThreadId: sessionId ?? payload.thread_id ?? "external",
          }),
          agent_id: subAgentActivity.threadId,
        },
      ];
    }
    const userMessage = userMessageEventFromCodexItem(payload.item, {
      sessionId: sessionId ?? payload.thread_id ?? "external",
      turnId: payload.turn_id ?? state.currentTurnId ?? null,
    });
    if (userMessage) return seed ? [] : [userMessage];
    const matchedCommand = completedRolloutCommandEvent(payload.item, state);
    if (matchedCommand) return seed ? [] : [matchedCommand];
    const item = rolloutItemToCodexItem(payload.item);
    if (!item) return [];
    const event = codexToolActivityEventFromItem(item, {
      completed: true,
      turnId: payload.turn_id ?? state.currentTurnId ?? null,
    });
    return seed || !event ? [] : [event];
  }
  if (record?.type !== "response_item") return [];
  if (["custom_tool_call", "function_call"].includes(payload.type)) {
    const callId = payload.call_id ?? payload.id;
    if (!callId) return [];
    const metadata = rolloutToolMetadata(
      payload.name,
      payload.input ?? payload.arguments,
    );
    const itemId = `rollout_${callId}`;
    const turnId = state.currentTurnId ?? null;
    const relayAttachment = metadata.localImagePath
      ? toolImageAttachmentFromItem(
          { id: itemId, path: metadata.localImagePath },
          turnId,
        )
      : null;
    const event = {
      kind: "command.started",
      turn_id: turnId,
      item_id: itemId,
      activity_type: metadata.type,
      activity_name: metadata.name,
      activity_subject: metadata.subject ?? null,
      activity_count: metadata.count ?? null,
      command: metadata.command,
      text: "",
      status: "inProgress",
      ...(relayAttachment ? { relay_attachment: relayAttachment } : {}),
    };
    state.pendingCalls.set(callId, { event, emitted: !seed, occurredAt: record.timestamp });
    return seed ? [] : [event];
  }
  if (
    ["custom_tool_call_output", "function_call_output"].includes(payload.type)
  ) {
    const imageMessage = seed ? null : rolloutToolImageMessage(record, state.currentTurnId);
    const imageEvents = !seed && imageMessage
      ? [{
          kind: "message.completed",
          turn_id: imageMessage.turn_id,
          item_id: imageMessage.id,
          text: "",
          attachments: imageMessage.attachments,
        }]
      : [];
    const callId = payload.call_id;
    if (!callId) return imageEvents;
    const pending = state.pendingCalls.get(callId);
    state.pendingCalls.delete(callId);
    if (!pending || pending.terminal) return imageEvents;
    const failed = Boolean(payload.output?.isError ?? payload.output?.is_error);
    if (!failed && pending.event.activity_type === "command") {
      const processId = rolloutBackgroundProcessId(payload.output);
      if (processId) {
        state.backgroundCommands.set(processId, pending);
        return imageEvents;
      }
    }
    if (seed) return [];
    return [
      ...imageEvents,
      {
        ...pending.event,
        kind: "command.completed",
        status: failed ? "failed" : "completed",
      },
    ];
  }
  return [];
}

function hasRecoverableAttachment(event) {
  return Boolean(
    event?.relay_attachment?.relay_source ||
      event?.attachments?.some((attachment) => attachment?.relay_source) ||
      (event?.kind === "message.completed" && typeof event.text === "string"),
  );
}

function completedRolloutCommandEvent(item, state) {
  if (normalizeCodexItemType(item?.type) !== "commandexecution") return null;
  const processId = safeActivityText(item?.process_id, 120);
  let pending = processId
    ? state.backgroundCommands.get(processId) ?? null
    : null;
  if (pending && processId) state.backgroundCommands.delete(processId);
  if (!pending) {
    const command = codexCommandActivityText(item?.command);
    pending = [...state.pendingCalls.values()].find(
      (candidate) =>
        !candidate.terminal &&
        candidate.event.activity_type === "command" &&
        candidate.event.command === command,
    );
  }
  if (!pending) return null;
  pending.terminal = true;
  const rawStatus = String(item?.status ?? "").toLowerCase();
  const failed =
    Number.isFinite(item?.exit_code) && item.exit_code !== 0
      ? true
      : [
          "failed",
          "error",
          "errored",
          "cancelled",
          "canceled",
          "interrupted",
        ].includes(rawStatus);
  return {
    ...pending.event,
    kind: "command.completed",
    status: failed ? "failed" : "completed",
  };
}

function rolloutBackgroundProcessId(output) {
  const text = rolloutToolOutputText(output);
  const match =
    text.match(/\bSESSION_ID\s*=\s*([A-Za-z0-9._:-]+)/i) ??
    text.match(
      /\b(?:Script|Process)\s+running with session ID\s+([A-Za-z0-9._:-]+)/i,
    );
  return match?.[1] ?? null;
}

function rolloutToolOutputText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(rolloutToolOutputText).join("\n");
  if (!value || typeof value !== "object") return "";
  if (typeof value.text === "string") return value.text;
  if (Array.isArray(value.content)) return rolloutToolOutputText(value.content);
  return "";
}

function rolloutItemToCodexItem(item) {
  const itemType = normalizeCodexItemType(item?.type);
  if (itemType === "extension") {
    const extensionKind = normalizeCodexItemType(item?.kind);
    if (extensionKind !== "websearch") return null;
    return { ...item, type: "webSearch" };
  }
  if (
    ![
      "contextcompaction",
      "fileread",
      "imageview",
      "imagegeneration",
      "sleep",
      "filechange",
      "websearch",
    ].includes(itemType)
  ) {
    return null;
  }
  return item;
}

function rolloutToolMetadata(name, input) {
  const rawName = safeActivityText(name, 120) || "tool";
  const normalized = rawName.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  if (["exec", "exec_command", "command", "shell"].includes(normalized)) {
    return rolloutExecMetadata(input);
  }
  if (
    normalized.includes("apply_patch") ||
    normalized.includes("file_change")
  ) {
    return rolloutPatchMetadata(input);
  }
  if (
    normalized.includes("read_file") ||
    normalized.includes("read_text_file") ||
    normalized.includes("file_read")
  ) {
    return rolloutFileReadMetadata(input);
  }
  if (normalized.includes("web") && normalized.includes("search")) {
    return { type: "web_search", name: null, command: null };
  }
  if (normalized.includes("view_image") || normalized.includes("image_view")) {
    return {
      type: "image_view",
      name: null,
      command: null,
      ...rolloutImageMetadata(input),
    };
  }
  if (
    normalized.includes("imagegen") ||
    normalized.includes("image_generation")
  ) {
    return { type: "image_generation", name: null, command: null };
  }
  if (normalized.includes("wait") || normalized.includes("sleep")) {
    return { type: "wait", name: null, command: null };
  }
  return { type: "tool_call", name: rawName, command: null };
}

function rolloutExecMetadata(value) {
  const source = typeof value === "string" ? value.trim() : "";
  const directCommand = rolloutStringField(source, 'cmd') ?? rolloutStringField(source, 'command');
  if (directCommand) {
    const readMetadata = rolloutReadCommandMetadata(directCommand);
    return { type: readMetadata ? 'file_read' : 'command', name: null,
      subject: readMetadata?.subject ?? null, count: readMetadata?.count ?? null,
      command: safeActivityText(directCommand, 2_000) };
  }
  const nestedTools = [
    ...source.matchAll(/\btools\.([A-Za-z0-9_]+)\s*\(/g),
  ].map((match) => match[1]);
  if (nestedTools.includes("exec_command")) {
    const commands = extractJavascriptStringFields(source, "cmd");
    const command = commands.length
      ? safeActivityText(commands.slice(0, 8).join(" ; "), 2_000)
      : "exec_command";
    const readMetadata = rolloutReadCommandMetadata(command);
    return {
      type: readMetadata ? "file_read" : "command",
      name: null,
      subject: readMetadata?.subject ?? null,
      count: readMetadata?.count ?? null,
      command,
    };
  }
  if (nestedTools.includes("apply_patch")) {
    return rolloutPatchMetadata(source);
  }
  if (nestedTools.includes("web__run")) {
    return { type: "web_search", name: null, command: null };
  }
  if (nestedTools.includes("view_image")) {
    return {
      type: "image_view",
      name: null,
      command: null,
      ...rolloutImageMetadata(source),
    };
  }
  if (nestedTools.includes("image_gen__imagegen")) {
    return { type: "image_generation", name: null, command: null };
  }
  if (nestedTools.includes("wait")) {
    return { type: "wait", name: null, command: null };
  }
  if (nestedTools.length) {
    return { type: "tool_call", name: nestedTools[0], command: null };
  }
  return {
    type: "command",
    name: null,
    command: safeActivityText(source, 2_000),
  };
}

function rolloutPatchMetadata(value) {
  const source = typeof value === "string" ? value : "";
  const normalizedSource = source
    .replaceAll("\\r\\n", "\n")
    .replaceAll("\\n", "\n");
  const paths = [
    ...normalizedSource.matchAll(
      /^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/gm,
    ),
  ].map((match) => match[1]);
  const names = uniqueFileNames(paths);
  return {
    type: "file_change",
    name: null,
    subject: compactFileNames(names),
    count: names.length || null,
    command: null,
  };
}

function rolloutFileReadMetadata(value) {
  const path =
    rolloutStringField(value, "path") ?? rolloutStringField(value, "file");
  return {
    type: "file_read",
    name: null,
    subject: path ? basename(path) : null,
    count: path ? 1 : null,
    command: null,
  };
}

function rolloutReadCommandMetadata(command) {
  if (typeof command !== "string" || !command.trim()) return null;
  const segments = command
    .split(/\s*(?:&&|;|\|\|)\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) return null;
  const names = [];
  for (const segment of segments) {
    const tokens = segment.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
    const executable = tokens[0]?.replace(/^.*\//, "").toLowerCase();
    if (!["cat", "head", "tail", "sed"].includes(executable)) return null;
    const candidate = tokens.at(-1)?.replace(/^['"]|['"]$/g, "");
    if (!candidate || candidate === "-" || candidate.startsWith("-")) {
      return null;
    }
    names.push(candidate);
  }
  const fileNames = uniqueFileNames(names);
  return fileNames.length
    ? { subject: compactFileNames(fileNames), count: fileNames.length }
    : null;
}

function uniqueFileNames(paths) {
  return [
    ...new Set(
      paths
        .filter((value) => typeof value === "string" && value.trim())
        .map((value) => basename(value.trim()))
        .filter(Boolean),
    ),
  ];
}

function compactFileNames(names) {
  return names.length ? safeActivityText(names.join("、"), 160) : null;
}

function rolloutImageMetadata(value) {
  const path = rolloutStringField(value, "path");
  return {
    subject: path ? basename(path) : null,
    localImagePath: path?.startsWith("/") ? path : null,
  };
}

function rolloutStringField(value, field) {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    const parsedValue = parsed?.[field];
    if (typeof parsedValue === "string" && parsedValue.trim()) {
      return parsedValue.trim();
    }
  } catch {
    // Orchestrated tool input is JavaScript source rather than JSON.
  }
  return extractJavascriptStringFields(value, field)[0] ?? null;
}

function extractJavascriptStringFields(source, field) {
  const values = [];
  const fieldPattern = new RegExp(`\\b${field}\\s*:\\s*`, "g");
  let match;
  while ((match = fieldPattern.exec(source)) && values.length < 8) {
    const quote = source[match.index + match[0].length];
    if (!['"', "'", "`"].includes(quote)) continue;
    let escaped = false;
    let end = match.index + match[0].length + 1;
    for (; end < source.length; end += 1) {
      const character = source[end];
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        break;
      }
    }
    if (end >= source.length) continue;
    const decoded = decodeJavascriptString(
      source.slice(match.index + match[0].length, end + 1),
    );
    if (decoded?.trim()) values.push(decoded.trim());
    fieldPattern.lastIndex = end + 1;
  }
  return values;
}

function decodeJavascriptString(literal) {
  const quote = literal[0];
  if (!quote || literal.at(-1) !== quote) return null;
  let value = "";
  for (let index = 1; index < literal.length - 1; index += 1) {
    const character = literal[index];
    if (character !== "\\") {
      value += character;
      continue;
    }
    index += 1;
    if (index >= literal.length - 1) return null;
    const escaped = literal[index];
    value +=
      {
        n: "\n",
        r: "\r",
        t: "\t",
        b: "\b",
        f: "\f",
        v: "\v",
        0: "\0",
      }[escaped] ?? escaped;
  }
  return value;
}

function normalizeCodexItemType(type) {
  return String(type ?? "")
    .replaceAll(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

// Desktop rollouts use response_item/message, while app-server rollouts may
// use event_msg/item_completed. Share the mapping for live delivery and recovery.
function rolloutAssistantMessage(record, fallbackTurnId) {
  const payload = record?.payload;
  let item;
  if (record?.type === 'event_msg' && payload?.type === 'item_completed') {
    item = payload.item;
  } else if (record?.type === 'response_item' && payload?.type === 'message' &&
      payload.role === 'assistant' && ['commentary', 'final_answer'].includes(payload.phase)) {
    item = { ...payload, type: 'agentMessage' };
  }
  const text = codexAgentMessageText(item);
  if (!text) return null;
  const turnId = payload.turn_id ?? fallbackTurnId ?? null;
  return {
    kind: 'message.completed',
    turn_id: turnId,
    item_id: item.id ?? `rollout_message_${createHash('sha256').update(JSON.stringify([turnId, item.phase, text])).digest('hex')}`,
    text,
    message_phase: item.phase ?? null,
  };
}

function codexAgentMessageText(item) {
  if (normalizeCodexItemType(item?.type) !== "agentmessage") return null;
  if (typeof item?.text === "string" && item.text.trim()) {
    return adaptCodexFileCitations(item.text);
  }
  if (!Array.isArray(item?.content)) return null;
  const text = item.content
    .map((part) => {
      if (typeof part === "string") return part;
      const partType = normalizeCodexItemType(part?.type);
      return ["text", "outputtext"].includes(partType) &&
        typeof part?.text === "string"
        ? part.text
        : "";
    })
    .filter(Boolean)
    .join("\n");
  return text.trim() ? adaptCodexFileCitations(text) : null;
}

function adaptCodexFileCitations(value) {
  const text = typeof value === "string" ? value : "";
  const citation =
    /(`?)::?codex-file-citation\{((?:[^"'{}]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')*)\}\1/g;
  return text.replace(citation, (match, _codeQuote, attributes) => {
    const pathAttribute =
      /(?:^|\s)path\s*=\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/.exec(
        attributes,
      );
    if (!pathAttribute) return match;
    const quote = pathAttribute[1] === undefined ? "'" : '"';
    const encodedPath = pathAttribute[1] ?? pathAttribute[2];
    const path = decodeCodexCitationAttribute(encodedPath, quote);
    const name = basename(path);
    if (!isAbsolute(path) || /[\\/]$/.test(path)) return match;
    const label = name.replace(/[\\[\]]/g, "\\$&");
    const target = path
      .replaceAll("%", "%25")
      .replaceAll("<", "%3C")
      .replaceAll(">", "%3E")
      .replaceAll("#", "%23")
      .replaceAll("?", "%3F");
    return `[${label}](<${target}>)`;
  });
}

function decodeCodexCitationAttribute(value, quote) {
  return value.replace(/\\(.)/g, (match, character) =>
    character === quote || character === "\\" ? character : match,
  );
}

function joinToolName(namespace, tool) {
  return (
    [namespace, tool]
      .map((part) => safeActivityText(part, 80))
      .filter(Boolean)
      .join(" / ") || null
  );
}

function safeActivityText(value, limit) {
  const text = String(value ?? "")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length <= limit
    ? text
    : `${text.slice(0, Math.max(1, limit - 1))}…`;
}

function codexCommandActivityText(value) {
  if (!Array.isArray(value)) return safeActivityText(value, 2_000);
  const shellFlagIndex = value.findIndex(
    (part) => part === "-c" || part === "-lc",
  );
  const command =
    shellFlagIndex >= 0 && shellFlagIndex < value.length - 1
      ? value[shellFlagIndex + 1]
      : value.join(" ");
  return safeActivityText(command, 2_000);
}

function codexActivityFallbackLabel(activity) {
  return (
    activity.activity_name ??
    activity.activity_subject ??
    activity.command ??
    activity.activity_type ??
    "Local tool"
  );
}

function toolActivityEventStatus(activity) {
  const status = String(activity?.status ?? "").toLowerCase();
  if (
    ["failed", "error", "errored", "cancelled", "canceled"].includes(status)
  ) {
    return "failed";
  }
  if (activity?.kind === "command.completed" || status === "completed") {
    return "completed";
  }
  return "running";
}

function limitToolActivityDetail(value) {
  const text = String(value ?? "");
  return text.length <= 12_000 ? text : text.slice(-12_000);
}

function dedupeCodexThreads(threads) {
  const seen = new Set();
  return threads.filter((thread) => {
    if (!thread?.id || seen.has(thread.id)) return false;
    seen.add(thread.id);
    return true;
  });
}

async function readUtf8FileRange(path, position, length, decoder = null) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(Math.max(0, length));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    const bytes = buffer.subarray(0, bytesRead);
    return decoder ? decoder.write(bytes) : bytes.toString("utf8");
  } finally {
    await handle.close();
  }
}

async function readBufferRange(path, position, length) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(Math.max(0, length));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function readCodexRolloutSessionId(path) {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const record = parseJsonLine(line);
      if (record?.type !== "session_meta") continue;
      const sessionId = record.payload?.id;
      return typeof sessionId === "string" && sessionId ? sessionId : null;
    }
    return null;
  } finally {
    lines.close();
    input.destroy();
  }
}

async function readExternalRolloutLifecycle(path, size) {
  const state = {
    currentTurnId: null,
    activeTurnId: null,
    activeStartedAt: null,
    model: null,
    lifecycleKnown: false,
    terminalTurnIds: new Set(),
    pendingCalls: new Map(),
  };
  const handle = await open(path, "r");
  let position = 0;
  let fragment = "";
  try {
    while (position < size) {
      const length = Math.min(MAX_ROLLOUT_READ_BYTES, size - position);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (!bytesRead) break;
      position += bytesRead;
      const lines = completeJsonLines(
        `${fragment}${buffer.subarray(0, bytesRead).toString("utf8")}`,
      );
      fragment = lines.fragment;
      for (const line of lines.records) {
        foldRolloutLifecycleLine(line, state);
      }
    }
    if (fragment) foldRolloutLifecycleLine(fragment, state);
    return state;
  } finally {
    await handle.close();
  }
}

async function readExternalRolloutFinalMessages(path, sessionId) {
  const messages = [];
  let turnId = null;
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      // Recover persisted external user items, final answers and images.
      // Avoid parsing unrelated large command-output records.
      // Escaped Unicode can encode type names, so keep that unusual form on
      // the full JSON path rather than dropping a semantically valid record.
      if (!line.includes('"turn_context"') && !line.includes('"task_started"') &&
          !line.includes('"item_completed"') && !line.includes('"final_answer"') && !line.includes('"input_image"') &&
          !line.includes('"task_complete"') && !line.includes('"turn_aborted"') &&
          !line.includes('\\u')) continue;
      const record = parseJsonLine(line);
      const payload = record?.payload;
      if (record?.type === "turn_context" ||
          (record?.type === "event_msg" && payload?.type === "task_started")) {
        turnId = payload.turn_id ?? turnId;
      }
      if (record?.type === "event_msg" && payload?.type === "item_completed" &&
          normalizeCodexItemType(payload.item?.type) === "usermessage") {
        const message = historyMessageFromItem({
          ...payload.item,
          type: "userMessage",
        }, {
          id: payload.turn_id ?? turnId,
          startedAt: payload.started_at_ms ?? record.timestamp,
        }, messages.length, sessionId);
        if (message) messages.push(message);
      }
      if (record?.type === 'event_msg' && ['task_complete', 'turn_aborted'].includes(payload?.type)) {
        const failure = codexTurnFailureMessage({ id: payload.turn_id ?? turnId,
          status: payload.error != null || payload.reason === 'failed' ? 'failed' : 'completed',
          error: payload.error, completedAt: payload.completed_at ?? record.timestamp });
        if (failure) messages.push(failure);
      }
      const imageMessage = rolloutToolImageMessage(record, turnId);
      if (imageMessage) messages.push(imageMessage);
      const assistant = rolloutAssistantMessage(record, turnId);
      if (assistant?.message_phase !== 'final_answer') continue;
      if (messages.some(message => message.id === assistant.item_id)) continue;
      messages.push({
        id: assistant.item_id,
        role: 'codex',
        content: assistant.text,
        created_at: normalizeTimestamp(payload.item?.completed_at_ms ?? record.timestamp),
        turn_id: assistant.turn_id,
        message_phase: 'final_answer',
      });
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return messages;
}

function rolloutToolImageMessage(record, turnId) {
  const payload = record?.payload;
  if (record?.type !== "response_item" ||
      !["custom_tool_call_output", "function_call_output"].includes(payload?.type) ||
      !Array.isArray(payload.output)) return null;
  const id = payload.id ?? payload.call_id;
  if (!id) return null;
  const attachments = payload.output.flatMap((part, index) => {
    const url = part?.type === "input_image" ? part.image_url : null;
    if (typeof url !== "string" ||
        url.length > MAX_HISTORY_IMAGE_DATA_URL_LENGTH) return [];
    const mimeType = imageDataUrlMimeType(url);
    if (!mimeType) return [];
    return [{
      id: `tool_asset_${createHash("sha256")
        .update(`${id}\0${index}\0${url}`)
        .digest("hex").slice(0, 40)}`,
      type: "image",
      name: `Codex image ${index + 1}.${extensionFromImageMime(mimeType)}`,
      mime_type: mimeType,
      detail: part.detail ?? "original",
      relay_source: { type: "data_url", url },
    }];
  });
  if (!attachments.length) return null;
  return {
    id: `rollout_images_${id}`,
    role: "codex",
    content: "",
    attachments,
    created_at: normalizeTimestamp(record.timestamp),
    turn_id: payload.internal_chat_message_metadata_passthrough?.turn_id ?? turnId ?? null,
  };
}

async function recoverMissingHistoryImageSources(
  messages,
  { sessionId, rolloutPath, sessionsRoot },
) {
  const missingPaths = new Set();
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      const source = attachment?.relay_source;
      if (
        attachment?.type === "image" &&
        source?.type === "local_path" &&
        typeof source.path === "string" &&
        !existsSync(source.path)
      ) {
        missingPaths.add(source.path);
      }
    }
  }
  if (!missingPaths.size || !pathIsInside(sessionsRoot, rolloutPath)) return;

  const rolloutPaths = await findCodexSessionRollouts(sessionsRoot, sessionId);
  if (!rolloutPaths.includes(rolloutPath)) rolloutPaths.push(rolloutPath);
  rolloutPaths.sort();
  const recovered = new Map();
  for (const path of rolloutPaths) {
    const sources = await readExternalRolloutImageSources(path, missingPaths);
    for (const [sourcePath, source] of sources) {
      recovered.set(sourcePath, source);
      missingPaths.delete(sourcePath);
    }
    if (!missingPaths.size) break;
  }
  if (!recovered.size) return;

  for (const message of messages) {
    if (!Array.isArray(message.attachments)) continue;
    message.attachments = message.attachments.map((attachment) => {
      const source = attachment?.relay_source;
      const recoveredSource =
        source?.type === "local_path" ? recovered.get(source.path) : null;
      if (!recoveredSource || recoveredSource.mimeType !== attachment.mime_type) return attachment;
      return {
        ...attachment,
        relay_source: { ...recoveredSource.source, provenance_path: source.path },
      };
    });
  }
}

async function findCodexSessionRollouts(root, sessionId) {
  if (
    typeof sessionId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)
  ) {
    return [];
  }
  const paths = [];
  const directories = [root];
  while (directories.length) {
    const directory = directories.pop();
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      rethrowFileAccessError(error);
      continue;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        directories.push(path);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".jsonl") &&
        entry.name.includes(sessionId)
      ) {
        paths.push(path);
      }
    }
  }
  return paths;
}

async function readExternalRolloutImageSources(path, wantedPaths) {
  const sources = new Map();
  const reader = new CodexRolloutHistoryIndex({ createState: () => ({ messages: [] }),
    fold: (record, _state, context) => {
      const payload = record?.payload;
      if (
        record?.type !== "response_item" ||
        payload?.type !== "message" ||
        payload.role !== "user" ||
        !Array.isArray(payload.content)
      ) {
        return;
      }
      const paths = rolloutImagePaths(payload.content);
      const dataUrls = payload.content
        .filter((part) => part?.type === "input_image")
        .map((part) => part.image_url);
      for (let index = 0; index < dataUrls.length; index += 1) {
        const sourcePath = paths[index];
        const dataUrl = dataUrls[index];
        if (
          !wantedPaths.has(sourcePath) ||
          typeof dataUrl !== "string" ||
          dataUrl.length > MAX_HISTORY_IMAGE_DATA_URL_LENGTH ||
          imageDataUrlMimeType(dataUrl) === null
        ) {
          continue;
        }
        const source = rolloutDataUrlSources(record, context).get(dataUrl);
        if (source) sources.set(sourcePath, { source, mimeType: imageDataUrlMimeType(dataUrl) });
      }
    },
  });
  await reader.read(path, 'attachment-recovery');
  reader.clear();
  return sources;
}

function rolloutImagePaths(content) {
  const paths = [];
  const append = (path) => {
    if (typeof path === "string" && path && !paths.includes(path)) {
      paths.push(path);
    }
  };
  for (const part of content) {
    if (part?.type !== "input_text" || typeof part.text !== "string") {
      continue;
    }
    for (const file of mentionedFilesFromUserText(part.text)) {
      if (imageMimeFromExtension(extname(file.path)).startsWith("image/")) {
        append(file.path);
      }
    }
    const pattern = /<image\b[^>\n]*\bpath=(?:"([^"]+)"|'([^']+)')[^>\n]*>/g;
    for (const match of part.text.matchAll(pattern)) append(match[1] ?? match[2]);
  }
  return paths;
}

function imageDataUrlMimeType(dataUrl) {
  const match =
    /^data:(image\/(?:png|jpeg|webp|gif|avif));base64,/i.exec(dataUrl);
  return match?.[1]?.toLowerCase() ?? null;
}

function pathIsInside(root, path) {
  if (typeof root !== "string" || typeof path !== "string") return false;
  const child = relative(root, path);
  return (
    child !== "" &&
    child !== ".." &&
    !child.startsWith(`..${sep}`) &&
    !isAbsolute(child)
  );
}

function foldRolloutLifecycleLine(line, state) {
  if (
    !line.includes('"type":"event_msg"') ||
    !["task_started", "task_complete", "turn_aborted"].some((type) =>
      line.includes(`"type":"${type}"`),
    )
  ) {
    return;
  }
  const record = parseJsonLine(line);
  if (record) codexRolloutActivityEvents(record, state, { seed: true });
}

function completeJsonLines(text, { discardFirst = false } = {}) {
  const parts = String(text).split("\n");
  const fragment = parts.pop() ?? "";
  if (discardFirst) parts.shift();
  return { records: parts.filter(Boolean), fragment };
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function createRolloutHistoryState(expectedSessionId) {
  return { expectedSessionId, sessionId: null, nextInheritedSessionId: null, messages: [], turns: [], statuses: new Map(),
    collabItems: [], imageSources: new Map(), messageOffsets: new Map(), untypedUserIds: new Set(),
    provisionalAssistantIds: new Set(),
    pendingResponseUsers: [], lifecycle: { pendingCalls: new Map() } };
}

function codexHistorySourceMismatch() {
  const error = new Error('Codex history source does not match this conversation.');
  error.code = 'RELAY_CODEX_HISTORY_SOURCE_MISMATCH';
  return error;
}

function historySupplementMessages(projection) {
  return projection.messages.filter(message => message.kind !== 'tool_activity' &&
    !projection.untypedUserIds.has(message.id) &&
    (message.kind === 'turn.failed' || message.role === 'user' || (message.role === 'codex' &&
      (message.message_phase === 'final_answer' || (!message.content?.trim() && message.attachments?.length)))))
    .map(message => {
      if (message.role !== 'codex' || message.content?.trim() || message.message_phase !== null) return message;
      const imageMessage = { ...message };
      delete imageMessage.message_phase;
      return imageMessage;
    });
}

function compatibleHistoryPhases(left, right) {
  return left === right || ((!left && right === 'final_answer') || (!right && left === 'final_answer'));
}

function compactHistoryQuestionTurns(turns) {
  return turns.map(turn => ({ id: turn.id, status: turn.status, startedAt: turn.startedAt,
    items: (turn.items ?? []).flatMap(item => {
      if (!item) return [];
      if (normalizeCodexItemType(item.type) === 'usermessage') {
        const content = (item.content ?? []).filter(part => parseAsyncAnswers(part.text));
        return content.length ? [{ type: 'userMessage', content }] : [];
      }
      return normalizeCodexItemType(item.type) === 'agentmessage' && Array.isArray(item.questions)
        ? [{ type: 'agentMessage', id: item.id, questions: item.questions, createdAt: item.createdAt }] : [];
    }) })).filter(turn => turn.items.length);
}

function externalizeHistoryImageSources(messages, sources) {
  for (const message of messages) for (const attachment of message.attachments ?? []) {
    const source = attachment.relay_source;
    if (source?.type !== 'data_url') continue;
    const reference = sources?.get(createHash('sha256').update(source.url).digest('hex'));
    if (reference) attachment.relay_source = reference;
  }
}

function foldRolloutHistoryRecord(record, state, context) {
  state.committedOffset = context.offset + context.length + 1;
  const payload = record?.payload ?? {};
  if (record?.type === 'turn_context' || (record?.type === 'event_msg' &&
      ['task_started', 'task_complete', 'turn_aborted', 'item_completed'].includes(payload.type)))
    state.lastLifecycleOffset = context.offset;
  if (record?.type === 'session_meta') {
    // Native forks prepend their own header before copied ancestor headers.
    // Only the first header owns this file; a copied header must belong to its
    // explicitly declared fork ancestry and must never replace that identity.
    if (state.sessionId === null) {
      if (payload.id !== state.expectedSessionId)
        throw codexHistorySourceMismatch();
      state.sessionId = payload.id;
      state.sourceComplete = payload.history_mode === 'legacy' && typeof payload.cli_version === 'string';
      state.nextInheritedSessionId = payload.forked_from_id ?? null;
    } else if (payload.id !== state.sessionId) {
      if (payload.id !== state.nextInheritedSessionId) throw codexHistorySourceMismatch();
      state.nextInheritedSessionId = payload.forked_from_id ?? null;
    }
  }
  const sources = rolloutDataUrlSources(record, context);
  for (const [url, reference] of sources) {
    state.imageSources.set(createHash('sha256').update(url).digest('hex'), reference);
  }
  const events = codexRolloutActivityEvents(record, state.lifecycle, { sessionId: state.expectedSessionId });
  const turnId = payload.turn_id ?? payload.internal_chat_message_metadata_passthrough?.turn_id ?? state.lifecycle.currentTurnId;
  const startedAt = normalizeTimestamp(payload.started_at_ms ?? payload.started_at ?? record.timestamp);
  const turn = { id: turnId, startedAt,
    status: state.statuses.get(turnId) ?? 'inProgress' };
  const put = message => {
    if (!message) return;
    externalizeHistoryImageSources([message], state.imageSources);
    state.messageOffsets.set(message.id, context.offset);
    const existing = state.messages.findIndex(value => value.id === message.id);
    if (existing >= 0) state.messages[existing] = { ...state.messages[existing], ...message };
    else state.messages.push(message);
  };
  // Desktop writes the native item first, then its submission identity in a
  // separate user_message event. Enrich that pending item rather than creating
  // another message. Only the latest input in this turn can own this receipt;
  // identical text from separate submissions must keep independent identities.
  if (record?.type === 'event_msg' && payload.type === 'user_message' &&
      typeof payload.client_id === 'string' && payload.client_id &&
      typeof payload.message === 'string' && turnId &&
      !state.messages.some(message => message.client_message_id === payload.client_id)) {
    const pending = state.pendingResponseUsers.at(-1);
    const raw = pending && state.messages.find(message => message.id === pending.id);
    if (raw && pending.turn_id === turnId &&
        pending.content === sanitizeUserMessageText(payload.message) && !raw.client_message_id) {
      // If a read split these adjacent records, the provider seed may use a
      // different native ID. Recalibrate it once instead of appending a second
      // copy under the raw ID to that already-seeded history.
      if ((state.messageOffsets.get(raw.id) ?? -1) < (state.seedOffset ?? 0)) delete state.providerSeed;
      put({ ...raw, client_message_id: payload.client_id });
    }
  }
  for (const event of events) {
    if (event.kind === 'turn.started') {
      state.statuses.set(event.turn_id, 'inProgress');
      // Match provider history's bounded latest-turn tool window. Earlier
      // user/answer/attachment messages remain available to pagination.
      state.messages = state.messages.filter(message => message.kind !== 'tool_activity');
    } else if (event.kind === 'turn.completed' || event.kind === 'turn.failed') {
      state.statuses.set(event.turn_id, event.status ?? 'completed');
      if (event.kind === 'turn.failed') put(codexTurnFailureMessage({
        id: event.turn_id, status: 'failed', error: event.error,
        completedAt: payload.completed_at ?? record.timestamp,
      }));
    } else if (event.kind === 'user.message') {
      const pendingIndex = state.pendingResponseUsers.findLastIndex(value => {
        const clientId = state.messages.find(message => message.id === value.id)?.client_message_id;
        return value.turn_id === event.turn_id && value.content === event.text &&
          (!clientId || !event.client_message_id || clientId === event.client_message_id);
      });
      if (pendingIndex >= 0) {
        const pending = state.pendingResponseUsers.splice(pendingIndex, 1)[0];
        const raw = state.messages.find(value => value.id === pending.id);
        event.client_message_id ??= raw?.client_message_id ?? null;
        state.messages = state.messages.filter(value => value.id !== pending.id);
        state.messageOffsets.delete(pending.id);
        state.untypedUserIds.delete(pending.id);
        // Native materialization can retain only a vanished temporary path.
        // Preserve its attachment ID while recovering the owning raw source.
        (event.attachments ?? []).forEach((attachment, index) => {
          const fallback = raw?.attachments?.[index];
          if (attachment.relay_source?.type === 'local_path' &&
              !existsSync(attachment.relay_source.path) && fallback?.relay_source?.type === 'rollout_jsonl')
            attachment.relay_source = fallback.relay_source;
        });
      }
      put({ id: event.item_id, role: 'user', content: event.text, attachments: event.attachments,
        created_at: startedAt, turn_id: event.turn_id, client_message_id: event.client_message_id });
    } else if (event.kind === 'message.completed') {
      if (record.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant')
        state.provisionalAssistantIds.add(event.item_id);
      put({ id: event.item_id, role: 'codex', content: event.text, attachments: event.attachments,
        created_at: normalizeTimestamp(payload.completed_at_ms ?? payload.item?.completed_at_ms ?? record.timestamp),
        turn_id: event.turn_id, message_phase: event.message_phase ?? null });
    } else if (['command.started', 'command.completed'].includes(event.kind)) {
      put({ id: `command_${event.turn_id ?? 'turn'}_${event.item_id}`, role: 'system', content: '',
        created_at: startedAt, turn_id: event.turn_id, kind: 'tool_activity',
        tool_activity_label: codexActivityFallbackLabel(event), tool_activity_type: event.activity_type,
        tool_activity_name: event.activity_name, tool_activity_subject: event.activity_subject,
        tool_activity_command: event.command, tool_activity_count: event.activity_count,
        tool_activity_detail: limitToolActivityDetail(event.text), tool_activity_status: toolActivityEventStatus(event),
        attachments: event.relay_attachment ? [event.relay_attachment] : [] });
      const tools = state.messages.filter(message => message.kind === 'tool_activity');
      if (tools.length > MAX_HISTORY_TOOL_ACTIVITIES) {
        const removed = new Set(tools.slice(0, -MAX_HISTORY_TOOL_ACTIVITIES).map(message => message.id));
        state.messages = state.messages.filter(message => !removed.has(message.id));
      }
    }
  }
  // Desktop stores user input as response_item; app-server additionally emits
  // native item_completed IDs. The merge below prefers that native projection.
  if (record?.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
    const kinds = payload.internal_chat_message_metadata_passthrough?.content_item_kinds;
    // Older untyped user rows do not distinguish injected instruction/context
    // from actual user input. Retain provider materialization as authority for
    // those sources instead of guessing from the text.
    if (!Array.isArray(kinds)) state.requiresProvider = true;
    // Modern Desktop persists injected AGENTS/environment input as separate
    // role:user records. Only actual user parts belong in the phone timeline.
    const parts = (payload.content ?? []).filter((_part, index) =>
      !Array.isArray(kinds) || String(kinds[index] ?? '').startsWith('user.'));
    const content = parts.map(part => part.type === 'input_text'
      ? { type: 'text', text: part.text } : part.type === 'input_image'
        ? { type: 'image', url: part.image_url, detail: part.detail } : part);
    const id = payload.id ?? `rollout_user_${createHash('sha256')
      .update(JSON.stringify([turnId, content, record.timestamp, context.offset])).digest('hex')}`;
    const item = { id, type: 'userMessage', content, clientId: payload.client_id };
    const message = historyMessageFromItem(item, turn, state.messages.length, state.expectedSessionId);
    put(message);
    if (message && !Array.isArray(kinds)) state.untypedUserIds.add(message.id);
    if (message) state.pendingResponseUsers.push({ id: message.id, turn_id: message.turn_id, content: message.content });
    if (state.pendingResponseUsers.length > 100) state.pendingResponseUsers.shift();
    state.turns.push(...compactHistoryQuestionTurns([{ ...turn, items: [item] }]));
  }
  if (record?.type === 'event_msg' && payload.type === 'item_completed') {
    const item = payload.item;
    state.turns.push(...compactHistoryQuestionTurns([{ ...turn, items: [item] }]));
    if (normalizeCodexItemType(item?.type) === 'agentmessage') {
      const message = historyMessageFromItem({ ...item, type: 'agentMessage' },
        { ...turn, completedAt: payload.completed_at_ms ?? record.timestamp }, state.messages.length, state.expectedSessionId);
      if (message) {
        // Live event deduplication suppresses a paired typed completion; history
        // still needs the provider's canonical native item ID and timestamp.
        state.messages = state.messages.filter(value => {
          if (value.id === message.id || !state.provisionalAssistantIds.has(value.id) || value.role !== 'codex' ||
              value.turn_id !== message.turn_id || !compatibleHistoryPhases(value.message_phase, message.message_phase) ||
              value.content !== message.content) return true;
          state.provisionalAssistantIds.delete(value.id);
          state.messageOffsets.delete(value.id);
          return false;
        });
        put(message);
      }
    }
    if (normalizeCodexItemType(item?.type) === 'plan') put(historyMessageFromItem({ ...item, type: 'plan' }, turn, state.messages.length, state.expectedSessionId));
    const toolItem = normalizeCodexItemType(item?.type) === 'commandexecution'
      ? { ...item, aggregatedOutput: item.aggregatedOutput ?? item.aggregated_output }
      : rolloutItemToCodexItem(item);
    if (toolItem && isCodexToolActivityItem(toolItem)) {
      const native = historyMessageFromItem(toolItem,
        { ...turn, items: [toolItem], completedAt: payload.completed_at_ms ?? record.timestamp }, 0,
        state.expectedSessionId, { includeToolActivity: true });
      const pairedIds = new Set(events.filter(event => event.kind === 'command.completed')
        .map(event => `command_${event.turn_id ?? 'turn'}_${event.item_id}`));
      state.messages = state.messages.filter(message => message.id === native?.id || !pairedIds.has(message.id));
      put(native);
      const tools = state.messages.filter(message => message.kind === 'tool_activity');
      if (tools.length > MAX_HISTORY_TOOL_ACTIVITIES) {
        const removed = new Set(tools.slice(0, -MAX_HISTORY_TOOL_ACTIVITIES).map(message => message.id));
        state.messages = state.messages.filter(message => !removed.has(message.id));
      }
    }
    if (item?.type === 'collabAgentToolCall' || isSubAgentActivityItem(item)) {
      state.collabItems = threadCollabMetadata([{ items: [...state.collabItems, item] }]);
    }
  }
}

function mergeProjectedHistory(seed, projected, { preserveDistinctIds = false } = {}) {
  const messages = structuredClone(seed);
  const matchedUsers = new Set();
  for (const message of projected) {
    const sameId = messages.findIndex(value => value.id === message.id);
    if (sameId >= 0) {
      const merged = { ...messages[sameId], ...structuredClone(message) };
      if (message.role === 'user') {
        merged.client_message_id ??= messages[sameId].client_message_id;
        matchedUsers.add(merged.id);
      }
      messages[sameId] = merged;
      continue;
    }
    const sameClientId = message.role === 'user' && message.client_message_id
      ? messages.findIndex(value => value.role === 'user' && value.client_message_id === message.client_message_id) : -1;
    if (preserveDistinctIds && sameClientId < 0) { messages.push(structuredClone(message)); continue; }
    const duplicate = sameClientId >= 0 ? sameClientId : messages.findIndex(value => value.role === message.role &&
      value.turn_id === message.turn_id && value.content === message.content &&
      (message.role === 'codex' ? compatibleHistoryPhases(value.message_phase, message.message_phase)
        : value.message_phase === message.message_phase) && message.content?.trim() &&
      (message.role === 'codex' || (message.role === 'user' &&
        (!value.client_message_id || !message.client_message_id || value.client_message_id === message.client_message_id) &&
        seed.some(candidate => candidate.id === value.id) && !matchedUsers.has(value.id))));
    if (duplicate >= 0) {
      if (message.role === 'user') {
        matchedUsers.add(messages[duplicate].id);
        messages[duplicate].client_message_id ??= message.client_message_id;
      }
      // Keep provider IDs and timestamps while recovering image sources absent
      // from a lagging materialized snapshot.
      if (!messages[duplicate].attachments?.length && message.attachments?.length)
        messages[duplicate].attachments = structuredClone(message.attachments);
      continue;
    }
    messages.push(structuredClone(message));
  }
  messages.sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
  return messages;
}

function moveRolloutImagesToFinalAnswers(messages) {
  for (const imageMessage of [...messages].filter(message => message.role === 'codex' &&
    !message.content?.trim() && message.attachments?.length && message.turn_id)) {
    const reply = messages.findLast(message => message.role === 'codex' &&
      message.turn_id === imageMessage.turn_id && message.content?.trim() &&
      (!message.message_phase || message.message_phase === 'final_answer'));
    if (!reply) continue;
    const attachments = [...(reply.attachments ?? []), ...imageMessage.attachments];
    reply.attachments = attachments.filter((attachment, index) =>
      attachments.findIndex(candidate => candidate.id === attachment.id) === index);
    messages.splice(messages.findIndex(message => message.id === imageMessage.id), 1);
  }
}

function codexTurnErrorText(error) {
  const text = typeof error === 'string' ? error : error?.message;
  return typeof text === 'string' && text.trim() ? text : null;
}

function codexTurnFailureMessage(turn) {
  if (!turn?.id || turn.status !== 'failed') return null;
  return { id: `turn-terminal:${turn.id}`, role: 'system', kind: 'turn.failed',
    content: codexTurnErrorText(turn.error) ?? '', turn_id: turn.id, turn_status: 'failed',
    created_at: normalizeTimestamp(turn.completedAt ?? turn.startedAt) };
}

function historyMessageFromItem(
  item,
  turn,
  index,
  sessionId,
  { includeToolActivity = false } = {},
) {
  const id = item.id ?? `${turn.id ?? "turn"}_${index}`;
  if (item.type === "userMessage") {
    const textParts = (item.content ?? []).filter(
      (part) => part.type === "text",
    );
    const content = textParts
      .map((part) => sanitizeUserMessageText(part.text ?? ""))
      .filter(Boolean)
      .join("\n");
    const imageAttachments = (item.content ?? [])
      .map((part, partIndex) =>
        imageAttachmentFromInput({
          part,
          partIndex,
          itemId: id,
          sessionId,
        }),
      )
      .filter(Boolean);
    const imageNames = new Set(
      imageAttachments.map((attachment) => attachment.name.toLocaleLowerCase()),
    );
    const fileAttachments = textParts
      .flatMap((part) => mentionedFilesFromUserText(part.text ?? ""))
      .filter(
        (file, index, files) =>
          !imageNames.has(file.name.toLocaleLowerCase()) &&
          files.findIndex((candidate) => candidate.path === file.path) ===
            index,
      )
      .map((file, index) =>
        fileAttachmentFromMention({
          file,
          fileIndex: index,
          itemId: id,
          sessionId,
        }),
      );
    const attachments = [...fileAttachments, ...imageAttachments];
    if (!content && !attachments.length) return null;
    return {
      id,
      role: "user",
      content,
      attachments,
      created_at: normalizeTimestamp(turn.startedAt),
      turn_id: turn.id ?? null,
      client_message_id: item.clientId ?? item.client_id ?? null,
    };
  }
  const agentMessageText = codexAgentMessageText(item);
  if (agentMessageText) {
    return {
      id,
      role: "codex",
      content: agentMessageText,
      created_at: normalizeTimestamp(turn.completedAt ?? turn.startedAt),
      turn_id: turn.id ?? null,
      message_phase: item.phase ?? null,
    };
  }
  if (item.type === "plan" && item.text) {
    return {
      id,
      role: "system",
      content: item.text,
      created_at: normalizeTimestamp(turn.startedAt),
      turn_id: turn.id ?? null,
      kind: "plan",
    };
  }
  if (includeToolActivity) {
    const explicitStatus = String(item.status ?? "").toLowerCase();
    const hasLaterItem = index < (turn.items?.length ?? 0) - 1;
    const completed = explicitStatus
      ? explicitStatus !== "inprogress"
      : turn.status !== "inProgress" || hasLaterItem;
    const activity = codexToolActivityEventFromItem(item, {
      completed,
      turnId: turn.id ?? null,
    });
    if (activity) {
      return {
        id: `command_${turn.id ?? "turn"}_${activity.item_id ?? id}`,
        role: "system",
        content: "",
        created_at: normalizeTimestamp(turn.completedAt ?? turn.startedAt),
        turn_id: turn.id ?? null,
        kind: "tool_activity",
        tool_activity_label: codexActivityFallbackLabel(activity),
        tool_activity_type: activity.activity_type ?? null,
        tool_activity_name: activity.activity_name ?? null,
        tool_activity_subject: activity.activity_subject ?? null,
        tool_activity_command: activity.command ?? null,
        tool_activity_count: activity.activity_count ?? null,
        tool_activity_detail: limitToolActivityDetail(activity.text),
        tool_activity_status: toolActivityEventStatus(activity),
        attachments: activity.relay_attachment
          ? [activity.relay_attachment]
          : [],
      };
    }
  }
  return null;
}

function userMessageEventFromCodexItem(item, { sessionId, turnId }) {
  if (normalizeCodexItemType(item?.type) !== "usermessage") return null;
  const normalizedItem = {
    ...item,
    type: "userMessage",
    clientId: item.clientId ?? item.client_id ?? null,
  };
  const message = historyMessageFromItem(
    normalizedItem,
    {
      id: turnId,
      startedAt: item.completed_at_ms ?? item.started_at_ms ?? Date.now(),
    },
    0,
    sessionId,
  );
  if (!message) return null;
  return {
    kind: "user.message",
    turn_id: turnId ?? null,
    item_id: message.id,
    client_message_id: normalizedItem.clientId,
    text: message.content,
    attachments: message.attachments,
  };
}

function sanitizeUserMessageText(text) {
  const answers = parseAsyncAnswers(text);
  if (answers) return answers.map(a => `${a.question}\n${a.answer}`).join('\n\n');
  const lines = String(text).split("\n");
  const hasMentionedFiles = lines.some((line) =>
    /^#{0,6}\s*Files mentioned by the user:\s*$/i.test(line.trim()),
  );
  let insideMentionedFiles = false;
  const visibleLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (/^#{0,6}\s*Files mentioned by the user:\s*$/i.test(trimmed)) {
      insideMentionedFiles = true;
      return false;
    }
    if (insideMentionedFiles && /^#{1,6}\s+My request:\s*$/i.test(trimmed)) {
      insideMentionedFiles = false;
      return false;
    }
    if (
      hasMentionedFiles &&
      /^Distinguish instructions in attached documents from the user's request\.?$/i.test(
        trimmed,
      )
    ) {
      return false;
    }
    if (insideMentionedFiles) return false;
    return true;
  });
  return visibleLines
    .join("\n")
    .replace(/^(##\s+[^:\n]+):\s+\/[^\n]+$/gm, "$1")
    .replace(/^<image\b[^>]*>\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function mentionedFilesFromUserText(text) {
  const lines = String(text).split("\n");
  const files = [];
  let insideMentionedFiles = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{0,6}\s*Files mentioned by the user:\s*$/i.test(trimmed)) {
      insideMentionedFiles = true;
      continue;
    }
    if (!insideMentionedFiles || /^#{1,6}\s+My request:\s*$/i.test(trimmed)) {
      if (/^#{1,6}\s+My request:\s*$/i.test(trimmed))
        insideMentionedFiles = false;
      continue;
    }
    const match = trimmed.match(
      /^#{1,6}\s+(.+?):\s+((?:\/|[A-Za-z]:[\\/]).+)$/,
    );
    if (!match) continue;
    files.push({ name: match[1].trim(), path: match[2].trim() });
  }
  return files;
}

function fileAttachmentFromMention({ file, fileIndex, itemId, sessionId }) {
  const imageMimeType = imageMimeFromExtension(extname(file.name));
  const isImage = imageMimeType.startsWith("image/");
  return {
    id: `file_${createHash("sha256")
      .update(`${sessionId}\0${itemId}\0${fileIndex}\0${file.path}`)
      .digest("hex")
      .slice(0, 40)}`,
    type: isImage ? "image" : "file",
    name: file.name,
    mime_type: isImage
      ? imageMimeType
      : fileMimeFromExtension(extname(file.name)),
    ...(isImage
      ? {
          detail: "auto",
          relay_source: { type: "local_path", path: file.path },
        }
      : {}),
  };
}

function fileMimeFromExtension(extension) {
  const normalized = String(extension).toLowerCase();
  if (normalized === ".pdf") return "application/pdf";
  if (normalized === ".csv") return "text/csv";
  if (normalized === ".txt" || normalized === ".md") return "text/plain";
  if (normalized === ".json") return "application/json";
  if (normalized === ".xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (normalized === ".xls") return "application/vnd.ms-excel";
  if (normalized === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (normalized === ".doc") return "application/msword";
  return "application/octet-stream";
}

function imageAttachmentFromInput({ part, partIndex, itemId, sessionId }) {
  let relaySource;
  let name = `图片-${partIndex + 1}`;
  let mimeType = "application/octet-stream";
  if (
    part?.type === "localImage" &&
    typeof part.path === "string" &&
    part.path
  ) {
    relaySource = { type: "local_path", path: part.path };
    name = basename(part.path) || name;
    mimeType = imageMimeFromExtension(extname(part.path));
  } else if (
    part?.type === "image" &&
    typeof part.url === "string" &&
    part.url.startsWith("data:")
  ) {
    relaySource = { type: "data_url", url: part.url };
    mimeType = part.url.slice(5, part.url.indexOf(";")) || mimeType;
    name = `图片-${partIndex + 1}.${extensionFromImageMime(mimeType)}`;
  } else {
    return null;
  }
  const id = `asset_${createHash("sha256")
    .update(
      `${sessionId}\0${itemId}\0${partIndex}\0${JSON.stringify(relaySource)}`,
    )
    .digest("hex")
    .slice(0, 40)}`;
  return {
    id,
    type: "image",
    name,
    mime_type: mimeType,
    detail: part.detail ?? null,
    relay_source: relaySource,
  };
}

function attachmentMetadata(attachments) {
  return attachments.map((attachment) => ({
    id: attachment.id,
    type: "image",
    name: attachment.name,
    mime_type: attachment.mime_type,
    detail: attachment.detail ?? null,
  }));
}

function imageMimeFromExtension(extension) {
  const normalized = String(extension).toLowerCase();
  if (normalized === ".png") return "image/png";
  if (normalized === ".jpg" || normalized === ".jpeg") return "image/jpeg";
  if (normalized === ".webp") return "image/webp";
  if (normalized === ".gif") return "image/gif";
  if (normalized === ".avif") return "image/avif";
  return "application/octet-stream";
}

function extensionFromImageMime(mimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/avif") return "avif";
  return "png";
}

function codexAgentPath(thread) {
  const source = thread?.source?.subAgent ?? thread?.source?.subagent;
  return thread?.agentPath ?? source?.thread_spawn?.agent_path ?? null;
}

function agentPathLabel(path) {
  const name = typeof path === 'string' ? path.split('/').filter(Boolean).at(-1) : null;
  return name?.replaceAll(/[_-]+/g, ' ') ?? null;
}

function agentDisplayName(thread, fallbackId) {
  return (
    customSessionTitle(thread?.name) ||
    agentPathLabel(codexAgentPath(thread)) ||
    thread?.agentNickname ||
    thread?.agentRole ||
    `Agent ${String(fallbackId).slice(0, 8)}`
  );
}

function isSubAgentActivityItem(item) {
  return normalizeCodexItemType(item?.type) === "subagentactivity";
}

function subAgentActivityFromItem(item) {
  if (!isSubAgentActivityItem(item)) return null;
  const threadId = item.agentThreadId ?? item.agent_thread_id;
  if (typeof threadId !== "string" || !threadId) return null;
  const kind = String(item.kind ?? "").toLowerCase();
  let status;
  if (["completed", "closed", "shutdown"].includes(kind)) {
    status = "completed";
  } else if (["failed", "errored", "error"].includes(kind)) {
    status = "errored";
  } else if (["interrupted", "cancelled", "canceled"].includes(kind)) {
    status = "interrupted";
  } else {
    status = "running";
  }
  return {
    threadId,
    kind,
    status,
    progress: kind === "started" ? 10 : progressFromCollabStatus(status),
    tool: kind === "started" ? "spawnAgent" : "subAgentActivity",
  };
}

function subAgentActivityName(item, thread, fallbackId) {
  return customSessionTitle(thread?.name) ||
    agentPathLabel(codexAgentPath(thread) ?? item?.agentPath ?? item?.agent_path) ||
    agentDisplayName(thread, fallbackId);
}

function subAgentActivityEvent(
  item,
  { rootSessionId, parentThreadId, receiver = null, workspace = null },
) {
  const activity = subAgentActivityFromItem(item);
  const kind =
    activity.kind === "started"
      ? "agent.started"
      : agentKindFromStatus(activity.status);
  return {
    kind,
    thread_id: activity.threadId,
    parent_thread_id: receiver?.parentThreadId ?? parentThreadId,
    root_session_id: rootSessionId,
    name: subAgentActivityName(item, receiver, activity.threadId),
    nickname: receiver?.agentNickname ?? null,
    role: receiver?.agentRole ?? null,
    task: receiver?.preview || "Codex 子 Agent",
    agent_status: activity.status,
    progress: activity.progress,
    summary: null,
    model: receiver?.model ?? null,
    reasoning_effort: receiver?.reasoningEffort ?? null,
    tool: activity.tool,
    tool_call_id: item.id ?? null,
    ...(workspace
      ? {
          cwd: workspace,
          project: basename(workspace),
          branch: receiver?.gitInfo?.branch ?? "—",
        }
      : {}),
  };
}

function collabStatusFromToolItem(item, agentState, completed) {
  if (agentState.status) return agentState.status;
  if (item.status === "failed") return "errored";
  if (!completed || item.status === "inProgress") return "running";
  if (item.tool === "closeAgent") return "shutdown";
  return "running";
}

function collabStatusFromTurn(status) {
  if (status === "failed") return "errored";
  if (status === "interrupted") return "interrupted";
  return "completed";
}

function agentStatusFromTurn(status) {
  if (!status) return null;
  if (status === "inProgress") return "running";
  return collabStatusFromTurn(status);
}

function statusFromThread(status) {
  if (status?.type === "active") return "running";
  if (status?.type === "idle") return "completed";
  if (status?.type === "systemError") return "errored";
  return "unknown";
}

function agentKindFromStatus(status) {
  if (["completed", "shutdown"].includes(status)) return "agent.completed";
  if (["errored", "notFound"].includes(status)) return "agent.failed";
  if (status === "interrupted") return "agent.interrupted";
  if (status === "pendingInit") return "agent.started";
  return "agent.progress";
}

function progressFromCollabStatus(status) {
  if (
    ["completed", "shutdown", "errored", "interrupted", "notFound"].includes(
      status,
    )
  ) {
    return 100;
  }
  if (status === "running") return 55;
  return 10;
}

async function historyFileFingerprint(path) {
  try {
    // Opening again checks current file access even when serving cached data.
    const handle = await open(path, 'r');
    try {
      const info = await handle.stat();
      return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    } finally { await handle.close(); }
  } catch (error) {
    rethrowFileAccessError(error);
    return null;
  }
}

async function readNativeHistorySupplement(path, sessionId, turnId, { deadline, endOffset, endBoundary, expectedIdentity } = {}) {
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  let readBytes = 0, scanBytes = 0, foldBytes = 0;
  let fragments = [], fragmentBytes = 0, skipIncomplete = null, startOffset = null;
  let frames = [];
  try {
    const info = await handle.stat();
    const identity = `${info.dev}:${info.ino}`;
    if (expectedIdentity && identity !== expectedIdentity)
      throw new Error('Codex history source changed during read. Retry history.');
    let position = Math.min(info.size, endOffset ?? info.size);
    let rangeEnd = position, rangeEndBoundary = endBoundary;
    const validationRanges = [];
    if (endBoundary) {
      if (!endBoundary.length) {
        if (position !== info.size) throw new Error('Invalid history cursor.');
      } else {
        const bytes = Buffer.alloc(endBoundary.length);
        const read = await handle.read(bytes, 0, bytes.length, position);
        readBytes += read.bytesRead;
        const record = parseJsonLine(bytes.toString('utf8'));
        if (read.bytesRead !== bytes.length || createHash('sha256').update(bytes).digest('hex') !== endBoundary.digest ||
            record?.type !== 'event_msg' || record.payload?.type !== 'task_started' || record.payload.turn_id === turnId)
          throw new Error('Invalid history cursor.');
      }
    }
    const header = Buffer.alloc(Math.min(info.size, 64 * 1024));
    const headerRead = await handle.read(header, 0, header.length, 0);
    readBytes += headerRead.bytesRead;
    const firstLineEnd = header.indexOf(10);
    if (firstLineEnd < 0) throw nativeHistorySourceUnavailable();
    const metadata = parseJsonLine(header.subarray(0, firstLineEnd).toString('utf8'));
    validationRanges.push({ offset: 0, length: firstLineEnd,
      digest: createHash('sha256').update(header.subarray(0, firstLineEnd)).digest('hex') });
    if (metadata?.type !== 'session_meta') throw nativeHistorySourceUnavailable();
    if (metadata.payload?.id !== sessionId)
      throw new Error('Codex history source does not match this conversation.');
    // Find an explicit persisted turn boundary, backwards, then fold that
    // range forwards with the established attachment/metadata projector.
    // Only offsets survive this pass; base64 bodies never enter the cache.
    scan: while (position > 0) {
      if (Date.now() >= deadline) throw new Error('Codex history read timed out.');
      const length = Math.min(MAX_ROLLOUT_READ_BYTES, Math.max(64 * 1024, fragmentBytes), position);
      position -= length;
      const buffer = Buffer.alloc(length);
      const result = await handle.read(buffer, 0, length, position);
      if (result.bytesRead !== length) throw new Error('Codex history source changed during read. Retry history.');
      readBytes += length;
      scanBytes += length;
      skipIncomplete ??= buffer.at(-1) !== 10;
      let end = length;
      for (let newline = buffer.lastIndexOf(10, end - 1); newline >= 0; newline = end > 0 ? buffer.lastIndexOf(10, end - 1) : -1) {
        const part = buffer.subarray(newline + 1, end);
        const size = part.length + fragmentBytes;
        if (size > 64 * 1024 * 1024) throw nativeHistorySourceUnavailable();
        const line = Buffer.concat([part, ...fragments], size);
        fragments = []; fragmentBytes = 0;
        const offset = position + newline + 1;
        end = newline;
        if (!line.length) continue;
        if (skipIncomplete) { skipIncomplete = false; continue; }
        const text = line.toString('utf8');
        if (!text.includes('"turn_context"') && !text.includes('"task_started"') &&
            !text.includes('"task_complete"') && !text.includes('"turn_aborted"') &&
            !text.includes('"final_answer"') && !text.includes('"input_image"') &&
            !text.includes('"request_user_input_async"') && !text.includes('"user_message"') &&
            !(text.includes('"function_call_output"') && text.includes('accepted')) &&
            !/"role"\s*:\s*"user"/.test(text) &&
            !(text.includes('"item_completed"') && /"type"\s*:\s*"(?:user_?message|agent_?message)"/i.test(text)) &&
            !text.includes('\\u')) continue;
        const record = text.includes('"task_started"') ? parseJsonLine(text) : null;
        if (record?.type === 'event_msg' && record.payload?.type === 'task_started') {
          if (record.payload.turn_id === turnId) {
            frames.push({ offset, length: size, digest: createHash('sha256').update(line).digest('hex') });
            startOffset = offset;
            break scan;
          }
          // A cursor can open an older turn directly. Ignore the newer source
          // turns scanned on the way to its end boundary.
          frames = [];
          rangeEnd = offset;
          rangeEndBoundary = { length: size, digest: createHash('sha256').update(line).digest('hex') };
        } else frames.push({ offset, length: size, digest: createHash('sha256').update(line).digest('hex') });
        if (end === 0) break;
      }
      if (end > 0) {
        fragments.unshift(buffer.subarray(0, end));
        fragmentBytes += end;
        if (fragmentBytes > 64 * 1024 * 1024) throw nativeHistorySourceUnavailable();
      }
    }
    if (startOffset === null) throw nativeHistorySourceUnavailable();
    const state = createRolloutHistoryState(sessionId);
    state.sessionId = sessionId;
    for (const frame of frames.reverse()) {
      if (Date.now() >= deadline) throw new Error('Codex history read timed out.');
      const bytes = Buffer.alloc(frame.length);
      const result = await handle.read(bytes, 0, frame.length, frame.offset);
      if (result.bytesRead !== frame.length) throw new Error('Codex history source changed during read. Retry history.');
      readBytes += result.bytesRead;
      foldBytes += result.bytesRead;
      if (createHash('sha256').update(bytes).digest('hex') !== frame.digest)
        throw new Error('Codex history source changed during read. Retry history.');
      const record = parseJsonLine(bytes.toString('utf8'));
      if (!record) throw nativeHistorySourceUnavailable();
      foldRolloutHistoryRecord(record, state, { path, identity, ...frame });
    }
    validationRanges.push(...frames);
    return { state: structuredClone(state), startOffset, startBoundary: frames[0], endOffset: rangeEnd,
      endBoundary: rangeEndBoundary, validationRanges, records: frames.length, readBytes,
      rangeBytes: rangeEnd - startOffset, scanBytes, foldBytes };
  } finally { await handle.close(); }
}

async function validateNativeHistorySnapshot(path, ranges, fingerprint, deadline) {
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!fingerprint.startsWith(`${info.dev}:${info.ino}:`))
      throw new Error('Codex history source changed during read. Retry history.');
    for (const range of ranges) {
      if (Date.now() >= deadline) throw new Error('Codex history read timed out.');
      const bytes = Buffer.alloc(range.length);
      const result = await handle.read(bytes, 0, bytes.length, range.offset);
      if (result.bytesRead !== bytes.length || createHash('sha256').update(bytes).digest('hex') !== range.digest)
        throw new Error('Codex history source changed during read. Retry history.');
    }
  } finally { await handle.close(); }
}

function nativeHistorySourceUnavailable() {
  return Object.assign(new Error('Codex history page source boundaries are unavailable.'), {
    code: 'RELAY_NATIVE_HISTORY_SOURCE_UNAVAILABLE',
  });
}

function paginateHistory(messages, { limit, before, maxBytes }) {
  const pageSize = Math.min(500, Math.max(1, Number(limit) || 100));
  let end = messages.length;
  if (before) {
    const cursor = decodeHistoryCursor(before);
    const index = messages.findIndex((message) => message.id === cursor.before_id);
    if (index >= 0) {
      end = index;
    } else {
      // Tool rows roll out of the bounded live-turn window. A surviving row
      // on the already displayed page is a safe, overlapping boundary. If
      // the entire page was transient, replay the same turn before continuing
      // backwards; clients merge duplicate IDs. Never skip to an older turn.
      const successor = (cursor.after_ids ?? [])
        .map(id => messages.findIndex(message => message.id === id))
        .find(position => position >= 0);
      // v1 tool IDs already embed their turn. Existing mobile cursors can
      // recover this case immediately after a Desktop upgrade as well.
      const turnId = cursor.turn_id ?? messages.find(message =>
        message.turn_id && cursor.before_id.startsWith(`command_${message.turn_id}_`),
      )?.turn_id;
      const turnEnd = turnId
        ? messages.findLastIndex(message => message.turn_id === turnId)
        : -1;
      if (successor !== undefined) end = successor;
      else if (turnEnd >= 0) end = turnEnd + 1;
      else throw new Error("History cursor is no longer valid.");
    }
  }
  let start = Math.max(0, end - pageSize);
  const budget = Number.isFinite(maxBytes) && maxBytes > 0
    ? Math.min(1024 * 1024, Math.max(16 * 1024, maxBytes)) : Infinity;
  let bytes = 2;
  for (let index = end - 1; Number.isFinite(budget) && index >= start; index -= 1) {
    // Attachment bodies stay on the computer and must not count as downloads.
    const { attachments, ...message } = messages[index];
    const publicMessage = { ...message, ...(attachments ? {
      attachments: attachments.map(attachment => {
        const value = { ...attachment };
        delete value.relay_source;
        return value;
      }),
    } : {}) };
    const size = Buffer.byteLength(JSON.stringify(publicMessage)) + 1;
    // Always return at least one whole message, even if it exceeds the budget.
    if (index < end - 1 && bytes + size > budget) { start = index + 1; break; }
    bytes += size;
  }
  const page = messages.slice(start, end);
  return {
    messages: page,
    next_cursor:
      start > 0 && page.length ? encodeHistoryCursor(page) : null,
    has_more: start > 0,
  };
}

function encodeHistoryCursor(page) {
  return Buffer.from(JSON.stringify({
    v: 2,
    before_id: page[0].id,
    turn_id: page[0].turn_id ?? null,
    // Prefer durable messages rather than other rows in the tool window.
    after_ids: page.slice(1).filter(message => message.kind !== "tool_activity")
      .slice(0, 8).map(message => message.id),
  })).toString(
    "base64url",
  );
}

function decodeHistoryCursor(cursor) {
  try {
    const decoded = JSON.parse(
      Buffer.from(String(cursor), "base64url").toString("utf8"),
    );
    if (![1, 2].includes(decoded.v) || typeof decoded.before_id !== "string" ||
        (decoded.v >= 2 &&
          ((decoded.turn_id !== null && typeof decoded.turn_id !== "string") ||
          !Array.isArray(decoded.after_ids) || decoded.after_ids.length > 8 ||
          decoded.after_ids.some(id => typeof id !== "string"))) ||
        (Object.hasOwn(decoded, 'native_turn_cursor') && (typeof decoded.session_id !== 'string' ||
          (decoded.native_turn_cursor !== null && typeof decoded.native_turn_cursor !== 'string'))) ||
        (Object.hasOwn(decoded, 'source_end_offset') && (!Number.isSafeInteger(decoded.source_end_offset) ||
          decoded.source_end_offset < 0 || typeof decoded.source_fingerprint !== 'string' ||
          !Number.isSafeInteger(decoded.source_end_length) || decoded.source_end_length < 0 || decoded.source_end_length > 64 * 1024 * 1024 ||
          (decoded.source_end_length ? !/^[a-f0-9]{64}$/.test(decoded.source_end_digest) : decoded.source_end_digest !== null))))
      throw new Error();
    return decoded.v === 1 ? { before_id: decoded.before_id } : decoded;
  } catch {
    throw new Error("Invalid history cursor.");
  }
}

function validateNativeHistoryPage(result) {
  if (!Array.isArray(result?.data) ||
      (result.nextCursor != null && typeof result.nextCursor !== 'string'))
    throw new Error('Invalid Codex history page.');
}

function normalizeTimestamp(value) {
  if (typeof value === "number") {
    return new Date(
      value > 10_000_000_000 ? value : value * 1000,
    ).toISOString();
  }
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return new Date().toISOString();
}

function normalizeCodexDailyUsage(value) {
  if (!Array.isArray(value)) return [];
  const buckets = new Map();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const parsedTokens =
      typeof item.tokens === "string" ? Number(item.tokens) : item.tokens;
    if (
      !Number.isSafeInteger(parsedTokens) ||
      parsedTokens < 0 ||
      typeof item.startDate !== "string"
    ) {
      continue;
    }
    const parsedDate = Date.parse(item.startDate);
    if (Number.isNaN(parsedDate)) continue;
    const date = new Date(parsedDate).toISOString().slice(0, 10);
    buckets.set(date, parsedTokens);
  }
  return [...buckets]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, total_tokens]) => ({ date, total_tokens }));
}

function mergeDailyUsageMaximum(daily, date, totalTokens) {
  if (!Number.isSafeInteger(totalTokens) || totalTokens < 0) return;
  const bucket = daily.find((item) => item.date === date);
  if (bucket) {
    bucket.total_tokens = Math.max(bucket.total_tokens, totalTokens);
    return;
  }
  if (totalTokens === 0) return;
  daily.push({ date, total_tokens: totalTokens });
  daily.sort((left, right) => left.date.localeCompare(right.date));
}

async function findRecentCodexRollouts(root, modifiedSince) {
  return (await findRecentCodexRolloutsWithInfo(root, modifiedSince)).map(
    (entry) => entry.path,
  );
}

async function findRecentCodexRolloutsWithInfo(root, modifiedSince) {
  const found = [];
  const directories = [root];
  while (directories.length) {
    const directory = directories.pop();
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    const files = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        directories.push(path);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(path);
      }
    }
    const results = await Promise.allSettled(
      files.map(async (path) => ({ path, info: await stat(path) })),
    );
    for (const result of results) {
      if (
        result.status === "fulfilled" &&
        result.value.info.mtimeMs >= modifiedSince
      ) {
        found.push(result.value);
      }
    }
  }
  return found;
}

function createCodexRolloutUsageState() {
  return {
    offset: 0,
    fragment: "",
    sessionId: null,
    lastTotalBySession: new Map(),
    todayTokens: 0,
  };
}

function foldCodexRolloutUsageLine(line, state, day, path) {
  if (line.includes('"type":"session_meta"')) {
    const record = parseJsonLine(line);
    if (typeof record?.payload?.id === "string" && record.payload.id) {
      state.sessionId = record.payload.id;
    }
    return;
  }
  if (
    !line.includes('"type":"event_msg"') ||
    !line.includes('"type":"token_count"') ||
    !line.includes('"total_token_usage"')
  ) {
    return;
  }
  const record = parseJsonLine(line);
  if (
    record?.type !== "event_msg" ||
    record.payload?.type !== "token_count"
  ) {
    return;
  }
  const totalTokens = safeTokenCount(
    record.payload.info?.total_token_usage?.total_tokens,
  );
  const timestamp = new Date(record.timestamp);
  if (totalTokens === null || Number.isNaN(timestamp.getTime())) return;

  const sessionKey = state.sessionId ?? path;
  const previous = state.lastTotalBySession.get(sessionKey);
  state.lastTotalBySession.set(sessionKey, totalTokens);
  if (localDateKey(timestamp) !== day) return;
  // token_count records are cumulative snapshots and can repeat unchanged.
  const increment =
    previous === undefined || totalTokens < previous
      ? totalTokens
      : totalTokens - previous;
  const next = safeTokenSum(state.todayTokens, increment);
  if (next !== null) state.todayTokens = next;
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

export async function verifyUserMessageFromIndependentAppServer({
  codexBin,
  workspace,
  sessionId,
  content,
  clientMessageId,
}) {
  const child = spawn(
    codexBin,
    ["app-server"],
    agentSpawnOptions(codexBin, {
      cwd: workspace,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    }),
  );
  const lineReader = createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });
  const pending = new Map();
  let nextId = 1;
  let timeout;
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    });
  const fail = (error) => {
    for (const operation of pending.values()) operation.reject(error);
    pending.clear();
  };
  lineReader.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id === undefined || message.method) return;
    const operation = pending.get(message.id);
    if (!operation) return;
    pending.delete(message.id);
    if (message.error) operation.reject(new Error(message.error.message));
    else operation.resolve(message.result);
  });
  child.stderr.resume();
  child.once("error", fail);
  child.once("exit", () =>
    fail(new Error("Cross-client Codex verifier exited.")),
  );
  try {
    timeout = setTimeout(
      () => fail(new Error("Cross-client Codex verification timed out.")),
      5_000,
    );
    await request("initialize", {
      clientInfo: {
        name: "relayune_cross_client_verifier",
        title: "Relayune Cross-client Verifier",
        version: "0.3.33",
      },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(
      `${JSON.stringify({ method: "initialized", params: {} })}\n`,
    );
    const result = await request("thread/read", {
      threadId: sessionId,
      includeTurns: true,
    });
    const thread = result.thread ?? result;
    return (thread.turns ?? []).some((turn) =>
      (turn.items ?? []).some((item) => {
        if (item.type !== "userMessage") return false;
        if (clientMessageId && item.clientId === clientMessageId) return true;
        return (item.content ?? []).some(
          (part) => part.type === "text" && part.text === content,
        );
      }),
    );
  } catch (error) {
    if (process.env.CODEX_RELAY_DEBUG === "1") {
      process.stderr.write(
        `[codex-cross-client-verifier] ${
          error instanceof Error ? error.message : "unknown error"
        }\n`,
      );
    }
    return false;
  } finally {
    clearTimeout(timeout);
    lineReader.close();
    child.kill();
  }
}

async function readCodexUsageFromIndependentAppServer({ codexBin, workspace }) {
  const adapter = new CodexAppServerAdapter({
    codexBin,
    workspace,
  });
  let timeout;
  const operation = (async () => {
    await adapter.start({
      emitEvent: async () => {},
      requestApproval: async () => {},
    });
    return adapter.request("account/usage/read", {});
  })();
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error("Independent Codex usage read timed out.")),
      CODEX_INDEPENDENT_USAGE_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timeout);
    await adapter.close();
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "unknown error";
}

function codexForkError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function resolveCodexBinary(explicit, {
  platform = process.platform,
  environment = process.env,
  home = homedir(),
  exists = existsSync,
} = {}) {
  if (explicit) return explicit;
  if (environment.CODEX_BIN) return environment.CODEX_BIN;
  const managedCandidates =
    platform === "darwin"
      ? [
          join(home, ".codex", "packages", "standalone", "current", "bin", "codex"),
          "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
          "/Applications/ChatGPT.app/Contents/Resources/codex",
          join(home, ".codex", "plugins", ".plugin-appserver", "codex"),
        ]
      : platform === "win32"
        ? [
            join(
              home,
              ".codex",
              "plugins",
              ".plugin-appserver",
              "codex.exe",
            ),
          ]
        : [];
  return (
    managedCandidates.find((candidate) => exists(candidate)) ?? "codex"
  );
}
