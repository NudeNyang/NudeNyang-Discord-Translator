use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

type LocaleDictionary = HashMap<String, HashMap<String, String>>;

const SUPPORTED_UI_LANGUAGES: [&str; 28] = [
    "ko", "en", "ja", "zh", "zh-Hant", "pt-BR", "hi", "es-419", "de", "ru", "id", "fr", "tr", "ar",
    "vi", "it", "pl", "uk", "ms", "nl", "th", "fil", "bn", "ur", "ta", "fa", "he", "cs",
];

pub fn resolve_ui_language(configured: &str) -> &'static str {
    if configured.eq_ignore_ascii_case("auto") {
        return canonical_ui_language(&system_ui_language());
    }
    canonical_ui_language(configured)
}

fn canonical_ui_language(language: &str) -> &'static str {
    let normalized = language.trim().replace('_', "-").to_lowercase();
    if normalized.starts_with("zh") {
        let traditional = normalized.split('-').any(|part| part == "hant")
            || ["zh-tw", "zh-hk", "zh-mo"].iter().any(|prefix| {
                normalized == *prefix || normalized.starts_with(&format!("{prefix}-"))
            });
        return if traditional { "zh-Hant" } else { "zh" };
    }
    if normalized.starts_with("pt") {
        return "pt-BR";
    }
    if normalized.starts_with("es") {
        return "es-419";
    }
    if normalized == "in" || normalized.starts_with("in-") {
        return "id";
    }
    SUPPORTED_UI_LANGUAGES
        .iter()
        .copied()
        .find(|code| {
            let code = code.to_lowercase();
            normalized == code || normalized.starts_with(&format!("{code}-"))
        })
        .unwrap_or("en")
}

#[cfg(windows)]
fn system_ui_language() -> String {
    use windows::Win32::Globalization::GetUserDefaultLocaleName;

    const LOCALE_NAME_CAPACITY: usize = 85;
    let mut buffer = [0_u16; LOCALE_NAME_CAPACITY];
    let length = unsafe { GetUserDefaultLocaleName(&mut buffer) };
    if length <= 1 {
        return "en".to_string();
    }
    String::from_utf16_lossy(&buffer[..length as usize - 1])
}

#[cfg(not(windows))]
fn system_ui_language() -> String {
    "en".to_string()
}

fn generated_locale_dictionary() -> &'static LocaleDictionary {
    static DICTIONARY: OnceLock<LocaleDictionary> = OnceLock::new();
    DICTIONARY.get_or_init(|| {
        serde_json::from_str(include_str!("../../web/ui-locales.json"))
            .expect("generated interface locale dictionary must be valid JSON")
    })
}

pub fn generated_copies(entries: &[(&str, &str)]) -> BTreeMap<String, BTreeMap<String, String>> {
    generated_locale_dictionary()
        .iter()
        .map(|(locale, dictionary)| {
            let copies = entries
                .iter()
                .filter_map(|(key, korean)| {
                    dictionary
                        .get(*korean)
                        .map(|translated| ((*key).to_string(), translated.clone()))
                })
                .collect();
            (locale.clone(), copies)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::canonical_ui_language;

    #[test]
    fn interface_language_codes_match_the_web_ui_resolution_rules() {
        for (input, expected) in [
            ("ko-KR", "ko"),
            ("en-US", "en"),
            ("ja-JP", "ja"),
            ("zh-CN", "zh"),
            ("zh_TW", "zh-Hant"),
            ("pt-PT", "pt-BR"),
            ("es-MX", "es-419"),
            ("in-ID", "id"),
            ("ar-SA", "ar"),
            ("unknown", "en"),
        ] {
            assert_eq!(canonical_ui_language(input), expected, "{input}");
        }
    }
}
