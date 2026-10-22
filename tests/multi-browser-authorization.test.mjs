import assert from "node:assert/strict";
import test from "node:test";
import {
  generateE2eeKey,
  keyIdForKey,
  openJson,
} from "../relay/e2ee.mjs";
import { MacRelay } from "../relay/mac-relay.mjs";

const DEVICE_ID = "dev_multi_browser";
const BROWSER_ONE = `web_${"1".repeat(32)}`;
const BROWSER_TWO = `web_${"2".repeat(32)}`;

test("[MOB-PRJ-008][relay] 会话名称与目录用独立密钥同步到每个浏览器", async () => {
  const keyOne = generateE2eeKey();
  const keyTwo = generateE2eeKey();
  const relay = new MacRelay({
    serverUrl: "https://relay.test",
    deviceId: DEVICE_ID,
    deviceToken: "test-device-token",
    browserKeys: [
      { browserId: BROWSER_ONE, e2eeKey: keyOne },
      { browserId: BROWSER_TWO, e2eeKey: keyTwo },
    ],
    adapter: {
      async start() {},
      async close() {},
    },
    statePath: null,
  });
  relay.connect = async () => {};
  await relay.start();

  relay.syncBrowserAuthorizations([
    { id: BROWSER_ONE, key_id: await keyIdForKey(keyOne) },
    { id: BROWSER_TWO, key_id: await keyIdForKey(keyTwo) },
  ]);
  const catalog = await relay.encodeRemoteMessage({
    type: "relay.sync_sessions",
    device_id: DEVICE_ID,
    sessions: [
      {
        id: "ses_shared",
        name: "登录修复",
        cwd: "/workspace/relayune",
        project: "relayune",
      },
    ],
    projects: [
      {
        id: "project_galaxy",
        name: "3d-galaxy",
        cwd: "/workspace/3d-galaxy",
        provider: "codex",
      },
    ],
    usage: {
      codex: {
        as_of: "2026-09-02T10:00:00.000Z",
        daily: [{ date: "2026-09-02", total_tokens: 416900000 }],
      },
      kimi: {
        as_of: "2026-09-02T10:01:00.000Z",
        source: "local_wire",
        complete: false,
        daily: [{ date: "2026-09-02", total_tokens: 81234000 }],
      },
      claude: {
        as_of: "2026-09-02T10:02:00.000Z",
        source: "local_transcripts",
        complete: false,
        daily: [{ date: "2026-09-01", total_tokens: 25000000 }],
      },
    },
  });
  assert.equal(catalog.length, 2);
  assert.notEqual(catalog[0].envelope.kid, catalog[1].envelope.kid);

  const first = catalog.find((message) => message.browser_id === BROWSER_ONE);
  const second = catalog.find((message) => message.browser_id === BROWSER_TWO);
  const firstCatalog = await openJson(keyOne, first.envelope, first.aad);
  const secondCatalog = await openJson(keyTwo, second.envelope, second.aad);
  assert.deepEqual(firstCatalog.sessions[0], {
    id: "ses_shared",
    name: "登录修复",
    cwd: "/workspace/relayune",
    project: "relayune",
  });
  assert.deepEqual(secondCatalog.sessions[0], firstCatalog.sessions[0]);
  assert.equal(firstCatalog.projects[0].name, "3d-galaxy");
  assert.deepEqual(firstCatalog.usage, {
    codex: {
      as_of: "2026-09-02T10:00:00.000Z",
      daily: [{ date: "2026-09-02", total_tokens: 416900000 }],
    },
    kimi: {
      as_of: "2026-09-02T10:01:00.000Z",
      source: "local_wire",
      complete: false,
      daily: [{ date: "2026-09-02", total_tokens: 81234000 }],
    },
    claude: {
      as_of: "2026-09-02T10:02:00.000Z",
      source: "local_transcripts",
      complete: false,
      daily: [{ date: "2026-09-01", total_tokens: 25000000 }],
    },
  });
  assert.deepEqual(secondCatalog.usage, firstCatalog.usage);
  await assert.rejects(openJson(keyOne, second.envelope, second.aad));
  await assert.rejects(openJson(keyTwo, first.envelope, first.aad));

  relay.syncBrowserAuthorizations([
    { id: BROWSER_TWO, key_id: await keyIdForKey(keyTwo) },
  ]);
  const afterRevocation = await relay.encodeRemoteMessage({
    type: "relay.sync_sessions",
    device_id: DEVICE_ID,
    sessions: [],
  });
  assert.deepEqual(
    afterRevocation.map((message) => message.browser_id),
    [BROWSER_TWO],
  );

  await relay.stop();
});

test("请求响应只使用发起请求的浏览器密钥", async () => {
  const keyOne = generateE2eeKey();
  const keyTwo = generateE2eeKey();
  const relay = new MacRelay({
    serverUrl: "https://relay.test",
    deviceId: DEVICE_ID,
    deviceToken: "test-device-token",
    browserKeys: [
      { browserId: BROWSER_ONE, e2eeKey: keyOne },
      { browserId: BROWSER_TWO, e2eeKey: keyTwo },
    ],
    adapter: {
      async start() {},
      async close() {},
    },
    statePath: null,
  });
  relay.connect = async () => {};
  await relay.start();
  relay.syncBrowserAuthorizations([
    { id: BROWSER_ONE, key_id: await keyIdForKey(keyOne) },
    { id: BROWSER_TWO, key_id: await keyIdForKey(keyTwo) },
  ]);
  relay.requestBrowsers.set("req_history", BROWSER_TWO);

  const encoded = await relay.encodeRemoteMessage({
    type: "session.history",
    request_id: "req_history",
    session_id: "ses_shared",
    messages: [{ role: "codex", content: "仅返回给发起浏览器" }],
  });
  assert.equal(encoded.length, 1);
  assert.equal(encoded[0].browser_id, BROWSER_TWO);
  assert.equal(
    (await openJson(keyTwo, encoded[0].envelope, encoded[0].aad)).messages[0]
      .content,
    "仅返回给发起浏览器",
  );
  await assert.rejects(
    openJson(keyOne, encoded[0].envelope, encoded[0].aad),
  );

  await relay.stop();
});
