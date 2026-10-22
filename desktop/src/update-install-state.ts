export type UpdateInstallBlockers = {
  installingUpdate: boolean;
  pairingInFlight: boolean;
  browserPairingCancellationInFlight: boolean;
  configSaveInFlight: boolean;
  settingsSaveInFlight: boolean;
  languageSwitchInFlight: boolean;
  logoutInFlight: boolean;
  browserRevokeInFlight: boolean;
  relayStartInFlight: boolean;
  workspacePickerInFlight: boolean;
  folderAccessRequestInFlight: boolean;
  agentActionInFlight: boolean;
  nativeLanguageReconciliationInFlight: boolean;
};

export function updateInstallBlocked(blockers: UpdateInstallBlockers) {
  return Object.values(blockers).some(Boolean);
}
