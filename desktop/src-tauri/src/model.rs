use serde::{Deserialize, Serialize};

pub const USER_ERROR_PREFIX: &str = "relayune:";

pub fn user_error(code: &str) -> String {
    format!("{USER_ERROR_PREFIX}{code}")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RelayAdapter {
    Codex,
    Kimi,
    Claude,
    Opencode,
    Zcode,
    Mcode,
    Multi,
}

impl RelayAdapter {
    pub fn as_env(&self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Kimi => "kimi",
            Self::Claude => "claude",
            Self::Opencode => "opencode",
            Self::Zcode => "zcode",
            Self::Mcode => "mcode",
            Self::Multi => "multi",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RelayProvider {
    Codex,
    Kimi,
    Claude,
    Opencode,
    Zcode,
    Mcode,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentRuntimeStatus {
    Ready,
    NotInstalled,
    NotLoggedIn,
    Outdated,
    Broken,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AgentRuntimeAvailability {
    pub provider: RelayProvider,
    pub status: AgentRuntimeStatus,
    pub version: Option<String>,
    pub minimum_version: String,
}

impl RelayProvider {
    pub fn as_env(&self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Kimi => "kimi",
            Self::Claude => "claude",
            Self::Opencode => "opencode",
            Self::Zcode => "zcode",
            Self::Mcode => "mcode",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayConfig {
    pub server_url: String,
    pub device_id: String,
    #[serde(default)]
    pub account_email: Option<String>,
    pub adapter: RelayAdapter,
    pub default_provider: RelayProvider,
    pub workspace: String,
    #[serde(default)]
    pub codex_bin: String,
    #[serde(default)]
    pub kimi_bin: String,
    #[serde(default)]
    pub claude_bin: String,
    #[serde(default)]
    pub state_path: String,
    #[serde(default)]
    pub browser_ids: Vec<String>,
    #[serde(default)]
    pub start_relay_on_launch: bool,
    /// Local-only UI preference used before the hidden webview has loaded so
    /// the menu-bar item never flashes the system language after a restart.
    #[serde(default)]
    pub ui_language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SecretPresence {
    pub device_token: bool,
    pub e2ee_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RelayPhase {
    Stopped,
    Starting,
    Connected,
    Stopping,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UiLanguage {
    English,
    SimplifiedChinese,
    Hindi,
    Spanish,
    Arabic,
    French,
    Bengali,
    Portuguese,
    Indonesian,
    Urdu,
}

impl UiLanguage {
    pub fn system() -> Self {
        Self::from_locale(sys_locale::get_locale().as_deref())
    }

    fn from_locale(locale: Option<&str>) -> Self {
        let locale = locale
            .unwrap_or_default()
            .replace('_', "-")
            .to_ascii_lowercase();
        if locale == "zh"
            || locale == "zh-cn"
            || locale == "zh-hans"
            || locale.starts_with("zh-hans-")
        {
            return Self::SimplifiedChinese;
        }
        if locale.starts_with("zh-") {
            return Self::English;
        }
        match locale
            .split('-')
            .next()
            .unwrap_or_default()
        {
            "hi" => Self::Hindi,
            "es" => Self::Spanish,
            "ar" => Self::Arabic,
            "fr" => Self::French,
            "bn" => Self::Bengali,
            "pt" => Self::Portuguese,
            "id" => Self::Indonesian,
            "ur" => Self::Urdu,
            _ => Self::English,
        }
    }

    pub fn from_language_code(language: &str) -> Option<Self> {
        match language {
            "zh-CN" => Some(Self::SimplifiedChinese),
            "en" => Some(Self::English),
            "hi" => Some(Self::Hindi),
            "es" => Some(Self::Spanish),
            "ar" => Some(Self::Arabic),
            "fr" => Some(Self::French),
            "bn" => Some(Self::Bengali),
            "pt" => Some(Self::Portuguese),
            "id" => Some(Self::Indonesian),
            "ur" => Some(Self::Urdu),
            _ => None,
        }
    }

    pub fn language_code(self) -> &'static str {
        match self {
            Self::SimplifiedChinese => "zh-CN",
            Self::English => "en",
            Self::Hindi => "hi",
            Self::Spanish => "es",
            Self::Arabic => "ar",
            Self::French => "fr",
            Self::Bengali => "bn",
            Self::Portuguese => "pt",
            Self::Indonesian => "id",
            Self::Urdu => "ur",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayLogLine {
    pub at: String,
    pub level: LogLevel,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Info,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelaySnapshot {
    #[serde(default)]
    pub online_browser_ids: Vec<String>,
    #[serde(default)]
    pub browser_presence_observed_at: Option<i64>,
    pub phase: RelayPhase,
    pub pid: Option<u32>,
    pub started_at: Option<String>,
    pub last_error: Option<String>,
    pub logs: Vec<RelayLogLine>,
    pub file_access_limited: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Bootstrap {
    pub config: RelayConfig,
    pub secrets: SecretPresence,
    pub relay: RelaySnapshot,
    pub launch_at_login: bool,
    pub version: String,
    pub platform: DesktopPlatform,
}

#[derive(Debug, Clone, Serialize)]
pub struct DesktopPlatform {
    pub os: String,
    pub arch: String,
    pub update_target: String,
    pub os_version: Option<String>,
}

impl DesktopPlatform {
    pub fn current() -> Self {
        let os = std::env::consts::OS.to_string();
        let arch = std::env::consts::ARCH.to_string();
        let update_target = if cfg!(target_os = "macos") {
            "macos-universal".to_string()
        } else {
            format!("{os}-{arch}")
        };
        Self {
            os,
            arch,
            update_target,
            os_version: current_os_version(),
        }
    }
}

#[cfg(target_os = "macos")]
fn current_os_version() -> Option<String> {
    use objc2_foundation::NSProcessInfo;

    let version = NSProcessInfo::processInfo().operatingSystemVersion();
    major_minor_os_version(version.majorVersion, version.minorVersion)
}

#[cfg(not(target_os = "macos"))]
fn current_os_version() -> Option<String> {
    None
}

fn major_minor_os_version(major: isize, minor: isize) -> Option<String> {
    (major > 0 && minor >= 0).then(|| format!("{major}.{minor}"))
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveSettingsInput {
    pub config: RelayConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CompletePairingInput {
    pub server_url: String,
    pub expected_device_id: String,
    pub device_id: String,
    pub browser_id: String,
    pub device_token: String,
    pub e2ee_key: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CompleteDesktopLoginInput {
    pub server_url: String,
    pub expected_device_id: String,
    pub device_id: String,
    pub device_token: String,
    pub account_email: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StartBrowserPairingInput {
    pub server_url: String,
    pub expected_device_id: String,
    pub pairing_id: String,
    pub protocol: String,
    pub initiator_share: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartBrowserPairingResponse {
    pub expires_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CompleteBrowserPairingInput {
    pub server_url: String,
    pub expected_device_id: String,
    pub e2ee_key: String,
    pub pairing_id: String,
    pub browser_id: String,
    pub desktop_confirm: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserAuthorization {
    #[serde(default)]
    pub client_version: Option<String>,
    pub id: String,
    pub name: String,
    pub key_id: String,
    pub created_at: String,
    pub last_seen_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BrowserAuthorizationList {
    pub browsers: Vec<BrowserAuthorization>,
}


#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecretKind {
    DeviceToken,
    E2eeKey,
}

#[cfg(test)]
mod tests {
    use super::{major_minor_os_version, user_error, UiLanguage};

    #[test]
    fn native_user_errors_have_a_stable_data_only_marker() {
        assert_eq!(
            user_error("relay_start_failed"),
            "relayune:relay_start_failed"
        );
    }

    #[test]
    fn native_os_version_is_reduced_to_a_display_safe_major_minor_pair() {
        assert_eq!(major_minor_os_version(15, 6), Some("15.6".to_string()));
        assert_eq!(major_minor_os_version(0, 0), None);
        assert_eq!(major_minor_os_version(15, -1), None);
    }

    #[test]
    fn desktop_language_follows_supported_system_locales() {
        let cases = [
            ("zh-Hans-CN", UiLanguage::SimplifiedChinese),
            ("hi-IN", UiLanguage::Hindi),
            ("es-MX", UiLanguage::Spanish),
            ("ar_SA", UiLanguage::Arabic),
            ("fr-CA", UiLanguage::French),
            ("bn-BD", UiLanguage::Bengali),
            ("pt-BR", UiLanguage::Portuguese),
            ("id-ID", UiLanguage::Indonesian),
            ("ur-PK", UiLanguage::Urdu),
        ];
        for (locale, expected) in cases {
            assert_eq!(UiLanguage::from_locale(Some(locale)), expected);
        }
    }

    #[test]
    fn desktop_language_defaults_to_english() {
        for locale in [
            None,
            Some(""),
            Some("en-US"),
            Some("ja-JP"),
            Some("zh-Hant-TW"),
            Some("zh-TW"),
        ] {
            assert_eq!(UiLanguage::from_locale(locale), UiLanguage::English);
        }
    }

    #[test]
    fn desktop_language_command_only_accepts_supported_codes() {
        let cases = [
            ("en", UiLanguage::English),
            ("zh-CN", UiLanguage::SimplifiedChinese),
            ("hi", UiLanguage::Hindi),
            ("es", UiLanguage::Spanish),
            ("ar", UiLanguage::Arabic),
            ("fr", UiLanguage::French),
            ("bn", UiLanguage::Bengali),
            ("pt", UiLanguage::Portuguese),
            ("id", UiLanguage::Indonesian),
            ("ur", UiLanguage::Urdu),
        ];
        for (code, language) in cases {
            assert_eq!(UiLanguage::from_language_code(code), Some(language));
            assert_eq!(language.language_code(), code);
        }
        for language in ["zh", "zh-cn", "en-US", " en", "", "ja"] {
            assert_eq!(UiLanguage::from_language_code(language), None);
        }
    }
}
