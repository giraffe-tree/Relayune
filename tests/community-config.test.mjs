import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const result = await build({ entryPoints: ['app/community/group-config.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { parseGroupConfig } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const valid = { image: '/community/assets/wechat-group-abcd.png', expiresAt: '2026-09-18T00:00:00+08:00', updatedAt: '2026-09-11T00:00:00+08:00' };
test('accepts versioned QR config and preserves its precise expiry', () => {
  assert.deepEqual(parseGroupConfig(valid), valid);
  assert.equal(Date.parse(valid.expiresAt), Date.parse('2026-09-17T16:00:00Z'));
});
test('rejects malformed data, external URLs, and unparseable expiry', () => {
  for (const input of [null, {}, {...valid, image: 'https://example.com/qr.png'}, {...valid, image: '/community/assets/../qr.png'}, {...valid, expiresAt: 'unknown'}]) {
    assert.throws(() => parseGroupConfig(input));
  }
});
