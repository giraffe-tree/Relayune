import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const hasHan = (value) => /\p{Script=Han}/u.test(value);

async function bundleModule(entryPoint, outputName) {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-desktop-errors-"));
  const outfile = join(temporary, outputName);
  await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: "browser",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  return {
    module: await import(`${pathToFileURL(outfile).href}?${Date.now()}`),
    cleanup: () => rm(temporary, { recursive: true, force: true }),
  };
}

test("every stable desktop error code resolves to complete Chinese and English copy", async () => {
  const apiSource = await readFile("desktop/src/api.ts", "utf8");
  const setBody = apiSource.match(
    /new Set<DesktopErrorCode>\(\[([\s\S]*?)\]\)/,
  )?.[1];
  assert.ok(setBody, "DesktopErrorCode needs a runtime allow-list");
  const codes = [...setBody.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  assert.ok(codes.length >= 20, "the allow-list should cover native command families");
  assert.equal(new Set(codes).size, codes.length, "error codes must not be duplicated");

  const bundled = await bundleModule("desktop/src/i18n.ts", "i18n.mjs");
  try {
    for (const code of codes) {
      const chinese = bundled.module.desktopErrorMessage("zh-CN", code);
      const english = bundled.module.desktopErrorMessage("en", code);
      assert.ok(chinese.trim(), `${code} needs Chinese copy`);
      assert.ok(english.trim(), `${code} needs English copy`);
      assert.notEqual(chinese, english, `${code} must actually switch languages`);
      assert.equal(
        hasHan(english),
        false,
        `${code} must not leak Chinese into the English desktop UI`,
      );
    }
  } finally {
    await bundled.cleanup();
  }
});

test("native and sidecar details collapse to stable codes before English rendering", async () => {
  const [apiBundle, i18nBundle] = await Promise.all([
    bundleModule("desktop/src/api.ts", "api.mjs"),
    bundleModule("desktop/src/i18n.ts", "i18n.mjs"),
  ]);
  try {
    assert.equal(
      apiBundle.module.desktopErrorCode(
        "无法打开浏览器；internal detail relayune:open_web_failed",
        "unknown",
      ),
      "open_web_failed",
    );
    assert.equal(
      apiBundle.module.desktopErrorCode("任意未结构化 sidecar 中文", "relay_start_failed"),
      "relay_start_failed",
    );
    const english = i18nBundle.module.desktopErrorMessage(
      "en",
      apiBundle.module.desktopErrorCode(
        "任意未结构化 sidecar 中文",
        "relay_start_failed",
      ),
    );
    assert.equal(hasHan(english), false);
    assert.doesNotMatch(english, /任意|中文|sidecar 中文/);
  } finally {
    await Promise.all([apiBundle.cleanup(), i18nBundle.cleanup()]);
  }
});

test("desktop UI error surfaces never render raw command or diagnostic messages", async () => {
  const main = await readFile("desktop/src/main.ts", "utf8");
  assert.match(main, /desktopErrorMessage/);
  assert.match(main, /desktopErrorCode/);
  assert.doesNotMatch(
    main,
    /showToast\(errorMessage\(error\)\)/,
    "toast catch paths must translate a stable code instead of exposing native details",
  );
  assert.doesNotMatch(
    main,
    /\$\{line\.message\}/,
    "diagnostics must not interpolate raw sidecar lines into an English UI",
  );
  const pairingErrorStart = main.indexOf("function pairingErrorPresentation(");
  const pairingErrorEnd = main.indexOf(
    "class PairingFlowError",
    pairingErrorStart,
  );
  assert.notEqual(pairingErrorStart, -1);
  assert.notEqual(pairingErrorEnd, -1);
  const pairingError = main.slice(pairingErrorStart, pairingErrorEnd);
  assert.match(
    pairingError,
    /error instanceof DesktopCommandError[\s\S]*?kind: "desktop-error"[\s\S]*?desktopErrorCode\(error, "pairing_failed"\)/,
  );
  assert.match(
    pairingError,
    /error instanceof PairingFlowError[\s\S]*?kind: "translation", key: error\.translationKey/,
  );
  assert.match(
    pairingError,
    /kind: "translation", key: "secureConnectionFailed"/,
  );
  assert.match(
    pairingError,
    /function showPairingErrorToast\(error: unknown\)[\s\S]*?showToast\(pairingErrorPresentation\(error\)\)/,
  );
  assert.doesNotMatch(
    pairingError,
    /String\(error\)|error\.message(?!;)/,
    "unexpected PAKE/WebView internals must collapse to stable localized copy",
  );
  assert.match(
    main,
    /type ToastPresentation =[\s\S]*?kind: "translation"[\s\S]*?kind: "desktop-error"/,
  );
  assert.match(
    main,
    /function renderActiveToast\(\)[\s\S]*?toastPresentationText\(activeToast\)/,
  );
  assert.match(
    main,
    /function toastPresentationText\(presentation: ToastPresentation\)[\s\S]*?desktopErrorMessage\(locale, presentation\.code\)/,
  );
  assert.match(
    main,
    /applyStaticTranslations\(\);[\s\S]{0,120}renderActiveToast\(\)/,
  );
  assert.doesNotMatch(
    main,
    /activeToast\s*=\s*error/,
    "the visible toast must retain only stable presentation data, never a raw native error",
  );
  assert.match(main, /let browserListFailed = false/);
  assert.match(
    main,
    /catch \{\s*if \(loadGeneration !== browserListLoadGeneration\) return;\s*browserListFailed = true/,
    "a stale browser-list failure must be ignored before the current request records a stable failure flag",
  );
  assert.doesNotMatch(
    main,
    /browserListError\s*=\s*nativeErrorMessage/,
    "browser-list recovery needs only a failure flag and must not retain localized error copy",
  );

  const friendlyStart = main.indexOf("function friendlyError(");
  if (friendlyStart !== -1) {
    const nextFunction = main.indexOf("\nfunction ", friendlyStart + 1);
    const friendly = main.slice(
      friendlyStart,
      nextFunction === -1 ? main.length : nextFunction,
    );
    assert.doesNotMatch(
      friendly,
      /return message\s*;/,
      "the localization fallback must not return an arbitrary native message verbatim",
    );
  }
});

test("RelaySnapshot logs admit only parameter-free stable diagnostic codes", async () => {
  const [relay, state] = await Promise.all([
    readFile("desktop/src-tauri/src/relay.rs", "utf8"),
    readFile("desktop/src-tauri/src/state.rs", "utf8"),
  ]);
  const requiredInfoCodes = [
    "relayune:relay_starting",
    "relayune:relay_started",
    "relayune:relay_connected",
    "relayune:relay_stopping",
    "relayune:relay_stopped",
    "relayune:browser_authorizations_cleaned",
  ];
  for (const code of requiredInfoCodes) {
    assert.match(relay, new RegExp(`"${code}"`));
  }

  const directRelayLogs = [
    ...relay.matchAll(
      /\.log\(\s*LogLevel::(?:Info|Error),\s*"([^"]+)"/g,
    ),
  ].map((match) => match[1]);
  assert.ok(directRelayLogs.length >= requiredInfoCodes.length);
  for (const message of directRelayLogs) {
    assert.match(
      message,
      /^relayune:[a-z0-9_]+$/,
      `native log literal must be a parameter-free diagnostic code: ${message}`,
    );
    assert.match(
      state,
      new RegExp(`"${message.slice("relayune:".length)}"`),
      `native log code must be registered at the final snapshot boundary: ${message}`,
    );
  }
  assert.doesNotMatch(
    relay,
    /正在启动|进程已启动|PID \{|正在停止|本机 Relay 已停止|已清理 \{|format!\([^)]*Relay/,
  );
  assert.match(state, /let message = redact_log\(message\.as_ref\(\)\)/);
  assert.match(
    state,
    /strip_prefix\("relayune:"\)[\s\S]*?is_ascii_lowercase[\s\S]*?is_ascii_digit[\s\S]*?byte == b'_'/,
    "the final native log boundary must admit only exact stable code syntax",
  );
  assert.match(
    state,
    /const ALLOWED_DIAGNOSTIC_CODES[\s\S]*?ALLOWED_DIAGNOSTIC_CODES\.contains\(&code\)/,
    "code-shaped parameters or unregistered details must not bypass the allow-list",
  );
  assert.match(
    state,
    /if is_stable_diagnostic_code\(trimmed\)[\s\S]*?"relayune:diagnostic_hidden"\.into\(\)/,
    "unstructured paths, stderr, counts, PIDs, and untranslated prose must collapse",
  );
});

test("secure-store failures cannot masquerade as a first-time sign-in", async () => {
  const [secrets, native] = await Promise.all([
    readFile("desktop/src-tauri/src/secrets.rs", "utf8"),
    readFile("desktop/src-tauri/src/lib.rs", "utf8"),
  ]);

  assert.match(
    secrets,
    /pub fn presence_for_browsers\([\s\S]*?\) -> Result<SecretPresence, String>/,
  );
  assert.match(
    secrets,
    /let plaintext = if path\.exists\(\)[\s\S]*?decrypt_vault\(&path, &key\)\?[\s\S]*?VaultPlaintext::default\(\)/,
    "only a genuinely absent vault may map to an empty enrollment",
  );
  assert.match(
    secrets,
    /fn decrypt_vault\([\s\S]*?map_err\(\|_\| user_error\("credential_access_failed"\)\)/,
    "vault read or authentication errors must stay explicit",
  );
  assert.match(
    native,
    /let secrets = match secrets::presence_for_browsers\([\s\S]*?Err\(error\)[\s\S]*?reconcile_bootstrap_native_presentation\([\s\S]*?None[\s\S]*?return Err\(error\)/,
    "bootstrap must restore durable native language while preserving the stable credential error for the retry UI",
  );
  const bootstrapStart = native.indexOf("fn bootstrap(");
  const bootstrapEnd = native.indexOf("\nfn setup_tray(", bootstrapStart);
  assert.notEqual(bootstrapStart, -1);
  assert.notEqual(bootstrapEnd, -1);
  const bootstrap = native.slice(bootstrapStart, bootstrapEnd);
  assert.match(
    bootstrap,
    /config::load_or_create\(app\)\?/,
    "a config load failure must stay on the retry surface instead of becoming a fake first login",
  );
  assert.match(
    native,
    /fn reconcile_bootstrap_native_presentation[\s\S]*?state\.set_config\(config\)[\s\S]*?state\.set_ui_language\(language\)/,
    "a successful retry must atomically restore durable config and language into native state",
  );
  assert.match(
    native,
    /reconcile_bootstrap_native_presentation\([\s\S]*?secrets\.device_token && secrets\.e2ee_key/,
    "a successful retry must atomically repair the native tray's cached pairing and recovery state",
  );
  assert.match(
    native,
    /fn reconcile_bootstrap_native_presentation[\s\S]*?state\.set_paired\(paired\)[\s\S]*?state\.set_recovery_required\(false\)[\s\S]*?refresh\(\)/,
    "repairing cached pairing state must clear recovery and refresh the menu in one serialized transaction",
  );
});
