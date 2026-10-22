import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Prepare locally. Upload the image first, then atomically replace current.json.
const [source, expiresAt] = process.argv.slice(2);
if (!source || !expiresAt || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(expiresAt) ||
    !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
  throw new Error('Usage: node scripts/update-community-qr.mjs <original.png> <future ISO expiry with timezone>');
}
const bytes = await readFile(source);
if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
  throw new Error('Use the original PNG screenshot.');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'public/community');
const filename = `wechat-group-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.png`;
await mkdir(path.join(directory, 'assets'), { recursive: true });
await writeFile(path.join(directory, 'assets', filename), bytes);
const config = { image: `/community/assets/${filename}`, expiresAt: new Date(expiresAt).toISOString(), updatedAt: new Date().toISOString() };
const temporary = path.join(directory, `current.${process.pid}.tmp`);
await writeFile(temporary, JSON.stringify(config, null, 2) + '\n');
await rename(temporary, path.join(directory, 'current.json'));
console.log(JSON.stringify(config, null, 2));
