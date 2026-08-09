use std::collections::HashMap;
use std::env;
use std::time::Duration;

use serde::Deserialize;

use crate::credentials;
use crate::language::Language;

use super::Translator;

pub struct DeepLTranslator {
    api_key: String,
    endpoint: String,
    client: reqwest::blocking::Client,
}

#[derive(Deserialize)]
struct DeepLResponse {
    translations: Vec<DeepLTranslation>,
}

#[derive(Deserialize)]
struct DeepLTranslation {
    text: String,
}

impl DeepLTranslator {
    pub fn new(api_key: Option<String>, timeout: Duration) -> Result<Self, String> {
        let api_key = api_key
            .or_else(|| env::var("DEEPL_API_KEY").ok())
            .or(credentials::read("deepl")?)
            .unwrap_or_default();
        if api_key.is_empty() {
            return Err("DEEPL_API_KEY가 없어 DeepL 번역을 시작할 수 없습니다.".to_string());
        }
        let endpoint = if api_key.ends_with(":fx") {
            "https://api-free.deepl.com/v2/translate"
        } else {
            "https://api.deepl.com/v2/translate"
        };
        let client = reqwest::blocking::Client::builder()
            .timeout(timeout)
            .build()
            .map_err(|error| format!("DeepL 클라이언트를 만들지 못했습니다: {error}"))?;
        Ok(Self {
            api_key,
            endpoint: endpoint.to_string(),
            client,
        })
    }

    pub fn validate_api_key(api_key: &str, timeout: Duration) -> Result<(), String> {
        let api_key = api_key.trim();
        if api_key.is_empty() {
            return Err("DeepL API 키를 입력하십시오.".to_string());
        }
        let base = if api_key.ends_with(":fx") {
            "https://api-free.deepl.com"
        } else {
            "https://api.deepl.com"
        };
        let client = reqwest::blocking::Client::builder()
            .timeout(timeout)
            .build()
            .map_err(|error| format!("DeepL 연결 확인을 준비하지 못했습니다: {error}"))?;
        client
            .get(format!("{base}/v2/usage"))
            .header("Authorization", format!("DeepL-Auth-Key {api_key}"))
            .send()
            .and_then(|response| response.error_for_status())
            .map(|_| ())
            .map_err(|error| format!("DeepL API 키를 확인하지 못했습니다: {error}"))
    }

    fn request_data(
        text: &str,
        source: Language,
        target: Language,
    ) -> Result<HashMap<&'static str, String>, String> {
        let mut data = HashMap::from([
            ("text", text.to_string()),
            ("target_lang", deepl_target(target)?.to_string()),
            ("preserve_formatting", "1".to_string()),
        ]);
        if let Some(source) = deepl_source(source) {
            data.insert("source_lang", source.to_string());
        }
        Ok(data)
    }
}

impl Translator for DeepLTranslator {
    fn display_name(&self) -> &str {
        "DeepL"
    }

    fn cache_namespace(&self) -> &str {
        "deepl:v1"
    }

    fn sends_text_externally(&self) -> bool {
        true
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
        let response = self
            .client
            .post(&self.endpoint)
            .header("Authorization", format!("DeepL-Auth-Key {}", self.api_key))
            .form(&Self::request_data(text, source, target)?)
            .send()
            .and_then(|response| response.error_for_status())
            .map_err(|error| format!("DeepL 번역 요청이 실패했습니다: {error}"))?;
        let payload: DeepLResponse = response
            .json()
            .map_err(|error| format!("DeepL 번역 응답을 읽지 못했습니다: {error}"))?;
        payload
            .translations
            .into_iter()
            .next()
            .map(|translation| translation.text)
            .ok_or_else(|| "DeepL이 번역문을 반환하지 않았어.".to_string())
    }
}

fn deepl_target(language: Language) -> Result<&'static str, String> {
    match language {
        Language::Korean => Ok("KO"),
        Language::English => Ok("EN"),
        Language::Japanese => Ok("JA"),
        Language::ChineseSimplified => Ok("ZH-HANS"),
        Language::ChineseTraditional => Ok("ZH-HANT"),
        Language::Unknown => Err("DeepL 대상 언어를 확인하지 못했습니다.".to_string()),
    }
}

fn deepl_source(language: Language) -> Option<&'static str> {
    match language {
        Language::Korean => Some("KO"),
        Language::English => Some("EN"),
        Language::Japanese => Some("JA"),
        Language::ChineseSimplified | Language::ChineseTraditional => Some("ZH"),
        Language::Unknown => None,
    }
}

#[cfg(test)]
mod tests {
    use super::DeepLTranslator;
    use crate::language::Language;
    use std::time::Duration;

    #[test]
    fn api_key_is_required_and_free_keys_use_the_free_endpoint() {
        assert!(DeepLTranslator::new(Some(String::new()), Duration::from_secs(1)).is_err());
        let translator =
            DeepLTranslator::new(Some("secret:fx".to_string()), Duration::from_secs(1)).unwrap();
        assert!(translator.endpoint.contains("api-free"));
    }

    #[test]
    fn request_uses_distinct_chinese_targets_and_a_shared_source() {
        let simplified =
            DeepLTranslator::request_data("Hello", Language::English, Language::ChineseSimplified)
                .unwrap();
        let traditional =
            DeepLTranslator::request_data("Hello", Language::English, Language::ChineseTraditional)
                .unwrap();
        assert_eq!(simplified["source_lang"], "EN");
        assert_eq!(simplified["target_lang"], "ZH-HANS");
        assert_eq!(traditional["target_lang"], "ZH-HANT");
        assert_eq!(simplified["text"], "Hello");
    }
}
