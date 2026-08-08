mod deepl;
mod mock;
pub mod protected_text;
mod service;

use crate::language::Language;

pub use deepl::DeepLTranslator;
pub use mock::{MockTranslator, OriginalTranslator};
pub use service::TranslationService;

pub trait Translator: Send {
    fn display_name(&self) -> &str;
    fn cache_namespace(&self) -> &str;
    fn sends_text_externally(&self) -> bool {
        false
    }
    fn translate(
        &mut self,
        text: &str,
        source: Language,
        target: Language,
    ) -> Result<String, String>;
    fn translate_many(
        &mut self,
        items: &[(String, Language)],
        target: Language,
    ) -> Result<Vec<String>, String> {
        items
            .iter()
            .map(|(text, source)| self.translate(text, *source, target))
            .collect()
    }
    fn prepare(&mut self) -> Result<(), String> {
        Ok(())
    }
    fn should_cache(
        &self,
        _source_text: &str,
        _translated_text: &str,
        _source: Language,
        _target: Language,
    ) -> bool {
        true
    }
    fn model_is_ready(&self) -> bool {
        true
    }
    fn close(&mut self) {}
}
