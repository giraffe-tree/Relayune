import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const locales = ["hi", "es", "ar", "fr", "bn", "pt", "id", "ur"];
const placeholders = (value) => [...String(value).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();

async function bundled(entry, name, external = []) {
  const temporary = await mkdtemp(join(tmpdir(), `relayune-${name}-`));
  const outfile = join(temporary, `${name}.mjs`);
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    external: [...external, "/brand/*"],
    loader: { ".css": "empty" },
    logLevel: "silent",
  });
  return { module: await import(`${pathToFileURL(outfile).href}?${Date.now()}`), cleanup: () => rm(temporary, { recursive: true, force: true }) };
}

function stringLeaves(value, path = "") {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => stringLeaves(item, `${path}[${index}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => stringLeaves(item, path ? `${path}.${key}` : key));
  return [];
}

test("all locale catalogs are complete and preserve interpolation placeholders", async () => {
  const [auth, workbench, marketing, english] = await Promise.all([
    bundled("app/auth-language.ts", "auth-public-coverage"),
    bundled("app/workbench-language.ts", "workbench-public-coverage"),
    bundled("app/marketing-copy-localized.ts", "marketing-public-coverage"),
    bundled("app/marketing-copy-en.ts", "marketing-english"),
  ]);
  try {
    for (const locale of locales) {
      for (const key of auth.module.AUTH_COPY_KEYS) {
        assert.deepEqual(placeholders(auth.module.authText(locale, key)), placeholders(auth.module.authText("en", key)), `${locale}.auth.${key}`);
      }
      for (const key of workbench.module.WORKBENCH_COPY_KEYS) {
        assert.deepEqual(placeholders(workbench.module.workbenchText(locale, key)), placeholders(workbench.module.workbenchText("en", key)), `${locale}.workbench.${key}`);
      }
      const localized = marketing.module.localizedMarketingCopy(locale);
      const baseline = new Map(stringLeaves(english.module.enMarketingCopy));
      for (const [path, value] of stringLeaves(localized)) {
        if (baseline.has(path)) assert.deepEqual(placeholders(value), placeholders(baseline.get(path)), `${locale}.marketing.${path}`);
      }
      assert.deepEqual(auth.module.AUTH_TRANSLATION_COVERAGE[locale], {
        translated: auth.module.AUTH_COPY_KEYS.length,
        total: auth.module.AUTH_COPY_KEYS.length,
      });
      assert.deepEqual(workbench.module.WORKBENCH_TRANSLATION_COVERAGE[locale], { translated: workbench.module.WORKBENCH_COPY_KEYS.length, total: workbench.module.WORKBENCH_COPY_KEYS.length });
      assert.deepEqual(marketing.module.MARKETING_TRANSLATION_COVERAGE[locale], { translated: baseline.size, total: baseline.size });
    }
  } finally {
    await Promise.all([auth.cleanup(), workbench.cleanup(), marketing.cleanup(), english.cleanup()]);
  }
});

test("changelog UI has full locale objects", async () => {
  const changelog = await bundled("app/changelog/changelog-page.tsx", "changelog-locales");
  try {
    for (const locale of locales) {
      const englishChangelog = changelog.module.CHANGELOG_COPY.en;
      const localizedChangelog = changelog.module.CHANGELOG_COPY[locale];
      assert.deepEqual(Object.keys(localizedChangelog), Object.keys(englishChangelog));
      assert.ok(Object.keys(englishChangelog).filter((key) => localizedChangelog[key] !== englishChangelog[key]).length >= 14);
    }
  } finally {
    await changelog.cleanup();
  }
});

test("localized public paths render metadata and mark legal bodies as English", async () => {
  for (const locale of locales) {
    for (const page of ["changelog"]) {
      const html = await readFile(join("out", locale, page, "index.html"), "utf8");
      assert.match(html, new RegExp(`^<!DOCTYPE html><html lang="${locale}"`));
      assert.match(html, new RegExp(`<link rel="canonical" href="https://relayune.giraffetree.cn/${locale}/${page}/"`));
    }
    for (const kind of ["terms", "privacy"]) {
      const html = await readFile(join("out", locale, "legal", kind, "index.html"), "utf8");
      assert.match(html, new RegExp(`^<!DOCTYPE html><html lang="${locale}"`));
      assert.match(html, /English legal text notice/);
      assert.match(html, /<article[^>]+lang="en" dir="ltr"/);
      assert.match(html, new RegExp(`<link rel="canonical" href="https://relayune.giraffetree.cn/${locale}/legal/${kind}/"`));
    }
  }
});
