import { FileBlobStore } from "./relay-blob-store";
import { AccountDeletionGate } from "./account-deletion";
import { MongoBudget, budgetMongoDatabase } from "./mongo-budget";
import { attachCipherStreamServer } from "./cipher-stream";
import { startRelayRetention } from "./relay-retention";
import { ResponseWaitHub } from "./response-wait";
import { CommandWaitHub } from "./command-wait";
import { createMonitoringDirectory } from './monitoring-users';
import { createMonitoring, createSlsQuery } from './monitoring';
import { createClientObserver } from "./client-observations";
import { loadLogIdentity, recordResponseError, runRequestLog } from "./request-log.mjs";
import { createNetworkUsage } from "./network-usage.mjs";
import { compressRelayResponse } from "./response-compression.mjs";
import { createIosPushService } from "./ios-push.mjs";
import { AndroidPush, readPushConfig } from "./android-push";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { webcrypto } from "node:crypto";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { MongoClient, ServerApiVersion } from "mongodb";
import {
  authorizeRealtimeBrowser,
  authorizeCipherRelay,
  authorizeCipherBrowser,
  handleRelayApi,
  ONLINE_WINDOW_MS,
} from "./relay-api";
import { MAX_FEEDBACK_REQUEST_BYTES } from "../shared/feedback.mjs";
import { FeedbackApi } from "./feedback-api";
import { EmailAuth } from "./email-auth";
import { readSetupToken } from "./local-accounts";
import { initializeRelayMongo, MongoStore } from "./mongo-store";
import { PairingApi } from "./pairing-api";
import { attachRealtimeServer } from "./realtime";
import { ReleaseNotesApi } from "./release-notes.mjs";

const MAX_REQUEST_BYTES = 50 * 1024 * 1024;
const SAFE_RELAY_PROTOCOL_ERRORS = new Set([
  "aad_route_mismatch",
  "array_too_large",
  "browser_key_mismatch",
  "event_seq_conflict",
  "invalid_aad",
  "invalid_ack_status",
  "invalid_array",
  "invalid_envelope",
  "invalid_identifier",
  "invalid_integer",
  "invalid_object",
  "invalid_time",
  "invalid_type",
  "messages_required",
  "unsupported_envelope",
  "unsupported_push_kind",
]);
class NodeHeaders {
  private readonly values = new Map<string, { name: string; value: string }>();

  constructor(init: HeadersInit = {}) {
    if (init instanceof NodeHeaders) {
      init.forEach((value, name) => this.set(name, value));
      return;
    }
    if (typeof init === "object" && init !== null && Symbol.iterator in init) {
      for (const [name, value] of init as Iterable<[string, string]>) {
        this.append(name, value);
      }
      return;
    }
    for (const [name, value] of Object.entries(init)) {
      this.set(name, String(value));
    }
  }

  append(name: string, value: string) {
    const key = name.toLowerCase();
    const existing = this.values.get(key);
    this.values.set(key, {
      name: existing?.name || name,
      value: existing ? `${existing.value}, ${value}` : value,
    });
  }

  set(name: string, value: string) {
    this.values.set(name.toLowerCase(), { name, value: String(value) });
  }

  get(name: string) {
    return this.values.get(name.toLowerCase())?.value ?? null;
  }

  has(name: string) {
    return this.values.has(name.toLowerCase());
  }

  forEach(callback: (value: string, key: string, parent: NodeHeaders) => void) {
    for (const [key, entry] of this.values) {
      callback(entry.value, key, this);
    }
  }
}

class NodeRequest {
  readonly signal?: AbortSignal;
  readonly method: string;
  readonly headers: NodeHeaders;
  private readonly content: Buffer;

  constructor(
    readonly url: string,
    init: { method?: string; headers?: HeadersInit; body?: Buffer; signal?: AbortSignal } = {},
  ) {
    this.signal = init.signal;
    this.method = (init.method || "GET").toUpperCase();
    this.headers = new NodeHeaders(init.headers);
    this.content = init.body || Buffer.alloc(0);
  }

  async arrayBuffer() {
    return this.content.buffer.slice(
      this.content.byteOffset,
      this.content.byteOffset + this.content.byteLength,
    ) as ArrayBuffer;
  }

  async text() {
    return this.content.toString("utf8");
  }
}

class NodeResponse {
  readonly status: number;
  readonly headers: NodeHeaders;
  private readonly content: Buffer;

  constructor(
    body: string | Buffer | Uint8Array | null = null,
    init: { status?: number; headers?: HeadersInit } = {},
  ) {
    this.status = init.status ?? 200;
    this.headers = new NodeHeaders(init.headers);
    this.content =
      body == null
        ? Buffer.alloc(0)
        : Buffer.isBuffer(body)
          ? body
          : Buffer.from(body);
  }

  static json(
    body: unknown,
    init: { status?: number; headers?: HeadersInit } = {},
  ) {
    const headers = new NodeHeaders(init.headers);
    if (!headers.has("content-type")) {
      headers.set("Content-Type", "application/json; charset=utf-8");
    }
    return new NodeResponse(JSON.stringify(body), {
      ...init,
      headers: headers as unknown as Headers,
    });
  }

  async arrayBuffer() {
    return this.content.buffer.slice(
      this.content.byteOffset,
      this.content.byteOffset + this.content.byteLength,
    ) as ArrayBuffer;
  }

  async text() {
    return this.content.toString("utf8");
  }
}

if (!("crypto" in globalThis)) {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
}
if (!("Headers" in globalThis)) {
  Object.defineProperty(globalThis, "Headers", {
    configurable: true,
    value: NodeHeaders,
  });
}
if (!("Request" in globalThis)) {
  Object.defineProperty(globalThis, "Request", {
    configurable: true,
    value: NodeRequest,
  });
}
if (!("Response" in globalThis)) {
  Object.defineProperty(globalThis, "Response", {
    configurable: true,
    value: NodeResponse,
  });
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function secret(name: string, filenameName: string): string {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const filename = process.env[filenameName]?.trim();
  if (!filename) throw new Error(`${name} or ${filenameName} is required`);
  return readFileSync(filename, "utf8").trim();
}

function optionalSecret(name: string, filenameName: string): string | null {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const filename = process.env[filenameName]?.trim();
  return filename ? readFileSync(filename, "utf8").trim() : null;
}

const host = process.env.HOST?.trim() || "127.0.0.1";
if (host !== "127.0.0.1") throw new Error("HOST must remain 127.0.0.1 behind the HTTPS gateway.");
const port = Number(process.env.PORT || "3192");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT is invalid.");
const configuredOrigin = new URL(required("PUBLIC_ORIGIN"));
if (configuredOrigin.protocol !== "https:" || configuredOrigin.username || configuredOrigin.password ||
  configuredOrigin.pathname !== "/" || configuredOrigin.search || configuredOrigin.hash) throw new Error("PUBLIC_ORIGIN must be a bare HTTPS origin.");
const publicOrigin = configuredOrigin.origin;
const blobRoot = path.resolve(
  process.env.RELAY_BLOB_DIR || "/var/lib/agent-relay/blobs",
);
const mongoHost = process.env.MONGO_HOST?.trim() || "127.0.0.1";
const mongoPort = Number(process.env.MONGO_PORT || "27017");
const mongoDatabase = required("MONGO_DATABASE");
const mongoUsername = required("MONGO_USER");
const mongoPassword = secret("MONGO_PASSWORD", "MONGO_PASSWORD_FILE");
const authMode = process.env.RELAY_AUTH_MODE?.trim() || "email";
if (authMode !== "email" && authMode !== "username") throw new Error("RELAY_AUTH_MODE must be email or username");
const setupTokenFile = process.env.RELAY_SETUP_TOKEN_FILE?.trim();
const setupToken = authMode === "username" && setupTokenFile
  ? readSetupToken(setupTokenFile, process.env.RELAY_PROJECT_ROOT || process.cwd()) : undefined;
const smtpHost = authMode === "email" ? process.env.SMTP_HOST?.trim() || null : null;
const smtpPort = Number(process.env.SMTP_PORT || "587");
const smtpUser = authMode === "email" ? optionalSecret("SMTP_USER", "SMTP_USER_FILE") : null;
const smtpPassword = authMode === "email" ? optionalSecret("SMTP_PASSWORD", "SMTP_PASSWORD_FILE") : null;

if (!/^(127\.0\.0\.1|localhost)$/.test(mongoHost)) {
  throw new Error("MONGO_HOST must remain loopback-only.");
}
if (!/^[A-Za-z0-9_-]{1,64}$/.test(mongoDatabase)) {
  throw new Error("MONGO_DATABASE is invalid.");
}
if (
  smtpHost &&
  (!/^[A-Za-z0-9.-]{1,253}$/.test(smtpHost) ||
    !Number.isInteger(smtpPort) ||
    smtpPort < 1 ||
    smtpPort > 65_535 ||
    !smtpUser ||
    !smtpPassword)
) {
  throw new Error(
    "SMTP_HOST requires a valid SMTP_PORT and SMTP_USER/SMTP_PASSWORD secrets.",
  );
}

const mongoClient = new MongoClient(`mongodb://${mongoHost}:${mongoPort}`, {
  auth: {
    username: mongoUsername,
    password: mongoPassword,
  },
  authSource: mongoDatabase,
  directConnection: true,
  connectTimeoutMS: 5_000,
  serverSelectionTimeoutMS: 5_000,
  waitQueueTimeoutMS: 3_000,
  maxPoolSize: 30,
  socketTimeoutMS: 10_000,
  retryReads: false,
  retryWrites: false,
  monitorCommands: true,
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
const mongoBudget = new MongoBudget();
mongoClient.on("commandStarted", event => mongoBudget.observeCommand(event.commandName));
const mongoDb = budgetMongoDatabase(mongoClient.db(mongoDatabase), mongoBudget);
const relayDb = new MongoStore(mongoDb);
const pairingApi = new PairingApi(mongoDb);
const releaseNotesApi = new ReleaseNotesApi(mongoDb);
const emailAuth = new EmailAuth(mongoDb, {
  publicOrigin,
  authMode,
  setupToken,
  mailFrom: authMode === "email" ? required("MAIL_FROM") : undefined,
  sendmailPath: process.env.SENDMAIL_PATH || "/usr/sbin/sendmail",
  smtp: smtpHost
    ? {
        host: smtpHost,
        port: smtpPort,
        secure: process.env.SMTP_SECURE === "true" || smtpPort === 465,
        requireTls:
          process.env.SMTP_REQUIRE_TLS !== "false" && smtpPort !== 465,
        user: smtpUser!,
        password: smtpPassword!,
      }
    : undefined,
});

const pushConfig = readPushConfig();
const androidPush = pushConfig ? new AndroidPush(mongoDb, pushConfig) : undefined;

const env = {
  COMMAND_WAIT: new CommandWaitHub(),
  RESPONSE_WAIT: new ResponseWaitHub(),
  REVALIDATE_ACCOUNT: (request: Request) => emailAuth.authenticate({
    headers: { cookie: request.headers.get("cookie") || "" },
  } as IncomingMessage),
  ANDROID_PUSH: androidPush,
  DB: relayDb,
  RELAY_BLOBS: new FileBlobStore(blobRoot),
  REALTIME: undefined as ReturnType<typeof attachRealtimeServer> | undefined,
  CIPHER_STREAM: undefined as ReturnType<typeof attachCipherStreamServer> | undefined,
  IOS_PUSH: undefined as Awaited<ReturnType<typeof createIosPushService>>,
};

const networkUsage = createNetworkUsage();

async function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  const path = (request.url || "").split("?", 1)[0];
  const maxBytes = path === "/api/relay/push-registration" ? 2048 : path === "/api/feedback"
    ? MAX_FEEDBACK_REQUEST_BYTES : MAX_REQUEST_BYTES;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    networkUsage.receiveHttp(request, buffer);
    size += buffer.length;
    if (size > maxBytes) {
      const error = new Error("Request body is too large") as Error & {
        status?: number;
      };
      error.status = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function toWebRequest(
  request: IncomingMessage,
  authenticatedEmail: string | null,
  signal?: AbortSignal,
): Promise<Request> {
  // The gateway serves one configured instance. Incoming Host/forwarded
  // headers never redefine the origin used by authentication or CSRF checks.
  const url = new URL(request.url || "/", publicOrigin).href;
  if (new URL(url).origin !== publicOrigin) throw Object.assign(new Error("invalid_origin"), { status: 403 });
  const headers = new NodeHeaders();
  for (const [name, value] of Object.entries(request.headers)) {
    if (["oai-authenticated-user-email", "x-relayune-authenticated-account-id", "x-relayune-account-username"].includes(name.toLowerCase())) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value != null) {
      headers.set(name, value);
    }
  }
  if (authenticatedEmail) {
    const identity = await emailAuth.accountIdentity(authenticatedEmail);
    if (identity?.auth_mode === "username") {
      headers.set("x-relayune-authenticated-account-id", identity.account_id);
      headers.set("x-relayune-account-username", identity.username!);
    } else {
      headers.set("oai-authenticated-user-email", authenticatedEmail);
    }
  }
  return new NodeRequest(url, {
    method: request.method,
    headers: headers as unknown as Headers,
    body: await readBody(request),
    signal,
  }) as unknown as Request;
}

async function sendWebResponse(response: Response, target: ServerResponse) {
  target.statusCode = response.status;
  response.headers.forEach((value, name) => target.setHeader(name, value));
  const content = Buffer.from(await response.arrayBuffer());
  if (response.status >= 400 && content.length <= 65536) {
    try { recordResponseError(JSON.parse(content.toString('utf8')), response.status); } catch { /* fixed fallback */ }
  }
  target.end(await compressRelayResponse(target.req, target, content));
}

function sendJson(target: ServerResponse, status: number, body: unknown) {
  recordResponseError(body, status);
  const content = JSON.stringify(body);
  target.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(content),
    "Cache-Control": "no-store",
  });
  target.end(content);
}

const feedbackApi = new FeedbackApi(mongoDb, new URL(publicOrigin).origin);

const observeClient = createClientObserver(mongoDb);
const logIdentity = loadLogIdentity(process.env.REQUEST_LOG_HMAC_KEY_FILE);
const monitoring = createMonitoring({
  allowLocalOnly: authMode === "username",
  adminEmail: authMode === "email" ? process.env.MONITOR_ADMIN_EMAIL : undefined,
  authorizeAccount: authMode === "username" ? async principal => {
    const configured = process.env.MONITOR_ADMIN_USERNAME?.trim().toLowerCase();
    if (!configured) return false;
    const identity = await emailAuth.accountIdentity(principal);
    return identity?.auth_mode === "username" && identity.username === configured;
  } : undefined,
  directory: createMonitoringDirectory(mongoDb, logIdentity),
  query: process.env.SLS_READ_CREDENTIALS_FILE ? createSlsQuery(process.env.SLS_READ_CREDENTIALS_FILE, {
    project: process.env.SLS_PROJECT,
    logstore: process.env.SLS_LOGSTORE,
    region: process.env.SLS_REGION,
    internal: process.env.SLS_USE_PUBLIC_ENDPOINT !== "1",
  }) : null,
  ping: () => mongoDb.command({ ping: 1 }),
});

const deletionGate = new AccountDeletionGate();
const server = createServer(async (request, response) => {
  const path = (request.url || "/").split("?", 1)[0];
  const release = path.startsWith("/api/") && path !== "/api/account/delete" ? await deletionGate.enter(false) : () => {};
  try { await runRequestLog(request, response, async () => {
  networkUsage.observeHttp(request, response);
  const pathname = (request.url || "/").split("?", 1)[0];
  let redactedError: string | undefined;
  try {
    if (pathname === "/health") {
      await mongoDb.command({ ping: 1 });
      sendJson(response, 200, {
        ok: true,
        service: "agent-relay",
        protocol_version: 2,
        database: "mongodb",
        email_auth: authMode === "email",
        auth_mode: authMode,
        server_blind: true,
        realtime: true,
        ios_push: {enabled: Boolean(env.IOS_PUSH), environments: Object.keys(env.IOS_PUSH?.clients ?? {})},
      });
      return;
    }
    if (pathname === "/api/release-notes") {
      const publicResponse = await releaseNotesApi.handle(
        await toWebRequest(request, null),
      );
      if (publicResponse) {
        await sendWebResponse(publicResponse, response);
        return;
      }
    }
    if (await emailAuth.handle(request, response)) return;

    const email = await emailAuth.authenticate(request);
    if (pathname === "/api/monitoring" || pathname === "/api/monitoring/resolve-user") {
      const result = await monitoring(await toWebRequest(request, null), email);
      if (result) { await sendWebResponse(result, response); return; }
    }
    const disconnected = new AbortController();
    response.once("close", () => disconnected.abort());
    if (response.destroyed) disconnected.abort();
    const webRequest = await toWebRequest(request, email, disconnected.signal);
    const feedbackResponse = await feedbackApi.handle(webRequest, email);
    if (feedbackResponse) {
      await sendWebResponse(feedbackResponse, response);
      return;
    }
    const pairingResponse = await pairingApi.handle(webRequest, email);
    if (pairingResponse) {
      await sendWebResponse(pairingResponse, response);
      return;
    }
    const relayResponse = await handleRelayApi(webRequest, env as never);
    if (!relayResponse) {
      sendJson(response, 404, {
        error: { code: "not_found", message: "Not found." },
      });
      return;
    }
    await sendWebResponse(relayResponse, response);
  } catch (error) {
    const status = Number((error as { status?: number }).status || 500);
    if (status === 503) response.setHeader("Retry-After", "1");
    const errorCode = (error as { code?: string }).code;
    const publicMessage = (error as { publicMessage?: string }).publicMessage;
    const safeProtocolError =
      typeof errorCode === "string" &&
      SAFE_RELAY_PROTOCOL_ERRORS.has(errorCode)
        ? errorCode
        : null;
    redactedError =
      safeProtocolError ||
      (errorCode === "mail_delivery_failed"
        ? errorCode
        : status === 413
          ? "payload_too_large"
          : status === 429
            ? "rate_limited"
            : status === 400
              ? "invalid_request"
              : status === 409
                ? "conflict"
                : status === 403
                  ? "forbidden"
                  : "internal_error");
    sendJson(response, status, {
      error: {
        code: redactedError,
        message:
          publicMessage ||
          (status === 413
            ? "Request body is too large."
            : status === 429
              ? "登录请求过于频繁，请稍后重试。"
              : status === 400
                ? "请求内容无效。"
                : status === 409
                  ? "加密事件编号发生冲突。"
                  : status === 403
                    ? "请求来源无效。"
                    : "Relay API request failed."),
      },
    });
  }
}, { identity: logIdentity, observeClient }); } finally { release(); }
});

const realtime = attachRealtimeServer(server, {
  networkUsage,
  publicOrigin: new URL(publicOrigin).origin,
  onlineWindowMs: ONLINE_WINDOW_MS,
  authenticateSession: async (request) => {
    const email = await emailAuth.authenticate(request);
    if (!email) return null;
    return email;
  },
  authorize: async (request, email, payload) => {
    if (await emailAuth.authenticate(request) !== email) throw new Error("session_expired");
    const webRequest = await toWebRequest(request, email);
    webRequest.headers.set("x-relay-browser-token", payload.browserToken);
    return authorizeRealtimeBrowser(webRequest, env, payload.deviceId);
  },
});
env.REALTIME = realtime;
const cipherStream = attachCipherStreamServer(server, {
  networkUsage,
  publicOrigin: new URL(publicOrigin).origin,
  authenticateSession: async request => {
    const email = await emailAuth.authenticate(request);
    if (!email) return null;
    return email;
  },
  authorizeRelay: async (request, payload) => {
    const webRequest = await toWebRequest(request, null);
    webRequest.headers.set("authorization", `Bearer ${payload.relayToken}`);
    return authorizeCipherRelay(webRequest, env, payload.deviceId);
  },
  authorizeBrowser: async (request, email, payload) => {
    // Recheck the account session as well as the independent device grant on
    // every periodic validation. A socket must not outlive login expiry.
    if (await emailAuth.authenticate(request) !== email) throw new Error("session_expired");
    const webRequest = await toWebRequest(request, email);
    webRequest.headers.set("x-relay-browser-token", payload.browserToken);
    return authorizeCipherBrowser(webRequest, env, payload.deviceId);
  },
  activeBrowsers: deviceId => realtime.activeBrowsers(deviceId),
  onBrowserStream: (deviceId, browserId) => realtime.suppressDelivery(deviceId, browserId),
});
env.CIPHER_STREAM = cipherStream;
emailAuth.setAccountDeletionEffects({
  async runExclusive(cleanup) {
    const release = await deletionGate.enter(true);
    try { await cleanup(); } finally { release(); }
  },
  revokeDevice(id) {
    realtime.revokeDevice(id);
    cipherStream.revokeDevice(id);
  },
  deleteBlob: key => env.RELAY_BLOBS.delete(key),
});
realtime.onSubscriptionsChanged(deviceId => {
  for (const browserId of cipherStream.activeBrowserIds(deviceId)) realtime.suppressDelivery(deviceId, browserId);
  cipherStream.legacySubscriptionsChanged(deviceId);
});
pairingApi.setRealtime({
  revokeBrowser(deviceId, browserId) {
    realtime.revokeBrowser(deviceId, browserId);
    cipherStream.revokeBrowser(deviceId, browserId);
  },
});


let stopRetention: (() => Promise<void>) | undefined;
let deletionRetry: NodeJS.Timeout | undefined;
let deletionRetryRunning = false;

async function shutdown(signal: string) {
  console.log(JSON.stringify({ level: "info", event: "shutdown", signal }));
  androidPush?.close();
  clearInterval(deletionRetry);
  env.COMMAND_WAIT.close();
  env.RESPONSE_WAIT.close();
  realtime.close();
  cipherStream.close();
  server.close(async () => {
    networkUsage.close();
    env.IOS_PUSH?.close();
    await stopRetention?.();
    await env.RELAY_BLOBS.close();
    await mongoClient.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

async function start() {
  await fs.mkdir(blobRoot, { recursive: true, mode: 0o700 });
  await mongoClient.connect();
  await mongoDb.command({ ping: 1 });
  await initializeRelayMongo(mongoDb);
  env.IOS_PUSH = await createIosPushService(mongoDb);
  await env.IOS_PUSH?.initialize();
  await androidPush?.initialize();
  await releaseNotesApi.initialize();
  await pairingApi.initialize();
  await emailAuth.initialize();
  await feedbackApi.initialize();
  await emailAuth.resumeAccountDeletions().catch(() => {
    console.error(JSON.stringify({ level: "error", event: "account_deletion_retry_failed" }));
  });
  deletionRetry = setInterval(() => void (async () => {
    if (deletionRetryRunning) return;
    deletionRetryRunning = true;
    try {
      if (!await emailAuth.hasPendingAccountDeletions()) return;
      const release = await deletionGate.enter(true);
      try { await emailAuth.resumeAccountDeletions(); } finally { release(); }
    } finally { deletionRetryRunning = false; }
  })().catch(() => {
    console.error(JSON.stringify({ level: "error", event: "account_deletion_retry_failed" }));
  }), 60_000);
  deletionRetry.unref();
  stopRetention = startRelayRetention(mongoDb, env.RELAY_BLOBS);
  server.listen(port, host, () => {
    console.log(
      JSON.stringify({
        level: "info",
        event: "listening",
        address: `http://${host}:${port}`,
        database: "mongodb",
        blob_root: blobRoot,
      }),
    );
  });
}

void start().catch(() => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "startup_failed",
      error: "startup_failed",
    }),
  );
  process.exit(1);
});
