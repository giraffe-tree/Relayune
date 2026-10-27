import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const slash = (value) => value.split(path.sep).join('/');
const fail = (condition, message) => { if (!condition) throw new Error(`Web provenance: ${message}`); };
const hashes = {
  'package.json': '4d6342705767832f299b9a59c28e4275bcf02db19472732f93f67d979441df8f',
  'index.js': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  'error.js': '7d211552731db17e1ff8635eea0970ef57ecc91b04b95536b9fa5abbfafaec26',
};
const evidenceRelative = '.public-prep/web-license-provenance/coverage.json';
async function files(root, directory) {
  const result = [];
  async function walk(relative) {
    const filename = path.resolve(root, relative);
    fail(await realpath(filename) === filename, 'symlinks are not accepted in evidence/build trees');
    const info = await lstat(filename);
    if (info.isDirectory()) for (const name of (await readdir(filename)).sort()) await walk(path.join(relative, name));
    else { fail(info.isFile(), 'expected regular build/evidence file'); result.push(slash(relative)); }
  }
  await walk(directory);
  return result;
}
async function reviewedPackage(root) {
  const names = (await files(root, 'node_modules/client-only')).map((p) => p.slice('node_modules/client-only/'.length)).sort();
  fail(JSON.stringify(names) === JSON.stringify(Object.keys(hashes).sort()), 'client-only package files changed');
  for (const [name, hash] of Object.entries(hashes)) fail(sha(await readFile(path.join(root, 'node_modules/client-only', name))) === hash, `client-only ${name} bytes changed`);
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  fail(lock.packages?.['node_modules/client-only']?.version === '0.0.1', 'reviewed client-only lock version changed');
}
export async function webBuildInputs(root) {
  const selected = ['package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'postcss.config.mjs',
    'scripts/web-license-provenance.mjs', 'scripts/build-web-with-provenance.mjs', 'scripts/fix-static-document-languages.mjs'];
  for (const directory of ['app', 'shared', 'public', 'release-notes']) selected.push(...await files(root, directory));
  selected.push('node_modules/next/package.json');
  const result = {};
  for (const filename of selected.sort()) result[filename] = sha(await readFile(path.join(root, filename)));
  return result;
}

// Accept only the compiler's final, standalone source-map directive line. Never
// replace a substring (which could be a string literal or executable source).
export function splitSourceMapTrailer(text, kind = 'js') {
  const lines = text.split('\n');
  let last = lines.length - 1;
  while (last >= 0 && lines[last] === '') last--;
  const line = lines[last] ?? '';
  const match = kind === 'js' ? /^\/\/# sourceMappingURL=([A-Za-z0-9_.-]+\.js\.map)$/.exec(line) :
    /^\/\*# sourceMappingURL=([A-Za-z0-9_.-]+\.css\.map) \*\/$/.exec(line);
  if (!match) return null;
  return { mapName: match[1], code: lines.slice(0, last).join('\n') + '\n' };
}
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function vlq(segment) {
  const values = []; let value = 0; let shift = 0;
  for (const char of segment) {
    const digit = alphabet.indexOf(char);
    fail(digit >= 0 && shift < 50, 'invalid source-map VLQ');
    value += (digit & 31) * 2 ** shift;
    if (digit & 32) shift += 5;
    else { values.push(value % 2 ? -Math.floor(value / 2) : value / 2); value = 0; shift = 0; }
  }
  fail(shift === 0, 'unterminated source-map VLQ');
  return values;
}
export function inspectSourceMap(map, code) {
  fail(map?.version === 3 && !map.sections && !map.sourceRoot && Array.isArray(map.sources) && map.sources.length > 0 &&
    Array.isArray(map.sourcesContent) && map.sourcesContent.length === map.sources.length &&
    map.sourcesContent.every((value) => typeof value === 'string') && typeof map.mappings === 'string', 'unsupported/incomplete browser source map');
  for (let index = 0; index < map.sources.length; index++) {
    const source = map.sources[index];
    fail(typeof source === 'string' && /^turbopack:\/\/\/\[(?:project|turbopack)\]\//.test(source) && !source.includes('\\') &&
      !source.split('/').some((part) => part === '..' || part === '.'), 'unrecognized source-map path');
    fail(!/(?:^|\/)client-only(?:\/|$)/.test(source), 'client-only source participates in emitted JavaScript');
    fail(sha(Buffer.from(map.sourcesContent[index])) !== hashes['error.js'], 'reviewed client-only error content participates under another source path');
  }
  const codeLines = code.split('\n'); let source = 0; let originalLine = 0; let originalColumn = 0; let names = 0; let mapped = 0;
  const lines = map.mappings.split(';');
  fail(lines.length <= codeLines.length, 'source map extends past emitted JavaScript');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let generatedColumn = 0;
    for (const segment of lines[lineIndex].split(',').filter(Boolean)) {
      const values = vlq(segment);
      fail([1, 4, 5].includes(values.length) && values[0] >= 0, 'invalid source-map segment');
      generatedColumn += values[0];
      // Turbopack's minifier currently reports shifted columns around Unicode
      // and multiline templates. Do not pretend these are byte-level coverage.
      // Absence uses ALL listed sources/content, not a filtered coordinate set.
      fail(Number.isSafeInteger(generatedColumn), 'source-map generated column overflow');
      if (values.length > 1) {
        source += values[1]; originalLine += values[2]; originalColumn += values[3];
        fail(source >= 0 && source < map.sources.length && originalLine >= 0 && originalColumn >= 0, 'source-map source position is invalid');
        if (values.length === 5) { names += values[4]; fail(names >= 0 && names < map.names.length, 'source-map name is invalid'); }
        mapped++;
      }
    }
  }
  fail(mapped > 0, 'source map has no mapped source positions');
  const inventory = map.sources.map((source, i) => ({ source, content_sha256: sha(Buffer.from(map.sourcesContent[i])) }));
  return { source_count: map.sources.length, mapped_positions: mapped,
    source_inventory_sha256: sha(Buffer.from(JSON.stringify(inventory))) };
}
export function classifyGeneratedManifest(filename, text) {
  const name = path.basename(filename);
  if (name === '_clientMiddlewareManifest.js') return text === 'self.__MIDDLEWARE_MATCHERS = [];self.__MIDDLEWARE_MATCHERS_CB && self.__MIDDLEWARE_MATCHERS_CB()';
  if (name === '_buildManifest.js') {
    const prefix = 'self.__BUILD_MANIFEST = '; const suffix = ';self.__BUILD_MANIFEST_CB && self.__BUILD_MANIFEST_CB()';
    if (!text.startsWith(prefix) || !text.endsWith(suffix)) return false;
    const data = JSON.parse(text.slice(prefix.length, -suffix.length));
    return JSON.stringify(data) === JSON.stringify({ __rewrites: { afterFiles: [], beforeFiles: [], fallback: [] }, sortedPages: ['/_app', '/_error'] });
  }
  if (name === '_ssgManifest.js') {
    const prefix = 'self.__SSG_MANIFEST=new Set('; const suffix = ');self.__SSG_MANIFEST_CB&&self.__SSG_MANIFEST_CB()';
    if (!text.startsWith(prefix) || !text.endsWith(suffix)) return false;
    const data = JSON.parse(text.slice(prefix.length, -suffix.length));
    return Array.isArray(data) && data.every((item) => typeof item === 'string' && item.startsWith('/') && !/[\r\n]/.test(item));
  }
  return false;
}

// Next 16.4 emits a fixed queue wrapper around a JSON-only chunk descriptor.
// Do not execute it or accept arbitrary queue calls: every referenced script
// must already be in the actual JavaScript provenance inventory.
export function classifyTurbopackBootstrap(text, emitted) {
  const prefix = '(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push(';
  const suffix = ');';
  if (!text.startsWith(prefix) || !text.endsWith(suffix)) return false;
  const serialized = text.slice(prefix.length, -suffix.length);
  let data;
  try { data = JSON.parse(serialized); } catch { return false; }
  if (!data || Array.isArray(data) ||
      JSON.stringify(Object.keys(data)) !== '["otherChunks","runtimeModuleIds"]' ||
      JSON.stringify(data) !== serialized) return false;
  const { otherChunks, runtimeModuleIds } = data;
  return Array.isArray(otherChunks) && otherChunks.length > 0 && otherChunks.length <= 256 &&
    new Set(otherChunks).size === otherChunks.length && otherChunks.every(chunk =>
      typeof chunk === 'string' && /^static\/chunks\/[A-Za-z0-9_-]+\.js$/.test(chunk) &&
      emitted.includes(`out/_next/${chunk}`)) &&
    Array.isArray(runtimeModuleIds) && runtimeModuleIds.length > 0 && runtimeModuleIds.length <= 256 &&
    new Set(runtimeModuleIds).size === runtimeModuleIds.length &&
    runtimeModuleIds.every(id => Number.isSafeInteger(id) && id >= 0);
}

async function inlineInventory(root, emitted) {
  const bootstrapFile = await readFile(path.join(root, 'app/not-found-bootstrap.ts'), 'utf8');
  const prefix = 'export const NOT_FOUND_BOOTSTRAP = String.raw`';
  fail(bootstrapFile.startsWith(prefix) && bootstrapFile.endsWith('`;\n'), '404 bootstrap source layout changed');
  const bootstrap = bootstrapFile.slice(prefix.length, -3);
  const records = [];
  for (const filename of (await files(root, 'out')).filter((name) => name.endsWith('.html'))) {
    const html = await readFile(path.join(root, filename), 'utf8'); const scripts = [];
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const [, attributes, body] = match;
      if (!body) {
        const src = /\bsrc="([^"]+)"/.exec(attributes)?.[1];
        fail(src?.startsWith('/_next/static/') && emitted.includes(`out${src}`), 'HTML references an unreviewed external script');
        scripts.push({ kind: 'linked-next-script', path: `out${src}` });
      } else {
        let kind;
        if (body === bootstrap) kind = 'exact-project-404-bootstrap';
        else if (body === '(self.__next_f=self.__next_f||[]).push([0])') kind = 'next-flight-bootstrap';
        else if (classifyTurbopackBootstrap(body, emitted)) kind = 'strict-turbopack-data-bootstrap';
        else {
          fail(body.startsWith('self.__next_f.push(') && body.endsWith(')'), 'unknown inline executable script');
          const data = JSON.parse(body.slice('self.__next_f.push('.length, -1));
          fail(Array.isArray(data) && data.length === 2 && data[0] === 1 && typeof data[1] === 'string', 'unknown inline Flight data shape');
          kind = 'json-flight-data';
        }
        scripts.push({ kind, sha256: sha(Buffer.from(body)) });
      }
    }
    records.push({ path: filename, scripts });
  }
  fail(records.length > 0, 'no exported HTML');
  return records;
}

export async function finalizeWebProvenance({ projectRoot, initialInputs }) {
  const root = path.resolve(projectRoot);
  fail(await realpath(root) === root, 'project root must be canonical');
  await reviewedPackage(root);
  const inputs = await webBuildInputs(root);
  if (initialInputs) fail(JSON.stringify(inputs) === JSON.stringify(initialInputs), 'build inputs changed during compilation; rebuild');
  const outputFiles = await files(root, 'out/_next/static');
  const emitted = outputFiles.filter((name) => name.endsWith('.js'));
  fail(emitted.length > 0, 'no emitted Next JavaScript');
  const polyfill = await readFile(path.join(root, 'node_modules/next/dist/build/polyfills/polyfill-nomodule.js'));
  const records = []; const changes = []; const usedMaps = new Set();
  for (const filename of emitted) {
    const bytes = await readFile(path.join(root, filename)); const text = bytes.toString('utf8');
    const trailer = splitSourceMapTrailer(text);
    let proof;
    if (trailer) {
      const mapPath = slash(path.join(path.dirname(filename), trailer.mapName));
      fail(outputFiles.includes(mapPath), 'JavaScript references a missing/local-external map');
      const mapBytes = await readFile(path.join(root, mapPath));
      const analysis = inspectSourceMap(JSON.parse(mapBytes), trailer.code);
      proof = { kind: 'actual-linked-source-map', map_path: mapPath, map_sha256: sha(mapBytes), ...analysis };
      changes.push({ filename, text: trailer.code }); usedMaps.add(mapPath);
    } else if (bytes.equals(polyfill)) proof = { kind: 'exact-installed-next-polyfill', package_path: 'node_modules/next/dist/build/polyfills/polyfill-nomodule.js', source_sha256: sha(polyfill) };
    else {
      fail(/^out\/_next\/static\/[A-Za-z0-9_-]+\/_/.test(filename) && classifyGeneratedManifest(filename, text), `unmapped JavaScript is not an exact reviewed generated manifest: ${filename}`);
      proof = { kind: 'strict-generated-data-manifest' };
    }
    records.push({ path: filename, before_sha256: sha(bytes), sha256: sha(Buffer.from(trailer ? trailer.code : text)), ...proof });
  }
  // CSS maps also contain source text. Remove only their exact final directive,
  // then remove all build maps from the export (including orphan compiler maps).
  for (const filename of outputFiles.filter((name) => name.endsWith('.css'))) {
    const text = await readFile(path.join(root, filename), 'utf8'); const trailer = splitSourceMapTrailer(text, 'css');
    if (trailer) {
      fail(outputFiles.includes(slash(path.join(path.dirname(filename), trailer.mapName))), 'CSS references a missing map');
      changes.push({ filename, text: trailer.code });
    }
  }
  fail(usedMaps.size > 0, 'production browser source maps must be enabled');
  const inline = await inlineInventory(root, emitted);
  const maps = (await files(root, 'out')).filter((name) => name.endsWith('.map'));
  fail(maps.every((name) => name.startsWith('out/_next/static/')), 'unexpected non-Next map requires explicit review');
  const evidenceDirectory = path.join(root, '.public-prep/web-license-provenance');
  await mkdir(path.join(evidenceDirectory, 'maps'), { recursive: true });
  for (const filename of maps) {
    const destination = path.join(evidenceDirectory, 'maps', filename.slice('out/'.length));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(path.join(root, filename)));
  }
  for (const change of changes) await writeFile(path.join(root, change.filename), change.text);
  for (const filename of maps) await unlink(path.join(root, filename));
  const report = { schema_version: 1, scope: 'Actual Next static-export JavaScript only; no claim that every prebundled/native component is cleared.',
    excluded_package: { name: 'client-only', version: '0.0.1', package_path: 'node_modules/client-only', files_sha256: hashes,
      reason: 'No reviewed client-only source path or nonempty original error content occurs in any actual linked JavaScript source map. Remaining JavaScript is byte-identical Next polyfill or strictly validated generated data manifests. This excludes an unused package from a conservative dependency superset; it does not invent a license.' },
    inputs, javascript: records, inline_scripts: inline, removed_map_count: maps.length, linked_javascript_map_count: usedMaps.size,
    created_at: new Date().toISOString(), risk_accepted: false };
  await writeFile(path.join(root, evidenceRelative), JSON.stringify(report, null, 2) + '\n');
  return verifyWebProvenance({ projectRoot: root });
}
export async function verifyWebProvenance({ projectRoot }) {
  const root = path.resolve(projectRoot); await reviewedPackage(root);
  const reportBytes = await readFile(path.join(root, evidenceRelative)); const report = JSON.parse(reportBytes);
  fail(report.schema_version === 1 && report.excluded_package?.name === 'client-only' && report.excluded_package.version === '0.0.1' &&
    JSON.stringify(report.excluded_package.files_sha256) === JSON.stringify(hashes), 'unrecognized package exclusion evidence');
  fail(JSON.stringify(report.inputs) === JSON.stringify(await webBuildInputs(root)), 'source/build inputs changed after evidence generation; rebuild');
  const outputFiles = await files(root, 'out');
  fail(!outputFiles.some((name) => name.endsWith('.map')), 'source maps remain in the publication directory');
  const emitted = outputFiles.filter((name) => name.startsWith('out/_next/static/') && name.endsWith('.js')).sort();
  fail(JSON.stringify(emitted) === JSON.stringify(report.javascript.map((record) => record.path).sort()), 'emitted JavaScript file set changed');
  for (const record of report.javascript) {
    const bytes = await readFile(path.join(root, record.path));
    fail(sha(bytes) === record.sha256 && !splitSourceMapTrailer(bytes.toString('utf8')), 'emitted JavaScript changed after evidence generation');
    if (record.kind === 'actual-linked-source-map') {
      fail(/^out\/_next\/static\/chunks\/[A-Za-z0-9_.-]+\.js\.map$/.test(record.map_path), 'invalid private map evidence path');
      const privateMap = path.join(root, '.public-prep/web-license-provenance/maps', record.map_path.slice('out/'.length));
      fail(await realpath(privateMap) === privateMap, 'private map evidence cannot be symlinked');
      const map = await readFile(privateMap);
      fail(sha(map) === record.map_sha256, 'private map evidence bytes changed');
      const analysis = inspectSourceMap(JSON.parse(map), bytes.toString('utf8'));
      fail(analysis.source_inventory_sha256 === record.source_inventory_sha256, 'private map sources changed');
    } else if (record.kind === 'exact-installed-next-polyfill') {
      fail(bytes.equals(await readFile(path.join(root, 'node_modules/next/dist/build/polyfills/polyfill-nomodule.js'))), 'unmapped Next polyfill bytes changed');
    } else fail(record.kind === 'strict-generated-data-manifest' && classifyGeneratedManifest(record.path, bytes.toString('utf8')), 'unreviewed unmapped JavaScript');
  }
  fail(JSON.stringify(report.inline_scripts) === JSON.stringify(await inlineInventory(root, emitted)), 'inline scripts changed after evidence generation');
  return { ...report.excluded_package, evidence_sha256: sha(reportBytes), javascript_count: report.javascript.length,
    artifact_manifest_sha256: sha(Buffer.from(JSON.stringify(report.javascript.map(({ path, sha256 }) => ({ path, sha256 }))))), scope: report.scope };
}
