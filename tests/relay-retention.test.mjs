import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, utimes, mkdir, symlink, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { EVENT_WINDOW_MS, RESPONSE_WINDOW_MS, transportPayloadExpired, withinRetention } from '../shared/relay-retention.mjs';
import { RelayOutbox } from '../relay/outbox.mjs';
import { MacRelay } from '../relay/mac-relay.mjs';

const directory = await mkdtemp(join(tmpdir(), 'relay-retention-test-'));
const bundle = join(directory, 'store.cjs');
await build({stdin: {contents: `export * from './server/relay-blob-store.ts'; export * from './server/relay-retention.ts'; export * from './server/mongo-store.ts';`, resolveDir: process.cwd()}, bundle: true, format: 'cjs', platform: 'node', outfile: bundle});
const { FileBlobStore, sweepRelayRetention, MongoStore, initializeRelayMongo } = createRequire(import.meta.url)(bundle);
test.after(() => rm(directory, {recursive: true, force: true}));
const frame = (kind, time, browser = 'a') => ({kind, aad: {created_at: new Date(time).toISOString()}, event_id: 'e1', event_seq: 1, browser_id: browser, request_id: 'req'});

test('transport windows exclude the exact expiry boundary and invalid timestamps', () => {
  const now = Date.now();
  assert.equal(EVENT_WINDOW_MS, 600_000);
  assert.equal(RESPONSE_WINDOW_MS, 300_000);
  for (const [kind, window] of [['event', EVENT_WINDOW_MS], ['response', RESPONSE_WINDOW_MS]]) {
    assert.equal(transportPayloadExpired(frame(kind, now - window + 1), now), false);
    assert.equal(transportPayloadExpired(frame(kind, now - window), now), true);
    assert.equal(transportPayloadExpired({kind}, now), true);
    assert.equal(withinRetention(now + 121_000, window, now), false);
  }
});

test('offline expiry persists per-recipient pruning without advancing ACK or losing mutation dedup', async () => {
  const now = Date.now(), path = join(directory, 'outbox.json');
  const outbox = new RelayOutbox(path);
  const expired = frame('event', now - EVENT_WINDOW_MS), live = frame('event', now, 'b');
  await outbox.append({type: 'opaque.event.bundle', variants: [expired, live]});
  await outbox.quarantineConflictingVariant(expired);
  outbox.transportRequests.req = {expires: now + 60_000, hash: 'immutable', frames: [frame('response', now - RESPONSE_WINDOW_MS)], bytes: 100};
  await outbox.pruneExpired(now);
  const restored = new RelayOutbox(path); await restored.load();
  assert.deepEqual(restored.after(0)[0].variants, [live]);
  assert.equal(restored.lastAcked, 0);
  assert.equal(restored.transportRequests.req.hash, 'immutable');
  assert.deepEqual(restored.transportRequests.req.frames, []);
  assert.equal(restored.transportRequests.req.bytes, 0);
  await restored.pruneExpired(now + EVENT_WINDOW_MS);
  assert.equal(restored.pending.size, 0);
  assert.equal(restored.nextSeq, 2);
  assert.equal(restored.transportRequests.req, undefined);
});

test('queued retries, isolated rejects and direct events cannot retain expired ciphertext', () => {
  const now = Date.now();
  const relay = new MacRelay({serverUrl: 'https://relay.test', adapter: {}, statePath: null});
  const old = frame('event', now), live = frame('response', now + 1);
  relay.enqueueRemoteMessages([old, live]);
  relay.uploadIsolationBatches.push([relay.uploadQueue.shift()]);
  relay.directEvents.set('old', {frame: old});
  relay.pruneExpiredUploads(now + EVENT_WINDOW_MS);
  assert.equal(relay.uploadQueue.length, 0);
  assert.equal(relay.uploadIsolationBatches.length, 0);
  assert.equal(relay.uploadKeys.size, 0);
  assert.equal(relay.directEvents.size, 0);
});

test('private blobs collect expired, legacy, orphan and temporary files without following symlinks', async () => {
  const root = join(directory, 'blobs'), store = new FileBlobStore(root), now = Date.now();
  const expired = `responses/${now}/device/request/body.json`, live = `responses/${now + 60_000}/device/request/body.json`;
  await store.put(expired, 'expired'); await store.put(live, 'live');
  await store.put('responses/legacy/r/body.json', 'legacy');
  await utimes(join(root, 'responses/legacy/r/body.json'), new Date(now - RESPONSE_WINDOW_MS), new Date(now - RESPONSE_WINDOW_MS));
  await store.put(`commands/${now - 300_001}/d/r/body.json`, 'expired command');
  await store.put(`commands/${now}/d/r/body.json`, 'dedup grace');
  await store.put(`responses/${now}/orphan/write.tmp`, 'orphan');
  const outside = join(directory, 'outside'); await mkdir(outside); await writeFile(join(outside, 'keep'), 'keep');
  await symlink(outside, join(root, 'responses', 'linked'));
  assert.equal(await store.prune(now), 4);
  assert.equal(await store.get(expired), null);
  assert.equal(await (await store.get(live)).text(), 'live');
  assert.equal(await readFile(join(outside, 'keep'), 'utf8'), 'keep');
  await assert.rejects(store.get('../outside/keep'));
  await store.close();
});

test('legacy sweeps bound rows and query time, delete blobs first and keep command grace', async () => {
  const now = Date.now(), calls = [], deleted = [];
  const db = {collection: name => ({
    find(filter, options) {
      calls.push({name, filter, options});
      const cursor = {sort: () => cursor, limit(n) {assert.equal(n, 500); return cursor;},
        toArray: async () => [{_id: `${name}_1`, ...(name === 'relay_events' ? {} : {blob_key: name})}]};
      return cursor;
    },
    async deleteMany(filter, options) {
      assert.equal(options.maxTimeMS, 1000);
      if (name !== 'relay_events') assert.ok(deleted.includes(name));
      assert.equal(filter._id.$in.length, 1);
      return {deletedCount: 1};
    },
  })};
  const removed = await sweepRelayRetention(db, {delete: async key => deleted.push(key), prune: async time => {assert.equal(time, now); return 1;}}, now);
  assert.deepEqual(Object.values(removed), [1, 1, 1, 1]);
  assert.equal(calls[0].filter.created_at.$lte, now - EVENT_WINDOW_MS);
  assert.equal(calls[1].filter.created_at.$lte, now - RESPONSE_WINDOW_MS);
  assert.equal(calls[2].filter.expires_at.$lte, now - 300_000);
  assert.ok(calls.every(c => c.options.maxTimeMS === 1000 && !c.options.projection.envelope));
});

test('Mongo installs date TTLs and device/sequence index; ACK reads force the bounded index', async () => {
  const indexes = [], finds = [];
  const db = {collection: name => ({
    dropIndex: async () => {}, createIndex: async (key, options) => indexes.push({name, key, options}),
    find(filter, options) {
      const call = {filter, options}; finds.push(call);
      const cursor = {hint(index) {call.index = index; return cursor;}, sort(order) {call.order = order; return cursor;}, limit(n) {call.limit = n; return cursor;}, project() {return cursor;}, toArray: async () => []}; return cursor;
    },
  })};
  await initializeRelayMongo(db);
  assert.equal(indexes.filter(i => i.options.expireAfterSeconds === 0 && i.key.retention_expires_at === 1).length, 3);
  assert.ok(indexes.some(i => i.key.device_id === 1 && i.key.event_seq === 1 && !i.key.browser_id));
  await new MongoStore(db).prepare('SELECT event_seq FROM relay_events WHERE device_id = ? AND event_seq > ? ORDER BY event_seq ASC LIMIT 500').bind('d', 77).all();
  assert.equal(finds[0].index, 'relay_events_device_seq_idx');
  assert.equal(finds[0].limit, 500);
  assert.equal(finds[0].options.maxTimeMS, 2000);
});

test('expired cursor recovery stays scoped to its authorization and does not scan payloads', async () => {
  const calls = [];
  const store = new MongoStore({collection: () => ({findOne: async (filter, options) => {
    calls.push({filter, options}); return options.sort ? {cursor: 123} : null;
  }})});
  assert.equal(await store.eventWindow('d', 'b', 0), null);
  assert.equal(calls.length, 0);
  assert.deepEqual(await store.eventWindow('d', 'b', 42), {reset_cursor: 123});
  assert.ok(calls.every(c => c.filter.device_id === 'd' && c.filter.browser_id === 'b' && c.filter.created_at.$gt > 0 && c.options.maxTimeMS === 2000));
  assert.ok(calls[0].filter.$or[0].retention_expires_at.$gt instanceof Date);
});
