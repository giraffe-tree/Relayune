import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  androidManifestNotes,
  androidReleaseNoteLocales,
  assertProductionMonotonicity,
  assertPublishedAndroidSourceCompatibility,
  expectedAndroidAssetUrl,
  parseMobileVersion,
  sha256File,
  validateAndroidUpdateManifest,
} from "../scripts/prepare-android-update-manifest.mjs";

test("public Android update manifest matches the current mobile release contract", async () => {
  const manifest = await readFile("public/updates/android.json", "utf8").then(JSON.parse);
  const [pubspec, releaseNotes, generator, buildSource] = await Promise.all([
    readFile("mobile/pubspec.yaml", "utf8"),
    readFile(`release-notes/${manifest.version_name}.json`, "utf8").then(JSON.parse),
    readFile("scripts/prepare-android-update-manifest.mjs", "utf8"),
    readFile("scripts/verify-official-downloads.mjs", "utf8"),
  ]);
  const mobileVersion = parseMobileVersion(pubspec);

  assert.equal(validateAndroidUpdateManifest(manifest), manifest);
  assert.deepEqual(Object.keys(manifest), [
    "version_name",
    "version_code",
    "url",
    "sha256",
    "size",
    "published_at",
    "notes",
  ]);
  assertPublishedAndroidSourceCompatibility(manifest, mobileVersion);
  assert.equal(manifest.url, expectedAndroidAssetUrl(manifest.version_name));
  assert.notEqual(manifest.sha256, "0".repeat(64));
  assert.ok(manifest.size > 1_000_000, "a release manifest must identify a real APK artifact");
  assert.equal(manifest.published_at, releaseNotes.publishedAt);
  assert.deepEqual(Object.keys(manifest.notes), androidReleaseNoteLocales);
  assert.deepEqual(manifest.notes, androidManifestNotes(releaseNotes));
  assert.deepEqual(Object.keys(releaseNotes.copy).sort(), [
    "ar", "bn", "en", "es", "fr", "hi", "id", "pt", "ur", "zh",
  ]);
  for (const locale of androidReleaseNoteLocales) {
    const copyLocale = locale === "zh-CN" ? "zh" : locale;
    const copy = releaseNotes.copy[copyLocale];
    assert.ok(manifest.notes[locale].includes(copy.title), `${locale} title`);
    for (const item of copy.items) {
      assert.ok(manifest.notes[locale].includes(item), `${locale} release-note item`);
    }
    if (locale !== "en") {
      assert.notEqual(manifest.notes[locale], manifest.notes.en, `${locale} is localized`);
    }
  }

  assert.match(generator, /apksigner[\s\S]*?verify[\s\S]*?--print-certs/);
  assert.match(generator, /Verified using v\(\?:2\|3\|3\\\.1\|4\) scheme/);
  assert.match(
    generator,
    /ce551c4cd78cd06dfb9c4c93c2ac8609388658e441a781da35ca7e1bda746fe9/,
  );
  assert.match(generator, /aapt[\s\S]*?dump[\s\S]*?badging/);
  assert.match(buildSource, /updates", "android\.json"/);
  assert.match(buildSource, /validateAndroidUpdateManifest\(androidUpdateManifest\)/);
  assert.match(buildSource, /assertPublishedAndroidSourceCompatibility\(androidUpdateManifest, mobileVersion\)/);
});

test("source preparation permits existing releases and rejects future or mismatched public builds", () => {
  const source = { versionName: '0.3.29', versionCode: 39 };
  assertPublishedAndroidSourceCompatibility(manifestFixture('0.3.29', 39), source);
  assertPublishedAndroidSourceCompatibility(manifestFixture('0.3.28', 38), source);
  for (const [version, build] of [['0.3.30', 40], ['0.3.29', 38], ['0.3.28', 40]]) {
    assert.throws(() => assertPublishedAndroidSourceCompatibility(manifestFixture(version, build), source), /must match/);
  }
});

test("Android manifest requires all ten localized note values and rejects unknown keys", () => {
  const valid = manifestFixture("0.3.0", 30);
  assert.equal(validateAndroidUpdateManifest(valid), valid);

  const missingUrdu = structuredClone(valid);
  delete missingUrdu.notes.ur;
  assert.throws(
    () => validateAndroidUpdateManifest(missingUrdu),
    /notes keys must be exactly/,
  );

  const unknownLocale = structuredClone(valid);
  unknownLocale.notes.de = "Aktualisierung";
  assert.throws(
    () => validateAndroidUpdateManifest(unknownLocale),
    /notes keys must be exactly/,
  );

  const emptyBengali = structuredClone(valid);
  emptyBengali.notes.bn = "  ";
  assert.throws(
    () => validateAndroidUpdateManifest(emptyBengali),
    /notes\.bn must be non-empty/,
  );
});

test("manifest hashing reads artifact bytes instead of accepting a supplied placeholder", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "relayune-android-manifest-"));
  const artifact = path.join(temporary, "fixture.apk");
  const bytes = Buffer.from("signed-artifact-bytes-for-hash-contract\n", "utf8");
  try {
    await writeFile(artifact, bytes);
    assert.equal(
      await sha256File(artifact),
      createHash("sha256").update(bytes).digest("hex"),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("production Android manifests are monotonic and same-version publication is immutable", () => {
  const current = manifestFixture("0.2.7", 7);
  assert.doesNotThrow(() => assertProductionMonotonicity(current, current));
  assert.doesNotThrow(() =>
    assertProductionMonotonicity(manifestFixture("0.2.8", 8), current),
  );

  assert.throws(
    () => assertProductionMonotonicity(manifestFixture("0.2.6", 6), current),
    /Refusing Android update rollback/,
  );
  assert.throws(
    () => assertProductionMonotonicity(manifestFixture("0.2.7", 8), current),
    /Refusing Android update rollback/,
  );
  assert.throws(
    () =>
      assertProductionMonotonicity(
        { ...current, sha256: "f".repeat(64) },
        current,
      ),
    /Refusing to mutate an already published Android version_code/,
  );
});

test("Nginx serves the mutable Android pointer without the generic immutable update cache", async () => {
  const nginx = await readFile("deploy/relayune.giraffetree.cn.conf", "utf8");
  const exact = nginx.match(
    /location\s+=\s+\/updates\/android\.json\s*\{([\s\S]*?)\n\s*\}/,
  );
  assert.ok(exact, "an exact Android update manifest location is required");
  assert.match(exact[1], /try_files\s+\$uri\s+=404;/);
  assert.match(exact[1], /default_type\s+application\/json;/);
  assert.match(exact[1], /add_header\s+Cache-Control\s+"no-store";/);
  assert.doesNotMatch(exact[1], /immutable|expires/);

  const generic = nginx.match(/location\s+\/updates\/\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(generic, "versioned updater assets keep their immutable cache policy");
  assert.match(generic[1], /add_header\s+Cache-Control\s+"public, immutable";/);
});

function manifestFixture(versionName, versionCode) {
  return {
    version_name: versionName,
    version_code: versionCode,
    url: expectedAndroidAssetUrl(versionName),
    sha256: "a".repeat(64),
    size: 123,
    published_at: "2026-08-11T00:00:00.000Z",
    notes: Object.fromEntries(
      androidReleaseNoteLocales.map((locale) => [locale, `${locale} update`]),
    ),
  };
}
