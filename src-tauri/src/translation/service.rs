use std::sync::LazyLock;

use regex::Regex;
use sha2::{Digest, Sha256};

use crate::cache::TranslationCache;
use crate::language::{Language, LanguageDetector};
use crate::text_split::split_for_translation;

use super::protected_text::{protect_text, ProtectedText};
use super::Translator;

static JAPANESE_FRAGMENT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"[A-Za-z0-9]*[\u{3040}-\u{30ff}\u{31f0}-\u{31ff}\u{3400}-\u{4dbf}\u{4e00}-\u{9fff}][\u{3040}-\u{30ff}\u{31f0}-\u{31ff}\u{3400}-\u{4dbf}\u{4e00}-\u{9fff}A-Za-z0-9（）()「」『』【】・ー〜～._-]*",
    )
    .unwrap()
});

const MAX_TRANSLATION_CHARS: usize = 700;

pub struct TranslationService {
    translator: Box<dyn Translator>,
    cache: TranslationCache,
    detector: LanguageDetector,
}

impl TranslationService {
    pub fn new(translator: Box<dyn Translator>, cache: TranslationCache) -> Self {
        Self {
            translator,
            cache,
            detector: LanguageDetector::default(),
        }
    }

    pub fn namespace(&self) -> &str {
        self.translator.cache_namespace()
    }

    pub fn translator(&self) -> &dyn Translator {
        self.translator.as_ref()
    }

    pub fn translator_mut(&mut self) -> &mut dyn Translator {
        self.translator.as_mut()
    }

    pub fn replace_translator(&mut self, replacement: Box<dyn Translator>) {
        self.translator.close();
        self.translator = replacement;
    }

    pub fn translate(&mut self, text: &str, target: Language) -> Result<String, String> {
        self.translate_many(&[text.to_string()], target)?
            .into_iter()
            .next()
            .ok_or_else(|| "번역 엔진이 결과를 반환하지 않았습니다.".to_string())
    }

    pub fn translate_many(
        &mut self,
        texts: &[String],
        target: Language,
    ) -> Result<Vec<String>, String> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }

        let groups = texts
            .iter()
            .map(|text| split_for_translation(text, MAX_TRANSLATION_CHARS))
            .collect::<Vec<_>>();
        let flattened = groups.iter().flatten().cloned().collect::<Vec<_>>();
        let translated = self.translate_many_unchunked(&flattened, target)?;
        let mut translated = translated.into_iter();
        groups
            .into_iter()
            .map(|chunks| {
                let mut result = String::new();
                for _ in chunks {
                    result.push_str(&translated.next().ok_or_else(|| {
                        "번역 엔진이 일부 텍스트의 결과를 반환하지 않았습니다.".to_string()
                    })?);
                }
                Ok(result)
            })
            .collect()
    }

    fn translate_many_unchunked(
        &mut self,
        texts: &[String],
        target: Language,
    ) -> Result<Vec<String>, String> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let mut results: Vec<Option<String>> = vec![None; texts.len()];
        let mut pending = Vec::new();
        for (index, text) in texts.iter().enumerate() {
            let protected = protect_text(text);
            if !protected.has_translatable_text() {
                results[index] = Some(text.clone());
                continue;
            }
            let source = self.detector.detect(text, true);
            if source == target {
                results[index] = Some(self.translate_japanese_fragments(text, target)?);
                continue;
            }
            if source == Language::Unknown {
                results[index] = Some(text.clone());
                continue;
            }
            let source_hash = source_hash(text);
            if let Some(cached) = self.cache.get_message(
                &source_hash,
                text,
                source.code(),
                target.code(),
                self.translator.cache_namespace(),
                false,
            )? {
                results[index] = Some(preserve_terminal_punctuation(text, &cached));
                continue;
            }
            pending.push((index, text.clone(), protected, source, source_hash));
        }

        if !pending.is_empty() {
            let items: Vec<_> = pending
                .iter()
                .map(|(_, _, protected, source, _)| (protected.masked.clone(), *source))
                .collect();
            let translated = self.translator.translate_many(&items, target)?;
            if translated.len() != pending.len() {
                return Err("번역 엔진이 요청한 메시지 수와 다른 결과를 반환했습니다.".to_string());
            }
            for ((index, text, protected, source, hash), translated) in
                pending.into_iter().zip(translated)
            {
                let restored =
                    preserve_terminal_punctuation(&text, &protected.restore(&translated));
                if self
                    .translator
                    .should_cache(&text, &restored, source, target)
                {
                    self.cache.put(
                        &hash,
                        &text,
                        source.code(),
                        target.code(),
                        &restored,
                        self.translator.cache_namespace(),
                    )?;
                }
                results[index] = Some(restored);
            }
        }

        results
            .into_iter()
            .map(|result| {
                result.ok_or_else(|| {
                    "번역 엔진이 일부 메시지의 결과를 반환하지 않았습니다.".to_string()
                })
            })
            .collect()
    }

    fn translate_japanese_fragments(
        &mut self,
        text: &str,
        target: Language,
    ) -> Result<String, String> {
        if target != Language::Korean {
            return Ok(text.to_string());
        }
        let mut translated = String::new();
        let mut cursor = 0;
        let mut changed = false;
        for found in JAPANESE_FRAGMENT_RE.find_iter(text) {
            let fragment = found.as_str();
            if self.detector.detect(fragment, false) != Language::Japanese {
                continue;
            }
            translated.push_str(&text[cursor..found.start()]);
            let result = self.translate_known_source(
                fragment,
                &protect_text(fragment),
                Language::Japanese,
                target,
            )?;
            changed |= result != fragment;
            translated.push_str(&result);
            cursor = found.end();
        }
        if !changed {
            return Ok(text.to_string());
        }
        translated.push_str(&text[cursor..]);
        Ok(translated)
    }

    fn translate_known_source(
        &mut self,
        text: &str,
        protected: &ProtectedText,
        source: Language,
        target: Language,
    ) -> Result<String, String> {
        let hash = source_hash(text);
        if let Some(cached) = self.cache.get_message(
            &hash,
            text,
            source.code(),
            target.code(),
            self.translator.cache_namespace(),
            false,
        )? {
            return Ok(preserve_terminal_punctuation(text, &cached));
        }
        let translated = self
            .translator
            .translate(&protected.masked, source, target)?;
        let restored = preserve_terminal_punctuation(text, &protected.restore(&translated));
        if self
            .translator
            .should_cache(text, &restored, source, target)
        {
            self.cache.put(
                &hash,
                text,
                source.code(),
                target.code(),
                &restored,
                self.translator.cache_namespace(),
            )?;
        }
        Ok(restored)
    }
}

impl Drop for TranslationService {
    fn drop(&mut self) {
        self.translator.close();
    }
}

fn source_hash(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

fn preserve_terminal_punctuation(source: &str, translated: &str) -> String {
    let source_lines: Vec<_> = source.split('\n').collect();
    let translated_lines: Vec<_> = translated.split('\n').collect();
    if source_lines.len() == translated_lines.len() {
        return source_lines
            .into_iter()
            .zip(translated_lines)
            .map(|(source_line, translated_line)| {
                remove_added_terminal_punctuation(source_line, translated_line)
            })
            .collect::<Vec<_>>()
            .join("\n");
    }
    remove_added_terminal_punctuation(source, translated)
}

fn remove_added_terminal_punctuation(source: &str, translated: &str) -> String {
    if has_terminal_punctuation(source) || !has_terminal_punctuation(translated) {
        return translated.to_string();
    }

    let trailing_whitespace = translated.len() - translated.trim_end().len();
    let content_end = translated.len() - trailing_whitespace;
    let content = &translated[..content_end];
    let trailing = &translated[content_end..];
    let mut punctuation_end = content.len();

    while let Some((index, character)) = content[..punctuation_end].char_indices().next_back() {
        if is_terminal_closer(character) {
            punctuation_end = index;
        } else {
            break;
        }
    }

    let mut punctuation_start = punctuation_end;
    while let Some((index, character)) = content[..punctuation_start].char_indices().next_back() {
        if is_sentence_terminal(character) {
            punctuation_start = index;
        } else {
            break;
        }
    }
    if punctuation_start == punctuation_end {
        return translated.to_string();
    }

    format!(
        "{}{}{}",
        &content[..punctuation_start],
        &content[punctuation_end..],
        trailing
    )
}

fn has_terminal_punctuation(text: &str) -> bool {
    let characters = text.trim_end().chars().rev();
    for character in characters {
        if is_terminal_closer(character) {
            continue;
        }
        return is_sentence_terminal(character);
    }
    false
}

fn is_sentence_terminal(character: char) -> bool {
    matches!(character, '.' | '。' | '!' | '！' | '?' | '？' | '…')
}

fn is_terminal_closer(character: char) -> bool {
    matches!(
        character,
        '"' | '\'' | '”' | '’' | '」' | '』' | '】' | '〉' | '》' | ')' | ']' | '}'
    )
}

#[cfg(test)]
mod tests {
    use super::{has_terminal_punctuation, preserve_terminal_punctuation, TranslationService};
    use crate::cache::TranslationCache;
    use crate::language::Language;
    use crate::translation::hymt::{detect_speech_style, HyMtModelSize, HyMtTranslator};
    use crate::translation::{MockTranslator, Translator};
    use std::fs;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct CountingTranslator {
        calls: Arc<Mutex<usize>>,
    }

    struct RecordingIdentityTranslator {
        inputs: Arc<Mutex<Vec<String>>>,
    }

    impl Translator for CountingTranslator {
        fn display_name(&self) -> &str {
            "counting"
        }

        fn cache_namespace(&self) -> &str {
            "counting:v1"
        }

        fn translate(
            &mut self,
            text: &str,
            _source: Language,
            target: Language,
        ) -> Result<String, String> {
            *self.calls.lock().unwrap() += 1;
            Ok(format!("[{}] {text}", target.code()))
        }
    }

    impl Translator for RecordingIdentityTranslator {
        fn display_name(&self) -> &str {
            "recording-identity"
        }

        fn cache_namespace(&self) -> &str {
            "recording-identity:v1"
        }

        fn translate(
            &mut self,
            text: &str,
            _source: Language,
            _target: Language,
        ) -> Result<String, String> {
            self.inputs.lock().unwrap().push(text.to_string());
            Ok(text.to_string())
        }

        fn should_cache(
            &self,
            _source_text: &str,
            _translated_text: &str,
            _source: Language,
            _target: Language,
        ) -> bool {
            false
        }
    }

    fn cache_path(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nude-translator-service-{name}-{nonce}"))
            .join("cache.db")
    }

    #[test]
    fn skips_same_language_and_non_translatable_emoticons() {
        let path = cache_path("skip");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(Box::new(MockTranslator), cache);
        assert_eq!(
            service.translate("안녕하세요", Language::Korean).unwrap(),
            "안녕하세요"
        );
        assert_eq!(
            service
                .translate("(•ω•)つス.....", Language::Korean)
                .unwrap(),
            "(•ω•)つス....."
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn protects_tokens_and_reuses_exact_cache_entries() {
        let path = cache_path("cache");
        let calls = Arc::new(Mutex::new(0));
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(
            Box::new(CountingTranslator {
                calls: calls.clone(),
            }),
            cache,
        );
        let first = service
            .translate("Hello @everyone 👋", Language::Korean)
            .unwrap();
        let second = service
            .translate("Hello @everyone 👋", Language::Korean)
            .unwrap();
        assert!(first.contains("@everyone 👋"));
        assert_eq!(first, second);
        assert_eq!(*calls.lock().unwrap(), 1);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn long_text_is_translated_in_bounded_chunks_without_losing_content() {
        let path = cache_path("long-text-chunks");
        let inputs = Arc::new(Mutex::new(Vec::new()));
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(
            Box::new(RecordingIdentityTranslator {
                inputs: inputs.clone(),
            }),
            cache,
        );
        let source = "긴 문장입니다. ".repeat(180);
        let translated = service
            .translate(&source, Language::Japanese)
            .expect("translate long text");
        let recorded = inputs.lock().unwrap();
        assert!(recorded.len() >= 2, "recorded inputs: {}", recorded.len());
        assert!(recorded.iter().all(|text| text.chars().count() <= 700));
        assert_eq!(translated, source);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn removes_sentence_endings_added_by_translation() {
        assert_eq!(
            preserve_terminal_punctuation("안녕", "こんにちは。"),
            "こんにちは"
        );
        assert_eq!(
            preserve_terminal_punctuation("\"안녕\"", "「こんにちは。」"),
            "「こんにちは」"
        );
        assert_eq!(
            preserve_terminal_punctuation("안녕\n잘 자", "こんにちは。\nおやすみ。"),
            "こんにちは\nおやすみ"
        );
    }

    #[test]
    fn preserves_existing_punctuation_and_non_terminal_expression() {
        assert_eq!(
            preserve_terminal_punctuation("안녕!", "こんにちは！"),
            "こんにちは！"
        );
        assert_eq!(
            preserve_terminal_punctuation("진짜...", "本当に……"),
            "本当に……"
        );
        assert_eq!(
            preserve_terminal_punctuation("안녕 😊", "こんにちは 😊"),
            "こんにちは 😊"
        );
    }

    #[test]
    #[ignore = "검증된 Hy-MT2 모델과 llama-server가 필요합니다"]
    fn live_local_model_preserves_casual_tone_without_adding_a_period() {
        let path = cache_path("live-tone-punctuation");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let translator = HyMtTranslator::new(HyMtModelSize::Small, "cpu", "auto").unwrap();
        let mut service = TranslationService::new(Box::new(translator), cache);
        let translated = service
            .translate("오늘 저녁에 같이 게임할래", Language::Japanese)
            .expect("translate casual Korean into Japanese");
        assert_eq!(
            detect_speech_style(&translated, Language::Japanese),
            "casual",
            "unexpected register: {translated}"
        );
        assert!(
            !has_terminal_punctuation(&translated),
            "unexpected terminal punctuation: {translated}"
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    #[ignore = "검증된 Hy-MT2 모델과 llama-server가 필요합니다"]
    fn live_local_model_translates_article_length_text_without_truncation() {
        let path = cache_path("live-long-text");
        let cache = TranslationCache::open(path.clone(), 128).unwrap();
        let translator = HyMtTranslator::new(HyMtModelSize::Small, "auto", "auto").unwrap();
        let mut service = TranslationService::new(Box::new(translator), cache);
        let source = (1..=60)
            .map(|index| {
                format!(
                    "이것은 긴 기사 번역의 {index}번째 검증 문장입니다. 자세한 자료는 https://example.com/article/{index} 에서 확인할 수 있습니다. "
                )
            })
            .collect::<String>();
        assert!(source.chars().count() > 2_800);
        let translated = service
            .translate(&source, Language::Japanese)
            .expect("translate article-length Korean text");
        assert!(translated.contains("https://example.com/article/1"));
        assert!(translated.contains("https://example.com/article/60"));
        assert_eq!(
            crate::language::detect_explicit_language(&translated),
            Language::Japanese
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
