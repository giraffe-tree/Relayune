// Synthetic/public-source inputs only. No user sessions, credentials, or network access.
import { readFileSync } from 'node:fs';
import { randomBytes, createCipheriv } from 'node:crypto';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { generateE2eeKey, sealJson } from '../relay/e2ee.mjs';

const aad = { direction: 'web-to-relay', device_id: 'dev_synthetic', session_id: 'ses_synthetic',
  request_id: 'req_synthetic', type: 'session.submit_message' };
const key = generateE2eeKey();
const source = readFileSync(new URL('../server/realtime.ts', import.meta.url), 'utf8');
const profiles = {
  small_delta: { type: 'text_delta', text: '正在检查请求路径和消息传输。' },
  code_result: { type: 'tool_result', output: source },
  history: { messages: Array.from({ length: 80 }, (_, i) => ({ id: `synthetic_${i}`, role: i % 2 ? 'assistant' : 'user',
    content: source.slice((i * 137) % 4000, (i * 137) % 4000 + 1500) })) },
  binary_attachment: { mime: 'application/octet-stream', data: randomBytes(128 * 1024).toString('base64') },
};
const encrypt = (input) => {
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), randomBytes(12));
  return Buffer.concat([cipher.update(input), cipher.final(), cipher.getAuthTag()]);
};
const rows = [];
for (const [profile, payload] of Object.entries(profiles)) {
  const plain = Buffer.from(JSON.stringify(payload));
  const envelope = await sealJson(key, payload, aad);
  const wire = Buffer.from(JSON.stringify(envelope));
  const gzip = gzipSync(wire, { level: 6 }).length;
  const brotli = brotliCompressSync(wire, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }).length;
  // Prototype size only: not a protocol implementation. Reuse metadata overhead,
  // add codec marker, and encrypt compressed bytes before Base64 serialization.
  const compressed = encrypt(gzipSync(plain, { level: 6 }));
  const precompressed = Buffer.byteLength(JSON.stringify({ ...envelope, codec: 'gzip', ciphertext: compressed.toString('base64url') }));
  const binaryCiphertextOnly = wire.length - Buffer.byteLength(envelope.ciphertext) + Buffer.from(envelope.ciphertext, 'base64url').length;
  rows.push({ profile, plaintext_bytes: plain.length, current_wire_bytes: wire.length,
    gzip_wire_bytes: gzip, brotli_wire_bytes: brotli,
    prototype_precompress_wire_bytes: precompressed,
    prototype_binary_ciphertext_bytes: binaryCiphertextOnly,
    gzip_saved_percent: +(100 * (1 - gzip / wire.length)).toFixed(1),
    precompress_saved_percent: +(100 * (1 - precompressed / wire.length)).toFixed(1) });
}
console.log(JSON.stringify({ synthetic: true, note: 'Sizes only, not production traffic shares or a negotiated codec. Random ciphertext causes small run-to-run variation.', rows }, null, 2));
