import { desktopErrorCode, type DesktopErrorCode } from "./api";
import { formatTime } from "./format";
import {
  desktopErrorMessage,
  translate,
  type AppLocale,
  type TranslationKey,
} from "./i18n";
import type { RelaySnapshot } from "./types";

export type StartupMessageKey =
  | "preparing"
  | "stillPreparing"
  | "startupFailed";

export function startupMessageKeyForRender(
  errorCode: DesktopErrorCode | null,
  currentKey: string | undefined,
): StartupMessageKey {
  if (errorCode) return "startupFailed";
  return currentKey === "stillPreparing" ? "stillPreparing" : "preparing";
}

const nativeDiagnosticMessages: Record<string, TranslationKey> = {
  "relayune:diagnostic_hidden": "diagnosticEventHidden",
  "relayune:relay_starting": "relayStartingDiagnostic",
  "relayune:relay_started": "relayStartedDiagnostic",
  "relayune:relay_connected": "relayConnectedDiagnostic",
  "relayune:relay_sync_degraded": "relaySyncDegradedDiagnostic",
  "relayune:relay_sync_recovered": "relaySyncRecoveredDiagnostic",
  "relayune:relay_stopping": "relayStoppingDiagnostic",
  "relayune:relay_stopped": "relayStoppedDiagnostic",
  "relayune:browser_authorizations_cleaned":
    "browserAuthorizationsCleanedDiagnostic",
  "relayune:signed_out": "signedOutDiagnostic",
  "relayune:settings_saved": "settingsSavedDiagnostic",
  "relayune:pairing_completed": "pairingCompletedDiagnostic",
};

function diagnosticMessage(locale: AppLocale, message: string) {
  const translationKey = nativeDiagnosticMessages[message];
  if (translationKey) return translate(locale, translationKey);
  if (message.includes("relayune:")) {
    return desktopErrorMessage(locale, desktopErrorCode(message));
  }
  // The native boundary already emits only registered codes. Keep the
  // WebView boundary fail-closed as well so an older client, plugin, or mock
  // cannot surface OS paths, process details, stderr, or untranslated prose.
  return translate(locale, "diagnosticEventHidden");
}

export function diagnosticLogText(locale: AppLocale, relay: RelaySnapshot) {
  return relay.logs.length > 0
    ? relay.logs
        .map(
          (line) =>
            `${formatTime(line.at, locale)}  ${line.level === "error" ? translate(locale, "errorLog") : translate(locale, "infoLog")}  ${diagnosticMessage(locale, line.message)}`,
        )
        .join("\n")
    : translate(locale, "noDiagnostics");
}

export function startupDiagnosticPresentation(
  locale: AppLocale,
  errorCode: DesktopErrorCode,
  relay: RelaySnapshot | null,
) {
  return {
    summary: desktopErrorMessage(locale, errorCode),
    log: relay
      ? diagnosticLogText(locale, relay)
      : translate(locale, "noDiagnostics"),
  };
}
