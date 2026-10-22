//! Local, bounded lifecycle diagnostics. Never persist raw child output or errors.
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    sync::Mutex,
};
use tauri::{AppHandle, Manager};
pub(crate) static WRITER: Mutex<()> = Mutex::new(());
const LIMIT: u64 = 1024 * 1024;

pub fn record(
    app: &AppHandle,
    event: &'static str,
    generation: u64,
    pid: Option<u32>,
    code: Option<i32>,
    signal: Option<i32>,
) {
    record_timed(app, event, generation, pid, code, signal, None);
}

pub fn record_timed(
    app: &AppHandle, event: &'static str, generation: u64, pid: Option<u32>,
    code: Option<i32>, signal: Option<i32>, elapsed_ms: Option<u64>,
) {
    let Ok(directory) = app.path().app_log_dir() else {
        return;
    };
    let row = serde_json::json!({"at": chrono::Utc::now().to_rfc3339(), "version": app.package_info().version.to_string(), "desktop_pid": std::process::id(), "event": event, "generation": generation, "relay_pid": pid, "exit_code": code, "signal": signal, "elapsed_ms": elapsed_ms, "schema_version": 2});
    let _guard = WRITER.lock().unwrap_or_else(|e| e.into_inner());
    // Diagnostics must never prevent startup/reconnect when the disk is unavailable.
    if append(&directory, &row.to_string(), LIMIT).is_err() {
        eprintln!("relayune:diagnostic_write_failed");
    }
}

fn append(directory: &Path, row: &str, limit: u64) -> std::io::Result<()> {
    fs::create_dir_all(directory)?;
    let path = directory.join("relay-lifecycle.jsonl");
    if fs::metadata(&path)
        .map(|m| m.len() >= limit)
        .unwrap_or(false)
    {
        let previous = directory.join("relay-lifecycle.previous.jsonl");
        if previous.exists() {
            fs::remove_file(&previous)?;
        }
        fs::rename(&path, previous)?;
    }
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    writeln!(file, "{row}")?;
    file.flush()
}

// Only fixed categories cross the diagnostic boundary. Payloads can contain
// credentials, paths, URLs or conversation text, even on stderr.
pub fn stderr_category(line: &str) -> &'static str {
    // Match the complete allowlisted line; never persist remote error text.
    match line {
        "relayune:fatal:uncaught_exception" => return "fatal_uncaught_exception",
        "relayune:fatal:unhandled_rejection" => return "fatal_unhandled_rejection",
        "relayune:fatal:network" => return "fatal_network",
        "relayune:fatal:timeout" => return "fatal_timeout",
        "relayune:fatal:permission_denied" => return "fatal_permission_denied",
        "relayune:fatal:disk_full" => return "fatal_disk_full",
        "relayune:fatal:out_of_memory" => return "fatal_out_of_memory",
        "relayune:fatal:unknown" => return "fatal_unknown",
        _ => {}
    }
    match line {
        "Relayune Relay startup failed: local_state" | "Relayune Relay startup timed out: local_state" => return "startup_local_state",
        "Relayune Relay startup failed: agents" | "Relayune Relay startup timed out: agents" => return "startup_agents",
        "Relayune Relay startup failed: registration" | "Relayune Relay startup timed out: registration" => return "startup_registration",
        "Relayune Relay startup failed: initial_sync" | "Relayune Relay startup timed out: initial_sync" => return "startup_initial_sync",
        "Relayune Relay startup failed: polling" | "Relayune Relay startup timed out: polling" => return "startup_polling",
        "Relayune Relay startup failed: hooks" | "Relayune Relay startup timed out: hooks" => return "startup_hooks",
        "Relayune Relay startup cause: unauthorized" => return "startup_unauthorized",
        "Relayune Relay startup cause: network" => return "startup_network",
        "Relayune Relay startup cause: timeout" => return "startup_timeout",
        "Relayune Relay startup cause: server" => return "startup_server",
        _ => {}
    }
    if line.starts_with("Relayune Relay reconnecting:") {
        "relay_reconnecting"
    } else if line.starts_with("Relayune Relay sync warning:") {
        "relay_sync_warning"
    } else if line.contains("EADDRINUSE") {
        "stderr_address_in_use"
    } else if line.contains("EACCES") || line.contains("EPERM") {
        "stderr_permission_denied"
    } else if line.contains("SQLITE_BUSY") || line.contains("database is locked") {
        "stderr_database_busy"
    } else if line.contains("ENOSPC") {
        "stderr_disk_full"
    } else if line.contains("ENOMEM") || line.contains("heap out of memory") {
        "stderr_out_of_memory"
    } else if line.contains("MODULE_NOT_FOUND") || line.contains("Cannot find module") {
        "stderr_module_not_found"
    } else if line.contains("PKG_DUMMY_ENTRYPOINT") {
        "stderr_pkg_entrypoint"
    } else if line.contains("ENOENT") {
        "stderr_not_found"
    } else {
        "stderr_unclassified"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn output_is_classified_without_retaining_payload() {
        for (input, expected) in [
            ("EACCES /private/token secret", "stderr_permission_denied"),
            ("Authorization: secret", "stderr_unclassified"),
            ("Error: Cannot find module '/private/path/relay'", "stderr_module_not_found"),
            ("code: 'MODULE_NOT_FOUND'", "stderr_module_not_found"),
            ("Error: PKG_DUMMY_ENTRYPOINT EXPECTED", "stderr_pkg_entrypoint"),
            ("relayune:fatal:unhandled_rejection", "fatal_unhandled_rejection"),
            ("relayune:fatal:network CANARY", "stderr_unclassified"),
            ("Relayune Relay startup failed: registration", "startup_registration"),
            ("Relayune Relay startup timed out: initial_sync", "startup_initial_sync"),
            ("Relayune Relay startup cause: unauthorized", "startup_unauthorized"),
            ("Relayune Relay startup cause: network private-token", "stderr_unclassified"),
            ("Relayune Relay startup failed: private conversation", "stderr_unclassified"),
            ("SQLITE_BUSY private conversation", "stderr_database_busy"),
        ] {
            assert_eq!(stderr_category(input), expected);
        }
    }
    #[test]
    fn progress_only_accepts_exact_safe_stage_markers() {
        assert_eq!(startup_phase("relayune:startup_phase:registration"), Some("phase_registration"));
        assert_eq!(startup_phase("relayune:startup_phase:registration CANARY"), None);
        assert_eq!(startup_phase("relayune:startup_phase:private conversation"), None);
    }
    #[test]
    fn logs_survive_reopen_and_rotate_with_private_permissions() {
        let dir = std::env::temp_dir().join(format!(
            "relay-diag-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        append(&dir, "first", 10).unwrap();
        append(&dir, "second", 10).unwrap();
        append(&dir, "third", 10).unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("relay-lifecycle.previous.jsonl")).unwrap(),
            "first\nsecond\n"
        );
        assert_eq!(
            fs::read_to_string(dir.join("relay-lifecycle.jsonl")).unwrap(),
            "third\n"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(dir.join("relay-lifecycle.jsonl"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        fs::remove_dir_all(dir).unwrap();
    }
}

// Startup progress travels over stdout; only these exact markers are retained.
pub fn startup_phase(line: &str) -> Option<&'static str> {
    match line {
        "relayune:startup_phase:local_state" => Some("phase_local_state"),
        "relayune:startup_phase:agents" => Some("phase_agents"),
        "relayune:startup_phase:registration" => Some("phase_registration"),
        "relayune:startup_phase:initial_sync" => Some("phase_initial_sync"),
        "relayune:startup_phase:polling" => Some("phase_polling"),
        "relayune:startup_phase:hooks" => Some("phase_hooks"),
        _ => None,
    }
}
