use std::env;
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

use crate::cdp::CdpClient;

const DISCORD_EXECUTABLES: [&str; 3] = ["Discord.exe", "DiscordPTB.exe", "DiscordCanary.exe"];
const DISCORD_INSTALLS: [(&str, &str); 3] = [
    ("Discord", "Discord.exe"),
    ("DiscordPTB", "DiscordPTB.exe"),
    ("DiscordCanary", "DiscordCanary.exe"),
];
const RESTART_LEASE_FILE: &str = "accessibility-restart.lock";
const GUARDIAN_STATE_VERSION: u32 = 2;
static GUARDIAN_COPY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiscordVariant {
    Auto,
    Stable,
    Ptb,
    Canary,
}

impl DiscordVariant {
    pub fn from_config(value: &str) -> Result<Self, String> {
        match value {
            "auto" => Ok(Self::Auto),
            "stable" => Ok(Self::Stable),
            "ptb" => Ok(Self::Ptb),
            "canary" => Ok(Self::Canary),
            _ => Err("지원하지 않는 Discord 종류입니다.".to_string()),
        }
    }

    fn install(self) -> Option<(&'static str, &'static str)> {
        match self {
            Self::Auto => None,
            Self::Stable => Some(DISCORD_INSTALLS[0]),
            Self::Ptb => Some(DISCORD_INSTALLS[1]),
            Self::Canary => Some(DISCORD_INSTALLS[2]),
        }
    }

    fn matches_name(self, name: &str) -> bool {
        self.install()
            .is_none_or(|(_, executable)| executable.eq_ignore_ascii_case(name))
    }

    fn display_name(self) -> &'static str {
        match self {
            Self::Auto => "Discord",
            Self::Stable => "Discord",
            Self::Ptb => "Discord PTB",
            Self::Canary => "Discord Canary",
        }
    }
}

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

#[derive(Clone, Debug, Deserialize, Serialize)]
struct PipeGuardianState {
    version: u32,
    guardian_process_id: u32,
    discord_process_id: u32,
    discord_executable: PathBuf,
    reader_handle: usize,
    writer_handle: usize,
}

fn guardian_state_matches_process(state: &PipeGuardianState, process: &DiscordProcess) -> bool {
    state.version == GUARDIAN_STATE_VERSION
        && normalized_path(&state.discord_executable) == normalized_path(&process.executable)
}

fn guardian_state_belongs_to_installation(state: &PipeGuardianState, executable: &Path) -> bool {
    same_discord_installation(&state.discord_executable, executable)
}

pub fn current_process(variant: DiscordVariant) -> Option<DiscordProcess> {
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_exe(UpdateKind::Always)
            .with_cmd(UpdateKind::Always),
    );
    current_process_from_system(&system, variant)
}

pub fn current_pipe_process(variant: DiscordVariant) -> Option<DiscordProcess> {
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
        .filter(|process| variant.matches_name(&process.name().to_string_lossy()))
        .filter(|process| is_main_discord_arguments(process.cmd()))
        .filter(|process| {
            process
                .cmd()
                .iter()
                .any(|argument| argument == "--remote-debugging-pipe")
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

fn current_process_from_system(system: &System, variant: DiscordVariant) -> Option<DiscordProcess> {
    system
        .processes()
        .values()
        .filter(|process| is_discord_name(&process.name().to_string_lossy()))
        .filter(|process| variant.matches_name(&process.name().to_string_lossy()))
        .filter(|process| is_main_discord_arguments(process.cmd()))
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

pub fn restart_pipe(
    expected_process_id: Option<u32>,
    variant: DiscordVariant,
) -> Result<(DiscordProcess, CdpClient), String> {
    let _restart_guard = pipe_restart_lock()
        .lock()
        .map_err(|_| "Discord 보안 파이프 재시작 잠금이 손상되었습니다.".to_string())?;
    let _restart_lease = acquire_restart_lease(Duration::from_secs(15))?;
    let current = current_process(variant);
    let current_id = current.as_ref().map(|process| process.process_id);
    if expected_process_id != current_id {
        return Err(
            "Discord가 카운트다운 도중 다시 실행되어 자동 재시작을 취소했습니다.".to_string(),
        );
    }
    let executable =
        restart_executable_from(current.as_ref(), local_app_data().as_deref(), variant)?;
    stop_installation_processes(&executable, current.as_ref())?;

    #[cfg(windows)]
    {
        let launched = windows_pipe_launcher::launch(&executable)?;
        let process =
            wait_for_restarted_process(&executable, launched.process_id, Duration::from_secs(15))?;
        let mut client = CdpClient::from_pipe(launched.reader, launched.writer);
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_error = "Discord 렌더러가 아직 준비되지 않았습니다.".to_string();
        let mut connected = false;
        while Instant::now() < deadline {
            if !connected {
                match client.connect() {
                    Ok(()) => connected = true,
                    Err(error) => last_error = error,
                }
            }
            if connected {
                match client.evaluate("document.documentElement !== null", false) {
                    Ok(serde_json::Value::Bool(true)) => return Ok((process, client)),
                    Ok(_) => last_error = "Discord DOM이 아직 준비되지 않았습니다.".to_string(),
                    Err(error) => last_error = error,
                }
            }
            thread::sleep(Duration::from_millis(200));
        }
        Err(format!(
            "Discord를 다시 열었지만 보안 CDP 파이프가 준비되지 않았습니다. 마지막 오류: {last_error}"
        ))
    }

    #[cfg(not(windows))]
    {
        let _ = executable;
        Err("Discord 보안 CDP 파이프는 Windows에서만 지원됩니다.".to_string())
    }
}

pub fn disconnect_current_guardian(variant: DiscordVariant) -> Result<(), String> {
    let Some(process) = current_pipe_process(variant) else {
        return Ok(());
    };
    #[cfg(windows)]
    {
        windows_pipe_launcher::disconnect_guardian(&process)
    }
    #[cfg(not(windows))]
    {
        let _ = process;
        Ok(())
    }
}

pub fn restart_vanilla(
    expected_process_id: Option<u32>,
    variant: DiscordVariant,
) -> Result<DiscordProcess, String> {
    let _restart_guard = pipe_restart_lock()
        .lock()
        .map_err(|_| "Discord 재시작 잠금이 손상되었습니다.".to_string())?;
    let _restart_lease = acquire_restart_lease(Duration::from_secs(15))?;
    let current = current_process(variant);
    let current_id = current.as_ref().map(|process| process.process_id);
    if expected_process_id != current_id {
        return Err("Discord가 확인 중에 다시 실행되어 일반 모드 전환을 취소했습니다.".to_string());
    }
    let executable =
        restart_executable_from(current.as_ref(), local_app_data().as_deref(), variant)?;
    disconnect_current_guardian(variant)?;
    stop_installation_processes(&executable, current.as_ref())?;

    let launch_executable = launchable_windows_path(&executable);
    let mut command = std::process::Command::new(&launch_executable);
    configure_background(&mut command);
    let child = command
        .spawn()
        .map_err(|error| format!("일반 Discord를 시작하지 못했습니다: {error}"))?;
    wait_for_restarted_process(&executable, child.id(), Duration::from_secs(15))
}

pub fn connect_guarded_pipe(process: &DiscordProcess) -> Result<CdpClient, String> {
    #[cfg(windows)]
    {
        windows_pipe_launcher::connect_guarded_pipe(process)
    }
    #[cfg(not(windows))]
    {
        let _ = process;
        Err("Discord 보안 파이프 가디언은 Windows에서만 지원됩니다.".to_string())
    }
}

pub fn connect_or_restart_pipe(
    expected_process_id: Option<u32>,
    variant: DiscordVariant,
) -> Result<(DiscordProcess, CdpClient), String> {
    if let Some(process) = current_pipe_process(variant) {
        if expected_process_id.is_some_and(|expected| expected != process.process_id) {
            return Err(
                "Discord가 카운트다운 도중 다시 실행되어 자동 재시작을 취소했습니다.".to_string(),
            );
        }
        if let Ok(client) = connect_guarded_pipe(&process) {
            return Ok((process, client));
        }
        return restart_pipe(Some(process.process_id), variant);
    }
    restart_pipe(expected_process_id, variant)
}

fn pipe_restart_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn integration_root() -> PathBuf {
    env::var_os("LOCALAPPDATA")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir)
        .join("NudeNyang")
        .join("DiscordIntegration")
}

fn guardian_executable_path(
    root: &Path,
    owner_process_id: u32,
    discord_process_id: u32,
    launched_at_nanos: u128,
    sequence: u64,
) -> PathBuf {
    root.join(format!(
        "nudenyang-discord-pipe-guardian-{owner_process_id}-{discord_process_id}-{launched_at_nanos}-{sequence}.exe"
    ))
}

fn guardian_state_path(discord_process_id: u32) -> PathBuf {
    integration_root().join(format!("cdp-pipe-guardian-{discord_process_id}.json"))
}

fn acquire_restart_lease(timeout: Duration) -> Result<File, String> {
    let root = integration_root();
    std::fs::create_dir_all(&root)
        .map_err(|error| format!("Discord 실행 조율 폴더를 만들지 못했습니다: {error}"))?;
    let path = root.join(RESTART_LEASE_FILE);
    let deadline = Instant::now() + timeout;
    loop {
        let file = match OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&path)
        {
            Ok(file) => file,
            Err(_) if Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(error) => {
                return Err(format!(
                    "Discord 재시작 잠금 파일을 열지 못했습니다: {error}"
                ))
            }
        };
        match FileExt::try_lock_exclusive(&file) {
            Ok(()) => return Ok(file),
            Err(error) if Instant::now() < deadline => {
                let _ = error;
                thread::sleep(Duration::from_millis(100));
            }
            Err(error) => {
                return Err(format!(
                    "다른 프로그램이 Discord 실행을 조정 중이라 기다리지 못했습니다: {error}"
                ))
            }
        }
    }
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

fn stop_installation_processes(
    executable: &Path,
    current: Option<&DiscordProcess>,
) -> Result<(), String> {
    let current_process_id = current.map(|process| process.process_id);
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
            is_discord_name(&process.name().to_string_lossy())
                && (current_process_id.is_some_and(|id| id == process.pid().as_u32())
                    || process
                        .exe()
                        .is_some_and(|path| same_discord_installation(path, executable)))
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

fn local_app_data() -> Option<PathBuf> {
    env::var_os("LOCALAPPDATA")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn restart_executable_from(
    current: Option<&DiscordProcess>,
    local_app_data: Option<&Path>,
    variant: DiscordVariant,
) -> Result<PathBuf, String> {
    let preferred_name = variant
        .install()
        .map(|(_, executable)| executable)
        .or_else(|| {
            current
                .and_then(|process| process.executable.file_name())
                .and_then(|name| name.to_str())
                .filter(|name| is_discord_name(name))
        });
    let mut candidates = Vec::new();
    if let Some(process) = current.filter(|process| {
        process
            .executable
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| variant.matches_name(name))
    }) {
        candidates.push(process.executable.clone());
        if let Some(replacement) = replacement_executable(&process.executable) {
            candidates.push(replacement);
        }
    }
    if let Some(local_app_data) = local_app_data {
        if let Some(installed) = installed_executable_for(local_app_data, variant, preferred_name) {
            candidates.push(installed);
        }
    }

    for candidate in candidates {
        let Ok(canonical) = candidate.canonicalize() else {
            continue;
        };
        if validate_discord_executable(&canonical).is_ok() {
            return Ok(canonical);
        }
    }

    Err(format!(
        "{} 설치 경로를 찾지 못했습니다. 선택한 Discord를 설치하거나 한 번 직접 실행한 뒤 재시도하십시오.",
        variant.display_name()
    ))
}

#[cfg(test)]
fn installed_executable_in(local_app_data: &Path) -> Option<PathBuf> {
    installed_executable_for(local_app_data, DiscordVariant::Auto, None)
}

fn installed_executable_for(
    local_app_data: &Path,
    variant: DiscordVariant,
    preferred_name: Option<&str>,
) -> Option<PathBuf> {
    if let Some((directory, executable_name)) = variant.install() {
        return latest_executable_in(&local_app_data.join(directory), executable_name);
    }
    if let Some(preferred_name) = preferred_name {
        let (directory, executable_name) = DISCORD_INSTALLS
            .iter()
            .copied()
            .find(|(_, executable)| executable.eq_ignore_ascii_case(preferred_name))?;
        return latest_executable_in(&local_app_data.join(directory), executable_name);
    }
    let installs = DISCORD_INSTALLS.to_vec();
    installs
        .into_iter()
        .find_map(|(directory, executable_name)| {
            latest_executable_in(&local_app_data.join(directory), executable_name)
        })
}

fn replacement_executable(reported: &Path) -> Option<PathBuf> {
    let (root, executable_name) = discord_install_identity(reported)?;
    latest_executable_in(&root, &executable_name)
}

fn latest_executable_in(root: &Path, executable_name: &str) -> Option<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return None;
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
    versions
        .into_iter()
        .map(|version| version.join(executable_name))
        .find(|candidate| candidate.is_file())
        .and_then(|found| found.canonicalize().ok().or(Some(found)))
}

fn discord_install_identity(path: &Path) -> Option<(PathBuf, String)> {
    let executable_name = path.file_name()?.to_str()?;
    let version = path.parent()?;
    if !version
        .file_name()
        .is_some_and(|name| name.to_string_lossy().starts_with("app-"))
    {
        return None;
    }
    let root = version.parent()?;
    let root_name = root.file_name()?.to_str()?;
    DISCORD_INSTALLS
        .iter()
        .any(|(directory, expected_executable)| {
            directory.eq_ignore_ascii_case(root_name)
                && expected_executable.eq_ignore_ascii_case(executable_name)
        })
        .then(|| (root.to_path_buf(), executable_name.to_ascii_lowercase()))
}

fn same_discord_installation(left: &Path, right: &Path) -> bool {
    let Some((left_root, left_name)) = discord_install_identity(left) else {
        return false;
    };
    let Some((right_root, right_name)) = discord_install_identity(right) else {
        return false;
    };
    left_name == right_name && normalized_path(&left_root) == normalized_path(&right_root)
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

fn discord_debug_arguments() -> [&'static str; 2] {
    ["--force-renderer-accessibility", "--remote-debugging-pipe"]
}

fn is_discord_name(name: &str) -> bool {
    DISCORD_EXECUTABLES
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(name))
}

fn is_main_discord_arguments(arguments: &[std::ffi::OsString]) -> bool {
    !arguments
        .iter()
        .any(|argument| argument.to_string_lossy().starts_with("--type="))
}

#[cfg(windows)]
mod windows_pipe_launcher {
    use super::configure_background;
    use super::{
        discord_debug_arguments, guardian_executable_path, guardian_state_belongs_to_installation,
        guardian_state_matches_process, guardian_state_path, integration_root, is_discord_name,
        is_main_discord_arguments, normalized_path, validate_discord_executable, DiscordProcess,
        PipeGuardianState, GUARDIAN_COPY_SEQUENCE, GUARDIAN_STATE_VERSION,
    };
    use std::fs::File;
    use std::io::{BufRead, BufReader};
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, IntoRawHandle};
    use std::path::Path;
    use std::process::{Command, Stdio};
    use std::sync::atomic::Ordering;
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    use windows_sys::Win32::Foundation::{
        CloseHandle, DuplicateHandle, DUPLICATE_SAME_ACCESS, HANDLE,
    };
    use windows_sys::Win32::System::Console::{GetStdHandle, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE};
    use windows_sys::Win32::System::Threading::{
        CreateProcessW, DeleteProcThreadAttributeList, GetCurrentProcess,
        InitializeProcThreadAttributeList, OpenProcess, UpdateProcThreadAttribute,
        EXTENDED_STARTUPINFO_PRESENT, PROCESS_DUP_HANDLE, PROCESS_INFORMATION,
        PROC_THREAD_ATTRIBUTE_HANDLE_LIST, STARTUPINFOEXW,
    };

    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

    use crate::{cdp::CdpClient, diagnostics};

    pub(super) struct PipeLaunch {
        pub process_id: u32,
        pub reader: File,
        pub writer: File,
    }

    struct OwnedHandle(HANDLE);

    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    impl OwnedHandle {
        fn into_file(self) -> File {
            let handle = self.0;
            std::mem::forget(self);
            unsafe { File::from_raw_handle(handle) }
        }
    }

    pub(super) fn launch(executable: &Path) -> Result<PipeLaunch, String> {
        prepare_guardian_session(executable);
        let helper = std::env::current_exe()
            .map_err(|error| format!("보안 파이프 헬퍼 경로를 찾지 못했습니다: {error}"))?;
        let mut command = Command::new(helper);
        command
            .arg("--discord-cdp-pipe-helper")
            .arg(executable)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_background(&mut command);
        let mut child = command
            .spawn()
            .map_err(|error| format!("Discord 보안 파이프 헬퍼를 시작하지 못했습니다: {error}"))?;
        let parent_write = child
            .stdin
            .take()
            .ok_or_else(|| "Discord CDP 입력 파이프를 받지 못했습니다.".to_string())?;
        let parent_read = child
            .stdout
            .take()
            .ok_or_else(|| "Discord CDP 출력 파이프를 받지 못했습니다.".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Discord 보안 헬퍼 상태 파이프를 받지 못했습니다.".to_string())?;
        let mut status = String::new();
        BufReader::new(stderr)
            .read_line(&mut status)
            .map_err(|error| format!("Discord 보안 헬퍼 상태를 읽지 못했습니다: {error}"))?;
        let process_id = status
            .trim()
            .strip_prefix("PID=")
            .and_then(|value| value.parse::<u32>().ok())
            .ok_or_else(|| {
                format!(
                    "Discord 보안 헬퍼 응답이 올바르지 않습니다: {}",
                    status.trim()
                )
            })?;
        let reader = unsafe { File::from_raw_handle(parent_read.into_raw_handle()) };
        let writer = unsafe { File::from_raw_handle(parent_write.into_raw_handle()) };
        start_guardian(process_id, executable, &reader, &writer)?;
        Ok(PipeLaunch {
            process_id,
            reader,
            writer,
        })
    }

    fn start_guardian(
        discord_process_id: u32,
        discord_executable: &Path,
        reader: &File,
        writer: &File,
    ) -> Result<(), String> {
        let source = std::env::current_exe()
            .map_err(|error| format!("보안 파이프 가디언 경로를 찾지 못했습니다: {error}"))?;
        let discord_executable = discord_executable.canonicalize().map_err(|error| {
            format!("Discord 보안 파이프 실행 경로를 확인하지 못했습니다: {error}")
        })?;
        let root = integration_root();
        std::fs::create_dir_all(&root)
            .map_err(|error| format!("보안 파이프 가디언 폴더를 만들지 못했습니다: {error}"))?;
        cleanup_stale_guardian_artifacts(&root);
        let _ = std::fs::remove_file(guardian_state_path(discord_process_id));
        let launched_at_nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let sequence = GUARDIAN_COPY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let guardian = guardian_executable_path(
            &root,
            std::process::id(),
            discord_process_id,
            launched_at_nanos,
            sequence,
        );
        std::fs::copy(&source, &guardian)
            .map_err(|error| format!("보안 파이프 가디언을 준비하지 못했습니다: {error}"))?;
        let reader_copy = duplicate_inheritable_handle(reader.as_raw_handle())?;
        let writer_copy = duplicate_inheritable_handle(writer.as_raw_handle())?;
        let discord_id = discord_process_id.to_string();
        let reader_id = (reader_copy.0 as usize).to_string();
        let writer_id = (writer_copy.0 as usize).to_string();
        let guardian_process_id = spawn_process_with_handles(
            &guardian,
            &[
                guardian.as_os_str(),
                std::ffi::OsStr::new("--discord-cdp-pipe-guardian"),
                std::ffi::OsStr::new(&discord_id),
                discord_executable.as_os_str(),
                std::ffi::OsStr::new(&reader_id),
                std::ffi::OsStr::new(&writer_id),
            ],
            &[reader_copy.0, writer_copy.0],
        )?;
        wait_for_guardian_state(discord_process_id, guardian_process_id)
    }

    fn prepare_guardian_session(executable: &Path) {
        let root = integration_root();
        let Ok(entries) = std::fs::read_dir(root) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.file_name().is_some_and(|name| {
                let name = name.to_string_lossy();
                name.starts_with("cdp-pipe-guardian-") && name.ends_with(".json")
            }) && std::fs::read_to_string(&path)
                .ok()
                .and_then(|contents| serde_json::from_str::<PipeGuardianState>(&contents).ok())
                .is_some_and(|state| guardian_state_belongs_to_installation(&state, executable))
            {
                // Removing the state file is also the authenticated shutdown signal
                // for an older guardian left by the selected Discord installation.
                let _ = std::fs::remove_file(path);
            }
        }
    }

    fn cleanup_stale_guardian_artifacts(root: &Path) {
        let Ok(entries) = std::fs::read_dir(root) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            let is_guardian_copy =
                name.starts_with("nudenyang-discord-pipe-guardian-") && name.ends_with(".exe");
            let is_guardian_state =
                name.starts_with("cdp-pipe-guardian-") && name.ends_with(".json");
            if is_guardian_state {
                let active = std::fs::read_to_string(&path)
                    .ok()
                    .and_then(|contents| serde_json::from_str::<PipeGuardianState>(&contents).ok())
                    .is_some_and(|state| {
                        state.version == GUARDIAN_STATE_VERSION
                            && process_exists(state.guardian_process_id)
                    });
                if !active {
                    let _ = std::fs::remove_file(path);
                }
            } else if is_guardian_copy {
                // Windows refuses to remove a running executable. That makes this
                // best-effort cleanup safe for the active guardian while removing
                // copies left by processes that already exited.
                let _ = std::fs::remove_file(path);
            }
        }
    }

    fn process_exists(process_id: u32) -> bool {
        let pid = Pid::from_u32(process_id);
        let mut system = System::new();
        system.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
        system.process(pid).is_some()
    }

    fn wait_for_guardian_state(
        discord_process_id: u32,
        guardian_process_id: u32,
    ) -> Result<(), String> {
        let path = guardian_state_path(discord_process_id);
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if let Ok(contents) = std::fs::read_to_string(&path) {
                if serde_json::from_str::<PipeGuardianState>(&contents).is_ok_and(|state| {
                    state.version == GUARDIAN_STATE_VERSION
                        && state.discord_process_id == discord_process_id
                        && state.guardian_process_id == guardian_process_id
                }) {
                    return Ok(());
                }
            }
            thread::sleep(Duration::from_millis(50));
        }
        Err("Discord 보안 파이프 가디언이 준비되지 않았습니다.".to_string())
    }

    pub(super) fn run_helper(executable: &Path) -> Result<u32, String> {
        let executable = executable
            .canonicalize()
            .map_err(|error| format!("Discord 실행 경로를 확인하지 못했습니다: {error}"))?;
        validate_discord_executable(&executable)?;
        let launch_executable = super::launchable_windows_path(&executable);
        let input_handle = duplicate_inheritable_standard_handle(STD_INPUT_HANDLE)?;
        let output_handle = duplicate_inheritable_standard_handle(STD_OUTPUT_HANDLE)?;
        let io_pipes = format!(
            "--remote-debugging-io-pipes={},{}",
            input_handle.0 as usize, output_handle.0 as usize
        );
        let mut arguments = Vec::with_capacity(discord_debug_arguments().len() + 2);
        arguments.push(launch_executable.as_os_str());
        for argument in discord_debug_arguments() {
            arguments.push(std::ffi::OsStr::new(argument));
        }
        arguments.push(std::ffi::OsStr::new(&io_pipes));
        spawn_discord_with_handles(
            &launch_executable,
            &arguments,
            &[input_handle.0, output_handle.0],
        )
    }

    fn spawn_discord_with_handles(
        executable: &Path,
        arguments: &[&std::ffi::OsStr],
        inherited_handles: &[HANDLE],
    ) -> Result<u32, String> {
        spawn_process_with_handles(executable, arguments, inherited_handles)
    }

    fn spawn_process_with_handles(
        executable: &Path,
        arguments: &[&std::ffi::OsStr],
        inherited_handles: &[HANDLE],
    ) -> Result<u32, String> {
        let executable_wide = wide(executable.as_os_str());
        let command_line = arguments
            .iter()
            .map(|argument| quote_windows_argument(argument))
            .collect::<Vec<_>>()
            .join(" ");
        let mut command_line_wide = wide(std::ffi::OsStr::new(&command_line));

        let mut attribute_size = 0_usize;
        unsafe {
            InitializeProcThreadAttributeList(std::ptr::null_mut(), 1, 0, &mut attribute_size);
        }
        if attribute_size == 0 {
            return Err("Discord 프로세스 핸들 목록 크기를 계산하지 못했습니다.".to_string());
        }
        let attribute_words = attribute_size.div_ceil(std::mem::size_of::<usize>());
        let mut attribute_storage = vec![0_usize; attribute_words];
        let attribute_list = attribute_storage.as_mut_ptr().cast();
        if unsafe { InitializeProcThreadAttributeList(attribute_list, 1, 0, &mut attribute_size) }
            == 0
        {
            return Err(format!(
                "Discord 프로세스 핸들 목록을 만들지 못했습니다: {}",
                std::io::Error::last_os_error()
            ));
        }
        let updated = unsafe {
            UpdateProcThreadAttribute(
                attribute_list,
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                inherited_handles.as_ptr().cast(),
                std::mem::size_of_val(inherited_handles),
                std::ptr::null_mut(),
                std::ptr::null(),
            )
        };
        if updated == 0 {
            unsafe {
                DeleteProcThreadAttributeList(attribute_list);
            }
            return Err(format!(
                "Discord 상속 핸들을 제한하지 못했습니다: {}",
                std::io::Error::last_os_error()
            ));
        }

        let mut startup = STARTUPINFOEXW::default();
        startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
        startup.lpAttributeList = attribute_list;
        let mut process = PROCESS_INFORMATION::default();
        let created = unsafe {
            CreateProcessW(
                executable_wide.as_ptr(),
                command_line_wide.as_mut_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
                EXTENDED_STARTUPINFO_PRESENT | super::CREATE_NO_WINDOW,
                std::ptr::null(),
                std::ptr::null(),
                &startup.StartupInfo,
                &mut process,
            )
        };
        unsafe {
            DeleteProcThreadAttributeList(attribute_list);
        }
        if created == 0 {
            return Err(format!(
                "Discord를 제한된 보안 파이프로 실행하지 못했습니다: {}",
                std::io::Error::last_os_error()
            ));
        }
        let process_id = process.dwProcessId;
        unsafe {
            CloseHandle(process.hThread);
            CloseHandle(process.hProcess);
        }
        if process_id == 0 {
            return Err("Discord 보안 프로세스 ID를 확인하지 못했습니다.".to_string());
        }
        eprintln!("PID={process_id}");
        Ok(process_id)
    }

    fn quote_windows_argument(value: &std::ffi::OsStr) -> String {
        let value = value.to_string_lossy();
        format!("\"{}\"", value.replace('"', "\\\""))
    }

    fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
        value.encode_wide().chain(Some(0)).collect()
    }

    fn duplicate_inheritable_standard_handle(
        standard: windows_sys::Win32::System::Console::STD_HANDLE,
    ) -> Result<OwnedHandle, String> {
        let source = unsafe { GetStdHandle(standard) };
        if source.is_null() {
            return Err("Discord CDP 표준 파이프 핸들이 없습니다.".to_string());
        }
        duplicate_inheritable_handle(source)
    }

    fn duplicate_inheritable_handle(source: HANDLE) -> Result<OwnedHandle, String> {
        let current_process = unsafe { GetCurrentProcess() };
        let mut inherited: HANDLE = std::ptr::null_mut();
        if unsafe {
            DuplicateHandle(
                current_process,
                source,
                current_process,
                &mut inherited,
                0,
                1,
                DUPLICATE_SAME_ACCESS,
            )
        } == 0
        {
            return Err(format!(
                "Discord CDP 표준 파이프를 상속용으로 복제하지 못했습니다: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(OwnedHandle(inherited))
    }

    pub(super) fn run_guardian(
        discord_process_id: u32,
        discord_executable: &Path,
        reader_handle: usize,
        writer_handle: usize,
    ) -> Result<(), String> {
        if reader_handle == 0 || writer_handle == 0 {
            return Err("Discord 보안 파이프 가디언 핸들이 없습니다.".to_string());
        }
        let discord_executable = discord_executable.canonicalize().map_err(|error| {
            format!("Discord 보안 파이프 실행 경로를 확인하지 못했습니다: {error}")
        })?;
        validate_discord_executable(&discord_executable)?;
        let _reader = unsafe { File::from_raw_handle(reader_handle as HANDLE) };
        let _writer = unsafe { File::from_raw_handle(writer_handle as HANDLE) };
        let path = guardian_state_path(discord_process_id);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!("Discord 보안 파이프 가디언 폴더를 만들지 못했습니다: {error}")
            })?;
        }
        let state = PipeGuardianState {
            version: GUARDIAN_STATE_VERSION,
            guardian_process_id: std::process::id(),
            discord_process_id,
            discord_executable: discord_executable.clone(),
            reader_handle,
            writer_handle,
        };
        let serialized = serde_json::to_vec(&state)
            .map_err(|error| format!("Discord 보안 파이프 상태를 만들지 못했습니다: {error}"))?;
        std::fs::write(&path, serialized)
            .map_err(|error| format!("Discord 보안 파이프 상태를 저장하지 못했습니다: {error}"))?;

        let mut system = System::new();
        let mut last_matching_process = Instant::now();
        loop {
            if !path.is_file() {
                break;
            }
            system.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing()
                    .with_exe(UpdateKind::Always)
                    .with_cmd(UpdateKind::Always),
            );
            if matching_pipe_discord_exists(&system, &discord_executable) {
                last_matching_process = Instant::now();
            } else if last_matching_process.elapsed() >= Duration::from_secs(15) {
                break;
            }
            thread::sleep(Duration::from_millis(500));
        }
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    fn matching_pipe_discord_exists(system: &System, executable: &Path) -> bool {
        let expected = normalized_path(executable);
        system.processes().values().any(|process| {
            is_discord_name(&process.name().to_string_lossy())
                && is_main_discord_arguments(process.cmd())
                && process
                    .exe()
                    .is_some_and(|path| normalized_path(path) == expected)
                && process
                    .cmd()
                    .iter()
                    .any(|argument| argument == "--remote-debugging-pipe")
        })
    }

    pub(super) fn connect_guarded_pipe(process: &DiscordProcess) -> Result<CdpClient, String> {
        let state = guardian_state_for_process(process)?;
        if state.discord_process_id != process.process_id {
            diagnostics::info(
                "discord-connection",
                &format!(
                    "guardian pipe recovered after Discord PID handoff; original_pid={}; current_pid={}; executable={}",
                    state.discord_process_id,
                    process.process_id,
                    process.executable.display()
                ),
            );
        }
        validate_guardian_process(&state)?;
        let guardian = unsafe { OpenProcess(PROCESS_DUP_HANDLE, 0, state.guardian_process_id) };
        if guardian.is_null() {
            return Err(format!(
                "Discord 보안 파이프 가디언을 열지 못했습니다: {}",
                std::io::Error::last_os_error()
            ));
        }
        let guardian = OwnedHandle(guardian);
        let reader =
            duplicate_remote_handle(guardian.0, state.reader_handle as HANDLE)?.into_file();
        let writer =
            duplicate_remote_handle(guardian.0, state.writer_handle as HANDLE)?.into_file();
        Ok(CdpClient::from_pipe(reader, writer))
    }

    pub(super) fn disconnect_guardian(process: &DiscordProcess) -> Result<(), String> {
        let Ok(state) = guardian_state_for_process(process) else {
            return Ok(());
        };
        validate_guardian_process(&state)?;
        let path = guardian_state_path(state.discord_process_id);
        if path.is_file() {
            std::fs::remove_file(&path).map_err(|error| {
                format!("Discord 보안 파이프 가디언을 분리하지 못했습니다: {error}")
            })?;
        }
        let guardian_pid = Pid::from_u32(state.guardian_process_id);
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut system = System::new();
        while Instant::now() < deadline {
            system.refresh_processes(ProcessesToUpdate::Some(&[guardian_pid]), true);
            if system.process(guardian_pid).is_none() {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(50));
        }
        Err("Discord 보안 파이프 가디언이 제한 시간 안에 종료되지 않았습니다.".to_string())
    }

    fn guardian_state_for_process(process: &DiscordProcess) -> Result<PipeGuardianState, String> {
        let exact = guardian_state_path(process.process_id);
        let mut candidates = Vec::new();
        if exact.is_file() {
            candidates.push(exact.clone());
        }
        if let Ok(entries) = std::fs::read_dir(integration_root()) {
            let mut other = entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path != &exact)
                .filter(|path| {
                    path.file_name().is_some_and(|name| {
                        let name = name.to_string_lossy();
                        name.starts_with("cdp-pipe-guardian-") && name.ends_with(".json")
                    })
                })
                .collect::<Vec<_>>();
            other.sort_by_key(|path| {
                std::fs::metadata(path)
                    .and_then(|metadata| metadata.modified())
                    .ok()
            });
            other.reverse();
            candidates.extend(other);
        }

        for path in candidates {
            let Ok(contents) = std::fs::read_to_string(path) else {
                continue;
            };
            let Ok(state) = serde_json::from_str::<PipeGuardianState>(&contents) else {
                continue;
            };
            if guardian_state_matches_process(&state, process)
                && validate_guardian_process(&state).is_ok()
            {
                return Ok(state);
            }
        }
        Err("현재 Discord 설치 경로와 일치하는 보안 파이프 가디언을 찾지 못했습니다.".to_string())
    }

    fn validate_guardian_process(state: &PipeGuardianState) -> Result<(), String> {
        let guardian_pid = Pid::from_u32(state.guardian_process_id);
        let mut system = System::new();
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[guardian_pid]),
            true,
            ProcessRefreshKind::nothing()
                .with_exe(UpdateKind::Always)
                .with_cmd(UpdateKind::Always),
        );
        let process = system
            .process(guardian_pid)
            .ok_or_else(|| "Discord 보안 파이프 가디언이 종료되었습니다.".to_string())?;
        if !process.exe().is_some_and(is_guardian_executable_path) {
            return Err("Discord 보안 파이프 가디언 실행 파일이 일치하지 않습니다.".to_string());
        }
        let expected_discord_id = state.discord_process_id.to_string();
        let expected_executable = normalized_path(&state.discord_executable);
        let arguments = process
            .cmd()
            .iter()
            .map(|value| value.to_string_lossy())
            .collect::<Vec<_>>();
        if !arguments
            .iter()
            .any(|argument| argument == "--discord-cdp-pipe-guardian")
            || !arguments
                .iter()
                .any(|argument| argument == &expected_discord_id)
            || !arguments.iter().any(|argument| {
                normalized_path(Path::new(argument.as_ref())) == expected_executable
            })
        {
            return Err("Discord 보안 파이프 가디언 인수가 일치하지 않습니다.".to_string());
        }
        Ok(())
    }

    fn is_guardian_executable_path(path: &Path) -> bool {
        let root = integration_root();
        path.parent()
            .is_some_and(|parent| normalized_path(parent) == normalized_path(&root))
            && path.file_name().is_some_and(|name| {
                let name = name.to_string_lossy();
                name.starts_with("nudenyang-discord-pipe-guardian-") && name.ends_with(".exe")
            })
    }

    fn duplicate_remote_handle(process: HANDLE, source: HANDLE) -> Result<OwnedHandle, String> {
        let mut duplicate: HANDLE = std::ptr::null_mut();
        if unsafe {
            DuplicateHandle(
                process,
                source,
                GetCurrentProcess(),
                &mut duplicate,
                0,
                0,
                DUPLICATE_SAME_ACCESS,
            )
        } == 0
        {
            return Err(format!(
                "Discord 보안 파이프 핸들을 넘겨받지 못했습니다: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(OwnedHandle(duplicate))
    }
}

#[cfg(windows)]
pub fn run_pipe_helper(executable: &Path) -> Result<u32, String> {
    windows_pipe_launcher::run_helper(executable)
}

#[cfg(windows)]
pub fn run_pipe_guardian(
    discord_process_id: u32,
    discord_executable: &Path,
    reader_handle: usize,
    writer_handle: usize,
) -> Result<(), String> {
    windows_pipe_launcher::run_guardian(
        discord_process_id,
        discord_executable,
        reader_handle,
        writer_handle,
    )
}

#[cfg(not(windows))]
pub fn run_pipe_helper(_executable: &Path) -> Result<u32, String> {
    Err("Discord 보안 CDP 파이프는 Windows에서만 지원됩니다.".to_string())
}

#[cfg(not(windows))]
pub fn run_pipe_guardian(
    _discord_process_id: u32,
    _discord_executable: &Path,
    _reader_handle: usize,
    _writer_handle: usize,
) -> Result<(), String> {
    Err("Discord 보안 CDP 파이프 가디언은 Windows에서만 지원됩니다.".to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        discord_debug_arguments, guardian_executable_path, guardian_state_belongs_to_installation,
        guardian_state_matches_process, installed_executable_for, installed_executable_in,
        is_discord_name, is_main_discord_arguments, restart_executable_from,
        same_discord_installation, validate_discord_executable, DiscordProcess, DiscordVariant,
        PipeGuardianState, GUARDIAN_STATE_VERSION,
    };
    use std::ffi::OsString;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn debug_arguments_use_private_electron_pipe() {
        assert_eq!(
            discord_debug_arguments(),
            ["--force-renderer-accessibility", "--remote-debugging-pipe"]
        );
    }

    #[test]
    fn discord_process_names_are_case_insensitive() {
        assert!(is_discord_name("discord.exe"));
        assert!(is_discord_name("DiscordCanary.exe"));
        assert!(!is_discord_name("DiscordHelper.exe"));
        assert!(DiscordVariant::Stable.matches_name("discord.exe"));
        assert!(DiscordVariant::Ptb.matches_name("DiscordPTB.exe"));
        assert!(DiscordVariant::Canary.matches_name("discordcanary.exe"));
        assert!(!DiscordVariant::Stable.matches_name("DiscordCanary.exe"));
        assert!(DiscordVariant::Auto.matches_name("DiscordCanary.exe"));
    }

    #[test]
    fn renderer_children_are_never_selected_as_the_pipe_owner() {
        assert!(is_main_discord_arguments(&[
            OsString::from("Discord.exe"),
            OsString::from("--remote-debugging-pipe"),
        ]));
        assert!(!is_main_discord_arguments(&[
            OsString::from("Discord.exe"),
            OsString::from("--type=renderer"),
            OsString::from("--remote-debugging-pipe"),
        ]));
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
    fn stale_running_version_falls_back_to_the_latest_installed_discord() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("nude-translator-discord-stale-{nonce}"));
        let stale = root.join("Discord").join("app-1.0.0").join("Discord.exe");
        let latest = root.join("Discord").join("app-2.0.0").join("Discord.exe");
        fs::create_dir_all(latest.parent().unwrap()).unwrap();
        fs::write(&latest, b"test").unwrap();
        let current = DiscordProcess {
            process_id: 42,
            executable: stale,
        };

        let selected =
            restart_executable_from(Some(&current), Some(&root), DiscordVariant::Auto).unwrap();

        assert_eq!(selected, latest.canonicalize().unwrap());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stale_canary_version_does_not_fall_back_to_stable_discord() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("nude-translator-canary-stale-{nonce}"));
        let stale = root
            .join("DiscordCanary")
            .join("app-1.0.0")
            .join("DiscordCanary.exe");
        let canary = root
            .join("DiscordCanary")
            .join("app-2.0.0")
            .join("DiscordCanary.exe");
        let stable = root.join("Discord").join("app-9.0.0").join("Discord.exe");
        for executable in [&canary, &stable] {
            fs::create_dir_all(executable.parent().unwrap()).unwrap();
            fs::write(executable, b"test").unwrap();
        }
        let current = DiscordProcess {
            process_id: 42,
            executable: stale,
        };

        let selected =
            restart_executable_from(Some(&current), Some(&root), DiscordVariant::Auto).unwrap();

        assert_eq!(selected, canary.canonicalize().unwrap());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn explicit_discord_variant_never_falls_back_to_another_release() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("nude-translator-discord-target-{nonce}"));
        let stable = root.join("Discord").join("app-9.0.0").join("Discord.exe");
        fs::create_dir_all(stable.parent().unwrap()).unwrap();
        fs::write(&stable, b"test").unwrap();

        assert!(installed_executable_for(&root, DiscordVariant::Canary, None).is_none());
        assert!(restart_executable_from(None, Some(&root), DiscordVariant::Canary).is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn explicit_discord_variant_selects_only_its_installation() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("nude-translator-discord-ptb-{nonce}"));
        let stable = root.join("Discord").join("app-9.0.0").join("Discord.exe");
        let ptb = root
            .join("DiscordPTB")
            .join("app-1.0.0")
            .join("DiscordPTB.exe");
        for executable in [&stable, &ptb] {
            fs::create_dir_all(executable.parent().unwrap()).unwrap();
            fs::write(executable, b"test").unwrap();
        }

        let selected = restart_executable_from(None, Some(&root), DiscordVariant::Ptb).unwrap();
        assert_eq!(selected, ptb.canonicalize().unwrap());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn discord_install_family_matches_versions_but_not_release_channels() {
        let old_stable =
            std::path::Path::new(r"C:\Users\tester\AppData\Local\Discord\app-1.0.0\Discord.exe");
        let new_stable =
            std::path::Path::new(r"C:\Users\tester\AppData\Local\Discord\app-2.0.0\Discord.exe");
        let canary = std::path::Path::new(
            r"C:\Users\tester\AppData\Local\DiscordCanary\app-2.0.0\DiscordCanary.exe",
        );

        assert!(same_discord_installation(old_stable, new_stable));
        assert!(!same_discord_installation(old_stable, canary));
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

    #[test]
    fn guardian_session_accepts_a_replacement_pid_from_the_same_discord_installation() {
        let executable = std::path::PathBuf::from(
            r"C:\Users\tester\AppData\Local\Discord\app-1.0.999\Discord.exe",
        );
        let state = PipeGuardianState {
            version: GUARDIAN_STATE_VERSION,
            guardian_process_id: 20,
            discord_process_id: 30,
            discord_executable: executable.clone(),
            reader_handle: 40,
            writer_handle: 50,
        };
        let replacement = DiscordProcess {
            process_id: 31,
            executable,
        };

        assert!(guardian_state_matches_process(&state, &replacement));
    }

    #[test]
    fn guardian_session_rejects_a_different_discord_installation() {
        let state = PipeGuardianState {
            version: GUARDIAN_STATE_VERSION,
            guardian_process_id: 20,
            discord_process_id: 30,
            discord_executable: std::path::PathBuf::from(
                r"C:\Users\tester\AppData\Local\Discord\app-1.0.999\Discord.exe",
            ),
            reader_handle: 40,
            writer_handle: 50,
        };
        let canary = DiscordProcess {
            process_id: 31,
            executable: std::path::PathBuf::from(
                r"C:\Users\tester\AppData\Local\DiscordCanary\app-1.0.999\DiscordCanary.exe",
            ),
        };

        assert!(!guardian_state_matches_process(&state, &canary));
    }

    #[test]
    fn guardian_cleanup_keeps_other_discord_release_channels_running() {
        let stable = PathBuf::from(r"C:\Users\test\AppData\Local\Discord\app-1.0.0\Discord.exe");
        let newer_stable =
            PathBuf::from(r"C:\Users\test\AppData\Local\Discord\app-2.0.0\Discord.exe");
        let canary =
            PathBuf::from(r"C:\Users\test\AppData\Local\DiscordCanary\app-1.0.0\DiscordCanary.exe");
        let state = PipeGuardianState {
            version: GUARDIAN_STATE_VERSION,
            guardian_process_id: 10,
            discord_process_id: 20,
            discord_executable: stable,
            reader_handle: 30,
            writer_handle: 40,
        };

        assert!(guardian_state_belongs_to_installation(
            &state,
            &newer_stable
        ));
        assert!(!guardian_state_belongs_to_installation(&state, &canary));
    }

    #[test]
    fn each_guardian_launch_uses_a_distinct_executable_path() {
        let root =
            std::path::Path::new(r"C:\Users\tester\AppData\Local\NudeNyang\DiscordIntegration");
        let first = guardian_executable_path(root, 100, 200, 300, 0);
        let second = guardian_executable_path(root, 100, 200, 301, 1);

        assert_ne!(first, second);
        assert!(first.file_name().is_some_and(|name| {
            let name = name.to_string_lossy();
            name.starts_with("nudenyang-discord-pipe-guardian-100-200-") && name.ends_with(".exe")
        }));
    }
}
