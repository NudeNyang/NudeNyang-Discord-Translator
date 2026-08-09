pub fn split_for_translation(text: &str, max_chars: usize) -> Vec<String> {
    split_with_limit(text, max_chars, |_| 1)
}

pub fn split_for_discord(text: &str, max_utf16_units: usize) -> Vec<String> {
    split_with_limit(text, max_utf16_units, char::len_utf16)
}

fn split_with_limit(
    text: &str,
    max_units: usize,
    units_for_char: impl Fn(char) -> usize + Copy,
) -> Vec<String> {
    if text.is_empty() {
        return vec![String::new()];
    }
    if max_units == 0 {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut start = 0;
    while start < text.len() {
        let remainder = &text[start..];
        if let Some(paragraph_end) = paragraph_boundary(remainder) {
            if remainder[..paragraph_end]
                .chars()
                .map(units_for_char)
                .sum::<usize>()
                <= max_units
            {
                chunks.push(remainder[..paragraph_end].to_string());
                start += paragraph_end;
                continue;
            }
        }
        if remainder.chars().map(units_for_char).sum::<usize>() <= max_units {
            chunks.push(remainder.to_string());
            break;
        }

        let end = preferred_boundary(remainder, max_units, units_for_char);
        chunks.push(remainder[..end].to_string());
        start += end;
    }
    chunks
}

fn paragraph_boundary(text: &str) -> Option<usize> {
    let mut newline_count = 0;
    for (byte_index, ch) in text.char_indices() {
        if matches!(ch, '\n' | '\r') {
            newline_count += 1;
            let end = byte_index + ch.len_utf8();
            if newline_count >= 2 && end < text.len() {
                return Some(end);
            }
        } else {
            newline_count = 0;
        }
    }
    None
}

fn preferred_boundary(
    text: &str,
    max_units: usize,
    units_for_char: impl Fn(char) -> usize + Copy,
) -> usize {
    let chars = text.char_indices().collect::<Vec<_>>();
    let mut used = 0;
    let mut hard_end = 0;
    let mut best = None::<(u8, usize)>;

    for (index, &(byte_index, ch)) in chars.iter().enumerate() {
        let units = units_for_char(ch);
        if used + units > max_units {
            break;
        }
        used += units;
        hard_end = byte_index + ch.len_utf8();

        let next = chars.get(index + 1).map(|(_, next)| *next);
        let priority = if ch == '\n' || ch == '\r' {
            3
        } else if is_sentence_terminal(ch) && next.is_some_and(char::is_whitespace) {
            2
        } else if ch.is_whitespace() {
            let previous = index.checked_sub(1).map(|previous| chars[previous].1);
            if previous.is_some_and(is_sentence_terminal) {
                2
            } else {
                1
            }
        } else {
            0
        };

        if priority > 0 && best.is_none_or(|(best_priority, _)| priority >= best_priority) {
            best = Some((priority, hard_end));
        }
    }

    best.map(|(_, end)| end).unwrap_or(hard_end)
}

fn is_sentence_terminal(ch: char) -> bool {
    matches!(ch, '.' | '?' | '!' | '。' | '？' | '！' | '…')
}

#[cfg(test)]
mod tests {
    use super::{split_for_discord, split_for_translation};

    #[test]
    fn translation_chunks_rejoin_exactly_and_prefer_sentence_boundaries() {
        let source = "첫 번째 문장입니다. 두 번째 문장도 있습니다.\n\n새 문단입니다.";
        let chunks = split_for_translation(source, 24);
        assert!(chunks.len() >= 3, "unexpected chunks: {chunks:?}");
        assert_eq!(chunks.concat(), source);
        assert!(chunks.iter().all(|chunk| chunk.chars().count() <= 24));
        assert!(chunks[0].ends_with(". "));
    }

    #[test]
    fn discord_chunks_use_utf16_units_and_preserve_every_character() {
        let source = format!(
            "{} 문장 하나. {} 문장 둘.",
            "🐾".repeat(8),
            "번역".repeat(8)
        );
        let chunks = split_for_discord(&source, 20);
        assert!(chunks.len() >= 3, "unexpected chunks: {chunks:?}");
        assert_eq!(chunks.concat(), source);
        assert!(
            chunks
                .iter()
                .all(|chunk| chunk.encode_utf16().count() <= 20),
            "oversized chunks: {chunks:?}"
        );
    }

    #[test]
    fn an_unbroken_word_is_split_without_breaking_unicode() {
        let source = "가나다라마바사아자차카타파하";
        let chunks = split_for_translation(source, 5);
        assert_eq!(chunks.concat(), source);
        assert!(chunks.iter().all(|chunk| chunk.chars().count() <= 5));
    }
}
