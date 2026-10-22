use std::{
    collections::BTreeSet,
    env,
    path::{Path, PathBuf},
    process::Command,
    time::Instant,
};

#[cfg(target_os = "macos")]
use std::{thread, time::Duration};

#[cfg(target_os = "windows")]
use std::os::windows::{ffi::OsStringExt as _, process::CommandExt as _};

use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

#[cfg(target_os = "windows")]
use windows_sys::Win32::System::{
    SystemInformation::GetSystemDirectoryW, Threading::CREATE_NO_WINDOW,
};

use crate::{
    config,
    model::{
        user_error, BrowserAuthorization, BrowserAuthorizationList, LogLevel, 
        RelayPhase, RelaySnapshot, SecretKind, StartBrowserPairingResponse,
    },
    secrets,
    state::{AppState, RelayRuntime},
};

const SIDECAR_NAME: &str = "relayune-core";

// pkg propagates PKG_EXECPATH through subprocesses. A Desktop launched by one
// of those descendants can inherit it; passing it back into the same sidecar
// makes pkg interpret "relay" as a file instead of loading our bundled CLI.
// Shell Command has no env_remove. An empty override disables both pkg's
// self-executable and PKG_INVOKE_NODEJS modes while preserving PATH/HOME, etc.
fn application_entrypoint(
    command: tauri_plugin_shell::process::Command,
) -> tauri_plugin_shell::process::Command {
    command.env("PKG_EXECPATH", "").env("NODE_USE_SYSTEM_CA", "1")
}

fn sidecar_command(
    app: &AppHandle,
) -> Result<tauri_plugin_shell::process::Command, tauri_plugin_shell::Error> {
    app.shell().sidecar(SIDECAR_NAME).map(application_entrypoint)
}

// One clock per child generation. Duplicate connection notifications do not
// create extra timings, and repeated failures do not restart the outage clock.
struct ConnectionTimings {
    started: Instant,
    has_connected: bool,
    reconnect_started: Option<Instant>,
}

impl ConnectionTimings {
    fn new(started: Instant) -> Self {
        Self {
            started,
            has_connected: false,
            reconnect_started: None,
        }
    }

    fn reconnecting(&mut self, now: Instant) {
        if self.has_connected {
            self.reconnect_started.get_or_insert(now);
        }
    }

    fn connected(&mut self, now: Instant) -> Option<(&'static str, u64)> {
        let (kind, started) = if !self.has_connected {
            self.has_connected = true;
            ("startup", self.started)
        } else {
            ("reconnect", self.reconnect_started.take()?)
        };
        Some((
            kind,
            now.saturating_duration_since(started)
                .as_millis()
                .min(u64::MAX as u128) as u64,
        ))
    }
}

pub async fn start(app: &AppHandle, state: &AppState) -> Result<RelaySnapshot, String> {
    start_with_config_change_admission(app, state, false).await
}

pub(crate) async fn start_during_config_change(
    app: &AppHandle,
    state: &AppState,
) -> Result<RelaySnapshot, String> {
    start_with_config_change_admission(app, state, true).await
}

async fn start_with_config_change_admission(
    app: &AppHandle,
    state: &AppState,
    owns_config_change: bool,
) -> Result<RelaySnapshot, String> {
    // Quit/restart owns the process lifecycle once its stop gate is raised.
    // Reject before any secure-store read, then recheck under the runtime lock
    // in reserve_start_generation to close the concurrent Start/Stop window.
    if state.exit_stop_requested()
        || (state.relay_config_change_in_flight() && !owns_config_change)
        || (owns_config_change && !state.relay_config_change_in_flight())
    {
        return Err(user_error("relay_start_failed"));
    }
    let Some(generation) = reserve_start_with_failed_runtime_recovery(
        state,
        owns_config_change,
        |state| publish(app, state),
        kill_relay_child,
        kill_relay_pid,
    )?
    else {
        // Start admission owns and releases the runtime lock. An idempotent
        // Start must not read secure storage or take a snapshot until that
        // guard is gone.
        return Ok(state.snapshot());
    };

    // An explicit Start grants a fresh recovery budget. Automatic restarts
    // enter through their own already-reserved generation below.
    state.inner.runtime.lock().expect("runtime mutex poisoned").automatic_restarts.clear();
    start_reserved(app, state, generation)
}

fn start_reserved(app: &AppHandle, state: &AppState, generation: u64) -> Result<RelaySnapshot, String> {
    // A delayed recovery can be cancelled by Stop/Quit/config changes.
    commit_reserved_start_with_hook(state, generation, |_| Ok(()))
        .map_err(|_| user_error("relay_start_failed"))?;
    crate::relay_diagnostics::record(app, "start_requested", generation, None, None, None);
    let mut connection_timings = ConnectionTimings::new(Instant::now());
    state.log(LogLevel::Info, "relayune:relay_starting");
    publish(app, state);

    let preparation = (|| {
        let relay_config = state.config();
        config::validate(&relay_config)?;
        let secret_presence =
            secrets::presence_for_browsers(&relay_config.device_id, &relay_config.browser_ids)?;
        if !secret_presence.device_token || !secret_presence.e2ee_key {
            return Err(user_error("relay_credentials_missing"));
        }
        // Decrypt secrets inside the desktop process that owns the local vault.
        // The bundled Relay receives them only in its transient process
        // environment, avoiding direct vault access from the standalone sidecar.
        let device_token = secrets::get(SecretKind::DeviceToken, &relay_config.device_id)?;
        let mut browser_keys = Vec::new();
        for browser_id in &relay_config.browser_ids {
            if let Ok(e2ee_key) = secrets::get_browser_key(&relay_config.device_id, browser_id) {
                browser_keys.push(serde_json::json!({
                    "browser_id": browser_id,
                    "e2ee_key": e2ee_key,
                }));
            }
        }
        if relay_config.browser_ids.is_empty() {
            if let Ok(legacy_key) = secrets::get(SecretKind::E2eeKey, &relay_config.device_id) {
                browser_keys.push(serde_json::json!({
                    "browser_id": null,
                    "e2ee_key": legacy_key,
                }));
            }
        }
        if browser_keys.is_empty() {
            return Err(user_error("relay_credentials_missing"));
        }
        let browser_keys_json = serde_json::to_string(&browser_keys)
            .map_err(|_| user_error("browser_access_failed"))?;
        let attachment_store_path =
            config::attachment_store_path_for_device(app, &relay_config.device_id)?;
        let attachment_store_key = secrets::get_or_create_attachment_store_key(
            &relay_config.device_id,
            attachment_store_path.exists(),
        )?;
        if std::env::var("AGENT_RELAY_TEST_MODE").as_deref() != Ok("1")
            && legacy_relay_pid().is_some()
        {
            return Err(user_error("relay_legacy_process"));
        }
        Ok((
            relay_config,
            device_token,
            browser_keys_json,
            attachment_store_path,
            attachment_store_key,
        ))
    })();
    let (
        relay_config,
        device_token,
        browser_keys_json,
        attachment_store_path,
        attachment_store_key,
    ) = record_start_preflight_result_with_hook(state, generation, preparation, |state| {
        publish(app, state)
    }).map_err(|error| {
        crate::relay_diagnostics::record(app, "preflight_failed", generation, None, None, None);
        error
    })?;

    if ensure_state_parent(&attachment_store_path.to_string_lossy()).is_err() {
        let error = user_error("relay_start_failed");
        mark_error(app, state, generation, error.clone());
        return Err(error);
    }

    if env::var_os("PKG_EXECPATH").is_some_and(|value| !value.is_empty()) {
        // Record only that the override was needed, never the inherited value.
        crate::relay_diagnostics::record(app, "sidecar_environment_sanitized", generation, None, None, None);
    }
    let mut command = match sidecar_command(app) {
        Ok(command) => command,
        Err(_) => {
            let error = user_error("relay_start_failed");
            mark_error(app, state, generation, error.clone());
            return Err(error);
        }
    }
    .arg("relay")
    .current_dir(&relay_config.workspace)
    .env("RELAY_SERVER_URL", relay_config.server_url.trim())
    .env("RELAY_DEVICE_ID", &relay_config.device_id)
    .env("RELAY_DEVICE_TOKEN", device_token)
    .env("RELAY_BROWSER_KEYS", browser_keys_json)
    .env("RELAY_ATTACHMENT_STORE_PATH", attachment_store_path)
    .env("RELAY_ATTACHMENT_STORE_KEY", attachment_store_key)
    .env("RELAY_ADAPTER", relay_config.adapter.as_env())
    .env("RELAY_DESKTOP_VERSION", app.package_info().version.to_string())
    .env("RELAY_PERFORMANCE_DIAGNOSTICS", if cfg!(target_os = "macos") { "1" } else { "0" })
    .env(
        "RELAY_DEFAULT_PROVIDER",
        relay_config.default_provider.as_env(),
    )
    .env("RELAY_WORKSPACE", &relay_config.workspace)
    .env(
        "PATH",
        gui_path(
            &relay_config.codex_bin,
            &relay_config.kimi_bin,
            &relay_config.claude_bin,
        ),
    );

    if !relay_config.state_path.is_empty() {
        if ensure_state_parent(&relay_config.state_path).is_err() {
            let error = user_error("relay_start_failed");
            mark_error(app, state, generation, error.clone());
            return Err(error);
        }
        command = command.env("RELAY_STATE_PATH", &relay_config.state_path);
    }
    if !relay_config.codex_bin.is_empty() {
        command = command.env("CODEX_BIN", &relay_config.codex_bin);
    }
    if !relay_config.kimi_bin.is_empty() {
        command = command.env("KIMI_BIN", &relay_config.kimi_bin);
    }
    if !relay_config.claude_bin.is_empty() {
        command = command.env("CLAUDE_BIN", &relay_config.claude_bin);
    }

    let (mut events, diagnostic_pid) = match commit_reserved_start_with_hook(state, generation, |runtime| {
        let (events, child) = command.spawn().map_err(|_| ())?;
        let pid = child.pid();
        runtime.file_access_limited = false;
        runtime.pid = Some(pid);
        runtime.child = Some(child);
        Ok((events, Some(pid)))
    }) {
        Ok(events) => events,
        Err(StartCommitError::Cancelled) => {
            // Stop/Quit cancelled this generation before the sidecar was
            // committed. The spawn hook did not run, so there is no child to
            // clean up and no error state should overwrite the user's Stop.
            return Err(user_error("relay_start_failed"));
        }
        Err(StartCommitError::Failed) => {
            let error = user_error("relay_start_failed");
            mark_error(app, state, generation, error.clone());
            return Err(error);
        }
    };
    state.log(LogLevel::Info, "relayune:relay_started");
    publish(app, state);

    crate::relay_diagnostics::record(app, "spawned", generation, diagnostic_pid, None, None);
    let process_started = std::time::Instant::now();
    let app_handle = app.clone();
    let state_handle = state.clone();
    tauri::async_runtime::spawn(async move {
        let mut stderr_counts = std::collections::BTreeMap::<&'static str, u32>::new();
        let mut recoverable = true;
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    if crate::performance_diagnostics::record_child(&app_handle, generation, diagnostic_pid, line.trim()) {
                        continue;
                    }
                    if let Some(phase) = crate::relay_diagnostics::startup_phase(line.trim()) {
                        crate::relay_diagnostics::record_timed(&app_handle, phase, generation, diagnostic_pid, None, None, Some(process_started.elapsed().as_millis() as u64));
                    } else if line.trim().starts_with("relayune:browser_presence:") {
                        if record_browser_presence(&state_handle, generation, line.trim()) {
                            // Presence refreshes the window without rebuilding native tray items.
                            let _ = app_handle.emit("relay-status", state_handle.snapshot());
                        }
                    } else if line.trim().starts_with("relayune:browser_key:") {
                        record_browser_key_ack(&state_handle, generation, line.trim());
                    } else if line.trim() == "Relayune file access limited" || line.trim() == "Relayune file access recovered" {
                        mark_file_access_status(&app_handle, &state_handle, generation, line.trim() == "Relayune file access limited");
                    } else if line.contains("Relay connected to") || line.contains("Relay reconnected") {
                        if mark_connected(&app_handle, &state_handle, generation) {
                            if let Some((kind, elapsed_ms)) = connection_timings.connected(Instant::now()) {
                                crate::performance_diagnostics::record_connection(&app_handle, generation, diagnostic_pid, kind, elapsed_ms);
                            }
                            crate::relay_diagnostics::record_timed(&app_handle, "connected", generation, diagnostic_pid, None, None, Some(process_started.elapsed().as_millis() as u64));
                        }
                    } else if line.contains("Relayune Relay sync recovered") {
                        mark_delivery_recovered(&app_handle, &state_handle, generation);
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    // Bound writes per generation even if a child floods stderr.
                    let category = crate::relay_diagnostics::stderr_category(line.trim());
                    if matches!(category, "startup_local_state" | "startup_unauthorized" | "stderr_disk_full" | "stderr_permission_denied") {
                        recoverable = false;
                    }
                    let stderr_count = stderr_counts.entry(category).or_default();
                    if *stderr_count < 8 {
                        crate::relay_diagnostics::record_timed(&app_handle, category, generation, diagnostic_pid, None, None, Some(process_started.elapsed().as_millis() as u64));
                    } else if *stderr_count == 8 {
                        crate::relay_diagnostics::record_timed(&app_handle, "stderr_limit_reached", generation, diagnostic_pid, None, None, Some(process_started.elapsed().as_millis() as u64));
                    }
                    *stderr_count = stderr_count.saturating_add(1);
                    if line.contains("Relayune Relay reconnecting:") {
                        connection_timings.reconnecting(Instant::now());
                        mark_reconnecting(&app_handle, &state_handle, generation, line.as_ref());
                    } else if line.contains("Relayune Relay sync warning:") {
                        mark_delivery_warning(&app_handle, &state_handle, generation);
                    }
                }
                CommandEvent::Error(_) => {
                    crate::relay_diagnostics::record_timed(&app_handle, "process_observer_error", generation, diagnostic_pid, None, None, Some(process_started.elapsed().as_millis() as u64));
                    mark_process_event_error(&app_handle, &state_handle, generation);
                }
                CommandEvent::Terminated(payload) => {
                    let event = {
                        let runtime = state_handle.inner.runtime.lock().expect("runtime mutex poisoned");
                        if runtime.generation != generation { "terminated_stale_generation" }
                        else if matches!(runtime.phase, RelayPhase::Stopping | RelayPhase::Stopped) { "terminated_requested" }
                        else { "terminated_unexpected" }
                    };
                    crate::relay_diagnostics::record_timed(&app_handle, event, generation, diagnostic_pid, payload.code, payload.signal, Some(process_started.elapsed().as_millis() as u64));
                    mark_terminated(&app_handle, &state_handle, generation, recoverable);
                    return;
                }
                _ => {}
            }
        }
        // The shell event sender can disappear without delivering Error or
        // Terminated. Surface that lost observation path instead of leaving
        // the status item and WebView frozen on Starting/Connected forever.
        crate::relay_diagnostics::record_timed(&app_handle, "process_stream_closed", generation, diagnostic_pid, None, None, Some(process_started.elapsed().as_millis() as u64));
        mark_process_stream_closed(&app_handle, &state_handle, generation);
    });

    Ok(state.snapshot())
}

pub fn stop(app: &AppHandle, state: &AppState) -> Result<RelaySnapshot, String> {
    crate::relay_diagnostics::record(app, "stop_requested", 0, state.snapshot().pid, None, None);
    stop_with_hooks(
        state,
        |state| publish(app, state),
        kill_relay_child,
        kill_relay_pid,
    )
}

enum StopTarget<T> {
    Child { child: T, pid: Option<u32> },
    Pid(u32),
}

enum StartAdmission {
    AlreadyActive,
    CleanupFailedRuntime(StopTarget<CommandChild>),
    Reserved(u64),
}

fn record_start_preflight_result_with_hook<T>(
    state: &AppState,
    generation: u64,
    result: Result<T, String>,
    publish_state: impl FnOnce(&AppState),
) -> Result<T, String> {
    let Err(error) = &result else {
        return result;
    };
    let admitted = {
        let Ok(mut runtime) = state.inner.runtime.lock() else {
            return result;
        };
        if state.exit_stop_requested()
            || runtime.generation != generation
            || !matches!(&runtime.phase, RelayPhase::Starting)
            || runtime.child.is_some()
            || runtime.pid.is_some()
        {
            // Stop/Quit invalidates an uncommitted generation before claiming
            // the process. A late config/credential failure from that cancelled
            // Start must not overwrite Stopped, a newer Start, or Connected.
            false
        } else {
            runtime.phase = RelayPhase::Error;
            runtime.last_error = Some(error.clone());
            true
        }
    };
    if admitted {
        // Without a runtime transition, startup's existing log-only fallback
        // left NSMenu/AX and the Web snapshot on Stopped with no Retry action.
        // Commit one stable diagnostic and one fresh presentation instead.
        state.log(LogLevel::Error, error);
        publish_state(state);
    }
    result
}

fn stop_with_hooks(
    state: &AppState,
    mut publish_state: impl FnMut(&AppState),
    kill_child: impl FnOnce(CommandChild) -> Result<(), String>,
    kill_pid: impl FnOnce(u32) -> Result<(), String>,
) -> Result<RelaySnapshot, String> {
    let target = take_stop_target(state)?;
    let Some(target) = target else {
        // `take_stop_target` has released the runtime mutex. Taking the snapshot
        // while holding that mutex would recursively lock it and hang the common
        // idempotent or concurrent Stop path forever. Republish even when no
        // kill target exists: cancellation may just have changed Starting to
        // Stopped, and the native menu/AX surface must observe that transition.
        publish_state(state);
        return Ok(state.snapshot());
    };
    stop_reserved_target_with_hooks(state, target, publish_state, kill_child, kill_pid)
}

fn stop_reserved_target_with_hooks<T>(
    state: &AppState,
    target: StopTarget<T>,
    mut publish_state: impl FnMut(&AppState),
    kill_child: impl FnOnce(T) -> Result<(), String>,
    kill_pid: impl FnOnce(u32) -> Result<(), String>,
) -> Result<RelaySnapshot, String> {
    state.log(LogLevel::Info, "relayune:relay_stopping");
    publish_state(state);

    let (kill_result, tracked_pid) = match target {
        StopTarget::Child { child, pid } => {
            let result = match pid {
                Some(pid) => kill_child(child).or_else(|_| kill_pid(pid)),
                None => kill_child(child),
            };
            (result, pid)
        }
        StopTarget::Pid(pid) => (kill_pid(pid), Some(pid)),
    };

    if kill_result.is_err() {
        let mut runtime = state
            .inner
            .runtime
            .lock()
            .map_err(|_| user_error("relay_stop_failed"))?;
        // A Terminated event can win the race and clear the tracked PID while
        // both native kill routes are returning. Only that observed transition
        // proves the Relay has stopped; otherwise retain the PID and a stable
        // error so the next Stop can make a real PID retry.
        if tracked_pid.is_none() || runtime.pid.is_some() {
            // Neither termination route is still in flight. Present an explicit
            // Needs attention state instead of leaving the native menu frozen on
            // the misleading "Stopping" label while retaining the PID for retry.
            runtime.phase = RelayPhase::Error;
            runtime.last_error = Some(user_error("relay_stop_failed"));
            drop(runtime);
            state.log(LogLevel::Error, "relayune:relay_stop_failed");
            publish_state(state);
            return Err(user_error("relay_stop_failed"));
        }
    }

    {
        let mut runtime = state
            .inner
            .runtime
            .lock()
            .map_err(|_| user_error("relay_stop_failed"))?;
        runtime.phase = RelayPhase::Stopped;
        runtime.pid = None;
        runtime.started_at = None;
        runtime.last_error = None;
    }
    state.log(LogLevel::Info, "relayune:relay_stopped");
    publish_state(state);
    Ok(state.snapshot())
}

fn reserve_start_with_failed_runtime_recovery(
    state: &AppState,
    owns_config_change: bool,
    mut publish_state: impl FnMut(&AppState),
    mut kill_child: impl FnMut(CommandChild) -> Result<(), String>,
    mut kill_pid: impl FnMut(u32) -> Result<(), String>,
) -> Result<Option<u64>, String> {
    loop {
        match reserve_start_generation(state, owns_config_change)? {
            StartAdmission::AlreadyActive => return Ok(None),
            StartAdmission::Reserved(generation) => return Ok(Some(generation)),
            StartAdmission::CleanupFailedRuntime(target) => {
                // CommandEvent::Error can leave the process alive because the
                // shell waiter may never emit Terminated. A user Retry must own
                // and stop that uncertain process before reserving a new
                // generation; otherwise Start used to return a false success
                // forever merely because a child handle was still present.
                stop_reserved_target_with_hooks(
                    state,
                    target,
                    |state| publish_state(state),
                    |child| kill_child(child),
                    |pid| kill_pid(pid),
                )?;
            }
        }
    }
}

fn reserve_start_generation(
    state: &AppState,
    owns_config_change: bool,
) -> Result<StartAdmission, String> {
    let mut runtime = state
        .inner
        .runtime
        .lock()
        .map_err(|_| user_error("relay_start_failed"))?;
    if state.exit_stop_requested()
        || (state.relay_config_change_in_flight() && !owns_config_change)
        || (owns_config_change && !state.relay_config_change_in_flight())
    {
        return Err(user_error("relay_start_failed"));
    }
    if matches!(&runtime.phase, RelayPhase::Starting | RelayPhase::Connected) {
        return Ok(StartAdmission::AlreadyActive);
    }
    if matches!(&runtime.phase, RelayPhase::Error) {
        if let Some(child) = runtime.child.take() {
            let pid = runtime.pid;
            runtime.phase = RelayPhase::Stopping;
            runtime.last_error = None;
            return Ok(StartAdmission::CleanupFailedRuntime(StopTarget::Child {
                child,
                pid,
            }));
        }
        if let Some(pid) = runtime.pid {
            runtime.phase = RelayPhase::Stopping;
            runtime.last_error = None;
            return Ok(StartAdmission::CleanupFailedRuntime(StopTarget::Pid(pid)));
        }
    }
    if runtime.child.is_some()
        || runtime.pid.is_some()
        || matches!(&runtime.phase, RelayPhase::Stopping)
    {
        // A failed Stop can no longer own a CommandChild but still retain the
        // real process PID for retry. The Error owner is claimed above; all
        // other live/in-flight combinations must block a duplicate Relay.
        return Err(user_error("relay_start_failed"));
    }
    runtime.generation = runtime.generation.saturating_add(1);
    runtime.phase = RelayPhase::Starting;
    runtime.pid = None;
    runtime.started_at = Some(chrono::Utc::now().to_rfc3339());
    runtime.last_error = None;
    Ok(StartAdmission::Reserved(runtime.generation))
}

pub(crate) fn runtime_requires_restart_for_config_change(state: &AppState) -> Result<bool, String> {
    let runtime = state
        .inner
        .runtime
        .lock()
        .map_err(|_| user_error("relay_stop_failed"))?;
    Ok(runtime.child.is_some()
        || runtime.pid.is_some()
        || matches!(
            runtime.phase,
            RelayPhase::Starting | RelayPhase::Connected | RelayPhase::Stopping
        ))
}

fn take_stop_target(state: &AppState) -> Result<Option<StopTarget<CommandChild>>, String> {
    let mut runtime = state
        .inner
        .runtime
        .lock()
        .map_err(|_| user_error("relay_stop_failed"))?;
    if cancel_uncommitted_start(&mut runtime) {
        return Ok(None);
    }
    if let Some(child) = runtime.child.take() {
        let pid = runtime.pid;
        runtime.phase = RelayPhase::Stopping;
        runtime.last_error = None;
        return Ok(Some(StopTarget::Child { child, pid }));
    }

    if let Some(pid) = runtime.pid {
        if matches!(&runtime.phase, RelayPhase::Stopping)
            && runtime.last_error.as_deref() != Some("relayune:relay_stop_failed")
        {
            // Another Stop owns the removed child handle and is killing it
            // outside the mutex. Do not race it with a second PID kill.
            return Ok(None);
        }
        // A previous owner exhausted child and PID termination but retained the
        // PID with relay_stop_failed. A later user retry must actually retry the
        // PID rather than return a misleading idempotent success forever.
        runtime.phase = RelayPhase::Stopping;
        runtime.last_error = None;
        return Ok(Some(StopTarget::Pid(pid)));
    }

    runtime.phase = RelayPhase::Stopped;
    runtime.started_at = None;
    runtime.last_error = None;
    Ok(None)
}

struct ExitStopTarget<T> {
    child: Option<T>,
    pid: Option<u32>,
}

pub fn stop_for_exit(state: &AppState) -> Result<(), String> {
    let target = take_exit_stop_target(state)?;
    stop_exit_target_with_hooks(state, target, kill_relay_child, kill_relay_pid)
}

fn take_exit_stop_target(state: &AppState) -> Result<ExitStopTarget<CommandChild>, String> {
    let mut runtime = state
        .inner
        .runtime
        .lock()
        .map_err(|_| user_error("relay_stop_failed"))?;
    if cancel_uncommitted_start(&mut runtime) {
        return Ok(ExitStopTarget {
            child: None,
            pid: None,
        });
    }
    let target = ExitStopTarget {
        child: runtime.child.take(),
        pid: runtime.pid,
    };
    if target.child.is_some() || target.pid.is_some() {
        runtime.phase = RelayPhase::Stopping;
    } else {
        runtime.phase = RelayPhase::Stopped;
        runtime.started_at = None;
        runtime.last_error = None;
    }
    Ok(target)
}

fn stop_exit_target_with_hooks<T>(
    state: &AppState,
    target: ExitStopTarget<T>,
    kill_child: impl FnOnce(T) -> Result<(), String>,
    kill_pid: impl FnOnce(u32) -> Result<(), String>,
) -> Result<(), String> {
    let kill_result = match (target.child, target.pid) {
        (Some(child), Some(pid)) => kill_child(child).or_else(|_| kill_pid(pid)),
        (Some(child), None) => kill_child(child),
        (None, Some(pid)) => kill_pid(pid),
        (None, None) => Ok(()),
    };

    if let Err(error) = kill_result {
        let mut runtime = state
            .inner
            .runtime
            .lock()
            .map_err(|_| user_error("relay_stop_failed"))?;
        // The process event can win the race and clear the PID while the kill
        // attempt is returning. In that case there is no child left to protect
        // and exit may continue. Otherwise preserve the PID so a second Quit
        // can retry termination instead of orphaning a process whose handle was
        // consumed by `CommandChild::kill`.
        if runtime.pid.is_none() {
            runtime.phase = RelayPhase::Stopped;
            runtime.started_at = None;
            runtime.last_error = None;
            return Ok(());
        }
        // ExitRequested has been cancelled, so this is no longer an in-flight
        // stop. Keep the retained PID retryable, but present the same explicit
        // Needs attention state as a failed normal Stop instead of leaving the
        // menu, tooltip and VoiceOver label stuck on "Stopping" indefinitely.
        runtime.phase = RelayPhase::Error;
        runtime.last_error = Some(user_error("relay_stop_failed"));
        return Err(error);
    }

    let mut runtime = state
        .inner
        .runtime
        .lock()
        .map_err(|_| user_error("relay_stop_failed"))?;
    runtime.phase = RelayPhase::Stopped;
    runtime.pid = None;
    runtime.started_at = None;
    runtime.last_error = None;
    Ok(())
}

fn kill_relay_child(child: CommandChild) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    let pid = child.pid();
    #[cfg(target_os = "windows")]
    {
        let pid = pid.to_string();
        let tree_kill = windows_taskkill_command().and_then(|mut command| {
            command
                .args(["/PID", &pid, "/T", "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .status()
                .map_err(|_| user_error("relay_stop_failed"))
        });
        if matches!(tree_kill, Ok(status) if status.success()) {
            return Ok(());
        }
    }

    #[cfg(target_os = "macos")]
    if graceful_macos_relay_exit(pid).is_ok() {
        return Ok(());
    }

    child.kill().map_err(|_| user_error("relay_stop_failed"))?;
    #[cfg(target_os = "macos")]
    confirm_macos_relay_process_exit(pid)?;
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum StartCommitError {
    Cancelled,
    Failed,
}

fn commit_reserved_start_with_hook<T>(
    state: &AppState,
    generation: u64,
    commit: impl FnOnce(&mut RelayRuntime) -> Result<T, ()>,
) -> Result<T, StartCommitError> {
    let mut runtime = state
        .inner
        .runtime
        .lock()
        .map_err(|_| StartCommitError::Failed)?;
    if runtime.generation != generation || !matches!(&runtime.phase, RelayPhase::Starting) {
        return Err(StartCommitError::Cancelled);
    }

    // Keep the reservation check, native spawn and child/PID publication in
    // one critical section. Stop/Quit therefore either cancels before spawn or
    // waits until it can claim the real child; it can never exit successfully
    // while an untracked sidecar is being created.
    commit(&mut runtime).map_err(|_| StartCommitError::Failed)
}

fn cancel_uncommitted_start(runtime: &mut RelayRuntime) -> bool {
    if !matches!(&runtime.phase, RelayPhase::Starting)
        || runtime.child.is_some()
        || runtime.pid.is_some()
    {
        return false;
    }

    // Invalidate the reservation before reporting Stopped. `phase` is also
    // checked by the commit gate, so cancellation remains correct even after
    // the generation counter wraps in an impossibly long-running process.
    runtime.generation = runtime.generation.wrapping_add(1);
    runtime.phase = RelayPhase::Stopped;
    runtime.started_at = None;
    runtime.last_error = None;
    true
}

#[cfg(any(target_os = "macos", test))]
const PROCESS_EXIT_CONFIRM_ATTEMPTS: usize = 40;

#[cfg(any(target_os = "macos", test))]
fn confirm_process_exit_with_hooks(
    mut process_is_running: impl FnMut() -> Result<bool, String>,
    mut wait_before_retry: impl FnMut(),
) -> Result<(), String> {
    for attempt in 0..PROCESS_EXIT_CONFIRM_ATTEMPTS {
        if !process_is_running()? {
            return Ok(());
        }
        if attempt + 1 < PROCESS_EXIT_CONFIRM_ATTEMPTS {
            wait_before_retry();
        }
    }
    Err(user_error("relay_stop_failed"))
}

#[cfg(target_os = "macos")]
fn confirm_macos_relay_process_exit(pid: u32) -> Result<(), String> {
    let pid = pid.to_string();
    confirm_process_exit_with_hooks(
        || {
            Command::new("/bin/kill")
                .args(["-0", &pid])
                .status()
                .map(|status| status.success())
                .map_err(|_| user_error("relay_stop_failed"))
        },
        || thread::sleep(Duration::from_millis(25)),
    )
}

// Give Node's SIGTERM handler time to close owned Agent adapters before using
// the force-kill fallback. Killing the sidecar first leaves app-server children
// reparented to launchd, beyond the adapter's normal cleanup path.
#[cfg(target_os = "macos")]
fn graceful_macos_relay_exit(pid: u32) -> Result<(), String> {
    let pid = pid.to_string();
    let signal = Command::new("/bin/kill")
        .args(["-TERM", &pid])
        .stderr(std::process::Stdio::null())
        .status();
    if !matches!(signal, Ok(status) if status.success()) {
        return Err(user_error("relay_stop_failed"));
    }
    for _ in 0..200 {
        let running = Command::new("/bin/kill")
            .args(["-0", &pid])
            .stderr(std::process::Stdio::null())
            .status()
            .map_err(|_| user_error("relay_stop_failed"))?
            .success();
        if !running {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(25));
    }
    Err(user_error("relay_stop_failed"))
}

fn kill_relay_pid(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if graceful_macos_relay_exit(pid).is_ok() {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    let status = {
        let pid = pid.to_string();
        windows_taskkill_command().and_then(|mut command| {
            command
                .args(["/PID", &pid, "/T", "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .status()
                .map_err(|_| user_error("relay_stop_failed"))
        })
    };

    #[cfg(not(target_os = "windows"))]
    let status = {
        let pid = pid.to_string();
        Command::new("/bin/kill").args(["-KILL", &pid]).status()
    };

    if !matches!(status, Ok(status) if status.success()) {
        return Err(user_error("relay_stop_failed"));
    }
    #[cfg(target_os = "macos")]
    confirm_macos_relay_process_exit(pid)?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_taskkill_command() -> Result<Command, String> {
    const MAX_SYSTEM_DIRECTORY_LENGTH: usize = 32_768;
    let mut buffer = vec![0u16; 260];
    loop {
        let length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) };
        if length == 0 {
            return Err(user_error("relay_stop_failed"));
        }
        let length = length as usize;
        if length < buffer.len() {
            let system_directory = std::ffi::OsString::from_wide(&buffer[..length]);
            return Ok(Command::new(
                PathBuf::from(system_directory).join("taskkill.exe"),
            ));
        }
        let required = length
            .checked_add(1)
            .filter(|required| *required <= MAX_SYSTEM_DIRECTORY_LENGTH)
            .ok_or_else(|| user_error("relay_stop_failed"))?;
        buffer.resize(required, 0);
    }
}

pub async fn revoke_current_device(
    app: &AppHandle,
    state: &AppState,
    device_token: &str,
) -> Result<(), String> {
    let config = state.config();
    let output = sidecar_command(app)
        .map_err(|_| user_error("sign_out_failed"))?
        .args(["revoke"])
        .env("RELAY_SERVER_URL", &config.server_url)
        .env("RELAY_DEVICE_TOKEN", device_token)
        .output()
        .await
        .map_err(|_| user_error("sign_out_failed"))?;
    if output.status.success() {
        return Ok(());
    }
    Err(user_error("sign_out_failed"))
}

pub async fn start_browser_pairing(
    app: &AppHandle,
    state: &AppState,
    pairing_id: &str,
    protocol: &str,
    initiator_share: &str,
) -> Result<StartBrowserPairingResponse, String> {
    eprintln!("relayune:browser_pairing_start_entered");
    let config = state.config();
    let device_token =
        secrets::get(SecretKind::DeviceToken, &config.device_id).map_err(|error| {
            eprintln!("relayune:browser_pairing_start_vault_failed");
            error
        })?;
    eprintln!("relayune:browser_pairing_start_vault_ready");
    let sidecar = sidecar_command(app).map_err(|_| {
        eprintln!("relayune:browser_pairing_start_sidecar_missing");
        user_error("pairing_failed")
    })?;
    let output = sidecar
        .args(["start-browser-pairing"])
        .env("RELAY_SERVER_URL", &config.server_url)
        .env("RELAY_DEVICE_TOKEN", device_token)
        .env("RELAY_PAIRING_ID", pairing_id)
        .env("RELAY_PAIRING_PROTOCOL", protocol)
        .env("RELAY_PAIRING_INITIATOR_SHARE", initiator_share)
        .output()
        .await
        .map_err(|_| {
            eprintln!("relayune:browser_pairing_start_sidecar_launch_failed");
            user_error("pairing_failed")
        })?;
    if !output.status.success() {
        eprintln!("relayune:browser_pairing_start_sidecar_exit_failed");
        return Err(user_error("pairing_failed"));
    }
    eprintln!("relayune:browser_pairing_start_sidecar_succeeded");
    let response =
        serde_json::from_slice::<StartBrowserPairingResponse>(&output.stdout).map_err(|_| {
            eprintln!("relayune:browser_pairing_start_response_invalid");
            user_error("pairing_failed")
        })?;
    chrono::DateTime::parse_from_rfc3339(&response.expires_at).map_err(|_| {
        eprintln!("relayune:browser_pairing_start_expiry_invalid");
        user_error("pairing_failed")
    })?;
    eprintln!("relayune:browser_pairing_start_completed");
    Ok(response)
}

pub async fn cancel_browser_pairing(
    app: &AppHandle,
    state: &AppState,
    pairing_id: &str,
) -> Result<(), String> {
    let config = state.config();
    let device_token = secrets::get(SecretKind::DeviceToken, &config.device_id)?;
    let output = sidecar_command(app)
        .map_err(|_| user_error("browser_access_failed"))?
        .args(["cancel-browser-pairing"])
        .env("RELAY_SERVER_URL", &config.server_url)
        .env("RELAY_DEVICE_TOKEN", device_token)
        .env("RELAY_PAIRING_ID", pairing_id)
        .output()
        .await
        .map_err(|_| user_error("browser_access_failed"))?;
    require_sidecar_success(
        output.status.success(),
        &output.stderr,
        "browser_access_failed",
    )
}

pub async fn list_browser_authorizations(
    app: &AppHandle,
    state: &AppState,
) -> Result<Vec<BrowserAuthorization>, String> {
    let config = state.config();
    let device_token = secrets::get(SecretKind::DeviceToken, &config.device_id)?;
    let output = sidecar_command(app)
        .map_err(|_| user_error("browser_access_failed"))?
        .args(["list-browser-authorizations"])
        .env("RELAY_SERVER_URL", &config.server_url)
        .env("RELAY_DEVICE_TOKEN", device_token)
        .output()
        .await
        .map_err(|_| user_error("browser_access_failed"))?;
    require_sidecar_success(
        output.status.success(),
        &output.stderr,
        "browser_access_failed",
    )?;
    let response = serde_json::from_slice::<BrowserAuthorizationList>(&output.stdout)
        .map_err(|_| user_error("browser_access_failed"))?;
    let local_browser_ids = config.browser_ids.iter().cloned().collect::<BTreeSet<_>>();
    if local_browser_ids.is_empty() {
        return Ok(response.browsers);
    }
    let (authorizations, orphaned) =
        separate_browser_authorizations(response.browsers, &local_browser_ids);
    let orphaned_count = orphaned.len();
    for authorization in orphaned {
        revoke_browser_authorization(app, state, &authorization.id).await?;
    }
    if orphaned_count > 0 {
        state.log(LogLevel::Info, "relayune:browser_authorizations_cleaned");
    }
    Ok(authorizations)
}


pub async fn feedback_request(
    app: &AppHandle,
    state: &AppState,
    action: &str,
    submission: Option<String>,
) -> Result<serde_json::Value, String> {
    if !["info", "submit"].contains(&action)
        || submission.as_ref().is_some_and(|value| value.len() > 4 * 1024 * 1024 + 24000)
    {
        return Err(user_error("feedback_failed"));
    }
    let config = state.config();
    config::validate(&config)?;
    let mut command = sidecar_command(app)
        .map_err(|_| user_error("feedback_failed"))?
        .args(["feedback"])
        .env("RELAY_SERVER_URL", &config.server_url)
        .env("RELAY_FEEDBACK_ACTION", action);
    if action != "info" {
        let token = secrets::get(SecretKind::DeviceToken, &config.device_id)?;
        command = command.env("RELAY_DEVICE_TOKEN", token);
    }
    if action == "info" {
        let output = command.output().await.map_err(|_| user_error("feedback_failed"))?;
        if !output.status.success() { return Err(user_error("feedback_failed")); }
        return serde_json::from_slice(&output.stdout).map_err(|_| user_error("feedback_failed"));
    }
    let value = submission.ok_or_else(|| user_error("feedback_failed"))?;
    let (mut events, mut child) = command.spawn().map_err(|_| user_error("feedback_failed"))?;
    // Images exceed OS environment limits. Stream the body over stdin, off the runtime thread.
    tauri::async_runtime::spawn_blocking(move || {
        let result = child.write(value.as_bytes());
        if result.is_err() { let _ = child.kill(); }
        result.map_err(|_| user_error("feedback_failed"))
        // Dropping the stdin writer signals EOF to the sidecar.
    }).await.map_err(|_| user_error("feedback_failed"))??;
    let mut stdout = Vec::new();
    let mut success = false;
    while let Some(event) = events.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                if stdout.len() + bytes.len() > 16384 { return Err(user_error("feedback_failed")); }
                stdout.extend(bytes);
            }
            CommandEvent::Terminated(payload) => { success = payload.code == Some(0); }
            CommandEvent::Error(_) => { return Err(user_error("feedback_failed")); }
            _ => {}
        }
    }
    if !success { return Err(user_error("feedback_failed")); }
    serde_json::from_slice(&stdout).map_err(|_| user_error("feedback_failed"))
}

fn separate_browser_authorizations(
    authorizations: Vec<BrowserAuthorization>,
    local_browser_ids: &BTreeSet<String>,
) -> (Vec<BrowserAuthorization>, Vec<BrowserAuthorization>) {
    authorizations
        .into_iter()
        .partition(|authorization| local_browser_ids.contains(&authorization.id))
}

pub async fn revoke_browser_authorization(
    app: &AppHandle,
    state: &AppState,
    browser_id: &str,
) -> Result<(), String> {
    let config = state.config();
    let device_token = secrets::get(SecretKind::DeviceToken, &config.device_id)?;
    let output = sidecar_command(app)
        .map_err(|_| user_error("browser_access_failed"))?
        .args(["revoke-browser-authorization"])
        .env("RELAY_SERVER_URL", &config.server_url)
        .env("RELAY_DEVICE_TOKEN", device_token)
        .env("RELAY_BROWSER_ID", browser_id)
        .output()
        .await
        .map_err(|_| user_error("browser_access_failed"))?;
    require_sidecar_success(
        output.status.success(),
        &output.stderr,
        "browser_access_failed",
    )
}

pub async fn complete_browser_pairing(
    app: &AppHandle,
    state: &AppState,
    pairing_id: &str,
    browser_id: &str,
    desktop_confirm: &str,
) -> Result<(), String> {
    eprintln!("relayune:browser_pairing_remote_complete_entered");
    let config = state.config();
    let sidecar = sidecar_command(app).map_err(|_| {
        eprintln!("relayune:browser_pairing_remote_complete_sidecar_missing");
        user_error("pairing_failed")
    })?;
    let output = sidecar
        .args(["complete-browser-pairing"])
        .env("RELAY_SERVER_URL", &config.server_url)
        .env("RELAY_PAIRING_ID", pairing_id)
        .env("RELAY_BROWSER_ID", browser_id)
        .env("RELAY_DESKTOP_CONFIRM", desktop_confirm)
        .output()
        .await
        .map_err(|_| {
            eprintln!("relayune:browser_pairing_remote_complete_sidecar_launch_failed");
            user_error("pairing_failed")
        })?;
    if !output.status.success() {
        eprintln!("relayune:browser_pairing_remote_complete_sidecar_exit_failed");
        return Err(user_error("pairing_failed"));
    }
    eprintln!("relayune:browser_pairing_remote_complete_completed");
    Ok(())
}

fn require_sidecar_success(success: bool, _stderr: &[u8], error_code: &str) -> Result<(), String> {
    if success {
        return Ok(());
    }
    Err(user_error(error_code))
}

fn mark_file_access_status(app: &AppHandle, state: &AppState, generation: u64, limited: bool) {
    if mark_file_access(state, generation, limited) {
        publish(app, state);
    }
}

fn mark_file_access(state: &AppState, generation: u64, limited: bool) -> bool {
    let Ok(mut runtime) = state.inner.runtime.lock() else {
        return false;
    };
    if runtime.generation != generation
        || matches!(runtime.phase, RelayPhase::Stopping | RelayPhase::Stopped)
    {
        return false;
    }
    runtime.file_access_limited = limited;
    true
}

fn record_browser_key_ack(state: &AppState, generation: u64, line: &str) {
    let Some(rest) = line.strip_prefix("relayune:browser_key:") else { return; };
    let Some((id, status)) = rest.rsplit_once(':') else { return; };
    if !matches!(status, "ok" | "error") { return; }
    if let Ok(mut runtime) = state.inner.runtime.lock() {
        if runtime.generation != generation { return; }
        if let Some((expected, result)) = runtime.browser_key_ack.as_mut() {
            if expected == id { *result = Some(status == "ok"); }
        }
    }
}

pub async fn update_browser_key(state: &AppState, browser_id: &str, key: Option<&str>) -> Result<(), String> {
    static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let (generation, id) = {
        let mut runtime = state.inner.runtime.lock().map_err(|_| user_error("pairing_failed"))?;
        let generation = runtime.generation;
        let id = format!("{}-{}", generation, NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
        let mut command = serde_json::to_vec(&serde_json::json!({
            "type": "relayune:browser_key", "request_id": id,
            "browser_id": browser_id, "key": key,
        })).map_err(|_| user_error("pairing_failed"))?;
        command.push(b'\n');
        runtime.child.as_mut().ok_or_else(|| user_error("pairing_failed"))?
            .write(&command).map_err(|_| user_error("pairing_failed"))?;
        runtime.browser_key_ack = Some((id.clone(), None));
        (generation, id)
    };
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        for _ in 0..100 {
            {
                let mut runtime = state.inner.runtime.lock().map_err(|_| user_error("pairing_failed"))?;
                if runtime.generation != generation || runtime.pid.is_none() {
                    return Err(user_error("pairing_failed"));
                }
                match runtime.browser_key_ack.as_ref() {
                    Some((expected, Some(ok))) if expected == &id => {
                        let ok = *ok;
                        runtime.browser_key_ack = None;
                        return if ok { Ok(()) } else { Err(user_error("pairing_failed")) };
                    }
                    Some((expected, None)) if expected == &id => {}
                    _ => return Err(user_error("pairing_failed")),
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        Err(user_error("pairing_failed"))
    }).await.map_err(|_| user_error("pairing_failed"))?
}

pub fn retry_file_access(state: &AppState) -> Result<(), String> {
    let mut runtime = state.inner.runtime.lock()
        .map_err(|_| user_error("workspace_invalid"))?;
    if let Some(child) = runtime.child.as_mut() {
        child.write(b"relayune:retry_file_access\n")
            .map_err(|_| user_error("workspace_invalid"))?;
    }
    Ok(())
}

fn mark_connected(app: &AppHandle, state: &AppState, generation: u64) -> bool {
    mark_connected_with_hook(state, generation, |state| publish(app, state))
}

fn mark_connected_with_hook(
    state: &AppState,
    generation: u64,
    publish_state: impl FnOnce(&AppState),
) -> bool {
    {
        let Ok(mut runtime) = state.inner.runtime.lock() else {
            return false;
        };
        if runtime.generation != generation
            || matches!(runtime.phase, RelayPhase::Stopping | RelayPhase::Stopped)
        {
            // Output already buffered by the sidecar can arrive after Stop/Quit
            // owns this generation. It must not turn Stopping back into
            // Connected or attach a false success diagnostic to a newer run.
            return false;
        }
        runtime.phase = RelayPhase::Connected;
        runtime.last_error = None;
        // Keep the diagnostic ordered with the admitted runtime transition.
        // Once this guard is released a Stop may legitimately take ownership,
        // but it cannot observe Connected without its matching stable log.
        state.log(LogLevel::Info, "relayune:relay_connected");
    }
    publish_state(state);
    true
}

fn mark_reconnecting(app: &AppHandle, state: &AppState, generation: u64, detail: &str) {
    let _ = mark_reconnecting_with_hook(state, generation, detail, |state| publish(app, state));
}

fn mark_delivery_warning(app: &AppHandle, state: &AppState, generation: u64) {
    if log_delivery_transition(state, generation, LogLevel::Error, "relay_sync_degraded") {
        publish(app, state);
    }
}

fn mark_delivery_recovered(app: &AppHandle, state: &AppState, generation: u64) {
    if log_delivery_transition(state, generation, LogLevel::Info, "relay_sync_recovered") {
        publish(app, state);
    }
}

fn log_delivery_transition(
    state: &AppState,
    generation: u64,
    level: LogLevel,
    code: &str,
) -> bool {
    let Ok(runtime) = state.inner.runtime.lock() else {
        return false;
    };
    if runtime.generation != generation
        || matches!(runtime.phase, RelayPhase::Stopping | RelayPhase::Stopped)
    {
        return false;
    }
    state.log(level, format!("relayune:{code}"));
    true
}

fn mark_reconnecting_with_hook(
    state: &AppState,
    generation: u64,
    detail: &str,
    publish_state: impl FnOnce(&AppState),
) -> bool {
    {
        let Ok(mut runtime) = state.inner.runtime.lock() else {
            return false;
        };
        if runtime.generation != generation
            || matches!(runtime.phase, RelayPhase::Stopping | RelayPhase::Stopped)
        {
            // A late reconnect warning belongs to neither the Stop owner nor a
            // newer generation. Discard it without mutating phase, diagnostics,
            // NSMenu/AX or the Web snapshot.
            return false;
        }
        if detail.contains("401")
            || detail.contains("凭据")
            || detail.contains("令牌")
            || detail.contains("unauthorized")
        {
            runtime.phase = RelayPhase::Error;
            runtime.last_error = Some(user_error("relay_unauthorized"));
            state.log(LogLevel::Error, "relayune:relay_unauthorized");
        } else {
            runtime.phase = RelayPhase::Starting;
            runtime.last_error = Some(user_error("relay_reconnecting"));
            state.log(LogLevel::Error, "relayune:relay_reconnecting");
        }
    }
    publish_state(state);
    true
}

fn mark_process_event_error(app: &AppHandle, state: &AppState, generation: u64) {
    mark_process_event_error_with_hook(state, generation, |state| publish(app, state));
}

fn mark_process_stream_closed(app: &AppHandle, state: &AppState, generation: u64) {
    mark_process_event_error(app, state, generation);
}

fn mark_process_event_error_with_hook(
    state: &AppState,
    generation: u64,
    publish_state: impl FnOnce(&AppState),
) -> bool {
    {
        let Ok(mut runtime) = state.inner.runtime.lock() else {
            return false;
        };
        if runtime.generation != generation
            || matches!(
                runtime.phase,
                RelayPhase::Error | RelayPhase::Stopping | RelayPhase::Stopped
            )
        {
            // A late/duplicate observer failure must not overwrite a newer
            // Relay generation, an already published Error, or a user-requested
            // Stop that already owns termination.
            return false;
        }
        // Tauri can emit CommandEvent::Error or close the event stream without
        // Terminated. Make the hidden native surfaces actionable instead of
        // leaving them on Connecting/Connected forever, but retain child/PID
        // so Stop or Quit can still attempt real cleanup.
        runtime.phase = RelayPhase::Error;
        runtime.last_error = Some(user_error("relay_start_failed"));
    }
    state.log(LogLevel::Error, "relayune:relay_start_failed");
    publish_state(state);
    true
}

fn mark_error(app: &AppHandle, state: &AppState, generation: u64, error: String) {
    crate::relay_diagnostics::record(app, "start_failed", generation, None, None, None);
    if let Ok(mut runtime) = state.inner.runtime.lock() {
        if runtime.generation != generation {
            return;
        }
        runtime.phase = RelayPhase::Error;
        runtime.child = None;
        runtime.pid = None;
        runtime.last_error = Some(error.clone());
    }
    state.log(LogLevel::Error, error);
    publish(app, state);
}

// Reserve recovery while holding the same lifecycle lock as Stop and Start.
// No generic Start call is allowed after the delay: it could revive a stopped
// app or replace a newer manually started child.
fn reserve_automatic_restart(runtime: &mut RelayRuntime, now: std::time::Instant) -> Option<(u64, u64)> {
    if !matches!(runtime.phase, RelayPhase::Error) || runtime.child.is_some() || runtime.pid.is_some() {
        return None;
    }
    runtime.automatic_restarts.retain(|at| now.saturating_duration_since(*at).as_secs() < 600);
    let delay = *[2, 5, 15].get(runtime.automatic_restarts.len())?;
    runtime.automatic_restarts.push_back(now);
    runtime.generation = runtime.generation.wrapping_add(1);
    runtime.phase = RelayPhase::Starting;
    runtime.last_error = Some(user_error("relay_reconnecting"));
    runtime.started_at = Some(chrono::Utc::now().to_rfc3339());
    Some((runtime.generation, delay))
}

fn mark_terminated(app: &AppHandle, state: &AppState, generation: u64, recoverable: bool) {
    let mut unexpected = false;
    let mut recovery = None;
    if let Ok(mut runtime) = state.inner.runtime.lock() {
        if runtime.generation != generation {
            return;
        }
        let requested = matches!(runtime.phase, RelayPhase::Stopping | RelayPhase::Stopped);
        runtime.child = None;
        runtime.pid = None;
        runtime.started_at = None;
        if requested {
            runtime.phase = RelayPhase::Stopped;
            runtime.last_error = None;
        } else {
            unexpected = true;
            runtime.phase = RelayPhase::Error;
            runtime.last_error = Some(user_error("relay_exited"));
            if recoverable && !state.exit_stop_requested() && !state.relay_config_change_in_flight() {
                recovery = reserve_automatic_restart(&mut runtime, std::time::Instant::now());
            }
        }
    }
    if unexpected {
        state.log(LogLevel::Error, user_error("relay_exited"));
    }
    publish(app, state);
    if let Some((next_generation, delay)) = recovery {
        crate::relay_diagnostics::record(app, "automatic_restart_scheduled", next_generation, None, None, None);
        let app = app.clone();
        let state = state.clone();
        tauri::async_runtime::spawn_blocking(move || {
            std::thread::sleep(std::time::Duration::from_secs(delay));
            // Preflight/spawn failures already publish their actionable error.
            let _ = start_reserved(&app, &state, next_generation);
        });
    } else if unexpected {
        crate::relay_diagnostics::record(app, "automatic_restart_stopped", generation, None, None, None);
    }
}

fn record_browser_presence(state: &AppState, generation: u64, line: &str) -> bool {
    let Some(payload) = line.strip_prefix("relayune:browser_presence:") else { return false; };
    if payload.len() > 42_000 { return false; }
    let Ok(ids) = serde_json::from_str::<Vec<String>>(payload) else { return false; };
    if ids.len() > 256 || ids.iter().any(|id| id.is_empty() || id.len() > 160 ||
        !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')) { return false; }
    let Ok(mut runtime) = state.inner.runtime.lock() else { return false; };
    if runtime.generation != generation || !matches!(runtime.phase, RelayPhase::Starting | RelayPhase::Connected) {
        return false;
    }
    runtime.browser_presence = Some((generation, ids, chrono::Utc::now().timestamp_millis()));
    true
}

pub fn publish(app: &AppHandle, state: &AppState) {
    crate::publish_relay_snapshot(app, state);
}

fn ensure_state_parent(value: &str) -> Result<(), String> {
    let path = Path::new(value);
    let parent = path
        .parent()
        .ok_or_else(|| user_error("relay_start_failed"))?;
    std::fs::create_dir_all(parent).map_err(|_| user_error("relay_start_failed"))
}

fn gui_path(codex_bin: &str, kimi_bin: &str, claude_bin: &str) -> String {
    let mut paths = BTreeSet::<PathBuf>::new();
    for candidate in [codex_bin, kimi_bin, claude_bin] {
        if !candidate.is_empty() {
            if let Some(parent) = Path::new(candidate).parent() {
                paths.insert(parent.to_path_buf());
            }
        }
    }
    // Use the same search directories as the readiness probe. Otherwise the
    // settings screen can report an NVM-installed CLI as ready while the Relay
    // sidecar cannot resolve it and silently omits that provider's sessions.
    paths.extend(crate::agent_runtime::executable_search_directories());

    #[cfg(target_os = "macos")]
    for fixed in ["/usr/sbin", "/sbin"] {
        paths.insert(PathBuf::from(fixed));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(app_data) = env::var_os("APPDATA") {
            paths.insert(PathBuf::from(app_data).join("npm"));
        }
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            paths.insert(PathBuf::from(local_app_data).join("Microsoft/WindowsApps"));
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            paths.insert(PathBuf::from(program_files).join("nodejs"));
        }
        if let Some(system_root) = env::var_os("SystemRoot") {
            let system_root = PathBuf::from(system_root);
            paths.insert(system_root.join("System32"));
            paths.insert(system_root.join("System32/WindowsPowerShell/v1.0"));
            paths.insert(system_root);
        }
    }

    if let Some(existing) = env::var_os("PATH") {
        paths.extend(env::split_paths(&existing));
    }
    let fallback = env::var_os("PATH").unwrap_or_else(default_system_path);
    env::join_paths(paths)
        .unwrap_or(fallback)
        .to_string_lossy()
        .into_owned()
}

#[cfg(target_os = "windows")]
fn default_system_path() -> std::ffi::OsString {
    r"C:\Windows\System32;C:\Windows".into()
}

#[cfg(not(target_os = "windows"))]
fn default_system_path() -> std::ffi::OsString {
    "/usr/bin:/bin:/usr/sbin:/sbin".into()
}

#[cfg(target_os = "macos")]
fn legacy_relay_pid() -> Option<u32> {
    let output = Command::new("/usr/bin/pgrep")
        .args(["-f", "/relay/cli.mjs relay"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| line.trim().parse::<u32>().ok())
}

#[cfg(not(target_os = "macos"))]
fn legacy_relay_pid() -> Option<u32> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        model::{RelayAdapter, RelayConfig, RelayProvider},
        state::AppState,
    };
    use std::{sync::mpsc, thread, time::Duration};

    #[cfg(unix)]
    #[test]
    fn sidecar_entrypoint_overrides_pkg_modes_without_clearing_other_environment() {
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_shell::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets())).unwrap();
        for inherited in ["/some/relayune-core", "PKG_INVOKE_NODEJS"] {
            let command = app.shell().command("/bin/sh")
                .env("PKG_EXECPATH", inherited)
                .env("HOME", "/sentinel-home")
                .env("PATH", "/sentinel-bin")
                .env("RELAY_DEVICE_TOKEN", "test-only-canary")
                .env("NODE_USE_SYSTEM_CA", "0")
                .args(["-c", "test \"$NODE_USE_SYSTEM_CA\" = 1 && test -z \"$PKG_EXECPATH\" && test \"$HOME\" = /sentinel-home && test \"$PATH\" = /sentinel-bin && test \"$RELAY_DEVICE_TOKEN\" = test-only-canary"]);
            let output = tauri::async_runtime::block_on(application_entrypoint(command).output()).unwrap();
            assert!(output.status.success());
        }
    }

    #[test]
    #[ignore = "requires RELAYUNE_TEST_SIDECAR_PATH pointing to a built pkg executable"]
    fn packaged_sidecar_uses_bundled_entrypoint_under_inherited_pkg_modes() {
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_shell::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets())).unwrap();
        let path = std::env::var("RELAYUNE_TEST_SIDECAR_PATH").expect("built sidecar path");
        for inherited in [&path, "PKG_INVOKE_NODEJS"] {
            let command = app.shell().command(&path)
                .env("PKG_EXECPATH", inherited).arg("--help");
            let output = tauri::async_runtime::block_on(application_entrypoint(command).output()).unwrap();
            let text = format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
            assert_eq!(output.status.code(), Some(1));
            assert!(text.contains("Usage: node relay/cli.mjs"));
            assert!(!text.contains("MODULE_NOT_FOUND"));
        }
}

    #[test]
    fn connection_timings_cover_startup_and_entire_reconnect_without_duplicates() {
        let start = Instant::now();
        let mut clock = ConnectionTimings::new(start);
        clock.reconnecting(start + Duration::from_secs(1));
        assert_eq!(
            clock.connected(start + Duration::from_secs(3)),
            Some(("startup", 3000))
        );
        assert_eq!(clock.connected(start + Duration::from_secs(4)), None);
        clock.reconnecting(start + Duration::from_secs(5));
        clock.reconnecting(start + Duration::from_secs(8));
        assert_eq!(
            clock.connected(start + Duration::from_secs(12)),
            Some(("reconnect", 7000))
        );
        assert_eq!(clock.connected(start + Duration::from_secs(13)), None);
        clock.reconnecting(start + Duration::from_secs(20));
        assert_eq!(
            clock.connected(start + Duration::from_secs(21)),
            Some(("reconnect", 1000))
        );
        let mut replacement = ConnectionTimings::new(start + Duration::from_secs(30));
        assert_eq!(
            replacement.connected(start + Duration::from_secs(31)),
            Some(("startup", 1000))
        );
    }

    fn runtime_probe_state() -> AppState {
        AppState::new(
            RelayConfig {
                server_url: "https://relayune.giraffetree.cn".into(),
                device_id: "dev_relay_runtime_probe".into(),
                account_email: None,
                adapter: RelayAdapter::Multi,
                default_provider: RelayProvider::Kimi,
                workspace: std::env::temp_dir().to_string_lossy().into_owned(),
                codex_bin: String::new(),
                kimi_bin: String::new(),
                claude_bin: String::new(),
                state_path: String::new(),
                browser_ids: Vec::new(),
                start_relay_on_launch: true,
                ui_language: Some("en".into()),
            },
            false,
        )
    }

    #[test]
    fn automatic_restart_is_bounded_and_budget_recovers_after_ten_minutes() {
        let state = runtime_probe_state();
        let mut runtime = state.inner.runtime.lock().unwrap();
        let now = std::time::Instant::now();
        for delay in [2, 5, 15] {
            runtime.phase = RelayPhase::Error;
            let previous = runtime.generation;
            assert_eq!(reserve_automatic_restart(&mut runtime, now), Some((previous + 1, delay)));
        }
        runtime.phase = RelayPhase::Error;
        assert_eq!(reserve_automatic_restart(&mut runtime, now), None);
        assert_eq!(reserve_automatic_restart(&mut runtime, now + Duration::from_secs(600)), Some((4, 2)));
    }

    #[test]
    fn stop_cancels_delayed_restart_and_stale_recovery_cannot_spawn() {
        let state = runtime_probe_state();
        let generation = {
            let mut runtime = state.inner.runtime.lock().unwrap();
            runtime.phase = RelayPhase::Error;
            reserve_automatic_restart(&mut runtime, std::time::Instant::now()).unwrap().0
        };
        assert!(take_stop_target(&state).unwrap().is_none());
        assert_eq!(commit_reserved_start_with_hook(&state, generation, |_| -> Result<(), ()> {
            panic!("cancelled recovery must never spawn")
        }), Err(StartCommitError::Cancelled));
        assert!(matches!(reserve_start_generation(&state, false).unwrap(), StartAdmission::Reserved(_)));
        assert_eq!(commit_reserved_start_with_hook(&state, generation, |_| -> Result<(), ()> {
            panic!("old recovery must never replace a manual start")
        }), Err(StartCommitError::Cancelled));
    }

    #[test]
    fn automatic_restart_never_claims_a_stopped_or_live_process() {
        let state = runtime_probe_state();
        let mut runtime = state.inner.runtime.lock().unwrap();
        let now = std::time::Instant::now();
        assert_eq!(reserve_automatic_restart(&mut runtime, now), None);
        runtime.phase = RelayPhase::Error;
        runtime.pid = Some(123);
        assert_eq!(reserve_automatic_restart(&mut runtime, now), None);
    }

    #[test]
    fn browser_presence_is_ephemeral_and_generation_bound() {
        let state = runtime_probe_state();
        {
            let mut runtime = state.inner.runtime.lock().unwrap();
            runtime.generation = 12;
            runtime.phase = RelayPhase::Connected;
        }
        let line = "relayune:browser_presence:[\"phone\"]";
        assert!(!record_browser_presence(&state, 11, line));
        assert!(record_browser_presence(&state, 12, line));
        assert_eq!(state.snapshot().online_browser_ids, vec!["phone"]);
        assert!(state.snapshot().logs.is_empty());
        assert!(!record_browser_presence(&state, 12, "relayune:browser_presence:[\"bad id\"]"));
        {
            let mut runtime = state.inner.runtime.lock().unwrap();
            runtime.browser_presence.as_mut().unwrap().2 -= 6_000;
        }
        assert!(state.snapshot().online_browser_ids.is_empty());
        assert!(record_browser_presence(&state, 12, line));
        state.inner.runtime.lock().unwrap().generation = 13;
        assert!(state.snapshot().online_browser_ids.is_empty());
        state.inner.runtime.lock().unwrap().phase = RelayPhase::Stopped;
        assert!(!record_browser_presence(&state, 13, line));
    }

    #[test]
    fn browser_key_confirmation_requires_current_generation_and_request() {
        let state = runtime_probe_state();
        {
            let mut runtime = state.inner.runtime.lock().unwrap();
            runtime.generation = 12;
            runtime.browser_key_ack = Some(("12-1".into(), None));
        }
        record_browser_key_ack(&state, 11, "relayune:browser_key:12-1:ok");
        record_browser_key_ack(&state, 12, "relayune:browser_key:12-2:ok");
        record_browser_key_ack(&state, 12, "relayune:browser_key:12-1:unexpected");
        assert_eq!(state.inner.runtime.lock().unwrap().browser_key_ack, Some(("12-1".into(), None)));
        record_browser_key_ack(&state, 12, "relayune:browser_key:12-1:ok");
        assert_eq!(state.inner.runtime.lock().unwrap().browser_key_ack, Some(("12-1".into(), Some(true))));
    }

    #[test]
    fn file_access_warning_is_independent_of_transport_and_ignores_old_processes() {
        let state = runtime_probe_state();
        {
            let mut runtime = state.inner.runtime.lock().unwrap();
            runtime.generation = 12;
            runtime.phase = RelayPhase::Connected;
        }
        assert!(mark_file_access(&state, 12, true));
        assert!(state.snapshot().file_access_limited);
        assert!(matches!(state.snapshot().phase, RelayPhase::Connected));
        assert!(!mark_file_access(&state, 11, false));
        assert!(state.snapshot().file_access_limited);
        assert!(mark_file_access(&state, 12, false));
        assert!(!state.snapshot().file_access_limited);
        state.inner.workspace_access_denied.store(true, std::sync::atomic::Ordering::SeqCst);
        assert!(state.snapshot().file_access_limited);
    }

    #[test]
    fn gui_path_always_contains_system_binaries() {
        let path = gui_path("", "", "");
        let entries = env::split_paths(&path).collect::<Vec<_>>();
        assert!(!entries.is_empty());
        assert!(crate::agent_runtime::executable_search_directories()
            .iter()
            .all(|directory| entries.contains(directory)));
        #[cfg(target_os = "macos")]
        {
            assert!(entries.iter().any(|value| value == Path::new("/usr/bin")));
            assert!(entries.iter().any(|value| value == Path::new("/bin")));
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn relay_stop_allows_signal_cleanup_of_agent_children() {
        use std::io::{BufRead, BufReader};
        use std::process::Stdio;
        let script = r#"import subprocess,sys,signal
child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'])
def stop(*args):
    child.terminate()
    child.wait()
    sys.exit(0)
signal.signal(signal.SIGTERM,stop)
print(child.pid,flush=True)
signal.pause()
"#;
        let mut parent = Command::new("/usr/bin/python3")
            .args(["-c", script]).stdout(Stdio::piped()).spawn().unwrap();
        let pid = parent.id();
        let mut line = String::new();
        BufReader::new(parent.stdout.take().unwrap()).read_line(&mut line).unwrap();
        let child_pid = line.trim().parse::<u32>().unwrap();
        let waiter = thread::spawn(move || parent.wait().unwrap());
        let result = kill_relay_pid(pid);
        waiter.join().unwrap();
        let child_alive = Command::new("/bin/kill").args(["-0", &child_pid.to_string()])
            .stderr(Stdio::null()).status().unwrap().success();
        if child_alive {
            let _ = Command::new("/bin/kill").args(["-TERM", &child_pid.to_string()]).status();
        }
        assert!(result.is_ok());
        assert!(!child_alive, "Relay must get a chance to close its owned Agent processes");
    }

    #[test]
    fn process_exit_confirmation_waits_until_the_pid_disappears() {
        let mut checks = 0;
        let mut waits = 0;
        let result = confirm_process_exit_with_hooks(
            || {
                checks += 1;
                Ok(checks < 3)
            },
            || waits += 1,
        );

        assert_eq!(result, Ok(()));
        assert_eq!(checks, 3);
        assert_eq!(waits, 2);
    }

    #[test]
    fn process_exit_confirmation_fails_closed_after_the_bound() {
        let mut checks = 0;
        let mut waits = 0;
        let result = confirm_process_exit_with_hooks(
            || {
                checks += 1;
                Ok(true)
            },
            || waits += 1,
        );

        assert_eq!(result, Err(user_error("relay_stop_failed")));
        assert_eq!(checks, PROCESS_EXIT_CONFIRM_ATTEMPTS);
        assert_eq!(waits, PROCESS_EXIT_CONFIRM_ATTEMPTS - 1);
    }

    #[test]
    fn separates_authorizations_missing_from_local_config() {
        let local_id = format!("web_{}", "1".repeat(32));
        let orphaned_id = format!("web_{}", "2".repeat(32));
        let authorizations = vec![
            browser_authorization(&local_id),
            browser_authorization(&orphaned_id),
        ];
        let local_ids = BTreeSet::from([local_id.clone()]);

        let (retained, orphaned) = separate_browser_authorizations(authorizations, &local_ids);

        assert_eq!(retained.len(), 1);
        assert_eq!(retained[0].id, local_id);
        assert_eq!(orphaned.len(), 1);
        assert_eq!(orphaned[0].id, orphaned_id);
    }

    #[test]
    fn idempotent_stop_returns_before_deadlock_timeout() {
        let state = runtime_probe_state();
        let (result_tx, result_rx) = mpsc::channel();
        thread::spawn(move || {
            let result = stop_with_hooks(&state, |_| {}, |_| Ok(()), |_| Ok(()));
            let _ = result_tx.send(result);
        });

        let snapshot = result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("idempotent Stop recursively locked the runtime mutex")
            .expect("idempotent Stop should succeed");
        assert!(matches!(snapshot.phase, RelayPhase::Stopped));
        assert!(snapshot.pid.is_none());
    }

    #[test]
    fn exit_gate_rejects_a_start_already_waiting_for_the_runtime_lock() {
        let state = runtime_probe_state();
        let runtime_guard = state.inner.runtime.lock().expect("runtime lock");
        let waiting_state = state.clone();
        let (waiting_tx, waiting_rx) = mpsc::channel();
        let (result_tx, result_rx) = mpsc::channel();
        thread::spawn(move || {
            waiting_tx
                .send(())
                .expect("record Start waiting for runtime admission");
            let _ = result_tx.send(reserve_start_generation(&waiting_state, false));
        });
        waiting_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("Start did not reach runtime admission");

        assert!(state.begin_exit_stop());
        drop(runtime_guard);
        assert!(
            matches!(
                result_rx
                    .recv_timeout(Duration::from_secs(1))
                    .expect("Start admission deadlocked behind Quit"),
                Err(error) if error == user_error("relay_start_failed")
            ),
            "a Start that began first must recheck the later Quit while holding runtime"
        );

        state.cancel_exit_stop();
        assert!(
            matches!(
                reserve_start_generation(&state, false)
                    .expect("Start retry should remain available"),
                StartAdmission::Reserved(_)
            ),
            "a failed/cancelled Quit must reopen Start admission"
        );
    }

    #[test]
    fn config_change_rejects_waiting_start_and_replaces_an_owned_preflight() {
        let state = runtime_probe_state();
        let runtime_guard = state.inner.runtime.lock().expect("runtime lock");
        let waiting_state = state.clone();
        let (waiting_tx, waiting_rx) = mpsc::channel();
        let (result_tx, result_rx) = mpsc::channel();
        thread::spawn(move || {
            waiting_tx
                .send(())
                .expect("record Start waiting for runtime admission");
            let _ = result_tx.send(reserve_start_generation(&waiting_state, false));
        });
        waiting_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("Start did not reach runtime admission");

        assert!(state.begin_relay_config_change());
        drop(runtime_guard);
        assert!(matches!(
            result_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("Start admission deadlocked behind settings"),
            Err(error) if error == user_error("relay_start_failed")
        ));

        let old_generation = match reserve_start_generation(&state, true)
            .expect("the settings owner should admit its replacement Start")
        {
            StartAdmission::Reserved(generation) => generation,
            _ => panic!("the settings owner should reserve a new generation"),
        };
        assert!(runtime_requires_restart_for_config_change(&state)
            .expect("Starting should require replacement"));
        stop_with_hooks(
            &state,
            |_| {},
            |_| panic!("preflight has no child to stop"),
            |_| panic!("preflight has no PID to stop"),
        )
        .expect("settings should cancel the owned old-config preflight");
        let replacement_generation = match reserve_start_generation(&state, true)
            .expect("settings should admit the new-config replacement")
        {
            StartAdmission::Reserved(generation) => generation,
            _ => panic!("settings should reserve the replacement generation"),
        };
        assert_ne!(replacement_generation, old_generation);
        state.finish_relay_config_change();
    }

    #[test]
    fn concurrent_stop_preserves_the_inflight_exit_pid() {
        let state = runtime_probe_state();
        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Stopping;
            runtime.pid = Some(4_218);
        }

        let target = take_stop_target(&state).expect("concurrent Stop should remain readable");
        assert!(target.is_none());
        let snapshot = state.snapshot();
        assert!(matches!(snapshot.phase, RelayPhase::Stopping));
        assert_eq!(snapshot.pid, Some(4_218));
    }

    #[test]
    fn failed_normal_stop_publishes_and_retries_the_retained_pid() {
        let state = runtime_probe_state();
        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Stopping;
            runtime.pid = Some(4_221);
        }
        let (result_tx, result_rx) = mpsc::channel();
        thread::spawn(move || {
            let mut published = Vec::new();
            let first = stop_reserved_target_with_hooks(
                &state,
                StopTarget::Child {
                    child: (),
                    pid: Some(4_221),
                },
                |state| published.push(state.snapshot()),
                |_| Err(user_error("relay_stop_failed")),
                |_| Err(user_error("relay_stop_failed")),
            );
            assert_eq!(
                first.expect_err("both native Stop routes should fail"),
                user_error("relay_stop_failed")
            );
            let failed = state.snapshot();
            assert!(matches!(failed.phase, RelayPhase::Error));
            assert_eq!(failed.pid, Some(4_221));
            assert_eq!(failed.last_error, Some(user_error("relay_stop_failed")));
            assert_eq!(published.len(), 2);
            assert_eq!(
                published
                    .last()
                    .and_then(|snapshot| snapshot.last_error.clone()),
                Some(user_error("relay_stop_failed")),
                "the native menu and WebView must observe the failed Stop"
            );
            assert_eq!(state.snapshot().pid, Some(4_221));

            let retry = take_stop_target(&state)
                .expect("failed Stop retry should remain readable")
                .expect("the retained PID must produce a real retry target");
            assert!(matches!(&retry, StopTarget::Pid(4_221)));
            let second = stop_reserved_target_with_hooks(
                &state,
                retry,
                |state| published.push(state.snapshot()),
                |_| panic!("a retry must not reuse the consumed child handle"),
                |pid| {
                    assert_eq!(pid, 4_221);
                    Ok(())
                },
            );
            let _ = result_tx.send((second, state.snapshot(), published));
        });

        let (second, recovered, published) = result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("failed normal Stop retry deadlocked");
        second.expect("the retained PID retry should recover Stop");
        assert!(matches!(recovered.phase, RelayPhase::Stopped));
        assert!(recovered.pid.is_none());
        assert!(recovered.last_error.is_none());
        assert_eq!(published.len(), 4);
        assert!(published
            .iter()
            .any(|snapshot| snapshot.last_error == Some(user_error("relay_stop_failed"))));
    }

    #[test]
    fn exit_stop_kills_after_releasing_runtime_lock() {
        let state = runtime_probe_state();
        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Stopping;
            runtime.pid = Some(4_219);
        }
        let lock_probe = state.clone();
        let (result_tx, result_rx) = mpsc::channel();
        thread::spawn(move || {
            let result = stop_exit_target_with_hooks(
                &state,
                ExitStopTarget {
                    child: Some(()),
                    pid: Some(4_219),
                },
                move |_| {
                    let _guard = lock_probe
                        .inner
                        .runtime
                        .lock()
                        .map_err(|_| user_error("relay_stop_failed"))?;
                    Ok(())
                },
                |_| panic!("PID fallback should not run after a successful child kill"),
            );
            let _ = result_tx.send(result);
        });

        result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("exit Stop held the runtime mutex while killing the child")
            .expect("exit Stop should succeed");
    }

    #[test]
    fn exit_stop_failure_preserves_pid_for_a_recoverable_retry() {
        let state = runtime_probe_state();
        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Stopping;
            runtime.pid = Some(4_220);
        }

        let error = stop_exit_target_with_hooks(
            &state,
            ExitStopTarget {
                child: Some(()),
                pid: Some(4_220),
            },
            |_| Err(user_error("relay_stop_failed")),
            |_| Err(user_error("relay_stop_failed")),
        )
        .expect_err("a failed child and PID kill must block exit");
        assert_eq!(error, user_error("relay_stop_failed"));

        let snapshot = state.snapshot();
        assert!(matches!(snapshot.phase, RelayPhase::Error));
        assert_eq!(snapshot.pid, Some(4_220));
        assert_eq!(snapshot.last_error, Some(user_error("relay_stop_failed")));

        let retry_target = take_exit_stop_target(&state)
            .expect("a later Quit should claim the retained PID retry target");
        assert!(retry_target.child.is_none());
        assert_eq!(retry_target.pid, Some(4_220));
        assert!(matches!(state.snapshot().phase, RelayPhase::Stopping));
        stop_exit_target_with_hooks(
            &state,
            ExitStopTarget::<()> {
                child: None,
                pid: retry_target.pid,
            },
            |_| panic!("a retry without a child handle must use its retained PID"),
            |pid| {
                assert_eq!(pid, 4_220);
                Ok(())
            },
        )
        .expect("the retained PID should make a later Quit retryable");
        let recovered = state.snapshot();
        assert!(matches!(recovered.phase, RelayPhase::Stopped));
        assert!(recovered.pid.is_none());
        assert!(recovered.last_error.is_none());
    }

    #[test]
    fn idempotent_start_returns_before_deadlock_timeout() {
        let state = runtime_probe_state();
        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Starting;
            runtime.generation = 7;
        }
        let (result_tx, result_rx) = mpsc::channel();
        thread::spawn(move || {
            let result = reserve_start_generation(&state, false).map(|admission| {
                assert!(matches!(admission, StartAdmission::AlreadyActive));
                assert_eq!(
                    state.inner.runtime.lock().expect("runtime lock").generation,
                    7
                );
                state.snapshot()
            });
            let _ = result_tx.send(result);
        });

        let snapshot = result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("idempotent Start recursively locked the runtime mutex")
            .expect("idempotent Start should succeed");
        assert!(matches!(snapshot.phase, RelayPhase::Starting));
        assert!(snapshot.pid.is_none());
    }

    #[test]
    fn preflight_failure_is_actionable_without_downgrading_an_active_relay() {
        let stopped = runtime_probe_state();
        let generation = match reserve_start_generation(&stopped, false)
            .expect("Start preflight should reserve a generation")
        {
            StartAdmission::Reserved(generation) => generation,
            _ => panic!("a stopped Relay should admit Start preflight"),
        };
        let mut published = Vec::new();
        let result = record_start_preflight_result_with_hook::<()>(
            &stopped,
            generation,
            Err(user_error("relay_credentials_missing")),
            |state| published.push(state.snapshot()),
        );

        assert_eq!(result, Err(user_error("relay_credentials_missing")));
        assert_eq!(published.len(), 1);
        assert!(matches!(published[0].phase, RelayPhase::Error));
        assert_eq!(
            published[0].last_error,
            Some(user_error("relay_credentials_missing"))
        );
        assert_eq!(
            published[0].logs.last().map(|line| line.message.as_str()),
            Some("relayune:relay_credentials_missing")
        );

        let active = runtime_probe_state();
        {
            let mut runtime = active.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Connected;
            runtime.generation = 7;
            runtime.pid = Some(4_227);
        }
        let mut active_publications = 0;
        let result = record_start_preflight_result_with_hook::<()>(
            &active,
            7,
            Err(user_error("credential_access_failed")),
            |_| active_publications += 1,
        );

        assert_eq!(result, Err(user_error("credential_access_failed")));
        assert_eq!(active_publications, 0);
        let snapshot = active.snapshot();
        assert!(matches!(snapshot.phase, RelayPhase::Connected));
        assert_eq!(snapshot.pid, Some(4_227));
        assert_eq!(snapshot.last_error, None);
        assert!(snapshot.logs.is_empty());

        let cancelled = runtime_probe_state();
        let cancelled_generation = match reserve_start_generation(&cancelled, false)
            .expect("Start preflight should reserve a generation")
        {
            StartAdmission::Reserved(generation) => generation,
            _ => panic!("a stopped Relay should admit Start preflight"),
        };
        stop_with_hooks(
            &cancelled,
            |_| {},
            |_| panic!("preflight has no child to stop"),
            |_| panic!("preflight has no PID to stop"),
        )
        .expect("Stop should cancel preflight admission");
        let mut cancelled_publications = 0;
        let result = record_start_preflight_result_with_hook::<()>(
            &cancelled,
            cancelled_generation,
            Err(user_error("credential_access_failed")),
            |_| cancelled_publications += 1,
        );
        assert_eq!(result, Err(user_error("credential_access_failed")));
        assert_eq!(cancelled_publications, 0);
        assert!(matches!(cancelled.snapshot().phase, RelayPhase::Stopped));
        assert_eq!(cancelled.snapshot().last_error, None);
    }

    #[test]
    fn retry_after_process_wait_error_cleans_up_before_reserving_a_new_generation() {
        let state = runtime_probe_state();
        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Error;
            runtime.generation = 11;
            runtime.pid = Some(4_223);
            runtime.last_error = Some(user_error("relay_start_failed"));
        }
        let (result_tx, result_rx) = mpsc::channel();
        thread::spawn(move || {
            let mut published = Vec::new();
            let mut killed = Vec::new();
            let result = reserve_start_with_failed_runtime_recovery(
                &state,
                false,
                |state| published.push(state.snapshot()),
                |_| panic!("a PID-only waiter failure must use PID cleanup"),
                |pid| {
                    killed.push(pid);
                    Ok(())
                },
            );
            let generation = state.inner.runtime.lock().expect("runtime lock").generation;
            let _ = result_tx.send((result, state.snapshot(), generation, published, killed));
        });

        let (result, snapshot, generation, published, killed) = result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("failed-runtime Start recovery deadlocked");
        assert_eq!(
            result.expect("Retry should clean up and reserve a new Start"),
            Some(12)
        );
        assert_eq!(killed, vec![4_223]);
        assert_eq!(published.len(), 2);
        assert!(matches!(published[0].phase, RelayPhase::Stopping));
        assert!(matches!(published[1].phase, RelayPhase::Stopped));
        assert!(matches!(snapshot.phase, RelayPhase::Starting));
        assert_eq!(snapshot.pid, None);
        assert_eq!(snapshot.last_error, None);
        assert_eq!(generation, 12);
    }

    #[test]
    fn process_wait_error_becomes_actionable_without_losing_the_cleanup_pid() {
        let state = runtime_probe_state();
        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Connected;
            runtime.generation = 11;
            runtime.pid = Some(4_223);
        }
        let event_state = state.clone();
        let (published_tx, published_rx) = mpsc::channel();
        let (result_tx, result_rx) = mpsc::channel();
        thread::spawn(move || {
            let changed = mark_process_event_error_with_hook(&event_state, 11, |state| {
                published_tx
                    .send(state.snapshot())
                    .expect("publish process wait failure");
            });
            let _ = result_tx.send(changed);
        });

        assert!(result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("process wait failure publication deadlocked"));
        let failed = published_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("process wait failure was not published");
        assert!(matches!(failed.phase, RelayPhase::Error));
        assert_eq!(failed.pid, Some(4_223));
        assert_eq!(failed.last_error, Some(user_error("relay_start_failed")));
        assert_eq!(
            failed
                .logs
                .last()
                .expect("wait failure must retain a stable diagnostic")
                .message,
            "relayune:relay_start_failed"
        );

        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Stopping;
            runtime.last_error = None;
        }
        assert!(!mark_process_event_error_with_hook(&state, 11, |_| {
            panic!("a waiter error must not overtake the Stop owner")
        }));
        assert!(matches!(state.snapshot().phase, RelayPhase::Stopping));
        assert_eq!(state.snapshot().pid, Some(4_223));
        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Connected;
            runtime.generation = 12;
        }
        assert!(!mark_process_event_error_with_hook(&state, 10, |_| {
            panic!("a stale generation must not publish")
        }));
        assert!(matches!(state.snapshot().phase, RelayPhase::Connected));
    }

    #[test]
    fn process_stream_close_without_terminal_event_becomes_actionable_once() {
        let state = runtime_probe_state();
        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Connected;
            runtime.generation = 13;
            runtime.pid = Some(4_229);
        }
        let event_state = state.clone();
        let (published_tx, published_rx) = mpsc::channel();
        let (result_tx, result_rx) = mpsc::channel();
        thread::spawn(move || {
            let changed = mark_process_event_error_with_hook(&event_state, 13, |state| {
                published_tx
                    .send(state.snapshot())
                    .expect("publish event-stream closure");
            });
            let _ = result_tx.send(changed);
        });

        assert!(result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("event-stream closure publication deadlocked"));
        let failed = published_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("event-stream closure was not published");
        assert!(matches!(failed.phase, RelayPhase::Error));
        assert_eq!(failed.pid, Some(4_229));
        assert_eq!(failed.last_error, Some(user_error("relay_start_failed")));

        assert!(!mark_process_event_error_with_hook(&state, 13, |_| {
            panic!("a closed stream must not republish an existing Error")
        }));
        let retained = state.snapshot();
        assert!(matches!(retained.phase, RelayPhase::Error));
        assert_eq!(retained.pid, Some(4_229));
        assert_eq!(retained.logs.len(), 1);
    }

    #[test]
    fn late_process_progress_cannot_overtake_stop_or_a_new_generation() {
        let state = runtime_probe_state();
        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Stopping;
            runtime.generation = 21;
            runtime.pid = Some(4_224);
        }
        let mut publications = 0;
        assert!(!mark_connected_with_hook(&state, 21, |_| {
            publications += 1;
        }));
        assert!(!mark_reconnecting_with_hook(
            &state,
            21,
            "Relayune Relay reconnecting: temporary network error",
            |_| {
                publications += 1;
            },
        ));
        let stopping = state.snapshot();
        assert!(matches!(stopping.phase, RelayPhase::Stopping));
        assert_eq!(stopping.pid, Some(4_224));
        assert!(stopping.logs.is_empty());
        assert_eq!(publications, 0);

        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Starting;
            runtime.generation = 22;
            runtime.pid = Some(4_225);
        }
        assert!(!mark_connected_with_hook(&state, 21, |_| {
            publications += 1;
        }));
        assert!(!mark_reconnecting_with_hook(
            &state,
            21,
            "Relayune Relay reconnecting: 401 unauthorized",
            |_| {
                publications += 1;
            },
        ));
        let current = state.snapshot();
        assert!(matches!(current.phase, RelayPhase::Starting));
        assert_eq!(current.pid, Some(4_225));
        assert!(current.logs.is_empty());
        assert_eq!(publications, 0);
    }

    #[test]
    fn delivery_diagnostics_never_turn_a_healthy_transport_into_a_disconnect() {
        let state = runtime_probe_state();
        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Connected;
            runtime.generation = 22;
            runtime.pid = Some(4_230);
        }

        assert!(log_delivery_transition(
            &state,
            22,
            LogLevel::Error,
            "relay_sync_degraded",
        ));
        let degraded = state.snapshot();
        assert!(matches!(degraded.phase, RelayPhase::Connected));
        assert_eq!(degraded.last_error, None);
        assert_eq!(
            degraded.logs.last().map(|line| line.message.as_str()),
            Some("relayune:relay_sync_degraded"),
        );

        assert!(log_delivery_transition(
            &state,
            22,
            LogLevel::Info,
            "relay_sync_recovered",
        ));
        let recovered = state.snapshot();
        assert!(matches!(recovered.phase, RelayPhase::Connected));
        assert_eq!(recovered.last_error, None);
        assert_eq!(
            recovered.logs.last().map(|line| line.message.as_str()),
            Some("relayune:relay_sync_recovered"),
        );

        assert!(!log_delivery_transition(
            &state,
            21,
            LogLevel::Error,
            "relay_sync_degraded",
        ));
        assert_eq!(state.snapshot().logs.len(), 2);
    }

    #[test]
    fn admitted_process_progress_logs_and_publishes_one_consistent_snapshot() {
        let state = runtime_probe_state();
        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Starting;
            runtime.generation = 23;
            runtime.pid = Some(4_226);
        }
        let mut published = Vec::new();
        assert!(mark_connected_with_hook(&state, 23, |state| {
            published.push(state.snapshot());
        }));
        assert_eq!(published.len(), 1);
        assert!(matches!(published[0].phase, RelayPhase::Connected));
        assert_eq!(published[0].last_error, None);
        assert_eq!(
            published[0].logs.last().map(|line| line.message.as_str()),
            Some("relayune:relay_connected")
        );

        assert!(mark_reconnecting_with_hook(
            &state,
            23,
            "Relayune Relay reconnecting: temporary network error",
            |state| published.push(state.snapshot()),
        ));
        assert_eq!(published.len(), 2);
        assert!(matches!(published[1].phase, RelayPhase::Starting));
        assert_eq!(
            published[1].last_error,
            Some(user_error("relay_reconnecting"))
        );
        assert_eq!(
            published[1].logs.last().map(|line| line.message.as_str()),
            Some("relayune:relay_reconnecting")
        );

        assert!(mark_reconnecting_with_hook(
            &state,
            23,
            "Relayune Relay reconnecting: 401 unauthorized",
            |state| published.push(state.snapshot()),
        ));
        assert_eq!(published.len(), 3);
        assert!(matches!(published[2].phase, RelayPhase::Error));
        assert_eq!(
            published[2].last_error,
            Some(user_error("relay_unauthorized"))
        );
        assert_eq!(
            published[2].logs.last().map(|line| line.message.as_str()),
            Some("relayune:relay_unauthorized")
        );
    }

    #[test]
    fn start_during_stop_is_rejected_without_overwriting_exit_state() {
        let state = runtime_probe_state();
        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Stopping;
            runtime.pid = Some(4_221);
            runtime.generation = 9;
        }

        assert!(matches!(
            reserve_start_generation(&state, false),
            Err(error) if error == user_error("relay_start_failed")
        ));
        let snapshot = state.snapshot();
        assert!(matches!(snapshot.phase, RelayPhase::Stopping));
        assert_eq!(snapshot.pid, Some(4_221));
        assert_eq!(
            state.inner.runtime.lock().expect("runtime lock").generation,
            9
        );
    }

    #[test]
    fn stop_and_exit_cancel_an_uncommitted_start_before_spawn() {
        for exit in [false, true] {
            let state = runtime_probe_state();
            let generation = match reserve_start_generation(&state, false)
                .expect("Start reservation should be readable")
            {
                StartAdmission::Reserved(generation) => generation,
                _ => panic!("a stopped Relay should reserve a generation"),
            };

            if exit {
                let target = take_exit_stop_target(&state)
                    .expect("Quit should cancel the uncommitted Start");
                assert!(target.child.is_none());
                assert!(target.pid.is_none());
            } else {
                let mut publications = 0;
                stop_with_hooks(
                    &state,
                    |_| publications += 1,
                    |_| panic!("an uncommitted Start has no child to kill"),
                    |_| panic!("an uncommitted Start has no PID to kill"),
                )
                .expect("Stop should cancel the uncommitted Start");
                assert_eq!(
                    publications, 1,
                    "the native and Web surfaces must observe Starting to Stopped"
                );
            }

            let mut commit_calls = 0;
            assert_eq!(
                commit_reserved_start_with_hook(&state, generation, |_| {
                    commit_calls += 1;
                    Ok(())
                }),
                Err(StartCommitError::Cancelled),
            );
            assert_eq!(
                commit_calls, 0,
                "a cancelled generation must never enter the native spawn hook"
            );
            let snapshot = state.snapshot();
            assert!(matches!(snapshot.phase, RelayPhase::Stopped));
            assert!(snapshot.pid.is_none());
            assert_ne!(
                state.inner.runtime.lock().expect("runtime lock").generation,
                generation,
            );
        }
    }

    #[test]
    fn exit_waits_for_start_commit_and_claims_the_spawned_pid() {
        let state = runtime_probe_state();
        let generation = match reserve_start_generation(&state, false)
            .expect("Start reservation should be readable")
        {
            StartAdmission::Reserved(generation) => generation,
            _ => panic!("a stopped Relay should reserve a generation"),
        };
        let commit_state = state.clone();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (commit_tx, commit_rx) = mpsc::channel();
        thread::spawn(move || {
            let result = commit_reserved_start_with_hook(&commit_state, generation, |runtime| {
                entered_tx
                    .send(())
                    .expect("test should observe commit entry");
                release_rx
                    .recv_timeout(Duration::from_secs(1))
                    .expect("test should release the simulated native spawn");
                runtime.pid = Some(4_222);
                Ok(())
            });
            let _ = commit_tx.send(result);
        });
        entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("start commit did not acquire the runtime reservation");

        let exit_state = state.clone();
        let (exit_tx, exit_rx) = mpsc::channel();
        thread::spawn(move || {
            let result = take_exit_stop_target(&exit_state).map(|target| target.pid);
            let _ = exit_tx.send(result);
        });
        assert!(
            exit_rx.recv_timeout(Duration::from_millis(100)).is_err(),
            "Quit must not report success while native spawn is still untracked"
        );

        release_tx
            .send(())
            .expect("test should release the simulated native spawn");
        commit_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("start commit deadlocked")
            .expect("the simulated native spawn should commit");
        assert_eq!(
            exit_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("Quit did not resume after child publication")
                .expect("Quit should claim the published PID"),
            Some(4_222),
        );
        assert!(matches!(state.snapshot().phase, RelayPhase::Stopping));
    }

    fn browser_authorization(id: &str) -> BrowserAuthorization {
        BrowserAuthorization {
            client_version: None,
            id: id.into(),
            name: "Chrome · Mac".into(),
            key_id: format!("sha256:{}", "a".repeat(43)),
            created_at: "2026-07-31T00:00:00.000Z".into(),
            last_seen_at: None,
        }
    }
}
