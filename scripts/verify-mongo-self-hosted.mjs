import { createHash, randomBytes, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MongoClient } from "mongodb";
import { MockCodexAdapter } from "../relay/codex-adapters.mjs";
import { keyIdForKey, openJson, sealJson } from "../relay/e2ee.mjs";
import { MacRelay } from "../relay/mac-relay.mjs";

const origin = required("RELAY_SERVER_URL");
const authOrigin = process.env.PUBLIC_ORIGIN?.trim() || new URL(origin).origin;
const mongoUri = required("MONGO_TEST_URI");
const mongoDatabase = required("MONGO_DATABASE");
const isolationToken = required("RELAY_TEST_ISOLATION_TOKEN");
// This verifier inserts synthetic authorizations and requests mail. It must never
// be pointed at a deployed service or a maintainer database.
const serviceUrl = new URL(origin);
const databaseUrl = new URL(mongoUri);
const authenticationUrl = new URL(authOrigin);
if (serviceUrl.protocol !== "http:" || serviceUrl.hostname !== "127.0.0.1" || !serviceUrl.port || serviceUrl.username || serviceUrl.password ||
    databaseUrl.protocol !== "mongodb:" || databaseUrl.hostname !== "127.0.0.1" || !databaseUrl.port || databaseUrl.username || databaseUrl.password || databaseUrl.search || !["", "/"].includes(databaseUrl.pathname) ||
    !/^isolated_[A-Za-z0-9_]{1,48}$/.test(mongoDatabase) || !/^[A-Za-z0-9_-]{43}$/.test(isolationToken) || authenticationUrl.protocol !== "https:" || authenticationUrl.hostname !== "127.0.0.1" || authenticationUrl.port !== serviceUrl.port || authOrigin !== authenticationUrl.origin) {
  throw new Error("Mongo verifier requires an owned isolated loopback fixture; production targets are forbidden.");
}
const webEmail = required("RELAY_WEB_EMAIL").toLowerCase();
if (!webEmail.endsWith("@example.invalid")) throw new Error("Mongo verifier requires a synthetic example.invalid account.");
const deviceId = required("RELAY_DEVICE_ID");
const deviceToken = required("RELAY_DEVICE_TOKEN");
const e2eeKey = required("RELAY_E2EE_KEY");
const browserId = `web_${randomBytes(16).toString("hex")}`;
const browserToken = randomBytes(32).toString("base64url");
const browserKeyId = await keyIdForKey(e2eeKey);
const statePath = path.resolve(required("RELAY_STATE_PATH"));
const stateDirectory = path.dirname(statePath);
if (!stateDirectory.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(stateDirectory).startsWith("relay-mongo-integration-") || path.basename(statePath) !== "relay-state.json") {
  throw new Error("Mongo verifier state must use its own temporary fixture directory.");
}
const canary = `MONGO_E2EE_CANARY_${randomUUID()}`;
const sessionToken = randomBytes(32).toString("base64url");
const sessionTokenHash = sha256(sessionToken);
const client = new MongoClient(mongoUri, {
  directConnection: true,
  serverSelectionTimeoutMS: 5_000,
});
const db = client.db(mongoDatabase);
let relay;
let fixtureOwned = false;

try {
  await client.connect();
  const marker = await db.collection("relay_test_isolation").findOne({
    _id: "fixture", token_hash: sha256(isolationToken), expires_at: { $gt: new Date() },
  });
  if (!marker) throw new Error("Mongo verifier isolation ownership marker missing.");
  fixtureOwned = true;
  const device = await db.collection("relay_devices").findOne({
    id: deviceId,
    relay_token_hash: sha256(deviceToken),
    revoked_at: null,
  });
  if (!device) {
    throw new Error("RELAY_DEVICE_ID / RELAY_DEVICE_TOKEN 不是已配对设备。");
  }
  const now = new Date();
  await db.collection("relay_browser_authorizations").insertOne({
    _id: browserId,
    id: browserId,
    device_id: deviceId,
    user_id: device.user_id,
    name: "Mongo verifier browser",
    token_hash: sha256(browserToken),
    key_id: browserKeyId,
    created_at: now.getTime(),
    last_seen_at: null,
    revoked_at: null,
  });
  await db.collection("auth_sessions").insertOne({
    _id: sessionTokenHash,
    token_hash: sessionTokenHash,
    email: webEmail,
    created_at: now,
    expires_at: new Date(now.getTime() + 10 * 60_000),
    revoked_at: null,
    request_ip_hash: sha256("integration"),
    user_agent_hash: sha256("integration"),
  });

  const magicResponse = await fetch(new URL("/api/auth/magic-link", origin), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: authOrigin,
    },
    body: JSON.stringify({ email: webEmail }),
  });
  assertStatus(magicResponse, 202, "Magic Link request");
  const magicLink = await db.collection("auth_magic_links").findOne({
    email: webEmail,
    used_at: null,
  });
  if (
    !magicLink ||
    typeof magicLink.token_hash !== "string" ||
    magicLink.token_hash.length !== 64 ||
    "token" in magicLink
  ) {
    throw new Error("Magic Link storage is not hash-only.");
  }

  const adapter = new MockCodexAdapter({
    workspace: process.cwd(),
    historyMessages: [
      {
        id: "mongo_history",
        role: "codex",
        content: `${canary} private history`,
        created_at: new Date().toISOString(),
        turn_id: "mongo_turn",
      },
    ],
  });
  adapter.mockSessions[0].name = `${canary} private catalog`;
  relay = new MacRelay({
    serverUrl: origin,
    deviceId,
    deviceToken,
    pollIntervalMs: 30,
    browserKeys: [{ browserId, e2eeKey }],
    adapter,
    statePath,
  });
  await relay.start();
  await relay.waitUntilReady(10_000);

  let bootstrap;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    bootstrap = await api(
      `/api/bootstrap?device_id=${encodeURIComponent(deviceId)}`,
    );
    if (bootstrap.device?.online && bootstrap.catalog) break;
    await delay(50);
  }
  if (!bootstrap?.device?.online || !bootstrap.catalog) {
    throw new Error("Mongo-backed Relay did not publish an online catalog.");
  }
  const catalog = await openJson(
    e2eeKey,
    bootstrap.catalog.envelope,
    bootstrap.catalog.aad,
  );
  const session = catalog.sessions?.[0];
  if (!session?.id || !session.name.includes(canary)) {
    throw new Error("Encrypted catalog did not round-trip.");
  }

  const requestId = `verify_${randomUUID()}`;
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  const type = "session.read_history";
  const aad = {
    direction: "web_to_relay",
    type,
    device_id: bootstrap.device.id,
    session_id: session.id,
    request_id: requestId,
    event_seq: null,
    created_at: issuedAt,
    expires_at: expiresAt,
  };
  const command = {
    type,
    request_id: requestId,
    device_id: bootstrap.device.id,
    session_id: session.id,
    payload: { limit: 1, before: null, proof_canary: canary },
    issued_at: issuedAt,
    expires_at: expiresAt,
  };
  await api("/api/commands", {
    method: "POST",
    headers: { "Idempotency-Key": requestId },
    body: JSON.stringify({
      device_id: bootstrap.device.id,
      session_id: session.id,
      request_id: requestId,
      command_type: type,
      created_at: issuedAt,
      expires_at: expiresAt,
      aad,
      envelope: await sealJson(e2eeKey, command, aad),
    }),
  });

  let responseFrame;
  for (let attempt = 0; attempt < 200; attempt += 1) {
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
    await delay(25);
  }
  if (!responseFrame) {
    throw new Error("Timed out waiting for the encrypted Mongo response.");
  }
  const decrypted = await openJson(
    e2eeKey,
    responseFrame.envelope,
    responseFrame.aad,
  );
  if (
    decrypted.type !== "session.history" ||
    !decrypted.messages?.some((message) => message.content.includes(canary))
  ) {
    throw new Error("Encrypted history did not round-trip.");
  }

  const storedDocuments = {};
  for (const name of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (name.name.startsWith("system.")) continue;
    storedDocuments[name.name] = await db
      .collection(name.name)
      .find({})
      .limit(500)
      .toArray();
  }
  const serverVisible = JSON.stringify(storedDocuments);
  if (serverVisible.includes(canary) || serverVisible.includes("private history")) {
    throw new Error("MongoDB persisted application plaintext.");
  }

  const logoutResponse = await fetch(new URL("/api/auth/logout", origin), {
    method: "POST",
    headers: {
      ...authHeaders(),
      Origin: authOrigin,
    },
  });
  assertStatus(logoutResponse, 200, "Logout");
  const rejected = await fetch(new URL("/api/bootstrap", origin), {
    headers: authHeaders(),
  });
  assertStatus(rejected, 401, "Revoked session");

  console.log(
    JSON.stringify({
      ok: true,
      database: "mongodb",
      protocol_version: bootstrap.protocol_version,
      email_magic_link_hash_only: true,
      e2ee_round_trip: true,
      server_plaintext_canary_found: false,
    }),
  );
} finally {
  await relay?.stop().catch(() => {});
  if (fixtureOwned) await Promise.all([
    db.collection("relay_browser_authorizations").deleteOne({ _id: browserId }),
    db.collection("auth_sessions").deleteOne({ _id: sessionTokenHash }),
  ]).catch(() => {});
  await client.close().catch(() => {});
  await rm(statePath, { force: true }).catch(() => {});
}

async function api(path, options = {}) {
  const response = await fetch(new URL(path, origin), {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders(),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      body?.error?.message || `Mongo Relay request failed (${response.status}).`,
    );
  }
  return body;
}

function authHeaders() {
  return {
    Cookie: `relay_session=${sessionToken}`,
    "X-Relay-Browser-Token": browserToken,
  };
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label} returned ${response.status}, expected ${expected}.`);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
