use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use reqwest::blocking::Client;
use reqwest::{StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::config::AppConfig;
use crate::credentials;
use crate::diagnostics;
use crate::language::Language;

use super::subscription_cli::{
    decode_payload, translation_style, validated_translations, TRANSLATION_RULES,
};
use super::Translator;

pub const CREDENTIAL_ID: &str = "openai_compat";
const PROMPT_VERSION: &str = "openai-compat-v1";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_RATE_LIMIT_RETRIES: u32 = 5;
const MAX_RETRY_AFTER: Duration = Duration::from_secs(60);
const RESPONSE_SHAPE: &str = "Return only a JSON object of the form {\"translations\":[{\"id\":<id>,\"text\":\"<translation>\"}]} with exactly one entry for every requested id.";

const FORMAT_JSON_SCHEMA: u8 = 0;
const FORMAT_JSON_OBJECT: u8 = 1;
const FORMAT_PLAIN: u8 = 2;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpenAiCompatSettings {
    pub base_url: String,
    pub model: String,
    pub batch_size: usize,
    pub concurrency: usize,
    pub shared_context: bool,
}

// Keep the endpoint binding inside the same OS credential entry as the secret.
// A single active connection also keeps disconnect/uninstall deletion complete.
#[derive(Deserialize, Serialize)]
pub(crate) struct ServerCredential {
    version: u8,
    base_url: String,
    pub(crate) api_key: Option<String>,
}

impl OpenAiCompatSettings {
    pub(crate) fn read_credential(
        &self,
        store: &dyn credentials::CredentialStore,
    ) -> Result<Option<ServerCredential>, String> {
        let base_url = normalize_base_url(&self.base_url)?;
        let stored = store.read(CREDENTIAL_ID)?;
        // Unbound legacy keys cannot be assigned to a server safely. Require
        // explicit re-entry rather than guessing from mutable app settings.
        Ok(stored
            .and_then(|raw| serde_json::from_str::<ServerCredential>(&raw).ok())
            .filter(|record| record.version == 1 && record.base_url == base_url))
    }

    pub(crate) fn save_credential(
        &self,
        api_key: Option<&str>,
        store: &dyn credentials::CredentialStore,
    ) -> Result<(), String> {
        let record = ServerCredential {
            version: 1,
            base_url: normalize_base_url(&self.base_url)?,
            api_key: api_key.map(str::to_string),
        };
        let encoded = serde_json::to_string(&record).map_err(json_error)?;
        store.write(CREDENTIAL_ID, &encoded)
    }

    pub fn from_config(config: &AppConfig) -> Self {
        Self {
            base_url: config.openai_compat_base_url.clone(),
            model: config.openai_compat_model.clone(),
            batch_size: config.openai_compat_batch_size as usize,
            concurrency: config.openai_compat_concurrency as usize,
            shared_context: config.openai_compat_shared_context,
        }
    }
}

pub fn normalize_base_url(value: &str) -> Result<String, String> {
    let invalid = || {
        "OpenAI 호환 API 서버 주소가 올바르지 않습니다. http:// 또는 https://로 시작하는 주소를 입력하십시오."
            .to_string()
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("OpenAI 호환 API 서버 주소를 입력하십시오.".to_string());
    }
    let mut url = Url::parse(trimmed).map_err(|_| invalid())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(invalid());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("서버 주소에 계정 정보를 넣지 말고 API 키 입력란을 사용하십시오.".to_string());
    }
    url.set_query(None);
    url.set_fragment(None);
    let mut path = url.path().trim_end_matches('/').to_string();
    if let Some(stripped) = path.strip_suffix("/chat/completions") {
        path = stripped.to_string();
    }
    if path.is_empty() {
        path = "/v1".to_string();
    }
    url.set_path(&path);
    Ok(url.as_str().trim_end_matches('/').to_string())
}

enum ChunkError {
    // The same items may succeed when sent in smaller requests.
    Recoverable(String),
    Fatal(String),
}

pub struct OpenAiCompatTranslator {
    settings: OpenAiCompatSettings,
    endpoint: String,
    api_key: Option<String>,
    client: Client,
    cache_namespace: String,
    response_format: AtomicU8,
}

impl OpenAiCompatTranslator {
    pub fn new(settings: OpenAiCompatSettings, api_key: Option<String>) -> Result<Self, String> {
        let base_url = normalize_base_url(&settings.base_url)?;
        let model = settings.model.trim().to_string();
        if model.is_empty() {
            return Err("OpenAI 호환 API 모델 ID를 입력하십시오.".to_string());
        }
        let client = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| format!("OpenAI 호환 API 클라이언트를 만들지 못했습니다: {error}"))?;
        let settings = OpenAiCompatSettings {
            base_url,
            model,
            batch_size: settings.batch_size.max(1),
            concurrency: settings.concurrency.max(1),
            shared_context: settings.shared_context,
        };
        Ok(Self {
            endpoint: format!("{}/chat/completions", settings.base_url),
            cache_namespace: cache_namespace(&settings),
            settings,
            api_key: api_key
                .map(|key| key.trim().to_string())
                .filter(|key| !key.is_empty()),
            client,
            response_format: AtomicU8::new(FORMAT_JSON_SCHEMA),
        })
    }

    pub fn with_stored_credential(settings: OpenAiCompatSettings) -> Result<Self, String> {
        Self::with_credential_store(settings, &credentials::SystemCredentialStore)
    }

    pub(crate) fn with_credential_store(
        settings: OpenAiCompatSettings,
        store: &dyn credentials::CredentialStore,
    ) -> Result<Self, String> {
        let api_key = settings
            .read_credential(store)?
            .and_then(|record| record.api_key);
        Self::new(settings, api_key)
    }

    pub fn validate(&self) -> Result<(), String> {
        let items = [("Hello".to_string(), Language::English)];
        let translated = self
            .translate_chunk(&items, &[0], &[], Language::Korean)?
            .into_iter()
            .next()
            .map(|(_, text)| text)
            .unwrap_or_default();
        if translated.trim().is_empty() {
            return Err("OpenAI 호환 API가 빈 번역문을 반환했습니다.".to_string());
        }
        Ok(())
    }

    fn translate_chunk(
        &self,
        items: &[(String, Language)],
        chunk: &[usize],
        context: &[Value],
        target: Language,
    ) -> Result<Vec<(usize, String)>, String> {
        match self.request_chunk(items, chunk, context, target) {
            Ok(values) => Ok(values),
            Err(ChunkError::Recoverable(error)) if chunk.len() > 1 => {
                diagnostics::info(
                    "openai-compat",
                    &format!("splitting request; items={}; reason={error}", chunk.len()),
                );
                let (left, right) = chunk.split_at(chunk.len() / 2);
                let mut values = self.translate_chunk(items, left, context, target)?;
                values.extend(self.translate_chunk(items, right, context, target)?);
                Ok(values)
            }
            Err(ChunkError::Recoverable(error) | ChunkError::Fatal(error)) => Err(error),
        }
    }

    fn request_chunk(
        &self,
        items: &[(String, Language)],
        chunk: &[usize],
        context: &[Value],
        target: Language,
    ) -> Result<Vec<(usize, String)>, ChunkError> {
        let expected = chunk.iter().copied().collect::<HashSet<_>>();
        let mut rate_limit_retries = 0;
        loop {
            let format = self.response_format.load(Ordering::Relaxed);
            let body = self
                .request_body(items, chunk, context, target, format)
                .map_err(ChunkError::Fatal)?;
            let mut request = self.client.post(&self.endpoint).json(&body);
            if let Some(key) = &self.api_key {
                request = request.bearer_auth(key);
            }
            let response = request.send().map_err(|error| {
                ChunkError::Fatal(format!("OpenAI 호환 API에 연결하지 못했습니다: {error}"))
            })?;
            let status = response.status();
            if status == StatusCode::TOO_MANY_REQUESTS
                && rate_limit_retries < MAX_RATE_LIMIT_RETRIES
            {
                rate_limit_retries += 1;
                thread::sleep(retry_after(&response));
                continue;
            }
            if matches!(status.as_u16(), 400 | 422) {
                let rejected_format = format < FORMAT_PLAIN
                    && response
                        .text()
                        .is_ok_and(|text| mentions_response_format(&text));
                if rejected_format {
                    let _ = self.response_format.compare_exchange(
                        format,
                        format + 1,
                        Ordering::Relaxed,
                        Ordering::Relaxed,
                    );
                    diagnostics::info(
                        "openai-compat",
                        &format!("server rejected response format {format}; retrying with a simpler format"),
                    );
                    continue;
                }
                return Err(ChunkError::Recoverable(status_error(status)));
            }
            if !status.is_success() {
                return Err(ChunkError::Fatal(status_error(status)));
            }
            let payload: Value = response.json().map_err(|_| {
                ChunkError::Recoverable("OpenAI 호환 API 응답을 읽지 못했습니다.".to_string())
            })?;
            let content = payload
                .pointer("/choices/0/message/content")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    ChunkError::Recoverable("OpenAI 호환 API 응답에 번역문이 없습니다.".to_string())
                })?;
            let decoded = decode_payload(content).map_err(|_| {
                ChunkError::Recoverable(
                    "OpenAI 호환 API 응답을 JSON으로 읽지 못했습니다.".to_string(),
                )
            })?;
            let translations = validated_translations(&decoded, &expected).map_err(|_| {
                ChunkError::Recoverable(
                    "OpenAI 호환 API가 요청한 문장 수와 다른 결과를 반환했습니다.".to_string(),
                )
            })?;
            return Ok(translations.into_iter().collect());
        }
    }

    fn request_body(
        &self,
        items: &[(String, Language)],
        chunk: &[usize],
        context: &[Value],
        target: Language,
        format: u8,
    ) -> Result<Value, String> {
        let style = translation_style("auto")?;
        let target_name = serde_json::to_string(target.english_name()).map_err(json_error)?;
        let style = serde_json::to_string(style).map_err(json_error)?;
        // Fields are written in a fixed order so shared-context requests keep an identical prefix.
        let (instructions, user) = if context.is_empty() {
            let chunk_items = chunk
                .iter()
                .map(|&index| item_json(index, &items[index]))
                .collect::<Vec<_>>();
            (
                format!("Translate every item in the JSON request from the user. {TRANSLATION_RULES} {RESPONSE_SHAPE}"),
                format!(
                    "{{\"target_language\":{target_name},\"style\":{style},\"items\":{}}}",
                    serde_json::to_string(&chunk_items).map_err(json_error)?
                ),
            )
        } else {
            (
                format!("The user sends a JSON request whose context lists nearby items for reference. Translate only the items whose id appears in translate_ids and use the other items solely as context. {TRANSLATION_RULES} {RESPONSE_SHAPE}"),
                format!(
                    "{{\"target_language\":{target_name},\"style\":{style},\"context\":{},\"translate_ids\":{}}}",
                    serde_json::to_string(context).map_err(json_error)?,
                    serde_json::to_string(chunk).map_err(json_error)?
                ),
            )
        };
        let mut body = json!({
            "model": self.settings.model,
            "messages": [
                {"role": "system", "content": instructions},
                {"role": "user", "content": user},
            ],
        });
        match format {
            FORMAT_JSON_SCHEMA => {
                body["response_format"] = json!({
                    "type": "json_schema",
                    "json_schema": {"name": "translations", "strict": true, "schema": response_schema(chunk)},
                });
            }
            FORMAT_JSON_OBJECT => body["response_format"] = json!({"type": "json_object"}),
            _ => {}
        }
        Ok(body)
    }
}

impl Translator for OpenAiCompatTranslator {
    fn display_name(&self) -> &str {
        "OpenAI 호환 API"
    }

    fn cache_namespace(&self) -> &str {
        &self.cache_namespace
    }

    fn sends_text_externally(&self) -> bool {
        true
    }

    fn supports_ephemeral_requests(&self) -> bool {
        true
    }

    fn translate(
        &mut self,
        text: &str,
        source: Language,
        target: Language,
    ) -> Result<String, String> {
        self.translate_many(&[(text.to_string(), source)], target)?
            .pop()
            .ok_or_else(|| "OpenAI 호환 API가 번역문을 반환하지 않았습니다.".to_string())
    }

    fn translate_many(
        &mut self,
        items: &[(String, Language)],
        target: Language,
    ) -> Result<Vec<String>, String> {
        let mut results = vec![None; items.len()];
        let mut pending = Vec::new();
        for (index, (text, source)) in items.iter().enumerate() {
            if *source == target || text.trim().is_empty() {
                results[index] = Some(text.clone());
            } else {
                pending.push(index);
            }
        }
        if !pending.is_empty() {
            let context = if self.settings.shared_context {
                pending
                    .iter()
                    .map(|&index| item_json(index, &items[index]))
                    .collect()
            } else {
                Vec::new()
            };
            let chunks = pending
                .chunks(self.settings.batch_size)
                .map(<[usize]>::to_vec)
                .collect::<VecDeque<_>>();
            let workers = self.settings.concurrency.min(chunks.len());
            let queue = Mutex::new(chunks);
            let completed = Mutex::new(HashMap::new());
            let failure = Mutex::new(None::<String>);
            let this = &*self;
            thread::scope(|scope| {
                for _ in 0..workers {
                    scope.spawn(|| loop {
                        if lock(&failure).is_some() {
                            break;
                        }
                        let Some(chunk) = lock(&queue).pop_front() else {
                            break;
                        };
                        match this.translate_chunk(items, &chunk, &context, target) {
                            Ok(values) => lock(&completed).extend(values),
                            Err(error) => {
                                lock(&failure).get_or_insert(error);
                                break;
                            }
                        }
                    });
                }
            });
            if let Some(error) = failure
                .into_inner()
                .unwrap_or_else(|error| error.into_inner())
            {
                return Err(error);
            }
            for (index, text) in completed
                .into_inner()
                .unwrap_or_else(|error| error.into_inner())
            {
                results[index] = Some(text);
            }
        }
        results
            .into_iter()
            .map(|value| {
                value.ok_or_else(|| {
                    "OpenAI 호환 API가 일부 문장의 결과를 반환하지 않았습니다.".to_string()
                })
            })
            .collect()
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

fn item_json(index: usize, (text, source): &(String, Language)) -> Value {
    json!({"id": index, "source_language": source.english_name(), "text": text})
}

fn response_schema(ids: &[usize]) -> Value {
    json!({
        "type": "object",
        "properties": {
            "translations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "integer", "enum": ids},
                        "text": {"type": "string"}
                    },
                    "required": ["id", "text"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["translations"],
        "additionalProperties": false
    })
}

fn cache_namespace(settings: &OpenAiCompatSettings) -> String {
    let mut hasher = Sha256::new();
    hasher.update(PROMPT_VERSION.as_bytes());
    hasher.update([0]);
    hasher.update(settings.base_url.as_bytes());
    hasher.update([0]);
    hasher.update(settings.model.as_bytes());
    hasher.update([u8::from(settings.shared_context)]);
    let digest = format!("{:x}", hasher.finalize());
    format!("openai-compat:v1:{}", &digest[..16])
}

fn mentions_response_format(body: &str) -> bool {
    let body = body.to_ascii_lowercase();
    [
        "response_format",
        "json_schema",
        "json_object",
        "guided",
        "structured output",
    ]
    .iter()
    .any(|keyword| body.contains(keyword))
}

fn retry_after(response: &reqwest::blocking::Response) -> Duration {
    response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map_or(Duration::from_secs(1), Duration::from_secs)
        .min(MAX_RETRY_AFTER)
}

fn status_error(status: StatusCode) -> String {
    let hint = match status.as_u16() {
        401 | 403 => " API 키를 확인하십시오.",
        404 => " 서버 주소와 모델 ID를 확인하십시오.",
        429 => " 요청 한도를 초과했습니다. 동시 요청 수를 줄이십시오.",
        _ => "",
    };
    format!(
        "OpenAI 호환 API가 요청을 거부했습니다 (HTTP {}).{hint}",
        status.as_u16()
    )
}

fn json_error(error: serde_json::Error) -> String {
    format!("OpenAI 호환 API 요청을 만들지 못했습니다: {error}")
}

#[cfg(test)]
mod tests {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::Duration;

    use serde_json::{json, Value};

    use super::{normalize_base_url, OpenAiCompatSettings, OpenAiCompatTranslator};
    use crate::language::Language;
    use crate::translation::Translator;

    type Handler = dyn Fn(&Value) -> (u16, String) + Send + Sync;

    struct MockServer {
        url: String,
        requests: Arc<Mutex<Vec<(Value, Option<String>)>>>,
        peak_in_flight: Arc<AtomicUsize>,
    }

    fn serve(handler: Arc<Handler>, delay: Duration) -> MockServer {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let in_flight = Arc::new(AtomicUsize::new(0));
        let peak_in_flight = Arc::new(AtomicUsize::new(0));
        let server = MockServer {
            url,
            requests: requests.clone(),
            peak_in_flight: peak_in_flight.clone(),
        };
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let handler = handler.clone();
                let requests = requests.clone();
                let in_flight = in_flight.clone();
                let peak = peak_in_flight.clone();
                thread::spawn(move || {
                    let current = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
                    peak.fetch_max(current, Ordering::SeqCst);
                    respond(stream, &*handler, &requests, delay);
                    in_flight.fetch_sub(1, Ordering::SeqCst);
                });
            }
        });
        server
    }

    fn respond(
        mut stream: TcpStream,
        handler: &Handler,
        requests: &Mutex<Vec<(Value, Option<String>)>>,
        delay: Duration,
    ) {
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut length = 0;
        let mut authorization = None;
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                break;
            }
            let lower = line.to_ascii_lowercase();
            if let Some(value) = lower.strip_prefix("content-length:") {
                length = value.trim().parse().unwrap_or(0);
            }
            if lower.starts_with("authorization:") {
                authorization = Some(line["authorization:".len()..].trim().to_string());
            }
        }
        let mut body = vec![0; length];
        reader.read_exact(&mut body).unwrap();
        let request: Value = serde_json::from_slice(&body).unwrap();
        requests
            .lock()
            .unwrap()
            .push((request.clone(), authorization));
        thread::sleep(delay);
        let (status, payload) = handler(&request);
        let _ = write!(
            stream,
            "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
            payload.len()
        );
    }

    fn requested_ids(request: &Value) -> Vec<u64> {
        let user = request["messages"][1]["content"].as_str().unwrap();
        let user: Value = serde_json::from_str(user).unwrap();
        if let Some(ids) = user.get("translate_ids") {
            return ids
                .as_array()
                .unwrap()
                .iter()
                .map(|id| id.as_u64().unwrap())
                .collect();
        }
        user["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["id"].as_u64().unwrap())
            .collect()
    }

    fn completion(ids: &[u64]) -> (u16, String) {
        let translations = ids
            .iter()
            .map(|id| json!({"id": id, "text": format!("번역-{id}")}))
            .collect::<Vec<_>>();
        let content = json!({"translations": translations}).to_string();
        (
            200,
            json!({"choices": [{"message": {"content": content}, "finish_reason": "stop"}]})
                .to_string(),
        )
    }

    fn translator(
        url: &str,
        batch: usize,
        concurrency: usize,
        shared: bool,
    ) -> OpenAiCompatTranslator {
        OpenAiCompatTranslator::new(
            OpenAiCompatSettings {
                base_url: url.to_string(),
                model: "test-model".to_string(),
                batch_size: batch,
                concurrency,
                shared_context: shared,
            },
            Some("secret-key".to_string()),
        )
        .unwrap()
    }

    fn english_items(count: usize) -> Vec<(String, Language)> {
        (0..count)
            .map(|index| (format!("message {index}"), Language::English))
            .collect()
    }

    #[test]
    fn base_urls_accept_roots_and_full_endpoints() {
        assert_eq!(
            normalize_base_url("http://192.0.2.10:8000/").unwrap(),
            "http://192.0.2.10:8000/v1"
        );
        assert_eq!(
            normalize_base_url(" https://api.example.com/v1/chat/completions?x=1 ").unwrap(),
            "https://api.example.com/v1"
        );
        assert_eq!(
            normalize_base_url("https://example.com/openai/v1/").unwrap(),
            "https://example.com/openai/v1"
        );
        for invalid in [
            "",
            "ftp://example.com",
            "example.com",
            "https://user:pass@example.com",
        ] {
            assert!(normalize_base_url(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn batches_run_concurrently_up_to_the_limit_and_keep_order() {
        let server = serve(
            Arc::new(|request| completion(&requested_ids(request))),
            Duration::from_millis(150),
        );
        let mut translator = translator(&server.url, 2, 3, false);
        let items = english_items(12);
        let translated = translator.translate_many(&items, Language::Korean).unwrap();

        let expected = (0..12).map(|id| format!("번역-{id}")).collect::<Vec<_>>();
        assert_eq!(translated, expected);
        let requests = server.requests.lock().unwrap();
        assert_eq!(requests.len(), 6);
        assert!(requests
            .iter()
            .all(|(request, _)| requested_ids(request).len() == 2));
        assert_eq!(server.peak_in_flight.load(Ordering::SeqCst), 3);
        assert_eq!(requests[0].1.as_deref(), Some("Bearer secret-key"));
    }

    #[test]
    fn shared_context_sends_an_identical_prefix_and_only_requests_owned_ids() {
        let server = serve(
            Arc::new(|request| completion(&requested_ids(request))),
            Duration::ZERO,
        );
        let mut translator = translator(&server.url, 1, 4, true);
        let items = english_items(3);
        translator.translate_many(&items, Language::Korean).unwrap();

        let requests = server.requests.lock().unwrap();
        assert_eq!(requests.len(), 3);
        let prefixes = requests
            .iter()
            .map(|(request, _)| {
                let user = request["messages"][1]["content"].as_str().unwrap();
                user[..user.find("\"translate_ids\"").unwrap()].to_string()
            })
            .collect::<Vec<_>>();
        assert!(prefixes.iter().all(|prefix| prefix == &prefixes[0]));
        assert!(prefixes[0].contains("message 0") && prefixes[0].contains("message 2"));
        let mut owned = requests
            .iter()
            .flat_map(|(request, _)| requested_ids(request))
            .collect::<Vec<_>>();
        owned.sort_unstable();
        assert_eq!(owned, vec![0, 1, 2]);
        let schema_ids = &requests[0].0["response_format"]["json_schema"]["schema"]["properties"]
            ["translations"]["items"]["properties"]["id"]["enum"];
        assert_eq!(schema_ids.as_array().unwrap().len(), 1);
    }

    #[test]
    fn a_mismatched_batch_is_split_until_the_faulty_item_is_isolated() {
        let server = serve(
            Arc::new(|request| {
                let ids = requested_ids(request);
                if ids.len() > 1 {
                    completion(&ids[..1])
                } else {
                    completion(&ids)
                }
            }),
            Duration::ZERO,
        );
        let mut translator = translator(&server.url, 4, 1, false);
        let translated = translator
            .translate_many(&english_items(4), Language::Korean)
            .unwrap();
        assert_eq!(translated, vec!["번역-0", "번역-1", "번역-2", "번역-3"]);
    }

    #[test]
    fn rejected_structured_output_falls_back_to_a_simpler_format_once() {
        let server = serve(
            Arc::new(|request| {
                if request.get("response_format").is_some() {
                    (
                        400,
                        json!({"error": {"message": "response_format is not supported"}})
                            .to_string(),
                    )
                } else {
                    completion(&requested_ids(request))
                }
            }),
            Duration::ZERO,
        );
        let mut translator = translator(&server.url, 8, 1, false);
        translator
            .translate_many(&english_items(2), Language::Korean)
            .unwrap();
        translator
            .translate_many(&english_items(2), Language::Korean)
            .unwrap();
        let formats = server
            .requests
            .lock()
            .unwrap()
            .iter()
            .map(|(request, _)| {
                request["response_format"]["type"]
                    .as_str()
                    .map(str::to_string)
            })
            .collect::<Vec<_>>();
        assert_eq!(
            formats,
            vec![
                Some("json_schema".to_string()),
                Some("json_object".to_string()),
                None,
                None
            ]
        );
    }

    #[test]
    fn rate_limits_retry_the_same_batch_after_the_server_delay() {
        let attempts = Arc::new(AtomicUsize::new(0));
        let counter = attempts.clone();
        let server = serve(
            Arc::new(move |request| {
                if counter.fetch_add(1, Ordering::SeqCst) == 0 {
                    (429, "{}".to_string())
                } else {
                    completion(&requested_ids(request))
                }
            }),
            Duration::ZERO,
        );
        let mut translator = translator(&server.url, 8, 1, false);
        let translated = translator
            .translate_many(&english_items(2), Language::Korean)
            .unwrap();
        assert_eq!(translated, vec!["번역-0", "번역-1"]);
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn errors_never_include_the_api_key_or_message_text() {
        let server = serve(
            Arc::new(|_| {
                (
                    401,
                    json!({"error": "bad key secret-key message 0"}).to_string(),
                )
            }),
            Duration::ZERO,
        );
        let mut translator = translator(&server.url, 8, 1, false);
        let error = translator
            .translate_many(&english_items(1), Language::Korean)
            .unwrap_err();
        assert!(error.contains("HTTP 401"));
        assert!(!error.contains("secret-key"));
        assert!(!error.contains("message 0"));
    }

    #[test]
    fn unchanged_items_skip_the_network_and_cache_keys_follow_model_settings() {
        let mut translator = translator("http://127.0.0.1:9", 8, 1, false);
        let items = vec![
            ("안녕".to_string(), Language::Korean),
            ("   ".to_string(), Language::English),
        ];
        assert_eq!(
            translator.translate_many(&items, Language::Korean).unwrap(),
            vec!["안녕", "   "]
        );

        let base = translator.cache_namespace().to_string();
        let other_model = OpenAiCompatTranslator::new(
            OpenAiCompatSettings {
                base_url: "http://127.0.0.1:9".to_string(),
                model: "other-model".to_string(),
                batch_size: 8,
                concurrency: 1,
                shared_context: false,
            },
            None,
        )
        .unwrap();
        let shared = super::cache_namespace(&OpenAiCompatSettings {
            base_url: "http://127.0.0.1:9/v1".to_string(),
            model: "test-model".to_string(),
            batch_size: 8,
            concurrency: 1,
            shared_context: true,
        });
        assert_ne!(base, other_model.cache_namespace());
        assert_ne!(base, shared);
        assert!(!base.contains("test-model"));
    }

    #[test]
    fn server_credential_is_not_forwarded_when_connecting_to_another_server() {
        use crate::credentials::MemoryCredentialStore;
        use crate::providers::connect_openai_compat_with_store;
        let store = MemoryCredentialStore::default();
        let first = serve(Arc::new(|r| completion(&requested_ids(r))), Duration::ZERO);
        let second = serve(Arc::new(|r| completion(&requested_ids(r))), Duration::ZERO);
        let original = translator(&first.url, 8, 4, false).settings;
        connect_openai_compat_with_store(original.clone(), Some("server-a-test-key"), &store)
            .unwrap();
        let changed = OpenAiCompatSettings {
            base_url: second.url.clone(),
            ..original
        };
        let verified = connect_openai_compat_with_store(changed, None, &store).unwrap();
        let mut active = OpenAiCompatTranslator::with_credential_store(verified, &store).unwrap();
        active
            .translate_many(&english_items(1), Language::Korean)
            .unwrap();
        let requests = second.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(
            requests.iter().all(|(_, auth)| auth.is_none()),
            "another server must never receive the old key"
        );
    }

    #[test]
    fn server_credential_reuses_same_normalized_endpoint_and_refresh_reads_new_key() {
        use crate::credentials::MemoryCredentialStore;
        use crate::providers::connect_openai_compat_with_store;
        let store = MemoryCredentialStore::default();
        let server = serve(Arc::new(|r| completion(&requested_ids(r))), Duration::ZERO);
        let settings = translator(&server.url, 8, 4, false).settings;
        let verified =
            connect_openai_compat_with_store(settings.clone(), Some("old-test-key"), &store)
                .unwrap();
        let equivalent = OpenAiCompatSettings {
            base_url: format!("{}/chat/completions/", verified.base_url),
            ..verified.clone()
        };
        connect_openai_compat_with_store(equivalent, None, &store).unwrap();
        connect_openai_compat_with_store(verified.clone(), Some("new-test-key"), &store).unwrap();
        let mut refreshed =
            OpenAiCompatTranslator::with_credential_store(verified, &store).unwrap();
        refreshed
            .translate_many(&english_items(1), Language::Korean)
            .unwrap();
        let auth = server
            .requests
            .lock()
            .unwrap()
            .iter()
            .map(|(_, auth)| auth.clone().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            auth,
            [
                "Bearer old-test-key",
                "Bearer old-test-key",
                "Bearer new-test-key",
                "Bearer new-test-key"
            ]
        );
    }

    #[test]
    fn server_credential_rejects_different_scheme_port_path_and_unbound_legacy_key() {
        use crate::credentials::{CredentialStore, MemoryCredentialStore};
        use crate::providers::connect_openai_compat_with_store;
        let store = MemoryCredentialStore::default();
        let server = serve(Arc::new(|r| completion(&requested_ids(r))), Duration::ZERO);
        let settings = translator(&server.url, 8, 4, false).settings;
        let verified =
            connect_openai_compat_with_store(settings, Some("scoped-test-key"), &store).unwrap();
        for base_url in [
            verified.base_url.replacen("http:", "https:", 1),
            "http://127.0.0.1:9/v1".to_string(),
            format!("{}/other-tenant", verified.base_url),
        ] {
            let changed = OpenAiCompatSettings {
                base_url,
                ..verified.clone()
            };
            assert!(
                OpenAiCompatTranslator::with_credential_store(changed, &store)
                    .unwrap()
                    .api_key
                    .is_none()
            );
        }
        store
            .write(super::CREDENTIAL_ID, "unbound-legacy-test-key")
            .unwrap();
        assert!(
            OpenAiCompatTranslator::with_credential_store(verified, &store)
                .unwrap()
                .api_key
                .is_none()
        );
    }

    #[test]
    fn server_credential_failed_validation_preserves_previous_connection() {
        use crate::credentials::{CredentialStore, MemoryCredentialStore};
        use crate::providers::connect_openai_compat_with_store;
        let store = MemoryCredentialStore::default();
        let first = serve(Arc::new(|r| completion(&requested_ids(r))), Duration::ZERO);
        let rejected = serve(Arc::new(|_| (401, "{}".to_string())), Duration::ZERO);
        let settings = translator(&first.url, 8, 4, false).settings;
        let verified =
            connect_openai_compat_with_store(settings, Some("first-test-key"), &store).unwrap();
        let before = store.read(super::CREDENTIAL_ID).unwrap();
        let changed = OpenAiCompatSettings {
            base_url: rejected.url.clone(),
            ..verified.clone()
        };
        assert!(
            connect_openai_compat_with_store(changed, Some("invalid-test-key"), &store).is_err()
        );
        assert_eq!(store.read(super::CREDENTIAL_ID).unwrap(), before);
        let mut active = OpenAiCompatTranslator::with_credential_store(verified, &store).unwrap();
        active
            .translate_many(&english_items(1), Language::Korean)
            .unwrap();
        assert_eq!(
            first.requests.lock().unwrap().last().unwrap().1.as_deref(),
            Some("Bearer first-test-key")
        );
    }
}
