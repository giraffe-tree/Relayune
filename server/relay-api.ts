import { EVENT_WINDOW_MS, RESPONSE_WINDOW_MS, COMMAND_MAX_TTL_MS, CLOCK_SKEW_MS, RETENTION_POLICY, withinRetention } from "../shared/relay-retention.mjs";
import type { ResponseWaitHub } from "./response-wait";
import type { CommandWaitHub } from "./command-wait";
import { markAuthenticated, markBrowserAuthorization } from "./request-log.mjs";
import { validateIosPush, IosPushError } from "./ios-push.mjs";
import { clientVersion } from "./client-version";
import { MongoBusyError } from "./mongo-budget";

const API_PREFIX = "/api/relay";
const PROTOCOL_VERSION = 2;
export const ONLINE_WINDOW_MS = 45_000;
const DEFAULT_COMMAND_TTL_MS = 24 * 60 * 60_000;
const MAX_COMMAND_TTL_MS = COMMAND_MAX_TTL_MS;
const COMMAND_LEASE_MS = 30_000;
const MAX_JSON_BYTES = 1_000_000;
const MAX_ENVELOPE_BYTES = 512_000;
const MAX_COMMAND_ENVELOPE_BYTES = 40 * 1024 * 1024;
const MAX_RESPONSE_ENVELOPE_BYTES = 40 * 1024 * 1024;
const INLINE_COMMAND_ENVELOPE_BYTES = 256_000;
const INLINE_RESPONSE_ENVELOPE_BYTES = 256_000;
const MAX_POLL_ITEMS = 100;
const MAX_PUSH_ITEMS = 100;
const TOP_LEVEL_API_PATHS = new Set([
  "/api/bootstrap",
  "/api/commands",
  "/api/events",
]);

export interface RelayApiEnv {
  CIPHER_STREAM?: { revokeDevice(deviceId: string): void };
  COMMAND_WAIT?: CommandWaitHub;
  RESPONSE_WAIT?: ResponseWaitHub;
  REVALIDATE_ACCOUNT?: (request: Request) => Promise<string | null>;
  IOS_PUSH?: {
    register(deviceId: string, browserId: string, body: JsonObject): Promise<unknown>;
    enqueue(deviceId: string, browserId: string, eventId: string, eventSeq: number, push: JsonObject): Promise<void>;
  };
  DB: RelayDatabase;
  RELAY_BLOBS: RelayBlobStore;
  ANDROID_PUSH?: {
    register(browserId: string, deviceId: string, registration: string | null, locale: string): Promise<void>;
    enqueue(browserId: string, deviceId: string, eventId: string, createdAt: number): Promise<void>;
  };
  REALTIME?: {
    observePresence(deviceId: string, lastSeenAt: number): void;
    invalidate(deviceId: string, scopes: string[]): void;
    revokeDevice(deviceId: string): void;
  };
}

export type RealtimeBrowserAuthorization = {
  deviceId: string;
  browserId: string;
  lastSeenAt: number | null;
};

type RelayRunResult = {
  success: boolean;
  meta?: { changes?: number; last_row_id?: number };
};

type RelayPreparedStatement = {
  bind(...values: unknown[]): RelayPreparedStatement;
  all<T>(): Promise<{
    results?: T[];
    success: boolean;
    meta?: RelayRunResult["meta"];
  }>;
  first<T>(): Promise<T | null>;
  run(): Promise<RelayRunResult>;
};

type RelayDatabase = {
  eventWindow?(deviceId: string, browserId: string, cursor: number): Promise<{ reset_cursor: number } | null>;
  prepare(query: string): RelayPreparedStatement;
  batch(statements: RelayPreparedStatement[]): Promise<RelayRunResult[]>;
};

type RelayBlobStore = {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  delete?(key: string): Promise<unknown>;
};

type JsonObject = Record<string, unknown>;

type UserRecord = {
  id: string;
  email: string;
  username?: string;
};

type DeviceRecord = {
  id: string;
  user_id: string;
  name: string;
  identity_public_key: string;
  encrypted_descriptor: string | null;
  key_epoch: number;
  protocol_version: number;
  ack_seq: number;
  created_at: number;
  last_seen_at: number | null;
};

type BrowserAuthorizationRecord = {
  id: string;
  device_id: string;
  user_id: string;
  name: string;
  key_id: string;
  created_at: number;
  last_seen_at: number | null;
};

type Envelope = {
  v: number;
  alg: string;
  kid: string;
  iv: string;
  aad: string;
  ciphertext: string;
};

type RelayAad = {
  direction: "web_to_relay" | "relay_to_web";
  type: string;
  device_id: string;
  session_id: string | null;
  request_id: string | null;
  event_seq: number | null;
  created_at: string;
  expires_at: string | null;
};

type StoredRelayEvent = {
  session_id: string | null;
  agent_id: string | null;
  request_id: string | null;
  event_id: string;
  aad: string;
  envelope: string;
  created_at: number;
};

export async function handleRelayApi(
  request: Request,
  env: RelayApiEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const isOpaqueApi =
    TOP_LEVEL_API_PATHS.has(url.pathname) ||
    url.pathname.startsWith("/api/responses/") ||
    url.pathname === API_PREFIX ||
    url.pathname.startsWith(`${API_PREFIX}/`);
  if (!isOpaqueApi) {
    return null;
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: apiHeaders({
        Allow: "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Authorization, Content-Type, Idempotency-Key, X-Relay-Client-Platform, X-Relay-Client-Version, X-Relay-Browser-Token, X-Relay-Device-Token",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      }),
    });
  }

  try {
    if (!env.DB) {
      throw new ApiError(
        503,
        "database_unavailable",
        "Relay database is unavailable.",
      );
    }

    if (request.method === "POST" && url.pathname === `${API_PREFIX}/push-registration`) {
      const body = await readJson(request, 2048);
      const deviceId = requireIdentifier(body.device_id, "device_id");
      const authorization = await authorizeRealtimeBrowser(request, env, deviceId);
      const registration = body.registration_id;
      if (registration !== null && (typeof registration !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(registration))) {
        throw new ApiError(400, "invalid_registration", "Invalid push registration.");
      }
      const locale = typeof body.locale === "string" && /^zh(?:-|$)/i.test(body.locale) ? "zh" : "en";
      if (!env.ANDROID_PUSH) throw new ApiError(503, "push_unavailable", "Push is not configured.");
      await env.ANDROID_PUSH.register(authorization.browserId, deviceId, registration as string | null, locale);
      return json({ registered: registration !== null });
    }
    if (request.method === "GET" && url.pathname === "/api/bootstrap") {
      return await opaqueBootstrap(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/commands") {
      return await enqueueWebCommand(request, env, null);
    }
    if (request.method === "GET" && url.pathname === "/api/events") {
      const deviceId = requireIdentifier(
        url.searchParams.get("device_id"),
        "device_id",
      );
      return await pollDeviceEvents(request, env, deviceId);
    }
    const responseMatch = url.pathname.match(/^\/api\/responses\/([^/]+)$/);
    if (request.method === "GET" && responseMatch) {
      return await readEncryptedResponse(
        request,
        env,
        decodePathSegment(responseMatch[1]),
      );
    }

    if (request.method === "POST" && url.pathname === `${API_PREFIX}/hello`) {
      return await relayHello(request, env);
    }
    if (request.method === "POST" && url.pathname === `${API_PREFIX}/logout`) {
      return await revokeRelayDevice(request, env);
    }
    if (request.method === "POST" && url.pathname === `${API_PREFIX}/poll`) {
      return await relayPoll(request, env);
    }
    if (request.method === "GET" && url.pathname === `${API_PREFIX}/commands`) {
      return await relayPoll(request, env);
    }
    if (request.method === "POST" && url.pathname === `${API_PREFIX}/push`) {
      return await relayPush(request, env);
    }

    const iosPushMatch = url.pathname.match(/^\/api\/relay\/devices\/([^/]+)\/ios-push$/);
    if (request.method === "POST" && iosPushMatch) {
      const authorization = await authorizeRealtimeBrowser(request, env, decodePathSegment(iosPushMatch[1]));
      if (!env.IOS_PUSH) throw new ApiError(503, "ios_push_unavailable", "iOS push is not configured.");
      const body = await readJson(request, 12000);
      return json(await env.IOS_PUSH.register(authorization.deviceId, authorization.browserId, body) as JsonObject);
    }

    const commandsMatch = url.pathname.match(
      /^\/api\/relay\/devices\/([^/]+)\/commands$/,
    );
    if (request.method === "POST" && commandsMatch) {
      return await enqueueWebCommand(
        request,
        env,
        decodePathSegment(commandsMatch[1]),
      );
    }

    const eventsMatch = url.pathname.match(
      /^\/api\/relay\/devices\/([^/]+)\/events$/,
    );
    if (request.method === "GET" && eventsMatch) {
      return await pollDeviceEvents(
        request,
        env,
        decodePathSegment(eventsMatch[1]),
      );
    }

    throw new ApiError(404, "not_found", "Relay API route not found.");
  } catch (error) {
    if (error instanceof MongoBusyError) {
      const response = json({ error: { code: error.code, message: error.publicMessage } }, 503);
      response.headers.set("Retry-After", "1");
      return response;
    }
    if (error instanceof ApiError || error instanceof IosPushError) {
      return json(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        error.status,
      );
    }
    return json(
      {
        error: {
          code: "internal_error",
          message: "Relay API request failed.",
        },
      },
      500,
    );
  }
}

async function revokeRelayDevice(
  request: Request,
  env: RelayApiEnv,
): Promise<Response> {
  const device = await requireRelayDevice(request, env.DB);
  const revokedAt = Date.now();
  const result = await env.DB.prepare(
    `UPDATE relay_devices
        SET revoked_at = ?, last_seen_at = NULL
      WHERE id = ? AND revoked_at IS NULL`,
  )
    .bind(revokedAt, device.id)
    .run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    throw new ApiError(
      409,
      "device_revoke_failed",
      "Relay device could not be revoked.",
    );
  }
  env.REALTIME?.revokeDevice(device.id);
  env.CIPHER_STREAM?.revokeDevice(device.id);
  return json({ revoked: true, device_id: device.id });
}

async function opaqueBootstrap(
  request: Request,
  env: RelayApiEnv,
): Promise<Response> {
  const user = await requireWebUser(request, env.DB);
  const now = Date.now();
  const requestedDeviceId = new URL(request.url).searchParams.get("device_id");
  const summaryOnly = new URL(request.url).searchParams.get("summary_only") === "1";
  const includeEvents = !summaryOnly && new URL(request.url).searchParams.get("include_events") !== "0";
  if (!requestedDeviceId) {
    return json({
      protocol_version: PROTOCOL_VERSION,
    retention: RETENTION_POLICY,
      response_wait_ms: env.RESPONSE_WAIT ? 10_000 : 0,
      user: publicUserIdentity(user),
      device: {
        id: "",
        name: "本机 Relay",
        online: false,
        codex_connected: false,
        latency_ms: null,
        last_seen_at: null,
      },
      catalog: null,
      events: [],
      cursor: 0,
      ack_seq: 0,
      queued_commands: 0,
      pending_commands: 0,
    });
  }
  const device = await requireOwnedDevice(
    env.DB,
    user.id,
    requireIdentifier(requestedDeviceId, "device_id"),
  );
  const browser = await requireBrowserAuthorization(
    request,
    env.DB,
    user.id,
    device.id,
  );

  const [catalog, eventsResult, counts, cursor] = await Promise.all([
    summaryOnly ? null : env.DB.prepare(
      `SELECT aad, envelope, updated_at
         FROM relay_catalogs
        WHERE device_id = ? AND browser_id = ?`,
    )
      .bind(device.id, browser.id)
      .first<{ aad: string; envelope: string; updated_at: number }>(),
    !includeEvents ? { results: [] } : env.DB.prepare(
      `SELECT cursor, session_id, agent_id, request_id, event_id, event_seq,
              aad, envelope, created_at
         FROM (
           SELECT cursor, session_id, agent_id, request_id, event_id, event_seq,
                  aad, envelope, created_at
             FROM relay_events
            WHERE device_id = ? AND browser_id = ?
            ORDER BY cursor DESC
            LIMIT 200
         ) AS recent_events
        ORDER BY cursor ASC`,
    )
      .bind(device.id, browser.id)
      .all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
         SUM(CASE WHEN status IN ('queued', 'leased') THEN 1 ELSE 0 END) AS pending
       FROM relay_commands
       WHERE device_id = ? AND browser_id = ? AND expires_at > ?`,
    )
      .bind(device.id, browser.id, now)
      .first<{ queued: number | null; pending: number | null }>(),
    env.DB.prepare(
      `SELECT COALESCE(MAX(cursor), 0) AS cursor
         FROM relay_events
        WHERE device_id = ? AND browser_id = ?`,
    )
      .bind(device.id, browser.id)
      .first<{ cursor: number }>(),
  ]);

  const online =
    device.last_seen_at !== null &&
    device.last_seen_at > now - ONLINE_WINDOW_MS;
  return json({
    protocol_version: PROTOCOL_VERSION,
    retention: RETENTION_POLICY,
    response_wait_ms: env.RESPONSE_WAIT ? 10_000 : 0,
    online_transport_version: env.CIPHER_STREAM ? 1 : 0,
    user: publicUserIdentity(user),
    device: {
      id: device.id,
      name: device.name,
      online,
      codex_connected: online,
      latency_ms: null,
      last_seen_at: nullableIsoTime(device.last_seen_at),
    },
    catalog: catalog
      ? {
          device_id: device.id,
          session_id: null,
          request_id: null,
          created_at: isoTime(catalog.updated_at),
          aad: parseStoredAad(catalog.aad),
          envelope: parseStoredEnvelope(catalog.envelope),
        }
      : null,
    events: (eventsResult.results ?? []).map((row) =>
      eventFrameFromRow(device.id, row),
    ),
    cursor: Number(cursor?.cursor ?? 0),
    ack_seq: Number(device.ack_seq ?? 0),
    queued_commands: Number(counts?.queued ?? 0),
    pending_commands: Number(counts?.pending ?? 0),
  });
}

async function readEncryptedResponse(
  request: Request, env: RelayApiEnv, requestId: string,
): Promise<Response> {
  const user = await requireWebUser(request, env.DB);
  const url = new URL(request.url);
  const waitMs = env.RESPONSE_WAIT
    ? boundedInteger(url.searchParams.get("wait_ms"), 0, 10_000, 0) : 0;
  if (!waitMs) {
    return await readEncryptedResponseNow(request, env, requestId, user)
      ?? pendingEncryptedResponse(request, requestId);
  }
  requestId = requireIdentifier(requestId, "request_id");
  const deviceId = requireIdentifier(url.searchParams.get("device_id"), "device_id");
  const authorize = async () => {
    if (env.REVALIDATE_ACCOUNT && await env.REVALIDATE_ACCOUNT(request) !== user.email) {
      throw new ApiError(401, "unauthorized", "A signed-in user is required.");
    }
    await requireOwnedDevice(env.DB, user.id, deviceId);
    const browser = await requireBrowserAuthorization(request, env.DB, user.id, deviceId);
    return { deviceId, browserId: browser.id, lastSeenAt: null };
  };
  const authorization = await authorize();
  // Subscribe before reading: a response committed during the first read must wake us.
  const waiter = env.RESPONSE_WAIT!.subscribe(authorization.browserId, requestId, waitMs, request.signal);
  try {
    const existing = await readEncryptedResponseNow(request, env, requestId, user, authorization);
    if (existing) return existing;
    if (!waiter || request.signal?.aborted) return pendingEncryptedResponse(request, requestId);
    const reason = await waiter.promise;
    if (reason === "cancelled" || request.signal?.aborted) return pendingEncryptedResponse(request, requestId);
    const current = await authorize();
    if (current.browserId !== authorization.browserId) return pendingEncryptedResponse(request, requestId);
    const result = await readEncryptedResponseNow(request, env, requestId, user, current);
    if (result) return result;
    if (reason === "timeout" && url.searchParams.get("pending_status") !== "202") {
      throw new ApiError(404, "response_wait_timeout", "Encrypted response is still pending.");
    }
    return pendingEncryptedResponse(request, requestId);
  } finally { waiter?.dispose(); }
}

async function readEncryptedResponseNow(
  request: Request,
  env: RelayApiEnv,
  requestId: string,
  user: UserRecord,
  authorization?: RealtimeBrowserAuthorization,
): Promise<Response | null> {
  const row = await env.DB.prepare(
    `SELECT device_id, browser_id, session_id, aad, envelope, blob_key, created_at
       FROM relay_responses
      WHERE request_id = ? AND user_id = ?`,
  )
    .bind(requestId, user.id)
    .first<Record<string, unknown>>();
  if (!row) {
    return null;
  }
  if (authorization && row.device_id !== authorization.deviceId) return null;
  const browser = authorization
    ? { id: authorization.browserId }
    : await requireBrowserAuthorization(
        request,
        env.DB,
        user.id,
        String(row.device_id),
      );
  if (row.browser_id !== browser.id) {
    return null;
  }
  let envelope = row.envelope;
  if (typeof envelope !== "string" && typeof row.blob_key === "string") {
    const object = await env.RELAY_BLOBS?.get(row.blob_key);
    if (!object) {
      throw new ApiError(
        502,
        "response_blob_missing",
        "Encrypted response payload is unavailable.",
      );
    }
    envelope = await object.text();
  }
  if (typeof envelope !== "string") {
    throw new ApiError(
      502,
      "response_payload_missing",
      "Encrypted response payload is unavailable.",
    );
  }
  return json({
    device_id: row.device_id,
    session_id: row.session_id,
    request_id: requestId,
    created_at: isoTime(row.created_at),
    aad: parseStoredAad(row.aad),
    envelope: parseStoredEnvelope(envelope),
  });
}

function pendingEncryptedResponse(
  request: Request,
  requestId: string,
): Response {
  if (new URL(request.url).searchParams.get("pending_status") === "202") {
    return json(
      {
        pending: true,
        request_id: requestId,
      },
      202,
    );
  }
  throw new ApiError(
    404,
    "response_pending",
    "Encrypted response is still pending.",
  );
}

async function relayHello(
  request: Request,
  env: RelayApiEnv,
): Promise<Response> {
  const body = await readJson(request);
  const device = await requireRelayDevice(request, env.DB);
  assertDeviceTarget(body.device_id, device.id);
  const protocolVersion = optionalPositiveInteger(
    body.protocol_version,
    device.protocol_version,
    "protocol_version",
  );
  if (protocolVersion !== PROTOCOL_VERSION) {
    throw new ApiError(
      409,
      "protocol_version_unsupported",
      `Relay protocol version ${protocolVersion} is not supported.`,
    );
  }

  const keyEpoch = optionalPositiveInteger(
    body.key_epoch,
    device.key_epoch,
    "key_epoch",
  );
  const descriptor =
    body.encrypted_descriptor === undefined
      ? device.encrypted_descriptor
      : serializeEnvelope(body.encrypted_descriptor);
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE relay_devices
        SET last_seen_at = ?, protocol_version = ?, key_epoch = ?,
            encrypted_descriptor = ?
      WHERE id = ? AND revoked_at IS NULL`,
  )
    .bind(now, protocolVersion, keyEpoch, descriptor, device.id)
    .run();
  env.REALTIME?.observePresence(device.id, now);
  if (body.encrypted_descriptor !== undefined) {
    env.REALTIME?.invalidate(device.id, ["catalog"]);
  }

  return json({
    connected: true,
    command_wait_ms: env.COMMAND_WAIT ? 20_000 : 0,
    online_transport_version: env.CIPHER_STREAM ? 1 : 0,
    device_id: device.id,
    protocol_version: PROTOCOL_VERSION,
    retention: RETENTION_POLICY,
    key_epoch: keyEpoch,
    ack_seq: device.ack_seq,
    event_ack_seq: device.ack_seq,
    poll_after_ms: 1_000,
    server_time: new Date(now).toISOString(),
    browser_authorizations: await listActiveBrowserAuthorizations(
      env.DB,
      device.id,
    ),
  });
}

async function relayPoll(
  request: Request,
  env: RelayApiEnv,
): Promise<Response> {
  // Authenticate before allocating a waiter. Waiting never grants a lease:
  // every batch (including after wake-up) revalidates the device token.
  const device = await requireRelayDevice(request, env.DB);
  const url = new URL(request.url);
  const waitMs = request.method === "GET" && env.COMMAND_WAIT
    ? boundedInteger(url.searchParams.get("wait_ms"), 0, 20_000, 0) : 0;
  if (request.method === "GET") assertDeviceTarget(url.searchParams.get("device_id"), device.id);
  const waiter = waitMs > 0
    ? env.COMMAND_WAIT!.subscribe(device.id, waitMs, request.signal) : null;
  try {
    const batch = await readRelayCommandBatch(request, env, device);
    if (!waiter || batch.commands.length || request.signal?.aborted) return json(batch);
    if (await waiter.promise === "cancelled" || request.signal?.aborted) {
      // A replacement connection must not make two relays spin on each other.
      return json({ ...batch, poll_retry_after_ms: 750 });
    }
    return json(await readRelayCommandBatch(request, env));
  } finally {
    waiter?.dispose();
  }
}

async function readRelayCommandBatch(
  request: Request, env: RelayApiEnv,
  authenticatedDevice?: DeviceRecord,
) {
  const device = authenticatedDevice ?? await requireRelayDevice(request, env.DB);
  const body = await readJson(request);
  const url = new URL(request.url);
  const queryDeviceId = url.searchParams.get("device_id");
  assertDeviceTarget(body.device_id ?? queryDeviceId, device.id);
  const limit = boundedInteger(
    body.limit ?? url.searchParams.get("limit"),
    1,
    MAX_POLL_ITEMS,
    50,
  );
  const now = Date.now();
  const leaseId = `lease_${crypto.randomUUID().replaceAll("-", "")}`;
  const leasedUntil = now + COMMAND_LEASE_MS;

  const expiredBlobs = await env.DB.prepare(
    `SELECT blob_key
       FROM relay_commands
      WHERE device_id = ? AND expires_at <= ?
        AND status IN ('queued', 'leased') AND blob_key IS NOT NULL`,
  )
    .bind(device.id, now)
    .all<{ blob_key: string }>();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE relay_commands
            SET status = 'expired', lease_id = NULL, leased_until = NULL,
                envelope = NULL, blob_key = NULL
          WHERE device_id = ? AND expires_at <= ?
            AND status IN ('queued', 'leased')`,
    ).bind(device.id, now),
    env.DB.prepare(
      `UPDATE relay_devices
            SET last_seen_at = ?
          WHERE id = ? AND revoked_at IS NULL`,
    ).bind(now, device.id),
  ]);
  env.REALTIME?.observePresence(device.id, now);

  const candidates = await env.DB.prepare(
    `SELECT id
       FROM relay_commands
      WHERE device_id = ? AND expires_at > ?
        AND (
          status = 'queued'
          OR (status = 'leased' AND leased_until <= ?)
        )
      ORDER BY created_at ASC
      LIMIT ?`,
  )
    .bind(device.id, now, now, limit)
    .all<{ id: string }>();
  if (candidates.results?.length) {
    await env.DB.batch(
      candidates.results.map((candidate) =>
        env.DB.prepare(
          `UPDATE relay_commands
                SET status = 'leased', lease_id = ?, leased_until = ?
              WHERE id = ? AND device_id = ? AND expires_at > ?
                AND (
                  status = 'queued'
                  OR (status = 'leased' AND leased_until <= ?)
                )`,
        ).bind(leaseId, leasedUntil, candidate.id, device.id, now, now),
      ),
    );
  }
  await Promise.allSettled(
    (expiredBlobs.results ?? []).map((row) =>
      typeof row.blob_key === "string"
        ? env.RELAY_BLOBS.delete?.(row.blob_key)
        : Promise.resolve(),
    ),
  );
  const leased = await env.DB.prepare(
    `SELECT id, browser_id, session_id, type, direction, aad, envelope, blob_key, expires_at, created_at
       FROM relay_commands
      WHERE device_id = ? AND lease_id = ?
      ORDER BY created_at ASC`,
  )
    .bind(device.id, leaseId)
    .all<Record<string, unknown>>();

  const commands = await Promise.all(
    (leased.results ?? []).map(async (row) => {
      let envelope = row.envelope;
      if (typeof envelope !== "string" && typeof row.blob_key === "string") {
        const object = await env.RELAY_BLOBS.get(row.blob_key);
        if (!object) {
          throw new ApiError(
            503,
            "command_blob_missing",
            "Encrypted command blob is unavailable.",
          );
        }
        envelope = await object.text();
      }
      if (typeof envelope !== "string") {
        throw new ApiError(
          500,
          "command_envelope_missing",
          "Encrypted command has no stored envelope.",
        );
      }
      return {
        request_id: row.id,
        browser_id: row.browser_id,
        device_id: device.id,
        session_id: row.session_id,
        type: row.type,
        command_type: row.type,
        direction: row.direction,
        aad: parseStoredAad(row.aad),
        envelope: parseStoredEnvelope(envelope),
        issued_at: isoTime(row.created_at),
        expires_at: isoTime(row.expires_at),
      };
    }),
  );

  return {
    device_id: device.id,
    lease_id: leaseId,
    lease_expires_at: new Date(leasedUntil).toISOString(),
    ack_seq: device.ack_seq,
    event_ack_seq: device.ack_seq,
    commands,
    poll_after_ms: leased.results?.length ? 0 : 1_000,
    server_time: new Date(now).toISOString(),
    browser_authorizations: await listActiveBrowserAuthorizations(
      env.DB,
      device.id,
    ),
  };
}

async function relayPush(
  request: Request,
  env: RelayApiEnv,
): Promise<Response> {
  const device = await requireRelayDevice(request, env.DB);
  const body = await readJson(request, 48 * 1024 * 1024);
  assertDeviceTarget(body.device_id, device.id);
  if (body.messages === undefined) {
    throw new ApiError(
      400,
      "messages_required",
      "Relay push requires an opaque messages array.",
    );
  }
  return relayPushMessages(env, device, body);
}

async function relayPushMessages(
  env: RelayApiEnv,
  device: DeviceRecord,
  body: JsonObject,
): Promise<Response> {
  const messages = requireArray(body.messages, "messages", MAX_PUSH_ITEMS);
  const now = Date.now();
  const mutations: Array<{
    statement: RelayPreparedStatement;
    scope: "catalog" | "events" | "queue" | "responses";
    responseTarget?: { browserId: string; requestId: string };
  }> = [];
  const commandBlobDeletes: string[] = [];
  let expiredEvents = 0;
  let expiredResponses = 0;
  let hasEvents = false;
  const pushCandidates: Array<[string, string, string, number]> = [];
  const seenEventSequences = new Map<string, string>();
  const iosPushJobs: Array<{browserId: string; eventId: string; eventSeq: number; push: JsonObject}> = [];
  const activeBrowsers = new Map(
    (await listActiveBrowserAuthorizations(env.DB, device.id)).map(
      (authorization) => [authorization.id, authorization],
    ),
  );

  for (const value of messages) {
    const message = requireObject(value, "message");
    const kind = requireText(message.kind, "kind", 40);
    assertDeviceTarget(message.device_id, device.id);

    if (kind === "catalog") {
      const browser = requireActiveBrowser(message, activeBrowsers);
      const aad = validateAndSerializeAad(message.aad, {
        direction: "relay_to_web",
        deviceId: device.id,
        sessionId: null,
        requestId: null,
        eventSeq: null,
      });
      const envelope = serializeEnvelope(message.envelope);
      assertEnvelopeKey(envelope, browser.key_id);
      const sessionRefs = requireIdentifierArray(
        message.session_refs,
        "session_refs",
        2_000,
      );
      const updatedAt = timeFromAad(message.aad, now);
      mutations.push({
        scope: "catalog",
        statement: env.DB.prepare(
          `INSERT INTO relay_catalogs
               (device_id, browser_id, session_refs, aad, envelope, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(device_id, browser_id) DO UPDATE SET
               session_refs = excluded.session_refs,
               aad = excluded.aad,
               envelope = excluded.envelope,
               updated_at = excluded.updated_at
             WHERE excluded.updated_at >= relay_catalogs.updated_at`,
        ).bind(
          device.id,
          browser.id,
          JSON.stringify(sessionRefs),
          aad,
          envelope,
          updatedAt,
        ),
      });
      continue;
    }

    if (kind === "event") {
      const browser = requireActiveBrowser(message, activeBrowsers);
      const eventId = requireIdentifier(message.event_id, "event_id");
      const eventSeq = requirePositiveInteger(message.event_seq, "event_seq");
      const eventSequenceKey = `${browser.id}:${eventSeq}`;
      const sessionId = optionalIdentifier(message.session_id, "session_id");
      const requestId = optionalIdentifier(message.request_id, "request_id");
      const agentId = optionalIdentifier(message.agent_id, "agent_id");
      const aadObject = validateAad(message.aad);
      validateAadRoute(aadObject, {
        direction: "relay_to_web",
        type: "session.event",
        deviceId: device.id,
        sessionId,
        requestId,
        eventSeq,
      });
      const aad = JSON.stringify(aadObject);
      const envelope = serializeEnvelope(message.envelope);
      assertEnvelopeKey(envelope, browser.key_id);
      assertEnvelopeAad(envelope, aadObject);
      const createdAt = optionalTime(
        message.created_at,
        timeFromAad(aadObject, now),
        "created_at",
      );
      if (createdAt !== Date.parse(aadObject.created_at)) {
        throw new ApiError(400, "invalid_aad", "Event creation time must match its authenticated metadata.");
      }
      if (!withinRetention(createdAt, EVENT_WINDOW_MS, now)) {
        expiredEvents++;
        continue; // A replay cannot revive an expired event after TTL removal.
      }
      hasEvents = true;
      if (message.ios_push !== undefined) {
        const push = validateIosPush(message.ios_push, aadObject, now);
        if (push) iosPushJobs.push({browserId: browser.id, eventId, eventSeq, push});
      }
      if (message.notification_hint !== undefined && typeof message.notification_hint !== "boolean") {
        throw new ApiError(400, "invalid_notification_hint", "Invalid delivery hint.");
      }
      if (message.notification_hint === true) pushCandidates.push([browser.id, device.id, eventId, createdAt]);
      const replayFingerprint = eventReplayFingerprint({
        event_id: eventId,
        session_id: sessionId,
        request_id: requestId,
        agent_id: agentId,
        aad,
        envelope,
        created_at: createdAt,
      });
      const earlierFingerprint = seenEventSequences.get(eventSequenceKey);
      if (earlierFingerprint !== undefined) {
        if (earlierFingerprint === replayFingerprint) continue;
        throw eventSequenceConflict();
      }
      seenEventSequences.set(eventSequenceKey, replayFingerprint);
      const storedEvent = await env.DB.prepare(
        `SELECT session_id, agent_id, request_id, event_id, aad, envelope, created_at
           FROM relay_events
          WHERE device_id = ? AND browser_id = ? AND event_seq = ?`,
      )
        .bind(device.id, browser.id, eventSeq)
        .first<StoredRelayEvent>();
      if (storedEvent) {
        if (eventReplayFingerprint(storedEvent) === replayFingerprint) continue;
        throw eventSequenceConflict();
      }
      mutations.push({
        scope: "events",
        statement: env.DB.prepare(
          `INSERT INTO relay_events
               (device_id, browser_id, session_id, agent_id, request_id, event_id, event_seq,
                type, direction, aad, envelope, created_at, received_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT DO NOTHING`,
        ).bind(
          device.id,
          browser.id,
          sessionId,
          agentId,
          requestId,
          eventId,
          eventSeq,
          "session.event",
          "relay_to_web",
          aad,
          envelope,
          createdAt,
          now,
        ),
      });
      continue;
    }

    if (kind === "response") {
      const browser = requireActiveBrowser(message, activeBrowsers);
      const requestId = requireIdentifier(message.request_id, "request_id");
      const sessionId = optionalIdentifier(message.session_id, "session_id");
      const aadObject = validateAad(message.aad);
      validateAadRoute(aadObject, {
        direction: "relay_to_web",
        deviceId: device.id,
        sessionId,
        requestId,
        eventSeq: null,
      });
      const aad = JSON.stringify(aadObject);
      const envelope = serializeEnvelope(
        message.envelope,
        MAX_RESPONSE_ENVELOPE_BYTES,
      );
      assertEnvelopeKey(envelope, browser.key_id);
      assertEnvelopeAad(envelope, aadObject);
      const createdAt = timeFromAad(aadObject, now);
      if (!withinRetention(createdAt, RESPONSE_WINDOW_MS, now)) {
        expiredResponses++;
        continue;
      }
      let inlineEnvelope: string | null = envelope;
      let blobKey: string | null = null;
      if (utf8Size(envelope) > INLINE_RESPONSE_ENVELOPE_BYTES) {
        if (!env.RELAY_BLOBS) {
          throw new ApiError(
            503,
            "blob_store_unavailable",
            "Encrypted response blob storage is unavailable.",
          );
        }
        blobKey = `responses/${createdAt + RESPONSE_WINDOW_MS}/${device.id}/${requestId}/${await sha256(envelope)}.json`;
        await env.RELAY_BLOBS.put(blobKey, envelope, {
          httpMetadata: { contentType: "application/json" },
        });
        inlineEnvelope = null;
      }
      mutations.push({
        scope: "responses",
        responseTarget: { browserId: browser.id, requestId },
        statement: env.DB.prepare(
          `INSERT INTO relay_responses
               (request_id, user_id, device_id, browser_id, session_id, aad, envelope,
                blob_key, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(request_id) DO NOTHING`,
        ).bind(
          requestId,
          device.user_id,
          device.id,
          browser.id,
          sessionId,
          aad,
          inlineEnvelope,
          blobKey,
          createdAt,
        ),
      });
      continue;
    }

    if (kind === "command_ack") {
      const requestId = requireIdentifier(message.request_id, "request_id");
      const status = requireAckStatus(message.status);
      const stored = await env.DB.prepare(
        `SELECT blob_key
           FROM relay_commands
          WHERE id = ? AND device_id = ?`,
      )
        .bind(requestId, device.id)
        .first<{ blob_key: string | null }>();
      mutations.push({
        scope: "queue",
        statement: env.DB.prepare(
          `UPDATE relay_commands
                SET status = ?, acknowledged_at = ?, lease_id = NULL,
                    leased_until = NULL, envelope = NULL, blob_key = NULL
              WHERE id = ? AND device_id = ?`,
        ).bind(status, now, requestId, device.id),
      });
      if (stored?.blob_key) commandBlobDeletes.push(stored.blob_key);
      continue;
    }

    if (kind === "heartbeat") {
      if (
        message.last_event_seq !== undefined &&
        message.last_event_seq !== null
      ) {
        boundedInteger(message.last_event_seq, 0, Number.MAX_SAFE_INTEGER, 0);
      }
      continue;
    }

    throw new ApiError(
      400,
      "unsupported_push_kind",
      `Unsupported relay push kind: ${kind}.`,
    );
  }

  let changedRows = 0;
  const changedScopes = new Set<"catalog" | "events" | "queue" | "responses">();
  for (const batch of chunk(mutations, 50)) {
    const results = await env.DB.batch(
      batch.map((mutation) => mutation.statement),
    );
    results.forEach((result, index) => {
      const changes = Number(result.meta?.changes ?? 0);
      changedRows += changes;
      if (changes > 0) changedScopes.add(batch[index].scope);
      // Wake immediately after durable storage, before push jobs and ACK work.
      // Duplicate successful uploads also wake a waiter for the existing response.
      const target = batch[index].responseTarget;
      if (target) env.RESPONSE_WAIT?.notify(target.browserId, target.requestId);
    });
  }
  await Promise.allSettled(
    commandBlobDeletes.map(
      (key) => env.RELAY_BLOBS.delete?.(key) ?? Promise.resolve(),
    ),
  );
  // Persist delivery jobs before advancing the outbox ACK. Replays are idempotent.
  for (const candidate of pushCandidates) await env.ANDROID_PUSH?.enqueue(...candidate);
  // Heartbeats, catalogs and responses must never scan the event backlog.
  // Global ACK is legacy contiguous progress, not permission to delete sibling
  // ciphertexts. A retention gap leaves it unchanged; each push is its own receipt.
  const ackSeq = hasEvents ? await coalescedEventAck(env.DB, device.id, device.ack_seq) : device.ack_seq;
  await env.DB.prepare(
    `UPDATE relay_devices
        SET last_seen_at = ?,
            ack_seq = CASE WHEN ack_seq < ? THEN ? ELSE ack_seq END
      WHERE id = ? AND revoked_at IS NULL`,
  )
    .bind(now, ackSeq, ackSeq, device.id)
    .run();
  env.REALTIME?.observePresence(device.id, now);
  if (changedScopes.size > 0) {
    env.REALTIME?.invalidate(device.id, [...changedScopes]);
  }

  // Retry uploads also revisit this idempotent queue, including already stored
  // event sequences. A queue write failure must not acknowledge the upload.
  if (env.IOS_PUSH) {
    for (const job of iosPushJobs) await env.IOS_PUSH.enqueue(device.id, job.browserId, job.eventId, job.eventSeq, job.push);
  }

  return json({
    accepted: true,
    device_id: device.id,
    ack_seq: ackSeq,
    changed_records: changedRows,
    expired_events: expiredEvents,
    expired_responses: expiredResponses,
    retention: RETENTION_POLICY,
    server_time: new Date(now).toISOString(),
  });
}

function eventReplayFingerprint(event: StoredRelayEvent): string {
  return JSON.stringify([
    event.event_id,
    event.session_id,
    event.request_id,
    event.agent_id,
    event.aad,
    event.envelope,
    event.created_at,
  ]);
}

function eventSequenceConflict(): ApiError {
  return new ApiError(
    409,
    "event_seq_conflict",
    "The same event_seq cannot identify different encrypted events.",
  );
}

async function enqueueWebCommand(
  request: Request,
  env: RelayApiEnv,
  deviceId: string | null,
): Promise<Response> {
  const user = await requireWebUser(request, env.DB);
  const body = await readJson(request, 48 * 1024 * 1024);
  const bodyDeviceId = requireIdentifier(body.device_id, "device_id");
  if (deviceId && bodyDeviceId !== deviceId) {
    throw new ApiError(
      403,
      "device_mismatch",
      "Request targets a different relay device.",
    );
  }
  const device = await requireOwnedDevice(
    env.DB,
    user.id,
    deviceId ?? bodyDeviceId,
  );
  const browser = await requireBrowserAuthorization(
    request,
    env.DB,
    user.id,
    device.id,
  );
  assertDeviceTarget(body.device_id, device.id);
  const requestId = requireIdentifier(body.request_id, "request_id");
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || idempotencyKey !== requestId) {
    throw new ApiError(
      400,
      "idempotency_key_required",
      "Idempotency-Key must be present and equal request_id.",
    );
  }
  const sessionId = optionalIdentifier(body.session_id, "session_id");
  const type = requireRoutingType(body.command_type ?? body.type);
  const aadObject = validateAad(body.aad);
  validateAadRoute(aadObject, {
    direction: "web_to_relay",
    type,
    deviceId: device.id,
    sessionId,
    requestId,
    eventSeq: null,
  });
  const aad = JSON.stringify(aadObject);
  const direction = "web_to_relay";
  const envelope = serializeEnvelope(body.envelope, MAX_COMMAND_ENVELOPE_BYTES);
  assertEnvelopeKey(envelope, browser.key_id);
  assertEnvelopeAad(envelope, aadObject);
  const now = Date.now();
  const createdAt = optionalTime(
    body.created_at,
    timeFromAad(aadObject, now),
    "created_at",
  );
  const expiresAt = optionalTime(
    body.expires_at,
    now + DEFAULT_COMMAND_TTL_MS,
    "expires_at",
  );
  // Bind the lifetime to immutable authenticated metadata. Otherwise a retry
  // can extend body.expires_at and resurrect a mutation after its receipt expires.
  if (createdAt !== Date.parse(aadObject.created_at) || expiresAt !== Date.parse(aadObject.expires_at ?? "") ||
      createdAt > now + CLOCK_SKEW_MS || expiresAt > createdAt + MAX_COMMAND_TTL_MS ||
      expiresAt <= now || expiresAt > now + MAX_COMMAND_TTL_MS) {
    throw new ApiError(
      400,
      "invalid_expiry",
      "Command expiry must be in the future and no more than 24 hours away.",
    );
  }

  let inlineEnvelope: string | null = envelope;
  let blobKey: string | null = null;
  if (utf8Size(envelope) > INLINE_COMMAND_ENVELOPE_BYTES) {
    blobKey = `commands/${expiresAt}/${device.id}/${requestId}/${await sha256(envelope)}.json`;
    await env.RELAY_BLOBS.put(blobKey, envelope, {
      httpMetadata: { contentType: "application/json" },
    });
    inlineEnvelope = null;
  }

  const inserted = await env.DB.prepare(
    `INSERT INTO relay_commands
       (id, user_id, device_id, browser_id, session_id, type, direction, aad, envelope, blob_key,
        idempotency_key, status, lease_id, leased_until, expires_at,
        created_at, acknowledged_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, NULL, ?, ?, NULL)
     ON CONFLICT(user_id, idempotency_key) DO NOTHING`,
  )
    .bind(
      requestId,
      user.id,
      device.id,
      browser.id,
      sessionId,
      type,
      direction,
      aad,
      inlineEnvelope,
      blobKey,
      idempotencyKey,
      expiresAt,
      createdAt,
    )
    .run();

  const command = await env.DB.prepare(
    `SELECT id, device_id, browser_id, session_id, type, direction, aad, envelope, blob_key, status,
            expires_at, created_at
       FROM relay_commands
      WHERE user_id = ? AND idempotency_key = ?`,
  )
    .bind(user.id, idempotencyKey)
    .first<Record<string, unknown>>();
  if (!command) {
    throw new ApiError(
      500,
      "command_persistence_failed",
      "Encrypted command could not be persisted.",
    );
  }
  if (Number(inserted.meta?.changes ?? 0) === 0 && blobKey) {
    await env.RELAY_BLOBS.delete?.(blobKey);
  }
  env.COMMAND_WAIT?.notify(device.id);
  env.REALTIME?.invalidate(device.id, ["queue"]);

  return json(
    {
      accepted: true,
      duplicate: Number(inserted.meta?.changes ?? 0) === 0,
      request_id: command.id,
      device_id: command.device_id,
      browser_id: command.browser_id,
      session_id: command.session_id,
      command_type: command.type,
      direction: command.direction,
      aad: parseStoredAad(command.aad),
      envelope:
        typeof command.envelope === "string"
          ? parseStoredEnvelope(command.envelope)
          : undefined,
      status: command.status,
      delivery: "queued",
      issued_at: isoTime(command.created_at),
      expires_at: isoTime(command.expires_at),
    },
    202,
  );
}

export async function authorizeRealtimeBrowser(
  request: Request,
  env: RelayApiEnv,
  deviceId: string,
): Promise<RealtimeBrowserAuthorization> {
  const user = await requireWebUser(request, env.DB);
  const device = await requireOwnedDevice(
    env.DB,
    user.id,
    requireIdentifier(deviceId, "device_id"),
  );
  const browser = await requireBrowserAuthorization(
    request,
    env.DB,
    user.id,
    device.id,
  );
  return {
    deviceId: device.id,
    browserId: browser.id,
    lastSeenAt: device.last_seen_at,
  };
}

export async function authorizeCipherRelay(request: Request, env: RelayApiEnv, deviceId: string) {
  const device = await requireRelayDevice(request, env.DB);
  assertDeviceTarget(requireIdentifier(deviceId, "device_id"), device.id);
  return { deviceId: device.id };
}

export async function authorizeCipherBrowser(request: Request, env: RelayApiEnv, deviceId: string) {
  const user = await requireWebUser(request, env.DB);
  const device = await requireOwnedDevice(env.DB, user.id, requireIdentifier(deviceId, "device_id"));
  const browser = await requireBrowserAuthorization(request, env.DB, user.id, device.id);
  return { deviceId: device.id, browserId: browser.id, keyId: browser.key_id };
}

async function pollDeviceEvents(
  request: Request,
  env: RelayApiEnv,
  deviceId: string,
): Promise<Response> {
  const user = await requireWebUser(request, env.DB);
  await requireOwnedDevice(env.DB, user.id, deviceId);
  const browser = await requireBrowserAuthorization(
    request,
    env.DB,
    user.id,
    deviceId,
  );
  const url = new URL(request.url);
  const cursor = boundedInteger(
    url.searchParams.get("cursor"),
    0,
    Number.MAX_SAFE_INTEGER,
    0,
  );
  const limit = boundedInteger(
    url.searchParams.get("limit"),
    1,
    MAX_POLL_ITEMS,
    100,
  );
  const sessionId = url.searchParams.has("session_id")
    ? requireIdentifier(url.searchParams.get("session_id"), "session_id")
    : null;
  const expiredCursor = await env.DB.eventWindow?.(deviceId, browser.id, cursor);
  if (expiredCursor) return json({
    device_id: deviceId, events: [], next_cursor: expiredCursor.reset_cursor,
    has_more: false, resync_required: true, retention: RETENTION_POLICY,
    server_time: new Date().toISOString(),
  });
  const result = sessionId
    ? await env.DB.prepare(
        `SELECT cursor, session_id, agent_id, request_id, event_id, event_seq,
                type, direction, aad, envelope, created_at
           FROM relay_events
          WHERE device_id = ? AND browser_id = ? AND cursor > ? AND session_id = ?
          ORDER BY cursor ASC
          LIMIT ?`,
      )
        .bind(deviceId, browser.id, cursor, sessionId, limit)
        .all<Record<string, unknown>>()
    : await env.DB.prepare(
        `SELECT cursor, session_id, agent_id, request_id, event_id, event_seq,
                type, direction, aad, envelope, created_at
           FROM relay_events
          WHERE device_id = ? AND browser_id = ? AND cursor > ?
          ORDER BY cursor ASC
          LIMIT ?`,
      )
        .bind(deviceId, browser.id, cursor, limit)
        .all<Record<string, unknown>>();
  const events = (result.results ?? []).map((row) =>
    eventFrameFromRow(deviceId, row),
  );

  return json({
    device_id: deviceId,
    events,
    next_cursor: Number(events.at(-1)?.cursor ?? cursor),
    has_more: events.length === limit,
    poll_after_ms: events.length ? 0 : 1_000,
    server_time: new Date().toISOString(),
  });
}

async function requireWebUser(
  request: Request,
  db: RelayDatabase,
): Promise<UserRecord> {
  const accountId = request.headers.get("x-relayune-authenticated-account-id");
  if (accountId && /^acct_[a-f0-9]{32}$/.test(accountId)) {
    const username = request.headers.get("x-relayune-account-username") || "";
    if (!/^[a-z][a-z0-9._-]{2,31}$/.test(username)) throw new ApiError(401, "unauthorized", "A signed-in user is required.");
    return { ...await ensureUserByEmail(db, accountId), username };
  }
  const email = request.headers
    .get("oai-authenticated-user-email")
    ?.trim()
    .toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ApiError(401, "unauthorized", "A signed-in user is required.");
  }
  return ensureUserByEmail(db, email);
}

function publicUserIdentity(user: UserRecord) {
  return /^acct_[a-f0-9]{32}$/.test(user.email)
    ? { email: null, account_id: user.email, username: user.username, display_name: user.username, auth_mode: "username" }
    : { email: user.email, account_id: user.email, display_name: user.email, auth_mode: "email" };
}

async function ensureUserByEmail(
  db: RelayDatabase,
  email: string,
): Promise<UserRecord> {
  const now = Date.now();
  const id = `usr_${(await sha256(email)).slice(0, 32)}`;
  await db
    .prepare(
      `INSERT INTO relay_users (id, email, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET updated_at = excluded.updated_at`,
    )
    .bind(id, email, now, now)
    .run();
  const user = await db
    .prepare(`SELECT id, email FROM relay_users WHERE email = ?`)
    .bind(email)
    .first<UserRecord>();
  if (!user) {
    throw new ApiError(
      500,
      "user_persistence_failed",
      "User could not be loaded.",
    );
  }
  return user;
}

async function requireRelayDevice(
  request: Request,
  db: RelayDatabase,
): Promise<DeviceRecord> {
  const token = requireRelayBearer(request);
  const device = await db
    .prepare(
      `SELECT id, user_id, name, identity_public_key, encrypted_descriptor,
              key_epoch, protocol_version, ack_seq, created_at, last_seen_at
         FROM relay_devices
        WHERE relay_token_hash = ? AND revoked_at IS NULL`,
    )
    .bind(await sha256(token))
    .first<DeviceRecord>();
  if (!device) {
    throw new ApiError(
      401,
      "relay_unauthorized",
      "Relay token is invalid or revoked.",
    );
  }
  const owner = await db
    .prepare(`SELECT id, email FROM relay_users WHERE id = ?`)
    .bind(device.user_id)
    .first<UserRecord>();
  markAuthenticated(owner?.email, "device_token", "desktop");
  return device;
}

async function requireBrowserAuthorization(
  request: Request,
  db: RelayDatabase,
  userId: string,
  deviceId: string,
): Promise<BrowserAuthorizationRecord> {
  const token = request.headers.get("x-relay-browser-token")?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new ApiError(
      401,
      "browser_unauthorized",
      "此浏览器尚未获得这台电脑的授权。",
    );
  }
  const authorization = await db
    .prepare(
      `SELECT id, device_id, user_id, name, key_id, created_at, last_seen_at
         FROM relay_browser_authorizations
        WHERE token_hash = ? AND device_id = ? AND user_id = ?
          AND revoked_at IS NULL`,
    )
    .bind(await sha256(token), deviceId, userId)
    .first<BrowserAuthorizationRecord>();
  if (!authorization) {
    throw new ApiError(
      401,
      "browser_unauthorized",
      "此浏览器授权已被取消，请从桌面端重新添加。",
    );
  }
  markBrowserAuthorization();
  const version = clientVersion(request);
  if (version) {
    await db
      .prepare(
        `UPDATE relay_browser_authorizations
            SET last_seen_at = ?, client_version = ?
          WHERE id = ? AND revoked_at IS NULL`,
      )
      .bind(Date.now(), version, authorization.id)
      .run();
  } else {
    await db
      .prepare(
        `UPDATE relay_browser_authorizations
            SET last_seen_at = ?
          WHERE id = ? AND revoked_at IS NULL`,
      )
      .bind(Date.now(), authorization.id)
      .run();
  }
  return authorization;
}

async function listActiveBrowserAuthorizations(
  db: RelayDatabase,
  deviceId: string,
): Promise<BrowserAuthorizationRecord[]> {
  const result = await db
    .prepare(
      `SELECT id, device_id, user_id, name, key_id, created_at, last_seen_at
         FROM relay_browser_authorizations
        WHERE device_id = ? AND revoked_at IS NULL
        ORDER BY created_at ASC`,
    )
    .bind(deviceId)
    .all<BrowserAuthorizationRecord>();
  return result.results ?? [];
}

function requireActiveBrowser(
  message: JsonObject,
  activeBrowsers: Map<string, BrowserAuthorizationRecord>,
): BrowserAuthorizationRecord {
  const browserId = requireIdentifier(message.browser_id, "browser_id");
  const browser = activeBrowsers.get(browserId);
  if (!browser) {
    throw new ApiError(
      403,
      "browser_revoked",
      "Encrypted payload targets a browser that is not authorized.",
    );
  }
  return browser;
}

function assertEnvelopeKey(
  serializedEnvelope: string,
  expectedKeyId: string,
): void {
  const envelope = JSON.parse(serializedEnvelope) as Envelope;
  if (envelope.kid !== expectedKeyId) {
    throw new ApiError(
      400,
      "browser_key_mismatch",
      "Encrypted payload key does not match the browser authorization.",
    );
  }
}

function requireRelayBearer(request: Request): string {
  const relayHeader = request.headers.get("x-relay-device-token")?.trim();
  if (relayHeader && /^[A-Za-z0-9_-]{16,512}$/.test(relayHeader)) {
    return relayHeader;
  }
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{16,512})$/.exec(authorization);
  if (!match) {
    throw new ApiError(
      401,
      "relay_unauthorized",
      "A relay bearer token is required.",
    );
  }
  return match[1];
}

async function requireOwnedDevice(
  db: RelayDatabase,
  userId: string,
  deviceId: string,
): Promise<DeviceRecord> {
  const device = await db
    .prepare(
      `SELECT id, user_id, name, identity_public_key, encrypted_descriptor,
              key_epoch, protocol_version, ack_seq, created_at, last_seen_at
         FROM relay_devices
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .bind(deviceId, userId)
    .first<DeviceRecord>();
  if (!device) {
    throw new ApiError(404, "device_not_found", "Relay device not found.");
  }
  return device;
}

const ackScans = new WeakMap<RelayDatabase, Map<string, Promise<number>>>();
async function coalescedEventAck(db: RelayDatabase, deviceId: string, currentAck: number) {
  let pending = ackScans.get(db);
  if (!pending) { pending = new Map(); ackScans.set(db, pending); }
  const existing = pending.get(deviceId);
  if (existing) return Math.max(currentAck, await existing);
  if (pending.size >= 256) return currentAck;
  const task = advanceEventAck(db, deviceId, currentAck);
  pending.set(deviceId, task);
  try { return await task; } finally { pending.delete(deviceId); }
}

async function advanceEventAck(
  db: RelayDatabase,
  deviceId: string,
  currentAck: number,
): Promise<number> {
  let ack = currentAck;
  for (let page = 0; page < 10; page += 1) {
    const result = await db
      .prepare(
        `SELECT event_seq
           FROM relay_events
          WHERE device_id = ? AND event_seq > ?
          ORDER BY event_seq ASC
          LIMIT 500`,
      )
      .bind(deviceId, ack)
      .all<{ event_seq: number }>();
    const rows = result.results ?? [];
    if (!rows.length) break;
    let advanced = false;
    for (const row of rows) {
      if (row.event_seq === ack + 1) {
        ack = row.event_seq;
        advanced = true;
        continue;
      }
      if (row.event_seq > ack + 1) return ack;
    }
    if (!advanced || rows.length < 500) break;
  }
  return ack;
}

function assertEnvelopeAad(envelope: string, aad: RelayAad) {
  const encoded = (JSON.parse(envelope) as Envelope).aad;
  let decoded: Record<string, unknown>;
  try { decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); }
  catch { throw new ApiError(400, "invalid_aad", "Envelope routing metadata does not match."); }
  if (!decoded || typeof decoded !== "object" || Object.keys(decoded).length !== Object.keys(aad).length ||
      Object.entries(aad).some(([key, value]) => decoded[key] !== value)) {
    throw new ApiError(400, "invalid_aad", "Envelope routing metadata does not match.");
  }
}

function serializeEnvelope(
  value: unknown,
  maxBytes = MAX_ENVELOPE_BYTES,
): string {
  const envelope = validateEnvelope(value);
  const serialized = JSON.stringify(envelope);
  if (utf8Size(serialized) > maxBytes) {
    throw new ApiError(
      413,
      "envelope_too_large",
      "Encrypted envelope exceeds the route limit.",
    );
  }
  return serialized;
}

function validateEnvelope(value: unknown): Envelope {
  const envelope = requireObject(value, "envelope");
  const fields = Object.keys(envelope).sort();
  const expectedFields = ["aad", "alg", "ciphertext", "iv", "kid", "v"];
  if (
    fields.length !== expectedFields.length ||
    fields.some((field, index) => field !== expectedFields[index])
  ) {
    throw new ApiError(
      400,
      "invalid_envelope",
      "Envelope has missing or unsupported fields.",
    );
  }
  if (envelope.v !== 2 || envelope.alg !== "A256GCM") {
    throw new ApiError(
      400,
      "unsupported_envelope",
      "Only v2 A256GCM opaque envelopes are accepted.",
    );
  }
  if (
    typeof envelope.kid !== "string" ||
    !/^sha256:[A-Za-z0-9_-]{43}$/.test(envelope.kid)
  ) {
    throw new ApiError(400, "invalid_envelope", "Envelope key id is invalid.");
  }
  if (
    typeof envelope.iv !== "string" ||
    !isBase64Url(envelope.iv) ||
    decodedBase64UrlLength(envelope.iv) !== 12
  ) {
    throw new ApiError(400, "invalid_envelope", "Envelope IV is invalid.");
  }
  if (typeof envelope.aad !== "string" || !isBase64Url(envelope.aad)) {
    throw new ApiError(400, "invalid_envelope", "Envelope AAD is invalid.");
  }
  if (
    typeof envelope.ciphertext !== "string" ||
    !isBase64Url(envelope.ciphertext) ||
    decodedBase64UrlLength(envelope.ciphertext) < 16
  ) {
    throw new ApiError(
      400,
      "invalid_envelope",
      "Envelope ciphertext is invalid.",
    );
  }
  return {
    v: 2,
    alg: "A256GCM",
    kid: envelope.kid,
    iv: envelope.iv,
    aad: envelope.aad,
    ciphertext: envelope.ciphertext,
  };
}

function validateAad(value: unknown): RelayAad {
  const aad = requireObject(value, "aad");
  const fields = Object.keys(aad).sort();
  const expectedFields = [
    "created_at",
    "device_id",
    "direction",
    "event_seq",
    "expires_at",
    "request_id",
    "session_id",
    "type",
  ];
  if (
    fields.length !== expectedFields.length ||
    fields.some((field, index) => field !== expectedFields[index])
  ) {
    throw new ApiError(
      400,
      "invalid_aad",
      "AAD has missing or unsupported routing fields.",
    );
  }
  const direction =
    aad.direction === "web_to_relay" || aad.direction === "relay_to_web"
      ? aad.direction
      : null;
  if (!direction) {
    throw new ApiError(400, "invalid_aad", "AAD direction is invalid.");
  }
  const type = requireRoutingType(aad.type);
  const deviceId = requireIdentifier(aad.device_id, "aad.device_id");
  const sessionId = optionalIdentifier(aad.session_id, "aad.session_id");
  const requestId = optionalIdentifier(aad.request_id, "aad.request_id");
  const eventSeq =
    aad.event_seq == null
      ? null
      : requirePositiveInteger(aad.event_seq, "aad.event_seq");
  if (
    typeof aad.created_at !== "string" ||
    !Number.isFinite(Date.parse(aad.created_at))
  ) {
    throw new ApiError(400, "invalid_aad", "AAD created_at is invalid.");
  }
  if (
    aad.expires_at !== null &&
    (typeof aad.expires_at !== "string" ||
      !Number.isFinite(Date.parse(aad.expires_at)))
  ) {
    throw new ApiError(400, "invalid_aad", "AAD expires_at is invalid.");
  }
  return {
    direction,
    type,
    device_id: deviceId,
    session_id: sessionId,
    request_id: requestId,
    event_seq: eventSeq,
    created_at: aad.created_at,
    expires_at: aad.expires_at as string | null,
  };
}

function validateAadRoute(
  aad: RelayAad,
  route: {
    direction: RelayAad["direction"];
    type?: string;
    deviceId: string;
    sessionId: string | null;
    requestId: string | null;
    eventSeq: number | null;
  },
): void {
  if (
    aad.direction !== route.direction ||
    (route.type !== undefined && aad.type !== route.type) ||
    aad.device_id !== route.deviceId ||
    aad.session_id !== route.sessionId ||
    aad.request_id !== route.requestId ||
    aad.event_seq !== route.eventSeq
  ) {
    throw new ApiError(
      400,
      "aad_route_mismatch",
      "AAD routing fields do not match the outer frame.",
    );
  }
}

function validateAndSerializeAad(
  value: unknown,
  route: {
    direction: RelayAad["direction"];
    type?: string;
    deviceId: string;
    sessionId: string | null;
    requestId: string | null;
    eventSeq: number | null;
  },
): string {
  const aad = validateAad(value);
  validateAadRoute(aad, route);
  return JSON.stringify(aad);
}

function timeFromAad(value: unknown, fallback: number): number {
  const aad =
    value && typeof value === "object" && "created_at" in value
      ? (value as { created_at?: unknown })
      : null;
  return aad && typeof aad.created_at === "string"
    ? optionalTime(aad.created_at, fallback, "aad.created_at")
    : fallback;
}

function parseStoredEnvelope(value: unknown): Envelope {
  return JSON.parse(String(value)) as Envelope;
}

function parseStoredAad(value: unknown): RelayAad {
  return JSON.parse(String(value)) as RelayAad;
}

function eventFrameFromRow(
  deviceId: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  return {
    cursor: row.cursor,
    event_id: row.event_id,
    event_seq: row.event_seq,
    device_id: deviceId,
    session_id: row.session_id,
    agent_id: row.agent_id,
    request_id: row.request_id,
    created_at: isoTime(row.created_at),
    aad: parseStoredAad(row.aad),
    envelope: parseStoredEnvelope(row.envelope),
  };
}

async function readJson(
  request: Request,
  maxBytes = MAX_JSON_BYTES,
): Promise<JsonObject> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiError(413, "request_too_large", "Request body is too large.");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new ApiError(413, "request_too_large", "Request body is too large.");
  }
  if (!bytes.byteLength) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON.");
  }
  return requireObject(parsed, "body");
}

function requireObject(value: unknown, field: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "invalid_object", `${field} must be an object.`);
  }
  return value as JsonObject;
}

function requireArray(
  value: unknown,
  field: string,
  maxLength: number,
): unknown[] {
  if (!Array.isArray(value)) {
    throw new ApiError(400, "invalid_array", `${field} must be an array.`);
  }
  if (value.length > maxLength) {
    throw new ApiError(
      400,
      "array_too_large",
      `${field} may contain at most ${maxLength} items.`,
    );
  }
  return value;
}

function requireIdentifierArray(
  value: unknown,
  field: string,
  maxLength: number,
): string[] {
  return requireArray(value ?? [], field, maxLength).map((item) =>
    requireIdentifier(item, field),
  );
}

function requireIdentifier(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)
  ) {
    throw new ApiError(400, "invalid_identifier", `${field} is invalid.`);
  }
  return value;
}

function optionalIdentifier(value: unknown, field: string): string | null {
  return value == null || value === "" ? null : requireIdentifier(value, field);
}

function requireText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new ApiError(400, "invalid_text", `${field} is invalid.`);
  }
  return value.trim();
}

function requirePositiveInteger(value: unknown, field: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new ApiError(
      400,
      "invalid_integer",
      `${field} must be a positive integer.`,
    );
  }
  return number;
}

function optionalPositiveInteger(
  value: unknown,
  fallback: number,
  field: string,
): number {
  return value === undefined ? fallback : requirePositiveInteger(value, field);
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined || value === null || value === "") return fallback;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new ApiError(
      400,
      "invalid_integer",
      `Integer must be between ${minimum} and ${maximum}.`,
    );
  }
  return number;
}

function requireRoutingType(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_.-]{0,79}$/.test(value)) {
    throw new ApiError(400, "invalid_type", "Routing type is invalid.");
  }
  return value;
}

function requireAckStatus(value: unknown): string {
  if (
    ![
      "accepted",
      "completed",
      "rejected",
      "expired",
      "duplicate",
      "failed",
    ].includes(String(value))
  ) {
    throw new ApiError(
      400,
      "invalid_ack_status",
      "Command ack status is invalid.",
    );
  }
  return String(value);
}

function optionalTime(value: unknown, fallback: number, field: string): number {
  if (value === undefined || value === null) return fallback;
  const time =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Date.parse(value)
        : Number.NaN;
  if (!Number.isFinite(time) || time < 0) {
    throw new ApiError(400, "invalid_time", `${field} is invalid.`);
  }
  return Math.floor(time);
}

function assertDeviceTarget(value: unknown, deviceId: string): void {
  if (value !== undefined && value !== deviceId) {
    throw new ApiError(
      403,
      "device_mismatch",
      "Request targets a different relay device.",
    );
  }
}

function decodePathSegment(value: string): string {
  try {
    return requireIdentifier(decodeURIComponent(value), "device_id");
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_path", "Relay API path is invalid.");
  }
}

function isoTime(value: unknown): string {
  const number = Number(value);
  return new Date(Number.isFinite(number) ? number : 0).toISOString();
}

function nullableIsoTime(value: unknown): string | null {
  return value == null ? null : isoTime(value);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: apiHeaders(),
  });
}

function apiHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return headers;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function utf8Size(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isBase64Url(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function decodedBase64UrlLength(value: string): number {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return atob(padded).length;
  } catch {
    return -1;
  }
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
