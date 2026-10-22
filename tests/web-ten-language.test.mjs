import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const locales = ["en", "zh-CN", "hi", "es", "ar", "fr", "bn", "pt", "id", "ur"];
const additionalLocales = locales.slice(2);
const placeholders = (value) =>
  [...String(value).matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((match) => match[1])
    .sort();

function stringLeaves(value, path = "") {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => stringLeaves(item, `${path}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) =>
      stringLeaves(item, path ? `${path}.${key}` : key));
  }
  return [];
}

async function bundled(entry, name) {
  const temporary = await mkdtemp(join(tmpdir(), `relayune-${name}-`));
  const outfile = join(temporary, `${name}.mjs`);
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  return {
    module: await import(`${pathToFileURL(outfile).href}?${Date.now()}`),
    cleanup: () => rm(temporary, { recursive: true, force: true }),
  };
}

test("Web locale registry detects, persists, routes, and directs all ten languages", async () => {
  const loaded = await bundled("app/supported-locales.ts", "supported-locales");
  try {
    const registry = loaded.module;
    assert.deepEqual([...registry.SUPPORTED_LOCALES], locales);
    assert.equal(registry.detectSupportedLocale(["es-MX", "en-US"]), "es");
    assert.equal(registry.detectSupportedLocale(["ar-SA"]), "ar");
    assert.equal(registry.detectSupportedLocale(["pt-BR"]), "pt");
    assert.equal(registry.detectSupportedLocale(["id-ID"]), "id");
    assert.equal(registry.detectSupportedLocale(["ur-PK"]), "ur");
    assert.equal(registry.detectSupportedLocale(["en-US"], "bn-BD"), "bn");
    assert.equal(registry.normalizeLocale("zh-Hant-TW"), null);
    assert.equal(registry.normalizeLocale("zh-TW"), null);
    assert.equal(registry.detectSupportedLocale(["zh-Hant-TW", "fr-FR"]), "fr");
    assert.equal(registry.detectSupportedLocale(["zh-TW"]), "en");
    assert.equal(registry.localeDirection("ar"), "rtl");
    assert.equal(registry.localeDirection("ur"), "rtl");
    assert.equal(registry.localeDirection("hi"), "ltr");
    assert.equal(registry.publicDocumentPath("fr", "legal/privacy"), "/fr/legal/privacy/");
    assert.equal(registry.localePath("zh-CN"), "/zh/");
  } finally {
    await loaded.cleanup();
  }
});

test("every added language fully translates authentication and workbench copy with matching placeholders", async () => {
  const [auth, workbench] = await Promise.all([
    bundled("app/auth-language.ts", "auth-ten-language"),
    bundled("app/workbench-language.ts", "workbench-ten-language"),
  ]);
  try {
    const authSafetyKeys = [
      "connectLoginTitle", "encryptedRelayNote", "codeSubtitle", "codeNotUploaded",
      "serverCannotDerive", "secureConnectionFailed", "invalidCredentials", "signOut",
    ];
    const workbenchSafetyKeys = [
      "approvalBoundary", "highRisk", "allowOnce", "reject", "networkTimeout",
      "networkUnavailable", "browserRevoked", "encryptedLinkDetail",
      "approvalSubmitFailed", "messageSendFailed",
    ];
    for (const locale of additionalLocales) {
      assert.deepEqual(
        auth.module.AUTH_TRANSLATION_COVERAGE[locale],
        { translated: auth.module.AUTH_COPY_KEYS.length, total: auth.module.AUTH_COPY_KEYS.length },
        `${locale} auth copy is complete`,
      );
      for (const key of auth.module.AUTH_COPY_KEYS) {
        assert.ok(
          Object.hasOwn(auth.module.AUTH_TRANSLATION_OVERRIDES[locale], key),
          `${locale}.${key} has an explicit translation`,
        );
        assert.ok(auth.module.authText(locale, key).trim(), `${locale}.${key} is not empty`);
        assert.deepEqual(
          placeholders(auth.module.authText(locale, key)),
          placeholders(auth.module.authText("en", key)),
          `${locale}.${key} preserves placeholders`,
        );
        if (key !== "proAccess") {
          assert.notEqual(
            auth.module.authText(locale, key),
            auth.module.authText("en", key),
            `${locale}.${key} does not fall back to English`,
          );
        }
      }
      for (const key of authSafetyKeys) {
        assert.notEqual(auth.module.authText(locale, key), auth.module.authText("en", key), `${locale}.${key}`);
      }
      for (const key of workbenchSafetyKeys) {
        assert.notEqual(
          workbench.module.workbenchText(locale, key),
          workbench.module.workbenchText("en", key),
          `${locale}.${key}`,
        );
      }
      assert.deepEqual(
        workbench.module.WORKBENCH_TRANSLATION_COVERAGE[locale],
        { translated: workbench.module.WORKBENCH_COPY_KEYS.length, total: workbench.module.WORKBENCH_COPY_KEYS.length },
        `${locale} workbench copy is complete`,
      );
      for (const key of workbench.module.WORKBENCH_COPY_KEYS) {
        assert.ok(
          Object.hasOwn(workbench.module.WORKBENCH_TRANSLATION_OVERRIDES[locale], key),
          `${locale}.${key} has an explicit workbench translation`,
        );
        assert.ok(workbench.module.workbenchText(locale, key).trim(), `${locale}.${key} is not empty`);
        assert.deepEqual(
          placeholders(workbench.module.workbenchText(locale, key)),
          placeholders(workbench.module.workbenchText("en", key)),
          `${locale}.${key} preserves workbench placeholders`,
        );
      }
    }
  } finally {
    await Promise.all([auth.cleanup(), workbench.cleanup()]);
  }
});

test("added marketing routes expose complete localized copy and hreflang metadata", async () => {
  const [localized, english, metadata, route, marketing, workbench, localizedSource] = await Promise.all([
    bundled("app/marketing-copy-localized.ts", "localized-marketing"),
    bundled("app/marketing-copy-en.ts", "english-marketing"),
    bundled("app/marketing-metadata.ts", "marketing-metadata"),
    readFile("app/[locale]/page.tsx", "utf8"),
    readFile("app/marketing-home.tsx", "utf8"),
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/marketing-copy-localized.ts", "utf8"),
  ]);
  try {
    const alternates = metadata.module.marketingLanguageAlternates();
    const englishLeaves = new Map(stringLeaves(english.module.enMarketingCopy));
    assert.equal(Object.keys(alternates).length, 11);
    assert.equal(alternates.ar, "https://relayune.giraffetree.cn/ar/");
    assert.equal(alternates["x-default"], "https://relayune.giraffetree.cn/");
    const englishMetadata = metadata.module.marketingMetadata("en");
    for (const locale of additionalLocales) {
      const copy = localized.module.localizedMarketingCopy(locale);
      const coverage = localized.module.MARKETING_TRANSLATION_COVERAGE[locale];
      assert.ok(copy.heroDescription.trim());
      assert.equal(copy.alternateLocalePath, "/en/");
      assert.notEqual(copy.alternateLocaleAria, "Switch to Chinese");
      assert.deepEqual(coverage, { translated: englishLeaves.size, total: englishLeaves.size });
      assert.equal(stringLeaves(copy).length, englishLeaves.size, `${locale} has every nested string leaf`);
      assert.deepEqual(
        Object.keys(copy),
        Object.keys(english.module.enMarketingCopy),
        `${locale} preserves the complete MarketingCopy shape`,
      );
      for (const [path, value] of [
        ["valueCards[0].description", copy.valueCards[0].description],
        ["heroScenarios[1].prompt", copy.heroScenarios[1].prompt],
        ["continuityMoments[1].summary", copy.continuityMoments[1].summary],
        ["securityPerspectives[1].description", copy.securityPerspectives[1].description],
      ]) {
        assert.notEqual(value, englishLeaves.get(path), `${locale}.${path} is deeply localized`);
      }
      for (const [path, value] of stringLeaves(copy)) {
        assert.ok(value.trim(), `${locale}.${path} is not empty`);
        assert.deepEqual(
          placeholders(value),
          placeholders(englishLeaves.get(path)),
          `${locale}.${path} preserves placeholders`,
        );
      }
      const result = metadata.module.marketingMetadata(locale);
      assert.notEqual(result.description, englishMetadata.description);
      assert.equal(result.alternates.canonical, `https://relayune.giraffetree.cn/${locale}/`);
      assert.deepEqual(result.alternates.languages, alternates);
    }
    assert.match(route, /const additionalLocales = \["hi", "es", "ar", "fr", "bn", "pt", "id", "ur"\]/);
    for (const source of [marketing, workbench]) {
      assert.match(source, /SUPPORTED_LOCALES\.map\(\(candidate\) =>/);
      assert.match(source, /<select/);
    }
    assert.doesNotMatch(localizedSource, /\.\.\.enMarketingCopy/);
    assert.match(localizedSource, /Missing \$\{locale\} marketing translation for \$\{path\}/);
  } finally {
    await Promise.all([localized.cleanup(), english.cleanup(), metadata.cleanup()]);
  }
});

test("static localized marketing documents declare language, direction, canonical, and hreflang", async () => {
  for (const locale of additionalLocales) {
    const html = await readFile(join("out", locale, "index.html"), "utf8");
    const direction = locale === "ar" || locale === "ur" ? "rtl" : "ltr";
    assert.match(html, new RegExp(`^<!DOCTYPE html><html lang="${locale}" dir="${direction}"`));
    assert.match(html, new RegExp(`<link rel="canonical" href="https://relayune.giraffetree.cn/${locale}/"`));
    for (const alternate of locales) {
      assert.match(html, new RegExp(`hrefLang="${alternate}"`));
    }
    assert.match(html, /hrefLang="x-default"/);
  }
});
