import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdtemp, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexAppServerAdapter } from '../relay/codex-adapters.mjs';
import { readRolloutAttachmentDataUrl } from '../relay/codex-rollout-history-index.mjs';

const epoch = Date.parse('2026-10-03T01:00:00Z');
const user = id => ({ type: 'userMessage', id, clientId: `client-${id}`, content: [{ type: 'text', text: `中文 ${id}` }] });
const answer = id => ({ type: 'agentMessage', id, text: `reply ${id}`, phase: 'final_answer' });
const tool = id => ({ type: 'commandExecution', id, command: `echo ${id}`, status: 'completed', aggregatedOutput: id });
const image = `data:image/png;base64,${Buffer.alloc(200_000, 42).toString('base64')}`;
const publicFields = page => page.messages.map(message => ({ ...message, attachments: message.attachments?.map(({ relay_source, ...metadata }) => metadata) }));

async function fixture(t, { count = 8, tools = 0, hidden = 0, crlf = false, partial = false, withImages = false, prefixBytes = 0, activeLast = false, rawQuestions = false, forkAncestors = [] } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'relayune-native-history-'));
  const path = join(directory, 'rollout.jsonl');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const turns = Array.from({ length: count }, (_, index) => ({
    id: `turn-${index}`, status: 'completed', startedAt: epoch / 1000 + index * 60,
    completedAt: epoch / 1000 + index * 60 + 50,
    items: [user(`u-${index}-1`), answer(`a-${index}-1`), user(`u-${index}-2`), answer(`a-${index}-2`)],
  }));
  if (hidden) turns.at(-1).items.splice(1, 0, ...Array.from({ length: hidden }, (_, n) => ({ type: 'reasoning', id: `r-${n}`, summary: [], content: [] })));
  if (tools) turns.at(-1).items.splice(-1, 0, ...Array.from({ length: tools }, (_, n) => tool(`tool-${n}`)));
  const records = () => [
    { type: 'session_meta', timestamp: new Date(epoch).toISOString(), payload: { id: 'thread', history_mode: 'paginated', cli_version: 'fixture',
      ...(forkAncestors.length ? { forked_from_id: forkAncestors[0] } : {}) } },
    ...forkAncestors.map((id, index) => ({ type: 'session_meta', timestamp: new Date(epoch).toISOString(), payload: {
      id, history_mode: 'legacy', cli_version: 'fixture', ...(forkAncestors[index + 1] ? { forked_from_id: forkAncestors[index + 1] } : {}) } })),
    ...(prefixBytes ? [{ type: 'event_msg', timestamp: new Date(epoch).toISOString(), payload: { type: 'command_output', text: 'x'.repeat(prefixBytes) } }] : []),
    ...turns.flatMap((turn, index) => {
      const timestamp = n => new Date(epoch + index * 60_000 + n).toISOString();
      return [
        { type: 'event_msg', timestamp: timestamp(0), payload: { type: 'task_started', turn_id: turn.id } },
        ...turn.items.filter(item => ['userMessage', 'agentMessage'].includes(item.type)).map((item, n) => item.type === 'userMessage'
          ? { type: 'event_msg', timestamp: timestamp((n + 1) * 1000 + 123), payload: { type: 'item_completed', turn_id: turn.id, item: { ...item, type: 'UserMessage', client_id: item.clientId } } }
          : { type: 'response_item', timestamp: timestamp((n + 1) * 1000 + 321), payload: { type: 'message', id: item.id, role: 'assistant', phase: item.phase, content: [{ type: 'output_text', text: item.text }], internal_chat_message_metadata_passthrough: { turn_id: turn.id } } }),
        ...(withImages ? [{ type: 'response_item', timestamp: timestamp(45_000), payload: { type: 'function_call_output', call_id: `image-${index}`, output: [{ type: 'input_image', image_url: image }], internal_chat_message_metadata_passthrough: { turn_id: turn.id } } }] : []),
        ...(rawQuestions && index === turns.length - 1 ? [
          { type: 'response_item', timestamp: timestamp(46_000), payload: { type: 'function_call', name: 'request_user_input_async', call_id: 'raw-question', arguments: JSON.stringify({ questions: [{ title: 'Choose a fixture', options: ['First', 'Second'] }] }) } },
          { type: 'response_item', timestamp: timestamp(47_000), payload: { type: 'function_call_output', call_id: 'raw-question', output: JSON.stringify({ accepted: true }) } },
        ] : []),
        ...(!(activeLast && index === turns.length - 1) ? [{ type: 'event_msg', timestamp: timestamp(50_000), payload: { type: 'task_complete', turn_id: turn.id } }] : []),
      ];
    }),
  ];
  const write = async () => writeFile(path, records().map(JSON.stringify).join(crlf ? '\r\n' : '\n') + (crlf ? '\r\n' : '\n') + (partial ? '{"type":"event_msg","payload":{"中文":"未完成' : ''));
  await write();
  const makeAdapter = ({ native = true, intercept } = {}) => {
    const adapter = new CodexAppServerAdapter({ workspace: directory });
    adapter.nativeHistoryAvailable = native ? undefined : false;
    adapter.refreshHistoryPermissions = () => {};
    adapter.refreshPermissions = async () => {};
    const calls = [];
    adapter.request = async (method, params, options) => {
      calls.push({ method, params, options });
      const injected = await intercept?.(method, params, options);
      if (injected !== undefined) return injected;
      if (method === 'thread/read') return { thread: { id: params.threadId, path, historyMode: 'paginated', cwd: directory,
        status: { type: 'notLoaded' }, ...(params.includeTurns ? { turns: structuredClone(turns) } : {}) } };
      if (method === 'thread/list') return { data: [] };
      if (method === 'thread/turns/list') {
        if (!turns.length) return { data: [], nextCursor: null };
        const index = params.cursor == null ? turns.length - 1 : turns.findIndex(turn => turn.id === params.cursor);
        assert.ok(index >= 0);
        return { data: [{ ...structuredClone(turns[index]), items: [] }], nextCursor: index > 0 ? turns[index - 1].id : null };
      }
      if (method === 'thread/items/list') {
        const turn = turns.find(turn => turn.id === params.turnId);
        const start = Number(params.cursor) || 0;
        assert.equal(params.sortDirection, 'asc');
        return { data: structuredClone(turn.items.slice(start, start + params.limit)).map(item => ({ turnId: turn.id, item })),
          nextCursor: start + params.limit < turn.items.length ? String(start + params.limit) : null };
      }
      assert.fail(`Unexpected RPC: ${method}`);
    };
    t.after(() => adapter.close());
    return { adapter, calls };
  };
  return { directory, path, turns, makeAdapter, write };
}

const read = (adapter, extra = {}) => adapter.readHistory({ sessionId: 'thread', limit: 100, includeAgentDetails: false, ...extra });

async function allPages(adapter, options) {
  let before = null;
  const pages = [];
  do {
    const page = await read(adapter, { ...options, before });
    pages.unshift(page.messages);
    before = page.next_cursor;
    if (before) assert.equal(page.has_more, true);
    assert.ok(pages.length < 80, 'pagination must advance');
  } while (before);
  return pages.flat();
}

const unsupportedNativeItems = method => {
  // Current actual 0.160 app-server advertises native history but still lacks
  // item paging, so a bounded request can take this rollout fallback.
  if (method === 'thread/items/list') throw Object.assign(new Error('thread/items/list is not supported yet'), { code: -32601 });
};

test('native fork copied ancestor headers preserve owner identity through bounded fallback and complete history', async t => {
  for (const forkAncestors of [['parent'], ['parent', 'grandparent']]) {
    // Actual Codex 0.160 fork rollouts prepend the new owner header and copy
    // ancestor headers before the inherited completed turns.
    const f = await fixture(t, { count: 1, forkAncestors });
    const before = await readFile(f.path, 'utf8');
    for (const options of [{ limit: 100, maxBytes: Math.floor(1024 * 1024 * 0.6) }, { limit: 500 },
      { limit: 100, includeAgentDetails: true, maxBytes: Math.floor(1024 * 1024 * 0.6) }]) {
      const { adapter, calls } = f.makeAdapter({ intercept: unsupportedNativeItems });
      const page = await read(adapter, options);
      assert.deepEqual(page.messages.map(message => message.content), ['中文 u-0-1', 'reply a-0-1', '中文 u-0-2', 'reply a-0-2']);
      assert.ok(page.messages.every(message => message.turn_id === 'turn-0' && message.turn_status === 'completed'));
      assert.equal([...adapter.rolloutHistoryIndex.entries.values()][0].state.sessionId, 'thread');
      assert.equal(calls.filter(call => call.method === 'thread/read' && call.params.includeTurns).length, 1);
      assert.deepEqual(publicFields(await read(adapter, options)), publicFields(page));
      assert.equal(await readFile(f.path, 'utf8'), before);
    }
  }
});

test('fork history still rejects another file owner or an undeclared copied ancestor', async t => {
  for (const change of ['owner', 'ancestor']) {
    const f = await fixture(t, { count: 1, forkAncestors: ['parent'] });
    const records = (await readFile(f.path, 'utf8')).trim().split('\n').map(JSON.parse);
    records[change === 'owner' ? 0 : 1].payload.id = 'unrelated';
    await writeFile(f.path, records.map(JSON.stringify).join('\n') + '\n');
    for (const limit of [100, 500]) {
      const { adapter } = f.makeAdapter({ intercept: unsupportedNativeItems });
      await assert.rejects(read(adapter, { limit, maxBytes: Math.floor(1024 * 1024 * 0.6) }), /does not match/);
    }
  }
});

test('native pages keep the complete 100 Relay-message contract after hidden items and the latest 32 tools', async t => {
  const f = await fixture(t, { count: 22, hidden: 215, tools: 40, prefixBytes: 8 * 1024 * 1024 });
  const baseline = f.makeAdapter({ native: false }).adapter;
  const { adapter, calls } = f.makeAdapter();
  const expected = await read(baseline);
  const page = await read(adapter);
  assert.deepEqual(publicFields(page), publicFields(expected));
  assert.equal(page.messages.length, 100);
  assert.equal(page.messages.filter(message => message.kind === 'tool_activity').length, 32);
  assert.equal(calls.filter(call => call.method === 'thread/read' && call.params.includeTurns).length, 0);
  assert.ok(calls.filter(call => call.method === 'thread/items/list').length > 1);
  assert.ok(adapter.nativeHistoryReadMetrics.sourceBytes < 3 * 1024 * 1024);
  assert.equal(adapter.rolloutHistoryIndex.entries.size, 0);
  assert.ok(calls.every(call => call.options.timeoutMs > 0 && call.options.timeoutMs <= 8000));
  calls.length = 0;
  assert.deepEqual(publicFields(await read(adapter)), publicFields(page));
  assert.equal(calls.length, 0, 'an unchanged bounded page is reused');
});

test('complete latest 500-message pages avoid native probes and keep old cursors continuous across Relay restart', async t => {
  const f = await fixture(t, { count: 151, hidden: 215, tools: 40 });
  const baseline = f.makeAdapter({ native: false }).adapter;
  const expected = await allPages(baseline, { limit: 500 });
  assert.ok(expected.length > 500);
  const { adapter, calls } = f.makeAdapter();
  assert.equal((await read(adapter, { limit: undefined })).messages.length, 100);
  calls.length = 0;
  const first = await read(adapter, { limit: 9999 });
  assert.equal(first.messages.length, 500);
  assert.equal(first.has_more, true);
  assert.deepEqual(publicFields(first), publicFields(await read(baseline, { limit: 500 })));
  assert.equal(calls.filter(call => ['thread/turns/list', 'thread/items/list'].includes(call.method)).length, 0);
  assert.equal(calls.filter(call => call.method === 'thread/read' && call.params.includeTurns).length, 1);
  calls.length = 0;
  assert.deepEqual(publicFields(await read(adapter, { limit: 500 })), publicFields(first));
  assert.equal(calls.filter(call => call.method === 'thread/read' && call.params.includeTurns).length, 0);
  assert.deepEqual(publicFields(await read(adapter, { limit: 100 })), publicFields(await read(baseline, { limit: 100 })));
  assert.equal(calls.filter(call => ['thread/turns/list', 'thread/items/list'].includes(call.method)).length, 0,
    'a smaller wire-budget retry must not probe native history again after full calibration');
  const collected = [...first.messages];
  let before = first.next_cursor;
  while (before) {
    const restarted = f.makeAdapter();
    const page = await read(restarted.adapter, { limit: 500, before });
    collected.unshift(...page.messages);
    before = page.next_cursor;
    calls.push(...restarted.calls);
    await restarted.adapter.close();
  }
  assert.deepEqual(publicFields({ messages: collected }), publicFields({ messages: expected }));
  assert.equal(new Set(collected.map(message => message.id)).size, expected.length);
  assert.ok(calls.filter(call => call.method === 'thread/items/list').every(call => call.params.limit === 100));
  assert.equal(calls.filter(call => call.method === 'thread/read' && call.params.includeTurns).length, 0);

  const bounded = await allPages(f.makeAdapter().adapter, { limit: 500, maxBytes: 16 * 1024 });
  assert.deepEqual(publicFields({ messages: bounded }), publicFields({ messages: expected }));
});

test('multiple same-turn steer users and answers page exactly once across budgets and Relay restarts', async t => {
  const f = await fixture(t, { count: 6 });
  for (const turn of f.turns) for (const item of turn.items) if (item.type === 'agentMessage') item.text = 'x'.repeat(10000) + item.id;
  await f.write();
  const expected = await allPages(f.makeAdapter({ native: false }).adapter, { limit: 3 });
  for (const maxBytes of [undefined, 16 * 1024]) {
    const actual = [];
    let budgetTruncated = false;
    let before = null;
    do {
      const { adapter } = f.makeAdapter();
      const page = await read(adapter, { before, limit: 3, maxBytes });
      actual.unshift(...page.messages);
      budgetTruncated ||= Boolean(maxBytes && page.has_more && page.messages.length < 3);
      before = page.next_cursor;
      if (before) assert.equal(JSON.parse(Buffer.from(before, 'base64url')).v, 2);
      await adapter.close();
    } while (before);
    assert.deepEqual(actual.map(message => message.id), expected.map(message => message.id));
    assert.equal(new Set(actual.map(message => message.id)).size, 24);
    if (maxBytes) assert.equal(budgetTruncated, true);
  }
});

test('UTF-8, CRLF and a partial trailing row retain image metadata and downloadable source offsets', async t => {
  const f = await fixture(t, { count: 3, withImages: true, crlf: true, partial: true });
  const baseline = await read(f.makeAdapter({ native: false }).adapter);
  const page = await read(f.makeAdapter().adapter);
  assert.deepEqual(publicFields(page), publicFields(baseline));
  const sources = page.messages.flatMap(message => message.attachments ?? []).map(attachment => attachment.relay_source);
  assert.equal(sources.length, 3);
  for (const source of sources) assert.equal(await readRolloutAttachmentDataUrl(source), image);
  const earlier = await allPages(f.makeAdapter().adapter, { limit: 1 });
  assert.deepEqual(earlier.map(message => message.id), baseline.messages.map(message => message.id));
});

test('source-only image anchors keep older pages continuous', async t => {
  const f = await fixture(t, { count: 3, withImages: true });
  // A turn with no answer keeps its output image as an independent message.
  f.turns[1].items = [user('image-user')];
  await f.write();
  const expected = await allPages(f.makeAdapter({ native: false }).adapter, { limit: 1 });
  const actual = await allPages(f.makeAdapter().adapter, { limit: 1 });
  assert.deepEqual(publicFields({ messages: actual }), publicFields({ messages: expected }));
  assert.ok(actual.some(message => message.id.startsWith('rollout_images_')));
});

test('append, rewrite and inode replacement invalidate native pages and old image references', async t => {
  const f = await fixture(t, { count: 2, withImages: true });
  const { adapter } = f.makeAdapter();
  const first = await read(adapter);
  const oldSource = first.messages.flatMap(message => message.attachments ?? [])[0].relay_source;
  f.turns.push({ id: 'appended', status: 'completed', startedAt: epoch / 1000 + 120, completedAt: epoch / 1000 + 170,
    items: [user('appended-user'), answer('appended-answer')] });
  await f.write();
  const appended = await read(adapter);
  assert.ok(appended.messages.some(message => message.id === 'appended-answer'));
  await writeFile(f.path, (await readFile(f.path, 'utf8')).replace('Kioq', 'Kyop'));
  await assert.rejects(readRolloutAttachmentDataUrl(oldSource), /source changed/);
  const rewrittenSource = (await read(adapter)).messages.flatMap(message => message.attachments ?? [])[0].relay_source;
  assert.equal(await readRolloutAttachmentDataUrl(rewrittenSource), image.replace('Kioq', 'Kyop'));
  f.turns[0].items[1].text = 'changed native reply';
  await f.write();
  assert.equal((await read(adapter)).messages.find(message => message.id === 'a-0-1').content, 'changed native reply');
  const replacement = join(f.directory, 'replacement.jsonl');
  await writeFile(replacement, await readFile(f.path));
  await rename(replacement, f.path);
  await assert.rejects(readRolloutAttachmentDataUrl(oldSource), /source changed/);
  assert.ok((await read(adapter)).messages.some(message => message.id === 'appended-answer'));
});

test('old v2 cursors survive native activation and disappearances use the existing overlapping turn boundary', async t => {
  const f = await fixture(t, { count: 4, tools: 36 });
  const baseline = f.makeAdapter({ native: false }).adapter;
  const first = await read(baseline, { limit: 3 });
  const { adapter } = f.makeAdapter();
  const actual = await read(adapter, { limit: 3, before: first.next_cursor });
  assert.deepEqual(publicFields(actual), publicFields(await read(baseline, { limit: 3, before: first.next_cursor })));
  const current = await read(adapter, { limit: 1 });
  const latestTurn = f.turns.at(-1);
  latestTurn.items = latestTurn.items.filter(item => item.id !== current.messages[0].id &&
    `command_${latestTurn.id}_${item.id}` !== current.messages[0].id);
  await f.write();
  assert.ok((await read(adapter, { limit: 3, before: current.next_cursor })).messages.length > 0);
});

test('expired unchanged pages refresh only bounded native metadata and retain compact collaboration', async t => {
  const f = await fixture(t, { withImages: true });
  const { adapter, calls } = f.makeAdapter();
  const first = await read(adapter);
  const collab = { id: 'spawn', type: 'collabAgentToolCall', tool: 'spawnAgent', senderThreadId: 'thread', receiverThreadIds: ['child'],
    prompt: 'child instructions', model: 'gpt-test', reasoningEffort: 'high', status: 'completed' };
  adapter.threadMetadata.get('thread').relayCollabItems = [collab];
  adapter.historyPages.get('thread').createdAt -= 31000;
  calls.length = 0;
  assert.deepEqual(publicFields(await read(adapter)), publicFields(first));
  assert.deepEqual(calls.map(call => call.method), ['thread/read', 'thread/turns/list']);
  assert.equal(adapter.threadMetadata.get('thread').relayCollabItems[0].prompt, 'child instructions');
});

test('native cursor source boundary hints avoid scanning newer ranges and remain readable by the compatibility path', async t => {
  const f = await fixture(t, { count: 8, withImages: true });
  const { adapter } = f.makeAdapter();
  const first = await read(adapter, { limit: 1 });
  const cursor = JSON.parse(Buffer.from(first.next_cursor, 'base64url'));
  assert.equal(cursor.v, 2);
  assert.ok(Number.isSafeInteger(cursor.source_end_offset));
  const old = f.makeAdapter({ native: false }).adapter;
  const expected = await read(old, { before: first.next_cursor, limit: 1 });
  const restarted = f.makeAdapter().adapter;
  assert.deepEqual(publicFields(await read(restarted, { before: first.next_cursor, limit: 1 })), publicFields(expected));
  cursor.source_end_digest = '0'.repeat(64);
  cursor.source_end_length = 1;
  await assert.rejects(read(f.makeAdapter().adapter, { before: Buffer.from(JSON.stringify(cursor)).toString('base64url') }), /Invalid history cursor/);
});

test('concurrent append returns the captured snapshot without caching a mixed page', async t => {
  const f = await fixture(t, { count: 1, withImages: true });
  const expected = await read(f.makeAdapter({ native: false }).adapter);
  let appended = false;
  const { adapter } = f.makeAdapter({ intercept: async method => {
    if (method === 'thread/items/list' && !appended) {
      appended = true;
      await writeFile(f.path, (await readFile(f.path)) + '\n');
    }
  } });
  assert.deepEqual(publicFields(await read(adapter)), publicFields(expected));
  assert.equal(adapter.historyPages.size, 0);
});

test('rewrite plus append during native hydration rejects the changed captured source', async t => {
  const f = await fixture(t, { count: 1, withImages: true });
  const { adapter } = f.makeAdapter({ intercept: async method => {
    if (method === 'thread/items/list') await writeFile(f.path, (await readFile(f.path, 'utf8')).replace('reply a-0-1', 'other a-0-1') + '\n');
  } });
  await assert.rejects(read(adapter), /source changed/);
  assert.equal(adapter.historyPages.size, 0);
});

test('optional descendant metadata cannot loop cursors or consume the absolute history budget', async t => {
  const f = await fixture(t);
  const repeating = f.makeAdapter({ intercept: method => method === 'thread/list' ? { data: [], nextCursor: 'again' } : undefined });
  assert.equal((await read(repeating.adapter)).messages.length, 32);
  assert.equal(repeating.calls.filter(call => call.method === 'thread/list').length, 2);
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const overdue = f.makeAdapter({ intercept: method => {
      if (method === 'thread/list') now += 16000;
    } });
    await assert.rejects(read(overdue.adapter), /timed out/);
  } finally { Date.now = originalNow; }
});

test('only unsupported native methods or unavailable explicit source boundaries enter compatibility history', async t => {
  const f = await fixture(t);
  const { adapter, calls } = f.makeAdapter({ intercept: method => {
    if (method === 'thread/turns/list') throw Object.assign(new Error('Method not found'), { code: -32601 });
  } });
  assert.equal((await read(adapter)).messages.length, 32);
  assert.equal(adapter.nativeHistoryAvailable, false);
  assert.equal(calls.filter(call => call.method === 'thread/read' && call.params.includeTurns).length, 1);
  const contents = await readFile(f.path, 'utf8');
  await writeFile(f.path, contents.replaceAll('task_started', 'unknown_marker'));
  const missingBoundary = f.makeAdapter();
  assert.equal((await read(missingBoundary.adapter)).messages.length, 32);
  assert.equal(missingBoundary.adapter.nativeHistorySourceFallbacks.size, 1);
  assert.equal(missingBoundary.calls.filter(call => call.method === 'thread/read' && call.params.includeTurns).length, 1);
});

test('permissions, malformed native pages, cross-thread items and cross-session cursors never fall through', async t => {
  const f = await fixture(t);
  const variants = [
    () => { throw Object.assign(new Error('Permission denied'), { code: 'EACCES' }); },
    () => ({ thread: {} }),
    () => ({ data: [{ turnId: 'other-turn', item: user('other-user') }] }),
  ];
  for (const response of variants) {
    const { adapter, calls } = f.makeAdapter({ intercept: method => method === 'thread/items/list' ? response() : undefined });
    await assert.rejects(read(adapter));
    assert.equal(calls.filter(call => call.method === 'thread/read' && call.params.includeTurns).length, 0);
  }
  const page = await read(f.makeAdapter().adapter, { limit: 1 });
  const { adapter } = f.makeAdapter();
  await assert.rejects(adapter.readHistory({ sessionId: 'another', before: page.next_cursor, includeAgentDetails: false }), /another conversation/);
  const mismatched = f.makeAdapter({ intercept: method => method === 'thread/read' ? { thread: { id: 'other-thread', path: f.path } } : undefined });
  await assert.rejects(read(mismatched.adapter), /does not match/);
});

test('the absolute native deadline rejects overdue results without starting a compatibility read', async t => {
  const f = await fixture(t);
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  t.after(() => { Date.now = originalNow; });
  const { adapter, calls } = f.makeAdapter({ intercept: method => {
    if (method === 'thread/items/list') now += 16000;
  } });
  await assert.rejects(read(adapter), /timed out/);
  assert.equal(calls.filter(call => call.method === 'thread/read' && call.params.includeTurns).length, 0);
});

test('turn history rejects nonadjacent cursor cycles during ordinary paging and old v2 boundary lookup', async t => {
  const f = await fixture(t, { count: 3 });
  const before = Buffer.from(JSON.stringify({ v: 2, before_id: 'missing', turn_id: 'missing', after_ids: [] })).toString('base64url');
  for (const boundary of [undefined, before]) {
    const { adapter, calls } = f.makeAdapter({ intercept: (method, params) => {
      if (method !== 'thread/turns/list') return;
      const index = params.cursor == null ? 2 : params.cursor === 'A' ? 1 : 0;
      return { data: [{ ...f.turns[index], items: [] }], nextCursor: params.cursor === 'A' ? 'B' : 'A' };
    } });
    await assert.rejects(read(adapter, { before: boundary }), /turn history cursor did not advance/);
    assert.equal(calls.filter(call => call.method === 'thread/turns/list').length, 3);
    assert.equal(calls.filter(call => call.method === 'thread/read' && call.params.includeTurns).length, 0);
  }
});

test('item history rejects nonadjacent cursor cycles without repeated items or compatibility reads', async t => {
  const f = await fixture(t, { count: 1 });
  const { adapter, calls } = f.makeAdapter({ intercept: (method, params) => method === 'thread/items/list'
    ? { data: [], nextCursor: params.cursor === 'A' ? 'B' : 'A' } : undefined });
  await assert.rejects(read(adapter), /item history cursor did not advance/);
  assert.equal(calls.filter(call => call.method === 'thread/items/list').length, 3);
  assert.equal(calls.filter(call => call.method === 'thread/read' && call.params.includeTurns).length, 0);
});

test('native external history repairs an interrupted running turn from its selected range without a full lifecycle poll', async t => {
  const f = await fixture(t, { count: 1, activeLast: true, rawQuestions: true });
  const turn = f.turns[0];
  turn.status = 'interrupted';
  turn.items.at(-1).questions = [{ title: 'Native fixture question', options: ['First'] }];
  const published = [], events = [];
  const { adapter, calls } = f.makeAdapter({ intercept: method => {
    if (method === 'thread/items/list') assert.equal(adapter.activeTurns.get('thread'), turn.id, 'an existing active turn survives the body read');
  } });
  adapter.handlers = { requestApproval: async approval => published.push(approval), emitEvent: async (_id, event) => events.push(event) };
  adapter.asyncQuestions.now = () => epoch + 200_000;
  adapter.activeTurns.set('thread', turn.id);
  adapter.pollExternalRolloutActivity = async () => assert.fail('native history must not start a full external lifecycle scan');
  const page = await read(adapter);
  assert.ok(page.messages.every(message => message.turn_status === 'inProgress'));
  assert.equal(adapter.activeTurns.get('thread'), turn.id);
  assert.equal(published.length, 2, 'native typed and exact accepted source questions are both restored');
  assert.ok([...adapter.asyncQuestions.entries.values()].every(entry => entry.state === 'pending'));
  assert.ok(!events.some(event => event.decision === 'expired'));
  assert.equal(calls.filter(call => call.method === 'thread/read' && call.params.includeTurns).length, 0);
});

test('native external lifecycle reconciliation respects terminal native turns and empty concurrent starts', async t => {
  for (const status of ['completed', 'failed', 'interrupted']) {
    const f = await fixture(t, { count: 1, activeLast: status !== 'interrupted' });
    f.turns[0].status = status;
    const { adapter } = f.makeAdapter();
    adapter.handlers = { requestApproval: async () => {}, emitEvent: async () => {} };
    adapter.activeTurns.set('thread', f.turns[0].id);
    adapter.pollExternalRolloutActivity = async () => assert.fail('native history must use the selected range');
    const page = await read(adapter);
    assert.ok(page.messages.every(message => message.turn_status === (status === 'interrupted' ? 'completed' : status)));
    assert.equal(adapter.activeTurns.has('thread'), false, 'native terminal state is not resurrected by a missing raw terminal');
  }
  const f = await fixture(t, { count: 0 });
  const { adapter } = f.makeAdapter();
  adapter.activeTurns.set('thread', 'accepted-concurrent-start');
  assert.deepEqual((await read(adapter)).messages, []);
  assert.equal(adapter.activeTurns.get('thread'), 'accepted-concurrent-start', 'empty pre-materialization history cannot end an accepted turn');
});

test('native history honors a verified owner terminal from the same source and never resurrects its tool spinner', async t => {
  const f = await fixture(t, { count: 1, activeLast: true, tools: 1 });
  f.turns[0].status = 'interrupted';
  f.turns[0].items.find(item => item.type === 'commandExecution').status = 'inProgress';
  const { adapter } = f.makeAdapter();
  adapter.handlers = { emitEvent: async () => {}, requestApproval: async () => {} };
  adapter.readDesktopRuntime = async () => ({ type: 'idle' });
  adapter.syncExternalQuestions = async () => {};
  await utimes(f.path, new Date(0), new Date(0));
  const thread = { id: 'thread', path: f.path, status: { type: 'notLoaded' } };
  const source = await adapter.pollExternalRolloutActivityOnce(thread);
  await adapter.reconcileExternalRuntime(thread, source.state, source.info);
  assert.equal(source.state.terminalTurnStatuses.get('turn-0'), 'interrupted');
  const page = await read(adapter);
  assert.ok(page.messages.every(message => message.turn_status === 'interrupted'));
  assert.equal(page.messages.find(message => message.kind === 'tool_activity').tool_activity_status, 'completed');
  assert.equal(adapter.activeTurns.has('thread'), false);
  // A replacement file cannot inherit an old source's runtime observation.
  await rename(f.path, join(f.directory, 'old.jsonl'));
  await f.write();
  assert.notEqual((await stat(f.path)).ino, (await stat(join(f.directory, 'old.jsonl'))).ino);
  const replaced = await read(adapter);
  assert.ok(replaced.messages.every(message => message.turn_status === 'inProgress'));
});

for (const [native, limit] of [[false, 100], [true, 100], [true, 500]]) test(`a completed notification during ${limit === 500 ? 'complete parallel' : native ? 'native' : 'compatible'} history stays terminal and the next owned send starts a fresh turn`, async t => {
  const f = await fixture(t, { count: 1, activeLast: true });
  f.turns[0].status = 'inProgress';
  let completed = false;
  const { adapter, calls } = f.makeAdapter({ native, intercept: async (method, params) => {
    if ((native && limit < 500 ? method === 'thread/items/list' : method === 'thread/read' && params.includeTurns) && !completed) {
      completed = true;
      await adapter.handleNotification({ method: 'turn/completed', params: {
        threadId: 'thread', turn: { id: 'turn-0', status: 'completed' },
      } });
      assert.equal(adapter.activeTurns.has('thread'), false);
    }
    if (method === 'turn/start') return { turn: { id: 'fresh-turn' } };
    if (method === 'turn/steer') assert.fail('a completed turn must not receive the next send');
  } });
  adapter.handlers = { emitEvent: async () => {}, requestApproval: async () => {} };
  adapter.resumedThreads.add('thread');
  adapter.activeTurns.set('thread', 'turn-0');
  adapter.liveTurns.set('thread', 'turn-0');
  adapter.verifyUserMessage = async () => true;
  await read(adapter, { limit });
  assert.equal(adapter.activeTurns.has('thread'), false, 'a stale history snapshot cannot resurrect the completed runtime');
  assert.equal(adapter.liveTurns.has('thread'), false);
  assert.equal(adapter.historyPages.has('thread'), false, 'the stale running page is not cached');
  if (limit === 500) assert.equal([...adapter.rolloutHistoryIndex.entries.values()][0].state.providerSeed, undefined);
  assert.equal(adapter.threadRuntimeRevisions.get('thread'), 1);
  const result = await adapter.submitMessage({ sessionId: 'thread', content: 'synthetic only', clientMessageId: 'fixture-send' });
  assert.equal(result.mode, 'started');
  assert.equal(calls.filter(call => call.method === 'turn/start').length, 1);
  assert.equal(calls.filter(call => call.method === 'turn/steer').length, 0);
});

test('cached native history rechecks current source permissions', { skip: process.getuid?.() === 0 || process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  const { adapter } = f.makeAdapter();
  await read(adapter);
  try {
    await chmod(f.path, 0);
    await assert.rejects(read(adapter), error => error.code === 'EACCES' || error.code === 'EPERM');
  } finally { await chmod(f.path, 0o600); }
});

test('native and compatibility history retain failed terminal errors even with no assistant reply', async t => {
  const f = await fixture(t, { count: 2 });
  for (const turn of f.turns) {
    turn.status = 'failed';
    turn.error = { message: 'stream disconnected before completion: error sending request' };
    turn.items = [turn.items[0]];
  }
  await f.write();
  // Match Desktop's durable shape: task_complete with error, not turn_aborted.
  const records = (await readFile(f.path, 'utf8')).trim().split('\n').map(JSON.parse);
  for (const record of records) if (record.payload.type === 'task_complete')
    record.payload.error = f.turns[0].error;
  await writeFile(f.path, records.map(JSON.stringify).join('\n') + '\n');
  for (const native of [true, false]) {
    const { adapter } = f.makeAdapter({ native });
    for (const messages of [(await read(adapter)).messages, await allPages(adapter, { limit: 2 })]) {
      assert.deepEqual(messages.filter(m => m.kind === 'turn.failed').map(m => m.id),
        ['turn-terminal:turn-0', 'turn-terminal:turn-1']);
      assert.ok(messages.every(m => m.turn_status === 'failed'));
      assert.ok(messages.filter(m => m.kind === 'turn.failed').every(m => m.content === f.turns[0].error.message));
    }
  }
  // An older provider can materialize task_complete as successful. The owning
  // durable error must still win, including the status on preceding messages.
  for (const turn of f.turns) { turn.status = 'completed'; delete turn.error; }
  const { adapter } = f.makeAdapter();
  const page = await read(adapter);
  assert.ok(page.messages.every(m => m.turn_status === 'failed'));
  assert.equal(page.messages.filter(m => m.kind === 'turn.failed').length, 2);
});
