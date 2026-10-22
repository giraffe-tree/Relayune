import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const runtime = await readFile('public/mermaid/mermaid.min.js', 'utf8');
assert.equal(runtime, await readFile('mobile/assets/mermaid/mermaid.min.js', 'utf8'));
const metadata = JSON.parse(await readFile('public/mermaid/BUILD.json', 'utf8'));
assert.equal(createHash('sha256').update(runtime).digest('hex'), metadata.runtime_sha256);
const version = (name) => metadata.bundled_packages.find((item) => item.name === name)?.version;
assert.equal(version('mermaid'), '11.17.2');
assert.equal(version('katex'), '0.18.2');
assert.equal(version('dompurify'), '3.4.17');

// Never run the published resource-exhaustion reproducers against an old bundle.
// Inputs below are reduced synthetic cases from the linked upstream advisories.
// https://github.com/mermaid-js/mermaid/security/advisories/GHSA-c4c3-pg64-4m4v
// https://github.com/mermaid-js/mermaid/security/advisories/GHSA-6x64-9x62-f2gx
// https://github.com/mermaid-js/mermaid/security/advisories/GHSA-3rrr-jr9j-h3q3
// https://github.com/mermaid-js/mermaid/security/advisories/GHSA-2v8p-3f2j-5mp7
// https://github.com/mermaid-js/mermaid/security/advisories/GHSA-rhh3-jpg6-66xh
const browser = await chromium.launch({ headless: true });
async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} did not terminate in 5 seconds`)), 5000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
try {
  const page = await browser.newPage();
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.setContent('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'none\'">');
  await page.addScriptTag({ content: runtime });
  const initialPrototype = await page.evaluate(() => Object.getOwnPropertyNames(Object.prototype).sort());
  const prototype = await bounded(page.evaluate(() => {
    try {
      mermaid.initialize(JSON.parse('{"__proto__":{"relayunePolluted":true},"constructor":{"prototype":{"relayunePolluted":true}}}'));
    } catch { /* Rejecting an unsafe configuration is acceptable. */ }
    return Object.prototype.relayunePolluted === undefined && ({}).relayunePolluted === undefined;
  }), 'configuration prototype regression');
  assert.equal(prototype, true);
  assert.deepEqual(await page.evaluate(() => Object.getOwnPropertyNames(Object.prototype).sort()), initialPrototype);
  const css = await bounded(page.evaluate(async () => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false,
      themeCSS: '& + * { color: rgb(1, 2, 3) !important; }', suppressErrorRendering: true });
    const { svg } = await mermaid.render('cssScope', 'flowchart TD\nA-->B');
    const host = document.createElement('div');
    host.innerHTML = svg + '<span id="sentinel" style="color:rgb(10,20,30)">sentinel</span>';
    document.body.append(host);
    return getComputedStyle(document.getElementById('sentinel')).color;
  }), 'CSS scope regression');
  assert.equal(css, 'rgb(10, 20, 30)', 'diagram CSS must not change its following sibling');
  // Relayune keeps htmlLabels disabled. Exercise the library's HTML/MathML
  // path separately in this isolated test to validate the KaTeX override API.
  const math = await bounded(page.evaluate(async () => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: true,
      flowchart: { htmlLabels: true }, suppressErrorRendering: true });
    const { svg } = await mermaid.render('mathCompatibility', 'flowchart TD\nA["$$x^2 + 1$$"]');
    return svg.includes('<math');
  }), 'patched KaTeX compatibility');
  assert.equal(math, true, 'patched KaTeX must still render a MathML formula through Mermaid');
  for (const [label, source] of [
    ['architecture reserved identifier', 'architecture-beta\ngroup relayuneMarker(cloud)[Marker]\nservice a(server)[A] in __proto__\nservice b(server)[B] in relayuneMarker\na:R -- L:b'],
    ['XY equal range', 'xychart\nx-axis 1 --> 1\nline [1, 2]'],
    ['radar tick limit', 'radar-beta\naxis a, b\ncurve c {1, 1}\nticks 1000000000'],
  ]) {
    const result = await bounded(page.evaluate(async ({ source }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false, suppressErrorRendering: true });
      try { await mermaid.render('regression', source); } catch { /* A bounded rejection is a valid outcome. */ }
      return Object.prototype.relayuneMarker === undefined && Object.prototype.relayunePolluted === undefined;
    }, { source }), label);
    assert.equal(result, true, `${label} must leave Object.prototype unchanged`);
    assert.deepEqual(await page.evaluate(() => Object.getOwnPropertyNames(Object.prototype).sort()), initialPrototype,
      `${label} must not add any Object.prototype properties`);
  }
  assert.deepEqual(requests, [], 'regression rendering must not access a network');
  console.log('PASS: patched ESM dependency versions, config/architecture prototype safety, CSS scope, bounded XY/radar inputs, offline rendering');
} finally {
  await browser.close();
}
