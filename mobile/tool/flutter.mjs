import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readBuildMetadata, withBuildMetadata } from "./build_metadata.mjs";
import { flutterInvocation } from "./flutter_process.mjs";

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requested = process.argv.slice(2);

if (!requested.length) {
  process.stderr.write("Usage: node mobile/tool/flutter.mjs <flutter args|check>\n");
  process.exit(2);
}

const commands = requested[0] === "check"
  ? [["analyze"], ["test"]]
  : [requested];

for (const command of commands) {
  let args = command;
  let metadata;
  const usesExistingBinary = command.some((arg) => arg === "--no-build" || arg.startsWith("--use-application-binary"));
  if (["build", "run"].includes(command[0]) && !usesExistingBinary && !command.some((arg) => ["--help", "-h"].includes(arg))) {
    metadata = readBuildMetadata(mobileRoot);
    args = withBuildMetadata(command, metadata);
    process.stdout.write(`Relayune build: ${metadata.source_commit.slice(0, 7)}${metadata.source_dirty ? " (uncommitted changes)" : ""} · ${metadata.built_at}\n`);
  }
  let invocation;
  try { invocation = flutterInvocation(args); }
  catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: mobileRoot,
    env: invocation.environment,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (metadata) {
    mkdirSync(resolve(mobileRoot, "build"), { recursive: true });
    writeFileSync(resolve(mobileRoot, "build/relayune-build-info.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  }
}
