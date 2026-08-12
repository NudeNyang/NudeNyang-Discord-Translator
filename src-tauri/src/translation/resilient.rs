use unicode_normalization::UnicodeNormalization;

use crate::language::Language;

use super::protected_text::contains_unexpected_marker_artifact;
use super::Translator;

const HALLUCINATION_PHRASES: [&str; 6] = [
    "번역이 어렵",
    "번역할 수 없",
    "해당 문구",
    "정확한 상황",
    "추가 정보를 제공",
    "원문 내용을 직접",
];

pub struct ResilientTranslator {
    primary: Box<dyn Translator>,
    fallback: Option<Box<dyn Translator>>,
    display_name: String,
    cache_namespace: String,
}

impl ResilientTranslator {
    pub fn new(primary: Box<dyn Translator>, fallback: Option<Box<dyn Translator>>) -> Self {
        let display_name = fallback.as_ref().map_or_else(
            || primary.display_name().to_string(),
            |fallback| {
                format!(
                    "{} + {} 보완",
                    primary.display_name(),
                    fallback.display_name()
                )
            },
        );
        let fallback_namespace = fallback
            .as_ref()
            .map_or("local-only", |translator| translator.cache_namespace());
        let cache_namespace = format!(
            "{}:quality-repair-v1:{fallback_namespace}",
            primary.cache_namespace()
        );
        Self {
            primary,
            fallback,
            display_name,
            cache_namespace,
        }
    }
}

impl Translator for ResilientTranslator {
    fn display_name(&self) -> &str {
        &self.display_name
    }

    fn cache_namespace(&self) -> &str {
        &self.cache_namespace
    }

    fn sends_text_externally(&self) -> bool {
        self.primary.sends_text_externally()
            || self
                .fallback
                .as_ref()
                .is_some_and(|translator| translator.sends_text_externally())
    }

    fn translate(
        &mut self,
        text: &str,
        source: Language,
        target: Language,
    ) -> Result<String, String> {
        self.translate_many(&[(text.to_string(), source)], target)
            .and_then(|mut values| {
                values
                    .pop()
                    .ok_or_else(|| "번역 엔진이 결과를 반환하지 않았어.".to_string())
            })
    }

    fn translate_many(
        &mut self,
        items: &[(String, Language)],
        target: Language,
    ) -> Result<Vec<String>, String> {
        if items.is_empty() {
            return Ok(Vec::new());
        }
        let mut results = self.primary.translate_many(items, target)?;
        if results.len() != items.len() {
            return Err("주 번역 엔진이 요청 수와 다른 결과를 반환했습니다.".to_string());
        }

        let failed: Vec<usize> = items
            .iter()
            .zip(&results)
            .enumerate()
            .filter_map(|(index, ((source_text, source), translated))| {
                translation_needs_repair(source_text, translated, *source, target).then_some(index)
            })
            .collect();
        if failed.is_empty() {
            return Ok(results);
        }

        let mut source_lines = vec![Vec::<String>::new(); items.len()];
        let mut nonempty_lines = vec![Vec::<usize>::new(); items.len()];
        let mut line_items = Vec::new();
        for &index in &failed {
            let (source_text, source) = &items[index];
            let lines: Vec<String> = if source_text.lines().next().is_some() {
                source_text.lines().map(str::to_string).collect()
            } else {
                vec![source_text.clone()]
            };
            let nonempty: Vec<usize> = lines
                .iter()
                .enumerate()
                .filter_map(|(line_index, line)| (!line.trim().is_empty()).then_some(line_index))
                .collect();
            if nonempty.len() > 1 {
                line_items.extend(
                    nonempty
                        .iter()
                        .map(|line_index| (lines[*line_index].clone(), *source)),
                );
            }
            source_lines[index] = lines;
            nonempty_lines[index] = nonempty;
        }

        let local_lines = if line_items.is_empty() {
            Vec::new()
        } else {
            let values = self.primary.translate_many(&line_items, target)?;
            if values.len() != line_items.len() {
                return Err("줄 단위 재번역 결과 수가 요청 수와 달라.".to_string());
            }
            values
        };

        let mut repaired = vec![Vec::<String>::new(); items.len()];
        let mut cursor = 0;
        for &index in &failed {
            repaired[index] = source_lines[index].clone();
            let nonempty = &nonempty_lines[index];
            if nonempty.len() > 1 {
                for &line_index in nonempty {
                    repaired[index][line_index] = local_lines[cursor].clone();
                    cursor += 1;
                }
            } else if let Some(&line_index) = nonempty.first() {
                repaired[index][line_index] = results[index].clone();
            }
        }

        let mut fallback_items = Vec::new();
        let mut fallback_slots = Vec::new();
        for &index in &failed {
            let source = items[index].1;
            for &line_index in &nonempty_lines[index] {
                if translation_needs_repair(
                    &source_lines[index][line_index],
                    &repaired[index][line_index],
                    source,
                    target,
                ) {
                    fallback_items.push((source_lines[index][line_index].clone(), source));
                    fallback_slots.push((index, line_index));
                }
            }
        }

        if !fallback_items.is_empty() {
            if let Some(fallback) = self.fallback.as_mut() {
                if let Ok(values) = fallback.translate_many(&fallback_items, target) {
                    if values.len() == fallback_items.len() {
                        for ((index, line_index), translated) in
                            fallback_slots.iter().copied().zip(values)
                        {
                            repaired[index][line_index] = translated;
                        }
                    }
                }
            }
        }

        for index in failed {
            let source = items[index].1;
            for line_index in 0..repaired[index].len() {
                if translation_needs_repair(
                    &source_lines[index][line_index],
                    &repaired[index][line_index],
                    source,
                    target,
                ) {
                    repaired[index][line_index] = source_lines[index][line_index].clone();
                }
            }
            results[index] = repaired[index].join("\n");
        }
        Ok(results)
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

    fn prepare(&mut self) -> Result<(), String> {
        self.primary.prepare()?;
        if let Some(fallback) = self.fallback.as_mut() {
            fallback.prepare()?;
        }
        Ok(())
    }

    fn model_is_ready(&self) -> bool {
        self.primary.model_is_ready()
    }

    fn close(&mut self) {
        self.primary.close();
        if let Some(fallback) = self.fallback.as_mut() {
            fallback.close();
        }
    }
}

pub fn translation_needs_repair(
    source_text: &str,
    translated_text: &str,
    source: Language,
    target: Language,
) -> bool {
    if contains_unexpected_marker_artifact(source_text, translated_text) {
        return true;
    }
    let source_normalized = normalize(source_text);
    let translated_normalized = normalize(translated_text);
    if source_normalized.is_empty() {
        return false;
    }
    let source_alnum = source_normalized
        .chars()
        .filter(|character| character.is_alphanumeric())
        .count();
    let translated_alnum = translated_normalized
        .chars()
        .filter(|character| character.is_alphanumeric())
        .count();
    if target != source
        && (HALLUCINATION_PHRASES
            .iter()
            .any(|phrase| translated_text.contains(phrase))
            || (source_alnum >= 2 && translated_alnum > 48.max(source_alnum * 5)))
    {
        return true;
    }
    let meaningful = source_normalized
        .chars()
        .filter(|character| character.is_alphabetic())
        .count()
        >= 4;
    if source_normalized == translated_normalized {
        match source {
            Language::Japanese if target != source => {
                if count_kana(source_text) + count_han(source_text) >= 2 {
                    return true;
                }
            }
            Language::Korean if target != source => {
                if count_hangul(source_text) >= 2 {
                    return true;
                }
            }
            Language::English if target != source => {
                let latin: String = source_text
                    .chars()
                    .filter(char::is_ascii_alphabetic)
                    .collect();
                let interior_uppercase = latin
                    .chars()
                    .skip(1)
                    .any(|character| character.is_uppercase());
                if latin.len() >= 4
                    && !latin.chars().all(|character| character.is_uppercase())
                    && !interior_uppercase
                {
                    return true;
                }
            }
            _ => {}
        }
        return meaningful
            && (source_normalized.chars().count() >= 10 || source_normalized.contains(' '));
    }

    if target == Language::Korean {
        let hangul = count_hangul(translated_text);
        if matches!(
            source,
            Language::Japanese | Language::ChineseSimplified | Language::ChineseTraditional
        ) {
            let source_kana = count_kana(source_text);
            let source_han = count_han(source_text);
            let remaining_kana = count_kana(translated_text);
            let remaining_han = count_han(translated_text);
            if hangul == 0 && (source_kana >= 2 || source_han >= 4) {
                return true;
            }
            if hangul >= 2 && remaining_han > 0 && remaining_kana == 0 {
                return true;
            }
            if matches!(
                source,
                Language::ChineseSimplified | Language::ChineseTraditional
            ) {
                return remaining_han >= 2;
            }
            return remaining_kana >= 5.max((hangul as f64 * 0.55).round() as usize);
        }
        if source == Language::English {
            let source_latin = count_latin(source_text);
            let remaining_latin = count_latin(translated_text);
            return hangul == 0
                && source_latin >= 6
                && remaining_latin >= (source_latin as f64 * 0.8).round() as usize
                && (source_text.contains(' ') || source_text.chars().count() >= 14);
        }
    }
    if target == Language::English && source == Language::Japanese {
        return count_latin(translated_text) == 0 && count_kana(translated_text) >= 2;
    }
    if target == Language::Japanese && matches!(source, Language::Korean | Language::English) {
        let japanese = count_kana(translated_text) + count_han(translated_text);
        let source_letters = source_text
            .chars()
            .filter(|character| character.is_alphabetic())
            .count();
        return japanese == 0 && source_letters >= 6 && source_text.contains(' ');
    }
    if target != source && source_alnum >= 6 {
        let required_script = match target {
            Language::Korean => count_hangul(translated_text),
            Language::Japanese => count_kana(translated_text) + count_han(translated_text),
            Language::ChineseSimplified | Language::ChineseTraditional => {
                count_han(translated_text)
            }
            Language::Hindi => count_devanagari(translated_text),
            Language::Arabic => count_arabic(translated_text),
            Language::Russian | Language::Ukrainian => count_cyrillic(translated_text),
            _ => 1,
        };
        if required_script == 0
            && matches!(
                target,
                Language::Korean
                    | Language::Japanese
                    | Language::ChineseSimplified
                    | Language::ChineseTraditional
                    | Language::Hindi
                    | Language::Arabic
                    | Language::Russian
                    | Language::Ukrainian
            )
        {
            return true;
        }
    }
    false
}

fn normalize(text: &str) -> String {
    text.nfkc()
        .flat_map(char::to_lowercase)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn count_in_ranges(text: &str, ranges: &[(u32, u32)]) -> usize {
    text.chars()
        .filter(|character| {
            let value = *character as u32;
            ranges
                .iter()
                .any(|(start, end)| (*start..=*end).contains(&value))
        })
        .count()
}

fn count_hangul(text: &str) -> usize {
    count_in_ranges(
        text,
        &[(0x1100, 0x11ff), (0x3130, 0x318f), (0xac00, 0xd7af)],
    )
}

fn count_kana(text: &str) -> usize {
    count_in_ranges(text, &[(0x3040, 0x30ff), (0x31f0, 0x31ff)])
}

fn count_han(text: &str) -> usize {
    count_in_ranges(
        text,
        &[(0x3400, 0x4dbf), (0x4e00, 0x9fff), (0xf900, 0xfaff)],
    )
}

fn count_latin(text: &str) -> usize {
    text.chars().filter(char::is_ascii_alphabetic).count()
}

fn count_devanagari(text: &str) -> usize {
    count_in_ranges(text, &[(0x0900, 0x097f)])
}

fn count_arabic(text: &str) -> usize {
    count_in_ranges(
        text,
        &[(0x0600, 0x06ff), (0x0750, 0x077f), (0x08a0, 0x08ff)],
    )
}

fn count_cyrillic(text: &str) -> usize {
    count_in_ranges(text, &[(0x0400, 0x052f)])
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::{translation_needs_repair, ResilientTranslator};
    use crate::language::Language;
    use crate::translation::Translator;

    type RecordedCalls = Arc<Mutex<Vec<Vec<(String, Language)>>>>;

    struct PartialTranslator {
        calls: RecordedCalls,
    }

    impl Translator for PartialTranslator {
        fn display_name(&self) -> &str {
            "partial"
        }
        fn cache_namespace(&self) -> &str {
            "local:test"
        }
        fn translate(
            &mut self,
            text: &str,
            source: Language,
            target: Language,
        ) -> Result<String, String> {
            self.translate_many(&[(text.to_string(), source)], target)
                .map(|mut values| values.remove(0))
        }
        fn translate_many(
            &mut self,
            items: &[(String, Language)],
            _target: Language,
        ) -> Result<Vec<String>, String> {
            self.calls.lock().unwrap().push(items.to_vec());
            Ok(items.iter().map(|(text, _)| {
                if text.contains('\n') {
                    "이번에는 실제로 춤추는 사람을 촬영해 봅시다!\nJoin先はポスター記載の4KVRCグループインスタンスです！".to_string()
                } else if text.starts_with("今回は") {
                    "이번에는 실제로 춤추는 사람을 촬영해 봅시다!".to_string()
                } else { text.clone() }
            }).collect())
        }
    }

    struct FallbackTranslator;
    impl Translator for FallbackTranslator {
        fn display_name(&self) -> &str {
            "fallback"
        }
        fn cache_namespace(&self) -> &str {
            "deepl:test"
        }
        fn sends_text_externally(&self) -> bool {
            true
        }
        fn translate(
            &mut self,
            _text: &str,
            _source: Language,
            _target: Language,
        ) -> Result<String, String> {
            Ok("참가 장소는 포스터에 적힌 4KVRC 그룹 인스턴스입니다!".to_string())
        }
    }

    #[test]
    fn repairs_failed_lines_and_uses_fallback_only_for_them() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let mut translator = ResilientTranslator::new(
            Box::new(PartialTranslator {
                calls: calls.clone(),
            }),
            Some(Box::new(FallbackTranslator)),
        );
        let source = "今回は実際に踊ってる人を撮ってみましょう！\nJoin先はポスター記載の4KVRCグループインスタンスです！";
        assert_eq!(
            translator.translate(source, Language::Japanese, Language::Korean).unwrap(),
            "이번에는 실제로 춤추는 사람을 촬영해 봅시다!\n참가 장소는 포스터에 적힌 4KVRC 그룹 인스턴스입니다!"
        );
        assert_eq!(calls.lock().unwrap().len(), 2);
    }

    #[test]
    fn detects_echoes_and_hallucinations_without_rejecting_a_proper_name() {
        assert!(translation_needs_repair(
            "4k動画設定",
            "4K動画設定",
            Language::Japanese,
            Language::Korean
        ));
        assert!(translation_needs_repair(
            "ハブ",
            "죄송합니다. 해당 문구는 번역이 어렵습니다.",
            Language::Japanese,
            Language::Korean
        ));
        assert!(!translation_needs_repair(
            "第4回すてらダンス部コラボ授業です！",
            "제4회 すてらダンス部 컬래버레이션 수업입니다!",
            Language::Japanese,
            Language::Korean,
        ));
        assert!(translation_needs_repair(
            "좋은 재능이야",
            "Das Talent ist wirklich gut ZXQKEEP",
            Language::Korean,
            Language::German,
        ));
    }

    #[test]
    fn rejects_outputs_missing_an_unambiguous_target_script() {
        for (target, valid) in [
            (Language::Korean, "서버에서 곧 만나요"),
            (Language::Japanese, "サーバーでまた会いましょう"),
            (Language::ChineseSimplified, "我们很快在服务器见面"),
            (Language::ChineseTraditional, "我們很快在伺服器見面"),
            (Language::Hindi, "सर्वर पर जल्द मिलते हैं"),
            (Language::Arabic, "نلتقي قريبًا على الخادم"),
            (Language::Russian, "Скоро увидимся на сервере"),
            (Language::Ukrainian, "Скоро побачимося на сервері"),
        ] {
            assert!(translation_needs_repair(
                "See you soon on the server",
                "See you soon on the server",
                Language::English,
                target,
            ));
            assert!(!translation_needs_repair(
                "See you soon on the server",
                valid,
                Language::English,
                target,
            ));
        }
    }

    #[test]
    fn does_not_guess_between_latin_script_target_languages() {
        assert!(!translation_needs_repair(
            "See you soon on the server",
            "Nos vemos pronto en el servidor",
            Language::English,
            Language::LatinAmericanSpanish,
        ));
        assert!(!translation_needs_repair(
            "See you soon on the server",
            "Até logo no servidor",
            Language::English,
            Language::BrazilianPortuguese,
        ));
    }
}
