#[derive(Clone, Debug, PartialEq)]
enum FormatPart {
    Literal(String),
    Translatable(String),
}

#[derive(Clone, Debug, PartialEq)]
pub struct DiscordFormatTemplate {
    parts: Vec<FormatPart>,
}

impl DiscordFormatTemplate {
    pub fn parse(source: &str) -> Self {
        let mut template = Self { parts: Vec::new() };
        let mut cursor = 0;
        let mut fenced_code = false;

        while cursor < source.len() {
            let (content_end, line_end) = line_boundaries(source, cursor);
            let line = &source[cursor..content_end];
            let ending = &source[content_end..line_end];

            if fenced_code {
                template.push_literal(line);
                if fence_run(line).is_some() {
                    fenced_code = false;
                }
            } else if let Some((marker_start, marker_end)) = fence_run(line) {
                template.push_literal(line);
                let marker = &line[marker_start..marker_end];
                if !line[marker_end..].contains(marker) {
                    fenced_code = true;
                }
            } else {
                template.parse_formatted_line(line);
            }
            template.push_literal(ending);
            cursor = line_end;
        }

        Self {
            parts: template.parts,
        }
    }

    pub fn translatable_texts(&self) -> Vec<String> {
        self.parts
            .iter()
            .filter_map(|part| match part {
                FormatPart::Translatable(text) => Some(text.clone()),
                FormatPart::Literal(_) => None,
            })
            .collect()
    }

    pub fn render(&self, translated: &[String]) -> Result<String, String> {
        let expected = self
            .parts
            .iter()
            .filter(|part| matches!(part, FormatPart::Translatable(_)))
            .count();
        if translated.len() != expected {
            return Err("Discord 서식을 복원할 번역문 수가 올바르지 않습니다.".to_string());
        }

        let mut output = String::new();
        let mut translations = translated.iter();
        for part in &self.parts {
            match part {
                FormatPart::Literal(text) => output.push_str(text),
                FormatPart::Translatable(_) => output.push_str(
                    translations
                        .next()
                        .expect("validated Discord translation segment count"),
                ),
            }
        }
        Ok(output)
    }

    fn parse_formatted_line(&mut self, line: &str) {
        let prefix_end = discord_line_prefix_end(line);
        self.push_literal(&line[..prefix_end]);
        self.parse_inline(&line[prefix_end..]);
    }

    fn parse_inline(&mut self, text: &str) {
        let mut cursor = 0;
        let mut translatable_start = 0;

        while cursor < text.len() {
            let Some(literal_end) = inline_literal_end(text, cursor) else {
                cursor += text[cursor..]
                    .chars()
                    .next()
                    .expect("cursor is inside text")
                    .len_utf8();
                continue;
            };

            if translatable_start < cursor {
                self.push_translatable(&text[translatable_start..cursor]);
            }

            if text[cursor..].starts_with('[') {
                if let Some(link) = markdown_link_at(text, cursor) {
                    self.push_literal("[");
                    self.parse_inline(&text[link.label_start..link.label_end]);
                    self.push_literal(&text[link.label_end..link.end]);
                    cursor = link.end;
                    translatable_start = cursor;
                    continue;
                }
            }

            self.push_literal(&text[cursor..literal_end]);
            cursor = literal_end;
            translatable_start = cursor;
        }

        if translatable_start < text.len() {
            self.push_translatable(&text[translatable_start..]);
        }
    }

    fn push_literal(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }
        if let Some(FormatPart::Literal(previous)) = self.parts.last_mut() {
            previous.push_str(text);
        } else {
            self.parts.push(FormatPart::Literal(text.to_string()));
        }
    }

    fn push_translatable(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }
        let leading_end = text
            .char_indices()
            .find(|(_, character)| !character.is_whitespace())
            .map(|(index, _)| index)
            .unwrap_or(text.len());
        let trailing_start = text
            .char_indices()
            .rev()
            .find(|(_, character)| !character.is_whitespace())
            .map(|(index, character)| index + character.len_utf8())
            .unwrap_or(leading_end);

        self.push_literal(&text[..leading_end]);
        if leading_end < trailing_start {
            self.parts.push(FormatPart::Translatable(
                text[leading_end..trailing_start].to_string(),
            ));
        }
        self.push_literal(&text[trailing_start..]);
    }
}

fn line_boundaries(text: &str, start: usize) -> (usize, usize) {
    let remainder = &text[start..];
    for (offset, character) in remainder.char_indices() {
        if character == '\n' {
            return (start + offset, start + offset + 1);
        }
        if character == '\r' {
            let content_end = start + offset;
            let line_end = if text[content_end..].starts_with("\r\n") {
                content_end + 2
            } else {
                content_end + 1
            };
            return (content_end, line_end);
        }
    }
    (text.len(), text.len())
}

fn fence_run(line: &str) -> Option<(usize, usize)> {
    let start = line.len() - line.trim_start_matches([' ', '\t']).len();
    let ticks = line[start..]
        .chars()
        .take_while(|character| *character == '`')
        .count();
    (ticks >= 3).then_some((start, start + ticks))
}

fn discord_line_prefix_end(line: &str) -> usize {
    let mut cursor = leading_ascii_whitespace_end(line, 0);

    loop {
        let remainder = &line[cursor..];
        let marker_len = if remainder.starts_with("-#") {
            2
        } else if remainder.starts_with(">>>") {
            3
        } else if remainder.starts_with('>') {
            1
        } else {
            let hashes = remainder
                .chars()
                .take_while(|character| *character == '#')
                .count();
            if (1..=3).contains(&hashes) {
                hashes
            } else if remainder.starts_with(['-', '+', '*']) {
                1
            } else {
                ordered_list_marker_len(remainder).unwrap_or(0)
            }
        };
        if marker_len == 0 {
            break;
        }
        let after_marker = cursor + marker_len;
        let after_space = leading_ascii_whitespace_end(line, after_marker);
        if after_space == after_marker {
            break;
        }
        cursor = after_space;
    }

    cursor
}

fn leading_ascii_whitespace_end(text: &str, start: usize) -> usize {
    let mut cursor = start;
    while let Some(character) = text[cursor..].chars().next() {
        if !matches!(character, ' ' | '\t') {
            break;
        }
        cursor += character.len_utf8();
    }
    cursor
}

fn ordered_list_marker_len(text: &str) -> Option<usize> {
    let digits = text
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .count();
    if digits == 0 {
        return None;
    }
    matches!(text.as_bytes().get(digits), Some(b'.' | b')')).then_some(digits + 1)
}

fn inline_literal_end(text: &str, start: usize) -> Option<usize> {
    let remainder = &text[start..];
    if remainder.starts_with('\\') {
        let mut characters = remainder.char_indices();
        characters.next();
        return Some(
            characters
                .next()
                .map(|(index, character)| start + index + character.len_utf8())
                .unwrap_or(start + 1),
        );
    }
    if remainder.starts_with('`') {
        let ticks = remainder
            .chars()
            .take_while(|character| *character == '`')
            .count();
        let marker = &remainder[..ticks];
        return remainder[ticks..]
            .find(marker)
            .map(|offset| start + ticks + offset + ticks)
            .or(Some(start + ticks));
    }
    if remainder.starts_with('<') {
        if let Some(end) = remainder.find('>') {
            return Some(start + end + 1);
        }
    }
    if remainder.starts_with("http://") || remainder.starts_with("https://") {
        let end = remainder
            .char_indices()
            .find(|(_, character)| {
                character.is_whitespace() || matches!(character, '<' | '>' | '"' | '\'')
            })
            .map(|(index, _)| index)
            .unwrap_or(remainder.len());
        return Some(start + end);
    }
    if remainder.starts_with('[') && markdown_link_at(text, start).is_some() {
        return markdown_link_at(text, start).map(|link| link.end);
    }
    for delimiter in ["***", "___", "**", "__", "~~", "||", "*", "_"] {
        if remainder.starts_with(delimiter) {
            return Some(start + delimiter.len());
        }
    }
    None
}

#[derive(Clone, Copy, Debug)]
struct MarkdownLink {
    label_start: usize,
    label_end: usize,
    end: usize,
}

fn markdown_link_at(text: &str, start: usize) -> Option<MarkdownLink> {
    let remainder = &text[start..];
    if !remainder.starts_with('[') {
        return None;
    }
    let label_end_relative = remainder.find("](")?;
    let destination_start = label_end_relative + 2;
    let destination = &remainder[destination_start..];
    let mut depth = 0_usize;
    let mut escaped = false;
    for (offset, character) in destination.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        if character == '(' {
            depth += 1;
        } else if character == ')' {
            if depth == 0 {
                return Some(MarkdownLink {
                    label_start: start + 1,
                    label_end: start + label_end_relative,
                    end: start + destination_start + offset + 1,
                });
            }
            depth -= 1;
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::DiscordFormatTemplate;

    #[test]
    fn preserves_empty_lines_and_mixed_line_endings() {
        let template = DiscordFormatTemplate::parse("첫 줄\r\n\r\n둘째\n셋째\r마지막");
        let texts = template.translatable_texts();
        assert_eq!(texts, ["첫 줄", "둘째", "셋째", "마지막"]);
        assert_eq!(
            template
                .render(&["1".into(), "2".into(), "3".into(), "4".into()])
                .unwrap(),
            "1\r\n\r\n2\n3\r4"
        );
    }

    #[test]
    fn keeps_inline_and_fenced_code_out_of_translation() {
        let source = "문장 `inline()`\n```rust\nlet value = true;\n```\n끝";
        let template = DiscordFormatTemplate::parse(source);
        assert_eq!(template.translatable_texts(), ["문장", "끝"]);
        assert_eq!(
            template.render(&["本文".into(), "終わり".into()]).unwrap(),
            "本文 `inline()`\n```rust\nlet value = true;\n```\n終わり"
        );
    }
}
