use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

const SIMPLIFIED_HINTS: &str = "这们为时发后说对过从还实见长门问间书车马风云龙习";
const TRADITIONAL_HINTS: &str = "這們麼嗎裡說對從還";

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
pub enum Language {
    #[serde(rename = "ko")]
    Korean,
    #[serde(rename = "en")]
    English,
    #[serde(rename = "ja")]
    Japanese,
    #[serde(rename = "zh")]
    ChineseSimplified,
    #[serde(rename = "zh-Hant")]
    ChineseTraditional,
    #[serde(rename = "und")]
    Unknown,
}

impl Language {
    pub fn code(self) -> &'static str {
        match self {
            Self::Korean => "ko",
            Self::English => "en",
            Self::Japanese => "ja",
            Self::ChineseSimplified => "zh",
            Self::ChineseTraditional => "zh-Hant",
            Self::Unknown => "und",
        }
    }

    pub fn english_name(self) -> &'static str {
        match self {
            Self::Korean => "Korean",
            Self::English => "English",
            Self::Japanese => "Japanese",
            Self::ChineseSimplified => "Simplified Chinese",
            Self::ChineseTraditional => "Traditional Chinese",
            Self::Unknown => "the source language",
        }
    }
}

impl TryFrom<&str> for Language {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "ko" => Ok(Self::Korean),
            "en" => Ok(Self::English),
            "ja" => Ok(Self::Japanese),
            "zh" => Ok(Self::ChineseSimplified),
            "zh-Hant" => Ok(Self::ChineseTraditional),
            "und" => Ok(Self::Unknown),
            _ => Err(format!("지원하지 않는 언어 코드야: {value}")),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RecognitionCandidate {
    pub engine: String,
    pub text: String,
    pub confidence: f64,
}

#[derive(Default)]
struct ScriptCounts {
    hangul: usize,
    kana: usize,
    han: usize,
    latin: usize,
    letters: usize,
}

pub fn detect_explicit_language(text: &str) -> Language {
    let counts = script_counts(text);
    if counts.hangul > 0 {
        return Language::Korean;
    }
    if counts.kana > 0 {
        return Language::Japanese;
    }
    let simplified = text
        .chars()
        .filter(|character| SIMPLIFIED_HINTS.contains(*character))
        .count();
    let traditional = text
        .chars()
        .filter(|character| TRADITIONAL_HINTS.contains(*character))
        .count();
    if simplified > traditional {
        return Language::ChineseSimplified;
    }
    if traditional > simplified {
        return Language::ChineseTraditional;
    }
    if counts.latin > 0 && counts.latin as f64 >= (counts.letters as f64 * 0.55).max(1.0) {
        return Language::English;
    }
    Language::Unknown
}

pub struct LanguageDetector {
    context: VecDeque<Language>,
    context_size: usize,
}

impl Default for LanguageDetector {
    fn default() -> Self {
        Self::new(8)
    }
}

impl LanguageDetector {
    pub fn new(context_size: usize) -> Self {
        Self {
            context: VecDeque::with_capacity(context_size),
            context_size,
        }
    }

    pub fn detect(&mut self, text: &str, remember: bool) -> Language {
        let counts = script_counts(text);
        let mut result = detect_explicit_language(text);
        if result == Language::Unknown && counts.han > 0 {
            result = self.context_language().unwrap_or(Language::Japanese);
        }
        if remember && result != Language::Unknown {
            if self.context.len() == self.context_size {
                self.context.pop_front();
            }
            self.context.push_back(result);
        }
        result
    }

    fn context_language(&self) -> Option<Language> {
        self.context.iter().rev().copied().find(|language| {
            matches!(
                language,
                Language::Japanese
                    | Language::Korean
                    | Language::ChineseSimplified
                    | Language::ChineseTraditional
            )
        })
    }
}

#[derive(Default)]
pub struct CandidateSelector {
    detector: LanguageDetector,
}

impl CandidateSelector {
    pub fn choose(
        &mut self,
        candidates: &[RecognitionCandidate],
    ) -> (RecognitionCandidate, Language) {
        let useful: Vec<_> = candidates
            .iter()
            .filter(|candidate| !candidate.text.trim().is_empty())
            .collect();
        if useful.is_empty() {
            return (
                RecognitionCandidate {
                    engine: "none".to_string(),
                    text: String::new(),
                    confidence: 0.0,
                },
                Language::Unknown,
            );
        }
        let mut best: Option<(f64, RecognitionCandidate)> = None;
        for candidate in &useful {
            let language = self.detector.detect(&candidate.text, false);
            let counts = script_counts(&candidate.text);
            let engine = candidate.engine.to_lowercase();
            let mut bonus = 0.0;
            if counts.hangul > 0 && engine.contains("korean") {
                bonus += 0.22;
            }
            if counts.kana > 0 && engine.contains("v6") {
                bonus += 0.16;
            }
            if language == Language::English {
                bonus += 0.04;
            }
            if is_complete_v6_candidate(candidate, &useful) {
                bonus += 0.14;
            }
            if candidate.text.contains('�')
                || candidate.text.matches('?').count() > candidate.text.chars().count() / 3
            {
                bonus -= 0.25;
            }
            let score = candidate.confidence + bonus;
            if best.as_ref().is_none_or(|(current, _)| score > *current) {
                best = Some((score, (*candidate).clone()));
            }
        }
        let selected = best.expect("useful candidates are not empty").1;
        let language = self.detector.detect(&selected.text, true);
        (selected, language)
    }
}

fn script_counts(text: &str) -> ScriptCounts {
    let mut counts = ScriptCounts::default();
    for character in text.chars() {
        let value = character as u32;
        if matches!(value, 0x1100..=0x11ff | 0x3130..=0x318f | 0xac00..=0xd7af) {
            counts.hangul += 1;
        }
        if matches!(value, 0x3040..=0x30ff | 0x31f0..=0x31ff) {
            counts.kana += 1;
        }
        if matches!(value, 0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xf900..=0xfaff) {
            counts.han += 1;
        }
        if character.is_ascii_alphabetic() {
            counts.latin += 1;
        }
        if character.is_alphabetic() {
            counts.letters += 1;
        }
    }
    counts
}

fn is_complete_v6_candidate(
    candidate: &RecognitionCandidate,
    candidates: &[&RecognitionCandidate],
) -> bool {
    if !candidate.engine.to_lowercase().contains("v6") {
        return false;
    }
    let counts = script_counts(&candidate.text);
    if counts.han == 0 && counts.kana == 0 {
        return false;
    }
    let normalized: String = candidate
        .text
        .chars()
        .filter(|character| character.is_alphanumeric())
        .collect();
    if normalized.chars().count() < 4 {
        return false;
    }
    candidates.iter().any(|other| {
        if !other.engine.to_lowercase().contains("korean")
            || candidate.confidence < other.confidence - 0.06
        {
            return false;
        }
        let other_normalized: String = other
            .text
            .chars()
            .filter(|character| character.is_alphanumeric())
            .collect();
        !other_normalized.is_empty()
            && other_normalized.chars().count() * 10 <= normalized.chars().count() * 6
            && normalized
                .to_lowercase()
                .starts_with(&other_normalized.to_lowercase())
    })
}

#[cfg(test)]
mod tests {
    use super::{CandidateSelector, Language, LanguageDetector, RecognitionCandidate};

    #[test]
    fn detects_all_supported_language_families() {
        let mut detector = LanguageDetector::default();
        assert_eq!(
            detector.detect("Hello from Discord", true),
            Language::English
        );
        assert_eq!(
            detector.detect("こんにちは、元気ですか", true),
            Language::Japanese
        );
        assert_eq!(
            detector.detect("안녕하세요, 반가워요", true),
            Language::Korean
        );
        assert_eq!(
            detector.detect("这是中文消息", true),
            Language::ChineseSimplified
        );
        assert_eq!(
            detector.detect("這是繁體中文訊息", true),
            Language::ChineseTraditional
        );
    }

    #[test]
    fn han_only_text_uses_recent_context() {
        let mut detector = LanguageDetector::default();
        detector.detect("这是中文消息", true);
        assert_eq!(detector.detect("北京站", true), Language::ChineseSimplified);
        detector.detect("これは日本語です", true);
        assert_eq!(detector.detect("東京駅", true), Language::Japanese);
    }

    #[test]
    fn selector_prefers_complete_script_specific_candidates() {
        let mut selector = CandidateSelector::default();
        let (best, language) = selector.choose(&[
            RecognitionCandidate {
                engine: "PP-OCRv6-small".to_string(),
                text: "OfL하세요".to_string(),
                confidence: 0.91,
            },
            RecognitionCandidate {
                engine: "korean_PP-OCRv5-mobile".to_string(),
                text: "안녕하세요".to_string(),
                confidence: 0.83,
            },
        ]);
        assert_eq!(best.text, "안녕하세요");
        assert_eq!(language, Language::Korean);

        let (best, _) = selector.choose(&[
            RecognitionCandidate {
                engine: "PP-OCRv6-small".to_string(),
                text: "4k動画設定".to_string(),
                confidence: 0.999,
            },
            RecognitionCandidate {
                engine: "korean_PP-OCRv5-mobile".to_string(),
                text: "4k".to_string(),
                confidence: 0.994,
            },
        ]);
        assert_eq!(best.text, "4k動画設定");
    }
}
