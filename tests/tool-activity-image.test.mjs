import assert from "node:assert/strict";
import test from "node:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CodexAppServerAdapter,
  codexRolloutActivityEvents,
  codexToolActivityEventFromItem,
} from "../relay/codex-adapters.mjs";
import { MacRelay } from "../relay/mac-relay.mjs";
import { readRolloutAttachmentDataUrl } from '../relay/codex-rollout-history-index.mjs';

const SESSION_ID = "thread_image_activity";
const IMAGE_PATH = "/tmp/private/codex-workbench.png";

test("[MOB-ATT-010][relay] generated image items expose their saved image", () => {
  const event = codexToolActivityEventFromItem(
    { id: "generated-1", type: "imageGeneration", savedPath: IMAGE_PATH },
    { completed: true, turnId: "turn-image" },
  );
  assert.equal(event.activity_type, "image_generation");
  assert.deepEqual(event.relay_attachment.relay_source, {
    type: "local_path", path: IMAGE_PATH,
  });
});

test("[MOB-ATT-010][relay] tool output images survive large live records, waits and history reload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relayune-output-images-"));
  const path = join(directory, "rollout.jsonl");
  const turnId = "turn-images";
  const lifecycle = {
    type: "event_msg",
    payload: { type: "task_started", turn_id: turnId },
  };
  const image = (index) => ({
    type: "input_image",
    image_url: `data:image/png;base64,${Buffer.from(`image-${index}`).toString("base64")}`,
  });
  const output = (id, type, images) => ({
    timestamp: "2026-09-05T15:45:00.000Z",
    type: "response_item",
    payload: {
      type, id, call_id: id,
      output: [{ type: "input_text", text: "x".repeat(1100000) }, ...images],
      internal_chat_message_metadata_passthrough: { turn_id: turnId },
    },
  });
  const records = [
    output("exec-output", "custom_tool_call_output", [image(1), image(2), image(3)]),
    output("wait-output", "function_call_output", [image(4)]),
  ];
  try {
    await writeFile(path, `${JSON.stringify(lifecycle)}\n`);
    const events = [];
    const adapter = new CodexAppServerAdapter({ workspace: directory });
    adapter.handlers = { emitEvent: async (_sessionId, event) => events.push(event) };
    const thread = { id: SESSION_ID, path, cwd: directory, turns: [], status: { type: "idle" } };
    await adapter.pollExternalRolloutActivity(thread);
    const serialized = records.map((record) => JSON.stringify(record)).join("\n");
    await appendFile(path, serialized.slice(0, 500000));
    await adapter.pollExternalRolloutActivity(thread);
    assert.equal(events.length, 0);
    await appendFile(path, `${serialized.slice(500000)}\n`);
    for (let index = 0; index < 4; index += 1) {
      await adapter.pollExternalRolloutActivity(thread);
    }
    const imageEvents = events.filter((event) => event.kind === "message.completed");
    assert.deepEqual(imageEvents.map((event) => event.attachments.length), [3, 1]);
    assert.ok(imageEvents.every((event) => event.turn_id === turnId));
    const relay = new MacRelay({ serverUrl: "https://relay.invalid", adapter: {}, statePath: null });
    const publicEvents = imageEvents.map((event) => relay.registerEventAttachments(SESSION_ID, event));
    assert.doesNotMatch(JSON.stringify(publicEvents), /data:image|relay_source/);
    assert.equal(relay.attachments.size, 4);
    adapter.request = async (method) => {
      if (method === "thread/read") return { thread };
      if (method === "thread/list") return { data: [], nextCursor: null };
      throw new Error(`Unexpected request: ${method}`);
    };
    const page = await adapter.readHistory({ sessionId: SESSION_ID });
    assert.deepEqual(page.messages.map((message) => message.id), imageEvents.map((event) => event.item_id));
    const resolvedAttachments = await Promise.all(page.messages.map(async message =>
      Promise.all(message.attachments.map(async attachment => ({ ...attachment,
        relay_source: { type: 'data_url', url: await readRolloutAttachmentDataUrl(attachment.relay_source) } })))));
    assert.deepEqual(resolvedAttachments, imageEvents.map((event) => event.attachments));
    const reloaded = await adapter.readHistory({ sessionId: SESSION_ID });
    assert.deepEqual(reloaded.messages, page.messages);
    thread.turns = [{
      id: turnId,
      status: "completed",
      completedAt: "2026-09-05T15:46:00.000Z",
      items: [{ id: "final", type: "agentMessage", phase: "final_answer", text: "Four concepts" }],
    }, {
      id: "later-turn",
      status: "completed",
      completedAt: "2026-09-05T15:47:00.000Z",
      items: [{ id: "later-final", type: "agentMessage", text: "Next reply" }],
    }];
    await appendFile(path, [
      { timestamp: '2026-09-05T15:46:00.000Z', type: 'event_msg', payload: { type: 'item_completed', turn_id: turnId,
        item: thread.turns[0].items[0] } },
      { timestamp: '2026-09-05T15:46:00.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId } },
      { timestamp: '2026-09-05T15:47:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'later-turn' } },
      { timestamp: '2026-09-05T15:47:00.000Z', type: 'event_msg', payload: { type: 'item_completed', turn_id: 'later-turn',
        item: thread.turns[1].items[0] } },
      { timestamp: '2026-09-05T15:47:00.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'later-turn' } },
    ].map(JSON.stringify).join('\n') + '\n');
    const completed = await adapter.readHistory({ sessionId: SESSION_ID });
    assert.deepEqual(completed.messages.map((message) => message.id), ["final", "later-final"]);
    assert.equal(completed.messages[0].attachments.length, 4);
    assert.equal(completed.messages[1].attachments, undefined);
    const state = { currentTurnId: turnId, pendingCalls: new Map() };
    assert.deepEqual(codexRolloutActivityEvents(records[0], state, { seed: true }), []);
    const invalid = output("invalid", "function_call_output", [{ type: "input_image", image_url: "https://example.com/private.png" }]);
    assert.deepEqual(codexRolloutActivityEvents(invalid, state), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("[MOB-ATT-010][relay] viewed images become private on-demand attachments", () => {
  const privateEvent = codexToolActivityEventFromItem(
    { id: "image-1", type: "ImageView", path: IMAGE_PATH },
    { completed: true, turnId: "turn-image" },
  );
  assert.equal(privateEvent.activity_type, "image_view");
  assert.equal(privateEvent.activity_subject, "codex-workbench.png");
  assert.deepEqual(privateEvent.relay_attachment.relay_source, {
    type: "local_path",
    path: IMAGE_PATH,
  });

  const relay = new MacRelay({
    serverUrl: "https://relay.invalid",
    adapter: {},
    statePath: null,
  });
  const publicEvent = relay.registerEventAttachments(
    SESSION_ID,
    privateEvent,
  );

  assert.equal("relay_attachment" in publicEvent, false);
  assert.doesNotMatch(JSON.stringify(publicEvent), /\/tmp\/private/);
  assert.deepEqual(
    {
      type: publicEvent.attachments[0].type,
      name: publicEvent.attachments[0].name,
      mimeType: publicEvent.attachments[0].mime_type,
      detail: publicEvent.attachments[0].detail,
    },
    {
      type: "image",
      name: "codex-workbench.png",
      mimeType: "image/png",
      detail: "original",
    },
  );
  assert.match(
    publicEvent.attachments[0].url,
    /^\/api\/sessions\/thread_image_activity\/attachments\/tool_asset_/,
  );
  assert.deepEqual(
    relay.attachments.get(publicEvent.attachments[0].id)?.source,
    { type: "local_path", path: IMAGE_PATH },
  );
});

test("[MOB-ATT-010][relay] orchestrated view_image calls keep a private preview source", () => {
  const state = { currentTurnId: "turn-image", pendingCalls: new Map() };
  const [privateEvent] = codexRolloutActivityEvents(
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        call_id: "view-image-call",
        name: "exec",
        input:
          'const image = await tools.view_image({path:"/tmp/private/codex-workbench.png",detail:"original"}); image(image.image_url);',
      },
    },
    state,
  );

  assert.equal(privateEvent.activity_type, "image_view");
  assert.equal(privateEvent.activity_subject, "codex-workbench.png");
  assert.deepEqual(privateEvent.relay_attachment.relay_source, {
    type: "local_path",
    path: IMAGE_PATH,
  });

  const relay = new MacRelay({
    serverUrl: "https://relay.invalid",
    adapter: {},
    statePath: null,
  });
  const publicEvent = relay.registerEventAttachments(
    SESSION_ID,
    privateEvent,
  );
  assert.equal("relay_attachment" in publicEvent, false);
  assert.equal(publicEvent.attachments[0].name, "codex-workbench.png");
  assert.doesNotMatch(JSON.stringify(publicEvent), /\/tmp\/private/);
});

test("[MOB-ATT-010][relay] viewed-image history keeps its attachment readable", async () => {
  const adapter = new CodexAppServerAdapter({ workspace: "/workspace" });
  adapter.handlers = { emitEvent: async () => {} };
  adapter.request = async (method, params) => {
    if (method === "thread/read") {
      return {
        thread: {
          id: SESSION_ID,
          cwd: "/workspace",
          status: { type: "idle" },
          turns: [
            {
              id: "turn-image",
              status: "completed",
              startedAt: "2026-08-30T10:00:00.000Z",
              completedAt: "2026-08-30T10:00:01.000Z",
              items: [
                { id: "image-1", type: "ImageView", path: IMAGE_PATH },
              ],
            },
          ],
        },
      };
    }
    if (method === "thread/list" && params.ancestorThreadId) {
      return { data: [], nextCursor: null };
    }
    throw new Error(`Unexpected Codex request: ${method}`);
  };

  const page = await adapter.readHistory({ sessionId: SESSION_ID });
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].tool_activity_type, "image_view");
  assert.deepEqual(page.messages[0].attachments[0].relay_source, {
    type: "local_path",
    path: IMAGE_PATH,
  });
});
