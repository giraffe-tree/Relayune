#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { ClaudeCodeAdapter } from "../relay/claude-adapter.mjs";

const execFileAsync = promisify(execFile);
const requestedClaudeBin = process.env.CLAUDE_BIN || process.argv[2] || "claude";
const claudeBin = requestedClaudeBin.includes("/")
  ? resolve(requestedClaudeBin)
  : requestedClaudeBin;
const workspace = await mkdtemp(join(tmpdir(), "relayune-claude-live-"));
const timeoutMs = Number(process.env.CLAUDE_LIVE_TIMEOUT_MS) || 120_000;
const events = [];
const approvals = [];
const adapter = new ClaudeCodeAdapter({ claudeBin, workspace });

await writeFile(
  join(workspace, "package.json"),
  `${JSON.stringify({ name: "relayune-claude-live-fixture", private: true }, null, 2)}\n`,
);

const auth = await claudeAuthStatus();
if (!auth.loggedIn) {
  await adapter.start({
    emitEvent: async (sessionId, event, extra) => {
      events.push({ sessionId, event, extra });
    },
    requestApproval: async () => {},
  });
  try {
    const session = await adapter.createSession({
      cwd: workspace,
      name: `Relayune Claude auth preflight ${new Date().toISOString()}`,
    });
    const turn = await adapter.submitMessage({
      sessionId: session.id,
      requestId: `req_live_auth_${Date.now()}`,
      content: "Reply with exactly RELAYUNE_AUTH_OK.",
    });
    await waitFor(() =>
      events.some(
        (entry) =>
          entry.event.turn_id === turn.turnId &&
          entry.event.kind === "turn.failed",
      ),
    );
    const failure = events.find(
      (entry) =>
        entry.event.turn_id === turn.turnId &&
        entry.event.kind === "turn.failed",
    );
    assert.match(failure.event.error, /run `\/login`/);
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: false,
          blocked: "claude_not_logged_in",
          claudeVersion: auth.version,
          adapterErrorVerified: true,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await adapter.close();
  }
  process.stderr.write(
    "Claude Code is installed but not logged in. Open Claude Code locally, run /login, then rerun this script.\n",
  );
  process.exitCode = 2;
} else {
  await adapter.start({
    emitEvent: async (sessionId, event, extra) => {
      events.push({ sessionId, event, extra });
    },
    requestApproval: async (approval) => {
      approvals.push(approval);
      const question = approval.action.type === "question.select";
      const optionId = question
        ? approval.action.options?.[0]?.option_id
        : undefined;
      if (!question) await assertSafeApproval(approval);
      await adapter.resolveApproval({
        approvalId: approval.approval_id,
        decision: "approved",
        optionId,
      });
    },
  });

  try {
    const session = await adapter.createSession({
      cwd: workspace,
      name: `Relayune live Claude test ${new Date().toISOString()}`,
    });

    await runTurn(
      session.id,
      "Reply with exactly RELAYUNE_STREAM_OK and nothing else.",
      "RELAYUNE_STREAM_OK",
    );

    const catalog = await adapter.listSessions();
    assert.ok(
      catalog.some((candidate) => candidate.id === session.id),
      "the real Claude transcript did not appear in the session catalog",
    );
    const firstHistory = await adapter.readHistory({
      sessionId: session.id,
      limit: 100,
    });
    assert.ok(
      firstHistory.messages.some(
        (message) =>
          message.role === "codex" &&
          message.content.includes("RELAYUNE_STREAM_OK"),
      ),
      "the streamed response was not replayed from the real transcript",
    );

    await runTurn(
      session.id,
      "This is a resumed turn. Reply with exactly RELAYUNE_RESUME_OK.",
      "RELAYUNE_RESUME_OK",
    );

    const approvalCountBefore = approvals.length;
    await runTurn(
      session.id,
      "Use the Bash tool exactly once to run `printf RELAYUNE_APPROVAL_OK > relayune-approval.txt` in the current working directory. Then reply with exactly RELAYUNE_TOOL_OK.",
      "RELAYUNE_TOOL_OK",
    );
    assert.ok(
      approvals.length > approvalCountBefore,
      "the real Claude turn did not request remote tool approval",
    );
    assert.equal(
      await readFile(join(workspace, "relayune-approval.txt"), "utf8"),
      "RELAYUNE_APPROVAL_OK",
    );

    const questionCountBefore = approvals.length;
    await runTurn(
      session.id,
      "Use AskUserQuestion exactly once. Ask `Which Relayune test option?` with the options `Web` and `Mobile`. After the answer, reply with exactly RELAYUNE_QUESTION_OK.",
      "RELAYUNE_QUESTION_OK",
    );
    assert.ok(
      approvals
        .slice(questionCountBefore)
        .some((approval) => approval.action.type === "question.select"),
      "the real Claude question was not bridged through an approval choice",
    );

    await runTurn(
      session.id,
      "A PNG image is attached. Confirm receipt by replying with exactly RELAYUNE_IMAGE_OK.",
      "RELAYUNE_IMAGE_OK",
      [
        {
          mime_type: "image/png",
          base64:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        },
      ],
    );

    const agentEventIndex = events.length;
    await runTurn(
      session.id,
      "Use the Task tool exactly once with an Explore subagent to read package.json and report its package name. Wait for it, then reply with exactly RELAYUNE_AGENT_OK.",
      "RELAYUNE_AGENT_OK",
    );
    assert.ok(
      events
        .slice(agentEventIndex)
        .some((entry) => entry.event.kind === "agent.completed"),
      "the real Claude Task/Agent event did not complete",
    );

    const interruptStart = events.length;
    const interrupt = await adapter.submitMessage({
      sessionId: session.id,
      requestId: `req_live_interrupt_${Date.now()}`,
      content:
        "Use Bash to run `sleep 30`, then reply with RELAYUNE_INTERRUPT_SHOULD_NOT_FINISH.",
    });
    await waitFor(() =>
      events.slice(interruptStart).some(
        (entry) =>
          entry.event.turn_id === interrupt.turnId &&
          entry.event.kind === "command.started",
      ),
    );
    await adapter.interruptTurn({ sessionId: session.id });
    await waitFor(() =>
      events.slice(interruptStart).some(
        (entry) =>
          entry.event.turn_id === interrupt.turnId &&
          entry.event.kind === "turn.completed" &&
          entry.event.status === "interrupted",
      ),
    );

    const finalHistory = await adapter.readHistory({
      sessionId: session.id,
      limit: 100,
    });
    const completedAgents = await adapter.readAgents({ sessionId: session.id });
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          claudeVersion: auth.version,
          sessionId: session.id,
          workspace,
          historyMessages: finalHistory.messages.length,
          approvals: approvals.length,
          completedAgents: completedAgents.filter(
            (agent) => agent.status === "completed",
          ).length,
          checks: [
            "stream",
            "resume",
            "catalog",
            "history",
            "tool_approval",
            "question",
            "image",
            "agent",
            "interrupt",
          ],
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await adapter.close();
  }
}

async function runTurn(sessionId, content, expectedText, attachments = []) {
  const eventIndex = events.length;
  const result = await adapter.submitMessage({
    sessionId,
    requestId: `req_live_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    content,
    attachments,
  });
  await waitFor(() =>
    events.slice(eventIndex).some(
      (entry) =>
        entry.event.turn_id === result.turnId &&
        ["turn.completed", "turn.failed"].includes(entry.event.kind),
    ),
  );
  const turnEvents = events.slice(eventIndex).filter(
    (entry) => entry.event.turn_id === result.turnId,
  );
  const failed = turnEvents.find((entry) => entry.event.kind === "turn.failed");
  assert.equal(failed, undefined, failed?.event.error || "the Claude turn failed");
  assert.ok(
    turnEvents.some(
      (entry) =>
        entry.event.kind === "message.completed" &&
        entry.event.text.includes(expectedText),
    ),
    `the Claude turn did not produce ${expectedText}`,
  );
}

async function assertSafeApproval(approval) {
  assert.equal(
    await realpath(resolve(approval.action.cwd)),
    await realpath(resolve(workspace)),
    "refusing a live approval outside the temporary workspace",
  );
  assert.doesNotMatch(
    approval.action.display,
    /\b(?:rm|sudo|shutdown|reboot|curl|wget|ssh|scp)\b/i,
    "refusing a destructive or network-capable live approval",
  );
}

async function waitFor(predicate) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for Claude Code.`);
}

async function claudeAuthStatus() {
  const [{ stdout: authOutput }, { stdout: versionOutput }] = await Promise.all([
    execFileAsync(claudeBin, ["auth", "status"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024,
    }).catch((error) => {
      if (typeof error?.stdout === "string" && error.stdout.trim()) {
        return { stdout: error.stdout };
      }
      throw error;
    }),
    execFileAsync(claudeBin, ["--version"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024,
    }),
  ]);
  const status = JSON.parse(authOutput);
  return {
    loggedIn: status.loggedIn === true,
    version: versionOutput.trim(),
  };
}
