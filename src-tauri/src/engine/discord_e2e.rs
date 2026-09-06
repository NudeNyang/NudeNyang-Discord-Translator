//! Opt-in browser E2E adapter: only native process discovery is substituted.
//! The controller, CDP transport, DOM scripts and worker queues are production.
use super::*;
use crate::discord::{DiscordProcess, DiscordVariant};
use std::io::{BufRead, Write};

#[derive(Default)]
struct FixtureDesktop {
    foreground: Option<DiscordVariant>,
    processes: Vec<DiscordProcess>,
    endpoints: HashMap<u32, String>,
}

struct FixtureEnvironment(Arc<Mutex<FixtureDesktop>>);
impl DiscordEnvironment for FixtureEnvironment {
    fn foreground_process_id(&self) -> Option<u32> {
        let desktop = self.0.lock().unwrap();
        desktop
            .processes
            .iter()
            .find(|process| {
                DiscordVariant::from_executable(&process.executable) == desktop.foreground
            })
            .map(|process| process.process_id)
    }
    fn observe(&self) -> (Vec<DiscordProcess>, Option<DiscordVariant>) {
        let desktop = self.0.lock().unwrap();
        (desktop.processes.clone(), desktop.foreground)
    }
    fn connect(&self, process: &DiscordProcess) -> Result<CdpClient, String> {
        self.0
            .lock()
            .unwrap()
            .endpoints
            .get(&process.process_id)
            .cloned()
            .map(CdpClient::new)
            .ok_or_else(|| "Fixture endpoint unavailable".to_string())
    }
    fn disconnect(&self, _: DiscordVariant) -> Result<(), String> {
        Ok(())
    }
}

#[test]
#[ignore = "started by the isolated Discord browser E2E runner"]
fn discord_focus_e2e_driver() {
    assert_eq!(std::env::var("NUDENYANG_DISCORD_E2E").as_deref(), Ok("1"));
    let desktop = Arc::new(Mutex::new(FixtureDesktop::default()));
    let mut config = AppConfig {
        enabled: true,
        outgoing_translation_enabled: false,
        dictionary_enabled: false,
        translator: "mock".to_string(),
        outgoing_translator: "mock".to_string(),
        target_language: "ko".to_string(),
        ui_language: "ko".to_string(),
        discord_auto_restart_consent_granted: true,
        ..AppConfig::default()
    };
    let engine = RustEngine::start_with_environment(
        config.clone(),
        Box::new(FixtureEnvironment(desktop.clone())),
    );
    engine.ui_ready().unwrap();
    for line in std::io::stdin().lock().lines() {
        let command: Value = serde_json::from_str(&line.unwrap()).unwrap();
        let operation = command["operation"].as_str().unwrap();
        let reply = match operation {
            "clients" => {
                let mut desktop = desktop.lock().unwrap();
                desktop.processes.clear();
                desktop.endpoints.clear();
                for (index, client) in command["clients"].as_array().unwrap().iter().enumerate() {
                    let variant =
                        DiscordVariant::from_config(client["variant"].as_str().unwrap()).unwrap();
                    let filename = match variant {
                        DiscordVariant::Stable => "Discord.exe",
                        DiscordVariant::Ptb => "DiscordPTB.exe",
                        DiscordVariant::Canary => "DiscordCanary.exe",
                        _ => panic!("concrete release required"),
                    };
                    let process_id = client["pid"].as_u64().unwrap_or(index as u64 + 10) as u32;
                    desktop.processes.push(DiscordProcess {
                        process_id,
                        executable: PathBuf::from(filename),
                    });
                    desktop
                        .endpoints
                        .insert(process_id, client["endpoint"].as_str().unwrap().to_string());
                }
                json!({"ok":true})
            }
            "focus" => {
                desktop.lock().unwrap().foreground = command["variant"]
                    .as_str()
                    .map(|value| DiscordVariant::from_config(value).unwrap());
                json!({"ok":true})
            }
            "configure" => {
                config = config.patched(command["patch"].clone()).unwrap();
                engine.apply_config(config.clone()).unwrap();
                json!({"ok":true})
            }
            "enabled" => {
                config.enabled = command["enabled"].as_bool().unwrap();
                engine.set_enabled(config.enabled).unwrap();
                json!({"ok":true})
            }
            "pause" => {
                engine
                    .pause_for_verification(
                        DiscordVariant::from_config(command["variant"].as_str().unwrap()).unwrap(),
                        command["pid"].as_u64().map(|pid| pid as u32),
                        "account-verification",
                    )
                    .unwrap();
                json!({"ok":true})
            }
            "status" => serde_json::to_value(engine.status().unwrap()).unwrap(),
            "stop" => {
                engine.stop();
                json!({"ok":true})
            }
            _ => panic!("unknown E2E operation"),
        };
        println!(
            "NT_DISCORD_E2E:{}",
            json!({"id":command["id"],"result":reply})
        );
        std::io::stdout().flush().unwrap();
        if operation == "stop" {
            break;
        }
    }
    engine.stop();
}
