use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};

use tauri::async_runtime::Mutex as AsyncMutex;
use tauri::{menu::MenuItem, Wry};
use tauri_plugin_shell::process::CommandChild;

use crate::model::{LogLevel, RelayConfig, RelayLogLine, RelayPhase, RelaySnapshot, UiLanguage};

const MAX_LOG_LINES: usize = 80;
const ALLOWED_DIAGNOSTIC_CODES: &[&str] = &[
    "autostart_failed",
    "browser_access_failed",
    "browser_authorizations_cleaned",
    "codex_path_invalid",
    "claude_path_invalid",
    "credential_access_failed",
    "desktop_login_completed",
    "diagnostic_hidden",
    "kimi_path_invalid",
    "language_failed",
    "open_web_failed",
    "pairing_completed",
    "pairing_failed",
    "relay_connected",
    "relay_credentials_missing",
    "browser_pairing_required",
    "relay_exited",
    "relay_legacy_process",
    "relay_reconnecting",
    "relay_sync_degraded",
    "relay_sync_recovered",
    "relay_start_failed",
    "relay_started",
    "relay_starting",
    "relay_stop_failed",
    "relay_stopped",
    "relay_stopping",
    "relay_unauthorized",
    "server_components_forbidden",
    "server_credentials_forbidden",
    "server_https_required",
    "server_url_invalid",
    "settings_invalid",
    "settings_save_failed",
    "settings_saved",
    "sign_in_failed",
    "sign_out_failed",
    "signed_out",
    "startup_failed",
    "unknown",
    "update_failed",
    "window_failed",
    "workspace_invalid",
    "workspace_picker_failed",
];

#[derive(Clone)]
pub struct AppState {
    pub inner: Arc<AppStateInner>,
}

pub struct AppStateInner {
    pub config: Mutex<RelayConfig>,
    /// Serializes every durable whole-config mutation, including language.
    /// Remote revoke/logout can save a new identity before their network
    /// confirmation completes; a concurrent language write must not clone the
    /// older in-memory config and restore that superseded identity on disk.
    pub config_update: AsyncMutex<()>,
    /// Prevents an unowned Relay Start from reading the previous in-memory
    /// config while a whole-config settings transaction is stopping the old
    /// generation and committing its replacement. The async config mutex
    /// serializes writers, while this atomic is intentionally visible to the
    /// synchronous runtime-generation admission path.
    relay_config_change_in_flight: AtomicBool,
    pub runtime: Mutex<RelayRuntime>,
    pub workspace_access_denied: AtomicBool,
    pub logs: Mutex<VecDeque<RelayLogLine>>,
    pub tray_items: Mutex<Option<TrayMenuItems>>,
    pub agent_inspection: Mutex<()>,
    pub tray_agents: Mutex<Vec<crate::model::AgentRuntimeAvailability>>,
    /// Serializes the menu item, tooltip and macOS accessibility-label update.
    /// Language changes can otherwise race Relay phase publications and leave
    /// different parts of the native menu in different locales.
    pub tray_update: Mutex<()>,
    pub ui_language: Mutex<UiLanguage>,
    /// Non-secret update availability mirrored from the hidden WebView so a
    /// background launch can make the native update action discoverable.
    pub update_available: Mutex<bool>,
    /// Non-secret enrollment state used by high-frequency native tray refreshes.
    /// Never decrypt the local secret vault from the Relay publish path: a
    /// temporarily unreadable vault must not make an enrolled device look unpaired.
    pub paired: Mutex<bool>,
    /// A durable config read failed, so the main window is the only safe
    /// recovery surface. This keeps the native primary action on Show without
    /// pretending that a Web workspace is authorized.
    pub recovery_required: Mutex<bool>,
    /// True only after setup has proved that hiding the main window still leaves
    /// either a tray/status item or a regular Dock/taskbar identity to restore it.
    /// Keep false by default so a double native-surface failure cannot strand an
    /// Accessory process with its last visible window hidden.
    pub window_hide_recovery_available: Mutex<bool>,
    /// Latest-wins admission for native bootstrap retries. Slow config or
    /// secure-store reads run without a global request mutex; only the request
    /// holding the current generation may later commit config, locale,
    /// enrollment/recovery state and the corresponding NSMenu/AX refresh.
    bootstrap_generation: AtomicU64,
    /// An interactive OS Quit must not kill a sidecar on Tauri's native event
    /// loop. These atomics deduplicate the deferred stop and mark that exactly
    /// one owner has already selected the follow-up programmatic transition.
    exit_stop_in_flight: AtomicBool,
    exit_stop_ready: AtomicBool,
}

#[derive(Clone)]
pub struct TrayMenuItems {
    #[cfg(target_os = "macos")]
    pub keep_awake: crate::keep_awake_menu::KeepAwakeMenu,
    pub status: MenuItem<Wry>,
    pub open: MenuItem<Wry>,
    pub agents: Vec<MenuItem<Wry>>,
    pub update: MenuItem<Wry>,
    pub quit: MenuItem<Wry>,
}

pub struct RelayRuntime {
    pub automatic_restarts: std::collections::VecDeque<std::time::Instant>,
    // Generation-bound, ephemeral sidecar presence; never written to logs/config.
    pub browser_presence: Option<(u64, Vec<String>, i64)>,
    pub phase: RelayPhase,
    pub child: Option<CommandChild>,
    pub pid: Option<u32>,
    pub started_at: Option<String>,
    pub last_error: Option<String>,
    pub generation: u64,
    pub file_access_limited: bool,
    pub browser_key_ack: Option<(String, Option<bool>)>,
}

impl AppState {
    pub fn new(config: RelayConfig, paired: bool) -> Self {
        let ui_language = config
            .ui_language
            .as_deref()
            .and_then(UiLanguage::from_language_code)
            .unwrap_or_else(UiLanguage::system);
        Self {
            inner: Arc::new(AppStateInner {
                config: Mutex::new(config),
                config_update: AsyncMutex::new(()),
                relay_config_change_in_flight: AtomicBool::new(false),
                runtime: Mutex::new(RelayRuntime {
                    automatic_restarts: std::collections::VecDeque::new(),
                    browser_presence: None,
                    phase: RelayPhase::Stopped,
                    child: None,
                    pid: None,
                    started_at: None,
                    last_error: None,
                    generation: 0,
                    file_access_limited: false,
                    browser_key_ack: None,
                }),
                workspace_access_denied: AtomicBool::new(false),
                logs: Mutex::new(VecDeque::with_capacity(MAX_LOG_LINES)),
                tray_items: Mutex::new(None),
                tray_agents: Mutex::new(Vec::new()),
                agent_inspection: Mutex::new(()),
                tray_update: Mutex::new(()),
                ui_language: Mutex::new(ui_language),
                update_available: Mutex::new(false),
                paired: Mutex::new(paired),
                recovery_required: Mutex::new(false),
                window_hide_recovery_available: Mutex::new(false),
                bootstrap_generation: AtomicU64::new(0),
                exit_stop_in_flight: AtomicBool::new(false),
                exit_stop_ready: AtomicBool::new(false),
            }),
        }
    }

    pub fn config(&self) -> RelayConfig {
        self.inner
            .config
            .lock()
            .expect("config mutex poisoned")
            .clone()
    }

    pub fn set_config(&self, config: RelayConfig) {
        *self.inner.config.lock().expect("config mutex poisoned") = config;
    }

    pub fn ui_language(&self) -> UiLanguage {
        *self
            .inner
            .ui_language
            .lock()
            .expect("UI language mutex poisoned")
    }

    pub fn set_ui_language(&self, language: UiLanguage) {
        *self
            .inner
            .ui_language
            .lock()
            .expect("UI language mutex poisoned") = language;
    }

    pub fn update_available(&self) -> bool {
        *self
            .inner
            .update_available
            .lock()
            .expect("update availability mutex poisoned")
    }

    pub fn set_update_available(&self, available: bool) {
        *self
            .inner
            .update_available
            .lock()
            .expect("update availability mutex poisoned") = available;
    }

    pub fn is_paired(&self) -> bool {
        *self.inner.paired.lock().expect("paired mutex poisoned")
    }

    pub fn set_paired(&self, paired: bool) {
        *self.inner.paired.lock().expect("paired mutex poisoned") = paired;
    }

    pub fn recovery_required(&self) -> bool {
        *self
            .inner
            .recovery_required
            .lock()
            .expect("recovery-required mutex poisoned")
    }

    pub fn set_recovery_required(&self, required: bool) {
        *self
            .inner
            .recovery_required
            .lock()
            .expect("recovery-required mutex poisoned") = required;
    }

    pub fn window_hide_recovery_available(&self) -> bool {
        *self
            .inner
            .window_hide_recovery_available
            .lock()
            .expect("window-hide recovery mutex poisoned")
    }

    pub fn set_window_hide_recovery_available(&self, available: bool) {
        *self
            .inner
            .window_hide_recovery_available
            .lock()
            .expect("window-hide recovery mutex poisoned") = available;
    }

    pub fn merge_window_hide_recovery_available(&self, available: bool) -> bool {
        let mut current = self
            .inner
            .window_hide_recovery_available
            .lock()
            .expect("window-hide recovery mutex poisoned");
        *current |= available;
        *current
    }

    pub fn begin_relay_config_change(&self) -> bool {
        self.inner
            .relay_config_change_in_flight
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    pub fn finish_relay_config_change(&self) {
        self.inner
            .relay_config_change_in_flight
            .store(false, Ordering::SeqCst);
    }

    pub fn relay_config_change_in_flight(&self) -> bool {
        self.inner
            .relay_config_change_in_flight
            .load(Ordering::SeqCst)
    }

    pub fn begin_bootstrap_request(&self) -> u64 {
        self.inner
            .bootstrap_generation
            .fetch_add(1, Ordering::SeqCst)
            .wrapping_add(1)
    }

    pub fn invalidate_bootstrap_requests(&self) {
        // Explicit config / native-presentation writes are authoritative over
        // any bootstrap that already loaded an older durable snapshot. Reuse
        // the same monotonic generation without serializing its slow reads.
        let _ = self.begin_bootstrap_request();
    }

    pub fn bootstrap_request_is_current(&self, generation: u64) -> bool {
        self.inner.bootstrap_generation.load(Ordering::SeqCst) == generation
    }

    pub fn exit_stop_ready(&self) -> bool {
        self.inner.exit_stop_ready.load(Ordering::SeqCst)
    }

    pub fn exit_stop_requested(&self) -> bool {
        self.inner.exit_stop_in_flight.load(Ordering::SeqCst) || self.exit_stop_ready()
    }

    pub fn begin_exit_stop(&self) -> bool {
        if self
            .inner
            .exit_stop_in_flight
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return false;
        }
        if self.exit_stop_ready() {
            // complete_exit_stop publishes ready before releasing in_flight.
            // A contender can read ready=false, then arrive just after that
            // release and otherwise claim a second, possibly different,
            // process transition. Relinquish only our newly acquired in-flight
            // bit while preserving the completed owner's ready state.
            self.inner
                .exit_stop_in_flight
                .store(false, Ordering::SeqCst);
            return false;
        }
        true
    }

    pub fn complete_exit_stop(&self) {
        self.inner.exit_stop_ready.store(true, Ordering::SeqCst);
        self.inner
            .exit_stop_in_flight
            .store(false, Ordering::SeqCst);
    }

    pub fn cancel_exit_stop(&self) {
        self.inner.exit_stop_ready.store(false, Ordering::SeqCst);
        self.inner
            .exit_stop_in_flight
            .store(false, Ordering::SeqCst);
    }

    pub fn log(&self, level: LogLevel, message: impl AsRef<str>) {
        let message = redact_log(message.as_ref());
        if message.is_empty() {
            return;
        }
        let mut logs = self.inner.logs.lock().expect("logs mutex poisoned");
        if logs.len() == MAX_LOG_LINES {
            logs.pop_front();
        }
        logs.push_back(RelayLogLine {
            at: chrono::Utc::now().to_rfc3339(),
            level,
            message,
        });
    }

    pub fn snapshot(&self) -> RelaySnapshot {
        let runtime = self.inner.runtime.lock().expect("runtime mutex poisoned");
        let logs = self.inner.logs.lock().expect("logs mutex poisoned");
        let presence = runtime.browser_presence.as_ref().filter(|(generation, _, observed)|
            *generation == runtime.generation && matches!(runtime.phase, RelayPhase::Connected)
                && (0..6_000).contains(&(chrono::Utc::now().timestamp_millis() - observed)));
        RelaySnapshot {
            online_browser_ids: presence.map(|(_, ids, _)| ids.clone()).unwrap_or_default(),
            browser_presence_observed_at: presence.map(|(_, _, observed)| *observed),
            phase: runtime.phase.clone(),
            pid: runtime.pid,
            started_at: runtime.started_at.clone(),
            last_error: runtime.last_error.clone(),
            logs: logs.iter().cloned().collect(),
            file_access_limited: runtime.file_access_limited
                || self.inner.workspace_access_denied.load(Ordering::SeqCst),
        }
    }
}

pub fn redact_log(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let lower = trimmed.to_ascii_lowercase();
    if [
        "relay_device_token",
        "relay_e2ee_key",
        "password",
        "authorization:",
        "bearer ",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
    {
        return "relayune:diagnostic_hidden".into();
    }

    if is_stable_diagnostic_code(trimmed) {
        return trimmed.into();
    }

    // RelaySnapshot.logs is rendered in the diagnostics UI. It must never
    // become a transport for paths, process IDs, adapter names, counts,
    // stdout/stderr, or untranslated native prose. The WebView localizes only
    // this exact, parameter-free diagnostic-code vocabulary.
    "relayune:diagnostic_hidden".into()
}

fn is_stable_diagnostic_code(value: &str) -> bool {
    let Some(code) = value.strip_prefix("relayune:") else {
        return false;
    };
    !code.is_empty()
        && code
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        && ALLOWED_DIAGNOSTIC_CODES.contains(&code)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{RelayAdapter, RelayProvider};
    use std::{sync::mpsc, thread, time::Duration};

    #[test]
    fn redacts_known_secret_material() {
        assert_eq!(
            redact_log("Authorization: Bearer abc"),
            "relayune:diagnostic_hidden"
        );
        assert_eq!(
            redact_log("RELAY_E2EE_KEY=secret"),
            "relayune:diagnostic_hidden"
        );
    }

    #[test]
    fn preserves_only_parameter_free_stable_diagnostic_codes() {
        assert_eq!(
            redact_log("relayune:relay_started"),
            "relayune:relay_started"
        );
        assert_eq!(
            redact_log("relayune:browser_authorizations_cleaned"),
            "relayune:browser_authorizations_cleaned"
        );
        for unsafe_line in [
            "Relayune Relay connected to https://example.com",
            "relayune:relay_started PID 123",
            "relayune:relay_started:123",
            "relayune:pid_123",
            "relayune:RelayStarted",
            "relayune:unregistered_future_detail",
            "/Users/example/private/workspace",
            "stderr: connection failed",
        ] {
            assert_eq!(redact_log(unsafe_line), "relayune:diagnostic_hidden");
        }
        assert_eq!(
            redact_log("   \n"),
            "",
            "empty sidecar output should not create a diagnostic event"
        );
    }

    #[test]
    fn durable_config_transactions_wait_and_observe_the_latest_commit() {
        let initial = RelayConfig {
            server_url: "https://relayune.giraffetree.cn".into(),
            device_id: "device_before_remote_commit".into(),
            account_email: None,
            adapter: RelayAdapter::Multi,
            default_provider: RelayProvider::Codex,
            workspace: String::new(),
            codex_bin: String::new(),
            kimi_bin: String::new(),
            claude_bin: String::new(),
            state_path: String::new(),
            browser_ids: vec!["browser_before_remote_commit".into()],
            start_relay_on_launch: false,
            ui_language: Some("zh-CN".into()),
        };
        let state = AppState::new(initial, false);
        let first_guard = tauri::async_runtime::block_on(state.inner.config_update.lock());
        let waiting_state = state.clone();
        let (sender, receiver) = mpsc::channel();
        let waiter = thread::spawn(move || {
            tauri::async_runtime::block_on(async move {
                let _guard = waiting_state.inner.config_update.lock().await;
                sender.send(waiting_state.config().device_id).unwrap();
            });
        });

        assert!(
            receiver.recv_timeout(Duration::from_millis(100)).is_err(),
            "a language/config write must not pass an unfinished identity transaction",
        );
        let mut committed = state.config();
        committed.device_id = "device_after_remote_commit".into();
        state.set_config(committed);
        drop(first_guard);

        assert_eq!(
            receiver.recv_timeout(Duration::from_secs(1)).unwrap(),
            "device_after_remote_commit",
        );
        waiter.join().unwrap();
    }
}
