import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLogIdentity, userReference, markAuthenticated, markAuthenticatedDevice,
  markBrowserAuthorization, recordResponseError, runRequestLog } from '../server/request-log.mjs';

const identity = { version: 'v1', key: Buffer.alloc(32, 7) };
function response(status = 200) {
  return Object.assign(new EventEmitter(), { statusCode: status, writableFinished: true });
}

test('v2 records milliseconds, fixed fields and one terminal event without exposing input', async () => {
  const output = [], res = response(400); let clock = 1000;
  await runRequestLog({ method: 'POST', url: '/api/responses/private?token=SECRET',
    headers: { 'x-user-ref': 'SECRET', 'x-trace-id': 'SECRET' }, body: 'SECRET' }, res, async () => {
    recordResponseError({ error: { code: 'invalid_envelope', message: 'SECRET' } }, 400);
  }, { identity, now: () => clock, write: row => output.push(row) });
  clock = 1123.456; res.emit('finish'); res.emit('close');
  assert.equal(output.length, 1);
  const row = output[0];
  assert.equal(row.request_time, 123.456);
  assert.equal(row.schema_version, 2);
  assert.equal(row.request_uri, '/api/responses/:request_id');
  assert.equal(row.error, 'invalid_envelope');
  assert.equal(row.auth_type, 'anonymous');
  assert.equal(row.client_type, 'unknown');
  assert.equal(row.service, 'relayune-api');
  assert.equal(row.event, 'http_request');
  assert.match(row.trace_id, /^[a-f0-9-]{36}$/);
  assert.doesNotMatch(JSON.stringify(row), /SECRET|private/);
  assert.equal('user_ref' in row, false);
  assert.deepEqual(Object.keys(row).sort(), ['schema_version','service','service_version','event','level',
    'request_method','request_uri','status','request_time','error','trace_id','auth_type','client_type'].sort());
});

test('HMAC identity normalizes accounts, separates keys/versions and omits unproven users', () => {
  assert.equal(userReference(' Alice@Example.com ', identity), userReference('alice@example.com', identity));
  assert.notEqual(userReference('alice@example.com', identity), userReference('bob@example.com', identity));
  assert.notEqual(userReference('alice@example.com', identity), userReference('alice@example.com', { version:'v1',key:Buffer.alloc(32,8) }));
  assert.match(userReference('alice@example.com', { ...identity,version:'v2' }), /^v2_[a-f0-9]{64}$/);
  assert.equal(userReference('alice@example.com', null), undefined);
  assert.equal(userReference(undefined, identity), undefined);
  assert.equal(userReference('invalid', identity), undefined);
});

test('concurrent request contexts cannot exchange identity or error codes', async () => {
  const output=[], a=response(403), b=response(401); let release;
  const gate = new Promise(resolve => { release=resolve; });
  const pending = runRequestLog({method:'GET',url:'/api/events'}, a, async () => {
    markAuthenticated('alice@example.com','email_session'); await gate;
    markBrowserAuthorization(); recordResponseError({error:{code:'invalid_origin'}},403);
  }, {identity,write:row=>output.push(row)});
  await runRequestLog({method:'POST',url:'/api/auth/password'}, b, async () => {
    recordResponseError({error:{code:'invalid_credentials'}},401);
  }, {identity,write:row=>output.push(row)});
  b.emit('finish'); release(); await pending; a.emit('finish');
  assert.equal(output[0].auth_type,'anonymous'); assert.equal('user_ref' in output[0],false);
  assert.equal(output[1].auth_type,'browser_token');
  assert.equal(output[1].user_ref,userReference('alice@example.com',identity));
  assert.equal(output[1].error,'invalid_origin');
  assert.notEqual(output[0].trace_id,output[1].trace_id);
});

test('device and session identities agree and diagnostic lookup failure is nonfatal', async () => {
  const rows=[];
  for (const handler of [() => markAuthenticated('alice@example.com','email_session'),
    () => markAuthenticatedDevice(async ()=>'alice@example.com'),
    () => markAuthenticatedDevice(async ()=>{throw new Error('SECRET');})]) {
    const res=response(); await runRequestLog({method:'GET',url:'/health'},res,handler,{identity,write:row=>rows.push(row)});
    res.emit('finish');
  }
  assert.equal(rows[0].user_ref,rows[1].user_ref);
  assert.equal(rows[1].auth_type,'device_token'); assert.equal(rows[1].client_type,'desktop');
  assert.equal('user_ref' in rows[2],false);
});

test('early disconnect and arbitrary error messages become fixed errors', async () => {
  for (const [status,early,error] of [[500,false,'internal_error'],[200,true,'client_closed']]) {
    const res=response(status),rows=[]; res.writableFinished=!early;
    await runRequestLog({method:'GET',url:'/health'},res,async()=>{
      recordResponseError({error:{code:'SECRET',message:'SECRET'}},status);
    },{write:row=>rows.push(row)});
    res.emit(early?'close':'finish');res.emit('close');
    assert.equal(rows.length,1);assert.equal(rows[0].error,error);
    assert.doesNotMatch(JSON.stringify(rows),/SECRET/);
  }
});

test('log key files require restricted permissions and refuse symlinks or invalid keys', () => {
  const dir=mkdtempSync(join(tmpdir(),'relayune-log-key-'));
  try {
    const path=join(dir,'key.json');
    writeFileSync(path,JSON.stringify({version:'v1',key:'07'.repeat(32)}),{mode:0o600});
    assert.deepEqual(loadLogIdentity(path),identity);
    chmodSync(path,0o644); assert.throws(()=>loadLogIdentity(path)); chmodSync(path,0o600);
    symlinkSync(path,join(dir,'link')); assert.throws(()=>loadLogIdentity(join(dir,'link')));
    writeFileSync(path,JSON.stringify({version:'v1',key:'SECRET'}));
    assert.throws(()=>loadLogIdentity(path),/^Error: request_log_key_invalid$/);
    assert.equal(loadLogIdentity(undefined),null);
  } finally {rmSync(dir,{recursive:true,force:true});}
});


test('key helper refuses overwrite and lookup accepts email only from stdin', () => {
  const dir=mkdtempSync(join(tmpdir(),'relayune-log-cli-'));
  try {
    const path=join(dir,'key.json');
    const run=(command,input)=>spawnSync(process.execPath,['scripts/sls/log-identity.mjs',command,path],{input,encoding:'utf8'});
    assert.equal(run('create').status,0);
    const first=run('lookup','alice@example.com\n');
    assert.equal(first.status,0);assert.match(first.stdout,/^v1_[a-f0-9]{64}\n$/);
    assert.equal(run('create').status,1);
    assert.equal(run('lookup','alice@example.com').stdout,first.stdout);
    assert.equal(run('lookup','invalid').status,1);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
