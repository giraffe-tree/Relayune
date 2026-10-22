#!/usr/bin/env node
// Native material collection is independent of signing, builds and application execution.
import { readFile, writeFile, mkdir, realpath, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const licenseSeparator = `\n${'-'.repeat(80)}\n`;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const utf8 = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
export function decodeEvidence(bytes, encoding = 'utf-8') {
  if (encoding === 'utf-8') return utf8(bytes);
  if (encoding !== 'utf-8-with-isolated-latin1-copyright') throw new Error('Unsupported evidence text encoding');
  // Two upstream PDFium license distributions retain a single Latin-1 copyright byte
  // among otherwise UTF-8 data. Preserve raw evidence/hash, transcode only that byte.
  const output = [];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0xa9 && bytes[i - 1] !== 0xc2) output.push(0xc2);
    output.push(bytes[i]);
  }
  return utf8(Uint8Array.from(output));
}
async function regular(file) {
  if (!(await lstat(file)).isFile()) throw new Error('Native license input must be a regular file');
  return readFile(file);
}
async function optional(file) {
  try { return await regular(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
async function evidenceFile(projectRoot, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error('Invalid evidence path');
  const absolute = path.resolve(projectRoot, relative);
  if (!inside(projectRoot, absolute) || !inside(await realpath(projectRoot), await realpath(absolute))) {
    throw new Error('Evidence escapes project');
  }
  return regular(absolute);
}

/** Flutter 3.32.8 license_collector.dart algorithm: NOTICES wins; split only exact
 * 80-hyphen delimiters; deduplicate by the complete unmodified license body.
 * Component names in a composite LICENSE need not equal its Pub package name.
 * Algorithm source is BSD-licensed by The Flutter Authors, retained in SDK notices.
 */
export function collectFlutterSections(inputs) {
  const byText = new Map();
  for (const { name, text } of inputs) {
    const raw = text.split(licenseSeparator);
    for (const part of raw) {
      const split = raw.length > 1 ? part.indexOf('\n\n') : -1;
      const names = split >= 0 ? part.slice(0, split).split('\n') : [name];
      const body = split >= 0 ? part.slice(split + 2) : part;
      const namesForBody = byText.get(body) ?? new Set();
      for (const component of names) namesForBody.add(component);
      byText.set(body, namesForBody);
    }
  }
  return [...byText].map(([text, names]) => ({ names: [...names].sort(), text }))
    .sort((a, b) => (a.names.join('\n') + '\n\n' + a.text) < (b.names.join('\n') + '\n\n' + b.text) ? -1 : 1);
}
export function flutterText(sections) {
  return sections.map(({ names, text }) => `${names.join('\n')}\n\n${text}`).join(licenseSeparator);
}

export async function readFlutterInputs(projectRoot) {
  const configPath = path.join(projectRoot, 'mobile/.dart_tool/package_config.json');
  const configBytes = await regular(configPath);
  const config = JSON.parse(utf8(configBytes));
  const inputs = [], versions = {};
  let sdkRoot;
  for (const pkg of config.packages) {
    const root = fileURLToPath(new URL(pkg.rootUri, pathToFileURL(configPath)));
    const packageUriRoot = new URL(pkg.packageUri ?? 'lib/', pathToFileURL(`${root}${path.sep}`));
    const notices = fileURLToPath(new URL('../NOTICES', packageUriRoot));
    const license = fileURLToPath(new URL('../LICENSE', packageUriRoot));
    const noticeBytes = await optional(notices);
    const bytes = noticeBytes ?? await optional(license);
    if (bytes) inputs.push({ name: pkg.name, text: utf8(bytes), sha256: sha256(bytes),
      source: noticeBytes ? 'NOTICES' : 'LICENSE' });
    if (pkg.name === 'flutter') sdkRoot = path.resolve(root, '../..');
    if (['pdfrx', 'pdfrx_engine', 'flutter_webrtc', 'mobile_scanner'].includes(pkg.name)) {
      const yaml = utf8(await regular(path.join(root, 'pubspec.yaml')));
      const version = yaml.match(/^version:\s*([^\s#]+)/m)?.[1];
      if (!version) throw new Error('Missing native plugin version');
      versions[pkg.name] = { version, root };
    }
  }
  if (!sdkRoot || !inputs.some(x => x.name === 'sky_engine')) throw new Error('Flutter engine license is absent from package graph');
  const sdkVersion = JSON.parse(utf8(await regular(path.join(sdkRoot, 'bin/cache/flutter.version.json'))));
  const algorithm = await regular(path.join(sdkRoot, 'packages/flutter_tools/lib/src/license_collector.dart'));
  if (sdkVersion.frameworkVersion !== '3.32.8' || sdkVersion.engineRevision !== 'ef0cd000916d64fa0c5d09cc809fa7ad244a5767') {
    throw new Error('Flutter SDK changed; review license collector and engine bindings before release');
  }
  return { inputs, sections: collectFlutterSections(inputs), versions, sdkVersion,
    collector_sha256: sha256(algorithm) };
}

const unescapeXml = value => value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) =>
  ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name]).replace(/&#(x[\da-f]+|\d+);/gi,
  (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n)));
export function parseAcknowledgements(xml) {
  if (!xml.includes('<plist')) throw new Error('Expected XML acknowledgements plist');
  const array = xml.match(/<key>PreferenceSpecifiers<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1];
  if (!array) throw new Error('Missing acknowledgement array');
  return [...array.matchAll(/<dict>([\s\S]*?)<\/dict>/g)].flatMap(([, body]) => {
    const fields = Object.fromEntries([...body.matchAll(/<key>([^<]+)<\/key>\s*<string>([\s\S]*?)<\/string>/g)]
      .map(([, k, v]) => [k, unescapeXml(v)]));
    return fields.Title && fields.Title !== 'Acknowledgements' && fields.FooterText
      ? [{ name: fields.Title, text: fields.FooterText }] : [];
  });
}

/** Select archive members without extracting paths or invoking native tools. */
export function readZipEntries(zip, accept, maxEntryBytes = 128 * 1024 * 1024) {
  const min = Math.max(0, zip.length - 65557);
  let end = zip.length - 22;
  for (; end >= min && zip.readUInt32LE(end) !== 0x06054b50; end--);
  if (end < min || zip.readUInt16LE(end + 4) !== 0 || zip.readUInt16LE(end + 6) !== 0) throw new Error('Unsupported ZIP archive');
  const count = zip.readUInt16LE(end + 10), entries = [];
  let offset = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP directory');
    const flags = zip.readUInt16LE(offset + 8), method = zip.readUInt16LE(offset + 10);
    const size = zip.readUInt32LE(offset + 20), plainSize = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28), extra = zip.readUInt16LE(offset + 30), comment = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = utf8(zip.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extra + comment;
    if (name.startsWith('/') || name.split(/[\\/]/).includes('..')) throw new Error('Unsafe ZIP entry');
    if (!accept(name) || name.endsWith('/')) continue;
    if ((flags & 1) || ![0, 8].includes(method) || plainSize > maxEntryBytes || size > maxEntryBytes) throw new Error('Unsupported license ZIP entry');
    if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid ZIP local entry');
    const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const bytes = method === 0 ? zip.subarray(start, start + size) : inflateRawSync(zip.subarray(start, start + size), { maxOutputLength: Math.max(1, plainSize) });
    if (bytes.length !== plainSize) throw new Error('ZIP license size mismatch');
    entries.push({ path: name, bytes });
  }
  return entries;
}
export function zipLicenseEntries(zip, depth = 0) {
  if (depth > 1) throw new Error('Nested license archive limit exceeded');
  const documents = readZipEntries(zip, name => (depth === 0 && /(?:^|\/)classes\.jar$/.test(name)) ||
    /^(?:licen[sc]es?|notices?|copying|copyright|third[-_]party[-_]licen[sc]es?)(?:[._-].*)?$/i.test(name.split('/').at(-1)), 16 * 1024 * 1024);
  return documents.flatMap(({ path: name, bytes }) => {
    if (depth === 0 && /(?:^|\/)classes\.jar$/.test(name)) return zipLicenseEntries(bytes, depth + 1).map(entry => ({ ...entry, path: `${name}!/${entry.path}` }));
    try { return [{ path: name, text: utf8(bytes), sha256: sha256(bytes) }]; }
    catch { throw new Error(`Non-UTF-8 native archive license: ${name}`); }
  });
}

export async function collectMobileNotices({ projectRoot, platform = 'ios', acknowledgementsPath,
  androidResolvedPath, evidenceManifestPath = 'scripts/license-evidence/native-mobile-evidence/manifest.json' }) {
  if (!['ios', 'android'].includes(platform)) throw new Error('Expected ios or android');
  projectRoot = await realpath(projectRoot);
  const flutter = await readFlutterInputs(projectRoot);
  const manifestBytes = await evidenceFile(projectRoot, evidenceManifestPath);
  const manifest = JSON.parse(utf8(manifestBytes));
  const sdk = manifest.bindings.flutter_sdk;
  if (sdk && (sdk.collector_sha256 !== flutter.collector_sha256 || sdk.engine_license_sha256 !== flutter.inputs.find(x => x.name === 'sky_engine')?.sha256)) throw new Error('Flutter license source differs from pinned SDK evidence');
  for (const [name, version] of Object.entries(manifest.bindings.pub_plugins)) {
    if (flutter.versions[name]?.version !== version) throw new Error('Native plugin version differs from pinned evidence');
  }
  const sections = [], documents = [], mavenPackages = [];
  if (platform === 'android') {
    const resolved = JSON.parse(utf8(await regular(androidResolvedPath ?? path.join(projectRoot, '.public-prep/native-mobile-android-resolved.json'))));
    for (const artifact of resolved.artifacts) {
      const coordinate = `${artifact.group}:${artifact.name}:${artifact.version}`;
      const bytes = await regular(artifact.file);
      const expected = manifest.android_artifacts?.find(x => x.coordinate === coordinate && x.artifact_name === path.basename(artifact.file));
      if (!expected || expected.artifact_sha256 !== sha256(bytes)) throw new Error('Resolved Maven artifact differs from pinned license evidence');
      const entries = zipLicenseEntries(bytes);
      for (const entry of entries) sections.push(`${coordinate} / ${entry.path}\n\n${entry.text}`);
      mavenPackages.push({ coordinate, artifact_name: path.basename(artifact.file), artifact_sha256: sha256(bytes), bundled_license_files: entries.map(({ path, sha256 }) => ({ path, sha256 })) });
    }
  }
  if (platform === 'ios') {
    const plist = await regular(acknowledgementsPath ?? path.join(projectRoot, 'mobile/ios/Pods/Target Support Files/Pods-Runner/Pods-Runner-acknowledgements.plist'));
    for (const entry of parseAcknowledgements(utf8(plist))) {
      sections.push(`${entry.name} (CocoaPods acknowledgement)\n\n${entry.text}`);
      documents.push({ component: entry.name, source: 'CocoaPods acknowledgement', sha256: sha256(entry.text) });
    }
  }
  for (const entry of manifest.documents.filter(x => x.platforms.includes(platform))) {
    const bytes = await evidenceFile(projectRoot, entry.path);
    if (sha256(bytes) !== entry.sha256 || bytes.length !== entry.bytes) throw new Error('Native evidence hash mismatch');
    sections.push(`${entry.component}\n\nSource: ${entry.source_url}\nEvidence: ${entry.evidence_kind}\n\n${decodeEvidence(bytes, entry.encoding)}`);
    documents.push(entry);
  }
  const unresolved = manifest.unresolved.filter(x => x.platforms.includes(platform));
  const text = sections.join(licenseSeparator);
  const coverage = { schema_version: 1, platform,
    selection: 'flutter-package-license-graph-and-native-version-bound-materials-superset',
    exact_linked_binary: false, notices_complete: unresolved.length === 0, risk_accepted: false,
    flutter: { framework: flutter.sdkVersion.frameworkVersion, engine: flutter.sdkVersion.engineRevision,
      collector_sha256: flutter.collector_sha256, packages: flutter.inputs.map(({ name, sha256: hash, source }) => ({ name, sha256: hash, source })),
      component_license_sections: flutter.sections.length },
    plugin_versions: Object.fromEntries(Object.entries(flutter.versions).map(([k, v]) => [k, v.version])),
    documents, maven_packages: mavenPackages, unresolved, supplement_sha256: sha256(text),
    artifact_verification: { status: 'not checked; collect does not inspect final app or execute a build' } };
  return { text, coverage, flutter };
}

export async function generateMobileMaterials({ projectRoot }) {
  projectRoot = await realpath(projectRoot);
  const manifestBytes = await evidenceFile(projectRoot, 'scripts/license-evidence/native-mobile-evidence/manifest.json');
  const manifest = JSON.parse(utf8(manifestBytes));
  for (const [relative, expected] of Object.entries(manifest.bindings.input_hashes)) {
    if (sha256(await evidenceFile(projectRoot, relative)) !== expected) throw new Error('Mobile lock changed; refresh native license evidence');
  }
  const projectLicense = await regular(path.join(projectRoot, 'LICENSE'));
  if (!utf8(projectLicense).includes('MIT License')) throw new Error('Project license changed; review native materials');
  const sections = [`Relayune — project-owned code and assets (MIT)\n\n${utf8(projectLicense)}`];
  const groups = new Map();
  for (const entry of manifest.documents) {
    const bytes = await evidenceFile(projectRoot, entry.path);
    if (sha256(bytes) !== entry.sha256 || bytes.length !== entry.bytes) throw new Error('Native evidence hash mismatch');
    const key = `${entry.sha256}:${entry.encoding ?? 'utf-8'}`;
    const group = groups.get(key) ?? { entries: [], text: decodeEvidence(bytes, entry.encoding) };
    group.entries.push(entry); groups.set(key, group);
  }
  for (const group of groups.values()) {
    const names = [...new Set(group.entries.map(e => `${e.component} [${e.platforms.join(', ')}]`))];
    const provenance = [...new Set(group.entries.map(e => `Source: ${e.source_url}\nEvidence: ${e.evidence_kind}`))];
    sections.push(`${names.join('\n')}\n\n${provenance.join('\n')}\n\n${group.text}`);
  }
  const text = sections.join(licenseSeparator);
  const coverage = { schema_version: 1,
    selection: 'cross-platform-locked-mobile-native-license-materials-superset; includes optional and unused source components',
    exact_linked_binary: false, notices_complete: manifest.unresolved.length === 0, risk_accepted: false,
    project_license: { path: 'LICENSE', sha256: sha256(projectLicense), scope: 'project-owned code/assets only; third parties retain their original licenses' },
    evidence_manifest_sha256: sha256(manifestBytes), supplement_sha256: sha256(text),
    bindings: manifest.bindings, documents: manifest.documents,
    maven_packages: manifest.android_artifacts, webrtc_generator_path_coverage: manifest.webrtc_generator_path_coverage,
    vendor_terms: manifest.vendor_terms, unresolved: manifest.unresolved,
    artifact_checks_pending: manifest.artifact_checks_pending,
    artifact_verification: { status: 'materials generated only; final app/IPA/APK/AAB must be separately inspected; native SDKs not independently rebuilt' } };
  return { text, coverage };
}

export function verifyFlutterNotices(noticeBytes, expectedSections, supplement) {
  const text = utf8(gunzipSync(noticeBytes, { maxOutputLength: 32 * 1024 * 1024 }));
  const actual = collectFlutterSections([{ name: 'final-app', text }]);
  const bodyNames = new Map(actual.map(x => [x.text, new Set(x.names)]));
  for (const expected of expectedSections) {
    const names = bodyNames.get(expected.text);
    if (!names || expected.names.some(name => !names.has(name))) throw new Error('Final Flutter NOTICES omits or changes a complete component license');
  }
  if (supplement && !text.includes(supplement)) throw new Error('Final Flutter NOTICES lacks current complete native supplement');
  return { compressed_sha256: sha256(noticeBytes), text_sha256: sha256(text), text_bytes: Buffer.byteLength(text), verified_component_sections: expectedSections.length };
}
export async function verifyIosApp({ projectRoot, appPath, evidenceManifestPath }) {
  const collected = await collectMobileNotices({ projectRoot, platform: 'ios', evidenceManifestPath });
  const app = await realpath(appPath);
  const assetRoot = path.join(app, 'Frameworks/App.framework/flutter_assets');
  const notices = await regular(path.join(assetRoot, 'NOTICES.Z'));
  const generated = await generateMobileMaterials({ projectRoot });
  const noticeVerification = verifyFlutterNotices(notices, collected.flutter.sections, generated.text);
  const nativeAsset = await regular(path.join(assetRoot, 'assets/native-notices/THIRD_PARTY_LICENSES.txt'));
  const nativeCoverage = JSON.parse(utf8(await regular(path.join(assetRoot, 'assets/native-notices/COVERAGE.json'))));
  if (sha256(nativeAsset) !== sha256(generated.text) || nativeCoverage.evidence_manifest_sha256 !== generated.coverage.evidence_manifest_sha256) throw new Error('iOS app carries stale native license resources');
  const files = [];
  for (const relative of ['Runner', 'Frameworks/Flutter.framework/Flutter', 'Frameworks/App.framework/App', 'Frameworks/WebRTC.framework/WebRTC']) {
    files.push({ path: relative, sha256: sha256(await regular(path.join(app, relative))) });
  }
  const debugBinary = await optional(path.join(app, 'Runner.debug.dylib'));
  if (debugBinary) files.push({ path: 'Runner.debug.dylib', sha256: sha256(debugBinary) });
  for (const relative of ['assets/pdfium.wasm', 'assets/pdfium_client.js', 'assets/pdfium_worker.js']) {
    const expected = await regular(path.join(collected.flutter.versions.pdfrx.root, relative));
    const manifest = JSON.parse(utf8(await evidenceFile(projectRoot, evidenceManifestPath ?? 'scripts/license-evidence/native-mobile-evidence/manifest.json')));
    if (manifest.bindings.pdfrx_assets.find(x => x.path === relative)?.sha256 !== sha256(expected)) throw new Error('Pub PDFium asset differs from pinned native evidence');
    const bundledPath = `packages/pdfrx/${relative}`;
    const actual = await regular(path.join(assetRoot, bundledPath));
    if (sha256(expected) !== sha256(actual)) throw new Error('Bundled PDFium asset differs from locked Pub package');
    files.push({ path: bundledPath, sha256: sha256(actual) });
  }
  return { ...generated.coverage, flutter: collected.coverage.flutter, artifact_verification: { status: 'actual ios app notices, frameworks and bundled PDFium assets read and hashed; no app executed',
    ...noticeVerification, files }, notice_checks_passed: generated.coverage.notices_complete };
}

export async function verifyAndroidArchive({ projectRoot, archivePath }) {
  const generated = await generateMobileMaterials({ projectRoot });
  const flutter = await readFlutterInputs(projectRoot);
  const archiveBytes = await regular(archivePath);
  const selected = readZipEntries(archiveBytes, name => name.endsWith('/flutter_assets/NOTICES.Z') ||
    name.endsWith('/flutter_assets/assets/native-notices/THIRD_PARTY_LICENSES.txt') ||
    name.endsWith('/flutter_assets/assets/native-notices/COVERAGE.json') || /\/flutter_assets\/packages\/pdfrx\/assets\/pdfium(?:\.wasm|_client\.js|_worker\.js)$/.test(name) || /(?:^|\/)lib\/[^/]+\/[^/]+\.so$/.test(name));
  const notice = selected.find(x => x.path.endsWith('/flutter_assets/NOTICES.Z'));
  const nativeText = selected.find(x => x.path.endsWith('/flutter_assets/assets/native-notices/THIRD_PARTY_LICENSES.txt'));
  const coverage = selected.find(x => x.path.endsWith('/flutter_assets/assets/native-notices/COVERAGE.json'));
  if (!notice || !nativeText || !coverage) throw new Error('Android archive lacks Flutter notices or generated native license resources');
  if (sha256(nativeText.bytes) !== sha256(generated.text)) throw new Error('Android archive carries stale native license text');
  const parsedCoverage = JSON.parse(utf8(coverage.bytes));
  if (parsedCoverage.evidence_manifest_sha256 !== generated.coverage.evidence_manifest_sha256 || parsedCoverage.supplement_sha256 !== sha256(generated.text)) throw new Error('Android archive carries stale native coverage');
  const nativeLibraries = selected.filter(x => x.path.endsWith('.so'));
  if (!nativeLibraries.some(x => x.path.endsWith('/libflutter.so')) || !nativeLibraries.some(x => x.path.endsWith('/libjingle_peerconnection_so.so')) || !nativeLibraries.some(x => x.path.endsWith('/libpdfium.so'))) throw new Error('Android native runtime inventory is incomplete');
  for (const expected of generated.coverage.bindings.pdfrx_assets) {
    const file = selected.find(x => x.path.endsWith(`/flutter_assets/packages/pdfrx/${expected.path}`));
    if (!file || sha256(file.bytes) !== expected.sha256) throw new Error('Android bundled PDFium asset differs from pinned native evidence');
  }
  return { ...generated.coverage, artifact_verification: {
    status: 'actual Android archive read only; not installed or executed', archive_sha256: sha256(archiveBytes),
    ...verifyFlutterNotices(notice.bytes, flutter.sections, generated.text),
    native_libraries: nativeLibraries.map(x => ({ path: x.path, sha256: sha256(x.bytes),
      source_relationship: 'actual final binary hash; source SDK/version binding is separate, no independent rebuild claim' })) },
    notice_checks_passed: generated.coverage.notices_complete };
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  if (mode === 'generate') {
    const result = await generateMobileMaterials({ projectRoot });
    const output = path.join(projectRoot, 'mobile/assets/native-notices');
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'THIRD_PARTY_LICENSES.txt'), result.text);
    await writeFile(path.join(output, 'COVERAGE.json'), `${JSON.stringify(result.coverage, null, 2)}\n`);
    console.log(JSON.stringify({ notices_complete: result.coverage.notices_complete, documents: result.coverage.documents.length, text_sha256: sha256(result.text), bytes: Buffer.byteLength(result.text) }));
  } else if (mode === 'collect' && ['ios', 'android'].includes(args[0]) && args[1]) {
    const result = await collectMobileNotices({ projectRoot, platform: args[0] });
    const output = path.resolve(args[1]); await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'NATIVE-LICENSES.txt'), result.text);
    await writeFile(path.join(output, 'COVERAGE.json'), `${JSON.stringify(result.coverage, null, 2)}\n`);
    console.log(JSON.stringify({ platform: args[0], notices_complete: result.coverage.notices_complete, unresolved: result.coverage.unresolved }));
  } else if (mode === 'verify-android-archive' && args[0]) {
    const result = await verifyAndroidArchive({ projectRoot, archivePath: args[0] });
    console.log(JSON.stringify(result, null, 2));
    if (!result.notice_checks_passed) process.exitCode = 1;
  } else if (mode === 'verify-ios-app' && args[0]) {
    const result = await verifyIosApp({ projectRoot, appPath: args[0] });
    console.log(JSON.stringify(result, null, 2));
    if (!result.notice_checks_passed) process.exitCode = 1;
  } else throw new Error('Usage: native-mobile-notices.mjs generate | collect ios|android OUTPUT_DIR | verify-ios-app APP_PATH | verify-android-archive APK_OR_AAB');
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
