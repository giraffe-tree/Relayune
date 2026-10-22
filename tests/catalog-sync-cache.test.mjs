import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  generateE2eeKey,
  keyIdForKey,
  openJson,
} from "../relay/e2ee.mjs";
import { MacRelay } from "../relay/mac-relay.mjs";

const DEVICE_ID = "dev_catalog_cache";
const BROWSER_ONE = `web_${"1".repeat(32)}`;
const BROWSER_TWO = `web_${"2".repeat(32)}`;

test("[RELAY-CATALOG-CACHE-001] unchanged catalogs upload once per connection", async () => {
  const key = generateE2eeKey();
  const sessions = [session("Original")];
  let usageAsOf = "2026-09-02T10:00:00.000Z";
  const requests = [];
  const relay = await createRelay({
    browserKeys: [{ browserId: BROWSER_ONE, e2eeKey: key }],
    adapter: catalogAdapter({
      sessions: () => sessions,
      usage: () => usage(usageAsOf),
    }),
    requests,
  });
  relay.syncBrowserAuthorizations([
    { id: BROWSER_ONE, key_id: await keyIdForKey(key) },
  ]);

  await relay.syncSessionCatalog();
  await waitForRelayIdle(relay);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].messages.length, 1);

  usageAsOf = "2026-09-02T10:00:30.000Z";
  await relay.syncSessionCatalog();
  await waitForRelayIdle(relay);
  assert.equal(
    requests.length,
    1,
    "a refreshed observation timestamp alone must not republish the catalog",
  );

  sessions[0] = session("Updated");
  await relay.syncSessionCatalog();
  await waitForRelayIdle(relay);
  assert.equal(requests.length, 2);
  const updated = await openJson(
    key,
    requests[1].messages[0].envelope,
    requests[1].messages[0].aad,
  );
  assert.equal(updated.sessions[0].name, "Updated");
  assert.equal(updated.usage.codex.as_of, usageAsOf);
  assert.doesNotMatch(
    JSON.stringify(requests),
    /catalogDeliveryVersion|catalogContentFingerprint|fingerprint/,
  );

  await relay.handleMessage(
    JSON.stringify({
      type: "relay.connected",
      protocol_version: 2,
      resume_cursor: 0,
    }),
  );
  await waitForRelayIdle(relay);
  assert.equal(
    requests.length,
    3,
    "a new Server connection must force one recovery catalog upload",
  );

  await relay.stop();
});

test("[RELAY-CATALOG-CACHE-002] a new browser receives only its missing catalog", async () => {
  const keyOne = generateE2eeKey();
  const keyTwo = generateE2eeKey();
  const requests = [];
  const relay = await createRelay({
    browserKeys: [
      { browserId: BROWSER_ONE, e2eeKey: keyOne },
      { browserId: BROWSER_TWO, e2eeKey: keyTwo },
    ],
    adapter: catalogAdapter({
      sessions: () => [session("Shared")],
      usage: () => usage("2026-09-02T10:00:00.000Z"),
    }),
    requests,
  });
  const authorizationOne = {
    id: BROWSER_ONE,
    key_id: await keyIdForKey(keyOne),
  };
  const authorizationTwo = {
    id: BROWSER_TWO,
    key_id: await keyIdForKey(keyTwo),
  };
  relay.syncBrowserAuthorizations([authorizationOne]);

  await relay.syncSessionCatalog();
  await waitForRelayIdle(relay);
  relay.syncBrowserAuthorizations([authorizationOne, authorizationTwo]);
  await relay.syncSessionCatalog();
  await waitForRelayIdle(relay);

  assert.equal(requests.length, 2);
  assert.deepEqual(
    requests.map((request) =>
      request.messages.map((message) => message.browser_id),
    ),
    [[BROWSER_ONE], [BROWSER_TWO]],
  );

  await relay.syncSessionCatalog();
  await waitForRelayIdle(relay);
  assert.equal(requests.length, 2);
  await relay.stop();
});

test("[RELAY-CATALOG-CACHE-003] a rejected upload never advances the local hash", async () => {
  const key = generateE2eeKey();
  const requests = [];
  let rejectUpload = true;
  const relay = await createRelay({
    browserKeys: [{ browserId: BROWSER_ONE, e2eeKey: key }],
    adapter: catalogAdapter({
      sessions: () => [session("Retry")],
      usage: () => ({}),
    }),
    requests,
    response: () =>
      rejectUpload
        ? Response.json(
            { error: { code: "invalid_aad", message: "Invalid data." } },
            { status: 400 },
          )
        : Response.json({ accepted: true, ack_seq: 0 }),
  });
  relay.syncBrowserAuthorizations([
    { id: BROWSER_ONE, key_id: await keyIdForKey(key) },
  ]);

  await relay.syncSessionCatalog();
  await waitForRelayIdle(relay);
  assert.equal(requests.length, 1);
  assert.equal(relay.catalogDeliveryVersions.size, 0);

  rejectUpload = false;
  await relay.syncSessionCatalog();
  await waitForRelayIdle(relay);
  assert.equal(requests.length, 2);
  assert.equal(relay.catalogDeliveryVersions.size, 1);

  await relay.syncSessionCatalog();
  await waitForRelayIdle(relay);
  assert.equal(requests.length, 2);
  await relay.stop();
});

test("[RELAY-CATALOG-CACHE-004] active timestamps and ordering do not republish the catalog", async () => {
  const key = generateE2eeKey();
  const requests = [];
  const sessions = [
    session("Active A", {
      id: "session_active_a",
      status: "active",
      can_interrupt: true,
      running_started_at: "2026-09-02T10:00:00.000Z",
      updated_at: "2026-09-02T10:00:04.000Z",
    }),
    session("Active B", {
      id: "session_active_b",
      status: "active",
      can_interrupt: true,
      running_started_at: "2026-09-02T10:00:01.000Z",
      updated_at: "2026-09-02T10:00:03.000Z",
    }),
  ];
  const relay = await createRelay({
    browserKeys: [{ browserId: BROWSER_ONE, e2eeKey: key }],
    adapter: catalogAdapter({
      sessions: () => sessions,
      usage: () => ({}),
    }),
    requests,
  });
  relay.syncBrowserAuthorizations([
    { id: BROWSER_ONE, key_id: await keyIdForKey(key) },
  ]);

  await relay.syncSessionCatalog();
  await waitForRelayIdle(relay);
  sessions[0] = {
    ...sessions[0],
    updated_at: "2026-09-02T10:00:08.000Z",
  };
  sessions[1] = {
    ...sessions[1],
    updated_at: "2026-09-02T10:00:09.000Z",
  };
  sessions.reverse();
  await relay.syncSessionCatalog();
  await waitForRelayIdle(relay);
  assert.equal(
    requests.length,
    1,
    "live observation timestamps and their resulting order must stay local",
  );

  const completedIndex = sessions.findIndex(
    (candidate) => candidate.id === "session_active_a",
  );
  sessions[completedIndex] = {
    ...sessions[completedIndex],
    status: "idle",
    can_interrupt: false,
    running_started_at: null,
    updated_at: "2026-09-02T10:00:10.000Z",
  };
  await relay.syncSessionCatalog();
  await waitForRelayIdle(relay);
  assert.equal(requests.length, 2);
  const completed = await openJson(
    key,
    requests[1].messages[0].envelope,
    requests[1].messages[0].aad,
  );
  assert.equal(
    completed.sessions.find(
      (candidate) => candidate.id === "session_active_a",
    ).updated_at,
    "2026-09-02T10:00:10.000Z",
  );
  await relay.stop();
});

async function createRelay({ browserKeys, adapter, requests, response }) {
  const relay = new MacRelay({
    serverUrl: "https://relay.test",
    deviceId: DEVICE_ID,
    deviceToken: "test-device-token",
    browserKeys,
    adapter,
    statePath: null,
  });
  relay.connect = async () => {};
  await relay.start();
  // These cases compare unchanged, fully populated catalogs. Metadata now warms
  // independently of session delivery; cold/slow reads are covered separately.
  await Promise.all([relay.readProjectCatalog(), relay.readUsageCatalog()]);
  relay.ready = true;
  relay.remoteFetch = async (path, options) => {
    assert.equal(path, "/api/relay/push");
    requests.push(JSON.parse(options.body));
    return response?.() ?? Response.json({ accepted: true, ack_seq: 0 });
  };
  return relay;
}

function catalogAdapter({ sessions, usage: readUsage }) {
  return {
    async start() {},
    async close() {},
    async listSessions() {
      return sessions();
    },
    async listProjects() {
      return [{ id: "project_relayune", name: "Relayune" }];
    },
    async readUsage() {
      return readUsage();
    },
  };
}

function session(name, overrides = {}) {
  return {
    id: "session_catalog_cache",
    name,
    cwd: "/workspace/relayune",
    provider: "codex",
    ...overrides,
  };
}

function usage(asOf) {
  return {
    codex: {
      as_of: asOf,
      daily: [{ date: "2026-09-02", total_tokens: 42 }],
    },
  };
}

async function waitForRelayIdle(relay, timeoutMs = 2_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (
      !relay.uploading &&
      relay.uploadQueue.length === 0 &&
      relay.operations.size === 0
    ) {
      return;
    }
    await delay(10);
  }
  throw new Error("Timed out waiting for Relay catalog upload to settle.");
}


test("oversized unchanged catalog is not resubmitted while healthy data can progress", async () => {
  const key = generateE2eeKey();
  const requests = [];
  let name = "Oversized";
  const relay = await createRelay({
    browserKeys: [{browserId: BROWSER_ONE, e2eeKey: key}],
    adapter: catalogAdapter({sessions: () => [session(name)], usage: () => ({})}),
    requests,
    response: () => name === "Oversized" && requests.at(-1).messages.some(item => item.kind === "catalog")
      ? Response.json({error: {code: "envelope_too_large"}}, {status: 413})
      : Response.json({accepted: true, ack_seq: 0}),
  });
  relay.syncBrowserAuthorizations([{id: BROWSER_ONE, key_id: await keyIdForKey(key)}]);
  await relay.syncSessionCatalog();
  await waitForRelayIdle(relay);
  await relay.syncSessionCatalog();
  await waitForRelayIdle(relay);
  assert.equal(requests.length, 1);
  assert.equal(relay.catalogDeliveryVersions.size, 0);
  relay.enqueueRemoteMessages([{kind: "heartbeat", device_id: DEVICE_ID, last_event_seq: 1}]);
  await relay.flushRemoteUploads();
  await waitForRelayIdle(relay);
  assert.equal(requests.length, 2);
  name = "Reduced";
  await relay.syncSessionCatalog();
  await waitForRelayIdle(relay);
  assert.equal(requests.length, 3);
  assert.equal(relay.catalogDeliveryVersions.size, 1);
  await relay.stop();
});

test('catalog AAD dates the snapshot before asynchronous provider reads', async()=>{
 let release, entered;
 const started=new Promise(r=>entered=r), gate=new Promise(r=>release=r);
 const relay=new MacRelay({serverUrl:'https://example.test',deviceId:'d',deviceToken:'test',adapter:{},statePath:null});
 relay.ready=true;const messages=[];relay.send=m=>messages.push(m);
 relay.readSessionCatalog=async()=>{entered();await gate;return [];};
 relay.readProjectCatalog=async()=>[];relay.readUsageCatalog=async()=>({});
 const pending=relay.syncSessionCatalog();await started;
 const boundary=new Date().toISOString();await delay(5);release();await pending;
 assert.ok(messages[0].observed_at <= boundary);
 const key=generateE2eeKey();relay.activeBrowserKeys.set('b',{browserId:'b',key,keyId:'k'});
 relay.readAgentRuntimeInfo=async()=>[];
 const [encoded]=await relay.encodeRemoteMessage(messages[0]);
 assert.equal(encoded.aad.created_at,messages[0].observed_at);
});
