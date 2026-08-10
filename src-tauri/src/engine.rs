use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::Serialize;
use serde_json::json;

use crate::cache::TranslationCache;
use crate::cdp::{discord_target, CdpClient};
use crate::config::{default_config_path, AppConfig};
use crate::dom::{
    apply_script, parse_snapshot, DomChange, DomPart, CLEAR_TEXT_REGISTRY_SCRIPT,
    RESTORE_TEXT_SCRIPT, SNAPSHOT_SCRIPT,
};
use crate::image_translation::{
    apply_image_error_script, apply_image_result_script, fetch_image_data_script,
    image_capture_info_script, image_ui_script, parse_image_capture_info, parse_image_data,
    parse_image_requests, restore_images_script, ImageTranslationOutcome,
    ImageTranslationProcessor,
};
use crate::language::Language;
use crate::outgoing::{
    apply_outgoing_error_script, apply_outgoing_suggestion_script,
    attach_outgoing_text_file_script, outgoing_originals_ui_script, outgoing_ui_script,
    parse_outgoing_bindings, parse_outgoing_requests, prepare_outgoing_attachment_script,
    prepare_outgoing_send_script, suggest_recent_language, OutgoingRequest,
    OUTGOING_BINDINGS_SCRIPT, OUTGOING_CLEANUP_SCRIPT,
};
use crate::text_split::split_for_discord;
use crate::translation::{
    DeepLTranslator, HyMtModelSize, HyMtTranslator, MockTranslator, OriginalTranslator,
    SubscriptionCliTranslator, TranslationService, Translator,
};

const CDP_PORT: u16 = 9222;
const MAX_BATCH_ITEMS: usize = 32;
const DISCORD_MESSAGE_UTF16_LIMIT: usize = 1900;

type Locator = (String, String, usize);
type PendingKey = (u64, String, String, usize, String);
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
    pub translator_state: String,
    pub translator_error: String,
    pub notice: String,
}

impl RuntimeStatus {
    fn new(config: &AppConfig) -> Self {
        Self {
            enabled: config.enabled,
            controller_enabled: config.enabled || config.outgoing_translation_enabled,
            cdp_connected: false,
            connection_issue: String::new(),
            discord_process_id: None,
            engine: "rust-native".to_string(),
            target_language: config.target_language.clone(),
            configured_translator: config.translator.clone(),
            active_translator: "original".to_string(),
            translator_state: "queued".to_string(),
            translator_error: String::new(),
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
    Stop,
}

struct PartState {
    original: String,
    translated: String,
}

struct TranslationBatch {
    generation: u64,
    target: Language,
    parts: Vec<DomPart>,
}

struct ImageTranslationBatch {
    generation: u64,
    target: Language,
    image_id: String,
    source_key: String,
    image_bytes: Vec<u8>,
}

struct OutgoingTranslationBatch {
    generation: u64,
    target: Language,
    request_id: String,
    text: String,
}

enum WorkerCommand {
    Translate(TranslationBatch),
    TranslateImage(ImageTranslationBatch),
    TranslateOutgoing(OutgoingTranslationBatch),
    Activate {
        generation: u64,
        name: String,
        translator: Box<dyn Translator>,
    },
    Warm,
    Release,
    Stop,
}

fn worker_command_priority(command: &WorkerCommand) -> u8 {
    match command {
        WorkerCommand::Activate { .. }
        | WorkerCommand::Warm
        | WorkerCommand::Release
        | WorkerCommand::Stop => 0,
        WorkerCommand::TranslateOutgoing(_) => 1,
        WorkerCommand::Translate(_) | WorkerCommand::TranslateImage(_) => 2,
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
    let index = backlog
        .iter()
        .enumerate()
        .min_by_key(|(_, command)| worker_command_priority(command))
        .map(|(index, _)| index)
        .expect("worker backlog contains at least one command");
    Ok(backlog
        .remove(index)
        .expect("selected worker command exists"))
}

enum WorkerResult {
    Translated {
        generation: u64,
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
    },
    Activated {
        generation: u64,
        name: String,
    },
    WarmFailed(String),
}

enum PreparationResult {
    Ready {
        generation: u64,
        name: String,
        translator: Box<dyn Translator>,
    },
    Failed {
        generation: u64,
        name: String,
        error: String,
    },
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
    let (worker_result_tx, worker_result_rx) = mpsc::channel();
    let worker = thread::Builder::new()
        .name("rust-translation-worker".to_string())
        .spawn(move || run_translation_worker(worker_rx, worker_result_tx))
        .ok();
    let (preparation_tx, preparation_rx) = mpsc::channel();
    let outgoing_original_store = TranslationCache::open_default().ok();
    let mut client: Option<CdpClient> = None;
    let mut states: HashMap<Locator, PartState> = HashMap::new();
    let mut pending: HashSet<PendingKey> = HashSet::new();
    let mut image_pending: HashSet<ImagePendingKey> = HashSet::new();
    let mut outgoing_pending: HashSet<OutgoingPendingKey> = HashSet::new();
    let mut generation = 0_u64;
    let mut preparation_generation = 0_u64;
    let mut consecutive_connection_failures = 0_u8;
    let mut connection_issue_reported = false;
    let mut image_ui_needs_cleanup = true;
    let mut outgoing_ui_needs_cleanup = true;
    let mut stopped = false;
    let mut pending_control = None;

    request_translator_preparation(
        &config,
        &preparation_tx,
        &status,
        &mut preparation_generation,
    );

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
                    let target_changed = updated.target_language != config.target_language;
                    let runtime_changed = updated.translator != config.translator
                        || updated.hymt_device != config.hymt_device
                        || updated.speech_style != config.speech_style;
                    let enabled_changed = updated.enabled != config.enabled;
                    let outgoing_changed =
                        updated.outgoing_translation_enabled != config.outgoing_translation_enabled;
                    let warm_changed =
                        updated.keep_local_model_warm != config.keep_local_model_warm;
                    if target_changed || runtime_changed {
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
                    update_status(&status, |runtime| {
                        runtime.enabled = config.enabled;
                        runtime.controller_enabled =
                            config.enabled || config.outgoing_translation_enabled;
                        runtime.target_language = config.target_language.clone();
                        runtime.configured_translator = config.translator.clone();
                    });
                    if runtime_changed {
                        request_translator_preparation(
                            &config,
                            &preparation_tx,
                            &status,
                            &mut preparation_generation,
                        );
                    } else if warm_changed {
                        if config.keep_local_model_warm {
                            let _ = worker_tx.send(WorkerCommand::Warm);
                        } else if !config.enabled && !config.outgoing_translation_enabled {
                            let _ = worker_tx.send(WorkerCommand::Release);
                        }
                    }
                    if enabled_changed && !config.enabled {
                        restore(&mut client, &states, false);
                        image_ui_needs_cleanup = client.is_none();
                        pending.clear();
                        image_pending.clear();
                        generation += 1;
                        if !config.keep_local_model_warm && !config.outgoing_translation_enabled {
                            let _ = worker_tx.send(WorkerCommand::Release);
                        }
                    } else if enabled_changed {
                        let _ = worker_tx.send(WorkerCommand::Warm);
                    }
                    if outgoing_changed {
                        outgoing_pending.clear();
                        generation += 1;
                        outgoing_ui_needs_cleanup = true;
                        if config.outgoing_translation_enabled {
                            let _ = worker_tx.send(WorkerCommand::Warm);
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
                            runtime.controller_enabled =
                                enabled || config.outgoing_translation_enabled;
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
                            if !config.keep_local_model_warm && !config.outgoing_translation_enabled
                            {
                                let _ = worker_tx.send(WorkerCommand::Release);
                            }
                        } else {
                            let _ = worker_tx.send(WorkerCommand::Warm);
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

        while let Ok(prepared) = preparation_rx.try_recv() {
            match prepared {
                PreparationResult::Ready {
                    generation: prepared_generation,
                    name,
                    translator,
                } => {
                    if prepared_generation == preparation_generation && name == config.translator {
                        let _ = worker_tx.send(WorkerCommand::Activate {
                            generation: prepared_generation,
                            name,
                            translator,
                        });
                    }
                }
                PreparationResult::Failed {
                    generation: prepared_generation,
                    name,
                    error,
                } => {
                    if prepared_generation == preparation_generation && name == config.translator {
                        crate::diagnostics::error(
                            "translator",
                            &format!("{} preparation failed: {error}", translator_label(&name)),
                        );
                        update_status(&status, |runtime| {
                            runtime.translator_state = "error".to_string();
                            runtime.translator_error =
                                format!("{} 준비 실패: {error}", translator_label(&name));
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
            &mut client,
            &mut states,
            &mut pending,
            &mut image_pending,
            &mut outgoing_pending,
            &mut generation,
            preparation_generation,
            target,
            &config,
            &status,
        );

        let had_client = client.is_some();
        let result = (|| -> Result<(), String> {
            if client.is_none() {
                let target = discord_target(CDP_PORT)?;
                let mut connected = CdpClient::new(target.websocket_url);
                connected.connect()?;
                client = Some(connected);
                image_ui_needs_cleanup = true;
            }
            consecutive_connection_failures = 0;
            connection_issue_reported = false;
            update_status(&status, |runtime| {
                runtime.cdp_connected = true;
                runtime.connection_issue.clear();
            });
            ensure_outgoing_originals(
                client.as_mut().expect("connected CDP client"),
                outgoing_original_store.as_ref(),
                &config.ui_language,
            )?;
            if config.outgoing_translation_enabled {
                scan_outgoing(
                    client.as_mut().expect("connected CDP client"),
                    &mut outgoing_pending,
                    generation,
                    &worker_tx,
                    &config,
                    outgoing_original_store.as_ref(),
                )?;
                outgoing_ui_needs_cleanup = true;
            } else if outgoing_ui_needs_cleanup {
                client.as_mut().expect("connected CDP client").evaluate(
                    &outgoing_ui_script(
                        false,
                        &config.outgoing_target_language,
                        &config.ui_language,
                    ),
                    false,
                )?;
                outgoing_ui_needs_cleanup = false;
            }
            if config.enabled {
                scan_dom(
                    client.as_mut().expect("connected CDP client"),
                    &states,
                    &mut pending,
                    generation,
                    target,
                    &worker_tx,
                )?;
                scan_images(
                    client.as_mut().expect("connected CDP client"),
                    &mut image_pending,
                    generation,
                    target,
                    &worker_tx,
                    &status,
                    &config.ui_language,
                )?;
                image_ui_needs_cleanup = true;
            } else {
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
                && (config.enabled || config.outgoing_translation_enabled)
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
    }
    let _ = worker_tx.send(WorkerCommand::Stop);
    if let Some(worker) = worker {
        let _ = worker.join();
    }
    if let Some(mut client) = client {
        client.close();
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
            }))
            .map_err(|_| "Rust 이미지 번역 작업 스레드가 종료되었습니다.".to_string())?;
    }
    Ok(())
}

fn fetch_image_bytes(client: &mut CdpClient, image_id: &str) -> Result<Vec<u8>, String> {
    let script = fetch_image_data_script(image_id)?;
    if let Ok(value) = client.evaluate(&script, true) {
        if !value.is_null() {
            let data = parse_image_data(value)?;
            if !data.base64.is_empty() {
                return BASE64.decode(data.base64.as_bytes()).map_err(|error| {
                    format!("Discord 이미지 Base64를 해석하지 못했습니다: {error}")
                });
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
                    "scale": 1
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
    BASE64
        .decode(encoded.as_bytes())
        .map_err(|error| format!("Discord 화면 캡처 Base64를 해석하지 못했습니다: {error}"))
}

fn scan_dom(
    client: &mut CdpClient,
    states: &HashMap<Locator, PartState>,
    pending: &mut HashSet<PendingKey>,
    generation: u64,
    target: Language,
    worker: &mpsc::Sender<WorkerCommand>,
) -> Result<(), String> {
    let snapshot = parse_snapshot(client.evaluate(SNAPSHOT_SCRIPT, false)?)?;
    let mut changes = Vec::new();
    let mut parts = Vec::new();
    for part in snapshot.parts {
        let locator = part.locator();
        if let Some(state) = states.get(&locator) {
            if part.text == state.translated {
                continue;
            }
            if part.text == state.original {
                changes.push(DomChange::new(&part, state.translated.clone()));
                continue;
            }
        }
        let pending_key = (
            generation,
            part.kind.clone(),
            part.item_id.clone(),
            part.index,
            part.text.clone(),
        );
        if pending.contains(&pending_key) || parts.len() >= MAX_BATCH_ITEMS {
            continue;
        }
        pending.insert(pending_key);
        parts.push(part);
    }
    if !changes.is_empty() {
        client.evaluate(&apply_script(&changes)?, false)?;
    }
    if !parts.is_empty() {
        worker
            .send(WorkerCommand::Translate(TranslationBatch {
                generation,
                target,
                parts,
            }))
            .map_err(|_| "Rust 번역 작업 스레드가 종료되었습니다.".to_string())?;
    }
    Ok(())
}

fn ensure_outgoing_originals(
    client: &mut CdpClient,
    store: Option<&TranslationCache>,
    ui_language: &str,
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
    let ready_key = format!("{channel}|{ui_language}");
    let encoded_ready_key = serde_json::to_string(&ready_key)
        .map_err(|error| format!("Discord 채널 상태 식별자를 인코딩하지 못했습니다: {error}"))?;
    let ready = client.evaluate(
        &format!("window.__nudeTranslatorOutgoingOriginalsReady === {encoded_ready_key}"),
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
        &outgoing_originals_ui_script(&channel, &records, ui_language)?,
        false,
    )?;
    Ok(())
}

fn scan_outgoing(
    client: &mut CdpClient,
    pending: &mut HashSet<OutgoingPendingKey>,
    generation: u64,
    worker: &mpsc::Sender<WorkerCommand>,
    config: &AppConfig,
    original_store: Option<&TranslationCache>,
) -> Result<(), String> {
    let requests = parse_outgoing_requests(client.evaluate(
        &outgoing_ui_script(true, &config.outgoing_target_language, &config.ui_language),
        false,
    )?)?;
    let bindings = parse_outgoing_bindings(client.evaluate(OUTGOING_BINDINGS_SCRIPT, false)?)?;
    if let Some(store) = original_store {
        for binding in &bindings {
            let _ = store.put_outgoing_original(binding);
        }
    }
    for request in requests {
        if request.id.is_empty() || request.text.trim().is_empty() {
            continue;
        }
        if request.selected_language == "auto" {
            let suggestion = suggest_recent_language(&request.recent_messages);
            if !config.outgoing_confirm_language {
                if let Some(target) = suggestion {
                    enqueue_outgoing_translation(request, target, pending, generation, worker)?;
                    continue;
                }
            }
            client.evaluate(
                &apply_outgoing_suggestion_script(&request.id, suggestion)?,
                false,
            )?;
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
    Ok(())
}

fn enqueue_outgoing_translation(
    request: OutgoingRequest,
    target: Language,
    pending: &mut HashSet<OutgoingPendingKey>,
    generation: u64,
    worker: &mpsc::Sender<WorkerCommand>,
) -> Result<(), String> {
    let pending_key = (generation, request.id.clone());
    if !pending.insert(pending_key) {
        return Ok(());
    }
    worker
        .send(WorkerCommand::TranslateOutgoing(OutgoingTranslationBatch {
            generation,
            target,
            request_id: request.id,
            text: request.text,
        }))
        .map_err(|_| "보내는 메시지 번역 작업을 시작하지 못했습니다.".to_string())
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
        dispatch_enter(client)?;
        if !final_part {
            thread::sleep(Duration::from_millis(250));
        }
    }
    Ok(())
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
    let filename = format!("NudeNyangTranslator-translation-{timestamp}.txt");
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
    client: &mut Option<CdpClient>,
    states: &mut HashMap<Locator, PartState>,
    pending: &mut HashSet<PendingKey>,
    image_pending: &mut HashSet<ImagePendingKey>,
    outgoing_pending: &mut HashSet<OutgoingPendingKey>,
    generation: &mut u64,
    preparation_generation: u64,
    target: Language,
    config: &AppConfig,
    status: &Arc<Mutex<RuntimeStatus>>,
) {
    let mut changes = Vec::new();
    while let Ok(result) = results.try_recv() {
        match result {
            WorkerResult::Translated {
                generation: result_generation,
                target: result_target,
                parts,
                values,
            } => {
                for part in &parts {
                    pending.remove(&(
                        result_generation,
                        part.kind.clone(),
                        part.item_id.clone(),
                        part.index,
                        part.text.clone(),
                    ));
                }
                if result_generation != *generation || result_target != target {
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
                        if let Err(error) =
                            dispatch_outgoing_send(client, &request_id, Some(&translated))
                        {
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
            WorkerResult::Activated {
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
                    runtime.active_translator = name.clone();
                    if name == runtime.configured_translator {
                        runtime.translator_state = "ready".to_string();
                        runtime.translator_error.clear();
                        let model_is_prepared = !name.starts_with("hymt_")
                            || config.enabled
                            || config.outgoing_translation_enabled
                            || config.keep_local_model_warm;
                        runtime.notice = translator_activation_notice(&name, model_is_prepared);
                    }
                });
                if name.starts_with("hymt_")
                    && !config.enabled
                    && !config.outgoing_translation_enabled
                    && !config.keep_local_model_warm
                {
                    let _ = worker.send(WorkerCommand::Release);
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
    while let Ok(command) = next_worker_command(&commands, &mut backlog) {
        match command {
            WorkerCommand::Translate(batch) => {
                let texts: Vec<String> = batch.parts.iter().map(|part| part.text.clone()).collect();
                let values = service.translate_many_for_incoming(&texts, batch.target);
                let _ = results.send(WorkerResult::Translated {
                    generation: batch.generation,
                    target: batch.target,
                    parts: batch.parts,
                    values,
                });
            }
            WorkerCommand::TranslateImage(batch) => {
                let outcome =
                    image_processor.process(&batch.image_bytes, batch.target, &mut service);
                let _ = results.send(WorkerResult::ImageTranslated {
                    generation: batch.generation,
                    target: batch.target,
                    image_id: batch.image_id,
                    source_key: batch.source_key,
                    outcome,
                });
            }
            WorkerCommand::TranslateOutgoing(batch) => {
                let value = service
                    .translate_many(&[batch.text], batch.target)
                    .and_then(|mut values| {
                        if values.len() == 1 {
                            Ok(values.remove(0))
                        } else {
                            Err("번역 서비스가 전송 메시지 결과를 반환하지 않았습니다.".to_string())
                        }
                    });
                let _ = results.send(WorkerResult::OutgoingTranslated {
                    generation: batch.generation,
                    request_id: batch.request_id,
                    value,
                });
            }
            WorkerCommand::Activate {
                generation,
                name,
                translator,
            } => {
                service.replace_translator(translator);
                let _ = results.send(WorkerResult::Activated { generation, name });
            }
            WorkerCommand::Warm => {
                if let Err(error) = service.translator_mut().prepare() {
                    let _ = results.send(WorkerResult::WarmFailed(error));
                }
            }
            WorkerCommand::Release => service.translator_mut().close(),
            WorkerCommand::Stop => break,
        }
    }
}

fn request_translator_preparation(
    config: &AppConfig,
    sender: &mpsc::Sender<PreparationResult>,
    status: &Arc<Mutex<RuntimeStatus>>,
    generation: &mut u64,
) {
    *generation += 1;
    let current_generation = *generation;
    let config = config.clone();
    let name = config.translator.clone();
    let should_prepare = !name.starts_with("hymt_")
        || config.enabled
        || config.outgoing_translation_enabled
        || config.keep_local_model_warm;
    update_status(status, |runtime| {
        runtime.configured_translator = name.clone();
        runtime.translator_state = "preparing".to_string();
        runtime.translator_error.clear();
        runtime.notice = format!(
            "{} 준비를 백그라운드에서 시작했습니다. 완료 전까지 현재 모델로 계속 번역합니다.",
            translator_label(&name)
        );
    });
    let sender = sender.clone();
    thread::spawn(move || {
        let result = make_translator(&config).and_then(|mut translator| {
            if should_prepare {
                translator.prepare()?;
            }
            Ok(translator)
        });
        let message = match result {
            Ok(translator) => PreparationResult::Ready {
                generation: current_generation,
                name,
                translator,
            },
            Err(error) => PreparationResult::Failed {
                generation: current_generation,
                name,
                error,
            },
        };
        let _ = sender.send(message);
    });
}

fn make_translator(config: &AppConfig) -> Result<Box<dyn Translator>, String> {
    match config.translator.as_str() {
        "hymt_1_8b" => Ok(Box::new(HyMtTranslator::new(
            HyMtModelSize::Small,
            config.hymt_device.clone(),
            config.speech_style.clone(),
        )?)),
        "hymt_7b" => Ok(Box::new(HyMtTranslator::new(
            HyMtModelSize::Large,
            config.hymt_device.clone(),
            config.speech_style.clone(),
        )?)),
        "chatgpt" | "claude" | "gemini" => Ok(Box::new(SubscriptionCliTranslator::new(
            &config.translator,
            &config.speech_style,
            120,
            cache_root(),
        )?)),
        "deepl" => Ok(Box::new(DeepLTranslator::new(
            None,
            Duration::from_secs(30),
        )?)),
        "mock" => Ok(Box::new(MockTranslator)),
        "original" => Ok(Box::new(OriginalTranslator)),
        other => Err(format!("지원하지 않는 번역 모델입니다: {other}")),
    }
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

fn translator_label(name: &str) -> &str {
    match name {
        "hymt_1_8b" => "Hy-MT2 1.8B Q4 (경량·기본)",
        "hymt_7b" => "Hy-MT2 7B Q4 (품질·약 4.6GB)",
        "chatgpt" => "ChatGPT 플랜 (Codex CLI)",
        "claude" => "Claude 플랜 (Claude Code)",
        "gemini" => "Gemini 플랜 (Antigravity CLI)",
        "deepl" => "DeepL API",
        "mock" => "Mock 테스트",
        _ => "원문 표시",
    }
}

fn translator_activation_notice(name: &str, model_is_prepared: bool) -> String {
    if name.starts_with("hymt_") && !model_is_prepared {
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
        next_worker_command, poll_interval, translator_activation_notice, translator_label,
        OutgoingTranslationBatch, RuntimeStatus, RustEngine, TranslationBatch, WorkerCommand,
    };
    use crate::cdp::{discord_target, CdpClient};
    use crate::config::AppConfig;
    use crate::dom::{
        apply_script, parse_snapshot, DomChange, RESTORE_TEXT_SCRIPT, SNAPSHOT_SCRIPT,
    };
    use crate::language::Language;
    use std::collections::VecDeque;
    use std::sync::mpsc;

    #[test]
    fn runtime_status_starts_with_the_configured_contract() {
        let config = AppConfig::default();
        let status = RuntimeStatus::new(&config);
        assert_eq!(status.engine, "rust-native");
        assert_eq!(status.configured_translator, "hymt_1_8b");
        assert_eq!(status.active_translator, "original");
    }

    #[test]
    fn capture_rate_is_bounded_and_labels_cover_real_backends() {
        assert_eq!(poll_interval(0), Duration::from_millis(500));
        assert_eq!(poll_interval(100), Duration::from_millis(50));
        assert!(translator_label("chatgpt").contains("Codex"));
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
    fn outgoing_messages_overtake_queued_dom_translation() {
        let (sender, receiver) = mpsc::channel();
        sender
            .send(WorkerCommand::Translate(TranslationBatch {
                generation: 1,
                target: Language::Korean,
                parts: Vec::new(),
            }))
            .unwrap();
        sender
            .send(WorkerCommand::TranslateOutgoing(OutgoingTranslationBatch {
                generation: 1,
                target: Language::Japanese,
                request_id: "outgoing-priority".to_string(),
                text: "안녕하세요".to_string(),
            }))
            .unwrap();

        let command = next_worker_command(&receiver, &mut VecDeque::new()).unwrap();
        assert!(matches!(command, WorkerCommand::TranslateOutgoing(_)));
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
        let marker = "[NudeNyang Translator restore verification]";
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
                .map(|candidate| candidate.text.as_str()),
            Some(marker)
        );
        assert_eq!(
            restored
                .parts
                .iter()
                .find(|candidate| candidate.locator() == locator)
                .map(|candidate| candidate.text.as_str()),
            Some(part.text.as_str())
        );
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
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
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

    use std::time::Duration;
}
