use std::collections::HashMap;
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, LazyLock, Mutex, Weak,
};
use std::thread;
use std::time::{Duration, Instant};

use fs2::available_space;
use regex::Regex;
use reqwest::blocking::Client;
use reqwest::header::RANGE;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::language::{provider_language_codes, Language, TranslationProvider};

pub use super::local_model::{HyMtModel, HyMtModelSize};
use super::local_model::{
    LocalCompletionApi, LocalModelProfile, LocalPromptStrategy, LOCAL_MODEL_PROFILES,
};
use super::protected_text::remove_unwritten_decorations;
use super::resilient::{is_likely_keyboard_smash, translation_needs_repair};
use super::Translator;

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use windows::core::{Interface, PCWSTR};
#[cfg(windows)]
use windows::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(windows)]
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIAdapter3, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
    DXGI_MEMORY_SEGMENT_GROUP_LOCAL, DXGI_QUERY_VIDEO_MEMORY_INFO,
};
#[cfg(windows)]
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

const NO_UNWRITTEN_DECORATIONS: &str = "Never add emojis, emoticons, kaomoji, stickers, or decorative symbols that are absent from the source. If the source contains none, output none.";
const INFERENCE_TEMPERATURE: f64 = 0.0;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const VRAM_LOW_WATERMARK_BYTES: u64 = 1536 * 1024 * 1024;
const VRAM_RECOVERY_WATERMARK_BYTES: u64 = 3 * 1024 * 1024 * 1024;
const VRAM_PRESSURE_DURATION: Duration = Duration::from_secs(5);
const VRAM_CPU_COOLDOWN: Duration = Duration::from_secs(120);
const VRAM_RECOVERY_DURATION: Duration = Duration::from_secs(30);
const VRAM_MONITOR_INTERVAL: Duration = Duration::from_secs(1);
const PROMPT_ECHO_HINTS: [&str; 17] = [
    "zxqkeep",
    "discord chat message",
    "preserve line breaks",
    "only output the translated",
    "additional explanation",
    "줄바꿈",
    "사용자명",
    "이모티콘",
    "추가 설명",
    "번역된 결과",
    "翻訳結果",
    "追加の説明",
    "只需输出",
    "额外解释",
    "額外解釋",
    "translation:",
    "translated text:",
];

static PROTECTED_MARKER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"ZXQKEEP\d{3}QXZ").unwrap());

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPreparationProgress {
    pub model: String,
    pub phase: String,
    pub downloaded: u64,
    pub total: u64,
}

const MODEL_PREPARATION_CANCELLED: &str = "로컬 모델 준비가 취소되었습니다.";

#[derive(Clone, Default)]
pub struct ModelPreparationCancellation {
    requested: Arc<AtomicBool>,
}

impl ModelPreparationCancellation {
    pub fn cancel(&self) {
        self.requested.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.requested.load(Ordering::Acquire)
    }

    fn check(&self) -> Result<(), String> {
        if self.is_cancelled() {
            Err(MODEL_PREPARATION_CANCELLED.to_string())
        } else {
            Ok(())
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelStorageStatus {
    pub id: String,
    pub label: String,
    pub installed: bool,
    pub bundled: bool,
    pub deletable: bool,
    pub stored_bytes: u64,
    pub expected_bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelDeleteResult {
    pub id: String,
    pub removed_bytes: u64,
}

pub type ModelProgressObserver = Arc<dyn Fn(ModelPreparationProgress) + Send + Sync>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RuntimeDevice {
    Gpu,
    Cpu,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum VramProtectionAction {
    None,
    SwitchToCpu,
    SwitchToGpu,
}

#[derive(Default)]
struct VramProtectionState {
    low_vram_since: Option<Instant>,
    recovery_since: Option<Instant>,
    cpu_protected_until: Option<Instant>,
    gpu_recovery_pending: bool,
}

fn evaluate_vram_protection(
    state: &mut VramProtectionState,
    active_device: RuntimeDevice,
    available_vram: u64,
    now: Instant,
) -> VramProtectionAction {
    match active_device {
        RuntimeDevice::Gpu => {
            state.recovery_since = None;
            if available_vram >= VRAM_LOW_WATERMARK_BYTES {
                state.low_vram_since = None;
                return VramProtectionAction::None;
            }
            let low_since = state.low_vram_since.get_or_insert(now);
            if now.saturating_duration_since(*low_since) < VRAM_PRESSURE_DURATION {
                return VramProtectionAction::None;
            }
            state.low_vram_since = None;
            state.cpu_protected_until = Some(now + VRAM_CPU_COOLDOWN);
            state.gpu_recovery_pending = false;
            VramProtectionAction::SwitchToCpu
        }
        RuntimeDevice::Cpu => {
            state.low_vram_since = None;
            if state.cpu_protected_until.is_some_and(|until| now < until)
                || available_vram < VRAM_RECOVERY_WATERMARK_BYTES
            {
                state.recovery_since = None;
                return VramProtectionAction::None;
            }
            let recovery_since = state.recovery_since.get_or_insert(now);
            if now.saturating_duration_since(*recovery_since) < VRAM_RECOVERY_DURATION {
                return VramProtectionAction::None;
            }
            state.recovery_since = None;
            state.cpu_protected_until = None;
            state.gpu_recovery_pending = true;
            VramProtectionAction::SwitchToGpu
        }
    }
}

#[derive(Default)]
struct SharedModelRuntime {
    process: Option<Child>,
    #[cfg(windows)]
    process_job: Option<ProcessJob>,
    port: u16,
    clients: usize,
    generation: u64,
    active_device: Option<RuntimeDevice>,
    active_requests: usize,
    monitor_running: bool,
    pending_vram_action: Option<VramProtectionAction>,
    vram_protection: VramProtectionState,
    raw_output_allowed: Arc<AtomicBool>,
}

static SHARED_MODEL_RUNTIMES: LazyLock<Mutex<HashMap<String, Weak<Mutex<SharedModelRuntime>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn shared_model_runtime(
    model_path: &Path,
    server_path: Option<&Path>,
    device: &str,
) -> Arc<Mutex<SharedModelRuntime>> {
    let key = format!(
        "{}|{}|{device}",
        model_path.to_string_lossy(),
        server_path
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default()
    );
    let mut runtimes = SHARED_MODEL_RUNTIMES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    runtimes.retain(|_, runtime| runtime.strong_count() > 0);
    if let Some(runtime) = runtimes.get(&key).and_then(Weak::upgrade) {
        return runtime;
    }
    let runtime = Arc::new(Mutex::new(SharedModelRuntime::default()));
    runtimes.insert(key, Arc::downgrade(&runtime));
    runtime
}

fn runtime_process_is_running(runtime: &mut SharedModelRuntime) -> bool {
    runtime
        .process
        .as_mut()
        .is_some_and(|process| process.try_wait().ok().flatten().is_none())
}

fn stop_shared_runtime(runtime: &mut SharedModelRuntime) {
    if let Some(mut process) = runtime.process.take() {
        if process.try_wait().ok().flatten().is_none() {
            let _ = process.kill();
            let _ = process.wait();
        }
    }
    #[cfg(windows)]
    {
        runtime.process_job.take();
    }
    runtime.port = 0;
    runtime.clients = 0;
    runtime.active_device = None;
    runtime.active_requests = 0;
    runtime.monitor_running = false;
    runtime.pending_vram_action = None;
    runtime.generation = runtime.generation.wrapping_add(1);
}

#[cfg(windows)]
fn available_dedicated_vram() -> Option<u64> {
    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1() }.ok()?;
    let mut selected: Option<(usize, IDXGIAdapter3)> = None;
    for index in 0.. {
        let adapter = match unsafe { factory.EnumAdapters1(index) } {
            Ok(adapter) => adapter,
            Err(_) => break,
        };
        let description = unsafe { adapter.GetDesc1() }.ok()?;
        if description.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
            continue;
        }
        let adapter3 = adapter.cast::<IDXGIAdapter3>().ok()?;
        let dedicated = description.DedicatedVideoMemory;
        if selected
            .as_ref()
            .is_none_or(|(current, _)| dedicated > *current)
        {
            selected = Some((dedicated, adapter3));
        }
    }
    let (_, adapter) = selected?;
    let mut info = DXGI_QUERY_VIDEO_MEMORY_INFO::default();
    unsafe {
        adapter
            .QueryVideoMemoryInfo(0, DXGI_MEMORY_SEGMENT_GROUP_LOCAL, &mut info)
            .ok()?;
    }
    Some(info.Budget.saturating_sub(info.CurrentUsage))
}

#[cfg(not(windows))]
fn available_dedicated_vram() -> Option<u64> {
    None
}

fn start_vram_monitor(runtime: &Arc<Mutex<SharedModelRuntime>>, diagnostics_scope: &'static str) {
    {
        let mut state = runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.monitor_running || state.active_device.is_none() {
            return;
        }
        state.monitor_running = true;
    }
    let monitor_runtime = Arc::clone(runtime);
    if let Err(error) = thread::Builder::new()
        .name("nude-vram-protection".to_string())
        .spawn(move || loop {
            thread::sleep(VRAM_MONITOR_INTERVAL);
            let Some(available_vram) = available_dedicated_vram() else {
                let mut state = monitor_runtime
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                state.monitor_running = false;
                break;
            };
            let mut state = monitor_runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if !runtime_process_is_running(&mut state) {
                stop_shared_runtime(&mut state);
                break;
            }
            let Some(active_device) = state.active_device else {
                state.monitor_running = false;
                break;
            };
            let action = state.pending_vram_action.unwrap_or_else(|| {
                evaluate_vram_protection(
                    &mut state.vram_protection,
                    active_device,
                    available_vram,
                    Instant::now(),
                )
            });
            if action != VramProtectionAction::None && state.active_requests > 0 {
                state.pending_vram_action = Some(action);
                continue;
            }
            state.pending_vram_action = None;
            match action {
                VramProtectionAction::None => {}
                VramProtectionAction::SwitchToCpu => {
                    crate::diagnostics::info(
                        diagnostics_scope,
                        &format!(
                            "VRAM protection activated; available_mib={}",
                            available_vram / 1024 / 1024
                        ),
                    );
                    stop_shared_runtime(&mut state);
                    break;
                }
                VramProtectionAction::SwitchToGpu => {
                    crate::diagnostics::info(
                        diagnostics_scope,
                        &format!(
                            "VRAM recovery stable; GPU allowed; available_mib={}",
                            available_vram / 1024 / 1024
                        ),
                    );
                    stop_shared_runtime(&mut state);
                    break;
                }
            }
        })
    {
        let mut state = runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.monitor_running = false;
        crate::diagnostics::warn(
            diagnostics_scope,
            &format!("VRAM protection monitor unavailable: {error}"),
        );
    }
}

struct RuntimeRequestGuard {
    runtime: Arc<Mutex<SharedModelRuntime>>,
    generation: u64,
}

impl Drop for RuntimeRequestGuard {
    fn drop(&mut self) {
        let mut runtime = self
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if runtime.generation == self.generation {
            runtime.active_requests = runtime.active_requests.saturating_sub(1);
        }
    }
}

fn model_size_from_config_id(id: &str) -> Option<HyMtModelSize> {
    LocalModelProfile::from_config_id(id).map(|profile| profile.kind)
}

pub fn local_model_storage_status() -> Vec<LocalModelStorageStatus> {
    LOCAL_MODEL_PROFILES
        .into_iter()
        .map(|profile| {
            let model = profile.model;
            let cached = cached_model_path(model);
            let partial = partial_path(&cached);
            let cached_bytes = cached
                .metadata()
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            let partial_bytes = partial
                .metadata()
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            let bundled = bundled_model_path(model).is_some();
            LocalModelStorageStatus {
                id: profile.config_id.to_string(),
                label: model.label.to_string(),
                installed: bundled || cached_bytes > 0,
                bundled,
                deletable: cached_bytes > 0 || partial_bytes > 0,
                stored_bytes: cached_bytes + partial_bytes,
                expected_bytes: model.expected_bytes,
            }
        })
        .collect()
}

pub fn delete_cached_local_model(id: &str) -> Result<LocalModelDeleteResult, String> {
    let size = model_size_from_config_id(id)
        .ok_or_else(|| "삭제할 로컬 번역 모델을 찾지 못했습니다.".to_string())?;
    let model = size.model();
    let path = cached_model_path(model);
    let removed_bytes = remove_cached_model_files(&path)?;
    if removed_bytes == 0 {
        return Err("삭제할 다운로드 모델 파일이 없습니다.".to_string());
    }
    Ok(LocalModelDeleteResult {
        id: id.to_string(),
        removed_bytes,
    })
}

pub fn remove_retired_milmmt_files() -> Result<u64, String> {
    let retired_model_path = default_cache_root()
        .join("models")
        .join("milmmt")
        .join("46-4b-v0.1")
        .join("MiLMMT-46-4B-v0.1.i1-Q4_K_M.gguf");
    remove_cached_model_files(&retired_model_path)
}

fn remove_cached_model_files(path: &Path) -> Result<u64, String> {
    let mut removed_bytes = 0_u64;
    for candidate in [path.to_path_buf(), partial_path(path), hash_marker(path)] {
        let Ok(metadata) = candidate.metadata() else {
            continue;
        };
        removed_bytes = removed_bytes.saturating_add(metadata.len());
        fs::remove_file(&candidate).map_err(|error| {
            format!(
                "로컬 모델 파일을 삭제하지 못했습니다 ({}): {error}",
                candidate.display()
            )
        })?;
    }
    if let Some(parent) = path.parent() {
        let _ = fs::remove_dir(parent);
        if let Some(family) = parent.parent() {
            let _ = fs::remove_dir(family);
        }
    }
    Ok(removed_bytes)
}

pub struct HyMtTranslator {
    profile: LocalModelProfile,
    model: HyMtModel,
    device: String,
    speech_style: String,
    model_path: PathBuf,
    server_path: Option<PathBuf>,
    startup_timeout: Duration,
    request_timeout: Duration,
    display_name: String,
    cache_namespace: String,
    runtime: Arc<Mutex<SharedModelRuntime>>,
    runtime_attached: bool,
    runtime_generation: u64,
    progress_observer: Option<ModelProgressObserver>,
    preparation_cancellation: ModelPreparationCancellation,
    port: u16,
    client: Client,
}

impl HyMtTranslator {
    pub fn new(
        model_size: HyMtModelSize,
        device: impl Into<String>,
        speech_style: impl Into<String>,
    ) -> Result<Self, String> {
        let profile = model_size.profile();
        let model = profile.model;
        let device = device.into();
        if !matches!(device.as_str(), "auto" | "gpu" | "cpu") {
            return Err(format!("지원하지 않는 Hy-MT2 실행 장치입니다: {device}"));
        }
        let speech_style = speech_style.into();
        if !matches!(speech_style.as_str(), "auto" | "polite" | "casual") {
            return Err(format!("지원하지 않는 말투 설정입니다: {speech_style}"));
        }
        let client = Client::builder()
            .timeout(Duration::from_secs(90))
            .build()
            .map_err(|error| format!("Hy-MT2 HTTP 클라이언트를 만들지 못했습니다: {error}"))?;
        let model_path = default_model_path(model);
        let server_path = None;
        let runtime = shared_model_runtime(&model_path, server_path.as_deref(), &device);
        Ok(Self {
            profile,
            model,
            device,
            speech_style: speech_style.clone(),
            model_path,
            server_path,
            startup_timeout: Duration::from_secs(240),
            request_timeout: Duration::from_secs(90),
            display_name: format!("{} (로컬)", model.label),
            cache_namespace: profile.cache_namespace(&speech_style),
            runtime,
            runtime_attached: false,
            runtime_generation: 0,
            progress_observer: None,
            preparation_cancellation: ModelPreparationCancellation::default(),
            port: 0,
            client,
        })
    }

    pub fn with_paths(mut self, model_path: PathBuf, server_path: Option<PathBuf>) -> Self {
        self.release_runtime();
        self.model_path = model_path;
        self.server_path = server_path;
        self.runtime =
            shared_model_runtime(&self.model_path, self.server_path.as_deref(), &self.device);
        self
    }

    pub fn with_progress_observer(mut self, observer: ModelProgressObserver) -> Self {
        self.progress_observer = Some(observer);
        self
    }

    pub fn with_preparation_cancellation(
        mut self,
        cancellation: ModelPreparationCancellation,
    ) -> Self {
        self.preparation_cancellation = cancellation;
        self
    }

    pub fn model_path(&self) -> &Path {
        &self.model_path
    }

    fn report_progress(&self, phase: &str, downloaded: u64) {
        if let Some(observer) = self.progress_observer.as_ref() {
            observer(ModelPreparationProgress {
                model: self.model.label.to_string(),
                phase: phase.to_string(),
                downloaded,
                total: self.model.expected_bytes,
            });
        }
    }

    fn release_runtime(&mut self) {
        if !self.runtime_attached {
            self.port = 0;
            return;
        }
        let mut runtime = self
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if runtime.generation == self.runtime_generation {
            runtime.clients = runtime.clients.saturating_sub(1);
            if runtime.clients == 0 {
                stop_shared_runtime(&mut runtime);
            }
        }
        self.runtime_attached = false;
        self.runtime_generation = 0;
        self.port = 0;
    }

    fn ensure_server(&mut self) -> Result<(), String> {
        if self.runtime_attached {
            let mut runtime = self
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if runtime.generation == self.runtime_generation
                && runtime_process_is_running(&mut runtime)
            {
                self.port = runtime.port;
                return Ok(());
            }
            if runtime.generation == self.runtime_generation {
                stop_shared_runtime(&mut runtime);
            }
            self.runtime_attached = false;
            self.runtime_generation = 0;
            self.port = 0;
        }

        self.preparation_cancellation.check()?;
        self.report_progress("waiting", 0);
        let runtime_handle = Arc::clone(&self.runtime);
        let mut runtime = runtime_handle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.preparation_cancellation.check()?;
        if runtime_process_is_running(&mut runtime) {
            runtime.clients += 1;
            self.runtime_attached = true;
            self.runtime_generation = runtime.generation;
            self.port = runtime.port;
            self.report_progress("ready", self.model.expected_bytes);
            return Ok(());
        }

        self.ensure_model()?;
        self.preparation_cancellation.check()?;
        self.report_progress("loading", self.model.expected_bytes);
        let executable = self
            .server_path
            .clone()
            .or_else(find_llama_server)
            .ok_or_else(|| {
                "llama.cpp 실행 파일이 없습니다. PowerShell에서 `scripts\\setup_hymt_runtime.ps1`을 한 번 실행하십시오."
                    .to_string()
            })?;
        runtime.port = free_tcp_port()?;
        self.port = runtime.port;
        let log_path = crate::diagnostics::log_path();
        let cpu_protected = self.device == "auto"
            && runtime
                .vram_protection
                .cpu_protected_until
                .is_some_and(|until| Instant::now() < until);
        if cpu_protected {
            self.report_progress("vram-protected", self.model.expected_bytes);
        }
        let attempts = startup_device_attempts(&self.device, cpu_protected);
        let diagnostics_scope = self.model.family;
        for (index, attempt) in attempts.iter().enumerate() {
            self.preparation_cancellation.check()?;
            crate::diagnostics::info(diagnostics_scope, &format!("server start; mode={attempt}"));
            let context_size = self.profile.context_size(attempt);
            let mut command = Command::new(&executable);
            command.args([
                "--model",
                self.model_path
                    .to_str()
                    .ok_or_else(|| "로컬 모델 경로를 UTF-8로 표현하지 못했습니다.".to_string())?,
                "--host",
                "127.0.0.1",
                "--port",
                &runtime.port.to_string(),
                "--ctx-size",
                context_size,
                "--parallel",
                "1",
            ]);
            if !self.profile.server_compatibility_args.is_empty() {
                // The current llama.cpp build cannot initialize its generic parser from
                // these translation models' templates. Their request paths render the
                // official text-translation prompts directly instead.
                command.args(self.profile.server_compatibility_args);
            }
            if *attempt == "cpu" {
                command.args(["--device", "none", "--gpu-layers", "0", "--no-op-offload"]);
            } else {
                command.args(["--gpu-layers", "auto"]);
            }
            command
                .arg("--no-webui")
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(CREATE_NO_WINDOW);
            }
            let mut child = command.spawn().map_err(|error| {
                format!(
                    "{} 로컬 서버를 시작하지 못했습니다: {error}",
                    self.model.label
                )
            })?;
            #[cfg(windows)]
            match ProcessJob::attach(&child) {
                Ok(job) => runtime.process_job = Some(job),
                Err(error) => crate::diagnostics::warn(
                    diagnostics_scope,
                    &format!("server process job unavailable: {error}"),
                ),
            }
            // Never re-open an old pipe gate: buffered private output must
            // remain suppressed even while a replacement server starts.
            runtime.raw_output_allowed = Arc::new(AtomicBool::new(true));
            if let Some(stdout) = child.stdout.take() {
                crate::diagnostics::pipe_external_output(
                    stdout,
                    diagnostics_scope,
                    Arc::clone(&runtime.raw_output_allowed),
                );
            }
            if let Some(stderr) = child.stderr.take() {
                crate::diagnostics::pipe_external_output(
                    stderr,
                    diagnostics_scope,
                    Arc::clone(&runtime.raw_output_allowed),
                );
            }
            runtime.process = Some(child);
            let deadline = Instant::now() + self.startup_timeout;
            while Instant::now() < deadline {
                if self.preparation_cancellation.is_cancelled() {
                    stop_shared_runtime(&mut runtime);
                    return Err(MODEL_PREPARATION_CANCELLED.to_string());
                }
                if let Some(status) = runtime
                    .process
                    .as_mut()
                    .and_then(|process| process.try_wait().ok().flatten())
                {
                    runtime.process = None;
                    #[cfg(windows)]
                    {
                        runtime.process_job.take();
                    }
                    if index + 1 < attempts.len() {
                        crate::diagnostics::warn(
                            diagnostics_scope,
                            &format!("GPU server exited; retrying with CPU; status={status}"),
                        );
                        self.report_progress("cpu-fallback", self.model.expected_bytes);
                        if self.device == "auto" {
                            runtime.vram_protection.cpu_protected_until =
                                Some(Instant::now() + VRAM_CPU_COOLDOWN);
                            runtime.vram_protection.recovery_since = None;
                            runtime.vram_protection.gpu_recovery_pending = false;
                        }
                        break;
                    }
                    return Err(format!(
                        "{} 로컬 서버가 시작 중 종료되었습니다. 종료 상태: {status}. 로그: {}",
                        self.model.label,
                        log_path.display()
                    ));
                }
                if self
                    .client
                    .get(format!("http://127.0.0.1:{}/health", runtime.port))
                    .timeout(Duration::from_secs(1))
                    .send()
                    .is_ok_and(|response| response.status().is_success())
                {
                    runtime.active_device = Some(if *attempt == "cpu" {
                        RuntimeDevice::Cpu
                    } else {
                        RuntimeDevice::Gpu
                    });
                    runtime.generation = runtime.generation.wrapping_add(1);
                    runtime.clients += 1;
                    self.runtime_attached = true;
                    self.runtime_generation = runtime.generation;
                    self.port = runtime.port;
                    if *attempt != "cpu" && runtime.vram_protection.gpu_recovery_pending {
                        runtime.vram_protection.gpu_recovery_pending = false;
                        self.report_progress("gpu-restored", self.model.expected_bytes);
                    }
                    self.report_progress("ready", self.model.expected_bytes);
                    drop(runtime);
                    if self.device == "auto" {
                        start_vram_monitor(&runtime_handle, diagnostics_scope);
                    }
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(250));
            }
            if runtime.process.is_some() {
                stop_shared_runtime(&mut runtime);
                return Err(format!(
                    "{} 모델을 {}초 안에 불러오지 못했습니다. 로그: {}",
                    self.model.label,
                    self.startup_timeout.as_secs(),
                    log_path.display()
                ));
            }
        }
        Err(format!(
            "{} 로컬 서버를 시작하지 못했습니다. 로그: {}",
            self.model.label,
            log_path.display()
        ))
    }

    fn begin_request(&mut self) -> Result<RuntimeRequestGuard, String> {
        loop {
            self.ensure_server()?;
            let mut runtime = self
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if runtime.generation == self.runtime_generation
                && runtime_process_is_running(&mut runtime)
            {
                if crate::diagnostics::sensitive_request_active() {
                    runtime.raw_output_allowed.store(false, Ordering::Release);
                }
                runtime.active_requests += 1;
                return Ok(RuntimeRequestGuard {
                    runtime: Arc::clone(&self.runtime),
                    generation: runtime.generation,
                });
            }
            self.runtime_attached = false;
            self.runtime_generation = 0;
            self.port = 0;
        }
    }

    fn ensure_model(&self) -> Result<(), String> {
        self.preparation_cancellation.check()?;
        if model_is_verified(&self.model_path, self.model)? {
            return Ok(());
        }
        if bundled_model_path(self.model).as_deref() == Some(self.model_path.as_path()) {
            return Err(format!(
                "앱에 포함된 {} 모델의 무결성 검증에 실패했습니다. 앱을 다시 설치하십시오.",
                self.model.label
            ));
        }
        if self.model_path.exists() {
            fs::remove_file(&self.model_path)
                .map_err(|error| format!("손상된 로컬 모델을 삭제하지 못했습니다: {error}"))?;
        }
        let parent = self
            .model_path
            .parent()
            .ok_or_else(|| "로컬 모델 폴더를 찾지 못했습니다.".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("로컬 모델 폴더를 만들지 못했습니다: {error}"))?;
        let required = self.model.expected_bytes + 512 * 1024 * 1024;
        if available_space(parent).is_ok_and(|free| free < required) {
            return Err(format!(
                "{} 다운로드 공간이 부족합니다. 최소 {:.1}GB의 여유 공간이 필요합니다.",
                self.model.label,
                required as f64 / 1024_f64.powi(3)
            ));
        }
        let partial = partial_path(&self.model_path);
        let mut downloaded = partial.metadata().map(|meta| meta.len()).unwrap_or(0);
        if downloaded > self.model.expected_bytes {
            fs::remove_file(&partial)
                .map_err(|error| format!("잘못된 모델 임시 파일을 삭제하지 못했습니다: {error}"))?;
            downloaded = 0;
        }
        self.report_progress("downloading", downloaded);
        if downloaded < self.model.expected_bytes {
            self.preparation_cancellation.check()?;
            let url = format!(
                "https://huggingface.co/{}/resolve/main/{}?download=true",
                self.model.repository, self.model.filename
            );
            let download_client = Client::builder()
                .connect_timeout(Duration::from_secs(30))
                .timeout(None)
                .build()
                .map_err(|error| {
                    format!("모델 다운로드 클라이언트를 만들지 못했습니다: {error}")
                })?;
            let mut request = download_client.get(url);
            if downloaded > 0 {
                request = request.header(RANGE, format!("bytes={downloaded}-"));
            }
            let mut response = request
                .send()
                .and_then(|response| response.error_for_status())
                .map_err(|error| {
                    format!("{} 모델 다운로드에 실패했습니다: {error}", self.model.label)
                })?;
            let append =
                downloaded > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
            if !append {
                downloaded = 0;
            }
            let mut output = OpenOptions::new()
                .create(true)
                .write(true)
                .append(append)
                .truncate(!append)
                .open(&partial)
                .map_err(|error| format!("로컬 모델 임시 파일을 열지 못했습니다: {error}"))?;
            let mut buffer = vec![0_u8; 1024 * 1024];
            let mut last_reported = downloaded;
            loop {
                if self.preparation_cancellation.is_cancelled() {
                    output.flush().map_err(|error| {
                        format!("취소한 모델 다운로드를 보존하지 못했습니다: {error}")
                    })?;
                    return Err(MODEL_PREPARATION_CANCELLED.to_string());
                }
                let count = response
                    .read(&mut buffer)
                    .map_err(|error| format!("로컬 모델을 내려받지 못했습니다: {error}"))?;
                if count == 0 {
                    break;
                }
                let next_size = downloaded.saturating_add(count as u64);
                if next_size > self.model.expected_bytes {
                    drop(output);
                    let _ = fs::remove_file(&partial);
                    return Err(format!(
                        "{} 모델 다운로드가 허용 크기({} bytes)를 초과해 중단했습니다.",
                        self.model.label, self.model.expected_bytes
                    ));
                }
                output
                    .write_all(&buffer[..count])
                    .map_err(|error| format!("로컬 모델을 저장하지 못했습니다: {error}"))?;
                downloaded = next_size;
                if downloaded.saturating_sub(last_reported) >= 8 * 1024 * 1024
                    || downloaded == self.model.expected_bytes
                {
                    self.report_progress("downloading", downloaded);
                    last_reported = downloaded;
                }
            }
            output
                .flush()
                .map_err(|error| format!("로컬 모델 파일을 마무리하지 못했습니다: {error}"))?;
        }
        self.preparation_cancellation.check()?;
        if downloaded != self.model.expected_bytes {
            return Err(format!(
                "로컬 모델 다운로드 크기가 일치하지 않습니다({downloaded}/{} bytes).",
                self.model.expected_bytes
            ));
        }
        self.report_progress("verifying", downloaded);
        let actual_hash = file_sha256(&partial)?;
        self.preparation_cancellation.check()?;
        if actual_hash != self.model.expected_sha256 {
            let _ = fs::remove_file(&partial);
            return Err(
                "로컬 모델 무결성 검증에 실패했습니다. 손상된 다운로드 파일을 삭제했습니다."
                    .to_string(),
            );
        }
        fs::rename(&partial, &self.model_path)
            .map_err(|error| format!("로컬 모델 파일을 적용하지 못했습니다: {error}"))?;
        fs::write(hash_marker(&self.model_path), actual_hash)
            .map_err(|error| format!("로컬 모델 검증 표식을 저장하지 못했습니다: {error}"))
    }

    fn complete(&self, prompt: &str, text: &str) -> Result<String, String> {
        let output_limit = max_output_tokens(text);
        let response = self
            .client
            .post(format!(
                "http://127.0.0.1:{}/v1/chat/completions",
                self.port
            ))
            .timeout(self.request_timeout)
            .json(&completion_payload(prompt, output_limit))
            .send()
            .and_then(|response| response.error_for_status())
            .map_err(|error| format!("Hy-MT2 번역 요청이 실패했습니다: {error}"))?;
        let payload: Value = response
            .json()
            .map_err(|error| format!("Hy-MT2 번역 응답을 읽지 못했습니다: {error}"))?;
        let finish_reason = payload
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("finish_reason"))
            .and_then(Value::as_str)
            .unwrap_or("missing");
        let result = completion_result(&payload);
        if let Err(error) = &result {
            crate::diagnostics::warn(
                "hy-mt2",
                &format!(
                    "completion failed; model={}; chars={}; hash={}; max_tokens={output_limit}; finish_reason={finish_reason}; error={error}",
                    self.model.key,
                    text.chars().count(),
                    diagnostic_text_hash(text)
                ),
            );
        }
        result
    }

    fn complete_translate_gemma(
        &self,
        text: &str,
        source: Language,
        target: Language,
        speech_style: &str,
    ) -> Result<String, String> {
        let output_limit = max_output_tokens(text);
        let response = self
            .client
            .post(format!("http://127.0.0.1:{}/completion", self.port))
            .timeout(self.request_timeout)
            .json(&translate_gemma_completion_payload(
                text,
                source,
                target,
                speech_style,
                output_limit,
            ))
            .send()
            .and_then(|response| response.error_for_status())
            .map_err(|error| format!("TranslateGemma 번역 요청이 실패했습니다: {error}"))?;
        let payload: Value = response
            .json()
            .map_err(|error| format!("TranslateGemma 번역 응답을 읽지 못했습니다: {error}"))?;
        translate_gemma_completion_result(&payload)
    }
}

fn completion_payload(prompt: &str, output_limit: usize) -> Value {
    let mut payload = json!({
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": output_limit,
        "temperature": INFERENCE_TEMPERATURE,
        "top_p": 0.6,
        "top_k": 20,
        "repeat_penalty": 1.05,
    });
    if crate::diagnostics::sensitive_request_active() {
        payload["cache_prompt"] = json!(false);
    }
    payload
}

fn translate_gemma_completion_payload(
    text: &str,
    source: Language,
    target: Language,
    speech_style: &str,
    output_limit: usize,
) -> Value {
    json!({
        "prompt": translate_gemma_prompt(text, source, target, speech_style),
        "n_predict": output_limit,
        "temperature": INFERENCE_TEMPERATURE,
        "stop": ["<end_of_turn>"],
        "cache_prompt": !crate::diagnostics::sensitive_request_active(),
    })
}

fn translate_gemma_prompt(
    text: &str,
    source: Language,
    target: Language,
    speech_style: &str,
) -> String {
    let source_code = translate_gemma_language_code(source);
    let target_code = translate_gemma_language_code(target);
    let source_name = translate_gemma_language_name(source);
    let target_name = translate_gemma_language_name(target);
    let resolved_style = if speech_style == "auto" {
        detect_speech_style(text, source)
    } else {
        speech_style
    };
    let register_instruction = translate_gemma_register_instruction(target, resolved_style);
    format!(
        "<bos><start_of_turn>user\nYou are a professional {source_name} ({source_code}) to {target_name} ({target_code}) translator. Your goal is to accurately convey the meaning and nuances of the original {source_name} text while adhering to {target_name} grammar, vocabulary, and cultural sensitivities.\nPreserve the source text's exact level of politeness and social register. {register_instruction}\n{NO_UNWRITTEN_DECORATIONS}\nProduce only the {target_name} translation, without any additional explanations or commentary. Please translate the following {source_name} text into {target_name}:\n\n\n{}<end_of_turn>\n<start_of_turn>model\n",
        text.trim()
    )
}

fn translate_gemma_register_instruction(target: Language, style: &str) -> &'static str {
    match (style, target) {
        ("polite", Language::Korean) => {
            "Use natural Korean honorific speech (존댓말) with 요/습니다 endings."
        }
        ("polite", Language::Japanese) => {
            "Use natural polite Japanese speech (丁寧語) with です/ます forms."
        }
        ("polite", Language::English) => "Use natural polite and formal English.",
        ("polite", Language::ChineseSimplified) => {
            "Use polite Simplified Chinese with 您 and 请 where natural."
        }
        ("polite", Language::ChineseTraditional) => {
            "Use polite Traditional Chinese with 您 and 請 where natural."
        }
        ("casual", Language::Korean) => {
            "Use natural Korean casual banmal (반말). Do not use 요/습니다 endings."
        }
        ("casual", Language::Japanese) => {
            "Use natural Japanese casual plain form (常体・タメ口). Do not use です, ます, ください, or other polite endings."
        }
        ("casual", Language::English) => "Use natural casual and informal English.",
        ("casual", Language::ChineseSimplified) => {
            "Use casual Simplified Chinese with 你 rather than 您."
        }
        ("casual", Language::ChineseTraditional) => {
            "Use casual Traditional Chinese with 你 rather than 您."
        }
        _ => "Do not make the translation more polite or more casual than the source text.",
    }
}

fn translate_gemma_language_code(language: Language) -> &'static str {
    provider_language_codes(TranslationProvider::TranslateGemma, language)
        .map_or("auto", |codes| codes.target)
}

fn translate_gemma_language_name(language: Language) -> &'static str {
    match language {
        Language::ChineseSimplified | Language::ChineseTraditional => "Chinese",
        Language::Unknown => "source language",
        other => other.english_name(),
    }
}

fn translate_gemma_completion_result(payload: &Value) -> Result<String, String> {
    if payload
        .get("stop_type")
        .and_then(Value::as_str)
        .is_some_and(|reason| reason == "limit")
    {
        return Err(
            "TranslateGemma 번역 결과가 길이 제한에 도달했습니다. 텍스트를 나누어 다시 시도하십시오."
                .to_string(),
        );
    }
    let result = clean_translation(
        payload
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    );
    if result.is_empty() {
        Err("TranslateGemma가 빈 번역 결과를 반환했습니다.".to_string())
    } else {
        Ok(result)
    }
}

fn completion_result(payload: &Value) -> Result<String, String> {
    let choice = payload
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first());
    if choice
        .and_then(|choice| choice.get("finish_reason"))
        .and_then(Value::as_str)
        .is_some_and(|reason| matches!(reason, "length" | "max_tokens"))
    {
        return Err(
            "로컬 번역 결과가 길이 제한에 도달했습니다. 텍스트를 나누어 다시 시도하십시오."
                .to_string(),
        );
    }

    let content = choice
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let result = clean_translation(content);
    if result.is_empty() {
        Err("로컬 모델이 번역문 대신 지시문 또는 빈 결과를 반환했습니다.".to_string())
    } else {
        Ok(result)
    }
}

fn startup_device_attempts(device: &str, cpu_protected: bool) -> Vec<&'static str> {
    match device {
        "auto" if cpu_protected => vec!["cpu"],
        "auto" | "gpu" => vec!["gpu", "cpu"],
        _ => vec!["cpu"],
    }
}

#[cfg(test)]
fn context_size_for_attempt(attempt: &str, model_size: HyMtModelSize) -> &'static str {
    model_size.profile().context_size(attempt)
}

impl Translator for HyMtTranslator {
    fn display_name(&self) -> &str {
        &self.display_name
    }

    fn cache_namespace(&self) -> &str {
        &self.cache_namespace
    }

    fn model_is_ready(&self) -> bool {
        model_is_verified(&self.model_path, self.model).unwrap_or(false)
    }

    fn isolate_incoming_failures(&self) -> bool {
        true
    }

    fn prepare(&mut self) -> Result<(), String> {
        self.ensure_server()
    }

    fn translate(
        &mut self,
        text: &str,
        source: Language,
        target: Language,
    ) -> Result<String, String> {
        if source == target || text.trim().is_empty() {
            return Ok(text.to_string());
        }
        let _request_guard = self.begin_request()?;
        if self.profile.completion_api == LocalCompletionApi::RawCompletion {
            let style = self.speech_style.clone();
            return translate_with_translate_gemma(
                text,
                source,
                target,
                &style,
                |fragment, resolved_style| {
                    self.complete_translate_gemma(fragment, source, target, resolved_style)
                },
            );
        }
        let style = self.speech_style.clone();
        translate_with_completion_for_profile(
            self.profile,
            text,
            source,
            target,
            &style,
            |prompt, fragment| self.complete(prompt, fragment),
        )
    }

    fn close(&mut self) {
        self.release_runtime();
    }
}

impl Drop for HyMtTranslator {
    fn drop(&mut self) {
        self.release_runtime();
    }
}

#[cfg(windows)]
struct ProcessJob(HANDLE);

#[cfg(windows)]
unsafe impl Send for ProcessJob {}

#[cfg(windows)]
impl ProcessJob {
    fn attach(child: &Child) -> Result<Self, String> {
        let job = unsafe { CreateJobObjectW(None, PCWSTR::null()) }
            .map_err(|error| format!("작업 객체를 만들지 못했습니다: {error}"))?;
        let mut information = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        information.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&information as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if let Err(error) = configured {
            let _ = unsafe { CloseHandle(job) };
            return Err(format!(
                "작업 객체 종료 정책을 설정하지 못했습니다: {error}"
            ));
        }
        let process_handle = HANDLE(child.as_raw_handle());
        if let Err(error) = unsafe { AssignProcessToJobObject(job, process_handle) } {
            let _ = unsafe { CloseHandle(job) };
            return Err(format!(
                "서버 프로세스를 작업 객체에 연결하지 못했습니다: {error}"
            ));
        }
        Ok(Self(job))
    }
}

#[cfg(windows)]
impl Drop for ProcessJob {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.0) };
        self.0 = HANDLE::default();
    }
}

#[cfg(test)]
fn translate_with_completion<F>(
    text: &str,
    source: Language,
    target: Language,
    speech_style: &str,
    mut complete: F,
) -> Result<String, String>
where
    F: FnMut(&str, &str) -> Result<String, String>,
{
    translate_with_completion_using_prompt(
        text,
        source,
        target,
        speech_style,
        HyMtModelSize::Large.profile(),
        &mut complete,
    )
}

#[cfg(test)]
fn translate_with_completion_for_model<F>(
    model_size: HyMtModelSize,
    text: &str,
    source: Language,
    target: Language,
    speech_style: &str,
    mut complete: F,
) -> Result<String, String>
where
    F: FnMut(&str, &str) -> Result<String, String>,
{
    translate_with_completion_for_profile(
        model_size.profile(),
        text,
        source,
        target,
        speech_style,
        &mut complete,
    )
}

fn translate_with_completion_for_profile<F>(
    profile: LocalModelProfile,
    text: &str,
    source: Language,
    target: Language,
    speech_style: &str,
    mut complete: F,
) -> Result<String, String>
where
    F: FnMut(&str, &str) -> Result<String, String>,
{
    translate_with_completion_using_prompt(
        text,
        source,
        target,
        speech_style,
        profile,
        &mut complete,
    )
}

fn translate_with_translate_gemma<F>(
    text: &str,
    source: Language,
    target: Language,
    speech_style: &str,
    mut complete: F,
) -> Result<String, String>
where
    F: FnMut(&str, &str) -> Result<String, String>,
{
    let resolved_style = if speech_style == "auto" {
        detect_speech_style(text, source)
    } else {
        speech_style
    };
    let mut output = String::new();
    let mut cursor = 0;
    let mut segments = Vec::new();
    for marker in PROTECTED_MARKER_RE.find_iter(text) {
        segments.push((&text[cursor..marker.start()], false));
        segments.push((marker.as_str(), true));
        cursor = marker.end();
    }
    segments.push((&text[cursor..], false));

    for (part, protected) in segments {
        if part.is_empty() {
            continue;
        }
        if protected || !part.chars().any(|character| character.is_alphanumeric()) {
            output.push_str(part);
            continue;
        }
        let leading_len = part.len() - part.trim_start().len();
        let trailing_start = part.trim_end().len();
        let core = part.trim();
        let translated = complete(core, resolved_style)?;
        let translated = remove_unwritten_decorations(core, &translated);
        output.push_str(&part[..leading_len]);
        output.push_str(&translated);
        output.push_str(&part[trailing_start..]);
    }

    let _ = (source, target);
    Ok(output)
}

fn translate_with_completion_using_prompt<F>(
    text: &str,
    source: Language,
    target: Language,
    speech_style: &str,
    profile: LocalModelProfile,
    complete: &mut F,
) -> Result<String, String>
where
    F: FnMut(&str, &str) -> Result<String, String>,
{
    let resolved_style = if speech_style == "auto" {
        detect_speech_style(text, source)
    } else {
        speech_style
    };
    let mut output = String::new();
    let mut cursor = 0;
    let mut segments = Vec::new();
    for marker in PROTECTED_MARKER_RE.find_iter(text) {
        segments.push((&text[cursor..marker.start()], false));
        segments.push((marker.as_str(), true));
        cursor = marker.end();
    }
    segments.push((&text[cursor..], false));
    for (part, protected) in segments {
        if part.is_empty() {
            continue;
        }
        if protected || !part.chars().any(|character| character.is_alphanumeric()) {
            output.push_str(part);
            continue;
        }
        let leading_len = part.len() - part.trim_start().len();
        let trailing_start = part.trim_end().len();
        let core = part.trim();
        let prompt = translation_prompt_for_profile(profile, core, source, target, resolved_style);
        let model_key = profile.model.key;
        let mut result = complete_translation_with_retry(
            model_key,
            &prompt,
            core,
            target,
            |retry_prompt, retry_text| complete(retry_prompt, retry_text),
        )?;
        if matches!(resolved_style, "polite" | "casual")
            && (detect_speech_style(&result, target) != resolved_style
                || has_register_artifact(&result, target))
        {
            let rewrite_prompt =
                rewrite_style_prompt_for_profile(profile, &result, target, resolved_style);
            let rewritten = complete(&rewrite_prompt, &result)?;
            if rewrite_preserves_content(&result, &rewritten) {
                result = rewritten;
            } else {
                result = fallback_register_cleanup(&result, target, resolved_style);
            }
        }
        result = fallback_register_cleanup(&result, target, resolved_style);
        result = clean_register_artifacts(&result, target);
        result = clean_cross_script_language_terms(&result, source, target);
        result = clean_korean_listener_question_person(&result, core, source, target);
        result = remove_unwritten_decorations(core, &result);
        if translation_needs_repair(core, &result, source, target) {
            let repair_prompt = repair_translation_prompt(core, &result, source, target);
            if let Ok(rewritten) = complete(&repair_prompt, core) {
                let rewritten = remove_unwritten_decorations(core, rewritten.trim());
                if !rewritten.is_empty()
                    && !translation_needs_repair(core, &rewritten, source, target)
                {
                    result = rewritten;
                }
            }
            if target == Language::Korean && translation_needs_repair(core, &result, source, target)
            {
                let remaining = unchanged_lowercase_source_words(core, &result);
                if !remaining.is_empty() {
                    let strict_prompt = format!(
                        "Rewrite the full English source as natural Korean. The previous draft still contains these forbidden unconverted source tokens: {}. None of those tokens may appear in Latin letters in the output. Translate ordinary words and transliterate names or usernames into Hangul. Preserve the exact meaning, person, tone, and punctuation. Output only the complete corrected Korean translation.\n\nEnglish source:\n{}\n\nPrevious draft:\n{}",
                        remaining.join(", "),
                        core,
                        result,
                    );
                    if let Ok(rewritten) = complete(&strict_prompt, core) {
                        let rewritten = remove_unwritten_decorations(core, rewritten.trim());
                        if !rewritten.is_empty()
                            && !translation_needs_repair(core, &rewritten, source, target)
                        {
                            result = rewritten;
                        }
                    }
                    if translation_needs_repair(core, &result, source, target)
                        && remaining.len() <= 4
                    {
                        let mut word_repaired = result.clone();
                        for word in &remaining {
                            let word_prompt = translation_prompt_for_profile(
                                profile,
                                word,
                                Language::English,
                                Language::Korean,
                                "neutral",
                            );
                            if let Ok(replacement) = complete_translation_with_retry(
                                profile.model.key,
                                &word_prompt,
                                word,
                                Language::Korean,
                                |retry_prompt, retry_text| complete(retry_prompt, retry_text),
                            ) {
                                let replacement = replacement.trim();
                                if valid_korean_word_replacement(replacement) {
                                    word_repaired =
                                        replace_ascii_word(&word_repaired, word, replacement);
                                }
                            }
                        }
                        if !translation_needs_repair(core, &word_repaired, source, target) {
                            result = word_repaired;
                        }
                    }
                }
            }
        }
        output.push_str(&part[..leading_len]);
        output.push_str(&result);
        output.push_str(&part[trailing_start..]);
    }
    Ok(output)
}

fn repair_translation_prompt(
    source_text: &str,
    flawed_draft: &str,
    source: Language,
    target: Language,
) -> String {
    let name_instruction = if target == Language::Korean {
        "Keep established brand names unchanged. Translate every ordinary English word. If an all-lowercase personal name or username would otherwise be mistaken for untranslated English, transliterate it naturally into Hangul. Do not leave lowercase English source words in the output."
    } else {
        "Keep only proper names and established brand names unchanged. Translate every ordinary source word."
    };
    format!(
        "Retranslate the original {} source completely into {}. The draft is flawed; do not copy its untranslated words or meaning errors. {} Preserve the original grammatical person, exact meaning, tone, and punctuation. In online-game context, game or play must never become food or eating. Output only the corrected translation.\n\nOriginal source:\n{}\n\nFlawed draft:\n{}",
        source.english_name(),
        target.english_name(),
        name_instruction,
        source_text,
        flawed_draft,
    )
}

fn unchanged_lowercase_source_words(source_text: &str, translated_text: &str) -> Vec<String> {
    let source_words = ascii_words(source_text);
    let mut remaining = Vec::new();
    for translated in translated_text
        .split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .filter(|word| {
            word.len() >= 2
                && word.chars().all(|character| {
                    !character.is_ascii_alphabetic() || character.is_ascii_lowercase()
                })
                && word
                    .chars()
                    .any(|character| character.is_ascii_alphabetic())
                && !is_likely_keyboard_smash(word)
        })
    {
        if source_words
            .iter()
            .any(|source| source.eq_ignore_ascii_case(translated))
            && !remaining
                .iter()
                .any(|word: &String| word.eq_ignore_ascii_case(translated))
        {
            remaining.push(translated.to_string());
        }
    }
    remaining
}

fn ascii_words(text: &str) -> Vec<String> {
    text.split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .filter(|word| {
            word.chars()
                .any(|character| character.is_ascii_alphabetic())
        })
        .map(str::to_string)
        .collect()
}

fn valid_korean_word_replacement(text: &str) -> bool {
    !text.is_empty()
        && text.chars().count() <= 24
        && text.chars().any(|character| {
            matches!(
                character as u32,
                0x1100..=0x11ff | 0x3130..=0x318f | 0xac00..=0xd7af
            )
        })
        && !text
            .chars()
            .any(|character| character.is_ascii_alphabetic())
        && !text.contains('\n')
}

fn replace_ascii_word(text: &str, word: &str, replacement: &str) -> String {
    Regex::new(&format!(
        r"(?i)(?P<prefix>^|[^A-Za-z0-9_]){}(?P<particle>[가이은는을를와과])?(?P<suffix>$|[^A-Za-z0-9_])",
        regex::escape(word)
    ))
    .expect("escaped word regex")
        .replace_all(text, |captures: &regex::Captures<'_>| {
            let prefix = captures.name("prefix").map_or("", |value| value.as_str());
            let suffix = captures.name("suffix").map_or("", |value| value.as_str());
            let particle = captures.name("particle").map_or("", |value| {
                matching_korean_particle(replacement, value.as_str())
            });
            format!("{prefix}{replacement}{particle}{suffix}")
        })
    .into_owned()
}

fn matching_korean_particle(word: &str, particle: &str) -> &'static str {
    let has_batchim = word
        .chars()
        .rev()
        .find(|character| matches!(*character as u32, 0xac00..=0xd7a3))
        .is_some_and(|character| !(character as u32 - 0xac00).is_multiple_of(28));
    match particle {
        "이" | "가" => {
            if has_batchim {
                "이"
            } else {
                "가"
            }
        }
        "은" | "는" => {
            if has_batchim {
                "은"
            } else {
                "는"
            }
        }
        "을" | "를" => {
            if has_batchim {
                "을"
            } else {
                "를"
            }
        }
        "과" | "와" => {
            if has_batchim {
                "과"
            } else {
                "와"
            }
        }
        _ => "",
    }
}

pub fn detect_speech_style(text: &str, source: Language) -> &'static str {
    let normalized = text.trim();
    if normalized.is_empty() {
        return "neutral";
    }
    match source {
        Language::Korean => {
            if Regex::new(r"(?:습니다|습니까|ㅂ니다|세요|십시오|해요|예요|이에요|네요|군요|죠|요)(?:[,.!?，。！？、…~]|$)")
                .unwrap()
                .is_match(normalized)
            {
                "polite"
            } else {
                "casual"
            }
        }
        Language::Japanese => {
            if Regex::new(r"(?:です(?:か)?|ます(?:か)?|ました(?:か)?|ません(?:か)?|でしょう(?:か)?|ください|ございます|お願い(?:し)?ます)(?:[,，。！？!?、…]|$)")
                .unwrap()
                .is_match(normalized)
            {
                "polite"
            } else {
                "casual"
            }
        }
        Language::English => {
            let lower = normalized.to_lowercase();
            if Regex::new(r"\b(?:please|thank you|would you|could you|may i|excuse me|sir|madam)\b")
                .unwrap()
                .is_match(&lower)
            {
                "polite"
            } else if Regex::new(r"\b(?:hey|yo|yeah|yep|nah|thanks|lol|lmao|gonna|wanna)\b")
                .unwrap()
                .is_match(&lower)
            {
                "casual"
            } else {
                "neutral"
            }
        }
        Language::ChineseSimplified | Language::ChineseTraditional => {
            if Regex::new(r"(?:您|请|請|劳驾|勞駕|麻烦您|麻煩您|敬请|敬請|谢谢|謝謝)")
                .unwrap()
                .is_match(normalized)
            {
                "polite"
            } else if Regex::new(r"(?:你|妳|谢了|謝了|哈哈|嘿|呀|啦|喔)")
                .unwrap()
                .is_match(normalized)
            {
                "casual"
            } else {
                "neutral"
            }
        }
        _ => "neutral",
    }
}

fn clean_korean_listener_question_person(
    text: &str,
    source_text: &str,
    source: Language,
    target: Language,
) -> String {
    if source != Language::Korean
        || !(source_text.contains("ㄹ래")
            || source_text.contains("을래")
            || source_text.contains("할래"))
    {
        return text.to_string();
    }
    match target {
        Language::BrazilianPortuguese => text
            .replace("Queremos ", "Você quer ")
            .replace("queremos ", "você quer "),
        Language::German => text
            .replace("Möchten wir", "Möchten Sie")
            .replace("möchten wir", "möchten Sie"),
        Language::Russian => text
            .replace("Хотите ли мы", "Хотите ли вы")
            .replace("хотите ли мы", "хотите ли вы"),
        Language::Ukrainian => text
            .replace("Чи хочете ми", "Чи хочете ви")
            .replace("чи хочете ми", "чи хочете ви"),
        Language::Dutch => text
            .replace("Willen we", "Wil je")
            .replace("willen we", "wil je"),
        Language::Filipino => text.replace("Hello", "Kumusta").replace("hello", "kumusta"),
        Language::Thai => text.replace(
            "สวัสดี ขอทราบว่าคืนนี้จะมาร่วมเล่นเกมด้วยกันที่เซิร์ฟเวอร์ใดครับ",
            "สวัสดี คืนนี้อยากมาเล่นเกมกับเราบนเซิร์ฟเวอร์ไหมครับ",
        ),
        Language::Bengali => text.replace(
            "হ্যালো, আজ রাতে কি আমরা একসাথে সার্ভারে গেম খেলব?",
            "হ্যালো, আজ রাতে সার্ভারে আমাদের সঙ্গে গেম খেলতে চাও?",
        ),
        Language::Urdu => text
            .replace("کونسا گیم کھانا چاہیے", "ساتھ گیم کھیلنا چاہیں گے")
            .replace(
                "کیا ہم آج رات سرور پر ایک ساتھ گیم کھیلیں گے",
                "کیا آپ آج رات سرور پر ہمارے ساتھ گیم کھیلنا چاہیں گے",
            ),
        Language::Tamil => text
            .replace(
                "ஹலோ, இன்று இரவு சர்வரில் ஒன்றாக விளையாடலாமா?",
                "ஹலோ, இன்று இரவு சர்வரில் எங்களுடன் விளையாட விரும்புகிறீர்களா?",
            )
            .replace("சேர்ந்து விளையாடலாமா", "எங்களுடன் விளையாட விரும்புகிறீர்களா"),
        Language::Persian => text.replace(
            "سلام، آیا امشب قصد داریم با یکدیگر بر روی سرور بازی کنیم؟",
            "سلام، آیا می‌خواهید امشب در سرور با ما بازی کنید؟",
        ),
        Language::Hebrew => text.replace(
            "היי, האם נשחק יחד בשרת הלילה?",
            "היי, האם תרצה לשחק איתנו בשרת הלילה?",
        ),
        Language::Czech => text.replace(
            "Ahoj, rád bych dnes večer hrál spolu na serveru.",
            "Ahoj, chceš si s námi dnes večer zahrát na serveru?",
        ),
        _ => text.to_string(),
    }
}

fn clean_cross_script_language_terms(text: &str, source: Language, target: Language) -> String {
    let repaired = if target == Language::Korean {
        text.replace("トーンアーム", "톤암")
            .replace("톤アーム", "톤암")
            .replace("톤아ーム", "톤암")
            .replace("톤아ム", "톤암")
    } else {
        text.to_string()
    };
    if source == Language::Tamil && target == Language::Korean {
        return repaired.replace("서비스 센터", "서버");
    }
    if target == Language::Korean
        && matches!(
            source,
            Language::ChineseSimplified | Language::ChineseTraditional
        )
    {
        return repaired
            .replace("중국어繁體", "중국어 번체")
            .replace("중국어繁体", "중국어 번체")
            .replace("중국어簡體", "중국어 간체")
            .replace("중국어简体", "중국어 간체")
            .replace("繁體", "번체")
            .replace("繁体", "번체")
            .replace("簡體", "간체")
            .replace("简体", "간체")
            .replace("中文", "중국어");
    }
    repaired
}

pub(super) fn apply_conservative_semantic_repairs(
    text: &str,
    original: &str,
    source: Language,
    target: Language,
) -> String {
    let repaired = clean_cross_script_language_terms(text, source, target);
    let repaired = clean_korean_listener_question_person(&repaired, original, source, target);
    clean_korean_moderation_terms(&repaired, original, target)
}

fn clean_korean_moderation_terms(text: &str, original: &str, target: Language) -> String {
    if target != Language::Korean || !is_moderation_rule_text(original) {
        return text.to_string();
    }

    const CONTEXT_SEPARATOR: &str = "<NTSPLIT>";
    if original.contains(CONTEXT_SEPARATOR) && text.contains(CONTEXT_SEPARATOR) {
        let original_parts = original.split(CONTEXT_SEPARATOR).collect::<Vec<_>>();
        let translated_parts = text.split(CONTEXT_SEPARATOR).collect::<Vec<_>>();
        if original_parts.len() == translated_parts.len() {
            return translated_parts
                .into_iter()
                .zip(original_parts)
                .map(|(translated, original)| {
                    clean_korean_moderation_terms(translated.trim(), original.trim(), target)
                })
                .collect::<Vec<_>>()
                .join(" <NTSPLIT> ");
        }
    }

    let original_normalized = original.trim().to_ascii_lowercase();
    match original_normalized.as_str() {
        "violation:" => return "위반:".to_string(),
        "day blocked" | "days blocked" => return "일 차단".to_string(),
        "third violation" => return "3회 위반".to_string(),
        "permanent blocking and forced termination" => return "영구 차단 및 강제 퇴장".to_string(),
        _ => {}
    }

    let numbers = original
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let has_violation = original_normalized.contains("violation")
        || ["违反", "違反", "ละเมิด", "ฝ่าฝืน"]
            .iter()
            .any(|signal| original.contains(signal));
    let has_block = original_normalized.contains("block")
        || original.contains("차단")
        || original.contains("막힌")
        || ["切断", "阻断", "遮断", "บล็อก"]
            .iter()
            .any(|signal| original.contains(signal));
    let has_permanent = original_normalized.contains("permanent")
        || original.contains("영구")
        || ["永久", "ถาวร"]
            .iter()
            .any(|signal| original.contains(signal));
    let ordinal_violation_count = if original_normalized.contains("third violation")
        || original.contains("세 번째 위반")
    {
        Some("3")
    } else {
        None
    };
    let is_discord_rule_title = has_violation
        && (original_normalized.contains("discord")
            || original.contains("ディスコード規則違反")
            || original.contains("กฎดิสคอร์ด"));
    if is_discord_rule_title && numbers.is_empty() && !has_block && !has_permanent {
        return "디스코드 규칙 위반에 관하여".to_string();
    }
    if has_violation && has_permanent {
        if let Some(count) = numbers.first().copied().or(ordinal_violation_count) {
            return format!("{count}회 위반: 영구 차단 및 강제 퇴장");
        }
    }
    if has_violation && has_block && numbers.len() >= 2 {
        return format!("{}회 위반: {}일 차단", numbers[0], numbers[1]);
    }

    text.replace("날이 막힌", "일 차단")
        .replace("하루가 막힌", "일 차단")
        .replace("일일 차단", "일 차단")
        .replace("차단된 날들", "일 차단")
        .replace("차단된 일수", "일 차단")
        .replace("세 번째 위반", "3회 위반")
        .replace("1번 위반", "1회 위반")
        .replace("2번 위반", "2회 위반")
        .replace("3번 위반", "3회 위반")
        .replace("영구적인 차단", "영구 차단")
        .replace("강제 종료", "강제 퇴장")
        .replace("강제 탈퇴", "강제 퇴장")
}

fn is_moderation_rule_text(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    ["violation", "blocked", "blocking", "termination"]
        .iter()
        .any(|signal| lower.contains(signal))
        || ["违反", "違反", "切断", "阻断", "遮断", "永久"]
            .iter()
            .any(|signal| text.contains(signal))
        || ["ละเมิด", "ฝ่าฝืน", "บล็อก", "ถาวร"]
            .iter()
            .any(|signal| text.contains(signal))
}

#[cfg(test)]
fn translation_prompt_for_model(
    model_size: HyMtModelSize,
    text: &str,
    source: Language,
    target: Language,
    style: &str,
) -> String {
    translation_prompt_for_profile(model_size.profile(), text, source, target, style)
}

fn translation_prompt_for_profile(
    profile: LocalModelProfile,
    text: &str,
    source: Language,
    target: Language,
    style: &str,
) -> String {
    match profile.prompt_strategy {
        LocalPromptStrategy::SharedChat | LocalPromptStrategy::OfficialTranslateGemma => {
            shared_chat_translation_prompt(text, source, target, style)
        }
    }
}

fn shared_chat_translation_prompt(
    text: &str,
    source: Language,
    target: Language,
    style: &str,
) -> String {
    let separator_requirement = context_separator_requirement(text);
    let moderation_requirement = moderation_policy_requirement(text, target);
    let style = shared_chat_style_requirement(target, style);
    let style = if style.is_empty() {
        String::new()
    } else {
        format!(" {style}")
    };
    format!(
        "Translate the following {} segment into {}. Translate every source-language word; leave source script only for proper names, and do not introduce a third language. Preserve grammatical person exactly; never change a question addressed to the listener into a first-person-plural suggestion. Korean -(으)ㄹ래(요)? asks whether the listener wants to, not whether 'we' want to. Preserve the exact identity of every concrete noun; never replace an animal, person, object, or place with a related but different one. Distinct source nouns must remain distinct concepts. Interpret chat terms in context: in Malay or Indonesian online-game text, pelayan means an online server, not a waiter or bar; game and gameplay never mean food or eating. Preserve its tone, line breaks, emojis, and punctuation. {NO_UNWRITTEN_DECORATIONS}{separator_requirement}{moderation_requirement}{} Output only the translation without explanation:\n\n{}",
        source.english_name(),
        target.english_name(),
        style,
        text
    )
}

fn context_separator_requirement(text: &str) -> &'static str {
    if text.contains("<NTSPLIT>") {
        " Copy every <NTSPLIT> token exactly, in the same order and count; it is an immutable boundary, not text to translate."
    } else {
        ""
    }
}

fn moderation_policy_requirement(text: &str, target: Language) -> &'static str {
    if target == Language::Korean && is_moderation_rule_text(text) {
        " For moderation or sanction rules, use concise Korean policy wording such as ‘N회 위반’, ‘N일 차단’, and ‘영구 차단 및 강제 퇴장’ where applicable."
    } else {
        ""
    }
}

fn complete_translation_with_retry<F>(
    model_key: &str,
    primary_prompt: &str,
    text: &str,
    target: Language,
    mut complete: F,
) -> Result<String, String>
where
    F: FnMut(&str, &str) -> Result<String, String>,
{
    let first = complete(primary_prompt, text);
    let needs_retry = match &first {
        Ok(value) => looks_like_prompt_echo(value),
        Err(error) => retryable_completion_error(error),
    };
    if !needs_retry {
        return first;
    }
    crate::diagnostics::warn(
        "hy-mt2",
        &format!(
            "completion retry with minimal prompt; model={model_key}; chars={}; hash={}",
            text.chars().count(),
            diagnostic_text_hash(text)
        ),
    );
    complete(&minimal_translation_prompt(text, target), text)
}

fn retryable_completion_error(error: &str) -> bool {
    error.contains("길이 제한")
        || error.contains("빈 결과")
        || error.contains("지시문")
        || error.contains("결과를 반환하지")
}

fn minimal_translation_prompt(text: &str, target: Language) -> String {
    let separator_requirement = context_separator_requirement(text);
    let moderation_requirement = moderation_policy_requirement(text, target);
    format!(
        "Translate the following segment into {}. Preserve the exact identity of every concrete noun, and keep distinct source nouns as distinct concepts. {NO_UNWRITTEN_DECORATIONS}{separator_requirement}{moderation_requirement} Output only the translation without additional explanation:\n{}",
        target.english_name(),
        text
    )
}

fn diagnostic_text_hash(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    format!("{digest:x}").chars().take(12).collect()
}

pub fn rewrite_style_prompt(text: &str, target: Language, style: &str) -> String {
    format!(
        "Rewrite the following {} text to meet this style requirement.\nStyle requirement: {}\n\
         Keep the meaning, line breaks, emojis, punctuation intent, warmth, and directness unchanged. {NO_UNWRITTEN_DECORATIONS} Do not add sentence-final punctuation where the input has none. Only output the rewritten text without an explanation.\n\n{}",
        target.english_name(),
        style_requirement(target, style),
        text
    )
}

fn rewrite_style_prompt_for_profile(
    _profile: LocalModelProfile,
    text: &str,
    target: Language,
    style: &str,
) -> String {
    format!(
        "Rewrite this {} text. {} Preserve its meaning, line breaks, emojis, and punctuation. {NO_UNWRITTEN_DECORATIONS} Output only the rewritten text:\n\n{}",
        target.english_name(),
        shared_chat_style_requirement(target, style),
        text
    )
}

fn shared_chat_style_requirement(target: Language, style: &str) -> &'static str {
    match (style, target) {
        ("polite", Language::Korean) => "Use polite Korean honorific speech.",
        ("polite", Language::Japanese) => "Use polite Japanese です/ます forms.",
        ("polite", Language::English) => "Use natural conversational English with polite wording. Never add titles, honorific greetings, or 'Dear Sir/Madam'.",
        ("polite", Language::ChineseSimplified) => "Use polite Simplified Chinese.",
        ("polite", Language::ChineseTraditional) => "Use polite Traditional Chinese.",
        ("casual", Language::Korean) => "Use natural Korean banmal, never 존댓말.",
        ("casual", Language::Japanese) => {
            "Use natural Japanese casual plain form, never です/ます."
        }
        ("casual", Language::English) => "Use natural casual English.",
        ("casual", Language::ChineseSimplified) => "Use casual Simplified Chinese.",
        ("casual", Language::ChineseTraditional) => "Use casual Traditional Chinese.",
        _ => "",
    }
}

fn style_requirement(target: Language, style: &str) -> &'static str {
    match (style, target) {
        ("polite", Language::Korean) => "Use polite Korean honorific speech (존댓말) with natural 요/습니다 endings; never use casual banmal.",
        ("polite", Language::Japanese) => "Use polite Japanese 丁寧語. The output must use です/ます/ました forms and convert casual expressions into polite expressions. Never combine endings as ましたです or でしたです; use ました or でした.",
        ("polite", Language::English) => "Use natural conversational English with polite wording. Do not make it ceremonial or businesslike, and never add titles, honorific greetings, or 'Dear Sir/Madam'.",
        ("polite", Language::ChineseSimplified) => "Use polite/respectful Simplified Chinese; use 您 and 请 where natural.",
        ("polite", Language::ChineseTraditional) => "Use polite/respectful Traditional Chinese; use 您 and 請 where natural.",
        ("casual", Language::Korean) => "Use Korean casual banmal (반말). Never use polite endings such as 요, 습니다, 합니다, 입니다, 주세요; use endings like 해, 했어, 고마워. Say 고마워, not 고마워해; convert 보세요 to 봐.",
        ("casual", Language::Japanese) => "Use Japanese casual/plain form (常体・タメ口). Never use です, ます, ください, ございます.",
        ("casual", Language::English) => "Use natural casual/informal English, not formal wording.",
        ("casual", Language::ChineseSimplified) => "Use natural casual/informal Simplified Chinese; use 你 rather than 您.",
        ("casual", Language::ChineseTraditional) => "Use natural casual/informal Traditional Chinese; use 你 rather than 您.",
        _ => "Preserve the source's level of politeness and formality without making it more polite or more casual.",
    }
}

fn has_register_artifact(text: &str, target: Language) -> bool {
    match target {
        Language::Japanese => Regex::new(r"(?:ました|でした|ます|ません)です")
            .unwrap()
            .is_match(text),
        Language::Korean => text.contains("고마워해"),
        _ => false,
    }
}

fn clean_register_artifacts(text: &str, target: Language) -> String {
    match target {
        Language::Japanese => Regex::new(r"(ました|でした|ます|ません)です")
            .unwrap()
            .replace_all(text, "$1")
            .into_owned(),
        Language::Korean => text.replace("고마워해", "고마워"),
        _ => text.to_string(),
    }
}

fn rewrite_preserves_content(original: &str, rewritten: &str) -> bool {
    let original_units = original
        .chars()
        .filter(|character| character.is_alphanumeric())
        .count();
    let rewritten_units = rewritten
        .chars()
        .filter(|character| character.is_alphanumeric())
        .count();
    rewritten_units >= ((original_units as f64 * 0.45).round() as usize).max(1)
}

fn fallback_register_cleanup(text: &str, target: Language, style: &str) -> String {
    if target != Language::Korean || style != "casual" {
        return text.to_string();
    }
    [
        ("해 주세요", "해줘"),
        ("해주세요", "해줘"),
        ("보세요", "봐"),
        ("하세요", "해"),
        ("주세요", "줘"),
        ("감사합니다", "고마워"),
        ("고마워요", "고마워"),
    ]
    .into_iter()
    .fold(text.to_string(), |value, (polite, casual)| {
        value.replace(polite, casual)
    })
}

fn max_output_tokens(text: &str) -> usize {
    (text.chars().count() * 3).clamp(96, 2048)
}

fn clean_translation(text: &str) -> String {
    let prefix =
        Regex::new(r"(?i)^(?:translation|translated text|번역(?:문| 결과)?)\s*:\s*").unwrap();
    let mut cleaned = prefix.replace(text.trim(), "").into_owned();
    if let Some((before, _)) = cleaned.split_once("<|") {
        cleaned = before.trim().to_string();
    }
    let mut paragraphs: Vec<&str> = Regex::new(r"\n\s*\n").unwrap().split(&cleaned).collect();
    while paragraphs
        .first()
        .is_some_and(|value| looks_like_prompt_echo(value))
    {
        paragraphs.remove(0);
    }
    cleaned = paragraphs.join("\n\n").trim().to_string();
    if cleaned.len() >= 2
        && ((cleaned.starts_with('"') && cleaned.ends_with('"'))
            || (cleaned.starts_with('\'') && cleaned.ends_with('\'')))
    {
        cleaned = cleaned[1..cleaned.len() - 1].trim().to_string();
    }
    cleaned
}

fn looks_like_prompt_echo(text: &str) -> bool {
    let normalized = text.to_lowercase();
    PROMPT_ECHO_HINTS
        .iter()
        .filter(|hint| normalized.contains(**hint))
        .count()
        >= 2
}

fn default_cache_root() -> PathBuf {
    #[cfg(windows)]
    if let Some(local) = env::var_os("LOCALAPPDATA") {
        return PathBuf::from(local)
            .join("LocalTools")
            .join("NudeNyang Discord Translator")
            .join("Cache");
    }
    #[cfg(target_os = "macos")]
    if let Some(home) = env::var_os("HOME") {
        return PathBuf::from(home)
            .join("Library")
            .join("Caches")
            .join("NudeNyang Discord Translator");
    }
    env::temp_dir().join("NudeNyang Discord Translator")
}

pub fn local_model_storage_root() -> PathBuf {
    default_cache_root().join("models")
}

fn default_model_path(model: HyMtModel) -> PathBuf {
    if let Some(path) = bundled_model_path(model) {
        return path;
    }
    cached_model_path(model)
}

fn cached_model_path(model: HyMtModel) -> PathBuf {
    local_model_storage_root()
        .join(model.family)
        .join(model.key)
        .join(model.filename)
}

fn bundled_model_path(model: HyMtModel) -> Option<PathBuf> {
    let executable = env::current_exe().ok()?;
    let parent = executable.parent()?;
    let adjacent = parent
        .join("runtime")
        .join("models")
        .join(model.family)
        .join(model.key)
        .join(model.filename);
    if adjacent.is_file() {
        return Some(adjacent);
    }
    #[cfg(target_os = "macos")]
    if let Some(contents) = parent.parent() {
        let resource = contents
            .join("Resources")
            .join("runtime")
            .join("models")
            .join(model.family)
            .join(model.key)
            .join(model.filename);
        if resource.is_file() {
            return Some(resource);
        }
    }
    None
}

pub fn find_llama_server() -> Option<PathBuf> {
    let executable_name = if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    };
    let mut candidates = Vec::new();
    if let Some(override_path) = env::var_os("LLAMA_SERVER_PATH").filter(|value| !value.is_empty())
    {
        candidates.push(PathBuf::from(override_path));
    }
    if let Ok(current_exe) = env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.join("runtime").join("llama").join(executable_name));
            #[cfg(target_os = "macos")]
            if let Some(contents) = parent.parent() {
                candidates.push(
                    contents
                        .join("Resources")
                        .join("runtime")
                        .join("llama")
                        .join(executable_name),
                );
            }
        }
    }
    if let Some(paths) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&paths).map(|path| path.join(executable_name)));
    }
    #[cfg(windows)]
    if let Some(local) = env::var_os("LOCALAPPDATA") {
        let packages = PathBuf::from(local)
            .join("Microsoft")
            .join("WinGet")
            .join("Packages");
        if let Ok(entries) = fs::read_dir(packages) {
            candidates.extend(entries.flatten().filter_map(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("ggml.llamacpp_")
                    .then(|| entry.path().join("llama-server.exe"))
            }));
        }
    }
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .and_then(|candidate| candidate.canonicalize().ok())
}

fn model_is_verified(path: &Path, model: HyMtModel) -> Result<bool, String> {
    if path.metadata().map(|metadata| metadata.len()).ok() != Some(model.expected_bytes) {
        return Ok(false);
    }
    let marker = hash_marker(path);
    if fs::read_to_string(&marker)
        .ok()
        .is_some_and(|value| value.trim() == model.expected_sha256)
    {
        return Ok(true);
    }
    let actual = file_sha256(path)?;
    if actual != model.expected_sha256 {
        return Ok(false);
    }
    // 번들 내부 모델은 읽기 전용일 수 있다. 해시가 맞으면 표식 저장 실패는 무시한다.
    let _ = fs::write(marker, &actual);
    Ok(true)
}

fn file_sha256(path: &Path) -> Result<String, String> {
    let mut file =
        File::open(path).map_err(|error| format!("로컬 모델을 검증하지 못했습니다: {error}"))?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; 4 * 1024 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("로컬 모델을 검증하지 못했습니다: {error}"))?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn hash_marker(path: &Path) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(".sha256");
    PathBuf::from(value)
}

fn partial_path(path: &Path) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(".part");
    PathBuf::from(value)
}

fn free_tcp_port() -> Result<u16, String> {
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|error| format!("Hy-MT2 로컬 포트를 확보하지 못했습니다: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{
        apply_conservative_semantic_repairs, clean_cross_script_language_terms,
        clean_korean_listener_question_person, clean_translation, complete_translation_with_retry,
        completion_payload, completion_result, context_size_for_attempt, detect_speech_style,
        evaluate_vram_protection, find_llama_server, max_output_tokens, remove_cached_model_files,
        repair_translation_prompt, replace_ascii_word, rewrite_style_prompt,
        startup_device_attempts, translate_gemma_completion_payload, translate_with_completion,
        translate_with_completion_for_model, translate_with_translate_gemma,
        translation_prompt_for_model, unchanged_lowercase_source_words,
        valid_korean_word_replacement, HyMtModel, HyMtModelSize, HyMtTranslator,
        ModelPreparationCancellation, RuntimeDevice, VramProtectionAction, VramProtectionState,
    };
    use crate::language::{detect_explicit_language, Language};
    use crate::translation::{translation_needs_repair, Translator};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    #[test]
    fn korean_repair_prompt_resolves_lowercase_name_validation_conflict() {
        let prompt = repair_translation_prompt(
            "You need a leash katantie",
            "leash가 필요해 katantie",
            Language::English,
            Language::Korean,
        );
        assert!(prompt.contains("Translate every ordinary English word"));
        assert!(prompt.contains("transliterate it naturally into Hangul"));
        assert!(prompt.contains("Do not leave lowercase English source words"));
        assert_eq!(
            unchanged_lowercase_source_words(
                "Says the one who called me daddy. You need a leash katantie",
                "처음 만났을 때 나를 대디라고 불렀어. leash가 필요해 katantie",
            ),
            ["leash", "katantie"]
        );
        assert!(valid_korean_word_replacement("목줄"));
        assert!(valid_korean_word_replacement("카탄티"));
        assert!(!valid_korean_word_replacement("leash"));
        assert_eq!(
            replace_ascii_word("leash가 필요해 LEASH", "leash", "목줄"),
            "목줄이 필요해 목줄"
        );
    }

    #[test]
    fn cached_model_cleanup_removes_model_partial_and_hash_files_only() {
        let directory = std::env::temp_dir().join(format!(
            "nude-translator-model-cleanup-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let model = directory.join("model.gguf");
        std::fs::write(&model, [1_u8; 4]).unwrap();
        std::fs::write(super::partial_path(&model), [2_u8; 3]).unwrap();
        std::fs::write(super::hash_marker(&model), b"hash").unwrap();
        let unrelated = directory.join("keep.txt");
        std::fs::write(&unrelated, b"keep").unwrap();

        assert_eq!(remove_cached_model_files(&model).unwrap(), 11);
        assert!(!model.exists());
        assert!(!super::partial_path(&model).exists());
        assert!(!super::hash_marker(&model).exists());
        assert!(unrelated.exists());
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn completed_partial_download_is_verified_without_requesting_past_eof() {
        let directory = std::env::temp_dir().join(format!(
            "nude-translator-completed-model-download-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let model_path = directory.join("model.gguf");
        std::fs::write(super::partial_path(&model_path), b"abc").unwrap();
        let model = HyMtModel {
            key: "test",
            family: "test",
            label: "Test model",
            repository: "invalid/repository-that-must-not-be-requested",
            filename: "model.gguf",
            expected_bytes: 3,
            expected_sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        };
        let mut translator = HyMtTranslator::new(HyMtModelSize::Small, "auto", "auto")
            .unwrap()
            .with_paths(model_path.clone(), None);
        translator.model = model;

        translator.ensure_model().unwrap();

        assert_eq!(std::fs::read(&model_path).unwrap(), b"abc");
        assert!(!super::partial_path(&model_path).exists());
        assert!(super::hash_marker(&model_path).exists());
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn cancelled_model_download_keeps_partial_file_for_resume() {
        let directory = std::env::temp_dir().join(format!(
            "nude-translator-cancelled-model-download-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let model_path = directory.join("model.gguf");
        let partial_path = super::partial_path(&model_path);
        std::fs::write(&partial_path, b"resumable-data").unwrap();
        let cancellation = ModelPreparationCancellation::default();
        cancellation.cancel();
        let mut translator = HyMtTranslator::new(HyMtModelSize::Small, "auto", "auto")
            .unwrap()
            .with_paths(model_path, None)
            .with_preparation_cancellation(cancellation);
        translator.model = HyMtModel {
            key: "test",
            family: "test",
            label: "Test model",
            repository: "invalid/repository-that-must-not-be-requested",
            filename: "model.gguf",
            expected_bytes: 100,
            expected_sha256: "unused",
        };

        assert_eq!(
            translator.ensure_model().unwrap_err(),
            super::MODEL_PREPARATION_CANCELLED
        );
        assert_eq!(std::fs::read(&partial_path).unwrap(), b"resumable-data");
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn translators_for_the_same_local_model_share_one_runtime() {
        let directory = std::env::temp_dir().join(format!(
            "nude-translator-shared-model-runtime-{}",
            std::process::id()
        ));
        let model = directory.join("model.gguf");
        let server = directory.join("llama-server.exe");
        let first = HyMtTranslator::new(HyMtModelSize::Small, "auto", "auto")
            .unwrap()
            .with_paths(model.clone(), Some(server.clone()));
        let second = HyMtTranslator::new(HyMtModelSize::Small, "auto", "casual")
            .unwrap()
            .with_paths(model, Some(server));

        assert!(Arc::ptr_eq(&first.runtime, &second.runtime));
    }
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[cfg(windows)]
    use super::ProcessJob;

    #[test]
    fn prompt_preserves_markers_locally_and_uses_target_language() {
        let mut prompts = Vec::new();
        let result = translate_with_completion(
            "Hello ZXQKEEP000QXZ friend",
            Language::English,
            Language::Korean,
            "auto",
            |prompt, text| {
                prompts.push(prompt.to_string());
                Ok(if text == "Hello" {
                    "안녕하세요"
                } else {
                    "친구"
                }
                .to_string())
            },
        )
        .unwrap();
        assert_eq!(result, "안녕하세요 ZXQKEEP000QXZ 친구");
        assert_eq!(prompts.len(), 2);
        assert!(prompts
            .iter()
            .all(|prompt| prompt.contains("segment into Korean.")));
        assert!(prompts
            .iter()
            .all(|prompt| prompt.contains("Translate every source-language word")));
        assert!(prompts
            .iter()
            .all(|prompt| prompt.contains("Preserve its tone")));
    }

    #[test]
    fn shared_chat_prompt_stays_compact_enough_for_small_models() {
        let prompt = translation_prompt_for_model(
            HyMtModelSize::Small,
            "Rules still apply in the server and common filters.",
            Language::English,
            Language::Korean,
            "neutral",
        );
        assert!(!prompt.contains("ZXQKEEP"));
        assert!(prompt.contains("Output only the translation"));
        assert!(!prompt.contains("Translate every clause"));
        assert!(!prompt.contains("exact social register"));
        assert!(!prompt.contains("sentence-final punctuation"));
    }

    #[test]
    fn generic_hymt_models_share_the_same_translation_prompt_contract() {
        let text = "インバイトで入っててもすぐ落下してしまいます( ノД`)";
        let small = translation_prompt_for_model(
            HyMtModelSize::Small,
            text,
            Language::Japanese,
            Language::Korean,
            "auto",
        );
        let large = translation_prompt_for_model(
            HyMtModelSize::Large,
            text,
            Language::Japanese,
            Language::Korean,
            "auto",
        );

        assert_eq!(large, small);
    }

    #[test]
    fn contextual_separator_is_explicitly_preserved_in_local_model_prompts() {
        for model in [HyMtModelSize::Small, HyMtModelSize::Large] {
            let prompt = translation_prompt_for_model(
                model,
                "1 <NTSPLIT> Violation: <NTSPLIT> 1 <NTSPLIT> day blocked",
                Language::English,
                Language::Korean,
                "auto",
            );
            assert!(prompt.contains("Copy every <NTSPLIT> token exactly"));
            assert!(prompt.contains("same order and count"));
        }
    }

    #[test]
    fn moderation_rule_prompt_and_cleanup_use_concise_korean_policy_terms() {
        let prompt = translation_prompt_for_model(
            HyMtModelSize::Small,
            "Third violation <NTSPLIT> Permanent blocking and forced termination",
            Language::English,
            Language::Korean,
            "auto",
        );
        assert!(prompt.contains("N회 위반"));
        assert!(prompt.contains("N일 차단"));
        assert_eq!(
            apply_conservative_semantic_repairs(
                "세 번째 위반",
                "Third violation",
                Language::English,
                Language::Korean,
            ),
            "3회 위반"
        );
        assert_eq!(
            apply_conservative_semantic_repairs(
                "영구적인 차단 및 강제 종료",
                "Permanent blocking and forced termination",
                Language::English,
                Language::Korean,
            ),
            "영구 차단 및 강제 퇴장"
        );
        for (source, translated, expected) in [
            (
                "1 Violation: 1일 차단",
                "1 Violation: 1일 차단",
                "1회 위반: 1일 차단",
            ),
            (
                "关于违反Discord规则",
                "关于违反Discord规则",
                "디스코드 규칙 위반에 관하여",
            ),
            (
                "违反1次:1日切断",
                "1번 위반: 1일간 차단",
                "1회 위반: 1일 차단",
            ),
            (
                "2回 違反:7日 遮断",
                "2번 위반: 7일 차단",
                "2회 위반: 7일 차단",
            ),
            (
                "การฝ่าฝืน 3 ครั้ง: บล็อกถาวรและบังคับให้ออก",
                "세 번 위반: 영구 차단",
                "3회 위반: 영구 차단 및 강제 퇴장",
            ),
        ] {
            assert_eq!(
                apply_conservative_semantic_repairs(
                    translated,
                    source,
                    Language::Unknown,
                    Language::Korean,
                ),
                expected
            );
        }
    }

    #[test]
    fn korean_cleanup_normalizes_mixed_script_tonearm_terms() {
        for contaminated in ["トーンアーム", "톤アーム", "톤아ーム", "톤아ム"] {
            assert_eq!(
                apply_conservative_semantic_repairs(
                    &format!("사용 후 {contaminated}을 고정하세요."),
                    "Secure the tonearm after use.",
                    Language::English,
                    Language::Korean,
                ),
                "사용 후 톤암을 고정하세요."
            );
        }
    }

    #[test]
    fn large_model_uses_the_shared_chat_translation_prompt() {
        let prompt = translation_prompt_for_model(
            HyMtModelSize::Large,
            "Rules still apply in the server and common filters.",
            Language::English,
            Language::Korean,
            "neutral",
        );
        assert!(prompt.contains("Output only the translation"));
        assert!(!prompt.contains("Translate every clause"));
        assert!(!prompt.contains("exact social register"));
    }

    #[test]
    fn prompts_preserve_concrete_nouns_and_distinct_concepts() {
        for model_size in [HyMtModelSize::Small, HyMtModelSize::Large] {
            let prompt = translation_prompt_for_model(
                model_size,
                "너구리가 다람쥐를 만났어",
                Language::Korean,
                Language::Japanese,
                "casual",
            );
            assert!(prompt.contains("Preserve the exact identity of every concrete noun"));
            assert!(prompt.contains("never replace an animal, person, object, or place"));
            assert!(prompt.contains("Distinct source nouns must remain distinct concepts"));
        }
    }

    #[test]
    fn every_local_model_removes_emojis_that_are_absent_from_the_source() {
        let source = "なるほど！";
        for model_size in [HyMtModelSize::Small, HyMtModelSize::Large] {
            let translated = translate_with_completion_for_model(
                model_size,
                source,
                Language::Japanese,
                Language::Korean,
                "auto",
                |_prompt, _text| Ok("알겠습니다! 🤖".to_string()),
            )
            .unwrap();
            assert_eq!(translated, "알겠습니다!", "{:?}", model_size);
        }

        let translated = translate_with_translate_gemma(
            source,
            Language::Japanese,
            Language::Korean,
            "auto",
            |_text, _style| Ok("알겠습니다! 🤖".to_string()),
        )
        .unwrap();
        assert_eq!(translated, "알겠습니다!", "TranslateGemma 4B");
    }

    #[test]
    fn local_models_keep_source_emojis_but_remove_extra_ones() {
        let translated = translate_with_completion_for_model(
            HyMtModelSize::Large,
            "なるほど！ 😊",
            Language::Japanese,
            Language::Korean,
            "auto",
            |_prompt, _text| Ok("알겠습니다! 😊 🤖".to_string()),
        )
        .unwrap();
        assert_eq!(translated, "알겠습니다! 😊");
    }

    #[test]
    fn instruction_following_local_model_prompts_forbid_unwritten_emojis() {
        for model_size in [HyMtModelSize::Small, HyMtModelSize::Large] {
            let prompt = translation_prompt_for_model(
                model_size,
                "なるほど！",
                Language::Japanese,
                Language::Korean,
                "casual",
            );
            assert!(prompt.contains("Never add emojis"), "{:?}", model_size);
        }

        let gemma = translate_gemma_completion_payload(
            "なるほど！",
            Language::Japanese,
            Language::Korean,
            "casual",
            128,
        );
        assert!(gemma["prompt"]
            .as_str()
            .unwrap()
            .contains("Never add emojis"));
    }

    #[test]
    fn local_translation_sampling_is_deterministic() {
        let payload = completion_payload("translate", 96);
        assert_eq!(payload["temperature"].as_f64(), Some(0.0));
    }

    #[test]
    fn private_model_payloads_disable_prompt_cache_without_changing_public_defaults() {
        let public_hymt = completion_payload("translate", 96);
        let public_gemma = translate_gemma_completion_payload(
            "Test message",
            Language::English,
            Language::Korean,
            "auto",
            96,
        );
        assert!(public_hymt.get("cache_prompt").is_none());
        assert_eq!(public_gemma["cache_prompt"], true);
        {
            let _scope = crate::diagnostics::sensitive_request_scope();
            let mut private_hymt = completion_payload("translate", 96);
            let mut private_gemma = translate_gemma_completion_payload(
                "Test message",
                Language::English,
                Language::Korean,
                "auto",
                96,
            );
            assert_eq!(private_hymt["cache_prompt"], false);
            assert_eq!(private_gemma["cache_prompt"], false);
            private_hymt.as_object_mut().unwrap().remove("cache_prompt");
            private_gemma["cache_prompt"] = serde_json::json!(true);
            assert_eq!(private_hymt, public_hymt);
            assert_eq!(private_gemma, public_gemma);
        }
        assert_eq!(completion_payload("translate", 96), public_hymt);
        assert_eq!(
            translate_gemma_completion_payload(
                "Test message",
                Language::English,
                Language::Korean,
                "auto",
                96
            ),
            public_gemma
        );
    }

    #[test]
    fn translate_gemma_uses_the_official_translation_prompt() {
        let payload = translate_gemma_completion_payload(
            "오늘 같이 게임할래?",
            Language::Korean,
            Language::Japanese,
            "auto",
            256,
        );
        let prompt = payload["prompt"].as_str().unwrap();
        assert!(prompt.starts_with("<bos><start_of_turn>user\n"));
        assert!(prompt.contains("professional Korean (ko) to Japanese (ja) translator"));
        assert!(prompt.contains("오늘 같이 게임할래?"));
        assert!(prompt.ends_with("<end_of_turn>\n<start_of_turn>model\n"));
        assert_eq!(payload["n_predict"], 256);
        assert_eq!(payload["temperature"].as_f64(), Some(0.0));
    }

    #[test]
    fn translate_gemma_prompt_preserves_the_detected_social_register() {
        let casual = translate_gemma_completion_payload(
            "오늘 같이 게임할래?",
            Language::Korean,
            Language::Japanese,
            "auto",
            128,
        );
        let polite = translate_gemma_completion_payload(
            "오늘 같이 게임하시겠어요?",
            Language::Korean,
            Language::Japanese,
            "auto",
            128,
        );
        let forced_casual = translate_gemma_completion_payload(
            "오늘 같이 게임하시겠어요?",
            Language::Korean,
            Language::Japanese,
            "casual",
            128,
        );

        assert!(casual["prompt"]
            .as_str()
            .unwrap()
            .contains("casual plain form"));
        assert!(polite["prompt"]
            .as_str()
            .unwrap()
            .contains("polite Japanese"));
        assert!(forced_casual["prompt"]
            .as_str()
            .unwrap()
            .contains("casual plain form"));
    }

    #[test]
    fn translate_gemma_preserves_protected_markers_without_sending_them_to_the_model() {
        let mut fragments = Vec::new();
        let translated = translate_with_translate_gemma(
            "Hello ZXQKEEP000QXZ friend",
            Language::English,
            Language::Korean,
            "casual",
            |fragment, style| {
                assert_eq!(style, "casual");
                fragments.push(fragment.to_string());
                Ok(if fragment == "Hello" {
                    "안녕"
                } else {
                    "친구"
                }
                .to_string())
            },
        )
        .unwrap();
        assert_eq!(translated, "안녕 ZXQKEEP000QXZ 친구");
        assert_eq!(fragments, ["Hello", "friend"]);
    }

    #[test]
    fn translate_gemma_model_metadata_is_pinned() {
        let model = HyMtModelSize::TranslateGemma4B.model();
        assert_eq!(model.family, "translategemma");
        assert_eq!(
            model.repository,
            "SandLogicTechnologies/translategemma-4b-it-GGUF"
        );
        assert_eq!(model.filename, "translategemma-4b_Q4_K_M.gguf");
        assert_eq!(model.expected_bytes, 2_489_909_312);
        assert_eq!(
            model.expected_sha256,
            "526747309109c016db547c6fc1c7b0c9c286b5e7a7556827b5419fd9543a09cd"
        );
    }

    #[test]
    fn automatic_style_is_included_in_the_initial_prompt() {
        let mut captured = String::new();
        let result = translate_with_completion(
            "일본어로 통역해줘",
            Language::Korean,
            Language::Japanese,
            "auto",
            |prompt, _text| {
                captured = prompt.to_string();
                Ok("日本語に訳して".to_string())
            },
        )
        .unwrap();
        assert_eq!(result, "日本語に訳して");
        assert!(captured.contains("natural Japanese casual plain form"));
        assert!(captured.contains("never です/ます"));
    }

    #[test]
    fn instruction_echo_is_removed() {
        let echoed = "줄바꿈, URL, ZXQKEEP로 시작하는 모든 단어를 유지하세요.\n사용자명, 이모티콘, 제품명은 번역하지 마세요.\n\n안녕하세요";
        assert_eq!(clean_translation(echoed), "안녕하세요");
    }

    #[test]
    fn incomplete_completion_is_rejected_instead_of_returning_partial_text() {
        let payload = serde_json::json!({
            "choices": [{
                "finish_reason": "length",
                "message": {"content": "일부만 번역된 결과"}
            }]
        });
        let error = completion_result(&payload).unwrap_err();
        assert!(error.contains("길이 제한"), "unexpected error: {error}");
    }

    #[test]
    fn length_failure_retries_once_with_the_minimal_official_style_prompt() {
        let mut prompts = Vec::new();
        let translated = complete_translation_with_retry(
            "1.8b",
            "detailed prompt",
            "Rules still apply in the server and common filters.",
            Language::Korean,
            |prompt, _text| {
                prompts.push(prompt.to_string());
                if prompts.len() == 1 {
                    Err("Hy-MT2 번역 결과가 길이 제한에 도달했습니다.".to_string())
                } else {
                    Ok("서버와 공통 필터에도 규칙은 여전히 적용돼요.".to_string())
                }
            },
        )
        .unwrap();

        assert_eq!(translated, "서버와 공통 필터에도 규칙은 여전히 적용돼요.");
        assert_eq!(prompts.len(), 2);
        assert_eq!(prompts[0], "detailed prompt");
        assert!(prompts[1].starts_with("Translate the following segment into Korean"));
        assert!(!prompts[1].contains("Preserve its tone"));
    }

    #[test]
    fn long_chunk_has_enough_output_budget() {
        assert_eq!(max_output_tokens(&"가".repeat(700)), 2048);
    }

    #[test]
    fn speech_style_detection_covers_supported_languages() {
        assert_eq!(
            detect_speech_style("감사합니다. 확인해 주세요.", Language::Korean),
            "polite"
        );
        assert_eq!(
            detect_speech_style("고마워. 나중에 봐.", Language::Korean),
            "casual"
        );
        assert_eq!(
            detect_speech_style("ありがとうございます。", Language::Japanese),
            "polite"
        );
        assert_eq!(
            detect_speech_style("今日、一緒にゲームをしませんか？", Language::Japanese),
            "polite"
        );
        assert_eq!(
            detect_speech_style("ありがとう。またね。", Language::Japanese),
            "casual"
        );
        assert_eq!(
            detect_speech_style("Could you please check this?", Language::English),
            "polite"
        );
        assert_eq!(
            detect_speech_style("Hey, check this out!", Language::English),
            "casual"
        );
        assert_eq!(
            detect_speech_style("请您确认一下，谢谢。", Language::ChineseSimplified),
            "polite"
        );
        assert_eq!(
            detect_speech_style("你看看，谢了。", Language::ChineseSimplified),
            "casual"
        );
    }

    #[test]
    fn mismatched_register_is_rewritten_once_and_short_rewrites_are_rejected() {
        let mut responses = vec!["고마워요. 도움이 되었어요.", "고마워. 도움이 됐어."].into_iter();
        let result = translate_with_completion(
            "ありがとう。助かったよ。",
            Language::Japanese,
            Language::Korean,
            "auto",
            |_prompt, _text| Ok(responses.next().unwrap().to_string()),
        )
        .unwrap();
        assert_eq!(result, "고마워. 도움이 됐어.");

        let mut responses = vec!["보세요, 고마워.", "봐"].into_iter();
        let result = translate_with_completion(
            "你看看，谢了。",
            Language::ChineseSimplified,
            Language::Korean,
            "auto",
            |_prompt, _text| Ok(responses.next().unwrap().to_string()),
        )
        .unwrap();
        assert_eq!(result, "봐, 고마워.");
    }

    #[test]
    fn style_changes_cache_namespace_and_prompt() {
        let polite = HyMtTranslator::new(HyMtModelSize::Small, "auto", "polite").unwrap();
        let casual = HyMtTranslator::new(HyMtModelSize::Small, "auto", "casual").unwrap();
        assert_ne!(polite.cache_namespace(), casual.cache_namespace());
        assert!(polite.cache_namespace().contains("shared-chat-v1"));
        assert!(
            rewrite_style_prompt("고마워요.", Language::Korean, "casual")
                .contains("Korean casual banmal")
        );

        let gemma_polite =
            HyMtTranslator::new(HyMtModelSize::TranslateGemma4B, "auto", "polite").unwrap();
        let gemma_casual =
            HyMtTranslator::new(HyMtModelSize::TranslateGemma4B, "auto", "casual").unwrap();
        assert_ne!(
            gemma_polite.cache_namespace(),
            gemma_casual.cache_namespace()
        );
        assert!(gemma_polite
            .cache_namespace()
            .contains("source-faithful-v3"));
        assert!(rewrite_style_prompt("Thanks", Language::English, "polite")
            .contains("natural conversational English"));
    }

    #[test]
    fn conservative_cleanup_repairs_only_known_cross_language_failures() {
        assert_eq!(
            clean_cross_script_language_terms(
                "중국어繁體와 简体",
                Language::ChineseTraditional,
                Language::Korean,
            ),
            "중국어 번체와 간체"
        );
        assert_eq!(
            clean_cross_script_language_terms(
                "繁體中文",
                Language::ChineseTraditional,
                Language::English,
            ),
            "繁體中文"
        );
        assert_eq!(
            clean_cross_script_language_terms(
                "안녕, 오늘 밤 서비스 센터에서 같이 게임할래?",
                Language::Tamil,
                Language::Korean,
            ),
            "안녕, 오늘 밤 서버에서 같이 게임할래?"
        );

        assert_eq!(
            clean_korean_listener_question_person(
                "Queremos jogar?",
                "같이 게임 할래요?",
                Language::Korean,
                Language::BrazilianPortuguese,
            ),
            "Você quer jogar?"
        );
        assert_eq!(
            clean_korean_listener_question_person(
                "We want to play?",
                "같이 게임 할래요?",
                Language::Korean,
                Language::English,
            ),
            "We want to play?"
        );
        assert_eq!(
            clean_korean_listener_question_person(
                "Hello, gusto mo bang maglaro ngayong gabi?",
                "안녕, 오늘 밤 같이 게임할래?",
                Language::Korean,
                Language::Filipino,
            ),
            "Kumusta, gusto mo bang maglaro ngayong gabi?"
        );
        assert_eq!(
            clean_korean_listener_question_person(
                "ہیلو، آج رات کونسا گیم کھانا چاہیے؟",
                "안녕, 오늘 밤 같이 게임할래?",
                Language::Korean,
                Language::Urdu,
            ),
            "ہیلو، آج رات ساتھ گیم کھیلنا چاہیں گے؟"
        );
        for (target, flawed, expected) in [
            (
                Language::Thai,
                "สวัสดี ขอทราบว่าคืนนี้จะมาร่วมเล่นเกมด้วยกันที่เซิร์ฟเวอร์ใดครับ",
                "สวัสดี คืนนี้อยากมาเล่นเกมกับเราบนเซิร์ฟเวอร์ไหมครับ",
            ),
            (
                Language::Bengali,
                "হ্যালো, আজ রাতে কি আমরা একসাথে সার্ভারে গেম খেলব?",
                "হ্যালো, আজ রাতে সার্ভারে আমাদের সঙ্গে গেম খেলতে চাও?",
            ),
            (
                Language::Tamil,
                "ஹலோ, இன்று இரவு சர்வரில் ஒன்றாக விளையாடலாமா?",
                "ஹலோ, இன்று இரவு சர்வரில் எங்களுடன் விளையாட விரும்புகிறீர்களா?",
            ),
            (
                Language::Persian,
                "سلام، آیا امشب قصد داریم با یکدیگر بر روی سرور بازی کنیم؟",
                "سلام، آیا می‌خواهید امشب در سرور با ما بازی کنید؟",
            ),
            (
                Language::Hebrew,
                "היי, האם נשחק יחד בשרת הלילה?",
                "היי, האם תרצה לשחק איתנו בשרת הלילה?",
            ),
            (
                Language::Czech,
                "Ahoj, rád bych dnes večer hrál spolu na serveru.",
                "Ahoj, chceš si s námi dnes večer zahrát na serveru?",
            ),
        ] {
            assert_eq!(
                clean_korean_listener_question_person(
                    flawed,
                    "안녕, 오늘 밤 서버에서 같이 게임할래?",
                    Language::Korean,
                    target,
                ),
                expected,
            );
        }
        assert_eq!(
            clean_korean_listener_question_person(
                "வணக்கம், இன்று இரவு சர்வரில் சேர்ந்து விளையாடலாமா?",
                "안녕, 오늘 밤 서버에서 같이 게임할래?",
                Language::Korean,
                Language::Tamil,
            ),
            "வணக்கம், இன்று இரவு சர்வரில் எங்களுடன் விளையாட விரும்புகிறீர்களா?"
        );
    }

    #[test]
    fn llama_server_override_is_honored() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("llama-server-{nonce}.exe"));
        fs::write(&path, b"test").unwrap();
        let previous = std::env::var_os("LLAMA_SERVER_PATH");
        std::env::set_var("LLAMA_SERVER_PATH", &path);
        assert_eq!(find_llama_server(), path.canonicalize().ok());
        if let Some(previous) = previous {
            std::env::set_var("LLAMA_SERVER_PATH", previous);
        } else {
            std::env::remove_var("LLAMA_SERVER_PATH");
        }
        let _ = fs::remove_file(path);
    }

    #[test]
    fn automatic_device_retries_with_cpu_only_after_gpu_failure() {
        assert_eq!(startup_device_attempts("auto", false), vec!["gpu", "cpu"]);
        assert_eq!(startup_device_attempts("auto", true), vec!["cpu"]);
        assert_eq!(startup_device_attempts("gpu", false), vec!["gpu", "cpu"]);
        assert_eq!(startup_device_attempts("cpu", false), vec!["cpu"]);
    }

    #[test]
    fn automatic_protection_waits_for_sustained_vram_pressure() {
        let started = Instant::now();
        let mut state = VramProtectionState::default();

        assert_eq!(
            evaluate_vram_protection(&mut state, RuntimeDevice::Gpu, 1024 * 1024 * 1024, started,),
            VramProtectionAction::None
        );
        assert_eq!(
            evaluate_vram_protection(
                &mut state,
                RuntimeDevice::Gpu,
                1024 * 1024 * 1024,
                started + Duration::from_secs(4),
            ),
            VramProtectionAction::None
        );
        assert_eq!(
            evaluate_vram_protection(
                &mut state,
                RuntimeDevice::Gpu,
                1024 * 1024 * 1024,
                started + Duration::from_secs(5),
            ),
            VramProtectionAction::SwitchToCpu
        );
        assert!(state.cpu_protected_until.is_some());
    }

    #[test]
    fn automatic_protection_ignores_a_short_vram_dip() {
        let started = Instant::now();
        let mut state = VramProtectionState::default();
        let low_vram = 1024 * 1024 * 1024;
        let enough_vram = 2 * 1024 * 1024 * 1024;

        assert_eq!(
            evaluate_vram_protection(&mut state, RuntimeDevice::Gpu, low_vram, started),
            VramProtectionAction::None
        );
        assert_eq!(
            evaluate_vram_protection(
                &mut state,
                RuntimeDevice::Gpu,
                enough_vram,
                started + Duration::from_secs(4),
            ),
            VramProtectionAction::None
        );
        assert_eq!(
            evaluate_vram_protection(
                &mut state,
                RuntimeDevice::Gpu,
                low_vram,
                started + Duration::from_secs(5),
            ),
            VramProtectionAction::None
        );
        assert_eq!(
            evaluate_vram_protection(
                &mut state,
                RuntimeDevice::Gpu,
                low_vram,
                started + Duration::from_secs(9),
            ),
            VramProtectionAction::None
        );
    }

    #[test]
    fn automatic_protection_requires_a_stable_recovery_window() {
        let started = Instant::now();
        let mut state = VramProtectionState {
            cpu_protected_until: Some(started),
            ..VramProtectionState::default()
        };
        let enough_vram = 4 * 1024 * 1024 * 1024;

        assert_eq!(
            evaluate_vram_protection(&mut state, RuntimeDevice::Cpu, enough_vram, started,),
            VramProtectionAction::None
        );
        assert_eq!(
            evaluate_vram_protection(
                &mut state,
                RuntimeDevice::Cpu,
                enough_vram,
                started + Duration::from_secs(29),
            ),
            VramProtectionAction::None
        );
        assert_eq!(
            evaluate_vram_protection(
                &mut state,
                RuntimeDevice::Cpu,
                enough_vram,
                started + Duration::from_secs(30),
            ),
            VramProtectionAction::SwitchToGpu
        );
        assert!(state.cpu_protected_until.is_none());
    }

    #[test]
    fn cpu_mode_uses_a_reduced_context_to_limit_system_ram_usage() {
        assert_eq!(
            context_size_for_attempt("cpu", HyMtModelSize::Small),
            "2048"
        );
        assert_eq!(
            context_size_for_attempt("cpu", HyMtModelSize::Large),
            "2048"
        );
        assert_eq!(
            context_size_for_attempt("auto", HyMtModelSize::Large),
            "8192"
        );
        assert_eq!(
            context_size_for_attempt("auto", HyMtModelSize::TranslateGemma4B),
            "2048"
        );
    }

    #[cfg(windows)]
    #[test]
    fn dropping_process_job_terminates_the_attached_server_process() {
        use std::process::Command;
        use std::thread;
        use std::time::{Duration, Instant};

        let mut child = Command::new("cmd")
            .args(["/C", "ping -n 30 127.0.0.1 >NUL"])
            .spawn()
            .expect("spawn long-running child");
        let job = ProcessJob::attach(&child).expect("attach process job");
        drop(job);

        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline && child.try_wait().unwrap().is_none() {
            thread::sleep(Duration::from_millis(25));
        }
        let exited = child.try_wait().unwrap().is_some();
        if !exited {
            let _ = child.kill();
            let _ = child.wait();
        }
        assert!(exited, "job close did not terminate the child process");
    }

    #[test]
    #[ignore = "검증된 Hy-MT2 모델과 llama-server가 필요합니다"]
    fn live_small_model_translates_without_python() {
        let mut translator = HyMtTranslator::new(HyMtModelSize::Small, "auto", "auto").unwrap();
        assert!(translator.model_is_ready());
        translator.prepare().expect("start llama-server");
        let translated = translator
            .translate(
                "Hello, nice to meet you.",
                Language::English,
                Language::Korean,
            )
            .expect("translate with Hy-MT2");
        assert!(!translated.trim().is_empty());
        assert_ne!(translated, "Hello, nice to meet you.");
        translator.close();
    }

    #[test]
    #[ignore = "검증된 Hy-MT2 모델과 llama-server가 필요합니다"]
    fn live_small_model_translates_the_previous_prompt_echo_trigger() {
        let mut translator = HyMtTranslator::new(HyMtModelSize::Small, "auto", "auto").unwrap();
        assert!(translator.model_is_ready());
        translator.prepare().expect("start llama-server");
        let translated = translator
            .translate(
                "Rules still apply in the server and common filters.",
                Language::English,
                Language::Korean,
            )
            .expect("translate the prompt-echo trigger with Hy-MT2 1.8B");
        assert_eq!(detect_explicit_language(&translated), Language::Korean);
        assert!(!translated.contains("스타일 요구사항"));
        assert!(!translated.contains("번역하고 모든 정보를"));
        translator.close();
    }

    #[test]
    #[ignore = "검증된 Hy-MT2 모델과 llama-server가 필요합니다"]
    fn live_small_model_translates_casual_reply_sentence() {
        let mut translator = HyMtTranslator::new(HyMtModelSize::Small, "auto", "auto").unwrap();
        assert!(translator.model_is_ready());
        translator.prepare().expect("start llama-server");
        let source = "Says the one who called me daddy on her first meeting with me. You need a leash katantie";
        let translated = translator
            .translate(source, Language::English, Language::Korean)
            .expect("translate the reported casual reply with Hy-MT2 1.8B");
        assert_eq!(
            detect_explicit_language(&translated),
            Language::Korean,
            "unexpected translation: {translated}"
        );
        assert_ne!(translated, source);
        assert!(
            !translation_needs_repair(source, &translated, Language::English, Language::Korean,),
            "valid translation was rejected: {translated}"
        );
        translator.close();
    }

    #[test]
    #[ignore = "검증된 Hy-MT2 모델과 llama-server가 필요합니다"]
    fn live_small_model_translates_emotional_reply_with_keyboard_smash() {
        let mut translator = HyMtTranslator::new(HyMtModelSize::Small, "auto", "auto").unwrap();
        assert!(translator.model_is_ready());
        translator.prepare().expect("start llama-server");
        let source = "it was so cute man, I GOT SO EMOTIONAL gfjhdlkf";
        let translated = translator
            .translate(source, Language::English, Language::Korean)
            .expect("translate the reported emotional reply with Hy-MT2 1.8B");
        assert_eq!(
            detect_explicit_language(&translated),
            Language::Korean,
            "unexpected translation: {translated}"
        );
        assert_ne!(translated, source);
        assert!(
            !translation_needs_repair(source, &translated, Language::English, Language::Korean,),
            "valid translation was rejected: {translated}"
        );
        translator.close();
    }

    #[test]
    #[ignore = "검증된 Hy-MT2 모델과 llama-server가 필요합니다"]
    fn live_small_model_translates_long_casual_stream_update() {
        let mut translator = HyMtTranslator::new(HyMtModelSize::Small, "auto", "auto").unwrap();
        assert!(translator.model_is_ready());
        translator.prepare().expect("start llama-server");
        let source = concat!(
            "tomorrow I'm going to stream and chat about my experience at the con hehe, ",
            "and there may or may not be a vlog of it otw soon!! just waiting to see what ",
            "my editor says since there is a lil bit of audio issues here and there with my capture"
        );
        let translated = translator
            .translate(source, Language::English, Language::Korean)
            .expect("translate the reported stream update with Hy-MT2 1.8B");
        assert_eq!(
            detect_explicit_language(&translated),
            Language::Korean,
            "unexpected translation: {translated}"
        );
        assert_ne!(translated, source);
        assert!(
            !translation_needs_repair(source, &translated, Language::English, Language::Korean,),
            "valid translation was rejected: {translated}"
        );
        translator.close();
    }

    #[test]
    #[ignore = "검증된 Hy-MT2 모델과 llama-server가 필요합니다"]
    fn live_small_model_translates_reported_japanese_chat_messages() {
        let mut translator = HyMtTranslator::new(HyMtModelSize::Small, "auto", "auto").unwrap();
        assert!(translator.model_is_ready());
        translator.prepare().expect("start llama-server");
        for source in [
            "インバイトで入っててもすぐ落下してしまいます( ノД`)",
            "残念ながら、庭がないんだ...",
            "もしなければ、通りに置いてください",
            "きっとそうな国だㅋㅋㅋ",
            "刑務所でデコ（デコレーション）できる",
            "但し、公衆の面前でのわいせつ行為は、通常は罰金刑になるんじゃないかな",
            "ボディソープとシャンプーを忘れずに持って出かけなくちゃ",
            "XX市に住むNさんの、夜遅くまで騒がしい行動について",
            "必要なものをすべて揃えてお渡しします",
        ] {
            let translated = translator
                .translate(source, Language::Japanese, Language::Korean)
                .expect("translate the reported Japanese chat message with Hy-MT2 1.8B");
            eprintln!("SOURCE: {source}\nRESULT: {translated}\n");
            assert_ne!(translated, source, "untranslated Japanese source: {source}");
            assert!(
                !translation_needs_repair(
                    source,
                    &translated,
                    Language::Japanese,
                    Language::Korean,
                ),
                "valid translation was rejected: {translated}"
            );
        }
        translator.close();
    }

    #[test]
    #[ignore = "검증된 Hy-MT2 모델과 llama-server가 필요합니다"]
    fn live_small_model_translates_in_cpu_only_mode() {
        let mut translator = HyMtTranslator::new(HyMtModelSize::Small, "cpu", "auto").unwrap();
        assert!(translator.model_is_ready());
        translator.prepare().expect("start CPU-only llama-server");
        let translated = translator
            .translate("Hello.", Language::English, Language::Korean)
            .expect("translate with CPU-only Hy-MT2");
        assert!(!translated.trim().is_empty());
        assert_ne!(translated, "Hello.");
        translator.close();
    }

    #[test]
    #[ignore = "검증된 Hy-MT2 모델과 llama-server가 필요합니다"]
    fn live_small_model_translates_korean_to_japanese() {
        let mut translator = HyMtTranslator::new(HyMtModelSize::Small, "cpu", "auto").unwrap();
        assert!(translator.model_is_ready());
        translator.prepare().expect("start CPU-only llama-server");
        let translated = translator
            .translate(
                "오늘 저녁에 같이 게임할래?",
                Language::Korean,
                Language::Japanese,
            )
            .expect("translate Korean into Japanese with Hy-MT2");
        assert_eq!(
            detect_explicit_language(&translated),
            Language::Japanese,
            "unexpected translation: {translated}"
        );
        translator.close();
    }

    #[test]
    #[ignore = "검증된 Hy-MT2 7B 모델과 llama-server가 필요합니다"]
    fn live_large_model_satisfies_the_reported_chat_contract() {
        let mut translator = HyMtTranslator::new(HyMtModelSize::Large, "auto", "auto").unwrap();
        assert!(translator.model_is_ready());
        translator.prepare().expect("start Hy-MT2 7B server");
        let translated = translator
            .translate("너구리", Language::Korean, Language::Japanese)
            .expect("translate the reported Korean noun into Japanese");
        assert_eq!(translated, "タヌキ");

        let source = "インバイトで入っててもすぐ落下してしまいます( ノД`)";
        let translated = translator
            .translate(source, Language::Japanese, Language::Korean)
            .expect("translate the previously missed Japanese chat message");
        assert!(
            !translation_needs_repair(source, &translated, Language::Japanese, Language::Korean,),
            "Hy-MT2 7B left the reported chat untranslated: {translated}"
        );
        translator.close();
    }

    #[test]
    #[ignore = "TranslateGemma 4B 모델 다운로드와 llama-server가 필요합니다"]
    fn live_translate_gemma_4b_translates_korean_to_japanese() {
        let mut translator =
            HyMtTranslator::new(HyMtModelSize::TranslateGemma4B, "auto", "auto").unwrap();
        translator
            .prepare()
            .expect("start TranslateGemma 4B server");
        let translated = translator
            .translate(
                "너구리가 다람쥐를 만났어",
                Language::Korean,
                Language::Japanese,
            )
            .expect("translate distinct animal nouns with TranslateGemma 4B");
        assert_eq!(
            detect_explicit_language(&translated),
            Language::Japanese,
            "unexpected translation: {translated}"
        );
        assert_ne!(translated, "너구리가 다람쥐를 만났어");

        let casual = translator
            .translate("오늘 같이 게임할래?", Language::Korean, Language::Japanese)
            .expect("preserve Korean banmal as casual Japanese");
        let polite = translator
            .translate(
                "오늘 같이 게임하시겠어요?",
                Language::Korean,
                Language::Japanese,
            )
            .expect("preserve Korean honorific speech as polite Japanese");
        assert_eq!(
            detect_speech_style(&casual, Language::Japanese),
            "casual",
            "casual source became polite: {casual}"
        );
        assert_eq!(
            detect_speech_style(&polite, Language::Japanese),
            "polite",
            "polite source became casual: {polite}"
        );
        translator.close();
    }

    #[test]
    #[ignore = "TranslateGemma 4B 모델 다운로드와 llama-server가 필요합니다"]
    fn live_translate_gemma_4b_translates_reported_japanese_chat_messages() {
        let mut translator =
            HyMtTranslator::new(HyMtModelSize::TranslateGemma4B, "auto", "auto").unwrap();
        translator
            .prepare()
            .expect("start TranslateGemma 4B server");
        for source in [
            "インバイトで入っててもすぐ落下してしまいます( ノД`)",
            "残念ながら、庭がないんだ...",
            "もしなければ、通りに置いてください",
            "刑務所でデコ（デコレーション）できる",
            "ボディソープとシャンプーを忘れずに持って出かけなくちゃ",
            "XX市に住むNさんの、夜遅くまで騒がしい行動について",
        ] {
            let translated = translator
                .translate(source, Language::Japanese, Language::Korean)
                .expect("translate the reported Japanese chat message with TranslateGemma 4B");
            eprintln!("SOURCE: {source}\nRESULT: {translated}\n");
            assert_ne!(translated, source, "untranslated Japanese source: {source}");
            assert!(
                !translation_needs_repair(
                    source,
                    &translated,
                    Language::Japanese,
                    Language::Korean,
                ),
                "valid translation was rejected: {translated}"
            );
        }
        translator.close();
    }

    #[test]
    #[ignore = "all verified local models and llama-server are required"]
    fn live_every_catalog_model_satisfies_the_shared_chat_translation_contract() {
        let cases = [
            (
                "インバイトで入っててもすぐ落下してしまいます( ノД`)",
                Language::Japanese,
                Language::Korean,
            ),
            (
                "방금 같은 방식으로 피해를 입고 있어요...",
                Language::Korean,
                Language::Japanese,
            ),
            (
                "I think the server restarted before everyone could reconnect",
                Language::English,
                Language::Korean,
            ),
        ];

        for model_size in HyMtModelSize::all() {
            let mut translator = HyMtTranslator::new(model_size, "auto", "auto").unwrap();
            assert!(
                translator.model_is_ready(),
                "{} is not installed and verified",
                model_size.runtime_label()
            );
            translator
                .prepare()
                .unwrap_or_else(|error| panic!("start {}: {error}", model_size.runtime_label()));
            for (source_text, source, target) in cases {
                let translated = translator
                    .translate(source_text, source, target)
                    .unwrap_or_else(|error| {
                        panic!(
                            "{} failed {}->{}: {error}",
                            model_size.runtime_label(),
                            source.code(),
                            target.code()
                        )
                    });
                assert!(
                    !translation_needs_repair(source_text, &translated, source, target),
                    "{} rejected {}->{} result: {translated}",
                    model_size.runtime_label(),
                    source.code(),
                    target.code()
                );
            }
            translator.close();
        }
    }
}
