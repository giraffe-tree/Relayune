import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("desktop updater checks the signed HTTPS feed for the current platform", async () => {
  const [config, capability, cargo, rust, source, i18n, throttle] = await Promise.all([
    readFile("desktop/src-tauri/tauri.conf.json", "utf8").then(JSON.parse),
    readFile("desktop/src-tauri/capabilities/default.json", "utf8").then(JSON.parse),
    readFile("desktop/src-tauri/Cargo.toml", "utf8"),
    readFile("desktop/src-tauri/src/lib.rs", "utf8"),
    readFile("desktop/src/main.ts", "utf8"),
    readFile("desktop/src/i18n.ts", "utf8"),
    readFile("desktop/src/update-check-throttle.ts", "utf8"),
  ]);

  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.match(config.plugins.updater.pubkey, /^[A-Za-z0-9+/=]+$/);
  assert.deepEqual(config.plugins.updater.endpoints, [
    "https://relayune.giraffetree.cn/updates/latest.json",
  ]);
  assert.ok(capability.permissions.includes("updater:default"));
  assert.ok(capability.permissions.includes("process:allow-restart"));
  assert.match(cargo, /tauri-plugin-updater = "2"/);
  assert.match(cargo, /tauri-plugin-process = "2"/);
  assert.match(rust, /tauri_plugin_updater::Builder::new\(\)\.build\(\)/);
  assert.match(rust, /\.plugin\(safe_process_plugin::init\(\)\)/);
  assert.match(
    rust,
    /mod safe_process_plugin[\s\S]*?Builder::new\("process"\)[\s\S]*?generate_handler!\[exit, restart\]/,
    "the existing process client/ACL must route through Relayune's stop-aware commands",
  );
  assert.match(
    rust,
    /fn restart\([\s\S]*?process_transition_with_hooks\([\s\S]*?relay::stop_for_exit\(&state\)[\s\S]*?app\.request_restart\(\)[\s\S]*?publish_native_action_error/,
    "an updater relaunch must stop Relay before Tauri sets its unpreventable restart flag",
  );
  assert.match(
    rust,
    /fn updater_restart_never_runs_after_relay_stop_failure[\s\S]*?relay_stop_failed[\s\S]*?transitions\.load\(Ordering::SeqCst\), 0[\s\S]*?failures\.load\(Ordering::SeqCst\), 1/,
    "the executable regression must prove stop failure suppresses relaunch and publishes diagnostics",
  );
  assert.match(
    rust,
    /fn process_transition_with_hooks[\s\S]*?if state\.exit_stop_ready\(\)[\s\S]*?return Err\(user_error\("relay_stop_failed"\)\);[\s\S]*?if !state\.begin_exit_stop\(\)[\s\S]*?return Err\(user_error\("relay_stop_failed"\)\)/,
    "an in-flight or already committed Quit must not report false success for a different updater restart transition",
  );
  assert.match(
    rust,
    /fn updater_restart_never_runs_after_relay_stop_failure_or_completed_quit[\s\S]*?successful_state\.exit_stop_ready\(\)[\s\S]*?Err\(user_error\("relay_stop_failed"\)\)[\s\S]*?a completed transition must never admit a second owner/,
    "the executable regression must prove a completed Quit cannot be replaced by updater restart",
  );
  assert.match(
    rust,
    /fn concurrent_process_transition_never_reports_unowned_success[\s\S]*?owner did not claim the exit gate[\s\S]*?Err\(user_error\("relay_stop_failed"\)\)[\s\S]*?contender_transition_calls\.load\(Ordering::SeqCst\), 0[\s\S]*?the sole owner transition did not run/,
    "the blocking regression must prove only the exit-gate owner can report or perform its process transition",
  );
  assert.match(rust, /set_update_available/);
  assert.match(rust, /Check for Updates…/);
  assert.match(rust, /检查更新…/);
  assert.match(rust, /Install Update…/);
  assert.match(rust, /安装更新…/);
  assert.match(
    rust,
    /MenuItemBuilder::with_id\([\s\S]*?"check_updates"[\s\S]*?tray_update_action_text\(language, update_available\)/,
  );
  assert.match(
    rust,
    /"check_updates"[\s\S]*?show_window\(app\)[\s\S]*?emit_native_window_action\([\s\S]*?"check-for-updates"[\s\S]*?user_error\("update_failed"\)/,
  );
  assert.match(
    rust,
    /fn emit_native_window_action[\s\S]*?record_native_window_action_dispatch_result\([\s\S]*?app\.emit\(event, \(\)\)[\s\S]*?app\.emit\("relay-status", snapshot\)/,
    "native update dispatch failures must publish a fresh diagnostic snapshot",
  );
  assert.match(
    rust,
    /fn set_update_available_with_refresh[\s\S]*?tray_update[\s\S]*?let previous = state\.update_available\(\)[\s\S]*?state\.set_update_available\(available\)[\s\S]*?if refresh\(\)\.is_err\(\)[\s\S]*?state\.set_update_available\(previous\)[\s\S]*?let _ = refresh\(\)/,
    "availability mutation, native refresh, and rollback must share the tray-update transaction",
  );
  assert.match(source, /target: bootstrap\.platform\.update_target/);
  assert.match(source, /timeout: 15_000/);
  assert.match(source, /downloadAndInstall/);
  assert.match(source, /requestNativeUpdateAvailability\(true\)/);
  assert.match(source, /requestNativeUpdateAvailability\(false\)/);
  assert.match(
    source,
    /flushNativeUpdateAvailability[\s\S]*?relayApi\.setUpdateAvailable\(desired\)[\s\S]*?desiredNativeUpdateAvailable = desired[\s\S]*?showDesktopErrorToast\(error, "update_failed"\)/,
    "native update presentation failures must remain visible and retryable",
  );
  assert.match(source, /listen\("check-for-updates"/);
  assert.match(source, /checkForUpdates\(true\)/);
  assert.match(source, /function focusPendingUpdate\(\)/);
  assert.match(source, /showTranslatedToast\("upToDate"\)/);
  assert.match(source, /showTranslatedToast\("updateCheckFailed"\)/);
  assert.match(source, /await relaunch\(\)/);
  assert.match(source, /aria-describedby="update-detail"/);
  assert.match(
    source,
    /function updateInstallIsBlocked\(\)[\s\S]*?installingUpdate[\s\S]*?pairingInFlight: pairingStage !== "idle"[\s\S]*?settingsSaveInFlight[\s\S]*?logoutInFlight[\s\S]*?browserRevokeInFlight[\s\S]*?relayStartInFlight[\s\S]*?workspacePickerInFlight[\s\S]*?nativeLanguageReconciliationInFlight/,
    "update relaunch must be serialized with every native onboarding transaction",
  );
  assert.match(
    source,
    /async function installPendingUpdate\(\) \{\s*if \(!pendingUpdate \|\| updateInstallIsBlocked\(\)\) return;/,
  );
  assert.match(
    source,
    /function requestNativeLanguageReconciliation\(\)[\s\S]*?installingUpdate[\s\S]*?nativeLanguageReconciliationPromise = relayApi[\s\S]*?setNativeLanguageReconciliationBusy\(false\)[\s\S]*?setNativeLanguageReconciliationBusy\(true\)[\s\S]*?async function installPendingUpdate\(\)[\s\S]*?catch \{\s*installingUpdate = false;[\s\S]*?void requestNativeLanguageReconciliation\(\);/,
    "native language reconciliation and updater relaunch must be mutually exclusive and resume after a failed install",
  );
  assert.match(
    source,
    /function renderPendingUpdate\(\)[\s\S]*?installUpdateButton\.disabled = installBlocked && !installingUpdate;[\s\S]*?installUpdateButton\.toggleAttribute\("aria-disabled", installBlocked\)[\s\S]*?updateLaterButton\.disabled = installingUpdate[\s\S]*?t\("updateBusyDetail"\)/,
    "the in-flight install action must remain focused while its guard rejects duplicate relaunches",
  );
  assert.match(
    source,
    /function focusPendingUpdate\(\)[\s\S]*?installUpdateButton\.disabled \? updateLaterButton : installUpdateButton/,
    "a manual update check must focus an enabled action while installation is deferred",
  );
  assert.match(
    source,
    /async function dismissPendingUpdate\(\) \{\s*if \(!pendingUpdate \|\| installingUpdate \|\| dismissingUpdate\) return;[\s\S]*?dismissingUpdate = true;[\s\S]*?await update\.close\(\)[\s\S]*?hideUpdateCard\(\);[\s\S]*?moveFocus\(bootstrap && signedIn\(bootstrap\) \? statusCard : loginButton\)[\s\S]*?finally \{\s*dismissingUpdate = false;[\s\S]*?moveFocus\(updateLaterButton\)/,
    "deferring an update must be single-flight and move focus only after the card is actually closed",
  );
  assert.match(
    source,
    /function renderPendingUpdate\(\)[\s\S]*?aria-busy", installingUpdate \|\| dismissingUpdate[\s\S]*?updateLaterButton\.toggleAttribute\("aria-disabled", dismissingUpdate\)/,
    "the focused Later action must remain present and announce its in-flight close",
  );
  assert.match(
    source,
    /updatePresentation = "failed";[\s\S]*?showTranslatedToast\("updateFailed"\);\s*moveFocus\(installUpdateButton\)/,
    "a failed install must return focus to its retry action",
  );
  assert.match(
    source,
    /async function beginPairing[\s\S]*?if \(!bootstrap \|\| updateInstallIsBlocked\(\)\) return/,
    "an update download must also prevent a new first-login transaction",
  );
  assert.match(
    source,
    /retryRelay\.addEventListener\("click", async \(\) => \{\s*if \(updateInstallIsBlocked\(\)\) return;[\s\S]*?setRelayStartBusy\(true\)[\s\S]*?await relayApi\.start\(\)[\s\S]*?finally \{\s*setRelayStartBusy\(false\)/,
    "Relay recovery and updater relaunch must not race a sidecar start",
  );
  assert.match(
    source,
    /"choose-workspace"\)\.addEventListener\("click", async \(\) => \{\s*if \(!bootstrap \|\| updateInstallIsBlocked\(\)\) return;[\s\S]*?setWorkspacePickerBusy\(true\)[\s\S]*?await relayApi\.selectWorkspace[\s\S]*?setWorkspacePickerBusy\(false\)[\s\S]*?await saveConfig/,
    "a native workspace picker must settle before relaunch can begin",
  );
  assert.match(throttle, /UPDATE_CHECK_INTERVAL_MS = 10 \* 60 \* 1_000/);
  assert.match(throttle, /UPDATE_CHECK_STORAGE_KEY = "relayune\.updater\.last-check-at\.v1"/);
  assert.match(
    source,
    /const updateCheckThrottle = new UpdateCheckThrottle\(\)/,
    "automatic update checks must share a persistent ten-minute admission gate",
  );
  assert.match(
    source,
    /if \(!updateCheckThrottle\.claim\(manualUpdateCheckRequested\)\) \{[\s\S]*?return;/,
    "manual checks may bypass throttling while automatic checks remain deduplicated",
  );
  assert.match(
    source,
    /window\.addEventListener\("focus", \(\) => \{[\s\S]*?void checkForUpdates\(\);/,
    "returning the macOS app to the foreground must schedule a quiet update check",
  );
  assert.match(
    source,
    /window\.setInterval\(\(\) => \{\s*void checkForUpdates\(\);\s*\}, UPDATE_CHECK_INTERVAL_MS\);/,
    "a continuously foregrounded app must continue checking at the same minimum interval",
  );
  assert.match(source, /t\("updateDefaultDetail"\)/);
  assert.match(source, /localizedUpdateNotes\(locale, pendingUpdate\.body\)/);
  assert.match(source, /type UpdatePresentation =/);
  assert.match(
    source,
    /if \(pendingUpdate\) \{\s*renderPendingUpdate\(\);\s*\}/,
  );
  assert.match(
    source,
    /catch \(error\) \{\s*locale = previousLocale;[\s\S]*?if \(pendingUpdate\) renderPendingUpdate\(\);/,
  );
  assert.match(
    source,
    /updatePresentation = "failed";[\s\S]*?renderPendingUpdate\(\);/,
  );
  assert.match(source, /role="progressbar"/);
  assert.match(source, /aria-labelledby="update-title"/);
  assert.match(source, /updateProgress\.setAttribute\("aria-valuenow", String\(bounded\)\)/);
  assert.match(
    source,
    /catch \{[\s\S]*?updateProgress\.classList\.add\("is-hidden"\);[\s\S]*?setUpdateProgress\(null\);/,
  );
  assert.match(i18n, /更新会短暂断开客户端/);
  assert.match(i18n, /Clients disconnect briefly/);
  assert.match(i18n, /请先完成当前连接或设置操作/);
  assert.match(i18n, /Finish the current connection or settings change/);
  assert.match(i18n, /Relayune is up to date\./);
  assert.match(i18n, /export function localizedUpdateNotes/);
});

test("release pipeline publishes a static signed update manifest", async () => {
  const [rootPackage, releaseScript, artifactScript, selfHostedBuild] = await Promise.all([
    readFile("package.json", "utf8").then(JSON.parse),
    readFile("scripts/build-desktop-release.mjs", "utf8"),
    readFile("scripts/prepare-desktop-artifacts.mjs", "utf8"),
    readFile("scripts/verify-official-downloads.mjs", "utf8"),
  ]);

  assert.equal(
    rootPackage.scripts["desktop:release"],
    "node scripts/build-desktop-release.mjs",
  );
  assert.match(releaseScript, /\.tauri", "agent-relay\.key/);
  assert.match(releaseScript, /signingKeyStat\.mode & 0o077/);
  assert.match(releaseScript, /"notarytool",\s*"submit"/);
  assert.match(releaseScript, /"agent-relay-notary"/);
  assert.match(releaseScript, /"stapler", "staple"/);
  assert.match(releaseScript, /"stapler", "validate"/);
  assert.match(artifactScript, /"macos-universal"/);
  assert.match(artifactScript, /config\.productName/);
  assert.match(
    artifactScript,
    /open-chen\.oss-cn-hangzhou\.aliyuncs\.com\/apps\/relayune\/\$\{version\}/,
  );
  assert.match(artifactScript, /latest\.json/);
  assert.match(artifactScript, /publicUpdatesDirectory/);
  assert.match(artifactScript, /RELEASE_NOTES_ZH/);
  assert.match(artifactScript, /RELEASE_NOTES_EN/);
  assert.match(artifactScript, /loadReleaseNotes\(version\)/);
  assert.match(artifactScript, /release-notes/);
  assert.match(artifactScript, /releaseNotes\.platforms\.includes\("macos"\)/);
  assert.doesNotMatch(artifactScript, /new Eclipse Relay brand/);
  assert.match(artifactScript, /const supportedLocales = \[/);
  assert.match(artifactScript, /"hi"[\s\S]*"ar"[\s\S]*"ur"/);
  assert.match(artifactScript, /JSON\.stringify\(Object\.fromEntries/);
  assert.match(artifactScript, /SHA256SUMS\.txt/);
  assert.doesNotMatch(artifactScript, /TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(artifactScript, /assertUpdaterKeyMatchesConfig/);
  assert.match(artifactScript, /signaturePacket\.subarray\(2, 10\)\.equals/);
  assert.match(artifactScript, /assertUpdaterArchiveVersion/);
  assert.match(artifactScript, /CFBundleShortVersionString/);
  assert.match(releaseScript, /Release artifact is stale/);
  assert.match(releaseScript, /Signed app version is/);
  assert.match(releaseScript, /architectures\.join\(" "\) !== "arm64 x86_64"/);
  assert.doesNotMatch(selfHostedBuild, /updateManifest\.version !== desktopConfig\.version/);
  assert.match(
    selfHostedBuild,
    /Relayune-\$\{updateManifest\.version\}-macOS-universal\.dmg/,
  );
  assert.match(
    selfHostedBuild,
    /Relayune-\$\{androidUpdateManifest\.version_name\}-Android\.apk/,
  );
  assert.match(selfHostedBuild, /Public download link is missing/);
  assert.match(selfHostedBuild, /macos-universal/);
});
