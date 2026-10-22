import type { AppLocale } from "./i18n";

export type RelayAdapter = "codex" | "kimi" | "claude" | "opencode" | "zcode" | "mcode" | "multi";
export type RelayProvider = "codex" | "kimi" | "claude" | "opencode" | "zcode" | "mcode";
export type AgentRuntimeStatus =
  | "ready"
  | "not_installed"
  | "not_logged_in"
  | "outdated"
  | "broken";
export type RelayPhase =
  | "stopped"
  | "starting"
  | "connected"
  | "stopping"
  | "error";

export interface RelayConfig {
  server_url: string;
  device_id: string;
  account_email?: string | null;
  adapter: RelayAdapter;
  default_provider: RelayProvider;
  workspace: string;
  codex_bin: string;
  kimi_bin: string;
  claude_bin: string;
  state_path: string;
  browser_ids: string[];
  start_relay_on_launch: boolean;
  ui_language?: AppLocale | null;
}

export interface SecretPresence {
  device_token: boolean;
  e2ee_key: boolean;
}

export interface RelayLogLine {
  at: string;
  level: "info" | "error";
  message: string;
}

export interface RelaySnapshot {
  online_browser_ids?: string[];
  browser_presence_observed_at?: number | null;
  file_access_limited?: boolean;
  phase: RelayPhase;
  pid: number | null;
  started_at: string | null;
  last_error: string | null;
  logs: RelayLogLine[];
}

export interface Bootstrap {
  config: RelayConfig;
  secrets: SecretPresence;
  relay: RelaySnapshot;
  launch_at_login: boolean;
  version: string;
  platform: DesktopPlatform;
}

export interface DesktopPlatform {
  os: "macos" | "windows";
  arch: string;
  update_target: string;
  os_version: string | null;
}

export interface AgentRuntimeAvailability {
  provider: RelayProvider;
  status: AgentRuntimeStatus;
  version: string | null;
  minimum_version: string;
}

export interface SaveSettingsInput {
  config: RelayConfig;
}

export interface CompletePairingInput {
  server_url: string;
  expected_device_id: string;
  device_id: string;
  browser_id: string;
  device_token: string;
  e2ee_key: string;
}

export interface CompleteDesktopLoginInput {
  server_url: string;
  expected_device_id: string;
  device_id: string;
  device_token: string;
  account_email: string;
}

export interface StartBrowserPairingInput {
  server_url: string;
  expected_device_id: string;
  pairing_id: string;
  protocol: string;
  initiator_share: string;
}

export interface StartBrowserPairingResponse {
  expires_at: string;
}

export interface CompleteBrowserPairingInput {
  server_url: string;
  expected_device_id: string;
  e2ee_key: string;
  pairing_id: string;
  browser_id: string;
  desktop_confirm: string;
}

export interface BrowserAuthorization {
  client_version?: string | null;
  id: string;
  name: string;
  key_id: string;
  created_at: string;
  last_seen_at: string | null;
}

