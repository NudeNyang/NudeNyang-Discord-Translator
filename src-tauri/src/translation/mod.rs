// CodeBuddy provider: the response contract lives in `codebuddy`, the process lifecycle in
// `codebuddy_cli`.
mod codebuddy;
mod codebuddy_cli;
mod deepl;
mod discord_format;
pub mod hymt;
mod local_model;
mod mock;
mod openai_compat;
pub mod protected_text;
mod resilient;
mod service;
mod subscription_cli;

use crate::language::Language;

pub use codebuddy_cli::{
    available_models as codebuddy_available_models, cli_is_installed as codebuddy_cli_is_installed,
    login_is_verified as codebuddy_login_is_verified, verify_login as verify_codebuddy_login,
    CodeBuddyCliTranslator,
};
pub use deepl::DeepLTranslator;
pub use hymt::{
    delete_cached_local_model, local_model_storage_root, local_model_storage_status, HyMtModelSize,
    HyMtTranslator, LocalModelDeleteResult, LocalModelStorageStatus, ModelPreparationCancellation,
    ModelPreparationProgress, ModelProgressObserver,
};
#[cfg(test)]
pub use mock::progress as mock_progress;
pub use mock::{MockTranslator, OriginalTranslator};
pub use openai_compat::{
    normalize_base_url as normalize_openai_compat_base_url, OpenAiCompatSettings,
    OpenAiCompatTranslator, CREDENTIAL_ID as OPENAI_COMPAT_CREDENTIAL_ID,
};
pub use resilient::{translation_needs_repair, ResilientTranslator};
pub(crate) use service::QUALITY_REJECTED_ERROR;
pub use service::{outgoing_can_passthrough, TranslationService, WebTranslationSession};
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
    /// Can this provider process a request without creating local content files?
    /// External CLI tools must opt in only after their storage paths are verified.
    fn supports_ephemeral_requests(&self) -> bool {
        !self.sends_text_externally()
    }
    /// Whether the engine may retry a rejected incoming translation against the
    /// same provider. Providers that opt out keep a single provider pass.
    fn allows_quality_retries(&self) -> bool {
        true
    }
    fn isolate_incoming_failures(&self) -> bool {
        false
    }
    /// How many complete incoming message contexts may share one display batch
    /// before the worker yields. The engine also caps the combined size, so a
    /// larger value never splits or overflows a single message context.
    fn preferred_incoming_batch_contexts(&self) -> usize {
        1
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
    /// Providers with their own omission repair inference follow the global switch.
    fn set_omission_check(&mut self, _enabled: bool) {}
    fn omission_check_enabled(&self) -> bool {
        true
    }
    fn close(&mut self) {}
}
