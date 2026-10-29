import assert from "node:assert/strict";
import test from "node:test";
import { MacRelay } from "../relay/mac-relay.mjs";
import { generateE2eeKey, importE2eeKey, keyIdForKey, openJson } from "../relay/e2ee.mjs";

test("desktop version stays encrypted and a changed version invalidates the catalog cache", async () => {
  const agents = [{ provider: "codex", version: "1.2.3+agent-canary", status: "ready" }];
  const relay = new MacRelay({
    adapter: {}, statePath: null, desktopVersion: "0.3.18+version-canary",
    readAgentRuntimeInfo: async () => agents,
  });
  const key = await importE2eeKey(generateE2eeKey());
  relay.activeBrowserKeys.set("browser", {
    browserId: "browser", key, keyId: await keyIdForKey(key),
  });
  const catalog = { type: "relay.sync_sessions", sessions: [], projects: [] };
  const [encoded] = await relay.encodeRemoteMessage(catalog);
  assert.equal(JSON.stringify(encoded).includes("version-canary"), false);
  assert.equal(JSON.stringify(encoded).includes("agent-canary"), false);
  assert.equal("desktop" in encoded, false);
  assert.equal("agents" in encoded, false);
  const plaintext = await openJson(key, encoded.envelope, encoded.aad);
  assert.deepEqual(plaintext.desktop, {
    local_web_version: 1, attachment_ranges_version: 1, session_directory_version: 1, directory_push_version: 1, version: "0.3.18+version-canary", platform: process.platform, agents, transports: ["webrtc-session-v2", "webrtc-auto-v1", "webrtc-trickle-v1", "online-stream-v1"],
  });
  relay.rememberSuccessfulCatalogUpload(encoded);
  assert.deepEqual(await relay.encodeRemoteMessage(catalog), []);
  relay.desktopInfo.version = "0.3.19";
  const [updated] = await relay.encodeRemoteMessage(catalog);
  assert.equal((await openJson(key, updated.envelope, updated.aad)).desktop.version, "0.3.19");
});

test("a standalone relay does not guess the desktop application version", () => {
  const relay = new MacRelay({ adapter: {}, statePath: null });
  assert.equal(relay.desktopInfo.version, null);
});

test('first pairing catalog excludes repeated config menus without losing session metadata or full detail data', async () => {
  const relay = new MacRelay({adapter: {}, statePath: null, readAgentRuntimeInfo: async () => []});
  const key = await importE2eeKey(generateE2eeKey());
  relay.activeBrowserKeys.set('new-client', {browserId: 'new-client', key, keyId: await keyIdForKey(key)});
  const menu = [{id: 'model', options: Array.from({length: 12}, (_, i) => ({
    value: `model-${i}`, description: '模型配置说明'.repeat(150),
  }))}];
  const sessions = Array.from({length: 50}, (_, i) => ({id: `session-${i}`,
    name: `会话 ${i}`, provider: 'codex', model: 'model-1', reasoning_effort: 'high',
    continue_turn_id: 'paused-turn', capabilities: {continue_supported: true},
    session_config_options: menu, kimi_config_options: menu,
  }));
  assert.ok(Buffer.byteLength(JSON.stringify(sessions)) > 512_000);
  const [frame] = await relay.encodeRemoteMessage({type: 'relay.sync_sessions', sessions, projects: []});
  assert.ok(Buffer.byteLength(JSON.stringify(frame.envelope)) < 512_000);
  relay.enqueueRemoteMessages([frame]);
  assert.equal(relay.uploadQueue.length, 1);
  assert.equal(relay.rejectedUploadKeys.size, 0);
  const catalog = await openJson(key, frame.envelope, frame.aad);
  assert.equal(catalog.sessions.length, 50);
  assert.equal(catalog.sessions[0].model, 'model-1');
  assert.equal(catalog.sessions[0].reasoning_effort, 'high');
  assert.equal(catalog.sessions[0].continue_turn_id, 'paused-turn');
  assert.deepEqual(catalog.sessions[0].capabilities, {continue_supported: true});
  assert.equal('session_config_options' in catalog.sessions[0], false);
  assert.equal('kimi_config_options' in catalog.sessions[0], false);
  assert.strictEqual(sessions[0].session_config_options, menu);
  assert.strictEqual(sessions[0].kimi_config_options, menu);
});
