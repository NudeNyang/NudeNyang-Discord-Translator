#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod cache;
pub mod cdp;
mod config;
mod discord;
pub mod dom;
mod engine;
pub mod language;
pub mod ocr;
pub mod translation;
mod updater;

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Position, State, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use config::{AppConfig, ConfigStore};
use engine::RustEngine;

#[derive(Default)]
struct LifecycleState {
    exiting: AtomicBool,
}

struct ShortcutConfig {
    toggle_translation: Mutex<String>,
    fallback_virtual_key: AtomicU32,
}

impl Default for ShortcutConfig {
    fn default() -> Self {
        Self {
            toggle_translation: Mutex::new("F12".to_string()),
            fallback_virtual_key: AtomicU32::new(0),
        }
    }
}

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn GetAsyncKeyState(virtual_key: i32) -> i16;
}

#[tauri::command]
fn engine_health() -> Value {
    json!({"status": "ready", "protocolVersion": 2, "ocrMode": "rust-native"})
}

#[tauri::command]
fn settings_get(config: State<'_, ConfigStore>) -> Result<AppConfig, String> {
    config.get()
}

#[tauri::command]
fn settings_update(
    app: AppHandle,
    engine: State<'_, RustEngine>,
    config: State<'_, ConfigStore>,
    patch: Value,
) -> Result<AppConfig, String> {
    let shortcut = patch
        .get("hotkeys")
        .and_then(|hotkeys| hotkeys.get("toggle_translation"))
        .and_then(Value::as_str)
        .map(str::to_owned);
    let previous = if let Some(shortcut) = shortcut.as_deref() {
        Some(replace_toggle_shortcut(&app, shortcut)?)
    } else {
        None
    };
    let previous_config = config.get()?;
    let updated = match config.update(patch.clone()) {
        Ok(updated) => updated,
        Err(error) => {
            if let Some(previous) = previous {
                let _ = replace_toggle_shortcut(&app, &previous);
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
            if let Some(previous) = previous {
                let _ = replace_toggle_shortcut(&app, &previous);
            }
            Err(error)
        }
    }
}

#[tauri::command]
fn translation_set_enabled(
    app: AppHandle,
    engine: State<'_, RustEngine>,
    config: State<'_, ConfigStore>,
    enabled: bool,
) -> Result<Value, String> {
    let previous_config = config.get()?;
    config.update(json!({"enabled": enabled}))?;
    engine.set_enabled(enabled).inspect_err(|_| {
        let _ = config.replace(previous_config);
    })?;
    let status = serde_json::to_value(engine.status()?)
        .map_err(|error| format!("Rust 번역 상태를 변환하지 못했어: {error}"))?;
    let _ = app.emit("translation-state-changed", status.clone());
    Ok(status)
}

#[tauri::command]
fn runtime_status(
    engine: State<'_, RustEngine>,
    config: State<'_, ConfigStore>,
    shortcut: State<'_, ShortcutConfig>,
) -> Result<Value, String> {
    let mut status = serde_json::to_value(engine.status()?)
        .map_err(|error| format!("Rust 번역 상태를 변환하지 못했어: {error}"))?;
    if let Some(object) = status.as_object_mut() {
        let current_config = config.get()?;
        object.insert("enabled".to_string(), Value::Bool(current_config.enabled));
        object.insert(
            "targetLanguage".to_string(),
            Value::String(current_config.target_language),
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
            .lock()
            .map_err(|_| "전역 단축키 설정 잠금을 열지 못했어.".to_string())?
            .clone();
        let polling = shortcut.fallback_virtual_key.load(Ordering::Acquire) != 0;
        object.insert("shortcut".to_string(), Value::String(configured));
        object.insert(
            "shortcutMode".to_string(),
            Value::String(if polling { "polling" } else { "registered" }.to_string()),
        );
    }
    Ok(status)
}

#[tauri::command]
async fn update_check(
    config: State<'_, ConfigStore>,
    current_version: String,
) -> Result<Value, String> {
    let repository = config.get()?.update_repository;
    tauri::async_runtime::spawn_blocking(move || {
        updater::check_for_update(&repository, &current_version)
    })
    .await
    .map_err(|error| format!("업데이트 확인 작업을 기다리지 못했어: {error}"))?
}

#[tauri::command]
async fn discord_restart(
    engine: State<'_, RustEngine>,
    expected_process_id: Option<u32>,
) -> Result<Value, String> {
    let client = engine.inner().clone();
    let _ = client.set_enabled(false);
    tauri::async_runtime::spawn_blocking(move || {
        discord::restart(expected_process_id, 9222)?;
        discord::wait_for_debug_port(9222, Duration::from_secs(30))?;
        Ok::<_, String>(())
    })
    .await
    .map_err(|error| format!("Discord 재시작 작업을 기다리지 못했어: {error}"))??;
    let _ = client.set_enabled(true);
    Ok(json!({"connected": true}))
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
fn tray_open_settings(app: AppHandle) {
    main_window_show(app);
}

#[tauri::command]
fn tray_request_translation_toggle(app: AppHandle) {
    let _ = app.emit("request-translation-toggle", ());
}

#[tauri::command]
fn application_exit(app: AppHandle) {
    app.state::<LifecycleState>()
        .exiting
        .store(true, Ordering::Release);
    app.exit(0);
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

fn replace_toggle_shortcut(app: &AppHandle, next: &str) -> Result<String, String> {
    let shortcut_state = app.state::<ShortcutConfig>();
    let mut current = shortcut_state
        .toggle_translation
        .lock()
        .map_err(|_| "전역 단축키 설정 잠금을 열지 못했어.".to_string())?;
    let fallback_key = if cfg!(windows) {
        fallback_function_key(next)
    } else {
        None
    };
    let fallback_active = fallback_key
        .is_some_and(|key| shortcut_state.fallback_virtual_key.load(Ordering::Acquire) == key);
    if current.eq_ignore_ascii_case(next)
        && (app.global_shortcut().is_registered(next) || fallback_active)
    {
        return Ok(current.clone());
    }
    let previous = current.clone();
    let registered = app.global_shortcut().register(next);
    if let Err(error) = registered {
        let Some(virtual_key) = fallback_key else {
            return Err(format!("{next} 전역 단축키를 등록하지 못했어: {error}"));
        };
        if app.global_shortcut().is_registered(previous.as_str()) {
            app.global_shortcut()
                .unregister(previous.as_str())
                .map_err(|unregister_error| {
                    format!("기존 {previous} 단축키를 해제하지 못했어: {unregister_error}")
                })?;
        }
        shortcut_state
            .fallback_virtual_key
            .store(virtual_key, Ordering::Release);
        *current = next.to_ascii_uppercase();
        return Ok(previous);
    }
    if app.global_shortcut().is_registered(previous.as_str()) {
        if let Err(error) = app.global_shortcut().unregister(previous.as_str()) {
            let _ = app.global_shortcut().unregister(next);
            return Err(format!("기존 {previous} 단축키를 해제하지 못했어: {error}"));
        }
    }
    shortcut_state
        .fallback_virtual_key
        .store(0, Ordering::Release);
    *current = next.to_string();
    Ok(previous)
}

fn fallback_function_key(shortcut: &str) -> Option<u32> {
    let normalized = shortcut.trim().to_ascii_uppercase();
    let number = normalized.strip_prefix('F')?.parse::<u32>().ok()?;
    (1..=24).contains(&number).then_some(0x6f + number)
}

#[cfg(windows)]
fn start_fallback_shortcut_poller(app: AppHandle) {
    let _ = std::thread::Builder::new()
        .name("f-key-shortcut-poller".to_string())
        .spawn(move || {
            let mut previous_key = 0;
            let mut was_pressed = false;
            loop {
                if app
                    .state::<LifecycleState>()
                    .exiting
                    .load(Ordering::Acquire)
                {
                    break;
                }
                let virtual_key = app
                    .state::<ShortcutConfig>()
                    .fallback_virtual_key
                    .load(Ordering::Acquire);
                if virtual_key != previous_key {
                    previous_key = virtual_key;
                    was_pressed = false;
                }
                if virtual_key != 0 {
                    // GetAsyncKeyState의 최상위 비트는 현재 키가 눌린 상태임을 뜻해.
                    let pressed = unsafe { GetAsyncKeyState(virtual_key as i32) } < 0;
                    if pressed && !was_pressed {
                        let _ = app.emit("request-translation-toggle", ());
                    }
                    was_pressed = pressed;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        });
}

#[cfg(not(windows))]
fn start_fallback_shortcut_poller(_app: AppHandle) {}

fn create_tray(app: &tauri::App) -> tauri::Result<()> {
    TrayIconBuilder::with_id("nude-translator")
        .tooltip("Nude Translator")
        .icon(
            app.default_window_icon()
                .expect("Nude Translator 아이콘이 필요해")
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
    let config = ConfigStore::load_default().expect("Nude Translator 설정을 읽지 못했어");
    let initial_config = config
        .get()
        .expect("Nude Translator 초기 설정을 읽지 못했어");
    let engine = RustEngine::start(initial_config);
    let shutdown_engine = engine.clone();
    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = app.emit("request-translation-toggle", ());
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            main_window_show(app.clone());
        }))
        .manage(LifecycleState::default())
        .manage(ShortcutConfig::default())
        .manage(config)
        .manage(engine)
        .setup(|app| {
            create_tray(app)?;
            let handle = app.handle().clone();
            // Windows가 F12를 디버거 용도로 선점한 경우에도 기존 앱과 동일하게
            // 키 상태 폴링으로 동작시켜 설정 저장과 모델 변경이 막히지 않게 해.
            let _ = replace_toggle_shortcut(&handle, "F12");
            start_fallback_shortcut_poller(handle.clone());
            if let Ok(config) = handle.state::<ConfigStore>().get() {
                let _ = replace_toggle_shortcut(&handle, &config.hotkeys.toggle_translation);
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
            settings_get,
            settings_update,
            translation_set_enabled,
            runtime_status,
            update_check,
            discord_restart,
            main_window_show,
            main_window_hide,
            tray_menu_hide,
            tray_open_settings,
            tray_request_translation_toggle,
            application_exit
        ])
        .build(tauri::generate_context!())
        .expect("Nude Translator Tauri 앱을 만들지 못했어");
    app.run(move |_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            shutdown_engine.stop();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{fallback_function_key, tray_menu_position};

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
}
