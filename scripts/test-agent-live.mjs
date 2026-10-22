#!/usr/bin/env node
// Opt-in integration checks against installed, authenticated CLIs. Uses real tokens.
import assert from "node:assert/strict";
import { findLiveTurnCompletion, hasLiveTurnReply, acceptsLiveTurnCompletion, selectLiveClaudeManualMode } from "./lib/agent-live-turn.mjs";
import { mkdtemp, readFile, realpath, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CodexAppServerAdapter } from "../relay/codex-adapters.mjs";
import { KimiCodeAdapter } from "../relay/kimi-adapter.mjs";
import { ClaudeCodeAdapter } from "../relay/claude-adapter.mjs";
import { ProjectManager, LocalProjectStore } from "../relay/project-manager.mjs";

const constructors = { codex: CodexAppServerAdapter, kimi: KimiCodeAdapter, claude: ClaudeCodeAdapter };
const provider = process.argv[2];
assert.ok(constructors[provider], "Usage: node scripts/test-agent-live.mjs codex|kimi|claude");
// --recover <session-id> <fixture-cwd> continues a completed disposable journey.
const recovery = process.argv[3] === "--recover";
const contextOnly = process.argv.includes("--recover-context-only");
assert.ok(!contextOnly || recovery, "--recover-context-only requires --recover <session-id> <fixture-cwd>");
const root = await realpath(recovery ? process.argv[5] : await mkdtemp(join(tmpdir(), `relayune-${provider}-journey-`)));
const timeoutMs = Number(process.env.AGENT_LIVE_TIMEOUT_MS) || 180_000;
const adapter = new constructors[provider]({ workspace: root });
const events = [], approvals = [], checks = [];
const approvalResponses = new Map();
let cwd = root, decision = "rejected", session = recovery ? { id: process.argv[4] } : null;
const report = (check) => { checks.push(check); console.log(JSON.stringify({ provider, check, status: "passed" })); };
const waitFor = async (predicate, deadline = Date.now() + timeoutMs) => {
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs}ms`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};
async function turn(content, expected, { rejectedTool = false } = {}) {
  const start = events.length;
  const requestId = randomUUID();
  const result = await adapter.submitMessage({ sessionId: session.id, requestId, content });
  const deadline = Date.now() + timeoutMs;
  console.log(JSON.stringify({ provider, check: "turn_accepted", mode: result.mode, turnId: result.turnId, requestId }));
  let completion;
  await waitFor(() => {
    completion = findLiveTurnCompletion(result, requestId, events.slice(start));
    return Boolean(completion);
  }, deadline);
  assert.ok(acceptsLiveTurnCompletion(completion, { provider, rejectedTool }), completion.error ?? `Turn ${completion.status}`);
  console.log(JSON.stringify({ provider, check: "turn_finished", turnId: completion.turnId, status: completion.status, rejectedTool }));
  const current = events.slice(start);
  if (expected) {
    if (result.mode === "queued") {
      // The owner emits message events elsewhere. Verify this exact completed
      // turn in persisted history, never an earlier identical token response.
      let verified = false;
      while (!verified) {
        const history = await adapter.readHistory({ sessionId: session.id, limit: 100 });
        verified = hasLiveTurnReply(history.messages, completion.turnId, expected);
        if (!verified) {
          if (Date.now() > deadline) throw new Error(`Missing response: ${expected}`);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    } else {
      assert.ok(current.some(e => e.turn_id === completion.turnId && e.kind === "message.completed" && e.text?.includes(expected)), `Missing response: ${expected}`);
    }
  }
  await waitFor(() => !adapter.activeTurns.has(session.id), deadline);
  return { result: { ...result, turnId: completion.turnId, status: completion.status }, events: current };
}

async function configureFixtureApprovalMode() {
  if (provider === "codex") {
    await adapter.configureSession({ sessionId: session.id, configId: "permissions", value: "manual" });
  } else if (provider === "kimi") {
    await adapter.configureSession({ sessionId: session.id, configId: "mode", value: "default" });
  } else if (provider === "claude") {
    const mode = selectLiveClaudeManualMode(adapter.permissionModes);
    await adapter.configureSession({ sessionId: session.id, configId: "permissions", value: mode });
    console.log(JSON.stringify({ provider, check: "fixture_permission_mode", requested: mode, scope: "synthetic-session-only" }));
  }
}

try {
  await adapter.start({
    emitEvent: async (id, event) => { if (!session || id === session.id) events.push(event); },
    requestApproval: async approval => {
      approvals.push(approval);
      if (decision === "hold") return;
      // Only the exact disposable fixture command may be approved automatically.
      const display = approval.action.display.trim();
      const safe = await realpath(approval.action.cwd).then(path => path === cwd, () => false);
      const command = "printf RELAYUNE_APPROVED > approved.txt";
      const allowed = safe && [command, `/bin/zsh -lc '${command}'`, `/bin/bash -lc '${command}'`,
        `Bash: ${command}`, `Bash: Requesting approval to Running: ${command}`].includes(display);
      const selected = decision === "approved" && allowed ? "approved" : "rejected";
      console.log(JSON.stringify({ provider, approval: approval.action.type, decision: selected, display,
        options: approval.action.options?.map(({option_id, kind}) => ({option_id, kind})),
        ...(provider === "claude" ? { permissionMode: adapter.observedPermissionModes.get(session?.id) } : {}) }));
      await adapter.resolveApproval({ approvalId: approval.approval_id, decision: selected });
      approvalResponses.set(approval.approval_id, selected);
    },
  });
  report("start");
  if (!recovery) {
    const operations = new Map();
    const manager = new ProjectManager({ adapter, defaultLocation: root,
      localProjects: new LocalProjectStore(join(root, "projects.json")),
      loadOperation: async id => operations.get(id), saveOperation: async (id, record) => operations.set(id, record),
    });
    const payload = { provider, mode: "new", path: root, name: "test-project", operation_id: randomUUID() };
    const created = await manager.create(payload, "live-test");
    cwd = created.project.cwd;
    assert.deepEqual(await manager.create(payload, "live-test"), created);
    assert.ok((await manager.listProjects()).some(p => p.cwd === cwd));
    await writeFile(join(cwd, "package.json"), '{"name":"relayune-live-fixture","private":true}\n');
    report("new_project_and_retry");
    session = await adapter.createSession({ cwd, name: `Relayune ${provider} live verification` });
    assert.ok(session.id);
    report("new_session");
    await turn("Remember the token BLUE_OTTER_731 for this conversation. Reply exactly RELAYUNE_FIRST_OK. Do not use tools.", "RELAYUNE_FIRST_OK");
    report("first_turn");
    await turn("What token did I ask you to remember? Reply with the token only. Do not use tools.", "BLUE_OTTER_731");
    report("multi_turn_context");
    assert.ok((await adapter.listSessions()).some(s => s.id === session.id));
    const history = await adapter.readHistory({ sessionId: session.id, limit: 100 });
    assert.ok(history.messages.some(m => m.role === "codex" && m.content.includes("BLUE_OTTER_731")));
    report("catalog_and_history");
    await configureFixtureApprovalMode();
    decision = "approved";
    let count = approvals.length;
    await turn("Use your shell tool exactly once to execute `printf RELAYUNE_APPROVED > approved.txt` in the current working directory. Use that exact command without wrappers. Then reply RELAYUNE_WRITE_OK.", "RELAYUNE_WRITE_OK");
    assert.ok(approvals.length > count, "No approval request for write");
    assert.equal(await readFile(join(cwd, "approved.txt"), "utf8"), "RELAYUNE_APPROVED");
    if (provider === "claude") {
      assert.ok(["manual", "default"].includes(adapter.observedPermissionModes.get(session.id)), "Claude did not run the approval fixture in manual mode");
    }
    report("approve_tool");
    decision = "rejected";
    count = approvals.length;
    await turn("Use your shell tool once to execute `printf DENIED > denied.txt`. If permission is denied, do not retry or use another tool; reply RELAYUNE_DENIED_OK.", null, { rejectedTool: true });
    assert.ok(approvals.length > count, "No approval request to reject");
    const rejectedApprovals = approvals.slice(count);
    await waitFor(() => rejectedApprovals.every(approval => approvalResponses.get(approval.approval_id) === "rejected" && !adapter.pendingApprovals.has(approval.approval_id)));
    assert.equal(await access(join(cwd, "denied.txt")).then(() => true, () => false), false);
    report("reject_tool");
    await turn("After the denied tool, what was the token from my first message? Reply only with that token, without tools.", "BLUE_OTTER_731");
    report("context_after_rejection");
    const agentTurn = await turn("Use your native subagent tool (Agent/Task/spawn_agent) to delegate to one read-only subagent: read package.json in the current directory and report the package name. Wait for it to finish. Do not write files or use the shell. Then reply RELAYUNE_AGENT_OK.", "RELAYUNE_AGENT_OK");
    assert.ok(agentTurn.events.some(e => e.kind === "agent.completed"), "No completed subagent event");
    const agents = adapter.readAgents ? await adapter.readAgents({ sessionId: session.id }) : (await adapter.readHistory({ sessionId: session.id })).agents;
    assert.ok(agents?.some(a => a.status === "completed"), "Completed agent absent from snapshot");
    report("subagent_and_snapshot");
    await turn("After all those tools, what was the token from my first message? Reply only with that token.", "BLUE_OTTER_731");
    report("context_after_tools");
  } else {
    assert.ok((await adapter.listSessions()).some(s => s.id === session.id));
    const restored = await adapter.readHistory({ sessionId: session.id, limit: 100 });
    assert.ok(restored.messages.some(m => m.role === "codex" && m.content.includes("BLUE_OTTER_731")));
    await turn("What token did I ask you to remember in my first message? Reply only with that token, without tools.", "BLUE_OTTER_731");
    report("restart_and_resume");
    if (!contextOnly) {
      const original = session;
      session = await adapter.createSession({ cwd, name: `Relayune ${provider} isolated peer` });
      assert.equal((await adapter.readHistory({ sessionId: session.id })).messages.length, 0);
      await turn("Remember GREEN_BIRD_852 for this conversation. Reply RELAYUNE_PEER_OK, without tools.", "RELAYUNE_PEER_OK");
      session = original;
      await turn("What token did I ask you to remember in my first message? Reply only with that token, without tools.", "BLUE_OTTER_731");
      report("session_isolation");
      await configureFixtureApprovalMode();
      decision = "hold";
      const count = approvals.length, start = events.length;
      await adapter.submitMessage({ sessionId: session.id, requestId: randomUUID(), content: "Use your shell tool exactly once to run `printf INTERRUPTED > interrupted.txt`. Wait for approval. If stopped, do not retry." });
      await waitFor(() => approvals.length > count);
      await adapter.interruptTurn({ sessionId: session.id });
      await waitFor(() => events.slice(start).some(e => e.kind === "turn.completed" && e.status === "interrupted"));
      await waitFor(() => !adapter.activeTurns.has(session.id));
      assert.equal(await access(join(cwd, "interrupted.txt")).then(() => true, () => false), false);
      const approvalId = approvals.at(-1).approval_id;
      assert.equal(adapter.pendingApprovals.has(approvalId), false, "Interrupted approval remains actionable");
      await assert.rejects(adapter.resolveApproval({ approvalId, decision: "approved" }));
      report("interrupt_pending_approval");
      decision = "rejected";
      await turn("What was the token from my first message? Reply only with that token, without tools.", "BLUE_OTTER_731");
      report("resume_after_interrupt");
    }
  }
  console.log(JSON.stringify({ provider, status: "passed", checks, workspace: root, cwd, sessionId: session.id }));
} catch (error) {
  console.error(JSON.stringify({ provider, status: "failed", checks, error: error.message, workspace: root, sessionId: session?.id }));
  process.exitCode = 1;
} finally {
  await adapter.close();
}
