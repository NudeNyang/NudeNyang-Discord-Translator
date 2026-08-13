use std::sync::LazyLock;
use std::time::Instant;

use regex::Regex;
use sha2::{Digest, Sha256};

use crate::cache::TranslationCache;
use crate::language::{Language, LanguageDetector};
use crate::text_split::split_for_translation;

use super::discord_format::DiscordFormatTemplate;
use super::hymt::apply_conservative_semantic_repairs;
use super::protected_text::{protect_text, sanitize_unexpected_marker_artifacts, ProtectedText};
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

    pub fn clear_cache_memory(&self) -> Result<(), String> {
        self.cache.clear_memory()
    }

    pub fn translate(&mut self, text: &str, target: Language) -> Result<String, String> {
        self.translate_many(&[text.to_string()], target)?
            .into_iter()
            .next()
            .ok_or_else(|| "번역 엔진이 결과를 반환하지 않았습니다.".to_string())
    }

    pub fn translate_for_discord(
        &mut self,
        text: &str,
        target: Language,
    ) -> Result<String, String> {
        let template = DiscordFormatTemplate::parse(text);
        let segments = template.translatable_texts();
        if segments.is_empty() {
            return Ok(text.to_string());
        }
        let translated = self.translate_many(&segments, target)?;
        template.render(&translated)
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

    pub fn translate_many_best_effort(
        &mut self,
        texts: &[String],
        target: Language,
    ) -> Vec<String> {
        let mut output = Vec::with_capacity(texts.len());
        for text in texts {
            match self.translate(text, target) {
                Ok(translated) => output.push(translated),
                Err(failure) => {
                    crate::diagnostics::warn(
                        "incoming-translation",
                        &format!(
                            "item kept as original; chars={}; hash={}; error={failure}",
                            text.chars().count(),
                            source_hash(text)
                        ),
                    );
                    output.push(text.clone());
                }
            }
        }
        output
    }

    pub fn translate_many_for_incoming(
        &mut self,
        texts: &[String],
        target: Language,
    ) -> Result<Vec<String>, String> {
        if self.translator.isolate_incoming_failures() {
            Ok(self.translate_many_best_effort(texts, target))
        } else {
            self.translate_many(texts, target)
        }
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
        let started = Instant::now();
        let mut cache_hits = 0_usize;
        let mut passthrough = 0_usize;
        for (index, text) in texts.iter().enumerate() {
            let protected = protect_text(text);
            if !protected.has_translatable_text() {
                results[index] = Some(text.clone());
                passthrough += 1;
                continue;
            }
            let source = self.detector.detect(text, true);
            if source == target {
                results[index] = Some(self.translate_japanese_fragments(text, target)?);
                continue;
            }
            if source == Language::Unknown {
                results[index] = Some(text.clone());
                passthrough += 1;
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
                let cached = sanitize_unexpected_marker_artifacts(text, &cached);
                let cached = apply_conservative_semantic_repairs(&cached, text, source, target);
                results[index] = Some(preserve_terminal_punctuation(text, &cached));
                cache_hits += 1;
                continue;
            }
            pending.push((index, text.clone(), protected, source, source_hash));
        }

        let provider_items = pending.len();
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
                let restored = protected.restore(&translated);
                let restored =
                    apply_conservative_semantic_repairs(&restored, &text, source, target);
                let restored = preserve_terminal_punctuation(&text, &restored);
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

        crate::diagnostics::info(
            "translation-batch",
            &format!(
                "translator={}; items={}; chars={}; cache_hits={cache_hits}; passthrough={passthrough}; provider_items={}; elapsed_ms={}",
                self.translator.display_name(),
                texts.len(),
                texts.iter().map(|text| text.chars().count()).sum::<usize>(),
                provider_items,
                started.elapsed().as_millis(),
            ),
        );

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
            let cached = sanitize_unexpected_marker_artifacts(text, &cached);
            let cached = apply_conservative_semantic_repairs(&cached, text, source, target);
            return Ok(preserve_terminal_punctuation(text, &cached));
        }
        let translated = self
            .translator
            .translate(&protected.masked, source, target)?;
        let restored = protected.restore(&translated);
        let restored = apply_conservative_semantic_repairs(&restored, text, source, target);
        let restored = preserve_terminal_punctuation(text, &restored);
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
    use std::fmt::Write as _;
    use std::time::Instant;

    use super::{has_terminal_punctuation, preserve_terminal_punctuation, TranslationService};
    use crate::cache::TranslationCache;
    use crate::language::{detect_language, Language};
    use crate::translation::hymt::{detect_speech_style, HyMtModelSize, HyMtTranslator};
    use crate::translation::{translation_needs_repair, MockTranslator, Translator};
    use std::fs;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct CountingTranslator {
        calls: Arc<Mutex<usize>>,
    }

    struct RecordingIdentityTranslator {
        inputs: Arc<Mutex<Vec<String>>>,
    }

    struct FailOnTextTranslator;

    struct FormattingHostileTranslator {
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

    impl Translator for FailOnTextTranslator {
        fn display_name(&self) -> &str {
            "fail-on-text"
        }

        fn cache_namespace(&self) -> &str {
            "fail-on-text:v1"
        }

        fn isolate_incoming_failures(&self) -> bool {
            true
        }

        fn translate(
            &mut self,
            text: &str,
            _source: Language,
            _target: Language,
        ) -> Result<String, String> {
            if text == "Rules still apply in the server and common filters." {
                Err("length".to_string())
            } else {
                Ok(format!("번역:{text}"))
            }
        }
    }

    impl Translator for FormattingHostileTranslator {
        fn display_name(&self) -> &str {
            "formatting-hostile"
        }

        fn cache_namespace(&self) -> &str {
            "formatting-hostile:v1"
        }

        fn translate(
            &mut self,
            text: &str,
            _source: Language,
            _target: Language,
        ) -> Result<String, String> {
            self.inputs.lock().unwrap().push(text.to_string());
            let translated = text
                .replace("제목", "タイトル")
                .replace("첫 항목", "最初の項目")
                .replace("둘째", "二番目")
                .replace("취소", "取り消し")
                .replace("인용문", "引用文")
                .replace("비밀", "秘密")
                .replace("문서", "文書")
                .replace(['\r', '\n'], " ")
                .replace("# ", "")
                .replace("- ", "")
                .replace("> ", "")
                .replace("**", "")
                .replace("__", "")
                .replace("~~", "")
                .replace("||", "");
            Ok(translated)
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
    fn incoming_batch_sends_only_non_native_languages_to_the_model() {
        let path = cache_path("foreign-only-batch");
        let inputs = Arc::new(Mutex::new(Vec::new()));
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(
            Box::new(RecordingIdentityTranslator {
                inputs: inputs.clone(),
            }),
            cache,
        );
        let source = vec![
            "안녕하세요".to_string(),
            "Hello there".to_string(),
            "こんにちは".to_string(),
        ];

        assert_eq!(
            service
                .translate_many_for_incoming(&source, Language::Korean)
                .unwrap(),
            source
        );
        assert_eq!(
            inputs.lock().unwrap().as_slice(),
            &["Hello there".to_string(), "こんにちは".to_string()]
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn punctuation_only_messages_bypass_the_translation_provider() {
        let path = cache_path("punctuation-only");
        let inputs = Arc::new(Mutex::new(Vec::new()));
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(
            Box::new(RecordingIdentityTranslator {
                inputs: inputs.clone(),
            }),
            cache,
        );
        let source = vec![
            "?".to_string(),
            ";;".to_string(),
            "-".to_string(),
            "?!…".to_string(),
        ];

        assert_eq!(
            service
                .translate_many_for_incoming(&source, Language::Korean)
                .unwrap(),
            source
        );
        assert!(inputs.lock().unwrap().is_empty());
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
    fn contaminated_cached_marker_fragments_are_sanitized() {
        let path = cache_path("marker-cache");
        let calls = Arc::new(Mutex::new(0));
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let source = "Hello 👋";
        cache
            .put(
                &super::source_hash(source),
                source,
                "en",
                "de",
                "Hallo ZXQKEEP 👋",
                "counting:v1",
            )
            .unwrap();
        let mut service = TranslationService::new(
            Box::new(CountingTranslator {
                calls: calls.clone(),
            }),
            cache,
        );

        assert_eq!(
            service.translate(source, Language::German).unwrap(),
            "Hallo 👋"
        );
        assert_eq!(*calls.lock().unwrap(), 0);
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
    fn outgoing_translation_preserves_discord_markdown_and_line_layout() {
        let path = cache_path("discord-formatting");
        let inputs = Arc::new(Mutex::new(Vec::new()));
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(
            Box::new(FormattingHostileTranslator {
                inputs: inputs.clone(),
            }),
            cache,
        );
        let source = concat!(
            "# 제목\r\n",
            "- **첫 항목**\r\n",
            "  - __둘째__와 ~~취소~~\r\n",
            "> ||비밀|| 인용문\r\n",
            "[문서](https://example.com)\r\n",
            "`코드는 그대로`\r\n",
            "```rust\r\n",
            "let untranslated = true;\r\n",
            "```"
        );

        let translated = service
            .translate_for_discord(source, Language::Japanese)
            .expect("translate formatted Discord message");

        assert_eq!(
            translated,
            concat!(
                "# タイトル\r\n",
                "- **最初の項目**\r\n",
                "  - __二番目__와 ~~取り消し~~\r\n",
                "> ||秘密|| 引用文\r\n",
                "[文書](https://example.com)\r\n",
                "`코드는 그대로`\r\n",
                "```rust\r\n",
                "let untranslated = true;\r\n",
                "```"
            )
        );
        assert!(inputs
            .lock()
            .unwrap()
            .iter()
            .all(|input| !input.contains(['\r', '\n'])
                && !input.contains("**")
                && !input.contains("```")));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    #[ignore = "verified Hy-MT2 model and llama-server are required"]
    fn multilingual_translation_benchmark() {
        let path = cache_path("multilingual-live-benchmark");
        let cache = TranslationCache::open(path.clone(), 128).unwrap();
        let translator = HyMtTranslator::new(HyMtModelSize::Small, "auto", "auto")
            .expect("create Hy-MT2 translator");
        assert!(
            translator.model_is_ready(),
            "Hy-MT2 1.8B model is not verified"
        );
        let mut service = TranslationService::new(Box::new(translator), cache);
        service
            .translator_mut()
            .prepare()
            .expect("start llama-server");

        let fixture = include_str!("../../../tests/fixtures/multilingual-detection.tsv");
        let samples = fixture
            .lines()
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .filter_map(|line| {
                let mut columns = line.splitn(3, '\t');
                let code = columns.next()?;
                let scenario = columns.next()?;
                let text = columns.next()?;
                (scenario == "normal" && code != "und")
                    .then(|| (Language::try_from(code).unwrap(), text.to_string()))
            })
            .collect::<Vec<_>>();
        assert_eq!(samples.len(), 28);

        let mut report = String::from(
            "# Hy-MT2 1.8B multilingual smoke benchmark\n\n\
             This is a structural and script-level smoke test, not a human semantic score.\n\n\
             | Direction | Time (ms) | Detected output | Gate | Translation |\n\
             |---|---:|---|---|---|\n",
        );
        let mut failures = Vec::new();
        for (source, text) in &samples {
            if *source == Language::Korean {
                continue;
            }
            let started = Instant::now();
            match service.translate(text, Language::Korean) {
                Ok(translated) => {
                    let elapsed = started.elapsed().as_millis();
                    let detected = detect_language(&translated).language;
                    let needs_repair =
                        translation_needs_repair(text, &translated, *source, Language::Korean);
                    if needs_repair || detected != Language::Korean {
                        failures.push(format!(
                            "{}->ko detected={} repair={needs_repair}: {translated}",
                            source.code(),
                            detected.code(),
                        ));
                    }
                    let safe = translated.replace('|', "\\|").replace('\n', "<br>");
                    let _ = writeln!(
                        report,
                        "| `{}` → `ko` | {elapsed} | `{}` | {} | {safe} |",
                        source.code(),
                        detected.code(),
                        if needs_repair { "repair" } else { "pass" },
                    );
                }
                Err(error) => failures.push(format!("{}->ko error: {error}", source.code())),
            }
        }

        let korean = samples
            .iter()
            .find(|(language, _)| *language == Language::Korean)
            .unwrap()
            .1
            .clone();
        for (target, _) in &samples {
            if *target == Language::Korean {
                continue;
            }
            let started = Instant::now();
            match service.translate(&korean, *target) {
                Ok(translated) => {
                    let elapsed = started.elapsed().as_millis();
                    let detection = detect_language(&translated);
                    let needs_repair =
                        translation_needs_repair(&korean, &translated, Language::Korean, *target);
                    let confidently_wrong =
                        detection.language != Language::Unknown && detection.language != *target;
                    let person_or_register_drift = match target {
                        Language::English => {
                            translated.to_ascii_lowercase().contains("dear sir")
                                || translated.to_ascii_lowercase().contains("dear madam")
                        }
                        Language::BrazilianPortuguese => {
                            translated.to_lowercase().contains("queremos")
                        }
                        Language::German => translated.to_lowercase().contains("möchten wir"),
                        Language::Russian => translated.to_lowercase().contains("хотите ли мы"),
                        Language::Ukrainian => translated.to_lowercase().contains("хочете ми"),
                        Language::Dutch => translated.to_lowercase().contains("willen we"),
                        _ => false,
                    };
                    if needs_repair || confidently_wrong || person_or_register_drift {
                        failures.push(format!(
                            "ko->{} detected={} repair={needs_repair} semantic_drift={person_or_register_drift}: {translated}",
                            target.code(),
                            detection.language.code(),
                        ));
                    }
                    let safe = translated.replace('|', "\\|").replace('\n', "<br>");
                    let _ = writeln!(
                        report,
                        "| `ko` → `{}` | {elapsed} | `{}` | {} | {safe} |",
                        target.code(),
                        detection.language.code(),
                        if needs_repair || confidently_wrong || person_or_register_drift {
                            "repair"
                        } else {
                            "pass"
                        },
                    );
                }
                Err(error) => failures.push(format!("ko->{} error: {error}", target.code())),
            }
        }

        let formatted_source = "# **Hello friends**\n- <@123456> please read the rules at https://example.com\n```js\nconst x = 1;\n```";
        match service.translate_for_discord(formatted_source, Language::Arabic) {
            Ok(translated) => {
                for token in [
                    "# **",
                    "<@123456>",
                    "https://example.com",
                    "```js",
                    "const x = 1;",
                ] {
                    if !translated.contains(token) {
                        failures.push(format!("format token missing: {token}"));
                    }
                }
                report.push_str("\n## Discord formatting smoke test\n\n```text\n");
                report.push_str(&translated);
                report.push_str("\n```\n");
            }
            Err(error) => failures.push(format!("format translation error: {error}")),
        }

        if !failures.is_empty() {
            report.push_str("\n## Failures\n\n");
            for failure in &failures {
                let _ = writeln!(report, "- {failure}");
            }
        }
        if let Ok(path) = std::env::var("NUDE_TRANSLATOR_TRANSLATION_REPORT") {
            let path = std::path::PathBuf::from(path);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(&path, &report).unwrap();
            println!("{}", path.display());
        }
        service.translator_mut().close();
        let _ = fs::remove_dir_all(path.parent().unwrap());
        assert!(failures.is_empty(), "\n{report}");
    }

    #[test]
    #[ignore = "verified Hy-MT2 7B, TranslateGemma 4B, and llama-server are required"]
    fn multilingual_translation_benchmark_extended_local_models() {
        let fixture = include_str!("../../../tests/fixtures/multilingual-detection.tsv");
        let extended_codes = ["th", "fil", "bn", "ur", "ta", "fa", "he", "cs"];
        let samples = fixture
            .lines()
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .filter_map(|line| {
                let mut columns = line.splitn(3, '\t');
                let code = columns.next()?;
                let scenario = columns.next()?;
                let text = columns.next()?;
                (scenario == "normal" && extended_codes.contains(&code))
                    .then(|| (Language::try_from(code).unwrap(), text.to_string()))
            })
            .collect::<Vec<_>>();
        assert_eq!(samples.len(), extended_codes.len());
        let korean = "안녕, 오늘 밤 서버에서 같이 게임할래?";
        let mut report = String::from(
            "# Extended-language local model benchmark\n\n\
             Hy-MT2 7B and TranslateGemma 4B are checked on the eight first-wave extension languages.\n\n\
             | Model | Direction | Detected output | Gate | Translation |\n\
             |---|---|---|---|---|\n",
        );
        let mut failures = Vec::new();

        for (model_size, model_key) in [
            (HyMtModelSize::Large, "hymt-7b"),
            (HyMtModelSize::TranslateGemma4B, "translategemma-4b"),
        ] {
            let path = cache_path(&format!("extended-{model_key}"));
            let cache = TranslationCache::open(path.clone(), 64).unwrap();
            let translator = HyMtTranslator::new(model_size, "auto", "auto")
                .unwrap_or_else(|error| panic!("create {model_key}: {error}"));
            assert!(
                translator.model_is_ready(),
                "{model_key} model is not verified"
            );
            let mut service = TranslationService::new(Box::new(translator), cache);
            service
                .translator_mut()
                .prepare()
                .unwrap_or_else(|error| panic!("start {model_key}: {error}"));

            for (source, text) in &samples {
                for (source_text, source_language, target) in [
                    (text.as_str(), *source, Language::Korean),
                    (korean, Language::Korean, *source),
                ] {
                    match service.translate(source_text, target) {
                        Ok(translated) => {
                            let detection = detect_language(&translated);
                            let needs_repair = translation_needs_repair(
                                source_text,
                                &translated,
                                source_language,
                                target,
                            );
                            let confidently_wrong = detection.language != Language::Unknown
                                && detection.language != target;
                            let listener_question_drift = source_language == Language::Korean
                                && match target {
                                    Language::Thai => translated.contains("เซิร์ฟเวอร์ใด"),
                                    Language::Bengali => translated.contains("কি আমরা"),
                                    Language::Urdu => translated.contains("کیا ہم"),
                                    Language::Tamil => translated.contains("விளையாடலாமா"),
                                    Language::Persian => translated.contains("قصد داریم"),
                                    Language::Hebrew => translated.contains("האם נשחק"),
                                    Language::Czech => translated.contains("rád bych"),
                                    _ => false,
                                };
                            let source_meaning_drift = source_language == Language::Tamil
                                && target == Language::Korean
                                && translated.contains("서비스 센터");
                            if needs_repair
                                || confidently_wrong
                                || listener_question_drift
                                || source_meaning_drift
                            {
                                failures.push(format!(
                                    "{model_key} {}->{} detected={} repair={needs_repair} listener_drift={listener_question_drift} meaning_drift={source_meaning_drift}: {translated}",
                                    source_language.code(),
                                    target.code(),
                                    detection.language.code(),
                                ));
                            }
                            let safe = translated.replace('|', "\\|").replace('\n', "<br>");
                            let _ = writeln!(
                                report,
                                "| `{model_key}` | `{}` → `{}` | `{}` | {} | {safe} |",
                                source_language.code(),
                                target.code(),
                                detection.language.code(),
                                if needs_repair
                                    || confidently_wrong
                                    || listener_question_drift
                                    || source_meaning_drift
                                {
                                    "repair"
                                } else {
                                    "pass"
                                },
                            );
                        }
                        Err(error) => failures.push(format!(
                            "{model_key} {}->{} error: {error}",
                            source_language.code(),
                            target.code(),
                        )),
                    }
                }
            }
            service.translator_mut().close();
            let _ = fs::remove_dir_all(path.parent().unwrap());
        }

        if !failures.is_empty() {
            report.push_str("\n## Failures\n\n");
            for failure in &failures {
                let _ = writeln!(report, "- {failure}");
            }
        }
        if let Ok(main_report) = std::env::var("NUDE_TRANSLATOR_TRANSLATION_REPORT") {
            let path = std::path::PathBuf::from(main_report)
                .with_file_name("extended-local-models-translation.md");
            std::fs::write(&path, &report).unwrap();
            println!("{}", path.display());
        }
        assert!(failures.is_empty(), "\n{report}");
    }

    #[test]
    fn best_effort_batch_isolates_one_failure_without_dropping_other_messages() {
        let path = cache_path("best-effort-isolation");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(Box::new(FailOnTextTranslator), cache);
        let source = vec![
            "Hello Welcome to BugCat 3.0".to_string(),
            "Rules still apply in the server and common filters.".to_string(),
            "Please check other servers".to_string(),
        ];

        let translated = service
            .translate_many_for_incoming(&source, Language::Korean)
            .unwrap();

        assert_eq!(translated[0], "번역:Hello Welcome to BugCat 3.0");
        assert_eq!(translated[1], source[1]);
        assert_eq!(translated[2], "번역:Please check other servers");
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
