import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ClaudeCodeAdapter,
  readClaudeSessionCatalog,
  readClaudeTranscript,
  readClaudeModels,
} from "../relay/claude-adapter.mjs";

const fixture = new URL("./fixtures/fake-claude-code.mjs", import.meta.url)
  .pathname;

test("Claude model discovery exports only native model metadata without a user turn", async () => {
  const models = await readClaudeModels({ command: process.execPath, args: [fixture], cwd: process.cwd() });
  assert.deepEqual(models.map((model) => model.value), ["default", "sonnet", "haiku"]);
  assert.deepEqual(models[1].supportedEffortLevels, ["low", "high"]);
  assert.ok(!JSON.stringify(models).includes("never-export"));
});

test("[MOB-PRJ-017][server] Claude settings survive catalog refresh, remain session scoped, and apply on the next resume", async () => {
  const adapter = new ClaudeCodeAdapter({
    claudeBin: process.execPath, claudeArgs: [fixture], catalogReader: async () => [],
  });
  try {
    const session = await adapter.createSession({ cwd: process.cwd(), name: "Model settings" });
    const peer = await adapter.createSession({ cwd: process.cwd(), name: "Peer" });
    await adapter.configureSession({ sessionId: session.id, configId: "model", value: "sonnet" });
    await adapter.configureSession({ sessionId: session.id, configId: "reasoning", value: "high" });
    adapter.rememberSession({ sessionId: session.id, model: "old-transcript-model" });
    assert.equal((await adapter.listSessions()).find((item) => item.id === session.id).model, "sonnet");
    const metadata = adapter.sessionMetadata.get(session.id);
    assert.deepEqual((await adapter.turnRuntime(metadata)).extraArgs, ["--model", "sonnet", "--effort", "high"]);
    assert.deepEqual((await adapter.turnRuntime(adapter.sessionMetadata.get(peer.id))).extraArgs, []);
    for (const args of [{configId: "model", value: "invented"}, {configId: "reasoning", value: "max"}]) {
      await assert.rejects(adapter.configureSession({ sessionId: session.id, ...args }), /did not advertise/);
    }
    adapter.startingSessions.add(session.id);
    await assert.rejects(adapter.configureSession({ sessionId: session.id, configId: "model", value: "haiku" }), /running/);
    adapter.startingSessions.delete(session.id);
    const result = await adapter.configureSession({ sessionId: session.id, configId: "model", value: "haiku" });
    assert.equal(result.configOptions.length, 2);
    assert.deepEqual((await adapter.turnRuntime(metadata)).extraArgs, ["--model", "haiku"]);
  } finally { await adapter.close(); }
});

test("Claude discovery failure leaves conversations readable without fabricated choices", async () => {
  const adapter = new ClaudeCodeAdapter({
    modelCatalogReader: async () => { throw new Error("Unavailable"); },
    permissionModesReader: async () => [],
    catalogReader: async () => [],
  });
  const session = await adapter.createSession({ cwd: process.cwd() });
  assert.deepEqual(session.session_config_options.map(option => option.id), ["permissions"]);
  assert.deepEqual((await adapter.readHistory({ sessionId: session.id })).messages, []);
  await assert.rejects(adapter.configureSession({ sessionId: session.id, configId: "model", value: "sonnet" }), /did not advertise/);
  await adapter.close();
});

function localDate(timestamp) {
  const date = new Date(timestamp);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

test("Claude adapter streams a turn and closes remote approval through stdio", async () => {
  const events = [];
  const approvals = [];
  const adapter = new ClaudeCodeAdapter({
    claudeBin: process.execPath,
    claudeArgs: [fixture],
    workspace: process.cwd(),
    catalogReader: async () => [],
  });
  await adapter.start({
    emitEvent: async (sessionId, event, extra) =>
      events.push({ sessionId, event, extra }),
    requestApproval: async (approval) => approvals.push(approval),
  });

  try {
    const session = await adapter.createSession({
      cwd: process.cwd(),
      name: "Claude approval",
    });
    assert.equal(session.provider, "claude");
    assert.equal(session.supports_steering, false);

    const started = await adapter.submitMessage({
      sessionId: session.id,
      requestId: "req_claude_1",
      content: "approval",
    });
    assert.match(started.turnId, /^turn_claude_/);
    await waitFor(() => approvals.length === 1);
    assert.equal(approvals[0].source_agent_name, "Claude 主会话");
    assert.equal(approvals[0].action.type, "command.execute");
    assert.match(approvals[0].action.display, /npm test/);
    assert.match(approvals[0].action.command_hash, /^sha256:/);

    await adapter.resolveApproval({
      approvalId: approvals[0].approval_id,
      decision: "approved",
    });
    await waitFor(() =>
      events.some((entry) => entry.event.kind === "turn.completed"),
    );
    assert.ok(
      events.some(
        (entry) =>
          entry.event.kind === "message.completed" &&
          entry.event.text === "已完成" &&
          entry.event.provider === "claude",
      ),
    );
    assert.ok(
      events.some(
        (entry) =>
          entry.event.kind === "command.output" &&
          entry.event.status === "completed",
      ),
    );
  } finally {
    await adapter.close();
  }
});

test("Claude adapter exposes native Agent tasks as Relayune subagents", async () => {
  const events = [];
  const adapter = new ClaudeCodeAdapter({
    claudeBin: process.execPath,
    claudeArgs: [fixture],
    workspace: process.cwd(),
    catalogReader: async () => [],
  });
  await adapter.start({
    emitEvent: async (sessionId, event, extra) =>
      events.push({ sessionId, event, extra }),
    requestApproval: async () => {},
  });
  try {
    const session = await adapter.createSession({
      cwd: process.cwd(),
      name: "Claude agents",
    });
    await adapter.submitMessage({
      sessionId: session.id,
      requestId: "req_claude_agents",
      content: "subagent",
    });
    await waitFor(() =>
      events.some((entry) => entry.event.kind === "agent.completed"),
    );
    const agent = events.find(
      (entry) => entry.event.kind === "agent.completed",
    );
    assert.equal(agent.event.provider, "claude");
    assert.equal(agent.event.role, "Explore");
    assert.equal(agent.event.summary, "Coverage reviewed");
    assert.equal(agent.event.can_open, false);
    assert.equal(agent.event.tool, "Task");
    const live = events.filter((entry) => entry.event.kind === "agent.updated" && entry.event.current_activity);
    assert.ok(live.some((entry) => entry.event.current_activity === "Bash: npm test"));
    assert.ok(live.some((entry) => entry.event.token_count === 1200));
    assert.equal(agent.event.tool_count, 1);
    assert.equal(agent.event.activity_log.length, 1);
    assert.equal(agent.event.activity_log[0].label, "Bash: npm test · completed");
    assert.ok(agent.event.started_at);
    const snapshot = await adapter.readAgents({ sessionId: session.id });
    assert.equal(snapshot[0].activity_log[0].label, "Bash: npm test · completed");

  } finally {
    await adapter.close();
  }
});

test("Claude result authentication failures surface an actionable local login instruction", async () => {
  const events = [];
  const adapter = new ClaudeCodeAdapter({
    claudeBin: process.execPath,
    claudeArgs: [fixture],
    workspace: process.cwd(),
    catalogReader: async () => [],
  });
  await adapter.start({
    emitEvent: async (sessionId, event) => events.push({ sessionId, event }),
    requestApproval: async () => {},
  });
  try {
    const session = await adapter.createSession({
      cwd: process.cwd(),
      name: "Claude auth failure",
    });
    await adapter.submitMessage({
      sessionId: session.id,
      requestId: "req_claude_auth_failure",
      content: "auth failure",
    });
    await waitFor(() =>
      events.some((entry) => entry.event.kind === "turn.failed"),
    );
    const failure = events.find((entry) => entry.event.kind === "turn.failed");
    assert.match(failure.event.error, /run `\/login`/);
    assert.doesNotMatch(failure.event.error, /claude auth login/);
  } finally {
    await adapter.close();
  }
});

test("Claude AskUserQuestion is answered through sequential encrypted approvals", async () => {
  const events = [];
  const approvals = [];
  const adapter = new ClaudeCodeAdapter({
    claudeBin: process.execPath,
    claudeArgs: [fixture],
    workspace: process.cwd(),
    catalogReader: async () => [],
  });
  await adapter.start({
    emitEvent: async (sessionId, event, extra) =>
      events.push({ sessionId, event, extra }),
    requestApproval: async (approval) => approvals.push(approval),
  });
  try {
    const session = await adapter.createSession({
      cwd: process.cwd(),
      name: "Claude questions",
    });
    await adapter.submitMessage({
      sessionId: session.id,
      requestId: "req_claude_question",
      content: "question",
    });
    await waitFor(() => approvals.length === 1);
    assert.equal(approvals[0].action.type, "question.select");
    assert.equal(approvals[0].action.display, "Which theme?");
    assert.deepEqual(
      approvals[0].action.options.map((option) => option.name),
      ["Dark", "Light"],
    );
    await adapter.resolveApproval({
      approvalId: approvals[0].approval_id,
      decision: "approved",
      optionId: approvals[0].action.options[0].option_id,
    });
    await waitFor(() => approvals.length === 2);
    assert.equal(approvals[1].action.display, "Which density?");
    await adapter.resolveApproval({
      approvalId: approvals[1].approval_id,
      decision: "approved",
      optionId: approvals[1].action.options[1].option_id,
    });
    await waitFor(() =>
      events.some(
        (entry) =>
          entry.event.kind === "message.completed" &&
          entry.event.text === "Dark/Comfortable",
      ),
    );
  } finally {
    await adapter.close();
  }
});

test("Claude questions accept free text and reject invalid answers without consuming the question", async () => {
  const events = [];
  const approvals = [];
  const adapter = new ClaudeCodeAdapter({
    claudeBin: process.execPath,
    claudeArgs: [fixture],
    workspace: process.cwd(),
    catalogReader: async () => [],
  });
  await adapter.start({
    emitEvent: async (sessionId, event, extra) =>
      events.push({ sessionId, event, extra }),
    requestApproval: async (approval) => approvals.push(approval),
  });
  try {
    const session = await adapter.createSession({
      cwd: process.cwd(),
      name: "Claude questions",
    });
    await adapter.submitMessage({
      sessionId: session.id,
      requestId: "req_claude_question",
      content: "question",
    });
    await waitFor(() => approvals.length === 1);
    assert.equal(approvals[0].action.type, "question.select");
    assert.equal(approvals[0].action.display, "Which theme?");
    assert.deepEqual(
      approvals[0].action.options.map((option) => option.name),
      ["Dark", "Light"],
    );
    assert.equal(approvals[0].action.allows_freeform, true);
    for (const answer of ["", " ", "x".repeat(4001), 42]) {
      await assert.rejects(adapter.resolveApproval({approvalId: approvals[0].approval_id,
        decision: "approved", answer}), /question selection is invalid/);
      assert.ok(adapter.pendingApprovals.has(approvals[0].approval_id));
    }
    await adapter.resolveApproval({approvalId: approvals[0].approval_id,
      decision: "approved", answer: "  QA_CUSTOM_5829  "});
    await waitFor(() => approvals.length === 2);
    assert.equal(approvals[1].action.display, "Which density?");
    await adapter.resolveApproval({
      approvalId: approvals[1].approval_id,
      decision: "approved",
      optionId: approvals[1].action.options[1].option_id,
    });
    await waitFor(() =>
      events.some(
        (entry) =>
          entry.event.kind === "message.completed" &&
          entry.event.text === "QA_CUSTOM_5829/Comfortable",
      ),
    );
  } finally {
    await adapter.close();
  }
});

test("Claude local transcripts provide catalog, history, attachments, and agents", async () => {
  const home = await mkdtemp(join(tmpdir(), "relayune-claude-"));
  const projectDirectory = join(home, "projects", "-workspace-project");
  await mkdir(projectDirectory, { recursive: true });
  const sessionId = "550e8400-e29b-41d4-a716-446655440000";
  const transcriptPath = join(projectDirectory, `${sessionId}.jsonl`);
  const records = [
    {
      type: "user",
      uuid: "user_1",
      sessionId,
      cwd: "/workspace/project",
      timestamp: "2026-08-27T08:00:00.000Z",
      message: {
        role: "user",
        content: [
          { type: "text", text: "检查登录流程" },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" },
          },
        ],
      },
    },
    {
      type: "assistant",
      uuid: "assistant_tool",
      sessionId,
      cwd: "/workspace/project",
      timestamp: "2026-08-27T08:00:01.000Z",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [
          {
            type: "tool_use",
            id: "toolu_agent_history",
            name: "Agent",
            input: { description: "检查测试", prompt: "检查登录测试", subagent_type: "Explore" },
          },
        ],
      },
    },
    {
      type: "user",
      uuid: "tool_result_1",
      sessionId,
      cwd: "/workspace/project",
      timestamp: "2026-08-27T08:00:02.000Z",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_agent_history", content: "测试完整" },
        ],
      },
    },
    {
      type: "assistant",
      uuid: "assistant_1",
      sessionId,
      cwd: "/workspace/project",
      timestamp: "2026-08-27T08:00:03.000Z",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "登录流程正常。" }],
      },
    },
  ];
  await writeFile(
    transcriptPath,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );

  const catalog = await readClaudeSessionCatalog({ claudeHome: home });
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].sessionId, sessionId);
  assert.equal(catalog[0].title, "检查登录流程");
  assert.equal(catalog[0].model, "claude-sonnet-4-6");

  const replay = await readClaudeTranscript({ sessionId, transcriptPath });
  assert.deepEqual(
    replay.messages.map((message) => [message.role, message.content]),
    [
      ["user", "检查登录流程"],
      ["codex", "登录流程正常。"],
    ],
  );
  assert.equal(replay.messages[0].attachments.length, 1);
  assert.match(
    replay.messages[0].attachments[0].relay_source.url,
    /^data:image\/png;base64,/,
  );
  assert.equal(replay.agents[0].status, "completed");
  assert.equal(replay.agents[0].summary, "测试完整");
});

test("Claude local usage deduplicates message ids and includes subagent cache tokens", async () => {
  const home = await mkdtemp(join(tmpdir(), "relayune-claude-usage-"));
  const projectDirectory = join(home, "projects", "-workspace-usage");
  const sessionId = "650e8400-e29b-41d4-a716-446655440000";
  const transcriptPath = join(projectDirectory, `${sessionId}.jsonl`);
  const subagents = join(projectDirectory, sessionId, "subagents");
  const now = Date.parse("2026-09-02T12:00:00.000Z");
  const previous = now - 24 * 60 * 60_000;
  await mkdir(subagents, { recursive: true });
  const assistant = (id, timestamp, usage) => ({
    type: "assistant",
    sessionId,
    cwd: "/workspace/usage",
    timestamp: new Date(timestamp).toISOString(),
    message: {
      id,
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "usage fixture" }],
      usage,
    },
  });
  const rootRecords = [
    {
      type: "user",
      sessionId,
      cwd: "/workspace/usage",
      timestamp: new Date(now).toISOString(),
      message: { role: "user", content: "Measure local usage" },
    },
    assistant("msg_root", now, {
      input_tokens: 10,
      cache_creation_input_tokens: 20,
      cache_read_input_tokens: 30,
      output_tokens: 40,
    }),
    assistant("msg_root", now + 1000, {
      input_tokens: 11,
      cache_creation_input_tokens: 18,
      cache_read_input_tokens: 31,
      output_tokens: 39,
    }),
    assistant("msg_previous", previous, {
      input_tokens: 5,
      cache_creation_input_tokens: 5,
      cache_read_input_tokens: 5,
      output_tokens: 5,
    }),
    assistant("", now, {
      input_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
    }),
    assistant("msg_invalid", now, {
      input_tokens: "12",
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
    }),
  ];
  await writeFile(
    transcriptPath,
    `${rootRecords.map(JSON.stringify).join("\n")}\n`,
  );
  await writeFile(
    join(subagents, "agent-1.jsonl"),
    `${JSON.stringify(
      assistant("msg_subagent", now, {
        input_tokens: 1,
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: 3,
        output_tokens: 4,
      }),
    )}\n`,
  );

  try {
    const catalog = await readClaudeSessionCatalog({ claudeHome: home });
    const expected = [
      { date: localDate(previous), total_tokens: 20 },
      { date: localDate(now), total_tokens: 112 },
    ].sort((left, right) => left.date.localeCompare(right.date));
    assert.deepEqual(catalog[0].usageDaily, expected);

    const adapter = new ClaudeCodeAdapter({
      catalogReader: async () => catalog,
    });
    const usage = await adapter.readUsage();
    assert.ok(Number.isFinite(Date.parse(usage.claude.as_of)));
    assert.deepEqual({
      source: usage.claude.source,
      complete: usage.claude.complete,
      daily: usage.claude.daily,
    }, {
      source: "local_transcripts",
      complete: false,
      daily: expected,
    });
    await adapter.close();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

async function waitFor(predicate, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for Claude adapter state.");
}


test('background agent launch stays running until its own terminal notification', async (t) => {
  const adapter = new ClaudeCodeAdapter({ catalogReader: async () => [] });
  const events = [];
  adapter.handlers = { emitEvent: async (_session, event) => events.push(event) };
  const connection = { agents: new Map(), activeTools: new Map(), model: 'parent-model', turnId: 'turn', close() {} };
  adapter.processes.set('root', connection);
  t.after(() => adapter.close());
  await adapter.handleTurnMessage('root', { type: 'assistant', message: { content: [
    { type: 'tool_use', id: 'call-child', name: 'Agent', input: { prompt: 'Research', run_in_background: true } },
  ] } }, connection);
  await adapter.handleTurnMessage('root', { type: 'system', subtype: 'task_started', task_id: 'task-child', tool_use_id: 'call-child' }, connection);
  await adapter.handleTurnMessage('root', { type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'call-child', content: 'Background task launched' },
  ] } }, connection);
  assert.equal(connection.agents.get('call-child').status, 'running');
  assert.equal(connection.agents.get('call-child').model, null, 'parent model is not proof of child model');
  await adapter.handleTurnMessage('root', { type: 'system', subtype: 'task_notification', task_id: 'unrelated-bash', status: 'failed' }, connection);
  assert.equal(connection.agents.get('call-child').status, 'running');
  await adapter.handleTurnMessage('root', { type: 'assistant', parent_tool_use_id: 'call-child',
    message: { model: 'child-model', content: [{ type: 'text', text: 'Found two references' }] } }, connection);
  assert.equal(connection.agents.get('call-child').summary, 'Found two references');
  assert.equal(connection.agents.get('call-child').model, 'child-model');
  for (const [native, normalized] of [['completed', 'completed'], ['failed', 'errored'], ['stopped', 'interrupted']]) {
    await adapter.handleTurnMessage('root', { type: 'system', subtype: 'task_notification', task_id: 'task-child',
      status: native, summary: 'Final result', usage: { total_tokens: 500, tool_uses: 3 } }, connection);
    assert.equal(connection.agents.get('call-child').status, normalized);
    assert.equal(events.at(-1).token_count, 500);
    assert.equal(events.at(-1).summary, 'Final result');
  }
});

test('Claude input identity survives transcript replay and separates identical repeated prompts', async () => {
  const {spawn} = await import('node:child_process');
  const inputs = [];
  const adapter = new ClaudeCodeAdapter({
    claudeBin: process.execPath, claudeArgs: [fixture], catalogReader: async () => [],
    spawnProcess: (...args) => {
      const child = spawn(...args);
      if (child.stdin) {
        const write = child.stdin.write.bind(child.stdin);
        child.stdin.write = (data, ...rest) => { inputs.push(String(data)); return write(data, ...rest); };
      }
      return child;
    },
  });
  const home = await mkdtemp(join(tmpdir(), 'relayune-message-identity-'));
  try {
    await adapter.start({emitEvent: async () => {}, requestApproval: async () => {}});
    const session = await adapter.createSession({cwd: home});
    const options = {sessionId: session.id, requestId: 'req_identity_first', content: 'Repeated prompt'};
    const id = await adapter.userMessageId(options);
    assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.equal(await adapter.userMessageId(options), id);
    assert.notEqual(await adapter.userMessageId({...options, requestId:'req_identity_second'}), id);
    const submitted = await adapter.submitMessage(options);
    const input = inputs.map(line => JSON.parse(line)).find(message => message.type === 'user');
    assert.equal(input.uuid, id);
    const transcriptPath = join(home, 'transcript.jsonl');
    await writeFile(transcriptPath, JSON.stringify({...input, timestamp:'2026-09-09T00:00:00Z'})+'\n');
    const history = await readClaudeTranscript({sessionId:session.id, transcriptPath});
    assert.equal(history.messages[0].id, id);
    assert.equal(history.messages[0].turn_id, submitted.turnId);
    const secondId = await adapter.userMessageId({...options, requestId:'req_identity_second'});
    await writeFile(transcriptPath, [
      {...input, timestamp:'2026-09-09T00:00:00Z'},
      {type:'assistant',uuid:'a1',parentUuid:id,message:{content:[{type:'text',text:'same reply'}]}},
      {type:'user',uuid:'tool-result',parentUuid:'a1',message:{content:[{type:'tool_result',tool_use_id:'tool',content:'ok'}]}},
      {type:'assistant',uuid:'a2',parentUuid:'tool-result',message:{content:[{type:'text',text:'done'}]}},
      {...input,uuid:secondId,timestamp:'2026-09-09T00:01:00Z'},
      {type:'assistant',uuid:'a3',parentUuid:secondId,message:{content:[{type:'text',text:'same reply'}]}},
    ].map(row=>JSON.stringify(row)).join('\n'));
    const replay = await readClaudeTranscript({sessionId:session.id,transcriptPath});
    assert.deepEqual(replay.messages.map(message=>message.turn_id), [submitted.turnId,submitted.turnId,submitted.turnId,`turn_claude_${secondId}`,`turn_claude_${secondId}`]);
  } finally { await adapter.close(); await rm(home, {recursive:true, force:true}); }
});


test("stopping Claude expires only that connection's pending questions before completion", async () => {
  const adapter = new ClaudeCodeAdapter({catalogReader: async () => []});
  const events = [];
  const stopped = {interrupt() {this.interrupted = true;}};
  const peer = {interrupt() {throw new Error("peer must not stop");}};
  adapter.handlers = {emitEvent: async (sessionId,event) => events.push({sessionId,...event})};
  adapter.processes.set("stop-session",stopped);
  adapter.processes.set("peer-session",peer);
  adapter.activeTurns.set("stop-session","stop-turn");
  adapter.activeTurns.set("peer-session","peer-turn");
  adapter.pendingApprovals.set("stop-question",{connection:stopped});
  adapter.pendingApprovals.set("peer-question",{connection:peer});
  await adapter.interruptTurn({sessionId:"stop-session"});
  assert.equal(stopped.interrupted,true);
  assert.equal(adapter.pendingApprovals.has("stop-question"),false);
  assert.equal(adapter.pendingApprovals.has("peer-question"),true);
  assert.equal(adapter.activeTurns.get("peer-session"),"peer-turn");
  assert.deepEqual(events.map(e => [e.sessionId,e.kind,e.approval_id,e.decision]),[
    ["stop-session","approval.resolved","stop-question","expired"],
    ["stop-session","turn.completed",undefined,undefined],
  ]);
});

test('history restores background agent terminal results instead of launch metadata', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'claude-background-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const transcriptPath = join(directory, 'root.jsonl');
  const records = ['cedar', 'maple'].flatMap((id) => [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Agent', input: { prompt: id, run_in_background: true } }] } },
    { type: 'user', toolUseResult: { status: 'async_launched' }, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'Async agent launched successfully. Internal metadata.' }] } },
  ]);
  const write = () => writeFile(transcriptPath, records.map(record => JSON.stringify(record)).join('\n'));
  await write();
  let replay = await readClaudeTranscript({sessionId:'root', transcriptPath});
  assert.deepEqual(replay.agents.map(agent => agent.status), ['running', 'running']);
  assert.deepEqual(replay.agents.map(agent => agent.summary), [null, null]);
  for (const [id, status, result] of [['cedar','completed','CEDAR_RESULT'], ['maple','failed','MAPLE_ERROR']]) {
    records.push({ type: 'attachment', attachment: { type: 'queued_command', commandMode: 'task-notification', prompt: `<task-notification>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n<result>${result}</result>\n</task-notification>` } });
  }
  records.push({ type:'attachment', attachment:{type:'queued_command',commandMode:'task-notification',prompt:'<task-notification><tool-use-id>unrelated</tool-use-id><status>completed</status><result>NO</result></task-notification>'} });
  await write();
  replay = await readClaudeTranscript({sessionId:'root', transcriptPath});
  assert.deepEqual(replay.agents.map(agent => [agent.status,agent.summary]), [['completed','CEDAR_RESULT'], ['errored','MAPLE_ERROR']]);
  assert.equal(replay.messages.length, 0);
});

test('Claude tool images are retained in live output and transcript replay', async t => {
  const image = {type:'image', source:{type:'base64',media_type:'image/png',data:'aGVsbG8='}};
  const events=[];
  const adapter=new ClaudeCodeAdapter({});
  adapter.handlers={emitEvent:async (sid,event)=>events.push(event)};
  await adapter.handleToolResults('s',{message:{content:[{type:'tool_result',tool_use_id:'read-image',content:[image]}]}},{turnId:'t',activeTools:new Map([['read-image',{name:'Read',input:{file_path:'fixture.png'}}]]),agents:new Map()});
  assert.equal(events[0].attachments?.[0]?.mime_type,'image/png');
  const dir=await mkdtemp(join(tmpdir(),'claude-tool-image-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const transcriptPath=join(dir,'s.jsonl');
  await writeFile(transcriptPath,[
    {type:'user',uuid:'u',timestamp:'2026-09-12T00:00:00Z',message:{content:'Read fixture'}},
    {type:'assistant',uuid:'a',parentUuid:'u',timestamp:'2026-09-12T00:00:01Z',message:{content:[{type:'tool_use',id:'read-image',name:'Read',input:{file_path:'fixture.png'}}]}},
    {type:'user',uuid:'r',parentUuid:'a',timestamp:'2026-09-12T00:00:02Z',message:{content:[{type:'tool_result',tool_use_id:'read-image',content:[image]}]}}
  ].map(JSON.stringify).join('\n'));
  const history=await readClaudeTranscript({sessionId:'s',transcriptPath});
  const output=history.messages.find(m=>m.attachments?.length);
  assert.equal(output?.role,'codex');
  assert.equal(output?.attachments[0].id,events[0].attachments[0].id);
  assert.equal(output?.turn_id,'turn_claude_u');
});
