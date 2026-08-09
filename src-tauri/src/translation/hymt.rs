use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::LazyLock;
use std::thread;
use std::time::{Duration, Instant};

use fs2::available_space;
use regex::Regex;
use reqwest::blocking::Client;
use reqwest::header::RANGE;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::language::Language;

use super::Translator;

const PROMPT_VERSION: &str = "register-aware-v3";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HyMtModelSize {
    Small,
    Large,
}

#[derive(Clone, Copy, Debug)]
pub struct HyMtModel {
    pub key: &'static str,
    pub label: &'static str,
    pub repository: &'static str,
    pub filename: &'static str,
    pub expected_bytes: u64,
    pub expected_sha256: &'static str,
}

impl HyMtModelSize {
    pub fn model(self) -> HyMtModel {
        match self {
            Self::Small => HyMtModel {
                key: "1.8b",
                label: "Hy-MT2 1.8B Q4_K_M",
                repository: "tencent/Hy-MT2-1.8B-GGUF",
                filename: "Hy-MT2-1.8B-Q4_K_M.gguf",
                expected_bytes: 1_133_080_448,
                expected_sha256: "dc5f44fcf1fa496ee7ad725982c0c8c553a4de00259b53af84c4b89fb0c06699",
            },
            Self::Large => HyMtModel {
                key: "7b",
                label: "Hy-MT2 7B Q4_K_M",
                repository: "tencent/Hy-MT2-7B-GGUF",
                filename: "Hy-MT2-7B-Q4_K_M.gguf",
                expected_bytes: 4_624_648_896,
                expected_sha256: "9f96256500f3fc1ab4d64336b58f52a949a95ad7516b0c229476eef782f9f77b",
            },
        }
    }
}

pub struct HyMtTranslator {
    model: HyMtModel,
    device: String,
    speech_style: String,
    model_path: PathBuf,
    server_path: Option<PathBuf>,
    startup_timeout: Duration,
    request_timeout: Duration,
    display_name: String,
    cache_namespace: String,
    process: Option<Child>,
    port: u16,
    client: Client,
}

impl HyMtTranslator {
    pub fn new(
        model_size: HyMtModelSize,
        device: impl Into<String>,
        speech_style: impl Into<String>,
    ) -> Result<Self, String> {
        let model = model_size.model();
        let device = device.into();
        if !matches!(device.as_str(), "auto" | "cpu") {
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
        Ok(Self {
            model,
            device,
            speech_style: speech_style.clone(),
            model_path: default_model_path(model),
            server_path: None,
            startup_timeout: Duration::from_secs(240),
            request_timeout: Duration::from_secs(90),
            display_name: format!("{} (로컬)", model.label),
            cache_namespace: format!(
                "hy-mt2:{}:q4_k_m:{PROMPT_VERSION}:{speech_style}",
                model.key
            ),
            process: None,
            port: 0,
            client,
        })
    }

    pub fn with_paths(mut self, model_path: PathBuf, server_path: Option<PathBuf>) -> Self {
        self.model_path = model_path;
        self.server_path = server_path;
        self
    }

    pub fn model_path(&self) -> &Path {
        &self.model_path
    }

    fn ensure_server(&mut self) -> Result<(), String> {
        if self
            .process
            .as_mut()
            .is_some_and(|process| process.try_wait().ok().flatten().is_none())
        {
            return Ok(());
        }
        self.ensure_model()?;
        let executable = self
            .server_path
            .clone()
            .or_else(find_llama_server)
            .ok_or_else(|| {
                "llama.cpp 실행 파일이 없습니다. PowerShell에서 `scripts\\setup_hymt_runtime.ps1`을 한 번 실행하십시오."
                    .to_string()
            })?;
        self.port = free_tcp_port()?;
        let log_path = default_server_log_path(self.model);
        if let Some(parent) = log_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Hy-MT2 로그 폴더를 만들지 못했습니다: {error}"))?;
        }
        let attempts = startup_device_attempts(&self.device);
        for (index, attempt) in attempts.iter().enumerate() {
            let log = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .map_err(|error| format!("Hy-MT2 로그 파일을 열지 못했습니다: {error}"))?;
            let mut marker = log
                .try_clone()
                .map_err(|error| format!("Hy-MT2 로그 파일을 복제하지 못했습니다: {error}"))?;
            writeln!(marker, "\n[Nude Translator] Hy-MT2 {} 모드 시작", attempt)
                .map_err(|error| format!("Hy-MT2 로그를 기록하지 못했습니다: {error}"))?;
            let stderr = log
                .try_clone()
                .map_err(|error| format!("Hy-MT2 로그 파일을 복제하지 못했습니다: {error}"))?;
            let mut command = Command::new(&executable);
            command.args([
                "--model",
                self.model_path
                    .to_str()
                    .ok_or_else(|| "Hy-MT2 모델 경로를 UTF-8로 표현하지 못했습니다.".to_string())?,
                "--host",
                "127.0.0.1",
                "--port",
                &self.port.to_string(),
                "--ctx-size",
                "2048",
                "--parallel",
                "1",
            ]);
            if *attempt == "cpu" {
                command.args(["--device", "none", "--gpu-layers", "0", "--no-op-offload"]);
            } else {
                command.args(["--gpu-layers", "auto"]);
            }
            command
                .arg("--no-webui")
                .stdin(Stdio::null())
                .stdout(Stdio::from(log))
                .stderr(Stdio::from(stderr));
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(CREATE_NO_WINDOW);
            }
            self.process = Some(
                command
                    .spawn()
                    .map_err(|error| format!("Hy-MT2 로컬 서버를 시작하지 못했습니다: {error}"))?,
            );
            let deadline = Instant::now() + self.startup_timeout;
            while Instant::now() < deadline {
                if let Some(status) = self
                    .process
                    .as_mut()
                    .and_then(|process| process.try_wait().ok().flatten())
                {
                    self.process = None;
                    if index + 1 < attempts.len() {
                        let mut log = OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(&log_path)
                            .map_err(|error| {
                                format!("Hy-MT2 로그 파일을 열지 못했습니다: {error}")
                            })?;
                        writeln!(
                            log,
                            "[Nude Translator] GPU 서버가 종료되어 CPU 모드로 다시 시작합니다. 종료 상태: {status}"
                        )
                        .map_err(|error| format!("Hy-MT2 로그를 기록하지 못했습니다: {error}"))?;
                        break;
                    }
                    return Err(format!(
                        "Hy-MT2 로컬 서버가 시작 중 종료되었습니다. 종료 상태: {status}. 로그: {}",
                        log_path.display()
                    ));
                }
                if self
                    .client
                    .get(format!("http://127.0.0.1:{}/health", self.port))
                    .timeout(Duration::from_secs(1))
                    .send()
                    .is_ok_and(|response| response.status().is_success())
                {
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(250));
            }
            if self.process.is_some() {
                self.close();
                return Err(format!(
                    "Hy-MT2 모델을 {}초 안에 불러오지 못했습니다. 로그: {}",
                    self.startup_timeout.as_secs(),
                    log_path.display()
                ));
            }
        }
        Err(format!(
            "Hy-MT2 로컬 서버를 시작하지 못했습니다. 로그: {}",
            log_path.display()
        ))
    }

    fn ensure_model(&self) -> Result<(), String> {
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
                .map_err(|error| format!("손상된 Hy-MT2 모델을 삭제하지 못했습니다: {error}"))?;
        }
        let parent = self
            .model_path
            .parent()
            .ok_or_else(|| "Hy-MT2 모델 폴더를 찾지 못했습니다.".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Hy-MT2 모델 폴더를 만들지 못했습니다: {error}"))?;
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
        let url = format!(
            "https://huggingface.co/{}/resolve/main/{}?download=true",
            self.model.repository, self.model.filename
        );
        let download_client = Client::builder()
            .connect_timeout(Duration::from_secs(30))
            .timeout(None)
            .build()
            .map_err(|error| format!("모델 다운로드 클라이언트를 만들지 못했습니다: {error}"))?;
        let mut request = download_client.get(url);
        if downloaded > 0 {
            request = request.header(RANGE, format!("bytes={downloaded}-"));
        }
        let mut response = request
            .send()
            .and_then(|response| response.error_for_status())
            .map_err(|error| format!("Hy-MT2 모델 다운로드에 실패했습니다: {error}"))?;
        let append = downloaded > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
        if !append {
            downloaded = 0;
        }
        let mut output = OpenOptions::new()
            .create(true)
            .write(true)
            .append(append)
            .truncate(!append)
            .open(&partial)
            .map_err(|error| format!("Hy-MT2 모델 임시 파일을 열지 못했습니다: {error}"))?;
        let mut buffer = vec![0_u8; 1024 * 1024];
        loop {
            let count = response
                .read(&mut buffer)
                .map_err(|error| format!("Hy-MT2 모델을 내려받지 못했습니다: {error}"))?;
            if count == 0 {
                break;
            }
            output
                .write_all(&buffer[..count])
                .map_err(|error| format!("Hy-MT2 모델을 저장하지 못했습니다: {error}"))?;
            downloaded += count as u64;
        }
        output
            .flush()
            .map_err(|error| format!("Hy-MT2 모델 파일을 마무리하지 못했습니다: {error}"))?;
        if downloaded != self.model.expected_bytes {
            return Err(format!(
                "Hy-MT2 모델 다운로드 크기가 일치하지 않습니다({downloaded}/{} bytes).",
                self.model.expected_bytes
            ));
        }
        let actual_hash = file_sha256(&partial)?;
        if actual_hash != self.model.expected_sha256 {
            let _ = fs::remove_file(&partial);
            return Err(
                "Hy-MT2 모델 무결성 검증에 실패했습니다. 손상된 다운로드 파일을 삭제했습니다."
                    .to_string(),
            );
        }
        fs::rename(&partial, &self.model_path)
            .map_err(|error| format!("Hy-MT2 모델 파일을 적용하지 못했습니다: {error}"))?;
        fs::write(hash_marker(&self.model_path), actual_hash)
            .map_err(|error| format!("Hy-MT2 검증 표식을 저장하지 못했습니다: {error}"))
    }

    fn complete(&self, prompt: &str, text: &str) -> Result<String, String> {
        let response = self
            .client
            .post(format!(
                "http://127.0.0.1:{}/v1/chat/completions",
                self.port
            ))
            .timeout(self.request_timeout)
            .json(&json!({
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_output_tokens(text),
                "temperature": 0.2,
                "top_p": 0.6,
                "top_k": 20,
                "repeat_penalty": 1.05,
            }))
            .send()
            .and_then(|response| response.error_for_status())
            .map_err(|error| format!("Hy-MT2 번역 요청이 실패했습니다: {error}"))?;
        let payload: Value = response
            .json()
            .map_err(|error| format!("Hy-MT2 번역 응답을 읽지 못했습니다: {error}"))?;
        let content = payload
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let result = clean_translation(content);
        if result.is_empty() {
            Err("Hy-MT2가 번역문 대신 지시문 또는 빈 결과를 반환했습니다.".to_string())
        } else {
            Ok(result)
        }
    }
}

fn startup_device_attempts(device: &str) -> Vec<&'static str> {
    if device == "auto" {
        vec!["auto", "cpu"]
    } else {
        vec!["cpu"]
    }
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
        self.ensure_server()?;
        let style = self.speech_style.clone();
        translate_with_completion(text, source, target, &style, |prompt, fragment| {
            self.complete(prompt, fragment)
        })
    }

    fn close(&mut self) {
        if let Some(mut process) = self.process.take() {
            if process.try_wait().ok().flatten().is_none() {
                let _ = process.kill();
                let _ = process.wait();
            }
        }
        self.port = 0;
    }
}

impl Drop for HyMtTranslator {
    fn drop(&mut self) {
        self.close();
    }
}

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
        let prompt = translation_prompt(core, source, target);
        let mut result = complete(&prompt, core)?;
        if matches!(resolved_style, "polite" | "casual")
            && (detect_speech_style(&result, target) != resolved_style
                || has_register_artifact(&result, target))
        {
            let rewritten = complete(
                &rewrite_style_prompt(&result, target, resolved_style),
                &result,
            )?;
            if rewrite_preserves_content(&result, &rewritten) {
                result = rewritten;
            } else {
                result = fallback_register_cleanup(&result, target, resolved_style);
            }
        }
        result = fallback_register_cleanup(&result, target, resolved_style);
        result = clean_register_artifacts(&result, target);
        output.push_str(&part[..leading_len]);
        output.push_str(&result);
        output.push_str(&part[trailing_start..]);
    }
    Ok(output)
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
            if Regex::new(r"(?:です|ます|ました|ません|でしょう|ください|ございます|お願い(?:し)?ます)(?:[,，。！？!?、…]|$)")
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
        Language::Unknown => "neutral",
    }
}

fn translation_prompt(text: &str, source: Language, target: Language) -> String {
    format!(
        "Translate the following {} text into {}.\n\
         Translate every clause and preserve every piece of information without adding or omitting anything.\n\
         Preserve paragraph boundaries and line breaks where possible.\n\
         Only output the translated result without an explanation.\n\n{}",
        source.english_name(),
        target.english_name(),
        text
    )
}

pub fn rewrite_style_prompt(text: &str, target: Language, style: &str) -> String {
    format!(
        "Rewrite the following {} text to meet this style requirement.\nStyle requirement: {}\n\
         Keep the meaning unchanged. Only output the rewritten text without an explanation.\n\n{}",
        target.english_name(),
        style_requirement(target, style),
        text
    )
}

fn style_requirement(target: Language, style: &str) -> &'static str {
    match (style, target) {
        ("polite", Language::Korean) => "Use polite Korean honorific speech (존댓말) with natural 요/습니다 endings; never use casual banmal.",
        ("polite", Language::Japanese) => "Use polite Japanese 丁寧語. The output must use です/ます/ました forms and convert casual expressions into polite expressions. Never combine endings as ましたです or でしたです; use ました or でした.",
        ("polite", Language::English) => "Use polite/formal English appropriate for respectfully addressing someone.",
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
    (text.chars().count() * 3).clamp(96, 768)
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
            .join("DiscordTranslateOverlay")
            .join("Cache");
    }
    #[cfg(target_os = "macos")]
    if let Some(home) = env::var_os("HOME") {
        return PathBuf::from(home)
            .join("Library")
            .join("Caches")
            .join("DiscordTranslateOverlay");
    }
    env::temp_dir().join("DiscordTranslateOverlay")
}

fn default_model_path(model: HyMtModel) -> PathBuf {
    if let Some(path) = bundled_model_path(model) {
        return path;
    }
    default_cache_root()
        .join("models")
        .join("hy-mt2")
        .join(model.key)
        .join(model.filename)
}

fn bundled_model_path(model: HyMtModel) -> Option<PathBuf> {
    let executable = env::current_exe().ok()?;
    let parent = executable.parent()?;
    let adjacent = parent
        .join("runtime")
        .join("models")
        .join("hy-mt2")
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
            .join("hy-mt2")
            .join(model.key)
            .join(model.filename);
        if resource.is_file() {
            return Some(resource);
        }
    }
    None
}

fn default_server_log_path(model: HyMtModel) -> PathBuf {
    default_cache_root().join(format!("hy-mt2-{}-server.log", model.key))
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
        File::open(path).map_err(|error| format!("Hy-MT2 모델을 검증하지 못했습니다: {error}"))?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; 4 * 1024 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("Hy-MT2 모델을 검증하지 못했습니다: {error}"))?;
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
        clean_translation, detect_speech_style, find_llama_server, rewrite_style_prompt,
        startup_device_attempts, translate_with_completion, HyMtModelSize, HyMtTranslator,
    };
    use crate::language::{detect_explicit_language, Language};
    use crate::translation::Translator;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

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
            .all(|prompt| prompt.contains("text into Korean.")));
        assert!(prompts
            .iter()
            .all(|prompt| prompt.contains("preserve every piece of information")));
    }

    #[test]
    fn instruction_echo_is_removed() {
        let echoed = "줄바꿈, URL, ZXQKEEP로 시작하는 모든 단어를 유지하세요.\n사용자명, 이모티콘, 제품명은 번역하지 마세요.\n\n안녕하세요";
        assert_eq!(clean_translation(echoed), "안녕하세요");
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
        assert!(
            rewrite_style_prompt("고마워요.", Language::Korean, "casual")
                .contains("Korean casual banmal")
        );
        assert!(rewrite_style_prompt("Thanks", Language::English, "polite")
            .contains("polite/formal English"));
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
        assert_eq!(startup_device_attempts("auto"), vec!["auto", "cpu"]);
        assert_eq!(startup_device_attempts("cpu"), vec!["cpu"]);
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
}
