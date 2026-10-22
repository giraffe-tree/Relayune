import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

test("营销页进入登录后可用浏览器后退返回，错误态也提供首页出口", async () => {
  const [home, localeHome, workbench, returnFocus, styles] = await Promise.all([
    readFile("app/page.tsx", "utf8"),
    readFile("app/marketing-locale-page.tsx", "utf8"),
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/marketing-return-focus.ts", "utf8"),
    readFile("app/workbench.css", "utf8"),
  ]);

  for (const source of [home, workbench]) {
    assert.match(source, /history\.pushState\(null, "", "\/\?login=1"\)/);
    assert.match(source, /addEventListener\("popstate", returnToMarketing\)/);
    assert.match(source, /hasAuthenticationEntry\(window\.location\.search\)/);
  }
  assert.doesNotMatch(home, /history\.replaceState\([^\n]+login=1/);
  assert.doesNotMatch(workbench, /history\.replaceState\([^\n]+login=1/);
  assert.match(localeHome, /window\.location\.assign\("\/\?login=1"\)/);
  assert.match(
    localeHome,
    /rootAuthenticationEntryPath\(window\.location\.search\)/,
  );
  assert.match(
    localeHome,
    /if \(!authenticationEntryTarget\) return;[\s\S]{0,160}storeAuthLocale\(locale\);[\s\S]{0,100}window\.location\.replace\(authenticationEntryTarget\)/,
  );
  assert.match(
    localeHome,
    /if \(authenticationEntryTarget\) \{[\s\S]*?className="workbench-loading"[\s\S]*?role="status"[\s\S]*?authText\(locale, "checkingTitle"\)/,
  );
  assert.match(
    localeHome,
    /useMarketingReturnFocus\(!authenticationEntryTarget\)/,
  );
  for (const source of [home, localeHome, workbench]) {
    assert.match(source, /markMarketingReturnFocus\(\)/);
    assert.match(source, /useMarketingReturnFocus\(/);
  }
  assert.match(returnFocus, /history\.replaceState\([\s\S]*?RETURN_FOCUS_KEY/);
  assert.match(returnFocus, /delete state\[RETURN_FOCUS_KEY\]/);
  assert.match(returnFocus, /addEventListener\("pageshow", restore\)/);
  assert.match(
    returnFocus,
    /useEffect\([\s\S]*?consumeMarketingReturnFocus\(\)[\s\S]*?requestAnimationFrame[\s\S]*?querySelector<HTMLElement>\("#top"\)\?\.focus\(\)/,
    "focus restoration must wait for the marketing hero to be committed and survive BFCache navigation",
  );
  assert.doesNotMatch(localeHome, /login=1[^"\n]*(?:locale|lang|code)/i);
  assert.match(
    workbench,
    /`\/\?pair=\$\{encodeURIComponent\(pairingId\)\}`/,
  );
  assert.doesNotMatch(workbench, /`\/\?pair=\$\{[^}]*pairingCode/);
  assert.match(workbench, /const marketingHomePath = localePath\(authLocale\)/);
  assert.match(workbench, /className="login-back-link"[\s\S]{0,100}href=\{marketingHomePath\}/);
  assert.match(workbench, /window\.location\.assign\(marketingHomePath\)/);
  assert.match(workbench, /bootstrapErrorTitleRef\.current\?\.focus\(\)/);
  assert.match(workbench, /id="connection-error-title"[\s\S]{0,120}tabIndex=\{-1\}/);
  assert.match(workbench, /setShowLogin\(false\)/);
  assert.match(
    workbench,
    /if \(!invalidPairingEntry \|\| checkingAuth\) return;[\s\S]{0,220}\}, \[checkingAuth, invalidPairingEntry\]\);/,
  );
  assert.match(
    workbench,
    /id="invalid-pairing-title"[\s\S]{0,120}ref=\{invalidPairingTitleRef\}[\s\S]{0,80}tabIndex=\{-1\}/,
  );
  assert.match(styles, /\.login-card h1\[tabindex="-1"\]:focus-visible/);
  assert.match(
    styles,
    /\.login-sr-only\s*\{[\s\S]{0,260}clip-path:\s*inset\(50%\)/,
  );
  assert.match(
    await readFile("app/globals.css", "utf8"),
    /\.marketing-hero\[tabindex="-1"\]:focus-visible/,
  );
  assert.match(workbench, /behavior: reduceMotion \? "auto" : "smooth"/);
  assert.match(styles, /\.login-back-link\s*\{[\s\S]*?min-height:\s*44px/);
});

test("打开网站进入工作台时不自动聚焦会话标题", async () => {
  const [workbench, styles] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/workbench.css", "utf8"),
  ]);

  assert.doesNotMatch(
    workbench,
    /if \(!workspaceReady\) return;\s*const frame = window\.requestAnimationFrame\(\(\) => \{\s*workspaceTitleRef\.current\?\.focus\(\);/,
    "initial workspace readiness must not move focus to the conversation title",
  );
  assert.match(
    workbench,
    /<h1 ref=\{workspaceTitleRef\} tabIndex=\{-1\}>\s*\{current\?\.name \?\?[\s\S]{0,100}workbenchText\(authLocale, "waitingForRelay"\)\}\s*<\/h1>/,
  );
  assert.match(
    styles,
    /\.conversation-title-row h1\[tabindex="-1"\]:focus-visible/,
  );
});

test("配对完成状态在进入工作台前获得真实可见与播报窗口", async () => {
  const [workbench, bundled] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    importPairingCompletion(),
  ]);
  try {
    const {
      PAIRING_COMPLETION_HANDOFF_MS,
      waitForPairingCompletionHandoff,
    } = bundled.entry;
    let release;
    let scheduledDelay = -1;
    let settled = false;
    const handoff = waitForPairingCompletionHandoff((callback, delay) => {
      release = callback;
      scheduledDelay = delay;
    });
    void handoff.then(() => {
      settled = true;
    });

    await Promise.resolve();
    assert.equal(settled, false, "navigation must not replace the terminal state synchronously");
    assert.equal(scheduledDelay, PAIRING_COMPLETION_HANDOFF_MS);
    assert.ok(PAIRING_COMPLETION_HANDOFF_MS >= 500);
    assert.ok(PAIRING_COMPLETION_HANDOFF_MS <= 1_000);
    release();
    await handoff;
    assert.equal(settled, true);
    assert.match(
      workbench,
      /setPairingPhase\("complete"\);[\s\S]{0,120}await waitForPairingCompletionHandoff\(\);[\s\S]{0,80}ensureActive\(\);[\s\S]{0,80}window\.location\.replace\("\/"\)/,
      "the terminal live status must commit before navigation replaces the pairing page",
    );
  } finally {
    await bundled.cleanup();
  }
});

async function importWorkbenchEntry() {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-workbench-entry-"));
  const outfile = join(temporary, "workbench-entry.mjs");
  await build({
    entryPoints: ["app/workbench-entry.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  return {
    entry: await import(`${pathToFileURL(outfile).href}?${Date.now()}`),
    cleanup: () => rm(temporary, { recursive: true, force: true }),
  };
}

async function importPairingCompletion() {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-pairing-completion-"));
  const outfile = join(temporary, "pairing-completion.mjs");
  await build({
    entryPoints: ["app/pairing-completion.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  return {
    entry: await import(`${pathToFileURL(outfile).href}?${Date.now()}`),
    cleanup: () => rm(temporary, { recursive: true, force: true }),
  };
}

test("显式登录、设密、配对和桌面登录链接直接加载认证工作台", async () => {
  const bundled = await importWorkbenchEntry();
  try {
    const {
      hasAuthenticationEntry,
      rootAuthenticationEntryPath,
    } = bundled.entry;
    assert.equal(hasAuthenticationEntry(""), false);
    assert.equal(hasAuthenticationEntry("?login=0"), false);
    assert.equal(hasAuthenticationEntry("?login=1"), true);
    assert.equal(hasAuthenticationEntry("?auth=set-password"), true);
    assert.equal(hasAuthenticationEntry("?pair=pair_example"), true);
    assert.equal(hasAuthenticationEntry("?pair="), true);
    const pairingId = `pair_${"A".repeat(43)}`;
    const desktopLoginId = `dlogin_${"B".repeat(43)}`;
    const inviteCode = "abcdefghijklmnopqrstuvwx";
    assert.equal(
      hasAuthenticationEntry(`?desktop_login=${desktopLoginId}`),
      true,
    );
    assert.equal(hasAuthenticationEntry(`?invite=${inviteCode}`), false);
    assert.equal(rootAuthenticationEntryPath("?login=1"), "/?login=1");
    assert.equal(
      rootAuthenticationEntryPath("?login=1&return_to=%2Faccount%2F"),
      "/?login=1",
    );
    assert.equal(
      rootAuthenticationEntryPath("?return_to=%2Faccount%2F"),
      null,
    );
    assert.equal(
      rootAuthenticationEntryPath(`?auth=set-password&pair=${pairingId}`),
      `/?auth=set-password&pair=${pairingId}`,
    );
    assert.equal(
      rootAuthenticationEntryPath(
        `?auth=set-password&pair=${pairingId}&return_to=%2Faccount%2F`,
      ),
      `/?auth=set-password&pair=${pairingId}`,
    );
    assert.equal(rootAuthenticationEntryPath("?pair=invalid"), "/?pair=");
    assert.equal(
      rootAuthenticationEntryPath(`?desktop_login=${desktopLoginId}`),
      `/?desktop_login=${desktopLoginId}`,
    );
    assert.equal(
      rootAuthenticationEntryPath("?desktop_login=invalid"),
      "/?desktop_login=",
    );
    assert.equal(
      rootAuthenticationEntryPath(`?invite=${inviteCode}`),
      null,
    );
    assert.equal(rootAuthenticationEntryPath("?invite=invalid"), null);
    assert.equal(rootAuthenticationEntryPath("?code=redacted"), null);
    assert.equal(
      rootAuthenticationEntryPath("?login=1&locale=en&debug=true"),
      "/?login=1",
    );
  } finally {
    await bundled.cleanup();
  }
});

test("桌面登录只确认 Mac，回跳 URL 不携带设备凭据", async () => {
  const [workbench, authLanguage] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/auth-language.ts", "utf8"),
  ]);
  assert.match(
    workbench,
    /`\/api\/desktop-login\/\$\{encodeURIComponent\(desktopLoginId\)\}\/approval`/,
  );
  assert.match(
    workbench,
    /`\/api\/desktop-login\/\$\{encodeURIComponent\(desktopLoginId\)\}\/approve`/,
  );
  assert.match(
    workbench,
    /relayune:\/\/desktop-login-complete\?request=\$\{encodeURIComponent\(/,
  );
  assert.doesNotMatch(
    workbench,
    /desktop-login-complete[^\n]*(?:token|secret|code)=/i,
  );
  assert.match(
    authLanguage,
    /desktopLoginSubtitle[^\n]*浏览器不会获得本机 Agent 的访问权限/,
  );
});

test("空或损坏的配对入口优先显示稳定错误，不被 bootstrap 错误覆盖", async () => {
  const [workbench, bundled] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    importWorkbenchEntry(),
  ]);
  try {
    const { pairingLinkErrorKey } = bundled.entry;
    assert.match(
      workbench,
      /const invalidPairingEntry = pairingParameter !== null && !urlPairingId/,
    );
    assert.match(
      workbench,
      /if \(\(bootstrapError \|\| instanceError\) && !invalidPairingEntry/,
    );
    assert.match(workbench, /if \(invalidPairingEntry\)/);
    assert.doesNotMatch(
      workbench,
      /authLocale === "zh-CN" && error\.message/,
    );
    assert.equal(
      pairingLinkErrorKey(409, "pairing_already_used"),
      "pairingUsed",
    );
    assert.equal(
      pairingLinkErrorKey(404, "pairing_expired"),
      "pairingExpired",
    );
    assert.equal(
      pairingLinkErrorKey(404, "pairing_not_found"),
      "pairingMissing",
    );
    assert.equal(pairingLinkErrorKey(503, "service_unavailable"), null);
  } finally {
    await bundled.cleanup();
  }
});

test("缺少浏览器密钥时只发现明确等待中的电脑，并要求多设备选择", async () => {
  const [workbench, authLanguage, styles] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/auth-language.ts", "utf8"),
    readFile("app/workbench.css", "utf8"),
  ]);
  const directPairingStart = workbench.indexOf(
    "if (needsE2eeKey && pendingBrowserDiscovery?.has_bound_computer)",
  );
  const directPairingEnd = workbench.indexOf(
    "if (needsE2eeKey) {",
    directPairingStart,
  );
  const directPairing = workbench.slice(directPairingStart, directPairingEnd);
  const missingKeyEnd = workbench.indexOf(
    "const deviceOnline = Boolean(snapshot?.device.online)",
    directPairingEnd,
  );
  const missingKeyRecovery = workbench.slice(directPairingEnd, missingKeyEnd);

  assert.match(
    workbench,
    /if \(!authenticated \|\| !needsE2eeKey \|\| pairingParameter !== null\) return;[\s\S]*?window\.setTimeout\([\s\S]*?discoverPendingBrowserPairings\(controller\.signal\)/,
    "pending discovery must not override an explicit or malformed pair URL",
  );
  assert.match(
    workbench,
    /if \(!targetPairingId\) \{[\s\S]*?await discoverPendingBrowserPairings[\s\S]*?noPendingBrowserPairing[\s\S]*?discovery\.pairings\.length > 1[\s\S]*?choosePendingComputer[\s\S]*?selected\?\.pairing_id \?\? discovery\.pairings\[0\]\.pairing_id/,
    "connect must fail closed when zero or multiple pending computers cannot be selected",
  );
  assert.match(
    workbench,
    /pendingBrowserDiscovery\.pairings\.length > 1[\s\S]*?id="pending-pairing-device"[\s\S]*?setPendingBrowserPairingId\(event\.target\.value \|\| null\)/,
    "multiple waiting computers need an explicit accessible selector",
  );
  assert.match(
    directPairing,
    /id="pending-pairing-device"[\s\S]{0,100}autoFocus=\{chooseComputer\}/,
    "when discovery replaces the guidance screen, multiple computers should focus the required selector",
  );
  assert.match(
    directPairing,
    /ref=\{pendingPairingDeviceSelectRef\}[\s\S]*?required=\{chooseComputer\}[\s\S]*?aria-invalid=\{computerSelectionError \? true : undefined\}[\s\S]*?pending-pairing-device-error/,
    "the required computer selector must own its validation semantics",
  );
  assert.match(
    directPairing,
    /pairingFormError && !computerSelectionError && !pairingActionError[\s\S]*?pairingCodeError && \([\s\S]*?id="pairing-code-error"/,
    "choosing a computer must not incorrectly mark a valid pairing code as invalid",
  );
  assert.match(
    directPairing,
    /checkingPendingBrowserPairings \|\|[\s\S]*?\(chooseComputer && !pendingBrowserPairingId\) \|\|[\s\S]*?pairingCode\.length !== 9/,
    "the primary action must stay unavailable until the required computer is selected",
  );
  assert.match(
    directPairing,
    /pairingPhase === "activating"[\s\S]*?pairingPhase === "complete"[\s\S]*?authText\(authLocale, "complete"\)/,
    "linkless pairing must announce its terminal connected state before navigation completes",
  );
  assert.match(
    directPairing,
    /pairingBusy && pairingPhase !== "complete" && \([\s\S]*?<span className="spinner" \/>/,
    "the terminal connected state must stop presenting in-progress motion",
  );
  assert.match(
    directPairing,
    /pairingBusy && pairingPhase !== "complete" && \([\s\S]*?className="text-button pairing-cancel-button"/,
    "the completed pairing must not expose a cancel action that can no longer run",
  );
  assert.match(
    workbench,
    /terminalPairingError === "choosePendingComputer"[\s\S]*?requestAnimationFrame[\s\S]*?pendingPairingDeviceSelectRef\.current\?\.focus\(\)/,
    "if an async refresh invalidates the selection, focus must return to the computer selector",
  );
  assert.match(
    directPairing,
    /autoFocus=\{!chooseComputer\}/,
    "a single waiting computer should continue directly at the code field",
  );
  assert.match(
    workbench,
    /checkingPendingBrowserPairings[\s\S]*?pairingCode\.length !== 9/,
    "the connect action must stay unavailable while discovery is unresolved",
  );
  assert.match(
    missingKeyRecovery,
    /checkingPendingBrowserPairings \? \([\s\S]*?className="pairing-discovery-status"[\s\S]*?role="status"[\s\S]*?findingPendingComputer/,
    "slow discovery must expose a visible, polite status instead of showing only first-pairing guidance",
  );
  assert.match(
    workbench,
    /setPendingBrowserDiscoveryError\("pendingComputerDiscoveryFailed"\)/,
    "discovery failures must use a stable localizable error key",
  );
  assert.match(
    workbench,
    /setPendingBrowserDiscovery\(null\);[\s\S]{0,220}setPendingBrowserDiscoveryError\([\s\S]{0,180}"pendingPairingExpired"[\s\S]{0,220}pendingDiscoveryRetryButtonRef\.current\?\.focus\(\)/,
    "a terminal pending request must discard stale choices and expose the existing recovery action",
  );
  assert.match(
    missingKeyRecovery,
    /pendingBrowserDiscoveryError \? \([\s\S]*?role="alert"[\s\S]*?discoverPendingBrowserPairings\(undefined, true\)\.catch/,
    "a failed passive discovery must remain actionable without requiring a reload",
  );
  assert.match(
    workbench,
    /async \(signal\?: AbortSignal, restoreFocusOnResult = false\)[\s\S]*?restoreFocusOnResult && !discovery\.has_bound_computer[\s\S]*?pendingDiscoveryTitleRef\.current\?\.focus\(\)[\s\S]*?if \(restoreFocusOnResult\)[\s\S]*?pendingDiscoveryRetryButtonRef\.current\?\.focus\(\)/,
    "an explicit retry must restore focus for both empty and failed discovery results",
  );
  assert.match(
    missingKeyRecovery,
    /<h1 ref=\{pendingDiscoveryTitleRef\} id="e2ee-title" tabIndex=\{-1\}>/,
    "the no-computer result needs a programmatically focusable context target",
  );
  assert.match(authLanguage, /findingPendingComputer: "正在查找等待连接的电脑"/);
  assert.match(authLanguage, /findingPendingComputer: "Looking for computers waiting to connect"/);
  assert.match(authLanguage, /pendingComputerDiscoveryFailed: "无法检查等待中的电脑。请检查网络后重试。"/);
  assert.match(authLanguage, /pendingComputerDiscoveryFailed: "Could not check for waiting computers\./);
  assert.match(styles, /\.pairing-discovery-status[\s\S]{0,400}min-width: 0/);
  assert.match(styles, /\.pairing-discovery-status \.text-button \{[\s\S]{0,80}min-height: 44px/);
});

test("登录与配对错误按状态码稳定本地化，不透传服务端原文", async () => {
  const [workbench, bundled] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    importWorkbenchEntry(),
  ]);
  try {
    const { authenticationErrorKey } = bundled.entry;
    assert.equal(
      authenticationErrorKey("magicLink", 429, "request_failed"),
      "tooManyAttempts",
    );
    assert.equal(
      authenticationErrorKey("password", 401, "invalid_credentials"),
      "invalidCredentials",
    );
    assert.equal(
      authenticationErrorKey("magicLink", 503, "mail_delivery_failed"),
      "cannotSendVerification",
    );
    assert.equal(
      authenticationErrorKey("password", 0, "network_timeout"),
      "cannotReachRelay",
    );
    assert.equal(
      authenticationErrorKey("setPassword", 401, "invalid_password_setup"),
      "passwordSetupExpired",
    );
    assert.equal(
      authenticationErrorKey("setPassword", 500, "request_failed"),
      "cannotSetPassword",
    );
    assert.doesNotMatch(
      workbench,
      /authLocale === "zh-CN" && error instanceof Error/,
    );
    assert.match(workbench, /class PairingFlowError extends Error/);
    assert.match(workbench, /pairingLinkErrorKey\(error\.status, error\.code\)/);
  } finally {
    await bundled.cleanup();
  }
});

test("邮箱、密码和配对错误保持应用内本地化，并把键盘焦点带回可修正字段", async () => {
  const workbench = await readFile("app/workbench-page.tsx", "utf8");

  assert.match(
    workbench,
    /<form[\s\S]{0,100}className="login-form"[\s\S]{0,100}onSubmit=\{submitEmail\}/,
  );
  assert.match(workbench, /ref=\{emailInputRef\}[\s\S]{0,80}id="email"/);
  assert.match(
    workbench,
    /setEmailError\("invalidEmail"\);\s*emailInputRef\.current\?\.focus\(\)/,
  );
  assert.match(
    workbench,
    /setEmailFlowError\(authenticationErrorFor\("emailStatus", error\)\)/,
    "email status failures must remain visible in the form instead of expiring with the toast timer",
  );
  assert.match(
    workbench,
    /fallbackState === "idle"[\s\S]{0,120}setEmailFlowError\(errorKey\)[\s\S]{0,120}else \{[\s\S]{0,80}setAuthToastKey\(errorKey\)/,
    "initial verification failures stay in the email form while password-reset feedback stays on its current screen",
  );
  assert.match(
    workbench,
    /aria-describedby=\{[\s\S]{0,180}emailFlowError[\s\S]{0,100}"email-flow-error"/,
  );
  assert.match(
    workbench,
    /id="email-flow-error" role="alert"[\s\S]{0,100}authText\(authLocale, emailFlowError\)/,
    "the persistent email-flow error must be announced and retranslated at render time",
  );
  assert.match(workbench, /ref=\{passwordInputRef\}[\s\S]{0,80}id="password"/);
  assert.match(
    workbench,
    /if \(!password\) \{[\s\S]{0,140}passwordInputRef\.current\?\.focus\(\)/,
  );
  assert.match(
    workbench,
    /error instanceof RelayApiError && error\.code === "invalid_credentials"[\s\S]{0,220}passwordInputRef\.current\?\.focus\(\);[\s\S]{0,80}passwordInputRef\.current\?\.select\(\)/,
  );
  assert.match(
    workbench,
    /setPasswordError\(authenticationErrorFor\("password", error\)\)/,
  );
  assert.match(
    workbench,
    /aria-invalid=\{passwordError \? true : undefined\}[\s\S]{0,240}aria-describedby=\{\s*passwordError \? "password-error" : undefined\s*\}/,
  );
  assert.match(
    workbench,
    /setPassword\(event\.target\.value\);\s*if \(passwordError\) setPasswordError\(null\)/,
  );
  assert.match(
    workbench,
    /id="password-error" role="alert"/,
  );
  assert.match(workbench, /setPairingFormError\(pairingErrorKey\)/);
  assert.match(
    workbench,
    /pairingErrorKey === "secureConnectionFailed"[\s\S]{0,180}pairingCodeInputRef\.current\?\.focus\(\)/,
  );
  assert.match(
    workbench,
    /aria-invalid=\{pairingCodeError \? true : undefined\}[\s\S]{0,240}aria-describedby=\{\s*pairingCodeError\s*\? "pairing-code-help pairing-code-error"\s*: "pairing-code-help"\s*\}/,
    "the correctable code error must be appended to the persistent code-source help",
  );
  assert.match(
    workbench,
    /setPairingCode\(pairingCodeInput\(event\.target\.value\)\);\s*if \(pairingCodeError\) setPairingFormError\(null\)/,
  );
  assert.match(workbench, /id="pairing-code-error" role="alert"/);
  assert.match(
    workbench,
    /pairingFormError === "cannotReachRelay" \? pairingFormError : null[\s\S]*?aria-describedby=\{[\s\S]{0,100}pairingActionError \? "pairing-action-error" : undefined[\s\S]*?id="pairing-action-error" role="alert"/,
    "network failures must be owned by the focused retry action rather than invalidating the code",
  );
  assert.match(
    workbench,
    /if \(pairingAbort\.current \|\| pairingPhase !== "idle"\) return;/,
  );
  assert.match(
    workbench,
    /<form[\s\S]{0,120}onSubmit=\{connectMac\}[\s\S]{0,100}aria-busy=\{pairingBusy\}/,
  );
  const pairingInputStart = workbench.indexOf('id="pairing-code"');
  const pairingInputEnd = workbench.indexOf("/>", pairingInputStart);
  assert.notEqual(pairingInputStart, -1);
  assert.notEqual(pairingInputEnd, -1);
  const pairingInput = workbench.slice(pairingInputStart, pairingInputEnd);
  assert.match(pairingInput, /readOnly=\{pairingBusy\}/);
  assert.doesNotMatch(pairingInput, /disabled=/);
  assert.match(
    workbench,
    /className="login-sr-only"[\s\S]{0,120}role="status"[\s\S]{0,120}aria-atomic="true"[\s\S]{0,100}\{pairingBusy \? pairingButtonLabel : ""\}/,
  );
  assert.match(
    workbench,
    /<form[\s\S]{0,100}className="login-form"[\s\S]{0,100}onSubmit=\{submitNewPassword\}/,
  );
  assert.match(workbench, /ref=\{passwordInputRef\}[\s\S]{0,80}id="new-password"/);
  assert.match(
    workbench,
    /password\.length < 8[\s\S]{0,160}passwordInputRef\.current\?\.focus\(\)/,
  );
  assert.match(
    workbench,
    /setNewPasswordError\("passwordTooShort"\)/,
  );
  assert.match(
    workbench,
    /aria-invalid=\{newPasswordError \? true : undefined\}[\s\S]{0,240}newPasswordError[\s\S]{0,100}"new-password-requirement new-password-error"[\s\S]{0,100}: "new-password-requirement"/,
  );
  assert.match(
    workbench,
    /className="password-requirement" id="new-password-requirement"[\s\S]{0,100}authText\(authLocale, "passwordRequirement"\)/,
  );
  assert.match(
    workbench,
    /id="new-password-error"[\s\S]{0,60}role="alert"/,
  );
  assert.match(
    workbench,
    /password !== passwordConfirmation[\s\S]{0,180}passwordConfirmationInputRef\.current\?\.focus\(\)/,
  );
  assert.match(
    workbench,
    /setPasswordConfirmationError\("passwordsMismatch"\)/,
  );
  assert.match(
    workbench,
    /id="confirm-password-error"[\s\S]{0,60}role="alert"/,
  );
  assert.match(
    workbench,
    /const errorKey = authenticationErrorFor\("setPassword", error\);[\s\S]{0,180}setPasswordSetupError\(errorKey\)/,
  );
  assert.match(
    workbench,
    /id="password-setup-error"[\s\S]{0,60}role="alert"/,
  );
  assert.match(workbench, /\{authText\(authLocale, emailError\)\}/);
  assert.match(workbench, /\{authText\(authLocale, passwordError\)\}/);
  assert.match(workbench, /\{authText\(authLocale, pairingFormError\)\}/);
});

test("邮箱与密码慢请求向读屏持续播报当前本地化状态", async () => {
  const workbench = await readFile("app/workbench-page.tsx", "utf8");

  assert.match(
    workbench,
    /onSubmit=\{submitNewPassword\}[\s\S]{0,140}aria-busy=\{loginState === "saving-password"\}/,
  );
  assert.match(
    workbench,
    /loginState === "saving-password"[\s\S]{0,120}authText\(authLocale, "saving"\)/,
  );
  assert.match(
    workbench,
    /onSubmit=\{submitPassword\}[\s\S]{0,220}aria-busy=\{[\s\S]{0,120}loginState === "authenticating"[\s\S]{0,100}loginState === "sending-reset"/,
  );
  assert.match(
    workbench,
    /loginState === "authenticating"[\s\S]{0,120}authText\(authLocale, "signingIn"\)[\s\S]{0,160}loginState === "sending-reset"[\s\S]{0,120}authText\(authLocale, "sendingVerification"\)/,
  );
  assert.match(
    workbench,
    /onSubmit=\{submitEmail\}[\s\S]{0,200}aria-busy=\{[\s\S]{0,120}loginState === "checking"[\s\S]{0,100}loginState === "sending"/,
  );
  assert.match(
    workbench,
    /loginState === "checking"[\s\S]{0,120}authText\(authLocale, "checking"\)[\s\S]{0,160}loginState === "sending"[\s\S]{0,120}authText\(authLocale, "sendingVerificationEmail"\)/,
  );
  assert.ok(
    (workbench.match(/className="login-sr-only"[\s\S]{0,100}role="status"[\s\S]{0,100}aria-live="polite"[\s\S]{0,100}aria-atomic="true"/g)?.length ?? 0) >= 4,
  );
});

test("工作台消息发送有界、保留焦点并持续播报双语状态", async () => {
  const workbench = await readFile("app/workbench-page.tsx", "utf8");

  assert.doesNotMatch(workbench, /readOnly=\{sendingMessage\}/);
  assert.match(workbench, /const \[sendingMessage, setSendingMessage\] = useState\(false\)/);
  assert.match(workbench, /const messageSendInFlight = useRef\(false\)/);
  assert.match(
    workbench,
    /async function sendMessage[\s\S]{0,160}if \(messageSendInFlight\.current\) return;[\s\S]{0,1000}messageSendInFlight\.current = true;[\s\S]{0,120}setSendingMessage\(true\);[\s\S]{0,600}composerInput\.current\?\.focus\(\)/,
  );
  assert.match(
    workbench,
    /catch \(error\) \{[\s\S]{0,100}setDraft\(\(nextDraft\) => restoreFailedComposerDraft\(submittedDraft, nextDraft\)\);[\s\S]{0,700}finally \{[\s\S]{0,120}messageSendInFlight\.current = false;[\s\S]{0,100}setSendingMessage\(false\)/,
    "failed payload restoration preserves newer input",
  );
  assert.match(
    workbench,
    /className="composer"[\s\S]{0,120}aria-busy=\{sendingMessage \|\| stoppingTurn\}/,
  );
  assert.match(
    workbench,
    /className="send-button"[\s\S]{0,260}disabled=\{[\s\S]{0,100}stoppingTurn[\s\S]{0,100}sendingMessage[\s\S]{0,520}aria-busy=\{sendingMessage\}[\s\S]{0,400}\? "sendingMessage"/,
  );
  assert.match(
    workbench,
    /role="status"[\s\S]{0,100}aria-live="polite"[\s\S]{0,500}: sendingMessage[\s\S]{0,100}\? workbenchText\(authLocale, "sendingMessage"\)/,
  );
});

test("停止当前任务的慢请求防重、持续播报并确定恢复焦点", async () => {
  const workbench = await readFile("app/workbench-page.tsx", "utf8");

  assert.match(workbench, /const \[stoppingTurn, setStoppingTurn\] = useState\(false\)/);
  assert.match(
    workbench,
    /async function interruptTurn\(\)[\s\S]{0,240}turnInterruptInFlight\.current[\s\S]{0,120}turnInterruptInFlight\.current = true;[\s\S]{0,80}setStoppingTurn\(true\)/,
    "the ref gate must close synchronously before React can render the busy state",
  );
  assert.match(
    workbench,
    /setToast\(\{ key: "stopRequested"[\s\S]{0,160}composerInput\.current\?\.focus\(\)[\s\S]{0,240}catch \(error\)[\s\S]{0,220}stopTurnButtonRef\.current\?\.focus\(\)[\s\S]{0,180}finally \{[\s\S]{0,120}turnInterruptInFlight\.current = false;[\s\S]{0,80}setStoppingTurn\(false\)/,
  );
  assert.match(
    workbench,
    /className="stop-button"[\s\S]{0,220}aria-disabled=\{stoppingTurn \|\| undefined\}[\s\S]{0,80}aria-busy=\{stoppingTurn\}[\s\S]{0,180}stoppingTurn \? "requestingStop" : "stopCurrentTask"/,
  );
  assert.match(
    workbench,
    /className="send-button"[\s\S]{0,160}disabled=\{\s*stoppingTurn \|\|\s*sendingMessage/,
    "a steering message must not race the accepted stop request",
  );
  assert.match(
    workbench,
    /role="status"[\s\S]{0,100}aria-live="polite"[\s\S]{0,180}stoppingTurn[\s\S]{0,100}workbenchText\(authLocale, "requestingStop"\)/,
  );
});

test("工作台新增子 Agent 的自动滚动遵循系统减少动态效果偏好", async () => {
  const workbench = await readFile("app/workbench-page.tsx", "utf8");
  const effectStart = workbench.indexOf(
    "if (!freshActiveAgentSignature) return;",
  );
  const effectEnd = workbench.indexOf(
    "}, [freshActiveAgentSignature]);",
    effectStart,
  );
  assert.notEqual(effectStart, -1);
  assert.notEqual(effectEnd, -1);
  const autoScrollEffect = workbench.slice(effectStart, effectEnd);

  assert.match(
    autoScrollEffect,
    /window\.matchMedia\(\s*"\(prefers-reduced-motion: reduce\)",?\s*\)\.matches/,
  );
  assert.match(
    autoScrollEffect,
    /scrollElement\.scrollTo\(\{[\s\S]{0,140}behavior: reduceMotion \? "auto" : "smooth"/,
  );
  assert.doesNotMatch(
    autoScrollEffect,
    /behavior: "smooth"/,
    "system reduced-motion must override programmatic smooth scrolling too",
  );
});

test("验证邮件成功后把键盘与读屏上下文送到下一步标题", async () => {
  const workbench = await readFile("app/workbench-page.tsx", "utf8");
  const styles = await readFile("app/workbench.css", "utf8");

  assert.match(
    workbench,
    /const verificationSentTitleRef = useRef<HTMLHeadingElement \| null>\(null\)/,
  );
  assert.match(
    workbench,
    /if \(loginState !== "sent"\) return;[\s\S]{0,180}verificationSentTitleRef\.current\?\.focus\(\)[\s\S]{0,120}\}, \[loginState\]\);/,
  );
  assert.doesNotMatch(
    workbench,
    /verificationSentTitleRef\.current\?\.focus\(\)[\s\S]{0,120}\}, \[[^\]]*authLocale/,
  );
  assert.match(
    workbench,
    /<section[\s\S]{0,120}className="login-sent"[\s\S]{0,120}aria-labelledby="verification-sent-title"/,
  );
  assert.match(
    workbench,
    /id="verification-sent-title"[\s\S]{0,100}ref=\{verificationSentTitleRef\}[\s\S]{0,100}tabIndex=\{-1\}/,
  );
  assert.match(
    styles,
    /\.login-card h2\[tabindex="-1"\]:focus-visible/,
  );
});

test("Web 退出慢请求防止重复提交并持续播报状态", async () => {
  const workbench = await readFile("app/workbench-page.tsx", "utf8");

  assert.match(workbench, /const \[loggingOut, setLoggingOut\] = useState\(false\)/);
  assert.match(workbench, /const logoutInFlight = useRef\(false\)/);
  assert.match(
    workbench,
    /async function logout\(\) \{\s*if \(logoutInFlight\.current\) return;\s*logoutInFlight\.current = true;\s*setLoggingOut\(true\)/,
  );
  assert.match(
    workbench,
    /finally \{\s*logoutInFlight\.current = false;\s*setLoggingOut\(false\)/,
  );
  assert.match(
    workbench,
    /className="text-button"[\s\S]{0,180}aria-busy=\{loggingOut\}[\s\S]{0,100}disabled=\{loggingOut\}[\s\S]{0,180}loggingOut \? "signingOut" : "signOut"/,
  );
  assert.match(
    workbench,
    /className="account-menu-sign-out"[\s\S]{0,180}aria-busy=\{loggingOut\}[\s\S]{0,100}disabled=\{loggingOut\}[\s\S]{0,100}onClick=\{\(\) => void logout\(\)\}/,
  );
  assert.ok(
    (workbench.match(/\{loggingOut\s*\?\s*authText\(authLocale, "signingOut"\)/g)?.length ?? 0) >= 2,
  );
});

test("Web 头像只打开账户面板，退出需要明确操作", async () => {
  const workbench = await readFile("app/workbench-page.tsx", "utf8");
  const avatarStart = workbench.indexOf('className="avatar-button sidebar-account-button"');
  const avatarEnd = workbench.indexOf("</button>", avatarStart);
  const avatarButton = workbench.slice(avatarStart, avatarEnd);

  assert.notEqual(avatarStart, -1);
  assert.ok(avatarStart > workbench.indexOf('className="sidebar-support-footer"'));
  assert.ok(avatarStart < workbench.indexOf('</aside>', avatarStart));
  assert.match(
    avatarButton,
    /aria-label=\{workbenchText\(authLocale, "openAccountMenu"\)\}/,
  );
  assert.match(avatarButton, /aria-haspopup="dialog"/);
  assert.match(avatarButton, /aria-expanded=\{accountMenuOpen\}/);
  assert.match(
    avatarButton,
    /onClick=\{\(\) => setAccountMenuOpen\(\(open\) => !open\)\}/,
  );
  assert.doesNotMatch(avatarButton, /logout\(/);
  assert.match(
    workbench,
    /accountMenuOpen && \([\s\S]{0,500}role="dialog"[\s\S]{0,2200}onClick=\{\(\) => void logout\(\)\}/,
  );
  assert.match(
    workbench,
    /if \(!accountMenuOpen\) return;[\s\S]{0,800}event\.key !== "Escape"[\s\S]{0,200}accountMenuButtonRef\.current\?\.focus\(\)/,
  );
  assert.match(
    workbench,
    /!accountMenuContainerRef\.current\?\.contains\(target\)[\s\S]{0,100}setAccountMenuOpen\(false\)/,
  );
});

test("返回营销页会取消认证慢请求并拒绝晚到状态", async () => {
  const workbench = await readFile("app/workbench-page.tsx", "utf8");

  assert.match(
    workbench,
    /const authRequestAbort = useRef<AbortController \| null>\(null\)/,
  );
  assert.match(
    workbench,
    /!hasAuthenticationEntry\(window\.location\.search\)[\s\S]{0,160}authRequestAbort\.current\?\.abort\(\);[\s\S]{0,100}authRequestAbort\.current = null;[\s\S]{0,500}setLoginState\("idle"\)[\s\S]{0,500}setAuthToastKey\(null\)[\s\S]{0,100}setShowLogin\(false\)/,
  );
  assert.match(
    workbench,
    /useEffect\(\(\) => \(\) => authRequestAbort\.current\?\.abort\(\), \[\]\)/,
  );
  assert.match(
    workbench,
    /function beginAuthenticationRequest\(\)[\s\S]{0,180}authRequestAbort\.current\?\.abort\(\)[\s\S]{0,160}return controller/,
  );
  for (const path of [
    "/api/auth/email-status",
    "/api/auth/magic-link",
    "/api/auth/password",
    "/api/auth/set-password",
  ]) {
    const requestStart = workbench.indexOf(`\"${path}\"`);
    assert.notEqual(requestStart, -1, `${path} request exists`);
    const request = workbench.slice(requestStart, requestStart + 500);
    assert.match(request, /signal: controller\.signal/);
  }
  const authenticationStart = workbench.indexOf("  async function submitEmail(");
  const authenticationEnd = workbench.indexOf("  function returnToRelayuneDesktop(", authenticationStart);
  assert.notEqual(authenticationStart, -1);
  assert.ok(authenticationEnd > authenticationStart);
  const authentication = workbench.slice(authenticationStart, authenticationEnd);
  assert.equal(
    authentication.match(/locale: authLocale,/g)?.length,
    2,
    "initial and repeated verification emails should follow the selected UI language",
  );
  assert.equal(
    authentication.match(/if \(controller\.signal\.aborted\) return;/g)?.length,
    5,
  );
  assert.equal(
    authentication.match(/finishAuthenticationRequest\(controller\);/g)?.length,
    5,
  );
});

test("已有浏览器凭据只对正式 bootstrap 探测发送设备和浏览器令牌", async () => {
  const bundled = await importWorkbenchEntry();
  try {
    const { shouldOpenWorkbench } = bundled.entry;
    const controller = new AbortController();
    let request;
    const authenticated = await shouldOpenWorkbench(controller.signal, {
      apiBase: "https://relay.test",
      loadStoredCredential: async () => ({
        deviceId: "dev_existing",
        browserToken: "browser-secret",
      }),
      fetcher: async (url, options) => {
        request = { url, options };
        return Response.json({ user: { email: "user@example.com" } });
      },
    });

    assert.equal(authenticated, true);
    assert.equal(
      request.url,
      "https://relay.test/api/bootstrap?device_id=dev_existing",
    );
    assert.match(request.options.headers.get("X-Relay-Client-Version"), /^\d+\.\d+\.\d+/);
    assert.equal(request.options.credentials, "include");
    assert.equal(request.options.signal, controller.signal);
    assert.equal(
      request.options.headers.get("X-Relay-Browser-Token"),
      "browser-secret",
    );
  } finally {
    await bundled.cleanup();
  }
});

test("匿名会话留在营销页，失效的浏览器设备绑定进入原工作台恢复流程", async () => {
  const bundled = await importWorkbenchEntry();
  try {
    const { isBrowserAuthorizationLost, shouldOpenWorkbench } = bundled.entry;
    const controller = new AbortController();
    const probe = (code, status = 401) =>
      shouldOpenWorkbench(controller.signal, {
        apiBase: "https://relay.test",
        loadStoredCredential: async () => null,
        fetcher: async () =>
          Response.json({ error: { code } }, { status }),
      });

    assert.equal(await probe("authentication_required"), false);
    assert.equal(await probe("browser_unauthorized"), true);
    assert.equal(await probe("device_not_found", 404), true);
    assert.equal(await probe("service_unavailable", 503), false);
    assert.equal(isBrowserAuthorizationLost(401, "browser_unauthorized"), true);
    assert.equal(isBrowserAuthorizationLost(404, "device_not_found"), true);
    assert.equal(isBrowserAuthorizationLost(404, "response_pending"), false);
  } finally {
    await bundled.cleanup();
  }
});

test("本机凭据读取失败时不发送浏览器令牌", async () => {
  const bundled = await importWorkbenchEntry();
  try {
    const { shouldOpenWorkbench } = bundled.entry;
    let sentToken;
    const authenticated = await shouldOpenWorkbench(
      new AbortController().signal,
      {
        apiBase: "https://relay.test",
        loadStoredCredential: async () => {
          throw new Error("IndexedDB unavailable");
        },
        fetcher: async (_url, options) => {
          sentToken = options.headers.get("X-Relay-Browser-Token");
          return Response.json(
            { error: { code: "authentication_required" } },
            { status: 401 },
          );
        },
      },
    );

    assert.equal(authenticated, false);
    assert.equal(sentToken, null);
  } finally {
    await bundled.cleanup();
  }
});

test("退出必须等服务器确认；断网、拒绝及异常响应均保留本地会话，允许重试", async () => {
  const bundled = await importWorkbenchEntry();
  try {
    const { logoutAfterConfirmation } = bundled.entry;
    for (const request of [
      async () => { throw new TypeError("network unavailable"); },
      async () => { throw Object.assign(new Error("forbidden"), { status: 403 }); },
      async () => ({}),
      async () => ({ authenticated: true }),
      async () => null,
    ]) {
      let cleared = false;
      const clear = async () => { cleared = true; };
      await assert.rejects(logoutAfterConfirmation(request, clear));
      assert.equal(cleared, false);
      await logoutAfterConfirmation(async () => ({ authenticated: false }), clear);
      assert.equal(cleared, true);
    }
    let confirm;
    let cleared = false;
    const pending = logoutAfterConfirmation(
      () => new Promise(resolve => { confirm = resolve; }),
      async () => { cleared = true; },
    );
    await Promise.resolve();
    assert.equal(cleared, false);
    confirm({ authenticated: false });
    await pending;
    assert.equal(cleared, true);
  } finally { await bundled.cleanup(); }
});

test("审核账号进入可退出的明确错误页，不当作网络故障或丢失客户端授权", async () => {
  const bundled = await importWorkbenchEntry();
  try {
    const { shouldOpenWorkbench, isReviewAccountIsolated, isBrowserAuthorizationLost } = bundled.entry;
    assert.equal(isReviewAccountIsolated(403, "review_demo_isolated"), true);
    assert.equal(isReviewAccountIsolated(403, "forbidden"), false);
    assert.equal(isReviewAccountIsolated(500, "review_demo_isolated"), false);
    assert.equal(isBrowserAuthorizationLost(403, "review_demo_isolated"), false);
    assert.equal(await shouldOpenWorkbench(new AbortController().signal, {
      loadStoredCredential: async () => null,
      fetcher: async () => new Response(JSON.stringify({ error: { code: "review_demo_isolated" } }), { status: 403 }),
    }), true);
    const source = await readFile("app/workbench-page.tsx", "utf8");
    const logout = source.slice(source.indexOf("  async function logout()"), source.indexOf("  async function retryBootstrap()"));
    assert.match(logout, /await logoutAfterConfirmation\(/);
    assert.doesNotMatch(logout, /api\("\/api\/auth\/logout"[^\n]*\.catch/);
    assert.match(logout, /catch \{\s*setLogoutFailed\(true\)/);
    assert.match(logout, /setBootstrapErrorKind\(null\)/);
    const errorPage = source.slice(source.indexOf("  if ((bootstrapError || instanceError) && !invalidPairingEntry"), source.indexOf("  if (invalidPairingEntry)"));
    assert.match(errorPage, /reviewIsolatedTitle/);
    assert.match(errorPage, /logout\(\) : retryBootstrap\(\)/);
    assert.match(errorPage, /\{logoutError\}/);
  } finally { await bundled.cleanup(); }
});
