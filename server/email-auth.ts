import { markAuthenticated, recordResponseError } from "./request-log.mjs";
import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { spawn } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Collection, Db } from "mongodb";
import nodemailer, { type Transporter } from "nodemailer";
import { deleteAccount, type AccountDeletionEffects } from "./account-deletion";
import { derivePassword, verifyPassword } from "./password-hash";
import { initializeLocalAccounts, initializeLocalOwner, localOwner, localUsername, LOCAL_ACCOUNT_ID, publicAccount } from "./local-accounts";
import { isAgentOrder, normalizeAgentOrder, normalizeVisibleAgents } from "../shared/agent-order";

const MAGIC_LINK_TTL_MS = 10 * 60_000;
// 会话采用 60 天滑动过期：剩余不足 30 天时按请求自动续期，活跃客户端（含手机端）
// 会持续保持登录。显式退出仍会立即撤销；长期废弃记录仍由 TTL 索引清除。
const WEB_SESSION_TTL_MS = 60 * 24 * 60 * 60_000;
const WEB_SESSION_RENEW_THRESHOLD_MS = WEB_SESSION_TTL_MS / 2;
const LOGIN_ATTEMPT_TTL_MS = 15 * 60_000;
const MAX_AUTH_BODY_BYTES = 32 * 1024;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
const PAIRING_ID_PATTERN = /^pair_[A-Za-z0-9_-]{43}$/;
const DESKTOP_LOGIN_ID_PATTERN = /^dlogin_[A-Za-z0-9_-]{43}$/;
const ACCOUNT_RETURN_PATH = "/account/";

export const EMAIL_LOCALES = [
  "en",
  "zh-CN",
  "hi",
  "es",
  "ar",
  "fr",
  "bn",
  "pt",
  "id",
  "ur",
] as const;

export type EmailLocale = (typeof EMAIL_LOCALES)[number];

type EmailAuthOptions = {
  publicOrigin: string;
  mailFrom?: string;
  authMode?: "email" | "username";
  setupToken?: string;
  sendmailPath?: string;
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    requireTls: boolean;
    user: string;
    password: string;
  };
};

type AuthDocument = {
  _id: string;
  [key: string]: unknown;
};

export class EmailAuth {
  private deletionEffects: AccountDeletionEffects | null = null;
  private readonly deleting = new Map<string, Promise<void>>();

  setAccountDeletionEffects(effects: AccountDeletionEffects) {
    this.deletionEffects = effects;
  }

  async resumeAccountDeletions() {
    if (!this.deletionEffects) return;
    const pending = this.collection("auth_users").find(
      { account_deletion_started_at: { $exists: true } }, { projection: { _id: 1 } },
    ).limit(10);
    let failed = false;
    for await (const user of pending) {
      try { await deleteAccount(this.db, user._id, "", this.deletionEffects); }
      catch { failed = true; }
    }
    if (failed) throw new Error("account_deletion_cleanup_incomplete");
  }

  async hasPendingAccountDeletions() {
    return Boolean(await this.collection("auth_users").findOne(
      { account_deletion_started_at: { $exists: true } }, { projection: { _id: 1 } },
    ));
  }
  readonly authMode: "email" | "username";
  private readonly setupToken: string | null;
  private readonly publicOrigin: string;
  private readonly mailFrom: string;
  private readonly sendmailPath: string;
  private readonly smtpTransport: Transporter | null;

  constructor(
    private readonly db: Db,
    options: EmailAuthOptions,
  ) {
    this.publicOrigin = normalizeOrigin(options.publicOrigin);
    this.authMode = options.authMode || "email";
    if (this.authMode !== "email" && this.authMode !== "username") throw new Error("invalid_auth_mode");
    this.setupToken = options.setupToken || null;
    if (this.setupToken && !/^[A-Za-z0-9_-]{43,128}$/.test(this.setupToken)) throw new Error("setup_token_invalid");
    if (
      this.authMode === "email" && (!options.mailFrom ||
      /[\r\n]/.test(options.mailFrom) ||
      !options.mailFrom.includes("@"))
    ) {
      throw new Error("MAIL_FROM must be a safe RFC 5322 mailbox.");
    }
    if (options.smtp && (
      typeof options.smtp.secure !== "boolean" ||
      typeof options.smtp.requireTls !== "boolean" ||
      (!options.smtp.secure && !options.smtp.requireTls)
    )) {
      throw new Error("SMTP requires implicit TLS or mandatory STARTTLS.");
    }
    this.mailFrom = options.mailFrom || "";
    this.sendmailPath = options.sendmailPath || "/usr/sbin/sendmail";
    this.smtpTransport = this.authMode === "email" && options.smtp
      ? nodemailer.createTransport({
          host: options.smtp.host,
          port: options.smtp.port,
          secure: options.smtp.secure,
          requireTLS: options.smtp.requireTls,
          // Authentication emails only contain strings generated below. Never
          // let content options read local files or fetch remote URLs.
          disableFileAccess: true,
          disableUrlAccess: true,
          tls: { rejectUnauthorized: true },
          auth: {
            user: options.smtp.user,
            pass: options.smtp.password,
          },
          logger: false,
          debug: false,
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
        })
      : null;
  }

  async initialize() {
    if (this.authMode === "username") await initializeLocalAccounts(this.db);
    else if (await this.collection("auth_users").findOne({ auth_mode: "username" })) throw new Error("email_mode_requires_separate_database");
    await Promise.all([
      this.collection("auth_magic_links").createIndex(
        { expires_at: 1 },
        { expireAfterSeconds: 0, name: "auth_magic_links_expiry" },
      ),
      this.collection("auth_magic_links").createIndex(
        { email: 1, created_at: -1 },
        { name: "auth_magic_links_email_rate" },
      ),
      this.collection("auth_magic_links").createIndex(
        { request_ip_hash: 1, created_at: -1 },
        { name: "auth_magic_links_ip_rate" },
      ),
      this.collection("auth_sessions").createIndex(
        { token_hash: 1 },
        { unique: true, name: "auth_sessions_token_uq" },
      ),
      this.collection("auth_sessions").createIndex(
        { expires_at: 1 },
        { expireAfterSeconds: 0, name: "auth_sessions_expiry" },
      ),
      this.collection("auth_setup_sessions").createIndex(
        { token_hash: 1 },
        { unique: true, name: "auth_setup_sessions_token_uq" },
      ),
      this.collection("auth_setup_sessions").createIndex(
        { expires_at: 1 },
        { expireAfterSeconds: 0, name: "auth_setup_sessions_expiry" },
      ),
      this.collection("auth_login_attempts").createIndex(
        { expires_at: 1 },
        { expireAfterSeconds: 0, name: "auth_login_attempts_expiry" },
      ),
      this.collection("auth_login_attempts").createIndex(
        { email_hash: 1, created_at: -1 },
        { name: "auth_login_attempts_email_rate" },
      ),
      this.collection("auth_login_attempts").createIndex(
        { request_ip_hash: 1, created_at: -1 },
        { name: "auth_login_attempts_ip_rate" },
      ),
    ]);
    if (this.smtpTransport) {
      await this.smtpTransport.verify();
    }
  }

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> {
    const url = new URL(request.url || "/", this.publicOrigin);
    if (url.pathname === "/api/instance") {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: { code: "method_not_allowed" } }, { Allow: "GET" });
      } else {
        sendJson(response, 200, {
          schema_version: 1, auth_mode: this.authMode,
          self_hosted: this.authMode === "username",
          setup_required: this.authMode === "username" && !await localOwner(this.db),
          registration_enabled: this.authMode === "email",
          account_deletion_enabled: this.authMode === "email",
          password_min_length: this.authMode === "username" ? 12 : PASSWORD_MIN_LENGTH,
        });
      }
      return true;
    }
    if (url.pathname === "/api/auth/session" && request.method === "GET") {
      const principal = await this.authenticate(request);
      const user = principal ? await this.collection("auth_users").findOne({ _id: principal }) : null;
      sendJson(response, 200, { authenticated: Boolean(user), user: user ? publicAccount(user) : null });
      return true;
    }
    if (this.authMode === "username" && url.pathname === "/api/auth/setup") {
      if (request.method !== "POST") {
        sendJson(response, 405, { error: { code: "method_not_allowed" } }, { Allow: "POST" });
        return true;
      }
      requireSameOrigin(request, this.publicOrigin);
      const supplied = request.headers["x-relayune-setup-token"];
      const expected = this.setupToken;
      const authorized = typeof supplied === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(supplied) && expected &&
        supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
      if (!authorized) {
        sendJson(response, 403, { error: { code: "setup_authorization_required" } });
        return true;
      }
      if (await localOwner(this.db)) {
        sendJson(response, 409, { error: { code: "instance_already_initialized" } });
        return true;
      }
      const body = await readJson(request);
      try {
        const user = await initializeLocalOwner(this.db, body.username, body.password);
        const token = await this.createWebSession(request, user._id, user);
        sendJson(response, 201, { authenticated: true, user: publicAccount(user) }, { "Set-Cookie": sessionCookie(token) });
      } catch (error) {
        const failure = error as { status?: number; code?: string };
        if (!failure.status) throw error;
        sendJson(response, failure.status, { error: { code: failure.code } });
      }
      return true;
    }
    if (this.authMode === "username" && ["/api/auth/email-status", "/api/auth/magic-link", "/api/auth/verify", "/api/auth/set-password"].includes(url.pathname)) {
      sendJson(response, 404, { error: { code: "email_auth_disabled" } });
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/auth/email-status"
    ) {
      requireSameOrigin(request, this.publicOrigin);
      const body = await readJson(request);
      requireEmail(body.email);
      sendJson(response, 200, {
        next_action: "password",
      });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/password") {
      requireSameOrigin(request, this.publicOrigin);
      const body = await readJson(request);
      const identifier = this.authMode === "username" ? localUsername(body.username) : requireEmail(body.email);
      const password = parsePassword(body.password, false);
      const pairingId = parsePairingContinuation(body.pairing_id);
      const desktopLoginId = parseDesktopLoginContinuation(
        body.desktop_login_id,
      );
      requireSingleContinuation(pairingId, desktopLoginId);
      const requestIpHash = sha256(clientAddress(request));
      if (this.authMode === "username") await this.enforceLocalPasswordRateLimit(identifier, requestIpHash);
      else await this.enforcePasswordRateLimit(identifier, requestIpHash);
      const user = await this.collection("auth_users").findOne(this.authMode === "username"
        ? { username: identifier, auth_mode: "username" } : { _id: identifier });
      const passwordValid = await verifyPassword(password, user);
      const valid = !user?.account_deletion_started_at && authGeneration(user?.auth_epoch) !== null && passwordValid;
      if (!valid) {
        if (this.authMode === "email") await this.recordFailedPasswordAttempt(identifier, requestIpHash);
        sendJson(response, 401, {
          error: {
            code: "invalid_credentials",
            message: this.authMode === "username" ? "用户名或密码不正确。" : "邮箱或密码不正确。",
          },
        });
        return true;
      }
      const email = user!._id;
      await this.collection("auth_login_attempts").deleteMany({
        email_hash: sha256(email),
      });
      const sessionToken = await this.createWebSession(request, email, user!);
      sendJson(
        response,
        200,
        { authenticated: true, user: publicAccount(user!) },
        { "Set-Cookie": sessionCookie(sessionToken) },
      );
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/magic-link") {
      requireSameOrigin(request, this.publicOrigin);
      const body = await readJson(request);
      const email = requireEmail(body.email);
      const pairingId = parsePairingContinuation(body.pairing_id);
      const desktopLoginId = parseDesktopLoginContinuation(
        body.desktop_login_id,
      );
      const returnTo = parseAccountReturnPath(body.return_to);
      requireSingleContinuation(pairingId, desktopLoginId);
      const locale = emailLocale(
        body.locale,
        request.headers["accept-language"],
      );

      const requestIpHash = sha256(clientAddress(request));
      await this.enforceRateLimit(email, requestIpHash);
      const token = randomBytes(32).toString("base64url");
      const tokenHash = sha256(token);
      const now = Date.now();
      const expiresAt = now + MAGIC_LINK_TTL_MS;
      await this.collection("auth_magic_links").insertOne({
        _id: tokenHash,
        token_hash: tokenHash,
        email,
        created_at: new Date(now),
        expires_at: new Date(expiresAt),
        used_at: null,
        request_ip_hash: requestIpHash,
        pairing_id: pairingId,
        desktop_login_id: desktopLoginId,
        return_to: returnTo,
      });
      try {
        await sendMagicLink({
          smtpTransport: this.smtpTransport,
          sendmailPath: this.sendmailPath,
          from: this.mailFrom,
          to: email,
          link: `${this.publicOrigin}/api/auth/verify?token=${encodeURIComponent(token)}`,
          expiresMinutes: MAGIC_LINK_TTL_MS / 60_000,
          locale,
        });
      } catch (error) {
        await this.collection("auth_magic_links").deleteOne({ _id: tokenHash });
        throw mailDeliveryError(
          error,
          this.smtpTransport ? "smtp" : "sendmail",
        );
      }

      sendJson(response, 202, {
        delivered: true,
        expires_in_seconds: MAGIC_LINK_TTL_MS / 1_000,
      });
      return true;
    }

    if (request.method === "GET" && url.pathname === "/api/auth/verify") {
      const token = url.searchParams.get("token") || "";
      if (!TOKEN_PATTERN.test(token)) {
        sendAuthError(response);
        return true;
      }
      const now = new Date();
      const link = await this.collection("auth_magic_links").findOneAndUpdate(
        {
          token_hash: sha256(token),
          used_at: null,
          expires_at: { $gt: now },
        },
        { $set: { used_at: now } },
        { returnDocument: "before" },
      );
      if (!link || typeof link.email !== "string") {
        sendAuthError(response);
        return true;
      }
      const setupToken = randomBytes(32).toString("base64url");
      await this.collection("auth_setup_sessions").insertOne({
        _id: sha256(setupToken),
        token_hash: sha256(setupToken),
        email: link.email,
        created_at: now,
        expires_at: new Date(now.getTime() + MAGIC_LINK_TTL_MS),
        used_at: null,
        request_ip_hash: sha256(clientAddress(request)),
        user_agent_hash: sha256(String(request.headers["user-agent"] || "")),
        pairing_id:
          typeof link.pairing_id === "string" ? link.pairing_id : null,
        desktop_login_id:
          typeof link.desktop_login_id === "string"
            ? link.desktop_login_id
            : null,
      });
      const continuation = new URLSearchParams({ auth: "set-password" });
      if (
        typeof link.pairing_id === "string" &&
        PAIRING_ID_PATTERN.test(link.pairing_id)
      ) {
        continuation.set("pair", link.pairing_id);
      } else if (
        typeof link.desktop_login_id === "string" &&
        DESKTOP_LOGIN_ID_PATTERN.test(link.desktop_login_id)
      ) {
        continuation.set("desktop_login", link.desktop_login_id);
      } else if (link.return_to === ACCOUNT_RETURN_PATH) {
        continuation.set("return_to", ACCOUNT_RETURN_PATH);
      }
      const redirect = `/?${continuation.toString()}`;
      response.writeHead(303, {
        Location: redirect,
        "Cache-Control": "no-store",
        "Set-Cookie": setupCookie(setupToken),
      });
      response.end();
      return true;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/auth/set-password"
    ) {
      requireSameOrigin(request, this.publicOrigin);
      const body = await readJson(request);
      const password = parsePassword(body.password, true);
      const setupToken = cookieValue(request, "relay_setup");
      if (!setupToken || !TOKEN_PATTERN.test(setupToken)) {
        sendSetupError(response);
        return true;
      }
      const now = new Date();
      const setup = await this.collection(
        "auth_setup_sessions",
      ).findOneAndUpdate(
        {
          token_hash: sha256(setupToken),
          used_at: null,
          expires_at: { $gt: now },
        },
        { $set: { used_at: now } },
        { returnDocument: "before" },
      );
      const email =
        typeof setup?.email === "string" ? normalizeEmail(setup.email) : "";
      if (!isValidEmail(email)) {
        sendSetupError(response);
        return true;
      }
      const passwordSalt = randomBytes(16).toString("base64url");
      const passwordHash = (
        await derivePassword(password, passwordSalt)
      ).toString("base64url");
      if ((await this.collection("auth_users").findOne({ _id: email }))?.account_deletion_started_at) {
        sendJson(response, 409, { error: { code: "account_deletion_in_progress" } });
        return true;
      }
      const updatedUser = await this.db.collection<{ _id: string; auth_epoch: number }>("auth_users").findOneAndUpdate(
        { _id: email },
        {
          $set: {
            email,
            password_algorithm: "scrypt-v1",
            password_salt: passwordSalt,
            password_hash: passwordHash,
            password_set_at: now,
            updated_at: now,
          },
          $setOnInsert: {
            created_at: now,
          },
          $inc: { auth_epoch: 1 },
        },
        { upsert: true, returnDocument: "after" },
      );
      if (!updatedUser || authGeneration(updatedUser.auth_epoch) === null) {
        throw new Error("account_generation_update_failed");
      }
      // Cleanup is bounded to older generations: concurrent recovery/login may
      // already have created a newer session. The generation check below, not
      // deletion, also rejects stale sessions inserted after this cleanup.
      await this.collection("auth_sessions").deleteMany({
        email,
        $or: [
          { auth_epoch: { $lt: updatedUser.auth_epoch } },
          { auth_epoch: { $exists: false } },
        ],
      });
      await this.collection("auth_login_attempts").deleteMany({
        email_hash: sha256(email),
      });
      const sessionToken = await this.createWebSession(request, email, updatedUser);
      sendJson(
        response,
        200,
        { authenticated: true },
        {
          "Set-Cookie": [
            sessionCookie(sessionToken),
            clearCookie("relay_setup"),
          ],
        },
      );
      return true;
    }

    if (url.pathname === "/api/account/delete") {
      if (request.method !== "POST") {
        sendJson(response, 405, { error: { code: "method_not_allowed" } }, { Allow: "POST" });
        return true;
      }
      requireSameOrigin(request, this.publicOrigin);
      if (this.authMode === "username") {
        sendJson(response, 409, { error: { code: "owner_account_required", message: "本实例唯一账户只能通过服务器本机管理或移除。" } });
        return true;
      }
      const email = await this.authenticate(request, true);
      if (!email) {
        sendJson(response, 401, { error: { code: "unauthorized" } });
        return true;
      }
      const body = await readJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body) || body.confirm !== true || Object.keys(body).some(key => !["password", "confirm"].includes(key))) {
        sendJson(response, 400, { error: { code: "deletion_confirmation_required" } });
        return true;
      }
      const password = parsePassword(body.password, false);
      const requestIpHash = sha256(clientAddress(request));
      await this.enforcePasswordRateLimit(email, requestIpHash);
      const user = await this.collection("auth_users").findOne({ _id: email });
      if (!await verifyPassword(password, user)) {
        await this.recordFailedPasswordAttempt(email, requestIpHash);
        sendJson(response, 401, { error: { code: "invalid_credentials" } });
        return true;
      }
      if (!this.deletionEffects) {
        sendJson(response, 503, { error: { code: "account_deletion_unavailable" } });
        return true;
      }
      let deletion = this.deleting.get(email);
      if (!deletion) {
        const sessionHash = sha256(cookieValue(request, "relay_session")!);
        const effects = this.deletionEffects;
        const cleanup = () => deleteAccount(this.db, email, sessionHash, effects);
        deletion = effects.runExclusive ? effects.runExclusive(cleanup) : cleanup();
        this.deleting.set(email, deletion);
      }
      try {
        await deletion;
      } finally {
        if (this.deleting.get(email) === deletion) this.deleting.delete(email);
      }
      sendJson(response, 200, { deleted: true, authenticated: false }, {
        "Set-Cookie": [clearCookie("relay_session"), clearCookie("relay_setup")],
      });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      requireSameOrigin(request, this.publicOrigin);
      const token = cookieValue(request, "relay_session");
      if (token && TOKEN_PATTERN.test(token)) {
        await this.collection("auth_sessions").updateOne(
          { token_hash: sha256(token), revoked_at: null },
          { $set: { revoked_at: new Date() } },
        );
      }
      sendJson(
        response,
        200,
        { authenticated: false },
        {
          "Set-Cookie": [
            clearCookie("relay_session"),
            clearCookie("relay_setup"),
          ],
        },
      );
      return true;
    }

    if (url.pathname === "/api/account/agent-order") {
      if (request.method !== "GET" && request.method !== "PUT") {
        sendJson(response, 405, { error: { code: "method_not_allowed" } }, { Allow: "GET, PUT" });
        return true;
      }
      if (request.method === "PUT") requireSameOrigin(request, this.publicOrigin);
      const email = await this.authenticate(request);
      if (!email) {
        sendJson(response, 401, { error: { code: "unauthorized" } });
        return true;
      }
      if (request.method === "PUT") {
        const body = await readJson(request);
        if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).some((key) => !["agent_order", "visible_agents"].includes(key)) ||
          !("agent_order" in body || "visible_agents" in body) ||
          ("agent_order" in body && !isAgentOrder(body.agent_order)) ||
          ("visible_agents" in body && !isAgentOrder(body.visible_agents))) {
          sendJson(response, 400, { error: { code: "invalid_agent_order" } });
          return true;
        }
        const update = {
          ...("agent_order" in body ? { "preferences.agent_order": normalizeAgentOrder(body.agent_order) } : {}),
          ...("visible_agents" in body ? { "preferences.visible_agents": normalizeVisibleAgents(body.visible_agents) } : {}),
        };
        await this.collection("auth_users").updateOne(
          { _id: email },
          { $set: update },
          { upsert: true },
        );
      }
      {
        const user = await this.collection("auth_users").findOne(
          { _id: email }, { projection: { "preferences.agent_order": 1, "preferences.visible_agents": 1 } },
        );
        const preferences = user?.preferences as { agent_order?: unknown; visible_agents?: unknown } | undefined;
        sendJson(response, 200, { agent_order: normalizeAgentOrder(preferences?.agent_order), visible_agents: normalizeVisibleAgents(preferences?.visible_agents) });
      }
      return true;
    }

    return false;
  }

  async authenticate(request: IncomingMessage, allowDeleting = false): Promise<string | null> {
    const token = cookieValue(request, "relay_session");
    if (!token || !TOKEN_PATTERN.test(token)) return null;
    const session = await this.collection("auth_sessions").findOne({
      token_hash: sha256(token),
      revoked_at: null,
      expires_at: { $gt: new Date() },
    });
    const email = this.authMode === "username"
      ? (typeof session?.account_id === "string" ? session.account_id : "")
      : (typeof session?.email === "string" ? normalizeEmail(session.email) : "");
    if (this.authMode === "username" ? !LOCAL_ACCOUNT_ID.test(email) : !isValidEmail(email)) return null;
    const user = await this.collection("auth_users").findOne({ _id: email });
    if (!user || (!allowDeleting && user.account_deletion_started_at)) return null;
    if (this.authMode === "username" && user.auth_mode !== "username") return null;
    const userGeneration = authGeneration(user.auth_epoch);
    const sessionGeneration = authGeneration(session?.auth_epoch);
    if (userGeneration === null || sessionGeneration === null || sessionGeneration !== userGeneration) return null;
    await this.renewSession(session);
    markAuthenticated(email, "email_session");
    return email;
  }

  async accountIdentity(principal: string) {
    const user = await this.collection("auth_users").findOne({ _id: principal });
    return user ? publicAccount(user) : null;
  }

  private async renewSession(session: unknown) {
    const record = session as {
      token_hash?: unknown;
      expires_at?: unknown;
    } | null;
    const expiresAt =
      record?.expires_at instanceof Date ? record.expires_at.getTime() : NaN;
    if (typeof record?.token_hash !== "string" || !Number.isFinite(expiresAt))
      return;
    const now = Date.now();
    if (expiresAt - now > WEB_SESSION_RENEW_THRESHOLD_MS) return;
    await this.collection("auth_sessions").updateOne(
      { token_hash: record.token_hash, revoked_at: null },
      { $set: { expires_at: new Date(now + WEB_SESSION_TTL_MS) } },
    );
  }

  private async createWebSession(
    request: IncomingMessage,
    email: string,
    authenticatedUser: AuthDocument,
  ): Promise<string> {
    // Bind to the snapshot whose password was verified (or atomically changed).
    // Re-reading the current generation here would reauthorize an old-password
    // login that raced a password recovery.
    const generation = authGeneration(authenticatedUser.auth_epoch);
    if (generation === null) throw new Error("invalid_account_generation");
    const sessionToken = randomBytes(32).toString("base64url");
    const now = new Date();
    await this.collection("auth_sessions").insertOne({
      _id: sha256(sessionToken),
      token_hash: sha256(sessionToken),
      ...(this.authMode === "username"
        ? { account_id: email }
        : { email }),
      auth_epoch: generation,
      created_at: now,
      expires_at: new Date(now.getTime() + WEB_SESSION_TTL_MS),
      revoked_at: null,
      request_ip_hash: sha256(clientAddress(request)),
      user_agent_hash: sha256(String(request.headers["user-agent"] || "")),
    });
    markAuthenticated(email, (request.url || "").split("?")[0] === "/api/auth/password" ? "password" : "email_token");
    return sessionToken;
  }

  private async enforceLocalPasswordRateLimit(username: string, requestIpHash: string) {
    const window = Math.floor(Date.now() / LOGIN_ATTEMPT_TTL_MS);
    const limits = this.db.collection<{ _id: string; count: number; expires_at: Date }>("auth_password_limits");
    for (const [scope, key, maximum] of [["account", username, 8], ["address", requestIpHash, 30]] as const) {
      const id = sha256(`${scope}:${window}:${key}`);
      let counter;
      try {
        counter = await limits.findOneAndUpdate({ _id: id }, {
          $inc: { count: 1 }, $setOnInsert: { expires_at: new Date((window + 2) * LOGIN_ATTEMPT_TTL_MS) },
        }, { upsert: true, returnDocument: "after" });
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        counter = await limits.findOneAndUpdate({ _id: id }, { $inc: { count: 1 } }, { returnDocument: "after" });
      }
      if (!counter || Number(counter.count) > maximum) throw Object.assign(new Error("rate_limited"), { status: 429 });
    }
  }

  private async enforceRateLimit(email: string, requestIpHash: string) {
    const since = new Date(Date.now() - 15 * 60_000);
    const [emailCount, ipCount] = await Promise.all([
      this.collection("auth_magic_links").countDocuments({
        email,
        created_at: { $gte: since },
      }),
      this.collection("auth_magic_links").countDocuments({
        request_ip_hash: requestIpHash,
        created_at: { $gte: since },
      }),
    ]);
    if (emailCount >= 3 || ipCount >= 12) {
      const error = new Error("Too many login email requests.") as Error & {
        status?: number;
      };
      error.status = 429;
      throw error;
    }
  }

  private async enforcePasswordRateLimit(email: string, requestIpHash: string) {
    const since = new Date(Date.now() - LOGIN_ATTEMPT_TTL_MS);
    const [emailCount, ipCount] = await Promise.all([
      this.collection("auth_login_attempts").countDocuments({
        email_hash: sha256(email),
        created_at: { $gte: since },
      }),
      this.collection("auth_login_attempts").countDocuments({
        request_ip_hash: requestIpHash,
        created_at: { $gte: since },
      }),
    ]);
    if (emailCount >= 8 || ipCount >= 30) {
      const error = new Error("Too many password login attempts.") as Error & {
        status?: number;
      };
      error.status = 429;
      throw error;
    }
  }

  private async recordFailedPasswordAttempt(
    email: string,
    requestIpHash: string,
  ) {
    const now = new Date();
    await this.collection("auth_login_attempts").insertOne({
      _id: randomBytes(18).toString("base64url"),
      email_hash: sha256(email),
      request_ip_hash: requestIpHash,
      created_at: now,
      expires_at: new Date(now.getTime() + LOGIN_ATTEMPT_TTL_MS),
    });
  }

  private collection(name: string): Collection<AuthDocument> {
    return this.db.collection<AuthDocument>(name);
  }
}

async function sendMagicLink({
  smtpTransport,
  sendmailPath,
  from,
  to,
  link,
  expiresMinutes,
  locale,
}: {
  smtpTransport: Transporter | null;
  sendmailPath: string;
  from: string;
  to: string;
  link: string;
  expiresMinutes: number;
  locale: EmailLocale;
}) {
  const { subject, text, html } = magicLinkEmail({
    locale,
    link,
    expiresMinutes,
  });
  if (smtpTransport) {
    const delivery = await smtpTransport.sendMail({
      from,
      to,
      subject,
      text,
      html,
      headers: {
        "Auto-Submitted": "auto-generated",
        "X-Auto-Response-Suppress": "All",
      },
    });
    if (
      !Array.isArray(delivery.accepted) ||
      delivery.accepted.length !== 1 ||
      (Array.isArray(delivery.rejected) && delivery.rejected.length > 0)
    ) {
      const error = new Error("SMTP did not accept the recipient.") as Error & {
        code?: string;
      };
      error.code = "EENVELOPE";
      throw error;
    }
    return;
  }

  const boundary = `relayune-${randomBytes(18).toString("hex")}`;
  const message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeMessageHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "Auto-Submitted: auto-generated",
    "X-Auto-Response-Suppress: All",
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodeMessageBody(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodeMessageBody(html),
    `--${boundary}--`,
    "",
  ].join("\r\n");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(sendmailPath, ["-t", "-i"], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let errorOutput = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (errorOutput.length < 4_096) errorOutput += chunk;
    });
    child.once("error", reject);
    child.stdin.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "EPIPE") reject(error);
    });
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`sendmail exited with ${code}: ${errorOutput.trim()}`),
        );
    });
    child.stdin.end(message);
  });
}

export function magicLinkEmail({
  locale,
  link,
  expiresMinutes,
}: {
  locale: EmailLocale;
  link: string;
  expiresMinutes: number;
}) {
  const copy = magicLinkCopy(locale, expiresMinutes);
  const direction = locale === "ar" || locale === "ur" ? "rtl" : "ltr";
  const accentBorder =
    direction === "rtl"
      ? "border-right:4px solid #69e1d2;"
      : "border-left:4px solid #69e1d2;";
  const brandSpacing =
    direction === "rtl" ? "margin-left:9px;" : "margin-right:9px;";
  const safeLink = escapeHtml(link);
  const text = [
    "Relayune",
    "",
    copy.title,
    "",
    copy.intro,
    "",
    `${copy.action}:`,
    link,
    "",
    copy.securityTitle,
    copy.securityDetail,
    "",
    copy.ignore,
    "",
    copy.footer,
  ].join("\n");
  const html = `<!doctype html>
<html lang="${locale}" dir="${direction}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${escapeHtml(copy.subject)}</title>
    <style>@media only screen and (max-width:480px){.relayune-card{padding:32px 22px!important}.relayune-wrap{padding:24px 12px!important}}</style>
  </head>
  <body dir="${direction}" style="margin:0;padding:0;background:#f3f5f4;color:#17201d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans Arabic','Noto Sans Devanagari','Noto Sans Bengali','PingFang SC','Microsoft YaHei',Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(copy.preview)}&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f3f5f4;">
      <tr>
        <td class="relayune-wrap" align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;">
            <tr>
              <td style="padding:0 4px 18px;font-size:20px;line-height:28px;font-weight:700;letter-spacing:-0.3px;color:#0b1220;">
                <span style="display:inline-block;width:14px;height:14px;${brandSpacing}border:4px solid #0b1220;border-radius:50%;vertical-align:-2px;box-sizing:border-box;"></span>Relayune
              </td>
            </tr>
            <tr>
              <td class="relayune-card" style="background:#ffffff;border:1px solid #dfe5e2;border-radius:18px;padding:44px 40px;box-shadow:0 10px 30px rgba(11,18,32,0.06);">
                <h1 style="margin:0 0 16px;font-size:28px;line-height:36px;letter-spacing:-0.6px;color:#0b1220;">${escapeHtml(copy.title)}</h1>
                <p style="margin:0 0 28px;font-size:16px;line-height:26px;color:#46524e;">${escapeHtml(copy.intro)}</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0 0 28px;">
                  <tr>
                    <td align="center" bgcolor="#0b1220" style="border-radius:10px;">
                      <a href="${safeLink}" style="display:block;padding:14px 22px;border:1px solid #0b1220;border-radius:10px;color:#ffffff;font-size:16px;line-height:22px;font-weight:700;text-align:center;text-decoration:none;">${escapeHtml(copy.action)}</a>
                    </td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0 0 26px;background:#effafa;border-radius:12px;">
                  <tr>
                    <td style="padding:16px 18px;${accentBorder}border-radius:12px;">
                      <p style="margin:0 0 4px;font-size:14px;line-height:21px;font-weight:700;color:#123d3a;">${escapeHtml(copy.securityTitle)}</p>
                      <p style="margin:0;font-size:13px;line-height:21px;color:#45625f;">${escapeHtml(copy.securityDetail)}</p>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px;font-size:12px;line-height:19px;color:#68736f;">${escapeHtml(copy.fallback)}</p>
                <p style="margin:0 0 26px;font-size:12px;line-height:19px;word-break:break-all;"><a href="${safeLink}" style="color:#176b65;text-decoration:underline;">${safeLink}</a></p>
                <p style="margin:0;padding-top:24px;border-top:1px solid #e7ebe9;font-size:13px;line-height:21px;color:#68736f;">${escapeHtml(copy.ignore)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 6px 0;font-size:12px;line-height:18px;text-align:center;color:#7d8783;">${escapeHtml(copy.footer)}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return { subject: copy.subject, text, html };
}

type MagicLinkCopy = {
  subject: string;
  preview: string;
  title: string;
  intro: string;
  action: string;
  securityTitle: string;
  securityDetail: string;
  fallback: string;
  ignore: string;
  footer: string;
};

function magicLinkCopy(
  locale: EmailLocale,
  expiresMinutes: number,
): MagicLinkCopy {
  const copies: Record<EmailLocale, MagicLinkCopy> = {
    en: {
      subject: "Verify your email to continue with Relayune",
      preview: `This link expires in ${expiresMinutes} minutes and can only be used once.`,
      title: "Verify your email",
      intro:
        "We received a request to use this email address to sign in to Relayune. Verify your email to set or reset your sign-in password.",
      action: "Verify email",
      securityTitle: "This is a secure, one-time link",
      securityDetail: `The link expires in ${expiresMinutes} minutes and can only be used once. Relayune will never ask for your password or 8-character connection code by email.`,
      fallback:
        "Button not working? Copy and paste this link into your browser:",
      ignore:
        "If you did not request this email, you can safely ignore it. Your account will not change unless the verification link is opened.",
      footer: "This automated account-security email was sent by Relayune.",
    },
    "zh-CN": {
      subject: "验证邮箱并继续使用 Relayune",
      preview: `验证链接将在 ${expiresMinutes} 分钟后失效，且只能使用一次。`,
      title: "验证你的邮箱",
      intro:
        "我们收到了使用此邮箱登录 Relayune 的请求。请验证邮箱，以设置或重置登录密码。",
      action: "验证邮箱",
      securityTitle: "这是一条安全的一次性链接",
      securityDetail: `链接将在 ${expiresMinutes} 分钟后失效，且只能使用一次。Relayune 绝不会通过邮件向你索要密码或 8 位连接码。`,
      fallback: "按钮无法打开？复制下面的链接并粘贴到浏览器中：",
      ignore:
        "如果这不是你的操作，请忽略这封邮件。只要不点击验证链接，你的账户就不会发生更改。",
      footer: "这是一封由 Relayune 自动发送的账户安全邮件。",
    },
    hi: {
      subject: "Relayune जारी रखने के लिए अपना ईमेल सत्यापित करें",
      preview: `यह लिंक ${expiresMinutes} मिनट में समाप्त हो जाएगा और केवल एक बार उपयोग किया जा सकता है।`,
      title: "अपना ईमेल सत्यापित करें",
      intro:
        "हमें इस ईमेल पते से Relayune में साइन इन करने का अनुरोध मिला है। अपना साइन-इन पासवर्ड सेट या रीसेट करने के लिए ईमेल सत्यापित करें।",
      action: "ईमेल सत्यापित करें",
      securityTitle: "यह एक सुरक्षित, एक बार उपयोग होने वाला लिंक है",
      securityDetail: `लिंक ${expiresMinutes} मिनट में समाप्त हो जाएगा और केवल एक बार उपयोग किया जा सकता है। Relayune ईमेल में कभी भी आपका पासवर्ड या 8-वर्ण का कनेक्शन कोड नहीं मांगेगा।`,
      fallback:
        "बटन नहीं खुल रहा? यह लिंक कॉपी करके अपने ब्राउज़र में पेस्ट करें:",
      ignore:
        "यदि आपने यह अनुरोध नहीं किया है, तो इस ईमेल को अनदेखा कर सकते हैं। सत्यापन लिंक खोले बिना आपके खाते में कोई बदलाव नहीं होगा।",
      footer: "यह स्वचालित खाता-सुरक्षा ईमेल Relayune ने भेजा है।",
    },
    es: {
      subject: "Verifica tu correo para continuar con Relayune",
      preview: `Este enlace caduca en ${expiresMinutes} minutos y solo puede usarse una vez.`,
      title: "Verifica tu correo electrónico",
      intro:
        "Recibimos una solicitud para iniciar sesión en Relayune con esta dirección. Verifica tu correo para establecer o restablecer tu contraseña.",
      action: "Verificar correo",
      securityTitle: "Este es un enlace seguro de un solo uso",
      securityDetail: `El enlace caduca en ${expiresMinutes} minutos y solo puede usarse una vez. Relayune nunca te pedirá por correo tu contraseña ni el código de conexión de 8 caracteres.`,
      fallback:
        "¿El botón no funciona? Copia y pega este enlace en tu navegador:",
      ignore:
        "Si no solicitaste este correo, puedes ignorarlo. Tu cuenta no cambiará a menos que abras el enlace de verificación.",
      footer:
        "Relayune envió automáticamente este correo de seguridad de la cuenta.",
    },
    ar: {
      subject: "تحقّق من بريدك الإلكتروني للمتابعة مع Relayune",
      preview: `تنتهي صلاحية هذا الرابط خلال ${expiresMinutes} دقائق ولا يمكن استخدامه إلا مرة واحدة.`,
      title: "تحقّق من بريدك الإلكتروني",
      intro:
        "تلقّينا طلبًا لاستخدام هذا البريد لتسجيل الدخول إلى Relayune. تحقّق من بريدك لتعيين كلمة مرور تسجيل الدخول أو إعادة تعيينها.",
      action: "تحقّق من البريد",
      securityTitle: "هذا رابط آمن للاستخدام مرة واحدة",
      securityDetail: `تنتهي صلاحية الرابط خلال ${expiresMinutes} دقائق ولا يمكن استخدامه إلا مرة واحدة. لن يطلب Relayune أبدًا كلمة مرورك أو رمز الاتصال المكوّن من 8 محارف عبر البريد الإلكتروني.`,
      fallback: "ألا يعمل الزر؟ انسخ هذا الرابط والصقه في متصفحك:",
      ignore:
        "إذا لم تطلب هذا البريد، فيمكنك تجاهله بأمان. لن يتغيّر حسابك ما لم تفتح رابط التحقّق.",
      footer: "أرسل Relayune رسالة أمان الحساب هذه تلقائيًا.",
    },
    fr: {
      subject: "Vérifiez votre e-mail pour continuer avec Relayune",
      preview: `Ce lien expire dans ${expiresMinutes} minutes et ne peut être utilisé qu’une fois.`,
      title: "Vérifiez votre adresse e-mail",
      intro:
        "Nous avons reçu une demande de connexion à Relayune avec cette adresse. Vérifiez votre e-mail pour définir ou réinitialiser votre mot de passe.",
      action: "Vérifier l’e-mail",
      securityTitle: "Ce lien sécurisé est à usage unique",
      securityDetail: `Le lien expire dans ${expiresMinutes} minutes et ne peut être utilisé qu’une fois. Relayune ne vous demandera jamais votre mot de passe ni le code de connexion à 8 caractères par e-mail.`,
      fallback:
        "Le bouton ne fonctionne pas ? Copiez ce lien dans votre navigateur :",
      ignore:
        "Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail. Votre compte ne changera pas tant que le lien de vérification n’est pas ouvert.",
      footer:
        "Cet e-mail automatique de sécurité du compte a été envoyé par Relayune.",
    },
    bn: {
      subject: "Relayune ব্যবহার চালিয়ে যেতে আপনার ইমেল যাচাই করুন",
      preview: `এই লিঙ্কটির মেয়াদ ${expiresMinutes} মিনিটে শেষ হবে এবং এটি শুধু একবার ব্যবহার করা যাবে।`,
      title: "আপনার ইমেল যাচাই করুন",
      intro:
        "এই ইমেল ঠিকানা দিয়ে Relayune-এ সাইন ইন করার অনুরোধ পেয়েছি। সাইন-ইন পাসওয়ার্ড সেট বা রিসেট করতে ইমেল যাচাই করুন।",
      action: "ইমেল যাচাই করুন",
      securityTitle: "এটি একটি নিরাপদ, একবার ব্যবহারযোগ্য লিঙ্ক",
      securityDetail: `লিঙ্কটির মেয়াদ ${expiresMinutes} মিনিটে শেষ হবে এবং এটি শুধু একবার ব্যবহার করা যাবে। Relayune কখনও ইমেলে আপনার পাসওয়ার্ড বা ৮-অক্ষরের সংযোগ কোড চাইবে না।`,
      fallback: "বোতামটি কাজ করছে না? লিঙ্কটি কপি করে ব্রাউজারে পেস্ট করুন:",
      ignore:
        "আপনি এই ইমেলটি না চাইলে নিরাপদে উপেক্ষা করতে পারেন। যাচাই লিঙ্ক না খোলা পর্যন্ত আপনার অ্যাকাউন্টে কোনো পরিবর্তন হবে না।",
      footer:
        "Relayune স্বয়ংক্রিয়ভাবে এই অ্যাকাউন্ট-নিরাপত্তা ইমেলটি পাঠিয়েছে।",
    },
    pt: {
      subject: "Verifique seu e-mail para continuar no Relayune",
      preview: `Este link expira em ${expiresMinutes} minutos e só pode ser usado uma vez.`,
      title: "Verifique seu e-mail",
      intro:
        "Recebemos uma solicitação para entrar no Relayune com este endereço. Verifique seu e-mail para definir ou redefinir sua senha.",
      action: "Verificar e-mail",
      securityTitle: "Este é um link seguro de uso único",
      securityDetail: `O link expira em ${expiresMinutes} minutos e só pode ser usado uma vez. O Relayune nunca pedirá por e-mail sua senha nem o código de conexão de 8 caracteres.`,
      fallback: "O botão não funciona? Copie e cole este link no navegador:",
      ignore:
        "Se você não solicitou este e-mail, pode ignorá-lo. Sua conta não será alterada a menos que o link de verificação seja aberto.",
      footer:
        "Este e-mail automático de segurança da conta foi enviado pelo Relayune.",
    },
    id: {
      subject: "Verifikasi email untuk melanjutkan dengan Relayune",
      preview: `Tautan ini kedaluwarsa dalam ${expiresMinutes} menit dan hanya dapat digunakan sekali.`,
      title: "Verifikasi email Anda",
      intro:
        "Kami menerima permintaan untuk masuk ke Relayune dengan alamat ini. Verifikasi email untuk membuat atau mengatur ulang kata sandi.",
      action: "Verifikasi email",
      securityTitle: "Ini adalah tautan aman sekali pakai",
      securityDetail: `Tautan kedaluwarsa dalam ${expiresMinutes} menit dan hanya dapat digunakan sekali. Relayune tidak akan pernah meminta kata sandi atau kode koneksi 8 karakter melalui email.`,
      fallback:
        "Tombol tidak berfungsi? Salin dan tempel tautan ini ke browser:",
      ignore:
        "Jika Anda tidak meminta email ini, abaikan saja. Akun tidak akan berubah kecuali tautan verifikasi dibuka.",
      footer: "Email keamanan akun otomatis ini dikirim oleh Relayune.",
    },
    ur: {
      subject: "Relayune جاری رکھنے کے لیے اپنی ای میل کی تصدیق کریں",
      preview: `یہ لنک ${expiresMinutes} منٹ میں ختم ہو جائے گا اور صرف ایک بار استعمال ہو سکتا ہے۔`,
      title: "اپنی ای میل کی تصدیق کریں",
      intro:
        "ہمیں اس ای میل سے Relayune میں سائن اِن کرنے کی درخواست ملی ہے۔ اپنا سائن اِن پاس ورڈ مقرر یا ری سیٹ کرنے کے لیے ای میل کی تصدیق کریں۔",
      action: "ای میل کی تصدیق کریں",
      securityTitle: "یہ ایک محفوظ، ایک بار استعمال ہونے والا لنک ہے",
      securityDetail: `لنک ${expiresMinutes} منٹ میں ختم ہو جائے گا اور صرف ایک بار استعمال ہو سکتا ہے۔ Relayune کبھی بھی ای میل میں آپ کا پاس ورڈ یا 8 حروف والا کنکشن کوڈ نہیں مانگے گا۔`,
      fallback:
        "بٹن کام نہیں کر رہا؟ یہ لنک کاپی کر کے اپنے براؤزر میں پیسٹ کریں:",
      ignore:
        "اگر آپ نے یہ درخواست نہیں کی تو اس ای میل کو نظر انداز کر سکتے ہیں۔ تصدیقی لنک کھولے بغیر آپ کے اکاؤنٹ میں کوئی تبدیلی نہیں ہو گی۔",
      footer: "یہ خودکار اکاؤنٹ سکیورٹی ای میل Relayune نے بھیجی ہے۔",
    },
  };
  return copies[locale];
}

export function emailLocale(
  requested: unknown,
  acceptLanguage: string | string[] | undefined,
): EmailLocale {
  const requestedLocale = normalizeEmailLocale(requested);
  if (requestedLocale) return requestedLocale;
  const header = Array.isArray(acceptLanguage)
    ? acceptLanguage.join(",")
    : acceptLanguage || "";
  const preferences = header
    .split(",")
    .map((entry, index) => {
      const [tag = "", ...parameters] = entry.trim().split(";");
      return {
        tag,
        quality: acceptLanguageQuality(parameters),
        index,
      };
    })
    .filter((entry) => entry.quality > 0)
    .sort(
      (left, right) => right.quality - left.quality || left.index - right.index,
    );
  for (const preference of preferences) {
    const locale = normalizeEmailLocale(preference.tag);
    if (locale) return locale;
  }
  return "en";
}

function acceptLanguageQuality(parameters: string[]): number {
  const qualityParameter = parameters
    .map((parameter) => parameter.trim())
    .find((parameter) => /^q=/i.test(parameter));
  if (qualityParameter === undefined) return 1;
  const match = qualityParameter.match(/^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i);
  return match ? Number(match[1]) : 0;
}

function normalizeEmailLocale(value: unknown): EmailLocale | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replaceAll("_", "-").toLowerCase();
  if (!normalized || normalized === "*") return null;
  if (
    normalized === "zh" ||
    normalized === "zh-cn" ||
    normalized === "zh-hans" ||
    normalized.startsWith("zh-hans-")
  ) {
    return "zh-CN";
  }
  if (normalized.startsWith("zh-")) return null;
  const language = normalized.split("-", 1)[0];
  return (
    EMAIL_LOCALES.find((locale) => locale.toLowerCase() === language) ?? null
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function encodeMessageHeader(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function encodeMessageBody(value: string) {
  return (
    Buffer.from(value, "utf8")
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") || ""
  );
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_AUTH_BODY_BYTES) {
      const error = new Error(
        "Authentication request is too large.",
      ) as Error & {
        status?: number;
      };
      error.status = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    const error = new Error(
      "Authentication request is invalid JSON.",
    ) as Error & {
      status?: number;
    };
    error.status = 400;
    throw error;
  }
}

function requireSameOrigin(request: IncomingMessage, publicOrigin: string) {
  const expected = new URL(publicOrigin).origin;
  const provided =
    String(request.headers.origin || "") ||
    safeOrigin(String(request.headers.referer || ""));
  if (provided !== expected) {
    const error = new Error(
      "Authentication request origin is invalid.",
    ) as Error & {
      status?: number;
    };
    error.status = 403;
    throw error;
  }
}

function safeOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function clientAddress(request: IncomingMessage) {
  const realAddress = String(request.headers["x-real-ip"] || "").trim();
  if (realAddress) return realAddress;
  const forwarded = String(request.headers["x-forwarded-for"] || "")
    .split(",")
    .at(-1)
    ?.trim();
  if (forwarded) return forwarded;
  return request.socket.remoteAddress || "unknown";
}

function mailDeliveryError(cause: unknown, transport: "smtp" | "sendmail") {
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? String(cause.code || "").toUpperCase()
      : "";
  const category =
    code === "EAUTH"
      ? "authentication_failed"
      : code === "EENVELOPE"
        ? "recipient_rejected"
        : [
              "ECONNECTION",
              "ECONNREFUSED",
              "EDNS",
              "ESOCKET",
              "ETIMEDOUT",
            ].includes(code)
          ? "connection_failed"
          : "transport_failed";
  const error = new Error(`${transport}_${category}`) as Error & {
    status?: number;
    code?: string;
    publicMessage?: string;
  };
  error.status = 503;
  error.code = "mail_delivery_failed";
  error.publicMessage = "登录邮件暂时无法发送，请稍后重试。";
  return error;
}

function cookieValue(request: IncomingMessage, name: string) {
  for (const part of String(request.headers.cookie || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}

function sessionCookie(token: string) {
  return [
    `relay_session=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${WEB_SESSION_TTL_MS / 1_000}`,
  ].join("; ");
}

function setupCookie(token: string) {
  return [
    `relay_setup=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${MAGIC_LINK_TTL_MS / 1_000}`,
  ].join("; ");
}

function clearCookie(name: "relay_session" | "relay_setup") {
  return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function sendAuthError(response: ServerResponse) {
  sendJson(response, 400, {
    error: {
      code: "invalid_magic_link",
      message: "登录链接无效、已使用或已过期。",
    },
  });
}

function sendSetupError(response: ServerResponse) {
  sendJson(
    response,
    401,
    {
      error: {
        code: "invalid_password_setup",
        message: "邮箱验证已失效，请返回后重新验证。",
      },
    },
    { "Set-Cookie": clearCookie("relay_setup") },
  );
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string | string[]> = {},
) {
  recordResponseError(body, status);
  const content = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(content),
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(content);
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidEmail(email: string) {
  return Boolean(email && EMAIL_PATTERN.test(email) && email.length <= 320);
}

function requireEmail(value: unknown) {
  const email = normalizeEmail(value);
  if (!isValidEmail(email)) {
    throw badAuthRequest("请输入有效的邮箱地址。");
  }
  return email;
}

function parsePassword(value: unknown, enforceStrength: boolean) {
  if (
    typeof value !== "string" ||
    value.length > PASSWORD_MAX_LENGTH ||
    (enforceStrength && value.length < PASSWORD_MIN_LENGTH)
  ) {
    throw badAuthRequest(
      enforceStrength
        ? `密码需要至少 ${PASSWORD_MIN_LENGTH} 个字符。`
        : "邮箱或密码不正确。",
    );
  }
  return value;
}

function parsePairingContinuation(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !PAIRING_ID_PATTERN.test(value)) {
    throw badAuthRequest("Desktop pairing continuation is invalid.");
  }
  return value;
}

function parseDesktopLoginContinuation(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !DESKTOP_LOGIN_ID_PATTERN.test(value)) {
    throw badAuthRequest("Desktop login continuation is invalid.");
  }
  return value;
}

function parseAccountReturnPath(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (value !== ACCOUNT_RETURN_PATH) {
    throw badAuthRequest("Account return path is invalid.");
  }
  return ACCOUNT_RETURN_PATH;
}

function requireSingleContinuation(
  pairingId: string | null,
  desktopLoginId: string | null,
) {
  if (pairingId && desktopLoginId) {
    throw badAuthRequest("Only one desktop continuation is allowed.");
  }
}

function badAuthRequest(message: string) {
  const error = new Error(message) as Error & {
    status?: number;
    publicMessage?: string;
  };
  error.status = 400;
  error.publicMessage = message;
  return error;
}

function authGeneration(value: unknown): number | null {
  // Only an absent field is legacy generation zero. Explicit null, strings,
  // fractions, negatives and unsafe integers must never regain authority.
  if (value === undefined) return 0;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("PUBLIC_ORIGIN must use HTTPS.");
  }
  return url.origin;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
