import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash, randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { MongoClient } from 'mongodb';

const ORIGIN = 'https://192.0.2.17';
const password = 'local-fixture-password';
const setupToken = randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');

function request(method, pathname, body, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  Object.assign(req, { method, url: pathname, headers: { origin: ORIGIN, ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  return req;
}
function response() {
  return { status: 0, headers: {}, body: '', writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = '') { this.body += body; }, json() { return JSON.parse(this.body); },
    cookie() { const value = this.headers['Set-Cookie']; return (Array.isArray(value) ? value[0] : value).split(';')[0]; } };
}

// This suite starts a fresh loopback mongod in a temporary directory. It never
// connects to a developer's database or an existing service.
test('standalone self-hosted username auth, ownership and local recovery', { skip: !process.env.RELAY_TEST_MONGOD, timeout: 90000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'relayune-local-auth-'));
  const dbpath = join(root, 'db'); await mkdir(dbpath);
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const mongo = spawn(process.env.RELAY_TEST_MONGOD, ['--dbpath', dbpath, '--bind_ip', '127.0.0.1', '--port', String(port), '--wiredTigerCacheSizeGB', '0.25', '--logpath', join(root, 'mongo.log')], { stdio: 'ignore' });
  const client = new MongoClient(`mongodb://127.0.0.1:${port}`, { serverSelectionTimeoutMS: 200, retryReads: false, retryWrites: false });
  t.after(async () => {
    await client.close();
    if (mongo.exitCode === null) { const stopped = once(mongo, 'exit'); mongo.kill('SIGTERM'); await stopped; }
    await rm(root, { recursive: true, force: true });
  });
  for (let attempt = 0; ; attempt++) {
    try { await client.connect(); break; }
    catch (error) { if (attempt > 50 || mongo.exitCode !== null) throw error; await delay(100); }
  }
  assert.equal(Number((await client.db('admin').command({ serverStatus: 1 })).pid), mongo.pid);
  const bundle = join(root, 'api.cjs');
  await build({ stdin: { contents: `export {EmailAuth} from './server/email-auth.ts'; export * from './server/local-accounts.ts'; export {PairingApi} from './server/pairing-api.ts'; export {MongoStore,initializeRelayMongo} from './server/mongo-store.ts'; export {handleRelayApi} from './server/relay-api.ts'; export {FeedbackApi} from './server/feedback-api.ts'; export {createMonitoring} from './server/monitoring.ts';`, resolveDir: process.cwd() }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const { EmailAuth, resetLocalOwnerPassword, initializeLocalOwner, initializeLocalAccounts, PairingApi, MongoStore, initializeRelayMongo, handleRelayApi, FeedbackApi, createMonitoring } = createRequire(import.meta.url)(bundle);
  const db = client.db('isolated_username_auth');
  const auth = new EmailAuth(db, { publicOrigin: ORIGIN, authMode: 'username', setupToken });
  await auth.initialize(); await initializeRelayMongo(db);
  const call = async (method, path, body, headers) => {
    const res = response(); await auth.handle(request(method, path, body, headers), res); return res;
  };
  await t.test('no SMTP or first-public-visitor owner, origin/token/body boundaries', async () => {
    const instance = await call('GET', '/api/instance');
    assert.equal(instance.json().auth_mode, 'username'); assert.equal(instance.json().setup_required, true);
    assert.equal(instance.json().registration_enabled, false); assert.equal(instance.json().account_deletion_enabled, false);
    const res = await call('POST', '/api/auth/setup', { username: 'admin', password }); assert.equal(res.status, 403);
    const tokenInQuery = await call('POST', `/api/auth/setup?token=${setupToken}`, { username: 'admin', password }); assert.equal(tokenInQuery.status, 403);
    await assert.rejects(() => call('POST', '/api/auth/setup', { username: 'admin', password }, { 'x-relayune-setup-token': setupToken, origin: 'https://foreign.invalid' }), error => error.status === 403);
    const weak = await call('POST', '/api/auth/setup', { username: 'admin', password: '123456' }, { 'x-relayune-setup-token': setupToken }); assert.equal(weak.status, 400);
    for (const path of ['/api/auth/magic-link', '/api/auth/email-status', '/api/auth/verify', '/api/auth/set-password']) {
      assert.equal((await call(path.endsWith('verify') ? 'GET' : 'POST', path, { email: 'test@example.invalid' })).status, 404);
    }
    assert.equal(await db.collection('auth_users').countDocuments(), 0);
  });
  let cookie, principal;
  await t.test('concurrent setup has exactly one winner, scrypt only, restart does not overwrite', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => call('POST', '/api/auth/setup', { username: 'Admin', password }, { 'x-relayune-setup-token': setupToken })));
    assert.equal(results.filter(item => item.status === 201).length, 1);
    assert.equal(results.filter(item => item.status === 409).length, 7);
    const winner = results.find(item => item.status === 201); cookie = winner.cookie(); principal = winner.json().user.account_id;
    assert.match(principal, /^acct_[a-f0-9]{32}$/); assert.equal(winner.json().user.email, null);
    assert.equal(winner.json().user.username, 'admin');
    const user = await db.collection('auth_users').findOne({ _id: principal });
    assert.equal(user.password_algorithm, 'scrypt-v1'); assert.notEqual(user.password_hash, password); assert.equal(user.email_verified, false);
    assert.ok(!JSON.stringify(user).includes(password)); assert.equal(await db.collection('auth_users').countDocuments(), 1);
    const otherWorker = new EmailAuth(db, { publicOrigin: ORIGIN, authMode: 'username', setupToken }); await otherWorker.initialize();
    assert.equal((await call('GET', '/api/instance')).json().setup_required, false);
    await assert.rejects(() => initializeLocalOwner(db, 'other', 'different-password'), error => error.status === 409);
    assert.equal((await db.collection('auth_users').findOne({ _id: principal })).password_hash, user.password_hash);
  });
  await t.test('stable identity, preferences, bootstrap and feedback stay on this instance', async () => {
    const session = await call('GET', '/api/auth/session', undefined, { cookie }); assert.equal(session.json().user.account_id, principal); assert.equal(session.json().user.email, null);
    const preferences = await call('PUT', '/api/account/agent-order', { agent_order: ['codex'], visible_agents: ['codex'] }, { cookie }); assert.equal(preferences.status, 200);
    const headers = { 'x-relayune-authenticated-account-id': principal, 'x-relayune-account-username': 'admin' };
    const env = { DB: new MongoStore(db), RELAY_BLOBS: {} };
    const bootstrap = await handleRelayApi(new Request(`${ORIGIN}/api/bootstrap`, { headers }), env);
    assert.equal(bootstrap.status, 200); const payload = await bootstrap.json();
    assert.equal(payload.user.account_id, principal); assert.equal(payload.user.email, null); assert.equal(payload.user.username, 'admin');
    const api = new FeedbackApi(db, ORIGIN); await api.initialize();
    const feedback = await api.handle(new Request(`${ORIGIN}/api/feedback`, { method: 'POST', headers: { origin: ORIGIN }, body: JSON.stringify({ id: 'b'.repeat(32), category: 'bug', description: 'isolated self-hosted fixture', environment: {app_version:'0.0.0',device_model:'fixture',os_version:'fixture'}, client: 'mobile', contact: {email:'',wechat:''}, images: [] }) }), principal);
    assert.equal(feedback.status, 201);
    const savedFeedback = await db.collection('relay_feedback').findOne({ _id: 'b'.repeat(32) });
    assert.equal(savedFeedback.description, 'isolated self-hosted fixture');
    assert.equal(savedFeedback.owner, hash(`email:${principal}`));
    assert.equal((await call('POST', '/api/account/delete', { confirm: true, password }, { cookie })).status, 409);
    const denied = createMonitoring({ query: null });
    assert.equal((await denied(new Request(`${ORIGIN}/api/monitoring`), principal)).status, 403);
    const allowed = createMonitoring({ query: null, authorizeAccount: async value => value === principal });
    assert.equal((await allowed(new Request(`${ORIGIN}/api/monitoring`), principal)).status, 503);
  });
  await t.test('desktop approval uses immutable owner and compatible display identity', async () => {
    const api = new PairingApi(db); await api.initialize();
    const deviceToken = randomBytes(32).toString('base64url'); const pollSecret = randomBytes(32).toString('base64url');
    const start = await api.handle(new Request(`${ORIGIN}/api/desktop-login/start`, { method: 'POST', body: JSON.stringify({ device_name: 'isolated local desktop', relay_token_hash: hash(deviceToken), poll_secret_hash: hash(pollSecret) }) }), null);
    assert.equal(start.status, 201); const { request_id } = await start.json();
    const approval = await api.handle(new Request(`${ORIGIN}/api/desktop-login/${request_id}/approve`, { method: 'POST' }), principal); assert.equal(approval.status, 200);
    const approved = await approval.json(); assert.equal(approved.account_email, 'admin'); assert.equal(approved.account_id, principal); assert.equal(approved.email, null);
    const userId = `usr_${hash(principal).slice(0, 32)}`;
    const device = await db.collection('relay_devices').findOne({ user_id: userId, relay_token_hash: hash(deviceToken) }); assert.ok(device);
    const foreign = await api.handle(new Request(`${ORIGIN}/api/desktop-login/${request_id}/approval`), `acct_${'f'.repeat(32)}`); assert.equal(foreign.status, 409);
  });
  await t.test('atomic rate limiting and account-scoped browser self revoke', async () => {
    const failures = await Promise.all(Array.from({ length: 16 }, async () => {
      try { return (await call('POST', '/api/auth/password', { username: 'admin', password: 'wrong-password' })).status; }
      catch (error) { return error.status; }
    }));
    assert.equal(failures.filter(status => status === 401).length, 8); assert.equal(failures.filter(status => status === 429).length, 8);
    await db.collection('auth_password_limits').deleteMany({});
    const api = new PairingApi(db); const browserToken = randomBytes(32).toString('base64url');
    const browser = { _id: `web_${'a'.repeat(32)}`, id: `web_${'a'.repeat(32)}`, user_id: `usr_${hash(principal).slice(0, 32)}`, device_id: `dev_${'a'.repeat(32)}`, token_hash: hash(browserToken), revoked_at: null };
    await db.collection('relay_browser_authorizations').insertOne(browser);
    const revoke = who => api.handle(new Request(`${ORIGIN}/api/browser/authorizations/revoke`, { method: 'POST', headers: { origin: ORIGIN, 'X-Relay-Browser-Token': browserToken } }), who);
    assert.equal((await revoke(`acct_${'f'.repeat(32)}`)).status, 401);
    assert.equal((await revoke(principal)).status, 200); assert.equal((await revoke(principal)).status, 401);
    assert.equal((await db.collection('relay_browser_authorizations').findOne({ _id: browser._id })).revoked_at > 0, true);
  });
  await t.test('local recovery changes password and invalidates cookies immediately', async () => {
    const login = await call('POST', '/api/auth/password', { username: 'admin', password }); assert.equal(login.status, 200);
    const before = login.cookie(); assert.equal(await auth.authenticate(request('GET', '/', undefined, { cookie: before })), principal);
    const replacement = 'replacement-fixture-password'; await resetLocalOwnerPassword(db, replacement);
    assert.equal(await auth.authenticate(request('GET', '/', undefined, { cookie: before })), null);
    assert.equal(await auth.authenticate(request('GET', '/', undefined, { cookie })), null);
    const env = { DB: new MongoStore(db), RELAY_BLOBS: {} };
    const staleBootstrap = await handleRelayApi(new Request(`${ORIGIN}/api/bootstrap`, {
      headers: { cookie: before, 'X-Relay-Browser-Token': 'a'.repeat(43), authorization: `Bearer ${'d'.repeat(43)}` },
    }), env);
    assert.equal(staleBootstrap.status, 401);
    const device = await db.collection('relay_devices').findOne({ user_id: `usr_${hash(principal).slice(0, 32)}` });
    assert.equal(device.revoked_at, null); // Independent Desktop grants are not password sessions.
    const reclaim = await call('POST', '/api/auth/setup', { username: 'admin', password: 'attempted-new-fixture-password' }, { authorization: `Bearer ${'d'.repeat(43)}` });
    assert.equal(reclaim.status, 403);
    const repeatedSetup = await call('POST', '/api/auth/setup', { username: 'admin', password: 'attempted-new-fixture-password' }, { 'x-relayune-setup-token': setupToken });
    assert.equal(repeatedSetup.status, 409);
    assert.equal((await call('POST', '/api/auth/password', { username: 'admin', password })).status, 401);
    const after = await call('POST', '/api/auth/password', { username: 'admin', password: replacement }); assert.equal(after.status, 200);
    assert.equal(after.json().user.account_id, principal);
    await call('POST', '/api/auth/logout', {}, { cookie: after.cookie() });
    assert.equal(await auth.authenticate(request('GET', '/', undefined, { cookie: after.cookie() })), null);
  });
  await t.test('a password login racing local recovery cannot mint a valid old-generation session', async () => {
    let unblock, captured;
    const read = new Promise(resolve => { captured = resolve; });
    const wait = new Promise(resolve => { unblock = resolve; });
    const intercepted = new Proxy(db, { get(target, property) {
      if (property !== 'collection') { const value = target[property]; return typeof value === 'function' ? value.bind(target) : value; }
      return name => {
        const collection = target.collection(name);
        if (name !== 'auth_users') return collection;
        return new Proxy(collection, { get(source, key) {
          if (key === 'findOne') return async (...args) => {
            const user = await source.findOne(...args);
            if (args[0].username === 'admin') { captured(); await wait; }
            return user;
          };
          const value = source[key]; return typeof value === 'function' ? value.bind(source) : value;
        } });
      };
    } });
    const racing = new EmailAuth(intercepted, { publicOrigin: ORIGIN, authMode: 'username' });
    const old = response();
    const login = racing.handle(request('POST', '/api/auth/password', { username: 'admin', password: 'replacement-fixture-password' }), old);
    await read;
    await resetLocalOwnerPassword(db, 'second-recovery-fixture-password');
    unblock(); await login;
    assert.equal(old.status, 200);
    assert.equal(await auth.authenticate(request('GET', '/', undefined, { cookie: old.cookie() })), null);
  });
  await t.test('delayed local recovery cleanup preserves a newer login but rejects older and late sessions', async () => {
    const isolated = client.db('isolated_local_cleanup_race');
    const recoveryAuth = new EmailAuth(isolated, { publicOrigin: ORIGIN, authMode: 'username' });
    await recoveryAuth.initialize();
    const owner = await initializeLocalOwner(isolated, 'admin', password);
    const login = async value => {
      const result = response();
      await recoveryAuth.handle(request('POST', '/api/auth/password', { username: 'admin', password: value }), result);
      return result;
    };
    const authenticate = cookie => recoveryAuth.authenticate(request('GET', '/', undefined, { cookie }));
    const old = await login(password); assert.equal(old.status, 200);
    const legacyToken = randomBytes(32).toString('base64url');
    await isolated.collection('auth_sessions').insertOne({ token_hash: hash(legacyToken), account_id: owner._id, expires_at: new Date(Date.now() + 60000), revoked_at: null });
    let release, entered;
    const blocked = new Promise(resolve => { release = resolve; });
    const cleanupEntered = new Promise(resolve => { entered = resolve; });
    const delayed = new Proxy(isolated, { get(target, property) {
      if (property !== 'collection') { const value = target[property]; return typeof value === 'function' ? value.bind(target) : value; }
      return name => {
        const collection = target.collection(name);
        if (name !== 'auth_sessions') return collection;
        return new Proxy(collection, { get(source, key) {
          if (key === 'deleteMany') return async (...args) => { entered(); await blocked; return source.deleteMany(...args); };
          const value = source[key]; return typeof value === 'function' ? value.bind(source) : value;
        } });
      };
    } });
    const older = resetLocalOwnerPassword(delayed, 'older-concurrent-recovery-password');
    try {
      await cleanupEntered;
      await resetLocalOwnerPassword(isolated, 'newest-concurrent-recovery-password');
      const fresh = await login('newest-concurrent-recovery-password'); assert.equal(fresh.status, 200);
      assert.equal(await authenticate(fresh.cookie()), owner._id);
      release(); await older;
      assert.equal((await isolated.collection('auth_users').findOne({ _id: owner._id })).auth_epoch, 3);
      assert.equal(await authenticate(fresh.cookie()), owner._id);
      assert.equal(await authenticate(old.cookie()), null);
      assert.equal(await isolated.collection('auth_sessions').countDocuments({ account_id: owner._id, auth_epoch: 3 }), 1);
      assert.equal(await isolated.collection('auth_sessions').countDocuments({ token_hash: hash(legacyToken) }), 0);
      assert.equal((await login(password)).status, 401);
      assert.equal((await login('older-concurrent-recovery-password')).status, 401);
      const lateToken = randomBytes(32).toString('base64url');
      await isolated.collection('auth_sessions').insertOne({ token_hash: hash(lateToken), account_id: owner._id, auth_epoch: 2, expires_at: new Date(Date.now() + 60000), revoked_at: null });
      assert.equal(await authenticate(`relay_session=${lateToken}`), null);
      assert.equal(await isolated.collection('auth_sessions').countDocuments({ token_hash: hash(lateToken) }), 1);
    } finally { release(); await older; }
  });
  await t.test('real HTTP dispatcher starts without SMTP/setup token and strips forged account headers', async sub => {
    await db.collection('auth_password_limits').deleteMany({});
    await db.command({createUser:'fixture_http',pwd:'isolated-mongo-fixture-password',roles:[{role:'readWrite',db:db.databaseName}]});
    const serverBundle=join(root,'server.cjs');
    await build({entryPoints:['server/self-hosted.ts'],outfile:serverBundle,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
    const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
    const apiPort=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
    const child=spawn(process.execPath,[serverBundle],{env:{
      PATH:process.env.PATH,HOME:root,HOST:'127.0.0.1',PORT:String(apiPort),PUBLIC_ORIGIN:ORIGIN,
      RELAY_AUTH_MODE:'username',RELAY_BLOB_DIR:join(root,'blobs'),MONITOR_ADMIN_USERNAME:'admin',
      MONGO_HOST:'127.0.0.1',MONGO_PORT:String(port),MONGO_DATABASE:db.databaseName,
      MONGO_USER:'fixture_http',MONGO_PASSWORD:'isolated-mongo-fixture-password',
    },stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
    sub.after(async()=>{if(child.exitCode===null){const stopped=once(child,'exit');child.kill('SIGTERM');await stopped;}});
    const base=`http://127.0.0.1:${apiPort}`;
    for(let attempt=0;;attempt++){
      try{const health=await fetch(`${base}/health`);if(health.ok)break;}catch{}
      if(attempt>60||child.exitCode!==null)assert.fail(`isolated server failed to become healthy (exit ${child.exitCode})`);
      await delay(100);
    }
    const instance=await(await fetch(`${base}/api/instance`)).json();
    assert.equal(instance.auth_mode,'username');assert.equal(instance.setup_required,false);
    const spoofed=await fetch(`${base}/api/bootstrap`,{headers:{'oai-authenticated-user-email':'forged@example.invalid','x-relayune-authenticated-account-id':principal,'x-relayune-account-username':'admin'}});
    assert.equal(spoofed.status,401);
    const login=await fetch(`${base}/api/auth/password`,{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'second-recovery-fixture-password'}),redirect:'error'});
    assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
    const bootstrap=await(await fetch(`${base}/api/bootstrap`,{headers:{cookie,'x-forwarded-host':'foreign.invalid','x-forwarded-proto':'http'}})).json();
    assert.equal(bootstrap.user.account_id,principal);assert.equal(bootstrap.user.username,'admin');assert.equal(bootstrap.user.email,null);
    const monitor=await(await fetch(`${base}/api/monitoring`,{headers:{cookie}})).json();
    assert.equal(monitor.logs_available,false);assert.equal(monitor.runtime.database_ok,true);
    assert.equal((await fetch(`${base}/api/auth/setup`,{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json'},body:JSON.stringify({username:'admin',password})})).status,403);
    assert.ok(!output.includes(password));assert.ok(!output.includes(setupToken));assert.ok(!output.includes('isolated-mongo-fixture-password'));
  });
  await t.test('auth modes cannot silently reuse each other database identities', async () => {
    const official = new EmailAuth(db, { publicOrigin: ORIGIN, mailFrom: 'test@example.invalid' }); await assert.rejects(() => official.initialize(), /email_mode_requires_separate_database/);
    const oldDb = client.db('isolated_official_auth'); await oldDb.collection('auth_users').insertOne({ _id: 'old@example.invalid' });
    await assert.rejects(() => initializeLocalAccounts(oldDb), /username_mode_requires_separate_database/);
    const allUsers = await db.collection('auth_users').find({}).toArray();
    assert.ok(!JSON.stringify(allUsers).includes(setupToken));
    assert.ok(!(await readFile(join(root, 'mongo.log'), 'utf8')).includes(password));
  });
});
