import type { RelaySnapshot } from "./types";
import type { AppLocale } from "./i18n";
import { translate } from "./i18n";

export type BrowserPairingStage =
  | "idle"
  | "starting"
  | "waiting"
  | "recovering"
  | "finishing";

export function browserAuthorizationCount(
  count: number,
  loading: boolean,
  locale: AppLocale = "zh-CN",
) {
  return loading
    ? translate(locale, "loadingCount")
    : translate(locale, "browserCount", { count });
}

export function browserAuthorizationActionsDisabled(
  stage: BrowserPairingStage,
) {
  return stage !== "idle";
}

export function browserPairingHandoffActionsEnabled(
  stage: BrowserPairingStage,
  hasPairingId: boolean,
) {
  return hasPairingId && (stage === "waiting" || stage === "recovering");
}

export function browserRevokeActionLabel(
  name: string,
  locale: AppLocale = "zh-CN",
) {
  return translate(locale, "revokeBrowserNamed", { name });
}

export function browserPairingCopy(
  stage: BrowserPairingStage,
  hasPairingCode: boolean,
  locale: AppLocale = "zh-CN",
) {
  if (stage === "finishing") {
    return {
      button: translate(locale, "addBrowserBusy"),
      status: translate(locale, "browserConfirmed"),
      step: translate(locale, "almostDone"),
    };
  }
  if (stage === "waiting" && hasPairingCode) {
    return {
      button: translate(locale, "waitingConfirmation"),
      status: translate(locale, "waitStatus"),
      step: translate(locale, "waitStage"),
    };
  }
  if (stage === "recovering") {
    return {
      button: translate(locale, "waitingConnection"),
      status: translate(
        locale,
        hasPairingCode ? "pairingReconnecting" : "pairingStartReconnecting",
      ),
      step: translate(locale, "reconnectingStage"),
    };
  }
  if (stage === "starting") {
    return {
      button: translate(locale, "addBrowserBusy"),
      status: translate(locale, "creatingSecureConnection"),
      step: translate(locale, "preparingStage"),
    };
  }
  return {
    button: translate(locale, "addBrowser"),
    status: "",
    step: "",
  };
}

export function onlineBrowserIds(relay: RelaySnapshot | undefined, now = Date.now()): string[] {
  const observed = relay?.browser_presence_observed_at;
  if (relay?.phase !== "connected" || observed == null || now < observed || now - observed >= 6_000) return [];
  return relay.online_browser_ids ?? [];
}
