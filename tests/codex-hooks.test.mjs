import assert from "node:assert/strict";
import nodeTest from "node:test";
import { spawn, execFileSync } from "node:child_process";
import { connect } from "node:net";
import { mkdtemp, writeFile, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { codexHookReviewer } from "../relay/codex-hook-context.mjs";
import { runCodexHook, codexHookPaths } from "../relay/codex-hook-client.mjs";
import { CodexHookBridge } from "../relay/codex-hook-bridge.mjs";
import { configureCodexHooks, shellQuote } from "../relay/codex-hook-install.mjs";
import { MacRelay } from "../relay/mac-relay.mjs";
import { CodexAppServerAdapter } from "../relay/codex-adapters.mjs";
import { generateE2eeKey, keyIdForKey, openJson } from "../relay/e2ee.mjs";

const test = (name, run) => nodeTest(name, { skip: process.platform === "win32", timeout: 10_000 }, run);

async function fixture(t, options = {}) {
  const home = await mkdtemp(join(process.platform === "darwin" ? "/private/tmp" : tmpdir(), "rh-"));
  const events = [], approvals = [];
  const paths = codexHookPaths(home);
  const payload = { hook_event_name: "PermissionRequest", session_id: "desktop-thread", turn_id: "current-turn",
    transcript_path: join(home, "rollout.jsonl"), tool_name: "Bash", cwd: home,
    tool_input: { command: "echo PRIVATE_HOOK_CANARY", description: "test request" } };
  await writeFile(payload.transcript_path, context("current-turn", "user"));
  const bridge = new CodexHookBridge({ home, available: () => true,
    requestApproval: async approval => { approvals.push(approval); },
    resolved: async (sessionId, event) => { events.push({ sessionId, event }); }, ...options });
  t.after(async () => { await bridge.close(); await rm(home, { recursive: true, force: true }); });
  return { home, paths, payload, bridge, approvals, events };
}
function context(turnId, reviewer) {
  return JSON.stringify({ type: "turn_context", payload: { turn_id: turnId, approvals_reviewer: reviewer } }) + "\n";
}
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(10); }
  assert.fail("condition did not become true");
}

test("hook reviewer uses the latest exact turn, never another turn or global defaults", async t => {
  const f = await fixture(t);
  await writeFile(f.payload.transcript_path, context("current-turn", "user") + context("another-turn", "auto_review"));
  assert.equal(await codexHookReviewer(f.payload), "user");
  await writeFile(f.payload.transcript_path, context("current-turn", "user") + context("current-turn", "auto_review"));
  assert.equal(await codexHookReviewer(f.payload), "auto");
  for (const text of [context("another-turn", "user"), context("current-turn", undefined), "bad json\n",
    context("current-turn", "user") + context("current-turn", "future-reviewer")]) {
    await writeFile(f.payload.transcript_path, text);
    assert.equal(await codexHookReviewer(f.payload), "unknown");
  }
});

test("hook reviewer bounds tail reads and rejects missing files, directories and symlinks", async t => {
  const f = await fixture(t);
  await writeFile(f.payload.transcript_path, "x".repeat(5000) + "\n" + context("current-turn", "user"));
  assert.equal(await codexHookReviewer(f.payload, { limit: 256 }), "user");
  await writeFile(f.payload.transcript_path, context("current-turn", "user") + "x".repeat(5000));
  assert.equal(await codexHookReviewer(f.payload, { limit: 256 }), "unknown");
  await symlink(f.payload.transcript_path, join(f.home, "link"));
  for (const path of [f.home, join(f.home, "link"), join(f.home, "missing")]) {
    assert.equal(await codexHookReviewer({ ...f.payload, transcript_path: path }), "unknown");
  }
});

// Socket fixtures opt in explicitly so an owned-agent parent cannot skip the path under test.
for (const reviewer of ["auto_review", "guardian_subagent", "future-reviewer", undefined]) {
  test(`hook ${reviewer ?? "missing"} reviewer defers without publishing a mobile request`, async t => {
    const f = await fixture(t);
    await f.bridge.start();
    await writeFile(f.payload.transcript_path, context("current-turn", reviewer));
    assert.deepEqual(await runCodexHook(f.payload, { skip: false, socketPath: f.paths.socket }), {});
    assert.equal(f.approvals.length, 0);
  });
}

for (const [decision, optionId, behavior] of [
  ["approved", "hook_allow", "allow"], ["rejected", "hook_deny", "deny"], ["rejected", "hook_native", null],
]) {
  test(`real hook socket round trip: ${optionId}`, async t => {
    const f = await fixture(t);
    await f.bridge.start();
    const result = runCodexHook(f.payload, { skip: false, socketPath: f.paths.socket });
    await until(() => f.approvals.length === 1);
    const approval = f.approvals[0];
    assert.equal(approval.session_id, f.payload.session_id);
    assert.equal(approval.action.display, f.payload.tool_input.command);
    assert.equal((await stat(f.paths.directory)).mode & 0o777, 0o700);
    assert.equal((await stat(f.paths.socket)).mode & 0o777, 0o600);
    await f.bridge.resolveApproval({ approvalId: approval.approval_id, decision, optionId });
    const output = await result;
    if (behavior) assert.equal(output.hookSpecificOutput.decision.behavior, behavior);
    else assert.deepEqual(output, {});
    assert.equal(f.events.at(-1).event.decision, behavior ? decision : "expired");
    assert.equal(f.bridge.pending.size, 0);
    await assert.rejects(f.bridge.resolveApproval({ approvalId: approval.approval_id, decision, optionId }), /no longer pending/);
  });
}

test("unavailable Relay, owned backend, non-permission events and offline bridge always defer", async t => {
  const f = await fixture(t, { available: () => false });
  assert.deepEqual(await runCodexHook(f.payload, { skip: false, socketPath: f.paths.socket }), {});
  await f.bridge.start();
  for (const [payload, options] of [[f.payload, {}], [f.payload, { skip: true }],
    [{ ...f.payload, hook_event_name: "Stop" }, {}]]) {
    assert.deepEqual(await runCodexHook(payload, { skip: false, socketPath: f.paths.socket, ...options }), {});
  }
  assert.equal(f.approvals.length, 0);
});

test("timeout and hook process disconnect expire mobile cards and reject late replies", async t => {
  const f = await fixture(t, { waitMs: 150 });
  await f.bridge.start();
  assert.deepEqual(await runCodexHook(f.payload, { skip: false, socketPath: f.paths.socket }), {});
  await until(() => f.events.length === 1);
  assert.equal(f.events[0].event.decision, "expired");
  assert.deepEqual(await runCodexHook(f.payload, { skip: false, socketPath: f.paths.socket, timeoutMs: 40 }), {});
  await until(() => f.events.length === 2);
  assert.equal(f.events[1].event.decision, "expired");
  assert.equal(f.bridge.pending.size, 0);
});

test("bridge independently checks Auto Review before publishing", async t => {
  const f = await fixture(t);
  await f.bridge.start();
  await writeFile(f.payload.transcript_path, context("current-turn", "auto_review"));
  const response = await new Promise((resolveResult, reject) => {
    const socket = connect(f.paths.socket);
    socket.on("error", reject);
    socket.on("connect", () => socket.write(JSON.stringify(f.payload) + "\n"));
    socket.on("data", chunk => { socket.destroy(); resolveResult(chunk.toString()); });
  });
  assert.equal(response, "{}\n");
  assert.equal(f.approvals.length, 0);
});

test("switching to Auto Review while a hook waits discards the mobile decision", async t => {
  const f = await fixture(t);
  await f.bridge.start();
  const result = runCodexHook(f.payload, { skip: false, socketPath: f.paths.socket });
  await until(() => f.approvals.length === 1);
  await writeFile(f.payload.transcript_path, context("current-turn", "auto_review"));
  await f.bridge.resolveApproval({ approvalId: f.approvals[0].approval_id, decision: "approved" });
  assert.deepEqual(await result, {});
  assert.equal(f.events.at(-1).event.decision, "expired");
});

test("a second bridge cannot steal a live listener; closing first lets it start", async t => {
  const f = await fixture(t);
  const second = new CodexHookBridge({ home: f.home, available: () => false });
  t.after(() => second.close());
  await f.bridge.start();
  await assert.rejects(second.start(), /hook_bridge_busy/);
  await f.bridge.close();
  await second.start();
});

test("failed publication and Relay shutdown return native handling", async t => {
  const f = await fixture(t, { requestApproval: async () => { throw new Error("disk unavailable"); } });
  await f.bridge.start();
  assert.deepEqual(await runCodexHook(f.payload, { skip: false, socketPath: f.paths.socket }), {});
  f.bridge.requestApproval = async approval => f.approvals.push(approval);
  const result = runCodexHook(f.payload, { skip: false, socketPath: f.paths.socket });
  await until(() => f.approvals.length === 1);
  await f.bridge.close();
  assert.deepEqual(await result, {});
});

test("hook decisions pass existing nonce/hash checks and use encrypted outbox without calling app-server", async t => {
  const f = await fixture(t);
  const relay = new MacRelay({ adapter: { workspace: f.home, resolveApproval: () => assert.fail("wrong approval owner") },
    statePath: join(f.home, "outbox.json"), deviceId: "dev_hook", codexHooks: { home: f.home } });
  relay.ready = true;
  relay.send = () => {};
  const key = generateE2eeKey();
  relay.activeBrowserKeys.set("web_test", { browserId: "web_test", key, keyId: await keyIdForKey(key) });
  t.after(() => relay.codexHooks.close());
  await relay.codexHooks.start();
  const result = runCodexHook(f.payload, { skip: false, socketPath: f.paths.socket });
  await until(() => relay.outbox.pending.size === 1);
  await relay.outbox.appendChain; // Wait for the durable encrypted write, not just the in-memory insertion.
  const variant = [...relay.outbox.pending.values()][0].variants[0];
  const approval = (await openJson(key, variant.envelope, variant.aad)).event;
  assert.equal(approval.action.display, f.payload.tool_input.command);
  assert.equal((await readFile(join(f.home, "outbox.json"), "utf8")).includes("PRIVATE_HOOK_CANARY"), false);
  const command = { type: "approval.resolve", request_id: "req_hook", device_id: relay.deviceId,
    session_id: approval.session_id, expires_at: approval.expires_at,
    payload: { approval_id: approval.approval_id, device_id: relay.deviceId, session_id: approval.session_id,
      decision: "approved", option_id: "hook_allow", expires_at: approval.expires_at,
      command_hash: approval.action.command_hash, nonce: "nonce_hook_test_1234567890" } };
  await relay.resolveApproval({ ...command, payload: { ...command.payload, command_hash: "wrong-hash" } });
  assert.equal(relay.codexHooks.pending.size, 1);
  await relay.resolveApproval({ ...command, payload: { ...command.payload, option_id: "allow_always", nonce: "bad_option_nonce_123456789" } });
  assert.equal(relay.codexHooks.pending.size, 1);
  await relay.resolveApproval(command);
  assert.equal((await result).hookSpecificOutput.decision.behavior, "allow");
  assert.equal(relay.pendingApprovals.size, 0);
  const count = relay.outbox.pending.size;
  await relay.resolveApproval(command);
  assert.equal(relay.outbox.pending.size, count);
});

test("installer preserves user hooks, stays idempotent, updates its launcher, and honors uninstall", async t => {
  const f = await fixture(t);
  const existing = { description: "mine", hooks: { Stop: [{ hooks: [{ type: "command", command: "true" }] }],
    PermissionRequest: [{ matcher: "Bash", hooks: [{ type: "command", command: "another-hook" }] }] } };
  await writeFile(f.paths.hooks, JSON.stringify(existing));
  const options = { home: f.home, argv: ["/absolute path/node", "/path/with'quote/cli.mjs"] };
  await configureCodexHooks("install", options);
  const first = await readFile(f.paths.hooks, "utf8");
  await configureCodexHooks("install", options);
  assert.equal(await readFile(f.paths.hooks, "utf8"), first);
  assert.equal((await configureCodexHooks("status", options)).configured, true);
  await configureCodexHooks("install", { ...options, argv: ["/Applications/Relayune.app/Contents/MacOS/relayune-core"] });
  assert.equal(JSON.parse(await readFile(f.paths.hooks)).hooks.PermissionRequest.length, 2);
  await configureCodexHooks("uninstall", options);
  assert.deepEqual(JSON.parse(await readFile(f.paths.hooks)), existing);
  await configureCodexHooks("install", { ...options, automatic: true });
  assert.equal((await configureCodexHooks("status", options)).configured, false);
  await configureCodexHooks("install", options);
  assert.equal((await configureCodexHooks("status", options)).configured, true);
});

test("installer leaves malformed, symlinked and user-modified hook configurations untouched", async t => {
  const f = await fixture(t);
  const options = { home: f.home, argv: [process.execPath, resolve("relay/cli.mjs")] };
  await writeFile(f.paths.hooks, "invalid JSON");
  await assert.rejects(configureCodexHooks("install", options));
  assert.equal(await readFile(f.paths.hooks, "utf8"), "invalid JSON");
  await rm(f.paths.hooks);
  await symlink(f.payload.transcript_path, f.paths.hooks);
  await assert.rejects(configureCodexHooks("install", options), /unsafe_hook_config/);
  await rm(f.paths.hooks);
  await configureCodexHooks("install", options);
  const changed = JSON.parse(await readFile(f.paths.hooks));
  changed.hooks.PermissionRequest[0].hooks[0].timeout = 10;
  await writeFile(f.paths.hooks, JSON.stringify(changed));
  await assert.rejects(configureCodexHooks("uninstall", options), /definition_changed/);
  assert.deepEqual(JSON.parse(await readFile(f.paths.hooks)), changed);
});

test("installed command runs the actual CLI with only hook JSON on stdout", async t => {
  const f = await fixture(t);
  await f.bridge.start();
  await configureCodexHooks("install", { home: f.home, argv: [process.execPath, resolve("relay/cli.mjs")] });
  const command = JSON.parse(await readFile(f.paths.hooks)).hooks.PermissionRequest[0].hooks[0].command;
  const child = spawn("/bin/sh", ["-c", command], { env: { ...process.env, RELAYUNE_SKIP_CODEX_HOOKS: "0" }, stdio: "pipe" });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const exited = new Promise((resolveExit, reject) => { child.once("error", reject); child.once("close", resolveExit); });
  t.after(() => child.kill());
  child.stdin.end(JSON.stringify(f.payload));
  await until(() => f.approvals.length === 1);
  await f.bridge.resolveApproval({ approvalId: f.approvals[0].approval_id, decision: "approved" });
  assert.equal(await exited, 0);
  assert.equal(stderr, "");
  assert.equal(JSON.parse(stdout).hookSpecificOutput.decision.behavior, "allow");
});

test("launcher shell quoting preserves special characters without evaluating substitutions", () => {
  const argument = "a'$(printf unwanted)`printf unwanted` b";
  const command = [process.execPath, "-e", "process.stdout.write(process.argv[1])", argument].map(shellQuote).join(" ");
  assert.equal(execFileSync("/bin/sh", ["-c", command], { encoding: "utf8" }), argument);
});

test("owned Codex app-server receives the hook skip flag without changing the parent environment", async t => {
  const f = await fixture(t);
  const executable = join(f.home, "fake-codex");
  await writeFile(executable, `#!${process.execPath}
const {createInterface} = require('node:readline');
createInterface({input: process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if (m.id !== undefined) process.stdout.write(JSON.stringify({id:m.id,result:{skip:process.env.RELAYUNE_SKIP_CODEX_HOOKS}}) + '\\n');
});
`, { mode: 0o700 });
  const original = process.env.RELAYUNE_SKIP_CODEX_HOOKS;
  const adapter = new CodexAppServerAdapter({ codexBin: executable, workspace: f.home });
  t.after(() => adapter.close());
  await adapter.start({ emitEvent: async () => {}, requestApproval: async () => {} });
  assert.equal((await adapter.request("test/environment", {})).skip, "1");
  assert.equal(process.env.RELAYUNE_SKIP_CODEX_HOOKS, original);
});
