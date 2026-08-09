const SERVICE_NAME: &str = "NudeNyang Translator";

fn entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE_NAME, provider)
        .map_err(|error| format!("운영체제 보안 저장소를 열지 못했습니다: {error}"))
}

pub fn read(provider: &str) -> Result<Option<String>, String> {
    match entry(provider)?.get_password() {
        Ok(secret) if !secret.trim().is_empty() => Ok(Some(secret)),
        Ok(_) => Ok(None),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!(
            "저장된 {provider} 자격 증명을 읽지 못했습니다: {error}"
        )),
    }
}

pub fn write(provider: &str, secret: &str) -> Result<(), String> {
    if secret.trim().is_empty() {
        return Err("비어 있는 인증 정보는 저장할 수 없습니다.".to_string());
    }
    entry(provider)?
        .set_password(secret.trim())
        .map_err(|error| format!("{provider} 자격 증명을 안전하게 저장하지 못했습니다: {error}"))
}

pub fn delete(provider: &str) -> Result<(), String> {
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "저장된 {provider} 자격 증명을 삭제하지 못했습니다: {error}"
        )),
    }
}
