use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;

const DEFAULT_UPDATE_REPOSITORY: &str = "NudeNyang/NudeNyang-Translator";
const LEGACY_UPDATE_REPOSITORY: &str = "NudeNyang/DiscordTranslateOverlay";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct RegionConfig {
    pub auto: bool,
    pub left_ratio: f64,
    pub top_ratio: f64,
    pub right_ratio: f64,
    pub bottom_ratio: f64,
}

impl Default for RegionConfig {
    fn default() -> Self {
        Self {
            auto: true,
            left_ratio: 0.29,
            top_ratio: 0.044,
            right_ratio: 0.985,
            bottom_ratio: 0.965,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct HotkeyConfig {
    pub toggle_translation: String,
    pub toggle_outgoing_translation: String,
    pub send_outgoing_immediately: String,
    pub review_outgoing_before_send: String,
    pub toggle_original: String,
    pub hide_overlay: String,
    pub copy_current: String,
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self {
            toggle_translation: "F12".to_string(),
            toggle_outgoing_translation: "F8".to_string(),
            send_outgoing_immediately: "Ctrl+Enter".to_string(),
            review_outgoing_before_send: "Alt+Enter".to_string(),
            toggle_original: "Ctrl+Alt+O".to_string(),
            hide_overlay: "Ctrl+Alt+H".to_string(),
            copy_current: "Ctrl+Alt+C".to_string(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct AppConfig {
    pub target_language: String,
    pub enabled: bool,
    pub outgoing_translation_enabled: bool,
    pub outgoing_target_language: String,
    pub outgoing_confirm_send: bool,
    pub show_original: bool,
    pub theme: String,
    pub ui_theme: String,
    pub ui_language: String,
    pub background_color: String,
    pub text_color: String,
    pub overlay_opacity: f64,
    pub font_scale: f64,
    pub capture_fps: u32,
    pub stable_frames: u32,
    pub change_threshold: f64,
    pub ocr_device: String,
    pub translator: String,
    pub outgoing_translator: String,
    pub disabled_providers: Vec<String>,
    pub hymt_device: String,
    pub keep_local_model_warm: bool,
    pub speech_style: String,
    pub auto_update: bool,
    pub update_repository: String,
    pub discord_auto_restart_consent_granted: bool,
    pub chat_region: RegionConfig,
    pub hotkeys: HotkeyConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            target_language: "ko".to_string(),
            enabled: true,
            outgoing_translation_enabled: false,
            outgoing_target_language: "auto".to_string(),
            outgoing_confirm_send: true,
            show_original: false,
            theme: "auto".to_string(),
            ui_theme: "system".to_string(),
            ui_language: "auto".to_string(),
            background_color: String::new(),
            text_color: String::new(),
            overlay_opacity: 1.0,
            font_scale: 1.0,
            capture_fps: 8,
            stable_frames: 2,
            change_threshold: 0.015,
            ocr_device: "auto".to_string(),
            translator: "hymt_1_8b".to_string(),
            outgoing_translator: "hymt_1_8b".to_string(),
            disabled_providers: Vec::new(),
            hymt_device: "auto".to_string(),
            keep_local_model_warm: true,
            speech_style: "auto".to_string(),
            auto_update: true,
            update_repository: DEFAULT_UPDATE_REPOSITORY.to_string(),
            discord_auto_restart_consent_granted: false,
            chat_region: RegionConfig::default(),
            hotkeys: HotkeyConfig::default(),
        }
    }
}

impl AppConfig {
    pub fn from_value(mut value: Value) -> Result<Self, String> {
        let object = value
            .as_object_mut()
            .ok_or_else(|| "설정 파일의 최상위 값은 객체여야 합니다.".to_string())?;

        if object
            .get("translator")
            .and_then(Value::as_str)
            .is_some_and(|value| matches!(value, "kanana" | "original"))
        {
            object.insert(
                "translator".to_string(),
                Value::String("hymt_1_8b".to_string()),
            );
        }
        if !object.contains_key("outgoing_translator") {
            let translator = object
                .get("translator")
                .and_then(Value::as_str)
                .unwrap_or("hymt_1_8b")
                .to_string();
            object.insert("outgoing_translator".to_string(), Value::String(translator));
        }
        if object
            .get("outgoing_translator")
            .and_then(Value::as_str)
            .is_some_and(|value| matches!(value, "kanana" | "original"))
        {
            object.insert(
                "outgoing_translator".to_string(),
                Value::String("hymt_1_8b".to_string()),
            );
        }
        let display_local = object
            .get("translator")
            .and_then(Value::as_str)
            .filter(|value| is_local_translator(value))
            .map(str::to_string);
        let outgoing_local = object
            .get("outgoing_translator")
            .and_then(Value::as_str)
            .filter(|value| is_local_translator(value));
        if let (Some(display_local), Some(outgoing_local)) = (display_local, outgoing_local) {
            if display_local != outgoing_local {
                object.insert(
                    "outgoing_translator".to_string(),
                    Value::String(display_local),
                );
            }
        }
        object.remove("kanana_device");
        object.remove("kanana_precision");

        let mut disabled_providers = object
            .get("disabled_providers")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter(|provider| matches!(*provider, "chatgpt" | "claude" | "gemini"))
            .map(str::to_string)
            .collect::<Vec<_>>();
        disabled_providers.sort();
        disabled_providers.dedup();
        object.insert(
            "disabled_providers".to_string(),
            Value::Array(disabled_providers.into_iter().map(Value::String).collect()),
        );

        if object.get("update_repository").and_then(Value::as_str) == Some(LEGACY_UPDATE_REPOSITORY)
        {
            object.insert(
                "update_repository".to_string(),
                Value::String(DEFAULT_UPDATE_REPOSITORY.to_string()),
            );
        }
        if object
            .get("speech_style")
            .and_then(Value::as_str)
            .is_some_and(|value| !matches!(value, "auto" | "polite" | "casual"))
        {
            object.insert(
                "speech_style".to_string(),
                Value::String("auto".to_string()),
            );
        }
        if object
            .get("ui_theme")
            .and_then(Value::as_str)
            .is_some_and(|value| !matches!(value, "system" | "light" | "dark"))
        {
            object.insert("ui_theme".to_string(), Value::String("system".to_string()));
        }
        if object
            .get("ui_language")
            .and_then(Value::as_str)
            .is_some_and(|value| !matches!(value, "auto" | "ko" | "en" | "ja" | "zh"))
        {
            object.insert("ui_language".to_string(), Value::String("auto".to_string()));
        }
        if object
            .get("outgoing_target_language")
            .and_then(Value::as_str)
            .is_some_and(|value| !matches!(value, "auto" | "ko" | "ja" | "en" | "zh" | "zh-Hant"))
        {
            object.insert(
                "outgoing_target_language".to_string(),
                Value::String("auto".to_string()),
            );
        }

        serde_json::from_value(value)
            .map_err(|error| format!("설정 파일을 읽지 못했습니다: {error}"))
    }

    pub fn patched(&self, mut patch: Value) -> Result<Self, String> {
        if let Some(patch) = patch.as_object_mut() {
            let display_selection = patch
                .get("translator")
                .and_then(Value::as_str)
                .filter(|value| is_local_translator(value))
                .map(str::to_string);
            let outgoing_selection = patch
                .get("outgoing_translator")
                .and_then(Value::as_str)
                .filter(|value| is_local_translator(value))
                .map(str::to_string);
            if let Some(selected) = display_selection {
                if is_local_translator(&self.outgoing_translator)
                    && !patch.contains_key("outgoing_translator")
                {
                    patch.insert("outgoing_translator".to_string(), Value::String(selected));
                }
            } else if let Some(selected) = outgoing_selection {
                if is_local_translator(&self.translator) && !patch.contains_key("translator") {
                    patch.insert("translator".to_string(), Value::String(selected));
                }
            }
        }
        let mut current = serde_json::to_value(self)
            .map_err(|error| format!("현재 설정을 변환하지 못했습니다: {error}"))?;
        merge_patch(&mut current, &patch);
        Self::from_value(current)
    }
}

fn is_local_translator(value: &str) -> bool {
    matches!(value, "hymt_1_8b" | "hymt_7b" | "translategemma_4b")
}

pub struct ConfigStore {
    path: PathBuf,
    value: RwLock<AppConfig>,
}

impl ConfigStore {
    pub fn load_default() -> Result<Self, String> {
        Self::load(default_config_path())
    }

    pub fn load(path: PathBuf) -> Result<Self, String> {
        let value = load_config(&path)?;
        Ok(Self {
            path,
            value: RwLock::new(value),
        })
    }

    pub fn get(&self) -> Result<AppConfig, String> {
        self.value
            .read()
            .map_err(|_| "설정 읽기 잠금을 열지 못했습니다.".to_string())
            .map(|value| value.clone())
    }

    pub fn update(&self, patch: Value) -> Result<AppConfig, String> {
        let mut value = self
            .value
            .write()
            .map_err(|_| "설정 쓰기 잠금을 열지 못했습니다.".to_string())?;
        let updated = value.patched(patch)?;
        save_config(&self.path, &updated)?;
        *value = updated.clone();
        Ok(updated)
    }

    pub fn replace(&self, config: AppConfig) -> Result<(), String> {
        save_config(&self.path, &config)?;
        *self
            .value
            .write()
            .map_err(|_| "설정 쓰기 잠금을 열지 못했습니다.".to_string())? = config;
        Ok(())
    }
}

pub fn default_config_path() -> PathBuf {
    if let Some(path) = env::var_os("DISCORD_TRANSLATE_CONFIG").filter(|value| !value.is_empty()) {
        return PathBuf::from(path);
    }

    #[cfg(target_os = "windows")]
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA").filter(|value| !value.is_empty()) {
        return PathBuf::from(local_app_data)
            .join("LocalTools")
            .join("DiscordTranslateOverlay")
            .join("settings.json");
    }

    #[cfg(target_os = "macos")]
    if let Some(home) = env::var_os("HOME").filter(|value| !value.is_empty()) {
        return PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("DiscordTranslateOverlay")
            .join("settings.json");
    }

    let base = env::var_os("XDG_CONFIG_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("HOME")
                .filter(|value| !value.is_empty())
                .map(|home| PathBuf::from(home).join(".config"))
        })
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("DiscordTranslateOverlay").join("settings.json")
}

fn load_config(path: &Path) -> Result<AppConfig, String> {
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let bytes = fs::read(path)
        .map_err(|error| format!("설정 파일을 읽지 못했습니다 ({}): {error}", path.display()))?;
    let value = serde_json::from_slice(&bytes).map_err(|error| {
        format!(
            "설정 JSON 형식이 올바르지 않습니다 ({}): {error}",
            path.display()
        )
    })?;
    AppConfig::from_value(value)
}

fn save_config(path: &Path, config: &AppConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "설정 폴더를 만들지 못했습니다 ({}): {error}",
                parent.display()
            )
        })?;
    }
    let bytes = serde_json::to_vec_pretty(config)
        .map_err(|error| format!("설정을 JSON으로 변환하지 못했습니다: {error}"))?;
    fs::write(path, bytes).map_err(|error| {
        format!(
            "설정 파일을 저장하지 못했습니다 ({}): {error}",
            path.display()
        )
    })
}

fn merge_patch(target: &mut Value, patch: &Value) {
    let (Some(target), Some(patch)) = (target.as_object_mut(), patch.as_object()) else {
        return;
    };
    for (key, value) in patch {
        if let (Some(current), Some(_)) = (target.get_mut(key), value.as_object()) {
            if current.is_object() {
                merge_patch(current, value);
                continue;
            }
        }
        if target.contains_key(key) {
            target.insert(key.clone(), value.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{AppConfig, ConfigStore};
    use serde_json::json;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_settings_path(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        std::env::temp_dir().join(format!("nude-translator-{name}-{nonce}.json"))
    }

    #[test]
    fn old_settings_receive_new_defaults_and_migrations() {
        let restored = AppConfig::from_value(json!({
            "enabled": false,
            "translator": "kanana",
            "kanana_device": "cuda",
            "update_repository": "NudeNyang/DiscordTranslateOverlay",
            "speech_style": "invalid",
            "ui_theme": "invalid"
        }))
        .expect("legacy config should migrate");

        assert!(!restored.enabled);
        assert_eq!(restored.translator, "hymt_1_8b");
        assert_eq!(restored.outgoing_translator, "hymt_1_8b");
        assert_eq!(restored.update_repository, "NudeNyang/NudeNyang-Translator");
        assert_eq!(restored.speech_style, "auto");
        assert_eq!(restored.ui_theme, "system");
        assert_eq!(restored.ui_language, "auto");
        assert!(restored.keep_local_model_warm);
        assert!(!restored.outgoing_translation_enabled);
        assert_eq!(restored.outgoing_target_language, "auto");
        assert!(restored.outgoing_confirm_send);
        assert_eq!(restored.hotkeys.toggle_translation, "F12");
        assert_eq!(restored.hotkeys.toggle_outgoing_translation, "F8");
        assert_eq!(restored.hotkeys.send_outgoing_immediately, "Ctrl+Enter");
        assert_eq!(restored.hotkeys.review_outgoing_before_send, "Alt+Enter");
        assert!(restored.disabled_providers.is_empty());

        let claude = AppConfig::from_value(json!({"translator": "claude"}))
            .expect("Claude subscription config should remain available");
        assert_eq!(claude.translator, "claude");
    }

    #[test]
    fn disabled_subscription_providers_are_filtered_and_deduplicated() {
        let config = AppConfig::from_value(json!({
            "disabled_providers": ["gemini", "invalid", "chatgpt", "gemini", 42]
        }))
        .expect("normalize disabled providers");

        assert_eq!(
            config.disabled_providers,
            vec!["chatgpt".to_string(), "gemini".to_string()]
        );
    }

    #[test]
    fn nested_hotkey_patch_preserves_other_shortcuts_and_round_trips() {
        let path = temporary_settings_path("patch");
        let store = ConfigStore::load(path.clone()).expect("create config store");
        let updated = store
            .update(json!({
                "ui_theme": "dark",
                "keep_local_model_warm": false,
                "hotkeys": {"toggle_translation": "Ctrl+Alt+T"}
            }))
            .expect("update config");

        assert_eq!(updated.hotkeys.toggle_translation, "Ctrl+Alt+T");
        assert_eq!(updated.hotkeys.toggle_outgoing_translation, "F8");
        assert_eq!(updated.hotkeys.send_outgoing_immediately, "Ctrl+Enter");
        assert_eq!(updated.hotkeys.review_outgoing_before_send, "Alt+Enter");
        assert_eq!(updated.hotkeys.toggle_original, "Ctrl+Alt+O");
        assert!(!updated.keep_local_model_warm);
        let restored = ConfigStore::load(path.clone())
            .expect("reload config")
            .get()
            .expect("read config");
        assert_eq!(restored, updated);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn unknown_patch_keys_are_ignored() {
        let config = AppConfig::default();
        let updated = config
            .patched(json!({"removed_feature": true, "capture_fps": 20}))
            .expect("patch config");
        assert_eq!(updated.capture_fps, 20);
        assert_eq!(updated.target_language, "ko");
    }

    #[test]
    fn local_model_selection_is_shared_between_translation_roles() {
        let config = AppConfig::default();
        let outgoing = config
            .patched(json!({"outgoing_translator": "hymt_7b"}))
            .expect("select outgoing local model");
        assert_eq!(outgoing.translator, "hymt_7b");
        assert_eq!(outgoing.outgoing_translator, "hymt_7b");

        let display = outgoing
            .patched(json!({"translator": "hymt_1_8b"}))
            .expect("select display local model");
        assert_eq!(display.translator, "hymt_1_8b");
        assert_eq!(display.outgoing_translator, "hymt_1_8b");

        let experiment = display
            .patched(json!({"translator": "translategemma_4b"}))
            .expect("select TranslateGemma local model");
        assert_eq!(experiment.translator, "translategemma_4b");
        assert_eq!(experiment.outgoing_translator, "translategemma_4b");
    }
}
