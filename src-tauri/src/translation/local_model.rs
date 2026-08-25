#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HyMtModelSize {
    Small,
    Large,
    TranslateGemma4B,
}

#[derive(Clone, Copy, Debug)]
pub struct HyMtModel {
    pub key: &'static str,
    pub family: &'static str,
    pub label: &'static str,
    pub repository: &'static str,
    pub filename: &'static str,
    pub expected_bytes: u64,
    pub expected_sha256: &'static str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum LocalPromptStrategy {
    SharedChat,
    OfficialTranslateGemma,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum LocalCompletionApi {
    ChatCompletions,
    RawCompletion,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct LocalModelProfile {
    pub kind: HyMtModelSize,
    pub config_id: &'static str,
    pub runtime_label: &'static str,
    pub model: HyMtModel,
    pub prompt_strategy: LocalPromptStrategy,
    pub completion_api: LocalCompletionApi,
    pub cache_family: &'static str,
    pub quality_version: &'static str,
    pub gpu_context_size: &'static str,
    pub cpu_context_size: &'static str,
    pub server_compatibility_args: &'static [&'static str],
}

const RAW_TRANSLATION_SERVER_ARGS: &[&str] = &["--no-jinja", "--skip-chat-parsing"];
const SHARED_CHAT_QUALITY_VERSION: &str = "shared-chat-v1";

impl LocalModelProfile {
    const fn shared_chat(
        kind: HyMtModelSize,
        config_id: &'static str,
        runtime_label: &'static str,
        model: HyMtModel,
        cache_family: &'static str,
        gpu_context_size: &'static str,
        cpu_context_size: &'static str,
    ) -> Self {
        Self {
            kind,
            config_id,
            runtime_label,
            model,
            prompt_strategy: LocalPromptStrategy::SharedChat,
            completion_api: LocalCompletionApi::ChatCompletions,
            cache_family,
            quality_version: SHARED_CHAT_QUALITY_VERSION,
            gpu_context_size,
            cpu_context_size,
            server_compatibility_args: &[],
        }
    }
}

pub(crate) const LOCAL_MODEL_PROFILES: [LocalModelProfile; 3] = [
    LocalModelProfile::shared_chat(
        HyMtModelSize::Small,
        "hymt_1_8b",
        "Hy-MT2 1.8B Q4 (경량·기본)",
        HyMtModel {
            key: "1.8b",
            family: "hy-mt2",
            label: "Hy-MT2 1.8B Q4_K_M",
            repository: "tencent/Hy-MT2-1.8B-GGUF",
            filename: "Hy-MT2-1.8B-Q4_K_M.gguf",
            expected_bytes: 1_133_080_448,
            expected_sha256: "dc5f44fcf1fa496ee7ad725982c0c8c553a4de00259b53af84c4b89fb0c06699",
        },
        "hy-mt2",
        "8192",
        "2048",
    ),
    LocalModelProfile::shared_chat(
        HyMtModelSize::Large,
        "hymt_7b",
        "Hy-MT2 7B Q4 (품질·약 4.6GB)",
        HyMtModel {
            key: "7b",
            family: "hy-mt2",
            label: "Hy-MT2 7B Q4_K_M",
            repository: "tencent/Hy-MT2-7B-GGUF",
            filename: "Hy-MT2-7B-Q4_K_M.gguf",
            expected_bytes: 4_624_648_896,
            expected_sha256: "9f96256500f3fc1ab4d64336b58f52a949a95ad7516b0c229476eef782f9f77b",
        },
        "hy-mt2",
        "8192",
        "2048",
    ),
    LocalModelProfile {
        kind: HyMtModelSize::TranslateGemma4B,
        config_id: "translategemma_4b",
        runtime_label: "TranslateGemma 4B Q4 (실험·약 2.5GB)",
        model: HyMtModel {
            key: "4b",
            family: "translategemma",
            label: "TranslateGemma 4B Q4_K_M",
            repository: "SandLogicTechnologies/translategemma-4b-it-GGUF",
            filename: "translategemma-4b_Q4_K_M.gguf",
            expected_bytes: 2_489_909_312,
            expected_sha256: "526747309109c016db547c6fc1c7b0c9c286b5e7a7556827b5419fd9543a09cd",
        },
        prompt_strategy: LocalPromptStrategy::OfficialTranslateGemma,
        completion_api: LocalCompletionApi::RawCompletion,
        cache_family: "translategemma",
        quality_version: "source-faithful-v3",
        gpu_context_size: "2048",
        cpu_context_size: "2048",
        server_compatibility_args: RAW_TRANSLATION_SERVER_ARGS,
    },
];

impl HyMtModelSize {
    #[cfg(test)]
    pub(crate) fn all() -> impl Iterator<Item = Self> {
        LOCAL_MODEL_PROFILES.into_iter().map(|profile| profile.kind)
    }

    pub fn from_config_id(config_id: &str) -> Option<Self> {
        LocalModelProfile::from_config_id(config_id).map(|profile| profile.kind)
    }

    pub fn config_id(self) -> &'static str {
        self.profile().config_id
    }

    pub fn runtime_label(self) -> &'static str {
        self.profile().runtime_label
    }

    pub(crate) fn profile(self) -> LocalModelProfile {
        LOCAL_MODEL_PROFILES
            .into_iter()
            .find(|profile| profile.kind == self)
            .expect("every local model kind must have a profile")
    }

    pub fn model(self) -> HyMtModel {
        self.profile().model
    }
}

impl LocalModelProfile {
    pub(crate) fn from_config_id(config_id: &str) -> Option<Self> {
        LOCAL_MODEL_PROFILES
            .into_iter()
            .find(|profile| profile.config_id == config_id)
    }

    pub(crate) fn cache_namespace(self, speech_style: &str) -> String {
        format!(
            "{}:{}:q4_k_m:{}:{speech_style}",
            self.cache_family, self.model.key, self.quality_version
        )
    }

    pub(crate) fn context_size(self, attempt: &str) -> &'static str {
        if attempt == "cpu" {
            self.cpu_context_size
        } else {
            self.gpu_context_size
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::{HyMtModelSize, LocalCompletionApi, LocalPromptStrategy, LOCAL_MODEL_PROFILES};

    #[test]
    fn every_local_model_has_one_complete_unique_profile() {
        let mut config_ids = HashSet::new();
        let mut cache_namespaces = HashSet::new();
        for profile in LOCAL_MODEL_PROFILES {
            assert!(config_ids.insert(profile.config_id));
            assert!(!profile.runtime_label.is_empty());
            assert!(!profile.model.key.is_empty());
            assert!(!profile.model.family.is_empty());
            assert!(!profile.model.repository.is_empty());
            assert!(!profile.model.filename.is_empty());
            assert!(profile.model.expected_bytes > 0);
            assert_eq!(profile.model.expected_sha256.len(), 64);
            assert!(cache_namespaces.insert(profile.cache_namespace("auto")));
        }
    }

    #[test]
    fn profiles_capture_model_specific_runtime_and_prompt_behavior() {
        let small = HyMtModelSize::Small.profile();
        assert_eq!(small.prompt_strategy, LocalPromptStrategy::SharedChat);
        assert_eq!(small.completion_api, LocalCompletionApi::ChatCompletions);
        assert_eq!(small.context_size("auto"), "8192");
        assert_eq!(small.context_size("cpu"), "2048");

        let gemma = HyMtModelSize::TranslateGemma4B.profile();
        assert_eq!(
            gemma.prompt_strategy,
            LocalPromptStrategy::OfficialTranslateGemma
        );
        assert_eq!(gemma.completion_api, LocalCompletionApi::RawCompletion);
        assert_eq!(gemma.context_size("auto"), "2048");
        assert_eq!(
            gemma.server_compatibility_args,
            ["--no-jinja", "--skip-chat-parsing"]
        );
    }

    #[test]
    fn generic_chat_models_inherit_one_translation_contract() {
        let small = HyMtModelSize::Small.profile();
        let large = HyMtModelSize::Large.profile();

        assert_eq!(large.prompt_strategy, small.prompt_strategy);
        assert_eq!(large.completion_api, small.completion_api);
        assert_eq!(large.quality_version, small.quality_version);
        assert_eq!(
            large.server_compatibility_args,
            small.server_compatibility_args
        );
    }

    #[test]
    fn config_ids_resolve_through_the_profile_catalog() {
        for profile in LOCAL_MODEL_PROFILES {
            let resolved = super::LocalModelProfile::from_config_id(profile.config_id).unwrap();
            assert_eq!(resolved.kind, profile.kind);
        }
        assert!(super::LocalModelProfile::from_config_id("missing").is_none());
    }
}
