use std::time::Duration;

use serde::Serialize;

use crate::credentials;
use crate::translation::{
    connect_subscription_interactively, install_subscription_cli, probe_subscription_connection,
    CliConnectionProbe, DeepLTranslator,
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

pub fn list() -> Vec<ProviderConnection> {
    vec![
        cli_status("chatgpt", "ChatGPT", "ChatGPT 구독 · Codex CLI"),
        cli_status("gemini", "Gemini", "Google 구독 · Gemini CLI"),
        deepl_status(),
    ]
}

pub fn connect(provider: &str, credential: Option<&str>) -> Result<ProviderConnection, String> {
    match provider {
        "deepl" => {
            let credential = credential.unwrap_or_default().trim();
            DeepLTranslator::validate_api_key(credential, Duration::from_secs(20))?;
            credentials::write("deepl", credential)?;
            Ok(deepl_status())
        }
        "chatgpt" | "gemini" => {
            let probe = connect_subscription_interactively(provider)?;
            Ok(cli_connection(
                provider,
                if provider == "chatgpt" {
                    "ChatGPT"
                } else {
                    "Gemini"
                },
                if provider == "chatgpt" {
                    "ChatGPT 구독 · Codex CLI"
                } else {
                    "Google 구독 · Gemini CLI"
                },
                probe,
            ))
        }
        _ => Err(format!("지원하지 않는 번역 서비스입니다: {provider}")),
    }
}

pub fn install(provider: &str) -> Result<ProviderConnection, String> {
    match provider {
        "chatgpt" | "gemini" => {
            let probe = install_subscription_cli(provider)?;
            Ok(cli_connection(
                provider,
                if provider == "chatgpt" {
                    "ChatGPT"
                } else {
                    "Gemini"
                },
                if provider == "chatgpt" {
                    "ChatGPT 구독 · Codex CLI"
                } else {
                    "Google 구독 · Gemini CLI"
                },
                probe,
            ))
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
        "chatgpt" | "gemini" => Err(
            "CLI 계정은 다른 앱에서도 사용하므로 Nude Translator에서 강제로 로그아웃하지 않습니다. 해당 CLI에서 계정을 관리하십시오."
                .to_string(),
        ),
        _ => Err(format!("지원하지 않는 번역 서비스입니다: {provider}")),
    }
}

fn cli_status(provider: &str, name: &str, auth_mode: &str) -> ProviderConnection {
    let probe =
        probe_subscription_connection(provider).unwrap_or_else(|error| CliConnectionProbe {
            installed: false,
            connected: false,
            detail: error,
        });
    cli_connection(provider, name, auth_mode, probe)
}

fn cli_connection(
    provider: &str,
    name: &str,
    auth_mode: &str,
    probe: CliConnectionProbe,
) -> ProviderConnection {
    ProviderConnection {
        id: provider.to_string(),
        name: name.to_string(),
        auth_mode: auth_mode.to_string(),
        installed: probe.installed,
        connected: probe.connected,
        state: if probe.connected {
            "connected"
        } else if probe.installed {
            "login-required"
        } else {
            "not-installed"
        }
        .to_string(),
        detail: probe.detail,
        credential_required: false,
        can_disconnect: false,
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
    use super::cli_connection;
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
        );
        assert_eq!(ready.state, "connected");
    }
}
