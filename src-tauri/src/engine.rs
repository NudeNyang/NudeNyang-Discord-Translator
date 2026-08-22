use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::cache::{CacheCleanupResult, TranslationCache};
use crate::cdp::CdpClient;
use crate::config::{default_config_path, AppConfig, ConfigStore};
use crate::dictionary::{DictionaryLookupResult, DictionaryStore, PersonalDictionaryEntry};
use crate::dictionary_ui::{
    apply_dictionary_error_script, apply_dictionary_result_script, apply_dictionary_saved_script,
    dictionary_ui_script, parse_dictionary_requests, DICTIONARY_CLEANUP_SCRIPT,
};
use crate::dictionary_window;
use crate::dom::{
    apply_script, parse_snapshot, DomChange, DomPart, CLEAR_TEXT_REGISTRY_SCRIPT,
    INSTALL_TEXT_RESTORE_SCRIPT, RESTORE_TEXT_SCRIPT, SNAPSHOT_SCRIPT,
};
use crate::image_translation::{
    apply_image_error_script, apply_image_result_script, fetch_image_data_script,
    image_capture_info_script, image_ui_script, parse_image_capture_info, parse_image_data,
    parse_image_requests, restore_images_script, ImageTranslationOutcome,
    ImageTranslationProcessor,
};
use crate::invite_assist::{invite_assist_script, parse_invite_open_request};
use crate::language::{detect_language, is_han_only, is_supported_language_code, Language};
use crate::ocr::OcrQualityMode;
use crate::outgoing::{
    apply_outgoing_detected_script, apply_outgoing_error_script, apply_outgoing_review_script,
    apply_outgoing_suggestion_script, attach_outgoing_text_file_script,
    capture_outgoing_send_script, finish_outgoing_review_script, outgoing_originals_ui_script,
    outgoing_ui_script, parse_outgoing_bindings, parse_outgoing_requests,
    prepare_outgoing_attachment_script, prepare_outgoing_reviewed_send_script,
    prepare_outgoing_send_script, suggest_recent_language, OutgoingRequest,
    OUTGOING_BINDINGS_SCRIPT, OUTGOING_CLEANUP_SCRIPT, OUTGOING_ORIGINALS_UI_VERSION,
};
use crate::text_split::split_for_discord;
use crate::translation::{
    DeepLTranslator, HyMtModelSize, HyMtTranslator, MockTranslator, ModelPreparationCancellation,
    ModelPreparationProgress, ModelProgressObserver, OriginalTranslator, ResilientTranslator,
    SubscriptionCliTranslator, TranslationService, Translator,
};

const MAX_BATCH_ITEMS: usize = 32;
const CPU_MAX_BATCH_ITEMS: usize = 6;
const MAX_MESSAGE_CONTEXT_BATCH_ITEMS: usize = 128;
const DISPLAY_VIEW_SETTLE_DELAY: Duration = Duration::from_millis(250);
const DISCORD_MESSAGE_UTF16_LIMIT: usize = 1900;
const HISTORY_CLEANUP_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const MAX_IMAGE_BASE64_BYTES: usize = (MAX_IMAGE_BYTES * 4 / 3) + 8;

type Locator = (String, String, usize);
type PendingKey = (u64, u64, String, String, usize, String);
type ImagePendingKey = (u64, String);
type OutgoingPendingKey = (u64, String);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub enabled: bool,
    pub controller_enabled: bool,
    pub cdp_connected: bool,
    pub connection_issue: String,
    pub discord_process_id: Option<u32>,
    pub engine: String,
    pub target_language: String,
    pub configured_translator: String,
    pub active_translator: String,
    pub configured_outgoing_translator: String,
    pub active_outgoing_translator: String,
    pub translator_state: String,
    pub translator_error: String,
    pub local_model_device: String,
    pub model_progress: Option<ModelPreparationProgress>,
    pub notice: String,
}

impl RuntimeStatus {
    fn new(config: &AppConfig) -> Self {
        Self {
            enabled: config.enabled,
            controller_enabled: config.enabled
                || config.outgoing_translation_enabled
                || config.dictionary_enabled,
            cdp_connected: false,
            connection_issue: String::new(),
            discord_process_id: None,
            engine: "rust-native".to_string(),
            target_language: config.target_language.clone(),
            configured_translator: config.translator.clone(),
            active_translator: "original".to_string(),
            configured_outgoing_translator: config.outgoing_translator.clone(),
            active_outgoing_translator: "original".to_string(),
            translator_state: "queued".to_string(),
            translator_error: String::new(),
            local_model_device: config.hymt_device.clone(),
            model_progress: None,
            notice: String::new(),
        }
    }
}

#[derive(Clone)]
pub struct RustEngine {
    controls: mpsc::Sender<Control>,
    status: Arc<Mutex<RuntimeStatus>>,
    thread: Arc<Mutex<Option<JoinHandle<()>>>>,
}

enum Control {
    ApplyConfig(Box<AppConfig>),
    SetEnabled(bool),
    CancelModelPreparation,
    ReplaceCdp(CdpClient, mpsc::Sender<Result<(), String>>),
    ClearCache(mpsc::Sender<Result<CacheCleanupResult, String>>),
    AttachApp(AppHandle),
    UiReady,
    Stop,
}

struct PartState {
    original: String,
    translated: String,
}

#[derive(Default)]
struct DisplayViewState {
    scope: String,
    epoch: u64,
    settle_until: Option<Instant>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DisplayViewObservation {
    Initial,
    Stable,
    Changed,
}

impl DisplayViewState {
    fn observe(&mut self, url: &str, now: Instant) -> DisplayViewObservation {
        let scope = display_view_scope(url);
        if scope == self.scope {
            return DisplayViewObservation::Stable;
        }
        let initial = self.scope.is_empty();
        self.scope = scope;
        self.epoch = self.epoch.wrapping_add(1).max(1);
        if initial {
            self.settle_until = None;
            DisplayViewObservation::Initial
        } else {
            self.settle_until = Some(now + DISPLAY_VIEW_SETTLE_DELAY);
            DisplayViewObservation::Changed
        }
    }

    fn is_ready(&self, now: Instant) -> bool {
        self.settle_until
            .is_none_or(|settle_until| now >= settle_until)
    }
}

struct TranslationBatch {
    generation: u64,
    view_epoch: u64,
    view_scope: String,
    target: Language,
    allowed_sources: Option<HashSet<Language>>,
    parts: Vec<DomPart>,
    context_scope: String,
    queued_at: Instant,
}

struct ImageTranslationBatch {
    generation: u64,
    target: Language,
    image_id: String,
    source_key: String,
    image_bytes: Vec<u8>,
    quality: OcrQualityMode,
    queued_at: Instant,
}

struct OutgoingTranslationBatch {
    generation: u64,
    target: Language,
    request_id: String,
    text: String,
    send_immediately: bool,
    queued_at: Instant,
}

struct DictionaryLocalizationBatch {
    request_id: String,
    target: Language,
    context: String,
    result: DictionaryLookupResult,
    queued_at: Instant,
}

enum WorkerCommand {
    Translate(TranslationBatch),
    TranslateImage(ImageTranslationBatch),
    LocalizeDictionary(DictionaryLocalizationBatch),
    DiscardDisplayBefore {
        generation: u64,
        view_epoch: u64,
    },
    Activate {
        generation: u64,
        name: String,
        translator: Box<dyn Translator>,
    },
    Warm,
    Release,
    ClearCacheMemory,
    Stop,
}

enum OutgoingWorkerCommand {
    Translate(OutgoingTranslationBatch),
    Activate {
        generation: u64,
        name: String,
        translator: Box<dyn Translator>,
    },
    Warm,
    Release,
    ClearCacheMemory,
    Stop,
}

fn worker_command_priority(command: &WorkerCommand) -> u8 {
    match command {
        WorkerCommand::Activate { .. }
        | WorkerCommand::Warm
        | WorkerCommand::Release
        | WorkerCommand::ClearCacheMemory
        | WorkerCommand::DiscardDisplayBefore { .. }
        | WorkerCommand::Stop => 0,
        WorkerCommand::LocalizeDictionary(_) | WorkerCommand::Translate(_) => 1,
        WorkerCommand::TranslateImage(_) => 2,
    }
}

fn next_worker_command(
    commands: &mpsc::Receiver<WorkerCommand>,
    backlog: &mut VecDeque<WorkerCommand>,
) -> Result<WorkerCommand, mpsc::RecvError> {
    if backlog.is_empty() {
        backlog.push_back(commands.recv()?);
    }
    while let Ok(command) = commands.try_recv() {
        backlog.push_back(command);
    }
    if let Some(latest_view) = backlog
        .iter()
        .filter_map(|command| match command {
            WorkerCommand::Translate(batch) => Some((batch.generation, batch.view_epoch)),
            WorkerCommand::DiscardDisplayBefore {
                generation,
                view_epoch,
            } => Some((*generation, *view_epoch)),
            _ => None,
        })
        .max()
    {
        backlog.retain(|command| match command {
            WorkerCommand::Translate(batch) => (batch.generation, batch.view_epoch) == latest_view,
            WorkerCommand::DiscardDisplayBefore {
                generation,
                view_epoch,
            } => (*generation, *view_epoch) == latest_view,
            _ => true,
        });
    }
    if let Some(latest_request_id) = backlog.iter().rev().find_map(|command| match command {
        WorkerCommand::LocalizeDictionary(batch) => Some(batch.request_id.clone()),
        _ => None,
    }) {
        backlog.retain(|command| match command {
            WorkerCommand::LocalizeDictionary(batch) => batch.request_id == latest_request_id,
            _ => true,
        });
    }
    let priority = backlog
        .iter()
        .map(worker_command_priority)
        .min()
        .expect("worker backlog contains at least one command");
    let index = if priority == 1 {
        backlog
            .iter()
            .rposition(|command| worker_command_priority(command) == priority)
            .expect("latest visible display command exists")
    } else {
        backlog
            .iter()
            .position(|command| worker_command_priority(command) == priority)
            .expect("highest priority worker command exists")
    };
    Ok(backlog
        .remove(index)
        .expect("selected worker command exists"))
}

enum WorkerResult {
    Translated {
        generation: u64,
        view_epoch: u64,
        view_scope: String,
        target: Language,
        parts: Vec<DomPart>,
        values: Result<Vec<String>, String>,
    },
    ImageTranslated {
        generation: u64,
        target: Language,
        image_id: String,
        source_key: String,
        outcome: Result<ImageTranslationOutcome, String>,
    },
    OutgoingTranslated {
        generation: u64,
        request_id: String,
        value: Result<String, String>,
        send_immediately: bool,
    },
    DictionaryLocalized {
        request_id: String,
        result: DictionaryLookupResult,
    },
    DisplayActivated {
        generation: u64,
        name: String,
    },
    OutgoingActivated {
        generation: u64,
        name: String,
    },
    ActivationFailed {
        generation: u64,
        lane: &'static str,
        name: String,
        error: String,
    },
    ModelProgress {
        generation: u64,
        progress: ModelPreparationProgress,
    },
    WarmFailed(String),
}

enum PreparationResult {
    Ready {
        generation: u64,
        display_name: String,
        outgoing_name: String,
        display_translator: Option<Box<dyn Translator>>,
        outgoing_translator: Option<Box<dyn Translator>>,
    },
    Failed {
        generation: u64,
        display_name: String,
        outgoing_name: String,
        error: String,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct TranslatorPreparationPlan {
    display: bool,
    outgoing: bool,
}

impl TranslatorPreparationPlan {
    fn all() -> Self {
        Self {
            display: true,
            outgoing: true,
        }
    }

    fn any(self) -> bool {
        self.display || self.outgoing
    }
}

fn translator_preparation_plan(
    current: &AppConfig,
    updated: &AppConfig,
) -> TranslatorPreparationPlan {
    let shared_settings_changed = updated.hymt_device != current.hymt_device;
    TranslatorPreparationPlan {
        display: updated.translator != current.translator || shared_settings_changed,
        outgoing: updated.outgoing_translator != current.outgoing_translator
            || shared_settings_changed,
    }
}

fn preparation_plan_for_active_lanes(
    config: &AppConfig,
    plan: TranslatorPreparationPlan,
) -> TranslatorPreparationPlan {
    TranslatorPreparationPlan {
        display: plan.display
            && (config.enabled
                || config.dictionary_enabled
                || !is_local_model_name(&config.translator)),
        outgoing: plan.outgoing
            && (config.outgoing_translation_enabled
                || !is_local_model_name(&config.outgoing_translator)),
    }
}

fn display_preparation_is_required(runtime: &RuntimeStatus, config: &AppConfig) -> bool {
    if runtime.active_translator == config.translator {
        return false;
    }
    !(runtime.translator_state == "preparing" && runtime.configured_translator == config.translator)
}

fn initial_model_preparation_progress(name: &str) -> Option<ModelPreparationProgress> {
    HyMtModelSize::from_config_id(name).map(|model_size| {
        let model = model_size.model();
        ModelPreparationProgress {
            model: model.label.to_string(),
            phase: "starting".to_string(),
            downloaded: 0,
            total: model.expected_bytes,
        }
    })
}

impl RustEngine {
    pub fn start(config: AppConfig) -> Self {
        let (control_tx, control_rx) = mpsc::channel();
        let status = Arc::new(Mutex::new(RuntimeStatus::new(&config)));
        let thread_status = status.clone();
        let handle = thread::Builder::new()
            .name("rust-dom-controller".to_string())
            .spawn(move || run_controller(config, control_rx, thread_status))
            .expect("Rust DOM 번역 스레드를 시작하지 못했습니다");
        Self {
            controls: control_tx,
            status,
            thread: Arc::new(Mutex::new(Some(handle))),
        }
    }

    pub fn apply_config(&self, config: AppConfig) -> Result<(), String> {
        self.controls
            .send(Control::ApplyConfig(Box::new(config)))
            .map_err(|_| "Rust 번역 엔진이 종료되어 설정을 적용하지 못했습니다.".to_string())
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        if let Ok(mut status) = self.status.lock() {
            status.enabled = enabled;
        }
        self.controls
            .send(Control::SetEnabled(enabled))
            .map_err(|_| "Rust 번역 엔진이 종료되어 번역 상태를 바꾸지 못했습니다.".to_string())
    }

    pub fn cancel_model_preparation(&self) -> Result<(), String> {
        if let Ok(mut status) = self.status.lock() {
            status.enabled = false;
            status.controller_enabled = false;
            status.translator_state = "queued".to_string();
            status.translator_error.clear();
            status.model_progress = None;
            status.notice.clear();
        }
        self.controls
            .send(Control::CancelModelPreparation)
            .map_err(|_| {
                "Rust 번역 엔진이 종료되어 모델 다운로드를 취소하지 못했습니다.".to_string()
            })
    }

    pub fn replace_cdp(&self, client: CdpClient) -> Result<(), String> {
        let (result_tx, result_rx) = mpsc::channel();
        self.controls
            .send(Control::ReplaceCdp(client, result_tx))
            .map_err(|_| "Rust 번역 엔진에 보안 CDP 연결을 전달하지 못했습니다.".to_string())?;
        result_rx
            .recv_timeout(Duration::from_secs(30))
            .map_err(|_| "Discord 보안 연결 검증 결과를 기다리지 못했습니다.".to_string())?
    }

    pub fn attach_app(&self, app: AppHandle) -> Result<(), String> {
        self.controls
            .send(Control::AttachApp(app))
            .map_err(|_| "Rust 번역 엔진에 앱 설정 연결을 전달하지 못했습니다.".to_string())
    }

    pub fn ui_ready(&self) -> Result<(), String> {
        self.controls
            .send(Control::UiReady)
            .map_err(|_| "Rust 번역 엔진에 UI 준비 상태를 전달하지 못했습니다.".to_string())
    }

    pub fn clear_cache(&self) -> Result<CacheCleanupResult, String> {
        let (result_tx, result_rx) = mpsc::channel();
        self.controls
            .send(Control::ClearCache(result_tx))
            .map_err(|_| {
                "Rust 번역 엔진이 종료되어 번역 기록을 정리하지 못했습니다.".to_string()
            })?;
        result_rx
            .recv_timeout(Duration::from_secs(30))
            .map_err(|_| "번역 기록 정리 결과를 기다리지 못했습니다.".to_string())?
    }

    pub fn status(&self) -> Result<RuntimeStatus, String> {
        let mut status = self
            .status
            .lock()
            .map_err(|_| "Rust 번역 엔진 상태 잠금을 열지 못했습니다.".to_string())?;
        let snapshot = status.clone();
        status.notice.clear();
        Ok(snapshot)
    }

    pub fn stop(&self) {
        let _ = self.controls.send(Control::Stop);
        if let Ok(mut thread) = self.thread.lock() {
            if let Some(handle) = thread.take() {
                let _ = handle.join();
            }
        }
    }
}

fn run_controller(
    mut config: AppConfig,
    controls: mpsc::Receiver<Control>,
    status: Arc<Mutex<RuntimeStatus>>,
) {
    let (worker_tx, worker_rx) = mpsc::channel();
    let (outgoing_worker_tx, outgoing_worker_rx) = mpsc::channel();
    let (worker_result_tx, worker_result_rx) = mpsc::channel();
    let outgoing_result_tx = worker_result_tx.clone();
    let progress_result_tx = worker_result_tx.clone();
    let worker = thread::Builder::new()
        .name("rust-translation-worker".to_string())
        .spawn(move || run_translation_worker(worker_rx, worker_result_tx))
        .ok();
    let outgoing_worker = thread::Builder::new()
        .name("rust-outgoing-translation-worker".to_string())
        .spawn(move || run_outgoing_translation_worker(outgoing_worker_rx, outgoing_result_tx))
        .ok();
    let (preparation_tx, preparation_rx) = mpsc::channel();
    let outgoing_original_store = TranslationCache::open_default().ok();
    let dictionary_store = DictionaryStore::open_default().ok();
    let mut outgoing_channel_languages = outgoing_original_store
        .as_ref()
        .and_then(|store| store.outgoing_channel_languages().ok())
        .unwrap_or_default();
    let mut client: Option<CdpClient> = None;
    let mut states: HashMap<Locator, PartState> = HashMap::new();
    let mut pending: HashSet<PendingKey> = HashSet::new();
    let mut display_view = DisplayViewState::default();
    let mut image_pending: HashSet<ImagePendingKey> = HashSet::new();
    let mut outgoing_pending: HashSet<OutgoingPendingKey> = HashSet::new();
    let mut generation = 0_u64;
    let mut preparation_generation = 0_u64;
    let mut preparation_cancellation: Option<ModelPreparationCancellation> = None;
    let mut consecutive_connection_failures = 0_u8;
    let mut connection_issue_reported = false;
    let mut image_ui_needs_cleanup = true;
    let mut outgoing_ui_needs_cleanup = true;
    let mut dictionary_ui_needs_cleanup = true;
    let mut app_handle: Option<AppHandle> = None;
    let mut ui_ready = false;
    let mut stopped = false;
    let mut pending_control = None;
    let mut last_history_cleanup_at = None;

    while !stopped {
        let started = Instant::now();
        loop {
            let control = pending_control.take().or_else(|| controls.try_recv().ok());
            let Some(control) = control else {
                break;
            };
            match control {
                Control::ApplyConfig(updated) => {
                    let updated = *updated;
                    let history_retention_changed = updated.translation_history_retention_days
                        != config.translation_history_retention_days;
                    let target_changed = updated.target_language != config.target_language;
                    let incoming_languages_changed = updated.incoming_language_mode
                        != config.incoming_language_mode
                        || updated.incoming_source_languages != config.incoming_source_languages;
                    let image_ocr_quality_changed =
                        updated.image_ocr_quality != config.image_ocr_quality;
                    let mut requested_preparation = translator_preparation_plan(&config, &updated);
                    if ui_ready && requested_preparation.any() {
                        if let Ok(runtime) = status.lock() {
                            requested_preparation.display |=
                                display_preparation_is_required(&runtime, &updated);
                            requested_preparation.outgoing |=
                                runtime.active_outgoing_translator != updated.outgoing_translator;
                        }
                    }
                    let runtime_changed = requested_preparation.any();
                    let enabled_changed = updated.enabled != config.enabled;
                    let outgoing_changed =
                        updated.outgoing_translation_enabled != config.outgoing_translation_enabled;
                    let dictionary_changed =
                        updated.dictionary_enabled != config.dictionary_enabled;
                    let warm_changed =
                        updated.keep_local_model_warm != config.keep_local_model_warm;
                    if target_changed
                        || incoming_languages_changed
                        || runtime_changed
                        || image_ocr_quality_changed
                    {
                        reset_translation_state(
                            &mut client,
                            &mut states,
                            &mut pending,
                            &mut image_pending,
                            &mut outgoing_pending,
                            &mut generation,
                        );
                        image_ui_needs_cleanup = client.is_none();
                    }
                    config = updated;
                    if history_retention_changed {
                        last_history_cleanup_at = None;
                    }
                    update_status(&status, |runtime| {
                        runtime.enabled = config.enabled;
                        runtime.controller_enabled = config.enabled
                            || config.outgoing_translation_enabled
                            || config.dictionary_enabled;
                        runtime.target_language = config.target_language.clone();
                        runtime.configured_translator = config.translator.clone();
                        runtime.configured_outgoing_translator = config.outgoing_translator.clone();
                    });
                    let preparation_plan =
                        preparation_plan_for_active_lanes(&config, requested_preparation);
                    let mut preparation_requested = false;
                    if ui_ready && preparation_plan.any() {
                        request_translator_preparation(
                            &config,
                            preparation_plan,
                            &preparation_tx,
                            &progress_result_tx,
                            &status,
                            &mut preparation_generation,
                            &mut preparation_cancellation,
                        );
                        preparation_requested = true;
                    } else if runtime_changed {
                        if let Some(cancellation) = preparation_cancellation.take() {
                            cancellation.cancel();
                        }
                        preparation_generation += 1;
                        if requested_preparation.display && !preparation_plan.display {
                            let _ = worker_tx.send(WorkerCommand::Release);
                        }
                        if requested_preparation.outgoing && !preparation_plan.outgoing {
                            let _ = outgoing_worker_tx.send(OutgoingWorkerCommand::Release);
                        }
                    } else if warm_changed {
                        if !config.keep_local_model_warm {
                            if !config.enabled && !config.dictionary_enabled {
                                let _ = worker_tx.send(WorkerCommand::Release);
                            }
                            if !config.outgoing_translation_enabled {
                                let _ = outgoing_worker_tx.send(OutgoingWorkerCommand::Release);
                            }
                        }
                    }
                    if enabled_changed && !config.enabled {
                        restore(&mut client, &states, false);
                        image_ui_needs_cleanup = client.is_none();
                        pending.clear();
                        image_pending.clear();
                        generation += 1;
                        if !config.keep_local_model_warm && !config.dictionary_enabled {
                            let _ = worker_tx.send(WorkerCommand::Release);
                        }
                    } else if enabled_changed {
                        let needs_preparation = status.lock().is_ok_and(|runtime| {
                            display_preparation_is_required(&runtime, &config)
                        });
                        if ui_ready && needs_preparation && !preparation_requested {
                            request_translator_preparation(
                                &config,
                                TranslatorPreparationPlan {
                                    display: true,
                                    outgoing: false,
                                },
                                &preparation_tx,
                                &progress_result_tx,
                                &status,
                                &mut preparation_generation,
                                &mut preparation_cancellation,
                            );
                            preparation_requested = true;
                        } else if !needs_preparation {
                            let _ = worker_tx.send(WorkerCommand::Warm);
                        }
                    }
                    if outgoing_changed {
                        outgoing_pending.clear();
                        generation += 1;
                        outgoing_ui_needs_cleanup = true;
                        if config.outgoing_translation_enabled {
                            let needs_preparation = status.lock().is_ok_and(|runtime| {
                                runtime.active_outgoing_translator != config.outgoing_translator
                            });
                            if ui_ready && needs_preparation && !preparation_requested {
                                request_translator_preparation(
                                    &config,
                                    TranslatorPreparationPlan {
                                        display: false,
                                        outgoing: true,
                                    },
                                    &preparation_tx,
                                    &progress_result_tx,
                                    &status,
                                    &mut preparation_generation,
                                    &mut preparation_cancellation,
                                );
                            } else if !needs_preparation {
                                let _ = outgoing_worker_tx.send(OutgoingWorkerCommand::Warm);
                            }
                        } else if !config.keep_local_model_warm {
                            let _ = outgoing_worker_tx.send(OutgoingWorkerCommand::Release);
                        }
                    }
                    if dictionary_changed {
                        dictionary_ui_needs_cleanup = true;
                        if config.dictionary_enabled {
                            let needs_preparation = status.lock().is_ok_and(|runtime| {
                                display_preparation_is_required(&runtime, &config)
                            });
                            if ui_ready && needs_preparation && !preparation_requested {
                                request_translator_preparation(
                                    &config,
                                    TranslatorPreparationPlan {
                                        display: true,
                                        outgoing: false,
                                    },
                                    &preparation_tx,
                                    &progress_result_tx,
                                    &status,
                                    &mut preparation_generation,
                                    &mut preparation_cancellation,
                                );
                            } else if !needs_preparation {
                                let _ = worker_tx.send(WorkerCommand::Warm);
                            }
                        } else if !config.enabled && !config.keep_local_model_warm {
                            let _ = worker_tx.send(WorkerCommand::Release);
                        }
                    }
                }
                Control::SetEnabled(enabled) => {
                    if config.enabled != enabled {
                        config.enabled = enabled;
                        update_status(&status, |runtime| {
                            runtime.enabled = enabled;
                            runtime.controller_enabled = enabled
                                || config.outgoing_translation_enabled
                                || config.dictionary_enabled;
                            if !enabled {
                                runtime.connection_issue.clear();
                            }
                        });
                        if !enabled {
                            restore(&mut client, &states, false);
                            image_ui_needs_cleanup = client.is_none();
                            pending.clear();
                            image_pending.clear();
                            generation += 1;
                            consecutive_connection_failures = 0;
                            connection_issue_reported = false;
                            if !config.keep_local_model_warm {
                                let _ = worker_tx.send(WorkerCommand::Release);
                            }
                        } else {
                            let needs_preparation = status.lock().is_ok_and(|runtime| {
                                display_preparation_is_required(&runtime, &config)
                            });
                            if ui_ready && needs_preparation {
                                request_translator_preparation(
                                    &config,
                                    TranslatorPreparationPlan {
                                        display: true,
                                        outgoing: false,
                                    },
                                    &preparation_tx,
                                    &progress_result_tx,
                                    &status,
                                    &mut preparation_generation,
                                    &mut preparation_cancellation,
                                );
                            } else {
                                let _ = worker_tx.send(WorkerCommand::Warm);
                            }
                        }
                    }
                }
                Control::CancelModelPreparation => {
                    if let Some(cancellation) = preparation_cancellation.take() {
                        cancellation.cancel();
                    }
                    preparation_generation += 1;
                    config.enabled = false;
                    config.outgoing_translation_enabled = false;
                    restore(&mut client, &states, false);
                    pending.clear();
                    image_pending.clear();
                    outgoing_pending.clear();
                    generation += 1;
                    let _ = worker_tx.send(WorkerCommand::Release);
                    let _ = outgoing_worker_tx.send(OutgoingWorkerCommand::Release);
                    update_status(&status, |runtime| {
                        runtime.enabled = false;
                        runtime.controller_enabled = config.dictionary_enabled;
                        runtime.translator_state = "queued".to_string();
                        runtime.translator_error.clear();
                        runtime.model_progress = None;
                        runtime.notice.clear();
                    });
                }
                Control::ReplaceCdp(mut replacement, result_tx) => {
                    restore(&mut client, &states, false);
                    if let Some(mut previous) = client.take() {
                        previous.close();
                    }
                    let prepare_result = replacement.connect().and_then(|_| {
                        for script in cdp_attach_text_scripts() {
                            replacement.evaluate(script, false)?;
                        }
                        Ok(())
                    });
                    if let Err(error) = &prepare_result {
                        crate::diagnostics::error("cdp-replacement", error);
                        replacement.close();
                        update_status(&status, |runtime| {
                            runtime.cdp_connected = false;
                            runtime.connection_issue = error.clone();
                        });
                        connection_issue_reported = true;
                    } else {
                        client = Some(replacement);
                        states.clear();
                        pending.clear();
                        display_view = DisplayViewState::default();
                        image_pending.clear();
                        outgoing_pending.clear();
                        generation += 1;
                        image_ui_needs_cleanup = true;
                        outgoing_ui_needs_cleanup = true;
                        dictionary_ui_needs_cleanup = true;
                        consecutive_connection_failures = 0;
                        connection_issue_reported = false;
                    }
                    let _ = result_tx.send(prepare_result);
                }
                Control::ClearCache(result_tx) => {
                    let result = outgoing_original_store
                        .as_ref()
                        .ok_or_else(|| "SQLite 번역 저장소를 열지 못했습니다.".to_string())
                        .and_then(TranslationCache::clear_user_data);
                    if result.is_ok() {
                        let _ = worker_tx.send(WorkerCommand::ClearCacheMemory);
                        let _ = outgoing_worker_tx.send(OutgoingWorkerCommand::ClearCacheMemory);
                    }
                    let _ = result_tx.send(result);
                }
                Control::AttachApp(app) => app_handle = Some(app),
                Control::UiReady => {
                    if !ui_ready {
                        ui_ready = true;
                        let preparation_plan = preparation_plan_for_active_lanes(
                            &config,
                            TranslatorPreparationPlan::all(),
                        );
                        if preparation_plan.any() {
                            request_translator_preparation(
                                &config,
                                preparation_plan,
                                &preparation_tx,
                                &progress_result_tx,
                                &status,
                                &mut preparation_generation,
                                &mut preparation_cancellation,
                            );
                        } else {
                            update_status(&status, |runtime| {
                                runtime.translator_state = "ready".to_string();
                                runtime.notice =
                                    "로컬 모델은 번역 기능을 켤 때 준비합니다.".to_string();
                            });
                        }
                    }
                }
                Control::Stop => {
                    stopped = true;
                    break;
                }
            }
        }
        if stopped {
            break;
        }

        maybe_cleanup_translation_history(
            &config,
            outgoing_original_store.as_ref(),
            &worker_tx,
            &outgoing_worker_tx,
            &mut last_history_cleanup_at,
        );

        while let Ok(prepared) = preparation_rx.try_recv() {
            match prepared {
                PreparationResult::Ready {
                    generation: prepared_generation,
                    display_name,
                    outgoing_name,
                    display_translator,
                    outgoing_translator,
                } => {
                    if prepared_generation == preparation_generation
                        && display_name == config.translator
                        && outgoing_name == config.outgoing_translator
                    {
                        if let Some(translator) = display_translator {
                            let _ = worker_tx.send(WorkerCommand::Activate {
                                generation: prepared_generation,
                                name: display_name,
                                translator,
                            });
                        }
                        if let Some(translator) = outgoing_translator {
                            let _ = outgoing_worker_tx.send(OutgoingWorkerCommand::Activate {
                                generation: prepared_generation,
                                name: outgoing_name,
                                translator,
                            });
                        }
                    }
                }
                PreparationResult::Failed {
                    generation: prepared_generation,
                    display_name,
                    outgoing_name,
                    error,
                } => {
                    if prepared_generation == preparation_generation
                        && display_name == config.translator
                        && outgoing_name == config.outgoing_translator
                    {
                        crate::diagnostics::error(
                            "translator",
                            &format!(
                                "{} / {} preparation failed: {error}",
                                translator_label(&display_name),
                                translator_label(&outgoing_name)
                            ),
                        );
                        update_status(&status, |runtime| {
                            runtime.translator_state = "error".to_string();
                            runtime.translator_error = format!("번역 모델 준비 실패: {error}");
                            runtime.model_progress = None;
                            runtime.notice = runtime.translator_error.clone();
                        });
                    }
                }
            }
        }

        let target =
            Language::try_from(config.target_language.as_str()).unwrap_or(Language::Korean);
        drain_worker_results(
            &worker_result_rx,
            &worker_tx,
            &outgoing_worker_tx,
            &mut client,
            &mut states,
            &mut pending,
            &display_view,
            &mut image_pending,
            &mut outgoing_pending,
            &mut generation,
            preparation_generation,
            target,
            &config,
            &status,
            dictionary_store.as_ref(),
            app_handle.as_ref(),
        );

        let had_client = client.is_some();
        let result = (|| -> Result<(), String> {
            if client.is_none() {
                return Err(
                    "Discord가 보안 연결로 열리지 않았어. Discord 재시작을 진행해줘.".to_string(),
                );
            }
            client.as_mut().expect("connected CDP client").connect()?;
            consecutive_connection_failures = 0;
            connection_issue_reported = false;
            update_status(&status, |runtime| {
                runtime.cdp_connected = true;
                runtime.connection_issue.clear();
            });
            if !prepare_display_view_for_dom(
                client.as_mut().expect("connected CDP client"),
                &mut pending,
                &mut display_view,
                generation,
                &worker_tx,
            )? {
                return Ok(());
            }
            handle_invite_assist(
                client.as_mut().expect("connected CDP client"),
                app_handle.as_ref(),
                &config.ui_language,
            )?;
            if config.dictionary_enabled {
                let dictionary_translation_ready = status
                    .lock()
                    .is_ok_and(|runtime| runtime.active_translator == config.translator);
                scan_dictionary(
                    client.as_mut().expect("connected CDP client"),
                    dictionary_store.as_ref(),
                    app_handle.as_ref(),
                    &config,
                    &worker_tx,
                    dictionary_translation_ready,
                )?;
                dictionary_ui_needs_cleanup = true;
            } else if dictionary_ui_needs_cleanup {
                client
                    .as_mut()
                    .expect("connected CDP client")
                    .evaluate(DICTIONARY_CLEANUP_SCRIPT, false)?;
                if let Some(app) = app_handle.as_ref() {
                    let _ = dictionary_window::hide(app);
                }
                dictionary_ui_needs_cleanup = false;
            }
            ensure_outgoing_originals(
                client.as_mut().expect("connected CDP client"),
                outgoing_original_store.as_ref(),
                &config.ui_language,
                config.enabled,
            )?;
            let requested_display_language =
                if config.enabled || config.outgoing_translation_enabled {
                    let requested = scan_outgoing(
                        client.as_mut().expect("connected CDP client"),
                        &mut outgoing_pending,
                        generation,
                        &outgoing_worker_tx,
                        &config,
                        outgoing_original_store.as_ref(),
                        &mut outgoing_channel_languages,
                    )?;
                    outgoing_ui_needs_cleanup = true;
                    requested
                } else if outgoing_ui_needs_cleanup {
                    client.as_mut().expect("connected CDP client").evaluate(
                        &outgoing_ui_script(
                            false,
                            false,
                            &config.target_language,
                            &config.outgoing_target_language,
                            &config.ui_language,
                            &outgoing_channel_languages,
                            config.outgoing_confirm_send,
                            &config.hotkeys.send_outgoing_immediately,
                            &config.hotkeys.review_outgoing_before_send,
                        ),
                        false,
                    )?;
                    outgoing_ui_needs_cleanup = false;
                    None
                } else {
                    None
                };
            if let Some(language) =
                requested_display_language.filter(|language| language != &config.target_language)
            {
                let updated = if let Some(app) = app_handle.as_ref() {
                    let updated = app
                        .state::<ConfigStore>()
                        .update(json!({"target_language": language}))?;
                    let _ = app.emit("settings-changed", updated.clone());
                    updated
                } else {
                    config.patched(json!({"target_language": language}))?
                };
                config = updated;
                reset_translation_state(
                    &mut client,
                    &mut states,
                    &mut pending,
                    &mut image_pending,
                    &mut outgoing_pending,
                    &mut generation,
                );
                image_ui_needs_cleanup = client.is_none();
                update_status(&status, |runtime| {
                    runtime.target_language = config.target_language.clone();
                    runtime.notice = "표시 언어를 변경했습니다.".to_string();
                });
            }
            let target =
                Language::try_from(config.target_language.as_str()).unwrap_or(Language::Korean);
            let display_ready = status.lock().is_ok_and(|runtime| {
                display_translation_is_ready(&config, &runtime.active_translator)
            });
            if display_ready {
                let display_view_ready = scan_dom(
                    client.as_mut().expect("connected CDP client"),
                    &states,
                    &mut pending,
                    &mut display_view,
                    generation,
                    target,
                    incoming_allowed_sources(&config),
                    display_batch_item_limit(&config),
                    &worker_tx,
                )?;
                if display_view_ready {
                    scan_images(
                        client.as_mut().expect("connected CDP client"),
                        &mut image_pending,
                        generation,
                        target,
                        &worker_tx,
                        &status,
                        &config.ui_language,
                        OcrQualityMode::from_config(&config.image_ocr_quality),
                    )?;
                    image_ui_needs_cleanup = true;
                }
            } else if !config.enabled {
                client
                    .as_mut()
                    .expect("connected CDP client")
                    .evaluate(RESTORE_TEXT_SCRIPT, false)?;
                if image_ui_needs_cleanup {
                    client
                        .as_mut()
                        .expect("connected CDP client")
                        .evaluate(&restore_images_script(false), false)?;
                    image_ui_needs_cleanup = false;
                }
            }
            Ok(())
        })();
        if let Err(error) = result {
            if !had_client
                && (config.enabled
                    || config.outgoing_translation_enabled
                    || config.dictionary_enabled)
                && !connection_issue_reported
            {
                consecutive_connection_failures += 1;
                if consecutive_connection_failures >= 2 {
                    connection_issue_reported = true;
                    crate::diagnostics::error("discord-connection", &error);
                    update_status(&status, |runtime| {
                        runtime.connection_issue = error.clone();
                    });
                }
            }
            if let Some(mut disconnected) = client.take() {
                disconnected.close();
            }
            image_ui_needs_cleanup = true;
            outgoing_ui_needs_cleanup = true;
            dictionary_ui_needs_cleanup = true;
            update_status(&status, |runtime| runtime.cdp_connected = false);
        }

        let interval = if client.is_some() {
            poll_interval(config.capture_fps)
        } else {
            Duration::from_secs(1)
        };
        let remaining = interval.saturating_sub(started.elapsed());
        if remaining > Duration::ZERO {
            match controls.recv_timeout(remaining) {
                Ok(control) => pending_control = Some(control),
                Err(mpsc::RecvTimeoutError::Disconnected) => stopped = true,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
        }
    }

    restore(&mut client, &states, false);
    if let Some(client) = client.as_mut() {
        let _ = client.evaluate(OUTGOING_CLEANUP_SCRIPT, false);
        let _ = client.evaluate(DICTIONARY_CLEANUP_SCRIPT, false);
    }
    let _ = worker_tx.send(WorkerCommand::Stop);
    let _ = outgoing_worker_tx.send(OutgoingWorkerCommand::Stop);
    if let Some(worker) = worker {
        let _ = worker.join();
    }
    if let Some(worker) = outgoing_worker {
        let _ = worker.join();
    }
    if let Some(mut client) = client {
        client.close();
    }
}

fn scan_dictionary(
    client: &mut CdpClient,
    store: Option<&DictionaryStore>,
    app: Option<&AppHandle>,
    config: &AppConfig,
    worker: &mpsc::Sender<WorkerCommand>,
    translation_ready: bool,
) -> Result<(), String> {
    let value = client.evaluate(
        &dictionary_ui_script(
            config.dictionary_enabled,
            &config.ui_language,
            &config.target_language,
            config.dictionary_external_provider != "none",
        ),
        false,
    )?;
    for request in parse_dictionary_requests(value)?.into_iter().take(4) {
        let outcome = match request.action.as_str() {
            "lookup" => {
                let app =
                    app.ok_or_else(|| "사전 도구 창을 열 준비가 되지 않았습니다.".to_string())?;
                dictionary_window::show_loading(
                    app,
                    &request.id,
                    &request.query,
                    &config.ui_language,
                    &config.target_language,
                    config.dictionary_external_provider != "none",
                )?;
                store
                    .ok_or_else(|| "사전 저장소를 열지 못했습니다.".to_string())
                    .and_then(|store| {
                        let source_language = dictionary_source_language(
                            &request.source_language,
                            &request.query,
                            &request.context,
                        );
                        let target_language =
                            if is_supported_language_code(&request.target_language) {
                                request.target_language.as_str()
                            } else {
                                config.target_language.as_str()
                            };
                        let result = store.lookup_with_context(
                            &request.query,
                            &request.context,
                            source_language.as_deref(),
                            target_language,
                        )?;
                        let target = Language::try_from(result.target_language.as_str())
                            .unwrap_or(Language::English);
                        let (immediate, pending) =
                            stage_dictionary_lookup_result(result, translation_ready);
                        if let Some(result) = pending {
                            worker
                                .send(WorkerCommand::LocalizeDictionary(
                                    DictionaryLocalizationBatch {
                                        request_id: request.id.clone(),
                                        target,
                                        context: request.context.clone(),
                                        result,
                                        queued_at: Instant::now(),
                                    },
                                ))
                                .map_err(|_| {
                                    "Rust 사전 번역 작업 스레드가 종료되었습니다.".to_string()
                                })?;
                        }
                        Ok(immediate)
                    })
                    .and_then(|result| {
                        dictionary_window::show_result(
                            app,
                            &request.id,
                            result,
                            &config.ui_language,
                            config.dictionary_external_provider != "none",
                        )?;
                        Ok(String::new())
                    })
            }
            "save" => store
                .ok_or_else(|| "사전 저장소를 열지 못했습니다.".to_string())
                .and_then(|store| {
                    let detected = detect_language(&request.query).language;
                    let source_language = if is_supported_language_code(&request.source_language) {
                        request.source_language.clone()
                    } else if detected != Language::Unknown {
                        detected.code().to_string()
                    } else {
                        return Err(
                            "개인 사전에 저장할 원문 언어를 확인하지 못했습니다.".to_string()
                        );
                    };
                    let target_language = if is_supported_language_code(&request.target_language) {
                        request.target_language.clone()
                    } else {
                        config.target_language.clone()
                    };
                    store.upsert_personal(PersonalDictionaryEntry {
                        id: 0,
                        source_language,
                        target_language,
                        source_term: request.query.clone(),
                        target_term: request.target_term.clone(),
                        note: request.note.clone(),
                        tags: String::new(),
                        pinned: false,
                        scope: "global".to_string(),
                        scope_value: String::new(),
                        case_sensitive: false,
                        whole_word: true,
                        created_at: 0.0,
                        updated_at: 0.0,
                    })?;
                    apply_dictionary_saved_script(&request.id)
                }),
            "open" => {
                if config.dictionary_external_provider == "none" {
                    Ok(String::new())
                } else {
                    app.ok_or_else(|| "기본 브라우저를 열 준비가 되지 않았습니다.".to_string())
                        .and_then(|app| {
                            dictionary_window::open_external_dictionary(app, &request.query)
                        })
                        .map(|()| String::new())
                }
            }
            _ => Err("알 수 없는 사전 요청입니다.".to_string()),
        };
        let script = match outcome {
            Ok(script) => script,
            Err(error) => {
                if request.action == "lookup" {
                    if let Some(app) = app {
                        if let Err(window_error) = dictionary_window::show_error(
                            app,
                            &request.id,
                            &request.query,
                            &config.ui_language,
                            &config.target_language,
                            config.dictionary_external_provider != "none",
                            &error,
                        ) {
                            crate::diagnostics::warn("dictionary-window", &window_error);
                        }
                    }
                    String::new()
                } else {
                    apply_dictionary_error_script(&request.id, &error)?
                }
            }
        };
        if !script.is_empty() {
            client.evaluate(&script, false)?;
        }
    }
    Ok(())
}

fn stage_dictionary_lookup_result(
    mut result: DictionaryLookupResult,
    translation_ready: bool,
) -> (DictionaryLookupResult, Option<DictionaryLookupResult>) {
    if translation_ready && (result.needs_localization() || result.needs_selection_translation()) {
        let pending = result.clone();
        result.localization_pending = true;
        (result, Some(pending))
    } else {
        (result, None)
    }
}

fn dictionary_source_language(
    explicit_language: &str,
    query: &str,
    context: &str,
) -> Option<String> {
    if is_supported_language_code(explicit_language) {
        return Some(explicit_language.to_string());
    }
    let selected_language = detect_language(query).language;
    let contextual_language = detect_language(context).language;
    if is_han_only(query)
        && matches!(
            contextual_language,
            Language::Japanese | Language::ChineseSimplified | Language::ChineseTraditional
        )
    {
        return Some(contextual_language.code().to_string());
    }
    if selected_language != Language::Unknown {
        return Some(selected_language.code().to_string());
    }
    (contextual_language != Language::Unknown).then(|| contextual_language.code().to_string())
}

fn handle_invite_assist(
    client: &mut CdpClient,
    app: Option<&AppHandle>,
    ui_language: &str,
) -> Result<(), String> {
    let request =
        parse_invite_open_request(client.evaluate(&invite_assist_script(ui_language), false)?);
    let (Some(code), Some(app)) = (request, app) else {
        return Ok(());
    };
    let url = format!("https://discord.com/invite/{code}");
    match app.opener().open_url(url, None::<&str>) {
        Ok(()) => crate::diagnostics::info(
            "discord-invite",
            "security-check invite handed off to the default browser",
        ),
        Err(error) => crate::diagnostics::error(
            "discord-invite",
            &format!("기본 브라우저에서 Discord 초대를 열지 못했습니다: {error}"),
        ),
    }
    Ok(())
}

fn maybe_cleanup_translation_history(
    config: &AppConfig,
    store: Option<&TranslationCache>,
    worker_tx: &mpsc::Sender<WorkerCommand>,
    outgoing_worker_tx: &mpsc::Sender<OutgoingWorkerCommand>,
    last_cleanup_at: &mut Option<Instant>,
) {
    let retention_days = config.translation_history_retention_days;
    if retention_days == 0 {
        *last_cleanup_at = None;
        return;
    }
    if last_cleanup_at
        .as_ref()
        .is_some_and(|last| last.elapsed() < HISTORY_CLEANUP_INTERVAL)
    {
        return;
    }
    *last_cleanup_at = Some(Instant::now());
    let result = store
        .ok_or_else(|| "SQLite translation history store is unavailable".to_string())
        .and_then(|store| store.cleanup_expired_records(retention_days));
    match result {
        Ok(result) if result.removed_records > 0 => {
            let _ = worker_tx.send(WorkerCommand::ClearCacheMemory);
            let _ = outgoing_worker_tx.send(OutgoingWorkerCommand::ClearCacheMemory);
            crate::diagnostics::info(
                "translation-cache",
                &format!(
                    "Automatically removed {} records older than {} days",
                    result.removed_records, retention_days
                ),
            );
        }
        Ok(_) => {}
        Err(error) => crate::diagnostics::warn(
            "translation-cache",
            &format!("Automatic history cleanup failed: {error}"),
        ),
    }
}

fn scan_images(
    client: &mut CdpClient,
    pending: &mut HashSet<ImagePendingKey>,
    generation: u64,
    target: Language,
    worker: &mpsc::Sender<WorkerCommand>,
    status: &Arc<Mutex<RuntimeStatus>>,
    ui_language: &str,
    quality: OcrQualityMode,
) -> Result<(), String> {
    let requests = parse_image_requests(client.evaluate(&image_ui_script(ui_language), false)?)?;
    for request in requests.into_iter().take(2) {
        let pending_key = (generation, request.id.clone());
        if request.id.is_empty() || pending.contains(&pending_key) {
            continue;
        }
        let image_bytes = match fetch_image_bytes(client, &request.id) {
            Ok(bytes) => bytes,
            Err(error) => {
                client.evaluate(&apply_image_error_script(&request.id, &error)?, false)?;
                update_status(status, |runtime| {
                    runtime.notice = format!("이미지를 읽지 못했습니다: {error}");
                });
                continue;
            }
        };
        if image_bytes.is_empty() {
            client.evaluate(
                &apply_image_error_script(&request.id, "이미지 데이터가 비어 있습니다.")?,
                false,
            )?;
            continue;
        }
        pending.insert(pending_key);
        update_status(status, |runtime| {
            runtime.notice =
                "이미지 OCR과 번역을 처리하고 있습니다. 최초 실행 시에는 모델 준비에 시간이 걸릴 수 있습니다."
                    .to_string();
        });
        worker
            .send(WorkerCommand::TranslateImage(ImageTranslationBatch {
                generation,
                target,
                image_id: request.id,
                source_key: request.source_key,
                image_bytes,
                quality,
                queued_at: Instant::now(),
            }))
            .map_err(|_| "Rust 이미지 번역 작업 스레드가 종료되었습니다.".to_string())?;
    }
    Ok(())
}

fn fetch_image_bytes(client: &mut CdpClient, image_id: &str) -> Result<Vec<u8>, String> {
    let script = fetch_image_data_script(image_id, MAX_IMAGE_BYTES)?;
    if let Ok(value) = client.evaluate(&script, true) {
        if !value.is_null() {
            let data = parse_image_data(value)?;
            if !data.base64.is_empty() {
                if data.base64.len() > MAX_IMAGE_BASE64_BYTES {
                    return Err("Discord 이미지가 허용 크기(20MB)를 초과했습니다.".to_string());
                }
                let decoded = BASE64.decode(data.base64.as_bytes()).map_err(|error| {
                    format!("Discord 이미지 Base64를 해석하지 못했습니다: {error}")
                })?;
                if decoded.len() > MAX_IMAGE_BYTES {
                    return Err("Discord 이미지가 허용 크기(20MB)를 초과했습니다.".to_string());
                }
                return Ok(decoded);
            }
        }
    }

    let info_value = client.evaluate(&image_capture_info_script(image_id)?, false)?;
    if info_value.is_null() {
        return Err("이미지 요소를 더 이상 찾을 수 없습니다.".to_string());
    }
    let info = parse_image_capture_info(info_value)?;
    if !info.fully_visible {
        return Err(
            "원본을 읽을 수 없습니다. 이미지 전체가 보이도록 조정한 후 다시 시도하십시오."
                .to_string(),
        );
    }
    client.evaluate(
        "(() => { const b=document.getElementById('nt-image-translate-button'); if(b) b.style.visibility='hidden'; })()",
        false,
    )?;
    let screenshot = (|| -> Result<serde_json::Value, String> {
        client.evaluate(
            "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
            true,
        )?;
        client.call(
            "Page.captureScreenshot",
            json!({
                "format": "png",
                "fromSurface": true,
                "captureBeyondViewport": false,
                "clip": {
                    "x": info.x,
                    "y": info.y,
                    "width": info.width,
                    "height": info.height,
                    "scale": info.scale
                }
            }),
        )
    })();
    let _ = client.evaluate(
        "(() => { const b=document.getElementById('nt-image-translate-button'); if(b) b.style.visibility=''; })()",
        false,
    );
    let encoded = screenshot?
        .get("data")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Discord 화면 캡처 결과가 비어 있습니다.".to_string())?
        .to_string();
    if encoded.len() > MAX_IMAGE_BASE64_BYTES {
        return Err("Discord 화면 캡처가 허용 크기(20MB)를 초과했습니다.".to_string());
    }
    let decoded = BASE64
        .decode(encoded.as_bytes())
        .map_err(|error| format!("Discord 화면 캡처 Base64를 해석하지 못했습니다: {error}"))?;
    if decoded.len() > MAX_IMAGE_BYTES {
        return Err("Discord 화면 캡처가 허용 크기(20MB)를 초과했습니다.".to_string());
    }
    Ok(decoded)
}

fn scan_dom(
    client: &mut CdpClient,
    states: &HashMap<Locator, PartState>,
    pending: &mut HashSet<PendingKey>,
    display_view: &mut DisplayViewState,
    generation: u64,
    target: Language,
    allowed_sources: Option<HashSet<Language>>,
    max_batch_items: usize,
    worker: &mpsc::Sender<WorkerCommand>,
) -> Result<bool, String> {
    let snapshot = parse_snapshot(client.evaluate(SNAPSHOT_SCRIPT, false)?)?;
    let context_scope = snapshot.url.clone();
    if display_view.observe(&snapshot.url, Instant::now()) == DisplayViewObservation::Changed {
        discard_stale_display_work(pending, display_view, generation, worker)?;
        return Ok(false);
    }
    let (changes, parts) = plan_dom_updates(
        snapshot.parts,
        states,
        pending,
        generation,
        display_view.epoch,
        max_batch_items,
    );
    if !changes.is_empty() {
        client.evaluate(&apply_script(&changes)?, false)?;
    }
    if !parts.is_empty() {
        worker
            .send(WorkerCommand::Translate(TranslationBatch {
                generation,
                view_epoch: display_view.epoch,
                view_scope: display_view.scope.clone(),
                target,
                allowed_sources,
                parts,
                context_scope,
                queued_at: Instant::now(),
            }))
            .map_err(|_| "Rust 번역 작업 스레드가 종료되었습니다.".to_string())?;
    }
    Ok(true)
}

fn prepare_display_view_for_dom(
    client: &mut CdpClient,
    pending: &mut HashSet<PendingKey>,
    display_view: &mut DisplayViewState,
    generation: u64,
    worker: &mpsc::Sender<WorkerCommand>,
) -> Result<bool, String> {
    let now = Instant::now();
    let current_url = client
        .evaluate("location.href", false)?
        .as_str()
        .ok_or_else(|| "Discord 화면 주소를 확인하지 못했습니다.".to_string())?
        .to_string();
    if display_view.observe(&current_url, now) == DisplayViewObservation::Changed {
        discard_stale_display_work(pending, display_view, generation, worker)?;
        return Ok(false);
    }
    Ok(display_view.is_ready(now))
}

fn discard_stale_display_work(
    pending: &mut HashSet<PendingKey>,
    display_view: &DisplayViewState,
    generation: u64,
    worker: &mpsc::Sender<WorkerCommand>,
) -> Result<(), String> {
    pending.clear();
    worker
        .send(WorkerCommand::DiscardDisplayBefore {
            generation,
            view_epoch: display_view.epoch,
        })
        .map_err(|_| "Rust 번역 작업 스레드가 종료되었습니다.".to_string())?;
    crate::diagnostics::info(
        "translation-viewport",
        &format!(
            "display view changed; epoch={}; DOM scan paused for {}ms",
            display_view.epoch,
            DISPLAY_VIEW_SETTLE_DELAY.as_millis()
        ),
    );
    Ok(())
}

fn plan_dom_updates(
    snapshot_parts: Vec<DomPart>,
    states: &HashMap<Locator, PartState>,
    pending: &mut HashSet<PendingKey>,
    generation: u64,
    view_epoch: u64,
    max_batch_items: usize,
) -> (Vec<DomChange>, Vec<DomPart>) {
    let mut changes = Vec::new();
    let mut parts = Vec::new();
    for mut part in snapshot_parts {
        let locator = part.locator();
        let rendered = part.rendered_text().to_string();
        if let Some(state) = states.get(&locator) {
            if rendered == state.translated {
                continue;
            }
            if rendered == state.original {
                changes.push(DomChange::new(&part, state.translated.clone()));
                continue;
            }
            // 같은 Discord 노드가 다른 메시지에 재사용되면 저장된 locator 원문보다
            // 현재 렌더링된 텍스트가 새로운 원문이야.
            part.text = rendered;
            part.displayed_text = None;
        }
        let pending_key = (
            generation,
            view_epoch,
            part.kind.clone(),
            part.item_id.clone(),
            part.index,
            part.text.clone(),
        );
        if pending.contains(&pending_key) {
            continue;
        }
        if parts.len() >= max_batch_items {
            let last_context = parts.last().and_then(incoming_context_key);
            let current_context = incoming_context_key(&part);
            let extends_message_context = current_context.as_deref().is_some_and(|key| {
                ["message:", "reply:", "embed:"]
                    .iter()
                    .any(|prefix| key.starts_with(prefix))
            }) && current_context == last_context
                && parts.len() < MAX_MESSAGE_CONTEXT_BATCH_ITEMS;
            if !extends_message_context {
                continue;
            }
        }
        pending.insert(pending_key);
        parts.push(part);
    }
    (changes, parts)
}

fn ensure_outgoing_originals(
    client: &mut CdpClient,
    store: Option<&TranslationCache>,
    ui_language: &str,
    display_translation_enabled: bool,
) -> Result<(), String> {
    let channel = client
        .evaluate(
            "location.pathname.startsWith('/channels/') ? location.pathname : ''",
            false,
        )?
        .as_str()
        .unwrap_or_default()
        .to_string();
    if channel.is_empty() {
        return Ok(());
    }
    let ready_key = format!("{channel}|{ui_language}|{display_translation_enabled}");
    let encoded_ready_key = serde_json::to_string(&ready_key)
        .map_err(|error| format!("Discord 채널 상태 식별자를 인코딩하지 못했습니다: {error}"))?;
    let ready = client.evaluate(
        &format!(
            "window.__nudeTranslatorOutgoingOriginalsReady === {encoded_ready_key} && window.__nudeTranslatorOutgoingOriginalDisplay?.version === {OUTGOING_ORIGINALS_UI_VERSION}"
        ),
        false,
    )?;
    if ready.as_bool() == Some(true) {
        client.evaluate("window.__nudeTranslatorApplyOutgoingOriginals?.()", false)?;
        return Ok(());
    }
    let records = store
        .and_then(|store| store.outgoing_originals_for_channel(&channel, 500).ok())
        .unwrap_or_default();
    client.evaluate(
        &outgoing_originals_ui_script(
            &channel,
            &records,
            ui_language,
            display_translation_enabled,
        )?,
        false,
    )?;
    Ok(())
}

fn scan_outgoing(
    client: &mut CdpClient,
    pending: &mut HashSet<OutgoingPendingKey>,
    generation: u64,
    worker: &mpsc::Sender<OutgoingWorkerCommand>,
    config: &AppConfig,
    original_store: Option<&TranslationCache>,
    channel_languages: &mut HashMap<String, String>,
) -> Result<Option<String>, String> {
    let requests = parse_outgoing_requests(client.evaluate(
        &outgoing_ui_script(
            config.outgoing_translation_enabled,
            config.enabled,
            &config.target_language,
            &config.outgoing_target_language,
            &config.ui_language,
            channel_languages,
            config.outgoing_confirm_send,
            &config.hotkeys.send_outgoing_immediately,
            &config.hotkeys.review_outgoing_before_send,
        ),
        false,
    )?)?;
    let bindings = parse_outgoing_bindings(client.evaluate(OUTGOING_BINDINGS_SCRIPT, false)?)?;
    if let Some(store) = original_store {
        for binding in &bindings {
            let _ = store.put_outgoing_original(binding);
        }
    }
    let mut requested_display_language = None;
    for request in requests {
        if request.action == "display-language" {
            if crate::language::is_supported_language_code(&request.selected_language) {
                requested_display_language = Some(request.selected_language);
            }
            continue;
        }
        if request.action == "remember-language" {
            if let Some(store) = original_store {
                store.set_outgoing_channel_language(
                    &request.channel_key,
                    &request.selected_language,
                )?;
            }
            channel_languages.insert(request.channel_key, request.selected_language);
            continue;
        }
        if request.id.is_empty() || request.text.trim().is_empty() {
            continue;
        }
        if request.action == "send-reviewed" {
            if let Err(error) = dispatch_outgoing_reviewed_send(client, &request.id, &request.text)
            {
                client.evaluate(&apply_outgoing_error_script(&request.id, &error)?, false)?;
            }
            continue;
        }
        if request.selected_language == "auto" {
            let suggestion = suggest_recent_language(&request.recent_messages);
            if let Some(target) = suggestion {
                client.evaluate(&apply_outgoing_detected_script(&request.id, target)?, false)?;
                enqueue_outgoing_translation(request, target, pending, generation, worker)?;
                continue;
            }
            client.evaluate(&apply_outgoing_suggestion_script(&request.id, None)?, false)?;
            continue;
        }
        if request.selected_language == "original" {
            if let Err(error) = dispatch_outgoing_send(client, &request.id, None) {
                client.evaluate(
                    &apply_outgoing_error_script(
                        &request.id,
                        &format!(
                            "메시지를 전송하지 못했습니다. 번역하지 않고 원문을 유지합니다. {error}"
                        ),
                    )?,
                    false,
                )?;
            }
            continue;
        }
        let target = match Language::try_from(request.selected_language.as_str()) {
            Ok(target) if target != Language::Unknown => target,
            _ => {
                client.evaluate(
                    &apply_outgoing_error_script(
                        &request.id,
                        "선택한 전송 언어를 사용할 수 없습니다. 번역하지 않고 원문을 유지합니다.",
                    )?,
                    false,
                )?;
                continue;
            }
        };
        enqueue_outgoing_translation(request, target, pending, generation, worker)?;
    }
    Ok(requested_display_language)
}

fn enqueue_outgoing_translation(
    request: OutgoingRequest,
    target: Language,
    pending: &mut HashSet<OutgoingPendingKey>,
    generation: u64,
    worker: &mpsc::Sender<OutgoingWorkerCommand>,
) -> Result<(), String> {
    let pending_key = (generation, request.id.clone());
    if !pending.insert(pending_key) {
        return Ok(());
    }
    worker
        .send(OutgoingWorkerCommand::Translate(OutgoingTranslationBatch {
            generation,
            target,
            request_id: request.id,
            text: request.text,
            send_immediately: request.send_immediately,
            queued_at: Instant::now(),
        }))
        .map_err(|_| "전송 메시지 통역 작업을 시작하지 못했습니다.".to_string())
}

fn dispatch_outgoing_send(
    client: &mut CdpClient,
    request_id: &str,
    replacement: Option<&str>,
) -> Result<(), String> {
    if let Some(text) = replacement {
        let utf16_units = text.encode_utf16().count();
        crate::diagnostics::info(
            "outgoing-translation",
            &format!(
                "dispatch prepared; utf16_units={utf16_units}; delivery={}",
                if utf16_units > DISCORD_MESSAGE_UTF16_LIMIT {
                    "attachment"
                } else {
                    "single-message"
                }
            ),
        );
    }
    if let Some(text) =
        replacement.filter(|text| text.encode_utf16().count() > DISCORD_MESSAGE_UTF16_LIMIT)
    {
        if dispatch_outgoing_text_file(client, request_id, text)? {
            return Ok(());
        }
        return Err(
            "장문 번역문을 텍스트 파일로 첨부하지 못했습니다. 원문은 입력창에 유지됩니다."
                .to_string(),
        );
    }

    let parts = replacement
        .map(|text| split_for_discord(text, DISCORD_MESSAGE_UTF16_LIMIT))
        .unwrap_or_else(|| vec![String::new()]);
    if parts.is_empty() || replacement.is_some_and(str::is_empty) {
        return Err("전송할 번역문이 없습니다.".to_string());
    }

    for (index, part) in parts.iter().enumerate() {
        let continuation = index > 0;
        let final_part = index + 1 == parts.len();
        let deadline = Instant::now() + Duration::from_secs(5);
        let prepared = loop {
            let prepared = client.evaluate(
                &prepare_outgoing_send_script(
                    request_id,
                    replacement.is_some(),
                    continuation,
                    final_part,
                    index + 1,
                    parts.len(),
                )?,
                false,
            )?;
            if prepared.as_bool() == Some(true) {
                break true;
            }
            if Instant::now() >= deadline {
                break false;
            }
            thread::sleep(Duration::from_millis(40));
        };
        if !prepared {
            return if index == 0 {
                Err(
                    "Discord 메시지 입력창을 찾을 수 없습니다. 원문은 입력창에 유지됩니다."
                        .to_string(),
                )
            } else {
                Err(format!(
                    "분할된 번역문 {}개 중 {index}개를 전송했습니다. 나머지 메시지는 입력창 상태를 확인한 후 다시 전송하십시오.",
                    parts.len()
                ))
            };
        }
        if replacement.is_some() {
            client.call("Input.insertText", json!({"text": part}))?;
        }
        let captured = client.evaluate(&capture_outgoing_send_script(request_id)?, false)?;
        if captured.as_bool() != Some(true) {
            return Err("전송 직전 메시지 내용을 보존하지 못했습니다.".to_string());
        }
        dispatch_enter(client)?;
        if !final_part {
            thread::sleep(Duration::from_millis(250));
        }
    }
    Ok(())
}

fn dispatch_outgoing_review(
    client: &mut CdpClient,
    request_id: &str,
    translated: &str,
) -> Result<(), String> {
    if translated.is_empty() {
        return Err("확인할 번역문이 없습니다.".to_string());
    }
    let prepared = client.evaluate(&apply_outgoing_review_script(request_id)?, false)?;
    if prepared.as_bool() != Some(true) {
        return Err("Discord 메시지 입력창을 찾을 수 없습니다. 원문은 유지됩니다.".to_string());
    }
    client.call("Input.insertText", json!({"text": translated}))?;
    let finished = client.evaluate(&finish_outgoing_review_script(request_id)?, false)?;
    if finished.as_bool() != Some(true) {
        return Err("번역문을 입력했지만 전송 대기 상태를 확정하지 못했습니다.".to_string());
    }
    Ok(())
}

fn dispatch_outgoing_reviewed_send(
    client: &mut CdpClient,
    request_id: &str,
    text: &str,
) -> Result<(), String> {
    if text.encode_utf16().count() > DISCORD_MESSAGE_UTF16_LIMIT {
        if dispatch_outgoing_text_file(client, request_id, text)? {
            return Ok(());
        }
        return Err("첨삭한 장문을 텍스트 파일로 전송하지 못했습니다.".to_string());
    }
    let prepared = client.evaluate(&prepare_outgoing_reviewed_send_script(request_id)?, false)?;
    if prepared.as_bool() != Some(true) {
        return Err("확인한 번역문을 전송할 입력창을 찾지 못했습니다.".to_string());
    }
    let captured = client.evaluate(&capture_outgoing_send_script(request_id)?, false)?;
    if captured.as_bool() != Some(true) {
        return Err("첨삭한 번역문의 전송 기록을 보존하지 못했습니다.".to_string());
    }
    dispatch_enter(client)
}

fn dispatch_outgoing_text_file(
    client: &mut CdpClient,
    request_id: &str,
    content: &str,
) -> Result<bool, String> {
    let prepared = client.evaluate(&prepare_outgoing_attachment_script(request_id)?, false)?;
    if prepared.as_bool() != Some(true) {
        return Ok(false);
    }

    dispatch_backspace(client)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let filename = format!("NudeNyangDiscordTranslator-translation-{timestamp}.txt");
    let attached = client.evaluate(
        &attach_outgoing_text_file_script(request_id, content, &filename)?,
        false,
    )?;
    if attached.as_bool() != Some(true) {
        return Ok(false);
    }

    // Discord가 change 이벤트로 첨부 파일을 읽고 전송 대기열을 만드는 시간을 확보합니다.
    thread::sleep(Duration::from_millis(700));
    dispatch_enter(client)?;
    Ok(true)
}

fn dispatch_backspace(client: &mut CdpClient) -> Result<(), String> {
    client.call(
        "Input.dispatchKeyEvent",
        json!({
            "type": "rawKeyDown",
            "key": "Backspace",
            "code": "Backspace",
            "windowsVirtualKeyCode": 8,
            "nativeVirtualKeyCode": 8
        }),
    )?;
    client.call(
        "Input.dispatchKeyEvent",
        json!({
            "type": "keyUp",
            "key": "Backspace",
            "code": "Backspace",
            "windowsVirtualKeyCode": 8,
            "nativeVirtualKeyCode": 8
        }),
    )?;
    Ok(())
}

fn dispatch_enter(client: &mut CdpClient) -> Result<(), String> {
    client.call(
        "Input.dispatchKeyEvent",
        json!({
            "type": "rawKeyDown",
            "key": "Enter",
            "code": "Enter",
            "windowsVirtualKeyCode": 13,
            "nativeVirtualKeyCode": 13
        }),
    )?;
    client.call(
        "Input.dispatchKeyEvent",
        json!({
            "type": "keyUp",
            "key": "Enter",
            "code": "Enter",
            "windowsVirtualKeyCode": 13,
            "nativeVirtualKeyCode": 13
        }),
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn drain_worker_results(
    results: &mpsc::Receiver<WorkerResult>,
    worker: &mpsc::Sender<WorkerCommand>,
    outgoing_worker: &mpsc::Sender<OutgoingWorkerCommand>,
    client: &mut Option<CdpClient>,
    states: &mut HashMap<Locator, PartState>,
    pending: &mut HashSet<PendingKey>,
    display_view: &DisplayViewState,
    image_pending: &mut HashSet<ImagePendingKey>,
    outgoing_pending: &mut HashSet<OutgoingPendingKey>,
    generation: &mut u64,
    preparation_generation: u64,
    target: Language,
    config: &AppConfig,
    status: &Arc<Mutex<RuntimeStatus>>,
    dictionary_store: Option<&DictionaryStore>,
    app: Option<&AppHandle>,
) {
    let mut changes = Vec::new();
    while let Ok(result) = results.try_recv() {
        match result {
            WorkerResult::Translated {
                generation: result_generation,
                view_epoch: result_view_epoch,
                view_scope: result_view_scope,
                target: result_target,
                parts,
                values,
            } => {
                for part in &parts {
                    pending.remove(&(
                        result_generation,
                        result_view_epoch,
                        part.kind.clone(),
                        part.item_id.clone(),
                        part.index,
                        part.text.clone(),
                    ));
                }
                let current_view_scope = client.as_mut().and_then(|client| {
                    client
                        .evaluate("location.href", false)
                        .ok()
                        .and_then(|value| value.as_str().map(display_view_scope))
                });
                if result_generation != *generation
                    || result_view_epoch != display_view.epoch
                    || result_view_scope != display_view.scope
                    || current_view_scope.as_deref() != Some(result_view_scope.as_str())
                    || result_target != target
                {
                    continue;
                }
                match values {
                    Ok(values) if values.len() == parts.len() => {
                        for (part, translated) in parts.into_iter().zip(values) {
                            states.insert(
                                part.locator(),
                                PartState {
                                    original: part.text.clone(),
                                    translated: translated.clone(),
                                },
                            );
                            if translated != part.text && config.enabled {
                                changes.push(DomChange::new(&part, translated));
                            }
                        }
                    }
                    Ok(_) => update_status(status, |runtime| {
                        runtime.notice =
                            "번역 서비스가 요청한 메시지 수와 다른 결과를 반환했습니다."
                                .to_string();
                    }),
                    Err(error) => update_status(status, |runtime| runtime.notice = error),
                }
            }
            WorkerResult::ImageTranslated {
                generation: result_generation,
                target: result_target,
                image_id,
                source_key,
                outcome,
            } => {
                image_pending.remove(&(result_generation, image_id.clone()));
                if result_generation != *generation || result_target != target {
                    continue;
                }
                let Some(client) = client.as_mut() else {
                    crate::diagnostics::warn(
                        "image-translation",
                        "Discord 연결이 끊어져 완료된 이미지 번역 결과를 적용하지 못했습니다.",
                    );
                    update_status(status, |runtime| {
                        runtime.notice =
                            "Discord 연결 후 이미지 번역을 다시 시도하십시오.".to_string();
                    });
                    continue;
                };
                match outcome {
                    Ok(outcome) if outcome.translated_count > 0 => {
                        let source = format!(
                            "data:image/png;base64,{}",
                            BASE64.encode(&outcome.png_bytes)
                        );
                        if let Ok(script) =
                            apply_image_result_script(&image_id, &source, &source_key)
                        {
                            let _ = client.evaluate(&script, true);
                        }
                        update_status(status, |runtime| {
                            runtime.notice = if outcome.used_cache {
                                "캐시된 이미지 번역을 적용했습니다.".to_string()
                            } else {
                                format!(
                                    "이미지에서 {}개 글자 영역을 번역했습니다.",
                                    outcome.translated_count
                                )
                            };
                        });
                    }
                    Ok(_) => {
                        let message = "번역할 이미지 텍스트를 찾지 못했습니다.";
                        if let Ok(script) = apply_image_error_script(&image_id, message) {
                            let _ = client.evaluate(&script, false);
                        }
                        update_status(status, |runtime| runtime.notice = message.to_string());
                    }
                    Err(error) => {
                        if let Ok(script) = apply_image_error_script(&image_id, &error) {
                            let _ = client.evaluate(&script, false);
                        }
                        update_status(status, |runtime| {
                            runtime.notice = format!("이미지 번역에 실패했습니다: {error}");
                        });
                    }
                }
            }
            WorkerResult::OutgoingTranslated {
                generation: result_generation,
                request_id,
                value,
                send_immediately,
            } => {
                outgoing_pending.remove(&(result_generation, request_id.clone()));
                if result_generation != *generation || !config.outgoing_translation_enabled {
                    continue;
                }
                let Some(client) = client.as_mut() else {
                    continue;
                };
                match value {
                    Ok(translated) => {
                        let delivery = if send_immediately {
                            dispatch_outgoing_send(client, &request_id, Some(&translated))
                        } else {
                            dispatch_outgoing_review(client, &request_id, &translated)
                        };
                        if let Err(error) = delivery {
                            crate::diagnostics::error("outgoing-translation", &error);
                            if let Ok(script) = apply_outgoing_error_script(
                                &request_id,
                                &format!("번역문을 모두 전송하지 못했습니다. {error}"),
                            ) {
                                let _ = client.evaluate(&script, false);
                            }
                        }
                    }
                    Err(error) => {
                        crate::diagnostics::error("outgoing-translation", &error);
                        if let Ok(script) = apply_outgoing_error_script(
                            &request_id,
                            &format!(
                                "메시지를 번역하지 못했습니다. 번역하지 않고 원문을 유지합니다. {error}"
                            ),
                        ) {
                            let _ = client.evaluate(&script, false);
                        }
                    }
                }
            }
            WorkerResult::DictionaryLocalized { request_id, result } => {
                if let Some(store) = dictionary_store {
                    if let Err(error) = store.cache_localized_result(&result) {
                        crate::diagnostics::warn("dictionary", &error);
                    }
                }
                if let Some(app) = app {
                    if let Err(error) = dictionary_window::show_result(
                        app,
                        &request_id,
                        result,
                        &config.ui_language,
                        config.dictionary_external_provider != "none",
                    ) {
                        crate::diagnostics::warn("dictionary-window", &error);
                    }
                } else if let Some(client) = client.as_mut() {
                    match apply_dictionary_result_script(&request_id, &result) {
                        Ok(script) => {
                            let _ = client.evaluate(&script, false);
                        }
                        Err(error) => crate::diagnostics::warn("dictionary", &error),
                    }
                }
            }
            WorkerResult::DisplayActivated {
                generation: activated_generation,
                name,
            } => {
                if activated_generation != preparation_generation || name != config.translator {
                    continue;
                }
                reset_translation_state(
                    client,
                    states,
                    pending,
                    image_pending,
                    outgoing_pending,
                    generation,
                );
                update_status(status, |runtime| {
                    runtime.active_translator = name;
                });
                finish_activation_status(status, config, worker, outgoing_worker);
            }
            WorkerResult::OutgoingActivated {
                generation: activated_generation,
                name,
            } => {
                if activated_generation != preparation_generation
                    || name != config.outgoing_translator
                {
                    continue;
                }
                update_status(status, |runtime| {
                    runtime.active_outgoing_translator = name;
                });
                finish_activation_status(status, config, worker, outgoing_worker);
            }
            WorkerResult::ActivationFailed {
                generation: failed_generation,
                lane,
                name,
                error,
            } => {
                if failed_generation != preparation_generation
                    || (lane == "display" && name != config.translator)
                    || (lane == "outgoing" && name != config.outgoing_translator)
                {
                    continue;
                }
                crate::diagnostics::error(
                    "translator",
                    &format!("model activation failed; lane={lane}; error={error}"),
                );
                update_status(status, |runtime| {
                    runtime.translator_state = "error".to_string();
                    runtime.translator_error = format!("번역 모델 준비 실패: {error}");
                    runtime.model_progress = None;
                    runtime.notice = runtime.translator_error.clone();
                });
            }
            WorkerResult::ModelProgress {
                generation: progress_generation,
                progress,
            } => {
                if progress_generation == preparation_generation {
                    update_status(status, |runtime| {
                        if progress.phase == "cpu-fallback" {
                            runtime.local_model_device = "cpu-fallback".to_string();
                            runtime.notice = "VRAM이 부족하거나 GPU를 사용할 수 없어 CPU/RAM 전용 모드로 전환했습니다.".to_string();
                        } else if progress.phase == "vram-protected" {
                            runtime.local_model_device = "vram-protected".to_string();
                            runtime.notice =
                                "다른 프로그램을 위해 VRAM을 확보하고 CPU/RAM으로 전환했습니다."
                                    .to_string();
                        } else if progress.phase == "gpu-restored" {
                            runtime.local_model_device = "auto".to_string();
                            runtime.notice =
                                "VRAM 여유가 안정적으로 회복되어 GPU 사용을 다시 시작합니다."
                                    .to_string();
                        }
                        runtime.model_progress = Some(progress);
                    });
                }
            }
            WorkerResult::WarmFailed(error) => {
                crate::diagnostics::error("translator", &format!("model warmup failed: {error}"));
                update_status(status, |runtime| {
                    runtime.notice = format!("로컬 모델 예열에 실패했습니다: {error}");
                });
            }
        }
    }
    if !changes.is_empty() {
        if let Some(client) = client.as_mut() {
            if let Ok(script) = apply_script(&changes) {
                let _ = client.evaluate(&script, false);
            }
        }
    }
}

fn finish_activation_status(
    status: &Arc<Mutex<RuntimeStatus>>,
    config: &AppConfig,
    worker: &mpsc::Sender<WorkerCommand>,
    outgoing_worker: &mpsc::Sender<OutgoingWorkerCommand>,
) {
    let mut release = false;
    update_status(status, |runtime| {
        let display_ready = runtime.active_translator == runtime.configured_translator
            || (!config.enabled
                && !config.dictionary_enabled
                && is_local_model_name(&runtime.configured_translator));
        let outgoing_ready = runtime.active_outgoing_translator
            == runtime.configured_outgoing_translator
            || (!config.outgoing_translation_enabled
                && is_local_model_name(&runtime.configured_outgoing_translator));
        if !display_ready || !outgoing_ready {
            return;
        }
        runtime.translator_state = "ready".to_string();
        runtime.translator_error.clear();
        runtime.model_progress = None;
        let model_is_prepared = !is_local_model_name(&runtime.active_translator)
            || config.enabled
            || config.dictionary_enabled
            || config.outgoing_translation_enabled
            || config.keep_local_model_warm;
        runtime.notice = if runtime.local_model_device == "vram-protected" {
            "다른 프로그램을 위해 VRAM을 확보하고 CPU/RAM으로 전환했습니다.".to_string()
        } else if runtime.local_model_device == "cpu-fallback" {
            "VRAM이 부족하거나 GPU를 사용할 수 없어 CPU/RAM 전용 모드로 전환했습니다.".to_string()
        } else if runtime.active_translator == runtime.active_outgoing_translator {
            translator_activation_notice(&runtime.active_translator, model_is_prepared)
        } else {
            format!(
                "표시 번역은 {}, 실시간 통역은 {}을 사용합니다.",
                translator_label(&runtime.active_translator),
                translator_label(&runtime.active_outgoing_translator)
            )
        };
        release = (is_local_model_name(&runtime.active_translator)
            || is_local_model_name(&runtime.active_outgoing_translator))
            && !config.enabled
            && !config.dictionary_enabled
            && !config.outgoing_translation_enabled
            && !config.keep_local_model_warm;
    });
    if release {
        let _ = worker.send(WorkerCommand::Release);
        let _ = outgoing_worker.send(OutgoingWorkerCommand::Release);
    }
}

fn run_translation_worker(
    commands: mpsc::Receiver<WorkerCommand>,
    results: mpsc::Sender<WorkerResult>,
) {
    let cache = match TranslationCache::open_default() {
        Ok(cache) => cache,
        Err(error) => {
            let _ = results.send(WorkerResult::WarmFailed(error));
            return;
        }
    };
    let mut service = TranslationService::new(Box::new(OriginalTranslator), cache);
    let mut image_processor = ImageTranslationProcessor::new();
    let mut backlog = VecDeque::new();
    loop {
        image_processor.release_ocr_if_idle(Instant::now());
        if backlog.is_empty() {
            match commands.recv_timeout(Duration::from_secs(30)) {
                Ok(command) => backlog.push_back(command),
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    image_processor.release_ocr_if_idle(Instant::now());
                    continue;
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        let Ok(command) = next_worker_command(&commands, &mut backlog) else {
            break;
        };
        match command {
            WorkerCommand::Translate(batch) => {
                log_worker_queue(
                    "display",
                    batch.queued_at,
                    batch.parts.len(),
                    batch
                        .parts
                        .iter()
                        .map(|part| part.text.chars().count())
                        .sum(),
                );
                let texts: Vec<String> = batch.parts.iter().map(|part| part.text.clone()).collect();
                let message_keys = batch
                    .parts
                    .iter()
                    .map(incoming_context_key)
                    .collect::<Vec<_>>();
                let values = service.translate_many_for_incoming_contextual_filtered(
                    &texts,
                    &message_keys,
                    &batch.context_scope,
                    batch.target,
                    batch.allowed_sources.as_ref(),
                );
                let _ = results.send(WorkerResult::Translated {
                    generation: batch.generation,
                    view_epoch: batch.view_epoch,
                    view_scope: batch.view_scope,
                    target: batch.target,
                    parts: batch.parts,
                    values,
                });
            }
            WorkerCommand::TranslateImage(batch) => {
                log_worker_queue("image", batch.queued_at, 1, batch.image_bytes.len());
                let outcome = image_processor.process(
                    &batch.image_bytes,
                    batch.target,
                    batch.quality,
                    &mut service,
                );
                let _ = results.send(WorkerResult::ImageTranslated {
                    generation: batch.generation,
                    target: batch.target,
                    image_id: batch.image_id,
                    source_key: batch.source_key,
                    outcome,
                });
            }
            WorkerCommand::LocalizeDictionary(batch) => {
                let DictionaryLocalizationBatch {
                    request_id,
                    target,
                    context,
                    result,
                    queued_at,
                } = batch;
                let selection_count = usize::from(result.needs_selection_translation());
                log_worker_queue(
                    "dictionary",
                    queued_at,
                    result.entries.len() + selection_count,
                    result
                        .entries
                        .iter()
                        .map(|entry| entry.definition.chars().count())
                        .sum::<usize>()
                        + if selection_count == 1 {
                            result.query.chars().count()
                        } else {
                            0
                        },
                );
                let result = localize_dictionary_result(&mut service, result, &context, target);
                let _ = results.send(WorkerResult::DictionaryLocalized { request_id, result });
            }
            WorkerCommand::DiscardDisplayBefore { .. } => {}
            WorkerCommand::Activate {
                generation,
                name,
                translator,
            } => {
                service.replace_translator(translator);
                let activation = service.translator_mut().prepare();
                match activation {
                    Ok(()) => {
                        let _ = results.send(WorkerResult::DisplayActivated { generation, name });
                    }
                    Err(error) => {
                        let _ = results.send(WorkerResult::ActivationFailed {
                            generation,
                            lane: "display",
                            name,
                            error,
                        });
                    }
                }
            }
            WorkerCommand::Warm => {
                if let Err(error) = service.translator_mut().prepare() {
                    let _ = results.send(WorkerResult::WarmFailed(error));
                }
            }
            WorkerCommand::Release => {
                service.translator_mut().close();
                image_processor.release_ocr();
            }
            WorkerCommand::ClearCacheMemory => {
                let _ = service.clear_cache_memory();
            }
            WorkerCommand::Stop => break,
        }
    }
}

fn localize_dictionary_result(
    service: &mut TranslationService,
    mut result: DictionaryLookupResult,
    context: &str,
    target: Language,
) -> DictionaryLookupResult {
    const DICTIONARY_LOCALIZATION_BATCH_ITEMS: usize = 2;

    #[derive(Clone, Copy)]
    enum LocalizationTarget {
        Selection,
        Context,
        Entry(usize),
    }

    result.localization_pending = false;
    let mut texts = Vec::new();
    let mut sources = Vec::new();
    let mut targets = Vec::new();
    let context = context.trim();
    let context_matches_selection = !context.is_empty() && context == result.query.trim();
    let detected_context_language = detect_language(context).language;
    let source_language =
        Language::try_from(result.source_language.as_str()).unwrap_or(Language::Unknown);
    let context_source = if detected_context_language == Language::Unknown {
        source_language
    } else {
        detected_context_language
    };
    let mut localized_context = if !context.is_empty() && context_source == target {
        context.to_string()
    } else {
        String::new()
    };
    let selection_needs_translation = result.needs_selection_translation();
    let mut contextual_focus = String::new();
    if selection_needs_translation
        && !context_matches_selection
        && !context.is_empty()
        && source_language != Language::Unknown
        && source_language != target
    {
        match service.translate_span_with_context(
            &result.query,
            context,
            source_language,
            target,
        ) {
            Ok((translated_selection, translated_context)) => {
                if dictionary_translation_is_acceptable(
                    &result.query,
                    &translated_selection,
                    target,
                ) {
                    contextual_focus = translated_selection.trim().to_string();
                } else {
                    log_rejected_dictionary_translation(
                        "contextual selection",
                        &result.query,
                        &translated_selection,
                        target,
                    );
                }
                if dictionary_translation_is_acceptable(context, &translated_context, target) {
                    localized_context = translated_context.trim().to_string();
                } else {
                    log_rejected_dictionary_translation(
                        "contextual sentence",
                        context,
                        &translated_context,
                        target,
                    );
                }
            }
            Err(error) => crate::diagnostics::warn(
                "dictionary",
                &format!(
                    "contextual selection translation failed; using separate translation: error={error}"
                ),
            ),
        }
    }
    if selection_needs_translation && result.selection_translation.is_empty() {
        texts.push(result.query.clone());
        sources.push(source_language);
        targets.push(LocalizationTarget::Selection);
    }
    if !context.is_empty()
        && !context_matches_selection
        && context_source != Language::Unknown
        && context_source != target
        && localized_context.is_empty()
    {
        texts.push(context.to_string());
        sources.push(context_source);
        targets.push(LocalizationTarget::Context);
    }

    for (index, entry) in result.entries.iter().enumerate() {
        if entry.definition.is_empty()
            || entry.definition_origin != "original"
            || entry.definition_language == result.target_language
        {
            continue;
        }
        texts.push(entry.definition.clone());
        sources.push(
            Language::try_from(entry.definition_language.as_str()).unwrap_or(Language::Unknown),
        );
        targets.push(LocalizationTarget::Entry(index));
    }

    for chunk_start in (0..texts.len()).step_by(DICTIONARY_LOCALIZATION_BATCH_ITEMS) {
        let chunk_end = (chunk_start + DICTIONARY_LOCALIZATION_BATCH_ITEMS).min(texts.len());
        let chunk_texts = &texts[chunk_start..chunk_end];
        let chunk_sources = &sources[chunk_start..chunk_end];
        let translated = match service.translate_many_with_sources(
            chunk_texts,
            chunk_sources,
            target,
        ) {
            Ok(translated) => translated.into_iter().map(Some).collect::<Vec<_>>(),
            Err(error) => {
                crate::diagnostics::warn(
                    "dictionary",
                    &format!(
                        "dictionary localization batch failed; retrying items separately: items={}; error={error}",
                        chunk_texts.len()
                    ),
                );
                chunk_texts
                    .iter()
                    .zip(chunk_sources)
                    .map(|(text, source)| {
                        match service.translate_many_with_sources(
                            std::slice::from_ref(text),
                            std::slice::from_ref(source),
                            target,
                        ) {
                            Ok(mut translated) => translated.pop(),
                            Err(item_error) => {
                                crate::diagnostics::warn(
                                    "dictionary",
                                    &format!(
                                        "dictionary localization item kept as original: chars={}; source={}; target={}; error={item_error}",
                                        text.chars().count(),
                                        source.code(),
                                        target.code()
                                    ),
                                );
                                None
                            }
                        }
                    })
                    .collect()
            }
        };

        for (offset, translated) in translated.into_iter().enumerate() {
            let Some(translated) = translated else {
                continue;
            };
            match targets[chunk_start + offset] {
                LocalizationTarget::Selection => {
                    if dictionary_translation_is_acceptable(&result.query, &translated, target) {
                        result.selection_translation = translated.trim().to_string();
                        if context_matches_selection {
                            localized_context = result.selection_translation.clone();
                        }
                    } else {
                        log_rejected_dictionary_translation(
                            "selection",
                            &result.query,
                            &translated,
                            target,
                        );
                    }
                }
                LocalizationTarget::Context => {
                    if dictionary_translation_is_acceptable(context, &translated, target) {
                        localized_context = translated.trim().to_string();
                    } else {
                        log_rejected_dictionary_translation(
                            "context",
                            context,
                            &translated,
                            target,
                        );
                    }
                }
                LocalizationTarget::Entry(index) => {
                    let entry = &mut result.entries[index];
                    if dictionary_translation_is_acceptable(&entry.definition, &translated, target)
                    {
                        entry.definition = translated.trim().to_string();
                        entry.definition_language = result.target_language.clone();
                        entry.definition_origin = "automatic".to_string();
                    } else {
                        log_rejected_dictionary_translation(
                            "gloss",
                            &entry.definition,
                            &translated,
                            target,
                        );
                    }
                }
            }
        }
    }
    if !localized_context.is_empty() {
        let mut ranking_focus = result.selection_translation.clone();
        if !contextual_focus.is_empty()
            && !contextual_focus.eq_ignore_ascii_case(&result.selection_translation)
        {
            if !ranking_focus.is_empty() {
                ranking_focus.push(' ');
            }
            ranking_focus.push_str(&contextual_focus);
        }
        if !ranking_focus.is_empty() && source_language != target {
            result.rerank_for_localized_context(&localized_context, &ranking_focus);
        } else {
            result.rerank_for_context(&localized_context);
        }
    }
    result
}

fn log_rejected_dictionary_translation(
    kind: &str,
    source: &str,
    translated: &str,
    target: Language,
) {
    crate::diagnostics::warn(
        "dictionary",
        &format!(
            "dictionary {kind} translation rejected by quality gate: source_chars={}; translated_chars={}; target={}",
            source.chars().count(),
            translated.chars().count(),
            target.code()
        ),
    );
}

fn dictionary_translation_is_acceptable(source: &str, translated: &str, target: Language) -> bool {
    let source = source.trim();
    let translated = translated.trim();
    if source.is_empty()
        || translated.is_empty()
        || source == translated
        || target == Language::Unknown
    {
        return false;
    }
    let source_length = source.chars().count();
    let translated_length = translated.chars().count();
    let maximum_length = source_length.saturating_mul(6).saturating_add(80).min(800);
    if translated_length > maximum_length {
        return false;
    }
    let lowered = translated.to_lowercase();
    if [
        "translation:",
        "translated text:",
        "answer:",
        "result:",
        "번역:",
        "뜻:",
    ]
    .iter()
    .any(|prefix| lowered.starts_with(prefix))
        || lowered.contains("```")
        || lowered.contains("<|")
        || lowered.contains("here is the translation")
    {
        return false;
    }
    dictionary_target_script_is_present(translated, target)
}

fn dictionary_target_script_is_present(text: &str, target: Language) -> bool {
    let in_range = |character: char, start: char, end: char| (start..=end).contains(&character);
    text.chars().any(|character| match target {
        Language::Korean => in_range(character, '\u{ac00}', '\u{d7af}'),
        Language::Japanese => {
            in_range(character, '\u{3040}', '\u{30ff}')
                || in_range(character, '\u{3400}', '\u{9fff}')
        }
        Language::ChineseSimplified | Language::ChineseTraditional => {
            in_range(character, '\u{3400}', '\u{9fff}')
        }
        Language::Hindi => in_range(character, '\u{0900}', '\u{097f}'),
        Language::Russian | Language::Ukrainian => in_range(character, '\u{0400}', '\u{052f}'),
        Language::Arabic | Language::Urdu | Language::Persian => {
            in_range(character, '\u{0600}', '\u{06ff}')
                || in_range(character, '\u{0750}', '\u{077f}')
        }
        Language::Thai => in_range(character, '\u{0e00}', '\u{0e7f}'),
        Language::Bengali => in_range(character, '\u{0980}', '\u{09ff}'),
        Language::Tamil => in_range(character, '\u{0b80}', '\u{0bff}'),
        Language::Hebrew => in_range(character, '\u{0590}', '\u{05ff}'),
        Language::English
        | Language::BrazilianPortuguese
        | Language::LatinAmericanSpanish
        | Language::German
        | Language::French
        | Language::Indonesian
        | Language::Vietnamese
        | Language::Polish
        | Language::Turkish
        | Language::Italian
        | Language::Dutch
        | Language::Malay
        | Language::Filipino
        | Language::Czech => {
            character.is_ascii_alphabetic() || in_range(character, '\u{00c0}', '\u{024f}')
        }
        Language::Unknown => false,
    })
}

fn incoming_context_key(part: &DomPart) -> Option<String> {
    match part.kind.as_str() {
        "message" | "reply" | "embed" => Some(format!(
            "{}:{}",
            part.kind,
            part.context_id.as_deref().unwrap_or(&part.item_id)
        )),
        "channel" | "category" => Some("navigation".to_string()),
        "invite-context" => Some("invite-context".to_string()),
        "event-context" => Some("event-context".to_string()),
        "browse-channel" => Some("browse-navigation".to_string()),
        _ => None,
    }
}

fn cdp_attach_text_scripts() -> [&'static str; 3] {
    [
        RESTORE_TEXT_SCRIPT,
        CLEAR_TEXT_REGISTRY_SCRIPT,
        INSTALL_TEXT_RESTORE_SCRIPT,
    ]
}

fn run_outgoing_translation_worker(
    commands: mpsc::Receiver<OutgoingWorkerCommand>,
    results: mpsc::Sender<WorkerResult>,
) {
    let cache = match TranslationCache::open_default() {
        Ok(cache) => cache,
        Err(error) => {
            let _ = results.send(WorkerResult::WarmFailed(error));
            return;
        }
    };
    let mut service = TranslationService::new(Box::new(OriginalTranslator), cache);
    while let Ok(command) = commands.recv() {
        match command {
            OutgoingWorkerCommand::Translate(batch) => {
                log_worker_queue("outgoing", batch.queued_at, 1, batch.text.chars().count());
                let send_immediately = batch.send_immediately;
                let value = service.translate_for_discord(&batch.text, batch.target);
                let _ = results.send(WorkerResult::OutgoingTranslated {
                    generation: batch.generation,
                    request_id: batch.request_id,
                    value,
                    send_immediately,
                });
            }
            OutgoingWorkerCommand::Activate {
                generation,
                name,
                translator,
            } => {
                service.replace_translator(translator);
                match service.translator_mut().prepare() {
                    Ok(()) => {
                        let _ = results.send(WorkerResult::OutgoingActivated { generation, name });
                    }
                    Err(error) => {
                        let _ = results.send(WorkerResult::ActivationFailed {
                            generation,
                            lane: "outgoing",
                            name,
                            error,
                        });
                    }
                }
            }
            OutgoingWorkerCommand::Warm => {
                if let Err(error) = service.translator_mut().prepare() {
                    let _ = results.send(WorkerResult::WarmFailed(error));
                }
            }
            OutgoingWorkerCommand::Release => service.translator_mut().close(),
            OutgoingWorkerCommand::ClearCacheMemory => {
                let _ = service.clear_cache_memory();
            }
            OutgoingWorkerCommand::Stop => break,
        }
    }
}

fn log_worker_queue(lane: &str, queued_at: Instant, items: usize, chars: usize) {
    crate::diagnostics::info(
        "translation-queue-latency",
        &format!(
            "lane={lane}; queue_wait_ms={}; items={items}; chars={chars}",
            queued_at.elapsed().as_millis()
        ),
    );
}

fn request_translator_preparation(
    config: &AppConfig,
    plan: TranslatorPreparationPlan,
    sender: &mpsc::Sender<PreparationResult>,
    progress_sender: &mpsc::Sender<WorkerResult>,
    status: &Arc<Mutex<RuntimeStatus>>,
    generation: &mut u64,
    cancellation_slot: &mut Option<ModelPreparationCancellation>,
) {
    let preparation_is_active = status
        .lock()
        .is_ok_and(|runtime| runtime.model_progress.is_some());
    if preparation_is_active {
        if let Some(previous) = cancellation_slot.take() {
            previous.cancel();
        }
    }
    let cancellation = ModelPreparationCancellation::default();
    *cancellation_slot = Some(cancellation.clone());
    *generation += 1;
    let current_generation = *generation;
    let config = config.clone();
    let display_name = config.translator.clone();
    let outgoing_name = config.outgoing_translator.clone();
    update_status(status, |runtime| {
        runtime.configured_translator = display_name.clone();
        runtime.configured_outgoing_translator = outgoing_name.clone();
        if plan.display {
            runtime.translator_state = "preparing".to_string();
            runtime.translator_error.clear();
        }
        runtime.local_model_device = config.hymt_device.clone();
        let preparing_name = if plan.display {
            &display_name
        } else {
            &outgoing_name
        };
        runtime.model_progress = initial_model_preparation_progress(preparing_name);
        runtime.notice = format!(
            "{} 준비를 백그라운드에서 시작했습니다. 완료 전까지 현재 모델로 계속 번역합니다.",
            translator_label(preparing_name)
        );
    });
    let sender = sender.clone();
    let progress_sender = progress_sender.clone();
    thread::spawn(move || {
        let observer: ModelProgressObserver = Arc::new(move |progress| {
            let _ = progress_sender.send(WorkerResult::ModelProgress {
                generation: current_generation,
                progress,
            });
        });
        let result = (|| {
            let display_translator = if plan.display {
                Some(make_translator(
                    &config,
                    &display_name,
                    Some(observer.clone()),
                    Some(cancellation.clone()),
                )?)
            } else {
                None
            };
            let outgoing_translator = if plan.outgoing {
                Some(make_translator(
                    &config,
                    &outgoing_name,
                    Some(observer),
                    Some(cancellation.clone()),
                )?)
            } else {
                None
            };
            Ok((display_translator, outgoing_translator))
        })();
        let message = match result {
            Ok((display_translator, outgoing_translator)) => PreparationResult::Ready {
                generation: current_generation,
                display_name,
                outgoing_name,
                display_translator,
                outgoing_translator,
            },
            Err(error) => PreparationResult::Failed {
                generation: current_generation,
                display_name,
                outgoing_name,
                error,
            },
        };
        let _ = sender.send(message);
    });
}

fn make_translator(
    config: &AppConfig,
    name: &str,
    progress_observer: Option<ModelProgressObserver>,
    preparation_cancellation: Option<ModelPreparationCancellation>,
) -> Result<Box<dyn Translator>, String> {
    if let Some(model_size) = HyMtModelSize::from_config_id(name) {
        return make_local_translator(
            config,
            model_size,
            progress_observer,
            preparation_cancellation,
        );
    }
    match name {
        "chatgpt" | "claude" | "gemini" => Ok(Box::new(ResilientTranslator::new(
            Box::new(SubscriptionCliTranslator::new(
                name,
                "auto",
                120,
                cache_root(),
            )?),
            None,
        ))),
        "deepl" => Ok(Box::new(ResilientTranslator::new(
            Box::new(DeepLTranslator::new(None, Duration::from_secs(30))?),
            None,
        ))),
        "mock" => Ok(Box::new(MockTranslator)),
        "original" => Ok(Box::new(OriginalTranslator)),
        other => Err(format!("지원하지 않는 번역 모델입니다: {other}")),
    }
}

fn make_local_translator(
    config: &AppConfig,
    model_size: HyMtModelSize,
    progress_observer: Option<ModelProgressObserver>,
    preparation_cancellation: Option<ModelPreparationCancellation>,
) -> Result<Box<dyn Translator>, String> {
    let translator = HyMtTranslator::new(model_size, config.hymt_device.clone(), "auto")?;
    let translator = if let Some(cancellation) = preparation_cancellation {
        translator.with_preparation_cancellation(cancellation)
    } else {
        translator
    };
    let translator = if let Some(observer) = progress_observer {
        translator.with_progress_observer(observer)
    } else {
        translator
    };
    Ok(Box::new(ResilientTranslator::new(
        Box::new(translator),
        None,
    )))
}

fn cache_root() -> PathBuf {
    default_config_path()
        .parent()
        .map(|path| path.join("Cache"))
        .unwrap_or_else(|| PathBuf::from("Cache"))
}

fn reset_translation_state(
    client: &mut Option<CdpClient>,
    states: &mut HashMap<Locator, PartState>,
    pending: &mut HashSet<PendingKey>,
    image_pending: &mut HashSet<ImagePendingKey>,
    outgoing_pending: &mut HashSet<OutgoingPendingKey>,
    generation: &mut u64,
) {
    restore(client, states, true);
    states.clear();
    pending.clear();
    image_pending.clear();
    outgoing_pending.clear();
    *generation += 1;
}

fn restore(
    client: &mut Option<CdpClient>,
    states: &HashMap<Locator, PartState>,
    discard_images: bool,
) {
    let changes: Vec<DomChange> = states
        .iter()
        .map(|((kind, item_id, index), state)| DomChange {
            kind: kind.clone(),
            id: item_id.clone(),
            index: *index,
            text: state.original.clone(),
        })
        .collect();
    if let Some(client) = client.as_mut() {
        let _ = client.evaluate(RESTORE_TEXT_SCRIPT, false);
        if !changes.is_empty() {
            if let Ok(script) = apply_script(&changes) {
                let _ = client.evaluate(&script, false);
            }
        }
        let _ = client.evaluate(CLEAR_TEXT_REGISTRY_SCRIPT, false);
        let _ = client.evaluate(&restore_images_script(discard_images), false);
    }
}

fn poll_interval(capture_fps: u32) -> Duration {
    Duration::from_secs_f64(1.0 / capture_fps.clamp(2, 20) as f64)
}

fn display_translation_is_ready(config: &AppConfig, active_translator: &str) -> bool {
    config.enabled && active_translator == config.translator
}

fn incoming_allowed_sources(config: &AppConfig) -> Option<HashSet<Language>> {
    (config.incoming_language_mode == "selected").then(|| {
        config
            .incoming_source_languages
            .iter()
            .filter_map(|code| Language::try_from(code.as_str()).ok())
            .collect()
    })
}

fn translator_label(name: &str) -> &str {
    if let Some(model_size) = HyMtModelSize::from_config_id(name) {
        return model_size.runtime_label();
    }
    match name {
        "chatgpt" => "ChatGPT 품질 우선 (Codex CLI)",
        "claude" => "Claude 품질 우선 (Claude Code)",
        "gemini" => "Gemini 품질 우선 (Antigravity CLI)",
        "deepl" => "DeepL 품질 우선 (API)",
        "mock" => "Mock 테스트",
        _ => "원문 표시",
    }
}

fn is_local_model_name(name: &str) -> bool {
    HyMtModelSize::from_config_id(name).is_some()
}

fn display_batch_item_limit(config: &AppConfig) -> usize {
    if config.hymt_device == "cpu" && is_local_model_name(&config.translator) {
        CPU_MAX_BATCH_ITEMS
    } else {
        MAX_BATCH_ITEMS
    }
}

fn display_view_scope(url: &str) -> String {
    let without_fragment = url.split('#').next().unwrap_or(url);
    let without_query = without_fragment
        .split('?')
        .next()
        .unwrap_or(without_fragment);
    let Some(scheme_index) = without_query.find("://") else {
        return without_query.to_string();
    };
    let authority_and_path = &without_query[scheme_index + 3..];
    authority_and_path
        .find('/')
        .map(|path_index| authority_and_path[path_index..].to_string())
        .unwrap_or_else(|| "/".to_string())
}

fn translator_activation_notice(name: &str, model_is_prepared: bool) -> String {
    if is_local_model_name(name) && !model_is_prepared {
        format!(
            "선택한 번역 모델: {}. 번역을 켜면 모델을 준비합니다.",
            translator_label(name)
        )
    } else {
        format!(
            "선택한 번역 모델: {}. 번역 준비가 완료되었습니다.",
            translator_label(name)
        )
    }
}

fn update_status(status: &Arc<Mutex<RuntimeStatus>>, update: impl FnOnce(&mut RuntimeStatus)) {
    if let Ok(mut status) = status.lock() {
        update(&mut status);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        cdp_attach_text_scripts, dictionary_source_language, dictionary_translation_is_acceptable,
        display_batch_item_limit, display_preparation_is_required, display_translation_is_ready,
        display_view_scope, incoming_context_key, initial_model_preparation_progress,
        localize_dictionary_result, next_worker_command, plan_dom_updates, poll_interval,
        preparation_plan_for_active_lanes, run_outgoing_translation_worker,
        stage_dictionary_lookup_result, translator_activation_notice, translator_label,
        translator_preparation_plan, DictionaryLocalizationBatch, DisplayViewObservation,
        DisplayViewState, OutgoingTranslationBatch, OutgoingWorkerCommand, PartState,
        RuntimeStatus, RustEngine, TranslationBatch, TranslatorPreparationPlan, WorkerCommand,
        WorkerResult, CPU_MAX_BATCH_ITEMS, DISPLAY_VIEW_SETTLE_DELAY, MAX_BATCH_ITEMS,
    };
    use crate::cache::TranslationCache;
    use crate::cdp::{discord_target, CdpClient};
    use crate::config::AppConfig;
    use crate::dictionary::{DictionaryEntry, DictionaryLookupResult};
    use crate::dom::{
        apply_script, parse_snapshot, DomChange, DomPart, CLEAR_TEXT_REGISTRY_SCRIPT,
        INSTALL_TEXT_RESTORE_SCRIPT, RESTORE_TEXT_SCRIPT, SNAPSHOT_SCRIPT,
    };
    use crate::language::{detect_explicit_language, Language};
    use crate::translation::{TranslationService, Translator};
    use std::collections::{HashMap, HashSet, VecDeque};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{mpsc, Arc};
    use std::thread;
    use std::time::{Duration, Instant};

    struct DictionaryTestTranslator;

    impl Translator for DictionaryTestTranslator {
        fn display_name(&self) -> &str {
            "Dictionary test translator"
        }

        fn cache_namespace(&self) -> &str {
            "dictionary-test:v1"
        }

        fn translate(
            &mut self,
            text: &str,
            _source: Language,
            target: Language,
        ) -> Result<String, String> {
            Ok(match target {
                Language::Japanese => "現在より後の時間、またはこれから起こる出来事。".to_string(),
                Language::Korean if text == "time" => "시간".to_string(),
                _ => text.to_string(),
            })
        }
    }

    struct CountingDictionaryBatchTranslator {
        calls: Arc<AtomicUsize>,
        items: Arc<AtomicUsize>,
    }

    struct ContextDictionaryTranslator;

    impl Translator for ContextDictionaryTranslator {
        fn display_name(&self) -> &str {
            "Context dictionary test translator"
        }

        fn cache_namespace(&self) -> &str {
            "dictionary-context-test:v1"
        }

        fn translate(
            &mut self,
            text: &str,
            _source: Language,
            _target: Language,
        ) -> Result<String, String> {
            Ok(match text {
                text if text.contains("<NTSPLIT>") && text.contains("river") => {
                    "그는 강의 <NTSPLIT> 물가 <NTSPLIT> 에 앉아 물을 바라봤다"
                }
                text if text.contains("<NTSPLIT>")
                    && text.contains("do not")
                    && text.contains("share") =>
                {
                    "다른 사람의 창작물을 <NTSPLIT> 공유하지 마세요 <NTSPLIT> ."
                }
                text if text.contains("<NTSPLIT>") && text.contains("share") => {
                    "회원들은 <NTSPLIT> 공유 <NTSPLIT> 사진을 공동체와 나눌 수 있다"
                }
                "share" => "공유",
                "bank" => "둑",
                "He sat on the river bank and watched the water." => {
                    "그는 강의 물가에 앉아 물을 바라봤다"
                }
                "a financial institution that holds money" => "돈을 보관하는 금융 기관",
                "sloping land beside a river" => "강의 물가에 있는 경사진 땅",
                "assets belonging to or contributed by an individual or group" => {
                    "개인이나 집단이 소유하거나 기여한 자산"
                }
                "communicate information with other people" => "다른 사람과 정보를 공유하다",
                _ => text,
            }
            .to_string())
        }
    }

    impl Translator for CountingDictionaryBatchTranslator {
        fn display_name(&self) -> &str {
            "Counting dictionary batch translator"
        }

        fn cache_namespace(&self) -> &str {
            "dictionary-batch-test:v1"
        }

        fn translate(
            &mut self,
            _text: &str,
            _source: Language,
            _target: Language,
        ) -> Result<String, String> {
            Err("사전 번역은 단건 호출을 사용하면 안 됩니다.".to_string())
        }

        fn translate_many(
            &mut self,
            items: &[(String, Language)],
            _target: Language,
        ) -> Result<Vec<String>, String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.items.fetch_add(items.len(), Ordering::SeqCst);
            if items.len() > 2 {
                return Err("Hy-MT2 테스트 서버가 큰 사전 묶음을 거부했습니다.".to_string());
            }
            Ok(items
                .iter()
                .map(|(text, source)| match source {
                    Language::Japanese => "출시 기념으로 할인합니다".to_string(),
                    Language::English if text.contains("release") => "출시; 발매".to_string(),
                    Language::English => "판매; 할인 판매".to_string(),
                    _ => "번역 결과".to_string(),
                })
                .collect())
        }
    }

    #[test]
    fn runtime_status_starts_with_the_configured_contract() {
        let config = AppConfig::default();
        let status = RuntimeStatus::new(&config);
        assert_eq!(status.engine, "rust-native");
        assert_eq!(status.configured_translator, "hymt_1_8b");
        assert_eq!(status.active_translator, "original");
    }

    #[test]
    fn dictionary_lookup_prefers_selected_japanese_over_unrelated_context() {
        let language = dictionary_source_language(
            "",
            "方針変更、またはプレイヤーからの通報などの影響により、",
            "關於突然轉為非公開的說明，並收到了官方警告通知。",
        );
        assert_eq!(language.as_deref(), Some("ja"));
    }

    #[test]
    fn dictionary_lookup_uses_nearby_japanese_for_ambiguous_han_selection() {
        let language = dictionary_source_language(
            "",
            "日本時間",
            "日本時間3/17の午後にSuRroomはシステムによって自動的に変更されました。",
        );
        assert_eq!(language.as_deref(), Some("ja"));
    }

    #[test]
    fn dictionary_lookup_returns_local_entries_while_localization_is_pending() {
        let result = DictionaryLookupResult {
            query: "発売記念".to_string(),
            source_language: "ja".to_string(),
            target_language: "ko".to_string(),
            selection_translation: String::new(),
            localization_pending: false,
            segmented: false,
            entries: Vec::new(),
            personal_entries: Vec::new(),
        };

        let (immediate, pending) = stage_dictionary_lookup_result(result, true);

        assert!(immediate.localization_pending);
        assert!(immediate.selection_translation.is_empty());
        assert!(pending.is_some());
        assert!(!pending.unwrap().localization_pending);
    }

    #[test]
    fn dictionary_gloss_localization_marks_the_translation_and_keeps_the_original() {
        let cache_path = std::env::temp_dir().join(format!(
            "nudenyang-dictionary-localization-cache-{}.db",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&cache_path);
        let cache = TranslationCache::open(cache_path, 16).unwrap();
        let mut service = TranslationService::new(Box::new(DictionaryTestTranslator), cache);
        let result = DictionaryLookupResult {
            query: "future".to_string(),
            source_language: "en".to_string(),
            target_language: "ja".to_string(),
            selection_translation: String::new(),
            localization_pending: false,
            segmented: false,
            entries: vec![DictionaryEntry {
                entry_id: 1,
                headword: "future".to_string(),
                language: "en".to_string(),
                reading: String::new(),
                part_of_speech: "noun".to_string(),
                sense_rank: 0,
                source_priority: 0,
                context_recommended: false,
                definition: "The time after the present.".to_string(),
                definition_language: "en".to_string(),
                definition_origin: "original".to_string(),
                original_definition: "The time after the present.".to_string(),
                original_definition_language: "en".to_string(),
                example: String::new(),
                source_name: "Test".to_string(),
                source_url: String::new(),
                license: "Test".to_string(),
            }],
            personal_entries: Vec::new(),
        };

        let localized =
            localize_dictionary_result(&mut service, result, "future", Language::Japanese);
        assert_eq!(
            localized.entries[0].definition,
            "現在より後の時間、またはこれから起こる出来事。"
        );
        assert_eq!(
            localized.selection_translation,
            "現在より後の時間、またはこれから起こる出来事"
        );
        assert_eq!(localized.entries[0].definition_language, "ja");
        assert_eq!(localized.entries[0].definition_origin, "automatic");
        assert_eq!(
            localized.entries[0].original_definition,
            "The time after the present."
        );
    }

    #[test]
    fn dictionary_gloss_localization_translates_short_known_english_meanings() {
        let cache_path = std::env::temp_dir().join(format!(
            "nudenyang-dictionary-short-localization-cache-{}.db",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&cache_path);
        let cache = TranslationCache::open(cache_path, 16).unwrap();
        let mut service = TranslationService::new(Box::new(DictionaryTestTranslator), cache);
        let result = DictionaryLookupResult {
            query: "日本時間".to_string(),
            source_language: "ja".to_string(),
            target_language: "ko".to_string(),
            selection_translation: String::new(),
            localization_pending: false,
            segmented: true,
            entries: vec![DictionaryEntry {
                entry_id: 1,
                headword: "時間".to_string(),
                language: "ja".to_string(),
                reading: "じかん".to_string(),
                part_of_speech: "noun".to_string(),
                sense_rank: 0,
                source_priority: 0,
                context_recommended: false,
                definition: "time".to_string(),
                definition_language: "en".to_string(),
                definition_origin: "original".to_string(),
                original_definition: "time".to_string(),
                original_definition_language: "en".to_string(),
                example: String::new(),
                source_name: "JMdict".to_string(),
                source_url: String::new(),
                license: "CC-BY-SA-4.0".to_string(),
            }],
            personal_entries: Vec::new(),
        };

        let localized =
            localize_dictionary_result(&mut service, result, "日本時間", Language::Korean);
        assert_eq!(localized.entries[0].definition, "시간");
        assert_eq!(localized.entries[0].definition_language, "ko");
        assert_eq!(localized.entries[0].definition_origin, "automatic");
    }

    #[test]
    fn dictionary_localization_splits_selection_and_all_visible_senses_into_safe_batches() {
        let cache_path = std::env::temp_dir().join(format!(
            "nudenyang-dictionary-batch-localization-cache-{}.db",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&cache_path);
        let cache = TranslationCache::open(cache_path, 16).unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let items = Arc::new(AtomicUsize::new(0));
        let translator = CountingDictionaryBatchTranslator {
            calls: calls.clone(),
            items: items.clone(),
        };
        let mut service = TranslationService::new(Box::new(translator), cache);
        let sense = |entry_id, sense_rank, definition: &str| DictionaryEntry {
            entry_id,
            headword: "発売".to_string(),
            language: "ja".to_string(),
            reading: "はつばい".to_string(),
            part_of_speech: "noun".to_string(),
            sense_rank,
            source_priority: 0,
            context_recommended: false,
            definition: definition.to_string(),
            definition_language: "en".to_string(),
            definition_origin: "original".to_string(),
            original_definition: definition.to_string(),
            original_definition_language: "en".to_string(),
            example: String::new(),
            source_name: "JMdict".to_string(),
            source_url: String::new(),
            license: "CC-BY-SA-4.0".to_string(),
        };
        let result = DictionaryLookupResult {
            query: "発売記念でセールします".to_string(),
            source_language: "ja".to_string(),
            target_language: "ko".to_string(),
            selection_translation: String::new(),
            localization_pending: true,
            segmented: false,
            entries: vec![
                sense(1, 0, "sale; offering for sale"),
                sense(2, 1, "release; publication"),
            ],
            personal_entries: Vec::new(),
        };

        let localized = localize_dictionary_result(
            &mut service,
            result,
            "発売記念でセールします",
            Language::Korean,
        );

        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(items.load(Ordering::SeqCst), 3);
        assert!(!localized.localization_pending);
        assert_eq!(localized.selection_translation, "출시 기념으로 할인합니다");
        assert_eq!(localized.entries[0].definition, "출시; 발매");
        assert_eq!(localized.entries[0].definition_origin, "automatic");
        assert!(localized.entries[0].context_recommended);
        assert_eq!(localized.entries[1].definition, "판매; 할인 판매");
        assert_eq!(localized.entries[1].definition_language, "ko");
        assert_eq!(localized.entries[1].definition_origin, "automatic");
    }

    #[test]
    fn dictionary_localization_reranks_with_the_full_translated_context() {
        let cache_path = std::env::temp_dir().join(format!(
            "nudenyang-dictionary-context-localization-cache-{}.db",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&cache_path);
        let cache = TranslationCache::open(cache_path, 16).unwrap();
        let mut service = TranslationService::new(Box::new(ContextDictionaryTranslator), cache);
        let sense = |entry_id, sense_rank, definition: &str| DictionaryEntry {
            entry_id,
            headword: "bank".to_string(),
            language: "en".to_string(),
            reading: String::new(),
            part_of_speech: "noun".to_string(),
            sense_rank,
            source_priority: 0,
            context_recommended: false,
            definition: definition.to_string(),
            definition_language: "en".to_string(),
            definition_origin: "original".to_string(),
            original_definition: definition.to_string(),
            original_definition_language: "en".to_string(),
            example: String::new(),
            source_name: "Test".to_string(),
            source_url: String::new(),
            license: "Test".to_string(),
        };
        let result = DictionaryLookupResult {
            query: "bank".to_string(),
            source_language: "en".to_string(),
            target_language: "ko".to_string(),
            selection_translation: String::new(),
            localization_pending: true,
            segmented: false,
            entries: vec![
                sense(1, 0, "a financial institution that holds money"),
                sense(2, 1, "sloping land beside a river"),
            ],
            personal_entries: Vec::new(),
        };

        let localized = localize_dictionary_result(
            &mut service,
            result,
            "He sat on the river bank and watched the water.",
            Language::Korean,
        );

        assert_eq!(localized.selection_translation, "둑");
        assert_eq!(
            localized.entries[0].definition,
            "강의 물가에 있는 경사진 땅"
        );
        assert!(localized.entries[0].context_recommended);
    }

    #[test]
    fn dictionary_localization_uses_contextual_focus_to_promote_share_as_a_verb() {
        let cache_path = std::env::temp_dir().join(format!(
            "nudenyang-dictionary-share-context-cache-{}.db",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&cache_path);
        let cache = TranslationCache::open(cache_path, 16).unwrap();
        let mut service = TranslationService::new(Box::new(ContextDictionaryTranslator), cache);
        let sense =
            |entry_id, part_of_speech: &str, sense_rank, definition: &str| DictionaryEntry {
                entry_id,
                headword: "share".to_string(),
                language: "en".to_string(),
                reading: String::new(),
                part_of_speech: part_of_speech.to_string(),
                sense_rank,
                source_priority: 0,
                context_recommended: false,
                definition: definition.to_string(),
                definition_language: "en".to_string(),
                definition_origin: "original".to_string(),
                original_definition: definition.to_string(),
                original_definition_language: "en".to_string(),
                example: String::new(),
                source_name: "Test".to_string(),
                source_url: String::new(),
                license: "Test".to_string(),
            };
        let result = DictionaryLookupResult {
            query: "share".to_string(),
            source_language: "en".to_string(),
            target_language: "ko".to_string(),
            selection_translation: String::new(),
            localization_pending: true,
            segmented: false,
            entries: vec![
                sense(
                    1,
                    "noun",
                    0,
                    "assets belonging to or contributed by an individual or group",
                ),
                sense(2, "verb", 1, "communicate information with other people"),
            ],
            personal_entries: Vec::new(),
        };

        let localized = localize_dictionary_result(
            &mut service,
            result,
            "Members share photos with the community.",
            Language::Korean,
        );

        assert_eq!(localized.selection_translation, "공유");
        assert_eq!(localized.entries[0].part_of_speech, "verb");
        assert!(localized.entries[0].context_recommended);
    }

    #[test]
    fn dictionary_selection_label_does_not_absorb_negation_from_context() {
        let cache_path = std::env::temp_dir().join(format!(
            "nudenyang-dictionary-share-negation-cache-{}.db",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&cache_path);
        let cache = TranslationCache::open(cache_path, 16).unwrap();
        let mut service = TranslationService::new(Box::new(ContextDictionaryTranslator), cache);
        let sense =
            |entry_id, part_of_speech: &str, sense_rank, definition: &str| DictionaryEntry {
                entry_id,
                headword: "share".to_string(),
                language: "en".to_string(),
                reading: String::new(),
                part_of_speech: part_of_speech.to_string(),
                sense_rank,
                source_priority: 0,
                context_recommended: false,
                definition: definition.to_string(),
                definition_language: "en".to_string(),
                definition_origin: "original".to_string(),
                original_definition: definition.to_string(),
                original_definition_language: "en".to_string(),
                example: String::new(),
                source_name: "Test".to_string(),
                source_url: String::new(),
                license: "Test".to_string(),
            };
        let result = DictionaryLookupResult {
            query: "share".to_string(),
            source_language: "en".to_string(),
            target_language: "ko".to_string(),
            selection_translation: String::new(),
            localization_pending: true,
            segmented: false,
            entries: vec![
                sense(
                    1,
                    "noun",
                    0,
                    "assets belonging to or contributed by an individual or group",
                ),
                sense(2, "verb", 1, "communicate information with other people"),
            ],
            personal_entries: Vec::new(),
        };

        let localized = localize_dictionary_result(
            &mut service,
            result,
            "Please do not share other people's creations.",
            Language::Korean,
        );

        assert_eq!(localized.selection_translation, "공유");
        assert_eq!(localized.entries[0].part_of_speech, "verb");
        assert!(localized.entries[0].context_recommended);
    }

    #[test]
    fn dictionary_quality_gate_rejects_wrong_script_and_model_chatter() {
        assert!(!dictionary_translation_is_acceptable(
            "time",
            "[ko] time",
            Language::Korean
        ));
        assert!(!dictionary_translation_is_acceptable(
            "time",
            "번역: 시간",
            Language::Korean
        ));
        assert!(dictionary_translation_is_acceptable(
            "time",
            "시간",
            Language::Korean
        ));
    }

    #[test]
    fn navigation_labels_share_their_own_language_context() {
        let channel = DomPart {
            kind: "channel".to_string(),
            item_id: "channels___rules".to_string(),
            context_id: None,
            index: 0,
            text: "rules".to_string(),
            displayed_text: None,
        };
        let category = DomPart {
            kind: "category".to_string(),
            item_id: "channels___general".to_string(),
            context_id: None,
            index: 0,
            text: "General".to_string(),
            displayed_text: None,
        };

        assert_eq!(
            incoming_context_key(&channel).as_deref(),
            Some("navigation")
        );
        assert_eq!(
            incoming_context_key(&category).as_deref(),
            Some("navigation")
        );
    }

    #[test]
    fn split_message_roots_share_the_discord_row_context() {
        let first = DomPart {
            kind: "message".to_string(),
            item_id: "dto-message-root-1".to_string(),
            context_id: Some("dto-message-context-1".to_string()),
            index: 0,
            text: "About Discord Rule Violations".to_string(),
            displayed_text: None,
        };
        let second = DomPart {
            kind: "message".to_string(),
            item_id: "dto-message-root-2".to_string(),
            context_id: Some("dto-message-context-1".to_string()),
            index: 0,
            text: "day blocked".to_string(),
            displayed_text: None,
        };

        assert_eq!(incoming_context_key(&first), incoming_context_key(&second));
        assert_eq!(
            incoming_context_key(&first).as_deref(),
            Some("message:dto-message-context-1")
        );
    }

    #[test]
    fn cdp_attach_restores_orphaned_translation_before_installing_the_new_hook() {
        assert_eq!(
            cdp_attach_text_scripts(),
            [
                RESTORE_TEXT_SCRIPT,
                CLEAR_TEXT_REGISTRY_SCRIPT,
                INSTALL_TEXT_RESTORE_SCRIPT,
            ]
        );
    }

    #[test]
    fn supplemental_surfaces_share_language_context_for_short_labels() {
        for kind in ["invite-context", "event-context", "browse-channel"] {
            let part = DomPart {
                kind: kind.to_string(),
                item_id: "surface-1".to_string(),
                context_id: None,
                index: 0,
                text: "General".to_string(),
                displayed_text: None,
            };
            assert!(
                incoming_context_key(&part).is_some(),
                "{kind} must provide a contextual language key"
            );
        }
    }

    #[test]
    fn capture_rate_is_bounded_and_labels_cover_real_backends() {
        assert_eq!(poll_interval(0), Duration::from_millis(500));
        assert_eq!(poll_interval(100), Duration::from_millis(50));
        assert_eq!(translator_label("chatgpt"), "ChatGPT 품질 우선 (Codex CLI)");
        assert_eq!(translator_label("claude"), "Claude 품질 우선 (Claude Code)");
        assert_eq!(
            translator_label("gemini"),
            "Gemini 품질 우선 (Antigravity CLI)"
        );
        assert_eq!(translator_label("deepl"), "DeepL 품질 우선 (API)");
        assert!(translator_label("translategemma_4b").contains("TranslateGemma 4B"));
        for provider in ["chatgpt", "claude", "gemini", "deepl"] {
            assert!(!translator_label(provider).contains("Luna/Terra"));
            assert!(!translator_label(provider).contains("GPT-5.6"));
        }
    }

    #[test]
    fn activation_notice_distinguishes_a_prepared_model_from_a_deferred_local_model() {
        let prepared = translator_activation_notice("hymt_1_8b", true);
        let deferred = translator_activation_notice("hymt_1_8b", false);

        assert!(prepared.contains("번역 준비가 완료되었습니다"));
        assert!(!prepared.contains("지금부터"));
        assert!(deferred.contains("번역을 켜면 모델을 준비합니다"));
        assert!(!deferred.contains("준비가 완료되었습니다"));
    }

    #[test]
    fn changing_only_the_outgoing_model_keeps_the_display_model_active() {
        let current = AppConfig {
            translator: "translategemma_4b".to_string(),
            outgoing_translator: "translategemma_4b".to_string(),
            ..Default::default()
        };
        let updated = AppConfig {
            outgoing_translator: "chatgpt".to_string(),
            ..current.clone()
        };

        assert_eq!(
            translator_preparation_plan(&current, &updated),
            TranslatorPreparationPlan {
                display: false,
                outgoing: true,
            }
        );
    }

    #[test]
    fn inactive_local_lanes_are_deferred_until_the_feature_uses_them() {
        let display_inactive = AppConfig {
            enabled: false,
            dictionary_enabled: false,
            outgoing_translation_enabled: true,
            translator: "hymt_1_8b".to_string(),
            outgoing_translator: "chatgpt".to_string(),
            keep_local_model_warm: true,
            ..Default::default()
        };
        assert_eq!(
            preparation_plan_for_active_lanes(&display_inactive, TranslatorPreparationPlan::all()),
            TranslatorPreparationPlan {
                display: false,
                outgoing: true,
            }
        );

        let dictionary_active = AppConfig {
            enabled: false,
            dictionary_enabled: true,
            outgoing_translation_enabled: false,
            translator: "hymt_1_8b".to_string(),
            ..Default::default()
        };
        assert_eq!(
            preparation_plan_for_active_lanes(&dictionary_active, TranslatorPreparationPlan::all()),
            TranslatorPreparationPlan {
                display: true,
                outgoing: false,
            }
        );

        let outgoing_inactive = AppConfig {
            enabled: true,
            outgoing_translation_enabled: false,
            translator: "chatgpt".to_string(),
            outgoing_translator: "translategemma_4b".to_string(),
            keep_local_model_warm: true,
            ..Default::default()
        };
        assert_eq!(
            preparation_plan_for_active_lanes(&outgoing_inactive, TranslatorPreparationPlan::all()),
            TranslatorPreparationPlan {
                display: true,
                outgoing: false,
            }
        );
    }

    #[test]
    fn enabling_translation_does_not_restart_the_same_in_flight_model_preparation() {
        let config = AppConfig::default();
        let mut status = RuntimeStatus::new(&config);
        status.translator_state = "preparing".to_string();
        status.configured_translator = config.translator.clone();

        assert!(!display_preparation_is_required(&status, &config));

        status.translator_state = "error".to_string();
        assert!(display_preparation_is_required(&status, &config));

        status.translator_state = "preparing".to_string();
        let changed = AppConfig {
            translator: "hymt_7b".to_string(),
            ..config
        };
        assert!(display_preparation_is_required(&status, &changed));
    }

    #[test]
    fn local_model_preparation_has_visible_progress_from_the_first_frame() {
        let progress = initial_model_preparation_progress("hymt_1_8b").unwrap();

        assert_eq!(progress.phase, "starting");
        assert_eq!(progress.downloaded, 0);
        assert_eq!(progress.total, 1_133_080_448);
        assert!(progress.model.contains("Hy-MT2 1.8B"));
        assert!(initial_model_preparation_progress("chatgpt").is_none());
    }

    #[test]
    fn translator_activation_waits_for_the_ui_ready_signal() {
        let config = AppConfig {
            enabled: true,
            outgoing_translation_enabled: false,
            translator: "mock".to_string(),
            outgoing_translator: "original".to_string(),
            keep_local_model_warm: false,
            ..Default::default()
        };
        let engine = RustEngine::start(config);

        thread::sleep(Duration::from_millis(150));
        assert_eq!(engine.status().unwrap().active_translator, "original");

        engine.ui_ready().unwrap();
        wait_for_translator(&engine, "mock");
        engine.stop();
    }

    #[test]
    fn display_translation_waits_for_the_configured_translator() {
        let config = AppConfig {
            enabled: true,
            translator: "hymt_1_8b".to_string(),
            ..Default::default()
        };

        assert!(!display_translation_is_ready(&config, "original"));
        assert!(display_translation_is_ready(&config, "hymt_1_8b"));
    }

    #[test]
    fn ui_ready_prepares_only_the_enabled_lane_when_the_other_lane_is_local() {
        let config = AppConfig {
            enabled: false,
            dictionary_enabled: false,
            outgoing_translation_enabled: true,
            translator: "hymt_1_8b".to_string(),
            outgoing_translator: "mock".to_string(),
            keep_local_model_warm: true,
            ..Default::default()
        };
        let engine = RustEngine::start(config);
        engine.ui_ready().unwrap();

        wait_for_outgoing_translator(&engine, "mock");
        let status = engine.status().unwrap();
        engine.stop();

        assert_eq!(status.active_translator, "original");
        assert_eq!(status.active_outgoing_translator, "mock");
        assert_eq!(status.translator_state, "ready");
    }

    #[test]
    fn outgoing_messages_run_on_their_own_worker() {
        let (sender, receiver) = mpsc::channel();
        let (result_sender, result_receiver) = mpsc::channel();
        let worker = thread::spawn(move || {
            run_outgoing_translation_worker(receiver, result_sender);
        });
        sender
            .send(OutgoingWorkerCommand::Translate(OutgoingTranslationBatch {
                generation: 1,
                target: Language::Japanese,
                request_id: "outgoing-priority".to_string(),
                text: "안녕하세요".to_string(),
                send_immediately: true,
                queued_at: Instant::now(),
            }))
            .unwrap();

        assert!(matches!(
            result_receiver.recv_timeout(Duration::from_secs(2)).unwrap(),
            WorkerResult::OutgoingTranslated { request_id, .. }
                if request_id == "outgoing-priority"
        ));
        sender.send(OutgoingWorkerCommand::Stop).unwrap();
        worker.join().unwrap();
    }

    #[test]
    fn newest_visible_display_batch_precedes_stale_viewport_backlog() {
        let (sender, receiver) = mpsc::channel();
        for (item_id, context_scope, view_epoch) in [
            ("previous-viewport", "/channels/server-a/channel-a", 1),
            ("current-viewport", "/channels/server-b/channel-b", 2),
        ] {
            sender
                .send(WorkerCommand::Translate(TranslationBatch {
                    generation: 1,
                    view_epoch,
                    view_scope: context_scope.to_string(),
                    target: Language::Korean,
                    allowed_sources: None,
                    parts: vec![DomPart {
                        kind: "message".to_string(),
                        item_id: item_id.to_string(),
                        context_id: None,
                        index: 0,
                        text: item_id.to_string(),
                        displayed_text: None,
                    }],
                    context_scope: context_scope.to_string(),
                    queued_at: Instant::now(),
                }))
                .unwrap();
        }

        let mut backlog = VecDeque::new();
        let command = next_worker_command(&receiver, &mut backlog).unwrap();
        let WorkerCommand::Translate(batch) = command else {
            panic!("display translation batch expected");
        };
        assert_eq!(batch.parts[0].item_id, "current-viewport");
        assert!(
            backlog.iter().all(|command| !matches!(
                command,
                WorkerCommand::Translate(batch)
                    if batch.context_scope == "/channels/server-a/channel-a"
            )),
            "이전 화면 번역 작업은 새 화면이 도착하면 대기열에서 제거되어야 합니다"
        );
    }

    #[test]
    fn newest_dictionary_localization_replaces_stale_pending_lookup() {
        let (sender, receiver) = mpsc::channel();
        for request_id in ["dictionary-old", "dictionary-current"] {
            sender
                .send(WorkerCommand::LocalizeDictionary(
                    DictionaryLocalizationBatch {
                        request_id: request_id.to_string(),
                        target: Language::Korean,
                        context: String::new(),
                        result: DictionaryLookupResult {
                            query: request_id.to_string(),
                            source_language: "ja".to_string(),
                            target_language: "ko".to_string(),
                            selection_translation: String::new(),
                            localization_pending: false,
                            segmented: false,
                            entries: Vec::new(),
                            personal_entries: Vec::new(),
                        },
                        queued_at: Instant::now(),
                    },
                ))
                .unwrap();
        }

        let mut backlog = VecDeque::new();
        let command = next_worker_command(&receiver, &mut backlog).unwrap();
        let WorkerCommand::LocalizeDictionary(batch) = command else {
            panic!("dictionary localization batch expected");
        };
        assert_eq!(batch.request_id, "dictionary-current");
        assert!(backlog.iter().all(|command| !matches!(
            command,
            WorkerCommand::LocalizeDictionary(batch)
                if batch.request_id == "dictionary-old"
        )));
    }

    #[test]
    fn changed_display_view_waits_for_a_quiet_window_before_scanning_the_dom() {
        let started = Instant::now();
        let mut view = DisplayViewState::default();

        assert_eq!(
            view.observe("https://discord.com/channels/server-a/channel-a", started),
            DisplayViewObservation::Initial
        );
        assert!(view.is_ready(started));

        let changed_at = started + Duration::from_millis(10);
        assert_eq!(
            view.observe(
                "https://discord.com/channels/server-b/channel-b",
                changed_at
            ),
            DisplayViewObservation::Changed
        );
        assert!(!view.is_ready(changed_at));
        assert!(!view.is_ready(changed_at + DISPLAY_VIEW_SETTLE_DELAY - Duration::from_millis(1)));
        assert!(view.is_ready(changed_at + DISPLAY_VIEW_SETTLE_DELAY));
    }

    #[test]
    fn viewport_change_marker_discards_stale_translation_without_a_new_batch() {
        let (sender, receiver) = mpsc::channel();
        sender
            .send(WorkerCommand::Translate(TranslationBatch {
                generation: 1,
                view_epoch: 1,
                view_scope: "/channels/server-a/channel-a".to_string(),
                target: Language::Korean,
                allowed_sources: None,
                parts: vec![DomPart {
                    kind: "message".to_string(),
                    item_id: "previous-viewport".to_string(),
                    context_id: None,
                    index: 0,
                    text: "previous-viewport".to_string(),
                    displayed_text: None,
                }],
                context_scope: "/channels/server-a/channel-a".to_string(),
                queued_at: Instant::now(),
            }))
            .unwrap();
        sender
            .send(WorkerCommand::DiscardDisplayBefore {
                generation: 1,
                view_epoch: 2,
            })
            .unwrap();

        let mut backlog = VecDeque::new();
        assert!(matches!(
            next_worker_command(&receiver, &mut backlog).unwrap(),
            WorkerCommand::DiscardDisplayBefore {
                generation: 1,
                view_epoch: 2
            }
        ));
        assert!(backlog.iter().all(|command| !matches!(
            command,
            WorkerCommand::Translate(batch) if batch.view_epoch < 2
        )));
    }

    #[test]
    fn control_commands_still_preempt_the_latest_visible_display_batch() {
        let (sender, receiver) = mpsc::channel();
        for item_id in ["previous-viewport", "current-viewport"] {
            sender
                .send(WorkerCommand::Translate(TranslationBatch {
                    generation: 1,
                    view_epoch: 1,
                    view_scope: "/channels/test/current".to_string(),
                    target: Language::Korean,
                    allowed_sources: None,
                    parts: vec![DomPart {
                        kind: "message".to_string(),
                        item_id: item_id.to_string(),
                        context_id: None,
                        index: 0,
                        text: item_id.to_string(),
                        displayed_text: None,
                    }],
                    context_scope: "/channels/test/current".to_string(),
                    queued_at: Instant::now(),
                }))
                .unwrap();
            if item_id == "previous-viewport" {
                sender.send(WorkerCommand::Warm).unwrap();
            }
        }

        let mut backlog = VecDeque::new();
        assert!(matches!(
            next_worker_command(&receiver, &mut backlog).unwrap(),
            WorkerCommand::Warm
        ));
        let command = next_worker_command(&receiver, &mut backlog).unwrap();
        let WorkerCommand::Translate(batch) = command else {
            panic!("display translation batch expected");
        };
        assert_eq!(batch.parts[0].item_id, "current-viewport");
    }

    #[test]
    fn cpu_local_model_uses_smaller_display_batches() {
        let cpu_config = AppConfig {
            translator: "hymt_1_8b".to_string(),
            hymt_device: "cpu".to_string(),
            ..Default::default()
        };
        let automatic_config = AppConfig {
            hymt_device: "auto".to_string(),
            ..cpu_config.clone()
        };

        assert_eq!(display_batch_item_limit(&cpu_config), CPU_MAX_BATCH_ITEMS);
        assert_eq!(display_batch_item_limit(&automatic_config), MAX_BATCH_ITEMS);
    }

    #[test]
    fn display_view_scope_ignores_origin_query_and_fragment() {
        assert_eq!(
            display_view_scope("https://discord.com/channels/server/channel?jump=message#fragment"),
            "/channels/server/channel"
        );
        assert_eq!(
            display_view_scope("/channels/server/channel?jump=message"),
            "/channels/server/channel"
        );
    }

    #[test]
    fn dom_planning_never_uses_a_rendered_translation_as_new_source() {
        let part = DomPart {
            kind: "message".to_string(),
            item_id: "dto-message-1".to_string(),
            context_id: None,
            index: 0,
            text: "Hello".to_string(),
            displayed_text: Some("안녕하세요".to_string()),
        };
        let mut pending = HashSet::new();
        let (changes, queued) = plan_dom_updates(
            vec![part.clone()],
            &HashMap::new(),
            &mut pending,
            3,
            1,
            MAX_BATCH_ITEMS,
        );
        assert!(changes.is_empty());
        assert_eq!(queued.len(), 1);
        assert_eq!(queued[0].text, "Hello");

        let states = HashMap::from([(
            part.locator(),
            PartState {
                original: "Hello".to_string(),
                translated: "안녕하세요".to_string(),
            },
        )]);
        let mut pending = HashSet::new();
        let (changes, queued) =
            plan_dom_updates(vec![part], &states, &mut pending, 4, 1, MAX_BATCH_ITEMS);
        assert!(changes.is_empty());
        assert!(queued.is_empty());

        let restored = DomPart {
            kind: "message".to_string(),
            item_id: "dto-message-1".to_string(),
            context_id: None,
            index: 0,
            text: "Hello".to_string(),
            displayed_text: Some("Hello".to_string()),
        };
        let mut pending = HashSet::new();
        let (changes, queued) =
            plan_dom_updates(vec![restored], &states, &mut pending, 5, 1, MAX_BATCH_ITEMS);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].text, "안녕하세요");
        assert!(queued.is_empty());
    }

    #[test]
    fn dom_planning_does_not_split_one_message_at_the_soft_batch_limit() {
        let mut snapshot = (0..33)
            .map(|index| DomPart {
                kind: "message".to_string(),
                item_id: format!("dto-message-{index}"),
                context_id: Some("dto-message-context-shared".to_string()),
                index: 0,
                text: format!("rule fragment {index}"),
                displayed_text: None,
            })
            .collect::<Vec<_>>();
        snapshot.push(DomPart {
            kind: "message".to_string(),
            item_id: "dto-message-next".to_string(),
            context_id: Some("dto-message-context-next".to_string()),
            index: 0,
            text: "next message".to_string(),
            displayed_text: None,
        });

        let mut pending = HashSet::new();
        let (_, queued) = plan_dom_updates(
            snapshot,
            &HashMap::new(),
            &mut pending,
            7,
            1,
            MAX_BATCH_ITEMS,
        );
        assert_eq!(queued.len(), 33);
        assert!(queued
            .iter()
            .all(|part| { part.context_id.as_deref() == Some("dto-message-context-shared") }));
    }

    #[test]
    fn dom_planning_limits_separate_messages_for_cpu_responsiveness() {
        let snapshot = (0..10)
            .map(|index| DomPart {
                kind: "message".to_string(),
                item_id: format!("dto-message-{index}"),
                context_id: Some(format!("dto-message-context-{index}")),
                index: 0,
                text: format!("message {index}"),
                displayed_text: None,
            })
            .collect::<Vec<_>>();
        let mut pending = HashSet::new();

        let (_, queued) = plan_dom_updates(
            snapshot,
            &HashMap::new(),
            &mut pending,
            8,
            2,
            CPU_MAX_BATCH_ITEMS,
        );

        assert_eq!(queued.len(), CPU_MAX_BATCH_ITEMS);
    }

    #[test]
    fn applying_a_new_translator_replaces_the_active_rust_backend() {
        let mut config = AppConfig {
            enabled: false,
            translator: "mock".to_string(),
            keep_local_model_warm: false,
            ..Default::default()
        };
        let engine = RustEngine::start(config.clone());
        engine.ui_ready().unwrap();

        wait_for_translator(&engine, "mock");
        config.translator = "original".to_string();
        engine.apply_config(config).unwrap();
        wait_for_translator(&engine, "original");

        let status = engine.status().unwrap();
        engine.stop();
        assert_eq!(status.configured_translator, "original");
        assert_eq!(status.active_translator, "original");
        assert_eq!(status.translator_state, "ready");
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러가 필요합니다"]
    fn live_restore_registry_returns_translated_discord_text_to_original() {
        let target = discord_target(9222).expect("Discord 디버그 렌더러가 필요합니다");
        let mut client = CdpClient::new(target.websocket_url);
        client.connect().unwrap();
        let before = parse_snapshot(client.evaluate(SNAPSHOT_SCRIPT, false).unwrap()).unwrap();
        let part = before
            .parts
            .into_iter()
            .find(|part| part.kind == "message")
            .expect("복원 검증에 사용할 Discord 메시지가 필요합니다");
        let locator = part.locator();
        let marker = "[NudeNyang Discord Translator restore verification]";
        let script = apply_script(&[DomChange::new(&part, marker)]).unwrap();
        client.evaluate(&script, false).unwrap();
        let translated = parse_snapshot(client.evaluate(SNAPSHOT_SCRIPT, false).unwrap()).unwrap();
        let item_id = serde_json::to_string(&part.item_id).unwrap();
        client
            .evaluate(
                &format!(
                    "(() => {{ const id={item_id}; const root=document.querySelector(`[data-dto-message-id=\"${{CSS.escape(id)}}\"]`); if(!root) return false; root.innerHTML=root.innerHTML; return true; }})()"
                ),
                false,
            )
            .unwrap();
        client.evaluate(RESTORE_TEXT_SCRIPT, false).unwrap();
        let restored = parse_snapshot(client.evaluate(SNAPSHOT_SCRIPT, false).unwrap()).unwrap();
        client.close();

        assert_eq!(
            translated
                .parts
                .iter()
                .find(|candidate| candidate.locator() == locator)
                .map(DomPart::rendered_text),
            Some(marker)
        );
        assert_eq!(
            restored
                .parts
                .iter()
                .find(|candidate| candidate.locator() == locator)
                .map(DomPart::rendered_text),
            Some(part.text.as_str())
        );
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러가 필요합니다"]
    fn live_reports_canonical_and_rendered_message_state_without_changing_discord() {
        let target = discord_target(9222).expect("Discord 디버그 렌더러가 필요합니다");
        let mut client = CdpClient::new(target.websocket_url);
        client.connect().unwrap();
        let snapshot = parse_snapshot(client.evaluate(SNAPSHOT_SCRIPT, false).unwrap()).unwrap();
        client.close();

        let messages: Vec<_> = snapshot
            .parts
            .iter()
            .filter(|part| part.kind == "message")
            .collect();
        let translated = messages
            .iter()
            .filter(|part| part.text != part.rendered_text())
            .count();
        let missing_displayed = messages
            .iter()
            .filter(|part| part.displayed_text.is_none())
            .count();
        let language_counts = messages.iter().fold(HashMap::new(), |mut counts, part| {
            *counts
                .entry(detect_explicit_language(&part.text).code())
                .or_insert(0_usize) += 1;
            counts
        });
        println!(
            "live message state: messages={}, translated={}, missing_displayed={}, languages={language_counts:?}",
            messages.len(),
            translated,
            missing_displayed
        );
        assert!(
            missing_displayed == 0,
            "실제 메시지의 표시 문자열이 누락됐습니다"
        );
    }

    #[test]
    #[ignore = "실행 중이며 표시 언어 번역이 켜진 앱과 Discord 디버그 렌더러가 필요합니다"]
    fn live_running_app_translates_foreign_message_and_keeps_native_message() {
        let target = discord_target(9222).expect("Discord 디버그 렌더러가 필요합니다");
        let mut client = CdpClient::new(target.websocket_url);
        client.connect().unwrap();
        let japanese = "今日は一緒に遊びませんか";
        let korean = "오늘 같이 놀지 않을래";
        client
            .evaluate(
                &format!(
                    "(() => {{ for (const id of ['message-content-nt-live-foreign','message-content-nt-live-native']) document.getElementById(id)?.remove(); const foreign=document.createElement('div'); foreign.id='message-content-nt-live-foreign'; foreign.style.cssText='position:fixed;left:24px;top:80px;z-index:2147483000'; foreign.textContent={}; const native=document.createElement('div'); native.id='message-content-nt-live-native'; native.style.cssText='position:fixed;left:24px;top:120px;z-index:2147483000'; native.textContent={}; document.body.append(foreign,native); return true; }})()",
                    serde_json::to_string(japanese).unwrap(),
                    serde_json::to_string(korean).unwrap(),
                ),
                false,
            )
            .unwrap();

        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        let translated = loop {
            let value = client
                .evaluate(
                    "(() => ({foreign:document.getElementById('message-content-nt-live-foreign')?.textContent||'',native:document.getElementById('message-content-nt-live-native')?.textContent||''}))()",
                    false,
                )
                .unwrap();
            let foreign = value
                .get("foreign")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            let native = value
                .get("native")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            assert_eq!(native, korean, "모국어 메시지가 변경됐습니다");
            if foreign != japanese {
                break foreign.to_string();
            }
            assert!(
                std::time::Instant::now() < deadline,
                "실행 중인 앱이 외국어 메시지를 번역하지 않았습니다"
            );
            std::thread::sleep(Duration::from_millis(100));
        };
        println!(
            "running app translated foreign message; chars={}",
            translated.chars().count()
        );
        client
            .evaluate(
                "for (const id of ['message-content-nt-live-foreign','message-content-nt-live-native']) document.getElementById(id)?.remove()",
                false,
            )
            .unwrap();
        client.close();
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러가 필요합니다"]
    fn live_toggle_off_restores_a_message_after_discord_recreates_its_text_nodes() {
        let target = discord_target(9222).expect("Discord 디버그 렌더러가 필요합니다");
        let mut client = CdpClient::new(target.websocket_url);
        client.connect().unwrap();
        let original = "こんにちは。今日は一緒に遊びませんか。";
        client
            .evaluate(
                &format!(
                    "(() => {{ document.getElementById('message-content-nt-toggle-restore')?.remove(); const root=document.createElement('div'); root.id='message-content-nt-toggle-restore'; root.style.cssText='position:fixed;left:20px;top:80px;z-index:2147483000'; root.textContent={}; document.body.append(root); return true; }})()",
                    serde_json::to_string(original).unwrap()
                ),
                false,
            )
            .unwrap();

        let config = AppConfig {
            enabled: true,
            outgoing_translation_enabled: false,
            translator: "mock".to_string(),
            target_language: "ko".to_string(),
            keep_local_model_warm: false,
            capture_fps: 20,
            ..Default::default()
        };
        let engine = RustEngine::start(config);
        engine.ui_ready().unwrap();
        wait_for_dom_text(&mut client, "[ko] ", false);
        client
            .evaluate(
                &format!(
                    "(() => {{ const root=document.getElementById('message-content-nt-toggle-restore'); root.textContent={}; return true; }})()",
                    serde_json::to_string(original).unwrap()
                ),
                false,
            )
            .unwrap();
        wait_for_dom_text(&mut client, "[ko] ", false);
        client
            .evaluate(
                "(() => { const root=document.getElementById('message-content-nt-toggle-restore'); root.innerHTML=root.innerHTML; return true; })()",
                false,
            )
            .unwrap();
        engine.set_enabled(false).unwrap();
        wait_for_dom_text(&mut client, original, true);

        engine.set_enabled(true).unwrap();
        wait_for_dom_text(&mut client, &format!("[ko] {original}"), true);

        engine.stop();
        client
            .evaluate(
                "document.getElementById('message-content-nt-toggle-restore')?.remove()",
                false,
            )
            .unwrap();
        client.close();
    }

    fn wait_for_dom_text(client: &mut CdpClient, expected: &str, exact: bool) {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            let value = client
                .evaluate(
                    "document.getElementById('message-content-nt-toggle-restore')?.textContent || ''",
                    false,
                )
                .unwrap();
            let text = value.as_str().unwrap_or_default();
            if (exact && text == expected) || (!exact && text.starts_with(expected)) {
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "Discord 테스트 메시지가 기대한 내용으로 바뀌지 않았습니다: {text}"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn wait_for_translator(engine: &RustEngine, expected: &str) {
        // The controller can cross two CDP discovery boundaries before it observes
        // an asynchronous activation result. Each discovery is capped at two seconds.
        let deadline = std::time::Instant::now() + Duration::from_secs(6);
        loop {
            let status = engine.status().unwrap();
            if status.active_translator == expected && status.translator_state == "ready" {
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "{expected} 번역기로 전환되지 않았어: {status:?}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn wait_for_outgoing_translator(engine: &RustEngine, expected: &str) {
        let deadline = std::time::Instant::now() + Duration::from_secs(6);
        loop {
            let status = engine.status().unwrap();
            if status.active_outgoing_translator == expected && status.translator_state == "ready" {
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "{expected} 전송 번역기로 전환되지 않았어: {status:?}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러가 필요해"]
    fn live_engine_connects_without_a_python_sidecar() {
        let config = AppConfig {
            enabled: false,
            translator: "original".to_string(),
            keep_local_model_warm: false,
            ..Default::default()
        };
        let engine = RustEngine::start(config);
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let connected = loop {
            if engine.status().unwrap().cdp_connected {
                break true;
            }
            if std::time::Instant::now() >= deadline {
                break false;
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        engine.stop();
        assert!(connected);
    }
}
