use std::env;
use std::ffi::OsStr;
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use fs2::FileExt;
use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

const DISCORD_EXECUTABLES: [&str; 3] = ["Discord.exe", "DiscordPTB.exe", "DiscordCanary.exe"];
const DISCORD_INSTALLS: [(&str, &str); 3] = [
    ("Discord", "Discord.exe"),
    ("DiscordPTB", "DiscordPTB.exe"),
    ("DiscordCanary", "DiscordCanary.exe"),
];

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
fn configure_background(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn configure_background(_command: &mut std::process::Command) {}

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

pub fn current_accessibility_process() -> Option<DiscordProcess> {
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_exe(UpdateKind::Always)
            .with_cmd(UpdateKind::Always),
    );
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
        .filter(|process| compatible_accessibility_arguments(&process.cmd()))
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

pub fn start_accessibly() -> Result<DiscordProcess, String> {
    let _lease = acquire_accessibility_restart_lease()?;
    if let Some(process) = current_process() {
        if current_accessibility_process().is_some() {
            return Ok(process);
        }
        return Err(
            "실행 중인 Discord를 접근성 호환 모드로 바꾸려면 한 번 재시작해야 합니다.".to_string(),
        );
    }
    let executable =
        installed_executable().ok_or_else(|| "Discord 설치 경로를 찾지 못했습니다.".to_string())?;
    launch_accessibly(&executable)
}

pub fn restart_accessibly(expected_process_id: Option<u32>) -> Result<DiscordProcess, String> {
    let _lease = acquire_accessibility_restart_lease()?;
    let current = current_process();
    if expected_process_id != current.as_ref().map(|process| process.process_id) {
        return Err("Discord가 대기 중 다시 실행되어 접근성 모드 전환을 취소했습니다.".to_string());
    }
    if let Some(compatible) = current_accessibility_process() {
        return Ok(compatible);
    }
    let executable = current
        .map(|process| process.executable)
        .or_else(installed_executable)
        .ok_or_else(|| "Discord 설치 경로를 찾지 못했습니다.".to_string())?;
    let executable = executable
        .canonicalize()
        .map_err(|error| format!("Discord 설치 경로를 확인하지 못했습니다: {error}"))?;
    validate_discord_executable(&executable)?;
    stop_matching_processes(&executable)?;
    launch_accessibly(&executable)
}

fn launch_accessibly(executable: &Path) -> Result<DiscordProcess, String> {
    let executable = executable
        .canonicalize()
        .map_err(|error| format!("Discord 설치 경로를 확인하지 못했습니다: {error}"))?;
    validate_discord_executable(&executable)?;
    let launch_executable = launchable_windows_path(&executable);
    let mut command = std::process::Command::new(&launch_executable);
    command
        .args(accessibility_arguments())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    configure_background(&mut command);
    let child = command
        .spawn()
        .map_err(|error| format!("Discord를 접근성 모드로 열지 못했습니다: {error}"))?;
    wait_for_restarted_process(&executable, child.id(), Duration::from_secs(15))
}

fn acquire_accessibility_restart_lease() -> Result<File, String> {
    let local_app_data = env::var_os("LOCALAPPDATA")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "현재 사용자 로컬 데이터 폴더를 찾지 못했습니다.".to_string())?;
    let directory = PathBuf::from(local_app_data)
        .join("NudeNyang")
        .join("DiscordIntegration");
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Discord 실행 조율 폴더를 만들지 못했습니다: {error}"))?;
    let path = directory.join("accessibility-restart.lock");
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)
            .map_err(|error| format!("Discord 실행 조율 파일을 열지 못했습니다: {error}"))?;
        match FileExt::try_lock_exclusive(&file) {
            Ok(()) => return Ok(file),
            Err(_) if Instant::now() < deadline => thread::sleep(Duration::from_millis(100)),
            Err(error) => {
                return Err(format!(
                "다른 앱이 Discord 접근성 모드를 준비 중이라 작업을 계속하지 못했습니다: {error}"
            ))
            }
        }
    }
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

fn validate_discord_executable(executable: &Path) -> Result<(), String> {
    if !executable.is_file() {
        return Err("Discord 설치 경로를 찾지 못했습니다.".to_string());
    }
    let name = executable
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Discord 실행 파일 이름을 확인하지 못했습니다.".to_string())?;
    if !is_discord_name(name) {
        return Err("허용되지 않은 Discord 실행 파일입니다.".to_string());
    }
    let version_dir = executable
        .parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if !version_dir.starts_with("app-") {
        return Err("Discord의 버전별 설치 폴더가 아닌 실행 파일은 허용되지 않습니다.".to_string());
    }
    Ok(())
}

fn stop_matching_processes(executable: &Path) -> Result<(), String> {
    let expected = normalized_path(executable);
    let mut system = System::new_all();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::Always),
    );
    let pids: Vec<Pid> = system
        .processes()
        .values()
        .filter(|process| {
            process
                .exe()
                .is_some_and(|path| normalized_path(path) == expected)
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
    Err("선택한 Discord 프로세스를 종료하지 못했습니다.".to_string())
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

fn wait_for_restarted_process(
    executable: &Path,
    expected_process_id: u32,
    timeout: Duration,
) -> Result<DiscordProcess, String> {
    let expected_path = normalized_path(executable);
    let pid = Pid::from_u32(expected_process_id);
    let deadline = Instant::now() + timeout;
    let mut system = System::new();
    while Instant::now() < deadline {
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[pid]),
            true,
            ProcessRefreshKind::nothing().with_exe(UpdateKind::Always),
        );
        if let Some(process) = system.process(pid) {
            if let Some(actual_path) = process.exe() {
                if normalized_path(actual_path) == expected_path {
                    return Ok(DiscordProcess {
                        process_id: expected_process_id,
                        executable: actual_path.to_path_buf(),
                    });
                }
                return Err(
                    "재시작된 프로세스의 실행 경로가 Discord 설치 경로와 다릅니다.".to_string(),
                );
            }
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("Discord 재실행 요청은 보냈지만 검증된 새 프로세스를 찾지 못했습니다.".to_string())
}

fn normalized_path(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase()
}

fn launchable_windows_path(path: &Path) -> PathBuf {
    let value = path.to_string_lossy();
    value
        .strip_prefix(r"\\?\")
        .map(PathBuf::from)
        .unwrap_or_else(|| path.to_path_buf())
}

fn accessibility_arguments() -> [&'static str; 1] {
    ["--force-renderer-accessibility"]
}

fn compatible_accessibility_arguments<T: AsRef<OsStr>>(arguments: &[T]) -> bool {
    let mut accessibility = false;
    for argument in arguments {
        let value = argument.as_ref().to_string_lossy();
        if value.eq_ignore_ascii_case("--force-renderer-accessibility") {
            accessibility = true;
        }
        if value
            .to_ascii_lowercase()
            .starts_with("--remote-debugging-")
        {
            return false;
        }
    }
    accessibility
}

fn is_discord_name(name: &str) -> bool {
    DISCORD_EXECUTABLES
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(name))
}

#[cfg(test)]
mod tests {
    use super::{
        accessibility_arguments, compatible_accessibility_arguments, installed_executable_in,
        is_discord_name, validate_discord_executable,
    };
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn accessibility_arguments_do_not_open_a_debug_transport() {
        assert_eq!(
            accessibility_arguments(),
            ["--force-renderer-accessibility"]
        );
    }

    #[test]
    fn compatible_accessibility_mode_rejects_all_remote_debugging_transports() {
        assert!(compatible_accessibility_arguments(&[
            "Discord.exe",
            "--force-renderer-accessibility"
        ]));
        assert!(!compatible_accessibility_arguments(&[
            "Discord.exe",
            "--force-renderer-accessibility",
            "--remote-debugging-pipe"
        ]));
        assert!(!compatible_accessibility_arguments(&[
            "Discord.exe",
            "--force-renderer-accessibility",
            "--remote-debugging-port=0"
        ]));
        assert!(!compatible_accessibility_arguments(&["Discord.exe"]));
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
        validate_discord_executable(&executable).unwrap();
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn executable_outside_version_directory_is_rejected() {
        let root = std::env::temp_dir().join(format!(
            "nude-translator-invalid-discord-{}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        let executable = root.join("Discord.exe");
        fs::write(&executable, b"test").unwrap();
        assert!(validate_discord_executable(&executable).is_err());
        let _ = fs::remove_dir_all(root);
    }
}
