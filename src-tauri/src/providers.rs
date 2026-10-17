use std::time::Duration;

use serde::Serialize;

use crate::config::{default_config_path, AppConfig, ConfigStore};
use crate::credentials;
use crate::translation::{
    codebuddy_cli_is_installed, codebuddy_login_is_verified,
    connect_subscription_interactively_with_observer, install_subscription_cli,
    probe_subscription_connection, verify_codebuddy_login, CliConnectionProbe, DeepLTranslator,
    LoginBrowserGate, LoginProcessObserver, OpenAiCompatSettings, OpenAiCompatTranslator,
    OPENAI_COMPAT_CREDENTIAL_ID,
};

const CODEBUDDY_INSTALL_HINT: &str =
    "CodeBuddy CLI를 찾지 못했습니다. CodeBuddy CLI를 설치한 뒤 다시 연결하십시오.";
const CODEBUDDY_AUTH_MODE: &str = "기존 CodeBuddy CLI 로그인 · 모델별 사용량";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnection {
    pub id: String,
    pub name: String,
    pub auth_mode: String,
    pub installed: bool,
    pub connected: bool,
    pub state: String,
    pub detail: String,
    pub credential_required: bool,
    pub can_disconnect: bool,
}

pub fn list(config: &AppConfig) -> Vec<ProviderConnection> {
    let disabled_providers = &config.disabled_providers;
    vec![
        cli_status(
            "chatgpt",
            "ChatGPT",
            "ChatGPT 무료 플랜 이상 · Codex CLI",
            disabled_providers,
        ),
        cli_status(
            "claude",
            "Claude",
            "Claude 유료 플랜 · Claude Code",
            disabled_providers,
        ),
        cli_status(
            "gemini",
            "Gemini",
            "Google 구독 · Antigravity CLI",
            disabled_providers,
        ),
        codebuddy_status(disabled_providers),
        deepl_status(),
        openai_compat_status(config),
    ]
}

/// Validates with one real translation, then stores the key only after the server accepted it.
pub fn connect_openai_compat(
    settings: OpenAiCompatSettings,
    credential: Option<&str>,
) -> Result<OpenAiCompatSettings, String> {
    connect_openai_compat_with_store(settings, credential, &credentials::SystemCredentialStore)
}

pub(crate) fn connect_openai_compat_with_store(
    settings: OpenAiCompatSettings,
    credential: Option<&str>,
    store: &dyn credentials::CredentialStore,
) -> Result<OpenAiCompatSettings, String> {
    let credential = credential.map(str::trim).filter(|value| !value.is_empty());
    let api_key = match credential {
        Some(key) => Some(key.to_string()),
        None => settings
            .read_credential(store)?
            .and_then(|record| record.api_key),
    };
    let translator = OpenAiCompatTranslator::new(settings.clone(), api_key.clone())?;
    translator.validate()?;
    settings.save_credential(api_key.as_deref(), store)?;
    Ok(OpenAiCompatSettings {
        base_url: crate::translation::normalize_openai_compat_base_url(&settings.base_url)?,
        model: settings.model.trim().to_string(),
        ..settings
    })
}

pub fn connect_with_observer(
    provider: &str,
    credential: Option<&str>,
    process_observer: Option<LoginProcessObserver>,
    browser_gate: Option<LoginBrowserGate>,
) -> Result<ProviderConnection, String> {
    match provider {
        "deepl" => {
            let credential = credential.unwrap_or_default().trim();
            DeepLTranslator::validate_api_key(credential, Duration::from_secs(20))?;
            credentials::write("deepl", credential)?;
            Ok(deepl_status())
        }
        "chatgpt" | "claude" | "gemini" => {
            let probe = probe_subscription_connection(provider)?;
            let probe = if probe.connected {
                probe
            } else {
                connect_subscription_interactively_with_observer(
                    provider,
                    process_observer,
                    browser_gate,
                )?
            };
            let (name, auth_mode) = cli_provider_identity(provider);
            Ok(cli_connection(provider, name, auth_mode, probe, false))
        }
        "codebuddy" => {
            if !codebuddy_cli_is_installed() {
                return Err(CODEBUDDY_INSTALL_HINT.to_string());
            }
            // Verification is tied to the selected model.
            let model = selected_codebuddy_model()?;
            if !codebuddy_login_is_verified(&model) {
                verify_codebuddy_login(&model)?;
            }
            Ok(codebuddy_status(&[]))
        }
        _ => Err(format!("지원하지 않는 번역 서비스입니다: {provider}")),
    }
}

pub fn install(provider: &str) -> Result<ProviderConnection, String> {
    match provider {
        "chatgpt" | "claude" | "gemini" => {
            let probe = install_subscription_cli(provider)?;
            let (name, auth_mode) = cli_provider_identity(provider);
            Ok(cli_connection(provider, name, auth_mode, probe, false))
        }
        "codebuddy" => Err(CODEBUDDY_INSTALL_HINT.to_string()),
        _ => Err(format!(
            "자동 설치를 지원하지 않는 번역 서비스입니다: {provider}"
        )),
    }
}

pub fn disconnect(provider: &str) -> Result<ProviderConnection, String> {
    match provider {
        "deepl" => {
            credentials::delete("deepl")?;
            Ok(deepl_status())
        }
        "openai_compat" => {
            credentials::delete(OPENAI_COMPAT_CREDENTIAL_ID)?;
            Ok(openai_compat_status(&AppConfig::default()))
        }
        "chatgpt" | "claude" | "gemini" | "codebuddy" => {
            // Disable app usage without logging out of the CLI.
            let (name, auth_mode) = cli_provider_identity(provider);
            Ok(cli_connection(
                provider,
                name,
                auth_mode,
                CliConnectionProbe {
                    installed: true,
                    connected: true,
                    detail: String::new(),
                },
                true,
            ))
        }
        _ => Err(format!("지원하지 않는 번역 서비스입니다: {provider}")),
    }
}

fn cli_provider_identity(provider: &str) -> (&'static str, &'static str) {
    match provider {
        "chatgpt" => ("ChatGPT", "ChatGPT 무료 플랜 이상 · Codex CLI"),
        "claude" => ("Claude", "Claude 유료 플랜 · Claude Code"),
        "codebuddy" => ("CodeBuddy", CODEBUDDY_AUTH_MODE),
        _ => ("Gemini", "Google 구독 · Antigravity CLI"),
    }
}

fn cli_status(
    provider: &str,
    name: &str,
    auth_mode: &str,
    disabled_providers: &[String],
) -> ProviderConnection {
    let probe =
        probe_subscription_connection(provider).unwrap_or_else(|error| CliConnectionProbe {
            installed: false,
            connected: false,
            detail: error,
        });
    cli_connection(
        provider,
        name,
        auth_mode,
        probe,
        disabled_providers
            .iter()
            .any(|disabled| disabled == provider),
    )
}

/// Reports cached verification without making a translation request.
fn codebuddy_status(disabled_providers: &[String]) -> ProviderConnection {
    let verified = selected_codebuddy_model()
        .map(|model| codebuddy_login_is_verified(&model))
        .unwrap_or(false);
    codebuddy_connection(
        codebuddy_cli_is_installed(),
        verified,
        disabled_providers
            .iter()
            .any(|disabled| disabled == "codebuddy"),
    )
}

fn codebuddy_connection(installed: bool, verified: bool, disabled: bool) -> ProviderConnection {
    let verified = installed && verified;
    cli_connection(
        "codebuddy",
        "CodeBuddy",
        CODEBUDDY_AUTH_MODE,
        CliConnectionProbe {
            installed,
            connected: verified,
            detail: if !installed {
                CODEBUDDY_INSTALL_HINT.to_string()
            } else if verified {
                "CodeBuddy CLI 로그인과 선택한 모델을 확인했습니다. 번역할 때 같은 로그인을 사용합니다."
                    .to_string()
            } else {
                "CodeBuddy CLI가 설치되어 있습니다. 연결을 선택하면 기존 로그인을 확인합니다."
                    .to_string()
            },
        },
        disabled,
    )
}

fn selected_codebuddy_model() -> Result<String, String> {
    ConfigStore::load(default_config_path())
        .and_then(|store| store.get())
        .map(|config: AppConfig| config.codebuddy_model)
        .map_err(|error| format!("CodeBuddy 설정을 읽지 못했습니다: {error}"))
}

fn cli_connection(
    provider: &str,
    name: &str,
    auth_mode: &str,
    probe: CliConnectionProbe,
    disabled: bool,
) -> ProviderConnection {
    let authenticated = probe.connected;
    let disabled = authenticated && disabled;
    let connected = authenticated && !disabled;
    ProviderConnection {
        id: provider.to_string(),
        name: name.to_string(),
        auth_mode: auth_mode.to_string(),
        installed: probe.installed,
        connected,
        state: if disabled {
            "disabled"
        } else if connected {
            "connected"
        } else if probe.installed {
            "login-required"
        } else {
            "not-installed"
        }
        .to_string(),
        detail: if disabled {
            format!(
                "{name} CLI 로그인 정보는 유지되며 NudeNyang Discord Translator에서만 사용을 중지했습니다."
            )
        } else {
            probe.detail
        },
        credential_required: false,
        can_disconnect: connected,
    }
}

fn deepl_status() -> ProviderConnection {
    let stored = credentials::read("deepl");
    let (connected, detail) = match stored {
        Ok(Some(_)) => (
            true,
            "API 키가 운영체제 보안 저장소에 저장되어 있습니다.".to_string(),
        ),
        Ok(None) => (
            false,
            "DeepL API Free 또는 Pro 키를 입력하여 연결하십시오.".to_string(),
        ),
        Err(error) => (false, error),
    };
    ProviderConnection {
        id: "deepl".to_string(),
        name: "DeepL".to_string(),
        auth_mode: "API 사용량 과금".to_string(),
        installed: true,
        connected,
        state: if connected {
            "connected"
        } else {
            "credential-required"
        }
        .to_string(),
        detail,
        credential_required: true,
        can_disconnect: connected,
    }
}

pub fn openai_compat_status(config: &AppConfig) -> ProviderConnection {
    openai_compat_status_with_store(config, &credentials::SystemCredentialStore)
}

fn openai_compat_status_with_store(
    config: &AppConfig,
    store: &dyn credentials::CredentialStore,
) -> ProviderConnection {
    let configured =
        !config.openai_compat_base_url.is_empty() && !config.openai_compat_model.is_empty();
    let credential = if configured {
        OpenAiCompatSettings::from_config(config).read_credential(store)
    } else {
        Ok(None)
    };
    let (connected, detail) = match credential {
        Err(error) => (false, error),
        Ok(None) => (
            false,
            "서버 주소와 모델 ID를 입력하여 연결하십시오.".to_string(),
        ),
        Ok(Some(record)) if record.api_key.is_some() => (
            true,
            "서버에 연결되었으며 API 키가 운영체제 보안 저장소에 저장되어 있습니다.".to_string(),
        ),
        Ok(Some(_)) => (true, "API 키 없이 서버에 연결되었습니다.".to_string()),
    };
    ProviderConnection {
        id: "openai_compat".to_string(),
        name: "OpenAI 호환 API".to_string(),
        auth_mode: "사용자 지정 서버".to_string(),
        installed: true,
        connected,
        state: if connected {
            "connected"
        } else {
            "setup-required"
        }
        .to_string(),
        detail,
        credential_required: false,
        can_disconnect: connected,
    }
}

#[cfg(test)]
mod tests {
    use super::{cli_connection, codebuddy_connection, disconnect, openai_compat_status};
    use crate::config::AppConfig;

    #[test]
    fn openai_credential_status_requires_a_matching_verified_server() {
        use crate::credentials::{CredentialStore, MemoryCredentialStore};
        use crate::translation::OpenAiCompatSettings;
        let store = MemoryCredentialStore::default();
        let mut config = AppConfig {
            openai_compat_base_url: "https://api.example.com/v1".into(),
            openai_compat_model: "test-model".into(),
            ..Default::default()
        };
        assert!(!super::openai_compat_status_with_store(&config, &store).connected);
        store
            .write(super::OPENAI_COMPAT_CREDENTIAL_ID, "legacy-test-key")
            .unwrap();
        assert!(!super::openai_compat_status_with_store(&config, &store).connected);
        OpenAiCompatSettings::from_config(&config)
            .save_credential(Some("bound-test-key"), &store)
            .unwrap();
        let keyed = super::openai_compat_status_with_store(&config, &store);
        assert!(keyed.connected && keyed.can_disconnect);
        assert!(keyed.detail.contains("보안 저장소"));
        config.openai_compat_base_url = "https://other.example.com/v1".into();
        assert!(!super::openai_compat_status_with_store(&config, &store).connected);
        OpenAiCompatSettings::from_config(&config)
            .save_credential(None, &store)
            .unwrap();
        let keyless = super::openai_compat_status_with_store(&config, &store);
        assert!(keyless.connected && keyless.can_disconnect);
        assert!(keyless.detail.contains("API 키 없이"));
    }

    #[test]
    fn openai_compatible_status_requires_an_address_and_model() {
        let status = openai_compat_status(&AppConfig::default());
        assert_eq!(status.id, "openai_compat");
        assert_eq!(status.state, "setup-required");
        assert!(!status.connected);
        assert!(!status.can_disconnect);
    }
    use crate::translation::CliConnectionProbe;

    #[test]
    fn cli_states_distinguish_installation_and_login() {
        let missing = cli_connection(
            "chatgpt",
            "ChatGPT",
            "Codex CLI",
            CliConnectionProbe {
                installed: false,
                connected: false,
                detail: "missing".to_string(),
            },
            false,
        );
        assert_eq!(missing.state, "not-installed");

        let ready = cli_connection(
            "chatgpt",
            "ChatGPT",
            "Codex CLI",
            CliConnectionProbe {
                installed: true,
                connected: true,
                detail: "ready".to_string(),
            },
            false,
        );
        assert_eq!(ready.state, "connected");
        assert!(ready.can_disconnect);

        let disabled = cli_connection(
            "chatgpt",
            "ChatGPT",
            "Codex CLI",
            CliConnectionProbe {
                installed: true,
                connected: true,
                detail: "ready".to_string(),
            },
            true,
        );
        assert!(!disabled.connected);
        assert_eq!(disabled.state, "disabled");
        assert!(!disabled.can_disconnect);
        assert!(disabled.detail.contains("CLI 로그인 정보는 유지"));
    }

    #[test]
    fn disconnecting_a_cli_does_not_require_or_change_its_login() {
        let disconnected = disconnect("chatgpt").expect("disable ChatGPT inside the app");
        assert_eq!(disconnected.state, "disabled");
        assert!(!disconnected.connected);
        assert!(disconnected.installed);
        assert!(disconnected
            .detail
            .contains("NudeNyang Discord Translator에서만"));
    }

    #[test]
    fn codebuddy_card_separates_installation_from_a_verified_login() {
        let missing = codebuddy_connection(false, false, false);
        assert_eq!(missing.state, "not-installed");
        assert!(!missing.installed);
        assert!(missing.detail.contains("CodeBuddy CLI를 찾지 못했습니다"));

        // An installed CodeBuddy CLI is not a verified login, so the app must not report it
        // as connected or offer to disconnect it.
        let installed_only = codebuddy_connection(true, false, false);
        assert_eq!(installed_only.state, "login-required");
        assert!(installed_only.installed);
        assert!(!installed_only.connected);
        assert!(!installed_only.can_disconnect);
        assert!(installed_only.detail.contains("설치되어 있습니다"));

        let verified = codebuddy_connection(true, true, false);
        assert_eq!(verified.state, "connected");
        assert!(verified.connected);
        assert!(verified.can_disconnect);

        let disabled = codebuddy_connection(true, true, true);
        assert_eq!(disabled.state, "disabled");
        assert!(!disabled.connected);
        assert!(disabled
            .detail
            .contains("NudeNyang Discord Translator에서만"));

        // A stored login flag must never outrank a missing executable.
        assert_eq!(
            codebuddy_connection(false, true, false).state,
            "not-installed"
        );
    }

    #[test]
    fn disconnecting_codebuddy_only_disables_app_usage() {
        let disconnected = disconnect("codebuddy").expect("disable CodeBuddy inside the app");
        assert_eq!(disconnected.state, "disabled");
        assert!(!disconnected.connected);
        assert!(disconnected.installed);
        assert!(disconnected.auth_mode.contains("CodeBuddy CLI 로그인"));
        assert!(disconnected
            .detail
            .contains("NudeNyang Discord Translator에서만"));
    }
}
