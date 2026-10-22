import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { ApnsClient } from '../server/apns-client.mjs';

const {privateKey, publicKey} = generateKeyPairSync('ec', {namedCurve:'prime256v1'});
const config = {environment:'sandbox', teamId:'AAAAAAAAAA', keyId:'BBBBBBBBBB', privateKey:privateKey.export({type:'pkcs8',format:'pem'})};
test('APNs token uses verifiable ES256 and rotates after forty minutes', () => {
  const client = new ApnsClient(config);
  const first = client.authorization(1700000000000);
  const [header,payload,signature] = first.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header,'base64url')), {alg:'ES256',kid:'BBBBBBBBBB'});
  assert.deepEqual(JSON.parse(Buffer.from(payload,'base64url')), {iss:'AAAAAAAAAA',iat:1700000000});
  assert.ok(verify('sha256',Buffer.from(`${header}.${payload}`),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')));
  assert.equal(client.authorization(1700000010000),first);
  assert.notEqual(client.authorization(1700002500000),first);
});
test('APNs rejects invalid environments and messages before connecting', async () => {
  assert.throws(() => new ApnsClient({...config,environment:'https://attacker.invalid'}));
  const client = new ApnsClient(config);
  await assert.rejects(client.send({token:'not-a-token',payload:{}}));
  await assert.rejects(client.send({token:'ab'.repeat(32),payload:{x:'x'.repeat(4096)}}));
  await assert.rejects(client.send({token:'ab'.repeat(32),payload:{},type:'voip'}));
});

test('private APNs files reject public permissions and symbolic links', async () => {
  const {mkdtemp,writeFile,chmod,symlink,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {readPrivateFile}=await import('../server/apns-client.mjs');
  const directory=await mkdtemp(join(tmpdir(),'relayune-key-permissions-'));
  try {
    const path=join(directory,'synthetic-key');await writeFile(path,'synthetic',{mode:0o600});
    assert.equal((await readPrivateFile(path)).toString(),'synthetic');
    await chmod(path,0o644);await assert.rejects(readPrivateFile(path));
    await chmod(path,0o600);const link=join(directory,'link');await symlink(path,link);
    await assert.rejects(readPrivateFile(link));
  } finally {await rm(directory,{recursive:true,force:true});}
});
