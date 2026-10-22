import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { collectPackageNotices } from './bundle-notices.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const portable = (value) => value.split(path.sep).join('/');
function requireEvidence(condition, message) { if (!condition) throw new Error(`Native notices: ${message}`); }
const expectedTargets = { 'aarch64-apple-darwin': { pkg: 'macos-arm64', arch: 'arm64' }, 'x86_64-apple-darwin': { pkg: 'macos-x64', arch: 'x64' } };
const noticeName = /^(?:licen[cs]e|copying|notice|copyright)(?:$|[._-])/i;
const noticeExtension = /^\.(?:md|txt|rst|spdx|html|mit|bsd(?:-[23]-clause)?|apache(?:-2\.0)?|zlib)$/i;
const utf8 = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
async function regular(filename) {
  requireEvidence(await realpath(filename) === path.resolve(filename) && (await lstat(filename)).isFile(), 'expected canonical regular evidence file');
  return readFile(filename);
}
function fullTerms(text) {
  const t = text.toLowerCase().replace(/\s+/g, ' ');
  return [ ['permission is hereby granted', 'the software is provided'], ['redistribution and use in source and binary forms', 'this software is provided'],
    ['apache license', 'end of terms and conditions'], ['mozilla public license', 'exhibit a'],
    ['this is free and unencumbered software released into the public domain', 'the software is provided'],
    ['permission to use, copy, modify', 'the software is provided'], ['this software is provided', 'permission is granted to anyone', 'must not be misrepresented'],
    ['unicode', 'permission is hereby granted', 'the data files and software are provided'], ['cc0 1.0 universal', 'public license fallback', 'limitations']
  ].some((parts) => parts.every((part) => t.includes(part)));
}
export function crateArchiveEntries(archive, expectedChecksum) {
  requireEvidence(hash(archive) === expectedChecksum, 'original crate archive checksum does not match the Cargo lock');
  const tar = gunzipSync(archive, { maxOutputLength: 256 * 1024 * 1024 }); const entries = [];
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512); if (header.every((value) => value === 0)) break;
    const string = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const name = string(0, 100); const prefix = string(345, 155); const filename = prefix ? `${prefix}/${name}` : name;
    const sizeText = string(124, 12).trim();
    requireEvidence(/^[0-7]+$/.test(sizeText), 'invalid crate tar entry size');
    const size = Number.parseInt(sizeText, 8); const start = offset + 512;
    requireEvidence(Number.isSafeInteger(size) && start + size <= tar.length, 'truncated crate tar entry');
    requireEvidence(!filename.startsWith('/') && !filename.includes('\\') && !filename.split('/').includes('..'), 'unsafe original crate archive member path');
    entries.push({ filename, type: header[156], bytes: tar.subarray(start, start + size) });
    offset = start + Math.ceil(size / 512) * 512;
  }
  return entries;
}
export function rootNoticeDocuments(archive, packageDirectoryName, expectedChecksum) {
  const documents = [];
  for (const entry of crateArchiveEntries(archive, expectedChecksum)) {
    const parts = entry.filename.split('/'); const basename = parts.at(-1); const extension = path.extname(basename);
    if (parts.length === 2 && parts[0] === packageDirectoryName && noticeName.test(basename) && (!extension || noticeExtension.test(extension))) {
      requireEvidence(entry.type === 0 || entry.type === 48, 'license entries in the original crate must be regular files');
      documents.push({ path: basename, sha256: hash(entry.bytes), text: utf8(entry.bytes), evidence_kind: 'original-checksummed-crate-document' });
    }
  }
  return documents;
}
export function cargoLockChecksums(text) {
  const checksums = new Map();
  for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const field = (key) => { const match = new RegExp(`^${key} = ("[^"\\r\\n]+")$`, 'm').exec(block); return match ? JSON.parse(match[1]) : null; };
    const name = field('name'); const version = field('version'); const source = field('source');
    if (!source) continue;
    const checksum = field('checksum');
    requireEvidence(source === 'registry+https://github.com/rust-lang/crates.io-index' && /^[a-f0-9]{64}$/.test(checksum ?? ''), 'unreviewed Cargo registry source/checksum');
    const key = `${name}@${version}`; requireEvidence(!checksums.has(key), 'ambiguous Cargo lock package identity'); checksums.set(key, checksum);
  }
  return checksums;
}
export async function verifyUnmodifiedCrateSources(archive, checksum, directory, packageDirectoryName) {
  for (const entry of crateArchiveEntries(archive, checksum)) {
    requireEvidence([0, 48, 53, 120, 103].includes(entry.type), 'original MPL source archive contains an unsupported link/member');
    if (entry.type !== 0 && entry.type !== 48) continue;
    requireEvidence(entry.filename.startsWith(`${packageDirectoryName}/`), 'original source archive package identity changed');
    const relative = entry.filename.slice(packageDirectoryName.length + 1);
    requireEvidence(hash(await regular(path.join(directory, relative))) === hash(entry.bytes), 'MPL source was modified; preserve and provide the actual modified corresponding source');
  }
}
export async function pinnedDocument(projectRoot, descriptor) {
  requireEvidence(typeof descriptor?.path === 'string' && /^scripts\/license-evidence\/native-[a-f0-9]{64}\.(?:txt|html)$/.test(descriptor.path), 'unrecognized supplemental document path');
  const bytes = await regular(path.join(projectRoot, descriptor.path));
  requireEvidence(hash(bytes) === descriptor.sha256 && bytes.length > 0, 'pinned supplemental license bytes changed');
  const url = new URL(descriptor.source_url);
  requireEvidence(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
    ['raw.githubusercontent.com', 'static.rust-lang.org'].includes(url.hostname) &&
    (/\/[a-f0-9]{40}\//.test(url.pathname) || /(?:\/|-)v?\d+\.\d+\.\d+(?:\/|-)/.test(url.pathname)), 'supplement source must be a fixed public revision/version');
  return { ...descriptor, text: utf8(bytes) };
}
function cargoMetadata(projectRoot, target) {
  return JSON.parse(execFileSync('cargo', ['metadata', '--manifest-path', path.join(projectRoot, 'desktop/src-tauri/Cargo.toml'), '--filter-platform', target, '--locked', '--offline', '--format-version', '1'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}
export function selectedCargoPackages(metadata) {
  requireEvidence(metadata.resolve?.root && Array.isArray(metadata.packages) && Array.isArray(metadata.resolve.nodes), 'Cargo metadata is incomplete');
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node])); const packages = new Map(metadata.packages.map((item) => [item.id, item]));
  const queue = [metadata.resolve.root]; const visited = new Set();
  while (queue.length) {
    const id = queue.shift(); if (visited.has(id)) continue;
    requireEvidence(nodes.has(id) && packages.has(id), 'Cargo resolved dependency is absent from metadata'); visited.add(id);
    for (const dep of nodes.get(id).deps) if (dep.dep_kinds.some((kind) => kind.kind !== 'dev')) queue.push(dep.pkg);
  }
  return [...visited].map((id) => packages.get(id)).filter((pkg) => pkg.source);
}
function commandOutput(command, args, options = {}) { return execFileSync(command, args, { encoding: 'utf8', timeout: 20000, ...options }).trim(); }
export function systemNativeDependencies(output) {
  const dependencies = [];
  for (const line of output.split('\n').slice(1)) {
    if (!line.trim() || (!/^\s/.test(line) && line.endsWith(':'))) continue;
    const match = /^\s+(.+?) \(compatibility version [^)]+\)$/.exec(line);
    requireEvidence(match, 'unrecognized Mach-O dependency output');
    requireEvidence(path.posix.normalize(match[1]) === match[1] && (match[1].startsWith('/usr/lib/') || match[1].startsWith('/System/Library/')), 'non-system native dependency requires its own redistribution evidence');
    dependencies.push(match[1]);
  }
  requireEvidence(dependencies.length > 0, 'Mach-O dependency list is empty');
  return [...new Set(dependencies)].sort();
}
async function cargoNotices(projectRoot, targets, manifest, outputDirectory) {
  const checksums = cargoLockChecksums(utf8(await regular(path.join(projectRoot, 'desktop/src-tauri/Cargo.lock'))));
  const selected = new Map();
  for (const target of targets) for (const pkg of selectedCargoPackages(cargoMetadata(projectRoot, target))) {
    const key = `${pkg.name}@${pkg.version}`;
    if (selected.has(key)) requireEvidence(selected.get(key).manifest_path === pkg.manifest_path, 'same-version Cargo package has mixed source roots');
    selected.set(key, pkg);
  }
  const packages = []; const sections = ['Rust dependency license notices', 'Selection: target-filtered non-development/build dependency superset. This is not an exact linked-binary inventory.', 'Project LICENSE and Rust standard-library notices are separate. Supplemental declarations and standard license terms are labeled without invented copyright attribution.'];
  const sources = [];
  for (const [key, pkg] of [...selected].sort(([a], [b]) => a.localeCompare(b))) {
    requireEvidence(pkg.source === 'registry+https://github.com/rust-lang/crates.io-index', 'non-registry Cargo source requires separate review');
    const directory = path.dirname(pkg.manifest_path); const registry = path.resolve(directory, '../../..');
    const cache = path.join(registry, 'cache', path.basename(path.dirname(directory)), `${pkg.name}-${pkg.version}.crate`);
    const checksum = checksums.get(key);
    requireEvidence(checksum, 'Cargo source is absent from the locked package checksums');
    // Cargo --locked has already resolved this original registry package; verify
    // the archive and installed license bytes against its registry checksum.
    const archive = await regular(cache);
    const docs = rootNoticeDocuments(archive, `${pkg.name}-${pkg.version}`, checksum);
    for (const doc of docs) requireEvidence(hash(await regular(path.join(directory, doc.path))) === doc.sha256, 'installed crate notice differs from the original archive');
    const supplement = manifest.cargo_supplements[key];
    if (supplement) {
      requireEvidence(supplement.declared_license === pkg.license && supplement.archive_sha256 === checksum, 'supplemented crate declaration/archive changed');
      for (const descriptor of supplement.documents) docs.push(await pinnedDocument(projectRoot, descriptor));
    }
    requireEvidence(docs.some((doc) => fullTerms(doc.text)), `complete license terms missing: ${key}`);
    const record = { name: pkg.name, version: pkg.version, license_declaration: pkg.license, archive_sha256: checksum,
      source_url: `https://static.crates.io/crates/${pkg.name}/${pkg.name}-${pkg.version}.crate`,
      upstream_license_file_missing: supplement?.upstream_license_file_missing ?? false,
      license_documents: docs.map((doc) => { const data = { ...doc }; delete data.text; return data; }),
      ...(supplement?.evidence_note ? { evidence_note: supplement.evidence_note } : {}) };
    if (pkg.license === 'MPL-2.0') {
      await verifyUnmodifiedCrateSources(archive, checksum, directory, `${pkg.name}-${pkg.version}`);
      await mkdir(path.join(outputDirectory, 'mpl-source'), { recursive: true });
      const name = `${pkg.name}-${pkg.version}.crate`; await writeFile(path.join(outputDirectory, 'mpl-source', name), archive);
      record.original_source = `mpl-source/${name}`; sources.push({ name: pkg.name, version: pkg.version, path: record.original_source, sha256: checksum, source_url: record.source_url });
    }
    packages.push(record);
    sections.push(`\n${'='.repeat(72)}\n${key}\nDeclared license: ${pkg.license}\nSource: ${record.source_url}\nArchive SHA-256: ${checksum}`);
    for (const doc of docs) sections.push(`\n--- ${doc.evidence_kind}: ${doc.path} ---\nSHA-256: ${doc.sha256}${doc.source_url ? `\nSource: ${doc.source_url}` : ''}\n${doc.text}`);
  }
  const text = sections.join('\n') + '\n'; await writeFile(path.join(outputDirectory, 'RUST-DEPENDENCY-NOTICES.txt'), text);
  await writeFile(path.join(outputDirectory, 'MPL-SOURCE-AVAILABILITY.txt'), 'Original unmodified MPL2.0 source archives are supplied in mpl-source/ and at the exact version URLs listed below. Preserve this notice and their original license notices. These archives were verified against the registry package checksums selected by Cargo --locked.\n' + sources.map((s) => `${s.name}@${s.version}\n${s.path}\nSHA-256: ${s.sha256}\n${s.source_url}`).join('\n\n') + '\n');
  return { packages, sources, notices_sha256: hash(Buffer.from(text)) };
}
async function runtimeNotices(projectRoot, targets, manifest, outputDirectory) {
  const tools = await collectPackageNotices({ projectRoot, packages: ['desktop/node_modules/@yao-pkg/pkg', 'desktop/node_modules/@yao-pkg/pkg-fetch'], selection: 'pkg-injected-bootstrap-and-patch-source-license-evidence' });
  requireEvidence(tools.coverage.packages.find((pkg) => pkg.name === '@yao-pkg/pkg')?.version === manifest.node.pkg_version &&
    tools.coverage.packages.find((pkg) => pkg.name === '@yao-pkg/pkg-fetch')?.version === manifest.node.pkg_fetch_version, 'packaging runtime tool versions require new license evidence review');
  const nodeLicense = await pinnedDocument(projectRoot, manifest.node.license_document);
  await writeFile(path.join(outputDirectory, 'NODE-LICENSE.txt'), nodeLicense.text);
  await writeFile(path.join(outputDirectory, 'PKG-BOOTSTRAP-AND-PATCH-NOTICES.txt'), tools.text);
  const expected = JSON.parse(await regular(path.join(projectRoot, 'desktop/node_modules/@yao-pkg/pkg-fetch/lib-es5/expected-shas.json')));
  const patches = JSON.parse(await regular(path.join(projectRoot, 'desktop/node_modules/@yao-pkg/pkg-fetch/patches/patches.json')));
  requireEvidence(Object.hasOwn(patches, manifest.node.version), 'selected Node version is not in the installed pkg patch map');
  const bootstrapInputs = [];
  for (const filename of ['desktop/node_modules/@yao-pkg/pkg/prelude/bootstrap.js', 'desktop/node_modules/@yao-pkg/pkg/prelude/bootstrap-shared.js', 'desktop/node_modules/@yao-pkg/pkg/lib-es5/common.js', ...patches[manifest.node.version].map((patch) => `desktop/node_modules/@yao-pkg/pkg-fetch/patches/${patch}`)]) {
    bootstrapInputs.push({ path: filename, sha256: hash(await regular(path.join(projectRoot, filename))) });
  }
  const runtimes = [];
  for (const target of targets) {
    const config = expectedTargets[target]; const name = `node-${manifest.node.version}-${config.pkg}`;
    const cache = path.join(process.env.PKG_CACHE_PATH || path.join(os.homedir(), '.pkg-cache'), 'v3.6', name.replace(/^node-/, 'fetched-'));
    const runtime = await regular(cache);
    requireEvidence(expected[name] && hash(runtime) === expected[name], `pkg cached runtime checksum mismatch: ${name}`);
    const binary = path.join(projectRoot, 'desktop/src-tauri/binaries', `relayune-core-${target}`);
    // This sentinel invokes Node's -p entry instead of Relayune's application
    // bootstrap. No business code, user configuration or service is loaded.
    const probe = JSON.parse(commandOutput(binary, ['-p', 'JSON.stringify({version:process.version,arch:process.arch})'], {
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', PKG_EXECPATH: 'PKG_INVOKE_NODEJS' },
    }));
    requireEvidence(probe.version === manifest.node.version && probe.arch === config.arch, 'new sidecar Node version/architecture does not match the reviewed runtime');
    runtimes.push({ target, runtime_name: name, runtime_sha256: expected[name], sidecar_sha256: hash(await regular(binary)), version: probe.version, arch: probe.arch,
      system_dynamic_dependencies: systemNativeDependencies(commandOutput('/usr/bin/otool', ['-L', binary])),
      runtime_probe: 'PKG_INVOKE_NODEJS Node metadata only; no application bootstrap executed' });
  }
  return { node_license: manifest.node.license_document, packaging_tools: tools.coverage, injected_bootstrap_and_patch_inputs: bootstrapInputs, runtimes };
}
async function outputInventory(directory) {
  const result = [];
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) { requireEvidence(entry.isDirectory(), 'generated notice tree contains a symlink'); continue; }
    const filename = path.join(entry.parentPath, entry.name); const relative = portable(path.relative(directory, filename));
    if (relative !== 'COVERAGE.json') result.push({ path: relative, sha256: hash(await regular(filename)) });
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
export async function verifyNativeNoticeFiles(directory, expectedFiles) {
  requireEvidence(JSON.stringify(await outputInventory(directory)) === JSON.stringify(expectedFiles), 'app embedded notice/source bytes are missing, changed or unexpected');
}
export async function writeNativeDesktopNotices({ projectRoot, target }) {
  projectRoot = path.resolve(projectRoot);
  requireEvidence(await realpath(projectRoot) === projectRoot, 'project root must be canonical');
  const targets = target === 'universal-apple-darwin' ? Object.keys(expectedTargets) : [target];
  requireEvidence(targets.every((value) => expectedTargets[value]), 'current native license evidence supports macOS targets; another platform requires its own review');
  const manifest = JSON.parse(await regular(path.join(projectRoot, 'scripts/license-evidence/native-desktop-manifest.json')));
  const outputDirectory = path.join(projectRoot, 'desktop/src-tauri/resources/generated-notices/native-desktop');
  await rm(outputDirectory, { recursive: true, force: true }); await mkdir(outputDirectory, { recursive: true });
  const runtime = await runtimeNotices(projectRoot, targets, manifest, outputDirectory);
  const cargo = await cargoNotices(projectRoot, targets, manifest, outputDirectory);
  const rustVersion = commandOutput('rustc', ['--version']).split(' ')[1];
  requireEvidence(rustVersion === manifest.rust_std.version, 'Rust standard-library notice evidence does not match the selected rustc');
  const std = await pinnedDocument(projectRoot, manifest.rust_std.license_document);
  const sysroot = commandOutput('rustc', ['--print', 'sysroot']);
  requireEvidence(hash(await regular(path.join(sysroot, 'share/doc/rust/COPYRIGHT-library.html'))) === std.sha256, 'installed Rust standard-library notice bytes changed');
  await writeFile(path.join(outputDirectory, 'RUST-STANDARD-LIBRARY-NOTICES.html'), std.text);
  await copyFile(path.join(projectRoot, 'LICENSE'), path.join(outputDirectory, 'PROJECT-LICENSE.txt'));
  const coverage = { schema_version: 1, selection: 'macOS target-filtered dependency and runtime notice superset', exact_linked_binary: false,
    targets, node: runtime, rust_version: rustVersion, cargo_packages: cargo.packages, mpl_original_sources: cargo.sources,
    notices_complete: true, unresolved: [], risk_accepted: false,
    artifact_verification: { status: 'generated-resources-and-selected-sidecar-runtime-verified; final signed app must be checked separately' },
    limitations: ['Cargo includes build dependencies and may exceed linked components. This does not claim exact linker provenance.', 'System-provided Apple frameworks/WebView are external platform dependencies, not bundled third-party copies cleared by this inventory.', 'Project license and upstream licenses remain separate. Standard terms supplement original publisher declarations; missing upstream license files are explicit.'],
    inputs_sha256: { 'desktop/src-tauri/Cargo.lock': hash(await regular(path.join(projectRoot, 'desktop/src-tauri/Cargo.lock'))), 'desktop/package-lock.json': hash(await regular(path.join(projectRoot, 'desktop/package-lock.json'))), 'scripts/license-evidence/native-desktop-manifest.json': hash(await regular(path.join(projectRoot, 'scripts/license-evidence/native-desktop-manifest.json'))) },
    files: await outputInventory(outputDirectory) };
  const serialized = JSON.stringify(coverage, null, 2) + '\n'; requireEvidence(!serialized.includes(projectRoot) && !serialized.includes(os.homedir()), 'notice coverage contains a local absolute path');
  await writeFile(path.join(outputDirectory, 'COVERAGE.json'), serialized);
  return coverage;
}
export async function verifyNativeAppNotices({ projectRoot, appPath }) {
  const directory = path.join(path.resolve(appPath), 'Contents/Resources/generated-notices/native-desktop');
  const coverage = JSON.parse(await regular(path.join(directory, 'COVERAGE.json')));
  requireEvidence(coverage.schema_version === 1 && coverage.notices_complete === true && coverage.unresolved.length === 0 && coverage.risk_accepted === false, 'app lacks complete selected native notice materials');
  const generated = path.join(path.resolve(projectRoot), 'desktop/src-tauri/resources/generated-notices/native-desktop');
  requireEvidence(hash(await regular(path.join(directory, 'COVERAGE.json'))) === hash(await regular(path.join(generated, 'COVERAGE.json'))), 'app embedded native coverage does not equal the current generated material');
  await verifyNativeNoticeFiles(directory, coverage.files);
  for (const [filename, checksum] of Object.entries(coverage.inputs_sha256)) requireEvidence(hash(await regular(path.join(projectRoot, filename))) === checksum, 'native notice build inputs are stale');
  const binary = path.join(path.resolve(appPath), 'Contents/MacOS/relayune-core');
  const main = path.join(path.resolve(appPath), 'Contents/MacOS/relayune-desktop');
  const systemDependencies = { sidecar: systemNativeDependencies(commandOutput('/usr/bin/otool', ['-L', binary])), app: systemNativeDependencies(commandOutput('/usr/bin/otool', ['-L', main])) };
  const probe = JSON.parse(commandOutput(binary, ['-p', 'JSON.stringify({version:process.version,arch:process.arch})'], { env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', PKG_EXECPATH: 'PKG_INVOKE_NODEJS' } }));
  requireEvidence(coverage.node.runtimes.some((runtime) => runtime.version === probe.version && runtime.arch === probe.arch), 'final app Node runtime metadata changed');
  const javascript = [];
  for (const name of ['desktop-web', 'sidecar-js']) {
    const embedded = path.join(directory, '..', name); const expected = path.join(generated, '..', name);
    const bytes = await regular(path.join(embedded, 'COVERAGE.json'));
    requireEvidence(hash(bytes) === hash(await regular(path.join(expected, 'COVERAGE.json'))), 'app embedded JavaScript package coverage is stale');
    const js = JSON.parse(bytes);
    requireEvidence(js.notices_complete === true && js.unresolved.length === 0 && hash(await regular(path.join(embedded, 'THIRD_PARTY_NOTICES.txt'))) === js.notices_sha256, 'app JavaScript license text bytes are incomplete or changed');
    requireEvidence(hash(await regular(path.join(embedded, 'PROJECT-LICENSE.txt'))) === hash(await regular(path.join(projectRoot, 'LICENSE'))), 'app project license bytes changed');
    if (name === 'sidecar-js') requireEvidence(hash(await regular(path.join(embedded, 'PACKAGING-TOOL-NOTICES.txt'))) === js.packaging_tool_evidence?.notices_sha256, 'app pkg tool notice bytes changed');
    javascript.push({ artifact: name, coverage_sha256: hash(bytes), notices_sha256: js.notices_sha256 });
  }
  return { schema_version: 1, status: 'actual-app-notice-resources-and-host-runtime-metadata-verified', app_sidecar_sha256: hash(await regular(binary)), app_executable_sha256: hash(await regular(main)), info_plist_sha256: hash(await regular(path.join(path.resolve(appPath), 'Contents/Info.plist'))), coverage_sha256: hash(await regular(path.join(directory, 'COVERAGE.json'))), javascript, system_dynamic_dependencies: systemDependencies, runtime_probe: probe, app_business_entry_acceptance: 'independent acceptance required; Node metadata is not business-flow verification', risk_accepted: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const argument = (name) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
  const appPath = argument('--verify-app');
  const report = appPath ? await verifyNativeAppNotices({ projectRoot, appPath }) : await writeNativeDesktopNotices({ projectRoot, target: argument('--target') });
  if (appPath) console.log(JSON.stringify(report, null, 2));
  else console.log(`Native macOS notices: ${report.cargo_packages.length} Cargo packages, ${report.node.runtimes.length} inspected Node runtimes, ${report.mpl_original_sources.length} original MPL source archives. Final signed app verification remains separate.`);
}
