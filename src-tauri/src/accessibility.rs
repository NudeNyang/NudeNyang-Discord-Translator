use serde::Serialize;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size};

use crate::dom::DomPart;

const MAX_ELEMENTS: usize = 5_000;
const MAX_TEXT_CHARS: usize = 12_000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenRect {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Clone, Debug)]
pub struct AccessiblePart {
    pub part: DomPart,
    pub bounds: ScreenRect,
}

#[derive(Clone, Debug)]
pub struct AccessibilitySnapshot {
    pub process_id: u32,
    pub window: ScreenRect,
    pub parts: Vec<AccessiblePart>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlayItem {
    id: String,
    text: String,
    left: f64,
    top: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlayPayload {
    items: Vec<OverlayItem>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlsPayload {
    display_language: String,
}

pub fn show_overlay<F>(
    app: &tauri::AppHandle,
    snapshot: &AccessibilitySnapshot,
    display_language: &str,
    translated_text: F,
) -> Result<(), String>
where
    F: Fn(&DomPart) -> Option<String>,
{
    let window = app
        .get_webview_window("translation-overlay")
        .ok_or_else(|| "번역 오버레이 창을 찾지 못했습니다.".to_string())?;
    let scale = window
        .scale_factor()
        .map_err(|error| format!("번역 오버레이 배율을 확인하지 못했습니다: {error}"))?;
    if snapshot.window.width <= 0 || snapshot.window.height <= 0 {
        hide_overlay(app);
        return Ok(());
    }
    let items = snapshot
        .parts
        .iter()
        .filter_map(|accessible| {
            let text = translated_text(&accessible.part)?;
            (text != accessible.part.text).then(|| OverlayItem {
                id: format!(
                    "{}:{}:{}",
                    accessible.part.kind, accessible.part.item_id, accessible.part.index
                ),
                text,
                left: f64::from(accessible.bounds.left - snapshot.window.left) / scale,
                top: f64::from(accessible.bounds.top - snapshot.window.top) / scale,
                width: f64::from(accessible.bounds.width) / scale,
                height: f64::from(accessible.bounds.height) / scale,
            })
        })
        .collect::<Vec<_>>();
    let has_items = !items.is_empty();
    window
        .set_position(Position::Physical(PhysicalPosition::new(
            snapshot.window.left,
            snapshot.window.top,
        )))
        .map_err(|error| format!("번역 오버레이 위치를 맞추지 못했습니다: {error}"))?;
    window
        .set_size(Size::Physical(PhysicalSize::new(
            snapshot.window.width.max(1) as u32,
            snapshot.window.height.max(1) as u32,
        )))
        .map_err(|error| format!("번역 오버레이 크기를 맞추지 못했습니다: {error}"))?;
    window
        .emit("accessibility-overlay-updated", OverlayPayload { items })
        .map_err(|error| format!("번역 오버레이를 갱신하지 못했습니다: {error}"))?;
    if has_items {
        let _ = window.show();
    } else {
        let _ = window.hide();
    }
    if let Some(controls) = app.get_webview_window("accessibility-controls") {
        controls
            .emit(
                "accessibility-controls-updated",
                ControlsPayload {
                    display_language: display_language.to_string(),
                },
            )
            .map_err(|error| format!("표시 언어 컨트롤을 갱신하지 못했습니다: {error}"))?;
        position_controls(&window, &controls)?;
        let _ = controls.show();
    }
    Ok(())
}

fn position_controls(
    overlay: &tauri::WebviewWindow,
    controls: &tauri::WebviewWindow,
) -> Result<(), String> {
    let overlay_position = overlay
        .outer_position()
        .map_err(|error| format!("Discord 오버레이 위치를 확인하지 못했습니다: {error}"))?;
    let overlay_size = overlay
        .outer_size()
        .map_err(|error| format!("Discord 오버레이 크기를 확인하지 못했습니다: {error}"))?;
    let controls_size = controls
        .outer_size()
        .map_err(|error| format!("표시 언어 컨트롤 크기를 확인하지 못했습니다: {error}"))?;
    let (x, y) = anchored_control_position(
        (overlay_position.x, overlay_position.y),
        (overlay_size.width, overlay_size.height),
        (controls_size.width, controls_size.height),
        18,
    );
    controls
        .set_position(Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(|error| format!("표시 언어 컨트롤 위치를 맞추지 못했습니다: {error}"))
}

fn anchored_control_position(
    overlay_position: (i32, i32),
    overlay_size: (u32, u32),
    controls_size: (u32, u32),
    margin: i32,
) -> (i32, i32) {
    (
        overlay_position.0 + overlay_size.0 as i32 - controls_size.0 as i32 - margin,
        overlay_position.1 + overlay_size.1 as i32 - controls_size.1 as i32 - margin,
    )
}

pub fn resize_controls(app: &tauri::AppHandle, expanded: bool) -> Result<(), String> {
    let overlay = app
        .get_webview_window("translation-overlay")
        .ok_or_else(|| "번역 오버레이 창을 찾지 못했습니다.".to_string())?;
    let controls = app
        .get_webview_window("accessibility-controls")
        .ok_or_else(|| "표시 언어 컨트롤 창을 찾지 못했습니다.".to_string())?;
    let scale = controls
        .scale_factor()
        .map_err(|error| format!("표시 언어 컨트롤 배율을 확인하지 못했습니다: {error}"))?;
    let (width, height) = if expanded {
        (286_u32, 590_u32)
    } else {
        (72, 50)
    };
    controls
        .set_size(Size::Physical(PhysicalSize::new(
            (f64::from(width) * scale).round() as u32,
            (f64::from(height) * scale).round() as u32,
        )))
        .map_err(|error| format!("표시 언어 컨트롤 크기를 바꾸지 못했습니다: {error}"))?;
    position_controls(&overlay, &controls)
}

pub fn hide_overlay(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("translation-overlay") {
        let _ = window.emit(
            "accessibility-overlay-updated",
            OverlayPayload { items: Vec::new() },
        );
        let _ = window.hide();
    }
    if let Some(window) = app.get_webview_window("accessibility-controls") {
        let _ = window.hide();
    }
}

fn message_kind(automation_id: &str, class_name: &str) -> Option<&'static str> {
    if automation_id.starts_with("message-content-")
        || automation_id.starts_with("message-content_")
    {
        return Some("message");
    }
    if automation_id.starts_with("message-reply-context-")
        || class_name.contains("repliedTextPreview")
    {
        return Some("reply");
    }
    None
}

#[cfg(windows)]
pub fn snapshot() -> Result<AccessibilitySnapshot, String> {
    windows_impl::snapshot(true)
}

#[cfg(windows)]
pub fn probe() -> Result<AccessibilitySnapshot, String> {
    windows_impl::snapshot(false)
}

#[cfg(not(windows))]
pub fn snapshot() -> Result<AccessibilitySnapshot, String> {
    Err("Discord 접근성 번역은 Windows에서만 지원됩니다.".to_string())
}

#[cfg(not(windows))]
pub fn probe() -> Result<AccessibilitySnapshot, String> {
    snapshot()
}

#[cfg(windows)]
mod windows_impl {
    use super::{
        message_kind, AccessibilitySnapshot, AccessiblePart, ScreenRect, MAX_ELEMENTS,
        MAX_TEXT_CHARS,
    };
    use crate::discord;
    use crate::dom::DomPart;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTreeWalker,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, IsIconic,
        IsWindowVisible,
    };

    struct ComApartment;

    impl ComApartment {
        fn initialize() -> Result<Self, String> {
            unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
                .ok()
                .map_err(|error| format!("Windows 접근성 COM을 시작하지 못했습니다: {error}"))?;
            Ok(Self)
        }
    }

    impl Drop for ComApartment {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }

    struct WindowSearch {
        process_id: u32,
        found: Option<HWND>,
    }

    unsafe extern "system" fn find_window(hwnd: HWND, parameter: LPARAM) -> BOOL {
        let search = unsafe { &mut *(parameter.0 as *mut WindowSearch) };
        let mut process_id = 0_u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process_id)) };
        if process_id == search.process_id && unsafe { IsWindowVisible(hwnd) }.as_bool() {
            search.found = Some(hwnd);
            return BOOL(0);
        }
        BOOL(1)
    }

    fn window_search_failure(found: bool, enumeration_error: Option<String>) -> Option<String> {
        if found {
            return None;
        }
        enumeration_error.map(|error| format!("Discord 창을 찾지 못했습니다: {error}"))
    }

    fn window_requires_accessibility_scan(
        is_minimized: bool,
        foreground_process_id: Option<u32>,
        discord_process_id: u32,
        translator_process_id: u32,
    ) -> bool {
        !is_minimized
            && foreground_process_id.is_some_and(|process_id| {
                process_id == discord_process_id || process_id == translator_process_id
            })
    }

    fn foreground_process_id() -> Option<u32> {
        let hwnd = unsafe { GetForegroundWindow() };
        let mut process_id = 0_u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process_id)) };
        (process_id != 0).then_some(process_id)
    }

    fn native_window_rect(hwnd: HWND) -> Option<ScreenRect> {
        let mut rect = RECT::default();
        unsafe { GetWindowRect(hwnd, &mut rect) }.ok()?;
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        (width > 0 && height > 0).then_some(ScreenRect {
            left: rect.left,
            top: rect.top,
            width,
            height,
        })
    }

    pub(super) fn snapshot(collect_parts: bool) -> Result<AccessibilitySnapshot, String> {
        let process = discord::current_accessibility_process().ok_or_else(|| {
            "Discord가 접근성 호환 모드로 실행되지 않았습니다. 최초 한 번만 Discord를 다시 시작해 주세요."
                .to_string()
        })?;
        let mut search = WindowSearch {
            process_id: process.process_id,
            found: None,
        };
        let enumeration_error = unsafe {
            EnumWindows(
                Some(find_window),
                LPARAM((&mut search as *mut WindowSearch) as isize),
            )
        }
        .err()
        .map(|error| error.to_string());
        if let Some(error) = window_search_failure(search.found.is_some(), enumeration_error) {
            return Err(error);
        }
        let hwnd = search
            .found
            .ok_or_else(|| "표시 중인 Discord 창을 찾지 못했습니다.".to_string())?;
        if !window_requires_accessibility_scan(
            unsafe { IsIconic(hwnd) }.as_bool(),
            foreground_process_id(),
            process.process_id,
            std::process::id(),
        ) {
            return Ok(AccessibilitySnapshot {
                process_id: process.process_id,
                window: ScreenRect::default(),
                parts: Vec::new(),
            });
        }
        let window = native_window_rect(hwnd)
            .ok_or_else(|| "Discord 창 위치를 읽지 못했습니다.".to_string())?;
        if !collect_parts {
            return Ok(AccessibilitySnapshot {
                process_id: process.process_id,
                window,
                parts: Vec::new(),
            });
        }
        let _apartment = ComApartment::initialize()?;
        let automation: IUIAutomation =
            unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }
                .map_err(|error| format!("Windows 접근성 서비스를 열지 못했습니다: {error}"))?;
        let root = unsafe { automation.ElementFromHandle(hwnd) }
            .map_err(|error| format!("Discord 접근성 루트를 읽지 못했습니다: {error}"))?;
        let walker = unsafe { automation.RawViewWalker() }
            .map_err(|error| format!("Discord 접근성 탐색기를 만들지 못했습니다: {error}"))?;
        let mut parts = Vec::new();
        let mut visited = 0_usize;
        walk(&walker, &root, &mut visited, &mut parts, 0);
        Ok(AccessibilitySnapshot {
            process_id: process.process_id,
            window,
            parts,
        })
    }

    fn walk(
        walker: &IUIAutomationTreeWalker,
        parent: &IUIAutomationElement,
        visited: &mut usize,
        parts: &mut Vec<AccessiblePart>,
        depth: usize,
    ) {
        if depth > 60 || *visited >= MAX_ELEMENTS {
            return;
        }
        let Ok(mut child) = (unsafe { walker.GetFirstChildElement(parent) }) else {
            return;
        };
        loop {
            *visited += 1;
            inspect(&child, parts);
            walk(walker, &child, visited, parts, depth + 1);
            if *visited >= MAX_ELEMENTS {
                break;
            }
            let Ok(next) = (unsafe { walker.GetNextSiblingElement(&child) }) else {
                break;
            };
            child = next;
        }
    }

    fn inspect(element: &IUIAutomationElement, parts: &mut Vec<AccessiblePart>) {
        if unsafe { element.CurrentIsOffscreen() }
            .map(|value| value.as_bool())
            .unwrap_or(true)
        {
            return;
        }
        let automation_id = unsafe { element.CurrentAutomationId() }
            .map(|value| value.to_string())
            .unwrap_or_default();
        let class_name = unsafe { element.CurrentClassName() }
            .map(|value| value.to_string())
            .unwrap_or_default();
        let Some(kind) = message_kind(&automation_id, &class_name) else {
            return;
        };
        let text = unsafe { element.CurrentName() }
            .map(|value| value.to_string())
            .unwrap_or_default();
        let text = text.trim();
        if text.is_empty() || text.chars().count() > MAX_TEXT_CHARS {
            return;
        }
        let Some(bounds) = element_rect(element) else {
            return;
        };
        parts.push(AccessiblePart {
            part: DomPart {
                kind: kind.to_string(),
                item_id: automation_id,
                index: 0,
                text: text.to_string(),
                displayed_text: None,
            },
            bounds,
        });
    }

    fn element_rect(element: &IUIAutomationElement) -> Option<ScreenRect> {
        let rect = unsafe { element.CurrentBoundingRectangle() }.ok()?;
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        (width > 0 && height > 0).then_some(ScreenRect {
            left: rect.left,
            top: rect.top,
            width,
            height,
        })
    }

    #[cfg(test)]
    mod tests {
        use super::window_search_failure;

        #[test]
        fn stopped_enumeration_after_match_is_not_a_failure() {
            assert_eq!(
                window_search_failure(true, Some("0x800705B4".to_string())),
                None
            );
        }

        #[test]
        fn enumeration_error_without_a_match_is_preserved() {
            assert_eq!(
                window_search_failure(false, Some("0x800705B4".to_string())),
                Some("Discord 창을 찾지 못했습니다: 0x800705B4".to_string())
            );
        }

        #[test]
        fn discord_and_translator_foreground_windows_allow_accessibility_scan() {
            let discord_process_id = 10;
            let translator_process_id = 20;

            assert!(!super::window_requires_accessibility_scan(
                true,
                Some(discord_process_id),
                discord_process_id,
                translator_process_id,
            ));
            assert!(super::window_requires_accessibility_scan(
                false,
                Some(discord_process_id),
                discord_process_id,
                translator_process_id,
            ));
            assert!(super::window_requires_accessibility_scan(
                false,
                Some(translator_process_id),
                discord_process_id,
                translator_process_id,
            ));
            assert!(!super::window_requires_accessibility_scan(
                false,
                Some(30),
                discord_process_id,
                translator_process_id,
            ));
            assert!(!super::window_requires_accessibility_scan(
                false,
                None,
                discord_process_id,
                translator_process_id,
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{anchored_control_position, message_kind};

    #[test]
    fn accepts_only_discord_message_and_reply_accessibility_ids() {
        assert_eq!(
            message_kind("message-content-123", "markup__abc"),
            Some("message")
        );
        assert_eq!(
            message_kind("message-reply-context-123", "repliedTextPreview__abc"),
            Some("reply")
        );
        assert_eq!(message_kind("channels", "content__abc"), None);
        assert_eq!(message_kind("", "markup__abc"), None);
    }

    #[test]
    fn display_language_control_stays_anchored_to_discord_bottom_right() {
        assert_eq!(
            anchored_control_position((100, 50), (1200, 800), (72, 50), 18),
            (1210, 782)
        );
        assert_eq!(
            anchored_control_position((100, 50), (1200, 800), (286, 590), 18),
            (996, 242)
        );
    }
}
