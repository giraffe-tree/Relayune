import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import {
  packageTarget,
  sidecarFileName,
  smokeTestFileName,
  targetTuples,
} from "../desktop/scripts/sidecar-targets.mjs";
import { agentSpawnOptions } from "../relay/platform-process.mjs";
import {
  assertArtifactBuiltAfter,
  inspectWindowsPe,
  verifyWindowsPePair,
} from "../desktop/scripts/verify-windows-pe.mjs";

test("Windows beta skips the macOS-only updater feed without a false failure", async () => {
  const [source, i18n] = await Promise.all([
    readFile("desktop/src/main.ts", "utf8"),
    readFile("desktop/src/i18n.ts", "utf8"),
  ]);
  assert.match(
    source,
    /bootstrap\.platform\.os === "windows"[\s\S]{0,180}requestNativeUpdateAvailability\(false\)[\s\S]{0,180}showTranslatedToast\("windowsUpdateFromWebsite"\)[\s\S]{0,80}return;/,
  );
  assert.match(i18n, /Windows 公开测试版请从 Relayune 官网下载新版安装包/);
  assert.match(i18n, /Download the latest Windows public beta installer/);
});

function syntheticWindowsPe({
  subsystem,
  manifest = false,
  manifestBody = null,
  overlayManifest = false,
  executionLevel = null,
  uiAccess = false,
  vcRuntime = null,
  delayVcRuntime = null,
  machine = 0x8664,
  coffCharacteristics = 0x0002,
  entryPoint = 0x1700,
  sectionCharacteristics = 0x60000020,
  sectionAlignment = 0x1000,
  fileAlignment = 0x200,
  sizeOfImage = 0x2000,
  optionalHeaderSize = 240,
  numberOfDataDirectories = 16,
}) {
  const buffer = Buffer.alloc(0x1000);
  buffer.write("MZ", 0, "ascii");
  buffer.writeUInt32LE(0x80, 0x3c);
  buffer.write("PE\0\0", 0x80, "binary");
  buffer.writeUInt16LE(machine, 0x84);
  buffer.writeUInt16LE(1, 0x86);
  buffer.writeUInt16LE(optionalHeaderSize, 0x94);
  buffer.writeUInt16LE(coffCharacteristics, 0x96);
  const optional = 0x98;
  buffer.writeUInt16LE(0x20b, optional);
  buffer.writeUInt32LE(entryPoint, optional + 16);
  buffer.writeUInt32LE(sectionAlignment, optional + 32);
  buffer.writeUInt32LE(fileAlignment, optional + 36);
  buffer.writeUInt32LE(sizeOfImage, optional + 56);
  buffer.writeUInt32LE(0x200, optional + 60);
  buffer.writeUInt16LE(subsystem, optional + 68);
  buffer.writeUInt16LE(0x20 | 0x40 | 0x100, optional + 70);
  buffer.writeUInt32LE(numberOfDataDirectories, optional + 108);
  buffer.writeUInt32LE(0x1100, optional + 112 + 1 * 8);
  buffer.writeUInt32LE(40, optional + 112 + 1 * 8 + 4);
  buffer.writeUInt32LE(0x1200, optional + 112 + 2 * 8);
  buffer.writeUInt32LE(0x200, optional + 112 + 2 * 8 + 4);
  if (delayVcRuntime) {
    buffer.writeUInt32LE(0x1400, optional + 112 + 13 * 8);
    buffer.writeUInt32LE(64, optional + 112 + 13 * 8 + 4);
  }

  const section = optional + optionalHeaderSize;
  buffer.write(".rdata\0\0", section, "ascii");
  buffer.writeUInt32LE(0xe00, section + 8);
  buffer.writeUInt32LE(0x1000, section + 12);
  buffer.writeUInt32LE(0xe00, section + 16);
  buffer.writeUInt32LE(0x200, section + 20);
  buffer.writeUInt32LE(sectionCharacteristics, section + 36);

  const importDirectory = 0x300;
  const importName = vcRuntime ?? "KERNEL32.dll";
  buffer.writeUInt32LE(0x1180, importDirectory + 12);
  buffer.writeUInt32LE(0x1190, importDirectory + 16);
  buffer.write(`${importName}\0`, 0x380, "ascii");

  if (delayVcRuntime) {
    const delayImportDirectory = 0x600;
    buffer.writeUInt32LE(1, delayImportDirectory);
    buffer.writeUInt32LE(0x1480, delayImportDirectory + 4);
    buffer.write(`${delayVcRuntime}\0`, 0x680, "ascii");
  }

  const resourceRoot = 0x400;
  buffer.writeUInt16LE(1, resourceRoot + 14);
  buffer.writeUInt32LE(manifest ? 24 : 10, resourceRoot + 16);
  buffer.writeUInt32LE(0x80000020, resourceRoot + 20);
  buffer.writeUInt16LE(1, resourceRoot + 0x20 + 14);
  buffer.writeUInt32LE(1, resourceRoot + 0x20 + 16);
  buffer.writeUInt32LE(0x80000040, resourceRoot + 0x20 + 20);
  buffer.writeUInt16LE(1, resourceRoot + 0x40 + 14);
  buffer.writeUInt32LE(1033, resourceRoot + 0x40 + 16);
  buffer.writeUInt32LE(0x60, resourceRoot + 0x40 + 20);
  const requestedExecution = executionLevel || uiAccess
    ? `<trustInfo><security><requestedPrivileges><requestedExecutionLevel level="${executionLevel ?? "asInvoker"}" uiAccess="${uiAccess}"/></requestedPrivileges></security></trustInfo>`
    : "";
  const resourceBody = manifest
    ? (manifestBody ??
      `<assembly><dependency><assemblyIdentity name="Microsoft.Windows.Common-Controls"/></dependency>${requestedExecution}</assembly>`)
    : "sidecar resource";
  const resourceBytes = Buffer.from(resourceBody, "utf8");
  buffer.writeUInt32LE(0x1300, resourceRoot + 0x60);
  buffer.writeUInt32LE(resourceBytes.length, resourceRoot + 0x64);
  resourceBytes.copy(buffer, 0x500);
  if (overlayManifest) {
    buffer.write("Microsoft.Windows.Common-Controls", 0xf00, "ascii");
  }
  return buffer;
}

function blockContent(source, marker) {
  let start = source.indexOf(marker);
  if (start === -1 && marker.includes("\n")) {
    start = source.indexOf(marker.replaceAll("\n", "\r\n"));
  }
  assert.notEqual(start, -1, `missing ${marker}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }
  assert.fail(`unterminated ${marker}`);
}

test("Windows source contract extraction tolerates CRLF checkouts", () => {
  const source = '#[cfg(target_os = "windows")]\r\nfn sample() {\r\n  ready();\r\n}';
  assert.match(
    blockContent(source, '#[cfg(target_os = "windows")]\nfn sample'),
    /ready\(\)/,
  );
});

function declarationsFor(css, selector, media = null) {
  const scope = media ? blockContent(css, `@media ${media}`) : css;
  const body = blockContent(scope, `${selector} {`);
  return Object.fromEntries(
    body
      .split(";")
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const separator = declaration.indexOf(":");
        assert.notEqual(separator, -1, `invalid ${selector} declaration ${declaration}`);
        return [
          declaration.slice(0, separator).trim(),
          declaration.slice(separator + 1).trim(),
        ];
      }),
  );
}

function rustFunctionSource(source, name) {
  const declaration = new RegExp(`fn ${name}(?:<[^>{}]+>)?\\s*\\(`);
  const match = declaration.exec(source);
  const start = match?.index ?? -1;
  assert.notEqual(start, -1, `missing Rust function ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated Rust function ${name}`);
}

function javascriptFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing JavaScript function ${name}`);
  const parametersStart = source.indexOf("(", start);
  let parameterDepth = 0;
  let parametersEnd = -1;
  for (let index = parametersStart; index < source.length; index += 1) {
    if (source[index] === "(") parameterDepth += 1;
    if (source[index] === ")") parameterDepth -= 1;
    if (parameterDepth === 0) {
      parametersEnd = index;
      break;
    }
  }
  assert.notEqual(parametersEnd, -1, `unterminated parameters for ${name}`);
  const bodyStart = source.indexOf("{", parametersEnd);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated JavaScript function ${name}`);
}

test("Windows targets produce Tauri-compatible executable sidecar names", () => {
  assert.equal(packageTarget("x86_64-pc-windows-msvc"), "node22-win-x64");
  assert.equal(packageTarget("aarch64-pc-windows-msvc"), "node22-win-arm64");
  assert.equal(
    sidecarFileName("x86_64-pc-windows-msvc"),
    "relayune-core-x86_64-pc-windows-msvc.exe",
  );
  assert.equal(smokeTestFileName("x86_64-pc-windows-msvc"), "relayune-core.exe");
  assert.deepEqual(targetTuples("universal-apple-darwin"), [
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
  ]);
  assert.throws(() => targetTuples("x86_64-unknown-linux-gnu"), /Unsupported/);
});

test("Windows command shims run hidden while native executables stay direct", () => {
  const base = { cwd: "C:\\workspace", stdio: ["pipe", "pipe", "pipe"] };
  assert.deepEqual(agentSpawnOptions("codex", base, "win32"), {
    ...base,
    windowsHide: true,
    shell: true,
  });
  assert.deepEqual(agentSpawnOptions("C:\\Tools\\codex.exe", base, "win32"), {
    ...base,
    windowsHide: true,
    shell: false,
  });
  assert.equal(agentSpawnOptions("codex", base, "darwin"), base);
});

test("Windows PE verifier rejects overlays, consoles, dynamic VC runtime, and invalid directories", () => {
  assert.doesNotThrow(() => assertArtifactBuiltAfter(2_000, 1_000, "Relayune GUI"));
  assert.throws(
    () => assertArtifactBuiltAfter(999, 1_000, "Relayune GUI"),
    /Relayune GUI predates the current Windows build marker/,
  );
  const gui = syntheticWindowsPe({ subsystem: 2, manifest: true });
  const sidecar = syntheticWindowsPe({ subsystem: 3 });
  const metadata = inspectWindowsPe(gui);
  assert.equal(metadata.machine, 0x8664);
  assert.equal(metadata.characteristics, 0x0002);
  assert.equal(metadata.addressOfEntryPoint, 0x1700);
  assert.equal(metadata.entryPointSectionCharacteristics & 0x20000000, 0x20000000);
  assert.equal(metadata.subsystem, 2);
  assert.deepEqual(metadata.importNames, ["kernel32.dll"]);
  assert.deepEqual(metadata.delayImportNames, []);
  assert.deepEqual(metadata.dynamicVcRuntimeImports, []);
  assert.deepEqual(metadata.unexpectedRuntimeImports, []);
  assert.equal(metadata.manifestCount, 1);
  assert.equal(metadata.hasCommonControlsManifest, true);
  assert.equal(metadata.requiresElevation, false);
  assert.equal(metadata.requestsUiAccess, false);
  assert.doesNotThrow(() => verifyWindowsPePair(gui, sidecar));
  assert.throws(
    () =>
      verifyWindowsPePair(
        syntheticWindowsPe({ subsystem: 2, manifest: true, coffCharacteristics: 0 }),
        sidecar,
      ),
    /COFF header must mark an executable image/,
    "a PE-shaped payload that CreateProcess cannot execute must not pass",
  );
  assert.throws(
    () =>
      verifyWindowsPePair(
        syntheticWindowsPe({
          subsystem: 2,
          manifest: true,
          coffCharacteristics: 0x0002 | 0x2000,
        }),
        sidecar,
      ),
    /COFF header must not mark the payload as a DLL/,
    "a DLL must not pass as the installed GUI executable",
  );
  assert.throws(
    () =>
      verifyWindowsPePair(
        syntheticWindowsPe({ subsystem: 2, manifest: true, entryPoint: 0 }),
        sidecar,
      ),
    /must declare a nonzero entry point/,
    "an EXE with no process entry point must not pass the first-launch gate",
  );
  assert.throws(
    () =>
      verifyWindowsPePair(
        syntheticWindowsPe({
          subsystem: 2,
          manifest: true,
          sectionCharacteristics: 0x40000040,
        }),
        sidecar,
      ),
    /entry point must map to an executable PE section/,
    "an entry point blocked by DEP must not pass the first-launch gate",
  );
  assert.throws(
    () =>
      inspectWindowsPe(
        syntheticWindowsPe({ subsystem: 2, manifest: true, entryPoint: 0x9000 }),
      ),
    /entry point does not map to any PE section/,
  );
  assert.throws(
    () =>
      inspectWindowsPe(
        syntheticWindowsPe({ subsystem: 2, manifest: true, sizeOfImage: 0 }),
      ),
    /PE SizeOfImage must be nonzero/,
    "a PE with no loader image extent must not pass the install gate",
  );
  assert.throws(
    () =>
      inspectWindowsPe(
        syntheticWindowsPe({ subsystem: 2, manifest: true, sizeOfImage: 0x1000 }),
      ),
    /section \.rdata exceeds PE SizeOfImage/,
    "truncating SizeOfImage before the mapped section must fail closed",
  );
  assert.throws(
    () =>
      inspectWindowsPe(
        syntheticWindowsPe({ subsystem: 2, manifest: true, fileAlignment: 0x300 }),
      ),
    /FileAlignment must be a power of two/,
    "a loader-invalid file alignment must not pass",
  );
  assert.doesNotThrow(() =>
    verifyWindowsPePair(
      syntheticWindowsPe({
        subsystem: 2,
        manifest: true,
        optionalHeaderSize: 136,
        numberOfDataDirectories: 3,
      }),
      sidecar,
    ),
  );
  assert.throws(
    () =>
      inspectWindowsPe(
        syntheticWindowsPe({
          subsystem: 2,
          manifest: true,
          optionalHeaderSize: 136,
          numberOfDataDirectories: 16,
        }),
      ),
    /PE data directories exceed the declared optional header/,
    "directory bytes beyond SizeOfOptionalHeader must not be read from the section table or padding",
  );
  assert.throws(
    () => verifyWindowsPePair(syntheticWindowsPe({ subsystem: 3, manifest: true }), sidecar),
    /must not allocate a console/,
  );
  for (const dynamicRuntime of [
    "vCrUnTiMe140.DlL",
    "VCRUNTIME140_1.dll",
    "MSVCP140_2.dll",
    "CONCRT140.dll",
    "VCOMP140.dll",
    "MFC140U.dll",
    "MSVCR120.dll",
  ]) {
    assert.throws(
      () =>
        verifyWindowsPePair(
          syntheticWindowsPe({ subsystem: 2, manifest: true, vcRuntime: dynamicRuntime }),
          sidecar,
        ),
      /must not require VC Redistributable DLLs/,
      `${dynamicRuntime} must not pass the current-user PE gate`,
    );
  }
  for (const systemRuntime of ["api-ms-win-crt-runtime-l1-1-0.dll", "msvcrt.dll"]) {
    assert.doesNotThrow(() =>
      verifyWindowsPePair(
        syntheticWindowsPe({ subsystem: 2, manifest: true, vcRuntime: systemRuntime }),
        sidecar,
      ),
    );
  }
  assert.throws(
    () =>
      verifyWindowsPePair(
        syntheticWindowsPe({
          subsystem: 2,
          manifest: true,
          delayVcRuntime: "VCRUNTIME140_1.dll",
        }),
        sidecar,
      ),
    /VC Redistributable DLLs/,
    "delay-loaded VC runtime imports must not bypass the static CRT gate",
  );
  assert.doesNotThrow(() =>
    verifyWindowsPePair(
      syntheticWindowsPe({
        subsystem: 2,
        manifest: true,
        delayVcRuntime: "api-ms-win-crt-runtime-l1-1-0.dll",
      }),
      sidecar,
    ),
  );
  for (const unpackagedRuntime of ["WebView2Loader.dll", "libcrypto-3-x64.dll"]) {
    const unpackagedGui = syntheticWindowsPe({
      subsystem: 2,
      manifest: true,
      vcRuntime: unpackagedRuntime,
    });
    assert.deepEqual(inspectWindowsPe(unpackagedGui).unexpectedRuntimeImports, [
      unpackagedRuntime.toLowerCase(),
    ]);
    assert.throws(
      () => verifyWindowsPePair(unpackagedGui, sidecar),
      /must not import unpackaged non-system DLLs/,
      `${unpackagedRuntime} must not pass a clean-machine PE gate merely because a build runner may resolve it`,
    );
  }
  assert.throws(
    () =>
      verifyWindowsPePair(
        syntheticWindowsPe({
          subsystem: 2,
          manifest: true,
          delayVcRuntime: "WebView2Loader.dll",
        }),
        sidecar,
      ),
    /must not import unpackaged non-system DLLs/,
    "delay-loaded WebView2Loader must not bypass the clean-machine dependency gate",
  );
  const unterminatedDelayImports = syntheticWindowsPe({
    subsystem: 2,
    manifest: true,
    delayVcRuntime: "KERNELBASE.dll",
  });
  unterminatedDelayImports.writeUInt32LE(32, 0x98 + 112 + 13 * 8 + 4);
  assert.throws(
    () => inspectWindowsPe(unterminatedDelayImports),
    /delay import descriptor table is not terminated/,
  );
  const unmappedDelayImports = Buffer.from(unterminatedDelayImports);
  unmappedDelayImports.writeUInt32LE(0x9000, 0x98 + 112 + 13 * 8);
  assert.throws(() => inspectWindowsPe(unmappedDelayImports), /does not map to any PE section/);
  const overlayOnly = syntheticWindowsPe({ subsystem: 2, overlayManifest: true });
  assert.equal(inspectWindowsPe(overlayOnly).hasCommonControlsManifest, false);
  assert.throws(() => verifyWindowsPePair(overlayOnly, sidecar), /RT_MANIFEST resource/);
  const commentedCommonControls = syntheticWindowsPe({
    subsystem: 2,
    manifest: true,
    manifestBody:
      '<assembly><!-- <assemblyIdentity name="Microsoft.Windows.Common-Controls"/> --></assembly>',
  });
  assert.equal(inspectWindowsPe(commentedCommonControls).hasCommonControlsManifest, false);
  assert.throws(
    () => verifyWindowsPePair(commentedCommonControls, sidecar),
    /GUI manifest must enable Common Controls/,
    "an XML comment must not forge the GUI Common Controls dependency",
  );
  for (const malformedComment of [
    '<assembly><!-- <assemblyIdentity name="Microsoft.Windows.Common-Controls"/></assembly>',
    '<assembly>--><assemblyIdentity name="Microsoft.Windows.Common-Controls"/></assembly>',
  ]) {
    assert.throws(
      () =>
        inspectWindowsPe(
          syntheticWindowsPe({ subsystem: 2, manifest: true, manifestBody: malformedComment }),
        ),
      /RT_MANIFEST contains an (?:unterminated XML comment|unmatched XML comment terminator)/,
      "malformed XML comments must fail closed",
    );
  }
  const missingResources = Buffer.from(gui);
  missingResources.writeUInt32LE(0, 0x98 + 112 + 2 * 8);
  missingResources.writeUInt32LE(0, 0x98 + 112 + 2 * 8 + 4);
  assert.throws(() => verifyWindowsPePair(missingResources, sidecar), /must contain resources/);
  const unmappedResources = Buffer.from(gui);
  unmappedResources.writeUInt32LE(0x9000, 0x98 + 112 + 2 * 8);
  assert.throws(() => inspectWindowsPe(unmappedResources), /does not map to any PE section/);
  const armGui = syntheticWindowsPe({ subsystem: 2, manifest: true, machine: 0xaa64 });
  const armSidecar = syntheticWindowsPe({ subsystem: 3, machine: 0xaa64 });
  assert.doesNotThrow(() => verifyWindowsPePair(armGui, armSidecar));
  assert.throws(
    () => verifyWindowsPePair(armGui, armSidecar, { expectedMachine: 0x8664 }),
    /must be a x64 PE/,
  );
  for (const executionLevel of [
    "requireAdministrator",
    "highestAvailable",
    "ReQuIrEaDmInIsTrAtOr",
  ]) {
    assert.throws(
      () =>
        verifyWindowsPePair(
          syntheticWindowsPe({ subsystem: 2, manifest: true, executionLevel }),
          sidecar,
        ),
      /must not request administrator or highest-available execution/,
      `${executionLevel} must not pass the current-user PE gate`,
    );
  }
  assert.throws(
    () =>
      verifyWindowsPePair(
        syntheticWindowsPe({ subsystem: 2, manifest: true, uiAccess: "TrUe" }),
        sidecar,
      ),
    /must not request UIAccess from the current-user install directory/,
  );
  assert.throws(
    () =>
      verifyWindowsPePair(
        gui,
        syntheticWindowsPe({
          subsystem: 3,
          manifest: true,
          executionLevel: "highestAvailable",
        }),
      ),
    /Relayune sidecar must not request administrator or highest-available execution/,
    "the packaged sidecar must remain current-user launchable too",
  );
});

test("desktop exposes Windows development, NSIS, credentials, and updater contracts", async () => {
  const [config, windowsConfig, desktopPackage, rootPackage, rustManifest, rustConfig, rustLib, rustRelay, rustSecrets, frontend, sidecar] =
    await Promise.all([
      readFile("desktop/src-tauri/tauri.conf.json", "utf8").then(JSON.parse),
      readFile("desktop/src-tauri/tauri.windows.conf.json", "utf8").then(JSON.parse),
      readFile("desktop/package.json", "utf8").then(JSON.parse),
      readFile("package.json", "utf8").then(JSON.parse),
      readFile("desktop/src-tauri/Cargo.toml", "utf8"),
      readFile("desktop/src-tauri/src/config.rs", "utf8"),
      readFile("desktop/src-tauri/src/lib.rs", "utf8"),
      readFile("desktop/src-tauri/src/relay.rs", "utf8"),
      readFile("desktop/src-tauri/src/secrets.rs", "utf8"),
      readFile("desktop/src/main.ts", "utf8"),
      readFile("desktop/scripts/prepare-sidecar.mjs", "utf8"),
    ]);

  assert.ok(config.bundle.icon.includes("icons/icon.ico"));
  assert.equal(config.bundle.publisher, "Giraffetree");
  assert.equal(config.bundle.windows.nsis.installMode, "currentUser");
  assert.equal(config.bundle.windows.nsis.startMenuFolder, undefined);
  assert.deepEqual(config.bundle.windows.nsis.languages, ["English", "SimpChinese"]);
  assert.equal(config.bundle.windows.nsis.displayLanguageSelector, false);
  assert.equal(config.bundle.windows.nsis.installerHooks, "windows/nsis-hooks.nsh");
  assert.equal(config.bundle.windows.allowDowngrades, false);
  assert.equal(config.bundle.windows.webviewInstallMode.type, "downloadBootstrapper");
  assert.equal(config.bundle.windows.webviewInstallMode.silent, true);
  assert.equal(windowsConfig.app.windows[0].label, "main");
  assert.equal(windowsConfig.app.windows[0].decorations, true);
  await access("desktop/src-tauri/icons/icon.ico");
  await access("desktop/src-tauri/windows/nsis-hooks.nsh");

  assert.equal(desktopPackage.scripts["desktop:dev"], "node scripts/desktop-command.mjs dev");
  assert.match(desktopPackage.scripts["desktop:dev:windows"], /tauri dev/);
  assert.match(desktopPackage.scripts["desktop:build:windows"], /--bundles nsis/);
  assert.match(desktopPackage.scripts["desktop:build:windows"], /tauri\.local-build\.conf\.json/);
  assert.match(desktopPackage.scripts["desktop:build:windows"], /tauri build/);
  assert.match(
    sidecar,
    /execFileSync\(\s*process\.execPath,\s*\[\s*pkgEntry,/,
    "sidecar packaging must invoke the pkg JavaScript entry through Node so Windows never tries to spawn a .cmd shim directly",
  );
  assert.doesNotMatch(sidecar, /pkg\.cmd/);
  assert.doesNotMatch(sidecar, /shell:\s*true/);
  assert.match(desktopPackage.scripts["desktop:build:windows"], /verify-windows-pe\.mjs/);
  assert.match(desktopPackage.scripts["desktop:build:windows"], /powershell\.exe -NoProfile -NonInteractive/);
  assert.match(desktopPackage.scripts["desktop:build:windows"], /verify-windows-installer\.ps1/);
  assert.match(
    desktopPackage.scripts["desktop:build:windows"],
    /--gui src-tauri\/target\/release\/relayune-desktop\.exe/,
  );
  assert.match(
    desktopPackage.scripts["desktop:build:windows"],
    /--sidecar-directory src-tauri\/binaries/,
  );
  const windowsBuild = desktopPackage.scripts["desktop:build:windows"];
  assert.ok(
    windowsBuild.indexOf("tauri build") < windowsBuild.indexOf("verify-windows-pe.mjs") &&
      windowsBuild.indexOf("verify-windows-pe.mjs") < windowsBuild.indexOf("verify-windows-installer.ps1"),
    "the formal Windows build must verify compiled PE payloads before admitting the final NSIS artifact",
  );
  assert.doesNotMatch(desktopPackage.scripts["desktop:build:windows"], /cargo (?:xwin )?build/);
  assert.match(desktopPackage.scripts["desktop:ci:windows"], /x86_64-pc-windows-msvc/);
  assert.match(desktopPackage.scripts["desktop:ci:windows"], /tauri\.windows-ci\.conf\.json/);
  assert.match(desktopPackage.scripts["desktop:ci:windows"], /tauri build/);
  assert.doesNotMatch(desktopPackage.scripts["desktop:ci:windows"], /cargo (?:xwin )?build/);
  assert.match(rootPackage.scripts["desktop:dev:windows"], /desktop:dev:windows/);
  assert.match(rootPackage.scripts["desktop:build:windows"], /desktop:build:windows/);

  assert.match(rustManifest, /^aes-gcm = /m);
  assert.doesNotMatch(rustManifest, /^keyring = /m);
  assert.match(rustManifest, /^winreg = "0\.55\.0"/m);
  assert.match(rustManifest, /"Win32_UI_Shell"/);
  assert.match(rustManifest, /"Win32_System_SystemInformation"/);
  assert.match(rustManifest, /"Win32_UI_WindowsAndMessaging"/);
  assert.match(rustSecrets, /use aes_gcm/);
  assert.match(rustSecrets, /const VAULT_FILE_NAME/);
  assert.match(rustSecrets, /const BROWSER_KEY_NAMESPACE/);
  assert.match(
    rustSecrets,
    /pub fn presence_for_browsers\([\s\S]*?\) -> Result<SecretPresence, String>/,
  );
  assert.match(
    rustSecrets,
    /let plaintext = if path\.exists\(\)[\s\S]*?decrypt_vault\(&path, &key\)\?[\s\S]*?VaultPlaintext::default\(\)/,
    "an unreadable existing vault must not masquerade as an unpaired clean install",
  );
  assert.match(
    rustSecrets,
    /fn encrypted_vault_round_trips_without_plaintext_secrets\([\s\S]*?SecretVault::open[\s\S]*?reopened/,
    "the vault test must prove encrypted persistence survives a process-style reopen",
  );
  assert.match(
    rustSecrets,
    /fn deleting_one_browser_key_preserves_the_other_and_is_idempotent\([\s\S]*?vault\.clear[\s\S]*?vault\.get\(&second\)/,
    "deleting one browser vault entry must leave the other readable",
  );
  assert.match(
    rustSecrets,
    /fn tampered_ciphertext_is_rejected\([\s\S]*?replace_range[\s\S]*?SecretVault::open\(&directory\.0\)\.is_err\(\)/,
    "authenticated vault ciphertext must reject tampering",
  );
  assert.match(
    rustSecrets,
    /fn missing_wrapping_key_never_replaces_an_existing_vault\([\s\S]*?remove_file[\s\S]*?SecretVault::open\(&directory\.0\)\.is_err\(\)/,
    "a missing wrapping key must never silently replace an existing vault",
  );
  assert.match(
    rustSecrets,
    /pub fn clear_device_credentials[\s\S]*?vault\(\)\?\.clear\(&device_credential_entries[\s\S]*?fn device_credential_entries[\s\S]*?device_token_entry[\s\S]*?legacy_e2ee_entry[\s\S]*?attachment_store_key_entry[\s\S]*?browser_ids[\s\S]*?browser_key_entry/,
    "sign-out must atomically clear every per-device secret entry",
  );
  assert.match(
    rustSecrets,
    /fn persist_vault\([\s\S]*?Aes256Gcm[\s\S]*?\.encrypt\([\s\S]*?replace_private_file/,
    "credential persistence must encrypt before atomically writing application data",
  );

  assert.doesNotMatch(rustConfig, /^\s*os::unix::/m);
  assert.match(rustConfig, /#\[cfg\(unix\)\]/);
  assert.match(rustConfig, /MoveFileExW/);
  assert.match(rustConfig, /MOVEFILE_REPLACE_EXISTING \| MOVEFILE_WRITE_THROUGH/);
  const windowsUrlOpen = blockContent(
    rustLib,
    '#[cfg(target_os = "windows")]\nfn open_external_url',
  );
  assert.match(windowsUrlOpen, /encode_wide\(\)/);
  assert.match(windowsUrlOpen, /ShellExecuteW\(/);
  assert.match(windowsUrlOpen, /SW_SHOWNORMAL/);
  assert.match(windowsUrlOpen, /result as usize <= 32/);
  assert.doesNotMatch(windowsUrlOpen, /rundll32|Command::new|\.spawn\(\)/);
  assert.match(rustRelay, /windows_taskkill_command\(\)/);
  assert.match(rustRelay, /\.args\(\["\/PID", &pid, "\/T", "\/F"\]\)/);
  assert.match(rustRelay, /\.creation_flags\(CREATE_NO_WINDOW\)/);
  assert.match(frontend, /bootstrap\.platform\.update_target/);
  assert.doesNotMatch(frontend, /连接这台 Mac|正在准备这台 Mac/);
  assert.match(
    sidecar,
    /process\.platform === "win32" && smokeSourceTuple\.includes\("-windows-"\)[\s\S]*?smokeTestWindowsSidecar\(smokeTestPath\)/,
    "Windows CI must execute the produced sidecar rather than only checking that the file exists",
  );
  assert.match(
    sidecar,
    /requestedTuple\.includes\("-windows-"\)[\s\S]*?cargoTargetRoot[\s\S]*?"relayune-core\.exe"[\s\S]*?force: true/,
    "Windows packaging must evict only the generated unsuffixed sidecar cache before rebuilding",
  );
});

test("Windows tray recovery and narrow-viewport layout have source-level admission contracts", async () => {
  const [baseConfig, windowsConfig, rust, relay, styles, workflow] = await Promise.all([
    readFile("desktop/src-tauri/tauri.conf.json", "utf8").then(JSON.parse),
    readFile("desktop/src-tauri/tauri.windows.conf.json", "utf8").then(JSON.parse),
    readFile("desktop/src-tauri/src/lib.rs", "utf8"),
    readFile("desktop/src-tauri/src/relay.rs", "utf8"),
    readFile("desktop/src/styles.css", "utf8"),
    readFile(".github/workflows/windows-desktop.yml", "utf8"),
  ]);
  const baseMainWindow = baseConfig.app.windows.find((window) => window.label === "main");
  const mainWindow = windowsConfig.app.windows.find((window) => window.label === "main");
  assert.ok(mainWindow);
  assert.ok(baseMainWindow);
  assert.equal(mainWindow.resizable, true);
  assert.equal(mainWindow.visible, false);
  assert.equal(mainWindow.width, 520);
  assert.equal(mainWindow.height, 480);
  assert.equal(mainWindow.minWidth, 420);
  assert.equal(mainWindow.minHeight, 420);
  assert.equal(baseMainWindow.minHeight, 480, "macOS retains its compact-shell minimum independently of Windows");

  const bodyMinWidth = Number(styles.match(/body\s*\{[^}]*min-width:\s*(\d+)px/s)?.[1]);
  const responsiveWidth = Number(
    styles.match(/@media\s*\(max-width:\s*(\d+)px\)/)?.[1],
  );
  assert.ok(Number.isFinite(bodyMinWidth));
  assert.ok(Number.isFinite(responsiveWidth));
  assert.ok(
    bodyMinWidth <= mainWindow.minWidth,
    "CSS must not demand a wider viewport than the native minimum window",
  );
  assert.ok(
    responsiveWidth >= mainWindow.minWidth,
    "the compact layout must activate at the native minimum window width",
  );
  assert.match(styles, /dialog\s*\{[^}]*calc\(100vw\s*-\s*40px\)/s);
  assert.doesNotMatch(
    styles.match(/body\s*\{[^}]*\}/s)?.[0] ?? "",
    /overflow:\s*hidden/,
    "long English copy must remain vertically scrollable in a constrained viewport",
  );

  assert.match(
    rust,
    /#\[cfg\(not\(target_os = "macos"\)\)\][\s\S]*?icons\/32x32\.png[\s\S]*?icon_as_template\(false\)/,
    "Windows needs an opaque tray icon rather than a macOS template icon",
  );
  assert.match(
    rust,
    /#\[cfg\(target_os = "macos"\)\]\s*let tray = tray\.show_menu_on_left_click\(true\)/,
  );
  assert.match(
    rust,
    /#\[cfg\(not\(target_os = "macos"\)\)\][\s\S]*?show_menu_on_left_click\(false\)[\s\S]*?TrayIconEvent::Click[\s\S]*?MouseButton::Left[\s\S]*?MouseButtonState::Up[\s\S]*?defer_native_entry[\s\S]*?show_window\(&app\)/,
    "Windows left click must dispatch the shared restore chain without blocking the tray event thread",
  );
  assert.match(
    rust,
    /"open_settings"\s*=>\s*\{[\s\S]{0,160}?show_window\(app\)/,
    "the tray Open action must restore and focus the existing window",
  );
  assert.match(
    rust,
    /WindowEvent::CloseRequested[\s\S]*?prevent_close\(\)[\s\S]*?hide_main_window\(window\)/,
    "closing the Windows window must leave the tray Relay alive",
  );
  const hideMainWindow = rustFunctionSource(rust, "hide_main_window");
  assert.match(hideMainWindow, /window\.hide\(\)/);
  const relayPublish = rustFunctionSource(relay, "publish");
  assert.match(relayPublish, /crate::publish_relay_snapshot\(app, state\)/);
  const snapshotPublish = rustFunctionSource(rust, "publish_relay_snapshot");
  assert.match(
    snapshotPublish,
    /publish_relay_snapshot_with_retry_hooks\([\s\S]*?refresh_tray_status_for_snapshot_locked\(app, state, snapshot\)[\s\S]*?app\.emit\("relay-status", snapshot\)/,
    "Relay publications must update the native Windows tray and WebView from one snapshot transaction",
  );
  const retryPublish = rustFunctionSource(
    rust,
    "publish_relay_snapshot_with_retry_hooks",
  );
  assert.ok(
    (retryPublish.match(/publish_relay_snapshot_with_hooks\(/g)?.length ?? 0) >= 2,
    "a failed native refresh must retry through the same serialized snapshot transaction",
  );
  assert.match(retryPublish, /state\.log\(model::LogLevel::Error, error\)/);
  const refreshTrayStatus = rustFunctionSource(rust, "refresh_tray_status_for_snapshot_locked");
  assert.match(
    refreshTrayStatus,
    /let presentation_phase = tray_presentation_phase\(state\.recovery_required\(\), &snapshot\.phase\)/,
  );
  assert.match(
    refreshTrayStatus,
    /\.set_text\(tray_menu_status\(language, &presentation_phase\)\)/,
  );
  assert.match(refreshTrayStatus, /let update_available = state\.update_available\(\)/);
  assert.match(
    refreshTrayStatus,
    /\.set_tooltip\(Some\(tray_presentation_tooltip\([\s\S]*?language,[\s\S]*?&presentation_phase,[\s\S]*?connection_available,[\s\S]*?update_available/,
  );
  assert.match(
    refreshTrayStatus,
    /tray_presentation_accessibility_label\([\s\S]*?language,[\s\S]*?&presentation_phase,[\s\S]*?connection_available,[\s\S]*?update_available/,
  );
  const presentationTooltip = rustFunctionSource(rust, "tray_presentation_tooltip");
  const presentationLabel = rustFunctionSource(rust, "tray_presentation_accessibility_label");
  assert.match(presentationTooltip, /if connection_available[\s\S]*?tray_tooltip[\s\S]*?tray_not_connected_tooltip/);
  assert.match(presentationTooltip, /if update_available[\s\S]*?copy::for_language|if update_available[\s\S]*?TrayCopy::for_language\(language\)\.update_available/);
  assert.match(presentationLabel, /if connection_available[\s\S]*?tray_accessibility_label[\s\S]*?tray_not_connected_accessibility_label/);
  assert.match(presentationLabel, /if update_available[\s\S]*?copy\.update_available/);

  assert.match(workflow, /runs-on:\s*windows-2022/);
  assert.match(workflow, /desktop:ci:windows/);
  assert.match(workflow, /bundle\/nsis/);
  assert.doesNotMatch(workflow, /actions\/upload-artifact/, "source checks must not distribute generated unsigned installers");
});

test("Windows minimum layout remains usable at 100, 125, and 150 percent DPI", async () => {
  const [windowsConfig, html, styles] = await Promise.all([
    readFile("desktop/src-tauri/tauri.windows.conf.json", "utf8").then(JSON.parse),
    readFile("desktop/index.html", "utf8"),
    readFile("desktop/src/styles.css", "utf8"),
  ]);
  const mainWindow = windowsConfig.app.windows.find((window) => window.label === "main");
  assert.ok(mainWindow);
  assert.equal(mainWindow.resizable, true);

  const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]+)"\s*\/?>/)?.[1];
  assert.ok(viewport, "WebView content needs an explicit responsive viewport");
  const viewportParts = Object.fromEntries(
    viewport.split(",").map((part) => part.trim().split("=").map((value) => value.trim())),
  );
  assert.equal(viewportParts.width, "device-width");
  assert.equal(viewportParts["initial-scale"], "1.0");
  assert.equal(viewportParts["maximum-scale"], undefined);
  assert.equal(viewportParts["user-scalable"], undefined);
  assert.match(
    html,
    /<meta\s+name="color-scheme"\s+content="light"/,
    "the light-only desktop theme must not request dark Windows form controls",
  );

  const body = declarationsFor(styles, "body");
  const root = declarationsFor(styles, ":root");
  const shell = declarationsFor(styles, ".shell");
  const login = declarationsFor(styles, ".login-view");
  const dialog = declarationsFor(styles, "dialog");
  const compactQuery = styles.match(/@media\s*(\(max-width:\s*\d+px\))/)?.[1];
  assert.ok(compactQuery);
  const compactHeightMatch = styles.match(
    /@media\s*(\(max-height:\s*(\d+)px\))/,
  );
  assert.ok(compactHeightMatch, "short decorated Windows windows need a vertical compact mode");
  const compactHeightQuery = compactHeightMatch[1];
  const compactHeightAt = Number(compactHeightMatch[2]);
  const compactShell = declarationsFor(styles, ".shell", compactQuery);
  const shortShell = declarationsFor(styles, ".shell", compactHeightQuery);
  const shortHeader = declarationsFor(styles, ".app-header", compactHeightQuery);
  const shortLogin = declarationsFor(styles, ".login-view", compactHeightQuery);
  const shortHero = declarationsFor(styles, ".login-hero", compactHeightQuery);
  const dialogCard = declarationsFor(styles, ".dialog-card");

  const bodyMinWidth = Number.parseInt(body["min-width"], 10);
  const shellMaxWidth = Number(shell.width.match(/min\(100%,\s*(\d+)px\)/)?.[1]);
  const compactAt = Number(compactQuery.match(/max-width:\s*(\d+)px/)?.[1]);
  const dialogParts = dialog.width.match(/min\((\d+)px,\s*calc\(100vw\s*-\s*(\d+)px\)\)/);
  assert.ok(dialogParts, "dialogs must be bounded by the current logical viewport");
  const dialogMaxWidth = Number(dialogParts[1]);
  const dialogGutter = Number(dialogParts[2]);
  const loginMinHeight = Number.parseInt(login["min-height"], 10);
  const shellPadding = shell.padding.split(/\s+/).map((value) => Number.parseInt(value, 10));

  assert.equal(body["min-height"], "100vh");
  assert.equal(root["color-scheme"], "light");
  assert.equal(shell["min-height"], "100vh");
  assert.equal(compactShell["padding-inline"], "18px");
  const compactLogin = declarationsFor(styles, ".login-hero", compactQuery);
  const compactActions = declarationsFor(styles, ".status-actions", compactQuery);
  const compactFooter = declarationsFor(styles, ".dialog-card footer", compactQuery);
  const compactFooterButton = declarationsFor(styles, ".dialog-card footer button", compactQuery);
  assert.equal(compactLogin.padding, "34px 20px 30px");
  assert.equal(compactActions["padding-inline-start"], "0");
  assert.equal(compactActions["flex-wrap"], "wrap");
  assert.equal(compactFooter["flex-direction"], "column");
  assert.equal(compactFooterButton.width, "100%");
  assert.equal(dialog["max-height"], "calc(100vh - 24px)");
  assert.equal(dialog.overflow, "hidden");
  assert.equal(dialogCard["max-height"], "calc(100vh - 24px)");
  assert.equal(dialogCard["overflow-y"], "auto");
  assert.equal(dialogCard["overscroll-behavior"], "contain");
  assert.equal(declarationsFor(styles, ".toast")["overflow-wrap"], "anywhere");
  assert.equal(declarationsFor(styles, ".logout-dialog-card > p")["overflow-wrap"], "anywhere");
  assert.ok(bodyMinWidth <= mainWindow.minWidth);
  assert.ok(compactAt >= mainWindow.minWidth);
  assert.ok(compactHeightAt >= mainWindow.height);
  assert.equal(shortShell["padding-top"], "16px");
  assert.equal(shortShell["padding-bottom"], "14px");
  assert.equal(shortHeader["margin-bottom"], "12px");
  assert.equal(shortLogin["min-height"], "300px");
  assert.equal(shortHero["padding-top"], "22px");
  assert.equal(shortHero["padding-bottom"], "20px");
  const conservativeTitleBarHeight = 32;
  const compactFirstScreenHeight =
    Number.parseInt(shortShell["padding-top"], 10) +
    32 +
    Number.parseInt(shortHeader["margin-bottom"], 10) +
    Number.parseInt(shortLogin["min-height"], 10) +
    Number.parseInt(shortShell["padding-bottom"], 10);
  assert.ok(
    compactFirstScreenHeight <= mainWindow.minHeight - conservativeTitleBarHeight,
    "the initial login surface must fit after a decorated Windows title bar consumes outer height",
  );
  const contentMinHeight = loginMinHeight + shellPadding[0] + shellPadding[2];
  assert.ok(
    contentMinHeight > mainWindow.minHeight,
    "the minimum-height admission case must exercise vertical scrolling",
  );

  for (const [selector, declarations] of [["body", body], [".shell", shell]]) {
    assert.notEqual(
      declarations.overflow,
      "hidden",
      `${selector} must remain vertically scrollable for long English copy`,
    );
    assert.notEqual(
      declarations["overflow-y"],
      "hidden",
      `${selector} must not suppress vertical overflow`,
    );
  }

  for (const scale of [1, 1.25, 1.5]) {
    const physicalWindowWidth = mainWindow.minWidth * scale;
    const logicalViewportWidth = physicalWindowWidth / scale;
    const shellWidth = Math.min(logicalViewportWidth, shellMaxWidth);
    const dialogWidth = Math.min(dialogMaxWidth, logicalViewportWidth - dialogGutter);
    assert.ok(bodyMinWidth * scale <= physicalWindowWidth);
    assert.ok(logicalViewportWidth <= compactAt, `compact layout must activate at ${scale * 100}%`);
    assert.ok(shellWidth * scale <= physicalWindowWidth);
    assert.ok(
      dialogWidth * scale <= physicalWindowWidth - dialogGutter * scale,
      `dialog gutters must survive ${scale * 100}% scaling`,
    );
    assert.ok(
      contentMinHeight * scale > mainWindow.minHeight * scale,
      `the ${scale * 100}% case must preserve scrollable overflow instead of clipping it`,
    );
  }
});

test("Windows tray Open reaches the sole main window through the focus-safe restore chain", async () => {
  const [windowsConfig, rust, workflow, nativeEntry] = await Promise.all([
    readFile("desktop/src-tauri/tauri.windows.conf.json", "utf8").then(JSON.parse),
    readFile("desktop/src-tauri/src/lib.rs", "utf8"),
    readFile(".github/workflows/windows-desktop.yml", "utf8"),
    readFile("desktop/src-tauri/src/main.rs", "utf8"),
  ]);
  assert.equal(windowsConfig.app.windows.filter((window) => window.label === "main").length, 1);
  assert.match(
    nativeEntry,
    /#!\[cfg_attr\(not\(debug_assertions\), windows_subsystem = "windows"\)\]/,
    "release startup must not flash a console window",
  );

  const showWindowSource = rustFunctionSource(rust, "show_window");
  const productionRust = rust.slice(0, rust.lastIndexOf("#[cfg(test)]"));
  const operations = [...showWindowSource.matchAll(/\.(unminimize|show|set_focus)\(\)/g)]
    .map((match) => match[1]);
  assert.deepEqual(operations, ["unminimize", "show", "set_focus"]);
  assert.equal([...productionRust.matchAll(/get_webview_window\("main"\)/g)].length, 1);
  assert.doesNotMatch(
    productionRust.replace(showWindowSource, ""),
    /\.show\(\)|\.set_focus\(\)/,
    "production Windows tray and command entry points must not bypass the shared focus behavior",
  );

  const menuHandler = rustFunctionSource(rust, "handle_tray_menu_event");
  const openAction = menuHandler.match(/"open_settings"\s*=>\s*\{([\s\S]*?)\n\s*\}/)?.[1];
  assert.ok(openAction);
  assert.match(openAction, /show_window\(app\)/);
  assert.doesNotMatch(openAction, /get_webview_window|\.show\(|\.set_focus\(/);

  const trayEvent = rust.slice(
    rust.indexOf(".on_tray_icon_event"),
    rust.indexOf("tray.build(app)?"),
  );
  assert.match(trayEvent, /MouseButton::Left/);
  assert.match(trayEvent, /MouseButtonState::Up/);
  assert.match(trayEvent, /defer_native_entry[\s\S]*?show_window\(&app\)/);
  assert.doesNotMatch(trayEvent, /get_webview_window|\.show\(|\.set_focus\(/);

  const contractTest = workflow.indexOf("node --test tests/windows-desktop.test.mjs");
  const nativeTestSidecar = workflow.indexOf(
    "Prepare Windows sidecar for native tests",
  );
  const rustTests = workflow.indexOf(
    "cargo test --manifest-path desktop/src-tauri/Cargo.toml --target x86_64-pc-windows-msvc",
  );
  const baselineBuild = workflow.indexOf("Build synthetic previous-version Windows installer");
  const installerBuild = workflow.indexOf("desktop:ci:windows");
  const installerVerify = workflow.lastIndexOf("verify-windows-installer.ps1");
  const upload = workflow.indexOf("actions/upload-artifact");
  assert.ok(
    nativeTestSidecar >= 0 && nativeTestSidecar < rustTests && rustTests >= 0 && contractTest >= 0 && rustTests < baselineBuild && contractTest < baselineBuild && baselineBuild < installerBuild && installerBuild < installerVerify && upload === -1,
    "native CI must test and verify the unsigned installer on its disposable runner without distributing it",
  );
});

test("Windows cold start, second launch, close, and quit share one lifecycle", async () => {
  const [rust, relay] = await Promise.all([
    readFile("desktop/src-tauri/src/lib.rs", "utf8"),
    readFile("desktop/src-tauri/src/relay.rs", "utf8"),
  ]);

  const singleInstance = rust.indexOf(".plugin(tauri_plugin_single_instance::init(");
  const processPlugin = rust.indexOf(".plugin(safe_process_plugin::init())");
  const setup = rust.indexOf(".setup(move |app|");
  assert.ok(
    singleInstance >= 0 && singleInstance < processPlugin && processPlugin < setup,
    "single-instance admission must happen before plugins, tray, credentials, or sidecar startup",
  );
  assert.match(
    rust,
    /tauri_plugin_autostart::init\([\s\S]*?Some\(vec!\["--background"\]\)/,
    "Windows login startup must stay hidden and must not focus an existing instance",
  );
  assert.match(
    rust,
    /should_activate_existing_instance\(&arguments\)[\s\S]*?defer_native_entry[\s\S]*?restore_window_from_native_entry\(&app\)/,
  );
  assert.match(rustFunctionSource(rust, "restore_window_from_native_entry"), /show_window\(app\)/);

  const setupSource = rust.slice(setup, rust.indexOf(".on_window_event", setup));
  const presence = setupSource.indexOf("secrets::presence_for_browsers");
  const nativeMenu = setupSource.indexOf("let native_menu_available =");
  const decision = setupSource.indexOf("let behavior =");
  const show = setupSource.indexOf("if behavior.show_main_window");
  const start = setupSource.indexOf("if behavior.start_relay");
  assert.ok(
    presence >= 0 && presence < nativeMenu && nativeMenu < decision && decision < show && show < start,
    "cold start must derive one decision from secure credential and native recovery availability before showing or starting Relay",
  );
  assert.match(
    setupSource,
    /let behavior =\s*startup_behavior\([\s\S]*?&startup_presence,[\s\S]*?native_menu_available\s*\);/,
  );
  const startupDecision = rustFunctionSource(rust, "startup_behavior");
  assert.match(
    startupDecision,
    /show_main_window:\s*!background_launch\s*\|\|\s*!native_menu_available/,
    "a background launch without a tray must reveal the only recovery window",
  );
  assert.match(
    startupDecision,
    /start_relay:\s*presence\.device_token\s*&&\s*presence\.e2ee_key/,
    "only complete secure credentials may start the Relay",
  );

  const closeHandlerStart = rust.indexOf(".on_window_event");
  const closeHandler = rust.slice(
    closeHandlerStart,
    rust.indexOf(".invoke_handler", closeHandlerStart),
  );
  assert.match(closeHandler, /CloseRequested[\s\S]*?prevent_close\(\)[\s\S]*?hide_main_window\(window\)/);
  assert.match(rustFunctionSource(rust, "hide_main_window"), /window\.hide\(\)/);
  assert.doesNotMatch(closeHandler, /app\.exit|stop_for_exit/);

  const trayMenuHandler = rustFunctionSource(rust, "handle_tray_menu_event");
  const quitAction = trayMenuHandler.match(/"quit"\s*=>\s*\{([\s\S]*?)\n\s*\}/)?.[1];
  assert.ok(quitAction);
  assert.ok(
    quitAction.indexOf("relay::stop_for_exit(&state)") < quitAction.indexOf("app.exit(0)"),
    "explicit Quit must stop the sidecar process tree before ending the GUI",
  );
  assert.match(
    quitAction,
    /process_transition_with_hooks\([\s\S]*?relay::stop_for_exit\(&state\)[\s\S]*?app\.exit\(0\)[\s\S]*?publish_native_action_error/,
    "an exit-stop failure must keep the GUI alive and expose a recoverable error",
  );
  assert.match(
    rust,
    /RunEvent::ExitRequested[\s\S]*?RunEvent::Exit[\s\S]*?relay::stop_for_exit\(&state\)/,
    "OS/app exit events need the same idempotent cleanup fallback",
  );
  const stopForExit = rustFunctionSource(relay, "stop_for_exit");
  assert.match(
    stopForExit,
    /let target = take_exit_stop_target\(state\)\?;[\s\S]*?stop_exit_target_with_hooks\(state, target, kill_relay_child, kill_relay_pid\)/,
    "exit Stop must release the runtime lock before invoking process-kill hooks",
  );
  const takeExitStopTarget = rustFunctionSource(relay, "take_exit_stop_target");
  assert.match(takeExitStopTarget, /child: runtime\.child\.take\(\)[\s\S]*?pid: runtime\.pid/);
  const stopExitTarget = rustFunctionSource(relay, "stop_exit_target_with_hooks");
  assert.match(
    stopExitTarget,
    /let kill_result = match \(target\.child, target\.pid\)[\s\S]*?kill_child\(child\)\.or_else\(\|_\| kill_pid\(pid\)\)/,
    "a consumed child handle must retain the PID fallback for a recoverable retry",
  );
  assert.ok(
    stopExitTarget.indexOf("let kill_result") < stopExitTarget.indexOf(".lock()"),
    "process termination hooks must run before the runtime mutex is reacquired",
  );
  assert.match(
    stopExitTarget,
    /if let Err\(error\) = kill_result[\s\S]*?if runtime\.pid\.is_none\(\)[\s\S]*?return Ok\(\(\)\);[\s\S]*?runtime\.phase = RelayPhase::Error;[\s\S]*?runtime\.last_error = Some\(user_error\("relay_stop_failed"\)\);[\s\S]*?return Err\(error\);/,
    "a retained live PID must block exit and preserve a visible retryable failure",
  );
  const killTree = rustFunctionSource(relay, "kill_relay_child");
  assert.match(killTree, /windows_taskkill_command\(\)[\s\S]*?"\/T"[\s\S]*?"\/F"/);
  const taskkillCommand = rustFunctionSource(relay, "windows_taskkill_command");
  assert.match(taskkillCommand, /GetSystemDirectoryW\(/);
  assert.match(taskkillCommand, /OsString::from_wide\(&buffer\[\.\.length\]\)/);
  assert.match(taskkillCommand, /join\("taskkill\.exe"\)/);
  assert.doesNotMatch(
    relay,
    /Command::new\("taskkill\.exe"\)/,
    "Windows process-tree cleanup must not search PATH or the working directory",
  );

  const autostart = rustFunctionSource(rust, "set_launch_at_login");
  assert.match(autostart, /\.enable\(\)/);
  assert.match(autostart, /\.disable\(\)/);
  assert.match(
    autostart,
    /autolaunch\(\)\.enable\(\)\.is_err\(\)[\s\S]*?autolaunch\(\)\.disable\(\)[\s\S]*?return Err\(user_error\("autostart_failed"\)\)/,
    "a partially committed auto-launch plugin write must be rolled back",
  );
  assert.match(autostart, /\.is_enabled\(\)/, "Windows must read back the applied startup state");
  assert.match(autostart, /quote_windows_autostart_command\(&app\)/);
  assert.match(
    autostart,
    /windows_autostart_state_is_committed\(enabled,[\s\S]*?autolaunch\(\)\.disable\(\)[\s\S]*?return Err\(user_error\("autostart_failed"\)\)/,
    "every incomplete post-write state must make a best-effort rollback before reporting failure",
  );
  assert.match(
    autostart,
    /windows_autostart_command_is_current\(&app\)\.map_err\(\|_\| \(\)\)/,
    "a missing, malformed, or unreadable quoted Run command must roll back enable",
  );
  assert.match(
    autostart,
    /Deletion is idempotent[\s\S]*?let _ = app\.autolaunch\(\)\.disable\(\)[\s\S]*?let enabled_after_write = app\.autolaunch\(\)\.is_enabled\(\)/,
    "disable must trust the post-write state instead of a stale delete error",
  );
  const quoteAutostart = rustFunctionSource(rust, "quote_windows_autostart_command");
  assert.match(quoteAutostart, /windows_autostart_command\(&executable\)/);
  assert.match(quoteAutostart, /CurrentVersion\\\\Run/);
  const autostartCommand = rustFunctionSource(rust, "windows_autostart_command");
  assert.match(autostartCommand, /format!\("\\\"\{\}\\\" --background"/);
});

test("Windows CI admits clean install, synthetic upgrade, and exact lifecycle cleanup", async () => {
  const [workflow, verifier, peVerifier, lifecycle, nsisHooks, ciConfig, baselineConfig, baseConfig] = await Promise.all([
    readFile(".github/workflows/windows-desktop.yml", "utf8"),
    readFile("desktop/scripts/verify-windows-installer.ps1", "utf8"),
    readFile("desktop/scripts/verify-windows-pe.mjs", "utf8"),
    readFile("desktop/scripts/smoke-windows-install-lifecycle.ps1", "utf8"),
    readFile("desktop/src-tauri/windows/nsis-hooks.nsh", "utf8"),
    readFile("desktop/src-tauri/tauri.windows-ci.conf.json", "utf8").then(JSON.parse),
    readFile("desktop/src-tauri/tauri.windows-upgrade-baseline.conf.json", "utf8").then(JSON.parse),
    readFile("desktop/src-tauri/tauri.conf.json", "utf8").then(JSON.parse),
  ]);

  assert.equal(ciConfig.bundle.createUpdaterArtifacts, false);
  assert.equal(baselineConfig.bundle.createUpdaterArtifacts, false);
  assert.ok(
    baselineConfig.version.localeCompare(baseConfig.version, undefined, { numeric: true }) < 0,
    "the synthetic installer must carry an older version",
  );
  assert.equal(
    [...workflow.matchAll(/^\s+- "package-lock\.json"$/gm)].length,
    2,
    "root dependency lockfile changes must trigger both PR and main Windows admission",
  );
  assert.match(workflow, /verify-windows-installer\.ps1/);
  assert.match(workflow, /-ExpectUnsigned/);
  assert.match(workflow, /-BundleIdentifier \$config\.identifier/);
  assert.match(workflow, /-Publisher \$config\.bundle\.publisher/);
  assert.match(workflow, /tauri\.windows-upgrade-baseline\.conf\.json/);
  assert.match(
    workflow,
    /verify-windows-installer\.ps1[\s\S]*?-ExpectedVersion \$baselineConfig\.version[\s\S]*?-ExpectUnsigned/,
    "the synthetic baseline verifier must admit only the configured previous version",
  );
  assert.match(workflow, /RELAYUNE_WINDOWS_CI_BASELINE/);
  assert.equal(
    [...workflow.matchAll(/-CurrentGuiSource desktop\/src-tauri\/target\/x86_64-pc-windows-msvc\/release\/relayune-desktop\.exe/g)].length,
    2,
    "both native lifecycles must compare the installed GUI with the current compiled PE",
  );
  assert.equal(
    [...workflow.matchAll(/-CurrentSidecarSource desktop\/src-tauri\/binaries\/relayune-core-x86_64-pc-windows-msvc\.exe/g)].length,
    2,
    "both native lifecycles must compare the installed sidecar with the current packaged PE",
  );
  assert.match(verifier, /\.exe\.sha256|\$\(\$installer\.FullName\)\.sha256/);
  assert.doesNotMatch(workflow, /actions\/upload-artifact/);
  assert.match(workflow, /verify-windows-pe\.mjs/);
  assert.match(workflow, /--gui desktop\/src-tauri\/target\/x86_64-pc-windows-msvc\/release\/relayune-desktop\.exe/);
  assert.match(workflow, /--sidecar desktop\/src-tauri\/binaries\/relayune-core-x86_64-pc-windows-msvc\.exe/);
  assert.match(workflow, /--expected-machine x64/);
  assert.match(workflow, /windows-ci-current-build-start/);
  assert.match(workflow, /WriteAllText\(\$buildMarker, \[DateTime\]::UtcNow\.ToString\("O"\)\)/);
  assert.match(workflow, /--minimum-mtime-file desktop\/src-tauri\/target\/windows-ci-current-build-start/);
  assert.match(peVerifier, /WINDOWS_GUI_SUBSYSTEM = 2/);
  assert.match(peVerifier, /WINDOWS_CUI_SUBSYSTEM = 3/);
  assert.match(peVerifier, /IMAGE_FILE_EXECUTABLE_IMAGE = 0x0002/);
  assert.match(peVerifier, /IMAGE_FILE_DLL = 0x2000/);
  assert.match(peVerifier, /IMAGE_SCN_MEM_EXECUTE = 0x20000000/);
  assert.match(peVerifier, /characteristics: buffer\.readUInt16LE\(coffOffset \+ 18\)/);
  assert.match(peVerifier, /const addressOfEntryPoint = buffer\.readUInt32LE\(optionalOffset \+ 16\)/);
  assert.match(peVerifier, /const sectionAlignment = buffer\.readUInt32LE\(optionalOffset \+ 32\)/);
  assert.match(peVerifier, /const fileAlignment = buffer\.readUInt32LE\(optionalOffset \+ 36\)/);
  assert.match(peVerifier, /const sizeOfImage = buffer\.readUInt32LE\(optionalOffset \+ 56\)/);
  assert.match(peVerifier, /numberOfDataDirectories <= 16/);
  assert.match(peVerifier, /112 \+ numberOfDataDirectories \* 8 <= optionalHeaderSize/);
  assert.match(peVerifier, /function parseImportNames/);
  assert.match(peVerifier, /function parseDelayImportNames/);
  assert.match(peVerifier, /DELAY_IMPORT_DIRECTORY_INDEX = 13/);
  assert.match(peVerifier, /function parseManifestTexts/);
  assert.match(peVerifier, /function locateRva/);
  assert.match(peVerifier, /RT_MANIFEST/);
  assert.match(peVerifier, /VC_REDISTRIBUTABLE_DLL/);
  assert.match(peVerifier, /dynamicVcRuntimeImports/);
  assert.match(peVerifier, /unexpectedRuntimeImports/);
  assert.match(peVerifier, /WINDOWS_SYSTEM_DLLS/);
  assert.match(peVerifier, /WINDOWS_API_SET_DLL/);
  assert.match(peVerifier, /must not import unpackaged non-system DLLs/);
  assert.doesNotMatch(peVerifier, /buffer\.includes\(Buffer\.from\("VCRUNTIME140/);
  assert.match(peVerifier, /vcruntime\|msvcp\|msvcr\|concrt\|vcomp\|vccorlib/);
  assert.match(peVerifier, /atl\|mfc\|mfcm/);
  assert.match(peVerifier, /COMMON_CONTROLS_ASSEMBLY_IDENTITY/);
  assert.match(peVerifier, /function stripManifestComments/);
  assert.match(peVerifier, /Microsoft\\\.Windows\\\.Common-Controls/);
  assert.match(peVerifier, /HIGH_ENTROPY_VA \| DYNAMIC_BASE \| NX_COMPAT/);
  assert.match(peVerifier, /function assertArtifactBuiltAfter/);
  assert.match(peVerifier, /artifactMtimeMs >= minimumMtimeMs/);
  assert.match(peVerifier, /stat\(minimumMtimeFile\)/);
  assert.match(peVerifier, /GUI SHA-256/);
  assert.match(peVerifier, /sidecar SHA-256/);
  assert.match(verifier, /\$installers\.Count -ne 1/);
  assert.match(verifier, /\$installer\.Length -lt 1MB/);
  assert.match(verifier, /0x4D/);
  assert.match(verifier, /0x5A/);
  assert.match(verifier, /tauri\.conf\.json/);
  assert.match(verifier, /FileVersionInfo\]::GetVersionInfo\(\$installer\.FullName\)/);
  assert.match(verifier, /\$versionInfo\.ProductName -ne \$expectedProductName/);
  assert.match(verifier, /\$versionInfo\.ProductVersion -ne \$ExpectedVersion/);
  assert.match(verifier, /Get-AuthenticodeSignature/);
  assert.match(verifier, /NotSigned/);
  assert.match(verifier, /Status -notin @\("Valid", "NotSigned"\)/);
  assert.match(verifier, /unacceptable signature status/);
  assert.match(verifier, /Get-FileHash[\s\S]*-Algorithm SHA256/);
  assert.match(verifier, /\.exe\.sha256|\$\(\$installer\.FullName\)\.sha256/);
  assert.match(nsisHooks, /!macro NSIS_HOOK_POSTUNINSTALL/);
  assert.match(nsisHooks, /\$UpdateMode <> 1/);
  assert.match(
    nsisHooks,
    /DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run" "\$\{PRODUCTNAME\}"/,
  );

  assert.equal([...workflow.matchAll(/verify-windows-installer\.ps1/g)].length, 2);
  const baselineBuild = workflow.indexOf("Build synthetic previous-version Windows installer");
  const currentBuild = workflow.indexOf("Build unsigned Windows test installer");
  const currentBuildMarker = workflow.indexOf("windows-ci-current-build-start");
  const peVerify = workflow.indexOf("Verify Windows PE runtime contracts");
  const verify = workflow.lastIndexOf("verify-windows-installer.ps1");
  const nativeLifecycle = workflow.indexOf("smoke-windows-install-lifecycle.ps1");
  const cleanCurrentLifecycle = workflow.indexOf("Smoke clean current install and first-launch recovery");
  const upload = workflow.indexOf("actions/upload-artifact");
  assert.ok(
    baselineBuild >= 0 && baselineBuild < currentBuild && currentBuild <= currentBuildMarker && currentBuildMarker < peVerify && peVerify < verify && verify < nativeLifecycle && nativeLifecycle < cleanCurrentLifecycle && upload === -1,
    "CI must verify both native lifecycle smokes on its disposable runner and leave binary distribution disabled",
  );
  assert.equal(
    [...workflow.matchAll(/smoke-windows-install-lifecycle\.ps1/g)].length,
    2,
    "CI must test both synthetic update and the current installer's true clean-install path",
  );
  assert.equal(
    [...workflow.matchAll(/WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = \$fixedRuntimePoison/g)].length,
    2,
    "upgrade and clean-current lifecycles must both reject a runner-only fixed WebView2 Runtime override",
  );
  assert.equal(
    [...workflow.matchAll(/The lifecycle did not restore the inherited WebView2 override/g)].length,
    2,
    "each native lifecycle must prove that launch isolation restores its parent environment",
  );
  assert.equal(
    [...workflow.matchAll(/\$previousFixedRuntimeOverride = \[Environment\]::GetEnvironmentVariable\("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", "Process"\)/g)].length,
    2,
    "workflow poisoning must preserve any pre-existing runner override",
  );
  assert.equal(
    [...workflow.matchAll(/SetEnvironmentVariable\([\s\S]*?"WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",[\s\S]*?\$previousFixedRuntimeOverride,[\s\S]*?"Process"[\s\S]*?\)/g)].length,
    2,
    "workflow cleanup must restore the exact pre-test override instead of assuming it was absent",
  );
  const cleanCurrentStep = workflow.slice(cleanCurrentLifecycle, upload);
  const upgradeLifecycleStep = workflow.slice(nativeLifecycle, cleanCurrentLifecycle);
  assert.doesNotMatch(cleanCurrentStep, /BaselineInstallerDirectory|ExpectedBaselineVersion/);
  assert.match(upgradeLifecycleStep, /-ExpectedUiLanguage zh-CN/);
  assert.doesNotMatch(upgradeLifecycleStep, /-ExpectedUiLanguage system/);
  assert.match(cleanCurrentStep, /-ExpectedUiLanguage system/);
  assert.doesNotMatch(cleanCurrentStep, /-ExpectedUiLanguage zh-CN/);
  assert.match(lifecycle, /\[ValidateSet\("system", "en", "zh-CN"\)\]/);
  assert.match(lifecycle, /\[string\]\$ExpectedUiLanguage = "system"/);
  assert.match(lifecycle, /\$systemUiCultureName = \[RelayuneWindowProbe\]::PreferredUiLanguage\(\)/);
  const preferredUiLanguageProbe = lifecycle.match(/public static string PreferredUiLanguage\(\) \{[\s\S]*?^  \}/m)?.[0];
  assert.ok(preferredUiLanguageProbe, "system-language UIA expectations must use the same Win32 source as sys-locale");
  assert.match(preferredUiLanguageProbe, /MUI_LANGUAGE_NAME = 0x8/);
  assert.match(preferredUiLanguageProbe, /GetUserPreferredUILanguagesLength/);
  assert.match(preferredUiLanguageProbe, /GetUserPreferredUILanguagesBuffer/);
  assert.match(preferredUiLanguageProbe, /languageCount == 0 \|\| bufferLength < 2/);
  assert.match(preferredUiLanguageProbe, /Array\.IndexOf\(buffer, '\\0'\)/);
  assert.match(preferredUiLanguageProbe, /throw new InvalidOperationException/);
  assert.doesNotMatch(lifecycle, /CultureInfo\]::CurrentUICulture/);
  assert.match(
    lifecycle,
    /\$expectedUiLanguageCode = if \(\$ExpectedUiLanguage -eq "system"\)[\s\S]*?StartsWith\("zh", \[StringComparison\]::OrdinalIgnoreCase\)[\s\S]*?"zh-CN"[\s\S]*?"en"/,
  );
  assert.match(
    lifecycle,
    /\$startupFallbackUiLanguageCode = if \([\s\S]*?\$systemUiCultureName\.StartsWith\("zh", \[StringComparison\]::OrdinalIgnoreCase\)[\s\S]*?"zh-CN"[\s\S]*?"en"/,
    "a malformed config must use the actual system-language startup fallback rather than the unreadable persisted override",
  );
  assert.match(lifecycle, /\$persistedUiLanguage = if \(\$ExpectedUiLanguage -eq "system"\) \{ \$null \} else \{ \$ExpectedUiLanguage \}/);
  assert.match(lifecycle, /refusing to mutate an existing installation/);
  const installEntryProbe = lifecycle.match(/function Get-RelayuneInstallEntry \{[\s\S]*?^\}/m)?.[0];
  assert.ok(installEntryProbe, "ARP discovery must distinguish an absent product from an unreadable registry entry");
  assert.match(
    installEntryProbe,
    /Get-ChildItem -LiteralPath \$uninstallRegistryPath -ErrorAction Stop/,
  );
  assert.match(installEntryProbe, /\$uninstallKey = \$_/);
  assert.match(installEntryProbe, /Get-ItemProperty -LiteralPath \$uninstallKey\.PSPath -ErrorAction Stop/);
  assert.match(installEntryProbe, /Could not inspect uninstall registry entry/);
  assert.doesNotMatch(
    installEntryProbe,
    /SilentlyContinue/,
    "registry access failures must not look like clean install or completed uninstall state",
  );
  assert.match(lifecycle, /function Invoke-SilentInstaller[\s\S]*?\[string\[\]\]\$Arguments = @\("\/S"\)/);
  assert.match(lifecycle, /Start-Process -FilePath \$Path -ArgumentList \$Arguments -PassThru -Wait/);
  assert.match(lifecycle, /APPDATA, LOCALAPPDATA, and SystemRoot are required/);
  assert.match(lifecycle, /\$cleanShellWorkingDirectory = Join-Path \$env:SystemRoot "System32"/);
  assert.match(lifecycle, /\$cleanLaunchPath = @\([\s\S]*?\$cleanShellWorkingDirectory[\s\S]*?System32\\Wbem[\s\S]*?System32\\WindowsPowerShell\\v1\.0[\s\S]*?\) -join ";"/);
  const installedGuiLauncher = lifecycle.match(/function Start-InstalledGui \{[\s\S]*?^\}/m)?.[0];
  assert.ok(installedGuiLauncher, "installed GUI launches must not inherit build-runner DLL search paths");
  assert.match(installedGuiLauncher, /Split-Path -Parent \$Path\) -ne \$expectedInstallDirectory/);
  assert.match(installedGuiLauncher, /WorkingDirectory = \$expectedInstallDirectory/);
  assert.match(installedGuiLauncher, /Get-InstalledLaunchEnvironmentSnapshot/);
  assert.match(installedGuiLauncher, /Set-InstalledLaunchEnvironmentClean -Snapshot \$environmentSnapshot/);
  assert.match(installedGuiLauncher, /finally \{[\s\S]*?Restore-InstalledLaunchEnvironment -Snapshot \$environmentSnapshot/);
  const installedShortcutLauncher = lifecycle.match(/function Start-InstalledShortcut \{[\s\S]*?^\}/m)?.[0];
  assert.ok(installedShortcutLauncher, "installed shortcuts must launch independently from the runner workspace");
  assert.match(installedShortcutLauncher, /\$previousPowerShellLocation = \(Get-Location\)\.Path/);
  assert.match(installedShortcutLauncher, /\$previousProcessDirectory = \[Environment\]::CurrentDirectory/);
  assert.match(installedShortcutLauncher, /Set-Location -LiteralPath \$cleanShellWorkingDirectory/);
  assert.match(installedShortcutLauncher, /\[Environment\]::CurrentDirectory = \$cleanShellWorkingDirectory/);
  assert.doesNotMatch(installedShortcutLauncher, /-WorkingDirectory/);
  assert.match(installedShortcutLauncher, /Set-InstalledLaunchEnvironmentClean -Snapshot \$environmentSnapshot/);
  assert.match(
    installedShortcutLauncher,
    /finally \{[\s\S]*?Set-Location -LiteralPath \$previousPowerShellLocation[\s\S]*?\[Environment\]::CurrentDirectory = \$previousProcessDirectory[\s\S]*?Restore-InstalledLaunchEnvironment -Snapshot \$environmentSnapshot/,
  );
  const installedEnvironmentSnapshot = lifecycle.match(/function Get-InstalledLaunchEnvironmentSnapshot \{[\s\S]*?^\}/m)?.[0];
  assert.ok(installedEnvironmentSnapshot, "clean launches must discover every inherited WebView2 override");
  assert.match(installedEnvironmentSnapshot, /GetEnvironmentVariables\("Process"\)/);
  assert.match(installedEnvironmentSnapshot, /StartsWith\("WEBVIEW2_", \[StringComparison\]::OrdinalIgnoreCase\)/);
  assert.match(installedEnvironmentSnapshot, /"__COMPAT_LAYER"/);
  const cleanInstalledEnvironment = lifecycle.match(/function Set-InstalledLaunchEnvironmentClean \{[\s\S]*?^\}/m)?.[0];
  assert.ok(cleanInstalledEnvironment, "the child environment must remove runner-only WebView and compatibility overrides");
  assert.match(cleanInstalledEnvironment, /SetEnvironmentVariable\("Path", \$cleanLaunchPath, "Process"\)/);
  assert.match(cleanInstalledEnvironment, /SetEnvironmentVariable\(\$name, \$null, "Process"\)/);
  const restoredInstalledEnvironment = lifecycle.match(/function Restore-InstalledLaunchEnvironment \{[\s\S]*?^\}/m)?.[0];
  assert.ok(restoredInstalledEnvironment, "launch isolation must not mutate the workflow environment after CreateProcess");
  assert.match(restoredInstalledEnvironment, /SetEnvironmentVariable\("Path", \$Snapshot\.Path, "Process"\)/);
  assert.match(restoredInstalledEnvironment, /SetEnvironmentVariable\(\$name, \$Snapshot\.Overrides\[\$name\], "Process"\)/);
  assert.equal(
    [...lifecycle.matchAll(/Start-InstalledGui -Path \$appExecutable/g)].length,
    4,
    "default config creation, startup recovery, hidden startup, and post-cancel cold restart must all use the clean-machine launcher",
  );
  assert.doesNotMatch(lifecycle, /Start-Process -FilePath \$appExecutable/);
  assert.match(lifecycle, /DisplayVersion -ne \$Version/);
  assert.match(lifecycle, /Publisher -ne \$Publisher/);
  const installedLayoutProbe = lifecycle.match(/function Get-InstalledLayout \{[\s\S]*?^\}/m)?.[0];
  assert.ok(installedLayoutProbe, "the lifecycle must fail closed while resolving each installed layout");
  assert.match(
    installedLayoutProbe,
    /\[System\.Diagnostics\.FileVersionInfo\]::GetVersionInfo\(\$appExecutable\)/,
  );
  assert.match(installedLayoutProbe, /\$appVersionInfo\.ProductName -ne \$ProductName/);
  assert.match(installedLayoutProbe, /\$appVersionInfo\.ProductVersion -ne \$Version/);
  assert.match(
    installedLayoutProbe,
    /\$expectedUninstallCommand = "`"\$registeredUninstaller`""[\s\S]*?\$entry\.UninstallString -ne \$expectedUninstallCommand/,
    "the smoke must admit the exact Add/Remove Programs command, not invoke a separately reconstructed path",
  );
  assert.match(installedLayoutProbe, /\$expectedDisplayIcon = "`"\$appExecutable`""/);
  assert.match(installedLayoutProbe, /\$entry\.DisplayIcon -ne \$expectedDisplayIcon/);
  assert.match(installedLayoutProbe, /\$entry\.MainBinaryName -ne \[IO\.Path\]::GetFileName\(\$appExecutable\)/);
  assert.match(installedLayoutProbe, /\[int\]\$entry\.NoModify -ne 1 -or \[int\]\$entry\.NoRepair -ne 1/);
  assert.match(installedLayoutProbe, /\$null -eq \$entry\.EstimatedSize -or \[uint32\]\$entry\.EstimatedSize -eq 0/);
  assert.match(installedLayoutProbe, /Add\/Remove Programs has an unexpected uninstall command/);
  assert.match(
    installedLayoutProbe,
    /\$appLocalDlls = @\(Get-ChildItem -LiteralPath \$installDirectory -Filter "\*\.dll" -File\)/,
  );
  assert.match(installedLayoutProbe, /\$appLocalDlls\.Count -ne 0/);
  assert.match(installedLayoutProbe, /unexpected app-local DLL payloads/);
  const installedAclProbe = lifecycle.match(/function Assert-NoBroadWriteAccess \{[\s\S]*?^\}/m)?.[0];
  assert.ok(installedAclProbe, "installed payload provenance must reject cross-user write access");
  for (const sid of ["S-1-1-0", "S-1-5-11", "S-1-5-32-545", "S-1-5-32-546"]) {
    assert.match(installedAclProbe, new RegExp(sid.replaceAll("-", "\\-")));
  }
  assert.match(installedAclProbe, /AccessControlType\]::Allow/);
  assert.match(installedAclProbe, /FileSystemRights\]::Write/);
  assert.match(installedAclProbe, /FileSystemRights\]::ChangePermissions/);
  assert.match(installedAclProbe, /FileSystemRights\]::TakeOwnership/);
  assert.match(installedAclProbe, /IdentityReference\.Translate/);
  assert.match(installedAclProbe, /\[int64\]\$rule\.FileSystemRights -band \[int64\]\$unsafeRights/);
  for (const installedPath of ["installDirectory", "registeredUninstaller", "appExecutable", "sidecarPath"]) {
    assert.match(
      installedLayoutProbe,
      new RegExp(`Path = \\$${installedPath}; Description =`),
      `each baseline/current ${installedPath} ACL must be admitted before launch`,
    );
  }
  assert.match(installedLayoutProbe, /Assert-NoBroadWriteAccess -Path \$payload\.Path -Description \$payload\.Description/);
  assert.match(lifecycle, /Invoke-SilentInstaller -Path \$installer\.FullName -Arguments @\("\/S", "\/UPDATE"\)/);
  assert.match(
    lifecycle,
    /\$upgradeConfigFixture = \[ordered\]@\{[\s\S]*?server_url = \$expectedProductionServerUrl[\s\S]*?browser_ids = @\(\)[\s\S]*?ui_language = \$null[\s\S]*?WriteAllText\(\$testConfigPath, \$upgradeConfigFixture[\s\S]*?\$preUpgradeConfigHash = \(Get-FileHash -LiteralPath \$testConfigPath -Algorithm SHA256\)\.Hash[\s\S]*?Invoke-SilentInstaller -Path \$installer\.FullName -Arguments @\("\/S", "\/UPDATE"\)[\s\S]*?Test-Path -LiteralPath \$testConfigPath -PathType Leaf[\s\S]*?Get-FileHash -LiteralPath \$testConfigPath -Algorithm SHA256\)\.Hash -ne \$preUpgradeConfigHash[\s\S]*?Remove-Item -LiteralPath \$testConfigPath -Force[\s\S]*?Could not remove the non-secret upgrade config fixture before the real first run/,
    "the updater must preserve actual config bytes before the fixture is removed for a separate first-run proof",
  );
  assert.match(lifecycle, /updater path deleted the existing Relayune config/);
  assert.match(lifecycle, /updater path changed the existing Relayune config/);
  assert.match(lifecycle, /upgradeSentinel/);
  assert.match(lifecycle, /updater path did not preserve the quoted login-start command/);
  assert.match(lifecycle, /updater path did not preserve the enabled StartupApproved value/);
  const expectedAutostartProbe = lifecycle.match(/function Assert-ExpectedAutostartState \{[\s\S]*?\n\}/)?.[0];
  assert.ok(expectedAutostartProbe, "clean and upgrade installs must retain different login-start invariants");
  assert.match(expectedAutostartProbe, /if \(\$hasUpgradeBaseline\)/);
  assert.match(expectedAutostartProbe, /\$expectedCommand = "`"\$AppExecutable`" --background"/);
  assert.match(expectedAutostartProbe, /Test-AutostartApprovalEnabled/);
  assert.match(expectedAutostartProbe, /if \(\$null -ne \$actualCommand\)/);
  assert.match(expectedAutostartProbe, /clean install or first launch unexpectedly enabled login startup/);
  assert.match(expectedAutostartProbe, /if \(\$null -ne \$actualApproval\)/);
  assert.match(expectedAutostartProbe, /clean install or first launch unexpectedly created StartupApproved state/);
  assert.equal(
    [...lifecycle.matchAll(/Assert-ExpectedAutostartState -AppExecutable \$appExecutable/g)].length,
    3,
    "autostart must be checked after installation, tray recovery, and the post-cancel cold restart",
  );
  assert.match(
    lifecycle,
    /installedSidecarHash -eq \$baselineSidecarHash[\s\S]*?Assert-ExpectedAutostartState -AppExecutable \$appExecutable[\s\S]*?Start-InstalledGui -Path \$appExecutable -Arguments @\("--background"\)/,
    "the installer result must be checked before the first GUI launch can mutate login-start state",
  );
  assert.match(
    lifecycle,
    /Wait-ForAccessibleLoginAction -WindowHandle \$restoredWindows\[0\][\s\S]*?Assert-ExpectedAutostartState -AppExecutable \$appExecutable[\s\S]*?Stop-ExactProcess -Process \$primary/,
    "the completed first-login/cancel/reopen journey must not silently change login startup",
  );
  assert.match(lifecycle, /installedGuiHash -ne \$currentSourceGuiHash/);
  assert.match(lifecycle, /baselineGuiHash = \(Get-FileHash -LiteralPath \$baselineLayout\.AppExecutable -Algorithm SHA256\)\.Hash/);
  assert.match(lifecycle, /\$hasUpgradeBaseline -and \$installedGuiHash -eq \$baselineGuiHash/);
  assert.match(lifecycle, /synthetic baseline and current GUI hashes are identical; the GUI upgrade assertion is not executable/);
  assert.match(lifecycle, /installedSidecarHash -ne \$currentSourceSidecarHash/);
  assert.match(lifecycle, /\$hasUpgradeBaseline -and \$installedSidecarHash -eq \$baselineSidecarHash/);
  assert.match(lifecycle, /Get-WebView2RuntimeVersion/);
  const webViewProbe = lifecycle.match(/function Get-WebView2RuntimeVersion \{[\s\S]*?\n\}/)?.[0];
  assert.ok(webViewProbe, "the lifecycle must define an exact WebView2 Runtime probe");
  assert.match(webViewProbe, /Get-ExactRegistryValue -Path \$registryPath -Name "pv"/);
  assert.doesNotMatch(webViewProbe, /SilentlyContinue/);
  assert.match(lifecycle, /WebView2 Runtime is still missing after NSIS installation/);
  assert.match(lifecycle, /Join-Path \$installDirectory "relayune-core\.exe"/);
  assert.match(lifecycle, /silent NSIS install did not create expected shortcut/i);
  const shortcutLayoutProbe = lifecycle.match(/function Get-ShortcutLayout \{[\s\S]*?^\}/m)?.[0];
  assert.ok(shortcutLayoutProbe, "shortcut metadata must be read through Windows Shell COM");
  assert.match(shortcutLayoutProbe, /New-Object -ComObject WScript\.Shell/);
  assert.match(shortcutLayoutProbe, /New-Object -ComObject Shell\.Application/);
  assert.match(shortcutLayoutProbe, /\.Namespace\(\(Split-Path -Parent \$Path\)\)/);
  assert.match(shortcutLayoutProbe, /\.ParseName\(\(Split-Path -Leaf \$Path\)\)/);
  assert.match(shortcutLayoutProbe, /ExtendedProperty\("System\.AppUserModel\.ID"\)/);
  assert.match(shortcutLayoutProbe, /AppUserModelId = \[string\]/);
  assert.equal(
    [...shortcutLayoutProbe.matchAll(/FinalReleaseComObject/g)].length,
    5,
    "link and property-system COM objects must all be released",
  );
  assert.match(lifecycle, /Get-ShortcutLayout -Path \$shortcut/);
  assert.match(lifecycle, /shortcut does not target the installed Relayune GUI/i);
  assert.match(lifecycle, /shortcut unexpectedly adds launch arguments/i);
  assert.match(lifecycle, /WorkingDirectory = \$shortcut\.WorkingDirectory/);
  assert.match(lifecycle, /-not \[string\]::IsNullOrWhiteSpace\(\$shortcutLayout\.WorkingDirectory\)/);
  assert.match(lifecycle, /shortcut unexpectedly supplies a working directory/i);
  assert.match(lifecycle, /\$shortcutLayout\.AppUserModelId -ne \$BundleIdentifier/);
  assert.match(lifecycle, /shortcut has an unexpected Windows AppUserModelID/i);
  const shortcutActivationProbe = lifecycle.match(/function Start-InstalledShortcut \{[\s\S]*?\n\}/)?.[0];
  assert.ok(shortcutActivationProbe, "installed shortcuts must be activated through Windows Shell");
  assert.match(shortcutActivationProbe, /Test-Path -LiteralPath \$Path -PathType Leaf/);
  assert.match(
    shortcutActivationProbe,
    /Start-Process[\s\S]*?-FilePath \$Path[\s\S]*?-Verb Open[\s\S]*?-PassThru/,
  );
  assert.doesNotMatch(shortcutActivationProbe, /-WorkingDirectory/);
  assert.match(shortcutActivationProbe, /Windows Shell did not return a process/);
  assert.match(
    lifecycle,
    /\$secondary = Start-InstalledShortcut -Path \$desktopShortcut -EntryPoint "desktop"[\s\S]*?\$secondary\.WaitForExit\(10_000\)[\s\S]*?\$secondary\.ExitCode -ne 0/,
    "the desktop shortcut must drive the interactive single-instance handoff",
  );
  assert.match(
    lifecycle,
    /CloseWindow\(\$mainWindowHandle\)[\s\S]*?\$reopen = Start-InstalledShortcut -Path \$startMenuShortcut -EntryPoint "Start menu"[\s\S]*?\$reopen\.WaitForExit\(10_000\)[\s\S]*?\$reopen\.ExitCode -ne 0/,
    "the Start menu shortcut must restore the close-to-tray window",
  );
  assert.match(lifecycle, /InstallLocation\.Trim\(\[char\]34\) -ne \$expectedInstallDirectory/);
  assert.match(lifecycle, /Start-InstalledGui -Path \$appExecutable -Arguments @\("--background"\)/);
  assert.match(lifecycle, /Assert-BackgroundStartupIsQuiet -Process \$primary -SidecarPath \$sidecar/);
  const backgroundSampleProbe = lifecycle.match(/function Assert-BackgroundStartupSample \{[\s\S]*?\n\}/)?.[0];
  assert.ok(backgroundSampleProbe, "every pre-interactive startup phase must reuse the fail-closed quiet sample");
  assert.match(backgroundSampleProbe, /VisibleWindows\(\[uint32\]\$Process\.Id\)/);
  assert.match(backgroundSampleProbe, /ForegroundProcessId\(\) -eq \[uint32\]\$Process\.Id/);
  assert.match(backgroundSampleProbe, /stole foreground focus while running in the background/);
  assert.match(backgroundSampleProbe, /Get-ExactPathProcesses -ExecutablePath \$SidecarPath/);
  const backgroundQuietProbe = lifecycle.match(/function Assert-BackgroundStartupIsQuiet \{[\s\S]*?\n\}/)?.[0];
  assert.ok(backgroundQuietProbe, "the native lifecycle must observe the entire quiet-start interval");
  assert.match(backgroundQuietProbe, /Assert-BackgroundStartupSample -Process \$Process -SidecarPath \$SidecarPath/);
  assert.match(backgroundQuietProbe, /AddSeconds\(5\)/);
  const webViewWaitProbe = lifecycle.match(/function Wait-ForWebView2Process \{[\s\S]*?\n\}/)?.[0];
  assert.ok(webViewWaitProbe, "WebView2 readiness must not create an unchecked post-quiet interval");
  assert.match(webViewWaitProbe, /Assert-BackgroundStartupSample -Process \$Process -SidecarPath \$SidecarPath/);
  assert.match(webViewWaitProbe, /Test-ProcessTreeContainsName -RootProcessId \$Process\.Id -ProcessName "msedgewebview2\.exe"/);
  assert.match(webViewWaitProbe, /AddSeconds\(10\)/);
  const webViewProcessProbe = lifecycle.match(/function Test-ProcessTreeContainsName \{[\s\S]*?\n\}/)?.[0];
  assert.ok(webViewProcessProbe, "the native lifecycle must define an owned-process-tree WebView2 probe");
  assert.match(webViewProcessProbe, /Get-CimInstance -ClassName Win32_Process -ErrorAction Stop/);
  assert.match(webViewProcessProbe, /HashSet\[uint32\]/);
  assert.match(webViewProcessProbe, /candidate\.ParentProcessId/);
  assert.match(webViewProcessProbe, /StringComparison\]::OrdinalIgnoreCase/);
  assert.match(
    lifecycle,
    /Assert-BackgroundStartupIsQuiet[\s\S]*?Wait-ForWebView2Process -Process \$primary -SidecarPath \$sidecar/,
    "a hidden first start must own a real WebView2 descendant before an interactive second launch",
  );
  assert.match(lifecycle, /-ProcessName "msedgewebview2\.exe"/);
  assert.match(lifecycle, /Timed out waiting for the installed Relayune process \$\(\$Process\.Id\) to create its WebView2 process tree/);
  const ownedProcessSnapshotProbe = lifecycle.match(/function Get-OwnedProcessInstancesByName \{[\s\S]*?\n\}/)?.[0];
  assert.ok(ownedProcessSnapshotProbe, "the lifecycle must retain identity for owned WebView2 instances before cleanup");
  assert.match(ownedProcessSnapshotProbe, /Get-CimInstance -ClassName Win32_Process -ErrorAction Stop/);
  assert.match(ownedProcessSnapshotProbe, /HashSet\[uint32\]/);
  assert.match(ownedProcessSnapshotProbe, /candidate\.ParentProcessId/);
  assert.match(ownedProcessSnapshotProbe, /candidate\.CreationDate/);
  assert.match(ownedProcessSnapshotProbe, /ToUniversalTime\(\)\.Ticks/);
  assert.match(ownedProcessSnapshotProbe, /exposed no creation time/);
  const ownedProcessExitProbe = lifecycle.match(/function Wait-ForOwnedProcessInstancesExit \{[\s\S]*?\n\}/)?.[0];
  assert.ok(ownedProcessExitProbe, "the lifecycle must fail when a captured WebView2 instance survives GUI cleanup");
  assert.match(ownedProcessExitProbe, /Get-CimInstance -ClassName Win32_Process -ErrorAction Stop/);
  assert.match(ownedProcessExitProbe, /candidate\.ProcessId -eq \$record\.ProcessId/);
  assert.match(ownedProcessExitProbe, /candidate\.CreationDate/);
  assert.match(ownedProcessExitProbe, /record\.CreationTicks/);
  assert.match(ownedProcessExitProbe, /Owned \$ProcessName process instances survived Relayune process-tree cleanup/);
  assert.match(
    lifecycle,
    /\$ownedWebView2Snapshot = @\([\s\S]*?Get-OwnedProcessInstancesByName -RootProcessId \$primary\.Id -ProcessName "msedgewebview2\.exe"[\s\S]*?Stop-ExactProcess -Process \$primary[\s\S]*?Wait-ForOwnedProcessInstancesExit -Snapshot \$ownedWebView2Snapshot -ProcessName "msedgewebview2\.exe"[\s\S]*?Get-ExactPathProcesses -ExecutablePath \$appExecutable/,
    "captured WebView2 identities must exit before the GUI-path and uninstall assertions continue",
  );
  assert.match(lifecycle, /\$secondary\.WaitForExit\(10_000\)/);
  assert.match(lifecycle, /\$secondary\.ExitCode -ne 0/);
  assert.match(lifecycle, /if \(!enumerated\)[\s\S]*?EnumWindows failed with Win32 error/);
  assert.match(lifecycle, /\$mainWindowHandle = \$visibleWindows\[0\]/);
  assert.match(lifecycle, /WindowTitle\(\$mainWindowHandle\) -ne \$ProductName/);
  assert.match(lifecycle, /GetWindowDpiAwarenessContext\(IntPtr window\)/);
  assert.match(lifecycle, /AreDpiAwarenessContextsEqual\(IntPtr contextA, IntPtr contextB\)/);
  assert.match(lifecycle, /var perMonitorV2 = new IntPtr\(-4\)/);
  assert.doesNotMatch(lifecycle, /GetAwarenessFromDpiAwarenessContext/);
  assert.equal(
    [...lifecycle.matchAll(/IsPerMonitorV2\((?:\$mainWindowHandle|\$restoredWindows\[0\]|\$coldRestartWindows\[0\])\)/g)].length,
    3,
    "initial, tray-restored, and process-cold-started windows must all prove exact Per-Monitor v2 context",
  );
  assert.match(lifecycle, /IsPerMonitorV2\(\$startupFailureWindowHandle\)/);
  assert.match(lifecycle, /Add-Type -AssemblyName UIAutomationClient/);
  assert.match(lifecycle, /Add-Type -AssemblyName UIAutomationTypes/);
  const accessibleActionProbe = lifecycle.match(/function Wait-ForAccessibleActionPattern \{[\s\S]*?\n\}/)?.[0];
  assert.ok(accessibleActionProbe, "the native lifecycle must inspect rendered first-login WebView content");
  assert.match(accessibleActionProbe, /AutomationElement\]::FromHandle\(\$WindowHandle\)/);
  assert.match(accessibleActionProbe, /TreeScope\]::Descendants/);
  assert.match(accessibleActionProbe, /ControlType\]::Button/);
  assert.match(accessibleActionProbe, /IsEnabledProperty/);
  assert.match(accessibleActionProbe, /IsOffscreenProperty/);
  assert.match(accessibleActionProbe, /InvokePattern\]::Pattern/);
  assert.match(accessibleActionProbe, /\$isChinese = \$expectedUiLanguageCode -eq "zh-CN"/);
  assert.doesNotMatch(accessibleActionProbe, /CurrentUICulture/);
  assert.match(accessibleActionProbe, /Sign in & connect in browser/);
  assert.match(accessibleActionProbe, /在浏览器中登录并连接/);
  assert.match(accessibleActionProbe, /Cancel connection/);
  assert.match(accessibleActionProbe, /取消连接/);
  assert.match(accessibleActionProbe, /string\]::Equals\(\$name, \$expectedName, \[StringComparison\]::Ordinal\)/);
  assert.doesNotMatch(accessibleActionProbe, /\$expectedNames -contains \$name/);
  const startupRetryProbe = lifecycle.match(/function Wait-ForAccessibleStartupFailureRetryPattern \{[\s\S]*?\n\}/)?.[0];
  assert.ok(startupRetryProbe, "the native lifecycle must inspect a real first-start failure before claiming Retry recovery");
  assert.match(startupRetryProbe, /\$startupFallbackUiLanguageCode -eq "zh-CN"/);
  assert.match(startupRetryProbe, /Relayune 暂时无法启动。请检查网络后重试，或打开帮助与诊断。/);
  assert.match(startupRetryProbe, /Relayune could not start\. Check your connection, then try again or open Help & Diagnostics\./);
  assert.match(startupRetryProbe, /重新尝试/);
  assert.match(startupRetryProbe, /Try again/);
  assert.match(startupRetryProbe, /ControlType\]::Text/);
  assert.match(startupRetryProbe, /ControlType\]::Button/);
  assert.match(startupRetryProbe, /IsEnabledProperty/);
  assert.match(startupRetryProbe, /IsOffscreenProperty/);
  assert.match(startupRetryProbe, /HasKeyboardFocusProperty/);
  assert.match(startupRetryProbe, /InvokePattern\]::Pattern/);
  assert.match(startupRetryProbe, /\$failureVisible/);
  assert.doesNotMatch(startupRetryProbe, /CurrentUICulture|Get-Content|ConvertFrom-Json|Write-(?:Host|Output)/);
  const invokeLoginProbe = lifecycle.match(/function Invoke-FirstLoginActionAndCancel \{[\s\S]*?\n\}/)?.[0];
  assert.ok(invokeLoginProbe, "the native lifecycle must actually exercise and cancel first login");
  assert.match(invokeLoginProbe, /\$loginPattern\.Invoke\(\)/);
  assert.match(invokeLoginProbe, /Wait-ForLoopbackPairingRequest -Stub \$Stub -PreviousCount \$requestsBefore/);
  assert.match(invokeLoginProbe, /Wait-ForAccessibleRecoveryCancelPattern -WindowHandle \$WindowHandle/);
  assert.match(invokeLoginProbe, /\$cancelPattern\.Invoke\(\)/);
  assert.match(
    invokeLoginProbe,
    /\$cancelPattern\.Invoke\(\)[\s\S]*?Wait-ForAccessibleActionPattern -WindowHandle \$WindowHandle -Action "Login"[\s\S]*?Assert-LoopbackPairingRequestsStopped -Stub \$Stub[\s\S]*?Wait-ForAccessibleLoginKeyboardFocus -WindowHandle \$WindowHandle/,
    "cancel must restore and focus the initial login action while stopping retry traffic without reading generated secrets",
  );
  const stoppedPairingProbe = lifecycle.match(/function Assert-LoopbackPairingRequestsStopped \{[\s\S]*?\n\}/)?.[0];
  assert.ok(stoppedPairingProbe, "the native lifecycle must reject UI-only cancellation that leaves pairing retries alive");
  assert.match(stoppedPairingProbe, /\$countAfterCancel = \$Stub\.RequestCount/);
  assert.match(stoppedPairingProbe, /AddMilliseconds\(2_500\)/);
  assert.match(stoppedPairingProbe, /\$Stub\.RequestCount -ne \$countAfterCancel/);
  assert.match(stoppedPairingProbe, /cancelled first-login flow continued sending pairing-start requests/);
  const loginFocusProbe = lifecycle.match(/function Wait-ForAccessibleLoginKeyboardFocus \{[\s\S]*?\n\}/)?.[0];
  assert.ok(loginFocusProbe, "foreground ownership must not substitute for keyboard focus on the login CTA");
  assert.match(loginFocusProbe, /AutomationElement\]::FromHandle\(\$WindowHandle\)/);
  assert.match(loginFocusProbe, /HasKeyboardFocusProperty/);
  assert.match(loginFocusProbe, /IsEnabledProperty/);
  assert.match(loginFocusProbe, /IsOffscreenProperty/);
  assert.match(loginFocusProbe, /\$expectedUiLanguageCode -eq "zh-CN"/);
  assert.match(loginFocusProbe, /Sign in & connect in browser/);
  assert.match(loginFocusProbe, /在浏览器中登录并连接/);
  assert.match(loginFocusProbe, /\$enabled -and[\s\S]*?-not \$offscreen -and[\s\S]*?\$focused/);
  assert.match(loginFocusProbe, /did not receive keyboard focus/);
  const recoveryProbe = lifecycle.match(/function Wait-ForAccessibleRecoveryCancelPattern \{[\s\S]*?\n\}/)?.[0];
  assert.ok(recoveryProbe, "the fixed 503 must become a visible and cancellable recovery state");
  assert.match(recoveryProbe, /Waiting for connection…/);
  assert.match(recoveryProbe, /等待网络恢复…/);
  assert.match(recoveryProbe, /-not \$enabled -and[\s\S]*?-not \$offscreen/);
  assert.match(recoveryProbe, /Cancel connection/);
  assert.match(recoveryProbe, /取消连接/);
  assert.match(recoveryProbe, /\$recoveryVisible -and \$null -ne \$cancelPattern/);
  const pairingStub = lifecycle.match(/public sealed class RelayunePairingFailureStub[\s\S]*?\n\}/)?.[0];
  assert.ok(pairingStub, "the lifecycle must host a process-local pairing failure stub");
  assert.match(pairingStub, /new TcpListener\(IPAddress\.Loopback, 0\)/);
  assert.match(pairingStub, /private static bool DiscardExpectedPairingStartHeaders\(NetworkStream stream\)/);
  assert.match(pairingStub, /POST \/api\/pairings\/start HTTP\/1\.1\\r\\n/);
  assert.match(pairingStub, /total < expectedRequestLine\.Length && value != expectedRequestLine\[total\]/);
  assert.match(pairingStub, /total < 16384/);
  assert.match(pairingStub, /HTTP\/1\.1 503 Service Unavailable/);
  assert.match(pairingStub, /Volatile\.Read\(ref requestCount\)/);
  assert.doesNotMatch(pairingStub, /StreamReader|ReadToEnd|GetString|requestBody/i);
  assert.match(pairingStub, /private readonly object clientGate = new object\(\)/);
  assert.match(pairingStub, /private TcpClient activeClient/);
  assert.match(pairingStub, /lock \(clientGate\)[\s\S]*?activeClient = client/);
  assert.match(pairingStub, /Object\.ReferenceEquals\(activeClient, client\)[\s\S]*?activeClient = null/);
  assert.match(
    pairingStub,
    /listener\.Stop\(\)[\s\S]*?lock \(clientGate\)[\s\S]*?activeClient\.Dispose\(\)[\s\S]*?if \(!worker\.Join\(5000\)\)[\s\S]*?throw new InvalidOperationException/,
    "stub cleanup must interrupt an accepted partial request and fail if its worker survives",
  );
  assert.match(lifecycle, /server_url = "http:\/\/127\.0\.0\.1:\$\(\$pairingFailureStub\.Port\)"/);
  assert.match(lifecycle, /\$testConfigDirectory = \$appDataDirectory/);
  assert.match(lifecycle, /\$testConfigPath = Join-Path \$testConfigDirectory "config\.json"/);
  assert.match(lifecycle, /GetEnvironmentVariable\("AGENT_RELAY_TEST_MODE", "Process"\)/);
  assert.match(lifecycle, /GetEnvironmentVariable\("AGENT_RELAY_CONFIG_PATH", "Process"\)/);
  assert.match(lifecycle, /requires the installed app's real default config path; refusing inherited test overrides/);
  assert.match(
    lifecycle,
    /\$expectedProductionServerUrl = "https:\/\/relayune\.giraffetree\.cn"/,
  );
  assert.doesNotMatch(lifecycle, /SetEnvironmentVariable\("AGENT_RELAY_(?:TEST_MODE|CONFIG_PATH)"/);
  assert.doesNotMatch(lifecycle, /New-Item -ItemType Directory -Path \$testConfigDirectory/);
  assert.match(lifecycle, /silent installer initialized Relayune config before the first explicit launch/);
  assert.match(lifecycle, /silent installer initialized WebView2 user data before the first explicit launch/);
  assert.match(
    lifecycle,
    /Get-ExactPathProcesses -ExecutablePath \$appExecutable[\s\S]*?Test-Path -LiteralPath \$testConfigPath[\s\S]*?Test-Path -LiteralPath \$webViewDataDirectory[\s\S]*?\$defaultConfigProbe = Start-InstalledGui -Path \$appExecutable -Arguments @\("--background"\)/,
    "an exited installer-launched GUI must not pre-seed runtime data and masquerade as first launch",
  );
  assert.match(
    lifecycle,
    /\$defaultConfigProbe = Start-InstalledGui -Path \$appExecutable -Arguments @\("--background"\)[\s\S]*?Assert-BackgroundStartupIsQuiet -Process \$defaultConfigProbe[\s\S]*?Wait-ForWebView2Process -Process \$defaultConfigProbe[\s\S]*?Wait-ForPathPresent -Path \$testConfigPath[\s\S]*?Assert-NoBroadWriteAccess -Path \$testConfigDirectory -Description "config directory"[\s\S]*?Assert-NoBroadWriteAccess -Path \$testConfigPath -Description "config file"[\s\S]*?Get-Content -LiteralPath \$testConfigPath -Raw \| ConvertFrom-Json[\s\S]*?\$defaultFirstRunConfig\.server_url[\s\S]*?\$expectedProductionServerUrl[\s\S]*?sole Relayune production server[\s\S]*?"ui_language" -notin @\(\$defaultFirstRunConfig\.PSObject\.Properties\.Name\)[\s\S]*?\$null -ne \$defaultFirstRunConfig\.ui_language[\s\S]*?\$defaultFirstRunConfig\.browser_ids[\s\S]*?IsPathFullyQualified\(\$defaultStatePath\)[\s\S]*?\$appDataDirectory[\s\S]*?Get-OwnedProcessInstancesByName -RootProcessId \$defaultConfigProbe\.Id[\s\S]*?Stop-ExactProcess -Process \$defaultConfigProbe[\s\S]*?Wait-ForOwnedProcessInstancesExit -Snapshot \$defaultWebView2Snapshot[\s\S]*?\$defaultConfigProbe = \$null/,
    "the installed release must create and survive-read its real default current-user config before test data replaces it",
  );
  assert.match(lifecycle, /function Wait-ForPathPresent[\s\S]*?Test-Path -LiteralPath \$Path -PathType Leaf/);
  assert.match(lifecycle, /real default config unexpectedly started with a browser authorization/);
  assert.match(lifecycle, /real default config does not use the sole Relayune production server/);
  assert.match(lifecycle, /real default config omitted its system-language preference field/);
  assert.match(lifecycle, /real default config unexpectedly overrides the Windows UI language/);
  assert.match(lifecycle, /real default config did not place Relay state in the current-user app-data directory/);
  assert.match(
    lifecycle,
    /Could not stop the default-config background probe[\s\S]*?Stop-ExactProcess -Process \$defaultConfigProbe/,
  );
  assert.match(lifecycle, /ui_language = \$persistedUiLanguage/);
  assert.match(
    lifecycle,
    /\$malformedConfigText = "\{"[\s\S]*?WriteAllText\(\$testConfigPath, \$malformedConfigText[\s\S]*?\$malformedConfigHash = \(Get-FileHash -LiteralPath \$testConfigPath -Algorithm SHA256\)\.Hash[\s\S]*?\$primary = Start-InstalledGui -Path \$appExecutable[\s\S]*?Wait-ForAccessibleStartupFailureRetryPattern[\s\S]*?Test-Path -LiteralPath \$testConfigPath -PathType Leaf[\s\S]*?Get-FileHash -LiteralPath \$testConfigPath -Algorithm SHA256\)\.Hash -ne \$malformedConfigHash[\s\S]*?WriteAllText\(\$testConfigPath, \$isolatedConfigJson[\s\S]*?\$startupRetryPattern\.Invoke\(\)[\s\S]*?\$startupRecoveredWindows\[0\] -ne \$startupFailureWindowHandle[\s\S]*?Wait-ForAccessibleLoginAction -WindowHandle \$startupRecoveredWindows\[0\][\s\S]*?Wait-ForAccessibleLoginKeyboardFocus -WindowHandle \$startupRecoveredWindows\[0\][\s\S]*?CloseWindow\(\$startupFailureWindowHandle\)[\s\S]*?\$startupRecoveryReopen = Start-InstalledShortcut[\s\S]*?\$startupRecoveryReopen\.WaitForExit\(10_000\)[\s\S]*?\$startupRecoveryRestoredWindows\[0\] -ne \$startupFailureWindowHandle[\s\S]*?Wait-ForAccessibleLoginAction -WindowHandle \$startupRecoveryRestoredWindows\[0\][\s\S]*?Wait-ForAccessibleLoginKeyboardFocus -WindowHandle \$startupRecoveryRestoredWindows\[0\][\s\S]*?Stop-ExactProcess -Process \$primary[\s\S]*?Start-InstalledGui -Path \$appExecutable -Arguments @\("--background"\)/,
    "the installed first start must fail on an isolated malformed config, invoke Retry after repair, recover the same HWND, and only then begin the background lifecycle",
  );
  assert.match(lifecycle, /startup failure path deleted the malformed config before the user could repair it/);
  assert.match(lifecycle, /startup failure path changed the malformed config before the user could repair it/);
  assert.match(lifecycle, /Recovering an unpaired first start unexpectedly started the sidecar/);
  assert.match(lifecycle, /startup recovery window did not own a WebView2 process before cleanup/);
  assert.match(lifecycle, /recovered first-start process remained alive after exact process-tree cleanup/);
  assert.match(lifecycle, /startup-recovered Relayune process exited instead of remaining in the tray/);
  assert.match(lifecycle, /startup-recovery shortcut did not hand off to the recovered instance/);
  assert.match(lifecycle, /startup-recovery handoff did not retain exactly one Relayune GUI process/);
  assert.match(lifecycle, /startup-recovery handoff unexpectedly started the unpaired sidecar/);
  const persistedConfigProbe = lifecycle.match(/function Assert-IsolatedConfigPreserved \{[\s\S]*?\n\}/)?.[0];
  assert.ok(persistedConfigProbe, "the lifecycle must fail if first-login cancellation corrupts durable config");
  assert.match(persistedConfigProbe, /Get-Content -LiteralPath \$testConfigPath -Raw \| ConvertFrom-Json/);
  assert.match(persistedConfigProbe, /\$expectedProperties = @\(\$isolatedConfig\.Keys\)/);
  assert.match(persistedConfigProbe, /\$actualProperties = @\(\$savedConfig\.PSObject\.Properties\.Name\)/);
  assert.match(persistedConfigProbe, /failed or cancelled first-login flow changed the isolated config schema/);
  assert.match(persistedConfigProbe, /\$savedConfig\.browser_ids/);
  assert.match(persistedConfigProbe, /persisted a browser authorization without completing pairing/);
  assert.match(persistedConfigProbe, /system-language lifecycle unexpectedly persisted a UI language override/);
  assert.match(persistedConfigProbe, /persisted UI language changed during the Windows lifecycle/);
  assert.doesNotMatch(persistedConfigProbe, /Write-(?:Host|Output)|ConvertTo-Json/);
  assert.equal(
    [...lifecycle.matchAll(/Assert-IsolatedConfigPreserved/g)].length,
    6,
    "the helper plus post-startup-retry, retry-process reopen, post-cancel, post-reopen and post-cold-restart assertions must remain wired",
  );
  assert.match(
    lifecycle,
    /\$testConfigDirectory = \$appDataDirectory[\s\S]*?WriteAllText\(\$testConfigPath, \$malformedConfigText[\s\S]*?Start-InstalledGui -Path \$appExecutable -Arguments @\("--background"\)/,
    "startup recovery and background launch must use the real current-user app config directory",
  );
  assert.match(lifecycle, /\$pairingFailureStub\.Dispose\(\)/);
  assert.match(
    lifecycle,
    /Invoke-CleanupAction -Description "Could not remove the real first-run config directory" -Action \{[\s\S]*?if \(Test-Path -LiteralPath \$testConfigDirectory\)[\s\S]*?Remove-Item -LiteralPath \$testConfigDirectory -Recurse -Force/,
  );
  assert.match(
    lifecycle,
    /Could not remove the real first-run config directory[\s\S]*?Could not resolve the CI cleanup uninstaller/,
    "a real config cleanup failure must be aggregated without skipping uninstall cleanup",
  );
  assert.match(lifecycle, /Remove-Item -LiteralPath \$testConfigDirectory -Recurse -Force/);
  assert.equal(
    [...lifecycle.matchAll(/Invoke-FirstLoginActionAndCancel -WindowHandle \$mainWindowHandle -Stub \$pairingFailureStub/g)].length,
    1,
    "the first interactive window must invoke and cancel pairing through loopback exactly once",
  );
  assert.equal(
    [...lifecycle.matchAll(/Wait-ForAccessibleLoginAction -WindowHandle \$restoredWindows\[0\]/g)].length,
    1,
    "the actually visible restored HWND must still expose usable login content after invoke/cancel",
  );
  assert.equal(
    [...lifecycle.matchAll(/Wait-ForAccessibleLoginKeyboardFocus -WindowHandle \$(?:WindowHandle|restoredWindows\[0\])/g)].length,
    2,
    "cancel recovery and post-close reopen must both leave the localized login CTA keyboard-ready",
  );
  assert.match(lifecycle, /GetForegroundWindow\(\)/);
  const foregroundProbe = lifecycle.match(/function Wait-ForForegroundProcess \{[\s\S]*?\n\}/)?.[0];
  assert.ok(foregroundProbe, "the native lifecycle must fail if a restored window stays behind another app");
  assert.match(foregroundProbe, /ForegroundProcessId\(\) -eq \[uint32\]\$TargetProcessId/);
  assert.match(foregroundProbe, /Timed out waiting for Relayune process \$TargetProcessId to own the foreground window/);
  assert.equal(
    [...lifecycle.matchAll(/Wait-ForForegroundProcess -TargetProcessId \$primary\.Id/g)].length,
    5,
    "startup failure, retry-process reopen, interactive second launch, tray reopen, and post-cancel cold restart must all foreground the window",
  );
  assert.match(
    lifecycle,
    /finally[\s\S]*?Could not stop the startup-recovery reopen process[\s\S]*?Stop-ExactProcess -Process \$startupRecoveryReopen/,
    "startup-recovery shortcut cleanup must remain independent from later lifecycle cleanup",
  );
  assert.match(lifecycle, /CloseWindow\(\$mainWindowHandle\)/);
  assert.match(lifecycle, /Closing the Relayune window terminated the tray process/);
  assert.match(lifecycle, /Start menu shortcut did not hand off after Relayune closed to tray/);
  assert.match(lifecycle, /Start menu shortcut crashed instead of completing its reopen handoff/);
  assert.match(lifecycle, /\$restoredWindows = @\(\[RelayuneWindowProbe\]::VisibleWindows\(\[uint32\]\$primary\.Id\)\)/);
  assert.match(lifecycle, /\$restoredWindows\[0\] -ne \$mainWindowHandle/);
  assert.match(lifecycle, /WindowTitle\(\$restoredWindows\[0\]\) -ne \$ProductName/);
  assert.match(lifecycle, /restored Relayune window lost Per-Monitor DPI Awareness v2/);
  assert.match(lifecycle, /different window instead of restoring the existing Relayune main window/);
  assert.match(lifecycle, /\$samePathProcesses\.Count -ne 1/);
  assert.match(
    lifecycle,
    /Stop-ExactProcess -Process \$primary[\s\S]*?\$primary = \$null[\s\S]*?\$primary = Start-InstalledGui -Path \$appExecutable[\s\S]*?\$coldRestartWindows = @\(\[RelayuneWindowProbe\]::VisibleWindows\(\[uint32\]\$primary\.Id\)\)/,
    "the lifecycle must cross a real process boundary after cancelling first login",
  );
  assert.match(lifecycle, /Wait-ForAccessibleLoginAction -WindowHandle \$coldRestartWindows\[0\]/);
  assert.match(lifecycle, /Wait-ForAccessibleLoginKeyboardFocus -WindowHandle \$coldRestartWindows\[0\]/);
  assert.match(lifecycle, /post-cancel cold restart did not own a WebView2 process before live uninstall/);
  assert.match(lifecycle, /post-cancel cold restart did not create exactly one Relayune GUI process/);
  assert.match(lifecycle, /unpaired post-cancel cold restart unexpectedly started the sidecar/);
  assert.match(lifecycle, /A clean unpaired background launch unexpectedly started the Relay sidecar/);
  const exactProcessProbe = lifecycle.match(/function Get-ExactPathProcesses \{[\s\S]*?\n\}/)?.[0];
  assert.ok(exactProcessProbe, "the lifecycle must define a fail-closed exact process probe");
  assert.doesNotMatch(exactProcessProbe, /catch \{ \$false \}/);
  assert.match(exactProcessProbe, /if \(\$candidate\.HasExited\) \{ continue \}/);
  assert.match(exactProcessProbe, /Could not inspect executable path for live/);
  assert.match(exactProcessProbe, /returned no executable path/);
  assert.match(lifecycle, /Invoke-SilentInstaller -Path \$uninstaller/);
  assert.match(
    lifecycle,
    /Set-Content -LiteralPath \$sentinel[\s\S]*?\$primary\.Refresh\(\)[\s\S]*?\$primary\.HasExited[\s\S]*?Get-ExactPathProcesses -ExecutablePath \$appExecutable[\s\S]*?\$ownedWebView2Snapshot = @\([\s\S]*?before live uninstall[\s\S]*?Invoke-SilentInstaller -Path \$uninstaller[\s\S]*?\$primary\.WaitForExit\(10_000\)[\s\S]*?Wait-ForOwnedProcessInstancesExit -Snapshot \$ownedWebView2Snapshot[\s\S]*?Get-ExactPathProcesses -ExecutablePath \$appExecutable[\s\S]*?\$primary = \$null/,
    "silent uninstall must terminate the real post-cancel tray and owned WebView2 process tree",
  );
  const liveUninstallJourney = lifecycle.slice(
    lifecycle.indexOf("The post-cancel cold restart did not own a WebView2 process before live uninstall."),
    lifecycle.indexOf("Invoke-SilentInstaller -Path $uninstaller") + "Invoke-SilentInstaller -Path $uninstaller".length,
  );
  assert.ok(liveUninstallJourney.length > 0, "the live-uninstall journey must be extractable");
  assert.doesNotMatch(
    liveUninstallJourney,
    /Stop-ExactProcess -Process \$primary/,
    "CI must not pre-kill the tray process and bypass NSIS running-app handling",
  );
  assert.match(lifecycle, /Silent uninstall did not stop the live Relayune tray process/);
  assert.match(lifecycle, /post-cancel tray process exited before silent uninstall could exercise it/);
  assert.match(lifecycle, /live-uninstall precondition lost the sole installed Relayune GUI process/);
  assert.match(lifecycle, /A Relayune GUI process survived silent uninstall/);
  assert.match(
    lifecycle,
    /Wait-ForInstallEntry -Present \$false[\s\S]*?Wait-ForPathAbsent -Path \$expectedUninstallKey[\s\S]*?Wait-ForPathAbsent -Path \$expectedInstallDirectory/,
    "the product assertion must reject a partial uninstall before finally removes exact CI state",
  );
  assert.match(lifecycle, /\$Process\.Kill\(\$true\)/);
  assert.doesNotMatch(lifecycle, /taskkill\.exe/);
  assert.match(lifecycle, /Relayune process \$processId survived exact process-tree cleanup/);
  assert.match(lifecycle, /finally[\s\S]*?Invoke-CleanupAction[\s\S]*?Stop-ExactProcess/);
  assert.match(lifecycle, /if \(\$null -ne \$lifecycleError\)[\s\S]*?throw \$lifecycleError/);
  assert.match(lifecycle, /refusing to mutate user data/);
  assert.match(lifecycle, /Join-Path \$env:LOCALAPPDATA \$BundleIdentifier/);
  assert.match(lifecycle, /Remove-Item -LiteralPath \$dataDirectory -Recurse -Force/);
  assert.match(lifecycle, /Remove-ItemProperty -LiteralPath \$autostartRegistryPath -Name \$ProductName/);
  assert.match(lifecycle, /function Get-ExactRegistryValue[\s\S]*?\.GetValue\(\$Name, \$null\)/);
  assert.match(lifecycle, /Get-ExactRegistryValue -Path \$autostartRegistryPath -Name \$ProductName/);
  assert.match(lifecycle, /Get-ExactRegistryValue -Path \$startupApprovedRegistryPath -Name \$ProductName/);
  assert.match(lifecycle, /StartupApproved value already exists; refusing to mutate it/);
  assert.match(lifecycle, /PropertyType Binary[\s\S]*?Value \$enabledStartupApproval/);
  assert.match(lifecycle, /StartupApproved value remains after uninstall/);
  assert.match(lifecycle, /Remove-ItemProperty -LiteralPath \$startupApprovedRegistryPath -Name \$ProductName/);
  assert.match(lifecycle, /ValueCount -eq 0[\s\S]*?SubKeyCount -eq 0/);
  assert.match(lifecycle, /manufacturerProductKey[\s\S]*?refusing to mutate it/);
  assert.match(lifecycle, /did not create the expected Publisher\/Product metadata key/);
  assert.match(lifecycle, /Silent uninstall unexpectedly deleted the retained Publisher\/Product metadata/);
  assert.match(
    lifecycle,
    /\$preUninstallConfigHash = \(Get-FileHash -LiteralPath \$testConfigPath -Algorithm SHA256\)\.Hash[\s\S]*?Invoke-SilentInstaller -Path \$uninstaller[\s\S]*?Wait-ForPathAbsent -Path \$expectedInstallDirectory[\s\S]*?Test-Path -LiteralPath \$testConfigPath -PathType Leaf[\s\S]*?Get-FileHash -LiteralPath \$testConfigPath -Algorithm SHA256\)\.Hash -ne \$preUninstallConfigHash/,
    "live uninstall must preserve the actual config bytes, not merely a neighboring sentinel",
  );
  assert.match(lifecycle, /Silent uninstall unexpectedly deleted the durable Relayune config/);
  assert.match(lifecycle, /Silent uninstall unexpectedly changed the durable Relayune config/);
  assert.match(lifecycle, /\$appDataRetentionSentinel = Join-Path \$appDataDirectory "\.relayune-ci-uninstall-retention"/);
  assert.match(lifecycle, /\$webViewRetentionSentinel = Join-Path \$webViewDataDirectory "\.relayune-ci-uninstall-retention"/);
  assert.match(
    lifecycle,
    /completed GUI lifecycle did not create its expected WebView2 user-data directory[\s\S]*?Set-Content -LiteralPath \$sentinel -Value \$retentionMarker[\s\S]*?Invoke-SilentInstaller -Path \$uninstaller[\s\S]*?Silent uninstall unexpectedly deleted a durable user-data sentinel[\s\S]*?Silent uninstall unexpectedly changed a durable user-data sentinel/,
    "clean and upgrade lifecycles must prove uninstall preserves app config and WebView2 user data before finally cleanup",
  );
  assert.match(lifecycle, /Remove-Item -LiteralPath \$manufacturerProductKey -Recurse -Force/);
});

test("Windows sidecar smoke is hidden and rejects a process that misses the Relayune entry", async () => {
  const source = await readFile("desktop/scripts/prepare-sidecar.mjs", "utf8");
  const smokeSource = javascriptFunctionSource(source, "smokeTestWindowsSidecar");
  const calls = [];
  const context = {
    spawnSync: (...args) => {
      calls.push(args);
      return {
        error: null,
        status: 1,
        stderr: "Usage: node relay/cli.mjs [options]",
      };
    },
  };
  const { runInNewContext } = await import("node:vm");
  runInNewContext(
    `${smokeSource}\nglobalThis.smokeTestWindowsSidecar = smokeTestWindowsSidecar;`,
    context,
  );
  context.smokeTestWindowsSidecar("C:\\Relayune\\relayune-core.exe");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][0], "C:\\Relayune\\relayune-core.exe");
  assert.deepEqual(Array.from(calls[0][1]), ["__relayune_smoke_test__"]);
  assert.equal(calls[0][2].windowsHide, true);
  assert.equal(calls[0][2].timeout, 15_000);

  const failingContext = {
    spawnSync: () => ({ error: null, status: 0, stderr: "" }),
  };
  runInNewContext(
    `${smokeSource}\nglobalThis.smokeTestWindowsSidecar = smokeTestWindowsSidecar;`,
    failingContext,
  );
  assert.throws(
    () => failingContext.smokeTestWindowsSidecar("C:\\Relayune\\relayune-core.exe"),
    /Windows sidecar smoke test failed/,
  );
});

test("Windows first-login and settings failures stay recoverable without partial UI success", async () => {
  const [frontend, rust] = await Promise.all([
    readFile("desktop/src/main.ts", "utf8"),
    readFile("desktop/src-tauri/src/lib.rs", "utf8"),
  ]);

  const pairingRequest = javascriptFunctionSource(frontend, "pairingRequest");
  assert.match(pairingRequest, /new PairingRequestError\([\s\S]*?true/);
  assert.match(
    pairingRequest,
    /response\.status === 429 \|\| response\.status >= 500/,
    "only transport, throttling, and server failures should be retried automatically",
  );
  const waitForBrowser = javascriptFunctionSource(frontend, "waitForBrowser");
  assert.match(
    waitForBrowser,
    /const expiresAt = pairingExpiresAtMs \|\| Date\.now\(\) \+ 10 \* 60_000/,
  );
  assert.match(waitForBrowser, /while \(Date\.now\(\) < expiresAt\)/);
  assert.match(waitForBrowser, /error instanceof PairingRequestError/);
  assert.match(
    waitForBrowser,
    /pairingStage === "recovering"[\s\S]*?render\(bootstrap\)[\s\S]*?setTimeout\(resolve, 1_000\)/,
  );
  assert.match(
    waitForBrowser,
    /if \(pairingStage === "recovering"\)[\s\S]*?pairingStage = "waiting"[\s\S]*?render\(bootstrap\)/,
    "a successful poll must visibly leave the recovering state",
  );

  const saveConfig = javascriptFunctionSource(frontend, "saveConfig");
  assert.match(saveConfig, /Promise<boolean>/);
  assert.match(saveConfig, /catch \(error\)[\s\S]*?return false/);
  assert.match(
    saveConfig,
    /catch \(error\)[\s\S]*?await refresh\(\)\.catch[\s\S]*?settings_save_failed/,
    "a failed native rollback must resynchronize the UI with the config that is actually durable",
  );
  const settingsStart = frontend.indexOf(
    'settingsForm.addEventListener("submit"',
  );
  const settingsEnd = frontend.indexOf(
    'element<HTMLButtonElement>("open-diagnostics")',
    settingsStart,
  );
  assert.ok(settingsStart >= 0 && settingsEnd > settingsStart);
  const settingsSave = frontend.slice(settingsStart, settingsEnd);
  assert.match(
    frontend,
    /settingsDialog\.addEventListener\("cancel"[\s\S]*?settingsSaveInFlight[\s\S]*?event\.preventDefault\(\)/,
    "Escape must not close the settings dialog while a native save is in flight",
  );
  const launchChange = settingsSave.indexOf(
    "const applied = await relayApi.setLaunchAtLogin(launchAtLogin)",
  );
  const bootstrapCommit = settingsSave.indexOf(
    "bootstrap = { ...bootstrap, launch_at_login: launchAtLogin }",
  );
  const closeDialog = settingsSave.indexOf("settingsDialog.close()");
  assert.ok(
    launchChange >= 0 &&
      bootstrapCommit > launchChange &&
      closeDialog > bootstrapCommit,
    "an autostart failure must keep the dialog open and preserve committed UI state",
  );
  assert.match(
    settingsSave,
    /catch \(error\)[\s\S]*?showDesktopErrorCodeToast\(errorCode\)[\s\S]*?focusSettingsError\(errorCode\)/,
    "an autostart failure must remain visible and return focus to the recoverable field",
  );
  assert.doesNotMatch(
    settingsSave,
    /setLaunchAtLogin\(previousLaunchAtLogin\)/,
    "a failed one-field transaction must not issue a second native write",
  );
  const settingsBusy = javascriptFunctionSource(frontend, "setSettingsFormBusy");
  assert.match(settingsSave, /setSettingsFormBusy\(true\)/);
  assert.match(
    settingsSave,
    /finally[\s\S]*?setSettingsFormBusy\(false\)/,
    "save, close, and cancel controls must not race a native settings transaction",
  );
  assert.match(settingsBusy, /settingsSaveInFlight = busy/);
  assert.match(settingsBusy, /settingsForm\.toggleAttribute\("aria-busy", busy\)/);
  assert.match(settingsBusy, /saveSettingsButton\.disabled = false/);
  assert.match(
    settingsBusy,
    /saveSettingsButton\.toggleAttribute\("aria-busy", busy\)[\s\S]*?saveSettingsButton\.toggleAttribute\("aria-disabled", busy\)/,
    "the focused save action must remain in the accessibility tree while its synchronous guard rejects duplicate submits",
  );
  assert.match(settingsBusy, /settingsCloseButton\.disabled = busy/);
  assert.match(settingsBusy, /settingsCancelButton\.disabled = busy/);

  const nativeSave = rustFunctionSource(rust, "save_settings");
  assert.match(
    nativeSave,
    /if let Err\(error\) = config::save\(&app, &next_config\)[\s\S]*?if restart_relay[\s\S]*?relay::start_during_config_change\(&app, &state\)\.await[\s\S]*?return Err\(error\)/,
    "a durable-write failure must restart the previously running Relay",
  );
  assert.match(
    nativeSave,
    /if relay::start_during_config_change\(&app, &state\)[\s\S]*?\.await[\s\S]*?\.is_err\(\)[\s\S]*?if config::save\(&app, &old_config\)\.is_ok\(\)[\s\S]*?reconcile_durable_config_native_presentation\([\s\S]*?&old_config[\s\S]*?old_paired[\s\S]*?refresh_tray_status_locked[\s\S]*?relay::start_during_config_change\(&app, &state\)\.await[\s\S]*?else \{[\s\S]*?settings_save_failed[\s\S]*?refresh_tray_status/,
    "a Relay restart failure may claim the old state only after its durable rollback and native presentation commit atomically",
  );
  assert.doesNotMatch(
    nativeSave,
    /state\.(?:set_config|set_paired|invalidate_bootstrap_requests)/,
    "Windows settings recovery must not bypass the shared durable native commit gate",
  );
});
