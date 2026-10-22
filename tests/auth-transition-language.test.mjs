import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";

async function bundle(entry, name, external = []) {
  const temporary = await mkdtemp(
    join(process.cwd(), ".relayune-auth-transition-"),
  );
  const output = join(temporary, `${name}.mjs`);
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    external,
    logLevel: "silent",
  });
  return {
    module: await import(`${pathToFileURL(output).href}?${Date.now()}`),
    cleanup: () => rm(temporary, { recursive: true, force: true }),
  };
}

test("the workbench suspense state renders one language and declares it", async () => {
  const bundled = await bundle(
    "app/workbench-fallback.tsx",
    "workbench-fallback",
    ["react"],
  );
  try {
    const Fallback = bundled.module.default;
    const english = renderToStaticMarkup(
      React.createElement(Fallback, { locale: "en" }),
    );
    const chinese = renderToStaticMarkup(
      React.createElement(Fallback, { locale: "zh-CN" }),
    );

    assert.match(english, /lang="en"/);
    assert.match(english, /Opening secure workspace…/);
    assert.doesNotMatch(english, /\p{Script=Han}/u);
    assert.doesNotMatch(english, /正在打开安全工作区/);
    assert.match(chinese, /lang="zh-CN"/);
    assert.match(chinese, /正在打开安全工作区…/);
    assert.doesNotMatch(chinese, /Opening secure workspace/);
  } finally {
    await bundled.cleanup();
  }
});

test("bootstrap error kinds localize at render time without storing error copy", async () => {
  const bundled = await bundle("app/auth-language.ts", "auth-language");
  try {
    const { authBootstrapErrorText, authText } = bundled.module;
    for (const kind of [
      "service-unavailable",
      "restore-failed",
      "retry-service-unavailable",
    ]) {
      const english = authBootstrapErrorText("en", kind);
      const chinese = authBootstrapErrorText("zh-CN", kind);
      assert.ok(english);
      assert.ok(chinese);
      assert.doesNotMatch(english, /\p{Script=Han}/u);
      assert.notEqual(english, chinese);
    }
    assert.equal(authText("en", "switchLanguageLabel"), "Switch to Chinese");
    assert.equal(authText("zh-CN", "switchLanguageLabel"), "切换为英文");
  } finally {
    await bundled.cleanup();
  }
});

test("language switching does not restart bootstrap or refocus its existing error", async () => {
  const [page, workbenchBundle] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    bundle("app/workbench-language.ts", "workbench-language"),
  ]);
  try {
    const { workbenchText } = workbenchBundle.module;
    assert.equal(workbenchText("en", "switchLanguageLabel"), "Choose language");
    assert.equal(workbenchText("zh-CN", "switchLanguageLabel"), "选择语言");
    assert.match(page, /useState<AuthBootstrapErrorKind \| null>\(null\)/);
    assert.match(page, /authBootstrapErrorText\(authLocale, bootstrapErrorKind\)/);
    assert.doesNotMatch(page, /setBootstrapError\(/);
    assert.match(
      page,
      /if \(!bootstrapErrorKind\) return;[\s\S]{0,220}\}, \[bootstrapErrorKind\]\);/,
    );
    const bootstrapStart = page.indexOf("const bootstrapRefreshRef = useRef(refresh)");
    const bootstrapEnd = page.indexOf(
      "if (!toast && !authToastKey) return",
      bootstrapStart,
    );
    assert.notEqual(bootstrapStart, -1);
    assert.notEqual(bootstrapEnd, -1);
    const bootstrapEffect = page.slice(bootstrapStart, bootstrapEnd);
    assert.match(bootstrapEffect, /bootstrapRefreshRef\.current\(\)/);
    assert.match(bootstrapEffect, /setAuthToastKey\("legacyCredentials"\)/);
    assert.match(
      bootstrapEffect,
      /isBrowserAuthorizationLost\(error\.status, error\.code\)/,
    );
    assert.match(
      page,
      /const handleRevoked = \(\) => \{[\s\S]{0,560}setAuthToastKey\("browserRevoked"\)/,
    );
    assert.match(bootstrapEffect, /setAuthToastKey\("savedKeyInvalid"\)/);
    assert.doesNotMatch(bootstrapEffect, /error\.message/);
    assert.match(
      bootstrapEffect,
      /\}, \[desktopLoginId, desktopLoginParameter, updateRealtimeDevice\]\);/,
    );
    assert.match(
      page,
      /const updateRealtimeDevice = useCallback\([\s\S]{0,420}\n\s*\[\],\n\s*\);/,
      "the bootstrap dependency must remain stable across locale changes",
    );
    assert.doesNotMatch(bootstrapEffect, /\[authLocale, refresh\]/);
    assert.match(page, /SUPPORTED_LOCALES\.map\(\(candidate\) =>/);
    assert.match(page, /onChange=\{\(event\) => onToggle\(event\.target\.value as AuthLocale\)\}/);
  } finally {
    await workbenchBundle.cleanup();
  }
});

test("visible authentication and pairing state retranslate without replaying work", async () => {
  const page = await readFile("app/workbench-page.tsx", "utf8");

  for (const state of [
    "pairingLinkError",
    "emailError",
    "emailFlowError",
    "passwordError",
    "newPasswordError",
    "passwordConfirmationError",
    "passwordSetupError",
    "pairingFormError",
  ]) {
    const setter = `set${state[0].toUpperCase()}${state.slice(1)}`;
    assert.match(
      page,
      new RegExp(
        `const \\[${state}, ${setter}\\] =\\s*useState<AuthCopyKey \\| null>\\(\\s*null,?\\s*\\)`,
      ),
      `${state} should store a stable copy key instead of rendered text`,
    );
    assert.doesNotMatch(
      page,
      new RegExp(`${setter}\\(authText\\(`),
      `${state} must not retain the previous locale's rendered text`,
    );
  }

  assert.match(
    page,
    /const \[authToastKey, setAuthToastKey\] = useState<AuthCopyKey \| null>\(null\);/,
  );
  assert.match(
    page,
    /const visibleToast = authToastKey[\s\S]*?authText\(authLocale, authToastKey\)[\s\S]*?typeof toast === "string"[\s\S]*?workbenchText\(authLocale, toast\.key, toast\.variables\);/,
  );
  assert.match(
    page,
    /setEmailFlowError\(authenticationErrorFor\("emailStatus", error\)\)/,
  );
  assert.match(
    page,
    /setPasswordError\(authenticationErrorFor\("password", error\)\)/,
  );
  assert.doesNotMatch(
    page,
    /setToast\(workbenchText\(authLocale, "browserRevoked"\)\)/,
  );
  assert.match(page, /\{authText\(authLocale, pairingLinkError\)\}/);
  assert.match(page, /\{authText\(authLocale, emailFlowError\)\}/);
  assert.match(page, /\{authText\(authLocale, pairingFormError\)\}/);
  assert.match(page, /\{authText\(authLocale, passwordError\)\}/);
  assert.match(page, /\{authText\(authLocale, newPasswordError\)\}/);
  assert.match(page, /\{authText\(authLocale, passwordConfirmationError\)\}/);
  assert.match(page, /\{authText\(authLocale, passwordSetupError\)\}/);

  const pairingLookupStart = page.indexOf("if (!pairingId) return;");
  const pairingLookupEnd = page.indexOf(
    "}, [pairingId, urlPairingId]);",
    pairingLookupStart,
  );
  assert.notEqual(pairingLookupStart, -1);
  assert.notEqual(pairingLookupEnd, -1);
  const pairingLookup = page.slice(pairingLookupStart, pairingLookupEnd + 30);
  assert.doesNotMatch(pairingLookup, /authLocale/);
  assert.match(pairingLookup, /setPairingLinkError\(/);

  assert.match(
    page,
    /if \(!pairingLinkError\) return;[\s\S]{0,220}\}, \[pairingLinkError\]\);/,
  );
  assert.match(
    page,
    /const toggleAuthLocale = useCallback\(\(next: AuthLocale\) => \{[\s\S]{0,220}setToast\(\(current\) =>\s*\(?\s*typeof current === "string" \? "" : current\s*\)?\s*\);[\s\S]{0,120}setAuthLocaleOverride\(next\);[\s\S]{0,40}\}, \[\]\);/,
  );
  assert.doesNotMatch(
    page,
    /const toggleAuthLocale = useCallback\([\s\S]{0,360}(?:focus|refresh|api<)/,
  );
});
