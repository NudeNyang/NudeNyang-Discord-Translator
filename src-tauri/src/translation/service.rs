use std::sync::LazyLock;

use regex::Regex;
use sha2::{Digest, Sha256};

use crate::cache::TranslationCache;
use crate::language::{Language, LanguageDetector};

use super::protected_text::{protect_text, ProtectedText};
use super::Translator;

static JAPANESE_FRAGMENT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"[A-Za-z0-9]*[\u{3040}-\u{30ff}\u{31f0}-\u{31ff}\u{3400}-\u{4dbf}\u{4e00}-\u{9fff}][\u{3040}-\u{30ff}\u{31f0}-\u{31ff}\u{3400}-\u{4dbf}\u{4e00}-\u{9fff}A-Za-z0-9（）()「」『』【】・ー〜～._-]*",
    )
    .unwrap()
});

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
        let protected = protect_text(text);
        if !protected.has_translatable_text() {
            return Ok(text.to_string());
        }
        let source = self.detector.detect(text, true);
        if source == target {
            return self.translate_japanese_fragments(text, target);
        }
        if source == Language::Unknown {
            return Ok(text.to_string());
        }
        self.translate_known_source(text, &protected, source, target)
    }

    pub fn translate_many(
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
                results[index] = Some(cached);
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
                let restored = protected.restore(&translated);
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
                result
                    .ok_or_else(|| "번역 엔진이 일부 메시지의 결과를 반환하지 않았어.".to_string())
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
            return Ok(cached);
        }
        let translated = self
            .translator
            .translate(&protected.masked, source, target)?;
        let restored = protected.restore(&translated);
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

#[cfg(test)]
mod tests {
    use super::TranslationService;
    use crate::cache::TranslationCache;
    use crate::language::Language;
    use crate::translation::{MockTranslator, Translator};
    use std::fs;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct CountingTranslator {
        calls: Arc<Mutex<usize>>,
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
}
