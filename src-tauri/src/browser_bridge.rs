use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::config::{default_config_path, ConfigStore};
use crate::engine::{BrowserTranslationRequest, RustEngine};

const PROTOCOL_VERSION: u8 = 1;
const MAX_NATIVE_MESSAGE_BYTES: usize = 1024 * 1024;
const BRIDGE_FILE_NAME: &str = "browser-bridge.json";
pub const EXTENSION_ID: &str = "bdkkgjjmocmdknffadjgbljmnhdcchjl";
const NATIVE_HOST_NAME: &str = "com.nudenyang.translator";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeEnvelope {
    token: String,
    request: Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeDescriptor {
    protocol_version: u8,
    port: u16,
    token: String,
    pid: u32,
}

#[derive(Serialize)]
struct NativeHostManifest {
    name: &'static str,
    description: &'static str,
    path: String,
    r#type: &'static str,
    allowed_origins: Vec<String>,
}

pub struct BrowserBridgeState {
    stopping: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
    descriptor_path: PathBuf,
}

impl BrowserBridgeState {
    pub fn start(app: AppHandle) -> Result<Self, String> {
        let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
            .map_err(|error| format!("브라우저 번역 브리지를 열지 못했습니다: {error}"))?;
        listener.set_nonblocking(true).map_err(|error| {
            format!("브라우저 번역 브리지 대기 방식을 설정하지 못했습니다: {error}")
        })?;
        let port = listener
            .local_addr()
            .map_err(|error| format!("브라우저 번역 브리지 주소를 확인하지 못했습니다: {error}"))?
            .port();
        let descriptor_path = bridge_descriptor_path();
        let token = random_token()?;
        write_descriptor(
            &descriptor_path,
            &BridgeDescriptor {
                protocol_version: PROTOCOL_VERSION,
                port,
                token: token.clone(),
                pid: std::process::id(),
            },
        )?;

        let stopping = Arc::new(AtomicBool::new(false));
        let thread_stopping = Arc::clone(&stopping);
        let thread = thread::Builder::new()
            .name("nudenyang-browser-bridge".to_string())
            .spawn(move || {
                while !thread_stopping.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((stream, address)) if address.ip().is_loopback() => {
                            if let Err(error) = handle_bridge_connection(stream, &token, &app) {
                                crate::diagnostics::warn("browser-bridge", &error);
                            }
                        }
                        Ok(_) => {}
                        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(25));
                        }
                        Err(error) => {
                            crate::diagnostics::warn(
                                "browser-bridge",
                                &format!("브라우저 번역 브리지 연결을 받지 못했습니다: {error}"),
                            );
                            thread::sleep(Duration::from_millis(100));
                        }
                    }
                }
            })
            .map_err(|error| {
                format!("브라우저 번역 브리지 작업자를 시작하지 못했습니다: {error}")
            })?;

        Ok(Self {
            stopping,
            thread: Mutex::new(Some(thread)),
            descriptor_path,
        })
    }

    pub fn stop(&self) {
        self.stopping.store(true, Ordering::Relaxed);
        if let Ok(mut slot) = self.thread.lock() {
            if let Some(thread) = slot.take() {
                let _ = thread.join();
            }
        }
        let _ = fs::remove_file(&self.descriptor_path);
    }
}

impl Drop for BrowserBridgeState {
    fn drop(&mut self) {
        self.stop();
    }
}

fn handle_bridge_connection(
    mut stream: TcpStream,
    expected_token: &str,
    app: &AppHandle,
) -> Result<(), String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(190)))
        .map_err(|error| format!("브리지 읽기 제한 시간을 설정하지 못했습니다: {error}"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(10)))
        .map_err(|error| format!("브리지 쓰기 제한 시간을 설정하지 못했습니다: {error}"))?;
    let request_bytes = read_line_limited(&mut stream)?;
    let envelope: BridgeEnvelope = serde_json::from_slice(&request_bytes)
        .map_err(|error| format!("브라우저 번역 요청 형식이 올바르지 않습니다: {error}"))?;
    if !tokens_equal(&envelope.token, expected_token) {
        return Err("브라우저 번역 브리지 인증에 실패했습니다.".to_string());
    }
    let response = dispatch_request(app, envelope.request);
    let mut encoded = serde_json::to_vec(&response)
        .map_err(|error| format!("브라우저 번역 응답을 만들지 못했습니다: {error}"))?;
    encoded.push(b'\n');
    stream
        .write_all(&encoded)
        .map_err(|error| format!("브라우저 번역 응답을 전송하지 못했습니다: {error}"))
}

fn dispatch_request(app: &AppHandle, request: Value) -> Value {
    let request_id = request
        .get("requestId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    match request.get("type").and_then(Value::as_str) {
        Some("hello" | "status") => {
            let config = app.state::<ConfigStore>().get();
            let status = app.state::<RustEngine>().status();
            match (config, status) {
                (Ok(config), Ok(status)) => json!({
                    "type": "status",
                    "requestId": request_id,
                    "protocolVersion": PROTOCOL_VERSION,
                    "appVersion": env!("CARGO_PKG_VERSION"),
                    "ready": status.active_translator == config.translator,
                    "targetLanguage": config.target_language,
                    "translator": config.translator,
                    "activeTranslator": status.active_translator,
                    "translatorState": status.translator_state,
                }),
                (Err(error), _) | (_, Err(error)) => {
                    error_response(&request_id, "app_state_unavailable", &error, true)
                }
            }
        }
        Some("translate") => match serde_json::from_value::<BrowserTranslationRequest>(request) {
            Ok(request) => match app.state::<RustEngine>().translate_browser(request) {
                Ok(response) => json!({
                    "type": "translationResult",
                    "requestId": response.request_id,
                    "items": response.items,
                }),
                Err(error) => {
                    let preparing = error.contains("준비하고 있습니다");
                    error_response(
                        &request_id,
                        if preparing {
                            "model_preparing"
                        } else {
                            "translation_failed"
                        },
                        &error,
                        preparing,
                    )
                }
            },
            Err(error) => error_response(
                &request_id,
                "invalid_request",
                &format!("웹페이지 번역 요청 형식이 올바르지 않습니다: {error}"),
                false,
            ),
        },
        Some("cancel") => json!({ "type": "cancelled", "requestId": request_id }),
        _ => error_response(
            &request_id,
            "unsupported_request",
            "지원하지 않는 브라우저 번역 요청입니다.",
            false,
        ),
    }
}

fn error_response(request_id: &str, code: &str, message: &str, retryable: bool) -> Value {
    json!({
        "type": "error",
        "requestId": request_id,
        "code": code,
        "message": message,
        "retryable": retryable,
    })
}

pub fn run_native_messaging_host() -> Result<(), String> {
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let stdout = io::stdout();
    let mut output = stdout.lock();
    loop {
        let Some(request) = read_native_message(&mut input)? else {
            return Ok(());
        };
        let request_id = request
            .get("requestId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let response = forward_to_running_app(request)
            .unwrap_or_else(|error| error_response(&request_id, "app_unavailable", &error, true));
        write_native_message(&mut output, &response)?;
    }
}

#[cfg(windows)]
pub fn register_native_messaging_host() -> Result<PathBuf, String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let executable = std::env::current_exe()
        .map_err(|error| format!("Windows 앱 실행 경로를 확인하지 못했습니다: {error}"))?;
    let manifest_path = native_host_manifest_path();
    let parent = manifest_path
        .parent()
        .ok_or_else(|| "브라우저 연결 구성요소 폴더가 올바르지 않습니다.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("브라우저 연결 구성요소 폴더를 만들지 못했습니다: {error}"))?;
    let manifest = NativeHostManifest {
        name: NATIVE_HOST_NAME,
        description: "NudeNyang Web Translator native messaging host",
        path: executable.to_string_lossy().into_owned(),
        r#type: "stdio",
        allowed_origins: vec![format!("chrome-extension://{EXTENSION_ID}/")],
    };
    let encoded = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| format!("브라우저 연결 구성요소 정보를 만들지 못했습니다: {error}"))?;
    fs::write(&manifest_path, encoded)
        .map_err(|error| format!("브라우저 연결 구성요소 정보를 저장하지 못했습니다: {error}"))?;

    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    for browser_key in native_host_registry_keys() {
        let (key, _) = current_user
            .create_subkey(browser_key)
            .map_err(|error| format!("브라우저 연결 레지스트리를 만들지 못했습니다: {error}"))?;
        key.set_value("", &manifest_path.to_string_lossy().as_ref())
            .map_err(|error| format!("브라우저 연결 레지스트리를 저장하지 못했습니다: {error}"))?;
    }
    Ok(manifest_path)
}

#[cfg(not(windows))]
pub fn register_native_messaging_host() -> Result<PathBuf, String> {
    Err("브라우저 연결 구성요소 자동 등록은 현재 Windows에서만 지원합니다.".to_string())
}

#[cfg(windows)]
pub fn unregister_native_messaging_host() -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    for browser_key in native_host_registry_keys() {
        match current_user.delete_subkey_all(browser_key) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "브라우저 연결 레지스트리를 제거하지 못했습니다: {error}"
                ))
            }
        }
    }
    match fs::remove_file(native_host_manifest_path()) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "브라우저 연결 구성요소 정보를 제거하지 못했습니다: {error}"
        )),
    }
}

#[cfg(not(windows))]
pub fn unregister_native_messaging_host() -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn native_host_registry_keys() -> [&'static str; 2] {
    [
        "Software\\Google\\Chrome\\NativeMessagingHosts\\com.nudenyang.translator",
        "Software\\Naver\\Naver Whale\\NativeMessagingHosts\\com.nudenyang.translator",
    ]
}

fn native_host_manifest_path() -> PathBuf {
    default_config_path()
        .parent()
        .map(|path| {
            path.join("native-messaging")
                .join(format!("{NATIVE_HOST_NAME}.json"))
        })
        .unwrap_or_else(|| PathBuf::from(format!("{NATIVE_HOST_NAME}.json")))
}

fn forward_to_running_app(request: Value) -> Result<Value, String> {
    let descriptor_bytes = fs::read(bridge_descriptor_path())
        .map_err(|_| "NudeNyang Windows 앱을 먼저 실행한 뒤 다시 시도하십시오.".to_string())?;
    let descriptor: BridgeDescriptor = serde_json::from_slice(&descriptor_bytes)
        .map_err(|error| format!("브라우저 번역 연결 정보가 올바르지 않습니다: {error}"))?;
    if descriptor.protocol_version != PROTOCOL_VERSION {
        return Err("Windows 앱과 확장 프로그램의 연결 규격이 다릅니다.".to_string());
    }
    let mut stream = TcpStream::connect_timeout(
        &SocketAddrV4::new(Ipv4Addr::LOCALHOST, descriptor.port).into(),
        Duration::from_secs(2),
    )
    .map_err(|_| {
        "NudeNyang Windows 앱에 연결하지 못했습니다. 앱을 다시 실행하십시오.".to_string()
    })?;
    stream
        .set_read_timeout(Some(Duration::from_secs(190)))
        .map_err(|error| format!("Windows 앱 응답 제한 시간을 설정하지 못했습니다: {error}"))?;
    let mut encoded = serde_json::to_vec(&BridgeEnvelope {
        token: descriptor.token,
        request,
    })
    .map_err(|error| format!("Windows 앱 요청을 만들지 못했습니다: {error}"))?;
    encoded.push(b'\n');
    stream
        .write_all(&encoded)
        .map_err(|error| format!("Windows 앱에 번역 요청을 전송하지 못했습니다: {error}"))?;
    let response = read_line_limited(&mut stream)?;
    serde_json::from_slice(&response)
        .map_err(|error| format!("Windows 앱의 응답 형식이 올바르지 않습니다: {error}"))
}

fn read_native_message(reader: &mut impl Read) -> Result<Option<Value>, String> {
    let mut length = [0_u8; 4];
    let mut read = 0;
    while read < length.len() {
        match reader.read(&mut length[read..]) {
            Ok(0) if read == 0 => return Ok(None),
            Ok(0) => return Err("브라우저 요청 길이를 끝까지 읽지 못했습니다.".to_string()),
            Ok(count) => read += count,
            Err(error) => return Err(format!("브라우저 요청 길이를 읽지 못했습니다: {error}")),
        }
    }
    let length = u32::from_le_bytes(length) as usize;
    if length == 0 || length > MAX_NATIVE_MESSAGE_BYTES {
        return Err("브라우저 요청 크기가 허용 범위를 벗어났습니다.".to_string());
    }
    let mut message = vec![0_u8; length];
    reader
        .read_exact(&mut message)
        .map_err(|error| format!("브라우저 요청을 읽지 못했습니다: {error}"))?;
    serde_json::from_slice(&message)
        .map(Some)
        .map_err(|error| format!("브라우저 요청 JSON이 올바르지 않습니다: {error}"))
}

fn write_native_message(writer: &mut impl Write, message: &Value) -> Result<(), String> {
    let encoded = serde_json::to_vec(message)
        .map_err(|error| format!("브라우저 응답 JSON을 만들지 못했습니다: {error}"))?;
    if encoded.len() > MAX_NATIVE_MESSAGE_BYTES {
        return Err("브라우저 응답이 허용 크기를 초과했습니다.".to_string());
    }
    writer
        .write_all(&(encoded.len() as u32).to_le_bytes())
        .and_then(|_| writer.write_all(&encoded))
        .and_then(|_| writer.flush())
        .map_err(|error| format!("브라우저 응답을 쓰지 못했습니다: {error}"))
}

fn read_line_limited(stream: &mut TcpStream) -> Result<Vec<u8>, String> {
    let mut reader = BufReader::new(stream);
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take((MAX_NATIVE_MESSAGE_BYTES + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .map_err(|error| format!("Windows 앱 브리지 메시지를 읽지 못했습니다: {error}"))?;
    if bytes.len() > MAX_NATIVE_MESSAGE_BYTES {
        return Err("Windows 앱 브리지 메시지가 허용 크기를 초과했습니다.".to_string());
    }
    if bytes.last() == Some(&b'\n') {
        bytes.pop();
    }
    if bytes.is_empty() {
        return Err("Windows 앱 브리지 메시지가 비어 있습니다.".to_string());
    }
    Ok(bytes)
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("브라우저 번역 인증 키를 만들지 못했습니다: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn bridge_descriptor_path() -> PathBuf {
    default_config_path()
        .parent()
        .map(|path| path.join(BRIDGE_FILE_NAME))
        .unwrap_or_else(|| PathBuf::from(BRIDGE_FILE_NAME))
}

fn write_descriptor(path: &PathBuf, descriptor: &BridgeDescriptor) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "브라우저 번역 연결 정보 폴더가 올바르지 않습니다.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("브라우저 번역 연결 정보 폴더를 만들지 못했습니다: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    let encoded = serde_json::to_vec(descriptor)
        .map_err(|error| format!("브라우저 번역 연결 정보를 만들지 못했습니다: {error}"))?;
    fs::write(&temporary, encoded)
        .map_err(|error| format!("브라우저 번역 연결 정보를 쓰지 못했습니다: {error}"))?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| {
            format!("이전 브라우저 번역 연결 정보를 교체하지 못했습니다: {error}")
        })?;
    }
    fs::rename(&temporary, path)
        .map_err(|error| format!("브라우저 번역 연결 정보를 적용하지 못했습니다: {error}"))
}

fn tokens_equal(left: &str, right: &str) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.bytes()
        .zip(right.bytes())
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

#[cfg(test)]
mod tests {
    use super::{read_native_message, tokens_equal, write_native_message};
    use serde_json::json;
    use std::io::Cursor;

    #[test]
    fn native_message_round_trip_uses_little_endian_length_prefix() {
        let message = json!({"type": "hello", "requestId": "request-1"});
        let mut bytes = Vec::new();
        write_native_message(&mut bytes, &message).unwrap();
        assert_eq!(
            u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize,
            bytes.len() - 4
        );
        assert_eq!(
            read_native_message(&mut Cursor::new(bytes)).unwrap(),
            Some(message)
        );
    }

    #[test]
    fn bridge_tokens_must_match_exactly() {
        assert!(tokens_equal("0011aabb", "0011aabb"));
        assert!(!tokens_equal("0011aabb", "0011aabc"));
        assert!(!tokens_equal("0011aabb", "0011aabb00"));
    }
}
