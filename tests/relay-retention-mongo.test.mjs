import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {build} from 'esbuild';
import {MongoClient} from 'mongodb';

test('standalone Mongo: strict reads, TTL, legacy cleanup and bounded ACK plans', {skip: !process.env.RELAY_TEST_MONGOD}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-retention-mongo-'));
  const dbpath = join(root, 'db'); await mkdir(dbpath);
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const process = spawn(globalThis.process.env.RELAY_TEST_MONGOD, ['--dbpath', dbpath, '--bind_ip', '127.0.0.1', '--port', String(port), '--wiredTigerCacheSizeGB', '0.25', '--setParameter', 'ttlMonitorSleepSecs=1', '--logpath', join(root, 'mongo.log')], {stdio: 'ignore'});
  t.after(async () => { const stopped = once(process, 'exit'); process.kill('SIGTERM'); await stopped; await rm(root, {recursive: true, force: true}); });
  const client = new MongoClient(`mongodb://127.0.0.1:${port}`, {serverSelectionTimeoutMS: 200, monitorCommands: true});
  for (let attempt = 0; ; attempt++) { try { await client.connect(); break; } catch (error) { if (attempt === 50 || process.exitCode !== null) throw error; await delay(100); } }
  t.after(() => client.close());
  const bundle = join(root, 'store.cjs');
  await build({stdin: {contents: `export * from './server/mongo-store.ts'; export * from './server/relay-retention.ts';`, resolveDir: globalThis.process.cwd()}, bundle: true, format: 'cjs', platform: 'node', outfile: bundle});
  const {MongoStore, initializeRelayMongo, sweepRelayRetention} = createRequire(import.meta.url)(bundle);
  const db = client.db('isolated_retention_test'); await initializeRelayMongo(db);
  const store = new MongoStore(db), now = Date.now();
  // Legacy rows deliberately have no TTL field, so visibility must not depend on GC.
  await db.collection('relay_events').insertMany(Array.from({length: 20_000}, (_, i) => ({
    _id: `old_${i}`, device_id: 'd', browser_id: i % 2 ? 'b' : 'other', cursor: i + 1,
    event_seq: i + 1, event_id: `old_${i}`, created_at: now - 600_000, envelope: 'opaque',
  })));
  await db.collection('relay_events').insertOne({_id: 'live', device_id: 'd', browser_id: 'b', cursor: 20_001, event_seq: 20_001, event_id: 'live', created_at: now, envelope: 'opaque', retention_expires_at: new Date(now + 600_000)});
  const query = 'SELECT cursor, session_id, agent_id, request_id, event_id, event_seq, type, direction, aad, envelope, created_at FROM relay_events WHERE device_id = ? AND browser_id = ? AND cursor > ? ORDER BY cursor ASC LIMIT ?';
  assert.deepEqual((await store.prepare(query).bind('d', 'b', 0, 100).all()).results.map(row => row.cursor), [20_001]);
  assert.deepEqual((await store.prepare(query).bind('d', 'b', 20_001, 100).all()).results, []);
  assert.deepEqual(await store.eventWindow('d', 'b', 40), {reset_cursor: 20_001});
  assert.equal(await store.eventWindow('d', 'b', 20_001), null);
  assert.deepEqual(await store.eventWindow('d', 'other', 20_001), {reset_cursor: 0});
  const explain = await db.collection('relay_events').find({device_id: 'd', event_seq: {$gt: 77}}, {maxTimeMS: 2000}).hint('relay_events_device_seq_idx').sort({event_seq: 1}).limit(500).explain('executionStats');
  assert.equal(explain.executionStats.nReturned, 500);
  assert.ok(explain.executionStats.totalKeysExamined <= 500);
  assert.doesNotMatch(JSON.stringify(explain.queryPlanner.winningPlan), /"stage":"SORT"/);
  const responseQuery = 'SELECT device_id, browser_id, session_id, aad, envelope, blob_key, created_at FROM relay_responses WHERE request_id = ? AND user_id = ?';
  await db.collection('relay_responses').insertMany([
    {_id: 'expired', request_id: 'expired', user_id: 'u', created_at: now - 300_000},
    {_id: 'live', request_id: 'live', user_id: 'u', created_at: now, retention_expires_at: new Date(now + 300_000)},
    {_id: 'ttl', request_id: 'ttl', user_id: 'u', created_at: now - 300_000, retention_expires_at: new Date(now - 1)},
  ]);
  assert.equal(await store.prepare(responseQuery).bind('expired', 'u').first(), null);
  assert.ok(await store.prepare(responseQuery).bind('live', 'u').first());
  // Even a large expired range must delete only the selected identifiers. A
  // time-index delete can scan every old row after finding its 500 matches.
  const batchIds = (await db.collection('relay_events').find({created_at: {$lte: now - 600_000}},
    {projection: {_id: 1}}).sort({created_at: 1}).limit(500).toArray()).map(row => row._id);
  const deletePlan = await db.collection('relay_events').find({_id: {$in: batchIds}, created_at: {$lte: now - 600_000}},
    {projection: {_id: 1}, maxTimeMS: 1000}).hint('_id_').explain('executionStats');
  t.diagnostic(`Delete lookup: ${deletePlan.executionStats.totalKeysExamined} index keys, ${deletePlan.executionStats.totalDocsExamined} documents for ${batchIds.length} selected IDs.`);
  assert.equal(deletePlan.executionStats.nReturned, 500);
  // Sparse $in point ranges can examine an additional boundary key per seek;
  // document reads must still be restricted to the selected 500 IDs.
  assert.ok(deletePlan.executionStats.totalKeysExamined <= 2 * batchIds.length);
  assert.ok(deletePlan.executionStats.totalDocsExamined <= 500);
  assert.match(JSON.stringify(deletePlan.queryPlanner.winningPlan), /"indexName":"_id_"/);
  const deletionCommands = [];
  client.on('commandStarted', event => {
    if (event.commandName === 'delete' && event.command.delete === 'relay_events') {
      for (const statement of event.command.deletes) deletionCommands.push({
        hint: statement.hint, idCount: statement.q._id?.$in?.length,
        hasTimeGuard: typeof statement.q.created_at?.$lte === 'number', maxTimeMS: event.command.maxTimeMS,
      });
    }
  });
  const removed = await sweepRelayRetention(db, {delete: async () => {}});
  assert.equal(removed.relay_events, 500);
  assert.deepEqual(deletionCommands, [{hint: '_id_', idCount: 500, hasTimeGuard: true, maxTimeMS: 1000}]);
  assert.ok(await db.collection('relay_events').findOne({_id: 'live'}));
  // Verify TTL independently of the application sweeper.
  await db.collection('relay_responses').insertOne({_id: 'ttl_only', request_id: 'ttl_only', user_id: 'u', created_at: now, retention_expires_at: new Date(now - 1)});
  for (let attempt = 0; attempt < 100 && await db.collection('relay_responses').findOne({_id: 'ttl_only'}); attempt++) await delay(100);
  assert.equal(await db.collection('relay_responses').findOne({_id: 'ttl_only'}), null);
  assert.ok(await db.collection('relay_responses').findOne({_id: 'live'}));
  t.diagnostic(`ACK examined ${explain.executionStats.totalKeysExamined} keys for 500 rows, without SORT; delete batch examined ${deletePlan.executionStats.totalKeysExamined} keys/${deletePlan.executionStats.totalDocsExamined} documents for 500 IDs, actual delete used _id_; strict reads and TTL passed.`);
});
