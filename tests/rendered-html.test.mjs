import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function render() {
  return readFile(new URL("../out/index.html", import.meta.url), "utf8");
}

async function renderEnglish() {
  return readFile(new URL("../out/en/index.html", import.meta.url), "utf8");
}

async function renderEnglishPublicDocuments() {
  return Promise.all([
    "legal/privacy",
    "legal/terms",
  ].map((route) =>
    readFile(new URL(`../out/en/${route}/index.html`, import.meta.url), "utf8"),
  ));
}

test("静态构建渲染 Relayune 应用壳", async () => {
  const html = await render();
  assert.match(html, /<title>Relayune/);
  assert.match(html, /Relayune/);
  assert.match(html, /离开电脑/);
  assert.match(html, /任务不必停下/);
  assert.match(html, /为 Agent 工作流而生的远程入口/);
  assert.match(html, /需要接回的是任务/);
  assert.match(html, /不是整块桌面/);
  assert.match(html, /拖动比较远程桌面与 Relayune/);
  assert.match(html, /同一个任务/);
  assert.match(html, /跨设备继续/);
  assert.match(html, /aria-roledescription="近 3D 产品预览"/);
  assert.match(html, /hero-device-scene/);
  assert.match(html, /hero-laptop-device/);
  assert.match(html, /hero-phone-device/);
  assert.match(html, /本机运行/);
  assert.match(html, /端到端加密/);
  assert.match(html, /本机运行中/);
  assert.match(html, /需要你的决定/);
  assert.match(html, /不传屏幕像素/);
  assert.match(html, /A256GCM ENVELOPE/);
  assert.match(html, /Agent 正在本机读取页面与上下文/);
  assert.match(html, /本机执行轨迹/);
  assert.match(html, /等待决定/);
  assert.match(html, /浏览器处理关键决定/);
  assert.match(html, /Agent 在原项目完成/);
  assert.match(html, /安全连接路径/);
  assert.match(html, /8 位码不离开两端/);
  assert.match(html, /桌面端会发现电脑上的 Codex、Kimi Code 与 Claude Code 任务/);
  assert.match(html, /登录账户后，每个新客户端仍需单独授权/);
  assert.match(html, /用邮箱登录，将桌面端与账户关联/);
  assert.match(html, /单独授权这个客户端/);
  assert.match(html, /HTTPS polling/);
  assert.match(html, /仅主动出站/);
  assert.match(html, /浏览器 \/ Android/);
  assert.match(html, /当前设备与 Relayune 连接准备状态/);
  assert.match(html, /连接准备/);
  assert.match(html, /始终在电脑/);
  assert.match(html, /浏览器与电脑解密/);
  assert.match(html, /查看每个连接端点的安全边界/);
  assert.match(html, /只处理鉴权与路由元数据/);
  assert.match(html, /路由 ID、方向、时间、TTL 与密文大小/);
  assert.match(html, /短码、内容密钥与业务明文/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /role="tabpanel"/);
  assert.match(html, /暂停页面动态效果/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /登录/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /Your site is taking shape/);
  assert.doesNotMatch(html, /LOCAL PROOF OF CONCEPT/);
});

test("英文官网完整渲染任务接续对比场景", async () => {
  const html = await renderEnglish();
  assert.match(html, /^<!DOCTYPE html><html lang="en"/);
  assert.doesNotMatch(html, /^<!DOCTYPE html><html lang="zh-CN"/);
  assert.match(html, /\\"lang\\":\\"en/);
  assert.doesNotMatch(html, /\\"lang\\":\\"zh-CN/);
  assert.match(html, /Bring back the task/);
  assert.match(html, /not the entire desktop/);
  assert.match(html, /Compare remote desktop with Relayune/);
  assert.match(html, /Return directly to the task/);
  assert.match(html, /Local execution trace/);
  assert.match(html, /aria-roledescription="near-3D product preview"/);
  assert.match(html, /Secure connection path/);
  assert.match(html, /The 8-character code stays at both ends/);
  assert.doesNotMatch(html, /需要接回的是任务/);
});

test("Android 下载入口展示当前版本与中英文更新内容", async () => {
  const [zhHtml, enHtml, manifest, desktopManifest] = await Promise.all([
    render(),
    renderEnglish(),
    readFile(new URL("../public/updates/android.json", import.meta.url), "utf8")
      .then(JSON.parse),
    readFile(new URL("../public/updates/latest.json", import.meta.url), "utf8")
      .then(JSON.parse),
  ]);
  const zhNotes = manifest.notes["zh-CN"]
    .split(/\n+/)
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean);
  const enNotes = manifest.notes.en
    .split(/\n+/)
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean);
  const visibleText = (html) => html
    .replaceAll("<!-- -->", "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
  const zhVisibleText = visibleText(zhHtml);
  const enVisibleText = visibleText(enHtml);

  assert.ok(zhVisibleText.includes(`下载 macOS 版 · ${desktopManifest.version}`));
  assert.ok(enVisibleText.includes(`Download for macOS · ${desktopManifest.version}`));
  assert.ok(zhVisibleText.includes(`下载 Android 版 · ${manifest.version_name}`));
  assert.ok(enVisibleText.includes(`Download for Android · ${manifest.version_name}`));
  for (const note of zhNotes) assert.ok(zhVisibleText.includes(note));
  for (const note of enNotes) assert.ok(enVisibleText.includes(note));
});

test("英文公开文档的首字节语言和分享元数据保持英文", async () => {
  for (const html of await renderEnglishPublicDocuments()) {
    const head = html.slice(0, html.indexOf("</head>"));
    assert.match(html, /^<!DOCTYPE html><html lang="en"/);
    assert.match(html, /\\"lang\\":\\"en/);
    assert.doesNotMatch(head, /\p{Script=Han}/u);
  }
});

test("登录页提供已发布的 macOS 与 Android 下载并拒绝未签名 Windows 包", async () => {
  const [source, copySource, publishedDesktopUpdate, publishedAndroidUpdate, releaseSource] = await Promise.all([
    readFile(new URL("../app/marketing-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/marketing-copy-zh.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/updates/latest.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../public/updates/android.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../app/release-assets.ts", import.meta.url), "utf8"),
  ]);
  assert.ok(releaseSource.includes(`RELAYUNE_RELEASE_VERSION = "${publishedAndroidUpdate.version_name}"`));
  assert.ok(releaseSource.includes(`RELAYUNE_MACOS_RELEASE_VERSION = "${publishedDesktopUpdate.version}"`));
  assert.match(releaseSource, /open-chen\.oss-cn-hangzhou\.aliyuncs\.com\/apps\/relayune/);
  assert.match(releaseSource, /macOS-universal\.dmg/);
  assert.doesNotMatch(releaseSource, /Windows-x64-setup\.exe/);
  assert.match(releaseSource, /Android\.apk/);
  assert.match(copySource, /暂不提供未签名安装包/);
  assert.doesNotMatch(source, /Relayune%20Windows%20%E5%86%85%E6%B5%8B/);
});

test("官网动效提供渐进增强与减少动态效果降级", async () => {
  const [source, copySource, styles, heroSource, heroStyles] = await Promise.all([
    readFile(new URL("../app/marketing-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/marketing-copy-zh.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/marketing-hero-demo.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/marketing-hero-demo.css", import.meta.url), "utf8"),
  ]);
  const implementation = `${source}\n${copySource}`;

  assert.match(source, /IntersectionObserver/);
  assert.match(source, /marketing-motion-ready/);
  assert.match(source, /marketing-nav-progress/);
  assert.match(source, /data-motion-scene/);
  assert.match(source, /visibilitychange/);
  assert.match(implementation, /Windows 准备中/);
  assert.match(heroSource, /className="hero-device-scene"/);
  assert.match(heroSource, /className="hero-laptop-device"/);
  assert.match(heroSource, /className="hero-phone-device"/);
  assert.match(heroSource, /className="hero-secure-route"/);
  assert.match(heroSource, /viewBox="0 0 760 590"/);
  assert.match(heroSource, /hero-route-node-ring/);
  assert.match(heroSource, /hero-route-node-core/);
  assert.match(source, /<MarketingHeroDemo copy=\{copy\} locale=\{locale\} motionPaused=\{marketingUserMotionPaused\}/);
  assert.match(heroSource, /const stopped = motionPaused \|\| reducedMotion/);
  assert.match(heroSource, /const running = !stopped && visible && pageVisible/);
  assert.match(heroSource, /IntersectionObserver/);
  assert.match(heroSource, /visibilitychange/);
  assert.match(heroStyles, /prefers-reduced-motion: reduce[\s\S]*?animation: none !important; transition: none !important/);
  assert.match(heroStyles, /\.product-stage:has\(\.hero-demo\) \{ height: auto; \}/);
  assert.match(source, /copy\.heroProofs\.map/);
  assert.match(source, /aria-roledescription=\{copy\.heroPreviewRole\}/);
  assert.match(source, /const continuityMoments = copy\.continuityMoments/);
  assert.match(source, /copy\.connectivityProofs/);
  assert.match(source, /copy\.platformReadiness\[marketingPlatform\]/);
  assert.match(source, /const securityPerspectives = copy\.securityPerspectives/);
  assert.match(source, /function ValueDemo/);
  assert.match(source, /kind: "return" \| "task" \| "cipher"/);
  assert.match(source, /className="marketing-value"[\s\S]{0,120}data-motion-scene/);
  assert.match(source, /activeSecurityPerspective/);
  assert.match(source, /data-security-perspective=\{securityPerspective\.id\}/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tab"/);
  assert.match(source, /role="tabpanel"/);
  assert.match(source, /aria-selected=\{index === activeSecurityPerspective\}/);
  assert.match(source, /event\.key === "ArrowRight"/);
  assert.match(source, /event\.key === "ArrowLeft"/);
  assert.match(source, /event\.key === "Home"/);
  assert.match(source, /event\.key === "End"/);
  assert.match(implementation, /已识别 macOS/);
  assert.match(implementation, /已识别 Windows/);
  assert.match(implementation, /已识别移动设备/);
  assert.match(source, /aria-label=\{copy\.readinessLabel\}/);
  assert.match(source, /aria-pressed=\{index === activeContinuityMoment\}/);
  assert.match(source, /continuityManualPauseTicksRef/);
  assert.match(source, /continuityPointerPausedRef/);
  assert.match(source, /continuityFocusPausedRef/);
  assert.match(source, /marketingUserMotionPausedRef/);
  assert.match(source, /marketing-user-paused/);
  assert.match(implementation, /播放页面动态效果/);
  assert.match(implementation, /暂停页面动态效果/);
  assert.match(source, /className="marketing-how"[\s\S]{0,180}data-motion-scene/);
  assert.match(source, /className="how-sequence"/);
  assert.match(source, /aria-label=\{copy\.connectionPathLabel\}/);
  assert.match(source, /step\.scope/);
  assert.match(source, /data-moment=\{continuityMoment\.id\}/);
  assert.match(source, /continuityTrajectoryStep/);
  assert.match(source, /copy\.trajectoryActions\.map/);
  assert.match(source, /className="continuity-trajectory"/);
  assert.match(source, /aria-current=\{index === continuityTrajectoryStep/);
  assert.match(source, /aria-label=\{copy\.connectivityLabel\}/);
  assert.match(implementation, /电脑发出任务/);
  assert.match(implementation, /Agent 本机执行/);
  assert.match(implementation, /浏览器接续/);
  assert.match(source, /comparisonSplit/);
  assert.match(source, /className="comparison-demo"/);
  assert.match(source, /type="range"/);
  assert.match(source, /aria-valuetext=/);
  assert.match(source, /copy\.comparison\.rangeLabel/);
  assert.match(source, /--card-spot-x/);
  assert.match(source, /moveCardSpotlight/);
  assert.match(source, /pendingStagePoint/);
  assert.match(source, /spotlightFrame/);
  assert.match(source, /stageReleaseTimer/);
  assert.match(source, /\(any-hover: hover\) and \(any-pointer: fine\)/);
  assert.match(source, /is-pointer-active/);
  assert.match(source, /\{ passive: true \}/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(styles, /@keyframes hero-laptop-float/);
  assert.match(styles, /@keyframes hero-phone-float/);
  assert.match(styles, /@keyframes hero-route-travel/);
  assert.match(heroSource, /screen\("web"\)/);
  assert.match(heroSource, /screen\("phone"\)/);
  assert.doesNotMatch(heroSource, /className="demo-(playback|stage-summary)"/);
  assert.match(styles, /@keyframes security-packet-forward/);
  assert.match(styles, /@keyframes security-inspector-in/);
  assert.match(styles, /@keyframes value-question-cycle/);
  assert.match(styles, /@keyframes value-task-travel/);
  assert.match(styles, /@keyframes value-task-travel-back/);
  assert.match(styles, /@keyframes value-cipher-pulse/);
  assert.match(styles, /@keyframes compare-remote-search/);
  assert.match(styles, /@keyframes compare-task-ready/);
  assert.match(styles, /--comparison-split/);
  assert.match(styles, /\.compare-scene-relayune/);
  assert.match(styles, /\.compare-range:focus-visible \+ \.compare-divider b/);
  assert.match(styles, /\.marketing-compare\.is-motion-visible \.compare-remote-cursor/);
  assert.match(styles, /\.marketing-value\.is-motion-visible \.value-return-question/);
  assert.match(styles, /\.value-task-lane b:first-of-type/);
  assert.match(styles, /\.security-node-list button\.is-active/);
  assert.match(styles, /\.security-visual\[data-security-perspective="server"\]/);
  assert.match(styles, /@keyframes continuity-packet/);
  assert.match(styles, /@keyframes continuity-summary-in/);
  assert.match(styles, /@keyframes continuity-trajectory-pulse/);
  assert.match(styles, /@keyframes how-step-confirm/);
  assert.match(styles, /@keyframes how-path-fill/);
  assert.match(styles, /\.marketing-how\.is-motion-visible \.how-steps/);
  assert.match(styles, /\.how-sequence/);
  assert.match(styles, /\.continuity-demo\[data-moment="decision"\] \.continuity-trajectory/);
  assert.match(styles, /\.continuity-demo\.is-motion-visible \.continuity-trajectory/);
  assert.match(styles, /@keyframes cta-ready-pulse/);
  assert.match(styles, /@keyframes cta-route-travel/);
  assert.match(styles, /\.marketing-cta\.is-motion-visible \.marketing-cta-route/);
  assert.match(styles, /\.marketing-user-paused \[data-motion-scene\]/);
  assert.match(styles, /content-visibility: auto/);
  assert.match(styles, /contain-intrinsic-size: auto 780px/);
  assert.match(styles, /\.marketing-motion-toggle \{ display: none; \}/);
  assert.match(styles, /\.continuity-timeline li\.is-active/);
  assert.match(styles, /\.continuity-device\.is-active/);
  assert.match(styles, /@keyframes marketing-proof-loop/);
  assert.match(styles, /\.marketing-proof\.is-motion-visible \.marketing-proof-marquee/);
  assert.match(styles, /animation-timeline: view/);
  assert.match(styles, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(styles, /var\(--card-spot-x/);
  assert.match(styles, /\.product-stage\.is-motion-visible\.is-pointer-active/);
  assert.match(styles, /\.product-stage:hover/);
  assert.match(styles, /contain: paint/);
  assert.match(styles, /animation-play-state: paused/);
  assert.match(styles, /aria-current="location"/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.marketing-proof-group\[aria-hidden="true"\] \{ display: none; \}/);
});

test("官网按访问设备提供诚实的主动作和移动端区块导航", async () => {
  const [source, copySource, styles, releaseSource] = await Promise.all([
    readFile(new URL("../app/marketing-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/marketing-copy-zh.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/release-assets.ts", import.meta.url), "utf8"),
  ]);
  const implementation = `${source}\n${copySource}`;

  assert.match(source, /type MarketingPlatform = "unknown" \| "mac" \| "windows" \| "android" \| "mobile" \| "other"/);
  assert.match(source, /detectMarketingPlatform/);
  assert.match(implementation, /登录并继续任务/);
  assert.match(implementation, /正式签名 APK/);
  assert.match(implementation, /下载 Android 版/);
  assert.match(source, /RELAYUNE_RELEASE_ASSETS\.android\.url/);
  assert.match(releaseSource, /Relayune-\$\{RELAYUNE_RELEASE_VERSION\}-Android\.apk/);
  assert.match(implementation, /了解电脑端安装/);
  assert.match(source, /aria-expanded=\{mobileNavOpen\}/);
  assert.match(source, /aria-label=\{copy\.mobileNavigationLabel\}/);
  assert.match(source, /closeOnOutsidePress/);
  assert.match(source, /event\.key (?:===|!==) "Escape"/);
  assert.match(source, /handoffInstallLink/);
  assert.match(implementation, /把安装链接发到电脑/);
  assert.match(source, /aria-live="polite"/);
  assert.match(styles, /\.marketing-mobile-menu-button/);
  assert.match(styles, /\.marketing-handoff-toast/);
  assert.match(styles, /@keyframes marketing-menu-in/);
  assert.match(styles, /@keyframes handoff-toast-in/);
  assert.match(styles, /\.marketing-page :where\(a, button\):focus-visible/);
  assert.match(styles, /outline: 2px solid #baf2ca/);
  assert.match(styles, /\.marketing-hero\[tabindex="-1"\]:focus-visible \{[\s\S]*?outline: 4px double #baf2ca/);
  assert.match(styles, /@media \(hover: none\) and \(pointer: coarse\)/);
  assert.match(styles, /@media \(forced-colors: active\)/);
  assert.match(styles, /\.marketing-mobile-menu-button \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
});

test("公开首页不预加载登录后才需要的工作台、Markdown 与配对密码学实现", async () => {
  const [html, entrySource, entryLogicSource, workbenchSource, markdownSource, pairingSource, spake2Source] = await Promise.all([
    render(),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/workbench-entry.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/workbench-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/message-markdown.tsx", import.meta.url), "utf8"),
    readFile(new URL("../shared/pairing-pake.ts", import.meta.url), "utf8"),
    readFile(new URL("../shared/spake2-p256.ts", import.meta.url), "utf8"),
  ]);
  const scriptPaths = [...html.matchAll(/<script[^>]+src="([^"]+[.]js)"/g)]
    .map((match) => match[1]);
  const stylePaths = [...html.matchAll(/<link[^>]+href="([^"]+[.]css)"/g)]
    .map((match) => match[1]);
  const initialScripts = await Promise.all(
    scriptPaths.map((path) =>
      readFile(new URL(`../out${path}`, import.meta.url), "utf8"),
    ),
  );
  const initialStyles = await Promise.all(
    stylePaths.map((path) =>
      readFile(new URL(`../out${path}`, import.meta.url), "utf8"),
    ),
  );
  const cssDirectories = [
    new URL("../out/_next/static/chunks/", import.meta.url),
    new URL("../out/_next/static/css/", import.meta.url),
  ];
  const allStyles = (await Promise.all(cssDirectories.map(async (directory) => {
    const cssChunks = await readdir(directory).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    return Promise.all(cssChunks
      .filter((path) => path.endsWith(".css"))
      .map((path) => readFile(new URL(path, directory), "utf8")));
  }))).flat();

  assert.match(entrySource, /lazy\(\(\) => import\("\.\/workbench-page"\)\)/);
  assert.match(entrySource, /hasAuthenticationEntry/);
  assert.match(workbenchSource, /import "\.\/workbench\.css"/);
  assert.match(entryLogicSource, /parameters\.has\("pair"\)/);
  assert.match(entryLogicSource, /X-Relay-Browser-Token/);
  assert.match(entryLogicSource, /await import\("\.\/e2ee"\)/);
  assert.match(entryLogicSource, /isBrowserAuthorizationLost\(response\.status, body\.error\?\.code\)/);
  assert.match(entryLogicSource, /status === 401 && code === "browser_unauthorized"/);
  assert.match(entryLogicSource, /status === 404 && code === "device_not_found"/);
  assert.match(workbenchSource, /lazy\(\(\) => import\("\.\/message-markdown"\)\)/);
  assert.match(workbenchSource, /message-markdown-fallback/);
  assert.match(workbenchSource, /\/api\/commands/);
  assert.doesNotMatch(workbenchSource, /from "react-markdown"/);
  assert.match(markdownSource, /from "react-markdown"/);
  assert.match(markdownSource, /remarkPlugins=\{\[remarkGfm\]\}/);
  assert.match(pairingSource, /from "\.\/spake2-p256"/);
  assert.match(spake2Source, /import\("@noble\/curves\/nist\.js"\)/);
  assert.doesNotMatch(
    spake2Source,
    /import \{ p256 \} from "@noble\/curves\/nist\.js"/,
  );
  assert.ok(scriptPaths.length > 0);
  assert.ok(stylePaths.length > 0);
  assert.doesNotMatch(initialScripts.join("\n"), /\/api\/commands/);
  assert.doesNotMatch(initialScripts.join("\n"), /micromark/);
  assert.doesNotMatch(
    initialScripts.join("\n"),
    /02886e2f97ace46e55ba9dd7242579f2/,
  );
  assert.doesNotMatch(initialStyles.join("\n"), /\.app-shell/);
  assert.doesNotMatch(initialStyles.join("\n"), /\.login-page/);
  assert.match(allStyles.join("\n"), /\.app-shell/);
  assert.match(allStyles.join("\n"), /\.login-page/);
});
