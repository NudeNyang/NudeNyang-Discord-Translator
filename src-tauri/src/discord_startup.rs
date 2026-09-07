use crate::discord::DiscordVariant;

const RELEASES: [DiscordVariant; 3] = [
    DiscordVariant::Stable,
    DiscordVariant::Ptb,
    DiscordVariant::Canary,
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RegistryStringKind {
    String,
    ExpandString,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct DiscordStartupCommand {
    value: String,
    kind: RegistryStringKind,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct DiscordStartupBackup {
    original: Option<DiscordStartupCommand>,
    managed: Option<DiscordStartupCommand>,
}

trait DiscordStartupRegistry {
    fn read_run_command(&self) -> Result<Option<DiscordStartupCommand>, String>;
    fn write_run_command(&mut self, command: &DiscordStartupCommand) -> Result<(), String>;
    fn delete_run_command(&mut self) -> Result<(), String>;
    fn read_backup(&self) -> Result<Option<DiscordStartupBackup>, String>;
    fn write_backup(&mut self, backup: &DiscordStartupBackup) -> Result<(), String>;
    fn delete_backup(&mut self) -> Result<(), String>;
    fn safe_default_command(&self) -> Option<DiscordStartupCommand>;
    fn startup_enabled(&self) -> Result<bool, String> {
        Ok(true)
    }
}

fn restore_registration<R: DiscordStartupRegistry>(registry: &mut R) -> Result<(), String> {
    let Some(backup) = registry.read_backup()? else {
        return Ok(());
    };
    let original = normalize_original(backup.original, registry.safe_default_command());
    let current = registry.read_run_command()?;
    let owned_or_unsafe = match backup.managed.as_ref() {
        Some(managed) => current.as_ref() == Some(managed),
        None => current.is_none(),
    } || current
        .as_ref()
        .is_some_and(|command| is_unsafe_debug_startup_command(&command.value));
    if owned_or_unsafe {
        if let Some(original) = original.as_ref() {
            registry.write_run_command(original)?;
        } else {
            registry.delete_run_command()?;
        }
    }
    registry.delete_backup()?;
    Ok(())
}

fn suppress_registration<R: DiscordStartupRegistry>(registry: &mut R) -> Result<(), String> {
    let current = registry.read_run_command()?;
    let previous_original = registry.read_backup()?.and_then(|backup| backup.original);
    let original = match current.as_ref() {
        Some(command) if !is_managed_wrapper(&command.value) => current.clone(),
        _ => previous_original.or_else(|| current.clone()),
    };
    let backup = DiscordStartupBackup {
        original: normalize_original(original, registry.safe_default_command()),
        managed: None,
    };
    registry.write_backup(&backup)?;
    if current.is_some() {
        registry.delete_run_command()?;
    }
    Ok(())
}

fn normalize_original(
    original: Option<DiscordStartupCommand>,
    fallback: Option<DiscordStartupCommand>,
) -> Option<DiscordStartupCommand> {
    match original {
        Some(command) if is_managed_wrapper(&command.value) => fallback,
        other => other,
    }
}

fn is_managed_wrapper(command: &str) -> bool {
    let normalized = command.to_ascii_lowercase();
    is_unsafe_debug_startup_command(command)
        || (normalized.contains("powershell.exe") && normalized.contains("-encodedcommand"))
}

fn is_unsafe_debug_startup_command(command: &str) -> bool {
    let normalized = command.to_ascii_lowercase();
    normalized.contains("--remote-debugging-port") || normalized.contains("--remote-debugging-pipe")
}

#[cfg(windows)]
mod windows_registry {
    use super::{
        DiscordStartupBackup, DiscordStartupCommand, DiscordStartupRegistry, RegistryStringKind,
    };
    use std::io::ErrorKind;
    use std::path::PathBuf;
    use winreg::enums::{HKEY_CURRENT_USER, REG_EXPAND_SZ, REG_SZ};
    use winreg::types::{FromRegValue, ToRegValue};
    use winreg::{RegKey, RegValue};

    const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const BACKUP_KEY: &str = r"Software\NudeNyang Discord Translator\DiscordStartupBackup";
    const LEGACY_BACKUP_KEY: &str = r"Software\NudeNyang Translator\DiscordStartupBackup";

    pub(super) struct WindowsDiscordStartupRegistry {
        variant: crate::discord::DiscordVariant,
        run_key: String,
        backup_key: String,
        legacy_backup_key: String,
        approved_key: String,
    }

    impl WindowsDiscordStartupRegistry {
        pub(super) fn new(variant: crate::discord::DiscordVariant) -> Self {
            let suffix = if variant == crate::discord::DiscordVariant::Stable {
                String::new()
            } else {
                format!("-{}", variant.config_name())
            };
            Self {
                variant,
                run_key: RUN_KEY.to_string(),
                backup_key: format!("{BACKUP_KEY}{suffix}"),
                legacy_backup_key: format!("{LEGACY_BACKUP_KEY}{suffix}"),
                approved_key:
                    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
                        .to_string(),
            }
        }

        fn value_name(&self) -> &'static str {
            match self.variant {
                crate::discord::DiscordVariant::Stable => "Discord",
                crate::discord::DiscordVariant::Ptb => "DiscordPTB",
                crate::discord::DiscordVariant::Canary => "DiscordCanary",
                crate::discord::DiscordVariant::Auto => unreachable!("concrete release required"),
            }
        }

        #[cfg(test)]
        pub(super) fn isolated(variant: crate::discord::DiscordVariant, root: &str) -> Self {
            let mut registry = Self::new(variant);
            registry.run_key = format!(r"{root}\Run");
            registry.backup_key = format!(r"{root}\{}", registry.backup_key);
            registry.legacy_backup_key = format!(r"{root}\{}", registry.legacy_backup_key);
            registry.approved_key = format!(r"{root}\StartupApproved");
            registry
        }
    }

    impl DiscordStartupRegistry for WindowsDiscordStartupRegistry {
        fn startup_enabled(&self) -> Result<bool, String> {
            let user = RegKey::predef(HKEY_CURRENT_USER);
            let key = match user.open_subkey(&self.approved_key) {
                Ok(key) => key,
                Err(error) if error.kind() == ErrorKind::NotFound => return Ok(true),
                Err(error) => {
                    return Err(format!(
                        "Discord 자동 시작 허용 상태를 읽지 못했습니다: {error}"
                    ))
                }
            };
            match key.get_raw_value(self.value_name()) {
                Ok(value) => Ok(!matches!(value.bytes.first(), Some(3 | 7))),
                Err(error) if error.kind() == ErrorKind::NotFound => Ok(true),
                Err(error) => Err(format!(
                    "Discord 자동 시작 허용 상태를 읽지 못했습니다: {error}"
                )),
            }
        }

        fn read_run_command(&self) -> Result<Option<DiscordStartupCommand>, String> {
            let current_user = RegKey::predef(HKEY_CURRENT_USER);
            let key = match current_user.open_subkey(&self.run_key) {
                Ok(key) => key,
                Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
                Err(error) => {
                    return Err(format!(
                        "Discord 시작 레지스트리를 열지 못했습니다: {error}"
                    ))
                }
            };
            let raw = match key.get_raw_value(self.value_name()) {
                Ok(value) => value,
                Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
                Err(error) => return Err(format!("Discord 시작 명령을 읽지 못했습니다: {error}")),
            };
            let kind = match raw.vtype {
                REG_SZ => RegistryStringKind::String,
                REG_EXPAND_SZ => RegistryStringKind::ExpandString,
                _ => return Ok(None),
            };
            let value = String::from_reg_value(&raw)
                .map_err(|error| format!("Discord 시작 명령을 해석하지 못했습니다: {error}"))?;
            Ok(Some(DiscordStartupCommand { value, kind }))
        }

        fn write_run_command(&mut self, command: &DiscordStartupCommand) -> Result<(), String> {
            let current_user = RegKey::predef(HKEY_CURRENT_USER);
            let (key, _) = current_user
                .create_subkey(&self.run_key)
                .map_err(|error| format!("Discord 시작 레지스트리를 만들지 못했습니다: {error}"))?;
            key.set_raw_value(self.value_name(), &raw_string(command))
                .map_err(|error| format!("Discord 시작 명령을 복원하지 못했습니다: {error}"))
        }

        fn delete_run_command(&mut self) -> Result<(), String> {
            let current_user = RegKey::predef(HKEY_CURRENT_USER);
            let (key, _) = current_user
                .create_subkey(&self.run_key)
                .map_err(|error| format!("Discord 시작 레지스트리를 열지 못했습니다: {error}"))?;
            match key.delete_value(self.value_name()) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
                Err(error) => Err(format!("Discord 시작 명령을 삭제하지 못했습니다: {error}")),
            }
        }

        fn read_backup(&self) -> Result<Option<DiscordStartupBackup>, String> {
            let current_user = RegKey::predef(HKEY_CURRENT_USER);
            let key = match open_backup_key(&current_user, &self.backup_key)? {
                Some(key) => Some(key),
                None => open_backup_key(&current_user, &self.legacy_backup_key)?,
            };
            let Some(key) = key else { return Ok(None) };
            let managed_marker: u32 = key.get_value("Managed").unwrap_or(0);
            if managed_marker != 1 {
                return Ok(None);
            }
            let original_present: u32 = key.get_value("OriginalPresent").unwrap_or(0);
            let original = if original_present == 1 {
                Some(
                    read_stored_command(&key, "OriginalCommand", "OriginalKind")?.ok_or_else(
                        || "기존 Discord 시작 명령 백업이 완전하지 않습니다.".to_string(),
                    )?,
                )
            } else {
                None
            };
            let suppressed: u32 = key.get_value("Suppressed").unwrap_or(0);
            let managed = if suppressed == 1 {
                None
            } else {
                Some(
                    read_stored_command(&key, "ManagedCommand", "ManagedKind")?
                        .ok_or_else(|| "Discord 시작 명령 백업이 완전하지 않습니다.".to_string())?,
                )
            };
            Ok(Some(DiscordStartupBackup { original, managed }))
        }

        fn write_backup(&mut self, backup: &DiscordStartupBackup) -> Result<(), String> {
            let current_user = RegKey::predef(HKEY_CURRENT_USER);
            let (key, _) = current_user
                .create_subkey(&self.backup_key)
                .map_err(|error| format!("Discord 시작 명령 백업을 만들지 못했습니다: {error}"))?;
            key.set_value("Managed", &1_u32)
                .map_err(|error| format!("Discord 시작 명령 백업을 쓰지 못했습니다: {error}"))?;
            key.set_value("Suppressed", &1_u32)
                .map_err(|error| format!("Discord 시작 명령 백업을 쓰지 못했습니다: {error}"))?;
            match backup.original.as_ref() {
                Some(original) => {
                    key.set_value("OriginalPresent", &1_u32).map_err(|error| {
                        format!("Discord 시작 명령 백업을 쓰지 못했습니다: {error}")
                    })?;
                    write_stored_command(&key, "OriginalCommand", "OriginalKind", original)?;
                }
                None => {
                    key.set_value("OriginalPresent", &0_u32).map_err(|error| {
                        format!("Discord 시작 명령 백업을 쓰지 못했습니다: {error}")
                    })?;
                    let _ = key.delete_value("OriginalCommand");
                    let _ = key.delete_value("OriginalKind");
                }
            }
            let _ = key.delete_value("ManagedCommand");
            let _ = key.delete_value("ManagedKind");
            Ok(())
        }

        fn delete_backup(&mut self) -> Result<(), String> {
            let current_user = RegKey::predef(HKEY_CURRENT_USER);
            for path in [&self.backup_key, &self.legacy_backup_key] {
                match current_user.delete_subkey_all(path) {
                    Ok(()) => {}
                    Err(error) if error.kind() == ErrorKind::NotFound => {}
                    Err(error) => {
                        return Err(format!(
                            "Discord 시작 명령 백업을 삭제하지 못했습니다: {error}"
                        ))
                    }
                }
            }
            Ok(())
        }

        fn safe_default_command(&self) -> Option<DiscordStartupCommand> {
            let update = PathBuf::from(std::env::var_os("LOCALAPPDATA")?)
                .join(self.value_name())
                .join("Update.exe");
            update.is_file().then(|| DiscordStartupCommand {
                value: format!(
                    "\"{}\" --processStart {}.exe",
                    update.to_string_lossy(),
                    self.value_name()
                ),
                kind: RegistryStringKind::String,
            })
        }
    }

    fn open_backup_key(current_user: &RegKey, path: &str) -> Result<Option<RegKey>, String> {
        match current_user.open_subkey(path) {
            Ok(key) => Ok(Some(key)),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(format!("Discord 시작 명령 백업을 열지 못했습니다: {error}")),
        }
    }

    fn raw_string(command: &DiscordStartupCommand) -> RegValue {
        let mut value = command.value.to_reg_value();
        value.vtype = match command.kind {
            RegistryStringKind::String => REG_SZ,
            RegistryStringKind::ExpandString => REG_EXPAND_SZ,
        };
        value
    }

    fn read_stored_command(
        key: &RegKey,
        value_name: &str,
        kind_name: &str,
    ) -> Result<Option<DiscordStartupCommand>, String> {
        let value: String = match key.get_value(value_name) {
            Ok(value) => value,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(format!("Discord 시작 명령 백업을 읽지 못했습니다: {error}")),
        };
        let raw_kind: u32 = key
            .get_value(kind_name)
            .map_err(|error| format!("Discord 시작 명령 백업 형식을 읽지 못했습니다: {error}"))?;
        let kind = if raw_kind == 2 {
            RegistryStringKind::ExpandString
        } else {
            RegistryStringKind::String
        };
        Ok(Some(DiscordStartupCommand { value, kind }))
    }

    fn write_stored_command(
        key: &RegKey,
        value_name: &str,
        kind_name: &str,
        command: &DiscordStartupCommand,
    ) -> Result<(), String> {
        key.set_value(value_name, &command.value)
            .map_err(|error| format!("Discord 시작 명령 백업을 쓰지 못했습니다: {error}"))?;
        let kind = match command.kind {
            RegistryStringKind::String => 1_u32,
            RegistryStringKind::ExpandString => 2_u32,
        };
        key.set_value(kind_name, &kind)
            .map_err(|error| format!("Discord 시작 명령 백업을 쓰지 못했습니다: {error}"))
    }
}

pub fn suppress(selected: DiscordVariant) -> Result<(), String> {
    #[cfg(windows)]
    {
        for variant in RELEASES {
            let mut registry = windows_registry::WindowsDiscordStartupRegistry::new(variant);
            if (selected == DiscordVariant::Auto || selected == variant)
                && registry.startup_enabled()?
            {
                if registry.read_run_command()?.is_some() || registry.read_backup()?.is_some() {
                    suppress_registration(&mut registry)?;
                }
            } else {
                restore_registration(&mut registry)?;
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

pub fn restore() -> Result<(), String> {
    #[cfg(windows)]
    {
        for variant in RELEASES {
            restore_registration(&mut windows_registry::WindowsDiscordStartupRegistry::new(
                variant,
            ))?;
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

pub fn launch_variants(selected: DiscordVariant) -> Result<Vec<DiscordVariant>, String> {
    let mut registered = Vec::new();
    #[cfg(windows)]
    for variant in RELEASES {
        let registry = windows_registry::WindowsDiscordStartupRegistry::new(variant);
        if registry.startup_enabled()?
            && registry
                .read_backup()?
                .is_some_and(|backup| backup.original.is_some())
        {
            registered.push(variant);
        }
    }
    Ok(select_launch_variants(selected, &registered))
}

fn select_launch_variants(
    selected: DiscordVariant,
    registered: &[DiscordVariant],
) -> Vec<DiscordVariant> {
    if selected == DiscordVariant::Auto {
        registered.to_vec()
    } else {
        vec![selected]
    }
}

// Refresh an existing opt-in without changing Windows' StartupApproved setting.
// The plugin's is_enabled() checks only presence, so it accepts a stale EXE path.
pub fn refresh_app_command(name: &str, executable: &std::path::Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use winreg::{
            enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE},
            RegKey,
        };
        let user = RegKey::predef(HKEY_CURRENT_USER);
        let key = user
            .open_subkey_with_flags(
                r"Software\Microsoft\Windows\CurrentVersion\Run",
                KEY_READ | KEY_SET_VALUE,
            )
            .map_err(|e| format!("앱 자동 시작 경로를 열지 못했습니다: {e}"))?;
        refresh_registered_command(&key, name, executable)?;
    }
    Ok(())
}

#[cfg(windows)]
fn refresh_registered_command(
    key: &winreg::RegKey,
    name: &str,
    executable: &std::path::Path,
) -> Result<(), String> {
    use std::io::ErrorKind;
    let current: String = match key.get_value(name) {
        Ok(value) => value,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("앱 자동 시작 경로를 읽지 못했습니다: {error}")),
    };
    let expected = format!("\"{}\"", executable.display());
    if current != expected {
        key.set_value(name, &expected)
            .map_err(|e| format!("앱 자동 시작 경로를 갱신하지 못했습니다: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn automatic_startup_uses_only_previously_registered_releases() {
        use crate::discord::DiscordVariant::{Auto, Canary, Ptb, Stable};
        assert!(super::select_launch_variants(Auto, &[]).is_empty());
        assert_eq!(
            super::select_launch_variants(Auto, &[Stable, Ptb, Canary]),
            vec![Stable, Ptb, Canary]
        );
        assert_eq!(super::select_launch_variants(Auto, &[Ptb]), vec![Ptb]);
        assert_eq!(
            super::select_launch_variants(Canary, &[Stable, Ptb]),
            vec![Canary]
        );
    }

    #[test]
    #[cfg(windows)]
    fn startup_refresh_repairs_stale_paths_without_creating_an_opt_in() {
        use std::path::Path;
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        let root = format!(r"Software\NudeNyangTests\refresh-{}", std::process::id());
        let user = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) = user.create_subkey(&root).unwrap();
        let path = Path::new(r"C:\Apps\New Build\Translator.exe");
        super::refresh_registered_command(&key, "absent", path).unwrap();
        assert!(key.get_value::<String, _>("absent").is_err());
        key.set_value("enabled", &r"C:\Old Build\Translator.exe ")
            .unwrap();
        super::refresh_registered_command(&key, "enabled", path).unwrap();
        let actual: String = key.get_value("enabled").unwrap();
        super::refresh_registered_command(&key, "enabled", path).unwrap();
        let repeated: String = key.get_value("enabled").unwrap();
        drop(key);
        user.delete_subkey_all(&root).unwrap();
        assert_eq!(actual, r#""C:\Apps\New Build\Translator.exe""#);
        assert_eq!(repeated, actual);
    }

    #[test]
    #[cfg(windows)]
    fn startup_approval_is_checked_independently_for_each_release() {
        use super::windows_registry::WindowsDiscordStartupRegistry;
        use crate::discord::DiscordVariant::{Canary, Ptb, Stable};
        use winreg::{
            enums::{HKEY_CURRENT_USER, REG_BINARY},
            RegKey, RegValue,
        };
        let root = format!(r"Software\NudeNyangTests\approval-{}", std::process::id());
        let user = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) = user
            .create_subkey(format!(r"{root}\StartupApproved"))
            .unwrap();
        let mut states = Vec::new();
        for byte in [2, 3, 6, 7] {
            let mut bytes = vec![0; 12];
            bytes[0] = byte;
            key.set_raw_value(
                "DiscordPTB",
                &RegValue {
                    bytes,
                    vtype: REG_BINARY,
                },
            )
            .unwrap();
            states.push((
                byte,
                WindowsDiscordStartupRegistry::isolated(Ptb, &root)
                    .startup_enabled()
                    .unwrap(),
            ));
        }
        let others = [Stable, Canary].map(|variant| {
            WindowsDiscordStartupRegistry::isolated(variant, &root)
                .startup_enabled()
                .unwrap()
        });
        drop(key);
        user.delete_subkey_all(&root).unwrap();
        assert_eq!(states, vec![(2, true), (3, false), (6, true), (7, false)]);
        assert_eq!(others, [true, true]);
    }

    #[test]
    #[cfg(windows)]
    fn each_release_preserves_its_own_startup_registration_across_logins() {
        use super::windows_registry::WindowsDiscordStartupRegistry;
        use crate::discord::DiscordVariant::{Canary, Ptb, Stable};
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        let root = format!(
            r"Software\NudeNyangTests\startup-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let user = RegKey::predef(HKEY_CURRENT_USER);
        let (run, _) = user.create_subkey(format!(r"{root}\Run")).unwrap();
        let originals = [
            (Stable, "Discord", "stable Update.exe"),
            (Ptb, "DiscordPTB", "ptb Update.exe"),
            (Canary, "DiscordCanary", "canary Update.exe"),
        ];
        for (_, name, original) in originals {
            run.set_value(name, &original).unwrap();
        }
        // Gather the result before deleting only this uniquely named test key.
        let result = (|| -> Result<(), String> {
            for (variant, name, original) in originals {
                let mut registry = WindowsDiscordStartupRegistry::isolated(variant, &root);
                suppress_registration(&mut registry)?;
                if run.get_value::<String, _>(name).is_ok() {
                    return Err(format!("{name} still starts without a pipe"));
                }
                suppress_registration(&mut registry)?;
                if registry
                    .read_backup()?
                    .and_then(|b| b.original)
                    .map(|c| c.value)
                    != Some(original.to_string())
                {
                    return Err(format!("{name} lost its original startup setting"));
                }
            }
            for (variant, name, original) in originals {
                restore_registration(&mut WindowsDiscordStartupRegistry::isolated(variant, &root))?;
                if run.get_value::<String, _>(name).ok().as_deref() != Some(original) {
                    return Err(format!("{name} restored another release's command"));
                }
            }
            Ok(())
        })();
        drop(run);
        user.delete_subkey_all(&root).unwrap();
        assert_eq!(result, Ok(()));
    }

    use super::{
        restore_registration, suppress_registration, DiscordStartupBackup, DiscordStartupCommand,
        DiscordStartupRegistry, RegistryStringKind,
    };

    #[derive(Default)]
    struct FakeRegistry {
        run: Option<DiscordStartupCommand>,
        backup: Option<DiscordStartupBackup>,
        fallback: Option<DiscordStartupCommand>,
    }

    impl DiscordStartupRegistry for FakeRegistry {
        fn read_run_command(&self) -> Result<Option<DiscordStartupCommand>, String> {
            Ok(self.run.clone())
        }

        fn write_run_command(&mut self, command: &DiscordStartupCommand) -> Result<(), String> {
            self.run = Some(command.clone());
            Ok(())
        }

        fn delete_run_command(&mut self) -> Result<(), String> {
            self.run = None;
            Ok(())
        }

        fn read_backup(&self) -> Result<Option<DiscordStartupBackup>, String> {
            Ok(self.backup.clone())
        }

        fn write_backup(&mut self, backup: &DiscordStartupBackup) -> Result<(), String> {
            self.backup = Some(backup.clone());
            Ok(())
        }

        fn delete_backup(&mut self) -> Result<(), String> {
            self.backup = None;
            Ok(())
        }

        fn safe_default_command(&self) -> Option<DiscordStartupCommand> {
            self.fallback.clone()
        }
    }

    fn command(value: &str) -> DiscordStartupCommand {
        DiscordStartupCommand {
            value: value.to_string(),
            kind: RegistryStringKind::ExpandString,
        }
    }

    #[test]
    fn legacy_managed_registration_restores_the_original() {
        let managed = command("legacy managed command");
        let original = command("original Discord startup");
        let mut registry = FakeRegistry {
            run: Some(managed.clone()),
            backup: Some(DiscordStartupBackup {
                original: Some(original.clone()),
                managed: Some(managed),
            }),
            fallback: None,
        };
        restore_registration(&mut registry).unwrap();
        assert_eq!(registry.run, Some(original));
        assert_eq!(registry.backup, None);
    }

    #[test]
    fn externally_changed_registration_is_never_overwritten() {
        let managed = command("legacy managed command");
        let external = command("user managed Discord startup");
        let mut registry = FakeRegistry {
            run: Some(external.clone()),
            backup: Some(DiscordStartupBackup {
                original: Some(command("original Discord startup")),
                managed: Some(managed),
            }),
            fallback: None,
        };
        restore_registration(&mut registry).unwrap();
        assert_eq!(registry.run, Some(external));
        assert_eq!(registry.backup, None);
    }

    #[test]
    fn legacy_registration_is_removed_when_there_was_no_original() {
        let managed = command("legacy managed command");
        let mut registry = FakeRegistry {
            run: Some(managed.clone()),
            backup: Some(DiscordStartupBackup {
                original: None,
                managed: Some(managed),
            }),
            fallback: None,
        };
        restore_registration(&mut registry).unwrap();
        assert_eq!(registry.run, None);
        assert_eq!(registry.backup, None);
    }

    #[test]
    fn suppression_backs_up_normal_startup_and_removes_the_run_value() {
        let original = command("normal Discord startup");
        let mut registry = FakeRegistry {
            run: Some(original.clone()),
            backup: None,
            fallback: Some(command("safe fallback")),
        };

        suppress_registration(&mut registry).unwrap();

        assert_eq!(registry.run, None);
        assert_eq!(
            registry.backup,
            Some(DiscordStartupBackup {
                original: Some(original),
                managed: None,
            })
        );
    }

    #[test]
    fn suppression_unwinds_legacy_port_and_cross_app_wrapper_backups() {
        let fallback = command("safe normal Discord startup");
        let mut registry = FakeRegistry {
            run: Some(command("Discord.exe --remote-debugging-port=9222")),
            backup: Some(DiscordStartupBackup {
                original: Some(command("powershell.exe -EncodedCommand sentory-wrapper")),
                managed: Some(command("Discord.exe --remote-debugging-port=9222")),
            }),
            fallback: Some(fallback.clone()),
        };

        suppress_registration(&mut registry).unwrap();

        assert_eq!(registry.run, None);
        assert_eq!(
            registry.backup,
            Some(DiscordStartupBackup {
                original: Some(fallback),
                managed: None,
            })
        );
    }

    #[test]
    fn suppressed_registration_restores_after_primary_autostart_is_disabled() {
        let original = command("normal Discord startup");
        let mut registry = FakeRegistry {
            run: None,
            backup: Some(DiscordStartupBackup {
                original: Some(original.clone()),
                managed: None,
            }),
            fallback: None,
        };

        restore_registration(&mut registry).unwrap();

        assert_eq!(registry.run, Some(original));
        assert_eq!(registry.backup, None);
    }

    #[test]
    fn suppression_preserves_a_new_user_startup_command() {
        let new_command = command("user changed Discord startup");
        let mut registry = FakeRegistry {
            run: Some(new_command.clone()),
            backup: Some(DiscordStartupBackup {
                original: Some(command("previous Discord startup")),
                managed: None,
            }),
            fallback: None,
        };

        suppress_registration(&mut registry).unwrap();

        assert_eq!(registry.run, None);
        assert_eq!(
            registry.backup,
            Some(DiscordStartupBackup {
                original: Some(new_command),
                managed: None,
            })
        );
    }

    #[test]
    fn restore_never_reintroduces_a_debugging_port_from_legacy_backup() {
        let fallback = command("safe normal Discord startup");
        let managed = command("legacy managed command");
        let mut registry = FakeRegistry {
            run: Some(managed.clone()),
            backup: Some(DiscordStartupBackup {
                original: Some(command("Discord.exe --remote-debugging-port=9222")),
                managed: Some(managed),
            }),
            fallback: Some(fallback.clone()),
        };

        restore_registration(&mut registry).unwrap();

        assert_eq!(registry.run, Some(fallback));
        assert_eq!(registry.backup, None);
    }
}
