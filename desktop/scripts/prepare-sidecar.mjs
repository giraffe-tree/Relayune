import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { writeDesktopBundleNotices } from "./bundle-notices.mjs";
import {
  packageTarget,
  sidecarFileName,
  smokeTestFileName,
  targetTuples,
} from "./sidecar-targets.mjs";

const PKG_PRELUDE_MARKER = Buffer.from(
  "(function(process, require, console, EXECPATH_FD",
);

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, "..");
const repositoryDirectory = resolve(desktopDirectory, "..");
const buildDirectory = join(desktopDirectory, ".sidecar-build");
const binaryDirectory = join(desktopDirectory, "src-tauri", "binaries");
const hostTuple = execFileSync("rustc", ["--print", "host-tuple"], {
  encoding: "utf8",
}).trim();
const targetFlagIndex = process.argv.indexOf("--target");
const requestedTuple =
  targetFlagIndex >= 0 ? process.argv[targetFlagIndex + 1] : hostTuple;
const preSignForTauri = process.argv.includes("--pre-sign-for-tauri");

if (!requestedTuple) throw new Error("Missing Relayune desktop target tuple.");
if (preSignForTauri && requestedTuple !== "universal-apple-darwin") {
  throw new Error(
    "--pre-sign-for-tauri is only valid for the universal macOS sidecar.",
  );
}
const tuples = targetTuples(requestedTuple);

rmSync(buildDirectory, { recursive: true, force: true });
mkdirSync(buildDirectory, { recursive: true });
mkdirSync(binaryDirectory, { recursive: true });

if (requestedTuple.includes("-windows-")) {
  // Tauri copies externalBin to an unsuffixed Cargo target path before NSIS
  // packaging. Remove only that generated Windows copy so a rebuild cannot
  // silently package a sidecar left by the previous installer build.
  const cargoTargetRoot =
    targetFlagIndex >= 0
      ? join(desktopDirectory, "src-tauri", "target", requestedTuple)
      : join(desktopDirectory, "src-tauri", "target");
  for (const profile of ["debug", "release"]) {
    rmSync(join(cargoTargetRoot, profile, "relayune-core.exe"), {
      force: true,
    });
  }
}

const bundledEntry = join(buildDirectory, "relayune-core.cjs");
const javascriptBundle = await build({
  absWorkingDir: repositoryDirectory,
  entryPoints: [join(repositoryDirectory, "relay", "cli.mjs")],
  outfile: bundledEntry,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: false,
  minify: false,
  legalComments: "inline",
  metafile: true,
});

// Produce source-derived JS notices before pkg downloads or creates any native
// executable. This manifest intentionally leaves native runtime review open.
await writeDesktopBundleNotices({
  repositoryDirectory,
  outputDirectory: join(buildDirectory, "third-party-notices"),
  resourceDirectory: join(desktopDirectory, "src-tauri", "resources", "generated-notices", "sidecar-js"),
  metafile: javascriptBundle.metafile,
  artifactName: "sidecar-javascript",
});

const pkgEntry = join(
  desktopDirectory,
  "node_modules",
  "@yao-pkg",
  "pkg",
  "lib-es5",
  "bin.js",
);

if (!existsSync(pkgEntry)) {
  throw new Error(
    "Missing @yao-pkg/pkg. Run `npm install` in the desktop directory first.",
  );
}

for (const tuple of tuples) {
  const outputPath = join(binaryDirectory, sidecarFileName(tuple));
  execFileSync(
    process.execPath,
    [
      pkgEntry,
      bundledEntry,
      "--target",
      packageTarget(tuple),
      "--output",
      outputPath,
      "--compress",
      "GZip",
    ],
    {
      cwd: desktopDirectory,
      stdio: "inherit",
    },
  );
  if (!tuple.includes("-windows-")) chmodSync(outputPath, 0o755);
}

if (requestedTuple === "universal-apple-darwin") {
  const universalPath = join(
    binaryDirectory,
    "relayune-core-universal-apple-darwin",
  );
  execFileSync(
    "lipo",
    [
      "-create",
      ...tuples.map((tuple) =>
        join(binaryDirectory, sidecarFileName(tuple)),
      ),
      "-output",
      universalPath,
    ],
    { stdio: "inherit" },
  );
  // Establish the final signed Mach-O slice layout before translating pkg's
  // thin-binary offsets to absolute offsets in the fat executable. A Developer
  // ID signature is larger than an ad-hoc signature and moves pkg's appended
  // payload inside every slice. Release builds must therefore pre-sign with
  // the exact identity/options Tauri will use, then repair the settled layout.
  signMacUniversal(universalPath, preSignForTauri);
  repairPkgOffsetsAfterLipo(universalPath, tuples);
  signMacUniversal(universalPath, preSignForTauri);
  chmodSync(universalPath, 0o755);
  smokeTestMacUniversal(universalPath, tuples);
}

// Keep an unsuffixed copy for direct smoke tests. Tauri packages the
// target-suffixed binary above and removes the suffix inside the app bundle.
const smokeTestPath = join(buildDirectory, smokeTestFileName(requestedTuple));
const smokeSourceTuple = tuples.includes(hostTuple) ? hostTuple : tuples[0];
copyFileSync(
  join(binaryDirectory, sidecarFileName(smokeSourceTuple)),
  smokeTestPath,
);
if (!smokeSourceTuple.includes("-windows-")) chmodSync(smokeTestPath, 0o755);
if (process.platform === "win32" && smokeSourceTuple.includes("-windows-")) {
  smokeTestWindowsSidecar(smokeTestPath);
}

console.log(`Prepared Relayune sidecar for ${requestedTuple}.`);

// pkg stores payload and bootstrap offsets relative to the beginning of each
// thin executable. lipo moves those executables inside a fat Mach-O without
// adjusting the embedded offsets, so an unpatched universal binary reads
// arbitrary bytes as JavaScript and exits before Relayune code can start.
function repairPkgOffsetsAfterLipo(universalPath, tuples) {
  const universal = readFileSync(universalPath);
  const slices = readFatMachOSlices(universal);

  for (const tuple of tuples) {
    const thinPath = join(binaryDirectory, sidecarFileName(tuple));
    const layout = discoverPkgLayout(readFileSync(thinPath));
    const slice = slices.get(cpuTypeForTuple(tuple));
    if (!slice) {
      throw new Error(`Missing ${tuple} slice in ${universalPath}.`);
    }
    const sliceBuffer = universal.subarray(
      slice.offset,
      slice.offset + slice.size,
    );
    const preludePosition = sliceBuffer.lastIndexOf(PKG_PRELUDE_MARKER);
    const payloadSize = readPaddedDecimal(
      sliceBuffer,
      layout.payloadSizeFieldOffset,
      layout.sizeFieldWidth,
    );
    if (preludePosition < 0 || payloadSize === null) {
      throw new Error(`Unable to inspect the signed ${tuple} pkg slice.`);
    }
    const payloadPosition = preludePosition - payloadSize;

    writePaddedDecimal(
      universal,
      slice.offset + layout.payloadFieldOffset,
      layout.positionFieldWidth,
      slice.offset + payloadPosition,
    );
    writePaddedDecimal(
      universal,
      slice.offset + layout.preludeFieldOffset,
      layout.positionFieldWidth,
      slice.offset + preludePosition,
    );
  }

  writeFileSync(universalPath, universal);
}

function discoverPkgLayout(binary) {
  const positionFieldWidth = Buffer.byteLength("// PAYLOAD_POSITION //");
  const sizeFieldWidth = Buffer.byteLength("// PAYLOAD_SIZE //");
  const preludePosition = binary.lastIndexOf(PKG_PRELUDE_MARKER);
  if (preludePosition < 0) {
    throw new Error("Unable to locate the pkg prelude in a thin sidecar.");
  }

  const positionFields = findPaddedDecimalFields(binary, positionFieldWidth);
  const sizeFields = findPaddedDecimalFields(binary, sizeFieldWidth);
  const preludeFields = positionFields.filter(
    (field) => field.value === preludePosition,
  );
  if (preludeFields.length !== 1) {
    throw new Error("Unable to identify the pkg prelude offset field.");
  }

  const payloadFields = positionFields.filter(
    (field) =>
      field.value < preludePosition &&
      sizeFields.some(
        (sizeField) => field.value + sizeField.value === preludePosition,
      ),
  );
  if (payloadFields.length !== 1) {
    throw new Error("Unable to identify the pkg payload offset field.");
  }
  const payloadSizeFields = sizeFields.filter(
    (field) => payloadFields[0].value + field.value === preludePosition,
  );
  if (payloadSizeFields.length !== 1) {
    throw new Error("Unable to identify the pkg payload size field.");
  }

  return {
    payloadFieldOffset: payloadFields[0].offset,
    payloadSizeFieldOffset: payloadSizeFields[0].offset,
    preludeFieldOffset: preludeFields[0].offset,
    positionFieldWidth,
    sizeFieldWidth,
  };
}

function findPaddedDecimalFields(binary, width) {
  const source = binary.toString("latin1");
  const fields = [];
  const pattern = /[1-9][0-9]* +/g;
  let match;
  while ((match = pattern.exec(source))) {
    if (match[0].length !== width) continue;
    const value = Number.parseInt(match[0], 10);
    if (Number.isSafeInteger(value) && value > 0 && value <= binary.length) {
      fields.push({ offset: match.index, value });
    }
  }
  return fields;
}

function writePaddedDecimal(binary, offset, width, value) {
  const encoded = String(value).padEnd(width, " ");
  if (encoded.length !== width) {
    throw new Error(`pkg offset ${value} does not fit in ${width} bytes.`);
  }
  binary.write(encoded, offset, width, "ascii");
}

function readPaddedDecimal(binary, offset, width) {
  const encoded = binary.subarray(offset, offset + width).toString("ascii");
  if (!/^[1-9][0-9]* +$/.test(encoded)) return null;
  const value = Number.parseInt(encoded, 10);
  return Number.isSafeInteger(value) ? value : null;
}

function readFatMachOSlices(binary) {
  const FAT_MAGIC = 0xcafebabe;
  const FAT_MAGIC_64 = 0xcafebabf;
  const magic = binary.readUInt32BE(0);
  const is64Bit = magic === FAT_MAGIC_64;
  if (magic !== FAT_MAGIC && !is64Bit) {
    throw new Error("lipo output is not a supported fat Mach-O binary.");
  }

  const count = binary.readUInt32BE(4);
  const entrySize = is64Bit ? 32 : 20;
  const slices = new Map();
  for (let index = 0; index < count; index += 1) {
    const entry = 8 + index * entrySize;
    const cpuType = binary.readUInt32BE(entry);
    const offset = is64Bit
      ? Number(binary.readBigUInt64BE(entry + 8))
      : binary.readUInt32BE(entry + 8);
    const size = is64Bit
      ? Number(binary.readBigUInt64BE(entry + 16))
      : binary.readUInt32BE(entry + 12);
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size)) {
      throw new Error("Fat Mach-O slice is too large to patch safely.");
    }
    slices.set(cpuType, { offset, size });
  }
  return slices;
}

function cpuTypeForTuple(tuple) {
  if (tuple.startsWith("aarch64-")) return 0x0100000c;
  if (tuple.startsWith("x86_64-")) return 0x01000007;
  throw new Error(`Unsupported macOS sidecar architecture ${tuple}.`);
}

function signMacUniversal(universalPath, useProductionLayout) {
  if (!useProductionLayout) {
    execFileSync("codesign", ["--force", "--sign", "-", universalPath], {
      stdio: "inherit",
    });
    return;
  }

  const tauriConfig = JSON.parse(
    readFileSync(
      join(desktopDirectory, "src-tauri", "tauri.conf.json"),
      "utf8",
    ),
  );
  const macOS = tauriConfig.bundle?.macOS;
  const signingIdentity =
    process.env.APPLE_SIGNING_IDENTITY || macOS?.signingIdentity;
  if (!signingIdentity || signingIdentity === "-") {
    throw new Error(
      "A Developer ID Application identity is required to settle the release sidecar layout.",
    );
  }
  const entitlementsPath = resolve(
    desktopDirectory,
    "src-tauri",
    macOS?.entitlements || "Entitlements.plist",
  );
  execFileSync(
    "codesign",
    [
      "--force",
      "--sign",
      signingIdentity,
      "--identifier",
      "relayune-core",
      "--options",
      "runtime",
      "--timestamp",
      "--entitlements",
      entitlementsPath,
      universalPath,
    ],
    { stdio: "inherit" },
  );
}

function smokeTestMacUniversal(universalPath, tuples) {
  const archFlags = new Map([
    ["aarch64-apple-darwin", "-arm64"],
    ["x86_64-apple-darwin", "-x86_64"],
  ]);
  for (const tuple of tuples) {
    const result = spawnSync(
      "/usr/bin/arch",
      [archFlags.get(tuple), universalPath],
      {
        encoding: "utf8",
        env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
      },
    );
    if (
      result.status !== 1 ||
      !result.stderr.includes("RELAY_SERVER_URL is required")
    ) {
      throw new Error(
        `Universal sidecar smoke test failed for ${tuple}: ${result.stderr.trim()}`,
      );
    }
  }
}

function smokeTestWindowsSidecar(sidecarPath) {
  const result = spawnSync(sidecarPath, ["__relayune_smoke_test__"], {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
  if (
    result.error ||
    result.status !== 1 ||
    !result.stderr.includes("Usage: node relay/cli.mjs")
  ) {
    throw new Error(
      `Windows sidecar smoke test failed: ${result.error?.message ?? result.stderr.trim()}`,
    );
  }
}
