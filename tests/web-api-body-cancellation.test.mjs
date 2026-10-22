import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { cleanupReadCallbacks, combineAbortSignals, createWebApi, isBrowserAuthorizationLost, readOnlineOrHttp, RelayApiError } from "./helpers/web-read-callbacks.mjs";

test.after(cleanupReadCallbacks);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

async function fixture(t) {
  const headers = deferred(), disconnected = deferred();
  const server = createServer((request, response) => {
    if (request.url === "/api/responses/held") {
      request.socket.once("close", () => disconnected.resolve());
      response.writeHead(200, { "Content-Type": "application/json" });
      response.flushHeaders();
      response.write('{"incomplete":'); // Headers arrive; the JSON body never ends.
      return;
    }
    const [status, code] = request.url.slice("/api/status/".length).split("/");
    response.writeHead(Number(status), { "Content-Type": "application/json" });
    response.end(code === "invalid_json" ? "{" : JSON.stringify({ error: { code, message: "fixture" } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const events = [];
  const api = createWebApi({
    API_BASE: `http://127.0.0.1:${server.address().port}`,
    RELAY_REQUEST_TIMEOUT_MS: 1_000, RELAYUNE_WEB_RELEASE_VERSION: "fixture",
    activeBrowserAuthorizationToken: "fixture", activeWorkbenchLocale: "en",
    workbenchText: (_locale, key) => key,
    combineAbortSignals, isBrowserAuthorizationLost, RelayApiError,
    fetch: async (...args) => {
      const response = await fetch(...args);
      headers.resolve();
      return response;
    },
    window: { setTimeout, clearTimeout, dispatchEvent: event => { events.push(event.type); } },
  });
  return { api, headers: headers.promise, disconnected: disconnected.promise, events };
}

function raceRead(api, timeoutMs) {
  const stream = deferred();
  let httpResult;
  const result = readOnlineOrHttp({
    timeoutMs, hedgeMs: 5, assertActive: () => {}, isPending: () => false, isFatal: () => false,
    online: signal => {
      signal.addEventListener("abort", () => stream.reject(new Error("request_cancelled")), { once: true });
      return stream.promise;
    },
    http: (signal, remainingMs) => {
      httpResult = api("/api/responses/held", { signal, relayTimeoutMs: remainingMs });
      return httpResult;
    },
  });
  return { result, stream, get httpResult() { return httpResult; } };
}

test("a WSS winner aborts the real fetch response body and closes its HTTP socket", { timeout: 3_000 }, async t => {
  const f = await fixture(t);
  const race = raceRead(f.api, 1_000);
  await f.headers;
  const httpRejected = assert.rejects(race.httpResult, error => error.name === "AbortError");
  race.stream.resolve({ delivery: "wss" });
  assert.deepEqual(await race.result, { delivery: "wss" });
  await httpRejected;
  await f.disconnected;
});

test("the shared read deadline cancels a real HTTP body that stalled after response headers", { timeout: 3_000 }, async t => {
  const f = await fixture(t);
  const race = raceRead(f.api, 80);
  const rejected = assert.rejects(race.result, /online_stream_timeout/);
  await f.headers;
  const httpRejected = assert.rejects(race.httpResult, error => error.name === "AbortError" || error.code === "network_timeout");
  await rejected;
  await httpRejected;
  await f.disconnected;
});

test("the API's own timeout includes the real response body and remains a network_timeout", { timeout: 3_000 }, async t => {
  const f = await fixture(t);
  await assert.rejects(f.api("/api/responses/held", { relayTimeoutMs: 60 }), error =>
    error instanceof RelayApiError && error.status === 0 && error.code === "network_timeout");
  await f.disconnected;
});

for (const [status, code, event] of [
  [401, "browser_unauthorized", "relayune-browser-revoked"],
  [402, "fixture_denial", undefined],
  [403, "fixture_denial", undefined],
  [404, "device_not_found", "relayune-browser-revoked"],
  [404, "response_pending", undefined],
]) {
  test(`HTTP ${status} ${code} keeps its business error and event`, async t => {
    const f = await fixture(t);
    await assert.rejects(f.api(`/api/status/${status}/${code}`), error =>
      error instanceof RelayApiError && error.status === status && error.code === code);
    assert.deepEqual(f.events, event ? [event] : []);
  });
}

test("invalid JSON keeps the existing HTTP error status instead of becoming a network error", async t => {
  const f = await fixture(t);
  await assert.rejects(f.api("/api/status/403/invalid_json"), error =>
    error instanceof RelayApiError && error.status === 403 && error.code === "request_failed");
});
