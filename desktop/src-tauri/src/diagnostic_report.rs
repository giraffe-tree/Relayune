//! User-previewable, bounded report. Never return raw log lines to the WebView.
use std::{collections::BTreeMap, fs, io::Read, path::Path};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

const MAX_FILE: u64 = 1024 * 1024 + 4096;
const MAX_REPORT: usize = 3800;
const EVENTS: &[&str] = &[
    "desktop_started", "desktop_exit_requested", "desktop_exited", "start_requested",
    "sidecar_environment_sanitized", "stderr_module_not_found", "stderr_pkg_entrypoint",
    "spawned", "connected", "stop_requested", "preflight_failed", "start_failed",
    "terminated_requested", "terminated_unexpected", "terminated_stale_generation",
    "automatic_restart_scheduled", "automatic_restart_stopped", "process_observer_error",
    "process_stream_closed", "relay_reconnecting", "relay_sync_warning", "stderr_limit_reached",
    "stderr_address_in_use", "stderr_permission_denied", "stderr_database_busy", "stderr_disk_full",
    "stderr_out_of_memory", "stderr_not_found", "stderr_unclassified", "startup_local_state", "startup_agents",
    "startup_registration", "startup_initial_sync", "startup_polling", "startup_hooks",
    "startup_unauthorized", "startup_network", "startup_timeout", "startup_server",
    "phase_local_state", "phase_agents", "phase_registration", "phase_initial_sync", "phase_polling", "phase_hooks",
    "fatal_uncaught_exception", "fatal_unhandled_rejection", "fatal_network", "fatal_timeout",
    "fatal_permission_denied", "fatal_disk_full", "fatal_out_of_memory", "fatal_unknown",
];

#[derive(Serialize)]
pub struct Report {
    pub text: String,
    pub event_count: usize,
    pub unexpected_exits: usize,
    pub limited: bool,
}

pub fn collect(app: &AppHandle) -> Result<Report, String> {
    let directory = app.path().app_log_dir().map_err(|_| "relayune:diagnostics_failed")?;
    let _guard = crate::relay_diagnostics::WRITER.lock().unwrap_or_else(|e| e.into_inner());
    collect_directory(&directory, chrono::Utc::now().timestamp())
        .map_err(|_| "relayune:diagnostics_failed".to_string())
}

fn collect_directory(directory: &Path, now: i64) -> std::io::Result<Report> {
    let mut rows = Vec::new();
    for name in ["relay-lifecycle.previous.jsonl", "relay-lifecycle.jsonl"] {
        let path = directory.join(name);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        if !metadata.file_type().is_file() || metadata.len() > MAX_FILE {
            return Err(std::io::Error::other("invalid diagnostic file"));
        }
        let mut text = String::new();
        fs::File::open(path)?.take(MAX_FILE).read_to_string(&mut text)?;
        for line in text.lines() {
            if let Ok(value) = serde_json::from_str::<Value>(line) {
                if let Some(row) = safe_row(&value, now) { rows.push(row); }
            }
        }
    }
    Ok(format_report(rows))
}

struct Row {
    at: i64,
    // Used only to group runs inside this one report; the PID is never exported.
    desktop: u64,
    generation: u64,
    version: String,
    event: String,
    code: Option<i64>,
    signal: Option<i64>,
    elapsed: Option<u64>,
}

fn safe_row(value: &Value, now: i64) -> Option<Row> {
    let at = chrono::DateTime::parse_from_rfc3339(value.get("at")?.as_str()?).ok()?.timestamp();
    if at < now - 7 * 24 * 60 * 60 || at > now + 120 { return None; }
    let event = value.get("event")?.as_str()?;
    if !EVENTS.contains(&event) { return None; }
    let version = value.get("version")?.as_str()?;
    if version.is_empty() || version.len() > 32 || !version.bytes().all(|c| c.is_ascii_digit() || c == b'.') { return None; }
    Some(Row {
        at, desktop: value.get("desktop_pid")?.as_u64()?,
        generation: value.get("generation")?.as_u64()?.min(999_999),
        version: version.into(), event: event.into(),
        code: value.get("exit_code").and_then(Value::as_i64).filter(|v| (-2_147_483_648..=2_147_483_647).contains(v)),
        signal: value.get("signal").and_then(Value::as_i64).filter(|v| (1..=128).contains(v)),
        elapsed: value.get("elapsed_ms").and_then(Value::as_u64).filter(|v| *v <= 365 * 24 * 60 * 60 * 1000),
    })
}

fn format_report(mut rows: Vec<Row>) -> Report {
    rows.sort_by_key(|r| r.at);
    let unexpected_exits = rows.iter().filter(|r| r.event == "terminated_unexpected").count();
    let mut runs = BTreeMap::new();
    let mut lines = Vec::new();
    let mut next_run = 0;
    for row in &rows {
        if row.event == "desktop_started" || !runs.contains_key(&row.desktop) {
            next_run += 1;
            runs.insert(row.desktop, next_run);
        }
        let run = runs[&row.desktop];
        let time = chrono::DateTime::from_timestamp(row.at, 0).unwrap().format("%Y-%m-%dT%H:%M:%SZ");
        let mut line = format!("{time} run={run}/{} v={} {}", row.generation, row.version, row.event);
        if let Some(code) = row.code { line.push_str(&format!(" code={code}")); }
        if let Some(signal) = row.signal { line.push_str(&format!(" signal={signal}")); }
        if let Some(elapsed) = row.elapsed { line.push_str(&format!(" ms={elapsed}")); }
        lines.push(line);
    }
    let mut text = format!("Relayune exit diagnostics v1\nWindow: last 7 days (available local records)\nUnexpected Relay exits: {unexpected_exits}\nTimes: UTC; run numbers are report-local; ms: process uptime\n");
    // Keep failure evidence even if recent healthy runs have filled the tail.
    let mut selected = std::collections::BTreeSet::new();
    let mut size = text.len() + 70;
    let important = |r: &Row| r.event == "terminated_unexpected" || r.event.starts_with("startup_") || r.event.starts_with("fatal_") || matches!(r.event.as_str(), "stderr_module_not_found" | "stderr_pkg_entrypoint" | "sidecar_environment_sanitized");
    for priority in [true, false] {
        for (index, row) in rows.iter().enumerate().rev() {
            if important(row) != priority || size + lines[index].len() + 1 > MAX_REPORT { continue; }
            size += lines[index].len() + 1;
            selected.insert(index);
        }
    }
    let limited = selected.len() < rows.len();
    text.push_str(&format!("Events included: {}/{}; limited={}\n", selected.len(), rows.len(), limited));
    for index in &selected { text.push_str(&lines[*index]); text.push('\n'); }
    Report { text, event_count: selected.len(), unexpected_exits, limited }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn row(event: &str) -> Value {
        serde_json::json!({"at":"2026-09-25T06:00:00Z", "version":"0.3.24", "desktop_pid":912345,
            "generation":1, "event":event,"exit_code":1,"signal":11,"elapsed_ms":5200,
            "secret":"CANARY private token /Users/private"})
    }
    fn now() -> i64 { 1790316000 }
    #[test]
    fn report_exports_only_whitelisted_fields_and_normalizes_identifiers() {
        let safe = safe_row(&row("terminated_unexpected"), now()).unwrap();
        let report = format_report(vec![safe]);
        assert_eq!(report.unexpected_exits, 1);
        assert!(report.text.contains("code=1 signal=11 ms=5200"));
        assert!(!report.text.contains("CANARY"));
        assert!(!report.text.contains("912345"));
        assert!(!report.text.contains("/Users"));
        assert!(safe_row(&row("CANARY private message"), now()).is_none());
        let mut bad = row("connected"); bad["version"] = Value::String("private-token".into());
        assert!(safe_row(&bad, now()).is_none());
        assert!(safe_row(&row("connected"), now() + 8 * 86400).is_none());
    }
    #[test]
    fn bounded_report_preserves_failures_before_noisy_reconnections() {
        let mut rows = vec![safe_row(&row("terminated_unexpected"), now()).unwrap()];
        for event in ["stderr_module_not_found", "stderr_pkg_entrypoint", "sidecar_environment_sanitized"] {
            rows.push(safe_row(&row(event), now()).unwrap());
        }
        for _ in 0..500 { rows.push(safe_row(&row("connected"), now()).unwrap()); }
        let report = format_report(rows);
        assert!(report.text.len() <= MAX_REPORT);
        assert!(report.limited);
        assert!(report.text.contains("terminated_unexpected"));
        assert!(report.text.contains("stderr_module_not_found"));
        assert!(report.text.contains("stderr_pkg_entrypoint"));
        assert!(report.text.contains("sidecar_environment_sanitized"));
        assert!(!report.text.contains("CANARY"));
    }
    #[test]
    fn reused_os_pid_is_not_treated_as_one_application_run() {
        let rows = ["desktop_started", "terminated_unexpected", "desktop_started", "connected"]
            .iter().map(|event| safe_row(&row(event), now()).unwrap()).collect();
        let report = format_report(rows);
        assert!(report.text.contains("run=1/1"));
        assert!(report.text.contains("run=2/1"));
    }
    #[cfg(unix)]
    #[test]
    fn reports_refuse_symlinked_log_files() {
        let dir = std::env::temp_dir().join(format!("report-symlink-{}", rand::random::<u64>()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("private"), "CANARY").unwrap();
        std::os::unix::fs::symlink(dir.join("private"), dir.join("relay-lifecycle.jsonl")).unwrap();
        assert!(collect_directory(&dir, now()).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn rotated_files_survive_restart_and_corrupt_lines_are_ignored() {
        let dir = std::env::temp_dir().join(format!("report-test-{}",rand::random::<u64>()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("relay-lifecycle.previous.jsonl"), format!("{}\n", row("terminated_unexpected"))).unwrap();
        fs::write(dir.join("relay-lifecycle.jsonl"), format!("{}\npartial", row("connected"))).unwrap();
        let report = collect_directory(&dir, now()).unwrap();
        assert_eq!(report.event_count, 2);
        assert_eq!(report.unexpected_exits, 1);
        fs::remove_dir_all(dir).unwrap();
    }
}
