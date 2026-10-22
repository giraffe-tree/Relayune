import { invoke } from "@tauri-apps/api/core";
import type { AppLocale } from "./i18n";
import type {
  AgentRuntimeAvailability,
  Bootstrap,
  BrowserAuthorization,
  CompleteBrowserPairingInput,
  CompleteDesktopLoginInput,
  CompletePairingInput,
  RelayConfig,
  RelayProvider,
  RelaySnapshot,
  SaveSettingsInput,
  StartBrowserPairingInput,
  StartBrowserPairingResponse,
} from "./types";

export type DesktopErrorCode =
  | "keep_awake_failed"
  | "startup_failed"
  | "settings_invalid"
  | "instance_probe_failed"
  | "instance_cleanup_failed"
  | "server_url_invalid"
  | "server_https_required"
  | "server_credentials_forbidden"
  | "server_components_forbidden"
  | "workspace_invalid"
  | "codex_path_invalid"
  | "kimi_path_invalid"
  | "claude_path_invalid"
  | "agent_check_failed"
  | "agent_install_failed"
  | "agent_login_failed"
  | "settings_save_failed"
  | "relay_credentials_missing"
  | "browser_pairing_required"
  | "relay_unauthorized"
  | "relay_reconnecting"
  | "relay_legacy_process"
  | "relay_start_failed"
  | "relay_stop_failed"
  | "relay_exited"
  | "sign_in_failed"
  | "sign_out_failed"
  | "credential_access_failed"
  | "autostart_failed"
  | "workspace_picker_failed"
  | "open_web_failed"
  | "pairing_failed"
  | "browser_access_failed"
  | "language_failed"
  | "window_failed"
  | "update_failed"
  | "unknown";

const DESKTOP_ERROR_PREFIX = "relayune:";
const desktopErrorCodes = new Set<DesktopErrorCode>([
  "keep_awake_failed",
  "startup_failed",
  "settings_invalid",
  "instance_probe_failed",
  "instance_cleanup_failed",
  "server_url_invalid",
  "server_https_required",
  "server_credentials_forbidden",
  "server_components_forbidden",
  "workspace_invalid",
  "codex_path_invalid",
  "kimi_path_invalid",
  "claude_path_invalid",
  "agent_check_failed",
  "agent_install_failed",
  "agent_login_failed",
  "settings_save_failed",
  "relay_credentials_missing",
  "browser_pairing_required",
  "relay_unauthorized",
  "relay_reconnecting",
  "relay_legacy_process",
  "relay_start_failed",
  "relay_stop_failed",
  "relay_exited",
  "sign_in_failed",
  "sign_out_failed",
  "credential_access_failed",
  "autostart_failed",
  "workspace_picker_failed",
  "open_web_failed",
  "pairing_failed",
  "browser_access_failed",
  "language_failed",
  "window_failed",
  "update_failed",
  "unknown",
]);

export class DesktopCommandError extends Error {
  readonly code: DesktopErrorCode;

  constructor(code: DesktopErrorCode) {
    super(`${DESKTOP_ERROR_PREFIX}${code}`);
    this.name = "DesktopCommandError";
    this.code = code;
  }
}

function rawErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
}

export function desktopErrorCode(
  error: unknown,
  fallback: DesktopErrorCode = "unknown",
): DesktopErrorCode {
  if (error instanceof DesktopCommandError) return error.code;
  const raw = rawErrorMessage(error);
  const marker = raw.match(/(?:^|\s)relayune:([a-z_]+)/)?.[1];
  if (marker && desktopErrorCodes.has(marker as DesktopErrorCode)) {
    return marker as DesktopErrorCode;
  }

  // Compatibility for a running Relay started by an older desktop build. New
  // native errors use markers; these checks can be removed after migration.
  if (raw.includes("旧版 LaunchAgent")) return "relay_legacy_process";
  if (raw.includes("登录凭据已失效")) return "relay_unauthorized";
  if (raw.includes("连接中断")) return "relay_reconnecting";
  if (
    raw.includes("安全连接") ||
    raw.includes("浏览器授权") ||
    raw.includes("安全凭据")
  ) {
    return "relay_credentials_missing";
  }
  return fallback;
}

async function invokeDesktop<T>(
  command: string,
  fallback: DesktopErrorCode,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new DesktopCommandError(desktopErrorCode(error, fallback));
  }
}

export interface KeepAwakeStatus {
  supported: boolean;
  prevent_lock: boolean;
  lock_prevention_active: boolean;
  lock_prevention_stopping: boolean;
  error: boolean;
}

export interface InstanceCapabilities { schema_version: 1; auth_mode: "email" | "username"; setup_required: boolean; }

export const relayApi = {
  probeInstance: (serverUrl: string) => invokeDesktop<InstanceCapabilities>("probe_instance", "instance_probe_failed", { serverUrl }),
  switchInstance: (serverUrl: string, previousServerUrl: string) => invokeDesktop<Bootstrap>("switch_instance", "settings_save_failed", { serverUrl, previousServerUrl, confirmed: true }),
  bootstrap: () => invokeDesktop<Bootstrap>("get_bootstrap", "startup_failed"),
  saveSettings: (input: SaveSettingsInput) =>
    invokeDesktop<Bootstrap>("save_settings", "settings_save_failed", { input }),
  start: () => invokeDesktop<RelaySnapshot>("start_relay", "relay_start_failed"),
  stop: () => invokeDesktop<RelaySnapshot>("stop_relay", "relay_stop_failed"),
  logout: () => invokeDesktop<Bootstrap>("logout", "sign_out_failed"),
  snapshot: () =>
    invokeDesktop<RelaySnapshot>("get_relay_snapshot", "relay_start_failed"),
  clearSecret: (kind: "device_token" | "e2ee_key") =>
    invokeDesktop<Bootstrap>("clear_secret", "credential_access_failed", { kind }),
  getKeepAwakeStatus: () => invokeDesktop<KeepAwakeStatus>("get_keep_awake_status", "keep_awake_failed"),
  setPreventAutomaticLock: (enabled: boolean) =>
    invokeDesktop<KeepAwakeStatus>("set_prevent_automatic_lock", "keep_awake_failed", { enabled }),
  setLaunchAtLogin: (enabled: boolean) =>
    invokeDesktop<boolean>("set_launch_at_login", "autostart_failed", { enabled }),
  setUiLanguage: (language: AppLocale) =>
    invokeDesktop<void>("set_ui_language", "language_failed", { language }),
  setUpdateAvailable: (available: boolean) =>
    invokeDesktop<void>("set_update_available", "update_failed", { available }),
  selectWorkspace: (current: string, language: AppLocale) =>
    invokeDesktop<string | null>("select_workspace", "workspace_picker_failed", {
      current,
      language,
    }),
  openWeb: () => invokeDesktop<void>("open_relay_web", "open_web_failed"),
  openPublicPage: (
    destination: "terms" | "privacy" | "changelog",
    language: AppLocale,
  ) =>
    invokeDesktop<void>("open_public_page", "open_web_failed", {
      destination,
      language,
    }),
  openPairingPage: (pairingId: string) =>
    invokeDesktop<void>("open_pairing_page", "open_web_failed", { pairingId }),
  openDesktopLoginPage: (requestId: string) =>
    invokeDesktop<void>("open_desktop_login_page", "open_web_failed", {
      requestId,
    }),
  completeDesktopLogin: (input: CompleteDesktopLoginInput) =>
    invokeDesktop<Bootstrap>("complete_desktop_login", "sign_in_failed", {
      input,
    }),
  openFileAccessSettings: () => invokeDesktop<void>("open_file_access_settings", "open_web_failed"),
  retryFileAccess: () => invokeDesktop<void>("retry_file_access", "workspace_invalid"),
  requestWorkspaceAccess: () =>
    invokeDesktop<boolean>("request_workspace_access", "workspace_invalid"),
  abandonDesktopLogin: (deviceToken: string, serverUrl: string) =>
    invokeDesktop<void>("abandon_desktop_login", "sign_in_failed", {
      deviceToken,
      serverUrl,
    }),
  completePairing: (input: CompletePairingInput) =>
    invokeDesktop<Bootstrap>("complete_pairing", "pairing_failed", { input }),
  startBrowserPairing: (input: StartBrowserPairingInput) =>
    invokeDesktop<StartBrowserPairingResponse>(
      "start_browser_pairing",
      "pairing_failed",
      { input },
    ),
  cancelBrowserPairing: (pairingId: string, serverUrl: string) =>
    invokeDesktop<void>("cancel_browser_pairing", "browser_access_failed", {
      pairingId,
      serverUrl,
    }),
  listBrowserAuthorizations: () =>
    invokeDesktop<BrowserAuthorization[]>(
      "list_browser_authorizations",
      "browser_access_failed",
    ),
  revokeBrowserAuthorization: (browserId: string) =>
    invokeDesktop<Bootstrap>("revoke_browser_authorization", "browser_access_failed", {
      browserId,
    }),
  completeBrowserPairing: (input: CompleteBrowserPairingInput) =>
    invokeDesktop<Bootstrap>("complete_browser_pairing", "pairing_failed", { input }),
  showWindow: () => invokeDesktop<void>("show_main_window", "window_failed"),
  validateConfig: (config: RelayConfig) =>
    invokeDesktop<void>("validate_config", "settings_invalid", { config }),
  agentAvailability: () =>
    invokeDesktop<AgentRuntimeAvailability[]>(
      "get_agent_availability",
      "agent_check_failed",
    ),
  installAgent: (provider: RelayProvider) =>
    invokeDesktop<AgentRuntimeAvailability>(
      "install_agent",
      "agent_install_failed",
      { provider },
    ),
  openAgentLogin: (provider: RelayProvider) =>
    invokeDesktop<void>("open_agent_login", "agent_login_failed", { provider }),

};
