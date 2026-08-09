use std::time::Duration;

use serde::Serialize;

use crate::credentials;
use crate::translation::{
    connect_subscription_interactively_with_observer, install_subscription_cli,
    probe_subscription_connection, CliConnectionProbe, DeepLTranslator, LoginBrowserGate,
    LoginProcessObserver,
};

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

pub fn list(disabled_providers: &[String]) -> Vec<ProviderConnection> {
    vec![
        cli_status(
            "chatgpt",
            "ChatGPT",
            "ChatGPT 구독 · Codex CLI",
            disabled_providers,
        ),
        cli_status(
            "claude",
            "Claude",
            "Claude Pro/Max · Claude Code",
            disabled_providers,
        ),
        cli_status(
            "gemini",
            "Gemini",
            "Google 구독 · Gemini CLI",
            disabled_providers,
        ),
        deepl_status(),
    ]
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
        "chatgpt" | "claude" | "gemini" => {
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
        "chatgpt" => ("ChatGPT", "ChatGPT 구독 · Codex CLI"),
        "claude" => ("Claude", "Claude Pro/Max · Claude Code"),
        _ => ("Gemini", "Google 구독 · Gemini CLI"),
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
                "{name} CLI 로그인 정보는 유지되며 NudeNyang Translator에서만 사용을 중지했습니다."
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

#[cfg(test)]
mod tests {
    use super::{cli_connection, disconnect};
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
        assert!(disconnected.detail.contains("NudeNyang Translator에서만"));
    }
}
