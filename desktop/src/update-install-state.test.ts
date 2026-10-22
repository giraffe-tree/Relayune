import { describe, expect, it } from "vitest";
import {
  updateInstallBlocked,
  type UpdateInstallBlockers,
} from "./update-install-state";

const idle: UpdateInstallBlockers = {
  installingUpdate: false,
  pairingInFlight: false,
  browserPairingCancellationInFlight: false,
  configSaveInFlight: false,
  settingsSaveInFlight: false,
  languageSwitchInFlight: false,
  logoutInFlight: false,
  browserRevokeInFlight: false,
  relayStartInFlight: false,
  workspacePickerInFlight: false,
  folderAccessRequestInFlight: false,
  agentActionInFlight: false,
  nativeLanguageReconciliationInFlight: false,
};

describe("updateInstallBlocked", () => {
  it("allows an update only while every native transaction is idle", () => {
    expect(updateInstallBlocked(idle)).toBe(false);
  });

  it.each(Object.keys(idle) as Array<keyof UpdateInstallBlockers>)(
    "blocks relaunch while %s is active",
    (blocker) => {
      expect(updateInstallBlocked({ ...idle, [blocker]: true })).toBe(true);
    },
  );
});
