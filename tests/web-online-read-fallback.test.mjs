import assert from "node:assert/strict";
import test from "node:test";
import { cleanupReadCallbacks, createReadCallbacks, importRelayKey, openJson, sealJson, ONLINE_READ_TYPES, readOnlineOrHttp, RelayApiError, isPendingRelayResponse } from "./helpers/web-read-callbacks.mjs";
test.after(cleanupReadCallbacks);

async function fixture({ timeoutMs = 500 } = {}) {
  const key = await importRelayKey(Buffer.alloc(32, 5).toString("base64url"));
  const relayKey = { current: key };
  const relayDeviceId = { current: "dev_test" };
  const document = { visibilityState: "visible" };
  const streamFrames = [];
  const httpFrames = [];
  const polls = [];
  const onlineResponses = { current: new Map() };
  let resolveStream;
  let rejectStream;
  const streamResult = new Promise((resolve, reject) => { resolveStream = resolve; rejectStream = reject; });
  let streamAborted = false;
  const stream = { available: true, request(frame, _timeout, signal) {
    streamFrames.push(frame);
    const abort = () => { streamAborted = true; rejectStream(new Error("request_cancelled")); };
    signal.addEventListener("abort", abort, { once: true });
    return streamResult.finally(() => signal.removeEventListener("abort", abort));
  } };
  const onlineStream = { current: stream };
  let responseOverride = (frame) => frame;
  let decryptedOverride = (value) => value;
  let afterPost = () => {};
  let originalHttp = () => { throw new Error("response_unavailable"); };
  const response = async (command, type = command.command_type.startsWith("project.") ? "project.result" : "session.history", overrides = {}) => {
    const aad = { ...command.aad, direction: "relay_to_web", type, ...overrides.aad };
    const body = { type, request_id: command.request_id, session_id: command.session_id, messages: [], ...overrides.body };
    return {
      device_id: command.device_id, session_id: command.session_id, request_id: command.request_id,
      aad, envelope: await sealJson(key, body, aad), ...overrides.frame,
    };
  };
  const context = {
    useCallback: callback => callback, relayKey, relayDeviceId, onlineResponses, onlineStream,
    snapshot: { device: { id: relayDeviceId.current } }, authLocale: "en", document,
    crypto, sealJson,
    openJson: async (...args) => decryptedOverride(await openJson(...args)),
    ONLINE_READ_TYPES, readOnlineOrHttp: options => readOnlineOrHttp({ ...options, hedgeMs: 5, timeoutMs }),
    workbenchText: (_locale, id) => id,
    window: { setTimeout: () => 1, clearTimeout: () => {} }, responseWaiters: { current: new Set() },
    isPendingRelayResponse, RelayApiError,
    api: async (url, options) => {
      if (url === "/api/commands") {
        const frame = JSON.parse(options.body);
        assert.equal(options.headers["Idempotency-Key"], frame.request_id);
        httpFrames.push(frame);
        afterPost();
        return { request_id: frame.request_id, delivery: "delivered" };
      }
      polls.push(url);
      const id = decodeURIComponent(url.split("/")[3].split("?")[0]);
      const retry = httpFrames.find(frame => frame.request_id === id);
      return retry ? responseOverride(await response(retry)) : originalHttp(streamFrames[0], options);
    },
  };
  return {
    ...createReadCallbacks(context),
    key, relayKey, relayDeviceId, document, onlineStream, streamFrames, httpFrames, polls, onlineResponses,
    rejectStream, resolveStream, response,
    overrideResponse: callback => { responseOverride = callback; },
    overrideDecrypted: callback => { decryptedOverride = callback; },
    afterPost: callback => { afterPost = callback; },
    originalHttp: callback => { originalHttp = callback; },
    get streamAborted() { return streamAborted; },
  };
}

async function startRead(f, type = "session.read_history", sessionId = "session_test") {
  await f.sendEncryptedCommand(type, sessionId, { limit: 100 }, 30_000, "original_read");
  return { waiting: f.waitForEncryptedResponse("original_read", 30_000) };
}

test("[MOB-RT-012][web] slow stream read retries as a separately sealed HTTP request and keeps caller identity", async () => {
  const f = await fixture();
  const { waiting } = await startRead(f);
  // The real stream rejects at its eight-second deadline; no wall-clock delay
  // is required to exercise the callback's in-flight fallback branch.
  f.rejectStream(new Error("online_stream_timeout"));
  const value = await waiting;
  const original = f.streamFrames[0];
  const retry = f.httpFrames[0];
  assert.notEqual(retry.request_id, original.request_id);
  assert.equal(retry.aad.request_id, retry.request_id);
  assert.notEqual(retry.envelope.iv, original.envelope.iv);
  const clear = await openJson(f.key, retry.envelope, retry.aad);
  assert.equal(clear.request_id, retry.request_id);
  assert.equal(clear.session_id, original.session_id);
  assert.deepEqual(clear.payload, { limit: 100 });
  assert.match(f.polls.at(-1), new RegExp(`/api/responses/${retry.request_id}\\?`));
  assert.equal(value.request_id, "original_read");
  assert.deepEqual(value.messages, []);
  assert.equal(f.onlineResponses.current.size, 0);
});

test("a valid stream result needs no HTTP retry", async (t) => {
  // Control the hedge rather than racing real WebCrypto against a 5 ms timer
  // under parallel test load. The other cases explicitly exercise HTTP recovery.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = await fixture();
  const { waiting } = await startRead(f);
  f.resolveStream(await f.response(f.streamFrames[0]));
  assert.equal((await waiting).request_id, "original_read");
  t.mock.timers.tick(5);
  assert.equal(f.httpFrames.length, 0);
  assert.equal(f.polls.length, 0);
});

test("original HTTP result wins the delayed hedge without resubmitting a read", async () => {
  const f = await fixture();
  f.originalHttp(command => f.response(command));
  const { waiting } = await startRead(f);
  assert.equal((await waiting).request_id, "original_read");
  assert.equal(f.httpFrames.length, 0);
  assert.equal(f.polls.length, 1);
  assert.match(f.polls[0], /original_read\?device_id=dev_test&wait_ms=\d+&pending_status=202/);
  assert.equal(f.streamAborted, true);
});

test("stream failure starts original HTTP recovery immediately and waits for its healthy result", async () => {
  const f = await fixture();
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.originalHttp(async command => {
    entered();
    await new Promise(resolve => { release = resolve; });
    return f.response(command);
  });
  const { waiting } = await startRead(f);
  f.rejectStream(new Error("online_stream_unavailable"));
  await started;
  assert.equal(f.httpFrames.length, 0);
  release();
  assert.equal((await waiting).request_id, "original_read");
  assert.equal(f.httpFrames.length, 0);
});

test("HTTP hedge failure does not preempt a healthy stream response", async () => {
  const f = await fixture();
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.originalHttp(() => { entered(); throw new Error("network_failure"); });
  const { waiting } = await startRead(f);
  await started;
  assert.equal(f.httpFrames.length, 0);
  f.resolveStream(await f.response(f.streamFrames[0]));
  assert.equal((await waiting).request_id, "original_read");
  assert.equal(f.httpFrames.length, 0);
});

test("a stream winner aborts an outstanding HTTP response wait", async () => {
  const f = await fixture();
  let entered;
  let activeWaits = 0;
  const started = new Promise(resolve => { entered = resolve; });
  f.originalHttp((_command, { signal }) => new Promise((_resolve, reject) => {
    activeWaits++;
    signal.addEventListener("abort", () => { activeWaits--; reject(new Error("request_cancelled")); }, { once: true });
    entered();
  }));
  const { waiting } = await startRead(f);
  await started;
  assert.equal(activeWaits, 1);
  f.resolveStream(await f.response(f.streamFrames[0]));
  await waiting;
  assert.equal(activeWaits, 0);
  assert.equal(f.httpFrames.length, 0);
});

test("older server pending responses are retried within the original deadline without POST", async () => {
  const f = await fixture();
  let lookups = 0;
  f.originalHttp(command => ++lookups === 1 ? { pending: true, request_id: command.request_id } : f.response(command));
  const { waiting } = await startRead(f);
  assert.equal((await waiting).request_id, "original_read");
  assert.equal(lookups, 2);
  assert.equal(f.httpFrames.length, 0);
});

for (const pendingFlag of [false, undefined]) {
  test(`same-ID HTTP response with pending=${pendingFlag} is malformed and does not blind-wait`, async () => {
    const f = await fixture();
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    f.originalHttp(command => {
      entered();
      return { request_id: command.request_id, ...(pendingFlag === undefined ? {} : { pending: pendingFlag }) };
    });
    const watch = performance.now();
    const { waiting } = await startRead(f);
    await started;
    assert.equal(f.httpFrames.length, 0);
    f.rejectStream(new Error("online_stream_closed"));
    assert.equal((await waiting).request_id, "original_read");
    assert.ok(performance.now() - watch < 200);
    assert.equal(f.polls.length, 2); // One failed original lookup, then the fresh response.
    assert.equal(f.httpFrames.length, 1);
  });

  test(`same-ID HTTP pending=${pendingFlag} leaves a healthy WSS branch alive`, async () => {
    const f = await fixture();
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    f.originalHttp(command => { entered(); return { request_id: command.request_id, pending: pendingFlag }; });
    const { waiting } = await startRead(f);
    await started;
    f.resolveStream(await f.response(f.streamFrames[0]));
    assert.equal((await waiting).request_id, "original_read");
    assert.equal(f.httpFrames.length, 0);
  });
}

for (const code of ["response_wait_timeout", "response_pending", "response_not_found"]) {
  test(`original HTTP ${code} continues waiting instead of resubmitting`, async () => {
    const f = await fixture();
    let lookups = 0;
    f.originalHttp(command => {
      if (++lookups === 1) throw new RelayApiError(code, 404, code);
      return f.response(command);
    });
    const { waiting } = await startRead(f);
    assert.equal((await waiting).request_id, "original_read");
    assert.equal(lookups, 2);
    assert.equal(f.httpFrames.length, 0);
  });
}

for (const status of [401, 403]) {
  test(`HTTP ${status} authorization denial stops stream delivery and fresh retries`, async () => {
    const f = await fixture();
    const refusal = new RelayApiError("denied", status, "fixture_authorization_denied");
    f.originalHttp(() => { throw refusal; });
    const { waiting } = await startRead(f);
    await assert.rejects(waiting, error => error === refusal);
    f.resolveStream(await f.response(f.streamFrames[0]));
    assert.equal(f.streamAborted, true);
    assert.equal(f.httpFrames.length, 0);
  });
}

for (const mismatch of ["request", "session", "device", "direction", "type", "event_seq", "body_request", "body_session", "body_type", "ciphertext"]) {
  test(`original HTTP ${mismatch} mismatch cannot defeat a valid stream result`, async () => {
    const f = await fixture();
    let delivered;
    const malformedDelivered = new Promise(resolve => { delivered = resolve; });
    f.originalHttp(async command => {
      const field = { request: "request_id", session: "session_id", device: "device_id", direction: "direction", event_seq: "event_seq" }[mismatch];
      let reply;
      if (mismatch === "direction") {
        reply = await f.response(command);
        reply.aad.direction = "web_to_relay";
      } else if (field) reply = await f.response(command, "session.history", { aad: { [field]: mismatch === "event_seq" ? 1 : "wrong" } });
      else if (mismatch === "type") reply = await f.response(command, "session.agents");
      else if (mismatch.startsWith("body_")) reply = await f.response(command, "session.history", { body: { [mismatch === "body_request" ? "request_id" : mismatch === "body_session" ? "session_id" : "type"]: "wrong" } });
      else {
        reply = await f.response(command);
        reply.envelope.ciphertext = "AAAA";
      }
      delivered();
      return reply;
    });
    const { waiting } = await startRead(f);
    await malformedDelivered;
    f.resolveStream(await f.response(f.streamFrames[0]));
    assert.equal((await waiting).request_id, "original_read");
    assert.equal(f.httpFrames.length, 0);
  });
}

test("authorization changes cancel an outstanding hedge and prevent fresh retries", async () => {
  const f = await fixture();
  let entered;
  let aborted = false;
  const started = new Promise(resolve => { entered = resolve; });
  f.originalHttp((_command, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => { aborted = true; reject(new Error("request_cancelled")); }, { once: true });
    entered();
  }));
  const { waiting } = await startRead(f);
  await started;
  f.relayKey.current = null;
  await assert.rejects(waiting, /request_cancelled/);
  assert.equal(aborted, true);
  assert.equal(f.streamAborted, true);
  assert.equal(f.httpFrames.length, 0);
});

test("the shared deadline aborts both delivery waits before a separately sealed HTTP retry", async () => {
  const f = await fixture({ timeoutMs: 60 });
  let aborted = false;
  f.originalHttp((_command, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => { aborted = true; reject(new Error("request_cancelled")); }, { once: true });
  }));
  const started = performance.now();
  const { waiting } = await startRead(f);
  assert.equal((await waiting).request_id, "original_read");
  assert.ok(performance.now() - started >= 55);
  assert.ok(performance.now() - started < 300);
  assert.equal(aborted, true);
  assert.equal(f.streamAborted, true);
  assert.equal(f.httpFrames.length, 1);
  assert.notEqual(f.httpFrames[0].request_id, f.streamFrames[0].request_id);
});

test("project fallback keeps its null session and original request identity", async () => {
  const f = await fixture();
  const { waiting } = await startRead(f, "project.sessions", null);
  f.rejectStream(new Error("online_stream_timeout"));
  const value = await waiting;
  assert.equal(value.type, "project.result");
  assert.equal(value.request_id, "original_read");
  assert.equal(value.session_id, null);
});

for (const scope of ["key", "device", "background"]) {
  test(`stream fallback stops when ${scope} changes`, async () => {
    const f = await fixture();
    const { waiting } = await startRead(f);
      if (scope === "key") f.relayKey.current = null;
    if (scope === "device") f.relayDeviceId.current = "another_device";
    if (scope === "background") f.document.visibilityState = "hidden";
    f.rejectStream(new Error("online_stream_closed"));
    await assert.rejects(waiting, /request_cancelled/);
    assert.equal(f.httpFrames.length, 0);
  });
}

test("revocation while posting the retry cannot start response polling", async () => {
  const f = await fixture();
  f.afterPost(() => { f.relayKey.current = null; });
  const { waiting } = await startRead(f);
  f.rejectStream(new Error("online_stream_timeout"));
  await assert.rejects(waiting, /request_cancelled/);
  assert.equal(f.polls.length, 1); // Only the original response lookup preceded the retry.
});

for (const mismatch of ["request", "session", "device", "type", "event_seq", "body_request", "body_session", "body_type"]) {
  test(`HTTP read fallback rejects authenticated ${mismatch} mismatch`, async () => {
    const f = await fixture();
    f.overrideResponse(async () => {
      const command = f.httpFrames[0];
      if (mismatch === "request") return f.response(command, "session.history", { aad: { request_id: "other_request" }, frame: { request_id: "other_request" } });
      if (mismatch === "session") return f.response(command, "session.history", { aad: { session_id: "other_session" }, frame: { session_id: "other_session" } });
      if (mismatch === "device") return f.response(command, "session.history", { aad: { device_id: "other_device" }, frame: { device_id: "other_device" } });
      if (mismatch === "type") return f.response(command, "session.agents");
      if (mismatch === "event_seq") return f.response(command, "session.history", { aad: { event_seq: 1 } });
      return f.response(command, "session.history", { body: {
        [mismatch === "body_request" ? "request_id" : mismatch === "body_session" ? "session_id" : "type"]: "unexpected",
      } });
    });
    const { waiting } = await startRead(f);
      f.rejectStream(new Error("online_stream_timeout"));
    await assert.rejects(waiting, /online_response_(route|invalid)/);
  });
}

test("revocation during decryption cannot return a completed retry", async () => {
  const f = await fixture();
  f.overrideDecrypted(value => { f.relayKey.current = null; return value; });
  const { waiting } = await startRead(f);
  f.rejectStream(new Error("online_stream_timeout"));
  await assert.rejects(waiting, /request_cancelled/);
});

test("durable mutations use the original request ID and never enter the stream retry path", async () => {
  const f = await fixture();
  for (const type of ["session.create", "session.submit_message", "approval.resolve"]) {
    await f.sendEncryptedCommand(type, "session_test", { content: "fixture" }, 30_000, `original_${type}`);
    const frame = f.httpFrames.at(-1);
    assert.equal(frame.request_id, `original_${type}`);
    assert.equal(frame.aad.request_id, frame.request_id);
    assert.equal((await openJson(f.key, frame.envelope, frame.aad)).request_id, frame.request_id);
  }
  assert.equal(f.streamFrames.length, 0);
});
