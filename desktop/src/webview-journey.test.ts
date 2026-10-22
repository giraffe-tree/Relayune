import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { desktopQaActionSteps } from "./qa-harness";
import { settingsRecoveryField } from "./settings-recovery";

async function source(name: string) {
  return readFile(new URL(name, import.meta.url), "utf8");
}

describe("desktop WebView journey admission", () => {
  it("keeps the default 8-character-code journey ahead of optional QR scanning", async () => {
    const [main, styles] = await Promise.all([
      source("./main.ts"),
      source("./styles.css"),
    ]);

    const initialColumn = main.match(
      /<div class="pairing-code-column">[\s\S]*?<\/div>\s*<\/div>\s*<button class="primary wide"/,
    )?.[0] ?? "";
    expect(initialColumn).toContain('id="pairing-code"');
    expect(initialColumn).toContain('id="login-pairing-expiry"');
    expect(main).toMatch(/loginView\.classList\.toggle\("is-pairing", Boolean\(pairingCode\)\)/);
    expect(styles).toMatch(/\.pairing-code-column\s*\{\s*order:\s*-1;/);
    expect(styles).toMatch(
      /@media \(max-width: 480px\) and \(max-height: 560px\)[\s\S]*?\.login-view\.is-pairing \.pairing-qr-card,[\s\S]*?display:\s*none/,
    );
  });

  it("fits code controls and dialogs across 320, 400, 420 and 520px widths", async () => {
    const styles = await source("./styles.css");
    const approximateCodeWidth = 9 * (27 * 0.6 + 27 * 0.16) + 36;

    for (const width of [320, 400, 420, 520]) {
      const shellPadding = width <= 480 ? 36 : 56;
      expect(width - shellPadding).toBeGreaterThan(approximateCodeWidth);
      expect(Math.min(460, width - 40)).toBeGreaterThanOrEqual(280);
    }

    expect(styles).toMatch(/body\s*\{[^}]*min-width:\s*320px/);
    expect(styles).toMatch(/dialog\s*\{[^}]*calc\(100vw\s*-\s*40px\)/);
    expect(styles).not.toMatch(/body\s*\{[^}]*overflow:\s*hidden/);
    expect(styles).toMatch(/\.dialog-card\s*\{[^}]*overflow-y:\s*auto/);
  });

  it("preserves keyboard focus through startup, pairing, cancellation and sign-out", async () => {
    const [main, styles, nativeConfig] = await Promise.all([
      source("./main.ts"),
      source("./styles.css"),
      source("../src-tauri/src/config.rs"),
    ]);

    expect(main).toMatch(/showStartupFailure[\s\S]*?moveFocus\(startupRetry\)/);
    expect(main).toMatch(
      /function renderInitialPairingActionAvailability\(\)[\s\S]*?pairingStage !== "idle" \|\| nativeLanguageReconciliationPromise !== null[\s\S]*?loginButton\.disabled = installingUpdate;[\s\S]*?toggleAttribute\("aria-busy", busy\)[\s\S]*?toggleAttribute\("aria-disabled", busy \|\| installingUpdate\)/,
    );
    expect(main).not.toMatch(
      /loginButton\.disabled\s*=\s*pairingStage !== "idle"/,
    );
    expect(main).toMatch(
      /async function beginPairing[\s\S]*?updateInstallIsBlocked\(\)[\s\S]*?pairingStage = "starting";\s*pairingCode = "";\s*render\(bootstrap\)/,
    );
    expect(main).toMatch(
      /pairingStage = "starting";\s*pairingCode = "";\s*render\(bootstrap\);\s*if \(surface === "browser"\) \{[\s\S]*?moveFocus\(pairingPanelStatus\)/,
    );
    expect(main).toMatch(/pairingStage = "waiting"[\s\S]*?moveFocus\([\s\S]*?loginOpenPairingPageButton/);
    expect(main).toMatch(
      /pairingStage = "finishing";\s*render\(bootstrap\);[\s\S]*?moveFocus\(surface === "browser" \? pairingPanelStatus : loginNote\)/,
    );
    expect(main).toMatch(
      /id="login-note"[^>]*tabindex="-1"[\s\S]*?id="pairing-panel-status"[^>]*tabindex="-1"/,
    );
    expect(styles).toMatch(
      /\.login-note:focus-visible, #pairing-panel-status:focus-visible\s*\{[^}]*outline:/,
    );
    expect(main).toMatch(/function cancelPairing[\s\S]*?moveFocus\(wasBrowser \? browserPairingEntryAction\(\) : loginButton\)/);
    expect(main).toMatch(/resetPairingState\(\);[\s\S]*?render\(bootstrap\);[\s\S]*?moveFocus\(statusCard\)/);
    expect(main).toMatch(/confirmLogout[\s\S]*?moveFocus\(loginButton\)/);
    expect(main).toMatch(
      /retryRelay\.addEventListener[\s\S]*?\.start\(\)[\s\S]*?bootstrap = \{ \.\.\.bootstrap, relay \}[\s\S]*?renderRelay\(relay\)/,
    );
    expect(main).toMatch(
      /confirmRevokeBrowser\.setAttribute\("aria-busy", "true"\);\s*confirmRevokeBrowser\.setAttribute\("aria-disabled", "true"\);\s*cancelRevokeBrowser\.disabled = true;[\s\S]*?finally \{\s*browserRevokeInFlight = false;\s*confirmRevokeBrowser\.removeAttribute\("aria-busy"\);\s*confirmRevokeBrowser\.removeAttribute\("aria-disabled"\);\s*cancelRevokeBrowser\.disabled = false;/,
    );
    expect(main).toMatch(
      /revokeBrowserDialog\.addEventListener\("cancel", \(event\) => \{\s*if \(browserRevokeInFlight\) event\.preventDefault\(\);/,
    );
    expect(main).toMatch(
      /if \(revokeBrowserDialog\.open && browserToRevoke\) \{\s*moveFocus\(confirmRevokeBrowser\)/,
    );
    expect(main).toContain('id="settings-form" novalidate');
    expect(main).toContain('settingsDialog.addEventListener("close", () => moveFocus(settingsReturnFocus))');
    expect(main).toMatch(
      /function setSettingsFormBusy\(busy: boolean\)[\s\S]*?saveSettingsButton\.disabled = false;[\s\S]*?toggleAttribute\("aria-busy", busy\)[\s\S]*?toggleAttribute\("aria-disabled", busy\)/,
    );
    expect(main).not.toMatch(/saveSettingsButton\.disabled = busy/);
    expect(main).toMatch(
      /settingsDialog\.addEventListener\("cancel", \(event\) => \{\s*if \(settingsSaveInFlight\) event\.preventDefault\(\);/,
    );
    expect(main).toMatch(
      /await relayApi\.setLaunchAtLogin\(launchAtLogin\)[\s\S]*?bootstrap = \{ \.\.\.bootstrap, launch_at_login: launchAtLogin \};[\s\S]*?settingsDialog\.close\(\);/,
    );
    expect(settingsRecoveryField("server_https_required")).toBeNull();
    expect(settingsRecoveryField("server_credentials_forbidden")).toBeNull();
    expect(settingsRecoveryField("codex_path_invalid")).toBeNull();
    expect(settingsRecoveryField("kimi_path_invalid")).toBeNull();
    expect(settingsRecoveryField("claude_path_invalid")).toBeNull();
    expect(settingsRecoveryField("autostart_failed")).toBe("launch-at-login");
    expect(settingsRecoveryField("settings_save_failed")).toBeNull();
    expect(main).toMatch(/input\.focus\(\{ preventScroll: true \}\)/);
    for (const removedField of ["server-url", "codex-bin", "kimi-bin", "claude-bin"]) {
      expect(main).not.toContain(`id="${removedField}"`);
    }
    expect(nativeConfig).toContain(
      'const DEFAULT_SERVER_URL: &str = "https://relayune.giraffetree.cn";',
    );
    expect(styles).toMatch(/\.switch input:focus-visible \+ span\s*\{[^}]*outline:/);
    expect(main).toMatch(
      /id="settings-form"[\s\S]*?<section class="language-settings"[\s\S]*?id="language-picker"[\s\S]*?role="radiogroup"/,
    );
    expect(main).not.toMatch(/<select class="language-toggle"/);
    expect(styles).toMatch(/\.language-option\[aria-checked="true"\]\s*\{/);
    expect(main).toMatch(
      /document\.documentElement\.dir = appLocaleDirection\(locale\)/,
    );
    expect(main).toMatch(
      /languagePicker\.addEventListener\("click",[\s\S]*?isAppLocale\(requestedLocale\)/,
    );
    expect(main).toMatch(/languagePicker\.addEventListener\("keydown"[\s\S]*?ArrowLeft[\s\S]*?Home[\s\S]*?languageOptions\[next\]\?\.focus\(\)/);
    expect(main).toMatch(
      /languageSwitchInFlight = true;[\s\S]*?aria-disabled[\s\S]*?aria-busy[\s\S]*?removeAttribute\("aria-disabled"\)/,
    );
    expect(main).not.toMatch(/languagePicker\.disabled\s*=/);
  });

  it("reveals the connected home before the auxiliary browser list finishes", async () => {
    const main = await source("./main.ts");

    expect(main).toMatch(
      /bootstrap = await relayApi\.completePairing\([\s\S]*?resetPairingState\(\);[\s\S]*?browserListLoading = true;[\s\S]*?renderCommittedBootstrap\(bootstrap\);[\s\S]*?void loadBrowserAuthorizations\(\);[\s\S]*?moveFocus\(statusCard\)/,
    );
    expect(main).not.toMatch(
      /await loadBrowserAuthorizations\(\);\s*resetPairingState\(\);/,
    );
  });

  it("keeps signed-in account identity without billing status or expiry requests", async () => {
    const [main, api, cli, shell] = await Promise.all([
      source("./main.ts"), source("./api.ts"), source("../../relay/cli.mjs"), source("./warm-shell.ts"),
    ]);
    expect(main).toContain('id="account-email"');
    expect(main).toContain('data-i18n="signedInStatus"');
    expect(main).not.toMatch(/membership-expiry|loadMembershipExpiry|openMembershipDestination/);
    expect(api).not.toMatch(/get_membership_expiry|open_membership_destination/);
    expect(cli).not.toContain('/api/relay/account/membership-expiry');
    expect(shell).not.toContain('PRO');
  });

  it("does not let an older bootstrap repaint a committed native mutation", async () => {
    const main = await source("./main.ts");
    const committedRender = main.match(
      /function renderCommittedBootstrap\([\s\S]*?\n\}/,
    )?.[0] ?? "";

    expect(committedRender).toMatch(
      /bootstrapRefreshGate\.invalidate\(\);\s*render\(value, options\)/,
    );
    expect(main).toMatch(
      /relayApi\.saveSettings\([\s\S]*?renderCommittedBootstrap\(next\)/,
    );
    expect(main).toMatch(
      /relayApi\.revokeBrowserAuthorization\([\s\S]*?renderCommittedBootstrap\(next\)/,
    );
    expect(main).toMatch(
      /const next = await relayApi\.logout\(\);[\s\S]*?renderCommittedBootstrap\(next\)/,
    );
    expect(main).toMatch(
      /relayApi\.completeBrowserPairing\([\s\S]*?renderCommittedBootstrap\(bootstrap\)/,
    );
  });

  it("cancels in-flight pairing work without requiring AbortSignal.any", async () => {
    const [main, abortSignal] = await Promise.all([
      source("./main.ts"),
      source("../../shared/abort-signal.ts"),
    ]);

    expect(main).toMatch(
      /const abortController = new AbortController\(\);\s*pairingAbortController = abortController/,
    );
    expect(main).toMatch(
      /startInitialPairing\([\s\S]*?abortController\.signal[\s\S]*?waitForBrowser\([\s\S]*?abortController\.signal/,
    );
    expect(main).toMatch(
      /function resetPairingState\(\) \{\s*pairingAbortController\?\.abort\(\);\s*pairingAbortController = null/,
    );
    expect(main).toMatch(
      /pairingRequest<\{[\s\S]*?\/complete[\s\S]*?signal: abortController\.signal/,
    );
    expect(main).not.toContain("AbortSignal.any");
    expect(abortSignal).not.toContain("AbortSignal.any(");
  });

  it("removes an expired code immediately instead of leaving a dead handoff", async () => {
    const main = await source("./main.ts");
    const expiry = main.match(
      /function expireCurrentPairing\(\) \{([\s\S]*?)\n\}/,
    )?.[1] ?? "";

    expect(main).toMatch(
      /function tickPairingExpiry[\s\S]*?pairingStage === "waiting" \|\| pairingStage === "recovering"[\s\S]*?pairingDeadlineExpired\(pairingExpiresAtMs\)[\s\S]*?expireCurrentPairing\(\)/,
    );
    expect(main).toMatch(/setInterval\(tickPairingExpiry, 1_000\)/);
    expect(expiry).toMatch(/pairingRunId \+= 1;[\s\S]*?resetPairingState\(\)/);
    expect(expiry).toMatch(/showTranslatedToast\("pairingExpired"\)/);
    expect(expiry).toMatch(
      /moveFocus\(minimalInstalled && wasBrowser \? element\("minimal-regenerate"\) : wasBrowser \? browserPairingEntryAction\(\) : loginButton\)/,
    );
  });

  it("keeps the visual QA bridge development-only and free of secret logging", async () => {
    const [main, harness, viteConfig] = await Promise.all([
      source("./main.ts"),
      source("./qa-harness.ts"),
      source("../vite.config.ts"),
    ]);

    expect(main).toMatch(
      /if \(import\.meta\.env\.DEV\) \{[\s\S]*?await import\("\.\/qa-harness"\)[\s\S]*?installDesktopQaHarness\(\)/,
    );
    expect(harness).not.toMatch(/console\.|localStorage|sessionStorage/);
    expect(harness).not.toMatch(/JSON\.stringify\(args|textContent\s*=\s*pairing/i);
    expect(harness).toContain('node.textContent = "••••-••••"');
    expect(viteConfig).toMatch(/sourcemap:\s*false/);
    expect(harness).toMatch(
      /startRecovery && pairingStartAttempts === 1[\s\S]*?service_unavailable[\s\S]*?status: 503/,
    );
    expect(harness).toMatch(
      /case "plugin:updater\|check":[\s\S]*?case "set_update_available":[\s\S]*?return null;/,
    );
    expect(desktopQaActionSteps("retry", "startup-failure")).toEqual([
      { selector: "#startup-retry", click: true },
    ]);
    expect(desktopQaActionSteps("pair-cancel", "initial")).toEqual([
      { selector: "#login-button", click: true },
      { selector: "#pairing-code:not(:empty)" },
      { selector: "#login-cancel-pairing", click: true },
    ]);
    expect(desktopQaActionSteps("pair-open-failure", "initial")).toEqual([
      { selector: "#login-button", click: true },
      { selector: "#pairing-code:not(:empty)" },
      { selector: "#login-open-pairing-page", click: true },
      { selector: "#login-cancel-pairing:not(:disabled)" },
    ]);
    expect(desktopQaActionSteps("folder-access", "initial")).toEqual([
      { selector: "#login-button", click: true },
      { selector: "#account-card:not(.is-hidden)" },
      { selector: "#workspace-access-dialog:not([open])" },
      { selector: "#prepare-task-files", click: true },
      { selector: "#workspace-access-dialog[open]" },
      { selector: "#workspace-access-continue", click: true },
    ]);
    expect(
      desktopQaActionSteps("startup-settings-unavailable", "startup-failure"),
    ).toEqual([
      { selector: "#open-settings", click: true },
      { selector: "#settings-dialog[open]" },
      { selector: "#settings-runtime.is-hidden" },
    ]);
    expect(
      desktopQaActionSteps("startup-diagnostics-language", "startup-failure"),
    ).toEqual([
      { selector: "#startup-retry:not(.is-hidden)" },
      { selector: "#open-settings", click: true },
      { selector: "#settings-dialog[open]" },
      { selector: '[data-language="en"]', click: true },
      { selector: "#settings-close", click: true },
      { selector: "#startup-diagnostics", click: true },
      { selector: "#diagnostics-dialog[open]" },
    ]);
    expect(desktopQaActionSteps("logout-confirm", "connected").at(-1)).toEqual({
      selector: "#confirm-logout",
      click: true,
    });
    expect(desktopQaActionSteps("logout-pending-lock", "connected").slice(-2)).toEqual([
      { selector: "#cancel-logout", expectDisabled: true },
      { selector: "#confirm-logout", expectDisabled: true },
    ]);
    expect(desktopQaActionSteps("revoke-pending-lock", "connected").slice(-2)).toEqual([
      { selector: "#cancel-revoke-browser", expectDisabled: true },
      { selector: "#confirm-revoke-browser", expectDisabled: true },
    ]);
    expect(desktopQaActionSteps("settings-pending-language", "connected").at(-1)).toEqual({
      selector: "#save-settings",
      expectDisabled: true,
      expectText: "Saving…",
    });
    expect(desktopQaActionSteps("settings-draft-language", "connected")).toEqual([
      { selector: "#open-settings", click: true },
      { selector: "#settings-dialog[open]" },
      { selector: "#launch-at-login", click: true },
      { selector: '[data-language="en"]', click: true },
      { selector: "#launch-at-login", expectChecked: false },
    ]);
    expect(desktopQaActionSteps("relay-retry-language", "relay-error")).toEqual([
      { selector: "#retry-relay", click: true },
      { selector: '#status-card[data-tone="success"]' },
      { selector: "#open-settings", click: true },
      { selector: "#settings-dialog[open]" },
      { selector: '[data-language="en"]', click: true },
      { selector: '#status-card[data-tone="success"]' },
    ]);
  });

  it("keeps irreversible and settings progress truthful while language changes", async () => {
    const main = await source("./main.ts");
    const helper = main.match(
      /function renderInFlightActionCopy\(\) \{([\s\S]*?)\n\}/,
    )?.[1];

    expect(helper).toBeTruthy();
    expect(helper).toMatch(/saveSettingsButton\.disabled[\s\S]*?t\("saving"\)/);
    expect(helper).toMatch(/logoutInFlight[\s\S]*?t\("signingOut"\)/);
    expect(helper).toMatch(/browserRevokeInFlight[\s\S]*?t\("revoking"\)/);
    const localeSetter = main.match(
      /async function setLocale\([\s\S]*?\n\}/,
    )?.[0] ?? "";
    expect(localeSetter.match(/renderInFlightActionCopy\(\)/g)).toHaveLength(2);
    expect(localeSetter.match(/preserveSettingsDraft: settingsDialog\.open/g)).toHaveLength(2);
    expect(main).toMatch(
      /function render\([\s\S]*?preserveSettingsDraft\?: boolean[\s\S]*?if \(!options\.preserveSettingsDraft\) fillSettings\(value\)/,
    );
    expect(main).toMatch(
      /function setSettingsFormBusy[\s\S]*?settingsForm\.toggleAttribute\("aria-busy", busy\)[\s\S]*?launchAtLoginInput\.disabled = busy/,
    );
    expect(main).not.toMatch(/serverUrlInput|codexBinInput|kimiBinInput|claudeBinInput/);
    expect(main).toMatch(
      /async function saveLaunchAtLogin\(launchAtLogin: boolean, inline = false\)[\s\S]*?!bootstrap[\s\S]*?settingsSaveInFlight[\s\S]*?relayStartInFlight[\s\S]*?workspacePickerInFlight[\s\S]*?installingUpdate[\s\S]*?return;[\s\S]*?setSettingsFormBusy\(true\)[\s\S]*?finally \{\s*setSettingsFormBusy\(false\)/,
    );
  });

  it("does not let an older browser-list response undo revoke or sign-out", async () => {
    const main = await source("./main.ts");
    const loader = main.match(
      /async function loadBrowserAuthorizations\(\) \{([\s\S]*?)\n\}/,
    )?.[1] ?? "";

    expect(loader).toMatch(
      /const loadGeneration = browserListLoadGeneration \+ 1;[\s\S]*?browserListLoadGeneration = loadGeneration/,
    );
    expect(loader).toMatch(
      /await relayApi\.listBrowserAuthorizations\(\);[\s\S]*?if \(loadGeneration !== browserListLoadGeneration\) return;[\s\S]*?browserAuthorizations = nextAuthorizations/,
    );
    expect(loader.match(/loadGeneration !== browserListLoadGeneration/g)).toHaveLength(3);
    expect(main).toMatch(
      /revokeBrowserAuthorization[\s\S]*?invalidateBrowserAuthorizationLoads\(\);[\s\S]*?browserAuthorizations = browserAuthorizations\.filter/,
    );
    expect(main).toMatch(
      /const next = await relayApi\.logout\(\);\s*invalidateBrowserAuthorizationLoads\(\);\s*browserAuthorizations = \[\]/,
    );
    expect(main).toMatch(
      /const wasSignedIn = Boolean\(bootstrap && signedIn\(bootstrap\)\);[\s\S]*?await relayApi\.bootstrap\(\);[\s\S]*?if \(!bootstrapRefreshGate\.isCurrent\(refreshRunId\)\) return false;\s*throw error;\s*}\s*if \(!bootstrapRefreshGate\.isCurrent\(refreshRunId\)\) return false;\s*if \(wasSignedIn && !signedIn\(next\)\) \{\s*invalidateBrowserAuthorizationLoads\(\);\s*browserAuthorizations = \[\]/,
    );
  });

  it("keeps every browser authorization action truthful during pairing", async () => {
    const main = await source("./main.ts");

    expect(main).toMatch(
      /function renderBrowserAuthorizations\(\) \{\s*const cancellationInFlight = browserPairingCancellations\.active;\s*const actionsDisabled =\s*browserAuthorizationActionsDisabled\(pairingStage\) \|\|\s*cancellationInFlight \|\|\s*configSaveInFlight \|\|\s*languageSwitchInFlight/,
    );
    expect(main).toMatch(
      /browserListState\([\s\S]*?"reload-browsers",\s*actionsDisabled[\s\S]*?browserListState\([\s\S]*?"add-browser",\s*actionsDisabled/,
    );
    expect(main).toMatch(
      /"\[data-revoke-browser\], \[data-add-browser\], \[data-reload-browsers\]"/,
    );
    expect(main).toMatch(
      /revoke\.setAttribute\(\s*"aria-label",\s*browserRevokeActionLabel\(authorization\.name, locale\)/,
    );
  });

  it("keeps an explicit browser-list retry focused through loading and failure", async () => {
    const [main, styles] = await Promise.all([
      source("./main.ts"),
      source("./styles.css"),
    ]);

    expect(main).toMatch(
      /id="browser-list" role="region" aria-labelledby="browser-title" aria-live="polite" tabindex="-1"/,
    );
    expect(main).toMatch(
      /function renderBrowserAuthorizations\(\)[\s\S]*?browserList\.toggleAttribute\("aria-busy", browserListLoading\)/,
    );
    expect(main).toMatch(
      /async function loadBrowserAuthorizations\(\)[\s\S]*?const restoreUserFocus = browserListRestoreNextLoadFocus;[\s\S]*?renderBrowserAuthorizations\(\);\s*if \(restoreUserFocus\) moveFocus\(browserList\)/,
    );
    expect(main).toMatch(
      /const retry = browserList\.querySelector<HTMLButtonElement>\([\s\S]*?"\[data-reload-browsers\]"[\s\S]*?moveFocus\(retry \?\? browserList\)/,
    );
    expect(main).toMatch(
      /function reloadBrowserAuthorizationsWithFocus\(\) \{\s*browserListRestoreNextLoadFocus = true;\s*void loadBrowserAuthorizations\(\)[\s\S]*?if \(reloadButton\) \{\s*reloadBrowserAuthorizationsWithFocus\(\)/,
    );
    expect(styles).toMatch(/\.browser-list:focus-visible\s*\{[^}]*outline:/);
  });

  it("retires the one-time browser handoff as soon as confirmation starts saving", async () => {
    const main = await source("./main.ts");

    expect(main).toMatch(
      /const pairingHandoffEnabled = browserPairingHandoffActionsEnabled\([\s\S]*?loginOpenPairingPageButton\.disabled = !pairingHandoffEnabled;[\s\S]*?loginCopyPairingLinkButton\.disabled = !pairingHandoffEnabled/,
    );
    expect(main).toMatch(
      /openPairingPageButton\.disabled = !pairingHandoffEnabled;[\s\S]*?copyPairingLinkButton\.disabled = !pairingHandoffEnabled/,
    );
    expect(main).toMatch(
      /async function copyCurrentPairingLink\(button: HTMLButtonElement\) \{\s*if \(!canOpenCurrentPairingPage\(\) \|\| pairingLinkCopyInFlight\) return;/,
    );
  });

  it("keeps copying a pairing handoff single-flight and focus-safe", async () => {
    const main = await source("./main.ts");
    const copyHandoff =
      main.match(/async function copyCurrentPairingLink\([\s\S]*?\n\}/)?.[0] ??
      "";

    expect(main).toContain("let pairingLinkCopyInFlight = false;");
    expect(copyHandoff).toMatch(
      /copyPairingLinkButton, loginCopyPairingLinkButton/,
    );
    expect(copyHandoff).toMatch(
      /setAttribute\("aria-busy", "true"\)[\s\S]*?setAttribute\("aria-disabled", "true"\)[\s\S]*?textContent = t\("copyingLink"\)/,
    );
    expect(copyHandoff).not.toMatch(/action\.disabled = true/);
    expect(copyHandoff).toMatch(
      /finally \{[\s\S]*?pairingLinkCopyInFlight = false[\s\S]*?removeAttribute\("aria-busy"\)[\s\S]*?removeAttribute\("aria-disabled"\)[\s\S]*?textContent = t\("copyLink"\)[\s\S]*?canOpenCurrentPairingPage\(\)[\s\S]*?moveFocus\(button\)/,
    );
    expect(main).toMatch(
      /copyCurrentPairingLink\(copyPairingLinkButton\)[\s\S]*?copyCurrentPairingLink\(loginCopyPairingLinkButton\)/,
    );
  });

  it("keeps browser handoff focusable and bounded while the native open is pending", async () => {
    const main = await source("./main.ts");
    const handoff =
      main.match(/async function openCurrentPairingPage\([\s\S]*?\n\}/)?.[0] ??
      "";

    expect(main).toContain("let pairingPageOpenInFlight = false;");
    expect(handoff).toMatch(
      /!canOpenCurrentPairingPage\(\) \|\| pairingPageOpenInFlight/,
    );
    expect(handoff).toMatch(
      /openPairingPageButton,[\s\S]*?loginOpenPairingPageButton/,
    );
    expect(handoff).toMatch(
      /setAttribute\("aria-busy", "true"\)[\s\S]*?setAttribute\("aria-disabled", "true"\)/,
    );
    expect(handoff).not.toMatch(/button\.disabled = true/);
    expect(handoff).toMatch(
      /finally \{[\s\S]*?pairingPageOpenInFlight = false[\s\S]*?removeAttribute\("aria-busy"\)[\s\S]*?removeAttribute\("aria-disabled"\)[\s\S]*?canOpenCurrentPairingPage\(\)[\s\S]*?moveFocus\(button\)/,
    );
  });

  it("routes the automatic first-login browser handoff through the same single-flight guard", async () => {
    const main = await source("./main.ts");
    const beginPairing =
      main.match(/async function beginPairing\([\s\S]*?\n\}/)?.[0] ?? "";

    expect(beginPairing).toMatch(
      /surface === "initial"[\s\S]*?await openCurrentPairingPage\(loginOpenPairingPageButton, false\)[\s\S]*?ensurePairingRun\(runId\)/,
    );
    expect(beginPairing).not.toMatch(/relayApi\.openPairingPage/);
    expect(main).toMatch(
      /async function openCurrentPairingPage\([\s\S]*?announceSuccess = true[\s\S]*?if \(announceSuccess\) showTranslatedToast\("pairingPageOpened"\)/,
    );
  });

  it("does not let an older QR render overwrite a replacement session", async () => {
    const main = await source("./main.ts");

    expect(main).toMatch(
      /function renderPairingQrCode[\s\S]*?const stagingCanvas = document\.createElement\("canvas"\)[\s\S]*?toCanvas\(stagingCanvas, payload[\s\S]*?pairingQrGenerations\.get\(canvas\) !== generation[\s\S]*?context\.drawImage\(stagingCanvas, 0, 0\)/,
    );
    expect(main).toMatch(
      /function invalidatePairingQrCodes[\s\S]*?pairingQrGenerations\.delete\(canvas\)[\s\S]*?clearRect/,
    );
    expect(main).toMatch(
      /function resetPairingState[\s\S]*?invalidatePairingQrCodes\(\)/,
    );
    expect(main).toMatch(
      /canvas\.setAttribute\("aria-busy", "true"\)[\s\S]*?pairingQrGenerations\.get\(canvas\) !== generation[\s\S]*?canvas\.removeAttribute\("aria-busy"\)/,
    );
    expect(main).not.toMatch(
      /canvas\.dataset\.[A-Za-z]+\s*=\s*(?:payload|pairingCode|url)/,
    );
  });

  it("keeps QR progress and failure beside the image instead of in a transient toast", async () => {
    const main = await source("./main.ts");
    const styles = await source("./styles.css");

    expect(main).toMatch(
      /id="login-pairing-qr"[\s\S]*?aria-hidden="true"[\s\S]*?id="login-pairing-qr-status"[\s\S]*?role="status"[\s\S]*?aria-live="polite"/,
    );
    expect(main).toMatch(
      /id="replacement-pairing-qr"[\s\S]*?aria-hidden="true"[\s\S]*?id="replacement-pairing-qr-status"[\s\S]*?role="status"[\s\S]*?aria-live="polite"/,
    );
    expect(main).toMatch(
      /function setPairingQrPresentation[\s\S]*?status\.textContent = t\(key\)[\s\S]*?key === "qrFailed"[\s\S]*?canvas\.removeAttribute\("aria-hidden"\)[\s\S]*?canvas\.setAttribute\("aria-hidden", "true"\)/,
    );
    expect(main).toMatch(
      /renderPairingQrCode[\s\S]*?"qrPreparing", false[\s\S]*?readyKey, true[\s\S]*?"qrFailed", false/,
    );
    expect(main).not.toMatch(
      /\.catch\(\(\) => \{[\s\S]*?showTranslatedToast\("qrFailed"\)/,
    );
    expect(styles).toMatch(
      /\.pairing-qr-card span\[data-tone="error"\][^{]*\{[^}]*color:/,
    );
  });

  it("does not let an older bootstrap response split window and tray language", async () => {
    const main = await source("./main.ts");

    expect(main).toMatch(
      /languageSwitchInFlight = true;\s*languageSwitchRevision \+= 1;/,
    );
    expect(main).toMatch(
      /const switchRevisionAtStart = languageSwitchRevision;\s*const switchWasIdleAtStart = !languageSwitchInFlight;[\s\S]*?bootstrapLocaleAfterRefresh\([\s\S]*?currentSwitchRevision: languageSwitchRevision[\s\S]*?switchInFlight: languageSwitchInFlight/,
    );
    expect(main).toMatch(
      /if \(next\.config\.ui_language !== refreshedLocale\) \{[\s\S]*?config: \{ \.\.\.next\.config, ui_language: refreshedLocale \}/,
    );
    expect(main).toMatch(
      /const languageSwitchOverlapped =[\s\S]*?!switchWasIdleAtStart[\s\S]*?languageSwitchInFlight[\s\S]*?switchRevisionAtStart !== languageSwitchRevision[\s\S]*?if \(!languageSwitchOverlapped\) \{\s*nativeLanguageReconciliationNeeded = true;\s*void requestNativeLanguageReconciliation\(\)/,
    );
    expect(main).toMatch(
      /catch \(error\) \{\s*locale = previousLocale;\s*if \(bootstrap\) \{[\s\S]*?ui_language: previousLocale/,
    );
  });

  it("retries a failed native language presentation without replaying bootstrap", async () => {
    const [main, styles, i18n] = await Promise.all([
      source("./main.ts"),
      source("./styles.css"),
      source("./i18n.ts"),
    ]);
    const reconciliation = main.match(
      /function requestNativeLanguageReconciliation\(\) \{([\s\S]*?)\n\}/,
    )?.[1] ?? "";

    expect(reconciliation).toMatch(
      /!bootstrap[\s\S]*?pairingStage !== "idle"[\s\S]*?configSaveInFlight[\s\S]*?settingsSaveInFlight[\s\S]*?logoutInFlight[\s\S]*?browserRevokeInFlight[\s\S]*?relayStartInFlight[\s\S]*?workspacePickerInFlight[\s\S]*?installingUpdate[\s\S]*?languageSwitchInFlight[\s\S]*?!nativeLanguageReconciliationNeeded/,
    );
    expect(reconciliation).toMatch(
      /const desiredLanguage = locale;[\s\S]*?setUiLanguage\(desiredLanguage\)/,
    );
    expect(reconciliation).toMatch(
      /if \(locale === desiredLanguage\) \{\s*nativeLanguageReconciliationNeeded = false;/,
    );
    expect(reconciliation).toMatch(
      /catch\(\(error\) => \{\s*nativeLanguageReconciliationNeeded = true;[\s\S]*?showDesktopErrorToast\(error, "language_failed"\)/,
    );
    expect(reconciliation).toMatch(
      /nativeLanguageReconciliationPromise = relayApi[\s\S]*?\.finally\(\(\) => \{\s*nativeLanguageReconciliationPromise = null;\s*setNativeLanguageReconciliationBusy\(false\);[\s\S]*?!installingUpdate[\s\S]*?requestNativeLanguageReconciliation\(\);[\s\S]*?setNativeLanguageReconciliationBusy\(true\);/,
    );
    expect(main).toMatch(
      /function setNativeLanguageReconciliationBusy\(busy: boolean\)[\s\S]*?focusPreservingControls[\s\S]*?control\.setAttribute\("aria-disabled", "true"\)[\s\S]*?control\.removeAttribute\("aria-disabled"\)[\s\S]*?loginButton\.setAttribute\("aria-busy", "true"\)/,
    );
    expect(main).not.toMatch(
      /function setNativeLanguageReconciliationBusy\(busy: boolean\)[\s\S]*?loginButton\.disabled = true/,
    );
    expect(styles).toMatch(
      /button\[aria-disabled="true"\][\s\S]*?pointer-events:\s*none/,
    );
    expect(main).toMatch(
      /loginNote\.textContent = busy \? t\("finishingSetup"\)[\s\S]*?initialPairingErrorPresentation[\s\S]*?"desktopLoginNote" : "loginNote"/,
    );
    expect(i18n).toMatch(/finishingSetup: "正在完成设置…"/);
    expect(i18n).toMatch(/finishingSetup: "Finishing setup…"/);
    expect(main).toMatch(
      /window\.addEventListener\("online"[\s\S]*?requestNativeLanguageReconciliation\(\)/,
    );
    expect(main).toMatch(
      /window\.addEventListener\("focus"[\s\S]*?requestNativeLanguageReconciliation\(\)/,
    );
    expect(main).toMatch(
      /if \(nativeLanguageReconciliationPromise\) \{\s*await nativeLanguageReconciliationPromise;\s*\}[\s\S]*?await relayApi\.setUiLanguage\(nextLocale\)/,
    );
  });

  it("does not let bootstrap overwrite a newer Relay publication", async () => {
    const main = await source("./main.ts");

    expect(main).toMatch(
      /const relayEventRevisionAtStart = relayEventRevision;[\s\S]*?relaySnapshotAfterBootstrap\([\s\S]*?next\.relay,[\s\S]*?latestRelayEvent,[\s\S]*?relayEventRevisionAtStart,[\s\S]*?relayEventRevision/,
    );
    expect(main).toMatch(
      /function handleRelayStatus\(payload: RelaySnapshot\) \{\s*latestRelayEvent = payload;\s*relayEventRevision \+= 1;\s*if \(!bootstrap\) return;/,
    );
    expect(main).toMatch(
      /function ensureRelayStatusListener\(\)[\s\S]*?listen<RelaySnapshot>\([\s\S]*?"relay-status"[\s\S]*?handleRelayStatus\(event\.payload\)[\s\S]*?relayStatusListening = true/,
    );
    expect(main).toMatch(
      /async function refreshWithNativeListeners\(\) \{\s*await ensureRelayStatusListener\(\);\s*const auxiliaryListenerAttempt = ensureAuxiliaryNativeListeners\(\)\.then\([\s\S]*?await refresh\(\);[\s\S]*?void auxiliaryListenerAttempt\.then/,
    );
    expect(
      main.match(/(?:void|await) refreshWithNativeListeners\(\)/g),
    ).toHaveLength(2);
    expect(main).not.toMatch(
      /void refresh\(\)\s*\.then\(\(\) => \{\s*void loadBrowserAuthorizations/,
    );
  });

  it("registers native menu actions before bootstrap without blocking login on auxiliary failure", async () => {
    const main = await source("./main.ts");

    expect(main).toMatch(
      /function ensureAuxiliaryNativeListeners\(\)[\s\S]*?listen\("open-diagnostics"[\s\S]*?diagnosticsEventListening = true[\s\S]*?listen\("check-for-updates"[\s\S]*?updateCheckEventListening = true/,
    );
    expect(main).toMatch(
      /diagnosticsEventListenerPromise = listen\("open-diagnostics"[\s\S]*?diagnosticsEventListenerPromise = null[\s\S]*?registrations\.push\(diagnosticsEventListenerPromise\)/,
    );
    expect(main).toMatch(
      /updateCheckEventListenerPromise = listen\("check-for-updates"[\s\S]*?updateCheckEventListenerPromise = null[\s\S]*?registrations\.push\(updateCheckEventListenerPromise\)/,
    );
    expect(main).not.toContain("auxiliaryNativeListenerPromise");
    expect(main).toMatch(
      /const auxiliaryListenerAttempt = ensureAuxiliaryNativeListeners\(\)\.then\([\s\S]*?await refresh\(\);[\s\S]*?auxiliaryListenerAttempt\.then\(\(ready\)[\s\S]*?if \(!ready\) notifyAuxiliaryListenerFailure\(\)/,
    );
    expect(main).toMatch(
      /window\.addEventListener\("focus"[\s\S]*?ensureAuxiliaryNativeListeners\(\)\.catch[\s\S]*?notifyAuxiliaryListenerFailure\(\)/,
    );
    expect(main).not.toMatch(/void listen\("(?:open-diagnostics|check-for-updates)"/);
  });

  it("does not report healthy diagnostics before startup checks finish", async () => {
    const [main, copy] = await Promise.all([
      source("./main.ts"),
      source("./i18n.ts"),
    ]);

    expect(main).toMatch(
      /function showStartupPreparing\(\)[\s\S]*?diagnosticSummary\.textContent = t\("diagnosticsPreparing"\)[\s\S]*?diagnosticLog\.textContent = t\("diagnosticsPreparingDetail"\)/,
    );
    expect(main).toMatch(
      /showStartupPreparing\(\);\s*void refreshWithNativeListeners\(\)/,
    );
    expect(copy).toContain('diagnosticsPreparing: "正在检查 Relayune…"');
    expect(copy).toContain('diagnosticsPreparing: "Checking Relayune…"');
  });

  it("keeps native update availability visible and retryable after refresh failure", async () => {
    const main = await source("./main.ts");

    expect(main).not.toMatch(
      /relayApi\.setUpdateAvailable\((?:true|false)\)\.catch\(\(\) => \{\}\)/,
    );
    expect(main).toMatch(
      /async function flushNativeUpdateAvailability\(\)[\s\S]*?await relayApi\.setUpdateAvailable\(desired\)[\s\S]*?desiredNativeUpdateAvailable = desired[\s\S]*?showDesktopErrorToast\(error, "update_failed"\)/,
    );
    expect(main).toMatch(
      /function requestNativeUpdateAvailability\(available\?: boolean\)[\s\S]*?desiredNativeUpdateAvailable = available[\s\S]*?nativeUpdateSyncPromise = flushNativeUpdateAvailability\(\)/,
    );
    expect(main).toMatch(
      /window\.addEventListener\("focus"[\s\S]*?requestNativeUpdateAvailability\(\)/,
    );
    expect(main).toMatch(
      /window\.addEventListener\("online"[\s\S]*?requestNativeUpdateAvailability\(\)/,
    );
  });

  it("does not relaunch through an in-flight onboarding transaction", async () => {
    const [main, copy] = await Promise.all([
      source("./main.ts"),
      source("./i18n.ts"),
    ]);

    expect(main).toMatch(
      /function updateInstallIsBlocked\(\)[\s\S]*?pairingInFlight: pairingStage !== "idle"[\s\S]*?configSaveInFlight[\s\S]*?settingsSaveInFlight[\s\S]*?languageSwitchInFlight[\s\S]*?logoutInFlight[\s\S]*?browserRevokeInFlight[\s\S]*?relayStartInFlight[\s\S]*?workspacePickerInFlight[\s\S]*?nativeLanguageReconciliationInFlight/,
    );
    expect(main).toMatch(
      /async function installPendingUpdate\(\) \{\s*if \(!pendingUpdate \|\| updateInstallIsBlocked\(\)\) return;/,
    );
    expect(main).toMatch(
      /catch \{\s*installingUpdate = false;[\s\S]*?showTranslatedToast\("updateFailed"\);\s*moveFocus\(installUpdateButton\);\s*void requestNativeLanguageReconciliation\(\);/,
    );
    expect(main).toMatch(
      /function renderPendingUpdate\(\)[\s\S]*?installUpdateButton\.disabled = installBlocked && !installingUpdate;[\s\S]*?toggleAttribute\("aria-disabled", installBlocked\)[\s\S]*?toggleAttribute\("aria-busy", installingUpdate\)[\s\S]*?t\("updateBusyDetail"\)/,
    );
    expect(main).toMatch(
      /async function dismissPendingUpdate\(\) \{\s*if \(!pendingUpdate \|\| installingUpdate \|\| dismissingUpdate\) return;[\s\S]*?await update\.close\(\)[\s\S]*?hideUpdateCard\(\);[\s\S]*?moveFocus\(bootstrap && signedIn\(bootstrap\) \? statusCard : loginButton\)[\s\S]*?moveFocus\(updateLaterButton\)/,
    );
    expect(main).toMatch(
      /async function beginPairing[\s\S]*?if \(!bootstrap \|\| updateInstallIsBlocked\(\)\) return/,
    );
    expect(main).toMatch(
      /retryRelay\.addEventListener\("click", async \(\) => \{\s*if \(updateInstallIsBlocked\(\)\) return;[\s\S]*?setRelayStartBusy\(true\)[\s\S]*?await relayApi\.start\(\)[\s\S]*?finally \{\s*setRelayStartBusy\(false\)/,
    );
    expect(main).toMatch(
      /"choose-workspace"\)\.addEventListener\("click", async \(\) => \{\s*if \(!bootstrap \|\| updateInstallIsBlocked\(\)\) return;[\s\S]*?setWorkspacePickerBusy\(true\)[\s\S]*?await relayApi\.selectWorkspace[\s\S]*?setWorkspacePickerBusy\(false\)[\s\S]*?await saveConfig/,
    );
    expect(copy).toContain("请先完成当前连接或设置操作");
    expect(copy).toContain("Finish the current connection or settings change");
  });

  it("keeps Relay retry single-flight, announced, and focus-safe", async () => {
    const main = await source("./main.ts");

    expect(main).toMatch(
      /function renderRelayRetryAvailability\(canRetry: boolean\)[\s\S]*?const visible = canRetry \|\| relayStartInFlight[\s\S]*?updateInstallIsBlocked\(\) && !relayStartInFlight[\s\S]*?toggleAttribute\("aria-busy", relayStartInFlight\)[\s\S]*?toggleAttribute\("aria-disabled", relayStartInFlight\)[\s\S]*?relayStartInFlight \? "connecting" : "reconnect"/,
    );
    expect(main).toMatch(
      /retryRelay\.addEventListener\("click", async \(\) => \{\s*if \(updateInstallIsBlocked\(\)\) return;[\s\S]*?setRelayStartBusy\(true\)[\s\S]*?let relayStarted = false[\s\S]*?await relayApi\.start\(\)[\s\S]*?relayStarted = true[\s\S]*?finally \{\s*setRelayStartBusy\(false\);\s*requestAnimationFrame\(\(\) => \{\s*moveFocus\(relayStarted \? statusCard : retryRelay\)/,
    );
  });

  it("announces accurate first-pairing stages before a code exists", async () => {
    const main = await source("./main.ts");

    expect(main).toMatch(
      /id="login-note"[\s\S]{0,180}?role="status"[\s\S]{0,120}?aria-live="polite"[\s\S]{0,120}?aria-atomic="true"/,
    );
    expect(main).toMatch(
      /function renderInitialPairingActionAvailability\(\)[\s\S]*?const busy =[\s\S]*?pairingStage !== "idle"[\s\S]*?loginButton\.toggleAttribute\("aria-busy", busy\)/,
    );
    expect(main).toMatch(
      /initialPairingButtonKey[\s\S]*?pairingStage === "starting"[\s\S]*?"creatingSecureConnection"[\s\S]*?pairingStage === "finishing"[\s\S]*?"pairingFinishing"[\s\S]*?pairingStage === "waiting"[\s\S]*?"waitingBrowser"/,
    );
    expect(main).toMatch(
      /initialPairingStatusKey[\s\S]*?pairingStage === "starting"[\s\S]*?"creatingSecureConnection"[\s\S]*?pairingStage === "finishing"[\s\S]*?"waitingConfirmation"/,
    );
  });

  it("keeps first-pairing failures beside the retry action and retranslates them", async () => {
    const [main, styles] = await Promise.all([
      source("./main.ts"),
      source("./styles.css"),
    ]);

    expect(main).toContain(
      'id="login-button" type="button" data-i18n="openBrowser" aria-describedby="login-note"',
    );
    expect(main).toMatch(
      /let initialPairingErrorPresentation: ToastPresentation \| null = null/,
    );
    expect(main).toMatch(
      /const initialPairingError =\s*pairingStage === "idle" \? initialPairingErrorPresentation : null;[\s\S]*?toastPresentationText\(initialPairingError\)[\s\S]*?dataset\.tone = initialPairingError \? "error" : "status"[\s\S]*?setAttribute\("role", initialPairingError \? "alert" : "status"\)[\s\S]*?initialPairingError \? "assertive" : "polite"/,
    );
    expect(main).toMatch(
      /function toastPresentationText\(presentation: ToastPresentation\)[\s\S]*?t\(presentation\.key, presentation\.params\)[\s\S]*?desktopErrorMessage\(locale, presentation\.code\)/,
    );
    expect(main).toMatch(
      /async function beginPairing[\s\S]*?surface === "initial"\) initialPairingErrorPresentation = null[\s\S]*?catch \(error\)[\s\S]*?initialPairingErrorPresentation = pairingErrorPresentation\(error\)[\s\S]*?await refresh\(\)/,
    );
    expect(main).toMatch(
      /function expireCurrentPairing[\s\S]*?initialPairingErrorPresentation = \{\s*kind: "translation",\s*key: "pairingExpired"/,
    );
    expect(styles).toMatch(
      /\.login-note\[data-tone="error"\][^{]*\{[^}]*color:[^}]*font-weight:/,
    );
  });

  it("keeps language settings available before bootstrap without exposing empty runtime fields", async () => {
    const [main, copy] = await Promise.all([
      source("./main.ts"),
      source("./i18n.ts"),
    ]);

    expect(main).toMatch(
      /id="open-settings"[\s\S]*?aria-describedby="startup-message"[\s\S]*?><svg/,
    );
    expect(main).not.toMatch(
      /id="open-settings"[\s\S]{0,180}?disabled/,
    );
    expect(main).toMatch(
      /function showStartupPreparing[\s\S]*?openSettingsButton\.disabled = false[\s\S]*?aria-describedby/,
    );
    expect(main).toMatch(
      /function showStartupFailure[\s\S]*?openSettingsButton\.disabled = false[\s\S]*?aria-describedby/,
    );
    expect(main).toMatch(
      /class="settings-runtime is-hidden" id="settings-runtime"/,
    );
    expect(main).toMatch(
      /function showSettings[\s\S]*?settingsRuntime\.classList\.toggle\("is-hidden", !bootstrap\);\s*if \(bootstrap\) fillSettings\(bootstrap\);\s*settingsReturnFocus = trigger;\s*openDialog\(settingsDialog\)/,
    );
    expect(main).toMatch(
      /openSettingsButton\.disabled = busy;\s*openSettingsButton\.removeAttribute\("aria-describedby"\)/,
    );
    expect(copy).toContain(
      "Check your connection, then try again or open Help & Diagnostics.",
    );
    expect(copy).toContain("请检查网络后重试，或打开帮助与诊断");
  });

  it("turns a slow bootstrap into an explained diagnostic state without replaying it", async () => {
    const [main, copy] = await Promise.all([
      source("./main.ts"),
      source("./i18n.ts"),
    ]);
    const preparing = main.slice(
      main.indexOf("function showStartupPreparing()"),
      main.indexOf("function showStartupFailure", main.indexOf("function showStartupPreparing()")),
    );

    expect(main).toContain("const STARTUP_SLOW_NOTICE_MS = 4_000;");
    expect(preparing).toContain("const preparingRunId = startupFailureRunId;");
    expect(preparing).toMatch(
      /window\.setTimeout[\s\S]*?preparingRunId !== startupFailureRunId[\s\S]*?bootstrap !== null[\s\S]*?loadingView\.classList\.contains\("is-hidden"\)[\s\S]*?startupMessage\.dataset\.i18n = "stillPreparing"[\s\S]*?startupRetry\.classList\.remove\("is-hidden"\)[\s\S]*?startupRetry\.disabled = false[\s\S]*?startupDiagnostics\.classList\.remove\("is-hidden"\)/,
    );
    expect(preparing).not.toContain("refreshWithNativeListeners");
    expect(main).toMatch(
      /function showStartupFailure[\s\S]*?startupMessage\.dataset\.i18n = "startupFailed"/,
    );
    expect(copy).toContain("准备时间比平时更长");
    expect(copy).toContain("This is taking longer than usual");
    expect(
      desktopQaActionSteps("startup-slow-diagnostics", "preparing"),
    ).toEqual([
      { selector: '#startup-message[data-i18n="stillPreparing"]' },
      { selector: "#startup-diagnostics", click: true },
      { selector: "#diagnostics-dialog[open]" },
      { selector: 'html[data-relayune-qa-bootstrap-attempts="1"]' },
    ]);
    expect(
      desktopQaActionSteps("startup-slow-retry", "preparing"),
    ).toEqual([
      { selector: '#startup-message[data-i18n="stillPreparing"]' },
      { selector: "#startup-retry:not(.is-hidden)", click: true },
      { selector: "#login-view:not(.is-hidden)" },
      { selector: 'html[data-relayune-qa-bootstrap-attempts="2"]' },
    ]);
    expect(
      desktopQaActionSteps("startup-slow-language", "preparing"),
    ).toEqual([
      { selector: '#startup-message[data-i18n="stillPreparing"]' },
      { selector: "#open-settings", click: true },
      { selector: "#settings-dialog[open]" },
      { selector: '[data-language="en"]', click: true },
      {
        selector: '#startup-message[data-i18n="stillPreparing"]',
        expectText:
          "This is taking longer than usual. Try again or open Help & Diagnostics; an older result will not replace the newer state.",
      },
    ]);
    expect(main).toMatch(
      /async function refresh\(\): Promise<boolean>[\s\S]*?refreshRunId = bootstrapRefreshGate\.begin\(\)[\s\S]*?await relayApi\.bootstrap\(\)[\s\S]*?bootstrapRefreshGate\.isCurrent\(refreshRunId\)[\s\S]*?return false[\s\S]*?render\(next\)[\s\S]*?return true/,
    );
    expect(main).toMatch(
      /async function retryStartup\(\)[\s\S]*?if \(startupRetryInFlight\) return;[\s\S]*?showStartupPreparing\(\)[\s\S]*?await refreshWithNativeListeners\(\)[\s\S]*?if \(!refreshed\) return/,
    );
    expect(main).toMatch(
      /desktopQaLocale = installDesktopQaHarness\(\);[\s\S]*?desktopQaLocale \?\? detectAppLocale\(navigator\.languages, storedLocale\(\)\)/,
    );
  });

  it("keeps a slow startup retry single-flight, announced, and focused", async () => {
    const [main, copy] = await Promise.all([
      source("./main.ts"),
      source("./i18n.ts"),
    ]);

    expect(main).toMatch(
      /function renderStartupRetryBusy\(busy: boolean\)[\s\S]*?startupRetryInFlight = busy[\s\S]*?toggleAttribute\("aria-busy", busy\)[\s\S]*?toggleAttribute\("aria-disabled", busy\)[\s\S]*?busy \? "retryingStartup" : "retryStartup"/,
    );
    expect(main).toMatch(
      /function showStartupPreparing\(\)[\s\S]*?classList\.toggle\("is-hidden", !startupRetryInFlight\)[\s\S]*?startupRetry\.disabled = !startupRetryInFlight[\s\S]*?startupDiagnostics\.classList\.toggle\("is-hidden", !startupRetryInFlight\)/,
    );
    expect(main).toMatch(
      /async function retryStartup\(\)[\s\S]*?if \(startupRetryInFlight\) return;[\s\S]*?let recovered = false[\s\S]*?await refreshWithNativeListeners\(\)[\s\S]*?recovered = true[\s\S]*?finally \{[\s\S]*?renderStartupRetryBusy\(false\)[\s\S]*?!recovered && !startupRetry\.classList\.contains\("is-hidden"\)[\s\S]*?moveFocus\(startupRetry\)/,
    );
    expect(copy).toContain("正在重试…");
    expect(copy).toContain("Retrying…");
  });

  it("stops continuous feedback animations for reduced motion", async () => {
    const styles = await source("./styles.css");
    const reduced = styles.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)?.[0] ?? "";

    for (const selector of [
      ".brand-mark",
      ".spinner",
      ".status-indicator span",
      ".browser-state-spinner::after",
    ]) {
      expect(reduced).toContain(selector);
    }
    expect(reduced).toMatch(/animation:\s*none/);
    expect(reduced).toMatch(/transition-duration:\s*\.01ms/);
  });

  it("serializes native config writes and announces their result", async () => {
    const main = await source("./main.ts");

    expect(main).toMatch(
      /id="saved-state"[\s\S]{0,180}?role="status"[\s\S]{0,120}?aria-live="polite"[\s\S]{0,120}?aria-atomic="true"/,
    );
    expect(main).toMatch(
      /async function saveConfig[\s\S]*?configSaveInFlight[\s\S]*?languageSwitchInFlight[\s\S]*?browserPairingCancellations\.active[\s\S]*?installingUpdate[\s\S]*?setConfigSaveBusy\(true\)[\s\S]*?await relayApi\.saveSettings[\s\S]*?finally \{\s*setConfigSaveBusy\(false\)/,
    );
    expect(main).toMatch(
      /async function setLocale[\s\S]*?languageSwitchInFlight[\s\S]{0,120}?configSaveInFlight[\s\S]{0,120}?installingUpdate[\s\S]*?finally \{[\s\S]*?renderConfigActionAvailability\(\)/,
    );
    expect(main).toMatch(
      /browserAuthorizationActionsDisabled\(pairingStage\)[\s\S]*?browserPairingCancellations\.active[\s\S]*?configSaveInFlight[\s\S]*?languageSwitchInFlight/g,
    );
    expect(main).toMatch(
      /const saveFeedback = new TransientStatusController[\s\S]*?savedState\.textContent = key \? t\(key\) : ""/,
    );
    expect(main.match(/saveFeedback\.retranslate\(\)/g)).toHaveLength(3);
    expect(main).toMatch(
      /saveFeedback\.set\(announce \? "saved" : null, announce \? 1_600 : undefined\)/,
    );
  });
});
