import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scripts = {
  darwin: {
    dev: "desktop:dev:macos",
    build: "desktop:build:macos",
  },
  win32: {
    dev: "desktop:dev:windows",
    build: "desktop:build:windows",
  },
};

export function npmJavaScriptEntrypoint(value) {
  if (!value || !isAbsolute(value) || basename(value) !== "npm-cli.js") {
    throw new Error("Run this entry through npm run desktop:dev or npm run desktop:build; npm_execpath must identify npm-cli.js.");
  }
  const entry = realpathSync(value);
  const npmRoot = resolve(dirname(entry), "..");
  const manifest = JSON.parse(readFileSync(resolve(npmRoot, "package.json"), "utf8"));
  if (manifest.name !== "npm" || !statSync(entry).isFile() ||
      typeof manifest.bin?.npm !== "string" ||
      realpathSync(resolve(npmRoot, manifest.bin.npm)) !== entry) {
    throw new Error("npm_execpath does not match the installed npm package entrypoint.");
  }
  return entry;
}

export function desktopCommandPlan(platform, operation, npmExecpath, nodeExecutable = process.execPath) {
  const script = scripts[platform]?.[operation];
  if (!script) throw new Error(`Relayune desktop does not support ${operation ?? "this operation"} on ${platform}.`);
  return { command: nodeExecutable, args: [npmJavaScriptEntrypoint(npmExecpath), "run", script] };
}

function main() {
  if (process.argv.length !== 3) throw new Error("Usage: npm run desktop:dev or npm run desktop:build");
  const plan = desktopCommandPlan(process.platform, process.argv[2], process.env.npm_execpath);
  const result = spawnSync(plan.command, plan.args, {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    stdio: "inherit",
    shell: false,
    windowsHide: process.platform === "win32",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
