import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const EMAIL = "device-binding@example.com";
const USER_ID = "usr_device_binding";
const OLD_DEVICE_ID = `dev_${"1".repeat(32)}`;
const NEW_DEVICE_ID = `dev_${"2".repeat(32)}`;
const BROWSER_ID = `web_${"a".repeat(32)}`;
const BROWSER_TOKEN = "B".repeat(43);

test("浏览器把不可导出密钥与配对设备保存在同一条 IndexedDB 记录", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "agent-relay-browser-key-"));
  const bundle = join(temporary, "e2ee.mjs");
  const originalIndexedDb = globalThis.indexedDB;
  try {
    await build({
      entryPoints: ["app/e2ee.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: bundle,
      logLevel: "silent",
    });
    const database = fakeIndexedDb();
    globalThis.indexedDB = database.api;
    const e2ee = await import(`${pathToFileURL(bundle).href}?${Date.now()}`);
    const encodedKey = Buffer.alloc(32, 7).toString("base64url");
    const key = await e2ee.importRelayKey(encodedKey);

    await e2ee.storeRelayKey(
      key,
      NEW_DEVICE_ID,
      BROWSER_TOKEN,
      BROWSER_ID,
    );
    const stored = await e2ee.loadStoredRelayKey();

    assert.equal(stored.deviceId, NEW_DEVICE_ID);
    assert.equal(stored.kid, key.kid);
    assert.equal(stored.cryptoKey.extractable, false);
    assert.equal(stored.browserId, BROWSER_ID);
    assert.equal(stored.browserToken, BROWSER_TOKEN);
    assert.deepEqual(stored.cryptoKey.usages, ["encrypt", "decrypt"]);

    database.records.set("active", key);
    assert.equal(
      await e2ee.loadStoredRelayKey(),
      null,
      "没有设备绑定的旧记录不能再驱动隐式设备选择",
    );
    await assert.rejects(
      e2ee.storeRelayKey(key, "dev_invalid"),
      /设备编号无效/,
    );
  } finally {
    globalThis.indexedDB = originalIndexedDb;
    await rm(temporary, { recursive: true, force: true });
  }
});

test("bootstrap 的显式设备编号覆盖最近心跳排序并校验账户归属", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "agent-relay-bootstrap-"));
  const bundle = join(temporary, "relay-api.mjs");
  try {
    await build({
      entryPoints: ["server/relay-api.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: bundle,
      logLevel: "silent",
    });
    const { handleRelayApi } = await import(
      `${pathToFileURL(bundle).href}?${Date.now()}`
    );
    const database = new BootstrapDatabase();
    const request = (deviceId) =>
      new Request(
        `https://relay.test/api/bootstrap${
          deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ""
        }`,
        {
          headers: {
            "oai-authenticated-user-email": EMAIL,
            "x-relay-browser-token": BROWSER_TOKEN,
          },
        },
      );

    const registrations = [];
    const pushEnv = { ...environment(database), ANDROID_PUSH: {
      register: async (...args) => registrations.push(args), enqueue: async () => {},
    }};
    const registerRequest = (deviceId = NEW_DEVICE_ID, token = BROWSER_TOKEN, registration = "rid_fixture") => new Request("https://relay.test/api/relay/push-registration", {
      method: "POST", headers: { "oai-authenticated-user-email": EMAIL, "X-Relay-Browser-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({device_id:deviceId,registration_id:registration,locale:"zh-CN"}),
    });
    assert.equal((await handleRelayApi(registerRequest(),pushEnv)).status,200);
    assert.deepEqual(registrations[0],[BROWSER_ID,NEW_DEVICE_ID,"rid_fixture","zh"]);
    assert.equal((await handleRelayApi(registerRequest(NEW_DEVICE_ID,""),pushEnv)).status,401);
    assert.equal((await handleRelayApi(registerRequest(`dev_${"3".repeat(32)}`),pushEnv)).status,404);
    assert.equal((await handleRelayApi(registerRequest(NEW_DEVICE_ID,BROWSER_TOKEN,"bad"),pushEnv)).status,400);
    assert.equal(registrations.length,1);
    assert.equal((await handleRelayApi(registerRequest(NEW_DEVICE_ID,BROWSER_TOKEN,null),pushEnv)).status,200);
    assert.equal(registrations[1][2],null);

    const implicit = await handleRelayApi(request(null), environment(database));
    assert.equal(implicit.status, 200);
    assert.equal((await implicit.json()).device.id, "");

    const explicit = await handleRelayApi(
      request(NEW_DEVICE_ID),
      environment(database),
    );
    assert.equal(explicit.status, 200);
    assert.equal((await explicit.json()).device.id, NEW_DEVICE_ID);

    database.queries = [];
    const catalogRequest = new Request(`${request(NEW_DEVICE_ID).url}&include_events=0`, {
      headers: request(NEW_DEVICE_ID).headers,
    });
    const catalogResponse = await handleRelayApi(catalogRequest, environment(database));
    assert.equal(catalogResponse.status, 200);
    assert.deepEqual((await catalogResponse.json()).events, []);
    assert.ok(database.queries.some(query => query.includes('FROM relay_catalogs')));
    assert.ok(!database.queries.some(query => query.includes('LIMIT 200')));
    catalogRequest.headers.delete('x-relay-browser-token');
    assert.equal((await handleRelayApi(catalogRequest, environment(database))).status, 401);

    const pushRequest = () => new Request(`https://relay.test/api/relay/devices/${NEW_DEVICE_ID}/ios-push`, {
      method: "POST", headers: request(NEW_DEVICE_ID).headers, body: JSON.stringify({enabled:false}),
    });
    let registered = 0;
    const iosPushEnv = {...environment(database), IOS_PUSH: {async register(deviceId, browserId, body) {
      assert.equal(deviceId, NEW_DEVICE_ID); assert.equal(browserId, BROWSER_ID);
      assert.deepEqual(body, {enabled:false}); registered++; return {registered:false};
    }}};
    assert.equal((await handleRelayApi(pushRequest(), iosPushEnv)).status, 200);
    assert.equal(registered, 1);
    const noToken = pushRequest(); noToken.headers.delete("x-relay-browser-token");
    assert.equal((await handleRelayApi(noToken, iosPushEnv)).status, 401);
    assert.equal(registered, 1);
    assert.equal((await handleRelayApi(pushRequest(), environment(database))).status, 503);

    const summaryRequest = new Request(`${request(NEW_DEVICE_ID).url}&summary_only=1`, {
      headers: request(NEW_DEVICE_ID).headers,
    });
    database.queries = [];
    const summaryResponse = await handleRelayApi(summaryRequest, environment(database));
    assert.equal(summaryResponse.status, 200);
    const summary = await summaryResponse.json();
    assert.equal(summary.device.id, NEW_DEVICE_ID);
    assert.equal(summary.catalog, null);
    assert.deepEqual(summary.events, []);
    assert.equal(summary.queued_commands, 0);
    assert.ok(!database.queries.some(query => query.includes('FROM relay_catalogs') || query.includes('LIMIT 200')));
    summaryRequest.headers.delete('x-relay-browser-token');
    assert.equal((await handleRelayApi(summaryRequest, environment(database))).status, 401);

    for (const version of ["0.3.20+30", "0.3.21", "invalid", "1.2.3+" + "x".repeat(64), null]) {
      const versioned = request(NEW_DEVICE_ID);
      if (version !== null) versioned.headers.set("X-Relay-Client-Version", version);
      const response = await handleRelayApi(versioned, environment(database));
      assert.equal(response.status, 200);
      const update = database.clientUpdates.at(-1);
      if (version === "0.3.20+30" || version === "0.3.21") {
        assert.match(update.query, /client_version = \?/);
        assert.equal(update.values[1], version);
        assert.equal(update.values[2], BROWSER_ID);
      } else {
        assert.doesNotMatch(update.query, /client_version/);
        assert.equal(update.values[1], BROWSER_ID);
      }
    }
    const unauthorized = request(NEW_DEVICE_ID);
    unauthorized.headers.delete("x-relay-browser-token");
    unauthorized.headers.set("X-Relay-Client-Version", "9.9.9");
    const updateCount = database.clientUpdates.length;
    assert.equal((await handleRelayApi(unauthorized, environment(database))).status, 401);
    assert.equal(database.clientUpdates.length, updateCount);

    const missing = await handleRelayApi(
      request(`dev_${"3".repeat(32)}`),
      environment(database),
    );
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "device_not_found");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Web 响应等待使用 202，旧客户端继续收到兼容的 404", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "agent-relay-response-pending-"));
  const bundle = join(temporary, "relay-api.mjs");
  try {
    await build({
      entryPoints: ["server/relay-api.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: bundle,
      logLevel: "silent",
    });
    const { handleRelayApi } = await import(
      `${pathToFileURL(bundle).href}?${Date.now()}`
    );
    const database = new BootstrapDatabase();
    const headers = { "oai-authenticated-user-email": EMAIL };

    const accepted = await handleRelayApi(
      new Request(
        "https://relay.test/api/responses/history_pending?pending_status=202",
        { headers },
      ),
      environment(database),
    );
    assert.equal(accepted.status, 202);
    assert.deepEqual(await accepted.json(), {
      pending: true,
      request_id: "history_pending",
    });

    const legacy = await handleRelayApi(
      new Request("https://relay.test/api/responses/history_pending", {
        headers,
      }),
      environment(database),
    );
    assert.equal(legacy.status, 404);
    assert.equal((await legacy.json()).error.code, "response_pending");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("首页恢复和配对完成路径始终使用同一设备绑定", async () => {
  const page = await readFile("app/workbench-page.tsx", "utf8");
  assert.match(
    page,
    /\/api\/bootstrap\?device_id=\$\{encodeURIComponent\(deviceId\)\}/,
  );
  assert.match(page, /relayDeviceId\.current = stored\?\.deviceId \?\? null/);
  assert.match(page, /const completedDeviceId = completed\.device_id/);
  assert.match(page, /relayDeviceId\.current = completedDeviceId/);
  assert.match(
    page,
    /storeRelayKey\([\s\S]*?completedDeviceId,[\s\S]*?browserToken,[\s\S]*?completedBrowserId/,
  );
  assert.match(page, /"X-Relay-Browser-Token"/);
  assert.match(
    page,
    /isBrowserAuthorizationLost\(response\.status, body\.error\?\.code\)[\s\S]{0,160}relayune-browser-revoked/,
  );
  assert.equal(
    page.match(/isBrowserAuthorizationLost\(error\.status, error\.code\)/g)
      ?.length,
    2,
    "首次恢复和手动重试都必须把失效设备绑定交给统一撤销恢复流程",
  );
  assert.match(
    page,
    /const handleRevoked = \(\) => \{[\s\S]{0,520}setBootstrapErrorKind\(null\)[\s\S]{0,360}clearStoredRelayKey\(\)/,
  );

  const restoreFailure = page.match(
    /if \(relayKey\.current\) \{([\s\S]*?)\n          \} else \{/,
  )?.[1];
  assert.ok(restoreFailure);
  assert.doesNotMatch(restoreFailure, /clearStoredRelayKey/);
});

test("桌面授权列表区分授权发生时间和最近使用时间", async () => {
  const [page, i18n] = await Promise.all([
    readFile("desktop/src/main.ts", "utf8"),
    readFile("desktop/src/i18n.ts", "utf8"),
  ]);
  assert.match(page, /data-i18n="browserHelp"/);
  assert.match(i18n, /每个浏览器或 App 使用独立加密授权，可随时单独撤销/);
  assert.match(i18n, /Each browser or app gets separate encrypted access/);
  assert.match(page, /formatBrowserAuthorizationDetail\(/);
  assert.match(page, /browserAuthorizationCount\(/);
  assert.match(page, /id="new-pairing"[^>]*data-i18n="addBrowser"/);
  assert.doesNotMatch(page, /打开 Web 工作台/);
});

test("旧版浏览器密钥不能绕过短码 PAKE 静默认领授权", async () => {
  const [page, authLanguage, pairingApi, server] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/auth-language.ts", "utf8"),
    readFile("server/pairing-api.ts", "utf8"),
    readFile("server/self-hosted.ts", "utf8"),
  ]);

  assert.doesNotMatch(page, /\/api\/browser\/authorizations\/claim/);
  assert.doesNotMatch(pairingApi, /\/api\/browser\/authorizations\/claim/);
  assert.doesNotMatch(server, /\/api\/browser\/authorizations\/claim/);
  assert.match(
    page,
    /setAuthToastKey\("legacyCredentials"\)/,
  );
  assert.match(
    page,
    /const visibleToast = authToastKey\s*\? authText\(authLocale, authToastKey\)\s*:\s*typeof toast === "string"\s*\? toast\s*:\s*workbenchText\(authLocale, toast\.key, toast\.variables\)/,
    "an in-flight bootstrap must retain only a stable key and render it in the latest UI language",
  );
  assert.match(authLanguage, /legacyCredentials: "旧版客户端凭据不会自动授权/);
});

function environment(database) {
  return {
    DB: database,
    RELAY_BLOBS: {
      async get() {
        return null;
      },
      async put() {},
      async delete() {},
    },
  };
}

class BootstrapDatabase {
  clientUpdates = [];
  devices = [
    {
      id: OLD_DEVICE_ID,
      user_id: USER_ID,
      name: "旧设备",
      identity_public_key: "{}",
      encrypted_descriptor: null,
      key_epoch: 1,
      protocol_version: 2,
      ack_seq: 0,
      created_at: Date.now() - 60_000,
      last_seen_at: Date.now(),
    },
    {
      id: NEW_DEVICE_ID,
      user_id: USER_ID,
      name: "本次配对设备",
      identity_public_key: "{}",
      encrypted_descriptor: null,
      key_epoch: 1,
      protocol_version: 2,
      ack_seq: 0,
      created_at: Date.now(),
      last_seen_at: null,
    },
  ];

  prepare(query) {
    (this.queries ??= []).push(query);
    const values = [];
    return {
      bind(...next) {
        values.push(...next);
        return this;
      },
      run: async () => {
        if (query.includes("INSERT INTO relay_users")) {
          return { success: true, meta: { changes: 1, last_row_id: 0 } };
        }
        if (query.includes("UPDATE relay_browser_authorizations")) {
          this.clientUpdates.push({ query, values: [...values] });
          return { success: true, meta: { changes: 1, last_row_id: 0 } };
        }
        throw new Error(`Unexpected write: ${query}`);
      },
      first: async () => {
        if (query.includes("SELECT id, email FROM relay_users")) {
          return { id: USER_ID, email: EMAIL };
        }
        if (
          query.includes("FROM relay_browser_authorizations") &&
          query.includes("WHERE token_hash = ?")
        ) {
          return {
            id: BROWSER_ID,
            device_id: values[1],
            user_id: values[2],
            name: "Safari · Mac",
            key_id: `sha256:${"C".repeat(43)}`,
            created_at: Date.now(),
            last_seen_at: Date.now(),
          };
        }
        if (
          query.includes("FROM relay_devices") &&
          query.includes("WHERE id = ? AND user_id = ?")
        ) {
          return (
            this.devices.find(
              (device) =>
                device.id === values[0] && device.user_id === values[1],
            ) ?? null
          );
        }
        if (
          query.includes("FROM relay_devices") &&
          query.includes("WHERE user_id = ?")
        ) {
          return this.devices[0];
        }
        if (query.includes("FROM relay_catalogs")) return null;
        if (query.includes("FROM relay_responses")) return null;
        if (query.includes("SUM(CASE WHEN status")) {
          return { queued: 0, pending: 0 };
        }
        if (query.includes("COALESCE(MAX(cursor)")) return { cursor: 0 };
        throw new Error(`Unexpected read: ${query}`);
      },
      all: async () => {
        if (query.includes("FROM relay_events")) {
          return { success: true, results: [] };
        }
        throw new Error(`Unexpected list: ${query}`);
      },
    };
  }

  async batch() {
    throw new Error("Unexpected batch");
  }
}

function fakeIndexedDb() {
  const records = new Map();
  const database = {
    objectStoreNames: {
      contains(name) {
        return name === "keys";
      },
    },
    createObjectStore() {},
    transaction() {
      const transaction = {
        error: null,
        oncomplete: null,
        onerror: null,
        objectStore() {
          return {
            get(key) {
              const request = { error: null, onsuccess: null, onerror: null };
              queueMicrotask(() => {
                request.result = records.get(key);
                request.onsuccess?.();
              });
              return request;
            },
            put(value, key) {
              records.set(key, value);
              queueMicrotask(() => transaction.oncomplete?.());
            },
            delete(key) {
              records.delete(key);
              queueMicrotask(() => transaction.oncomplete?.());
            },
          };
        },
      };
      return transaction;
    },
    close() {},
  };
  return {
    records,
    api: {
      open() {
        const request = {
          error: null,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };
        queueMicrotask(() => {
          request.result = database;
          request.onsuccess?.();
        });
        return request;
      },
    },
  };
}
