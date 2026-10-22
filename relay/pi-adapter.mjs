import { withThinkingState } from "./turn-thinking.mjs";
import { serializeSessionControl, stopBeforeSending } from "./interrupt-and-send.mjs";
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, realpath, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, dirname } from "node:path";
import { PiRpcClient } from "./pi-rpc-client.mjs";
import { PI_EXTENSION_SOURCE } from "./pi-extension.mjs";
import { listPiSessions, readPiSession, piText, piHistoryMessages, paginatePiHistory, piForkReply } from "./pi-history.mjs";
import { agentSpawnOptions } from "./platform-process.mjs";
import { hashAction } from "./protocol.mjs";

export const PI_SUPPORTED_VERSION = "1.0.4";
const supportedVersions = new Set(["0.85.1", PI_SUPPORTED_VERSION]);
const now = () => new Date().toISOString();
const piForkError = code => Object.assign(new Error(code), { code });

/** Pi RPC adapter. Completed external histories continue in a private snapshot;
 * the original native process/file is never taken over or written concurrently. */
export class PiAdapter {
  constructor(options = {}) {
    this.provider = "pi";
    this.command = options.piBin ?? process.env.PI_BIN ?? "pi";
    this.args = options.piArgs ?? [];
    this.workspace = options.workspace ?? process.cwd();
    this.home = options.piHome ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.probe = options.probe ?? (() => this.probeVersion());
    this.sessions = new Map();
    this.connections = new Map();
    this.starting = new Map();
    this.activeTurns = new Map();
    this.pendingApprovals = new Map();
    this.configuring = new Set();
    this.forking = new Set();
    this.closed = false;
  }

  async start(handlers) {
    this.handlers = withThinkingState(handlers);
    const version = await this.probe();
    if (!supportedVersions.has(version)) throw new Error(`Pi ${PI_SUPPORTED_VERSION} is required for this adapter.`);
    this.version = version;
    const directory = join(this.home, "relayune");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    this.extensionPath = join(directory, "bridge-v1.mjs");
    await writeFile(this.extensionPath, PI_EXTENSION_SOURCE, { mode: 0o600 });
  }

  probeVersion() {
    return new Promise((resolve, reject) => {
      const child = this.spawnProcess(this.command, [...this.args, "--version"], agentSpawnOptions(this.command, {
        cwd: this.workspace, stdio: ["ignore", "pipe", "pipe"],
      }));
      let output = "";
      const timer = setTimeout(() => { child.kill(); reject(new Error("Pi version probe timed out.")); }, 5000);
      child.stdout.on("data", chunk => { if (output.length < 4096) output += chunk; });
      child.stderr.resume();
      child.once("error", () => { clearTimeout(timer); reject(new Error("Pi is not installed or cannot start.")); });
      child.once("close", code => {
        clearTimeout(timer);
        if (code === 0) resolve(output.match(/\b\d+\.\d+\.\d+\b/)?.[0]);
        else reject(new Error("Pi could not report its version."));
      });
    });
  }

  async listSessions() {
    const sessions = await listPiSessions(join(this.home, "sessions"));
    const catalog = new Map();
    for (const session of sessions) {
      const id = this.sessionId(session);
      if (!catalog.has(id) || session.header.relayuneSourceId) catalog.set(id, session);
    }
    this.sessions = catalog;
    return [...catalog.values()].map(session => this.toRelaySession(session));
  }

  async metadata(sessionId) {
    if (!this.sessions.has(sessionId)) await this.listSessions();
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Pi session was not found.");
    return session;
  }

  async createSession({ cwd = this.workspace, name = "Pi" }) {
    if (this.closed) throw new Error("Pi adapter is closed.");
    cwd = await realpath(cwd);
    const id = randomUUID(), timestamp = now();
    const directory = join(this.home, "sessions", "relayune");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${id}.jsonl`);
    await writeFile(path, [
      { type: "session", version: 3, id, timestamp, cwd, relayuneManaged: true },
      { type: "session_info", id: randomUUID(), parentId: null, timestamp, name },
    ].map(JSON.stringify).join("\n") + "\n", { flag: "wx", mode: 0o600 });
    const session = await readPiSession(path);
    this.sessions.set(`pi_${id}`, session);
    return this.toRelaySession(session);
  }

  async readHistory({ sessionId, ...pagination }) {
    const previous = await this.metadata(sessionId);
    const session = await readPiSession(previous.path);
    this.sessions.set(sessionId, session);
    return { ...paginatePiHistory(piHistoryMessages(session), pagination), agents: [], sessions: [this.toRelaySession(session)] };
  }

  forkCapabilities() { return { mode: "turn", worktree: true }; }

  async forkReplySource(options) {
    if (this.activeTurns.has(options.sessionId) || this.starting.has(options.sessionId) ||
        this.configuring.has(options.sessionId)) throw piForkError("session_fork_busy");
    let previous;
    try { previous = await this.metadata(options.sessionId); }
    catch { throw piForkError("session_not_found"); }
    let session;
    try { session = await readPiSession(previous.path); }
    catch { throw piForkError("session_fork_invalid_reply"); }
    if (this.sessionId(session) !== options.sessionId) throw piForkError("session_not_found");
    const reply = piForkReply(session, options);
    if (!reply) throw piForkError("session_fork_invalid_reply");
    return { session, reply };
  }

  async forkSource(options) {
    if (this.forking.has(options.sessionId)) throw piForkError("session_fork_busy");
    return this.toRelaySession((await this.forkReplySource(options)).session);
  }

  async forkSession(options) {
    if (this.forking.has(options.sessionId)) throw piForkError("session_fork_busy");
    this.forking.add(options.sessionId);
    try {
      const { session, reply } = await this.forkReplySource(options);
      const cwd = await realpath(options.cwd || session.header.cwd);
      const directory = await realpath(join(this.home, "sessions", "relayune")).catch(async error => {
        if (error.code !== "ENOENT") throw error;
        await mkdir(join(this.home, "sessions", "relayune"), { recursive: true, mode: 0o700 });
        return realpath(join(this.home, "sessions", "relayune"));
      });
      const result = await this.persistForkWithNativeBridge(session, reply, cwd, directory, options);
      let fork;
      try {
        if (!result.path || await realpath(dirname(result.path)) !== directory)
          throw new Error("Unexpected Pi fork path");
        fork = await readPiSession(result.path);
        if (!fork.header.relayuneManaged || fork.header.id !== result.id ||
            fork.header.id === session.header.id || fork.header.cwd !== cwd)
          throw new Error("Unexpected Pi fork identity");
      } catch { throw piForkError("session_fork_outcome_unknown"); }
      const id = this.sessionId(fork);
      this.sessions.set(id, fork);
      return this.toRelaySession(fork);
    } finally { this.forking.delete(options.sessionId); }
  }

  async persistForkWithNativeBridge(session, reply, cwd, directory, options) {
    // This short-lived instance only invokes the existing extension command.
    // It does not acquire the source writer, append user prompts, or replace
    // the live source connection (including externally owned Pi sessions).
    const child = this.spawnProcess(this.command, [...this.args, "--mode", "rpc", "--session", session.path,
      "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-approve", "-e", this.extensionPath],
    agentSpawnOptions(this.command, { cwd: session.header.cwd,
      env: { ...process.env, PI_CODING_AGENT_DIR: this.home }, stdio: ["pipe", "pipe", "pipe"] }));
    const requestId = randomUUID();
    let dispatched = false, timer, resolveAck, rejectAck;
    const ack = new Promise((resolve, reject) => { resolveAck = resolve; rejectAck = reject; });
    // The acknowledgement can arrive before prompt acceptance. Attach its
    // rejection handler immediately so a process exit cannot leak a promise.
    void ack.catch(() => {});
    const rpc = new PiRpcClient({
      write: line => new Promise((resolve, reject) => child.stdin.write(line, error => error ? reject(error) : resolve())),
      onEvent: event => {
        if (event.type !== "extension_ui_request" || event.method !== "notify") return;
        let value; try { value = JSON.parse(event.message); } catch { return; }
        if (value.bridge === "relayune-pi-fork-v1" && value.requestId === requestId) resolveAck(value);
      },
      onFailure: () => rejectAck(piForkError(dispatched ? "session_fork_outcome_unknown" : "session_fork_unsupported")),
    });
    child.stdout.on("data", chunk => rpc.receive(chunk));
    child.stderr.resume();
    child.stdin.on("error", () => rpc.end());
    child.once("error", () => rpc.end());
    child.once("close", () => { rpc.end(); rejectAck(piForkError(dispatched ? "session_fork_outcome_unknown" : "session_fork_unsupported")); });
    try {
      const commands = (await rpc.request("get_commands")).data?.commands ?? [];
      if (!commands.some(command => command.name === "relayune-fork")) throw piForkError("session_fork_unsupported");
      const state = (await rpc.request("get_state")).data;
      if (state?.sessionId !== session.header.id) throw piForkError("session_not_found");
      // Recheck after process startup; the visible source may have changed.
      const current = await readPiSession(session.path);
      if (current.header.id !== session.header.id || piForkReply(current, options)?.id !== reply.id)
        throw piForkError("session_fork_invalid_reply");
      timer = setTimeout(() => rejectAck(piForkError("session_fork_outcome_unknown")), 30_000);
      dispatched = true;
      const [_, result] = await Promise.all([rpc.request("prompt", { message: `/relayune-fork ${JSON.stringify({
        requestId, entryId: reply.id, sourceId: session.header.id, cwd, sessionDir: directory })}` }), ack]);
      if (result.code) {
        const known = ["session_fork_busy", "session_not_found", "session_fork_invalid_reply", "session_fork_outcome_unknown"];
        throw piForkError(known.includes(result.code) ? result.code : "session_fork_outcome_unknown");
      }
      return result;
    } catch (error) {
      if (typeof error.code === "string" && error.code.startsWith("session_")) throw error;
      throw piForkError(dispatched ? "session_fork_outcome_unknown" : "session_fork_unsupported");
    } finally {
      clearTimeout(timer); rpc.close(); child.kill();
    }
  }

  async readAgents() { return []; }
  async readUsage() { return {}; }
  async createAgents() { throw new Error("Pi subtask integration is not available yet."); }
  userMessageId({ sessionId, requestId }) {
    return requestId ? `pi_user_${createHash("sha256").update(JSON.stringify([sessionId, requestId])).digest("hex")}` : null;
  }

  sessionId(session) {
    return `pi_${session.header.relayuneManaged && session.header.relayuneSourceId || session.header.id}`;
  }

  async continueExternalSession(source) {
    // Read one validated, complete branch. Never append to the external file:
    // Pi's native CLI does not participate in Relayune's writer lock.
    source = await readPiSession(source.path);
    const lastMessage = [...source.branch].reverse().find(entry => entry.type === "message");
    if (lastMessage && (lastMessage.message?.role !== "assistant" ||
        !["stop", "length"].includes(lastMessage.message?.stopReason))) {
      throw new Error("Finish or stop this task in native Pi before continuing its history in Relayune.");
    }
    const directory = join(this.home, "sessions", "relayune");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const fingerprint = createHash("sha256").update(source.header.id).digest("hex");
    const path = join(directory, `continue-${fingerprint}.jsonl`);
    const timestamp = now();
    const records = [
      { ...source.header, id: randomUUID(), timestamp, relayuneManaged: true,
        relayuneSourceId: source.header.id },
      ...source.branch,
      { type: "session_info", id: randomUUID(), parentId: source.branch.at(-1)?.id ?? null,
        timestamp, name: `${source.title} (Relayune copy)` },
    ];
    await writeFile(path, records.map(JSON.stringify).join("\n") + "\n", { flag: "wx", mode: 0o600 })
      .catch(error => { if (error.code !== "EEXIST") throw error; });
    const session = await readPiSession(path);
    if (!session.header.relayuneManaged || session.header.relayuneSourceId !== source.header.id) {
      throw new Error("Pi continuation identity does not match its source.");
    }
    this.sessions.set(this.sessionId(session), session);
    return session;
  }

  toRelaySession(session) {
    const id = this.sessionId(session), active = this.activeTurns.get(id), connection = this.connections.get(id);
    return { id, name: session.title, cwd: session.header.cwd, project: basename(session.header.cwd), branch: "—",
      provider: "pi", status: active?.started ? "active" : "idle", can_interrupt: Boolean(active),
      running_started_at: active?.startedAt ?? null, updated_at: session.updatedAt,
      supports_steering: false,
      supports_interrupt_and_send: Boolean(session.header.relayuneManaged), model: connection?.state?.model?.id ?? session.model?.modelId ?? null,
      permission_mode: "default", session_config_options: this.configOptions(connection),
      sync_state: "persisted", sync_verified_at: now() };
  }

  configOptions(connection) {
    if (!connection?.models?.length) return [];
    const model = connection.state?.model;
    return [{ id: "model", type: "select", name: "Model", currentValue: model ? `${model.provider}/${model.id}` : "",
      options: connection.models.map(m => ({ value: `${m.provider}/${m.id}`, name: `${m.name ?? m.id} (${m.provider})` })) }];
  }

  async configureSession({ sessionId, configId, value }) {
    if (this.activeTurns.has(sessionId) || this.configuring.has(sessionId) || this.forking.has(sessionId)) throw new Error("Stop the Pi task before changing its model.");
    this.configuring.add(sessionId);
    try {
    const connection = await this.connection(sessionId);
    const model = connection.models.find(m => `${m.provider}/${m.id}` === value);
    if (configId !== "model" || !model) throw new Error("Pi configuration option is unavailable.");
    await connection.rpc.request("set_model", { provider: model.provider, modelId: model.id });
    connection.state = (await connection.rpc.request("get_state")).data;
    return { configOptions: this.configOptions(connection) };
    } finally { this.configuring.delete(sessionId); }
  }

  async connection(sessionId) {
    if (this.closed) throw new Error("Pi adapter is closed.");
    if (this.starting.has(sessionId)) return this.starting.get(sessionId);
    if (this.connections.has(sessionId)) return this.connections.get(sessionId);
    const pending = this.openConnection(sessionId);
    this.starting.set(sessionId, pending);
    try { return await pending; } finally { this.starting.delete(sessionId); }
  }

  async openConnection(sessionId) {
    let session = await this.metadata(sessionId);
    if (!session.header.relayuneManaged) session = await this.continueExternalSession(session);
    if (this.closed) throw new Error("Pi adapter is closed.");
    const lockPath = `${session.path}.relayune-lock`;
    const lock = await open(lockPath, "wx", 0o600).catch(error => {
      if (error.code === "EEXIST") throw new Error("This Pi session is owned by another Relay process. Close its owner before retrying.");
      throw error;
    });
    await lock.close();
    let child;
    try { child = this.spawnProcess(this.command, [...this.args, "--mode", "rpc", "--session", session.path,
      "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-approve", "-e", this.extensionPath],
    agentSpawnOptions(this.command, { cwd: session.header.cwd, env: { ...process.env, PI_CODING_AGENT_DIR: this.home },
      stdio: ["pipe", "pipe", "pipe"] }));
    } catch (error) { await unlink(lockPath); throw error; }
    const connection = { child, lockPath, chain: Promise.resolve(), state: null, models: [], ended: false, exited: false };
    connection.releaseLock = () => connection.lockRelease ??= unlink(lockPath).catch(error => {
      if (error.code !== "ENOENT") throw error;
    });
    const write = line => new Promise((resolve, reject) => child.stdin.write(line, error => error ? reject(error) : resolve()));
    connection.write = write;
    connection.rpc = new PiRpcClient({ write,
      onEvent: event => {
        connection.chain = connection.chain.then(() => this.handleEvent(sessionId, connection, event))
          .catch(() => this.failConnection(sessionId, connection));
      },
      onFailure: () => { void this.failConnection(sessionId, connection).catch(() => {}); },
    });
    this.connections.set(sessionId, connection);
    child.stdout.on("data", chunk => connection.rpc.receive(chunk));
    child.stderr.resume(); // Tool inputs and provider errors are not diagnostic logs.
    child.stdin.on("error", () => { void this.failConnection(sessionId, connection).catch(() => {}); });
    child.once("error", () => { void this.failConnection(sessionId, connection).catch(() => {}); });
    child.once("close", () => {
      connection.exited = true; connection.rpc.end();
      // Also clean a lock when SIGKILL completion arrives after the close deadline.
      if (connection.ended) void connection.releaseLock().catch(() => {});
      else void this.failConnection(sessionId, connection).catch(() => {});
    });
    try {
      const commands = (await connection.rpc.request("get_commands")).data?.commands ?? [];
      if (!["relayune-capabilities", "relayune-turn"].every(name => commands.some(c => c.name === name))) throw new Error("Pi approval bridge failed to load.");
      connection.state = (await connection.rpc.request("get_state")).data;
      if (connection.state?.sessionId !== session.header.id) throw new Error("Pi loaded another session.");
      connection.models = (await connection.rpc.request("get_available_models")).data?.models ?? [];
      if (this.closed || connection.ended) throw new Error("Pi adapter is closed.");
      return connection;
    } catch (error) { await this.failConnection(sessionId, connection); throw error; }
  }

  submitMessage(options) {
    if (options.interruptRunning) return stopBeforeSending(this, options, () => this.submitMessageUnlocked(options));
    return this.submitMessageUnlocked(options);
  }

  async submitMessageUnlocked({ sessionId, requestId, content, attachments = [] }) {
    if (this.closed) throw new Error("Pi adapter is closed.");
    if (typeof content !== "string" || content.trimStart().startsWith("/")) throw new Error("Pi slash commands are not supported through Relayune.");
    if (this.activeTurns.has(sessionId) || this.configuring.has(sessionId) || this.forking.has(sessionId)) throw new Error("Pi is already working in this session.");
    const turn = { id: `turn_pi_${randomUUID()}`, requestId, started: false, text: "", messageText: "", stopped: false, failed: false };
    this.activeTurns.set(sessionId, turn); // Reserve before any asynchronous startup.
    try {
      const connection = await this.connection(sessionId);
      if (turn.stopped) {
        await this.failConnection(sessionId, connection, "interrupted");
        throw new Error("Pi task was cancelled before execution.");
      }
      if (!connection.state?.model) throw new Error("Configure and authenticate a Pi model before sending a task.");
      if (attachments.length && !connection.state.model.input?.includes("image")) throw new Error("This Pi model does not support images.");
      if (attachments.some(a => !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(a.mime_type) || !a.base64)) {
        throw new Error("Pi image attachment is invalid.");
      }
      await connection.rpc.request("prompt", { message: `/relayune-turn ${JSON.stringify({ turnId: turn.id,
        userId: this.userMessageId({ sessionId, requestId }) ?? `pi_user_${randomUUID()}` })}` });
      if (turn.stopped) throw new Error("Pi task was cancelled before execution.");
      turn.dispatching = true;
      await connection.rpc.request("prompt", { message: content,
        ...(attachments.length ? { images: attachments.map(a => ({ type: "image", mimeType: a.mime_type, data: a.base64 })) } : {}) });
      // prompt acceptance deliberately never emits turn.started or completion.
      return { mode: "started", turnId: turn.id, persisted: true, syncVerifiedAt: now() };
    } catch (error) {
      const connection = this.connections.get(sessionId);
      if (connection) await this.failConnection(sessionId, connection, turn.stopped ? "interrupted" : "failed");
      else await this.finishTurn(sessionId, turn.stopped ? "interrupted" : "failed");
      if (turn.stopped) throw new Error("Pi task was cancelled before execution.");
      throw error;
    }
  }

  async handleEvent(sessionId, connection, event) {
    if (connection.ended || this.connections.get(sessionId) !== connection) return;
    const turn = this.activeTurns.get(sessionId);
    if (event.type === "extension_ui_request") return this.requestUi(sessionId, connection, event);
    if (!turn) return;
    if (event.type === "agent_start" && !turn.started) {
      turn.started = true; turn.startedAt = now();
      await this.emit(sessionId, { kind: "turn.started", turn_id: turn.id, request_id: turn.requestId });
    } else if (event.type === "message_update" && ["thinking_start", "thinking_delta", "thinking_end"].includes(event.assistantMessageEvent?.type)) {
      await this.emit(sessionId, { kind: "turn.thinking", turn_id: turn.id,
        active: event.assistantMessageEvent.type !== "thinking_end" });
    } else if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      const text = event.assistantMessageEvent.delta;
      turn.text += text; turn.messageText += text;
      await this.emit(sessionId, { kind: "message.delta", turn_id: turn.id, text });
    } else if (event.type === "message_end" && event.message?.role === "assistant") {
      const finalText = piText(event.message.content);
      if (!turn.messageText && finalText) {
        turn.text += finalText;
        await this.emit(sessionId, { kind: "message.delta", turn_id: turn.id, text: finalText });
      }
      turn.messageText = "";
      if (event.message.stopReason === "error") turn.failed = true;
      if (event.message.stopReason === "aborted") turn.stopped = true;
    } else if (event.type === "tool_execution_start") {
      await this.emit(sessionId, { kind: "command.started", turn_id: turn.id, item_id: event.toolCallId,
        command: `${event.toolName} ${JSON.stringify(event.args ?? {})}`, status: "in_progress" });
    } else if (event.type === "tool_execution_end") {
      await this.emit(sessionId, { kind: "command.completed", turn_id: turn.id, item_id: event.toolCallId,
        output: piText(event.result?.content), status: event.isError ? "failed" : "completed" });
    } else if (event.type === "agent_settled") {
      await this.finishTurn(sessionId, turn.stopped ? "interrupted" : turn.failed ? "failed" : "completed");
    }
  }

  async requestUi(sessionId, connection, event) {
    if (!["confirm", "select", "input", "editor"].includes(event.method)) return;
    const turn = this.activeTurns.get(sessionId);
    if (!turn || typeof event.id !== "string") return this.replyUi(connection, event.id, { cancelled: true });
    const session = await this.metadata(sessionId);
    let action;
    if (event.method === "confirm") {
      let details;
      try { details = JSON.parse(event.message); } catch { /* Fail closed below. */ }
      if (details?.bridge !== "relayune-pi-v1" || !details.tool || JSON.stringify(details).length > 12000) {
        return this.replyUi(connection, event.id, { confirmed: false });
      }
      action = { type: ["write", "edit"].includes(details.tool) ? "file.change" : "command.execute", display: `${details.tool}\n${JSON.stringify(details.input, null, 2)}`,
        cwd: session.header.cwd, tool_call_id: details.toolCallId };
    } else if (event.method === "select") {
      if (!Array.isArray(event.options) || !event.options.length || event.options.some(v => typeof v !== "string")) {
        return this.replyUi(connection, event.id, { cancelled: true });
      }
      action = { type: "question.select", display: event.title, cwd: session.header.cwd,
        options: event.options.map((name, i) => ({ option_id: String(i), name, kind: "allow_once" })) };
    } else {
      action = { type: "question.select", display: event.title, cwd: session.header.cwd,
        options: [], allows_freeform: true };
    }
    const approvalId = `apr_pi_${randomUUID()}`;
    const timeoutMs = Math.max(1, Math.min(Number(event.timeout) || 300000, 300000));
    const pending = { connection, sessionId, turnId: turn.id, event, action, expires: Date.now() + timeoutMs };
    pending.timer = setTimeout(() => { void this.expireApproval(approvalId).catch(() => this.failConnection(sessionId, connection)); }, timeoutMs);
    pending.timer.unref?.();
    this.pendingApprovals.set(approvalId, pending);
    await this.handlers.requestApproval({ approval_id: approvalId, request_id: event.id, session_id: sessionId,
      root_session_id: sessionId, source_thread_id: sessionId, source_agent_id: null, source_agent_name: "Pi",
      turn_id: turn.id, provider: "pi", action: { ...action, command_hash: hashAction(action) },
      risk_level: event.method === "confirm" ? "high" : "medium", requested_at: now(), expires_at: new Date(pending.expires).toISOString() });
  }

  replyUi(connection, id, response) {
    return connection.write(`${JSON.stringify({ type: "extension_ui_response", id, ...response })}\n`);
  }

  async resolveApproval({ approvalId, decision, optionId, answer }) {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending || pending.expires <= Date.now() || pending.connection.ended ||
      this.activeTurns.get(pending.sessionId)?.id !== pending.turnId) throw new Error("Pi approval is no longer pending.");
    if (!["approved", "rejected"].includes(decision)) throw new Error("Invalid Pi approval decision.");
    let response = { cancelled: true };
    if (pending.event.method === "confirm") response = { confirmed: decision === "approved" };
    else if (decision === "approved" && pending.event.method === "select") {
      const selected = pending.action.options.find(o => o.option_id === optionId);
      if (!selected) throw new Error("Invalid Pi question option.");
      response = { value: selected.name };
    } else if (decision === "approved") {
      if (typeof answer !== "string" || !answer.trim() || answer.length > 4000) throw new Error("Invalid Pi answer.");
      response = { value: answer };
    }
    clearTimeout(pending.timer); this.pendingApprovals.delete(approvalId);
    await this.replyUi(pending.connection, pending.event.id, response);
  }

  async expireApproval(approvalId) {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) return;
    clearTimeout(pending.timer); this.pendingApprovals.delete(approvalId);
    try { if (!pending.connection.ended) await this.replyUi(pending.connection, pending.event.id, { cancelled: true }); }
    finally { await this.emit(pending.sessionId, { kind: "approval.resolved", approval_id: approvalId, decision: "expired" }); }
  }

  interruptTurn(options) {
    return serializeSessionControl(this, options.sessionId, () => this.interruptTurnUnlocked(options));
  }

  async interruptTurnUnlocked({ sessionId }) {
    const turn = this.activeTurns.get(sessionId);
    if (!turn) throw new Error("No active Pi task to stop.");
    turn.stopped = true;
    const connection = this.connections.get(sessionId) ?? await this.starting.get(sessionId);
    if (!connection || connection.ended || this.activeTurns.get(sessionId) !== turn) return;
    if (!turn.dispatching) { await this.failConnection(sessionId, connection, "interrupted"); return; }
    // Cancel dialogs first: abort must not wait on an unanswered confirmation.
    for (const [id, pending] of this.pendingApprovals) if (pending.sessionId === sessionId) await this.expireApproval(id);
    try {
      await connection.rpc.request("clear_queue");
      await connection.rpc.request("abort");
      // A stopped process cannot deliver late events into a subsequent turn.
      await this.failConnection(sessionId, connection, "interrupted");
    } catch (error) { await this.failConnection(sessionId, connection); throw error; }
  }

  async finishTurn(sessionId, status, expected = this.activeTurns.get(sessionId)) {
    const turn = this.activeTurns.get(sessionId);
    if (!turn || turn !== expected) return;
    this.activeTurns.delete(sessionId);
    for (const [id, pending] of this.pendingApprovals) if (pending.sessionId === sessionId) await this.expireApproval(id);
    if (turn.text) await this.emit(sessionId, { kind: "message.completed", turn_id: turn.id, text: turn.text });
    await this.emit(sessionId, { kind: status === "failed" ? "turn.failed" : "turn.completed", turn_id: turn.id,
      ...(status === "failed" ? { error: "Pi could not complete this task. Check the local model and authentication." } : { status }) });
  }

  emit(sessionId, event) { return this.handlers.emitEvent(sessionId, { ...event, provider: "pi" }); }

  async failConnection(sessionId, connection, status = "failed") {
    if (connection.ended) return;
    const expected = this.activeTurns.get(sessionId);
    connection.ended = true;
    connection.rpc.close();
    if (!connection.exited) await new Promise(resolve => {
      const timer = setTimeout(() => { connection.child.kill("SIGKILL"); resolve(); }, 2000);
      connection.child.once("close", () => { clearTimeout(timer); resolve(); });
      connection.child.kill("SIGTERM");
    });
    // Never release an ownership lock while the child may still be executing.
    if (connection.exited) await connection.releaseLock();
    if (this.connections.get(sessionId) !== connection) return;
    this.connections.delete(sessionId);
    await this.finishTurn(sessionId, status, expected);
  }

  async close() {
    this.closed = true;
    await Promise.allSettled([...this.connections].map(([id, connection]) => this.failConnection(id, connection)));
    await Promise.allSettled([...this.starting.values()]);
  }
}
