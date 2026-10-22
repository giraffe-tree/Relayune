import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

const READ_CHUNK_BYTES = 256 * 1024;
const MAX_RECORD_BYTES = 64 * 1024 * 1024;
const ANCHOR_BYTES = 4096;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = info => `${info.dev}:${info.ino}`;
const fingerprint = info => `${identity(info)}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;

async function readRange(handle, position, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

// The index only exists in Relay memory. Its source is the Agent's existing
// JSONL file; it never writes another plaintext history or image cache.
export class CodexRolloutHistoryIndex {
  constructor({ createState, fold }) {
    this.createState = createState;
    this.fold = fold;
    this.entries = new Map();
    this.pending = new Map();
    this.generation = 0;
  }

  read(path, sessionId, { onProgress } = {}) {
    const key = `${sessionId}\0${path}`;
    const previous = this.pending.get(key) ?? Promise.resolve();
    const generation = this.generation;
    const operation = previous.catch(() => {}).then(() => this.readFile(key, path, sessionId, generation, onProgress));
    this.pending.set(key, operation);
    return operation.finally(() => {
      if (this.pending.get(key) === operation) this.pending.delete(key);
    });
  }

  async readFile(key, path, sessionId, generation, onProgress) {
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new Error('Codex history source is not a regular file.');
      let entry = this.entries.get(key);
      const currentFingerprint = fingerprint(info);
      const unchanged = entry?.fingerprint === currentFingerprint;
      let append = entry && entry.identity === identity(info) && info.size > entry.size;
      if (append) {
        const head = await readRange(handle, 0, Math.min(ANCHOR_BYTES, entry.offset));
        const tailStart = Math.max(0, entry.offset - ANCHOR_BYTES);
        const tail = await readRange(handle, tailStart, entry.offset - tailStart);
        append = digest(head) === entry.headDigest && digest(tail) === entry.tailDigest;
      }
      if (!unchanged && !append) {
        entry = { state: this.createState(sessionId), offset: 0, size: 0, identity: identity(info) };
      }
      // Count this scan's actual input, including an incomplete row that must
      // be re-read. A warm projection has no scan work. Never expose a path or
      // confuse source image bytes with the compact page sent to the phone.
      const totalBytes = unchanged ? 0 : info.size - entry.offset;
      const report = sourceReadBytes => {
        try { onProgress?.({ source_read_bytes: sourceReadBytes, source_total_bytes: totalBytes }); }
        catch { /* Optional UI hints cannot fail a history read. */ }
      };
      report(0);
      if (!unchanged) {
        let position = entry.offset;
        let lineOffset = position;
        let parts = [];
        let lineBytes = 0;
        let skipOversized = false;
        let bytesRead = 0;
        const consume = bytes => {
          if (!skipOversized && lineBytes + bytes.length <= MAX_RECORD_BYTES) {
            const line = Buffer.concat([...parts, bytes], lineBytes + bytes.length);
            try {
              const record = JSON.parse(line.toString('utf8'));
              this.fold(record, entry.state, {
                path, offset: lineOffset, length: line.length,
                identity: entry.identity, digest: digest(line),
              });
            } catch (error) {
              if (!(error instanceof SyntaxError)) throw error;
              if (line.toString('utf8').trim()) entry.state.requiresProvider = true;
            }
          } else entry.state.requiresProvider = true;
          parts = [];
          lineBytes = 0;
          skipOversized = false;
        };
        while (position < info.size) {
          const chunk = await readRange(handle, position, Math.min(READ_CHUNK_BYTES, info.size - position));
          if (!chunk.length) break;
          bytesRead += chunk.length;
          let start = 0;
          for (let end = chunk.indexOf(10); end >= 0; end = chunk.indexOf(10, start)) {
            consume(chunk.subarray(start, end));
            start = end + 1;
            lineOffset = position + start;
            entry.offset = lineOffset;
          }
          const rest = chunk.subarray(start);
          lineBytes += rest.length;
          if (lineBytes > MAX_RECORD_BYTES) { skipOversized = true; parts = []; }
          else if (!skipOversized && rest.length) parts.push(rest);
          position += chunk.length;
          report(bytesRead);
        }
        // Only complete JSONL records are committed. The next append re-reads
        // the unfinished row, so split UTF-8/JSON cannot create a history gap.
        // Detach retained text/IDs from records which contained large images.
        entry.state = structuredClone(entry.state);
        entry.state.readBytes = bytesRead;
        entry.state.totalReadBytes = (entry.state.totalReadBytes ?? 0) + bytesRead;
        entry.size = info.size;
        entry.fingerprint = currentFingerprint;
        entry.state.fingerprint = currentFingerprint;
        entry.headDigest = digest(await readRange(handle, 0, Math.min(ANCHOR_BYTES, entry.offset)));
        const tailStart = Math.max(0, entry.offset - ANCHOR_BYTES);
        entry.tailDigest = digest(await readRange(handle, tailStart, entry.offset - tailStart));
      } else entry.state.readBytes = 0;
      if (generation !== this.generation) return entry.state;
      this.entries.delete(key);
      this.entries.set(key, entry);
      // Count and memory are bounded after image bodies are replaced by refs.
      this.enforceBudget();
      return entry.state;
    } finally { await handle.close(); }
  }

  clear() { this.generation += 1; this.entries.clear(); }

  enforceBudget() {
    for (const entry of this.entries.values()) {
      entry.bytes = Buffer.byteLength(JSON.stringify(entry.state, (_key, value) =>
        value instanceof Map ? [...value.entries()] : value instanceof Set ? [...value] : value));
    }
    while (this.entries.size > 8 || [...this.entries.values()].reduce((sum, value) => sum + value.bytes, 0) > 16 * 1024 * 1024)
      this.entries.delete(this.entries.keys().next().value);
  }
}

export function rolloutDataUrlSources(record, context) {
  const sources = new Map();
  let index = 0;
  const visit = value => {
    if (typeof value === 'string' && /^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i.test(value)) {
      if (!sources.has(value)) sources.set(value, { type: 'rollout_jsonl', ...context, data_url_index: index,
        content_digest: digest(Buffer.from(value.slice(value.indexOf(',') + 1), 'base64')) });
      index += 1;
    } else if (Array.isArray(value)) for (const item of value) visit(item);
    else if (value && typeof value === 'object') for (const item of Object.values(value)) visit(item);
  };
  visit(record);
  return sources;
}

export async function readRolloutAttachmentDataUrl(source) {
  if (source?.type !== 'rollout_jsonl' || typeof source.path !== 'string' ||
      !Number.isSafeInteger(source.offset) || source.offset < 0 ||
      !Number.isSafeInteger(source.length) || source.length <= 0 || source.length > MAX_RECORD_BYTES ||
      !Number.isSafeInteger(source.data_url_index) || source.data_url_index < 0 ||
      !/^[a-f0-9]{64}$/.test(source.digest ?? '')) throw new Error('Invalid Codex attachment source.');
  const handle = await open(source.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || identity(info) !== source.identity || source.offset + source.length > info.size)
      throw new Error('Codex attachment source changed. Reload history.');
    const bytes = await readRange(handle, source.offset, source.length);
    if (bytes.length !== source.length || digest(bytes) !== source.digest)
      throw new Error('Codex attachment source changed. Reload history.');
    const record = JSON.parse(bytes.toString('utf8'));
    // Duplicate values must still occupy their original traversal positions.
    let index = 0;
    let selected;
    const visit = value => {
      if (typeof value === 'string' && /^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i.test(value)) {
        if (index === source.data_url_index) selected = value;
        index += 1;
      } else if (Array.isArray(value)) for (const item of value) visit(item);
      else if (value && typeof value === 'object') for (const item of Object.values(value)) visit(item);
    };
    visit(record);
    if (!selected) throw new Error('Codex attachment source is unavailable.');
    return selected;
  } finally { await handle.close(); }
}
