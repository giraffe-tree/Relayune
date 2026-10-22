import assert from "node:assert/strict";
import { MacRelay } from "../../relay/mac-relay.mjs";
import { OnlineRelayTransport } from "../../relay/online-transport.mjs";
import { importE2eeKey, keyIdForKey, openJson as relayOpen } from "../../relay/e2ee.mjs";
import { createReadCallbacks, importRelayKey, OnlineStream, ONLINE_READ_TYPES, openJson, sealJson, readOnlineOrHttp, RelayApiError, isPendingRelayResponse } from "./web-read-callbacks.mjs";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Real Relay dispatch, sendWire, encrypted HTTP upload, Web stream and callback.
// The provider and network are synthetic: no user sessions or credentials.
export async function probeStreamPressure(pressure) {
  const encodedKey = Buffer.alloc(32, 7).toString("base64url");
  const browserKey = await importRelayKey(encodedKey), relayKey = await importE2eeKey(encodedKey);
  const start = performance.now(), elapsed = () => Math.round((performance.now() - start) * 10) / 10;
  const metadata = { pressure_bytes: pressure, peer_paused: true, provider_reads: 0, wss_response_count: 0, http_response_count: 0, http_posts: 0, http_polls: 0, first_http_response_at_ms: null, first_http_wire_bytes: null };
  const uploaded = new Map(), browserFrames = [];
  const relay = new MacRelay({ serverUrl: "https://fixture.test", deviceId: "dev_fixture", deviceToken: "fixture", statePath: null, adapter: {
    close: async () => {}, readHistory: async options => {
      metadata.provider_reads++;
      const selected = Array.from({ length: 100 }, (_, index) => ({ id: `fixture_${index}`, role: "codex", content: "x".repeat(1900), created_at: "2026-10-03T00:00:00Z" })).slice(-options.limit);
      return { messages: selected, next_cursor: selected.length < 100 ? selected[0].id : null, has_more: selected.length < 100, agents: [], sessions: [] };
    },
  } });
  relay.ready = true; relay.onlineTransportEnabled = true; relay.authorizationObservedAt = Date.now();
  const browser = { browserId: "web_fixture", key: relayKey, keyId: await keyIdForKey(relayKey) };
  relay.activeBrowserKeys.set(browser.browserId, browser);
  relay.syncSessionCatalog = async () => {};
  relay.remoteFetch = async (path, options) => {
    assert.equal(path, "/api/relay/push");
    for (const frame of JSON.parse(options.body).messages) {
      if (frame.kind !== "response") continue;
      metadata.http_response_count++;
      uploaded.set(frame.request_id, frame);
      if (metadata.first_http_response_at_ms === null) {
        metadata.first_http_response_at_ms = elapsed();
        metadata.first_http_wire_bytes = Buffer.byteLength(JSON.stringify({ device_id: relay.deviceId, messages: [frame] }));
      }
    }
    return Response.json({ ack_seq: 0 });
  };
  class Socket extends EventTarget {
    readyState = 1; bufferedAmount = 0;
    send(raw) {
      const packet = JSON.parse(raw);
      if (packet.type === "frame") { browserFrames.push(packet.frame); void online.handle(packet); }
    }
    receive(packet) { const event = new Event("message"); event.data = JSON.stringify(packet); this.dispatchEvent(event); }
    close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
  }
  const socket = new Socket();
  const online = new OnlineRelayTransport({ serverUrl: "https://fixture.test", deviceId: relay.deviceId, token: "fixture", authorized: id => relay.activeBrowserKeys.has(id), receive: (peer, frame) => relay.receiveOnlineCommand(peer, frame) });
  online.socket = { readyState: 1, bufferedAmount: pressure, send: raw => {
    const packet = JSON.parse(raw);
    if (packet.frame?.kind === "response") metadata.wss_response_count++;
    socket.receive(packet);
  }, terminate() {} };
  relay.onlineTransport = online;
  await online.handle({ type: "subscriptions", peers: [{ browser_id: browser.browserId, connection_id: "fixture_connection", transport: "stream" }], expires_at: Date.now() + 30_000 });
  assert.equal(online.peer(browser.browserId).paused, true);
  const stream = new OnlineStream({ origin: "https://fixture.test", deviceId: relay.deviceId, browserToken: "fixture", browserId: browser.browserId, socketFactory: () => socket, onFrame: async () => {}, onOnline: () => {}, onClosed: () => {} });
  stream.connect(); socket.dispatchEvent(new Event("open"));
  socket.receive({ type: "ready", connection_id: "fixture_connection", browser_id: browser.browserId });
  socket.receive({ type: "relay", state: "online" });
  const timers = [];
  const context = { useCallback: fn => fn, relayKey: { current: browserKey }, relayDeviceId: { current: relay.deviceId }, onlineStream: { current: stream }, onlineResponses: { current: new Map() }, snapshot: { device: { id: relay.deviceId } }, authLocale: "en", document: { visibilityState: "visible" }, crypto, sealJson, openJson, ONLINE_READ_TYPES, readOnlineOrHttp, RelayApiError, isPendingRelayResponse, workbenchText: (_locale, id) => id, responseWaiters: { current: new Set() }, window: {
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); timers.push(timer); return timer; }, clearTimeout,
  }, api: async (url, options) => {
    if (url === "/api/commands") {
      const frame = JSON.parse(options.body); metadata.http_posts++;
      const command = await relayOpen(relayKey, frame.envelope, frame.aad); command.browser_id = browser.browserId;
      relay.dispatchRemoteCommand(command, browser, Date.now());
      return { request_id: frame.request_id, delivery: "delivered" };
    }
    metadata.http_polls++;
    const id = decodeURIComponent(url.split("/")[3].split("?")[0]);
    while (!uploaded.has(id)) {
      if (options?.signal.aborted) throw new Error("request_cancelled");
      await delay(1);
    }
    return uploaded.get(id);
  } };
  try {
    const { sendEncryptedCommand, waitForEncryptedResponse } = createReadCallbacks(context);
    await sendEncryptedCommand("session.read_history", "fixture_session", { limit: 100, max_bytes: 256 * 1024, include_agent_details: false }, 30_000, "fixture_original");
    let complete = false;
    const pending = waitForEncryptedResponse("fixture_original", 20_000).then(value => { complete = true; metadata.completed_at_ms = elapsed(); return value; });
    await delay(100);
    metadata.at_100_ms = { stream_available: stream.available, read_completed: complete, http_response_already_present: uploaded.has("fixture_original"), http_posts: metadata.http_posts, http_polls: metadata.http_polls };
    const value = await pending;
    metadata.logical_read_requests = browserFrames.filter(frame => frame.command_type === "session.read_history").length + metadata.http_posts;
    metadata.logical_id_kept = value.request_id === "fixture_original";
    metadata.response_message_count = value.messages.length;
    const original = uploaded.get("fixture_original");
    metadata.original_envelope_bound = original ? original.request_id === "fixture_original" && original.aad.request_id === "fixture_original" : null;
    assert.equal(value.request_id, "fixture_original");
    return metadata;
  } finally {
    relay.closed = true; stream.close(); online.close();
    for (const timer of timers) clearTimeout(timer);
    await Promise.allSettled([...relay.operations]);
  }
}
