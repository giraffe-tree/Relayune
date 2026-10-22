import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, scryptSync } from 'node:crypto';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const dir = mkdtempSync(join(tmpdir(), 'relayune-delete-'));
const out = join(dir, 'api.cjs');
await build({ stdin: { contents: 'export {EmailAuth} from "./server/email-auth"; export {AccountDeletionGate} from "./server/account-deletion";', resolveDir: process.cwd() }, outfile: out, bundle: true, platform: 'node', format: 'cjs' });
const { EmailAuth, AccountDeletionGate } = createRequire(import.meta.url)(out);
test.after(() => rmSync(dir, { recursive: true, force: true }));
const hash = v => createHash('sha256').update(v).digest('hex');
const email = 'delete@example.com', password = 'Deletion-test-only';
const token = 'a'.repeat(43), otherToken = 'b'.repeat(43);
const userId = `usr_${hash(email).slice(0, 32)}`;

function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(q => matches(row, q));
    const field = row[key];
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return Object.entries(value).every(([op, operand]) => {
        if (op === '$in') return operand.includes(field);
        if (op === '$ne') return field !== operand;
        if (op === '$gt') return field > operand;
        if (op === '$gte') return field >= operand;
        if (op === '$exists') return (field !== undefined) === operand;
        if (op === '$regex') return new RegExp(operand).test(field);
        throw new Error(`Unhandled filter ${op}`);
      });
    }
    return Array.isArray(field) ? field.includes(value) : field === value;
  });
}
function fixture() {
  const data = new Map();
  const rows = name => { if (!data.has(name)) data.set(name, []); return data.get(name); };
  rows('auth_users').push({ _id: email, password_algorithm: 'scrypt-v1', password_salt: 'fixture-salt', password_hash: scryptSync(password, 'fixture-salt', 32).toString('base64url') }, { _id: 'canary@example.com' });
  for (const sessionToken of [token, otherToken]) rows('auth_sessions').push({ _id: hash(sessionToken), token_hash: hash(sessionToken), email, revoked_at: null, expires_at: new Date(Date.now() + 40 * 86400000) });
  rows('relay_users').push({ _id: userId, id: userId, email }, { _id: 'usr_canary', email: 'canary@example.com' });
  rows('relay_devices').push({ _id: 'dev_target', id: 'dev_target', user_id: userId, revoked_at: null }, { _id: 'dev_canary', user_id: 'usr_canary' });
  for (const name of ['relay_browser_authorizations','relay_commands','relay_responses','relay_pake_pairings','relay_desktop_logins','relay_client_devices','relay_catalogs','relay_events']) {
    rows(name).push({ _id: 'target', user_id: userId, device_id: 'dev_target', blob_key: `${name}/fixture` }, { _id: 'canary', user_id: 'usr_canary', device_id: 'dev_canary' });
  }
  for (const name of ['relay_ios_push_registrations','relay_ios_push_jobs','relay_push_bindings','relay_push_jobs']) rows(name).push({ _id: 'target', deviceId: 'dev_target' }, { _id: 'canary', deviceId: 'dev_canary' });
  for (const name of ['auth_magic_links','auth_setup_sessions']) rows(name).push({ _id: 'target', email }, { _id: 'canary', email: 'canary@example.com' });
  rows('relay_feedback').push({ _id: 'target', owner: hash(`email:${email}`), description: 'private' }, { _id: 'canary', owner: 'other' });
  rows('relay_feedback_limits').push({ _id: `${hash(`email:${email}`)}:2026-09-30` });
  const db = { collection(name) {
    assert.doesNotMatch(name, /billing|apple_subscription|redemption|referral/);
    return {
    async findOne(q) { return rows(name).find(r => matches(r, q)) ?? null; },
    find(q = {}) { const selected = rows(name).filter(r => matches(r, q)); return { async toArray() { return selected; }, limit() { return this; }, async *[Symbol.asyncIterator]() { yield* selected; } }; },
    async countDocuments(q) { return rows(name).filter(r => matches(r, q)).length; },
    async insertOne(record) { rows(name).push(record); },
    async updateOne(q, update) { return this.updateMany(q, update, true); },
    async updateMany(q, update, one = false) { let count = 0; for (const row of rows(name)) if (matches(row, q)) { Object.assign(row, update.$set || {}); for (const [key, value] of Object.entries(update.$pull || {})) row[key] = row[key].filter(item => item !== value); count++; if (one) break; } return { matchedCount: count, modifiedCount: count }; },
    async deleteOne(q) { const index = rows(name).findIndex(r => matches(r, q)); if (index >= 0) rows(name).splice(index, 1); },
    async deleteMany(q) { data.set(name, rows(name).filter(r => !matches(r, q))); },
  }; } };
  const auth = new EmailAuth(db, { publicOrigin: 'https://relayune.test', mailFrom: 'mail@relayune.test' });
  const revoked = [], blobs = [];
  auth.setAccountDeletionEffects({ revokeDevice: id => revoked.push(id), deleteBlob: async key => blobs.push(key) });
  return { data, rows, auth, revoked, blobs };
}
async function request(auth, body, { origin = 'https://relayune.test', session = token, method = 'POST' } = {}) {
  const req = Readable.from([JSON.stringify(body)]);
  Object.assign(req, { method, url: '/api/account/delete', headers: { origin, cookie: `relay_session=${session}` }, socket: { remoteAddress: '127.0.0.1' } });
  const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(value) { this.body = JSON.parse(value); } };
  await auth.handle(req, res);
  return res;
}

test('deletion requires session, same origin, explicit confirmation and correct password', async () => {
  const f = fixture();
  assert.equal((await request(f.auth, { password, confirm: true }, { session: 'invalid' })).status, 401);
  await assert.rejects(request(f.auth, { password, confirm: true }, { origin: 'https://attacker.test' }), { status: 403 });
  assert.equal((await request(f.auth, { password, confirm: true }, { method: 'GET' })).status, 405);
  assert.equal((await request(f.auth, { password, confirm: false })).status, 400);
  assert.equal((await request(f.auth, { password, confirm: true, email: 'canary@example.com' })).status, 400);
  assert.equal((await request(f.auth, { password: 'wrong', confirm: true })).body.error.code, 'invalid_credentials');
  assert.equal(f.rows('auth_users').length, 2);
  assert.equal(f.revoked.length, 0);
});

test('deletion removes only this identity, grants, payloads, feedback and push registrations', async () => {
  const f = fixture();
  const res = await request(f.auth, { password, confirm: true });
  assert.deepEqual(res.body, { deleted: true, authenticated: false });
  assert.equal(res.status, 200);
  assert.deepEqual(f.revoked, ['dev_target']);
  assert.equal(f.blobs.length, 2);
  assert.deepEqual(f.rows('auth_users'), [{ _id: 'canary@example.com' }]);
  assert.equal(f.rows('auth_sessions').length, 0);
  for (const name of ['relay_devices','relay_browser_authorizations','relay_commands','relay_responses','relay_ios_push_jobs','relay_push_bindings','relay_feedback']) assert.equal(f.rows(name).length, 1, name);
  assert.equal(f.rows('relay_feedback_limits').length, 0);
  assert.equal((await request(f.auth, { password, confirm: true })).status, 401);
});

test('failed blob cleanup denies normal access, preserves retry pointers and can finish after restart', async () => {
  const f = fixture();
  f.auth.setAccountDeletionEffects({ revokeDevice() {}, async deleteBlob() { throw new Error('disk unavailable'); } });
  await assert.rejects(request(f.auth, { password, confirm: true }), /disk unavailable/);
  const req = { headers: { cookie: `relay_session=${token}` } };
  assert.equal(await f.auth.authenticate(req), null);
  assert.equal(await f.auth.authenticate(req, true), email);
  assert.equal(f.rows('auth_sessions').length, 1);
  assert.equal(f.rows('relay_responses').length, 2);
  await assert.rejects(f.auth.resumeAccountDeletions(), /account_deletion_cleanup_incomplete/);
  assert.equal(await f.auth.authenticate(req, true), email);
  f.auth.setAccountDeletionEffects({ revokeDevice() {}, async deleteBlob() {} });
  await f.auth.resumeAccountDeletions();
  assert.equal(await f.auth.authenticate(req, true), null);
  assert.equal(await f.auth.hasPendingAccountDeletions(), false);
  assert.equal(f.rows('auth_users').length, 1);
});

test('deletion waits for in-flight requests; later writes cannot race past it or starve it', async () => {
  const gate = new AccountDeletionGate(), events = [];
  const first = await gate.enter(false), second = await gate.enter(false);
  const deleting = gate.enter(true).then(release => { events.push('delete'); return release; });
  const later = gate.enter(false).then(release => { events.push('later'); return release; });
  first(); await Promise.resolve(); assert.deepEqual(events, []);
  second(); const finishDelete = await deleting;
  assert.deepEqual(events, ['delete']);
  finishDelete(); (await later)();
  assert.deepEqual(events, ['delete','later']);
});
