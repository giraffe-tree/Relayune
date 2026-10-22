import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  generateE2eeKey,
  importE2eeKey,
  openJson,
  sealJson,
} from "../relay/e2ee.mjs";

test("a server-routable frame contains no application plaintext", async () => {
  const key = await importE2eeKey(await generateE2eeKey());
  const metadata = {
    direction: "relay-to-web",
    device_id: "dev_test_mac",
    session_id: "ses_test",
    request_id: "req_test",
    type: "session.event",
  };
  const privateEvent = {
    kind: "message.completed",
    message: {
      id: "msg_private",
      role: "codex",
      content: "BLINDNESS_CANARY Codex private response",
    },
    approval: {
      display: "BLINDNESS_CANARY npm run production",
      cwd: "/Users/private/BLINDNESS_CANARY-project",
    },
    agent: {
      task: "BLINDNESS_CANARY audit unreleased source",
      summary: "BLINDNESS_CANARY confidential result",
    },
    attachment: {
      name: "BLINDNESS_CANARY-roadmap.png",
      base64: "QkxJTkRORVNTX0NBTkFSWQ==",
    },
  };

  const envelope = await sealJson(key, privateEvent, metadata);
  const frame = {
    ...metadata,
    event_seq: 41,
    envelope,
  };

  // This is the complete representation available to an honest-but-curious
  // broker, its queues, persistence layer, audit pipeline, and transport logs.
  const serverVisibleJson = JSON.stringify(frame);
  assert.doesNotMatch(serverVisibleJson, /BLINDNESS_CANARY/);
  assert.doesNotMatch(
    serverVisibleJson,
    /Codex private response|npm run production|Users\/private|confidential result|roadmap\.png/,
  );

  const forwarded = JSON.parse(serverVisibleJson);
  assert.equal(forwarded.device_id, metadata.device_id);
  assert.equal(forwarded.session_id, metadata.session_id);
  assert.equal(forwarded.request_id, metadata.request_id);
  assert.equal(forwarded.event_seq, 41);
  assert.deepEqual(
    await openJson(key, forwarded.envelope, visibleAad(forwarded)),
    privateEvent,
  );
});

test("changing server-visible routing metadata invalidates the ciphertext", async () => {
  const key = await importE2eeKey(await generateE2eeKey());
  const metadata = {
    direction: "web-to-relay",
    device_id: "dev_test_mac",
    session_id: "ses_original",
    request_id: "req_original",
    type: "session.submit_message",
  };
  const frame = {
    ...metadata,
    envelope: await sealJson(
      key,
      { content: "BLINDNESS_CANARY must stay in the original session" },
      metadata,
    ),
  };

  const retargeted = {
    ...frame,
    session_id: "ses_attacker_selected",
  };
  await assert.rejects(
    openJson(key, retargeted.envelope, visibleAad(retargeted)),
    /auth|decrypt|aad|integrity/i,
  );
});

test("queued encrypted frames remain opaque after serialization and replay", async () => {
  const key = await importE2eeKey(await generateE2eeKey());
  const metadata = {
    direction: "web-to-relay",
    device_id: "dev_test_mac",
    session_id: "ses_offline",
    request_id: "req_offline",
    type: "session.submit_message",
  };
  const privateCommand = {
    content: "BLINDNESS_CANARY execute after reconnect",
    client_message_id: "msg_offline_private",
  };
  const frame = {
    ...metadata,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    envelope: await sealJson(key, privateCommand, metadata),
  };

  const persistedQueue = JSON.stringify([frame]);
  assert.doesNotMatch(persistedQueue, /BLINDNESS_CANARY|execute after reconnect/);

  const [replayed] = JSON.parse(persistedQueue);
  assert.deepEqual(
    await openJson(key, replayed.envelope, visibleAad(replayed)),
    privateCommand,
  );
});

function visibleAad(frame) {
  return {
    direction: frame.direction,
    device_id: frame.device_id,
    session_id: frame.session_id,
    request_id: frame.request_id,
    type: frame.type,
  };
}

test("production logs redact dynamic identifiers and disable token-bearing access logs", async () => {
  const [server, nginx, routes] = await Promise.all([
    readFile("server/request-log.mjs", "utf8"),
    readFile("deploy/relayune.giraffetree.cn.conf", "utf8"),
    readFile("shared/request-log-routes.json", "utf8"),
  ]);

  assert.match(server, /request_method: requestMethod\(request\.method\)/);
  assert.match(server, /request_uri: routeTemplate\(request\.url\)/);
  assert.match(server, /status,/);
  assert.match(server, /request_time:/);
  assert.match(routes, /\/api\/pairings\/:pairing_id/);
  assert.match(routes, /\/api\/responses\/:request_id/);
  assert.doesNotMatch(server, /request_uri: pathname/);
  assert.doesNotMatch(server, /error instanceof Error \? error\.message/);
  const requestLog = server.slice(
    server.indexOf("const finish ="),
    server.indexOf("response.once('finish'"),
  );
  assert.doesNotMatch(requestLog, /request\.headers|request\.body/);
  assert.equal((nginx.match(/access_log off;/g) || []).length, 2);
});
