const SERVICE_NAME: &str = "NudeNyang Discord Translator";
const LEGACY_SERVICE_NAMES: &[&str] = &["NudeNyang Translator", "Nude Translator"];

fn entry(service: &str, provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, provider)
        .map_err(|error| format!("운영체제 보안 저장소를 열지 못했습니다: {error}"))
}

fn read_entry(service: &str, provider: &str) -> Result<Option<String>, String> {
    match entry(service, provider)?.get_password() {
        Ok(secret) if !secret.trim().is_empty() => Ok(Some(secret)),
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!(
            "저장된 {provider} 자격 증명을 읽지 못했습니다: {error}"
        )),
    }
}

pub fn read(provider: &str) -> Result<Option<String>, String> {
    if let Some(secret) = read_entry(SERVICE_NAME, provider)? {
        return Ok(Some(secret));
    }
    for legacy_service in LEGACY_SERVICE_NAMES {
        let Some(secret) = read_entry(legacy_service, provider)? else {
            continue;
        };
        if entry(SERVICE_NAME, provider)?
            .set_password(secret.trim())
            .is_ok()
        {
            let _ = entry(legacy_service, provider)?.delete_credential();
        }
        return Ok(Some(secret));
    }
    Ok(None)
}

pub fn write(provider: &str, secret: &str) -> Result<(), String> {
    if secret.trim().is_empty() {
        return Err("비어 있는 인증 정보는 저장할 수 없습니다.".to_string());
    }
    entry(SERVICE_NAME, provider)?
        .set_password(secret.trim())
        .map_err(|error| format!("{provider} 자격 증명을 안전하게 저장하지 못했습니다: {error}"))
}

pub fn delete(provider: &str) -> Result<(), String> {
    for service in std::iter::once(SERVICE_NAME).chain(LEGACY_SERVICE_NAMES.iter().copied()) {
        match entry(service, provider)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => {
                return Err(format!(
                    "저장된 {provider} 자격 증명을 삭제하지 못했습니다: {error}"
                ))
            }
        }
    }
    Ok(())
}
