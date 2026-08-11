use std::path::PathBuf;

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
    fn write_backup(&mut self, backup: &DiscordStartupBackup) -> Result<(), String>;
    fn delete_backup(&mut self) -> Result<(), String>;
}

struct DiscordStartupRegistrationManager<R> {
    registry: R,
    launcher_path: PathBuf,
}

impl<R: DiscordStartupRegistry> DiscordStartupRegistrationManager<R> {
    fn new(registry: R, launcher_path: PathBuf) -> Self {
        Self {
            registry,
            launcher_path,
        }
    }

    fn managed_command(&self) -> DiscordStartupCommand {
        DiscordStartupCommand {
            value: format!(
                "\"{}\" --processStart Discord.exe --process-start-args \"--force-renderer-accessibility --remote-debugging-port=9222\"",
                self.launcher_path.display()
            ),
            kind: RegistryStringKind::String,
        }
    }

    fn synchronize(&mut self, should_manage: bool) -> Result<(), String> {
        if !should_manage || !self.launcher_path.is_file() {
            return self.restore();
        }

        let managed = self.managed_command();
        let current = self.registry.read_run_command()?;
        let mut backup = self.registry.read_backup()?;
        if backup.is_none() && current.as_ref().is_some_and(command_is_compatible) {
            return Ok(());
        }
        if backup.is_none() {
            backup = Some(DiscordStartupBackup {
                original: current.clone(),
                managed: managed.clone(),
            });
        }
        let mut backup = backup.expect("Discord startup backup was initialized");
        backup.managed = managed.clone();
        self.registry.write_backup(&backup)?;
        if current.as_ref() != Some(&managed) {
            self.registry.write_run_command(&managed)?;
        }
        Ok(())
    }

    fn restore(&mut self) -> Result<(), String> {
        let Some(backup) = self.registry.read_backup()? else {
            return Ok(());
        };
        if self.registry.read_run_command()?.as_ref() == Some(&backup.managed) {
            if let Some(original) = backup.original.as_ref() {
                self.registry.write_run_command(original)?;
            } else {
                self.registry.delete_run_command()?;
            }
        }
        self.registry.delete_backup()?;
        Ok(())
    }
}

fn command_is_compatible(command: &DiscordStartupCommand) -> bool {
    let normalized = command.value.to_ascii_lowercase();
    normalized.contains("--processstart discord.exe")
        && normalized.contains("--force-renderer-accessibility")
        && normalized.contains("--remote-debugging-port=9222")
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
                .map_err(|error| format!("Discord 시작 명령을 저장하지 못했습니다: {error}"))
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

        fn write_backup(&mut self, backup: &DiscordStartupBackup) -> Result<(), String> {
            let current_user = RegKey::predef(HKEY_CURRENT_USER);
            let (key, _) = current_user
                .create_subkey(BACKUP_KEY)
                .map_err(|error| format!("Discord 시작 명령 백업을 만들지 못했습니다: {error}"))?;
            write_stored_command(&key, "ManagedCommand", "ManagedKind", &backup.managed)?;
            if let Some(original) = backup.original.as_ref() {
                key.set_value("OriginalPresent", &1_u32).map_err(|error| {
                    format!("Discord 시작 명령 백업 상태를 저장하지 못했습니다: {error}")
                })?;
                write_stored_command(&key, "OriginalCommand", "OriginalKind", original)?;
            } else {
                key.set_value("OriginalPresent", &0_u32).map_err(|error| {
                    format!("Discord 시작 명령 백업 상태를 저장하지 못했습니다: {error}")
                })?;
                let _ = key.delete_value("OriginalCommand");
                let _ = key.delete_value("OriginalKind");
            }
            key.set_value("Managed", &1_u32).map_err(|error| {
                format!("Discord 시작 명령 관리 상태를 저장하지 못했습니다: {error}")
            })
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

    fn write_stored_command(
        key: &RegKey,
        value_name: &str,
        kind_name: &str,
        command: &DiscordStartupCommand,
    ) -> Result<(), String> {
        key.set_value(value_name, &command.value)
            .and_then(|_| {
                key.set_value(
                    kind_name,
                    &match command.kind {
                        RegistryStringKind::String => 1_u32,
                        RegistryStringKind::ExpandString => 2_u32,
                    },
                )
            })
            .map_err(|error| format!("Discord 시작 명령 백업을 저장하지 못했습니다: {error}"))
    }
}

#[cfg(windows)]
fn windows_manager() -> Result<
    DiscordStartupRegistrationManager<windows_registry::WindowsDiscordStartupRegistry>,
    String,
> {
    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Windows 로컬 앱 데이터 경로를 찾지 못했습니다.".to_string())?;
    Ok(DiscordStartupRegistrationManager::new(
        windows_registry::WindowsDiscordStartupRegistry,
        PathBuf::from(local_app_data)
            .join("Discord")
            .join("Update.exe"),
    ))
}

pub fn synchronize(should_manage: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        return windows_manager()?.synchronize(should_manage);
    }
    #[cfg(not(windows))]
    {
        let _ = should_manage;
        Ok(())
    }
}

pub fn restore() -> Result<(), String> {
    #[cfg(windows)]
    {
        return windows_manager()?.restore();
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        DiscordStartupBackup, DiscordStartupCommand, DiscordStartupRegistrationManager,
        DiscordStartupRegistry, RegistryStringKind,
    };
    use std::sync::atomic::{AtomicU64, Ordering};

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

        fn write_backup(&mut self, backup: &DiscordStartupBackup) -> Result<(), String> {
            self.backup = Some(backup.clone());
            Ok(())
        }

        fn delete_backup(&mut self) -> Result<(), String> {
            self.backup = None;
            Ok(())
        }
    }

    fn original_command() -> DiscordStartupCommand {
        DiscordStartupCommand {
            value: "original Discord startup".to_string(),
            kind: RegistryStringKind::ExpandString,
        }
    }

    fn manager(
        run: Option<DiscordStartupCommand>,
    ) -> DiscordStartupRegistrationManager<FakeRegistry> {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let launcher = std::env::temp_dir().join(format!(
            "nude-translator-discord-updater-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::write(&launcher, b"test").unwrap();
        DiscordStartupRegistrationManager::new(FakeRegistry { run, backup: None }, launcher)
    }

    #[test]
    fn synchronization_backs_up_discord_and_adds_every_required_argument() {
        let original = original_command();
        let mut manager = manager(Some(original.clone()));

        manager.synchronize(true).unwrap();

        let managed = manager.managed_command();
        assert_eq!(manager.registry.run, Some(managed.clone()));
        assert_eq!(
            manager.registry.backup,
            Some(DiscordStartupBackup {
                original: Some(original),
                managed,
            })
        );
    }

    #[test]
    fn synchronization_repairs_discord_overwrites_without_losing_the_original_backup() {
        let original = original_command();
        let mut manager = manager(Some(original.clone()));
        manager.synchronize(true).unwrap();
        manager.registry.run = Some(DiscordStartupCommand {
            value: "Discord updater replacement".to_string(),
            kind: RegistryStringKind::String,
        });

        manager.synchronize(true).unwrap();

        assert_eq!(manager.registry.run, Some(manager.managed_command()));
        assert_eq!(
            manager
                .registry
                .backup
                .as_ref()
                .and_then(|backup| backup.original.clone()),
            Some(original)
        );
    }

    #[test]
    fn disabling_restores_the_exact_original_command_and_kind() {
        let original = original_command();
        let mut manager = manager(Some(original.clone()));
        manager.synchronize(true).unwrap();

        manager.synchronize(false).unwrap();

        assert_eq!(manager.registry.run, Some(original));
        assert_eq!(manager.registry.backup, None);
    }

    #[test]
    fn disabling_never_overwrites_a_command_changed_by_the_user_or_another_app() {
        let mut manager = manager(Some(original_command()));
        manager.synchronize(true).unwrap();
        let external = DiscordStartupCommand {
            value: "user managed Discord startup".to_string(),
            kind: RegistryStringKind::String,
        };
        manager.registry.run = Some(external.clone());

        manager.synchronize(false).unwrap();

        assert_eq!(manager.registry.run, Some(external));
        assert_eq!(manager.registry.backup, None);
    }

    #[test]
    fn disabling_removes_our_command_when_discord_had_no_original_registration() {
        let mut manager = manager(None);
        manager.synchronize(true).unwrap();

        manager.restore().unwrap();

        assert_eq!(manager.registry.run, None);
        assert_eq!(manager.registry.backup, None);
    }

    #[test]
    fn compatible_external_commands_are_left_unowned_and_unchanged() {
        let compatible = DiscordStartupCommand {
            value: "Update.exe --processStart Discord.exe --process-start-args \"--remote-debugging-port=9222 --force-renderer-accessibility\"".to_string(),
            kind: RegistryStringKind::String,
        };
        let mut manager = manager(Some(compatible.clone()));

        manager.synchronize(true).unwrap();

        assert_eq!(manager.registry.run, Some(compatible));
        assert_eq!(manager.registry.backup, None);
    }

    #[test]
    fn missing_discord_launcher_restores_any_registration_we_owned() {
        let original = original_command();
        let mut manager = manager(Some(original.clone()));
        manager.synchronize(true).unwrap();
        std::fs::remove_file(&manager.launcher_path).unwrap();

        manager.synchronize(true).unwrap();

        assert_eq!(manager.registry.run, Some(original));
        assert_eq!(manager.registry.backup, None);
    }
}
