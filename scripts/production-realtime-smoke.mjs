import assert from "node:assert/strict";
import WebSocket from "ws";

const FRAME_TIMEOUT_MS = 5_000;
const EVENT_CATCH_UP_TIMEOUT_MS = 5_000;
const EVENT_CATCH_UP_RETRY_MS = 100;

export async function verifyProductionRealtime({
  origin,
  publicOrigin = new URL(origin).origin,
  sessionToken,
  browserToken,
  deviceId,
  trigger,
  requireOpaqueEvent = true,
  plaintextCanary = "",
  fetchImpl = fetch,
  WebSocketImpl = WebSocket,
}) {
  assert.ok(sessionToken && browserToken && deviceId, "realtime credentials are required");
  const websocketUrl = new URL("/api/realtime", origin);
  websocketUrl.protocol = websocketUrl.protocol === "https:" ? "wss:" : "ws:";
  assert.equal(websocketUrl.search, "", "WebSocket URI must not contain secrets");

  const unauthorizedStatus = await rejectedUpgradeStatus(
    websocketUrl,
    publicOrigin,
    WebSocketImpl,
  );
  assert.equal(unauthorizedStatus, 401, "unauthenticated WSS upgrade must be rejected");

  const first = await subscribe({
    websocketUrl,
    publicOrigin,
    sessionToken,
    browserToken,
    deviceId,
    WebSocketImpl,
  });
  assert.equal(first.ready.device_id, deviceId);
  assert.equal(first.presence.device_id, deviceId);
  assert.equal(first.presence.online, true, "production Relay must be online");
  assert.deepEqual(Object.keys(first.ready).sort(), [
    "device_id",
    "server_time",
    "type",
  ]);
  assert.deepEqual(Object.keys(first.presence).sort(), [
    "device_id",
    "last_seen_at",
    "online",
    "revision",
    "server_time",
    "type",
  ]);

  if (trigger) {
    const invalidated = first.inbox.next(
      (frame) => frame.type === "invalidate" && frame.scopes?.includes("events"),
    );
    await trigger();
    const frame = await invalidated;
    assert.equal(frame.device_id, deviceId);
  }

  const eventPage = await catchUpEncryptedEvents({
    origin,
    sessionToken,
    browserToken,
    deviceId,
    requireOpaqueEvent,
    fetchImpl,
  });
  if (requireOpaqueEvent) {
    assert.ok(eventPage.events.length > 0, "production smoke needs one opaque event");
  }
  for (const event of eventPage.events) {
    assert.equal(event.envelope?.v, 2);
    assert.equal(event.envelope?.alg, "A256GCM");
    assert.match(event.envelope?.kid ?? "", /^sha256:[A-Za-z0-9_-]{43}$/);
    assert.equal(typeof event.envelope?.ciphertext, "string");
    assert.equal(typeof event.aad?.device_id, "string");
  }
  const visibleWire = JSON.stringify(eventPage);
  assert.equal(visibleWire.includes(sessionToken), false);
  assert.equal(visibleWire.includes(browserToken), false);
  if (plaintextCanary) assert.equal(visibleWire.includes(plaintextCanary), false);

  await closeSocket(first.socket);
  const resumed = await subscribe({
    websocketUrl,
    publicOrigin,
    sessionToken,
    browserToken,
    deviceId,
    WebSocketImpl,
  });
  assert.equal(resumed.ready.device_id, deviceId);
  assert.equal(resumed.presence.online, true);
  await closeSocket(resumed.socket);

  return {
    unauthenticated_upgrade_rejected: true,
    authenticated_presence: true,
    event_invalidation_received: Boolean(trigger),
    opaque_event_count: eventPage.events.length,
    reconnect_ready: true,
  };
}

async function catchUpEncryptedEvents({
  origin,
  sessionToken,
  browserToken,
  deviceId,
  requireOpaqueEvent,
  fetchImpl,
}) {
  const deadline = Date.now() + EVENT_CATCH_UP_TIMEOUT_MS;
  while (true) {
    const response = await fetchImpl(
      new URL(
        `/api/events?device_id=${encodeURIComponent(deviceId)}&cursor=0&limit=100`,
        origin,
      ),
      {
        headers: {
          Accept: "application/json",
          Cookie: `relay_session=${sessionToken}`,
          "X-Relay-Browser-Token": browserToken,
        },
      },
    );
    assert.equal(response.status, 200, "encrypted cursor catch-up must succeed");
    const page = await response.json();
    assert.ok(Array.isArray(page.events), "event catch-up must return an array");
    if (!requireOpaqueEvent || page.events.length > 0 || Date.now() >= deadline) {
      return page;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, EVENT_CATCH_UP_RETRY_MS),
    );
  }
}

async function subscribe({
  websocketUrl,
  publicOrigin,
  sessionToken,
  browserToken,
  deviceId,
  WebSocketImpl,
}) {
  const socket = new WebSocketImpl(websocketUrl, {
    origin: publicOrigin,
    headers: { Cookie: `relay_session=${sessionToken}` },
  });
  const inbox = createInbox(socket);
  await onceOpen(socket);
  socket.send(
    JSON.stringify({
      type: "subscribe",
      device_id: deviceId,
      browser_token: browserToken,
    }),
  );
  const ready = await inbox.next((frame) => frame.type === "ready");
  const presence = await inbox.next((frame) => frame.type === "presence");
  return { socket, inbox, ready, presence };
}

function createInbox(socket) {
  const queue = [];
  const waiters = new Set();
  socket.on("message", (data) => {
    const frame = JSON.parse(data.toString());
    for (const waiter of waiters) {
      if (!waiter.predicate(frame)) continue;
      waiters.delete(waiter);
      clearTimeout(waiter.timeout);
      waiter.resolve(frame);
      return;
    }
    queue.push(frame);
  });
  return {
    next(predicate) {
      const index = queue.findIndex(predicate);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timeout: null };
        waiter.timeout = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error("production realtime frame timed out"));
        }, FRAME_TIMEOUT_MS);
        waiters.add(waiter);
      });
    },
  };
}

function onceOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function closeSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    socket.once("close", resolve);
    socket.close(1000, "production smoke complete");
  });
}

function rejectedUpgradeStatus(websocketUrl, publicOrigin, WebSocketImpl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(websocketUrl, { origin: publicOrigin });
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("unauthenticated WSS upgrade timed out"));
    }, FRAME_TIMEOUT_MS);
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timeout);
      response.resume();
      resolve(response.statusCode);
    });
    socket.once("open", () => {
      clearTimeout(timeout);
      socket.close();
      reject(new Error("unauthenticated WSS upgrade unexpectedly opened"));
    });
    socket.once("error", () => {});
  });
}
