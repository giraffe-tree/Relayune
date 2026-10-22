import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Web keeps service, sync, and history failures actionable", async () => {
  const [page, authLanguage, workbenchLanguage, styles] = await Promise.all([
    read("../app/workbench-page.tsx"),
    read("../app/auth-language.ts"),
    read("../app/workbench-language.ts"),
    read("../app/workbench.css"),
  ]);
  assert.match(page, /authText\(authLocale, bootstrapErrorKind === "review-isolated" \? "reviewIsolatedTitle" : "connectionErrorTitle"\)/);
  assert.match(
    page,
    /authBootstrapErrorText\(authLocale, bootstrapErrorKind\)/,
  );
  assert.match(page, /setBootstrapErrorKind\("service-unavailable"\)/);
  assert.match(authLanguage, /connectionErrorTitle: "暂时无法连接 Relay"/);
  assert.match(authLanguage, /serviceUnavailable: ".*本地登录和加密授权没有被清除。"/);
  assert.match(page, /workbenchText\(authLocale, "syncInterrupted"\)/);
  assert.match(page, /const \[syncInterrupted, setSyncInterrupted\] = useState\(false\)/);
  assert.match(
    page,
    /catch \(error\) \{[\s\S]*?setSyncInterrupted\(true\);[\s\S]*?throw error;/,
    "sync interruption state must remain a stable fact instead of storing old-language copy",
  );
  assert.doesNotMatch(
    page,
    /setSync(?:Error|Interrupted)\(\s*workbenchText\(/,
    "changing locale must translate an already-visible sync warning at render time",
  );
  assert.match(
    page,
    /\{syncInterrupted && \([\s\S]*?\{workbenchText\(authLocale, "syncInterrupted"\)\}/,
  );
  assert.match(
    page,
    /const retryInterruptedSync = useCallback\(async \(\) => \{[\s\S]*?if \(syncRetryInFlight\.current\) return;[\s\S]*?await refreshWithStatus\(\);[\s\S]*?workspaceTitleRef\.current\?\.focus\(\);[\s\S]*?finally \{[\s\S]*?syncRetryInFlight\.current = false;[\s\S]*?setRetryingSync\(false\);[\s\S]*?\}, \[refreshWithStatus\]\);/,
    "successful retry must move focus to the workspace heading before its focused alert action disappears",
  );
  assert.doesNotMatch(page, /refreshStatusButtonRef|refresh-status-button/);
  assert.match(
    page,
    /\{syncInterrupted && \([\s\S]*?aria-busy=\{retryingSync\}[\s\S]*?aria-disabled=\{retryingSync\}[\s\S]*?retryingSync \? "retrying" : "retrySync"/,
  );
  assert.match(page, /workbenchText\(authLocale, "historyReadFailedBanner"\)/);
  assert.match(page, /HISTORY_REQUEST_TIMEOUT_MS = 60_000/);
  assert.match(
    page,
    /"session\.read_history",[\s\S]{0,180}HISTORY_REQUEST_TIMEOUT_MS,[\s\S]{0,300}>\(requestId, HISTORY_REQUEST_TIMEOUT_MS\)/,
    "history commands and response waits must share the same cold-read budget",
  );
  assert.match(
    page,
    /type HistoryPageState = \{[\s\S]{0,180}error\?: true;/,
    "history failure state must remain a stable fact instead of rendered server text",
  );
  assert.match(
    page,
    /catch \{[\s\S]{0,420}error: true,[\s\S]{0,120}setToast\(\{ key: "historyReadFailed" \}\)/,
    "history failure UI and toast must translate from stable keys",
  );
  assert.match(
    page,
    /workbenchText\(authLocale, "historyRetryDetail", \{[\s\S]{0,120}error: workbenchText\(authLocale, "historyReadFailed"\)/,
    "an already-visible history failure must retranslate after a locale change",
  );
  assert.doesNotMatch(
    page,
    /setHistoryPageMap\([\s\S]{0,500}error: (?:message|error\.message)/,
  );
  assert.match(
    page,
    /className="history-toolbar"[\s\S]{0,180}ref=\{historyStatusRef\}[\s\S]{0,100}tabIndex=\{-1\}/,
    "history loading, success, and failure must share one stable live region",
  );
  assert.match(
    page,
    /role=\{[\s\S]{0,220}historyState\?\.error[\s\S]{0,80}"alert"[\s\S]{0,120}historyState[\s\S]{0,80}"status"[\s\S]{0,80}undefined/,
  );
  assert.match(
    page,
    /aria-busy=\{historyState\?\.loading \|\| undefined\}/,
  );
  assert.match(
    page,
    /void loadHistory\(current\.id, null, true\);[\s\S]{0,150}historyStatusRef\.current\?\.focus\(\{ preventScroll: true \}\)/,
    "retrying history must restore focus to the stable status without scrolling",
  );
  assert.match(
    page,
    /void loadHistory\(current\.id, historyState\.nextCursor\);[\s\S]{0,150}historyStatusRef\.current\?\.focus\(\{ preventScroll: true \}\)/,
  );
  assert.doesNotMatch(page, /className="history-error" role="alert"/);
  assert.match(page, /setToast\(\{ key: "messageSyncInterrupted" \}\)/);
  assert.match(page, /workbenchText\(authLocale, "approvalSyncInterrupted"\)/);
  assert.match(workbenchLanguage, /syncInterrupted: "状态同步已中断/);
  assert.match(workbenchLanguage, /historyReadFailedBanner: "历史读取失败/);
  assert.match(workbenchLanguage, /messageSyncInterrupted: "消息已经送达/);
  assert.match(workbenchLanguage, /approvalSyncInterrupted: "审批决定已经送达/);
  assert.match(styles, /\.sync-error-banner/);
  assert.match(styles, /\.history-toolbar \.history-error/);
  assert.match(styles, /\.history-toolbar\[tabindex="-1"\]:focus-visible/);
});

test("pairing can be cancelled and requests have bounded waits", async () => {
  const [page, authLanguage, desktop] = await Promise.all([
    read("../app/workbench-page.tsx"),
    read("../app/auth-language.ts"),
    read("../desktop/src/main.ts"),
  ]);
  assert.match(page, /authText\(authLocale, "cancelRetry"\)/);
  assert.match(authLanguage, /cancelRetry: "取消并立即重试"/);
  assert.match(
    page,
    /function cancelBrowserPairing\(\)[\s\S]*?setPairingPhase\("idle"\)[\s\S]*?requestAnimationFrame[\s\S]*?pairingCodeInputRef\.current\?\.focus\(\)[\s\S]*?pairingCodeInputRef\.current\?\.select\(\)/,
    "removing the focused cancel button must return focus to the enabled code field",
  );
  assert.match(page, /RELAY_REQUEST_TIMEOUT_MS = 15_000/);
  assert.match(desktop, /id="login-cancel-pairing"/);
  assert.match(desktop, /loginCancelPairingButton\.addEventListener\("click", cancelPairing\)/);
  assert.match(desktop, /window\.setTimeout\(\(\) => timeout\.abort\(\), 15_000\)/);
});

test("terminal pairing failures stop offering an impossible code retry", async () => {
  const page = await read("../app/workbench-page.tsx");
  const connectStart = page.indexOf("async function connectMac");
  const connectEnd = page.indexOf("function cancelBrowserPairing", connectStart);
  assert.notEqual(connectStart, -1);
  assert.notEqual(connectEnd, -1);
  const connect = page.slice(connectStart, connectEnd);

  assert.match(
    connect,
    /error instanceof PairingFlowError[\s\S]{0,120}error\.key/,
  );
  assert.match(
    connect,
    /pairingLinkErrorKey\(error\.status, error\.code\)/,
  );
  assert.match(
    connect,
    /if \(terminalPairingError\) \{[\s\S]*?if \(urlPairingId\) \{[\s\S]*?setPairingLinkError\(terminalPairingError\);[\s\S]*?else if \(terminalPairingError === "choosePendingComputer"\)[\s\S]*?pendingPairingDeviceSelectRef\.current\?\.focus\(\)[\s\S]*?else \{[\s\S]*?setPendingBrowserDiscovery\(null\);[\s\S]*?setPendingBrowserDiscoveryError\([\s\S]*?pendingPairingExpired[\s\S]*?pendingDiscoveryRetryButtonRef\.current\?\.focus\(\)[\s\S]*?return;/,
    "expired linkless sessions must leave stale choices and focus the fresh-discovery recovery",
  );
  assert.match(page, /ref=\{pendingDiscoveryRetryButtonRef\}/);
  assert.match(
    connect,
    /pairingErrorKey === "secureConnectionFailed"[\s\S]*?pairingCodeInputRef\.current\?\.focus\(\)[\s\S]*?pairingCodeInputRef\.current\?\.select\(\)[\s\S]*?else \{[\s\S]*?pairingSubmitButtonRef\.current\?\.focus\(\)/,
    "only a correctable secure-code failure should select the code; network retry keeps the action focused",
  );
  assert.match(page, /ref=\{pairingSubmitButtonRef\}/);
});

test("verification recovery separates a real resend from changing email", async () => {
  const [page, authLanguage, styles] = await Promise.all([
    read("../app/workbench-page.tsx"),
    read("../app/auth-language.ts"),
    read("../app/workbench.css"),
  ]);

  assert.match(authLanguage, /resendEmail: "重新发送验证邮件"/);
  assert.match(authLanguage, /useAnotherEmail: "使用其他邮箱"/);
  assert.match(authLanguage, /resendEmail: "Resend verification email"/);
  assert.match(authLanguage, /useAnotherEmail: "Use another email"/);
  assert.match(authLanguage, /verificationResent: "验证邮件已重新发送。"/);
  assert.match(authLanguage, /verificationResent: "Verification email sent again\."/);

  const resendStart = page.indexOf("async function resendEmailVerification()");
  const resendEnd = page.indexOf("async function submitPassword", resendStart);
  assert.notEqual(resendStart, -1);
  assert.notEqual(resendEnd, -1);
  const resend = page.slice(resendStart, resendEnd);
  assert.match(resend, /setResendingVerification\(true\)/);
  assert.match(resend, /"\/api\/auth\/magic-link"/);
  assert.match(resend, /setAuthToastKey\("verificationResent"\)/);
  assert.match(resend, /setEmailFlowError\(authenticationErrorFor\("magicLink", error\)\)/);
  assert.match(resend, /setResendingVerification\(false\)/);

  const sentStart = page.indexOf('loginState === "sent"');
  const sentEnd = page.indexOf(") : isSettingPassword ?", sentStart);
  const sent = page.slice(sentStart, sentEnd);
  assert.match(sent, /onClick=\{\(\) => void resendEmailVerification\(\)\}/);
  assert.match(sent, /aria-disabled=\{resendingVerification\}/);
  assert.match(sent, /onClick=\{changeLoginEmail\}/);
  assert.match(sent, /authText\(authLocale, "resendEmail"\)/);
  assert.match(sent, /authText\(authLocale, "useAnotherEmail"\)/);
  assert.match(sent, /role="status"[\s\S]*?aria-live="polite"/);
  assert.match(
    sent,
    /id="verification-resend-error"[\s\S]{0,60}role="alert"/,
  );

  assert.match(
    styles,
    /\.verification-actions \.text-button \{[\s\S]*?min-height: 44px/,
  );
});

test("authentication requests keep the submitted field snapshot stable", async () => {
  const page = await read("../app/workbench-page.tsx");
  const input = (id) => {
    const start = page.indexOf(`id="${id}"`);
    const end = page.indexOf("/>", start);
    assert.notEqual(start, -1, `${id} input exists`);
    assert.notEqual(end, -1, `${id} input closes`);
    return page.slice(start, end);
  };

  assert.match(
    input("email"),
    /readOnly=\{[\s\S]{0,100}loginState === "checking" \|\| loginState === "sending"[\s\S]{0,80}\}/,
    "the address shown after checking or sending must be the address actually submitted",
  );
  assert.match(
    input("password"),
    /readOnly=\{[\s\S]{0,100}loginState === "authenticating" \|\|[\s\S]{0,80}loginState === "sending-reset"[\s\S]{0,80}\}/,
  );
  assert.match(input("new-password"), /readOnly=\{loginState === "saving-password"\}/);
  assert.match(input("confirm-password"), /readOnly=\{loginState === "saving-password"\}/);
});

test("failed authentication requests restore focus to a usable recovery action", async () => {
  const page = await read("../app/workbench-page.tsx");

  const emailStart = page.indexOf("async function submitEmail");
  const emailEnd = page.indexOf("async function requestEmailVerification", emailStart);
  const emailSubmit = page.slice(emailStart, emailEnd);
  assert.match(
    emailSubmit,
    /setEmailFlowError\(authenticationErrorFor\("emailStatus", error\)\);[\s\S]{0,120}requestAnimationFrame\(\(\) => emailInputRef\.current\?\.focus\(\)\)/,
  );

  const verificationStart = page.indexOf("async function requestEmailVerification");
  const verificationEnd = page.indexOf("async function resendEmailVerification", verificationStart);
  const verification = page.slice(verificationStart, verificationEnd);
  assert.match(
    verification,
    /setAuthToastKey\(null\);[\s\S]{0,100}setLoginState\(/,
    "retrying password recovery must clear the previous failure before announcing new progress",
  );
  assert.match(
    verification,
    /fallbackState === "idle"[\s\S]{0,140}setEmailFlowError\(errorKey\);[\s\S]{0,140}emailInputRef\.current\?\.focus\(\)[\s\S]{0,160}else \{[\s\S]{0,100}setAuthToastKey\(errorKey\);[\s\S]{0,180}passwordResetButtonRef\.current\?\.focus\(\)/,
  );
  assert.match(page, /ref=\{passwordResetButtonRef\}[\s\S]{0,120}className="text-button login-secondary-action"/);

  const passwordStart = page.indexOf("async function submitPassword");
  const passwordEnd = page.indexOf("async function submitNewPassword", passwordStart);
  const passwordSubmit = page.slice(passwordStart, passwordEnd);
  assert.match(
    passwordSubmit,
    /setPasswordError\(authenticationErrorFor\("password", error\)\);[\s\S]{0,160}passwordInputRef\.current\?\.focus\(\);[\s\S]{0,120}if \(invalidCredentials\)[\s\S]{0,100}passwordInputRef\.current\?\.select\(\)/,
    "every sign-in failure restores focus; only invalid credentials select the submitted password",
  );

  const setupStart = page.indexOf("async function submitNewPassword");
  const setupEnd = page.indexOf("function changeLoginEmail", setupStart);
  const setupSubmit = page.slice(setupStart, setupEnd);
  assert.match(
    setupSubmit,
    /const errorKey = authenticationErrorFor\("setPassword", error\);[\s\S]{0,180}setPasswordSetupError\(errorKey\);[\s\S]{0,180}errorKey === "passwordSetupExpired"[\s\S]{0,140}passwordSetupRecoveryButtonRef\.current\?\.focus\(\)[\s\S]{0,120}else \{[\s\S]{0,100}passwordSetupSubmitButtonRef\.current\?\.focus\(\)/,
  );
  assert.match(page, /ref=\{passwordSetupRecoveryButtonRef\}[\s\S]{0,120}type="button"/);
  assert.match(page, /ref=\{passwordSetupSubmitButtonRef\}[\s\S]{0,120}type="submit"/);
});

test("expired password setup offers the action that can actually recover", async () => {
  const [page, authLanguage] = await Promise.all([
    read("../app/workbench-page.tsx"),
    read("../app/auth-language.ts"),
  ]);

  assert.match(authLanguage, /verifyEmailAgain: "重新验证邮箱"/);
  assert.match(authLanguage, /verifyEmailAgain: "Verify email again"/);
  assert.match(
    page,
    /passwordSetupError === "passwordSetupExpired" \? \([\s\S]{0,240}type="button"[\s\S]{0,120}onClick=\{changeLoginEmail\}[\s\S]{0,160}authText\(authLocale, "verifyEmailAgain"\)/,
  );
  assert.match(
    page,
    /async function submitNewPassword[\s\S]{0,180}passwordSetupError === "passwordSetupExpired"[\s\S]{0,100}changeLoginEmail\(\)/,
    "pressing Enter in an expired form must follow the same recovery path",
  );
  assert.ok(
    (page.match(/passwordSetupError !== "passwordSetupExpired"/g)?.length ?? 0) >= 2,
    "editing either password field must not hide the stable expired state",
  );

  const changeStart = page.indexOf("function changeLoginEmail()");
  const changeEnd = page.indexOf("async function logout", changeStart);
  assert.notEqual(changeStart, -1);
  assert.notEqual(changeEnd, -1);
  const change = page.slice(changeStart, changeEnd);
  assert.match(change, /setLoginState\("idle"\)/);
  assert.match(
    change,
    /requestAnimationFrame\(\(\) => emailInputRef\.current\?\.focus\(\)\)/,
  );
});

test("public onboarding is platform-honest and desktop diagnostics omit workspace paths", async () => {
  const [page, authLanguage, relay, language] = await Promise.all([
    read("../app/workbench-page.tsx"),
    read("../app/auth-language.ts"),
    read("../desktop/src-tauri/src/relay.rs"),
    read("../app/document-language.tsx"),
  ]);
  assert.match(page, /authText\(locale, "desktopAvailability"\)/);
  assert.match(
    authLanguage,
    /desktopAvailability: "各平台独立发布并标明版本"/,
  );
  assert.match(page, /authText\(authLocale, "openDesktopFirst"\)/);
  assert.match(authLanguage, /openDesktopFirst: "首次连接请在电脑上打开 Relayune"/);
  assert.doesNotMatch(relay, /relay_config\.workspace\s*\n\s*\),/);
  assert.match(relay, /state\.log\(LogLevel::Info, "relayune:relay_starting"\)/);
  assert.match(relay, /state\.log\(LogLevel::Info, "relayune:relay_started"\)/);
  assert.doesNotMatch(relay, /已使用默认工作目录/);
  assert.match(language, /applyDocumentLocale\(lang\)/);
});
