#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_paths;
pub mod cache;
pub mod cdp;
mod config;
mod credentials;
pub mod diagnostics;
pub mod dictionary;
pub mod dictionary_ui;
mod discord;
mod discord_startup;
pub mod dom;
mod engine;
pub mod image_translation;
pub mod invite_assist;
pub mod language;
pub mod ocr;
pub mod outgoing;
mod providers;
pub mod text_split;
pub mod translation;
mod ui_locale;
mod updater;

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use sysinfo::{Pid, System};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size, State, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;

use config::{AppConfig, ConfigStore};
use engine::RustEngine;

#[derive(Default)]
struct LifecycleState {
    exiting: AtomicBool,
}

#[derive(Default)]
struct UpdateAvailabilityState {
    version: Mutex<Option<String>>,
}

struct ShortcutBinding {
    configured: Mutex<String>,
    fallback_virtual_key: AtomicU32,
}

impl ShortcutBinding {
    fn new(default: &str) -> Self {
        Self {
            configured: Mutex::new(default.to_string()),
            fallback_virtual_key: AtomicU32::new(0),
        }
    }
}

struct ShortcutConfig {
    toggle_translation: ShortcutBinding,
    toggle_outgoing_translation: ShortcutBinding,
    capture_active: AtomicBool,
}

impl Default for ShortcutConfig {
    fn default() -> Self {
        Self {
            toggle_translation: ShortcutBinding::new("F12"),
            toggle_outgoing_translation: ShortcutBinding::new("F8"),
            capture_active: AtomicBool::new(false),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ShortcutAction {
    Translation,
    OutgoingTranslation,
}

fn shortcut_action_for(config: &ShortcutConfig, pressed: &str) -> Option<ShortcutAction> {
    [
        ShortcutAction::Translation,
        ShortcutAction::OutgoingTranslation,
    ]
    .into_iter()
    .find(|action| {
        config
            .binding(*action)
            .configured
            .lock()
            .map(|configured| configured.eq_ignore_ascii_case(pressed))
            .unwrap_or(false)
    })
}

fn shortcut_changed(current: &str, next: &str) -> bool {
    !current.eq_ignore_ascii_case(next)
}

fn shortcuts_are_unique(shortcuts: &[&str]) -> bool {
    shortcuts.iter().enumerate().all(|(index, shortcut)| {
        shortcuts[index + 1..]
            .iter()
            .all(|other| !shortcut.eq_ignore_ascii_case(other))
    })
}

impl ShortcutConfig {
    fn binding(&self, action: ShortcutAction) -> &ShortcutBinding {
        match action {
            ShortcutAction::Translation => &self.toggle_translation,
            ShortcutAction::OutgoingTranslation => &self.toggle_outgoing_translation,
        }
    }
}

impl ShortcutAction {
    fn event_name(self) -> &'static str {
        match self {
            Self::Translation => "request-translation-toggle",
            Self::OutgoingTranslation => "request-outgoing-translation-toggle",
        }
    }
}

fn set_translation_enabled_from_app(app: &AppHandle, enabled: bool) -> Result<Value, String> {
    let config = app.state::<ConfigStore>();
    let engine = app.state::<RustEngine>();
    let previous_config = config.get()?;
    config.update(json!({"enabled": enabled}))?;
    engine.set_enabled(enabled).inspect_err(|_| {
        let _ = config.replace(previous_config);
    })?;
    let status = serde_json::to_value(engine.status()?)
        .map_err(|error| format!("Rust 번역 상태를 변환하지 못했습니다: {error}"))?;
    let _ = app.emit("translation-state-changed", status.clone());
    Ok(status)
}

fn toggle_translation_from_app(app: &AppHandle) -> Result<Value, String> {
    let config = app.state::<ConfigStore>().get()?;
    if !config.enabled && !config.discord_auto_restart_consent_granted {
        main_window_show(app.clone());
        app.emit("request-translation-toggle", ())
            .map_err(|error| format!("번역 시작 동의 화면을 열지 못했습니다: {error}"))?;
        return Ok(json!({"deferredForConsent": true}));
    }
    let enabled = !config.enabled;
    diagnostics::info(
        "shortcut",
        &format!("native translation toggle requested; enabled={enabled}"),
    );
    set_translation_enabled_from_app(app, enabled)
}

fn dispatch_shortcut_action(app: &AppHandle, action: ShortcutAction) -> Result<(), String> {
    match action {
        ShortcutAction::Translation => toggle_translation_from_app(app).map(|_| ()),
        ShortcutAction::OutgoingTranslation => app
            .emit(action.event_name(), ())
            .map_err(|error| format!("전송 메시지 통역 단축키를 처리하지 못했습니다: {error}")),
    }
}

#[derive(Clone, Default)]
struct ProviderLoginState {
    inner: Arc<Mutex<ProviderLoginSessionState>>,
}

#[derive(Default)]
struct ProviderLoginSessionState {
    active: bool,
    cancel_requested: bool,
    process_id: Option<u32>,
    browser_gate: Option<translation::LoginBrowserGate>,
}

impl ProviderLoginState {
    fn begin(
        &self,
    ) -> Result<
        (
            translation::LoginProcessObserver,
            translation::LoginBrowserGate,
        ),
        String,
    > {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| "번역 서비스 로그인 상태 잠금을 열지 못했습니다.".to_string())?;
        if state.active {
            return Err("다른 계정 로그인이 이미 진행 중입니다.".to_string());
        }
        state.active = true;
        state.cancel_requested = false;
        state.process_id = None;
        let browser_gate = translation::LoginBrowserGate::default();
        state.browser_gate = Some(browser_gate.clone());
        drop(state);

        let inner = Arc::clone(&self.inner);
        let observer = Arc::new(move |next_process_id| {
            let mut process_to_cancel = None;
            let mut gate_to_cancel = None;
            if let Ok(mut state) = inner.lock() {
                match next_process_id {
                    Some(process_id) => {
                        if state.cancel_requested {
                            process_to_cancel = Some(process_id);
                        } else {
                            state.process_id = Some(process_id);
                        }
                    }
                    None => {
                        state.active = false;
                        state.cancel_requested = false;
                        state.process_id = None;
                        gate_to_cancel = state.browser_gate.take();
                    }
                }
            }
            if let Some(process_id) = process_to_cancel {
                terminate_process_tree(process_id);
            }
            if let Some(gate) = gate_to_cancel {
                gate.cancel();
            }
        });
        Ok((observer, browser_gate))
    }

    fn cancel(&self) -> Result<bool, String> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| "번역 서비스 로그인 상태 잠금을 열지 못했습니다.".to_string())?;
        if !state.active {
            return Ok(false);
        }
        state.cancel_requested = true;
        let process_id = state.process_id.take();
        let browser_gate = state.browser_gate.take();
        drop(state);
        if let Some(browser_gate) = browser_gate {
            browser_gate.cancel();
        }
        if let Some(process_id) = process_id {
            terminate_process_tree(process_id);
        }
        Ok(true)
    }

    fn open_browser(&self) -> Result<bool, String> {
        let state = self
            .inner
            .lock()
            .map_err(|_| "번역 서비스 로그인 상태 잠금을 열지 못했습니다.".to_string())?;
        if !state.active || state.cancel_requested {
            return Ok(false);
        }
        Ok(state
            .browser_gate
            .as_ref()
            .is_some_and(translation::LoginBrowserGate::open))
    }

    fn finish(&self) {
        if let Ok(mut state) = self.inner.lock() {
            state.active = false;
            state.cancel_requested = false;
            state.process_id = None;
            if let Some(browser_gate) = state.browser_gate.take() {
                browser_gate.cancel();
            }
        }
    }
}

fn terminate_process_tree(process_id: u32) {
    let system = System::new_all();
    let root = Pid::from_u32(process_id);
    let mut targets = vec![root];
    loop {
        let mut added = false;
        for (pid, process) in system.processes() {
            if process
                .parent()
                .is_some_and(|parent| targets.contains(&parent))
                && !targets.contains(pid)
            {
                targets.push(*pid);
                added = true;
            }
        }
        if !added {
            break;
        }
    }
    for pid in targets.into_iter().rev() {
        if let Some(process) = system.process(pid) {
            let _ = process.kill();
        }
    }
}

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn GetAsyncKeyState(virtual_key: i32) -> i16;
}

fn requested_window_theme(
    window: &tauri::WebviewWindow,
    requested: &str,
) -> Result<tauri::Theme, String> {
    match requested {
        "light" => Ok(tauri::Theme::Light),
        "dark" => Ok(tauri::Theme::Dark),
        "system" => window
            .theme()
            .map_err(|error| format!("시스템 창 테마를 확인하지 못했습니다: {error}")),
        _ => Err("지원하지 않는 설정창 테마입니다.".to_string()),
    }
}

fn apply_main_window_chrome(
    window: &tauri::WebviewWindow,
    requested: &str,
    resolved: tauri::Theme,
) -> Result<(), String> {
    let native_theme = match requested {
        "system" => None,
        "light" | "dark" => Some(resolved),
        _ => return Err("지원하지 않는 설정창 테마입니다.".to_string()),
    };
    window
        .set_theme(native_theme)
        .map_err(|error| format!("설정창 테마를 적용하지 못했습니다: {error}"))?;

    #[cfg(windows)]
    apply_windows_title_bar_palette(window, resolved);

    Ok(())
}

#[cfg(windows)]
fn apply_windows_title_bar_palette(window: &tauri::WebviewWindow, theme: tauri::Theme) {
    use std::ffi::c_void;
    use std::mem::size_of;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
    };

    fn color_ref(red: u32, green: u32, blue: u32) -> u32 {
        red | (green << 8) | (blue << 16)
    }

    let (caption, text, border) = match theme {
        tauri::Theme::Dark => (
            color_ref(16, 43, 66),
            color_ref(242, 247, 251),
            color_ref(45, 92, 128),
        ),
        _ => (
            color_ref(220, 235, 248),
            color_ref(18, 40, 58),
            color_ref(170, 203, 228),
        ),
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    for (attribute, color) in [
        (DWMWA_CAPTION_COLOR, caption),
        (DWMWA_TEXT_COLOR, text),
        (DWMWA_BORDER_COLOR, border),
    ] {
        // Windows 10처럼 사용자 지정 캡션 색을 지원하지 않는 환경에서는
        // set_theme으로 적용한 시스템 제목 표시줄을 그대로 사용해.
        let _ = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                attribute,
                (&color as *const u32).cast::<c_void>(),
                size_of::<u32>() as u32,
            )
        };
    }
}

#[tauri::command]
fn engine_health() -> Value {
    json!({"status": "ready", "protocolVersion": 2, "ocrMode": "rust-native"})
}

#[tauri::command]
fn engine_ui_ready(engine: State<'_, RustEngine>) -> Result<(), String> {
    engine.ui_ready()
}

#[tauri::command]
fn shortcut_capture_set_active(shortcut: State<'_, ShortcutConfig>, active: bool) {
    shortcut.capture_active.store(active, Ordering::Release);
}

#[tauri::command]
fn settings_get(config: State<'_, ConfigStore>) -> Result<AppConfig, String> {
    config.get()
}

#[tauri::command]
async fn dictionary_status_get() -> Result<dictionary::DictionaryStatus, String> {
    tauri::async_runtime::spawn_blocking(|| dictionary::DictionaryStore::open_default()?.status())
        .await
        .map_err(|error| format!("사전 상태 확인 작업을 기다리지 못했습니다: {error}"))?
}

#[tauri::command]
async fn dictionary_personal_list() -> Result<Vec<dictionary::PersonalDictionaryEntry>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        dictionary::DictionaryStore::open_default()?.personal_entries()
    })
    .await
    .map_err(|error| format!("개인 사전 목록 조회 작업을 기다리지 못했습니다: {error}"))?
}

#[tauri::command]
async fn dictionary_personal_upsert(
    entry: dictionary::PersonalDictionaryEntry,
) -> Result<dictionary::PersonalDictionaryEntry, String> {
    tauri::async_runtime::spawn_blocking(move || {
        dictionary::DictionaryStore::open_default()?.upsert_personal(entry)
    })
    .await
    .map_err(|error| format!("개인 사전 저장 작업을 기다리지 못했습니다: {error}"))?
}

#[tauri::command]
async fn dictionary_personal_delete(id: i64) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        dictionary::DictionaryStore::open_default()?.delete_personal(id)
    })
    .await
    .map_err(|error| format!("개인 사전 삭제 작업을 기다리지 못했습니다: {error}"))?
}

#[tauri::command]
async fn dictionary_pack_install(
    language: String,
) -> Result<dictionary::DictionaryPackStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        dictionary::DictionaryStore::open_default()?.install_bundled_pack(&language)
    })
    .await
    .map_err(|error| format!("사전팩 설치 작업을 기다리지 못했습니다: {error}"))?
}

#[tauri::command]
async fn dictionary_pack_remove(language: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        dictionary::DictionaryStore::open_default()?.remove_pack(&language)
    })
    .await
    .map_err(|error| format!("사전팩 삭제 작업을 기다리지 못했습니다: {error}"))?
}

#[tauri::command]
fn dictionary_storage_folder_open(app: AppHandle) -> Result<String, String> {
    let path = dictionary::dictionary_storage_root();
    std::fs::create_dir_all(&path)
        .map_err(|error| format!("사전 데이터 폴더를 만들지 못했습니다: {error}"))?;
    let display_path = path.to_string_lossy().into_owned();
    app.opener()
        .open_path(display_path.clone(), None::<&str>)
        .map_err(|error| format!("사전 데이터 폴더를 열지 못했습니다: {error}"))?;
    Ok(display_path)
}

#[tauri::command]
fn main_window_set_theme(
    app: AppHandle,
    theme: String,
    resolved_theme: String,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "설정창을 찾지 못했습니다.".to_string())?;
    let resolved = requested_window_theme(&window, &resolved_theme)?;
    apply_main_window_chrome(&window, &theme, resolved)
}

#[tauri::command]
fn settings_update(
    app: AppHandle,
    engine: State<'_, RustEngine>,
    config: State<'_, ConfigStore>,
    patch: Value,
) -> Result<AppConfig, String> {
    let previous_config = config.get()?;
    let preview = previous_config.patched(patch.clone())?;
    if !shortcuts_are_unique(&[
        &preview.hotkeys.toggle_translation,
        &preview.hotkeys.toggle_outgoing_translation,
        &preview.hotkeys.send_outgoing_immediately,
        &preview.hotkeys.review_outgoing_before_send,
    ]) {
        return Err("편의 기능의 각 동작에는 서로 다른 단축키를 지정하십시오.".to_string());
    }
    let hotkeys = patch.get("hotkeys");
    let requested_shortcuts = [
        (
            ShortcutAction::Translation,
            hotkeys
                .and_then(|value| value.get("toggle_translation"))
                .and_then(Value::as_str),
        ),
        (
            ShortcutAction::OutgoingTranslation,
            hotkeys
                .and_then(|value| value.get("toggle_outgoing_translation"))
                .and_then(Value::as_str),
        ),
    ];
    if let (Some(translation), Some(outgoing)) =
        (requested_shortcuts[0].1, requested_shortcuts[1].1)
    {
        if translation.eq_ignore_ascii_case(outgoing) {
            return Err(
                "실시간 번역과 전송 메시지 통역에는 서로 다른 단축키를 지정하십시오.".to_string(),
            );
        }
    }
    let mut previous_shortcuts = Vec::new();
    for (action, requested) in requested_shortcuts {
        if let Some(requested) = requested {
            match replace_shortcut(&app, action, requested) {
                Ok(previous) => previous_shortcuts.push((action, previous)),
                Err(error) => {
                    for (action, previous) in previous_shortcuts.into_iter().rev() {
                        let _ = replace_shortcut(&app, action, &previous);
                    }
                    return Err(error);
                }
            }
        }
    }
    let updated = match config.update(patch.clone()) {
        Ok(updated) => updated,
        Err(error) => {
            for (action, previous) in previous_shortcuts.into_iter().rev() {
                let _ = replace_shortcut(&app, action, &previous);
            }
            return Err(error);
        }
    };
    match engine.apply_config(updated.clone()) {
        Ok(()) => {
            let _ = app.emit("settings-changed", updated.clone());
            Ok(updated)
        }
        Err(error) => {
            let _ = config.replace(previous_config);
            for (action, previous) in previous_shortcuts.into_iter().rev() {
                let _ = replace_shortcut(&app, action, &previous);
            }
            Err(error)
        }
    }
}

#[tauri::command]
fn settings_reset(
    app: AppHandle,
    engine: State<'_, RustEngine>,
    config: State<'_, ConfigStore>,
) -> Result<AppConfig, String> {
    let defaults = serde_json::to_value(AppConfig::default())
        .map_err(|error| format!("기본 설정을 준비하지 못했습니다: {error}"))?;
    settings_update(app, engine, config, defaults)
}

#[tauri::command]
fn translation_set_enabled(app: AppHandle, enabled: bool) -> Result<Value, String> {
    set_translation_enabled_from_app(&app, enabled)
}

#[tauri::command]
fn model_preparation_cancel(
    app: AppHandle,
    engine: State<'_, RustEngine>,
    config: State<'_, ConfigStore>,
) -> Result<AppConfig, String> {
    let previous = config.get()?;
    let updated = config.update(json!({
        "enabled": false,
        "outgoing_translation_enabled": false,
    }))?;
    if let Err(error) = engine.cancel_model_preparation() {
        let _ = config.replace(previous);
        return Err(error);
    }
    let _ = app.emit("settings-changed", updated.clone());
    Ok(updated)
}

#[tauri::command]
fn runtime_status(
    engine: State<'_, RustEngine>,
    config: State<'_, ConfigStore>,
    shortcut: State<'_, ShortcutConfig>,
) -> Result<Value, String> {
    let mut status = serde_json::to_value(engine.status()?)
        .map_err(|error| format!("Rust 번역 상태를 변환하지 못했습니다: {error}"))?;
    if let Some(object) = status.as_object_mut() {
        let current_config = config.get()?;
        object.insert("enabled".to_string(), Value::Bool(current_config.enabled));
        object.insert(
            "controllerEnabled".to_string(),
            Value::Bool(
                current_config.enabled
                    || current_config.outgoing_translation_enabled
                    || current_config.dictionary_enabled,
            ),
        );
        object.insert(
            "outgoingTranslationEnabled".to_string(),
            Value::Bool(current_config.outgoing_translation_enabled),
        );
        object.insert(
            "targetLanguage".to_string(),
            Value::String(current_config.target_language),
        );
        object.insert(
            "discordProcessId".to_string(),
            discord::current_process()
                .map(|process| Value::from(process.process_id))
                .unwrap_or(Value::Null),
        );
        object.insert(
            "configuredTranslator".to_string(),
            Value::String(current_config.translator),
        );
        object.insert(
            "discordProcessId".to_string(),
            discord::current_process()
                .map(|process| Value::from(process.process_id))
                .unwrap_or(Value::Null),
        );
        let configured = shortcut
            .toggle_translation
            .configured
            .lock()
            .map_err(|_| "전역 단축키 설정 잠금을 열지 못했습니다.".to_string())?
            .clone();
        let polling = shortcut
            .toggle_translation
            .fallback_virtual_key
            .load(Ordering::Acquire)
            != 0;
        object.insert("shortcut".to_string(), Value::String(configured));
        object.insert(
            "shortcutMode".to_string(),
            Value::String(if polling { "polling" } else { "registered" }.to_string()),
        );
        let outgoing_shortcut = shortcut
            .toggle_outgoing_translation
            .configured
            .lock()
            .map_err(|_| "전송 번역 단축키 설정 잠금을 열지 못했습니다.".to_string())?
            .clone();
        object.insert(
            "outgoingShortcut".to_string(),
            Value::String(outgoing_shortcut),
        );
    }
    Ok(status)
}

#[tauri::command]
async fn update_check(app: AppHandle) -> Result<Value, String> {
    let result = updater::check_for_update(&app).await;
    if let Ok(payload) = &result {
        let version = payload
            .get("available")
            .and_then(Value::as_bool)
            .filter(|available| *available)
            .and_then(|_| payload.get("version"))
            .and_then(Value::as_str)
            .map(str::to_string);
        if let Ok(mut available) = app.state::<UpdateAvailabilityState>().version.lock() {
            *available = version;
        }
        let _ = app.emit("update-availability-changed", payload.clone());
    }
    if let Err(error) = &result {
        diagnostics::error("updater", error);
    }
    result
}

#[tauri::command]
fn update_availability_get(state: State<'_, UpdateAvailabilityState>) -> Result<Value, String> {
    let version = state
        .version
        .lock()
        .map_err(|_| "업데이트 상태 잠금을 열지 못했습니다.".to_string())?
        .clone();
    Ok(match version {
        Some(version) => json!({"available": true, "version": version}),
        None => json!({"available": false}),
    })
}

#[tauri::command]
async fn update_install(app: AppHandle) -> Result<Value, String> {
    let result = updater::install_update(app).await;
    if let Err(error) = &result {
        diagnostics::error("updater", error);
    }
    result
}

#[tauri::command]
fn diagnostic_log_reveal(app: AppHandle) -> Result<String, String> {
    let path = diagnostics::log_path();
    diagnostics::info("application", "diagnostic log revealed by user");
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|error| format!("진단 로그 파일 위치를 열지 못했습니다: {error}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn diagnostic_log_write(level: String, component: String, message: String) {
    diagnostics::record(&level, &component, &message);
}

#[tauri::command]
async fn storage_status_get() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let cache = cache::TranslationCache::open_default()?;
        Ok::<_, String>(json!({
            "models": translation::local_model_storage_status(),
            "cache": cache.storage_status()?,
        }))
    })
    .await
    .map_err(|error| format!("저장 공간 정보를 기다리지 못했습니다: {error}"))?
}

#[tauri::command]
fn system_memory_status_get() -> Value {
    let system = System::new_all();
    json!({
        "totalBytes": system.total_memory(),
        "availableBytes": system.available_memory(),
    })
}

fn autostart_get_blocking(app: AppHandle) -> Result<bool, String> {
    let enabled = app
        .autolaunch()
        .is_enabled()
        .map_err(|error| format!("자동 시작 상태를 확인하지 못했습니다: {error}"))?;
    synchronize_discord_startup(enabled)?;
    Ok(enabled)
}

#[tauri::command]
async fn autostart_get(app: AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || autostart_get_blocking(app))
        .await
        .map_err(|error| format!("자동 시작 상태 확인 작업을 기다리지 못했습니다: {error}"))?
}

fn autostart_set_blocking(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch
            .enable()
            .map_err(|error| format!("자동 시작을 켜지 못했습니다: {error}"))?;
        if let Err(error) = discord_startup::suppress() {
            let _ = autolaunch.disable();
            return Err(error);
        }
    } else {
        autolaunch
            .disable()
            .map_err(|error| format!("자동 시작을 끄지 못했습니다: {error}"))?;
        discord_startup::restore()?;
    }
    autolaunch
        .is_enabled()
        .map_err(|error| format!("변경된 자동 시작 상태를 확인하지 못했습니다: {error}"))
}

#[tauri::command]
async fn autostart_set(app: AppHandle, enabled: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || autostart_set_blocking(app, enabled))
        .await
        .map_err(|error| format!("자동 시작 변경 작업을 기다리지 못했습니다: {error}"))?
}

fn synchronize_discord_startup(enabled: bool) -> Result<(), String> {
    if enabled {
        discord_startup::suppress()
    } else {
        discord_startup::restore()
    }
}

fn start_pipe_discord_for_autostart(app: AppHandle) {
    let engine = app.state::<RustEngine>().inner().clone();
    tauri::async_runtime::spawn(async move {
        let result = tauri::async_runtime::spawn_blocking(|| {
            if let Some(process) = discord::current_pipe_process() {
                return discord::connect_guarded_pipe(&process).map(|cdp| (process, cdp));
            }
            if discord::current_process().is_some() {
                return Err(
                    "Discord가 일반 모드로 실행 중이어서 사용자 재시작 동의를 기다립니다."
                        .to_string(),
                );
            }
            discord::restart_pipe(None)
        })
        .await;
        match result {
            Ok(Ok((_process, cdp))) => {
                if let Err(error) = engine.replace_cdp(cdp) {
                    diagnostics::error("discord-startup", &error);
                }
            }
            Ok(Err(error)) => diagnostics::warn("discord-startup", &error),
            Err(error) => diagnostics::warn(
                "discord-startup",
                &format!("Discord 자동 실행 작업을 기다리지 못했습니다: {error}"),
            ),
        }
    });
}

fn initialize_autostart(app: AppHandle) {
    if discord::current_pipe_process().is_some() {
        start_pipe_discord_for_autostart(app);
        return;
    }
    match autostart_get_blocking(app.clone()) {
        Ok(true) => start_pipe_discord_for_autostart(app),
        Ok(false) => {}
        Err(error) => diagnostics::warn("discord-startup", &error),
    }
}

fn initialize_autostart_in_background(app: AppHandle) {
    tauri::async_runtime::spawn_blocking(move || initialize_autostart(app));
}

#[tauri::command]
fn local_model_storage_folder_open(app: AppHandle) -> Result<String, String> {
    let path = translation::local_model_storage_root();
    std::fs::create_dir_all(&path)
        .map_err(|error| format!("로컬 모델 데이터 폴더를 만들지 못했습니다: {error}"))?;
    let display_path = path.to_string_lossy().into_owned();
    app.opener()
        .open_path(display_path.clone(), None::<&str>)
        .map_err(|error| format!("로컬 모델 데이터 폴더를 열지 못했습니다: {error}"))?;
    Ok(display_path)
}

#[tauri::command]
async fn local_model_delete(
    config: State<'_, ConfigStore>,
    model_id: String,
) -> Result<translation::LocalModelDeleteResult, String> {
    let current = config.get()?;
    if current.translator == model_id || current.outgoing_translator == model_id {
        return Err(
            "현재 사용 중인 모델입니다. 다른 번역 모델을 선택한 후 삭제하십시오.".to_string(),
        );
    }
    tauri::async_runtime::spawn_blocking(move || translation::delete_cached_local_model(&model_id))
        .await
        .map_err(|error| format!("로컬 모델 삭제 작업을 기다리지 못했습니다: {error}"))?
}

#[tauri::command]
async fn translation_cache_clear(
    engine: State<'_, RustEngine>,
) -> Result<cache::CacheCleanupResult, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || engine.clear_cache())
        .await
        .map_err(|error| format!("번역 기록 정리 작업을 기다리지 못했습니다: {error}"))?
}

#[tauri::command]
async fn provider_connections_get(
    config: State<'_, ConfigStore>,
) -> Result<Vec<providers::ProviderConnection>, String> {
    let disabled_providers = config.get()?.disabled_providers;
    tauri::async_runtime::spawn_blocking(move || providers::list(&disabled_providers))
        .await
        .map_err(|error| format!("번역 서비스 상태 확인을 기다리지 못했습니다: {error}"))
}

#[tauri::command]
async fn provider_install(provider: String) -> Result<providers::ProviderConnection, String> {
    tauri::async_runtime::spawn_blocking(move || providers::install(&provider))
        .await
        .map_err(|error| format!("번역 서비스 설치 작업을 기다리지 못했습니다: {error}"))?
}

#[tauri::command]
async fn provider_connect(
    app: AppHandle,
    engine: State<'_, RustEngine>,
    config: State<'_, ConfigStore>,
    login_state: State<'_, ProviderLoginState>,
    provider: String,
    credential: Option<String>,
) -> Result<providers::ProviderConnection, String> {
    let uses_browser_login = matches!(provider.as_str(), "chatgpt" | "claude" | "gemini");
    let (process_observer, browser_gate) = if uses_browser_login {
        let (process_observer, browser_gate) = login_state.begin()?;
        let _ = app.emit("provider-login-ready", ());
        (Some(process_observer), Some(browser_gate))
    } else {
        (None, None)
    };
    let provider_for_task = provider.clone();
    let connection_result = tauri::async_runtime::spawn_blocking(move || {
        providers::connect_with_observer(
            &provider_for_task,
            credential.as_deref(),
            process_observer,
            browser_gate,
        )
    })
    .await;
    if uses_browser_login {
        login_state.finish();
    }
    let connection = connection_result
        .map_err(|error| format!("번역 서비스 연결 작업을 기다리지 못했습니다: {error}"))??;

    if connection.connected {
        let mut current = config.get()?;
        if current
            .disabled_providers
            .iter()
            .any(|disabled| disabled == &provider)
        {
            let disabled_providers = current
                .disabled_providers
                .iter()
                .filter(|disabled| *disabled != &provider)
                .cloned()
                .collect::<Vec<_>>();
            current = config.update(json!({"disabled_providers": disabled_providers}))?;
            let _ = app.emit("settings-changed", current.clone());
        }
        if current.translator == provider || current.outgoing_translator == provider {
            engine.apply_config(current)?;
        }
    }
    let _ = app.emit("provider-connections-changed", ());
    Ok(connection)
}

#[tauri::command]
fn provider_login_cancel(login_state: State<'_, ProviderLoginState>) -> Result<bool, String> {
    login_state.cancel()
}

#[tauri::command]
fn provider_login_open(login_state: State<'_, ProviderLoginState>) -> Result<bool, String> {
    login_state.open_browser()
}

#[tauri::command]
fn provider_disconnect(
    app: AppHandle,
    engine: State<'_, RustEngine>,
    config: State<'_, ConfigStore>,
    provider: String,
) -> Result<providers::ProviderConnection, String> {
    let connection = providers::disconnect(&provider)?;
    let current = config.get()?;
    let is_subscription_cli = matches!(provider.as_str(), "chatgpt" | "claude" | "gemini");
    let mut patch = json!({});
    if is_subscription_cli {
        let mut disabled_providers = current.disabled_providers.clone();
        if !disabled_providers
            .iter()
            .any(|disabled| disabled == &provider)
        {
            disabled_providers.push(provider.clone());
            disabled_providers.sort();
        }
        patch["disabled_providers"] = json!(disabled_providers);
    }
    if current.translator == provider {
        patch["translator"] = json!("hymt_1_8b");
    }
    if current.outgoing_translator == provider {
        patch["outgoing_translator"] = json!("hymt_1_8b");
    }
    if patch.as_object().is_some_and(|patch| !patch.is_empty()) {
        let updated = config.update(patch)?;
        engine.apply_config(updated.clone())?;
        let _ = app.emit("settings-changed", updated);
    }
    let _ = app.emit("provider-connections-changed", ());
    Ok(connection)
}

#[tauri::command]
async fn discord_restart(
    engine: State<'_, RustEngine>,
    expected_process_id: Option<u32>,
) -> Result<Value, String> {
    let client = engine.inner().clone();
    let _ = client.set_enabled(false);
    let restart_result = tauri::async_runtime::spawn_blocking(move || {
        discord::connect_or_restart_pipe(expected_process_id)
    })
    .await
    .map_err(|error| format!("Discord 연결 작업을 기다리지 못했습니다: {error}"))?;
    let (process, cdp) = match restart_result {
        Ok(result) => result,
        Err(error) => {
            let _ = client.set_enabled(true);
            return Err(error);
        }
    };
    client.replace_cdp(cdp)?;
    let _ = client.set_enabled(true);
    Ok(json!({"connected": true, "process": process}))
}

#[tauri::command]
fn main_window_show(app: AppHandle) {
    hide_tray_menu(&app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn main_window_hide(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn tray_menu_hide(app: AppHandle) {
    hide_tray_menu(&app);
}

#[tauri::command]
fn tray_menu_set_size(app: AppHandle, width: u32, height: u32) -> Result<(), String> {
    let window = app
        .get_webview_window("tray-menu")
        .ok_or_else(|| "트레이 메뉴 창을 찾지 못했습니다.".to_string())?;
    let scale = window
        .scale_factor()
        .map_err(|error| format!("트레이 화면 배율을 확인하지 못했습니다: {error}"))?;
    let current_size = window
        .outer_size()
        .map_err(|error| format!("트레이 메뉴 크기를 확인하지 못했습니다: {error}"))?;
    let current_position = window
        .outer_position()
        .map_err(|error| format!("트레이 메뉴 위치를 확인하지 못했습니다: {error}"))?;
    let physical_width = ((width.clamp(300, 390) as f64) * scale).round() as u32;
    let physical_height = ((height.clamp(200, 560) as f64) * scale).round() as u32;
    let right = current_position.x + current_size.width as i32;
    let bottom = current_position.y + current_size.height as i32;
    let next_x = right - physical_width as i32;
    let next_y = bottom - physical_height as i32;
    window
        .set_size(Size::Physical(PhysicalSize::new(
            physical_width,
            physical_height,
        )))
        .map_err(|error| format!("트레이 메뉴 크기를 바꾸지 못했습니다: {error}"))?;
    window
        .set_position(Position::Physical(PhysicalPosition::new(next_x, next_y)))
        .map_err(|error| format!("트레이 메뉴 위치를 맞추지 못했습니다: {error}"))?;
    Ok(())
}

#[tauri::command]
fn tray_open_settings(app: AppHandle) {
    main_window_show(app);
}

#[tauri::command]
fn tray_open_provider_settings(app: AppHandle, provider: String) {
    main_window_show(app.clone());
    let _ = app.emit("focus-provider-connection", provider);
}

#[tauri::command]
fn tray_request_translation_toggle(app: AppHandle) {
    let _ = app.emit("request-translation-toggle", ());
}

#[tauri::command]
fn tray_request_outgoing_translation_toggle(app: AppHandle) {
    let _ = app.emit("request-outgoing-translation-toggle", ());
}

#[tauri::command]
fn tray_request_update_install(app: AppHandle) {
    main_window_show(app.clone());
    hide_tray_menu(&app);
    let _ = app.emit("request-update-install", ());
}

#[tauri::command]
fn application_exit(app: AppHandle) {
    diagnostics::info("application", "application exit requested");
    shutdown_translation(&app);
    app.exit(0);
}

fn shutdown_translation(app: &AppHandle) {
    let lifecycle = app.state::<LifecycleState>();
    if lifecycle.exiting.swap(true, Ordering::AcqRel) {
        return;
    }
    let engine = app.state::<RustEngine>();
    let _ = app.state::<ProviderLoginState>().cancel();
    let _ = engine.set_enabled(false);
    engine.stop();
}

fn hide_tray_menu(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("tray-menu") {
        let _ = window.hide();
    }
}

fn tray_menu_position(
    cursor: (i32, i32),
    menu: (i32, i32),
    monitor: (i32, i32, i32, i32),
) -> (i32, i32) {
    let (cursor_x, cursor_y) = cursor;
    let (menu_width, menu_height) = menu;
    let (monitor_x, monitor_y, monitor_width, monitor_height) = monitor;
    let margin = 8;
    let maximum_x = monitor_x + monitor_width - menu_width - margin;
    let maximum_y = monitor_y + monitor_height - menu_height - margin;
    let x = (cursor_x - menu_width + 24).clamp(monitor_x + margin, maximum_x);
    let y = (cursor_y - menu_height - 12).clamp(monitor_y + margin, maximum_y);
    (x, y)
}

fn show_tray_menu(app: &AppHandle, cursor_x: f64, cursor_y: f64) {
    let Some(window) = app.get_webview_window("tray-menu") else {
        return;
    };
    let Ok(menu_size) = window.outer_size() else {
        return;
    };
    let cursor = (cursor_x.round() as i32, cursor_y.round() as i32);
    let monitor = app
        .available_monitors()
        .ok()
        .and_then(|monitors| {
            monitors.into_iter().find(|monitor| {
                let position = monitor.position();
                let size = monitor.size();
                cursor.0 >= position.x
                    && cursor.0 < position.x + size.width as i32
                    && cursor.1 >= position.y
                    && cursor.1 < position.y + size.height as i32
            })
        })
        .or_else(|| app.primary_monitor().ok().flatten());
    let (x, y) = if let Some(monitor) = monitor {
        let position = monitor.position();
        let size = monitor.size();
        tray_menu_position(
            cursor,
            (menu_size.width as i32, menu_size.height as i32),
            (
                position.x,
                position.y,
                size.width as i32,
                size.height as i32,
            ),
        )
    } else {
        (
            cursor.0 - menu_size.width as i32 + 24,
            cursor.1 - menu_size.height as i32 - 12,
        )
    };
    let _ = window.set_position(Position::Physical(PhysicalPosition::new(x, y)));
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.emit("tray-menu-opened", ());
}

fn replace_shortcut(app: &AppHandle, action: ShortcutAction, next: &str) -> Result<String, String> {
    let shortcut_state = app.state::<ShortcutConfig>();
    let binding = shortcut_state.binding(action);
    let mut current = binding
        .configured
        .lock()
        .map_err(|_| "전역 단축키 설정 잠금을 열지 못했습니다.".to_string())?;
    let fallback_key = if cfg!(windows) {
        fallback_function_key(next)
    } else {
        None
    };
    let fallback_active =
        fallback_key.is_some_and(|key| binding.fallback_virtual_key.load(Ordering::Acquire) == key);
    if current.eq_ignore_ascii_case(next)
        && (app.global_shortcut().is_registered(next) || fallback_active)
    {
        return Ok(current.clone());
    }
    let previous = current.clone();
    let registered = app.global_shortcut().register(next);
    if let Err(error) = registered {
        let Some(virtual_key) = fallback_key else {
            return Err(format!("{next} 전역 단축키를 등록하지 못했습니다: {error}"));
        };
        if shortcut_changed(&previous, next)
            && app.global_shortcut().is_registered(previous.as_str())
        {
            app.global_shortcut()
                .unregister(previous.as_str())
                .map_err(|unregister_error| {
                    format!("기존 {previous} 단축키를 해제하지 못했습니다: {unregister_error}")
                })?;
        }
        binding
            .fallback_virtual_key
            .store(virtual_key, Ordering::Release);
        *current = next.to_ascii_uppercase();
        return Ok(previous);
    }
    if shortcut_changed(&previous, next) && app.global_shortcut().is_registered(previous.as_str()) {
        if let Err(error) = app.global_shortcut().unregister(previous.as_str()) {
            let _ = app.global_shortcut().unregister(next);
            return Err(format!(
                "기존 {previous} 단축키를 해제하지 못했습니다: {error}"
            ));
        }
    }
    binding.fallback_virtual_key.store(0, Ordering::Release);
    *current = next.to_string();
    Ok(previous)
}

fn fallback_function_key(shortcut: &str) -> Option<u32> {
    let normalized = shortcut.trim().to_ascii_uppercase();
    let number = normalized.strip_prefix('F')?.parse::<u32>().ok()?;
    (1..=24).contains(&number).then_some(0x6f + number)
}

fn fallback_press_should_dispatch(
    pressed: bool,
    was_pressed: bool,
    modifier_pressed: bool,
    capture_active: bool,
) -> bool {
    pressed && !was_pressed && !modifier_pressed && !capture_active
}

#[cfg(windows)]
fn start_fallback_shortcut_poller(app: AppHandle) {
    let _ = std::thread::Builder::new()
        .name("f-key-shortcut-poller".to_string())
        .spawn(move || {
            let mut previous_keys = [0, 0];
            let mut was_pressed = [false, false];
            loop {
                if app
                    .state::<LifecycleState>()
                    .exiting
                    .load(Ordering::Acquire)
                {
                    break;
                }
                let shortcut_state = app.state::<ShortcutConfig>();
                let capture_active = shortcut_state.capture_active.load(Ordering::Acquire);
                let modifier_pressed = [0x10, 0x11, 0x12, 0x5b, 0x5c]
                    .into_iter()
                    .any(|virtual_key| unsafe { GetAsyncKeyState(virtual_key) } < 0);
                for (index, action) in [
                    ShortcutAction::Translation,
                    ShortcutAction::OutgoingTranslation,
                ]
                .into_iter()
                .enumerate()
                {
                    let virtual_key = shortcut_state
                        .binding(action)
                        .fallback_virtual_key
                        .load(Ordering::Acquire);
                    if virtual_key != previous_keys[index] {
                        previous_keys[index] = virtual_key;
                        was_pressed[index] = false;
                    }
                    if virtual_key == 0 {
                        continue;
                    }
                    // GetAsyncKeyState의 최상위 비트는 현재 키가 눌린 상태임을 뜻해.
                    let pressed = unsafe { GetAsyncKeyState(virtual_key as i32) } < 0;
                    if fallback_press_should_dispatch(
                        pressed,
                        was_pressed[index],
                        modifier_pressed,
                        capture_active,
                    ) {
                        if let Err(error) = dispatch_shortcut_action(&app, action) {
                            diagnostics::error("shortcut", &error);
                        }
                    }
                    was_pressed[index] = pressed;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        });
}

#[cfg(not(windows))]
fn start_fallback_shortcut_poller(_app: AppHandle) {}

fn create_tray(app: &tauri::App) -> tauri::Result<()> {
    TrayIconBuilder::with_id("nude-translator")
        .tooltip("NudeNyang Discord Translator")
        .icon(
            app.default_window_icon()
                .expect("NudeNyang Discord Translator 아이콘이 필요해")
                .clone(),
        )
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state: MouseButtonState::Up,
                position,
                ..
            } = event
            {
                match button {
                    MouseButton::Left => main_window_show(tray.app_handle().clone()),
                    MouseButton::Right => show_tray_menu(tray.app_handle(), position.x, position.y),
                    _ => {}
                }
            }
        })
        .build(app)?;
    Ok(())
}

fn main() {
    let process_arguments = std::env::args_os().collect::<Vec<_>>();
    if process_arguments
        .get(1)
        .is_some_and(|argument| argument == "--discord-cdp-pipe-guardian")
    {
        let parsed = (|| -> Result<(u32, std::path::PathBuf, usize, usize), String> {
            let parse = |index: usize, label: &str| {
                process_arguments
                    .get(index)
                    .and_then(|value| value.to_str())
                    .ok_or_else(|| format!("{label} 값이 없습니다."))
            };
            let discord_process_id = parse(2, "Discord 프로세스 ID")?
                .parse::<u32>()
                .map_err(|error| format!("Discord 프로세스 ID가 올바르지 않습니다: {error}"))?;
            let discord_executable = std::path::PathBuf::from(
                process_arguments
                    .get(3)
                    .ok_or_else(|| "Discord 실행 경로가 없습니다.".to_string())?,
            );
            let reader_handle = parse(4, "CDP 읽기 핸들")?
                .parse::<usize>()
                .map_err(|error| format!("CDP 읽기 핸들이 올바르지 않습니다: {error}"))?;
            let writer_handle = parse(5, "CDP 쓰기 핸들")?
                .parse::<usize>()
                .map_err(|error| format!("CDP 쓰기 핸들이 올바르지 않습니다: {error}"))?;
            Ok((
                discord_process_id,
                discord_executable,
                reader_handle,
                writer_handle,
            ))
        })();
        let result = parsed.and_then(
            |(discord_process_id, discord_executable, reader_handle, writer_handle)| {
                discord::run_pipe_guardian(
                    discord_process_id,
                    &discord_executable,
                    reader_handle,
                    writer_handle,
                )
            },
        );
        if let Err(error) = result {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    if process_arguments
        .get(1)
        .is_some_and(|argument| argument == "--discord-cdp-pipe-helper")
    {
        let result = process_arguments
            .get(2)
            .map(std::path::Path::new)
            .ok_or_else(|| "Discord 실행 경로가 없습니다.".to_string())
            .and_then(discord::run_pipe_helper);
        match result {
            Ok(_) => {}
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }
    if process_arguments
        .get(1)
        .is_some_and(|argument| argument == "--verify-discord-cdp-pipe")
    {
        let expected_process_id = discord::current_process().map(|process| process.process_id);
        match discord::connect_or_restart_pipe(expected_process_id).and_then(
            |(process, mut client)| {
            let marker = client.evaluate(
                "(() => { const root = document.documentElement; const name = 'data-nudenyang-pipe-verify'; root.setAttribute(name, 'ok'); const value = root.getAttribute(name); root.removeAttribute(name); return value; })()",
                false,
            )?;
            if marker != serde_json::Value::String("ok".to_string()) {
                return Err(format!("Discord DOM 변조 검증 결과가 올바르지 않습니다: {marker}"));
            }
            drop(client);
            std::thread::sleep(Duration::from_millis(300));
            let mut reconnected = discord::connect_guarded_pipe(&process)?;
            let marker = reconnected.evaluate(
                "(() => { const root = document.documentElement; const name = 'data-nudenyang-guardian-verify'; root.setAttribute(name, 'ok'); const value = root.getAttribute(name); root.removeAttribute(name); return value; })()",
                false,
            )?;
            if marker != serde_json::Value::String("ok".to_string()) {
                return Err(format!("Discord DOM 재연결 검증 결과가 올바르지 않습니다: {marker}"));
            }
            Ok(process)
        }) {
            Ok(process) => {
                println!(
                    "SECURE_PID={} DOM_MUTATION=OK GUARDIAN_RECONNECT=OK DISCORD_SURVIVED=OK",
                    process.process_id
                );
            }
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }
    if std::env::args().any(|argument| argument == "--restore-discord-startup") {
        if let Err(error) = discord_startup::restore() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    let data_directory_migration = app_paths::migrate_legacy_data_directory();
    let _ = diagnostics::initialize(env!("CARGO_PKG_VERSION"));
    match data_directory_migration {
        Ok(true) => diagnostics::info(
            "startup",
            "기존 앱 데이터 폴더를 NudeNyang Discord Translator 이름으로 이전했습니다.",
        ),
        Ok(false) => {}
        Err(error) => diagnostics::warn("startup", &error),
    }
    match translation::hymt::remove_retired_milmmt_files() {
        Ok(removed_bytes) if removed_bytes > 0 => diagnostics::info(
            "migration",
            &format!("removed retired local model files; bytes={removed_bytes}"),
        ),
        Ok(_) => {}
        Err(error) => diagnostics::warn("migration", &error),
    }
    let config =
        ConfigStore::load_default().expect("NudeNyang Discord Translator 설정을 읽지 못했습니다");
    let initial_config = config
        .get()
        .expect("NudeNyang Discord Translator 초기 설정을 읽지 못했습니다");
    let engine = RustEngine::start(initial_config);
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, pressed_shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let pressed = pressed_shortcut.to_string();
                        let shortcut_state = app.state::<ShortcutConfig>();
                        if let Some(action) = shortcut_action_for(&shortcut_state, &pressed) {
                            if let Err(error) = dispatch_shortcut_action(app, action) {
                                diagnostics::error("shortcut", &error);
                            }
                        }
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            main_window_show(app.clone());
        }))
        .manage(LifecycleState::default())
        .manage(UpdateAvailabilityState::default())
        .manage(ShortcutConfig::default())
        .manage(ProviderLoginState::default())
        .manage(config)
        .manage(engine)
        .setup(|app| {
            app.state::<RustEngine>().attach_app(app.handle().clone())?;
            create_tray(app)?;
            let handle = app.handle().clone();
            initialize_autostart_in_background(app.handle().clone());
            // Windows가 F12를 디버거 용도로 선점한 경우에도 기존 앱과 동일하게
            // 키 상태 폴링으로 동작시켜 설정 저장과 모델 변경이 막히지 않게 해.
            let _ = replace_shortcut(&handle, ShortcutAction::Translation, "F12");
            let _ = replace_shortcut(&handle, ShortcutAction::OutgoingTranslation, "F8");
            start_fallback_shortcut_poller(handle.clone());
            if let Ok(config) = handle.state::<ConfigStore>().get() {
                let _ = replace_shortcut(
                    &handle,
                    ShortcutAction::Translation,
                    &config.hotkeys.toggle_translation,
                );
                let _ = replace_shortcut(
                    &handle,
                    ShortcutAction::OutgoingTranslation,
                    &config.hotkeys.toggle_outgoing_translation,
                );
                if let Some(window) = handle.get_webview_window("main") {
                    if let Ok(theme) = requested_window_theme(&window, &config.ui_theme) {
                        let _ = apply_main_window_chrome(&window, &config.ui_theme, theme);
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "tray-menu" {
                match event {
                    WindowEvent::Focused(false) => {
                        let _ = window.hide();
                    }
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    _ => {}
                }
                return;
            }
            if matches!(event, WindowEvent::Focused(false)) {
                window
                    .app_handle()
                    .state::<ShortcutConfig>()
                    .capture_active
                    .store(false, Ordering::Release);
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let lifecycle = window.app_handle().state::<LifecycleState>();
                if !lifecycle.exiting.load(Ordering::Acquire) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            engine_health,
            engine_ui_ready,
            shortcut_capture_set_active,
            settings_get,
            dictionary_status_get,
            dictionary_personal_list,
            dictionary_personal_upsert,
            dictionary_personal_delete,
            dictionary_pack_install,
            dictionary_pack_remove,
            dictionary_storage_folder_open,
            settings_update,
            settings_reset,
            main_window_set_theme,
            translation_set_enabled,
            model_preparation_cancel,
            runtime_status,
            update_check,
            update_availability_get,
            update_install,
            diagnostic_log_reveal,
            diagnostic_log_write,
            storage_status_get,
            system_memory_status_get,
            autostart_get,
            autostart_set,
            local_model_storage_folder_open,
            local_model_delete,
            translation_cache_clear,
            provider_connections_get,
            provider_install,
            provider_connect,
            provider_login_cancel,
            provider_login_open,
            provider_disconnect,
            discord_restart,
            main_window_show,
            main_window_hide,
            tray_menu_hide,
            tray_menu_set_size,
            tray_open_settings,
            tray_open_provider_settings,
            tray_request_translation_toggle,
            tray_request_outgoing_translation_toggle,
            tray_request_update_install,
            application_exit
        ])
        .build(tauri::generate_context!())
        .expect("NudeNyang Discord Translator Tauri 앱을 만들지 못했습니다");
    app.run(move |handle, event| match event {
        tauri::RunEvent::ExitRequested { .. } => shutdown_translation(handle),
        tauri::RunEvent::Exit => {
            handle.state::<RustEngine>().stop();
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::{
        fallback_function_key, fallback_press_should_dispatch, shortcut_action_for,
        shortcut_changed, shortcuts_are_unique, tray_menu_position, ProviderLoginState,
        ShortcutAction, ShortcutConfig,
    };

    #[test]
    fn default_shortcuts_route_incoming_and_outgoing_toggles_separately() {
        let shortcuts = ShortcutConfig::default();
        assert_eq!(
            shortcut_action_for(&shortcuts, "F12"),
            Some(ShortcutAction::Translation)
        );
        assert_eq!(
            shortcut_action_for(&shortcuts, "f8"),
            Some(ShortcutAction::OutgoingTranslation)
        );
    }

    #[test]
    fn registering_the_same_shortcut_keeps_the_new_registration() {
        assert!(!shortcut_changed("F8", "f8"));
        assert!(shortcut_changed("F8", "Ctrl+F8"));
    }

    #[test]
    fn editable_shortcuts_are_case_insensitively_unique() {
        assert!(shortcuts_are_unique(&[
            "F12",
            "F8",
            "Ctrl+Enter",
            "Alt+Enter"
        ]));
        assert!(!shortcuts_are_unique(&[
            "F12",
            "F8",
            "Ctrl+Enter",
            "ctrl+enter"
        ]));
    }

    #[test]
    fn unmodified_function_keys_can_use_the_windows_polling_fallback() {
        assert_eq!(fallback_function_key("F12"), Some(0x7b));
        assert_eq!(fallback_function_key("f1"), Some(0x70));
        assert_eq!(fallback_function_key("F24"), Some(0x87));
    }

    #[test]
    fn modified_or_invalid_shortcuts_do_not_use_the_polling_fallback() {
        assert_eq!(fallback_function_key("Ctrl+F12"), None);
        assert_eq!(fallback_function_key("F25"), None);
        assert_eq!(fallback_function_key("T"), None);
    }

    #[test]
    fn fallback_function_key_requires_a_fresh_unmodified_press_outside_capture() {
        assert!(fallback_press_should_dispatch(true, false, false, false));
        assert!(!fallback_press_should_dispatch(true, true, false, false));
        assert!(!fallback_press_should_dispatch(true, false, true, false));
        assert!(!fallback_press_should_dispatch(true, false, false, true));
        assert!(!fallback_press_should_dispatch(false, false, false, false));
    }

    #[test]
    fn tray_menu_opens_above_the_cursor_and_stays_inside_the_monitor() {
        assert_eq!(
            tray_menu_position((1900, 1060), (300, 300), (0, 0, 1920, 1080)),
            (1612, 748)
        );
        assert_eq!(
            tray_menu_position((-1910, 20), (300, 300), (-1920, 0, 1920, 1080)),
            (-1912, 8)
        );
    }

    #[test]
    fn gemini_login_cancel_is_remembered_before_the_cli_process_starts() {
        let state = ProviderLoginState::default();
        let (observer, _) = state.begin().expect("로그인 세션을 시작해야 합니다");

        assert!(state.cancel().expect("로그인 취소를 기록해야 합니다"));
        observer(Some(u32::MAX));

        let current = state.inner.lock().expect("로그인 상태를 확인해야 합니다");
        assert!(current.active);
        assert!(current.cancel_requested);
        assert!(current.process_id.is_none());
        drop(current);

        observer(None);
        assert!(
            !state
                .inner
                .lock()
                .expect("로그인 상태를 확인해야 합니다")
                .active
        );
    }

    #[test]
    fn cancelling_without_an_active_gemini_login_is_a_no_op() {
        let state = ProviderLoginState::default();
        assert!(!state
            .cancel()
            .expect("비활성 로그인 취소를 처리해야 합니다"));
    }
}
