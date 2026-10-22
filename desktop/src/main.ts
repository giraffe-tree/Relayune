/// <reference types="vite/client" />
import { instanceCopy, isOfficialInstance, normalizedInstanceOrigin, OFFICIAL_SERVER_ORIGIN } from "./instance-selection";
import { installWarmShell, type SettingsSection } from "./warm-shell";

import { deviceIdentity, deviceIcon, deviceRelativeTime } from "./device-presentation";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { toCanvas } from "qrcode";
import {
  createPairingInitiator,
  finishPairingInitiator,
  PAIRING_PROTOCOL,
  randomRelayToken,
  sha256Hex,
  type PairingPublicState,
} from "../../shared/pairing-pake";
import {
  desktopErrorCode,
  DesktopCommandError,
  relayApi,
  type DesktopErrorCode,
} from "./api";
import {
  onlineBrowserIds,
  browserAuthorizationActionsDisabled,
  browserAuthorizationCount,
  browserPairingCopy,
  browserPairingHandoffActionsEnabled,
  browserRevokeActionLabel,
  type BrowserPairingStage,
} from "./browser-access";
import {
  formatBrowserAuthorizationDetail,
  formatPairingCountdown,
  formatTime,
  pairingDeadlineExpired,
  shortPath,
} from "./format";
import {
  APP_LOCALE_OPTIONS,
  appLocaleDirection,
  bootstrapLocaleAfterRefresh,
  detectAppLocale,
  desktopErrorMessage,
  isAppLocale,
  localizedUpdateNotes,
  LOCALE_STORAGE_KEY,
  persistAppLocale,
  translate,
  type AppLocale,
  type TranslationKey,
} from "./i18n";
import { pairingConnectionUrl, pairingQrPayload } from "./pairing-link";
import { PairingCancellationQueue } from "./pairing-cancellation";
import { LatestRequestGate } from "./latest-request";
import { relaySnapshotAfterBootstrap } from "./relay-snapshot";
import { createFeedbackDialog } from "./feedback";
import { settingsRecoveryField } from "./settings-recovery";
import { combineAbortSignals } from "../../shared/abort-signal";
import {
  diagnosticLogText as localizedDiagnosticLogText,
  startupDiagnosticPresentation,
  startupMessageKeyForRender,
} from "./startup-diagnostics";
import { TransientStatusController } from "./transient-status";
import { updateInstallBlocked } from "./update-install-state";
import {
  UPDATE_CHECK_INTERVAL_MS,
  UpdateCheckThrottle,
} from "./update-check-throttle";
import { desktopDeviceName } from "./device-name";
import { agentBrandMark, agentRuntimeAction, agentRuntimeTone } from "./agent-runtime";
import "./styles.css";
import "./macos-shell.css";
import "./moonlight.css";
import { resolveHomeReadiness } from "./home-readiness";
import "./opening.css";
import { DesktopOpening } from "./opening";
import type {
  AgentRuntimeAvailability,
  Bootstrap,
  BrowserAuthorization,
  RelayAdapter,
  RelayConfig,
  RelayProvider,
  RelaySnapshot,
} from "./types";

let desktopQaLocale: AppLocale | null = null;
if (import.meta.env.DEV) {
  const { installDesktopQaHarness } = await import("./qa-harness");
  desktopQaLocale = installDesktopQaHarness();
}

const root = document.querySelector<HTMLDivElement>("#app")!;
if (!root) throw new Error("Relayune app root is missing.");

function storedLocale() {
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

let locale: AppLocale =
  desktopQaLocale ?? detectAppLocale(navigator.languages, storedLocale());
document.documentElement.lang = locale;
document.documentElement.dir = appLocaleDirection(locale);

function t(key: TranslationKey, params?: Record<string, string | number>) {
  return translate(locale, key, params);
}

function relayuneMark(className: string) {
  const clipId = `relayune-disc-${className.replace(/[^a-z0-9_-]/gi, "-")}`;
  return `<svg class="${className}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <defs><clipPath id="${clipId}"><circle cx="32" cy="32" r="19.25"></circle></clipPath></defs>
    <rect width="64" height="64" rx="14" fill="#0B1220"></rect>
    <circle cx="32" cy="32" r="19.25" fill="#F6F8F5"></circle>
    <path d="M9.4 39.1C18.6 17.3 27 17.4 32 32c5 14.6 13.4 14.8 22.6-7.1" fill="none" stroke="#0B1220" stroke-linecap="round" stroke-width="7.8"></path>
    <path class="relayune-mark-pulse" d="M9.4 39.1C18.6 17.3 27 17.4 32 32c5 14.6 13.4 14.8 22.6-7.1" pathLength="100" fill="none" stroke="#69E1D2" stroke-dasharray="10 90" stroke-dashoffset="100" stroke-linecap="round" stroke-width="1.4" clip-path="url(#${clipId})"></path>
  </svg>`;
}

root.innerHTML = `
  <div class="opening-backdrop" aria-hidden="true"><div class="opening-sea"></div><i class="opening-signal"></i></div>
  <button class="opening-skip" id="opening-skip" type="button" data-i18n="openingSkip" hidden></button>
  <main class="shell">
    <div class="window-drag-strip" data-tauri-drag-region aria-hidden="true"></div>
    <header class="app-header" data-tauri-drag-region>
      <div class="brand" data-tauri-drag-region>
        ${relayuneMark("brand-mark")}
        <div class="brand-copy" data-tauri-drag-region>
          <div class="brand-title" data-tauri-drag-region>
            <h1>Relayune</h1>
            <span class="brand-version" id="app-version">v…</span>
          </div>
        </div>
      </div>
      <div class="header-actions">
        <button
          class="icon-button header-settings-button"
          id="open-settings"
          type="button"
          data-i18n-aria-label="settings"
          aria-describedby="startup-message"
        ><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 15.25A3.25 3.25 0 1 0 12 8.75a3.25 3.25 0 0 0 0 6.5Z"></path>
          <path d="M19.15 13.33a7.8 7.8 0 0 0 .05-2.62l1.66-1.28-1.9-3.28-1.94.78a7.7 7.7 0 0 0-2.27-1.32L14.46 3.5h-3.8l-.3 2.11a7.7 7.7 0 0 0-2.26 1.32l-1.95-.78-1.9 3.28 1.67 1.28a7.8 7.8 0 0 0 .05 2.62l-1.72 1.31 1.9 3.29 2.02-.82a7.7 7.7 0 0 0 2.2 1.27l.3 2.12h3.79l.3-2.12a7.7 7.7 0 0 0 2.2-1.27l2.01.82 1.9-3.29-1.72-1.31Z"></path>
        </svg></button>
      </div>
    </header>

    <button type="button" class="instance-entry" id="open-instance-settings" aria-haspopup="dialog"></button>
    <dialog id="instance-dialog" aria-labelledby="instance-title">
      <form id="instance-form" class="dialog-card instance-card">
        <h2 id="instance-title"></h2>
        <label class="field"><span id="instance-address-label"></span><select id="instance-kind"><option value="official"></option><option value="custom"></option></select></label>
        <input id="instance-origin" type="url" autocomplete="off" spellcheck="false" aria-labelledby="instance-address-label" aria-describedby="instance-address-help" required />
        <p id="instance-address-help"></p>
        <p id="instance-warning"></p>
        <label class="instance-confirm"><input id="instance-confirm" type="checkbox" /><span id="instance-confirm-label"></span></label>
        <p id="instance-status" role="status" aria-live="polite"></p>
        <p id="instance-update-note"></p>
        <footer><button type="button" class="secondary" id="instance-cancel"></button><button type="button" class="secondary" id="instance-probe"></button><button type="submit" class="primary" id="instance-save" disabled></button></footer>
      </form>
    </dialog>

    <section class="update-card is-hidden" id="update-card" aria-live="polite">
      <div class="update-copy">
        <p class="eyebrow" data-i18n="softwareUpdate"></p>
        <strong id="update-title" data-i18n="updateAvailable"></strong>
        <p id="update-detail" data-i18n="updateDefaultDetail"></p>
        <div
          class="update-progress is-hidden"
          id="update-progress"
          role="progressbar"
          aria-labelledby="update-title"
          aria-valuemin="0"
          aria-valuemax="100"
        ><i id="update-progress-bar" aria-hidden="true"></i></div>
      </div>
      <div class="update-actions">
        <button class="update-later" id="update-later" type="button" data-i18n="later"></button>
        <button class="primary" id="install-update" type="button" data-i18n="updateRestart" aria-describedby="update-detail"></button>
      </div>
    </section>

    <section class="loading-view" id="loading-view" aria-live="polite">
      <span class="spinner" id="startup-spinner"></span>
      <p id="startup-message" data-i18n="preparing"></p>
      <button class="primary startup-retry is-hidden" id="startup-retry" type="button" data-i18n="retryStartup"></button>
      <button class="diagnostics-link startup-diagnostics is-hidden" id="startup-diagnostics" type="button" data-i18n="helpDiagnostics"></button>
    </section>

    <section class="login-view is-hidden" id="login-view">
      <div class="login-hero">
        ${relayuneMark("login-mark")}
        <p class="eyebrow" data-i18n="desktopRelay"></p>
        <p class="opening-caption" data-i18n="openingTitle"></p>
        <p class="opening-caption opening-subtitle" data-i18n="openingSubtitle"></p>
        <h2 id="login-title" data-i18n="connectDevice"></h2>
        <p id="login-copy" data-i18n="loginIntro"></p>
        <div class="login-pairing-options is-hidden" id="login-pairing-options">
          <div class="pairing-qr-card">
            <canvas class="pairing-qr" id="login-pairing-qr" role="img" data-i18n-aria-label="scanAria" aria-hidden="true"></canvas>
            <span id="login-pairing-qr-status" role="status" aria-live="polite" aria-atomic="true" data-tone="status" data-i18n="scanToOpen"></span>
          </div>
          <div class="pairing-code-column">
            <span data-i18n="enterCodeNext"></span>
            <div class="pairing-code" id="pairing-code" role="status" aria-live="polite" dir="ltr"></div>
            <div class="pairing-link-actions">
              <button class="pairing-open" id="login-open-pairing-page" type="button" data-i18n="openHere"></button>
              <button class="pairing-copy" id="login-copy-pairing-link" type="button" data-i18n="copyLink"></button>
            </div>
            <p class="pairing-expiry is-hidden" id="login-pairing-expiry"></p>
          </div>
        </div>
        <button class="primary wide" id="login-button" type="button" data-i18n="openBrowser" aria-describedby="login-note"></button>
        <button class="secondary pairing-initial-cancel is-hidden" id="login-cancel-pairing" type="button" data-i18n="cancelConnection"></button>
        <p class="login-note" id="login-note" data-i18n="loginNote" role="status" aria-live="polite" aria-atomic="true" tabindex="-1"></p>
      </div>
    </section>

    <section class="home-view is-hidden" id="home-view">
      <div class="desktop-overview">
      <div class="account-card" id="account-card" tabindex="-1">
        <span class="account-card-copy">
          <span class="eyebrow" data-i18n="account"></span>
          <strong id="account-email" dir="ltr">—</strong>
        </span>
        <span class="account-login-status"><i aria-hidden="true"></i><span data-i18n="signedInStatus"></span></span>
      </div>

      <article class="status-card" id="status-card" data-tone="pending" role="status" aria-live="polite" tabindex="-1">
        <div class="status-line">
          <div class="status-indicator"><span></span></div>
          <div class="status-copy">
            <strong id="status-label" data-i18n="connecting"></strong>
            <p id="status-detail" data-i18n="relayAutoRuns"></p>
          </div>
          <time id="status-time">—</time>
        </div>
        <p class="error-copy is-hidden" id="status-error" role="alert"></p>
        <div class="status-actions is-hidden" id="status-actions">
          <button class="secondary is-hidden" id="retry-relay" type="button" data-i18n="reconnect"></button>
        </div>
      </article>

      </div>

      <section id="file-access-warning" class="file-access-warning is-hidden" role="status" aria-live="polite">
        <strong data-i18n="fileAccessWarningTitle"></strong>
        <p data-i18n="fileAccessWarningDetail"></p>
        <div class="status-actions">
          <button id="open-file-access-settings" class="secondary" type="button" data-i18n="fileAccessSettings"></button>
          <button id="retry-file-access" class="secondary" type="button" data-i18n="fileAccessRetry"></button>
        </div>
      </section>

      <div class="desktop-workspace">
      <section class="browser-devices" aria-labelledby="browser-title">
        <div class="section-title">
          <div>
            <p class="eyebrow" data-i18n="browserAccess"></p>
            <h2 id="browser-title" data-i18n="authorizedBrowsers"></h2>
            <p class="section-help" data-i18n="browserHelp"></p>
          </div>
          <div class="browser-title-actions">
            <span class="saved-state" id="browser-count" data-i18n="loadingCount"></span>
            <button class="secondary browser-add" id="new-pairing" type="button" data-i18n="addBrowser"></button>
          </div>
        </div>
        <section class="pairing-panel is-hidden" id="pairing-panel" aria-live="polite">
          <div class="pairing-panel-heading">
            <div class="pairing-panel-copy">
              <p class="eyebrow" data-i18n="newAuthorization"></p>
              <strong data-i18n="addOneBrowser"></strong>
              <p id="pairing-panel-status" data-i18n="creatingSecureConnection" tabindex="-1"></p>
            </div>
            <span class="pairing-stage" id="pairing-stage" data-i18n="preparingStage"></span>
          </div>
          <div class="pairing-options is-hidden" id="replacement-pairing-options">
            <div class="pairing-qr-card">
              <canvas class="pairing-qr" id="replacement-pairing-qr" role="img" data-i18n-aria-label="scanAria" aria-hidden="true"></canvas>
              <span id="replacement-pairing-qr-status" role="status" aria-live="polite" aria-atomic="true" data-tone="status" data-i18n="scanOtherDevice"></span>
            </div>
            <div class="pairing-code-column">
              <span data-i18n="codeOnlyHere"></span>
              <div class="pairing-code" id="replacement-pairing-code" role="status" aria-live="polite" dir="ltr"></div>
              <div class="pairing-link-actions">
                <button class="pairing-open" id="open-pairing-page" type="button" data-i18n="openHere"></button>
                <button class="pairing-copy" id="copy-pairing-link" type="button" data-i18n="copyLink"></button>
              </div>
              <p class="pairing-expiry is-hidden" id="replacement-pairing-expiry"></p>
            </div>
          </div>
          <p class="pairing-security-note" data-i18n="browserSecurityNote"></p>
          <button class="pairing-cancel" id="cancel-pairing" type="button" data-i18n="cancel"></button>
        </section>
        <div class="browser-list" id="browser-list" role="region" aria-labelledby="browser-title" aria-live="polite" tabindex="-1">
          <div class="browser-list-state" role="status">
            <span class="browser-state-spinner" aria-hidden="true"></span>
            <strong data-i18n="loadingBrowsers"></strong>
            <p data-i18n="aFewSeconds"></p>
          </div>
        </div>
      </section>

      <aside class="desktop-sidebar">
      <section class="quick-settings" aria-labelledby="quick-title">
        <div class="section-title">
          <div><p class="eyebrow" data-i18n="thisDevice"></p><h2 id="quick-title" data-i18n="localPreferences"></h2></div>
          <span
            class="saved-state"
            id="saved-state"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          ></span>
        </div>

        <div class="setting-row">
          <div class="setting-label"><strong>Agent</strong><p data-i18n="agentHelp"></p></div>
          <div class="segments" id="adapter-segments">
            <button type="button" data-adapter="codex">Codex</button>
            <button type="button" data-adapter="kimi">Kimi</button>
            <button type="button" data-adapter="claude">Claude</button>
            <button type="button" data-adapter="multi" data-i18n="both"></button>
          </div>
        </div>

        <div
          class="agent-readiness"
          id="agent-readiness"
          role="region"
          aria-label="Agent"
          aria-live="polite"
        >
          <div class="agent-readiness-state" role="status">
            <span class="agent-readiness-spinner" aria-hidden="true"></span>
            <p data-i18n="agentChecking"></p>
          </div>
        </div>

        <div class="setting-row is-hidden" id="provider-row">
          <div class="setting-label"><strong data-i18n="defaultAgent"></strong><p data-i18n="defaultAgentHelp"></p></div>
          <div class="segments" id="provider-segments">
            <button type="button" data-provider="codex">Codex</button>
            <button type="button" data-provider="kimi">Kimi</button>
            <button type="button" data-provider="claude">Claude</button>
          </div>
        </div>

        <button class="setting-row workspace-row" id="choose-workspace" type="button">
          <div class="setting-label"><strong data-i18n="defaultWorkingFolder"></strong><p id="workspace-path" dir="auto">—</p></div>
          <span class="row-action" data-i18n="choose"></span>
        </button>
        <button class="setting-row workspace-access-entry is-hidden" id="prepare-task-files" type="button">
          <div class="setting-label"><strong data-i18n="folderAccessEyebrow"></strong><p data-i18n="folderAccessTitle"></p></div>
          <span class="row-action" data-i18n="configure"></span>
        </button>
      </section>

      </aside>
      </div>

      <div class="account-actions">
        <button class="diagnostics-link" id="open-diagnostics" type="button" data-i18n="helpDiagnostics"></button>
        <button class="logout-button" id="logout-button" type="button" data-i18n="signOut"></button>
      </div>
      <p class="footer-copy" data-i18n="backgroundNote"></p>
    </section>

    <dialog id="settings-dialog" aria-labelledby="settings-title">
      <form method="dialog" class="dialog-card" id="settings-form" novalidate>
        <header><div><p class="eyebrow" data-i18n="settingsEyebrow"></p><h2 id="settings-title" data-i18n="settings"></h2></div><button class="icon-button" id="settings-close" type="button" data-i18n-aria-label="closeSettings">×</button></header>
        <section class="language-settings" aria-labelledby="language-settings-title">
          <div class="language-settings-heading">
            <span class="language-settings-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <circle cx="12" cy="12" r="8.5"></circle>
                <path d="M3.8 12h16.4M12 3.5c2.1 2.3 3.2 5.1 3.2 8.5S14.1 18.2 12 20.5M12 3.5C9.9 5.8 8.8 8.6 8.8 12s1.1 6.2 3.2 8.5"></path>
              </svg>
            </span>
            <div>
              <strong id="language-settings-title" data-i18n="chooseLanguage"></strong>
              <p id="language-current" aria-live="polite"></p>
            </div>
          </div>
          <div
            class="language-picker"
            id="language-picker"
            role="radiogroup"
            data-i18n-aria-label="chooseLanguage"
          >
            ${APP_LOCALE_OPTIONS.map(
              ({ code, label, direction }) => `
                <button
                  class="language-option"
                  type="button"
                  role="radio"
                  aria-checked="false"
                  data-language="${code}"
                  lang="${code}"
                  dir="${direction}"
                  tabindex="-1"
                >
                  <span>${label}</span>
                  <i aria-hidden="true"></i>
                </button>`,
            ).join("")}
          </div>
        </section>
        <button class="secondary settings-feedback-entry" id="open-feedback" type="button" data-i18n="feedbackTitle"></button>
        <div class="settings-runtime is-hidden" id="settings-runtime">
          <div class="toggle-row">
            <div><strong data-i18n="runAtLogin"></strong><p data-i18n="runAtLoginHelp"></p></div>
            <label class="switch"><input id="launch-at-login" type="checkbox" data-i18n-aria-label="runAtLogin" /><span></span></label>
          </div>
          <footer><button class="secondary" id="settings-cancel" type="button" data-i18n="cancel"></button><button class="primary" id="save-settings" type="submit" data-i18n="save"></button></footer>
        </div>
      </form>
    </dialog>



    <dialog id="workspace-access-dialog" aria-labelledby="workspace-access-title" aria-describedby="workspace-access-reason workspace-access-detail">
      <section class="dialog-card logout-dialog-card">
        <header><div><p class="eyebrow" data-i18n="folderAccessEyebrow"></p><h2 id="workspace-access-title" data-i18n="folderAccessTitle"></h2></div></header>
        <p id="workspace-access-reason" data-i18n="folderAccessReason"></p>
        <p id="workspace-access-detail" data-i18n="folderAccessDetail"></p>
        <footer>
          <button class="secondary" id="workspace-access-later" type="button" data-i18n="later"></button>
          <button class="primary" id="workspace-access-continue" type="button" data-i18n="continueFolderAccess"></button>
        </footer>
      </section>
    </dialog>

    <dialog id="diagnostics-dialog" aria-labelledby="diagnostics-title">
      <section class="dialog-card diagnostics-card">
        <header><div><p class="eyebrow" data-i18n="support"></p><h2 id="diagnostics-title" data-i18n="helpDiagnostics"></h2></div><button class="icon-button" id="close-diagnostics" type="button" data-i18n-aria-label="closeDiagnostics">×</button></header>
        <p class="diagnostic-summary" id="diagnostic-summary" data-i18n="diagnosticsHealthy"></p>
        <pre id="diagnostic-log" data-i18n="noDiagnostics"></pre>
        <button class="secondary" id="report-exit-diagnostics" type="button" data-i18n="exitDiagnosticsReport"></button>
      </section>
    </dialog>

    <dialog id="logout-dialog" aria-labelledby="logout-title">
      <form method="dialog" class="dialog-card logout-dialog-card">
        <header><div><p class="eyebrow" data-i18n="thisDevice"></p><h2 id="logout-title" data-i18n="signOutQuestion"></h2></div></header>
        <p data-i18n="signOutWarning"></p>
        <footer>
          <button class="secondary" id="cancel-logout" value="cancel" data-i18n="cancel"></button>
          <button class="danger-button" id="confirm-logout" type="button" data-i18n="signOut"></button>
        </footer>
      </form>
    </dialog>

    <dialog id="revoke-browser-dialog" aria-labelledby="revoke-title">
      <form method="dialog" class="dialog-card logout-dialog-card">
        <header><div><p class="eyebrow" data-i18n="browserAccess"></p><h2 id="revoke-title" data-i18n="revokeQuestion"></h2></div></header>
        <p><span data-i18n="revokePrefix"></span><strong id="revoke-browser-name" data-i18n="thisBrowser"></strong><span data-i18n="revokeSuffix"></span></p>
        <footer>
          <button class="secondary" id="cancel-revoke-browser" value="cancel" data-i18n="keepAccess"></button>
          <button class="danger-button" id="confirm-revoke-browser" type="button" data-i18n="revokeAccess"></button>
        </footer>
      </form>
    </dialog>

    <div class="toast is-hidden" id="toast" role="status" aria-live="polite"></div>
  </main>
`;

function applyStaticTranslations() {
  document.documentElement.lang = locale;
  document.documentElement.dir = appLocaleDirection(locale);
  for (const node of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n as TranslationKey);
  }
  for (const node of root.querySelectorAll<HTMLElement>(
    "[data-i18n-aria-label]",
  )) {
    node.setAttribute(
      "aria-label",
      t(node.dataset.i18nAriaLabel as TranslationKey),
    );
  }
  const languageOption = APP_LOCALE_OPTIONS.find(({ code }) => code === locale);
  const currentLanguage = root.querySelector<HTMLElement>("#language-current");
  if (currentLanguage) currentLanguage.textContent = languageOption?.label ?? "";
  for (const option of root.querySelectorAll<HTMLButtonElement>(
    "[data-language]",
  )) {
    const selected = option.dataset.language === locale;
    option.setAttribute("aria-checked", String(selected));
    option.tabIndex = selected ? 0 : -1;
  }
}

applyStaticTranslations();

const element = <T extends HTMLElement>(id: string) => {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as T;
};

const opening = new DesktopOpening(element<HTMLButtonElement>("opening-skip"));
const loadingView = element<HTMLElement>("loading-view");
const startupSpinner = element<HTMLElement>("startup-spinner");
const startupMessage = element<HTMLElement>("startup-message");
const startupRetry = element<HTMLButtonElement>("startup-retry");
const startupDiagnostics = element<HTMLButtonElement>("startup-diagnostics");
const loginView = element<HTMLElement>("login-view");
const homeView = element<HTMLElement>("home-view");
const loginButton = element<HTMLButtonElement>("login-button");
const loginCancelPairingButton =
  element<HTMLButtonElement>("login-cancel-pairing");
const loginTitle = element<HTMLElement>("login-title");
const loginCopy = element<HTMLElement>("login-copy");
const loginPairingOptions = element<HTMLElement>("login-pairing-options");
const loginPairingQr = element<HTMLCanvasElement>("login-pairing-qr");
const loginPairingQrStatus = element<HTMLElement>("login-pairing-qr-status");
const pairingCodeElement = element<HTMLElement>("pairing-code");
const loginOpenPairingPageButton =
  element<HTMLButtonElement>("login-open-pairing-page");
const loginCopyPairingLinkButton =
  element<HTMLButtonElement>("login-copy-pairing-link");
const loginNote = element<HTMLElement>("login-note");
const accountCard = element<HTMLDivElement>("account-card");
const accountEmail = element<HTMLElement>("account-email");
const statusCard = element<HTMLElement>("status-card");
const prepareTaskFiles = element<HTMLButtonElement>("prepare-task-files");
const statusLabel = element<HTMLElement>("status-label");
const statusDetail = element<HTMLElement>("status-detail");
const statusTime = element<HTMLTimeElement>("status-time");
const statusError = element<HTMLElement>("status-error");
const statusActions = element<HTMLElement>("status-actions");
const retryRelay = element<HTMLButtonElement>("retry-relay");
const newPairingButton = element<HTMLButtonElement>("new-pairing");
const pairingPanel = element<HTMLElement>("pairing-panel");
const pairingPanelStatus = element<HTMLElement>("pairing-panel-status");
const pairingStageElement = element<HTMLElement>("pairing-stage");
const replacementPairingOptions =
  element<HTMLElement>("replacement-pairing-options");
const replacementPairingQr =
  element<HTMLCanvasElement>("replacement-pairing-qr");
const replacementPairingQrStatus = element<HTMLElement>(
  "replacement-pairing-qr-status",
);
const replacementPairingCode = element<HTMLElement>("replacement-pairing-code");
const cancelPairingButton = element<HTMLButtonElement>("cancel-pairing");
const copyPairingLinkButton =
  element<HTMLButtonElement>("copy-pairing-link");
const openPairingPageButton =
  element<HTMLButtonElement>("open-pairing-page");
const logoutButton = element<HTMLButtonElement>("logout-button");
const workspacePath = element<HTMLElement>("workspace-path");
const providerRow = element<HTMLElement>("provider-row");
const agentReadiness = element<HTMLElement>("agent-readiness");
const savedState = element<HTMLElement>("saved-state");
const saveFeedback = new TransientStatusController<"saving" | "saved">(
  (key) => {
    savedState.textContent = key ? t(key) : "";
  },
  (callback, delayMs) => {
    window.setTimeout(callback, delayMs);
  },
);
const settingsDialog = element<HTMLDialogElement>("settings-dialog");
const settingsForm = element<HTMLFormElement>("settings-form");
const settingsRuntime = element<HTMLElement>("settings-runtime");
const settingsCloseButton = element<HTMLButtonElement>("settings-close");
const settingsCancelButton = element<HTMLButtonElement>("settings-cancel");
const saveSettingsButton = element<HTMLButtonElement>("save-settings");
const launchAtLoginInput = element<HTMLInputElement>("launch-at-login");

const workspaceAccessDialog =
  element<HTMLDialogElement>("workspace-access-dialog");
const workspaceAccessLater =
  element<HTMLButtonElement>("workspace-access-later");
const workspaceAccessContinue =
  element<HTMLButtonElement>("workspace-access-continue");
const diagnosticsDialog = element<HTMLDialogElement>("diagnostics-dialog");
const logoutDialog = element<HTMLDialogElement>("logout-dialog");
const diagnosticSummary = element<HTMLElement>("diagnostic-summary");
const diagnosticLog = element<HTMLElement>("diagnostic-log");
const toast = element<HTMLElement>("toast");
const updateCard = element<HTMLElement>("update-card");
const updateTitle = element<HTMLElement>("update-title");
const updateDetail = element<HTMLElement>("update-detail");
const updateProgress = element<HTMLElement>("update-progress");
const updateProgressBar = element<HTMLElement>("update-progress-bar");
const installUpdateButton = element<HTMLButtonElement>("install-update");
const updateLaterButton = element<HTMLButtonElement>("update-later");
const confirmLogout = element<HTMLButtonElement>("confirm-logout");
const cancelLogout = element<HTMLButtonElement>("cancel-logout");
const browserList = element<HTMLElement>("browser-list");
const browserCount = element<HTMLElement>("browser-count");
const revokeBrowserDialog =
  element<HTMLDialogElement>("revoke-browser-dialog");
const confirmRevokeBrowser =
  element<HTMLButtonElement>("confirm-revoke-browser");
const cancelRevokeBrowser =
  element<HTMLButtonElement>("cancel-revoke-browser");
const revokeBrowserName = element<HTMLElement>("revoke-browser-name");
const languagePicker = element<HTMLElement>("language-picker");
const languageOptions = [
  ...languagePicker.querySelectorAll<HTMLButtonElement>("[data-language]"),
];
const openSettingsButton = element<HTMLButtonElement>("open-settings");
const appVersion = element<HTMLElement>("app-version");
const loginPairingExpiry = element<HTMLElement>("login-pairing-expiry");
const replacementPairingExpiry = element<HTMLElement>(
  "replacement-pairing-expiry",
);

let bootstrap: Bootstrap | null = null;
type PairingSurface = "initial" | "browser";
type PairingStage = BrowserPairingStage;

let pairingSurface: PairingSurface | null = null;
let pairingStage: PairingStage = "idle";
let pairingRunId = 0;
let pairingAbortController: AbortController | null = null;
let pairingCode = "";
let activePairingId = "";
const browserPairingCancellations = new PairingCancellationQueue(
  renderBrowserPairingCancellationAvailability,
);
let pairingExpiresAtMs = 0;
let pairingExpiryTimer = 0;
let toastTimer = 0;
type ToastPresentation =
  | {
      kind: "translation";
      key: TranslationKey;
      params?: Record<string, string | number>;
    }
  | { kind: "desktop-error"; code: DesktopErrorCode };
let activeToast: ToastPresentation | null = null;
let initialPairingErrorPresentation: ToastPresentation | null = null;
let browserAuthorizations: BrowserAuthorization[] = [];
let browserListLoading = false;
let browserListFailed = false;
let browserListLoadGeneration = 0;
let browserToRevoke: BrowserAuthorization | null = null;
let pendingUpdate: Update | null = null;
type UpdatePresentation =
  | "available"
  | "downloading"
  | "installing"
  | "restarting"
  | "failed";
let updatePresentation: UpdatePresentation = "available";
let checkingForUpdate = false;
let installingUpdate = false;
let dismissingUpdate = false;
let manualUpdateCheckRequested = false;
let dismissedUpdateVersion = "";
let startupFailureCode: DesktopErrorCode | null = null;
let startupDiagnosticSnapshot: RelaySnapshot | null = null;
let startupFailureRunId = 0;
let startupRetryInFlight = false;
const bootstrapRefreshGate = new LatestRequestGate();
let languageSwitchInFlight = false;
let languageSwitchRevision = 0;
let latestRelayEvent: RelaySnapshot | null = null;
let relayEventRevision = 0;
let relayStatusListening = false;
let relayStatusListenerPromise: Promise<void> | null = null;
let diagnosticsEventListening = false;
let updateCheckEventListening = false;
let diagnosticsEventListenerPromise: Promise<void> | null = null;
let updateCheckEventListenerPromise: Promise<void> | null = null;
let auxiliaryListenerFailureShown = false;
let desiredNativeUpdateAvailable: boolean | null = null;
let nativeUpdateSyncPromise: Promise<void> | null = null;
let nativeUpdateSyncFailureShown = false;
let nativeLanguageReconciliationNeeded = false;
let nativeLanguageReconciliationPromise: Promise<void> | null = null;
let nativeLanguageReconciliationFailureShown = false;
let settingsSaveInFlight = false;
let configSaveInFlight = false;
let logoutInFlight = false;
let instanceSwitchInFlight = false;
const pairingOrigins = new Map<string, string>();
let browserRevokeInFlight = false;
let relayStartInFlight = false;
let workspacePickerInFlight = false;
let folderAccessRequestInFlight = false;
let agentAvailability: AgentRuntimeAvailability[] = [];
let agentAvailabilityLoading = false;
let agentAvailabilityFailed = false;
let agentAvailabilityGeneration = 0;
let agentActionProvider: RelayProvider | null = null;
let agentActionKind: "install" | "login" | null = null;
let pairingPageOpenInFlight = false;
let pairingLinkCopyInFlight = false;
let browserListRestoreNextLoadFocus = false;

const updateCheckThrottle = new UpdateCheckThrottle();
const STARTUP_SLOW_NOTICE_MS = 4_000;

function openDialog(dialog: HTMLDialogElement) {
  if (!dialog.open) dialog.showModal();
}

function moveFocus(element: HTMLElement) {
  window.requestAnimationFrame(() => {
    if (!element.classList.contains("is-hidden") && element.isConnected) {
      element.focus({ preventScroll: true });
    }
  });
}

function openWorkspaceAccess() {
  if (
    !bootstrap ||
    bootstrap.platform.os !== "macos" ||
    !signedIn(bootstrap) ||
    workspaceAccessDialog.open ||
    installingUpdate
  ) return;
  openDialog(workspaceAccessDialog);
  moveFocus(workspaceAccessContinue);
}

function setFolderAccessRequestBusy(busy: boolean) {
  folderAccessRequestInFlight = busy;
  workspaceAccessDialog.toggleAttribute("aria-busy", busy);
  workspaceAccessContinue.toggleAttribute("aria-busy", busy);
  workspaceAccessContinue.toggleAttribute("aria-disabled", busy);
  workspaceAccessContinue.textContent = t(
    busy ? "requestingFolderAccess" : "continueFolderAccess",
  );
  workspaceAccessLater.disabled = busy;
  prepareTaskFiles.disabled = busy;
  prepareTaskFiles.toggleAttribute("aria-busy", busy);
  refreshUpdateActionAvailability();
  if (!busy) void requestNativeLanguageReconciliation();
}

async function requestWorkspaceAccess() {
  if (
    !bootstrap ||
    bootstrap.platform.os !== "macos" ||
    !signedIn(bootstrap) ||
    folderAccessRequestInFlight ||
    installingUpdate
  ) return;
  setFolderAccessRequestBusy(true);
  try {
    const granted = await relayApi.requestWorkspaceAccess();
    workspaceAccessDialog.close();
    showTranslatedToast(granted ? "folderAccessReady" : "folderAccessLimited");
  } catch (error) {
    showDesktopErrorToast(error, "workspace_invalid");
  } finally {
    setFolderAccessRequestBusy(false);
    moveFocus(workspaceAccessDialog.open ? workspaceAccessContinue : prepareTaskFiles);
  }
}

function focusSettingsError(code: DesktopErrorCode) {
  const fieldId = settingsRecoveryField(code);
  if (!fieldId) return;
  const input = element<HTMLInputElement>(fieldId);
  window.requestAnimationFrame(() => {
    input.focus({ preventScroll: true });
  });
}

function browserPairingEntryAction() {
  if (minimalInstalled && minimalScreen === "home") return element<HTMLButtonElement>("minimal-connect");
  return newPairingButton.classList.contains("is-hidden")
    ? browserList.querySelector<HTMLButtonElement>("[data-add-browser]") ??
        newPairingButton
    : newPairingButton;
}

function showStartupPreparing() {
  startupFailureRunId += 1;
  // Invalidate an older bootstrap immediately, before listener setup for the
  // new attempt can yield. Its native work may still finish, but refresh()
  // will reject the stale result without repainting the login surface.
  bootstrapRefreshGate.invalidate();
  const preparingRunId = startupFailureRunId;
  startupFailureCode = null;
  startupDiagnosticSnapshot = null;
  showOnly(loadingView);
  startupSpinner.classList.remove("is-hidden");
  startupRetry.classList.toggle("is-hidden", !startupRetryInFlight);
  startupRetry.disabled = !startupRetryInFlight;
  startupDiagnostics.classList.toggle("is-hidden", !startupRetryInFlight);
  renderStartupRetryBusy(startupRetryInFlight);
  startupMessage.dataset.i18n = "preparing";
  startupMessage.textContent = t("preparing");
  diagnosticSummary.dataset.i18n = "diagnosticsPreparing";
  diagnosticSummary.textContent = t("diagnosticsPreparing");
  diagnosticLog.dataset.i18n = "diagnosticsPreparingDetail";
  diagnosticLog.textContent = t("diagnosticsPreparingDetail");
  openSettingsButton.disabled = false;
  openSettingsButton.setAttribute("aria-describedby", "startup-message");
  window.setTimeout(() => {
    if (
      preparingRunId !== startupFailureRunId ||
      bootstrap !== null ||
      loadingView.classList.contains("is-hidden")
    ) {
      return;
    }
    startupMessage.dataset.i18n = "stillPreparing";
    startupMessage.textContent = t("stillPreparing");
    startupRetry.classList.remove("is-hidden");
    startupRetry.disabled = false;
    startupDiagnostics.classList.remove("is-hidden");
  }, STARTUP_SLOW_NOTICE_MS);
}

function showStartupFailure(error: unknown) {
  const failureRunId = startupFailureRunId + 1;
  startupFailureRunId = failureRunId;
  startupFailureCode = desktopErrorCode(error, "startup_failed");
  startupDiagnosticSnapshot = null;
  showOnly(loadingView);
  startupSpinner.classList.add("is-hidden");
  startupRetry.classList.remove("is-hidden");
  startupRetry.disabled = false;
  renderStartupRetryBusy(false);
  startupDiagnostics.classList.remove("is-hidden");
  startupMessage.dataset.i18n = "startupFailed";
  startupMessage.textContent = t("startupFailed");
  openSettingsButton.disabled = false;
  openSettingsButton.setAttribute("aria-describedby", "startup-message");
  showDesktopErrorCodeToast(startupFailureCode);
  renderStartupDiagnostics();
  void relayApi.snapshot().then((relay) => {
    if (
      failureRunId !== startupFailureRunId ||
      startupFailureCode === null
    ) {
      return;
    }
    startupDiagnosticSnapshot = relay;
    renderStartupDiagnostics();
  }).catch(() => {});
  moveFocus(startupRetry);
}

function renderStartupDiagnostics() {
  if (!startupFailureCode) return;
  const presentation = startupDiagnosticPresentation(
    locale,
    startupFailureCode,
    startupDiagnosticSnapshot,
  );
  diagnosticSummary.textContent = presentation.summary;
  diagnosticLog.textContent = presentation.log;
}

function renderStartupMessageForLocale() {
  const key = startupMessageKeyForRender(
    startupFailureCode,
    startupMessage.dataset.i18n,
  );
  startupMessage.dataset.i18n = key;
  startupMessage.textContent = t(key);
  if (startupFailureCode) renderStartupDiagnostics();
}

function renderInFlightActionCopy() {
  if (startupRetryInFlight) {
    startupRetry.textContent = t("retryingStartup");
  }
  if (saveSettingsButton.disabled) {
    saveSettingsButton.textContent = t("saving");
  }
  if (logoutInFlight) {
    confirmLogout.textContent = t("signingOut");
  }
  if (browserRevokeInFlight) {
    confirmRevokeBrowser.textContent = t("revoking");
  }
  if (folderAccessRequestInFlight) {
    workspaceAccessContinue.textContent = t("requestingFolderAccess");
  }
}

function renderStartupRetryBusy(busy: boolean) {
  startupRetryInFlight = busy;
  startupRetry.toggleAttribute("aria-busy", busy);
  startupRetry.toggleAttribute("aria-disabled", busy);
  startupRetry.textContent = t(busy ? "retryingStartup" : "retryStartup");
}

function setSettingsFormBusy(busy: boolean) {
  settingsSaveInFlight = busy;
  settingsForm.toggleAttribute("aria-busy", busy);
  launchAtLoginInput.disabled = busy;
  // LaunchAgent reconciliation can take a moment. Keep the initiating action
  // focused while the synchronous guard rejects duplicate submits;
  // native `disabled` would drop keyboard and screen-reader users onto body.
  saveSettingsButton.disabled = false;
  saveSettingsButton.toggleAttribute("aria-busy", busy);
  saveSettingsButton.toggleAttribute("aria-disabled", busy);
  settingsCloseButton.disabled = busy;
  settingsCancelButton.disabled = busy;
  renderConfigActionAvailability();
  refreshUpdateActionAvailability();
  if (!busy) void requestNativeLanguageReconciliation();
}

function renderConfigActionAvailability() {
  if (!bootstrap || !signedIn(bootstrap)) return;
  renderReplacementPairing();
  renderBrowserAuthorizations();
  renderAgentAvailability();
}

function setConfigSaveBusy(busy: boolean) {
  configSaveInFlight = busy;
  if (busy) {
    languagePicker.setAttribute("aria-disabled", "true");
  } else if (!languageSwitchInFlight) {
    languagePicker.removeAttribute("aria-disabled");
  }
  renderConfigActionAvailability();
  refreshUpdateActionAvailability();
  if (!busy) void requestNativeLanguageReconciliation();
}

function setRelayStartBusy(busy: boolean) {
  relayStartInFlight = busy;
  statusCard.toggleAttribute("aria-busy", busy);
  if (busy) {
    languagePicker.setAttribute("aria-disabled", "true");
  } else if (!languageSwitchInFlight && !configSaveInFlight && !installingUpdate) {
    languagePicker.removeAttribute("aria-disabled");
  }
  renderConfigActionAvailability();
  refreshUpdateActionAvailability();
  if (!busy) void requestNativeLanguageReconciliation();
}

function renderRelayRetryAvailability(canRetry: boolean) {
  const visible = canRetry || relayStartInFlight;
  retryRelay.classList.toggle("is-hidden", !visible);
  statusActions.classList.toggle("is-hidden", !visible);
  retryRelay.disabled =
    !visible || (updateInstallIsBlocked() && !relayStartInFlight);
  retryRelay.toggleAttribute("aria-busy", relayStartInFlight);
  retryRelay.toggleAttribute("aria-disabled", relayStartInFlight);
  retryRelay.textContent = t(relayStartInFlight ? "connecting" : "reconnect");
}

function renderInitialPairingActionAvailability() {
  const busy =
    pairingStage !== "idle" || nativeLanguageReconciliationPromise !== null;
  // Starting a secure connection can spend several seconds creating PAKE
  // material or recovering the network. Keep the pressed primary action
  // focused while its click guard rejects duplicates; native `disabled`
  // would drop keyboard and screen-reader users onto the document body.
  loginButton.disabled = installingUpdate;
  loginButton.toggleAttribute("aria-busy", busy);
  loginButton.toggleAttribute("aria-disabled", busy || installingUpdate);
}

function setWorkspacePickerBusy(busy: boolean) {
  workspacePickerInFlight = busy;
  element<HTMLButtonElement>("choose-workspace").toggleAttribute(
    "aria-busy",
    busy,
  );
  if (busy) {
    languagePicker.setAttribute("aria-disabled", "true");
  } else if (!languageSwitchInFlight && !configSaveInFlight && !installingUpdate) {
    languagePicker.removeAttribute("aria-disabled");
  }
  renderConfigActionAvailability();
  refreshUpdateActionAvailability();
  if (!busy) void requestNativeLanguageReconciliation();
}

function updateInstallIsBlocked() {
  if (instanceSwitchInFlight) return true;
  return updateInstallBlocked({
    installingUpdate,
    pairingInFlight: pairingStage !== "idle",
    browserPairingCancellationInFlight:
      browserPairingCancellations.active,
    configSaveInFlight,
    settingsSaveInFlight,
    languageSwitchInFlight,
    logoutInFlight,
    browserRevokeInFlight,
    relayStartInFlight,
    workspacePickerInFlight,
    folderAccessRequestInFlight,
    agentActionInFlight: agentActionProvider !== null,
    nativeLanguageReconciliationInFlight:
      nativeLanguageReconciliationPromise !== null,
  });
}

function refreshUpdateActionAvailability() {
  if (pendingUpdate) renderPendingUpdate();
  if (bootstrap) {
    const canRetry =
      bootstrap.relay.phase === "error" ||
      (bootstrap.relay.phase === "starting" &&
        Boolean(bootstrap.relay.last_error));
    renderRelayRetryAvailability(canRetry);
  }
}

function setNativeLanguageReconciliationBusy(busy: boolean) {
  const focusPreservingControls = [
    loginButton,
    openSettingsButton,
    element<HTMLButtonElement>("choose-workspace"),
    logoutButton,
    newPairingButton,
    saveSettingsButton,
    confirmLogout,
    confirmRevokeBrowser,
    ...document.querySelectorAll<HTMLButtonElement>(
      "[data-adapter], [data-provider], [data-agent-action], [data-revoke-browser], [data-add-browser], [data-reload-browsers]",
    ),
  ];
  for (const control of focusPreservingControls) {
    if (busy) {
      control.setAttribute("aria-disabled", "true");
    } else {
      control.removeAttribute("aria-disabled");
    }
  }
  if (bootstrap && !signedIn(bootstrap) && pairingStage === "idle") {
    loginNote.textContent = busy ? t("finishingSetup")
      : initialPairingErrorPresentation ? toastPresentationText(initialPairingErrorPresentation)
      : t(bootstrap.platform.os === "macos" ? "desktopLoginNote" : "loginNote");
  }
  if (busy) {
    loginButton.setAttribute("aria-busy", "true");
  } else if (bootstrap) {
    if (signedIn(bootstrap)) {
      renderConfigActionAvailability();
      if (!settingsSaveInFlight) saveSettingsButton.disabled = false;
      if (!logoutInFlight) confirmLogout.disabled = false;
      if (!browserRevokeInFlight) confirmRevokeBrowser.disabled = false;
    } else {
      renderInitialPairingActionAvailability();
      openSettingsButton.disabled = true;
    }
  }
  refreshUpdateActionAvailability();
}

function handleRelayStatus(payload: RelaySnapshot) {
  latestRelayEvent = payload;
  relayEventRevision += 1;
  if (!bootstrap) return;
  bootstrap = { ...bootstrap, relay: payload };
  renderRelay(payload);
  renderBrowserAuthorizations();
}

function ensureRelayStatusListener() {
  if (relayStatusListening) return Promise.resolve();
  if (relayStatusListenerPromise) return relayStatusListenerPromise;
  relayStatusListenerPromise = listen<RelaySnapshot>(
    "relay-status",
    (event) => handleRelayStatus(event.payload),
  )
    .then(() => {
      relayStatusListening = true;
    })
    .finally(() => {
      relayStatusListenerPromise = null;
    });
  return relayStatusListenerPromise;
}

function ensureAuxiliaryNativeListeners() {
  if (diagnosticsEventListening && updateCheckEventListening) {
    auxiliaryListenerFailureShown = false;
    return Promise.resolve();
  }
  const registrations: Promise<void>[] = [];
  if (!diagnosticsEventListening) {
    if (!diagnosticsEventListenerPromise) {
      diagnosticsEventListenerPromise = listen("open-diagnostics", () => openDialog(diagnosticsDialog)).then(unlisten =>
        listen<string>("open-agent-management", (event) => {
          if (!warmShell || !bootstrap || !signedIn(bootstrap)) return;
          if (agentActionsDisabled()) return;
          showWarmSettings(openSettingsButton, "agents");
          const row = agentReadiness.querySelector<HTMLElement>(`[data-agent-provider="${event.payload}"]`);
          row?.focus();
        }).catch(error => { unlisten(); throw error; }),
      )
        .then(() => {
          diagnosticsEventListening = true;
        })
        .finally(() => {
          diagnosticsEventListenerPromise = null;
        });
    }
    registrations.push(diagnosticsEventListenerPromise);
  }
  if (!updateCheckEventListening) {
    if (!updateCheckEventListenerPromise) {
      updateCheckEventListenerPromise = listen("check-for-updates", () => {
        void checkForUpdates(true);
      })
        .then(() => {
          updateCheckEventListening = true;
        })
        .finally(() => {
          updateCheckEventListenerPromise = null;
        });
    }
    registrations.push(updateCheckEventListenerPromise);
  }
  return Promise.all(registrations).then(() => {
    auxiliaryListenerFailureShown = false;
  });
}

function notifyAuxiliaryListenerFailure() {
  if (auxiliaryListenerFailureShown) return;
  auxiliaryListenerFailureShown = true;
  showTranslatedToast("menuActionsUnavailable");
}

async function flushNativeUpdateAvailability() {
  while (desiredNativeUpdateAvailable !== null) {
    const desired = desiredNativeUpdateAvailable;
    desiredNativeUpdateAvailable = null;
    try {
      await relayApi.setUpdateAvailable(desired);
      nativeUpdateSyncFailureShown = false;
    } catch (error) {
      // Preserve a newer request that arrived while the native refresh was in
      // flight; otherwise retain the failed value for focus/online recovery.
      if (desiredNativeUpdateAvailable === null) {
        desiredNativeUpdateAvailable = desired;
      }
      if (!nativeUpdateSyncFailureShown) {
        nativeUpdateSyncFailureShown = true;
        showDesktopErrorToast(error, "update_failed");
      }
      return;
    }
  }
}

function requestNativeUpdateAvailability(available?: boolean) {
  if (available !== undefined) desiredNativeUpdateAvailable = available;
  if (desiredNativeUpdateAvailable === null || nativeUpdateSyncPromise) return;
  nativeUpdateSyncPromise = flushNativeUpdateAvailability().finally(() => {
    nativeUpdateSyncPromise = null;
  });
}

function requestNativeLanguageReconciliation() {
  if (
    !bootstrap ||
    pairingStage !== "idle" ||
    configSaveInFlight ||
    settingsSaveInFlight ||
    logoutInFlight ||
    browserRevokeInFlight ||
    relayStartInFlight ||
    workspacePickerInFlight ||
    folderAccessRequestInFlight ||
    installingUpdate ||
    browserPairingCancellations.active ||
    languageSwitchInFlight ||
    !nativeLanguageReconciliationNeeded
  ) {
    return nativeLanguageReconciliationPromise ?? Promise.resolve();
  }
  if (nativeLanguageReconciliationPromise) {
    return nativeLanguageReconciliationPromise;
  }

  const desiredLanguage = locale;
  nativeLanguageReconciliationPromise = relayApi
    .setUiLanguage(desiredLanguage)
    .then(() => {
      // A newer refresh may have selected another persisted language while
      // this native command was in flight. Only clear the request we actually
      // reconciled; the newer desired value must still reach the menu/AX tree.
      if (locale === desiredLanguage) {
        nativeLanguageReconciliationNeeded = false;
      }
      nativeLanguageReconciliationFailureShown = false;
    })
    .catch((error) => {
      nativeLanguageReconciliationNeeded = true;
      if (!nativeLanguageReconciliationFailureShown) {
        nativeLanguageReconciliationFailureShown = true;
        showDesktopErrorToast(error, "language_failed");
      }
    })
    .finally(() => {
      nativeLanguageReconciliationPromise = null;
      setNativeLanguageReconciliationBusy(false);
      if (
        nativeLanguageReconciliationNeeded &&
        locale !== desiredLanguage &&
        !installingUpdate &&
        !languageSwitchInFlight
      ) {
        void requestNativeLanguageReconciliation();
      }
    });
  setNativeLanguageReconciliationBusy(true);
  return nativeLanguageReconciliationPromise;
}

async function refreshWithNativeListeners() {
  await ensureRelayStatusListener();
  const auxiliaryListenerAttempt = ensureAuxiliaryNativeListeners().then(
    () => true,
    () => false,
  );
  const refreshed = await refresh();
  if (!refreshed) return false;
  // Diagnostics and update actions must not delay pairing or Relay use.
  // Report a failed registration only after the primary surface is usable.
  void auxiliaryListenerAttempt.then((ready) => {
    if (!ready) notifyAuxiliaryListenerFailure();
  });
  return true;
}

async function setLocale(nextLocale: AppLocale) {
  if (
    nextLocale === locale ||
    languageSwitchInFlight ||
    configSaveInFlight ||
    relayStartInFlight ||
    workspacePickerInFlight ||
    installingUpdate
  ) return;
  languageSwitchInFlight = true;
  languageSwitchRevision += 1;
  const previousLocale = locale;
  locale = nextLocale;
  languagePicker.setAttribute("aria-disabled", "true");
  languagePicker.setAttribute("aria-busy", "true");
  applyStaticTranslations();
  renderActiveToast();
  saveFeedback.retranslate();
  if (bootstrap) {
    render(bootstrap, { preserveSettingsDraft: settingsDialog.open });
  }
  renderInFlightActionCopy();
  if (!startupRetry.classList.contains("is-hidden")) {
    renderStartupMessageForLocale();
  }
  if (browserToRevoke) revokeBrowserName.textContent = browserToRevoke.name;
  if (pendingUpdate) {
    renderPendingUpdate();
  }
  try {
    // Finish any background bootstrap reconciliation first. Otherwise an
    // older native command could complete after this explicit user choice and
    // switch the menu bar back while the window remains on the new language.
    if (nativeLanguageReconciliationPromise) {
      await nativeLanguageReconciliationPromise;
    }
    await relayApi.setUiLanguage(nextLocale);
    nativeLanguageReconciliationNeeded = false;
    nativeLanguageReconciliationFailureShown = false;
    persistAppLocale(nextLocale);
    if (bootstrap) {
      bootstrap = {
        ...bootstrap,
        config: { ...bootstrap.config, ui_language: nextLocale },
      };
    }
  } catch (error) {
    locale = previousLocale;
    if (bootstrap) {
      bootstrap = {
        ...bootstrap,
        config: { ...bootstrap.config, ui_language: previousLocale },
      };
    }
    applyStaticTranslations();
    renderActiveToast();
    saveFeedback.retranslate();
    if (bootstrap) {
      render(bootstrap, { preserveSettingsDraft: settingsDialog.open });
    }
    renderInFlightActionCopy();
    if (pendingUpdate) renderPendingUpdate();
    if (!startupRetry.classList.contains("is-hidden")) {
      renderStartupMessageForLocale();
    }
    // Rust preserves the old language on failure, but an AppKit refresh and
    // its rollback can both fail. A same-value reconciliation on focus/online
    // repairs that mixed native state without asking the user to toggle twice.
    nativeLanguageReconciliationNeeded = true;
    nativeLanguageReconciliationFailureShown = true;
    showDesktopErrorToast(error, "language_failed");
  } finally {
    languageSwitchInFlight = false;
    languagePicker.removeAttribute("aria-disabled");
    languagePicker.removeAttribute("aria-busy");
    renderConfigActionAvailability();
    refreshUpdateActionAvailability();
    void requestNativeLanguageReconciliation();
  }
}

function localDeviceName() {
  const fallback = bootstrap?.platform.os === "windows"
    ? t("windowsDeviceName")
    : t("macDeviceName");
  return desktopDeviceName(bootstrap?.platform, fallback);
}

function currentPairingUrl() {
  if (!bootstrap || !activePairingId) return "";
  return pairingConnectionUrl(bootstrap.config.server_url, activePairingId);
}

function currentPairingQrPayload() {
  if (!activePairingId || !pairingCode) return "";
  return pairingQrPayload(activePairingId, pairingCode);
}

function setPairingQrPresentation(
  canvas: HTMLCanvasElement,
  status: HTMLElement,
  key: "qrPreparing" | "scanToOpen" | "scanOtherDevice" | "qrFailed",
  imageAvailable: boolean,
) {
  status.textContent = t(key);
  status.dataset.tone = key === "qrFailed" ? "error" : "status";
  if (imageAvailable) {
    canvas.removeAttribute("aria-hidden");
  } else {
    canvas.setAttribute("aria-hidden", "true");
  }
}

const pairingQrGenerations = new WeakMap<HTMLCanvasElement, number>();

function renderPairingQrCode(
  canvas: HTMLCanvasElement,
  status: HTMLElement,
  readyKey: "scanToOpen" | "scanOtherDevice",
  payload: string,
  generation: number,
) {
  if (!payload || pairingQrGenerations.get(canvas) === generation) return;
  pairingQrGenerations.set(canvas, generation);
  canvas.setAttribute("aria-busy", "true");
  setPairingQrPresentation(canvas, status, "qrPreparing", false);
  const stagingCanvas = document.createElement("canvas");
  void toCanvas(stagingCanvas, payload, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 148,
    color: {
      dark: "#173f35ff",
      light: "#ffffffff",
    },
  })
    .then(() => {
      // The user can cancel and immediately create another one-time session.
      // Never let the older asynchronous render overwrite the newer code.
      if (pairingQrGenerations.get(canvas) !== generation) return;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("pairing QR canvas is unavailable");
      canvas.width = stagingCanvas.width;
      canvas.height = stagingCanvas.height;
      context.drawImage(stagingCanvas, 0, 0);
      canvas.removeAttribute("aria-busy");
      setPairingQrPresentation(canvas, status, readyKey, true);
    })
    .catch(() => {
      if (pairingQrGenerations.get(canvas) === generation) {
        pairingQrGenerations.delete(canvas);
        canvas.removeAttribute("aria-busy");
        canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
        // Keep this failure beside the QR for the lifetime of the pairing.
        // A transient toast alone leaves an empty canvas exposed as a valid
        // image after assistive technology has finished announcing it.
        setPairingQrPresentation(canvas, status, "qrFailed", false);
      }
    });
}

function invalidatePairingQrCodes() {
  for (const canvas of [loginPairingQr, replacementPairingQr]) {
    pairingQrGenerations.delete(canvas);
    canvas.removeAttribute("aria-busy");
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function renderPairingQrCodes() {
  const payload = currentPairingQrPayload();
  if (pairingSurface === "initial" && pairingCode) {
    renderPairingQrCode(
      loginPairingQr,
      loginPairingQrStatus,
      "scanToOpen",
      payload,
      pairingRunId,
    );
  }
  if (pairingSurface === "browser" && pairingCode) {
    renderPairingQrCode(
      replacementPairingQr,
      replacementPairingQrStatus,
      "scanOtherDevice",
      payload,
      pairingRunId,
    );
  }
}

function updatePairingExpiry() {
  const countdown = pairingCode
    ? formatPairingCountdown(pairingExpiresAtMs, Date.now(), locale)
    : "";
  const label = countdown ? t("pairingExpiresIn", { time: countdown }) : "";
  loginPairingExpiry.textContent = label;
  replacementPairingExpiry.textContent = label;
  loginPairingExpiry.classList.toggle(
    "is-hidden",
    pairingSurface !== "initial" || !label,
  );
  replacementPairingExpiry.classList.toggle(
    "is-hidden",
    pairingSurface !== "browser" || !label,
  );
}

function tickPairingExpiry() {
  if (
    pairingCode &&
    (pairingStage === "waiting" || pairingStage === "recovering") &&
    pairingDeadlineExpired(pairingExpiresAtMs)
  ) {
    expireCurrentPairing();
    return;
  }
  updatePairingExpiry();
}

function startPairingExpiry(expiresAt: string | null = null) {
  window.clearInterval(pairingExpiryTimer);
  const serverDeadline = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  pairingExpiresAtMs = Number.isFinite(serverDeadline)
    ? serverDeadline
    : Date.now() + 10 * 60_000;
  updatePairingExpiry();
  pairingExpiryTimer = window.setInterval(tickPairingExpiry, 1_000);
}

function signedIn(value: Bootstrap) {
  if (
    value.platform.os === "macos" &&
    value.secrets.device_token &&
    value.config.browser_ids.length === 0
  ) {
    return true;
  }
  // A bearer token without a usable browser content key cannot run Relay.
  // Treat partial secure-store state as reconnectable onboarding instead of
  // dropping the user on a permanently broken "connected" home surface.
  return value.secrets.device_token && value.secrets.e2ee_key;
}

function showOnly(view: HTMLElement) {
  document.body.dataset.platform = bootstrap?.platform.os ??
    (/Mac/.test(navigator.platform) ? "macos" : "windows");
  opening.show(
    view === loginView ? "login" : view === loadingView ? "loading" : "home",
    false, // The compact utility uses only explicit screen transitions.
  );
  if (view !== homeView) warmShell?.closeAccount();
  for (const candidate of [loadingView, loginView, homeView]) {
    candidate.classList.toggle("is-hidden", candidate !== view);
  }
}

type MinimalScreen = "home" | "devices" | "pairing" | "settings" | "help" | "agents" | "account";
let warmShell: ReturnType<typeof installWarmShell> | null = null;
let preventLockStatus: Awaited<ReturnType<typeof relayApi.getKeepAwakeStatus>> | null = null;
let preventLockSaving = false;
let preventLockReadRevision = 0;
async function refreshPreventLockStatus() {
  if (bootstrap?.platform.os !== "macos" || preventLockSaving) return;
  const revision = ++preventLockReadRevision;
  try {
    const status = await relayApi.getKeepAwakeStatus();
    if (revision === preventLockReadRevision && !preventLockSaving) preventLockStatus = status;
  } catch (error) { showDesktopErrorToast(error, "keep_awake_failed"); }
  renderWarmSummary();
}
async function savePreventLock(enabled: boolean) {
  if (preventLockSaving || !preventLockStatus?.supported) return;
  preventLockSaving = true;
  ++preventLockReadRevision;
  renderWarmSummary();
  try {
    preventLockStatus = await relayApi.setPreventAutomaticLock(enabled);
    if (preventLockStatus.error) showDesktopErrorCodeToast("keep_awake_failed");
  } catch (error) { showDesktopErrorToast(error, "keep_awake_failed"); }
  finally {
    preventLockSaving = false;
    renderWarmSummary();
    await refreshPreventLockStatus();
  }
}
void listen("keep-awake-changed", () => { void refreshPreventLockStatus(); });
let minimalScreen: MinimalScreen = "home";
let minimalInstalled = false;
let minimalPairingMethod: "phone" | "browser" = "phone";
let minimalPairingExpired = false;
const minimalMotionTimers = new WeakMap<HTMLElement, number>();

function installMinimalShell(value: Bootstrap) {
  if (value.platform.os !== "macos" || minimalInstalled) return;
  document.body.classList.add("minimal-macos");
  const home = document.createElement("section");
  home.id = "minimal-home";
  home.className = "minimal-screen";
  home.innerHTML = `<button class="minimal-account-entry" id="minimal-account" type="button" aria-haspopup="dialog" aria-controls="settings-dialog"><span class="minimal-account-avatar" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="3.5"/><path d="M5 20v-2a7 7 0 0 1 14 0v2"/></svg></span><span class="minimal-account-copy"><span data-i18n="signedInStatus"></span><strong id="minimal-account-email" dir="auto"></strong></span><span class="minimal-account-chevron" aria-hidden="true">›</span></button><div class="minimal-home-summary"></div><button class="primary" id="minimal-home-action" type="button" hidden></button><button class="minimal-navigation-row" id="minimal-manage" type="button" data-i18n="minimalManageDevices"></button><p class="minimal-footer" data-i18n="backgroundNote"></p>`;
  const connect = document.createElement("button");
  connect.id = "minimal-connect";
  connect.className = "primary";
  connect.type = "button";
  connect.dataset.i18n = "minimalConnect";
  connect.addEventListener("click", () => { void beginPairing("browser"); });
  home.querySelector(".minimal-home-summary")!.append(statusCard, connect);
  const devices = document.createElement("section");
  devices.id = "minimal-devices";
  devices.className = "minimal-screen is-hidden";
  devices.innerHTML = `<header class="minimal-page-header"><button class="minimal-back" type="button" data-i18n="minimalBack"></button><h2 tabindex="-1" data-i18n="minimalManageDevices"></h2></header>`;
  devices.querySelector("button")!.addEventListener("click", () => navigateMinimal("home"));
  devices.append(document.querySelector(".browser-devices")!);
  const deviceHeading = devices.querySelector(".minimal-page-header")!;
  const deviceHeadingCopy = document.createElement("div");
  deviceHeadingCopy.className = "device-page-copy";
  deviceHeadingCopy.append(devices.querySelector("h2")!);
  const deviceTotal = document.createElement("p");
  deviceTotal.id = "device-page-total";
  deviceHeadingCopy.append(deviceTotal);
  newPairingButton.dataset.i18n = "minimalConnect";
  deviceHeading.append(deviceHeadingCopy, newPairingButton);
  const explanation = document.createElement("p");
  explanation.className = "minimal-footer";
  explanation.dataset.i18n = "minimalDeviceExplanation";
  devices.append(explanation);
  const pairing = document.createElement("section");
  pairing.id = "minimal-pairing";
  pairing.className = "minimal-screen is-hidden";
  pairing.innerHTML = `<header class="minimal-page-header"><h2 tabindex="-1" data-i18n="minimalConnect"></h2></header><div class="minimal-pairing-methods" role="group"><button type="button" data-pairing-method="phone" data-i18n="minimalPhone" aria-pressed="true"></button><button type="button" data-pairing-method="browser" data-i18n="minimalBrowser" aria-pressed="false"></button></div><p id="minimal-pairing-instruction"></p>`;
  pairing.append(pairingPanel);
  const regenerate = document.createElement("button");
  regenerate.id = "minimal-regenerate";
  regenerate.type = "button";
  regenerate.className = "primary is-hidden";
  regenerate.dataset.i18n = "retryStartup";
  regenerate.addEventListener("click", () => { void beginPairing("browser"); });
  cancelPairingButton.before(regenerate);
  pairing.addEventListener("click", event => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-pairing-method]");
    if (!target) return;
    minimalPairingMethod = target.dataset.pairingMethod === "browser" ? "browser" : "phone";
    renderMinimalPairing();
  });
  homeView.append(home, devices, pairing);
  element("minimal-manage").addEventListener("click", () => navigateMinimal("devices"));
  element("minimal-account").addEventListener("click", () => showWarmSettings(element("minimal-account"), "account"));

  const settingsContent = document.createElement("div");
  settingsContent.className = "minimal-settings-section";
  settingsForm.querySelector("header")!.after(settingsContent);
  const signedInSettings = document.createElement("div");
  signedInSettings.id = "minimal-signed-in-settings";
  signedInSettings.append(element("account-card"), document.querySelector(".quick-settings")!, element("file-access-warning"), document.querySelector(".account-actions")!);
  settingsContent.append(signedInSettings, element("update-card"));
  const version = document.createElement("p");
  version.className = "minimal-footer";
  version.textContent = `Relayune ${value.version}`;
  settingsContent.append(version);
  settingsContent.append(appVersion, statusTime);
  homeView.querySelector(".desktop-workspace")?.remove();
  homeView.querySelector(".desktop-overview")?.remove();
  homeView.querySelector(".footer-copy")?.remove();
  devices.querySelector("h2")!.id = "minimal-devices-title";
  browserList.setAttribute("aria-labelledby", "minimal-devices-title");
  devices.querySelector(".browser-devices")!.setAttribute("aria-labelledby", "minimal-devices-title");
  devices.querySelector(".section-title > div:first-child")?.remove();
  browserCount.hidden = true;
  pairingPanel.querySelector(".eyebrow")?.remove();
  pairingPanel.querySelector(".pairing-panel-copy > strong")?.remove();
  pairingStageElement.hidden = true;
  pairingPanel.querySelector(".pairing-security-note")?.remove();
  replacementPairingOptions.querySelector(".pairing-code-column > span")?.remove();
  void listen("desktop-window-hidden", () => { if (pairingSurface === "browser") cancelPairing(); });
  minimalInstalled = true;
  warmShell = installWarmShell({
    t, navigate: tab => {
      if (tab === "devices") {
        if (pairingStage === "idle") void beginPairing("browser");
        else navigateMinimal("pairing");
      } else navigateMinimal(tab);
    }, settings: showWarmSettings,
    checkUpdates: () => { void checkForUpdates(true); },
    language: next => { void setLocale(next).finally(renderWarmSummary); },
    launchAtLogin: enabled => { void saveLaunchAtLogin(enabled, true); },
    preventLock: enabled => { void savePreventLock(enabled); },
    openPage: (destination, button) => { void openPublicPage(destination, button); },
  });
  // Keep the legacy configuration fields for non-macOS clients, out of the new UI.
  element("adapter-segments").closest(".setting-row")!.classList.add("warm-legacy-adapters");
  const allAgents = document.createElement("button");
  allAgents.id = "warm-enable-agents"; allAgents.type = "button";
  allAgents.className = "secondary"; allAgents.dataset.i18n = "warmEnableAgents";
  allAgents.addEventListener("click", () => { if (bootstrap) void saveConfig({ ...bootstrap.config, adapter: "multi" }); });
  agentReadiness.before(allAgents);
  const startupFeedback = document.createElement("button");
  startupFeedback.id = "warm-startup-feedback"; startupFeedback.type = "button";
  startupFeedback.className = "secondary"; startupFeedback.dataset.i18n = "feedbackTitle";
  startupFeedback.addEventListener("click", () => element<HTMLButtonElement>("open-feedback").click());
  settingsForm.querySelector(".language-settings")!.after(startupFeedback);
  applyStaticTranslations();
}

function navigateMinimal(screen: MinimalScreen, focus = true) {
  if (!minimalInstalled) return;
  if (screen === "account") { warmShell?.openAccount(); return; }
  if (screen !== "pairing" && pairingSurface === "browser" && pairingStage !== "idle") {
    if (pairingStage === "finishing") return;
    cancelPairing();
  }
  if (screen !== "pairing") minimalPairingExpired = false;
  const changed = minimalScreen !== screen;
  if (changed) document.querySelector(".warm-content")?.scrollTo({ top: 0 });
  document.body.dataset.navigation = screen === "home" ? "back" : "forward";
  minimalScreen = screen;
  document.body.dataset.screen = screen;
  warmShell?.select(screen);
  if (screen === "settings") void refreshPreventLockStatus();
  for (const name of ["home", "devices", "pairing", "settings", "help", "agents"] as const) {
    const panel = element(`minimal-${name}`);
    const visible = screen === name;
    panel.classList.toggle("is-hidden", !visible);
    panel.inert = !visible;
    if (changed && screen === name) {
      panel.classList.remove("is-entering");
      panel.classList.add("is-entering");
      window.clearTimeout(minimalMotionTimers.get(panel));
      minimalMotionTimers.set(panel, window.setTimeout(() => panel.classList.remove("is-entering"), 240));
      if (focus) moveFocus(screen === "home" ? element("minimal-connect") : panel.querySelector<HTMLElement>("h2")!);
    }
  }
}

function renderWarmSummary() {
  if (!warmShell || !bootstrap) return;
  warmShell.refreshPreventLock(preventLockStatus, preventLockSaving, bootstrap.platform.os === "macos");
  warmShell.refreshGeneral(locale, bootstrap.launch_at_login,
    settingsSaveInFlight || languageSwitchInFlight || configSaveInFlight || relayStartInFlight || workspacePickerInFlight || nativeLanguageReconciliationPromise !== null || browserPairingCancellations.active || agentActionProvider !== null || installingUpdate || pairingStage !== "idle");
  warmShell.refresh({ agents: agentAvailability, checking: agentAvailabilityLoading,
    failed: agentAvailabilityFailed, version: bootstrap.version,
    name: agentName, status: agentStatusText });
  element("warm-enable-agents").classList.toggle("is-hidden", bootstrap.config.adapter === "multi");
  element<HTMLButtonElement>("warm-enable-agents").disabled = agentActionsDisabled() || configSaveInFlight;
}

function showWarmSettings(_trigger: HTMLElement, section: SettingsSection) {
  if (!warmShell || openSettingsButton.disabled || nativeLanguageReconciliationPromise || browserPairingCancellations.active) return;
  if (section === "account") { warmShell.openAccount(); return; }
  navigateMinimal(section === "agents" ? section : "settings", false);
  warmShell.focusSection(section);
}

function renderMinimalHomeState() {
  if (!minimalInstalled || !bootstrap || !signedIn(bootstrap)) return;
  renderWarmSummary();
  const state = resolveHomeReadiness({ bootstrap, agents: agentAvailability, checking: agentAvailabilityLoading, failed: agentAvailabilityFailed });
  const action = element<HTMLButtonElement>("minimal-home-action");
  action.hidden = true;
  action.disabled = false;
  action.onclick = null;
  statusCard.dataset.tone = state.tone;
  element("moonlight-device-name").textContent = localDeviceName();
  const connected = bootstrap.relay.phase === "connected";
  element("moonlight-connection-label").textContent = t(connected ? "connectedBadge" : "notConnected");
  element("moonlight-connection-label").parentElement!.dataset.connected = String(connected);
  if (state.kind === "ready") {
    statusLabel.textContent = t("warmReady");
    statusDetail.textContent = t("warmReadyDetail");
  } else if (state.kind === "checking" || state.kind === "check-failed") {
    statusLabel.textContent = t(state.kind === "checking" ? "agentChecking" : "agentCheckFailed");
    statusDetail.textContent = state.kind === "checking" ? t("agentHelp") : t("retryAgentCheck");
    if (state.kind === "check-failed") {
      action.hidden = false;
      action.disabled = agentActionsDisabled();
      action.textContent = t("retryAgentCheck");
      action.onclick = () => { void loadAgentAvailability(); };
    }
  } else if (state.kind === "agent" && state.provider) {
    const provider = state.provider;
    const runtime = agentAvailability.find(value => value.provider === provider);
    statusLabel.textContent = t(state.agentStatus === "not_logged_in" ? "minimalAgentLoginTitle" : state.agentStatus === "not_installed" ? "minimalAgentInstallTitle" : "minimalAgentRepairTitle", { agent: agentName(provider) });
    statusDetail.textContent = t("minimalAgentActionDetail");
    action.hidden = false;
    action.disabled = agentActionsDisabled();
    action.textContent = runtime ? agentActionLabel(runtime) || t("settings") : t("settings");
    action.onclick = () => {
      const kind = runtime && agentRuntimeAction(runtime.status);
      if (kind === "login") void openLocalAgentLogin(provider);
      else if (kind === "install") void installLocalAgent(provider);
      else showWarmSettings(element("minimal-home-action"), "agents");
    };
  }
  element("minimal-connect").classList.remove("is-hidden");
}

function renderMinimalPairing() {
  if (!minimalInstalled) return;
  const active = pairingSurface === "browser" && pairingStage !== "idle";
  if (active) navigateMinimal("pairing", false);
  else if (minimalScreen === "pairing" && !minimalPairingExpired) navigateMinimal("home");
  pairingPanel.classList.toggle("is-hidden", !active && !minimalPairingExpired);
  const browser = minimalPairingMethod === "browser";
  element("minimal-pairing-instruction").textContent = t(browser ? "minimalBrowserInstruction" : "minimalPhoneInstruction");
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-pairing-method]")) {
    button.setAttribute("aria-pressed", String(button.dataset.pairingMethod === minimalPairingMethod));
    button.disabled = pairingStage === "finishing";
  }
  replacementPairingOptions.querySelector<HTMLElement>(".pairing-qr-card")!.classList.toggle("is-hidden", browser);
  replacementPairingOptions.querySelector<HTMLElement>(".pairing-link-actions")!.classList.toggle("is-hidden", !browser);
  element("minimal-regenerate").classList.toggle("is-hidden", !minimalPairingExpired);
  element<HTMLButtonElement>("minimal-regenerate").disabled = browserPairingCancellations.active || installingUpdate;
  if (minimalPairingExpired) pairingPanelStatus.textContent = t("pairingExpired");
  else if (pairingStage === "waiting") pairingPanelStatus.textContent = t("waitingBrowser");
  cancelPairingButton.textContent = t(pairingStage === "finishing" ? "pairingFinishing" : "cancelConnection");
  element<HTMLButtonElement>("minimal-connect").disabled = newPairingButton.disabled;
}

function render(
  value: Bootstrap,
  options: { preserveSettingsDraft?: boolean } = {},
) {
  renderInstanceEntry(value);
  bootstrap = value;
  installMinimalShell(value);
  if (minimalInstalled) {
    element("minimal-signed-in-settings").classList.toggle("is-hidden", !signedIn(value));
    element("warm-startup-feedback").hidden = signedIn(value);
  }
  if (!signedIn(value)) { minimalPairingExpired = false; navigateMinimal("home", false); }
  renderProductVersion();
  if (!signedIn(value)) {
    const usesMacDesktopLogin = value.platform.os === "macos";
    showOnly(loginView);
    loginView.classList.toggle("is-pairing", Boolean(pairingCode));
    renderInitialPairingActionAvailability();
    loginCancelPairingButton.classList.toggle(
      "is-hidden",
      pairingStage === "idle",
    );
    loginCancelPairingButton.disabled = pairingStage === "finishing";
    loginTitle.textContent = usesMacDesktopLogin
      ? t("signInRelayune")
      : pairingCode
        ? t("loginCodeTitle")
        : t("connectDevice");
    loginCopy.textContent = usesMacDesktopLogin
      ? t("desktopLoginIntro")
      : pairingCode
        ? t("loginCodeHelp")
        : t("loginIntro");
    pairingCodeElement.textContent = pairingCode;
    loginPairingOptions.classList.toggle(
      "is-hidden",
      usesMacDesktopLogin || !pairingCode,
    );
    const pairingHandoffEnabled = browserPairingHandoffActionsEnabled(
      pairingStage,
      Boolean(activePairingId),
    );
    loginOpenPairingPageButton.disabled = !pairingHandoffEnabled;
    loginCopyPairingLinkButton.disabled = !pairingHandoffEnabled;
    loginCopyPairingLinkButton.textContent = t(
      pairingLinkCopyInFlight ? "copyingLink" : "copyLink",
    );
    const initialPairingButtonKey: TranslationKey = usesMacDesktopLogin
      ? pairingStage === "starting"
        ? "openingDesktopLogin"
        : pairingStage === "finishing"
          ? "finishingDesktopLogin"
          : pairingStage === "waiting" || pairingStage === "recovering"
            ? "waitingDesktopLogin"
            : "signInRelayune"
      : pairingStage === "starting"
        ? "creatingSecureConnection"
        : pairingStage === "recovering"
          ? "waitingConnection"
          : pairingStage === "finishing"
            ? "pairingFinishing"
            : pairingStage === "waiting"
              ? "waitingBrowser"
              : "openBrowser";
    loginButton.textContent = t(initialPairingButtonKey);
    const initialPairingStatusKey: TranslationKey = usesMacDesktopLogin
      ? pairingStage === "starting"
        ? "openingDesktopLogin"
        : pairingStage === "finishing"
          ? "finishingDesktopLogin"
          : pairingStage === "waiting" || pairingStage === "recovering"
            ? "waitingDesktopLogin"
            : "desktopLoginNote"
      : pairingStage === "starting"
        ? "creatingSecureConnection"
        : pairingStage === "recovering"
          ? pairingCode
            ? "pairingReconnecting"
            : "pairingStartReconnecting"
          : pairingStage === "finishing"
            ? "waitingConfirmation"
            : pairingStage === "waiting"
              ? "pairingPrivacy"
              : "loginNote";
    const initialPairingError =
      pairingStage === "idle" ? initialPairingErrorPresentation : null;
    loginNote.textContent = initialPairingError
      ? toastPresentationText(initialPairingError)
      : t(initialPairingStatusKey);
    loginNote.dataset.tone = initialPairingError ? "error" : "status";
    loginNote.setAttribute("role", initialPairingError ? "alert" : "status");
    loginNote.setAttribute(
      "aria-live",
      initialPairingError ? "assertive" : "polite",
    );
    renderReplacementPairing();
    renderPairingQrCodes();
    updatePairingExpiry();
    refreshUpdateActionAvailability();
    if (!options.preserveSettingsDraft) fillSettings(value);
    return;
  }
  showOnly(homeView);
  renderAccount(value);
  prepareTaskFiles.classList.toggle("is-hidden", value.platform.os !== "macos");
  if (
    value.platform.os === "macos" &&
    value.secrets.device_token &&
    !value.secrets.e2ee_key &&
    value.config.browser_ids.length === 0
  ) {
    renderRelayWaitingForClient(value.relay);
  } else {
    renderRelay(value.relay);
  }
  renderPreferences(value.config);
  renderReplacementPairing();
  renderPairingQrCodes();
  updatePairingExpiry();
  renderBrowserAuthorizations();
  refreshUpdateActionAvailability();
  if (!options.preserveSettingsDraft) fillSettings(value);
}

function renderAccount(value: Bootstrap) {
  const isMacAccount = value.platform.os === "macos";
  accountCard.classList.toggle("is-hidden", !isMacAccount);
  accountEmail.textContent = value.config.account_email?.trim() || t("accountEmailUnavailable");
  accountEmail.title = value.config.account_email?.trim() || "";
  if (minimalInstalled) {
    const email = element("minimal-account-email");
    email.textContent = accountEmail.textContent;
    email.title = accountEmail.title;
    element<HTMLButtonElement>("minimal-account").disabled = openSettingsButton.disabled;
  }
  renderWarmSummary();
}

function renderProductVersion() {
  appVersion.textContent = `v${bootstrap?.version ?? "…"}`;
}

function renderReplacementPairing() {
  const cancellationInFlight = browserPairingCancellations.active;
  const busy =
    browserAuthorizationActionsDisabled(pairingStage) ||
    cancellationInFlight ||
    configSaveInFlight ||
    languageSwitchInFlight ||
    relayStartInFlight ||
    workspacePickerInFlight ||
    agentActionProvider !== null ||
    nativeLanguageReconciliationPromise !== null ||
    installingUpdate;
  const active =
    pairingSurface === "browser" && pairingStage !== "idle";
  const copy = browserPairingCopy(pairingStage, Boolean(pairingCode), locale);
  pairingPanel.classList.toggle("is-hidden", !active);
  newPairingButton.disabled = busy;
  newPairingButton.textContent = cancellationInFlight
    ? t("cancellingBrowserPairing")
    : minimalInstalled && pairingStage === "idle" ? t("minimalConnect") : copy.button;
  replacementPairingCode.textContent = pairingCode;
  replacementPairingOptions.classList.toggle("is-hidden", !pairingCode);
  pairingPanelStatus.textContent = copy.status;
  pairingStageElement.textContent = copy.step;
  cancelPairingButton.disabled = pairingStage === "finishing";
  cancelPairingButton.textContent =
    pairingStage === "finishing" ? t("pairingFinishing") : t("cancel");
  const pairingHandoffEnabled = browserPairingHandoffActionsEnabled(
    pairingStage,
    Boolean(activePairingId),
  );
  openPairingPageButton.disabled = !pairingHandoffEnabled;
  copyPairingLinkButton.disabled = !pairingHandoffEnabled;
  copyPairingLinkButton.textContent = t(
    pairingLinkCopyInFlight ? "copyingLink" : "copyLink",
  );
  renderMinimalPairing();
  openSettingsButton.disabled = busy;
  openSettingsButton.removeAttribute("aria-describedby");
  warmShell?.setBusy(busy);
  element<HTMLButtonElement>("choose-workspace").disabled = busy;
  logoutButton.disabled = busy;
  for (const button of browserList.querySelectorAll<HTMLButtonElement>(
    "[data-revoke-browser], [data-add-browser], [data-reload-browsers]",
  )) {
    button.disabled = busy;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-adapter], [data-provider], [data-agent-action]",
  )) {
    button.disabled = busy;
  }
}

let minimalBrowserListSignature = "";
function renderBrowserAuthorizations() {
  const cancellationInFlight = browserPairingCancellations.active;
  const actionsDisabled =
    browserAuthorizationActionsDisabled(pairingStage) ||
    cancellationInFlight ||
    configSaveInFlight ||
    languageSwitchInFlight ||
    relayStartInFlight ||
    workspacePickerInFlight ||
    agentActionProvider !== null ||
    nativeLanguageReconciliationPromise !== null ||
    installingUpdate;
  const expandedDevices = new Set(Array.from(browserList.querySelectorAll<HTMLDetailsElement>("details[open]")).map(node => node.dataset.browserId));
  browserList.toggleAttribute("aria-busy", browserListLoading);
  if (minimalInstalled) {
    const manage = element("minimal-manage");
    delete manage.dataset.i18n;
    manage.textContent = t("minimalManageDevices");
    const count = document.createElement("span"); count.className = "moonlight-device-count";
    count.textContent = browserListFailed ? t("loadingBrowserError") : browserAuthorizationCount(browserAuthorizations.length, browserListLoading, locale);
    manage.append(count);
    manage.setAttribute("aria-label", `${t("minimalManageDevices")} · ${count.textContent}`);
    element("device-page-total").textContent = browserListLoading ? t("loadingCount") : browserListFailed ? t("loadingBrowserError") : t("deviceTotal", { count: browserAuthorizations.length });
  }
  if (browserListLoading) {
    minimalBrowserListSignature = "";
    browserCount.textContent = browserAuthorizationCount(
      browserAuthorizations.length,
      true,
      locale,
    );
    newPairingButton.classList.remove("is-hidden");
    newPairingButton.disabled = true;
    browserList.replaceChildren(
      browserListState(
        t("loadingBrowsers"),
        t("aFewSeconds"),
        "loading",
      ),
    );
    return;
  }
  browserCount.textContent = browserAuthorizationCount(
    browserAuthorizations.length,
    false,
    locale,
  );
  if (browserListFailed) {
    minimalBrowserListSignature = "";
    newPairingButton.classList.remove("is-hidden");
    newPairingButton.disabled = actionsDisabled;
    browserList.replaceChildren(
      browserListState(
        t("loadingBrowserError"),
        t("loadingBrowserErrorHelp"),
        "error",
        t(cancellationInFlight ? "cancellingBrowserPairing" : "reload"),
        "reload-browsers",
        actionsDisabled,
      ),
    );
    return;
  }
  if (!browserAuthorizations.length) {
    minimalBrowserListSignature = "";
    newPairingButton.classList.add("is-hidden");
    browserList.replaceChildren(
      browserListState(
        t("noBrowsers"),
        t("noBrowsersHelp"),
        "empty",
        t(cancellationInFlight ? "cancellingBrowserPairing" : "addFirstBrowser"),
        "add-browser",
        actionsDisabled,
      ),
    );
    return;
  }
  newPairingButton.classList.remove("is-hidden");
  newPairingButton.disabled = actionsDisabled;
  const onlineIds = onlineBrowserIds(bootstrap?.relay);
  const signature = JSON.stringify([locale, browserAuthorizations, onlineIds, Math.floor(Date.now() / 60_000)]);
  if (minimalInstalled && signature === minimalBrowserListSignature) {
    for (const button of browserList.querySelectorAll<HTMLButtonElement>("[data-revoke-browser]")) button.disabled = actionsDisabled;
    return;
  }
  minimalBrowserListSignature = signature;
  const focused = document.activeElement as HTMLElement | null;
  const focusedDevice = focused?.closest<HTMLDetailsElement>("details[data-browser-id]")?.dataset.browserId;
  const focusedRevoke = focused?.hasAttribute("data-revoke-browser");
  const rows = browserAuthorizations.map((authorization) => {
      const row = document.createElement("div");
      row.className = "browser-row";
      const icon = document.createElement("span");
      icon.className = "browser-icon";
      icon.textContent = "◎";
      const copy = document.createElement("div");
      copy.className = "browser-copy";
      const name = document.createElement("strong");
      name.textContent = authorization.name;
      const detail = document.createElement("p");
      detail.textContent = formatBrowserAuthorizationDetail(
        authorization.created_at,
        authorization.last_seen_at,
        locale,
      );
      const version = document.createElement("p");
      version.className = "browser-version";
      version.textContent = authorization.client_version
        ? t("clientVersion", { version: authorization.client_version })
        : t("clientVersionUnknown");
      copy.append(name, version, detail);
      const revoke = document.createElement("button");
      revoke.className = "browser-revoke";
      revoke.type = "button";
      revoke.dataset.revokeBrowser = authorization.id;
      revoke.textContent = t("revokeAccess");
      revoke.setAttribute(
        "aria-label",
        browserRevokeActionLabel(authorization.name, locale),
      );
      revoke.disabled = actionsDisabled;
      if (minimalInstalled) {
        const disclosure = document.createElement("details");
        disclosure.className = "browser-device-details";
        disclosure.dataset.browserId = authorization.id;
        disclosure.open = expandedDevices.has(authorization.id);
        const identity = deviceIdentity(authorization.name);
        const isOnline = onlineIds.includes(authorization.id);
        row.dataset.online = String(isOnline);
        name.textContent = identity.title;
        const summary = document.createElement("summary");
        summary.title = authorization.name;
        icon.innerHTML = deviceIcon(identity.kind);
        icon.setAttribute("aria-hidden", "true");
        const heading = document.createElement("span");
        heading.className = "device-card-heading";
        heading.append(name);
        const label = document.createElement("span");
        label.className = "device-card-label";
        label.append(heading);
        const platform = document.createElement("span");
        platform.className = "device-platform";
        platform.textContent = identity.subtitle;
        const metadata = document.createElement("span");
        metadata.className = "device-card-metadata";
        if (identity.subtitle) metadata.append(platform);
        label.append(metadata);
        summary.append(icon, label);
        if (onlineIds.includes(authorization.id)) {
          const online = document.createElement("span");
          online.className = "browser-online";
          online.textContent = t("deviceOnline");
          heading.append(online);
        }
        const recent = document.createElement("span");
        recent.className = "device-recent";
        const relative = deviceRelativeTime(authorization.last_seen_at, locale);
        recent.textContent = relative ? t("lastUsed", { time: relative }) : t("authorizedAt", { time: new Date(authorization.created_at).toLocaleDateString(locale) });
        if (!isOnline) metadata.append(recent);
        const chevron = document.createElement("span");
        chevron.className = "device-chevron";
        chevron.setAttribute("aria-hidden", "true");
        chevron.textContent = "›";
        summary.append(chevron);
        summary.addEventListener("click", event => {
          if (pairingSurface !== "browser" || pairingStage !== "waiting") return;
          // Switching to an existing device ends the unused new-device invitation.
          event.preventDefault();
          cancelPairing();
          navigateMinimal("devices", false);
          const refreshed = [...browserList.querySelectorAll<HTMLDetailsElement>("details[data-browser-id]")]
            .find(element => element.dataset.browserId === authorization.id);
          if (refreshed) { refreshed.open = true; refreshed.querySelector("summary")?.focus(); }
        });
        const expanded = document.createElement("div");
        expanded.className = "device-card-expanded";
        const fullName = document.createElement("p");
        fullName.className = "device-full-name";
        fullName.textContent = authorization.name;
        expanded.append(fullName, version, detail, revoke);
        disclosure.append(summary, expanded);
        row.append(disclosure);
      } else row.append(icon, copy, revoke);
      return row;
    });
  if (minimalInstalled) {
    const groups: HTMLElement[] = [];
    for (const online of [true, false]) {
      const members = rows.filter(row => row.dataset.online === String(online));
      if (!members.length) continue;
      const group = document.createElement("section");
      group.className = "device-group";
      group.dataset.online = String(online);
      const heading = document.createElement("h3");
      heading.className = "device-group-title";
      heading.append(document.createTextNode(t(online ? "deviceOnlineGroup" : "deviceOtherGroup")));
      const count = document.createElement("span");
      count.textContent = String(members.length);
      heading.append(count);
      group.append(heading, ...members);
      groups.push(group);
    }
    browserList.replaceChildren(...groups);
    if (focusedDevice) {
      const restored = [...browserList.querySelectorAll<HTMLDetailsElement>("details[data-browser-id]")].find(node => node.dataset.browserId === focusedDevice);
      restored?.querySelector<HTMLElement>(focusedRevoke ? "[data-revoke-browser]" : "summary")?.focus({ preventScroll: true });
    }
  } else browserList.replaceChildren(...rows);
}

function browserListState(
  title: string,
  detail: string,
  tone: "loading" | "empty" | "error",
  actionLabel?: string,
  action?: "add-browser" | "reload-browsers",
  actionDisabled = false,
) {
  const state = document.createElement("div");
  state.className = `browser-list-state browser-list-state-${tone}`;
  state.setAttribute("role", tone === "error" ? "alert" : "status");
  const icon = document.createElement("span");
  icon.className = tone === "loading" ? "browser-state-spinner" : "browser-state-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = tone === "empty" ? "+" : tone === "error" ? "!" : "";
  const copy = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = detail;
  copy.append(heading, paragraph);
  state.append(icon, copy);
  if (actionLabel && action) {
    const button = document.createElement("button");
    button.className = action === "add-browser" ? "primary browser-state-action" : "secondary browser-state-action";
    button.type = "button";
    button.dataset[action === "add-browser" ? "addBrowser" : "reloadBrowsers"] = "";
    button.textContent = actionLabel;
    button.disabled = actionDisabled;
    state.append(button);
  }
  return state;
}

function agentName(provider: RelayProvider) {
  if (provider === "mcode") return "MiniMax Code · Beta";
  if (provider === "zcode") return "ZCode (community CLI)";
  if (provider === "opencode") return "OpenCode";
  return provider === "codex"
    ? "Codex"
    : provider === "kimi"
      ? "Kimi Code"
      : "Claude Code";
}

function agentStatusText(value: AgentRuntimeAvailability) {
  switch (value.status) {
    case "ready":
      return t("agentReady", { version: value.version ?? "—" });
    case "not_installed":
      return t("agentNotInstalled");
    case "not_logged_in":
      return t("agentNotLoggedIn", { version: value.version ?? "—" });
    case "outdated":
      return t("agentOutdated", {
        version: value.version ?? "—",
        minimum: value.minimum_version,
      });
    case "broken":
      return t("agentBroken");
  }
}

function agentActionLabel(value: AgentRuntimeAvailability) {
  if (agentActionProvider === value.provider) {
    return t(agentActionKind === "login" ? "openingAgentLogin" : "installingAgent");
  }
  switch (value.status) {
    case "not_installed":
      return t("installAgent");
    case "outdated":
      return t("updateAgent");
    case "broken":
      return t("reinstallAgent");
    case "not_logged_in":
      return t("loginAgent");
    case "ready":
      return "";
  }
}

function agentActionsDisabled() {
  return (
    pairingStage !== "idle" ||
    browserPairingCancellations.active ||
    configSaveInFlight ||
    settingsSaveInFlight ||
    languageSwitchInFlight ||
    logoutInFlight ||
    browserRevokeInFlight ||
    browserRevokeInFlight ||
    relayStartInFlight ||
    workspacePickerInFlight ||
    nativeLanguageReconciliationPromise !== null ||
    installingUpdate ||
    agentAvailabilityLoading ||
    agentActionProvider !== null
  );
}

function renderAgentAvailability() {
  renderMinimalHomeState();
  agentReadiness.toggleAttribute("aria-busy", agentAvailabilityLoading);
  if (
    !agentAvailability.length &&
    (agentAvailabilityLoading || !agentAvailabilityFailed)
  ) {
    const state = document.createElement("div");
    state.className = "agent-readiness-state";
    state.setAttribute("role", "status");
    const spinner = document.createElement("span");
    spinner.className = "agent-readiness-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const copy = document.createElement("p");
    copy.textContent = t("agentChecking");
    state.append(spinner, copy);
    agentReadiness.replaceChildren(state);
    return;
  }
  if (agentAvailabilityFailed && !agentAvailability.length) {
    const state = document.createElement("div");
    state.className = "agent-readiness-state agent-readiness-state-error";
    state.setAttribute("role", "alert");
    const icon = document.createElement("span");
    icon.className = "agent-runtime-icon";
    icon.textContent = "!";
    const copy = document.createElement("p");
    copy.textContent = t("agentCheckFailed");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "secondary agent-runtime-action";
    retry.dataset.agentAction = "retry";
    retry.textContent = t("retryAgentCheck");
    retry.disabled = agentActionProvider !== null || installingUpdate;
    state.append(icon, copy, retry);
    agentReadiness.replaceChildren(state);
    return;
  }

  const order: RelayProvider[] = ["codex", "claude", "kimi", "opencode", "zcode", "mcode"];
  const byProvider = new Map(
    agentAvailability.map((value) => [value.provider, value]),
  );
  const rows: HTMLElement[] = order.flatMap((provider) => {
    const value = byProvider.get(provider);
    if (!value) return [];
    const row = document.createElement("div");
    row.className = "agent-runtime-row";
    row.dataset.agentProvider = provider;
    row.dataset.status = value.status;
    row.tabIndex = -1;
    row.dataset.tone = agentRuntimeTone(value.status);
    const icon = document.createElement("span");
    icon.className = "agent-runtime-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = minimalInstalled ? agentBrandMark(provider) : value.status === "ready" ? "✓" : "!";
    if (minimalInstalled) icon.classList.add("moonlight-agent-icon");
    const copy = document.createElement("div");
    copy.className = "agent-runtime-copy";
    const name = document.createElement("strong");
    name.textContent = minimalInstalled && provider === "zcode" ? "Z Code" : agentName(provider);
    const detail = document.createElement("p");
    detail.textContent = minimalInstalled && value.status === "ready" ? `v${value.version ?? "—"}` : agentStatusText(value);
    copy.append(name, detail);
    row.append(icon, copy);
    if (minimalInstalled && value.status === "ready") {
      const status = document.createElement("span");
      status.className = "moonlight-agent-status";
      status.textContent = t("warmLoggedIn");
      row.append(status);
    }
    const label = agentActionLabel(value);
    if (label) {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "secondary agent-runtime-action";
      action.dataset.agentAction = agentRuntimeAction(value.status) ?? undefined;
      action.dataset.provider = provider;
      action.textContent = label;
      action.disabled = agentActionsDisabled();
      action.toggleAttribute("aria-busy", agentActionProvider === provider);
      row.append(action);
    }
    return [row];
  });

  if (agentAvailabilityFailed) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "agent-readiness-retry";
    retry.dataset.agentAction = "retry";
    retry.textContent = t("retryAgentCheck");
    retry.disabled = agentActionsDisabled();
    rows.push(retry);
  }
  agentReadiness.replaceChildren(...rows);
}

async function loadAgentAvailability() {
  if (
    !bootstrap ||
    !signedIn(bootstrap) ||
    agentAvailabilityLoading ||
    agentActionProvider !== null
  ) return;
  const generation = agentAvailabilityGeneration + 1;
  agentAvailabilityGeneration = generation;
  agentAvailabilityLoading = true;
  agentAvailabilityFailed = false;
  renderAgentAvailability();
  try {
    const next = await relayApi.agentAvailability();
    if (generation !== agentAvailabilityGeneration) return;
    agentAvailability = next;
  } catch {
    if (generation !== agentAvailabilityGeneration) return;
    agentAvailabilityFailed = true;
  } finally {
    if (generation !== agentAvailabilityGeneration) return;
    agentAvailabilityLoading = false;
    renderAgentAvailability();
  }
}

function setAgentAction(
  provider: RelayProvider | null,
  kind: "install" | "login" | null,
) {
  agentActionProvider = provider;
  agentActionKind = kind;
  renderConfigActionAvailability();
  refreshUpdateActionAvailability();
}

async function installLocalAgent(provider: RelayProvider) {
  if (agentActionsDisabled()) return;
  setAgentAction(provider, "install");
  try {
    const next = await relayApi.installAgent(provider);
    agentAvailability = agentAvailability.map((value) =>
      value.provider === provider ? next : value
    );
    showTranslatedToast(
      next.status === "ready" ? "agentUpdated" : "agentInstalled",
      { agent: agentName(provider) },
    );
  } catch (error) {
    showDesktopErrorToast(error, "agent_install_failed");
  } finally {
    setAgentAction(null, null);
  }
}

async function openLocalAgentLogin(provider: RelayProvider) {
  if (agentActionsDisabled()) return;
  setAgentAction(provider, "login");
  try {
    await relayApi.openAgentLogin(provider);
    showTranslatedToast("agentLoginOpened", { agent: agentName(provider) });
  } catch (error) {
    showDesktopErrorToast(error, "agent_login_failed");
  } finally {
    setAgentAction(null, null);
  }
}

function invalidateBrowserAuthorizationLoads() {
  browserListLoadGeneration += 1;
  browserListLoading = false;
  browserListFailed = false;
}

async function loadBrowserAuthorizations() {
  const loadGeneration = browserListLoadGeneration + 1;
  browserListLoadGeneration = loadGeneration;
  const restoreUserFocus = browserListRestoreNextLoadFocus;
  browserListRestoreNextLoadFocus = false;
  if (!bootstrap || !signedIn(bootstrap)) {
    browserListLoading = false;
    browserListFailed = false;
    return;
  }
  browserListLoading = true;
  browserListFailed = false;
  renderBrowserAuthorizations();
  if (restoreUserFocus) moveFocus(browserList);
  try {
    const nextAuthorizations = await relayApi.listBrowserAuthorizations();
    if (loadGeneration !== browserListLoadGeneration) return;
    browserAuthorizations = nextAuthorizations;
  } catch {
    if (loadGeneration !== browserListLoadGeneration) return;
    browserListFailed = true;
  } finally {
    if (loadGeneration !== browserListLoadGeneration) return;
    browserListLoading = false;
    renderBrowserAuthorizations();
    if (restoreUserFocus) {
      const retry = browserList.querySelector<HTMLButtonElement>(
        "[data-reload-browsers]",
      );
      moveFocus(retry ?? browserList);
    }
  }
}

function reloadBrowserAuthorizationsWithFocus() {
  browserListRestoreNextLoadFocus = true;
  void loadBrowserAuthorizations();
}

function renderRelay(relay: RelaySnapshot) {
  element<HTMLElement>("file-access-warning").classList.toggle("is-hidden", !relay.file_access_limited);
  element<HTMLButtonElement>("open-file-access-settings").classList.toggle("is-hidden", bootstrap?.platform.os !== "macos");
  const labels: Record<RelaySnapshot["phase"], [string, string, string]> = {
    stopped: [t("stoppedLabel"), t("stoppedDetail"), "pending"],
    starting: [t("startingLabel"), t("startingDetail"), "pending"],
    connected: [t("connectedLabel"), t("connectedDetail"), "success"],
    stopping: [t("stoppingLabel"), t("stoppingDetail"), "pending"],
    error: [t("errorLabel"), t("errorDetail"), "danger"],
  };
  const [label, detail, tone] = labels[relay.phase];
  statusCard.dataset.tone = tone;
  statusLabel.textContent = label;
  statusDetail.textContent = detail;
  statusTime.textContent = relay.started_at
    ? formatTime(relay.started_at, locale)
    : "—";
  const hasError = relay.phase !== "connected" && Boolean(relay.last_error);
  const canRetry =
    relay.phase === "error" ||
    (relay.phase === "starting" && Boolean(relay.last_error));
  statusError.classList.toggle("is-hidden", !hasError);
  statusError.textContent = hasError
    ? nativeErrorMessage(relay.last_error!, "relay_start_failed")
    : "";
  renderRelayRetryAvailability(canRetry);
  diagnosticSummary.textContent = hasError
    ? nativeErrorMessage(relay.last_error!, "relay_start_failed")
    : relay.file_access_limited ? t("fileAccessWarningTitle") : t("diagnosticsHealthy");
  diagnosticLog.textContent = diagnosticLogText(relay);
  renderMinimalHomeState();
}

function renderRelayWaitingForClient(relay: RelaySnapshot) {
  element<HTMLElement>("file-access-warning").classList.toggle("is-hidden", !relay.file_access_limited);
  statusCard.dataset.tone = "pending";
  statusLabel.textContent = t("signedInNoClientsLabel");
  statusDetail.textContent = t("signedInNoClientsDetail");
  statusTime.textContent = "—";
  statusError.classList.add("is-hidden");
  statusError.textContent = "";
  renderRelayRetryAvailability(false);
  diagnosticSummary.textContent = relay.file_access_limited ? t("fileAccessWarningTitle") : t("diagnosticsHealthy");
  diagnosticLog.textContent = diagnosticLogText(relay);
  renderMinimalHomeState();
}

function diagnosticLogText(relay: RelaySnapshot) {
  return localizedDiagnosticLogText(locale, relay);
}

function nativeErrorMessage(
  error: unknown,
  fallback: DesktopErrorCode = "unknown",
) {
  return desktopErrorMessage(locale, desktopErrorCode(error, fallback));
}

function renderPreferences(config: RelayConfig) {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-adapter]")) {
    const active = button.dataset.adapter === config.adapter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-provider]")) {
    const active = button.dataset.provider === config.default_provider;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  providerRow.classList.toggle("is-hidden", minimalInstalled || config.adapter !== "multi");
  if (minimalInstalled) {
    element("choose-workspace").querySelector("strong")!.textContent = t("warmWorkspace");
    prepareTaskFiles.querySelector("strong")!.textContent = t("folderAccessEyebrow");
    prepareTaskFiles.querySelector("p")!.textContent = t("folderAccessReason");
  }
  workspacePath.textContent = shortPath(config.workspace, locale);
  workspacePath.title = config.workspace;
  renderAgentAvailability();
}

function fillSettings(value: Bootstrap) {
  settingsRuntime.classList.remove("is-hidden");
  element<HTMLInputElement>("launch-at-login").checked = value.launch_at_login;
}

function renderCommittedBootstrap(
  value: Bootstrap,
  options: { preserveSettingsDraft?: boolean } = {},
) {
  // Native config / credential commands invalidate older bootstrap reads in
  // AppState, but an already-running IPC request can still return its stale
  // value to this WebView. Retire every older UI refresh before adopting the
  // command's authoritative Bootstrap so it cannot repaint the previous
  // login, authorization, or settings state after this render.
  bootstrapRefreshGate.invalidate();
  render(value, options);
  if (signedIn(value)) void loadAgentAvailability();
}

async function saveConfig(config: RelayConfig, announce = true): Promise<boolean> {
  if (
    !bootstrap ||
    configSaveInFlight ||
    languageSwitchInFlight ||
    relayStartInFlight ||
    workspacePickerInFlight ||
    nativeLanguageReconciliationPromise ||
    browserPairingCancellations.active ||
    installingUpdate
  ) return false;
  setConfigSaveBusy(true);
  saveFeedback.set("saving");
  try {
    const next = await relayApi.saveSettings({ config });
    renderCommittedBootstrap(next);
    saveFeedback.set(announce ? "saved" : null, announce ? 1_600 : undefined);
    return true;
  } catch (error) {
    saveFeedback.set(null);
    // A failed restart can itself encounter a failed durable rollback. Ask
    // native bootstrap for the actual committed config before leaving the
    // dialog open, so the window never claims values that the next launch
    // would immediately replace.
    await refresh().catch(() => {
      // Keep the current editable draft when native state is also unavailable.
    });
    showDesktopErrorToast(error, "settings_save_failed");
    return false;
  } finally {
    setConfigSaveBusy(false);
  }
}

async function refresh(): Promise<boolean> {
  const refreshRunId = bootstrapRefreshGate.begin();
  const switchRevisionAtStart = languageSwitchRevision;
  const switchWasIdleAtStart = !languageSwitchInFlight;
  const relayEventRevisionAtStart = relayEventRevision;
  const shouldFocusPrimaryAction = bootstrap === null;
  const wasSignedIn = Boolean(bootstrap && signedIn(bootstrap));
  let next: Bootstrap;
  try {
    next = await relayApi.bootstrap();
  } catch (error) {
    if (!bootstrapRefreshGate.isCurrent(refreshRunId)) return false;
    throw error;
  }
  if (!bootstrapRefreshGate.isCurrent(refreshRunId)) return false;
  if (wasSignedIn && !signedIn(next)) {
    invalidateBrowserAuthorizationLoads();
    browserAuthorizations = [];

  }
  const refreshedLocale = bootstrapLocaleAfterRefresh(
    next.config.ui_language,
    locale,
    {
      switchRevisionAtStart,
      currentSwitchRevision: languageSwitchRevision,
      switchWasIdleAtStart,
      switchInFlight: languageSwitchInFlight,
    },
  );
  const languageSwitchOverlapped =
    !switchWasIdleAtStart ||
    languageSwitchInFlight ||
    switchRevisionAtStart !== languageSwitchRevision;
  if (refreshedLocale !== locale) {
    locale = refreshedLocale;
    applyStaticTranslations();
    saveFeedback.retranslate();
    persistAppLocale(refreshedLocale);
  }
  if (next.config.ui_language !== refreshedLocale) {
    next = {
      ...next,
      config: { ...next.config, ui_language: refreshedLocale },
    };
  }
  const newestRelay = relaySnapshotAfterBootstrap(
    next.relay,
    latestRelayEvent,
    relayEventRevisionAtStart,
    relayEventRevision,
  );
  if (newestRelay !== next.relay) {
    next = { ...next, relay: newestRelay };
  }
  render(next);
  if (shouldFocusPrimaryAction) {
    moveFocus(signedIn(next) ? statusCard : loginButton);
  }
  if (!languageSwitchOverlapped) {
    nativeLanguageReconciliationNeeded = true;
    void requestNativeLanguageReconciliation();
  }
  return true;
}

async function resumeRelayAfterStartupRecovery() {
  if (!bootstrap || !signedIn(bootstrap) || bootstrap.relay.phase !== "stopped") {
    return;
  }
  try {
    const relay = await relayApi.start();
    bootstrap = { ...bootstrap, relay };
    renderRelay(relay);
  } catch (error) {
    const relay = await relayApi.snapshot().catch(() => null);
    if (relay && bootstrap) {
      bootstrap = { ...bootstrap, relay };
      renderRelay(relay);
    }
    showDesktopErrorToast(error, "relay_start_failed");
  }
}

function hideUpdateCard() {
  updateCard.classList.add("is-hidden");
  updateCard.removeAttribute("aria-busy");
  installUpdateButton.removeAttribute("aria-busy");
  installUpdateButton.removeAttribute("aria-disabled");
  updateLaterButton.removeAttribute("aria-busy");
  updateLaterButton.removeAttribute("aria-disabled");
  updateProgress.classList.add("is-hidden");
  setUpdateProgress(null);
  updatePresentation = "available";
}

function setUpdateProgress(percent: number | null) {
  if (percent === null) {
    updateProgressBar.style.width = "0%";
    updateProgress.removeAttribute("aria-valuenow");
    return;
  }
  const bounded = Math.max(0, Math.min(100, Math.round(percent)));
  updateProgressBar.style.width = `${bounded}%`;
  updateProgress.setAttribute("aria-valuenow", String(bounded));
}

function renderPendingUpdate() {
  if (!pendingUpdate) return;
  const installBlocked = updateInstallIsBlocked() || dismissingUpdate;
  // Keep the pressed install action focused throughout download, verification
  // and relaunch. The synchronous installingUpdate guard rejects repeats;
  // native `disabled` here would strand keyboard and screen-reader users on
  // the document body during the longest update phase.
  installUpdateButton.disabled = installBlocked && !installingUpdate;
  installUpdateButton.toggleAttribute("aria-disabled", installBlocked);
  updateLaterButton.disabled = installingUpdate;
  updateCard.toggleAttribute("aria-busy", installingUpdate || dismissingUpdate);
  installUpdateButton.toggleAttribute("aria-busy", installingUpdate);
  updateLaterButton.toggleAttribute("aria-busy", dismissingUpdate);
  updateLaterButton.toggleAttribute("aria-disabled", dismissingUpdate);
  updateTitle.textContent = t("updateVersion", { version: pendingUpdate.version });
  if (!installingUpdate && installBlocked) {
    updateDetail.textContent = t("updateBusyDetail");
    installUpdateButton.textContent = t("updateRestart");
  } else if (updatePresentation === "available") {
    updateDetail.textContent =
      localizedUpdateNotes(locale, pendingUpdate.body) || t("updateDefaultDetail");
    installUpdateButton.textContent = t("updateRestart");
  } else if (updatePresentation === "downloading") {
    updateDetail.textContent = t("verifyingUpdate");
    installUpdateButton.textContent = t("downloadingUpdate");
  } else if (updatePresentation === "installing") {
    updateDetail.textContent = t("installingUpdate");
    installUpdateButton.textContent = t("downloadingUpdate");
  } else if (updatePresentation === "restarting") {
    updateDetail.textContent = t("installingUpdate");
    installUpdateButton.textContent = t("restarting");
  } else {
    updateDetail.textContent = t("updateFailed");
    installUpdateButton.textContent = t("retryUpdate");
  }
}

function focusPendingUpdate() {
  if (!pendingUpdate) return;
  if (minimalInstalled && settingsDialog.open) settingsDialog.close();
  updateCard.scrollIntoView({ block: "nearest" });
  moveFocus(installUpdateButton.disabled ? updateLaterButton : installUpdateButton);
}

async function checkForUpdates(manual = false) {
  if (manual) manualUpdateCheckRequested = true;
  if (installingUpdate || pendingUpdate) {
    if (manual) focusPendingUpdate();
    manualUpdateCheckRequested = false;
    return;
  }
  if (checkingForUpdate) {
    if (manual) showTranslatedToast("checkingUpdates");
    return;
  }
  if (!bootstrap) {
    if (manualUpdateCheckRequested) showTranslatedToast("notReady");
    manualUpdateCheckRequested = false;
    return;
  }
  if (!manual && !manualUpdateCheckRequested && !isOfficialInstance(bootstrap.config.server_url)) return;
  if (bootstrap.platform.os === "windows") {
    requestNativeUpdateAvailability(false);
    if (manualUpdateCheckRequested) {
      showTranslatedToast("windowsUpdateFromWebsite");
    }
    manualUpdateCheckRequested = false;
    return;
  }
  // Automatic startup, foreground and timer checks share one persisted
  // admission gate. Manual menu checks bypass the interval, but still advance
  // it so a subsequent focus event cannot immediately duplicate the request.
  if (!updateCheckThrottle.claim(manualUpdateCheckRequested)) {
    manualUpdateCheckRequested = false;
    return;
  }
  checkingForUpdate = true;
  if (manualUpdateCheckRequested) showTranslatedToast("checkingUpdates");
  const checkedService = bootstrap.config.server_url;
  try {
    const update = await check({
      target: bootstrap.platform.update_target,
      timeout: 15_000,
    });
    if (bootstrap?.config.server_url !== checkedService) {
      await update?.close();
      return;
    }
    if (!update) {
      requestNativeUpdateAvailability(false);
      if (manualUpdateCheckRequested) showTranslatedToast("upToDate");
      return;
    }
    if (update.version === dismissedUpdateVersion && !manualUpdateCheckRequested) {
      await update.close();
      requestNativeUpdateAvailability(false);
      return;
    }
    pendingUpdate = update;
    requestNativeUpdateAvailability(true);
    updatePresentation = "available";
    renderPendingUpdate();
    updateCard.classList.remove("is-hidden");
    if (manualUpdateCheckRequested) focusPendingUpdate();
  } catch {
    // Update checks must never block pairing or an already-running Relay.
    if (manualUpdateCheckRequested) showTranslatedToast("updateCheckFailed");
  } finally {
    checkingForUpdate = false;
    manualUpdateCheckRequested = false;
  }
}

async function installPendingUpdate() {
  if (!pendingUpdate || updateInstallIsBlocked()) return;
  installingUpdate = true;
  languagePicker.setAttribute("aria-disabled", "true");
  if (bootstrap) render(bootstrap, { preserveSettingsDraft: settingsDialog.open });
  updateProgress.classList.remove("is-hidden");
  setUpdateProgress(null);
  updatePresentation = "downloading";
  renderPendingUpdate();
  let downloaded = 0;
  let contentLength = 0;
  try {
    await pendingUpdate.downloadAndInstall((event) => {
      if (event.event === "Started") {
        contentLength = event.data.contentLength ?? 0;
        setUpdateProgress(contentLength > 0 ? 0 : null);
        updatePresentation = "downloading";
        renderPendingUpdate();
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        if (contentLength > 0) {
          setUpdateProgress((downloaded / contentLength) * 100);
        }
      } else if (event.event === "Finished") {
        setUpdateProgress(100);
        updatePresentation = "installing";
        renderPendingUpdate();
      }
    });
    updatePresentation = "restarting";
    renderPendingUpdate();
    await relaunch();
  } catch {
    installingUpdate = false;
    if (!languageSwitchInFlight && !configSaveInFlight) {
      languagePicker.removeAttribute("aria-disabled");
    }
    updatePresentation = "failed";
    if (bootstrap) {
      render(bootstrap, { preserveSettingsDraft: settingsDialog.open });
    } else {
      renderPendingUpdate();
    }
    updateProgress.classList.add("is-hidden");
    setUpdateProgress(null);
    showTranslatedToast("updateFailed");
    moveFocus(installUpdateButton);
    void requestNativeLanguageReconciliation();
  }
}

async function dismissPendingUpdate() {
  if (!pendingUpdate || installingUpdate || dismissingUpdate) return;
  const update = pendingUpdate;
  dismissingUpdate = true;
  renderPendingUpdate();
  let dismissed = false;
  try {
    await update.close();
    if (pendingUpdate !== update) return;
    dismissedUpdateVersion = update.version;
    pendingUpdate = null;
    requestNativeUpdateAvailability(false);
    hideUpdateCard();
    dismissed = true;
    moveFocus(bootstrap && signedIn(bootstrap) ? statusCard : loginButton);
  } catch {
    showTranslatedToast("updateFailed");
  } finally {
    dismissingUpdate = false;
    if (!dismissed && pendingUpdate) {
      renderPendingUpdate();
      moveFocus(updateLaterButton);
    }
  }
}

function renderActiveToast() {
  if (!activeToast) return;
  toast.textContent = toastPresentationText(activeToast);
}

function toastPresentationText(presentation: ToastPresentation) {
  return presentation.kind === "translation"
    ? t(presentation.key, presentation.params)
    : desktopErrorMessage(locale, presentation.code);
}

function showToast(presentation: ToastPresentation) {
  window.clearTimeout(toastTimer);
  activeToast = presentation.kind === "translation"
    ? {
        ...presentation,
        params: presentation.params ? { ...presentation.params } : undefined,
      }
    : presentation;
  renderActiveToast();
  toast.classList.remove("is-hidden");
  toastTimer = window.setTimeout(() => {
    activeToast = null;
    toast.textContent = "";
    toast.classList.add("is-hidden");
  }, 4200);
}

function showTranslatedToast(
  key: TranslationKey,
  params?: Record<string, string | number>,
) {
  showToast({ kind: "translation", key, params });
}

function showDesktopErrorCodeToast(code: DesktopErrorCode) {
  showToast({ kind: "desktop-error", code });
}

function showDesktopErrorToast(
  error: unknown,
  fallback: DesktopErrorCode,
) {
  showDesktopErrorCodeToast(desktopErrorCode(error, fallback));
}

function pairingErrorPresentation(error: unknown): ToastPresentation {
  if (error instanceof DesktopCommandError) {
    return {
      kind: "desktop-error",
      code: desktopErrorCode(error, "pairing_failed"),
    };
  }
  if (error instanceof PairingFlowError) {
    return { kind: "translation", key: error.translationKey };
  }
  // PAKE and WebView internals are not user-facing copy and may contain
  // implementation details. Keep unexpected failures stable and localized.
  return { kind: "translation", key: "secureConnectionFailed" };
}

function showPairingErrorToast(error: unknown) {
  showToast(pairingErrorPresentation(error));
}

class PairingFlowError extends Error {
  constructor(readonly translationKey: TranslationKey) {
    super(translationKey);
    this.name = "PairingFlowError";
  }
}

class PairingRequestError extends PairingFlowError {
  constructor(
    translationKey: TranslationKey,
    readonly retryable: boolean,
    readonly code = "",
  ) {
    super(translationKey);
    this.name = "PairingRequestError";
  }
}

function pairingServerErrorCode(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

async function pairingRequest<T>(
  path: string,
  init: RequestInit = {},
  instanceOrigin?: string,
): Promise<T> {
  if (!bootstrap) throw new PairingFlowError("notReady");
  const timeout = new AbortController();
  const timeoutId = window.setTimeout(() => timeout.abort(), 15_000);
  const combinedSignal = init.signal
    ? combineAbortSignals([init.signal, timeout.signal])
    : null;
  const signal = combinedSignal?.signal ?? timeout.signal;
  let response: Response;
  let body: T | null;
  try {
    response = await fetch(
      `${(instanceOrigin ?? bootstrap.config.server_url).replace(/\/+$/, "")}${path}`,
      {
        ...init,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal,
        headers: {
          "Content-Type": "application/json",
          ...init.headers,
        },
      },
    );
    body = (await response.json().catch((error) => {
      // Keep the same deadline active until the entire response is consumed.
      // A server that sends headers and then stalls its body must not freeze
      // first login forever or be mistaken for a successful null response.
      if (timeout.signal.aborted || init.signal?.aborted) throw error;
      return null;
    })) as T | null;
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new PairingRequestError(
      timeout.signal.aborted
        ? "requestTimeout"
        : "requestFailed",
      true,
      timeout.signal.aborted ? "request_timeout" : "network_failed",
    );
  } finally {
    window.clearTimeout(timeoutId);
    combinedSignal?.dispose();
  }
  if (!response.ok) {
    const errorCode = pairingServerErrorCode(body);
    throw new PairingRequestError(
      errorCode === "pairing_expired"
        ? "pairingExpired"
        : errorCode === "pairing_already_used"
          ? "pairingUsed"
          : "secureConnectionFailed",
      response.status === 429 || response.status >= 500,
      errorCode,
    );
  }
  return body as T;
}

class PairingCancelledError extends PairingFlowError {}

function ensurePairingRun(runId: number) {
  if (runId !== pairingRunId) {
    throw new PairingCancelledError("pairingCancelled");
  }
}

async function waitForPairingNetwork(runId: number, signal: AbortSignal) {
  pairingStage = "recovering";
  if (bootstrap) render(bootstrap);
  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      window.clearTimeout(delayId);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const delayId = window.setTimeout(finish, 1_000);
    signal.addEventListener("abort", finish, { once: true });
  });
  ensurePairingRun(runId);
}

async function startInitialPairing(
  input: {
    pairing_id: string;
    protocol: typeof PAIRING_PROTOCOL;
    initiator_share: string;
  },
  runId: number,
  signal: AbortSignal,
) {
  const recoveryDeadline = Date.now() + 10 * 60_000;
  while (Date.now() < recoveryDeadline) {
    ensurePairingRun(runId);
    try {
      return await pairingRequest<{ expires_at?: unknown }>("/api/pairings/start", {
        method: "POST",
        body: JSON.stringify(input),
        signal,
      });
    } catch (error) {
      ensurePairingRun(runId);
      if (
        error instanceof PairingRequestError &&
        error.code === "pairing_exists"
      ) {
        try {
          const existing = await pairingRequest<PairingPublicState>(
            `/api/pairings/${encodeURIComponent(input.pairing_id)}`,
            { signal },
          );
          ensurePairingRun(runId);
          if (
            existing.protocol !== PAIRING_PROTOCOL ||
            existing.mode !== "initial" ||
            existing.initiator_share !== input.initiator_share ||
            existing.status === "paired"
          ) {
            throw new PairingFlowError("secureConnectionFailed");
          }
          return { expires_at: existing.expires_at };
        } catch (recoveryError) {
          if (
            !(recoveryError instanceof PairingRequestError) ||
            !recoveryError.retryable
          ) {
            throw recoveryError;
          }
        }
      } else if (
        !(error instanceof PairingRequestError) ||
        !error.retryable
      ) {
        throw error;
      }
      await waitForPairingNetwork(runId, signal);
    }
  }
  throw new PairingFlowError("secureConnectionFailed");
}

async function waitForBrowser(
  pairingId: string,
  runId: number,
  signal: AbortSignal,
): Promise<PairingPublicState> {
  const expiresAt = pairingExpiresAtMs || Date.now() + 10 * 60_000;
  while (Date.now() < expiresAt) {
    ensurePairingRun(runId);
    let state: PairingPublicState;
    try {
      state = await pairingRequest<PairingPublicState>(
        `/api/pairings/${encodeURIComponent(pairingId)}`,
        { signal },
      );
    } catch (error) {
      ensurePairingRun(runId);
      if (
        !(error instanceof PairingRequestError) ||
        !error.retryable
      ) {
        throw error;
      }
      await waitForPairingNetwork(runId, signal);
      continue;
    }
    ensurePairingRun(runId);
    if (pairingStage === "recovering") {
      pairingStage = "waiting";
      if (bootstrap) render(bootstrap);
    }
    if (state.status === "responded") return state;
    if (state.status === "paired") {
      throw new PairingFlowError("pairingUsed");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
  }
  throw new PairingFlowError("pairingExpired");
}

function resetPairingState() {
  pairingAbortController?.abort();
  pairingAbortController = null;
  window.clearInterval(pairingExpiryTimer);
  pairingExpiryTimer = 0;
  pairingSurface = null;
  pairingStage = "idle";
  pairingCode = "";
  activePairingId = "";
  pairingExpiresAtMs = 0;
  invalidatePairingQrCodes();
  updatePairingExpiry();
  void requestNativeLanguageReconciliation();
}

function cancelRemoteBrowserPairing(
  pairingId: string,
  reportFailure = false,
  finalAttempt = false,
): Promise<boolean> {
  const attempt = browserPairingCancellations.enqueue(
    pairingId,
    () => relayApi.cancelBrowserPairing(pairingId, pairingOrigins.get(pairingId) ?? bootstrap?.config.server_url ?? ""),
    finalAttempt,
  );
  void attempt.then((result) => {
    if (!result.ok && reportFailure) {
      showDesktopErrorToast(result.error, "browser_access_failed");
    }
  });
  return attempt.then((result) => result.ok);
}

function renderBrowserPairingCancellationAvailability() {
  if (bootstrap && signedIn(bootstrap)) renderConfigActionAvailability();
  refreshUpdateActionAvailability();
  if (!browserPairingCancellations.active) {
    void requestNativeLanguageReconciliation();
  }
}

function cancelPairing() {
  if (minimalPairingExpired) {
    minimalPairingExpired = false;
    renderMinimalPairing();
    return;
  }
  if (pairingStage === "idle" || pairingStage === "finishing") return;
  const wasBrowser = pairingSurface === "browser";
  const browserPairingId = wasBrowser ? activePairingId : "";
  pairingRunId += 1;
  if (browserPairingId) void cancelRemoteBrowserPairing(browserPairingId);
  resetPairingState();
  if (bootstrap) render(bootstrap);
  moveFocus(wasBrowser ? browserPairingEntryAction() : loginButton);
  if (wasBrowser) {
    showTranslatedToast("browserAddCancelled");
  } else {
    showTranslatedToast("connectionCancelled");
  }
}

function expireCurrentPairing() {
  if (
    !pairingCode ||
    (pairingStage !== "waiting" && pairingStage !== "recovering")
  ) {
    return;
  }
  const wasBrowser = pairingSurface === "browser";
  const browserPairingId = wasBrowser ? activePairingId : "";
  pairingRunId += 1;
  if (browserPairingId) void cancelRemoteBrowserPairing(browserPairingId);
  resetPairingState();
  if (!wasBrowser) {
    initialPairingErrorPresentation = {
      kind: "translation",
      key: "pairingExpired",
    };
  }
  if (minimalInstalled && wasBrowser) minimalPairingExpired = true;
  if (bootstrap) render(bootstrap);
  showTranslatedToast("pairingExpired");
  moveFocus(minimalInstalled && wasBrowser ? element("minimal-regenerate") : wasBrowser ? browserPairingEntryAction() : loginButton);
}

async function beginPairing(surface: PairingSurface) {
  if (
    !bootstrap ||
    updateInstallIsBlocked() ||
    browserPairingCancellations.active
  ) return;
  if (surface === "browser" && !signedIn(bootstrap)) return;
  if (surface === "initial") initialPairingErrorPresentation = null;

  const pairingServerUrl = bootstrap.config.server_url;
  const pairingDeviceId = bootstrap.config.device_id;
  minimalPairingExpired = false;
  const runId = pairingRunId + 1;
  pairingRunId = runId;
  const abortController = new AbortController();
  pairingAbortController = abortController;
  pairingSurface = surface;
  pairingStage = "starting";
  pairingCode = "";
  render(bootstrap);
  if (surface === "browser") {
    // The browser-list "Add" action is reconstructed as soon as the pairing
    // panel opens, while the persistent header action becomes unavailable.
    // Hand focus to the stable localized status before PAKE generation or the
    // network can yield, so keyboard and screen-reader users never land on the
    // document body during the potentially slow secure-connection setup.
    moveFocus(pairingPanelStatus);
  }
  let browserPairingIdToCancel = "";
  try {
    const pairing = await createPairingInitiator();
    if (surface === "browser") {
      browserPairingIdToCancel = pairing.pairingId;
      pairingOrigins.set(pairing.pairingId, pairingServerUrl);
      if (runId === pairingRunId) activePairingId = pairing.pairingId;
    }
    ensurePairingRun(runId);
    const startInput = {
        pairing_id: pairing.pairingId,
        protocol: PAIRING_PROTOCOL,
        initiator_share: pairing.initiatorShare,
    } as const;
    let serverExpiresAt: string | null = null;
    if (surface === "initial") {
      const started = await startInitialPairing(
        startInput,
        runId,
        abortController.signal,
      );
      serverExpiresAt =
        typeof started?.expires_at === "string" ? started.expires_at : null;
    } else {
      const started = await relayApi.startBrowserPairing({ ...startInput, server_url: pairingServerUrl, expected_device_id: pairingDeviceId });
      serverExpiresAt = started.expires_at;
    }
    ensurePairingRun(runId);
    activePairingId = pairing.pairingId;
    pairingCode = pairing.code;
    startPairingExpiry(serverExpiresAt);
    pairingStage = "waiting";
    render(bootstrap);
    moveFocus(
      surface === "browser"
        ? openPairingPageButton
        : loginOpenPairingPageButton,
    );
    if (surface === "initial") {
      // The focused handoff button is already interactive while the automatic
      // native open is pending. Reuse the same single-flight helper so an
      // immediate Enter/click cannot open a second browser tab.
      await openCurrentPairingPage(loginOpenPairingPageButton, false);
      ensurePairingRun(runId);
    }

    const response = await waitForBrowser(
      pairing.pairingId,
      runId,
      abortController.signal,
    );
    if (!response.responder_share || !response.responder_confirm) {
      throw new PairingFlowError("handshakeIncomplete");
    }
    pairingStage = "finishing";
    render(bootstrap);
    // The handoff action that normally owns focus becomes unavailable as soon
    // as the remote browser responds. Keep keyboard and screen-reader context
    // on the stable, localized finishing fact until success moves to Home or
    // failure returns to the exact retry entry.
    moveFocus(surface === "browser" ? pairingPanelStatus : loginNote);
    const finished = await finishPairingInitiator(
      pairing,
      response.responder_share,
      response.responder_confirm,
    );
    ensurePairingRun(runId);
    if (surface === "initial") {
      const deviceToken = randomRelayToken();
      const completed = await pairingRequest<{
        paired: true;
        device_id: string;
        browser_id: string;
      }>(`/api/pairings/${encodeURIComponent(pairing.pairingId)}/complete`, {
        method: "POST",
        signal: abortController.signal,
        body: JSON.stringify({
          desktop_confirm: finished.desktopConfirm,
          relay_token_hash: await sha256Hex(deviceToken),
          name: localDeviceName(),
        }),
      });
      ensurePairingRun(runId);
      bootstrap = await relayApi.completePairing({
        server_url: pairingServerUrl,
        expected_device_id: pairingDeviceId,
        device_id: completed.device_id,
        browser_id: completed.browser_id,
        device_token: deviceToken,
        e2ee_key: finished.contentKey,
      });
      ensurePairingRun(runId);
    } else {
      if (!response.browser_id) {
        throw new PairingFlowError("browserIdMissing");
      }
      bootstrap = await relayApi.completeBrowserPairing({
        server_url: pairingServerUrl,
        expected_device_id: pairingDeviceId,
        e2ee_key: finished.contentKey,
        pairing_id: pairing.pairingId,
        browser_id: response.browser_id,
        desktop_confirm: finished.desktopConfirm,
      });
      ensurePairingRun(runId);
    }
    resetPairingState();
    // Pairing and secure-store adoption are already committed. Do not leave
    // the user in an uncancellable "finishing" state while the auxiliary
    // browser list performs another network request. Render Home with its
    // loading state in the same task, then refresh authorizations in the
    // background; this also avoids flashing an empty "add this browser" row.
    browserListLoading = true;
    browserListFailed = false;
    renderCommittedBootstrap(bootstrap);
    void loadBrowserAuthorizations();
    moveFocus(statusCard);
    showTranslatedToast(
      surface === "browser" ? "browserAdded" : "deviceConnected",
    );
  } catch (error) {
    const cancelled =
      runId !== pairingRunId || error instanceof PairingCancelledError;
    let finalBrowserCancellation: Promise<boolean> | null = null;
    if (browserPairingIdToCancel) {
      // The first cancellation can race ahead of the native sidecar's remote
      // insert. This second idempotent cleanup runs after that invocation has
      // settled, so a late successful start cannot remain discoverable.
      finalBrowserCancellation = cancelRemoteBrowserPairing(
        browserPairingIdToCancel,
        cancelled,
        true,
      );
    }
    // Enter the cancellation gate synchronously before reset can admit any
    // native action, then stop expiry before yielding to the sidecar. Otherwise
    // an expiry tick can append a non-final attempt behind this final cleanup
    // and leave the cancellation queue permanently active.
    // A cancelled older run must not reset a newer run's timer or pairing state.
    if (!cancelled) resetPairingState();
    if (finalBrowserCancellation) await finalBrowserCancellation;
    if (cancelled) return;
    if (surface === "initial") {
      initialPairingErrorPresentation = pairingErrorPresentation(error);
    }
    try {
      await refresh();
    } catch {
      if (bootstrap) render(bootstrap);
    }
    showPairingErrorToast(error);
    moveFocus(
      surface === "browser" ? browserPairingEntryAction() : loginButton,
    );
  }
}

type DesktopLoginStartResponse = {
  request_id: string;
  poll_secret: string;
  status: "waiting";
  expires_at: string;
};

type DesktopLoginStatusResponse = {
  request_id: string;
  status: "waiting" | "approved";
  device_id: string | null;
  account_email: string | null;
  expires_at: string;
};

async function beginDesktopLogin() {
  if (
    !bootstrap ||
    bootstrap.platform.os !== "macos" ||
    updateInstallIsBlocked() ||
    browserPairingCancellations.active
  ) return;
  const loginServerUrl = bootstrap.config.server_url;
  const loginDeviceId = bootstrap.config.device_id;
  initialPairingErrorPresentation = null;
  minimalPairingExpired = false;
  const runId = pairingRunId + 1;
  pairingRunId = runId;
  const abortController = new AbortController();
  pairingAbortController = abortController;
  pairingSurface = "initial";
  pairingStage = "starting";
  pairingCode = "";
  render(bootstrap);
  let requestId = "";
  let pollSecret = "";
  let committed = false;
  const deviceToken = randomRelayToken();
  try {
    const started = await pairingRequest<DesktopLoginStartResponse>(
      "/api/desktop-login/start",
      {
        method: "POST",
        body: JSON.stringify({
          relay_token_hash: await sha256Hex(deviceToken),
          name: localDeviceName(),
        }),
        signal: abortController.signal,
      },
    );
    ensurePairingRun(runId);
    if (
      !/^dlogin_[A-Za-z0-9_-]{43}$/.test(started.request_id) ||
      !/^[A-Za-z0-9_-]{43}$/.test(started.poll_secret)
    ) {
      throw new PairingFlowError("signInError");
    }
    requestId = started.request_id;
    pollSecret = started.poll_secret;
    activePairingId = requestId;
    startPairingExpiry(started.expires_at);
    pairingStage = "waiting";
    render(bootstrap);
    await relayApi.openDesktopLoginPage(requestId);
    ensurePairingRun(runId);

    const expiresAt = Date.parse(started.expires_at);
    let approvedDeviceId = "";
    let approvedAccountEmail = "";
    while (Date.now() < expiresAt) {
      const status = await pairingRequest<DesktopLoginStatusResponse>(
        `/api/desktop-login/${encodeURIComponent(requestId)}`,
        {
          signal: abortController.signal,
          headers: { "X-Relay-Desktop-Login-Secret": pollSecret },
        },
      );
      ensurePairingRun(runId);
      if (status.status === "approved") {
        approvedDeviceId = status.device_id ?? "";
        approvedAccountEmail = status.account_email?.trim() ?? "";
        break;
      }
      await new Promise<void>((resolve) => {
        const finish = () => {
          window.clearTimeout(timer);
          abortController.signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = window.setTimeout(finish, 1_000);
        abortController.signal.addEventListener("abort", finish, { once: true });
      });
      ensurePairingRun(runId);
    }
    if (
      !/^dev_[a-f0-9]{32}$/.test(approvedDeviceId) ||
      approvedAccountEmail.length > 320 ||
      !(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(approvedAccountEmail) || /^[A-Za-z0-9._-]{3,64}$/.test(approvedAccountEmail))
    ) {
      throw new PairingFlowError("signInError");
    }
    pairingStage = "finishing";
    render(bootstrap);
    moveFocus(loginNote);
    bootstrap = await relayApi.completeDesktopLogin({
      server_url: loginServerUrl,
      expected_device_id: loginDeviceId,
      device_id: approvedDeviceId,
      device_token: deviceToken,
      account_email: approvedAccountEmail,
    });
    committed = true;
    ensurePairingRun(runId);
    resetPairingState();
    browserListLoading = true;
    browserListFailed = false;
    renderCommittedBootstrap(bootstrap);
    void loadBrowserAuthorizations();
    showTranslatedToast("desktopSignedIn");
    moveFocus(accountCard);
  } catch (error) {
    const cancelled =
      runId !== pairingRunId || error instanceof PairingCancelledError;
    if (requestId && pollSecret && !committed) {
      await Promise.all([
        pairingRequest(
          `/api/desktop-login/${encodeURIComponent(requestId)}/cancel`,
          {
            method: "POST",
            headers: { "X-Relay-Desktop-Login-Secret": pollSecret },
          },
          loginServerUrl,
        ).catch(() => undefined),
        // The login document may have reached its TTL after Web approval.
        // Revoke by the still-memory-only bearer as a second, independent
        // rollback so a local persistence failure cannot leave a ghost Mac.
        relayApi.abandonDesktopLogin(deviceToken, loginServerUrl).catch(() => undefined),
      ]);
    }
    if (cancelled) return;
    resetPairingState();
    initialPairingErrorPresentation =
      error instanceof DesktopCommandError
        ? {
            kind: "desktop-error",
            code: desktopErrorCode(error, "sign_in_failed"),
          }
        : { kind: "translation", key: "signInError" };
    if (bootstrap) render(bootstrap);
    showToast(initialPairingErrorPresentation);
    moveFocus(loginButton);
  }
}

loginButton.addEventListener("click", () => {
  if (bootstrap?.platform.os === "macos") {
    void beginDesktopLogin();
  } else {
    void beginPairing("initial");
  }
});

languagePicker.addEventListener("click", (event) => {
  const option = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-language]",
  );
  const requestedLocale = option?.dataset.language;
  if (
    !option ||
    languagePicker.getAttribute("aria-disabled") === "true" ||
    !isAppLocale(requestedLocale)
  ) {
    applyStaticTranslations();
    return;
  }
  void setLocale(requestedLocale).finally(applyStaticTranslations);
});

languagePicker.addEventListener("keydown", (event) => {
  const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const current = languageOptions.indexOf(
    document.activeElement as HTMLButtonElement,
  );
  if (current < 0) return;
  event.preventDefault();
  const rtl = appLocaleDirection(locale) === "rtl";
  const step = event.key === "ArrowLeft"
    ? rtl ? 1 : -1
    : event.key === "ArrowRight"
      ? rtl ? -1 : 1
      : event.key === "ArrowUp"
        ? -2
        : event.key === "ArrowDown"
          ? 2
          : 0;
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? languageOptions.length - 1
      : (current + step + languageOptions.length) % languageOptions.length;
  languageOptions[next]?.focus();
  languageOptions[next]?.click();
});

async function retryStartup() {
  if (startupRetryInFlight) return;
  startupRetryInFlight = true;
  showStartupPreparing();
  let recovered = false;
  try {
    const refreshed = await refreshWithNativeListeners();
    if (!refreshed) return;
    await resumeRelayAfterStartupRecovery();
    recovered = true;
    void loadBrowserAuthorizations();
    void loadAgentAvailability();
    void checkForUpdates();
  } catch (error) {
    showStartupFailure(error);
  } finally {
    renderStartupRetryBusy(false);
    if (!recovered && !startupRetry.classList.contains("is-hidden")) {
      moveFocus(startupRetry);
    }
  }
}

startupRetry.addEventListener("click", () => {
  void retryStartup();
});

loginCancelPairingButton.addEventListener("click", cancelPairing);

newPairingButton.addEventListener("click", () => {
  void beginPairing("browser");
});

cancelPairingButton.addEventListener("click", cancelPairing);

async function copyCurrentPairingLink(button: HTMLButtonElement) {
  if (!canOpenCurrentPairingPage() || pairingLinkCopyInFlight) return;
  const url = currentPairingUrl();
  if (!url) return;
  pairingLinkCopyInFlight = true;
  const copyButtons = [copyPairingLinkButton, loginCopyPairingLinkButton];
  for (const action of copyButtons) {
    action.setAttribute("aria-busy", "true");
    action.setAttribute("aria-disabled", "true");
    action.textContent = t("copyingLink");
  }
  try {
    await navigator.clipboard.writeText(url);
    showTranslatedToast("linkCopied");
  } catch {
    showTranslatedToast("clipboardFailed");
  } finally {
    pairingLinkCopyInFlight = false;
    for (const action of copyButtons) {
      action.removeAttribute("aria-busy");
      action.removeAttribute("aria-disabled");
      action.textContent = t("copyLink");
    }
    if (canOpenCurrentPairingPage()) moveFocus(button);
  }
}

copyPairingLinkButton.addEventListener("click", () => {
  void copyCurrentPairingLink(copyPairingLinkButton);
});

loginCopyPairingLinkButton.addEventListener("click", () => {
  void copyCurrentPairingLink(loginCopyPairingLinkButton);
});

function canOpenCurrentPairingPage() {
  return browserPairingHandoffActionsEnabled(
    pairingStage,
    Boolean(activePairingId),
  );
}

async function openCurrentPairingPage(
  button: HTMLButtonElement,
  announceSuccess = true,
) {
  if (!canOpenCurrentPairingPage() || pairingPageOpenInFlight) return;
  pairingPageOpenInFlight = true;
  const handoffButtons = [
    openPairingPageButton,
    loginOpenPairingPageButton,
  ];
  for (const action of handoffButtons) {
    action.setAttribute("aria-busy", "true");
    action.setAttribute("aria-disabled", "true");
  }
  try {
    await relayApi.openPairingPage(activePairingId);
    if (announceSuccess) showTranslatedToast("pairingPageOpened");
  } catch (error) {
    showDesktopErrorToast(error, "open_web_failed");
  } finally {
    pairingPageOpenInFlight = false;
    for (const action of handoffButtons) {
      action.removeAttribute("aria-busy");
      action.removeAttribute("aria-disabled");
    }
    if (canOpenCurrentPairingPage()) {
      moveFocus(button);
    }
  }
}

openPairingPageButton.addEventListener("click", () => {
  void openCurrentPairingPage(openPairingPageButton);
});

loginOpenPairingPageButton.addEventListener("click", () => {
  void openCurrentPairingPage(loginOpenPairingPageButton);
});

browserList.addEventListener("click", (event) => {
  if (
    nativeLanguageReconciliationPromise ||
    browserPairingCancellations.active
  ) return;
  const addButton = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-add-browser]",
  );
  if (addButton) {
    void beginPairing("browser");
    return;
  }
  const reloadButton = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-reload-browsers]",
  );
  if (reloadButton) {
    reloadBrowserAuthorizationsWithFocus();
    return;
  }
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-revoke-browser]",
  );
  if (!target) return;
  browserToRevoke =
    browserAuthorizations.find(
      (authorization) => authorization.id === target.dataset.revokeBrowser,
    ) ?? null;
  if (!browserToRevoke) return;
  revokeBrowserName.textContent = browserToRevoke.name;
  openDialog(revokeBrowserDialog);
});

agentReadiness.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-agent-action]",
  );
  if (!target || target.disabled) return;
  if (target.dataset.agentAction === "retry") {
    void loadAgentAvailability();
    return;
  }
  const provider = target.dataset.provider as RelayProvider | undefined;
  if (!provider || !["codex", "kimi", "claude", "opencode", "zcode", "mcode"].includes(provider)) return;
  if (target.dataset.agentAction === "login") {
    void openLocalAgentLogin(provider);
  } else {
    void installLocalAgent(provider);
  }
});

confirmRevokeBrowser.addEventListener("click", async () => {
  if (
    !browserToRevoke ||
    browserRevokeInFlight ||
    relayStartInFlight ||
    workspacePickerInFlight ||
    nativeLanguageReconciliationPromise ||
    browserPairingCancellations.active ||
    agentActionProvider !== null ||
    installingUpdate
  ) return;
  browserRevokeInFlight = true;
  confirmRevokeBrowser.setAttribute("aria-busy", "true");
  confirmRevokeBrowser.setAttribute("aria-disabled", "true");
  cancelRevokeBrowser.disabled = true;
  confirmRevokeBrowser.textContent = t("revoking");
  refreshUpdateActionAvailability();
  try {
    const revokedBrowser = browserToRevoke;
    const next = await relayApi.revokeBrowserAuthorization(revokedBrowser.id);
    bootstrap = next;
    invalidateBrowserAuthorizationLoads();
    browserAuthorizations = browserAuthorizations.filter(
      (authorization) => authorization.id !== revokedBrowser.id,
    );
    revokeBrowserDialog.close();
    renderCommittedBootstrap(next);
    showTranslatedToast("revoked", { name: revokedBrowser.name });
    browserToRevoke = null;
    moveFocus(signedIn(next) ? browserPairingEntryAction() : loginButton);
  } catch (error) {
    // A remote revoke failure can coincide with a failed durable rollback.
    // Resynchronize before offering retry so the dialog cannot target a
    // browser that the actual local config no longer owns.
    await refresh().catch(() => {
      // Keep the confirmation available if native bootstrap is unavailable.
    });
    if (bootstrap && signedIn(bootstrap)) {
      await loadBrowserAuthorizations();
    }
    const targetStillOwned = browserAuthorizations.some(
      (authorization) => authorization.id === browserToRevoke?.id,
    );
    if (!bootstrap || !signedIn(bootstrap) || !targetStillOwned) {
      revokeBrowserDialog.close();
      browserToRevoke = null;
      moveFocus(bootstrap && signedIn(bootstrap) ? browserPairingEntryAction() : loginButton);
    }
    showDesktopErrorToast(error, "browser_access_failed");
  } finally {
    browserRevokeInFlight = false;
    confirmRevokeBrowser.removeAttribute("aria-busy");
    confirmRevokeBrowser.removeAttribute("aria-disabled");
    cancelRevokeBrowser.disabled = false;
    confirmRevokeBrowser.textContent = t("revokeAccess");
    refreshUpdateActionAvailability();
    void requestNativeLanguageReconciliation();
    if (revokeBrowserDialog.open && browserToRevoke) {
      moveFocus(confirmRevokeBrowser);
    }
  }
});

revokeBrowserDialog.addEventListener("cancel", (event) => {
  if (browserRevokeInFlight) event.preventDefault();
});

retryRelay.addEventListener("click", async () => {
  if (updateInstallIsBlocked()) return;
  setRelayStartBusy(true);
  let relayStarted = false;
  try {
    const relay = await relayApi.start();
    if (!bootstrap) return;
    bootstrap = { ...bootstrap, relay };
    renderRelay(relay);
    relayStarted = true;
  } catch (error) {
    showDesktopErrorToast(error, "relay_start_failed");
  } finally {
    setRelayStartBusy(false);
    requestAnimationFrame(() => {
      moveFocus(relayStarted ? statusCard : retryRelay);
    });
  }
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-adapter]")) {
  button.addEventListener("click", () => {
    if (!bootstrap) return;
    const adapter = button.dataset.adapter as RelayAdapter;
    void saveConfig({ ...bootstrap.config, adapter });
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-provider]")) {
  button.addEventListener("click", () => {
    if (!bootstrap) return;
    const default_provider = button.dataset.provider as RelayProvider;
    void saveConfig({ ...bootstrap.config, default_provider });
  });
}

for (const group of document.querySelectorAll<HTMLElement>(".segments")) {
  group.addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const buttons = [...group.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0 || buttons.length < 2) return;
    event.preventDefault();
    const rtl = appLocaleDirection(locale) === "rtl";
    const direction = event.key === "ArrowRight"
      ? rtl ? -1 : 1
      : rtl ? 1 : -1;
    const next = buttons[(current + direction + buttons.length) % buttons.length];
    if (!next) return;
    next.focus();
    next.click();
  });
}

document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    pairingStage !== "idle" &&
    pairingStage !== "finishing" &&
    !document.querySelector("dialog[open]")
  ) {
    cancelPairing();
  }
});

element<HTMLButtonElement>("choose-workspace").addEventListener("click", async () => {
  if (!bootstrap || updateInstallIsBlocked()) return;
  const config = { ...bootstrap.config };
  const pickerLocale = locale;
  setWorkspacePickerBusy(true);
  try {
    const workspace = await relayApi.selectWorkspace(
      config.workspace,
      pickerLocale,
    );
    setWorkspacePickerBusy(false);
    if (workspace) await saveConfig({ ...config, workspace });
  } catch (error) {
    showDesktopErrorToast(error, "workspace_picker_failed");
  } finally {
    if (workspacePickerInFlight) setWorkspacePickerBusy(false);
  }
});

let feedbackDialog: ReturnType<typeof createFeedbackDialog> | null = null;
element<HTMLButtonElement>("report-exit-diagnostics").addEventListener("click", () => {
  diagnosticsDialog.close();
  if (!feedbackDialog || feedbackDialog.completed) feedbackDialog = createFeedbackDialog(t);
  void feedbackDialog.open(true);
});
element<HTMLButtonElement>("open-feedback").addEventListener("click", () => {
  if (!feedbackDialog || feedbackDialog.completed) feedbackDialog = createFeedbackDialog(t);
  void feedbackDialog.open();
});

let settingsReturnFocus: HTMLElement = openSettingsButton;
function showSettings(trigger: HTMLElement, account = false) {
  if (
    openSettingsButton.disabled ||
    nativeLanguageReconciliationPromise ||
    browserPairingCancellations.active
  ) return;
  if (!bootstrap || !signedIn(bootstrap)) {
    delete settingsDialog.dataset.section;
    element("settings-title").dataset.i18n = "settings";
    element("settings-title").textContent = t("settings");
  }
  settingsRuntime.classList.toggle("is-hidden", !bootstrap);
  if (bootstrap) fillSettings(bootstrap);
  settingsReturnFocus = trigger;
  openDialog(settingsDialog);
  if (account) {
    accountCard.scrollIntoView({ block: "nearest" });
    moveFocus(accountCard);
  }
}
openSettingsButton.addEventListener("click", () => {
  if (minimalInstalled && bootstrap && signedIn(bootstrap)) navigateMinimal("settings");
  else showSettings(openSettingsButton);
});
settingsDialog.addEventListener("close", () => moveFocus(settingsReturnFocus));

settingsCloseButton.addEventListener("click", () => {
  settingsDialog.close();
});

settingsCancelButton.addEventListener("click", () => {
  settingsDialog.close();
});

settingsDialog.addEventListener("cancel", (event) => {
  if (settingsSaveInFlight) event.preventDefault();
});

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveLaunchAtLogin(launchAtLoginInput.checked);
});

async function saveLaunchAtLogin(launchAtLogin: boolean, inline = false) {
  if (
    !bootstrap ||
    settingsSaveInFlight ||
    languageSwitchInFlight ||
    configSaveInFlight ||
    relayStartInFlight ||
    workspacePickerInFlight ||
    nativeLanguageReconciliationPromise ||
    browserPairingCancellations.active ||
    agentActionProvider !== null ||
    installingUpdate
  ) { renderWarmSummary(); return; }
  const previousLaunchAtLogin = bootstrap.launch_at_login;
  setSettingsFormBusy(true);
  saveSettingsButton.textContent = t("saving");
  try {
    if (launchAtLogin !== previousLaunchAtLogin) {
      const applied = await relayApi.setLaunchAtLogin(launchAtLogin);
      if (applied !== launchAtLogin) {
        throw new DesktopCommandError("autostart_failed");
      }
    }
    bootstrap = { ...bootstrap, launch_at_login: launchAtLogin };
    if (!inline) settingsDialog.close();
  } catch (error) {
    const errorCode = desktopErrorCode(error, "autostart_failed");
    showDesktopErrorCodeToast(errorCode);
    if (!inline) focusSettingsError(errorCode);
  } finally {
    setSettingsFormBusy(false);
    saveSettingsButton.textContent = t("save");
    renderWarmSummary();
  }
}


element<HTMLButtonElement>("open-file-access-settings").addEventListener("click", () => {
  void relayApi.openFileAccessSettings().catch(error => showDesktopErrorToast(error, "open_web_failed"));
});
element<HTMLButtonElement>("retry-file-access").addEventListener("click", async () => {
  const button = element<HTMLButtonElement>("retry-file-access");
  if (button.disabled) return;
  button.disabled = true;
  try { await relayApi.retryFileAccess(); }
  catch (error) { showDesktopErrorToast(error, "workspace_invalid"); }
  finally { button.disabled = false; }
});

element<HTMLButtonElement>("open-diagnostics").addEventListener("click", () => {
  openDialog(diagnosticsDialog);
});

async function openPublicPage(
  destination: "terms" | "privacy" | "changelog",
  button: HTMLButtonElement,
) {
  if (button.disabled) return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    await relayApi.openPublicPage(destination, locale);
  } catch (error) {
    showDesktopErrorToast(error, "open_web_failed");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    moveFocus(button);
  }
}


startupDiagnostics.addEventListener("click", () => {
  openDialog(diagnosticsDialog);
});
logoutButton.addEventListener("click", async () => {
  openDialog(logoutDialog);
});
logoutDialog.addEventListener("cancel", (event) => {
  if (logoutInFlight) event.preventDefault();
});
confirmLogout.addEventListener("click", async () => {
  if (
    logoutInFlight ||
    relayStartInFlight ||
    workspacePickerInFlight ||
    nativeLanguageReconciliationPromise ||
    browserPairingCancellations.active ||
    agentActionProvider !== null ||
    installingUpdate
  ) return;
  logoutInFlight = true;
  confirmLogout.setAttribute("aria-busy", "true");
  confirmLogout.setAttribute("aria-disabled", "true");
  cancelLogout.disabled = true;
  confirmLogout.textContent = t("signingOut");
  refreshUpdateActionAvailability();
  try {
    pairingRunId += 1;
    resetPairingState();
    const next = await relayApi.logout();
    invalidateBrowserAuthorizationLoads();
    browserAuthorizations = [];
    renderCommittedBootstrap(next);
    logoutDialog.close();
    showTranslatedToast("signedOut");
    moveFocus(loginButton);
  } catch (error) {
    const errorCode = desktopErrorCode(error, "sign_out_failed");
    try {
      await refresh();
      if (bootstrap && !signedIn(bootstrap)) {
        browserAuthorizations = [];
        logoutDialog.close();
        moveFocus(loginButton);
      } else {
        void loadBrowserAuthorizations();
      }
    } catch {
      // Keep the still-open confirmation dialog retryable when even bootstrap
      // cannot determine whether the remote revoke took effect.
    }
    showDesktopErrorCodeToast(errorCode);
  } finally {
    logoutInFlight = false;
    confirmLogout.removeAttribute("aria-busy");
    confirmLogout.removeAttribute("aria-disabled");
    cancelLogout.disabled = false;
    confirmLogout.textContent = t("signOut");
    refreshUpdateActionAvailability();
    void requestNativeLanguageReconciliation();
    if (logoutDialog.open) moveFocus(confirmLogout);
  }
});
element<HTMLButtonElement>("close-diagnostics").addEventListener("click", () => {
  diagnosticsDialog.close();
});

prepareTaskFiles.addEventListener("click", () => {
  if (minimalInstalled) void requestWorkspaceAccess();
  else openWorkspaceAccess();
});

workspaceAccessLater.addEventListener("click", () => {
  if (folderAccessRequestInFlight) return;
  workspaceAccessDialog.close();
  moveFocus(prepareTaskFiles);
});
workspaceAccessContinue.addEventListener("click", () => {
  void requestWorkspaceAccess();
});
workspaceAccessDialog.addEventListener("cancel", (event) => {
  if (folderAccessRequestInFlight) {
    event.preventDefault();
  } else {
    moveFocus(prepareTaskFiles);
  }
});

installUpdateButton.addEventListener("click", () => {
  void installPendingUpdate();
});

updateLaterButton.addEventListener("click", () => {
  void dismissPendingUpdate();
});

showStartupPreparing();
void refreshWithNativeListeners()
  .then((refreshed) => {
    if (!refreshed) return;
    void loadBrowserAuthorizations();
    void loadAgentAvailability();
    void checkForUpdates();
  })
  .catch((error) => {
    showStartupFailure(error);
  });

window.addEventListener("online", () => {
  requestNativeUpdateAvailability();
  void requestNativeLanguageReconciliation();
  if (!bootstrap && !startupRetry.classList.contains("is-hidden")) {
    startupRetry.click();
  }
});

window.addEventListener("focus", () => {
  requestNativeUpdateAvailability();
  void requestNativeLanguageReconciliation();
  void loadAgentAvailability();
  void checkForUpdates();
  if (!diagnosticsEventListening || !updateCheckEventListening) {
    void ensureAuxiliaryNativeListeners().catch(() => {
      notifyAuxiliaryListenerFailure();
    });
  }
});

window.setInterval(() => {
  void checkForUpdates();
}, UPDATE_CHECK_INTERVAL_MS);

// Expire a stale sidecar observation even if its process stops reporting.
window.setInterval(() => {
  if (minimalInstalled && !document.hidden) renderBrowserAuthorizations();
}, 2_000);

function renderInstanceEntry(value?: Bootstrap) {
  const copy = instanceCopy(locale);
  const entry = element<HTMLButtonElement>("open-instance-settings");
  const origin = value?.config.server_url ?? bootstrap?.config.server_url;
  entry.textContent = `${copy.title} · ${origin ? isOfficialInstance(origin) ? copy.official : origin : "—"}`;
  entry.disabled = !origin || instanceSwitchInFlight;
}

const instanceDialog = element<HTMLDialogElement>("instance-dialog");
const instanceForm = element<HTMLFormElement>("instance-form");
const instanceOrigin = element<HTMLInputElement>("instance-origin");
const instanceKind = element<HTMLSelectElement>("instance-kind");
const instanceConfirm = element<HTMLInputElement>("instance-confirm");
const instanceSave = element<HTMLButtonElement>("instance-save");
const instanceProbe = element<HTMLButtonElement>("instance-probe");
let checkedInstanceOrigin: string | null = null;
let instanceProbeInFlight = false;
let instanceProbeRun = 0;

function invalidateInstanceProbe() {
  checkedInstanceOrigin = null;
  instanceProbeRun += 1;
  instanceConfirm.checked = false;
  instanceSave.disabled = true;
  element("instance-status").textContent = "";
}

function instanceOperationBlocked() {
  return instanceSwitchInFlight || installingUpdate || pairingStage === "finishing" ||
    configSaveInFlight || settingsSaveInFlight || logoutInFlight || browserRevokeInFlight ||
    relayStartInFlight || workspacePickerInFlight || folderAccessRequestInFlight ||
    agentActionProvider !== null || nativeLanguageReconciliationPromise !== null ||
    browserPairingCancellations.active;
}

element("open-instance-settings").addEventListener("click", () => {
  if (!bootstrap || instanceOperationBlocked()) return;
  const copy = instanceCopy(locale);
  const labels = { "instance-title": copy.title, "instance-address-label": copy.address,
    "instance-address-help": copy.addressHelp, "instance-warning": copy.warning,
    "instance-confirm-label": copy.confirm, "instance-cancel": copy.cancel,
    "instance-probe": copy.probe, "instance-save": copy.save, "instance-update-note": copy.update };
  for (const [id, value] of Object.entries(labels)) element(id).textContent = value;
  instanceKind.options[0]!.textContent = copy.official;
  instanceKind.options[1]!.textContent = copy.custom;
  instanceOrigin.value = bootstrap.config.server_url;
  instanceKind.value = isOfficialInstance(instanceOrigin.value) ? "official" : "custom";
  instanceOrigin.readOnly = instanceKind.value === "official";
  invalidateInstanceProbe();
  openDialog(instanceDialog);
});
instanceKind.addEventListener("change", () => {
  instanceOrigin.value = instanceKind.value === "official" ? OFFICIAL_SERVER_ORIGIN : "";
  instanceOrigin.readOnly = instanceKind.value === "official";
  invalidateInstanceProbe();
  if (!instanceOrigin.readOnly) instanceOrigin.focus();
});
instanceOrigin.addEventListener("input", invalidateInstanceProbe);
instanceConfirm.addEventListener("change", () => {
  instanceSave.disabled = !instanceConfirm.checked || !checkedInstanceOrigin || instanceSwitchInFlight;
});
element("instance-cancel").addEventListener("click", () => {
  if (!instanceSwitchInFlight) { invalidateInstanceProbe(); instanceDialog.close(); }
});
instanceDialog.addEventListener("cancel", event => {
  if (instanceSwitchInFlight) event.preventDefault();
  else invalidateInstanceProbe();
});
instanceProbe.addEventListener("click", async () => {
  if (instanceProbeInFlight || !bootstrap || instanceOperationBlocked()) return;
  invalidateInstanceProbe();
  const run = instanceProbeRun;
  const copy = instanceCopy(locale);
  instanceProbeInFlight = true;
  instanceProbe.disabled = true;
  element("instance-status").textContent = copy.checking;
  try {
    const origin = normalizedInstanceOrigin(instanceOrigin.value);
    const info = await relayApi.probeInstance(origin);
    if (run !== instanceProbeRun) return;
    checkedInstanceOrigin = origin;
    element("instance-status").textContent = info.setup_required ? copy.setup : copy.ready;
    instanceSave.disabled = !instanceConfirm.checked;
  } catch {
    if (run === instanceProbeRun) element("instance-status").textContent = copy.failure;
  } finally {
    instanceProbeInFlight = false;
    instanceProbe.disabled = false;
  }
});
instanceForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!bootstrap || !checkedInstanceOrigin || !instanceConfirm.checked || instanceOperationBlocked()) return;
  const origin = checkedInstanceOrigin;
  if (normalizedInstanceOrigin(instanceOrigin.value) !== origin) return;
  // Cancel the old flow before native reset. Any late completion also carries
  // its original origin and device generation and cannot adopt old secrets.
  pairingRunId += 1;
  if (pairingSurface === "browser" && activePairingId) {
    await cancelRemoteBrowserPairing(activePairingId, false, true);
  }
  resetPairingState();
  instanceSwitchInFlight = true;
  configSaveInFlight = true;
  instanceForm.inert = true;
  instanceSave.disabled = true;
  renderInstanceEntry();
  let switchFailed = false;
  try {
    const next = await relayApi.switchInstance(origin, bootstrap.config.server_url);
    invalidateBrowserAuthorizationLoads();
    browserAuthorizations = [];
    browserListLoading = false;
    browserListFailed = false;
    initialPairingErrorPresentation = null;
    pairingOrigins.clear();
    feedbackDialog?.dispose();
    feedbackDialog = null;
    if (pendingUpdate) { await pendingUpdate.close(); pendingUpdate = null; }
    renderCommittedBootstrap(next);
    instanceDialog.close();
    moveFocus(loginButton);
  } catch {
    switchFailed = true;
    await refresh().catch(() => undefined);
  } finally {
    instanceSwitchInFlight = false;
    configSaveInFlight = false;
    instanceForm.inert = false;
    invalidateInstanceProbe();
    if (switchFailed) element("instance-status").textContent = instanceCopy(locale).resetFailure;
    if (bootstrap) render(bootstrap);
  }
});
