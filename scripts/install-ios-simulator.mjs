import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { acquireLease, readDedicatedSimulator, withLeaseOperation } from "./ios-simulator-lease.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileRoot = path.join(root, "mobile");
const appPath = path.join(mobileRoot, "build/ios/iphonesimulator/Runner.app");
const bundleId = "cn.giraffetree.relayune";

export function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = { "--device": "device", "--lease": "lease", "--owner": "owner" }[args[index]];
    if (!key || !args[index + 1] || args[index + 1].startsWith("--") || options[key]) {
      throw new Error(`Unknown or incomplete argument: ${args[index]}`);
    }
    options[key] = args[index + 1];
    index += 1;
  }
  return options;
}

export function selectIphoneSimulator(deviceSets, requestedDevice) {
  const candidates = Object.entries(deviceSets ?? {}).flatMap(([runtime, devices]) =>
    (devices ?? [])
      .filter((device) => (device.deviceTypeIdentifier ? device.deviceTypeIdentifier.includes(".iPhone-") : device.name?.startsWith("iPhone")) && device.isAvailable !== false)
      .map((device) => ({
        ...device,
        runtime,
        runtimeLabel: iosRuntimeLabel(runtime),
        runtimeVersion: iosRuntimeVersion(runtime),
      })),
  );

  if (!candidates.length) throw new Error("No available iPhone simulator was found.");

  if (requestedDevice) {
    const requested = candidates.filter(
      (candidate) => candidate.udid.toUpperCase() === requestedDevice.toUpperCase() || candidate.name === requestedDevice,
    );
    if (!requested.length) throw new Error(`Requested iPhone simulator was not found: ${requestedDevice}`);
    if (requested.length > 1) throw new Error("Ambiguous simulator name; use its exact UDID.");
    return requested[0];
  }

  throw new Error("Select the dedicated simulator UDID; automatic booted-device selection is disabled.");
}

export function iosRuntimeLabel(runtime) {
  const version = iosRuntimeVersion(runtime);
  return version.length ? `iOS ${version.join(".")}` : runtime;
}

function iosRuntimeVersion(runtime) {
  const match = /\.iOS-([0-9-]+)$/.exec(runtime);
  return match ? match[1].split("-").map(Number) : [];
}


function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.inherit ? "inherit" : "pipe",
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${output ? `:\n${output}` : "."}`);
  }
  return {
    status: result.status,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  };
}

function gitOutput(args) {
  return run("git", args).stdout;
}

async function main() {
  if (process.platform !== "darwin") throw new Error("The iOS simulator installer requires macOS.");
  const options = parseArguments(process.argv.slice(2));
  const trackedStatus = gitOutput([
    "status",
    "--porcelain",
    "--untracked-files=no",
    "--",
    "mobile",
  ]);
  if (trackedStatus) {
    throw new Error(
      "Tracked mobile files are not clean. Commit or restore them before installing current HEAD.",
    );
  }

  const commit = gitOutput(["rev-parse", "--short=7", "HEAD"]);
  const simulatorJson = JSON.parse(
    run("xcrun", ["simctl", "list", "devices", "available", "--json"]).stdout,
  );
  const simulator = selectIphoneSimulator(simulatorJson.devices, options.device ?? readDedicatedSimulator().udid);
  const lease = options.lease
    ? { lease_id: options.lease }
    : acquireLease(simulator.udid, options.owner ?? process.env.CODEX_THREAD_ID);
  // Keep the reservation after installation for the entire UI acceptance session.
  process.stdout.write(`${JSON.stringify({ simulator_lease: lease.lease_id, device: simulator.udid, retained_until_release: true })}\n`);
  withLeaseOperation(simulator.udid, lease.lease_id, () => {
    if (simulator.state !== "Booted") {
      process.stdout.write(`Booting ${simulator.name} (${simulator.runtimeLabel})...\n`);
      run("xcrun", ["simctl", "boot", simulator.udid]);
      run("xcrun", ["simctl", "bootstatus", simulator.udid, "-b"], { inherit: true });
    }

    process.stdout.write(`Building ${commit} for ${simulator.name} (${simulator.runtimeLabel})...\n`);
    run(process.execPath, [path.join(mobileRoot, "tool/flutter.mjs"), "build", "ios", "--simulator", "--debug"], {
      cwd: mobileRoot,
      inherit: true,
    });
    if (!existsSync(appPath)) throw new Error(`Flutter did not create ${appPath}.`);

    run("xcrun", ["simctl", "terminate", simulator.udid, bundleId], { allowFailure: true });
    run("xcrun", ["simctl", "install", simulator.udid, appPath]);
    const launch = run("xcrun", ["simctl", "launch", simulator.udid, bundleId]).stdout;
    const installedPath = run(
      "xcrun",
      ["simctl", "get_app_container", simulator.udid, bundleId, "app"],
    ).stdout;
    if (!installedPath.endsWith(".app")) throw new Error("Installed app container could not be verified.");

    const pid = launch.match(/:\s*(\d+)$/)?.[1] ?? null;
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        commit,
        device: simulator.name,
        runtime: simulator.runtimeLabel,
        bundleId,
        pid,
        udid: simulator.udid,
        lease_id: lease.lease_id,
      })}\n`,
    );
  });
}

const isMain = process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
