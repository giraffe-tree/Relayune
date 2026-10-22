import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

import { verifyProductionRealtime } from "../scripts/production-realtime-smoke.mjs";

const PUBLIC_ORIGIN = "https://relayune.giraffetree.cn";
const SESSION_TOKEN = "session_secret";
const BROWSER_TOKEN = "b".repeat(43);
const DEVICE_ID = "dev_smoke";
const PLAINTEXT_CANARY = "MUST_NOT_APPEAR_ON_WIRE";

async function importRealtime() {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-production-wss-"));
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

test("[MOB-REL-003][deploy] production verifier completes authenticated WSS reconnect and opaque-event smoke", async () => {
  const bundled = await importRealtime();
  let eventCatchUps = 0;
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/api/events")) {
      assert.equal(request.headers.cookie, `relay_session=${SESSION_TOKEN}`);
      assert.equal(request.headers["x-relay-browser-token"], BROWSER_TOKEN);
      response.setHeader("Content-Type", "application/json");
      eventCatchUps += 1;
      if (eventCatchUps === 1) {
        response.end(JSON.stringify({
          events: [],
          next_cursor: 0,
          has_more: false,
        }));
        return;
      }
      response.end(JSON.stringify({
        events: [{
          cursor: 1,
          aad: { device_id: DEVICE_ID },
          envelope: {
            v: 2,
            alg: "A256GCM",
            kid: `sha256:${"k".repeat(43)}`,
            iv: "AAAAAAAAAAAAAAAA",
            aad: "e30",
            ciphertext: "opaque_ciphertext",
          },
        }],
        next_cursor: 1,
        has_more: false,
      }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  const hub = bundled.module.attachRealtimeServer(server, {
    publicOrigin: PUBLIC_ORIGIN,
    onlineWindowMs: 45_000,
    heartbeatIntervalMs: 60_000,
    authenticateSession: async (request) =>
      request.headers.cookie === `relay_session=${SESSION_TOKEN}`
        ? "owner@example.com"
        : null,
    authorize: async (_request, email, payload) => {
      assert.equal(email, "owner@example.com");
      assert.equal(payload.deviceId, DEVICE_ID);
      assert.equal(payload.browserToken, BROWSER_TOKEN);
      return {
        deviceId: DEVICE_ID,
        browserId: "browser_smoke",
        lastSeenAt: Date.now(),
      };
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const result = await verifyProductionRealtime({
      origin: `http://127.0.0.1:${address.port}`,
      publicOrigin: PUBLIC_ORIGIN,
      sessionToken: SESSION_TOKEN,
      browserToken: BROWSER_TOKEN,
      deviceId: DEVICE_ID,
      plaintextCanary: PLAINTEXT_CANARY,
      trigger: async () => hub.invalidate(DEVICE_ID, ["events"]),
    });

    assert.deepEqual(result, {
      unauthenticated_upgrade_rejected: true,
      authenticated_presence: true,
      event_invalidation_received: true,
      opaque_event_count: 1,
      reconnect_ready: true,
    });
    assert.equal(
      eventCatchUps,
      2,
      "the production probe must tolerate one eventually-consistent empty catch-up",
    );
  } finally {
    hub.close();
    await new Promise((resolve) => server.close(resolve));
    await bundled.cleanup();
  }
});
