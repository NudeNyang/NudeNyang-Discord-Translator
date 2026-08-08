use reqwest::blocking::Client;
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::{json, Value};

const GITHUB_API_VERSION: &str = "2026-03-10";
const WINDOWS_ASSET_NAME: &str = "NudeTranslator-Windows-x64.zip";
const MACOS_ASSET_NAME: &str = "NudeTranslator-macOS-arm64.zip";

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    #[serde(default)]
    digest: String,
}

pub fn check_for_update(repository: &str, current_version: &str) -> Result<Value, String> {
    validate_repository(repository)?;
    let current = version_tuple(current_version)?;
    let client = Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Nude-Translator-Updater")
        .build()
        .map_err(|error| format!("업데이트 확인 클라이언트를 만들지 못했어: {error}"))?;
    let response = client
        .get(format!(
            "https://api.github.com/repos/{repository}/releases/latest"
        ))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", GITHUB_API_VERSION)
        .send()
        .map_err(|error| format!("GitHub Release를 확인하지 못했어: {error}"))?;
    if response.status() == StatusCode::NOT_FOUND {
        return Ok(json!({"available": false}));
    }
    let response = response
        .error_for_status()
        .map_err(|error| format!("GitHub Release 응답이 실패했어: {error}"))?;
    let release: GitHubRelease = response
        .json()
        .map_err(|error| format!("GitHub Release 응답을 읽지 못했어: {error}"))?;
    release_result(release, current)
}

fn release_result(release: GitHubRelease, current: (u64, u64, u64)) -> Result<Value, String> {
    if release.draft || release.prerelease {
        return Ok(json!({"available": false}));
    }
    let latest = version_tuple(&release.tag_name)?;
    if latest <= current {
        return Ok(json!({"available": false}));
    }
    let expected_asset = platform_asset_name()?;
    let Some(asset) = release
        .assets
        .iter()
        .find(|asset| asset.name == expected_asset)
    else {
        return Ok(json!({"available": false}));
    };
    let valid_digest = asset.digest.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
    });
    if !valid_digest {
        return Ok(json!({"available": false}));
    }
    Ok(json!({
        "available": true,
        "version": format!("{}.{}.{}", latest.0, latest.1, latest.2),
        "pageUrl": release.html_url,
    }))
}

fn platform_asset_name() -> Result<&'static str, String> {
    if cfg!(target_os = "windows") {
        Ok(WINDOWS_ASSET_NAME)
    } else if cfg!(target_os = "macos") {
        Ok(MACOS_ASSET_NAME)
    } else {
        Err("현재 운영체제의 업데이트 파일 이름이 정의되지 않았어.".to_string())
    }
}

fn validate_repository(repository: &str) -> Result<(), String> {
    let mut parts = repository.split('/');
    let owner = parts.next().unwrap_or_default();
    let name = parts.next().unwrap_or_default();
    let valid_part = |part: &str| {
        !part.is_empty()
            && !matches!(part, "." | "..")
            && part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
    };
    if !valid_part(owner) || !valid_part(name) || parts.next().is_some() {
        return Err("업데이트 저장소는 owner/repository 형식이어야 해.".to_string());
    }
    Ok(())
}

fn version_tuple(version: &str) -> Result<(u64, u64, u64), String> {
    let core = version
        .trim()
        .strip_prefix('v')
        .unwrap_or(version.trim())
        .split(['-', '+'])
        .next()
        .unwrap_or_default();
    let values = core
        .split('.')
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| format!("지원하지 않는 버전 형식이야: {version}"))?;
    match values.as_slice() {
        [major, minor, patch] => Ok((*major, *minor, *patch)),
        _ => Err(format!("지원하지 않는 버전 형식이야: {version}")),
    }
}

#[cfg(test)]
mod tests {
    use super::{release_result, validate_repository, version_tuple, GitHubAsset, GitHubRelease};

    #[test]
    fn semantic_versions_match_the_legacy_updater_rules() {
        assert_eq!(version_tuple("v1.2.3").unwrap(), (1, 2, 3));
        assert_eq!(version_tuple("1.2.3-beta+7").unwrap(), (1, 2, 3));
        assert!(version_tuple("1.2").is_err());
    }

    #[test]
    fn repository_names_are_restricted_to_owner_and_name() {
        assert!(validate_repository("NudeNyang/Nude-Translator").is_ok());
        assert!(validate_repository("../unsafe").is_err());
        assert!(validate_repository("owner/repository/extra").is_err());
    }

    #[test]
    fn release_requires_a_newer_version_and_sha256_asset() {
        let release = GitHubRelease {
            tag_name: "v0.3.0".to_string(),
            html_url: "https://example.test/release".to_string(),
            draft: false,
            prerelease: false,
            assets: vec![GitHubAsset {
                name: super::platform_asset_name().unwrap().to_string(),
                digest: format!("sha256:{}", "a".repeat(64)),
            }],
        };
        let result = release_result(release, (0, 2, 0)).unwrap();
        assert_eq!(result["available"], true);
        assert_eq!(result["version"], "0.3.0");
    }
}
