import assert from "node:assert/strict";
import test from "node:test";
import { startRelay, startupFailureCategory } from "../relay/startup.mjs";

const never = () => new Promise(() => {});

for (const phase of ["agents", "registration", "initial_sync", "polling"]) {
  test(`startup deadline covers a stalled ${phase} stage and closes the Relay`, async () => {
    let closed = false;
    const relay = {
      start() { this.onStartupPhase(phase); return never(); },
      waitUntilReady() { assert.fail("must not reach readiness"); },
      async stop() { closed = true; },
    };
    await assert.rejects(startRelay(relay, { timeoutMs: 10 }), new RegExp(`timed out: ${phase}$`));
    assert.equal(closed, true);
    assert.equal(relay.onStartupPhase, undefined);
  });
}

test("startup failure does not expose arbitrary remote error content", async () => {
  const relay = {
    async start() { this.onStartupPhase("registration"); throw new Error("private remote response"); },
    async stop() {},
  };
  await assert.rejects(startRelay(relay), { message: "Relayune Relay startup failed: registration" });
});

test("stuck cleanup is bounded and still attempts to close Agent children", async () => {
  let closed = false;
  const relay = {
    async start() { throw new Error("failure"); },
    stop: never,
    adapter: { close() { closed = true; return never(); } },
  };
  await assert.rejects(startRelay(relay, { cleanupTimeoutMs: 10 }), /startup failed/);
  assert.equal(closed, true);
});

test("hook installation is also covered by the startup deadline", async () => {
  let closed = false;
  const relay = { async start() {}, async waitUntilReady() {}, async stop() { closed = true; } };
  await assert.rejects(startRelay(relay, { configureHooks: never, timeoutMs: 10 }), /timed out: hooks$/);
  assert.equal(closed, true);
});

test("successful startup leaves Relay running and clears the deadline", async () => {
  const steps = [];
  const relay = {
    async start() { steps.push("start"); },
    async waitUntilReady() { steps.push("ready"); },
    async stop() { assert.fail("successful Relay must stay running"); },
  };
  await startRelay(relay, { configureHooks: async () => { steps.push("hooks"); }, timeoutMs: 10 });
  assert.deepEqual(steps, ["start", "ready", "hooks"]);
  assert.equal(relay.onStartupPhase, undefined);
  await new Promise(resolve => setTimeout(resolve, 20));
});

test("startup diagnostics distinguish transient network/server failures and revoked credentials without error text", () => {
  for (const [error, expected] of [
    [{ status: 401, message: "private token" }, "unauthorized"],
    [{ status: 403 }, "unauthorized"],
    [{ status: 503 }, "server"],
    [{ status: 429 }, "server"],
    [{ code: "startup_timeout" }, "timeout"],
    [{ name: "TimeoutError" }, "timeout"],
    [{ cause: { code: "ECONNRESET", message: "private URL" } }, "network"],
    [new TypeError("fetch failed"), "network"],
    [new Error("private conversation"), null],
  ]) assert.equal(startupFailureCategory(error), expected);
});
