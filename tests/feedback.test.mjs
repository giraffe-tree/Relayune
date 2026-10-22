import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { encode, decode } from 'jpeg-js';
import { Readable } from 'node:stream';
import { feedbackRequest } from '../relay/feedback.mjs';
import { parseFeedback, MAX_FEEDBACK_REQUEST_BYTES } from '../shared/feedback.mjs';

const directory = await mkdtemp(join(tmpdir(), 'relayune-feedback-test-'));
const outfile = join(directory, 'api.mjs');
await build({ entryPoints: ['server/feedback-api.ts'], outfile, bundle: true, platform: 'node', format: 'esm' });
const { FeedbackApi } = await import(pathToFileURL(outfile));
test.after(() => rm(directory, { recursive: true, force: true }));
const payload = { category: 'bug', description: '反馈 CANARY 私密说明 + % &',
  environment: { app_version: '0.3.19+29', device_model: 'iPhone (iPhone17,3)', os_version: 'iOS 18.5.1' }, client: 'mobile' };
const newSubmission = () => ({ id: randomBytes(16).toString('hex'), ...payload });

function fakeDb() {
  const collections = new Map();
  return { collections, collection(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    const docs = collections.get(name);
    return {
      async createIndex() {},
      async findOne(query) { return [...docs.values()].find(doc => Object.entries(query).every(([key, value]) => doc[key] === value)) ?? null; },
      async findOneAndUpdate(query, update) {
        const doc = docs.get(query._id) ?? { _id: query._id, count: 0, ...update.$setOnInsert };
        doc.count += update.$inc.count; docs.set(query._id, doc); return structuredClone(doc);
      },
      async insertOne(doc) { if (docs.has(doc._id)) throw Object.assign(new Error('duplicate'), { code: 11000 }); docs.set(doc._id, structuredClone(doc)); },
    };
  } };
}
function request(submission, { origin = 'https://relayune.test', token } = {}) {
  return new Request('https://relayune.test/api/feedback', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(submission) });
}

test('feedback accepts only bounded readable fields and canonicalizes retries', () => {
  const submission = newSubmission();
  assert.deepEqual(parseFeedback(submission), { ...submission, contact: { email: '', wechat: '' }, images: [] });
  assert.equal(parseFeedback({ ...submission, logs: 'not allowed' }), null);
  assert.equal(parseFeedback({ ...submission, description: '   ' }), null);
  assert.equal(parseFeedback({ ...submission, description: 'a'.repeat(8001) }), null);
  assert.equal(parseFeedback({ ...submission, category: 'other' }), null);
  assert.equal(parseFeedback({ ...submission, client: 'other' }), null);
  assert.equal(parseFeedback({ ...submission, id: 'not-an-id' }), null);
  assert.equal(parseFeedback({ ...submission, environment: { ...submission.environment, serial: 'not allowed' } }), null);
  assert.equal(parseFeedback({ ...submission, environment: { ...submission.environment, os_version: 'a'.repeat(257) } }), null);
});

test('API saves readable feedback, requires auth/origin and deduplicates concurrent retries', async () => {
  const db = fakeDb(); const api = new FeedbackApi(db, 'https://relayune.test'); await api.initialize();
  const submission = await newSubmission();
  assert.equal((await api.handle(request(submission), null)).status, 401);
  assert.equal((await api.handle(request(submission, { origin: 'https://attacker.test' }), 'test@example.com')).status, 403);
  assert.equal((await api.handle(request({ ...submission, logs: 'plaintext' }), 'test@example.com')).status, 400);
  const results = await Promise.all([api.handle(request(submission), 'test@example.com'), api.handle(request(submission), 'test@example.com')]);
  assert.ok(results.every(result => [200, 201].includes(result.status)));
  assert.equal(db.collections.get('relay_feedback').size, 1);
  const saved = [...db.collections.get('relay_feedback').values()][0];
  assert.deepEqual(Object.keys(saved).sort(), ['_id', 'category', 'client', 'contact', 'created_at', 'description', 'environment', 'images', 'owner', 'submission_hash']);
  assert.ok(!JSON.stringify(saved).includes('test@example.com'));
  assert.equal(saved.description, payload.description);
  assert.deepEqual(saved.environment, payload.environment);
  assert.deepEqual(await (await api.handle(request(submission), 'test@example.com')).json(), { id: submission.id });
  assert.equal((await api.handle(request(submission), 'other@example.com')).status, 409);
  assert.equal((await api.handle(request({ ...submission, description: 'Different feedback' }), 'test@example.com')).status, 409);
});

test('desktop token must be active; submissions need no key configuration', async () => {
  const db = fakeDb(); const api = new FeedbackApi(db, 'https://relayune.test');
  const token = 'a'.repeat(43);
  await db.collection('relay_devices').insertOne({ _id: 'device', user_id: 'user', revoked_at: null,
    relay_token_hash: createHash('sha256').update(token).digest('hex') });
  assert.equal((await api.handle(request(await newSubmission(), { token }), null)).status, 201);
  db.collections.get('relay_devices').get('device').revoked_at = 123;
  assert.equal((await api.handle(request(await newSubmission(), { token }), null)).status, 401);
  assert.equal((await api.handle(request(newSubmission()), 'test@example.com')).status, 201);
  assert.equal(await api.handle(new Request('https://relayune.test/api/feedback/key'), 'test@example.com'), null);
});

test('daily rate limit rejects excess new records but accepts a stored retry', async () => {
  const db = fakeDb(); const api = new FeedbackApi(db, 'https://relayune.test');
  const first = await newSubmission();
  await api.handle(request(first), 'test@example.com');
  for (let i = 1; i < 20; i++) assert.equal((await api.handle(request(await newSubmission()), 'test@example.com')).status, 201);
  assert.equal((await api.handle(request(await newSubmission()), 'test@example.com')).status, 429);
  assert.equal((await api.handle(request(first), 'test@example.com')).status, 200);
  assert.equal(db.collections.get('relay_feedback').size, 20);
});

const jpeg = () => ({ mime_type: 'image/jpeg', data: encode({ width: 2, height: 2, data: Buffer.alloc(16, 255), comments: ['PRIVATE CAMERA COMMENT'] }, 80).data.toString('base64') });

test('optional contacts and three images are validated and stored as readable fields', async () => {
  const db = fakeDb(); const api = new FeedbackApi(db, 'https://relayune.test');
  const submission = { ...newSubmission(), contact: { email: ' hello@example.com ', wechat: ' wechat_123 ' }, images: [jpeg(), jpeg(), jpeg()] };
  assert.equal((await api.handle(request(submission), 'test@example.com')).status, 201);
  const saved = db.collections.get('relay_feedback').get(submission.id);
  assert.deepEqual(saved.contact, { email: 'hello@example.com', wechat: 'wechat_123' });
  assert.equal(saved.images.length, 3);
  for (const image of saved.images) {
    assert.equal(image.mime_type, 'image/jpeg');
    assert.ok(!Buffer.from(image.data, 'base64').includes('PRIVATE CAMERA COMMENT'));
    assert.equal(decode(Buffer.from(image.data, 'base64')).width, 2);
  }
  assert.equal((await api.handle(request(submission), 'test@example.com')).status, 200);
  assert.equal((await api.handle(request({ ...submission, contact: { email: '', wechat: '' } }), 'test@example.com')).status, 409);
  for (const contact of [{ email: 'invalid', wechat: '' }, { email: '', wechat: 'a'.repeat(65) }, { email: '', wechat: '', extra: 'x' }]) {
    assert.equal(parseFeedback({ ...newSubmission(), contact }), null);
  }
  assert.equal(parseFeedback({ ...newSubmission(), images: Array(4).fill(jpeg()) }), null);
  assert.equal(parseFeedback({ ...newSubmission(), images: [{ mime_type: 'image/png', data: jpeg().data }] }), null);
  assert.equal(parseFeedback({ ...newSubmission(), images: [{ mime_type: 'image/jpeg', data: '/9j/' + 'A'.repeat(1400000) }] }), null);
  assert.equal((await api.handle(request({ ...newSubmission(), images: [{ mime_type: 'image/jpeg', data: '/9j/AAAA' }] }), 'test@example.com')).status, 400);
});

test('desktop streams attachment payload through stdin with a bounded body', async () => {
  const image = jpeg();
  // A valid parser-level large JPEG prefix demonstrates transport beyond OS env limits.
  image.data = '/9j/' + 'AAAA'.repeat(60000);
  const submission = { ...newSubmission(), images: [image, image, image], contact: { email: '', wechat: 'hello' } };
  const body = JSON.stringify(submission);
  assert.ok(Buffer.byteLength(body) > 600000);
  let calls = 0;
  const env = { RELAY_SERVER_URL: 'https://relayune.test', RELAY_DEVICE_TOKEN: 'a'.repeat(43) };
  const fetcher = async (url, options) => {
    calls++; assert.equal(url.href, 'https://relayune.test/api/feedback'); assert.equal(options.body, body);
    return new Response(JSON.stringify({ id: submission.id }));
  };
  const result = await feedbackRequest('submit', env, Readable.from([body.slice(0, 1000), body.slice(1000)]), fetcher);
  assert.equal(result.id, submission.id); assert.equal(calls, 1);
  await assert.rejects(feedbackRequest('submit', env, Readable.from([Buffer.alloc(MAX_FEEDBACK_REQUEST_BYTES + 1)]), fetcher));
  assert.equal(calls, 1);
});


test('existing feedback API stores explicitly selected exit diagnostics unchanged', async () => {
  const db = fakeDb(); const api = new FeedbackApi(db, 'https://relayune.test');
  const report = 'Relayune exit diagnostics v1\n2026-09-25T06:00:00Z run=1/2 v=0.3.24 terminated_unexpected code=1 ms=5400';
  const submission = { ...newSubmission(), client: 'desktop', description: 'App exited\n\n--- User-selected exit diagnostics ---\n' + report };
  const response = await api.handle(request(submission), 'test@example.com');
  assert.equal(response.status, 201);
  assert.equal(db.collections.get('relay_feedback').get(submission.id).description, submission.description);
  assert.equal((await api.handle(request(submission), 'test@example.com')).status, 200);
});
