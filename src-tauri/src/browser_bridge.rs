use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::config::{default_config_path, ConfigStore};
use crate::engine::{BrowserTranslationRequest, RustEngine};

const PROTOCOL_VERSION: u8 = 1;
const MAX_NATIVE_MESSAGE_BYTES: usize = 1024 * 1024;
const BRIDGE_FILE_NAME: &str = "browser-bridge.json";
pub const CHROME_WEB_STORE_EXTENSION_ID: &str = "kpagdcdgomdlnnphakjakpodmgnhgaia";
pub const LEGACY_CHROMIUM_DEVELOPMENT_EXTENSION_ID: &str = "bdkkgjjmocmdknffadjgbljmnhdcchjl";
pub const CHROMIUM_EXTENSION_IDS: &[&str] = &[
    CHROME_WEB_STORE_EXTENSION_ID,
    LEGACY_CHROMIUM_DEVELOPMENT_EXTENSION_ID,
];
pub const FIREFOX_EXTENSION_ID: &str = "web-translator@nudenyang.github.io";
const NATIVE_HOST_NAME: &str = "com.nudenyang.translator";

static BROWSER_CLIENTS: OnceLock<Mutex<BTreeMap<String, BrowserClientInfo>>> = OnceLock::new();

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserClientInfo {
    browser: String,
    extension_version: String,
    last_seen_at: u64,
}

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
struct ChromiumNativeHostManifest {
    name: &'static str,
    description: &'static str,
    path: String,
    r#type: &'static str,
    allowed_origins: Vec<String>,
}

#[derive(Serialize)]
struct FirefoxNativeHostManifest {
    name: &'static str,
    description: &'static str,
    path: String,
    r#type: &'static str,
    allowed_extensions: Vec<&'static str>,
}

fn chromium_allowed_origins() -> Vec<String> {
    CHROMIUM_EXTENSION_IDS
        .iter()
        .map(|extension_id| format!("chrome-extension://{extension_id}/"))
        .collect()
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
    let envelope = parse_bridge_envelope(&request_bytes)?;
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

fn parse_bridge_envelope(bytes: &[u8]) -> Result<BridgeEnvelope, String> {
    // Serde type errors can quote the supplied string. This error reaches the
    // bridge thread's diagnostic log before a private request scope exists.
    serde_json::from_slice(bytes)
        .map_err(|_| "브라우저 번역 요청 형식이 올바르지 않습니다.".to_string())
}

fn record_browser_client(request: &Value) {
    let Some(client) = request.get("client") else {
        return;
    };
    let browser = client
        .get("browser")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "chrome" | "whale" | "firefox"))
        .unwrap_or_default();
    if browser.is_empty() {
        return;
    }
    let extension_version = client
        .get("extensionVersion")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .chars()
        .take(32)
        .collect::<String>();
    let last_seen_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64;
    if let Ok(mut clients) = BROWSER_CLIENTS
        .get_or_init(|| Mutex::new(BTreeMap::new()))
        .lock()
    {
        clients.insert(
            browser.to_string(),
            BrowserClientInfo {
                browser: browser.to_string(),
                extension_version,
                last_seen_at,
            },
        );
    }
}

#[tauri::command]
pub fn browser_clients_status() -> Vec<BrowserClientInfo> {
    BROWSER_CLIENTS
        .get_or_init(|| Mutex::new(BTreeMap::new()))
        .lock()
        .map(|clients| clients.values().cloned().collect())
        .unwrap_or_default()
}

fn web_settings_value(config: &crate::config::AppConfig) -> Value {
    json!({
        "enabled": config.web_translation_enabled,
        "messengerEnabled": config.web_messenger_enabled,
        "targetLanguage": config.web_target_language,
        "processingMode": config.web_processing_mode,
        "externalPageCharLimit": config.web_external_page_char_limit,
        "quickToggleShortcut": config.web_quick_toggle_shortcut,
        "sitePolicies": config.web_site_policies,
    })
}

fn interface_language_value(configured: &str) -> (&str, &'static str) {
    (
        configured,
        crate::ui_locale::resolve_ui_language(configured),
    )
}

fn update_web_settings(app: &AppHandle, patch: Value) -> Result<Value, String> {
    let allowed = [
        "web_translation_enabled",
        "web_messenger_enabled",
        "web_target_language",
        "web_processing_mode",
        "web_external_page_char_limit",
        "web_quick_toggle_shortcut",
        "web_site_policies",
    ];
    let patch = patch
        .as_object()
        .ok_or_else(|| "웹 번역 설정 형식이 올바르지 않습니다.".to_string())?;
    if patch.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err("확장 프로그램에서 변경할 수 없는 설정이 포함되어 있습니다.".to_string());
    }
    let previous = app.state::<ConfigStore>().get()?;
    let updated = app
        .state::<ConfigStore>()
        .update(Value::Object(patch.clone()))?;
    if let Err(error) = app.state::<RustEngine>().apply_config(updated.clone()) {
        let _ = app.state::<ConfigStore>().replace(previous);
        return Err(error);
    }
    let _ = app.emit("settings-changed", updated.clone());
    Ok(web_settings_value(&updated))
}

fn dispatch_request(app: &AppHandle, request: Value) -> Value {
    record_browser_client(&request);
    let request_id = request
        .get("requestId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    match request.get("type").and_then(Value::as_str) {
        Some("hello" | "status") => {
            let config = app.state::<ConfigStore>().get();
            let engine = app.state::<RustEngine>();
            if config
                .as_ref()
                .is_ok_and(|config| config.web_translation_enabled)
            {
                let _ = engine.prepare_browser_session();
            }
            let status = engine.status();
            match (config, status) {
                (Ok(config), Ok(status)) => {
                    let (ui_language, resolved_ui_language) =
                        interface_language_value(&config.ui_language);
                    let model_ready = status.active_translator == config.translator;
                    json!({
                        "type": "status",
                        "requestId": request_id,
                        "protocolVersion": PROTOCOL_VERSION,
                        "appVersion": env!("CARGO_PKG_VERSION"),
                        "ready": model_ready,
                        "appConnected": true,
                        "modelReady": model_ready,
                        "discordConnected": status.cdp_connected,
                        "uiLanguage": ui_language,
                        "resolvedUiLanguage": resolved_ui_language,
                        "targetLanguage": config.target_language,
                        "translator": config.translator,
                        "activeTranslator": status.active_translator,
                        "translatorState": status.translator_state,
                        "webSettings": web_settings_value(&config),
                    })
                }
                (Err(error), _) | (_, Err(error)) => {
                    error_response(&request_id, "app_state_unavailable", &error, true)
                }
            }
        }
        Some("translate") => match serde_json::from_value::<BrowserTranslationRequest>(request) {
            Ok(request) => match app.state::<RustEngine>().translate_browser(request) {
                Ok(response) => {
                    let config = app.state::<ConfigStore>().get().ok();
                    let web_settings = config
                        .as_ref()
                        .map(web_settings_value)
                        .unwrap_or(Value::Null);
                    json!({
                        "type": "translationResult",
                        "requestId": response.request_id,
                        "items": response.items,
                        "webSettings": web_settings,
                        "translator": config.as_ref().map(|config| config.translator.as_str()),
                    })
                }
                Err(error) => translation_error_response(&request_id, &error),
            },
            Err(_) => error_response(
                &request_id,
                "invalid_request",
                "웹페이지 번역 요청 형식이 올바르지 않습니다.",
                false,
            ),
        },
        Some("webSettingsUpdate") => {
            let patch = request.get("patch").cloned().unwrap_or(Value::Null);
            match update_web_settings(app, patch) {
                Ok(web_settings) => json!({
                    "type": "webSettings",
                    "requestId": request_id,
                    "webSettings": web_settings,
                }),
                Err(error) => {
                    error_response(&request_id, "web_settings_update_failed", &error, false)
                }
            }
        }
        Some("openWebSettings") => {
            let result = app
                .get_webview_window("main")
                .ok_or_else(|| "설정창을 찾지 못했습니다.".to_string())
                .and_then(|window| {
                    activate_settings_window(
                        || window.show().map_err(|error| error.to_string()),
                        || window.unminimize().map_err(|error| error.to_string()),
                        || {
                            window
                                .set_always_on_top(true)
                                .map_err(|error| error.to_string())
                        },
                        || window.set_focus().map_err(|error| error.to_string()),
                        || {
                            window
                                .set_always_on_top(false)
                                .map_err(|error| error.to_string())
                        },
                    )?;
                    app.emit_to("main", "open-settings-panel", "web")
                        .map_err(|error| error.to_string())
                });
            match result {
                Ok(()) => json!({ "type": "opened", "requestId": request_id }),
                Err(error) => {
                    error_response(&request_id, "settings_window_unavailable", &error, true)
                }
            }
        }
        Some("cancel") => json!({ "type": "cancelled", "requestId": request_id }),
        _ => error_response(
            &request_id,
            "unsupported_request",
            "지원하지 않는 브라우저 번역 요청입니다.",
            false,
        ),
    }
}

fn translation_error_response(request_id: &str, error: &str) -> Value {
    for code in [
        "web_translation_disabled",
        "messenger_disabled",
        "messenger_local_only",
        "messenger_consent_required",
        "messenger_invalid_context",
        "messenger_request_cancelled",
    ] {
        if let Some(message) = error.strip_prefix(&format!("[{code}] ")) {
            return error_response(request_id, code, message, false);
        }
    }
    let preparing = error.contains("준비하고 있습니다");
    error_response(
        request_id,
        if preparing {
            "model_preparing"
        } else {
            "translation_failed"
        },
        error,
        preparing,
    )
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

fn activate_settings_window<Show, Unminimize, Raise, Focus, Lower>(
    show: Show,
    unminimize: Unminimize,
    raise: Raise,
    focus: Focus,
    lower: Lower,
) -> Result<(), String>
where
    Show: FnOnce() -> Result<(), String>,
    Unminimize: FnOnce() -> Result<(), String>,
    Raise: FnOnce() -> Result<(), String>,
    Focus: FnOnce() -> Result<(), String>,
    Lower: FnOnce() -> Result<(), String>,
{
    show()?;
    unminimize()?;
    raise()?;
    let focus_result = focus();
    let lower_result = lower();
    focus_result?;
    lower_result
}

#[cfg(test)]
mod window_activation_tests {
    use std::cell::RefCell;

    use super::activate_settings_window;

    #[test]
    fn settings_window_is_restored_and_raised_before_focus() {
        let calls = RefCell::new(Vec::new());
        activate_settings_window(
            || {
                calls.borrow_mut().push("show");
                Ok(())
            },
            || {
                calls.borrow_mut().push("unminimize");
                Ok(())
            },
            || {
                calls.borrow_mut().push("raise");
                Ok(())
            },
            || {
                calls.borrow_mut().push("focus");
                Ok(())
            },
            || {
                calls.borrow_mut().push("lower");
                Ok(())
            },
        )
        .expect("settings window activation should succeed");

        assert_eq!(
            calls.into_inner(),
            ["show", "unminimize", "raise", "focus", "lower"]
        );
    }

    #[test]
    fn settings_window_is_lowered_even_when_focus_fails() {
        let calls = RefCell::new(Vec::new());
        let result = activate_settings_window(
            || Ok(()),
            || Ok(()),
            || {
                calls.borrow_mut().push("raise");
                Ok(())
            },
            || Err("focus denied".to_string()),
            || {
                calls.borrow_mut().push("lower");
                Ok(())
            },
        );

        assert_eq!(result, Err("focus denied".to_string()));
        assert_eq!(calls.into_inner(), ["raise", "lower"]);
    }
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
    let chromium_manifest_path = chromium_native_host_manifest_path();
    let firefox_manifest_path = firefox_native_host_manifest_path();
    let parent = chromium_manifest_path
        .parent()
        .ok_or_else(|| "브라우저 연결 구성요소 폴더가 올바르지 않습니다.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("브라우저 연결 구성요소 폴더를 만들지 못했습니다: {error}"))?;
    let executable_path = executable.to_string_lossy().into_owned();
    let chromium_manifest = ChromiumNativeHostManifest {
        name: NATIVE_HOST_NAME,
        description: "NudeNyang Web Translator native messaging host",
        path: executable_path.clone(),
        r#type: "stdio",
        allowed_origins: chromium_allowed_origins(),
    };
    let firefox_manifest = FirefoxNativeHostManifest {
        name: NATIVE_HOST_NAME,
        description: "NudeNyang Web Translator native messaging host",
        path: executable_path,
        r#type: "stdio",
        allowed_extensions: vec![FIREFOX_EXTENSION_ID],
    };
    let chromium_encoded = serde_json::to_vec_pretty(&chromium_manifest)
        .map_err(|error| format!("브라우저 연결 구성요소 정보를 만들지 못했습니다: {error}"))?;
    let firefox_encoded = serde_json::to_vec_pretty(&firefox_manifest)
        .map_err(|error| format!("Firefox 연결 구성요소 정보를 만들지 못했습니다: {error}"))?;
    fs::write(&chromium_manifest_path, chromium_encoded)
        .map_err(|error| format!("브라우저 연결 구성요소 정보를 저장하지 못했습니다: {error}"))?;
    fs::write(&firefox_manifest_path, firefox_encoded)
        .map_err(|error| format!("Firefox 연결 구성요소 정보를 저장하지 못했습니다: {error}"))?;

    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    for (browser_key, manifest_path) in
        native_host_registry_entries(&chromium_manifest_path, &firefox_manifest_path)
    {
        let (key, _) = current_user
            .create_subkey(browser_key)
            .map_err(|error| format!("브라우저 연결 레지스트리를 만들지 못했습니다: {error}"))?;
        key.set_value("", &manifest_path.to_string_lossy().as_ref())
            .map_err(|error| format!("브라우저 연결 레지스트리를 저장하지 못했습니다: {error}"))?;
    }
    Ok(chromium_manifest_path)
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
    for manifest_path in [
        chromium_native_host_manifest_path(),
        firefox_native_host_manifest_path(),
    ] {
        match fs::remove_file(manifest_path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "브라우저 연결 구성요소 정보를 제거하지 못했습니다: {error}"
                ))
            }
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn unregister_native_messaging_host() -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn native_host_registry_keys() -> [&'static str; 3] {
    [
        "Software\\Google\\Chrome\\NativeMessagingHosts\\com.nudenyang.translator",
        "Software\\Naver\\Naver Whale\\NativeMessagingHosts\\com.nudenyang.translator",
        "Software\\Mozilla\\NativeMessagingHosts\\com.nudenyang.translator",
    ]
}

#[cfg(windows)]
fn native_host_registry_entries<'a>(
    chromium_manifest_path: &'a std::path::Path,
    firefox_manifest_path: &'a std::path::Path,
) -> [(&'static str, &'a std::path::Path); 3] {
    [
        (native_host_registry_keys()[0], chromium_manifest_path),
        (native_host_registry_keys()[1], chromium_manifest_path),
        (native_host_registry_keys()[2], firefox_manifest_path),
    ]
}

fn native_host_manifest_directory() -> PathBuf {
    default_config_path()
        .parent()
        .map(|path| path.join("native-messaging"))
        .unwrap_or_default()
}

fn chromium_native_host_manifest_path() -> PathBuf {
    native_host_manifest_directory().join(format!("{NATIVE_HOST_NAME}.json"))
}

fn firefox_native_host_manifest_path() -> PathBuf {
    native_host_manifest_directory().join(format!("{NATIVE_HOST_NAME}.firefox.json"))
}

pub fn is_native_messaging_host_invocation(arguments: &[OsString]) -> bool {
    let Some(first_argument) = arguments.get(1).and_then(|value| value.to_str()) else {
        return false;
    };
    if first_argument == "--browser-native-host"
        || first_argument.starts_with("chrome-extension://")
        || first_argument.starts_with("whale-extension://")
    {
        return true;
    }
    let firefox_manifest_path = firefox_native_host_manifest_path();
    let firefox_manifest = firefox_manifest_path.to_string_lossy();
    first_argument.eq_ignore_ascii_case(&firefox_manifest)
        && arguments
            .get(2)
            .and_then(|value| value.to_str())
            .is_some_and(|value| value == FIREFOX_EXTENSION_ID)
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
    use super::{
        firefox_native_host_manifest_path, interface_language_value,
        is_native_messaging_host_invocation, read_native_message, tokens_equal,
        write_native_message, ChromiumNativeHostManifest, FirefoxNativeHostManifest,
        CHROME_WEB_STORE_EXTENSION_ID, CHROMIUM_EXTENSION_IDS, FIREFOX_EXTENSION_ID,
        LEGACY_CHROMIUM_DEVELOPMENT_EXTENSION_ID, NATIVE_HOST_NAME,
    };

    use serde_json::json;
    use std::ffi::OsString;
    use std::io::Cursor;

    #[test]
    fn private_malformed_bridge_requests_never_echo_supplied_values() {
        let private_text = "private-message-must-never-appear-in-a-diagnostic";
        let malformed = serde_json::to_vec(&json!(private_text)).unwrap();
        let error = super::parse_bridge_envelope(&malformed).unwrap_err();
        assert_eq!(error, "브라우저 번역 요청 형식이 올바르지 않습니다.");
        assert!(!error.contains(private_text));

        let valid = serde_json::to_vec(&json!({
            "token": "test-token",
            "request": {"type": "translate", "items": [{"text": private_text}]}
        }))
        .unwrap();
        let envelope = super::parse_bridge_envelope(&valid).unwrap();
        assert_eq!(envelope.token, "test-token");
        assert_eq!(envelope.request["items"][0]["text"], private_text);
    }

    #[test]
    fn web_settings_expose_messenger_consent_as_default_off() {
        let mut config = crate::config::AppConfig::default();
        let settings = super::web_settings_value(&config);
        assert_eq!(settings["messengerEnabled"], false);
        assert_eq!(settings["enabled"], true);
        config.web_messenger_enabled = true;
        assert_eq!(super::web_settings_value(&config)["messengerEnabled"], true);
    }

    #[test]
    fn private_translation_errors_preserve_stable_non_retryable_codes() {
        for code in [
            "web_translation_disabled",
            "messenger_disabled",
            "messenger_local_only",
            "messenger_consent_required",
            "messenger_invalid_context",
            "messenger_request_cancelled",
        ] {
            let response = super::translation_error_response(
                "opaque-request",
                &format!("[{code}] 요청이 허용되지 않습니다."),
            );
            assert_eq!(response["code"], code);
            assert_eq!(response["retryable"], false);
            assert_eq!(response["message"], "요청이 허용되지 않습니다.");
        }
        assert_eq!(
            super::translation_error_response("request", "번역 모델을 준비하고 있습니다.")["code"],
            "model_preparing"
        );
        assert_eq!(
            super::translation_error_response("request", "번역 모델을 준비하고 있습니다.")
                ["retryable"],
            true
        );
        assert_eq!(
            super::translation_error_response("request", "일반 오류")["code"],
            "translation_failed"
        );
    }

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

    #[test]
    fn native_manifests_use_browser_specific_allow_lists() {
        let chromium = serde_json::to_value(ChromiumNativeHostManifest {
            name: NATIVE_HOST_NAME,
            description: "test",
            path: "C:\\NudeNyang.exe".to_string(),
            r#type: "stdio",
            allowed_origins: super::chromium_allowed_origins(),
        })
        .unwrap();
        let firefox = serde_json::to_value(FirefoxNativeHostManifest {
            name: NATIVE_HOST_NAME,
            description: "test",
            path: "C:\\NudeNyang.exe".to_string(),
            r#type: "stdio",
            allowed_extensions: vec![FIREFOX_EXTENSION_ID],
        })
        .unwrap();

        assert_eq!(
            chromium["allowed_origins"],
            json!([
                format!("chrome-extension://{CHROME_WEB_STORE_EXTENSION_ID}/"),
                format!("chrome-extension://{LEGACY_CHROMIUM_DEVELOPMENT_EXTENSION_ID}/")
            ])
        );
        assert_eq!(
            CHROMIUM_EXTENSION_IDS,
            &[
                CHROME_WEB_STORE_EXTENSION_ID,
                LEGACY_CHROMIUM_DEVELOPMENT_EXTENSION_ID
            ]
        );
        assert!(chromium.get("allowed_extensions").is_none());
        assert_eq!(firefox["allowed_extensions"], json!([FIREFOX_EXTENSION_ID]));
        assert!(firefox.get("allowed_origins").is_none());
    }

    #[test]
    fn firefox_native_host_arguments_enter_stdio_mode_only_for_the_known_addon() {
        let manifest = firefox_native_host_manifest_path().into_os_string();
        assert!(is_native_messaging_host_invocation(&[
            OsString::from("NudeNyang.exe"),
            manifest.clone(),
            OsString::from(FIREFOX_EXTENSION_ID),
        ]));
        assert!(!is_native_messaging_host_invocation(&[
            OsString::from("NudeNyang.exe"),
            manifest,
            OsString::from("unknown@example.org"),
        ]));
    }

    #[test]
    fn browser_status_uses_the_configured_and_resolved_app_interface_language() {
        assert_eq!(interface_language_value("ja"), ("ja", "ja"));
        assert_eq!(interface_language_value("zh-TW"), ("zh-TW", "zh-Hant"));
        assert_eq!(
            interface_language_value("unsupported"),
            ("unsupported", "en")
        );
    }
}
