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

#[derive(Clone, Debug, PartialEq)]
struct DiscordLaunchPlan {
    program: PathBuf,
    arguments: Vec<String>,
    current_dir: PathBuf,
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
    let launch = discord_launch_plan(&executable, port)?;
    Command::new(&launch.program)
        .args(&launch.arguments)
        .current_dir(&launch.current_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Discord를 디버그 모드로 실행하지 못했어: {error}"))?;
    wait_for_restarted_process(&executable, Duration::from_secs(15))
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

fn discord_launch_plan(executable: &Path, port: u16) -> Result<DiscordLaunchPlan, String> {
    let app_dir = executable
        .parent()
        .ok_or_else(|| "Discord 설치 폴더를 찾지 못했어.".to_string())?;
    let executable_name = executable
        .file_name()
        .ok_or_else(|| "Discord 실행 파일 이름을 찾지 못했어.".to_string())?
        .to_string_lossy()
        .into_owned();
    let root_dir = app_dir.parent().unwrap_or(app_dir);
    let updater = root_dir.join("Update.exe");
    let debug_arguments = discord_debug_arguments(port);

    if updater.is_file() {
        return Ok(DiscordLaunchPlan {
            program: updater,
            arguments: vec![
                "--processStart".to_string(),
                executable_name,
                "--process-start-args".to_string(),
                debug_arguments.join(" "),
            ],
            current_dir: root_dir.to_path_buf(),
        });
    }

    Ok(DiscordLaunchPlan {
        program: executable.to_path_buf(),
        arguments: debug_arguments.into_iter().collect(),
        current_dir: app_dir.to_path_buf(),
    })
}

fn wait_for_restarted_process(
    executable: &Path,
    timeout: Duration,
) -> Result<DiscordProcess, String> {
    let expected_name = executable
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Some(process) = current_process().filter(|process| {
            process
                .executable
                .file_name()
                .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(&expected_name))
        }) {
            return Ok(process);
        }
        thread::sleep(Duration::from_millis(200));
    }
    Err("Discord 재실행 요청은 보냈지만 새 프로세스를 찾지 못했어.".to_string())
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
    #[cfg(target_os = "windows")]
    use super::{current_process, restart, wait_for_debug_port};
    use super::{
        discord_debug_arguments, discord_launch_plan, installed_executable_in, is_discord_name,
    };
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
    fn squirrel_updater_forwards_debug_arguments_to_discord() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("nude-translator-launch-{nonce}"));
        let app = root.join("app-1.0.0");
        fs::create_dir_all(&app).unwrap();
        fs::write(root.join("Update.exe"), b"test").unwrap();
        let executable = app.join("Discord.exe");
        fs::write(&executable, b"test").unwrap();

        let plan = discord_launch_plan(&executable, 9222).expect("launch plan");

        assert_eq!(plan.program, root.join("Update.exe"));
        assert_eq!(plan.current_dir, root);
        assert_eq!(
            plan.arguments,
            [
                "--processStart".to_string(),
                "Discord.exe".to_string(),
                "--process-start-args".to_string(),
                "--force-renderer-accessibility --remote-debugging-port=9222".to_string(),
            ]
        );
        let _ = fs::remove_dir_all(plan.current_dir);
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

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "실행 중인 Discord를 종료하고 디버그 포트로 실제 재시작해"]
    fn live_restart_opens_the_discord_debug_port() {
        let expected_process_id = current_process().map(|process| process.process_id);
        let restarted = restart(expected_process_id, 9222).expect("restart Discord");
        assert!(restarted.process_id > 0);
        wait_for_debug_port(9222, std::time::Duration::from_secs(30)).expect("Discord debug port");
    }
}
