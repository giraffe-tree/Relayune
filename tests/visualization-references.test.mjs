import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MacRelay } from "../relay/mac-relay.mjs";
import { isCodexVisualizationPath, normalizeVisualizationReferences } from "../relay/visualization-references.mjs";

const path = join(homedir(), ".codex/visualizations/2026/09/07/01a07c16-9929-72c1-b8cb-95fa0b46d623/design.html");
const marker = `\uE200visualize\uE202${JSON.stringify({ path, title: "Design" })}\uE201`;

test("[MOB-ATT-011][server] visualization markers become readable file references in history and live completion", () => {
  const relay = new MacRelay({ adapter: {}, statePath: null });
  const event = relay.registerEventAttachments("session", {
    kind: "message.completed", item_id: "item", text: `Before\n${marker}\nAfter`,
  });
  assert.equal(event.text, `Before\n[Design](<${path}>)\nAfter`);
  assert.equal(event.attachments[0].mime_type, "text/html");
  assert.equal(event.attachments[0].preview_supported, true);
  assert.equal(event.attachments[0].relay_source, undefined);
  const [history] = relay.registerHistoryAttachments("session", [
    { id: "item", role: "codex", content: marker },
  ]);
  assert.equal(history.attachments[0].id, event.attachments[0].id);
  assert.equal(history.content, `[Design](<${path}>)`);
  assert.equal(relay.attachments.get(history.attachments[0].id).sessionId, "session");
});

test("HTML rendering is restricted to generated artifacts, and literal examples remain text", () => {
  for (const path of ['/tmp/secret.html', '/etc/passwd', 'https://example.com/design.html',
    join(homedir(), '.codex/visualizations/../../secret.html')]) {
    assert.equal(isCodexVisualizationPath(path), false);
  }
  assert.equal(isCodexVisualizationPath(path), true);
  const code = `\`\`\`text\n${marker}\n\`\`\``;
  assert.equal(normalizeVisualizationReferences(code), code);
  const relay = new MacRelay({ adapter: {}, statePath: null });
  const event = relay.registerEventAttachments("session", {
    kind: "message.completed", item_id: "ordinary", text: '[HTML](/tmp/page.html)',
  });
  assert.equal(event.attachments[0].mime_type, 'text/plain');
});

test("an HTML attachment from another session or outside the visualization directory cannot be read", async () => {
  const relay = new MacRelay({ deviceId: 'device', adapter: {}, statePath: null });
  const replies = [];
  relay.send = (value) => replies.push(value);
  relay.acknowledgeCommand = () => {};
  relay.attachments.set('html', {
    sessionId: 'session', type: 'file', mimeType: 'text/html', name: 'page.html',
    source: { type: 'local_path', path: '/tmp/page.html' },
  });
  const command = { device_id: 'device', session_id: 'other', request_id: 'req',
    expires_at: new Date(Date.now() + 60_000).toISOString(), payload: { attachment_id: 'html' } };
  await relay.readAttachment(command);
  assert.equal(replies.at(-1).error_code, 'attachment_not_found');
  await relay.readAttachment({ ...command, session_id: 'session' });
  assert.equal(replies.at(-1).error_code, 'attachment_unsupported');
});
