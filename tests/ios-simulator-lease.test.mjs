import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireLease, initializeDedicatedSimulator, leaseStatus, parseLeaseArguments, QA_DEVICE_NAME, readDedicatedSimulator, releaseLease, withLeaseOperation } from "../scripts/ios-simulator-lease.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "relayune-lease-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, device: randomUUID().toUpperCase() };
}
test("reservation survives commands and only its lease can operate or release", (t) => {
  const { root, device } = fixture(t);
  const a = acquireLease(device, "Agent A", root);
  assert.throws(() => acquireLease(device, "Agent B", root), /occupied/);
  let touched = false;
  assert.throws(() => withLeaseOperation(device, "wrong", () => { touched = true; }, root), /matching simulator lease/);
  assert.equal(touched, false);
  assert.throws(() => releaseLease(device, "wrong", root), /matching simulator lease/);
  withLeaseOperation(device, a.lease_id, () => {
    assert.throws(() => releaseLease(device, a.lease_id, root), /operation in progress/);
    assert.throws(() => withLeaseOperation(device, a.lease_id, () => {}, root), /operation in progress/);
  }, root);
  assert.equal(leaseStatus(device, root).lease.owner, "Agent A");
  releaseLease(device, a.lease_id, root);
  const b = acquireLease(device, "Agent B", root);
  assert.throws(() => releaseLease(device, a.lease_id, root), /matching simulator lease/);
  assert.equal(leaseStatus(device, root).lease.lease_id, b.lease_id);
});
test("another device remains available and failed operations retain the reservation", (t) => {
  const { root, device } = fixture(t), peer = randomUUID();
  const a = acquireLease(device, "A", root), b = acquireLease(peer, "B", root);
  assert.throws(() => withLeaseOperation(device, a.lease_id, () => { throw new Error("build failed"); }, root), /build failed/);
  assert.equal(leaseStatus(device, root).operation_in_progress, false);
  assert.equal(leaseStatus(device, root).lease.lease_id, a.lease_id);
  withLeaseOperation(peer, b.lease_id, () => assert.ok(true), root);
});
test("concurrent processes share one reservation across checkouts", async (t) => {
  const { root, device } = fixture(t);
  const url = new URL("../scripts/ios-simulator-lease.mjs", import.meta.url).href;
  const code = `import {acquireLease} from ${JSON.stringify(url)};try{acquireLease(${JSON.stringify(device)},'contender',${JSON.stringify(root)});}catch{process.exitCode=2;}`;
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["--input-type=module", "-e", code], { cwd: tmpdir(), stdio: "ignore" });
    p.on("error", reject);p.on("close", resolve);
  })));
  assert.equal(outcomes.filter(code => code === 0).length, 1);
  assert.equal(outcomes.filter(code => code === 2).length, 7);
});
test("crashed-operation and malformed state fail closed without automatic reclamation", (t) => {
  const { root, device } = fixture(t);
  mkdirSync(path.join(root, `${device}.operation`));
  assert.throws(() => acquireLease(device, "B", root), /operation in progress/);
  rmSync(path.join(root, `${device}.operation`), { recursive: true });
  writeFileSync(path.join(root, `${device}.json`), "corrupt");
  assert.throws(() => acquireLease(device, "B", root));
  assert.throws(() => acquireLease("../../escape", "B", root), /UDID/);
});
test("init creates exactly one named device and reuses its fixed identity", (t) => {
  const { root, device } = fixture(t);let creates = 0;
  const invoke = args => {
    if (args[0] === "create") { creates++;return device; }
    return JSON.stringify({ devices: { "runtime": creates ? [{ name: QA_DEVICE_NAME, udid: device }] : [] } });
  };
  assert.equal(initializeDedicatedSimulator(root, invoke).udid, device);
  assert.equal(initializeDedicatedSimulator(root, invoke).udid, device);
  assert.equal(readDedicatedSimulator(root).udid, device);
  assert.equal(creates, 1);
  assert.throws(() => initializeDedicatedSimulator(root, () => '{"devices":{}}'), /unavailable/);
});

test("lease commands reject unsupported or misleading options", () => {
  assert.deepEqual(parseLeaseArguments(["acquire", "--owner", "task"]), { command: "acquire", owner: "task" });
  for (const args of [["init", "--device", "ignored"], ["status", "--lease", "ignored"], ["release", "--lease"], ["acquire", "--owner", "--device"]]) assert.throws(() => parseLeaseArguments(args));
});
