import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import sharp from "sharp";
import { CodexAppServerAdapter } from "../relay/codex-adapters.mjs";
import {
  generateE2eeKey,
  keyIdForKey,
  openJson,
  sealJson,
} from "../relay/e2ee.mjs";
import { MacRelay } from "../relay/mac-relay.mjs";

const DEVICE_ID = "dev_attachment_blob_test";
const SESSION_ID = "ses_attachment_blob_test";
const REQUEST_ID = "req_attachment_blob_test";
const USER_ID = "usr_attachment_test";
const EMAIL = "attachment@example.com";
const BROWSER_ID = `web_${"a".repeat(32)}`;
const BROWSER_TOKEN = "b".repeat(43);
const DEVICE_TOKEN = "attachment-device-token";

test("[MOB-ATT-003][relay] Codex app-server receives uploaded images as authenticated data URLs", async () => {
  const requests = [];
  const adapter = new CodexAppServerAdapter({ workspace: "/workspace" });
  adapter.handlers = { emitEvent: async () => {} };
  adapter.request = async (method, params) => {
    requests.push({ method, params });
    if (method === "thread/resume") return { thread: { id: "thread_upload" } };
    if (method === "turn/start") return { turn: { id: "turn_upload" } };
    throw new Error(`Unexpected Codex request: ${method}`);
  };

  const result = await adapter.submitMessage({
    sessionId: "thread_upload",
    requestId: "req_upload",
    clientMessageId: "msg_upload",
    content: "inspect this image",
    attachments: [
      {
        id: "upload_image",
        name: "image.png",
        mime_type: "image/png",
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      },
    ],
  });

  assert.equal(result.persisted, true);
  assert.deepEqual(requests.at(-1), {
    method: "turn/start",
    params: {
      threadId: "thread_upload",
      cwd: "/workspace",
      input: [
        { type: "text", text: "inspect this image", text_elements: [] },
        { type: "image", url: "data:image/png;base64,iVBORw0KGgo=" },
      ],
      clientUserMessageId: "msg_upload",
    },
  });
});

test("[MOB-ATT-010][relay] live Codex user attachments stay private and remotely readable", () => {
  const relay = new MacRelay({
    serverUrl: "https://relay.test",
    adapter: {},
    statePath: null,
  });
  const event = relay.registerEventAttachments("thread_live", {
    kind: "user.message",
    attachments: [
      {
        id: "asset_live",
        type: "image",
        name: "live.png",
        mime_type: "image/png",
        relay_source: { type: "local_path", path: "/private/live.png" },
      },
    ],
  });

  assert.deepEqual(event.attachments, [
    {
      id: "asset_live",
      type: "image",
      name: "live.png",
      mime_type: "image/png",
      url: "/api/sessions/thread_live/attachments/asset_live",
    },
  ]);
  assert.deepEqual(relay.attachments.get("asset_live")?.source, {
    type: "local_path",
    path: "/private/live.png",
  });
  assert.doesNotMatch(JSON.stringify(event), /private\/live/);
});

test("[MOB-ATT-009][relay] image previews use balanced 720p before originals", async () => {
  const imagePath = join(process.cwd(), "public", "og.png");
  const relay = new MacRelay({
    serverUrl: "https://relay.test",
    adapter: {},
    statePath: null,
  });
  const responses = [];
  relay.send = (message) => {
    responses.push(message);
    return true;
  };
  const event = relay.registerEventAttachments("thread_image_preview", {
    kind: "user.message",
    attachments: [
      {
        id: "asset_preview",
        type: "image",
        name: "preview.png",
        mime_type: "image/png",
        relay_source: { type: "local_path", path: imagePath },
      },
    ],
  });
  const attachment = event.attachments[0];
  const command = (variant) => ({
    type: "session.read_attachment",
    device_id: "dev_local_mac",
    request_id: `read_${variant}`,
    session_id: "thread_image_preview",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    payload: { attachment_id: attachment.id, variant },
  });

  await relay.readAttachment(command("preview"));
  const preview = responses.find(
    (response) =>
      response.type === "session.attachment" &&
      response.request_id === "read_preview",
  );
  const previewBytes = Buffer.from(preview.base64, "base64");
  assert.equal(preview.type, "session.attachment");
  assert.equal(preview.variant, "preview");
  assert.ok(previewBytes.byteLength <= 1024 * 1024);
  assert.match(preview.mime_type, /^image\/(?:png|jpeg)$/);
  const previewMetadata = await sharp(previewBytes).metadata();
  assert.equal(previewMetadata.width, 1280);
  assert.equal(previewMetadata.height, 717);

  await relay.readAttachment(command("original"));
  const original = responses.find(
    (response) =>
      response.type === "session.attachment" &&
      response.request_id === "read_original",
  );
  assert.equal(original.variant, "original");
  assert.deepEqual(
    Buffer.from(original.base64, "base64"),
    await readFile(imagePath),
  );
  assert.notDeepEqual(previewBytes, Buffer.from(original.base64, "base64"));
});

test("[relay] agent file citations expose only supported on-demand previews", () => {
  const relay = new MacRelay({
    serverUrl: "https://relay.test",
    adapter: {},
    statePath: null,
  });
  const event = relay.registerEventAttachments("thread_reply_files", {
    kind: "message.completed",
    item_id: "answer_files",
    text: [
      "文件已生成：",
      "- [说明](</tmp/private folder/说明.md:12>)",
      "- [报告](/tmp/private/report.pdf#L3)",
      "- [表格](/tmp/private/report.xlsx)",
    ].join("\n"),
  });

  assert.deepEqual(
    event.attachments.map(
      ({ type, name, mime_type, preview_supported, url }) => ({
        type,
        name,
        mime_type,
        preview_supported,
        previewable: Boolean(url),
      }),
    ),
    [
      {
        type: "file",
        name: "说明.md",
        mime_type: "text/markdown",
        preview_supported: true,
        previewable: true,
      },
      {
        type: "file",
        name: "report.pdf",
        mime_type: "application/pdf",
        preview_supported: true,
        previewable: true,
      },
      {
        type: "file",
        name: "report.xlsx",
        mime_type:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        preview_supported: false,
        previewable: false,
      },
    ],
  );
  assert.equal(relay.attachments.size, 2);
  assert.doesNotMatch(JSON.stringify(event.attachments), /relay_source/);

  const history = relay.registerHistoryAttachments("thread_reply_files", [
    {
      id: "history_answer",
      role: "codex",
      content: "查看 [纯文本](/tmp/private/readme.txt:4:2)",
    },
  ]);
  assert.equal(history[0].attachments[0].name, "readme.txt");
  assert.equal(history[0].attachments[0].preview_supported, true);
  assert.match(history[0].attachments[0].url, /\/attachments\/reply_file_/);
});

test("[relay] Codex file-citation directives become readable links and preview cards", async () => {
  const filePath = "/tmp/private folder/vibe-coding.pdf";
  const rawCitation =
    'PDF: `:codex-file-citation{path="/tmp/private folder/vibe-coding.pdf" purpose="output"}`';
  const adapter = new CodexAppServerAdapter({ workspace: "/workspace" });
  const liveEvents = [];
  adapter.handlers = {
    emitEvent: async (sessionId, event) =>
      liveEvents.push({ sessionId, event }),
  };

  await adapter.handleItem(
    "thread_citation",
    "turn_citation",
    { id: "answer_citation", type: "agentMessage", text: rawCitation },
    true,
  );

  adapter.request = async (method, params) => {
    if (method === "thread/read") {
      return {
        thread: {
          id: "thread_citation",
          cwd: "/workspace",
          status: { type: "idle" },
          turns: [
            {
              id: "turn_citation",
              status: "completed",
              startedAt: "2026-09-02T15:04:00.000Z",
              completedAt: "2026-09-02T15:04:10.000Z",
              items: [
                {
                  id: "answer_citation",
                  type: "agentMessage",
                  text: rawCitation,
                },
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
  const historyPage = await adapter.readHistory({
    sessionId: "thread_citation",
  });

  const expectedText = `PDF: [vibe-coding.pdf](<${filePath}>)`;
  assert.equal(liveEvents[0].event.text, expectedText);
  assert.equal(historyPage.messages[0].content, expectedText);
  assert.doesNotMatch(liveEvents[0].event.text, /codex-file-citation/);

  const relay = new MacRelay({
    serverUrl: "https://relay.test",
    adapter: {},
    statePath: null,
  });
  const event = relay.registerEventAttachments(
    "thread_citation",
    liveEvents[0].event,
  );
  assert.deepEqual(
    event.attachments.map(
      ({ name, mime_type, preview_supported, url }) => ({
        name,
        mime_type,
        preview_supported,
        previewable: Boolean(url),
      }),
    ),
    [
      {
        name: "vibe-coding.pdf",
        mime_type: "application/pdf",
        preview_supported: true,
        previewable: true,
      },
    ],
  );
  assert.deepEqual(relay.attachments.values().next().value.source, {
    type: "local_path",
    path: filePath,
  });
});

test("[relay] mobile-safe text, code, data, config, and SVG files become previews", () => {
  const relay = new MacRelay({
    serverUrl: "https://relay.test",
    adapter: {},
    statePath: null,
  });
  const event = relay.registerEventAttachments("thread_mobile_files", {
    kind: "message.completed",
    item_id: "answer_mobile_files",
    text: [
      "[JSON](/tmp/result.json)",
      "[CSV](/tmp/result.csv)",
      "[YAML](/tmp/config.yaml)",
      "[Dart](/tmp/main.dart)",
      "[SVG](/tmp/diagram.svg)",
      "[Makefile](/tmp/Makefile)",
      "[Office](/tmp/report.docx)",
    ].join(" "),
  });

  assert.deepEqual(
    event.attachments.map(
      ({ name, type, mime_type, preview_supported, url }) => ({
        name,
        type,
        mime_type,
        preview_supported,
        previewable: Boolean(url),
      }),
    ),
    [
      {
        name: "result.json",
        type: "file",
        mime_type: "application/json",
        preview_supported: true,
        previewable: true,
      },
      {
        name: "result.csv",
        type: "file",
        mime_type: "text/csv",
        preview_supported: true,
        previewable: true,
      },
      {
        name: "config.yaml",
        type: "file",
        mime_type: "application/yaml",
        preview_supported: true,
        previewable: true,
      },
      {
        name: "main.dart",
        type: "file",
        mime_type: "text/plain",
        preview_supported: true,
        previewable: true,
      },
      {
        name: "diagram.svg",
        type: "file",
        mime_type: "image/svg+xml",
        preview_supported: true,
        previewable: true,
      },
      {
        name: "Makefile",
        type: "file",
        mime_type: "text/plain",
        preview_supported: true,
        previewable: true,
      },
      {
        name: "report.docx",
        type: "file",
        mime_type:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        preview_supported: false,
        previewable: false,
      },
    ],
  );
  assert.equal(relay.attachments.size, 6);
});

test("[relay] UTF-8 structured files read on demand while unsafe SVG is rejected", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-mobile-preview-"));
  try {
    const jsonPath = join(temporary, "result.json");
    const svgPath = join(temporary, "diagram.svg");
    const unsafeSvgPath = join(temporary, "unsafe.svg");
    const unsafeAnimatedSvgPath = join(temporary, "unsafe-animated.svg");
    await writeFile(jsonPath, '{"status":"ok"}\n');
    await writeFile(
      svgPath,
      '<svg xmlns="http://www.w3.org/2000/svg"><style>.rotor{animation:spin 2.8s infinite}@keyframes spin{to{transform:rotate(360deg)}}</style><g class="rotor"><path d="M0 0h8v8z"/></g></svg>',
    );
    await writeFile(
      unsafeSvgPath,
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    await writeFile(
      unsafeAnimatedSvgPath,
      '<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="href" values="#local;https://example.com/pixel"/></svg>',
    );
    const relay = new MacRelay({
      serverUrl: "https://relay.test",
      adapter: {},
      statePath: null,
    });
    const responses = [];
    relay.send = (message) => {
      responses.push(message);
      return true;
    };
    const event = relay.registerEventAttachments("thread_structured_files", {
      kind: "message.completed",
      item_id: "answer_structured_files",
      text: `[json](<${jsonPath}>) [svg](<${svgPath}>) [unsafe](<${unsafeSvgPath}>) [unsafe animated](<${unsafeAnimatedSvgPath}>)`,
    });
    for (const attachment of event.attachments) {
      await relay.readAttachment({
        type: "session.read_attachment",
        device_id: "dev_local_mac",
        request_id: `read_${attachment.id}`,
        session_id: "thread_structured_files",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        payload: { attachment_id: attachment.id },
      });
    }

    const json = responses.find(
      (response) =>
        response.type === "session.attachment" &&
        response.request_id === `read_${event.attachments[0].id}`,
    );
    assert.equal(json.type, "session.attachment");
    assert.equal(json.mime_type, "application/json");
    assert.equal(Buffer.from(json.base64, "base64").toString("utf8"), '{"status":"ok"}\n');

    const svg = responses.find(
      (response) =>
        response.type === "session.attachment" &&
        response.request_id === `read_${event.attachments[1].id}`,
    );
    assert.equal(svg.type, "session.attachment");
    assert.equal(svg.mime_type, "image/svg+xml");

    const unsafe = responses.find(
      (response) =>
        response.type === "session.attachment_error" &&
        response.request_id === `read_${event.attachments[2].id}`,
    );
    assert.equal(unsafe.type, "session.attachment_error");
    assert.equal(unsafe.error_code, "attachment_unsupported");

    const unsafeAnimated = responses.find(
      (response) =>
        response.type === "session.attachment_error" &&
        response.request_id === `read_${event.attachments[3].id}`,
    );
    assert.equal(unsafeAnimated.type, "session.attachment_error");
    assert.equal(unsafeAnimated.error_code, "attachment_unsupported");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("[relay] referenced text files are read on demand and capped at 1 MB", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-file-preview-"));
  try {
    const notesPath = join(temporary, "notes.md");
    const largePath = join(temporary, "large.txt");
    await writeFile(notesPath, "# Private notes\n\nEncrypted on demand.\n");
    await writeFile(largePath, Buffer.alloc(1024 * 1024 + 1, 65));
    const relay = new MacRelay({
      serverUrl: "https://relay.test",
      adapter: {},
      statePath: null,
    });
    const responses = [];
    relay.send = (message) => {
      responses.push(message);
      return true;
    };
    const event = relay.registerEventAttachments("thread_read_files", {
      kind: "message.completed",
      item_id: "answer_read_files",
      text: `[notes](<${notesPath}>) [large](<${largePath}>)`,
    });
    const [notes, large] = event.attachments;
    const command = (attachment) => ({
      type: "session.read_attachment",
      device_id: "dev_local_mac",
      request_id: `read_${attachment.id}`,
      session_id: "thread_read_files",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      payload: { attachment_id: attachment.id },
    });

    await relay.readAttachment(command(notes));
    const content = responses.find(
      (response) =>
        response.type === "session.attachment" &&
        response.attachment_id === notes.id,
    );
    assert.equal(content.mime_type, "text/markdown");
    assert.equal(
      Buffer.from(content.base64, "base64").toString("utf8"),
      "# Private notes\n\nEncrypted on demand.\n",
    );

    await relay.readAttachment(command(large));
    const error = responses.find(
      (response) =>
        response.type === "session.attachment_error" &&
        response.request_id === `read_${large.id}`,
    );
    assert.equal(error.error_code, "attachment_too_large");
    assert.match(error.error, /1 MB/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("[web] supported reply files open an in-app Markdown, text, or PDF preview", async () => {
  const [page, markdown, styles] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/message-markdown.tsx", "utf8"),
    readFile("app/workbench.css", "utf8"),
  ]);
  assert.match(page, /function FileAttachment\(/);
  assert.match(page, /attachment\.mime_type === "application\/pdf"/);
  assert.match(page, /<MessageMarkdown locale=\{locale\}>\{textContent\}/);
  assert.match(page, /className="file-preview-text technical-ltr" dir="ltr"/);
  assert.match(page, /role="dialog"/);
  assert.match(page, /error\.code === "attachment_too_large"/);
  assert.match(page, /referencedAttachments=\{message\.attachments\}/);
  assert.match(markdown, /function localFileName\(/);
  assert.match(markdown, /href=\{`#\$\{targetId\}`\}/);
  assert.doesNotMatch(
    markdown,
    /name\)[\s\S]{0,500}<a \{\.\.\.props\} href=\{href\} target="_blank"/,
  );
  assert.match(styles, /\.file-preview-dialog/);
  assert.match(styles, /@media \(max-width: 640px\)/);
});

test("[MOB-ATT-004][server] large encrypted commands use private blobs and are deleted after relay ACK", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-command-blob-"));
  try {
    const bundle = join(temporary, "relay-api.mjs");
    await build({
      entryPoints: ["server/relay-api.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: bundle,
      logLevel: "silent",
    });
    const { handleRelayApi } = await import(
      `${pathToFileURL(bundle).href}?${Date.now()}`
    );
    const key = generateE2eeKey();
    const database = new CommandDatabase(await keyIdForKey(key));
    const blobs = new MemoryBlobs();
    const environment = { DB: database, RELAY_BLOBS: blobs };
    const now = new Date();
    const expires = new Date(now.getTime() + 60_000);
    const aad = {
      direction: "web_to_relay",
      type: "session.submit_message",
      device_id: DEVICE_ID,
      session_id: SESSION_ID,
      request_id: REQUEST_ID,
      event_seq: null,
      created_at: now.toISOString(),
      expires_at: expires.toISOString(),
    };
    const command = {
      type: "session.submit_message",
      request_id: REQUEST_ID,
      device_id: DEVICE_ID,
      session_id: SESSION_ID,
      payload: {
        content: "ATTACHMENT_BLOB_CANARY",
        attachments: [{ base64: "A".repeat(300_000) }],
      },
      issued_at: now.toISOString(),
      expires_at: expires.toISOString(),
    };
    const envelope = await sealJson(key, command, aad);
    const queued = await handleRelayApi(
      new Request("https://relay.test/api/commands", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": REQUEST_ID,
          "oai-authenticated-user-email": EMAIL,
          "x-relay-browser-token": BROWSER_TOKEN,
        },
        body: JSON.stringify({
          device_id: DEVICE_ID,
          session_id: SESSION_ID,
          request_id: REQUEST_ID,
          command_type: "session.submit_message",
          created_at: now.toISOString(),
          expires_at: expires.toISOString(),
          aad,
          envelope,
        }),
      }),
      environment,
    );
    assert.equal(queued.status, 202);
    assert.equal(database.command.envelope, null);
    assert.match(database.command.blob_key, /^commands\//);
    assert.equal(blobs.values.size, 1);
    assert.doesNotMatch([...blobs.values.values()][0], /ATTACHMENT_BLOB_CANARY/);

    const polled = await handleRelayApi(
      new Request(
        `https://relay.test/api/relay/commands?device_id=${DEVICE_ID}`,
        { headers: { Authorization: `Bearer ${DEVICE_TOKEN}` } },
      ),
      environment,
    );
    assert.equal(polled.status, 200);
    const frame = (await polled.json()).commands[0];
    assert.deepEqual(await openJson(key, frame.envelope, frame.aad), command);

    const acknowledged = await handleRelayApi(
      new Request("https://relay.test/api/relay/push", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${DEVICE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          device_id: DEVICE_ID,
          messages: [
            { kind: "command_ack", device_id: DEVICE_ID, request_id: REQUEST_ID, status: "accepted" },
          ],
        }),
      }),
      environment,
    );
    assert.equal(acknowledged.status, 200);
    assert.equal(blobs.values.size, 0);
    assert.equal(database.command.blob_key, null);
    assert.equal(database.command.envelope, null);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("[RELAY-RETRY-001][server] exact event replays are idempotent while conflicting sequence reuse is rejected", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-event-replay-"));
  try {
    const bundle = join(temporary, "relay-api.mjs");
    await build({
      entryPoints: ["server/relay-api.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: bundle,
      logLevel: "silent",
    });
    const { handleRelayApi } = await import(
      `${pathToFileURL(bundle).href}?${Date.now()}`
    );
    const key = generateE2eeKey();
    const database = new CommandDatabase(await keyIdForKey(key));
    const environment = { DB: database, RELAY_BLOBS: new MemoryBlobs() };
    const createdAt = new Date().toISOString();
    const aad = {
      direction: "relay_to_web",
      type: "session.event",
      device_id: DEVICE_ID,
      session_id: SESSION_ID,
      request_id: null,
      event_seq: 1,
      created_at: createdAt,
      expires_at: null,
    };
    const event = {
      kind: "event",
      event_id: "evt_idempotent_replay",
      event_seq: 1,
      device_id: DEVICE_ID,
      browser_id: BROWSER_ID,
      session_id: SESSION_ID,
      agent_id: null,
      request_id: null,
      created_at: createdAt,
      aad,
      envelope: await sealJson(
        key,
        { type: "session.event", event: { kind: "turn.completed" } },
        aad,
      ),
    };

    const replayed = await handleRelayApi(
      new Request("https://relay.test/api/relay/push", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${DEVICE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          device_id: DEVICE_ID,
          messages: [event, structuredClone(event)],
        }),
      }),
      environment,
    );
    assert.equal(replayed.status, 200);
    assert.equal(database.events.length, 1);
    assert.equal((await replayed.json()).ack_seq, 1);

    const retried = await handleRelayApi(
      new Request("https://relay.test/api/relay/push", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${DEVICE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ device_id: DEVICE_ID, messages: [event] }),
      }),
      environment,
    );
    assert.equal(retried.status, 200);
    assert.equal(database.events.length, 1);

    const conflicted = await handleRelayApi(
      new Request("https://relay.test/api/relay/push", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${DEVICE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          device_id: DEVICE_ID,
          messages: [{ ...structuredClone(event), event_id: "evt_conflict" }],
        }),
      }),
      environment,
    );
    assert.equal(conflicted.status, 409);
    assert.equal((await conflicted.json()).error.code, "event_seq_conflict");
    assert.equal(database.events.length, 1);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

class MemoryBlobs {
  values = new Map();

  async get(key) {
    const value = this.values.get(key);
    return value === undefined ? null : { text: async () => value };
  }

  async put(key, value) {
    this.values.set(key, value);
  }

  async delete(key) {
    this.values.delete(key);
  }
}

class CommandDatabase {
  constructor(keyId) {
    this.keyId = keyId;
    this.command = null;
    this.events = [];
    this.device = {
      id: DEVICE_ID,
      user_id: USER_ID,
      name: "Test Mac",
      identity_public_key: "{}",
      encrypted_descriptor: null,
      key_epoch: 1,
      protocol_version: 2,
      ack_seq: 0,
      created_at: Date.now(),
      last_seen_at: Date.now(),
      relay_token_hash: createHash("sha256").update(DEVICE_TOKEN).digest("hex"),
    };
  }

  batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }

  prepare(query) {
    const values = [];
    const normalized = query.replace(/\s+/g, " ").trim().toLowerCase();
    const statement = {
      bind: (...next) => {
        values.push(...next);
        return statement;
      },
      run: async () => this.run(normalized, values),
      first: async () => this.first(normalized, values),
      all: async () => ({
        results: await this.all(normalized, values),
        success: true,
      }),
    };
    return statement;
  }

  async run(query, values) {
    if (query.startsWith("insert into relay_users")) return changed(1);
    if (query.startsWith("update relay_browser_authorizations")) return changed(1);
    if (query.startsWith("update relay_devices")) return changed(1);
    if (query.startsWith("insert into relay_events")) {
      const [deviceId, browserId, sessionId, agentId, requestId, eventId, eventSeq, type, direction, aad, envelope, createdAt, receivedAt] = values;
      const duplicate = this.events.some(
        (event) =>
          event.device_id === deviceId &&
          event.browser_id === browserId &&
          event.event_seq === eventSeq,
      );
      if (duplicate) return changed(0);
      this.events.push({
        device_id: deviceId,
        browser_id: browserId,
        session_id: sessionId,
        agent_id: agentId,
        request_id: requestId,
        event_id: eventId,
        event_seq: eventSeq,
        type,
        direction,
        aad,
        envelope,
        created_at: createdAt,
        received_at: receivedAt,
      });
      return changed(1);
    }
    if (query.startsWith("insert into relay_commands")) {
      if (this.command) return changed(0);
      const [id, userId, deviceId, browserId, sessionId, type, direction, aad, envelope, blobKey, idempotencyKey, expiresAt, createdAt] = values;
      this.command = {
        id,
        user_id: userId,
        device_id: deviceId,
        browser_id: browserId,
        session_id: sessionId,
        type,
        direction,
        aad,
        envelope,
        blob_key: blobKey,
        idempotency_key: idempotencyKey,
        status: "queued",
        lease_id: null,
        leased_until: null,
        expires_at: expiresAt,
        created_at: createdAt,
      };
      return changed(1);
    }
    if (query.startsWith("update relay_commands set status = 'expired'")) {
      return changed(0);
    }
    if (query.startsWith("update relay_commands set status = 'leased'")) {
      this.command.status = "leased";
      this.command.lease_id = values[0];
      this.command.leased_until = values[1];
      return changed(1);
    }
    if (query.startsWith("update relay_commands set status = ?, acknowledged_at = ?")) {
      this.command.status = values[0];
      this.command.envelope = null;
      this.command.blob_key = null;
      this.command.lease_id = null;
      return changed(1);
    }
    throw new Error(`Unexpected run query: ${query}`);
  }

  async first(query, values) {
    if (query.startsWith("select id, email from relay_users")) {
      return { id: USER_ID, email: EMAIL };
    }
    if (query.includes("from relay_devices where id = ? and user_id = ?")) {
      return this.device;
    }
    if (query.includes("from relay_devices where relay_token_hash = ?")) {
      return this.device;
    }
    if (query.includes("from relay_browser_authorizations where token_hash = ?")) {
      return {
        id: BROWSER_ID,
        device_id: DEVICE_ID,
        user_id: USER_ID,
        name: "Test browser",
        key_id: this.keyId,
        created_at: Date.now(),
        last_seen_at: Date.now(),
      };
    }
    if (
      query.startsWith(
        "select session_id, agent_id, request_id, event_id, aad, envelope, created_at from relay_events",
      )
    ) {
      const [deviceId, browserId, eventSeq] = values;
      return (
        this.events.find(
          (event) =>
            event.device_id === deviceId &&
            event.browser_id === browserId &&
            event.event_seq === eventSeq,
        ) ?? null
      );
    }
    if (query.startsWith("select id, device_id, browser_id")) return this.command;
    if (query.startsWith("select blob_key from relay_commands")) {
      return { blob_key: this.command?.blob_key ?? null };
    }
    throw new Error(`Unexpected first query: ${query}`);
  }

  async all(query, values) {
    if (query.startsWith("select blob_key from relay_commands")) return [];
    if (query.startsWith("select id from relay_commands")) {
      return this.command?.status === "queued" ? [{ id: this.command.id }] : [];
    }
    if (query.startsWith("select id, browser_id, session_id")) {
      return this.command?.lease_id ? [this.command] : [];
    }
    if (query.includes("from relay_browser_authorizations")) {
      return [{ id: BROWSER_ID, key_id: this.keyId }];
    }
    if (query.startsWith("select event_seq from relay_events")) {
      const ack = Number(values[1] ?? 0);
      return this.events
        .filter((event) => event.event_seq > ack)
        .sort((left, right) => left.event_seq - right.event_seq)
        .map((event) => ({ event_seq: event.event_seq }));
    }
    throw new Error(`Unexpected all query: ${query}`);
  }
}

function changed(changes) {
  return { success: true, meta: { changes } };
}

test('existing server routes WebRTC negotiation as opaque commands without a schema change', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'relayune-webrtc-signal-'));
  try {
    const bundle = join(temporary, 'api.mjs');
    await build({ entryPoints: ['server/relay-api.ts'], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
    const { handleRelayApi } = await import(pathToFileURL(bundle).href);
    const key = generateE2eeKey();
    const database = new CommandDatabase(await keyIdForKey(key));
    const env = { DB: database, RELAY_BLOBS: new MemoryBlobs() };
    const created = new Date().toISOString();
    const expires = new Date(Date.now() + 60000).toISOString();
    const aad = { direction: 'web_to_relay', type: 'transport.offer', device_id: DEVICE_ID,
      session_id: null, request_id: REQUEST_ID, event_seq: null, created_at: created, expires_at: expires };
    const command = { type: aad.type, device_id: DEVICE_ID, session_id: null, request_id: REQUEST_ID,
      issued_at: created, expires_at: expires, payload: { sdp: 'PRIVATE_RTC_SDP_CANARY' } };
    const envelope = await sealJson(key, command, aad);
    const queued = await handleRelayApi(new Request('https://relay.test/api/commands', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': REQUEST_ID,
        'oai-authenticated-user-email': EMAIL, 'x-relay-browser-token': BROWSER_TOKEN },
      body: JSON.stringify({ device_id: DEVICE_ID, session_id: null, request_id: REQUEST_ID,
        command_type: aad.type, created_at: created, expires_at: expires, aad, envelope }),
    }), env);
    assert.equal(queued.status, 202);
    assert.ok(!JSON.stringify(database.command).includes('PRIVATE_RTC_SDP_CANARY'));
    const polled = await handleRelayApi(new Request(`https://relay.test/api/relay/commands?device_id=${DEVICE_ID}`,
      { headers: { Authorization: `Bearer ${DEVICE_TOKEN}` } }), env);
    assert.equal(polled.status, 200);
    const frame = (await polled.json()).commands[0];
    assert.equal((await openJson(key, frame.envelope, frame.aad)).payload.sdp, 'PRIVATE_RTC_SDP_CANARY');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

// Exercise the actual enqueue -> durable lease -> encrypted delivery path.
// The fixture's persistence adapter is in memory; this is not a WAN benchmark.
test('command long poll wakes on persisted enqueue, handles races, and rechecks authorization', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'relayune-command-wait-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const bundle = join(temporary, 'api.mjs');
  await build({ stdin: { contents: 'export {handleRelayApi} from "./server/relay-api.ts"; export {CommandWaitHub} from "./server/command-wait.ts";', resolveDir: process.cwd() },
    bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
  const { handleRelayApi, CommandWaitHub } = await import(pathToFileURL(bundle).href);
  const key = generateE2eeKey();
  const database = new CommandDatabase(await keyIdForKey(key));
  const hub = new CommandWaitHub();
  t.after(() => hub.close());
  const env = { DB: database, RELAY_BLOBS: new MemoryBlobs(), COMMAND_WAIT: hub };
  const poll = (wait = 1000, signal) => handleRelayApi(new Request(
    `https://relay.test/api/relay/commands?device_id=${DEVICE_ID}&wait_ms=${wait}`,
    { headers: { Authorization: `Bearer ${DEVICE_TOKEN}` }, signal }), env);
  const now = new Date();
  const aad = { direction: 'web_to_relay', type: 'project.sessions', device_id: DEVICE_ID,
    session_id: null, request_id: REQUEST_ID, event_seq: null, created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 60_000).toISOString() };
  const payload = { type: 'project.sessions', request_id: REQUEST_ID, payload: { directory_sync: true } };
  const envelope = await sealJson(key, payload, aad);
  const enqueue = () => handleRelayApi(new Request('https://relay.test/api/commands', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': REQUEST_ID, 'oai-authenticated-user-email': EMAIL,
      'x-relay-browser-token': BROWSER_TOKEN }, body: JSON.stringify({
      device_id: DEVICE_ID, session_id: null, request_id: REQUEST_ID, command_type: aad.type,
      created_at: aad.created_at, expires_at: aad.expires_at, aad, envelope }),
  }), env);
  const originalAll = database.all.bind(database);
  let firstRead;
  let onRead;
  const watchRead = () => { firstRead = new Promise(resolve => { onRead = resolve; }); };
  database.all = async (query, values) => {
    const result = await originalAll(query, values);
    if (query.startsWith('select id from relay_commands')) onRead?.();
    return result;
  };

  await t.test('idle request stays open and wakes immediately on enqueue', async () => {
    watchRead();
    let completed = false;
    const pending = poll().then(result => { completed = true; return result; });
    await firstRead;
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(completed, false);
    const start = performance.now();
    assert.equal((await enqueue()).status, 202);
    const result = await pending;
    const elapsed = performance.now() - start;
    assert.equal(result.status, 200);
    const [frame] = (await result.json()).commands;
    assert.deepEqual(await openJson(key, frame.envelope, frame.aad), payload);
    assert.ok(elapsed < 500, `enqueue to response took ${elapsed}ms`);
    t.diagnostic(`Synthetic local enqueue-to-response: ${elapsed.toFixed(2)}ms (no WAN/Mongo latency)`);
  });

  await t.test('enqueue during the first empty query cannot lose a wake-up', async () => {
    database.command = null;
    let injected = false;
    database.all = async (query, values) => {
      const result = await originalAll(query, values);
      if (query.startsWith('select id from relay_commands') && !injected) {
        injected = true;
        assert.equal((await enqueue()).status, 202);
      }
      return result;
    };
    assert.equal((await (await poll()).json()).commands.length, 1);
    database.all = originalAll;
  });

  await t.test('queued commands return without waiting and are not leased twice', async () => {
    database.command = null;
    await enqueue();
    assert.equal((await (await poll()).json()).commands.length, 1);
    // Fixture must respect the lease id used by the production query.
    const all = database.all;
    database.all = async (query, values) => query.startsWith('select id, browser_id, session_id')
      ? database.command?.lease_id === values[1] ? [database.command] : [] : all(query, values);
    assert.equal((await (await poll(10)).json()).commands.length, 0);
    database.all = originalAll;
  });

  await t.test('device revocation while waiting prevents delivery', async () => {
    database.command = null;
    watchRead();
    database.all = async (query, values) => {
      const result = await originalAll(query, values);
      if (query.startsWith('select id from relay_commands')) onRead?.();
      return result;
    };
    const pending = poll();
    await firstRead;
    const first = database.first.bind(database);
    database.first = async (query, values) => query.includes('from relay_devices where relay_token_hash = ?') ? null : first(query, values);
    hub.notify(DEVICE_ID);
    assert.equal((await pending).status, 401);
    database.first = first;
  });

  await t.test('disconnect and server shutdown release idle requests', async () => {
    watchRead();
    const abort = new AbortController();
    const pending = poll(1000, abort.signal);
    await firstRead;
    abort.abort();
    assert.equal((await (await pending).json()).commands.length, 0);
    watchRead();
    const closing = poll();
    await firstRead;
    hub.close();
    assert.equal((await closing).status, 200);
  });

  await t.test('wake-ups are device-scoped and one waiter per device is bounded', async () => {
    const isolated = new CommandWaitHub();
    const a = isolated.subscribe('a', 1000);
    const b = isolated.subscribe('b', 1000);
    const replacement = isolated.subscribe('a', 1000);
    assert.equal(await a.promise, 'cancelled');
    isolated.notify('a');
    assert.equal(await replacement.promise, 'command');
    isolated.close();
    assert.equal(await b.promise, 'cancelled');
  });
});

test('encrypted response wait returns uploaded payload and preserves authorization isolation', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'relayune-response-wait-'));
  t.after(() => rm(temporary, {recursive: true, force: true}));
  const bundle = join(temporary, 'api.mjs');
  await build({stdin: {contents: 'export {handleRelayApi} from "./server/relay-api.ts"; export {ResponseWaitHub} from "./server/response-wait.ts";', resolveDir: process.cwd()},
    bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent'});
  const {handleRelayApi, ResponseWaitHub} = await import(pathToFileURL(bundle).href);
  const key = generateE2eeKey();
  const database = new CommandDatabase(await keyIdForKey(key));
  const hub = new ResponseWaitHub();
  t.after(() => hub.close());
  const env = {DB: database, RELAY_BLOBS: new MemoryBlobs(), RESPONSE_WAIT: hub};
  let row = null, revoked = false, onRead;
  const originalFirst = database.first.bind(database);
  database.first = async (query, values) => {
    if (query.includes('from relay_responses')) { const snapshot = row; await onRead?.(); return snapshot; }
    if (query.includes('from relay_browser_authorizations') && revoked) return null;
    return originalFirst(query, values);
  };
  const originalRun = database.run.bind(database);
  database.run = async (query, values) => {
    if (query.startsWith('insert into relay_responses')) {
      const [request_id, user_id, device_id, browser_id, session_id, aad, envelope, blob_key, created_at] = values;
      row = {request_id, user_id, device_id, browser_id, session_id, aad, envelope, blob_key, created_at};
      return changed(1);
    }
    return originalRun(query, values);
  };
  const responseAad = {direction: 'relay_to_web', type: 'project.result', device_id: DEVICE_ID,
    session_id: null, request_id: REQUEST_ID, event_seq: null, created_at: new Date().toISOString(), expires_at: null};
  const value = {type: 'project.result', request_id: REQUEST_ID, directory: {sessions: []}};
  const envelope = await sealJson(key, value, responseAad);
  const upload = () => handleRelayApi(new Request('https://relay.test/api/relay/push', {
    method: 'POST', headers: {Authorization: `Bearer ${DEVICE_TOKEN}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({device_id: DEVICE_ID, messages: [{kind: 'response', browser_id: BROWSER_ID,
      device_id: DEVICE_ID, session_id: null, request_id: REQUEST_ID, aad: responseAad, envelope}]}),
  }), env);
  const read = (wait = 1000, token = BROWSER_TOKEN, signal) => handleRelayApi(new Request(
    `https://relay.test/api/responses/${REQUEST_ID}?device_id=${DEVICE_ID}&wait_ms=${wait}`, {
      headers: {'oai-authenticated-user-email': EMAIL, 'x-relay-browser-token': token}, signal,
    }), env);
  const watchRead = () => new Promise(resolve => { onRead = resolve; });

  await t.test('upload wakes the existing GET with ciphertext, without an invalidate signal', async () => {
    const observed = watchRead();
    let complete = false;
    const pending = read().then(value => { complete = true; return value; });
    await observed;
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(complete, false);
    assert.equal((await upload()).status, 200);
    const response = await pending;
    assert.equal(response.status, 200);
    const frame = await response.json();
    assert.deepEqual(await openJson(key, frame.envelope, frame.aad), value);
    assert.equal((await read()).status, 200, 'already-stored response must return immediately');
  });
  await t.test('upload during the first query cannot lose a wake-up', async () => {
    row = null;
    onRead = async () => { onRead = null; assert.equal((await upload()).status, 200); };
    assert.equal((await read()).status, 200);
  });
  await t.test('missing authorization cannot allocate an idle wait', async () => {
    row = null;
    assert.equal((await read(1000, '')).status, 401);
  });
  await t.test('revocation during an outstanding GET rejects the response', async () => {
    row = null;
    const observed = watchRead();
    const pending = read();
    await observed;
    revoked = true;
    await upload();
    assert.equal((await pending).status, 401);
    revoked = false;
  });
  await t.test('response from another authorization is never returned', async () => {
    onRead = null;
    row.browser_id = 'another-browser';
    const response = await read(5);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'response_wait_timeout');
  });
  await t.test('disconnect cancels the waiting request', async () => {
    row = null;
    const observed = watchRead();
    const abort = new AbortController();
    const pending = read(1000, BROWSER_TOKEN, abort.signal);
    await observed;
    abort.abort();
    assert.equal((await pending).status, 404);
  });
  await t.test('waiters are bounded and scoped to both authorization and request', async () => {
    const waits = Array.from({length: 8}, (_, i) => hub.subscribe('one', `r${i}`, 1000));
    assert.equal(hub.subscribe('one', 'overflow', 1000), null);
    const other = hub.subscribe('other', 'r0', 1000);
    hub.notify('one', 'r0');
    assert.equal(await waits[0].promise, 'response');
    const replacement = hub.subscribe('one', 'replacement', 1000);
    assert.ok(replacement);
    hub.close();
    assert.equal(await other.promise, 'cancelled');
    for (const wait of waits.slice(1)) assert.equal(await wait.promise, 'cancelled');
    assert.equal(await replacement.promise, 'cancelled');
  });
});

test('strict transport windows reject replays and forged timestamps before storage or ACK scans', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'relayune-retention-api-'));
  t.after(() => rm(temporary, {recursive: true, force: true}));
  const bundle = join(temporary, 'api.mjs');
  await build({entryPoints: ['server/relay-api.ts'], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent'});
  const {handleRelayApi} = await import(pathToFileURL(bundle).href);
  const now = Date.now();
  t.mock.timers.enable({apis: ['Date'], now});
  const key = generateE2eeKey(), database = new CommandDatabase(await keyIdForKey(key)), blobs = new MemoryBlobs();
  const env = {DB: database, RELAY_BLOBS: blobs};
  let ackScans = 0;
  const all = database.all.bind(database);
  database.all = (query, values) => { if (query.startsWith('select event_seq')) ackScans++; return all(query, values); };
  const event = async (age, seq) => {
    const created = new Date(now - age).toISOString();
    const aad = {direction: 'relay_to_web', type: 'session.event', device_id: DEVICE_ID, session_id: SESSION_ID,
      request_id: null, event_seq: seq, created_at: created, expires_at: null};
    return {kind: 'event', device_id: DEVICE_ID, browser_id: BROWSER_ID, session_id: SESSION_ID,
      event_id: `evt_window_${seq}`, event_seq: seq, created_at: created, aad,
      envelope: await sealJson(key, {type: 'session.event'}, aad)};
  };
  const push = messages => handleRelayApi(new Request('https://relay.test/api/relay/push', {
    method: 'POST', headers: {Authorization: `Bearer ${DEVICE_TOKEN}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({device_id: DEVICE_ID, messages}),
  }), env);
  const stale = await event(600_000, 1), fresh = await event(599_999, 2);
  const responseAad = {...stale.aad, type: 'session.history', event_seq: null, request_id: REQUEST_ID, created_at: new Date(now - 300_000).toISOString()};
  const response = {kind: 'response', device_id: DEVICE_ID, browser_id: BROWSER_ID, session_id: SESSION_ID,
    request_id: REQUEST_ID, aad: responseAad, envelope: await sealJson(key, {text: 'x'.repeat(300_000)}, responseAad)};
  const discarded = await push([stale, response, {kind: 'heartbeat', device_id: DEVICE_ID}]);
  assert.equal(discarded.status, 200);
  const result = await discarded.json();
  assert.equal(result.expired_events, 1); assert.equal(result.expired_responses, 1);
  assert.equal(database.events.length, 0); assert.equal(blobs.values.size, 0); assert.equal(ackScans, 0);
  assert.equal((await push([fresh])).status, 200);
  assert.equal(database.events.length, 1); assert.equal(ackScans, 1);
  t.mock.timers.tick(1);
  database.events = []; // Mongo TTL has removed the old row.
  assert.equal((await (await push([fresh])).json()).expired_events, 1);
  assert.equal(database.events.length, 0, 'a retry cannot restart the retention clock');
  const forgedTime = new Date().toISOString();
  assert.equal((await push([{...stale, created_at: forgedTime}])).status, 400);
  assert.equal((await push([{...stale, created_at: forgedTime, aad: {...stale.aad, created_at: forgedTime}}])).status, 400,
    'external metadata cannot replace the timestamp inside the envelope');
  assert.equal((await push([{...response, aad: {...response.aad, created_at: forgedTime}}])).status, 400);
  database.eventWindow = async (device, browser, cursor) => {
    assert.equal(device, DEVICE_ID); assert.equal(browser, BROWSER_ID); assert.equal(cursor, 42);
    return {reset_cursor: 0};
  };
  const reset = await handleRelayApi(new Request(`https://relay.test/api/events?device_id=${DEVICE_ID}&cursor=42`, {
    headers: {'oai-authenticated-user-email': EMAIL, 'x-relay-browser-token': BROWSER_TOKEN},
  }), env);
  assert.equal(reset.status, 200);
  assert.equal((await reset.json()).resync_required, true);
});
