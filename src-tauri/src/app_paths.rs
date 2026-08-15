use std::fs;
use std::path::{Path, PathBuf};

const CURRENT_DATA_DIRECTORY: &str = "NudeNyang Discord Translator";
const LEGACY_DATA_DIRECTORY: &str = "DiscordTranslateOverlay";

pub fn migrate_legacy_data_directory() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let Some(local_app_data) =
            std::env::var_os("LOCALAPPDATA").filter(|value| !value.is_empty())
        else {
            return Ok(false);
        };
        let parent = PathBuf::from(local_app_data).join("LocalTools");
        return migrate_directory(
            &parent.join(LEGACY_DATA_DIRECTORY),
            &parent.join(CURRENT_DATA_DIRECTORY),
        );
    }

    #[cfg(not(target_os = "windows"))]
    Ok(false)
}

fn migrate_directory(legacy: &Path, current: &Path) -> Result<bool, String> {
    if !legacy.exists() {
        return Ok(false);
    }
    if legacy.parent() != current.parent() {
        return Err("데이터 폴더 이전 대상이 같은 상위 폴더에 있지 않습니다.".to_string());
    }

    if !current.exists() {
        fs::rename(legacy, current).map_err(|error| {
            format!(
                "기존 데이터 폴더를 이전하지 못했습니다 ({} -> {}): {error}",
                legacy.display(),
                current.display()
            )
        })?;
        return Ok(true);
    }

    if legacy.join("settings.json").is_file() && !current.join("settings.json").exists() {
        promote_legacy_directory(legacy, current)?;
        return Ok(true);
    }

    merge_directory_without_overwrite(legacy, current)?;
    Ok(true)
}

fn promote_legacy_directory(legacy: &Path, current: &Path) -> Result<(), String> {
    let parent = current
        .parent()
        .ok_or_else(|| "새 데이터 폴더의 상위 경로를 확인하지 못했습니다.".to_string())?;
    let mut backup = parent.join(format!("{CURRENT_DATA_DIRECTORY}.migration-backup"));
    let mut suffix = 2;
    while backup.exists() {
        backup = parent.join(format!(
            "{CURRENT_DATA_DIRECTORY}.migration-backup-{suffix}"
        ));
        suffix += 1;
    }

    fs::rename(current, &backup).map_err(|error| {
        format!(
            "새 이름으로 먼저 생성된 데이터 폴더를 보존하지 못했습니다 ({}): {error}",
            current.display()
        )
    })?;
    if let Err(error) = fs::rename(legacy, current) {
        let _ = fs::rename(&backup, current);
        return Err(format!(
            "기존 설정이 있는 데이터 폴더를 새 이름으로 이전하지 못했습니다 ({} -> {}): {error}",
            legacy.display(),
            current.display()
        ));
    }
    merge_directory_without_overwrite(&backup, current)
}

fn merge_directory_without_overwrite(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| {
        format!(
            "데이터 이전 대상 폴더를 만들지 못했습니다 ({}): {error}",
            destination.display()
        )
    })?;

    let entries = fs::read_dir(source).map_err(|error| {
        format!(
            "기존 데이터 폴더를 읽지 못했습니다 ({}): {error}",
            source.display()
        )
    })?;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("기존 데이터 항목을 읽지 못했습니다: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|error| format!("기존 데이터 항목 형식을 확인하지 못했습니다: {error}"))?;

        if file_type.is_dir() && destination_path.is_dir() {
            merge_directory_without_overwrite(&source_path, &destination_path)?;
            continue;
        }
        if destination_path.exists() {
            continue;
        }
        fs::rename(&source_path, &destination_path).map_err(|error| {
            format!(
                "기존 데이터 항목을 이전하지 못했습니다 ({} -> {}): {error}",
                source_path.display(),
                destination_path.display()
            )
        })?;
    }

    if fs::read_dir(source)
        .map_err(|error| format!("기존 데이터 폴더를 다시 확인하지 못했습니다: {error}"))?
        .next()
        .is_none()
    {
        fs::remove_dir(source).map_err(|error| {
            format!(
                "비어 있는 기존 데이터 폴더를 정리하지 못했습니다 ({}): {error}",
                source.display()
            )
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_root(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        std::env::temp_dir().join(format!("nudenyang-path-test-{label}-{nonce}"))
    }

    #[test]
    fn moves_the_complete_legacy_directory_when_the_new_directory_is_absent() {
        let root = temporary_root("rename");
        let legacy = root.join(LEGACY_DATA_DIRECTORY);
        let current = root.join(CURRENT_DATA_DIRECTORY);
        fs::create_dir_all(legacy.join("Cache")).expect("create legacy folder");
        fs::write(legacy.join("settings.json"), b"settings").expect("write settings");
        fs::write(legacy.join("Cache/model.gguf"), b"model").expect("write model");

        assert!(migrate_directory(&legacy, &current).expect("migrate directory"));
        assert!(!legacy.exists());
        assert_eq!(
            fs::read(current.join("settings.json")).unwrap(),
            b"settings"
        );
        assert_eq!(
            fs::read(current.join("Cache/model.gguf")).unwrap(),
            b"model"
        );
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn merges_without_overwriting_data_already_stored_under_the_new_name() {
        let root = temporary_root("merge");
        let legacy = root.join(LEGACY_DATA_DIRECTORY);
        let current = root.join(CURRENT_DATA_DIRECTORY);
        fs::create_dir_all(&legacy).expect("create legacy folder");
        fs::create_dir_all(&current).expect("create current folder");
        fs::write(legacy.join("settings.json"), b"legacy").expect("write legacy settings");
        fs::write(legacy.join("model.gguf"), b"model").expect("write legacy model");
        fs::write(current.join("settings.json"), b"current").expect("write current settings");

        assert!(migrate_directory(&legacy, &current).expect("merge directory"));
        assert_eq!(fs::read(current.join("settings.json")).unwrap(), b"current");
        assert_eq!(fs::read(current.join("model.gguf")).unwrap(), b"model");
        assert!(legacy.join("settings.json").exists());
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn legacy_settings_take_priority_over_a_new_cache_created_before_migration() {
        let root = temporary_root("promote-legacy");
        let legacy = root.join(LEGACY_DATA_DIRECTORY);
        let current = root.join(CURRENT_DATA_DIRECTORY);
        fs::create_dir_all(legacy.join("Cache")).expect("create legacy folder");
        fs::create_dir_all(current.join("Cache")).expect("create current folder");
        fs::write(legacy.join("settings.json"), b"legacy settings").expect("write settings");
        fs::write(legacy.join("Cache/cache.db"), b"legacy history").expect("write legacy cache");
        fs::write(current.join("Cache/cache.db"), b"empty new cache").expect("write new cache");

        assert!(migrate_directory(&legacy, &current).expect("promote legacy directory"));
        assert_eq!(
            fs::read(current.join("settings.json")).unwrap(),
            b"legacy settings"
        );
        assert_eq!(
            fs::read(current.join("Cache/cache.db")).unwrap(),
            b"legacy history"
        );
        let backup = root.join(format!("{CURRENT_DATA_DIRECTORY}.migration-backup"));
        assert_eq!(
            fs::read(backup.join("Cache/cache.db")).unwrap(),
            b"empty new cache"
        );
        fs::remove_dir_all(root).expect("remove test root");
    }
}
