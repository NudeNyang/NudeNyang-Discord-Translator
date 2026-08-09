use std::env;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Updater, UpdaterExt};
use url::Url;

const COMPILED_UPDATE_ENDPOINT: Option<&str> = option_env!("NUDE_TRANSLATOR_UPDATE_ENDPOINT");
const COMPILED_BETA_TOKEN: Option<&str> = option_env!("NUDE_TRANSLATOR_BETA_TOKEN");

pub async fn check_for_update(app: &AppHandle) -> Result<Value, String> {
    let updater = build_updater(app)?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("업데이트 서버를 확인하지 못했습니다: {error}"))?;
    let Some(update) = update else {
        return Ok(json!({"available": false}));
    };
    Ok(json!({
        "available": true,
        "version": update.version,
        "notes": update.body,
        "date": update.date.map(|date| date.to_string()),
    }))
}

pub async fn install_update(app: AppHandle) -> Result<Value, String> {
    let updater = build_updater(&app)?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("설치할 업데이트를 확인하지 못했습니다: {error}"))?
        .ok_or_else(|| "설치할 새 업데이트가 없습니다.".to_string())?;
    let version = update.version.clone();
    let downloaded = Arc::new(AtomicU64::new(0));
    let progress_app = app.clone();
    let progress_downloaded = Arc::clone(&downloaded);
    let finished_app = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                let received =
                    progress_downloaded.fetch_add(chunk as u64, Ordering::Relaxed) + chunk as u64;
                let _ = progress_app.emit(
                    "update-download-progress",
                    json!({"downloaded": received, "total": total}),
                );
            },
            move || {
                let _ = finished_app.emit("update-download-finished", ());
            },
        )
        .await
        .map_err(|error| format!("업데이트를 다운로드하거나 설치하지 못했습니다: {error}"))?;
    Ok(json!({"installed": true, "version": version}))
}

fn build_updater(app: &AppHandle) -> Result<Updater, String> {
    let endpoint = configured_value("NUDE_TRANSLATOR_UPDATE_ENDPOINT", COMPILED_UPDATE_ENDPOINT)
        .ok_or_else(|| "이 빌드에는 업데이트 서버 주소가 설정되어 있지 않습니다.".to_string())?;
    let endpoint = endpoint
        .parse::<Url>()
        .map_err(|error| format!("업데이트 서버 주소가 올바르지 않습니다: {error}"))?;
    let mut builder = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| format!("업데이트 서버 주소를 적용하지 못했습니다: {error}"))?
        .timeout(Duration::from_secs(90));
    if let Some(token) = configured_value("NUDE_TRANSLATOR_BETA_TOKEN", COMPILED_BETA_TOKEN) {
        builder = builder
            .header("Authorization", format!("Bearer {token}"))
            .map_err(|error| format!("베타 업데이트 인증 정보를 적용하지 못했습니다: {error}"))?;
    }
    let before_exit = app.clone();
    builder
        .on_before_exit(move || {
            crate::shutdown_translation(&before_exit);
            before_exit.cleanup_before_exit();
        })
        .build()
        .map_err(|error| format!("업데이트 기능을 초기화하지 못했습니다: {error}"))
}

fn configured_value(name: &str, compiled: Option<&str>) -> Option<String> {
    env::var(name)
        .ok()
        .or_else(|| compiled.map(str::to_string))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::configured_value;

    #[test]
    fn empty_compiled_update_setting_is_not_used() {
        assert_eq!(
            configured_value("NUDE_TRANSLATOR_TEST_MISSING", Some("  ")),
            None
        );
    }

    #[test]
    fn compiled_update_setting_is_trimmed() {
        assert_eq!(
            configured_value(
                "NUDE_TRANSLATOR_TEST_MISSING",
                Some(" https://example.test/update ")
            ),
            Some("https://example.test/update".to_string())
        );
    }
}
