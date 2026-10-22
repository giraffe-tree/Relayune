import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("desktop sources and each platform's public release stay internally consistent", async () => {
  const [
    rootPackage,
    rootPackageLock,
    desktopPackage,
    desktopPackageLock,
    tauriConfig,
    cargo,
    cargoLock,
    mobile,
    assets,
    publishedDesktopUpdate,
    publishedAndroidUpdate,
    codexAdapters,
    kimiAdapter,
    iosProject,
    iosExport,
    iosLaunchScreen,
    iosPodfile,
    iosFrameworkInfo,
  ] =
    await Promise.all([
      readFile("package.json", "utf8").then(JSON.parse),
      readFile("package-lock.json", "utf8").then(JSON.parse),
      readFile("desktop/package.json", "utf8").then(JSON.parse),
      readFile("desktop/package-lock.json", "utf8").then(JSON.parse),
      readFile("desktop/src-tauri/tauri.conf.json", "utf8").then(JSON.parse),
      readFile("desktop/src-tauri/Cargo.toml", "utf8"),
      readFile("desktop/src-tauri/Cargo.lock", "utf8"),
      readFile("mobile/pubspec.yaml", "utf8"),
      readFile("app/release-assets.ts", "utf8"),
      readFile("public/updates/latest.json", "utf8").then(JSON.parse),
      readFile("public/updates/android.json", "utf8").then(JSON.parse),
      readFile("relay/codex-adapters.mjs", "utf8"),
      readFile("relay/kimi-adapter.mjs", "utf8"),
      readFile("mobile/ios/Runner.xcodeproj/project.pbxproj", "utf8"),
      readFile("mobile/ios/ExportOptions.plist", "utf8"),
      readFile("mobile/ios/Runner/Base.lproj/LaunchScreen.storyboard", "utf8"),
      readFile("mobile/ios/Podfile", "utf8"),
      readFile("mobile/ios/Flutter/AppFrameworkInfo.plist", "utf8"),
    ]);

  const version = rootPackage.version;
  // Local source bumps do not authorize public manifests or advertise assets
  // that have not been uploaded. Published platform versions remain consistent
  // with their own artifacts and may lag the next verified source version.
  for (const published of [publishedDesktopUpdate.version, publishedAndroidUpdate.version_name]) {
    assert.ok(compareVersions(published, version) <= 0, "public release cannot be newer than source");
  }
  assert.equal(rootPackageLock.version, version);
  assert.equal(rootPackageLock.packages[""].version, version);
  assert.equal(desktopPackage.version, version);
  assert.equal(desktopPackageLock.version, version);
  assert.equal(desktopPackageLock.packages[""].version, version);
  assert.equal(tauriConfig.version, version);
  assert.match(cargo, new RegExp(`name = "relayune-desktop"\\nversion = "${escaped(version)}"`));
  assert.match(
    cargoLock,
    new RegExp(
      `\\[\\[package\\]\\]\\nname = "relayune-desktop"\\nversion = "${escaped(version)}"`,
    ),
  );
  assert.equal(mobile.match(/^version: ([^+]+)\+/m)?.[1], version, "all platform source versions stay aligned");
  const sourceBuild = Number(mobile.match(/^version: [^+]+\+(\d+)$/m)?.[1]);
  assert.ok(sourceBuild >= publishedAndroidUpdate.version_code);
  if (version === publishedAndroidUpdate.version_name) {
    assert.equal(sourceBuild, publishedAndroidUpdate.version_code);
  }
  assert.match(
    assets,
    new RegExp(
      `RELAYUNE_RELEASE_VERSION = "${escaped(publishedAndroidUpdate.version_name)}"`,
    ),
  );
  assert.match(
    assets,
    new RegExp(
      `RELAYUNE_MACOS_RELEASE_VERSION = "${escaped(publishedDesktopUpdate.version)}"`,
    ),
  );
  for (const adapter of [codexAdapters, kimiAdapter]) {
    const advertisedVersions = [
      ...adapter.matchAll(/clientInfo:\s*\{[\s\S]{0,180}?version: "([^"]+)"/g),
    ].map((match) => match[1]);
    assert.ok(advertisedVersions.length > 0, "adapter advertises a client version");
    assert.deepEqual(
      [...new Set(advertisedVersions)],
      [version],
      "adapter clientInfo versions match the release",
    );
  }
  assert.match(
    assets,
    /Relayune-\$\{RELAYUNE_MACOS_RELEASE_VERSION\}-macOS-universal\.dmg/,
  );
  assert.match(
    assets,
    /Relayune-\$\{RELAYUNE_RELEASE_VERSION\}-Android\.apk/,
  );
  assert.doesNotMatch(
    assets,
    /Windows-x64-setup\.exe/,
    "unsigned Windows installers must not be advertised as release assets",
  );

  assert.equal(
    [...iosProject.matchAll(/PROVISIONING_PROFILE_SPECIFIER = "Relayune App Store 0\.2\.2";/g)].length,
    2,
    "iOS Release and Profile builds use the reviewed App Store profile",
  );
  assert.equal(
    [...iosProject.matchAll(/CODE_SIGN_STYLE = Manual;/g)].length,
    6,
    "iOS app and both extensions use manual distribution signing in Release and Profile",
  );
  for (const block of iosProject.matchAll(/isa = XCBuildConfiguration;[\s\S]*?\n\t\t};/g)) {
    if (block[0].includes("CODE_SIGN_STYLE = Manual;")) {
      assert.doesNotMatch(block[0], /CODE_SIGN_STYLE = Automatic;/, "manual signing must not be overridden in the same configuration");
    }
  }
  for (const profile of ["Relayune Notification Service App Store", "Relayune Live Activity App Store"]) {
    assert.equal(iosProject.split(`PROVISIONING_PROFILE_SPECIFIER = "${profile}";`).length - 1, 2);
    assert.ok(iosExport.includes(`<string>${profile}</string>`));
  }
  for (const bundle of ["cn.giraffetree.relayune.NotificationService", "cn.giraffetree.relayune.LiveActivity"]) {
    assert.ok(iosExport.includes(`<key>${bundle}</key>`));
  }
  const distributionFingerprint = "FD5AF2D95E9C8FFFEAE4864F943BD349FAD9B811";
  assert.equal(iosProject.split(`"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "${distributionFingerprint}";`).length - 1, 6);
  assert.ok(iosExport.includes(`<string>${distributionFingerprint}</string>`));
  assert.match(iosExport, /<string>app-store-connect<\/string>/);
  assert.match(iosExport, /<key>cn\.giraffetree\.relayune<\/key>/);
  assert.match(iosExport, /<string>Relayune App Store 0\.2\.2<\/string>/);
  assert.match(iosLaunchScreen, /image="LaunchWordmark"/);
  const wordmark = JSON.parse(await readFile("mobile/ios/Runner/Assets.xcassets/LaunchWordmark.imageset/Contents.json", "utf8"));
  const imageFiles = wordmark.images.filter(image => image.filename);
  assert.ok(imageFiles.length > 0);
  for (const image of imageFiles) {
    assert.ok(!image.filename.includes("/"));
    assert.ok((await readFile(`mobile/ios/Runner/Assets.xcassets/LaunchWordmark.imageset/${image.filename}`)).length > 0);
  }
  assert.doesNotMatch(iosLaunchScreen, /LaunchImage/);
  assert.match(iosPodfile, /platform :ios, '15\.0'/);
  assert.match(
    iosFrameworkInfo,
    /<key>MinimumOSVersion<\/key>\s*<string>15\.0<\/string>/,
  );
  const deploymentTargets = [...iosProject.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([0-9.]+);/g)].map(match => Number(match[1]));
  assert.ok(deploymentTargets.length >= 3);
  assert.ok(deploymentTargets.every(version => version >= 15), "all app and extension targets require iOS 15 or later");
  assert.ok(deploymentTargets.includes(15), "the main app still supports iOS 15");
  assert.ok(deploymentTargets.includes(16.2), "ActivityKit extension uses its supported minimum");
  assert.doesNotMatch(iosProject, /IPHONEOS_DEPLOYMENT_TARGET = 12\.0;/);
});

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compareVersions(a, b) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  assert.ok(left.length === 3 && right.length === 3 && [...left, ...right].every(Number.isInteger));
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}
