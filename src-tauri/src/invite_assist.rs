use serde_json::Value;
use std::sync::OnceLock;

const MAX_INVITE_CODE_LENGTH: usize = 128;
const INVITE_COPY_KEYS: [&str; 5] = [
    "초대 수락이 완료되지 않으면 브라우저에서 계속해 주세요.",
    "초대를 수락하려면 브라우저에서 계속해 주세요.",
    "브라우저에서 계속",
    "초대 정보를 불러오지 못했습니다. 브라우저에서 초대 상태를 확인해 주세요.",
    "브라우저에서 확인",
];

fn invite_copy_catalog_json() -> &'static str {
    static CATALOG: OnceLock<String> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let mut catalog = serde_json::Map::new();
        for (language, values) in [
            ("ko", INVITE_COPY_KEYS),
            (
                "en",
                [
                    "If the invite is not accepted, please continue in your browser.",
                    "To accept this invite, please continue in your browser.",
                    "Continue in browser",
                    "Discord could not load this invite. Please check its status in your browser.",
                    "Check in browser",
                ],
            ),
            (
                "ja",
                [
                    "招待の承認が完了しない場合は、ブラウザーで続行してください。",
                    "この招待を承認するには、ブラウザーで続行してください。",
                    "ブラウザーで続行",
                    "Discordでこの招待を読み込めませんでした。ブラウザーで状態を確認してください。",
                    "ブラウザーで確認",
                ],
            ),
            (
                "zh",
                [
                    "如果邀请未能接受，请在浏览器中继续。",
                    "要接受此邀请，请在浏览器中继续。",
                    "在浏览器中继续",
                    "Discord 无法加载此邀请。请在浏览器中检查其状态。",
                    "在浏览器中检查",
                ],
            ),
        ] {
            let dictionary = INVITE_COPY_KEYS
                .iter()
                .zip(values)
                .map(|(key, value)| ((*key).to_string(), Value::String(value.to_string())))
                .collect();
            catalog.insert(language.to_string(), Value::Object(dictionary));
        }

        if let Ok(Value::Object(generated)) =
            serde_json::from_str::<Value>(include_str!("../../web/ui-locales.json"))
        {
            for (language, value) in generated {
                let Value::Object(dictionary) = value else {
                    continue;
                };
                let selected = INVITE_COPY_KEYS
                    .iter()
                    .filter_map(|key| {
                        dictionary
                            .get(*key)
                            .and_then(Value::as_str)
                            .map(|value| ((*key).to_string(), Value::String(value.to_string())))
                    })
                    .collect::<serde_json::Map<String, Value>>();
                if selected.len() == INVITE_COPY_KEYS.len() {
                    catalog.insert(language, Value::Object(selected));
                }
            }
        }
        Value::Object(catalog).to_string()
    })
}

pub fn invite_assist_script(ui_language: &str) -> String {
    let encoded_ui_language =
        serde_json::to_string(ui_language).unwrap_or_else(|_| "\"auto\"".to_string());
    let copy_catalog = invite_copy_catalog_json();
    format!(
        r#"(() => {{
  const rootId = 'nt-invite-browser-assist';
  const requestAttribute = 'data-nt-invite-open-request';
  const activeCodeAttribute = 'data-nt-active-invite-code';
  const inlineAttribute = 'data-nt-invite-inline-assist';
  const requested = document.documentElement.getAttribute(requestAttribute) || '';
  document.documentElement.removeAttribute(requestAttribute);
  const configuredLanguage = {encoded_ui_language};
  const copyCatalog = {copy_catalog};
  function resolvedLanguage() {{
    let language = configuredLanguage === 'auto' ? navigator.language : configuredLanguage;
    language = String(language || 'en').replace('_', '-');
    const lower = language.toLowerCase();
    if (lower.startsWith('zh-tw') || lower.startsWith('zh-hk') || lower.startsWith('zh-mo')) return 'zh-Hant';
    if (lower.startsWith('zh')) return 'zh';
    if (lower.startsWith('pt')) return 'pt-BR';
    if (lower.startsWith('es')) return 'es-419';
    if (lower.startsWith('fil') || lower.startsWith('tl')) return 'fil';
    const base = lower.split('-')[0];
    return copyCatalog[language] ? language : copyCatalog[base] ? base : 'en';
  }}
  const interfaceLanguage = resolvedLanguage();
  const copy = copyCatalog[interfaceLanguage] || copyCatalog.en;
  const rtl = ['ar', 'ur', 'fa', 'he'].includes(interfaceLanguage);
  const validCode = code => typeof code === 'string'
    && /^[A-Za-z0-9_-]{{1,128}}$/.test(code);
  function inviteCodeFromUrl(value) {{
    try {{
      const url = new URL(value, location.origin);
      const host = url.hostname.toLowerCase();
      const parts = url.pathname.split('/').filter(Boolean);
      let code = '';
      if (host === 'discord.gg') code = parts[0] || '';
      else if (host === 'discord.com' || host === 'www.discord.com') {{
        if (parts[0]?.toLowerCase() === 'invite') code = parts[1] || '';
      }}
      return validCode(code) ? code : '';
    }} catch (_) {{
      return '';
    }}
  }}
  function inviteCodeNear(element) {{
    if (!(element instanceof Element)) return '';
    const direct = element.closest('a[href]');
    const directCode = direct ? inviteCodeFromUrl(direct.href) : '';
    if (directCode) return directCode;
    const row = element.closest(
      '[id^="chat-messages-"],[data-list-item-id^="chat-messages___"]'
    );
    if (!row) return '';
    for (const anchor of row.querySelectorAll('a[href]')) {{
      const code = inviteCodeFromUrl(anchor.href);
      if (code) return code;
    }}
    return '';
  }}
  if (!window.__ntInviteAssistClickCaptureInstalled) {{
    window.__ntInviteAssistClickCaptureInstalled = true;
    document.addEventListener('click', event => {{
      const code = inviteCodeNear(event.target);
      if (!code) return;
      document.documentElement.setAttribute(activeCodeAttribute, code);
      window.__ntActiveInvite = {{code, observedAt: Date.now()}};
    }}, true);
  }}
  function isVisible(node) {{
    const rect = node?.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0
      && rect.bottom > 0 && rect.top < innerHeight);
  }}
  const knownCodes = new Set();
  const routeMatch = location.pathname.match(/^\/invite\/([A-Za-z0-9_-]{{1,128}})\/?$/);
  const routeCode = routeMatch?.[1] || '';
  if (routeCode) knownCodes.add(routeCode);
  for (const anchor of document.querySelectorAll('a[href]')) {{
    const code = inviteCodeFromUrl(anchor.href);
    if (code) knownCodes.add(code);
  }}
  const storedCode = document.documentElement.getAttribute(activeCodeAttribute) || '';
  const activeCode = validCode(storedCode) ? storedCode : '';
  if (activeCode) knownCodes.add(activeCode);

  const inviteWords = /(초대 받음|초대를 받|invite|invitation|招待|邀请|邀請|einladung|invitaci[oó]n|convite|invito)/i;
  const inviteDialog = activeCode
    ? [...document.querySelectorAll('[role="dialog"]')].find(dialog => {{
        if (!isVisible(dialog)) return false;
        const structural = dialog.querySelector(
          '[class*="inviteSplash_"],[class*="inviteContent_"],[class*="inviteModal_"]'
        );
        return Boolean(structural) || inviteWords.test(dialog.innerText || '');
      }})
    : null;
  const globalCode = routeCode || (inviteDialog ? activeCode : '');
  let root = document.getElementById(rootId);
  if (!globalCode) {{
    root?.remove();
  }} else if (!root) {{
    root = document.createElement('aside');
    root.id = rootId;
    root.setAttribute('role', 'note');
    root.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    root.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:24px', 'transform:translateX(-50%)',
      'z-index:2147483000', 'display:flex', 'align-items:center', 'gap:14px',
      'max-width:min(680px,calc(100vw - 48px))', 'padding:12px 14px',
      'border:1px solid rgba(93,173,255,.48)', 'border-radius:12px',
      'background:#112737', 'box-shadow:0 12px 32px rgba(0,0,0,.38)',
      'color:#dceeff', 'font:600 14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    ].join(';');
    const message = document.createElement('span');
    message.setAttribute('data-nt-invite-assist-message', '');
    message.style.cssText = 'min-width:0;flex:1';
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-nt-invite-assist-button', '');
    button.style.cssText = [
      'appearance:none', 'border:1px solid #58a9ef', 'border-radius:9px',
      'padding:9px 13px', 'background:#1d4b6c', 'color:#8bc8ff',
      'font:700 14px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'cursor:pointer', 'white-space:nowrap'
    ].join(';');
    root.append(message, button);
    document.body.append(root);
  }}
  if (root && globalCode) {{
    const dialogCopy = Boolean(inviteDialog);
    root.querySelector('[data-nt-invite-assist-message]').textContent = dialogCopy
      ? copy['초대 수락이 완료되지 않으면 브라우저에서 계속해 주세요.']
      : copy['초대를 수락하려면 브라우저에서 계속해 주세요.'];
    const button = root.querySelector('[data-nt-invite-assist-button]');
    button.textContent = copy['브라우저에서 계속'];
    button.onclick = () => document.documentElement.setAttribute(
      requestAttribute, globalCode
    );
  }}

  const invalidWords = /(올바르지 않은 초대장|초대를 수락할 수 없음|invalid invite|unable to accept invite|ungültige einladung|無効な招待|无效邀请|無效邀請|invitaci[oó]n no v[aá]lida|convite inv[aá]lido|invitation non valide)/i;
  const liveInline = new Set();
  for (const anchor of document.querySelectorAll('a[href]')) {{
    const code = inviteCodeFromUrl(anchor.href);
    if (!code) continue;
    const row = anchor.closest(
      '[id^="chat-messages-"],[data-list-item-id^="chat-messages___"]'
    );
    if (!row || !isVisible(row)) continue;
    const invalidClass = row.querySelector(
      '[class*="invalidInvite_"],[class*="invalidInvite"],[class*="invalid_"][class*="invite"]'
    );
    if (!invalidClass && !invalidWords.test(row.innerText || '')) continue;
    const host = anchor.closest('[class*="contents_"]') || row;
    let helper = [...host.querySelectorAll(`[${{inlineAttribute}}]`)]
      .find(item => item.getAttribute(inlineAttribute) === code);
    if (!helper) {{
      helper = document.createElement('aside');
      helper.setAttribute(inlineAttribute, code);
      helper.setAttribute('role', 'note');
      helper.setAttribute('dir', rtl ? 'rtl' : 'ltr');
      helper.style.cssText = [
        'display:flex', 'align-items:center', 'gap:12px',
        'max-width:720px', 'margin-top:8px', 'padding:10px 12px',
        'border:1px solid rgba(93,173,255,.36)', 'border-radius:10px',
        'background:#142635', 'color:#cfe6f8',
        'font:600 14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
      ].join(';');
      const message = document.createElement('span');
      message.setAttribute('data-nt-invite-inline-message', '');
      message.style.cssText = 'min-width:0;flex:1';
      const action = document.createElement('button');
      action.type = 'button';
      action.setAttribute('data-nt-invite-inline-button', '');
      action.style.cssText = [
        'appearance:none', 'border:1px solid #4b91c8', 'border-radius:8px',
        'padding:8px 11px', 'background:#193f5b', 'color:#85c5f8',
        'font:700 13px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        'cursor:pointer', 'white-space:nowrap'
      ].join(';');
      helper.append(message, action);
      host.append(helper);
    }}
    helper.querySelector('[data-nt-invite-inline-message]').textContent =
      copy['초대 정보를 불러오지 못했습니다. 브라우저에서 초대 상태를 확인해 주세요.'];
    const action = helper.querySelector('[data-nt-invite-inline-button]');
    action.textContent = copy['브라우저에서 확인'];
    action.onclick = () => document.documentElement.setAttribute(requestAttribute, code);
    liveInline.add(helper);
  }}
  for (const helper of document.querySelectorAll(`[${{inlineAttribute}}]`)) {{
    if (!liveInline.has(helper)) helper.remove();
  }}
  return validCode(requested) && knownCodes.has(requested) ? requested : '';
}})()"#
    )
}

pub fn parse_invite_open_request(value: Value) -> Option<String> {
    let code = value.as_str()?.trim();
    valid_invite_code(code).then(|| code.to_string())
}

pub fn valid_invite_code(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= MAX_INVITE_CODE_LENGTH
        && code
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

#[cfg(test)]
mod tests {
    use super::{invite_assist_script, parse_invite_open_request, valid_invite_code};
    use serde_json::json;

    #[test]
    fn invite_codes_are_strictly_limited_to_discord_safe_characters() {
        assert!(valid_invite_code("crow"));
        assert!(valid_invite_code("abc_DEF-123"));
        assert!(!valid_invite_code(""));
        assert!(!valid_invite_code("../login"));
        assert!(!valid_invite_code("crow?redirect=https://example.com"));
        assert!(!valid_invite_code(&"a".repeat(129)));
    }

    #[test]
    fn open_requests_reject_non_string_and_unsafe_values() {
        assert_eq!(
            parse_invite_open_request(json!("crow")),
            Some("crow".into())
        );
        assert_eq!(parse_invite_open_request(json!(null)), None);
        assert_eq!(
            parse_invite_open_request(json!("https://example.com")),
            None
        );
    }

    #[test]
    fn helper_requires_a_user_click_and_only_runs_on_invite_routes() {
        let script = invite_assist_script("ko");
        assert!(script.contains("/^\\/invite\\/"));
        assert!(script.contains("button.onclick"));
        assert!(script.contains("data-nt-invite-open-request"));
        assert!(script.contains("초대를 수락하려면 브라우저에서 계속해 주세요."));
        assert!(script.contains("브라우저에서 계속"));
        assert!(!script.contains("window.open"));
    }

    #[test]
    fn helper_supports_open_invite_dialogs_and_invalid_invite_cards() {
        let script = invite_assist_script("ko");
        assert!(script.contains("data-nt-active-invite-code"));
        assert!(script.contains("document.addEventListener('click'"));
        assert!(script.contains("[role=\"dialog\"]"));
        assert!(script.contains("data-nt-invite-inline-assist"));
        assert!(script.contains("초대 수락이 완료되지 않으면 브라우저에서 계속해 주세요."));
        assert!(script
            .contains("초대 정보를 불러오지 못했습니다. 브라우저에서 초대 상태를 확인해 주세요."));
        assert!(script.contains("브라우저에서 확인"));
        assert!(!script.contains("location.href ="));
    }

    #[test]
    fn helper_uses_the_configured_interface_language_for_every_message() {
        let script = invite_assist_script("ru");
        assert!(script.contains("Discord не удалось загрузить это приглашение"));
        assert!(script.contains("Проверить в браузере"));
        assert!(!script.contains("korean ?"));
    }
}
