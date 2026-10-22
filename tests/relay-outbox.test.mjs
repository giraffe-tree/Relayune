import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RelayOutbox } from '../relay/outbox.mjs';

const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('failed encryption does not reserve an unrecoverable event sequence', async () => {
  const outbox = new RelayOutbox();
  await assert.rejects(outbox.appendWithSequence(async () => { throw Error('seal failed'); }));
  const record = await outbox.append({ type: 'opaque.event.bundle', variants: [] });
  assert.equal(record.event_seq, 1);
});

test('concurrent encryption cannot persist a sequence ahead of an unfinished event', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-outbox-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outbox = new RelayOutbox(join(dir, 'outbox.json'));
  const blocked = gate(); const started = gate();
  const first = outbox.appendWithSequence(async seq => { started.resolve(); await blocked.promise; return { event_seq: seq }; });
  await started.promise;
  const second = outbox.append({ type: 'opaque.event.bundle' });
  await outbox.markProcessedRequest('request-during-encryption');
  const stored = JSON.parse(await readFile(outbox.path, 'utf8'));
  blocked.resolve(); await Promise.all([first, second]);
  assert.equal(stored.nextSeq, 1, 'unfinished sequence reservations must not reach disk');
  const reloaded = new RelayOutbox(outbox.path); await reloaded.load();
  assert.deepEqual(reloaded.after(0).map(x => x.event_seq), [1, 2]);
});

test('a stalled disk coalesces updates and durably includes all waiting callers', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-outbox-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outbox = new RelayOutbox(join(dir, 'outbox.json'));
  const blocked = gate(); const started = gate(); let writes = 0;
  const original = outbox.writeSnapshot?.bind(outbox);
  assert.equal(typeof original, 'function');
  outbox.writeSnapshot = async () => { writes++; if (writes === 1) { started.resolve(); await blocked.promise; } await original(); };
  const first = outbox.markProcessedRequest('first'); await started.promise;
  const rest = Array.from({ length: 200 }, (_, i) => outbox.markProcessedRequest(`request-${i}`));
  blocked.resolve(); await Promise.all([first, ...rest]); await outbox.flush();
  const stored = JSON.parse(await readFile(outbox.path, 'utf8'));
  assert.equal(stored.processedRequests.length, 201);
  assert.ok(writes <= 2, `expected at most two snapshots, got ${writes}`);
});

test('large encrypted backlog stays within a bounded heap during a burst of updates', async t => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const dir = await mkdtemp(join(tmpdir(), 'relay-outbox-memory-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const program = `
    import { RelayOutbox } from ${JSON.stringify(new URL('../relay/outbox.mjs', import.meta.url).href)};
    const outbox = new RelayOutbox(${JSON.stringify(join(dir, 'outbox.json'))});
    for (let i = 1; i <= 128; i++) outbox.pending.set(i, {event_seq: i, envelope: {ciphertext: 'x'.repeat(128 * 1024)}});
    outbox.nextSeq = 129;
    await Promise.all(Array.from({length: 100}, (_, i) => outbox.markProcessedRequest('request-' + i)));
    await outbox.flush();
  `;
  await promisify(execFile)(process.execPath, ['--max-old-space-size=192', '--input-type=module', '-e', program], { timeout: 30000 });
  const stored = JSON.parse(await readFile(join(dir, 'outbox.json'), 'utf8'));
  assert.equal(stored.pending.length, 128);
  assert.equal(stored.processedRequests.length, 100);
});

test('persistence failure rejects callers and the next write can recover', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-outbox-recovery-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outbox = new RelayOutbox(join(dir, 'outbox.json'));
  const original = outbox.writeSnapshot.bind(outbox);
  outbox.writeSnapshot = async () => { throw Error('disk unavailable'); };
  await assert.rejects(outbox.markProcessedRequest('first'), /disk unavailable/);
  outbox.writeSnapshot = original;
  await outbox.markProcessedRequest('second');
  assert.deepEqual(JSON.parse(await readFile(outbox.path, 'utf8')).processedRequests, ['first', 'second']);
});
