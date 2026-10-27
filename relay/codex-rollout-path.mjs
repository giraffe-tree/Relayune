import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export function isMissingRolloutError(error) {
  return ['ENOENT', 'ENOTDIR'].includes(error?.code) ||
    /\bENOENT\b|\bENOTDIR\b|no such file or directory(?:\s*\(os error 2\))?/i.test(error?.message ?? '');
}

// A filename may contain both a parent ID and a fork ID. Only the first native
// header owns the file. Never select a source by its filename alone.
export async function rolloutOwner(path) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!(await file.stat()).isFile()) return null;
    return await readRolloutOwner(file);
  } finally { await file.close(); }
}

export async function readRolloutOwner(file) {
  // Headers can include lengthy native instructions. Bound the read without
  // requiring those instructions to fit in a single filesystem chunk.
  const parts = [];
  for (let position = 0; position < 1024 * 1024;) {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
    if (!bytesRead) return null;
    const end = buffer.subarray(0, bytesRead).indexOf(10);
    parts.push(buffer.subarray(0, end < 0 ? bytesRead : end));
    position += bytesRead;
    if (end < 0) continue;
    let record;
    try { record = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { return null; }
    return record.type === 'session_meta' && typeof record.payload?.id === 'string' ? record.payload : null;
  }
  return null;
}

export async function findReplacementRollout(root, sessionId, preferredPath) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId ?? '')) return null;
  const inspect = async path => {
    try {
      const owner = await rolloutOwner(path);
      return owner?.id === sessionId ? { path, owner } : null;
    } catch (error) {
      if (isMissingRolloutError(error) || error.code === 'ELOOP') return null;
      throw error;
    }
  };
  if (preferredPath?.endsWith('.jsonl')) {
    const preferred = await inspect(preferredPath);
    if (preferred) return preferred;
  }
  const directories = [root];
  const matches = [];
  while (directories.length) {
    const directory = directories.pop();
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (isMissingRolloutError(error)) continue; throw error; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) directories.push(path);
      else if (entry.isFile() && entry.name.endsWith('.jsonl') && entry.name.includes(sessionId)) {
        const match = await inspect(path);
        if (match) matches.push(match);
      }
    }
  }
  // Copies can differ in permissions/history. Do not guess which is current.
  return matches.length === 1 ? matches[0] : null;
}
