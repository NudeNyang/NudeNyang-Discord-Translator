use crate::language::Language;

use super::Translator;

pub struct OriginalTranslator;

impl Translator for OriginalTranslator {
    fn display_name(&self) -> &str {
        "원문 표시"
    }

    fn cache_namespace(&self) -> &str {
        "original:v1"
    }

    fn translate(
        &mut self,
        text: &str,
        _source: Language,
        _target: Language,
    ) -> Result<String, String> {
        Ok(text.to_string())
    }
}

pub struct MockTranslator;

impl Translator for MockTranslator {
    fn display_name(&self) -> &str {
        "Mock (테스트)"
    }

    fn cache_namespace(&self) -> &str {
        "mock:v1"
    }

    fn translate(
        &mut self,
        text: &str,
        source: Language,
        target: Language,
    ) -> Result<String, String> {
        if source == target {
            Ok(text.to_string())
        } else {
            Ok(format!("[{}] {text}", target.code()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{MockTranslator, Translator};
    use crate::language::Language;

    #[test]
    fn mock_translator_preserves_same_language_and_marks_targets() {
        let mut translator = MockTranslator;
        assert_eq!(
            translator
                .translate("hello", Language::English, Language::English)
                .unwrap(),
            "hello"
        );
        assert_eq!(
            translator
                .translate("hello", Language::English, Language::Korean)
                .unwrap(),
            "[ko] hello"
        );
    }
}
