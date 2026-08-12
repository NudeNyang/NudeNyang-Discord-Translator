use std::env;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

use crate::cdp::CdpClient;

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

pub fn current_pipe_process() -> Option<DiscordProcess> {
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

pub fn restart_normally_after_pipe(process: DiscordProcess) -> Result<(), String> {
    let executable = process
        .executable
        .canonicalize()
        .map_err(|error| format!("Discord 설치 경로를 확인하지 못했습니다: {error}"))?;
    validate_discord_executable(&executable)?;
    let old_pid = Pid::from_u32(process.process_id);
    let deadline = Instant::now() + Duration::from_secs(8);
    let mut system = System::new();
    while Instant::now() < deadline {
        system.refresh_processes(ProcessesToUpdate::Some(&[old_pid]), true);
        if system.process(old_pid).is_none() {
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    if system.process(old_pid).is_some() {
        return Err(
            "보안 파이프 Discord가 종료되지 않아 일반 재실행을 건너뛰었습니다.".to_string(),
        );
    }
    if current_process().is_some() {
        return Ok(());
    }
    let launch_executable = launchable_windows_path(&executable);
    let mut command = std::process::Command::new(&launch_executable);
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    configure_background(&mut command);
    let child = command
        .spawn()
        .map_err(|error| format!("Discord를 일반 모드로 다시 열지 못했습니다: {error}"))?;
    wait_for_restarted_process(&executable, child.id(), Duration::from_secs(15)).map(|_| ())
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

pub fn restart_pipe(
    expected_process_id: Option<u32>,
) -> Result<(DiscordProcess, CdpClient), String> {
    let current = current_process();
    let current_id = current.as_ref().map(|process| process.process_id);
    if expected_process_id != current_id {
        return Err(
            "Discord가 카운트다운 도중 다시 실행되어 자동 재시작을 취소했습니다.".to_string(),
        );
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
        return Err(format!(
            "Discord를 다시 열었지만 보안 CDP 파이프가 준비되지 않았어. 마지막 오류: {last_error}"
        ));
    }

    #[cfg(not(windows))]
    {
        let _ = executable;
        Err("Discord 보안 CDP 파이프는 Windows에서만 지원됩니다.".to_string())
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

fn discord_debug_arguments() -> [&'static str; 2] {
    ["--force-renderer-accessibility", "--remote-debugging-pipe"]
}

fn is_discord_name(name: &str) -> bool {
    DISCORD_EXECUTABLES
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(name))
}

#[cfg(windows)]
mod windows_pipe_launcher {
    use super::configure_background;
    use super::{discord_debug_arguments, validate_discord_executable};
    use std::fs::File;
    use std::io::{BufRead, BufReader};
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{FromRawHandle, IntoRawHandle};
    use std::path::Path;
    use std::process::{Command, Stdio};

    use windows_sys::Win32::Foundation::{
        CloseHandle, DuplicateHandle, DUPLICATE_SAME_ACCESS, HANDLE,
    };
    use windows_sys::Win32::System::Console::{GetStdHandle, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE};
    use windows_sys::Win32::System::Threading::{
        CreateProcessW, DeleteProcThreadAttributeList, GetCurrentProcess,
        InitializeProcThreadAttributeList, UpdateProcThreadAttribute, EXTENDED_STARTUPINFO_PRESENT,
        PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, STARTUPINFOEXW,
    };

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

    pub(super) fn launch(executable: &Path) -> Result<PipeLaunch, String> {
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
        Ok(PipeLaunch {
            process_id,
            reader: unsafe { File::from_raw_handle(parent_read.into_raw_handle()) },
            writer: unsafe { File::from_raw_handle(parent_write.into_raw_handle()) },
        })
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
        spawn_discord_with_handles(
            &launch_executable,
            &[
                launch_executable.as_os_str(),
                std::ffi::OsStr::new(discord_debug_arguments()[0]),
                std::ffi::OsStr::new(discord_debug_arguments()[1]),
                std::ffi::OsStr::new(&io_pipes),
            ],
            &[input_handle.0, output_handle.0],
        )
    }

    fn spawn_discord_with_handles(
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
}

#[cfg(windows)]
pub fn run_pipe_helper(executable: &Path) -> Result<u32, String> {
    windows_pipe_launcher::run_helper(executable)
}

#[cfg(not(windows))]
pub fn run_pipe_helper(_executable: &Path) -> Result<u32, String> {
    Err("Discord 보안 CDP 파이프는 Windows에서만 지원됩니다.".to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        discord_debug_arguments, installed_executable_in, is_discord_name,
        validate_discord_executable,
    };
    use std::fs;
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
