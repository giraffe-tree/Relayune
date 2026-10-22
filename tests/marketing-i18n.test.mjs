import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

async function loadMarketingCopy() {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-marketing-copy-"));
  const output = join(temporary, "marketing-copy.mjs");
  await build({
    entryPoints: ["app/marketing-copy.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });
  return {
    copy: await import(`${pathToFileURL(output).href}?${Date.now()}`),
    cleanup: () => rm(temporary, { recursive: true, force: true }),
  };
}

async function loadInitialAssets(path) {
  const html = await readFile(new URL(path, import.meta.url), "utf8");
  const scriptPaths = [...new Set(
    [...html.matchAll(/<script[^>]+src="([^"]+[.]js)"/g)]
      .map((match) => match[1]),
  )];
  const stylePaths = [...new Set(
    [...html.matchAll(/<link[^>]+href="([^"]+[.]css)"/g)]
      .map((match) => match[1]),
  )];
  const [scripts, styles] = await Promise.all([
    Promise.all(scriptPaths.map((scriptPath) =>
      readFile(new URL(`../out${scriptPath}`, import.meta.url), "utf8"),
    )),
    Promise.all(stylePaths.map((stylePath) =>
      readFile(new URL(`../out${stylePath}`, import.meta.url)),
    )),
  ]);
  return {
    scriptBytes: scripts.reduce(
      (total, script) => total + Buffer.byteLength(script),
      0,
    ),
    scriptSource: scripts.join("\n"),
    styleBytes: styles.reduce((total, style) => total + style.byteLength, 0),
  };
}

function assertSameShape(left, right, path = "copy") {
  if (Array.isArray(left) || Array.isArray(right)) {
    assert.ok(Array.isArray(left) && Array.isArray(right), `${path} array shape`);
    assert.equal(left.length, right.length, `${path} array length`);
    left.forEach((value, index) => assertSameShape(value, right[index], `${path}[${index}]`));
    return;
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    assert.deepEqual(Object.keys(left).sort(), Object.keys(right).sort(), `${path} keys`);
    for (const key of Object.keys(left)) assertSameShape(left[key], right[key], `${path}.${key}`);
    return;
  }
  assert.equal(typeof left, typeof right, `${path} value type`);
}

test("营销首页中英文字典结构完整且英文业务文案不混入汉字", async () => {
  const bundled = await loadMarketingCopy();
  try {
    const { marketingCopy } = bundled.copy;
    assertSameShape(marketingCopy["zh-CN"], marketingCopy.en);
    const englishCopy = JSON.stringify(marketingCopy.en);
    assert.doesNotMatch(englishCopy, /[\p{Script=Han}]/u);
    assert.match(englishCopy, /8-character code/);
    assert.doesNotMatch(englishCopy, /8-digit code/i);
    assert.equal(marketingCopy.en.heroScenarios.length, 3);
    assert.equal(marketingCopy.en.continuityMoments.length, 3);
    assert.equal(marketingCopy.en.securityPerspectives.length, 3);
    assert.equal(marketingCopy.en.howSteps.length, 3);
  } finally {
    await bundled.cleanup();
  }
});

test("营销首页的交互、ARIA、平台 CTA 与 handoff 全部从 locale copy 读取", async () => {
  const [source, rootPage, localePage, englishEntry, chineseEntry] = await Promise.all([
    readFile(new URL("../app/marketing-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/marketing-locale-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/english-marketing-entry.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/chinese-marketing-entry.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(source, /[\p{Script=Han}]/u);
  assert.equal([...source.matchAll(/copy\.navCommunity/g)].length, 3, "all community entries use localized copy");
  assert.match(source, /locale: MarketingLocale/);
  assert.match(source, /copy: MarketingCopy/);
  assert.doesNotMatch(source, /getMarketingCopy/);
  assert.match(source, /aria-label=\{copy\.heroPreviewLabel\}/);
  assert.match(source, /aria-roledescription=\{copy\.heroPreviewRole\}/);
  assert.match(source, /aria-describedby="hero-preview-description"/);
  assert.match(source, /copy\.platformNotes\.mobile/);
  assert.match(source, /copy\.handoffNotices\.shared/);
  assert.match(source, /copy\.comparison\.rangeLabel/);
  assert.match(source, /copy\.securityPerspectives/);
  assert.match(source, /copy\.alternateLocalePath/);
  assert.match(source, /className="marketing-skip-link" href="#top"/);
  assert.match(source, /\{copy\.skipToContent\}/);
  assert.match(source, /id="top" tabIndex=\{-1\}/);
  assert.match(
    source,
    /return \(\s*<>\s*<a className="marketing-skip-link"[\s\S]{0,180}<main/,
  );
  assert.match(source, /mobileNavToggleRef\.current\?\.focus\(\)/);
  assert.match(
    source,
    /if \(!mobileNavOpen\) return;[\s\S]{0,180}mobileNavFirstLinkRef\.current\?\.focus\(\)/,
    "opening the mobile navigation should move keyboard focus into its disclosed content",
  );
  assert.match(source, /ref=\{mobileNavFirstLinkRef\}[\s\S]{0,80}href="#continuity"/);
  assert.match(
    source,
    /const navigateFromMobileMenu = \(targetId: string\) => \{[\s\S]{0,220}setMobileNavOpen\(false\);[\s\S]{0,220}document\.getElementById\(targetId\)\?\.focus\(\{ preventScroll: true \}\)/,
    "activating a mobile menu anchor should preserve focus context after the menu unmounts",
  );
  for (const targetId of ["continuity", "how-it-works", "security"]) {
    assert.match(
      source,
      new RegExp(`onClick=\\{\\(\\) => navigateFromMobileMenu\\("${targetId}"\\)\\}`),
      `mobile navigation should focus ${targetId} after following its anchor`,
    );
    assert.match(
      source,
      new RegExp(`id="${targetId}"[\\s\\S]{0,80}tabIndex=\\{-1\\}`),
      `${targetId} should accept programmatic focus`,
    );
  }
  assert.match(source, /storedMarketingMotionPaused\(\)/);
  assert.match(source, /persistMarketingMotionPaused\(nextPaused\)/);
  assert.match(rootPage, /copy=\{zhMarketingCopy\}/);
  assert.match(localePage, /copy=\{copy\}/);
  assert.match(englishEntry, /copy=\{enMarketingCopy\}/);
  assert.doesNotMatch(englishEntry, /zhMarketingCopy/);
  assert.match(chineseEntry, /copy=\{zhMarketingCopy\}/);
  assert.doesNotMatch(chineseEntry, /enMarketingCopy/);
});

test("用户手动暂停动效后跨登录往返保持选择，存储失败不阻塞页面", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-motion-preference-"));
  const output = join(temporary, "marketing-motion-preference.mjs");
  await build({
    entryPoints: ["app/marketing-motion-preference.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });
  try {
    const {
      MARKETING_MOTION_STORAGE_KEY,
      persistMarketingMotionPaused,
      storedMarketingMotionPaused,
    } = await import(`${pathToFileURL(output).href}?${Date.now()}`);
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };

    assert.equal(storedMarketingMotionPaused(() => storage), false);
    persistMarketingMotionPaused(true, () => storage);
    assert.equal(values.get(MARKETING_MOTION_STORAGE_KEY), "true");
    assert.equal(storedMarketingMotionPaused(() => storage), true);
    persistMarketingMotionPaused(false, () => storage);
    assert.equal(storedMarketingMotionPaused(() => storage), false);
    assert.doesNotMatch(MARKETING_MOTION_STORAGE_KEY, /pair|code|locale/i);
    assert.doesNotThrow(() =>
      persistMarketingMotionPaused(true, () => {
        throw new DOMException("Storage blocked", "SecurityError");
      }),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("英文静态首页只渲染英文产品旅程和可访问标签", async () => {
  const html = await readFile(
    new URL("../out/en/index.html", import.meta.url),
    "utf8",
  );

  assert.match(html, /Your local Agent, available anywhere/);
  assert.match(html, /near-3D product preview/);
  assert.match(html, /Relayune core capabilities/);
  assert.match(html, /Current device and Relayune connection readiness/);
  const visibleEnglish = html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<select[\s\S]*?<\/select>/g, "");
  assert.doesNotMatch(visibleEnglish, /[\p{Script=Han}]/u);
});

test("公开语言路由只渲染当前语言的营销内容", async () => {
  const [chinese, english] = await Promise.all([
    readFile(new URL("../out/index.html", import.meta.url), "utf8"),
    readFile(new URL("../out/en/index.html", import.meta.url), "utf8"),
  ]);

  assert.match(chinese, /需要接回的是任务/);
  assert.doesNotMatch(chinese, /Bring back the task/);
  assert.match(english, /Bring back the task/);
  assert.doesNotMatch(english, /需要接回的是任务/);
});

test("公开语言入口不下载另一语言的营销字典", async () => {
  const [chineseAssets, englishAssets] = await Promise.all([
    loadInitialAssets("../out/index.html"),
    loadInitialAssets("../out/en/index.html"),
  ]);

  assert.match(chineseAssets.scriptSource, /需要接回的是任务/);
  assert.doesNotMatch(chineseAssets.scriptSource, /Bring back the task/);
  assert.match(englishAssets.scriptSource, /Bring back the task/);
  assert.doesNotMatch(englishAssets.scriptSource, /需要接回的是任务/);
  assert.match(chineseAssets.scriptSource, /每个新客户端仍需单独授权/);
  assert.doesNotMatch(chineseAssets.scriptSource, /Each new client needs its own authorization after sign-in/);
  assert.match(englishAssets.scriptSource, /Each new client needs its own authorization after sign-in/);
  assert.doesNotMatch(englishAssets.scriptSource, /每个新客户端仍需单独授权/);
  // The always-visible download matrix and ten-language selector add the native
  // locale registry to the first render. Keep that within a narrow allowance.
  assert.ok(chineseAssets.scriptBytes <= 720_000, "Chinese initial JS budget");
  // The lazy attachment reader adds a small chunk-loader registry entry;
  // its implementation remains outside the initial marketing download.
  assert.ok(englishAssets.scriptBytes <= 871_000, "English initial JS budget");
  // The always-available keyboard skip link, responsive download cards and
  // signed-in QR scanner share one exported stylesheet. Keep the scanner's
  // camera dialog and manual fallback within a narrow additional allowance.
  // The simulated desktop/iPhone demo adds ~12 KB of CSS in place of screenshots.
  // Current production CSS is ~103 KB; retain a small, explicit headroom.
  assert.ok(chineseAssets.styleBytes <= 105_000, "Chinese initial CSS budget");
  assert.ok(englishAssets.styleBytes <= 105_000, "English initial CSS budget");
});
