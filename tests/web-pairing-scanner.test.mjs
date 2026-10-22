import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

async function importScanner() {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-web-scanner-"));
  const outfile = join(temporary, "pairing-scanner.mjs");
  await build({
    entryPoints: ["app/pairing-scanner.tsx"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    external: ["qr-scanner"],
    logLevel: "silent",
  });
  return {
    entry: await import(`${pathToFileURL(outfile).href}?${Date.now()}`),
    cleanup: () => rm(temporary, { recursive: true, force: true }),
  };
}

test("Web scanner accepts only the canonical camera-only pairing envelope", async () => {
  const bundled = await importScanner();
  try {
    const pairingId = `pair_${"A".repeat(43)}`;
    const payload = `relayune-pairing:v1:${pairingId}:ABCDEFGH`;
    assert.deepEqual(bundled.entry.parsePairingQrPayload(payload), {
      pairingId,
      code: "ABCDEFGH",
    });
    for (const invalid of [
      `https://relayune.giraffetree.cn/?pair=${pairingId}&code=ABCDEFGH`,
      `relayune://pair?id=${pairingId}&code=ABCDEFGH`,
      `relayune-pairing:v1:${pairingId}:ABCD-EFGH`,
      `relayune-pairing:v1:${pairingId}:abcdefgh`,
      `relayune-pairing:v1:${pairingId}:ABCDEFGI`,
      `relayune-pairing:v2:${pairingId}:ABCDEFGH`,
      `${payload}extra`,
      `relayune-pairing:v1:${"A".repeat(120)}:ABCDEFGH`,
    ]) {
      assert.equal(bundled.entry.parsePairingQrPayload(invalid), null);
    }
  } finally {
    await bundled.cleanup();
  }
});

test("Web camera scanning is local, lazy, bounded, and always has a manual fallback", async () => {
  const [scanner, page, language, styles, rootPackage, lock] = await Promise.all([
    readFile("app/pairing-scanner.tsx", "utf8"),
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/auth-language.ts", "utf8"),
    readFile("app/workbench.css", "utf8"),
    readFile("package.json", "utf8").then(JSON.parse),
    readFile("package-lock.json", "utf8").then(JSON.parse),
  ]);

  assert.equal(rootPackage.dependencies["qr-scanner"], "^1.4.2");
  assert.equal(lock.packages["node_modules/qr-scanner"].version, "1.4.2");
  assert.match(scanner, /await import\("qr-scanner"\)/);
  assert.doesNotMatch(scanner, /^import QrScanner from "qr-scanner"/m);
  assert.match(scanner, /preferredCamera: "environment"/);
  assert.match(scanner, /<video ref=\{videoRef\} autoPlay muted playsInline/);
  assert.match(scanner, /window\.isSecureContext/);
  assert.match(scanner, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(scanner, /scannerRef\.current\?\.destroy\(\)/);
  assert.match(scanner, /for \(const track of stream\.getTracks\(\)\) track\.stop\(\)/);
  assert.match(
    scanner,
    /const stopWhenHidden = \(\) => \{[\s\S]*?document\.visibilityState === "hidden"[\s\S]*?closeScanner\(false\)/,
  );
  assert.match(scanner, /const stopForPageHide = \(\) => closeScanner\(false\)/);
  assert.match(scanner, /addEventListener\("visibilitychange", stopWhenHidden\)/);
  assert.match(scanner, /addEventListener\("pagehide", stopForPageHide\)/);
  assert.doesNotMatch(
    scanner,
    /document\.visibilityState === "hidden" \|\| dialogRef\.current\?\.open/,
    "returning to a still-open visible dialog must not be mistaken for a background transition",
  );
  assert.match(scanner, /onCancel=\{\(event\) =>/);
  assert.match(scanner, /onClose=\{stopCamera\}/);
  assert.match(scanner, /onDecodeError: \(\) => \{\}/);
  assert.doesNotMatch(
    scanner,
    /console\.(?:log|error|warn|info|debug)\s*\(|fetch\(|localStorage|sessionStorage|clipboard/i,
  );
  assert.doesNotMatch(scanner, /setStatusKey\([^)]*result\.data/);
  assert.match(scanner, /authText\(locale, "useManualCode"\)/);
  assert.match(language, /cameraPermissionDenied: "相机权限未开启/);
  assert.match(language, /cameraPermissionDenied: "Camera access is blocked/);
  assert.match(language, /cameraNotFound: "未找到可用相机/);
  assert.match(language, /cameraInUse: "相机正被其他应用使用/);
  assert.match(styles, /\.pairing-scanner-dialog::backdrop/);
  assert.match(styles, /\.pairing-scanner-close[\s\S]{0,160}width: 44px/);

  assert.match(
    page,
    /function connectScannedPairing\(pairing: ScannedPairing\)[\s\S]*?const formattedCode = pairingCodeInput\(pairing\.code\)[\s\S]*?connectPair\(pairing\.pairingId, formattedCode\)/,
  );
  const scannedHandoff = page.slice(
    page.indexOf("function connectScannedPairing"),
    page.indexOf("async function connectPair"),
  );
  assert.doesNotMatch(
    scannedHandoff,
    /setPairingCode|\.value\s*=|dataset\.|localStorage|sessionStorage/,
    "the optically transferred short code must move directly into PAKE without entering DOM-backed state",
  );
  assert.match(
    page,
    /async function connectPair\([\s\S]*?requestedPairingId[\s\S]*?requestedPairingCode[\s\S]*?respondToPairing\([\s\S]*?targetPairingId,[\s\S]*?requestedPairingCode/,
    "a valid scan must explicitly carry both values into PAKE instead of waiting for React state",
  );
  assert.equal((page.match(/<PairingScanner/g) ?? []).length, 3);
});

test("the production scanner bundle emits its decoder as a self-hosted worker chunk", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-scanner-chunks-"));
  try {
    const result = await build({
      entryPoints: ["app/pairing-scanner.tsx"],
      bundle: true,
      splitting: true,
      platform: "browser",
      format: "esm",
      outdir: temporary,
      external: ["react"],
      metafile: true,
      write: false,
      logLevel: "silent",
    });
    const workerOutput = result.outputFiles.find((file) =>
      file.path.includes("qr-scanner-worker.min-"),
    );
    assert.ok(workerOutput, "the ZXing fallback worker must be emitted locally");
    assert.ok(workerOutput.contents.byteLength > 40_000);
    assert.match(new TextDecoder().decode(workerOutput.contents), /createWorker/);

    const scannerModule = result.outputFiles.find((file) =>
      file.path.endsWith("pairing-scanner.js"),
    );
    assert.ok(scannerModule);
    const scannerSource = new TextDecoder().decode(scannerModule.contents);
    assert.match(scannerSource, /import\("\.\/qr-scanner\.min-/);
    assert.doesNotMatch(scannerSource, /https?:\/\//);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
