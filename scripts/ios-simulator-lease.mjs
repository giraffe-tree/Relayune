import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const QA_DEVICE_NAME = "Relayune QA · iPhone 17 Pro";
export const DEFAULT_STATE_ROOT = path.join(homedir(), "Library", "Application Support", "RelayuneQA", "ios-simulators");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function deviceKey(device) {
  if (!uuid.test(device ?? "")) throw new Error("A simulator UDID is required.");
  return device.toUpperCase();
}
function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
function writeJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(temporary, file);
}
function guard(stateRoot, key, action) {
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const lock = path.join(stateRoot, `${key}.operation`);
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error(`Simulator operation in progress (${key}); do not bypass or remove its lock.`);
    throw error;
  }
  try { return action(); } finally { rmdirSync(lock); }
}
export function readDedicatedSimulator(stateRoot = DEFAULT_STATE_ROOT) {
  const config = readJson(path.join(stateRoot, "device.json"));
  if (!config) throw new Error("Dedicated simulator is not initialized. Run npm run mobile:simulator -- init.");
  deviceKey(config.udid);
  return config;
}
export function leaseStatus(device, stateRoot = DEFAULT_STATE_ROOT) {
  const key = deviceKey(device);
  return { device: key, lease: readJson(path.join(stateRoot, `${key}.json`)), operation_in_progress: existsSync(path.join(stateRoot, `${key}.operation`)) };
}
export function acquireLease(device, owner, stateRoot = DEFAULT_STATE_ROOT) {
  const key = deviceKey(device);
  if (!owner?.trim() || owner.length > 200) throw new Error("Provide --owner with the task name or user name (1–200 characters).");
  return guard(stateRoot, key, () => {
    const current = leaseStatus(key, stateRoot).lease;
    if (current) throw new Error(`Simulator occupied by ${current.owner} since ${current.acquired_at}; wait for its owner to release it.`);
    const lease = { device: key, lease_id: randomUUID(), owner: owner.trim(), acquired_at: new Date().toISOString(), checkout: process.cwd() };
    writeJson(path.join(stateRoot, `${key}.json`), lease);
    return lease;
  });
}
function requireLease(device, leaseId, stateRoot) {
  const lease = leaseStatus(device, stateRoot).lease;
  if (!leaseId || !lease || lease.lease_id !== leaseId) throw new Error("No matching simulator lease. Acquire the device first; never reuse another task's lease.");
  return lease;
}
export function withLeaseOperation(device, leaseId, action, stateRoot = DEFAULT_STATE_ROOT) {
  return guard(stateRoot, deviceKey(device), () => {
    requireLease(device, leaseId, stateRoot);
    const result = action();
    if (result?.then) throw new Error("Simulator lease operations must be synchronous.");
    return result;
  });
}
export function releaseLease(device, leaseId, stateRoot = DEFAULT_STATE_ROOT) {
  return guard(stateRoot, deviceKey(device), () => {
    requireLease(device, leaseId, stateRoot);
    unlinkSync(path.join(stateRoot, `${deviceKey(device)}.json`));
    return { released: true, device: deviceKey(device) };
  });
}
function simctl(args) { return execFileSync("xcrun", ["simctl", ...args], { encoding: "utf8" }).trim(); }
export function initializeDedicatedSimulator(stateRoot = DEFAULT_STATE_ROOT, invoke = simctl) {
  return guard(stateRoot, "configuration", () => {
    const all = JSON.parse(invoke(["list", "devices", "available", "--json"]));
    const devices = Object.entries(all.devices).flatMap(([runtime, list]) => list.map(device => ({ ...device, runtime })));
    const config = readJson(path.join(stateRoot, "device.json"));
    if (config) {
      const device = devices.find(d => d.udid.toUpperCase() === deviceKey(config.udid));
      if (!device) throw new Error("The configured simulator is unavailable; do not silently replace its identity or erase its lease.");
      return config;
    }
    const matches = devices.filter(d => d.name === QA_DEVICE_NAME);
    if (matches.length > 1) throw new Error("Multiple dedicated simulators have the same name; resolve their identity before testing.");
    const runtime = "com.apple.CoreSimulator.SimRuntime.iOS-26-3";
    const udid = matches[0]?.udid ?? invoke(["create", QA_DEVICE_NAME, "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro", runtime]);
    const selected = { name: QA_DEVICE_NAME, udid: deviceKey(udid), runtime: matches[0]?.runtime ?? runtime };
    writeJson(path.join(stateRoot, "device.json"), selected);
    return selected;
  });
}
export function parseLeaseArguments(args) {
  const [command, ...rest] = args;
  if (!["init", "status", "acquire", "check", "release"].includes(command)) throw new Error("Use init, status, acquire --owner NAME, check --lease ID, or release --lease ID; optional --device UDID.");
  const options = { command };
  const allowed = { init: [], status: ["device"], acquire: ["device", "owner"], check: ["device", "lease"], release: ["device", "lease"] }[command];
  for (let i = 0; i < rest.length; i += 2) {
    const key = { "--device": "device", "--owner": "owner", "--lease": "lease" }[rest[i]];
    if (!key || !allowed.includes(key) || !rest[i + 1] || rest[i + 1].startsWith("--") || options[key]) throw new Error(`Invalid argument: ${rest[i]}`);
    options[key] = rest[i + 1];
  }
  return options;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseLeaseArguments(process.argv.slice(2));
    let result;
    if (options.command === "init") result = initializeDedicatedSimulator();
    else {
      const device = options.device ?? readDedicatedSimulator().udid;
      if (options.command === "status") result = leaseStatus(device);
      if (options.command === "acquire") result = acquireLease(device, options.owner ?? process.env.CODEX_THREAD_ID);
      if (options.command === "check") result = withLeaseOperation(device, options.lease, () => ({ valid: true, device }));
      if (options.command === "release") result = releaseLease(device, options.lease);
    }
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
