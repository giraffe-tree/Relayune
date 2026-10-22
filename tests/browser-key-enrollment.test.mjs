import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateE2eeKey, keyIdForKey, openJson } from "../relay/e2ee.mjs";
import { MacRelay } from "../relay/mac-relay.mjs";

const FIRST = `web_${"1".repeat(32)}`;
const SECOND = `web_${"2".repeat(32)}`;

function fixture(credentials = {}) {
  const calls = [];
  const relay = new MacRelay({
    serverUrl: "https://fixture.invalid",
    deviceId: "dev_synthetic",
    deviceToken: "synthetic-token",
    ...credentials,
    statePath: null,
    adapter: {
      async start() { calls.push("adapter.start"); },
      async close() {},
    },
  });
  relay.outbox.load = async () => { calls.push("outbox.load"); };
  relay.outbox.pruneExpired = async () => { calls.push("outbox.prune"); };
  relay.connect = async () => { calls.push("connect"); };
  return { relay, calls };
}

test("Relay startup rejects unbound, duplicate, or reused client keys before runtime side effects", async t => {
  const firstKey = generateE2eeKey();
  const secondKey = generateE2eeKey();
  const enrollment = (browserId, e2eeKey = firstKey) => ({ browserId, e2eeKey });
  const cases = [
    ["missing enrollment", {}],
    ["retired pre-shared key", { e2eeKey: firstKey }],
    ["null client", { browserKeys: [enrollment(null)] }],
    ["omitted client", { browserKeys: [{ e2eeKey: firstKey }] }],
    ["invalid client", { browserKeys: [enrollment("web_invented")] }],
    ["uppercase client", { browserKeys: [enrollment(`web_${"A".repeat(32)}`)] }],
    ["non-array enrollment", { browserKeys: { browserId: FIRST, e2eeKey: firstKey } }],
    ["reused key", { browserKeys: [enrollment(FIRST), enrollment(SECOND)] }],
    ["conflicting client keys", { browserKeys: [enrollment(FIRST), enrollment(FIRST, secondKey)] }],
    ["duplicate enrollment", { browserKeys: [enrollment(FIRST), enrollment(FIRST)] }],
    ["invalid later key", { browserKeys: [enrollment(FIRST), enrollment(SECOND, "invalid")] }],
  ];
  for (const [name, credentials] of cases) await t.test(name, async () => {
    const { relay, calls } = fixture(credentials);
    await assert.rejects(relay.start());
    assert.deepEqual(calls, [], "must not load state, start an Agent, or contact the server");
    assert.equal(relay.retentionTimer, undefined);
    assert.equal(relay.browserKeys.size, 0, "failed enrollment must not partially install keys");
  });
});

test("server key IDs cannot reassign an enrolled key to a different client", async t => {
  const key = generateE2eeKey();
  const { relay } = fixture({ browserKeys: [{ browserId: FIRST, e2eeKey: key }] });
  t.after(() => relay.stop());
  await relay.start();
  const keyId = await keyIdForKey(key);
  relay.syncBrowserAuthorizations([{ id: SECOND, key_id: keyId }]);
  assert.equal(relay.activeBrowserKeys.size, 0);
  relay.syncBrowserAuthorizations([{ id: FIRST, key_id: keyId }, { id: SECOND, key_id: keyId }]);
  assert.deepEqual([...relay.activeBrowserKeys.keys()], [FIRST]);
  const encoded = await relay.encodeRemoteMessage({ type: "relay.sync_sessions", sessions: [] });
  assert.deepEqual(encoded.map(frame => frame.browser_id), [FIRST]);
  assert.deepEqual((await openJson(key, encoded[0].envelope, encoded[0].aad)).sessions, []);
});

test("dynamic enrollment rejects cross-client key reuse and preserves existing keys", async t => {
  const key = generateE2eeKey();
  const otherKey = generateE2eeKey();
  const { relay } = fixture({ browserKeys: [{ browserId: FIRST, e2eeKey: key }] });
  t.after(() => relay.stop());
  await relay.start();
  await assert.rejects(relay.updateBrowserKey(SECOND, key), /independent/);
  await assert.rejects(relay.updateBrowserKey(FIRST, otherKey), /already enrolled/);
  await assert.rejects(relay.updateBrowserKey(`web_${"A".repeat(32)}`, otherKey), /Invalid browser/);
  assert.equal(relay.browserKeys.size, 1);
  assert.equal(relay.browserKeys.get(FIRST).keyId, await keyIdForKey(key));
  await relay.updateBrowserKey(SECOND, otherKey);
  relay.syncBrowserAuthorizations([
    { id: FIRST, key_id: await keyIdForKey(key) },
    { id: SECOND, key_id: await keyIdForKey(otherKey) },
  ]);
  assert.equal(relay.activeBrowserKeys.size, 2);
});

test("CLI rejects legacy or invalid enrollment before opening attachment state or starting an Agent", () => {
  const key = generateE2eeKey();
  const otherKey = generateE2eeKey();
  const entry = (browser_id, e2ee_key = key) => ({ browser_id, e2ee_key });
  const cases = [
    undefined,
    JSON.stringify([entry(null)]),
    JSON.stringify([{ e2ee_key: key }]),
    JSON.stringify([entry(FIRST), entry(SECOND)]),
    JSON.stringify([entry(FIRST), entry(FIRST, otherKey)]),
  ];
  for (const serialized of cases) {
    const env = {
      PATH: process.env.PATH,
      RELAY_SERVER_URL: "https://fixture.invalid",
      RELAY_DEVICE_ID: "dev_synthetic",
      RELAY_DEVICE_TOKEN: "synthetic-token",
      RELAY_E2EE_KEY: key,
      // A valid enrollment would reach this deliberate failure instead.
      RELAY_ATTACHMENT_STORE_PATH: "invalid-relative-path",
      RELAY_ATTACHMENT_STORE_KEY: otherKey,
    };
    if (serialized !== undefined) env.RELAY_BROWSER_KEYS = serialized;
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../relay/cli.mjs", import.meta.url)), "relay"], {
      env, encoding: "utf8", timeout: 10_000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /安全连接|浏览器内容密钥/);
    assert.doesNotMatch(result.stderr + result.stdout, /attachment|invalid-relative-path|synthetic-token/);
    assert.equal((result.stderr + result.stdout).includes(key), false);
    assert.equal((result.stderr + result.stdout).includes(otherKey), false);
  }
});
