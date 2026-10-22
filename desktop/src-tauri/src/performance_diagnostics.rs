//! Local resource and timing diagnostics; never retain child output or errors.
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender},
        Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant, SystemTime},
};
use tauri::{AppHandle, Manager};

const PREFIX: &str = "relayune:performance:";
const MAX_LINE_BYTES: usize = 4096;
const FILE_LIMIT: u64 = 2 * 1024 * 1024;
const RETENTION: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const INTERVAL: Duration = Duration::from_secs(15);
const MAX_MEMORY_BYTES: u64 = 1024 * 1024 * 1024 * 1024;
const MAX_CPU_PERCENT: f64 = 100_000.0;
const DAY_MS: f64 = 86_400_000.0;
static STARTED: AtomicBool = AtomicBool::new(false);
static QUEUE: OnceLock<SyncSender<String>> = OnceLock::new();
static CHILD_RATE: Mutex<RateLimit> = Mutex::new(RateLimit {
    since: None,
    count: 0,
});

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "event", rename_all = "snake_case", deny_unknown_fields)]
enum ChildEvent {
    RelaySample {
        rss_bytes: u64,
        heap_used_bytes: u64,
        heap_total_bytes: u64,
        external_bytes: u64,
        cpu_percent: f64,
        event_loop_delay_max_ms: f64,
        uptime_ms: f64,
        sample_interval_ms: f64,
    },
    OperationTiming {
        operation: Operation,
        count: u64,
        failed: u64,
        total_ms: f64,
        max_ms: f64,
    },
    StartupPhase {
        phase: StartupPhase,
        duration_ms: f64,
        status: PhaseStatus,
    },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum Operation {
    LocalState,
    Agents,
    Registration,
    InitialSync,
    Polling,
    Hooks,
    HistoryRead,
    CatalogSync,
    RemoteFetch,
    HistoryWarm,
    AttachmentRecovery,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum StartupPhase {
    Bootstrap,
    LocalState,
    Agents,
    Registration,
    InitialSync,
    Polling,
    Hooks,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum PhaseStatus {
    Ok,
    Failed,
}

fn bounded(value: f64, max: f64) -> bool {
    value.is_finite() && value >= 0.0 && value <= max
}

fn parse_child(payload: &str) -> Option<ChildEvent> {
    if payload.len() > MAX_LINE_BYTES {
        return None;
    }
    let event: ChildEvent = serde_json::from_str(payload).ok()?;
    let valid = match &event {
        ChildEvent::RelaySample {
            rss_bytes,
            heap_used_bytes,
            heap_total_bytes,
            external_bytes,
            cpu_percent,
            event_loop_delay_max_ms,
            uptime_ms,
            sample_interval_ms,
        } => {
            [rss_bytes, heap_used_bytes, heap_total_bytes, external_bytes]
                .iter()
                .all(|value| **value <= MAX_MEMORY_BYTES)
                && heap_used_bytes <= heap_total_bytes
                && bounded(*cpu_percent, MAX_CPU_PERCENT)
                && bounded(*event_loop_delay_max_ms, 31.0 * DAY_MS)
                && bounded(*uptime_ms, 3660.0 * DAY_MS)
                && bounded(*sample_interval_ms, 31.0 * DAY_MS)
        }
        ChildEvent::OperationTiming {
            count,
            failed,
            total_ms,
            max_ms,
            ..
        } => {
            *count > 0
                && *count <= 10_000_000
                && failed <= count
                && bounded(*total_ms, 366.0 * DAY_MS)
                && bounded(*max_ms, 7.0 * DAY_MS)
                && max_ms <= total_ms
        }
        ChildEvent::StartupPhase { duration_ms, .. } => bounded(*duration_ms, 7.0 * DAY_MS),
    };
    valid.then_some(event)
}

struct RateLimit {
    since: Option<Instant>,
    count: u32,
}

impl RateLimit {
    fn admit(&mut self, now: Instant) -> bool {
        if self
            .since
            .is_none_or(|since| now.saturating_duration_since(since) >= INTERVAL)
        {
            self.since = Some(now);
            self.count = 0;
        }
        if self.count >= 64 {
            return false;
        }
        self.count += 1;
        true
    }
}

/// Consume every prefixed line, including malformed or throttled payloads, so
/// none can fall through to a generic child-output logger.
pub fn record_child(app: &AppHandle, generation: u64, pid: Option<u32>, line: &str) -> bool {
    let Some(payload) = line.strip_prefix(PREFIX) else {
        return false;
    };
    if line.len() > MAX_LINE_BYTES || !cfg!(target_os = "macos") {
        return true;
    }
    let Ok(mut rate) = CHILD_RATE.try_lock() else {
        return true;
    };
    if !rate.admit(Instant::now()) {
        return true;
    }
    drop(rate);
    if let Some(event) = parse_child(payload) {
        enqueue(app, generation, pid, &event);
    }
    true
}

pub fn record_connection(
    app: &AppHandle,
    generation: u64,
    pid: Option<u32>,
    kind: &str,
    elapsed_ms: u64,
) {
    if !matches!(kind, "startup" | "reconnect") || elapsed_ms > 7 * 86_400_000 {
        return;
    }
    enqueue(
        app,
        generation,
        pid,
        &serde_json::json!({
            "event": "connection_timing", "kind": kind, "elapsed_ms": elapsed_ms,
        }),
    );
}

fn row(
    app: &AppHandle,
    generation: u64,
    pid: Option<u32>,
    event: &impl Serialize,
) -> Option<String> {
    let mut value = serde_json::to_value(event).ok()?;
    let fields = value.as_object_mut()?;
    fields.insert(
        "version".into(),
        app.package_info().version.to_string().into(),
    );
    fields.insert("at".into(), chrono::Utc::now().to_rfc3339().into());
    fields.insert("desktop_pid".into(), std::process::id().into());
    fields.insert("generation".into(), generation.into());
    fields.insert("relay_pid".into(), serde_json::to_value(pid).ok()?);
    serde_json::to_string(&value).ok()
}

fn enqueue(app: &AppHandle, generation: u64, pid: Option<u32>, event: &impl Serialize) {
    if let (Some(queue), Some(row)) = (QUEUE.get(), row(app, generation, pid, event)) {
        // No disk I/O or queue wait on the native event/child reader threads.
        let _ = queue.try_send(row);
    }
}

pub fn start(app: AppHandle, state: AppState) {
    if !cfg!(target_os = "macos") || STARTED.swap(true, Ordering::Relaxed) {
        return;
    }
    let Ok(directory) = app.path().app_log_dir() else {
        STARTED.store(false, Ordering::Relaxed);
        return;
    };
    let (sender, receiver) = mpsc::sync_channel::<String>(128);
    let started = thread::Builder::new()
        .name("relay-performance".into())
        .spawn(move || {
            let mut next_sample = Instant::now();
            loop {
                // Check the clock even while the child fills the queue continuously.
                if Instant::now() >= next_sample {
                    if let Some(sample) = process_sample(&app, &state) {
                        let _ = append(&directory, &sample, FILE_LIMIT, SystemTime::now());
                    }
                    next_sample = Instant::now() + INTERVAL;
                }
                match receiver.recv_timeout(next_sample.saturating_duration_since(Instant::now())) {
                    Ok(row) => {
                        let _ = append(&directory, &row, FILE_LIMIT, SystemTime::now());
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });
    if started.is_ok() {
        let _ = QUEUE.set(sender);
    } else {
        STARTED.store(false, Ordering::Relaxed);
    }
}

fn runtime_identity(state: &AppState) -> Option<(u64, Option<u32>, &'static str)> {
    use crate::model::RelayPhase;
    let runtime = state.inner.runtime.try_lock().ok()?;
    let phase = match runtime.phase {
        RelayPhase::Stopped => "stopped",
        RelayPhase::Starting => "starting",
        RelayPhase::Connected => "connected",
        RelayPhase::Stopping => "stopping",
        RelayPhase::Error => "error",
    };
    Some((runtime.generation, runtime.pid, phase))
}

#[derive(Debug, PartialEq)]
struct ProcessUsage {
    pid: u32,
    ppid: u32,
    rss_bytes: u64,
    cpu_percent: f64,
}

fn parse_ps(output: &str, allowed: &[u32]) -> Option<Vec<ProcessUsage>> {
    if output.len() > 1024 {
        return None;
    }
    let mut result = Vec::new();
    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let fields: Vec<_> = line.split_whitespace().collect();
        if fields.len() != 4 {
            return None;
        }
        let pid = fields[0].parse().ok()?;
        let ppid = fields[1].parse().ok()?;
        let rss_bytes = fields[2].parse::<u64>().ok()?.checked_mul(1024)?;
        let cpu_percent = fields[3].parse::<f64>().ok()?;
        if !allowed.contains(&pid)
            || result.iter().any(|entry: &ProcessUsage| entry.pid == pid)
            || rss_bytes > MAX_MEMORY_BYTES
            || !bounded(cpu_percent, MAX_CPU_PERCENT)
        {
            return None;
        }
        result.push(ProcessUsage {
            pid,
            ppid,
            rss_bytes,
            cpu_percent,
        });
    }
    Some(result)
}

fn wait_bounded(child: &mut Child, timeout: Duration) -> Option<ExitStatus> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

fn sample_pids(pids: &[u32]) -> Option<Vec<ProcessUsage>> {
    if pids.is_empty() || pids.len() > 2 || pids.contains(&0) {
        return None;
    }
    let selection = pids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let mut child = Command::new("/bin/ps")
        .args(["-p", &selection, "-o", "pid=,ppid=,rss=,%cpu="])
        .env_clear()
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    if !wait_bounded(&mut child, Duration::from_secs(2))?.success() {
        return None;
    }
    let mut output = String::new();
    child
        .stdout
        .take()?
        .take(1025)
        .read_to_string(&mut output)
        .ok()?;
    parse_ps(&output, pids)
}

fn process_sample(app: &AppHandle, state: &AppState) -> Option<String> {
    let desktop_pid = std::process::id();
    let initial = runtime_identity(state);
    let (generation, pid, phase) = initial.unwrap_or((0, None, "unavailable"));
    let mut pids = vec![desktop_pid];
    if let Some(pid) = pid.filter(|pid| *pid != 0 && *pid != desktop_pid) {
        pids.push(pid);
    }
    let resources = sample_pids(&pids).unwrap_or_default();
    let desktop = resources.iter().find(|entry| entry.pid == desktop_pid);
    // Never attach an exited/replaced Relay's measurements to a newer runtime.
    let relay = resources.iter().find(|entry| {
        Some(entry.pid) == pid
            && entry.pid != desktop_pid
            && entry.ppid == desktop_pid
            && initial == runtime_identity(state)
    });
    row(
        app,
        generation,
        pid,
        &serde_json::json!({
            "event": "process_sample", "phase": phase,
            "desktop_rss_bytes": desktop.map(|entry| entry.rss_bytes),
            "desktop_cpu_percent": desktop.map(|entry| entry.cpu_percent),
            "relay_rss_bytes": relay.map(|entry| entry.rss_bytes),
            "relay_cpu_percent": relay.map(|entry| entry.cpu_percent),
        }),
    )
}

fn log_path(directory: &Path, archive: usize) -> PathBuf {
    directory.join(if archive == 0 {
        "performance.jsonl".into()
    } else {
        format!("performance.{archive}.jsonl")
    })
}

fn oldest_record_time(path: &Path, metadata: &fs::Metadata) -> std::io::Result<SystemTime> {
    #[derive(Deserialize)]
    struct Timestamp {
        at: chrono::DateTime<chrono::FixedOffset>,
    }
    // An actively appended file has a fresh mtime even when its first record is
    // old. Read one bounded prefix, never scan or retain historical payloads.
    let mut prefix = Vec::new();
    fs::File::open(path)?
        .take(MAX_LINE_BYTES as u64 + 1)
        .read_to_end(&mut prefix)?;
    let first = prefix
        .split(|byte| *byte == b'\n')
        .next()
        .unwrap_or_default();
    if first.len() <= MAX_LINE_BYTES {
        if let Ok(timestamp) = serde_json::from_slice::<Timestamp>(first) {
            return Ok(timestamp.at.into());
        }
    }
    // Empty/partial/legacy records have no usable timestamp. Birth time keeps
    // repeated appends from refreshing their age; mtime covers older platforms.
    metadata
        .created()
        .ok()
        .into_iter()
        .chain(metadata.modified().ok())
        .min()
        .ok_or_else(|| std::io::ErrorKind::InvalidData.into())
}

fn prune(directory: &Path, limit: u64, now: SystemTime) -> std::io::Result<()> {
    for index in 0..=4 {
        let path = log_path(directory, index);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        if !metadata.is_file() {
            return Err(std::io::ErrorKind::InvalidInput.into());
        }
        if metadata.len() > limit
            || now
                .duration_since(oldest_record_time(&path, &metadata)?)
                .unwrap_or_default()
                >= RETENTION
        {
            fs::remove_file(path)?;
        } else {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
            }
        }
    }
    Ok(())
}

fn append(directory: &Path, row: &str, limit: u64, now: SystemTime) -> std::io::Result<()> {
    let size = row.len() as u64 + 1;
    if size > limit {
        return Ok(());
    }
    fs::create_dir_all(directory)?;
    prune(directory, limit, now)?;
    let path = log_path(directory, 0);
    if fs::metadata(&path)
        .map(|m| m.len().saturating_add(size) > limit)
        .unwrap_or(false)
    {
        let oldest = log_path(directory, 4);
        if oldest.exists() {
            fs::remove_file(oldest)?;
        }
        for index in (0..4).rev() {
            let source = log_path(directory, index);
            if source.exists() {
                fs::rename(source, log_path(directory, index + 1))?;
            }
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> serde_json::Value {
        serde_json::json!({"event":"relay_sample", "rss_bytes":1024, "heap_used_bytes":512,
            "heap_total_bytes":1024,"external_bytes":256,"cpu_percent":5.5,
            "event_loop_delay_max_ms":10.0,"uptime_ms":3000.0,"sample_interval_ms":15000.0})
    }

    #[test]
    fn child_schema_allows_only_fixed_events_and_numeric_fields() {
        assert!(parse_child(&sample().to_string()).is_some());
        for phase in [
            "bootstrap",
            "local_state",
            "agents",
            "registration",
            "initial_sync",
            "polling",
            "hooks",
        ] {
            for status in ["ok", "failed"] {
                let value = serde_json::json!({"event":"startup_phase", "phase":phase, "duration_ms":10.0, "status":status});
                assert!(parse_child(&value.to_string()).is_some());
            }
        }
        for operation in [
            "local_state",
            "agents",
            "registration",
            "initial_sync",
            "polling",
            "hooks",
            "history_read",
            "catalog_sync",
            "remote_fetch",
            "history_warm",
            "attachment_recovery",
        ] {
            let value = serde_json::json!({"event":"operation_timing", "operation":operation, "count":2, "failed":1, "total_ms":10.0, "max_ms":8.0});
            assert!(parse_child(&value.to_string()).is_some());
        }
        for (field, bad) in [
            ("rss_bytes", serde_json::json!(-1)),
            ("cpu_percent", serde_json::json!(1e100)),
            ("uptime_ms", serde_json::json!("secret")),
            ("heap_used_bytes", serde_json::json!(2048)),
            ("unknown", serde_json::json!("/private/secret")),
            ("cpu_percent", serde_json::Value::Null),
        ] {
            let mut value = sample();
            value[field] = bad;
            assert!(parse_child(&value.to_string()).is_none(), "{field}");
        }
        for bad in ["{\"event\":\"relay_sample\",\"cpu_percent\":NaN}",
            "{\"event\":\"startup_phase\",\"phase\":\"agents/private\",\"duration_ms\":1,\"status\":\"ok\"}",
            "{\"event\":\"operation_timing\",\"operation\":\"history_read\",\"count\":1,\"failed\":2,\"total_ms\":1,\"max_ms\":1}"] {
            assert!(parse_child(bad).is_none());
        }
        assert!(parse_child(&" ".repeat(MAX_LINE_BYTES + 1)).is_none());
    }

    #[test]
    fn child_rate_is_bounded_across_generations_and_recovers() {
        let start = Instant::now();
        let mut rate = RateLimit {
            since: None,
            count: 0,
        };
        for _ in 0..64 {
            assert!(rate.admit(start));
        }
        assert!(!rate.admit(start));
        assert!(!rate.admit(start + INTERVAL - Duration::from_millis(1)));
        assert!(rate.admit(start + INTERVAL));
    }

    #[test]
    fn resource_samples_accept_long_uptime_and_sleep_but_remain_bounded() {
        let mut value = sample();
        value["uptime_ms"] = serde_json::json!(3660.0 * DAY_MS);
        value["sample_interval_ms"] = serde_json::json!(31.0 * DAY_MS);
        value["event_loop_delay_max_ms"] = serde_json::json!(31.0 * DAY_MS);
        assert!(parse_child(&value.to_string()).is_some());
        for (field, maximum) in [
            ("uptime_ms", 3660.0 * DAY_MS),
            ("sample_interval_ms", 31.0 * DAY_MS),
            ("event_loop_delay_max_ms", 31.0 * DAY_MS),
        ] {
            let mut invalid = value.clone();
            invalid[field] = serde_json::json!(maximum + 1.0);
            assert!(parse_child(&invalid.to_string()).is_none(), "{field}");
        }
    }

    #[test]
    fn process_output_accepts_only_requested_ids_and_bounded_metrics() {
        let parsed = parse_ps("10 1 2048 5.5\n11 10 4096 150.0\n", &[10, 11]).unwrap();
        assert_eq!(parsed[0].rss_bytes, 2 * 1024 * 1024);
        assert_eq!(parsed[1].ppid, 10);
        for invalid in [
            "12 1 1 1",
            "10 1 1 NaN",
            "10 1 1 -1",
            "10 1 1 1 command",
            "10 1 1 1\n10 1 1 1",
            "10 1 18446744073709551615 1",
        ] {
            assert!(parse_ps(invalid, &[10, 11]).is_none());
        }
    }

    #[cfg(unix)]
    #[test]
    fn timed_out_sampler_child_is_killed_and_reaped() {
        let mut child = Command::new("/bin/sleep").arg("5").spawn().unwrap();
        let start = Instant::now();
        assert!(wait_bounded(&mut child, Duration::from_millis(25)).is_none());
        assert!(start.elapsed() < Duration::from_secs(1));
        assert!(child.try_wait().unwrap().is_some());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn fixed_ps_query_reads_only_this_process() {
        let pid = std::process::id();
        let samples = sample_pids(&[pid]).unwrap();
        assert_eq!(samples.len(), 1);
        assert_eq!(samples[0].pid, pid);
        assert!(samples[0].rss_bytes > 0);
    }

    #[test]
    fn files_rotate_with_strict_size_count_permissions_and_age_bounds() {
        let dir = std::env::temp_dir().join(format!(
            "relay-performance-test-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        let now = SystemTime::now();
        for _ in 0..20 {
            append(&dir, "12345", 10, now).unwrap();
        }
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 5);
        for index in 0..=4 {
            let metadata = fs::metadata(log_path(&dir, index)).unwrap();
            assert!(metadata.len() <= 10);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
            }
        }
        append(&dir, "12345678901", 10, now).unwrap();
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 5);
        prune(
            &dir,
            10,
            SystemTime::now() + RETENTION + Duration::from_secs(1),
        )
        .unwrap();
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn fresh_mtime_does_not_extend_old_records_retention() {
        let dir = std::env::temp_dir().join(format!(
            "relay-performance-age-test-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        fs::create_dir_all(&dir).unwrap();
        let now = SystemTime::now();
        let old: chrono::DateTime<chrono::Utc> = (now - RETENTION - Duration::from_secs(1)).into();
        let recent: chrono::DateTime<chrono::Utc> = now.into();
        let old_row =
            serde_json::json!({"at":old.to_rfc3339(), "event":"process_sample"}).to_string();
        let recent_row =
            serde_json::json!({"at":recent.to_rfc3339(), "event":"process_sample"}).to_string();
        for index in [0, 1] {
            fs::write(
                log_path(&dir, index),
                format!(
                    "{old_row}\n{recent_row}\n{}",
                    " ".repeat(MAX_LINE_BYTES * 2)
                ),
            )
            .unwrap();
            let modified = fs::metadata(log_path(&dir, index))
                .unwrap()
                .modified()
                .unwrap();
            assert!(
                SystemTime::now()
                    .duration_since(modified)
                    .unwrap_or_default()
                    < Duration::from_secs(5)
            );
        }
        fs::write(log_path(&dir, 2), format!("{recent_row}\n")).unwrap();
        prune(&dir, FILE_LIMIT, now).unwrap();
        assert!(!log_path(&dir, 0).exists());
        assert!(!log_path(&dir, 1).exists());
        assert!(log_path(&dir, 2).exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
