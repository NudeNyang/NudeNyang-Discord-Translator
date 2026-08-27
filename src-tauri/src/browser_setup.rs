//! Browser installation discovery and explicit, store-only onboarding.
//! Never read browser profiles or install extensions through policy/registry keys.
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Browser {
    Chrome,
    Whale,
    Firefox,
}

impl Browser {
    fn executable(self) -> &'static str {
        match self {
            Self::Chrome => "chrome.exe",
            Self::Whale => "whale.exe",
            Self::Firefox => "firefox.exe",
        }
    }

    fn relative_path(self) -> &'static str {
        match self {
            Self::Chrome => "Google/Chrome/Application/chrome.exe",
            Self::Whale => "Naver/Naver Whale/Application/whale.exe",
            Self::Firefox => "Mozilla Firefox/firefox.exe",
        }
    }

    fn store_url(self) -> Option<&'static str> {
        match self {
            Self::Chrome => Some("https://chromewebstore.google.com/detail/nudenyang-web-translator/kpagdcdgomdlnnphakjakpodmgnhgaia"),
            Self::Whale => Some("https://store.whale.naver.com/detail/afnknfkmicnmdcfgmddelbpmkadcgifk"),
            // Awaiting AMO approval. Enable only after the listing is public:
            // https://addons.mozilla.org/firefox/addon/nudenyang-web-translator/
            Self::Firefox => None,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserInstallation {
    browser: Browser,
    installed: bool,
    store_available: bool,
}

#[tauri::command]
pub fn browser_installations() -> Vec<BrowserInstallation> {
    [Browser::Chrome, Browser::Whale, Browser::Firefox]
        .into_iter()
        .map(|browser| BrowserInstallation {
            browser,
            installed: find_browser(browser).is_some(),
            store_available: browser.store_url().is_some(),
        })
        .collect()
}

#[tauri::command]
pub fn browser_open_extension_store(browser: Browser) -> Result<(), String> {
    let url = browser.store_url().ok_or("store_unavailable")?;
    let executable = find_browser(browser).ok_or("browser_not_found")?;
    browser_repair_connection()?;
    // Pass a fixed HTTPS URL as one argument to the selected browser, never a
    // shell command or the OS default browser. Let the browser choose its profile.
    let mut command = std::process::Command::new(executable);
    command.arg(url);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
        .spawn()
        .map_err(|_| "browser_launch_failed".to_string())?;
    Ok(())
}

#[tauri::command]
pub fn browser_repair_connection() -> Result<(), String> {
    crate::browser_bridge::register_native_messaging_host()
        .map(|_| ())
        .map_err(|error| {
            crate::diagnostics::warn("browser-setup", &error);
            "browser_registration_failed".to_string()
        })
}

fn executable_path(value: &str, browser: Browser) -> Option<PathBuf> {
    // App Paths stores an executable, not a command line. Reject any switches,
    // relative paths or unexpected binary names instead of interpreting them.
    let path = PathBuf::from(value.trim().trim_matches('"'));
    (path.is_absolute()
        && path
            .file_name()?
            .to_str()?
            .eq_ignore_ascii_case(browser.executable())
        && path.is_file())
    .then_some(path)
}

#[cfg(windows)]
fn find_browser(browser: Browser) -> Option<PathBuf> {
    use winreg::enums::{
        HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY,
    };
    use winreg::RegKey;

    let subkey = format!(
        "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{}",
        browser.executable()
    );
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        let root = RegKey::predef(hive);
        for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
            if let Ok(key) = root.open_subkey_with_flags(&subkey, KEY_READ | view) {
                if let Ok(value) = key.get_value::<String, _>("") {
                    if let Some(path) = executable_path(&value, browser) {
                        return Some(path);
                    }
                }
            }
        }
    }
    for variable in [
        "LOCALAPPDATA",
        "ProgramW6432",
        "ProgramFiles",
        "ProgramFiles(x86)",
    ] {
        if let Some(root) = std::env::var_os(variable) {
            let path = PathBuf::from(root).join(browser.relative_path());
            if let Some(path) = executable_path(&path.to_string_lossy(), browser) {
                return Some(path);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn find_browser(_browser: Browser) -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_supported_browsers_can_be_requested() {
        for browser in ["chrome", "whale", "firefox"] {
            assert!(serde_json::from_value::<Browser>(serde_json::json!(browser)).is_ok());
        }
        for invalid in [
            "edge",
            "cmd.exe",
            "Chrome",
            "chrome --user-data-dir=other",
            "https://evil.example/",
        ] {
            assert!(serde_json::from_value::<Browser>(serde_json::json!(invalid)).is_err());
        }
    }

    #[test]
    fn browser_paths_are_executables_not_shell_commands() {
        let directory =
            std::env::temp_dir().join(format!("nudenyang-browser-path-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let file = directory.join("chrome.exe");
        std::fs::write(&file, b"path discovery fixture, never executed").unwrap();
        assert_eq!(
            executable_path(&format!("\"{}\"", file.display()), Browser::Chrome),
            Some(file.clone())
        );
        assert!(executable_path(&file.to_string_lossy(), Browser::Whale).is_none());
        assert!(
            executable_path(&format!("\"{}\" --flag", file.display()), Browser::Chrome).is_none()
        );
        assert!(executable_path("chrome.exe", Browser::Chrome).is_none());
        assert!(executable_path(
            &directory.join("missing/chrome.exe").to_string_lossy(),
            Browser::Chrome
        )
        .is_none());
        std::fs::remove_file(file).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn store_urls_never_come_from_the_renderer() {
        let url = url::Url::parse(Browser::Chrome.store_url().unwrap()).unwrap();
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("chromewebstore.google.com"));
        assert!(url
            .path()
            .ends_with(crate::browser_bridge::CHROME_WEB_STORE_EXTENSION_ID));
        let whale = url::Url::parse(Browser::Whale.store_url().unwrap()).unwrap();
        assert_eq!(whale.scheme(), "https");
        assert_eq!(whale.host_str(), Some("store.whale.naver.com"));
        assert!(whale
            .path()
            .ends_with(crate::browser_bridge::WHALE_STORE_EXTENSION_ID));
        assert!(
            Browser::Firefox.store_url().is_none(),
            "AMO review is not finished"
        );
    }
}
