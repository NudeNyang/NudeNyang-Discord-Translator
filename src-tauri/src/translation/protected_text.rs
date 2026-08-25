use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;

const MARKER_PREFIX: &str = "ZXQKEEP";
const MARKER_SUFFIX: &str = "QXZ";
const KAOMOJI_HINTS: &str = "^;:°ωツづノಠಥ益Д▽∀・´｀≧≤＞＜ㅅㅇ";

static MENTION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)@(?:[A-Za-z0-9_.-]+|全員|各位|여러분)").unwrap());
static CHANNEL_TAG_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[『「]?#[\p{L}\p{M}\p{N}_.-]{2,}[』」]?").unwrap());
static URL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)\bhttps?://[^\s<>"']+"#).unwrap());
static CUSTOM_EMOJI_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r":[A-Za-z0-9_~.-]{2,32}:").unwrap());
static ASCII_EMOTICON_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?:[:;=8][-~^']?[()DPOp/\\]|[xX][dD]|[Tt][_.-][Tt]|\^[_ .-]?\^|[ㅠㅜ]{2,}|ㅇㅅㅇ|ㅋ{2,}|ㅎ{2,})",
    )
    .unwrap()
});
static SHRUG_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:¯\\?_\([ツづ]?\)_/¯|¯\\_\([^\n]{1,12}\)_/¯)").unwrap());
static KAOMOJI_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[（(][^()（）\n]{1,24}[）)]").unwrap());
static BOW_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)m\(\s*[_＿]{1,4}\s*\)m").unwrap());
static CHAT_FACE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:[ωwWνvV][·・.'’`]*[)'）]+|[・･][ωwWνvV^＾]+[・･]|>(?:[_＿]|く|＜)[;；]?)")
        .unwrap()
});
static EMOJI_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?:[©®‼⁉™ℹ↔-⇿⌀-⏿①-⓿■-➿⤴-⤵⬀-⯿〰〽㊗㊙\u{1F1E6}-\u{1FAFF}](?:[︎️])?(?:[\u{1F3FB}-\u{1F3FF}])?(?:‍[©®‼⁉™ℹ↔-⇿⌀-⏿①-⓿■-➿⤴-⤵⬀-⯿〰〽㊗㊙\u{1F1E6}-\u{1FAFF}](?:[︎️])?(?:[\u{1F3FB}-\u{1F3FF}])?)*|[0-9#*][︎️]?⃣)",
    )
    .unwrap()
});
static MARKER_ARTIFACT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\bZ\s*X\s*Q\s*KEEP(?:\s*0*\d{1,3})?(?:\s*Q(?:\s*X(?:\s*Z)?)?)?\b").unwrap()
});
static REPEATED_HORIZONTAL_SPACE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[ \t]{2,}").unwrap());

#[derive(Clone, Debug, PartialEq)]
pub struct ProtectedText {
    pub original: String,
    pub masked: String,
    pub tokens: Vec<String>,
}

impl ProtectedText {
    pub fn has_translatable_text(&self) -> bool {
        let mut remainder = self.masked.clone();
        for index in 0..self.tokens.len() {
            remainder = remainder.replace(&marker(index), "");
        }
        let letter_count = remainder
            .chars()
            .filter(|character| character.is_alphanumeric())
            .count();
        let emoticon_dominated = self.tokens.iter().any(|token| is_text_emoticon(token));
        if emoticon_dominated && letter_count <= 3 {
            return false;
        }
        letter_count > 0
    }

    pub fn restore(&self, translated: &str) -> String {
        let mut restored = translated.to_string();
        let mut missing = Vec::new();
        for (index, token) in self.tokens.iter().enumerate() {
            let exact = marker(index);
            if restored.contains(&exact) {
                restored = restored.replace(&exact, token);
                continue;
            }
            let flexible = Regex::new(&format!(r"(?i)Z\s*X\s*Q\s*KEEP\s*0*{}\s*Q\s*X\s*Z", index))
                .expect("marker regex");
            if flexible.is_match(&restored) {
                restored = flexible.replace_all(&restored, token.as_str()).into_owned();
            } else {
                missing.push(token.as_str());
            }
        }
        if !missing.is_empty() {
            if !restored.is_empty() && !restored.ends_with([' ', '\n']) {
                restored.push(' ');
            }
            restored.push_str(&missing.join(" "));
        }
        sanitize_unexpected_marker_artifacts(&self.original, &restored)
    }

    pub fn mask_preserved_tokens_in(&self, text: &str) -> String {
        self.tokens
            .iter()
            .enumerate()
            .fold(text.to_string(), |masked, (index, token)| {
                masked.replacen(token, &marker(index), 1)
            })
    }
}

pub fn contains_unexpected_marker_artifact(source: &str, translated: &str) -> bool {
    !MARKER_ARTIFACT_RE.is_match(source) && MARKER_ARTIFACT_RE.is_match(translated)
}

pub fn sanitize_unexpected_marker_artifacts(source: &str, translated: &str) -> String {
    if !contains_unexpected_marker_artifact(source, translated) {
        return translated.to_string();
    }
    let stripped = MARKER_ARTIFACT_RE.replace_all(translated, "");
    let cleaned = stripped
        .split('\n')
        .map(|line| {
            REPEATED_HORIZONTAL_SPACE_RE
                .replace_all(line, " ")
                .trim_matches([' ', '\t'])
                .to_string()
        })
        .collect::<Vec<_>>()
        .join("\n");
    if cleaned.trim().is_empty() && !source.trim().is_empty() {
        source.to_string()
    } else {
        cleaned
    }
}

pub fn protect_text(text: &str) -> ProtectedText {
    let mut spans = Vec::new();
    for pattern in [
        &*MENTION_RE,
        &*CHANNEL_TAG_RE,
        &*URL_RE,
        &*CUSTOM_EMOJI_RE,
        &*ASCII_EMOTICON_RE,
        &*SHRUG_RE,
        &*BOW_RE,
        &*CHAT_FACE_RE,
        &*EMOJI_RE,
    ] {
        spans.extend(
            pattern
                .find_iter(text)
                .map(|found| (found.start(), found.end())),
        );
    }
    for found in KAOMOJI_RE.find_iter(text) {
        if found
            .as_str()
            .chars()
            .any(|character| KAOMOJI_HINTS.contains(character))
        {
            spans.push((found.start(), found.end()));
        }
    }
    spans.sort_by_key(|(start, end)| (*start, usize::MAX - (*end - *start)));
    let mut selected = Vec::new();
    for (start, end) in spans {
        if selected
            .last()
            .is_some_and(|(_, selected_end)| start < *selected_end)
        {
            continue;
        }
        selected.push((start, end));
    }
    if selected.is_empty() {
        return ProtectedText {
            original: text.to_string(),
            masked: text.to_string(),
            tokens: Vec::new(),
        };
    }

    let mut masked = String::new();
    let mut tokens = Vec::new();
    let mut cursor = 0;
    for (index, (start, end)) in selected.into_iter().enumerate() {
        masked.push_str(&text[cursor..start]);
        masked.push_str(&marker(index));
        tokens.push(text[start..end].to_string());
        cursor = end;
    }
    masked.push_str(&text[cursor..]);
    ProtectedText {
        original: text.to_string(),
        masked,
        tokens,
    }
}

pub fn remove_unwritten_decorations(source: &str, translated: &str) -> String {
    let mut available = HashMap::<String, usize>::new();
    for (start, end) in decoration_spans(source) {
        *available.entry(source[start..end].to_string()).or_default() += 1;
    }

    let spans = decoration_spans(translated);
    if spans.is_empty() {
        return translated.to_string();
    }

    let mut output = String::with_capacity(translated.len());
    let mut cursor = 0;
    let mut removed = false;
    for (start, end) in spans {
        output.push_str(&translated[cursor..start]);
        let token = &translated[start..end];
        if available.get_mut(token).is_some_and(|count| {
            if *count == 0 {
                false
            } else {
                *count -= 1;
                true
            }
        }) {
            output.push_str(token);
        } else {
            removed = true;
        }
        cursor = end;
    }
    output.push_str(&translated[cursor..]);

    if !removed {
        return output;
    }
    output
        .split('\n')
        .map(|line| {
            Regex::new(r"[ \t]{2,}")
                .unwrap()
                .replace_all(line.trim_matches([' ', '\t']), " ")
                .into_owned()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn decoration_spans(text: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    for pattern in [
        &*CUSTOM_EMOJI_RE,
        &*ASCII_EMOTICON_RE,
        &*SHRUG_RE,
        &*BOW_RE,
        &*CHAT_FACE_RE,
        &*EMOJI_RE,
    ] {
        spans.extend(
            pattern
                .find_iter(text)
                .map(|found| (found.start(), found.end())),
        );
    }
    for found in KAOMOJI_RE.find_iter(text) {
        if found
            .as_str()
            .chars()
            .any(|character| KAOMOJI_HINTS.contains(character))
        {
            spans.push((found.start(), found.end()));
        }
    }
    spans.sort_by_key(|(start, end)| (*start, usize::MAX - (*end - *start)));
    let mut selected = Vec::new();
    for (start, end) in spans {
        if selected
            .last()
            .is_some_and(|(_, selected_end)| start < *selected_end)
        {
            continue;
        }
        selected.push((start, end));
    }
    selected
}

fn marker(index: usize) -> String {
    format!("{MARKER_PREFIX}{index:03}{MARKER_SUFFIX}")
}

fn is_text_emoticon(token: &str) -> bool {
    [
        &*ASCII_EMOTICON_RE,
        &*SHRUG_RE,
        &*BOW_RE,
        &*CHAT_FACE_RE,
        &*KAOMOJI_RE,
    ]
    .iter()
    .any(|pattern| {
        pattern
            .find(token)
            .is_some_and(|found| found.as_str() == token)
    })
}

#[cfg(test)]
mod tests {
    use super::{protect_text, remove_unwritten_decorations};

    #[test]
    fn masks_and_restores_mentions_emoji_and_emoticons() {
        let source = "Hello @everyone 👋🏽 :party_blob: ^_^ T_T https://example.com/a?q=1";
        let protected = protect_text(source);
        for token in [
            "@everyone",
            "👋🏽",
            ":party_blob:",
            "^_^",
            "T_T",
            "https://example.com/a?q=1",
        ] {
            assert!(!protected.masked.contains(token));
        }
        assert!(protected.has_translatable_text());
        assert_eq!(
            protected.restore(&format!("[ko] {}", protected.masked)),
            format!("[ko] {source}")
        );
    }

    #[test]
    fn emoji_and_emoticon_dominated_fragments_need_no_translation() {
        let protected = protect_text("👋 (╯°□°)╯ ^_^");
        assert!(!protected.has_translatable_text());
        assert_eq!(protected.restore(&protected.masked), "👋 (╯°□°)╯ ^_^");

        let protected = protect_text("(•ω•)つス.....");
        assert!(protected.tokens.iter().any(|token| token == "(•ω•)"));
        assert!(!protected.has_translatable_text());
    }

    #[test]
    fn missing_markers_are_readded_without_losing_tags() {
        let protected = protect_text("Hello @here");
        assert_eq!(protected.restore("안녕하세요"), "안녕하세요 @here");
    }

    #[test]
    fn non_latin_hashtags_are_preserved_without_hiding_the_surrounding_sentence() {
        let source = "ぜひ『#かぷちやこーで』でポストしてね！";
        let protected = protect_text(source);

        assert_eq!(protected.tokens, ["『#かぷちやこーで』"]);
        assert!(!protected.masked.contains("#かぷちやこーで"));
        assert!(protected.has_translatable_text());
        assert_eq!(
            protected.mask_preserved_tokens_in("꼭 『#かぷちやこーで』로 게시해 주세요!"),
            "꼭 ZXQKEEP000QXZ로 게시해 주세요!"
        );
    }

    #[test]
    fn stray_marker_fragments_never_reach_the_user() {
        let protected = protect_text("Hello 👋");
        assert_eq!(
            protected.restore("Hallo ZXQKEEP ZXQKEEP000 ZXQKEEP000QXZ"),
            "Hallo 👋"
        );
        assert_eq!(
            protected.restore("Hallo Z X Q KEEP ZXQKEEP000QX ZXQKEEP000QXZ"),
            "Hallo 👋"
        );
    }

    #[test]
    fn user_authored_marker_words_are_not_silently_removed() {
        let protected = protect_text("ZXQKEEP is an internal marker");
        assert_eq!(
            protected.restore("ZXQKEEP ist eine interne Markierung"),
            "ZXQKEEP ist eine interne Markierung"
        );
    }

    #[test]
    fn normal_japanese_and_short_text_next_to_emoji_stay_translatable() {
        let plain = protect_text("イベント録画をお願いします");
        assert!(plain.tokens.is_empty());
        assert_eq!(plain.masked, plain.original);
        assert!(protect_text("雑談😊").has_translatable_text());
    }

    #[test]
    fn common_japanese_chat_faces_are_preserved() {
        for source in [
            "ありがとう神様m(__)m",
            "教えてください・\nω·')",
            "本日です！・ν・",
            "把握してないです>く;",
        ] {
            let protected = protect_text(source);
            assert!(!protected.tokens.is_empty(), "{source}");
            assert_eq!(protected.restore(&protected.masked), source);
        }
    }

    #[test]
    fn removes_only_decorations_that_are_absent_from_the_source() {
        assert_eq!(
            remove_unwritten_decorations("なるほど！", "알겠습니다! 🤖"),
            "알겠습니다!"
        );
        assert_eq!(
            remove_unwritten_decorations("なるほど！ 😊", "알겠습니다! 😊 🤖"),
            "알겠습니다! 😊"
        );
        assert_eq!(
            remove_unwritten_decorations("고마워 ^_^", "ありがとう ^_^ :robot:"),
            "ありがとう ^_^"
        );
        assert_eq!(remove_unwritten_decorations("😊", "😊 😊"), "😊");
    }
}
