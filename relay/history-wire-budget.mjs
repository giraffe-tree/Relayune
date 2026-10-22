import {canonicalJson} from './protocol.mjs';

// AES-GCM adds a 16-byte tag; the envelope uses unpadded Base64URL. Include
// both authenticated routing copies and the one-item HTTPS push wrapper.
export function encryptedHistoryWireBytes(message, {deviceId, browserId, aad}) {
  return Buffer.byteLength(JSON.stringify({device_id: deviceId, messages: []})) +
    encryptedHistoryFrameBytes(message, {deviceId, browserId, aad});
}

// Exact JSON frame length for the current A256GCM envelope, before encryption.
// HTTP wrappers, TLS and retransmissions are separate transport overhead.
export function encryptedHistoryFrameBytes(message, {deviceId, browserId, aad}) {
  const envelope = {v: 2, alg: 'A256GCM', kid: `sha256:${'x'.repeat(43)}`,
    iv: 'x'.repeat(16), aad: Buffer.from(canonicalJson(aad)).toString('base64url'), ciphertext: ''};
  const frame = {kind: 'response', device_id: deviceId, browser_id: browserId,
    session_id: message.session_id, request_id: message.request_id, aad, envelope};
  const bytes = Buffer.byteLength(JSON.stringify(message));
  return Buffer.byteLength(JSON.stringify(frame)) +
    Math.ceil((bytes + 16) * 4 / 3);
}

export function historyWireBudget(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 4096) throw new Error('history_budget_invalid');
  return Math.min(1024 * 1024, value);
}

export function utf8Preview(value, maxBytes) {
  if (typeof value !== 'string') return '';
  const bytes = Buffer.from(value);
  if (bytes.length <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8');
}

// Store full content before replacing any field. The attachment callback must
// either persist a retrievable original or fail the read; silent truncation is
// never an acceptable way to meet the network budget.
export function compactHistoryMessage(message, maxBytes, register) {
  if (Buffer.byteLength(JSON.stringify(message)) <= maxBytes) return message;
  let compact = {...message};
  if (typeof message.content === 'string' && Buffer.byteLength(message.content) > maxBytes / 2) {
    const contentAttachment = register(Buffer.from(message.content), '完整消息.txt', 'text/plain');
    compact = {...compact, content: utf8Preview(message.content, Math.min(4096, Math.floor(maxBytes / 4))),
      content_truncated: true, content_attachment: contentAttachment,
      attachments: [...(message.attachments ?? []), contentAttachment]};
  }
  if (Buffer.byteLength(JSON.stringify(compact)) <= maxBytes) return compact;
  const detailAttachment = register(Buffer.from(JSON.stringify(message)), '完整消息详情.json', 'application/json');
  // Preserve the source identity and timeline boundary. Verbose tool details,
  // labels and attachment metadata remain available in the full JSON document.
  const result = {};
  for (const name of ['id', 'role', 'kind', 'turn_id', 'created_at', 'timestamp', 'status']) {
    if (Object.hasOwn(message, name)) result[name] = message[name];
  }
  return {...result, content: utf8Preview(compact.content, Math.min(2048, Math.floor(maxBytes / 8))),
    content_truncated: true, ...(compact.content_attachment ? {content_attachment: compact.content_attachment} : {}),
    detail_attachment: detailAttachment,
    attachments: [...(compact.content_attachment ? [compact.content_attachment] : []), detailAttachment]};
}
