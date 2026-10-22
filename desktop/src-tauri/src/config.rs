use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

use rand::random;
use tauri::{AppHandle, Manager};
use url::{Host, Url};

use crate::model::{user_error, RelayAdapter, RelayConfig, RelayProvider};

pub const DEFAULT_SERVER_URL: &str = "https://relayune.giraffetree.cn";
const LEGACY_SERVER_URL: &str = "https://agentrelay.giraffetree.cn";

pub fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    if std::env::var("AGENT_RELAY_TEST_MODE").as_deref() == Ok("1") {
        let path = std::env::var_os("AGENT_RELAY_CONFIG_PATH")
            .map(PathBuf::from)
            .ok_or_else(|| user_error("startup_failed"))?;
        if !path.is_absolute() {
            return Err(user_error("startup_failed"));
        }
        return Ok(path);
    }
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("config.json"))
        .map_err(|_| user_error("startup_failed"))
}

pub fn default_config(app: &AppHandle) -> Result<RelayConfig, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|_| user_error("startup_failed"))?;
    // Tauri resolves this to /Users/<name> on macOS and %USERPROFILE% on
    // Windows. PathBuf::join preserves the platform-native separator.
    let workspace = default_workspace_path(&home);
    let state_path = app
        .path()
        .app_data_dir()
        .map_err(|_| user_error("startup_failed"))?
        .join("relay-outbox.json");

    Ok(RelayConfig {
        server_url: DEFAULT_SERVER_URL.into(),
        device_id: format!("{}_{:016x}", local_device_prefix(), random::<u64>()),
        account_email: None,
        adapter: RelayAdapter::Multi,
        default_provider: RelayProvider::Kimi,
        workspace: path_string(&workspace),
        codex_bin: String::new(),
        kimi_bin: String::new(),
        claude_bin: String::new(),
        state_path: path_string(&state_path),
        browser_ids: Vec::new(),
        start_relay_on_launch: true,
        ui_language: None,
    })
}

pub fn state_path_for_device(app: &AppHandle, device_id: &str) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|directory| path_string(&directory.join(format!("relay-outbox-{device_id}.json"))))
        .map_err(|_| user_error("pairing_failed"))
}

pub fn attachment_store_path_for_device(
    app: &AppHandle,
    device_id: &str,
) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(format!("relay-attachments-{device_id}.sqlite3")))
        .map_err(|_| user_error("startup_failed"))
}

pub fn load_or_create(app: &AppHandle) -> Result<RelayConfig, String> {
    let path = config_path(app)?;
    match fs::read_to_string(&path) {
        Ok(raw) => {
            let mut config =
                serde_json::from_str(&raw).map_err(|_| user_error("settings_invalid"))?;
            if migrate_legacy_server_url(&mut config) {
                save(app, &config)?;
            } else {
                validate(&config)?;
            }
            Ok(config)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let config = default_config(app)?;
            create_default_workspace(Path::new(&config.workspace))?;
            save(app, &config)?;
            Ok(config)
        }
        Err(_) => Err(user_error("startup_failed")),
    }
}

fn migrate_legacy_server_url(config: &mut RelayConfig) -> bool {
    let normalized = config.server_url.trim().trim_end_matches('/');
    if normalized.eq_ignore_ascii_case(LEGACY_SERVER_URL) {
        config.server_url = DEFAULT_SERVER_URL.into();
        return true;
    }
    false
}

pub fn save(app: &AppHandle, config: &RelayConfig) -> Result<(), String> {
    validate(config)?;
    let path = config_path(app)?;
    let directory = path
        .parent()
        .ok_or_else(|| user_error("settings_save_failed"))?;
    fs::create_dir_all(directory).map_err(|_| user_error("settings_save_failed"))?;

    let temporary = path.with_extension("json.tmp");
    let serialized =
        serde_json::to_vec_pretty(config).map_err(|_| user_error("settings_save_failed"))?;
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(&temporary)
        .map_err(|_| user_error("settings_save_failed"))?;
    file.write_all(&serialized)
        .and_then(|_| file.sync_all())
        .map_err(|_| user_error("settings_save_failed"))?;
    replace_config_file(&temporary, &path).map_err(|_| user_error("settings_save_failed"))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn replace_config_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(target_os = "windows")]
fn replace_config_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let moved = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

pub fn validate(config: &RelayConfig) -> Result<(), String> {
    let url = Url::parse(config.server_url.trim()).map_err(|_| user_error("server_url_invalid"))?;
    let is_loopback = match url.host() {
        Some(Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    };

    if url.scheme() != "https" && !(url.scheme() == "http" && is_loopback) {
        return Err(user_error("server_https_required"));
    }
    if url.username() != "" || url.password().is_some() {
        return Err(user_error("server_credentials_forbidden"));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(user_error("server_components_forbidden"));
    }
    if config.device_id.is_empty()
        || config.device_id.len() > 80
        || !config
            .device_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
    {
        return Err(user_error("settings_invalid"));
    }
    if config
        .account_email
        .as_deref()
        .is_some_and(|email| !valid_account_label(email))
    {
        return Err(user_error("settings_invalid"));
    }
    if config.browser_ids.iter().any(|value| {
        !value.starts_with("web_")
            || value.len() != 36
            || !value[4..].bytes().all(|byte| byte.is_ascii_hexdigit())
    }) || config
        .browser_ids
        .iter()
        .collect::<std::collections::BTreeSet<_>>()
        .len()
        != config.browser_ids.len()
    {
        return Err(user_error("settings_invalid"));
    }
    if config
        .ui_language
        .as_deref()
        .is_some_and(|language| crate::model::UiLanguage::from_language_code(language).is_none())
    {
        return Err(user_error("settings_invalid"));
    }

    validate_directory(&config.workspace, "默认工作目录")
        .map_err(|_| user_error("workspace_invalid"))?;
    validate_optional_executable(&config.codex_bin, "Codex 二进制")
        .map_err(|_| user_error("codex_path_invalid"))?;
    validate_optional_executable(&config.kimi_bin, "Kimi 二进制")
        .map_err(|_| user_error("kimi_path_invalid"))?;
    validate_optional_executable(&config.claude_bin, "Claude 二进制")
        .map_err(|_| user_error("claude_path_invalid"))?;

    if !config.state_path.is_empty() && !Path::new(&config.state_path).is_absolute() {
        return Err(user_error("settings_invalid"));
    }

    Ok(())
}

pub(crate) fn valid_account_label(value: &str) -> bool {
    // Display only. A username is not an email address or an account principal.
    valid_account_email(value) || (value.len() >= 3 && value.len() <= 64
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte)))
}

pub(crate) fn valid_account_email(value: &str) -> bool {
    if value.is_empty()
        || value.len() > 320
        || value.trim() != value
        || value.chars().any(char::is_whitespace)
    {
        return false;
    }
    let Some((local, domain)) = value.split_once('@') else {
        return false;
    };
    !local.is_empty() && !domain.is_empty() && domain.contains('.') && !domain.contains('@')
}

fn validate_directory(value: &str, label: &str) -> Result<(), String> {
    let path = Path::new(value);
    if !path.is_absolute() {
        return Err(format!("{label}必须是绝对路径"));
    }
    let metadata = fs::metadata(path).map_err(|_| format!("{label}不存在或不可访问"))?;
    if !metadata.is_dir() {
        return Err(format!("{label}不是目录"));
    }
    Ok(())
}

fn validate_optional_executable(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty() {
        return Ok(());
    }
    let path = Path::new(value);
    if !path.is_absolute() {
        return Err(format!("{label}必须使用绝对路径"));
    }
    let metadata = fs::metadata(path).map_err(|_| format!("{label}不存在或不可访问"))?;
    if !metadata.is_file() {
        return Err(format!("{label}不是文件"));
    }
    Ok(())
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn default_workspace_path(home: &Path) -> PathBuf {
    home.join("Relayune")
}

fn create_default_workspace(workspace: &Path) -> Result<(), String> {
    fs::create_dir_all(workspace).map_err(|_| user_error("startup_failed"))
}

fn local_device_prefix() -> &'static str {
    if cfg!(target_os = "windows") {
        "win"
    } else {
        "mac"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_workspace_is_relayune_beneath_the_platform_home() {
        let home = Path::new(if cfg!(target_os = "windows") {
            r"C:\Users\relay"
        } else {
            "/Users/relay"
        });
        let workspace = default_workspace_path(home);

        assert_eq!(workspace.parent(), Some(home));
        assert_eq!(
            workspace.file_name().and_then(|name| name.to_str()),
            Some("Relayune")
        );
    }

    #[test]
    fn first_run_creates_the_default_workspace() {
        let root = std::env::temp_dir().join(format!(
            "relayune-default-workspace-{:016x}",
            random::<u64>()
        ));
        let workspace = default_workspace_path(&root);

        create_default_workspace(&workspace).expect("default workspace should be created");
        assert!(workspace.is_dir());

        fs::remove_dir_all(root).expect("default workspace fixture should be removed");
    }

    fn fixture(server_url: &str) -> RelayConfig {
        RelayConfig {
            server_url: server_url.into(),
            device_id: "mac_test-1".into(),
            account_email: None,
            adapter: RelayAdapter::Codex,
            default_provider: RelayProvider::Codex,
            workspace: std::env::temp_dir().to_string_lossy().into_owned(),
            codex_bin: String::new(),
            kimi_bin: String::new(),
            claude_bin: String::new(),
            state_path: std::env::temp_dir()
                .join("relay-outbox.json")
                .to_string_lossy()
                .into_owned(),
            browser_ids: Vec::new(),
            start_relay_on_launch: true,
            ui_language: None,
        }
    }

    #[test]
    fn rejects_plain_http_for_remote_hosts() {
        assert!(validate(&fixture("http://example.com")).is_err());
    }

    #[test]
    fn allows_localhost_http_for_development() {
        assert!(validate(&fixture("http://127.0.0.1:8787")).is_ok());
    }

    #[test]
    fn rejects_credentials_in_server_url() {
        assert!(validate(&fixture("https://user:password@example.com")).is_err());
    }

    #[test]
    fn accepts_only_supported_native_ui_languages() {
        let mut config = fixture("https://relay.example.com");
        for language in [
            None,
            Some("en"),
            Some("zh-CN"),
            Some("hi"),
            Some("es"),
            Some("ar"),
            Some("fr"),
            Some("bn"),
            Some("pt"),
            Some("id"),
            Some("ur"),
        ] {
            config.ui_language = language.map(str::to_owned);
            assert!(validate(&config).is_ok());
        }
        for language in ["zh", "en-US", "ja", ""] {
            config.ui_language = Some(language.into());
            assert!(validate(&config).is_err());
        }
    }

    #[test]
    fn accepts_normalized_email_or_username_display_labels() {
        let mut config = fixture("https://relay.example.com");
        config.account_email = Some("owner@example.com".into());
        assert!(validate(&config).is_ok());
        for email in [
            " owner@example.com",
            "a",
            "owner@example",
            "a@@example.com",
        ] {
            config.account_email = Some(email.into());
            assert!(validate(&config).is_err());
        }
    }

    #[test]
    fn reports_a_stable_error_for_an_invalid_claude_binary() {
        let mut config = fixture("https://relay.example.com");
        config.claude_bin = "relative/claude".into();
        assert_eq!(validate(&config), Err(user_error("claude_path_invalid")));
    }

    #[test]
    fn migrates_only_the_legacy_production_origin() {
        let mut legacy = fixture("https://agentrelay.giraffetree.cn/");
        assert!(migrate_legacy_server_url(&mut legacy));
        assert_eq!(legacy.server_url, DEFAULT_SERVER_URL);

        let mut custom = fixture("https://relay.example.com");
        assert!(!migrate_legacy_server_url(&mut custom));
        assert_eq!(custom.server_url, "https://relay.example.com");
    }
}
