import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("every client shows its release and the real minimum compatible peer", async () => {
  const [
    rootPackage,
    compatibility,
    releaseAssets,
    web,
    webCopy,
    desktop,
    desktopCopy,
    mobileConfig,
    mobilePairing,
    mobileDevice,
  ] = await Promise.all([
    readFile("package.json", "utf8").then(JSON.parse),
    readFile("shared/release-compatibility.ts", "utf8"),
    readFile("app/release-assets.ts", "utf8"),
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/workbench-language.ts", "utf8"),
    readFile("desktop/src/main.ts", "utf8"),
    readFile("desktop/src/i18n.ts", "utf8"),
    readFile("mobile/lib/src/config.dart", "utf8"),
    readFile("mobile/lib/src/ui/pairing_screen.dart", "utf8"),
    readFile("mobile/lib/src/ui/workbench_screen.dart", "utf8"),
  ]);

  const minimumClient = capture(
    compatibility,
    /minimumClientVersion: "([^"]+)"/,
  );
  const minimumDesktops = [
    ...compatibility.matchAll(/minimumDesktopVersion: "([^"]+)"/g),
  ].map((match) => match[1]);
  assert.equal(minimumClient, "0.3.6");
  assert.deepEqual(minimumDesktops, ["0.3.9", "0.3.9"]);
  assert.ok(compareVersions(rootPackage.version, minimumClient) >= 0);
  assert.ok(
    minimumDesktops.every(
      (minimum) => compareVersions(rootPackage.version, minimum) >= 0,
    ),
  );

  assert.equal(
    capture(releaseAssets, /RELAYUNE_WEB_RELEASE_VERSION = "([^"]+)"/),
    rootPackage.version,
    "the Web release follows its own package version when Android ships separately",
  );
  assert.match(web, /RELAYUNE_WEB_RELEASE_VERSION/);
  assert.match(
    web,
    /RELAYUNE_COMPATIBILITY\.web\.minimumDesktopVersion/,
  );
  assert.match(webCopy, /productVersion: "Relayune \{platform\} \{version\}"/);
  assert.match(webCopy, /电脑端最低兼容版本：\{version\}/);

  assert.match(desktop, /appVersion\.textContent = `v\$\{bootstrap\?\.version/);
  assert.doesNotMatch(desktop, /app-compatibility|minimumClientVersion/);
  assert.match(desktopCopy, /Web \/ 手机端最低兼容版本 \{version\}/);

  assert.match(
    mobileConfig,
    /minimumCompatibleDesktopVersion = '0\.3\.9'/,
  );
  for (const mobileSurface of [mobilePairing, mobileDevice]) {
    assert.match(mobileSurface, /Relayune Mobile/);
    assert.match(mobileSurface, /RelayConfig\.minimumCompatibleDesktopVersion/);
  }
});

function capture(source, pattern) {
  const match = source.match(pattern);
  assert.ok(match, `expected ${pattern} to match`);
  return match[1];
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
