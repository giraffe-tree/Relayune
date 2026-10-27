import { CatalogRefresh } from './catalog-refresh.mjs';
import { LocalWebProxy } from './local-web-proxy.mjs';
import { transportPayloadExpired } from "../shared/relay-retention.mjs";
import { DISABLED_PERFORMANCE_DIAGNOSTICS } from './performance-diagnostics.mjs';
import { SessionDirectory, SESSION_DIRECTORY_LIMIT } from './session-directory.mjs';
import { DIRECT_COMMAND_TYPES, DIRECT_READ_TYPES } from "./webrtc-transport.mjs";
import { DeltaCoalescer } from "./delta-coalescer.mjs";
import { IosPushState } from "./ios-push.mjs";
import { shouldNotifyPhone } from "./push-hint.mjs";
import { createHistoryPerformanceRecorder } from './history-performance.mjs';
import { createAgentRuntimeInfoReader } from "./agent-runtime-info.mjs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { mkdtemp, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { canonicalJson, createId, hashAction } from "./protocol.mjs";
import { importE2eeKey, keyIdForKey, openJson, sealJson } from "./e2ee.mjs";
import { RelayOutbox } from "./outbox.mjs";
import { OnlineRelayTransport, ONLINE_TOTAL_EVENT_BYTES } from "./online-transport.mjs";
import { CodexHookBridge } from "./codex-hook-bridge.mjs";
import { LocalProjectStore, ProjectManager } from "./project-manager.mjs";
import { canCreateSessionWorktree, createSessionWorktree } from "./session-worktree.mjs";
import { isCodexVisualizationPath, normalizeVisualizationReferences } from "./visualization-references.mjs";

import { isFileAccessError } from "./file-access.mjs";
import {compactHistoryMessage, encryptedHistoryFrameBytes, encryptedHistoryWireBytes, historyWireBudget} from './history-wire-budget.mjs';
import {readRolloutAttachmentDataUrl} from './codex-rollout-history-index.mjs';

const HISTORY_TIMING = Symbol("historyTiming");
const HISTORY_WIRE_BUDGET = Symbol('historyWireBudget');

const CATALOG_DELIVERY_VERSION = Symbol("catalogDeliveryVersion");

// Match server/relay-api.ts: a push is rejected atomically if any envelope
// exceeds its route limit. Do not let a changing oversized catalog repeatedly
// shrink healthy live-event batches. Responses have a separate, larger limit.
const MAX_PUSH_ENVELOPE_BYTES = 512_000;
const MAX_PUSH_RESPONSE_ENVELOPE_BYTES = 40 * 1024 * 1024;
const READ_ONLY_COMMAND_TYPES = new Set([...DIRECT_READ_TYPES, 'session.read_agents',
  'project.sessions', 'project.locations', 'project.check', 'project.browse']);

const MAX_SESSION_NAME_LENGTH = 80;
const MAX_PREVIEW_FILE_BYTES = 1024 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 1024 * 1024;
const IMAGE_PREVIEW_LANDSCAPE_WIDTH = 1280;
const IMAGE_PREVIEW_LANDSCAPE_HEIGHT = 720;
const IMAGE_PREVIEW_JPEG_QUALITY = 85;
const MAX_REFERENCED_FILES_PER_MESSAGE = 12;
const execFileAsync = promisify(execFile);
const UTF8_PREVIEW_MIME_TYPES = new Set([
  "text/html",
  "text/markdown",
  "text/plain",
  "text/csv",
  "text/tab-separated-values",
  "application/json",
  "application/x-ndjson",
  "application/yaml",
  "application/toml",
  "application/xml",
  "image/svg+xml",
]);
const PLAIN_TEXT_PREVIEW_EXTENSIONS = new Set([
  ".text",
  ".log",
  ".diff",
  ".patch",
  ".rst",
  ".tex",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".vue",
  ".svelte",
  ".astro",
  ".dart",
  ".py",
  ".rb",
  ".php",
  ".java",
  ".kt",
  ".kts",
  ".swift",
  ".go",
  ".rs",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".cxx",
  ".hpp",
  ".cs",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".sql",
  ".graphql",
  ".gql",
  ".proto",
  ".gradle",
  ".lock",
]);
const EXTENSIONLESS_TEXT_PREVIEW_NAMES = new Set([
  "dockerfile",
  "makefile",
  "gemfile",
  "podfile",
  "rakefile",
  "procfile",
  "brewfile",
  "license",
  "readme",
  "changelog",
  "notice",
]);

export class MacRelay {
  constructor(options) {
    this.sessionDirectory = new SessionDirectory();
    this.directoryClients = new Map();
    this.directRequests = new Map();
    this.directSends = new Map();
    this.directHost = null;
    this.directEvents = new Map();
    this.onlineTransport = null;
    this.onlineTransportEnabled = false;
    this.notificationEvents = new Map();
    this.notificationEventBytes = 0;
    this.authorizationObservedAt = 0;
    this.historyCommandReceivedAt = new Map();
    this.remoteCommandTasks = new Map();
    this.remoteSessionCommands = new Map();
    this.usageCatalog = {};
    this.usageCatalogRead = null;
    this.usageCatalogTimeoutMs = options.usageCatalogTimeoutMs ?? 1000;
    this.serverUrl = options.serverUrl;
    this.deviceId = options.deviceId ?? "dev_local_mac";
    this.deviceToken = options.deviceToken ?? "dev-device-token";
    this.desktopInfo = {
      local_web_version: 1,
      attachment_ranges_version: 1,
      session_directory_version: 1,
      directory_push_version: 1,
      version: options.desktopVersion?.trim() || null,
      platform: process.platform,
      transports: ["webrtc-session-v2", "webrtc-auto-v1", "webrtc-trickle-v1", "online-stream-v1"],
    };
    this.browserKeySources = options.browserKeys ?? [];
    this.browserKeys = new Map();
    this.activeBrowserKeys = new Map();
    this.requestBrowsers = new Map();
    this.pollIntervalMs = options.pollIntervalMs ?? 750;
    this.commandWaitMs = 0;
    this.commandPolling = false;
    this.pollAbort = null;
    this.remoteFetchTimeoutMs = options.remoteFetchTimeoutMs ?? 15_000;
    this.adapter = options.adapter;
    this.performanceDiagnostics = options.performanceDiagnostics ?? DISABLED_PERFORMANCE_DIAGNOSTICS;
    this.iosPushState = new IosPushState();
    this.readAgentRuntimeInfo = options.readAgentRuntimeInfo ?? createAgentRuntimeInfoReader(this.adapter);
    this.projectWorkspace = options.workspace ?? this.adapter.workspace;
    this.projectManager = new ProjectManager({
      adapter: this.adapter,
      defaultLocation: this.projectWorkspace,
      loadOperation: async (id) => {
        const stored = this.outbox.projectOperations[id];
        if (!stored) return null;
        const browser = [...this.activeBrowserKeys.values()].find(b => b.keyId === stored.envelope.kid);
        if (!browser) throw new Error("operation_key_unavailable");
        return openJson(browser.key, stored.envelope, stored.aad);
      },
      saveOperation: async (id, record) => {
        const browser = this.projectOperationBrowser;
        if (!browser) throw new Error("operation_key_unavailable");
        const aad = relayAad({ type: "project.operation", deviceId: this.deviceId, requestId: id });
        this.outbox.projectOperations[id] = { aad, envelope: await sealJson(browser.key, record, aad) };
        await this.outbox.persist();
      },
    });
    this.projectCommandChain = Promise.resolve();
    this.outbox =
      options.outbox ??
      new RelayOutbox(
        options.statePath === null
          ? null
          : (options.statePath ??
              join(process.cwd(), ".codex-relay", "outbox.json")),
      );
    this.historyPerformance = options.historyPerformance ?? createHistoryPerformanceRecorder(
      this.outbox.path ? `${this.outbox.path}.history-performance.jsonl` : null,
    );
    this.projectManager.localProjects = new LocalProjectStore(
      this.outbox.path ? `${this.outbox.path}.projects.json` : null,
    );
    this.sessionWorktreeRoot = options.sessionWorktreeRoot ??
      (this.outbox.path ? dirname(this.outbox.path) : process.cwd());
    this.forkGitChecks = new Map();
    this.attachmentStore = options.attachmentStore ?? null;
    this.localWebProxy = new LocalWebProxy();
    this.closed = false;
    this.ready = false;
    this.heartbeat = null;
    this.catalogRefresh = null;
    this.pendingApprovals = new Map();
    this.codexHooks = options.codexHooks ? new CodexHookBridge({
      ...options.codexHooks,
      requestApproval: approval => this.requestApproval(approval),
      resolved: (sessionId, event) => this.handleAdapterEvent(sessionId, event),
      available: () => this.ready && !this.closed && this.activeBrowserKeys.size > 0,
    }) : null;
    this.attachments = new Map();
    this.attachmentBodies = new Map();
    this.attachmentBodyBytes = 0;
    this.consumedNonces = new Set();
    this.reconnectAttempt = 0;
    this.readyWaiters = [];
    this.operations = new Set();
    this.pollTimer = null;
    this.uploadQueue = [];
    this.uploadIsolationBatches = [];
    this.uploadKeys = new Set();
    this.uploadBatchLimit = 50;
    this.preferEventUpload = false;
    this.interactiveSessions = new Map();
    this.browserActivity = new Map();
    this.uploading = false;
    this.uploadingEntries = [];
    this.bulkUploading = false;
    this.bulkUploadingEntries = [];
    this.bulkUploadRetryTimer = null;
    this.bulkUploadRetryAttempt = 0;
    this.uploadRetryTimer = null;
    this.uploadRetryAttempt = 0;
    this.rejectedUploadKeys = new Set();
    this.deliveryWarningActive = false;
    this.polling = false;
    this.catalogDeliveryVersions = new Map();
    this.oversizedCatalogVersions = new Map();
    this.fileAccessFailures = new Set();
    this.lastSessionCatalog = [];
    this.lastProjectCatalog = [];
    this.fileAccessWarningActive = false;
    this.fileAccessRecheck = null;
  }

  async start() {
    // Bind every key to its locally enrolled client before opening runtime
    // state or starting an Agent. The server cannot assign a key by key ID.
    if (!Array.isArray(this.browserKeySources) || !this.browserKeySources.length) {
      throw new Error("RELAY_BROWSER_KEYS is required.");
    }
    const sources = this.browserKeySources.map(source => ({
      browserId: source?.browserId,
      e2eeKey: source?.e2eeKey,
    }));
    const browserIds = new Set();
    for (const { browserId, e2eeKey } of sources) {
      if (typeof browserId !== "string" || !/^web_[a-f0-9]{32}$/.test(browserId) ||
          typeof e2eeKey !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(e2eeKey) ||
          browserIds.has(browserId)) {
        throw new Error("Invalid browser content key enrollment.");
      }
      browserIds.add(browserId);
    }
    const browserKeys = new Map();
    const keyIds = new Set();
    for (const { browserId, e2eeKey } of sources) {
      const key = await importE2eeKey(e2eeKey);
      const keyId = await keyIdForKey(key);
      if (keyIds.has(keyId)) {
        throw new Error("Browser content keys must be independent.");
      }
      keyIds.add(keyId);
      browserKeys.set(browserId, { browserId, key, keyId });
    }
    this.browserKeys = browserKeys;
    this.onStartupPhase?.("local_state");
    await this.outbox.load();
    await this.outbox.pruneExpired();
    this.retentionTimer = setInterval(() => {
      this.pruneExpiredUploads();
      void this.outbox.pruneExpired().catch(() => {
        console.error("Relayune transport retention could not be persisted.");
      });
    }, 30_000);
    this.retentionTimer.unref();
    this.onStartupPhase?.("agents");
    await this.adapter.start({
      loadCodexQueueReceipts: () => Object.values(this.outbox.codexQueueReceipts),
      saveCodexQueueReceipt: receipt => this.outbox.saveCodexQueueReceipt(receipt),
      removeCodexQueueReceipt: receipt => this.outbox.removeCodexQueueReceipt(receipt),
      emitEvent: (sessionId, event, extra) =>
        this.handleAdapterEvent(sessionId, event, extra),
      requestApproval: (approval) => this.handleAdapterApproval(approval),
      registerRecoveredAttachments: (sessionId, event) => {
        this.registerEventAttachments(sessionId, event);
      },
      readAttachmentCheckpoint: (source) =>
        this.attachmentStore?.getIngestionCheckpoint(source) ?? null,
      writeAttachmentCheckpoint: (source, byteOffset) =>
        this.attachmentStore?.setIngestionCheckpoint(source, byteOffset),
    });
    this.onStartupPhase?.("registration");
    await this.connect();
    if (this.codexHooks) {
      this.onStartupPhase?.("hooks");
      try { await this.codexHooks.start(); }
      catch {
        await this.codexHooks.close();
        this.codexHooks = null;
        console.error("Relayune Codex hook bridge unavailable; approvals stay in Codex.");
      }
    }
  }

  async connect() {
    if (this.closed) return;
    await this.connectPolling();
  }

  async connectPolling() {
    if (this.closed) return;
    const reconnecting = this.reconnectAttempt > 0;
    const response = await this.remoteFetch("/api/relay/hello", {
      method: "POST",
      body: JSON.stringify({
        device_id: this.deviceId,
        last_acked_seq: this.outbox.lastAcked,
      }),
    });
    const connected = await readRemoteJson(response);
    if (this.closed) return;
    if (!response.ok) {
      throw Object.assign(new Error(`Remote Relay registration failed (${response.status}).`), { status: response.status });
    }
    await this.outbox.retainAuthorizedRecipients(connected.browser_authorizations);
    this.syncBrowserAuthorizations(connected.browser_authorizations);
    // Once negotiated, a lost subscription feed must fail closed rather than
    // silently recreate ciphertext for every historical authorization.
    if (connected.online_transport_version === 1) this.onlineTransportEnabled = true;
    this.onStartupPhase?.("initial_sync");
    await this.handleMessage(
      JSON.stringify({
        type: "relay.connected",
        protocol_version: 2,
        resume_cursor: connected.ack_seq ?? connected.resume_cursor ?? 0,
      }),
    );
    clearTimeout(this.pollTimer);
    this.commandWaitMs = Number.isInteger(connected.command_wait_ms)
      ? Math.max(0, Math.min(20_000, connected.command_wait_ms)) : 0;
    this.commandPolling = true;
    if (this.onlineTransportEnabled && !this.onlineTransport) this.startOnlineTransport();
    this.onStartupPhase?.("polling");
    // Do not hold startup behind an empty long poll. Subsequent requests wait
    // at the server and are replaced immediately when a batch arrives.
    const [pollSucceeded] = await Promise.all([
      this.pollRemoteCommands({ waitMs: 0 }),
      this.flushRemoteUploads(),
    ]);
    if (reconnecting && pollSucceeded) {
      console.log("Relayune Relay reconnected");
    }
  }

  async pollRemoteCommands({ waitMs = this.commandWaitMs } = {}) {
    if (this.polling || this.closed || !this.ready) return;
    this.polling = true;
    const abort = new AbortController();
    let nextPollDelayMs = this.commandWaitMs > 0 ? 0 : this.pollIntervalMs;
    this.pollAbort = abort;
    try {
      const response = await this.remoteFetch(
        `/api/relay/commands?device_id=${encodeURIComponent(
          this.deviceId,
        )}&limit=50${waitMs > 0 ? `&wait_ms=${waitMs}` : ""}`,
        {
          signal: AbortSignal.any([
            abort.signal,
            AbortSignal.timeout(Math.max(this.remoteFetchTimeoutMs, 60_000)),
          ]),
        },
      );
      const result = await readRemoteJson(response);
      if (this.closed || abort.signal.aborted) return false;
      if (!response.ok) {
        throw new Error(
          result?.error?.message ??
            `Remote command poll failed (${response.status}).`,
        );
      }
      if (Number.isInteger(result.poll_retry_after_ms) && result.poll_retry_after_ms > 0) {
        nextPollDelayMs = Math.min(20_000, result.poll_retry_after_ms);
      }
      const commandsReceivedAt = Date.now();
      await this.outbox.retainAuthorizedRecipients(result.browser_authorizations);
      const browserSetChanged = this.syncBrowserAuthorizations(
        result.browser_authorizations,
      );
      if (browserSetChanged) {
        await this.syncSessionCatalog();
      }
      for (const frame of result.commands ?? []) {
        const browserKey = this.activeBrowserKeys.get(frame.browser_id);
        if (!browserKey) {
          throw new Error("Remote command targets an unauthorized browser.");
        }
        const command = await openJson(
          browserKey.key,
          frame.envelope,
          frame.aad ?? frame.metadata,
        );
        validateSealedCommand(command, frame);
        command.browser_id = frame.browser_id;
        this.browserActivity.set(frame.browser_id, commandsReceivedAt);
        this.dispatchRemoteCommand(command, browserKey, commandsReceivedAt);
      }
      if (Number.isInteger(result.ack_seq)) {
        await this.outbox.acknowledge(result.ack_seq);
      }
      this.reconnectAttempt = 0;
      return true;
    } catch (error) {
      if (this.closed || abort.signal.aborted) return false;
      this.markDisconnected(error);
      clearTimeout(this.pollTimer);
      this.schedulePollingReconnect(error);
      return false;
    } finally {
      this.polling = false;
      if (this.pollAbort === abort) this.pollAbort = null;
      if (this.commandPolling && this.ready && !this.closed) {
        clearTimeout(this.pollTimer);
        this.pollTimer = setTimeout(() => void this.pollRemoteCommands(),
          nextPollDelayMs);
      }
    }
  }

  dispatchRemoteCommand(command, browserKey, receivedAt) {
    const receipt = this.outbox.transportRequests[command.request_id];
    if (receipt && !this.remoteCommandTasks.has(command.request_id)) {
      if (receipt.expires < Date.now() || !this.validateCommand(command) || receipt.browserId !== command.browser_id || receipt.hash !== hashAction(command)) return;
      // A retry after a crash must never repeat a possibly executed mutation.
      const frames = receipt.frames ?? [];
      this.enqueueRemoteMessages([{kind: "command_ack", device_id: this.deviceId,
        request_id: command.request_id, status: "duplicate"}, ...frames], {live: true});
      void this.flushRemoteUploads();
      return;
    }
    // Polling must remain available for controls while a provider is waiting.
    // Bound outstanding work; deferred server commands remain available to retry.
    if (this.remoteCommandTasks.has(command.request_id) || this.remoteCommandTasks.size >= 100) return;
    const ordered = command.session_id && [
      "session.submit_message", "session.configure", "session.create_agents", "session.fork",
    ].includes(command.type);
    const lane = ordered ? command.session_id : null;
    const previous = lane ? this.remoteSessionCommands.get(lane) : null;
    const task = Promise.resolve(previous).catch(() => {}).then(async () => {
      if (this.closed || this.activeBrowserKeys.get(command.browser_id)?.key !== browserKey.key) return;
      this.requestBrowsers.set(command.request_id, command.browser_id);
      if (command.type === "session.read_history") {
        this.historyCommandReceivedAt.set(command.request_id, receivedAt);
      }
      if (DIRECT_COMMAND_TYPES.has(command.type) && !READ_ONLY_COMMAND_TYPES.has(command.type) && command.type !== "transport.event_ack") {
        for (const [id, value] of Object.entries(this.outbox.transportRequests)) {
          if (value.expires < Date.now()) delete this.outbox.transportRequests[id];
        }
        if (Object.keys(this.outbox.transportRequests).length >= 1000) throw new Error("transport_busy");
        this.outbox.transportRequests[command.request_id] = {
          browserId: command.browser_id, hash: hashAction(command), expires: Date.parse(command.expires_at), frames: [],
        };
        try { await this.outbox.persist(); }
        catch (error) { delete this.outbox.transportRequests[command.request_id]; throw error; }
      }
      // Persisting admission yields: revocation may have arrived in the meantime.
      if (this.closed || this.activeBrowserKeys.get(command.browser_id)?.key !== browserKey.key) return;
      if (this.directRequests.has(command.request_id) && ["session.submit_message", "session.interrupt_turn", "session.create_agents", "approval.resolve"].includes(command.type)) {
        this.acknowledgeCommand(command, "accepted");
      }
      await this.handleMessage(JSON.stringify(command));
    }).catch(() => {
      // Do not log command content or a provider's potentially sensitive error.
      console.error("Relayune remote command failed; other commands remain available.");
    }).finally(() => {
      this.historyCommandReceivedAt.delete(command.request_id);
      this.remoteCommandTasks.delete(command.request_id);
      if (lane && this.remoteSessionCommands.get(lane) === task) this.remoteSessionCommands.delete(lane);
    });
    this.remoteCommandTasks.set(command.request_id, task);
    if (lane) this.remoteSessionCommands.set(lane, task);
  }

  markDisconnected(error) {
    const wasReady = this.ready;
    this.ready = false;
    this.commandPolling = false;
    this.pollAbort?.abort();
    this.directHost?.prune();
    this.onlineTransport?.expire();
    if (wasReady) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Relayune Relay reconnecting: ${message}`);
    }
  }

  schedulePollingReconnect() {
    if (this.closed) return;
    const delays = [250, 500, 1_000, 2_000, 5_000, 10_000];
    const wait = delays[Math.min(this.reconnectAttempt++, delays.length - 1)];
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(
      () =>
        void this.connectPolling().catch(() => this.schedulePollingReconnect()),
      wait,
    );
  }

  async remoteFetch(path, options = {}) {
    const finish = this.performanceDiagnostics.startOperation('remote_fetch');
    try {
      const response = await fetch(new URL(path, this.serverUrl), {
        ...options,
        signal: options.signal ?? AbortSignal.timeout(this.remoteFetchTimeoutMs),
        headers: {
          Accept: "application/json",
          ...(this.desktopInfo.version ? { "X-Relay-Client-Version": this.desktopInfo.version, "X-Relay-Client-Platform": this.desktopInfo.platform === "darwin" ? "macos" : this.desktopInfo.platform === "win32" ? "windows" : "unknown" } : {}),
          Authorization: `Bearer ${this.deviceToken}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
      finish(!response.ok);
      return response;
    } catch (error) { finish(true); throw error; }
  }

  async encodeRemoteMessage(message) {
    if (message.type === "opaque.event.bundle") {
      return message.variants.filter(
        (variant) =>
          !transportPayloadExpired(variant) &&
          this.activeBrowserKeys.has(variant.browser_id) &&
          (!variant.envelope?.kid || this.activeBrowserKeys.get(variant.browser_id)?.keyId === variant.envelope.kid) &&
          !this.outbox.isQuarantinedEventVariant(variant),
      );
    }
    if (message.type === "opaque.event") {
      if (transportPayloadExpired({...message, kind: "event"})) return [];
      if (message.browser_id) return [message];
      const keyId = message.envelope?.kid;
      const browser = [...this.activeBrowserKeys.values()].find(
        (candidate) => candidate.keyId === keyId,
      );
      return browser ? [{ ...message, browser_id: browser.browserId }] : [];
    }
    if (message.type === "relay.sync_sessions") {
      this.sessionDirectory.replace(message.sessions ?? [], message.projects ?? [], message.observed_at);
      const aad = relayAad({
        type: "relay.sync_sessions",
        deviceId: this.deviceId,
        createdAt: message.observed_at,
      });
      const plaintext = serializableCatalog({
        ...message,
        desktop: { ...this.desktopInfo, agents: await this.readAgentRuntimeInfo() },
        file_access_limited: this.fileAccessWarningActive,
      });
      const frames = await Promise.all([...this.activeBrowserKeys.values()].map(async browser => {
        // A first catalog bootstraps a newly paired client. Subsequent offline
        // directory changes must not be written once per historical grant.
        if (this.onlineTransportEnabled && this.catalogDeliveryVersions.has(browser.browserId) &&
            !this.onlineTransport?.peer(browser.browserId)) return null;
        // Opted-in phones pull the bounded directory via encrypted deltas. Keep
        // the existing catalog only for runtime/usage metadata and legacy clients.
        const value = this.directoryClients.get(browser.browserId) === browser.keyId
          ? { ...plaintext, sessions: [], projects: [] }
          : { ...plaintext, sessions: plaintext.sessions.slice(0, 50) };
        // Only online subscribers consume revision notifications. Including the
        // revision in a legacy catalog would defeat its stable-content cache and
        // turn local observation timestamps back into Mongo writes.
        if (this.onlineTransport?.peer(browser.browserId)?.transport === 'stream') {
          value.directory_revision = this.sessionDirectory.current.revision;
        }
        const fingerprint = catalogContentFingerprint(value);
        const version = catalogDeliveryVersion(browser.keyId, fingerprint);
        if (this.catalogDeliveryVersions.get(browser.browserId) === version ||
            this.oversizedCatalogVersions.get(browser.browserId) === version) return null;
        const encoded = {
          kind: "catalog", device_id: this.deviceId, browser_id: browser.browserId,
          session_refs: value.sessions.map(session => session.id), aad,
          envelope: await sealJson(browser.key, value, aad),
        };
        Object.defineProperty(encoded, CATALOG_DELIVERY_VERSION, { value: version });
        return encoded;
      }));
      return frames.filter(Boolean);
    }
    if (
      message.type === "transport.answer" ||
      message.type === "project.result" ||
      message.type === "session.history" ||
      message.type === "session.history_error" ||
      message.type === "session.agents" ||
      message.type === "session.agents_error" ||
      message.type === "session.web_result" ||
      message.type === "session.web_error" ||
      message.type === "session.attachment" ||
      message.type === "session.attachment_error" ||
      message.type === "session.configure_result" ||
      message.type === "session.configure_error" ||
      message.type === "session.fork_error"
    ) {
      const aad = relayAad({
        type: message.type,
        deviceId: this.deviceId,
        sessionId: message.session_id,
        requestId: message.request_id,
      });
      const browser = this.browserForRequest(message.request_id);
      if (!browser) return [];
      const result = {
        kind: "response",
        device_id: this.deviceId,
        browser_id: browser.browserId,
        session_id: message.session_id,
        request_id: message.request_id,
        aad,
        envelope: await sealJson(browser.key, message, aad),
      };
      if (message[HISTORY_WIRE_BUDGET] && Buffer.byteLength(JSON.stringify({
        device_id: this.deviceId, messages: [result],
      })) > message[HISTORY_WIRE_BUDGET]) throw new Error('history_wire_budget_exceeded');
      if (message.performance && /^history_[a-f0-9]{32}$/.test(message.performance.trace_id ?? '')) {
        Object.defineProperty(result, HISTORY_TIMING, {value: {
          ...message.performance, encrypted_at_ms: Date.now(),
          response_wire_bytes: Buffer.byteLength(JSON.stringify(result)),
        }});
      }
      this.requestBrowsers.delete(message.request_id);
      return [result];
    }
    if (message.type === "command.ack") {
      return [
        {
          kind: "command_ack",
          device_id: this.deviceId,
          request_id: message.request_id,
          status: message.status,
        },
      ];
    }
    if (message.type === "relay.heartbeat") {
      return [
        {
          kind: "heartbeat",
          device_id: this.deviceId,
          last_event_seq: message.last_event_seq,
        },
      ];
    }
    if (
      message.type === "session.create_result" ||
      message.type === "session.create_error" ||
      message.type === "session.fork_result"
    ) {
      const sessionId =
        message.type.endsWith("_result") ? message.session?.id : null;
      if (message.type.endsWith("_result") && !sessionId) {
        throw new Error("Created session response is missing its session id.");
      }
      const aad = relayAad({
        type: message.type,
        deviceId: this.deviceId,
        sessionId,
        requestId: message.request_id,
      });
      const browser = this.browserForRequest(message.request_id);
      if (!browser) return [];
      const result = {
        kind: "response",
        device_id: this.deviceId,
        browser_id: browser.browserId,
        request_id: message.request_id,
        session_id: sessionId,
        aad,
        envelope: await sealJson(browser.key, message, aad),
      };
      this.requestBrowsers.delete(message.request_id);
      return [result];
    }
    throw new Error(`Remote transport cannot send ${message.type}.`);
  }

  pruneExpiredUploads(now = Date.now()) {
    const retain = entry => {
      const message = entry.message;
      const unsubscribed = this.onlineTransportEnabled && message.kind === 'event' && !message.notification_only &&
        this.onlineTransport?.peer(message.browser_id)?.transport !== 'legacy';
      if (!transportPayloadExpired(message, now) && !unsubscribed) return true;
      this.uploadKeys.delete(entry.key);
      this.rejectedUploadKeys.delete(entry.key);
      return false;
    };
    this.uploadQueue = this.uploadQueue.filter(retain);
    this.uploadIsolationBatches = this.uploadIsolationBatches.map(batch => batch.filter(retain)).filter(batch => batch.length);
    for (const [id, entry] of this.directEvents) {
      if (!transportPayloadExpired(entry.frame, now)) continue;
      clearTimeout(entry.timer);
      this.directEvents.delete(id);
    }
    for (const [id, entry] of this.onlineTransport?.pending ?? []) {
      if (transportPayloadExpired(entry.frame, now)) this.onlineTransport.release(id);
    }
    for (const [id, entry] of this.notificationEvents) {
      if (!transportPayloadExpired(entry.frame, now) && this.activeBrowserKeys.has(entry.frame.browser_id)) continue;
      this.notificationEvents.delete(id);
      this.notificationEventBytes -= entry.bytes;
    }
  }

  async flushRemoteUploads() {
    this.pruneExpiredUploads();
    // Reserve an independent, single bulk lane. A slow history/image POST must
    // not hold the only slot needed for acceptance, stop and approval replies.
    void this.flushBulkUploads();
    if (this.uploading || (!this.uploadQueue.some(entry => !isBulkUpload(entry.message)) &&
        !this.uploadIsolationBatches.length) || this.closed) {
      return;
    }
    clearTimeout(this.uploadRetryTimer);
    this.uploadRetryTimer = null;
    this.uploading = true;
    // Historical rejects must not monopolize the only upload slot. Alternate
    // independent fresh work and quarantine retries, preserving each recipient's
    // session stream until its earlier quarantined copy has been resolved.
    let isolated;
    let entries;
    if (this.uploadIsolationBatches.length && !this.preferIsolationUpload) {
      const blocked = new Set(this.uploadIsolationBatches.flat()
        .filter(entry => entry.message.kind === "event")
        .map(entry => JSON.stringify([entry.message.browser_id, entry.message.session_id])));
      const deferred = this.uploadQueue.filter(entry => entry.message.kind === "event" &&
        blocked.has(JSON.stringify([entry.message.browser_id, entry.message.session_id])));
      const held = new Set(deferred);
      this.uploadQueue = this.uploadQueue.filter(entry => !held.has(entry));
      entries = this.takeUploadBatch(this.uploadBatchLimit, {bulk: false, maxBytes: 256 * 1024});
      this.uploadQueue.unshift(...deferred);
    }
    if (!entries?.length) {
      isolated = this.uploadIsolationBatches.shift();
      entries = isolated ?? this.takeUploadBatch(this.uploadBatchLimit, {bulk: false, maxBytes: 256 * 1024});
    }
    this.preferIsolationUpload = !isolated && this.uploadIsolationBatches.length > 0;
    this.uploadingEntries = entries;
    const batch = entries.map((entry) => entry.message);
    let continueImmediately = true;
    const uploadStartedAt = Date.now();
    try {
      const response = await this.remoteFetch("/api/relay/push", {
        method: "POST",
        body: JSON.stringify({
          device_id: this.deviceId,
          messages: batch.map(message => {
            const wire = {...message};
            delete wire.online_only;
            delete wire.notification_only;
            return wire;
          }),
        }),
      });
      const result = await readRemoteJson(response);
      if (!response.ok) {
        throw new RemoteUploadError(
          response.status,
          result?.error?.code,
          result?.error?.message ??
            `Remote Relay upload failed (${response.status}).`,
        );
      }
      // Each recipient copy has its own durable receipt; global ACKs alone
      // cannot retire copies deferred for less recently active clients.
      await this.outbox.acknowledgeVariants(
        Number.isInteger(result.ack_seq) ? result.ack_seq : this.outbox.lastAcked,
        batch.filter(message => message.kind === "event"),
      );
      for (const frame of batch) {
        const notification = this.notificationEvents.get(frame.event_id);
        if (!notification) continue;
        this.notificationEvents.delete(frame.event_id);
        this.notificationEventBytes -= notification.bytes;
      }
      this.uploadRetryAttempt = 0;
      for (const entry of entries) {
        const timing = entry.message[HISTORY_TIMING];
        if (timing) this.historyPerformance({...timing,
          upload_started_at_ms: uploadStartedAt, upload_completed_at_ms: Date.now(),
          queue_wait_ms: uploadStartedAt - timing.queued_at_ms,
          upload_ms: Date.now() - uploadStartedAt, stage: 'uploaded'});
        this.rememberSuccessfulCatalogUpload(entry.message);
        this.uploadKeys.delete(entry.key);
        this.rejectedUploadKeys.delete(entry.key);
      }
      this.reportDeliveryRecovered();
      // A rejected historical record can shrink batches to one. Recover
      // throughput after successful pushes instead of keeping the entire
      // remaining backlog at that size until it becomes empty.
      this.uploadBatchLimit = this.uploadQueue.length
        ? Math.min(50, this.uploadBatchLimit * 2) : 50;
    } catch (error) {
      if (isPermanentUploadRejection(error)) {
        if (entries.length > 1) {
          // Bisect the exact rejected batch. Rescheduling it with fresh data
          // keeps mixing a bad record into healthy batches. Recipient copies
          // are independent: one conflict must not reject its healthy siblings.
          const middle = Math.floor(entries.length / 2);
          this.uploadIsolationBatches.unshift(entries.slice(0, middle), entries.slice(middle));
        } else {
          for (const entry of entries) {
            if (error.status === 409 && error.code === "event_seq_conflict" && entry.message.kind === "event") {
              await this.outbox.quarantineConflictingVariant(entry.message);
            }
            if (error.status === 413 && entry.message.kind === "catalog" &&
                entry.message[CATALOG_DELIVERY_VERSION]) {
              this.oversizedCatalogVersions.set(entry.message.browser_id,
                entry.message[CATALOG_DELIVERY_VERSION]);
            }
            this.uploadKeys.delete(entry.key);
            this.rejectedUploadKeys.add(entry.key);
          }
          this.reportDeliveryWarning(error);
        }
      } else {
        if (isolated) this.uploadIsolationBatches.unshift(entries);
        else this.uploadQueue.unshift(...entries);
        continueImmediately = false;
        if (isAuthorizationUploadError(error)) {
          this.markDisconnected(error);
          this.schedulePollingReconnect();
        } else {
          this.scheduleUploadRetry();
        }
      }
    } finally {
      this.uploadingEntries = [];
      this.uploading = false;
      if (continueImmediately && (this.uploadQueue.some(entry => !isBulkUpload(entry.message)) ||
          this.uploadIsolationBatches.length) && this.ready) {
        void this.flushRemoteUploads();
      }
    }
  }

  flushBulkUploads() {
    if (this.closed || this.bulkUploading || this.bulkUploadRetryTimer) return Promise.resolve();
    const index = this.uploadQueue.findIndex(entry => isBulkUpload(entry.message));
    if (index < 0) return Promise.resolve();
    const entries = this.uploadQueue.splice(index, 1);
    this.bulkUploading = true;
    this.bulkUploadingEntries = entries;
    const operation = (async () => {
      const entry = entries[0];
      const started = Date.now();
      let retry = false;
      try {
        const response = await this.remoteFetch('/api/relay/push', {method: 'POST',
          body: JSON.stringify({device_id: this.deviceId, messages: [entry.message]})});
        const result = await readRemoteJson(response);
        if (!response.ok) throw new RemoteUploadError(response.status, result?.error?.code,
          result?.error?.message ?? `Remote Relay upload failed (${response.status}).`);
        this.bulkUploadRetryAttempt = 0;
        this.uploadKeys.delete(entry.key); this.rejectedUploadKeys.delete(entry.key);
        const timing = entry.message[HISTORY_TIMING];
        if (timing) this.historyPerformance({...timing, upload_started_at_ms: started,
          upload_completed_at_ms: Date.now(), queue_wait_ms: started - timing.queued_at_ms,
          upload_ms: Date.now() - started, stage: 'uploaded'});
        this.reportDeliveryRecovered();
      } catch (error) {
        if (isPermanentUploadRejection(error)) {
          this.uploadKeys.delete(entry.key); this.rejectedUploadKeys.add(entry.key);
          this.reportDeliveryWarning(error);
        } else {
          this.uploadQueue.unshift(...entries);
          retry = true;
          if (isAuthorizationUploadError(error)) {
            this.markDisconnected(error); this.schedulePollingReconnect();
          } else {
            const delays = [1_000, 2_000, 5_000, 10_000, 30_000];
            this.bulkUploadRetryTimer = setTimeout(() => {
              this.bulkUploadRetryTimer = null;
              if (this.ready) void this.flushBulkUploads();
            }, delays[Math.min(this.bulkUploadRetryAttempt++, delays.length - 1)]);
            this.bulkUploadRetryTimer.unref?.();
          }
        }
      } finally {
        this.bulkUploading = false; this.bulkUploadingEntries = [];
        if (!retry && this.ready && !this.closed) void this.flushBulkUploads();
      }
    })();
    this.operations.add(operation);
    void operation.finally(() => this.operations.delete(operation));
    return operation;
  }

  enqueueRemoteMessages(messages, { live = false } = {}) {
    for (const message of messages) {
      if (transportPayloadExpired(message)) continue;
      const key = remoteMessageKey(message);
      if (this.uploadKeys.has(key) || this.outbox.isQuarantinedEventVariant(message)) continue;
      const envelopeLimit = message.kind === "response"
        ? MAX_PUSH_RESPONSE_ENVELOPE_BYTES : MAX_PUSH_ENVELOPE_BYTES;
      if (message.envelope &&
          Buffer.byteLength(JSON.stringify(message.envelope)) > envelopeLimit) {
        if (message.kind === "catalog" && message[CATALOG_DELIVERY_VERSION]) {
          this.oversizedCatalogVersions.set(message.browser_id,
            message[CATALOG_DELIVERY_VERSION]);
        }
        // Keep event copies in the durable outbox, with no fabricated ACK.
        // A smaller replacement (or a different recipient) can still proceed.
        this.rejectedUploadKeys.add(key);
        this.reportDeliveryWarning(new RemoteUploadError(413, "envelope_too_large"));
        continue;
      }
      this.uploadKeys.add(key);
      if (message[HISTORY_TIMING] && !message[HISTORY_TIMING].queued_at_ms) {
        message[HISTORY_TIMING].queued_at_ms = Date.now();
        message[HISTORY_TIMING].queue_entries = this.uploadQueue.length;
        this.historyPerformance({...message[HISTORY_TIMING], stage: 'queued'});
      }
      this.uploadQueue.push({ key, message, live: live && message.kind === "event" });
    }
  }

  takeUploadBatch(limit, {bulk = true, maxBytes = Infinity} = {}) {
    const held = bulk ? [] : this.uploadQueue.filter(entry => isBulkUpload(entry.message));
    if (held.length) {
      const heldSet = new Set(held);
      this.uploadQueue = this.uploadQueue.filter(entry => !heldSet.has(entry));
    }
    const selected = this.takeQueuedUploadBatch(limit);
    let bytes = Buffer.byteLength(JSON.stringify({device_id: this.deviceId, messages: []}));
    let count = 0;
    for (const entry of selected) {
      const size = Buffer.byteLength(JSON.stringify(entry.message)) + 1;
      // Existing events are indivisible authenticated records. The first one
      // may exceed the scheduling slice, but cannot strand smaller controls.
      if (count && bytes + size > maxBytes) break;
      bytes += size; count++;
    }
    this.uploadQueue.unshift(...selected.slice(count));
    this.uploadQueue.push(...held);
    return selected.slice(0, count);
  }

  takeQueuedUploadBatch(limit) {
    const batch = [];
    // A newly paired client cannot enter the app until its first catalog is
    // delivered. Catalogs, interactive replies and command acceptance must not
    // wait behind an outbox replay. Bound the slice so events still progress.
    const hasEvents = this.uploadQueue.some(entry => entry.message.kind === "event");
    // A rejected upload may reduce the batch to one. Alternate after a
    // control-only batch so repeated catalogs cannot starve live events.
    const priorityLimit = hasEvents && this.preferEventUpload ? 0 : Math.min(8, limit);
    for (let index = 0; index < this.uploadQueue.length && batch.length < priorityLimit;) {
      const kind = this.uploadQueue[index].message.kind;
      if (kind === "catalog" || kind === "response" || kind === "command_ack") {
        batch.push(...this.uploadQueue.splice(index, 1));
      } else {
        index += 1;
      }
    }
    // A watched or commanded session should not compete equally with every
    // background CLI stream. Reserve half the event capacity for recent client
    // interactions; the ordinary round robin below still advances background
    // sessions. Pick the earliest event, including replay, and all recipients.
    const now = Date.now();
    for (const [sessionId, until] of this.interactiveSessions) {
      if (until <= now) this.interactiveSessions.delete(sessionId);
    }
    // Recent authenticated activity is a scheduling hint, never an offline
    // verdict. Reserve at most half the batch; remaining copies still progress.
    const recipientBudget = Math.floor((limit - batch.length) / 2);
    let recipientCount = 0;
    while (recipientCount < recipientBudget) {
      const eligible = entry => entry.message.kind === "event" &&
        (this.browserActivity.get(entry.message.browser_id) ?? 0) > now - 60_000;
      const sessions = [...new Set(this.uploadQueue.filter(eligible).map(entry => entry.message.session_id))];
      const interactive = sessions.filter(id => this.interactiveSessions.has(id));
      const candidates = interactive.length ? interactive : sessions;
      if (!candidates.length) break;
      const cursor = Math.max(0, candidates.indexOf(this.recipientUploadNextSession));
      const sessionId = candidates[cursor];
      const index = this.uploadQueue.findIndex(entry => eligible(entry) && entry.message.session_id === sessionId);
      batch.push(...this.uploadQueue.splice(index, 1));
      recipientCount++;
      this.recipientUploadNextSession = candidates[(cursor + 1) % candidates.length];
    }
    const interactiveBudget = Math.floor((limit - batch.length) / 2);
    let interactiveCount = 0;
    while (interactiveCount < interactiveBudget) {
      const sessions = [...this.interactiveSessions.keys()].filter(sessionId =>
        this.uploadQueue.some(entry => entry.message.kind === "event" &&
          entry.message.session_id === sessionId));
      if (!sessions.length) break;
      const cursor = Math.max(0, sessions.indexOf(this.interactiveUploadNextSession));
      const sessionId = sessions[cursor];
      const index = this.uploadQueue.findIndex(entry =>
        entry.message.kind === "event" && entry.message.session_id === sessionId);
      const first = this.uploadQueue[index];
      let size = 1;
      while (index + size < this.uploadQueue.length &&
        this.uploadQueue[index + size].message.kind === "event" &&
        this.uploadQueue[index + size].message.event_seq === first.message.event_seq) size++;
      // Leave the other half for background work, even with many recipients.
      if (interactiveCount + size > interactiveBudget) break;
      batch.push(...this.uploadQueue.splice(index, size));
      interactiveCount += size;
      this.interactiveUploadNextSession = sessions[(cursor + 1) % sessions.length];
    }
    // Share most of a batch among active sessions, retaining their earlier
    // events and every recipient variant. Reserve capacity for replay rather
    // than allowing a large historical backlog to consume every remaining slot.
    const liveBudget = Math.max(1, Math.floor((limit - batch.length) * 0.8));
    let liveCount = 0;
    while (batch.length < limit) {
      const sessions = [...new Set(this.uploadQueue.filter(entry => entry.live)
        .map(entry => entry.message.session_id))];
      if (!sessions.length) break;
      const cursor = Math.max(0, sessions.indexOf(this.liveUploadNextSession));
      const session = sessions[cursor];
      const index = this.uploadQueue.findIndex(entry =>
        entry.message.kind === "event" && entry.message.session_id === session);
      const first = this.uploadQueue[index];
      let size = 1;
      while (index + size < this.uploadQueue.length &&
        this.uploadQueue[index + size].message.kind === "event" &&
        this.uploadQueue[index + size].message.event_seq === first.message.event_seq) size++;
      if (liveCount && liveCount + size > liveBudget) break;
      if (batch.length && batch.length + size > limit) break;
      batch.push(...this.uploadQueue.splice(index, size));
      liveCount += size;
      // Keep the next session fair even when the selected session's final
      // live group was removed from the dynamic list.
      this.liveUploadNextSession = sessions[(cursor + 1) % sessions.length];
      if (liveCount >= liveBudget) break;
    }
    while (this.uploadQueue.length) {
      const first = this.uploadQueue[0];
      let groupSize = 1;
      if (first.message.kind === "event") {
        while (
          groupSize < this.uploadQueue.length &&
          this.uploadQueue[groupSize].message.kind === "event" &&
          this.uploadQueue[groupSize].message.event_seq ===
            first.message.event_seq
        ) {
          groupSize += 1;
        }
      }
      if (batch.length && batch.length + groupSize > limit) break;
      batch.push(...this.uploadQueue.splice(0, groupSize));
      if (batch.length >= limit) break;
    }
    this.preferEventUpload = hasEvents && !batch.some(entry => entry.message.kind === "event");
    return batch;
  }

  scheduleUploadRetry() {
    if (this.closed || this.uploadRetryTimer !== null) return;
    const delays = [1_000, 2_000, 5_000, 10_000, 30_000];
    const wait =
      delays[Math.min(this.uploadRetryAttempt++, delays.length - 1)];
    this.uploadRetryTimer = setTimeout(() => {
      this.uploadRetryTimer = null;
      if (this.ready) void this.flushRemoteUploads();
    }, wait);
  }

  reportDeliveryWarning(error) {
    if (this.deliveryWarningActive) return;
    this.deliveryWarningActive = true;
    const code = safeUploadErrorCode(error);
    console.error(`Relayune Relay sync warning: ${code}`);
  }

  reportDeliveryRecovered() {
    if (!this.deliveryWarningActive || this.rejectedUploadKeys.size) return;
    this.deliveryWarningActive = false;
    console.log("Relayune Relay sync recovered");
  }

  // A newly confirmed PAKE key arrives over the inherited private stdin pipe.
  // Server authorization remains the gate for activating it; no adapter restart.
  async updateBrowserKey(browserId, serializedKey) {
    if (typeof browserId !== "string" || !/^web_[a-f0-9]{32}$/.test(browserId)) throw new Error("Invalid browser.");
    if (serializedKey === null) {
      this.browserKeys.delete(browserId);
      this.activeBrowserKeys.delete(browserId);
      this.catalogDeliveryVersions.delete(browserId);
      return;
    }
    if (typeof serializedKey !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(serializedKey)) {
      throw new Error("Invalid key.");
    }
    const key = await importE2eeKey(serializedKey);
    const keyId = await keyIdForKey(key);
    const existing = this.browserKeys.get(browserId);
    if (existing && existing.keyId !== keyId) throw new Error("Browser already enrolled.");
    if ([...this.browserKeys.values()].some(record =>
      record.browserId !== browserId && record.keyId === keyId)) {
      throw new Error("Browser content keys must be independent.");
    }
    this.browserKeys.set(browserId, { browserId, key, keyId });
  }

  syncBrowserAuthorizations(authorizations) {
    if (!Array.isArray(authorizations)) return false;
    const next = new Map();
    for (const authorization of authorizations) {
      if (
        !authorization ||
        typeof authorization.id !== "string" ||
        typeof authorization.key_id !== "string"
      ) {
        continue;
      }
      const seen = typeof authorization.last_seen_at === "number"
        ? authorization.last_seen_at : Date.parse(authorization.last_seen_at);
      if (Number.isFinite(seen)) this.browserActivity.set(authorization.id,
        Math.max(this.browserActivity.get(authorization.id) ?? 0, Math.min(Date.now(), seen)));
      const enrolled = this.browserKeys.get(authorization.id);
      if (enrolled?.keyId === authorization.key_id) {
        next.set(authorization.id, enrolled);
      }
    }
    const changed =
      next.size !== this.activeBrowserKeys.size ||
      [...next.entries()].some(
        ([browserId, browser]) =>
          this.activeBrowserKeys.get(browserId)?.keyId !== browser.keyId,
      );
    for (const [browserId, keyId] of this.directoryClients) {
      if (next.get(browserId)?.keyId !== keyId) this.directoryClients.delete(browserId);
    }
    for (const browserId of this.catalogDeliveryVersions.keys()) {
      if (!next.has(browserId)) {
        this.catalogDeliveryVersions.delete(browserId);
      }
    }
    for (const browserId of this.oversizedCatalogVersions.keys()) {
      if (!next.has(browserId)) this.oversizedCatalogVersions.delete(browserId);
    }
    const authorizedIds = new Set(authorizations.map(value => value?.id));
    const retainAuthorized = entry => {
      const id = entry.message.browser_id;
      if (!id || authorizedIds.has(id)) return true;
      this.uploadKeys.delete(entry.key);
      this.rejectedUploadKeys.delete(entry.key);
      return false;
    };
    this.uploadQueue = this.uploadQueue.filter(retainAuthorized);
    this.uploadIsolationBatches = this.uploadIsolationBatches
      .map(batch => batch.filter(retainAuthorized)).filter(batch => batch.length);
    for (const id of this.browserActivity.keys()) if (!next.has(id)) this.browserActivity.delete(id);
    this.activeBrowserKeys = next;
    this.authorizationObservedAt = Date.now();
    this.directHost?.prune();
    return changed;
  }

  rememberSuccessfulCatalogUpload(message) {
    const version = message?.[CATALOG_DELIVERY_VERSION];
    if (
      message?.kind === "catalog" &&
      typeof message.browser_id === "string" &&
      typeof version === "string"
    ) {
      this.catalogDeliveryVersions.set(message.browser_id, version);
    }
  }

  browserForRequest(requestId) {
    const browserId = this.requestBrowsers.get(requestId);
    return browserId ? (this.activeBrowserKeys.get(browserId) ?? null) : null;
  }

  async waitUntilReady(timeoutMs = 5_000) {
    if (this.ready) return;
    await Promise.race([
      new Promise((resolve) => this.readyWaiters.push(resolve)),
      delay(timeoutMs).then(() => {
        throw new Error("Timed out waiting for Relayune registration.");
      }),
    ]);
  }

  async stop() {
    this.performanceDiagnostics.close();
    this.deltaCoalescer?.close();
    this.localWebProxy.closeAll();
    this.closed = true;
    this.commandPolling = false;
    this.pollAbort?.abort();
    this.ready = false;
    this.directHost?.close();
    this.onlineTransport?.close();
    for (const entry of this.directEvents.values()) clearTimeout(entry.timer);
    this.directEvents.clear();
    await this.codexHooks?.close();
    clearInterval(this.retentionTimer);
    clearInterval(this.heartbeat);
    this.catalogRefresh?.close();
    clearInterval(this.pollTimer);
    clearTimeout(this.uploadRetryTimer);
    clearTimeout(this.bulkUploadRetryTimer);
    this.attachmentBodies.clear(); this.attachmentBodyBytes = 0;
    await this.adapter.close();
    await Promise.allSettled([...this.operations]);
    await this.historyPerformance.flush?.();
    await this.outbox.flush();
    this.attachmentStore?.close();
  }

  async handleMessage(data) {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (["session.submit_message", "session.read_history", "session.interrupt_turn"].includes(message.type) &&
        typeof message.session_id === "string" && this.validateCommand(message)) {
      this.interactiveSessions.delete(message.session_id);
      this.interactiveSessions.set(message.session_id, Date.now() + 5 * 60_000);
      while (this.interactiveSessions.size > 32) {
        this.interactiveSessions.delete(this.interactiveSessions.keys().next().value);
      }
    }
    switch (message.type) {
      case "relay.connected": {
        await this.outbox.acknowledge(message.resume_cursor ?? 0);
        // A successful connection is the recovery boundary if the Server was
        // restored independently. Publish one complete catalog, then suppress
        // unchanged periodic snapshots only after that upload is acknowledged.
        this.catalogDeliveryVersions.clear();
        this.oversizedCatalogVersions.clear();
        const [sessions, projects, usage] = await Promise.all([
          this.readSessionCatalog(),
          this.readProjectCatalog(),
          this.readUsageCatalog(),
        ]);
        this.send({
          type: "relay.sync_sessions",
          device_id: this.deviceId,
          sessions,
          projects,
          usage,
        });
        for (const event of this.outbox.after(message.resume_cursor ?? 0))
          this.send(event, { replay: true });
        this.ready = true;
        for (const resolve of this.readyWaiters.splice(0)) resolve();
        clearInterval(this.heartbeat);
        this.heartbeat = setInterval(
          () =>
            this.send({
              type: "relay.heartbeat",
              device_id: this.deviceId,
              last_event_seq: this.outbox.nextSeq - 1,
            }),
          10_000,
        );
        this.catalogRefresh?.close();
        this.catalogRefresh = new CatalogRefresh({
          paths: this.adapter.catalogWatchPaths?.() ?? [],
          refresh: () => this.syncSessionCatalog(),
        });
        break;
      }
      case "relay.ack":
      case "relay.heartbeat_ack":
        if (Number.isInteger(message.ack_seq))
          await this.outbox.acknowledge(message.ack_seq);
        break;
      case "transport.offer":
        await this.acceptDirectOffer(message);
        break;
      case "session.submit_message":
        await this.submitMessage(message);
        break;
      case "session.read_history":
        await this.readHistory(message);
        break;
      case "session.read_agents":
        await this.readAgents(message);
        break;
      case "session.web_open":
      case "session.web_request":
        await this.handleLocalWeb(message);
        break;
      case "session.read_attachment":
        await this.readAttachment(message);
        break;
      case "session.create":
        await this.createSession(message);
        break;
      case "session.fork":
        await this.forkSession(message);
        break;
      case "project.locations":
      case "project.check":
      case "project.sessions":
      case "project.browse":
      case "project.create":
        await this.handleProjectCommand(message);
        break;
      case "session.interrupt_turn":
        await this.interruptTurn(message);
        break;
      case "session.configure":
        await this.configureSession(message);
        break;
      case "approval.resolve":
        await this.resolveApproval(message);
        break;
      case "session.create_agents":
        await this.createAgents(message);
        break;
    }
  }

  async acceptDirectOffer(command) {
    if (!this.validateCommand(command) || Date.parse(command.expires_at) > Date.now() + 65_000) {
      this.acknowledgeCommand(command, "expired"); return;
    }
    const browser = this.browserForRequest(command.request_id);
    if (!browser) return;
    try {
      if (!this.directHost) {
        const { WebRtcReadHost } = await import("./webrtc-transport.mjs");
        if (this.closed) return;
        this.directHost ??= new WebRtcReadHost({
          authorized: (id, keyId) => this.ready && !this.closed &&
            Date.now() - this.authorizationObservedAt < 45_000 &&
            this.activeBrowserKeys.get(id)?.keyId === keyId,
          receive: (peer, frame) => this.receiveDirectRead(peer, frame),
          onDrop: (peer) => this.fallbackDirectEvents(peer),
        });
      }
      if (command.payload?.operation === "ice") {
        const result = await this.directHost.exchangeCandidates(browser,
          command.payload.connection_id, command.payload.candidates, command.payload.cursor);
        this.send({ type: "transport.answer", request_id: command.request_id, session_id: null,
          connection_id: command.payload.connection_id, ...result });
        this.acknowledgeCommand(command, "completed");
        return;
      }
      const sdp = await this.directHost.offer(browser, command.request_id, command.payload?.sdp,
        command.payload?.trickle === true);
      this.send({ type: "transport.answer", request_id: command.request_id, session_id: null,
        connection_id: command.request_id, sdp });
      this.acknowledgeCommand(command, "completed");
    } catch {
      this.send({ type: "transport.answer", request_id: command.request_id, session_id: null,
        connection_id: command.request_id, error: "webrtc_unavailable" });
      this.acknowledgeCommand(command, "failed");
    }
  }

  async drainDirectUploads(peer) {
    const deadline = Date.now() + 15_000;
    const observed = new Set();
    // flushRemoteUploads owns retries and batch isolation. Awaiting one call is
    // not a barrier: it returns immediately when another upload owns the slot.
    // Track this recipient across queued, quarantined and in-flight batches.
    for (;;) {
      if (!this.directHost?.valid(peer) || peer.eventsState !== "preparing") {
        throw new Error("webrtc_resume_unavailable");
      }
      const pending = [...this.uploadQueue, ...this.uploadIsolationBatches.flat(), ...this.uploadingEntries]
        .filter(entry => entry.message.kind === "event" && entry.message.browser_id === peer.browserId);
      for (const entry of pending) observed.add(entry.key);
      if ([...observed].some(key => this.rejectedUploadKeys.has(key))) {
        throw new Error("webrtc_resume_unavailable");
      }
      if (!pending.length) return;
      if (Date.now() >= deadline) throw new Error("webrtc_resume_unavailable");
      // Respect the existing retry delay; never turn negotiation into a retry loop.
      if (!this.uploading && !this.uploadRetryTimer) void this.flushRemoteUploads();
      await delay(25);
    }
  }

  async receiveDirectRead(peer, frame) {
    const browser = this.activeBrowserKeys.get(peer.browserId);
    if (!this.directHost?.valid(peer) || !browser ||
        this.remoteCommandTasks.has(frame.request_id) || this.directRequests.has(frame.request_id)) return;
    const aad = frame.aad;
    if (frame.device_id !== this.deviceId || aad?.direction !== "web_to_relay" ||
        aad.type !== frame.command_type || aad.device_id !== this.deviceId ||
        aad.request_id !== frame.request_id || aad.session_id !== frame.session_id ||
        aad.event_seq !== null || (frame.session_id !== null && typeof frame.session_id !== "string") ||
        !DIRECT_COMMAND_TYPES.has(frame.command_type)) {
      throw new Error("webrtc_invalid_route");
    }
    const command = await openJson(browser.key, frame.envelope, aad);
    validateSealedCommand(command, frame);
    if (!this.directHost.valid(peer) || !this.validateCommand(command) ||
        command.expires_at !== aad.expires_at || command.issued_at !== aad.created_at ||
        Date.parse(command.expires_at) > Date.now() + 5 * 60_000) throw new Error("webrtc_invalid_request");
    if (command.type === "transport.ping") {
      if (!/^[a-f0-9]{32}$/.test(command.payload?.nonce ?? "")) throw new Error("webrtc_invalid_probe");
      await this.sendDirectControl(peer, browser, command, "transport.pong", {
        nonce: command.payload.nonce, active: peer.eventsState === "direct",
      });
      return;
    }
    if (command.type === "transport.resume") {
      if (peer.eventsState !== "server") return;
      peer.eventsState = "preparing";
      // New events now stay in the encrypted outbox while earlier HTTP pushes drain.
      await Promise.all([...this.operations]);
      await this.drainDirectUploads(peer);
      const aad = relayAad({type: "transport.ready", deviceId: this.deviceId, requestId: command.request_id});
      await this.directHost.send(peer, {kind: "response", device_id: this.deviceId, session_id: null,
        request_id: command.request_id, aad, envelope: await sealJson(browser.key,
          {type: "transport.ready", request_id: command.request_id, session_id: null}, aad)});
      return;
    }
    if (command.type === "transport.activate") {
      if (peer.eventsState !== "preparing") return;
      peer.eventsState = "activating";
      for (const entry of this.directEvents.values()) if (entry.peer === peer && !entry.sent) {
        entry.sent = true;
        await this.directHost.send(peer, entry.frame);
        this.armDirectEventAck(entry);
      }
      peer.eventsState = "direct";
      await this.sendDirectControl(peer, browser, command, "transport.activated", {active: true});
      return;
    }
    if (command.type === "transport.event_ack") {
      const entry = this.directEvents.get(command.payload?.event_id);
      if (entry && entry.peer === peer && entry.frame.event_seq === command.payload?.event_seq) {
        clearTimeout(entry.timer); this.directEvents.delete(entry.frame.event_id);
        await this.outbox.acknowledgeVariants(this.outbox.lastAcked, [entry.frame]);
      }
      return;
    }
    // Decryption is asynchronous: another peer may have reserved this ID.
    if (this.directRequests.size >= 8 || this.remoteCommandTasks.size >= 100 || this.remoteCommandTasks.has(frame.request_id) ||
        this.directRequests.has(frame.request_id) || this.requestBrowsers.has(frame.request_id)) return;
    command.browser_id = peer.browserId;
    this.directRequests.set(command.request_id, peer);
    this.dispatchRemoteCommand(command, browser, Date.now());
    const task = this.remoteCommandTasks.get(command.request_id);
    try { await task; } finally {
      await this.directSends.get(command.request_id);
      this.directSends.delete(command.request_id);
      // send() captures its peer before asynchronously encrypting the response.
      this.directRequests.delete(command.request_id);
      this.requestBrowsers.delete(command.request_id);
    }
  }

  startOnlineTransport() {
    this.onlineTransport = new OnlineRelayTransport({
      serverUrl: this.serverUrl, deviceId: this.deviceId, token: this.deviceToken,
      authorized: id => this.ready && !this.closed && Date.now() - this.authorizationObservedAt < 45_000 && this.activeBrowserKeys.has(id),
      receive: (peer, frame) => this.receiveOnlineCommand(peer, frame),
      changed: () => {
        for (const id of this.onlineTransport.peers.keys()) this.catalogDeliveryVersions.delete(id);
        if (this.ready) void this.syncSessionCatalog();
      },
      paused: peer => this.sendOnlineControl(peer, null, 'transport.resync_required'),
      reservedBytes: () => this.notificationEventBytes,
    });
    // Count unacknowledged durable copies from previous connection generations
    // against the same global budget. Reconnects cannot create fresh capacity.
    for (const record of this.outbox.pending.values()) for (const frame of record.variants ?? []) {
      if (transportPayloadExpired(frame)) continue;
      const bytes = Buffer.byteLength(JSON.stringify(frame));
      if (frame.notification_only) {
        this.notificationEvents.set(frame.event_id, {frame, bytes});
        this.notificationEventBytes += bytes;
      }
      if (!frame.online_only) continue;
      const peer = {browserId: frame.browser_id, count: 1, bytes, lastProgress: Date.now()};
      this.onlineTransport.pending.set(frame.event_id, {peer, frame, bytes});
      this.onlineTransport.pendingBytes += bytes;
    }
    this.onlineTransport.start();
  }

  async sendOnlineControl(peer, requestId, type, payload = {}) {
    const browser = this.activeBrowserKeys.get(peer.browserId);
    if (!browser || !this.onlineTransport?.valid(peer)) return false;
    const aad = relayAad({type, deviceId: this.deviceId, requestId});
    return this.onlineTransport.send(peer, {kind: 'response', device_id: this.deviceId,
      browser_id: peer.browserId, request_id: requestId, session_id: null, aad,
      envelope: await sealJson(browser.key, {type, request_id: requestId, session_id: null,
        connection_id: peer.connectionId, ...payload}, aad)});
  }

  async receiveOnlineCommand(peer, frame) {
    const browser = this.activeBrowserKeys.get(peer.browserId);
    if (!browser || !this.onlineTransport?.valid(peer) || !frame) return;
    const aad = frame.aad;
    if (frame.device_id !== this.deviceId || aad?.direction !== 'web_to_relay' ||
        aad.type !== frame.command_type || aad.device_id !== this.deviceId ||
        aad.request_id !== frame.request_id || aad.session_id !== frame.session_id ||
        aad.event_seq !== null || (frame.session_id !== null && typeof frame.session_id !== 'string') ||
        !DIRECT_COMMAND_TYPES.has(frame.command_type)) throw new Error('online_invalid_route');
    const command = await openJson(browser.key, frame.envelope, aad);
    validateSealedCommand(command, frame);
    if (!this.onlineTransport.valid(peer) || !this.validateCommand(command) ||
        command.expires_at !== aad.expires_at || command.issued_at !== aad.created_at ||
        Date.parse(command.expires_at) > Date.now() + 5 * 60_000) throw new Error('online_invalid_request');
    if (command.type === 'transport.event_ack') {
      const entry = this.onlineTransport.pending.get(command.payload?.event_id);
      if (command.payload?.connection_id === peer.connectionId && entry?.peer === peer &&
          entry.frame.event_seq === command.payload.event_seq) {
        this.onlineTransport.release(entry.frame.event_id);
        await this.outbox.acknowledgeVariants(this.outbox.lastAcked, [entry.frame]);
      }
      return;
    }
    if (command.type === 'transport.resume') {
      if (command.payload?.connection_id !== peer.connectionId) throw new Error('online_invalid_generation');
      // The client issues resume only after its authoritative history/directory
      // baseline succeeds. Retire pre-baseline copies for this recipient alone.
      const superseded = [];
      for (const [id, entry] of this.onlineTransport.pending) if (entry.frame.browser_id === peer.browserId) {
        superseded.push(entry.frame);
        this.onlineTransport.release(id);
      }
      if (superseded.length) await this.outbox.acknowledgeVariants(this.outbox.lastAcked, superseded);
      if (!this.onlineTransport.valid(peer)) return;
      peer.paused = false;
      peer.resyncNeeded = false;
      peer.resyncNotified = false;
      peer.lastProgress = Date.now();
      await this.sendOnlineControl(peer, command.request_id, 'transport.ready');
      this.catalogDeliveryVersions.delete(peer.browserId);
      await this.syncSessionCatalog();
      return;
    }
    if (command.type === 'transport.ping') {
      await this.sendOnlineControl(peer, command.request_id, 'transport.pong', {nonce: command.payload?.nonce});
      return;
    }
    if (command.type === 'transport.activate') return;
    if (this.directRequests.size >= 8 || this.remoteCommandTasks.size >= 100 ||
        this.remoteCommandTasks.has(command.request_id) || this.directRequests.has(command.request_id) ||
        this.requestBrowsers.has(command.request_id)) return;
    command.browser_id = peer.browserId;
    this.directRequests.set(command.request_id, peer);
    this.dispatchRemoteCommand(command, browser, Date.now());
    try { await this.remoteCommandTasks.get(command.request_id); } finally {
      await this.directSends.get(command.request_id);
      this.directSends.delete(command.request_id);
      this.directRequests.delete(command.request_id);
      this.requestBrowsers.delete(command.request_id);
    }
  }

  eventRecipients() {
    if (!this.onlineTransportEnabled) return [...this.activeBrowserKeys.values()];
    return [...this.activeBrowserKeys.values()].filter(browser => {
      const direct = this.directHost?.peers.get(browser.browserId);
      if (direct && this.directHost.valid(direct) && direct.channel?.readyState === 'open' && direct.eventsState !== 'server') return true;
      const peer = this.onlineTransport?.peer(browser.browserId);
      return peer?.transport === 'legacy' || peer?.transport === 'stream' && this.onlineTransport.canGenerate(peer);
    });
  }

  async sendDirectControl(peer, browser, command, type, payload) {
    const aad = relayAad({type, deviceId: this.deviceId, requestId: command.request_id});
    await this.directHost.send(peer, {kind: "response", device_id: this.deviceId, session_id: null,
      request_id: command.request_id, aad, envelope: await sealJson(browser.key,
        {type, request_id: command.request_id, session_id: null, ...payload}, aad)});
  }

  async submitMessage(command) {
    if (!this.validateCommand(command)) {
      this.acknowledgeCommand(command, "expired");
      return;
    }
    if (this.outbox.hasProcessedRequest(command.request_id)) {
      this.acknowledgeCommand(command, "duplicate");
      return;
    }
    await this.outbox.markProcessedRequest(command.request_id);
    this.acknowledgeCommand(command, "accepted");
    try {
      const action = command.payload?.action ?? "message";
      if (!["message", "continue"].includes(action)) throw new Error("Invalid message action.");
      const continuation = action === "continue";
      if (continuation) {
        if (command.payload.content !== "" ||
            (command.payload.attachments !== undefined &&
              (!Array.isArray(command.payload.attachments) || command.payload.attachments.length !== 0)) ||
            command.payload.runtime_settings !== undefined || command.payload.interrupt_running === true ||
            typeof command.payload.expected_turn_id !== "string" || !command.payload.expected_turn_id) {
          throw new Error("Invalid Codex continuation.");
        }
        // Exact routing also covers an opened session outside the recent catalog.
        const supported = typeof this.adapter.providerForSession === "function"
          ? await this.adapter.providerForSession(command.session_id) === "codex"
          : this.adapter.supportsContinuation === true;
        if (!supported) {
          throw new Error("This agent does not support Codex continuation.");
        }
      }
      const attachments = normalizeUploadedAttachments(
        command.payload?.attachments,
      );
      const publicAttachments = attachments.map((attachment) => {
        this.registerAttachment(command.session_id, attachment.id, {
          sessionId: command.session_id,
          source: { type: "data_url", url: attachment.dataUrl },
          name: attachment.name,
          type: attachment.type,
          mimeType: attachment.mime_type,
          detail: attachment.detail,
        });
        return {
          id: attachment.id,
          type: attachment.type,
          name: attachment.name,
          mime_type: attachment.mime_type,
          detail: attachment.detail,
          url: `/api/sessions/${encodeURIComponent(
            command.session_id,
          )}/attachments/${encodeURIComponent(attachment.id)}`,
        };
      });
      if (!continuation) await this.emitEvent(
        command.session_id,
        {
          kind: "user.message",
          item_id: await this.adapter.userMessageId?.({
            sessionId: command.session_id, requestId: command.request_id,
          }) ?? null,
          text: command.payload?.content ?? "",
          client_message_id: command.payload.client_message_id ?? null,
          attachments: publicAttachments,
        },
        { request_id: command.request_id },
      );
      const result = await this.adapter.submitMessage({
        sessionId: command.session_id,
        requestId: command.request_id,
        clientMessageId: command.payload.client_message_id ?? null,
        interruptRunning: command.payload.interrupt_running === true,
        runtimeSettings: command.payload.runtime_settings,
        content: command.payload?.content ?? "",
        attachments,
        ...(continuation ? { action, expectedTurnId: command.payload.expected_turn_id } : {}),
      });
      if (continuation && (result?.action !== "continue" || result.accepted !== true ||
          typeof result.turnId !== "string" || !result.turnId)) {
        throw new Error("Codex continuation acceptance could not be confirmed.");
      }
      await this.emitEvent(command.session_id, {
        kind: "codex.persisted",
        operation: "turn",
        request_id: command.request_id,
        turn_id: result?.turnId ?? null,
        mode: result?.mode ?? "started",
        client_message_id: command.payload.client_message_id ?? command.request_id,
        queued_submission_id: result?.queuedSubmissionId ?? null,
        persisted: result?.persisted !== false,
        verified_at: result?.syncVerifiedAt ?? new Date().toISOString(),
        ...(continuation ? { action, accepted: result?.accepted === true,
          persisted: false } : {}),
      });
      await this.syncSessionCatalog();
    } catch (error) {
      await this.emitEvent(command.session_id, {
        kind: command.payload?.action === "continue" || command.payload?.interrupt_running === true ? "message.failed" : "turn.failed",
        ...(command.payload?.action === "continue" ? { action: "continue" } : {}),
        client_message_id: command.payload?.client_message_id ?? command.request_id,
        request_id: command.request_id,
        error: error instanceof Error ? error.message : "Codex adapter failed.",
      });
    }
  }

  async handleAdapterEvent(sessionId, event, extra) {
    if (event?.kind === "approval.resolved" && event.approval_id) {
      this.pendingApprovals.delete(event.approval_id);
    }
    const publicEvent = this.registerEventAttachments(sessionId, event);
    return this.emitEvent(sessionId, publicEvent, extra);
  }

  async handleAdapterApproval(approval) {
    return this.requestApproval(approval);
  }

  updateFileAccess(scope, denied) {
    if (denied) this.fileAccessFailures.add(scope);
    else this.fileAccessFailures.delete(scope);
    const limited = this.fileAccessFailures.size > 0;
    if (limited !== this.fileAccessWarningActive) {
      this.fileAccessWarningActive = limited;
      // Fixed, parameter-free local diagnostic. No paths or session IDs.
      console.log(limited ? "Relayune file access limited" : "Relayune file access recovered");
    }
  }

  async readSessionCatalog() {
    if (this.sessionCatalogRead) return this.sessionCatalogRead;
    const operation = (async () => {
      try {
        const sessions = await this.performanceDiagnostics.measure('catalog_sync', () => this.adapter.listSessions());
        this.lastSessionCatalog = sessions.sort((a, b) =>
          (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0) || String(a.id).localeCompare(String(b.id)))
          .slice(0, SESSION_DIRECTORY_LIMIT);
        // Probe each distinct directory once, with bounded native Git work.
        for (let offset = 0; offset < this.lastSessionCatalog.length; offset += 8) {
          const decorated = await Promise.all(this.lastSessionCatalog.slice(offset, offset + 8)
            .map(session => this.withForkCapabilities(session)));
          this.lastSessionCatalog.splice(offset, decorated.length, ...decorated);
        }
        this.updateFileAccess("catalog", this.adapter.fileAccessLimited?.() ?? false);
        return this.lastSessionCatalog;
      } catch (error) {
        if (!isFileAccessError(error)) throw error;
        this.updateFileAccess("catalog", true);
        return this.lastSessionCatalog;
      }
    })();
    this.sessionCatalogRead = operation;
    try { return await operation; }
    finally { if (this.sessionCatalogRead === operation) this.sessionCatalogRead = null; }
  }

  async readProjectCatalog() {
    if (this.projectCatalogRead) return this.projectCatalogRead;
    const operation = this.performProjectCatalogRead();
    this.projectCatalogRead = operation;
    try { return await operation; }
    finally { if (this.projectCatalogRead === operation) this.projectCatalogRead = null; }
  }

  async performProjectCatalogRead() {
    try {
      this.lastProjectCatalog = await this.projectManager.listProjects();
      this.updateFileAccess("projects", this.adapter.fileAccessLimited?.() ?? false);
      return this.lastProjectCatalog;
    } catch (error) {
      if (!isFileAccessError(error)) throw error;
      this.updateFileAccess("projects", true);
      return this.lastProjectCatalog;
    }
  }

  async readAccessibleHistory(sessionId, options = {}) {
    try {
      const page = await this.performanceDiagnostics.measure('history_read', () => this.adapter.readHistory({ sessionId, ...options }));
      this.updateFileAccess(`history:${sessionId}`, false);
      if (page.sessions) page.sessions = await Promise.all(page.sessions.map(session => this.withForkCapabilities(session)));
      return page;
    } catch (error) {
      if (isFileAccessError(error)) this.updateFileAccess(`history:${sessionId}`, true);
      throw error;
    }
  }

  async retryFileAccess() {
    if (this.closed || !this.ready) return;
    if (this.fileAccessRecheck) return this.fileAccessRecheck;
    this.fileAccessRecheck = (async () => {
      await this.adapter.retryFileAccess?.();
      for (const scope of [...this.fileAccessFailures]) {
        if (this.closed) return;
        if (!scope.startsWith("history:")) continue;
        try { await this.readAccessibleHistory(scope.slice(8), { limit: 1 }); } catch {}
      }
      await this.syncSessionCatalog();
    })();
    const operation = this.fileAccessRecheck;
    this.operations.add(operation);
    try { await operation; } finally {
      this.operations.delete(operation);
      this.fileAccessRecheck = null;
    }
  }

  async readHistory(command) {
    const receivedAt = this.historyCommandReceivedAt.get(command.request_id) ?? Date.now();
    const readStartedAt = Date.now();
    const readStarted = performance.now();
    const traceId = /^history_[a-f0-9]{32}$/.test(command.payload?.performance_trace_id ?? '')
      ? command.payload.performance_trace_id : null;
    if (!this.validateCommand(command)) {
      this.send({
        type: "session.history_error",
        request_id: command.request_id,
        session_id: command.session_id,
        error: "History request expired or targeted another device.",
      });
      return;
    }
    this.acknowledgeCommand(command, "accepted");
    const progressBrowser = command.payload?.include_progress === true
      ? this.browserForRequest(command.request_id) : null;
    const progress = (stage, sizes = {}) => {
      if (!progressBrowser || this.closed || !this.validateCommand(command) ||
          this.activeBrowserKeys.get(progressBrowser.browserId)?.key !== progressBrowser.key) return;
      const operation = this.writeEvent(command.session_id, {
        kind: 'history.read_progress', request_id: command.request_id, stage,
        ...Object.fromEntries(['source_read_bytes', 'source_total_bytes', 'transfer_bytes']
          .filter(name => Number.isSafeInteger(sizes[name]) && sizes[name] >= 0)
          .map(name => [name, sizes[name]])),
      }, { request_id: command.request_id, recipient: progressBrowser }).catch(() => {});
      this.operations.add(operation);
      void operation.finally(() => this.operations.delete(operation));
    };
    progress('queued');
    let sourceSizes = {};
    let lastSizeUpdate = -Infinity, sizeUpdates = 0;
    let acceptingSourceProgress = false;
    const onProgress = sizes => {
      if (!acceptingSourceProgress || !Number.isSafeInteger(sizes?.source_read_bytes) ||
          !Number.isSafeInteger(sizes?.source_total_bytes) || sizes.source_read_bytes < 0 ||
          sizes.source_read_bytes > sizes.source_total_bytes) return;
      sourceSizes = {source_read_bytes: sizes.source_read_bytes, source_total_bytes: sizes.source_total_bytes};
      // Source readers run in small chunks. Bound encrypted hints so large
      // history reads do not crowd the real-time event channel or await it.
      const now = performance.now();
      if (now - lastSizeUpdate < 500 || sizeUpdates >= 24) return;
      lastSizeUpdate = now; sizeUpdates++;
      progress('reading', sourceSizes);
    };
    try {
      const budget = historyWireBudget(command.payload?.max_bytes);
      const readOptions = {
        limit: Math.min(500, Math.max(1, Number(command.payload?.limit) || 100)),
        before: command.payload?.before ?? null,
        includeAgentDetails: command.payload?.include_agent_details !== false,
        // Reserve room for routing, metadata, JSON and the encrypted envelope.
        maxBytes: budget ? Math.floor(budget * 0.6) : command.payload?.max_bytes,
      };
      const wireOptions = {deviceId: this.deviceId,
        browserId: this.browserForRequest(command.request_id)?.browserId ?? null,
        aad: relayAad({type: 'session.history', deviceId: this.deviceId,
          sessionId: command.session_id, requestId: command.request_id})};
      let response;
      for (;;) {
        progress('reading');
        sourceSizes = {};
        acceptingSourceProgress = true;
        let page;
        const readProgress = {active: true};
        try { page = await this.readAccessibleHistory(command.session_id, {
          ...readOptions,
          ...(progressBrowser ? {onProgress: sizes => {
            if (readProgress.active) onProgress(sizes);
          }} : {}),
        }); }
        finally { readProgress.active = false; acceptingSourceProgress = false; }
        progress('preparing', sourceSizes);
        let messages = this.registerHistoryAttachments(command.session_id, page.messages);
        if (budget) messages = messages.map(message => compactHistoryMessage(message,
          Math.min(16 * 1024, Math.floor(budget / 4)), (bytes, name, mimeType) =>
            this.registerHistoryDocument(command.session_id, bytes, name, mimeType)));
        response = {type: 'session.history', request_id: command.request_id,
          session_id: command.session_id, messages, next_cursor: page.next_cursor,
          has_more: page.has_more, agents: page.agents ?? [], sessions: page.sessions ?? [],
          ...(traceId ? {performance: {trace_id: traceId, desktop_received_at_ms: receivedAt,
            history_started_at_ms: readStartedAt, command_wait_ms: readStartedAt - receivedAt,
            history_ready_at_ms: Date.now(), history_read_ms: performance.now() - readStarted,
            message_count: messages.length}} : {})};
        if (!budget) break;
        const metadata = {agents: response.agents, sessions: response.sessions};
        if (Buffer.byteLength(JSON.stringify(metadata)) > budget / 4) {
          const attachment = this.registerHistoryDocument(command.session_id,
            Buffer.from(JSON.stringify(metadata)), '会话详情.json', 'application/json');
          response.agents = []; response.sessions = []; response.metadata_attachment = attachment;
          if (messages.length) response.messages = messages.map((message, index) => index === 0
            ? {...message, attachments: [...(message.attachments ?? []), attachment]} : message);
        }
        const wireBytes = encryptedHistoryWireBytes(response, wireOptions);
        if (wireBytes <= budget) break;
        if (readOptions.limit === 1 || messages.length <= 1) throw new Error('history_wire_budget_exceeded');
        // Ask the adapter for a smaller page so its native cursor remains valid
        // across providers. Every omitted older message stays reachable.
        readOptions.limit = Math.max(1, Math.min(messages.length - 1,
          Math.floor(messages.length * budget / wireBytes * 0.9)));
      }
      if (budget) Object.defineProperty(response, HISTORY_WIRE_BUDGET, {value: budget});
      progress('sending', {...sourceSizes,
        transfer_bytes: encryptedHistoryFrameBytes(response, wireOptions)});
      this.send(response);
    } catch (error) {
      this.send({
        type: "session.history_error",
        request_id: command.request_id,
        session_id: command.session_id,
        error_code: isFileAccessError(error) ? "file_access_denied" : "history_read_failed",
        error: isFileAccessError(error)
          ? "Relayune cannot access the local session files. Allow file access on your computer and retry."
          : "History could not be read on your computer.",
      });
    }
  }

  registerHistoryDocument(sessionId, bytes, name, mimeType) {
    if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('history_document_too_large');
    const id = `history_document_${createHash('sha256').update(sessionId).update('\0')
      .update(name).update('\0').update(bytes).digest('hex').slice(0, 40)}`;
    this.registerAttachment(sessionId, id, {sessionId, source: {type: 'stored_bytes', bytes},
      name, type: 'file', mimeType});
    // Persisted documents need not hold a second unbounded plaintext copy.
    if (this.attachmentStore) this.attachments.delete(id);
    return {id, type: 'file', name, mime_type: mimeType, size: bytes.length, preview_supported: true,
      url: `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(id)}`};
  }

  async readAgents(command) {
    if (!this.validateCommand(command)) {
      this.send({
        type: "session.agents_error",
        request_id: command.request_id,
        session_id: command.session_id,
        error: "Agent activity request expired or targeted another device.",
      });
      return;
    }
    this.acknowledgeCommand(command, "accepted");
    try {
      const agents =
        typeof this.adapter.readAgents === "function"
          ? await this.adapter.readAgents({ sessionId: command.session_id })
          : ((
              await this.adapter.readHistory({
                sessionId: command.session_id,
                limit: 1,
                before: null,
              })
            ).agents ?? []);
      this.send({
        type: "session.agents",
        request_id: command.request_id,
        session_id: command.session_id,
        agents,
      });
    } catch (error) {
      this.send({
        type: "session.agents_error",
        request_id: command.request_id,
        session_id: command.session_id,
        error:
          error instanceof Error
            ? error.message
            : "Agent activity read failed.",
      });
    }
  }

  registerHistoryAttachments(sessionId, messages) {
    return (messages ?? []).map((message) => {
      if (message?.role === "codex") {
        message = { ...message, content: normalizeVisualizationReferences(message.content) };
      }
      const referencedAttachments =
        message?.role === "codex"
          ? referencedFileAttachments(message.content, {
              sessionId,
              messageId: message.id,
            })
          : [];
      const privateAttachments = mergeAttachments(
        message.attachments,
        referencedAttachments,
      );
      return {
        ...message,
        attachments: privateAttachments.map((attachment) => {
          let registered = false;
          if (attachment?.relay_source && attachment?.id) {
            registered = this.registerReferencedAttachment(sessionId, attachment.id, {
              sessionId,
              source: attachment.relay_source,
              name: attachment.name || "Codex 图片",
              type: attachment.type,
              mimeType: attachment.mime_type,
              detail: attachment.detail ?? null,
            });
          }
          const publicAttachment = { ...attachment };
          delete publicAttachment.relay_source;
          if (!registered) return publicAttachment;
          return {
            ...publicAttachment,
            url: `/api/sessions/${encodeURIComponent(
              sessionId,
            )}/attachments/${encodeURIComponent(attachment.id)}`,
          };
        }),
      };
    });
  }

  registerEventAttachments(sessionId, event) {
    if (event?.kind === "message.completed") {
      event = { ...event, text: normalizeVisualizationReferences(event.text) };
    }
    const referencedAttachments =
      event?.kind === "message.completed"
        ? referencedFileAttachments(event.text, {
            sessionId,
            messageId: event.item_id ?? event.turn_id,
          })
        : [];
    const privateAttachments = [
      ...(Array.isArray(event?.attachments) ? event.attachments : []),
      ...(event?.relay_attachment &&
      typeof event.relay_attachment === "object"
        ? [event.relay_attachment]
        : []),
      ...referencedAttachments,
    ].filter(
      (attachment, index, attachments) =>
        attachment?.id &&
        attachments.findIndex((candidate) => candidate?.id === attachment.id) ===
          index,
    );
    if (!privateAttachments.length) {
      return event;
    }
    const publicEvent = { ...event };
    delete publicEvent.relay_attachment;
    return {
      ...publicEvent,
      attachments: privateAttachments.map((privateAttachment) => {
        let registered = false;
        if (privateAttachment.relay_source && privateAttachment.id) {
          registered = this.registerReferencedAttachment(sessionId, privateAttachment.id, {
            sessionId,
            source: privateAttachment.relay_source,
            name: privateAttachment.name || "Codex 图片",
            type: privateAttachment.type,
            mimeType: privateAttachment.mime_type,
            detail: privateAttachment.detail ?? null,
          });
        }
        const publicAttachment = { ...privateAttachment };
        delete publicAttachment.relay_source;
        if (!registered) return publicAttachment;
        return {
          ...publicAttachment,
          url: `/api/sessions/${encodeURIComponent(
            sessionId,
          )}/attachments/${encodeURIComponent(privateAttachment.id)}`,
        };
      }),
    };
  }

  async handleLocalWeb(command) {
    const browser = this.browserForRequest(command.request_id);
    const authorized = () => this.validateCommand(command) && !this.closed &&
      this.activeBrowserKeys.get(browser?.browserId)?.key === browser?.key &&
      Date.now() - this.authorizationObservedAt < 45_000;
    if (!browser || !authorized()) return;
    this.acknowledgeCommand(command, "accepted");
    try {
      let result;
      const owner = `${browser.browserId}:${browser.keyId}`;
      if (command.type === 'session.web_open') {
        // Prove this is an accessible session before granting an origin-scoped capability.
        await this.readAccessibleHistory(command.session_id, { limit: 1 });
        if (!authorized()) return;
        result = this.localWebProxy.open(owner, command.session_id, command.payload?.url);
      } else {
        result = await this.localWebProxy.request(owner, command.session_id, command.payload, authorized);
      }
      if (!authorized()) return;
      this.send({ type: 'session.web_result', request_id: command.request_id,
        session_id: command.session_id, ...result });
    } catch (error) {
      // Never echo the destination, headers, response, body, or socket error.
      this.send({ type: 'session.web_error', request_id: command.request_id,
        session_id: command.session_id,
        error_code: /^web_[a-z_]+$/.test(error?.code ?? '') ? error.code : 'web_request_failed' });
    }
  }

  async readAttachment(command) {
    if (!this.validateCommand(command)) {
      this.send({
        type: "session.attachment_error",
        request_id: command.request_id,
        session_id: command.session_id,
        error_code: "attachment_request_expired",
        error: "Attachment request expired or targeted another device.",
      });
      return;
    }
    this.acknowledgeCommand(command, "accepted");
    const attachmentId = command.payload?.attachment_id;
    try {
      const ranged = command.payload?.offset !== undefined || command.payload?.max_bytes !== undefined;
      const offset = command.payload?.offset ?? 0;
      const maxBytes = command.payload?.max_bytes;
      if (ranged && (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_ATTACHMENT_BYTES ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 192 * 1024)) {
        throw attachmentError('attachment_range_invalid', 'Attachment range is invalid.');
      }
      const requestedVariant = command.payload?.variant === 'preview' ? 'preview' : 'original';
      let attachment = this.attachments.get(attachmentId) ?? (ranged
        ? this.attachmentBodies.get(JSON.stringify([command.session_id, attachmentId, requestedVariant]))?.attachment : null);
      if (!attachment || attachment.sessionId !== command.session_id) {
        attachment = this.attachmentStore?.get(command.session_id, attachmentId);
        if (attachment && attachment.source?.type !== 'stored_bytes') this.attachments.set(attachmentId, attachment);
      }
      if (!attachment || attachment.sessionId !== command.session_id) {
        throw attachmentError(
          "attachment_not_found",
          "Attachment is not registered for this Codex session.",
        );
      }
      const variant =
        attachment.type === "image" && command.payload?.variant === "preview"
          ? "preview"
          : "original";
      const content = ranged
        ? await this.readAttachmentBody(command.session_id, attachmentId, attachment, variant)
        : variant === 'preview'
          ? await createImagePreview(await readAttachmentSource(attachment.source, attachment))
          : await readAttachmentSource(attachment.source, attachment);
      if (ranged && offset > content.bytes.length) throw attachmentError('attachment_range_invalid', 'Attachment range is invalid.');
      const bytes = ranged ? content.bytes.subarray(offset, Math.min(content.bytes.length, offset + maxBytes)) : content.bytes;
      const nextOffset = offset + bytes.length;
      this.send({
        type: "session.attachment",
        request_id: command.request_id,
        session_id: command.session_id,
        attachment_id: attachmentId,
        variant,
        name: attachment.name,
        mime_type: content.mimeType,
        size: bytes.byteLength,
        base64: bytes.toString("base64"),
        ...(ranged ? {offset, total_size: content.bytes.length, next_offset: nextOffset,
          has_more: nextOffset < content.bytes.length, content_digest: content.digest} : {}),
      });
    } catch (error) {
      this.send({
        type: "session.attachment_error",
        request_id: command.request_id,
        session_id: command.session_id,
        error_code: error?.code ?? "attachment_read_failed",
        error:
          error instanceof Error
            ? error.message
            : "Codex attachment could not be read.",
      });
    }
  }

  async readAttachmentBody(sessionId, attachmentId, attachment, variant) {
    const key = JSON.stringify([sessionId, attachmentId, variant]);
    const existing = this.attachmentBodies.get(key);
    if (existing) {
      this.attachmentBodies.delete(key); this.attachmentBodies.set(key, existing);
      return existing.promise;
    }
    const entry = {bytes: 0, promise: null, attachment: {
      sessionId, name: attachment.name, type: attachment.type, mimeType: attachment.mimeType,
    }};
    entry.promise = Promise.resolve().then(async () => {
      let content = await readAttachmentSource(attachment.source, attachment);
      if (variant === 'preview') content = await createImagePreview(content);
      if (content.bytes.length > MAX_ATTACHMENT_BYTES) throw attachmentError('attachment_too_large', 'Attachment exceeds the 20 MiB limit.');
      const result = {...content, digest: createHash('sha256').update(content.bytes).digest('hex')};
      if (this.attachmentBodies.get(key) !== entry) return result;
      entry.bytes = content.bytes.length;
      this.attachmentBodyBytes += entry.bytes;
      // Freeze one materialization across range requests. A source modified
      // after eviction produces a new digest, which the client rejects.
      while (this.attachmentBodyBytes > 32 * 1024 * 1024 || this.attachmentBodies.size > 64) {
        const [oldKey, oldEntry] = this.attachmentBodies.entries().next().value;
        this.attachmentBodies.delete(oldKey); this.attachmentBodyBytes -= oldEntry.bytes;
      }
      return result;
    }).catch(error => {
      if (this.attachmentBodies.get(key) === entry) {
        this.attachmentBodies.delete(key); this.attachmentBodyBytes -= entry.bytes;
      }
      throw error;
    });
    this.attachmentBodies.set(key, entry);
    while (this.attachmentBodies.size > 64) {
      const [oldKey, oldEntry] = this.attachmentBodies.entries().next().value;
      this.attachmentBodies.delete(oldKey); this.attachmentBodyBytes -= oldEntry.bytes;
    }
    return entry.promise;
  }

  async handleProjectCommand(command) {
    if (!this.validateCommand(command)) { this.acknowledgeCommand(command, "expired"); return; }
    if (command.type === "project.sessions" && command.payload?.directory_sync === true) {
      const browser = this.browserForRequest(command.request_id);
      if (!browser) return;
      let result;
      try {
        result = { directory: this.sessionDirectory.read(command.payload) };
        this.directoryClients.set(browser.browserId, browser.keyId);
      } catch { result = { error_code: 'invalid_request' }; }
      // Memory-only reads never queue behind native project browsing/creation.
      this.send({ type: 'project.result', request_id: command.request_id, session_id: null, ...result });
      await Promise.all([...this.operations]);
      this.acknowledgeCommand(command, 'completed');
      return;
    }
    // Serialize across browsers so journal records always use the request owner's key.
    const operation = this.projectCommandChain.catch(() => {}).then(async () => {
      this.projectOperationBrowser = this.browserForRequest(command.request_id);
      if (!this.projectOperationBrowser) return;
      let result;
      try {
        const p = command.payload ?? {};
        result = command.type === "project.locations" ? await this.projectManager.locations(p.provider)
          : command.type === "project.sessions" ? await this.projectManager.sessions(p)
          : command.type === "project.check" ? await this.projectManager.check(p)
          : command.type === "project.browse" ? await this.projectManager.browse(p.provider, p.path, p.offset ?? 0)
          : await this.projectManager.create(p, command.browser_id);
      } catch (error) {
        const codes = new Set(["unsupported", "invalid_name", "invalid_location", "location_unavailable", "permission_denied", "invalid_request", "operation_mismatch", "location_changed", "creation_unconfirmed", "already_exists", "save_failed_directory_created", "save_failed"]);
        result = { error_code: codes.has(error.code) ? error.code : "project_failed" };
      }
      // Enqueue the encrypted response before acknowledging; retries recover the journal.
      this.send({ type: "project.result", request_id: command.request_id, session_id: null, ...result });
      await Promise.all([...this.operations]);
      this.acknowledgeCommand(command, "completed");
      if (result.project) await this.syncSessionCatalog();
      this.projectOperationBrowser = null;
    });
    this.projectCommandChain = operation;
    await operation;
  }

  registerReferencedAttachment(sessionId, attachmentId, attachment) {
    try {
      return this.registerAttachment(sessionId, attachmentId, attachment);
    } catch (error) {
      if (error?.code !== "attachment_id_conflict") throw error;
      // History/live replay can describe an already stored provider attachment
      // differently. Its ID stays bound to the original encrypted entry; never
      // replace it with the replay's source or let it disable the whole agent.
      this.attachments.delete(attachmentId);
      return true;
    }
  }

  registerAttachment(sessionId, attachmentId, attachment) {
    if (!isPersistableAttachmentSource(attachment?.source)) return false;
    this.attachmentStore?.put(sessionId, attachmentId, attachment);
    this.attachments.set(attachmentId, attachment);
    return true;
  }

  async withForkCapabilities(session) {
    const capability = this.adapter.forkCapabilities?.(session);
    if (!capability?.mode || session.is_subagent) {
      const {fork_mode, supports_fork_worktree, ...visible} = session;
      return visible;
    }
    let git = false;
    if (capability.worktree && typeof session.cwd === "string") {
      let check = this.forkGitChecks.get(session.cwd);
      if (!check || check.until < Date.now()) {
        check = { until: Date.now() + 30_000, value: canCreateSessionWorktree(session.cwd) };
        this.forkGitChecks.set(session.cwd, check);
        while (this.forkGitChecks.size > SESSION_DIRECTORY_LIMIT) this.forkGitChecks.delete(this.forkGitChecks.keys().next().value);
      }
      git = await check.value;
    }
    return { ...session, fork_mode: capability.mode, supports_fork_worktree: git };
  }

  async forkSession(command) {
    if (!this.validateCommand(command)) {
      this.acknowledgeCommand(command, "expired");
      return;
    }
    if (this.outbox.hasProcessedRequest(command.request_id)) {
      this.acknowledgeCommand(command, "duplicate");
      return;
    }
    await this.outbox.markProcessedRequest(command.request_id);
    this.acknowledgeCommand(command, "accepted");
    let worktree = null;
    let nativeStarted = false;
    try {
      const payload = command.payload;
      const validId = value => typeof value === "string" && value.length > 0 && value.length <= 256;
      if (!validId(command.session_id) || !validId(payload?.message_id) ||
          (payload.turn_id !== null && payload.turn_id !== undefined && !validId(payload.turn_id)) ||
          !["same_directory", "worktree"].includes(payload?.mode)) throw new Error("session_fork_invalid_reply");
      if (typeof this.adapter.forkSource !== "function" || typeof this.adapter.forkSession !== "function") {
        throw new Error("session_fork_unsupported");
      }
      const selection = {sessionId: command.session_id, messageId: payload.message_id, turnId: payload.turn_id ?? null};
      const source = await this.adapter.forkSource(selection);
      if (source?.id !== command.session_id || !isAbsolute(source.cwd ?? "")) throw new Error("session_not_found");
      const capability = this.adapter.forkCapabilities?.(source);
      if (!capability?.mode || source.is_subagent) throw new Error("session_fork_unsupported");
      if (!this.validateCommand(command)) throw new Error("session_fork_cancelled");
      if (payload.mode === "worktree") {
        if (!capability.worktree) throw new Error("session_worktree_unavailable");
        worktree = await createSessionWorktree({cwd: source.cwd, requestId: command.request_id, rootDir: this.sessionWorktreeRoot});
      }
      if (!this.validateCommand(command)) throw new Error("session_fork_cancelled");
      const cwd = worktree?.cwd ?? source.cwd;
      nativeStarted = true;
      const created = await this.adapter.forkSession({...selection, cwd});
      if (!created?.id || created.id === source.id || !isAbsolute(created.cwd ?? "")) {
        throw new Error("session_fork_outcome_unknown");
      }
      const identity = value => process.platform === "win32" ? value.toLowerCase() : value;
      if (identity(await realpath(created.cwd)) !== identity(await realpath(cwd))) {
        throw new Error("session_fork_outcome_unknown");
      }
      // The phone cannot resolve filesystem aliases on this computer. Preserve
      // its source directory spelling after the native identity check above.
      const session = await this.withForkCapabilities(payload.mode === "same_directory"
        ? {...created, cwd: source.cwd} : created);
      this.send({type: "session.fork_result", request_id: command.request_id,
        session_id: session.id, source_session_id: source.id, session});
      const operation = this.finalizeCreatedSession(session, command.request_id).catch(() => {});
      this.operations.add(operation);
      void operation.finally(() => this.operations.delete(operation));
    } catch (error) {
      const known = new Set(["session_fork_unsupported", "session_fork_busy", "session_fork_invalid_reply",
        "session_fork_latest_only", "session_not_found", "session_worktree_unavailable", "session_worktree_failed", "session_fork_cancelled"]);
      const code = known.has(error?.code) ? error.code : known.has(error?.message) ? error.message :
        nativeStarted ? "session_fork_outcome_unknown" : "session_fork_failed";
      // Native transport uncertainty may have persisted a thread. Keep its
      // directory; the existing execution receipt forbids automatic replay.
      if (worktree && code !== "session_fork_outcome_unknown") await worktree.cleanup().catch(() => {});
      this.send({type: "session.fork_error", request_id: command.request_id,
        session_id: command.session_id, source_session_id: command.session_id, error: code});
    }
  }

  async createSession(command) {
    if (!this.validateCommand(command)) {
      this.acknowledgeCommand(command, "expired");
      return;
    }
    if (this.outbox.hasProcessedRequest(command.request_id)) {
      this.acknowledgeCommand(command, "duplicate");
      return;
    }
    await this.outbox.markProcessedRequest(command.request_id);
    this.acknowledgeCommand(command, "accepted");
    try {
      const { cwd, name, provider } = normalizeSessionCreation(command.payload);
      const createdSession = await this.adapter.createSession({
        cwd,
        name,
        provider,
      });
      this.send({
        type: "session.create_result",
        request_id: command.request_id,
        session_id: createdSession.id,
        session: createdSession,
      });
      const operation = this.finalizeCreatedSession(
        createdSession,
        command.request_id,
      ).catch(() => {});
      this.operations.add(operation);
      void operation.finally(() => this.operations.delete(operation));
    } catch (error) {
      this.send({
        type: "session.create_error",
        request_id: command.request_id,
        error:
          error instanceof Error
            ? error.message
            : "Codex session creation failed.",
      });
    }
  }

  async finalizeCreatedSession(createdSession, requestId) {
    if (this.closed) return;
    let session = createdSession;
    let persisted = session.sync_state === "persisted";
    if (typeof this.adapter.finalizeSessionCreation === "function") {
      try {
        session = await this.adapter.finalizeSessionCreation(createdSession);
        persisted = session.sync_state === "persisted";
      } catch {
        // A failed name/read-back request must not turn an already-created
        // thread into a creation error or encourage a duplicate retry.
      }
    }
    if (this.closed) return;
    try {
      const [catalog, projects, usage] = await Promise.all([
        this.readSessionCatalog(),
        this.readProjectCatalog(),
        this.readUsageCatalog(),
      ]);
      if (this.closed) return;
      this.send({
        type: "relay.sync_sessions",
        device_id: this.deviceId,
        sessions: mergeCreatedSessionIntoCatalog(catalog, session),
        projects,
        usage,
      });
    } catch {
      // Creation already has an authoritative response. Keep the previous
      // complete catalog until a later polling cycle can rebuild it.
    }
    if (this.closed) return;
    await this.emitEvent(session.id, {
      kind: "codex.persisted",
      operation: "thread",
      request_id: requestId,
      persisted,
      verified_at: session.sync_verified_at ?? new Date().toISOString(),
    });
  }

  async interruptTurn(command) {
    if (!this.validateCommand(command)) {
      this.acknowledgeCommand(command, "expired");
      return;
    }
    this.acknowledgeCommand(command, "accepted");
    try {
      await this.adapter.interruptTurn({ sessionId: command.session_id });
    } catch (error) {
      await this.emitEvent(command.session_id, {
        kind: "turn.interrupt_failed",
        error:
          error instanceof Error ? error.message : "Codex interrupt failed.",
      });
    }
  }

  async createAgents(command) {
    if (!this.validateCommand(command)) {
      this.acknowledgeCommand(command, "expired");
      return;
    }
    if (this.outbox.hasProcessedRequest(command.request_id)) {
      this.acknowledgeCommand(command, "duplicate");
      return;
    }
    await this.outbox.markProcessedRequest(command.request_id);
    this.acknowledgeCommand(command, "accepted");
    await this.adapter.createAgents({
      sessionId: command.session_id,
      tasks: command.payload.tasks,
    });
  }

  async configureSession(command) {
    if (!this.validateCommand(command)) {
      this.acknowledgeCommand(command, "expired");
      return;
    }
    if (this.outbox.hasProcessedRequest(command.request_id)) {
      this.acknowledgeCommand(command, "duplicate");
      return;
    }
    await this.outbox.markProcessedRequest(command.request_id);
    this.acknowledgeCommand(command, "accepted");
    try {
      const result = await this.adapter.configureSession({
        sessionId: command.session_id,
        configId: command.payload?.config_id,
        value: command.payload?.value,
      });
      this.send({
        type: "session.configure_result",
        request_id: command.request_id,
        session_id: command.session_id,
        config_id: command.payload?.config_id,
        config_options: result?.configOptions ?? [],
      });
      await this.emitEvent(command.session_id, {
        kind: "session.config_updated",
        config_options: result?.configOptions ?? [],
      });
      await this.syncSessionCatalog();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Local agent session configuration failed.";
      this.send({
        type: "session.configure_error",
        request_id: command.request_id,
        session_id: command.session_id,
        config_id: command.payload?.config_id,
        error: message,
      });
      await this.emitEvent(command.session_id, {
        kind: "session.config_failed",
        error: message,
      });
    }
  }

  async requestApproval(approval) {
    const local = {
      ...approval,
      device_id: this.deviceId,
    };
    this.pendingApprovals.set(local.approval_id, {
      ...local,
      resolving: false,
    });
    await this.emitEvent(local.root_session_id ?? local.session_id, {
      kind: "approval.requested",
      ...local,
    });
  }

  async resolveApproval(command) {
    let payload;
    let pending;
    let resolutionStarted = false;
    try {
      if (!this.validateCommand(command)) {
        throw new Error("Approval command expired or targeted another device.");
      }
      payload = command.payload;
      this.validateApprovalPayload(payload);
      pending = this.pendingApprovals.get(payload.approval_id);
      if (!pending) {
        // A client may still display a request from an earlier Relay process.
        // Confirm that it is gone instead of leaving the decision spinning.
        if (typeof payload.approval_id === "string" && payload.approval_id.length <= 256 &&
            typeof payload.session_id === "string" && payload.session_id.length <= 256 &&
            payload.session_id === command.session_id) {
          this.consumedNonces.add(payload.nonce);
          await this.emitEvent(payload.session_id, {
            kind: "approval.resolved",
            approval_id: payload.approval_id,
            decision: "expired",
          });
        }
        return;
      }
      if (pending.resolving) {
        throw new Error("Approval is already being resolved on this Mac.");
      }
      if (
        payload.session_id !== pending.session_id ||
        payload.device_id !== pending.device_id
      ) {
        throw new Error("Approval decision targets another pending action.");
      }
      if (
        payload.expires_at !== pending.expires_at ||
        Date.parse(pending.expires_at) <= Date.now()
      ) {
        throw new Error("Approval decision has expired.");
      }
      if (hashAction(stripHash(pending.action)) !== payload.command_hash) {
        throw new Error(
          "Local command hash changed after approval was requested.",
        );
      }
      if (pending.action.command_hash !== payload.command_hash) {
        throw new Error(
          "Approval command hash does not match the pending action.",
        );
      }
      pending.resolving = true;
      resolutionStarted = true;
      this.consumedNonces.add(payload.nonce);
      const resolver = pending.source === "codex_hook" ? this.codexHooks : this.adapter;
      if (!resolver) throw new Error("Hook approval is no longer pending.");
      const result = await resolver.resolveApproval({
        approvalId: pending.approval_id,
        decision: payload.decision,
        optionId: payload.option_id ?? null,
        answer: payload.answer ?? null,
      });
      resolutionStarted = false;
      if (["serverRequest/resolved", "hook/resolved"].includes(result?.confirmation)) return;
      this.pendingApprovals.delete(payload.approval_id);
      await this.emitEvent(pending.root_session_id ?? pending.session_id, {
        kind: "approval.resolved",
        approval_id: pending.approval_id,
        decision: payload.decision,
        command_hash: payload.command_hash,
      });
    } catch (error) {
      if (pending && resolutionStarted) {
        pending.resolving = false;
        await this.emitEvent(pending.root_session_id ?? pending.session_id, {
          kind: "approval.failed",
          approval_id: pending.approval_id,
          error:
            error instanceof Error
              ? error.message
              : "Approval verification failed.",
        });
      }
    }
  }

  validateApprovalPayload(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("Approval payload is missing.");
    }
    if (payload.device_id !== this.deviceId)
      throw new Error("Approval targets another device.");
    if (typeof payload.nonce !== "string" || payload.nonce.length < 16) {
      throw new Error("Approval nonce is invalid.");
    }
    if (this.consumedNonces.has(payload.nonce))
      throw new Error("Approval nonce was already consumed.");
    if (!["approved", "rejected"].includes(payload.decision)) {
      throw new Error("Unsupported approval decision.");
    }
    if (
      payload.option_id !== null &&
      payload.option_id !== undefined &&
      (typeof payload.option_id !== "string" ||
        !payload.option_id ||
        payload.option_id.length > 256)
    ) {
      throw new Error("Approval option is invalid.");
    }
    if (
      payload.answer !== null &&
      payload.answer !== undefined &&
      (typeof payload.answer !== "string" || payload.answer.length > 4_000)
    ) {
      throw new Error("Approval answer is invalid.");
    }
  }

  validateCommand(command) {
    return (
      command.device_id === this.deviceId &&
      typeof command.request_id === "string" &&
      Date.parse(command.expires_at) > Date.now()
    );
  }

  acknowledgeCommand(command, status) {
    this.send({
      type: "command.ack",
      request_id: command.request_id,
      status,
      acknowledged_at: new Date().toISOString(),
    });
  }

  emitEvent(sessionId, event, extra = {}) {
    if (event.kind !== "turn.thinking") this.catalogRefresh?.request();
    this.deltaCoalescer ??= new DeltaCoalescer((...args) => this.writeEvent(...args));
    if (this.closed) this.deltaCoalescer.close();
    return this.deltaCoalescer.enqueue(sessionId, event, extra);
  }

  async writeEvent(sessionId, event, extra = {}) {
    const historyProgress = event.kind === 'history.read_progress';
    const recipient = historyProgress ? extra.recipient : null;
    if (historyProgress && (!recipient || event.request_id !== extra.request_id ||
        !['queued', 'reading', 'preparing', 'sending'].includes(event.stage))) return null;
    const createdAt = new Date().toISOString();
    const sessionInfo = this.lastSessionCatalog?.find(session => session.id === sessionId);
    const pushEvent = sessionInfo?.is_subagent && !event.root_session_id
      ? {...event, root_session_id: sessionInfo.root_session_id} : event;
    const iosSnapshot = this.iosPushState.transition(sessionId, pushEvent, Date.parse(createdAt));
    const record = await this.outbox.appendWithSequence(async (eventSeq) => {
      const recipients = this.eventRecipients().filter(browser => !historyProgress ||
        browser.browserId === recipient.browserId && browser.key === recipient.key);
      const notificationOnly = new Set();
      const notify = shouldNotifyPhone(sessionId, event, this.lastSessionCatalog, extra);
      // Background completion/attention is a low-frequency durable notification,
      // separate from the stream. Never retain offline deltas or tool output.
      let notificationBudget = 0;
      if (this.onlineTransportEnabled && notify) {
        notificationBudget = ONLINE_TOTAL_EVENT_BYTES - [...this.outbox.pending.values()]
          .reduce((sum, value) => sum + Buffer.byteLength(JSON.stringify(value)), 0);
        const present = new Set(recipients.map(browser => browser.browserId));
        for (const browser of this.activeBrowserKeys.values()) if (!present.has(browser.browserId)) {
          recipients.push(browser);
          notificationOnly.add(browser.browserId);
        }
      }
      const aad = relayAad({
        type: "session.event",
        deviceId: this.deviceId,
        sessionId,
        requestId: extra?.request_id ?? event?.request_id ?? null,
        eventSeq,
        createdAt,
      });
      const variants = await Promise.all(
        recipients.map(async (browser) => ({
          kind: "event",
          ...(notificationOnly.has(browser.browserId) ? {notification_only: true} : {}),
          ios_push: await this.iosPushState.seal(browser.key, iosSnapshot, aad),
          ...(notify ? { notification_hint: true } : {}),
          event_id: createId("evt"),
          event_seq: eventSeq,
          device_id: this.deviceId,
          browser_id: browser.browserId,
          session_id: sessionId,
          agent_id: extra?.agent_id ?? null,
          request_id: extra?.request_id ?? event?.request_id ?? null,
          created_at: createdAt,
          aad,
          envelope: await sealJson(
            browser.key,
            {
              type: "session.event",
              session_id: sessionId,
              agent_id: extra?.agent_id ?? null,
              request_id: extra?.request_id ?? event?.request_id ?? null,
              event: notificationOnly.has(browser.browserId) ? compactNotificationEvent(event) : event,
              created_at: createdAt,
            },
            aad,
          ),
        })),
      );
      const accepted = variants.filter(frame => {
        if (historyProgress && this.activeBrowserKeys.get(frame.browser_id)?.key !== recipient.key) return false;
        if (frame.notification_only) {
          const bytes = Buffer.byteLength(JSON.stringify(frame));
          if (bytes > 16 * 1024 || bytes > notificationBudget) return false;
          notificationBudget -= bytes;
          this.notificationEvents.set(frame.event_id, {frame, bytes});
          this.notificationEventBytes += bytes;
          return true;
        }
        const direct = this.directHost?.peers.get(frame.browser_id);
        if (direct && this.directHost.valid(direct) && direct.channel?.readyState === 'open' && direct.eventsState !== 'server') return true;
        const peer = this.onlineTransport?.peer(frame.browser_id);
        if (peer?.transport === 'stream') {
          frame.online_only = true;
          return this.onlineTransport.hold(peer, frame);
        }
        return !this.onlineTransportEnabled || peer?.transport === 'legacy';
      });
      if (!accepted.length) return null;
      return {
        type: "opaque.event.bundle",
        event_seq: eventSeq,
        variants: accepted,
      };
    });
    if (record) this.send(record);
    return record;
  }

  async syncSessionCatalog() {
    if (!this.ready || this.closed) return;
    if (this.catalogSyncPending) return this.catalogSyncPending;
    const operation = this.performSessionCatalogSync();
    this.catalogSyncPending = operation;
    try { await operation; } finally { if (this.catalogSyncPending === operation) this.catalogSyncPending = null; }
  }

  async performSessionCatalogSync() {
    const observedAt = new Date().toISOString();
    // Session state is the critical lane. Optional metadata keeps its own
    // coalesced read and publishes its latest successful value on the next tick.
    void this.readProjectCatalog().catch(() => {});
    void this.readUsageCatalog().catch(() => {});
    try {
      const sessions = await this.readSessionCatalog();
      if (this.closed) return;
      this.send({
        type: "relay.sync_sessions",
        observed_at: observedAt,
        device_id: this.deviceId,
        sessions,
        projects: this.lastProjectCatalog,
        usage: this.usageCatalog,
      });
    } catch {
      // The next polling cycle or reconnect will retry the local agent catalog.
    }
  }

  async readUsageCatalog() {
    if (typeof this.adapter.readUsage !== "function") return {};
    // Supplementary statistics must not hold connection/catalog delivery hostage.
    // Share the outstanding read so repeated catalog polls cannot pile up work.
    if (!this.usageCatalogRead) {
      this.usageCatalogRead = Promise.resolve()
        .then(() => this.adapter.readUsage())
        .then(usage => { this.usageCatalog = usage ?? {}; })
        .catch(() => {})
        .finally(() => { this.usageCatalogRead = null; });
    }
    let timer;
    try {
      await Promise.race([
        this.usageCatalogRead,
        new Promise(resolve => { timer = setTimeout(resolve, this.usageCatalogTimeoutMs); }),
      ]);
      return this.usageCatalog;
    } finally {
      clearTimeout(timer);
    }
  }

  fallbackDirectEvents(peer) {
    const onlinePeer = this.onlineTransport?.peer(peer.browserId);
    if (onlinePeer?.transport === 'stream') this.onlineTransport.pause(onlinePeer);
    for (const [id, entry] of this.directEvents) {
      if (entry.peer !== peer) continue;
      clearTimeout(entry.timer); this.directEvents.delete(id);
      if (!this.closed && this.activeBrowserKeys.has(entry.frame.browser_id) &&
          (!this.onlineTransportEnabled || this.onlineTransport?.peer(entry.frame.browser_id)?.transport === 'legacy')) {
        this.enqueueRemoteMessages([entry.frame], {live: true});
        void this.flushRemoteUploads();
      }
    }
  }

  async deliverDirectEvent(peer, frame) {
    if (this.directEvents.has(frame.event_id)) return;
    if (this.directEvents.size >= 256) throw new Error("direct_events_busy");
    const entry = {peer, frame, timer: null, sent: peer.eventsState === "direct"};
    this.directEvents.set(frame.event_id, entry);
    if (entry.sent) {
      await this.directHost.send(peer, frame);
      this.armDirectEventAck(entry);
    }
  }

  armDirectEventAck(entry) {
    // An event may already have been acknowledged while send() was completing.
    if (this.directEvents.get(entry.frame.event_id) !== entry || entry.timer) return;
    entry.timer = setTimeout(() => {
      if (this.directEvents.get(entry.frame.event_id) === entry) this.directHost.drop(entry.peer);
    }, 10000);
    entry.timer.unref?.();
  }

  send(message, { replay = false } = {}) {
    if (this.closed) return false;
    const directPeer = this.directRequests.get(message.request_id);
    const operation = (async () => {
      // ACKs on the data channel carry the same application encryption as data.
      if (directPeer && message.type === "command.ack") {
        const receipt = this.outbox.transportRequests[message.request_id];
        if (!receipt) return;
        const aad = relayAad({type: "command.ack", deviceId: this.deviceId, requestId: message.request_id});
        const browser = this.activeBrowserKeys.get(directPeer.browserId);
        if (browser) {
          try {
            const frame = {kind: "receipt", device_id: this.deviceId,
            browser_id: browser.browserId, request_id: message.request_id, session_id: null,
            aad, envelope: await sealJson(browser.key, message, aad)};
            if (directPeer.transport === 'stream') this.onlineTransport?.send(directPeer, frame);
            else await this.directHost.send(directPeer, frame);
          } catch {}
        }
        return;
      }
      const encoded = await this.encodeRemoteMessage(message);
      const upload = [];
      for (const frame of encoded) {
        const receipt = this.outbox.transportRequests[frame.request_id];
        if (frame.kind === "response" && receipt && receipt.browserId === frame.browser_id) {
          const bytes = Buffer.byteLength(JSON.stringify(frame));
          const retained = Object.values(this.outbox.transportRequests).reduce((sum, item) => sum + (item.bytes ?? 0), 0);
          if (bytes + retained - (receipt.bytes ?? 0) > 16 * 1024 * 1024) {
            // Preserve the durable result over HTTPS rather than retain unbounded copies.
            upload.push(frame);
            continue;
          }
          receipt.frames = [frame]; receipt.bytes = bytes;
          await this.outbox.persist();
        }
        const peer = directPeer?.transport === 'stream' ? null : (directPeer ?? this.directHost?.peers.get(frame.browser_id));
        if (peer && this.directHost?.valid(peer) && peer.channel?.readyState === "open" &&
            ((frame.kind === "event" && peer.eventsState !== "server") || (directPeer && frame.kind === "response"))) {
          try {
            if (frame.kind === "event") await this.deliverDirectEvent(peer, frame);
            else await this.directHost.send(peer, frame);
            continue;
          } catch { this.directHost.drop(peer); }
        }
        const onlinePeer = directPeer?.transport === 'stream' ? directPeer : this.onlineTransport?.peer(frame.browser_id);
        // Responses follow the request's transport. A live subscription alone
        // does not register a stream waiter for an HTTPS mutation or fallback.
        // Sending that result only on WSS strands the caller's durable read.
        if (!frame.notification_only && onlinePeer?.transport === 'stream' &&
            (frame.kind === 'event' || frame.kind === 'catalog' ||
              frame.kind === 'response' && directPeer?.transport === 'stream')) {
          const entry = this.onlineTransport.pending.get(frame.event_id);
          if (frame.kind === 'event' && (entry?.peer !== onlinePeer || onlinePeer.paused)) continue;
          if (this.onlineTransport.send(onlinePeer, frame)) {
            if (frame.kind === 'catalog') this.rememberSuccessfulCatalogUpload(frame);
            continue;
          }
          if (frame.kind === 'event') this.onlineTransport.pause(onlinePeer);
          // Large responses may use the existing encrypted HTTPS response path;
          // disconnected or slow event consumers must never create Mongo load.
          if (frame.kind !== 'response') continue;
        }
        if (frame.kind === 'event' && !frame.notification_only && (frame.online_only || this.onlineTransportEnabled &&
            this.onlineTransport?.peer(frame.browser_id)?.transport !== 'legacy')) continue;
        // Read requests get a fresh ID on fallback; mutations keep their receipt.
        if (directPeer && directPeer.transport !== 'stream' && frame.kind === "response" && !receipt) continue;
        upload.push(frame);
      }
      if (upload.length) {
        this.enqueueRemoteMessages(upload, {live: !replay});
        await this.flushRemoteUploads();
      }
    })().catch(error => {
      const key = `encode:${safeUploadErrorCode(error)}`;
      this.rejectedUploadKeys.add(key);
      this.reportDeliveryWarning(error);
    });
    if (directPeer) {
      const previous = this.directSends.get(message.request_id);
      this.directSends.set(message.request_id, Promise.all([previous, operation]));
    }
    this.operations.add(operation);
    void operation.finally(() => this.operations.delete(operation));
    return true;
  }

}

function compactNotificationEvent(event) {
  // Approval details are recovered from Desktop after opening the notification.
  // A truncated approval must never appear actionable in the event consumer.
  if (event.kind === 'approval.requested') return {kind: 'notification.available'};
  const value = {kind: event.kind};
  for (const key of ['turn_id', 'status', 'root_session_id']) {
    if (typeof event[key] === 'string' && event[key].length <= 160) value[key] = event[key];
  }
  return value;
}

function isBulkUpload(message) {
  return message.kind === 'response' && (
    ['session.history', 'session.attachment', 'session.web_result'].includes(message.aad?.type) ||
    Buffer.byteLength(JSON.stringify(message.envelope ?? {})) > 64 * 1024);
}

function serializableCatalog(message) {
  return JSON.parse(
    JSON.stringify({
      type: message.type,
      desktop: message.desktop,
      sessions: message.sessions ?? [],
      projects: message.projects ?? [],
      usage: message.usage ?? {},
      file_access_limited: message.file_access_limited === true,
    }),
  );
}

function catalogContentFingerprint(catalog) {
  const stableSessions = stableCatalogArray(
    catalog.sessions,
    stableSessionForCatalogFingerprint,
  );
  const stableProjects = stableCatalogArray(catalog.projects);
  const stableUsage = {};
  for (const [provider, snapshot] of Object.entries(catalog.usage)) {
    if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
      const stableSnapshot = { ...snapshot };
      delete stableSnapshot.as_of;
      stableUsage[provider] = stableSnapshot;
    } else {
      stableUsage[provider] = snapshot;
    }
  }
  const stableCatalog = {
    ...catalog,
    sessions: stableSessions,
    projects: stableProjects,
    usage: stableUsage,
  };
  return createHash("sha256")
    .update(canonicalJson(stableCatalog))
    .digest("hex");
}

function catalogDeliveryVersion(keyId, fingerprint) {
  return `${keyId}:${fingerprint}`;
}

function stableSessionForCatalogFingerprint(session) {
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    return session;
  }
  const stable = { ...session };
  // Active adapters may refresh this observation time on every list call.
  // Status and running_started_at carry the meaningful live transition; the
  // final idle catalog retains updated_at and is delivered once the turn ends.
  if (stable.status === "active") delete stable.updated_at;
  return stable;
}

function stableCatalogArray(items, transform = (item) => item) {
  return items
    .map((item) => transform(item))
    .sort((left, right) => compareCanonicalJson(left, right));
}

function compareCanonicalJson(left, right) {
  const leftText = canonicalJson(left);
  const rightText = canonicalJson(right);
  if (leftText < rightText) return -1;
  if (leftText > rightText) return 1;
  return 0;
}

class RemoteUploadError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "RemoteUploadError";
    this.status = status;
    this.code = typeof code === "string" ? code : null;
  }
}

function isPermanentUploadRejection(error) {
  return (
    error instanceof RemoteUploadError &&
    (error.status === 400 || error.status === 409 || error.status === 413)
  );
}

function isAuthorizationUploadError(error) {
  return (
    error instanceof RemoteUploadError &&
    (error.status === 401 || error.status === 403)
  );
}

function safeUploadErrorCode(error) {
  const candidate = error instanceof RemoteUploadError ? error.code : null;
  if (candidate && /^[a-z][a-z0-9_]{0,63}$/.test(candidate)) {
    return candidate;
  }
  if (error instanceof RemoteUploadError) return `http_${error.status}`;
  return "local_encoding_failed";
}

function remoteMessageKey(message) {
  const browserId = String(message?.browser_id ?? "none");
  switch (message?.kind) {
    case "event":
      return `event:${browserId}:${String(message.event_seq ?? "invalid")}`;
    case "catalog":
      return `catalog:${browserId}`;
    case "response":
      return `response:${browserId}:${String(message.request_id ?? "invalid")}`;
    case "command_ack":
      return `command_ack:${String(message.request_id ?? "invalid")}:${String(message.status ?? "invalid")}`;
    case "heartbeat":
      return "heartbeat";
    default:
      return `unknown:${String(message?.kind ?? "missing")}:${browserId}:${String(message?.request_id ?? message?.event_seq ?? "invalid")}`;
  }
}

function stripHash(action) {
  const plain = { ...action };
  delete plain.command_hash;
  return plain;
}

function relayAad({
  type,
  deviceId,
  sessionId = null,
  requestId = null,
  eventSeq = null,
  createdAt = new Date().toISOString(),
  expiresAt = null,
}) {
  return {
    direction: "relay_to_web",
    type,
    device_id: deviceId,
    session_id: sessionId,
    request_id: requestId,
    event_seq: eventSeq,
    created_at: createdAt,
    expires_at: expiresAt,
  };
}

function validateSealedCommand(command, frame) {
  if (!command || typeof command !== "object") {
    throw new Error("Remote command plaintext is invalid.");
  }
  if (
    command.device_id !== frame.device_id ||
    command.request_id !== frame.request_id ||
    (command.session_id ?? null) !== (frame.session_id ?? null) ||
    command.type !== frame.command_type
  ) {
    throw new Error(
      "Remote command routing metadata does not match its ciphertext.",
    );
  }
}

async function readRemoteJson(response) {
  return response.json().catch(() => ({}));
}

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_ATTACHMENTS = 4;
const SUPPORTED_ATTACHMENT_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

function normalizeSessionCreation(payload) {
  const cwd = typeof payload?.cwd === "string" ? payload.cwd.trim() : "";
  const name = typeof payload?.name === "string" ? payload.name.trim() : "";
  const provider = payload?.provider ?? "codex";
  if (!["codex", "kimi", "claude", "opencode", "zcode", "mcode", "pi"].includes(provider)) {
    throw new Error("The requested agent does not support remote session creation.");
  }
  if (!cwd) {
    throw new Error(
      "A synced project directory is required to create a session.",
    );
  }
  if (
    !name ||
    [...name].length > MAX_SESSION_NAME_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(name)
  ) {
    throw new Error(
      `Session name must contain 1-${MAX_SESSION_NAME_LENGTH} visible characters.`,
    );
  }
  return { cwd, name, provider };
}

function mergeCreatedSessionIntoCatalog(catalog, created) {
  // The user may already have started a turn or changed settings while the
  // background verification ran. Keep that newer state, not the idle snapshot.
  const current = catalog?.find((session) => session?.id === created.id);
  const merged = [{ ...created, ...current }];
  for (const session of catalog ?? []) {
    if (!session?.id || session.id === created.id) continue;
    merged.push(session);
  }
  return merged;
}

function normalizeUploadedAttachments(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_UPLOAD_ATTACHMENTS) {
    throw attachmentError(
      "attachment_count_invalid",
      `A message can include at most ${MAX_UPLOAD_ATTACHMENTS} images.`,
    );
  }
  let totalBytes = 0;
  return value.map((attachment, index) => {
    if (!attachment || typeof attachment !== "object") {
      throw attachmentError(
        "attachment_invalid",
        "Uploaded image metadata is invalid.",
      );
    }
    const claimedMimeType = String(attachment.mime_type ?? "").toLowerCase();
    if (!SUPPORTED_ATTACHMENT_MIME_TYPES.has(claimedMimeType)) {
      throw attachmentError(
        "attachment_unsupported",
        "Only PNG, JPEG, WebP, GIF, and AVIF images can be uploaded.",
      );
    }
    if (
      typeof attachment.base64 !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        attachment.base64,
      )
    ) {
      throw attachmentError(
        "attachment_invalid",
        "Uploaded image data is invalid.",
      );
    }
    const bytes = Buffer.from(attachment.base64, "base64");
    totalBytes += bytes.byteLength;
    if (!bytes.byteLength || totalBytes > MAX_ATTACHMENT_BYTES) {
      throw attachmentError(
        "attachment_too_large",
        "Uploaded images exceed the 20 MiB total limit.",
      );
    }
    const detectedMimeType = detectImageMime(bytes);
    if (detectedMimeType !== claimedMimeType) {
      throw attachmentError(
        "attachment_mime_mismatch",
        "Uploaded image type does not match its content.",
      );
    }
    const name = sanitizeAttachmentName(
      attachment.name,
      index,
      detectedMimeType,
    );
    const id =
      typeof attachment.id === "string" &&
      /^[A-Za-z0-9_-]{1,100}$/.test(attachment.id)
        ? attachment.id
        : createId("upload");
    const detail = ["auto", "low", "high", "original"].includes(
      attachment.detail,
    )
      ? attachment.detail
      : null;
    return {
      id,
      type: "image",
      name,
      mime_type: detectedMimeType,
      detail,
      base64: bytes.toString("base64"),
      dataUrl: `data:${detectedMimeType};base64,${bytes.toString("base64")}`,
    };
  });
}

function sanitizeAttachmentName(value, index, mimeType) {
  const fallback = `image-${index + 1}.${extensionFromImageMime(mimeType)}`;
  if (typeof value !== "string") return fallback;
  const sanitized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
    .trim()
    .slice(0, 180);
  return sanitized || fallback;
}

function mergeAttachments(existing, referenced) {
  return [...(Array.isArray(existing) ? existing : []), ...referenced].filter(
    (attachment, index, attachments) =>
      attachment?.id &&
      attachments.findIndex((candidate) => candidate?.id === attachment.id) ===
        index,
  );
}

function referencedFileAttachments(text, { sessionId, messageId }) {
  const links = markdownLocalFileLinks(text).slice(
    0,
    MAX_REFERENCED_FILES_PER_MESSAGE,
  );
  return links.map((path, index) => {
    const name = basename(path);
    const preview = isCodexVisualizationPath(path)
      ? { type: "file", mimeType: "text/html", supported: true }
      : referencedFilePreview(name);
    const id = `reply_file_${createHash("sha256")
      .update(`${sessionId}\0${messageId ?? "message"}\0${index}\0${path}`)
      .digest("hex")
      .slice(0, 40)}`;
    return {
      id,
      type: preview.type,
      name,
      mime_type: preview.mimeType,
      preview_supported: preview.supported,
      ...(preview.supported
        ? { relay_source: { type: "local_path", path } }
        : {}),
    };
  });
}

function markdownLocalFileLinks(value) {
  const text = typeof value === "string" ? value : "";
  const pattern =
    /\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|((?:\/|[A-Za-z]:[\\/])[^)\s]+))(?:\s+["'][^)\n]*["'])?\s*\)/g;
  const paths = [];
  for (const match of text.matchAll(pattern)) {
    let target = match[1] ?? match[2] ?? "";
    try {
      target = decodeURIComponent(target);
    } catch {
      continue;
    }
    target = target.replace(/#L\d+(?:C\d+)?$/i, "");
    target = target.replace(/:\d+(?::\d+)?$/, "");
    if (!isAbsolute(target) || !basename(target)) continue;
    if (!paths.includes(target)) paths.push(target);
  }
  return paths;
}

function referencedFilePreview(fileName) {
  const normalizedName = String(fileName).toLowerCase();
  const normalized = extname(normalizedName);
  const imageMimeType = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".avif": "image/avif",
  }[normalized];
  if (imageMimeType) {
    return { type: "image", mimeType: imageMimeType, supported: true };
  }
  const mappedMimeType = {
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".txt": "text/plain",
    ".pdf": "application/pdf",
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".json": "application/json",
    ".ipynb": "application/json",
    ".jsonl": "application/x-ndjson",
    ".ndjson": "application/x-ndjson",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".toml": "application/toml",
    ".ini": "text/plain",
    ".cfg": "text/plain",
    ".conf": "text/plain",
    ".properties": "text/plain",
    ".xml": "application/xml",
    ".svg": "image/svg+xml",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }[normalized];
  const mimeType =
    mappedMimeType ??
    (PLAIN_TEXT_PREVIEW_EXTENSIONS.has(normalized) ||
    EXTENSIONLESS_TEXT_PREVIEW_NAMES.has(normalizedName)
      ? "text/plain"
      : "application/octet-stream");
  return {
    type: "file",
    mimeType,
    supported:
      mimeType === "application/pdf" || UTF8_PREVIEW_MIME_TYPES.has(mimeType),
  };
}

async function readAttachmentSource(source, attachment) {
  if (source?.type === 'rollout_jsonl') {
    return readAttachmentSource({type: 'data_url', url: await readRolloutAttachmentDataUrl(source)}, attachment);
  }
  if (source?.type === "local_path") {
    if (attachment?.type === "file") {
      return readLocalPreviewFile(source.path, attachment.mimeType);
    }
    return readLocalImage(source.path);
  }
  if (source?.type === "data_url") {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(
      source.url ?? "",
    );
    if (!match)
      throw attachmentError(
        "attachment_unsupported",
        "Unsupported image data URL.",
      );
    const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw attachmentError(
        "attachment_too_large",
        "Codex image exceeds the 20 MiB limit.",
      );
    }
    return { bytes, mimeType: detectImageMime(bytes) };
  }
  if (source?.type === "stored_bytes" && Buffer.isBuffer(source.bytes)) {
    const bytes = source.bytes;
    if (!bytes.byteLength || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw attachmentError(
        "attachment_too_large",
        "Stored image exceeds the 20 MiB limit.",
      );
    }
    if (attachment?.type === 'file' && UTF8_PREVIEW_MIME_TYPES.has(attachment.mimeType)) {
      return {bytes, mimeType: attachment.mimeType};
    }
    const mimeType = detectImageMime(bytes);
    if (attachment?.mimeType && mimeType !== attachment.mimeType) {
      throw attachmentError(
        "attachment_mime_mismatch",
        "Stored image type does not match its content.",
      );
    }
    return { bytes, mimeType };
  }
  throw attachmentError(
    "attachment_unsupported",
    "Unsupported Codex attachment source.",
  );
}

async function createImagePreview(original) {
  if (process.platform === "darwin") {
    return createImagePreviewWithSips(original);
  }
  try {
    return await createImagePreviewWithSharp(original);
  } catch (error) {
    if (error?.code) throw error;
    throw attachmentError(
      "attachment_preview_unsupported",
      "This computer cannot generate a secure image preview.",
    );
  }
}

async function createImagePreviewWithSips(original) {
  const directory = await mkdtemp(join(tmpdir(), "relayune-image-preview-"));
  const input = join(
    directory,
    `source.${extensionFromImageMime(original.mimeType)}`,
  );
  try {
    await writeFile(input, original.bytes, { mode: 0o600 });
    const { width, height } = await readImageDimensionsWithSips(input);
    const landscape = width >= height;
    const maxWidth = landscape
      ? IMAGE_PREVIEW_LANDSCAPE_WIDTH
      : IMAGE_PREVIEW_LANDSCAPE_HEIGHT;
    const maxHeight = landscape
      ? IMAGE_PREVIEW_LANDSCAPE_HEIGHT
      : IMAGE_PREVIEW_LANDSCAPE_WIDTH;
    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const candidates = [
      ...(original.mimeType === "image/png" ? [{ format: "png" }] : []),
      { format: "jpeg", quality: IMAGE_PREVIEW_JPEG_QUALITY },
    ];
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const output = join(
        directory,
        `preview-${index}.${candidate.format === "png" ? "png" : "jpg"}`,
      );
      const arguments_ = [
        "-z",
        String(targetHeight),
        String(targetWidth),
        "-s",
        "format",
        candidate.format,
      ];
      if (candidate.quality) {
        arguments_.push("-s", "formatOptions", String(candidate.quality));
      }
      arguments_.push(input, "--out", output);
      try {
        await execFileAsync("/usr/bin/sips", arguments_, {
          timeout: 15_000,
          windowsHide: true,
        });
      } catch {
        continue;
      }
      const bytes = await readFile(output);
      if (bytes.byteLength <= MAX_IMAGE_PREVIEW_BYTES) {
        return {
          bytes,
          mimeType:
            candidate.format === "png" ? "image/png" : "image/jpeg",
        };
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  throw attachmentError(
    "attachment_preview_failed",
    "The 720p image preview exceeds 1 MB at JPEG quality 85.",
  );
}

async function readImageDimensionsWithSips(input) {
  const { stdout } = await execFileAsync(
    "/usr/bin/sips",
    ["-g", "pixelWidth", "-g", "pixelHeight", input],
    { timeout: 15_000, windowsHide: true },
  );
  const width = Number(/pixelWidth:\s*(\d+)/u.exec(stdout)?.[1]);
  const height = Number(/pixelHeight:\s*(\d+)/u.exec(stdout)?.[1]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw attachmentError(
      "attachment_preview_unsupported",
      "The image dimensions could not be read securely.",
    );
  }
  return { width, height };
}

async function createImagePreviewWithSharp(original) {
  const sharpModuleName = "sharp";
  const imported = await import(sharpModuleName);
  const sharp = imported.default;
  const metadata = await sharp(original.bytes, { animated: false }).metadata();
  if (!metadata.width || !metadata.height) {
    throw attachmentError(
      "attachment_preview_unsupported",
      "The image dimensions could not be read securely.",
    );
  }
  const landscape = metadata.width >= metadata.height;
  const resized = sharp(original.bytes, { animated: false }).resize({
    width: landscape
      ? IMAGE_PREVIEW_LANDSCAPE_WIDTH
      : IMAGE_PREVIEW_LANDSCAPE_HEIGHT,
    height: landscape
      ? IMAGE_PREVIEW_LANDSCAPE_HEIGHT
      : IMAGE_PREVIEW_LANDSCAPE_WIDTH,
    fit: "inside",
    withoutEnlargement: true,
  });
  if (original.mimeType === "image/png") {
    const png = await resized.clone().png({ compressionLevel: 9 }).toBuffer();
    if (png.byteLength <= MAX_IMAGE_PREVIEW_BYTES) {
      return { bytes: png, mimeType: "image/png" };
    }
  }
  const bytes = await resized
    .clone()
    .jpeg({ quality: IMAGE_PREVIEW_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  if (bytes.byteLength <= MAX_IMAGE_PREVIEW_BYTES) {
    return { bytes, mimeType: "image/jpeg" };
  }
  throw attachmentError(
    "attachment_preview_failed",
    "The 720p image preview exceeds 1 MB at JPEG quality 85.",
  );
}

function isPersistableAttachmentSource(source) {
  return Boolean(
    (source?.type === 'rollout_jsonl' && typeof source.path === 'string' && isAbsolute(source.path) &&
      Number.isSafeInteger(source.offset) && source.offset >= 0 && Number.isSafeInteger(source.length) && source.length > 0 &&
      typeof source.identity === 'string' && /^[a-f0-9]{64}$/.test(source.digest ?? '') &&
      Number.isSafeInteger(source.data_url_index) && source.data_url_index >= 0) ||
    (source?.type === "local_path" &&
      typeof source.path === "string" &&
      isAbsolute(source.path)) ||
      (source?.type === "data_url" &&
        typeof source.url === "string" &&
        /^data:[^;,]+;base64,[A-Za-z0-9+/]*={0,2}$/.test(source.url)) ||
      (source?.type === "stored_bytes" && Buffer.isBuffer(source.bytes)),
  );
}

async function readLocalPreviewFile(path, mimeType) {
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw attachmentError(
      "attachment_not_found",
      "The referenced file path is invalid.",
    );
  }
  let handle;
  try {
    if (mimeType === "text/html" &&
        (!isCodexVisualizationPath(path) || await realpath(path) !== resolve(path))) {
      throw attachmentError("attachment_unsupported", "Only local Codex visualization artifacts can be previewed as HTML.");
    }
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw attachmentError(
        "attachment_unsupported",
        "Only regular files can be previewed.",
      );
    }
    if (stats.size > MAX_PREVIEW_FILE_BYTES) {
      throw attachmentError(
        "attachment_too_large",
        "Files larger than 1 MB cannot be previewed yet.",
      );
    }
    const bytes = await handle.readFile();
    validatePreviewFile(bytes, mimeType);
    return { bytes, mimeType };
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw attachmentError(
        "attachment_gone",
        "The referenced file is no longer available locally.",
      );
    }
    if (error?.code === "ELOOP") {
      throw attachmentError(
        "attachment_unsupported",
        "Symbolic-link files cannot be previewed.",
      );
    }
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function validatePreviewFile(bytes, mimeType) {
  if (mimeType === "application/pdf") {
    if (bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw attachmentError(
        "attachment_mime_mismatch",
        "The referenced file is not a valid PDF.",
      );
    }
    return;
  }
  if (!UTF8_PREVIEW_MIME_TYPES.has(mimeType)) {
    throw attachmentError(
      "attachment_unsupported",
      "This file format cannot be safely previewed as UTF-8 text.",
    );
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0")) throw new Error("binary text");
  } catch {
    throw attachmentError(
      "attachment_mime_mismatch",
      "The referenced text file is not valid UTF-8 text.",
    );
  }
  if (mimeType === "image/svg+xml") {
    try {
      validateSvgPreview(text);
    } catch {
      throw attachmentError(
        "attachment_unsupported",
        "SVG files with active or external content cannot be previewed.",
      );
    }
  }
}

function validateSvgPreview(text) {
  if (!/<svg\b/i.test(text) || !/<\/svg\s*>/i.test(text)) {
    throw new Error("invalid SVG root");
  }
  if (
    /<!DOCTYPE|<!ENTITY|<script\b|<foreignObject\b|<iframe\b|<object\b|<embed\b|<audio\b|<video\b|<link\b|<base\b|<form\b|\son[a-z]+\s*=|@import/i.test(
      text,
    ) ||
    /(?:xlink:)?href\s*=\s*["'](?!#)/i.test(text) ||
    /url\(\s*(?!["']?#)/i.test(text) ||
    /<(?:animate|set)\b[^>]*\battributeName\s*=\s*["'](?:xlink:)?href["']/is.test(
      text,
    )
  ) {
    throw new Error("unsafe SVG content");
  }
}

async function readLocalImage(path) {
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw attachmentError(
      "attachment_not_found",
      "Codex image path is invalid.",
    );
  }
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw attachmentError(
        "attachment_unsupported",
        "Codex image is not a regular file.",
      );
    }
    if (stats.size > MAX_ATTACHMENT_BYTES) {
      throw attachmentError(
        "attachment_too_large",
        "Codex image exceeds the 20 MiB limit.",
      );
    }
    const bytes = await handle.readFile();
    return { bytes, mimeType: detectImageMime(bytes) };
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw attachmentError(
        "attachment_gone",
        "Codex image is no longer available locally.",
      );
    }
    if (error?.code === "ELOOP") {
      throw attachmentError(
        "attachment_unsupported",
        "Symbolic-link images are not allowed.",
      );
    }
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function detectImageMime(bytes) {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  const header = bytes.subarray(0, 6).toString("ascii");
  if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes.subarray(4, 8).toString("ascii") === "ftyp" &&
    ["avif", "avis"].includes(bytes.subarray(8, 12).toString("ascii"))
  ) {
    return "image/avif";
  }
  throw attachmentError(
    "attachment_unsupported",
    "Only PNG, JPEG, WebP, GIF, and AVIF Codex images are supported.",
  );
}

function extensionFromImageMime(mimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/avif") return "avif";
  return "png";
}

function attachmentError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
