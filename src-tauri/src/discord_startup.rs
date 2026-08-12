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
    managed: DiscordStartupCommand,
}

trait DiscordStartupRegistry {
    fn read_run_command(&self) -> Result<Option<DiscordStartupCommand>, String>;
    fn write_run_command(&mut self, command: &DiscordStartupCommand) -> Result<(), String>;
    fn delete_run_command(&mut self) -> Result<(), String>;
    fn read_backup(&self) -> Result<Option<DiscordStartupBackup>, String>;
    fn delete_backup(&mut self) -> Result<(), String>;
}

fn restore_registration<R: DiscordStartupRegistry>(registry: &mut R) -> Result<(), String> {
    let Some(backup) = registry.read_backup()? else {
        return Ok(());
    };
    if registry.read_run_command()?.as_ref() == Some(&backup.managed) {
        if let Some(original) = backup.original.as_ref() {
            registry.write_run_command(original)?;
        } else {
            registry.delete_run_command()?;
        }
    }
    registry.delete_backup()?;
    Ok(())
}

#[cfg(windows)]
mod windows_registry {
    use super::{
        DiscordStartupBackup, DiscordStartupCommand, DiscordStartupRegistry, RegistryStringKind,
    };
    use std::io::ErrorKind;
    use winreg::enums::{HKEY_CURRENT_USER, REG_EXPAND_SZ, REG_SZ};
    use winreg::types::{FromRegValue, ToRegValue};
    use winreg::{RegKey, RegValue};

    const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const DISCORD_VALUE: &str = "Discord";
    const BACKUP_KEY: &str = r"Software\NudeNyang Translator\DiscordStartupBackup";

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
            let key = match current_user.open_subkey(BACKUP_KEY) {
                Ok(key) => key,
                Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
                Err(error) => {
                    return Err(format!("Discord 시작 명령 백업을 열지 못했습니다: {error}"))
                }
            };
            let managed_marker: u32 = key.get_value("Managed").unwrap_or(0);
            if managed_marker != 1 {
                return Ok(None);
            }
            let managed = read_stored_command(&key, "ManagedCommand", "ManagedKind")?
                .ok_or_else(|| "Discord 시작 명령 백업이 완전하지 않습니다.".to_string())?;
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
            Ok(Some(DiscordStartupBackup { original, managed }))
        }

        fn delete_backup(&mut self) -> Result<(), String> {
            let current_user = RegKey::predef(HKEY_CURRENT_USER);
            match current_user.delete_subkey_all(BACKUP_KEY) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
                Err(error) => Err(format!(
                    "Discord 시작 명령 백업을 삭제하지 못했습니다: {error}"
                )),
            }
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
}

pub fn restore() -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut registry = windows_registry::WindowsDiscordStartupRegistry;
        return restore_registration(&mut registry);
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        restore_registration, DiscordStartupBackup, DiscordStartupCommand, DiscordStartupRegistry,
        RegistryStringKind,
    };

    #[derive(Default)]
    struct FakeRegistry {
        run: Option<DiscordStartupCommand>,
        backup: Option<DiscordStartupBackup>,
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

        fn delete_backup(&mut self) -> Result<(), String> {
            self.backup = None;
            Ok(())
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
                managed,
            }),
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
                managed,
            }),
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
                managed,
            }),
        };
        restore_registration(&mut registry).unwrap();
        assert_eq!(registry.run, None);
        assert_eq!(registry.backup, None);
    }
}
