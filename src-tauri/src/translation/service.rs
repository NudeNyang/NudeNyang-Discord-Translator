use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;
use std::time::Instant;

use regex::Regex;
use sha2::{Digest, Sha256};

use crate::cache::TranslationCache;
use crate::language::{
    detect_explicit_language, detect_language, detection_script_family, language_script_family,
    Language, LanguageDetector, ScriptFamily,
};
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

static ENGLISH_FRAGMENT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"[A-Za-z][A-Za-z0-9'’.,!?-]*(?:[ \t\r\n]+[A-Za-z0-9][A-Za-z0-9'’.,!?-]*)+").unwrap()
});

const MAX_TRANSLATION_CHARS: usize = 700;
const MAX_MESSAGE_CONTEXT_CHARS: usize = 320;
const MESSAGE_CONTEXT_SEPARATOR: &str = " <NTSPLIT> ";
const WEB_VISIBLE_BATCH_CONTEXT_KEY: &str = "web:visible-batch";
const CONTEXT_COLLAPSED_PLACEHOLDER: &str = "\u{200b}";
const QUALITY_REJECTED_ERROR: &str = "번역 품질 검사 실패";
const MAX_INCOMING_QUALITY_ATTEMPTS: usize = 2;

#[derive(Clone, Copy)]
enum BestEffortChunkPolicy {
    WholeText,
    PreserveSuccessfulChunks,
}

fn split_visual_lines_preserving_endings(text: &str) -> Vec<(String, String)> {
    text.split_inclusive('\n')
        .map(|line| {
            if let Some(content) = line.strip_suffix("\r\n") {
                (content.to_string(), "\r\n".to_string())
            } else if let Some(content) = line.strip_suffix('\n') {
                (content.to_string(), "\n".to_string())
            } else {
                (line.to_string(), String::new())
            }
        })
        .collect()
}

pub fn outgoing_can_passthrough(text: &str, target: Option<Language>) -> bool {
    let segments = DiscordFormatTemplate::parse(text).translatable_texts();
    let meaningful = segments
        .iter()
        .filter(|segment| protect_text(segment).has_translatable_text())
        .collect::<Vec<_>>();
    if meaningful.is_empty() {
        return true;
    }
    let Some(target) = target.filter(|target| *target != Language::Unknown) else {
        return false;
    };

    meaningful.into_iter().all(|segment| {
        let detection = detect_language(segment);
        if detection.language == Language::Unknown {
            return true;
        }
        if detection.language != target {
            return false;
        }
        if target != Language::Korean {
            return true;
        }

        let has_japanese_fragment = JAPANESE_FRAGMENT_RE.find_iter(segment).any(|found| {
            let fragment = found.as_str();
            protect_text(fragment).has_translatable_text()
                && detect_language(fragment).language == Language::Japanese
        });
        let has_english_fragment = ENGLISH_FRAGMENT_RE.find_iter(segment).any(|found| {
            let fragment = found.as_str();
            let detection = detect_language(fragment);
            protect_text(fragment).has_translatable_text()
                && detection.language == Language::English
                && detection.confidence >= 0.99
        });
        !has_japanese_fragment && !has_english_fragment
    })
}

pub struct TranslationService {
    translator: Box<dyn Translator>,
    cache: TranslationCache,
    detector: LanguageDetector,
    incoming_detector: LanguageDetector,
    incoming_context_scope: String,
    web_detector: LanguageDetector,
    web_context_scope: String,
    navigation_context_scope: String,
    navigation_languages: HashMap<ScriptFamily, Language>,
}

impl TranslationService {
    pub fn new(translator: Box<dyn Translator>, cache: TranslationCache) -> Self {
        Self {
            translator,
            cache,
            detector: LanguageDetector::default(),
            incoming_detector: LanguageDetector::default(),
            incoming_context_scope: String::new(),
            web_detector: LanguageDetector::default(),
            web_context_scope: String::new(),
            navigation_context_scope: String::new(),
            navigation_languages: HashMap::new(),
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

    pub fn translate_with_source(
        &mut self,
        text: &str,
        source: Language,
        target: Language,
    ) -> Result<String, String> {
        if source == Language::Unknown {
            return self.translate(text, target);
        }
        if source == target {
            return Ok(text.to_string());
        }
        let protected = protect_text(text);
        if !protected.has_translatable_text() {
            return Ok(text.to_string());
        }
        self.translate_known_source(text, &protected, source, target)
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
        let source_hints = vec![None; texts.len()];
        self.translate_many_with_source_hints(texts, &source_hints, target, None)
    }

    pub fn translate_many_with_sources(
        &mut self,
        texts: &[String],
        sources: &[Language],
        target: Language,
    ) -> Result<Vec<String>, String> {
        let source_hints = sources.iter().copied().map(Some).collect::<Vec<_>>();
        self.translate_many_with_source_hints(texts, &source_hints, target, None)
    }

    pub fn translate_span_with_context(
        &mut self,
        selection: &str,
        context: &str,
        source: Language,
        target: Language,
    ) -> Result<(String, String), String> {
        let selection = collapse_context_whitespace(selection);
        let context = collapse_context_whitespace(context);
        if selection.is_empty() {
            return Err("문맥 번역에서 선택한 표현이 비어 있습니다.".to_string());
        }
        if context.is_empty() || context == selection || source == target {
            let translated = self.translate_with_source(&selection, source, target)?;
            let localized_context = if context.is_empty() || context == selection {
                translated.clone()
            } else {
                self.translate_with_source(&context, source, target)?
            };
            return Ok((translated, localized_context));
        }

        let Some(selection_start) = nearest_selection_start(&context, &selection) else {
            let translated = self.translate_many_with_sources(
                &[selection.clone(), context.clone()],
                &[source, source],
                target,
            )?;
            return Ok((translated[0].clone(), translated[1].clone()));
        };
        let selection_end = selection_start + selection.len();
        let mut parts = Vec::with_capacity(3);
        let mut selection_part = 0;
        for (kind, part) in [
            (0_u8, &context[..selection_start]),
            (1_u8, &context[selection_start..selection_end]),
            (2_u8, &context[selection_end..]),
        ] {
            let part = part.trim();
            if part.is_empty() {
                continue;
            }
            if kind == 1 {
                selection_part = parts.len();
            }
            parts.push(part.to_string());
        }
        if parts.len() < 2 {
            let translated = self.translate_with_source(&selection, source, target)?;
            return Ok((translated.clone(), translated));
        }

        let hints = vec![Some(source); parts.len()];
        let keys = vec![Some("message:dictionary-context".to_string()); parts.len()];
        let translated = self.translate_contextual_pending(
            &parts,
            &hints,
            &keys,
            target,
            None,
            BestEffortChunkPolicy::WholeText,
        )?;
        let translated_selection = translated
            .get(selection_part)
            .cloned()
            .ok_or_else(|| "문맥 번역에서 선택한 표현의 결과를 찾지 못했습니다.".to_string())?;
        Ok((translated_selection, translated.join(" ")))
    }

    fn translate_many_with_source_hints(
        &mut self,
        texts: &[String],
        source_hints: &[Option<Language>],
        target: Language,
        allowed_sources: Option<&HashSet<Language>>,
    ) -> Result<Vec<String>, String> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        if texts.len() != source_hints.len() {
            return Err("번역 문맥 정보의 개수가 원문 개수와 다릅니다.".to_string());
        }

        let groups = texts
            .iter()
            .map(|text| split_for_translation(text, MAX_TRANSLATION_CHARS))
            .collect::<Vec<_>>();
        let flattened = groups.iter().flatten().cloned().collect::<Vec<_>>();
        let flattened_hints = groups
            .iter()
            .zip(source_hints)
            .flat_map(|(chunks, hint)| std::iter::repeat_n(*hint, chunks.len()))
            .collect::<Vec<_>>();
        let translated =
            self.translate_many_unchunked(&flattened, &flattened_hints, target, allowed_sources)?;
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
        let source_hints = vec![None; texts.len()];
        self.translate_many_best_effort_with_hints(texts, &source_hints, target, None)
    }

    fn translate_many_best_effort_with_hints(
        &mut self,
        texts: &[String],
        source_hints: &[Option<Language>],
        target: Language,
        allowed_sources: Option<&HashSet<Language>>,
    ) -> Vec<String> {
        texts
            .iter()
            .zip(source_hints)
            .map(|(text, hint)| {
                self.translate_one_best_effort_with_hint(text, *hint, target, allowed_sources)
                    .0
            })
            .collect()
    }

    fn translate_one_best_effort_with_hint(
        &mut self,
        text: &String,
        source_hint: Option<Language>,
        target: Language,
        allowed_sources: Option<&HashSet<Language>>,
    ) -> (String, bool) {
        for attempt in 1..=MAX_INCOMING_QUALITY_ATTEMPTS {
            match self.translate_many_with_source_hints(
                std::slice::from_ref(text),
                std::slice::from_ref(&source_hint),
                target,
                allowed_sources,
            ) {
                Ok(mut translated) => return (translated.remove(0), true),
                Err(failure)
                    if failure.starts_with(QUALITY_REJECTED_ERROR)
                        && attempt < MAX_INCOMING_QUALITY_ATTEMPTS =>
                {
                    crate::diagnostics::info(
                        "incoming-translation-quality-retry",
                        &format!(
                            "attempt={attempt}; chars={}; hash={}",
                            text.chars().count(),
                            source_hash(text)
                        ),
                    );
                }
                Err(failure) => {
                    crate::diagnostics::warn(
                        "incoming-translation",
                        &format!(
                            "item kept as original; attempts={attempt}; chars={}; hash={}; error={failure}",
                            text.chars().count(),
                            source_hash(text)
                        ),
                    );
                    break;
                }
            }
        }
        (text.clone(), false)
    }

    fn translate_many_best_effort_with_chunk_policy(
        &mut self,
        texts: &[String],
        source_hints: &[Option<Language>],
        target: Language,
        allowed_sources: Option<&HashSet<Language>>,
        chunk_policy: BestEffortChunkPolicy,
    ) -> Vec<String> {
        if matches!(chunk_policy, BestEffortChunkPolicy::WholeText) {
            return self.translate_many_best_effort_with_hints(
                texts,
                source_hints,
                target,
                allowed_sources,
            );
        }

        texts
            .iter()
            .zip(source_hints)
            .map(|(text, hint)| {
                let chunks = split_for_translation(text, MAX_TRANSLATION_CHARS);
                chunks
                    .into_iter()
                    .map(|chunk| {
                        let (translated, succeeded) = self.translate_one_best_effort_with_hint(
                            &chunk,
                            *hint,
                            target,
                            allowed_sources,
                        );
                        if succeeded {
                            return translated;
                        }

                        self.retry_failed_web_chunk_by_visual_lines(
                            &chunk,
                            *hint,
                            target,
                            allowed_sources,
                        )
                        .unwrap_or(translated)
                    })
                    .collect::<String>()
            })
            .collect()
    }

    fn retry_failed_web_chunk_by_visual_lines(
        &mut self,
        text: &str,
        source_hint: Option<Language>,
        target: Language,
        allowed_sources: Option<&HashSet<Language>>,
    ) -> Option<String> {
        let lines = split_visual_lines_preserving_endings(text);
        if lines
            .iter()
            .filter(|(line, _)| !line.trim().is_empty())
            .count()
            < 2
        {
            return None;
        }

        crate::diagnostics::info(
            "web-translation-line-fallback",
            &format!(
                "lines={}; chars={}; hash={}",
                lines.len(),
                text.chars().count(),
                source_hash(text)
            ),
        );

        Some(
            lines
                .into_iter()
                .map(|(line, ending)| {
                    if line.trim().is_empty() {
                        return format!("{line}{ending}");
                    }
                    let (translated, _) = self.translate_one_best_effort_with_hint(
                        &line,
                        source_hint,
                        target,
                        allowed_sources,
                    );
                    format!("{translated}{ending}")
                })
                .collect(),
        )
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

    pub fn translate_many_for_incoming_contextual(
        &mut self,
        texts: &[String],
        message_keys: &[Option<String>],
        context_scope: &str,
        target: Language,
    ) -> Result<Vec<String>, String> {
        self.translate_many_for_incoming_contextual_filtered(
            texts,
            message_keys,
            context_scope,
            target,
            None,
        )
    }

    pub fn translate_many_for_incoming_contextual_filtered(
        &mut self,
        texts: &[String],
        message_keys: &[Option<String>],
        context_scope: &str,
        target: Language,
        allowed_sources: Option<&HashSet<Language>>,
    ) -> Result<Vec<String>, String> {
        let source_hints = self.incoming_source_hints(texts, message_keys, context_scope)?;
        let mut results = vec![None; texts.len()];
        let mut pending_indices = Vec::new();
        let mut pending_texts = Vec::new();
        let mut pending_hints = Vec::new();
        let mut pending_keys = Vec::new();

        for (index, ((text, message_key), source_hint)) in texts
            .iter()
            .zip(message_keys)
            .zip(&source_hints)
            .enumerate()
        {
            let detected = detect_explicit_language(text);
            let source = if detected == Language::Unknown {
                source_hint.unwrap_or(Language::Unknown)
            } else {
                detected
            };
            let source_is_allowed = allowed_sources.is_none_or(|allowed| allowed.contains(&source));
            if let Some(translated) = source_is_allowed
                .then(|| preferred_navigation_translation(text, message_key.as_deref(), target))
                .flatten()
            {
                results[index] = Some(translated);
            } else {
                pending_indices.push(index);
                pending_texts.push(text.clone());
                pending_hints.push(*source_hint);
                pending_keys.push(message_key.clone());
            }
        }

        let translated = self.translate_contextual_pending(
            &pending_texts,
            &pending_hints,
            &pending_keys,
            target,
            allowed_sources,
            BestEffortChunkPolicy::WholeText,
        )?;
        if translated.len() != pending_indices.len() {
            return Err("번역 엔진이 일부 텍스트의 결과를 반환하지 않았습니다.".to_string());
        }

        for (index, translated) in pending_indices.into_iter().zip(translated) {
            results[index] = Some(translated);
        }
        results
            .into_iter()
            .map(|translated| {
                translated.ok_or_else(|| {
                    "번역 엔진이 일부 텍스트의 결과를 반환하지 않았습니다.".to_string()
                })
            })
            .collect()
    }

    pub fn translate_many_for_web_contextual_filtered(
        &mut self,
        texts: &[String],
        block_keys: &[Option<String>],
        page_scope: &str,
        target: Language,
        allowed_sources: Option<&HashSet<Language>>,
    ) -> Result<Vec<String>, String> {
        let source_hints = self.web_source_hints(texts, block_keys, page_scope)?;
        let mut results = vec![None; texts.len()];
        let mut pending_indices = Vec::new();
        let mut pending_texts = Vec::new();
        let mut pending_hints = Vec::new();
        let mut pending_keys = Vec::new();

        for (index, ((text, _block_key), source_hint)) in
            texts.iter().zip(block_keys).zip(&source_hints).enumerate()
        {
            let detected = detect_explicit_language(text);
            let source = if detected == Language::Unknown {
                source_hint.unwrap_or(Language::Unknown)
            } else {
                detected
            };
            if allowed_sources.is_some_and(|allowed| !allowed.contains(&source)) {
                results[index] = Some(text.clone());
                continue;
            }
            pending_indices.push(index);
            pending_texts.push(text.clone());
            pending_hints.push(*source_hint);
            // A web request already contains only nearby blocks in DOM order. Give those
            // blocks one short-lived context key so the local model can process several
            // adjacent snippets per inference instead of waking once per paragraph/list row.
            // The original block keys are still used above for source-language hints.
            pending_keys.push(Some(WEB_VISIBLE_BATCH_CONTEXT_KEY.to_string()));
        }

        let translated = self.translate_contextual_pending(
            &pending_texts,
            &pending_hints,
            &pending_keys,
            target,
            allowed_sources,
            BestEffortChunkPolicy::PreserveSuccessfulChunks,
        )?;
        if translated.len() != pending_indices.len() {
            return Err("번역 엔진이 일부 웹 텍스트의 결과를 반환하지 않았습니다.".to_string());
        }
        for (index, translated) in pending_indices.into_iter().zip(translated) {
            results[index] = Some(translated);
        }
        results
            .into_iter()
            .map(|translated| {
                translated.ok_or_else(|| {
                    "번역 엔진이 일부 웹 텍스트의 결과를 반환하지 않았습니다.".to_string()
                })
            })
            .collect()
    }

    fn translate_contextual_pending(
        &mut self,
        texts: &[String],
        source_hints: &[Option<Language>],
        message_keys: &[Option<String>],
        target: Language,
        allowed_sources: Option<&HashSet<Language>>,
        chunk_policy: BestEffortChunkPolicy,
    ) -> Result<Vec<String>, String> {
        if texts.len() != source_hints.len() || texts.len() != message_keys.len() {
            return Err("번역 문맥 정보의 개수가 원문 개수와 다릅니다.".to_string());
        }

        let mut candidates = HashMap::<(String, Language), Vec<usize>>::new();
        let mut resolved_sources = vec![Language::Unknown; texts.len()];
        let mut known_fragments = Vec::<(usize, String, Language)>::new();
        for (index, ((text, hint), message_key)) in
            texts.iter().zip(source_hints).zip(message_keys).enumerate()
        {
            let Some(message_key) = message_key
                .as_deref()
                .filter(|key| is_message_context_key(key))
            else {
                continue;
            };
            if text.contains('\r')
                || text.contains('\n')
                || text.contains(MESSAGE_CONTEXT_SEPARATOR.trim())
            {
                continue;
            }
            let detected = detect_explicit_language(text);
            let source = if detected == Language::Unknown {
                hint.unwrap_or(Language::Unknown)
            } else {
                detected
            };
            resolved_sources[index] = source;
            if source == Language::Unknown || source == target {
                continue;
            }
            known_fragments.push((index, message_key.to_string(), source));
            candidates
                .entry((message_key.to_string(), source))
                .or_default()
                .push(index);
        }

        // Discord can render one sentence as separate text nodes such as
        // `1`, `Violation:`, `1`, and `day blocked`. Numeric and punctuation-only
        // nodes have no detectable language, so attach them to the nearest
        // translated fragment from the same message to preserve the full context.
        for (index, ((text, message_key), source)) in texts
            .iter()
            .zip(message_keys)
            .zip(&resolved_sources)
            .enumerate()
        {
            if *source != Language::Unknown
                || text.contains('\r')
                || text.contains('\n')
                || text.contains(MESSAGE_CONTEXT_SEPARATOR.trim())
                || !text.chars().any(|character| character.is_ascii_digit())
            {
                continue;
            }
            let Some(message_key) = message_key
                .as_deref()
                .filter(|key| is_message_context_key(key))
            else {
                continue;
            };
            let nearest = known_fragments
                .iter()
                .filter(|(_, key, _)| key == message_key)
                .min_by_key(|(known_index, _, _)| {
                    (
                        known_index.abs_diff(index),
                        usize::from(*known_index > index),
                    )
                });
            if let Some((_, _, language)) = nearest {
                candidates
                    .entry((message_key.to_string(), *language))
                    .or_default()
                    .push(index);
            }
        }

        let mut group_at = HashMap::<usize, (Vec<usize>, Language)>::new();
        let mut grouped_indices = HashSet::new();
        for ((_, source), indices) in candidates {
            let mut indices = indices;
            indices.sort_unstable();
            let mut chunk = Vec::new();
            let mut chars = 0_usize;
            let separator_chars = MESSAGE_CONTEXT_SEPARATOR.chars().count();
            let finish_chunk =
                |chunk: &mut Vec<usize>,
                 group_at: &mut HashMap<usize, (Vec<usize>, Language)>,
                 grouped_indices: &mut HashSet<usize>| {
                    if chunk.len() < 2 {
                        chunk.clear();
                        return;
                    }
                    let members = std::mem::take(chunk);
                    grouped_indices.extend(members.iter().copied());
                    group_at.insert(members[0], (members, source));
                };
            for index in indices {
                let separator = if chunk.is_empty() { 0 } else { separator_chars };
                let next = texts[index].chars().count() + separator;
                if !chunk.is_empty() && chars + next > MAX_MESSAGE_CONTEXT_CHARS {
                    finish_chunk(&mut chunk, &mut group_at, &mut grouped_indices);
                    chars = 0;
                }
                chars += texts[index].chars().count()
                    + if chunk.is_empty() { 0 } else { separator_chars };
                chunk.push(index);
            }
            finish_chunk(&mut chunk, &mut group_at, &mut grouped_indices);
        }

        struct Unit {
            members: Vec<usize>,
            text: String,
            hint: Option<Language>,
        }
        let mut units = Vec::new();
        for index in 0..texts.len() {
            if let Some((members, source)) = group_at.remove(&index) {
                let text = members
                    .iter()
                    .map(|member| texts[*member].as_str())
                    .collect::<Vec<_>>()
                    .join(MESSAGE_CONTEXT_SEPARATOR);
                units.push(Unit {
                    members,
                    text,
                    hint: Some(source),
                });
            } else if !grouped_indices.contains(&index) {
                units.push(Unit {
                    members: vec![index],
                    text: texts[index].clone(),
                    hint: source_hints[index],
                });
            }
        }

        let unit_texts = units
            .iter()
            .map(|unit| unit.text.clone())
            .collect::<Vec<_>>();
        let unit_hints = units.iter().map(|unit| unit.hint).collect::<Vec<_>>();
        let translated_units = if self.translator.isolate_incoming_failures() {
            self.translate_many_best_effort_with_chunk_policy(
                &unit_texts,
                &unit_hints,
                target,
                allowed_sources,
                chunk_policy,
            )
        } else {
            self.translate_many_with_source_hints(
                &unit_texts,
                &unit_hints,
                target,
                allowed_sources,
            )?
        };

        let mut output = vec![None; texts.len()];
        for (unit, translated) in units.into_iter().zip(translated_units) {
            if unit.members.len() == 1 {
                output[unit.members[0]] = Some(translated);
                continue;
            }
            let lines = translated
                .split(MESSAGE_CONTEXT_SEPARATOR.trim())
                .map(str::trim)
                .map(str::to_string)
                .collect::<Vec<_>>();
            if lines.len() == unit.members.len() && lines.iter().all(|line| !line.is_empty()) {
                let lines = self.retry_incomplete_context_parts(
                    &unit.members,
                    lines,
                    texts,
                    unit.hint,
                    target,
                    allowed_sources,
                    chunk_policy,
                )?;
                for (index, line) in unit.members.into_iter().zip(lines) {
                    output[index] = Some(line);
                }
                continue;
            }

            let source_parts = unit
                .members
                .iter()
                .map(|index| texts[*index].as_str())
                .collect::<Vec<_>>();
            let translated_parts = lines.iter().map(String::as_str).collect::<Vec<_>>();
            if let Some(reconciled) =
                reconcile_one_merged_context_boundary(&source_parts, &translated_parts)
            {
                crate::diagnostics::info(
                    "translation-context-reconciled",
                    &format!(
                        "members={}; returned_parts={}; source_chars={}; translated_chars={}",
                        unit.members.len(),
                        lines.len(),
                        unit.text.chars().count(),
                        translated.chars().count(),
                    ),
                );
                let reconciled = self.retry_incomplete_context_parts(
                    &unit.members,
                    reconciled,
                    texts,
                    unit.hint,
                    target,
                    allowed_sources,
                    chunk_policy,
                )?;
                for (index, line) in unit.members.into_iter().zip(reconciled) {
                    output[index] = Some(line);
                }
                continue;
            }

            crate::diagnostics::info(
                "translation-context-fallback",
                &format!(
                    "members={}; returned_parts={}; source_chars={}; translated_chars={}; empty_parts={}",
                    unit.members.len(),
                    lines.len(),
                    unit.text.chars().count(),
                    translated.chars().count(),
                    lines.iter().filter(|line| line.is_empty()).count(),
                ),
            );

            let fallback_texts = unit
                .members
                .iter()
                .map(|index| texts[*index].clone())
                .collect::<Vec<_>>();
            let fallback_hints = unit
                .members
                .iter()
                .map(|index| source_hints[*index])
                .collect::<Vec<_>>();
            let fallback = if self.translator.isolate_incoming_failures() {
                self.translate_many_best_effort_with_chunk_policy(
                    &fallback_texts,
                    &fallback_hints,
                    target,
                    allowed_sources,
                    chunk_policy,
                )
            } else {
                self.translate_many_with_source_hints(
                    &fallback_texts,
                    &fallback_hints,
                    target,
                    allowed_sources,
                )?
            };
            for (index, translated) in unit.members.into_iter().zip(fallback) {
                output[index] = Some(translated);
            }
        }

        output
            .into_iter()
            .map(|translated| {
                translated.ok_or_else(|| {
                    "번역 엔진이 일부 텍스트의 결과를 반환하지 않았습니다.".to_string()
                })
            })
            .collect()
    }

    fn retry_incomplete_context_parts(
        &mut self,
        members: &[usize],
        mut translated_parts: Vec<String>,
        texts: &[String],
        source_hint: Option<Language>,
        target: Language,
        allowed_sources: Option<&HashSet<Language>>,
        chunk_policy: BestEffortChunkPolicy,
    ) -> Result<Vec<String>, String> {
        let Some(source) = source_hint.filter(|source| *source != Language::Unknown) else {
            return Ok(translated_parts);
        };
        let incomplete = members
            .iter()
            .enumerate()
            .filter_map(|(part_index, text_index)| {
                (!self.translator.translation_is_acceptable(
                    &texts[*text_index],
                    &translated_parts[part_index],
                    source,
                    target,
                ))
                .then_some((part_index, *text_index))
            })
            .collect::<Vec<_>>();
        if incomplete.is_empty() {
            return Ok(translated_parts);
        }

        crate::diagnostics::info(
            "translation-context-part-retry",
            &format!(
                "members={}; incomplete_parts={}; source={}; target={}",
                members.len(),
                incomplete.len(),
                source.code(),
                target.code(),
            ),
        );
        let retry_texts = incomplete
            .iter()
            .map(|(_, text_index)| texts[*text_index].clone())
            .collect::<Vec<_>>();
        let retry_hints = vec![Some(source); retry_texts.len()];
        let retried = if self.translator.isolate_incoming_failures() {
            self.translate_many_best_effort_with_chunk_policy(
                &retry_texts,
                &retry_hints,
                target,
                allowed_sources,
                chunk_policy,
            )
        } else {
            self.translate_many_with_source_hints(
                &retry_texts,
                &retry_hints,
                target,
                allowed_sources,
            )?
        };
        for ((part_index, _), translated) in incomplete.into_iter().zip(retried) {
            translated_parts[part_index] = translated;
        }
        Ok(translated_parts)
    }

    fn incoming_source_hints(
        &mut self,
        texts: &[String],
        message_keys: &[Option<String>],
        context_scope: &str,
    ) -> Result<Vec<Option<Language>>, String> {
        if texts.len() != message_keys.len() {
            return Err("메시지 문맥 정보의 개수가 원문 개수와 다릅니다.".to_string());
        }
        if self.incoming_context_scope != context_scope {
            self.incoming_context_scope = context_scope.to_string();
            self.incoming_detector = LanguageDetector::default();
        }
        let navigation_scope = navigation_context_scope(context_scope);
        if self.navigation_context_scope != navigation_scope {
            self.navigation_context_scope = navigation_scope;
            self.navigation_languages.clear();
        }

        let mut grouped_text = HashMap::<(String, ScriptFamily), String>::new();
        for (text, message_key) in texts.iter().zip(message_keys) {
            let (Some(message_key), Some(family)) =
                (message_key.as_ref(), detection_script_family(text))
            else {
                continue;
            };
            let aggregate = grouped_text
                .entry((message_key.clone(), family))
                .or_default();
            if !aggregate.is_empty() {
                aggregate.push('\n');
            }
            aggregate.push_str(text);
        }
        let grouped_languages = grouped_text
            .into_iter()
            .filter_map(|(key, text)| {
                let language = detect_explicit_language(&text);
                (language_script_family(language) == Some(key.1)).then_some((key, language))
            })
            .collect::<HashMap<_, _>>();
        for ((message_key, family), language) in &grouped_languages {
            if is_navigation_context_key(message_key) {
                self.navigation_languages.insert(*family, *language);
            }
        }

        let mut remembered_groups = HashSet::new();
        let mut hints = Vec::with_capacity(texts.len());
        for (text, message_key) in texts.iter().zip(message_keys) {
            let direct = detect_explicit_language(text);
            if direct != Language::Unknown {
                if let (Some(message_key), Some(family)) =
                    (message_key.as_ref(), detection_script_family(text))
                {
                    let group_key = (message_key.clone(), family);
                    if remembered_groups.insert(group_key) {
                        if is_navigation_context_key(message_key) {
                            self.navigation_languages.entry(family).or_insert(direct);
                        } else {
                            self.incoming_detector.remember(direct);
                        }
                    }
                }
                hints.push(None);
                continue;
            }
            let Some(message_key) = message_key.as_ref() else {
                hints.push(None);
                continue;
            };
            let Some(family) = detection_script_family(text) else {
                hints.push(None);
                continue;
            };
            let group_key = (message_key.clone(), family);
            if let Some(language) = grouped_languages.get(&group_key).copied() {
                if remembered_groups.insert(group_key) && !is_navigation_context_key(message_key) {
                    self.incoming_detector.remember(language);
                }
                hints.push(Some(language));
                continue;
            }
            let recent = if is_navigation_context_key(message_key) {
                self.navigation_languages.get(&family).copied()
            } else {
                self.incoming_detector.recent_language_for(text)
            };
            let nickname_fallback = (message_key == "nickname-navigation"
                && family == ScriptFamily::Latin)
                .then_some(Language::English);
            hints.push(recent.or(nickname_fallback));
        }
        Ok(hints)
    }

    fn web_source_hints(
        &mut self,
        texts: &[String],
        block_keys: &[Option<String>],
        page_scope: &str,
    ) -> Result<Vec<Option<Language>>, String> {
        if texts.len() != block_keys.len() {
            return Err("웹 문맥 정보의 개수가 원문 개수와 다릅니다.".to_string());
        }
        if self.web_context_scope != page_scope {
            self.web_context_scope = page_scope.to_string();
            self.web_detector = LanguageDetector::default();
        }

        let mut grouped_text = HashMap::<(String, ScriptFamily), String>::new();
        for (text, block_key) in texts.iter().zip(block_keys) {
            let (Some(block_key), Some(family)) =
                (block_key.as_ref(), detection_script_family(text))
            else {
                continue;
            };
            let aggregate = grouped_text.entry((block_key.clone(), family)).or_default();
            if !aggregate.is_empty() {
                aggregate.push('\n');
            }
            aggregate.push_str(text);
        }
        let grouped_languages = grouped_text
            .into_iter()
            .filter_map(|(key, text)| {
                let language = detect_explicit_language(&text);
                (language_script_family(language) == Some(key.1)).then_some((key, language))
            })
            .collect::<HashMap<_, _>>();

        let mut remembered_groups = HashSet::new();
        let mut hints = Vec::with_capacity(texts.len());
        for (text, block_key) in texts.iter().zip(block_keys) {
            let direct = detect_explicit_language(text);
            if direct != Language::Unknown {
                if let (Some(block_key), Some(family)) =
                    (block_key.as_ref(), detection_script_family(text))
                {
                    if remembered_groups.insert((block_key.clone(), family)) {
                        self.web_detector.remember(direct);
                    }
                }
                hints.push(None);
                continue;
            }
            let (Some(block_key), Some(family)) =
                (block_key.as_ref(), detection_script_family(text))
            else {
                hints.push(None);
                continue;
            };
            let group_key = (block_key.clone(), family);
            if let Some(language) = grouped_languages.get(&group_key).copied() {
                if remembered_groups.insert(group_key) {
                    self.web_detector.remember(language);
                }
                hints.push(Some(language));
            } else {
                hints.push(self.web_detector.recent_language_for(text));
            }
        }
        Ok(hints)
    }

    fn translate_many_unchunked(
        &mut self,
        texts: &[String],
        source_hints: &[Option<Language>],
        target: Language,
        allowed_sources: Option<&HashSet<Language>>,
    ) -> Result<Vec<String>, String> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let mut results: Vec<Option<String>> = vec![None; texts.len()];
        let mut pending = Vec::<(Vec<usize>, String, ProtectedText, Language, String)>::new();
        let mut pending_by_source = HashMap::<(String, Language), usize>::new();
        let started = Instant::now();
        let mut cache_hits = 0_usize;
        let mut passthrough = 0_usize;
        let mut uncached_items = 0_usize;
        for (index, text) in texts.iter().enumerate() {
            let protected = protect_text(text);
            if !protected.has_translatable_text() {
                results[index] = Some(text.clone());
                passthrough += 1;
                continue;
            }
            let detected = self.detector.detect(text, true);
            let source = if detected == Language::Unknown {
                source_hints[index].unwrap_or(Language::Unknown)
            } else {
                detected
            };
            if detected == Language::Unknown {
                self.detector.remember(source);
            }
            if allowed_sources.is_some_and(|allowed| !allowed.contains(&source)) {
                results[index] = Some(text.clone());
                passthrough += 1;
                continue;
            }
            if source == target {
                results[index] = Some(self.translate_foreign_fragments(text, target)?);
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
                let cached = preserve_terminal_punctuation(text, &cached);
                let masked_cached = protected.mask_preserved_tokens_in(&cached);
                if self
                    .translator
                    .should_cache(&protected.masked, &masked_cached, source, target)
                {
                    results[index] = Some(cached);
                    cache_hits += 1;
                    continue;
                }
                crate::diagnostics::info(
                    "translation-cache",
                    &format!(
                        "stale result rejected; chars={}; hash={}",
                        text.chars().count(),
                        source_hash
                    ),
                );
            }
            uncached_items += 1;
            let source_key = (text.clone(), source);
            if let Some(pending_index) = pending_by_source.get(&source_key).copied() {
                pending[pending_index].0.push(index);
            } else {
                pending_by_source.insert(source_key, pending.len());
                pending.push((vec![index], text.clone(), protected, source, source_hash));
            }
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
            for ((indices, text, protected, source, hash), translated) in
                pending.into_iter().zip(translated)
            {
                let restored = protected.restore(&translated);
                let restored =
                    apply_conservative_semantic_repairs(&restored, &text, source, target);
                let restored = preserve_terminal_punctuation(&text, &restored);
                if !text.contains(MESSAGE_CONTEXT_SEPARATOR.trim())
                    && !self.translator.translation_is_acceptable(
                        &protected.masked,
                        &translated,
                        source,
                        target,
                    )
                {
                    crate::diagnostics::warn(
                        "translation-quality",
                        &format!(
                            "final result rejected; translator={}; chars={}; hash={}; source={}; target={}",
                            self.translator.display_name(),
                            text.chars().count(),
                            hash,
                            source.code(),
                            target.code(),
                        ),
                    );
                    return Err(format!(
                        "{QUALITY_REJECTED_ERROR}: 결과가 원문을 충분히 번역하지 못했습니다."
                    ));
                }
                if self
                    .translator
                    .should_cache(&protected.masked, &translated, source, target)
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
                for index in indices {
                    results[index] = Some(restored.clone());
                }
            }
        }

        crate::diagnostics::info(
            "translation-batch",
            &format!(
                "translator={}; items={}; chars={}; cache_hits={cache_hits}; passthrough={passthrough}; provider_items={}; deduplicated={}; elapsed_ms={}",
                self.translator.display_name(),
                texts.len(),
                texts.iter().map(|text| text.chars().count()).sum::<usize>(),
                provider_items,
                uncached_items.saturating_sub(provider_items),
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

    fn translate_foreign_fragments(
        &mut self,
        text: &str,
        target: Language,
    ) -> Result<String, String> {
        // Discord can replace a text node after we translated only part of it.
        // In that case the renderer gives us a Korean-majority node whose
        // remaining foreign moderation lines would otherwise be classified as
        // Korean and skipped forever. Repair each line independently before
        // the generic fragment pass so mixed rule notices converge cleanly.
        let repaired = text
            .split_inclusive('\n')
            .map(|line| {
                let (body, ending) = line
                    .strip_suffix('\n')
                    .map_or((line, ""), |body| (body, "\n"));
                format!(
                    "{}{}",
                    apply_conservative_semantic_repairs(body, body, target, target),
                    ending
                )
            })
            .collect::<String>();
        let translated = self.translate_japanese_fragments(&repaired, target)?;
        self.translate_english_fragments(&translated, target)
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

    fn translate_english_fragments(
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
        for found in ENGLISH_FRAGMENT_RE.find_iter(text) {
            let fragment = found.as_str();
            let detection = detect_language(fragment);
            if detection.language != Language::English || detection.confidence < 0.99 {
                continue;
            }
            translated.push_str(&text[cursor..found.start()]);
            let result = self.translate_known_source(
                fragment,
                &protect_text(fragment),
                Language::English,
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
            let cached = preserve_terminal_punctuation(text, &cached);
            if self.translator.should_cache(text, &cached, source, target) {
                return Ok(cached);
            }
            crate::diagnostics::info(
                "translation-cache",
                &format!(
                    "stale fragment rejected; chars={}; hash={hash}",
                    text.chars().count()
                ),
            );
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

fn collapse_context_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn nearest_selection_start(context: &str, selection: &str) -> Option<usize> {
    let center = context.len().saturating_sub(selection.len()) / 2;
    context
        .match_indices(selection)
        .map(|(start, _)| start)
        .min_by_key(|start| start.abs_diff(center))
}

fn reconcile_one_merged_context_boundary(
    source_parts: &[&str],
    translated_parts: &[&str],
) -> Option<Vec<String>> {
    if source_parts.len() < 3
        || translated_parts.len() < 2
        || translated_parts.len() + 1 != source_parts.len()
        || translated_parts.iter().any(|part| part.trim().is_empty())
    {
        return None;
    }

    let source_lengths = source_parts
        .iter()
        .map(|part| part.chars().count().max(1))
        .collect::<Vec<_>>();
    let translated_lengths = translated_parts
        .iter()
        .map(|part| part.chars().count().max(1))
        .collect::<Vec<_>>();
    let source_total = source_lengths.iter().sum::<usize>();
    let translated_total = translated_lengths.iter().sum::<usize>();
    let length_ratio = translated_total as f64 / source_total as f64;
    if !(0.20..=2.0).contains(&length_ratio) {
        return None;
    }

    let merge_at = (0..source_lengths.len() - 1).min_by(|left, right| {
        merged_boundary_score(&source_lengths, &translated_lengths, *left).total_cmp(
            &merged_boundary_score(&source_lengths, &translated_lengths, *right),
        )
    })?;

    let mut reconciled = Vec::with_capacity(source_parts.len());
    let mut source_index = 0_usize;
    let mut translated_index = 0_usize;
    while source_index < source_parts.len() {
        reconciled.push(translated_parts[translated_index].trim().to_string());
        if source_index == merge_at {
            reconciled.push(CONTEXT_COLLAPSED_PLACEHOLDER.to_string());
            source_index += 2;
        } else {
            source_index += 1;
        }
        translated_index += 1;
    }
    Some(reconciled)
}

fn merged_boundary_score(
    source_lengths: &[usize],
    translated_lengths: &[usize],
    merge_at: usize,
) -> f64 {
    let mut grouped_source_lengths = Vec::with_capacity(translated_lengths.len());
    let mut index = 0_usize;
    while index < source_lengths.len() {
        if index == merge_at {
            grouped_source_lengths.push(source_lengths[index] + source_lengths[index + 1]);
            index += 2;
        } else {
            grouped_source_lengths.push(source_lengths[index]);
            index += 1;
        }
    }

    let source_total = grouped_source_lengths.iter().sum::<usize>() as f64;
    let translated_total = translated_lengths.iter().sum::<usize>() as f64;
    let mut source_cumulative = 0_usize;
    let mut translated_cumulative = 0_usize;
    grouped_source_lengths
        .iter()
        .zip(translated_lengths)
        .take(translated_lengths.len().saturating_sub(1))
        .map(|(source, translated)| {
            source_cumulative += source;
            translated_cumulative += translated;
            (source_cumulative as f64 / source_total
                - translated_cumulative as f64 / translated_total)
                .abs()
        })
        .sum()
}

fn navigation_context_scope(context_scope: &str) -> String {
    let mut segments = context_scope
        .split('/')
        .filter(|segment| !segment.is_empty());
    match (segments.next(), segments.next()) {
        (Some("channels"), Some(server)) => format!("/channels/{server}"),
        _ => context_scope.to_string(),
    }
}

fn is_navigation_context_key(message_key: &str) -> bool {
    matches!(
        message_key,
        "navigation" | "browse-navigation" | "nickname-navigation"
    )
}

fn is_message_context_key(message_key: &str) -> bool {
    ["message:", "reply:", "embed:", "web:"]
        .iter()
        .any(|prefix| message_key.starts_with(prefix))
}

fn preferred_navigation_translation(
    text: &str,
    message_key: Option<&str>,
    target: Language,
) -> Option<String> {
    if !message_key.is_some_and(is_navigation_context_key) || target != Language::Korean {
        return None;
    }

    let prefix = text.get(.."general".len())?;
    if !prefix.eq_ignore_ascii_case("general") {
        return None;
    }
    let suffix = &text["general".len()..];
    if suffix.is_empty() || suffix.starts_with('_') || suffix.starts_with('-') {
        Some(format!("일반{suffix}"))
    } else {
        None
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
    use std::collections::HashSet;
    use std::fmt::Write as _;
    use std::time::Instant;

    use super::{
        has_terminal_punctuation, outgoing_can_passthrough, preferred_navigation_translation,
        preserve_terminal_punctuation, source_hash, TranslationService, MESSAGE_CONTEXT_SEPARATOR,
    };
    use crate::cache::TranslationCache;
    use crate::language::{detect_language, Language};
    use crate::translation::hymt::{detect_speech_style, HyMtModelSize, HyMtTranslator};
    use crate::translation::{
        translation_needs_repair, MockTranslator, ResilientTranslator, Translator,
    };
    use std::fs;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct CountingTranslator {
        calls: Arc<Mutex<usize>>,
    }

    #[test]
    fn outgoing_passthrough_covers_native_text_symbols_and_kaomoji() {
        assert!(outgoing_can_passthrough(
            "안녕하세요",
            Some(Language::Korean)
        ));
        assert!(outgoing_can_passthrough("!?", Some(Language::Korean)));
        assert!(outgoing_can_passthrough(
            "ヾ(｡>﹏<｡)ﾉﾞ✧*。, (づ￣ ³￣)づ~♡",
            Some(Language::Korean),
        ));
        assert!(outgoing_can_passthrough("!?", None));
        assert!(!outgoing_can_passthrough(
            "안녕하세요 this is a full English phrase",
            Some(Language::Korean),
        ));
        assert!(!outgoing_can_passthrough(
            "Hello there",
            Some(Language::Korean),
        ));
        assert!(!outgoing_can_passthrough("안녕하세요", None));
    }

    struct RecordingIdentityTranslator {
        inputs: Arc<Mutex<Vec<String>>>,
    }

    struct FailOnTextTranslator;

    struct FormattingHostileTranslator {
        inputs: Arc<Mutex<Vec<String>>>,
    }

    struct ContextAwareRuleTranslator {
        inputs: Arc<Mutex<Vec<String>>>,
    }

    struct SeparatorDroppingTranslator {
        inputs: Arc<Mutex<Vec<String>>>,
    }

    struct OneBoundaryMergingTranslator {
        inputs: Arc<Mutex<Vec<String>>>,
    }

    struct PartiallyTranslatedContextTranslator {
        inputs: Arc<Mutex<Vec<String>>>,
    }

    struct JoinedLineContextTranslator;

    struct FlakyQualityTranslator {
        calls: Arc<Mutex<usize>>,
    }

    struct AlwaysIncompleteIsolatedTranslator {
        calls: Arc<Mutex<usize>>,
    }

    struct PartiallyFailingWebChunkTranslator;

    struct MultilineFailingWebChunkTranslator;

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

        fn should_cache(
            &self,
            source_text: &str,
            translated_text: &str,
            _source: Language,
            _target: Language,
        ) -> bool {
            source_text != translated_text
        }
    }

    impl Translator for FlakyQualityTranslator {
        fn display_name(&self) -> &str {
            "flaky-quality"
        }

        fn cache_namespace(&self) -> &str {
            "flaky-quality:v1"
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
            let mut calls = self.calls.lock().unwrap();
            *calls += 1;
            if *calls == 1 {
                Ok(text.to_string())
            } else {
                Ok("초대받아 들어가도 바로 떨어져 버립니다".to_string())
            }
        }

        fn should_cache(
            &self,
            source_text: &str,
            translated_text: &str,
            source: Language,
            target: Language,
        ) -> bool {
            self.translation_is_acceptable(source_text, translated_text, source, target)
        }

        fn translation_is_acceptable(
            &self,
            source_text: &str,
            translated_text: &str,
            source: Language,
            target: Language,
        ) -> bool {
            !translation_needs_repair(source_text, translated_text, source, target)
        }
    }

    impl Translator for AlwaysIncompleteIsolatedTranslator {
        fn display_name(&self) -> &str {
            "always-incomplete-isolated"
        }

        fn cache_namespace(&self) -> &str {
            "always-incomplete-isolated:v1"
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
            *self.calls.lock().unwrap() += 1;
            Ok(text.to_string())
        }
    }

    impl Translator for PartiallyFailingWebChunkTranslator {
        fn display_name(&self) -> &str {
            "partially-failing-web-chunk"
        }

        fn cache_namespace(&self) -> &str {
            "partially-failing-web-chunk:v1"
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
            if text.contains("コンセプトアート") {
                Ok(text.to_string())
            } else {
                Ok("코기의 사랑스러움을 담은 의상입니다.\n빵집 모티브입니다.\n\n".to_string())
            }
        }

        fn should_cache(
            &self,
            source_text: &str,
            translated_text: &str,
            source: Language,
            target: Language,
        ) -> bool {
            self.translation_is_acceptable(source_text, translated_text, source, target)
        }

        fn translation_is_acceptable(
            &self,
            source_text: &str,
            translated_text: &str,
            source: Language,
            target: Language,
        ) -> bool {
            !translation_needs_repair(source_text, translated_text, source, target)
        }
    }

    impl Translator for MultilineFailingWebChunkTranslator {
        fn display_name(&self) -> &str {
            "multiline-failing-web-chunk"
        }

        fn cache_namespace(&self) -> &str {
            "multiline-failing-web-chunk:v1"
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
            if text.contains('\n') {
                return Ok(text.to_string());
            }
            Ok(
                if text.starts_with("大人気な輝夜ちゃんの特別セットをご用意しました")
                {
                    text.replacen(
                        "大人気な輝夜ちゃんの特別セットをご用意しました",
                        "인기 많은 카구야의 특별 세트를 준비했습니다",
                        1,
                    )
                } else {
                    match text {
                        "なんと11種類セットでとってもお得になってます！" => {
                            "무려 11종 세트로 매우 알찬 구성입니다!"
                        }
                        "使いやすいお洋服からかぷちやの定番まで！" => {
                            "활용하기 좋은 의상부터 카푸치야의 대표 상품까지!"
                        }
                        _ if text.starts_with("ぜひ") && text.ends_with("でポストしてね！") =>
                        {
                            return Ok(text.replacen("ぜひ", "꼭 ", 1).replacen(
                                "でポストしてね！",
                                "에 게시해 주세요!",
                                1,
                            ));
                        }
                        _ => text,
                    }
                    .to_string()
                },
            )
        }

        fn should_cache(
            &self,
            source_text: &str,
            translated_text: &str,
            source: Language,
            target: Language,
        ) -> bool {
            self.translation_is_acceptable(source_text, translated_text, source, target)
        }

        fn translation_is_acceptable(
            &self,
            source_text: &str,
            translated_text: &str,
            source: Language,
            target: Language,
        ) -> bool {
            !translation_needs_repair(source_text, translated_text, source, target)
        }
    }

    impl Translator for JoinedLineContextTranslator {
        fn display_name(&self) -> &str {
            "joined-line-context"
        }

        fn cache_namespace(&self) -> &str {
            "joined-line-context:v1"
        }

        fn translate(
            &mut self,
            text: &str,
            _source: Language,
            _target: Language,
        ) -> Result<String, String> {
            if text == "In this residence,\nwe invite you to enjoy a special experience" {
                Ok("이 레지던스에서는 특별한 경험으로 초대합니다".to_string())
            } else {
                Ok(text.to_string())
            }
        }

        fn should_cache(
            &self,
            source_text: &str,
            translated_text: &str,
            _source: Language,
            _target: Language,
        ) -> bool {
            source_text != translated_text
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

    impl Translator for ContextAwareRuleTranslator {
        fn display_name(&self) -> &str {
            "context-aware-rule"
        }

        fn cache_namespace(&self) -> &str {
            "context-aware-rule:v1"
        }

        fn translate(
            &mut self,
            text: &str,
            _source: Language,
            _target: Language,
        ) -> Result<String, String> {
            self.inputs.lock().unwrap().push(text.to_string());
            if !text.contains(MESSAGE_CONTEXT_SEPARATOR) {
                return Ok(text.to_string());
            }
            Ok(text
                .replace(
                    "About Discord Rule Violations",
                    "Discord 규칙 위반에 관하여",
                )
                .replace("1 Violation: 1 day blocked", "1회 위반: 1일 차단")
                .replace("2 Violation: 7 days blocked", "2회 위반: 7일 차단")
                .replace(
                    "Third violation: Permanent blocking and forced termination",
                    "3회 위반: 영구 차단 및 강제 퇴장",
                )
                .replace("Violation:", "위반:")
                .replace("violation:", "위반:")
                .replace("day blocked", "일 차단")
                .replace("days blocked", "일 차단")
                .replace("Third violation", "세 번째 위반")
                .replace(
                    "Permanent blocking and forced termination",
                    "영구 차단 및 강제 퇴장",
                )
                .replace("Members", "회원은")
                .replace("share", "공유")
                .replace("photos.", "사진을 공유할 수 있습니다.")
                .replace("写真を", "photos")
                .replace("共有", "share")
                .replace("してください", "please"))
        }
    }

    impl Translator for SeparatorDroppingTranslator {
        fn display_name(&self) -> &str {
            "separator-dropping"
        }

        fn cache_namespace(&self) -> &str {
            "separator-dropping:v1"
        }

        fn translate(
            &mut self,
            text: &str,
            _source: Language,
            _target: Language,
        ) -> Result<String, String> {
            self.inputs.lock().unwrap().push(text.to_string());
            if text.contains(MESSAGE_CONTEXT_SEPARATOR) {
                return Ok("경계가 사라진 잘못된 묶음 결과".to_string());
            }
            Ok(format!("개별 번역: {text}"))
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

    impl Translator for OneBoundaryMergingTranslator {
        fn display_name(&self) -> &str {
            "one-boundary-merging"
        }

        fn cache_namespace(&self) -> &str {
            "one-boundary-merging:v1"
        }

        fn translate(
            &mut self,
            text: &str,
            _source: Language,
            _target: Language,
        ) -> Result<String, String> {
            self.inputs.lock().unwrap().push(text.to_string());
            if text.contains(MESSAGE_CONTEXT_SEPARATOR) {
                return Ok(format!(
                    "서버에 오신 것을 환영해요 제 이름은 카이오라예요{MESSAGE_CONTEXT_SEPARATOR}구독자는 새 역할을 받아요"
                ));
            }
            Ok(format!("개별 번역: {text}"))
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
    fn incoming_language_filter_sends_only_selected_sources_to_the_model() {
        let path = cache_path("selected-source-batch");
        let inputs = Arc::new(Mutex::new(Vec::new()));
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(
            Box::new(RecordingIdentityTranslator {
                inputs: inputs.clone(),
            }),
            cache,
        );
        let source = vec![
            "Hello there".to_string(),
            "こんにちは".to_string(),
            "안녕하세요".to_string(),
        ];
        let message_keys = vec![None; source.len()];
        let allowed = HashSet::from([Language::Japanese]);

        assert_eq!(
            service
                .translate_many_for_incoming_contextual_filtered(
                    &source,
                    &message_keys,
                    "https://discord.com/channels/server/channel",
                    Language::Korean,
                    Some(&allowed),
                )
                .unwrap(),
            source
        );
        assert_eq!(
            inputs.lock().unwrap().as_slice(),
            &["こんにちは".to_string()]
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn incoming_language_filter_also_keeps_unselected_navigation_text_original() {
        let path = cache_path("selected-source-navigation");
        let inputs = Arc::new(Mutex::new(Vec::new()));
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(
            Box::new(RecordingIdentityTranslator {
                inputs: inputs.clone(),
            }),
            cache,
        );
        let source = vec!["general".to_string()];
        let message_keys = vec![Some("navigation".to_string())];
        let allowed = HashSet::from([Language::Japanese]);

        assert_eq!(
            service
                .translate_many_for_incoming_contextual_filtered(
                    &source,
                    &message_keys,
                    "https://discord.com/channels/server/channel",
                    Language::Korean,
                    Some(&allowed),
                )
                .unwrap(),
            source
        );
        assert!(inputs.lock().unwrap().is_empty());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn incoming_japanese_chat_with_korean_laughter_is_sent_to_the_model() {
        let path = cache_path("japanese-chat-with-korean-laughter");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(Box::new(MockTranslator), cache);

        assert_eq!(
            service
                .translate("きっとそうな国だㅋㅋㅋ", Language::Korean)
                .unwrap(),
            "[ko] きっとそうな国だㅋㅋㅋ"
        );
        assert_eq!(
            service.translate("ㅋㅋㅋ", Language::Korean).unwrap(),
            "ㅋㅋㅋ"
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn incoming_message_context_translates_short_english_dom_parts() {
        let path = cache_path("short-english-context");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(Box::new(MockTranslator), cache);
        let source = vec![
            "this".to_string(),
            "is so fkn funny".to_string(),
            "LMAO".to_string(),
        ];
        let message_keys = vec![
            Some("message-1".to_string()),
            Some("message-1".to_string()),
            Some("message-1".to_string()),
        ];

        assert_eq!(
            service
                .translate_many_for_incoming_contextual(
                    &source,
                    &message_keys,
                    "/channels/guild/english",
                    Language::Korean,
                )
                .unwrap(),
            vec![
                "[ko] this".to_string(),
                "[ko] is so fkn funny".to_string(),
                "[ko] LMAO".to_string(),
            ]
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn multilingual_rule_message_still_translates_its_english_lines() {
        let path = cache_path("multilingual-rule-message");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(Box::new(MockTranslator), cache);
        let source = [
            "About Discord Rule Violations",
            "1 Violation: 1 day blocked",
            "2 Violation: 7 days blocked",
            "Third violation: Permanent blocking and forced termination",
            "关于违反Discord规则",
            "디스코드 규칙 위반에 관하여",
        ]
        .map(str::to_string)
        .to_vec();
        let message_keys = vec![Some("message-rule".to_string()); source.len()];

        let translated = service
            .translate_many_for_incoming_contextual(
                &source,
                &message_keys,
                "/channels/guild/rules",
                Language::Korean,
            )
            .unwrap();

        assert_eq!(translated[0], "디스코드 규칙 위반에 관하여");
        assert_eq!(translated[1], "1회 위반: 1일 차단");
        assert_eq!(translated[2], "2회 위반: 7일 차단");
        assert_eq!(translated[3], "3회 위반: 영구 차단 및 강제 퇴장");
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn partially_translated_multilingual_rule_node_converges_to_korean() {
        let path = cache_path("partially-translated-rule-node");
        let inputs = Arc::new(Mutex::new(Vec::new()));
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(
            Box::new(RecordingIdentityTranslator {
                inputs: inputs.clone(),
            }),
            cache,
        );
        let mixed = concat!(
            "1 Violation: 1일 차단\n",
            "2 violation: 7일 차단\n",
            "关于违反Discord规则\n",
            "违反1次:1日切断\n",
            "2回 違反:7日 遮断\n",
            "การฝ่าฝืน 3 ครั้ง: บล็อกถาวรและบังคับให้ออก"
        );

        let translated = service.translate(mixed, Language::Korean).unwrap();

        assert_eq!(
            translated,
            concat!(
                "1회 위반: 1일 차단\n",
                "2회 위반: 7일 차단\n",
                "디스코드 규칙 위반에 관하여\n",
                "1회 위반: 1일 차단\n",
                "2회 위반: 7일 차단\n",
                "3회 위반: 영구 차단 및 강제 퇴장"
            )
        );
        assert!(inputs.lock().unwrap().is_empty());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn same_message_language_fragments_are_translated_with_shared_context() {
        let path = cache_path("shared-message-context");
        let inputs = Arc::new(Mutex::new(Vec::new()));
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(
            Box::new(ContextAwareRuleTranslator {
                inputs: inputs.clone(),
            }),
            cache,
        );
        let source = [
            "About Discord Rule Violations",
            "1 Violation: 1 day blocked",
            "2 Violation: 7 days blocked",
            "Third violation: Permanent blocking and forced termination",
        ]
        .map(str::to_string)
        .to_vec();
        let message_keys = vec![Some("message:dto-rule-1".to_string()); source.len()];

        let translated = service
            .translate_many_for_incoming_contextual(
                &source,
                &message_keys,
                "/channels/guild/rules",
                Language::Korean,
            )
            .unwrap();
        assert_eq!(
            translated,
            vec![
                "디스코드 규칙 위반에 관하여",
                "1회 위반: 1일 차단",
                "2회 위반: 7일 차단",
                "3회 위반: 영구 차단 및 강제 퇴장",
            ]
        );
        assert!(translated.iter().all(|text| !text.contains("NTSPLIT")));
        let recorded = inputs.lock().unwrap();
        assert_eq!(recorded.len(), 1);
        assert!(recorded[0].contains(MESSAGE_CONTEXT_SEPARATOR));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn selected_span_is_translated_inside_context_for_different_source_scripts() {
        let path = cache_path("selected-span-context");
        let inputs = Arc::new(Mutex::new(Vec::new()));
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(
            Box::new(ContextAwareRuleTranslator {
                inputs: inputs.clone(),
            }),
            cache,
        );

        let english = service
            .translate_span_with_context(
                "share",
                "Members share photos.",
                Language::English,
                Language::Korean,
            )
            .unwrap();
        let japanese = service
            .translate_span_with_context(
                "共有",
                "写真を共有してください",
                Language::Japanese,
                Language::English,
            )
            .unwrap();

        assert_eq!(english.0, "공유");
        assert!(english.1.contains("공유"));
        assert_eq!(japanese.0, "share");
        assert!(japanese.1.contains("photos"));
        assert_eq!(inputs.lock().unwrap().len(), 2);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    impl Translator for PartiallyTranslatedContextTranslator {
        fn display_name(&self) -> &str {
            "partially-translated-context"
        }

        fn cache_namespace(&self) -> &str {
            "partially-translated-context:v1"
        }

        fn translate(
            &mut self,
            text: &str,
            _source: Language,
            _target: Language,
        ) -> Result<String, String> {
            self.inputs.lock().unwrap().push(text.to_string());
            if text.contains(MESSAGE_CONTEXT_SEPARATOR) {
                return Ok([
                    "Welcome to Kai's Comfy Fox Den!",
                    "안녕하세요. 저는 카이오라이고 트위치에서 방송하는 여우 버튜버예요.",
                    "구독자는 새 역할을 받고 you can connect your Twitch account by going to User Settings.",
                ]
                .join(MESSAGE_CONTEXT_SEPARATOR));
            }
            Ok(match text {
                "Welcome to Kai's Comfy Fox Den!" => "카이의 아늑한 여우굴에 오신 것을 환영해요!",
                "Hi, my name is Kaioura and I'm a fox VTuber who streams on Twitch." => {
                    "안녕하세요. 저는 카이오라이고 트위치에서 방송하는 여우 버튜버예요."
                }
                "Subscribers receive new roles and you can connect your Twitch account by going to User Settings." => {
                    "구독자는 새 역할을 받고 사용자 설정에서 트위치 계정을 연결할 수 있어요."
                }
                _ => text,
            }
            .to_string())
        }

        fn should_cache(
            &self,
            source_text: &str,
            translated_text: &str,
            source: Language,
            target: Language,
        ) -> bool {
            !translation_needs_repair(source_text, translated_text, source, target)
        }

        fn translation_is_acceptable(
            &self,
            source_text: &str,
            translated_text: &str,
            source: Language,
            target: Language,
        ) -> bool {
            !translation_needs_repair(source_text, translated_text, source, target)
        }
    }

    #[test]
    fn long_rich_messages_use_small_context_batches_for_local_models() {
        let path = cache_path("small-rich-message-batches");
        let inputs = Arc::new(Mutex::new(Vec::new()));
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(
            Box::new(RecordingIdentityTranslator {
                inputs: inputs.clone(),
            }),
            cache,
        );
        let source = [
            "Find the join code of the guild you prefer on the recruitment board before continuing.",
            "Enter the join code in the corresponding section under the board and then select Check.",
            "If the request succeeds, the guild name and banner will appear in your player nameplate.",
            "Create a VRC group because the guild will use the same name and banner as that group.",
            "Open the creator page and purchase the current monthly guild poster from the shop.",
            "After purchase, open the form and provide the group link together with its description.",
            "The guild becomes available in game as soon as the owner publishes the updated list.",
        ]
        .map(str::to_string)
        .to_vec();
        let message_keys = vec![Some("message:dto-long-guild-guide".to_string()); source.len()];

        service
            .translate_many_for_incoming_contextual(
                &source,
                &message_keys,
                "/channels/guild/general",
                Language::Korean,
            )
            .unwrap();

        let grouped = inputs
            .lock()
            .unwrap()
            .iter()
            .filter(|text| text.contains(MESSAGE_CONTEXT_SEPARATOR))
            .cloned()
            .collect::<Vec<_>>();
        assert!(grouped.len() >= 2);
        assert!(grouped.iter().all(|text| text.chars().count() <= 320));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn partially_translated_context_parts_are_retried_individually() {
        let path = cache_path("partial-context-part-retry");
        let inputs = Arc::new(Mutex::new(Vec::new()));
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(
            Box::new(PartiallyTranslatedContextTranslator {
                inputs: inputs.clone(),
            }),
            cache,
        );
        let source = [
            "Welcome to Kai's Comfy Fox Den!",
            "Hi, my name is Kaioura and I'm a fox VTuber who streams on Twitch.",
            "Subscribers receive new roles and you can connect your Twitch account by going to User Settings.",
        ]
        .map(str::to_string)
        .to_vec();
        let message_keys = vec![Some("message:kai-welcome".to_string()); source.len()];

        let translated = service
            .translate_many_for_incoming_contextual(
                &source,
                &message_keys,
                "/channels/guild/welcome",
                Language::Korean,
            )
            .unwrap();

        assert_eq!(
            translated,
            vec![
                "카이의 아늑한 여우굴에 오신 것을 환영해요!",
                "안녕하세요. 저는 카이오라이고 트위치에서 방송하는 여우 버튜버예요.",
                "구독자는 새 역할을 받고 사용자 설정에서 트위치 계정을 연결할 수 있어요.",
            ]
        );
        let recorded = inputs.lock().unwrap();
        assert_eq!(
            recorded
                .iter()
                .filter(|text| text.contains(MESSAGE_CONTEXT_SEPARATOR))
                .count(),
            1
        );
        assert!(recorded.iter().any(|text| text == &source[0]));
        assert!(recorded.iter().any(|text| text == &source[2]));
        assert!(!recorded.iter().any(|text| text == &source[1]));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn split_rule_line_keeps_numbers_inside_the_shared_context() {
        let path = cache_path("split-rule-line-context");
        let inputs = Arc::new(Mutex::new(Vec::new()));
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(
            Box::new(ContextAwareRuleTranslator {
                inputs: inputs.clone(),
            }),
            cache,
        );
        let source = [
            "About Discord Rule Violations",
            "1",
            "Violation:",
            "1",
            "day blocked",
            "2",
            "violation:",
            "7",
            "days blocked",
            "Third violation",
            "Permanent blocking and forced termination",
            "(",
        ]
        .map(str::to_string)
        .to_vec();
        let message_keys = vec![Some("message:dto-split-rule".to_string()); source.len()];

        let translated = service
            .translate_many_for_incoming_contextual(
                &source,
                &message_keys,
                "/channels/guild/rules",
                Language::Korean,
            )
            .unwrap();

        assert_eq!(
            translated,
            vec![
                "디스코드 규칙 위반에 관하여",
                "1",
                "위반:",
                "1",
                "일 차단",
                "2",
                "위반:",
                "7",
                "일 차단",
                "3회 위반",
                "영구 차단 및 강제 퇴장",
                "(",
            ]
        );
        let recorded = inputs.lock().unwrap();
        assert_eq!(recorded.len(), 1);
        assert!(recorded[0].contains("1 <NTSPLIT> Violation:"));
        assert!(recorded[0].contains("7 <NTSPLIT> days blocked"));
        assert!(!recorded[0].ends_with("<NTSPLIT> ("));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn contextual_translation_falls_back_when_separator_is_lost() {
        let path = cache_path("lost-message-separator");
        let inputs = Arc::new(Mutex::new(Vec::new()));
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(
            Box::new(SeparatorDroppingTranslator {
                inputs: inputs.clone(),
            }),
            cache,
        );
        let source = ["First rule", "Second rule"].map(str::to_string).to_vec();
        let message_keys = vec![Some("message:dto-rule-fallback".to_string()); source.len()];

        let translated = service
            .translate_many_for_incoming_contextual(
                &source,
                &message_keys,
                "/channels/guild/rules",
                Language::Korean,
            )
            .unwrap();

        assert_eq!(
            translated,
            vec!["개별 번역: First rule", "개별 번역: Second rule"]
        );
        assert!(translated.iter().all(|text| !text.contains("NTSPLIT")));
        let recorded = inputs.lock().unwrap();
        assert_eq!(recorded.len(), 3);
        assert!(recorded[0].contains(MESSAGE_CONTEXT_SEPARATOR));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn contextual_translation_reconciles_one_merged_dom_boundary() {
        let path = cache_path("merged-message-boundary");
        let inputs = Arc::new(Mutex::new(Vec::new()));
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(
            Box::new(OneBoundaryMergingTranslator {
                inputs: inputs.clone(),
            }),
            cache,
        );
        let source = [
            "Welcome to our server",
            "my name is Kaioura",
            "Subscribers receive new roles",
        ]
        .map(str::to_string)
        .to_vec();
        let message_keys = vec![Some("message:dto-welcome".to_string()); source.len()];

        let translated = service
            .translate_many_for_incoming_contextual(
                &source,
                &message_keys,
                "/channels/guild/welcome",
                Language::Korean,
            )
            .unwrap();

        assert_eq!(
            translated,
            vec![
                "서버에 오신 것을 환영해요 제 이름은 카이오라예요",
                "\u{200b}",
                "구독자는 새 역할을 받아요",
            ]
        );
        assert_eq!(inputs.lock().unwrap().len(), 1);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn incoming_navigation_context_translates_short_english_labels() {
        let path = cache_path("short-english-navigation");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(Box::new(MockTranslator), cache);
        let source = [
            "Info",
            "update-log",
            "entrance",
            "rules",
            "roles",
            "General",
            "chat",
            "voice-chat",
            "media",
            "games",
            "art",
        ]
        .map(str::to_string)
        .to_vec();
        let navigation_keys = vec![Some("navigation".to_string()); source.len()];

        let translated = service
            .translate_many_for_incoming_contextual(
                &source,
                &navigation_keys,
                "/channels/guild/current",
                Language::Korean,
            )
            .unwrap();

        assert_eq!(
            translated,
            source
                .iter()
                .map(|label| {
                    if label == "General" {
                        "일반".to_string()
                    } else {
                        format!("[ko] {label}")
                    }
                })
                .collect::<Vec<_>>()
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn nickname_context_translates_ambiguous_latin_names_consistently() {
        let path = cache_path("nickname-latin-context");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(Box::new(MockTranslator), cache);
        let source = ["Ceciliaya", "Kaselia", "NyungNyang"]
            .map(str::to_string)
            .to_vec();
        let nickname_keys = vec![Some("nickname-navigation".to_string()); source.len()];

        assert_eq!(
            service
                .translate_many_for_incoming_contextual(
                    &source,
                    &nickname_keys,
                    "/channels/guild/current",
                    Language::Korean,
                )
                .unwrap(),
            source
                .iter()
                .map(|name| format!("[ko] {name}"))
                .collect::<Vec<_>>()
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn channel_browser_language_context_survives_translation_batches() {
        let path = cache_path("browse-navigation-context");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(Box::new(MockTranslator), cache);

        assert_eq!(
            service
                .translate_many_for_incoming_contextual(
                    &["Friendlyfire Perfect Soldiers Server".to_string()],
                    &[Some("browse-navigation".to_string())],
                    "/channels/guild/current",
                    Language::Korean,
                )
                .unwrap(),
            vec!["[ko] Friendlyfire Perfect Soldiers Server".to_string()]
        );
        assert_eq!(
            service
                .translate_many_for_incoming_contextual(
                    &["general".to_string(), "glory-photozone".to_string()],
                    &[
                        Some("browse-navigation".to_string()),
                        Some("browse-navigation".to_string()),
                    ],
                    "/channels/guild/current",
                    Language::Korean,
                )
                .unwrap(),
            vec!["일반".to_string(), "[ko] glory-photozone".to_string()]
        );

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn korean_navigation_uses_one_general_term_and_preserves_identifier_suffixes() {
        let path = cache_path("navigation-general-glossary");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(Box::new(MockTranslator), cache);
        let source = [
            "General",
            "general_en",
            "general_cn",
            "general_jp",
            "general_kr",
            "general_test",
        ]
        .map(str::to_string)
        .to_vec();
        let navigation_keys = vec![Some("navigation".to_string()); source.len()];

        assert_eq!(
            service
                .translate_many_for_incoming_contextual(
                    &source,
                    &navigation_keys,
                    "/channels/guild/current",
                    Language::Korean,
                )
                .unwrap(),
            vec![
                "일반".to_string(),
                "일반_en".to_string(),
                "일반_cn".to_string(),
                "일반_jp".to_string(),
                "일반_kr".to_string(),
                "일반_test".to_string(),
            ]
        );
        assert_eq!(
            preferred_navigation_translation("general chat", Some("navigation"), Language::Korean,),
            None
        );
        assert_eq!(
            preferred_navigation_translation("general_en", Some("message-1"), Language::Korean,),
            None
        );
        assert_eq!(
            preferred_navigation_translation("general_en", Some("navigation"), Language::Japanese,),
            None
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn navigation_language_context_does_not_leak_into_messages() {
        let path = cache_path("navigation-message-isolation");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(Box::new(MockTranslator), cache);
        let navigation = ["General", "rules", "voice-chat"]
            .map(str::to_string)
            .to_vec();
        let navigation_keys = vec![Some("navigation".to_string()); navigation.len()];
        service
            .translate_many_for_incoming_contextual(
                &navigation,
                &navigation_keys,
                "/channels/guild/first",
                Language::Korean,
            )
            .unwrap();

        assert_eq!(
            service
                .translate_many_for_incoming_contextual(
                    &["thx".to_string()],
                    &[Some("message-1".to_string())],
                    "/channels/guild/first",
                    Language::Korean,
                )
                .unwrap(),
            vec!["thx".to_string()]
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn web_context_scope_is_independent_from_discord_channel_memory() {
        let path = cache_path("web-discord-context-isolation");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(Box::new(MockTranslator), cache);

        service
            .translate_many_for_web_contextual_filtered(
                &["This paragraph belongs to a web page".to_string()],
                &[Some("paragraph-1".to_string())],
                "web:github.com/readme",
                Language::Korean,
                None,
            )
            .unwrap();
        assert_eq!(service.web_context_scope, "web:github.com/readme");
        assert!(service.incoming_context_scope.is_empty());
        assert!(service.navigation_context_scope.is_empty());

        service
            .translate_many_for_incoming_contextual(
                &["This message belongs to Discord".to_string()],
                &[Some("message-1".to_string())],
                "/channels/guild/channel",
                Language::Korean,
            )
            .unwrap();
        assert_eq!(service.incoming_context_scope, "/channels/guild/channel");
        assert_eq!(service.web_context_scope, "web:github.com/readme");

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn web_context_groups_adjacent_visible_blocks_into_fewer_provider_calls() {
        let path = cache_path("web-adjacent-visible-block-context");
        let inputs = Arc::new(Mutex::new(Vec::new()));
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(
            Box::new(RecordingIdentityTranslator {
                inputs: inputs.clone(),
            }),
            cache,
        );
        let source = [
            "GitHub provides distributed version control".to_string(),
            "Repositories include source code and documentation".to_string(),
            "Developers collaborate through issues and pull requests".to_string(),
        ];
        let block_keys = [
            Some("web:wikipedia:paragraph-1".to_string()),
            Some("web:wikipedia:paragraph-2".to_string()),
            Some("web:wikipedia:list-item-1".to_string()),
        ];

        service
            .translate_many_for_web_contextual_filtered(
                &source,
                &block_keys,
                "universal:https://en.wikipedia.org/wiki/GitHub",
                Language::Korean,
                None,
            )
            .unwrap();

        let recorded = inputs.lock().unwrap();
        assert_eq!(recorded.len(), 1);
        assert_eq!(
            recorded[0].matches(MESSAGE_CONTEXT_SEPARATOR).count(),
            source.len() - 1
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn navigation_language_context_survives_channel_changes_in_the_same_server() {
        let path = cache_path("navigation-server-scope");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(Box::new(MockTranslator), cache);
        let navigation = ["General", "rules", "voice-chat"]
            .map(str::to_string)
            .to_vec();
        let navigation_keys = vec![Some("navigation".to_string()); navigation.len()];
        service
            .translate_many_for_incoming_contextual(
                &navigation,
                &navigation_keys,
                "/channels/guild/first",
                Language::Korean,
            )
            .unwrap();

        assert_eq!(
            service
                .translate_many_for_incoming_contextual(
                    &["pets".to_string()],
                    &[Some("navigation".to_string())],
                    "/channels/guild/second",
                    Language::Korean,
                )
                .unwrap(),
            vec!["[ko] pets".to_string()]
        );
        assert_eq!(
            service
                .translate_many_for_incoming_contextual(
                    &["art".to_string()],
                    &[Some("navigation".to_string())],
                    "/channels/other-server/first",
                    Language::Korean,
                )
                .unwrap(),
            vec!["art".to_string()]
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn incoming_channel_context_recovers_short_english_without_leaking_to_another_channel() {
        let path = cache_path("recent-english-channel");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(Box::new(MockTranslator), cache);
        let known = vec![
            "Hello and welcome to the server".to_string(),
            "Please read the rules and have fun".to_string(),
        ];
        let known_keys = vec![Some("message-1".to_string()), Some("message-2".to_string())];
        service
            .translate_many_for_incoming_contextual(
                &known,
                &known_keys,
                "/channels/guild/english",
                Language::Korean,
            )
            .unwrap();

        let short = vec![
            "it was a soft bonk".to_string(),
            "Uh huh".to_string(),
            "CHOCOLATE MILK!!!!".to_string(),
            "Why did it melt".to_string(),
            "thx".to_string(),
            "LMAO".to_string(),
        ];
        let short_keys = vec![
            Some("message-3".to_string()),
            Some("message-4".to_string()),
            Some("message-5".to_string()),
            Some("message-6".to_string()),
            Some("message-7".to_string()),
            Some("message-8".to_string()),
        ];
        assert_eq!(
            service
                .translate_many_for_incoming_contextual(
                    &short,
                    &short_keys,
                    "/channels/guild/english",
                    Language::Korean,
                )
                .unwrap(),
            vec![
                "[ko] it was a soft bonk".to_string(),
                "[ko] Uh huh".to_string(),
                "[ko] CHOCOLATE MILK!!!!".to_string(),
                "[ko] Why did it melt".to_string(),
                "[ko] thx".to_string(),
                "[ko] LMAO".to_string(),
            ]
        );
        assert_eq!(
            service
                .translate_many_for_incoming_contextual(
                    &["thx".to_string()],
                    &[Some("message-1".to_string())],
                    "/channels/guild/other",
                    Language::Korean,
                )
                .unwrap(),
            vec!["thx".to_string()]
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn incoming_korean_message_translates_its_clear_english_fragment() {
        let path = cache_path("mixed-korean-english");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(Box::new(MockTranslator), cache);
        let source = "Yeah, it's fine Solon-sama 언젠가 만날 때 음료를 제공하면 기쁠 거예요";

        assert_eq!(
            service.translate(source, Language::Korean).unwrap(),
            "[ko] Yeah, it's fine Solon-sama 언젠가 만날 때 음료를 제공하면 기쁠 거예요"
        );
        assert_eq!(
            service
                .translate("Silver Moon에게 음료를 건넸어요", Language::Korean)
                .unwrap(),
            "Silver Moon에게 음료를 건넸어요"
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn incoming_korean_message_translates_english_fragment_with_keyboard_smash_suffix() {
        let path = cache_path("mixed-korean-english-keyboard-smash");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(Box::new(MockTranslator), cache);
        let source = concat!(
            "새로운 영상이 나왔어요!! VR에서 베달과 함께 네오로이드가 무너지는 모습에 대한 제 반응 😥 ",
            "it was so cute man, I GOT SO EMOTIONAL gfjhdlkf 🎉 ",
            "여러분도 즐겁게 하시길 바랍니다!!"
        );

        let translated = service.translate(source, Language::Korean).unwrap();

        assert!(
            translated.contains("[ko] it was so cute man, I GOT SO EMOTIONAL gfjhdlkf"),
            "English fragment was not translated: {translated}"
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn incoming_korean_message_translates_long_casual_english_update() {
        let path = cache_path("mixed-korean-long-casual-update");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(Box::new(MockTranslator), cache);
        let english = concat!(
            "tomorrow I'm going to stream and chat about my experience at the con hehe, ",
            "and there may or may not be a vlog of it otw soon!! just waiting to see what ",
            "my editor says since there is a lil bit of audio issues here and there with my capture"
        );
        let source = format!(
            "정말 즐거운 시간을 보냈으니 다시 한 번 고마워요!! ~ {english}\n모두 멋진 밤을 보내세요!!"
        );

        let translated = service.translate(&source, Language::Korean).unwrap();

        assert!(
            translated.contains(&format!("[ko] {english}")),
            "English fragment was not translated: {translated}"
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn incoming_korean_guide_translates_long_and_short_english_fragments() {
        let path = cache_path("mixed-korean-guide-english");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(Box::new(MockTranslator), cache);
        let source = concat!(
            "연말 분위기를 천천히 즐겨보세요.\n",
            "In this residence, we invite you to enjoy a special experience — listening to Charlie Puth on vinyl while overlooking the city night view.\n",
            "1️⃣ 전원 켜기 1️⃣ Power On\n",
            "5️⃣ 볼륨 조절 5️⃣ Adjust Volume\n",
            "6️⃣ 감상 팁 6️⃣ Listening Tips\n",
            "감상이 끝나면 톤암을 거치대에 올려 주세요."
        );

        let translated = service.translate(source, Language::Korean).unwrap();

        for fragment in [
            "In this residence, we invite you to enjoy a special experience",
            "listening to Charlie Puth on vinyl while overlooking the city night view.",
            "Power On",
            "Adjust Volume",
            "Listening Tips",
        ] {
            assert!(
                translated.contains(&format!("[ko] {fragment}")),
                "English fragment was not translated: {fragment}\n{translated}"
            );
        }
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn incoming_korean_guide_keeps_adjacent_english_lines_in_one_context() {
        let path = cache_path("mixed-korean-guide-adjacent-english-lines");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(Box::new(JoinedLineContextTranslator), cache);
        let source = concat!(
            "연말 분위기를 천천히 즐겨보세요.\n",
            "In this residence,\n",
            "we invite you to enjoy a special experience\n",
            "도시의 야경을 감상하세요."
        );

        assert_eq!(
            service.translate(source, Language::Korean).unwrap(),
            concat!(
                "연말 분위기를 천천히 즐겨보세요.\n",
                "이 레지던스에서는 특별한 경험으로 초대합니다\n",
                "도시의 야경을 감상하세요."
            )
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn invalid_unchanged_cache_entry_is_retranslated() {
        let path = cache_path("invalid-unchanged-cache");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let calls = Arc::new(Mutex::new(0));
        let translator = CountingTranslator {
            calls: calls.clone(),
        };
        let namespace = translator.cache_namespace().to_string();
        let source = "Power On";
        cache
            .put(
                &source_hash(source),
                source,
                Language::English.code(),
                Language::Korean.code(),
                source,
                &namespace,
            )
            .unwrap();
        let mut service = TranslationService::new(Box::new(translator), cache);

        assert_eq!(
            service.translate(source, Language::Korean).unwrap(),
            "[ko] Power On"
        );
        assert_eq!(*calls.lock().unwrap(), 1);
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
    fn duplicate_uncached_items_share_one_provider_translation() {
        for target in [Language::Arabic, Language::German, Language::Korean] {
            let path = cache_path(&format!("duplicate-uncached-batch-{}", target.code()));
            let calls = Arc::new(Mutex::new(0));
            let cache = TranslationCache::open(path.clone(), 32).unwrap();
            let mut service = TranslationService::new(
                Box::new(CountingTranslator {
                    calls: calls.clone(),
                }),
                cache,
            );

            let translated = service
                .translate_many(
                    &[
                        "Hello from the same card".to_string(),
                        "Hello from the same card".to_string(),
                    ],
                    target,
                )
                .unwrap();

            assert_eq!(translated[0], translated[1]);
            assert_eq!(*calls.lock().unwrap(), 1);
            let _ = fs::remove_dir_all(path.parent().unwrap());
        }
    }

    #[test]
    fn best_effort_duplicate_items_share_one_isolated_translation() {
        let path = cache_path("duplicate-best-effort-batch");
        let calls = Arc::new(Mutex::new(0));
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(
            Box::new(CountingTranslator {
                calls: calls.clone(),
            }),
            cache,
        );
        let texts = vec![
            "Repeated dynamic card".to_string(),
            "Repeated dynamic card".to_string(),
        ];

        let translated = service.translate_many_best_effort_with_hints(
            &texts,
            &[None, None],
            Language::Japanese,
            None,
        );

        assert_eq!(translated[0], translated[1]);
        assert_eq!(*calls.lock().unwrap(), 1);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn best_effort_retries_a_quality_rejected_result_before_showing_the_original() {
        let path = cache_path("best-effort-quality-retry");
        let calls = Arc::new(Mutex::new(0));
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(
            Box::new(FlakyQualityTranslator {
                calls: calls.clone(),
            }),
            cache,
        );
        let source = "インバイトで入っててもすぐ落下してしまいます( ノД`)".to_string();

        let translated =
            service.translate_many_best_effort(std::slice::from_ref(&source), Language::Korean);

        assert_eq!(
            translated,
            ["초대받아 들어가도 바로 떨어져 버립니다 ( ノД`)".to_string()]
        );
        assert_eq!(*calls.lock().unwrap(), 2);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn resilient_local_model_bounds_incoming_quality_failures_and_keeps_the_original() {
        let path = cache_path("resilient-incoming-quality-failure");
        let calls = Arc::new(Mutex::new(0));
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service = TranslationService::new(
            Box::new(ResilientTranslator::new(
                Box::new(AlwaysIncompleteIsolatedTranslator {
                    calls: calls.clone(),
                }),
                None,
            )),
            cache,
        );
        let source = "インバイトで入っててもすぐ落下してしまいます".to_string();

        let translated = service
            .translate_many_for_incoming(std::slice::from_ref(&source), Language::Korean)
            .unwrap();

        assert_eq!(translated, [source]);
        assert_eq!(*calls.lock().unwrap(), 4);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn web_translation_preserves_successful_paragraph_chunks_when_one_chunk_fails_quality() {
        let path = cache_path("web-partial-chunk-quality-failure");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service =
            TranslationService::new(Box::new(PartiallyFailingWebChunkTranslator), cache);
        let source = concat!(
            "コーギーの愛らしさを詰め込んだ衣装です。\n",
            "パン屋さんモチーフです。\n\n",
            "コンセプトアート・デザイン：ぷも"
        )
        .to_string();

        let translated = service
            .translate_many_for_web_contextual_filtered(
                std::slice::from_ref(&source),
                &[None],
                "https://booth.pm/ko/items/test",
                Language::Korean,
                None,
            )
            .unwrap();

        assert_eq!(
            translated,
            [concat!(
                "코기의 사랑스러움을 담은 의상입니다.\n",
                "빵집 모티브입니다.\n\n",
                "コンセプトアート・デザイン：ぷも"
            )
            .to_string()]
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn web_translation_retries_a_failed_single_paragraph_by_visual_lines() {
        let path = cache_path("web-single-paragraph-line-fallback");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service =
            TranslationService::new(Box::new(MultilineFailingWebChunkTranslator), cache);
        let source = concat!(
            "大人気な輝夜ちゃんの特別セットをご用意しました✨\n",
            "なんと11種類セットでとってもお得になってます！\n",
            "使いやすいお洋服からかぷちやの定番まで！\n",
            "ぜひ『#かぷちやこーで』でポストしてね！"
        )
        .to_string();

        let translated = service
            .translate_many_for_web_contextual_filtered(
                std::slice::from_ref(&source),
                &[None],
                "https://booth.pm/ko/items/test",
                Language::Korean,
                None,
            )
            .unwrap();

        assert_eq!(
            translated,
            [concat!(
                "인기 많은 카구야의 특별 세트를 준비했습니다✨\n",
                "무려 11종 세트로 매우 알찬 구성입니다!\n",
                "활용하기 좋은 의상부터 카푸치야의 대표 상품까지!\n",
                "꼭 『#かぷちやこーで』에 게시해 주세요!"
            )
            .to_string()]
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn incoming_translation_keeps_whole_text_when_one_paragraph_chunk_fails_quality() {
        let path = cache_path("incoming-whole-text-quality-failure");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        let mut service =
            TranslationService::new(Box::new(PartiallyFailingWebChunkTranslator), cache);
        let source = concat!(
            "コーギーの愛らしさを詰め込んだ衣装です。\n",
            "パン屋さんモチーフです。\n\n",
            "コンセプトアート・デザイン：ぷも"
        )
        .to_string();

        let translated = service
            .translate_many_for_incoming_contextual(
                std::slice::from_ref(&source),
                &[None],
                "/channels/test/general",
                Language::Korean,
            )
            .unwrap();

        assert_eq!(translated, [source]);
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
    #[ignore = "all verified local models and llama-server are required"]
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
             Every model in the local model catalog is checked on the eight first-wave extension languages.\n\n\
             | Model | Direction | Detected output | Gate | Translation |\n\
             |---|---|---|---|---|\n",
        );
        let mut failures = Vec::new();

        for model_size in HyMtModelSize::all() {
            let model_key = model_size.config_id();
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
