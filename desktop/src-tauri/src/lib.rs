mod agent_runtime;
mod config;
mod instance;
mod keep_awake;
#[cfg(target_os = "macos")]
mod keep_awake_menu;
#[cfg(target_os = "macos")]
mod macos_tray_menu;
mod model;
mod relay;
mod secrets;
mod state;
mod relay_diagnostics;
mod diagnostic_report;
mod performance_diagnostics;
#[cfg(any(target_os = "macos", test))]
mod workspace_access;

#[cfg(not(target_os = "windows"))]
use std::process::Command;
use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::Duration,
};

#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSAccessibility, NSApplication, NSApplicationActivationPolicy};
#[cfg(target_os = "macos")]
use objc2_foundation::NSString;
#[cfg(target_os = "windows")]
use std::{ffi::OsStr, os::windows::ffi::OsStrExt, ptr};


use model::{
    user_error, AgentRuntimeAvailability, Bootstrap, BrowserAuthorization,
    CompleteBrowserPairingInput, CompleteDesktopLoginInput, CompletePairingInput, DesktopPlatform,
    RelayConfig, RelayPhase, RelayProvider,
    RelaySnapshot, SaveSettingsInput, SecretKind, SecretPresence, StartBrowserPairingInput,
    StartBrowserPairingResponse, UiLanguage,
};
use state::{AppState, TrayMenuItems};
#[cfg(not(target_os = "macos"))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::{
    menu::{Menu, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, ExitRequestApi, Manager, RunEvent, Runtime, State, WindowEvent, Wry,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_dialog::DialogExt;
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

// This synchronous body can read secure storage and refresh NSMenu/AX. Tauri's
// default blocking command wrapper executes inline on the IPC event thread;
// force its async wrapper so it cannot wait on `tray_update` while a background
// publication owns that lock and waits for the native event loop.
#[tauri::command(async)]
fn get_bootstrap(app: AppHandle, state: State<'_, AppState>) -> Result<Bootstrap, String> {
    bootstrap(&app, &state)
}

#[tauri::command]
fn get_relay_snapshot(state: State<'_, AppState>) -> RelaySnapshot {
    state.snapshot()
}

#[tauri::command]
fn validate_config(config: RelayConfig) -> Result<(), String> {
    config::validate(&config)
}

#[tauri::command]
async fn get_agent_availability(
    state: State<'_, AppState>,
) -> Result<Vec<AgentRuntimeAvailability>, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || inspect_tray_agents(&state))
        .await.map_err(|_| user_error("agent_check_failed"))
}

#[tauri::command]
async fn install_agent(
    state: State<'_, AppState>,
    provider: RelayProvider,
) -> Result<AgentRuntimeAvailability, String> {
    let config = state.config();
    tauri::async_runtime::spawn_blocking(move || agent_runtime::install(&config, provider))
        .await
        .map_err(|_| user_error("agent_install_failed"))?
}

#[tauri::command]
fn open_agent_login(provider: RelayProvider) -> Result<(), String> {
    agent_runtime::open_login(provider)
}

#[tauri::command]
async fn start_relay(app: AppHandle, state: State<'_, AppState>) -> Result<RelaySnapshot, String> {
    relay::start(&app, &state).await
}

#[tauri::command(async)]
fn stop_relay(app: AppHandle, state: State<'_, AppState>) -> Result<RelaySnapshot, String> {
    relay::stop(&app, &state)
}

#[tauri::command]
async fn probe_instance(server_url: String) -> Result<instance::InstanceCapabilities, String> {
    instance::probe(&server_url).await
}

#[tauri::command]
async fn switch_instance(app: AppHandle, state: State<'_, AppState>, server_url: String,
    previous_server_url: String, confirmed: bool) -> Result<Bootstrap, String> {
    if !confirmed { return Err(user_error("settings_invalid")); }
    let origin = instance::normalize_origin(&server_url)?;
    let _config_update = state.inner.config_update.lock().await;
    let current = state.config();
    // A stale settings dialog must never change an instance selected elsewhere.
    if current.server_url != previous_server_url { return Err(user_error("settings_invalid")); }
    instance::probe(&origin).await?;
    let _relay_config_change = RelayConfigChangeGuard::begin(&state)?;
    // Invalidates preflight generations as well as a running sidecar.
    relay::stop(&app, &state)?;
    let mut next = current.clone();
    next.server_url = origin;
    next.device_id = config::default_config(&app)?.device_id;
    next.state_path = config::state_path_for_device(&app, &next.device_id)?;
    next.account_email = None;
    next.browser_ids.clear();
    // Destroy old credentials before the origin changes. If cleanup or save
    // fails, the durable config still names the old origin and a retry can find
    // its old stores. A crash after vault cleanup merely requires a new login;
    // no durable state ever associates old secrets with the selected origin.
    secrets::clear_instance_credentials().map_err(|_| user_error("instance_cleanup_failed"))?;
    let _ = reconcile_durable_config_native_presentation(&state, &current, false, || {
        refresh_tray_status_locked(&app, &state)
    });
    let directory = app.path().app_data_dir().map_err(|_| user_error("instance_cleanup_failed"))?;
    instance::remove_instance_files(&directory, &current.device_id, &current.state_path)?;
    config::save(&app, &next)?;
    let _ = reconcile_durable_config_native_presentation(&state, &next, false, || {
        refresh_tray_status_locked(&app, &state)
    });
    Ok(signed_out_bootstrap(&app, &state))
}

#[tauri::command]
async fn logout(app: AppHandle, state: State<'_, AppState>) -> Result<Bootstrap, String> {
    let _config_update = state.inner.config_update.lock().await;
    let current = state.config();
    let old_paired = state.is_paired();
    let device_token = secrets::get(model::SecretKind::DeviceToken, &current.device_id)?;
    // Persist a fresh local identity before the irreversible remote revoke.
    // Even if secure-store cleanup later fails, the next bootstrap cannot
    // rediscover a revoked token/key pair and strand the user on Home.
    let fresh_identity = config::default_config(&app).map_err(|_| user_error("sign_out_failed"))?;
    let mut cleared = current.clone();
    cleared.device_id = fresh_identity.device_id;
    cleared.state_path = fresh_identity.state_path;
    cleared.browser_ids.clear();
    let was_running = state.snapshot().pid.is_some();
    if was_running {
        relay::stop(&app, &state)?;
    }
    if config::save(&app, &cleared).is_err() {
        if was_running {
            let _ = relay::start(&app, &state).await;
        }
        return Err(user_error("sign_out_failed"));
    }
    if relay::revoke_current_device(&app, &state, &device_token)
        .await
        .is_err()
    {
        if config::save(&app, &current).is_ok() {
            let _ =
                reconcile_durable_config_native_presentation(&state, &current, old_paired, || {
                    refresh_tray_status_locked(&app, &state)
                });
            if was_running {
                let _ = relay::start(&app, &state).await;
            }
        } else {
            // The durable file already contains the fresh signed-out identity.
            // Keep memory consistent with what bootstrap will load instead of
            // pretending the old Relay can still be recovered in this process.
            let _ = reconcile_durable_config_native_presentation(&state, &cleared, false, || {
                refresh_tray_status_locked(&app, &state)
            });
        }
        return Err(user_error("sign_out_failed"));
    }
    // The remote revoke and fresh durable identity are now authoritative.
    // Invalidate any bootstrap that loaded the old signed-in config before
    // the network request completed, then commit config + native enrollment
    // presentation under the same tray publication gate. Without this step a
    // late bootstrap could resurrect the revoked identity between the raw
    // state writes and `signed_out_bootstrap` below.
    let _ = reconcile_durable_config_native_presentation(&state, &cleared, false, || {
        refresh_tray_status_locked(&app, &state)
    });
    if secrets::clear_device_credentials(&current.device_id, &current.browser_ids).is_err() {
        // Remote access is already revoked and the durable config points at a
        // new identity, so cleanup failure is diagnostic rather than a reason
        // to return the user to an unusable signed-in surface.
        state.log(model::LogLevel::Error, "relayune:credential_access_failed");
    }
    state.log(model::LogLevel::Info, "relayune:signed_out");
    Ok(signed_out_bootstrap(&app, &state))
}

fn bootstrap_with_known_presence(
    app: &AppHandle,
    state: &AppState,
    secrets: SecretPresence,
) -> Bootstrap {
    // Every caller reaches this helper only after a credential-changing
    // command has durably committed its result. That result is authoritative
    // evidence that the startup secure-store/config recovery condition no
    // longer applies. Clear the recovery gate in the same serialized native
    // transaction that updates menu enabled state, status, tooltip and AX;
    // otherwise a successful pairing or sign-out can return the correct Web
    // surface while the menu bar remains stuck on "Needs attention" forever.
    let _ = reconcile_known_credential_presence(state, &secrets, || {
        refresh_tray_status_locked(app, state)
    });
    let launch_at_login = launch_at_login_or_diagnostic(state, app.autolaunch().is_enabled());
    // A credential-changing command has already committed at this point.
    // Return its known state without another secure-store/config read that
    // could turn success into a stale or contradictory UI error.
    Bootstrap {
        secrets,
        relay: state.snapshot(),
        config: state.config(),
        launch_at_login,
        version: app.package_info().version.to_string(),
        platform: DesktopPlatform::current(),
    }
}

fn lock_tray_update(state: &AppState) -> std::sync::MutexGuard<'_, ()> {
    match state.inner.tray_update.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            // This mutex contains no business data; it only serializes the
            // NSMenu, tooltip, AX and Web snapshot commit. A panic in a native
            // backend call can leave it poisoned even though the process and
            // authoritative AppState remain usable. Recover the unit guard,
            // clear poison for future actions, retain a stable diagnostic and
            // let this transaction reconcile every native surface.
            let guard = poisoned.into_inner();
            state.inner.tray_update.clear_poison();
            state.log(model::LogLevel::Error, user_error("language_failed"));
            guard
        }
    }
}

fn lock_tray_items(state: &AppState) -> std::sync::MutexGuard<'_, Option<TrayMenuItems>> {
    match state.inner.tray_items.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            // Native refreshes hold this handle container while calling the
            // Tauri/AppKit setters. If a backend callback unwinds, both this
            // mutex and the outer tray_update gate are poisoned. The outer
            // gate records the stable diagnostic; recover these still-valid
            // menu handles as well so its next authoritative refresh can
            // actually repair NSMenu, tooltip and AX instead of failing every
            // future transaction at this inner lock.
            let guard = poisoned.into_inner();
            state.inner.tray_items.clear_poison();
            guard
        }
    }
}

fn tray_items_snapshot(state: &AppState) -> Result<TrayMenuItems, String> {
    // Clone the lightweight Tauri handles and release the container lock before
    // calling any backend setter. A backend unwind can then poison only the
    // outer publication gate, never the handle registry needed to self-heal.
    lock_tray_items(state)
        .as_ref()
        .cloned()
        .ok_or_else(|| user_error("language_failed"))
}

fn initialize_tray_presentation_with_hook<T, E>(
    state: &AppState,
    initialize: impl FnOnce() -> Result<T, E>,
) -> Result<T, E> {
    // TrayIcon::build makes the native callback reachable immediately. Keep
    // the publication gate across build, handle registration and initial AX
    // setup so an early deferred menu action cannot refresh a half-initialized
    // presentation or overtake its accessibility labels.
    let _tray_update = lock_tray_update(state);
    initialize()
}

fn reconcile_known_credential_presence(
    state: &AppState,
    secrets: &SecretPresence,
    mut refresh: impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    // This credential result was durably committed by the user action. Make
    // every bootstrap that started before it stale before waiting on native
    // presentation serialization.
    state.invalidate_bootstrap_requests();
    let _tray_update = lock_tray_update(state);

    // Unlike bootstrap recovery, a known-presence result must not copy or
    // recommit config. A concurrent language switch may have durably saved a
    // newer locale while this credential command was in flight; replaying a
    // config snapshot taken before tray_update would roll native memory back
    // to the old language even though disk already contains the new one.
    state.set_paired(secrets.device_token && secrets.e2ee_key);
    state.set_recovery_required(false);
    if let Err(error) = refresh() {
        state.log(model::LogLevel::Error, error);
        return refresh();
    }
    Ok(())
}

fn reconcile_durable_config_native_presentation(
    state: &AppState,
    config: &RelayConfig,
    paired: bool,
    mut refresh: impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    // The durable result is authoritative. A bootstrap may already have loaded
    // the superseded config / credential presence while an async remote action
    // was pending. Stale it before waiting for native presentation serialization
    // so it cannot recommit an abandoned identity, menu enabled state, tooltip
    // or AX label after this transaction completes.
    state.invalidate_bootstrap_requests();
    let _tray_update = lock_tray_update(state);

    state.set_config(config.clone());
    state.set_paired(paired);
    if let Err(error) = refresh() {
        state.log(model::LogLevel::Error, error);
        return refresh();
    }
    Ok(())
}

fn reconcile_pairing_rollback_native_presentation(
    state: &AppState,
    old_config: &RelayConfig,
    old_paired: bool,
    refresh: impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    reconcile_durable_config_native_presentation(state, old_config, old_paired, refresh)
}

fn launch_at_login_or_diagnostic<E>(state: &AppState, result: Result<bool, E>) -> bool {
    match result {
        Ok(enabled) => enabled,
        Err(_) => {
            // LaunchAgent/Run-key introspection is an auxiliary preference, not
            // a prerequisite for login, pairing, diagnostics or Relay use.
            // Keep the primary surface usable and expose only a stable code.
            state.log(model::LogLevel::Error, "relayune:autostart_failed");
            false
        }
    }
}

fn signed_out_bootstrap(app: &AppHandle, state: &AppState) -> Bootstrap {
    bootstrap_with_known_presence(app, state, SecretPresence::default())
}

fn paired_bootstrap(app: &AppHandle, state: &AppState) -> Bootstrap {
    // Pairing commands only reach this point after both new credentials have
    // been written and the Relay process has accepted them. Do not turn that
    // committed success into a false UI failure by probing the secure store a
    // second time while it may be transiently locked.
    bootstrap_with_known_presence(
        app,
        state,
        SecretPresence {
            device_token: true,
            e2ee_key: true,
        },
    )
}

struct RelayConfigChangeGuard {
    state: AppState,
}

impl RelayConfigChangeGuard {
    fn begin(state: &AppState) -> Result<Self, String> {
        if !state.begin_relay_config_change() {
            return Err(user_error("settings_save_failed"));
        }
        Ok(Self {
            state: state.clone(),
        })
    }
}

impl Drop for RelayConfigChangeGuard {
    fn drop(&mut self) {
        self.state.finish_relay_config_change();
    }
}

#[tauri::command]
async fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SaveSettingsInput,
) -> Result<Bootstrap, String> {
    let _config_update = state.inner.config_update.lock().await;
    // Block every unowned Start before inspecting runtime. A background Start
    // can already be in slow config/secure-store preflight with phase=Starting
    // but no PID; pid-only detection used to miss it and later spawn the old
    // Server/workspace after this command committed the new config.
    let _relay_config_change = RelayConfigChangeGuard::begin(&state)?;
    let old_config = state.config();
    // The settings form is a whole-config snapshot captured before this async
    // transaction reaches native code. A language commit may have completed
    // while it waited for the gate, so preserve the authoritative durable
    // language instead of letting a stale form resurrect the previous locale.
    let mut next_config = input.config;
    // Server changes require explicit reset and discovery; never transplant a token.
    if next_config.server_url != old_config.server_url {
        return Err(user_error("settings_invalid"));
    }
    next_config.ui_language = old_config.ui_language.clone();
    config::validate(&next_config)?;
    let old_paired = state.is_paired();
    let restart_relay = relay::runtime_requires_restart_for_config_change(&state)?;

    if restart_relay {
        relay::stop(&app, &state)?;
    }

    if let Err(error) = config::save(&app, &next_config) {
        if restart_relay {
            let _ = relay::start_during_config_change(&app, &state).await;
        }
        return Err(error);
    }
    let device_changed = old_config.device_id != next_config.device_id;
    let next_paired = old_paired && !device_changed;
    // The durable settings result, cached enrollment state and NSMenu/tooltip/AX
    // presentation are one commit. Relay publication uses the same tray gate,
    // so it cannot observe a new device identity with the old paired actions.
    let _ = reconcile_durable_config_native_presentation(&state, &next_config, next_paired, || {
        refresh_tray_status_locked(&app, &state)
    });

    if device_changed {
        state.log(model::LogLevel::Info, "relayune:settings_saved");
    }

    if restart_relay {
        if relay::start_during_config_change(&app, &state)
            .await
            .is_err()
        {
            // A settings save is one user action. If the new settings cannot
            // relaunch Relay, restore both the durable config and the running
            // state instead of leaving Windows autostart with a broken setup.
            if config::save(&app, &old_config).is_ok() {
                // Rollback is also a durable native transaction. Otherwise a
                // concurrent Relay phase publication can expose the rejected
                // config or disable the recovery actions after disk is restored.
                let _ = reconcile_durable_config_native_presentation(
                    &state,
                    &old_config,
                    old_paired,
                    || refresh_tray_status_locked(&app, &state),
                );
                if let Err(error) = relay::start_during_config_change(&app, &state).await {
                    state.log(model::LogLevel::Error, error);
                    relay::publish(&app, &state);
                }
            } else {
                // The durable file still contains the new config. Keep memory
                // aligned with it so the UI can refresh to the truth instead
                // of claiming a rollback that the next launch will undo.
                state.log(model::LogLevel::Error, "relayune:settings_save_failed");
                let _ = refresh_tray_status(&app, &state);
            }
            return Err(user_error("settings_save_failed"));
        }
    }
    let _ = refresh_tray_status(&app, &state);
    bootstrap(&app, &state)
}

#[tauri::command]
async fn clear_secret(
    app: AppHandle,
    state: State<'_, AppState>,
    kind: SecretKind,
) -> Result<Bootstrap, String> {
    let _config_update = state.inner.config_update.lock().await;
    let config = state.config();
    let removes_pairing = matches!(kind, SecretKind::DeviceToken)
        || (matches!(kind, SecretKind::E2eeKey) && config.browser_ids.is_empty());
    secrets::clear(kind, &config.device_id)?;
    let _ = reconcile_cleared_secret_native_presentation(&state, removes_pairing, || {
        refresh_tray_status_locked(&app, &state)
    });
    bootstrap(&app, &state)
}

fn reconcile_cleared_secret_native_presentation(
    state: &AppState,
    removes_pairing: bool,
    mut refresh: impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    // Credential deletion is already irreversible at this point. Invalidate
    // any bootstrap that loaded the old presence before waiting for native
    // serialization, otherwise it can resurrect paired/Web menu state.
    state.invalidate_bootstrap_requests();
    let _tray_update = lock_tray_update(state);
    if removes_pairing {
        state.set_paired(false);
        state.set_recovery_required(false);
    }
    if let Err(error) = refresh() {
        state.log(model::LogLevel::Error, error);
        return refresh();
    }
    Ok(())
}

#[cfg(any(target_os = "windows", test))]
fn windows_autostart_command(executable: &std::path::Path) -> String {
    format!("\"{}\" --background", executable.display())
}

#[cfg(any(target_os = "windows", test))]
fn windows_autostart_state_is_committed(
    requested: bool,
    enabled_after_write: Result<bool, ()>,
    command_is_current: Result<bool, ()>,
) -> bool {
    matches!(enabled_after_write, Ok(actual) if actual == requested)
        && (!requested || matches!(command_is_current, Ok(true)))
}

#[cfg(target_os = "windows")]
fn quote_windows_autostart_command(app: &AppHandle) -> Result<(), String> {
    use winreg::{
        enums::{HKEY_CURRENT_USER, KEY_SET_VALUE},
        RegKey,
    };

    let executable = std::env::current_exe().map_err(|_| user_error("autostart_failed"))?;
    let run_key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
            KEY_SET_VALUE,
        )
        .map_err(|_| user_error("autostart_failed"))?;
    run_key
        .set_value(
            &app.package_info().name,
            &windows_autostart_command(&executable),
        )
        .map_err(|_| user_error("autostart_failed"))
}

#[cfg(target_os = "windows")]
fn windows_autostart_command_is_current(app: &AppHandle) -> Result<bool, String> {
    use winreg::{
        enums::{HKEY_CURRENT_USER, KEY_READ},
        RegKey,
    };

    let executable = std::env::current_exe().map_err(|_| user_error("autostart_failed"))?;
    let run_key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
            KEY_READ,
        )
        .map_err(|_| user_error("autostart_failed"))?;
    let command = run_key
        .get_value::<String, _>(&app.package_info().name)
        .map_err(|_| user_error("autostart_failed"))?;
    Ok(command == windows_autostart_command(&executable))
}

#[tauri::command]
#[cfg(target_os = "windows")]
fn set_launch_at_login(app: AppHandle, enabled: bool) -> Result<bool, String> {
    if enabled {
        if app.autolaunch().enable().is_err() {
            // auto-launch writes HKCU Run before StartupApproved. The latter
            // can fail after the executable command is already active, so the
            // plugin error itself also needs a best-effort transaction rollback.
            let _ = app.autolaunch().disable();
            return Err(user_error("autostart_failed"));
        }
        if quote_windows_autostart_command(&app).is_err() {
            let _ = app.autolaunch().disable();
            return Err(user_error("autostart_failed"));
        }
    } else {
        // Deletion is idempotent from the user's perspective. The plugin can
        // report an error when policy or another process already removed the
        // Run value, so let the authoritative readback below decide whether
        // the requested disabled state was committed.
        let _ = app.autolaunch().disable();
    }

    let enabled_after_write = app.autolaunch().is_enabled().map_err(|_| ());
    let command_is_current = if enabled {
        windows_autostart_command_is_current(&app).map_err(|_| ())
    } else {
        Ok(true)
    };
    if !windows_autostart_state_is_committed(enabled, enabled_after_write, command_is_current) {
        // Enabling is one transaction. A readback failure or mismatch must not
        // leave a Run value active after the settings UI reports failure. When
        // disabling, a second idempotent attempt also narrows the chance that
        // an unreadable value remains active.
        let _ = app.autolaunch().disable();
        return Err(user_error("autostart_failed"));
    }
    Ok(enabled)
}

#[tauri::command]
fn get_keep_awake_status(app: AppHandle) -> Result<keep_awake::Status, String> {
    app.state::<keep_awake::KeepAwake>().status()
}

#[tauri::command]
fn set_prevent_automatic_lock(app: AppHandle, enabled: bool) -> Result<keep_awake::Status, String> {
    let result = app.state::<keep_awake::KeepAwake>().set_prevent_lock(enabled)?;
    #[cfg(target_os = "macos")]
    refresh_keep_awake_menu(&app)?;
    Ok(result)
}

#[tauri::command]
#[cfg(not(target_os = "windows"))]
fn set_launch_at_login(app: AppHandle, enabled: bool) -> Result<bool, String> {
    set_non_windows_launch_at_login_with_hooks(
        enabled,
        || app.autolaunch().enable().map_err(|_| ()),
        || app.autolaunch().disable().map_err(|_| ()),
        || app.autolaunch().is_enabled().map_err(|_| ()),
    )
}

#[cfg(not(target_os = "windows"))]
fn set_non_windows_launch_at_login_with_hooks<EnableError, DisableError, ReadError>(
    enabled: bool,
    mut enable: impl FnMut() -> Result<(), EnableError>,
    mut disable: impl FnMut() -> Result<(), DisableError>,
    mut is_enabled: impl FnMut() -> Result<bool, ReadError>,
) -> Result<bool, String> {
    if enabled {
        if enable().is_err() {
            // LaunchAgent creation can fail after writing part of its state.
            // Never report failure while leaving a surprise background launch.
            let _ = disable();
            return Err(user_error("autostart_failed"));
        }
    } else {
        // Removal is idempotent: a missing LaunchAgent can make the plugin
        // return an error even though the requested state is already true.
        let _ = disable();
    }

    if matches!(is_enabled(), Ok(actual) if actual == enabled) {
        return Ok(enabled);
    }

    // A mismatched or unreadable readback is not a committed preference.
    // Fail closed to disabled and retry removal once before surfacing the
    // stable error, matching the transactional Windows behavior.
    let _ = disable();
    Err(user_error("autostart_failed"))
}

#[tauri::command]
async fn select_workspace(
    app: AppHandle,
    current: String,
    language: String,
) -> Result<Option<String>, String> {
    let language =
        UiLanguage::from_language_code(&language).ok_or_else(|| user_error("language_failed"))?;
    let title = TrayCopy::for_language(language).workspace_picker;
    let mut picker = app.dialog().file().set_title(title);
    if !current.is_empty() {
        picker = picker.set_directory(current);
    }
    picker
        .blocking_pick_folder()
        .map(|path| {
            path.into_path()
                .map(|value| value.to_string_lossy().into_owned())
                .map_err(|_| user_error("workspace_picker_failed"))
        })
        .transpose()
}

#[tauri::command]
fn open_relay_web(state: State<'_, AppState>) -> Result<(), String> {
    open_relay_web_for_state(&state)
}

fn open_relay_web_for_state(state: &AppState) -> Result<(), String> {
    let config = state.config();
    config::validate(&config)?;
    open_external_url(&config.server_url).map_err(|_| user_error("open_web_failed"))
}

fn public_page_destination_url(
    server_url: &str,
    destination: &str,
    language: &str,
) -> Result<String, String> {
    let base = server_url.trim_end_matches('/');
    let locale_path = match language {
        "zh-CN" => "zh",
        "en" | "hi" | "es" | "ar" | "fr" | "bn" | "pt" | "id" | "ur" => language,
        _ => return Err(user_error("open_web_failed")),
    };
    match destination {
        "terms" => Ok(format!("{base}/{locale_path}/legal/terms/")),
        "privacy" => Ok(format!("{base}/{locale_path}/legal/privacy/")),
        "changelog" => Ok(format!("{base}/{locale_path}/changelog/")),
        _ => Err(user_error("open_web_failed")),
    }
}

#[tauri::command]
async fn get_exit_diagnostic_report(app: AppHandle) -> Result<diagnostic_report::Report, String> {
    tauri::async_runtime::spawn_blocking(move || diagnostic_report::collect(&app))
        .await.map_err(|_| "relayune:diagnostics_failed".to_string())?
}

#[tauri::command]
async fn feedback_request(
    app: AppHandle,
    state: State<'_, AppState>,
    action: String,
    submission: Option<String>,
) -> Result<serde_json::Value, String> {
    let result = relay::feedback_request(&app, &state, &action, submission).await;
    if action == "info" {
        let mut info = result.unwrap_or_else(|_| serde_json::json!({ "model": null, "system": null }));
        info["app_version"] = serde_json::Value::String(app.package_info().version.to_string());
        info["email"] = serde_json::to_value(state.config().account_email.filter(|value| config::valid_account_email(value))).unwrap_or(serde_json::Value::Null);
        return Ok(info);
    }
    result
}

#[tauri::command]
fn open_public_page(
    state: State<'_, AppState>,
    destination: String,
    language: String,
) -> Result<(), String> {
    let config = state.config();
    config::validate(&config)?;
    let url = public_page_destination_url(&config.server_url, &destination, &language)?;
    open_external_url(&url).map_err(|_| user_error("open_web_failed"))
}

#[tauri::command]
fn open_pairing_page(state: State<'_, AppState>, pairing_id: String) -> Result<(), String> {
    if !valid_pairing_id(&pairing_id) {
        return Err(user_error("pairing_failed"));
    }
    let config = state.config();
    config::validate(&config)?;
    let url = format!(
        "{}/?pair={pairing_id}",
        config.server_url.trim_end_matches('/')
    );
    open_external_url(&url).map_err(|_| user_error("open_web_failed"))
}

#[tauri::command]
fn open_desktop_login_page(state: State<'_, AppState>, request_id: String) -> Result<(), String> {
    if !valid_desktop_login_id(&request_id) {
        return Err(user_error("sign_in_failed"));
    }
    let config = state.config();
    config::validate(&config)?;
    let url = format!(
        "{}/?desktop_login={request_id}",
        config.server_url.trim_end_matches('/')
    );
    open_external_url(&url).map_err(|_| user_error("open_web_failed"))
}

#[cfg(target_os = "macos")]
fn open_external_url(url: &str) -> std::io::Result<()> {
    let status = Command::new("/usr/bin/open").arg(url).status()?;
    if status.success() {
        Ok(())
    } else {
        Err(std::io::Error::other("macOS could not open URL"))
    }
}

#[cfg(target_os = "windows")]
fn open_external_url(url: &str) -> std::io::Result<()> {
    let url = OsStr::new(url)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        ShellExecuteW(
            ptr::null_mut(),
            ptr::null(),
            url.as_ptr(),
            ptr::null(),
            ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecuteW uses values <= 32 as stable error codes. Only report
    // success after Windows accepts the URL for its registered browser.
    if result as usize <= 32 {
        Err(std::io::Error::other(format!(
            "Windows ShellExecuteW failed with code {}",
            result as usize
        )))
    } else {
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn open_external_url(url: &str) -> std::io::Result<()> {
    Command::new("xdg-open").arg(url).spawn().map(|_| ())
}

#[tauri::command]
async fn complete_desktop_login(
    app: AppHandle,
    state: State<'_, AppState>,
    input: CompleteDesktopLoginInput,
) -> Result<Bootstrap, String> {
    let _config_update = state.inner.config_update.lock().await;
    if !valid_device_id(&input.device_id)
        || !valid_base64url_secret(&input.device_token)
        || !config::valid_account_label(&input.account_email)
    {
        return Err(user_error("sign_in_failed"));
    }
    let old_config = state.config();
    if input.server_url != old_config.server_url || input.expected_device_id != old_config.device_id { return Err(user_error("sign_in_failed")); }
    let old_presence =
        secrets::presence_for_browsers(&old_config.device_id, &old_config.browser_ids)?;
    if old_presence.device_token || input.device_id == old_config.device_id {
        return Err(abandon_completed_initial_pairing(
            &app,
            &state,
            &input.device_token,
            user_error("sign_in_failed"),
        )
        .await);
    }
    let mut next_config = old_config.clone();
    next_config.device_id = input.device_id.clone();
    next_config.account_email = Some(input.account_email.trim().to_owned());
    next_config.state_path = match config::state_path_for_device(&app, &input.device_id) {
        Ok(path) => path,
        Err(_) => {
            return Err(abandon_completed_initial_pairing(
                &app,
                &state,
                &input.device_token,
                user_error("sign_in_failed"),
            )
            .await)
        }
    };
    next_config.browser_ids.clear();
    if let Err(error) = secrets::set(
        SecretKind::DeviceToken,
        &input.device_id,
        &input.device_token,
    ) {
        return Err(
            abandon_completed_initial_pairing(&app, &state, &input.device_token, error).await,
        );
    }
    if config::save(&app, &next_config).is_err() {
        let _ = secrets::clear(SecretKind::DeviceToken, &input.device_id);
        return Err(abandon_completed_initial_pairing(
            &app,
            &state,
            &input.device_token,
            user_error("sign_in_failed"),
        )
        .await);
    }
    let _ = reconcile_durable_config_native_presentation(&state, &next_config, false, || {
        refresh_tray_status_locked(&app, &state)
    });
    if old_presence.e2ee_key
        && secrets::clear_device_credentials(&old_config.device_id, &old_config.browser_ids)
            .is_err()
    {
        state.log(model::LogLevel::Error, "relayune:credential_access_failed");
    }
    state.log(model::LogLevel::Info, "relayune:desktop_login_completed");
    Ok(bootstrap_with_known_presence(
        &app,
        &state,
        SecretPresence {
            device_token: true,
            e2ee_key: false,
        },
    ))
}

#[tauri::command]
async fn abandon_desktop_login(
    app: AppHandle,
    state: State<'_, AppState>,
    device_token: String,
    server_url: String,
) -> Result<(), String> {
    let _config_update = state.inner.config_update.lock().await;
    if server_url != state.config().server_url { return Ok(()); }
    if !valid_base64url_secret(&device_token) {
        return Err(user_error("sign_in_failed"));
    }
    // This is a best-effort rollback paired with the Server login-document
    // cancellation. A 401 is expected when approval never created a device;
    // the caller only needs assurance that no usable local credential remains.
    let _ = relay::revoke_current_device(&app, &state, &device_token).await;
    Ok(())
}

#[tauri::command]
async fn complete_pairing(
    app: AppHandle,
    state: State<'_, AppState>,
    input: CompletePairingInput,
) -> Result<Bootstrap, String> {
    let _config_update = state.inner.config_update.lock().await;
    if input.server_url != state.config().server_url || input.expected_device_id != state.config().device_id {
        return Err(user_error("pairing_failed"));
    }

    if !valid_base64url_secret(&input.device_token) {
        return Err(user_error("pairing_failed"));
    }
    if !valid_device_id(&input.device_id)
        || !valid_browser_id(&input.browser_id)
        || !valid_base64url_secret(&input.e2ee_key)
    {
        return Err(abandon_completed_initial_pairing(
            &app,
            &state,
            &input.device_token,
            user_error("pairing_failed"),
        )
        .await);
    }

    let old_config = state.config();
    let old_paired = state.is_paired();
    if input.device_id == old_config.device_id {
        return Err(abandon_completed_initial_pairing(
            &app,
            &state,
            &input.device_token,
            user_error("pairing_failed"),
        )
        .await);
    }
    let old_presence =
        match secrets::presence_for_browsers(&old_config.device_id, &old_config.browser_ids) {
            Ok(presence) => presence,
            Err(error) => {
                return Err(abandon_completed_initial_pairing(
                    &app,
                    &state,
                    &input.device_token,
                    error,
                )
                .await)
            }
        };
    let old_device_token = if old_presence.device_token {
        match secrets::get(SecretKind::DeviceToken, &old_config.device_id) {
            Ok(token) => Some(token),
            Err(error) => {
                return Err(abandon_completed_initial_pairing(
                    &app,
                    &state,
                    &input.device_token,
                    error,
                )
                .await)
            }
        }
    } else {
        None
    };
    let replacing_connected_device = old_device_token.is_some() && old_presence.e2ee_key;
    // Resolve every fallible path calculation before interrupting the usable
    // old Relay. A workspace/config filesystem error must not turn a failed
    // pairing attempt into an unrelated outage.
    let mut next_config = old_config.clone();
    next_config.device_id = input.device_id.clone();
    next_config.state_path = match config::state_path_for_device(&app, &input.device_id) {
        Ok(path) => path,
        Err(error) => {
            return Err(
                abandon_completed_initial_pairing(&app, &state, &input.device_token, error).await,
            )
        }
    };
    next_config.browser_ids = vec![input.browser_id.clone()];
    let was_running = state.snapshot().pid.is_some();
    if was_running {
        if let Err(error) = relay::stop(&app, &state) {
            return Err(abandon_completed_initial_pairing(
                &app,
                &state,
                &input.device_token,
                error,
            )
            .await);
        }
    }

    if let Err(error) =
        secrets::set_browser_key(&input.device_id, &input.browser_id, &input.e2ee_key)
    {
        let error =
            abandon_completed_initial_pairing(&app, &state, &input.device_token, error).await;
        if was_running {
            if let Err(restart_error) = relay::start(&app, &state).await {
                state.log(model::LogLevel::Error, restart_error);
                return Err(user_error("pairing_failed"));
            }
        }
        return Err(error);
    }
    if let Err(error) = secrets::set(
        SecretKind::DeviceToken,
        &input.device_id,
        &input.device_token,
    ) {
        let _ = secrets::clear_browser_key(&input.device_id, &input.browser_id);
        let error =
            abandon_completed_initial_pairing(&app, &state, &input.device_token, error).await;
        if was_running {
            if let Err(restart_error) = relay::start(&app, &state).await {
                state.log(model::LogLevel::Error, restart_error);
                return Err(user_error("pairing_failed"));
            }
        }
        return Err(error);
    }
    if let Err(error) = config::save(&app, &next_config) {
        if secrets::clear_device_credentials(
            &input.device_id,
            std::slice::from_ref(&input.browser_id),
        )
        .is_err()
        {
            state.log(model::LogLevel::Error, "relayune:credential_access_failed");
        }
        let error =
            abandon_completed_initial_pairing(&app, &state, &input.device_token, error).await;
        if was_running {
            if let Err(restart_error) = relay::start(&app, &state).await {
                state.log(model::LogLevel::Error, restart_error);
                return Err(user_error("pairing_failed"));
            }
        }
        return Err(error);
    }
    // The new credentials and config are already durable. Commit them through
    // the same bootstrap-generation and native-presentation gate as rollback:
    // a bootstrap that loaded the old unpaired identity while Web completed
    // PAKE must not overwrite the new config before Relay starts.
    let _ = reconcile_durable_config_native_presentation(&state, &next_config, true, || {
        refresh_tray_status_locked(&app, &state)
    });
    state.log(model::LogLevel::Info, "relayune:pairing_completed");
    if let Err(error) = relay::start(&app, &state).await {
        let rollback = rollback_pairing(
            &app,
            &state,
            &old_config,
            &input.device_id,
            &input.browser_id,
            &input.device_token,
            was_running,
            old_paired,
        )
        .await;
        return Err(pairing_switch_error(error, rollback));
    }
    // First pairing should hand the user to the connected home surface as soon
    // as the Relay process is accepted; network recovery is already visible
    // and actionable there. Only a true device replacement must prove the new
    // Relay online before revoking a still-usable old device.
    if replacing_connected_device {
        if let Err(error) = wait_for_relay_connected(&state).await {
            let _ = relay::stop(&app, &state);
            let rollback = rollback_pairing(
                &app,
                &state,
                &old_config,
                &input.device_id,
                &input.browser_id,
                &input.device_token,
                was_running,
                old_paired,
            )
            .await;
            return Err(pairing_switch_error(error, rollback));
        }
    }
    if let Some(old_token) = old_device_token {
        match relay::revoke_current_device(&app, &state, &old_token).await {
            Ok(()) => {
                if secrets::clear_device_credentials(&old_config.device_id, &old_config.browser_ids)
                    .is_err()
                {
                    state.log(model::LogLevel::Error, "relayune:credential_access_failed");
                }
            }
            Err(_) => state.log(model::LogLevel::Error, "relayune:sign_out_failed"),
        }
    } else if old_presence.device_token || old_presence.e2ee_key {
        // A token-only or key-only record is not a usable signed-in device.
        // Once the replacement is stored, remove that unreachable partial
        // credential set so future bootstrap checks cannot oscillate.
        if secrets::clear_device_credentials(&old_config.device_id, &old_config.browser_ids)
            .is_err()
        {
            state.log(model::LogLevel::Error, "relayune:credential_access_failed");
        }
    }
    Ok(paired_bootstrap(&app, &state))
}

async fn abandon_completed_initial_pairing(
    app: &AppHandle,
    state: &AppState,
    new_device_token: &str,
    error: String,
) -> String {
    // The Web completion endpoint has already created this device. If local
    // persistence cannot adopt it, revoke the otherwise unreachable bearer so
    // retrying starts from one clear device rather than accumulating ghosts.
    if relay::revoke_current_device(app, state, new_device_token)
        .await
        .is_err()
    {
        state.log(model::LogLevel::Error, "relayune:sign_out_failed");
    }
    error
}

#[tauri::command]
async fn start_browser_pairing(
    app: AppHandle,
    state: State<'_, AppState>,
    input: StartBrowserPairingInput,
) -> Result<StartBrowserPairingResponse, String> {
    let _config_update = state.inner.config_update.lock().await;
    if input.server_url != state.config().server_url || input.expected_device_id != state.config().device_id {
        return Err(user_error("pairing_failed"));
    }

    eprintln!("relayune:browser_pairing_command_entered");
    if !valid_pairing_id(&input.pairing_id) {
        eprintln!("relayune:browser_pairing_command_pairing_id_invalid");
        return Err(user_error("pairing_failed"));
    }
    if input.protocol != "SPAKE2-P256-SHA256-HKDF-HMAC" {
        eprintln!("relayune:browser_pairing_command_protocol_invalid");
        return Err(user_error("pairing_failed"));
    }
    if !valid_pairing_share(&input.initiator_share) {
        eprintln!("relayune:browser_pairing_command_share_invalid");
        return Err(user_error("pairing_failed"));
    }
    eprintln!("relayune:browser_pairing_command_input_valid");
    relay::start_browser_pairing(
        &app,
        &state,
        &input.pairing_id,
        &input.protocol,
        &input.initiator_share,
    )
    .await
}

#[tauri::command]
async fn cancel_browser_pairing(
    app: AppHandle,
    state: State<'_, AppState>,
    pairing_id: String,
    server_url: String,
) -> Result<(), String> {
    let _config_update = state.inner.config_update.lock().await;
    if state.config().server_url != server_url { return Ok(()); }
    if !valid_pairing_id(&pairing_id) {
        return Err(user_error("browser_access_failed"));
    }
    relay::cancel_browser_pairing(&app, &state, &pairing_id).await
}

#[tauri::command]
async fn list_browser_authorizations(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<BrowserAuthorization>, String> {
    relay::list_browser_authorizations(&app, &state).await
}


#[tauri::command]
async fn revoke_browser_authorization(
    app: AppHandle,
    state: State<'_, AppState>,
    browser_id: String,
) -> Result<Bootstrap, String> {
    let _config_update = state.inner.config_update.lock().await;
    if !valid_browser_id(&browser_id) {
        return Err(user_error("browser_access_failed"));
    }
    let old_config = state.config();
    let old_paired = state.is_paired();
    let uses_browser_key = old_config.browser_ids.contains(&browser_id);
    let was_running = state.snapshot().pid.is_some();
    if was_running {
        relay::stop(&app, &state)?;
    }
    let mut next_config = old_config.clone();
    next_config.browser_ids.retain(|value| value != &browser_id);
    if let Err(error) = config::save(&app, &next_config) {
        if was_running {
            let _ = relay::start(&app, &state).await;
        }
        return Err(error);
    }
    if let Err(error) = relay::revoke_browser_authorization(&app, &state, &browser_id).await {
        if config::save(&app, &old_config).is_ok() {
            let _ = reconcile_durable_config_native_presentation(
                &state,
                &old_config,
                old_paired,
                || refresh_tray_status_locked(&app, &state),
            );
            if was_running {
                if let Err(restart_error) = relay::start(&app, &state).await {
                    state.log(model::LogLevel::Error, restart_error);
                    relay::publish(&app, &state);
                }
            }
        } else {
            // The durable file still contains next_config. Preserve that fact
            // in memory; keeping the old browser key is safer than deleting a
            // key whose remote authorization could not be revoked.
            state.log(model::LogLevel::Error, "relayune:settings_save_failed");
            let remains_paired = !next_config.browser_ids.is_empty();
            let _ = reconcile_durable_config_native_presentation(
                &state,
                &next_config,
                remains_paired,
                || refresh_tray_status_locked(&app, &state),
            );
            if was_running && remains_paired {
                if let Err(restart_error) = relay::start(&app, &state).await {
                    state.log(model::LogLevel::Error, restart_error);
                    relay::publish(&app, &state);
                }
            }
        }
        return Err(error);
    }
    if secrets::clear_browser_key(&old_config.device_id, &browser_id).is_err() {
        state.log(model::LogLevel::Error, "relayune:credential_access_failed");
    }
    if !uses_browser_key {
        if secrets::clear(SecretKind::E2eeKey, &old_config.device_id).is_err() {
            state.log(model::LogLevel::Error, "relayune:credential_access_failed");
        }
    }
    let remains_paired = !next_config.browser_ids.is_empty();
    let _ =
        reconcile_durable_config_native_presentation(&state, &next_config, remains_paired, || {
            refresh_tray_status_locked(&app, &state)
        });
    if was_running && remains_paired {
        if let Err(error) = relay::start(&app, &state).await {
            state.log(model::LogLevel::Error, error);
            relay::publish(&app, &state);
        }
    }
    // The remote browser revoke cannot be retried after success: a second
    // request would report browser_not_found. Return the state we just
    // committed instead of probing the encrypted vault again and
    // leaving the confirmation dialog stuck on a false failure.
    Ok(bootstrap_with_known_presence(
        &app,
        &state,
        SecretPresence {
            device_token: true,
            e2ee_key: remains_paired,
        },
    ))
}

#[tauri::command]
async fn complete_browser_pairing(
    app: AppHandle,
    state: State<'_, AppState>,
    input: CompleteBrowserPairingInput,
) -> Result<Bootstrap, String> {
    eprintln!("relayune:browser_pairing_local_complete_entered");
    let _config_update = state.inner.config_update.lock().await;
    if input.server_url != state.config().server_url || input.expected_device_id != state.config().device_id {
        return Err(user_error("pairing_failed"));
    }

    if !valid_pairing_id(&input.pairing_id) {
        eprintln!("relayune:browser_pairing_local_complete_pairing_id_invalid");
        return Err(user_error("pairing_failed"));
    }
    if !valid_browser_id(&input.browser_id) {
        eprintln!("relayune:browser_pairing_local_complete_browser_id_invalid");
        return Err(user_error("pairing_failed"));
    }
    if !valid_base64url_secret(&input.e2ee_key) {
        eprintln!("relayune:browser_pairing_local_complete_content_key_invalid");
        return Err(user_error("pairing_failed"));
    }
    if !valid_base64url_secret(&input.desktop_confirm) {
        eprintln!("relayune:browser_pairing_local_complete_confirm_invalid");
        return Err(user_error("pairing_failed"));
    }
    eprintln!("relayune:browser_pairing_local_complete_input_valid");
    let old_config = state.config();
    let old_paired = state.is_paired();
    if old_config.browser_ids.contains(&input.browser_id) {
        eprintln!("relayune:browser_pairing_local_complete_duplicate_browser");
        return Err(user_error("pairing_failed"));
    }
    let was_running = state.snapshot().pid.is_some();
    if let Err(error) =
        secrets::set_browser_key(&old_config.device_id, &input.browser_id, &input.e2ee_key)
    {
        eprintln!("relayune:browser_pairing_local_complete_vault_write_failed");
        return Err(error);
    }
    eprintln!("relayune:browser_pairing_local_complete_vault_written");
    let mut next_config = old_config.clone();
    next_config.browser_ids.push(input.browser_id.clone());
    if let Err(error) = config::save(&app, &next_config) {
        eprintln!("relayune:browser_pairing_local_complete_config_save_failed");
        let _ = secrets::clear_browser_key(&old_config.device_id, &input.browser_id);
        return Err(error);
    }
    eprintln!("relayune:browser_pairing_local_complete_config_saved");
    // Additional-browser authorization changes the durable browser list before
    // the remote confirmation. Invalidate any bootstrap that loaded the older
    // list and atomically publish the new native enrollment state; a failed
    // remote confirmation will use the symmetric rollback transaction below.
    let _ = reconcile_durable_config_native_presentation(&state, &next_config, true, || {
        refresh_tray_status_locked(&app, &state)
    });
    if was_running {
        if let Err(error) = relay::update_browser_key(&state, &input.browser_id, Some(&input.e2ee_key)).await {
            let _ = relay::update_browser_key(&state, &input.browser_id, None).await;
            rollback_browser_pairing(&app, &state, &old_config, &input.browser_id, false, old_paired).await?;
            return Err(error);
        }
    }
    if let Err(error) = relay::complete_browser_pairing(
        &app,
        &state,
        &input.pairing_id,
        &input.browser_id,
        &input.desktop_confirm,
    )
    .await
    {
        eprintln!("relayune:browser_pairing_local_complete_remote_failed");
        if was_running {
            let _ = relay::update_browser_key(&state, &input.browser_id, None).await;
        }
        if let Err(rollback_error) = rollback_browser_pairing(
            &app,
            &state,
            &old_config,
            &input.browser_id,
            false,
            old_paired,
        )
        .await
        {
            eprintln!("relayune:browser_pairing_local_complete_remote_rollback_failed");
            state.log(model::LogLevel::Error, rollback_error);
            return Err(user_error("pairing_failed"));
        }
        eprintln!("relayune:browser_pairing_local_complete_remote_rolled_back");
        return Err(error);
    }
    eprintln!("relayune:browser_pairing_local_complete_remote_confirmed");
    if !was_running {
        if let Err(error) = relay::start(&app, &state).await {
            eprintln!("relayune:browser_pairing_local_complete_relay_restart_failed");
            let _ = relay::revoke_browser_authorization(&app, &state, &input.browser_id).await;
            if let Err(rollback_error) = rollback_browser_pairing(
                &app,
                &state,
                &old_config,
                &input.browser_id,
                false,
                old_paired,
            )
            .await
            {
                eprintln!("relayune:browser_pairing_local_complete_restart_rollback_failed");
                state.log(model::LogLevel::Error, rollback_error);
            }
            let _ = error;
            return Err(user_error("pairing_failed"));
        }
        eprintln!("relayune:browser_pairing_local_complete_relay_restarted");
        if let Err(error) = wait_for_relay_connected(&state).await {
            eprintln!("relayune:browser_pairing_local_complete_reconnect_failed");
            let _ = relay::stop(&app, &state);
            let _ = relay::revoke_browser_authorization(&app, &state, &input.browser_id).await;
            if let Err(rollback_error) = rollback_browser_pairing(
                &app,
                &state,
                &old_config,
                &input.browser_id,
                false,
                old_paired,
            )
            .await
            {
                eprintln!("relayune:browser_pairing_local_complete_reconnect_rollback_failed");
                state.log(model::LogLevel::Error, rollback_error);
            }
            let _ = error;
            return Err(user_error("pairing_failed"));
        }
    }
    eprintln!("relayune:browser_pairing_local_complete_completed");
    Ok(paired_bootstrap(&app, &state))
}

async fn rollback_browser_pairing(
    app: &AppHandle,
    state: &AppState,
    old_config: &RelayConfig,
    browser_id: &str,
    restart_old_relay: bool,
    old_paired: bool,
) -> Result<(), String> {
    // The durable write is the rollback commit point. If it fails, keep the
    // current in-memory config and new key aligned with the file that the next
    // launch will load instead of manufacturing an old state that no longer
    // exists on disk.
    config::save(app, old_config).map_err(|_| user_error("pairing_failed"))?;
    let presentation_result =
        reconcile_pairing_rollback_native_presentation(state, old_config, old_paired, || {
            refresh_tray_status_locked(app, state)
        });
    if secrets::clear_browser_key(&old_config.device_id, browser_id).is_err() {
        state.log(model::LogLevel::Error, "relayune:credential_access_failed");
    }
    if restart_old_relay {
        relay::start(app, state)
            .await
            .map_err(|_| user_error("pairing_failed"))?;
    }
    presentation_result
}

async fn wait_for_relay_connected(state: &AppState) -> Result<(), String> {
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        for _ in 0..300 {
            let snapshot = state.snapshot();
            match snapshot.phase {
                RelayPhase::Connected => return Ok(()),
                RelayPhase::Error => {
                    return Err(snapshot
                        .last_error
                        .unwrap_or_else(|| user_error("relay_start_failed")))
                }
                _ => thread::sleep(Duration::from_millis(100)),
            }
        }
        Err(user_error("relay_start_failed"))
    })
    .await
    .map_err(|_| user_error("relay_start_failed"))?
}

async fn rollback_pairing(
    app: &AppHandle,
    state: &AppState,
    old_config: &RelayConfig,
    new_device_id: &str,
    new_browser_id: &str,
    new_device_token: &str,
    restart_old_relay: bool,
    old_paired: bool,
) -> Result<(), String> {
    config::save(app, old_config).map_err(|_| user_error("pairing_failed"))?;
    let presentation_result =
        reconcile_pairing_rollback_native_presentation(state, old_config, old_paired, || {
            refresh_tray_status_locked(app, state)
        });
    if relay::revoke_current_device(app, state, new_device_token)
        .await
        .is_err()
    {
        state.log(model::LogLevel::Error, "relayune:sign_out_failed");
    }
    if let Err(_error) =
        secrets::clear_device_credentials(new_device_id, &[new_browser_id.to_string()])
    {
        state.log(model::LogLevel::Error, "relayune:credential_access_failed");
    }
    if restart_old_relay {
        relay::start(app, state)
            .await
            .map_err(|_| user_error("pairing_failed"))?;
    }
    presentation_result
}

fn pairing_switch_error(_error: String, _rollback: Result<(), String>) -> String {
    user_error("pairing_failed")
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), String> {
    show_window(&app)
}

#[tauri::command]
async fn set_ui_language(
    app: AppHandle,
    state: State<'_, AppState>,
    language: String,
) -> Result<(), String> {
    let _config_update = state.inner.config_update.lock().await;
    let language =
        UiLanguage::from_language_code(&language).ok_or_else(|| user_error("language_failed"))?;
    set_ui_language_with_refresh_and_save(
        &state,
        language,
        |language| refresh_tray_language_locked(&app, &state, language),
        |config| config::save(&app, config),
    )
}

fn set_ui_language_with_refresh_and_save(
    state: &AppState,
    language: UiLanguage,
    mut refresh: impl FnMut(UiLanguage) -> Result<(), String>,
    mut save: impl FnMut(&RelayConfig) -> Result<(), String>,
) -> Result<(), String> {
    // Invalidate before waiting for `tray_update`: a bootstrap may already
    // have loaded the old config and be blocked on that lock. This applies to
    // same-value requests too because they are native reconciliation writes.
    state.invalidate_bootstrap_requests();
    let _tray_update = lock_tray_update(state);
    let previous = state.ui_language();
    let previous_config = state.config();
    if previous == language
        && previous_config.ui_language.as_deref() == Some(language.language_code())
    {
        // A failed native refresh can partially change NSMenu, tooltip, or AX
        // properties, and its best-effort rollback may fail too. Reapplying an
        // unchanged persisted language is therefore a reconciliation request,
        // not a no-op that may report success over mixed-language native UI.
        return refresh(language).map_err(|_| user_error("language_failed"));
    }
    state.set_ui_language(language);
    if refresh(language).is_err() {
        state.set_ui_language(previous);
        let _ = refresh(previous);
        return Err(user_error("language_failed"));
    }
    let mut next_config = previous_config.clone();
    next_config.ui_language = Some(language.language_code().into());
    if save(&next_config).is_err() {
        state.set_ui_language(previous);
        let _ = refresh(previous);
        return Err(user_error("language_failed"));
    }
    // A bootstrap can begin while this transaction is waiting on AppKit and
    // read the old durable locale before `save` completes. Invalidate once
    // more after the durable commit; any later generation can only read the
    // newly saved locale and is therefore safe to reconcile.
    state.invalidate_bootstrap_requests();
    state.set_config(next_config);
    Ok(())
}

#[tauri::command(async)]
fn set_update_available(
    app: AppHandle,
    state: State<'_, AppState>,
    available: bool,
) -> Result<(), String> {
    set_update_available_with_refresh(&state, available, || {
        refresh_tray_status_locked(&app, &state)
    })
}

fn set_update_available_with_refresh(
    state: &AppState,
    available: bool,
    mut refresh: impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    // The availability flag and every native presentation that consumes it
    // form one transaction. Otherwise a concurrent clear can observe the old
    // value and return before an in-flight discovery publishes `true`.
    let _tray_update = lock_tray_update(state);
    let previous = state.update_available();
    if previous == available {
        // A previous refresh can fail after partially updating the native
        // menu, tooltip, or accessibility properties, and its best-effort
        // rollback can fail as well. Treat an idempotent request as a
        // reconciliation opportunity instead of reporting success while the
        // visible native presentation remains stale.
        return refresh().map_err(|_| user_error("update_failed"));
    }
    state.set_update_available(available);
    if refresh().is_err() {
        state.set_update_available(previous);
        let _ = refresh();
        return Err(user_error("update_failed"));
    }
    Ok(())
}

fn valid_pairing_id(value: &str) -> bool {
    value.len() == 48
        && value.starts_with("pair_")
        && value[5..]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn valid_desktop_login_id(value: &str) -> bool {
    value.len() == 50
        && value.starts_with("dlogin_")
        && value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

#[cfg(target_os = "macos")]
fn is_desktop_login_return_url(value: &url::Url) -> bool {
    if !matches!(value.scheme(), "relayune" | "agent-relay")
        || value.host_str() != Some("desktop-login-complete")
        || value.fragment().is_some()
    {
        return false;
    }
    let parameters = value.query_pairs().collect::<Vec<_>>();
    parameters.len() == 1
        && parameters[0].0 == "request"
        && valid_desktop_login_id(parameters[0].1.as_ref())
}

fn valid_device_id(value: &str) -> bool {
    value.starts_with("dev_")
        && value.len() == 36
        && value[4..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn valid_browser_id(value: &str) -> bool {
    value.starts_with("web_")
        && value.len() == 36
        && value[4..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn valid_base64url_secret(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn valid_pairing_share(value: &str) -> bool {
    value.len() == 87
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

#[cfg(test)]
mod pairing_validation_tests {
    #[cfg(target_os = "macos")]
    use super::is_desktop_login_return_url;
    use super::{valid_base64url_secret, valid_desktop_login_id, valid_pairing_share};

    #[test]
    fn pairing_share_and_secret_lengths_are_not_interchangeable() {
        let secret = "A".repeat(43);
        let share = "B".repeat(87);

        assert!(valid_base64url_secret(&secret));
        assert!(!valid_base64url_secret(&share));
        assert!(valid_pairing_share(&share));
        assert!(!valid_pairing_share(&secret));
    }

    #[test]
    fn desktop_login_request_ids_are_exact_and_url_safe() {
        let request_id = format!("dlogin_{}", "A".repeat(43));
        assert!(valid_desktop_login_id(&request_id));
        assert!(!valid_desktop_login_id(&format!(
            "dlogin_{}",
            "A".repeat(42)
        )));
        assert!(!valid_desktop_login_id(&format!(
            "dlogin_{}!",
            "A".repeat(42)
        )));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn desktop_login_return_only_accepts_a_wakeup_request_id() {
        let request_id = format!("dlogin_{}", "A".repeat(43));
        let accepted = url::Url::parse(&format!(
            "relayune://desktop-login-complete?request={request_id}"
        ))
        .expect("valid return URL");
        assert!(is_desktop_login_return_url(&accepted));
        assert!(!is_desktop_login_return_url(
            &url::Url::parse(&format!(
                "relayune://desktop-login-complete?request={request_id}&token=secret"
            ))
            .expect("valid rejected URL")
        ));
        assert!(!is_desktop_login_return_url(
            &url::Url::parse(&format!(
                "https://desktop-login-complete?request={request_id}"
            ))
            .expect("valid rejected scheme")
        ));
    }
}

fn reconcile_bootstrap_native_presentation(
    state: &AppState,
    request_generation: u64,
    config: RelayConfig,
    paired: Option<bool>,
    mut refresh: impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    let language = config
        .ui_language
        .as_deref()
        .and_then(UiLanguage::from_language_code)
        .unwrap_or_else(UiLanguage::system);
    if !state.bootstrap_request_is_current(request_generation) {
        return Ok(());
    }
    let _tray_update = lock_tray_update(state);
    // A newer retry may have started while this request was reading durable
    // config / secure storage or waiting behind another native publication.
    // Do not let that late result mutate AppState, NSMenu, tooltip or AX.
    if !state.bootstrap_request_is_current(request_generation) {
        return Ok(());
    }

    // A config retry can replace the temporary startup config and its fallback
    // system language. Commit the durable config, native language and (when
    // available) secure-store result while Relay publications are excluded.
    // Otherwise the WebView can recover in the persisted locale while NSMenu,
    // tooltip and VoiceOver remain in the fallback locale until a manual
    // language toggle. `None` means the secure store is still unreadable, so
    // preserve the existing paired/recovery flags rather than inventing an
    // unpaired first launch.
    state.set_config(config);
    state.set_ui_language(language);
    if let Some(paired) = paired {
        state.set_paired(paired);
        state.set_recovery_required(false);
    }
    if let Err(error) = refresh() {
        if !state.bootstrap_request_is_current(request_generation) {
            return Ok(());
        }
        // The credentials/config commit cannot be rolled back merely because
        // AppKit was transiently unavailable. Make the failure visible in the
        // Bootstrap snapshot and retry the now-authoritative presentation once
        // before releasing competing native publications.
        state.log(model::LogLevel::Error, error);
        if !state.bootstrap_request_is_current(request_generation) {
            return Ok(());
        }
        return refresh();
    }
    Ok(())
}

fn bootstrap(app: &AppHandle, state: &AppState) -> Result<Bootstrap, String> {
    // Claim latest-wins admission before either potentially slow read. Do not
    // serialize the reads: an explicit retry must be free to overtake a stuck
    // config or secure-store call. Reconciliation below is the commit gate.
    let request_generation = state.begin_bootstrap_request();
    // Setup keeps a safe in-memory fallback so the native window can exist and
    // show a retry surface. Bootstrap must still re-read the durable config:
    // otherwise a corrupt/unreadable file would silently look like an unpaired
    // first launch. Retrying after permissions or the file are repaired can
    // recover in place without restarting the app.
    let config = config::load_or_create(app)?;
    secrets::initialize(app)?;
    let secrets = match secrets::presence_for_browsers(&config.device_id, &config.browser_ids) {
        Ok(secrets) => secrets,
        Err(error) => {
            // Config recovery is independent from encrypted-vault recovery.
            // Restore the persisted native locale even while secret storage
            // remains temporarily unreadable, while preserving the explicit
            // Needs-attention enrollment state.
            let _ = reconcile_bootstrap_native_presentation(
                state,
                request_generation,
                config,
                None,
                || refresh_tray_language_locked(app, state, state.ui_language()),
            );
            return Err(error);
        }
    };
    // A successful encrypted-vault read is authoritative. This also repairs
    // the native menu after a transient vault startup error; a failed read
    // returns above and deliberately preserves the last known paired state.
    let _ = reconcile_bootstrap_native_presentation(
        state,
        request_generation,
        config.clone(),
        Some(secrets.device_token && secrets.e2ee_key),
        || refresh_tray_language_locked(app, state, state.ui_language()),
    );
    let launch_at_login = launch_at_login_or_diagnostic(state, app.autolaunch().is_enabled());
    Ok(Bootstrap {
        secrets,
        relay: state.snapshot(),
        config,
        launch_at_login,
        version: app.package_info().version.to_string(),
        platform: DesktopPlatform::current(),
    })
}

struct StartupNativePresentation {
    connection_available: bool,
    recovery_required: bool,
    phase: RelayPhase,
}

fn startup_native_presentation(
    config: &RelayConfig,
    presence: &SecretPresence,
    credential_access_failed: bool,
    config_access_failed: bool,
) -> StartupNativePresentation {
    if config_access_failed {
        // The temporary default config is only sufficient to keep the app and
        // diagnostics alive. Do not present it as a real first launch or enable
        // a Web workspace against values that were never loaded from disk.
        StartupNativePresentation {
            connection_available: false,
            recovery_required: true,
            phase: RelayPhase::Error,
        }
    } else if credential_access_failed {
        // An encrypted-vault read failure is never evidence that this is a first
        // launch. In particular, legacy authorized devices can have no
        // browser_ids in config while their token and content key still live
        // in the vault. Keep a known browser enrollment paired, but make every
        // unreadable credential state an explicit recovery surface instead of
        // inviting a duplicate pairing with "Not connected" copy.
        StartupNativePresentation {
            connection_available: !config.browser_ids.is_empty(),
            recovery_required: true,
            phase: RelayPhase::Error,
        }
    } else {
        StartupNativePresentation {
            connection_available: presence.device_token && presence.e2ee_key,
            recovery_required: false,
            phase: RelayPhase::Stopped,
        }
    }
}

fn publish_native_action_error<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
    error: impl AsRef<str>,
) {
    let refresh_result = publish_native_action_error_with_refresh_hooks(
        state,
        error,
        |snapshot| refresh_tray_status_for_snapshot_locked(app, state, snapshot),
        |snapshot| {
            let _ = app.emit("relay-status", snapshot);
        },
    );
    if refresh_result.is_err() {
        // Preserve the primary window/stop/update error in the one Web event.
        // A missing tray or transient AX failure must not append language_failed
        // and hide the actionable cause, but one best-effort native recheck can
        // still self-heal presentation after the serialized publication ends.
        let _ = refresh_tray_status(app, state);
    }
}

fn publish_native_action_error_with_hook(
    state: &AppState,
    error: impl AsRef<str>,
    emit: impl FnMut(RelaySnapshot),
) {
    let _ = publish_native_action_error_with_refresh_hooks(state, error, |_| Ok(()), emit);
}

fn publish_native_action_error_with_refresh_hooks(
    state: &AppState,
    error: impl AsRef<str>,
    refresh: impl FnMut(&RelaySnapshot) -> Result<(), String>,
    emit: impl FnMut(RelaySnapshot),
) -> Result<(), String> {
    state.log(model::LogLevel::Error, error);
    // Native menu callbacks run outside the WebView. Updating AppState alone
    // leaves the already-rendered diagnostics dialog on its old Bootstrap
    // snapshot, while a failed native Quit can also leave NSMenu, tooltip and
    // VoiceOver stuck on Connected/Stopping after Relay entered Error. Refresh
    // every native presentation surface and publish the fresh sanitized log in
    // the same transaction. Use the same publication mutex as Relay changes:
    // an older native-action snapshot must not arrive after a newer Connected
    // presentation and roll the WebView back while NSMenu/AX stays current.
    // The caller may retry a failed native refresh after this serialized
    // publication ends, without replacing the primary action error or sending
    // a second snapshot. Delivery remains best-effort because a destroyed
    // WebView has no additional native recovery channel beyond Show.
    publish_relay_snapshot_with_hooks(state, refresh, emit)
}

fn defer_native_entry(action: impl FnOnce() + Send + 'static) {
    // Tray, reopen and close callbacks execute on the native event-loop
    // thread. A concurrent Relay publication can already own `tray_update`
    // while Tauri synchronously dispatches an NSMenu/NSStatusItem mutation to
    // that same thread. Never wait for `tray_update` from a native callback:
    // doing so would leave each side waiting for the other and permanently
    // freeze every recovery surface. Blocking work is deliberately moved off
    // the async executor as well because Quit can wait for the sidecar.
    tauri::async_runtime::spawn_blocking(action);
}

fn record_native_window_action_dispatch_result<E>(
    state: &AppState,
    result: Result<(), E>,
    error: impl AsRef<str>,
    emit: impl FnMut(RelaySnapshot),
) {
    if result.is_err() {
        // Showing the window is only the first half of Diagnostics / Update.
        // If the runtime rejects the follow-up event, keep a stable diagnostic
        // in AppState instead of making the native click appear successful.
        // The live relay-status event is best-effort; the retained snapshot is
        // still available to the next bootstrap or focus-driven refresh.
        publish_native_action_error_with_hook(state, error, emit);
    }
}

fn emit_native_window_action<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
    event: &str,
    error: impl AsRef<str>,
) {
    record_native_window_action_dispatch_result(state, app.emit(event, ()), error, |snapshot| {
        let _ = app.emit("relay-status", snapshot);
    });
}

fn handle_tray_menu_event<R: Runtime>(app: &AppHandle<R>, event_id: &str) {
    #[cfg(target_os = "macos")]
    if keep_awake_menu::handle_event(app, event_id) {
        return;
    }
    match event_id {
        "open_settings" => {
            if let Err(error) = show_window(app) {
                publish_native_action_error(app, &app.state::<AppState>(), error);
            }
        }
        id if id.starts_with("agent_") => {
            if let Some(provider) = TRAY_PROVIDERS.iter().find(|p| id == format!("agent_{}", p.as_env())) {
                match show_window(app) {
                    Ok(()) => {
                        if app.emit("open-agent-management", provider.as_env()).is_err() {
                            publish_native_action_error(app, &app.state::<AppState>(), user_error("window_failed"));
                        }
                    }
                    Err(error) => publish_native_action_error(app, &app.state::<AppState>(), error),
                }
            }
        }
        "open_diagnostics" => match show_window(app) {
            Ok(()) => {
                emit_native_window_action(
                    app,
                    &app.state::<AppState>(),
                    "open-diagnostics",
                    user_error("window_failed"),
                );
            }
            Err(error) => {
                publish_native_action_error(app, &app.state::<AppState>(), error);
            }
        },
        "check_updates" => match show_window(app) {
            Ok(()) => {
                emit_native_window_action(
                    app,
                    &app.state::<AppState>(),
                    "check-for-updates",
                    user_error("update_failed"),
                );
            }
            Err(error) => {
                publish_native_action_error(app, &app.state::<AppState>(), error);
            }
        },
        "quit" => {
            let state = app.state::<AppState>();
            let _ = process_transition_with_hooks(
                &state,
                || relay::stop_for_exit(&state),
                || app.exit(0),
                |error| publish_native_action_error(app, &state, error),
            );
        }
        _ => {}
    }
}

fn tray_menu_status(language: UiLanguage, phase: &RelayPhase) -> String {
    tray_status_text(language, phase).trim_start_matches(TrayCopy::for_language(language).status_prefix).trim().to_owned()
}

#[cfg(target_os = "macos")]
fn refresh_keep_awake_menu<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let state = app.state::<AppState>();
    let _tray_update = lock_tray_update(&state);
    let status = app.state::<keep_awake::KeepAwake>().status()?;
    let items = lock_tray_items(&state).clone();
    if let Some(items) = items {
        items.keep_awake.refresh(state.ui_language(), &status)
            .map_err(|_| user_error("keep_awake_failed"))?;
    }
    Ok(())
}

const TRAY_PROVIDERS: [RelayProvider; 6] = [RelayProvider::Codex, RelayProvider::Claude, RelayProvider::Kimi, RelayProvider::Opencode, RelayProvider::Zcode, RelayProvider::Mcode];

fn tray_agent_text(language: UiLanguage, provider: RelayProvider, status: Option<&model::AgentRuntimeStatus>) -> String {
    use crate::model::AgentRuntimeStatus::*;
    let labels = match language {
        UiLanguage::SimplifiedChinese => ["检查中", "可用", "未安装", "待登录", "需要更新", "需要修复"],
        UiLanguage::English => ["Checking", "Available", "Not installed", "Sign in needed", "Update needed", "Repair needed"],
        UiLanguage::Hindi => ["जाँच जारी", "साइन इन है", "इंस्टॉल नहीं है", "साइन इन करें", "अपडेट करें", "सुधार आवश्यक"],
        UiLanguage::Spanish => ["Comprobando", "Sesión iniciada", "Sin instalar", "Iniciar sesión", "Actualizar", "Reparar"],
        UiLanguage::Arabic => ["جارٍ التحقق", "تم تسجيل الدخول", "غير مثبت", "يلزم تسجيل الدخول", "يلزم التحديث", "يلزم الإصلاح"],
        UiLanguage::French => ["Vérification", "Connecté", "Non installé", "Connexion requise", "Mise à jour requise", "Réparation requise"],
        UiLanguage::Bengali => ["যাচাই চলছে", "সাইন ইন করা আছে", "ইনস্টল করা নেই", "সাইন ইন প্রয়োজন", "আপডেট প্রয়োজন", "মেরামত প্রয়োজন"],
        UiLanguage::Portuguese => ["Verificando", "Sessão iniciada", "Não instalado", "Entrar", "Atualizar", "Reparar"],
        UiLanguage::Indonesian => ["Memeriksa", "Sudah masuk", "Belum terpasang", "Perlu masuk", "Perlu pembaruan", "Perlu perbaikan"],
        UiLanguage::Urdu => ["جانچ جاری", "سائن ان ہے", "انسٹال نہیں", "سائن ان درکار", "اپ ڈیٹ درکار", "مرمت درکار"],
    };
    let index = match status { None => 0, Some(Ready) => 1, Some(NotInstalled) => 2, Some(NotLoggedIn) => 3, Some(Outdated) => 4, Some(Broken) => 5 };
    let name = match provider { RelayProvider::Codex => "Codex", RelayProvider::Claude => "Claude Code", RelayProvider::Kimi => "Kimi Code", RelayProvider::Opencode => "OpenCode", RelayProvider::Zcode => "Z Code", RelayProvider::Mcode => "MiniMax Code" };
    format!("{} · {}", name, labels[index])
}

fn inspect_tray_agents(state: &AppState) -> Vec<AgentRuntimeAvailability> {
    // Share one inspection between the native background loop and window refreshes.
    let _inspection = state.inner.agent_inspection.lock().unwrap_or_else(|e| e.into_inner());
    let agents = agent_runtime::inspect_all(&state.config());
    let _update = lock_tray_update(state);
    *state.inner.tray_agents.lock().unwrap_or_else(|e| e.into_inner()) = agents.clone();
    if let Ok(items) = tray_items_snapshot(state) {
        let _ = refresh_tray_agents_locked(state, &items);
    }
    agents
}

fn refresh_tray_agents_locked(state: &AppState, items: &TrayMenuItems) -> Result<(), String> {
    let agents = state.inner.tray_agents.lock().unwrap_or_else(|e| e.into_inner()).clone();
    for (provider, item) in TRAY_PROVIDERS.iter().zip(&items.agents) {
        item.set_text(tray_agent_text(state.ui_language(), *provider,
            agents.iter().find(|a| a.provider == *provider).map(|a| &a.status)))
            .map_err(|_| user_error("language_failed"))?;
    }
    Ok(())
}

fn setup_tray(
    app: &tauri::App<Wry>,
    state: &AppState,
    initial_phase: RelayPhase,
) -> tauri::Result<bool> {
    let language = state.ui_language();
    let copy = TrayCopy::for_language(language);
    let connection_available = tray_connection_available(state);
    let update_available = state.update_available();
    let initial_phase = tray_presentation_phase(state.recovery_required(), &initial_phase);
    let initial_status = if connection_available {
        tray_menu_status(language, &initial_phase)
    } else {
        tray_not_connected_status_text(language)
    };
    let initial_tooltip = tray_presentation_tooltip(
        language,
        &initial_phase,
        connection_available,
        update_available,
    );
    #[cfg(target_os = "macos")]
    let initial_accessibility_label = tray_presentation_accessibility_label(
        language,
        &initial_phase,
        connection_available,
        update_available,
    );
    let status = MenuItemBuilder::with_id("relay_status", initial_status)
        .enabled(false)
        .build(app)?;
    let open = MenuItemBuilder::with_id(
        "open_settings",
        TrayCopy::for_language(language).show_app,
    )
    .build(app)?;
    #[cfg(target_os = "macos")]
    let agents = Vec::new();
    #[cfg(not(target_os = "macos"))]
    let agents = TRAY_PROVIDERS.iter().map(|provider| {
        MenuItemBuilder::with_id(format!("agent_{}", provider.as_env()),
            tray_agent_text(language, *provider, None)).build(app)
    }).collect::<tauri::Result<Vec<_>>>()?;
    let update = MenuItemBuilder::with_id(
        "check_updates",
        tray_update_action_text(language, update_available),
    )
    .build(app)?;
    let quit = MenuItemBuilder::with_id("quit", copy.quit);
    #[cfg(target_os = "macos")]
    let quit = quit.accelerator("CmdOrCtrl+Q");
    let quit = quit.build(app)?;
    let separator_one = PredefinedMenuItem::separator(app)?;
    #[cfg(target_os = "macos")]
    let keep_awake = keep_awake_menu::KeepAwakeMenu::new(app, language,
        &app.state::<keep_awake::KeepAwake>().status()
            .map_err(|error| tauri::Error::Io(std::io::Error::other(error)))?)?;
    #[cfg(target_os = "macos")]
    let separator_power = PredefinedMenuItem::separator(app)?;
    #[cfg(target_os = "macos")]
    let separator_preferences = PredefinedMenuItem::separator(app)?;
    #[cfg(target_os = "macos")]
    let menu = Menu::with_items(app, &[&status, &separator_one, &open,
        &separator_preferences, &keep_awake.submenu, &separator_power, &update, &quit])?;
    #[cfg(not(target_os = "macos"))]
    let separator_two = PredefinedMenuItem::separator(app)?;
    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &status,
            &separator_one,
            &agents[0],
            &agents[1],
            &agents[2],
            &agents[3],
            &agents[4],
            &separator_two,
            &update,
            &quit,
        ],
    )?;

    let tray = TrayIconBuilder::with_id("agent-relay-tray");
    #[cfg(target_os = "macos")]
    let tray = tray
        .icon(tauri::include_image!("./icons/trayTemplate.png"))
        .icon_as_template(true);
    #[cfg(not(target_os = "macos"))]
    let tray = tray
        .icon(tauri::include_image!("./icons/32x32.png"))
        .icon_as_template(false);
    let tray = tray
        .tooltip(initial_tooltip)
        .menu(&menu)
        .on_menu_event(|app, event| {
            let app = app.clone();
            let event_id = event.id().as_ref().to_owned();
            defer_native_entry(move || handle_tray_menu_event(&app, &event_id));
        });
    #[cfg(target_os = "macos")]
    let tray = tray.show_menu_on_left_click(true);
    #[cfg(not(target_os = "macos"))]
    let tray = tray
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                let app = tray.app_handle().clone();
                defer_native_entry(move || {
                    if let Err(error) = show_window(&app) {
                        publish_native_action_error(&app, &app.state::<AppState>(), error);
                    }
                });
            }
        });
    initialize_tray_presentation_with_hook(state, || {
        tray.build(app)?;

        *lock_tray_items(state) = Some(TrayMenuItems {
            #[cfg(target_os = "macos")]
            keep_awake,
            status,
            open,
            agents,
            update,
            quit,
        });
        #[cfg(target_os = "macos")]
        let accessibility_ready = record_initial_tray_accessibility_result(
            state,
            set_macos_tray_accessibility(
                app.handle(),
                state,
                initial_accessibility_label,
                tray_accessibility_help(language),
            ),
        );
        #[cfg(not(target_os = "macos"))]
        let accessibility_ready = true;
        Ok(accessibility_ready)
    })
}

#[cfg(any(target_os = "macos", test))]
fn record_initial_tray_accessibility_result(state: &AppState, result: Result<(), String>) -> bool {
    match result {
        Ok(()) => true,
        Err(error) => {
            // The status item may remain visually usable, so do not abort
            // Tauri setup. It is not a safe *sole* recovery surface, though:
            // a credential-less background launch has no Bootstrap or Relay
            // publication that can guarantee another AX retry. Return false so
            // setup keeps the window visible and requests a Regular identity.
            state.log(model::LogLevel::Error, error);
            false
        }
    }
}

fn native_menu_recovery_available(
    native_menu_visible: bool,
    initial_accessibility_ready: bool,
) -> bool {
    native_menu_visible && initial_accessibility_ready
}

fn refresh_tray_language_locked(
    app: &AppHandle,
    state: &AppState,
    language: UiLanguage,
) -> Result<(), String> {
    let copy = TrayCopy::for_language(language);
    let snapshot = state.snapshot();
    let connection_available = tray_connection_available(state);
    let update_available = state.update_available();
    let presentation_phase = tray_presentation_phase(state.recovery_required(), &snapshot.phase);
    let items = tray_items_snapshot(state)?;
    let status_result = if connection_available {
        items
            .status
            .set_text(tray_menu_status(language, &presentation_phase))
    } else {
        items
            .status
            .set_text(tray_not_connected_status_text(language))
    };
    status_result
        .and_then(|_| {
            items
                .open
                .set_text(TrayCopy::for_language(language).show_app)
        })
        .and_then(|_| {
            items
                .update
                .set_text(tray_update_action_text(language, update_available))
        })
        .and_then(|_| items.quit.set_text(copy.quit))
        .map_err(|_| user_error("language_failed"))?;
    refresh_tray_agents_locked(state, &items)?;
    #[cfg(target_os = "macos")]
    items.keep_awake.refresh(language, &app.state::<keep_awake::KeepAwake>().status()?)
        .map_err(|_| user_error("language_failed"))?;
    let tray = app
        .tray_by_id("agent-relay-tray")
        .ok_or_else(|| user_error("language_failed"))?;
    tray.set_tooltip(Some(tray_presentation_tooltip(
        language,
        &presentation_phase,
        connection_available,
        update_available,
    )))
    .map_err(|_| user_error("language_failed"))?;
    set_macos_tray_accessibility(
        app,
        state,
        tray_presentation_accessibility_label(
            language,
            &presentation_phase,
            connection_available,
            update_available,
        ),
        tray_accessibility_help(language),
    )
}

pub(crate) fn refresh_tray_status<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
) -> Result<(), String> {
    let _tray_update = lock_tray_update(state);
    refresh_tray_status_locked(app, state)
}

fn refresh_tray_status_locked<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
) -> Result<(), String> {
    let snapshot = state.snapshot();
    refresh_tray_status_for_snapshot_locked(app, state, &snapshot)
}

fn refresh_tray_status_for_snapshot_locked<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
    snapshot: &RelaySnapshot,
) -> Result<(), String> {
    let language = state.ui_language();
    let connection_available = tray_connection_available(state);
    let update_available = state.update_available();
    let presentation_phase = tray_presentation_phase(state.recovery_required(), &snapshot.phase);
    let items = tray_items_snapshot(state)?;
    if connection_available {
        items
            .status
            .set_text(tray_menu_status(language, &presentation_phase))
            .map_err(|_| user_error("language_failed"))?;
    } else {
        items
            .status
            .set_text(tray_not_connected_status_text(language))
            .map_err(|_| user_error("language_failed"))?;
    }
    items
        .open
        .set_text(TrayCopy::for_language(language).show_app)
        .and_then(|_| {
            items
                .update
                .set_text(tray_update_action_text(language, update_available))
        })
        .map_err(|_| user_error("language_failed"))?;
    refresh_tray_agents_locked(state, &items)?;
    let tray = app
        .tray_by_id("agent-relay-tray")
        .ok_or_else(|| user_error("language_failed"))?;
    tray.set_tooltip(Some(tray_presentation_tooltip(
        language,
        &presentation_phase,
        connection_available,
        update_available,
    )))
    .map_err(|_| user_error("language_failed"))?;
    set_macos_tray_accessibility(
        app,
        state,
        tray_presentation_accessibility_label(
            language,
            &presentation_phase,
            connection_available,
            update_available,
        ),
        tray_accessibility_help(language),
    )
}

fn publish_relay_snapshot_with_hooks(
    state: &AppState,
    refresh: impl FnOnce(&RelaySnapshot) -> Result<(), String>,
    emit: impl FnOnce(RelaySnapshot),
) -> Result<(), String> {
    let _tray_update = lock_tray_update(state);
    // Capture exactly once. A newer phase may be written while this native
    // update is in flight, but its publisher must wait for `tray_update`, so it
    // cannot present and emit the new phase before this older transaction.
    let snapshot = state.snapshot();
    let refresh_result = refresh(&snapshot);
    emit(snapshot);
    refresh_result
}

fn publish_relay_snapshot_with_retry_hooks(
    state: &AppState,
    mut refresh: impl FnMut(&RelaySnapshot) -> Result<(), String>,
    mut emit: impl FnMut(RelaySnapshot),
) -> Result<(), String> {
    let first = publish_relay_snapshot_with_hooks(
        state,
        |snapshot| refresh(snapshot),
        |snapshot| emit(snapshot),
    );
    let Err(error) = first else {
        return Ok(());
    };

    // A Relay phase publication has no command caller that can surface a
    // failed NSMenu/tooltip/AX refresh. Without an immediate retry, the WebView
    // advances while the hidden native presentation can remain stale forever
    // if the Relay is otherwise quiet. Record only the stable error after the
    // first transaction releases tray_update, then capture the latest snapshot
    // in a fresh serialized transaction. This cannot replay the older phase.
    state.log(model::LogLevel::Error, error);
    publish_relay_snapshot_with_hooks(
        state,
        |snapshot| refresh(snapshot),
        |snapshot| emit(snapshot),
    )
}

pub(crate) fn publish_relay_snapshot(app: &AppHandle, state: &AppState) {
    let _ = publish_relay_snapshot_with_retry_hooks(
        state,
        |snapshot| refresh_tray_status_for_snapshot_locked(app, state, snapshot),
        |snapshot| {
            let _ = app.emit("relay-status", snapshot);
        },
    );
}

struct TrayCopy {
    diagnostics: &'static str,
    quit: &'static str,
    connect_computer: &'static str,
    show_app: &'static str,
    check_updates: &'static str,
    install_update: &'static str,
    open_web: &'static str,
    status_prefix: &'static str,
    not_connected: &'static str,
    update_available: &'static str,
    accessibility_separator: &'static str,
    accessibility_help: &'static str,
    workspace_picker: &'static str,
    stopped: &'static str,
    starting: &'static str,
    connected: &'static str,
    stopping: &'static str,
    attention: &'static str,
}

impl TrayCopy {
    fn for_language(language: UiLanguage) -> Self {
        match language {
            UiLanguage::SimplifiedChinese => Self {
                diagnostics: "帮助与诊断…",
                quit: "退出 Relayune",
                connect_computer: "连接这台电脑…",
                show_app: "显示 Relayune",
                check_updates: "检查更新…",
                install_update: "安装更新…",
                open_web: "打开 Web 工作台",
                status_prefix: "状态：",
                not_connected: "尚未连接",
                update_available: "有更新",
                accessibility_separator: "，",
                accessibility_help: "打开 Relayune 菜单",
                workspace_picker: "选择 Relayune 默认工作目录",
                stopped: "已停止",
                starting: "正在连接",
                connected: "已连接",
                stopping: "正在停止",
                attention: "需要处理",
            },
            UiLanguage::English => Self {
                diagnostics: "Help & Diagnostics…",
                quit: "Quit Relayune",
                connect_computer: "Connect This Computer…",
                show_app: "Show Relayune",
                check_updates: "Check for Updates…",
                install_update: "Install Update…",
                open_web: "Open Web Workspace",
                status_prefix: "Status: ",
                not_connected: "Not connected",
                update_available: "Update available",
                accessibility_separator: ", ",
                accessibility_help: "Open the Relayune menu",
                workspace_picker: "Choose Relayune default working folder",
                stopped: "Stopped",
                starting: "Connecting",
                connected: "Connected",
                stopping: "Stopping",
                attention: "Needs attention",
            },
            UiLanguage::Hindi => Self {
                diagnostics: "सहायता और निदान…",
                quit: "Relayune से बाहर निकलें",
                connect_computer: "इस कंप्यूटर को कनेक्ट करें…",
                show_app: "Relayune दिखाएँ",
                check_updates: "अपडेट जाँचें…",
                install_update: "अपडेट इंस्टॉल करें…",
                open_web: "Web कार्यस्थान खोलें",
                status_prefix: "स्थिति: ",
                not_connected: "कनेक्ट नहीं है",
                update_available: "अपडेट उपलब्ध",
                accessibility_separator: ", ",
                accessibility_help: "Relayune मेन्यू खोलें",
                workspace_picker: "Relayune डिफ़ॉल्ट कार्य फ़ोल्डर चुनें",
                stopped: "रुका हुआ",
                starting: "कनेक्ट हो रहा है",
                connected: "कनेक्टेड",
                stopping: "रुक रहा है",
                attention: "ध्यान आवश्यक",
            },
            UiLanguage::Spanish => Self {
                diagnostics: "Ayuda y diagnóstico…",
                quit: "Salir de Relayune",
                connect_computer: "Conectar este ordenador…",
                show_app: "Mostrar Relayune",
                check_updates: "Buscar actualizaciones…",
                install_update: "Instalar actualización…",
                open_web: "Abrir espacio de trabajo Web",
                status_prefix: "Estado: ",
                not_connected: "Sin conexión",
                update_available: "Actualización disponible",
                accessibility_separator: ", ",
                accessibility_help: "Abrir el menú de Relayune",
                workspace_picker: "Elegir carpeta de trabajo predeterminada de Relayune",
                stopped: "Detenido",
                starting: "Conectando",
                connected: "Conectado",
                stopping: "Deteniendo",
                attention: "Requiere atención",
            },
            UiLanguage::Arabic => Self {
                diagnostics: "المساعدة والتشخيص…",
                quit: "إنهاء Relayune",
                connect_computer: "توصيل هذا الكمبيوتر…",
                show_app: "إظهار Relayune",
                check_updates: "البحث عن تحديثات…",
                install_update: "تثبيت التحديث…",
                open_web: "فتح مساحة عمل Web",
                status_prefix: "الحالة: ",
                not_connected: "غير متصل",
                update_available: "يتوفر تحديث",
                accessibility_separator: "، ",
                accessibility_help: "فتح قائمة Relayune",
                workspace_picker: "اختيار مجلد العمل الافتراضي في Relayune",
                stopped: "متوقف",
                starting: "جارٍ الاتصال",
                connected: "متصل",
                stopping: "جارٍ الإيقاف",
                attention: "يتطلب الانتباه",
            },
            UiLanguage::French => Self {
                diagnostics: "Aide et diagnostic…",
                quit: "Quitter Relayune",
                connect_computer: "Connecter cet ordinateur…",
                show_app: "Afficher Relayune",
                check_updates: "Rechercher des mises à jour…",
                install_update: "Installer la mise à jour…",
                open_web: "Ouvrir l’espace de travail Web",
                status_prefix: "État : ",
                not_connected: "Non connecté",
                update_available: "Mise à jour disponible",
                accessibility_separator: ", ",
                accessibility_help: "Ouvrir le menu Relayune",
                workspace_picker: "Choisir le dossier de travail par défaut de Relayune",
                stopped: "Arrêté",
                starting: "Connexion en cours",
                connected: "Connecté",
                stopping: "Arrêt en cours",
                attention: "Attention requise",
            },
            UiLanguage::Bengali => Self {
                diagnostics: "সহায়তা ও ডায়াগনস্টিক…",
                quit: "Relayune থেকে প্রস্থান",
                connect_computer: "এই কম্পিউটার সংযুক্ত করুন…",
                show_app: "Relayune দেখান",
                check_updates: "আপডেট পরীক্ষা করুন…",
                install_update: "আপডেট ইনস্টল করুন…",
                open_web: "Web কর্মক্ষেত্র খুলুন",
                status_prefix: "অবস্থা: ",
                not_connected: "সংযুক্ত নয়",
                update_available: "আপডেট পাওয়া গেছে",
                accessibility_separator: ", ",
                accessibility_help: "Relayune মেনু খুলুন",
                workspace_picker: "Relayune-এর ডিফল্ট কাজের ফোল্ডার বেছে নিন",
                stopped: "বন্ধ",
                starting: "সংযোগ হচ্ছে",
                connected: "সংযুক্ত",
                stopping: "বন্ধ হচ্ছে",
                attention: "মনোযোগ প্রয়োজন",
            },
            UiLanguage::Portuguese => Self {
                diagnostics: "Ajuda e diagnóstico…",
                quit: "Sair do Relayune",
                connect_computer: "Ligar este computador…",
                show_app: "Mostrar Relayune",
                check_updates: "Procurar atualizações…",
                install_update: "Instalar atualização…",
                open_web: "Abrir espaço de trabalho Web",
                status_prefix: "Estado: ",
                not_connected: "Não ligado",
                update_available: "Atualização disponível",
                accessibility_separator: ", ",
                accessibility_help: "Abrir o menu Relayune",
                workspace_picker: "Escolher pasta de trabalho predefinida do Relayune",
                stopped: "Parado",
                starting: "A ligar",
                connected: "Ligado",
                stopping: "A parar",
                attention: "Atenção necessária",
            },
            UiLanguage::Indonesian => Self {
                diagnostics: "Bantuan & diagnostik…",
                quit: "Keluar dari Relayune",
                connect_computer: "Hubungkan komputer ini…",
                show_app: "Tampilkan Relayune",
                check_updates: "Periksa pembaruan…",
                install_update: "Pasang pembaruan…",
                open_web: "Buka ruang kerja Web",
                status_prefix: "Status: ",
                not_connected: "Belum terhubung",
                update_available: "Pembaruan tersedia",
                accessibility_separator: ", ",
                accessibility_help: "Buka menu Relayune",
                workspace_picker: "Pilih folder kerja default Relayune",
                stopped: "Berhenti",
                starting: "Menghubungkan",
                connected: "Terhubung",
                stopping: "Menghentikan",
                attention: "Perlu perhatian",
            },
            UiLanguage::Urdu => Self {
                diagnostics: "مدد اور تشخیص…",
                quit: "Relayune بند کریں",
                connect_computer: "اس کمپیوٹر کو منسلک کریں…",
                show_app: "Relayune دکھائیں",
                check_updates: "اپ ڈیٹس دیکھیں…",
                install_update: "اپ ڈیٹ نصب کریں…",
                open_web: "Web ورک اسپیس کھولیں",
                status_prefix: "حالت: ",
                not_connected: "منسلک نہیں",
                update_available: "اپ ڈیٹ دستیاب",
                accessibility_separator: "، ",
                accessibility_help: "Relayune مینیو کھولیں",
                workspace_picker: "Relayune کا ڈیفالٹ ورک فولڈر منتخب کریں",
                stopped: "رکا ہوا",
                starting: "رابطہ ہو رہا ہے",
                connected: "منسلک",
                stopping: "رک رہا ہے",
                attention: "توجہ درکار",
            },
        }
    }

    fn phase_label(&self, phase: &RelayPhase) -> &'static str {
        match phase {
            RelayPhase::Stopped => self.stopped,
            RelayPhase::Starting => self.starting,
            RelayPhase::Connected => self.connected,
            RelayPhase::Stopping => self.stopping,
            RelayPhase::Error => self.attention,
        }
    }
}

fn tray_window_action_text(language: UiLanguage, connection_available: bool) -> &'static str {
    let copy = TrayCopy::for_language(language);
    if connection_available {
        copy.show_app
    } else {
        copy.connect_computer
    }
}

fn tray_update_action_text(language: UiLanguage, update_available: bool) -> &'static str {
    let copy = TrayCopy::for_language(language);
    if update_available {
        copy.install_update
    } else {
        copy.check_updates
    }
}

fn tray_web_action_text(language: UiLanguage) -> &'static str {
    TrayCopy::for_language(language).open_web
}

pub(crate) fn tray_phase_label(language: UiLanguage, phase: &RelayPhase) -> &'static str {
    TrayCopy::for_language(language).phase_label(phase)
}

pub(crate) fn tray_status_text(language: UiLanguage, phase: &RelayPhase) -> String {
    let copy = TrayCopy::for_language(language);
    format!("{}{}", copy.status_prefix, copy.phase_label(phase))
}

fn tray_connection_available(state: &AppState) -> bool {
    state.is_paired() || state.recovery_required()
}

fn tray_web_workspace_available(state: &AppState) -> bool {
    state.is_paired()
}

fn tray_presentation_phase(recovery_required: bool, phase: &RelayPhase) -> RelayPhase {
    if recovery_required {
        // A durable-config or secure-store failure is not a user-stopped Relay.
        // Every later language, update or Relay publication must retain the
        // same Needs-attention status, tooltip and VoiceOver label that setup
        // presented, until bootstrap authoritatively clears recovery.
        RelayPhase::Error
    } else {
        phase.clone()
    }
}

pub(crate) fn tray_not_connected_status_text(language: UiLanguage) -> String {
    let copy = TrayCopy::for_language(language);
    format!("{}{}", copy.status_prefix, copy.not_connected)
}

pub(crate) fn tray_not_connected_tooltip(language: UiLanguage) -> String {
    format!(
        "Relayune · {}",
        TrayCopy::for_language(language).not_connected
    )
}

pub(crate) fn tray_not_connected_accessibility_label(language: UiLanguage) -> String {
    let copy = TrayCopy::for_language(language);
    format!(
        "Relayune{}{}",
        copy.accessibility_separator, copy.not_connected
    )
}

pub(crate) fn tray_tooltip(language: UiLanguage, phase: &RelayPhase) -> String {
    format!("Relayune · {}", tray_phase_label(language, phase))
}

pub(crate) fn tray_accessibility_label(language: UiLanguage, phase: &RelayPhase) -> String {
    let copy = TrayCopy::for_language(language);
    format!(
        "Relayune{}{}",
        copy.accessibility_separator,
        copy.phase_label(phase)
    )
}

fn tray_presentation_tooltip(
    language: UiLanguage,
    phase: &RelayPhase,
    connection_available: bool,
    update_available: bool,
) -> String {
    let mut tooltip = if connection_available {
        tray_tooltip(language, phase)
    } else {
        tray_not_connected_tooltip(language)
    };
    if update_available {
        tooltip.push_str(" · ");
        tooltip.push_str(TrayCopy::for_language(language).update_available);
    }
    tooltip
}

fn tray_presentation_accessibility_label(
    language: UiLanguage,
    phase: &RelayPhase,
    connection_available: bool,
    update_available: bool,
) -> String {
    let mut label = if connection_available {
        tray_accessibility_label(language, phase)
    } else {
        tray_not_connected_accessibility_label(language)
    };
    if update_available {
        let copy = TrayCopy::for_language(language);
        label.push_str(copy.accessibility_separator);
        label.push_str(copy.update_available);
    }
    label
}

pub(crate) fn tray_accessibility_help(language: UiLanguage) -> &'static str {
    TrayCopy::for_language(language).accessibility_help
}

#[cfg(target_os = "macos")]
fn set_macos_tray_accessibility<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
    label: String,
    help: &'static str,
) -> Result<(), String> {
    let tray = app
        .tray_by_id("agent-relay-tray")
        .ok_or_else(|| user_error("language_failed"))?;
    let copy = TrayCopy::for_language(state.ui_language());
    let power_indicators = keep_awake_menu::presentation(state.ui_language(),
        &app.state::<keep_awake::KeepAwake>().status()?);
    let applied = tray
        .with_inner_tray_icon(move |tray_icon| {
            let Some(main_thread) = MainThreadMarker::new() else {
                return false;
            };
            let Some(status_item) = tray_icon.ns_status_item() else {
                return false;
            };
            let Some(button) = status_item.button(main_thread) else {
                return false;
            };
            let Some(menu) = status_item.menu(main_thread) else {
                return false;
            };
            if !macos_tray_menu::refresh(main_thread, &menu, copy.connected, copy.attention) {
                return false;
            }
            macos_tray_menu::refresh_power_indicators(&menu, &power_indicators);
            let identifier = "RelayuneMenuBarItem";
            button.setAccessibilityLabel(Some(&NSString::from_str(&label)));
            button.setAccessibilityHelp(Some(&NSString::from_str(help)));
            button.setAccessibilityIdentifier(Some(&NSString::from_str(identifier)));

            // Treat AppKit as the source of truth. A successful setter call is
            // not sufficient evidence that VoiceOver will observe the custom
            // value on the concrete NSStatusBarButton, so read back all three
            // properties before admitting this presentation update.
            status_item.isVisible()
                && button
                    .accessibilityLabel()
                    .is_some_and(|value| value.to_string() == label)
                && button
                    .accessibilityHelp()
                    .is_some_and(|value| value.to_string() == help)
                && button
                    .accessibilityIdentifier()
                    .is_some_and(|value| value.to_string() == identifier)
        })
        .map_err(|_| user_error("language_failed"))?;
    let result = applied
        .then_some(())
        .ok_or_else(|| user_error("language_failed"));
    record_native_menu_accessibility_refresh_result(state, result)
}

#[cfg(not(target_os = "macos"))]
fn set_macos_tray_accessibility<R: Runtime>(
    _app: &AppHandle<R>,
    _state: &AppState,
    _label: String,
    _help: &'static str,
) -> Result<(), String> {
    Ok(())
}

#[cfg(any(target_os = "macos", test))]
fn record_native_menu_accessibility_refresh_result(
    state: &AppState,
    result: Result<(), String>,
) -> Result<(), String> {
    if result.is_ok() {
        // Initial AX setup may fail transiently and force a visible Regular
        // fallback. A later bootstrap/Relay/language refresh can prove that
        // the concrete status item is now both visible and AX-readable. Admit
        // that repaired native recovery surface again so close-to-menu does
        // not remain permanently disabled until restart. Close still performs
        // a fresh AppKit visibility/policy readback immediately before hide.
        state.set_window_hide_recovery_available(true);
    }
    result
}

fn restore_window_with_hooks<UnminimizeError, ShowError, FocusError>(
    unminimize: impl FnOnce() -> Result<(), UnminimizeError>,
    show: impl FnOnce() -> Result<(), ShowError>,
    focus: impl FnOnce() -> Result<(), FocusError>,
) -> Result<(), String> {
    // Unminimizing is a best-effort preparation step. A transient or
    // platform-specific failure here must not prevent a hidden window from
    // being revealed and focused when those two required operations still
    // work (cold start, status-item restore, and Dock/Finder reopen all share
    // this path).
    let _ = unminimize();
    show().map_err(|_| user_error("window_failed"))?;
    focus().map_err(|_| user_error("window_failed"))
}

fn show_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| user_error("window_failed"))?;
    restore_window_with_hooks(
        || window.unminimize(),
        || window.show(),
        || window.set_focus(),
    )
}

static PRE_SETUP_NATIVE_RESTORE_PENDING: AtomicBool = AtomicBool::new(false);

fn request_pending_native_restore_with_hook(
    pending: &AtomicBool,
    immediate_restore: impl FnOnce() -> bool,
    state_is_ready: impl FnOnce() -> bool,
    restore_after_state_registration: impl FnOnce(),
) {
    // The single-instance plugin starts its listener in plugin setup, before
    // Relayune's user setup has managed AppState. An interactive second launch
    // can therefore arrive while neither state nor the main WebView is ready.
    // Remember that intent instead of dropping a one-shot show_window failure.
    pending.store(true, Ordering::SeqCst);
    // Preserve the fastest existing path when Tauri has already created the
    // hidden main window even though AppState is not managed yet. The pending
    // bit makes failure recoverable; success satisfies every coalesced Show
    // request and setup need not reveal the same window again.
    if immediate_restore() {
        pending.store(false, Ordering::SeqCst);
        return;
    }

    // Close the race where setup manages AppState and consumes the pending bit
    // between our first try_state(None) and the store above. If setup already
    // consumed it, swap returns false and setup owns the restore; otherwise the
    // now-ready callback performs it. Exactly one side retains responsibility.
    if state_is_ready() && pending.swap(false, Ordering::SeqCst) {
        restore_after_state_registration();
    }
}

fn take_pending_native_restore(pending: &AtomicBool) -> bool {
    pending.swap(false, Ordering::SeqCst)
}

fn restore_window_from_native_entry<R: Runtime>(app: &AppHandle<R>) {
    let Some(state) = app.try_state::<AppState>() else {
        request_pending_native_restore_with_hook(
            &PRE_SETUP_NATIVE_RESTORE_PENDING,
            || show_window(app).is_ok(),
            || app.try_state::<AppState>().is_some(),
            || restore_window_from_native_entry(app),
        );
        return;
    };
    let result = restore_window_from_native_entry_with_hooks(
        || show_window(app),
        || schedule_native_entry_recovery_check(app, &state),
    );
    if let Err(error) = result {
        // Dock/Finder reopen and an interactive second launch run outside the
        // WebView just like tray callbacks. Logging alone leaves the
        // already-rendered diagnostics snapshot stale, so publish the same
        // serialized stable failure used by native menu actions.
        publish_native_action_error(app, &state, error);
    }
}

fn schedule_native_entry_recovery_check<R: Runtime>(app: &AppHandle<R>, state: &AppState) {
    let check_app = app.clone();
    let check_state = state.clone();
    let request_app = app.clone();
    let request_state = state.clone();
    let fallback_app = app.clone();
    let fallback_state = state.clone();
    schedule_native_entry_recovery_check_with_hooks(
        |check| app.run_on_main_thread(check).map_err(|_| ()),
        move || window_hide_recovery_surface_is_active(&check_app, &check_state),
        move || request_windowed_recovery_surface(&request_app, &request_state),
        move || request_windowed_recovery_surface(&fallback_app, &fallback_state),
    );
}

fn schedule_native_entry_recovery_check_with_hooks(
    schedule_on_main_thread: impl FnOnce(Box<dyn FnOnce() + Send>) -> Result<(), ()>,
    recovery_surface_active: impl FnOnce() -> bool + Send + 'static,
    request_windowed_recovery: impl FnOnce() + Send + 'static,
    schedule_failure_fallback: impl FnOnce(),
) {
    let check = Box::new(move || {
        if !recovery_surface_active() {
            request_windowed_recovery();
        }
    });
    if schedule_on_main_thread(check).is_err() {
        // If the native loop cannot accept the AppKit readback, no concrete
        // recovery surface can be proved. Fail closed by requesting Regular
        // instead of leaving an unreachable Accessory process in the background.
        schedule_failure_fallback();
    }
}

fn restore_window_from_native_entry_with_hooks<RestoreError>(
    restore: impl FnOnce() -> Result<(), RestoreError>,
    schedule_recovery_check: impl FnOnce(),
) -> Result<(), RestoreError> {
    let result = restore();
    if result.is_err() {
        // Finder/Dock/second-instance recovery is deliberately dispatched off
        // the native event thread. AppKit's status item and activation policy
        // can only be read with MainThreadMarker, so schedule that verification
        // back onto the main thread instead of treating every worker read as a
        // missing surface and unnecessarily exposing a Dock/Cmd-Tab identity.
        schedule_recovery_check();
    }
    result
}

fn hide_main_window<R: Runtime>(window: &tauri::Window<R>) {
    let Some(state) = window.app_handle().try_state::<AppState>() else {
        // Close has already been prevented. Without managed state there is no
        // proven status-item or Dock recovery route, so keep the window visible.
        return;
    };
    let recovery_surface_active =
        window_hide_recovery_surface_is_active(window.app_handle(), &state);
    let app_for_error = window.app_handle().clone();
    let state_for_error = state.inner().clone();
    hide_main_window_with_hook(
        recovery_surface_active,
        || window.hide(),
        || window_hide_recovery_surface_is_active(window.app_handle(), &state),
        || restore_window_after_recovery_surface_loss(window.app_handle(), &state),
        move || {
            defer_native_entry(move || {
                publish_native_action_error(
                    &app_for_error,
                    &state_for_error,
                    user_error("window_failed"),
                );
            });
        },
    );
}

fn restore_window_after_recovery_surface_loss<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
) -> Result<(), String> {
    restore_window_after_recovery_surface_loss_with_hooks(
        || show_window(app),
        || request_windowed_recovery_surface(app, state),
    )
}

fn request_windowed_recovery_surface<R: Runtime>(app: &AppHandle<R>, state: &AppState) {
    // The setup admission described a status item that is no longer present,
    // so it is unsafe to retain that cached recovery promise. Request and read
    // back a Regular Dock/Cmd-Tab identity. This gives an otherwise unreachable
    // Accessory process a second OS-owned route instead of logging only to its
    // hidden WebView.
    state.set_window_hide_recovery_available(false);
    if configure_windowed_recovery_app(app).is_ok() {
        let _ = schedule_runtime_windowed_recovery_confirmation(app, state);
    }
}

fn restore_window_after_recovery_surface_loss_with_hooks<RestoreError>(
    restore: impl FnOnce() -> Result<(), RestoreError>,
    request_windowed_recovery: impl FnOnce(),
) -> Result<(), RestoreError> {
    let result = restore();
    if result.is_err() {
        request_windowed_recovery();
    }
    result
}

fn hide_main_window_with_hook<HideError, RestoreError>(
    recovery_surface_active: bool,
    hide: impl FnOnce() -> Result<(), HideError>,
    recovery_surface_after_hide: impl FnOnce() -> bool,
    restore: impl FnOnce() -> Result<(), RestoreError>,
    report_error: impl FnOnce(),
) {
    let mut report_error = Some(report_error);
    if !recovery_surface_active {
        // A successful setup admission can become stale if AppKit later stops
        // exposing the status item or Regular Dock identity. Revalidate both
        // concrete surfaces at close time before hiding the last window.
        report_error
            .take()
            .expect("window-hide error reporter should be available")();
        return;
    }
    if !record_window_hide_result(hide(), || {
        report_error
            .take()
            .expect("window-hide error reporter should be available")();
    }) {
        return;
    }
    if recovery_surface_after_hide() {
        return;
    }

    // The status item can disappear between the pre-hide AppKit readback and
    // the actual native hide dispatcher. Recheck after hiding and immediately
    // restore the same window if neither the status item nor Regular identity
    // remains reachable. One stable diagnostic covers both a successful rescue
    // and a failed restore; the latter stays available to the next bootstrap.
    let _ = restore();
    report_error
        .take()
        .expect("window-hide error reporter should be available")();
}

fn record_window_hide_result<E>(result: Result<(), E>, report_error: impl FnOnce()) -> bool {
    if result.is_err() {
        // Close has already been prevented so Relay remains resident. If the
        // native hide fails, retain that safe behavior but make the otherwise
        // silent failure visible through the live localized diagnostics
        // snapshot, not only the next Bootstrap read or unrelated Relay event.
        report_error();
        false
    } else {
        true
    }
}

fn record_startup_window_restore_result(state: &AppState, result: Result<(), String>) {
    if let Err(error) = result {
        // The tray already provides another recovery entry point. A transient
        // AppKit focus/show failure must not terminate setup, discard that
        // entry point, or prevent an already-authorized Relay from starting.
        state.log(model::LogLevel::Error, error);
    }
}

#[derive(Debug, PartialEq, Eq)]
struct StartupBehavior {
    show_main_window: bool,
    start_relay: bool,
}

fn startup_behavior(
    background_launch: bool,
    presence: &SecretPresence,
    native_menu_available: bool,
) -> StartupBehavior {
    StartupBehavior {
        // A background launch is only safe to keep hidden when the native menu
        // actually exists. If the NSStatusItem could not be created, the main
        // window becomes the sole recovery surface and must be shown.
        show_main_window: !background_launch || !native_menu_available,
        start_relay: presence.device_token && presence.e2ee_key,
    }
}

#[cfg(target_os = "macos")]
fn workspace_access_paths<R: Runtime>(app: &AppHandle<R>) -> Vec<std::path::PathBuf> {
    workspace_access::startup_probe_paths(app.path().document_dir().ok())
}

#[cfg(target_os = "macos")]
async fn preflight_workspace_access(
    paths: Vec<std::path::PathBuf>,
    state: &AppState,
) -> Result<bool, String> {
    let result = tauri::async_runtime::spawn_blocking(move || workspace_access::preflight(&paths))
        .await
        .map_err(|_| user_error("workspace_invalid"))?;
    let permission_denied = result.permission_denied;
    state.inner.workspace_access_denied.store(permission_denied, std::sync::atomic::Ordering::SeqCst);
    if permission_denied {
        // A parameter-free diagnostic explains a rejected macOS folder grant
        // without leaking the user's workspace or file names.
        state.log(model::LogLevel::Error, user_error("workspace_invalid"));
    }
    Ok(!permission_denied)
}

#[tauri::command]
async fn request_workspace_access(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let config = state.config();
        let presence = secrets::presence_for_browsers(&config.device_id, &config.browser_ids)?;
        if config.account_email.is_none() || !presence.device_token {
            return Err(user_error("sign_in_failed"));
        }
        let paths = workspace_access_paths(&app);
        let granted = preflight_workspace_access(paths, &state).await?;
        relay::publish(&app, &state);
        return Ok(granted);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, state);
        Ok(true)
    }
}

#[tauri::command]
fn open_file_access_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return open_external_url("x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders")
        .map_err(|_| user_error("open_web_failed"));
    #[cfg(not(target_os = "macos"))]
    Ok(())
}

#[tauri::command]
async fn retry_file_access(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // Recheck Documents only if it was actually denied; do not request unrelated grants.
    #[cfg(target_os = "macos")]
    if state.inner.workspace_access_denied.load(std::sync::atomic::Ordering::SeqCst) {
        preflight_workspace_access(workspace_access_paths(&app), &state).await?;
    }
    relay::retry_file_access(&state)?;
    relay::publish(&app, &state);
    Ok(())
}

fn should_activate_existing_instance(arguments: &[String]) -> bool {
    !arguments.iter().any(|argument| argument == "--background")
}

fn process_transition_with_hooks(
    state: &AppState,
    stop_relay: impl FnOnce() -> Result<(), String>,
    transition: impl FnOnce(),
    publish_failure: impl FnOnce(&str),
) -> Result<(), String> {
    if state.exit_stop_ready() {
        // Ready proves only that an owner already invoked *a* transition. It
        // does not prove this caller requested the same one: reporting updater
        // restart success after menu Quit committed would silently exit without
        // relaunching. Fail closed while the owner's transition is pending.
        return Err(user_error("relay_stop_failed"));
    }
    if !state.begin_exit_stop() {
        // Another menu Quit / process exit / updater restart is still stopping
        // Relay, but its eventual transition is not necessarily the one this
        // caller requested. In particular, reporting updater restart success
        // while a menu Quit owns the gate would later perform a plain exit and
        // silently discard the installed update's relaunch. Reject the
        // unowned request; the owner remains responsible for publishing any
        // actual stop failure, so this admission conflict adds no false log.
        return Err(user_error("relay_stop_failed"));
    }
    match stop_relay() {
        Ok(()) => {
            state.complete_exit_stop();
            transition();
            Ok(())
        }
        Err(error) => {
            // Tauri deliberately ignores ExitRequestApi::prevent_exit for its
            // special restart exit code. Stop Relay before setting that flag;
            // otherwise an updater relaunch can leave the old sidecar alive
            // and immediately start a conflicting new application instance.
            state.cancel_exit_stop();
            publish_failure(&error);
            Err(error)
        }
    }
}

fn defer_interactive_exit_stop_with_hooks(
    state: &AppState,
    prevent_exit: impl FnOnce(),
    dispatch: impl FnOnce(Box<dyn FnOnce() + Send>),
    stop_relay: impl FnOnce() -> Result<(), String> + Send + 'static,
    resume_exit: impl FnOnce() + Send + 'static,
    publish_failure: impl FnOnce(String) + Send + 'static,
) {
    // This helper is called only for code=None interactive OS Quit. The
    // programmatic follow-up app.exit/request_restart enters the code=Some
    // branch in run(). If another interactive Quit arrives after an updater or
    // menu transition committed, prevent it from replacing that chosen exit
    // mode while the native transition is still pending.
    prevent_exit();
    if state.exit_stop_ready() {
        return;
    }

    // ExitRequestApi must be answered synchronously, but sidecar termination
    // can wait for a Starting generation or a slow process kill. Cancel this
    // first request immediately and move that blocking work off the event loop
    // so NSMenu, AX and window recovery remain responsive while Quit proceeds.
    if !state.begin_exit_stop() {
        // A rapid second Cmd-Q shares the first worker. It is prevented too,
        // and the existing worker will issue the single follow-up exit.
        return;
    }

    let state = state.clone();
    dispatch(Box::new(move || match stop_relay() {
        Ok(()) => {
            state.complete_exit_stop();
            resume_exit();
        }
        Err(error) => {
            // The next user Quit must be able to retry the retained PID. Clear
            // the in-flight gate before publishing the stable failure.
            state.cancel_exit_stop();
            publish_failure(error);
        }
    }));
}

fn defer_interactive_exit_stop<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
    api: &ExitRequestApi,
) {
    let stop_state = state.clone();
    let resume_app = app.clone();
    let failure_app = app.clone();
    let failure_state = state.clone();
    defer_interactive_exit_stop_with_hooks(
        state,
        || api.prevent_exit(),
        |action| defer_native_entry(action),
        move || relay::stop_for_exit(&stop_state),
        move || resume_app.exit(0),
        move |error| publish_native_action_error(&failure_app, &failure_state, error),
    );
}

mod safe_process_plugin {
    use super::{process_transition_with_hooks, publish_native_action_error, relay, AppState};
    use tauri::{plugin::TauriPlugin, AppHandle, State, Wry};

    #[tauri::command(async)]
    fn exit(app: AppHandle, state: State<'_, AppState>, code: i32) -> Result<(), String> {
        process_transition_with_hooks(
            &state,
            || relay::stop_for_exit(&state),
            || app.exit(code),
            |error| publish_native_action_error(&app, &state, error),
        )
    }

    #[tauri::command(async)]
    fn restart(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
        process_transition_with_hooks(
            &state,
            || relay::stop_for_exit(&state),
            || app.request_restart(),
            |error| publish_native_action_error(&app, &state, error),
        )
    }

    pub fn init() -> TauriPlugin<Wry> {
        // Keep the official plugin name and command surface so the existing
        // @tauri-apps/plugin-process client and `process:allow-restart` ACL
        // continue to work, while admitting restart only after sidecar stop.
        tauri::plugin::Builder::new("process")
            .invoke_handler(tauri::generate_handler![exit, restart])
            .build()
    }
}

#[cfg(target_os = "macos")]
fn configure_menu_bar_app(app: &AppHandle) -> tauri::Result<()> {
    app.set_activation_policy(tauri::ActivationPolicy::Accessory)
}

#[cfg(not(target_os = "macos"))]
fn configure_menu_bar_app(_app: &AppHandle) -> tauri::Result<()> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn configure_windowed_recovery_app<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    app.set_activation_policy(tauri::ActivationPolicy::Regular)
}

#[cfg(not(target_os = "macos"))]
fn configure_windowed_recovery_app<R: Runtime>(_app: &AppHandle<R>) -> tauri::Result<()> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn macos_windowed_recovery_policy_is_active() -> bool {
    let Some(main_thread) = MainThreadMarker::new() else {
        return false;
    };
    NSApplication::sharedApplication(main_thread).activationPolicy()
        == NSApplicationActivationPolicy::Regular
}

#[cfg(target_os = "macos")]
fn schedule_windowed_recovery_confirmation<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
) -> tauri::Result<()> {
    let app_handle = app.clone();
    let state = state.clone();
    // AppHandle::set_activation_policy only queues a runtime message. Queue
    // this readback after it on the same event loop, so close-to-background is
    // enabled only after AppKit exposes an actual Regular Dock/Cmd-Tab route.
    app.run_on_main_thread(move || {
        let app_for_error = app_handle.clone();
        let state_for_error = state.clone();
        record_windowed_recovery_policy_confirmation(
            &state,
            macos_windowed_recovery_policy_is_active(),
            move || {
                defer_native_entry(move || {
                    publish_native_action_error(
                        &app_for_error,
                        &state_for_error,
                        user_error("startup_failed"),
                    );
                });
            },
        );
    })
}

#[cfg(target_os = "macos")]
fn schedule_runtime_windowed_recovery_confirmation<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
) -> tauri::Result<()> {
    let state = state.clone();
    // Close/native-entry recovery already publishes one stable window_failed
    // after requesting this fallback. The later AppKit policy readback should
    // update admission only; emitting startup_failed here would overtake that
    // actionable failure in the diagnostics snapshot of an already-running
    // app and misdescribe it as a cold-start problem.
    app.run_on_main_thread(move || {
        record_windowed_recovery_policy_confirmation(
            &state,
            macos_windowed_recovery_policy_is_active(),
            || {},
        );
    })
}

#[cfg(not(target_os = "macos"))]
fn schedule_runtime_windowed_recovery_confirmation<R: Runtime>(
    _app: &AppHandle<R>,
    state: &AppState,
) -> tauri::Result<()> {
    record_windowed_recovery_policy_confirmation(state, true, || {});
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn schedule_windowed_recovery_confirmation<R: Runtime>(
    _app: &AppHandle<R>,
    state: &AppState,
) -> tauri::Result<()> {
    record_windowed_recovery_policy_confirmation(state, true, || {});
    Ok(())
}

fn record_windowed_recovery_policy_confirmation(
    state: &AppState,
    confirmed: bool,
    report_error: impl FnOnce(),
) {
    // A delayed Regular-policy readback can race a successful native-menu AX
    // retry. Do not erase that independently proven recovery surface merely
    // because the no-longer-needed Dock fallback was rejected. The admission
    // bit is safe to retain: every close revalidates the concrete status item
    // and current activation policy before and after hiding.
    let recovery_available = state.merge_window_hide_recovery_available(confirmed);
    if !recovery_available {
        // The last window must remain visible when both native recovery routes
        // are absent. Publish the stable startup failure so an already-loaded
        // diagnostics surface observes why close-to-background was refused.
        report_error();
    }
}

fn record_native_surface_setup_result<E>(state: &AppState, result: Result<(), E>) -> bool {
    if result.is_ok() {
        true
    } else {
        // Native-shell setup errors are intentionally collapsed to an allowed,
        // parameter-free code. Never expose AppKit/backend details in logs.
        state.log(model::LogLevel::Error, user_error("startup_failed"));
        false
    }
}

fn record_native_menu_visibility_result(
    state: &AppState,
    setup_succeeded: bool,
    status_item_visible: bool,
) -> bool {
    let available = setup_succeeded && status_item_visible;
    if setup_succeeded && !status_item_visible {
        // Building the Tauri tray object does not prove that AppKit exposed an
        // actual NSStatusItem. In particular, a background Accessory launch
        // must not remain hidden when its only promised recovery surface is an
        // invisible status item. Collapse the native detail to the stable
        // startup diagnostic and let setup request the Regular/window fallback.
        state.log(model::LogLevel::Error, user_error("startup_failed"));
    }
    available
}

fn has_window_hide_recovery_surface(
    native_menu_available: bool,
    windowed_recovery_available: bool,
) -> bool {
    native_menu_available || windowed_recovery_available
}

#[cfg(any(target_os = "macos", test))]
fn validated_window_hide_recovery_surface(
    setup_admitted: bool,
    status_item_visible: bool,
    regular_policy_active: bool,
) -> bool {
    setup_admitted && (status_item_visible || regular_policy_active)
}

#[cfg(target_os = "macos")]
fn macos_status_item_is_visible<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(tray) = app.tray_by_id("agent-relay-tray") else {
        return false;
    };
    tray.with_inner_tray_icon(|tray_icon| {
        let Some(main_thread) = MainThreadMarker::new() else {
            return false;
        };
        tray_icon.ns_status_item().is_some_and(|status_item| {
            status_item.isVisible() && status_item.button(main_thread).is_some()
        })
    })
    .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn window_hide_recovery_surface_is_active<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
) -> bool {
    validated_window_hide_recovery_surface(
        state.window_hide_recovery_available(),
        macos_status_item_is_visible(app),
        macos_windowed_recovery_policy_is_active(),
    )
}

#[cfg(not(target_os = "macos"))]
fn window_hide_recovery_surface_is_active<R: Runtime>(
    _app: &AppHandle<R>,
    state: &AppState,
) -> bool {
    state.window_hide_recovery_available()
}

pub fn run() {
    let background_launch = std::env::args().any(|argument| argument == "--background");
    let app = tauri::Builder::default()
        // Must be registered first so a second process cannot initialize its
        // own tray, credential access, or Relay sidecar before being rejected.
        .plugin(tauri_plugin_single_instance::init(
            |app, arguments, _working_directory| {
                if should_activate_existing_instance(&arguments) {
                    let app = app.clone();
                    defer_native_entry(move || restore_window_from_native_entry(&app));
                }
            },
        ))
        .plugin(safe_process_plugin::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .setup(move |app| {
            relay_diagnostics::record(app.handle(), "desktop_started", 0, None, None, None);
            let (config, startup_error) = match config::load_or_create(app.handle()) {
                Ok(config) => (config, None),
                Err(error) => (
                    config::default_config(app.handle()).map_err(std::io::Error::other)?,
                    Some(error),
                ),
            };
            let config_access_failed = startup_error.is_some();
            let vault_startup_error = secrets::initialize(app.handle()).err();
            // Read the encrypted vault once during startup. Thereafter the
            // native tray uses non-secret enrollment state updated
            // transactionally by pairing/logout commands, so Relay
            // publications never decrypt the vault.
            let (startup_presence, credential_startup_error) = if config_access_failed {
                // The fallback has a random temporary identity and cannot
                // describe the user's durable authorization. Avoid a pointless
                // vault access until config retry has recovered the real
                // device ID.
                (SecretPresence::default(), None)
            } else if let Some(error) = vault_startup_error {
                (SecretPresence::default(), Some(error))
            } else {
                match secrets::presence_for_browsers(&config.device_id, &config.browser_ids) {
                    Ok(presence) => (presence, None),
                    Err(error) => (SecretPresence::default(), Some(error)),
                }
            };
            let startup_presentation = startup_native_presentation(
                &config,
                &startup_presence,
                credential_startup_error.is_some(),
                config_access_failed,
            );
            let state = AppState::new(config, startup_presentation.connection_available);
            state.set_recovery_required(startup_presentation.recovery_required);
            for error in [startup_error, credential_startup_error]
                .into_iter()
                .flatten()
            {
                state.log(model::LogLevel::Error, error);
            }
            app.manage(state.clone());
            app.manage(keep_awake::KeepAwake::start(app.handle()));
            performance_diagnostics::start(app.handle().clone(), state.clone());
            // Accessory is best-effort: failing to hide the Dock must not abort
            // an otherwise usable desktop session.
            let _ =
                record_native_surface_setup_result(&state, configure_menu_bar_app(app.handle()));
            let (native_menu_created, initial_accessibility_ready) =
                match setup_tray(app, &state, startup_presentation.phase) {
                    Ok(accessibility_ready) => (true, accessibility_ready),
                    Err(error) => (
                        record_native_surface_setup_result(&state, Err(error)),
                        false,
                    ),
                };
            #[cfg(target_os = "macos")]
            let native_menu_visible =
                native_menu_created && macos_status_item_is_visible(app.handle());
            #[cfg(not(target_os = "macos"))]
            let native_menu_visible = native_menu_created;
            let native_menu_visible = record_native_menu_visibility_result(
                &state,
                native_menu_created,
                native_menu_visible,
            );
            let native_menu_available =
                native_menu_recovery_available(native_menu_visible, initial_accessibility_ready);
            let windowed_recovery_requested = if !native_menu_available {
                // Accessory without a visible and initially accessible status
                // item is not a recovery surface for every user. Request a
                // normal Dock/Cmd-Tab identity before forcing the one remaining
                // recovery surface to the foreground. The request is async and
                // does not count until a main-thread readback confirms Regular.
                record_native_surface_setup_result(
                    &state,
                    configure_windowed_recovery_app(app.handle()),
                )
            } else {
                false
            };
            state.set_window_hide_recovery_available(has_window_hide_recovery_surface(
                native_menu_available,
                false,
            ));
            if windowed_recovery_requested {
                let _ = record_native_surface_setup_result(
                    &state,
                    schedule_windowed_recovery_confirmation(app.handle(), &state),
                );
            }

            if native_menu_available {
                let handle = app.handle().clone();
                let agent_state = state.clone();
                thread::spawn(move || loop {
                    inspect_tray_agents(&agent_state);
                    // Do not rely on WebView timers, which can pause when hidden.
                    thread::sleep(Duration::from_secs(60));
                    if handle.tray_by_id("agent-relay-tray").is_none() { break; }
                });
            }
            let behavior =
                startup_behavior(background_launch, &startup_presence, native_menu_available);
            let interactive_restore_pending =
                take_pending_native_restore(&PRE_SETUP_NATIVE_RESTORE_PENDING);
            if behavior.show_main_window || interactive_restore_pending {
                record_startup_window_restore_result(&state, show_window(app.handle()));
            }
            if behavior.start_relay {
                let app_handle = app.handle().clone();
                let state_handle = state.clone();
                tauri::async_runtime::spawn(async move {
                    // relay::start owns every admitted failure transition and
                    // native/Web publication. Re-logging here used to duplicate
                    // diagnostics. Admission conflicts belong to Stop/Quit and
                    // must not overwrite their presentation from this startup
                    // task.
                    if state_handle.is_paired() {
                        let _ = relay::start(&app_handle, &state_handle).await;
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.emit("desktop-window-hidden", ());
                    hide_main_window(window);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_bootstrap,
            feedback_request,
            get_exit_diagnostic_report,
            get_relay_snapshot,
            validate_config,
            get_agent_availability,
            install_agent,
            open_agent_login,
            start_relay,
            stop_relay,
            logout,
            probe_instance,
            switch_instance,
            save_settings,
            clear_secret,
            set_launch_at_login,
            get_keep_awake_status,
            set_prevent_automatic_lock,
            select_workspace,
            open_relay_web,
            open_public_page,
            open_pairing_page,
            open_desktop_login_page,
            complete_desktop_login,
            abandon_desktop_login,
            request_workspace_access,
            open_file_access_settings,
            retry_file_access,
            complete_pairing,
            start_browser_pairing,
            cancel_browser_pairing,
            list_browser_authorizations,
            revoke_browser_authorization,
            complete_browser_pairing,
            show_main_window,
            set_ui_language,
            set_update_available,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Relayune desktop application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if matches!(event, RunEvent::Reopen { .. }) {
            let app = app_handle.clone();
            defer_native_entry(move || restore_window_from_native_entry(&app));
        }
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = &event {
            if urls.iter().any(is_desktop_login_return_url) {
                let app = app_handle.clone();
                defer_native_entry(move || restore_window_from_native_entry(&app));
            }
        }
        match event {
            RunEvent::ExitRequested { code, api, .. } => {
                relay_diagnostics::record(app_handle, "desktop_exit_requested", 0, None, code, None);
                if let Some(state) = app_handle.try_state::<AppState>() {
                    if code.is_none() {
                        defer_interactive_exit_stop(app_handle, &state, &api);
                    } else if !state.exit_stop_ready() {
                        // Programmatic exit/restart commands already stop Relay
                        // before reaching this event. Retain the fail-closed
                        // guard for any future caller that bypasses that API.
                        if let Err(error) = relay::stop_for_exit(&state) {
                            api.prevent_exit();
                            let app = app_handle.clone();
                            let state = state.inner().clone();
                            defer_native_entry(move || {
                                publish_native_action_error(&app, &state, error)
                            });
                        }
                    }
                }
            }
            RunEvent::Exit => {
                if let Some(power) = app_handle.try_state::<keep_awake::KeepAwake>() {
                    power.stop();
                }
                relay_diagnostics::record(app_handle, "desktop_exited", 0, None, None, None);
                if let Some(state) = app_handle.try_state::<AppState>() {
                    let _ = relay::stop_for_exit(&state);
                }
            }
            _ => {}
        }
    });
}

#[cfg(test)]
mod tray_tests {
    use super::{tray_agent_text, tray_menu_status};
    #[cfg(not(target_os = "windows"))]
    use super::set_non_windows_launch_at_login_with_hooks;
    use super::{
        defer_interactive_exit_stop_with_hooks, defer_native_entry, handle_tray_menu_event,
        has_window_hide_recovery_surface, hide_main_window_with_hook,
        initialize_tray_presentation_with_hook, launch_at_login_or_diagnostic, lock_tray_items,
        public_page_destination_url, native_menu_recovery_available, process_transition_with_hooks,
        publish_native_action_error_with_hook, publish_native_action_error_with_refresh_hooks,
        publish_relay_snapshot_with_hooks, publish_relay_snapshot_with_retry_hooks,
        reconcile_bootstrap_native_presentation, reconcile_cleared_secret_native_presentation,
        reconcile_durable_config_native_presentation, reconcile_known_credential_presence,
        reconcile_pairing_rollback_native_presentation, record_initial_tray_accessibility_result,
        record_native_menu_accessibility_refresh_result, record_native_menu_visibility_result,
        record_native_surface_setup_result, record_native_window_action_dispatch_result,
        record_startup_window_restore_result, record_window_hide_result,
        record_windowed_recovery_policy_confirmation, request_pending_native_restore_with_hook,
        restore_window_after_recovery_surface_loss_with_hooks, restore_window_from_native_entry,
        restore_window_from_native_entry_with_hooks, restore_window_with_hooks,
        schedule_native_entry_recovery_check_with_hooks, set_ui_language_with_refresh_and_save,
        set_update_available_with_refresh, should_activate_existing_instance, show_window,
        startup_behavior, startup_native_presentation, take_pending_native_restore,
        tray_accessibility_help, tray_accessibility_label, tray_connection_available,
        tray_not_connected_accessibility_label, tray_not_connected_status_text,
        tray_not_connected_tooltip, tray_phase_label, tray_presentation_accessibility_label,
        tray_presentation_phase, tray_presentation_tooltip, tray_status_text, tray_tooltip,
        tray_update_action_text, tray_web_action_text, tray_web_workspace_available,
        tray_window_action_text, validated_window_hide_recovery_surface, windows_autostart_command,
        windows_autostart_state_is_committed, StartupBehavior, TrayCopy,
    };
    use crate::{
        model::{
            user_error, RelayAdapter, RelayConfig, RelayPhase, RelayProvider, RelaySnapshot,
            SecretPresence, UiLanguage,
        },
        state::AppState,
    };
    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    };
    use std::{thread, time::Duration};
    use tauri::{Emitter, Listener, Manager, WebviewWindowBuilder};

    fn runtime_probe_config(server_url: &str) -> RelayConfig {
        RelayConfig {
            server_url: server_url.into(),
            device_id: "dev_menu_runtime_probe".into(),
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
        }
    }

    #[tauri::command(async)]
    fn native_presentation_ipc_probe(
        state: tauri::State<'_, AppState>,
        available: bool,
    ) -> Result<(), String> {
        set_update_available_with_refresh(&state, available, || Err(user_error("language_failed")))
    }

    #[test]
    fn tray_agent_states_distinguish_setup_and_recovery() {
        use crate::model::AgentRuntimeStatus::*;
        for (status, expected) in [(None, "检查中"), (Some(Ready), "可用"), (Some(NotInstalled), "未安装"), (Some(NotLoggedIn), "待登录"), (Some(Outdated), "需要更新"), (Some(Broken), "需要修复")] {
            assert_eq!(tray_agent_text(UiLanguage::SimplifiedChinese, RelayProvider::Claude, status.as_ref()), format!("Claude Code · {expected}"));
        }
        assert_eq!(tray_menu_status(UiLanguage::SimplifiedChinese, &RelayPhase::Connected), "已连接");
    }

    #[test]
    fn unreadable_vault_keeps_a_known_device_on_the_recovery_path() {
        let mut known_device = runtime_probe_config("https://relayune.giraffetree.cn");
        known_device.browser_ids = vec!["web_0123456789abcdef0123456789abcdef".into()];
        let locked =
            startup_native_presentation(&known_device, &SecretPresence::default(), true, false);
        assert!(locked.connection_available);
        assert!(locked.recovery_required);
        assert!(matches!(locked.phase, RelayPhase::Error));
        let known_state = AppState::new(known_device.clone(), locked.connection_available);
        known_state.set_recovery_required(locked.recovery_required);
        assert!(tray_connection_available(&known_state));
        assert!(tray_web_workspace_available(&known_state));

        let unreadable_legacy_credentials = startup_native_presentation(
            &runtime_probe_config("https://relayune.giraffetree.cn"),
            &SecretPresence::default(),
            true,
            false,
        );
        assert!(!unreadable_legacy_credentials.connection_available);
        assert!(unreadable_legacy_credentials.recovery_required);
        assert!(matches!(
            unreadable_legacy_credentials.phase,
            RelayPhase::Error
        ));

        let recovery_state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            unreadable_legacy_credentials.connection_available,
        );
        recovery_state.set_recovery_required(unreadable_legacy_credentials.recovery_required);
        assert!(tray_connection_available(&recovery_state));
        assert!(!tray_web_workspace_available(&recovery_state));
        assert_eq!(
            tray_window_action_text(
                UiLanguage::English,
                tray_connection_available(&recovery_state)
            ),
            "Show Relayune"
        );
        for runtime_phase in [
            RelayPhase::Stopped,
            RelayPhase::Starting,
            RelayPhase::Connected,
            RelayPhase::Stopping,
            RelayPhase::Error,
        ] {
            let presentation_phase =
                tray_presentation_phase(recovery_state.recovery_required(), &runtime_phase);
            assert!(matches!(presentation_phase, RelayPhase::Error));
            assert_eq!(
                tray_status_text(UiLanguage::English, &presentation_phase),
                "Status: Needs attention"
            );
            assert_eq!(
                tray_presentation_tooltip(
                    UiLanguage::SimplifiedChinese,
                    &presentation_phase,
                    true,
                    false,
                ),
                "Relayune · 需要处理"
            );
            assert_eq!(
                tray_presentation_accessibility_label(
                    UiLanguage::English,
                    &presentation_phase,
                    true,
                    false,
                ),
                "Relayune, Needs attention"
            );
        }
        assert!(matches!(
            tray_presentation_phase(false, &RelayPhase::Stopped),
            RelayPhase::Stopped
        ));

        let actual_first_launch = startup_native_presentation(
            &runtime_probe_config("https://relayune.giraffetree.cn"),
            &SecretPresence::default(),
            false,
            false,
        );
        assert!(!actual_first_launch.connection_available);
        assert!(!actual_first_launch.recovery_required);
        assert!(matches!(actual_first_launch.phase, RelayPhase::Stopped));

        let available = startup_native_presentation(
            &known_device,
            &SecretPresence {
                device_token: true,
                e2ee_key: true,
            },
            false,
            false,
        );
        assert!(available.connection_available);
        assert!(!available.recovery_required);
        assert!(matches!(available.phase, RelayPhase::Stopped));
    }

    #[test]
    fn bootstrap_secure_store_commit_is_atomic_with_native_publication() {
        let mut fallback_config = runtime_probe_config("https://relayune.giraffetree.cn");
        fallback_config.ui_language = Some("zh-CN".into());
        let state = AppState::new(fallback_config, true);
        state.set_recovery_required(true);
        let mut recovered_config = state.config();
        recovered_config.ui_language = Some("en".into());
        let request_generation = state.begin_bootstrap_request();
        let commit_state = state.clone();
        let (commit_entered_tx, commit_entered_rx) = mpsc::channel();
        let (release_commit_tx, release_commit_rx) = mpsc::channel();
        let (commit_result_tx, commit_result_rx) = mpsc::channel();
        thread::spawn(move || {
            let result = reconcile_bootstrap_native_presentation(
                &commit_state,
                request_generation,
                recovered_config,
                Some(false),
                || {
                    commit_entered_tx
                        .send(())
                        .expect("record bootstrap native refresh");
                    release_commit_rx
                        .recv()
                        .expect("release bootstrap native refresh");
                    Ok(())
                },
            );
            let _ = commit_result_tx.send(result);
        });

        commit_entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("bootstrap native commit did not reach refresh");
        assert!(!state.is_paired());
        assert!(!state.recovery_required());
        assert_eq!(state.ui_language(), UiLanguage::English);
        assert_eq!(state.config().ui_language.as_deref(), Some("en"));

        let publish_state = state.clone();
        let (publish_refresh_tx, publish_refresh_rx) = mpsc::channel();
        let (publish_result_tx, publish_result_rx) = mpsc::channel();
        thread::spawn(move || {
            let result = publish_relay_snapshot_with_hooks(
                &publish_state,
                |_| {
                    publish_refresh_tx
                        .send((
                            publish_state.ui_language(),
                            publish_state.config().ui_language,
                            tray_connection_available(&publish_state),
                            tray_web_workspace_available(&publish_state),
                        ))
                        .expect("record post-bootstrap native state");
                    Ok(())
                },
                |_| {},
            );
            let _ = publish_result_tx.send(result);
        });

        assert!(matches!(
            publish_refresh_rx.recv_timeout(Duration::from_millis(100)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        release_commit_tx
            .send(())
            .expect("release atomic bootstrap native commit");
        assert_eq!(
            publish_refresh_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("Relay publication did not resume"),
            (UiLanguage::English, Some("en".into()), false, false),
            "the native menu must observe only the fully committed language and NoEntry state"
        );
        commit_result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("bootstrap native commit deadlocked")
            .expect("bootstrap native commit should succeed");
        publish_result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("post-bootstrap publication deadlocked")
            .expect("post-bootstrap publication should succeed");
    }

    #[test]
    fn settings_device_change_commit_is_atomic_with_native_publication() {
        let mut old_config = runtime_probe_config("https://relayune.giraffetree.cn");
        old_config.device_id = "dev_old0123456789abcdef0123456789".into();
        old_config.browser_ids = vec!["web_0123456789abcdef0123456789abcdef".into()];
        let state = AppState::new(old_config, true);
        let mut next_config = state.config();
        next_config.device_id = "dev_new0123456789abcdef0123456789".into();
        next_config.browser_ids.clear();

        let commit_state = state.clone();
        let (commit_entered_tx, commit_entered_rx) = mpsc::channel();
        let (release_commit_tx, release_commit_rx) = mpsc::channel();
        let (commit_result_tx, commit_result_rx) = mpsc::channel();
        thread::spawn(move || {
            let result = reconcile_durable_config_native_presentation(
                &commit_state,
                &next_config,
                false,
                || {
                    commit_entered_tx
                        .send(())
                        .expect("record settings native refresh");
                    release_commit_rx
                        .recv()
                        .expect("release settings native refresh");
                    Ok(())
                },
            );
            let _ = commit_result_tx.send(result);
        });

        commit_entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("settings native commit did not reach refresh");
        assert_eq!(
            state.config().device_id,
            "dev_new0123456789abcdef0123456789"
        );
        assert!(!state.is_paired());

        let publish_state = state.clone();
        let (publish_refresh_tx, publish_refresh_rx) = mpsc::channel();
        let (publish_result_tx, publish_result_rx) = mpsc::channel();
        thread::spawn(move || {
            let result = publish_relay_snapshot_with_hooks(
                &publish_state,
                |_| {
                    publish_refresh_tx
                        .send((
                            publish_state.config().device_id,
                            publish_state.is_paired(),
                            tray_connection_available(&publish_state),
                            tray_web_workspace_available(&publish_state),
                        ))
                        .expect("record post-settings native state");
                    Ok(())
                },
                |_| {},
            );
            let _ = publish_result_tx.send(result);
        });

        assert!(matches!(
            publish_refresh_rx.recv_timeout(Duration::from_millis(100)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        release_commit_tx
            .send(())
            .expect("release atomic settings native commit");
        assert_eq!(
            publish_refresh_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("Relay publication did not resume"),
            (
                "dev_new0123456789abcdef0123456789".into(),
                false,
                false,
                false,
            ),
            "native actions must observe only the new unpaired device identity"
        );
        commit_result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("settings native commit deadlocked")
            .expect("settings native commit should succeed");
        publish_result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("post-settings publication deadlocked")
            .expect("post-settings publication should succeed");
    }

    #[test]
    fn bootstrap_config_recovery_restores_native_language_while_credentials_remain_unreadable() {
        let mut fallback_config = runtime_probe_config("https://relayune.giraffetree.cn");
        fallback_config.ui_language = Some("zh-CN".into());
        let state = AppState::new(fallback_config, true);
        state.set_recovery_required(true);
        let mut recovered_config = state.config();
        recovered_config.ui_language = Some("en".into());
        let mut refresh_count = 0;
        let request_generation = state.begin_bootstrap_request();

        reconcile_bootstrap_native_presentation(
            &state,
            request_generation,
            recovered_config,
            None,
            || {
                refresh_count += 1;
                assert_eq!(state.ui_language(), UiLanguage::English);
                assert_eq!(state.config().ui_language.as_deref(), Some("en"));
                let copy = TrayCopy::for_language(state.ui_language());
                assert_eq!(copy.diagnostics, "Help & Diagnostics…");
                assert_eq!(copy.quit, "Quit Relayune");
                assert!(state.is_paired());
                assert!(state.recovery_required());
                assert!(matches!(
                    tray_presentation_phase(state.recovery_required(), &state.snapshot().phase,),
                    RelayPhase::Error
                ));
                Ok(())
            },
        )
        .expect("durable locale recovery should refresh the recovery menu");

        assert_eq!(refresh_count, 1);
        assert!(tray_connection_available(&state));
        assert!(tray_web_workspace_available(&state));
    }

    #[test]
    fn bootstrap_no_entry_commit_survives_repeated_native_refresh_failure() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            true,
        );
        state.set_recovery_required(true);
        let mut refresh_count = 0;
        let request_generation = state.begin_bootstrap_request();

        let result = reconcile_bootstrap_native_presentation(
            &state,
            request_generation,
            state.config(),
            Some(false),
            || {
                refresh_count += 1;
                Err(user_error("language_failed"))
            },
        );

        assert_eq!(result, Err(user_error("language_failed")));
        assert_eq!(refresh_count, 2);
        assert!(!state.is_paired());
        assert!(!state.recovery_required());
        assert!(!tray_connection_available(&state));
        assert!(!tray_web_workspace_available(&state));
        assert_eq!(
            state
                .snapshot()
                .logs
                .last()
                .expect("the Bootstrap must expose the native refresh failure")
                .message,
            user_error("language_failed")
        );
    }

    #[test]
    fn stale_bootstrap_completion_cannot_overwrite_the_latest_native_presentation() {
        let mut old_config = runtime_probe_config("https://old.example.invalid");
        old_config.ui_language = Some("zh-CN".into());
        let state = AppState::new(old_config.clone(), false);
        state.set_recovery_required(true);

        // Simulate an earlier request blocked in config / secure-store I/O.
        // Its generation exists, but it owns no global request mutex.
        let old_generation = state.begin_bootstrap_request();
        let old_state = state.clone();
        let old_refresh_count = Arc::new(AtomicUsize::new(0));
        let old_refresh_count_for_thread = old_refresh_count.clone();
        let (old_read_started_tx, old_read_started_rx) = mpsc::channel();
        let (release_old_read_tx, release_old_read_rx) = mpsc::channel();
        let (old_result_tx, old_result_rx) = mpsc::channel();
        thread::spawn(move || {
            old_read_started_tx
                .send(())
                .expect("record blocked old bootstrap read");
            release_old_read_rx
                .recv()
                .expect("release old bootstrap read");
            let result = reconcile_bootstrap_native_presentation(
                &old_state,
                old_generation,
                old_config,
                Some(true),
                || {
                    old_refresh_count_for_thread.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                },
            );
            let _ = old_result_tx.send(result);
        });
        old_read_started_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("old bootstrap did not reach its blocked read");

        let mut latest_config = state.config();
        latest_config.server_url = "https://latest.example.invalid".into();
        latest_config.ui_language = Some("en".into());
        let latest_generation = state.begin_bootstrap_request();
        let latest_state = state.clone();
        let latest_refresh_count = Arc::new(AtomicUsize::new(0));
        let latest_refresh_count_for_thread = latest_refresh_count.clone();
        let (latest_result_tx, latest_result_rx) = mpsc::channel();
        thread::spawn(move || {
            let result = reconcile_bootstrap_native_presentation(
                &latest_state,
                latest_generation,
                latest_config,
                None,
                || {
                    latest_refresh_count_for_thread.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                },
            );
            let _ = latest_result_tx.send(result);
        });

        latest_result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("latest bootstrap was serialized behind the blocked old read")
            .expect("latest bootstrap native commit should succeed");
        assert_eq!(latest_refresh_count.load(Ordering::SeqCst), 1);

        release_old_read_tx
            .send(())
            .expect("release stale bootstrap completion");
        old_result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("stale bootstrap completion deadlocked")
            .expect("a stale bootstrap may return without committing");

        assert_eq!(old_refresh_count.load(Ordering::SeqCst), 0);
        assert_eq!(state.config().server_url, "https://latest.example.invalid");
        assert_eq!(state.config().ui_language.as_deref(), Some("en"));
        assert_eq!(state.ui_language(), UiLanguage::English);
        assert!(!state.is_paired());
        assert!(state.recovery_required());
    }

    #[test]
    fn failed_pairing_rollback_invalidates_a_temporary_paired_bootstrap() {
        let mut old_config = runtime_probe_config("https://old.example.invalid");
        old_config.start_relay_on_launch = false;
        let mut temporary_config = old_config.clone();
        temporary_config.server_url = "https://temporary-pairing.example.invalid".into();
        temporary_config.device_id = "dev_0123456789abcdef0123456789abcdef".into();
        temporary_config.browser_ids = vec!["web_0123456789abcdef0123456789abcdef".into()];
        let state = AppState::new(temporary_config.clone(), true);

        // The failed pairing's temporary config and credential presence were
        // already loaded, but the bootstrap has not yet reached native commit.
        let stale_generation = state.begin_bootstrap_request();
        let stale_state = state.clone();
        let stale_refreshes = Arc::new(AtomicUsize::new(0));
        let stale_refreshes_for_thread = stale_refreshes.clone();
        let (temporary_loaded_tx, temporary_loaded_rx) = mpsc::channel();
        let (release_stale_tx, release_stale_rx) = mpsc::channel();
        let (stale_result_tx, stale_result_rx) = mpsc::channel();
        thread::spawn(move || {
            temporary_loaded_tx
                .send(())
                .expect("record temporary paired bootstrap");
            release_stale_rx
                .recv()
                .expect("release temporary paired bootstrap");
            let result = reconcile_bootstrap_native_presentation(
                &stale_state,
                stale_generation,
                temporary_config,
                Some(true),
                || {
                    stale_refreshes_for_thread.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                },
            );
            let _ = stale_result_tx.send(result);
        });
        temporary_loaded_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("temporary pairing bootstrap did not load");

        let mut rollback_refreshes = 0;
        reconcile_pairing_rollback_native_presentation(&state, &old_config, false, || {
            rollback_refreshes += 1;
            assert_eq!(state.config().server_url, "https://old.example.invalid");
            assert!(!state.is_paired());
            assert!(!tray_connection_available(&state));
            assert!(!tray_web_workspace_available(&state));
            Ok(())
        })
        .expect("durable pairing rollback should restore the old native presentation");

        release_stale_tx
            .send(())
            .expect("release stale temporary pairing bootstrap");
        stale_result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("temporary pairing bootstrap deadlocked")
            .expect("stale temporary bootstrap may return without committing");

        assert_eq!(rollback_refreshes, 1);
        assert_eq!(stale_refreshes.load(Ordering::SeqCst), 0);
        assert_eq!(state.config().server_url, "https://old.example.invalid");
        assert!(state.config().browser_ids.is_empty());
        assert!(!state.is_paired());
    }

    #[test]
    fn successful_pairing_commit_invalidates_a_loaded_unpaired_bootstrap() {
        let old_config = runtime_probe_config("https://unpaired.example.invalid");
        let mut paired_config = old_config.clone();
        paired_config.server_url = "https://paired.example.invalid".into();
        paired_config.device_id = "dev_abcdef0123456789abcdef0123456789".into();
        paired_config.browser_ids = vec!["web_0123456789abcdef0123456789abcdef".into()];
        let state = AppState::new(old_config.clone(), false);

        // Web has completed PAKE and the durable config is about to commit,
        // while an older bootstrap has already loaded the unpaired identity.
        let stale_generation = state.begin_bootstrap_request();
        let stale_state = state.clone();
        let stale_refreshes = Arc::new(AtomicUsize::new(0));
        let stale_refreshes_for_thread = stale_refreshes.clone();
        let (unpaired_loaded_tx, unpaired_loaded_rx) = mpsc::channel();
        let (release_stale_tx, release_stale_rx) = mpsc::channel();
        let (stale_result_tx, stale_result_rx) = mpsc::channel();
        thread::spawn(move || {
            unpaired_loaded_tx
                .send(())
                .expect("record loaded unpaired bootstrap");
            release_stale_rx
                .recv()
                .expect("release stale unpaired bootstrap");
            let result = reconcile_bootstrap_native_presentation(
                &stale_state,
                stale_generation,
                old_config,
                Some(false),
                || {
                    stale_refreshes_for_thread.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                },
            );
            let _ = stale_result_tx.send(result);
        });
        unpaired_loaded_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("unpaired bootstrap did not load");

        let mut pairing_refreshes = 0;
        reconcile_durable_config_native_presentation(&state, &paired_config, true, || {
            pairing_refreshes += 1;
            assert_eq!(state.config().server_url, "https://paired.example.invalid");
            assert_eq!(state.config().browser_ids.len(), 1);
            assert!(state.is_paired());
            assert!(tray_connection_available(&state));
            assert!(tray_web_workspace_available(&state));
            Ok(())
        })
        .expect("successful pairing should commit the paired presentation");

        release_stale_tx
            .send(())
            .expect("release stale unpaired bootstrap");
        stale_result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("stale unpaired bootstrap deadlocked")
            .expect("stale unpaired bootstrap may return without committing");

        assert_eq!(pairing_refreshes, 1);
        assert_eq!(stale_refreshes.load(Ordering::SeqCst), 0);
        assert_eq!(state.config().server_url, "https://paired.example.invalid");
        assert_eq!(state.config().browser_ids.len(), 1);
        assert!(state.is_paired());
    }

    #[test]
    fn failed_logout_rollback_invalidates_a_temporary_signed_out_bootstrap() {
        let mut signed_in_config = runtime_probe_config("https://signed-in.example.invalid");
        signed_in_config.browser_ids = vec!["web_0123456789abcdef0123456789abcdef".into()];
        let mut temporary_signed_out_config = signed_in_config.clone();
        temporary_signed_out_config.server_url = "https://signed-out.example.invalid".into();
        temporary_signed_out_config.device_id = "dev_abcdef0123456789abcdef0123456789".into();
        temporary_signed_out_config.browser_ids.clear();
        let state = AppState::new(signed_in_config.clone(), true);

        // Logout has durably staged its fresh signed-out identity and a
        // bootstrap has loaded it, but the remote revoke later fails and the
        // old signed-in config is durably restored before this request commits.
        let stale_generation = state.begin_bootstrap_request();
        let stale_state = state.clone();
        let stale_refreshes = Arc::new(AtomicUsize::new(0));
        let stale_refreshes_for_thread = stale_refreshes.clone();
        let (signed_out_loaded_tx, signed_out_loaded_rx) = mpsc::channel();
        let (release_stale_tx, release_stale_rx) = mpsc::channel();
        let (stale_result_tx, stale_result_rx) = mpsc::channel();
        thread::spawn(move || {
            signed_out_loaded_tx
                .send(())
                .expect("record temporary signed-out bootstrap");
            release_stale_rx
                .recv()
                .expect("release temporary signed-out bootstrap");
            let result = reconcile_bootstrap_native_presentation(
                &stale_state,
                stale_generation,
                temporary_signed_out_config,
                Some(false),
                || {
                    stale_refreshes_for_thread.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                },
            );
            let _ = stale_result_tx.send(result);
        });
        signed_out_loaded_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("temporary signed-out bootstrap did not load");

        let mut rollback_refreshes = 0;
        reconcile_durable_config_native_presentation(&state, &signed_in_config, true, || {
            rollback_refreshes += 1;
            assert_eq!(
                state.config().server_url,
                "https://signed-in.example.invalid"
            );
            assert!(state.is_paired());
            assert!(tray_connection_available(&state));
            assert!(tray_web_workspace_available(&state));
            Ok(())
        })
        .expect("failed logout rollback should restore signed-in native presentation");

        release_stale_tx
            .send(())
            .expect("release stale temporary signed-out bootstrap");
        stale_result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("temporary signed-out bootstrap deadlocked")
            .expect("stale signed-out bootstrap may return without committing");

        assert_eq!(rollback_refreshes, 1);
        assert_eq!(stale_refreshes.load(Ordering::SeqCst), 0);
        assert_eq!(
            state.config().server_url,
            "https://signed-in.example.invalid"
        );
        assert_eq!(state.config().browser_ids.len(), 1);
        assert!(state.is_paired());
    }

    #[test]
    fn successful_logout_commit_invalidates_a_loaded_signed_in_bootstrap() {
        let mut signed_in_config = runtime_probe_config("https://signed-in.example.invalid");
        signed_in_config.browser_ids = vec!["web_0123456789abcdef0123456789abcdef".into()];
        let mut signed_out_config = signed_in_config.clone();
        signed_out_config.server_url = "https://signed-out.example.invalid".into();
        signed_out_config.device_id = "dev_abcdef0123456789abcdef0123456789".into();
        signed_out_config.browser_ids.clear();
        let state = AppState::new(signed_in_config.clone(), true);

        // A bootstrap has already loaded the signed-in identity while logout
        // waits for the remote revoke. Once that revoke succeeds, the fresh
        // durable identity must invalidate this request before it can commit.
        let stale_generation = state.begin_bootstrap_request();
        let stale_state = state.clone();
        let stale_refreshes = Arc::new(AtomicUsize::new(0));
        let stale_refreshes_for_thread = stale_refreshes.clone();
        let (signed_in_loaded_tx, signed_in_loaded_rx) = mpsc::channel();
        let (release_stale_tx, release_stale_rx) = mpsc::channel();
        let (stale_result_tx, stale_result_rx) = mpsc::channel();
        thread::spawn(move || {
            signed_in_loaded_tx
                .send(())
                .expect("record loaded signed-in bootstrap");
            release_stale_rx
                .recv()
                .expect("release stale signed-in bootstrap");
            let result = reconcile_bootstrap_native_presentation(
                &stale_state,
                stale_generation,
                signed_in_config,
                Some(true),
                || {
                    stale_refreshes_for_thread.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                },
            );
            let _ = stale_result_tx.send(result);
        });
        signed_in_loaded_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("signed-in bootstrap did not load");

        let mut logout_refreshes = 0;
        reconcile_durable_config_native_presentation(&state, &signed_out_config, false, || {
            logout_refreshes += 1;
            assert_eq!(
                state.config().server_url,
                "https://signed-out.example.invalid"
            );
            assert!(state.config().browser_ids.is_empty());
            assert!(!state.is_paired());
            assert!(!tray_connection_available(&state));
            assert!(!tray_web_workspace_available(&state));
            Ok(())
        })
        .expect("successful logout should commit the signed-out presentation");

        release_stale_tx
            .send(())
            .expect("release stale signed-in bootstrap");
        stale_result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("stale signed-in bootstrap deadlocked")
            .expect("stale signed-in bootstrap may return without committing");

        assert_eq!(logout_refreshes, 1);
        assert_eq!(stale_refreshes.load(Ordering::SeqCst), 0);
        assert_eq!(
            state.config().server_url,
            "https://signed-out.example.invalid"
        );
        assert!(state.config().browser_ids.is_empty());
        assert!(!state.is_paired());
    }

    #[test]
    fn failed_browser_revoke_rollback_invalidates_a_temporary_empty_authorization_list() {
        let mut authorized_config = runtime_probe_config("https://authorized.example.invalid");
        authorized_config.browser_ids = vec!["web_0123456789abcdef0123456789abcdef".into()];
        let mut temporary_revoked_config = authorized_config.clone();
        temporary_revoked_config.browser_ids.clear();
        let state = AppState::new(authorized_config.clone(), true);

        // The durable file temporarily removed the last browser before the
        // remote revoke failed. A concurrent bootstrap loaded that NoEntry
        // view, but has not yet reached the native presentation transaction.
        let stale_generation = state.begin_bootstrap_request();
        let stale_state = state.clone();
        let stale_refreshes = Arc::new(AtomicUsize::new(0));
        let stale_refreshes_for_thread = stale_refreshes.clone();
        let (revoked_list_loaded_tx, revoked_list_loaded_rx) = mpsc::channel();
        let (release_stale_tx, release_stale_rx) = mpsc::channel();
        let (stale_result_tx, stale_result_rx) = mpsc::channel();
        thread::spawn(move || {
            revoked_list_loaded_tx
                .send(())
                .expect("record temporary empty authorization list");
            release_stale_rx
                .recv()
                .expect("release temporary empty authorization list");
            let result = reconcile_bootstrap_native_presentation(
                &stale_state,
                stale_generation,
                temporary_revoked_config,
                Some(false),
                || {
                    stale_refreshes_for_thread.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                },
            );
            let _ = stale_result_tx.send(result);
        });
        revoked_list_loaded_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("temporary revoked bootstrap did not load");

        let mut rollback_refreshes = 0;
        reconcile_durable_config_native_presentation(&state, &authorized_config, true, || {
            rollback_refreshes += 1;
            assert_eq!(state.config().browser_ids.len(), 1);
            assert!(state.is_paired());
            assert!(tray_connection_available(&state));
            assert!(tray_web_workspace_available(&state));
            Ok(())
        })
        .expect("failed browser revoke should restore authorized native presentation");

        release_stale_tx
            .send(())
            .expect("release stale empty authorization bootstrap");
        stale_result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("stale empty authorization bootstrap deadlocked")
            .expect("stale empty authorization bootstrap may return without committing");

        assert_eq!(rollback_refreshes, 1);
        assert_eq!(stale_refreshes.load(Ordering::SeqCst), 0);
        assert_eq!(state.config().browser_ids.len(), 1);
        assert!(state.is_paired());
    }

    #[test]
    fn explicit_language_commit_invalidates_a_blocked_bootstrap_completion() {
        let mut old_config = runtime_probe_config("https://old.example.invalid");
        old_config.ui_language = Some("zh-CN".into());
        let state = AppState::new(old_config.clone(), false);
        state.set_recovery_required(true);

        // The old bootstrap has already loaded its Chinese config but remains
        // blocked in a slow secure-store read. It owns no tray lock yet.
        let old_generation = state.begin_bootstrap_request();
        let old_state = state.clone();
        let old_refresh_count = Arc::new(AtomicUsize::new(0));
        let old_refresh_count_for_thread = old_refresh_count.clone();
        let (old_config_loaded_tx, old_config_loaded_rx) = mpsc::channel();
        let (release_old_tx, release_old_rx) = mpsc::channel();
        let (old_result_tx, old_result_rx) = mpsc::channel();
        thread::spawn(move || {
            old_config_loaded_tx
                .send(())
                .expect("record old Chinese bootstrap config");
            release_old_rx
                .recv()
                .expect("release old Chinese bootstrap");
            let result = reconcile_bootstrap_native_presentation(
                &old_state,
                old_generation,
                old_config,
                Some(true),
                || {
                    old_refresh_count_for_thread.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                },
            );
            let _ = old_result_tx.send(result);
        });
        old_config_loaded_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("old bootstrap did not load its config");

        let mut language_refreshes = Vec::new();
        let mut durable_saves = 0;
        set_ui_language_with_refresh_and_save(
            &state,
            UiLanguage::English,
            |language| {
                language_refreshes.push(language);
                Ok(())
            },
            |config| {
                durable_saves += 1;
                assert_eq!(config.ui_language.as_deref(), Some("en"));
                Ok(())
            },
        )
        .expect("explicit English switch should commit while old bootstrap is blocked");
        assert_eq!(language_refreshes, vec![UiLanguage::English]);
        assert_eq!(durable_saves, 1);

        release_old_tx
            .send(())
            .expect("release stale Chinese bootstrap");
        old_result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("stale Chinese bootstrap deadlocked")
            .expect("stale Chinese bootstrap may return without committing");

        assert_eq!(old_refresh_count.load(Ordering::SeqCst), 0);
        assert_eq!(state.config().server_url, "https://old.example.invalid");
        assert_eq!(state.config().ui_language.as_deref(), Some("en"));
        assert_eq!(state.ui_language(), UiLanguage::English);
        assert!(!state.is_paired());
        assert!(state.recovery_required());
    }

    #[test]
    fn same_value_language_reconciliation_invalidates_a_pending_bootstrap() {
        let mut current_config = runtime_probe_config("https://relayune.giraffetree.cn");
        current_config.ui_language = Some("en".into());
        let state = AppState::new(current_config.clone(), false);
        state.set_recovery_required(true);

        let mut stale_config = current_config;
        stale_config.ui_language = Some("zh-CN".into());
        let stale_generation = state.begin_bootstrap_request();
        let mut reconciliation_refreshes = 0;
        set_ui_language_with_refresh_and_save(
            &state,
            UiLanguage::English,
            |language| {
                reconciliation_refreshes += 1;
                assert_eq!(language, UiLanguage::English);
                Ok(())
            },
            |_| panic!("same-value reconciliation must not rewrite durable config"),
        )
        .expect("same-value English reconciliation should succeed");

        let mut stale_refreshes = 0;
        reconcile_bootstrap_native_presentation(
            &state,
            stale_generation,
            stale_config,
            Some(true),
            || {
                stale_refreshes += 1;
                Ok(())
            },
        )
        .expect("stale bootstrap should return without native refresh");

        assert_eq!(reconciliation_refreshes, 1);
        assert_eq!(stale_refreshes, 0);
        assert_eq!(state.config().ui_language.as_deref(), Some("en"));
        assert_eq!(state.ui_language(), UiLanguage::English);
        assert!(!state.is_paired());
        assert!(state.recovery_required());
    }

    #[test]
    fn cleared_pairing_secret_invalidates_a_blocked_presence_bootstrap() {
        let mut stale_config = runtime_probe_config("https://relayune.giraffetree.cn");
        stale_config.ui_language = Some("en".into());
        let state = AppState::new(stale_config.clone(), true);
        state.set_recovery_required(true);

        // The old bootstrap already observed both credentials before the user
        // irreversibly cleared one of them, but has not reached native commit.
        let stale_generation = state.begin_bootstrap_request();
        let stale_state = state.clone();
        let stale_refreshes = Arc::new(AtomicUsize::new(0));
        let stale_refreshes_for_thread = stale_refreshes.clone();
        let (presence_loaded_tx, presence_loaded_rx) = mpsc::channel();
        let (release_stale_tx, release_stale_rx) = mpsc::channel();
        let (stale_result_tx, stale_result_rx) = mpsc::channel();
        thread::spawn(move || {
            presence_loaded_tx
                .send(())
                .expect("record stale paired presence");
            release_stale_rx
                .recv()
                .expect("release stale paired bootstrap");
            let result = reconcile_bootstrap_native_presentation(
                &stale_state,
                stale_generation,
                stale_config,
                Some(true),
                || {
                    stale_refreshes_for_thread.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                },
            );
            let _ = stale_result_tx.send(result);
        });
        presence_loaded_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("stale bootstrap did not load paired presence");

        let mut clear_refreshes = 0;
        reconcile_cleared_secret_native_presentation(&state, true, || {
            clear_refreshes += 1;
            assert!(!state.is_paired());
            assert!(!tray_connection_available(&state));
            assert!(!tray_web_workspace_available(&state));
            Ok(())
        })
        .expect("cleared credential state should refresh natively");

        release_stale_tx
            .send(())
            .expect("release stale paired bootstrap");
        stale_result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("stale paired bootstrap deadlocked")
            .expect("stale paired bootstrap may return without committing");

        assert_eq!(clear_refreshes, 1);
        assert_eq!(stale_refreshes.load(Ordering::SeqCst), 0);
        assert!(!state.is_paired());
        assert!(!state.recovery_required());
    }

    #[test]
    fn committed_credential_transitions_clear_stale_native_recovery_state() {
        for (secrets, paired, connection_available, web_workspace_available, phase) in [
            (
                SecretPresence {
                    device_token: true,
                    e2ee_key: true,
                },
                true,
                true,
                true,
                RelayPhase::Connected,
            ),
            (
                SecretPresence::default(),
                false,
                false,
                false,
                RelayPhase::Stopped,
            ),
        ] {
            let state = AppState::new(
                runtime_probe_config("https://relayune.giraffetree.cn"),
                !paired,
            );
            state.set_recovery_required(true);
            {
                let mut runtime = state.inner.runtime.lock().expect("runtime lock");
                runtime.phase = phase.clone();
            }
            let mut refresh_count = 0;

            reconcile_known_credential_presence(&state, &secrets, || {
                refresh_count += 1;
                assert_eq!(state.is_paired(), paired);
                assert!(!state.recovery_required());
                assert_eq!(tray_connection_available(&state), connection_available);
                assert_eq!(
                    tray_web_workspace_available(&state),
                    web_workspace_available
                );
                let presentation =
                    tray_presentation_phase(state.recovery_required(), &state.snapshot().phase);
                if paired {
                    assert!(
                        matches!(presentation, RelayPhase::Connected),
                        "a committed credential transition must not retain Needs attention"
                    );
                } else {
                    assert!(
                        matches!(presentation, RelayPhase::Stopped),
                        "a committed credential transition must not retain Needs attention"
                    );
                }
                Ok(())
            })
            .expect("the committed credential state should reconcile natively");

            assert_eq!(refresh_count, 1);
        }
    }

    #[test]
    fn committed_credential_state_survives_repeated_native_refresh_failure() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            false,
        );
        state.set_recovery_required(true);
        let secrets = SecretPresence {
            device_token: true,
            e2ee_key: true,
        };
        let mut refresh_count = 0;

        let result = reconcile_known_credential_presence(&state, &secrets, || {
            refresh_count += 1;
            Err(user_error("language_failed"))
        });

        assert_eq!(result, Err(user_error("language_failed")));
        assert_eq!(refresh_count, 2);
        assert!(state.is_paired());
        assert!(!state.recovery_required());
        assert_eq!(
            state
                .snapshot()
                .logs
                .last()
                .expect("the native refresh failure must remain diagnostic")
                .message,
            user_error("language_failed")
        );
    }

    #[test]
    fn known_presence_reconciliation_preserves_the_durable_locale_commit() {
        let mut config = runtime_probe_config("https://relayune.giraffetree.cn");
        config.ui_language = Some("zh-CN".into());
        let state = AppState::new(config.clone(), false);
        state.set_recovery_required(true);
        let secrets = SecretPresence {
            device_token: true,
            e2ee_key: true,
        };

        reconcile_known_credential_presence(&state, &secrets, || {
            assert_eq!(state.config().ui_language, config.ui_language);
            assert_eq!(state.ui_language(), UiLanguage::SimplifiedChinese);
            Ok(())
        })
        .expect("known presence should refresh without replaying a stale config snapshot");

        assert_eq!(state.config().ui_language, config.ui_language);
        assert_eq!(state.ui_language(), UiLanguage::SimplifiedChinese);
        assert!(state.is_paired());
        assert!(!state.recovery_required());
    }

    #[test]
    fn relay_publications_serialize_native_and_web_snapshots() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            true,
        );
        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Starting;
        }

        let first_state = state.clone();
        let (first_refresh_tx, first_refresh_rx) = mpsc::channel();
        let (first_emit_tx, first_emit_rx) = mpsc::channel();
        let (release_first_tx, release_first_rx) = mpsc::channel();
        let (first_result_tx, first_result_rx) = mpsc::channel();
        thread::spawn(move || {
            let result = publish_relay_snapshot_with_hooks(
                &first_state,
                |snapshot| {
                    first_refresh_tx
                        .send(snapshot.clone())
                        .expect("record first native refresh");
                    release_first_rx
                        .recv()
                        .expect("release first native refresh");
                    Ok(())
                },
                |snapshot| {
                    first_emit_tx
                        .send(snapshot)
                        .expect("record first Web event");
                },
            );
            let _ = first_result_tx.send(result);
        });

        let first_native = first_refresh_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("first native refresh did not start");
        assert!(matches!(first_native.phase, RelayPhase::Starting));
        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Connected;
        }

        let second_state = state.clone();
        let (second_refresh_tx, second_refresh_rx) = mpsc::channel();
        let (second_emit_tx, second_emit_rx) = mpsc::channel();
        let (second_result_tx, second_result_rx) = mpsc::channel();
        thread::spawn(move || {
            let result = publish_relay_snapshot_with_hooks(
                &second_state,
                |snapshot| {
                    second_refresh_tx
                        .send(snapshot.clone())
                        .expect("record second native refresh");
                    Ok(())
                },
                |snapshot| {
                    second_emit_tx
                        .send(snapshot)
                        .expect("record second Web event");
                },
            );
            let _ = second_result_tx.send(result);
        });

        assert!(matches!(
            second_refresh_rx.recv_timeout(Duration::from_millis(100)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        release_first_tx
            .send(())
            .expect("release serialized first publication");

        let second_native = second_refresh_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("second native refresh did not resume");
        let first_web = first_emit_rx
            .try_recv()
            .expect("the first Web event must precede the second native refresh");
        let second_web = second_emit_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("second Web event was not emitted");
        assert!(matches!(first_web.phase, RelayPhase::Starting));
        assert!(matches!(second_native.phase, RelayPhase::Connected));
        assert!(matches!(second_web.phase, RelayPhase::Connected));
        first_result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("first publication deadlocked")
            .expect("first publication should succeed");
        second_result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("second publication deadlocked")
            .expect("second publication should succeed");
    }

    #[test]
    fn poisoned_native_presentation_gate_recovers_and_remains_serialized() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            true,
        );
        let poison_state = state.clone();
        let poison_result = thread::spawn(move || {
            let _guard = poison_state
                .inner
                .tray_update
                .lock()
                .expect("initial tray gate should be healthy");
            panic!("simulate an AppKit backend unwind while publishing");
        })
        .join();
        assert!(poison_result.is_err());
        assert!(state.inner.tray_update.is_poisoned());

        let publication_state = state.clone();
        let (publication_entered_tx, publication_entered_rx) = mpsc::channel();
        let (release_publication_tx, release_publication_rx) = mpsc::channel();
        let (publication_result_tx, publication_result_rx) = mpsc::channel();
        thread::spawn(move || {
            let result = publish_relay_snapshot_with_hooks(
                &publication_state,
                |snapshot| {
                    publication_entered_tx
                        .send(snapshot.clone())
                        .expect("record recovered native publication");
                    release_publication_rx
                        .recv()
                        .expect("release recovered native publication");
                    Ok(())
                },
                |_| {},
            );
            let _ = publication_result_tx.send(result);
        });

        let recovered_snapshot = publication_entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("poisoned tray gate was not recovered");
        assert_eq!(recovered_snapshot.logs.len(), 1);
        assert_eq!(
            recovered_snapshot.logs[0].message,
            user_error("language_failed")
        );
        assert!(!state.inner.tray_update.is_poisoned());

        let update_state = state.clone();
        let (update_refresh_tx, update_refresh_rx) = mpsc::channel();
        let (update_result_tx, update_result_rx) = mpsc::channel();
        thread::spawn(move || {
            let result = set_update_available_with_refresh(&update_state, true, || {
                update_refresh_tx
                    .send(update_state.update_available())
                    .expect("record serialized update refresh");
                Ok(())
            });
            let _ = update_result_tx.send(result);
        });

        assert!(matches!(
            update_refresh_rx.recv_timeout(Duration::from_millis(100)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        release_publication_tx
            .send(())
            .expect("release recovered native publication");
        publication_result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("recovered native publication deadlocked")
            .expect("recovered native publication should succeed");
        assert!(update_refresh_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("update refresh did not resume after recovered publication"));
        update_result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("serialized update transaction deadlocked")
            .expect("serialized update transaction should succeed");
        assert_eq!(
            state
                .snapshot()
                .logs
                .iter()
                .filter(|line| line.message == user_error("language_failed"))
                .count(),
            1,
            "poison recovery should retain one stable diagnostic and clear the gate"
        );
    }

    #[test]
    fn poisoned_tray_item_handles_recover_after_backend_unwind() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            true,
        );
        let poison_state = state.clone();
        let poison_result = thread::spawn(move || {
            let _publication_guard = poison_state
                .inner
                .tray_update
                .lock()
                .expect("initial tray gate should be healthy");
            let _item_guard = poison_state
                .inner
                .tray_items
                .lock()
                .expect("initial tray item container should be healthy");
            panic!("simulate an AppKit setter unwind while item handles are borrowed");
        })
        .join();
        assert!(poison_result.is_err());
        assert!(state.inner.tray_update.is_poisoned());
        assert!(state.inner.tray_items.is_poisoned());

        // Production refreshes recover the outer publication gate first. It
        // retains the one stable diagnostic for the unwind; the inner helper
        // must then recover the concrete menu handles instead of turning every
        // later refresh into a permanent language_failed loop.
        let publication_guard = super::lock_tray_update(&state);
        let item_guard = lock_tray_items(&state);
        assert!(item_guard.is_none());
        assert!(!state.inner.tray_update.is_poisoned());
        assert!(!state.inner.tray_items.is_poisoned());

        let next_state = state.clone();
        let (next_acquired_tx, next_acquired_rx) = mpsc::channel();
        let next = thread::spawn(move || {
            let _guard = lock_tray_items(&next_state);
            next_acquired_tx
                .send(())
                .expect("record recovered tray item lock acquisition");
        });
        assert!(matches!(
            next_acquired_rx.recv_timeout(Duration::from_millis(100)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        drop(item_guard);
        drop(publication_guard);
        next_acquired_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("recovered tray item lock did not remain serialized");
        next.join().expect("recovered tray item worker panicked");
        assert_eq!(
            state
                .snapshot()
                .logs
                .iter()
                .filter(|line| line.message == user_error("language_failed"))
                .count(),
            1,
            "the outer publication recovery should retain exactly one diagnostic"
        );
    }

    #[test]
    fn initial_tray_setup_serializes_early_callbacks_and_releases_after_failure() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            false,
        );
        let setup_state = state.clone();
        let (setup_entered_tx, setup_entered_rx) = mpsc::channel();
        let (release_setup_tx, release_setup_rx) = mpsc::channel();
        let (setup_result_tx, setup_result_rx) = mpsc::channel();
        thread::spawn(move || {
            let result = initialize_tray_presentation_with_hook(&setup_state, || {
                setup_entered_tx
                    .send(())
                    .expect("record initial tray setup transaction");
                release_setup_rx
                    .recv()
                    .expect("release initial tray setup transaction");
                Ok::<(), ()>(())
            });
            let _ = setup_result_tx.send(result);
        });
        setup_entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("initial tray setup did not acquire the publication gate");

        let callback_state = state.clone();
        let (callback_entered_tx, callback_entered_rx) = mpsc::channel();
        let (callback_result_tx, callback_result_rx) = mpsc::channel();
        thread::spawn(move || {
            let result = publish_relay_snapshot_with_hooks(
                &callback_state,
                |_| {
                    callback_entered_tx
                        .send(())
                        .expect("record deferred native callback refresh");
                    Ok(())
                },
                |_| {},
            );
            let _ = callback_result_tx.send(result);
        });
        assert!(matches!(
            callback_entered_rx.recv_timeout(Duration::from_millis(100)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        release_setup_tx
            .send(())
            .expect("release serialized initial tray setup");
        setup_result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("initial tray setup deadlocked")
            .expect("initial tray setup should succeed");
        callback_entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("deferred callback did not resume after tray setup");
        callback_result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("deferred callback result deadlocked")
            .expect("deferred callback refresh should succeed");

        assert_eq!(
            initialize_tray_presentation_with_hook(&state, || Err::<(), _>(())),
            Err(()),
            "a native build failure must remain a setup failure"
        );
        let (post_failure_tx, post_failure_rx) = mpsc::channel();
        let post_failure_state = state.clone();
        thread::spawn(move || {
            let result = publish_relay_snapshot_with_hooks(&post_failure_state, |_| Ok(()), |_| {});
            let _ = post_failure_tx.send(result);
        });
        post_failure_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("failed setup retained the publication gate")
            .expect("publication should recover after failed setup");
        assert!(lock_tray_items(&state).is_none());
    }

    #[test]
    fn failed_native_relay_refresh_is_diagnostic_and_retried_with_latest_snapshot() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            true,
        );
        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Connected;
        }
        let mut refresh_attempts = Vec::new();
        let mut emitted = Vec::new();

        publish_relay_snapshot_with_retry_hooks(
            &state,
            |snapshot| {
                refresh_attempts.push(snapshot.clone());
                if refresh_attempts.len() == 1 {
                    Err(user_error("language_failed"))
                } else {
                    Ok(())
                }
            },
            |snapshot| emitted.push(snapshot),
        )
        .expect("the immediate native presentation retry should recover");

        assert_eq!(refresh_attempts.len(), 2);
        assert_eq!(emitted.len(), 2);
        assert!(matches!(refresh_attempts[0].phase, RelayPhase::Connected));
        assert!(refresh_attempts[0].logs.is_empty());
        assert_eq!(
            refresh_attempts[1]
                .logs
                .last()
                .expect("the retry must carry a stable native refresh diagnostic")
                .message,
            user_error("language_failed")
        );
        assert_eq!(
            serde_json::to_string(&emitted[1]).unwrap(),
            serde_json::to_string(&refresh_attempts[1]).unwrap(),
        );
    }

    #[test]
    fn repeated_native_relay_refresh_failure_still_emits_its_diagnostic() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            true,
        );
        let mut refresh_count = 0;
        let mut emitted = Vec::new();

        let result = publish_relay_snapshot_with_retry_hooks(
            &state,
            |_| {
                refresh_count += 1;
                Err(user_error("language_failed"))
            },
            |snapshot| emitted.push(snapshot),
        );

        assert_eq!(result, Err(user_error("language_failed")));
        assert_eq!(refresh_count, 2);
        assert_eq!(emitted.len(), 2);
        assert_eq!(
            emitted[1]
                .logs
                .last()
                .expect("the WebView must observe the failed native refresh")
                .message,
            user_error("language_failed")
        );
    }

    #[test]
    fn failed_native_quit_refreshes_menu_and_web_from_the_same_error_snapshot() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            true,
        );
        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Error;
            runtime.last_error = Some(user_error("relay_stop_failed"));
        }
        let publication_state = state.clone();
        let (native_tx, native_rx) = mpsc::channel();
        let (web_tx, web_rx) = mpsc::channel();
        let (result_tx, result_rx) = mpsc::channel();

        thread::spawn(move || {
            let result = publish_native_action_error_with_refresh_hooks(
                &publication_state,
                user_error("relay_stop_failed"),
                |snapshot| {
                    native_tx
                        .send(snapshot.clone())
                        .expect("record native Quit presentation");
                    Ok(())
                },
                |snapshot| {
                    web_tx
                        .send(snapshot)
                        .expect("record native Quit Web publication");
                },
            );
            let _ = result_tx.send(result);
        });

        let native = native_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("failed Quit did not refresh the native presentation");
        let web = web_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("failed Quit did not publish the Web snapshot");
        result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("failed Quit presentation deadlocked")
            .expect("failed Quit presentation should refresh successfully");

        assert!(matches!(native.phase, RelayPhase::Error));
        assert_eq!(native.last_error, Some(user_error("relay_stop_failed")));
        assert_eq!(
            native
                .logs
                .last()
                .expect("failed Quit diagnostic should be retained")
                .message,
            user_error("relay_stop_failed")
        );
        assert_eq!(
            serde_json::to_string(&web).unwrap(),
            serde_json::to_string(&native).unwrap(),
            "NSMenu/tooltip/AX and WebView must observe one failed-Quit snapshot",
        );
    }

    #[test]
    fn native_action_errors_cannot_overtake_relay_publications() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            true,
        );
        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Starting;
        }

        let native_error_state = state.clone();
        let (native_event_tx, native_event_rx) = mpsc::channel();
        let (release_native_tx, release_native_rx) = mpsc::channel();
        let (native_done_tx, native_done_rx) = mpsc::channel();
        thread::spawn(move || {
            publish_native_action_error_with_hook(
                &native_error_state,
                user_error("window_failed"),
                |snapshot| {
                    native_event_tx
                        .send(snapshot)
                        .expect("record native action error event");
                    release_native_rx
                        .recv()
                        .expect("release native action error event");
                },
            );
            let _ = native_done_tx.send(());
        });

        let native_event = native_event_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("native action error was not published");
        assert!(matches!(native_event.phase, RelayPhase::Starting));
        assert_eq!(native_event.logs.len(), 1);
        assert_eq!(native_event.logs[0].message, user_error("window_failed"));
        {
            let mut runtime = state.inner.runtime.lock().expect("runtime lock");
            runtime.phase = RelayPhase::Connected;
        }

        let relay_state = state.clone();
        let (relay_refresh_tx, relay_refresh_rx) = mpsc::channel();
        let (relay_event_tx, relay_event_rx) = mpsc::channel();
        let (relay_result_tx, relay_result_rx) = mpsc::channel();
        thread::spawn(move || {
            let result = publish_relay_snapshot_with_hooks(
                &relay_state,
                |snapshot| {
                    relay_refresh_tx
                        .send(snapshot.clone())
                        .expect("record Relay native refresh");
                    Ok(())
                },
                |snapshot| {
                    relay_event_tx
                        .send(snapshot)
                        .expect("record Relay Web event");
                },
            );
            let _ = relay_result_tx.send(result);
        });

        assert!(matches!(
            relay_refresh_rx.recv_timeout(Duration::from_millis(100)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        release_native_tx
            .send(())
            .expect("release serialized native action event");
        native_done_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("native action publication deadlocked");

        let relay_native = relay_refresh_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("Relay native refresh did not resume");
        let relay_event = relay_event_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("Relay Web event was not emitted");
        assert!(matches!(relay_native.phase, RelayPhase::Connected));
        assert!(matches!(relay_event.phase, RelayPhase::Connected));
        assert_eq!(relay_event.logs.len(), 1);
        assert_eq!(relay_event.logs[0].message, user_error("window_failed"));
        relay_result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("Relay publication deadlocked")
            .expect("Relay publication should succeed");
    }

    #[test]
    fn native_callbacks_never_wait_on_the_tray_publication_mutex() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            true,
        );
        let publication_guard = state
            .inner
            .tray_update
            .lock()
            .expect("tray publication lock");
        let deferred_state = state.clone();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (completed_tx, completed_rx) = mpsc::channel();
        let (returned_tx, returned_rx) = mpsc::channel();

        thread::spawn(move || {
            defer_native_entry(move || {
                entered_tx.send(()).expect("deferred native entry started");
                let _guard = deferred_state
                    .inner
                    .tray_update
                    .lock()
                    .expect("deferred tray publication lock");
                completed_tx
                    .send(())
                    .expect("deferred native entry completed");
            });
            returned_tx
                .send(())
                .expect("native callback returned after dispatch");
        });

        entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("native entry was not dispatched off the callback thread");
        returned_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("native callback waited on the tray publication mutex");
        assert!(matches!(
            completed_rx.recv_timeout(Duration::from_millis(100)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        drop(publication_guard);
        completed_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("deferred native entry did not resume after publication");
    }

    #[test]
    fn interactive_os_quit_returns_before_sidecar_stop_and_deduplicates_reentry() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            true,
        );
        let prevent_count = Arc::new(AtomicUsize::new(0));
        let dispatch_count = Arc::new(AtomicUsize::new(0));
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (resumed_tx, resumed_rx) = mpsc::channel();

        let first_prevent_count = Arc::clone(&prevent_count);
        let first_dispatch_count = Arc::clone(&dispatch_count);
        defer_interactive_exit_stop_with_hooks(
            &state,
            move || {
                first_prevent_count.fetch_add(1, Ordering::SeqCst);
            },
            move |action| {
                first_dispatch_count.fetch_add(1, Ordering::SeqCst);
                thread::spawn(action);
            },
            move || {
                entered_tx.send(()).expect("enter deferred sidecar stop");
                release_rx.recv().expect("release deferred sidecar stop");
                Ok(())
            },
            move || {
                resumed_tx.send(()).expect("resume deferred OS exit");
            },
            |error| panic!("successful deferred stop published {error}"),
        );

        entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("deferred sidecar stop did not begin");
        assert!(!state.exit_stop_ready());
        assert_eq!(prevent_count.load(Ordering::SeqCst), 1);
        assert_eq!(dispatch_count.load(Ordering::SeqCst), 1);

        let second_prevent_count = Arc::clone(&prevent_count);
        let second_dispatch_count = Arc::clone(&dispatch_count);
        defer_interactive_exit_stop_with_hooks(
            &state,
            move || {
                second_prevent_count.fetch_add(1, Ordering::SeqCst);
            },
            move |_| {
                second_dispatch_count.fetch_add(1, Ordering::SeqCst);
            },
            || -> Result<(), String> { panic!("duplicate Quit started a second sidecar stop") },
            || panic!("duplicate Quit resumed exit independently"),
            |error| panic!("duplicate Quit published {error}"),
        );
        assert_eq!(prevent_count.load(Ordering::SeqCst), 2);
        assert_eq!(dispatch_count.load(Ordering::SeqCst), 1);
        assert!(matches!(
            resumed_rx.recv_timeout(Duration::from_millis(100)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));

        release_tx.send(()).expect("release sidecar stop");
        resumed_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("deferred OS exit was not resumed");
        assert!(state.exit_stop_ready());

        let completed_prevent_count = Arc::clone(&prevent_count);
        defer_interactive_exit_stop_with_hooks(
            &state,
            move || {
                completed_prevent_count.fetch_add(1, Ordering::SeqCst);
            },
            |_| panic!("completed stop dispatched another worker"),
            || -> Result<(), String> { panic!("completed stop ran twice") },
            || panic!("completed stop recursively resumed exit"),
            |error| panic!("completed stop published {error}"),
        );
        assert_eq!(
            prevent_count.load(Ordering::SeqCst),
            3,
            "a new interactive Quit must not replace the committed transition"
        );
    }

    #[test]
    fn failed_interactive_os_quit_clears_the_gate_for_a_retry() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            true,
        );
        let failures = Arc::new(AtomicUsize::new(0));
        let first_failures = Arc::clone(&failures);
        defer_interactive_exit_stop_with_hooks(
            &state,
            || {},
            |action| action(),
            || Err(user_error("relay_stop_failed")),
            || panic!("failed sidecar stop resumed exit"),
            move |error| {
                assert_eq!(error, user_error("relay_stop_failed"));
                first_failures.fetch_add(1, Ordering::SeqCst);
            },
        );
        assert!(!state.exit_stop_ready());
        assert_eq!(failures.load(Ordering::SeqCst), 1);

        let resumed = Arc::new(AtomicUsize::new(0));
        let retry_resumed = Arc::clone(&resumed);
        defer_interactive_exit_stop_with_hooks(
            &state,
            || {},
            |action| action(),
            || Ok(()),
            move || {
                retry_resumed.fetch_add(1, Ordering::SeqCst);
            },
            |error| panic!("successful retry published {error}"),
        );
        assert!(state.exit_stop_ready());
        assert_eq!(resumed.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn native_presentation_ipc_returns_to_the_event_loop_before_waiting_on_tray_update() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            true,
        );
        let app = tauri::test::mock_builder()
            .manage(state.clone())
            .invoke_handler(tauri::generate_handler![native_presentation_ipc_probe])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock IPC app should build");
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock IPC window should build");
        let publication_guard = state
            .inner
            .tray_update
            .lock()
            .expect("tray publication lock");
        let (returned_tx, returned_rx) = mpsc::channel();
        let (response_tx, response_rx) = mpsc::channel();

        let event_thread = thread::spawn(move || {
            webview.on_message(
                tauri::webview::InvokeRequest {
                    cmd: "native_presentation_ipc_probe".into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: "tauri://localhost".parse().expect("mock IPC URL"),
                    body: tauri::ipc::InvokeBody::Json(serde_json::json!({
                        "available": true,
                    })),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.to_string(),
                },
                Box::new(move |_window, _cmd, response, _callback, _error| {
                    response_tx
                        .send(response)
                        .expect("record native command response");
                }),
            );
            returned_tx
                .send(())
                .expect("IPC event loop returned after dispatch");
        });

        returned_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("synchronous native presentation command blocked the IPC event loop");
        assert!(matches!(
            response_rx.recv_timeout(Duration::from_millis(100)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        drop(publication_guard);
        response_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("native presentation command did not resume after publication");
        event_thread
            .join()
            .expect("mock IPC event thread should exit cleanly");
        assert!(
            !state.update_available(),
            "a missing mock tray should roll the requested update presentation back"
        );
    }

    #[test]
    fn native_window_action_dispatch_failures_are_retained_and_published() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            true,
        );
        let mut published = Vec::new();

        record_native_window_action_dispatch_result(
            &state,
            Ok::<(), ()>(()),
            user_error("window_failed"),
            |snapshot| published.push(snapshot),
        );
        assert!(state.snapshot().logs.is_empty());
        assert!(published.is_empty());

        record_native_window_action_dispatch_result(
            &state,
            Err::<(), ()>(()),
            user_error("window_failed"),
            |snapshot| published.push(snapshot),
        );
        record_native_window_action_dispatch_result(
            &state,
            Err::<(), ()>(()),
            user_error("update_failed"),
            |snapshot| published.push(snapshot),
        );

        let logs = state.snapshot().logs;
        assert_eq!(logs.len(), 2);
        assert_eq!(logs[0].message, user_error("window_failed"));
        assert_eq!(logs[1].message, user_error("update_failed"));
        assert_eq!(published.len(), 2);
        assert_eq!(published[0].logs.len(), 1);
        assert_eq!(published[0].logs[0].message, user_error("window_failed"));
        assert_eq!(published[1].logs.len(), 2);
        assert_eq!(published[1].logs[1].message, user_error("update_failed"));
    }

    #[test]
    fn unreadable_config_keeps_the_native_menu_on_a_safe_recovery_path() {
        let fallback = runtime_probe_config("https://relayune.giraffetree.cn");
        let presentation =
            startup_native_presentation(&fallback, &SecretPresence::default(), false, true);
        assert!(!presentation.connection_available);
        assert!(presentation.recovery_required);
        assert!(matches!(presentation.phase, RelayPhase::Error));

        let state = AppState::new(fallback, presentation.connection_available);
        state.set_recovery_required(presentation.recovery_required);
        assert!(tray_connection_available(&state));
        assert!(!tray_web_workspace_available(&state));
        assert_eq!(
            tray_window_action_text(UiLanguage::English, tray_connection_available(&state)),
            "Show Relayune"
        );
    }

    #[test]
    fn initial_window_restore_failure_is_diagnostic_not_a_startup_blocker() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            false,
        );
        record_startup_window_restore_result(&state, Err(user_error("window_failed")));

        let logs = state.snapshot().logs;
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].message, user_error("window_failed"));
    }

    #[test]
    fn pre_setup_native_restore_intent_survives_every_state_registration_race() {
        let waiting_for_setup = AtomicBool::new(false);
        let early_restores = AtomicUsize::new(0);
        request_pending_native_restore_with_hook(
            &waiting_for_setup,
            || false,
            || false,
            || {
                early_restores.fetch_add(1, Ordering::SeqCst);
            },
        );
        assert_eq!(early_restores.load(Ordering::SeqCst), 0);
        assert!(
            take_pending_native_restore(&waiting_for_setup),
            "setup must inherit an interactive launch that arrived before AppState"
        );
        assert!(!take_pending_native_restore(&waiting_for_setup));

        let state_registered_first = AtomicBool::new(false);
        request_pending_native_restore_with_hook(
            &state_registered_first,
            || false,
            || true,
            || {
                early_restores.fetch_add(1, Ordering::SeqCst);
            },
        );
        assert_eq!(early_restores.load(Ordering::SeqCst), 1);
        assert!(!take_pending_native_restore(&state_registered_first));

        let setup_consumes_during_recheck = AtomicBool::new(false);
        let setup_owned_restore = AtomicBool::new(false);
        request_pending_native_restore_with_hook(
            &setup_consumes_during_recheck,
            || false,
            || {
                setup_owned_restore.store(
                    take_pending_native_restore(&setup_consumes_during_recheck),
                    Ordering::SeqCst,
                );
                true
            },
            || {
                early_restores.fetch_add(1, Ordering::SeqCst);
            },
        );
        assert!(setup_owned_restore.load(Ordering::SeqCst));
        assert_eq!(
            early_restores.load(Ordering::SeqCst),
            1,
            "a request already consumed by setup must not restore twice"
        );
        assert!(!take_pending_native_restore(&setup_consumes_during_recheck));

        let immediately_visible = AtomicBool::new(false);
        request_pending_native_restore_with_hook(
            &immediately_visible,
            || true,
            || panic!("an immediate restore must not inspect AppState readiness"),
            || panic!("an immediate restore must not run the post-setup retry"),
        );
        assert!(!take_pending_native_restore(&immediately_visible));

        let background = startup_behavior(true, &SecretPresence::default(), true);
        assert!(!background.show_main_window);
        assert!(
            background.show_main_window || setup_owned_restore.load(Ordering::SeqCst),
            "the inherited interactive launch must override a hidden background startup"
        );
    }

    #[test]
    fn native_entry_restore_failure_publishes_fresh_diagnostics() {
        let app = tauri::test::mock_app();
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            false,
        );
        app.manage(state.clone());
        let status_payloads = Arc::new(Mutex::new(Vec::new()));
        let observed_payloads = status_payloads.clone();
        app.listen("relay-status", move |event| {
            observed_payloads
                .lock()
                .expect("status payload lock")
                .push(event.payload().to_owned());
        });

        restore_window_from_native_entry(app.handle());

        let logs = state.snapshot().logs;
        assert_eq!(
            logs.last()
                .expect("native restore failure diagnostic")
                .message,
            user_error("window_failed")
        );
        let log_count_after_failure = logs.len();
        let payloads = status_payloads.lock().expect("status payload lock");
        let payload_count_after_failure = payloads.len();
        let published: RelaySnapshot = serde_json::from_str(
            payloads
                .last()
                .expect("native restore failure should publish a snapshot"),
        )
        .unwrap();
        assert_eq!(
            published
                .logs
                .last()
                .expect("published native restore diagnostic")
                .message,
            user_error("window_failed")
        );
        drop(payloads);

        let _window = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock main window should build");
        restore_window_from_native_entry(app.handle());
        assert_eq!(state.snapshot().logs.len(), log_count_after_failure);
        assert_eq!(
            status_payloads.lock().unwrap().len(),
            payload_count_after_failure
        );
    }

    #[test]
    fn native_entry_restore_failure_schedules_a_surface_recheck() {
        let scheduled = AtomicUsize::new(0);
        let failed = restore_window_from_native_entry_with_hooks(
            || Err::<(), _>(user_error("window_failed")),
            || {
                scheduled.fetch_add(1, Ordering::SeqCst);
            },
        );
        assert_eq!(failed, Err(user_error("window_failed")));
        assert_eq!(scheduled.load(Ordering::SeqCst), 1);

        let restored = restore_window_from_native_entry_with_hooks(
            || Ok::<(), String>(()),
            || panic!("successful restore must not schedule a fallback check"),
        );
        assert_eq!(restored, Ok(()));
    }

    #[test]
    fn native_entry_surface_readback_runs_only_inside_the_scheduled_callback() {
        let scheduled = Arc::new(AtomicBool::new(false));
        let checks = Arc::new(AtomicUsize::new(0));
        let requests = Arc::new(AtomicUsize::new(0));
        let scheduled_for_check = Arc::clone(&scheduled);
        let checks_for_callback = Arc::clone(&checks);
        let requests_for_callback = Arc::clone(&requests);
        schedule_native_entry_recovery_check_with_hooks(
            |check| {
                scheduled.store(true, Ordering::SeqCst);
                check();
                Ok(())
            },
            move || {
                assert!(
                    scheduled_for_check.load(Ordering::SeqCst),
                    "AppKit recovery surfaces must not be read on the worker thread"
                );
                checks_for_callback.fetch_add(1, Ordering::SeqCst);
                true
            },
            move || {
                requests_for_callback.fetch_add(1, Ordering::SeqCst);
            },
            || panic!("a scheduled main-thread check must not use the fallback"),
        );
        assert_eq!(checks.load(Ordering::SeqCst), 1);
        assert_eq!(requests.load(Ordering::SeqCst), 0);

        let missing_surface_requests = Arc::new(AtomicUsize::new(0));
        let missing_surface_requests_for_callback = Arc::clone(&missing_surface_requests);
        schedule_native_entry_recovery_check_with_hooks(
            |check| {
                check();
                Ok(())
            },
            || false,
            move || {
                missing_surface_requests_for_callback.fetch_add(1, Ordering::SeqCst);
            },
            || panic!("a scheduled main-thread check must not use the fallback"),
        );
        assert_eq!(missing_surface_requests.load(Ordering::SeqCst), 1);

        let schedule_failures = AtomicUsize::new(0);
        schedule_native_entry_recovery_check_with_hooks(
            |_check| Err(()),
            || panic!("a rejected main-thread dispatch must not run its readback"),
            || panic!("a rejected main-thread dispatch must not run its request"),
            || {
                schedule_failures.fetch_add(1, Ordering::SeqCst);
            },
        );
        assert_eq!(schedule_failures.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn auxiliary_autostart_read_failure_never_blocks_the_primary_surface() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            false,
        );
        assert!(launch_at_login_or_diagnostic(&state, Ok::<bool, ()>(true),));
        assert!(state.snapshot().logs.is_empty());

        assert!(!launch_at_login_or_diagnostic(
            &state,
            Err::<bool, _>("simulated LaunchAgent read failure"),
        ));
        let logs = state.snapshot().logs;
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].message, user_error("autostart_failed"));
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn macos_autostart_enable_rolls_back_every_partial_commit() {
        for readback in [Ok(false), Err(())] {
            let disable_calls = AtomicUsize::new(0);
            let result = set_non_windows_launch_at_login_with_hooks(
                true,
                || Ok::<(), ()>(()),
                || {
                    disable_calls.fetch_add(1, Ordering::SeqCst);
                    Ok::<(), ()>(())
                },
                || readback,
            );
            assert_eq!(result, Err(user_error("autostart_failed")));
            assert_eq!(disable_calls.load(Ordering::SeqCst), 1);
        }

        let disable_calls = AtomicUsize::new(0);
        let readback_calls = AtomicUsize::new(0);
        let result = set_non_windows_launch_at_login_with_hooks(
            true,
            || Err::<(), ()>(()),
            || {
                disable_calls.fetch_add(1, Ordering::SeqCst);
                Ok::<(), ()>(())
            },
            || {
                readback_calls.fetch_add(1, Ordering::SeqCst);
                Ok::<bool, ()>(true)
            },
        );
        assert_eq!(result, Err(user_error("autostart_failed")));
        assert_eq!(disable_calls.load(Ordering::SeqCst), 1);
        assert_eq!(readback_calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn macos_autostart_disable_is_idempotent_and_retries_an_uncommitted_state() {
        let disable_calls = AtomicUsize::new(0);
        let result = set_non_windows_launch_at_login_with_hooks(
            false,
            || Ok::<(), ()>(()),
            || {
                disable_calls.fetch_add(1, Ordering::SeqCst);
                Err::<(), ()>(())
            },
            || Ok::<bool, ()>(false),
        );
        assert_eq!(result, Ok(false));
        assert_eq!(disable_calls.load(Ordering::SeqCst), 1);

        for readback in [Ok(true), Err(())] {
            let disable_calls = AtomicUsize::new(0);
            let result = set_non_windows_launch_at_login_with_hooks(
                false,
                || Ok::<(), ()>(()),
                || {
                    disable_calls.fetch_add(1, Ordering::SeqCst);
                    Ok::<(), ()>(())
                },
                || readback,
            );
            assert_eq!(result, Err(user_error("autostart_failed")));
            assert_eq!(disable_calls.load(Ordering::SeqCst), 2);
        }
    }

    #[test]
    fn close_invokes_mock_window_hide_and_failure_is_diagnostic() {
        let app = tauri::test::mock_app();
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            true,
        );
        state.set_window_hide_recovery_available(true);
        app.manage(state.clone());
        let window = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock main window should build");
        let status_payloads = Arc::new(Mutex::new(Vec::new()));
        let observed_payloads = status_payloads.clone();
        app.listen("relay-status", move |event| {
            observed_payloads
                .lock()
                .expect("status payload lock")
                .push(event.payload().to_owned());
        });

        let native_window = window.as_ref().window();
        hide_main_window_with_hook(
            true,
            || native_window.hide(),
            || true,
            || Ok::<(), ()>(()),
            || {
                publish_native_action_error_with_hook(
                    &state,
                    user_error("window_failed"),
                    |snapshot| {
                        let _ = app.emit("relay-status", snapshot);
                    },
                );
            },
        );
        // MockRuntime acknowledges the native hide dispatcher call. A clean log
        // proves that executable boundary returned success; AppKit's final
        // visibility remains a real-UI boundary.
        assert!(state.snapshot().logs.is_empty());
        assert!(status_payloads.lock().unwrap().is_empty());

        record_window_hide_result(Err::<(), _>("simulated native window hide failure"), || {
            publish_native_action_error_with_hook(
                &state,
                user_error("window_failed"),
                |snapshot| {
                    let _ = app.emit("relay-status", snapshot);
                },
            );
        });
        let logs = state.snapshot().logs;
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].message, user_error("window_failed"));
        let payloads = status_payloads.lock().unwrap();
        assert_eq!(payloads.len(), 1);
        let published: RelaySnapshot = serde_json::from_str(&payloads[0]).unwrap();
        assert_eq!(published.logs.len(), 1);
        assert_eq!(published.logs[0].message, user_error("window_failed"));
    }

    #[test]
    fn close_to_background_requires_a_proven_native_recovery_surface() {
        assert!(!has_window_hide_recovery_surface(false, false));
        assert!(has_window_hide_recovery_surface(true, false));
        assert!(has_window_hide_recovery_surface(false, true));
        assert!(has_window_hide_recovery_surface(true, true));
    }

    #[test]
    fn built_but_invisible_native_menu_forces_windowed_startup_recovery() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            false,
        );

        assert!(!record_native_menu_visibility_result(&state, true, false));
        assert_eq!(state.snapshot().logs.len(), 1);
        assert_eq!(
            state.snapshot().logs[0].message,
            user_error("startup_failed")
        );
        assert!(
            startup_behavior(true, &SecretPresence::default(), false).show_main_window,
            "a background Accessory app without a visible NSStatusItem must reveal its window"
        );

        let visible_state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            false,
        );
        assert!(record_native_menu_visibility_result(
            &visible_state,
            true,
            true
        ));
        assert!(visible_state.snapshot().logs.is_empty());
    }

    #[test]
    fn updater_restart_never_runs_after_relay_stop_failure_or_completed_quit() {
        let transitions = AtomicUsize::new(0);
        let failures = AtomicUsize::new(0);
        let failed_state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            true,
        );
        let result = process_transition_with_hooks(
            &failed_state,
            || Err(user_error("relay_stop_failed")),
            || {
                transitions.fetch_add(1, Ordering::SeqCst);
            },
            |error| {
                assert_eq!(error, user_error("relay_stop_failed"));
                failures.fetch_add(1, Ordering::SeqCst);
            },
        );

        assert_eq!(result, Err(user_error("relay_stop_failed")));
        assert_eq!(transitions.load(Ordering::SeqCst), 0);
        assert_eq!(failures.load(Ordering::SeqCst), 1);
        assert!(
            !failed_state.exit_stop_requested(),
            "a failed pre-exit stop must reopen both Quit and Relay Start retry"
        );

        let successful_state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            true,
        );
        assert_eq!(
            process_transition_with_hooks(
                &successful_state,
                || Ok(()),
                || {
                    transitions.fetch_add(1, Ordering::SeqCst);
                },
                |_| panic!("a successful stop must not publish a failure"),
            ),
            Ok(())
        );
        assert_eq!(transitions.load(Ordering::SeqCst), 1);
        assert!(successful_state.exit_stop_ready());
        assert_eq!(
            process_transition_with_hooks(
                &successful_state,
                || -> Result<(), String> { panic!("completed exit stopped Relay twice") },
                || panic!("completed exit transitioned twice"),
                |_| panic!("completed exit published a failure"),
            ),
            Err(user_error("relay_stop_failed"))
        );
        assert_eq!(transitions.load(Ordering::SeqCst), 1);
        assert!(
            !successful_state.begin_exit_stop(),
            "a completed transition must never admit a second owner"
        );
    }

    #[test]
    fn concurrent_process_transition_never_reports_unowned_success() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            true,
        );
        let owner_state = state.clone();
        let (stop_entered_tx, stop_entered_rx) = mpsc::channel();
        let (release_stop_tx, release_stop_rx) = mpsc::channel();
        let (owner_transition_tx, owner_transition_rx) = mpsc::channel();
        let owner = thread::spawn(move || {
            process_transition_with_hooks(
                &owner_state,
                move || {
                    stop_entered_tx
                        .send(())
                        .expect("test should observe the owner stop");
                    release_stop_rx
                        .recv_timeout(Duration::from_secs(1))
                        .map_err(|_| user_error("relay_stop_failed"))?;
                    Ok(())
                },
                move || {
                    owner_transition_tx
                        .send(())
                        .expect("test should observe the owner transition");
                },
                |_| panic!("a successful owner stop must not publish a failure"),
            )
        });
        stop_entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("owner did not claim the exit gate");

        let contender_stop_calls = AtomicUsize::new(0);
        let contender_transition_calls = AtomicUsize::new(0);
        let contender_failure_calls = AtomicUsize::new(0);
        let contender = process_transition_with_hooks(
            &state,
            || {
                contender_stop_calls.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
            || {
                contender_transition_calls.fetch_add(1, Ordering::SeqCst);
            },
            |_| {
                contender_failure_calls.fetch_add(1, Ordering::SeqCst);
            },
        );

        assert_eq!(contender, Err(user_error("relay_stop_failed")));
        assert_eq!(contender_stop_calls.load(Ordering::SeqCst), 0);
        assert_eq!(contender_transition_calls.load(Ordering::SeqCst), 0);
        assert_eq!(contender_failure_calls.load(Ordering::SeqCst), 0);
        assert!(
            owner_transition_rx
                .recv_timeout(Duration::from_millis(100))
                .is_err(),
            "the owner must not transition before Relay stop completes"
        );

        release_stop_tx
            .send(())
            .expect("test should release the owner stop");
        assert_eq!(owner.join().expect("owner thread should not panic"), Ok(()));
        owner_transition_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("the sole owner transition did not run");
        assert!(state.exit_stop_ready());
    }

    #[test]
    fn regular_policy_must_be_confirmed_before_the_last_window_can_hide() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            false,
        );
        let mut published = Vec::new();

        record_windowed_recovery_policy_confirmation(&state, false, || {
            publish_native_action_error_with_hook(
                &state,
                user_error("startup_failed"),
                |snapshot| published.push(snapshot),
            );
        });

        assert!(!state.window_hide_recovery_available());
        assert_eq!(published.len(), 1);
        assert_eq!(
            published[0]
                .logs
                .last()
                .expect("the failed AppKit policy readback must be diagnostic")
                .message,
            user_error("startup_failed")
        );

        let clean_state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            false,
        );
        record_windowed_recovery_policy_confirmation(&clean_state, true, || {
            panic!("a confirmed Regular policy must not publish an error")
        });
        assert!(clean_state.window_hide_recovery_available());
        assert!(clean_state.snapshot().logs.is_empty());
    }

    #[test]
    fn successful_ax_retry_readmits_close_to_menu_after_initial_failure() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            false,
        );

        assert!(!record_initial_tray_accessibility_result(
            &state,
            Err(user_error("language_failed")),
        ));
        assert!(!state.window_hide_recovery_available());

        record_native_menu_accessibility_refresh_result(&state, Ok(()))
            .expect("a later visible AX readback should repair menu recovery admission");
        assert!(state.window_hide_recovery_available());
        assert!(validated_window_hide_recovery_surface(true, true, false));

        let fallback_errors = AtomicUsize::new(0);
        record_windowed_recovery_policy_confirmation(&state, false, || {
            fallback_errors.fetch_add(1, Ordering::SeqCst);
        });
        assert!(state.window_hide_recovery_available());
        assert_eq!(fallback_errors.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn close_keeps_last_window_visible_when_both_native_recovery_surfaces_fail() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            false,
        );
        let hide_calls = AtomicUsize::new(0);
        let mut published = Vec::new();

        hide_main_window_with_hook(
            false,
            || {
                hide_calls.fetch_add(1, Ordering::SeqCst);
                Ok::<(), ()>(())
            },
            || panic!("a refused hide must not perform a post-hide recovery check"),
            || -> Result<(), ()> { panic!("a refused hide must not need window restoration") },
            || {
                publish_native_action_error_with_hook(
                    &state,
                    user_error("window_failed"),
                    |snapshot| published.push(snapshot),
                );
            },
        );

        assert_eq!(hide_calls.load(Ordering::SeqCst), 0);
        assert_eq!(published.len(), 1);
        assert_eq!(
            published[0]
                .logs
                .last()
                .expect("the refused hide should be diagnostic")
                .message,
            user_error("window_failed")
        );

        state.set_window_hide_recovery_available(true);
        hide_main_window_with_hook(
            false,
            || {
                hide_calls.fetch_add(1, Ordering::SeqCst);
                Ok::<(), ()>(())
            },
            || panic!("a stale admission must not perform a post-hide recovery check"),
            || -> Result<(), ()> { panic!("a stale admission must not need window restoration") },
            || {
                publish_native_action_error_with_hook(
                    &state,
                    user_error("window_failed"),
                    |snapshot| published.push(snapshot),
                );
            },
        );
        assert_eq!(
            hide_calls.load(Ordering::SeqCst),
            0,
            "a stale setup admission must not hide after both concrete recovery surfaces disappear"
        );
        assert_eq!(published.len(), 2);

        hide_main_window_with_hook(
            true,
            || {
                hide_calls.fetch_add(1, Ordering::SeqCst);
                Ok::<(), ()>(())
            },
            || true,
            || -> Result<(), ()> {
                panic!("an available post-hide recovery surface must not restore the window")
            },
            || {
                publish_native_action_error_with_hook(
                    &state,
                    user_error("window_failed"),
                    |snapshot| published.push(snapshot),
                );
            },
        );
        assert_eq!(hide_calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            published.len(),
            2,
            "a successful close-to-background transition should not emit an error snapshot"
        );
    }

    #[test]
    fn close_restores_window_if_the_recovery_surface_disappears_during_hide() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            false,
        );
        let hide_calls = AtomicUsize::new(0);
        let recovery_checks = AtomicUsize::new(0);
        let restore_calls = AtomicUsize::new(0);
        let mut published = Vec::new();

        hide_main_window_with_hook(
            true,
            || {
                hide_calls.fetch_add(1, Ordering::SeqCst);
                Ok::<(), ()>(())
            },
            || {
                recovery_checks.fetch_add(1, Ordering::SeqCst);
                false
            },
            || {
                restore_calls.fetch_add(1, Ordering::SeqCst);
                Ok::<(), ()>(())
            },
            || {
                publish_native_action_error_with_hook(
                    &state,
                    user_error("window_failed"),
                    |snapshot| published.push(snapshot),
                );
            },
        );

        assert_eq!(hide_calls.load(Ordering::SeqCst), 1);
        assert_eq!(recovery_checks.load(Ordering::SeqCst), 1);
        assert_eq!(restore_calls.load(Ordering::SeqCst), 1);
        assert_eq!(published.len(), 1);
        assert_eq!(
            published[0]
                .logs
                .last()
                .expect("the rescued close race should remain diagnostic")
                .message,
            user_error("window_failed")
        );
    }

    #[test]
    fn failed_post_hide_restore_requests_a_second_os_recovery_surface() {
        let restore_calls = AtomicUsize::new(0);
        let windowed_recovery_requests = AtomicUsize::new(0);
        let failed = restore_window_after_recovery_surface_loss_with_hooks(
            || {
                restore_calls.fetch_add(1, Ordering::SeqCst);
                Err::<(), _>(user_error("window_failed"))
            },
            || {
                windowed_recovery_requests.fetch_add(1, Ordering::SeqCst);
            },
        );
        assert_eq!(failed, Err(user_error("window_failed")));
        assert_eq!(restore_calls.load(Ordering::SeqCst), 1);
        assert_eq!(windowed_recovery_requests.load(Ordering::SeqCst), 1);

        let restored = restore_window_after_recovery_surface_loss_with_hooks(
            || {
                restore_calls.fetch_add(1, Ordering::SeqCst);
                Ok::<(), String>(())
            },
            || {
                windowed_recovery_requests.fetch_add(1, Ordering::SeqCst);
            },
        );
        assert_eq!(restored, Ok(()));
        assert_eq!(restore_calls.load(Ordering::SeqCst), 2);
        assert_eq!(
            windowed_recovery_requests.load(Ordering::SeqCst),
            1,
            "a successful immediate restore must not create Dock visual churn"
        );
    }

    #[test]
    fn close_requires_a_current_status_item_or_regular_policy_readback() {
        assert!(!validated_window_hide_recovery_surface(false, true, true));
        assert!(!validated_window_hide_recovery_surface(true, false, false));
        assert!(validated_window_hide_recovery_surface(true, true, false));
        assert!(validated_window_hide_recovery_surface(true, false, true));
    }

    #[test]
    fn initial_ax_readback_failure_forces_visible_windowed_recovery() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            false,
        );
        assert!(!record_initial_tray_accessibility_result(
            &state,
            Err(user_error("language_failed"))
        ));
        let native_menu_available = native_menu_recovery_available(true, false);
        assert!(!native_menu_available);
        assert_eq!(
            startup_behavior(true, &SecretPresence::default(), native_menu_available),
            StartupBehavior {
                show_main_window: true,
                start_relay: false,
            }
        );

        let logs = state.snapshot().logs;
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].message, user_error("language_failed"));

        assert!(record_initial_tray_accessibility_result(&state, Ok(())));
        assert!(native_menu_recovery_available(true, true));
    }

    #[test]
    fn update_availability_changes_are_serialized_with_the_native_presentation() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            false,
        );
        let first_state = state.clone();
        let (first_entered_tx, first_entered_rx) = mpsc::channel();
        let (release_first_tx, release_first_rx) = mpsc::channel();
        let first = thread::spawn(move || {
            set_update_available_with_refresh(&first_state, true, || {
                first_entered_tx.send(()).unwrap();
                release_first_rx.recv().unwrap();
                Ok(())
            })
        });
        first_entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("the first native refresh should start");

        let second_state = state.clone();
        let (second_started_tx, second_started_rx) = mpsc::channel();
        let (second_refreshed_tx, second_refreshed_rx) = mpsc::channel();
        let second = thread::spawn(move || {
            second_started_tx.send(()).unwrap();
            set_update_available_with_refresh(&second_state, false, || {
                second_refreshed_tx.send(()).unwrap();
                Ok(())
            })
        });
        second_started_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("the concurrent clear should be scheduled");
        assert!(second_refreshed_rx
            .recv_timeout(Duration::from_millis(50))
            .is_err());

        release_first_tx.send(()).unwrap();
        assert_eq!(first.join().unwrap(), Ok(()));
        assert_eq!(second.join().unwrap(), Ok(()));
        second_refreshed_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("the clear should refresh after discovery commits");
        assert!(!state.update_available());
    }

    #[test]
    fn failed_update_presentation_restores_the_previous_native_state() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            true,
        );
        let mut refresh_count = 0;
        let result = set_update_available_with_refresh(&state, true, || {
            refresh_count += 1;
            if refresh_count == 1 {
                Err(user_error("language_failed"))
            } else {
                assert!(!state.update_available());
                Ok(())
            }
        });

        assert_eq!(result, Err(user_error("update_failed")));
        assert_eq!(refresh_count, 2);
        assert!(!state.update_available());
    }

    #[test]
    fn unchanged_update_request_reconciles_a_failed_native_rollback() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            true,
        );
        let mut failed_refreshes = 0;
        let result = set_update_available_with_refresh(&state, true, || {
            failed_refreshes += 1;
            Err(user_error("language_failed"))
        });

        assert_eq!(result, Err(user_error("update_failed")));
        assert_eq!(failed_refreshes, 2);
        assert!(!state.update_available());

        let mut reconciliation_refreshes = 0;
        let result = set_update_available_with_refresh(&state, false, || {
            reconciliation_refreshes += 1;
            Ok(())
        });

        assert_eq!(result, Ok(()));
        assert_eq!(reconciliation_refreshes, 1);
        assert!(!state.update_available());
    }

    #[test]
    fn unchanged_update_request_does_not_hide_native_refresh_failure() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            false,
        );
        let result =
            set_update_available_with_refresh(&state, false, || Err(user_error("language_failed")));

        assert_eq!(result, Err(user_error("update_failed")));
        assert!(!state.update_available());
    }

    #[test]
    fn unchanged_language_request_reconciles_a_failed_native_rollback() {
        let mut config = runtime_probe_config("https://relayune.giraffetree.cn");
        config.ui_language = Some(UiLanguage::English.language_code().into());
        let state = AppState::new(config, false);
        assert_eq!(state.ui_language(), UiLanguage::English);

        let mut failed_refreshes = Vec::new();
        let result = set_ui_language_with_refresh_and_save(
            &state,
            UiLanguage::SimplifiedChinese,
            |language| {
                failed_refreshes.push(language);
                Err(user_error("language_failed"))
            },
            |_| panic!("a failed native refresh must not persist the new language"),
        );

        assert_eq!(result, Err(user_error("language_failed")));
        assert_eq!(
            failed_refreshes,
            vec![UiLanguage::SimplifiedChinese, UiLanguage::English]
        );
        assert_eq!(state.ui_language(), UiLanguage::English);
        assert_eq!(state.config().ui_language.as_deref(), Some("en"));

        let mut reconciliation_refreshes = Vec::new();
        let result = set_ui_language_with_refresh_and_save(
            &state,
            UiLanguage::English,
            |language| {
                reconciliation_refreshes.push(language);
                Ok(())
            },
            |_| panic!("an unchanged durable language must not rewrite config"),
        );

        assert_eq!(result, Ok(()));
        assert_eq!(reconciliation_refreshes, vec![UiLanguage::English]);
        assert_eq!(state.ui_language(), UiLanguage::English);
        assert_eq!(state.config().ui_language.as_deref(), Some("en"));
    }

    #[test]
    fn unchanged_language_request_does_not_hide_native_refresh_failure() {
        let mut config = runtime_probe_config("https://relayune.giraffetree.cn");
        config.ui_language = Some(UiLanguage::English.language_code().into());
        let state = AppState::new(config, false);
        let result = set_ui_language_with_refresh_and_save(
            &state,
            UiLanguage::English,
            |_| Err(user_error("language_failed")),
            |_| panic!("an unchanged durable language must not rewrite config"),
        );

        assert_eq!(result, Err(user_error("language_failed")));
        assert_eq!(state.ui_language(), UiLanguage::English);
        assert_eq!(state.config().ui_language.as_deref(), Some("en"));
    }

    #[test]
    fn available_update_is_discoverable_without_opening_the_native_menu() {
        assert_eq!(
            tray_presentation_tooltip(UiLanguage::English, &RelayPhase::Stopped, false, true,),
            "Relayune · Not connected · Update available"
        );
        assert_eq!(
            tray_presentation_accessibility_label(
                UiLanguage::English,
                &RelayPhase::Stopped,
                false,
                true,
            ),
            "Relayune, Not connected, Update available"
        );
        assert_eq!(
            tray_presentation_tooltip(
                UiLanguage::SimplifiedChinese,
                &RelayPhase::Connected,
                true,
                true,
            ),
            "Relayune · 已连接 · 有更新"
        );
        assert_eq!(
            tray_presentation_accessibility_label(
                UiLanguage::SimplifiedChinese,
                &RelayPhase::Connected,
                true,
                true,
            ),
            "Relayune，已连接，有更新"
        );
        assert_eq!(
            tray_presentation_tooltip(UiLanguage::English, &RelayPhase::Connected, true, false,),
            "Relayune · Connected"
        );
    }

    #[test]
    fn menu_runtime_probe_publishes_show_failures_without_emitting_actions() {
        let app = tauri::test::mock_app();
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            false,
        );
        app.manage(state.clone());
        let diagnostic_events = Arc::new(AtomicUsize::new(0));
        let observed_events = diagnostic_events.clone();
        app.listen("open-diagnostics", move |_| {
            observed_events.fetch_add(1, Ordering::SeqCst);
        });
        let update_events = Arc::new(AtomicUsize::new(0));
        let observed_updates = update_events.clone();
        app.listen("check-for-updates", move |_| {
            observed_updates.fetch_add(1, Ordering::SeqCst);
        });
        let status_payloads = Arc::new(Mutex::new(Vec::new()));
        let observed_status_payloads = status_payloads.clone();
        app.listen("relay-status", move |event| {
            observed_status_payloads
                .lock()
                .unwrap()
                .push(event.payload().to_owned());
        });

        assert_eq!(show_window(app.handle()), Err(user_error("window_failed")));
        for event_id in [
            "open_settings",
            "agent_codex",
            "open_diagnostics",
            "check_updates",
        ] {
            handle_tray_menu_event(app.handle(), event_id);
        }

        assert_eq!(diagnostic_events.load(Ordering::SeqCst), 0);
        assert_eq!(update_events.load(Ordering::SeqCst), 0);
        let logs = state.snapshot().logs;
        assert_eq!(logs.len(), 4);
        assert!(logs
            .iter()
            .all(|line| line.message == user_error("window_failed")));
        let payloads = status_payloads.lock().unwrap();
        assert_eq!(payloads.len(), 4);
        let latest: RelaySnapshot = serde_json::from_str(payloads.last().unwrap()).unwrap();
        assert_eq!(latest.logs.len(), 4);
        assert!(latest
            .logs
            .iter()
            .all(|line| line.message == user_error("window_failed")));
    }

    #[test]
    fn window_restore_does_not_let_unminimize_failure_block_reveal_and_focus() {
        let unminimize_calls = AtomicUsize::new(0);
        let show_calls = AtomicUsize::new(0);
        let focus_calls = AtomicUsize::new(0);

        let result = restore_window_with_hooks(
            || {
                unminimize_calls.fetch_add(1, Ordering::SeqCst);
                Err::<(), ()>(())
            },
            || {
                show_calls.fetch_add(1, Ordering::SeqCst);
                Ok::<(), ()>(())
            },
            || {
                focus_calls.fetch_add(1, Ordering::SeqCst);
                Ok::<(), ()>(())
            },
        );

        assert_eq!(result, Ok(()));
        assert_eq!(unminimize_calls.load(Ordering::SeqCst), 1);
        assert_eq!(show_calls.load(Ordering::SeqCst), 1);
        assert_eq!(focus_calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn window_restore_keeps_required_reveal_failures_actionable() {
        let focus_calls = AtomicUsize::new(0);

        let result = restore_window_with_hooks(
            || Ok::<(), ()>(()),
            || Err::<(), ()>(()),
            || {
                focus_calls.fetch_add(1, Ordering::SeqCst);
                Ok::<(), ()>(())
            },
        );

        assert_eq!(result, Err(user_error("window_failed")));
        assert_eq!(focus_calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn menu_runtime_probe_restores_and_routes_agent_management() {
        let app = tauri::test::mock_app();
        let state = AppState::new(runtime_probe_config("not a valid URL"), true);
        app.manage(state.clone());
        let _window = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock main window should build");
        let diagnostic_events = Arc::new(AtomicUsize::new(0));
        let observed_events = diagnostic_events.clone();
        app.listen("open-diagnostics", move |_| {
            observed_events.fetch_add(1, Ordering::SeqCst);
        });
        let update_events = Arc::new(AtomicUsize::new(0));
        let observed_updates = update_events.clone();
        app.listen("check-for-updates", move |_| {
            observed_updates.fetch_add(1, Ordering::SeqCst);
        });
        let status_events = Arc::new(AtomicUsize::new(0));
        let observed_status_events = status_events.clone();
        app.listen("relay-status", move |_| {
            observed_status_events.fetch_add(1, Ordering::SeqCst);
        });

        assert_eq!(show_window(app.handle()), Ok(()));
        handle_tray_menu_event(app.handle(), "open_diagnostics");
        let agent_events = Arc::new(Mutex::new(Vec::new()));
        let observed_agents = agent_events.clone();
        app.listen("open-agent-management", move |event| {
            observed_agents.lock().unwrap().push(event.payload().to_owned());
        });
        handle_tray_menu_event(app.handle(), "agent_claude");
        handle_tray_menu_event(app.handle(), "agent_unknown");
        handle_tray_menu_event(app.handle(), "open_web");
        handle_tray_menu_event(app.handle(), "check_updates");
        assert_eq!(*agent_events.lock().unwrap(), vec!["\"claude\"".to_owned()]);
        assert_eq!(diagnostic_events.load(Ordering::SeqCst), 1);
        assert_eq!(update_events.load(Ordering::SeqCst), 1);
        assert_eq!(status_events.load(Ordering::SeqCst), 0);
        assert!(state.snapshot().logs.is_empty());
    }

    #[test]
    fn config_recovery_never_treats_the_temporary_server_as_an_authorized_workspace() {
        let app = tauri::test::mock_app();
        let state = AppState::new(runtime_probe_config("not a valid URL"), false);
        state.set_recovery_required(true);
        app.manage(state.clone());
        let _window = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock main window should build");

        assert!(tray_connection_available(&state));
        assert!(!tray_web_workspace_available(&state));
        handle_tray_menu_event(app.handle(), "open_web");

        assert!(
            state.snapshot().logs.is_empty(),
            "the disabled recovery action must restore the window without validating or opening the temporary URL"
        );
    }

    #[test]
    fn startup_flow_keeps_login_visible_but_background_launch_quiet() {
        let signed_out = SecretPresence::default();
        assert_eq!(
            startup_behavior(false, &signed_out, true),
            StartupBehavior {
                show_main_window: true,
                start_relay: false,
            }
        );
        assert_eq!(
            startup_behavior(true, &signed_out, true),
            StartupBehavior {
                show_main_window: false,
                start_relay: false,
            }
        );
    }

    #[test]
    fn missing_native_menu_forces_background_launch_into_windowed_recovery() {
        let state = AppState::new(
            runtime_probe_config("https://relayune.giraffetree.cn"),
            false,
        );
        assert!(!record_native_surface_setup_result(
            &state,
            Err::<(), _>("simulated NSStatusItem failure"),
        ));
        assert_eq!(
            state.snapshot().logs[0].message,
            user_error("startup_failed"),
            "native backend details must collapse to an allow-listed code",
        );
        assert_eq!(
            startup_behavior(true, &SecretPresence::default(), false),
            StartupBehavior {
                show_main_window: true,
                start_relay: false,
            }
        );
    }

    #[test]
    fn startup_flow_only_runs_relay_with_complete_credentials() {
        for (presence, should_start) in [
            (SecretPresence::default(), false),
            (
                SecretPresence {
                    device_token: true,
                    e2ee_key: false,
                },
                false,
            ),
            (
                SecretPresence {
                    device_token: false,
                    e2ee_key: true,
                },
                false,
            ),
            (
                SecretPresence {
                    device_token: true,
                    e2ee_key: true,
                },
                true,
            ),
        ] {
            assert_eq!(
                startup_behavior(true, &presence, true),
                StartupBehavior {
                    show_main_window: false,
                    start_relay: should_start,
                }
            );
        }
    }

    #[test]
    fn existing_instance_only_activates_for_an_interactive_launch() {
        assert!(should_activate_existing_instance(&["Relayune.exe".into()]));
        assert!(should_activate_existing_instance(&[
            "Relayune.exe".into(),
            "--from-shortcut".into(),
        ]));
        assert!(!should_activate_existing_instance(&[
            "Relayune.exe".into(),
            "--background".into(),
        ]));
    }

    #[test]
    fn windows_autostart_quotes_executable_paths_with_spaces() {
        let executable =
            std::path::Path::new(r"C:\Users\Relay User\AppData\Local\Relayune\Relayune.exe");
        assert_eq!(
            windows_autostart_command(executable),
            r#""C:\Users\Relay User\AppData\Local\Relayune\Relayune.exe" --background"#,
        );
    }

    #[test]
    fn windows_autostart_rejects_every_partial_or_unreadable_commit() {
        assert!(windows_autostart_state_is_committed(
            true,
            Ok(true),
            Ok(true)
        ));
        assert!(windows_autostart_state_is_committed(
            false,
            Ok(false),
            Ok(true)
        ));
        for (enabled_after_write, command_is_current) in [
            (Ok(false), Ok(true)),
            (Err(()), Ok(true)),
            (Ok(true), Ok(false)),
            (Ok(true), Err(())),
        ] {
            assert!(!windows_autostart_state_is_committed(
                true,
                enabled_after_write,
                command_is_current
            ));
        }
        assert!(!windows_autostart_state_is_committed(
            false,
            Ok(true),
            Ok(true)
        ));
        assert!(!windows_autostart_state_is_committed(
            false,
            Err(()),
            Ok(true)
        ));
    }

    #[test]
    fn windows_window_contract_fits_common_150_percent_dpi_work_areas() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.windows.conf.json")).unwrap();
        let window = &config["app"]["windows"][0];
        assert_eq!(window["label"], "main");
        assert!(window["visible"].as_bool().is_some_and(|visible| !visible));
        assert!(window["resizable"].as_bool().is_some_and(|value| value));
        assert!(window["width"].as_u64().is_some_and(|width| width <= 520));
        assert!(window["height"]
            .as_u64()
            .is_some_and(|height| height <= 480));
        assert!(window["minWidth"]
            .as_u64()
            .is_some_and(|width| width <= 420));
        assert!(window["minHeight"]
            .as_u64()
            .is_some_and(|height| height <= 420));
    }

    #[test]
    fn tray_copy_is_complete_in_all_supported_languages() {
        for language in [
            UiLanguage::English,
            UiLanguage::SimplifiedChinese,
            UiLanguage::Hindi,
            UiLanguage::Spanish,
            UiLanguage::Arabic,
            UiLanguage::French,
            UiLanguage::Bengali,
            UiLanguage::Portuguese,
            UiLanguage::Indonesian,
            UiLanguage::Urdu,
        ] {
            let copy = TrayCopy::for_language(language);
            for value in [
                copy.diagnostics,
                copy.quit,
                copy.connect_computer,
                copy.show_app,
                copy.check_updates,
                copy.install_update,
                copy.open_web,
                copy.status_prefix,
                copy.not_connected,
                copy.update_available,
                copy.accessibility_separator,
                copy.accessibility_help,
                copy.workspace_picker,
                copy.stopped,
                copy.starting,
                copy.connected,
                copy.stopping,
                copy.attention,
            ] {
                assert!(
                    !value.trim().is_empty(),
                    "missing native copy for {language:?}"
                );
            }
            assert!(!tray_status_text(language, &RelayPhase::Connected).is_empty());
            assert!(!tray_not_connected_accessibility_label(language).is_empty());
        }

        let chinese = TrayCopy::for_language(UiLanguage::SimplifiedChinese);
        assert_eq!(chinese.diagnostics, "帮助与诊断…");
        assert_eq!(chinese.quit, "退出 Relayune");

        let english = TrayCopy::for_language(UiLanguage::English);
        assert_eq!(english.diagnostics, "Help & Diagnostics…");
        assert_eq!(english.quit, "Quit Relayune");

        assert_eq!(
            tray_window_action_text(UiLanguage::SimplifiedChinese, false),
            "连接这台电脑…"
        );
        assert_eq!(
            tray_window_action_text(UiLanguage::English, false),
            "Connect This Computer…"
        );
        assert_eq!(
            tray_window_action_text(UiLanguage::SimplifiedChinese, true),
            "显示 Relayune"
        );
        assert_eq!(
            tray_window_action_text(UiLanguage::English, true),
            "Show Relayune"
        );
        assert_eq!(
            tray_update_action_text(UiLanguage::SimplifiedChinese, false),
            "检查更新…"
        );
        assert_eq!(
            tray_update_action_text(UiLanguage::English, false),
            "Check for Updates…"
        );
        assert_eq!(
            tray_update_action_text(UiLanguage::SimplifiedChinese, true),
            "安装更新…"
        );
        assert_eq!(
            tray_update_action_text(UiLanguage::English, true),
            "Install Update…"
        );
        assert_eq!(
            tray_web_action_text(UiLanguage::SimplifiedChinese),
            "打开 Web 工作台"
        );
        assert_eq!(
            tray_web_action_text(UiLanguage::English),
            "Open Web Workspace"
        );
        assert_eq!(
            TrayCopy::for_language(UiLanguage::Arabic).workspace_picker,
            "اختيار مجلد العمل الافتراضي في Relayune"
        );
        assert_eq!(
            tray_not_connected_accessibility_label(UiLanguage::Arabic),
            "Relayune، غير متصل"
        );
        assert_eq!(
            tray_accessibility_label(UiLanguage::Urdu, &RelayPhase::Connected),
            "Relayune، منسلک"
        );
    }

    #[test]
    fn unpaired_menu_status_is_distinct_from_a_stopped_paired_relay() {
        assert_eq!(
            tray_not_connected_status_text(UiLanguage::SimplifiedChinese),
            "状态：尚未连接"
        );
        assert_eq!(
            tray_not_connected_status_text(UiLanguage::English),
            "Status: Not connected"
        );
        assert_eq!(
            tray_not_connected_tooltip(UiLanguage::SimplifiedChinese),
            "Relayune · 尚未连接"
        );
        assert_eq!(
            tray_not_connected_accessibility_label(UiLanguage::English),
            "Relayune, Not connected"
        );
        assert_eq!(
            tray_status_text(UiLanguage::SimplifiedChinese, &RelayPhase::Stopped),
            "状态：已停止"
        );
        assert_eq!(
            tray_status_text(UiLanguage::English, &RelayPhase::Stopped),
            "Status: Stopped"
        );
    }

    #[test]
    fn tray_status_and_tooltip_localize_every_phase() {
        let cases = [
            (RelayPhase::Stopped, "已停止", "Stopped"),
            (RelayPhase::Starting, "正在连接", "Connecting"),
            (RelayPhase::Connected, "已连接", "Connected"),
            (RelayPhase::Stopping, "正在停止", "Stopping"),
            (RelayPhase::Error, "需要处理", "Needs attention"),
        ];

        for (phase, chinese, english) in cases {
            assert_eq!(
                tray_phase_label(UiLanguage::SimplifiedChinese, &phase),
                chinese
            );
            assert_eq!(tray_phase_label(UiLanguage::English, &phase), english);
            assert_eq!(
                tray_status_text(UiLanguage::English, &phase),
                format!("Status: {english}")
            );
            assert_eq!(
                tray_tooltip(UiLanguage::SimplifiedChinese, &phase),
                format!("Relayune · {chinese}")
            );
            assert_eq!(
                tray_accessibility_label(UiLanguage::SimplifiedChinese, &phase),
                format!("Relayune，{chinese}")
            );
            assert_eq!(
                tray_accessibility_label(UiLanguage::English, &phase),
                format!("Relayune, {english}")
            );
        }
        assert_eq!(
            tray_accessibility_help(UiLanguage::SimplifiedChinese),
            "打开 Relayune 菜单"
        );
        assert_eq!(
            tray_accessibility_help(UiLanguage::English),
            "Open the Relayune menu"
        );
    }

    #[test]
    fn public_pages_are_fixed_and_localized() {
        let origin = "https://relayune.giraffetree.cn/";
        assert_eq!(
            public_page_destination_url(origin, "terms", "zh-CN").unwrap(),
            "https://relayune.giraffetree.cn/zh/legal/terms/"
        );
        assert_eq!(
            public_page_destination_url(origin, "privacy", "ar").unwrap(),
            "https://relayune.giraffetree.cn/ar/legal/privacy/"
        );
        assert_eq!(public_page_destination_url(origin, "changelog", "zh-CN").unwrap(), "https://relayune.giraffetree.cn/zh/changelog/");
        assert!(public_page_destination_url(origin, "checkout", "en").is_err());
        assert!(public_page_destination_url(origin, "account", "en").is_err());
        assert!(public_page_destination_url(origin, "apple", "en").is_err());
        assert!(public_page_destination_url(origin, "terms", "de").is_err());
    }
}
