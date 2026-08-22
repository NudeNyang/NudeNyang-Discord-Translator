use serde::Deserialize;
use serde_json::Value;

pub const VERIFICATION_DETECTION_SCRIPT: &str = r#"
(() => {
  const visible = element => {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0;
  };
  const captcha = [...document.querySelectorAll(
    'iframe[src*="hcaptcha.com" i], iframe[src*="recaptcha" i], iframe[title*="captcha" i], [data-testid*="captcha" i], [class*="captcha" i]'
  )].find(visible);
  if (captcha) return {required:true, kind:'captcha'};

  const path = location.pathname.toLowerCase();
  if (/\/(login|register|verify)(?:\/|$)/.test(path)) {
    return {required:true, kind:'account-verification'};
  }

  const verificationInput = [...document.querySelectorAll(
    'input[autocomplete="one-time-code"], [role="dialog"] input[type="tel"], [aria-modal="true"] input[type="tel"]'
  )].find(visible);
  if (verificationInput) return {required:true, kind:'account-verification'};

  const modal = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].find(visible);
  if (modal) {
    const text = (modal.innerText || modal.textContent || '').toLowerCase();
    const verificationCopy = [
      'verify your account', 'verification required', 'phone verification',
      '본인 확인', '계정 인증', '전화번호 인증',
      'アカウントを認証', '電話番号認証',
      '验证你的账号', '验证您的帐号', '手机验证'
    ];
    if (verificationCopy.some(copy => text.includes(copy.toLowerCase()))) {
      return {required:true, kind:'account-verification'};
    }
  }
  return {required:false, kind:''};
})()
"#;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VerificationObservation {
    pub required: bool,
    #[serde(default)]
    pub kind: String,
}

pub fn parse_verification_observation(value: Value) -> Result<VerificationObservation, String> {
    serde_json::from_value(value)
        .map_err(|error| format!("Discord 인증 화면 상태를 읽지 못했습니다: {error}"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{parse_verification_observation, VERIFICATION_DETECTION_SCRIPT};

    #[test]
    fn parses_verification_observations() {
        let observation = parse_verification_observation(json!({
            "required": true,
            "kind": "captcha"
        }))
        .unwrap();
        assert!(observation.required);
        assert_eq!(observation.kind, "captcha");
    }

    #[test]
    fn detector_checks_captcha_and_verification_without_account_actions() {
        assert!(VERIFICATION_DETECTION_SCRIPT.contains("hcaptcha.com"));
        assert!(VERIFICATION_DETECTION_SCRIPT.contains("one-time-code"));
        assert!(!VERIFICATION_DETECTION_SCRIPT.contains("dispatchEvent"));
        assert!(!VERIFICATION_DETECTION_SCRIPT.contains("click()"));
    }
}
