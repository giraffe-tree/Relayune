import assert from "node:assert/strict";
import test from "node:test";
import {
  iosRuntimeLabel,
  parseArguments,
  selectIphoneSimulator,
} from "../scripts/install-ios-simulator.mjs";

const devices = {
  "com.apple.CoreSimulator.SimRuntime.iOS-18-6": [
    { name: "iPhone 16 Pro", udid: "old-booted", state: "Booted", isAvailable: true },
  ],
  "com.apple.CoreSimulator.SimRuntime.iOS-26-3": [
    { name: "iPhone 17 Pro", udid: "new-pro", state: "Shutdown", isAvailable: true },
    { name: "iPhone 17", udid: "new-phone", state: "Shutdown", isAvailable: true },
    { name: "iPad Pro", udid: "ipad", state: "Booted", isAvailable: true },
  ],
};

test("never grabs an already booted device without an explicit selection", () => {
  assert.throws(() => selectIphoneSimulator(devices), /automatic booted-device selection is disabled/);
});

test("selects a dedicated custom-named iPhone by UDID", () => {
  const dedicated = { "com.apple.CoreSimulator.SimRuntime.iOS-26-3": [
    { name: "Relayune QA · iPhone 17 Pro", udid: "dedicated", deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro", state: "Shutdown", isAvailable: true },
  ] };
  assert.equal(selectIphoneSimulator(dedicated, "dedicated").udid, "dedicated");
});

test("supports an exact device name or UDID", () => {
  assert.equal(selectIphoneSimulator(devices, "iPhone 17 Pro").udid, "new-pro");
  assert.equal(selectIphoneSimulator(devices, "new-phone").name, "iPhone 17");
});

test("parses device arguments and runtime labels", () => {
  assert.deepEqual(parseArguments(["--device", "iPhone 17 Pro"]), { device: "iPhone 17 Pro" });
  assert.equal(iosRuntimeLabel("com.apple.CoreSimulator.SimRuntime.iOS-26-3"), "iOS 26.3");
});

test("installer accepts a lease or an explicit owner and rejects malformed flags", () => {
  assert.deepEqual(parseArguments(["--lease", "lease-id", "--device", "device-id"]), { lease: "lease-id", device: "device-id" });
  assert.deepEqual(parseArguments(["--owner", "User testing"]), { owner: "User testing" });
  for (const args of [["--device"], ["--device", "--lease"], ["--device", "a", "--device", "b"]]) assert.throws(() => parseArguments(args));
});

test("duplicate names cannot silently select another runtime", () => {
  const copies = structuredClone(devices);
  copies["com.apple.CoreSimulator.SimRuntime.iOS-26-3"].push({ name: "iPhone 16 Pro", udid: "duplicate", isAvailable: true });
  assert.throws(() => selectIphoneSimulator(copies, "iPhone 16 Pro"), /Ambiguous/);
});
