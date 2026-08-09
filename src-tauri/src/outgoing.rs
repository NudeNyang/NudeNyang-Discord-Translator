use std::collections::HashMap;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::cache::OutgoingOriginalRecord;
use crate::language::{detect_explicit_language, Language};

const OUTGOING_UI_SCRIPT: &str = r####"
(() => {
  const enabled = __ENABLED__;
  const defaultLanguage = __DEFAULT_LANGUAGE__;
  const requestedUiLanguage = __UI_LANGUAGE__;
  const systemUiLanguage = (navigator.language || 'en').toLowerCase();
  const uiLanguage = requestedUiLanguage === 'auto'
    ? (systemUiLanguage.startsWith('ko') ? 'ko' : systemUiLanguage.startsWith('ja') ? 'ja' : systemUiLanguage.startsWith('zh') ? 'zh' : 'en')
    : (['ko','en','ja','zh'].includes(requestedUiLanguage) ? requestedUiLanguage : 'en');
  const GLOBAL = '__nudeTranslatorOutgoing';
  const ROOT_ID = 'nt-outgoing-translation';
  const CONTROLLER_VERSION = 10;
  const composerSelector = '[role="textbox"][contenteditable="true"], [contenteditable="true"][data-slate-editor="true"]';
  const mentionSelector = '[data-slate-inline="true"][data-slate-void="true"][contenteditable="false"]';
  const copies = {
    ko: {
      auto:'자동 감지', outgoingLanguage:'전송 언어', selectLanguage:'전송 언어 선택', originalOnce:'이번 메시지만 원문으로 전송',
      nextOriginal:'다음 메시지는 번역하지 않고 전송합니다.', selectLanguageFormal:'전송 언어를 선택하십시오.', sendingOriginal:'원문을 전송합니다.',
      translating:'메시지를 번역하고 있습니다.', detectionFailed:'대화 언어를 판단하지 못했습니다. 전송 언어를 선택하십시오.',
      recentLanguage:'최근 대화 언어는 다음과 같이 판단됩니다: {language}', useChannel:'{language} · 이 채널에 사용', chooseOther:'다른 언어 선택',
      sendOriginal:'원문 전송', confirmLanguage:'전송 언어를 확인한 후 메시지를 전송합니다.', translationFailed:'메시지를 번역하지 못했습니다. 번역하지 않고 원문을 유지합니다.',
      pending:'이전 메시지를 처리하고 있습니다. 잠시 후 다시 시도하십시오.', sendingParts:'번역문을 분할 전송하고 있습니다. ({part}/{total})',
      longAttachment:'번역문이 길어 텍스트 파일로 전송합니다.'
    },
    en: {
      auto:'Auto detect', outgoingLanguage:'Outgoing language', selectLanguage:'Select outgoing language', originalOnce:'Send only this message without translation',
      nextOriginal:'The next message will be sent without translation.', selectLanguageFormal:'Select an outgoing language.', sendingOriginal:'Sending the original message.',
      translating:'Translating the message.', detectionFailed:'The conversation language could not be determined. Select an outgoing language.',
      recentLanguage:'The recent conversation appears to be in {language}.', useChannel:'{language} · Use for this channel', chooseOther:'Select another language',
      sendOriginal:'Send original', confirmLanguage:'Confirm the outgoing language to send the message.', translationFailed:'The message could not be translated. The original message has been preserved.',
      pending:'The previous message is still being processed. Try again shortly.', sendingParts:'Sending the translated message in parts. ({part}/{total})',
      longAttachment:'The translation is long and will be sent as a text file.'
    },
    ja: {
      auto:'自動検出', outgoingLanguage:'送信言語', selectLanguage:'送信言語を選択', originalOnce:'このメッセージのみ原文で送信',
      nextOriginal:'次のメッセージは翻訳せずに送信します。', selectLanguageFormal:'送信言語を選択してください。', sendingOriginal:'原文を送信します。',
      translating:'メッセージを翻訳しています。', detectionFailed:'会話の言語を判定できませんでした。送信言語を選択してください。',
      recentLanguage:'最近の会話は{language}と判定されました。', useChannel:'{language} · このチャンネルで使用', chooseOther:'別の言語を選択',
      sendOriginal:'原文を送信', confirmLanguage:'送信言語を確認してからメッセージを送信します。', translationFailed:'メッセージを翻訳できませんでした。原文は変更されていません。',
      pending:'前のメッセージを処理しています。しばらくしてからもう一度お試しください。', sendingParts:'翻訳文を分割して送信しています。({part}/{total})',
      longAttachment:'翻訳文が長いため、テキストファイルとして送信します。'
    },
    zh: {
      auto:'自动检测', outgoingLanguage:'发送语言', selectLanguage:'选择发送语言', originalOnce:'仅本条消息发送原文',
      nextOriginal:'下一条消息将不翻译并直接发送。', selectLanguageFormal:'请选择发送语言。', sendingOriginal:'正在发送原文。',
      translating:'正在翻译消息。', detectionFailed:'无法判断对话语言。请选择发送语言。',
      recentLanguage:'最近的对话被判断为{language}。', useChannel:'{language} · 用于此频道', chooseOther:'选择其他语言',
      sendOriginal:'发送原文', confirmLanguage:'请确认发送语言后发送消息。', translationFailed:'无法翻译消息。原文已保持不变。',
      pending:'上一条消息仍在处理中。请稍后重试。', sendingParts:'正在分段发送译文。({part}/{total})',
      longAttachment:'译文较长，将以文本文件形式发送。'
    }
  };
  const languageLabelsByUi = {
    ko:{auto:'자동 감지',ko:'한국어',ja:'일본어',en:'영어',zh:'중국어 간체','zh-Hant':'중국어 번체'},
    en:{auto:'Auto detect',ko:'Korean',ja:'Japanese',en:'English',zh:'Simplified Chinese','zh-Hant':'Traditional Chinese'},
    ja:{auto:'自動検出',ko:'韓国語',ja:'日本語',en:'英語',zh:'簡体字中国語','zh-Hant':'繁体字中国語'},
    zh:{auto:'自动检测',ko:'韩语',ja:'日语',en:'英语',zh:'简体中文','zh-Hant':'繁体中文'}
  };
  const copy = key => copies[uiLanguage]?.[key] || copies.en[key] || key;
  const formatCopy = (key, values) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), copy(key));
  const languageLabels = languageLabelsByUi[uiLanguage] || languageLabelsByUi.en;
  const storageKey = key => `nude-translator:outgoing-language:${key}`;
  const confirmedStorageKey = key => `nude-translator:outgoing-confirmed-language:${key}`;

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
  function readConfirmedLanguage(key) {
    try { return localStorage.getItem(confirmedStorageKey(key)) || ''; } catch { return ''; }
  }
  function writeConfirmedLanguage(key, language) {
    try {
      if (language && language !== 'auto') localStorage.setItem(confirmedStorageKey(key), language);
    } catch {}
  }
  function selectedLanguageForChannel(key, fallbackLanguage) {
    const selected = readStoredLanguage(key, fallbackLanguage);
    return selected === 'auto' ? (readConfirmedLanguage(key) || 'auto') : selected;
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
  function mentionText(mention) {
    return [...mention.querySelectorAll('[role="button"]')]
      .map(node => (node.textContent || '').trim())
      .find(text => text.startsWith('@')) || '';
  }
  function visibleSlateNodeText(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return '';
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.matches(mentionSelector)) return mentionText(node);
      if (node.hasAttribute('data-slate-zero-width')) return '';
      if (node.hasAttribute('data-slate-string')) return node.textContent || '';
      if (node.tagName === 'BR') return '\n';
    }
    return [...node.childNodes].map(visibleSlateNodeText).join('');
  }
  function visibleComposerText(root) {
    const blocks = [...root.childNodes]
      .filter(node => node.nodeType === Node.ELEMENT_NODE && node.getAttribute('data-slate-node') === 'element');
    const text = blocks.length
      ? blocks.map(visibleSlateNodeText).join('\n')
      : visibleSlateNodeText(root);
    return text.replace(/\u00a0/g, ' ').replace(/\uFEFF/g, '');
  }
  function composerText(editor) {
    return visibleComposerText(editor).trim();
  }
  function translatedTailRange(editor, lastMention) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!(lastMention.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      const parent = node.parentElement;
      if (parent?.closest(mentionSelector) || parent?.closest('[data-slate-zero-width]')) continue;
      const index = (node.nodeValue || '').search(/[^\s\uFEFF]/u);
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(editor, editor.childNodes.length);
      return range;
    }
    return null;
  }
  function prefixMentionPlan(editor) {
    const mentions = [...editor.querySelectorAll(mentionSelector)];
    if (!mentions.length) return null;
    const lastMention = mentions.at(-1);
    const prefixRange = document.createRange();
    prefixRange.setStart(editor, 0);
    prefixRange.setEndAfter(lastMention);
    const prefix = prefixRange.cloneContents();
    prefix.querySelectorAll(mentionSelector).forEach(node => node.remove());
    if (visibleComposerText(prefix).trim()) return {supported:false};
    const range = translatedTailRange(editor, lastMention);
    return {
      supported: true,
      text: range ? visibleComposerText(range.cloneContents()).trim() : '',
      range,
    };
  }
  function selectionRangeForItem(editor, item, continuation = false) {
    if (item.preserve_prefix_mentions && !continuation) {
      const plan = prefixMentionPlan(editor);
      return plan?.supported ? plan.range : null;
    }
    const range = document.createRange();
    range.selectNodeContents(editor);
    return range;
  }
  function sourceTextForItem(editor, item) {
    if (!item.preserve_prefix_mentions) return composerText(editor);
    const plan = prefixMentionPlan(editor);
    return plan?.supported ? plan.text : composerText(editor);
  }
  function hasActiveAutocomplete(editor) {
    if (editor.getAttribute('aria-expanded') !== 'true') return false;
    const active = document.getElementById(editor.getAttribute('aria-activedescendant') || '');
    if (active?.getAttribute('role') === 'option') return true;
    const listbox = document.getElementById(editor.getAttribute('aria-controls') || '');
    return listbox?.getAttribute('role') === 'listbox';
  }
  function discordMessageId(root) {
    const prefix = 'message-content-';
    return root?.id?.startsWith(prefix) ? root.id.slice(prefix.length) : '';
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
    root.innerHTML = `<button type="button" class="nt-outgoing-trigger" aria-expanded="false"><span>${copy('outgoingLanguage')}</span><b>${copy('auto')}</b><i>⌄</i></button><div class="nt-outgoing-menu" hidden></div><p class="nt-outgoing-status" hidden></p>`;
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
  if (controller && (controller.version !== CONTROLLER_VERSION || controller.uiLanguage !== uiLanguage)) {
    if (controller.listener) document.removeEventListener('keydown', controller.listener, true);
    clearTimeout(controller.statusTimer);
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(`${ROOT_ID}-style`)?.remove();
    window.__nudeTranslatorOutgoingOriginalsReady = '';
    delete window[GLOBAL];
    controller = null;
  }
  if (!controller) {
    controller = {
      version: CONTROLLER_VERSION,
      uiLanguage,
      enabled: false,
      queue: [],
      pending: new Map(),
      sent: [],
      bindings: [],
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
      showLanguageMenu(heading = copy('selectLanguage'), requestId = '') {
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
        menu.append(divider, makeButton(copy('originalOnce'), 'original-once'));
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
            this.setStatus(copy('nextOriginal'));
          }
        } else if (button.dataset.action === 'suggest-channel') {
          const channelKey = this.pending.get(button.dataset.value)?.channel_key || key;
          writeStoredLanguage(channelKey, button.dataset.language);
          writeConfirmedLanguage(channelKey, button.dataset.language);
          this.retry(button.dataset.value, button.dataset.language);
          this.updateLabel();
        } else if (button.dataset.action === 'suggest-choose') {
          this.showLanguageMenu(copy('selectLanguageFormal'), button.dataset.value);
          return;
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
        this.setStatus(language === 'original' ? copy('sendingOriginal') : copy('translating'));
      },
      suggest(id, language) {
        const item = this.pending.get(id);
        if (!item) return;
        const menu = this.root.querySelector('.nt-outgoing-menu');
        menu.replaceChildren();
        if (!language || !languageLabels[language]) {
          this.showLanguageMenu(copy('detectionFailed'), id);
          return;
        }
        const heading = document.createElement('div');
        heading.className = 'nt-heading';
        heading.textContent = formatCopy('recentLanguage', {language:languageLabels[language]});
        const channel = makeButton(formatCopy('useChannel', {language:languageLabels[language]}), 'suggest-channel', id);
        channel.dataset.language = language;
        const choose = makeButton(copy('chooseOther'), 'suggest-choose', id);
        menu.append(heading, channel, choose, makeButton(copy('sendOriginal'), 'suggest-original', id));
        menu.hidden = false;
        this.root.querySelector('.nt-outgoing-trigger').setAttribute('aria-expanded', 'true');
        this.setStatus(copy('confirmLanguage'));
      },
      fail(id, message) {
        this.pending.delete(id);
        if (this.activeRequest === id) {
          this.activeRequest = '';
          this.bypass = 0;
        }
        if (message) console.warn('[NudeNyang Translator] outgoing translation failed:', message);
        this.setStatus(copy('translationFailed'), true);
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
      reconcileSent() {
        const now = Date.now();
        const roots = [...document.querySelectorAll('[id^="message-content-"]')]
          .filter(root => !root.closest('[id^="message-reply-context-"]'));
        const remaining = [];
        for (const item of this.sent) {
          if (now - item.created_at >= 60000) continue;
          if (item.channel_key !== currentChannelKey()) {
            remaining.push(item);
            continue;
          }
          const root = roots.slice().reverse().find(candidate => {
            const messageId = discordMessageId(candidate);
            if (!messageId || item.existing_message_ids.includes(messageId)) return false;
            return originalText(candidate).trim() === item.sent_text;
          });
          if (!root) {
            remaining.push(item);
            continue;
          }
          const binding = {
            message_id: discordMessageId(root),
            channel_key: item.channel_key,
            original_text: item.original_text,
            sent_text: item.sent_text,
            part_number: item.part_number,
            total_parts: item.total_parts,
            created_at: Date.now() / 1000,
          };
          this.bindings.push(binding);
          window.__nudeTranslatorRegisterOutgoingOriginal?.(binding);
        }
        this.sent = remaining;
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
          const sentText = composerText(editor);
          if (activeItem && sentText) {
            this.sent.push({
              channel_key: activeItem.channel_key,
              original_text: activeItem.original_text || activeItem.text,
              sent_text: sentText,
              part_number: activeItem.part_number || 1,
              total_parts: activeItem.total_parts || 1,
              existing_message_ids: [...document.querySelectorAll('[id^="message-content-"]')]
                .map(discordMessageId)
                .filter(Boolean),
              created_at: Date.now(),
            });
          }
          if (activeItem) activeItem.keep_after_send = false;
          if (activeId && !keepAfterSend) this.pending.delete(activeId);
          this.activeRequest = '';
          if (!keepAfterSend) this.setStatus('');
          return;
        }
        if (hasActiveAutocomplete(editor)) return;
        const mentionPlan = prefixMentionPlan(editor);
        if (mentionPlan && !mentionPlan.supported) return;
        const text = mentionPlan ? mentionPlan.text : composerText(editor);
        if (!text || text.startsWith('/') || text.includes('```')) return;
        const originalText = composerText(editor);
        const key = currentChannelKey();
        if (!key) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const previous = [...this.pending.entries()].find(([, item]) => item.editor === editor);
        if (previous) {
          const [previousId, previousItem] = previous;
          const expired = Date.now() - previousItem.created_at >= 30000;
          const changed = (previousItem.original_text || previousItem.text) !== originalText;
          if (!expired && !changed) {
            this.setStatus(copy('pending'));
            return;
          }
          this.pending.delete(previousId);
          if (this.activeRequest === previousId) {
            this.activeRequest = '';
            this.bypass = 0;
          }
        }
        const id = `outgoing-${Date.now()}-${++this.sequence}`;
        const selected = this.oneShotOriginal ? 'original' : selectedLanguageForChannel(key, this.defaultLanguage);
        this.oneShotOriginal = false;
        const item = {
          id,
          channel_key:key,
          text,
          original_text:originalText,
          preserve_prefix_mentions:Boolean(mentionPlan),
          selected_language:selected,
          recent_messages:recentMessages(),
          created_at:Date.now(),
        };
        this.pending.set(id, {...item, editor});
        this.queue.push(item);
        this.setStatus(selected === 'original' ? copy('sendingOriginal') : copy('translating'));
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
          if (!editor?.isConnected || composerText(editor) !== (item.original_text || item.text)) return false;
        }
        editor.focus();
        if (replace) {
          const range = selectionRangeForItem(editor, item, continuation);
          if (!range) return false;
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
        item.keep_after_send = !finalPart;
        item.part_number = partNumber;
        item.total_parts = totalParts;
        this.activeRequest = id;
        this.bypass += 1;
        if (totalParts > 1) this.setStatus(formatCopy('sendingParts', {part:partNumber,total:totalParts}));
        return true;
      },
      prepareAttachment(id) {
        const item = this.pending.get(id);
        if (!item) return false;
        const editor = item.editor;
        if (!editor?.isConnected || composerText(editor) !== (item.original_text || item.text)) return false;
        const inputs = [...document.querySelectorAll('input[type="file"]')]
          .filter(input => !input.disabled);
        let input = null;
        for (let parent = editor.parentElement; parent && parent !== document.body && !input; parent = parent.parentElement) {
          input = inputs.find(candidate => parent.contains(candidate)) || null;
        }
        input ||= inputs.find(candidate => candidate.multiple) || inputs[0] || null;
        if (!input) return false;
        editor.focus();
        const range = selectionRangeForItem(editor, item, false);
        if (!range) return false;
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        item.attachment_input = input;
        return true;
      },
      attachTextFile(id, content, filename) {
        const item = this.pending.get(id);
        const editor = item?.editor;
        const input = item?.attachment_input;
        if (!item || !editor?.isConnected || !input?.isConnected || sourceTextForItem(editor, item)) {
          if (item && editor?.isConnected && !sourceTextForItem(editor, item)) {
            editor.focus();
            document.execCommand('insertText', false, item.text);
            if (!item.preserve_prefix_mentions && !composerText(editor)) editor.textContent = item.text;
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
          this.setStatus(copy('longAttachment'));
          return true;
        } catch (error) {
          editor.focus();
          document.execCommand('insertText', false, item.text);
          if (!item.preserve_prefix_mentions && !composerText(editor)) editor.textContent = item.text;
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
  controller.reconcileSent();
  window.__nudeTranslatorApplyOutgoingOriginals?.();
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

pub const OUTGOING_BINDINGS_SCRIPT: &str = r#"
(() => {
  const controller = window.__nudeTranslatorOutgoing;
  return controller?.bindings?.splice(0, 32) || [];
})()
"#;

const OUTGOING_ORIGINALS_UI_SCRIPT: &str = r####"
(() => {
  const channelKey = __CHANNEL_KEY__;
  const records = __RECORDS__;
  const requestedUiLanguage = __UI_LANGUAGE__;
  const systemUiLanguage = (navigator.language || 'en').toLowerCase();
  const uiLanguage = requestedUiLanguage === 'auto'
    ? (systemUiLanguage.startsWith('ko') ? 'ko' : systemUiLanguage.startsWith('ja') ? 'ja' : systemUiLanguage.startsWith('zh') ? 'zh' : 'en')
    : (['ko','en','ja','zh'].includes(requestedUiLanguage) ? requestedUiLanguage : 'en');
  const copies = {
    ko:{inputOriginal:'입력 원문',showOriginal:'원문 보기',showSent:'전송문 보기'},
    en:{inputOriginal:'Original input',showOriginal:'Show original',showSent:'Show sent message'},
    ja:{inputOriginal:'入力した原文',showOriginal:'原文を表示',showSent:'送信文を表示'},
    zh:{inputOriginal:'输入的原文',showOriginal:'查看原文',showSent:'查看已发送内容'}
  };
  const copy = key => copies[uiLanguage]?.[key] || copies.en[key] || key;
  const GLOBAL = '__nudeTranslatorOutgoingOriginalDisplay';
  const STYLE_ID = 'nt-outgoing-original-style';
  const VERSION = 2;
  const messageId = root => root?.id?.startsWith('message-content-')
    ? root.id.slice('message-content-'.length) : '';
  const recordKey = record => `${record.channel_key}|${record.message_id}`;
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .nt-outgoing-original-view{display:flex;align-items:flex-start;gap:8px;max-width:100%;white-space:pre-wrap;color:var(--text-normal,#dbdee1)}
      .nt-outgoing-original-copy{min-width:0;overflow-wrap:anywhere}
      .nt-outgoing-original-label{margin-right:6px;color:var(--text-muted,#949ba4);font-size:11px;font-weight:650}
      .nt-outgoing-original-toggle{flex:none;margin-top:1px;padding:1px 5px;border:0;border-radius:4px;background:transparent;color:var(--text-link,#00a8fc);font:inherit;font-size:11px;cursor:pointer}
      .nt-outgoing-original-toggle:hover{background:var(--background-modifier-hover,#ffffff0f)}
    `;
    document.head.append(style);
  }
  function restoreSentText(root, record) {
    const originals = window.__nudeTranslatorOriginals;
    if (originals instanceof Map) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!originals.has(node)) continue;
        node.nodeValue = originals.get(node);
        originals.delete(node);
      }
    }
    const current = (root.innerText || root.textContent || '').replace(/\u00a0/g, ' ').trim();
    if (current !== record.sent_text) root.textContent = record.sent_text;
  }
  function ensureView(root, record) {
    let view = root.nextElementSibling;
    if (view?.getAttribute('data-nt-outgoing-original-view') !== record.message_id) {
      view = document.createElement('div');
      view.className = 'nt-outgoing-original-view';
      view.setAttribute('data-nt-outgoing-original-view', record.message_id);
      view.innerHTML = '<div class="nt-outgoing-original-copy"><span class="nt-outgoing-original-label"></span><span class="nt-outgoing-original-text"></span></div><button type="button" class="nt-outgoing-original-toggle"></button>';
      root.insertAdjacentElement('afterend', view);
    }
    view.querySelector('.nt-outgoing-original-label').textContent = copy('inputOriginal');
    view.querySelector('.nt-outgoing-original-text').textContent = record.original_text;
    const button = view.querySelector('.nt-outgoing-original-toggle');
    const originalText = view.querySelector('.nt-outgoing-original-copy');
    const showSent = view.dataset.mode === 'sent' || record.part_number > 1;
    root.style.display = showSent ? '' : 'none';
    originalText.hidden = showSent;
    button.textContent = showSent ? copy('showOriginal') : copy('showSent');
    if (button.dataset.bound !== 'true') {
      button.dataset.bound = 'true';
      button.addEventListener('click', () => {
        view.dataset.mode = view.dataset.mode === 'sent' ? 'original' : 'sent';
        const sent = view.dataset.mode === 'sent';
        root.style.display = sent ? '' : 'none';
        originalText.hidden = sent;
        button.textContent = sent ? copy('showOriginal') : copy('showSent');
      });
    }
  }

  let manager = window[GLOBAL];
  if (!manager || manager.version !== VERSION || manager.uiLanguage !== uiLanguage) {
    document.querySelectorAll('.nt-outgoing-original-view').forEach(view => view.remove());
    manager = {
      version: VERSION,
      uiLanguage,
      records: new Map(),
      register(record) {
        if (!record?.message_id || !record?.channel_key) return;
        this.records.set(recordKey(record), record);
        this.apply();
      },
      apply() {
        ensureStyle();
        const currentChannel = location.pathname.startsWith('/channels/') ? location.pathname : '';
        for (const root of document.querySelectorAll('[id^="message-content-"]')) {
          if (root.closest('[id^="message-reply-context-"]')) continue;
          const record = this.records.get(`${currentChannel}|${messageId(root)}`);
          if (!record) continue;
          root.setAttribute('data-nt-outgoing-original', 'true');
          restoreSentText(root, record);
          ensureView(root, record);
        }
      },
    };
    window[GLOBAL] = manager;
  }
  manager.records.clear();
  for (const record of records) manager.records.set(recordKey(record), record);
  window.__nudeTranslatorRegisterOutgoingOriginal = record => manager.register(record);
  window.__nudeTranslatorApplyOutgoingOriginals = () => manager.apply();
  window.__nudeTranslatorOutgoingOriginalsReady = `${channelKey}|${requestedUiLanguage}`;
  manager.apply();
  return manager.records.size;
})()
"####;

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct OutgoingRequest {
    pub id: String,
    pub channel_key: String,
    pub text: String,
    pub selected_language: String,
    #[serde(default)]
    pub recent_messages: Vec<String>,
}

pub fn outgoing_ui_script(enabled: bool, default_language: &str, ui_language: &str) -> String {
    let default_language = if matches!(
        default_language,
        "auto" | "ko" | "ja" | "en" | "zh" | "zh-Hant"
    ) {
        default_language
    } else {
        "auto"
    };
    let ui_language = if matches!(ui_language, "auto" | "ko" | "en" | "ja" | "zh") {
        ui_language
    } else {
        "en"
    };
    OUTGOING_UI_SCRIPT
        .replace("__ENABLED__", if enabled { "true" } else { "false" })
        .replace(
            "__DEFAULT_LANGUAGE__",
            &serde_json::to_string(default_language).expect("static language code"),
        )
        .replace(
            "__UI_LANGUAGE__",
            &serde_json::to_string(ui_language).expect("static interface language code"),
        )
}

pub fn parse_outgoing_requests(value: Value) -> Result<Vec<OutgoingRequest>, String> {
    serde_json::from_value(value)
        .map_err(|error| format!("보내는 메시지 번역 요청을 읽지 못했습니다: {error}"))
}

pub fn parse_outgoing_bindings(value: Value) -> Result<Vec<OutgoingOriginalRecord>, String> {
    serde_json::from_value(value)
        .map_err(|error| format!("보낸 메시지 원문 연결 정보를 읽지 못했습니다: {error}"))
}

pub fn outgoing_originals_ui_script(
    channel_key: &str,
    records: &[OutgoingOriginalRecord],
    ui_language: &str,
) -> Result<String, String> {
    let channel_key = serde_json::to_string(channel_key)
        .map_err(|error| format!("Discord 채널 식별자를 인코딩하지 못했습니다: {error}"))?;
    let records = serde_json::to_string(records)
        .map_err(|error| format!("보낸 메시지 원문 목록을 인코딩하지 못했습니다: {error}"))?;
    let ui_language = if matches!(ui_language, "auto" | "ko" | "en" | "ja" | "zh") {
        ui_language
    } else {
        "en"
    };
    Ok(OUTGOING_ORIGINALS_UI_SCRIPT
        .replace("__CHANNEL_KEY__", &channel_key)
        .replace("__RECORDS__", &records)
        .replace(
            "__UI_LANGUAGE__",
            &serde_json::to_string(ui_language).expect("static interface language code"),
        ))
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
        apply_outgoing_suggestion_script, attach_outgoing_text_file_script,
        outgoing_originals_ui_script, outgoing_ui_script, parse_outgoing_bindings,
        parse_outgoing_requests, prepare_outgoing_attachment_script, prepare_outgoing_send_script,
        suggest_recent_language, OUTGOING_BINDINGS_SCRIPT, OUTGOING_CLEANUP_SCRIPT,
    };
    use crate::cache::OutgoingOriginalRecord;
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
    fn injected_outgoing_controls_receive_the_selected_interface_language() {
        let script = outgoing_ui_script(true, "auto", "ja");
        assert!(script.contains("const requestedUiLanguage = \"ja\""));
        assert!(script.contains("送信言語"));
        assert!(!script.contains("__UI_LANGUAGE__"));

        let originals = outgoing_originals_ui_script("/channels/1/2", &[], "en").unwrap();
        assert!(originals.contains("const requestedUiLanguage = \"en\""));
        assert!(originals.contains("Show original"));
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
    fn outgoing_original_bindings_are_parsed_and_rendered_safely() {
        let records = parse_outgoing_bindings(json!([{
            "message_id": "123",
            "channel_key": "/channels/1/2",
            "original_text": "오늘은 `조금` 늦어 </script>",
            "sent_text": "I'll be a little late",
            "part_number": 1,
            "total_parts": 1,
            "created_at": 42.0
        }]))
        .unwrap();
        let script = outgoing_originals_ui_script("/channels/1/2", &records, "ko").unwrap();

        assert_eq!(
            records,
            vec![OutgoingOriginalRecord {
                message_id: "123".to_string(),
                channel_key: "/channels/1/2".to_string(),
                original_text: "오늘은 `조금` 늦어 </script>".to_string(),
                sent_text: "I'll be a little late".to_string(),
                part_number: 1,
                total_parts: 1,
                created_at: 42.0,
            }]
        );
        assert!(script.contains("전송문 보기"));
        assert!(script.contains("원문 보기"));
        assert!(script.contains("data-nt-outgoing-original"));
        assert!(OUTGOING_BINDINGS_SCRIPT.contains("bindings"));
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
            .evaluate(&outgoing_ui_script(true, "auto", "ko"), false)
            .expect("outgoing script");
        assert!(requests.is_array());
        let mounted = client
            .evaluate(
                "Boolean(document.getElementById('nt-outgoing-translation'))",
                false,
            )
            .expect("mounted state");
        assert_eq!(mounted.as_bool(), Some(true));
        let japanese_controller = outgoing_ui_script(true, "ja", "ko");
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
        let controller = outgoing_ui_script(true, "ja", "ko");
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
        let controller = outgoing_ui_script(true, "ja", "ko");
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
                &attach_outgoing_text_file_script(
                    request_id,
                    content,
                    "NudeNyangTranslator-test.txt",
                )
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
        assert_eq!(
            result["name"].as_str(),
            Some("NudeNyangTranslator-test.txt")
        );
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
