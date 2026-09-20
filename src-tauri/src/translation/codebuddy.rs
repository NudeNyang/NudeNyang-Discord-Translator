//! CodeBuddy CLI translation provider contract.
//!
//! This module pins the response contract of the CodeBuddy `stream-json` protocol and the
//! cache isolation rules. It stays free of `crate::` dependencies and of process handling so
//! the protocol contract can be compiled and exercised on its own. Process lifecycle and CLI
//! arguments live in [`super::codebuddy_cli`].

use std::collections::{HashMap, HashSet};

use serde_json::Value;

/// Provider key used by settings, provider lists and cache namespaces.
pub const PROVIDER_KEY: &str = "codebuddy";

/// Product-facing provider name.
pub const DISPLAY_NAME: &str = "CodeBuddy";

/// Bumping this invalidates every cached CodeBuddy result.
pub const PROMPT_VERSION: &str = "codebuddy-cli-translation-v1";

/// Speech styles accepted by the shared prompt contract.
pub const SPEECH_STYLES: [&str; 3] = ["auto", "polite", "casual"];

/// Returns the final result message of the CodeBuddy JSON-lines stream.
///
/// Progress messages are ignored, the last `type: "result"` message wins, and a stream
/// that ends without one is an incomplete response rather than a success.
pub fn decode_stream_result(raw: &str) -> Result<Value, String> {
    let mut last_result: Option<Value> = None;
    for line in raw.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) == Some("result") {
            last_result = Some(value);
        }
    }
    let Some(result) = last_result else {
        return Err(
            "CodeBuddy CLI가 최종 결과를 반환하지 않았습니다. 응답이 중단되었거나 아직 처리 중입니다."
                .to_string(),
        );
    };
    if result_reports_error(&result) {
        return Err(result_error_message(&result));
    }
    Ok(result)
}

fn result_reports_error(result: &Value) -> bool {
    // A terminal result is only usable when it explicitly reports success. Failure subtypes
    // such as `error_during_execution` and `error_max_turns` may still carry a plausible
    // partial translations payload, so any subtype other than `success` is a failure.
    result
        .get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || result.get("subtype").and_then(Value::as_str) != Some("success")
}

fn result_error_message(result: &Value) -> String {
    for key in ["result", "error", "message", "detail", "errors"] {
        let Some(candidate) = result.get(key) else {
            continue;
        };
        if let Some(message) = candidate.as_str() {
            if let Some(message) = non_empty(message) {
                return format!("CodeBuddy 번역에 실패했습니다: {message}");
            }
        }
        if let Some(message) = candidate
            .get("message")
            .and_then(Value::as_str)
            .and_then(non_empty)
        {
            return format!("CodeBuddy 번역에 실패했습니다: {message}");
        }
        // The CLI reports terminal failures such as `error_during_execution` as an `errors`
        // array of reason strings instead of a single message field.
        if let Some(message) = candidate
            .as_array()
            .and_then(|values| values.iter().filter_map(Value::as_str).find_map(non_empty))
        {
            return format!("CodeBuddy 번역에 실패했습니다: {message}");
        }
    }
    "CodeBuddy 번역에 실패했습니다.".to_string()
}

fn non_empty(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then_some(trimmed)
}

/// Maps a CodeBuddy result payload onto exactly the requested item ids.
///
/// Accepts the result message as returned by [`decode_stream_result`] and a bare
/// translation payload. Every requested id must be covered exactly once.
pub fn validated_translations(
    payload: &Value,
    expected_ids: &HashSet<usize>,
) -> Result<HashMap<usize, String>, String> {
    let value = unwrap_translation_payload(payload)?;
    let translations = value
        .get("translations")
        .and_then(Value::as_array)
        .ok_or_else(|| "CodeBuddy 응답에서 translations 배열을 찾지 못했습니다.".to_string())?;
    let mut results: HashMap<usize, String> = HashMap::new();
    for item in translations {
        let identifier = item
            .get("id")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .ok_or_else(|| "CodeBuddy 응답에 숫자 id가 없는 번역 항목이 있습니다.".to_string())?;
        if !expected_ids.contains(&identifier) {
            return Err(format!(
                "CodeBuddy가 요청하지 않은 번역 id를 반환했습니다: {identifier}"
            ));
        }
        let text = item
            .get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("CodeBuddy 응답의 id {identifier}에 번역 텍스트가 없습니다."))?;
        if results.insert(identifier, text.to_string()).is_some() {
            return Err(format!(
                "CodeBuddy가 번역 id를 중복으로 반환했습니다: {identifier}"
            ));
        }
    }
    if results.keys().copied().collect::<HashSet<_>>() != *expected_ids {
        return Err("CodeBuddy가 요청한 문장 수와 다른 결과를 반환했습니다.".to_string());
    }
    Ok(results)
}

/// Finds the `translations` array inside a result message, a nested object, or a JSON string.
fn unwrap_translation_payload(payload: &Value) -> Result<Value, String> {
    if payload.get("translations").is_some_and(Value::is_array) {
        return Ok(payload.clone());
    }
    if let Value::Object(values) = payload {
        for key in [
            "structured_output",
            "result",
            "response",
            "content",
            "text",
            "message",
        ] {
            let Some(nested) = values.get(key) else {
                continue;
            };
            if nested.is_object() {
                if let Ok(found) = unwrap_translation_payload(nested) {
                    if found.get("translations").is_some() {
                        return Ok(found);
                    }
                }
            } else if let Some(raw) = nested.as_str() {
                if let Ok(decoded) = serde_json::from_str::<Value>(raw.trim()) {
                    if let Ok(found) = unwrap_translation_payload(&decoded) {
                        if found.get("translations").is_some() {
                            return Ok(found);
                        }
                    }
                }
            }
        }
    }
    Err("CodeBuddy 응답에서 translations 배열을 찾지 못했습니다.".to_string())
}

/// Cache namespace for one CodeBuddy model and speech style.
///
/// The namespace must include the provider key, prompt version, model and speech style so
/// that switching models never reuses another model's cached translations.
pub fn cache_namespace(model: &str, speech_style: &str) -> Result<String, String> {
    let model = model.trim();
    if model.is_empty() {
        return Err("CodeBuddy 모델 ID가 비어 있습니다.".to_string());
    }
    if model.chars().count() > 120 {
        return Err("CodeBuddy 모델 ID가 너무 깁니다.".to_string());
    }
    if !SPEECH_STYLES.contains(&speech_style) {
        return Err(format!("지원하지 않는 번역 말투입니다: {speech_style}"));
    }
    Ok(format!(
        "{PROVIDER_KEY}:{PROMPT_VERSION}:{model}:{speech_style}"
    ))
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use serde_json::json;

    use super::{cache_namespace, decode_stream_result, validated_translations};

    const SUCCESS_STREAM: &str = concat!(
        "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"fixture-session\"}\n",
        "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"working\"}]}}\n",
        "{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"\",",
        "\"structured_output\":{\"translations\":[{\"id\":0,\"text\":\"안녕\"},{\"id\":1,\"text\":\"고마워\"}]}}\n",
    );

    const NOISY_STREAM: &str = concat!(
        "this line is not json\n",
        "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"draft\"}]}}\n",
        "{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,",
        "\"structured_output\":{\"translations\":[{\"id\":0,\"text\":\"첫 결과\"}]}}\n",
        "{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,",
        "\"structured_output\":{\"translations\":[{\"id\":0,\"text\":\"최종 결과\"}]}}\n",
    );

    const ERROR_STREAM: &str = concat!(
        "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"fixture-session\"}\n",
        "{\"type\":\"result\",\"subtype\":\"error\",\"is_error\":true,",
        "\"result\":\"usage limit reached for this account\"}\n",
    );

    // A failure result can still carry a plausible translations payload, so the subtype alone
    // must decide the outcome.
    const ERROR_SUBTYPE_WITH_TRANSLATIONS_STREAM: &str = concat!(
        "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"fixture-session\"}\n",
        "{\"type\":\"result\",\"subtype\":\"error_max_turns\",\"is_error\":false,",
        "\"structured_output\":{\"translations\":[{\"id\":0,\"text\":\"그럴듯한 번역\"}]}}\n",
    );

    const PROGRESS_ONLY_STREAM: &str = concat!(
        "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"fixture-session\"}\n",
        "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"working\"}]}}\n",
    );

    const TRUNCATED_STREAM: &str = concat!(
        "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"fixture-session\"}\n",
        "{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,",
        "\"structured_output\":{\"translations\":[{\"id\":0,\"text\":\"잘린\n",
    );

    #[test]
    fn codebuddy_provider_identity_is_stable() {
        assert_eq!(super::PROVIDER_KEY, "codebuddy");
        assert_eq!(super::DISPLAY_NAME, "CodeBuddy");
        assert!(super::PROMPT_VERSION.starts_with(super::PROVIDER_KEY));
        assert_eq!(super::SPEECH_STYLES, ["auto", "polite", "casual"]);
    }

    #[test]
    fn success_stream_yields_the_final_result_payload() {
        let payload = decode_stream_result(SUCCESS_STREAM).unwrap();
        let expected = HashSet::from([0_usize, 1]);
        let values = validated_translations(&payload, &expected).unwrap();
        assert_eq!(values[&0], "안녕");
        assert_eq!(values[&1], "고마워");
    }

    #[test]
    fn non_json_noise_is_skipped_and_the_last_result_wins() {
        let payload = decode_stream_result(NOISY_STREAM).unwrap();
        let values = validated_translations(&payload, &HashSet::from([0_usize])).unwrap();
        assert_eq!(values[&0], "최종 결과");
    }

    #[test]
    fn a_bare_translation_payload_is_accepted_without_a_result_envelope() {
        let payload = json!({"translations": [{"id": 0, "text": "안녕"}]});
        let values = validated_translations(&payload, &HashSet::from([0_usize])).unwrap();
        assert_eq!(values[&0], "안녕");
    }

    #[test]
    fn a_json_string_result_is_unwrapped_before_coverage_is_checked() {
        let payload = json!({
            "type": "result",
            "is_error": false,
            "result": "{\"translations\":[{\"id\":7,\"text\":\"번역\"}]}"
        });
        let values = validated_translations(&payload, &HashSet::from([7_usize])).unwrap();
        assert_eq!(values[&7], "번역");
    }

    #[test]
    fn an_error_stream_reports_the_provider_message() {
        let error = decode_stream_result(ERROR_STREAM).unwrap_err();
        assert!(
            error.contains("usage limit reached for this account"),
            "unexpected error message: {error}"
        );
    }

    #[test]
    fn a_terminal_execution_error_reports_its_errors_array() {
        // The CodeBuddy CLI reports terminal failures such as `error_during_execution` as an
        // `errors` array of reason strings instead of a single message field.
        let stream = concat!(
            "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"fixture-session\"}\n",
            "{\"type\":\"result\",\"subtype\":\"error_during_execution\",\"is_error\":true,",
            "\"errors\":[\"quota exhausted\"]}\n",
        );
        let error = decode_stream_result(stream)
            .expect_err("a terminal execution error stream must be rejected");
        assert!(
            error.contains("quota exhausted"),
            "unexpected error message: {error}"
        );
    }

    #[test]
    fn a_failure_subtype_is_rejected_even_with_a_plausible_translation_payload() {
        assert!(
            decode_stream_result(ERROR_SUBTYPE_WITH_TRANSLATIONS_STREAM).is_err(),
            "a failure subtype must not be accepted just because it carries translations"
        );
        let missing_subtype = concat!(
            "{\"type\":\"result\",\"is_error\":false,",
            "\"structured_output\":{\"translations\":[{\"id\":0,\"text\":\"번역\"}]}}\n",
        );
        assert!(
            decode_stream_result(missing_subtype).is_err(),
            "a result without a success subtype must not be accepted"
        );
    }

    #[test]
    fn a_stream_without_a_result_message_is_incomplete() {
        for stream in [PROGRESS_ONLY_STREAM, TRUNCATED_STREAM, "", "   \n"] {
            assert!(
                decode_stream_result(stream).is_err(),
                "stream should not be treated as a completed translation: {stream:?}"
            );
        }
    }

    #[test]
    fn translation_ids_must_be_covered_exactly_once() {
        let payload = json!({
            "translations": [
                {"id": 0, "text": "하나"},
                {"id": 2, "text": "셋"}
            ]
        });
        let values = validated_translations(&payload, &HashSet::from([0_usize, 2])).unwrap();
        assert_eq!(values[&0], "하나");
        assert_eq!(values[&2], "셋");

        assert!(
            validated_translations(&payload, &HashSet::from([0_usize, 1, 2])).is_err(),
            "a missing id is not a complete response"
        );
        assert!(
            validated_translations(&payload, &HashSet::from([0_usize])).is_err(),
            "an unrequested id is not a complete response"
        );

        let duplicated = json!({
            "translations": [
                {"id": 0, "text": "하나"},
                {"id": 0, "text": "하나 (다시)"}
            ]
        });
        assert!(
            validated_translations(&duplicated, &HashSet::from([0_usize])).is_err(),
            "one requested id must not be answered twice"
        );

        let incomplete_entry = json!({
            "translations": [
                {"id": 0, "text": "하나"},
                {"id": 1}
            ]
        });
        assert!(
            validated_translations(&incomplete_entry, &HashSet::from([0_usize, 1])).is_err(),
            "an entry without text does not cover its id"
        );
    }

    #[test]
    fn requested_ids_are_matched_regardless_of_response_order() {
        let payload = json!({
            "translations": [
                {"id": 4, "text": "넷"},
                {"id": 3, "text": "셋"}
            ]
        });
        let values = validated_translations(&payload, &HashSet::from([3_usize, 4])).unwrap();
        assert_eq!(values[&3], "셋");
        assert_eq!(values[&4], "넷");
    }

    #[test]
    fn model_cache_namespaces_are_isolated_per_model_and_style() {
        let fast = cache_namespace("codebuddy-fast", "auto").unwrap();
        let pro = cache_namespace("codebuddy-pro", "auto").unwrap();
        let polite = cache_namespace("codebuddy-fast", "polite").unwrap();

        assert_ne!(
            fast, pro,
            "different models must not share cached translations"
        );
        assert_ne!(
            fast, polite,
            "different speech styles must not share cached translations"
        );
        assert_eq!(fast, cache_namespace("codebuddy-fast", "auto").unwrap());
        for part in [
            super::PROVIDER_KEY,
            super::PROMPT_VERSION,
            "codebuddy-fast",
            "auto",
        ] {
            assert!(fast.contains(part), "namespace {fast} is missing {part}");
        }
    }

    #[test]
    fn cache_namespaces_reject_unusable_models_and_styles() {
        assert!(cache_namespace("", "auto").is_err());
        assert!(cache_namespace("   ", "auto").is_err());
        assert!(cache_namespace("codebuddy-fast", "").is_err());
        assert!(cache_namespace("codebuddy-fast", "shouting").is_err());
    }
}
