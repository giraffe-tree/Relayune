import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexAppServerAdapter } from "../relay/codex-adapters.mjs";

function createAdapter() {
  const adapter = new CodexAppServerAdapter({ workspace: "/relay-workspace" });
  adapter.handlers = { emitEvent: async () => {} };
  return adapter;
}

test("Codex history retries transient reads without duplicating the page", async () => {
  const adapter = createAdapter();
  let reads = 0;
  adapter.request = async (method, params) => {
    if (method === "thread/read") {
      reads += 1;
      if (reads < 3) throw new Error("rollout is still loading");
      return {
        thread: {
          id: "thread_cold_history",
          cwd: "/tmp/project-cold-history",
          status: { type: "idle" },
          turns: [
            {
              id: "turn_cold_history",
              status: "completed",
              items: [
                {
                  id: "cold_message",
                  type: "agentMessage",
                  text: "冷历史读取完成",
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

  const page = await adapter.readHistory({ sessionId: "thread_cold_history" });

  assert.equal(reads, 3);
  assert.deepEqual(page.messages.map((message) => message.content), [
    "冷历史读取完成",
  ]);
});

test("optional descendant failure does not hide the main Codex history", async () => {
  const adapter = createAdapter();
  adapter.request = async (method, params) => {
    if (method === "thread/read") {
      return {
        thread: {
          id: "thread_parent_history",
          cwd: "/tmp/project-parent-history",
          status: { type: "idle" },
          turns: [
            {
              id: "turn_parent_history",
              status: "completed",
              items: [
                {
                  id: "parent_message",
                  type: "agentMessage",
                  text: "主会话仍可读取",
                },
              ],
            },
          ],
        },
      };
    }
    if (method === "thread/list" && params.ancestorThreadId) {
      throw new Error("descendant catalog unavailable");
    }
    throw new Error(`Unexpected Codex request: ${method}`);
  };

  const page = await adapter.readHistory({
    sessionId: "thread_parent_history",
  });

  assert.deepEqual(page.messages.map((message) => message.content), [
    "主会话仍可读取",
  ]);
  assert.deepEqual(page.agents, []);
  assert.deepEqual(page.sessions, []);
});

test("Codex history reads rollout-shaped final answer content", async () => {
  const adapter = createAdapter();
  adapter.request = async (method, params) => {
    if (method === "thread/read") {
      return {
        thread: {
          id: "thread_rollout_history",
          cwd: "/tmp/project-rollout-history",
          status: { type: "idle" },
          turns: [
            {
              id: "turn_rollout_history",
              status: "completed",
              items: [
                {
                  id: "rollout_final",
                  type: "AgentMessage",
                  phase: "final_answer",
                  content: [{ type: "Text", text: "红框内的最终总结" }],
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

  const page = await adapter.readHistory({
    sessionId: "thread_rollout_history",
  });

  assert.deepEqual(page.messages.map((message) => message.content), [
    "红框内的最终总结",
  ]);
  assert.deepEqual(page.messages.map((message) => message.message_phase), [
    "final_answer",
  ]);
});

test("external Codex rollout history restores a final answer omitted by thread/read", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relayune-rollout-history-"));
  const rolloutPath = join(directory, "rollout-test.jsonl");
  await writeFile(
    rolloutPath,
    [
      JSON.stringify({
        timestamp: "2026-08-30T08:20:00.000Z",
        type: "event_msg",
        payload: {
          type: "item_completed",
          turn_id: "turn_external_history",
          item: {
            id: "external_commentary",
            type: "AgentMessage",
            phase: "commentary",
            content: [{ type: "Text", text: "处理中间回复" }],
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-08-30T08:21:00.000Z",
        type: "event_msg",
        payload: {
          type: "item_completed",
          turn_id: "turn_external_history",
          item: {
            id: "external_final",
            type: "AgentMessage",
            phase: "final_answer",
            content: [{ type: "Text", text: "红框内的最终总结已恢复" }],
          },
        },
      }),
      "",
    ].join("\n"),
  );

  try {
    const adapter = createAdapter();
    adapter.rememberThread({
      id: "thread_external_history",
      path: rolloutPath,
      status: { type: "notLoaded" },
    });
    adapter.request = async (method, params) => {
      if (method === "thread/read") {
        return {
          thread: {
            id: "thread_external_history",
            status: { type: "active" },
            turns: [
              {
                id: "turn_external_history",
                status: "inProgress",
                startedAt: "2026-08-30T08:19:00.000Z",
                items: [
                  {
                    id: "external_commentary",
                    type: "agentMessage",
                    phase: "commentary",
                    text: "处理中间回复",
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

    const page = await adapter.readHistory({
      sessionId: "thread_external_history",
    });

    assert.deepEqual(page.messages.map((message) => message.content), [
      "处理中间回复",
      "红框内的最终总结已恢复",
    ]);
    assert.deepEqual(page.messages.map((message) => message.message_phase), [
      "commentary",
      "final_answer",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test("an unmaterialized new thread has empty history without clearing a concurrent live turn", async () => {
  const adapter = createAdapter();
  let reads = 0;
  adapter.request = async (method, params) => {
    assert.equal(method, "thread/read");
    assert.equal(params.includeTurns, false);
    reads++;
    adapter.activeTurns.set("fresh", "live-turn");
    throw new Error("thread fresh is not materialized yet; includeTurns is unavailable before first user message");
  };
  const page = await adapter.readHistory({ sessionId: "fresh" });
  assert.deepEqual(page.messages, []);
  assert.equal(page.has_more, false);
  assert.equal(reads, 1);
  assert.equal(adapter.activeTurns.get("fresh"), "live-turn");
});

test("unsupported history must not be silently reported as an empty conversation", async () => {
  const adapter = createAdapter();
  adapter.request = async () => { throw new Error("list_turns is not supported yet"); };
  await assert.rejects(adapter.readHistory({ sessionId: "unsupported" }), /list_turns is not supported yet/);
});

test('mobile history returns while permission and child detail readers are blocked', async () => {
  const adapter = createAdapter();
  let releasePermissions;
  adapter.readDesktopPermissions = () => new Promise(resolve => { releasePermissions = resolve; });
  const requests = [];
  adapter.request = async (method, params) => {
    requests.push([method, params]);
    if (method === 'thread/list') return { data: [{ id: 'child', parentThreadId: 'root', status: { type: 'idle' } }] };
    assert.equal(params.threadId, 'root', 'history must not read child turns');
    return { thread: { id: 'root', turns: [{ id: 'turn', items: [{ id: 'reply', type: 'agentMessage', text: 'Ready' }] }] } };
  };
  const page = await adapter.readHistory({ sessionId: 'root', includeAgentDetails: false });
  assert.equal(page.messages[0].content, 'Ready');
  assert.equal(page.agents[0].id, 'child');
  assert.equal(requests.filter(([method]) => method === 'thread/read').length, 1);
  assert.equal(adapter.historyPermissionRefreshes.size, 1);
  const permissionWork = [...adapter.historyPermissionRefreshes.values()];
  await adapter.close();
  releasePermissions(null);
  await Promise.all(permissionWork);
});

test('mobile earlier pages reuse a bounded snapshot and invalidate it when the rollout changes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'relayune-history-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'rollout.jsonl');
  await writeFile(path, '\n');
  const adapter = createAdapter();
  t.after(() => adapter.close());
  adapter.threadMetadata.set('root', { id: 'root', path });
  let reads = 0;
  adapter.request = async method => {
    if (method === 'thread/list') return { data: [] };
    reads += 1;
    return { thread: { id: 'root', path, turns: [{ id: 'turn', items: Array.from({ length: 45 }, (_, index) => ({
      id: `reply_${index}`, type: 'agentMessage', text: `Reply ${index}`,
    })) }] } };
  };
  const options = { sessionId: 'root', limit: 20, includeAgentDetails: false };
  const latest = await adapter.readHistory(options);
  const older = await adapter.readHistory({ ...options, before: latest.next_cursor });
  assert.equal(reads, 1);
  assert.equal(older.messages[0].id, 'reply_5');
  assert.equal(older.messages.at(-1).id, 'reply_24');
  await writeFile(path, '\n\n');
  await adapter.readHistory({ ...options, before: latest.next_cursor });
  assert.equal(reads, 2, 'changed files must bypass cached history');
  const refreshed = await adapter.readHistory(options);
  assert.equal(reads, 2, 'an unchanged seeded source also serves the latest page without full history materialization');
  assert.equal(refreshed.messages.at(-1).id, 'reply_44');
});

test('byte-budgeted history pages preserve every message and an oversized message remains whole', async () => {
  const adapter = createAdapter();
  const items = Array.from({ length: 7 }, (_, index) => ({
    id: `reply_${index}`, type: 'agentMessage', text: '中'.repeat(index === 3 ? 9000 : 2500),
  }));
  adapter.request = async method => method === 'thread/list' ? { data: [] } :
    { thread: { id: 'root', turns: [{ id: 'turn', items }] } };
  let before = null;
  const collected = [];
  do {
    const page = await adapter.readHistory({ sessionId: 'root', includeAgentDetails: false, maxBytes: 16 * 1024, before });
    assert.ok(page.messages.length > 0);
    if (page.messages.length > 1) assert.ok(Buffer.byteLength(JSON.stringify(page.messages)) <= 16 * 1024);
    collected.unshift(...page.messages);
    before = page.next_cursor;
    assert.equal(page.has_more, before !== null);
  } while (before);
  assert.deepEqual(collected.map(message => message.id), items.map(item => item.id));
  assert.equal(collected[3].content, items[3].text);
  await adapter.close();
});

test('inspecting agents reads child details without replaying the parent history', async () => {
  const adapter = createAdapter();
  adapter.threadMetadata.set('root', { id: 'root', turns: [] });
  adapter.request = async (method, params) => {
    if (method === 'thread/list') return { data: [{ id: 'child', parentThreadId: 'root' }] };
    assert.equal(params.threadId, 'child');
    return { thread: { id: 'child', turns: [{ status: 'completed', items: [{ type: 'agentMessage', text: 'Child result' }] }] } };
  };
  const agents = await adapter.readAgents({ sessionId: 'root' });
  assert.equal(agents[0].summary, 'Child result');
});

test('parallel rollout supplementation preserves escaped types and ignores unrelated large outputs', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'relayune-history-supplement-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'rollout.jsonl');
  const final = JSON.stringify({ type: 'event_msg', timestamp: '2026-09-09T00:00:00Z', payload: {
    type: 'item_completed', turn_id: 'turn', item: { id: 'external', phase: 'final_answer', type: 'AgentMessage', content: [{ type: 'Text', text: 'Recovered final' }] },
  } }).replace('item_completed', 'item_\\u0063ompleted');
  await writeFile(path, `${JSON.stringify({type:'response_item',payload:{type:'function_call_output',output:'irrelevant'.repeat(10000)}})}\n${final}\n`);
  const adapter = createAdapter();
  t.after(() => adapter.close());
  adapter.threadMetadata.set('root', { id: 'root', path });
  adapter.request = async method => method === 'thread/list' ? { data: [] } : { thread: { id:'root',path,turns:[] } };
  const page = await adapter.readHistory({sessionId:'root',includeAgentDetails:false});
  assert.deepEqual(page.messages.map(message=>message.content), ['Recovered final']);
});

test('earlier history survives tool activity rolling out of the latest-turn window', async (t) => {
  const adapter = createAdapter();
  t.after(() => adapter.close());
  const stable = Array.from({length: 130}, (_, i) => ({id: `reply-${i}`, type: 'agentMessage', text: `Reply ${i}`}));
  let toolStart = 0;
  adapter.request = async method => method === 'thread/list' ? {data: []} : {thread: {id: 'root', turns: [{
    id: 'turn', startedAt: 1700000000, status: 'inProgress', items: [...stable,
      ...Array.from({length: 40}, (_, i) => ({id: `tool-${toolStart+i}`, type: 'commandExecution', command: 'pwd', status: 'completed'})),
    ],
  }]}};
  const latest = await adapter.readHistory({sessionId: 'root', limit: 20, includeAgentDetails: false});
  assert.ok(latest.messages.every(message => message.kind === 'tool_activity'));
  toolStart = 100;
  const legacyCursor = Buffer.from(JSON.stringify({v: 1, before_id: JSON.parse(Buffer.from(latest.next_cursor, 'base64url').toString()).before_id})).toString('base64url');
  const legacyRecovered = await adapter.readHistory({sessionId: 'root', limit: 100, before: legacyCursor, includeAgentDetails: false});
  assert.ok(legacyRecovered.messages.some(message => message.role === 'codex'));
  // Entire initial page disappears from the retained tool window as a live turn advances.
  let cursor = latest.next_cursor;
  const collected = [];
  for (let i = 0; cursor && i < 10; i++) {
    const page = await adapter.readHistory({sessionId: 'root', limit: 100, before: cursor, includeAgentDetails: false});
    collected.unshift(...page.messages);
    cursor = page.next_cursor;
  }
  assert.equal(cursor, null);
  assert.deepEqual(collected.filter(message => message.role === 'codex').map(message => message.id), stable.map(item => item.id));
});

test('history cursors use a surviving page anchor and still accept legacy cursors', async (t) => {
  const adapter = createAdapter();
  t.after(() => adapter.close());
  let items = Array.from({length: 8}, (_, i) => ({id: `reply-${i}`, type: 'agentMessage', text: `Reply ${i}`}));
  adapter.request = async method => method === 'thread/list' ? {data: []} : {thread: {id: 'root', turns: [{id: 'turn', items}]}};
  const latest = await adapter.readHistory({sessionId: 'root', limit: 3, includeAgentDetails: false});
  items = items.filter(item => item.id !== 'reply-5');
  const page = await adapter.readHistory({sessionId: 'root', limit: 100, before: latest.next_cursor, includeAgentDetails: false});
  assert.deepEqual(page.messages.map(message => message.id), ['reply-0','reply-1','reply-2','reply-3','reply-4']);
  const legacy = Buffer.from(JSON.stringify({v: 1, before_id: 'reply-3'})).toString('base64url');
  const oldPage = await adapter.readHistory({sessionId: 'root', before: legacy, includeAgentDetails: false});
  assert.deepEqual(oldPage.messages.map(message => message.id), ['reply-0','reply-1','reply-2']);
  const invalid = Buffer.from(JSON.stringify({v: 2, before_id: 'missing', turn_id: 'missing', after_ids: []})).toString('base64url');
  await assert.rejects(adapter.readHistory({sessionId: 'root', before: invalid, includeAgentDetails: false}), /no longer valid/);
});


test('unloaded child state and missing start time remain unknown', async (t) => {
  const adapter = createAdapter();
  t.after(() => adapter.close());
  adapter.threadMetadata.set('root', { id: 'root', createdAt: 1700000000, turns: [] });
  adapter.request = async (method) => {
    if (method === 'thread/list') return { data: [{ id: 'child', parentThreadId: 'root', status: { type: 'notLoaded' } }] };
    throw new Error('Child is unavailable');
  };
  const [child] = await adapter.readAgents({ sessionId: 'root' });
  assert.equal(child.status, 'unknown');
  assert.equal(child.started_at, null);
});

test('a current completed child turn supersedes an old pending spawn snapshot', async (t) => {
  const adapter = createAdapter();
  t.after(() => adapter.close());
  adapter.threadMetadata.set('root', { id: 'root', turns: [{ items: [{
    id: 'spawn', type: 'collabAgentToolCall', tool: 'spawnAgent', receiverThreadIds: ['child'],
    agentsStates: { child: { status: 'pendingInit' } }, prompt: 'Research',
  }] }] });
  adapter.request = async (method) => method === 'thread/list'
    ? { data: [{ id: 'child', parentThreadId: 'root', status: { type: 'notLoaded' } }] }
    : { thread: { id: 'child', turns: [{ status: 'completed', items: [{ type: 'agentMessage', text: 'Research result' }] }] } };
  const [child] = await adapter.readAgents({ sessionId: 'root' });
  assert.equal(child.status, 'completed');
  assert.equal(child.summary, 'Research result');
  assert.equal(child.task, 'Research');
});
