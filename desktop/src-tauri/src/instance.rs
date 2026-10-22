use crate::model::user_error;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path, time::Duration};
use url::{Host, Url};

/// Services are selected by origin. Never accept embedded credentials, path prefixes,
/// query parameters, or non-TLS remote addresses.
pub fn normalize_origin(value: &str) -> Result<String, String> {
    let url = Url::parse(value.trim()).map_err(|_| user_error("server_url_invalid"))?;
    let loopback = match url.host() {
        Some(Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(host)) => host.is_loopback(),
        Some(Host::Ipv6(host)) => host.is_loopback(),
        None => return Err(user_error("server_url_invalid")),
    };
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err(user_error("server_https_required"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(user_error("server_credentials_forbidden"));
    }
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err(user_error("server_components_forbidden"));
    }
    Ok(url.origin().ascii_serialization())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct InstanceCapabilities {
    pub schema_version: u8,
    pub auth_mode: String,
    pub setup_required: bool,
}

fn parse_capabilities(bytes: &[u8]) -> Result<InstanceCapabilities, String> {
    let info: InstanceCapabilities =
        serde_json::from_slice(bytes).map_err(|_| user_error("instance_probe_failed"))?;
    if info.schema_version != 1 || !matches!(info.auth_mode.as_str(), "email" | "username") {
        return Err(user_error("instance_probe_failed"));
    }
    Ok(info)
}

pub async fn probe(value: &str) -> Result<InstanceCapabilities, String> {
    let origin = normalize_origin(value)?;
    // A new client has no cookie jar, authorization, or caller-controlled headers.
    // Platform certificate verification remains enabled. Redirects fail even to
    // the same host, so discovery never silently changes the selected origin.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| user_error("instance_probe_failed"))?;
    let mut response = client
        .get(format!("{origin}/api/instance"))
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|_| user_error("instance_probe_failed"))?;
    if !response.status().is_success() {
        return Err(user_error("instance_probe_failed"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| user_error("instance_probe_failed"))?
    {
        if bytes.len() + chunk.len() > 16 * 1024 {
            return Err(user_error("instance_probe_failed"));
        }
        bytes.extend_from_slice(&chunk);
    }
    parse_capabilities(&bytes)
}

/// Never follow a configured state path outside our data directory or remove a
/// symlink target. The deleted stores have already lost their vault keys.
pub fn remove_instance_files(
    directory: &Path,
    device_id: &str,
    state_path: &str,
) -> Result<(), String> {
    let path = Path::new(state_path);
    if (path.parent() == Some(directory)
        && path.file_name().and_then(|v| v.to_str()) == Some("relay-outbox.json"))
        || path == directory.join(format!("relay-outbox-{device_id}.json"))
    {
        for suffix in [
            "",
            ".tmp",
            ".projects.json",
            ".projects.json.tmp",
            ".history-performance.jsonl",
            ".history-performance.jsonl.previous",
        ] {
            remove_file_if_present(Path::new(&format!("{state_path}{suffix}")))?;
        }
    }
    for suffix in ["", "-wal", "-shm", "-journal"] {
        remove_file_if_present(
            &directory.join(format!("relay-attachments-{device_id}.sqlite3{suffix}")),
        )?;
    }
    Ok(())
}

fn remove_file_if_present(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(user_error("instance_cleanup_failed")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_an_origin_without_weakening_tls() {
        assert_eq!(
            normalize_origin(" HTTPS://EXAMPLE.COM:443/ ").unwrap(),
            "https://example.com"
        );
        assert_eq!(
            normalize_origin("http://[::1]:3192").unwrap(),
            "http://[::1]:3192"
        );
        for invalid in [
            "http://192.168.1.2",
            "http://100.64.1.2",
            "https://user:secret@example.com",
            "https://example.com/api",
            "https://example.com?token=x",
            "https://example.com/#x",
            "file:///tmp/x",
            "https://example.com.evil/../api",
        ] {
            assert!(normalize_origin(invalid).is_err(), "{invalid}");
        }
    }
    #[test]
    fn rejects_unrecognized_or_incomplete_discovery() {
        for bytes in [
            br#"{}"#.as_slice(),
            br#"{"schema_version":2,"auth_mode":"username","setup_required":false}"#,
            br#"{"schema_version":1,"auth_mode":"unknown","setup_required":false}"#,
        ] {
            assert!(parse_capabilities(bytes).is_err());
        }
        assert!(
            parse_capabilities(
                br#"{"schema_version":1,"auth_mode":"username","setup_required":true}"#
            )
            .unwrap()
            .setup_required
        );
    }
    fn local_response(
        status: &str,
        body: &[u8],
        extra: &str,
    ) -> (
        String,
        std::sync::mpsc::Receiver<String>,
        std::thread::JoinHandle<()>,
    ) {
        use std::{
            io::{Read, Write},
            net::TcpListener,
            sync::mpsc,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let response = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n{extra}\r\n", body.len());
        let body = body.to_vec();
        let (send, receive) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut buffer = [0u8; 4096];
            let length = stream.read(&mut buffer).unwrap();
            let _ = send.send(String::from_utf8_lossy(&buffer[..length]).to_string());
            stream.write_all(response.as_bytes()).unwrap();
            let _ = stream.write_all(&body);
        });
        (address, receive, worker)
    }

    #[test]
    fn discovery_is_credential_free_and_does_not_follow_redirects() {
        let (origin, request, worker) = local_response(
            "200 OK",
            br#"{"schema_version":1,"auth_mode":"username","setup_required":false}"#,
            "",
        );
        let info = tauri::async_runtime::block_on(probe(&origin)).unwrap();
        assert_eq!(info.auth_mode, "username");
        let request = request
            .recv_timeout(Duration::from_secs(3))
            .unwrap()
            .to_ascii_lowercase();
        assert!(request.starts_with("get /api/instance http/1.1"));
        for forbidden in ["authorization:", "cookie:", "x-relay-device-token:"] {
            assert!(!request.contains(forbidden));
        }
        worker.join().unwrap();
        let (origin, _, worker) = local_response(
            "302 Found",
            b"",
            "Location: http://127.0.0.1:1/forbidden\r\n",
        );
        assert!(tauri::async_runtime::block_on(probe(&origin)).is_err());
        worker.join().unwrap();
    }

    #[test]
    fn discovery_rejects_oversized_responses() {
        let (origin, _, worker) = local_response("200 OK", &vec![b' '; 16385], "");
        assert!(tauri::async_runtime::block_on(probe(&origin)).is_err());
        worker.join().unwrap();
    }

    #[test]
    fn cleanup_is_confined_to_instance_stores() {
        let root =
            std::env::temp_dir().join(format!("relayune-instance-test-{}", rand::random::<u64>()));
        fs::create_dir_all(&root).unwrap();
        let old = root.join("relay-outbox-mac_test.json");
        let unrelated = root.join("do-not-remove.json");
        let attachment = root.join("relay-attachments-mac_test.sqlite3-wal");
        for path in [&old, &unrelated, &attachment] {
            fs::write(path, b"synthetic").unwrap();
        }
        remove_instance_files(&root, "mac_test", unrelated.to_str().unwrap()).unwrap();
        assert!(unrelated.exists());
        assert!(!attachment.exists());
        assert!(old.exists());
        remove_instance_files(&root, "mac_test", old.to_str().unwrap()).unwrap();
        assert!(!old.exists());
        fs::remove_dir_all(root).unwrap();
    }
}
