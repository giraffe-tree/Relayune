use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::random;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::model::{user_error, SecretKind, SecretPresence};

const VAULT_VERSION: u8 = 1;
const VAULT_FILE_NAME: &str = "secret-vault-v1.json";
const VAULT_KEY_FILE_NAME: &str = "secret-vault-v1.key";
const VAULT_AAD: &[u8] = b"relayune/desktop-secret-vault/v1";
const KEY_LENGTH: usize = 32;
const NONCE_LENGTH: usize = 12;
const DEVICE_TOKEN_NAMESPACE: &str = "device-token";
const LEGACY_E2EE_NAMESPACE: &str = "legacy-e2ee-key";
const BROWSER_KEY_NAMESPACE: &str = "browser-content-key";
const ATTACHMENT_STORE_KEY_NAMESPACE: &str = "attachment-store-key";

static SECRET_VAULT: OnceLock<SecretVault> = OnceLock::new();

#[derive(Debug, Deserialize, Serialize)]
struct VaultEnvelope {
    version: u8,
    nonce: String,
    ciphertext: String,
}

#[derive(Clone, Default, Deserialize, Serialize)]
struct VaultPlaintext {
    entries: BTreeMap<String, String>,
}

struct VaultState {
    key: [u8; KEY_LENGTH],
    plaintext: VaultPlaintext,
}

struct SecretVault {
    path: PathBuf,
    state: Mutex<VaultState>,
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    if SECRET_VAULT.get().is_some() {
        return Ok(());
    }
    let directory = if std::env::var("AGENT_RELAY_TEST_MODE").as_deref() == Ok("1") {
        std::env::var_os("AGENT_RELAY_SECRET_VAULT_DIR")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .ok_or_else(|| user_error("credential_access_failed"))?
    } else {
        app.path()
            .app_data_dir()
            .map_err(|_| user_error("credential_access_failed"))?
    };
    let opened = SecretVault::open(&directory)?;
    let _ = SECRET_VAULT.set(opened);
    Ok(())
}

pub fn presence_for_browsers(
    device_id: &str,
    browser_ids: &[String],
) -> Result<SecretPresence, String> {
    let vault = vault()?;
    let device_token = vault.contains(&device_token_entry(device_id))?;
    // Legacy shared keys are inert; only individually paired clients count.
    let e2ee_key = browser_ids
        .iter()
        .map(|browser_id| vault.contains(&browser_key_entry(device_id, browser_id)))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .any(|present| present);
    Ok(SecretPresence {
        device_token,
        e2ee_key,
    })
}

pub fn set_browser_key(device_id: &str, browser_id: &str, value: &str) -> Result<(), String> {
    if !valid_e2ee_key(value) {
        return Err(user_error("credential_access_failed"));
    }
    vault()?.set(browser_key_entry(device_id, browser_id), value.trim())
}

pub fn get_browser_key(device_id: &str, browser_id: &str) -> Result<String, String> {
    vault()?.get(&browser_key_entry(device_id, browser_id))
}

pub fn clear_browser_key(device_id: &str, browser_id: &str) -> Result<(), String> {
    vault()?.clear(&[browser_key_entry(device_id, browser_id)])
}

/// Instance switching destroys every previous enrollment, including orphaned keys.
pub fn clear_instance_credentials() -> Result<(), String> {
    vault()?.clear_all()
}

pub fn clear_device_credentials(device_id: &str, browser_ids: &[String]) -> Result<(), String> {
    vault()?.clear(&device_credential_entries(device_id, browser_ids))
}

fn device_credential_entries(device_id: &str, browser_ids: &[String]) -> Vec<String> {
    let mut entries = vec![
        device_token_entry(device_id),
        legacy_e2ee_entry(device_id),
        attachment_store_key_entry(device_id),
    ];
    entries.extend(
        browser_ids
            .iter()
            .map(|browser_id| browser_key_entry(device_id, browser_id)),
    );
    entries
}

pub fn get_or_create_attachment_store_key(
    device_id: &str,
    store_exists: bool,
) -> Result<String, String> {
    get_or_create_store_key(vault()?, device_id, store_exists)
}

pub fn get(kind: SecretKind, device_id: &str) -> Result<String, String> {
    vault()?.get(&secret_entry(kind, device_id))
}

pub fn set(kind: SecretKind, device_id: &str, value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(user_error("credential_access_failed"));
    }
    if matches!(kind, SecretKind::E2eeKey) && !valid_e2ee_key(trimmed) {
        return Err(user_error("credential_access_failed"));
    }
    vault()?.set(secret_entry(kind, device_id), trimmed)
}

pub fn clear(kind: SecretKind, device_id: &str) -> Result<(), String> {
    vault()?.clear(&[secret_entry(kind, device_id)])
}

fn vault() -> Result<&'static SecretVault, String> {
    SECRET_VAULT
        .get()
        .ok_or_else(|| user_error("credential_access_failed"))
}

impl SecretVault {
    fn open(directory: &Path) -> Result<Self, String> {
        create_private_directory(directory)?;
        let path = directory.join(VAULT_FILE_NAME);
        let key_path = directory.join(VAULT_KEY_FILE_NAME);
        let key = read_or_create_key(&key_path, path.exists())?;
        let plaintext = if path.exists() {
            enforce_private_file(&path)?;
            decrypt_vault(&path, &key)?
        } else {
            VaultPlaintext::default()
        };
        Ok(Self {
            path,
            state: Mutex::new(VaultState { key, plaintext }),
        })
    }

    fn contains(&self, entry: &str) -> Result<bool, String> {
        self.state
            .lock()
            .map(|state| state.plaintext.entries.contains_key(entry))
            .map_err(|_| user_error("credential_access_failed"))
    }

    fn get(&self, entry: &str) -> Result<String, String> {
        self.get_optional(entry)?
            .ok_or_else(|| user_error("credential_access_failed"))
    }

    fn get_optional(&self, entry: &str) -> Result<Option<String>, String> {
        self.state
            .lock()
            .map(|state| state.plaintext.entries.get(entry).cloned())
            .map_err(|_| user_error("credential_access_failed"))
    }

    fn set(&self, entry: String, value: &str) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| user_error("credential_access_failed"))?;
        let mut next = state.plaintext.clone();
        next.entries.insert(entry, value.to_owned());
        persist_vault(&self.path, &state.key, &next)?;
        state.plaintext = next;
        Ok(())
    }

    fn clear_all(&self) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| user_error("credential_access_failed"))?;
        let next = VaultPlaintext::default();
        persist_vault(&self.path, &state.key, &next)?;
        state.plaintext = next;
        Ok(())
    }

    fn clear(&self, entries: &[String]) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| user_error("credential_access_failed"))?;
        let mut next = state.plaintext.clone();
        for entry in entries {
            next.entries.remove(entry);
        }
        persist_vault(&self.path, &state.key, &next)?;
        state.plaintext = next;
        Ok(())
    }
}

fn read_or_create_key(path: &Path, vault_exists: bool) -> Result<[u8; KEY_LENGTH], String> {
    match fs::read(path) {
        Ok(bytes) => {
            enforce_private_file(path)?;
            bytes
                .try_into()
                .map_err(|_| user_error("credential_access_failed"))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && vault_exists => {
            Err(user_error("credential_access_failed"))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let key = random::<[u8; KEY_LENGTH]>();
            write_new_private_file(path, &key)?;
            Ok(key)
        }
        Err(_) => Err(user_error("credential_access_failed")),
    }
}

fn decrypt_vault(path: &Path, key: &[u8; KEY_LENGTH]) -> Result<VaultPlaintext, String> {
    let serialized = fs::read(path).map_err(|_| user_error("credential_access_failed"))?;
    let envelope = serde_json::from_slice::<VaultEnvelope>(&serialized)
        .map_err(|_| user_error("credential_access_failed"))?;
    if envelope.version != VAULT_VERSION {
        return Err(user_error("credential_access_failed"));
    }
    let nonce = URL_SAFE_NO_PAD
        .decode(envelope.nonce)
        .map_err(|_| user_error("credential_access_failed"))?;
    let nonce: [u8; NONCE_LENGTH] = nonce
        .try_into()
        .map_err(|_| user_error("credential_access_failed"))?;
    let ciphertext = URL_SAFE_NO_PAD
        .decode(envelope.ciphertext)
        .map_err(|_| user_error("credential_access_failed"))?;
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|_| user_error("credential_access_failed"))?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: VAULT_AAD,
            },
        )
        .map_err(|_| user_error("credential_access_failed"))?;
    serde_json::from_slice(&plaintext).map_err(|_| user_error("credential_access_failed"))
}

fn persist_vault(
    path: &Path,
    key: &[u8; KEY_LENGTH],
    plaintext: &VaultPlaintext,
) -> Result<(), String> {
    let serialized =
        serde_json::to_vec(plaintext).map_err(|_| user_error("credential_access_failed"))?;
    let nonce = random::<[u8; NONCE_LENGTH]>();
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|_| user_error("credential_access_failed"))?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &serialized,
                aad: VAULT_AAD,
            },
        )
        .map_err(|_| user_error("credential_access_failed"))?;
    let envelope = VaultEnvelope {
        version: VAULT_VERSION,
        nonce: URL_SAFE_NO_PAD.encode(nonce),
        ciphertext: URL_SAFE_NO_PAD.encode(ciphertext),
    };
    let encoded =
        serde_json::to_vec(&envelope).map_err(|_| user_error("credential_access_failed"))?;
    replace_private_file(path, &encoded)
}

fn create_private_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|_| user_error("credential_access_failed"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| user_error("credential_access_failed"))?;
    }
    Ok(())
}

fn write_new_private_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(path)
        .map_err(|_| user_error("credential_access_failed"))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| user_error("credential_access_failed"))
}

fn enforce_private_file(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|_| user_error("credential_access_failed"))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn replace_private_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("json.tmp");
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(&temporary)
        .map_err(|_| user_error("credential_access_failed"))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| user_error("credential_access_failed"))?;
    replace_file(&temporary, path).map_err(|_| user_error("credential_access_failed"))
}

#[cfg(not(target_os = "windows"))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(target_os = "windows")]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
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

fn secret_entry(kind: SecretKind, device_id: &str) -> String {
    match kind {
        SecretKind::DeviceToken => device_token_entry(device_id),
        SecretKind::E2eeKey => legacy_e2ee_entry(device_id),
    }
}

fn device_token_entry(device_id: &str) -> String {
    format!("{DEVICE_TOKEN_NAMESPACE}:{device_id}")
}

fn legacy_e2ee_entry(device_id: &str) -> String {
    format!("{LEGACY_E2EE_NAMESPACE}:{device_id}")
}

fn browser_key_entry(device_id: &str, browser_id: &str) -> String {
    format!("{BROWSER_KEY_NAMESPACE}:{device_id}:{browser_id}")
}

fn attachment_store_key_entry(device_id: &str) -> String {
    format!("{ATTACHMENT_STORE_KEY_NAMESPACE}:{device_id}")
}

fn get_or_create_store_key(
    vault: &SecretVault,
    device_id: &str,
    store_exists: bool,
) -> Result<String, String> {
    let entry = attachment_store_key_entry(device_id);
    if let Some(key) = vault.get_optional(&entry)? {
        if valid_e2ee_key(&key) {
            return Ok(key);
        }
        return Err(user_error("credential_access_failed"));
    }
    // Losing the key must never replace a populated encrypted store with a
    // newly keyed one. The user can explicitly disconnect the device to clear
    // both credentials and local capability state.
    if store_exists {
        return Err(user_error("credential_access_failed"));
    }
    let key = URL_SAFE_NO_PAD.encode(random::<[u8; KEY_LENGTH]>());
    vault.set(entry, &key)?;
    Ok(key)
}

fn valid_e2ee_key(value: &str) -> bool {
    URL_SAFE_NO_PAD
        .decode(value)
        .map(|bytes| bytes.len() == 32)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "relayune-secret-vault-{label}-{}-{nonce}",
                std::process::id()
            ));
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn validates_exactly_32_byte_base64url_keys() {
        assert!(valid_e2ee_key(
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        ));
        assert!(!valid_e2ee_key("too-short"));
        assert!(!valid_e2ee_key(
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        ));
    }

    #[test]
    fn encrypted_vault_round_trips_without_plaintext_secrets() {
        let directory = TestDirectory::new("round-trip");
        let vault = SecretVault::open(&directory.0).expect("open test vault");
        let token = "relayune-test-device-token-never-plaintext";
        let key = URL_SAFE_NO_PAD.encode([0x42; 32]);
        vault
            .set(device_token_entry("dev_test"), token)
            .expect("persist device token");
        vault
            .set(browser_key_entry("dev_test", "web_test"), &key)
            .expect("persist browser key");

        let raw = fs::read(directory.0.join(VAULT_FILE_NAME)).expect("read encrypted vault");
        assert!(!raw
            .windows(token.len())
            .any(|window| window == token.as_bytes()));
        assert!(!raw
            .windows(key.len())
            .any(|window| window == key.as_bytes()));

        vault
            .set(device_token_entry("dev_test"), token)
            .expect("rewrite same token with a fresh nonce");
        let rewritten = fs::read(directory.0.join(VAULT_FILE_NAME)).expect("read rewritten vault");
        assert_ne!(raw, rewritten);

        let reopened = SecretVault::open(&directory.0).expect("reopen encrypted vault");
        assert_eq!(
            reopened.get(&device_token_entry("dev_test")).unwrap(),
            token
        );
        assert_eq!(
            reopened
                .get(&browser_key_entry("dev_test", "web_test"))
                .unwrap(),
            key
        );
    }

    #[test]
    fn unknown_legacy_entries_do_not_replace_current_credentials() {
        let directory = TestDirectory::new("legacy-compatibility");
        let vault = SecretVault::open(&directory.0).unwrap();
        let legacy_entry = "retired-integration:dev_test".to_string();
        let browser_entry = browser_key_entry("dev_test", "web_test");
        vault.set(legacy_entry.clone(), "legacy-synthetic").unwrap();
        vault.set(device_token_entry("dev_test"), "synthetic-token").unwrap();
        vault.set(browser_entry.clone(), "synthetic-browser-key").unwrap();

        // Updating current credentials must preserve unknown encrypted entries.
        let reopened = SecretVault::open(&directory.0).unwrap();
        reopened.set(device_token_entry("dev_test"), "rotated-token").unwrap();
        assert_eq!(reopened.get(&legacy_entry).unwrap(), "legacy-synthetic");
        assert_eq!(reopened.get(&browser_entry).unwrap(), "synthetic-browser-key");
        reopened.clear(&device_credential_entries("dev_test", &["web_test".into()])).unwrap();
        assert!(reopened.get_optional(&browser_entry).unwrap().is_none());
        assert!(reopened.get_optional(&device_token_entry("dev_test")).unwrap().is_none());
        assert_eq!(reopened.get(&legacy_entry).unwrap(), "legacy-synthetic");

        // Explicit instance reset also removes unknown legacy entries.
        reopened.clear_all().unwrap();
        assert!(SecretVault::open(&directory.0).unwrap().get_optional(&legacy_entry).unwrap().is_none());
    }

    #[test]
    fn switching_instance_clears_even_orphaned_credentials_durably() {
        let directory = TestDirectory::new("instance-reset");
        let vault = SecretVault::open(&directory.0).unwrap();
        for entry in [device_token_entry("old"), browser_key_entry("orphan", "unknown-browser"), attachment_store_key_entry("old")] {
            vault.set(entry, "synthetic-only").unwrap();
        }
        vault.clear_all().unwrap();
        assert!(vault.state.lock().unwrap().plaintext.entries.is_empty());
        let reopened = SecretVault::open(&directory.0).unwrap();
        assert!(reopened.state.lock().unwrap().plaintext.entries.is_empty());
    }

    #[test]
    fn deleting_one_browser_key_preserves_the_other_and_is_idempotent() {
        let directory = TestDirectory::new("browser-isolation");
        let vault = SecretVault::open(&directory.0).expect("open test vault");
        let first = browser_key_entry("dev_test", "web_first");
        let second = browser_key_entry("dev_test", "web_second");
        vault.set(first.clone(), "first").unwrap();
        vault.set(second.clone(), "second").unwrap();
        vault.clear(std::slice::from_ref(&first)).unwrap();
        vault.clear(std::slice::from_ref(&first)).unwrap();
        assert!(vault.get_optional(&first).unwrap().is_none());
        assert_eq!(vault.get(&second).unwrap(), "second");
    }

    #[test]
    fn attachment_store_key_is_stable_and_never_recreated_for_existing_data() {
        let directory = TestDirectory::new("attachment-store-key");
        let vault = SecretVault::open(&directory.0).expect("open test vault");
        let created = get_or_create_store_key(&vault, "dev_test", false)
            .expect("create attachment store key");
        assert!(valid_e2ee_key(&created));
        assert_eq!(
            get_or_create_store_key(&vault, "dev_test", true).unwrap(),
            created
        );

        vault
            .clear(&[attachment_store_key_entry("dev_test")])
            .expect("remove attachment store key");
        assert!(get_or_create_store_key(&vault, "dev_test", true).is_err());
    }

    #[test]
    fn clearing_device_credentials_includes_attachment_store_key() {
        let entries = device_credential_entries("dev_test", &["web_test".into()]);
        assert!(entries.contains(&attachment_store_key_entry("dev_test")));
        assert!(entries.contains(&browser_key_entry("dev_test", "web_test")));
    }

    #[test]
    fn missing_wrapping_key_never_replaces_an_existing_vault() {
        let directory = TestDirectory::new("missing-key");
        let vault = SecretVault::open(&directory.0).expect("open test vault");
        vault
            .set(device_token_entry("dev_test"), "token")
            .expect("persist token");
        fs::remove_file(directory.0.join(VAULT_KEY_FILE_NAME)).expect("remove wrapping key");
        assert!(SecretVault::open(&directory.0).is_err());
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let directory = TestDirectory::new("tamper");
        let vault = SecretVault::open(&directory.0).expect("open test vault");
        vault
            .set(device_token_entry("dev_test"), "token")
            .expect("persist token");
        let path = directory.0.join(VAULT_FILE_NAME);
        let mut envelope: VaultEnvelope =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let replacement = if envelope.ciphertext.starts_with('A') {
            "B"
        } else {
            "A"
        };
        envelope.ciphertext.replace_range(..1, replacement);
        fs::write(&path, serde_json::to_vec(&envelope).unwrap()).unwrap();
        assert!(SecretVault::open(&directory.0).is_err());
    }
}
