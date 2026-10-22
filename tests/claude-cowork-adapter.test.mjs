import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ClaudeCoworkAdapter,
  readCoworkHostCredentials,
  readCoworkProjects,
  readCoworkSessionCatalog,
} from "../relay/claude-cowork-adapter.mjs";

const fixture = new URL("./fixtures/fake-claude-code.mjs", import.meta.url)
  .pathname;
const sessionId = "local_0a94b8a8-4691-459b-9c5b-20194eafc2f9";
const cliSessionId = "7447ef2e-7110-4e57-9be6-1d0940a7c1ad";

test("Cowork catalog maps local sessions to CLI transcripts and real selected folders", async () => {
  const root = await mkdtemp(join(tmpdir(), "relayune-cowork-catalog-"));
  const coworkRoot = join(root, "Claude-3p", "local-agent-mode-sessions");
  const account = join(coworkRoot, "account-a", "org-a");
  try {
    await createCoworkSession(account, {
      sessionId,
      cliSessionId,
      title: "Web game planning",
      model: "anthropic/claude-sonnet-4.6",
      folder: "/workspace/game",
      spaceId: "space-game",
    });
    await createCoworkSession(account, {
      sessionId: "local_25cd6d64-79b1-49e7-a1e0-7b7ee85fe656",
      cliSessionId: "9c1470f6-9949-40d2-8b18-b381dd2dd59c",
      title: "Model peer",
      model: "anthropic/claude-opus-4.8",
      folder: "/workspace/game",
      spaceId: "space-game",
    });
    await writeFile(
      join(account, "spaces.json"),
      JSON.stringify({
        spaces: [{
          id: "space-game",
          name: "Game",
          folders: [{ path: "/workspace/space-fallback" }],
          updatedAt: 1_788_000_000_000,
        }],
      }),
    );

    const catalog = await readCoworkSessionCatalog({ coworkRoots: [coworkRoot] });
    assert.equal(catalog.length, 2);
    const session = catalog.find((candidate) => candidate.sessionId === sessionId);
    assert.equal(session.cliSessionId, cliSessionId);
    assert.equal(session.cwd, "/workspace/game");
    assert.doesNotMatch(session.cwd, /outputs/);
    assert.equal(session.userDataRoot, join(root, "Claude-3p"));
    assert.deepEqual(session.availableModels, [
      "anthropic/claude-opus-4.8",
      "anthropic/claude-sonnet-4.6",
    ]);

    const projects = await readCoworkProjects({ coworkRoots: [coworkRoot] });
    assert.deepEqual(projects.map(({ name, cwd }) => ({ name, cwd })), [
      { name: "Game", cwd: "/workspace/space-fallback" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Cowork history and usage retain their distinct provider", async () => {
  const metadata = runtimeMetadata();
  const adapter = new ClaudeCoworkAdapter({
    claudeBin: process.execPath,
    claudeArgs: [fixture],
    catalogReader: async () => [metadata],
    historyReader: async () => ({
      messages: [{
        id: "message-1",
        role: "codex",
        content: "done",
        created_at: new Date().toISOString(),
        provider: "claude",
      }],
      agents: [{ id: "agent-1", provider: "claude" }],
    }),
  });
  const history = await adapter.readHistory({ sessionId, limit: 10 });
  assert.equal(history.messages[0].provider, "claude-cowork");
  assert.equal(history.sessions[0].provider, "claude-cowork");
  assert.equal(history.agents[0].provider, "claude-cowork");
  assert.deepEqual(await adapter.readUsage(), {});
});

test("Cowork resume uses CLI UUID, in-memory model and actual permission mode", async () => {
  const events = [];
  const approvals = [];
  let spawnedEnvironment = null;
  const metadata = runtimeMetadata();
  const adapter = new ClaudeCoworkAdapter({
    claudeBin: process.execPath,
    claudeArgs: [fixture],
    catalogReader: async () => [metadata],
    processEnvironment: {
      PATH: process.env.PATH,
      ANTHROPIC_API_KEY: "unrelated-relay-gateway-key",
      ANTHROPIC_AUTH_TOKEN: "unrelated-relay-gateway-token",
      ANTHROPIC_BASE_URL: "https://unrelated.example.test",
      CLAUDE_CODE_HOST_AUTH_ENV_VAR: "ANTHROPIC_API_KEY",
    },
    spawnProcess: (command, args, options) => {
      if (!args.includes("--version")) spawnedEnvironment = options.env;
      return spawn(command, args, options);
    },
    hostCredentialsReader: async () => ({
      env: {
        CLAUDE_CODE_HOST_AUTH_ENV_VAR: "ANTHROPIC_AUTH_TOKEN",
        ANTHROPIC_AUTH_TOKEN: "cowork-fixture-only",
      },
    }),
    sessionProcessInspector: async () => "idle",
  });
  await adapter.start({
    emitEvent: async (relaySessionId, event) =>
      events.push({ relaySessionId, event }),
    requestApproval: async (approval) => approvals.push(approval),
  });
  try {
    const sessions = await adapter.listSessions();
    assert.equal(sessions[0].id, sessionId);
    assert.equal(sessions[0].provider, "claude-cowork");
    assert.deepEqual(
      sessions[0].session_config_options.find((option) => option.id === "model")
        .options.map((option) => option.value),
      metadata.availableModels,
    );
    await adapter.configureSession({
      sessionId,
      configId: "model",
      value: "anthropic/claude-opus-4.8",
    });
    const configured = await adapter.configureSession({
      sessionId,
      configId: "mode",
      value: "acceptEdits",
    });
    assert.equal(
      configured.configOptions.find((option) => option.id === "mode").currentValue,
      "acceptEdits",
    );

    await adapter.submitMessage({
      sessionId,
      requestId: "request-wire",
      content: "wire mapping",
    });
    await waitFor(() => events.some(({ event }) => event.kind === "message.completed"));
    const message = events.find(({ event }) => event.kind === "message.completed");
    assert.equal(message.relaySessionId, sessionId);
    assert.equal(message.event.provider, "claude-cowork");
    assert.equal(
      message.event.text,
      `${cliSessionId}|${cliSessionId}|anthropic/claude-opus-4.8|acceptEdits`,
    );
    assert.equal(spawnedEnvironment.ANTHROPIC_AUTH_TOKEN, "cowork-fixture-only");
    assert.equal(Object.hasOwn(spawnedEnvironment, "ANTHROPIC_API_KEY"), false);
    assert.equal(Object.hasOwn(spawnedEnvironment, "ANTHROPIC_BASE_URL"), false);
    assert.equal(
      spawnedEnvironment.CLAUDE_CODE_HOST_AUTH_ENV_VAR,
      "ANTHROPIC_AUTH_TOKEN",
    );

    await adapter.submitMessage({
      sessionId,
      requestId: "request-approval",
      content: "approval",
    });
    await waitFor(() => approvals.length === 1);
    assert.match(approvals[0].approval_id, /^apr_claude_cowork_/);
    assert.equal(approvals[0].session_id, sessionId);
    await adapter.resolveApproval({
      approvalId: approvals[0].approval_id,
      decision: "rejected",
    });
    await waitFor(() => events.filter(({ event }) => event.kind === "turn.completed").length === 2);
  } finally {
    await adapter.close();
  }
});

test("Cowork submit reserves a session before asynchronous discovery", async () => {
  let releaseCatalog;
  const catalogReady = new Promise((resolve) => { releaseCatalog = resolve; });
  const adapter = new ClaudeCoworkAdapter({
    claudeBin: process.execPath,
    claudeArgs: [fixture],
    catalogReader: async () => {
      await catalogReady;
      return [runtimeMetadata()];
    },
    hostCredentialsReader: async () => ({ env: {} }),
    sessionProcessInspector: async () => "idle",
  });
  await adapter.start({ emitEvent: async () => {}, requestApproval: async () => {} });
  try {
    const first = adapter.submitMessage({
      sessionId,
      requestId: "first",
      content: "wire mapping",
    });
    await assert.rejects(
      adapter.submitMessage({
        sessionId,
        requestId: "second",
        content: "wire mapping",
      }),
      /already working/,
    );
    releaseCatalog();
    await first;
  } finally {
    releaseCatalog();
    await adapter.close();
  }
});

test("Cowork takeover fails closed when Desktop session idleness is unknown", async () => {
  let credentialsRead = false;
  const adapter = new ClaudeCoworkAdapter({
    claudeBin: process.execPath,
    claudeArgs: [fixture],
    catalogReader: async () => [runtimeMetadata()],
    hostCredentialsReader: async () => {
      credentialsRead = true;
      return { env: {} };
    },
    sessionProcessInspector: async () => "unknown",
  });
  await adapter.start({ emitEvent: async () => {}, requestApproval: async () => {} });
  try {
    await assert.rejects(
      adapter.submitMessage({
        sessionId,
        requestId: "unknown-idle",
        content: "wire mapping",
      }),
      /could not verify.*idle/,
    );
    assert.equal(credentialsRead, false);
  } finally {
    await adapter.close();
  }
});

test("closing Cowork while transient credentials are loading never spawns Claude", async () => {
  let releaseCredentials;
  const credentialsReady = new Promise((resolve) => {
    releaseCredentials = resolve;
  });
  let runtimeSpawns = 0;
  const adapter = new ClaudeCoworkAdapter({
    claudeBin: process.execPath,
    claudeArgs: [fixture],
    catalogReader: async () => [runtimeMetadata()],
    sessionProcessInspector: async () => "idle",
    hostCredentialsReader: async () => {
      await credentialsReady;
      return { env: {} };
    },
    spawnProcess: (command, args, options) => {
      if (!args.includes("--version")) runtimeSpawns += 1;
      return spawn(command, args, options);
    },
  });
  await adapter.start({ emitEvent: async () => {}, requestApproval: async () => {} });
  const submission = adapter.submitMessage({
    sessionId,
    requestId: "close-during-creds",
    content: "wire mapping",
  });
  await waitFor(() => adapter.activeTurns.has(sessionId));
  await adapter.close();
  releaseCredentials();
  await assert.rejects(submission, /adapter is closed/);
  assert.equal(runtimeSpawns, 0);
});

test("Cowork host credentials require private mode, live PID, matching start and expiry", async () => {
  const root = await mkdtemp(join(tmpdir(), "relayune-cowork-creds-"));
  const path = join(root, "host-creds-fixture.json");
  const record = {
    env: {
      ANTHROPIC_API_KEY: "fixture-key",
      ANTHROPIC_AUTH_TOKEN: "fixture-token",
      CLAUDE_CODE_HOST_AUTH_ENV_VAR: "ANTHROPIC_AUTH_TOKEN",
      ANTHROPIC_BASE_URL: "https://api.example.test",
    },
    expiresAt: Date.now() + 60_000,
    pid: 4242,
    procStart: 1_788_000_000_000,
  };
  try {
    await writeFile(path, JSON.stringify(record), { mode: 0o600 });
    await chmod(path, 0o600);
    const credentials = await readCoworkHostCredentials({
      userDataRoot: root,
      processInspector: async (identity) => {
        assert.deepEqual(identity, { pid: record.pid, procStart: record.procStart });
        return true;
      },
    });
    assert.deepEqual(Object.keys(credentials.env).sort(), Object.keys(record.env).sort());

    await chmod(path, 0o644);
    await assert.rejects(
      readCoworkHostCredentials({
        userDataRoot: root,
        processInspector: async () => true,
      }),
      /authorization is unavailable or expired/,
    );

    record.env.CLAUDE_CODE_HOST_AUTH_ENV_VAR = "NODE_OPTIONS";
    record.env.NODE_OPTIONS = "--inspect";
    await writeFile(path, JSON.stringify(record), { mode: 0o600 });
    await chmod(path, 0o600);
    await assert.rejects(
      readCoworkHostCredentials({
        userDataRoot: root,
        processInspector: async () => true,
      }),
      /authorization is unavailable or expired/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function runtimeMetadata() {
  return {
    sessionId,
    cliSessionId,
    cwd: process.cwd(),
    title: "Cowork fixture",
    updatedAt: new Date().toISOString(),
    transcriptPath: "/fixture/transcript.jsonl",
    persisted: true,
    model: "anthropic/claude-sonnet-4.6",
    permissionMode: "manual",
    availableModels: [
      "anthropic/claude-sonnet-4.6",
      "anthropic/claude-opus-4.8",
    ],
    usageDaily: [{ date: "2026-09-05", total_tokens: 42 }],
    userSelectedFolders: [process.cwd()],
    processName: "cowork-fixture-session",
    claudeHome: "/fixture/.claude",
    userDataRoot: "/fixture/user-data",
  };
}

async function createCoworkSession(account, options) {
  const transcriptDirectory = join(
    account,
    options.sessionId,
    ".claude",
    "projects",
    "-cowork-outputs",
  );
  await mkdir(transcriptDirectory, { recursive: true });
  await writeFile(
    join(account, `${options.sessionId}.json`),
    JSON.stringify({
      sessionId: options.sessionId,
      cliSessionId: options.cliSessionId,
      title: options.title,
      model: options.model,
      cwd: join(account, options.sessionId, "outputs"),
      userSelectedFolders: [options.folder],
      spaceId: options.spaceId,
      processName: `process-${options.sessionId.slice(-8)}`,
      createdAt: 1_788_000_000_000,
      lastActivityAt: 1_788_000_001_000,
    }),
  );
  await writeFile(
    join(transcriptDirectory, `${options.cliSessionId}.jsonl`),
    `${JSON.stringify({
      type: "user",
      sessionId: options.cliSessionId,
      cwd: join(account, options.sessionId, "outputs"),
      timestamp: "2026-09-05T00:00:00.000Z",
      message: { role: "user", content: options.title },
    })}\n`,
  );
}

async function waitFor(predicate, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for Cowork adapter state.");
}
