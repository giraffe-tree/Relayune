import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyWebProvenance } from './web-license-provenance.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const portable = (value) => value.split(path.sep).join('/');
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
function requireSafe(condition, message) {
  if (!condition) throw new Error(message);
}
const licenseName = /^(?:licen[cs]e|notice|copying|copyright)(?:$|[._-])/i;
const licenseDirectory = /^(?:licen[cs]es?|notices?|copying)$/i;
const exclusions = [
  'Project LICENSE is separate and must be copied by the caller; this text does not relicense dependencies.',
  'Node/runtime executables, pkg bootstrap, Rust crates, system SDKs, WebView and native/precompiled libraries are not cleared by this JavaScript package collection.',
  'Declared license identifiers and retained texts are evidence, not a legal compatibility or source-offer determination.',
  'Code prebundled inside published npm files is not automatically enumerated as separate embedded package versions; this is not complete legal clearance of every embedded component.',
];

async function context(projectRoot) {
  const root = path.resolve(projectRoot);
  requireSafe(await realpath(root) === root, 'projectRoot must be its canonical real path');
  return { root, locks: new Map() };
}
async function checkedPath(ctx, value, boundary = ctx.root) {
  const absolute = path.resolve(value);
  requireSafe(inside(ctx.root, absolute) && inside(boundary, absolute), 'Path escapes the project/package boundary');
  const actual = await realpath(absolute);
  requireSafe(inside(ctx.root, actual) && inside(boundary, actual), 'External symlink or package-boundary escape');
  return absolute;
}
async function textFile(ctx, filename, boundary) {
  await checkedPath(ctx, filename, boundary);
  const bytes = await readFile(filename);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('License/metadata file is not valid UTF-8'); }
  requireSafe(!text.includes(ctx.root), 'File contains the local absolute project path; review before distribution');
  return { bytes, text };
}
async function jsonFile(ctx, filename, boundary) {
  const result = await textFile(ctx, filename, boundary);
  const data = JSON.parse(result.text);
  requireSafe(data !== null && typeof data === 'object' && !Array.isArray(data), 'Expected a package/lock JSON object');
  return { ...result, data };
}
function packageNameFromPath(packagePath) {
  const segments = portable(packagePath).split('/');
  const index = segments.lastIndexOf('node_modules');
  requireSafe(index >= 0 && segments[index + 1], 'Package is not in an installed node_modules tree');
  const name = segments[index + 1].startsWith('@') ? segments.slice(index + 1, index + 3).join('/') : segments[index + 1];
  requireSafe(segments.length === index + 1 + name.split('/').length, 'Expected an installed package root, not a package subdirectory');
  return name;
}
async function packageMetadata(ctx, packagePath, expected = {}) {
  const directory = await checkedPath(ctx, path.resolve(ctx.root, packagePath));
  const actualDirectory = await realpath(directory);
  const relative = portable(path.relative(ctx.root, directory));
  const segments = relative.split('/');
  const firstModules = segments.indexOf('node_modules');
  const inferredName = packageNameFromPath(relative);
  const lockRoot = path.resolve(ctx.root, ...segments.slice(0, firstModules));
  const lockPath = path.join(lockRoot, 'package-lock.json');
  if (!ctx.locks.has(lockPath)) ctx.locks.set(lockPath, await jsonFile(ctx, lockPath, ctx.root));
  const lock = ctx.locks.get(lockPath).data;
  const lockKey = portable(path.relative(lockRoot, directory));
  const locked = lock.packages?.[lockKey];
  requireSafe(locked && !locked.link, `Missing/unsupported linked package lock entry: ${relative}`);
  const metadata = await jsonFile(ctx, path.join(directory, 'package.json'), actualDirectory);
  const { name, version } = metadata.data;
  requireSafe(typeof name === 'string' && name.length > 0 && typeof version === 'string' && version.length > 0,
    `Package lacks name/version: ${relative}`);
  requireSafe(name === (locked.name ?? inferredName) && version === locked.version &&
    (!expected.name || name === expected.name) && (!expected.version || version === expected.version),
  `Installed package metadata does not match its lock/explicit descriptor: ${relative}`);
  let url = null;
  if (locked.resolved) {
    const resolved = new URL(locked.resolved);
    requireSafe(resolved.protocol === 'https:' && !resolved.username && !resolved.password && !resolved.search && !resolved.hash &&
      ['registry.npmjs.org', 'registry.npmmirror.com', 'registry.npm.taobao.org'].includes(resolved.hostname),
    `Package source is not a credential-free public npm registry URL: ${relative}`);
    url = `https://www.npmjs.com/package/${encodeURIComponent(name)}/v/${encodeURIComponent(version)}`;
  }
  return { directory, actualDirectory, metadata: metadata.data,
    record: { name, version, package_path: relative,
      package_json_sha256: sha(metadata.bytes),
      source: { lockfile: portable(path.relative(ctx.root, lockPath)), lock_key: lockKey,
        integrity: locked.integrity ?? null, url },
      license_declaration: typeof metadata.data.license === 'string' ? metadata.data.license : null } };
}

function substantiveLicense(text) {
  const flat = text.replace(/\s+/g, ' ').toLowerCase();
  return (flat.includes('permission is hereby granted, free of charge') && flat.includes('the software is provided') && flat.includes('dealings in the software')) ||
    (flat.includes('redistribution and use in source and binary forms') && flat.includes('this software is provided') && flat.includes('possibility of such damage')) ||
    (flat.includes('apache license') && flat.includes('terms and conditions') && flat.includes('end of terms and conditions')) ||
    (flat.includes('permission to use, copy, modify, and/or distribute') && flat.includes('the software is provided') && flat.includes('performance of this software')) ||
    (flat.includes('mozilla public license') && flat.includes('versions of the license') && flat.includes('exhibit a')) ||
    (flat.includes('blue oak model license') && flat.includes('disclaimer') && flat.includes('1.0.0')) ||
    (flat.includes('free and unencumbered software released into the public domain') && flat.includes('the software is provided')) ||
    (flat.includes('creative commons') && flat.includes('attribution 4.0 international') && flat.includes('section 8') && flat.length > 10000) ||
    (flat.includes('python software foundation license version 2') && flat.includes('psf makes no representations')) ||
    (flat.includes('unicode') && flat.includes('permission is hereby granted') && flat.includes('the software is provided'));
}

async function licenseTexts(ctx, item, supplementalLicenseFiles) {
  const found = [];
  const seen = new Set();
  async function walk(directory, licenseArea = false) {
    await checkedPath(ctx, directory, item.actualDirectory);
    const actual = await realpath(directory);
    if (seen.has(actual)) return;
    seen.add(actual);
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.name === 'node_modules') continue;
      const filename = path.join(directory, entry.name);
      await checkedPath(ctx, filename, item.actualDirectory);
      const info = await lstat(filename);
      const targetInfo = info.isSymbolicLink() ? await lstat(await realpath(filename)) : info;
      if (targetInfo.isDirectory()) await walk(filename, licenseArea || licenseDirectory.test(entry.name));
      else if (targetInfo.isFile() && (licenseName.test(entry.name) || (licenseArea && /^(?:MIT|ISC|Apache-2\.0|BSD-[23]-Clause|MPL-2\.0|Unicode-3\.0|CC0-1\.0)\.(?:txt|md)$/i.test(entry.name)))) {
        const result = await textFile(ctx, filename, item.actualDirectory);
        requireSafe(result.text.trim().length > 0, `Empty license text: ${item.record.package_path}`);
        found.push({ path: portable(path.relative(ctx.root, filename)), sha256: sha(result.bytes), text: result.text });
      }
    }
  }
  await walk(item.directory);
  const ownLicense = () => found.some((file) => file.supplemental ||
    (path.dirname(file.path) === item.record.package_path && substantiveLicense(file.text)));
  const reviewedReadme = ['fastdom@1.0.12', 'strictdom@1.0.1', 'agent-base@6.0.2', 'https-proxy-agent@5.0.1'].includes(`${item.record.name}@${item.record.version}`);
  if (!ownLicense() && reviewedReadme) {
    for (const entry of (await readdir(item.directory)).filter((name) => /^readme(?:\.|$)/i.test(name)).sort()) {
      const filename = path.join(item.directory, entry);
      const result = await textFile(ctx, filename, item.actualDirectory);
      const section = result.text.match(/^(?:#{1,2} Licen[cs]e[^\r\n]*|Licen[cs]e\r?\n-{3,})\r?\n([\s\S]*?)(?=^#{1,6}\s|^[^\r\n]+\r?\n(?:-{3,}|={3,})\r?$|^\[[^\]]+\]:|$(?![\s\S]))/im);
      // Known fastdom/strictdom layout. A bare SPDX label or external link is
      // not a license text. Never include unrelated README material.
      if (section && substantiveLicense(section[1]) && section[1].includes('The above copyright notice') &&
        /Copyright\s*(?:\(c\)|©)/i.test(section[1])) {
        found.push({ path: portable(path.relative(ctx.root, filename)), section: 'License',
          sha256: sha(Buffer.from(section[1])), file_sha256: sha(result.bytes), text: section[1] });
      }
    }
  }
  if (!ownLicense()) {
    const supplements = supplementalLicenseFiles[`${item.record.name}@${item.record.version}`] ?? [];
    for (const evidence of supplements) {
      requireSafe(evidence && typeof evidence.path === 'string' && /^[a-f0-9]{64}$/.test(evidence.sha256 ?? ''), 'Supplement requires a relative path and exact SHA-256');
      requireSafe(!path.isAbsolute(evidence.path) && !path.win32.isAbsolute(evidence.path), 'Supplement path must be repository-relative');
      const source = new URL(evidence.source_url);
      requireSafe(source.protocol === 'https:' && !source.username && !source.password && !source.search && !source.hash &&
        ['github.com', 'raw.githubusercontent.com'].includes(source.hostname) &&
        (source.pathname.includes(item.record.version) || /\/[a-f0-9]{40}\//.test(source.pathname)),
      'Supplement requires an explicit fixed-version public upstream source URL');
      const filename = path.resolve(ctx.root, evidence.path);
      const result = await textFile(ctx, filename, ctx.root);
      requireSafe(sha(result.bytes) === evidence.sha256 && substantiveLicense(result.text), 'Supplement hash/full-license text does not match its evidence');
      if (evidence.kind === 'standard-license-terms') {
        const declaration = evidence.publisher_declaration;
        requireSafe(item.record.name === 'dijkstrajs' && item.record.version === '1.0.3' && item.metadata.license === 'MIT' && declaration &&
          declaration.path === `${item.record.package_path}/LICENSE.md`, 'Standard-term supplementation is restricted to the reviewed dijkstrajs declaration');
        const publisher = await textFile(ctx, path.resolve(ctx.root, declaration.path), item.actualDirectory);
        requireSafe(sha(publisher.bytes) === declaration.sha256 && /Licensed under the MIT license/i.test(publisher.text) && /Copyright \(C\) 2008/.test(publisher.text) &&
          declaration.source_url === 'https://raw.githubusercontent.com/tcort/dijkstrajs/v1.0.3/LICENSE.md', 'Publisher declaration does not match the reviewed original notice');
      } else requireSafe(!evidence.kind || evidence.kind === 'upstream-license', 'Unknown supplemental evidence kind');
      found.push({ path: portable(path.relative(ctx.root, filename)), sha256: sha(result.bytes),
        supplemental: true, source_url: source.href, evidence_kind: evidence.kind ?? 'upstream-license',
        ...(evidence.publisher_declaration ? { publisher_declaration: evidence.publisher_declaration } : {}), text: result.text });
    }
  }
  if (!ownLicense()) {
    const error = new Error(`No complete package-root LICENSE or reviewed README/supplement evidence: ${item.record.name}@${item.record.version}`);
    error.code = 'MISSING_PACKAGE_LICENSE';
    throw error;
  }
  return found;
}

async function collect(ctx, descriptors, selection, exactBundle, extra = {}, supplementalLicenseFiles = {}, knownUnresolvedLicenses = {}) {
  const packages = new Map();
  for (const descriptor of descriptors) {
    const expected = typeof descriptor === 'string' ? { packagePath: descriptor } : descriptor;
    requireSafe(expected && typeof expected.packagePath === 'string', 'Explicit package descriptor requires packagePath');
    const item = await packageMetadata(ctx, expected.packagePath, expected);
    packages.set(item.record.package_path, item);
  }
  const records = [];
  const missing = [];
  const unresolved = [];
  const sections = [
    'Third-party JavaScript package license notices',
    `Selection: ${selection}; ${exactBundle ? 'packages from actual emitted JavaScript inputs' : 'a declared package set/superset, NOT an exact bundle inventory'}.`,
    ...exclusions,
  ];
  for (const excluded of extra.artifact_excluded_packages ?? []) {
    sections.push(`Artifact-only exclusion from the dependency superset: ${excluded.name}@${excluded.version}\n${excluded.reason}\nArtifact manifest SHA-256: ${excluded.artifact_manifest_sha256}\nThe package's license evidence remains unresolved for any other distribution.`);
  }
  for (const item of [...packages.values()].sort((a, b) => a.record.package_path.localeCompare(b.record.package_path, 'en'))) {
    let files;
    try { files = await licenseTexts(ctx, item, supplementalLicenseFiles); }
    catch (error) {
      const key = `${item.record.name}@${item.record.version}`;
      const known = knownUnresolvedLicenses[key];
      if (error.code === 'MISSING_PACKAGE_LICENSE' && known && known.packagePath === item.record.package_path) {
        requireSafe(known.packageJsonSha256 === item.record.package_json_sha256, 'Known unresolved package metadata hash changed; review the new evidence');
        unresolved.push({ name: item.record.name, version: item.record.version, package_path: item.record.package_path,
          reason: known.reason, risk_accepted: false });
        records.push({ ...item.record, license_files: [], license_evidence_status: 'unresolved' });
        sections.push(`\nUNRESOLVED LICENSE EVIDENCE: ${key}\nPackage: ${item.record.package_path}\n${known.reason}\nNo copyright holder or permission text has been invented. This is not risk acceptance or authorization to distribute.`);
      } else missing.push(error);
      continue;
    }
    records.push({ ...item.record, license_files: files.map((file) => {
      const evidence = { ...file };
      delete evidence.text;
      return evidence;
    }) });
    sections.push(`\n${'='.repeat(72)}\n${item.record.name}@${item.record.version}\nPackage: ${item.record.package_path}`);
    for (const file of files) sections.push(`\n--- ${file.path}${file.section ? ' / License section' : ''} ---\nSHA-256: ${file.sha256}\n${file.text}`);
  }
  if (missing.length) throw new AggregateError(missing, `License collection failed: ${missing.map((error) => error.message).join('; ')}`);
  sections.splice(2, 0, unresolved.length ? 'INCOMPLETE package-level notices: unresolved evidence is explicitly listed; risk is not accepted.' :
    'Selected package-level license texts retained; exclusions below still apply.');
  const text = sections.join('\n') + '\n';
  const coverage = { schema_version: 1, selection, exact_bundle: exactBundle, packages: records,
    excluded: exclusions, ...extra, unresolved, notices_complete: unresolved.length === 0, risk_accepted: false,
    notices_sha256: sha(Buffer.from(text)) };
  requireSafe(!JSON.stringify(coverage).includes(ctx.root) && !text.includes(ctx.root), 'Output contains a local absolute path');
  return { text, coverage };
}

export async function collectPackageNotices({ projectRoot, packages, selection = 'explicit-package-set', supplementalLicenseFiles = {} }) {
  requireSafe(Array.isArray(packages), 'Explicit packages must be an array');
  return collect(await context(projectRoot), packages, selection, false, {}, supplementalLicenseFiles);
}

function normalizeInput(input) {
  if (input === '<stdin>' || input === 'commonjsHelpers.js' || input.startsWith('\0vite/') || input === '\0commonjsHelpers.js') return null;
  const unwrapped = input.replace(/^\0/, '').replace(/(\.json) with \{ type: (['"])json\2 \}$/, '$1')
    .replace(/\?(?:commonjs-[\w-]+|raw|url|worker)(?:&.*)?$/, '');
  if (unwrapped.startsWith('file:')) return fileURLToPath(unwrapped);
  requireSafe(!unwrapped.includes('\0') && !/^https?:/.test(unwrapped), 'Unknown or remote virtual module input');
  return unwrapped;
}
async function packageForInput(ctx, input, workingDirectory) {
  const normalized = normalizeInput(input);
  if (normalized === null) return null;
  const filename = await checkedPath(ctx, path.resolve(workingDirectory, normalized));
  const relative = portable(path.relative(ctx.root, filename));
  if (!relative.split('/').includes('node_modules')) return null;
  let directory = path.dirname(filename);
  while (inside(ctx.root, directory)) {
    try {
      const metadata = await jsonFile(ctx, path.join(directory, 'package.json'), ctx.root);
      if (metadata.data.name && metadata.data.version) return portable(path.relative(ctx.root, directory));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    directory = path.dirname(directory);
  }
  throw new Error('Cannot locate an installed package root for emitted input');
}

export async function collectBundleNotices({ projectRoot, workingDirectory = projectRoot, metafile, moduleIds, supplementalLicenseFiles = {} }) {
  const ctx = await context(projectRoot);
  await checkedPath(ctx, workingDirectory);
  requireSafe(Boolean(metafile) !== Boolean(moduleIds), 'Supply exactly one real esbuild metafile or rendered moduleIds array');
  let inputs;
  let selection;
  if (metafile) {
    requireSafe(metafile.inputs && metafile.outputs, 'Real esbuild metafile requires inputs and outputs');
    const emitted = new Set();
    for (const output of Object.values(metafile.outputs)) {
      for (const [input, value] of Object.entries(output.inputs ?? {})) {
        requireSafe(typeof value.bytesInOutput === 'number' && Number.isFinite(value.bytesInOutput) && value.bytesInOutput >= 0,
          'Invalid esbuild bytesInOutput metadata');
        if (value.bytesInOutput > 0) {
          requireSafe(Object.hasOwn(metafile.inputs, input), 'Emitted esbuild input is absent from the input graph');
          emitted.add(input);
        }
      }
    }
    inputs = [...emitted];
    selection = 'esbuild-positive-output-inputs';
  } else {
    requireSafe(Array.isArray(moduleIds) && moduleIds.every((id) => typeof id === 'string'), 'Rendered moduleIds must be strings');
    inputs = moduleIds;
    selection = 'rendered-module-ids';
  }
  const descriptors = new Set();
  for (const input of inputs) {
    const found = await packageForInput(ctx, input, workingDirectory);
    if (found) descriptors.add(found);
  }
  return collect(ctx, [...descriptors], selection, true, { emitted_input_count: inputs.length }, supplementalLicenseFiles);
}

async function resolveDependency(ctx, fromDirectory, name) {
  requireSafe(typeof name === 'string' && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name), 'Invalid dependency name');
  let directory = fromDirectory;
  while (inside(ctx.root, directory)) {
    const candidate = path.join(directory, 'node_modules', name);
    try {
      await checkedPath(ctx, path.join(candidate, 'package.json'));
      return portable(path.relative(ctx.root, candidate));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (directory === ctx.root) break;
    directory = path.dirname(directory);
  }
  throw new Error(`Installed dependency missing from Web/runtime superset: ${name}`);
}

export async function collectWebRuntimeNotices({ projectRoot, additionalDependencies = ['next'], supplementalLicenseFiles = {}, knownUnresolvedLicenses = {}, excludeVerifiedWebArtifacts = false }) {
  const ctx = await context(projectRoot);
  for (const [key, value] of Object.entries(knownUnresolvedLicenses)) {
    requireSafe(key === 'client-only@0.0.1' && value?.packagePath === 'node_modules/client-only' &&
      typeof value.reason === 'string' && value.reason.length > 0 && /^[a-f0-9]{64}$/.test(value.packageJsonSha256 ?? ''),
    'Only the specifically reviewed client-only@0.0.1 path can be reported unresolved in the Web superset');
  }
  const project = (await jsonFile(ctx, path.join(ctx.root, 'package.json'), ctx.root)).data;
  const queue = [];
  for (const name of new Set([...Object.keys(project.dependencies ?? {}), ...additionalDependencies])) {
    queue.push(await resolveDependency(ctx, ctx.root, name));
  }
  const visited = new Set();
  while (queue.length) {
    const packagePath = queue.shift();
    if (visited.has(packagePath)) continue;
    visited.add(packagePath);
    const item = await packageMetadata(ctx, packagePath);
    for (const name of Object.keys(item.metadata.dependencies ?? {})) queue.push(await resolveDependency(ctx, item.directory, name));
  }
  const artifactExcluded = [];
  if (excludeVerifiedWebArtifacts) {
    const evidence = await verifyWebProvenance({ projectRoot: ctx.root });
    requireSafe(visited.has(evidence.package_path), 'Verified artifact exclusion is absent from the runtime superset');
    visited.delete(evidence.package_path);
    artifactExcluded.push(evidence);
  }
  return collect(ctx, [...visited], 'runtime-dependency-superset-with-next', false,
    { artifact_excluded_packages: artifactExcluded, scope_note: 'Required root runtime dependency closure plus explicitly selected Next/frontend packages, with explicitly verified artifact-only exclusions where listed; optional/peer-only libraries are not enumerated unless selected by actual input collectors. Not an exact static Web bundle or native/runtime executable coverage.' }, supplementalLicenseFiles, knownUnresolvedLicenses);
}
