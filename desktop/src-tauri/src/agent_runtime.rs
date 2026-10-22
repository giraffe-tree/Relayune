use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt as _;
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Threading::CREATE_NEW_CONSOLE;

use crate::model::{
    user_error, AgentRuntimeAvailability, AgentRuntimeStatus, RelayConfig, RelayProvider,
};

const CODEX_MINIMUM_VERSION: &str = "0.143.0";
const KIMI_MINIMUM_VERSION: &str = "0.38.0";
const CLAUDE_MINIMUM_VERSION: &str = "2.1.177";

#[cfg(target_os = "macos")]
const CODEX_DESKTOP_BUNDLED_PATHS: &[&str] = &[
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex",
];

pub fn inspect_all(config: &RelayConfig) -> Vec<AgentRuntimeAvailability> {
    [
        RelayProvider::Codex,
        RelayProvider::Kimi,
        RelayProvider::Claude,
        RelayProvider::Opencode,
        RelayProvider::Zcode,
        RelayProvider::Mcode,
    ]
    .into_iter()
    .map(|provider| inspect(config, provider))
    .collect()
}

pub fn install(
    config: &RelayConfig,
    provider: RelayProvider,
) -> Result<AgentRuntimeAvailability, String> {
    let status = installer_command(provider)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| user_error("agent_install_failed"))?;
    if !status.success() {
        return Err(user_error("agent_install_failed"));
    }

    let availability = inspect(config, provider);
    if matches!(
        availability.status,
        AgentRuntimeStatus::NotInstalled
            | AgentRuntimeStatus::Outdated
            | AgentRuntimeStatus::Broken
    ) {
        Err(user_error("agent_install_failed"))
    } else {
        Ok(availability)
    }
}

pub fn open_login(provider: RelayProvider) -> Result<(), String> {
    let login_command = match provider {
        RelayProvider::Codex => "codex login",
        RelayProvider::Kimi => "kimi login",
        RelayProvider::Claude => "claude auth login",
        RelayProvider::Opencode => "opencode auth login",
        RelayProvider::Zcode => "zcode",
        RelayProvider::Mcode => "mcode login",
    };

    #[cfg(target_os = "windows")]
    {
        Command::new("powershell.exe")
            .creation_flags(CREATE_NEW_CONSOLE)
            .args(["-NoLogo", "-NoExit", "-Command", login_command])
            .spawn()
            .map(|_| ())
            .map_err(|_| user_error("agent_login_failed"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let script = format!(
            "tell application \"Terminal\"\nactivate\ndo script \"{}\"\nend tell",
            login_command
        );
        Command::new("/usr/bin/osascript")
            .args(["-e", &script])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|_| user_error("agent_login_failed"))
            .and_then(|status| {
                status
                    .success()
                    .then_some(())
                    .ok_or_else(|| user_error("agent_login_failed"))
            })
    }
}

fn inspect(config: &RelayConfig, provider: RelayProvider) -> AgentRuntimeAvailability {
    let minimum_version = minimum_version(provider);
    let Some(executable) = resolve_binary(config, provider) else {
        return availability(
            provider,
            AgentRuntimeStatus::NotInstalled,
            None,
            minimum_version,
        );
    };

    let Ok(version_output) = command_output(&executable, &["--version"]) else {
        return availability(provider, AgentRuntimeStatus::Broken, None, minimum_version);
    };
    if !version_output.status.success() {
        return availability(provider, AgentRuntimeStatus::Broken, None, minimum_version);
    }
    let raw_version = combined_output(&version_output);
    let Some(version) = runtime_version(provider, &raw_version) else {
        return availability(provider, AgentRuntimeStatus::Broken, None, minimum_version);
    };
    if compare_versions(&version, minimum_version).is_lt() {
        return availability(
            provider,
            AgentRuntimeStatus::Outdated,
            Some(version),
            minimum_version,
        );
    }

    let logged_in = match provider {
        RelayProvider::Codex => command_output(&executable, &["login", "status"])
            .is_ok_and(|output| output.status.success()),
        RelayProvider::Kimi => kimi_is_logged_in(),
        RelayProvider::Claude => claude_is_logged_in(&executable),
        // OpenCode also supports environment-configured and local model providers.
        RelayProvider::Opencode => true,
        RelayProvider::Zcode => true,
        // Probe ACP without reading credential files or launching a login flow.
        RelayProvider::Mcode => mcode_is_logged_in(&executable),
    };
    availability(
        provider,
        if logged_in {
            AgentRuntimeStatus::Ready
        } else {
            AgentRuntimeStatus::NotLoggedIn
        },
        Some(version),
        minimum_version,
    )
}

fn availability(
    provider: RelayProvider,
    status: AgentRuntimeStatus,
    version: Option<String>,
    minimum_version: &str,
) -> AgentRuntimeAvailability {
    AgentRuntimeAvailability {
        provider,
        status,
        version,
        minimum_version: minimum_version.to_string(),
    }
}

fn runtime_version(provider: RelayProvider, output: &str) -> Option<String> {
    let version_output = if matches!(provider, RelayProvider::Zcode) {
        output.lines().find(|line| line.trim_start().starts_with("zcode-runtime ")).unwrap_or(output)
    } else {
        output
    };
    extract_version(version_output)
}

fn minimum_version(provider: RelayProvider) -> &'static str {
    match provider {
        RelayProvider::Codex => CODEX_MINIMUM_VERSION,
        RelayProvider::Kimi => KIMI_MINIMUM_VERSION,
        RelayProvider::Claude => CLAUDE_MINIMUM_VERSION,
        // Verified against this release; startup also negotiates ACP capabilities.
        RelayProvider::Opencode => "1.18.29",
        RelayProvider::Zcode => "0.16.5",
        RelayProvider::Mcode => "0.5.5",
    }
}

fn explicit_binary<'a>(config: &'a RelayConfig, provider: RelayProvider) -> &'a str {
    match provider {
        RelayProvider::Codex => &config.codex_bin,
        RelayProvider::Kimi => &config.kimi_bin,
        RelayProvider::Claude => &config.claude_bin,
        RelayProvider::Opencode => "",
        RelayProvider::Zcode => "",
        RelayProvider::Mcode => "",
    }
}

fn binary_name(provider: RelayProvider) -> &'static str {
    match provider {
        RelayProvider::Codex => "codex",
        RelayProvider::Kimi => "kimi",
        RelayProvider::Claude => "claude",
        RelayProvider::Opencode => "opencode",
        RelayProvider::Zcode => "zcode",
        RelayProvider::Mcode => "mcode",
    }
}

fn resolve_binary(config: &RelayConfig, provider: RelayProvider) -> Option<PathBuf> {
    if provider == RelayProvider::Mcode {
        if let Some(path) = env::var_os("MCODE_BIN").filter(|p| !p.is_empty()) {
            let path = PathBuf::from(path);
            return path.is_file().then_some(path);
        }
    }
    let explicit = explicit_binary(config, provider);
    if !explicit.is_empty() {
        let path = PathBuf::from(explicit);
        return path.is_file().then_some(path);
    }

    // Match the Relay: prefer the official standalone package after an update,
    // then a desktop bundle before potentially broken PATH/NVM installations.
    for candidate in managed_binary_candidates(provider) {
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let name = binary_name(provider);
    for directory in executable_search_directories() {
        for file_name in executable_file_names(name) {
            let candidate = directory.join(file_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn managed_binary_candidates(provider: RelayProvider) -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    if provider == RelayProvider::Codex {
        let mut candidates = Vec::new();
        if let Some(home) = user_home() {
            candidates.push(home.join(".codex/packages/standalone/current/bin/codex"));
        }
        candidates.extend(CODEX_DESKTOP_BUNDLED_PATHS.iter().map(PathBuf::from));
        return candidates;
    }

    let _ = provider;
    Vec::new()
}

pub(crate) fn executable_search_directories() -> Vec<PathBuf> {
    let mut directories = Vec::new();
    if let Some(root) = env::var_os("MCODE_INSTALL_DIR") {
        #[cfg(not(target_os = "windows"))]
        push_unique_path(&mut directories, PathBuf::from(root).join("bin"));
        #[cfg(target_os = "windows")]
        push_unique_path(&mut directories, PathBuf::from(root));
    }
    if let Some(path) = env::var_os("PATH") {
        for directory in env::split_paths(&path) {
            push_unique_path(&mut directories, directory);
        }
    }
    if let Some(home) = user_home() {
        push_unique_path(&mut directories, home.join(".local/bin"));
        push_unique_path(&mut directories, home.join(".kimi-code/bin"));
        push_unique_path(&mut directories, home.join(".opencode/bin"));
        push_unique_path(&mut directories, home.join(".minimax-code/bin"));
        #[cfg(target_os = "windows")]
        push_unique_path(&mut directories, home.join(".minimax-code"));
        push_unique_path(&mut directories, home.join(".cargo/bin"));

        for directory in nvm_node_bin_directories(&home) {
            push_unique_path(&mut directories, directory);
        }

        #[cfg(target_os = "windows")]
        {
            push_unique_path(&mut directories, home.join(".local/bin"));
        }
    }

    #[cfg(target_os = "macos")]
    for fixed in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        push_unique_path(&mut directories, PathBuf::from(fixed));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(app_data) = env::var_os("APPDATA") {
            push_unique_path(&mut directories, PathBuf::from(app_data).join("npm"));
        }
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            let local = PathBuf::from(local_app_data);
            push_unique_path(&mut directories, local.join("Microsoft/WindowsApps"));
            push_unique_path(&mut directories, local.join("Microsoft/WinGet/Links"));
        }
    }
    directories
}

fn nvm_node_bin_directories(home: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(home.join(".nvm/versions/node")) else {
        return Vec::new();
    };
    let mut node_versions = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    node_versions.sort_by(|left, right| {
        let left = left
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        let right = right
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        compare_versions(right.trim_start_matches('v'), left.trim_start_matches('v'))
    });
    node_versions
        .into_iter()
        .map(|version| version.join("bin"))
        .collect()
}

fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.contains(&path) {
        paths.push(path);
    }
}

#[cfg(target_os = "windows")]
fn executable_file_names(name: &str) -> Vec<String> {
    [".exe", ".cmd", ".bat", ""]
        .into_iter()
        .map(|suffix| format!("{name}{suffix}"))
        .collect()
}

#[cfg(not(target_os = "windows"))]
fn executable_file_names(name: &str) -> Vec<String> {
    vec![name.to_string()]
}

fn command_output(executable: &Path, arguments: &[&str]) -> std::io::Result<Output> {
    #[cfg(target_os = "windows")]
    if executable
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat")
        })
    {
        let mut command = Command::new("cmd.exe");
        command.arg("/D").arg("/C").arg(executable).args(arguments);
        return command_output_with_timeout(command);
    }

    let mut command = Command::new(executable);
    command.args(arguments);
    command_output_with_timeout(command)
}

fn command_output_with_timeout(mut command: Command) -> std::io::Result<Output> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if child.try_wait()?.is_some() {
            return child.wait_with_output();
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "Agent status command timed out",
            ));
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn combined_output(output: &Output) -> String {
    let mut value = String::from_utf8_lossy(&output.stdout).into_owned();
    value.push(' ');
    value.push_str(&String::from_utf8_lossy(&output.stderr));
    value
}

fn extract_version(value: &str) -> Option<String> {
    value
        .split(|character: char| !(character.is_ascii_digit() || character == '.'))
        .find_map(|candidate| {
            let parts = candidate.split('.').collect::<Vec<_>>();
            if parts.len() < 3 || parts.iter().take(3).any(|part| part.is_empty()) {
                return None;
            }
            parts
                .iter()
                .take(3)
                .all(|part| part.parse::<u64>().is_ok())
                .then(|| parts[..3].join("."))
        })
}

fn compare_versions(left: &str, right: &str) -> std::cmp::Ordering {
    version_parts(left).cmp(&version_parts(right))
}

fn version_parts(value: &str) -> [u64; 3] {
    let mut parts = value
        .split('.')
        .take(3)
        .map(|part| part.parse::<u64>().unwrap_or_default());
    [
        parts.next().unwrap_or_default(),
        parts.next().unwrap_or_default(),
        parts.next().unwrap_or_default(),
    ]
}

fn mcode_is_logged_in(executable: &Path) -> bool {
    use std::io::{BufRead, BufReader, Write};
    use std::sync::mpsc;

    let mut command = Command::new(executable);
    #[cfg(target_os = "windows")]
    if executable.extension().and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("cmd") || ext.eq_ignore_ascii_case("bat")) {
        command = Command::new("cmd.exe");
        command.args(["/D", "/C"]).arg(executable);
    }
    let Ok(mut child) = command.arg("acp").stdin(Stdio::piped())
        .stdout(Stdio::piped()).stderr(Stdio::null()).spawn() else { return false; };
    let mut input = child.stdin.take().expect("piped stdin");
    let output = child.stdout.take().expect("piped stdout");
    let (sender, receiver) = mpsc::channel();
    let reader = thread::spawn(move || {
        for line in BufReader::new(output).lines().map_while(Result::ok) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                if sender.send(value).is_err() { break; }
            }
        }
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    let ready = (|| {
        writeln!(input, "{}", serde_json::json!({"jsonrpc":"2.0", "id":1, "method":"initialize",
            "params":{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"relayune-readiness","version":"0.3.32"}}})).ok()?;
        loop {
            let response = receiver.recv_timeout(deadline.saturating_duration_since(Instant::now())).ok()?;
            if response.get("id").and_then(|id| id.as_u64()) != Some(1) { continue; }
            if response.pointer("/result/protocolVersion").and_then(|v| v.as_u64()) != Some(1) { return None; }
            break;
        }
        writeln!(input, "{}", serde_json::json!({"jsonrpc":"2.0", "id":2, "method":"session/list", "params":{}})).ok()?;
        loop {
            let response = receiver.recv_timeout(deadline.saturating_duration_since(Instant::now())).ok()?;
            if response.get("id").and_then(|id| id.as_u64()) == Some(2) {
                return response.pointer("/result/sessions").filter(|sessions| sessions.is_array()).map(|_| ());
            }
        }
    })().is_some();
    drop(input);
    drop(receiver);
    let _ = child.kill();
    let _ = child.wait();
    // Do not join a pipe reader: an unexpected grandchild may retain stdout.
    drop(reader);
    ready
}

fn claude_is_logged_in(executable: &Path) -> bool {
    let Ok(output) = command_output(executable, &["auth", "status"]) else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let raw = combined_output(&output);
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|value| value.get("loggedIn").and_then(serde_json::Value::as_bool))
        .unwrap_or_else(|| raw.to_ascii_lowercase().contains("logged in"))
}

fn kimi_is_logged_in() -> bool {
    if ["KIMI_API_KEY", "KIMI_CODE_API_KEY"]
        .into_iter()
        .any(|key| env::var_os(key).is_some_and(|value| !value.is_empty()))
    {
        return true;
    }
    let Some(home) = kimi_home() else {
        return false;
    };
    let credentials = home.join("credentials/kimi-code.json");
    if json_contains_credential(&credentials) {
        return true;
    }
    let config = home.join("config.toml");
    fs::read_to_string(config)
        .ok()
        .and_then(|raw| toml::from_str::<toml::Value>(&raw).ok())
        .is_some_and(|value| value_contains_credential(&value))
}

fn kimi_home() -> Option<PathBuf> {
    env::var_os("KIMI_CODE_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| user_home().map(|home| home.join(".kimi-code")))
}

fn user_home() -> Option<PathBuf> {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn json_contains_credential(path: &Path) -> bool {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .is_some_and(|value| json_value_contains_credential(&value))
}

fn json_value_contains_credential(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(entries) => entries.iter().any(|(key, value)| {
            matches!(key.as_str(), "access_token" | "refresh_token" | "api_key")
                && value
                    .as_str()
                    .is_some_and(|secret| !secret.trim().is_empty())
                || json_value_contains_credential(value)
        }),
        serde_json::Value::Array(values) => values.iter().any(json_value_contains_credential),
        _ => false,
    }
}

fn value_contains_credential(value: &toml::Value) -> bool {
    match value {
        toml::Value::Table(entries) => entries.iter().any(|(key, value)| {
            matches!(key.as_str(), "access_token" | "refresh_token" | "api_key")
                && value
                    .as_str()
                    .is_some_and(|secret| !secret.trim().is_empty())
                || value_contains_credential(value)
        }),
        toml::Value::Array(values) => values.iter().any(value_contains_credential),
        _ => false,
    }
}

#[cfg(target_os = "windows")]
fn installer_command(provider: RelayProvider) -> Command {
    let script = match provider {
        RelayProvider::Codex => "irm https://chatgpt.com/codex/install.ps1 | iex",
        RelayProvider::Kimi => "irm https://code.kimi.com/kimi-code/install.ps1 | iex",
        RelayProvider::Claude => "irm https://claude.ai/install.ps1 | iex",
        RelayProvider::Opencode => "npm install -g opencode-ai",
        RelayProvider::Zcode => "npm install -g zcode-app-cli@3.11.2-22",
        RelayProvider::Mcode => "irm https://filecdn.minimax.chat/public/install.ps1 | iex",
    };
    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
    ]);
    command
}

#[cfg(not(target_os = "windows"))]
fn installer_command(provider: RelayProvider) -> Command {
    let script = match provider {
        RelayProvider::Codex => "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
        RelayProvider::Kimi => "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
        RelayProvider::Claude => "curl -fsSL https://claude.ai/install.sh | bash",
        RelayProvider::Opencode => "npm install -g opencode-ai",
        RelayProvider::Zcode => "npm install -g zcode-app-cli@3.11.2-22",
        RelayProvider::Mcode => "curl -fsSL https://filecdn.minimax.chat/public/install.sh | bash",
    };
    let mut command = Command::new("/bin/sh");
    command.args(["-c", script]);
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn mcode_readiness_requires_an_authenticated_session_list() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("relayune-mcode-probe-{}", rand::random::<u64>()));
        fs::create_dir_all(&root).unwrap();
        let script = root.join("mcode");
        for ready in [false, true] {
            let response = if ready { r#"{"id":2,"result":{"sessions":[]}}"# }
                else { r#"{"id":2,"error":{"code":-32000,"message":"Authentication required"}}"# };
            fs::write(&script, format!("#!/bin/sh\nread -r init\nprintf '%s\\n' '{{\"id\":1,\"result\":{{\"protocolVersion\":1}}}}'\nread -r list\nprintf '%s\\n' '{}'\n", response)).unwrap();
            fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
            assert_eq!(mcode_is_logged_in(&script), ready);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn zcode_checks_runtime_version_instead_of_launcher_version() {
        assert_eq!(runtime_version(RelayProvider::Zcode, "zcode-app-cli 3.11.2-22\nzcode-runtime 0.16.5"), Some("0.16.5".into()));
        assert_eq!(runtime_version(RelayProvider::Zcode, "0.16.5"), Some("0.16.5".into()));
    }

    #[test]
    fn extracts_semver_from_each_supported_cli_shape() {
        assert_eq!(extract_version("codex-cli 0.143.0"), Some("0.143.0".into()));
        assert_eq!(extract_version("0.38.0"), Some("0.38.0".into()));
        assert_eq!(
            extract_version("2.1.211 (Claude Code)"),
            Some("2.1.211".into())
        );
        assert_eq!(extract_version("not a version"), None);
    }

    #[test]
    fn compares_numeric_versions_instead_of_lexicographic_text() {
        assert!(compare_versions("0.143.0", "0.99.0").is_gt());
        assert!(compare_versions("2.1.9", "2.1.10").is_lt());
        assert!(compare_versions("0.38.0", "0.38.0").is_eq());
    }

    #[test]
    fn discovers_nvm_node_bins_newest_first() {
        let root = std::env::temp_dir().join(format!(
            "relayune-agent-runtime-nvm-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        for version in ["v20.19.0", "v22.15.0", "v9.99.0"] {
            fs::create_dir_all(root.join(".nvm/versions/node").join(version))
                .expect("NVM fixture should be created");
        }

        let bins = nvm_node_bin_directories(&root);
        assert_eq!(
            bins,
            ["v22.15.0", "v20.19.0", "v9.99.0"]
                .map(|version| root.join(".nvm/versions/node").join(version).join("bin"))
        );

        fs::remove_dir_all(root).expect("NVM fixture should be removed");
    }

    #[test]
    fn credential_scans_return_only_presence() {
        let with_secret = serde_json::json!({"access_token": "secret-value"});
        let without_secret = serde_json::json!({"access_token": "", "scope": "openid"});
        assert!(json_value_contains_credential(&with_secret));
        assert!(!json_value_contains_credential(&without_secret));
    }

    #[test]
    fn every_provider_has_an_explicit_compatibility_floor() {
        assert_eq!(minimum_version(RelayProvider::Codex), "0.143.0");
        assert_eq!(minimum_version(RelayProvider::Kimi), "0.38.0");
        assert_eq!(minimum_version(RelayProvider::Claude), "2.1.177");
        assert_eq!(minimum_version(RelayProvider::Mcode), "0.5.5");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn codex_readiness_prefers_official_standalone_then_desktop_bundles() {
        let mut expected = Vec::new();
        if let Some(home) = user_home() {
            expected.push(home.join(".codex/packages/standalone/current/bin/codex"));
        }
        expected.extend([
            PathBuf::from("/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"),
            PathBuf::from("/Applications/ChatGPT.app/Contents/Resources/codex"),
        ]);
        assert_eq!(
            managed_binary_candidates(RelayProvider::Codex),
            expected
        );
        assert!(managed_binary_candidates(RelayProvider::Kimi).is_empty());
        assert!(managed_binary_candidates(RelayProvider::Claude).is_empty());
    }
}
