use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use regex::Regex;
use time::OffsetDateTime;

pub const LOG_FILENAME: &str = "NudeNyangDiscordTranslator.log";
pub const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
const RETAIN_LOG_BYTES: u64 = 2 * 1024 * 1024;
const MAX_MESSAGE_CHARS: usize = 8_000;
static LOG_WRITE_LOCK: Mutex<()> = Mutex::new(());
static BEARER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+").expect("valid bearer regex"));
static SECRET_ASSIGNMENT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(authorization|api[_ -]?key|token|password|credential)\s*[:=]\s*([^\s,;]+)")
        .expect("valid secret assignment regex")
});

pub fn default_log_path() -> PathBuf {
    if let Some(path) = env::var_os("NUDENYANG_TRANSLATOR_LOG").filter(|value| !value.is_empty()) {
        return PathBuf::from(path);
    }
    #[cfg(target_os = "windows")]
    if let Some(local) = env::var_os("LOCALAPPDATA").filter(|value| !value.is_empty()) {
        return PathBuf::from(local)
            .join("NudeNyang Discord Translator")
            .join(LOG_FILENAME);
    }
    #[cfg(target_os = "macos")]
    if let Some(home) = env::var_os("HOME").filter(|value| !value.is_empty()) {
        return PathBuf::from(home)
            .join("Library")
            .join("Logs")
            .join("NudeNyang Discord Translator")
            .join(LOG_FILENAME);
    }
    env::temp_dir()
        .join("NudeNyang Discord Translator")
        .join(LOG_FILENAME)
}

pub fn initialize(version: &str) -> Result<PathBuf, String> {
    let path = default_log_path();
    migrate_legacy_log(&path)?;
    prepare_log_file(&path)?;
    install_panic_hook();
    info(
        "application",
        &format!(
            "session started; version={version}; os={}; arch={}",
            env::consts::OS,
            env::consts::ARCH
        ),
    );
    Ok(path)
}

fn migrate_legacy_log(destination: &Path) -> Result<(), String> {
    if destination.exists()
        || env::var_os("NUDENYANG_TRANSLATOR_LOG").is_some_and(|value| !value.is_empty())
    {
        return Ok(());
    }
    let Some(parent) = destination.parent() else {
        return Ok(());
    };
    let Some(base) = parent.parent() else {
        return Ok(());
    };
    for legacy_directory in ["NudeNyang Translator", "Nude Translator"] {
        let source = base.join(legacy_directory).join("NudeNyangTranslator.log");
        if !source.is_file() {
            continue;
        }
        ensure_parent(destination)?;
        fs::copy(&source, destination).map_err(|error| {
            format!(
                "기존 진단 로그를 새 폴더로 옮기지 못했습니다 ({}): {error}",
                source.display()
            )
        })?;
        let _ = fs::remove_file(&source);
        if let Some(directory) = source.parent() {
            let _ = fs::remove_dir(directory);
        }
        break;
    }
    Ok(())
}

pub fn log_path() -> PathBuf {
    default_log_path()
}

pub fn info(component: &str, message: &str) {
    record("INFO", component, message);
}

pub fn warn(component: &str, message: &str) {
    record("WARN", component, message);
}

pub fn error(component: &str, message: &str) {
    record("ERROR", component, message);
}

pub fn record(level: &str, component: &str, message: &str) {
    let path = default_log_path();
    let Ok(_guard) = LOG_WRITE_LOCK.lock() else {
        return;
    };
    if ensure_parent(&path).is_err() {
        return;
    }
    if path.metadata().map(|meta| meta.len()).unwrap_or(0) > MAX_LOG_BYTES
        && compact_log_file(&path).is_err()
    {
        return;
    }
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let level = normalize_label(level, "INFO");
    let component = normalize_label(component, "application");
    let message = redact_sensitive(message);
    let _ = writeln!(
        file,
        "{} [{level}] [{component}] {message}",
        utc_timestamp()
    );
}

pub fn pipe_external_output<R>(reader: R, component: &'static str)
where
    R: Read + Send + 'static,
{
    std::thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if external_line_is_diagnostic(&line) {
                info(component, &line);
            }
        }
    });
}

fn prepare_log_file(path: &Path) -> Result<(), String> {
    ensure_parent(path)?;
    if path.metadata().map(|meta| meta.len()).unwrap_or(0) > MAX_LOG_BYTES {
        compact_log_file(path)?;
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map(|_| ())
        .map_err(|error| {
            format!(
                "진단 로그 파일을 만들지 못했습니다 ({}): {error}",
                path.display()
            )
        })
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "진단 로그 폴더를 만들지 못했습니다 ({}): {error}",
                parent.display()
            )
        })?;
    }
    Ok(())
}

fn compact_log_file(path: &Path) -> Result<(), String> {
    let mut file =
        File::open(path).map_err(|error| format!("기존 진단 로그를 읽지 못했습니다: {error}"))?;
    let length = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    let start = length.saturating_sub(RETAIN_LOG_BYTES);
    file.seek(SeekFrom::Start(start))
        .map_err(|error| format!("기존 진단 로그의 끝부분을 찾지 못했습니다: {error}"))?;
    let mut tail = Vec::new();
    file.read_to_end(&mut tail)
        .map_err(|error| format!("기존 진단 로그의 끝부분을 읽지 못했습니다: {error}"))?;
    drop(file);
    if start > 0 {
        if let Some(newline) = tail.iter().position(|byte| *byte == b'\n') {
            tail.drain(..=newline);
        }
    }
    let mut compacted = File::create(path)
        .map_err(|error| format!("진단 로그 크기를 줄이지 못했습니다: {error}"))?;
    compacted
        .write_all(b"[older diagnostic entries were removed to keep this single file small]\n")
        .and_then(|_| compacted.write_all(&tail))
        .map_err(|error| format!("진단 로그 끝부분을 보존하지 못했습니다: {error}"))
}

fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        let payload = panic_info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| {
                panic_info
                    .payload()
                    .downcast_ref::<String>()
                    .map(String::as_str)
            })
            .unwrap_or("unknown panic");
        let location = panic_info
            .location()
            .map(|location| format!("{}:{}", location.file(), location.line()))
            .unwrap_or_else(|| "unknown location".to_string());
        error("panic", &format!("{payload}; location={location}"));
        previous(panic_info);
    }));
}

pub fn redact_sensitive(message: &str) -> String {
    let mut output = message.replace(['\r', '\n'], " ");
    if let Some(home) = env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .and_then(|value| value.into_string().ok())
    {
        if !home.is_empty() {
            output = output.replace(&home, "%USERPROFILE%");
        }
    }
    output = BEARER_RE
        .replace_all(&output, "Bearer <redacted>")
        .into_owned();
    output = SECRET_ASSIGNMENT_RE
        .replace_all(&output, "$1=<redacted>")
        .into_owned();
    output.chars().take(MAX_MESSAGE_CHARS).collect()
}

fn external_line_is_diagnostic(line: &str) -> bool {
    let normalized = line.to_ascii_lowercase();
    const ALLOWED: &[&str] = &[
        "error",
        "warning",
        "failed",
        "fatal",
        "cuda",
        "vulkan",
        "device",
        "backend",
        "memory",
        "model load",
        "loading model",
        "ggml",
        "exit",
    ];
    const PRIVATE: &[&str] = &["prompt", "completion", "request body", "input text"];
    ALLOWED.iter().any(|term| normalized.contains(term))
        && !PRIVATE.iter().any(|term| normalized.contains(term))
}

fn normalize_label(value: &str, fallback: &str) -> String {
    let label = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(32)
        .collect::<String>();
    if label.is_empty() {
        fallback.to_string()
    } else {
        label
    }
}

fn utc_timestamp() -> String {
    let now = OffsetDateTime::now_utc();
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        now.year(),
        now.month() as u8,
        now.day(),
        now.hour(),
        now.minute(),
        now.second(),
        now.millisecond()
    )
}

#[cfg(test)]
mod tests {
    use super::{
        compact_log_file, external_line_is_diagnostic, migrate_legacy_log, prepare_log_file,
        redact_sensitive, MAX_LOG_BYTES,
    };
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn secrets_and_user_profile_are_redacted() {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_default();
        let message = format!(
            "path={home}\\AppData token=secret-value Authorization: Bearer abc.def password=hunter2"
        );
        let redacted = redact_sensitive(&message);
        assert!(!redacted.contains("secret-value"));
        assert!(!redacted.contains("abc.def"));
        assert!(!redacted.contains("hunter2"));
        if !home.is_empty() {
            assert!(redacted.contains("%USERPROFILE%"));
        }
    }

    #[test]
    fn compaction_keeps_one_bounded_log_file() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("nudenyang-diagnostics-{nonce}"));
        let path = directory.join("NudeNyangDiscordTranslator.log");
        fs::create_dir_all(&directory).unwrap();
        fs::write(&path, vec![b'x'; MAX_LOG_BYTES as usize + 1]).unwrap();

        compact_log_file(&path).unwrap();

        assert!(path.metadata().unwrap().len() < MAX_LOG_BYTES);
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn preparation_creates_exactly_one_log_file() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("nudenyang-log-create-{nonce}"));
        let path = directory.join("NudeNyangDiscordTranslator.log");

        prepare_log_file(&path).unwrap();

        assert!(path.is_file());
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn previous_product_log_moves_to_the_renamed_directory() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let base = std::env::temp_dir().join(format!("nudenyang-log-migration-{nonce}"));
        let legacy = base
            .join("NudeNyang Translator")
            .join("NudeNyangTranslator.log");
        let current = base
            .join("NudeNyang Discord Translator")
            .join("NudeNyangDiscordTranslator.log");
        fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        fs::write(&legacy, b"previous log").unwrap();

        migrate_legacy_log(&current).unwrap();

        assert_eq!(fs::read(&current).unwrap(), b"previous log");
        assert!(!legacy.exists());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn external_server_logs_keep_diagnostics_but_drop_prompt_content() {
        assert!(external_line_is_diagnostic(
            "CUDA backend failed to allocate memory"
        ));
        assert!(!external_line_is_diagnostic(
            "request prompt: a private Discord message"
        ));
    }
}
