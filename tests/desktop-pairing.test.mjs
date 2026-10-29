import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

test("短码 PAKE 只让 MongoDB 看到公开握手消息", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "agent-relay-pake-"));
  try {
    const pairingBundle = join(temporary, "pairing-api.mjs");
    const cryptoBundle = join(temporary, "pairing-pake.mjs");
    await Promise.all([
      build({
        entryPoints: ["server/pairing-api.ts"],
        bundle: true,
        platform: "node",
        format: "esm",
        outfile: pairingBundle,
        logLevel: "silent",
      }),
      build({
        entryPoints: ["shared/pairing-pake.ts"],
        bundle: true,
        platform: "browser",
        format: "esm",
        outfile: cryptoBundle,
        logLevel: "silent",
      }),
    ]);
    const [{ PairingApi }, pake] = await Promise.all([
      import(`${pathToFileURL(pairingBundle).href}?${Date.now()}`),
      import(`${pathToFileURL(cryptoBundle).href}?${Date.now()}`),
    ]);
    const database = new MemoryMongo();
    const api = new PairingApi(database);
    const authorizationWakeups = [];
    api.setCommandWait({ notify(deviceId) {
      assert.equal(database.documents.relay_browser_authorizations[0].pairing_confirmed, true);
      assert.equal(database.documents.relay_pake_pairings[0].status, 'paired');
      authorizationWakeups.push(deviceId);
    } });
    await api.initialize();

    const desktop = await pake.createPairingInitiator();
    const started = await api.handle(
      request("https://relay.test/api/pairings/start", {
        pairing_id: desktop.pairingId,
        protocol: pake.PAIRING_PROTOCOL,
        initiator_share: desktop.initiatorShare,
      }),
      null,
    );
    assert.equal(started.status, 201);

    const waiting = await read(api, desktop.pairingId);
    const browser = await pake.respondToPairing(
      desktop.pairingId,
      desktop.code,
      waiting.initiator_share,
    );
    const browserToken = pake.randomRelayToken();
    const browserKeyId = `sha256:${createHash("sha256")
      .update(Buffer.from(browser.contentKey, "base64url"))
      .digest("base64url")}`;
    const responded = await api.handle(
      request(
        `https://relay.test/api/browser/pairings/${desktop.pairingId}/respond`,
        {
          protocol: pake.PAIRING_PROTOCOL,
          responder_share: browser.responderShare,
          responder_confirm: browser.responderConfirm,
          browser_token_hash: await pake.sha256Hex(browserToken),
          browser_key_id: browserKeyId,
          browser_name: "Safari · Mac",
          client_identity: `web:${"a".repeat(64)}`,
        },
        { "X-Relay-Client-Version": "0.3.20+30" },
      ),
      "desktop@example.com",
    );
    assert.equal(responded.status, 200);

    const publicResponse = await read(api, desktop.pairingId);
    const derived = await pake.finishPairingInitiator(
      desktop,
      publicResponse.responder_share,
      publicResponse.responder_confirm,
    );
    assert.equal(derived.contentKey, browser.contentKey);

    const relayToken = pake.randomRelayToken();
    const completed = await api.handle(
      request(
        `https://relay.test/api/pairings/${desktop.pairingId}/complete`,
        {
          desktop_confirm: derived.desktopConfirm,
          relay_token_hash: await pake.sha256Hex(relayToken),
          name: "这台 Mac",
        },
      ),
      null,
    );
    assert.equal(completed.status, 201);
    const issued = await completed.json();
    assert.match(issued.device_id, /^dev_[a-f0-9]{32}$/);
    assert.deepEqual(authorizationWakeups, [issued.device_id]);
    const repeated = await api.handle(request(
      `https://relay.test/api/pairings/${desktop.pairingId}/complete`,
      { desktop_confirm: derived.desktopConfirm },
    ), null);
    assert.equal(repeated.status, 200);
    assert.deepEqual(authorizationWakeups, [issued.device_id, issued.device_id]);

    const paired = await read(api, desktop.pairingId);
    pake.verifyDesktopConfirmation(
      browser.expectedDesktopConfirm,
      paired.desktop_confirm,
    );
    const serverState = JSON.stringify(database.documents);
    assert.doesNotMatch(serverState, new RegExp(desktop.code.replace("-", "")));
    assert.doesNotMatch(serverState, new RegExp(derived.contentKey));
    assert.doesNotMatch(serverState, new RegExp(relayToken));
    assert.doesNotMatch(serverState, new RegExp(browserToken));
    assert.equal(
      database.documents.relay_devices[0].relay_token_hash,
      createHash("sha256").update(relayToken).digest("hex"),
    );
    assert.equal(
      database.documents.relay_browser_authorizations[0].key_id,
      browserKeyId,
    );

    const deviceHeaders = {
      Authorization: `Bearer ${relayToken}`,
    };
    const browserList = await api.handle(
      new Request("https://relay.test/api/relay/browser-authorizations", {
        headers: deviceHeaders,
      }),
      null,
    );
    assert.equal(browserList.status, 200);
    const authorizedClients = (await browserList.json()).browsers;
    assert.equal(authorizedClients.length, 1);
    assert.equal(authorizedClients[0].client_version, "0.3.20+30");

    const revoked = await api.handle(
      new Request(
        `https://relay.test/api/relay/browser-authorizations/${issued.browser_id}/revoke`,
        { method: "POST", headers: deviceHeaders },
      ),
      null,
    );
    assert.equal(revoked.status, 200);
    assert.equal(
      database.documents.relay_browser_authorizations[0].revoked_at > 0,
      true,
    );

    const replay = await api.handle(
      request(
        `https://relay.test/api/browser/pairings/${desktop.pairingId}/respond`,
        {
          protocol: pake.PAIRING_PROTOCOL,
          responder_share: browser.responderShare,
          responder_confirm: browser.responderConfirm,
          browser_token_hash: await pake.sha256Hex(browserToken),
          browser_key_id: browserKeyId,
          browser_name: "Safari · Mac",
        },
      ),
      "desktop@example.com",
    );
    assert.equal(replay.status, 409);

    const idempotentComplete = await api.handle(
      request(
        `https://relay.test/api/pairings/${desktop.pairingId}/complete`,
        {
          desktop_confirm: derived.desktopConfirm,
          relay_token_hash: await pake.sha256Hex(relayToken),
          name: "这台 Mac",
        },
      ),
      null,
    );
    assert.equal(idempotentComplete.status, 200);
    assert.equal(database.documents.relay_devices.length, 1);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("错误连接码不能通过 PAKE 双向确认", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "agent-relay-pake-wrong-"));
  try {
    const bundle = join(temporary, "pairing-pake.mjs");
    await build({
      entryPoints: ["shared/pairing-pake.ts"],
      bundle: true,
      platform: "browser",
      format: "esm",
      outfile: bundle,
      logLevel: "silent",
    });
    const pake = await import(`${pathToFileURL(bundle).href}?${Date.now()}`);
    const desktop = await pake.createPairingInitiator();
    const wrongCode = desktop.code === "AAAA-AAAA" ? "BBBB-BBBB" : "AAAA-AAAA";
    const browser = await pake.respondToPairing(
      desktop.pairingId,
      wrongCode,
      desktop.initiatorShare,
    );
    await assert.rejects(
      pake.finishPairingInitiator(
        desktop,
        browser.responderShare,
        browser.responderConfirm,
      ),
      /连接码不正确|安全握手/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("macOS Web 登录只绑定桌面设备，不自动授权当前浏览器", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-desktop-login-"));
  try {
    const bundle = join(temporary, "pairing-api.mjs");
    await build({
      entryPoints: ["server/pairing-api.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: bundle,
      logLevel: "silent",
    });
    const { PairingApi } = await import(
      `${pathToFileURL(bundle).href}?${Date.now()}`
    );
    const database = new MemoryMongo();
    const api = new PairingApi(database);
    await api.initialize();

    const deviceToken = Buffer.alloc(32, 17).toString("base64url");
    const relayTokenHash = createHash("sha256")
      .update(deviceToken)
      .digest("hex");
    const started = await api.handle(
      request("https://relay.test/api/desktop-login/start", {
        relay_token_hash: relayTokenHash,
        name: "书房 Mac",
      }),
      null,
    );
    assert.equal(started.status, 201);
    const login = await started.json();
    assert.match(login.request_id, /^dlogin_[A-Za-z0-9_-]{43}$/);
    assert.match(login.poll_secret, /^[A-Za-z0-9_-]{43}$/);
    assert.doesNotMatch(JSON.stringify(database.documents), new RegExp(deviceToken));

    const unauthenticated = await api.handle(
      new Request(
        `https://relay.test/api/desktop-login/${login.request_id}/approval`,
      ),
      null,
    );
    assert.equal(unauthenticated.status, 401);

    const approval = await api.handle(
      new Request(
        `https://relay.test/api/desktop-login/${login.request_id}/approval`,
      ),
      "owner@example.com",
    );
    assert.equal(approval.status, 200);
    assert.deepEqual(await approval.json(), {
      request_id: login.request_id,
      device_name: "书房 Mac",
      status: "waiting",
      account_email: "owner@example.com",
      expires_at: login.expires_at,
    });

    const approved = await api.handle(
      new Request(
        `https://relay.test/api/desktop-login/${login.request_id}/approve`,
        { method: "POST" },
      ),
      "owner@example.com",
    );
    assert.equal(approved.status, 200);
    const approvedBody = await approved.json();
    assert.equal(approvedBody.status, "approved");

    const wrongPollSecret = await api.handle(
      new Request(
        `https://relay.test/api/desktop-login/${login.request_id}`,
        { headers: { "X-Relay-Desktop-Login-Secret": "Z".repeat(43) } },
      ),
      null,
    );
    assert.equal(wrongPollSecret.status, 404);

    const polled = await api.handle(
      new Request(
        `https://relay.test/api/desktop-login/${login.request_id}`,
        {
          headers: {
            "X-Relay-Desktop-Login-Secret": login.poll_secret,
          },
        },
      ),
      null,
    );
    assert.equal(polled.status, 200);
    const polledBody = await polled.json();
    assert.equal(polledBody.status, "approved");
    assert.match(polledBody.device_id, /^dev_[a-f0-9]{32}$/);
    assert.equal(polledBody.account_email, "owner@example.com");
    assert.equal(database.documents.relay_devices.length, 1);
    assert.equal(
      database.documents.relay_devices[0].relay_token_hash,
      relayTokenHash,
    );
    assert.equal(
      database.documents.relay_browser_authorizations?.length ?? 0,
      0,
      "desktop login must not authorize the web browser that performed login",
    );

    const otherAccount = await api.handle(
      new Request(
        `https://relay.test/api/desktop-login/${login.request_id}/approval`,
      ),
      "other@example.com",
    );
    assert.equal(otherAccount.status, 409);

    const cancelled = await api.handle(
      new Request(
        `https://relay.test/api/desktop-login/${login.request_id}/cancel`,
        {
          method: "POST",
          headers: {
            "X-Relay-Desktop-Login-Secret": login.poll_secret,
          },
        },
      ),
      null,
    );
    assert.equal(cancelled.status, 204);
    assert.equal(database.documents.relay_devices[0].revoked_at > 0, true);
    assert.equal(database.documents.relay_desktop_logins.length, 0);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("已登录账户只发现已绑定电脑发起的新增浏览器请求", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-pairing-discovery-"));
  try {
    const bundle = join(temporary, "pairing-api.mjs");
    await build({
      entryPoints: ["server/pairing-api.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: bundle,
      logLevel: "silent",
    });
    const { PairingApi } = await import(
      `${pathToFileURL(bundle).href}?${Date.now()}`
    );
    const database = new MemoryMongo();
    const api = new PairingApi(database);
    await api.initialize();

    const email = "linked@example.com";
    const userHash = createHash("sha256").update(email).digest("hex");
    const userId = `usr_${userHash.slice(0, 32)}`;
    const deviceId = `dev_${"1".repeat(32)}`;
    const deviceToken = "linked-desktop-device-token";
    database.documents.relay_users = [
      {
        _id: userId,
        id: userId,
        email,
        created_at: Date.now(),
        updated_at: Date.now(),
      },
    ];
    database.documents.relay_devices = [
      {
        _id: deviceId,
        id: deviceId,
        user_id: userId,
        name: "书房电脑",
        relay_token_hash: createHash("sha256")
          .update(deviceToken)
          .digest("hex"),
        identity_public_key: "{}",
        encrypted_descriptor: null,
        key_epoch: 1,
        protocol_version: 2,
        ack_seq: 0,
        created_at: Date.now(),
        last_seen_at: null,
        revoked_at: null,
      },
    ];

    const browserPairingId = `pair_${"B".repeat(43)}`;
    const initialPairingId = `pair_${"I".repeat(43)}`;
    const browserStart = await api.handle(
      request(
        "https://relay.test/api/relay/pairings/start",
        {
          pairing_id: browserPairingId,
          protocol: "SPAKE2-P256-SHA256-HKDF-HMAC",
          initiator_share: "S".repeat(87),
        },
        { Authorization: `Bearer ${deviceToken}` },
      ),
      null,
    );
    assert.equal(browserStart.status, 201);
    const initialStart = await api.handle(
      request("https://relay.test/api/pairings/start", {
        pairing_id: initialPairingId,
        protocol: "SPAKE2-P256-SHA256-HKDF-HMAC",
        initiator_share: "T".repeat(87),
      }),
      null,
    );
    assert.equal(initialStart.status, 201);

    const unauthenticated = await api.handle(
      new Request("https://relay.test/api/browser/pairings/pending"),
      null,
    );
    assert.equal(unauthenticated.status, 401);

    const otherAccount = await api.handle(
      new Request("https://relay.test/api/browser/pairings/pending"),
      "other@example.com",
    );
    assert.equal(otherAccount.status, 200);
    assert.deepEqual(await otherAccount.json(), {
      has_bound_computer: false,
      pairings: [],
    });

    const owner = await api.handle(
      new Request("https://relay.test/api/browser/pairings/pending"),
      email,
    );
    assert.equal(owner.status, 200);
    const ownerBody = await owner.json();
    assert.equal(ownerBody.has_bound_computer, true);
    assert.deepEqual(ownerBody.pairings, [
      {
        pairing_id: browserPairingId,
        device_id: deviceId,
        device_name: "书房电脑",
        expires_at: ownerBody.pairings[0].expires_at,
      },
    ]);
    assert.doesNotMatch(JSON.stringify(ownerBody), /initiator_share|short_code|pairing_code/i);
    assert.doesNotMatch(JSON.stringify(ownerBody), new RegExp(initialPairingId));

    const otherDeviceToken = "other-linked-desktop-device-token";
    database.documents.relay_devices.push({
      ...database.documents.relay_devices[0],
      _id: `dev_${"2".repeat(32)}`,
      id: `dev_${"2".repeat(32)}`,
      relay_token_hash: createHash("sha256")
        .update(otherDeviceToken)
        .digest("hex"),
    });
    const crossDeviceCancel = await api.handle(
      new Request(
        `https://relay.test/api/relay/pairings/${browserPairingId}/cancel`,
        { method: "POST", headers: { Authorization: `Bearer ${otherDeviceToken}` } },
      ),
      null,
    );
    assert.equal(crossDeviceCancel.status, 204);
    assert.equal(
      database.documents.relay_pake_pairings.some(
        (pairing) => pairing._id === browserPairingId,
      ),
      true,
      "one device must not cancel another device's pairing",
    );

    const cancelled = await api.handle(
      new Request(
        `https://relay.test/api/relay/pairings/${browserPairingId}/cancel`,
        { method: "POST", headers: { Authorization: `Bearer ${deviceToken}` } },
      ),
      null,
    );
    assert.equal(cancelled.status, 204);
    assert.equal(
      database.documents.relay_pake_pairings.some(
        (pairing) => pairing._id === browserPairingId,
      ),
      false,
    );
    assert.equal(
      database.documents.relay_pake_pairings.some(
        (pairing) => pairing._id === initialPairingId,
      ),
      true,
      "browser cancellation must not remove an initial pairing",
    );
    const repeatedCancel = await api.handle(
      new Request(
        `https://relay.test/api/relay/pairings/${browserPairingId}/cancel`,
        { method: "POST", headers: { Authorization: `Bearer ${deviceToken}` } },
      ),
      null,
    );
    assert.equal(repeatedCancel.status, 204, "cancellation must be idempotent");

    const pairedBrowserPairingId = `pair_${"P".repeat(43)}`;
    const pairedStart = await api.handle(
      request(
        "https://relay.test/api/relay/pairings/start",
        {
          pairing_id: pairedBrowserPairingId,
          protocol: "SPAKE2-P256-SHA256-HKDF-HMAC",
          initiator_share: "U".repeat(87),
        },
        { Authorization: `Bearer ${deviceToken}` },
      ),
      null,
    );
    assert.equal(pairedStart.status, 201);
    database.documents.relay_pake_pairings.find(
      (pairing) => pairing._id === pairedBrowserPairingId,
    ).status = "paired";
    const pairedCancel = await api.handle(
      new Request(
        `https://relay.test/api/relay/pairings/${pairedBrowserPairingId}/cancel`,
        { method: "POST", headers: { Authorization: `Bearer ${deviceToken}` } },
      ),
      null,
    );
    assert.equal(pairedCancel.status, 204);
    assert.equal(
      database.documents.relay_pake_pairings.some(
        (pairing) => pairing._id === pairedBrowserPairingId,
      ),
      true,
      "cancellation must never remove an already paired authorization",
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("stable client identity survives reauthorization without reusing keys or granting access", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "relay-client-identity-"));
  try {
    const bundle = join(temporary, "pairing.mjs");
    await build({ entryPoints: ["server/pairing-api.ts"], bundle: true, platform: "node", format: "esm", outfile: bundle, logLevel: "silent" });
    const { PairingApi } = await import(pathToFileURL(bundle).href);
    const db = new MemoryMongo();
    const api = new PairingApi(db);
    await api.initialize();
    const hash = value => createHash("sha256").update(value).digest("hex");
    const email = "identity@example.com";
    const userId = `usr_${hash(email).slice(0,32)}`;
    const deviceId = `dev_${"a".repeat(32)}`;
    const desktopToken = "desktop_identity_test_token";
    db.collection("relay_devices");
    db.documents.relay_devices.push({ _id: deviceId, id: deviceId, user_id: userId, relay_token_hash: hash(desktopToken), revoked_at: null });
    const identity = `android:${"a".repeat(64)}`;
    let sequence = 0;
    const pair = async (clientIdentity = identity, finish = true, targetToken = desktopToken, account = email) => {
      const pairingId = `pair_${String(++sequence).padStart(43, "0")}`;
      const token = `browser_identity_test_token_${sequence}`;
      assert.equal((await api.handle(request("https://relay.test/api/relay/pairings/start", {
        pairing_id: pairingId, protocol: "SPAKE2-P256-SHA256-HKDF-HMAC", initiator_share: "A".repeat(87),
      }, { Authorization: `Bearer ${targetToken}` }), null)).status, 201);
      const response = await api.handle(request(`https://relay.test/api/browser/pairings/${pairingId}/respond`, {
        protocol: "SPAKE2-P256-SHA256-HKDF-HMAC", responder_share: "B".repeat(87), responder_confirm: "C".repeat(43),
        browser_token_hash: hash(token), browser_key_id: `sha256:${String(sequence).padStart(43, "D")}`,
        browser_name: "Same phone name", ...(clientIdentity === false ? {} : { client_identity: clientIdentity }),
      }), account);
      if (response.status !== 200) return { response, token };
      const { browser_id: id } = await response.json();
      if (finish) assert.equal((await api.handle(request(`https://relay.test/api/pairings/${pairingId}/complete`, {
        desktop_confirm: "E".repeat(43),
      }), null)).status, 201);
      return { id, token, pairingId };
    };
    const activate = client => api.handle(request("https://relay.test/api/browser/pairings/activate", {}, { "X-Relay-Browser-Token": client.token }), email);
    const authorization = client => db.documents.relay_browser_authorizations.find(row => row.id === client.id);
    const first = await pair();
    assert.equal((await activate(first)).status, 200);
    assert.equal((await api.handle(request("https://relay.test/api/browser/pairings/activate", {}, { "X-Relay-Browser-Token": first.token }), "other@example.com")).status, 403);
    const stableId = authorization(first).client_device_id;
    assert.match(stableId, /^client_[a-f0-9]{64}$/);
    const unfinished = await pair(identity, false);
    assert.equal((await activate(unfinished)).status, 401, "fingerprint alone cannot activate before desktop confirmation");
    assert.equal(authorization(first).revoked_at, null);
    const second = await pair();
    assert.notEqual(first.id, second.id);
    assert.notEqual(authorization(first).key_id, authorization(second).key_id);
    assert.equal(authorization(second).client_device_id, stableId);
    assert.equal(db.documents.relay_client_devices.length, 1);
    assert.equal(authorization(first).revoked_at, null, "completion alone must not revoke the previous connection");
    assert.equal((await activate(second)).status, 200);
    assert.ok(authorization(first).revoked_at);
    assert.equal((await activate(first)).status, 401, "old token no longer works");
    assert.equal((await activate(second)).status, 200, "activation retries are idempotent");
    const third = await pair();
    const fourth = await pair();
    await Promise.all([activate(third), activate(fourth)]);
    assert.ok(authorization(third).revoked_at);
    assert.equal(authorization(fourth).revoked_at, null, "newer generation wins concurrent activation");
    const noIdentity = await pair(false);
    const noIdentityAgain = await pair(false);
    await activate(noIdentityAgain);
    assert.equal(authorization(noIdentity).revoked_at, null, "missing IDs cannot merge unrelated clients");
    const otherPhone = await pair(`android:${"b".repeat(64)}`);
    await activate(otherPhone);
    assert.notEqual(authorization(otherPhone).client_device_id, stableId);
    assert.equal(authorization(fourth).revoked_at, null, "same display name is not identity");
    const secondMacToken = "second_mac_identity_test_token";
    const secondMacId = `dev_${"b".repeat(32)}`;
    db.documents.relay_devices.push({ _id: secondMacId, id: secondMacId, user_id: userId, relay_token_hash: hash(secondMacToken), revoked_at: null });
    const otherMac = await pair(identity, true, secondMacToken);
    await activate(otherMac);
    assert.notEqual(authorization(otherMac).client_device_id, stableId);
    assert.equal(authorization(fourth).revoked_at, null);
    assert.equal((await pair(identity, true, desktopToken, "other@example.com")).response.status, 403);
    assert.equal((await pair("android:invalid")).response.status, 400);
    assert.equal((await api.handle(request("https://relay.test/api/browser/pairings/activate", { client_identity: identity }), null)).status, 401);
    const list = await api.handle(new Request("https://relay.test/api/relay/browser-authorizations", { headers: { Authorization: `Bearer ${desktopToken}` } }), null);
    assert.equal((await list.json()).browsers.filter(row => row.client_device_id === stableId).length, 1);
    await api.handle(request(`https://relay.test/api/relay/browser-authorizations/${fourth.id}/revoke`, {}, { Authorization: `Bearer ${desktopToken}` }), null);
    assert.equal((await activate(fourth)).status, 401);
    const reinstalled = await pair();
    await activate(reinstalled);
    assert.equal(authorization(reinstalled).client_device_id, stableId, "explicitly revoked device returns under the same identity after a fresh scan");
    assert.ok(!JSON.stringify(db.documents.relay_client_devices).includes(identity), "stable records contain scoped digests, not source fingerprints");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

async function read(api, pairingId) {
  const response = await api.handle(
    new Request(`https://relay.test/api/pairings/${pairingId}`),
    null,
  );
  assert.equal(response.status, 200);
  return response.json();
}

function request(url, body, headers = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

class MemoryMongo {
  documents = {};

  collection(name) {
    const documents = (this.documents[name] ??= []);
    return {
      createIndex: async () => "ok",
      insertOne: async (document) => {
        if (documents.some((candidate) => candidate._id === document._id)) {
          const error = new Error("duplicate");
          error.code = 11000;
          throw error;
        }
        documents.push(structuredClone(document));
        return { acknowledged: true };
      },
      findOneAndUpdate: async (filter, update, options = {}) => {
        let found = documents.find(document => matches(document, filter));
        if (!found && options.upsert) {
          found = { ...plainFilter(filter), ...structuredClone(update.$setOnInsert ?? {}) };
          documents.push(found);
        }
        if (!found) return null;
        Object.assign(found, structuredClone(update.$set ?? {}));
        for (const [key, amount] of Object.entries(update.$inc ?? {})) found[key] = (found[key] ?? 0) + amount;
        return structuredClone(found);
      },
      findOne: async (filter) => {
        const found = documents.find((document) => matches(document, filter));
        return found ? structuredClone(found) : null;
      },
      updateOne: async (filter, update, options = {}) => {
        const found = documents.find((document) => matches(document, filter));
        if (found) {
          Object.assign(found, structuredClone(update.$set ?? {}));
          return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
        }
        if (!options.upsert) {
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
        }
        const inserted = {
          ...plainFilter(filter),
          ...structuredClone(update.$setOnInsert ?? {}),
          ...structuredClone(update.$set ?? {}),
        };
        if (documents.some((document) => document._id === inserted._id)) {
          const error = new Error("duplicate");
          error.code = 11000;
          throw error;
        }
        documents.push(inserted);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      },
      deleteOne: async (filter) => {
        const index = documents.findIndex((document) => matches(document, filter));
        if (index < 0) return { acknowledged: true, deletedCount: 0 };
        documents.splice(index, 1);
        return { acknowledged: true, deletedCount: 1 };
      },
      findOneAndDelete: async (filter) => {
        const index = documents.findIndex((document) => matches(document, filter));
        if (index < 0) return null;
        const [deleted] = documents.splice(index, 1);
        return structuredClone(deleted);
      },
      find: (filter) => {
        let sortSpec = null;
        let limit = Number.POSITIVE_INFINITY;
        return {
          sort(nextSortSpec) {
            sortSpec = nextSortSpec;
            return this;
          },
          limit(nextLimit) {
            limit = nextLimit;
            return this;
          },
          async toArray() {
            const results = documents.filter((document) =>
              matches(document, filter),
            );
            if (sortSpec) {
              results.sort((left, right) => {
                for (const [key, direction] of Object.entries(sortSpec)) {
                  if (left[key] === right[key]) continue;
                  return (left[key] < right[key] ? -1 : 1) * direction;
                }
                return 0;
              });
            }
            return results
              .slice(0, limit)
              .map((document) => structuredClone(document));
          },
        };
      },
    };
  }
}

function matches(document, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = document[key];
    if (
      expected &&
      typeof expected === "object" &&
      !Array.isArray(expected) &&
      !(expected instanceof Date)
    ) {
      if ("$gt" in expected) return actual > expected.$gt;
      if ("$in" in expected) return expected.$in.includes(actual);
    }
    return actual === expected;
  });
}

function plainFilter(filter) {
  return Object.fromEntries(
    Object.entries(filter).filter(
      ([, value]) =>
        value === null ||
        typeof value !== "object" ||
        value instanceof Date,
    ),
  );
}
