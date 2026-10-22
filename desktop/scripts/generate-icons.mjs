import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, "..");
const repositoryDirectory = resolve(desktopDirectory, "..");
const outputDirectory = join(desktopDirectory, "src-tauri", "icons");
const tauriCli = join(
  desktopDirectory,
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js",
);
const temporaryDirectory = mkdtempSync(join(tmpdir(), "relayune-icons-"));
const appOutput = join(temporaryDirectory, "app");
const trayOutput = join(temporaryDirectory, "tray");

try {
  generateIcons(
    resolve(
      repositoryDirectory,
      "public/brand/relayune/relayune-eclipse-static.svg",
    ),
    appOutput,
  );
  generateIcons(
    resolve(
      repositoryDirectory,
      "public/brand/relayune/relayune-eclipse-template.svg",
    ),
    trayOutput,
    ["--png", "64"],
  );

  mkdirSync(outputDirectory, { recursive: true });
  for (const name of [
    "32x32.png",
    "128x128.png",
    "128x128@2x.png",
    "icon.icns",
    "icon.ico",
  ]) {
    copyFileSync(join(appOutput, name), join(outputDirectory, name));
  }
  copyFileSync(
    join(trayOutput, "64x64.png"),
    join(outputDirectory, "trayTemplate.png"),
  );
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("Generated transparent Relayune desktop and tray icons.");

function generateIcons(source, output, extraArguments = []) {
  const result = spawnSync(
    process.execPath,
    [tauriCli, "icon", source, "--output", output, ...extraArguments],
    {
      cwd: desktopDirectory,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Tauri icon generation exited with status ${result.status}.`);
  }
}
