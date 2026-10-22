import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { cargoLockChecksums, rootNoticeDocuments, selectedCargoPackages, pinnedDocument, verifyUnmodifiedCrateSources, verifyNativeNoticeFiles, systemNativeDependencies } from '../scripts/native-desktop-notices.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function archive(entries) {
  const parts = [];
  for (const [name, text, type = 48] of entries) {
    const bytes = Buffer.from(text); const header = Buffer.alloc(512);
    header.write(name, 0, 100); header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124, 12); header[156] = type;
    parts.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}
async function fixture(t) { const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'relayune-native-notices-'))); t.after(() => rm(root, { recursive: true, force: true })); return root; }

test('crate lock parsing pins exact public registry archive hashes and rejects ambiguous identities', () => {
  const checksum = 'a'.repeat(64); const block = `[[package]]\nname = "example"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${checksum}"\n`;
  assert.equal(cargoLockChecksums('version = 4\n\n' + block).get('example@1.0.0'), checksum);
  assert.throws(() => cargoLockChecksums(block + block), /ambiguous/);
  assert.throws(() => cargoLockChecksums(block.replace('crates.io-index', 'crates.io-index-evil')), /unreviewed/);
  assert.throws(() => cargoLockChecksums(block.replace(checksum, 'bad')), /checksum/);
});

test('only original root legal documents count; nested vendor texts and license-like source files do not', () => {
  const bytes = archive([['example-1.0.0/LICENSE.MIT', 'original permission terms'], ['example-1.0.0/NOTICE', 'original attribution'], ['example-1.0.0/vendor/LICENSE', 'other package'], ['example-1.0.0/COPYING.rs', 'private code']]);
  const docs = rootNoticeDocuments(bytes, 'example-1.0.0', hash(bytes));
  assert.deepEqual(docs.map((doc) => doc.path), ['LICENSE.MIT', 'NOTICE']);
  assert.equal(docs[0].text, 'original permission terms');
  assert.throws(() => rootNoticeDocuments(bytes, 'example-1.0.0', '0'.repeat(64)), /checksum/);
});

test('archive path escapes and symlink license entries fail instead of following outside data', () => {
  const unsafe = archive([['example-1.0.0/../LICENSE', 'not allowed']]);
  assert.throws(() => rootNoticeDocuments(unsafe, 'example-1.0.0', hash(unsafe)), /unsafe/);
  const link = archive([['example-1.0.0/LICENSE', 'outside', 50]]);
  assert.throws(() => rootNoticeDocuments(link, 'example-1.0.0', hash(link)), /regular/);
});

test('target Cargo traversal excludes dev-only nodes and retains build dependency licenses', () => {
  const pkg = (id, source = 'registry+https://github.com/rust-lang/crates.io-index') => ({ id, name: id, source });
  const dep = (id, kind) => ({ pkg: id, dep_kinds: [{ kind }] });
  const m = { packages: [pkg('root', null), pkg('runtime'), pkg('build'), pkg('dev')], resolve: { root: 'root', nodes: [
    { id: 'root', deps: [dep('runtime', null), dep('build', 'build'), dep('dev', 'dev')] }, { id: 'runtime', deps: [] }, { id: 'build', deps: [] }, { id: 'dev', deps: [] },
  ] } };
  assert.deepEqual(selectedCargoPackages(m).map((p) => p.name), ['runtime', 'build']);
});

test('Mach-O inspection accepts external system libraries and rejects unreviewed bundled dependencies', () => {
  const system = '/fixture/core:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)';
  assert.deepEqual(systemNativeDependencies(system), ['/usr/lib/libSystem.B.dylib']);
  assert.throws(() => systemNativeDependencies(system.replace('/usr/lib/libSystem.B.dylib', '@rpath/vendor.dylib')), /redistribution evidence/);
  assert.throws(() => systemNativeDependencies(system.replace('/usr/lib/libSystem.B.dylib', '/usr/lib/../../private/vendor.dylib')), /redistribution evidence/);
  assert.throws(() => systemNativeDependencies('/fixture/core:\nunknown data'), /unrecognized/);
});

test('standard-term supplements require pinned bytes, a safe fixed source and canonical files', async (t) => {
  const root = await fixture(t); const text = 'unchanged evidence'; const checksum = hash(Buffer.from(text));
  const filename = `scripts/license-evidence/native-${checksum}.txt`; await mkdir(path.join(root, 'scripts/license-evidence'), { recursive: true }); await writeFile(path.join(root, filename), text);
  const descriptor = { path: filename, sha256: checksum, source_url: 'https://raw.githubusercontent.com/example/project/' + 'a'.repeat(40) + '/LICENSE' };
  assert.equal((await pinnedDocument(root, descriptor)).text, text);
  await assert.rejects(pinnedDocument(root, { ...descriptor, source_url: descriptor.source_url + '?token=private' }), /fixed public/);
  await writeFile(path.join(root, filename), 'changed'); await assert.rejects(pinnedDocument(root, descriptor), /bytes changed/);
  await rm(path.join(root, filename)); await writeFile(path.join(root, 'outside'), text); await symlink(path.join(root, 'outside'), path.join(root, filename));
  await assert.rejects(pinnedDocument(root, descriptor), /canonical/);
});

test('MPL original source offers are allowed only when installed source bytes match the supplied archive', async (t) => {
  const root = await fixture(t); await mkdir(path.join(root, 'src')); await writeFile(path.join(root, 'src/lib.rs'), 'original MPL code');
  const bytes = archive([['example-1.0.0/src/lib.rs', 'original MPL code']]);
  await verifyUnmodifiedCrateSources(bytes, hash(bytes), root, 'example-1.0.0');
  await writeFile(path.join(root, 'src/lib.rs'), 'modified code');
  await assert.rejects(verifyUnmodifiedCrateSources(bytes, hash(bytes), root, 'example-1.0.0'), /modified corresponding source/);
  const link = archive([['example-1.0.0/src/lib.rs', 'outside', 50]]);
  await assert.rejects(verifyUnmodifiedCrateSources(link, hash(link), root, 'example-1.0.0'), /unsupported link/);
});

test('final packaged notice file hashes reject missing, changed, extra and symlinked resources', async (t) => {
  const root = await fixture(t); const filename = path.join(root, 'NOTICE.txt'); await writeFile(filename, 'original notice'); const bytes = await readFile(filename);
  const expected = [{ path: 'NOTICE.txt', sha256: hash(bytes) }]; await verifyNativeNoticeFiles(root, expected);
  await writeFile(filename, 'altered'); await assert.rejects(verifyNativeNoticeFiles(root, expected), /changed/);
  await writeFile(filename, bytes); await writeFile(path.join(root, 'extra'), 'unexpected'); await assert.rejects(verifyNativeNoticeFiles(root, expected), /unexpected/);
  await rm(path.join(root, 'extra')); await rm(filename); await assert.rejects(verifyNativeNoticeFiles(root, expected), /missing/);
  await writeFile(path.join(root, 'target'), bytes); await symlink(path.join(root, 'target'), filename); await assert.rejects(verifyNativeNoticeFiles(root, expected), /symlink/);
});
