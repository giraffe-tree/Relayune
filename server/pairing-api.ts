import { markAuthenticatedDevice, markBrowserAuthorization } from "./request-log.mjs";
import { clientVersion } from "./client-version";
import { LOCAL_ACCOUNT_ID } from "./local-accounts";
import { createHash, randomBytes } from "node:crypto";
import type { Collection, Db } from "mongodb";

const PAIRING_TTL_MS = 10 * 60_000;
const DESKTOP_LOGIN_TTL_MS = 10 * 60_000;
const MAX_BODY_BYTES = 16 * 1024;
const PROTOCOL = "SPAKE2-P256-SHA256-HKDF-HMAC";
const PAIRING_ID_PATTERN = /^pair_[A-Za-z0-9_-]{43}$/;
const DESKTOP_LOGIN_ID_PATTERN = /^dlogin_[A-Za-z0-9_-]{43}$/;
const DEVICE_ID_PATTERN = /^dev_[a-f0-9]{32}$/;
const BROWSER_ID_PATTERN = /^web_[a-f0-9]{32}$/;
const SHARE_PATTERN = /^[A-Za-z0-9_-]{87}$/;
const CONFIRMATION_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,512}$/;
const KEY_ID_PATTERN = /^sha256:[A-Za-z0-9_-]{43}$/;

type PairingMode = "initial" | "browser";

type PairingDocument = {
  _id: string;
  protocol: typeof PROTOCOL;
  mode: PairingMode;
  initiator_share: string;
  responder_share: string | null;
  responder_confirm: string | null;
  desktop_confirm: string | null;
  user_id: string | null;
  device_id: string | null;
  relay_token_hash: string | null;
  browser_id: string | null;
  browser_name: string | null;
  client_version?: string | null;
  browser_token_hash: string | null;
  browser_key_id: string | null;
  client_device_id?: string | null;
  status: "waiting" | "responded" | "paired";
  created_at: Date;
  expires_at: Date;
  responded_at: Date | null;
  paired_at: Date | null;
};

type RelayUserDocument = {
  _id: string;
  id: string;
  email: string;
  created_at: number;
  updated_at: number;
};

type RelayDeviceDocument = {
  _id: string;
  id: string;
  user_id: string;
  name: string;
  relay_token_hash: string;
  identity_public_key: string;
  encrypted_descriptor: null;
  key_epoch: number;
  protocol_version: number;
  ack_seq: number;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
};

type BrowserAuthorizationDocument = {
  client_device_id?: string | null;
  client_generation?: number;
  pairing_confirmed?: boolean;
  activated_at?: number;
  client_version?: string | null;
  _id: string;
  id: string;
  pairing_id?: string;
  device_id: string;
  user_id: string;
  name: string;
  token_hash: string;
  key_id: string;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
};

type DesktopLoginDocument = {
  _id: string;
  poll_secret_hash: string;
  relay_token_hash: string;
  device_id: string;
  device_name: string;
  status: "waiting" | "approving" | "approved";
  user_id: string | null;
  created_at: Date;
  expires_at: Date;
  approved_at: Date | null;
};

export class PairingApi {
  private realtime?: {
    revokeBrowser(deviceId: string, browserId: string): void;
  };

  constructor(private readonly db: Db) {}

  setRealtime(realtime: {
    revokeBrowser(deviceId: string, browserId: string): void;
  }) {
    this.realtime = realtime;
  }

  async initialize() {
    await Promise.all([
      this.pairings.createIndex(
        { expires_at: 1 },
        { expireAfterSeconds: 0, name: "relay_pake_pairings_expiry" },
      ),
      this.pairings.createIndex(
        { user_id: 1, created_at: -1 },
        { name: "relay_pake_pairings_user_idx" },
      ),
      this.browserAuthorizations.createIndex(
        { token_hash: 1 },
        { unique: true, name: "relay_browser_authorizations_token_uq" },
      ),
      this.browserAuthorizations.createIndex(
        { device_id: 1, revoked_at: 1, created_at: -1 },
        { name: "relay_browser_authorizations_device_idx" },
      ),
      this.browserAuthorizations.createIndex(
        { device_id: 1, client_device_id: 1, revoked_at: 1 },
        { name: "relay_browser_authorizations_client_idx" },
      ),
      this.browserAuthorizations.createIndex(
        { pairing_id: 1 },
        {
          unique: true,
          sparse: true,
          name: "relay_browser_authorizations_pairing_uq",
        },
      ),
      this.desktopLogins.createIndex(
        { expires_at: 1 },
        { expireAfterSeconds: 0, name: "relay_desktop_logins_expiry" },
      ),
      this.desktopLogins.createIndex(
        { poll_secret_hash: 1 },
        { unique: true, name: "relay_desktop_logins_poll_secret_uq" },
      ),
    ]);
  }

  async handle(
    request: Request,
    authenticatedEmail: string | null,
  ): Promise<Response | null> {
    const url = new URL(request.url);
    const isPairingRoute =
      url.pathname === "/api/pairings/start" ||
      url.pathname === "/api/relay/pairings/start" ||
      url.pathname.startsWith("/api/relay/pairings/") ||
      url.pathname.startsWith("/api/pairings/") ||
      url.pathname.startsWith("/api/browser/pairings/");
    const isBrowserAuthorizationRoute =
      url.pathname === "/api/browser/authorizations/revoke" ||
      url.pathname === "/api/relay/browser-authorizations" ||
      url.pathname.startsWith("/api/relay/browser-authorizations/");
    const isDesktopLoginRoute =
      url.pathname === "/api/desktop-login/start" ||
      url.pathname.startsWith("/api/desktop-login/");
    if (
      !isPairingRoute &&
      !isBrowserAuthorizationRoute &&
      !isDesktopLoginRoute
    ) {
      return null;
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: headers({
          Allow: "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers":
            "Authorization, Content-Type, X-Relay-Desktop-Login-Secret, X-Relay-Device-Token, X-Relay-Browser-Token",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        }),
      });
    }

    try {
      if (url.pathname === "/api/browser/authorizations/revoke") {
        if (request.method !== "POST") return json({ error: { code: "method_not_allowed" } }, 405);
        if (!authenticatedEmail) throw new PairingError(401, "unauthorized", "请先登录。");
        if (request.headers.get("origin") !== url.origin) throw new PairingError(403, "invalid_origin", "请求来源无效。");
        return await this.revokeOwnBrowserAuthorization(request, authenticatedEmail);
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/browser/pairings/activate"
      ) {
        if (!authenticatedEmail) {
          throw new PairingError(401, "unauthorized", "请先登录再连接这台电脑。");
        }
        return await this.activateClientDevice(request, authenticatedEmail);
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/desktop-login/start"
      ) {
        return await this.startDesktopLogin(request);
      }
      const desktopLoginApprovalMatch = url.pathname.match(
        /^\/api\/desktop-login\/(dlogin_[A-Za-z0-9_-]{43})\/approval$/,
      );
      if (request.method === "GET" && desktopLoginApprovalMatch) {
        if (!authenticatedEmail) {
          throw new PairingError(401, "unauthorized", "请先登录再连接这台电脑。");
        }
        return await this.readDesktopLoginApproval(
          desktopLoginApprovalMatch[1],
          authenticatedEmail,
        );
      }
      const desktopLoginApproveMatch = url.pathname.match(
        /^\/api\/desktop-login\/(dlogin_[A-Za-z0-9_-]{43})\/approve$/,
      );
      if (request.method === "POST" && desktopLoginApproveMatch) {
        if (!authenticatedEmail) {
          throw new PairingError(401, "unauthorized", "请先登录再连接这台电脑。");
        }
        return await this.approveDesktopLogin(
          desktopLoginApproveMatch[1],
          authenticatedEmail,
        );
      }
      const desktopLoginStatusMatch = url.pathname.match(
        /^\/api\/desktop-login\/(dlogin_[A-Za-z0-9_-]{43})$/,
      );
      if (request.method === "GET" && desktopLoginStatusMatch) {
        return await this.readDesktopLoginStatus(
          request,
          desktopLoginStatusMatch[1],
        );
      }
      const desktopLoginCancelMatch = url.pathname.match(
        /^\/api\/desktop-login\/(dlogin_[A-Za-z0-9_-]{43})\/cancel$/,
      );
      if (request.method === "POST" && desktopLoginCancelMatch) {
        return await this.cancelDesktopLogin(
          request,
          desktopLoginCancelMatch[1],
        );
      }
      if (request.method === "POST" && url.pathname === "/api/pairings/start") {
        return await this.startInitial(request);
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/relay/pairings/start"
      ) {
        return await this.startBrowser(request);
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/browser/pairings/pending"
      ) {
        if (!authenticatedEmail) {
          throw new PairingError(401, "unauthorized", "请先登录再连接这台电脑。");
        }
        return await this.listPendingBrowserPairings(authenticatedEmail);
      }
      const cancelBrowserPairingMatch = url.pathname.match(
        /^\/api\/relay\/pairings\/(pair_[A-Za-z0-9_-]{43})\/cancel$/,
      );
      if (request.method === "POST" && cancelBrowserPairingMatch) {
        return await this.cancelBrowserPairing(
          request,
          cancelBrowserPairingMatch[1],
        );
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/relay/browser-authorizations"
      ) {
        return await this.listBrowserAuthorizations(request);
      }
      const revokeMatch = url.pathname.match(
        /^\/api\/relay\/browser-authorizations\/(web_[a-f0-9]{32})\/revoke$/,
      );
      if (request.method === "POST" && revokeMatch) {
        return await this.revokeBrowserAuthorization(request, revokeMatch[1]);
      }

      const desktopMatch = url.pathname.match(
        /^\/api\/pairings\/(pair_[A-Za-z0-9_-]{43})(?:\/complete)?$/,
      );
      if (request.method === "GET" && desktopMatch) {
        return await this.read(desktopMatch[1]);
      }
      if (
        request.method === "POST" &&
        desktopMatch &&
        url.pathname.endsWith("/complete")
      ) {
        return await this.complete(request, desktopMatch[1]);
      }

      const browserMatch = url.pathname.match(
        /^\/api\/browser\/pairings\/(pair_[A-Za-z0-9_-]{43})\/respond$/,
      );
      if (request.method === "POST" && browserMatch) {
        if (!authenticatedEmail) {
          throw new PairingError(401, "unauthorized", "请先登录再连接这台电脑。");
        }
        return await this.respond(request, browserMatch[1], authenticatedEmail);
      }

      throw new PairingError(404, "not_found", "配对请求不存在。");
    } catch (error) {
      if (error instanceof PairingError) {
        return json(
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }
      return json(
        {
          error: {
            code: "pairing_failed",
            message: "无法完成安全连接，请在桌面端重新开始。",
          },
        },
        500,
      );
    }
  }

  private async startInitial(request: Request) {
    const body = await readJson(request);
    return this.insertPairing(body, "initial", null);
  }

  private async startDesktopLogin(request: Request) {
    const body = await readJson(request);
    const relayTokenHash = requireEncoded(
      body.relay_token_hash,
      TOKEN_HASH_PATTERN,
      "relay_token_hash",
    );
    const deviceName = requireName(
      body.name,
      "这台 Mac",
      "设备名称无效。",
    );
    const requestId = `dlogin_${randomBytes(32).toString("base64url")}`;
    const pollSecret = randomBytes(32).toString("base64url");
    const deviceId = `dev_${randomBytes(16).toString("hex")}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + DESKTOP_LOGIN_TTL_MS);
    await this.desktopLogins.insertOne({
      _id: requestId,
      poll_secret_hash: sha256(pollSecret),
      relay_token_hash: relayTokenHash,
      device_id: deviceId,
      device_name: deviceName,
      status: "waiting",
      user_id: null,
      created_at: now,
      expires_at: expiresAt,
      approved_at: null,
    });
    return json(
      {
        request_id: requestId,
        poll_secret: pollSecret,
        status: "waiting",
        expires_at: expiresAt.toISOString(),
      },
      201,
    );
  }

  private async readDesktopLoginApproval(requestId: string, email: string) {
    requireDesktopLoginId(requestId);
    const login = await this.desktopLogins.findOne({
      _id: requestId,
      expires_at: { $gt: new Date() },
    });
    if (!login) {
      throw new PairingError(
        404,
        "desktop_login_expired",
        "这次电脑登录已失效，请回到 Relayune 重新开始。",
      );
    }
    const user = await this.ensureUser(email);
    if (login.user_id && login.user_id !== user.id) {
      throw new PairingError(
        409,
        "desktop_login_account_mismatch",
        "这台电脑已由另一个账户确认。",
      );
    }
    return json({
      request_id: login._id,
      device_name: login.device_name,
      status: login.status === "approved" ? "approved" : "waiting",
      ...await this.accountDisplay(user.email),
      expires_at: login.expires_at.toISOString(),
    });
  }

  private async approveDesktopLogin(requestId: string, email: string) {
    requireDesktopLoginId(requestId);
    const user = await this.ensureUser(email);
    const now = new Date();
    let login = await this.desktopLogins.findOne({
      _id: requestId,
      expires_at: { $gt: now },
    });
    if (!login) {
      throw new PairingError(
        404,
        "desktop_login_expired",
        "这次电脑登录已失效，请回到 Relayune 重新开始。",
      );
    }
    if (login.user_id && login.user_id !== user.id) {
      throw new PairingError(
        409,
        "desktop_login_account_mismatch",
        "这台电脑已由另一个账户确认。",
      );
    }
    if (login.status === "waiting") {
      await this.desktopLogins.updateOne(
        {
          _id: requestId,
          status: "waiting",
          user_id: null,
          expires_at: { $gt: now },
        },
        { $set: { status: "approving", user_id: user.id } },
      );
      login = await this.desktopLogins.findOne({
        _id: requestId,
        expires_at: { $gt: now },
      });
    }
    if (!login || login.user_id !== user.id) {
      throw new PairingError(
        409,
        "desktop_login_already_used",
        "这次电脑登录已由其他请求使用。",
      );
    }
    await this.devices.updateOne(
      { _id: login.device_id },
      {
        $setOnInsert: {
          _id: login.device_id,
          id: login.device_id,
          user_id: user.id,
          name: login.device_name,
          relay_token_hash: login.relay_token_hash,
          identity_public_key: JSON.stringify({
            mode: "desktop-web-login-v1",
          }),
          encrypted_descriptor: null,
          key_epoch: 1,
          protocol_version: 2,
          ack_seq: 0,
          created_at: now.getTime(),
          last_seen_at: null,
          revoked_at: null,
        },
      },
      { upsert: true },
    );
    const approved = await this.desktopLogins.updateOne(
      {
        _id: requestId,
        user_id: user.id,
        status: { $in: ["approving", "approved"] },
        expires_at: { $gt: now },
      },
      { $set: { status: "approved", approved_at: now } },
    );
    if (approved.modifiedCount !== 1) {
      await this.devices.updateOne(
        { _id: login.device_id, relay_token_hash: login.relay_token_hash },
        { $set: { revoked_at: now.getTime(), last_seen_at: null } },
      );
      throw new PairingError(
        409,
        "desktop_login_already_used",
        "这次电脑登录已被取消或使用。",
      );
    }
    return json({
      request_id: requestId,
      device_name: login.device_name,
      status: "approved",
      ...await this.accountDisplay(user.email),
      expires_at: login.expires_at.toISOString(),
    });
  }

  private async readDesktopLoginStatus(request: Request, requestId: string) {
    requireDesktopLoginId(requestId);
    const pollSecret = requireDesktopLoginPollSecret(request);
    const login = await this.desktopLogins.findOne({
      _id: requestId,
      poll_secret_hash: sha256(pollSecret),
      expires_at: { $gt: new Date() },
    });
    if (!login) {
      throw new PairingError(
        404,
        "desktop_login_expired",
        "这次电脑登录已失效，请重新开始。",
      );
    }
    const account =
      login.status === "approved" && login.user_id
        ? await this.users.findOne({ _id: login.user_id })
        : null;
    if (login.status === "approved" && !account) {
      throw new PairingError(
        500,
        "desktop_login_account_missing",
        "无法读取这次电脑登录对应的账户。",
      );
    }
    return json({
      request_id: login._id,
      status: login.status === "approved" ? "approved" : "waiting",
      device_id: login.status === "approved" ? login.device_id : null,
      ...(account ? await this.accountDisplay(account.email) : { account_email: null }),
      expires_at: login.expires_at.toISOString(),
    });
  }

  private async cancelDesktopLogin(request: Request, requestId: string) {
    requireDesktopLoginId(requestId);
    const pollSecret = requireDesktopLoginPollSecret(request);
    const login = await this.desktopLogins.findOneAndDelete({
      _id: requestId,
      poll_secret_hash: sha256(pollSecret),
    });
    if (login) {
      await this.devices.updateOne(
        {
          _id: login.device_id,
          relay_token_hash: login.relay_token_hash,
          revoked_at: null,
        },
        { $set: { revoked_at: Date.now(), last_seen_at: null } },
      );
    }
    return new Response(null, { status: 204, headers: headers() });
  }

  private async startBrowser(request: Request) {
    const device = await this.requireRelayDevice(request);
    const body = await readJson(request);
    return this.insertPairing(body, "browser", device);
  }

  private async listPendingBrowserPairings(email: string) {
    const user = await this.ensureUser(email);
    const now = new Date();
    const [boundDevice, pending] = await Promise.all([
      this.devices.findOne({ user_id: user.id, revoked_at: null }),
      this.pairings
        .find({
          mode: "browser",
          user_id: user.id,
          status: "waiting",
          expires_at: { $gt: now },
        })
        .sort({ created_at: -1 })
        .limit(20)
        .toArray(),
    ]);
    const deviceIds = [
      ...new Set(
        pending
          .map((pairing) => pairing.device_id)
          .filter((deviceId): deviceId is string => Boolean(deviceId)),
      ),
    ];
    const devices = await Promise.all(
      deviceIds.map((deviceId) =>
        this.devices.findOne({
          _id: deviceId,
          user_id: user.id,
          revoked_at: null,
        }),
      ),
    );
    const deviceNames = new Map(
      devices
        .filter((device): device is RelayDeviceDocument => Boolean(device))
        .map((device) => [device.id, device.name]),
    );

    return json({
      has_bound_computer: Boolean(boundDevice),
      pairings: pending.flatMap((pairing) => {
        const deviceId = pairing.device_id;
        const deviceName = deviceId ? deviceNames.get(deviceId) : null;
        if (!deviceId || !deviceName) return [];
        return [
          {
            pairing_id: pairing._id,
            device_id: deviceId,
            device_name: deviceName,
            expires_at: pairing.expires_at.toISOString(),
          },
        ];
      }),
    });
  }

  private async cancelBrowserPairing(request: Request, pairingId: string) {
    const device = await this.requireRelayDevice(request);
    requirePairingId(pairingId);
    await this.pairings.deleteOne({
      _id: pairingId,
      mode: "browser",
      device_id: device.id,
      user_id: device.user_id,
      status: { $in: ["waiting", "responded"] },
    });
    // Cancellation is deliberately idempotent. A late Desktop cleanup may
    // arrive after an earlier cleanup or after the pairing has already become
    // paired; neither case should disclose state or remove an authorization.
    return new Response(null, { status: 204, headers: headers() });
  }

  private async insertPairing(
    body: Record<string, unknown>,
    mode: PairingMode,
    device: RelayDeviceDocument | null,
  ) {
    const pairingId = requirePairingId(body.pairing_id);
    const initiatorShare = requireEncoded(
      body.initiator_share,
      SHARE_PATTERN,
      "initiator_share",
    );
    if (body.protocol !== PROTOCOL) {
      throw new PairingError(
        409,
        "protocol_unsupported",
        "当前版本不支持这套安全连接协议。",
      );
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
    try {
      await this.pairings.insertOne({
        _id: pairingId,
        protocol: PROTOCOL,
        mode,
        initiator_share: initiatorShare,
        responder_share: null,
        responder_confirm: null,
        desktop_confirm: null,
        user_id: device?.user_id ?? null,
        device_id: device?.id ?? null,
        relay_token_hash: null,
        browser_id: null,
        browser_name: null,
        browser_token_hash: null,
        browser_key_id: null,
        status: "waiting",
        created_at: now,
        expires_at: expiresAt,
        responded_at: null,
        paired_at: null,
      });
    } catch (error) {
      if (isDuplicate(error)) {
        throw new PairingError(
          409,
          "pairing_exists",
          "这次连接已经开始，请勿重复提交。",
        );
      }
      throw error;
    }
    return json(
      {
        pairing_id: pairingId,
        protocol: PROTOCOL,
        mode,
        status: "waiting",
        expires_at: expiresAt.toISOString(),
      },
      201,
    );
  }

  private async read(pairingId: string) {
    requirePairingId(pairingId);
    const pairing = await this.pairings.findOne({
      _id: pairingId,
      expires_at: { $gt: new Date() },
    });
    if (!pairing) {
      throw new PairingError(
        404,
        "pairing_expired",
        "连接码已过期，请在桌面端重新开始。",
      );
    }
    return json({
      pairing_id: pairing._id,
      protocol: pairing.protocol,
      mode: pairing.mode,
      status: pairing.status,
      initiator_share: pairing.initiator_share,
      responder_share: pairing.responder_share,
      responder_confirm: pairing.responder_confirm,
      desktop_confirm: pairing.desktop_confirm,
      device_id: pairing.device_id,
      browser_id: pairing.browser_id,
      expires_at: pairing.expires_at.toISOString(),
    });
  }

  private async respond(
    request: Request,
    pairingId: string,
    email: string,
  ) {
    const body = await readJson(request);
    const responderShare = requireEncoded(
      body.responder_share,
      SHARE_PATTERN,
      "responder_share",
    );
    const responderConfirm = requireEncoded(
      body.responder_confirm,
      CONFIRMATION_PATTERN,
      "responder_confirm",
    );
    const browserTokenHash = requireEncoded(
      body.browser_token_hash,
      TOKEN_HASH_PATTERN,
      "browser_token_hash",
    );
    const browserKeyId = requireEncoded(
      body.browser_key_id,
      KEY_ID_PATTERN,
      "browser_key_id",
    );
    const browserName = requireName(
      body.browser_name,
      "此浏览器",
      "浏览器名称无效。",
    );
    if (body.protocol !== PROTOCOL) {
      throw new PairingError(
        409,
        "protocol_unsupported",
        "桌面端与网页版本不一致，请更新后重试。",
      );
    }
    const user = await this.ensureUser(email);
    const existing = await this.pairings.findOne({
      _id: pairingId,
      status: "waiting",
      expires_at: { $gt: new Date() },
    });
    if (!existing) {
      throw new PairingError(
        409,
        "pairing_already_used",
        "这次连接已被使用或已过期，请在桌面端重新开始。",
      );
    }
    if (existing.mode === "browser" && existing.user_id !== user.id) {
      throw new PairingError(
        403,
        "pairing_account_mismatch",
        "请使用与这台电脑相同的邮箱账户登录。",
      );
    }
    const browserId = `web_${randomBytes(16).toString("hex")}`;
    // A client identity groups authorizations; it never authenticates a request.
    // Scope the digest to this account and Mac, without storing the source ID.
    const identity = body.client_identity;
    if (identity !== undefined && (typeof identity !== "string" || !/^(android|ios|web):[a-f0-9]{64}$/.test(identity))) {
      throw new PairingError(400, "invalid_client_identity", "设备标识无效。");
    }
    const clientDeviceId = typeof identity === "string"
      ? `client_${sha256(JSON.stringify(["relayune-client-v1", user.id, identity]))}`
      : null;
    const now = new Date();
    const result = await this.pairings.updateOne(
      {
        _id: pairingId,
        status: "waiting",
        user_id: existing.mode === "initial" ? null : user.id,
        expires_at: { $gt: now },
      },
      {
        $set: {
          user_id: user.id,
          responder_share: responderShare,
          responder_confirm: responderConfirm,
          browser_id: browserId,
          client_device_id: clientDeviceId,
          browser_name: browserName,
          client_version: clientVersion(request),
          browser_token_hash: browserTokenHash,
          browser_key_id: browserKeyId,
          status: "responded",
          responded_at: now,
        },
      },
    );
    if (result.modifiedCount !== 1) {
      throw new PairingError(
        409,
        "pairing_already_used",
        "这次连接已被使用或已过期，请在桌面端重新开始。",
      );
    }
    return json({
      accepted: true,
      pairing_id: pairingId,
      browser_id: browserId,
      status: "responded",
    });
  }

  private async complete(request: Request, pairingId: string) {
    const body = await readJson(request);
    const desktopConfirm = requireEncoded(
      body.desktop_confirm,
      CONFIRMATION_PATTERN,
      "desktop_confirm",
    );
    const existing = await this.pairings.findOne({
      _id: pairingId,
      expires_at: { $gt: new Date() },
    });
    if (
      existing?.status === "paired" &&
      existing.desktop_confirm === desktopConfirm &&
      existing.device_id &&
      existing.browser_id
    ) {
      await this.browserAuthorizations.updateOne(
        { _id: existing.browser_id, pairing_id: pairingId },
        { $set: { pairing_confirmed: true } },
      );
      return json({
        paired: true,
        pairing_id: pairingId,
        device_id: existing.device_id,
        browser_id: existing.browser_id,
      });
    }
    if (
      !existing ||
      existing.status !== "responded" ||
      !existing.user_id ||
      !existing.responder_share ||
      !existing.responder_confirm ||
      !existing.browser_id ||
      !existing.browser_name ||
      !existing.browser_token_hash ||
      !existing.browser_key_id
    ) {
      throw new PairingError(
        409,
        "pairing_not_ready",
        "网页尚未确认连接，或连接码已经失效。",
      );
    }

    const relayTokenHash =
      existing.mode === "initial"
        ? requireEncoded(
            body.relay_token_hash,
            TOKEN_HASH_PATTERN,
            "relay_token_hash",
          )
        : null;
    const deviceName =
      existing.mode === "initial"
        ? requireName(body.name, "这台电脑", "设备名称无效。")
        : null;
    const deviceId =
      existing.mode === "initial"
        ? `dev_${randomBytes(16).toString("hex")}`
        : requireDeviceId(existing.device_id);
    const now = Date.now();

    if (existing.mode === "initial") {
      await this.devices.insertOne({
        _id: deviceId,
        id: deviceId,
        user_id: existing.user_id,
        name: deviceName!,
        relay_token_hash: relayTokenHash!,
        identity_public_key: JSON.stringify({
          mode: "spake2-p256-sha256-hkdf-hmac",
        }),
        encrypted_descriptor: null,
        key_epoch: 1,
        protocol_version: 2,
        ack_seq: 0,
        created_at: now,
        last_seen_at: null,
        revoked_at: null,
      });
    }
    const clientDeviceId = existing.client_device_id
      ? `client_${sha256(JSON.stringify([deviceId, existing.client_device_id]))}` : null;
    try {
      // One persistent device record, with a monotonic authorization generation.
      // Gaps after failed pairings are harmless; authorization is never granted here.
      const client = clientDeviceId ? await this.db.collection<{
        _id: string; device_id: string; user_id: string; generation: number; created_at: number;
      }>("relay_client_devices").findOneAndUpdate(
        { _id: clientDeviceId },
        { $inc: { generation: 1 }, $setOnInsert: {
          device_id: deviceId, user_id: existing.user_id, created_at: now,
        } },
        { upsert: true, returnDocument: "after" },
      ) : null;
      await this.browserAuthorizations.insertOne({
        _id: existing.browser_id,
        id: existing.browser_id,
        pairing_id: pairingId,
        device_id: deviceId,
        client_device_id: clientDeviceId,
        ...(client ? { client_generation: client.generation } : {}),
        user_id: existing.user_id,
        name: existing.browser_name,
        client_version: existing.client_version ?? null,
        token_hash: existing.browser_token_hash,
        key_id: existing.browser_key_id,
        created_at: now,
        last_seen_at: null,
        revoked_at: null,
      });
    } catch (error) {
      if (existing.mode === "initial") {
        await this.devices.deleteOne({ _id: deviceId });
      }
      throw error;
    }

    const paired = await this.pairings.updateOne(
      {
        _id: pairingId,
        status: "responded",
        expires_at: { $gt: new Date() },
      },
      {
        $set: {
          status: "paired",
          desktop_confirm: desktopConfirm,
          relay_token_hash: relayTokenHash,
          device_id: deviceId,
          paired_at: new Date(now),
        },
      },
    );
    if (paired.modifiedCount !== 1) {
      await this.browserAuthorizations.deleteOne({
        _id: existing.browser_id,
        pairing_id: pairingId,
      });
      if (existing.mode === "initial") {
        await this.devices.deleteOne({ _id: deviceId });
      }
      throw new PairingError(
        409,
        "pairing_already_used",
        "这次连接已被使用，请在桌面端重新开始。",
      );
    }
    await this.browserAuthorizations.updateOne(
      { _id: existing.browser_id, pairing_id: pairingId },
      { $set: { pairing_confirmed: true } },
    );
    return json(
      {
        paired: true,
        pairing_id: pairingId,
        device_id: deviceId,
        browser_id: existing.browser_id,
      },
      201,
    );
  }

  private async activateClientDevice(request: Request, email: string) {
    const token = request.headers.get("X-Relay-Browser-Token");
    if (!token || !TOKEN_PATTERN.test(token)) {
      throw new PairingError(401, "browser_unauthorized", "请重新扫码连接。");
    }
    const current = await this.browserAuthorizations.findOne({
      token_hash: sha256(token), revoked_at: null,
    });
    if (!current) throw new PairingError(401, "browser_unauthorized", "请重新扫码连接。");
    const ownerId = `usr_${sha256(email.trim().toLowerCase()).slice(0, 32)}`;
    if (current.user_id !== ownerId) {
      throw new PairingError(403, "pairing_account_mismatch", "请使用这台设备绑定的账户登录。");
    }
    const device = await this.devices.findOne({ _id: current.device_id, revoked_at: null });
    if (!device || device.user_id !== current.user_id) {
      throw new PairingError(401, "browser_unauthorized", "请重新扫码连接。");
    }
    markBrowserAuthorization();
    if (!current.client_device_id) return json({ activated: true });
    if (!current.pairing_confirmed) {
      throw new PairingError(409, "pairing_already_used", "请等待电脑完成授权。");
    }
    const siblings = await this.browserAuthorizations.find({
      device_id: current.device_id, user_id: current.user_id,
      client_device_id: current.client_device_id, revoked_at: null,
    }).toArray();
    // Total ordering prevents two concurrent activations from revoking each
    // other. An older request can never revoke a newer authorization.
    const olderThan = (left: BrowserAuthorizationDocument, right: BrowserAuthorizationDocument) =>
      (left.client_generation ?? 0) < (right.client_generation ?? 0);
    if (siblings.some(sibling => sibling.activated_at !== undefined && olderThan(current, sibling))) {
      throw new PairingError(409, "pairing_already_used", "此设备已有更新的连接，请重新打开应用。");
    }
    const now = Date.now();
    const activated = await this.browserAuthorizations.updateOne(
      { _id: current.id, revoked_at: null }, { $set: { activated_at: now } },
    );
    if (!activated.matchedCount) throw new PairingError(401, "browser_unauthorized", "请重新扫码连接。");
    for (const previous of siblings.filter(sibling => olderThan(sibling, current))) {
      await this.browserAuthorizations.updateOne(
        { _id: previous.id, revoked_at: null }, { $set: { revoked_at: now } },
      );
      this.realtime?.revokeBrowser(current.device_id, previous.id);
    }
    return json({ activated: true, client_device_id: current.client_device_id });
  }

  private async listBrowserAuthorizations(request: Request) {
    const device = await this.requireRelayDevice(request);
    const authorizations = await this.browserAuthorizations
      .find(
        { device_id: device.id, revoked_at: null },
        {
          projection: {
            _id: 0,
            id: 1,
            name: 1,
            key_id: 1,
            client_version: 1,
            client_device_id: 1,
            created_at: 1,
            last_seen_at: 1,
          },
        },
      )
      .sort({ last_seen_at: -1, created_at: -1 })
      .toArray();
    return json({
      device_id: device.id,
      browsers: authorizations.map((authorization) => ({
        ...authorization,
        created_at: new Date(authorization.created_at).toISOString(),
        last_seen_at:
          authorization.last_seen_at === null
            ? null
            : new Date(authorization.last_seen_at).toISOString(),
      })),
    });
  }

  private async revokeOwnBrowserAuthorization(request: Request, principal: string) {
    const token = request.headers.get("X-Relay-Browser-Token");
    if (!token || !TOKEN_PATTERN.test(token)) throw new PairingError(401, "browser_unauthorized", "请重新扫码连接。");
    const ownerId = `usr_${sha256(principal.trim().toLowerCase()).slice(0, 32)}`;
    const current = await this.browserAuthorizations.findOneAndUpdate(
      { token_hash: sha256(token), user_id: ownerId, revoked_at: null },
      { $set: { revoked_at: Date.now() } }, { returnDocument: "before" },
    );
    if (!current) throw new PairingError(401, "browser_unauthorized", "此客户端授权不存在或已被取消。");
    this.realtime?.revokeBrowser(current.device_id, current.id);
    return json({ revoked: true, browser_id: current.id });
  }

  private async revokeBrowserAuthorization(
    request: Request,
    browserId: string,
  ) {
    const device = await this.requireRelayDevice(request);
    requireBrowserId(browserId);
    const revokedAt = Date.now();
    const result = await this.browserAuthorizations.updateOne(
      {
        _id: browserId,
        device_id: device.id,
        revoked_at: null,
      },
      { $set: { revoked_at: revokedAt } },
    );
    if (result.modifiedCount !== 1) {
      throw new PairingError(
        404,
        "browser_not_found",
        "此浏览器授权不存在或已被取消。",
      );
    }
    this.realtime?.revokeBrowser(device.id, browserId);
    return json({ revoked: true, browser_id: browserId });
  }

  private async requireRelayDevice(
    request: Request,
  ): Promise<RelayDeviceDocument> {
    const token = requireRelayBearer(request);
    const device = await this.devices.findOne({
      relay_token_hash: sha256(token),
      revoked_at: null,
    });
    if (!device) {
      throw new PairingError(
        401,
        "relay_unauthorized",
        "桌面端凭据无效或已撤销。",
      );
    }
    await markAuthenticatedDevice(async () => (await this.users.findOne({ _id: device.user_id }))?.email);
    return device;
  }

  private async accountDisplay(principal: string) {
    if (LOCAL_ACCOUNT_ID.test(principal)) {
      const account = await this.db.collection<{ _id: string; username: string }>("auth_users").findOne({ _id: principal });
      return { account_email: account?.username ?? null, account_id: principal, username: account?.username ?? null, auth_mode: "username", email: null };
    }
    return { account_email: principal };
  }

  private async ensureUser(email: string) {
    const normalized = email.trim().toLowerCase();
    const id = `usr_${sha256(normalized).slice(0, 32)}`;
    const now = Date.now();
    await this.users.updateOne(
      { email: normalized },
      {
        $set: { updated_at: now },
        $setOnInsert: {
          _id: id,
          id,
          email: normalized,
          created_at: now,
        },
      },
      { upsert: true },
    );
    const user = await this.users.findOne({ email: normalized });
    if (!user) {
      throw new PairingError(
        500,
        "user_persistence_failed",
        "登录账户无法读取。",
      );
    }
    return user;
  }

  private get pairings(): Collection<PairingDocument> {
    return this.db.collection<PairingDocument>("relay_pake_pairings");
  }

  private get users(): Collection<RelayUserDocument> {
    return this.db.collection<RelayUserDocument>("relay_users");
  }

  private get devices(): Collection<RelayDeviceDocument> {
    return this.db.collection<RelayDeviceDocument>("relay_devices");
  }

  private get browserAuthorizations(): Collection<BrowserAuthorizationDocument> {
    return this.db.collection<BrowserAuthorizationDocument>(
      "relay_browser_authorizations",
    );
  }

  private get desktopLogins(): Collection<DesktopLoginDocument> {
    return this.db.collection<DesktopLoginDocument>("relay_desktop_logins");
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw new PairingError(413, "payload_too_large", "配对请求过大。");
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new PairingError(400, "invalid_json", "配对请求格式无效。");
  }
}

function requirePairingId(value: unknown): string {
  if (typeof value !== "string" || !PAIRING_ID_PATTERN.test(value)) {
    throw new PairingError(400, "invalid_pairing_id", "配对会话编号无效。");
  }
  return value;
}

function requireDesktopLoginId(value: unknown): string {
  if (typeof value !== "string" || !DESKTOP_LOGIN_ID_PATTERN.test(value)) {
    throw new PairingError(
      400,
      "invalid_desktop_login_id",
      "电脑登录请求编号无效。",
    );
  }
  return value;
}

function requireDeviceId(value: unknown): string {
  if (typeof value !== "string" || !DEVICE_ID_PATTERN.test(value)) {
    throw new PairingError(400, "invalid_device_id", "设备编号无效。");
  }
  return value;
}

function requireBrowserId(value: unknown): string {
  if (typeof value !== "string" || !BROWSER_ID_PATTERN.test(value)) {
    throw new PairingError(400, "invalid_browser_id", "浏览器编号无效。");
  }
  return value;
}

function requireEncoded(
  value: unknown,
  pattern: RegExp,
  field: string,
): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new PairingError(400, "invalid_pairing_payload", `${field} 无效。`);
  }
  return value;
}

function requireName(
  value: unknown,
  fallback: string,
  message: string,
): string {
  const name = typeof value === "string" ? value.trim() : fallback;
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new PairingError(400, "invalid_name", message);
  }
  return name;
}

function requireRelayBearer(request: Request): string {
  const relayHeader = request.headers.get("x-relay-device-token")?.trim();
  if (relayHeader && TOKEN_PATTERN.test(relayHeader)) return relayHeader;
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{16,512})$/.exec(authorization);
  if (!match) {
    throw new PairingError(
      401,
      "relay_unauthorized",
      "需要有效的桌面端设备凭据。",
    );
  }
  return match[1];
}

function requireDesktopLoginPollSecret(request: Request): string {
  const pollSecret = request.headers
    .get("x-relay-desktop-login-secret")
    ?.trim();
  if (!pollSecret || !TOKEN_PATTERN.test(pollSecret)) {
    throw new PairingError(
      401,
      "desktop_login_unauthorized",
      "电脑登录轮询凭据无效。",
    );
  }
  return pollSecret;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: headers(),
  });
}

function headers(extra: Record<string, string> = {}) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    ...extra,
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isDuplicate(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
}

class PairingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
