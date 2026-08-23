mod deepl;
mod discord_format;
pub mod hymt;
mod local_model;
mod mock;
pub mod protected_text;
mod resilient;
mod service;
mod subscription_cli;

use crate::language::Language;

pub use deepl::DeepLTranslator;
pub use hymt::{
    delete_cached_local_model, local_model_storage_root, local_model_storage_status, HyMtModelSize,
    HyMtTranslator, LocalModelDeleteResult, LocalModelStorageStatus, ModelPreparationCancellation,
    ModelPreparationProgress, ModelProgressObserver,
};
pub use mock::{MockTranslator, OriginalTranslator};
pub use resilient::{translation_needs_repair, ResilientTranslator};
pub use service::{outgoing_can_passthrough, TranslationService};
pub use subscription_cli::{
    connect_subscription_interactively_with_observer, install_subscription_cli,
    probe_subscription_connection, CliConnectionProbe, LoginBrowserGate, LoginProcessObserver,
    SubscriptionCliTranslator, SubscriptionProvider,
};

pub trait Translator: Send {
    fn display_name(&self) -> &str;
    fn cache_namespace(&self) -> &str;
    fn sends_text_externally(&self) -> bool {
        false
    }
    fn isolate_incoming_failures(&self) -> bool {
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
    fn translation_is_acceptable(
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
