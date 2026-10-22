import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  appendFile,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AttachmentStore } from "../relay/attachment-store.mjs";
import { CodexAppServerAdapter } from "../relay/codex-adapters.mjs";
import { MacRelay } from "../relay/mac-relay.mjs";
import { MultiAgentAdapter } from "../relay/multi-agent-adapter.mjs";

function storeKey() {
  return randomBytes(32).toString("base64url");
}

test("[relay] existing attachment stores migrate quota reads off encrypted body pages", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "relayune-attachment-budget-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = {
    path: join(directory, "attachments.sqlite3"),
    key: storeKey(),
    deviceId: "dev_budget",
    maxInlineBytes: 16 * 1024 * 1024,
  };
  const attachment = {
    source: { type: "stored_bytes", bytes: Buffer.alloc(8 * 1024 * 1024, 42) },
  };
  const old = new AttachmentStore(options);
  old.put("session", "keep", attachment);
  old.put("session", "oldest", attachment);
  old.setIngestionCheckpoint("fixture-rollout", 123);
  // Simulate the pre-fix schema, preserving its encrypted payloads and key.
  old.database.exec("DROP INDEX attachment_entries_inline_budget");
  old.close();

  const store = new AttachmentStore(options);
  t.after(() => store.close());
  assert.equal(store.getIngestionCheckpoint("fixture-rollout"), 123);
  store.database.exec("UPDATE attachment_entries SET accessed_at_ms = CASE attachment_id WHEN 'oldest' THEN 1 ELSE 2 END");
  const plans = [];
  const prepare = store.database.prepare.bind(store.database);
  store.database.prepare = (sql) => {
    if (/SELECT[\s\S]*byte_size[\s\S]*FROM attachment_entries/.test(sql)) {
      plans.push(prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((row) => row.detail));
    }
    return prepare(sql);
  };
  store.put("session", "local", { source: { type: "local_path", path: join(directory, "fixture.txt") } });
  assert.equal(plans.length, 0, "local paths do not consume inline storage or require a quota scan");
  store.put("session", "newest", attachment);
  assert.equal(plans.length, 2, "exercise both the real quota sum and eviction query");
  for (const plan of plans) {
    assert.ok(plan.some((step) => step.includes("USING COVERING INDEX")), plan.join("; "));
    assert.ok(plan.every((step) => !step.includes("TEMP B-TREE")), plan.join("; "));
  }
  assert.equal(store.get("session", "oldest"), null);
  assert.equal(store.get("session", "local").source.type, "local_path");
  assert.deepEqual(store.get("session", "keep").source.bytes, attachment.source.bytes);
  assert.deepEqual(store.get("session", "newest").source.bytes, attachment.source.bytes);
});

test("[relay] encrypted attachment store survives restart without plaintext payloads", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "relayune-attachments-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "attachments.sqlite3");
  const key = storeKey();
  const image = Buffer.from("89504e470d0a1a0a", "hex");

  const first = new AttachmentStore({
    path,
    key,
    deviceId: "dev_restart",
  });
  first.put("thread_restart", "asset_restart", {
    sessionId: "thread_restart",
    source: {
      type: "data_url",
      url: `data:image/png;base64,${image.toString("base64")}`,
    },
    name: "private-restart.png",
    type: "image",
    mimeType: "image/png",
    detail: "original",
  });
  first.setIngestionCheckpoint("codex-rollout:/private/session.jsonl", 731);
  first.close();

  const databaseBytes = await readFile(path);
  assert.equal(databaseBytes.includes(image), false);
  assert.equal(databaseBytes.includes(Buffer.from("private-restart.png")), false);
  assert.equal(databaseBytes.includes(Buffer.from("/private/session.jsonl")), false);
  assert.equal((await stat(path)).mode & 0o777, 0o600);

  const second = new AttachmentStore({
    path,
    key,
    deviceId: "dev_restart",
  });
  assert.equal(
    second.getIngestionCheckpoint("codex-rollout:/private/session.jsonl"),
    731,
  );
  const restored = second.get("thread_restart", "asset_restart");
  assert.equal(restored.name, "private-restart.png");
  assert.deepEqual(restored.source.bytes, image);
  second.close();
});

test("[relay] attachment IDs cannot be rebound and the wrong key cannot decrypt data", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "relayune-attachment-key-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "attachments.sqlite3");
  const key = storeKey();
  const store = new AttachmentStore({ path, key, deviceId: "dev_key" });
  const attachment = {
    source: {
      type: "data_url",
      url: "data:image/png;base64,iVBORw0KGgo=",
    },
    name: "first.png",
    type: "image",
    mimeType: "image/png",
  };
  store.put("thread_key", "asset_key", attachment);
  assert.doesNotThrow(() => store.put("thread_key", "asset_key", attachment));
  assert.throws(
    () =>
      store.put("thread_key", "asset_key", {
        ...attachment,
        name: "different.png",
      }),
    (error) => error.code === "attachment_id_conflict",
  );
  store.close();

  assert.throws(
    () =>
      new AttachmentStore({
        path,
        key: storeKey(),
        deviceId: "dev_key",
      }),
    (error) => error.code === "attachment_store_key_invalid",
  );
});

test("[relay] conflicting provider replay keeps the original attachment readable without rebinding uploads", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "relayune-attachment-replay-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AttachmentStore({
    path: join(directory, "attachments.sqlite3"), key: storeKey(), deviceId: "dev_replay",
  });
  t.after(() => store.close());
  const relay = new MacRelay({ serverUrl: "https://relay.test", adapter: {}, statePath: null, attachmentStore: store });
  const original = {
    source: { type: "stored_bytes", bytes: Buffer.from("original content") },
    name: "original.txt", type: "file", mimeType: "text/plain", detail: null,
  };
  relay.registerAttachment("thread_replay", "asset_replay", original);
  const replay = {
    id: "asset_replay", name: "changed.txt", type: "file", mime_type: "text/plain", detail: "auto",
    relay_source: { type: "data_url", url: "data:text/plain;base64,Y2hhbmdlZA==" },
  };
  const event = relay.registerEventAttachments("thread_replay", {
    kind: "message.completed", text: "replayed response", attachments: [replay],
  });
  assert.match(event.attachments[0].url, /\/asset_replay$/);
  assert.equal(event.attachments[0].relay_source, undefined);
  assert.equal(relay.attachments.has("asset_replay"), false, "the conflicting replay never enters the memory cache");
  const messages = relay.registerHistoryAttachments("thread_replay", [{ role: "codex", content: "response", attachments: [replay] }]);
  assert.match(messages[0].attachments[0].url, /\/asset_replay$/);
  assert.throws(() => relay.registerAttachment("thread_replay", "asset_replay", {
    ...original, source: { type: "stored_bytes", bytes: Buffer.from("changed") },
  }), error => error.code === "attachment_id_conflict", "new uploads retain strict ID immutability");
  const responses = [];
  relay.validateCommand = () => true;
  relay.acknowledgeCommand = () => {};
  relay.send = message => responses.push(message);
  await relay.readAttachment({
    type: "session.read_attachment", request_id: "read_replay", session_id: "thread_replay",
    payload: { attachment_id: "asset_replay" },
  });
  assert.equal(responses.at(-1).type, "session.attachment");
  assert.equal(Buffer.from(responses.at(-1).base64, "base64").toString(), "original content");
  assert.equal(store.get("thread_replay", "asset_replay").name, "original.txt");
  store.close();
  assert.throws(() => relay.registerEventAttachments("thread_replay", { attachments: [replay] }),
    error => error.code === "attachment_store_closed", "unrelated persistence errors are not treated as ID conflicts");
});

test("[relay] optional attachment recovery failure does not disable Codex and retains its retry checkpoint", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "relayune-recovery-start-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const threads = [];
  for (const id of ["thread_retry", "thread_healthy"]) {
    const path = join(directory, `${id}.jsonl`);
    await writeFile(path, [
      { type: "session_meta", payload: { id } },
      { type: "event_msg", payload: { type: "item_completed", turn_id: `turn_${id}`,
        item: { id: `answer_${id}`, type: "agent_message", phase: "final_answer", text: `[result](<${join(directory, `${id}.md`)}>)` } } },
    ].map(JSON.stringify).join("\n") + "\n");
    threads.push({ id, path, cwd: directory, title: id, status: { type: "notLoaded" }, updatedAt: Math.floor(Date.now() / 1000) });
  }
  const executable = join(directory, "fake-codex.cjs");
  await writeFile(executable, `#!${process.execPath}
const {createInterface} = require('node:readline');
const threads = ${JSON.stringify(threads)};
createInterface({input: process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  const result = m.method === 'thread/list' ? {data:threads,nextCursor:null} : {data:[]};
  process.stdout.write(JSON.stringify({id:m.id,result}) + '\\n');
});
`, { mode: 0o700 });
  const adapter = new CodexAppServerAdapter({ codexBin: executable, workspace: directory, codexSessionsRoot: directory });
  const multi = new MultiAgentAdapter({ adapters: { codex: adapter } });
  t.after(() => multi.close());
  const checkpoints = new Map([[`codex-rollout:${threads[0].path}`, 0]]);
  const recovered = [];
  let unavailable = true;
  await multi.start({
    emitEvent: async () => {}, requestApproval: async () => {},
    registerRecoveredAttachments: id => {
      if (id === "thread_retry" && unavailable) throw new Error("temporary attachment storage failure");
      recovered.push(id);
    },
    readAttachmentCheckpoint: source => checkpoints.get(source) ?? null,
    writeAttachmentCheckpoint: (source, offset) => checkpoints.set(source, offset),
  });
  assert.deepEqual(multi.status().codex, { ready: true, error: null });
  assert.deepEqual(recovered, ["thread_healthy"]);
  assert.equal(checkpoints.get(`codex-rollout:${threads[0].path}`), 0, "failed recovery cannot advance the checkpoint");
  assert.equal(checkpoints.get(`codex-rollout:${threads[1].path}`), (await stat(threads[1].path)).size);
  unavailable = false;
  assert.equal((await multi.listSessions()).length, 2, "normal catalog reads retry recovery and still list both sessions");
  assert.deepEqual(recovered.sort(), ["thread_healthy", "thread_retry"]);
  assert.equal(checkpoints.get(`codex-rollout:${threads[0].path}`), (await stat(threads[0].path)).size);
});

test("[relay] Codex work completed while Relay is closed is recovered incrementally", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "relayune-offline-attachment-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "attachments.sqlite3");
  const rolloutPath = join(directory, "rollout.jsonl");
  const outputPath = join(directory, "offline-result.md");
  const key = storeKey();
  await writeFile(outputPath, "offline result\n", { mode: 0o600 });
  await writeFile(
    rolloutPath,
    [
      {
        timestamp: "2026-09-03T09:59:00.000Z",
        type: "session_meta",
        payload: { id: "thread_offline" },
      },
      {
        timestamp: "2026-09-03T10:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "item_completed",
          turn_id: "turn_offline",
          item: {
            id: "answer_offline",
            type: "agent_message",
            phase: "final_answer",
            text: `结果见 [离线文件](<${outputPath}>)`,
          },
        },
      },
    ]
      .map(JSON.stringify)
      .join("\n") + "\n",
  );

  const firstStore = new AttachmentStore({
    path: databasePath,
    key,
    deviceId: "dev_offline",
  });
  const firstRelay = new MacRelay({
    serverUrl: "https://relay.test",
    adapter: {},
    statePath: null,
    attachmentStore: firstStore,
  });
  const adapter = new CodexAppServerAdapter({
    workspace: directory,
    codexSessionsRoot: directory,
  });
  adapter.handlers = {
    registerRecoveredAttachments: (sessionId, event) =>
      firstRelay.registerEventAttachments(sessionId, event),
    readAttachmentCheckpoint: (source) =>
      firstStore.getIngestionCheckpoint(source),
    writeAttachmentCheckpoint: (source, offset) =>
      firstStore.setIngestionCheckpoint(source, offset),
  };
  await adapter.recoverRecentAttachmentRollouts();
  const attachmentId = firstRelay.attachments.keys().next().value;
  assert.match(attachmentId, /^reply_file_/);
  const secondOutputPath = join(directory, "second-offline-result.md");
  await writeFile(secondOutputPath, "second offline result\n", { mode: 0o600 });
  await appendFile(
    rolloutPath,
    `${JSON.stringify({
      timestamp: "2026-09-03T10:05:00.000Z",
      type: "event_msg",
      payload: {
        type: "item_completed",
        turn_id: "turn_offline_2",
        item: {
          id: "answer_offline_2",
          type: "agent_message",
          phase: "final_answer",
          text: `继续见 [第二个文件](<${secondOutputPath}>)`,
        },
      },
    })}\n`,
  );
  await adapter.recoverRecentAttachmentRollouts();
  assert.equal(firstRelay.attachments.size, 2);
  firstStore.close();

  const secondStore = new AttachmentStore({
    path: databasePath,
    key,
    deviceId: "dev_offline",
  });
  const secondRelay = new MacRelay({
    serverUrl: "https://relay.test",
    adapter: {},
    statePath: null,
    attachmentStore: secondStore,
  });
  const responses = [];
  secondRelay.validateCommand = () => true;
  secondRelay.acknowledgeCommand = () => {};
  secondRelay.send = (message) => responses.push(message);
  await secondRelay.readAttachment({
    type: "session.read_attachment",
    request_id: "read_offline",
    session_id: "thread_offline",
    payload: { attachment_id: attachmentId },
  });

  assert.equal(responses.at(-1).type, "session.attachment");
  assert.equal(
    Buffer.from(responses.at(-1).base64, "base64").toString("utf8"),
    "offline result\n",
  );
  secondStore.close();
});
