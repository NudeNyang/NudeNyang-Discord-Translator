use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

use crate::dictionary::DictionaryLookupResult;
use crate::dictionary_ui::DictionaryRequest;
use crate::engine::RustEngine;

const WINDOW_LABEL: &str = "dictionary";
const STATE_EVENT: &str = "dictionary-window-state";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryWindowPayload {
    pub request_id: String,
    pub phase: String,
    pub query: String,
    pub ui_language: String,
    pub target_language: String,
    pub external_enabled: bool,
    pub result: Option<DictionaryLookupResult>,
    pub error: String,
}

#[derive(Default)]
pub struct DictionaryWindowStore {
    payload: Mutex<Option<DictionaryWindowPayload>>,
    retry_request: Mutex<Option<DictionaryRequest>>,
}

impl DictionaryWindowStore {
    fn accept(&self, payload: DictionaryWindowPayload) -> bool {
        let Ok(mut current) = self.payload.lock() else {
            return false;
        };
        if payload.phase != "loading"
            && current
                .as_ref()
                .is_some_and(|current| current.request_id != payload.request_id)
        {
            return false;
        }
        *current = Some(payload);
        true
    }

    fn get(&self) -> Option<DictionaryWindowPayload> {
        self.payload.lock().ok().and_then(|current| current.clone())
    }

    fn remember_retry(&self, request: DictionaryRequest) -> Result<(), String> {
        let mut current = self
            .retry_request
            .lock()
            .map_err(|_| "사전 재검색 상태 잠금을 열지 못했습니다.".to_string())?;
        *current = Some(request);
        Ok(())
    }

    fn take_retry(&self) -> Result<DictionaryRequest, String> {
        self.retry_request
            .lock()
            .map_err(|_| "사전 재검색 상태 잠금을 열지 못했습니다.".to_string())?
            .take()
            .ok_or_else(|| "다시 검색할 사전 요청이 없습니다.".to_string())
    }

    pub fn clear_retry(&self) {
        if let Ok(mut current) = self.retry_request.lock() {
            *current = None;
        }
    }
}

fn position_near_cursor(window: &WebviewWindow) -> Result<(), String> {
    let cursor = window
        .cursor_position()
        .map_err(|error| format!("사전 창의 포인터 위치를 확인하지 못했습니다: {error}"))?;
    let window_size = window
        .outer_size()
        .map_err(|error| format!("사전 창 크기를 확인하지 못했습니다: {error}"))?;
    let monitors = window
        .available_monitors()
        .map_err(|error| format!("모니터 정보를 확인하지 못했습니다: {error}"))?;
    let monitor = monitors
        .iter()
        .find(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            cursor.x >= f64::from(position.x)
                && cursor.x < f64::from(position.x) + f64::from(size.width)
                && cursor.y >= f64::from(position.y)
                && cursor.y < f64::from(position.y) + f64::from(size.height)
        })
        .or_else(|| monitors.first());
    let Some(monitor) = monitor else {
        return Ok(());
    };

    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let scale = monitor.scale_factor();
    let inset = 12.0 * scale;
    let gap = 14.0 * scale;
    let left = f64::from(monitor_position.x) + inset;
    let top = f64::from(monitor_position.y) + inset;
    let right = f64::from(monitor_position.x) + f64::from(monitor_size.width) - inset;
    let bottom = f64::from(monitor_position.y) + f64::from(monitor_size.height) - inset;
    let width = f64::from(window_size.width);
    let height = f64::from(window_size.height);

    let mut x = cursor.x + gap;
    let mut y = cursor.y + gap;
    if x + width > right {
        x = cursor.x - width - gap;
    }
    if y + height > bottom {
        y = cursor.y - height - gap;
    }
    x = x.clamp(left, (right - width).max(left));
    y = y.clamp(top, (bottom - height).max(top));

    window
        .set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
        .map_err(|error| format!("사전 창 위치를 지정하지 못했습니다: {error}"))
}

fn publish(app: &AppHandle, payload: DictionaryWindowPayload, reveal: bool) -> Result<(), String> {
    if !app.state::<DictionaryWindowStore>().accept(payload.clone()) {
        return Ok(());
    }
    let window = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| "사전 도구 창을 찾지 못했습니다.".to_string())?;
    if reveal {
        position_near_cursor(&window)?;
        window
            .show()
            .map_err(|error| format!("사전 창을 표시하지 못했습니다: {error}"))?;
        window
            .set_focus()
            .map_err(|error| format!("사전 창을 활성화하지 못했습니다: {error}"))?;
    }
    app.emit_to(WINDOW_LABEL, STATE_EVENT, payload)
        .map_err(|error| format!("사전 결과를 창에 전달하지 못했습니다: {error}"))
}

pub fn show_loading(
    app: &AppHandle,
    request: &DictionaryRequest,
    ui_language: &str,
    target_language: &str,
    external_enabled: bool,
) -> Result<(), String> {
    let mut retry_request = request.clone();
    retry_request.action = "lookup".to_string();
    retry_request.target_language = target_language.to_string();
    app.state::<DictionaryWindowStore>()
        .remember_retry(retry_request)?;
    publish(
        app,
        DictionaryWindowPayload {
            request_id: request.id.clone(),
            phase: "loading".to_string(),
            query: request.query.clone(),
            ui_language: ui_language.to_string(),
            target_language: target_language.to_string(),
            external_enabled,
            result: None,
            error: String::new(),
        },
        true,
    )
}

pub fn show_result(
    app: &AppHandle,
    request_id: &str,
    result: DictionaryLookupResult,
    ui_language: &str,
    external_enabled: bool,
) -> Result<(), String> {
    publish(
        app,
        DictionaryWindowPayload {
            request_id: request_id.to_string(),
            phase: "ready".to_string(),
            query: result.query.clone(),
            ui_language: ui_language.to_string(),
            target_language: result.target_language.clone(),
            external_enabled,
            result: Some(result),
            error: String::new(),
        },
        false,
    )
}

pub fn show_error(
    app: &AppHandle,
    request_id: &str,
    query: &str,
    ui_language: &str,
    target_language: &str,
    external_enabled: bool,
    error: &str,
) -> Result<(), String> {
    publish(
        app,
        DictionaryWindowPayload {
            request_id: request_id.to_string(),
            phase: "error".to_string(),
            query: query.to_string(),
            ui_language: ui_language.to_string(),
            target_language: target_language.to_string(),
            external_enabled,
            result: None,
            error: error.to_string(),
        },
        false,
    )
}

#[tauri::command]
pub fn dictionary_window_state_get(
    state: State<'_, DictionaryWindowStore>,
) -> Option<DictionaryWindowPayload> {
    state.get()
}

#[tauri::command]
pub fn dictionary_window_hide(window: WebviewWindow) -> Result<(), String> {
    window
        .app_handle()
        .state::<DictionaryWindowStore>()
        .clear_retry();
    window
        .hide()
        .map_err(|error| format!("사전 창을 닫지 못했습니다: {error}"))
}

#[tauri::command]
pub fn dictionary_window_lookup_retry(
    engine: State<'_, RustEngine>,
    state: State<'_, DictionaryWindowStore>,
) -> Result<(), String> {
    engine.retry_dictionary(state.take_retry()?)
}

pub fn hide(app: &AppHandle) -> Result<(), String> {
    app.state::<DictionaryWindowStore>().clear_retry();
    let window = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| "사전 도구 창을 찾지 못했습니다.".to_string())?;
    window
        .hide()
        .map_err(|error| format!("사전 창을 닫지 못했습니다: {error}"))
}

pub fn open_external_dictionary(app: &AppHandle, query: &str) -> Result<(), String> {
    let mut url = url::Url::parse("https://en.wiktionary.org/w/index.php")
        .map_err(|error| format!("외부 사전 주소를 만들지 못했습니다: {error}"))?;
    url.query_pairs_mut().append_pair("search", query.trim());
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|error| format!("기본 브라우저에서 외부 사전을 열지 못했습니다: {error}"))
}

#[tauri::command]
pub fn dictionary_external_open(app: AppHandle, query: String) -> Result<(), String> {
    open_external_dictionary(&app, &query)
}

#[cfg(test)]
mod tests {
    use super::{DictionaryWindowPayload, DictionaryWindowStore};
    use crate::dictionary_ui::DictionaryRequest;

    #[test]
    fn payload_uses_a_fixed_header_body_footer_state_contract() {
        let payload = DictionaryWindowPayload {
            request_id: "dictionary-1".to_string(),
            phase: "loading".to_string(),
            query: "submission".to_string(),
            ui_language: "ko".to_string(),
            target_language: "ko".to_string(),
            external_enabled: true,
            result: None,
            error: String::new(),
        };
        let value = serde_json::to_value(payload).unwrap();

        assert_eq!(value["requestId"], "dictionary-1");
        assert_eq!(value["phase"], "loading");
        assert_eq!(value["query"], "submission");
        assert_eq!(value["externalEnabled"], true);
    }

    #[test]
    fn retry_state_keeps_context_out_of_the_serialized_window_payload() {
        let payload = DictionaryWindowPayload {
            request_id: "dictionary-1".to_string(),
            phase: "loading".to_string(),
            query: "submission".to_string(),
            ui_language: "ko".to_string(),
            target_language: "ko".to_string(),
            external_enabled: true,
            result: None,
            error: String::new(),
        };
        let value = serde_json::to_value(payload).unwrap();

        assert!(value.get("context").is_none());
        assert!(value.get("sourceLanguage").is_none());
    }

    #[test]
    fn retry_context_is_consumed_after_one_engine_retry() {
        let state = DictionaryWindowStore::default();
        state
            .remember_retry(DictionaryRequest {
                id: "dictionary-1".to_string(),
                action: "lookup".to_string(),
                query: "future".to_string(),
                context: "the surrounding message stays in engine memory".to_string(),
                source_language: "en".to_string(),
                target_language: "ko".to_string(),
                target_term: String::new(),
                note: String::new(),
            })
            .unwrap();

        let retry = state.take_retry().unwrap();
        assert_eq!(
            retry.context,
            "the surrounding message stays in engine memory"
        );
        assert!(state.take_retry().is_err());
    }
}
