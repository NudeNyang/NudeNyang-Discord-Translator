use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

const DISCORD_EXECUTABLES: [&str; 3] = ["Discord.exe", "DiscordPTB.exe", "DiscordCanary.exe"];
const DISCORD_INSTALLS: [(&str, &str); 3] = [
    ("Discord", "Discord.exe"),
    ("DiscordPTB", "DiscordPTB.exe"),
    ("DiscordCanary", "DiscordCanary.exe"),
];

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordProcess {
    pub process_id: u32,
    pub executable: PathBuf,
}

pub fn current_process() -> Option<DiscordProcess> {
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_exe(UpdateKind::Always)
            .with_cmd(UpdateKind::Always),
    );
    current_process_from_system(&system)
}

fn current_process_from_system(system: &System) -> Option<DiscordProcess> {
    system
        .processes()
        .values()
        .filter(|process| is_discord_name(&process.name().to_string_lossy()))
        .filter(|process| {
            !process
                .cmd()
                .iter()
                .any(|argument| argument.to_string_lossy().starts_with("--type="))
        })
        .filter_map(|process| {
            Some((
                process.start_time(),
                DiscordProcess {
                    process_id: process.pid().as_u32(),
                    executable: process.exe()?.to_path_buf(),
                },
            ))
        })
        .max_by_key(|(started_at, _)| *started_at)
        .map(|(_, process)| process)
}

pub fn restart(expected_process_id: Option<u32>, port: u16) -> Result<DiscordProcess, String> {
    let current = current_process();
    let current_id = current.as_ref().map(|process| process.process_id);
    if expected_process_id != current_id {
        return Err("Discord가 카운트다운 도중 다시 실행되어 자동 재시작을 취소했어.".to_string());
    }
    let executable = current
        .map(|process| process.executable)
        .or_else(installed_executable)
        .ok_or_else(|| "Discord 설치 경로를 찾지 못했어.".to_string())?;
    if !executable.is_file() {
        return Err("Discord 설치 경로를 찾지 못했어.".to_string());
    }
    stop_matching_processes(&executable)?;
    let child = Command::new(&executable)
        .args(discord_debug_arguments(port))
        .current_dir(
            executable
                .parent()
                .ok_or_else(|| "Discord 설치 폴더를 찾지 못했어.".to_string())?,
        )
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Discord를 디버그 모드로 실행하지 못했어: {error}"))?;
    Ok(DiscordProcess {
        process_id: child.id(),
        executable,
    })
}

pub fn wait_for_debug_port(port: u16, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let url = format!("http://127.0.0.1:{port}/json");
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_millis(500))
        .timeout(Duration::from_secs(1))
        .build()
        .map_err(|error| format!("Discord 연결 확인 클라이언트를 만들지 못했어: {error}"))?;
    let mut last_error = "Discord 디버그 렌더러를 찾지 못했어.".to_string();
    while Instant::now() < deadline {
        match client
            .get(&url)
            .send()
            .and_then(|response| response.error_for_status())
        {
            Ok(_) => return Ok(()),
            Err(error) => last_error = error.to_string(),
        }
        thread::sleep(Duration::from_millis(500));
    }
    Err(format!(
        "Discord를 다시 열었지만 30초 안에 디버그 렌더러가 준비되지 않았어. 마지막 오류: {last_error}"
    ))
}

fn stop_matching_processes(executable: &Path) -> Result<(), String> {
    let selected_name = executable
        .file_name()
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let pids: Vec<Pid> = system
        .processes()
        .values()
        .filter(|process| {
            process
                .name()
                .to_string_lossy()
                .eq_ignore_ascii_case(&selected_name)
        })
        .map(|process| process.pid())
        .collect();
    for pid in &pids {
        if let Some(process) = system.process(*pid) {
            process.kill();
        }
    }
    let deadline = Instant::now() + Duration::from_secs(8);
    while Instant::now() < deadline {
        system.refresh_processes(ProcessesToUpdate::Some(&pids), true);
        if pids.iter().all(|pid| system.process(*pid).is_none()) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("Discord 프로세스를 종료하지 못했어.".to_string())
}

fn installed_executable() -> Option<PathBuf> {
    let local_app_data = env::var_os("LOCALAPPDATA").filter(|value| !value.is_empty())?;
    installed_executable_in(Path::new(&local_app_data))
}

fn installed_executable_in(local_app_data: &Path) -> Option<PathBuf> {
    for (directory, executable_name) in DISCORD_INSTALLS {
        let root = local_app_data.join(directory);
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        let mut versions: Vec<PathBuf> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.is_dir()
                    && path
                        .file_name()
                        .is_some_and(|name| name.to_string_lossy().starts_with("app-"))
            })
            .collect();
        versions.sort_by(|left, right| right.file_name().cmp(&left.file_name()));
        if let Some(found) = versions
            .into_iter()
            .map(|version| version.join(executable_name))
            .find(|candidate| candidate.is_file())
        {
            return found.canonicalize().ok().or(Some(found));
        }
    }
    None
}

fn discord_debug_arguments(port: u16) -> [String; 2] {
    [
        "--force-renderer-accessibility".to_string(),
        format!("--remote-debugging-port={port}"),
    ]
}

fn is_discord_name(name: &str) -> bool {
    DISCORD_EXECUTABLES
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(name))
}

#[cfg(test)]
mod tests {
    use super::{discord_debug_arguments, installed_executable_in, is_discord_name};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn debug_arguments_contain_the_required_electron_port() {
        assert_eq!(
            discord_debug_arguments(9222),
            [
                "--force-renderer-accessibility".to_string(),
                "--remote-debugging-port=9222".to_string()
            ]
        );
    }

    #[test]
    fn discord_process_names_are_case_insensitive() {
        assert!(is_discord_name("discord.exe"));
        assert!(is_discord_name("DiscordCanary.exe"));
        assert!(!is_discord_name("DiscordHelper.exe"));
    }

    #[test]
    fn newest_installed_discord_version_is_selected() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("nude-translator-discord-{nonce}"));
        for version in ["app-1.0.0", "app-2.0.0"] {
            let directory = root.join("Discord").join(version);
            fs::create_dir_all(&directory).unwrap();
            fs::write(directory.join("Discord.exe"), b"test").unwrap();
        }
        let executable = installed_executable_in(&root).expect("installed Discord");
        assert!(executable.to_string_lossy().contains("app-2.0.0"));
        let _ = fs::remove_dir_all(root);
    }
}
