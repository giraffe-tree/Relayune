import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

let marketingCopyPromise;
function loadMarketingCopy() {
  return marketingCopyPromise ??= build({
    entryPoints: ["app/marketing-copy.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  }).then(({ outputFiles }) => import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
  ));
}

test("the continuous product audit defines three roles, three lenses, and a nine-cell loop", async () => {
  const audit = await read("../docs/qa/continuous-product-role-audit.md");

  for (const role of ["ROLE-NEW", "ROLE-MOBILE", "ROLE-TEAM"]) {
    assert.match(audit, new RegExp(`\\b${role}\\b`));
  }
  for (const lens of ["LENS-PM", "LENS-DESIGN", "LENS-ARCH"]) {
    assert.match(audit, new RegExp(`\\b${lens}\\b`));
  }
  assert.match(audit, /九宫格执行矩阵/);
  assert.match(audit, /子 Agent 只读实访/);
  assert.match(audit, /真实浏览器证据/);
  assert.match(audit, /P0\/P1\/P2/);
});

test("web onboarding prioritizes the code while mobile preserves its scan-first manual fallback", async () => {
  const { zhMarketingCopy: zh, enMarketingCopy: en } = await loadMarketingCopy();
  const [auth, workbench, mobile] = await Promise.all([
    read("../app/auth-language.ts"),
    read("../app/workbench-page.tsx"),
    read("../mobile/lib/src/ui/pairing_screen.dart"),
  ]);

  assert.match(zh.howDescription, /在电脑安装 Relayune，用邮箱登录，再用电脑显示的 8 位码授权浏览器或手机/);
  assert.match(zh.howDescription, /每个新客户端仍需单独授权/);
  assert.match(zh.howSteps[2].description, /输入电脑显示的 8 位码，单独授权这个客户端；也可扫码连接/);
  assert.match(en.howDescription, /Install Relayune on your computer, sign in with email, then authorize your browser or phone with the 8-character code/);
  assert.match(en.howDescription, /Each new client needs its own authorization after sign-in/);
  assert.match(en.howSteps[2].description, /Enter the 8-character code from your computer/);
  assert.match(en.howSteps[2].description, /Scanning is an optional shortcut/);
  assert.match(auth, /scanPairingQr: "扫描二维码快捷连接"/);
  assert.match(auth, /scanPairingQr: "Scan QR as a shortcut"/);

  const linkedPairing = workbench.slice(
    workbench.indexOf("if (pairingId)"),
    workbench.indexOf("if (needsE2eeKey && pendingBrowserDiscovery?.has_bound_computer)"),
  );
  const linkedForm = linkedPairing.indexOf('<form\n            className="login-form"');
  const linkedScanner = linkedPairing.indexOf("<PairingScanner");
  assert.ok(linkedForm >= 0 && linkedScanner > linkedForm);

  const discoveredPairing = workbench.slice(
    workbench.indexOf("if (needsE2eeKey && pendingBrowserDiscovery?.has_bound_computer)"),
    workbench.indexOf("if (needsE2eeKey) {", workbench.indexOf("if (needsE2eeKey && pendingBrowserDiscovery?.has_bound_computer)")),
  );
  const discoveredForm = discoveredPairing.indexOf('<form\n            className="login-form"');
  const discoveredScanner = discoveredPairing.indexOf("<PairingScanner");
  assert.ok(discoveredForm >= 0 && discoveredScanner > discoveredForm);
  assert.match(mobile, /bool _showManual = false/);
  const scan = mobile.indexOf("key: const ValueKey('scan-pairing-qr')");
  const toggle = mobile.indexOf("key: const ValueKey('toggle-manual-pairing')");
  const manual = mobile.indexOf("key: const ValueKey('manual-pairing')");
  assert.ok(scan >= 0 && toggle > scan && manual > toggle);
  assert.match(mobile, /if \(_showManual\)\s+Card\(/);
});

test("authentication keeps a visible localized home path and platform-specific versions", async () => {
  const [home, workbench, marketing] = await Promise.all([
    read("../app/page.tsx"),
    read("../app/workbench-page.tsx"),
    read("../app/marketing-home.tsx"),
  ]);

  assert.match(home, /storeAuthLocale\("zh-CN"\);[\s\S]{0,100}markMarketingReturnFocus\(\)/);
  assert.match(workbench, /function LoginBrand/);
  assert.match(workbench, /href=\{localePath\(locale\)\}/);
  assert.match(workbench, /macOS \{RELAYUNE_MACOS_RELEASE_VERSION\}/);
  assert.match(workbench, /Android \{RELAYUNE_ANDROID_RELEASE\.version\}/);
  assert.match(marketing, /copy\.platformVersions/);
  assert.match(marketing, /macOS \{RELAYUNE_MACOS_RELEASE_VERSION\}/);
  assert.match(marketing, /copy\.downloadMac\} · \{RELAYUNE_MACOS_RELEASE_VERSION\}/);
  assert.match(marketing, /Android \{RELAYUNE_ANDROID_RELEASE\.version\}/);
});

test("public security copy limits ciphertext claims to business payloads", async () => {
  const { zhMarketingCopy: zh, enMarketingCopy: en } = await loadMarketingCopy();
  const legal = await read("../app/legal/legal-content.tsx");

  assert.equal(zh.serverCiphertextOnly, "业务载荷只见密文");
  assert.match(zh.securityDescription, /任务内容只在你的电脑和已授权的客户端解密/);
  assert.match(zh.securityDescription, /服务器无法读取任务内容或连接码，只处理邮箱和连接所需的信息/);
  assert.equal(en.serverCiphertextOnly, "Business payloads stay ciphertext");
  assert.match(en.securityDescription, /Task content is decrypted only on your computer and authorized clients/);
  assert.match(en.securityDescription, /servers cannot read your tasks or connection codes; they handle your email and the information needed to connect/);
  assert.match(legal, /强恶意服务器替换这些脚本/);
  assert.match(legal, /malicious server that replaces that code/);
});
