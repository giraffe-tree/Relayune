export const ATTACHMENT_PART_BYTES = 128 * 1024;
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

// Each authenticated part is a separate read so interactive commands can run
// between parts. Legacy desktops still return one complete response.
export async function readAttachmentRanges(readPart) {
  const parts = [];
  let offset = 0, total, digest, mimeType;
  for (;;) {
    const response = await readPart(offset, ATTACHMENT_PART_BYTES);
    if (typeof response.base64 !== 'string' || response.base64.length > Math.ceil(ATTACHMENT_MAX_BYTES / 3) * 4)
      throw new Error('attachment_too_large');
    const binary = atob(response.base64);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (offset + bytes.byteLength > ATTACHMENT_MAX_BYTES) throw new Error('attachment_too_large');
    const ranged = ['offset', 'total_size', 'has_more'].some(key => key in response);
    if (!ranged) {
      if (offset !== 0) throw new Error('attachment_range_missing');
      return { bytes, mimeType: response.mime_type };
    }
    const next = response.next_offset;
    if (response.offset !== offset || !Number.isSafeInteger(response.total_size) ||
        response.total_size < 0 || response.total_size > ATTACHMENT_MAX_BYTES ||
        !Number.isSafeInteger(next) || next !== offset + bytes.byteLength || next > response.total_size ||
        typeof response.has_more !== 'boolean' || response.has_more !== (next < response.total_size) ||
        bytes.byteLength > ATTACHMENT_PART_BYTES || (response.has_more && bytes.byteLength === 0) ||
        typeof response.content_digest !== 'string' || !/^[a-f0-9]{64}$/.test(response.content_digest) ||
        typeof response.mime_type !== 'string' || (total !== undefined && total !== response.total_size) ||
        (digest !== undefined && digest !== response.content_digest) ||
        (mimeType !== undefined && mimeType !== response.mime_type)) throw new Error('attachment_range_invalid');
    total = response.total_size; digest = response.content_digest; mimeType = response.mime_type;
    parts.push(bytes); offset = next;
    if (!response.has_more) break;
  }
  const bytes = new Uint8Array(total);
  let position = 0;
  for (const part of parts) { bytes.set(part, position); position += part.byteLength; }
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const actual = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== digest) throw new Error('attachment_content_changed');
  return { bytes, mimeType };
}
