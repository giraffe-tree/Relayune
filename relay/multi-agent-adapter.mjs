import { isFileAccessError } from "./file-access.mjs";

export class MultiAgentAdapter {
  constructor(options = {}) {
    this.adapters = new Map(
      Object.entries(options.adapters ?? {}).filter(([, adapter]) => adapter),
    );
    this.defaultProvider = options.defaultProvider ?? "kimi";
    this.readyProviders = new Set();
    this.providerErrors = new Map();
    this.sessionCatalogs = new Map();
    this.projectCatalogs = new Map();
    this.projectErrors = new Map();
    this.sessionProviders = new Map();
    this.approvalProviders = new Map();
    this.handlers = null;
    this.closed = false;
  }

  async start(handlers) {
    this.handlers = handlers;
    this.closed = false;
    const results = await Promise.allSettled(
      [...this.adapters].map(async ([provider, adapter]) => {
        await this.startProvider(provider, adapter);
        this.readyProviders.add(provider);
        this.providerErrors.delete(provider);
        return provider;
      }),
    );

    results.forEach((result, index) => {
      if (result.status === "fulfilled") return;
      const provider = [...this.adapters.keys()][index];
      this.providerErrors.set(provider, result.reason);
    });
    if (!this.readyProviders.size && !this.fileAccessLimited()) {
      throw new AggregateError(
        [...this.providerErrors.values()],
        "No configured local agent could be started.",
      );
    }
  }

  async startProvider(provider, adapter) {
    await adapter.start({
      registerRecoveredAttachments: this.handlers.registerRecoveredAttachments,
      readAttachmentCheckpoint: this.handlers.readAttachmentCheckpoint,
      writeAttachmentCheckpoint: this.handlers.writeAttachmentCheckpoint,
      ...(provider === "codex" ? {
        loadCodexQueueReceipts: this.handlers.loadCodexQueueReceipts,
        saveCodexQueueReceipt: this.handlers.saveCodexQueueReceipt,
        removeCodexQueueReceipt: this.handlers.removeCodexQueueReceipt,
        loadCodexMessageReceipts: this.handlers.loadCodexMessageReceipts,
        saveCodexMessageReceipt: this.handlers.saveCodexMessageReceipt,
        removeCodexMessageReceipt: this.handlers.removeCodexMessageReceipt,
      } : {}),
      emitEvent: async (sessionId, event, extra) => {
        this.sessionProviders.set(sessionId, provider);
        await this.handlers.emitEvent(
          sessionId,
          { ...event, provider: event.provider ?? provider },
          extra,
        );
      },
      requestApproval: async (approval) => {
        this.sessionProviders.set(approval.session_id, provider);
        this.approvalProviders.set(approval.approval_id, provider);
        await this.handlers.requestApproval({
          ...approval,
          provider,
        });
      },
    });
  }

  async retryFileAccess() {
    // Retry only providers whose startup failed on local file access. Healthy
    // agents and their running tasks keep their existing processes.
    for (const [provider, error] of this.providerErrors) {
      if (this.readyProviders.has(provider) || !isFileAccessError(error)) continue;
      const adapter = this.adapters.get(provider);
      try {
        if (this.closed) return;
        await adapter.close?.();
        if (this.closed) return;
        await this.startProvider(provider, adapter);
        if (this.closed) {
          await adapter.close?.();
          return;
        }
        this.readyProviders.add(provider);
        this.providerErrors.delete(provider);
      } catch (error) {
        this.providerErrors.set(provider, error);
      }
    }
  }

  catalogWatchPaths() {
    return [...this.readyProviders].flatMap(provider => this.adapters.get(provider).catalogWatchPaths?.() ?? []);
  }

  async listSessions() {
    const results = await Promise.allSettled(
      [...this.readyProviders].map(async (provider) => {
        const sessions = await this.adapters.get(provider).listSessions();
        return sessions.map((session) => this.decorateSession(session, provider));
      }),
    );
    const sessions = [];
    results.forEach((result, index) => {
      const provider = [...this.readyProviders][index];
      if (result.status === "fulfilled") {
        this.providerErrors.delete(provider);
        this.sessionCatalogs.set(provider, result.value);
        sessions.push(...result.value);
      } else {
        this.providerErrors.set(provider, result.reason);
        sessions.push(...(this.sessionCatalogs.get(provider) ?? []));
      }
    });
    return sessions.sort(
      (left, right) =>
        Date.parse(right.updated_at) - Date.parse(left.updated_at),
    );
  }

  fileAccessLimited() {
    return [...this.providerErrors.values(), ...this.projectErrors.values()].some(error => isFileAccessError(error))
      || [...this.readyProviders].some(provider => this.adapters.get(provider).fileAccessLimited?.());
  }

  async listProjects() {
    const results = await Promise.allSettled(
      [...this.readyProviders].map(async (provider) => {
        const adapter = this.adapters.get(provider);
        if (typeof adapter.listProjects !== "function") return [];
        const projects = await adapter.listProjects();
        return projects.map((project) => ({ ...project, provider }));
      }),
    );
    const projects = [];
    results.forEach((result, index) => {
      const provider = [...this.readyProviders][index];
      if (result.status === "fulfilled") {
        this.projectErrors.delete(provider);
        this.projectCatalogs.set(provider, result.value);
        projects.push(...result.value);
      } else {
        this.projectErrors.set(provider, result.reason);
        projects.push(...(this.projectCatalogs.get(provider) ?? []));
      }
    });
    return projects;
  }

  async readUsage() {
    const results = await Promise.allSettled(
      [...this.readyProviders].map(async (provider) => {
        const adapter = this.adapters.get(provider);
        if (typeof adapter.readUsage !== "function") {
          return { provider, snapshot: null };
        }
        const usage = await adapter.readUsage();
        return {
          provider,
          snapshot:
            usage?.[provider] && typeof usage[provider] === "object"
              ? usage[provider]
              : null,
        };
      }),
    );
    const usage = {};
    for (const result of results) {
      if (result.status !== "fulfilled" || !result.value.snapshot) continue;
      usage[result.value.provider] = result.value.snapshot;
    }
    return usage;
  }

  async createSession({ cwd, name, provider }) {
    const selected = this.selectProvider(provider);
    const session = await this.adapters.get(selected).createSession({ cwd, name });
    return this.decorateSession(session, selected);
  }

  forkCapabilities(session) {
    const provider = session.provider ?? this.sessionProviders.get(session.id);
    return this.adapters.get(provider)?.forkCapabilities?.(session) ?? null;
  }

  async forkSource(options) {
    const provider = await this.providerForSession(options.sessionId);
    const adapter = this.adapters.get(provider);
    if (typeof adapter.forkSource !== "function") throw new Error("session_fork_unsupported");
    return this.decorateSession(await adapter.forkSource(options), provider);
  }

  async forkSession(options) {
    const provider = await this.providerForSession(options.sessionId);
    const adapter = this.adapters.get(provider);
    if (typeof adapter.forkSession !== "function") throw new Error("session_fork_unsupported");
    return this.decorateSession(await adapter.forkSession(options), provider);
  }

  async supportsProjects(provider) {
    return this.readyProviders.has(provider) && Boolean(await this.adapters.get(provider)?.supportsProjects?.());
  }

  async createProject({ provider, ...options }) {
    const selected = this.selectProvider(provider);
    const project = await this.adapters.get(selected).createProject(options);
    return { ...project, provider: selected };
  }

  async finalizeSessionCreation(session) {
    const provider =
      session.provider ?? (await this.providerForSession(session.id));
    const adapter = this.adapters.get(provider);
    if (typeof adapter.finalizeSessionCreation !== "function") return session;
    const finalized = await adapter.finalizeSessionCreation(session);
    return this.decorateSession(finalized, provider);
  }

  async readHistory(options) {
    const provider = await this.providerForSession(options.sessionId);
    const history = await this.adapters.get(provider).readHistory(options);
    return {
      ...history,
      messages: (history.messages ?? []).map((message) => ({
        ...message,
        provider: message.provider ?? provider,
      })),
      sessions: (history.sessions ?? []).map((session) =>
        this.decorateSession(session, provider),
      ),
    };
  }

  async readAgents(options) {
    const provider = await this.providerForSession(options.sessionId);
    const adapter = this.adapters.get(provider);
    if (typeof adapter.readAgents === "function") {
      return adapter.readAgents(options);
    }
    const history = await adapter.readHistory({
      ...options,
      limit: 1,
      before: null,
    });
    return history.agents ?? [];
  }

  async userMessageId(options) {
    const provider = await this.providerForSession(options.sessionId);
    return this.adapters.get(provider).userMessageId?.(options) ?? null;
  }

  async submitMessage(options) {
    const provider = await this.providerForSession(options.sessionId);
    if (options.action === 'continue' && provider !== 'codex')
      throw new Error('Task continuation is only supported for Codex.');
    return this.adapters.get(provider).submitMessage(options);
  }

  async interruptTurn(options) {
    const provider = await this.providerForSession(options.sessionId);
    return this.adapters.get(provider).interruptTurn(options);
  }

  async configureSession(options) {
    const provider = await this.providerForSession(options.sessionId);
    const adapter = this.adapters.get(provider);
    if (typeof adapter.configureSession !== "function") {
      throw new Error(`${provider} does not expose session configuration.`);
    }
    return adapter.configureSession(options);
  }

  async resolveApproval(options) {
    const provider =
      this.approvalProviders.get(options.approvalId) ??
      (options.approvalId.startsWith("apr_pi_")
        ? "pi"
        : options.approvalId.startsWith("apr_mcode_")
        ? "mcode"
        : options.approvalId.startsWith("apr_zcode_")
        ? "zcode"
        : options.approvalId.startsWith("apr_opencode_")
        ? "opencode"
        : options.approvalId.startsWith("apr_kimi_")
        ? "kimi"
        : options.approvalId.startsWith("apr_claude_cowork_")
          ? "claude-cowork"
        : options.approvalId.startsWith("apr_claude_")
          ? "claude"
          : "codex");
    const adapter = this.requireProvider(provider);
    try {
      return await adapter.resolveApproval(options);
    } finally {
      this.approvalProviders.delete(options.approvalId);
    }
  }

  async createAgents(options) {
    const provider = await this.providerForSession(options.sessionId);
    return this.adapters.get(provider).createAgents(options);
  }

  async close() {
    this.closed = true;
    await Promise.allSettled(
      [...this.adapters.values()].map((adapter) => adapter.close()),
    );
    this.readyProviders.clear();
    this.sessionProviders.clear();
    this.approvalProviders.clear();
  }

  status() {
    return Object.fromEntries(
      [...this.adapters.keys()].map((provider) => [
        provider,
        {
          ready: this.readyProviders.has(provider),
          error: this.providerErrors.get(provider)?.message ?? null,
        },
      ]),
    );
  }

  decorateSession(session, provider) {
    this.sessionProviders.set(session.id, provider);
    const fork = this.adapters.get(provider)?.forkCapabilities?.(session);
    return {
      ...session,
      provider,
      supports_steering:
        session.supports_steering ?? provider === "codex",
      ...(fork?.mode ? { fork_mode: fork.mode } : {}),
    };
  }

  async providerForSession(sessionId) {
    const known = this.sessionProviders.get(sessionId);
    if (known) return known;
    await this.listSessions();
    const discovered = this.sessionProviders.get(sessionId);
    if (discovered) return discovered;
    // A bounded recent-session list cannot prove that an older session is gone.
    // Only providers with a read-only exact lookup may resolve a catalog miss.
    const errors = [];
    for (const provider of this.readyProviders) {
      const adapter = this.adapters.get(provider);
      if (typeof adapter.findSession !== "function") continue;
      try {
        const session = await adapter.findSession(sessionId);
        if (session?.id === sessionId) {
          this.decorateSession(session, provider);
          return provider;
        }
      } catch (error) {
        errors.push(error);
      }
    }
    // Preserve access/transport errors instead of claiming the session is gone.
    if (errors.length) throw errors[0];
    throw new Error(
      `Session ${sessionId} is not available in any configured local agent.`,
    );
  }

  selectProvider(provider) {
    const selected = provider ?? this.defaultProvider;
    this.requireProvider(selected);
    return selected;
  }

  requireProvider(provider) {
    const adapter = this.adapters.get(provider);
    if (!adapter || !this.readyProviders.has(provider)) {
      const reason = this.providerErrors.get(provider);
      throw new Error(
        `${providerName(provider)} is unavailable${
          reason?.message ? `: ${reason.message}` : "."
        }`,
      );
    }
    return adapter;
  }
}

function providerName(provider) {
  if (provider === "pi") return "Pi";
  if (provider === "mcode") return "MiniMax Code";
  if (provider === "zcode") return "ZCode";
  if (provider === "opencode") return "OpenCode";
  if (provider === "kimi") return "Kimi Code";
  if (provider === "claude-cowork") return "Claude Cowork";
  if (provider === "claude") return "Claude Code";
  return "Codex";
}
