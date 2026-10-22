// Explicit integration fixture. Requires Node >=22.13 and an independently
// verified local MongoDB binary; never downloads tools or accepts a database URL.
// Usage: RELAY_TEST_MONGOD=/absolute/path/to/mongod node scripts/test-mongo-isolated.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { constants } from 'node:fs';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { build } from 'esbuild';
import { generateE2eeKey, keyIdForKey, sealJson, openJson } from '../relay/e2ee.mjs';
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13))
    throw new Error('Node >=22.13 is required.');
if (!['darwin', 'linux'].includes(process.platform))
    throw new Error('This sendmail fixture supports macOS/Linux only.');
if (!process.env.RELAY_TEST_MONGOD?.trim())
    throw new Error('Set RELAY_TEST_MONGOD to an independently verified local mongod binary.');
const mongoBinary = resolve(process.env.RELAY_TEST_MONGOD);
await access(mongoBinary, constants.X_OK);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const controller = new AbortController();
const root = await mkdtemp(join(tmpdir(), 'relay-mongo-integration-'));
const digest = x => createHash('sha256').update(x).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const database = 'isolated_public_source_integration';
let mongod, server, verifier, client;
let stage = 'startup';
const children = [];
const launch = (program, args, options = {}) => { const child = spawn(program, args, options); child.on('error', () => { }); children.push(child); return child; };
const reserve = async () => { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise(r => s.close(r)); return p; };
const stop = async (child) => {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
        return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    timer.unref();
    try {
        await exited;
    }
    finally {
        clearTimeout(timer);
    }
};
let cleaning;
function cleanup() { return cleaning ??= (async () => { await Promise.all(children.map(stop)); await client?.close(); await rm(root, { recursive: true, force: true }); })(); }
for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => { controller.abort(); void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143)); });
const deadline = setTimeout(() => controller.abort(), 90000);
deadline.unref();
const request = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
const report = { scope: 'Synthetic isolated loopback HTTP + real standalone MongoDB', checks: {}, boundaries: ['MockCodexAdapter only; no real Agent execution or native/browser UI acceptance.', 'Mail is captured locally; no SMTP, push, SLS or production services are contacted.', 'Loopback HTTP models a reverse-proxy upstream with HTTPS public Origin; TLS termination is not exercised.', 'This fixture does not run the separate 100-client capacity or retention/TTL suites.'] };
try {
    const mongoPort = await reserve(), httpPort = await reserve();
    const origin = `http://127.0.0.1:${httpPort}`, publicOrigin = `https://127.0.0.1:${httpPort}`;
    await mkdir(join(root, 'db'));
    await mkdir(join(root, 'blobs'));
    mongod = launch(mongoBinary, ['--dbpath', join(root, 'db'), '--bind_ip', '127.0.0.1', '--port', String(mongoPort), '--wiredTigerCacheSizeGB', '0.25', '--logpath', join(root, 'mongo.log')], { stdio: ['ignore', 'pipe', 'pipe'] });
    mongod.stdout.resume();
    mongod.stderr.resume();
    // Do not connect until our daemon has bound its own port. A port race must
    // fail before any fixture writes, rather than fall through to another Mongo.
    for (let i = 0;; i++) {
        const log = await readFile(join(root, 'mongo.log'), 'utf8').catch(() => '');
        if (log.includes('Waiting for connections') && mongod.exitCode === null && mongod.signalCode === null) break;
        if (i > 100 || mongod.exitCode !== null || mongod.signalCode !== null || controller.signal.aborted) throw Error('fixture_mongo_startup_failed');
        await delay(100);
    }
    const uri = `mongodb://127.0.0.1:${mongoPort}`;
    client = new MongoClient(uri, { directConnection: true, serverSelectionTimeoutMS: 200 });
    for (let i = 0;; i++) {
        try {
            await client.connect();
            break;
        }
        catch (e) {
            if (i > 50 || mongod.exitCode !== null || mongod.signalCode !== null || controller.signal.aborted)
                throw e;
            await delay(100);
        }
    }
    const status = await client.db('admin').command({ serverStatus: 1 });
    assert.equal(Number(status.pid), mongod.pid, 'fixture_mongo_process_mismatch');
    report.mongodb_version = status.version;
    const db = client.db(database), isolation = token(), mongoPassword = token();
    await db.command({ createUser: 'fixture', pwd: mongoPassword, roles: [{ role: 'readWrite', db: database }] });
    await db.collection('relay_test_isolation').insertOne({ _id: 'fixture', token_hash: digest(isolation), expires_at: new Date(Date.now() + 600000) });
    const sendmail = join(root, 'sendmail'), mail = join(root, 'mail.txt');
    const quotedMail = "'" + mail.replaceAll("'", "'\\''") + "'";
    await writeFile(sendmail, `#!/bin/sh\n/usr/bin/tee ${quotedMail} >/dev/null\n`, { mode: 0o700 });
    await build({ absWorkingDir: repository, entryPoints: ['server/self-hosted.ts'], outfile: join(root, 'server.cjs'), bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
    await build({ absWorkingDir: repository, entryPoints: ['shared/pairing-pake.ts'], outfile: join(root, 'pake.mjs'), bundle: true, format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent' });
    const pake = await import(pathToFileURL(join(root, 'pake.mjs')).href);
    const env = { PATH: process.env.PATH, HOME: root, TMPDIR: tmpdir(), HOST: '127.0.0.1', PORT: String(httpPort), PUBLIC_ORIGIN: publicOrigin, MONGO_HOST: '127.0.0.1', MONGO_PORT: String(mongoPort), MONGO_DATABASE: database, MONGO_USER: 'fixture', MONGO_PASSWORD: mongoPassword, RELAY_BLOB_DIR: join(root, 'blobs'), MAIL_FROM: 'Fixture <fixture@example.invalid>', SENDMAIL_PATH: sendmail };
    server = launch(process.execPath, [join(root, 'server.cjs')], { cwd: repository, env, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.resume();
    server.stderr.resume();
    for (let i = 0;; i++) {
        try {
            const r = await request(`${origin}/health`);
            if (r.ok)
                break;
        }
        catch { }
        if (i > 100 || server.exitCode !== null || server.signalCode !== null || controller.signal.aborted)
            throw Error('fixture_http_startup_failed');
        await delay(100);
    }
    const post = async (path, body, headers = {}) => request(origin + path, { method: 'POST', headers: { origin: publicOrigin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    stage = 'registration_password_login';
    const email = 'fixture@example.invalid', password = 'Synthetic-password-2026';
    assert.equal((await post('/api/auth/magic-link', { email })).status, 202);
    const mime = await readFile(mail, 'utf8');
    const decoded = [...mime.matchAll(/Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+?)\r?\n--relayune-/g)].map(x => Buffer.from(x[1].replaceAll(/\s/g, ''), 'base64').toString('utf8')).join('\n');
    const magicUrl = decoded.match(/https:\/\/127\.0\.0\.1:\d+\/api\/auth\/verify\?token=[A-Za-z0-9_-]+/)?.[0];
    assert.ok(magicUrl);
    const verify = await request(magicUrl.replace('https:', 'http:'), { redirect: 'manual' });
    assert.equal(verify.status, 303);
    const setupCookie = verify.headers.get('set-cookie').split(';')[0];
    assert.equal((await post('/api/auth/set-password', { password }, { cookie: setupCookie })).status, 200);
    const user = await db.collection('auth_users').findOne({ _id: email });
    assert.equal(user.password_algorithm, 'scrypt-v1');
    assert.notEqual(user.password_hash, password);
    assert.doesNotMatch(JSON.stringify(user), /entitlement|trial_|access_expires_at|referral|redeemed_code/);
    assert.equal((await post('/api/auth/password', { email, password: 'wrong' })).status, 401);
    const login = await post('/api/auth/password', { email, password });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    report.checks.registration_password_login_real_mongo = true;
    const bootstrap = await request(`${origin}/api/bootstrap`, { headers: { cookie } });
    assert.equal(bootstrap.status, 200);
    assert.doesNotMatch(await bootstrap.text(), /entitlement|trial_|billing|subscription/);
    report.checks.free_account_without_commercial_state = true;
    async function pair(previous) {
        const desktop = await pake.createPairingInitiator();
        const start = await post(previous ? '/api/relay/pairings/start' : '/api/pairings/start', { pairing_id: desktop.pairingId, protocol: pake.PAIRING_PROTOCOL, initiator_share: desktop.initiatorShare }, previous ? { authorization: `Bearer ${previous.deviceToken}` } : {});
        assert.equal(start.status, 201, await start.text());
        const browser = await pake.respondToPairing(desktop.pairingId, desktop.code, desktop.initiatorShare), browserToken = token();
        const response = await post(`/api/browser/pairings/${desktop.pairingId}/respond`, { protocol: pake.PAIRING_PROTOCOL, responder_share: browser.responderShare, responder_confirm: browser.responderConfirm, browser_token_hash: digest(browserToken), browser_key_id: await keyIdForKey(browser.contentKey), browser_name: 'Synthetic browser' }, { cookie });
        assert.equal(response.status, 200, await response.text());
        const derived = await pake.finishPairingInitiator(desktop, browser.responderShare, browser.responderConfirm);
        assert.equal(derived.contentKey, browser.contentKey);
        const deviceToken = previous?.deviceToken ?? token();
        const complete = await post(`/api/pairings/${desktop.pairingId}/complete`, { desktop_confirm: derived.desktopConfirm, relay_token_hash: digest(deviceToken), name: 'Synthetic Desktop' });
        assert.equal(complete.status, 201, await complete.clone().text());
        const issued = await complete.json();
        const paired = await (await request(`${origin}/api/pairings/${desktop.pairingId}`)).json();
        pake.verifyDesktopConfirmation(browser.expectedDesktopConfirm, paired.desktop_confirm);
        return { ...issued, deviceToken, browserToken, key: browser.contentKey, code: desktop.code };
    }
    stage = 'independent_pake_and_revocation';
    const one = await pair(), two = await pair(one);
    assert.equal(one.device_id, two.device_id);
    assert.notEqual(one.browser_id, two.browser_id);
    assert.notEqual(one.key, two.key);
    const aad = { type: 'fixture' }, cipher = await sealJson(one.key, { secret: 'synthetic-only' }, aad);
    await assert.rejects(openJson(two.key, cipher, aad));
    report.checks.two_independent_pake_authorizations_real_mongo = true;
    const revoke = await post(`/api/relay/browser-authorizations/${one.browser_id}/revoke`, {}, { authorization: `Bearer ${one.deviceToken}` });
    assert.equal(revoke.status, 200);
    const list = await request(`${origin}/api/relay/browser-authorizations`, { headers: { authorization: `Bearer ${one.deviceToken}` } });
    assert.deepEqual((await list.json()).browsers.map(x => x.id), [two.browser_id]);
    assert.equal((await request(`${origin}/api/bootstrap?device_id=${two.device_id}`, { headers: { cookie, 'x-relay-browser-token': one.browserToken } })).status, 401);
    assert.equal((await request(`${origin}/api/bootstrap?device_id=${two.device_id}`, { headers: { cookie, 'x-relay-browser-token': two.browserToken } })).status, 200);
    report.checks.revocation_rejects_first_keeps_second = true;
    stage = 'server_storage_secret_absence';
    const visible = {};
    for (const x of await db.listCollections({}, { nameOnly: true }).toArray()) {
        visible[x.name] = await db.collection(x.name).find({}).limit(500).toArray();
    }
    const snapshot = JSON.stringify(visible);
    for (const secret of [password, one.key, two.key, one.deviceToken, one.browserToken, two.browserToken, one.code, two.code])
        assert.ok(!snapshot.includes(secret), 'secret leaked to Mongo');
    report.checks.credentials_short_codes_content_keys_absent_from_database = true;
    // Existing verifier uses a MockCodexAdapter, real HTTP and real Mongo for encrypted history.
    stage = 'mock_relay_round_trip';
    const verifierEnv = { ...env, RELAY_SERVER_URL: origin, MONGO_TEST_URI: uri, RELAY_TEST_ISOLATION_TOKEN: isolation, RELAY_WEB_EMAIL: email, RELAY_DEVICE_ID: two.device_id, RELAY_DEVICE_TOKEN: two.deviceToken, RELAY_E2EE_KEY: generateE2eeKey(), RELAY_STATE_PATH: join(root, 'relay-state.json') };
    verifier = launch(process.execPath, [join(repository, 'scripts/verify-mongo-self-hosted.mjs')], { cwd: repository, env: verifierEnv, signal: controller.signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    verifier.stdout.on('data', x => { if (output.length < 16384)
        output += x; });
    verifier.stderr.resume();
    const [exit] = await once(verifier, 'exit');
    assert.equal(exit, 0, 'mock_verifier_failed');
    report.existing_verifier = JSON.parse(output.trim());
    report.checks.mock_relay_encrypted_http_round_trip = true;
    // Per-account failure limiter uses actual countDocuments and persisted attempt rows.
    stage = 'password_limiter_and_logout';
    const limited = 'limited@example.invalid';
    for (let i = 0; i < 8; i++)
        assert.equal((await post('/api/auth/password', { email: limited, password: 'incorrect' })).status, 401);
    assert.equal((await post('/api/auth/password', { email: limited, password: 'incorrect' })).status, 429);
    assert.equal(await db.collection('auth_login_attempts').countDocuments({ email_hash: digest(limited) }), 8);
    report.checks.password_limiter_real_mongo = true;
    assert.equal((await post('/api/auth/logout', {}, { cookie })).status, 200);
    assert.equal((await request(`${origin}/api/bootstrap`, { headers: { cookie } })).status, 401);
    report.checks.session_logout_revocation = true;
    report.ok = true;
}
catch {
    report.ok = false;
    report.failed_stage = stage;
    process.exitCode = 1;
}
finally {
    clearTimeout(deadline);
    await cleanup();
    console.log(JSON.stringify(report, null, 2));
}
