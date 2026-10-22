import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  ClaudeCodeAdapter,
} from "./claude-adapter.mjs";

const execFileAsync = promisify(execFile);
const COWORK_SESSION_PATTERN = /^local_[0-9a-f-]{36}$/i;
const CLAUDE_SESSION_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOST_CREDS_PATTERN = /^host-creds(?:-[\w-]+)?\.json$/;
const MAX_HOST_CREDS_BYTES = 128 * 1024;
const HOST_CREDS_EXPIRY_MARGIN_MS = 5_000;
const PROCESS_START_TOLERANCE_MS = 3_000;
const COWORK_PERMISSION_MODES = [
  {
    value: "manual",
    name: "Manual approvals",
    description: "Ask before tools that require permission.",
  },
  {
    value: "acceptEdits",
    name: "Accept edits",
    description: "Approve file edits automatically; other protected tools can still ask.",
  },
  {
    value: "plan",
    name: "Plan",
    description: "Keep the resumed session read-only while Claude prepares a plan.",
  },
  {
    value: "auto",
    name: "Auto",
    description: "Let Cowork decide routine permissions automatically.",
  },
  {
    value: "dontAsk",
    name: "Do not ask",
    description: "Deny tools that are not already allowed instead of prompting.",
  },
  {
    value: "bypassPermissions",
    name: "Bypass permissions",
    description: "Run tools without permission prompts. Use only in a trusted workspace.",
  },
];

export class ClaudeCoworkAdapter extends ClaudeCodeAdapter {
  constructor(options = {}) {
    const coworkRoots = options.coworkRoots ?? defaultCoworkRoots();
    super({
      ...options,
      provider: "claude-cowork",
      providerLabel: "Claude Cowork",
      approvalPrefix: "apr_claude_cowork_",
      turnPrefix: "turn_claude_cowork",
      sourceAgentName: "Claude Cowork 主会话",
      claudeBin:
        options.claudeBin ??
        resolveCoworkClaudeBinary(coworkRoots) ??
        "relayune-claude-cowork-not-installed",
      catalogReader:
        options.catalogReader ??
        (({ limit, cwd, offset }) => readCoworkSessionCatalog({ coworkRoots, limit, cwd, offset })),
    });
    this.coworkRoots = coworkRoots;
    this.projectReader =
      options.projectReader ??
      (() => readCoworkProjects({ coworkRoots: this.coworkRoots }));
    this.hostCredentialsReader =
      options.hostCredentialsReader ?? readCoworkHostCredentials;
    this.sessionProcessInspector =
      options.sessionProcessInspector ?? coworkSessionProcessIsRunning;
    this.processEnvironment = options.processEnvironment ?? process.env;
    this.runtimeOverrides = new Map();
  }

  async listProjects() {
    return this.projectReader();
  }

  async createSession() {
    throw new Error(
      "Claude Cowork sessions must be created in Claude Desktop before Relayune can take them over.",
    );
  }

  async readUsage() {
    // Cowork transcripts live outside the regular Claude usage catalog and are
    // not yet aggregated here. Absence is more accurate than reporting zero.
    return {};
  }

  async readHistory(options) {
    const history = await super.readHistory(options);
    return {
      ...history,
      messages: (history.messages ?? []).map((message) => ({
        ...message,
        provider: "claude-cowork",
      })),
      agents: (history.agents ?? []).map((agent) => ({
        ...agent,
        provider: "claude-cowork",
      })),
    };
  }

  async configureSession({ sessionId, configId, value }) {
    if (this.activeTurns.has(sessionId) || this.startingSessions.has(sessionId)) {
      throw new Error(
        "Claude Cowork settings cannot change while the session is running.",
      );
    }
    const metadata = await this.ensureSessionMetadata(sessionId);
    if (this.activeTurns.has(sessionId) || this.startingSessions.has(sessionId)) {
      throw new Error(
        "Claude Cowork settings cannot change while the session is running.",
      );
    }
    const current = this.runtimeOverrides.get(sessionId) ?? {};
    if (configId === "model") {
      if (
        typeof value !== "string" ||
        !(metadata.availableModels ?? []).includes(value)
      ) {
        throw new Error("Claude Cowork model was not observed in this local account.");
      }
      this.runtimeOverrides.set(sessionId, { ...current, model: value });
    } else if (configId === "mode") {
      if (!COWORK_PERMISSION_MODES.some((mode) => mode.value === value)) {
        throw new Error("Claude Cowork permission mode is invalid.");
      }
      this.runtimeOverrides.set(sessionId, {
        ...current,
        permissionMode: value,
      });
    } else {
      throw new Error(`Claude Cowork setting ${configId} is not supported.`);
    }
    this.rememberSession({
      sessionId,
      model:
        this.runtimeOverrides.get(sessionId)?.model ?? metadata.model ?? null,
      permissionMode:
        this.runtimeOverrides.get(sessionId)?.permissionMode ??
        metadata.permissionMode ??
        "manual",
    });
    return {
      configOptions: this.configOptionsForSession(
        this.sessionMetadata.get(sessionId),
      ),
    };
  }

  async turnRuntime(metadata) {
    if (!metadata.cliSessionId || !CLAUDE_SESSION_PATTERN.test(metadata.cliSessionId)) {
      throw new Error("Claude Cowork CLI session mapping is invalid.");
    }
    const processState = await this.sessionProcessInspector({
      processName: metadata.processName,
      cliSessionId: metadata.cliSessionId,
    });
    if (processState === "running") {
      throw new Error(
        "This Claude Cowork session is still running in Claude Desktop. Stop it there before Relayune takes over.",
      );
    }
    if (processState !== "idle") {
      throw new Error(
        "Relayune could not verify that this Claude Cowork session is idle, so it was not resumed.",
      );
    }
    const credentials = await this.hostCredentialsReader({
      userDataRoot: metadata.userDataRoot,
    });
    const override = this.runtimeOverrides.get(metadata.sessionId) ?? {};
    const model = override.model ?? metadata.model;
    const permissionMode =
      override.permissionMode ?? metadata.permissionMode ?? "manual";
    const extraArgs = [];
    if (model) extraArgs.push("--model", model);
    if (permissionMode) {
      extraArgs.push("--permission-mode", permissionMode);
    }
    for (const folder of metadata.userSelectedFolders ?? []) {
      if (folder !== metadata.cwd) extraArgs.push("--add-dir", folder);
    }
    const inheritedEnvironment = { ...this.processEnvironment };
    for (const key of [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_BASE_URL",
      "CLAUDE_CODE_HOST_AUTH_ENV_VAR",
    ]) {
      delete inheritedEnvironment[key];
    }
    return {
      resumeSessionId: metadata.cliSessionId,
      cwd: metadata.cwd,
      env: {
        ...inheritedEnvironment,
        ...credentials.env,
        CLAUDE_CONFIG_DIR: metadata.claudeHome,
      },
      extraArgs,
    };
  }

  toRelaySession(metadata) {
    const session = super.toRelaySession(metadata);
    const override = this.runtimeOverrides.get(metadata.sessionId) ?? {};
    return {
      ...session,
      provider: "claude-cowork",
      model: override.model ?? metadata.model ?? null,
      permission_mode:
        override.permissionMode ?? metadata.permissionMode ?? "manual",
      session_config_options: this.configOptionsForSession(metadata),
    };
  }

  configOptionsForSession(metadata) {
    const override = this.runtimeOverrides.get(metadata.sessionId) ?? {};
    const currentModel = override.model ?? metadata.model ?? "";
    const models = [...new Set([
      ...(metadata.availableModels ?? []),
      ...(currentModel ? [currentModel] : []),
    ])];
    const options = [];
    if (models.length) {
      options.push({
        type: "select",
        id: "model",
        name: "Model",
        category: "model",
        description: "Models observed in local Cowork sessions; applied in memory on the next resume.",
        currentValue: currentModel,
        options: models.map((model) => ({
          value: model,
          name: coworkModelName(model),
        })),
      });
    }
    const currentMode =
      override.permissionMode ?? metadata.permissionMode ?? "manual";
    options.push({
      type: "select",
      id: "mode",
      name: "Permission mode",
      category: "mode",
      description: "Controls tool approval behavior for the next resumed turn.",
      currentValue: currentMode,
      options: COWORK_PERMISSION_MODES.map((mode) => ({ ...mode })),
    });
    return options;
  }
}

export async function readCoworkSessionCatalog({
  coworkRoots = defaultCoworkRoots(),
  limit = 200,
  cwd = null,
  offset = 0,
} = {}) {
  const accounts = await findCoworkAccountDirectories(coworkRoots);
  const sessions = [];
  for (const accountDirectory of accounts) {
    const spaces = await readSpaces(accountDirectory);
    const entries = await safeReaddir(accountDirectory);
    const accountSessions = [];
    for (const entry of entries) {
      if (
        !entry.isFile() ||
        !entry.name.endsWith(".json") ||
        !COWORK_SESSION_PATTERN.test(entry.name.slice(0, -5))
      ) continue;
      try {
        const metadataPath = join(accountDirectory, entry.name);
        const raw = JSON.parse(await readFile(metadataPath, "utf8"));
        const metadata = await normalizeCoworkSession({
          raw,
          metadataPath,
          accountDirectory,
          spaces,
        });
        if (metadata) accountSessions.push(metadata);
      } catch {
        // One partially written or future Cowork record must not hide peers.
      }
    }
    const availableModels = [...new Set(
      accountSessions.map((session) => session.model).filter(Boolean),
    )].sort();
    sessions.push(
      ...accountSessions.map((session) => ({ ...session, availableModels })),
    );
  }
  return sessions
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .filter(session => !cwd || session.cwd === cwd)
    .slice(offset, offset + Math.max(1, Number(limit) || 200));
}

export async function readCoworkProjects({
  coworkRoots = defaultCoworkRoots(),
} = {}) {
  const accounts = await findCoworkAccountDirectories(coworkRoots);
  const projects = new Map();
  for (const accountDirectory of accounts) {
    const spaces = await readSpaces(accountDirectory);
    for (const space of spaces.values()) {
      const cwd = firstFolder(space.folders);
      if (!cwd || !space.id) continue;
      const updatedAt = normalizeTimestamp(space.updatedAt ?? space.createdAt);
      projects.set(`${accountDirectory}\0${space.id}`, {
        id: `cowork_${space.id}`,
        name: stringValue(space.name) || basename(cwd),
        cwd,
        updated_at: updatedAt,
      });
    }
  }
  return [...projects.values()].sort(
    (left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at),
  );
}

export async function readCoworkHostCredentials({
  userDataRoot,
  now = Date.now(),
  processInspector = inspectHostProcess,
} = {}) {
  if (!userDataRoot) {
    throw new Error("Claude Cowork user data directory is unavailable.");
  }
  const entries = await safeReaddir(userDataRoot);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !HOST_CREDS_PATTERN.test(entry.name)) continue;
    const path = join(userDataRoot, entry.name);
    try {
      const info = await lstat(path);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size <= 0 ||
        info.size > MAX_HOST_CREDS_BYTES ||
        (info.mode & 0o777) !== 0o600 ||
        (typeof process.getuid === "function" && info.uid !== process.getuid())
      ) {
        continue;
      }
      candidates.push({ path, mtimeMs: info.mtimeMs });
    } catch {}
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const candidate of candidates) {
    try {
      const record = JSON.parse(await readFile(candidate.path, "utf8"));
      if (
        !Number.isFinite(record.expiresAt) ||
        record.expiresAt <= now + HOST_CREDS_EXPIRY_MARGIN_MS ||
        !Number.isSafeInteger(record.pid) ||
        record.pid <= 1 ||
        !Number.isFinite(record.procStart) ||
        !(await processInspector({ pid: record.pid, procStart: record.procStart }))
      ) {
        continue;
      }
      const env = normalizeCoworkCredentialEnvironment(record.env);
      if (!env) continue;
      return { env, expiresAt: record.expiresAt };
    } catch {
      // Never include credential contents in diagnostics or error messages.
    }
  }
  throw new Error(
    "Claude Cowork authorization is unavailable or expired. Keep Claude Desktop open and signed in, then retry.",
  );
}

export function defaultCoworkRoots() {
  const appSupport = join(homedir(), "Library", "Application Support");
  const roots = [];
  let entries = [];
  try {
    entries = readdirSync(appSupport, { withFileTypes: true });
  } catch {}
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^Claude(?:[- ]|$)/i.test(entry.name)) continue;
    const root = join(appSupport, entry.name, "local-agent-mode-sessions");
    if (existsSync(root)) roots.push(root);
  }
  return [...new Set(roots)];
}

export function resolveCoworkClaudeBinary(coworkRoots = defaultCoworkRoots()) {
  const userDataRoots = coworkRoots.map((root) => join(root, ".."));
  const candidates = [];
  for (const userDataRoot of userDataRoots) {
    const versionsRoot = join(userDataRoot, "claude-code");
    let versions = [];
    try {
      versions = readdirSync(versionsRoot, { withFileTypes: true });
    } catch {}
    for (const version of versions) {
      if (!version.isDirectory()) continue;
      const binary =
        process.platform === "darwin"
          ? join(versionsRoot, version.name, "claude.app", "Contents", "MacOS", "claude")
          : join(versionsRoot, version.name, process.platform === "win32" ? "claude.exe" : "claude");
      try {
        const info = statSync(binary);
        if (info.isFile()) candidates.push({ binary, mtimeMs: info.mtimeMs });
      } catch {}
    }
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.binary;
}

async function normalizeCoworkSession({
  raw,
  metadataPath,
  accountDirectory,
  spaces,
}) {
  const sessionId = stringValue(raw.sessionId);
  const cliSessionId = stringValue(raw.cliSessionId);
  if (
    !COWORK_SESSION_PATTERN.test(sessionId) ||
    !CLAUDE_SESSION_PATTERN.test(cliSessionId) ||
    raw.isArchived === true
  ) {
    return null;
  }
  const sessionDirectory = join(accountDirectory, sessionId);
  const claudeHome = join(sessionDirectory, ".claude");
  const transcriptPath = await findCoworkTranscript(claudeHome, cliSessionId);
  if (!transcriptPath) return null;
  const selectedFolders = normalizedFolders(raw.userSelectedFolders);
  const space = spaces.get(stringValue(raw.spaceId));
  const cwd = selectedFolders[0] || firstFolder(space?.folders);
  if (!cwd) return null;
  const transcriptInfo = await stat(transcriptPath);
  return {
    sessionId,
    cliSessionId,
    cwd,
    title: stringValue(raw.title) || titleFromInitialMessage(raw.initialMessage),
    updatedAt: normalizeTimestamp(
      raw.lastActivityAt ?? raw.updatedAt ?? transcriptInfo.mtimeMs,
    ),
    transcriptPath,
    metadataPath,
    persisted: true,
    model: stringValue(raw.model) || null,
    permissionMode: stringValue(raw.permissionMode) || "manual",
    usageDaily: [],
    spaceId: stringValue(raw.spaceId) || null,
    spaceName: stringValue(space?.name) || basename(cwd),
    userSelectedFolders: selectedFolders.length ? selectedFolders : [cwd],
    processName: safeProcessName(raw.processName),
    claudeHome,
    userDataRoot: coworkUserDataRoot(accountDirectory),
  };
}

function coworkUserDataRoot(accountDirectory) {
  let current = accountDirectory;
  while (dirname(current) !== current) {
    if (basename(current) === "local-agent-mode-sessions") {
      return dirname(current);
    }
    current = dirname(current);
  }
  return dirname(accountDirectory);
}

async function findCoworkTranscript(claudeHome, cliSessionId) {
  const projectsRoot = join(claudeHome, "projects");
  const projects = await safeReaddir(projectsRoot);
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const candidate = join(projectsRoot, project.name, `${cliSessionId}.jsonl`);
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {}
  }
  return null;
}

async function findCoworkAccountDirectories(coworkRoots) {
  const found = new Set();
  for (const root of coworkRoots ?? []) {
    if (await hasSpacesFile(root)) found.add(root);
    const first = await safeReaddir(root);
    for (const account of first) {
      if (!account.isDirectory() || account.name === "skills-plugin") continue;
      const accountPath = join(root, account.name);
      if (await hasSpacesFile(accountPath)) found.add(accountPath);
      const second = await safeReaddir(accountPath);
      for (const organization of second) {
        if (!organization.isDirectory()) continue;
        const organizationPath = join(accountPath, organization.name);
        if (await hasSpacesFile(organizationPath)) found.add(organizationPath);
      }
    }
  }
  return [...found];
}

async function hasSpacesFile(directory) {
  try {
    return (await stat(join(directory, "spaces.json"))).isFile();
  } catch {
    return false;
  }
}

async function readSpaces(accountDirectory) {
  try {
    const record = JSON.parse(
      await readFile(join(accountDirectory, "spaces.json"), "utf8"),
    );
    return new Map(
      (Array.isArray(record.spaces) ? record.spaces : [])
        .filter((space) => stringValue(space?.id))
        .map((space) => [space.id, space]),
    );
  } catch {
    return new Map();
  }
}

async function safeReaddir(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function normalizeCoworkCredentialEnvironment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const authVariable = stringValue(value.CLAUDE_CODE_HOST_AUTH_ENV_VAR);
  if (!["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"].includes(authVariable)) {
    return null;
  }
  const allowed = new Set([
    authVariable,
    "CLAUDE_CODE_HOST_AUTH_ENV_VAR",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
  ]);
  const env = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!allowed.has(key) || typeof raw !== "string" || raw.length > 64 * 1024) {
      return null;
    }
    env[key] = raw;
  }
  if (!env[authVariable]) return null;
  if (
    env.ANTHROPIC_BASE_URL &&
    !/^https:\/\/[^\s]+$/i.test(env.ANTHROPIC_BASE_URL)
  ) {
    return null;
  }
  return env;
}

async function inspectHostProcess({ pid, procStart }) {
  try {
    process.kill(pid, 0);
    if (process.platform !== "darwin") return true;
    const { stdout } = await execFileAsync("/bin/ps", [
      "-o",
      "lstart=",
      "-p",
      String(pid),
    ]);
    const startedAt = Date.parse(stdout.trim());
    return (
      Number.isFinite(startedAt) &&
      Math.abs(startedAt - procStart) <= PROCESS_START_TOLERANCE_MS
    );
  } catch {
    return false;
  }
}

async function coworkSessionProcessIsRunning({ processName, cliSessionId }) {
  const identities = [
    safeProcessName(processName),
    CLAUDE_SESSION_PATTERN.test(cliSessionId) ? cliSessionId : null,
  ].filter(Boolean);
  if (!identities.length) return "unknown";
  for (const identity of identities) {
    try {
      await execFileAsync("/usr/bin/pgrep", ["-f", escapeRegex(identity)]);
      return "running";
    } catch (error) {
      if (error?.code !== 1) return "unknown";
    }
  }
  return "idle";
}

function firstFolder(folders) {
  if (!Array.isArray(folders)) return "";
  for (const folder of folders) {
    const path = stringValue(typeof folder === "string" ? folder : folder?.path);
    if (path) return path;
  }
  return "";
}

function normalizedFolders(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(stringValue).filter(Boolean))].slice(0, 32);
}

function safeProcessName(value) {
  const name = stringValue(value);
  return /^[a-zA-Z0-9._-]{1,128}$/.test(name) ? name : null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function titleFromInitialMessage(value) {
  const text =
    typeof value === "string"
      ? value
      : typeof value?.content === "string"
        ? value.content
        : "";
  const first = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return (first || "Claude Cowork 会话").slice(0, 80);
}

function coworkModelName(model) {
  return model
    .replace(/^anthropic\//, "")
    .split("-")
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part)
    .join(" ");
}

function normalizeTimestamp(value) {
  const date =
    typeof value === "number" ? new Date(value) : new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
