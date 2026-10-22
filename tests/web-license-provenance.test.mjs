import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, cp, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { splitSourceMapTrailer, inspectSourceMap, classifyGeneratedManifest, finalizeWebProvenance, verifyWebProvenance } from '../scripts/web-license-provenance.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const mapFor = (sources = ['turbopack:///[project]/app/example.ts'], sourcesContent = ['export const x = 1;']) =>
  ({ version: 3, sources, sourcesContent, names: [], mappings: 'AAAA' });
async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'relayune-web-provenance-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (name, data) => { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), data); };
  for (const directory of ['app', 'shared', 'public', 'release-notes']) await mkdir(path.join(root, directory));
  for (const filename of ['package.json', 'next.config.ts', 'tsconfig.json', 'postcss.config.mjs', 'scripts/web-license-provenance.mjs', 'scripts/build-web-with-provenance.mjs', 'scripts/fix-static-document-languages.mjs', 'node_modules/next/package.json']) await put(filename, '{}');
  await put('package-lock.json', JSON.stringify({ packages: { 'node_modules/client-only': { version: '0.0.1' } } }));
  await put('app/not-found-bootstrap.ts', 'export const NOT_FOUND_BOOTSTRAP = String.raw`void 0;`;\n');
  await mkdir(path.join(root, 'node_modules/client-only'), { recursive: true });
  for (const name of ['package.json', 'index.js', 'error.js']) await cp(path.join(repository, 'node_modules/client-only', name), path.join(root, 'node_modules/client-only', name));
  await put('node_modules/next/dist/build/polyfills/polyfill-nomodule.js', 'void 0;\n');
  await put('out/_next/static/chunks/app.js', 'let x=1;\n\n//# sourceMappingURL=app.js.map\n');
  await put('out/_next/static/chunks/app.js.map', JSON.stringify(mapFor()));
  await put('out/_next/static/chunks/styles.css', 'body{}\n/*# sourceMappingURL=styles.css.map */\n');
  await put('out/_next/static/chunks/styles.css.map', JSON.stringify({ version: 3, sources: ['app.css'], sourcesContent: ['body{}'], mappings: 'AAAA' }));
  await put('out/index.html', '<html><script src="/_next/static/chunks/app.js" async=""></script><script>(self.__next_f=self.__next_f||[]).push([0])</script><script>self.__next_f.push([1,"page data"])</script></html>');
  return { root, put };
}

test('only a standalone final directive is removed; literals and trailing code survive', () => {
  assert.equal(splitSourceMapTrailer('const s="//# sourceMappingURL=x.js.map";\n'), null);
  assert.equal(splitSourceMapTrailer('//# sourceMappingURL=x.js.map\nalert(1);\n'), null);
  assert.equal(splitSourceMapTrailer('x();\n//# sourceMappingURL=../../secret.map\n'), null);
  assert.deepEqual(splitSourceMapTrailer('const s="sourceMappingURL=x.js.map";\n\n//# sourceMappingURL=x.js.map\n'), { code: 'const s="sourceMappingURL=x.js.map";\n\n', mapName: 'x.js.map' });
  assert.equal(splitSourceMapTrailer('body{}\n/*# sourceMappingURL=x.css.map */\n', 'css').code, 'body{}\n');
});

test('all source paths are reviewed, including sources not selected by mappings', () => {
  assert.equal(inspectSourceMap(mapFor(), 'let x=1;\n').mapped_positions, 1);
  assert.throws(() => inspectSourceMap(mapFor(['turbopack:///[project]/app/example.ts', 'turbopack:///[project]/node_modules/client-only/error.js'], ['ok', 'unused']), 'let x=1;\n'), /client-only source/);
});

test('the original error source is rejected even under a renamed module path', async () => {
  const original = await readFile(path.join(repository, 'node_modules/client-only/error.js'), 'utf8');
  assert.throws(() => inspectSourceMap(mapFor(undefined, [original]), 'let x=1;\n'), /another source path/);
});

test('missing contents, foreign paths, malformed VLQ and invalid source indexes fail', () => {
  for (const map of [{ ...mapFor(), sourcesContent: [null] }, mapFor(['file:///private/example.ts']), { ...mapFor(), mappings: '!' }, { ...mapFor(), mappings: 'ACAA' }, { ...mapFor(), mappings: '' }]) {
    assert.throws(() => inspectSourceMap(map, 'let x=1;\n'), /Web provenance/);
  }
});

test('generated manifests permit only data and the reviewed callback grammar', () => {
  const good = 'self.__SSG_MANIFEST=new Set(["/en"]);self.__SSG_MANIFEST_CB&&self.__SSG_MANIFEST_CB()';
  assert.equal(classifyGeneratedManifest('_ssgManifest.js', good), true);
  assert.equal(classifyGeneratedManifest('_ssgManifest.js', good + ';alert(1)'), false);
  assert.throws(() => classifyGeneratedManifest('_ssgManifest.js', good.replace('["/en"]', '[alert(1)]')));
  assert.equal(classifyGeneratedManifest('unknown.js', 'void 0;'), false);
});

test('finalizer binds actual JS/maps, preserves evidence privately and exports no maps', async (t) => {
  const { root } = await fixture(t);
  const evidence = await finalizeWebProvenance({ projectRoot: root });
  assert.equal(evidence.name, 'client-only');
  assert.equal(evidence.javascript_count, 1);
  assert.equal(await readFile(path.join(root, 'out/_next/static/chunks/app.js'), 'utf8'), 'let x=1;\n\n');
  assert.equal((await readdir(path.join(root, 'out'), { recursive: true })).some((name) => name.endsWith('.map')), false);
  assert.equal((await verifyWebProvenance({ projectRoot: root })).artifact_manifest_sha256, evidence.artifact_manifest_sha256);
  const report = await readFile(path.join(root, '.public-prep/web-license-provenance/coverage.json'), 'utf8');
  assert.equal(report.includes(root), false);
  assert.equal(JSON.parse(report).javascript[0].sha256, sha(Buffer.from('let x=1;\n\n')));
});

test('unknown unmapped JS, unknown inline code and emitted client-only each block before stripping', async (t) => {
  for (const kind of ['unknown-js', 'inline', 'client-only']) {
    const { root, put } = await fixture(t);
    if (kind === 'unknown-js') await put('out/_next/static/chunks/foreign.js', 'alert(1);');
    else if (kind === 'inline') await put('out/index.html', '<script>alert(1)</script>');
    else await put('out/_next/static/chunks/app.js.map', JSON.stringify(mapFor(['turbopack:///[project]/node_modules/client-only/index.js'], [''])));
    await assert.rejects(finalizeWebProvenance({ projectRoot: root }), /Web provenance/);
    assert.match(await readFile(path.join(root, 'out/_next/static/chunks/app.js'), 'utf8'), /sourceMappingURL/);
  }
});

test('after generation, changes to actual output, private map or source inputs reject stale evidence', async (t) => {
  for (const kind of ['output', 'new-js', 'map', 'source', 'package']) {
    const { root, put } = await fixture(t);
    await finalizeWebProvenance({ projectRoot: root });
    if (kind === 'output') await put('out/_next/static/chunks/app.js', 'let x=2;\n\n');
    if (kind === 'new-js') await put('out/_next/static/chunks/new.js', 'void 0;');
    if (kind === 'map') await put('.public-prep/web-license-provenance/maps/_next/static/chunks/app.js.map', JSON.stringify(mapFor(undefined, ['changed'])));
    if (kind === 'source') await put('app/new.ts', 'export const x=2;');
    if (kind === 'package') await put('node_modules/client-only/error.js', 'throw new Error("changed");');
    await assert.rejects(verifyWebProvenance({ projectRoot: root }), /Web provenance/);
  }
});
