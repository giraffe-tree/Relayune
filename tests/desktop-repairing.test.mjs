import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("桌面窗口授权自定义标题栏启动系统拖动", async () => {
  const [capability, main] = await Promise.all([
    readFile("desktop/src-tauri/capabilities/default.json", "utf8"),
    readFile("desktop/src/main.ts", "utf8"),
  ]);
  const parsed = JSON.parse(capability);

  assert.ok(
    parsed.permissions.includes("core:window:allow-start-dragging"),
  );
  assert.match(main, /data-tauri-drag-region/);
});

test("已连接状态可在授权区新增并取消一次独立浏览器授权", async () => {
  const [main, browserAccess, i18n, pairingLink, desktopPackage] = await Promise.all([
    readFile("desktop/src/main.ts", "utf8"),
    readFile("desktop/src/browser-access.ts", "utf8"),
    readFile("desktop/src/i18n.ts", "utf8"),
    readFile("desktop/src/pairing-link.ts", "utf8"),
    readFile("desktop/package.json", "utf8").then(JSON.parse),
  ]);

  assert.match(main, /id="new-pairing"/);
  assert.match(main, /id="pairing-panel"/);
  assert.match(main, /id="cancel-pairing"/);
  assert.match(main, /id="open-pairing-page"/);
  assert.match(main, /id="login-pairing-qr"/);
  assert.match(main, /id="replacement-pairing-qr"/);
  assert.match(
    main,
    /const stagingCanvas = document\.createElement\("canvas"\)[\s\S]*?toCanvas\(stagingCanvas, payload/,
    "QR generation must not draw an obsolete session directly onto the visible canvas",
  );
  assert.match(
    main,
    /pairingQrGenerations\.get\(canvas\) !== generation[\s\S]*?context\.drawImage\(stagingCanvas, 0, 0\)/,
    "only the still-current pairing generation may reach the visible QR surface",
  );
  assert.doesNotMatch(
    main,
    /canvas\.dataset\.[A-Za-z]+\s*=\s*(?:payload|pairingCode|url)/,
    "the camera envelope and short code must never be exposed through DOM datasets",
  );
  assert.match(main, /pairingConnectionUrl\(/);
  assert.equal(desktopPackage.dependencies.qrcode, "^1.5.4");
  assert.match(pairingLink, /\?pair=\$\{encodeURIComponent\(pairingId\)\}/);
  assert.match(pairingLink, /relayune-pairing:v1:/);
  assert.doesNotMatch(pairingLink, /[?&](?:pairingCode|code)=/);
  assert.match(main, /beginPairing\("initial"\)/);
  assert.match(main, /beginPairing\("browser"\)/);
  assert.match(
    main,
    /if \(surface === "initial"\) \{[\s\S]*?await openCurrentPairingPage\(loginOpenPairingPageButton, false\)/,
  );
  assert.match(
    main,
    /async function openCurrentPairingPage\([\s\S]*?announceSuccess = true[\s\S]*?relayApi\.openPairingPage\(activePairingId\)/,
  );
  assert.match(
    main,
    /openPairingPageButton\.addEventListener\("click"[\s\S]*?openCurrentPairingPage\(openPairingPageButton\)/,
  );
  assert.match(
    main,
    /loginOpenPairingPageButton\.addEventListener\("click"[\s\S]*?openCurrentPairingPage\(loginOpenPairingPageButton\)/,
  );
  assert.match(browserAccess, /translate\(locale, "waitStatus"\)/);
  assert.match(i18n, /现有客户端不会断开/);
  assert.match(
    main,
    /return value\.secrets\.device_token && value\.secrets\.e2ee_key;/,
  );
  assert.match(main, /pairingRunId \+= 1/);
  assert.match(main, /t\("browserAddCancelled"\)/);
  assert.match(i18n, /已取消连接新客户端，现有授权未改变/);
  assert.equal(
    (main.match(/createPairingInitiator\(\)/g) ?? []).length,
    1,
    "首次配对与新增浏览器应复用同一条 PAKE 流程",
  );
});

test("新增浏览器写入独立加密 vault 条目且不读取或包装已有内容密钥", async () => {
  const [desktop, rust, relay, cli, secrets] = await Promise.all([
    readFile("desktop/src/main.ts", "utf8"),
    readFile("desktop/src-tauri/src/lib.rs", "utf8"),
    readFile("desktop/src-tauri/src/relay.rs", "utf8"),
    readFile("relay/cli.mjs", "utf8"),
    readFile("desktop/src-tauri/src/secrets.rs", "utf8"),
  ]);

  assert.match(desktop, /completeBrowserPairing\(\{/);
  assert.match(rust, /secrets::set_browser_key\(/);
  assert.match(rust, /complete_browser_pairing\(/);
  assert.match(secrets, /const BROWSER_KEY_NAMESPACE: &str = "browser-content-key"/);
  assert.match(secrets, /Aes256Gcm/);
  assert.doesNotMatch(secrets, /keyring|Keychain|Credential Manager/);
  const additionalFlow = rust.match(
    /async fn complete_browser_pairing\(([\s\S]*?)\n\}\n\nasync fn rollback_browser_pairing/,
  )?.[1];
  assert.ok(additionalFlow);
  assert.doesNotMatch(
    additionalFlow,
    /SecretKind::E2eeKey|secrets::get_browser_key/,
  );
  assert.match(additionalFlow, /browser_ids\.push/);
  assert.match(additionalFlow, /wait_for_relay_connected/);
  assert.match(additionalFlow, /revoke_browser_authorization/);
  assert.match(additionalFlow, /rollback_browser_pairing/);
  assert.match(
    additionalFlow,
    /Ok\(paired_bootstrap\(&app, &state\)\)/,
    "a committed browser pairing must return its known signed-in state without a second secure-store probe",
  );
  const runningFlow = additionalFlow.split("    if !was_running {")[0];
  assert.doesNotMatch(runningFlow, /relay::stop|relay::start/,
    "additional enrollment and vault failures must preserve a running Relay");
  assert.match(runningFlow, /relay::update_browser_key/);
  const rollbackFlow = rust.match(
    /async fn rollback_browser_pairing\((([\s\S]*?))\n\}\n\nasync fn wait_for_relay_connected/,
  )?.[1];
  assert.ok(rollbackFlow);
  assert.match(rollbackFlow, /\) -> Result<\(\), String>/);
  const rollbackPresentation = rust.match(
    /fn reconcile_pairing_rollback_native_presentation\(([\s\S]*?)\n\}\n\nfn launch_at_login_or_diagnostic/,
  )?.[1];
  assert.ok(rollbackPresentation);
  const durablePresentation = rust.match(
    /fn reconcile_durable_config_native_presentation\(([\s\S]*?)\n\}\n\nfn reconcile_pairing_rollback_native_presentation/,
  )?.[1];
  assert.ok(durablePresentation);
  assert.ok(
    rollbackFlow.indexOf("config::save(app, old_config)") <
      rollbackFlow.indexOf("reconcile_pairing_rollback_native_presentation") &&
      rollbackFlow.indexOf("reconcile_pairing_rollback_native_presentation") <
      rollbackFlow.indexOf("secrets::clear_browser_key"),
    "browser rollback may change memory or delete the new key only after the old durable config commits",
  );
  assert.match(
    rollbackPresentation,
    /reconcile_durable_config_native_presentation\(state, old_config, old_paired, refresh\)/,
    "browser rollback must delegate to the shared durable native transaction",
  );
  assert.ok(
    durablePresentation.indexOf("state.invalidate_bootstrap_requests()") <
      durablePresentation.indexOf("state.set_config(config.clone())") &&
      durablePresentation.indexOf("state.set_config(config.clone())") <
      durablePresentation.indexOf("state.set_paired(paired)"),
    "the shared durable transaction must invalidate stale bootstrap state before restoring native memory",
  );
  assert.match(relay, /independent_browser_key_enrollments\([\s\S]*?browser_pairing_required/);
  assert.doesNotMatch(relay, /"browser_id": null|secrets::get\(SecretKind::E2eeKey/);
  assert.match(relay, /separate_browser_authorizations/);
  assert.match(
    relay,
    /revoke_browser_authorization\(app, state, &authorization\.id\)\.await/,
  );
  assert.match(cli, /browserKeyCredentials\(serializedBrowserKeys\)/);
  assert.doesNotMatch(cli, /RELAY_E2EE_KEY/);
});

test("替换设备在持久化失败时恢复旧 Relay", async () => {
  const rust = await readFile("desktop/src-tauri/src/lib.rs", "utf8");
  const completeStart = rust.indexOf("async fn complete_pairing(");
  const completeEnd = rust.indexOf("async fn start_browser_pairing(", completeStart);
  const flow = rust.slice(completeStart, completeEnd);

  assert.match(
    flow,
    /if old_presence\.device_token \{[\s\S]*?match secrets::get\([\s\S]*?Ok\(token\) => Some\(token\)[\s\S]*?Err\(error\)[\s\S]*?abandon_completed_initial_pairing/,
    "even a token-only previous device must be read so the remote device can be revoked",
  );
  assert.match(
    flow,
    /let replacing_connected_device = old_device_token\.is_some\(\) && old_presence\.e2ee_key/,
    "a token-only stale device must be revoked without delaying the new Home on a connectivity wait",
  );
  assert.match(
    flow,
    /if !valid_base64url_secret\(&input\.device_token\)[\s\S]*?abandon_completed_initial_pairing\([\s\S]*?user_error\("pairing_failed"\)/,
    "invalid server identifiers or content keys must revoke a completed remote device when its bearer is usable",
  );
  assert.ok(
    flow.indexOf("config::state_path_for_device") <
      flow.indexOf("relay::stop(&app, &state)"),
    "fallible state path resolution must happen before stopping the old Relay",
  );
  assert.match(
    flow,
    /if was_running \{[\s\S]*?if let Err\(error\) = relay::stop\(&app, &state\)[\s\S]*?abandon_completed_initial_pairing/,
    "a failure to stop the old Relay must still revoke the remote device already created by Web completion",
  );
  for (const [boundary, label] of [
    ["secrets::set_browser_key(&input.device_id", "browser key write"],
    ["if let Err(error) = secrets::set(", "device token write"],
    ["config::save(&app, &next_config)", "config save"],
  ]) {
    const start = flow.indexOf(boundary);
    assert.notEqual(start, -1, `missing transactional boundary for ${label}`);
    const segment = flow.slice(start, flow.indexOf("return Err(error);", start) + 18);
    assert.match(
      segment,
      /if was_running[\s\S]*?relay::start\(&app, &state\)\.await/,
      `${label} failure must restore the previously running Relay`,
    );
    assert.match(
      segment,
      /abandon_completed_initial_pairing/,
      `${label} failure must revoke the remote device that the Web completion already created`,
    );
  }
  const abandon = rust.slice(
    rust.indexOf("async fn abandon_completed_initial_pairing("),
    rust.indexOf("async fn start_browser_pairing("),
  );
  assert.match(abandon, /revoke_current_device\(app, state, new_device_token\)/);
  assert.match(abandon, /sign_out_failed/);
  assert.match(
    flow,
    /Ok\(paired_bootstrap\(&app, &state\)\)/,
    "committed pairing must not be reported as failed by a second secure-store bootstrap probe",
  );
});
