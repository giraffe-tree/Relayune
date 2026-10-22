import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { generateE2eeKey, importE2eeKey, keyIdForKey, openJson, sealJson } from "../relay/e2ee.mjs";
import { MacRelay } from "../relay/mac-relay.mjs";
import { MultiAgentAdapter } from "../relay/multi-agent-adapter.mjs";
import { createSessionWorktree } from "../relay/session-worktree.mjs";

const CANARY = "PRIVATE_FORK_CONTENT_c3843d";
const DEVICE = "dev_session_fork_test";
const BROWSER = "web_session_fork_test";
const SOURCE = "source_session";
const NEW = "branched_session";
const execFileAsync = promisify(execFile);
const git = async (cwd, args) => (await execFileAsync("git", ["-C", cwd, ...args], {
  encoding: "utf8", windowsHide: true,
})).stdout.trim();

async function commandFrame(key, command) {
  const aad = { direction: "web_to_relay", type: command.type, device_id: command.device_id,
    session_id: command.session_id, request_id: command.request_id, event_seq: null,
    created_at: command.issued_at, expires_at: command.expires_at };
  return { browser_id: BROWSER, device_id: command.device_id, session_id: command.session_id,
    request_id: command.request_id, command_type: command.type, aad,
    envelope: await sealJson(key, command, aad) };
}

async function fixture(t, { repo = true } = {}) {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-fork-relay-"));
  const root = await realpath(temporary), cwd = join(root, CANARY), managed = join(root, "app-data");
  await mkdir(cwd); await mkdir(managed);
  await writeFile(join(cwd, "source.txt"), "original fixture\n");
  if (repo) {
    await git(cwd, ["init"]); await git(cwd, ["add", "."]);
    await git(cwd, ["-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "-m", "fixture"]);
  }
  const key = await importE2eeKey(generateE2eeKey());
  const browser = { browserId: BROWSER, key, keyId: await keyIdForKey(key) };
  const calls = { source: [], fork: [], history: [] }, sent = [], frames = [], relays = [];
  const statePath = join(managed, "outbox.json");
  const source = { id: SOURCE, cwd, name: CANARY, provider: "codex", status: "idle" };
  const behavior = { capability: { mode: "turn", worktree: true }, preflightError: null, nativeError: null, nativeResult: null };
  let created = null;
  const adapter = {
    provider: "codex", workspace: cwd,
    forkCapabilities: () => behavior.capability,
    async forkSource(options) {
      calls.source.push(options);
      if (behavior.preflightError) throw new Error(behavior.preflightError);
      return source;
    },
    async forkSession(options) {
      calls.fork.push(options);
      if (behavior.nativeError) throw new Error(behavior.nativeError);
      created = behavior.nativeResult ?? { ...source, id: NEW, cwd: options.cwd, sync_state: "persisted" };
      return created;
    },
    async readHistory(options) {
      calls.history.push(options);
      return { messages: [{ id: "inherited_reply", role: "codex", content: CANARY,
        turn_id: "turn_inherited", created_at: new Date().toISOString() }], agents: [] };
    },
    listSessions: async () => created ? [created, source] : [source],
    listProjects: async () => [], readUsage: async () => ({}), close: async () => {},
  };
  async function makeRelay() {
    const relay = new MacRelay({ serverUrl: "https://relay.test", deviceId: DEVICE, adapter,
      statePath, sessionWorktreeRoot: managed, readAgentRuntimeInfo: async () => [] });
    relays.push(relay);
    await relay.outbox.load();
    relay.browserKeys.set(BROWSER, browser);
    relay.activeBrowserKeys.set(BROWSER, browser);
    relay.authorizationObservedAt = Date.now();
    relay.ready = true;
    relay.remoteFetch = async (path, options) => {
      if (path.startsWith("/api/relay/commands")) return Response.json({ commands: frames.splice(0),
        browser_authorizations: [{ id: BROWSER, key_id: browser.keyId }], ack_seq: 0 });
      assert.equal(path, "/api/relay/push");
      sent.push(...JSON.parse(options.body).messages);
      return Response.json({ accepted: true, ack_seq: 0 });
    };
    return relay;
  }
  let relay = await makeRelay();
  t.after(async () => {
    for (const instance of relays) await instance.stop();
    await rm(root, { recursive: true, force: true });
  });
  const command = (requestId = "fork_once", payload = {}) => ({ type: "session.fork", request_id: requestId,
    device_id: DEVICE, session_id: SOURCE, issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 120_000).toISOString(),
    payload: { message_id: `reply_${CANARY}`, turn_id: `turn_${CANARY}`, mode: "same_directory", ...payload } });
  async function settle() {
    while (relay.remoteCommandTasks.size || relay.operations.size) {
      await Promise.all([...relay.remoteCommandTasks.values(), ...relay.operations]);
    }
    await relay.flushRemoteUploads();
    if (relay.outbox.writeChain) await relay.outbox.writeChain;
  }
  async function receive(value, sealed = null) {
    const frame = sealed ?? await commandFrame(key, value);
    frames.push(frame);
    assert.equal(await relay.pollRemoteCommands({ waitMs: 0 }), true);
    await settle();
    return frame;
  }
  async function responses(requestId) {
    return Promise.all(sent.filter(frame => frame.kind === "response" && frame.request_id === requestId)
      .map(async frame => ({ frame, value: await openJson(key, frame.envelope, frame.aad) })));
  }
  return { root, cwd, managed, source, adapter, behavior, calls, sent, key, statePath, command, receive, settle, responses,
    get relay() { return relay; },
    async restart() { await relay.stop(); relay = await makeRelay(); return relay; } };
}

test("session fork encrypted polling dispatch binds the result to its new ID and replays exact ciphertext after retry/restart", async (t) => {
  const f = await fixture(t), command = f.command();
  const sealed = await f.receive(command);
  assert.equal(JSON.stringify(sealed).includes(CANARY), false);
  assert.equal(sealed.session_id, SOURCE);
  const first = (await f.responses(command.request_id))[0];
  assert.equal(first.value.type, "session.fork_result");
  assert.equal(first.value.source_session_id, SOURCE);
  assert.equal(first.value.session_id, NEW);
  assert.equal(first.value.session.cwd, f.cwd);
  assert.equal(first.frame.session_id, NEW);
  assert.equal(first.frame.aad.session_id, NEW);
  assert.equal(JSON.stringify(first.frame).includes(CANARY), false);
  assert.equal(JSON.stringify(first.frame).includes(f.cwd), false);
  assert.equal(f.calls.fork.length, 1);
  assert.deepEqual(f.calls.fork[0], { sessionId: SOURCE, messageId: command.payload.message_id,
    turnId: command.payload.turn_id, cwd: f.cwd });
  assert.deepEqual(f.relay.outbox.transportRequests[command.request_id].frames, [first.frame]);
  assert.equal((await readFile(f.statePath, "utf8")).includes(CANARY), false);
  await f.receive(command, sealed);
  assert.deepEqual((await f.responses(command.request_id)).at(-1).frame, first.frame);
  assert.equal(f.calls.fork.length, 1);
  await f.restart();
  await f.receive(command, sealed);
  assert.deepEqual((await f.responses(command.request_id)).at(-1).frame, first.frame);
  assert.equal(f.calls.fork.length, 1);
  const history = { ...f.command("read_inherited"), type: "session.read_history", session_id: NEW,
    payload: { limit: 100, before: null } };
  await f.receive(history);
  const inherited = (await f.responses(history.request_id))[0];
  assert.equal(inherited.value.messages[0].content, CANARY);
  assert.equal(inherited.frame.aad.session_id, NEW);
  assert.equal(JSON.stringify(inherited.frame).includes(CANARY), false);
  assert.equal(f.calls.history.at(-1).sessionId, NEW);
  assert.equal((await readFile(f.statePath, "utf8")).includes(CANARY), false);
});

for (const error of ["session_fork_busy", "session_fork_latest_only", "session_fork_invalid_reply", "session_not_found"]) {
  test(`session fork preflight ${error} has no native or Git effect and errors bind the source`, async (t) => {
    const f = await fixture(t);
    f.behavior.preflightError = error;
    const command = f.command(error, { mode: "worktree" });
    await f.receive(command);
    const response = (await f.responses(command.request_id))[0];
    assert.deepEqual(response.value, { type: "session.fork_error", request_id: command.request_id,
      session_id: SOURCE, source_session_id: SOURCE, error });
    assert.equal(response.frame.session_id, SOURCE);
    assert.equal(response.frame.aad.session_id, SOURCE);
    assert.equal(f.calls.fork.length, 0);
    assert.equal((await git(f.cwd, ["worktree", "list", "--porcelain"])).match(/^worktree /gm).length, 1);
    await assert.rejects(access(join(f.managed, "session-worktrees")), { code: "ENOENT" });
  });
}

test("session fork unsupported capability and malformed selection do not create a worktree", async (t) => {
  const f = await fixture(t);
  f.behavior.capability = null;
  const unsupported = f.command("unsupported", { mode: "worktree" });
  await f.receive(unsupported);
  assert.equal((await f.responses(unsupported.request_id))[0].value.error, "session_fork_unsupported");
  const invalid = f.command("invalid", { message_id: "", mode: "worktree" });
  await f.receive(invalid);
  assert.equal((await f.responses(invalid.request_id))[0].value.error, "session_fork_invalid_reply");
  assert.equal(f.calls.fork.length, 0);
  assert.equal(f.calls.source.length, 1, "malformed selection stops before adapter preflight");
  await assert.rejects(access(join(f.managed, "session-worktrees")), { code: "ENOENT" });
});

test("session fork capability enrichment strips stale fields for unsupported providers and subagents", async (t) => {
  const f = await fixture(t);
  const stale = { ...f.source, fork_mode: "turn", supports_fork_worktree: true };
  f.behavior.capability = null;
  const unsupported = await f.relay.withForkCapabilities(stale);
  assert.equal(Object.hasOwn(unsupported, "fork_mode"), false);
  assert.equal(Object.hasOwn(unsupported, "supports_fork_worktree"), false);
  f.behavior.capability = { mode: "turn", worktree: true };
  f.source.is_subagent = true;
  const subagent = await f.relay.withForkCapabilities({ ...stale, is_subagent: true });
  assert.equal(Object.hasOwn(subagent, "fork_mode"), false);
  assert.equal(Object.hasOwn(subagent, "supports_fork_worktree"), false);
  const command = f.command("subagent-stale-capability", { mode: "worktree" });
  await f.receive(command);
  assert.equal((await f.responses(command.request_id))[0].value.error, "session_fork_unsupported");
  assert.equal(f.calls.fork.length, 0);
  await assert.rejects(access(join(f.managed, "session-worktrees")), { code: "ENOENT" });
});

test("session fork same-directory filesystem aliases return the source wire cwd after physical verification", async (t) => {
  if (process.platform === "win32") { t.skip("directory symlink privileges are environment-dependent"); return; }
  const f = await fixture(t);
  const alias = join(f.root, "source-directory-alias");
  await symlink(f.cwd, alias, "dir");
  f.source.cwd = alias;
  const native = { ...f.source, id: NEW, cwd: f.cwd, sync_state: "persisted" };
  f.behavior.nativeResult = native;
  const command = f.command("same-directory-alias");
  await f.receive(command);
  const response = (await f.responses(command.request_id))[0];
  assert.equal(response.value.type, "session.fork_result");
  assert.equal(response.value.source_session_id, SOURCE);
  assert.equal(response.value.session.cwd, alias);
  assert.equal(f.calls.fork[0].cwd, alias);
  assert.equal(await realpath(response.value.session.cwd), await realpath(native.cwd));
  assert.equal(native.cwd, f.cwd, "wire normalization does not rewrite native adapter metadata");
  assert.equal(response.frame.aad.session_id, NEW);
});

test("session fork worktree unavailability never falls back to the original directory", async (t) => {
  const f = await fixture(t, { repo: false }), command = f.command("nonrepo", { mode: "worktree" });
  await f.receive(command);
  assert.equal((await f.responses(command.request_id))[0].value.error, "session_worktree_unavailable");
  assert.equal(f.calls.fork.length, 0);
  assert.equal(await readFile(join(f.cwd, "source.txt"), "utf8"), "original fixture\n");
  await assert.rejects(access(join(f.managed, "session-worktrees")), { code: "ENOENT" });
});

test("session fork success uses the actual detached checkout and keeps its directory only in ciphertext", async (t) => {
  const f = await fixture(t), command = f.command("worktree-success", { mode: "worktree" });
  await writeFile(join(f.cwd, "source.txt"), "uncommitted source\n");
  await f.receive(command);
  const response = (await f.responses(command.request_id))[0];
  assert.equal(response.value.type, "session.fork_result");
  assert.equal(response.value.session_id, NEW);
  assert.equal(response.value.source_session_id, SOURCE);
  const target = response.value.session.cwd;
  assert.notEqual(target, f.cwd);
  assert.equal(target, f.calls.fork[0].cwd);
  assert.equal(await git(target, ["rev-parse", "HEAD"]), await git(f.cwd, ["rev-parse", "HEAD"]));
  await assert.rejects(git(target, ["symbolic-ref", "HEAD"]));
  assert.equal(await readFile(join(target, "source.txt"), "utf8"), "original fixture\n");
  assert.equal(await readFile(join(f.cwd, "source.txt"), "utf8"), "uncommitted source\n");
  assert.equal(response.frame.aad.session_id, NEW);
  assert.equal(JSON.stringify(response.frame).includes(target), false);
  assert.equal((await readFile(f.statePath, "utf8")).includes(target), false);
});

test("session fork actual Git target collision preserves the existing checkout and never falls back", async (t) => {
  const f = await fixture(t), command = f.command("existing-target", { mode: "worktree" });
  const existing = await createSessionWorktree({ cwd: f.cwd, rootDir: f.managed, requestId: command.request_id });
  await writeFile(join(existing.cwd, "user.txt"), "retain collision target");
  await f.receive(command);
  assert.equal((await f.responses(command.request_id))[0].value.error, "session_worktree_failed");
  assert.equal(f.calls.fork.length, 0);
  assert.equal(await readFile(join(existing.cwd, "user.txt"), "utf8"), "retain collision target");
  assert.equal(await readFile(join(f.cwd, "source.txt"), "utf8"), "original fixture\n");
});

test("session fork definite native rejection cleans its clean checkout and preserves the original", async (t) => {
  const f = await fixture(t), command = f.command("late-busy", { mode: "worktree" });
  f.behavior.nativeError = "session_fork_busy";
  await f.receive(command);
  assert.equal((await f.responses(command.request_id))[0].value.error, "session_fork_busy");
  assert.equal(f.calls.fork.length, 1);
  await assert.rejects(access(f.calls.fork[0].cwd), { code: "ENOENT" });
  assert.equal((await git(f.cwd, ["worktree", "list", "--porcelain"])).match(/^worktree /gm).length, 1);
  assert.equal(await git(f.cwd, ["status", "--porcelain"]), "");
});

test("session fork uncertain native outcome retains its actual worktree and retry/restart never executes again", async (t) => {
  const f = await fixture(t), command = f.command("unknown-outcome", { mode: "worktree" });
  f.behavior.nativeError = `${CANARY} private native transport failure`;
  const sealed = await f.receive(command);
  const first = (await f.responses(command.request_id))[0];
  assert.equal(first.value.error, "session_fork_outcome_unknown");
  assert.equal(first.value.source_session_id, SOURCE);
  assert.equal(JSON.stringify(first.value).includes(CANARY), false);
  assert.equal(first.frame.aad.session_id, SOURCE);
  assert.notEqual(f.calls.fork[0].cwd, f.cwd);
  await access(f.calls.fork[0].cwd);
  assert.equal((await git(f.cwd, ["worktree", "list", "--porcelain"])).match(/^worktree /gm).length, 2);
  await f.restart(); await f.receive(command, sealed);
  assert.equal(f.calls.fork.length, 1);
  assert.deepEqual((await f.responses(command.request_id)).at(-1).frame, first.frame);
  await access(f.calls.fork[0].cwd);
  assert.equal(await git(f.cwd, ["status", "--porcelain"]), "");
});

test("session fork a persisted admission without a response is never replayed after restart", async (t) => {
  const f = await fixture(t), command = f.command("admitted-only");
  const sealed = await f.receive(command);
  const receipt = f.relay.outbox.transportRequests[command.request_id];
  receipt.frames = []; receipt.bytes = 0;
  await f.relay.outbox.persist();
  const count = f.sent.length;
  await f.restart(); await f.receive(command, sealed);
  assert.equal(f.calls.fork.length, 1);
  assert.equal(f.sent.slice(count).some(frame => frame.kind === "response" && frame.request_id === command.request_id), false);
  assert.equal(f.sent.slice(count).some(frame => frame.kind === "command_ack" && frame.status === "duplicate"), true);
});

test("MultiAgentAdapter keeps a fork on its source provider and immediately routes the new session ID", async (t) => {
  const calls = [], source = { id: "pi_source", cwd: "/fixture/pi", status: "idle" };
  const pi = {
    start: async () => {}, close: async () => {}, listSessions: async () => [source],
    forkCapabilities: () => ({ mode: "turn", worktree: true }),
    forkSource: async options => { calls.push(["preflight", options]); return source; },
    forkSession: async options => { calls.push(["fork", options]); return { ...source, id: "pi_new", cwd: options.cwd }; },
    readHistory: async options => { calls.push(["history", options]); return { messages: [{ content: CANARY }] }; },
  };
  const other = { start: async () => {}, close: async () => {}, listSessions: async () => [],
    forkSession: async () => assert.fail("default provider must not receive another provider's fork"),
    readHistory: async () => assert.fail("new ID must route to its original provider") };
  const multi = new MultiAgentAdapter({ defaultProvider: "codex", adapters: { codex: other, pi } });
  await multi.start({ emitEvent: async () => {}, requestApproval: async () => {} });
  t.after(() => multi.close());
  const selection = { sessionId: source.id, messageId: "pi_reply", turnId: "pi_turn" };
  assert.equal((await multi.forkSource(selection)).provider, "pi");
  const fork = await multi.forkSession({ ...selection, cwd: "/fixture/new-worktree" });
  assert.equal(fork.provider, "pi");
  assert.equal(fork.fork_mode, "turn");
  assert.equal((await multi.readHistory({ sessionId: fork.id })).messages[0].content, CANARY);
  assert.deepEqual(calls.map(call => call[0]), ["preflight", "fork", "history"]);
  assert.equal(calls.at(-1)[1].sessionId, fork.id);
});
