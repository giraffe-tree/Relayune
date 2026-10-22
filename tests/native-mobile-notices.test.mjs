import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, deflateRawSync } from 'node:zlib';
import { collectFlutterSections, flutterText, licenseSeparator, parseAcknowledgements,
  verifyFlutterNotices, zipLicenseEntries, decodeEvidence } from '../scripts/native-mobile-notices.mjs';

test('Flutter composite engine licenses preserve publisher component names and complete bodies', () => {
  const body = 'Copyright engine author\nFull conditions\nFull disclaimer\n';
  const sections = collectFlutterSections([
    { name: 'sky_engine', text: `engine-library\n\n${body}${licenseSeparator}another-library\n\nOther full text` },
    { name: 'some_plugin', text: body },
  ]);
  assert.equal(sections.length, 2);
  assert.deepEqual(sections.find(x => x.text === body).names, ['engine-library', 'some_plugin']);
  const compressed = gzipSync(flutterText(sections));
  assert.equal(verifyFlutterNotices(compressed, sections).verified_component_sections, 2);
  assert.throws(() => verifyFlutterNotices(gzipSync(flutterText(sections).replace('Full disclaimer', 'truncated')), sections), /omits or changes/);
});

test('final NOTICES must retain every attribution and the exact current native supplement', () => {
  const expected = collectFlutterSections([{ name: 'one', text: 'Copyright\nComplete license' }, { name: 'two', text: 'Copyright\nComplete license' }]);
  assert.throws(() => verifyFlutterNotices(gzipSync('one\n\nCopyright\nComplete license'), expected), /omits/);
  const supplement = 'Native library\n\nNative original terms';
  const full = `${flutterText(expected)}${licenseSeparator}${supplement}`;
  verifyFlutterNotices(gzipSync(full), expected, supplement);
  assert.throws(() => verifyFlutterNotices(gzipSync(full.replace('original', 'changed')), expected, supplement), /supplement/);
});

test('CocoaPods full acknowledgement text is decoded without inventing licenses', () => {
  const xml = '<?xml version="1.0"?><plist><dict><key>PreferenceSpecifiers</key><array>' +
    '<dict><key>Title</key><string>Acknowledgements</string><key>FooterText</key><string>header</string></dict>' +
    '<dict><key>Title</key><string>Pod-A</string><key>FooterText</key><string>Copyright A &amp; B\n&#169; &lt;full&gt;\nall terms</string></dict>' +
    '</array></dict></plist>';
  assert.deepEqual(parseAcknowledgements(xml), [{ name: 'Pod-A', text: 'Copyright A & B\n© <full>\nall terms' }]);
  assert.throws(() => parseAcknowledgements('not plist'), /Expected XML/);
});

function oneFileZip(name, text, method = 8) {
  const n = Buffer.from(name), b = Buffer.from(text), compressed = method === 8 ? deflateRawSync(b) : b;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(method, 8); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(method, 10);
  central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(b.length, 24); central.writeUInt16LE(n.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + n.length, 12); end.writeUInt32LE(local.length + n.length + compressed.length, 16);
  return Buffer.concat([local, n, compressed, central, n, end]);
}

test('native AAR/JAR reader preserves complete bundled text without extracting archive paths', () => {
  const zip = oneFileZip('third_party_licenses.txt', 'Copyright original\nAll original notices\n');
  const entries = zipLicenseEntries(zip);
  assert.equal(entries.length, 1); assert.equal(entries[0].text, 'Copyright original\nAll original notices\n');
  assert.equal(zipLicenseEntries(oneFileZip('classes.dex', 'ignored binary')).length, 0);
  assert.throws(() => zipLicenseEntries(oneFileZip('../LICENSE', 'outside')), /Unsafe ZIP/);
});


test('known mixed upstream copyright encoding is explicit and preserves existing UTF-8', () => {
  const input = Buffer.concat([Buffer.from('UTF8 ©; original Latin1 '), Buffer.from([0xa9])]);
  assert.throws(() => decodeEvidence(input));
  assert.equal(decodeEvidence(input, 'utf-8-with-isolated-latin1-copyright'), 'UTF8 ©; original Latin1 ©');
  assert.throws(() => decodeEvidence(Buffer.from([0xff]), 'utf-8-with-isolated-latin1-copyright'));
});

test('AAR classes.jar notices are collected while DriverLicense.class is ordinary code', () => {
  const nested = oneFileZip('META-INF/NOTICE.txt', 'Full native plugin notice');
  const outer = oneFileZip('classes.jar', nested);
  assert.equal(zipLicenseEntries(outer)[0].path, 'classes.jar!/META-INF/NOTICE.txt');
  assert.equal(zipLicenseEntries(oneFileZip('some/Barcode$DriverLicense.class', Buffer.from([0xff]))).length, 0);
});

test('corrupt native archive central-directory sizes fail without decompressing unbounded text', () => {
  const zip = oneFileZip('LICENSE', 'short');
  const end = zip.length - 22, offset = zip.readUInt32LE(end + 16);
  zip.writeUInt32LE(17 * 1024 * 1024, offset + 24);
  assert.throws(() => zipLicenseEntries(zip), /Unsupported license ZIP entry/);
});

test('static aggregate needs no Pods or Flutter SDK and preserves project MIT separately', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { default: path } = await import('node:path');
  const { generateMobileMaterials, sha256 } = await import('../scripts/native-mobile-notices.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'relayune-native-license-'));
  try {
    const dir = path.join(root, 'scripts/license-evidence/native-mobile-evidence');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(root, 'LICENSE'), 'MIT License\nCopyright project author\nProject terms');
    const text = 'Copyright vendor\nAll vendor conditions\nVendor disclaimer';
    await writeFile(path.join(dir, 'vendor.txt'), text);
    const document = { path: 'scripts/license-evidence/native-mobile-evidence/vendor.txt', sha256: sha256(text), bytes: Buffer.byteLength(text), source_url: 'https://example.invalid/fixed-revision/LICENSE', evidence_kind: 'fixture-only' };
    const manifest = { bindings: { input_hashes: {} }, documents: [
      { ...document, component: 'SDK A', platforms: ['ios'] },
      { ...document, component: 'SDK B', platforms: ['android'] },
    ], unresolved: [] };
    const manifestFile = path.join(dir, 'manifest.json');
    await writeFile(manifestFile, JSON.stringify(manifest));
    const first = await generateMobileMaterials({ projectRoot: root });
    const second = await generateMobileMaterials({ projectRoot: root });
    assert.equal(first.text, second.text);
    assert.equal(first.text.split('All vendor conditions').length - 1, 1);
    assert.ok(first.text.includes('SDK A [ios]\nSDK B [android]'));
    assert.ok(first.text.includes('Relayune — project-owned code and assets (MIT)'));
    assert.equal(first.coverage.exact_linked_binary, false);
    assert.equal(first.coverage.notices_complete, true);
    await writeFile(path.join(dir, 'vendor.txt'), 'truncated');
    await assert.rejects(generateMobileMaterials({ projectRoot: root }), /hash mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('static native evidence refuses a symlink even when it remains inside the repository', async () => {
  const { mkdtemp, mkdir, writeFile, symlink, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { default: path } = await import('node:path');
  const { generateMobileMaterials, sha256 } = await import('../scripts/native-mobile-notices.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'relayune-native-license-link-'));
  try {
    const dir = path.join(root, 'scripts/license-evidence/native-mobile-evidence');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(root, 'LICENSE'), 'MIT License');
    await writeFile(path.join(dir, 'real.txt'), 'original');
    await symlink('real.txt', path.join(dir, 'link.txt'));
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ bindings: { input_hashes: {} }, unresolved: [], documents: [{ component: 'fixture', path: 'scripts/license-evidence/native-mobile-evidence/link.txt', sha256: sha256('original'), bytes: 8, platforms: ['ios'] }] }));
    await assert.rejects(generateMobileMaterials({ projectRoot: root }), /regular file/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
