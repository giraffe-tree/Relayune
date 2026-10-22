import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

test("web authentication chooses and persists complete Chinese or English copy", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-auth-language-"));
  try {
    const bundle = join(temporary, "auth-language.mjs");
    await build({
      entryPoints: ["app/auth-language.ts"],
      bundle: true,
      platform: "browser",
      format: "esm",
      outfile: bundle,
      logLevel: "silent",
    });
    const language = await import(`${pathToFileURL(bundle).href}?${Date.now()}`);

    assert.equal(language.detectAuthLocale(["zh-Hans-CN", "en-US"]), "zh-CN");
    assert.equal(language.detectAuthLocale(["zh-Hant-TW", "fr-FR"]), "fr");
    assert.equal(language.detectAuthLocale(["zh-TW"]), "en");
    assert.equal(language.detectAuthLocale(["en-US"]), "en");
    assert.equal(language.detectAuthLocale(["zh-CN"], "en"), "en");
    assert.equal(language.detectAuthLocale(["en-US"], "zh-CN"), "zh-CN");

    for (const key of [
      "connectLoginTitle",
      "multiAgentNames",
      "taskSuffix",
      "emailAddress",
      "setPasswordTitle",
      "passwordRequirement",
      "enterDeviceCode",
      "pairingExpired",
      "retryConnection",
      "connectionCancelled",
      "checking",
      "sendingVerificationEmail",
      "resendEmail",
      "useAnotherEmail",
      "verificationResent",
      "verifyEmailAgain",
      "signingIn",
      "sendingVerification",
      "saving",
      "signingOut",
    ]) {
      assert.notEqual(language.authText("zh-CN", key), "");
      assert.notEqual(language.authText("en", key), "");
      assert.notEqual(language.authText("zh-CN", key), language.authText("en", key));
    }
    assert.equal(language.AUTH_LOCALE_COOKIE_KEY, "relayune_locale");
    assert.equal(language.AUTH_LOCALE_STORAGE_KEY, "relayune.webLocale");
    assert.match(language.authText("en", "connectLoginSubtitle"), /8-character code/);
    assert.match(language.authText("zh-CN", "passwordRequirement"), /8–128 个字符/);
    assert.match(language.authText("en", "passwordRequirement"), /8–128 characters/);
    for (const key of ["connectLoginSubtitle", "codeSubtitle", "openDesktopHelp"]) {
      assert.doesNotMatch(language.authText("en", key), /8-digit code/i);
    }
    assert.equal(
      language.readStoredAuthLocale({
        getItem() {
          throw new Error("storage disabled");
        },
      }),
      null,
    );
    assert.doesNotThrow(() =>
      language.storeAuthLocale(
        "en",
        {
          setItem() {
            throw new Error("storage disabled");
          },
        },
      ),
    );
    const cookieTarget = { cookie: "" };
    const unavailableStorage = {
      getItem() {
        throw new Error("storage disabled");
      },
      setItem() {
        throw new Error("storage disabled");
      },
    };
    language.storeAuthLocale("en", unavailableStorage, cookieTarget);
    assert.match(
      cookieTarget.cookie,
      /^relayune_locale=en; Path=\/; Max-Age=31536000; SameSite=Lax/,
    );
    assert.equal(
      language.readStoredAuthLocale(unavailableStorage, cookieTarget.cookie),
      "en",
      "the English marketing entry must survive a root-path login handoff when localStorage is blocked",
    );
    assert.equal(
      language.readStoredAuthLocale(
        { getItem: () => "zh-CN" },
        "relayune_locale=en",
      ),
      "zh-CN",
      "an explicit local preference remains authoritative",
    );
    assert.equal(
      language.readStoredAuthLocale(
        { getItem: () => null },
        "relayune_locale=unsupported",
      ),
      null,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("pairing auth switches language locally without adding locale or the short code to URLs", async () => {
  const [page, authLanguage, pairingLink] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/auth-language.ts", "utf8"),
    readFile("desktop/src/pairing-link.ts", "utf8"),
  ]);

  assert.match(page, /detectAuthLocale\(/);
  assert.match(page, /readStoredAuthLocale\(\)/);
  assert.match(page, /storeAuthLocale\(next\)/);
  assert.match(page, /applyDocumentLocale\(/);
  assert.match(page, /function AuthLanguageSwitch/);
  assert.match(page, /SUPPORTED_LOCALES\.map\(\(candidate\) =>/);
  assert.match(page, /authText\(authLocale, "connectLoginTitle"\)/);
  assert.match(page, /authText\(authLocale, "enterDeviceCode"\)/);
  assert.match(page, /authText\(authLocale, "invalidLinkTitle"\)/);
  assert.match(page, /authText\(authLocale, "expiredLinkTitle"\)/);
  assert.match(page, /authText\(authLocale, "retryConnection"\)/);
  assert.match(authLanguage, /Sign in and connect this computer/);
  assert.match(authLanguage, /Enter the code shown on your computer/);

  const connectionUrlSource = pairingLink.slice(
    pairingLink.indexOf("export function pairingConnectionUrl"),
    pairingLink.indexOf("const pairingQrPrefix"),
  );
  assert.doesNotMatch(connectionUrlSource, /lang|locale|pairingCode|code=/i);
  assert.match(
    connectionUrlSource,
    /\?pair=\$\{encodeURIComponent\(pairingId\)\}/,
  );
  assert.doesNotMatch(pairingLink, /[?&#](?:pairingCode|code)=/i);
  assert.doesNotMatch(page, /[?&](?:lang|locale)=/i);
  assert.doesNotMatch(
    page,
    /JSON\.stringify\(\{[^}]*?(?:pairing_code|connection_code|short_code)/i,
  );
});

test("English multi-agent sign-in copy contains no Chinese conjunction", async () => {
  const [page, authLanguage] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/auth-language.ts", "utf8"),
  ]);
  assert.match(
    page,
    /authText\(authLocale, "multiAgentNames"\)/,
  );
  assert.match(authLanguage, /multiAgentNames: "Codex, Kimi, and Claude"/);
});
