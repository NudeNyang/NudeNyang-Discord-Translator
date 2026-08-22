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
    const DISCORD_VALUE: &str = "Discord";
    const BACKUP_KEY: &str = r"Software\NudeNyang Discord Translator\DiscordStartupBackup";
    const LEGACY_BACKUP_KEY: &str = r"Software\NudeNyang Translator\DiscordStartupBackup";

    pub(super) struct WindowsDiscordStartupRegistry;

    impl DiscordStartupRegistry for WindowsDiscordStartupRegistry {
        fn read_run_command(&self) -> Result<Option<DiscordStartupCommand>, String> {
            let current_user = RegKey::predef(HKEY_CURRENT_USER);
            let key = match current_user.open_subkey(RUN_KEY) {
                Ok(key) => key,
                Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
                Err(error) => {
                    return Err(format!(
                        "Discord 시작 레지스트리를 열지 못했습니다: {error}"
                    ))
                }
            };
            let raw = match key.get_raw_value(DISCORD_VALUE) {
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
                .create_subkey(RUN_KEY)
                .map_err(|error| format!("Discord 시작 레지스트리를 만들지 못했습니다: {error}"))?;
            key.set_raw_value(DISCORD_VALUE, &raw_string(command))
                .map_err(|error| format!("Discord 시작 명령을 복원하지 못했습니다: {error}"))
        }

        fn delete_run_command(&mut self) -> Result<(), String> {
            let current_user = RegKey::predef(HKEY_CURRENT_USER);
            let (key, _) = current_user
                .create_subkey(RUN_KEY)
                .map_err(|error| format!("Discord 시작 레지스트리를 열지 못했습니다: {error}"))?;
            match key.delete_value(DISCORD_VALUE) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
                Err(error) => Err(format!("Discord 시작 명령을 삭제하지 못했습니다: {error}")),
            }
        }

        fn read_backup(&self) -> Result<Option<DiscordStartupBackup>, String> {
            let current_user = RegKey::predef(HKEY_CURRENT_USER);
            let key = match open_backup_key(&current_user, BACKUP_KEY)? {
                Some(key) => Some(key),
                None => open_backup_key(&current_user, LEGACY_BACKUP_KEY)?,
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
                .create_subkey(BACKUP_KEY)
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
            for path in [BACKUP_KEY, LEGACY_BACKUP_KEY] {
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
                .join("Discord")
                .join("Update.exe");
            update.is_file().then(|| DiscordStartupCommand {
                value: format!(
                    "\"{}\" --processStart Discord.exe",
                    update.to_string_lossy()
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

pub fn suppress() -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut registry = windows_registry::WindowsDiscordStartupRegistry;
        suppress_registration(&mut registry)
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

pub fn restore() -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut registry = windows_registry::WindowsDiscordStartupRegistry;
        restore_registration(&mut registry)
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
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
