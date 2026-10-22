import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const locales = ["en", "zh-CN", "hi", "es", "ar", "fr", "bn", "pt", "id", "ur"];

test("web release assets expose the Android notes in all ten product languages", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-release-assets-"));
  try {
    const bundle = join(temporary, "release-assets.mjs");
    await build({
      entryPoints: ["app/release-assets.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: bundle,
      logLevel: "silent",
    });
    const assets = await import(`${pathToFileURL(bundle).href}?${Date.now()}`);
    const manifest = JSON.parse(await readFile("public/updates/android.json", "utf8"));

    assert.deepEqual(Object.keys(assets.RELAYUNE_ANDROID_RELEASE.notes), locales);
    for (const locale of locales) {
      const expected = parseNotes(manifest.notes[locale]);
      assert.deepEqual(assets.androidReleaseNotes(locale), expected, `${locale} notes`);
      if (locale !== "en") {
        assert.notDeepEqual(
          assets.androidReleaseNotes(locale),
          assets.androidReleaseNotes("en"),
          `${locale} must not silently show English notes`,
        );
      }
    }

    assert.deepEqual(
      assets.androidReleaseNotes("de"),
      assets.androidReleaseNotes("en"),
      "an unsupported locale has an explicit English fallback",
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

function parseNotes(source) {
  const [title, ...items] = source
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    title,
    items: items.map((item) => item.replace(/^-\s*/, "")),
  };
}
