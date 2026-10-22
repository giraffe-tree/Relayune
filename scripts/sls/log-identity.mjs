#!/usr/bin/env node
import { openSync, writeFileSync, closeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { loadLogIdentity, userReference } from '../../server/request-log.mjs';

// Email arrives on stdin, never as a shell argument. No credentials are printed.
try {
  const [command, filename] = process.argv.slice(2);
  if (!['create', 'lookup'].includes(command) || !filename || !isAbsolute(filename)) {
    throw new Error('usage');
  }
  if (command === 'create') {
    const fd = openSync(filename, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify({ version: 'v1', key: randomBytes(32).toString('hex') }) + '\n'); }
    finally { closeSync(fd); }
    console.log('Created private log identity key; existing files are never overwritten.');
  } else {
    const identity = loadLogIdentity(filename);
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk.toString('utf8');
      if (Buffer.byteLength(input) > 2048) throw new Error('input');
    }
    const reference = userReference(input, identity);
    if (!reference) throw new Error('input');
    console.log(reference);
  }
} catch {
  console.error('Log identity operation failed. Check command (create/lookup), absolute path, permissions and input.');
  process.exitCode = 1;
}
