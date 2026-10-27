import assert from 'node:assert/strict';
import test from 'node:test';
import { appendFile, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { CodexAppServerAdapter } from '../relay/codex-adapters.mjs';
import { readRolloutAttachmentDataUrl } from '../relay/codex-rollout-history-index.mjs';
import { AttachmentStore } from '../relay/attachment-store.mjs';

const at = '2026-09-30T02:00:00.000Z';
const row = (type, payload) => ({ timestamp: at, type, payload });
const serialize = records => records.map(JSON.stringify).join('\n') + '\n';
const meta = row('session_meta', { id: 'thread', history_mode: 'legacy', cli_version: 'fixture' });
const start = id => row('event_msg', { type: 'task_started', turn_id: id });
const user = (turn, id, text, extra = []) => row('event_msg', { type: 'item_completed', turn_id: turn,
  item: { type: 'UserMessage', id, client_id: `client-${id}`, content: [{ type: 'text', text }, ...extra] } });
const answer = (turn, id, text) => row('response_item', { type: 'message', id, role: 'assistant',
  phase: 'final_answer', content: [{ type: 'output_text', text }],
  internal_chat_message_metadata_passthrough: { turn_id: turn } });
const done = turn => row('event_msg', { type: 'task_complete', turn_id: turn });

function materializedTurns(records) {
  const turns = new Map();
  let turnId;
  const normalizedType = type => ({ usermessage: 'userMessage', agentmessage: 'agentMessage',
    commandexecution: 'commandExecution', plan: 'plan' })[String(type).toLowerCase()] ?? type;
  const text = item => (item.text ?? (item.content ?? []).map(part => part.text ?? '').join('\n'));
  for (const [index, record] of records.entries()) {
    const p = record.payload ?? {};
    turnId = p.turn_id ?? p.internal_chat_message_metadata_passthrough?.turn_id ?? turnId;
    if (!turnId) continue;
    let turn = turns.get(turnId);
    if (!turn) turns.set(turnId, turn = { id: turnId, startedAt: record.timestamp, status: 'inProgress', items: [] });
    if (p.type === 'task_complete' || p.type === 'turn_aborted') {
      turn.status = p.type === 'task_complete' ? 'completed' : p.reason ?? 'interrupted';
      turn.completedAt = record.timestamp;
      for (const item of turn.items) if (item.status === 'inProgress') item.status = 'completed';
    }
    let item;
    if (record.type === 'event_msg' && p.type === 'item_completed') {
      item = { ...p.item, type: normalizedType(p.item.type), aggregatedOutput: p.item.aggregated_output };
      const previous = turn.items.findLastIndex(value => value.fixtureRaw && value.type === item.type &&
        text(value) === text(item));
      if (previous >= 0) turn.items.splice(previous, 1);
      if (item.type === 'commandExecution') {
        const paired = turn.items.findLastIndex(value => value.type === item.type &&
          (typeof value.command === 'string' ? value.command : value.command?.at(-1)) === item.command?.at?.(-1));
        if (paired >= 0) turn.items.splice(paired, 1);
      }
    } else if (record.type === 'response_item' && p.type === 'message' && p.role === 'assistant') {
      item = { ...p, id: p.id ?? `fixture-answer-${index}`, type: 'agentMessage', fixtureRaw: true };
    } else if (record.type === 'response_item' && p.type === 'message' && p.role === 'user' &&
        p.internal_chat_message_metadata_passthrough?.content_item_kinds?.some(kind => kind.startsWith('user.'))) {
      item = { ...p, id: p.id ?? `fixture-user-${index}`, type: 'userMessage', fixtureRaw: true,
        content: p.content.map(part => part.type === 'input_text' ? { ...part, type: 'text' } : part) };
    } else if (record.type === 'response_item' && p.type === 'function_call' && p.name === 'shell') {
      item = { id: `rollout_${p.call_id}`, type: 'commandExecution', status: 'inProgress', command: JSON.parse(p.arguments).command };
    }
    if (item) turn.items.push(item);
  }
  return [...turns.values()];
}

async function fixture(t, records) {
  const directory = await mkdtemp(join(tmpdir(), 'relayune-history-index-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'rollout.jsonl');
  await writeFile(path, serialize(records));
  const reads = [];
  const adapter = () => {
    const value = new CodexAppServerAdapter({ workspace: directory });
    value.refreshHistoryPermissions = () => {};
    value.request = async (method, params) => {
      if (method === 'thread/list') return { data: [] };
      assert.equal(method, 'thread/read');
      reads.push(params);
      // Provider seeding preserves IDs, timestamps and older compacted history.
      // After that one cold read, the owning JSONL is the incremental source.
      const turns = params.includeTurns ? materializedTurns((await readFile(path, 'utf8')).split('\n').filter(Boolean).map(JSON.parse)) : undefined;
      return { thread: { id: 'thread', path, cwd: directory, status: { type: 'notLoaded' }, ...(turns ? { turns } : {}) } };
    };
    t.after(() => value.close());
    return value;
  };
  return { directory, path, reads, adapter };
}

const desktopUser = (id, text, images = []) => row('response_item', {
  type: 'message', id, role: 'user',
  content: [{ type: 'input_text', text }, ...images.map(image_url => ({ type: 'input_image', image_url }))],
  internal_chat_message_metadata_passthrough: {
    turn_id: 'one', content_item_kinds: ['user.text', ...images.map(() => 'user.image')],
  },
});
const desktopUserReceipt = (client_id, message) => row('event_msg', {
  type: 'user_message', client_id, message, images: [], local_images: [],
});

for (const distinctProviderIds of [false, true]) test(`Desktop companion receipts preserve distinct sends through cold/warm history: provider IDs differ=${distinctProviderIds}`, async t => {
  const image = 'data:image/png;base64,YWJj';
  const records = [meta, start('one'),
    desktopUser('raw-a', 'same text', [image]), desktopUserReceipt('client-a', 'same text'),
    desktopUser('raw-b', 'same text', [image]), desktopUserReceipt('client-b', 'same text')];
  const f = await fixture(t, records);
  for (const restart of [false, true]) {
    const a = f.adapter();
    const request = a.request.bind(a);
    a.request = async (method, params) => {
      const result = await request(method, params);
      if (distinctProviderIds) for (const turn of result.thread?.turns ?? [])
        for (const item of turn.items) item.id = item.id.replace('raw-', 'native-');
      return result;
    };
    for (const warm of [false, true]) {
      const page = await a.readHistory({ sessionId: 'thread', limit: 500, includeAgentDetails: false });
      assert.deepEqual(page.messages.map(m => m.client_message_id), ['client-a', 'client-b'], `restart=${restart}, warm=${warm}`);
      assert.deepEqual(page.messages.map(m => m.id), distinctProviderIds ? ['native-a', 'native-b'] : ['raw-a', 'raw-b']);
      assert.ok(page.messages.every(m => m.attachments.length === 1));
    }
  }
});

test('a companion receipt appended after provider seeding upgrades the existing input once', async t => {
  const f = await fixture(t, [meta, start('one'), desktopUser('raw-a', 'same text')]);
  const a = f.adapter();
  const request = a.request.bind(a);
  a.request = async (method, params) => {
    const result = await request(method, params);
    for (const turn of result.thread?.turns ?? []) for (const item of turn.items) item.id = 'native-a';
    return result;
  };
  const read = () => a.readHistory({ sessionId: 'thread', limit: 500, includeAgentDetails: false });
  assert.equal((await read()).messages[0].client_message_id, null);
  await appendFile(f.path, serialize([desktopUserReceipt('client-a', 'same text')]));
  const page = await read();
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].id, 'native-a');
  assert.equal(page.messages[0].client_message_id, 'client-a');
  await appendFile(f.path, serialize([desktopUser('raw-b', 'same text'), desktopUserReceipt('client-b', 'same text')]));
  assert.deepEqual((await read()).messages.map(m => m.client_message_id), ['client-a', 'client-b']);
});

test('typed user completion retains the companion identity and does not steal another submission identity', async t => {
  const f = await fixture(t, [meta, start('one'),
    desktopUser('raw-a', 'same text'), desktopUserReceipt('client-a', 'same text'),
    row('event_msg', {type: 'item_completed', turn_id: 'one', item: {
      type: 'UserMessage', id: 'native-a', content: [{type: 'text', text: 'same text'}],
    }}),
    desktopUser('raw-b', 'same text'), desktopUserReceipt('client-a', 'same text'),
    desktopUserReceipt('client-b', 'same text')]);
  const a = f.adapter();
  const projection = await a.rolloutHistoryIndex.read(f.path, 'thread');
  assert.deepEqual(projection.messages.map(m => [m.id, m.client_message_id]), [
    ['native-a', 'client-a'], ['raw-b', 'client-b'],
  ]);
});

test('companion receipts do not correlate across turns or overwrite an explicit client ID', async t => {
  const raw = desktopUser('raw-a', 'same text');
  raw.payload.client_id = 'explicit-a';
  const f = await fixture(t, [meta, start('one'), raw,
    desktopUserReceipt('wrong-a', 'same text'),
    desktopUser('raw-b', 'different text'), desktopUserReceipt('wrong-b', 'same text'),
    start('two'), desktopUserReceipt('wrong-turn', 'different text')]);
  const projection = await f.adapter().rolloutHistoryIndex.read(f.path, 'thread');
  assert.deepEqual(projection.messages.map(m => m.client_message_id), ['explicit-a', null]);
});

test('native paginated history recovers companion IDs when display items omit them', async t => {
  const f = await fixture(t, [meta, start('one'),
    desktopUser('raw-a', 'same text'), desktopUserReceipt('client-a', 'same text'),
    desktopUser('raw-b', 'same text'), desktopUserReceipt('client-b', 'same text')]);
  const a = f.adapter();
  const calls = [];
  const request = a.request.bind(a);
  a.request = async (method, params) => {
    calls.push(method);
    if (method === 'thread/turns/list') return { data: [{ id: 'one', status: 'inProgress', startedAt: at, items: [] }], nextCursor: null };
    if (method === 'thread/items/list') return { data: ['a', 'b'].map(id => ({ turnId: 'one', item: {
      type: 'userMessage', id: `native-${id}`, content: [{ type: 'text', text: 'same text' }],
    }})), nextCursor: null };
    const result = await request(method, params);
    if (result.thread) result.thread.historyMode = 'paginated';
    return result;
  };
  const page = await a.readHistory({ sessionId: 'thread', limit: 100, includeAgentDetails: false });
  assert.ok(calls.includes('thread/items/list'));
  assert.deepEqual(page.messages.map(m => [m.id, m.client_message_id]), [
    ['native-a', 'client-a'], ['native-b', 'client-b'],
  ]);
});

test('image-only input keeps its receipt identity and a late typed item does not duplicate a seeded input', async t => {
  const f = await fixture(t, [meta, start('one'),
    desktopUser('raw-a', '', ['data:image/png;base64,YWJj']), desktopUserReceipt('client-a', '')]);
  const a = f.adapter();
  const read = () => a.readHistory({ sessionId: 'thread', limit: 500, includeAgentDetails: false });
  assert.equal((await read()).messages[0].client_message_id, 'client-a');
  await appendFile(f.path, serialize([row('event_msg', {type: 'item_completed', turn_id: 'one', item: {
    type: 'UserMessage', id: 'native-a', content: [{type: 'image', url: 'data:image/png;base64,YWJj'}],
  }})]));
  const page = await read();
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].client_message_id, 'client-a');
  assert.equal(page.messages[0].attachments.length, 1);
});

test('large source images remain outside history cache and pages, including a Relay restart', async t => {
  const image = `data:image/png;base64,${Buffer.alloc(14 * 1024 * 1024, 42).toString('base64')}`;
  const records = [meta, start('old'), user('old', 'old-user', 'old'), answer('old', 'old-answer', 'old reply'), done('old'),
    start('latest'), user('latest', 'latest-user', 'inspect image', [{ type: 'image', url: image }]),
    row('response_item', { type: 'custom_tool_call_output', call_id: 'image-tool', output: [{ type: 'input_image', image_url: image }] }),
    answer('latest', 'latest-answer', 'image reply'), done('latest')];
  const f = await fixture(t, records);
  const a = f.adapter();
  const page = await a.readHistory({ sessionId: 'thread', limit: 2, includeAgentDetails: false });
  assert.deepEqual(page.messages.map(message => message.id), ['latest-user', 'latest-answer']);
  assert.ok(JSON.stringify(page).length < 4000);
  const refs = page.messages.flatMap(message => message.attachments ?? []).map(attachment => attachment.relay_source);
  assert.equal(refs.length, 2);
  for (const source of refs) {
    assert.equal(source.type, 'rollout_jsonl');
    assert.equal(await readRolloutAttachmentDataUrl(source), image);
  }
  const earlier = await a.readHistory({ sessionId: 'thread', before: page.next_cursor, limit: 2, includeAgentDetails: false });
  assert.deepEqual(earlier.messages.map(message => message.id), ['old-user', 'old-answer']);
  assert.equal([...a.rolloutHistoryIndex.entries.values()][0].state.readBytes, 0);
  assert.ok([...a.rolloutHistoryIndex.entries.values()][0].bytes < 16 * 1024);
  assert.equal(f.reads.filter(read => read.includeTurns).length, 1);
  const restored = f.adapter();
  const restartPage = await restored.readHistory({ sessionId: 'thread', before: page.next_cursor, limit: 2, includeAgentDetails: false });
  assert.deepEqual(restartPage.messages.map(message => message.id), ['old-user', 'old-answer']);
  assert.equal(f.reads.filter(read => read.includeTurns).length, 2);
});

test('source progress counts actual cold and appended scan bytes and tolerates failed UI hints', async t => {
  const f = await fixture(t, [meta, start('one'), user('one', 'u1', 'hello'),
    answer('one', 'a1', '你好'.repeat(100000)), done('one')]);
  const a = f.adapter();
  const seen = [];
  const page = await a.readHistory({sessionId: 'thread', limit: 500,
    includeAgentDetails: false, onProgress: sample => seen.push(sample)});
  const size = (await stat(f.path)).size;
  assert.deepEqual(seen[0], {source_read_bytes: 0, source_total_bytes: size});
  assert.deepEqual(seen.at(-1), {source_read_bytes: size, source_total_bytes: size});
  assert.ok(seen.length >= 3, 'multi-chunk reads must produce actual intermediate counts');
  assert.ok(seen.every((sample, index) => sample.source_read_bytes <= size &&
    (!index || sample.source_read_bytes >= seen[index - 1].source_read_bytes)));
  seen.length = 0;
  await a.readHistory({sessionId: 'thread', limit: 500, includeAgentDetails: false,
    onProgress: sample => seen.push(sample)});
  assert.deepEqual(seen, [{source_read_bytes: 0, source_total_bytes: 0}]);
  const addition = serialize([start('two'), user('two', 'u2', 'new'), done('two')]);
  await appendFile(f.path, addition);
  seen.length = 0;
  const appended = await a.readHistory({sessionId: 'thread', limit: 500, includeAgentDetails: false,
    onProgress: sample => {seen.push(sample); throw new Error('UI fixture unavailable');}});
  const delta = Buffer.byteLength(addition);
  assert.deepEqual(seen.at(-1), {source_read_bytes: delta, source_total_bytes: delta});
  assert.deepEqual(appended.messages.slice(0, page.messages.length), page.messages);
  assert.equal(appended.messages.at(-1).id, 'u2');
});

test('cold complete history overlaps provider materialization and source scanning but warm history reuses its seed', { timeout: 2000 }, async t => {
  const f = await fixture(t, [meta, start('one'), user('one', 'u1', 'hello'), answer('one', 'a1', 'world'), done('one')]);
  const a = f.adapter();
  let startProjection;
  let startProvider;
  const projectionStarted = new Promise(resolve => { startProjection = resolve; });
  const providerStarted = new Promise(resolve => { startProvider = resolve; });
  const request = a.request.bind(a);
  a.request = async (method, params) => {
    if (method === 'thread/read' && params.includeTurns) {
      startProvider();
      await projectionStarted;
    }
    return request(method, params);
  };
  const readProjection = a.rolloutHistoryIndex.read.bind(a.rolloutHistoryIndex);
  a.rolloutHistoryIndex.read = async (...args) => {
    startProjection();
    await providerStarted;
    return readProjection(...args);
  };
  const page = await a.readHistory({ sessionId: 'thread', limit: 500, includeAgentDetails: false });
  assert.deepEqual(page.messages.map(message => message.id), ['u1', 'a1']);
  assert.equal(f.reads.filter(read => read.includeTurns).length, 1);
  assert.deepEqual(await a.readHistory({ sessionId: 'thread', limit: 500, includeAgentDetails: false }), page);
  assert.equal(f.reads.filter(read => read.includeTurns).length, 1, 'warm history must not prefetch another full RPC');
});

test('a source rewrite during complete parallel history cannot calibrate or cache the earlier snapshot', async t => {
  const f = await fixture(t, [meta, start('one'), user('one', 'u1', 'before'), answer('one', 'a1', 'old reply'), done('one')]);
  const a = f.adapter();
  let projectionCaptured;
  const captured = new Promise(resolve => { projectionCaptured = resolve; });
  const readProjection = a.rolloutHistoryIndex.read.bind(a.rolloutHistoryIndex);
  a.rolloutHistoryIndex.read = async (...args) => {
    const projection = await readProjection(...args);
    projectionCaptured();
    return projection;
  };
  const request = a.request.bind(a);
  let rewrite = true;
  a.request = async (method, params) => {
    const result = await request(method, params);
    if (method === 'thread/read' && params.includeTurns && rewrite) {
      rewrite = false;
      await captured;
      await writeFile(f.path, serialize([meta, start('one'), user('one', 'u1', 'after rewrite'), answer('one', 'a1', 'new reply'), done('one')]));
    }
    return result;
  };
  await a.readHistory({ sessionId: 'thread', limit: 500, includeAgentDetails: false });
  assert.equal([...a.rolloutHistoryIndex.entries.values()][0].state.providerSeed, undefined);
  assert.equal(a.historyPages.has('thread'), false);
  const fresh = await a.readHistory({ sessionId: 'thread', limit: 500, includeAgentDetails: false });
  assert.deepEqual(fresh.messages.map(message => message.content), ['after rewrite', 'new reply']);
  assert.equal(f.reads.filter(read => read.includeTurns).length, 2);
});

test('complete parallel history propagates provider failure and does not leave a usable seed', async t => {
  const f = await fixture(t, [meta, start('one'), user('one', 'u1', 'hello'), done('one')]);
  const a = f.adapter();
  const request = a.request.bind(a);
  const failure = Object.assign(new Error('fixture permission failure'), { code: 'EACCES' });
  a.request = async (method, params) => {
    if (method === 'thread/read' && params.includeTurns) throw failure;
    return request(method, params);
  };
  await assert.rejects(a.readHistory({ sessionId: 'thread', limit: 500, includeAgentDetails: false }), error => error === failure);
  assert.equal([...a.rolloutHistoryIndex.entries.values()][0].state.providerSeed, undefined);
  assert.equal(a.historyPages.has('thread'), false);
});

test('append parsing is incremental, partial UTF-8 rows stay pending, and page boundaries survive appends', async t => {
  const f = await fixture(t, [meta, start('one'), user('one', 'u1', 'hello'), answer('one', 'a1', 'world'), done('one')]);
  const a = f.adapter();
  const page = await a.readHistory({ sessionId: 'thread', limit: 1, includeAgentDetails: false });
  const originalSize = (await stat(f.path)).size;
  const addition = Buffer.from(serialize([start('two'), user('two', 'u2', '你好'), answer('two', 'a2', 'new reply'), done('two')]));
  const split = addition.indexOf(Buffer.from('你好')) + 1;
  await appendFile(f.path, addition.subarray(0, split));
  let partial = await a.readHistory({ sessionId: 'thread', limit: 10, includeAgentDetails: false });
  assert.deepEqual(partial.messages.map(message => message.id), ['u1', 'a1']);
  await appendFile(f.path, addition.subarray(split));
  const latest = await a.readHistory({ sessionId: 'thread', limit: 10, includeAgentDetails: false });
  assert.deepEqual(latest.messages.map(message => message.id), ['u1', 'a1', 'u2', 'a2']);
  assert.equal(latest.messages[2].content, '你好');
  const entry = [...a.rolloutHistoryIndex.entries.values()][0];
  assert.ok(entry.state.readBytes < originalSize + addition.length);
  const earlier = await a.readHistory({ sessionId: 'thread', before: page.next_cursor, limit: 10, includeAgentDetails: false });
  assert.deepEqual(earlier.messages.map(message => message.id), ['u1']);
  assert.equal(f.reads.filter(read => read.includeTurns).length, 1);
});

test('truncation, inode replacement and same-size rewrites invalidate the projection and stale attachment refs', async t => {
  const output = value => row('response_item', { type: 'custom_tool_call_output', call_id: 'image',
    output: [{ type: 'input_image', image_url: `data:image/png;base64,${value}` }] });
  const f = await fixture(t, [meta, start('one'), output('aGVsbG8='), answer('one', 'a1', 'before'), done('one')]);
  const a = f.adapter();
  const page = await a.readHistory({ sessionId: 'thread', includeAgentDetails: false });
  const source = page.messages[0].attachments[0].relay_source;
  const oldBytes = await readFile(f.path, 'utf8');
  await writeFile(f.path, oldBytes.replace('aGVsbG8=', 'd29ybGQ=').replace('before', 'after!'));
  await assert.rejects(readRolloutAttachmentDataUrl(source), /source changed/);
  const rewritten = await a.readHistory({ sessionId: 'thread', includeAgentDetails: false });
  assert.equal(rewritten.messages[0].content, 'after!');
  const replacement = join(f.directory, 'replacement');
  await writeFile(replacement, serialize([meta, start('new'), user('new', 'new-user', 'new'), done('new')]));
  await rename(replacement, f.path);
  const replaced = await a.readHistory({ sessionId: 'thread', includeAgentDetails: false });
  assert.deepEqual(replaced.messages.map(message => message.id), ['new-user']);
  await writeFile(f.path, serialize([meta]));
  const truncated = await a.readHistory({ sessionId: 'thread', includeAgentDetails: false });
  assert.deepEqual(truncated.messages, []);
  const link = join(f.directory, 'link');
  await symlink(f.path, link);
  await assert.rejects(readRolloutAttachmentDataUrl({ ...source, path: link }));
});

test('modern injected context is excluded and native user IDs, terminal tools and questions survive projection', async t => {
  const f = await fixture(t, [meta, start('one'),
    row('response_item', { type: 'message', id: 'context', role: 'user', content: [{ type: 'input_text', text: 'private environment' }],
      internal_chat_message_metadata_passthrough: { content_item_kinds: ['environments.environment_context'] } }),
    row('response_item', { type: 'message', id: 'actual', role: 'user', content: [{ type: 'input_text', text: 'hello' }],
      internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] } }),
    user('one', 'native-user', 'hello'),
    row('response_item', { type: 'function_call', call_id: 'tool', name: 'shell', arguments: '{"command":"pwd"}' }),
    row('event_msg', { type: 'turn_aborted', turn_id: 'one', reason: 'interrupted' })]);
  const a = f.adapter();
  const page = await a.readHistory({ sessionId: 'thread', includeAgentDetails: false });
  assert.equal(page.messages.filter(message => message.role === 'user').length, 1);
  assert.equal(page.messages.find(message => message.role === 'user').id, 'native-user');
  assert.doesNotMatch(JSON.stringify(page), /private environment/);
  assert.equal(page.messages.find(message => message.kind === 'tool_activity').tool_activity_status, 'completed');
  assert.ok(page.messages.every(message => message.turn_status === 'interrupted'));
});

test('encrypted attachment store persists small source refs and safely replaces identical inline bodies', async t => {
  const image = 'data:image/png;base64,aGVsbG8=';
  const f = await fixture(t, [meta, start('one'), user('one', 'u', 'image', [{ type: 'image', url: image }]), done('one')]);
  const page = await f.adapter().readHistory({ sessionId: 'thread', includeAgentDetails: false });
  const attachment = page.messages[0].attachments[0];
  const options = { path: join(f.directory, 'attachments.db'), key: randomBytes(32).toString('base64url'), deviceId: 'fixture' };
  const record = { name: attachment.name, type: attachment.type, mimeType: attachment.mime_type, detail: attachment.detail };
  const store = new AttachmentStore(options);
  store.put('thread', attachment.id, { ...record, source: { type: 'data_url', url: image } });
  store.put('thread', attachment.id, { ...record, source: attachment.relay_source });
  assert.deepEqual(store.get('thread', attachment.id).source, attachment.relay_source);
  const summary = store.database.prepare('SELECT source_kind, byte_size, body_ciphertext FROM attachment_entries').get();
  assert.equal(summary.source_kind, 'local_path');
  assert.equal(summary.byte_size, 0);
  assert.equal(summary.body_ciphertext, null);
  assert.throws(() => store.put('thread', attachment.id, { ...record,
    source: { ...attachment.relay_source, content_digest: 'f'.repeat(64) } }), /different content/);
  store.close();
  const restored = new AttachmentStore(options);
  t.after(() => restored.close());
  assert.equal(await readRolloutAttachmentDataUrl(restored.get('thread', attachment.id).source), image);
});

test('legacy sources preserve a provider seed while later pages and appends avoid full reads', async t => {
  const f = await fixture(t, [start('one'), user('one', 'native-u', 'hello'), answer('one', 'raw-a', 'reply'), done('one')]);
  const a = f.adapter();
  let fullReads = 0;
  a.request = async (method, params) => {
    if (method === 'thread/list') return { data: [] };
    assert.equal(method, 'thread/read');
    const thread = { id: 'thread', path: f.path, cwd: f.directory };
    if (!params.includeTurns) return { thread: { ...thread, turns: [] } };
    fullReads += 1;
    return { thread: { ...thread, turns: [{ id: 'one', startedAt: at, completedAt: at, status: 'completed', items: [
      { type: 'userMessage', id: 'native-u', content: [{ type: 'text', text: 'hello' }] },
      { type: 'agentMessage', id: 'native-a', text: 'reply', phase: 'final_answer' },
    ] }] } };
  };
  const latest = await a.readHistory({ sessionId: 'thread', limit: 1, includeAgentDetails: false });
  assert.deepEqual(latest.messages.map(message => message.id), ['native-a']);
  const older = await a.readHistory({ sessionId: 'thread', before: latest.next_cursor, limit: 2, includeAgentDetails: false });
  assert.deepEqual(older.messages.map(message => message.id), ['native-u']);
  await appendFile(f.path, serialize([start('two'), user('two', 'u2', 'new'), answer('two', 'a2', 'new reply'), done('two')]));
  const appended = await a.readHistory({ sessionId: 'thread', includeAgentDetails: false });
  assert.deepEqual(appended.messages.map(message => message.id), ['native-u', 'native-a', 'u2', 'a2']);
  assert.equal(fullReads, 1, 'a calibrated legacy source serves known appends without re-reading the native snapshot');
});

test('native questions are restored from compact history and later answers settle them after appends', async t => {
  const timestamp = new Date().toISOString();
  const questionId = JSON.stringify(['request_user_input_async', 'question', 0]);
  const question = { type: 'AgentMessage', id: 'question', text: '', questions: [{ title: 'Choose a color', options: ['Blue', 'Green'] }] };
  const f = await fixture(t, [meta, { ...start('one'), timestamp },
    { ...row('event_msg', { type: 'item_completed', turn_id: 'one', started_at_ms: Date.now(), item: question }), timestamp }, done('one')]);
  const a = f.adapter();
  const approvals = [];
  const events = [];
  a.handlers = { requestApproval: async approval => approvals.push(approval), emitEvent: async (_id, event) => events.push(event) };
  await a.readHistory({ sessionId: 'thread', includeAgentDetails: false });
  assert.equal(approvals.length, 1);
  await appendFile(f.path, serialize([start('two'), user('two', 'answer',
    `<send_user_message_question_reply>\n${JSON.stringify([{ questionItemId: questionId, question: 'Choose a color', answer: 'Blue' }])}\n</send_user_message_question_reply>`), done('two')]));
  await a.readHistory({ sessionId: 'thread', includeAgentDetails: false });
  assert.ok(events.some(event => event.kind === 'approval.resolved' && event.decision === 'approved'));
  assert.equal(approvals.length, 1);
});

test('paired raw and native items keep provider IDs, command details and repeat user messages', async t => {
  const rawUser = text => row('response_item', { type: 'message', role: 'user', id: `raw-${text}`, content: [{ type: 'input_text', text }],
    internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] } });
  const f = await fixture(t, [meta, start('one'), rawUser('continue'), user('one', 'u1', 'continue'),
    rawUser('continue'), user('one', 'u2', 'continue'),
    row('response_item', { type: 'function_call', call_id: 'shell', name: 'shell', arguments: '{"command":"pwd"}' }),
    row('event_msg', { type: 'item_completed', turn_id: 'one', completed_at_ms: Date.parse(at), item: {
      type: 'CommandExecution', id: 'native-tool', command: ['zsh', '-lc', 'pwd'], status: 'Completed', aggregated_output: 'fixture output' } }),
    answer('one', 'raw-answer', 'reply'), row('event_msg', { type: 'item_completed', turn_id: 'one',
      completed_at_ms: Date.parse(at), item: { type: 'AgentMessage', id: 'native-answer', phase: 'final_answer',
        content: [{ type: 'output_text', text: 'reply' }] } }), done('one')]);
  const page = await f.adapter().readHistory({ sessionId: 'thread', includeAgentDetails: false });
  assert.deepEqual(page.messages.map(message => message.id), ['u1', 'u2', 'command_one_native-tool', 'native-answer']);
  assert.equal(page.messages[2].tool_activity_detail, 'fixture output');
});

test('raw repeated same-turn input without provider IDs has distinct stable source IDs', async t => {
  const input = row('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'continue' }],
    internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] } });
  const f = await fixture(t, [meta, start('one'), input, input, done('one')]);
  const a = f.adapter();
  const page = await a.readHistory({ sessionId: 'thread', includeAgentDetails: false });
  assert.equal(page.messages.length, 2);
  assert.notEqual(page.messages[0].id, page.messages[1].id);
  const restarted = await f.adapter().readHistory({ sessionId: 'thread', includeAgentDetails: false });
  assert.deepEqual(restarted.messages.map(message => message.id), page.messages.map(message => message.id));
});

test('mismatched source identities are rejected before messages can be supplemented or cached', async t => {
  const f = await fixture(t, [row('session_meta', { id: 'another-thread' }), start('one'), user('one', 'u', 'wrong session')]);
  const a = f.adapter();
  await assert.rejects(a.readHistory({ sessionId: 'thread', includeAgentDetails: false }), /does not match/);
  assert.equal(a.rolloutHistoryIndex.entries.size, 0);
  assert.equal(f.reads.filter(read => read.includeTurns).length, 0);
});

test('untyped legacy user provenance keeps native history authoritative', async t => {
  const f = await fixture(t, [meta, start('one'), row('response_item', { type: 'message', role: 'user',
    content: [{ type: 'input_text', text: 'legacy injected context' }] }), done('one')]);
  const a = f.adapter();
  let fullReads = 0;
  a.request = async (method, params) => {
    if (method === 'thread/list') return { data: [] };
    const thread = { id: 'thread', path: f.path, cwd: f.directory };
    if (!params.includeTurns) return { thread };
    fullReads += 1;
    return { thread: { ...thread, turns: [{ id: 'one', status: 'completed', items: [
      { id: 'native', type: 'userMessage', content: [{ type: 'text', text: 'actual input' }] },
    ] }] } };
  };
  const page = await a.readHistory({ sessionId: 'thread', includeAgentDetails: false });
  assert.equal(fullReads, 1);
  assert.deepEqual(page.messages.filter(message => message.role === 'user').map(message => message.id), ['native']);
});

test('a provider terminal seed stays terminal when the source lacks a completion record', async t => {
  const f = await fixture(t, [meta, start('one'), user('one', 'u1', 'continue')]);
  const a = f.adapter();
  let fullReads = 0;
  a.request = async (method, params) => {
    if (method === 'thread/list') return { data: [] };
    const thread = { id: 'thread', path: f.path, cwd: f.directory };
    if (!params.includeTurns) return { thread };
    fullReads += 1;
    return { thread: { ...thread, turns: [{ id: 'one', status: 'completed', startedAt: at, completedAt: at, items: [
      { id: 'u1', type: 'userMessage', content: [{ type: 'text', text: 'continue' }] },
      { id: 'tool', type: 'commandExecution', command: 'pwd', status: 'completed', aggregatedOutput: 'done' },
    ] }] } };
  };
  const cold = await a.readHistory({ sessionId: 'thread', includeAgentDetails: false });
  const warm = await a.readHistory({ sessionId: 'thread', includeAgentDetails: false });
  assert.deepEqual(warm.messages, cold.messages);
  assert.ok(warm.messages.every(message => message.turn_status === 'completed'));
  assert.equal(warm.messages.find(message => message.kind === 'tool_activity').tool_activity_status, 'completed');
  assert.equal(fullReads, 1);
});

test('new typed items with the same text in the same turn survive a calibrated seed', async t => {
  const f = await fixture(t, [meta, start('one'), user('one', 'u1', 'continue'),
    row('event_msg', { type: 'item_completed', turn_id: 'one', item: {
      id: 'a1', type: 'AgentMessage', phase: 'final_answer', text: 'same reply' } })]);
  const a = f.adapter();
  const cold = await a.readHistory({ sessionId: 'thread', includeAgentDetails: false });
  assert.deepEqual(cold.messages.map(message => message.id), ['u1', 'a1']);
  await appendFile(f.path, serialize([user('one', 'u2', 'continue'),
    row('event_msg', { type: 'item_completed', turn_id: 'one', item: {
      id: 'a2', type: 'AgentMessage', phase: 'final_answer', text: 'same reply' } })]));
  const warm = await a.readHistory({ sessionId: 'thread', includeAgentDetails: false });
  assert.deepEqual(warm.messages.map(message => message.id), ['u1', 'a1', 'u2', 'a2']);
  assert.equal(f.reads.filter(read => read.includeTurns).length, 1);
});

test('native missing phases and raw final answers refer to one native message', async t => {
  const f = await fixture(t, [meta, start('one'), answer('one', 'raw-answer', 'reply'), done('one')]);
  const a = f.adapter();
  let fullReads = 0;
  a.request = async (method, params) => {
    if (method === 'thread/list') return { data: [] };
    const thread = { id: 'thread', path: f.path, cwd: f.directory };
    if (!params.includeTurns) return { thread };
    fullReads += 1;
    return { thread: { ...thread, turns: [{ id: 'one', startedAt: at, completedAt: at, status: 'completed', items: [
      { id: 'native-answer', type: 'agentMessage', text: 'reply' },
    ] }] } };
  };
  const cold = await a.readHistory({ sessionId: 'thread', includeAgentDetails: false });
  const warm = await a.readHistory({ sessionId: 'thread', includeAgentDetails: false });
  assert.deepEqual(cold.messages.map(message => message.id), ['native-answer']);
  assert.deepEqual(warm.messages, cold.messages);
  assert.equal(fullReads, 1);
});

test('failed Desktop completion survives cold, incremental, paged and restarted history', async t => {
  const failed = id => row('event_msg', { type: 'task_complete', turn_id: id, last_agent_message: null,
    error: { message: 'stream disconnected before completion: error sending request', codex_error_info: 'other' } });
  const f = await fixture(t, [meta, start('one'), user('one', 'u1', 'first'), failed('one')]);
  const a = f.adapter();
  const read = (adapter, extra = {}) => adapter.readHistory({ sessionId: 'thread', limit: 500, includeAgentDetails: false, ...extra });
  const verify = (page, ids) => {
    const failures = page.messages.filter(message => message.kind === 'turn.failed');
    assert.deepEqual(failures.map(message => message.id), ids.map(id => `turn-terminal:${id}`));
    assert.ok(failures.every(message => message.content === failed('').payload.error.message));
    assert.ok(page.messages.every(message => message.turn_status === 'failed'));
  };
  verify(await read(a), ['one']);
  await appendFile(f.path, serialize([start('two'), user('two', 'u2', 'scheduled retry'), failed('two')]));
  verify(await read(a), ['one', 'two']);
  const page = await read(a, { limit: 2 });
  verify(page, ['two']);
  verify(await read(a, { limit: 2, before: page.next_cursor }), ['one']);
  verify(await read(f.adapter()), ['one', 'two']);
});
