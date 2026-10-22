import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import WebSocket from "ws";
import { createNetworkUsage } from "../server/network-usage.mjs";

const ORIGIN = "https://relayune.giraffetree.cn";
const VALID_TOKEN = "b".repeat(43);

async function importRealtime() {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-realtime-"));
  const outfile = join(temporary, "realtime.cjs");
  await build({
    entryPoints: ["server/realtime.ts"],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile,
    logLevel: "silent",
  });
  return {
    module: await import(`${pathToFileURL(outfile).href}?${Date.now()}`),
    cleanup: () => rm(temporary, { recursive: true, force: true }),
  };
}

async function createFixture({ onlineWindowMs = 120, maxBufferedBytes, networkUsage } = {}) {
  const bundled = await importRealtime();
  const server = createServer((_request, response) => response.end("ok"));
  const hub = bundled.module.attachRealtimeServer(server, {
    networkUsage,
    publicOrigin: ORIGIN,
    onlineWindowMs,
    heartbeatIntervalMs: 60_000,
    subscribeTimeoutMs: 200,
    maxBufferedBytes,
    authenticateSession: async (request) =>
      request.headers.cookie === "relay_session=session_secret"
        ? "owner@example.com"
        : null,
    authorize: async (_request, email, payload) => {
      if (
        email !== "owner@example.com" ||
        payload.browserToken !== VALID_TOKEN ||
        !/^dev_[ab]$/.test(payload.deviceId)
      ) {
        throw new Error("unauthorized");
      }
      return {
        deviceId: payload.deviceId,
        browserId: `web_${payload.deviceId}`,
        lastSeenAt: Date.now(),
      };
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `ws://127.0.0.1:${address.port}/api/realtime`;
  return {
    hub,
    server,
    url,
    cleanup: async () => {
      hub.close();
      await new Promise((resolve) => server.close(resolve));
      await bundled.cleanup();
    },
  };
}

function connect(url, { origin = ORIGIN, cookie = "relay_session=session_secret" } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin, headers: { Cookie: cookie } });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function rejectedUpgrade(url, options) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    socket.once("open", () => reject(new Error("unexpected websocket open")));
    socket.once("error", (error) => resolve(error));
  });
}

function nextJson(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("websocket message timeout")), 1_000);
    socket.once("message", (data) => {
      clearTimeout(timeout);
      resolve(JSON.parse(data.toString()));
    });
  });
}

async function subscribe(socket, deviceId = "dev_a", browserToken = VALID_TOKEN) {
  const readyPromise = nextJson(socket);
  socket.send(
    JSON.stringify({
      type: "subscribe",
      device_id: deviceId,
      browser_token: browserToken,
    }),
  );
  const ready = await readyPromise;
  const presence = await nextJson(socket);
  return { ready, presence };
}

test('network counters match real websocket frames without retaining subscription secrets', async () => {
  const records = [];
  const networkUsage = createNetworkUsage({ intervalMs: 0, write: record => records.push(record) });
  const fixture = await createFixture({ networkUsage, onlineWindowMs: 60_000 });
  const socket = await connect(fixture.url);
  let receivedBytes = 0;
  socket.on('message', data => { receivedBytes += data.byteLength; });
  try {
    const initialFrames = new Promise((resolve, reject) => {
      let count = 0;
      const timeout = setTimeout(() => reject(new Error('initial frames timeout')), 1000);
      socket.on('message', () => { if (++count === 2) { clearTimeout(timeout); resolve(); } });
    });
    socket.send(JSON.stringify({ type: 'subscribe', device_id: 'dev_a', browser_token: VALID_TOKEN }));
    await initialFrames;
    networkUsage.flush();
    assert.equal(records.reduce((sum, row) => sum + row.tx_payload_bytes, 0), receivedBytes);
    assert.equal(records.reduce((sum, row) => sum + row.rx_payload_bytes, 0),
      Buffer.byteLength(JSON.stringify({ type: 'subscribe', device_id: 'dev_a', browser_token: VALID_TOKEN })));
    assert.doesNotMatch(JSON.stringify(records), new RegExp(VALID_TOKEN + '|dev_a|session_secret'));
  } finally {
    socket.terminate();
    await fixture.cleanup();
    networkUsage.close();
  }
});

test("[MOB-RT-001][server] websocket requires session browser authorization and exact Origin without URL secrets", async () => {
  const fixture = await createFixture();
  try {
    assert.equal(new URL(fixture.url).search, "");
    const wrongOrigin = await rejectedUpgrade(fixture.url, {
      origin: "https://attacker.example",
      headers: { Cookie: "relay_session=session_secret" },
    });
    assert.match(wrongOrigin.message, /403/);
    const missingSession = await rejectedUpgrade(fixture.url, { origin: ORIGIN });
    assert.match(missingSession.message, /401/);

    const socket = await connect(fixture.url);
    const closed = new Promise((resolve) => socket.once("close", (code) => resolve(code)));
    socket.send(
      JSON.stringify({
        type: "subscribe",
        device_id: "dev_a",
        browser_token: "invalid",
      }),
    );
    assert.equal(await closed, 4401);
  } finally {
    await fixture.cleanup();
  }
});

test("[MOB-RT-002][server] websocket signals contain only authorized device metadata and no browser secret", async () => {
  const fixture = await createFixture();
  const socket = await connect(fixture.url);
  try {
    const { ready, presence } = await subscribe(socket);
    assert.deepEqual(Object.keys(ready).sort(), ["device_id", "server_time", "type"]);
    assert.deepEqual(Object.keys(presence).sort(), [
      "device_id",
      "last_seen_at",
      "online",
      "revision",
      "server_time",
      "type",
    ]);
    assert.equal(JSON.stringify([ready, presence]).includes(VALID_TOKEN), false);
    assert.equal(ready.device_id, "dev_a");
  } finally {
    socket.close();
    await fixture.cleanup();
  }
});

test('twenty invalidations merge into one notification while later updates still arrive', async () => {
  const fixture = await createFixture({ onlineWindowMs: 60_000 });
  const socket = await connect(fixture.url);
  const frames = [];
  socket.on('message', data => { const frame = JSON.parse(data); if (frame.type === 'invalidate') frames.push(frame); });
  try {
    const ready = nextJson(socket);
    socket.send(JSON.stringify({ type: 'subscribe', device_id: 'dev_a', browser_token: VALID_TOKEN }));
    await ready;
    for (let i = 0; i < 20; i++) fixture.hub.invalidate('dev_a', i % 2 ? ['catalog', 'responses'] : ['events', 'queue']);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(frames.length, 1);
    assert.deepEqual(frames[0].scopes, ['catalog', 'events', 'queue', 'responses']);
    fixture.hub.invalidate('dev_a', ['events']);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(frames.length, 2);
    assert.deepEqual(frames[1].scopes, ['events']);
  } finally { socket.terminate(); await fixture.cleanup(); }
});

test("[MOB-RT-003][server] relay changes wake only matching device subscribers", async () => {
  const fixture = await createFixture();
  const first = await connect(fixture.url);
  const second = await connect(fixture.url);
  try {
    await subscribe(first, "dev_a");
    await subscribe(second, "dev_b");
    const matchingMessage = nextJson(first);
    let otherMessages = 0;
    second.on("message", () => {
      otherMessages += 1;
    });
    fixture.hub.invalidate("dev_a", ["events", "catalog", "events"]);
    const message = await matchingMessage;
    assert.deepEqual(
      {
        type: message.type,
        device_id: message.device_id,
        scopes: message.scopes,
      },
      {
      type: "invalidate",
      device_id: "dev_a",
      scopes: ["catalog", "events"],
      },
    );
    assert.ok(Number.isFinite(Date.parse(message.server_time)));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(otherMessages, 0);
  } finally {
    first.close();
    second.close();
    await fixture.cleanup();
  }
});

test("[MOB-RT-004][server] every reconnect emits ready so clients can resume encrypted cursor catch-up", async () => {
  const fixture = await createFixture();
  try {
    const first = await connect(fixture.url);
    const initial = await subscribe(first);
    assert.equal(initial.ready.type, "ready");
    first.close();
    await new Promise((resolve) => first.once("close", resolve));

    fixture.hub.invalidate("dev_a", ["events"]);
    const second = await connect(fixture.url);
    const resumed = await subscribe(second);
    assert.equal(resumed.ready.type, "ready");
    assert.equal(resumed.ready.device_id, "dev_a");
    assert.equal(resumed.presence.device_id, "dev_a");
    second.close();
  } finally {
    await fixture.cleanup();
  }
});

test("[MOB-RT-011][server] WebSocket pong publishes a heartbeat time and round-trip latency", async () => {
  const fixture = await createFixture();
  const socket = await connect(fixture.url);
  try {
    await subscribe(socket);
    const heartbeatPromise = nextJson(socket);
    fixture.hub.heartbeat();
    const heartbeat = await heartbeatPromise;
    assert.deepEqual(Object.keys(heartbeat).sort(), [
      "device_id",
      "round_trip_ms",
      "server_time",
      "type",
    ]);
    assert.equal(heartbeat.type, "heartbeat");
    assert.equal(heartbeat.device_id, "dev_a");
    assert.ok(Number.isSafeInteger(heartbeat.round_trip_ms));
    assert.ok(heartbeat.round_trip_ms >= 0);
    assert.ok(Number.isFinite(Date.parse(heartbeat.server_time)));
  } finally {
    socket.close();
    await fixture.cleanup();
  }
});

test("[MOB-RT-008][server] slow subscribers are bounded while persisted opaque events remain cursor recoverable", async () => {
  const fixture = await createFixture({ maxBufferedBytes: -1 });
  try {
    const socket = await connect(fixture.url);
    const closed = new Promise((resolve) =>
      socket.once("close", (code) => resolve(code)),
    );
    socket.send(JSON.stringify({
      type: "subscribe",
      device_id: "dev_a",
      browser_token: VALID_TOKEN,
    }));
    assert.equal(await closed, 1013);

    const relayApi = await import("node:fs/promises").then(({ readFile }) =>
      readFile("server/relay-api.ts", "utf8"),
    );
    assert.match(relayApi, /cursor > \?[\s\S]{0,160}ORDER BY cursor ASC/);
    assert.match(relayApi, /next_cursor:[\s\S]{0,120}has_more:/);
  } finally {
    await fixture.cleanup();
  }
});

test("[MOB-RT-007][server] renewed heartbeat publishes its timestamp and prevents an old offline deadline", async () => {
  const fixture = await createFixture({ onlineWindowMs: 90 });
  const socket = await connect(fixture.url);
  try {
    await subscribe(socket);
    const received = [];
    socket.on("message", (data) => received.push(JSON.parse(data.toString())));
    await new Promise((resolve) => setTimeout(resolve, 55));
    const refreshedAt = Date.now();
    fixture.hub.observePresence("dev_a", refreshedAt);
    await new Promise((resolve) => setTimeout(resolve, 55));
    const refreshed = received.filter(
      (message) => message.type === "presence" && message.online === true,
    );
    assert.equal(refreshed.length, 1);
    assert.equal(refreshed[0].last_seen_at, new Date(refreshedAt).toISOString());
    assert.equal(refreshed[0].revision, refreshedAt);
    assert.equal(received.some((message) => message.type === "presence" && !message.online), false);
    await new Promise((resolve) => setTimeout(resolve, 55));
    const offline = received.filter(
      (message) => message.type === "presence" && message.online === false,
    );
    assert.equal(offline.length, 1);
    assert.ok(Number.isSafeInteger(offline[0].revision));
  } finally {
    socket.close();
    await fixture.cleanup();
  }
});
