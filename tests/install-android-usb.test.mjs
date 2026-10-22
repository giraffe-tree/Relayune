import test from "node:test";
import assert from "node:assert/strict";
import { parseArguments, selectUsbDevice, cacheMatches, assertNoDowngrade } from "../scripts/install-android-usb.mjs";

test("USB selection excludes emulator/network devices and rejects ambiguity or unauthorized phones", () => {
  const listing = "List of devices attached\nphone device usb:2-1 model:V2241A\nemulator-5554 device product:sdk\n192.168.1.2:5555 device product:phone\n";
  assert.equal(selectUsbDevice(listing), "phone");
  assert.throws(() => selectUsbDevice(`${listing}other device usb:2-2\n`), /Expected one/);
  assert.equal(selectUsbDevice(`${listing}other device usb:2-2\n`, "other"), "other");
  assert.throws(() => selectUsbDevice("phone unauthorized usb:2-1", "phone"), /authorize USB/);
  assert.throws(() => selectUsbDevice("phone offline usb:2-1"), /offline/);
  assert.throws(() => selectUsbDevice(listing, "missing"), /Expected one/);
});

test("cache rejects older commits, altered APKs and changed local configuration", () => {
  const record = { schema: 1, commit: "new", inputs: "config", sha256: "apk" };
  assert.equal(cacheMatches(record, "new", "config", "apk"), true);
  assert.equal(cacheMatches(record, "old", "config", "apk"), false);
  assert.equal(cacheMatches(record, "new", "changed", "apk"), false);
  assert.equal(cacheMatches(record, "new", "config", "tampered"), false);
});

test("same-version development updates allowed; data-destructive downgrade rejected", () => {
  assert.doesNotThrow(() => assertNoDowngrade("versionCode=33 minSdk=21", 33));
  assert.doesNotThrow(() => assertNoDowngrade("", 33));
  assert.throws(() => assertNoDowngrade("versionCode=34 minSdk=21", 33), /refusing downgrade/);
  assert.deepEqual(parseArguments([]), { ref: "HEAD" });
  assert.deepEqual(parseArguments(["--device", "phone", "--check"]), { ref: "HEAD", device: "phone", check: true });
  assert.throws(() => parseArguments(["--ref"]), /incomplete/);
  assert.throws(() => parseArguments(["--uninstall"]), /Unknown/);
});
