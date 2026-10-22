import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ATTACHMENT_PART_BYTES, readAttachmentRanges } from '../app/attachment-ranges.mjs';

const body = Buffer.from('完整消息🙂\n'.repeat(20000));
const digest = createHash('sha256').update(body).digest('hex');
function part(offset, maxBytes) {
  const next = Math.min(body.length, offset + maxBytes);
  return { base64: body.subarray(offset, next).toString('base64'), mime_type: 'text/plain',
    offset, next_offset: next, total_size: body.length, has_more: next < body.length, content_digest: digest };
}
test('Web attachment parts reconstruct full UTF-8 with bounded reads', async () => {
  const offsets = [];
  const result = await readAttachmentRanges(async (offset, maxBytes) => {
    offsets.push(offset); assert.equal(maxBytes, ATTACHMENT_PART_BYTES); return part(offset, maxBytes);
  });
  assert.deepEqual(Buffer.from(result.bytes), body);
  assert.equal(result.mimeType, 'text/plain');
  assert.equal(offsets.length, Math.ceil(body.length / ATTACHMENT_PART_BYTES));
});
test('Web attachment reader supports legacy responses', async () => {
  const result = await readAttachmentRanges(async () => ({base64: 'aGk=', mime_type: 'text/plain'}));
  assert.equal(Buffer.from(result.bytes).toString(), 'hi');
});
for (const [name, change] of [
  ['gap', {offset: 1}], ['missing progress', {next_offset: 0}],
  ['wrong continuation', {has_more: false}], ['unbounded size', {total_size: 2 ** 32}],
  ['invalid digest', {content_digest: 'wrong'}],
]) test(`Web attachment reader rejects ${name}`, async () => {
  await assert.rejects(readAttachmentRanges(async (offset, maxBytes) => ({...part(offset, maxBytes), ...change})), /attachment_range_invalid/);
});
test('Web attachment reader rejects same-length source replacement', async () => {
  await assert.rejects(readAttachmentRanges(async (offset, maxBytes) => ({...part(offset, maxBytes),
    ...(offset > 0 ? {content_digest: 'a'.repeat(64)} : {})})), /attachment_range_invalid/);
});
