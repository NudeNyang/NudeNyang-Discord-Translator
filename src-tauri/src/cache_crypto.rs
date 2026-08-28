//! Windows user-scoped encryption for shared translation cache bodies.
//! DPAPI owns the key; neither a key nor plaintext fallback is saved by the app.

#[cfg(windows)]
fn transform(input: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: input
            .len()
            .try_into()
            .map_err(|_| "캐시 데이터가 너무 큽니다.")?,
        pbData: input.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // SAFETY: input lives through the synchronous call, output is initialized,
    // no UI or machine-wide scope is requested, and DPAPI output is freed once.
    unsafe {
        let ok = if encrypt {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err("Windows 사용자 계정으로 번역 캐시를 보호하거나 읽지 못했습니다.".into());
        }
        let bytes = if output.cbData == 0 {
            Vec::new()
        } else {
            std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec()
        };
        LocalFree(output.pbData.cast());
        Ok(bytes)
    }
}

#[cfg(not(windows))]
fn transform(_input: &[u8], _encrypt: bool) -> Result<Vec<u8>, String> {
    Err("이 운영체제에서는 암호화된 디스크 캐시를 지원하지 않습니다.".into())
}

pub(crate) fn encrypt(text: &str) -> Result<Vec<u8>, String> {
    transform(text.as_bytes(), true)
}
pub(crate) fn decrypt(bytes: &[u8]) -> Result<String, String> {
    String::from_utf8(transform(bytes, false)?)
        .map_err(|_| "암호화된 번역 캐시를 해석하지 못했습니다.".into())
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn dpapi_round_trip_and_corruption_fail_closed() {
        for text in ["", "Synthetic private message — 개인 메시지"] {
            let mut encrypted = super::encrypt(text).unwrap();
            assert_ne!(encrypted, text.as_bytes());
            assert_eq!(super::decrypt(&encrypted).unwrap(), text);
            encrypted[0] ^= 0xff;
            assert!(super::decrypt(&encrypted).is_err());
        }
    }
}
