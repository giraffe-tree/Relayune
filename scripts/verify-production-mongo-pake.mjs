import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";
import { MockCodexAdapter } from "../relay/codex-adapters.mjs";
import { keyIdForKey, openJson, sealJson } from "../relay/e2ee.mjs";
import { MacRelay } from "../relay/mac-relay.mjs";
import { verifyProductionRealtime } from "./production-realtime-smoke.mjs";
import {
  createPairingInitiator,
  finishPairingInitiator,
  PAIRING_PROTOCOL,
  randomRelayToken,
  respondToPairing,
  sha256Hex,
  verifyDesktopConfirmation,
} from "../shared/pairing-pake.ts";

const origin = required("RELAY_SERVER_URL");
const publicOrigin = process.env.PUBLIC_ORIGIN?.trim() || new URL(origin).origin;
const email = verificationEmail();
const verifyEmailDelivery =
  process.env.RELAY_VERIFY_EMAIL_DELIVERY !== "false";
const mongoDatabase = required("MONGO_DATABASE");
const mongoUser = required("MONGO_USER");
const mongoPassword = (
  await readFile(required("MONGO_PASSWORD_FILE"), "utf8")
).trim();
const mongoHost = process.env.MONGO_HOST?.trim() || "127.0.0.1";
const mongoPort = Number(process.env.MONGO_PORT || "27017");
const blobRoot = path.resolve(required("RELAY_BLOB_DIR"));
const statePath = required("RELAY_STATE_PATH");
const startedAt = new Date();
const sessionToken = randomBytes(32).toString("base64url");
const sessionTokenHash = sha256(sessionToken);
const canary = `PRODUCTION_E2EE_CANARY_${randomUUID()}`;
const client = new MongoClient(`mongodb://${mongoHost}:${mongoPort}`, {
  auth: { username: mongoUser, password: mongoPassword },
  authSource: mongoDatabase,
  directConnection: true,
  serverSelectionTimeoutMS: 5_000,
});
const db = client.db(mongoDatabase);
const pairingIds = [];
let deviceId = null;
let browserId = null;
let browserToken = null;
let requestId = null;
let magicLinkId = null;
let blobFilename = null;
let relay = null;

try {
  await client.connect();
  await db.command({ ping: 1 });
  await db.collection("auth_sessions").insertOne({
    _id: sessionTokenHash,
    token_hash: sessionTokenHash,
    email,
    created_at: startedAt,
    expires_at: new Date(startedAt.getTime() + 10 * 60_000),
    revoked_at: null,
    request_ip_hash: sha256("production-verifier"),
    user_agent_hash: sha256("production-verifier"),
  });

  if (verifyEmailDelivery) {
    const magicResponse = await fetch(new URL("/api/auth/magic-link", origin), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: publicOrigin,
      },
      body: JSON.stringify({ email }),
    });
    assertStatus(magicResponse, 202, "Magic Link request");
    const magicLink = await db.collection("auth_magic_links").findOne(
      { email, created_at: { $gte: startedAt } },
      { sort: { created_at: -1 } },
    );
    if (
      !magicLink ||
      typeof magicLink.token_hash !== "string" ||
      magicLink.token_hash.length !== 64 ||
      "token" in magicLink
    ) {
      throw new Error("Magic Link storage is not hash-only.");
    }
    magicLinkId = magicLink._id;
  }

  const paired = await completeProductionPairing();
  deviceId = paired.deviceId;
  browserId = paired.browserId;
  browserToken = paired.browserToken;
  const pairedBootstrap = await browserApi(
    `/api/bootstrap?device_id=${encodeURIComponent(deviceId)}`,
  );
  if (pairedBootstrap.device?.id !== deviceId) {
    throw new Error("Targeted bootstrap did not return the paired device.");
  }

  const wrongPairing = await createPairingInitiator();
  pairingIds.push(wrongPairing.pairingId);
  await startPairing(wrongPairing);
  const wrongCode =
    wrongPairing.code === "AAAA-AAAA" ? "BBBB-BBBB" : "AAAA-AAAA";
  const wrongBrowser = await respondToPairing(
    wrongPairing.pairingId,
    wrongCode,
    wrongPairing.initiatorShare,
  );
  await browserApi(
    `/api/browser/pairings/${wrongPairing.pairingId}/respond`,
    {
      method: "POST",
      body: JSON.stringify({
        protocol: PAIRING_PROTOCOL,
        responder_share: wrongBrowser.responderShare,
        responder_confirm: wrongBrowser.responderConfirm,
        browser_token_hash: await sha256Hex(randomRelayToken()),
        browser_key_id: await keyIdForKey(wrongBrowser.contentKey),
        browser_name: "Wrong-code verifier",
      }),
    },
  );
  await assertRejects(
    finishPairingInitiator(
      wrongPairing,
      wrongBrowser.responderShare,
      wrongBrowser.responderConfirm,
    ),
    "错误连接码必须在双向确认阶段被拒绝",
  );

  const adapter = new MockCodexAdapter({
    workspace: process.cwd(),
    historyMessages: [
      {
        id: "production_verify_history",
        role: "codex",
        content: `${canary} ${"x".repeat(360_000)}`,
        created_at: new Date().toISOString(),
        turn_id: "production_verify_turn",
      },
    ],
  });
  adapter.mockSessions[0].name = `${canary} encrypted catalog`;
  requestId = `verify_${randomUUID()}`;
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  const commandType = "session.read_history";
  const aad = {
    direction: "web_to_relay",
    type: commandType,
    device_id: deviceId,
    session_id: adapter.mockSessions[0].id,
    request_id: requestId,
    event_seq: null,
    created_at: issuedAt,
    expires_at: expiresAt,
  };
  const command = {
    type: commandType,
    request_id: requestId,
    device_id: deviceId,
    session_id: adapter.mockSessions[0].id,
    payload: { limit: 1, before: null, proof_canary: canary },
    issued_at: issuedAt,
    expires_at: expiresAt,
  };
  await browserApi("/api/commands", {
    method: "POST",
    headers: { "Idempotency-Key": requestId },
    body: JSON.stringify({
      device_id: deviceId,
      session_id: adapter.mockSessions[0].id,
      request_id: requestId,
      command_type: commandType,
      created_at: issuedAt,
      expires_at: expiresAt,
      aad,
      envelope: await sealJson(paired.contentKey, command, aad),
    }),
  });
  const queued = await db.collection("relay_commands").findOne({
    id: requestId,
    device_id: deviceId,
  });
  if (queued?.status !== "queued") {
    throw new Error("Encrypted offline command was not queued.");
  }

  relay = new MacRelay({
    serverUrl: origin,
    deviceId,
    deviceToken: paired.deviceToken,
    browserKeys: [{ browserId, e2eeKey: paired.contentKey }],
    adapter,
    pollIntervalMs: 30,
    statePath,
  });
  await relay.start();
  await relay.waitUntilReady(10_000);

  let bootstrap;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    bootstrap = await browserApi(
      `/api/bootstrap?device_id=${encodeURIComponent(deviceId)}`,
    );
    if (bootstrap.device?.online && bootstrap.catalog) break;
    await delay(50);
  }
  if (!bootstrap?.device?.online || !bootstrap.catalog) {
    throw new Error("Paired Relay did not publish its encrypted catalog.");
  }
  const catalog = await openJson(
    paired.contentKey,
    bootstrap.catalog.envelope,
    bootstrap.catalog.aad,
  );
  if (!catalog.sessions?.[0]?.name.includes(canary)) {
    throw new Error("Encrypted catalog did not round-trip.");
  }

  const realtimeCanary = `${canary}_REALTIME`;
  const realtimeRequestId = `verify_realtime_${randomUUID()}`;
  const realtimeIssuedAt = new Date().toISOString();
  const realtimeExpiresAt = new Date(Date.now() + 120_000).toISOString();
  const realtimeType = "session.submit_message";
  const realtimeAad = {
    direction: "web_to_relay",
    type: realtimeType,
    device_id: deviceId,
    session_id: adapter.mockSessions[0].id,
    request_id: realtimeRequestId,
    event_seq: null,
    created_at: realtimeIssuedAt,
    expires_at: realtimeExpiresAt,
  };
  const realtimeCommand = {
    type: realtimeType,
    request_id: realtimeRequestId,
    device_id: deviceId,
    session_id: adapter.mockSessions[0].id,
    payload: {
      content: realtimeCanary,
      client_message_id: `verify_client_${randomUUID()}`,
    },
    issued_at: realtimeIssuedAt,
    expires_at: realtimeExpiresAt,
  };
  const realtimeSmoke = await verifyProductionRealtime({
    origin,
    publicOrigin,
    sessionToken,
    browserToken,
    deviceId,
    plaintextCanary: realtimeCanary,
    trigger: async () =>
      browserApi("/api/commands", {
        method: "POST",
        headers: { "Idempotency-Key": realtimeRequestId },
        body: JSON.stringify({
          device_id: deviceId,
          session_id: adapter.mockSessions[0].id,
          request_id: realtimeRequestId,
          command_type: realtimeType,
          created_at: realtimeIssuedAt,
          expires_at: realtimeExpiresAt,
          aad: realtimeAad,
          envelope: await sealJson(
            paired.contentKey,
            realtimeCommand,
            realtimeAad,
          ),
        }),
      }),
  });
  const realtimeEvents = await browserApi(
    `/api/events?device_id=${encodeURIComponent(deviceId)}&cursor=0&limit=100`,
  );
  const openedRealtimeEvents = await Promise.all(
    realtimeEvents.events.map((frame) =>
      openJson(paired.contentKey, frame.envelope, frame.aad),
    ),
  );
  if (
    !openedRealtimeEvents.some(
      (event) =>
        event.type === "session.event" &&
        event.event?.kind === "user.message" &&
        event.event?.text === realtimeCanary,
    )
  ) {
    throw new Error("Production realtime opaque event did not round-trip.");
  }

  let responseFrame;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const response = await fetch(
      new URL(`/api/responses/${encodeURIComponent(requestId)}`, origin),
      { headers: authHeaders() },
    );
    if (response.ok) {
      responseFrame = await response.json();
      break;
    }
    if (response.status !== 404) {
      throw new Error(`Encrypted response polling failed (${response.status}).`);
    }
    await delay(50);
  }
  if (!responseFrame) {
    throw new Error("Timed out waiting for encrypted offline response.");
  }
  const decrypted = await openJson(
    paired.contentKey,
    responseFrame.envelope,
    responseFrame.aad,
  );
  if (
    decrypted.type !== "session.history" ||
    !decrypted.messages?.[0]?.content.includes(canary)
  ) {
    throw new Error("Encrypted response did not round-trip.");
  }

  const storedResponse = await db
    .collection("relay_responses")
    .findOne({ request_id: requestId });
  if (
    typeof storedResponse?.blob_key !== "string" ||
    storedResponse.envelope !== null
  ) {
    throw new Error("Large encrypted response was not moved to private blob storage.");
  }
  blobFilename = safeBlobPath(storedResponse.blob_key);
  const blobContent = await readFile(blobFilename, "utf8");
  if (blobContent.includes(canary)) {
    throw new Error("Private blob contains application plaintext.");
  }

  const serverDocuments = {};
  for (const name of [
    "relay_pake_pairings",
    "relay_devices",
    "relay_browser_authorizations",
    "relay_catalogs",
    "relay_commands",
    "relay_responses",
    "relay_events",
  ]) {
    serverDocuments[name] = await db
      .collection(name)
      .find({
        $or: [
          { _id: { $in: pairingIds } },
          { id: deviceId },
          { device_id: deviceId },
          { request_id: requestId },
        ],
      })
      .toArray();
  }
  const serverVisible = JSON.stringify(serverDocuments);
  if (
    serverVisible.includes(canary) ||
    serverVisible.includes(paired.contentKey) ||
    serverVisible.includes(paired.deviceToken)
  ) {
    throw new Error("MongoDB persisted a verifier plaintext secret.");
  }

  const rejectedBearer = await fetch(new URL("/api/relay/hello", origin), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${randomRelayToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ device_id: deviceId }),
  });
  assertStatus(rejectedBearer, 401, "Invalid device bearer");

  const rejectedBrowser = await fetch(
    new URL(
      `/api/bootstrap?device_id=${encodeURIComponent(deviceId)}`,
      origin,
    ),
    {
      headers: {
        Cookie: `relay_session=${sessionToken}`,
        "X-Relay-Browser-Token": randomRelayToken(),
      },
    },
  );
  assertStatus(rejectedBrowser, 401, "Invalid browser authorization");

  await relay.stop();
  relay = null;
  const revokeResponse = await fetch(new URL("/api/relay/logout", origin), {
    method: "POST",
    headers: { Authorization: `Bearer ${paired.deviceToken}` },
  });
  assertStatus(revokeResponse, 200, "Device logout");
  const revokedBearer = await fetch(new URL("/api/relay/hello", origin), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${paired.deviceToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ device_id: deviceId }),
  });
  assertStatus(revokedBearer, 401, "Revoked device bearer");

  const logoutResponse = await fetch(new URL("/api/auth/logout", origin), {
    method: "POST",
    headers: { ...authHeaders(), Origin: publicOrigin },
  });
  assertStatus(logoutResponse, 200, "Web logout");
  const revokedSession = await fetch(new URL("/api/bootstrap", origin), {
    headers: authHeaders(),
  });
  assertStatus(revokedSession, 401, "Revoked web session");

  console.log(
    JSON.stringify({
      ok: true,
      protocol: PAIRING_PROTOCOL,
      email_magic_link_delivered: verifyEmailDelivery,
      targeted_device_bootstrap: true,
      wrong_code_rejected: true,
      offline_queue_round_trip: true,
      large_response_private_blob: true,
      mongo_plaintext_canary_found: false,
      invalid_bearer_rejected: true,
      invalid_browser_authorization_rejected: true,
      revoked_bearer_rejected: true,
      realtime: realtimeSmoke,
    }),
  );
} finally {
  await relay?.stop().catch(() => {});
  if (deviceId) {
    await Promise.all([
      db.collection("relay_catalogs").deleteMany({ device_id: deviceId }),
      db.collection("relay_commands").deleteMany({ device_id: deviceId }),
      db.collection("relay_responses").deleteMany({ device_id: deviceId }),
      db.collection("relay_events").deleteMany({ device_id: deviceId }),
      db
        .collection("relay_browser_authorizations")
        .deleteMany({ device_id: deviceId }),
      db.collection("relay_devices").deleteMany({ id: deviceId }),
    ]).catch(() => {});
  }
  if (pairingIds.length) {
    await db
      .collection("relay_pake_pairings")
      .deleteMany({ _id: { $in: pairingIds } })
      .catch(() => {});
  }
  await db
    .collection("auth_sessions")
    .deleteOne({ _id: sessionTokenHash })
    .catch(() => {});
  if (magicLinkId) {
    await db
      .collection("auth_magic_links")
      .deleteOne({ _id: magicLinkId })
      .catch(() => {});
  }
  await client.close().catch(() => {});
  await rm(statePath, { force: true }).catch(() => {});
  if (blobFilename) await rm(blobFilename, { force: true }).catch(() => {});
}

async function completeProductionPairing() {
  const desktop = await createPairingInitiator();
  pairingIds.push(desktop.pairingId);
  await startPairing(desktop);
  const waiting = await publicApi(`/api/pairings/${desktop.pairingId}`);
  const browser = await respondToPairing(
    desktop.pairingId,
    desktop.code,
    waiting.initiator_share,
  );
  const browserToken = randomRelayToken();
  const responded = await browserApi(
    `/api/browser/pairings/${desktop.pairingId}/respond`,
    {
      method: "POST",
      body: JSON.stringify({
        protocol: PAIRING_PROTOCOL,
        responder_share: browser.responderShare,
        responder_confirm: browser.responderConfirm,
        browser_token_hash: await sha256Hex(browserToken),
        browser_key_id: await keyIdForKey(browser.contentKey),
        browser_name: "Production verifier browser",
      }),
    },
  );
  const response = await publicApi(`/api/pairings/${desktop.pairingId}`);
  const finished = await finishPairingInitiator(
    desktop,
    response.responder_share,
    response.responder_confirm,
  );
  const deviceToken = randomRelayToken();
  const completed = await publicApi(`/api/pairings/${desktop.pairingId}/complete`, {
    method: "POST",
    body: JSON.stringify({
      desktop_confirm: finished.desktopConfirm,
      relay_token_hash: await sha256Hex(deviceToken),
      name: "Production verifier",
    }),
  });
  const paired = await publicApi(`/api/pairings/${desktop.pairingId}`);
  verifyDesktopConfirmation(browser.expectedDesktopConfirm, paired.desktop_confirm);
  if (completed.browser_id !== responded.browser_id) {
    throw new Error("Paired browser authorization changed during completion.");
  }
  return {
    deviceId: completed.device_id,
    browserId: completed.browser_id,
    browserToken,
    deviceToken,
    contentKey: finished.contentKey,
  };
}

async function startPairing(desktop) {
  await publicApi("/api/pairings/start", {
    method: "POST",
    body: JSON.stringify({
      pairing_id: desktop.pairingId,
      protocol: PAIRING_PROTOCOL,
      initiator_share: desktop.initiatorShare,
    }),
  });
}

async function publicApi(apiPath, options = {}) {
  return jsonApi(apiPath, options, {});
}

async function browserApi(apiPath, options = {}) {
  return jsonApi(apiPath, options, authHeaders());
}

async function jsonApi(apiPath, options, extraHeaders) {
  const response = await fetch(new URL(apiPath, origin), {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...extraHeaders,
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      body?.error?.message || `Production verification failed (${response.status}).`,
    );
  }
  return body;
}

function authHeaders() {
  return {
    Cookie: `relay_session=${sessionToken}`,
    ...(browserToken
      ? { "X-Relay-Browser-Token": browserToken }
      : {}),
  };
}

function safeBlobPath(key) {
  if (!/^[A-Za-z0-9._/-]+$/.test(key) || key.includes("..")) {
    throw new Error("Verifier received an invalid blob key.");
  }
  const filename = path.resolve(blobRoot, key);
  if (!filename.startsWith(`${blobRoot}${path.sep}`)) {
    throw new Error("Verifier blob key escaped the private root.");
  }
  return filename;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function verificationEmail() {
  const email = required("RELAY_WEB_EMAIL").trim();
  if (!email) throw new Error("A Relay verification email is required.");
  return email.toLowerCase();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label} returned ${response.status}, expected ${expected}.`);
  }
}

async function assertRejects(promise, label) {
  try {
    await promise;
  } catch {
    return;
  }
  throw new Error(label);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
