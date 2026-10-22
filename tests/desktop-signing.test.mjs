import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

function bracedSource(source, start) {
  assert.ok(start >= 0, "missing source block marker");
  const bodyStart = source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, "expected a braced source block");
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail("unterminated source block");
}

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  return bracedSource(source, start);
}

test("daily macOS builds sign with a fixed identity without entering publication", async () => {
  const { localMacBuildPlan, localBuildEnvironment } = await import("../desktop/scripts/local-macos-build.mjs");
  const config = JSON.parse(await readFile("desktop/src-tauri/tauri.conf.json", "utf8"));
  const pkg = JSON.parse(await readFile("desktop/package.json", "utf8"));
  assert.equal(pkg.scripts["desktop:build:macos"], "node scripts/local-macos-build.mjs");
  assert.equal(pkg.scripts["desktop:dev:macos"], "node scripts/local-macos-build.mjs --debug");
  for (const debug of [false, true]) {
    const plan = localMacBuildPlan("/test/desktop", config, debug);
    const build = plan.commands.find(([command]) => command === "tauri")[1];
    assert.ok(build.includes("--no-sign"), "Tauri must not enter automatic notarization");
    assert.equal(build[build.indexOf("--bundles") + 1], "app");
    const signatures = plan.commands.filter(([cmd, args]) => cmd === "codesign" && args.includes("--sign"));
    assert.equal(signatures.length, 2);
    assert.deepEqual(signatures.map(([, args]) => args[args.indexOf("--identifier") + 1]), ["relayune-core", config.identifier]);
    assert.ok(signatures.every(([, args]) => args[args.indexOf("--sign") + 1] === config.bundle.macOS.signingIdentity));
    assert.ok(plan.commands.at(-1)[1].includes("--verify"));
    assert.doesNotMatch(JSON.stringify(plan.commands), /notarytool|stapler|submit|upload|app,dmg/);
  }
  assert.deepEqual(localBuildEnvironment({PATH: "bin", PKG_EXECPATH: "/some/relayune-core", APPLE_ID: "secret", APPLE_API_KEY: "secret", APPLE_SIGNING_IDENTITY: "-", TAURI_SIGNING_PRIVATE_KEY: "secret"}), {PATH: "bin"});
  assert.throws(() => localMacBuildPlan("/test", {bundle: {macOS: {signingIdentity: "-"}}}), /unsigned fallback/);
});

test("desktop release produces a signed universal DMG", async () => {
  const [rootPackage, desktopPackage, releaseScript, sidecarScript] = await Promise.all([
    readFile("package.json", "utf8").then(JSON.parse),
    readFile("desktop/package.json", "utf8").then(JSON.parse),
    readFile("scripts/build-desktop-release.mjs", "utf8"),
    readFile("desktop/scripts/prepare-sidecar.mjs", "utf8"),
  ]);
  const rootRelease = rootPackage.scripts?.["desktop:release"];
  const desktopRelease = desktopPackage.scripts?.["desktop:release"];

  assert.equal(rootRelease, "node scripts/build-desktop-release.mjs");
  assert.match(releaseScript, /\["--prefix", "desktop", "run", "desktop:release"\]/);
  assert.match(releaseScript, /bundle[\s\S]*macos[\s\S]*Relayune\.app/);
  assert.match(releaseScript, /codesign[\s\S]*--verify[\s\S]*--deep[\s\S]*--strict/);
  assert.match(releaseScript, /stapler[\s\S]*validate[\s\S]*appPath/);
  assert.match(releaseScript, /smokeUniversalSidecar\(appPath\)/);
  assert.match(releaseScript, /\["-arm64", "-x86_64"\]/);
  assert.match(desktopRelease, /prepare:sidecar -- --target universal-apple-darwin/);
  assert.match(
    desktopRelease,
    /--pre-sign-for-tauri/,
    "the pkg payload layout must be settled with the production signature before Tauri signs the app",
  );
  assert.match(desktopRelease, /tauri build --target universal-apple-darwin --bundles app,dmg/);
  assert.doesNotMatch(desktopRelease, /--no-sign/);
  assert.match(sidecarScript, /relayune-core-universal-apple-darwin/);
  assert.match(sidecarScript, /"lipo"/);
  assert.match(sidecarScript, /repairPkgOffsetsAfterLipo/);
  assert.match(sidecarScript, /signMacUniversal\(universalPath, preSignForTauri\)/);
  assert.match(sidecarScript, /--identifier[\s\S]*relayune-core/);
  assert.match(sidecarScript, /--options[\s\S]*runtime/);
  assert.match(sidecarScript, /--timestamp/);
  assert.match(sidecarScript, /smokeTestMacUniversal/);
  assert.match(sidecarScript, /RELAY_SERVER_URL is required/);

  const universalBranch = bracedSource(
    sidecarScript,
    sidecarScript.indexOf('if (requestedTuple === "universal-apple-darwin")'),
  );
  const layoutPipeline = [...universalBranch.matchAll(
    /\b(signMacUniversal|repairPkgOffsetsAfterLipo|smokeTestMacUniversal)\s*\(/g,
  )].map((match) => match[1]);
  assert.deepEqual(
    layoutPipeline,
    [
      "signMacUniversal",
      "repairPkgOffsetsAfterLipo",
      "signMacUniversal",
      "smokeTestMacUniversal",
    ],
    "release sidecars must settle the production signature layout, repair pkg offsets, re-sign, then execute both slices",
  );

  const appVerification = releaseScript.indexOf(
    'run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", appPath])',
  );
  const appStapleValidation = releaseScript.indexOf(
    'run("xcrun", ["stapler", "validate", appPath])',
  );
  const signedSidecarSmoke = releaseScript.indexOf("smokeUniversalSidecar(appPath)");
  const dmgNotarization = releaseScript.indexOf('"notarytool"');
  assert.ok(
    appVerification >= 0 &&
      appVerification < appStapleValidation &&
      appStapleValidation < signedSidecarSmoke &&
      signedSidecarSmoke < dmgNotarization,
    "the packaged app and its embedded universal sidecar must pass admission before DMG publication",
  );
});

test("universal pkg repair writes absolute offsets into both signed Mach-O slices", async (t) => {
  const source = await readFile("desktop/scripts/prepare-sidecar.mjs", "utf8");
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "relayune-sidecar-layout-"));
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const markerDeclaration = source.match(
    /const PKG_PRELUDE_MARKER = Buffer\.from\([\s\S]*?\);/,
  )?.[0];
  assert.ok(markerDeclaration, "the pkg prelude marker must remain discoverable");
  const helperNames = [
    "repairPkgOffsetsAfterLipo",
    "discoverPkgLayout",
    "findPaddedDecimalFields",
    "writePaddedDecimal",
    "readPaddedDecimal",
    "readFatMachOSlices",
    "cpuTypeForTuple",
  ];
  const context = {
    Buffer,
    binaryDirectory: temporaryDirectory,
    join: path.join,
    readFileSync,
    sidecarFileName: (tuple) => `relayune-core-${tuple}`,
    writeFileSync,
  };
  runInNewContext(
    [
      markerDeclaration,
      ...helperNames.map((name) => functionSource(source, name)),
      "globalThis.repairPkgOffsetsAfterLipo = repairPkgOffsetsAfterLipo;",
    ].join("\n"),
    context,
  );

  const marker = Buffer.from("(function(process, require, console, EXECPATH_FD");
  const positionWidth = Buffer.byteLength("// PAYLOAD_POSITION //");
  const sizeWidth = Buffer.byteLength("// PAYLOAD_SIZE //");
  const tuples = ["aarch64-apple-darwin", "x86_64-apple-darwin"];
  const layouts = [
    {
      cpuType: 0x0100000c,
      fatOffset: 4096,
      payloadField: 32,
      preludeField: 64,
      sizeField: 96,
      thinPayload: 120,
      thinPrelude: 220,
      payloadSize: 100,
      signedPrelude: 360,
    },
    {
      cpuType: 0x01000007,
      fatOffset: 12288,
      payloadField: 40,
      preludeField: 72,
      sizeField: 104,
      thinPayload: 140,
      thinPrelude: 260,
      payloadSize: 120,
      signedPrelude: 420,
    },
  ];

  const writeDecimal = (buffer, offset, width, value) => {
    const encoded = String(value).padEnd(width, " ");
    assert.equal(encoded.length, width);
    buffer.write(encoded, offset, width, "ascii");
  };
  for (const [index, tuple] of tuples.entries()) {
    const layout = layouts[index];
    const thin = Buffer.alloc(768);
    writeDecimal(thin, layout.payloadField, positionWidth, layout.thinPayload);
    writeDecimal(thin, layout.preludeField, positionWidth, layout.thinPrelude);
    writeDecimal(thin, layout.sizeField, sizeWidth, layout.payloadSize);
    marker.copy(thin, layout.thinPrelude);
    await writeFile(path.join(temporaryDirectory, `relayune-core-${tuple}`), thin);
  }

  const sliceSize = 1024;
  const fat = Buffer.alloc(layouts.at(-1).fatOffset + sliceSize);
  fat.writeUInt32BE(0xcafebabe, 0);
  fat.writeUInt32BE(layouts.length, 4);
  for (const [index, layout] of layouts.entries()) {
    const entry = 8 + index * 20;
    fat.writeUInt32BE(layout.cpuType, entry);
    fat.writeUInt32BE(layout.fatOffset, entry + 8);
    fat.writeUInt32BE(sliceSize, entry + 12);

    const slice = Buffer.alloc(sliceSize);
    writeDecimal(slice, layout.payloadField, positionWidth, layout.thinPayload);
    writeDecimal(slice, layout.preludeField, positionWidth, layout.thinPrelude);
    writeDecimal(slice, layout.sizeField, sizeWidth, layout.payloadSize);
    marker.copy(slice, layout.signedPrelude);
    slice.copy(fat, layout.fatOffset);
  }
  const universalPath = path.join(temporaryDirectory, "relayune-core-universal-apple-darwin");
  await writeFile(universalPath, fat);

  context.repairPkgOffsetsAfterLipo(universalPath, tuples);
  const repaired = await readFile(universalPath);
  const readDecimal = (buffer, offset, width) =>
    Number.parseInt(buffer.subarray(offset, offset + width).toString("ascii"), 10);
  for (const layout of layouts) {
    const expectedPayload =
      layout.fatOffset + layout.signedPrelude - layout.payloadSize;
    const expectedPrelude = layout.fatOffset + layout.signedPrelude;
    assert.equal(
      readDecimal(repaired, layout.fatOffset + layout.payloadField, positionWidth),
      expectedPayload,
      "pkg payload offsets must be absolute from the start of the fat executable",
    );
    assert.equal(
      readDecimal(repaired, layout.fatOffset + layout.preludeField, positionWidth),
      expectedPrelude,
      "pkg prelude offsets must be absolute from the start of the fat executable",
    );
    assert.equal(
      readDecimal(repaired, layout.fatOffset + layout.sizeField, sizeWidth),
      layout.payloadSize,
      "repairing positions must not corrupt the authenticated pkg payload length",
    );
  }
});

test("desktop E2EE secrets stay encrypted in application data without Keychain", async () => {
  const [cargo, secrets, desktopMain, relayCli] = await Promise.all([
    readFile("desktop/src-tauri/Cargo.toml", "utf8"),
    readFile("desktop/src-tauri/src/secrets.rs", "utf8"),
    readFile("desktop/src/main.ts", "utf8"),
    readFile("relay/cli.mjs", "utf8"),
  ]);

  assert.doesNotMatch(cargo, /\brusqlite\b/);
  assert.doesNotMatch(secrets, /sqlite/i);
  assert.match(cargo, /^aes-gcm = /m);
  assert.doesNotMatch(cargo, /^keyring = /m);
  assert.match(secrets, /const VAULT_FILE_NAME: &str = "secret-vault-v1\.json"/);
  assert.match(secrets, /const VAULT_KEY_FILE_NAME: &str = "secret-vault-v1\.key"/);
  assert.match(secrets, /Aes256Gcm/);
  assert.match(secrets, /Payload \{[\s\S]*?aad: VAULT_AAD/);
  assert.match(secrets, /options\.mode\(0o600\)/);
  assert.match(secrets, /fn encrypted_vault_round_trips_without_plaintext_secrets/);
  assert.match(secrets, /raw[\s\S]*?token\.as_bytes\(\)[\s\S]*?key\.as_bytes\(\)/);
  assert.doesNotMatch(secrets, /keyring|Keychain|Credential Manager/);
  assert.doesNotMatch(relayCli, /readKeychainSecret|\.\/keychain\.mjs/);
  assert.match(desktopMain, /createPairingInitiator/);
  assert.match(desktopMain, /finishPairingInitiator/);
  assert.doesNotMatch(desktopMain, /beginLogin|generatePairingKey|siteAccessToken/);
});
