import type {
  AgentRuntimeAvailability,
  Bootstrap,
  RelayProvider,
  RelaySnapshot,
} from "./types";
import { isAppLocale, type AppLocale } from "./i18n";

type QaScenario =
  | "preparing"
  | "startup-failure"
  | "initial"
  | "connected"
  | "relay-error";

type QaActionStep = {
  selector: string;
  click?: boolean;
  expectDisabled?: boolean;
  expectText?: string;
  setValue?: string;
  expectValue?: string;
  expectChecked?: boolean;
};

type TauriInternals = {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  transformCallback: (callback?: (payload: unknown) => void, once?: boolean) => number;
  unregisterCallback: (id: number) => void;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals;
  }
}

const QA_QUERY_KEY = "relayune-desktop-qa";

export function desktopQaActionSteps(
  action: string | null,
  scenario: QaScenario,
): QaActionStep[] {
  const actions: Record<string, QaActionStep[]> = {
    feedback: [
      { selector: "#open-settings", click: true },
      { selector: "#open-feedback", click: true },
      { selector: ".feedback-info dd", expectText: "0.3.17-qa" },
    ],
    "feedback-submit": [
      { selector: "#open-settings", click: true },
      { selector: "#open-feedback", click: true },
      { selector: ".feedback-description textarea", setValue: "QA feedback: improve task switching" },
      { selector: ".feedback-card button[type=submit]:not(:disabled)", click: true },
      { selector: ".feedback-reference" },
    ],
    retry: [{ selector: "#startup-retry", click: true }],
    pair: [{ selector: "#login-button", click: true }],
    "pair-cancel": [
      { selector: "#login-button", click: true },
      { selector: "#pairing-code:not(:empty)" },
      { selector: "#login-cancel-pairing", click: true },
    ],
    "pair-open-failure": [
      { selector: "#login-button", click: true },
      { selector: "#pairing-code:not(:empty)" },
      { selector: "#login-open-pairing-page", click: true },
      { selector: "#login-cancel-pairing:not(:disabled)" },
    ],
    "browser-pair": [{ selector: "[data-add-browser], #new-pairing", click: true }],
    "browser-pair-cancel": [
      { selector: "[data-add-browser], #new-pairing", click: true },
      { selector: "#replacement-pairing-code:not(:empty)" },
      { selector: "#cancel-pairing", click: true },
    ],
    settings: [{ selector: "#open-settings", click: true }],
    "folder-access": [
      { selector: "#login-button", click: true },
      { selector: "#account-card:not(.is-hidden)" },
      { selector: "#workspace-access-dialog:not([open])" },
      { selector: "#prepare-task-files", click: true },
      { selector: "#workspace-access-dialog[open]" },
      { selector: "#workspace-access-continue", click: true },
    ],
    "settings-cancel": [
      { selector: "#open-settings", click: true },
      { selector: "#settings-dialog[open]" },
      { selector: "#settings-cancel", click: true },
    ],
    "settings-draft-language": [
      { selector: "#open-settings", click: true },
      { selector: "#settings-dialog[open]" },
      { selector: "#launch-at-login", click: true },
      { selector: '[data-language="en"]', click: true },
      { selector: "#launch-at-login", expectChecked: false },
    ],
    "settings-pending-language": [
      { selector: "#open-settings", click: true },
      { selector: "#settings-dialog[open]" },
      { selector: "#launch-at-login", click: true },
      { selector: "#save-settings", click: true },
      { selector: "#save-settings", expectDisabled: true },
      { selector: '[data-language="en"]', click: true },
      { selector: "#save-settings", expectDisabled: true, expectText: "Saving…" },
    ],
    "startup-settings-unavailable": [
      { selector: "#open-settings", click: true },
      { selector: "#settings-dialog[open]" },
      { selector: "#settings-runtime.is-hidden" },
    ],
    "startup-slow-diagnostics": [
      { selector: '#startup-message[data-i18n="stillPreparing"]' },
      { selector: "#startup-diagnostics", click: true },
      { selector: "#diagnostics-dialog[open]" },
      { selector: 'html[data-relayune-qa-bootstrap-attempts="1"]' },
    ],
    "startup-slow-retry": [
      { selector: '#startup-message[data-i18n="stillPreparing"]' },
      { selector: "#startup-retry:not(.is-hidden)", click: true },
      { selector: "#login-view:not(.is-hidden)" },
      { selector: 'html[data-relayune-qa-bootstrap-attempts="2"]' },
    ],
    "startup-slow-language": [
      { selector: '#startup-message[data-i18n="stillPreparing"]' },
      { selector: "#open-settings", click: true },
      { selector: "#settings-dialog[open]" },
      { selector: '[data-language="en"]', click: true },
      {
        selector: '#startup-message[data-i18n="stillPreparing"]',
        expectText:
          "This is taking longer than usual. Try again or open Help & Diagnostics; an older result will not replace the newer state.",
      },
    ],
    "startup-diagnostics-language": [
      { selector: "#startup-retry:not(.is-hidden)" },
      { selector: "#open-settings", click: true },
      { selector: "#settings-dialog[open]" },
      { selector: '[data-language="en"]', click: true },
      { selector: "#settings-close", click: true },
      { selector: "#startup-diagnostics", click: true },
      { selector: "#diagnostics-dialog[open]" },
    ],
    "relay-retry-language": [
      { selector: "#retry-relay", click: true },
      { selector: '#status-card[data-tone="success"]' },
      { selector: "#open-settings", click: true },
      { selector: "#settings-dialog[open]" },
      { selector: '[data-language="en"]', click: true },
      { selector: '#status-card[data-tone="success"]' },
    ],
    diagnostics: [{
      selector: scenario === "startup-failure" ? "#startup-diagnostics" : "#open-diagnostics",
      click: true,
    }],
    logout: [{ selector: "#logout-button", click: true }],
    "logout-confirm": [
      { selector: "#logout-button", click: true },
      { selector: "#logout-dialog[open]" },
      { selector: "#confirm-logout", click: true },
    ],
    "logout-pending-lock": [
      { selector: "#logout-button", click: true },
      { selector: "#logout-dialog[open]" },
      { selector: "#confirm-logout", click: true },
      { selector: "#cancel-logout", expectDisabled: true },
      { selector: "#confirm-logout", expectDisabled: true },
    ],
    "revoke-pending-lock": [
      { selector: "[data-revoke-browser]", click: true },
      { selector: "#revoke-browser-dialog[open]" },
      { selector: "#confirm-revoke-browser", click: true },
      { selector: "#cancel-revoke-browser", expectDisabled: true },
      { selector: "#confirm-revoke-browser", expectDisabled: true },
    ],
    revoke: [{ selector: "[data-revoke-browser]", click: true }],
  };
  return action ? actions[action] ?? [] : [];
}

function relaySnapshot(phase: RelaySnapshot["phase"]): RelaySnapshot {
  const failed = phase === "error";
  return {
    phase,
    pid: phase === "connected" ? 2408 : null,
    started_at: phase === "connected" ? "2026-08-09T08:08:00.000Z" : null,
    last_error: failed ? "relayune:relay_start_failed" : null,
    logs: failed
      ? [{ at: "2026-08-09T08:08:00.000Z", level: "error", message: "relayune:diagnostic_hidden" }]
      : [{ at: "2026-08-09T08:08:00.000Z", level: "info", message: "relayune:relay_connected" }],
  };
}

function initialBootstrap(
  scenario: QaScenario,
  locale: AppLocale,
  platform: "macos" | "windows",
): Bootstrap {
  const connected = scenario === "connected" || scenario === "relay-error";
  return {
    config: {
      server_url: "https://relayune.giraffetree.cn",
      device_id: connected ? "qa-device" : "",
      account_email: connected ? "relayune-qa@example.com" : null,
      adapter: "multi",
      default_provider: "codex",
      workspace: platform === "windows" ? "C:\\Relayune QA Workspace" : "/Relayune QA Workspace",
      codex_bin: "codex",
      kimi_bin: "kimi",
      claude_bin: "claude",
      state_path: "relayune-qa-state",
      browser_ids: connected ? ["qa-browser-primary"] : [],
      start_relay_on_launch: true,
      ui_language: locale,
    },
    secrets: {
      device_token: connected,
      e2ee_key: connected,
    },
    relay: relaySnapshot(scenario === "relay-error" ? "error" : connected ? "connected" : "stopped"),
    launch_at_login: true,
    version: "0.3.17-qa",
    platform: {
      os: platform,
      arch: platform === "windows" ? "x86_64" : "aarch64",
      update_target: platform === "windows" ? "windows-x86_64" : "darwin-aarch64",
      os_version: platform === "windows" ? null : "15.6",
    },
  };
}

/**
 * Installs a local-only Tauri bridge for visual QA in a normal browser.
 * It never records invoke arguments, PAKE shares, generated short codes, or
 * request bodies. Vite removes the caller from production builds because it
 * is guarded by import.meta.env.DEV.
 */
export function installDesktopQaHarness(): AppLocale | null {
  const query = new URLSearchParams(window.location.search);
  const rawScenario = query.get(QA_QUERY_KEY);
  if (!rawScenario || window.__TAURI_INTERNALS__) return null;
  const scenario = (
    ["preparing", "startup-failure", "initial", "connected", "relay-error"].includes(rawScenario)
      ? rawScenario
      : "initial"
  ) as QaScenario;
  const requestedLocale = query.get("lang");
  const locale = isAppLocale(requestedLocale) ? requestedLocale : "zh-CN";
  const platform = query.get("platform") === "windows" ? "windows" : "macos";
  const pairingRecovery = query.get("pairing") === "recovering";
  const startRecovery = query.get("start") === "recover-once";
  const failBrowserOpen = query.get("open") === "fail";
  const failBrowserList = query.get("browser-list") === "fail";
  const agentScenario = query.get("agent");
  const slowLogout = query.get("logout") === "slow";
  const slowRevoke = query.get("revoke") === "slow";
  const slowSave = query.get("save") === "slow";
  let bootstrap = initialBootstrap(scenario, locale, platform);
  // Browser-only fixture; never reads or changes the running app's power policy.
  let keepAwakeMode = "off";
  let agentAvailability: AgentRuntimeAvailability[] = [
    {
      provider: "codex",
      status: agentScenario === "missing" ? "not_installed" : "ready",
      version: agentScenario === "missing" ? null : "0.143.0",
      minimum_version: "0.143.0",
    },
    {
      provider: "kimi",
      status: agentScenario === "login" ? "not_logged_in" : "ready",
      version: "0.38.0",
      minimum_version: "0.38.0",
    },
    {
      provider: "claude",
      status: agentScenario === "outdated" ? "outdated" : "ready",
      version: agentScenario === "outdated" ? "2.1.100" : "2.1.177",
      minimum_version: "2.1.177",
    },
  ];
  if (query.get("agents") === "all") agentAvailability.push(
    { provider: "opencode", status: "not_installed", version: null, minimum_version: "1.0.0" },
    { provider: "zcode", status: "not_installed", version: null, minimum_version: "1.0.0" },
  );
  let bootstrapAttempts = 0;
  let pairingStartAttempts = 0;
  let callbackId = 0;
  const callbacks = new Map<number, (payload: unknown) => void>();
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const desktopLoginPrefix = `${bootstrap.config.server_url}/api/desktop-login`;
    if (url.startsWith(desktopLoginPrefix)) {
      const expiresAt = new Date(Date.now() + 9 * 60_000 + 42_000).toISOString();
      if (url.endsWith("/start")) {
        return Response.json({
          request_id: `dlogin_${"A".repeat(43)}`,
          poll_secret: "B".repeat(43),
          status: "waiting",
          expires_at: expiresAt,
        });
      }
      if (url.endsWith("/cancel")) {
        return Response.json({ status: "cancelled" });
      }
      return Response.json({
        request_id: `dlogin_${"A".repeat(43)}`,
        status: "approved",
        device_id: `dev_${"a".repeat(32)}`,
        account_email: "relayune-qa@example.com",
        expires_at: expiresAt,
      });
    }
    if (!url.startsWith(`${bootstrap.config.server_url}/api/pairings/`)) {
      return originalFetch(input, init);
    }
    const expiresAt = new Date(Date.now() + 9 * 60_000 + 42_000).toISOString();
    if (url.endsWith("/start")) {
      pairingStartAttempts += 1;
      if (startRecovery && pairingStartAttempts === 1) {
        return Response.json(
          { error: { code: "service_unavailable" } },
          { status: 503 },
        );
      }
      return Response.json({ expires_at: expiresAt });
    }
    if (pairingRecovery) {
      return Response.json({ error: { code: "service_unavailable" } }, { status: 503 });
    }
    return Response.json({
      pairing_id: url.split("/").at(-1) ?? "",
      protocol: "SPAKE2-P256-SHA256-HKDF-HMAC",
      mode: "initial",
      initiator_share: "public-share-hidden-by-qa",
      responder_share: null,
      responder_confirm: null,
      desktop_confirm: null,
      device_id: null,
      browser_id: null,
      status: "waiting",
      expires_at: expiresAt,
    });
  };

  const invoke: TauriInternals["invoke"] = async (command, args = {}) => {
    switch (command) {
      case "set_keep_awake_mode":
        if (query.get("power") === "save-failure") throw new Error("relayune:keep_awake_failed");
        keepAwakeMode = String(args.mode);
        // falls through to the same confirmed state returned by a status read
      case "get_keep_awake_status":
        return {
          mode: keepAwakeMode,
          supported: platform === "macos",
          active: keepAwakeMode === "always" || (keepAwakeMode === "ac_power" && query.get("power") !== "battery"),
          error: false,
        };
      case "open_lock_screen_settings":
        document.documentElement.dataset.relayuneQaLockSettingsOpened = "true";
        return null;
      case "plugin:event|listen":
        if (args.event === "relay-status" && query.has("presence")) {
          const report = () => {
            bootstrap.relay.online_browser_ids = query.get("presence") === "offline" ? [] : ["qa-browser-primary"];
            bootstrap.relay.browser_presence_observed_at = Date.now();
            callbacks.get(Number(args.handler))?.({ event: "relay-status", id: callbackId, payload: structuredClone(bootstrap.relay) });
          };
          window.setTimeout(report, 100);
          if (query.get("presence") !== "expire") window.setInterval(report, 2_000);
        }
        return ++callbackId;
      case "plugin:event|unlisten":
      case "plugin:updater|download":
      case "plugin:updater|install":
      case "plugin:process|exit":
      case "show_main_window":
      case "open_public_page":
        return null;
      case "open_relay_web":
        document.documentElement.dataset.relayuneQaWorkspaceOpened = "true";
        return null;
      case "plugin:updater|check":
        return null;
      case "set_update_available":
        // Mirrors the native menu/tooltip reconciliation boundary without
        // retaining update state or exposing any command arguments. Missing
        // this command makes a healthy initial journey show update_failed
        // immediately after the background updater reports "no update".
        return null;
      case "feedback_request": {
        if (args.action === "info") return { app_version: bootstrap.version, model: "Mac16,1", system: "macOS 15.6.1" };
        if (args.action === "submit") return { id: JSON.parse(String(args.submission)).id };
        throw new Error("relayune:feedback_failed");
      }
      case "get_bootstrap":
        bootstrapAttempts += 1;
        document.documentElement.dataset.relayuneQaBootstrapAttempts =
          String(bootstrapAttempts);
        if (scenario === "preparing" && bootstrapAttempts === 1) {
          return new Promise(() => {});
        }
        if (scenario === "startup-failure" && bootstrapAttempts === 1) {
          throw new Error("relayune:startup_failed");
        }
        return structuredClone(bootstrap);
      case "get_relay_snapshot":
        return structuredClone(bootstrap.relay);
      case "get_agent_availability":
        return structuredClone(agentAvailability);
      case "install_agent": {
        const provider = args.provider as RelayProvider;
        agentAvailability = agentAvailability.map((value) =>
          value.provider === provider
            ? {
                ...value,
                status: "not_logged_in",
                version: value.minimum_version,
              }
            : value
        );
        return structuredClone(
          agentAvailability.find((value) => value.provider === provider),
        );
      }
      case "open_agent_login":
        return null;
      case "start_relay":
        bootstrap.relay = relaySnapshot("connected");
        return structuredClone(bootstrap.relay);
      case "stop_relay":
        bootstrap.relay = relaySnapshot("stopped");
        return structuredClone(bootstrap.relay);
      case "logout":
        if (slowLogout) return new Promise(() => {});
        bootstrap = {
          ...bootstrap,
          secrets: { device_token: false, e2ee_key: false },
          relay: relaySnapshot("stopped"),
        };
        return structuredClone(bootstrap);
      case "save_settings": {
        if (slowSave) return new Promise(() => {});
        const input = args.input as { config?: Bootstrap["config"] } | undefined;
        if (input?.config) bootstrap = { ...bootstrap, config: structuredClone(input.config) };
        return structuredClone(bootstrap);
      }
      case "validate_config": {
        const config = args.config as Bootstrap["config"] | undefined;
        if (!config?.server_url.startsWith("https://")) {
          throw new Error("relayune:server_https_required");
        }
        return null;
      }
      case "set_launch_at_login":
        if (query.get("fail-save") === "1") throw new Error("relayune:autostart_failed");
        if (slowSave) return new Promise(() => {});
        bootstrap.launch_at_login = Boolean(args.enabled);
        return bootstrap.launch_at_login;
      case "set_ui_language":
        if (!isAppLocale(args.language)) throw new Error("relayune:language_failed");
        bootstrap.config.ui_language = args.language;
        return null;
      case "select_workspace":
        return bootstrap.platform.os === "windows" ? "C:\\Relayune QA Workspace" : "/Relayune QA Workspace";
      case "open_pairing_page":
        if (failBrowserOpen) throw new Error("relayune:open_web_failed");
        return null;
      case "open_desktop_login_page":
      case "abandon_desktop_login":
        if (failBrowserOpen) throw new Error("relayune:open_web_failed");
        return null;
      case "request_workspace_access":
        return true;
      case "complete_desktop_login":
        bootstrap = {
          ...bootstrap,
          config: { ...bootstrap.config, browser_ids: [] },
          secrets: { device_token: true, e2ee_key: false },
          relay: relaySnapshot("stopped"),
        };
        return structuredClone(bootstrap);
      case "start_browser_pairing":
        return { expires_at: new Date(Date.now() + 9 * 60_000 + 42_000).toISOString() };
      case "cancel_browser_pairing":
        return null;
      case "list_browser_authorizations":
        if (failBrowserList) throw new Error("relayune:browser_access_failed");
        return bootstrap.secrets.e2ee_key
          ? [{
              id: "qa-browser-primary",
              name: query.get("devices") === "gallery" ? "Relayune · iPhone 17 Pro · iOS 26.3" : "Primary browser with an intentionally long descriptive device name",
              client_version: "0.3.20+30",
              key_id: "qa-key-id",
              created_at: "2026-08-08T08:08:00.000Z",
              last_seen_at: "2026-08-09T08:08:00.000Z",
            }, ...(query.get("devices") === "gallery" ? [
              "Relayune · vivo V2241A · Android 16", "Chrome · Mac", "Relayune · iPhone 17 Pro · iOS 26.3",
              "Relayune · iPad Pro · iPadOS 26.3", "A very long custom device name without platform metadata",
            ].map((name, index) => ({ id: `qa-browser-${index}`, name, key_id: `qa-key-${index}`,
              client_version: "0.3.24", created_at: "2026-08-08T08:08:00.000Z",
              last_seen_at: new Date(Date.now() - (index + 1) * 3600_000).toISOString() })) : [])]
          : [];
      case "revoke_browser_authorization":
        if (slowRevoke) return new Promise(() => {});
        bootstrap = {
          ...bootstrap,
          config: { ...bootstrap.config, browser_ids: [] },
          secrets: { device_token: true, e2ee_key: false },
          relay: relaySnapshot("stopped"),
        };
        return structuredClone(bootstrap);
      default:
        throw new Error("relayune:unknown");
    }
  };

  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback(callback, once = false) {
      const id = ++callbackId;
      if (callback) {
        callbacks.set(id, once ? (payload) => {
          callbacks.delete(id);
          callback(payload);
        } : callback);
      }
      return id;
    },
    unregisterCallback(id) {
      callbacks.delete(id);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener() {},
  };

  if (query.get("redact-code") === "1") {
    const redact = () => {
      for (const node of document.querySelectorAll<HTMLElement>(".pairing-code")) {
        if (node.textContent && node.textContent !== "••••-••••") node.textContent = "••••-••••";
      }
    };
    new MutationObserver(redact).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  const requestedAction = query.get("action");
  let steps = desktopQaActionSteps(requestedAction, scenario);
  if (platform === "macos" && (scenario === "connected" || scenario === "relay-error")) {
    if (requestedAction === "settings-cancel") steps = [{ selector: "#open-settings", click: true }, { selector: "#moonlight-back", click: true }];
    if (requestedAction === "settings-draft-language") steps = [
      { selector: "#open-settings", click: true },
      { selector: "#warm-launch-at-login", click: true },
      { selector: "#warm-language", setValue: "en" },
      { selector: "#warm-launch-at-login", expectChecked: false },
    ];
    if (requestedAction === "settings-pending-language") steps = [
      { selector: "#open-settings", click: true },
      { selector: "#warm-launch-at-login", click: true },
      { selector: "#warm-language", expectDisabled: true },
    ];
    steps = steps.flatMap(step => {
      if (step.selector === "#open-settings") return [{ selector: "#open-settings", click: true }];
      if (step.selector === "#open-diagnostics") return [{ selector: "#open-settings", click: true }, step];
      if (step.selector === "#logout-button") return [{ selector: "#minimal-account", click: true }, step];
      if (step.selector === "[data-add-browser], #new-pairing") return [{ selector: "#minimal-connect", click: true }];
      if (step.selector === "[data-revoke-browser]") return [{ selector: "#minimal-manage", click: true }, { selector: '.browser-device-details summary', click: true }, step];
      return [step];
    });
  }
  if (platform === "macos" && requestedAction === "folder-access") {
    steps = [
      ...(scenario === "initial" ? [{ selector: "#login-button", click: true }] : []),
      { selector: "#open-settings", click: true },
      { selector: "#prepare-task-files", click: true },
      { selector: "#workspace-access-dialog:not([open])" },
    ];
  }
  if (steps.length) {
    let stepIndex = 0;
    let attempts = 0;
    const timer = window.setInterval(() => {
      const step = steps[stepIndex];
      if (!step) {
        window.clearInterval(timer);
        return;
      }
      attempts += 1;
      const node = document.querySelector<HTMLElement>(step.selector);
      const hidden = node?.classList.contains("is-hidden") || node?.closest(".is-hidden");
      const disabled =
        (node instanceof HTMLButtonElement || node instanceof HTMLSelectElement) &&
        (node.disabled || node.getAttribute("aria-disabled") === "true");
      const matchesDisabledState = step.expectDisabled ? disabled : !disabled;
      const matchesText = step.expectText === undefined ||
        node?.textContent?.trim() === step.expectText;
      const matchesValue = step.expectValue === undefined ||
        (node instanceof HTMLInputElement && node.value === step.expectValue);
      const matchesChecked = step.expectChecked === undefined ||
        (node instanceof HTMLInputElement && node.checked === step.expectChecked);
      if (
        node &&
        !hidden &&
        matchesDisabledState &&
        matchesText &&
        matchesValue &&
        matchesChecked
      ) {
        if (step.setValue !== undefined && (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) {
          node.value = step.setValue;
          node.dispatchEvent(new Event("input", { bubbles: true }));
        }
        if (step.setValue !== undefined && node instanceof HTMLSelectElement) {
          node.value = step.setValue;
          node.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (
          step.click &&
          (node instanceof HTMLButtonElement || node instanceof HTMLInputElement || node instanceof HTMLElement && node.tagName === "SUMMARY")
        ) node.click();
        stepIndex += 1;
        attempts = 0;
      } else if (attempts >= 100) {
        window.clearInterval(timer);
      }
    }, 100);
  }
  return locale;
}
