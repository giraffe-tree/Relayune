import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {after, before, test} from 'node:test';
import {build} from 'esbuild';
import {generateE2eeKey, keyIdForKey, openJson, sealJson} from '../relay/e2ee.mjs';
import {MacRelay} from '../relay/mac-relay.mjs';

let temporary;
let pake;
let webCipher;
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'relayune-crypto-review-'));
  await Promise.all([
    ['shared/pairing-pake.ts', 'pake.mjs'],
    ['app/e2ee.ts', 'web.mjs'],
  ].map(([entry, name]) => build({entryPoints: [entry], bundle: true,
    platform: 'browser', format: 'esm', outfile: join(temporary, name), logLevel: 'silent'})));
  [pake, webCipher] = await Promise.all(['pake.mjs', 'web.mjs'].map(name => import(pathToFileURL(join(temporary, name)).href)));
});
after(async () => { if (temporary) await rm(temporary, {recursive: true, force: true}); });

function aad() {
  return {direction: 'web_to_relay', type: 'session.submit_message',
    device_id: 'dev_review', session_id: 'ses_review', request_id: 'req_review',
    event_seq: null, created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString()};
}

test('review: wrong password cannot produce a valid Desktop confirmation', async () => {
  const desktop = await pake.createPairingInitiator();
  const wrongCode = desktop.code[0] === 'A' ? `B${desktop.code.slice(1)}` : `A${desktop.code.slice(1)}`;
  const attacker = await pake.respondToPairing(desktop.pairingId, wrongCode, desktop.initiatorShare);
  await assert.rejects(pake.finishPairingInitiator(desktop, attacker.responderShare,
    attacker.responderConfirm), /连接码|握手/);
  assert.ok(desktop.ephemeralSecret.every(byte => byte === 0));
});

test('review: server substitution of a different pairing identity fails confirmation', async () => {
  const desktop = await pake.createPairingInitiator();
  const otherId = (await pake.createPairingInitiator()).pairingId;
  const retargeted = await pake.respondToPairing(otherId, desktop.code, desktop.initiatorShare);
  await assert.rejects(pake.finishPairingInitiator(desktop, retargeted.responderShare,
    retargeted.responderConfirm), /连接码|握手/);
});

test('review: replacing a public share by another valid curve point fails confirmation', async () => {
  const desktop = await pake.createPairingInitiator();
  const other = await pake.createPairingInitiator();
  const substituted = await pake.respondToPairing(desktop.pairingId, desktop.code, other.initiatorShare);
  await assert.rejects(pake.finishPairingInitiator(desktop, substituted.responderShare,
    substituted.responderConfirm), /连接码|握手/);
  other.ephemeralSecret.fill(0);
});

test('review: malformed/off-curve shares never reach a successful PAKE output', async () => {
  const desktop = await pake.createPairingInitiator();
  const offCurve = new Uint8Array(65); offCurve[0] = 4;
  for (const share of [Buffer.alloc(33, 2), offCurve]) {
    await assert.rejects(pake.respondToPairing(desktop.pairingId, desktop.code,
      Buffer.from(share).toString('base64url')), /长度|曲线点/);
  }
  desktop.ephemeralSecret.fill(0);
});

test('review: every authenticated routing field resists server rewrite, even when both outer AAD copies change', async () => {
  const key = generateE2eeKey(), original = aad();
  const envelope = await sealJson(key, {content: 'REVIEW_CANARY_ONLY_AT_ENDPOINT'}, original);
  const changed = {direction: 'relay_to_web', type: 'approval.resolve', device_id: 'dev_other',
    session_id: 'ses_other', request_id: 'req_other', event_seq: 7,
    created_at: new Date(Date.now() - 1000).toISOString(),
    expires_at: new Date(Date.now() + 600_000).toISOString()};
  for (const [field, value] of Object.entries(changed)) {
    const forgedAad = {...original, [field]: value};
    const aadBytes = Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(forgedAad).sort())));
    await assert.rejects(openJson(key, {...envelope, aad: aadBytes.toString('base64url')}, forgedAad), /authentication/);
  }
});

test('review: another client key cannot decrypt even if server changes the visible kid', async () => {
  const alice = generateE2eeKey(), bob = generateE2eeKey(), route = aad();
  const envelope = await sealJson(alice, {content: 'REVIEW_CLIENT_A_ONLY'}, route);
  await assert.rejects(openJson(bob, {...envelope, kid: await keyIdForKey(bob)}, route), /authentication/);
});

test('review: explicit per-client enrollment rejects a server-invented client sharing a known kid', async () => {
  // Exercise the real authorization reducer without starting any Agent/network.
  const relay = new MacRelay({serverUrl: 'https://relay.invalid', adapter: {workspace: '/synthetic'}});
  const raw = generateE2eeKey(), expectedId = `web_${'a'.repeat(32)}`, inventedId = `web_${'b'.repeat(32)}`;
  await relay.updateBrowserKey(expectedId, raw);
  const keyId = await keyIdForKey(raw);
  relay.syncBrowserAuthorizations([{id: expectedId, key_id: keyId}, {id: inventedId, key_id: keyId}]);
  assert.deepEqual([...relay.activeBrowserKeys.keys()], [expectedId]);
});

test('review: nonextractable browser keys still allow same-origin code to decrypt (documented hostile-Web-server boundary)', async () => {
  const key = await webCipher.importRelayKey(generateE2eeKey()), route = aad();
  const envelope = await webCipher.sealJson(key, {content: 'REVIEW_WEB_PLAINTEXT'}, route);
  await assert.rejects(crypto.subtle.exportKey('raw', key.cryptoKey));
  // Hostile same-origin JS can obtain the CryptoKey from IndexedDB and do this;
  // extractable:false only prevents key export, not authorized decrypt usage.
  const clear = await crypto.subtle.decrypt({name: 'AES-GCM',
    iv: Buffer.from(envelope.iv, 'base64url'), additionalData: Buffer.from(envelope.aad, 'base64url'), tagLength: 128},
  key.cryptoKey, Buffer.from(envelope.ciphertext, 'base64url'));
  assert.equal(JSON.parse(new TextDecoder().decode(clear)).content, 'REVIEW_WEB_PLAINTEXT');
});

test('review: recorded ciphertext is readable after later content-key compromise (no per-message forward secrecy)', async () => {
  const endpointKey = generateE2eeKey(), route = aad();
  const recorded = JSON.parse(JSON.stringify(await sealJson(endpointKey, {content: 'REVIEW_RECORDED_HISTORY'}, route)));
  assert.equal((await openJson(endpointKey, recorded, route)).content, 'REVIEW_RECORDED_HISTORY');
});
