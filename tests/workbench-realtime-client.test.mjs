import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

async function importRealtimeState() {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-web-realtime-"));
  const outfile = join(temporary, "realtime-state.mjs");
  await build({
    entryPoints: ["app/realtime-state.ts"],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  return {
    module: await import(`${pathToFileURL(outfile).href}?${Date.now()}`),
    cleanup: () => rm(temporary, { recursive: true, force: true }),
  };
}

test("[MOB-STA-001][web] one immutable device state projects to every surface", async () => {
  const fixture = await importRealtimeState();
  try {
    const baseline = fixture.module.projectBootstrapPresence(
      fixture.module.INITIAL_REALTIME_DEVICE_STATE,
      { online: true, lastSeenAt: "2026-08-10T08:00:00.000Z" },
    );
    const confirmed = fixture.module.projectPresenceSignal(baseline, {
      online: false,
      lastSeenAt: "2026-08-10T08:01:00.000Z",
      revision: 20,
    });
    assert.equal(confirmed.online, false);
    assert.equal(confirmed.lastSeenAt, "2026-08-10T08:01:00.000Z");
    assert.equal(confirmed.realtimeConfirmed, true);
  } finally {
    await fixture.cleanup();
  }
});

test("[MOB-STA-002][web] stale presence cannot overwrite a newer transition", async () => {
  const fixture = await importRealtimeState();
  try {
    const recent = fixture.module.projectPresenceSignal(
      fixture.module.INITIAL_REALTIME_DEVICE_STATE,
      { online: false, lastSeenAt: null, revision: 30 },
    );
    const stale = fixture.module.projectPresenceSignal(recent, {
      online: true,
      lastSeenAt: "2026-08-10T07:00:00.000Z",
      revision: 29,
    });
    assert.equal(stale, recent);
    assert.equal(stale.online, false);
  } finally {
    await fixture.cleanup();
  }
});

test("[MOB-STA-003][web] websocket transport never masquerades as computer presence", async () => {
  const fixture = await importRealtimeState();
  try {
    const online = fixture.module.projectPresenceSignal(
      fixture.module.INITIAL_REALTIME_DEVICE_STATE,
      {
        online: true,
        lastSeenAt: "2026-08-10T08:00:00.000Z",
        revision: 31,
      },
    );
    const reconnecting = fixture.module.projectTransport(
      online,
      "reconnecting",
    );
    assert.equal(reconnecting.online, true);
    assert.equal(reconnecting.transport, "reconnecting");
  } finally {
    await fixture.cleanup();
  }
});

test("[MOB-RT-005][web] cursor advances only after every encrypted frame is verified and applied", async () => {
  const fixture = await importRealtimeState();
  try {
    let committedCursor = 0;
    const applied = [];
    await assert.rejects(
      async () => {
        committedCursor = await fixture.module.consumeVerifiedFrames({
          frames: [
            { cursor: 1, valid: true },
            { cursor: 2, valid: false },
          ],
          cursor: committedCursor,
          cursorFor: (frame) => frame.cursor,
          verify: async (frame) => {
            if (!frame.valid) throw new Error("authentication failed");
            return frame.cursor;
          },
          apply: (event) => applied.push(event),
        });
      },
      /authentication failed/,
    );
    assert.deepEqual(applied, [1]);
    assert.equal(committedCursor, 0);
  } finally {
    await fixture.cleanup();
  }
});

test("[MOB-RT-006][web] reconnect uses bounded jitter and performs one cursor catch-up", async () => {
  const fixture = await importRealtimeState();
  try {
    assert.equal(fixture.module.realtimeReconnectDelay(0, 0), 375);
    assert.equal(fixture.module.realtimeReconnectDelay(20, 1), 37500);
    assert.equal(
      fixture.module.realtimeWebSocketUrl(
        "https://relayune.giraffetree.cn/?token=must-not-survive",
      ),
      "wss://relayune.giraffetree.cn/api/realtime",
    );
    const page = await readFile("app/workbench-page.tsx", "utf8");
    assert.match(
      page,
      /signal\.type === "ready"[\s\S]{0,420}invalidationQueue.enqueue\(\[[\s\S]{0,160}"events"[\s\S]{0,80}"catalog"[\s\S]{0,80}"queue"[\s\S]{0,80}"responses"[\s\S]{0,80}\]\)/,
    );
    assert.match(
      page,
      /const syncInvalidation[\s\S]{0,350}catchUpEncryptedEvents\(\)/,
    );
    assert.match(page, /eventCatchUpInFlight\.current/);
  } finally {
    await fixture.cleanup();
  }
});

test("[MOB-STA-005][web] revoked browser authorization clears realtime credentials", async () => {
  const page = await readFile("app/workbench-page.tsx", "utf8");
  assert.match(
    page,
    /event\.code === 4401[\s\S]{0,140}relayune-browser-revoked/,
  );
  assert.match(
    page,
    /const handleRevoked[\s\S]{0,260}activeBrowserAuthorizationToken = ""[\s\S]{0,640}clearStoredRelayKey/,
  );
});

test("[MOB-RT-009][web] workbench has no steady event bootstrap or history polling", async () => {
  const page = await readFile("app/workbench-page.tsx", "utf8");
  assert.match(page, /new WebSocket\(/);
  assert.doesNotMatch(page, /setInterval\(\(\) => void poll\(\), 900\)/);
  assert.doesNotMatch(page, /setInterval\([\s\S]{0,120}refreshWithStatus/);
  assert.doesNotMatch(
    page,
    /setInterval\([\s\S]{0,160}loadHistory\([\s\S]{0,80}4_000/,
  );
  assert.match(page, /\/api\/responses\/\$\{encodeURIComponent\(requestId\)\}\?pending_status=202/);
  assert.match(
    page,
    /unique\.has\("responses"\)[\s\S]{0,160}responseWaiters\.current/,
  );
  assert.match(page, /window\.setTimeout\(wake, 1_000\)/);
  assert.doesNotMatch(page, /window\.setTimeout\(resolve, 250\)/);
});
