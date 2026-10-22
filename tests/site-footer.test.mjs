import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicPages = [
  "../out/index.html",
  "../out/zh/changelog/index.html",
  "../out/en/changelog/index.html",
  "../out/zh/legal/terms/index.html",
  "../out/zh/legal/privacy/index.html",
  "../out/en/legal/terms/index.html",
  "../out/en/legal/privacy/index.html",
];

test("每个公开页面的页脚都提供有效客服邮箱", async () => {
  for (const page of publicPages) {
    const html = await readFile(new URL(page, import.meta.url), "utf8");

    assert.match(html, /<footer[^>]*>.*mailto:giraffetree1@gmail\.com.*<\/footer>/s);
    assert.match(html, /giraffetree1@gmail\.com/);
  }
});

test("官网首页页脚提供服务条款与隐私政策入口", async () => {
  const html = await readFile(
    new URL("../out/index.html", import.meta.url),
    "utf8",
  );

  assert.match(
    html,
    /<footer[^>]*>.*href="\/zh\/legal\/terms\/"[^>]*>服务条款<\/a>.*href="\/zh\/legal\/privacy\/"[^>]*>隐私政策<\/a>.*<\/footer>/s,
  );
});

test("官网在所有语言中只发布已签名的平台下载入口", async () => {
  const [releaseSource, publishedDesktopUpdate, publishedAndroidUpdate] = await Promise.all([
    readFile(new URL("../app/release-assets.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/updates/latest.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../public/updates/android.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const expectedFiles = [
    `Relayune-${publishedDesktopUpdate.version}-macOS-universal.dmg`,
    `Relayune-${publishedAndroidUpdate.version_name}-Android.apk`,
  ];
  const unpublishedWindows = `Relayune-${publishedDesktopUpdate.version}-Windows-x64-setup.exe`;

  assert.match(
    releaseSource,
    new RegExp(`RELAYUNE_RELEASE_VERSION = "${publishedAndroidUpdate.version_name.replaceAll(".", "\\.")}"`),
  );
  assert.match(
    releaseSource,
    new RegExp(`RELAYUNE_MACOS_RELEASE_VERSION = "${publishedDesktopUpdate.version.replaceAll(".", "\\.")}"`),
  );
  for (const page of ["../out/index.html", "../out/en/index.html"]) {
    const html = await readFile(new URL(page, import.meta.url), "utf8");
    for (const file of expectedFiles) {
      assert.ok(html.includes(file), `${page} is missing ${file}`);
    }
    assert.ok(!html.includes(unpublishedWindows), `${page} publishes an unsigned Windows installer`);
    assert.match(html, /Windows (?:准备中|preparing)/i);
    assert.match(html, /iPhone \/ iPad/);
  }
});
