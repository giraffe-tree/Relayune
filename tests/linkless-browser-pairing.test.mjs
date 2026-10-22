import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("macOS 登录不授权浏览器，已绑定账户只发现后续客户端请求", async () => {
  const [page, server, copy, readme] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("server/pairing-api.ts", "utf8"),
    readFile("app/auth-language.ts", "utf8"),
    readFile("README.md", "utf8"),
  ]);

  assert.match(page, /\/api\/browser\/pairings\/pending/);
  assert.match(
    page,
    /needsE2eeKey\s*&&\s*pendingBrowserDiscovery\?\.has_bound_computer/,
  );
  assert.match(page, /urlPairingId\s*\?\?\s*pendingBrowserPairingId/);
  assert.match(copy, /输入新显示的 8 位码；也可扫码快捷连接/);
  assert.match(copy, /扫描二维码快捷连接/);

  const discoveryStart = server.indexOf(
    "private async listPendingBrowserPairings",
  );
  const discoveryEnd = server.indexOf(
    "private async insertPairing",
    discoveryStart,
  );
  assert.ok(discoveryStart >= 0 && discoveryEnd > discoveryStart);
  const discovery = server.slice(discoveryStart, discoveryEnd);
  assert.match(discovery, /mode:\s*"browser"/);
  assert.match(discovery, /user_id:\s*user\.id/);
  assert.match(discovery, /status:\s*"waiting"/);
  assert.match(discovery, /expires_at:\s*\{\s*\$gt:\s*now\s*\}/);
  assert.doesNotMatch(
    discovery,
    /initiator_share|responder_share|pairing_code|short_code/i,
  );

  assert.match(server, /insertPairing\(body,\s*"initial",\s*null\)/);
  assert.match(
    readme,
    /这一步只把 Mac 绑定到邮箱账户，不会授权承载登录的浏览器访问本机/,
  );
  assert.match(readme, /8 位码只用于登录后的客户端授权，不用于 Mac 账户登录/);
  assert.match(readme, /连接码不上传/);
});

test("macOS 登录后先展示账户信息，再展示连接状态", async () => {
  const [desktop, types, native, server, copy] = await Promise.all([
    readFile("desktop/src/main.ts", "utf8"),
    readFile("desktop/src/types.ts", "utf8"),
    readFile("desktop/src-tauri/src/lib.rs", "utf8"),
    readFile("server/pairing-api.ts", "utf8"),
    readFile("desktop/src/i18n.ts", "utf8"),
  ]);

  const homeStart = desktop.indexOf('id="home-view"');
  const statusCard = desktop.indexOf('id="status-card"', homeStart);
  const primaryAction = desktop.indexOf('id="home-primary"', homeStart);
  const accountCard = desktop.indexOf('id="account-card"', homeStart);
  assert.ok(
    homeStart >= 0 && accountCard > homeStart && statusCard > accountCard && primaryAction === -1,
    "account identity must lead the signed-in home surface without a redundant workspace button",
  );
  assert.match(
    desktop,
    /accountCard\.classList\.toggle\("is-hidden", !isMacAccount\)/,
    "the secondary account card must remain visible for a signed-in Mac",
  );
  assert.match(desktop, /id="account-email"/);
  assert.match(desktop, /data-i18n="signedInStatus"/);
  assert.match(desktop, /function renderAccount[\s\S]*?config\.account_email/);
  assert.match(desktop, /account_email:\s*approvedAccountEmail/);
  assert.match(types, /account_email\?: string \| null/);
  assert.match(types, /CompleteDesktopLoginInput[\s\S]*?account_email: string/);
  assert.match(native, /next_config\.account_email = Some/);
  assert.match(server, /account \? await this\.accountDisplay\(account\.email\) : \{ account_email: null \}/);
  assert.match(copy, /account: "登录账户"/);
  assert.match(copy, /signedInStatus: "已登录"/);
});

test("桌面取消新增浏览器后立即与晚到创建完成后都清理远端等待会话", async () => {
  const [desktop, cancellationQueue, updateGate, api, harness, rust, relay, cli, server] = await Promise.all([
    readFile("desktop/src/main.ts", "utf8"),
    readFile("desktop/src/pairing-cancellation.ts", "utf8"),
    readFile("desktop/src/update-install-state.ts", "utf8"),
    readFile("desktop/src/api.ts", "utf8"),
    readFile("desktop/src/qa-harness.ts", "utf8"),
    readFile("desktop/src-tauri/src/lib.rs", "utf8"),
    readFile("desktop/src-tauri/src/relay.rs", "utf8"),
    readFile("relay/cli.mjs", "utf8"),
    readFile("server/pairing-api.ts", "utf8"),
  ]);

  assert.match(api, /cancelBrowserPairing:[\s\S]*?"cancel_browser_pairing"/);
  assert.match(harness, /case "cancel_browser_pairing":[\s\S]*?return null/);
  assert.equal(
    desktop.match(
      /const browserPairingId = wasBrowser \? activePairingId : "";[\s\S]{0,180}?if \(browserPairingId\) void cancelRemoteBrowserPairing\(browserPairingId\);\s*resetPairingState\(\);/g,
    )?.length,
    2,
    "cancel and expiry must enter the cleanup gate before reset can start another native transaction",
  );
  assert.match(
    desktop,
    /browserPairingIdToCancel = pairing\.pairingId[\s\S]*?startBrowserPairing\(\{[\s\S]*?\.\.\.startInput,[\s\S]*?server_url: pairingServerUrl,/,
    "the browser pairing id must be retained before the native create can settle late",
  );
  assert.match(
    desktop,
    /const cancelled =[\s\S]*?if \(browserPairingIdToCancel\) \{[\s\S]*?finalBrowserCancellation = cancelRemoteBrowserPairing\([\s\S]*?browserPairingIdToCancel,[\s\S]*?cancelled,[\s\S]*?true,[\s\S]*?\)[\s\S]*?if \(!cancelled\) resetPairingState\(\);[\s\S]*?if \(finalBrowserCancellation\) await finalBrowserCancellation/,
    "a start that settles after local cancellation must receive a second idempotent cleanup",
  );
  assert.match(
    desktop,
    /browserPairingCancellations\.enqueue\([\s\S]*?cancelBrowserPairing\(pairingId, pairingOrigins\.get\(pairingId\) \?\? bootstrap\?\.config\.server_url \?\? ""\)[\s\S]*?finalAttempt/,
    "the late authoritative cleanup must run after the immediate best-effort attempt",
  );
  assert.match(cancellationQueue, /const previous =[\s\S]*?this\.attempts\.get\(pairingId\)/);
  assert.match(cancellationQueue, /previous[\s\S]*?\.then\(async/);
  assert.match(cancellationQueue, /if \(finalAttempt && this\.attempts\.get\(pairingId\) === attempt\)/);
  assert.match(updateGate, /browserPairingCancellationInFlight: boolean/);
  assert.match(
    desktop,
    /browserPairingCancellationInFlight:\s*browserPairingCancellations\.active/,
    "updater relaunch must stay blocked until the final remote cleanup settles",
  );
  assert.match(desktop, /cancellingBrowserPairing/);
  assert.match(rust, /async fn cancel_browser_pairing\([\s\S]*?valid_pairing_id/);
  assert.match(relay, /pub async fn cancel_browser_pairing\([\s\S]*?cancel-browser-pairing/);
  assert.match(
    cli,
    /async function cancelBrowserPairing\([\s\S]*?\/api\/relay\/pairings\/\$\{encodeURIComponent\(pairingId\)\}\/cancel/,
  );

  const cancelStart = server.indexOf("private async cancelBrowserPairing");
  const cancelEnd = server.indexOf("private async insertPairing", cancelStart);
  assert.ok(cancelStart >= 0 && cancelEnd > cancelStart);
  const cancellation = server.slice(cancelStart, cancelEnd);
  assert.match(cancellation, /requireRelayDevice\(request\)/);
  assert.match(cancellation, /mode: "browser"/);
  assert.match(cancellation, /device_id: device\.id/);
  assert.match(cancellation, /user_id: device\.user_id/);
  assert.match(cancellation, /status: \{ \$in: \["waiting", "responded"\] \}/);
  assert.doesNotMatch(cancellation, /short_code|pairing_code|initiator_share/i);
});
