use std::collections::HashSet;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BoundaryStrategy {
    Words,
    Compact,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InflectionStrategy {
    Exact,
    English,
    Japanese,
    Korean,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AnalysisProfile {
    pub language: &'static str,
    pub boundaries: BoundaryStrategy,
    pub inflections: InflectionStrategy,
}

const PROFILES: [AnalysisProfile; 28] = [
    profile("ko", BoundaryStrategy::Compact, InflectionStrategy::Korean),
    profile("en", BoundaryStrategy::Words, InflectionStrategy::English),
    profile(
        "ja",
        BoundaryStrategy::Compact,
        InflectionStrategy::Japanese,
    ),
    profile("zh", BoundaryStrategy::Compact, InflectionStrategy::Exact),
    profile(
        "zh-Hant",
        BoundaryStrategy::Compact,
        InflectionStrategy::Exact,
    ),
    profile("pt-BR", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("es-419", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("de", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("fr", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("id", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("hi", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("vi", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("pl", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("ru", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("uk", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("tr", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("ar", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("it", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("nl", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("ms", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("th", BoundaryStrategy::Compact, InflectionStrategy::Exact),
    profile("fil", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("bn", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("ur", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("ta", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("fa", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("he", BoundaryStrategy::Words, InflectionStrategy::Exact),
    profile("cs", BoundaryStrategy::Words, InflectionStrategy::Exact),
];

const fn profile(
    language: &'static str,
    boundaries: BoundaryStrategy,
    inflections: InflectionStrategy,
) -> AnalysisProfile {
    AnalysisProfile {
        language,
        boundaries,
        inflections,
    }
}

pub fn analysis_profile(language: &str) -> Option<&'static AnalysisProfile> {
    PROFILES.iter().find(|profile| profile.language == language)
}

pub fn normalize_segmentation_query(query: &str, language: &str) -> String {
    if language != "ko" {
        return query.to_string();
    }

    // The aliases only restore omitted spacing or a conventional colloquial
    // contraction. They never create a definition; every restored term still
    // has to exist in the installed dictionary.
    query
        .replace("왤케", "왜 이렇게")
        .replace("왜케", "왜 이렇게")
        .replace("거같", "거 같")
        .replace("것같", "것 같")
}

pub fn inflection_terms(term: &str, language: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut known = HashSet::new();
    match analysis_profile(language).map(|profile| profile.inflections) {
        Some(InflectionStrategy::Japanese) => {
            japanese_inflection_terms(term, &mut terms, &mut known)
        }
        Some(InflectionStrategy::Korean) => korean_inflection_terms(term, &mut terms, &mut known),
        Some(InflectionStrategy::English) => english_inflection_terms(term, &mut terms, &mut known),
        _ => {}
    }
    terms
}

pub fn grammar_spans(query_chars: &[char], language: &str) -> Vec<(usize, usize)> {
    if language != "ko" {
        return Vec::new();
    }

    let mut spans = Vec::new();
    let mut token_start = 0;
    while token_start < query_chars.len() {
        if !query_chars[token_start].is_alphanumeric() {
            token_start += 1;
            continue;
        }
        let mut token_end = token_start + 1;
        while token_end < query_chars.len() && query_chars[token_end].is_alphanumeric() {
            token_end += 1;
        }
        let token = query_chars[token_start..token_end]
            .iter()
            .collect::<String>();
        for ending in KOREAN_GRAMMAR_ENDINGS {
            let ending_length = ending.chars().count();
            if token.chars().count() > ending_length && token.ends_with(ending) {
                spans.push((token_end - ending_length, token_end));
            }
        }
        token_start = token_end;
    }
    spans.sort_unstable();
    spans.dedup();
    spans
}

pub fn single_syllable_inflection_spans(
    query_chars: &[char],
    language: &str,
) -> Vec<(String, usize, usize)> {
    if language != "ko" {
        return Vec::new();
    }
    query_chars
        .iter()
        .enumerate()
        .filter_map(|(index, character)| {
            let base = match character {
                '해' => "하다",
                '돼' => "되다",
                '줘' => "주다",
                '봐' => "보다",
                _ => return None,
            };
            Some((base.to_string(), index, index + 1))
        })
        .collect()
}

pub fn is_attached_grammar_surface(
    query_chars: &[char],
    language: &str,
    term: &str,
    start: usize,
    end: usize,
) -> bool {
    if language != "ko" || start == 0 || end > query_chars.len() {
        return false;
    }
    if query_chars
        .get(start - 1)
        .is_none_or(|character| !character.is_alphanumeric())
    {
        return false;
    }
    grammar_spans(query_chars, language)
        .iter()
        .any(|&(grammar_start, grammar_end)| {
            grammar_start == start
                && grammar_end == end
                && query_chars[start..end].iter().collect::<String>() == term
        })
}

// Only attached surfaces that can also be misleading dictionary headwords live
// here. Ordinary endings are handled by base-form candidates, so treating a
// final syllable such as `지` as free coverage would incorrectly split `이미지`.
const KOREAN_GRAMMAR_ENDINGS: &[&str] = &["거지", "인지", "이지", "인데", "이면", "이고"];

fn push_inflection_term(
    original: &str,
    candidate: String,
    terms: &mut Vec<String>,
    known: &mut HashSet<String>,
) {
    let candidate = candidate.trim().to_lowercase();
    if candidate.chars().count() >= 2 && candidate != original && known.insert(candidate.clone()) {
        terms.push(candidate);
    }
}

fn replace_last_character(value: &str, replacement: char) -> Option<String> {
    let mut characters = value.chars().collect::<Vec<_>>();
    characters.pop()?;
    characters.push(replacement);
    Some(characters.into_iter().collect())
}

fn replace_last_hangul_jongseong(value: &str, expected: u32, replacement: u32) -> Option<String> {
    let mut characters = value.chars().collect::<Vec<_>>();
    let last = *characters.last()? as u32;
    if !(0xAC00..=0xD7A3).contains(&last) || (last - 0xAC00) % 28 != expected {
        return None;
    }
    *characters.last_mut()? = char::from_u32(last - expected + replacement)?;
    Some(characters.into_iter().collect())
}

fn replace_last_hangul_vowel(value: &str, expected: u32, replacement: u32) -> Option<String> {
    let mut characters = value.chars().collect::<Vec<_>>();
    let last = *characters.last()? as u32;
    if !(0xAC00..=0xD7A3).contains(&last) || !(last - 0xAC00).is_multiple_of(28) {
        return None;
    }
    let syllable = last - 0xAC00;
    let vowel = (syllable / 28) % 21;
    if vowel != expected {
        return None;
    }
    *characters.last_mut()? =
        char::from_u32(last + (replacement as i64 - expected as i64) as u32 * 28)?;
    Some(characters.into_iter().collect())
}

fn japanese_godan_i_stem(value: &str) -> Option<String> {
    let replacement = match value.chars().last()? {
        'い' => 'う',
        'き' => 'く',
        'ぎ' => 'ぐ',
        'し' => 'す',
        'ち' => 'つ',
        'に' => 'ぬ',
        'び' => 'ぶ',
        'み' => 'む',
        'り' => 'る',
        _ => return None,
    };
    replace_last_character(value, replacement)
}

fn japanese_inflection_terms(term: &str, terms: &mut Vec<String>, known: &mut HashSet<String>) {
    let mut push = |candidate: String| push_inflection_term(term, candidate, terms, known);
    if let Some(candidate) = japanese_godan_i_stem(term) {
        push(candidate);
    }
    for suffix in ["ませんでした", "ました", "ません", "ます"] {
        if let Some(stem) = term.strip_suffix(suffix) {
            push(format!("{stem}る"));
            if let Some(candidate) = japanese_godan_i_stem(stem) {
                push(candidate);
            }
        }
    }
    for (suffix, endings) in [
        ("って", &['う', 'つ', 'る'][..]),
        ("った", &['う', 'つ', 'る'][..]),
        ("いて", &['く'][..]),
        ("いた", &['く'][..]),
        ("いで", &['ぐ'][..]),
        ("いだ", &['ぐ'][..]),
        ("んで", &['ぬ', 'ぶ', 'む'][..]),
        ("んだ", &['ぬ', 'ぶ', 'む'][..]),
        ("して", &['す'][..]),
        ("した", &['す'][..]),
    ] {
        if let Some(stem) = term.strip_suffix(suffix) {
            for ending in endings {
                push(format!("{stem}{ending}"));
            }
            if matches!(suffix, "して" | "した") {
                push(format!("{stem}する"));
            }
        }
    }
    for suffix in ["なかった", "ない", "て", "た"] {
        if let Some(stem) = term.strip_suffix(suffix) {
            push(format!("{stem}る"));
        }
    }
    for (suffix, ending) in [
        ("わない", 'う'),
        ("かない", 'く'),
        ("がない", 'ぐ'),
        ("さない", 'す'),
        ("たない", 'つ'),
        ("なない", 'ぬ'),
        ("ばない", 'ぶ'),
        ("まない", 'む'),
        ("らない", 'る'),
    ] {
        if let Some(stem) = term.strip_suffix(suffix) {
            push(format!("{stem}{ending}"));
        }
    }
    for suffix in ["くなかった", "くない", "かった", "ければ", "く"] {
        if let Some(stem) = term.strip_suffix(suffix) {
            push(format!("{stem}い"));
        }
    }
    for (surface, base) in [
        ("した", "する"),
        ("して", "する"),
        ("します", "する"),
        ("しました", "する"),
        ("しない", "する"),
        ("来た", "来る"),
        ("来て", "来る"),
    ] {
        if term == surface {
            push(base.to_string());
        }
    }
}

fn korean_inflection_terms(term: &str, terms: &mut Vec<String>, known: &mut HashSet<String>) {
    let mut push = |candidate: String| push_inflection_term(term, candidate, terms, known);
    for (surface, base) in [
        ("했어요", "하다"),
        ("했다", "하다"),
        ("했었어", "하다"),
        ("했었어요", "하다"),
        ("해요", "하다"),
        ("해", "하다"),
        ("합니다", "하다"),
        ("했습니다", "하다"),
        ("됐어요", "되다"),
        ("됐다", "되다"),
        ("돼", "되다"),
        ("줘", "주다"),
        ("줘요", "주다"),
        ("봐", "보다"),
        ("봐요", "보다"),
        ("였어", "이다"),
        ("였었어", "이다"),
        ("그런", "그렇다"),
        ("이런", "이렇다"),
        ("저런", "저렇다"),
        ("같애", "같다"),
        ("같애요", "같다"),
    ] {
        if term == surface {
            push(base.to_string());
        }
    }

    for suffix in [
        "했었어요",
        "했었어",
        "했습니다",
        "했어요",
        "했어",
        "했다",
        "해서",
        "해요",
        "해도",
        "해",
    ] {
        if let Some(stem) = term.strip_suffix(suffix) {
            push(format!("{stem}하다"));
        }
    }

    for suffix in [
        "었습니다",
        "았습니다",
        "었었어요",
        "았었어요",
        "었었어",
        "았었어",
        "겠습니다",
        "겠어요",
        "겠어",
        "습니까",
        "습니다",
        "었어요",
        "았어요",
        "었어",
        "았어",
        "네요",
        "군요",
        "구나",
        "잖아요",
        "잖아",
        "어요",
        "아요",
        "는다",
        "었다",
        "았다",
        "더라",
        "는데요",
        "은데요",
        "는데",
        "은데",
        "던데",
        "니까",
        "냐고",
        "고",
        "며",
        "면",
        "자",
        "네",
        "군",
        "냐",
        "니",
        "지",
    ] {
        if let Some(stem) = term.strip_suffix(suffix) {
            push(format!("{stem}다"));
        }
    }

    for suffix in ["워요", "와요", "웠어요", "왔어요", "워", "와", "운", "운데"] {
        if let Some(stem) = term.strip_suffix(suffix) {
            if let Some(stem) = replace_last_hangul_jongseong(stem, 0, 17) {
                push(format!("{stem}다"));
            }
        }
    }

    for suffix in ["라요", "러요", "랐어요", "렀어요", "라", "러"] {
        if let Some(stem) = term.strip_suffix(suffix) {
            if let Some(stem) = replace_last_hangul_jongseong(stem, 8, 0) {
                push(format!("{stem}르다"));
            }
        }
    }

    for suffix in ["어요", "어"] {
        if let Some(stem) = term.strip_suffix(suffix) {
            if let Some(stem) = replace_last_hangul_jongseong(stem, 8, 7) {
                push(format!("{stem}다"));
            }
        }
    }

    if let Some(surface) = term.strip_suffix('요').or(Some(term)) {
        // ㅡ 탈락: 쓰다→써요, 크다→커요. Candidate existence in the
        // installed dictionary resolves lexical ambiguity.
        if let Some(stem) = replace_last_hangul_vowel(surface, 4, 18) {
            push(format!("{stem}다"));
        }
    }

    if let Some(stem) = term.strip_suffix('요') {
        push(format!("{stem}다"));
    }
    for particle in [
        "으로", "에서", "에게", "한테", "까지", "부터", "처럼", "보다", "께서", "은", "는", "이",
        "가", "을", "를", "의", "에", "도", "와", "과", "로", "만", "께", "쯤",
    ] {
        if let Some(stem) = term.strip_suffix(particle) {
            push(stem.to_string());
        }
    }
}

fn english_inflection_terms(term: &str, terms: &mut Vec<String>, known: &mut HashSet<String>) {
    let mut push = |candidate: String| push_inflection_term(term, candidate, terms, known);
    if let Some(base) = [
        ("went", "go"),
        ("gone", "go"),
        ("was", "be"),
        ("were", "be"),
        ("been", "be"),
        ("did", "do"),
        ("done", "do"),
        ("had", "have"),
        ("made", "make"),
        ("took", "take"),
        ("taken", "take"),
        ("came", "come"),
        ("saw", "see"),
        ("seen", "see"),
    ]
    .iter()
    .find_map(|(surface, base)| (*surface == term).then_some(*base))
    {
        push(base.to_string());
    }
    if let Some(stem) = term.strip_suffix("ies") {
        push(format!("{stem}y"));
    }
    if let Some(stem) = term.strip_suffix('s') {
        push(stem.to_string());
    }
    if let Some(stem) = term.strip_suffix("es") {
        push(stem.to_string());
        push(format!("{stem}e"));
    }
    for suffix in ["ing", "ed"] {
        if let Some(stem) = term.strip_suffix(suffix) {
            push(stem.to_string());
            push(format!("{stem}e"));
            let characters = stem.chars().collect::<Vec<_>>();
            if characters.len() >= 2
                && characters[characters.len() - 1] == characters[characters.len() - 2]
            {
                push(characters[..characters.len() - 1].iter().collect());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        analysis_profile, grammar_spans, inflection_terms, normalize_segmentation_query,
        BoundaryStrategy, PROFILES,
    };
    use crate::language::SUPPORTED_LANGUAGES;

    #[test]
    fn every_product_language_has_one_analysis_profile() {
        assert_eq!(PROFILES.len(), SUPPORTED_LANGUAGES.len());
        for language in SUPPORTED_LANGUAGES {
            let profile = analysis_profile(language.code())
                .unwrap_or_else(|| panic!("missing morphology profile for {}", language.code()));
            assert_eq!(profile.language, language.code());
        }
    }

    #[test]
    fn compact_profiles_cover_languages_without_reliable_spaces() {
        for language in ["ko", "ja", "zh", "zh-Hant", "th"] {
            assert_eq!(
                analysis_profile(language).unwrap().boundaries,
                BoundaryStrategy::Compact
            );
        }
    }

    #[test]
    fn korean_rules_are_declarative_and_keep_grammar_out_of_headwords() {
        assert!(inflection_terms("귀엽네", "ko").contains(&"귀엽다".to_string()));
        assert!(inflection_terms("주냐", "ko").contains(&"주다".to_string()));
        for (surface, base) in [
            ("귀여워요", "귀엽다"),
            ("추운데", "춥다"),
            ("몰라요", "모르다"),
            ("써요", "쓰다"),
            ("도와", "돕다"),
        ] {
            assert!(
                inflection_terms(surface, "ko").contains(&base.to_string()),
                "{surface} should produce {base}"
            );
        }
        assert_eq!(
            normalize_segmentation_query("왤케 자주해주냐", "ko"),
            "왜 이렇게 자주해주냐"
        );
        let chars = "무슨조건이지".chars().collect::<Vec<_>>();
        assert!(grammar_spans(&chars, "ko").contains(&(4, 6)));
    }
}
