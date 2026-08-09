use std::collections::HashMap;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::language::{detect_explicit_language, Language};

const OUTGOING_UI_SCRIPT: &str = r####"
(() => {
  const enabled = __ENABLED__;
  const defaultLanguage = __DEFAULT_LANGUAGE__;
  const GLOBAL = '__nudeTranslatorOutgoing';
  const ROOT_ID = 'nt-outgoing-translation';
  const CONTROLLER_VERSION = 4;
  const composerSelector = '[role="textbox"][contenteditable="true"], [contenteditable="true"][data-slate-editor="true"]';
  const languageLabels = {auto:'자동 감지',ko:'한국어',ja:'日本語',en:'English',zh:'简体中文','zh-Hant':'繁體中文'};
  const storageKey = key => `nude-translator:outgoing-language:${key}`;

  function currentChannelKey() {
    return location.pathname.startsWith('/channels/') ? location.pathname : '';
  }
  function readStoredLanguage(key, fallbackLanguage) {
    try { return localStorage.getItem(storageKey(key)) || fallbackLanguage; } catch { return fallbackLanguage; }
  }
  function writeStoredLanguage(key, language) {
    try {
      if (language === 'auto') localStorage.removeItem(storageKey(key));
      else localStorage.setItem(storageKey(key), language);
    } catch {}
  }
  function originalText(root) {
    const originals = window.__nudeTranslatorOriginals;
    if (!(originals instanceof Map)) return root.innerText || root.textContent || '';
    const values = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      values.push(originals.has(node) ? originals.get(node) : node.nodeValue || '');
    }
    return values.join('');
  }
  function recentMessages() {
    return [...document.querySelectorAll('[id^="message-content-"]')]
      .filter(node => !node.closest('[id^="message-reply-context-"]'))
      .slice(-24)
      .map(node => originalText(node).trim())
      .filter(Boolean);
  }
  function composerText(editor) {
    return (editor.innerText || editor.textContent || '').replace(/\u00a0/g, ' ').trim();
  }
  function makeButton(text, action, value = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.dataset.action = action;
    if (value) button.dataset.value = value;
    return button;
  }
  function ensureRoot(controller) {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = '<button type="button" class="nt-outgoing-trigger" aria-expanded="false"><span>전송 언어</span><b>자동 감지</b><i>⌄</i></button><div class="nt-outgoing-menu" hidden></div><p class="nt-outgoing-status" hidden></p>';
    const style = document.createElement('style');
    style.id = `${ROOT_ID}-style`;
    style.textContent = `
      #${ROOT_ID}{position:fixed;right:18px;bottom:82px;z-index:2147483000;font-family:var(--font-primary,Arial,sans-serif);font-size:12px;color:var(--text-normal,#dbdee1)}
      #${ROOT_ID} button{font:inherit;color:inherit;cursor:pointer}
      #${ROOT_ID} .nt-outgoing-trigger{display:flex;align-items:center;gap:7px;min-height:30px;padding:5px 10px;border:1px solid color-mix(in srgb,#5aa8f5 45%,transparent);border-radius:9px;background:var(--background-secondary,#2b2d31);box-shadow:0 3px 10px #0004}
      #${ROOT_ID} .nt-outgoing-trigger:hover{background:color-mix(in srgb,var(--background-secondary,#2b2d31) 82%,#5aa8f5)}
      #${ROOT_ID} .nt-outgoing-trigger span{color:var(--text-muted,#949ba4)}
      #${ROOT_ID} .nt-outgoing-trigger b{font-weight:650}
      #${ROOT_ID} .nt-outgoing-trigger i{font-style:normal;color:#78b7f5}
      #${ROOT_ID} .nt-outgoing-menu{position:absolute;right:0;bottom:38px;width:238px;padding:6px;border:1px solid color-mix(in srgb,#5aa8f5 35%,transparent);border-radius:11px;background:var(--background-floating,#111214);box-shadow:0 10px 30px #0008}
      #${ROOT_ID} .nt-outgoing-menu button{display:flex;width:100%;min-height:32px;align-items:center;padding:7px 9px;border:0;border-radius:7px;background:transparent;text-align:left}
      #${ROOT_ID} .nt-outgoing-menu button:hover{background:color-mix(in srgb,#5aa8f5 24%,transparent)}
      #${ROOT_ID} .nt-outgoing-menu .nt-heading{padding:7px 9px 4px;color:var(--text-muted,#949ba4);font-size:11px}
      #${ROOT_ID} .nt-outgoing-menu .nt-divider{height:1px;margin:5px;background:var(--background-modifier-accent,#ffffff14)}
      #${ROOT_ID} .nt-outgoing-status{max-width:270px;margin:6px 0 0;padding:7px 9px;border-radius:7px;background:var(--background-floating,#111214);box-shadow:0 4px 16px #0008;white-space:pre-line}
      #${ROOT_ID} .nt-outgoing-status[data-error="true"]{color:#ff9ca3}
    `;
    document.head.append(style);
    document.body.append(root);
    root.querySelector('.nt-outgoing-trigger').addEventListener('click', () => controller.toggleMenu());
    root.querySelector('.nt-outgoing-menu').addEventListener('click', event => controller.onMenu(event));
    return root;
  }

  let controller = window[GLOBAL];
  if (controller && controller.version !== CONTROLLER_VERSION) {
    if (controller.listener) document.removeEventListener('keydown', controller.listener, true);
    clearTimeout(controller.statusTimer);
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(`${ROOT_ID}-style`)?.remove();
    delete window[GLOBAL];
    controller = null;
  }
  if (!controller) {
    controller = {
      version: CONTROLLER_VERSION,
      enabled: false,
      queue: [],
      pending: new Map(),
      sequence: 0,
      bypass: 0,
      activeRequest: '',
      oneShotOriginal: false,
      manualRequest: '',
      statusTimer: 0,
      root: null,
      defaultLanguage: 'auto',
      setStatus(message, error = false) {
        if (!this.root) return;
        const status = this.root.querySelector('.nt-outgoing-status');
        status.textContent = message;
        status.dataset.error = String(error);
        status.hidden = !message;
        clearTimeout(this.statusTimer);
        if (message) this.statusTimer = setTimeout(() => { status.hidden = true; }, 5000);
      },
      updateLabel() {
        if (!this.root) return;
        const key = currentChannelKey();
        const language = readStoredLanguage(key, this.defaultLanguage);
        this.root.querySelector('.nt-outgoing-trigger b').textContent = languageLabels[language] || languageLabels.auto;
      },
      showLanguageMenu(heading = '전송 언어 선택', requestId = '') {
        this.manualRequest = requestId;
        const menu = this.root.querySelector('.nt-outgoing-menu');
        menu.replaceChildren();
        const title = document.createElement('div');
        title.className = 'nt-heading';
        title.textContent = heading;
        menu.append(title);
        const choices = requestId ? ['ko','ja','en','zh','zh-Hant'] : ['auto','ko','ja','en','zh','zh-Hant'];
        for (const code of choices) menu.append(makeButton(languageLabels[code], 'language', code));
        const divider = document.createElement('div');
        divider.className = 'nt-divider';
        menu.append(divider, makeButton('이번 메시지만 원문으로 전송', 'original-once'));
        menu.hidden = false;
        this.root.querySelector('.nt-outgoing-trigger').setAttribute('aria-expanded', 'true');
      },
      toggleMenu() {
        const menu = this.root.querySelector('.nt-outgoing-menu');
        if (menu.hidden) this.showLanguageMenu();
        else { menu.hidden = true; this.root.querySelector('.nt-outgoing-trigger').setAttribute('aria-expanded', 'false'); }
      },
      onMenu(event) {
        const button = event.target.closest('button');
        if (!button) return;
        const key = currentChannelKey();
        if (button.dataset.action === 'language') {
          writeStoredLanguage(key, button.dataset.value);
          if (this.manualRequest) this.retry(this.manualRequest, button.dataset.value);
          this.manualRequest = '';
          this.updateLabel();
        } else if (button.dataset.action === 'original-once') {
          if (this.manualRequest) {
            this.retry(this.manualRequest, 'original');
            this.manualRequest = '';
          } else {
            this.oneShotOriginal = true;
            this.setStatus('다음 메시지는 번역하지 않고 전송합니다.');
          }
        } else if (button.dataset.action === 'suggest-channel') {
          writeStoredLanguage(this.pending.get(button.dataset.value)?.channel_key || key, button.dataset.language);
          this.retry(button.dataset.value, button.dataset.language);
          this.updateLabel();
        } else if (button.dataset.action === 'suggest-once') {
          this.retry(button.dataset.value, button.dataset.language);
        } else if (button.dataset.action === 'suggest-original') {
          this.retry(button.dataset.value, 'original');
        }
        this.root.querySelector('.nt-outgoing-menu').hidden = true;
        this.root.querySelector('.nt-outgoing-trigger').setAttribute('aria-expanded', 'false');
      },
      retry(id, language) {
        const item = this.pending.get(id);
        if (!item) return;
        this.queue.push({...item, selected_language: language});
        this.setStatus(language === 'original' ? '원문을 전송합니다.' : '메시지를 번역하고 있습니다.');
      },
      suggest(id, language) {
        const item = this.pending.get(id);
        if (!item) return;
        const menu = this.root.querySelector('.nt-outgoing-menu');
        menu.replaceChildren();
        if (!language || !languageLabels[language]) {
          this.showLanguageMenu('대화 언어를 판단하지 못했습니다. 전송 언어를 선택하십시오.', id);
          return;
        }
        const heading = document.createElement('div');
        heading.className = 'nt-heading';
        heading.textContent = `최근 대화는 ${languageLabels[language]}로 보입니다.`;
        const channel = makeButton(`${languageLabels[language]} · 채널에 적용`, 'suggest-channel', id);
        channel.dataset.language = language;
        const once = makeButton(`${languageLabels[language]} · 이번만`, 'suggest-once', id);
        once.dataset.language = language;
        menu.append(heading, channel, once, makeButton('원문 전송', 'suggest-original', id));
        menu.hidden = false;
        this.root.querySelector('.nt-outgoing-trigger').setAttribute('aria-expanded', 'true');
        this.setStatus('전송 언어를 확인한 후 메시지를 전송합니다.');
      },
      fail(id, message) {
        this.pending.delete(id);
        if (this.activeRequest === id) {
          this.activeRequest = '';
          this.bypass = 0;
        }
        this.setStatus(message || '메시지를 번역하지 못했습니다. 번역하지 않고 원문을 유지합니다.', true);
      },
      prunePending() {
        const now = Date.now();
        for (const [id, item] of this.pending) {
          if (item.editor?.isConnected && now - item.created_at < 30000) continue;
          this.pending.delete(id);
          if (this.activeRequest === id) {
            this.activeRequest = '';
            this.bypass = 0;
          }
        }
      },
      keydown(event) {
        if (!this.enabled || event.key !== 'Enter' || event.shiftKey || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
        const editor = event.target.closest?.(composerSelector);
        if (!editor) return;
        if (this.bypass > 0) {
          this.bypass -= 1;
          const activeId = this.activeRequest;
          const activeItem = activeId ? this.pending.get(activeId) : null;
          const keepAfterSend = Boolean(activeItem?.keep_after_send);
          if (activeItem) activeItem.keep_after_send = false;
          if (activeId && !keepAfterSend) this.pending.delete(activeId);
          this.activeRequest = '';
          if (!keepAfterSend) this.setStatus('');
          return;
        }
        const text = composerText(editor);
        if (!text || text.startsWith('/') || text.includes('```')) return;
        const key = currentChannelKey();
        if (!key) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const previous = [...this.pending.entries()].find(([, item]) => item.editor === editor);
        if (previous) {
          const [previousId, previousItem] = previous;
          const expired = Date.now() - previousItem.created_at >= 30000;
          const changed = previousItem.text !== text;
          if (!expired && !changed) {
            this.setStatus('이전 메시지를 처리하고 있습니다. 잠시 후 다시 시도하십시오.');
            return;
          }
          this.pending.delete(previousId);
          if (this.activeRequest === previousId) {
            this.activeRequest = '';
            this.bypass = 0;
          }
        }
        const id = `outgoing-${Date.now()}-${++this.sequence}`;
        const selected = this.oneShotOriginal ? 'original' : readStoredLanguage(key, this.defaultLanguage);
        this.oneShotOriginal = false;
        const item = {id, channel_key:key, text, selected_language:selected, recent_messages:recentMessages(), created_at:Date.now()};
        this.pending.set(id, {...item, editor});
        this.queue.push(item);
        this.setStatus(selected === 'original' ? '원문을 전송합니다.' : '메시지를 번역하고 있습니다.');
      },
      prepare(id, replace, continuation = false, finalPart = true, partNumber = 1, totalParts = 1) {
        const item = this.pending.get(id);
        if (!item) return false;
        let editor = item.editor;
        if (continuation) {
          if (!editor?.isConnected || composerText(editor)) {
            const editors = [...document.querySelectorAll(composerSelector)];
            editor = editors.reverse().find(candidate => candidate.isConnected && !composerText(candidate));
          }
          if (!editor?.isConnected || composerText(editor)) return false;
          item.editor = editor;
        } else {
          if (!editor?.isConnected || composerText(editor) !== item.text) return false;
        }
        editor.focus();
        if (replace) {
          const selection = getSelection();
          const range = document.createRange();
          range.selectNodeContents(editor);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        item.keep_after_send = !finalPart;
        this.activeRequest = id;
        this.bypass += 1;
        if (totalParts > 1) this.setStatus(`번역문을 분할 전송하고 있습니다. (${partNumber}/${totalParts})`);
        return true;
      },
      prepareAttachment(id) {
        const item = this.pending.get(id);
        if (!item) return false;
        const editor = item.editor;
        if (!editor?.isConnected || composerText(editor) !== item.text) return false;
        const inputs = [...document.querySelectorAll('input[type="file"]')]
          .filter(input => !input.disabled);
        let input = null;
        for (let parent = editor.parentElement; parent && parent !== document.body && !input; parent = parent.parentElement) {
          input = inputs.find(candidate => parent.contains(candidate)) || null;
        }
        input ||= inputs.find(candidate => candidate.multiple) || inputs[0] || null;
        if (!input) return false;
        editor.focus();
        const selection = getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        selection.removeAllRanges();
        selection.addRange(range);
        item.attachment_input = input;
        return true;
      },
      attachTextFile(id, content, filename) {
        const item = this.pending.get(id);
        const editor = item?.editor;
        const input = item?.attachment_input;
        if (!item || !editor?.isConnected || !input?.isConnected || composerText(editor)) {
          if (item && editor?.isConnected && !composerText(editor)) {
            editor.focus();
            document.execCommand('insertText', false, item.text);
            if (!composerText(editor)) editor.textContent = item.text;
          }
          return false;
        }
        try {
          const transfer = new DataTransfer();
          const file = new File([content], filename, {type:'text/plain;charset=utf-8'});
          transfer.items.add(file);
          input.files = transfer.files;
          input.dispatchEvent(new Event('input', {bubbles:true, composed:true}));
          input.dispatchEvent(new Event('change', {bubbles:true, composed:true}));
          item.attachment_input = null;
          item.keep_after_send = false;
          this.activeRequest = id;
          this.bypass += 1;
          this.setStatus('번역문이 길어 텍스트 파일로 전송합니다.');
          return true;
        } catch (error) {
          editor.focus();
          document.execCommand('insertText', false, item.text);
          if (!composerText(editor)) editor.textContent = item.text;
          item.attachment_input = null;
          return false;
        }
      },
    };
    controller.listener = event => controller.keydown(event);
    document.addEventListener('keydown', controller.listener, true);
    window[GLOBAL] = controller;
  }
  controller.defaultLanguage = defaultLanguage;
  controller.enabled = enabled;
  controller.root = ensureRoot(controller);
  controller.root.hidden = !enabled;
  controller.prunePending();
  controller.updateLabel();
  return enabled ? controller.queue.splice(0, 8).map(item => {
    const {editor, ...plain} = item;
    return plain;
  }) : [];
})()
"####;

pub const OUTGOING_CLEANUP_SCRIPT: &str = r#"
(() => {
  const controller = window.__nudeTranslatorOutgoing;
  if (controller?.listener) document.removeEventListener('keydown', controller.listener, true);
  document.getElementById('nt-outgoing-translation')?.remove();
  document.getElementById('nt-outgoing-translation-style')?.remove();
  delete window.__nudeTranslatorOutgoing;
})()
"#;

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct OutgoingRequest {
    pub id: String,
    pub channel_key: String,
    pub text: String,
    pub selected_language: String,
    #[serde(default)]
    pub recent_messages: Vec<String>,
}

pub fn outgoing_ui_script(enabled: bool, default_language: &str) -> String {
    let default_language = if matches!(
        default_language,
        "auto" | "ko" | "ja" | "en" | "zh" | "zh-Hant"
    ) {
        default_language
    } else {
        "auto"
    };
    OUTGOING_UI_SCRIPT
        .replace("__ENABLED__", if enabled { "true" } else { "false" })
        .replace(
            "__DEFAULT_LANGUAGE__",
            &serde_json::to_string(default_language).expect("static language code"),
        )
}

pub fn parse_outgoing_requests(value: Value) -> Result<Vec<OutgoingRequest>, String> {
    serde_json::from_value(value)
        .map_err(|error| format!("보내는 메시지 번역 요청을 읽지 못했습니다: {error}"))
}

pub fn suggest_recent_language(messages: &[String]) -> Option<Language> {
    let mut counts = HashMap::<Language, usize>::new();
    let mut detected = 0_usize;
    for message in messages.iter().rev().take(24) {
        let text = message.trim();
        if text.is_empty()
            || text.starts_with("http://")
            || text.starts_with("https://")
            || text.contains("```")
        {
            continue;
        }
        let language = detect_explicit_language(text);
        if language == Language::Unknown {
            continue;
        }
        *counts.entry(language).or_default() += 1;
        detected += 1;
    }
    if detected < 2 {
        return None;
    }
    let mut ranked = counts.into_iter().collect::<Vec<_>>();
    ranked.sort_by_key(|entry| std::cmp::Reverse(entry.1));
    let (language, count) = ranked[0];
    if ranked.get(1).is_some_and(|(_, next)| *next == count) || count * 5 < detected * 3 {
        None
    } else {
        Some(language)
    }
}

pub fn apply_outgoing_suggestion_script(
    request_id: &str,
    language: Option<Language>,
) -> Result<String, String> {
    let id = serde_json::to_string(request_id)
        .map_err(|error| format!("전송 요청 식별자를 인코딩하지 못했습니다: {error}"))?;
    let code = language
        .map(|language| json!(language.code()).to_string())
        .unwrap_or_else(|| "null".to_string());
    Ok(format!(
        "window.__nudeTranslatorOutgoing?.suggest({id},{code})"
    ))
}

pub fn apply_outgoing_error_script(request_id: &str, message: &str) -> Result<String, String> {
    let id = serde_json::to_string(request_id)
        .map_err(|error| format!("전송 요청 식별자를 인코딩하지 못했습니다: {error}"))?;
    let message = serde_json::to_string(message)
        .map_err(|error| format!("전송 오류 메시지를 인코딩하지 못했습니다: {error}"))?;
    Ok(format!(
        "window.__nudeTranslatorOutgoing?.fail({id},{message})"
    ))
}

pub fn prepare_outgoing_send_script(
    request_id: &str,
    replace: bool,
    continuation: bool,
    final_part: bool,
    part_number: usize,
    total_parts: usize,
) -> Result<String, String> {
    let id = serde_json::to_string(request_id)
        .map_err(|error| format!("전송 요청 식별자를 인코딩하지 못했습니다: {error}"))?;
    Ok(format!(
        "window.__nudeTranslatorOutgoing?.prepare({id},{replace},{continuation},{final_part},{part_number},{total_parts}) === true"
    ))
}

pub fn prepare_outgoing_attachment_script(request_id: &str) -> Result<String, String> {
    let id = serde_json::to_string(request_id)
        .map_err(|error| format!("전송 요청 식별자를 인코딩하지 못했습니다: {error}"))?;
    Ok(format!(
        "window.__nudeTranslatorOutgoing?.prepareAttachment({id}) === true"
    ))
}

pub fn attach_outgoing_text_file_script(
    request_id: &str,
    content: &str,
    filename: &str,
) -> Result<String, String> {
    let id = serde_json::to_string(request_id)
        .map_err(|error| format!("전송 요청 식별자를 인코딩하지 못했습니다: {error}"))?;
    let content = serde_json::to_string(content)
        .map_err(|error| format!("장문 번역문을 인코딩하지 못했습니다: {error}"))?;
    let filename = serde_json::to_string(filename)
        .map_err(|error| format!("장문 번역 파일 이름을 인코딩하지 못했습니다: {error}"))?;
    Ok(format!(
        "window.__nudeTranslatorOutgoing?.attachTextFile({id},{content},{filename}) === true"
    ))
}

#[cfg(test)]
mod tests {
    use std::sync::{Mutex, MutexGuard};

    use serde_json::json;

    use super::{
        apply_outgoing_suggestion_script, attach_outgoing_text_file_script, outgoing_ui_script,
        parse_outgoing_requests, prepare_outgoing_attachment_script, prepare_outgoing_send_script,
        suggest_recent_language, OUTGOING_CLEANUP_SCRIPT,
    };
    use crate::cdp::{discord_target, CdpClient};
    use crate::language::Language;

    static LIVE_OUTGOING_LOCK: Mutex<()> = Mutex::new(());

    fn lock_live_outgoing() -> MutexGuard<'static, ()> {
        LIVE_OUTGOING_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[test]
    fn recent_message_contents_produce_a_confident_suggestion() {
        let messages = vec![
            "今日はどうでしたか".to_string(),
            "また明日ね".to_string(),
            "これはテストです".to_string(),
            "hello".to_string(),
        ];
        assert_eq!(suggest_recent_language(&messages), Some(Language::Japanese));
    }

    #[test]
    fn mixed_or_sparse_context_requires_manual_selection() {
        assert_eq!(suggest_recent_language(&["hello".into()]), None);
        assert_eq!(
            suggest_recent_language(&["안녕하세요".into(), "hello".into()]),
            None
        );
    }

    #[test]
    fn request_payload_is_parsed_without_dom_objects() {
        let requests = parse_outgoing_requests(json!([{
            "id": "outgoing-1",
            "channel_key": "/channels/1/2",
            "text": "안녕하세요",
            "selected_language": "ja",
            "recent_messages": ["こんにちは"]
        }]))
        .unwrap();
        assert_eq!(requests[0].selected_language, "ja");
    }

    #[test]
    fn suggestion_script_json_encodes_request_ids() {
        let script =
            apply_outgoing_suggestion_script("x');alert(1)//", Some(Language::English)).unwrap();
        assert!(script.contains("\\u0027") || script.contains("x');alert"));
        assert!(script.contains("\"en\""));
    }

    #[test]
    fn continuation_send_script_keeps_request_until_the_final_part() {
        let script = prepare_outgoing_send_script("outgoing-1", true, true, false, 2, 3).unwrap();
        assert!(script.contains("prepare(\"outgoing-1\",true,true,false,2,3)"));
    }

    #[test]
    fn attachment_scripts_json_encode_content_and_filename() {
        let prepare = prepare_outgoing_attachment_script("outgoing-'1").unwrap();
        assert!(prepare.contains("prepareAttachment"));
        let attach = attach_outgoing_text_file_script(
            "outgoing-'1",
            "첫 줄\n</script>\n마지막 줄",
            "번역-'문.txt",
        )
        .unwrap();
        assert!(attach.contains("attachTextFile"));
        assert!(attach.contains("\\n"));
        assert!(attach.contains("</script>"));
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러가 필요합니다"]
    fn live_discord_can_mount_and_remove_the_outgoing_control() {
        let _guard = lock_live_outgoing();
        let target = discord_target(9222).expect("Discord channel target");
        let mut client = CdpClient::new(target.websocket_url);
        client
            .evaluate(
                "if(window.__ntOutgoingSplitCapture)document.removeEventListener('keydown',window.__ntOutgoingSplitCapture,true);document.getElementById('nt-outgoing-split-test')?.remove();delete window.__ntOutgoingSplitCapture;delete window.__ntOutgoingSplitMessages;",
                false,
            )
            .expect("remove stale split test state");
        client
            .evaluate(OUTGOING_CLEANUP_SCRIPT, false)
            .expect("remove controller from previous build");
        let requests = client
            .evaluate(&outgoing_ui_script(true, "auto"), false)
            .expect("outgoing script");
        assert!(requests.is_array());
        let mounted = client
            .evaluate(
                "Boolean(document.getElementById('nt-outgoing-translation'))",
                false,
            )
            .expect("mounted state");
        assert_eq!(mounted.as_bool(), Some(true));
        let japanese_controller = outgoing_ui_script(true, "ja");
        let request_probe = format!(
            "(() => {{ ({japanese_controller}); const label=document.querySelector('#nt-outgoing-translation .nt-outgoing-trigger b')?.textContent; const editor=document.createElement('div'); editor.id='nt-outgoing-live-test'; editor.setAttribute('role','textbox'); editor.setAttribute('contenteditable','true'); editor.textContent='안녕하세요'; document.body.append(editor); editor.dispatchEvent(new KeyboardEvent('keydown',{{key:'Enter',bubbles:true,cancelable:true}})); const requests=({japanese_controller}); return {{label,requests}}; }})()"
        );
        let probe = client
            .evaluate(&request_probe, true)
            .expect("updated language and synthetic composer event");
        assert_eq!(probe["label"].as_str(), Some("日本語"));
        let queued =
            parse_outgoing_requests(probe["requests"].clone()).expect("outgoing request payload");
        assert_eq!(queued.len(), 1);
        assert_eq!(queued[0].text, "안녕하세요");
        assert_eq!(queued[0].selected_language, "ja");
        let prepared = client
            .evaluate(
                &prepare_outgoing_send_script(&queued[0].id, true, false, true, 1, 1)
                    .expect("prepare script"),
                false,
            )
            .expect("prepare translated send");
        assert_eq!(prepared.as_bool(), Some(true));
        client
            .evaluate(
                "window.__ntOutgoingLiveSentText='';window.__ntOutgoingLiveCapture=function(event){if(event.key==='Enter'&&event.target?.id==='nt-outgoing-live-test'){window.__ntOutgoingLiveSentText=event.target.innerText||event.target.textContent||'';document.removeEventListener('keydown',window.__ntOutgoingLiveCapture,true);delete window.__ntOutgoingLiveCapture;}};document.addEventListener('keydown',window.__ntOutgoingLiveCapture,true);",
                false,
            )
            .expect("translated send capture");
        client
            .call("Input.insertText", json!({"text": "こんにちは"}))
            .expect("insert translated text");
        for event_type in ["rawKeyDown", "keyUp"] {
            client
                .call(
                    "Input.dispatchKeyEvent",
                    json!({
                        "type": event_type,
                        "key": "Enter",
                        "code": "Enter",
                        "windowsVirtualKeyCode": 13,
                        "nativeVirtualKeyCode": 13
                    }),
                )
                .expect("dispatch translated send");
        }
        let replaced = client
            .evaluate("window.__ntOutgoingLiveSentText", false)
            .expect("translated text at send time");
        assert_eq!(replaced.as_str(), Some("こんにちは"));
        client
            .evaluate(
                "document.getElementById('nt-outgoing-live-test')?.remove()",
                false,
            )
            .expect("synthetic composer cleanup");
        client
            .evaluate(OUTGOING_CLEANUP_SCRIPT, false)
            .expect("cleanup script");
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러가 필요합니다"]
    fn live_discord_controller_keeps_a_request_across_split_messages() {
        let _guard = lock_live_outgoing();
        let target = discord_target(9222).expect("Discord channel target");
        let mut client = CdpClient::new(target.websocket_url);
        client
            .evaluate(
                "if(window.__ntOutgoingSplitCapture)document.removeEventListener('keydown',window.__ntOutgoingSplitCapture,true);document.getElementById('nt-outgoing-split-test')?.remove();delete window.__ntOutgoingSplitCapture;delete window.__ntOutgoingSplitMessages;",
                false,
            )
            .expect("remove stale split test state");
        client
            .evaluate(OUTGOING_CLEANUP_SCRIPT, false)
            .expect("remove previous controller");
        let controller = outgoing_ui_script(true, "ja");
        let queued = client
            .evaluate(
                &format!(
                    "(() => {{ ({controller}); const editor=document.createElement('div'); editor.id='nt-outgoing-split-test'; editor.setAttribute('role','textbox'); editor.setAttribute('contenteditable','true'); editor.textContent='긴 원문'; document.body.append(editor); editor.dispatchEvent(new KeyboardEvent('keydown',{{key:'Enter',bubbles:true,cancelable:true}})); return ({controller}); }})()"
                ),
                true,
            )
            .expect("queue synthetic outgoing request");
        let requests = parse_outgoing_requests(queued).expect("outgoing request payload");
        assert_eq!(requests.len(), 1);
        let request_id = &requests[0].id;
        client
            .evaluate(
                "window.__ntOutgoingSplitMessages=[];window.__ntOutgoingSplitCapture=function(event){if(event.key==='Enter'&&event.target?.id==='nt-outgoing-split-test'){window.__ntOutgoingSplitMessages.push(event.target.innerText||event.target.textContent||'');event.target.textContent='';}};document.addEventListener('keydown',window.__ntOutgoingSplitCapture,true);",
                false,
            )
            .expect("install split message capture");

        for (index, text) in ["첫 번째 번역문", "두 번째 번역문"].into_iter().enumerate()
        {
            let prepared = client
                .evaluate(
                    &prepare_outgoing_send_script(
                        request_id,
                        true,
                        index > 0,
                        index == 1,
                        index + 1,
                        2,
                    )
                    .expect("prepare split part"),
                    false,
                )
                .expect("prepare split send");
            assert_eq!(
                prepared.as_bool(),
                Some(true),
                "split part {} was not prepared",
                index + 1
            );
            client
                .call("Input.insertText", json!({"text": text}))
                .expect("insert split text");
            for event_type in ["rawKeyDown", "keyUp"] {
                client
                    .call(
                        "Input.dispatchKeyEvent",
                        json!({
                            "type": event_type,
                            "key": "Enter",
                            "code": "Enter",
                            "windowsVirtualKeyCode": 13,
                            "nativeVirtualKeyCode": 13
                        }),
                    )
                    .expect("dispatch split send");
            }
        }

        let result = client
            .evaluate(
                "({messages:window.__ntOutgoingSplitMessages,pending:window.__nudeTranslatorOutgoing?.pending.size})",
                true,
            )
            .expect("read split send result");
        assert_eq!(
            result["messages"],
            json!(["첫 번째 번역문", "두 번째 번역문"])
        );
        assert_eq!(result["pending"].as_u64(), Some(0));
        client
            .evaluate(
                "document.removeEventListener('keydown',window.__ntOutgoingSplitCapture,true);document.getElementById('nt-outgoing-split-test')?.remove();delete window.__ntOutgoingSplitCapture;delete window.__ntOutgoingSplitMessages;",
                false,
            )
            .expect("remove split capture");
        client
            .evaluate(OUTGOING_CLEANUP_SCRIPT, false)
            .expect("cleanup controller");
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러가 필요합니다"]
    fn live_discord_controller_attaches_one_text_file_for_a_long_message() {
        let _guard = lock_live_outgoing();
        let target = discord_target(9222).expect("Discord channel target");
        let mut client = CdpClient::new(target.websocket_url);
        client
            .evaluate(OUTGOING_CLEANUP_SCRIPT, false)
            .expect("remove previous controller");
        let controller = outgoing_ui_script(true, "ja");
        let queued = client
            .evaluate(
                &format!(
                    "(() => {{ ({controller}); const wrapper=document.createElement('div'); wrapper.id='nt-outgoing-attachment-test'; const input=document.createElement('input'); input.type='file'; const editor=document.createElement('div'); editor.id='nt-outgoing-attachment-editor'; editor.setAttribute('role','textbox'); editor.setAttribute('contenteditable','true'); editor.textContent='긴 원문'; input.addEventListener('change',event=>{{const file=event.currentTarget.files?.[0];window.__ntOutgoingAttachmentProbe=file?{{name:file.name,content:file.text(),editor:editor.textContent||''}}:null;}},{{capture:true}}); wrapper.append(input,editor); document.body.append(wrapper); editor.dispatchEvent(new KeyboardEvent('keydown',{{key:'Enter',bubbles:true,cancelable:true}})); return ({controller}); }})()"
                ),
                true,
            )
            .expect("queue synthetic attachment request");
        let requests = parse_outgoing_requests(queued).expect("outgoing request payload");
        assert_eq!(requests.len(), 1);
        let request_id = &requests[0].id;
        let prepared = client
            .evaluate(
                &prepare_outgoing_attachment_script(request_id).expect("prepare attachment script"),
                false,
            )
            .expect("prepare attachment");
        assert_eq!(prepared.as_bool(), Some(true));
        for event_type in ["rawKeyDown", "keyUp"] {
            client
                .call(
                    "Input.dispatchKeyEvent",
                    json!({
                        "type": event_type,
                        "key": "Backspace",
                        "code": "Backspace",
                        "windowsVirtualKeyCode": 8,
                        "nativeVirtualKeyCode": 8
                    }),
                )
                .expect("clear original composer text");
        }
        let content = "번역문 첫 줄\n번역문 마지막 줄";
        let attached = client
            .evaluate(
                &attach_outgoing_text_file_script(request_id, content, "NudeTranslator-test.txt")
                    .expect("attach script"),
                false,
            )
            .expect("attach translated text file");
        assert_eq!(attached.as_bool(), Some(true));
        let result = client
            .evaluate(
                "(async()=>({name:window.__ntOutgoingAttachmentProbe?.name||'',content:await window.__ntOutgoingAttachmentProbe?.content,editor:window.__ntOutgoingAttachmentProbe?.editor||'',pending:window.__nudeTranslatorOutgoing?.pending.size}))()",
                true,
            )
            .expect("read attached file");
        assert_eq!(result["name"].as_str(), Some("NudeTranslator-test.txt"));
        assert_eq!(result["content"].as_str(), Some(content));
        assert_eq!(result["editor"].as_str(), Some(""));
        assert_eq!(result["pending"].as_u64(), Some(1));
        client
            .evaluate(
                "document.getElementById('nt-outgoing-attachment-test')?.remove();delete window.__ntOutgoingAttachmentProbe",
                false,
            )
            .expect("remove attachment test elements");
        client
            .evaluate(OUTGOING_CLEANUP_SCRIPT, false)
            .expect("cleanup controller");
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러가 필요합니다"]
    fn live_discord_exposes_a_composer_file_input() {
        let _guard = lock_live_outgoing();
        let target = discord_target(9222).expect("Discord channel target");
        let mut client = CdpClient::new(target.websocket_url);
        let inputs = client
            .evaluate(
                "[...document.querySelectorAll('input[type=file]')].filter(input=>!input.disabled).map(input=>({multiple:input.multiple,accept:input.accept}))",
                false,
            )
            .expect("inspect Discord file inputs");
        let inputs = inputs.as_array().expect("file input array");
        assert!(
            !inputs.is_empty(),
            "Discord composer does not expose a usable file input"
        );
    }
}
