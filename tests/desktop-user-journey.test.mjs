import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const parametersStart = source.indexOf("(", start);
  let parameterDepth = 0;
  let bodyStart = -1;
  for (let index = parametersStart; index < source.length; index += 1) {
    if (source[index] === "(") parameterDepth += 1;
    if (source[index] === ")") parameterDepth -= 1;
    if (source[index] === "{" && parameterDepth === 0) {
      bodyStart = index;
      break;
    }
  }
  assert.notEqual(bodyStart, -1, `missing body for function ${name}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }
  assert.fail(`unterminated function ${name}`);
}

function functionSource(source, name) {
  const signature = source.match(
    new RegExp(`\\bfn\\s+${name}(?:\\s*<[^>{}]*>)?\\s*\\(`),
  );
  const start = signature?.index ?? -1;
  assert.notEqual(start, -1, `missing Rust function ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated Rust function ${name}`);
}

test("settings cancel and close never submit changed values", async () => {
  const [source, nativeConfig] = await Promise.all([
    read("../desktop/src/main.ts"),
    read("../desktop/src-tauri/src/config.rs"),
  ]);
  const settingsForm = source.match(
    /<form\b[^>]*\bid="settings-form"[^>]*>([\s\S]*?)<\/form>/,
  )?.[1];
  assert.ok(settingsForm, "settings dialog form should exist");

  const cancelButtons = ["settings-close", "settings-cancel"].map((id) =>
    settingsForm.match(new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>`))?.[0],
  );
  assert.ok(cancelButtons.every(Boolean), "both × and Cancel should be explicit cancel actions");
  assert.equal(cancelButtons.length, 2, "both × and Cancel should be explicit cancel actions");

  const cannotSubmitInvalidSettings = cancelButtons.every(
    (tag) => /\btype="button"/.test(tag) || /\bformnovalidate\b/.test(tag),
  );
  assert.equal(
    cannotSubmitInvalidSettings,
    true,
    "cancel must never submit the launch-at-login draft",
  );

  assert.match(
    functionBody(source, "setSettingsFormBusy"),
    /settingsForm\.toggleAttribute\("aria-busy", busy\)[\s\S]*?launchAtLoginInput\.disabled = busy/,
    "a settings request must keep its submitted field snapshot stable",
  );
  assert.doesNotMatch(
    source,
    /id="(?:server-url|codex-bin|kimi-bin|claude-bin)"/,
    "server and Agent executable paths must not be exposed as user settings",
  );
  assert.match(
    nativeConfig,
    /const DEFAULT_SERVER_URL: &str = "https:\/\/relayune\.giraffetree\.cn";/,
    "the sole production Relay URL must remain an application default",
  );
  assert.match(source, /settingsForm\.addEventListener\("submit"[\s\S]*?saveLaunchAtLogin\(launchAtLoginInput\.checked\)/,
    "capture the checkbox value as an argument before entering the save transaction");
  const saveSettings = functionBody(source, "saveLaunchAtLogin");
  assert.match(saveSettings, /!bootstrap[\s\S]*?settingsSaveInFlight[\s\S]*?relayStartInFlight[\s\S]*?workspacePickerInFlight[\s\S]*?installingUpdate[\s\S]*?return;[\s\S]*?setSettingsFormBusy\(true\)/);
  assert.match(saveSettings, /relayApi\.setLaunchAtLogin\(launchAtLogin\)/);
  assert.doesNotMatch(saveSettings, /launchAtLoginInput\.checked/,
    "the request must use its captured argument rather than rereading a mutable control");

  const buttonHandlersClose = [
    ["settings-close", "settingsCloseButton"],
    ["settings-cancel", "settingsCancelButton"],
  ].every(([id, variable]) =>
    new RegExp(
      `(?:["']${id}["']\\)[\\s\\S]{0,120}|${variable})\\.addEventListener\\(["']click["'][\\s\\S]{0,160}settingsDialog\\.close\\(\\)`,
    ).test(source),
  );
  assert.equal(
    buttonHandlersClose,
    true,
    "settings cancellation needs an explicit close path instead of the save path",
  );
});

test("cold-start bootstrap failure presents a real retry path", async () => {
  const source = await read("../desktop/src/main.ts");
  assert.match(
    functionBody(source, "signedIn"),
    /value\.secrets\.device_token && value\.secrets\.e2ee_key/,
    "partial secure-store state must return to reconnectable onboarding",
  );
  assert.match(source, /id="(?:retry-bootstrap|retry-startup|startup-retry)"/);
  assert.match(
    source,
    /async function retryStartup\(\)[\s\S]*?refreshWithNativeListeners\(\)/,
  );

  const startupCatch = source.match(
    /void refreshWithNativeListeners\(\)[\s\S]*?\.catch\(\(error\) => \{([\s\S]*?)\n\s*\}\);/,
  )?.[1];
  assert.ok(
    startupCatch,
    "listener setup and startup bootstrap should share an explicit failure branch",
  );
  assert.match(
    functionBody(source, "refreshWithNativeListeners"),
    /await ensureRelayStatusListener\(\)[\s\S]*?ensureAuxiliaryNativeListeners\(\)\.then\([\s\S]*?await refresh\(\)[\s\S]*?auxiliaryListenerAttempt\.then/,
    "Relay status must be ready before bootstrap while auxiliary menu listeners remain non-blocking",
  );
  assert.match(startupCatch, /showStartupFailure\(error\)/);
  assert.doesNotMatch(
    startupCatch,
    /showOnly\(loginView\)/,
    "an uninitialized app must not expose a login button whose bootstrap is null",
  );
  assert.match(
    functionBody(source, "showStartupFailure"),
    /moveFocus\(startupRetry\)/,
    "startup recovery should put keyboard focus on the action that can continue",
  );
  const startupPreparing = functionBody(source, "showStartupPreparing");
  assert.match(
    startupPreparing,
    /bootstrapRefreshGate\.invalidate\(\)[\s\S]*?startupMessage\.dataset\.i18n = "stillPreparing"[\s\S]*?startupRetry\.classList\.remove\("is-hidden"\)[\s\S]*?startupRetry\.disabled = false/,
    "a hung bootstrap must expose a real retry and invalidate its eventual stale result",
  );
  assert.match(
    functionBody(source, "refresh"),
    /const refreshRunId = bootstrapRefreshGate\.begin\(\)[\s\S]*?await relayApi\.bootstrap\(\)[\s\S]*?bootstrapRefreshGate\.isCurrent\(refreshRunId\)[\s\S]*?return false[\s\S]*?render\(next\)[\s\S]*?return true/,
    "only the latest bootstrap attempt may render the startup or login surface",
  );
  assert.match(source, /id="startup-diagnostics"[\s\S]*?data-i18n="helpDiagnostics"/);
  const startupFailure = functionBody(source, "showStartupFailure");
  assert.match(
    startupFailure,
    /startupFailureCode = desktopErrorCode\(error, "startup_failed"\)[\s\S]*?renderStartupDiagnostics\(\)[\s\S]*?relayApi\.snapshot\(\)[\s\S]*?startupDiagnosticSnapshot = relay;[\s\S]*?renderStartupDiagnostics\(\)/,
    "a startup error should expose native diagnostics without requiring a successful bootstrap",
  );
  assert.match(
    functionBody(source, "renderStartupDiagnostics"),
    /startupDiagnosticPresentation\(\s*locale,\s*startupFailureCode,\s*startupDiagnosticSnapshot/,
    "startup diagnostics should be rebuilt from stable state whenever the locale changes",
  );
  assert.doesNotMatch(
    startupFailure,
    /startup(?:Failure|Diagnostic)\w*\s*=\s*error\b/,
    "raw native errors must not be retained in frontend startup state",
  );
  assert.match(
    source,
    /startupDiagnostics\.addEventListener\("click"[\s\S]*?openDialog\(diagnosticsDialog\)/,
  );
  assert.match(
    functionBody(source, "refresh"),
    /shouldFocusPrimaryAction[\s\S]*?moveFocus\(signedIn\(next\) \? statusCard : loginButton\)/,
    "the first usable surface should focus its primary action",
  );
  assert.match(
    functionBody(source, "resumeRelayAfterStartupRecovery"),
    /signedIn\(bootstrap\)[\s\S]*?relay\.phase !== "stopped"[\s\S]*?relayApi\.start\(\)[\s\S]*?relayApi\.snapshot\(\)/,
    "unlocking a secure store must resume a stopped Relay instead of leaving a false connecting state",
  );
  assert.match(
    source,
    /async function retryStartup\(\)[\s\S]*?refreshWithNativeListeners\(\)[\s\S]*?resumeRelayAfterStartupRecovery\(\)/,
  );
  assert.match(
    functionBody(source, "retryStartup"),
    /startupRetryInFlight[\s\S]*?renderStartupRetryBusy\(false\)[\s\S]*?moveFocus\(startupRetry\)/,
    "a repeated slow startup must keep one focusable retry owner",
  );
});

test("Relay reconnect state is visible and stays actionable", async () => {
  const [frontend, relay, i18n] = await Promise.all([
    read("../desktop/src/main.ts"),
    read("../desktop/src-tauri/src/relay.rs"),
    read("../desktop/src/i18n.ts"),
  ]);
  const renderRelay = functionBody(frontend, "renderRelay");

  assert.match(relay, /runtime\.phase = RelayPhase::Starting/);
  assert.match(
    relay,
    /runtime\.last_error = Some\(user_error\("relay_reconnecting"\)\)/,
    "native reconnect state should publish a stable localizable marker",
  );
  assert.match(i18n, /relayReconnectingError:[\s\S]*?Retrying automatically/);
  assert.match(
    relay,
    /Relayune Relay sync warning:[\s\S]*?mark_delivery_warning/,
    "delivery rejection should publish diagnostics without entering reconnect state",
  );
  assert.match(
    relay,
    /fn log_delivery_transition[\s\S]*?state\.log\(level,[\s\S]*?true/,
    "delivery diagnostics should not mutate Relay phase or last_error",
  );
  assert.match(i18n, /relaySyncDegradedDiagnostic:[\s\S]*?remains connected/);
  assert.match(
    renderRelay,
    /relay\.last_error/,
    "the desktop should surface reconnect detail published by the native relay",
  );
  assert.match(
    renderRelay,
    /relay\.phase === "starting"|relay\.phase !== "connected"/,
    "reconnecting must not be announced as an ordinary first-time start",
  );
  assert.match(frontend, /id="retry-relay"/);
  assert.match(frontend, /relayApi\s*\.start\(\)/);
  assert.match(
    relay,
    /sidecar\(SIDECAR_NAME\)[\s\S]*?mark_error\(app, state, generation, error\.clone\(\)\)/,
    "a missing sidecar must leave the native snapshot in an actionable error state",
  );
  assert.match(
    relay,
    /ensure_state_parent[\s\S]*?mark_error\(app, state, generation, error\.clone\(\)\)/,
    "state-path failures must not leave the UI stuck on Connecting",
  );
  assert.match(
    relay,
    /CommandEvent::Error\(_\)[\s\S]*?mark_process_event_error\(&app_handle, &state_handle, generation\)/,
    "a terminal child-wait error must leave Connecting/Connected even when Terminated never arrives",
  );
  assert.match(
    relay,
    /while let Some\(event\) = events\.recv\(\)\.await[\s\S]*?mark_process_stream_closed\(&app_handle, &state_handle, generation\)/,
    "a child event stream that closes without Error/Terminated must still leave Connecting/Connected",
  );
  const processWaitError = functionSource(
    relay,
    "mark_process_event_error_with_hook",
  );
  assert.match(
    processWaitError,
    /runtime\.generation != generation[\s\S]*?RelayPhase::Error \| RelayPhase::Stopping \| RelayPhase::Stopped[\s\S]*?runtime\.phase = RelayPhase::Error[\s\S]*?runtime\.last_error = Some\(user_error\("relay_start_failed"\)\)[\s\S]*?publish_state\(state\)/,
    "wait failures and event-stream closure must publish once without overtaking Error, Stop or a newer generation",
  );
  assert.doesNotMatch(
    processWaitError,
    /runtime\.(?:child|pid)\s*=\s*None/,
    "an uncertain wait failure must retain the real child/PID cleanup route",
  );
  assert.match(
    relay,
    /fn process_wait_error_becomes_actionable_without_losing_the_cleanup_pid[\s\S]*?recv_timeout\(Duration::from_secs\(1\)\)[\s\S]*?RelayPhase::Error[\s\S]*?pid, Some\(4_223\)[\s\S]*?RelayPhase::Stopping[\s\S]*?stale generation/,
    "the executable regression must prove publication, cleanup retention and generation ordering",
  );
  assert.match(
    relay,
    /fn process_stream_close_without_terminal_event_becomes_actionable_once[\s\S]*?recv_timeout\(Duration::from_secs\(1\)\)[\s\S]*?RelayPhase::Error[\s\S]*?pid, Some\(4_229\)[\s\S]*?must not republish an existing Error/,
    "the executable regression must prove stream-closure publication is timeout-bounded and idempotent",
  );
  for (const helperName of [
    "mark_connected_with_hook",
    "mark_reconnecting_with_hook",
  ]) {
    const helper = functionSource(relay, helperName);
    assert.match(
      helper,
      /runtime\.generation != generation[\s\S]*?RelayPhase::Stopping \| RelayPhase::Stopped[\s\S]*?return false/,
      `${helperName} must not overtake Stop/Quit or a newer Relay generation`,
    );
    assert.ok(
      helper.indexOf("state.log") < helper.indexOf("publish_state(state)"),
      `${helperName} must retain its admitted diagnostic before publishing once`,
    );
  }
  const outputStart = relay.indexOf("CommandEvent::Stdout(bytes)");
  const processOutputDispatch = relay.slice(
    outputStart,
    relay.indexOf("CommandEvent::Error(_)", outputStart),
  );
  assert.doesNotMatch(
    processOutputDispatch,
    /state_handle\.log|publish\(&app_handle/,
    "rejected or unrecognized sidecar output must not append a false current-generation diagnostic",
  );
  assert.match(
    relay,
    /fn late_process_progress_cannot_overtake_stop_or_a_new_generation[\s\S]*?RelayPhase::Stopping[\s\S]*?mark_connected_with_hook[\s\S]*?mark_reconnecting_with_hook[\s\S]*?publications, 0/,
    "the executable Rust probe must cover late connected and reconnecting output",
  );
});

test("first pairing does not wait for a perfect network before revealing recovery", async () => {
  const native = await read("../desktop/src-tauri/src/lib.rs");
  const completePairing = functionSource(native, "complete_pairing");
  const completeBrowserPairing = functionSource(native, "complete_browser_pairing");
  assert.match(
    completePairing,
    /let replacing_connected_device = old_device_token\.is_some\(\)/,
  );
  assert.match(
    completePairing,
    /if replacing_connected_device \{[\s\S]*?wait_for_relay_connected/,
    "only replacement of a still-usable device should block on Relay connectivity",
  );
  assert.match(
    completePairing,
    /else if old_presence\.device_token \|\| old_presence\.e2ee_key[\s\S]*?clear_device_credentials/,
    "successful repair should remove unreachable partial credentials",
  );
  for (const committedPairing of [completePairing, completeBrowserPairing]) {
    assert.match(
      committedPairing,
      /config::save\(&app, &next_config\)[\s\S]*?reconcile_durable_config_native_presentation\(&state, &next_config, true[\s\S]*?refresh_tray_status_locked/,
      "every durable pairing commit must invalidate a bootstrap that loaded the superseded enrollment before Relay work continues",
    );
  }
  assert.match(
    native,
    /fn successful_pairing_commit_invalidates_a_loaded_unpaired_bootstrap[\s\S]*?unpaired_loaded[\s\S]*?reconcile_durable_config_native_presentation[\s\S]*?release stale unpaired bootstrap[\s\S]*?stale_refreshes\.load\(Ordering::SeqCst\), 0[\s\S]*?https:\/\/paired\.example\.invalid[\s\S]*?state\.is_paired\(\)/,
    "the blocking regression must prove a successful pairing cannot be overwritten by a bootstrap that loaded the old unpaired identity",
  );
});

test("successful first pairing reveals Home before the auxiliary browser list finishes", async () => {
  const frontend = await read("../desktop/src/main.ts");
  const beginPairing = functionBody(frontend, "beginPairing");
  const completeInitial = beginPairing.indexOf("relayApi.completePairing");
  const completeAdditional = beginPairing.indexOf("relayApi.completeBrowserPairing");
  const revealHome = beginPairing.indexOf("resetPairingState()");
  const loadingState = beginPairing.indexOf("browserListLoading = true", revealHome);
  const renderHome = beginPairing.indexOf(
    "renderCommittedBootstrap(bootstrap)",
    loadingState,
  );
  const refreshBrowsers = beginPairing.indexOf(
    "void loadBrowserAuthorizations()",
    renderHome,
  );
  assert.ok(completeInitial >= 0 && completeAdditional >= 0);
  assert.ok(
    revealHome > completeInitial && revealHome > completeAdditional,
    "both credential-adoption paths must complete before Home is revealed",
  );
  assert.ok(
    loadingState > revealHome && renderHome > loadingState,
    "Home must render an explicit loading state rather than a false empty-browser row",
  );
  assert.ok(
    refreshBrowsers > renderHome,
    "the authoritative browser list must refresh in the background after Home is usable",
  );
  assert.doesNotMatch(beginPairing, /await loadBrowserAuthorizations\(\)/);
});

test("committed native mutations retire older bootstrap UI responses", async () => {
  const frontend = await read("../desktop/src/main.ts");
  const committedRender = functionBody(frontend, "renderCommittedBootstrap");

  assert.match(
    committedRender,
    /bootstrapRefreshGate\.invalidate\(\);\s*render\(value, options\)/,
    "an authoritative command result must invalidate any refresh that loaded the previous durable state",
  );
  for (const command of [
    "saveSettings",
    "completePairing",
    "completeBrowserPairing",
    "revokeBrowserAuthorization",
    "logout",
  ]) {
    assert.match(
      frontend,
      new RegExp(`relayApi\\.${command}[\\s\\S]*?renderCommittedBootstrap\\(`),
      `${command} must adopt its committed Bootstrap through the stale-refresh gate`,
    );
  }
});

test("an in-progress pairing survives transient network loss until its code expires", async () => {
  const [frontend, browserAccess, i18n] = await Promise.all([
    read("../desktop/src/main.ts"),
    read("../desktop/src/browser-access.ts"),
    read("../desktop/src/i18n.ts"),
  ]);
  const waitForBrowser = functionBody(frontend, "waitForBrowser");
  const waitForPairingNetwork = functionBody(frontend, "waitForPairingNetwork");
  const startInitialPairing = functionBody(frontend, "startInitialPairing");
  const expireCurrentPairing = functionBody(frontend, "expireCurrentPairing");

  assert.match(waitForBrowser, /pairingExpiresAtMs \|\| Date\.now\(\) \+ 10 \* 60_000/);
  assert.match(waitForBrowser, /while \(Date\.now\(\) < expiresAt\)/);
  assert.match(
    waitForBrowser,
    /PairingRequestError[\s\S]*?error\.retryable[\s\S]*?waitForPairingNetwork\(runId, signal\)/,
  );
  assert.match(waitForPairingNetwork, /pairingStage = "recovering"[\s\S]*?render\(bootstrap\)/);
  assert.match(waitForBrowser, /pairingStage === "recovering"[\s\S]*?pairingStage = "waiting"/);
  assert.doesNotMatch(
    waitForBrowser,
    /transientFailures|>=\s*4/,
    "a valid 10-minute pairing must not be discarded after a short fixed retry budget",
  );
  assert.match(browserAccess, /\| "recovering"/);
  assert.match(i18n, /pairingReconnecting:[\s\S]*?连接码仍然有效/);
  assert.match(i18n, /pairingReconnecting:[\s\S]*?code is still valid/);
  assert.match(frontend, /startPairingExpiry\(serverExpiresAt\)/);
  assert.match(frontend, /pairingExpiresIn/);
  assert.match(
    frontend,
    /function tickPairingExpiry[\s\S]*?pairingDeadlineExpired\(pairingExpiresAtMs\)[\s\S]*?expireCurrentPairing\(\)[\s\S]*?setInterval\(tickPairingExpiry, 1_000\)/,
    "an expired code must disappear without waiting for a stalled poll request",
  );
  assert.match(
    expireCurrentPairing,
    /pairingRunId \+= 1;[\s\S]*?resetPairingState\(\)[\s\S]*?showTranslatedToast\("pairingExpired"\)[\s\S]*?moveFocus/,
    "expiry must cancel the old run and restore a focused retry action",
  );
  assert.match(
    frontend,
    /const started = await startInitialPairing\([\s\S]*?startInput,[\s\S]*?runId,[\s\S]*?abortController\.signal,[\s\S]*?\);[\s\S]*?serverExpiresAt/,
    "the first-login timer should follow the server-provided expiry when available",
  );
  assert.match(startInitialPairing, /while \(Date\.now\(\) < recoveryDeadline\)/);
  assert.match(
    startInitialPairing,
    /error\.code === "pairing_exists"[\s\S]*?pairingRequest<PairingPublicState>[\s\S]*?existing\.initiator_share !== input\.initiator_share/,
    "a lost start response must resume only the exact public session created by this initiator",
  );
  assert.match(i18n, /pairingStartReconnecting:[\s\S]*?无需重新点击/);
  assert.match(i18n, /pairingStartReconnecting:[\s\S]*?automatically when it recovers/);
  assert.match(
    frontend,
    /const started = await relayApi\.startBrowserPairing\(\{ \.\.\.startInput, server_url: pairingServerUrl, expected_device_id: pairingDeviceId \}\);[\s\S]*?serverExpiresAt = started\.expires_at/,
    "additional-browser pairing should use the same server-owned deadline",
  );
  const pairingRequestStart = frontend.indexOf("async function pairingRequest<");
  const pairingRequestEnd = frontend.indexOf(
    "class PairingCancelledError",
    pairingRequestStart,
  );
  assert.notEqual(pairingRequestStart, -1);
  assert.notEqual(pairingRequestEnd, -1);
  const pairingRequest = frontend.slice(pairingRequestStart, pairingRequestEnd);
  assert.match(
    frontend,
    /function resetPairingState\(\) \{\s*pairingAbortController\?\.abort\(\)/,
    "cancelling first login should stop the in-flight request immediately",
  );
  assert.doesNotMatch(
    pairingRequest,
    /AbortSignal\.any/,
    "Safari 16 desktop WebViews need the local signal combiner",
  );
  assert.match(pairingRequest, /pairingServerErrorCode\(body\)/);
  assert.match(pairingRequest, /response\.status === 429 \|\| response\.status >= 500[\s\S]*?errorCode/);
  assert.match(pairingRequest, /pairing_expired[\s\S]*?"pairingExpired"/);
  assert.match(pairingRequest, /pairing_already_used[\s\S]*?"pairingUsed"/);
  assert.ok(
    pairingRequest.indexOf("await response.json()") <
      pairingRequest.indexOf("window.clearTimeout(timeoutId)"),
    "the pairing timeout must remain active while a response body is still streaming",
  );
  assert.match(
    pairingRequest,
    /response\.json\(\)\.catch\(\(error\)[\s\S]*?timeout\.signal\.aborted[\s\S]*?throw error/,
    "a body stall after headers must surface as a retryable timeout instead of a successful null payload",
  );
});

test("a browser launch failure keeps the valid pairing code and recovery actions", async () => {
  const frontend = await read("../desktop/src/main.ts");
  const beginPairing = functionBody(frontend, "beginPairing");

  assert.match(
    frontend,
    /id="login-open-pairing-page"[\s\S]{0,180}id="login-copy-pairing-link"/,
    "the first-login code surface needs both reopen and copy-link fallbacks",
  );
  assert.match(
    beginPairing,
    /await openCurrentPairingPage\(loginOpenPairingPageButton, false\);\s*ensurePairingRun\(runId\);[\s\S]*?const response = await waitForBrowser/,
    "failure to launch the default browser must continue waiting on the valid pairing session",
  );
  assert.match(
    functionBody(frontend, "canOpenCurrentPairingPage"),
    /browserPairingHandoffActionsEnabled\([\s\S]*?pairingStage[\s\S]*?Boolean\(activePairingId\)/,
    "the user should be able to retry opening the page while waiting or recovering",
  );
  assert.match(
    functionBody(frontend, "copyCurrentPairingLink"),
    /if \(!canOpenCurrentPairingPage\(\) \|\| pairingLinkCopyInFlight\) return;[\s\S]*?aria-busy[\s\S]*?copyingLink[\s\S]*?navigator\.clipboard\.writeText[\s\S]*?finally[\s\S]*?copyLink[\s\S]*?moveFocus\(button\)/,
    "the consumed one-time link must not remain copyable while credentials are being saved",
  );
  assert.match(
    frontend,
    /loginOpenPairingPageButton\.addEventListener\("click"[\s\S]*?openCurrentPairingPage\(loginOpenPairingPageButton\)/,
  );
  assert.match(
    functionBody(frontend, "openCurrentPairingPage"),
    /pairingPageOpenInFlight[\s\S]*?aria-busy[\s\S]*?aria-disabled[\s\S]*?relayApi\.openPairingPage\(activePairingId\)[\s\S]*?showDesktopErrorToast\(error, "open_web_failed"\)[\s\S]*?finally[\s\S]*?moveFocus\(button\)/,
    "opening the system browser must remain bounded and restore the initiating action when the pairing can still be retried",
  );
  assert.match(
    beginPairing,
    /moveFocus\([\s\S]*?openPairingPageButton[\s\S]*?loginOpenPairingPageButton/,
    "when the browser returns, keyboard focus should resume on the valid pairing actions",
  );
  assert.match(
    beginPairing,
    /renderCommittedBootstrap\(bootstrap\);[\s\S]{0,180}void loadBrowserAuthorizations\(\);[\s\S]{0,180}moveFocus\(statusCard\)/,
    "the background browser refresh must not interrupt focus moving to the connected status",
  );
});

test("closing and reopening the desktop preserves the background Relay", async () => {
  const [rust, relay, relayState] = await Promise.all([
    read("../desktop/src-tauri/src/lib.rs"),
    read("../desktop/src-tauri/src/relay.rs"),
    read("../desktop/src-tauri/src/state.rs"),
  ]);

  assert.match(
    rust,
    /WindowEvent::CloseRequested[\s\S]*?api\.prevent_close\(\)[\s\S]*?hide_main_window\(window\)/,
  );
  const hideWindow = functionSource(rust, "hide_main_window");
  assert.match(
    hideWindow,
    /window_hide_recovery_surface_is_active[\s\S]*?hide_main_window_with_hook[\s\S]*?window\.hide\(\)[\s\S]*?window_hide_recovery_surface_is_active[\s\S]*?restore_window_after_recovery_surface_loss\(window\.app_handle\(\), &state\)[\s\S]*?defer_native_entry[\s\S]*?publish_native_action_error[\s\S]*?window_failed/,
    "close must recheck the recovery surface while deferring publication away from the AppKit callback",
  );
  const postHideRestore = functionSource(
    rust,
    "restore_window_after_recovery_surface_loss",
  );
  assert.match(
    postHideRestore,
    /show_window\(app\)[\s\S]*?request_windowed_recovery_surface\(app, state\)/,
    "a failed post-hide window rescue must invalidate the vanished status item and request a read-back Regular recovery route",
  );
  const requestWindowedRecovery = functionSource(
    rust,
    "request_windowed_recovery_surface",
  );
  assert.match(
    requestWindowedRecovery,
    /set_window_hide_recovery_available\(false\)[\s\S]*?configure_windowed_recovery_app\(app\)[\s\S]*?schedule_runtime_windowed_recovery_confirmation\(app, state\)/,
    "runtime recovery must clear stale admission and read back Regular policy without publishing a misleading startup error",
  );
  const currentRecovery = functionSource(rust, "window_hide_recovery_surface_is_active");
  assert.match(
    currentRecovery,
    /window_hide_recovery_available\(\)[\s\S]*?macos_status_item_is_visible\(app\)[\s\S]*?macos_windowed_recovery_policy_is_active\(\)/,
    "close must revalidate the live status item and Regular policy rather than trusting a stale setup flag",
  );
  const nativeEntryRestore = functionSource(
    rust,
    "restore_window_from_native_entry",
  );
  assert.match(
    nativeEntryRestore,
    /restore_window_from_native_entry_with_hooks[\s\S]*?schedule_native_entry_recovery_check/,
    "a failed deferred Finder/Dock/single-instance restore must schedule its native-surface readback",
  );
  const scheduledNativeEntryRecovery = functionSource(
    rust,
    "schedule_native_entry_recovery_check",
  );
  assert.match(
    scheduledNativeEntryRecovery,
    /run_on_main_thread[\s\S]*?window_hide_recovery_surface_is_active[\s\S]*?request_windowed_recovery_surface/,
    "MainThreadMarker-gated status-item and activation-policy reads must run on the AppKit thread, not the deferred worker",
  );
  const visibleStatusItem = functionSource(rust, "macos_status_item_is_visible");
  assert.match(
    visibleStatusItem,
    /ns_status_item\(\)[\s\S]*?isVisible\(\)[\s\S]*?button\(main_thread\)\.is_some\(\)/,
  );
  const guardedHide = functionSource(rust, "hide_main_window_with_hook");
  assert.match(
    guardedHide,
    /if !recovery_surface_active[\s\S]*?report_error[\s\S]*?return;[\s\S]*?record_window_hide_result\(hide\(\),[\s\S]*?if recovery_surface_after_hide\(\)[\s\S]*?return;[\s\S]*?let _ = restore\(\);[\s\S]*?report_error/,
    "the last visible window must remain open when neither a status item nor a Regular-policy identity can restore it",
  );
  assert.match(
    rust,
    /fn close_restores_window_if_the_recovery_surface_disappears_during_hide[\s\S]*?hide_main_window_with_hook[\s\S]*?recovery_checks\.fetch_add[\s\S]*?restore_calls\.fetch_add[\s\S]*?restore_calls\.load\(Ordering::SeqCst\), 1[\s\S]*?window_failed/,
    "the executable regression must reproduce and rescue the status-item loss race",
  );
  assert.match(
    rust,
    /fn failed_post_hide_restore_requests_a_second_os_recovery_surface[\s\S]*?Err::<\(\), _>\(user_error\("window_failed"\)\)[\s\S]*?windowed_recovery_requests\.load\(Ordering::SeqCst\), 1/,
    "the executable regression must prove a failed immediate rescue asks the OS for a second recovery surface",
  );
  const hideResult = functionSource(rust, "record_window_hide_result");
  assert.match(
    hideResult,
    /if result\.is_err\(\)[\s\S]*?report_error\(\)/,
    "a failed close-to-menu-bar transition must invoke its deadlock-safe diagnostic reporter",
  );
  assert.match(rust, /RunEvent::Reopen[\s\S]*?defer_native_entry[\s\S]*?restore_window_from_native_entry\(&app\)/);
  assert.match(
    rust,
    /fn show_window[\s\S]*?window\s*\.show\(\)[\s\S]*?window\.set_focus\(\)/,
  );
  assert.match(
    rust,
    /"quit"[\s\S]*?process_transition_with_hooks\([\s\S]*?relay::stop_for_exit\(&state\)[\s\S]*?app\.exit\(0\)[\s\S]*?publish_native_action_error/,
    "menu Quit must claim the shared exit gate before stopping Relay",
  );
  const processExitTransition = functionSource(
    rust,
    "process_transition_with_hooks",
  );
  assert.match(
    processExitTransition,
    /exit_stop_ready[\s\S]*?relay_stop_failed[\s\S]*?begin_exit_stop[\s\S]*?stop_relay[\s\S]*?complete_exit_stop[\s\S]*?transition[\s\S]*?cancel_exit_stop[\s\S]*?publish_failure/,
    "a completed owner must reject a possibly different transition, while the sole in-flight owner gates Start and controls its transition",
  );
  assert.match(
    relayState,
    /fn begin_exit_stop[\s\S]*?compare_exchange\(false, true[\s\S]*?exit_stop_ready\(\)[\s\S]*?exit_stop_in_flight[\s\S]*?store\(false/,
    "a contender arriving between ready publication and in-flight release must relinquish ownership without clearing ready",
  );
  const relayStart = functionSource(relay, "start_with_config_change_admission");
  const reserveRelayStart = functionSource(relay, "reserve_start_generation");
  assert.match(
    relayStart,
    /exit_stop_requested\(\)[\s\S]*?return Err[\s\S]*?start_reserved\(app, state, generation\)/,
    "a known Quit must reject Start before any secure-store read",
  );
  assert.doesNotMatch(relayStart, /state\.config\(\)|secrets::/);
  assert.match(functionSource(relay, "start_reserved"), /state\.config\(\)[\s\S]*?secrets::presence_for_browsers/);
  assert.match(
    reserveRelayStart,
    /runtime[\s\S]*?\.lock\(\)[\s\S]*?exit_stop_requested\(\)/,
    "Start must recheck a racing Quit while it owns runtime admission",
  );
  assert.match(
    relay,
    /fn exit_gate_rejects_a_start_already_waiting_for_the_runtime_lock[\s\S]*?begin_exit_stop\(\)[\s\S]*?drop\(runtime_guard\)[\s\S]*?relay_start_failed[\s\S]*?cancel_exit_stop[\s\S]*?Start retry should remain available/,
    "the blocking regression must prove an older Start cannot cross a newer Quit gate",
  );
  assert.match(
    rust,
    /RunEvent::ExitRequested \{ code, api, \.\. \}[\s\S]*?code\.is_none\(\)[\s\S]*?defer_interactive_exit_stop\(app_handle, &state, &api\)/,
    "an interactive OS Quit must leave the native event loop before stopping the sidecar",
  );
  const interactiveExit = functionSource(
    rust,
    "defer_interactive_exit_stop_with_hooks",
  );
  assert.match(
    interactiveExit,
    /prevent_exit\(\)[\s\S]*?exit_stop_ready[\s\S]*?begin_exit_stop[\s\S]*?dispatch[\s\S]*?stop_relay[\s\S]*?complete_exit_stop[\s\S]*?resume_exit[\s\S]*?cancel_exit_stop[\s\S]*?publish_failure/,
    "every interactive OS Quit must be prevented while the chosen deferred transition is pending; only its worker may resume after success",
  );
  assert.match(
    rust,
    /fn interactive_os_quit_returns_before_sidecar_stop_and_deduplicates_reentry[\s\S]*?recv_timeout\(Duration::from_millis\(100\)\)[\s\S]*?release_tx[\s\S]*?exit_stop_ready/,
    "the executable regression must hold sidecar stop while the native Quit callback returns",
  );
  assert.match(
    rust,
    /fn native_callbacks_never_wait_on_the_tray_publication_mutex[\s\S]*?tray_update[\s\S]*?defer_native_entry[\s\S]*?returned_rx[\s\S]*?RecvTimeoutError::Timeout[\s\S]*?drop\(publication_guard\)/,
    "the executable regression must prove native callbacks return while serialized AppKit publication is blocked",
  );
});

test("native presentation IPC never blocks the Tauri event loop on tray publication", async () => {
  const rust = await read("../desktop/src-tauri/src/lib.rs");
  for (const command of [
    "get_bootstrap",
    "stop_relay",
    "clear_secret",
    "set_ui_language",
    "set_update_available",
  ]) {
    assert.match(
      rust,
      new RegExp(
        `(?:#\\[tauri::command\\(async\\)\\]\\s*fn ${command}\\b|#\\[tauri::command\\]\\s*async fn ${command}\\b)`,
      ),
      `${command} must leave the IPC event loop before secure-store, process, or native-presentation work`,
    );
  }
  const processPlugin = rust.slice(
    rust.indexOf("mod safe_process_plugin"),
    rust.indexOf("fn configure_menu_bar_app"),
  );
  assert.match(
    processPlugin,
    /#\[tauri::command\(async\)\]\s*fn exit[\s\S]*?#\[tauri::command\(async\)\]\s*fn restart/,
    "updater exit/restart must not synchronously wait for Relay stop or diagnostic publication",
  );
  assert.match(
    rust,
    /fn native_presentation_ipc_returns_to_the_event_loop_before_waiting_on_tray_update[\s\S]*?InvokeRequest[\s\S]*?native_presentation_ipc_probe[\s\S]*?returned_rx[\s\S]*?RecvTimeoutError::Timeout[\s\S]*?drop\(publication_guard\)/,
    "MockRuntime must prove the IPC dispatcher returns before the tray transaction completes",
  );
});

test("Relay Retry cleans up an uncertain failed process before starting again", async () => {
  const relay = await read("../desktop/src-tauri/src/relay.rs");
  const stop = functionSource(relay, "stop");
  const start = functionSource(relay, "start_with_config_change_admission");
  const reservedStop = functionSource(relay, "stop_reserved_target_with_hooks");
  const takeTarget = functionSource(relay, "take_stop_target");
  const reserveStart = functionSource(relay, "reserve_start_generation");
  const recoverStart = functionSource(
    relay,
    "reserve_start_with_failed_runtime_recovery",
  );

  assert.match(
    start,
    /reserve_start_with_failed_runtime_recovery[\s\S]*?kill_relay_child[\s\S]*?kill_relay_pid/,
    "the production Retry path must use both native cleanup routes before spawning again",
  );

  assert.match(
    stop,
    /stop_with_hooks[\s\S]*?kill_relay_child[\s\S]*?kill_relay_pid/,
    "normal Stop must retain a PID termination path after consuming the child handle",
  );
  assert.match(
    reservedStop,
    /kill_child\(child\)\.or_else\(\|_\| kill_pid\(pid\)\)[\s\S]*?runtime\.phase = RelayPhase::Error[\s\S]*?runtime\.last_error = Some\(user_error\("relay_stop_failed"\)\)[\s\S]*?state\.log\(LogLevel::Error, "relayune:relay_stop_failed"\)[\s\S]*?publish_state\(state\)/,
    "exhausting both termination routes must publish Needs attention and a stable Stop failure",
  );
  assert.match(
    takeTarget,
    /last_error\.as_deref\(\) != Some\("relayune:relay_stop_failed"\)[\s\S]*?StopTarget::Pid\(pid\)/,
    "only a completed failed Stop may claim the retained PID; concurrent Stops must not race it",
  );
  assert.match(
    reserveStart,
    /RelayPhase::Error[\s\S]*?runtime\.child\.take\(\)[\s\S]*?CleanupFailedRuntime\(StopTarget::Child[\s\S]*?runtime\.pid[\s\S]*?CleanupFailedRuntime\(StopTarget::Pid\(pid\)\)/,
    "Error admission must atomically claim either retained cleanup handle before another Start can race it",
  );
  assert.match(
    recoverStart,
    /loop[\s\S]*?StartAdmission::Reserved\(generation\)[\s\S]*?CleanupFailedRuntime\(target\)[\s\S]*?stop_reserved_target_with_hooks/,
    "the same user Retry must loop through cleanup until it can reserve a replacement generation",
  );
  assert.match(
    relay,
    /fn retry_after_process_wait_error_cleans_up_before_reserving_a_new_generation[\s\S]*?recv_timeout\(Duration::from_secs\(1\)\)[\s\S]*?killed, vec!\[4_223\][\s\S]*?RelayPhase::Starting/,
    "the executable regression must prove one Retry kills the old PID and advances to a new Starting generation without deadlock",
  );
});

test("Relay startup preflight failures publish an actionable native state", async () => {
  const relay = await read("../desktop/src-tauri/src/relay.rs");
  const rust = await read("../desktop/src-tauri/src/lib.rs");
  const start = functionSource(relay, "start_with_config_change_admission");
  const reservedStart = functionSource(relay, "start_reserved");
  const presentFailure = functionSource(
    relay,
    "record_start_preflight_result_with_hook",
  );

  assert.match(
    start,
    /reserve_start_with_failed_runtime_recovery[\s\S]*?start_reserved\(app, state, generation\)/,
    "Start must reserve a cancellable generation before config and secure-store preflight, then present any admitted failure",
  );
  assert.match(
    reservedStart,
    /commit_reserved_start_with_hook\(state, generation[\s\S]*?relayune:relay_starting[\s\S]*?let preparation[\s\S]*?presence_for_browsers[\s\S]*?record_start_preflight_result_with_hook\(state, generation/,
    "the shared reserved Start must recheck cancellation before preflight and present admitted failures",
  );
  assert.match(
    presentFailure,
    /exit_stop_requested[\s\S]*?runtime\.generation != generation[\s\S]*?!matches!\(&runtime\.phase, RelayPhase::Starting\)[\s\S]*?runtime\.phase = RelayPhase::Error[\s\S]*?runtime\.last_error = Some\(error\.clone\(\)\)[\s\S]*?state\.log[\s\S]*?publish_state/,
    "only the still-current uncommitted generation may turn a preflight failure into Error and publish it",
  );
  assert.match(
    rust,
    /tauri::async_runtime::spawn\(async move \{[\s\S]*?let _ = relay::start\(&app_handle, &state_handle\)\.await;[\s\S]*?\}\);/,
    "startup must rely on Relay's single failure transaction instead of duplicating its diagnostic publication",
  );
  assert.match(
    relay,
    /fn preflight_failure_is_actionable_without_downgrading_an_active_relay[\s\S]*?RelayPhase::Error[\s\S]*?relay_credentials_missing[\s\S]*?RelayPhase::Connected[\s\S]*?active_publications, 0[\s\S]*?Stop should cancel preflight admission[\s\S]*?cancelled_publications, 0/,
    "the executable regression must cover idle failure recovery, an active Relay, and Stop cancellation of slow preflight",
  );
});

test("a failed native Quit presents Needs attention and remains PID-retryable", async () => {
  const relay = await read("../desktop/src-tauri/src/relay.rs");
  const exitStop = functionSource(relay, "stop_exit_target_with_hooks");

  assert.match(
    exitStop,
    /kill_child\(child\)\.or_else\(\|_\| kill_pid\(pid\)\)[\s\S]*?runtime\.pid\.is_none\(\)[\s\S]*?runtime\.phase = RelayPhase::Error[\s\S]*?runtime\.last_error = Some\(user_error\("relay_stop_failed"\)\)/,
    "after a blocked Quit the native status must leave Stopping and expose Needs attention",
  );
  assert.match(
    relay,
    /fn exit_stop_failure_preserves_pid_for_a_recoverable_retry[\s\S]*?snapshot\.phase, RelayPhase::Error[\s\S]*?take_exit_stop_target\(&state\)[\s\S]*?retry_target\.pid, Some\(4_220\)[\s\S]*?RelayPhase::Stopped/,
    "the executable regression must prove the retained PID is claimed by a later Quit and cleared on success",
  );
});

test("macOS Stop and Quit confirm the sidecar PID is gone before succeeding", async () => {
  const relay = await read("../desktop/src-tauri/src/relay.rs");
  const killChild = functionSource(relay, "kill_relay_child");
  const killPid = functionSource(relay, "kill_relay_pid");
  const confirmExit = functionSource(relay, "confirm_process_exit_with_hooks");

  assert.match(
    killChild,
    /child\.pid\(\)[\s\S]*?child[\s\S]*?\.kill\(\)[\s\S]*?confirm_macos_relay_process_exit\(pid\)/,
    "a successful CommandChild kill must still wait for the macOS PID to disappear",
  );
  assert.match(
    killPid,
    /\/bin\/kill[\s\S]*?-KILL[\s\S]*?!matches!\(status, Ok\(status\) if status\.success\(\)\)[\s\S]*?confirm_macos_relay_process_exit\(pid\)/,
    "the retained-PID fallback must not equate successful signal delivery with process exit",
  );
  assert.match(
    confirmExit,
    /PROCESS_EXIT_CONFIRM_ATTEMPTS[\s\S]*?process_is_running\(\)\?[\s\S]*?wait_before_retry\(\)[\s\S]*?relay_stop_failed/,
    "process disappearance confirmation must be bounded and fail closed with the stable Stop error",
  );
  assert.match(
    relay,
    /fn process_exit_confirmation_waits_until_the_pid_disappears[\s\S]*?checks, 3[\s\S]*?waits, 2[\s\S]*?fn process_exit_confirmation_fails_closed_after_the_bound[\s\S]*?PROCESS_EXIT_CONFIRM_ATTEMPTS - 1/,
    "pure Rust regressions must cover delayed exit and a PID that remains alive through the bound",
  );
});

test("Stop, Quit, and updater relaunch cannot miss an in-flight Relay spawn", async () => {
  const relay = await read("../desktop/src-tauri/src/relay.rs");
  const start = functionSource(relay, "start_with_config_change_admission");
  const reservedStart = functionSource(relay, "start_reserved");
  const commit = functionSource(relay, "commit_reserved_start_with_hook");
  const cancel = functionSource(relay, "cancel_uncommitted_start");
  const stopWithHooks = functionSource(relay, "stop_with_hooks");
  const normalStop = functionSource(relay, "take_stop_target");
  const exitStop = functionSource(relay, "take_exit_stop_target");

  assert.match(
    reservedStart,
    /commit_reserved_start_with_hook\(state, generation,[\s\S]*?command\.spawn\(\)[\s\S]*?runtime\.pid = Some\(pid\)[\s\S]*?runtime\.child = Some\(child\)/,
    "generation admission, native spawn, and child/PID publication must share one runtime critical section",
  );
  assert.match(start, /reserve_start_with_failed_runtime_recovery[\s\S]*?start_reserved\(app, state, generation\)/);
  assert.match(
    commit,
    /runtime\.generation != generation[\s\S]*?RelayPhase::Starting[\s\S]*?commit\(&mut runtime\)/,
    "a cancelled Start must be rejected before its native spawn hook can run",
  );
  assert.match(
    cancel,
    /RelayPhase::Starting[\s\S]*?runtime\.child\.is_some\(\)[\s\S]*?runtime\.pid\.is_some\(\)[\s\S]*?generation\.wrapping_add\(1\)[\s\S]*?RelayPhase::Stopped/,
    "Stop and Exit must invalidate a reserved but not-yet-spawned generation",
  );
  assert.match(normalStop, /cancel_uncommitted_start\(&mut runtime\)[\s\S]*?return Ok\(None\)/);
  assert.match(
    stopWithHooks,
    /let Some\(target\) = target else[\s\S]*?publish_state\(state\)[\s\S]*?return Ok\(state\.snapshot\(\)\)/,
    "cancelling Starting must refresh NSMenu, AX, and Web instead of leaving native status stale",
  );
  assert.match(
    exitStop,
    /cancel_uncommitted_start\(&mut runtime\)[\s\S]*?child: None,[\s\S]*?pid: None/,
  );
  assert.match(
    relay,
    /fn stop_and_exit_cancel_an_uncommitted_start_before_spawn[\s\S]*?StartCommitError::Cancelled[\s\S]*?commit_calls, 0/,
    "the executable regression must prove cancellation never enters the spawn hook",
  );
  assert.match(
    relay,
    /fn exit_waits_for_start_commit_and_claims_the_spawned_pid[\s\S]*?recv_timeout\(Duration::from_millis\(100\)\)\.is_err\(\)[\s\S]*?Some\(4_222\)/,
    "the concurrency regression must prove Quit blocks until an already-running spawn publishes its PID",
  );
});

test("macOS menu-bar mode has a single source-level window recovery path", async () => {
  const [
    rust,
    relay,
    nativeState,
    cargo,
    infoPlist,
    config,
    macAxProbe,
    workspaceAccess,
    frontend,
    desktopApi,
  ] = await Promise.all([
    read("../desktop/src-tauri/src/lib.rs"),
    read("../desktop/src-tauri/src/relay.rs"),
    read("../desktop/src-tauri/src/state.rs"),
    read("../desktop/src-tauri/Cargo.toml"),
    read("../desktop/src-tauri/Info.plist"),
    read("../desktop/src-tauri/tauri.conf.json").then(JSON.parse),
    read("../desktop/src-tauri/tests/macos_menu_ax_probe.rs"),
    read("../desktop/src-tauri/src/workspace_access.rs"),
    read("../desktop/src/main.ts"),
    read("../desktop/src/api.ts"),
  ]);
  const mainWindow = config.app.windows.find((window) => window.label === "main");
  const localizedPermissionPrompts = await Promise.all(
    ["en", "zh-Hans", "hi", "es", "ar", "fr", "bn", "pt", "id", "ur"].map(
      (locale) => read(`../desktop/src-tauri/resources/${locale}.lproj/InfoPlist.strings`),
    ),
  );
  assert.ok(mainWindow, "the main desktop window must be declared");
  assert.equal(
    mainWindow.visible,
    false,
    "native setup should decide whether a normal or background launch shows the window",
  );

  assert.match(
    rust,
    /#\[cfg\(target_os = "macos"\)\]\s*fn configure_menu_bar_app[\s\S]*?ActivationPolicy::Accessory/,
    "macOS must run as a menu-bar accessory instead of permanently occupying Dock/Cmd-Tab",
  );
  assert.match(
    infoPlist,
    /<key>LSUIElement<\/key>\s*<true\s*\/>/,
    "the packaged app must start without a transient Dock/Cmd-Tab presence before Rust setup",
  );
  assert.match(infoPlist, /<key>NSAppleEventsUsageDescription<\/key>/);
  const folderUsageDescriptionKeys = [
    "NSDesktopFolderUsageDescription",
    "NSDocumentsFolderUsageDescription",
    "NSDownloadsFolderUsageDescription",
    "NSNetworkVolumesUsageDescription",
    "NSRemovableVolumesUsageDescription",
    "NSFileProviderDomainUsageDescription",
  ];
  for (const key of folderUsageDescriptionKeys) {
    assert.match(
      infoPlist,
      new RegExp(`<key>${key}<\\/key>\\s*<string>.+<\\/string>`, "u"),
    );
  }
  assert.deepEqual(config.bundle.resources, { "resources/": "" });
  for (const prompt of localizedPermissionPrompts) {
    assert.match(prompt, /"NSAppleEventsUsageDescription"\s*=\s*".+";/u);
    for (const key of folderUsageDescriptionKeys) {
      assert.match(prompt, new RegExp(`"${key}"\\s*=\\s*".+";`, "u"));
    }
  }
  const nonWindowsAutostart = functionSource(
    rust,
    "set_non_windows_launch_at_login_with_hooks",
  );
  assert.match(
    rust,
    /#\[cfg\(not\(target_os = "windows"\)\)\]\s*fn set_launch_at_login[\s\S]*?set_non_windows_launch_at_login_with_hooks\([\s\S]*?autolaunch\(\)\.enable\(\)[\s\S]*?autolaunch\(\)\.disable\(\)[\s\S]*?autolaunch\(\)\.is_enabled\(\)/,
    "macOS LaunchAgent writes must use the readback and rollback transaction",
  );
  assert.match(
    nonWindowsAutostart,
    /if enable\(\)\.is_err\(\)[\s\S]*?let _ = disable\(\)[\s\S]*?return Err\(user_error\("autostart_failed"\)\)[\s\S]*?matches!\(is_enabled\(\), Ok\(actual\) if actual == enabled\)[\s\S]*?let _ = disable\(\)[\s\S]*?Err\(user_error\("autostart_failed"\)\)/,
    "a partial enable or unreadable/mismatched LaunchAgent readback must fail closed to disabled",
  );
  assert.match(
    rust,
    /fn macos_autostart_enable_rolls_back_every_partial_commit[\s\S]*?Ok\(false\)[\s\S]*?Err\(\(\)\)[\s\S]*?disable_calls\.load\(Ordering::SeqCst\), 1[\s\S]*?fn macos_autostart_disable_is_idempotent_and_retries_an_uncommitted_state[\s\S]*?assert_eq!\(result, Ok\(false\)\)[\s\S]*?disable_calls\.load\(Ordering::SeqCst\), 2/,
    "executable hook regressions must cover partial enable rollback and idempotent disable readback",
  );
  const setup = rust.slice(rust.indexOf(".setup(move |app|"), rust.indexOf(".on_window_event"));
  assert.match(
    workspaceAccess,
    /fn startup_probe_paths\(document_dir: Option<PathBuf>\)[\s\S]*?document_dir\.into_iter\(\)\.collect\(\)/,
    "post-login folder preflight must request only the macOS Documents directory",
  );
  assert.match(
    workspaceAccess,
    /fn startup_requests_only_documents_access\(\)[\s\S]*?startup_probe_paths\(Some\(PathBuf::from\("\/Users\/relay\/Documents"\)\)\)[\s\S]*?fn missing_documents_path_does_not_fall_back_to_another_folder\(\)[\s\S]*?startup_probe_paths\(None\)\.is_empty\(\)/,
    "executable regressions must keep Documents as the only automatic privacy request and fail closed when it is unavailable",
  );
  assert.match(
    workspaceAccess,
    /fs::read_dir\(path\)[\s\S]*?entries\.next\(\)\.transpose\(\)/,
    "folder preflight must perform a real directory enumeration so macOS can display its privacy prompt",
  );
  assert.match(
    functionSource(rust, "preflight_workspace_access"),
    /spawn_blocking[\s\S]*?workspace_access::preflight[\s\S]*?workspace_invalid/,
    "folder prompts must not block the Tauri event thread and denials must remain path-free diagnostics",
  );
  const requestWorkspaceAccess = functionSource(rust, "request_workspace_access");
  assert.match(
    requestWorkspaceAccess,
    /config\.account_email\.is_none\(\)[\s\S]*?!presence\.device_token[\s\S]*?workspace_access_paths[\s\S]*?preflight_workspace_access/,
    "the native folder request must reject calls made before a durable macOS account login",
  );
  assert.doesNotMatch(
    setup,
    /workspace_access_paths|preflight_workspace_access|workspace_access::preflight/,
    "launching Relayune must not trigger a macOS folder prompt before the user sees an explanation",
  );
  assert.match(
    setup,
    /if behavior\.start_relay[\s\S]*?if state_handle\.is_paired\(\)[\s\S]*?relay::start/,
    "an already-authorized Relay must still start without coupling startup to a privacy prompt",
  );
  assert.match(
    frontend,
    /id="workspace-access-dialog"[\s\S]*?data-i18n="folderAccessReason"[\s\S]*?data-i18n="folderAccessDetail"[\s\S]*?id="workspace-access-later"[\s\S]*?id="workspace-access-continue"/,
    "the app must explain the folder purpose and preserve a Later choice before invoking macOS",
  );
  const desktopLogin = functionBody(frontend, "beginDesktopLogin");
  assert.match(
    desktopLogin,
    /await relayApi\.completeDesktopLogin[\s\S]*?renderCommittedBootstrap\(bootstrap\)[\s\S]*?moveFocus\(accountCard\)/,
    "committed login must lead to the home action without interrupting it for folder access",
  );
  assert.doesNotMatch(
    desktopLogin,
    /offerWorkspaceAccessAfterDesktopLogin|openWorkspaceAccess\(|requestWorkspaceAccess\(|openDialog\(workspaceAccessDialog\)/,
    "account login alone must not open the folder explanation or request native folder access",
  );
  assert.match(frontend, /id="prepare-task-files"[\s\S]*?data-i18n="folderAccessEyebrow"/);
  assert.match(
    frontend,
    /prepareTaskFiles\.addEventListener\("click", \(\) => \{[\s\S]*?if \(minimalInstalled\) void requestWorkspaceAccess\(\);[\s\S]*?else openWorkspaceAccess\(\)/,
    "the inline folder-permission entry must remain explicitly actionable",
  );
  assert.match(
    functionBody(frontend, "openWorkspaceAccess"),
    /bootstrap\.platform\.os !== "macos"[\s\S]*?!signedIn\(bootstrap\)[\s\S]*?openDialog\(workspaceAccessDialog\)/,
    "the explanation must remain gated to a signed-in Mac",
  );
  assert.match(
    functionBody(frontend, "requestWorkspaceAccess"),
    /folderAccessRequestInFlight[\s\S]*?relayApi\.requestWorkspaceAccess\(\)/,
    "the macOS request must run only from the explicit dialog action with duplicate-call protection",
  );
  assert.match(
    frontend,
    /workspaceAccessContinue\.addEventListener\("click"[\s\S]*?requestWorkspaceAccess\(\)/,
    "showing the explanation alone must not invoke the native folder request",
  );
  assert.match(
    desktopApi,
    /requestWorkspaceAccess:[\s\S]*?invokeDesktop<boolean>\("request_workspace_access", "workspace_invalid"\)/,
    "the webview needs a typed path to the gated native folder request",
  );
  assert.ok(
    setup.indexOf("configure_menu_bar_app") < setup.indexOf("setup_tray"),
    "the activation policy must be set before the menu-bar item and window are exposed",
  );
  assert.match(
    setup,
    /record_startup_window_restore_result\(&state, show_window\(app\.handle\(\)\)\)/,
    "a transient initial focus failure must preserve the already-created recovery menu",
  );
  assert.doesNotMatch(
    setup,
    /show_window\(app\.handle\(\)\)\.map_err[\s\S]{0,100}\?/,
    "initial focus failure must not abort Tauri setup",
  );
  assert.match(
    setup,
    /let \(native_menu_created, initial_accessibility_ready\) =[\s\S]*?match setup_tray\(app,[\s\S]*?Ok\(accessibility_ready\) => \(true, accessibility_ready\)[\s\S]*?let native_menu_visible =[\s\S]*?macos_status_item_is_visible\(app\.handle\(\)\)[\s\S]*?record_native_menu_visibility_result\([\s\S]*?native_menu_recovery_available\(native_menu_visible, initial_accessibility_ready\)/,
    "a built tray object must not admit a hidden Accessory launch until AppKit confirms both visibility and initial AX readiness",
  );
  assert.match(
    rust,
    /fn built_but_invisible_native_menu_forces_windowed_startup_recovery[\s\S]*?record_native_menu_visibility_result\(&state, true, false\)[\s\S]*?startup_failed[\s\S]*?startup_behavior\(true,[\s\S]*?show_main_window/,
    "the executable regression must force a background launch onto its visible window fallback",
  );
  assert.match(
    setup,
    /let windowed_recovery_requested = if !native_menu_available[\s\S]*?configure_windowed_recovery_app\(app\.handle\(\)\)[\s\S]*?set_window_hide_recovery_available\(has_window_hide_recovery_surface\([\s\S]*?native_menu_available,[\s\S]*?false[\s\S]*?if windowed_recovery_requested[\s\S]*?schedule_windowed_recovery_confirmation/,
    "a queued Regular fallback must not enable close-to-background before AppKit readback",
  );
  const scheduleRecoveryConfirmation = functionSource(
    rust,
    "schedule_windowed_recovery_confirmation",
  );
  const readWindowedPolicy = functionSource(
    rust,
    "macos_windowed_recovery_policy_is_active",
  );
  const recordRecoveryConfirmation = functionSource(
    rust,
    "record_windowed_recovery_policy_confirmation",
  );
  assert.match(
    scheduleRecoveryConfirmation,
    /run_on_main_thread[\s\S]*?record_windowed_recovery_policy_confirmation[\s\S]*?macos_windowed_recovery_policy_is_active/,
    "Regular policy confirmation must run after Tauri applies its queued activation-policy message",
  );
  assert.match(
    readWindowedPolicy,
    /NSApplication::sharedApplication[\s\S]*?activationPolicy\(\)[\s\S]*?NSApplicationActivationPolicy::Regular/,
    "the fallback must read the real AppKit policy instead of trusting the setter dispatch",
  );
  assert.match(
    recordRecoveryConfirmation,
    /merge_window_hide_recovery_available\(confirmed\)[\s\S]*?if !recovery_available[\s\S]*?report_error/,
    "a failed readback must keep the last window non-hideable and report only when no independently repaired menu exists",
  );
  assert.match(
    scheduleRecoveryConfirmation,
    /run_on_main_thread[\s\S]*?record_windowed_recovery_policy_confirmation[\s\S]*?defer_native_entry[\s\S]*?startup_failed/,
    "a failed main-thread policy readback must publish only after leaving the AppKit callback",
  );
  assert.match(
    macAxProbe,
    /NSApplication::sharedApplication[\s\S]*?activationPolicy\(\)/,
    "the AppKit probe must execute the concrete activation-policy getter used by fallback readback",
  );
  assert.match(
    macAxProbe,
    /status_item\.setVisible\(false\)[\s\S]*?assert!\(!status_item\.isVisible\(\)\)[\s\S]*?status_item\.setVisible\(true\)[\s\S]*?assert!\(status_item\.isVisible\(\)\)/,
    "the AppKit probe must distinguish a retained but invisible status item",
  );
  const startupWindowResult = functionSource(
    rust,
    "record_startup_window_restore_result",
  );
  assert.match(startupWindowResult, /if let Err\(error\)[\s\S]*?state\.log/);
  assert.match(
    rust,
    /"open_settings"\s*=>\s*\{[\s\S]{0,160}?show_window\(app\)/,
    "the menu-bar Show action must use the shared restore path",
  );
  assert.match(
    rust,
    /fn show_window[\s\S]*?unminimize\(\)[\s\S]*?show\(\)[\s\S]*?set_focus\(\)/,
    "restoring must unminimize, reveal, and focus the existing window",
  );
  assert.match(
    rust,
    /WindowEvent::CloseRequested[\s\S]*?prevent_close\(\)[\s\S]*?hide_main_window\(window\)/,
    "the red close button must hide rather than terminate the background Relay",
  );
  const hideWindow = functionSource(rust, "hide_main_window");
  assert.match(
    hideWindow,
    /window_hide_recovery_surface_is_active[\s\S]*?hide_main_window_with_hook[\s\S]*?window\.hide\(\)[\s\S]*?window_hide_recovery_surface_is_active[\s\S]*?restore_window_after_recovery_surface_loss/,
    "native hide failures must remain resident and become diagnosable",
  );
  const guardedHide = functionSource(rust, "hide_main_window_with_hook");
  assert.match(
    guardedHide,
    /if !recovery_surface_active[\s\S]*?report_error[\s\S]*?return;[\s\S]*?record_window_hide_result[\s\S]*?recovery_surface_after_hide\(\)[\s\S]*?restore\(\)[\s\S]*?report_error/,
    "a double failure of the status item and Regular-policy fallback must keep the last window visible",
  );
  assert.match(
    rust,
    /fn close_keeps_last_window_visible_when_both_native_recovery_surfaces_fail[\s\S]*?set_window_hide_recovery_available\(true\)[\s\S]*?stale setup admission must not hide[\s\S]*?assert_eq!\(hide_calls\.load\(Ordering::SeqCst\), 1\)/,
    "the executable regression must prove stale-admission refusal and the normal hide path",
  );
  assert.match(
    rust,
    /RunEvent::Reopen[\s\S]*?defer_native_entry[\s\S]*?restore_window_from_native_entry\(&app\)/,
    "a macOS reopen event must recover the same window",
  );
  assert.match(
    relay,
    /pub fn publish[\s\S]*?crate::publish_relay_snapshot\(app, state\)/,
    "every Relay publication must update the native menu even while the window is hidden",
  );
  const refreshTrayStatus = functionSource(rust, "refresh_tray_status");
  const refreshTrayStatusLocked = functionSource(rust, "refresh_tray_status_locked");
  const refreshTraySnapshot = functionSource(
    rust,
    "refresh_tray_status_for_snapshot_locked",
  );
  const publishRelaySnapshot = functionSource(rust, "publish_relay_snapshot");
  const publishRelayTransaction = functionSource(
    rust,
    "publish_relay_snapshot_with_hooks",
  );
  const publishRelayRetry = functionSource(
    rust,
    "publish_relay_snapshot_with_retry_hooks",
  );
  const lockTrayUpdate = functionSource(rust, "lock_tray_update");
  const lockTrayItems = functionSource(rust, "lock_tray_items");
  const trayItemsSnapshot = functionSource(rust, "tray_items_snapshot");
  const initialTrayTransaction = functionSource(
    rust,
    "initialize_tray_presentation_with_hook",
  );
  const setupTrayTransaction = functionSource(rust, "setup_tray");
  assert.match(
    lockTrayUpdate,
    /Err\(poisoned\)[\s\S]*?poisoned\.into_inner\(\)[\s\S]*?tray_update\.clear_poison\(\)[\s\S]*?state\.log[\s\S]*?language_failed/,
    "the unit-only native publication gate must recover after a backend unwind and retain a stable diagnostic",
  );
  const productionRust = rust.slice(0, rust.indexOf("#[cfg(test)]"));
  assert.doesNotMatch(
    productionRust.replace(lockTrayUpdate, ""),
    /tray_update\s*\.lock\(/,
    "every production native presentation transaction must use the poison-recovering gate",
  );
  assert.match(
    lockTrayItems,
    /Err\(poisoned\)[\s\S]*?poisoned\.into_inner\(\)[\s\S]*?tray_items\.clear_poison\(\)/,
    "the menu-handle container must recover after a backend unwind",
  );
  assert.doesNotMatch(
    productionRust.replace(lockTrayItems, ""),
    /tray_items\s*\.lock\(/,
    "production menu-handle access must use the poison-recovering helper",
  );
  assert.match(
    trayItemsSnapshot,
    /lock_tray_items\(state\)[\s\S]*?\.as_ref\(\)[\s\S]*?\.cloned\(\)/,
    "native setters must use cloned handles after releasing the registry lock",
  );
  assert.match(
    initialTrayTransaction,
    /lock_tray_update\(state\)[\s\S]*?initialize\(\)/,
    "initial status-item publication must share the runtime presentation gate",
  );
  assert.match(
    setupTrayTransaction,
    /initialize_tray_presentation_with_hook\(state,[\s\S]*?tray\.build\(app\)[\s\S]*?lock_tray_items\(state\)[\s\S]*?record_initial_tray_accessibility_result/,
    "the callback must not become reachable before item registration and initial AX setup are serialized",
  );
  for (const refresh of [
    refreshTraySnapshot,
    functionSource(rust, "refresh_tray_language_locked"),
  ]) {
    assert.match(
      refresh,
      /tray_items_snapshot\(state\)/,
      "every AppKit-backed item refresh must snapshot recoverable handles before backend work",
    );
  }
  assert.match(
    rust,
    /fn poisoned_tray_item_handles_recover_after_backend_unwind[\s\S]*?tray_items\.is_poisoned\(\)[\s\S]*?lock_tray_items[\s\S]*?recv_timeout\(Duration::from_millis\(100\)\)[\s\S]*?recovered tray item lock did not remain serialized[\s\S]*?count\(\),[\s\S]*?1/,
    "the blocking regression must prove inner menu handles recover without losing serialization or duplicating diagnostics",
  );
  assert.match(
    rust,
    /fn initial_tray_setup_serializes_early_callbacks_and_releases_after_failure[\s\S]*?setup_entered_rx[\s\S]*?RecvTimeoutError::Timeout[\s\S]*?deferred callback did not resume after tray setup[\s\S]*?a native build failure must remain a setup failure[\s\S]*?failed setup retained the publication gate/,
    "the blocking regression must prove early callbacks wait for setup and setup errors release the gate",
  );
  const publishNativeAction = functionSource(
    rust,
    "publish_native_action_error",
  );
  assert.match(
    refreshTrayStatus,
    /tray_update[\s\S]*?refresh_tray_status_locked\(app, state\)/,
  );
  assert.match(
    publishRelaySnapshot,
    /publish_relay_snapshot_with_retry_hooks[\s\S]*?refresh_tray_status_for_snapshot_locked[\s\S]*?app\.emit\("relay-status", snapshot\)/,
  );
  assert.match(
    publishRelayTransaction,
    /tray_update[\s\S]*?let snapshot = state\.snapshot\(\)[\s\S]*?refresh\(&snapshot\)[\s\S]*?emit\(snapshot\)/,
    "native presentation and WebView event must serialize and use one snapshot",
  );
  assert.match(
    rust,
    /fn poisoned_native_presentation_gate_recovers_and_remains_serialized[\s\S]*?is_poisoned\(\)[\s\S]*?language_failed[\s\S]*?recv_timeout\(Duration::from_millis\(100\)\)[\s\S]*?update refresh did not resume[\s\S]*?count\(\),[\s\S]*?1/,
    "the blocking regression must prove poison recovery repairs the gate without losing serialization",
  );
  assert.match(
    publishRelayRetry,
    /publish_relay_snapshot_with_hooks[\s\S]*?let Err\(error\) = first[\s\S]*?state\.log[\s\S]*?publish_relay_snapshot_with_hooks/,
    "a native presentation failure must become diagnostic and retry from a fresh serialized snapshot",
  );
  assert.match(
    publishNativeAction,
    /publish_native_action_error_with_refresh_hooks[\s\S]*?refresh_tray_status_for_snapshot_locked[\s\S]*?app\.emit\("relay-status", snapshot\)[\s\S]*?if refresh_result\.is_err\(\)[\s\S]*?refresh_tray_status\(app, state\)/,
    "a failed native Quit must refresh NSMenu, tooltip and AX before publishing the same Error snapshot",
  );
  assert.match(
    rust,
    /fn failed_native_relay_refresh_is_diagnostic_and_retried_with_latest_snapshot[\s\S]*?refresh_attempts\.len\(\), 2[\s\S]*?language_failed[\s\S]*?to_string\(&emitted\[1\]\)[\s\S]*?to_string\(&refresh_attempts\[1\]\)/,
    "the executable regression must prove that native retry and Web publication converge",
  );
  assert.match(
    rust,
    /fn repeated_native_relay_refresh_failure_still_emits_its_diagnostic[\s\S]*?refresh_count, 2[\s\S]*?emitted\.len\(\), 2[\s\S]*?language_failed/,
    "a repeated AppKit failure must still reach the Web diagnostics surface",
  );
  assert.match(
    rust,
    /fn failed_native_quit_refreshes_menu_and_web_from_the_same_error_snapshot[\s\S]*?recv_timeout\(Duration::from_secs\(1\)\)[\s\S]*?RelayPhase::Error[\s\S]*?relay_stop_failed[\s\S]*?to_string\(&web\)[\s\S]*?to_string\(&native\)/,
    "the executable regression must prove a failed Quit cannot leave the native status stale",
  );
  assert.match(
    refreshTrayStatusLocked,
    /snapshot[\s\S]*?refresh_tray_status_for_snapshot_locked/,
  );
  assert.match(
    refreshTraySnapshot,
    /tray_presentation_phase\(state\.recovery_required\(\), &snapshot\.phase\)[\s\S]*?\.set_text\(tray_menu_status\(language, &presentation_phase\)\)[\s\S]*?tray_presentation_tooltip[\s\S]*?set_macos_tray_accessibility[\s\S]*?tray_presentation_accessibility_label/,
    "status text, tooltip and VoiceOver label must be one serialized presentation update",
  );
  assert.match(cargo, /target_os = "macos"[\s\S]*?objc2-app-kit[\s\S]*?NSAccessibilityProtocols/);
  const macAccessibility = functionSource(rust, "set_macos_tray_accessibility");
  assert.match(macAccessibility, /with_inner_tray_icon/);
  assert.match(macAccessibility, /ns_status_item\(\)[\s\S]*?button\(main_thread\)/);
  assert.match(macAccessibility, /setAccessibilityLabel/);
  assert.match(macAccessibility, /setAccessibilityHelp/);
  assert.match(macAccessibility, /RelayuneMenuBarItem/);
  assert.match(
    macAccessibility,
    /status_item\.isVisible\(\)[\s\S]*?record_native_menu_accessibility_refresh_result\(state, result\)/,
    "a later AX refresh may restore close-to-menu admission only after the concrete status item is visible and readable",
  );
  assert.match(
    macAccessibility,
    /accessibilityLabel\(\)[\s\S]*?value\.to_string\(\) == label/,
    "the concrete status-bar button must read back the localized VoiceOver label",
  );
  assert.match(
    macAccessibility,
    /accessibilityHelp\(\)[\s\S]*?value\.to_string\(\) == help/,
  );
  assert.match(
    macAccessibility,
    /accessibilityIdentifier\(\)[\s\S]*?value\.to_string\(\) == identifier/,
  );
  assert.match(cargo, /name = "macos_menu_ax_probe"[\s\S]*?harness = false/);
  assert.match(
    macAxProbe,
    /NSStatusBar::systemStatusBar\(\)[\s\S]*?statusItemWithLength[\s\S]*?Relayune, Not connected[\s\S]*?Relayune，已连接/,
    "the executable main-thread probe must exercise both localized status-item labels",
  );
  assert.match(macAxProbe, /accessibilityLabel\(\)[\s\S]*?accessibilityHelp\(\)/);
  assert.match(macAxProbe, /setToolTip[\s\S]*?toolTip\(\)/);
  assert.match(
    macAxProbe,
    /Relayune · Not connected · Update available[\s\S]*?Relayune, Not connected, Update available/,
  );
  assert.match(
    macAxProbe,
    /Relayune · 已连接 · 有更新[\s\S]*?Relayune，已连接，有更新/,
  );
  assert.match(
    macAxProbe,
    /NSMenu::new\(main_thread\)[\s\S]*?status_item\.setMenu\(Some\(&menu\)\)/,
    "the executable probe must attach a real AppKit menu to the status item",
  );
  assert.match(macAxProbe, /status_item\.isVisible\(\)/);
  assert.match(macAxProbe, /menu\.numberOfItems\(\), 6/);
  assert.match(
    macAxProbe,
    /Status: Not connected[\s\S]*?Connect This Computer…[\s\S]*?Open Web Workspace[\s\S]*?Check for Updates…[\s\S]*?false/,
  );
  assert.match(
    macAxProbe,
    /Status: Not connected[\s\S]*?Install Update…[\s\S]*?false/,
  );
  assert.match(
    macAxProbe,
    /Status: Needs attention[\s\S]*?Show Relayune[\s\S]*?Open Web Workspace[\s\S]*?Check for Updates…[\s\S]*?false/,
    "config recovery must expose Show while keeping an unverified Web workspace disabled",
  );
  assert.match(
    macAxProbe,
    /状态：已连接[\s\S]*?显示 Relayune[\s\S]*?打开 Web 工作台[\s\S]*?检查更新…[\s\S]*?true/,
  );
  assert.match(
    macAxProbe,
    /状态：已连接[\s\S]*?安装更新…[\s\S]*?true/,
  );
  assert.match(macAxProbe, /web_action\.isEnabled\(\), web_enabled/);
  assert.match(macAxProbe, /update_action\.isEnabled\(\)/);
  assert.match(
    macAxProbe,
    /update_action[\s\S]*?accessibilityLabel\(\)[\s\S]*?Some\(update_text\.into\(\)\)/,
  );
  assert.match(macAxProbe, /status_item\.setMenu\(None\)/);
  assert.match(macAxProbe, /removeStatusItem\(&status_item\)/);
  const setupTray = functionSource(rust, "setup_tray");
  assert.match(
    setupTray,
    /let accessibility_ready = record_initial_tray_accessibility_result[\s\S]*?set_macos_tray_accessibility[\s\S]*?Ok\(accessibility_ready\)/,
    "an initial AX readback failure must be returned as recovery admission without aborting Tauri setup",
  );
  assert.doesNotMatch(
    setupTray,
    /set_macos_tray_accessibility[\s\S]{0,200}(?:map_err[^;]*)?\?\s*;/,
    "initial AX readback must remain diagnostic instead of failing setup",
  );
  const initialAxResult = functionSource(rust, "record_initial_tray_accessibility_result");
  assert.match(
    initialAxResult,
    /Ok\(\(\)\) => true[\s\S]*?Err\(error\)[\s\S]*?state\.log[\s\S]*?false/,
    "failed initial VoiceOver readback must remain nonfatal but reject status-item-only recovery",
  );
  const repairedAxResult = functionSource(
    rust,
    "record_native_menu_accessibility_refresh_result",
  );
  assert.match(
    repairedAxResult,
    /result\.is_ok\(\)[\s\S]*?set_window_hide_recovery_available\(true\)/,
    "a later successful visible AX readback must make the repaired status item usable for close-to-menu again",
  );
  const regularConfirmation = functionSource(
    rust,
    "record_windowed_recovery_policy_confirmation",
  );
  assert.match(
    regularConfirmation,
    /merge_window_hide_recovery_available\(confirmed\)[\s\S]*?if !recovery_available/,
    "a late failed Regular fallback readback must not erase a separately repaired native menu",
  );
  assert.match(
    nativeState,
    /fn merge_window_hide_recovery_available[\s\S]*?\*current \|= available[\s\S]*?\*current/,
    "native-menu repair and delayed Regular readback must merge under one lock without a read/write race",
  );
  assert.match(
    rust,
    /fn initial_ax_readback_failure_forces_visible_windowed_recovery[\s\S]*?native_menu_recovery_available\(true, false\)[\s\S]*?show_main_window: true[\s\S]*?start_relay: false[\s\S]*?native_menu_recovery_available\(true, true\)/,
    "the executable regression must prove a credential-less background launch stays visible after AX failure",
  );
  assert.match(
    rust,
    /fn successful_ax_retry_readmits_close_to_menu_after_initial_failure[\s\S]*?record_initial_tray_accessibility_result[\s\S]*?record_native_menu_accessibility_refresh_result[\s\S]*?validated_window_hide_recovery_surface\(true, true, false\)[\s\S]*?record_windowed_recovery_policy_confirmation\(&state, false[\s\S]*?fallback_errors\.load\(Ordering::SeqCst\), 0/,
    "the Rust regression must prove AX recovery survives the no-longer-needed Regular fallback readback",
  );
});

test("macOS menu bar distinguishes first login from a paired Relay that is stopped", async () => {
  const [rust, relay, state, frontend] = await Promise.all([
    read("../desktop/src-tauri/src/lib.rs"),
    read("../desktop/src-tauri/src/relay.rs"),
    read("../desktop/src-tauri/src/state.rs"),
    read("../desktop/src/main.ts"),
  ]);
  const setupTray = functionSource(rust, "setup_tray");
  const refreshTrayStatus = functionSource(
    rust,
    "refresh_tray_status_for_snapshot_locked",
  );
  const refreshTrayLanguage = functionSource(rust, "refresh_tray_language_locked");
  const presentationTooltip = functionSource(rust, "tray_presentation_tooltip");
  const presentationLabel = functionSource(
    rust,
    "tray_presentation_accessibility_label",
  );
  const presentationPhase = functionSource(rust, "tray_presentation_phase");
  assert.match(functionSource(rust, "tray_menu_status"), /tray_status_text\(language, phase\)\.trim_start_matches/,
    "the compact menu must preserve status semantics while removing only the label prefix");

  assert.match(
    setupTray,
    /tray_connection_available\(state\)[\s\S]*?tray_not_connected_status_text\(language\)[\s\S]*?tray_presentation_tooltip[\s\S]*?tray_presentation_accessibility_label/,
    "an unpaired cold start must not describe itself as a user-stopped Relay",
  );
  for (const refresh of [refreshTrayStatus, refreshTrayLanguage]) {
    assert.match(refresh, /tray_connection_available\(state\)/);
    assert.match(
      refresh,
      /tray_presentation_phase\(state\.recovery_required\(\), &snapshot\.phase\)[\s\S]*?tray_menu_status\(language, &presentation_phase\)/,
      "every later native refresh must preserve Needs attention while recovery remains required",
    );
    assert.match(
      refresh,
      /open[\s\S]*?set_text\(TrayCopy::for_language\(language\)\.show_app\)/,
      "the native primary action must remain localized in the same serialized update as pairing status",
    );
    assert.doesNotMatch(refresh, /open_web/, "the compact tray must not restore the removed Web action");
    assert.match(
      refresh,
      /update[\s\S]*?set_text\(tray_update_action_text\(language, update_available\)\)/,
      "language, connection, and update availability must share one native presentation update",
    );
    assert.match(refresh, /tray_not_connected_status_text\(language\)/);
    assert.match(refresh, /tray_presentation_tooltip/);
    assert.match(refresh, /tray_presentation_accessibility_label/);
    assert.doesNotMatch(
      refresh,
      /presence_for_browsers|secrets::/,
      "high-frequency Relay publications must not decrypt the secret vault",
    );
  }
  assert.match(
    presentationPhase,
    /if recovery_required[\s\S]*?RelayPhase::Error[\s\S]*?phase\.clone\(\)/,
    "a secure-store/config recovery surface must never be rewritten as a merely stopped Relay",
  );
  assert.match(
    rust,
    /fn unreadable_vault_keeps_a_known_device_on_the_recovery_path[\s\S]*?for runtime_phase in[\s\S]*?tray_presentation_phase[\s\S]*?Status: Needs attention[\s\S]*?Relayune · 需要处理[\s\S]*?Relayune, Needs attention/,
    "the executable regression must cover status, tooltip and AX copy across every runtime phase",
  );
  assert.match(
    presentationTooltip,
    /tray_tooltip\(language, phase\)[\s\S]*?tray_not_connected_tooltip\(language\)[\s\S]*?update_available/,
  );
  assert.match(
    presentationLabel,
    /tray_accessibility_label\(language, phase\)[\s\S]*?tray_not_connected_accessibility_label\(language\)[\s\S]*?update_available/,
  );
  assert.match(
    setupTray,
    /with_id\([\s\S]*?"check_updates"[\s\S]*?tray_update_action_text\(language, update_available\)/,
    "update discovery must have a dedicated always-enabled native action",
  );
  const setUpdateAvailable = functionSource(
    rust,
    "set_update_available_with_refresh",
  );
  assert.match(
    setUpdateAvailable,
    /if previous == available\s*\{[\s\S]*?return refresh\(\)\.map_err/,
    "an idempotent update signal must reconcile a native menu or AX presentation left stale by a failed rollback",
  );
  const connectionAvailable = functionSource(rust, "tray_connection_available");
  const webWorkspaceAvailable = functionSource(
    rust,
    "tray_web_workspace_available",
  );
  assert.match(
    connectionAvailable,
    /state\.is_paired\(\)[\s\S]*?state\.recovery_required\(\)/,
  );
  assert.match(webWorkspaceAvailable, /state\.is_paired\(\)/);
  assert.doesNotMatch(webWorkspaceAvailable, /recovery_required/);
  assert.doesNotMatch(connectionAvailable, /presence_for_browsers|secrets::/);
  assert.match(state, /pub paired: Mutex<bool>/);
  assert.match(state, /pub fn is_paired[\s\S]*?paired\.lock/);
  assert.match(state, /pub recovery_required: Mutex<bool>/);
  assert.match(state, /pub fn recovery_required[\s\S]*?recovery_required[\s\S]*?lock/);
  const startupPresentation = functionSource(rust, "startup_native_presentation");
  assert.match(
    startupPresentation,
    /if config_access_failed[\s\S]*?connection_available: false[\s\S]*?recovery_required: true[\s\S]*?RelayPhase::Error/,
    "an unreadable durable config must expose attention and Show without pretending Web is authorized",
  );
  assert.match(
    startupPresentation,
    /else if credential_access_failed[\s\S]*?connection_available: !config\.browser_ids\.is_empty\(\)[\s\S]*?recovery_required: true[\s\S]*?RelayPhase::Error/,
    "a temporarily unreadable vault must never turn current or legacy credentials into first-time onboarding",
  );
  assert.match(
    rust,
    /config_access_failed = startup_error\.is_some\(\)[\s\S]*?startup_native_presentation[\s\S]*?config_access_failed[\s\S]*?AppState::new\(config, startup_presentation\.connection_available\)[\s\S]*?set_recovery_required\(startup_presentation\.recovery_required\)[\s\S]*?setup_tray\(app, &state, startup_presentation\.phase\)/,
  );
  assert.match(
    rust,
    /if config_access_failed[\s\S]*?SecretPresence::default\(\), None[\s\S]*?else[\s\S]*?presence_for_browsers/,
    "a random fallback identity must never trigger a pointless secure-store lookup",
  );
  const bootstrap = functionSource(rust, "bootstrap");
  const reconcileBootstrapNative = functionSource(
    rust,
    "reconcile_bootstrap_native_presentation",
  );
  const beginBootstrapRequest = functionSource(
    state,
    "begin_bootstrap_request",
  );
  assert.match(state, /bootstrap_generation: AtomicU64/);
  assert.match(beginBootstrapRequest, /fetch_add\(1, Ordering::SeqCst\)/);
  assert.match(
    bootstrap,
    /let request_generation = state\.begin_bootstrap_request\(\)[\s\S]*?config::load_or_create\(app\)[\s\S]*?presence_for_browsers/,
    "each native bootstrap must claim latest-wins admission before its slow config and secure-store reads",
  );
  assert.match(
    bootstrap,
    /reconcile_bootstrap_native_presentation[\s\S]*?request_generation[\s\S]*?config\.clone\(\)[\s\S]*?Some\(secrets\.device_token && secrets\.e2ee_key\)[\s\S]*?refresh_tray_language_locked\(app, state, state\.ui_language\(\)\)/,
    "a successful retry must atomically restore durable config, locale, every menu title, and enrollment state",
  );
  assert.match(
    bootstrap,
    /Err\(error\)[\s\S]*?reconcile_bootstrap_native_presentation[\s\S]*?config,[\s\S]*?None,[\s\S]*?refresh_tray_language_locked\(app, state, state\.ui_language\(\)\)/,
    "config recovery must retranslate Diagnostics and Quit even while secure storage remains unreadable",
  );
  assert.match(
    reconcileBootstrapNative,
    /lock_tray_update\(state\)[\s\S]*?bootstrap_request_is_current\(request_generation\)[\s\S]*?set_config\(config\)[\s\S]*?set_ui_language\(language\)[\s\S]*?if let Some\(paired\)[\s\S]*?set_paired\(paired\)[\s\S]*?set_recovery_required\(false\)[\s\S]*?refresh\(\)[\s\S]*?state\.log[\s\S]*?return refresh\(\)/,
    "only the current request may atomically commit durable locale, paired/recovery state, menu enabled state, tooltip and AX",
  );
  assert.ok(
    (reconcileBootstrapNative.match(/bootstrap_request_is_current\(request_generation\)/g) ?? [])
      .length >= 4,
    "stale admission must be rechecked after tray lock acquisition and before a native refresh retry",
  );
  assert.match(
    rust,
    /fn bootstrap_secure_store_commit_is_atomic_with_native_publication[\s\S]*?recv_timeout\(Duration::from_millis\(100\)\)[\s\S]*?UiLanguage::English[\s\S]*?Some\("en"\.into\(\)\), false, false[\s\S]*?post-bootstrap publication should succeed/,
    "the concurrency regression must prove Relay publication cannot observe a hybrid locale/recovery state",
  );
  assert.match(
    rust,
    /fn bootstrap_config_recovery_restores_native_language_while_credentials_remain_unreadable[\s\S]*?Some\("en"\.into\(\)\)[\s\S]*?None[\s\S]*?UiLanguage::English[\s\S]*?Help & Diagnostics[\s\S]*?Quit Relayune[\s\S]*?state\.is_paired\(\)[\s\S]*?state\.recovery_required\(\)/,
    "a recovered durable config must restore every NSMenu title, tooltip, and AX language even while secure storage remains locked",
  );
  assert.match(
    rust,
    /fn bootstrap_no_entry_commit_survives_repeated_native_refresh_failure[\s\S]*?refresh_count, 2[\s\S]*?!state\.is_paired[\s\S]*?!state\.recovery_required[\s\S]*?language_failed/,
    "a confirmed NoEntry state must survive AppKit failure and remain diagnostic",
  );
  assert.match(
    rust,
    /fn stale_bootstrap_completion_cannot_overwrite_the_latest_native_presentation[\s\S]*?old_generation = state\.begin_bootstrap_request\(\)[\s\S]*?old_read_started[\s\S]*?latest_generation = state\.begin_bootstrap_request\(\)[\s\S]*?latest bootstrap was serialized behind the blocked old read[\s\S]*?release stale bootstrap completion[\s\S]*?old_refresh_count\.load\(Ordering::SeqCst\), 0[\s\S]*?https:\/\/latest\.example\.invalid[\s\S]*?UiLanguage::English[\s\S]*?!state\.is_paired\(\)[\s\S]*?state\.recovery_required\(\)/,
    "the blocking dual-request regression must prove a newer English/config result commits while the old read is blocked and the stale completion cannot refresh or overwrite native state",
  );
  const knownPresenceBootstrap = functionSource(
    rust,
    "bootstrap_with_known_presence",
  );
  const reconcileKnownPresence = functionSource(
    rust,
    "reconcile_known_credential_presence",
  );
  const reconcilePairingRollback = functionSource(
    rust,
    "reconcile_pairing_rollback_native_presentation",
  );
  const reconcileDurableConfig = functionSource(
    rust,
    "reconcile_durable_config_native_presentation",
  );
  const rollbackBrowserPairing = functionSource(rust, "rollback_browser_pairing");
  const rollbackPairing = functionSource(rust, "rollback_pairing");
  const saveSettings = functionSource(rust, "save_settings");
  assert.match(
    knownPresenceBootstrap,
    /reconcile_known_credential_presence[\s\S]*?refresh_tray_status_locked[\s\S]*?Bootstrap/,
    "a committed pairing, browser authorization or sign-out must reconcile the native recovery gate before returning its Web surface",
  );
  assert.match(
    reconcileKnownPresence,
    /invalidate_bootstrap_requests\(\)[\s\S]*?tray_update[\s\S]*?set_paired\(secrets\.device_token && secrets\.e2ee_key\)[\s\S]*?set_recovery_required\(false\)[\s\S]*?refresh\(\)[\s\S]*?state\.log[\s\S]*?return refresh\(\)/,
    "known credential presence must clear recovery and update native action availability through one serialized transaction",
  );
  assert.match(
    saveSettings,
    /let old_config = state\.config\(\)[\s\S]*?let mut next_config = input\.config[\s\S]*?next_config\.ui_language = old_config\.ui_language\.clone\(\)[\s\S]*?config::save\(&app, &next_config\)[\s\S]*?let device_changed = old_config\.device_id != next_config\.device_id[\s\S]*?let next_paired = old_paired && !device_changed[\s\S]*?reconcile_durable_config_native_presentation\([\s\S]*?&next_config[\s\S]*?next_paired[\s\S]*?refresh_tray_status_locked[\s\S]*?config::save\(&app, &old_config\)\.is_ok\(\)[\s\S]*?reconcile_durable_config_native_presentation\([\s\S]*?&old_config[\s\S]*?old_paired[\s\S]*?refresh_tray_status_locked/,
    "both a durable settings commit and its durable rollback must atomically update config, enrollment and native presentation",
  );
  assert.doesNotMatch(
    saveSettings,
    /state\.(?:set_config|set_paired|invalidate_bootstrap_requests)/,
    "save_settings must not bypass the shared durable native commit gate",
  );
  assert.match(
    state,
    /relay_config_change_in_flight: AtomicBool[\s\S]*?begin_relay_config_change[\s\S]*?finish_relay_config_change[\s\S]*?relay_config_change_in_flight/,
    "the synchronous Start admission path must see a whole-config settings transaction",
  );
  assert.match(
    saveSettings,
    /RelayConfigChangeGuard::begin\(&state\)[\s\S]*?runtime_requires_restart_for_config_change\(&state\)[\s\S]*?relay::stop\(&app, &state\)[\s\S]*?config::save\(&app, &next_config\)[\s\S]*?start_during_config_change/,
    "settings must block unowned Starts before inspecting a PID-less Starting generation, then replace it inside the owned transaction",
  );
  const reserveStart = functionSource(relay, "reserve_start_generation");
  assert.match(
    reserveStart,
    /relay_config_change_in_flight\(\)[\s\S]*?!owns_config_change[\s\S]*?owns_config_change && !state\.relay_config_change_in_flight\(\)/,
    "Start must recheck settings ownership while holding the runtime generation lock",
  );
  assert.match(
    relay,
    /fn config_change_rejects_waiting_start_and_replaces_an_owned_preflight[\s\S]*?recv_timeout\(Duration::from_secs\(1\)\)[\s\S]*?runtime_requires_restart_for_config_change[\s\S]*?settings should cancel the owned old-config preflight[\s\S]*?replacement_generation, old_generation/,
    "the blocking Rust regression must prove a waiting unowned Start is rejected and an old-config preflight is replaced",
  );
  assert.match(
    reconcileDurableConfig,
    /invalidate_bootstrap_requests\(\)[\s\S]*?lock_tray_update\(state\)[\s\S]*?set_config\(config\.clone\(\)\)[\s\S]*?set_paired\(paired\)[\s\S]*?refresh\(\)[\s\S]*?state\.log[\s\S]*?return refresh\(\)/,
    "every durable async config result must stale superseded bootstraps and atomically restore menu, tooltip and AX state",
  );
  assert.match(
    reconcilePairingRollback,
    /reconcile_durable_config_native_presentation\(state, old_config, old_paired, refresh\)/,
    "pairing rollbacks must retain the shared durable native commit gate",
  );
  for (const rollback of [rollbackBrowserPairing, rollbackPairing]) {
    assert.match(
      rollback,
      /config::save\(app, old_config\)[\s\S]*?reconcile_pairing_rollback_native_presentation[\s\S]*?refresh_tray_status_locked[\s\S]*?presentation_result/,
      "both initial and additional-browser rollback paths must use the same native commit gate after durable save",
    );
  }
  assert.match(
    rust,
    /fn settings_device_change_commit_is_atomic_with_native_publication[\s\S]*?recv_timeout\(Duration::from_millis\(100\)\)[\s\S]*?dev_new0123456789abcdef0123456789[\s\S]*?false,[\s\S]*?false,[\s\S]*?false/,
    "the blocking settings regression must prove Relay publication waits and then sees only the new unpaired native state",
  );
  assert.match(
    rust,
    /fn failed_pairing_rollback_invalidates_a_temporary_paired_bootstrap[\s\S]*?temporary_loaded[\s\S]*?reconcile_pairing_rollback_native_presentation[\s\S]*?release stale temporary pairing bootstrap[\s\S]*?stale_refreshes\.load\(Ordering::SeqCst\), 0[\s\S]*?https:\/\/old\.example\.invalid[\s\S]*?!state\.is_paired\(\)/,
    "the blocking regression must prove an abandoned paired bootstrap cannot recommit after the old identity is restored",
  );
  assert.doesNotMatch(
    reconcileKnownPresence,
    /state\.config\(\)|set_config|set_ui_language/,
    "a paired or signed-out commit must not replay a stale config snapshot over a concurrent durable language switch",
  );
  assert.match(
    rust,
    /fn committed_credential_transitions_clear_stale_native_recovery_state[\s\S]*?state\.set_recovery_required\(true\)[\s\S]*?!state\.recovery_required\(\)[\s\S]*?must not retain Needs attention/,
    "the Rust regression must reproduce and clear the stale recovery presentation for paired and signed-out commits",
  );
  assert.match(
    rust,
    /fn known_presence_reconciliation_preserves_the_durable_locale_commit[\s\S]*?Some\("zh-CN"\.into\(\)\)[\s\S]*?UiLanguage::SimplifiedChinese[\s\S]*?!state\.recovery_required\(\)/,
    "the native regression must preserve the durable locale while committing known credential presence",
  );
  assert.match(
    rust,
    /reconcile_durable_config_native_presentation\(&state, &next_config, true/,
  );
  assert.match(
    rust,
    /reconcile_durable_config_native_presentation\(&state, &cleared, false/,
  );
  assert.match(rust, /status_prefix:\s*"状态："[\s\S]*?not_connected:\s*"尚未连接"/);
  assert.match(rust, /status_prefix:\s*"Status: "[\s\S]*?not_connected:\s*"Not connected"/);
  assert.match(rust, /accessibility_separator:\s*"，"/);
  assert.match(rust, /accessibility_separator:\s*", "/);

  const logout = functionSource(rust, "logout");
  const clearSecret = functionSource(rust, "clear_secret");
  const reconcileClearedSecret = functionSource(
    rust,
    "reconcile_cleared_secret_native_presentation",
  );
  const revokeBrowser = functionSource(rust, "revoke_browser_authorization");
  const revokeHandler = frontend.slice(
    frontend.indexOf('confirmRevokeBrowser.addEventListener("click"'),
    frontend.indexOf('retryRelay.addEventListener("click"'),
  );
  assert.match(
    logout,
    /config::save\(&app, &cleared\)[\s\S]*?revoke_current_device[\s\S]*?reconcile_durable_config_native_presentation[\s\S]*?&cleared[\s\S]*?false[\s\S]*?refresh_tray_status_locked[\s\S]*?clear_device_credentials[\s\S]*?signed_out_bootstrap/,
    "successful logout must durably rotate identity, invalidate stale signed-in bootstraps and keep cleanup failure off the signed-in surface",
  );
  assert.match(
    logout,
    /if config::save\(&app, &current\)\.is_ok\(\)[\s\S]*?reconcile_durable_config_native_presentation[\s\S]*?&current[\s\S]*?old_paired[\s\S]*?refresh_tray_status_locked[\s\S]*?else \{[\s\S]*?reconcile_durable_config_native_presentation[\s\S]*?&cleared[\s\S]*?false[\s\S]*?refresh_tray_status_locked/,
    "either durable outcome of a failed remote logout must invalidate the opposite bootstrap result before returning",
  );
  assert.match(
    rust,
    /fn failed_logout_rollback_invalidates_a_temporary_signed_out_bootstrap[\s\S]*?signed_out_loaded[\s\S]*?reconcile_durable_config_native_presentation[\s\S]*?release stale temporary signed-out bootstrap[\s\S]*?stale_refreshes\.load\(Ordering::SeqCst\), 0[\s\S]*?https:\/\/signed-in\.example\.invalid[\s\S]*?state\.is_paired\(\)/,
    "the blocking regression must prove a failed logout cannot be overwritten by its temporary signed-out bootstrap",
  );
  assert.match(
    rust,
    /fn successful_logout_commit_invalidates_a_loaded_signed_in_bootstrap[\s\S]*?signed_in_loaded[\s\S]*?reconcile_durable_config_native_presentation[\s\S]*?release stale signed-in bootstrap[\s\S]*?stale_refreshes\.load\(Ordering::SeqCst\), 0[\s\S]*?https:\/\/signed-out\.example\.invalid[\s\S]*?!state\.is_paired\(\)/,
    "the blocking regression must prove a successful logout cannot be overwritten by a bootstrap that loaded the revoked identity",
  );
  assert.match(
    clearSecret,
    /secrets::clear[\s\S]*?reconcile_cleared_secret_native_presentation[\s\S]*?refresh_tray_status_locked[\s\S]*?bootstrap/,
    "an irreversible local credential clear must reconcile native enrollment state before probing secure storage again",
  );
  assert.match(
    reconcileClearedSecret,
    /invalidate_bootstrap_requests\(\)[\s\S]*?tray_update[\s\S]*?if removes_pairing[\s\S]*?set_paired\(false\)[\s\S]*?set_recovery_required\(false\)[\s\S]*?refresh\(\)[\s\S]*?state\.log[\s\S]*?return refresh\(\)/,
    "a cleared pairing credential must stale loaded presence and atomically disable paired/Web native actions",
  );
  assert.match(
    rust,
    /fn cleared_pairing_secret_invalidates_a_blocked_presence_bootstrap[\s\S]*?presence_loaded[\s\S]*?reconcile_cleared_secret_native_presentation\(&state, true[\s\S]*?release stale paired bootstrap[\s\S]*?stale_refreshes\.load\(Ordering::SeqCst\), 0[\s\S]*?!state\.is_paired\(\)[\s\S]*?!state\.recovery_required\(\)/,
    "the blocking regression must prove an old paired bootstrap cannot resurrect menu authorization after credential deletion",
  );
  assert.match(
    revokeBrowser,
    /config::save\(&app, &next_config\)[\s\S]*?revoke_browser_authorization[\s\S]*?reconcile_durable_config_native_presentation[\s\S]*?&next_config[\s\S]*?remains_paired[\s\S]*?refresh_tray_status_locked[\s\S]*?bootstrap_with_known_presence/,
    "irreversible revocation must persist first, invalidate stale authorization bootstraps and return the known next surface without a second credential probe",
  );
  assert.doesNotMatch(
    revokeBrowser,
    /presence_for_browsers|bootstrap\(&app, &state\)/,
    "a successful remote revoke must not become an unretryable false failure when secure storage is transiently unavailable",
  );
  assert.match(
    revokeBrowser,
    /revoke_browser_authorization[\s\S]*?if config::save\(&app, &old_config\)\.is_ok\(\)[\s\S]*?reconcile_durable_config_native_presentation[\s\S]*?&old_config[\s\S]*?old_paired[\s\S]*?else \{[\s\S]*?reconcile_durable_config_native_presentation[\s\S]*?&next_config[\s\S]*?remains_paired/,
    "both durable outcomes of a failed remote revoke must invalidate the opposite authorization bootstrap",
  );
  assert.match(
    rust,
    /fn failed_browser_revoke_rollback_invalidates_a_temporary_empty_authorization_list[\s\S]*?revoked_list_loaded[\s\S]*?reconcile_durable_config_native_presentation[\s\S]*?release stale empty authorization bootstrap[\s\S]*?stale_refreshes\.load\(Ordering::SeqCst\), 0[\s\S]*?browser_ids\.len\(\), 1[\s\S]*?state\.is_paired\(\)/,
    "the blocking regression must prove a failed last-browser revoke cannot leave Web and native authorization disabled",
  );
  assert.match(
    revokeHandler,
    /const next = await relayApi\.revokeBrowserAuthorization[\s\S]*?renderCommittedBootstrap\(next\)[\s\S]*?signedIn\(next\) \? browserPairingEntryAction\(\) : loginButton/,
    "revoking the last browser must return to reconnectable onboarding with valid focus",
  );
  assert.match(
    revokeHandler,
    /catch \(error\) \{[\s\S]*?await refresh\(\)\.catch[\s\S]*?loadBrowserAuthorizations\(\)[\s\S]*?targetStillOwned[\s\S]*?revokeBrowserDialog\.close\(\)/,
    "a failed revoke rollback must refresh the confirmation target from the actual native state",
  );
});

test("macOS compact menu restores desktop actions and makes native failures visible", async () => {
  const rust = await read("../desktop/src-tauri/src/lib.rs");
  const setupTray = functionSource(rust, "setup_tray");
  const trayHandler = functionSource(rust, "handle_tray_menu_event");
  assert.match(setupTray, /"open_settings",[\s\S]*?TrayCopy::for_language\(language\)\.show_app/);
  assert.doesNotMatch(setupTray, /"open_web"/, "Web handoff belongs to the desktop window, not the compact native menu");
  assert.match(setupTray, /\.on_menu_event[\s\S]*?defer_native_entry[\s\S]*?handle_tray_menu_event/,
    "NSMenu callbacks must leave the AppKit thread before serialized native publication");
  assert.match(trayHandler, /"open_settings" => \{[\s\S]*?if let Err\(error\) = show_window\(app\)[\s\S]*?publish_native_action_error/);
  assert.match(trayHandler, /"open_diagnostics" => match show_window\(app\)[\s\S]*?Ok\(\(\)\)[\s\S]*?emit_native_window_action[\s\S]*?"open-diagnostics"[\s\S]*?Err\(error\)[\s\S]*?publish_native_action_error/,
    "diagnostics dispatch must wait for window recovery and publish failures");
  const publishNativeError = functionSource(rust, "publish_native_action_error");
  const publishNativeErrorHook = functionSource(
    rust,
    "publish_native_action_error_with_hook",
  );
  const publishNativeErrorRefreshHook = functionSource(
    rust,
    "publish_native_action_error_with_refresh_hooks",
  );
  assert.match(
    publishNativeError,
    /publish_native_action_error_with_refresh_hooks[\s\S]*?refresh_tray_status_for_snapshot_locked[\s\S]*?app\.emit\("relay-status", snapshot\)/,
  );
  assert.match(
    publishNativeErrorHook,
    /publish_native_action_error_with_refresh_hooks\(state, error,[\s\S]*?Ok\(\(\)\)[\s\S]*?emit\)/,
    "dispatch-only failures may reuse the serialized diagnostic publisher without changing Relay phase",
  );
  assert.match(
    publishNativeErrorRefreshHook,
    /state\.log[\s\S]*?publish_relay_snapshot_with_hooks\(state, refresh, emit\)/,
    "a native menu failure must reach the live diagnostics snapshot before the dialog event",
  );
  const emitNativeWindowAction = functionSource(
    rust,
    "emit_native_window_action",
  );
  const recordDispatchResult = functionSource(
    rust,
    "record_native_window_action_dispatch_result",
  );
  assert.match(
    emitNativeWindowAction,
    /record_native_window_action_dispatch_result\(state, app\.emit\(event, \(\)\), error/,
    "native menu follow-up actions must inspect the runtime dispatch result",
  );
  assert.match(
    recordDispatchResult,
    /if result\.is_err\(\)[\s\S]*?publish_native_action_error_with_hook\(state, error, emit\)/,
    "a rejected diagnostics or update event must remain visible in the next native snapshot",
  );
});

test("macOS browser handoff reports an actual open-command failure", async () => {
  const rust = await read("../desktop/src-tauri/src/lib.rs");
  const start = rust.indexOf('#[cfg(target_os = "macos")]\nfn open_external_url');
  const end = rust.indexOf('#[cfg(target_os = "windows")]', start);
  assert.ok(start >= 0 && end > start);
  const macOpen = rust.slice(start, end);

  assert.match(macOpen, /Command::new\("\/usr\/bin\/open"\)[\s\S]*?\.status\(\)\?/);
  assert.match(macOpen, /status\.success\(\)/);
  assert.doesNotMatch(macOpen, /\.spawn\(\)\.map\(\|_\| \(\)\)/);
});

test("every hidden main-window recovery entry delegates to one focus-safe implementation", async () => {
  const [rust, api, config] = await Promise.all([
    read("../desktop/src-tauri/src/lib.rs"),
    read("../desktop/src/api.ts"),
    read("../desktop/src-tauri/tauri.conf.json").then(JSON.parse),
  ]);
  const mainWindows = config.app.windows.filter((window) => window.label === "main");
  assert.equal(mainWindows.length, 1, "recovery must target one persistent main window");

  const builder = rust.slice(
    rust.indexOf("let app = tauri::Builder::default()"),
    rust.indexOf(".setup(move |app|"),
  );
  const firstPlugin = builder.indexOf(".plugin(");
  const singleInstance = builder.indexOf("tauri_plugin_single_instance::init");
  assert.ok(
    firstPlugin >= 0 && singleInstance >= firstPlugin && singleInstance < builder.indexOf("safe_process_plugin::init"),
    "single-instance rejection must be registered before any process, tray, credential, or Relay initialization",
  );
  const secondInstanceCallback = builder.slice(
    singleInstance,
    builder.indexOf(".plugin(safe_process_plugin::init"),
  );
  assert.match(
    secondInstanceCallback,
    /should_activate_existing_instance\(&arguments\)[\s\S]*?defer_native_entry[\s\S]*?restore_window_from_native_entry\(&app\)/,
  );
  const nativeRestore = functionSource(rust, "restore_window_from_native_entry");
  assert.match(
    nativeRestore,
    /try_state::<AppState>[\s\S]*?restore_window_from_native_entry_with_hooks[\s\S]*?show_window\(app\)[\s\S]*?schedule_native_entry_recovery_check\(app, &state\)[\s\S]*?publish_native_action_error\(app, &state, error\)/,
    "an interactive second launch must schedule an AppKit-safe recovery check and publish a fresh diagnostic when its hidden window cannot be restored",
  );
  assert.match(
    nativeRestore,
    /let Some\(state\) = app\.try_state::<AppState>\(\) else \{[\s\S]*?request_pending_native_restore_with_hook[\s\S]*?PRE_SETUP_NATIVE_RESTORE_PENDING[\s\S]*?show_window\(app\)\.is_ok\(\)[\s\S]*?app\.try_state::<AppState>\(\)\.is_some\(\)[\s\S]*?restore_window_from_native_entry\(app\)/,
    "an interactive second launch received before AppState must survive setup instead of losing a one-shot window restore",
  );
  assert.match(
    rust,
    /startup_behavior\(background_launch,[\s\S]*?take_pending_native_restore\(&PRE_SETUP_NATIVE_RESTORE_PENDING\)[\s\S]*?behavior\.show_main_window \|\| interactive_restore_pending[\s\S]*?show_window\(app\.handle\(\)\)/,
    "a pending interactive launch must override hidden background startup once setup owns the main window",
  );
  assert.match(
    rust,
    /fn pre_setup_native_restore_intent_survives_every_state_registration_race[\s\S]*?setup must inherit an interactive launch[\s\S]*?a request already consumed by setup must not restore twice[\s\S]*?an immediate restore must not inspect AppState readiness[\s\S]*?the inherited interactive launch must override a hidden background startup/,
    "the executable regression must cover callback-first, state-first, and setup-consumption interleavings",
  );
  const nativeEntryRestoreHooks = functionSource(
    rust,
    "restore_window_from_native_entry_with_hooks",
  );
  assert.match(
    nativeEntryRestoreHooks,
    /restore\(\)[\s\S]*?result\.is_err\(\)[\s\S]*?schedule_recovery_check\(\)/,
    "a native restore failure must defer its concrete recovery-surface readback to the AppKit-safe scheduler",
  );
  assert.match(
    rust,
    /fn native_entry_surface_readback_runs_only_inside_the_scheduled_callback[\s\S]*?AppKit recovery surfaces must not be read on the worker thread[\s\S]*?requests\.load\(Ordering::SeqCst\), 0[\s\S]*?missing_surface_requests\.load\(Ordering::SeqCst\), 1[\s\S]*?a rejected main-thread dispatch must not run its readback/,
    "the executable regression must cover retained, lost, and unschedulable native-entry surfaces without worker-thread AppKit reads",
  );
  const activationPolicy = functionSource(rust, "should_activate_existing_instance");
  assert.match(activationPolicy, /!arguments\.iter\(\)\.any[\s\S]*?argument == "--background"/);
  assert.doesNotMatch(
    activationPolicy,
    /show_window|set_focus/,
    "background launch filtering must be decided before any activation side effect",
  );

  const showWindowSource = functionSource(rust, "show_window");
  const showWindow = showWindowSource.slice(showWindowSource.indexOf("{") + 1, -1);
  assert.match(showWindow, /get_webview_window\("main"\)/);
  const restoreOperations = [...showWindow.matchAll(/\.(unminimize|show|set_focus)\(\)/g)]
    .map((match) => match[1]);
  assert.deepEqual(
    restoreOperations,
    ["unminimize", "show", "set_focus"],
    "restore order must handle minimized and hidden windows before requesting focus",
  );
  assert.match(
    showWindow,
    /restore_window_with_hooks\([\s\S]*?window\.unminimize\(\)[\s\S]*?window\.show\(\)[\s\S]*?window\.set_focus\(\)/,
    "all entry points must use the resilient restore sequence",
  );

  const restoreHooks = functionSource(rust, "restore_window_with_hooks");
  assert.match(
    restoreHooks,
    /let _ = unminimize\(\);[\s\S]*?show\(\)\.map_err[\s\S]*?focus\(\)\.map_err/,
    "a nonessential unminimize failure must not block reveal/focus, while required failures remain actionable",
  );
  assert.match(
    rust,
    /fn window_restore_does_not_let_unminimize_failure_block_reveal_and_focus[\s\S]*?Err::<\(\), \(\)>\(\(\)\)[\s\S]*?show_calls\.fetch_add[\s\S]*?focus_calls\.fetch_add[\s\S]*?assert_eq!\(result, Ok\(\(\)\)\)/,
    "the executable regression must reproduce an unminimize error and prove reveal/focus still run",
  );

  const outsideRestore = rust.replace(showWindowSource, "").replace(restoreHooks, "");
  assert.equal(
    [...rust.matchAll(/get_webview_window\("main"\)/g)].length,
    1,
    "all entry points must resolve the same main window through show_window",
  );
  assert.doesNotMatch(
    outsideRestore,
    /\.show\(\)|\.set_focus\(\)/,
    "tray, command, startup, and Dock reopen paths must not grow divergent reveal behavior",
  );

  const commandSource = functionSource(rust, "show_main_window");
  const command = commandSource.slice(commandSource.indexOf("{") + 1, -1).trim();
  assert.equal(command, "show_window(&app)");
  assert.match(api, /showWindow:\s*\(\)\s*=>\s*invokeDesktop<void>\("show_main_window", "window_failed"\)/);
  assert.match(rust, /generate_handler!\[[\s\S]*?show_main_window,/);

  const trayHandler = functionSource(rust, "handle_tray_menu_event");
  const openAction = trayHandler.match(
    /"open_settings"\s*=>\s*\{([\s\S]*?)\n\s*\}/,
  )?.[1] ?? "";
  assert.match(openAction, /show_window\(app\)/);
  assert.match(openAction, /if let Err\(error\)[\s\S]*?publish_native_action_error/);
  assert.doesNotMatch(openAction, /get_webview_window|\.show\(|\.set_focus\(/);
  const diagnosticsStart = trayHandler.indexOf('"open_diagnostics"');
  const diagnosticsEnd = trayHandler.indexOf('"quit"', diagnosticsStart);
  assert.ok(diagnosticsStart >= 0 && diagnosticsEnd > diagnosticsStart);
  const diagnosticsAction = trayHandler.slice(diagnosticsStart, diagnosticsEnd);
  assert.ok(
    diagnosticsAction.indexOf("show_window(app)") <
      diagnosticsAction.indexOf("emit_native_window_action"),
    "diagnostics must restore and focus the window before emitting its dialog event",
  );
  assert.match(
    diagnosticsAction,
    /match show_window\(app\)[\s\S]*?Ok\(\(\)\)[\s\S]*?emit_native_window_action[\s\S]*?open-diagnostics[\s\S]*?window_failed[\s\S]*?Err\(error\)[\s\S]*?publish_native_action_error[\s\S]*?check-for-updates[\s\S]*?update_failed/,
  );

  const closeHandler = rust.slice(
    rust.indexOf(".on_window_event"),
    rust.indexOf(".invoke_handler", rust.indexOf(".on_window_event")),
  );
  assert.match(closeHandler, /prevent_close\(\)[\s\S]*?hide_main_window\(window\)/);
  assert.doesNotMatch(
    closeHandler,
    /stop_for_exit|app\.exit|window\.close/,
    "hiding through the red close button must not tear down the Relay or main window",
  );
  assert.match(
    rust,
    /RunEvent::Reopen[\s\S]*?defer_native_entry[\s\S]*?restore_window_from_native_entry\(&app\)/,
    "a failed macOS Dock/Finder reopen must use the publishing native recovery path",
  );
  assert.match(
    rust,
    /fn native_entry_restore_failure_publishes_fresh_diagnostics[\s\S]*?event\.payload[\s\S]*?restore_window_from_native_entry\(app\.handle\(\)\)/,
    "MockRuntime must prove that a native restore failure reaches relay-status",
  );
});

test("logout failure restores the running Relay or resynchronizes the signed-out surface", async () => {
  const [rust, frontend] = await Promise.all([
    read("../desktop/src-tauri/src/lib.rs"),
    read("../desktop/src/main.ts"),
  ]);
  const logoutStart = rust.indexOf("async fn logout(");
  const logoutEnd = rust.indexOf("async fn save_settings(", logoutStart);
  assert.notEqual(logoutStart, -1, "logout command should exist");
  assert.notEqual(logoutEnd, -1, "logout command should have a bounded body");
  const logout = rust.slice(logoutStart, logoutEnd);

  const revokeFailure = logout.match(
    /if relay::revoke_current_device[\s\S]*?\.is_err\(\)[\s\S]*?return Err\(user_error\("sign_out_failed"\)\);/,
  )?.[0];
  assert.ok(revokeFailure, "logout should handle a server-side revoke failure");
  assert.match(revokeFailure, /if was_running[\s\S]*?relay::start/);
  assert.doesNotMatch(revokeFailure, /clear_device_credentials/);
  assert.match(logout, /revoke_current_device[\s\S]*?clear_device_credentials/);
  assert.match(
    logout,
    /fresh_identity[\s\S]*?cleared\.device_id = fresh_identity\.device_id[\s\S]*?config::save\(&app, &cleared\)[\s\S]*?revoke_current_device/,
    "the irreversible remote revoke needs a durable fresh local identity first",
  );
  assert.match(
    logout,
    /clear_device_credentials[\s\S]*?state\.log\([\s\S]*?credential_access_failed/,
    "post-revoke secure-store cleanup failure must stay diagnostic",
  );

  const logoutHandler = frontend.slice(
    frontend.indexOf('confirmLogout.addEventListener("click"'),
    frontend.indexOf('element<HTMLButtonElement>("close-diagnostics")'),
  );
  assert.match(
    logoutHandler,
    /const next = await relayApi\.logout\(\);[\s\S]*?renderCommittedBootstrap\(next\);[\s\S]*?logoutDialog\.close\(\);[\s\S]*?moveFocus\(loginButton\)/,
    "a successful sign-out must return keyboard focus to the newly visible login action",
  );
  assert.match(
    logoutHandler,
    /catch \(error\)[\s\S]*?await refresh\(\)[\s\S]*?!signedIn\(bootstrap\)[\s\S]*?logoutDialog\.close\(\)[\s\S]*?moveFocus\(loginButton\)/,
    "an ambiguous revoke result must refresh the authoritative surface instead of leaving stale Home UI",
  );
});

test("desktop dialogs and live connection state expose accessible names", async () => {
  const [source, styles] = await Promise.all([
    read("../desktop/src/main.ts"),
    read("../desktop/src/styles.css"),
  ]);

  for (const id of [
    "settings-dialog",
    "diagnostics-dialog",
    "logout-dialog",
    "revoke-browser-dialog",
  ]) {
    const openingTag = source.match(new RegExp(`<dialog\\b[^>]*\\bid="${id}"[^>]*>`))?.[0];
    assert.ok(openingTag, `missing dialog ${id}`);
    assert.match(
      openingTag,
      /aria-label(?:ledby)?="[^"]+"/,
      `${id} needs an accessible name`,
    );
  }

  const statusCard = source.match(/<article\b[^>]*\bid="status-card"[^>]*>/)?.[0];
  assert.ok(statusCard);
  assert.match(statusCard, /aria-live="polite"/);
  assert.match(source, /id="replacement-pairing-code"[^>]*aria-live="polite"/);

  const reducedMotion = styles.match(
    /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/,
  )?.[1] ?? "";
  assert.match(reducedMotion, /\.spinner|\*/);
  assert.match(reducedMotion, /\.status-indicator|\*/);
  assert.match(reducedMotion, /\.browser-state-spinner|\*/);
  assert.match(reducedMotion, /animation:\s*none/);
});

test("window and native tray cannot diverge after a language override", async () => {
  const [frontend, types, i18n, api, rust, model, state] = await Promise.all([
    read("../desktop/src/main.ts"),
    read("../desktop/src/types.ts"),
    read("../desktop/src/i18n.ts"),
    read("../desktop/src/api.ts"),
    read("../desktop/src-tauri/src/lib.rs"),
    read("../desktop/src-tauri/src/model.rs"),
    read("../desktop/src-tauri/src/state.rs"),
  ]);

  for (const locale of ["en", "zh-CN", "hi", "es", "ar", "fr", "bn", "pt", "id", "ur"]) {
    assert.match(i18n, new RegExp(`APP_LOCALES[\\s\\S]*?"${locale}"`));
  }
  assert.match(frontend, /document\.documentElement\.lang = locale/);
  assert.match(frontend, /document\.documentElement\.dir = appLocaleDirection\(locale\)/);
  assert.match(rust, /UiLanguage::English/);
  assert.match(rust, /UiLanguage::SimplifiedChinese/);

  if (/LOCALE_STORAGE_KEY/.test(frontend)) {
    assert.match(
      frontend,
      /relayApi\.setUiLanguage\(|relayApi\.setLanguage\(/,
      "a persisted window override must also update the native menu/tray language",
    );
    assert.match(api, /set_ui_language|set_language/);
    assert.match(rust, /fn set_ui_language|fn set_language/);
  }
  assert.match(types, /ui_language\?: AppLocale \| null/);
  assert.match(model, /pub ui_language: Option<String>/);
  assert.match(
    state,
    /config[\s\S]*?ui_language[\s\S]*?UiLanguage::from_language_code[\s\S]*?unwrap_or_else\(UiLanguage::system\)/,
    "the native menu must use the saved preference before the hidden webview loads",
  );
  const nativeLanguage = functionSource(rust, "set_ui_language");
  assert.match(nativeLanguage, /refresh_tray_language_locked/);
  assert.match(nativeLanguage, /set_ui_language_with_refresh_and_save/);
  const languageTransaction = functionSource(
    rust,
    "set_ui_language_with_refresh_and_save",
  );
  const invalidateBootstrapRequests = functionSource(
    state,
    "invalidate_bootstrap_requests",
  );
  assert.match(
    invalidateBootstrapRequests,
    /begin_bootstrap_request\(\)/,
    "explicit native writers must advance the same bootstrap generation",
  );
  assert.match(
    languageTransaction,
    /invalidate_bootstrap_requests\(\)[\s\S]*?lock_tray_update\(state\)/,
    "an explicit language command must stale a loaded bootstrap before waiting for native presentation serialization",
  );
  assert.match(
    languageTransaction,
    /if previous == language[\s\S]*?return refresh\(language\)\.map_err/,
    "an idempotent language signal must reconcile a native menu or AX presentation left mixed by a failed rollback",
  );
  assert.match(languageTransaction, /next_config\.ui_language[\s\S]*?save\(&next_config\)/);
  assert.match(
    languageTransaction,
    /save\(&next_config\)[\s\S]*?invalidate_bootstrap_requests\(\)[\s\S]*?set_config\(next_config\)/,
    "a bootstrap that starts while the language transaction waits must be invalidated after the durable locale commit",
  );
  assert.match(
    rust,
    /fn explicit_language_commit_invalidates_a_blocked_bootstrap_completion[\s\S]*?old_config_loaded[\s\S]*?UiLanguage::English[\s\S]*?release stale Chinese bootstrap[\s\S]*?old_refresh_count\.load\(Ordering::SeqCst\), 0[\s\S]*?Some\("en"\)[\s\S]*?UiLanguage::English[\s\S]*?!state\.is_paired\(\)[\s\S]*?state\.recovery_required\(\)/,
    "the blocking regression must prove a user English commit wins over an old loaded Chinese bootstrap without any stale native refresh",
  );
  assert.match(
    rust,
    /fn same_value_language_reconciliation_invalidates_a_pending_bootstrap[\s\S]*?UiLanguage::English[\s\S]*?same-value reconciliation must not rewrite durable config[\s\S]*?stale_generation[\s\S]*?stale_refreshes, 0[\s\S]*?Some\("en"\)/,
    "same-value native language reconciliation must also stale a bootstrap that already loaded the old locale",
  );
  assert.match(
    frontend,
    /bootstrapLocaleAfterRefresh\([\s\S]*?next\.config\.ui_language[\s\S]*?currentSwitchRevision: languageSwitchRevision[\s\S]*?if \(refreshedLocale !== locale\)[\s\S]*?locale = refreshedLocale[\s\S]*?applyStaticTranslations/,
    "the window must adopt the persisted native preference only when bootstrap did not overlap a newer language switch",
  );
});

test("native language sync preserves the truthful localized startup state", async () => {
  const source = await read("../desktop/src/main.ts");
  const setLocale = functionBody(source, "setLocale");
  const failureGuard = /catch \(error\)[\s\S]*?startupRetry\.classList\.contains\("is-hidden"\)[\s\S]*?renderStartupMessageForLocale\(\)/;
  assert.match(
    setLocale,
    failureGuard,
    "reverting locale must translate the current startup fact without replacing it",
  );
  assert.match(
    source,
    /startupMessageKeyForRender\(\s*startupFailureCode,\s*startupMessage\.dataset\.i18n[\s\S]*?startupMessage\.dataset\.i18n = key[\s\S]*?startupMessage\.textContent = t\(key\)/,
    "language changes must keep preparing, still-preparing, and failure as distinct facts",
  );
});

test("restricted WebView storage cannot undo a successful native language switch", async () => {
  const [frontend, i18n] = await Promise.all([
    read("../desktop/src/main.ts"),
    read("../desktop/src/i18n.ts"),
  ]);
  const setLocale = functionBody(frontend, "setLocale");
  const persist = functionBody(i18n, "persistAppLocale");

  assert.match(persist, /try \{[\s\S]*?getStorage\(\)\.setItem[\s\S]*?catch \{/);
  assert.match(
    setLocale,
    /await relayApi\.setUiLanguage\(nextLocale\)[\s\S]*?persistAppLocale\(nextLocale\)/,
  );
  assert.doesNotMatch(
    setLocale,
    /localStorage\.setItem/,
    "optional WebView persistence must not share the native rollback boundary",
  );
  assert.match(
    frontend,
    /if \(refreshedLocale !== locale\)[\s\S]*?applyStaticTranslations\(\);\s*saveFeedback\.retranslate\(\);\s*persistAppLocale\(refreshedLocale\)/,
  );
  assert.match(
    frontend,
    /const languageSwitchOverlapped =[\s\S]*?switchRevisionAtStart !== languageSwitchRevision[\s\S]*?if \(!languageSwitchOverlapped\) \{\s*nativeLanguageReconciliationNeeded = true;\s*void requestNativeLanguageReconciliation\(\)/,
    "an overlapping bootstrap must not issue a second native language write while the user switch is still resolving",
  );
  assert.match(
    frontend,
    /window\.addEventListener\("focus"[\s\S]*?requestNativeLanguageReconciliation\(\)/,
    "a transient native presentation failure must remain retryable after startup",
  );
  assert.match(
    setLocale,
    /languageSwitchInFlight = true[\s\S]*?aria-disabled[\s\S]*?languageSwitchInFlight = false/,
    "language synchronization should suppress reentry without removing keyboard focus",
  );
  assert.doesNotMatch(
    setLocale,
    /languageToggle\.disabled\s*=/,
    "native disabled drops focus from the language action during synchronization",
  );
});

test("quick preferences serialize native config writes with language switching", async () => {
  const frontend = await read("../desktop/src/main.ts");
  const saveConfig = functionBody(frontend, "saveConfig");
  const setLocale = functionBody(frontend, "setLocale");
  const reconciliation = functionBody(
    frontend,
    "requestNativeLanguageReconciliation",
  );
  const replacementPairing = functionBody(frontend, "renderReplacementPairing");
  const browserAuthorizations = functionBody(
    frontend,
    "renderBrowserAuthorizations",
  );

  assert.match(
    frontend,
    /id="saved-state"[\s\S]{0,180}?role="status"[\s\S]{0,120}?aria-live="polite"[\s\S]{0,120}?aria-atomic="true"/,
    "saving and saved facts should be announced without stealing focus",
  );
  assert.match(
    saveConfig,
    /configSaveInFlight[\s\S]{0,120}?languageSwitchInFlight[\s\S]*?nativeLanguageReconciliationPromise[\s\S]{0,80}?installingUpdate/,
    "a second quick preference or a concurrent language write must be rejected synchronously",
  );
  assert.match(saveConfig, /setConfigSaveBusy\(true\)[\s\S]*?relayApi\.saveSettings/);
  assert.match(saveConfig, /finally \{\s*setConfigSaveBusy\(false\)/);
  assert.match(
    setLocale,
    /languageSwitchInFlight[\s\S]{0,120}?configSaveInFlight[\s\S]{0,120}?installingUpdate/,
    "language switching must not race an already committed config transaction",
  );
  for (const renderActions of [replacementPairing, browserAuthorizations]) {
    assert.match(renderActions, /browserAuthorizationActionsDisabled\(pairingStage\)/);
    assert.match(renderActions, /browserPairingCancellations\.active/);
    assert.match(renderActions, /configSaveInFlight/);
    assert.match(renderActions, /languageSwitchInFlight/);
    assert.match(renderActions, /nativeLanguageReconciliationPromise/);
  }
  assert.match(
    reconciliation,
    /pairingStage !== "idle"[\s\S]*?configSaveInFlight[\s\S]*?settingsSaveInFlight[\s\S]*?logoutInFlight[\s\S]*?browserRevokeInFlight[\s\S]*?relayStartInFlight[\s\S]*?workspacePickerInFlight[\s\S]*?installingUpdate[\s\S]*?languageSwitchInFlight/,
    "bootstrap language migration must wait for every native config transaction",
  );
  assert.match(
    frontend,
    /function setNativeLanguageReconciliationBusy\(busy: boolean\)[\s\S]*?focusPreservingControls[\s\S]*?control\.setAttribute\("aria-disabled", "true"\)[\s\S]*?control\.removeAttribute\("aria-disabled"\)[\s\S]*?loginButton\.setAttribute\("aria-busy", "true"\)/,
    "the already-rendered window must expose a focus-preserving atomic busy boundary instead of accepting overlapping writes",
  );
  assert.doesNotMatch(
    functionBody(frontend, "setNativeLanguageReconciliationBusy"),
    /loginButton\.disabled = true/,
    "background native reconciliation must not drop cold-start focus from the primary login action",
  );
  assert.match(
    functionBody(frontend, "setNativeLanguageReconciliationBusy"),
    /loginNote\.textContent = busy \? t\("finishingSetup"\)[\s\S]*?initialPairingErrorPresentation[\s\S]*?desktopLoginNote[\s\S]*?loginNote/,
    "the focus-preserving wait must remain visibly and accessibly explained",
  );
  assert.match(
    frontend,
    /confirmRevokeBrowser\.addEventListener[\s\S]*?nativeLanguageReconciliationPromise[\s\S]*?finally \{[\s\S]*?void requestNativeLanguageReconciliation\(\);[\s\S]*?confirmLogout\.addEventListener[\s\S]*?nativeLanguageReconciliationPromise[\s\S]*?finally \{[\s\S]*?void requestNativeLanguageReconciliation\(\);/,
    "revoke and logout completion must resume a deferred native-language reconciliation",
  );
  assert.match(
    frontend,
    /new TransientStatusController[\s\S]*?savedState\.textContent = key \? t\(key\) : ""/,
    "save feedback must retain a stable key so a language change can retranslate it",
  );
  assert.equal(
    frontend.match(/saveFeedback\.retranslate\(\)/g)?.length,
    3,
    "explicit and bootstrap language changes must re-render the active save fact",
  );
  assert.doesNotMatch(
    saveConfig,
    /savedState\.textContent === t\("saved"\)/,
    "localized copy itself must not be used as a timer identity",
  );
});
