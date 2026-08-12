use std::collections::HashMap;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::cache::OutgoingOriginalRecord;
use crate::language::{
    detect_explicit_language, is_supported_language_code, Language, LANGUAGE_MENU_ORDER,
};
use crate::ui_locale::generated_copies;

const OUTGOING_UI_SCRIPT: &str = r####"
(() => {
  const enabled = __ENABLED__;
  const displayEnabled = __DISPLAY_ENABLED__;
  const displayLanguage = __DISPLAY_LANGUAGE__;
  const defaultLanguage = __DEFAULT_LANGUAGE__;
  const requestedUiLanguage = __UI_LANGUAGE__;
  const rememberedChannelLanguages = __CHANNEL_LANGUAGES__;
  const confirmSend = __CONFIRM_SEND__;
  const sendImmediatelyShortcut = __SEND_IMMEDIATELY_SHORTCUT__;
  const reviewBeforeSendShortcut = __REVIEW_BEFORE_SEND_SHORTCUT__;
  const systemUiLanguage = (navigator.language || 'en').toLowerCase();
  const supportedUiLanguages = ['ko','en','ja','zh','zh-Hant','pt-BR','hi','es-419','de','ru','id','fr','tr','ar','vi','it','pl','uk','ms','nl'];
  function resolveUiLanguage(value) {
    const normalized = String(value || '').replaceAll('_','-').toLowerCase();
    if (normalized.startsWith('zh')) return /(?:^|-)hant(?:-|$)/.test(normalized) || /^zh-(tw|hk|mo)(?:-|$)/.test(normalized) ? 'zh-Hant' : 'zh';
    if (normalized.startsWith('pt')) return 'pt-BR';
    if (normalized.startsWith('es')) return 'es-419';
    if (normalized === 'in' || normalized.startsWith('in-')) return 'id';
    return supportedUiLanguages.find(code => normalized === code.toLowerCase() || normalized.startsWith(`${code.toLowerCase()}-`)) || 'en';
  }
  const uiLanguage = resolveUiLanguage(requestedUiLanguage === 'auto' ? systemUiLanguage : requestedUiLanguage);
  const GLOBAL = '__nudeTranslatorOutgoing';
  const ROOT_ID = 'nt-outgoing-translation';
  const CONTROLLER_VERSION = 35;
  const HEARTBEAT_TIMEOUT_MS = 5000;
  const PENDING_TIMEOUT_MS = 5 * 60 * 1000;
  const MENU_SCROLL_REVEAL_DISTANCE = 18;
  const composerSelector = '[role="textbox"][contenteditable="true"], [contenteditable="true"][data-slate-editor="true"]';
  const mentionSelector = '[data-slate-inline="true"][data-slate-void="true"][contenteditable="false"]';
  const copies = Object.assign({
    ko: {
      auto:'자동 감지', outgoingLanguage:'전송', selectLanguage:'전송 언어 선택', originalOnce:'이번 메시지만 원문으로 전송',
      nextOriginal:'다음 메시지는 번역하지 않고 전송합니다.', selectLanguageFormal:'전송 언어를 선택하십시오.', sendingOriginal:'원문을 전송합니다.',
      translating:'메시지를 번역하고 있습니다.', detectionFailed:'대화 언어를 판단하지 못했습니다. 전송 언어를 선택하십시오.',
      detectedLanguage:'{language}로 감지했습니다. 전송 언어 메뉴에서 변경할 수 있습니다.',
      sendOriginal:'원문 전송', translationFailed:'메시지를 번역하지 못했습니다. 번역하지 않고 원문을 유지합니다.',
      pending:'이전 메시지를 처리하고 있습니다. 잠시 후 다시 시도하십시오.', sendingParts:'번역문을 분할 전송하고 있습니다. ({part}/{total})',
      longAttachment:'번역문이 길어 텍스트 파일로 전송합니다.', reviewReady:'번역문을 확인하거나 수정한 뒤 Enter로 전송하십시오.', reviewHint:'번역문을 수정하거나 Enter로 전송하십시오.',
      realTimeOn:'번역 켜짐', displayLanguage:'표시', selectDisplayLanguage:'표시 언어 선택', searchLanguages:'언어 검색', noMatchingLanguages:'검색 결과 없음'
    },
    en: {
      auto:'Auto detect', outgoingLanguage:'Send', selectLanguage:'Select outgoing language', originalOnce:'Send only this message without translation',
      nextOriginal:'The next message will be sent without translation.', selectLanguageFormal:'Select an outgoing language.', sendingOriginal:'Sending the original message.',
      translating:'Translating the message.', detectionFailed:'The conversation language could not be determined. Select an outgoing language.',
      detectedLanguage:'Detected {language}. You can change it from the outgoing language menu.',
      sendOriginal:'Send original', translationFailed:'The message could not be translated. The original message has been preserved.',
      pending:'The previous message is still being processed. Try again shortly.', sendingParts:'Sending the translated message in parts. ({part}/{total})',
      longAttachment:'The translation is long and will be sent as a text file.', reviewReady:'Review or edit the translation, then press Enter to send.', reviewHint:'Edit the translation or press Enter to send it.',
      realTimeOn:'Translation on', displayLanguage:'View', selectDisplayLanguage:'Select display language', searchLanguages:'Search languages', noMatchingLanguages:'No matching languages'
    },
    ja: {
      auto:'自動検出', outgoingLanguage:'送信', selectLanguage:'送信言語を選択', originalOnce:'このメッセージのみ原文で送信',
      nextOriginal:'次のメッセージは翻訳せずに送信します。', selectLanguageFormal:'送信言語を選択してください。', sendingOriginal:'原文を送信します。',
      translating:'メッセージを翻訳しています。', detectionFailed:'会話の言語を判定できませんでした。送信言語を選択してください。',
      detectedLanguage:'{language}と判定しました。送信言語メニューから変更できます。',
      sendOriginal:'原文を送信', translationFailed:'メッセージを翻訳できませんでした。原文は変更されていません。',
      pending:'前のメッセージを処理しています。しばらくしてからもう一度お試しください。', sendingParts:'翻訳文を分割して送信しています。({part}/{total})',
      longAttachment:'翻訳文が長いため、テキストファイルとして送信します。', reviewReady:'翻訳文を確認・修正し、Enterで送信してください。', reviewHint:'翻訳文を修正するか、Enterで送信してください。',
      realTimeOn:'翻訳オン', displayLanguage:'表示', selectDisplayLanguage:'表示言語を選択', searchLanguages:'言語を検索', noMatchingLanguages:'一致する言語がありません'
    },
    zh: {
      auto:'自动检测', outgoingLanguage:'发送', selectLanguage:'选择发送语言', originalOnce:'仅本条消息发送原文',
      nextOriginal:'下一条消息将不翻译并直接发送。', selectLanguageFormal:'请选择发送语言。', sendingOriginal:'正在发送原文。',
      translating:'正在翻译消息。', detectionFailed:'无法判断对话语言。请选择发送语言。',
      detectedLanguage:'已检测为{language}。可在发送语言菜单中更改。',
      sendOriginal:'发送原文', translationFailed:'无法翻译消息。原文已保持不变。',
      pending:'上一条消息仍在处理中。请稍后重试。', sendingParts:'正在分段发送译文。({part}/{total})',
      longAttachment:'译文较长，将以文本文件形式发送。', reviewReady:'请检查或修改译文，然后按 Enter 发送。', reviewHint:'请修改译文或按 Enter 发送。',
      realTimeOn:'翻译开启', displayLanguage:'显示', selectDisplayLanguage:'选择显示语言', searchLanguages:'搜索语言', noMatchingLanguages:'没有匹配的语言'
    }
  }, __GENERATED_OUTGOING_COPIES__);
  const languageLabels = __LANGUAGE_LABELS__;
  const languageEnglishNames = __LANGUAGE_ENGLISH_NAMES__;
  const languageCodes = __LANGUAGE_CODES__;
  const compactLanguageLabels = __COMPACT_LANGUAGE_LABELS__;
  const copy = key => copies[uiLanguage]?.[key] || copies.en[key] || key;
  const formatCopy = (key, values) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), copy(key));
  const shortcutFromEvent = event => {
    const rawKey = String(event.key || '');
    if (['Control','Alt','Shift','Meta','Tab','Escape'].includes(rawKey)) return '';
    const namedKeys = {' ':'Space',Spacebar:'Space',Enter:'Enter',ArrowUp:'ArrowUp',ArrowDown:'ArrowDown',ArrowLeft:'ArrowLeft',ArrowRight:'ArrowRight',Home:'Home',End:'End',PageUp:'PageUp',PageDown:'PageDown',Insert:'Insert'};
    const key = /^F(?:[1-9]|1\d|2[0-4])$/i.test(rawKey) || /^[a-z0-9]$/i.test(rawKey) ? rawKey.toUpperCase() : (namedKeys[rawKey] || '');
    if (!key) return '';
    const modifiers = [];
    if (event.ctrlKey) modifiers.push('Ctrl');
    if (event.altKey) modifiers.push('Alt');
    if (event.shiftKey) modifiers.push('Shift');
    if (event.metaKey) modifiers.push('Super');
    return [...modifiers,key].join('+');
  };
  const sameShortcut = (left, right) => Boolean(left && right && left.toLowerCase() === right.toLowerCase());
  function currentChannelKey() {
    return location.pathname.startsWith('/channels/') ? location.pathname : '';
  }
  function selectedLanguageForChannel(key, fallbackLanguage, channelLanguages) {
    return channelLanguages[key] || fallbackLanguage;
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
  function comparableMessageText(value) {
    const text = String(value || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u00a0\u200b]/g, ' ')
      .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
      .replace(/^\s{0,3}-#\s+/gm, '')
      .replace(/^\s{0,3}#{1,3}\s+/gm, '')
      .replace(/^\s{0,3}>{1,3}\s?/gm, '')
      .replace(/^\s{0,3}(?:[-+*]|\d+[.)])\s+/gm, '')
      .replace(/^[•◦▪‣]\s*/gm, '')
      .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]+\)/g, '$1')
      .replace(/\\([\\`*_{}\[\]()#+\-.!|>])/g, '$1')
      .replace(/[*_~|`]/g, '');
    return text.split('\n').map(line => line.trim()).filter(Boolean).join('\n');
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
    return visibleComposerText(editor);
  }
  function composerHasText(editor) {
    return Boolean(composerText(editor).trim());
  }
  function selectionCoversComposer(editor) {
    const selection = getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return false;
    const selected = selection.getRangeAt(0);
    const contains = node => node === editor || editor.contains(node);
    if (!contains(selected.startContainer) || !contains(selected.endContainer)) return false;
    const normalize = value => value.replace(/\u00a0/g, ' ').replace(/\uFEFF/g, '').trim();
    const before = document.createRange();
    before.setStart(editor, 0);
    before.setEnd(selected.startContainer, selected.startOffset);
    const after = document.createRange();
    after.setStart(selected.endContainer, selected.endOffset);
    after.setEnd(editor, editor.childNodes.length);
    return Boolean(normalize(selected.toString())) && !normalize(before.toString()) && !normalize(after.toString());
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
      text: range ? visibleComposerText(range.cloneContents()) : '',
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
  function currentComposerForItem(item) {
    const expected = item.original_text || item.text || '';
    const current = item.editor;
    if (current?.isConnected && sourceTextForItem(current, item) === expected) return current;
    const messageRowSelector = 'li[id^="chat-messages-"], [data-list-item-id^="chat-messages___"], [class*="messageListItem"]';
    const candidates = [...document.querySelectorAll(composerSelector)]
      .filter(candidate => candidate.isConnected && !candidate.closest(messageRowSelector))
      .filter(candidate => sourceTextForItem(candidate, item) === expected);
    const focused = document.activeElement;
    return candidates.find(candidate => candidate === focused || candidate.contains(focused))
      || candidates.sort((left, right) => left.getBoundingClientRect().bottom - right.getBoundingClientRect().bottom).at(-1)
      || null;
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
    button.dataset.action = action;
    if (action === 'language' || action === 'display-language') {
      const label = document.createElement('span');
      button.dir = 'ltr';
      label.dir = 'auto';
      label.textContent = text;
      button.append(label);
    } else {
      button.textContent = text;
    }
    if (value) button.dataset.value = value;
    return button;
  }
  function normalizeLanguageSearch(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
  }
  function appendLanguageChoices(menu, choices, action) {
    const search = document.createElement('div');
    const input = document.createElement('input');
    const empty = document.createElement('div');
    search.className = 'nt-language-search';
    input.type = 'search';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = copy('searchLanguages');
    input.setAttribute('aria-label', copy('searchLanguages'));
    empty.className = 'nt-language-search-empty';
    empty.textContent = copy('noMatchingLanguages');
    empty.hidden = true;
    search.append(input);
    menu.append(search);
    const buttons = choices.map(code => makeButton(languageLabels[code], action, code));
    menu.append(...buttons, empty);
    input.addEventListener('input', () => {
      const query = normalizeLanguageSearch(input.value);
      let visible = 0;
      buttons.forEach((button, index) => {
        const code = choices[index];
        const searchable = normalizeLanguageSearch(`${languageLabels[code]} ${code} ${languageEnglishNames[code] || ''}`);
        button.hidden = Boolean(query) && !searchable.includes(query);
        if (!button.hidden) visible += 1;
      });
      empty.hidden = visible > 0;
      menu.__ntScrollIndicator?.update();
    });
    input.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown') return;
      const first = buttons.find(button => !button.hidden);
      if (first) { event.preventDefault(); first.focus(); }
    });
    return input;
  }
  function bindMenuScrollIndicator(menu) {
    const indicator = menu.nextElementSibling;
    const thumb = indicator?.querySelector('.nt-menu-scroll-thumb');
    if (!indicator || !thumb) return;
    let draggingPointer = null;
    let hideTimer = 0;

    const update = () => {
      indicator.style.height = `${Math.max(0, menu.clientHeight - 8)}px`;
      const trackHeight = indicator.clientHeight;
      const maxScroll = Math.max(0, menu.scrollHeight - menu.clientHeight);
      const scrollable = !menu.hidden && maxScroll > 1 && trackHeight > 0;
      indicator.classList.toggle('scrollable', scrollable);
      if (!scrollable) {
        indicator.classList.remove('nt-scroll-near', 'nt-scrolling', 'nt-scroll-dragging');
        thumb.style.height = '0px';
        thumb.style.transform = 'translateY(0)';
        return;
      }
      const thumbHeight = Math.max(32, Math.round((menu.clientHeight / menu.scrollHeight) * trackHeight));
      const thumbTravel = Math.max(0, trackHeight - thumbHeight);
      const thumbTop = maxScroll > 0 ? Math.round((menu.scrollTop / maxScroll) * thumbTravel) : 0;
      thumb.style.height = `${thumbHeight}px`;
      thumb.style.transform = `translateY(${thumbTop}px)`;
    };

    const scheduleUpdate = () => requestAnimationFrame(update);
    const revealWhileScrolling = () => {
      update();
      indicator.classList.add('nt-scrolling');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => indicator.classList.remove('nt-scrolling'), 550);
    };
    const updateProximity = event => {
      if (draggingPointer !== null) return;
      if (menu.hidden || !indicator.classList.contains('scrollable')) {
        indicator.classList.remove('nt-scroll-near');
        return;
      }
      const bounds = indicator.getBoundingClientRect();
      const distanceX = Math.max(bounds.left - event.clientX, 0, event.clientX - bounds.right);
      const distanceY = Math.max(bounds.top - event.clientY, 0, event.clientY - bounds.bottom);
      indicator.classList.toggle('nt-scroll-near', Math.hypot(distanceX, distanceY) <= MENU_SCROLL_REVEAL_DISTANCE);
    };
    const scrollToPointer = clientY => {
      const track = indicator.getBoundingClientRect();
      const thumbHeight = thumb.getBoundingClientRect().height;
      const thumbTravel = Math.max(0, track.height - thumbHeight);
      const maxScroll = Math.max(0, menu.scrollHeight - menu.clientHeight);
      if (thumbTravel <= 0 || maxScroll <= 0) return;
      const thumbTop = Math.min(thumbTravel, Math.max(0, clientY - track.top - thumbHeight / 2));
      menu.scrollTop = (thumbTop / thumbTravel) * maxScroll;
    };
    const finishDrag = event => {
      if (draggingPointer !== event.pointerId) return;
      draggingPointer = null;
      indicator.classList.remove('nt-scroll-dragging');
      if (indicator.hasPointerCapture(event.pointerId)) indicator.releasePointerCapture(event.pointerId);
      updateProximity(event);
    };
    const reset = () => {
      clearTimeout(hideTimer);
      indicator.classList.remove('nt-scroll-near', 'nt-scrolling', 'nt-scroll-dragging');
      draggingPointer = null;
    };

    menu.addEventListener('scroll', revealWhileScrolling, {passive:true});
    menu.parentElement.addEventListener('pointermove', updateProximity);
    menu.parentElement.addEventListener('pointerleave', () => {
      if (draggingPointer === null) indicator.classList.remove('nt-scroll-near');
    });
    indicator.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !indicator.classList.contains('scrollable')) return;
      draggingPointer = event.pointerId;
      indicator.classList.add('nt-scroll-near', 'nt-scroll-dragging');
      indicator.setPointerCapture(event.pointerId);
      scrollToPointer(event.clientY);
      event.preventDefault();
      event.stopPropagation();
    });
    indicator.addEventListener('pointermove', event => {
      if (draggingPointer === event.pointerId) scrollToPointer(event.clientY);
    });
    indicator.addEventListener('pointerup', finishDrag);
    indicator.addEventListener('pointercancel', finishDrag);
    indicator.addEventListener('wheel', event => {
      if (!indicator.classList.contains('scrollable')) return;
      menu.scrollTop += event.deltaY;
      event.preventDefault();
      event.stopPropagation();
    }, {passive:false});
    menu.__ntScrollIndicator = {update:scheduleUpdate, reset};
  }
  function ensureRoot(controller) {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `<div class="nt-controls-row"><div class="nt-control-wrap nt-role-control nt-outgoing-control"><button type="button" class="nt-outgoing-trigger" aria-label="${copy('selectLanguage')}" title="${copy('selectLanguage')}" aria-expanded="false"><span class="nt-role-icon nt-outgoing-icon" aria-hidden="true">↑</span><b>${compactLanguageLabels.auto}</b></button><div class="nt-outgoing-menu" hidden></div><div class="nt-menu-scroll-indicator" aria-hidden="true"><span class="nt-menu-scroll-thumb"></span></div></div><div class="nt-control-wrap nt-role-control nt-display-control"><button type="button" class="nt-display-trigger" aria-label="${copy('selectDisplayLanguage')}" title="${copy('selectDisplayLanguage')}" aria-expanded="false"><span class="nt-role-icon nt-display-icon" aria-hidden="true">↓</span><b></b></button><div class="nt-display-menu" hidden></div><div class="nt-menu-scroll-indicator" aria-hidden="true"><span class="nt-menu-scroll-thumb"></span></div></div></div><p class="nt-outgoing-status" hidden></p>`;
    const style = document.createElement('style');
    style.id = `${ROOT_ID}-style`;
    style.textContent = `
      #${ROOT_ID}{position:fixed;right:18px;bottom:82px;z-index:2147483000;display:flex;max-width:calc(100vw - 32px);flex-direction:column;align-items:flex-end;gap:6px;font-family:var(--font-primary,Arial,sans-serif);font-size:12px;color:var(--text-normal,#dbdee1)}
      #${ROOT_ID} [hidden]{display:none!important}
      #${ROOT_ID} button{font:inherit;color:inherit;cursor:pointer}
      #${ROOT_ID} .nt-controls-row{display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-end;gap:5px;max-width:100%}
      #${ROOT_ID} .nt-control-wrap{position:relative;flex:none}
      #${ROOT_ID} .nt-outgoing-control{--nt-role-bg:#0f202c;--nt-role-border:#2d4558;--nt-role-text:#f2f7fb;--nt-role-muted:#9bb7cb;--nt-role-accent:#5aa8f5;--nt-icon-bg:#08141d;--nt-icon-text:#76b8fa}
      #${ROOT_ID} .nt-display-control{--nt-role-bg:#0f202c;--nt-role-border:#2d4558;--nt-role-text:#f2f7fb;--nt-role-muted:#9bb7cb;--nt-role-accent:#d98243;--nt-icon-bg:#2a1d14;--nt-icon-text:#f0a15c}
      #${ROOT_ID} .nt-outgoing-trigger,#${ROOT_ID} .nt-display-trigger{display:flex;width:auto;min-width:56px;min-height:32px;align-items:center;gap:4px;padding:3px 5px;border:1px solid var(--nt-role-border);border-radius:9px;background:var(--nt-role-bg);box-shadow:0 3px 10px #0004;color:var(--nt-role-text);transition:transform 100ms ease,background-color 120ms ease,border-color 120ms ease}
      #${ROOT_ID} .nt-outgoing-trigger:hover,#${ROOT_ID} .nt-display-trigger:hover{border-color:color-mix(in srgb,var(--nt-role-accent) 66%,var(--nt-role-border));background:color-mix(in srgb,var(--nt-role-bg) 90%,var(--nt-role-accent))}
      #${ROOT_ID} .nt-outgoing-trigger:active,#${ROOT_ID} .nt-display-trigger:active{transform:translateY(1px)}
      #${ROOT_ID} .nt-outgoing-trigger:focus-visible,#${ROOT_ID} .nt-display-trigger:focus-visible{outline:2px solid color-mix(in srgb,var(--nt-role-accent) 58%,transparent);outline-offset:2px}
      #${ROOT_ID} .nt-role-icon{display:inline-flex;width:20px;height:20px;flex:none;align-items:center;justify-content:center;border:1px solid color-mix(in srgb,var(--nt-role-accent) 50%,var(--nt-role-border));border-radius:50%;background:var(--nt-icon-bg);color:var(--nt-icon-text);font-size:13px;font-weight:750;line-height:1}
      #${ROOT_ID} .nt-outgoing-trigger b,#${ROOT_ID} .nt-display-trigger b{color:var(--nt-role-text);font-size:11px;font-weight:750;letter-spacing:.035em;white-space:nowrap}
      #${ROOT_ID} .nt-outgoing-menu,#${ROOT_ID} .nt-display-menu{position:absolute;right:0;bottom:40px;width:238px;max-height:min(58vh,500px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;padding:6px 12px 6px 6px;border:1px solid color-mix(in srgb,var(--nt-role-accent) 45%,transparent);border-radius:11px;background:var(--background-floating,#111214);box-shadow:0 10px 30px #0008;color:var(--text-normal,#dbdee1)}
      #${ROOT_ID} .nt-outgoing-menu::-webkit-scrollbar,#${ROOT_ID} .nt-display-menu::-webkit-scrollbar{width:0;height:0}
      #${ROOT_ID} .nt-menu-scroll-indicator{position:absolute;z-index:2;right:1px;bottom:44px;width:10px;opacity:0;cursor:default;pointer-events:auto;transition:opacity 160ms ease}
      #${ROOT_ID} .nt-outgoing-menu[hidden]+.nt-menu-scroll-indicator,#${ROOT_ID} .nt-display-menu[hidden]+.nt-menu-scroll-indicator{display:none}
      #${ROOT_ID} .nt-menu-scroll-indicator:not(.scrollable){pointer-events:none}
      #${ROOT_ID} .nt-menu-scroll-indicator.nt-scrolling,#${ROOT_ID} .nt-menu-scroll-indicator.nt-scroll-near,#${ROOT_ID} .nt-menu-scroll-indicator.nt-scroll-dragging,#${ROOT_ID} .nt-menu-scroll-indicator:hover{opacity:1}
      #${ROOT_ID} .nt-menu-scroll-thumb{position:absolute;top:0;right:3px;width:3px;min-height:32px;border-radius:3px;background:var(--nt-role-accent);opacity:.46;transition:width 140ms ease,right 140ms ease,opacity 140ms ease}
      #${ROOT_ID} .nt-menu-scroll-indicator:hover .nt-menu-scroll-thumb,#${ROOT_ID} .nt-menu-scroll-indicator.nt-scroll-dragging .nt-menu-scroll-thumb{right:2px;width:6px;opacity:.95}
      #${ROOT_ID} .nt-outgoing-menu button,#${ROOT_ID} .nt-display-menu button{display:flex;width:100%;min-height:32px;align-items:center;justify-content:flex-start;padding:7px 9px;border:0;border-radius:7px;background:transparent;text-align:left}
      #${ROOT_ID} .nt-outgoing-menu button:hover,#${ROOT_ID} .nt-display-menu button:hover{background:color-mix(in srgb,#5aa8f5 24%,transparent)}
      #${ROOT_ID} .nt-outgoing-menu .nt-heading,#${ROOT_ID} .nt-display-menu .nt-heading{padding:7px 9px 4px;color:var(--text-muted,#949ba4);font-size:11px}
      #${ROOT_ID} .nt-language-search{position:sticky;z-index:1;top:-6px;padding:5px 3px 6px;background:var(--background-floating,#111214)}
      #${ROOT_ID} .nt-language-search input{box-sizing:border-box;width:100%;min-height:32px;padding:6px 8px;border:1px solid var(--background-modifier-accent,#ffffff24);border-radius:7px;outline:none;background:var(--input-background,#1e1f22);color:var(--text-normal,#dbdee1);font:inherit}
      #${ROOT_ID} .nt-language-search input:focus{border-color:var(--nt-role-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--nt-role-accent) 22%,transparent)}
      #${ROOT_ID} .nt-language-search-empty{padding:16px 9px;color:var(--text-muted,#949ba4);text-align:center}
      #${ROOT_ID} .nt-outgoing-menu .nt-divider{height:1px;margin:5px;background:var(--background-modifier-accent,#ffffff14)}
      #${ROOT_ID} .nt-outgoing-status{order:-1;max-width:270px;margin:0 0 6px;padding:7px 9px;border-radius:7px;background:var(--background-floating,#111214);box-shadow:0 4px 16px #0008;white-space:pre-line}
      #${ROOT_ID} .nt-outgoing-status[data-error="true"]{color:#ff9ca3}
    `;
    document.head.append(style);
    document.body.append(root);
    bindMenuScrollIndicator(root.querySelector('.nt-outgoing-menu'));
    bindMenuScrollIndicator(root.querySelector('.nt-display-menu'));
    root.querySelector('.nt-outgoing-trigger').addEventListener('click', () => controller.toggleMenu());
    root.querySelector('.nt-outgoing-menu').addEventListener('click', event => controller.onMenu(event));
    root.querySelector('.nt-display-trigger').addEventListener('click', () => controller.toggleDisplayMenu());
    root.querySelector('.nt-display-menu').addEventListener('click', event => controller.onDisplayMenu(event));
    return root;
  }

  let controller = window[GLOBAL];
  if (controller && (controller.version !== CONTROLLER_VERSION || controller.uiLanguage !== uiLanguage)) {
    if (controller.listener) document.removeEventListener('keydown', controller.listener, true);
    if (controller.beforeInputListener) document.removeEventListener('beforeinput', controller.beforeInputListener, true);
    if (controller.inputListener) document.removeEventListener('input', controller.inputListener, true);
    if (controller.pointerDownListener) document.removeEventListener('pointerdown', controller.pointerDownListener, true);
    clearTimeout(controller.statusTimer);
    clearInterval(controller.watchdogTimer);
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
      watchdogTimer: 0,
      lastHeartbeat: Date.now(),
      released: false,
      root: null,
      defaultLanguage: 'auto',
      displayEnabled: false,
      displayLanguage: 'ko',
      channelLanguages: {},
      confirmSend: true,
      sendImmediatelyShortcut: 'Ctrl+Enter',
      reviewBeforeSendShortcut: 'Alt+Enter',
      pointerDownListener: null,
      failsafe() {
        if (this.released) return;
        this.released = true;
        this.enabled = false;
        this.displayEnabled = false;
        clearTimeout(this.statusTimer);
        clearInterval(this.watchdogTimer);
        document.removeEventListener('keydown', this.listener, true);
        document.removeEventListener('beforeinput', this.beforeInputListener, true);
        document.removeEventListener('input', this.inputListener, true);
        document.removeEventListener('pointerdown', this.pointerDownListener, true);

        for (const [id, item] of this.pending) {
          const editor = item.editor;
          const original = item.original_text || item.text || '';
          const translationWasInserted = item.review_ready || item.installing_review || this.activeRequest === id;
          if (!translationWasInserted || !original || !editor?.isConnected || !composerHasText(editor)) continue;
          if (composerText(editor) === original) continue;
          editor.focus();
          const range = document.createRange();
          range.selectNodeContents(editor);
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          document.execCommand('insertText', false, original);
        }
        this.pending.clear();
        this.queue.length = 0;
        this.activeRequest = '';
        this.bypass = 0;

        window.__nudeTranslatorRestoreTranslatedText?.();
        window.__ntImageEnabled = false;
        clearTimeout(window.__ntImageButtonTimer);
        if (window.__ntImageFrame) cancelAnimationFrame(window.__ntImageFrame);
        window.__ntImageFrame = 0;
        window.__ntImageUiAbort?.abort();
        document.getElementById('nt-image-translate-button')?.remove();
        document.getElementById('nt-image-translate-style')?.remove();
        for (const img of document.querySelectorAll('img[data-nt-image-id]')) {
          if (!img.dataset.ntOriginalSrc) continue;
          img.src = img.dataset.ntOriginalSrc;
          if (img.dataset.ntOriginalSrcset) img.srcset = img.dataset.ntOriginalSrcset;
          else img.removeAttribute('srcset');
          img.dataset.ntImageStatus = img.dataset.ntTranslatedSrc ? 'paused' : 'original';
        }

        const originalsManager = window.__nudeTranslatorOutgoingOriginalDisplay;
        originalsManager?.observer?.disconnect();
        document.querySelectorAll('.nt-outgoing-original-view').forEach(view => view.remove());
        document.querySelectorAll('[data-nt-outgoing-original="true"]').forEach(root => {
          root.style.display = '';
          root.removeAttribute('data-nt-outgoing-original');
        });
        document.querySelectorAll('[data-nt-outgoing-message-row="true"]').forEach(row => {
          row.removeAttribute('data-nt-outgoing-message-row');
        });
        document.getElementById('nt-outgoing-original-style')?.remove();
        delete window.__nudeTranslatorOutgoingOriginalDisplay;
        delete window.__nudeTranslatorRegisterOutgoingOriginal;
        delete window.__nudeTranslatorApplyOutgoingOriginals;
        window.__nudeTranslatorOutgoingOriginalsReady = '';

        document.getElementById(ROOT_ID)?.remove();
        document.getElementById(`${ROOT_ID}-style`)?.remove();
        if (window[GLOBAL] === this) delete window[GLOBAL];
      },
      setStatus(message, error = false) {
        if (!this.root) return;
        const status = this.root.querySelector('.nt-outgoing-status');
        status.textContent = message;
        status.dataset.error = String(error);
        status.hidden = !message;
        clearTimeout(this.statusTimer);
        if (message) this.statusTimer = setTimeout(() => { status.hidden = true; }, 5000);
      },
      reposition() {
        if (!this.root) return;
        const editors = [...document.querySelectorAll(composerSelector)].filter(editor => {
          const bounds = editor.getBoundingClientRect();
          return bounds.width > 120
            && bounds.height > 24
            && bounds.top > window.innerHeight * 0.4
            && bounds.bottom <= window.innerHeight + 1;
        });
        const editor = editors.sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top).at(-1);
        if (!editor) {
          this.root.style.visibility = 'hidden';
          return;
        }
        const composer = editor.closest('form') || editor.closest('[class*="channelTextArea"]') || editor.parentElement;
        const composerBounds = composer.getBoundingClientRect();
        this.root.style.right = `${Math.max(12, window.innerWidth - composerBounds.right)}px`;
        this.root.style.bottom = `${Math.max(78, window.innerHeight - composerBounds.top + 8)}px`;
        this.root.style.visibility = '';
      },
      updateLabel() {
        if (!this.root) return;
        const key = currentChannelKey();
        const language = selectedLanguageForChannel(key, this.defaultLanguage, this.channelLanguages);
        this.root.querySelector('.nt-outgoing-trigger b').textContent = compactLanguageLabels[language] || compactLanguageLabels.auto;
        this.root.querySelector('.nt-display-trigger b').textContent = compactLanguageLabels[this.displayLanguage] || compactLanguageLabels.ko;
        this.root.querySelector('.nt-outgoing-control').hidden = !this.enabled;
        this.root.querySelector('.nt-display-control').hidden = !this.displayEnabled;
        this.root.hidden = !this.enabled && !this.displayEnabled;
      },
      rememberLanguage(key, language) {
        if (!key) return;
        this.channelLanguages[key] = language;
        this.queue.push({
          id:`outgoing-language-${Date.now()}-${++this.sequence}`,
          channel_key:key,
          text:'',
          action:'remember-language',
          selected_language:language,
          recent_messages:[],
          send_immediately:false,
        });
      },
      closeMenus() {
        if (!this.root) return;
        const outgoingMenu = this.root.querySelector('.nt-outgoing-menu');
        const displayMenu = this.root.querySelector('.nt-display-menu');
        outgoingMenu.hidden = true;
        displayMenu.hidden = true;
        outgoingMenu.__ntScrollIndicator?.reset();
        displayMenu.__ntScrollIndicator?.reset();
        this.root.querySelector('.nt-outgoing-trigger').setAttribute('aria-expanded', 'false');
        this.root.querySelector('.nt-display-trigger').setAttribute('aria-expanded', 'false');
      },
      showLanguageMenu(heading = copy('selectLanguage'), requestId = '') {
        this.manualRequest = requestId;
        const menu = this.root.querySelector('.nt-outgoing-menu');
        menu.replaceChildren();
        const title = document.createElement('div');
        title.className = 'nt-heading';
        title.textContent = heading;
        menu.append(title);
        const choices = requestId ? languageCodes : ['auto', ...languageCodes];
        const searchInput = appendLanguageChoices(menu, choices, 'language');
        const divider = document.createElement('div');
        divider.className = 'nt-divider';
        menu.append(divider, makeButton(copy('originalOnce'), 'original-once'));
        menu.hidden = false;
        menu.__ntScrollIndicator?.update();
        searchInput.focus();
        const displayMenu = this.root.querySelector('.nt-display-menu');
        displayMenu.hidden = true;
        displayMenu.__ntScrollIndicator?.reset();
        this.root.querySelector('.nt-display-trigger').setAttribute('aria-expanded', 'false');
        this.root.querySelector('.nt-outgoing-trigger').setAttribute('aria-expanded', 'true');
      },
      toggleMenu() {
        const menu = this.root.querySelector('.nt-outgoing-menu');
        if (menu.hidden) this.showLanguageMenu();
        else { menu.hidden = true; menu.__ntScrollIndicator?.reset(); this.root.querySelector('.nt-outgoing-trigger').setAttribute('aria-expanded', 'false'); }
      },
      showDisplayLanguageMenu() {
        const menu = this.root.querySelector('.nt-display-menu');
        menu.replaceChildren();
        const title = document.createElement('div');
        title.className = 'nt-heading';
        title.textContent = copy('selectDisplayLanguage');
        menu.append(title);
        const searchInput = appendLanguageChoices(menu, languageCodes, 'display-language');
        menu.hidden = false;
        menu.__ntScrollIndicator?.update();
        searchInput.focus();
        const outgoingMenu = this.root.querySelector('.nt-outgoing-menu');
        outgoingMenu.hidden = true;
        outgoingMenu.__ntScrollIndicator?.reset();
        this.root.querySelector('.nt-outgoing-trigger').setAttribute('aria-expanded', 'false');
        this.root.querySelector('.nt-display-trigger').setAttribute('aria-expanded', 'true');
      },
      toggleDisplayMenu() {
        const menu = this.root.querySelector('.nt-display-menu');
        if (menu.hidden) this.showDisplayLanguageMenu();
        else { menu.hidden = true; menu.__ntScrollIndicator?.reset(); this.root.querySelector('.nt-display-trigger').setAttribute('aria-expanded', 'false'); }
      },
      onDisplayMenu(event) {
        const button = event.target.closest('button[data-action="display-language"]');
        if (!button) return;
        this.displayLanguage = button.dataset.value;
        this.queue.push({
          id:`display-language-${Date.now()}-${++this.sequence}`,
          channel_key:currentChannelKey(),
          text:'',
          action:'display-language',
          selected_language:this.displayLanguage,
          recent_messages:[],
          send_immediately:false,
        });
        const menu = this.root.querySelector('.nt-display-menu');
        menu.hidden = true;
        menu.__ntScrollIndicator?.reset();
        this.root.querySelector('.nt-display-trigger').setAttribute('aria-expanded', 'false');
        this.updateLabel();
      },
      onMenu(event) {
        const button = event.target.closest('button');
        if (!button) return;
        const key = currentChannelKey();
        if (button.dataset.action === 'language') {
          this.rememberLanguage(key, button.dataset.value);
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
        } else if (button.dataset.action === 'suggest-original') {
          this.retry(button.dataset.value, 'original');
        }
        this.root.querySelector('.nt-outgoing-menu').hidden = true;
        this.root.querySelector('.nt-outgoing-menu').__ntScrollIndicator?.reset();
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
        this.showLanguageMenu(copy('detectionFailed'), id);
      },
      detected(id, language) {
        if (!this.pending.has(id) || !languageLabels[language]) return;
        this.setStatus(formatCopy('detectedLanguage', {language:languageLabels[language]}));
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
          if (item.review_ready && item.editor?.isConnected) continue;
          if (now - item.created_at < PENDING_TIMEOUT_MS) continue;
          this.pending.delete(id);
          if (this.activeRequest === id) {
            this.activeRequest = '';
            this.bypass = 0;
          }
        }
      },
      pendingForEditor(editor) {
        for (const entry of this.pending.entries()) {
          const [, item] = entry;
          if (item.editor === editor) return entry;
          if (item.channel_key !== currentChannelKey()) continue;
          const expected = item.original_text || item.text || '';
          if (sourceTextForItem(editor, item) !== expected) continue;
          item.editor = editor;
          return entry;
        }
        return null;
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
            return comparableMessageText(originalText(candidate)) === comparableMessageText(item.sent_text);
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
      cancelReview(editor) {
        let cancelled = false;
        for (const [id, item] of [...this.pending.entries()]) {
          if (item.editor !== editor || !item.review_ready || item.installing_review) continue;
          this.pending.delete(id);
          cancelled = true;
          if (this.activeRequest === id) {
            this.activeRequest = '';
            this.bypass = 0;
          }
        }
        if (cancelled) this.setStatus('');
        return cancelled;
      },
      onBeforeInput(event) {
        const inputType = String(event.inputType || '');
        if (!inputType.startsWith('insert') && !inputType.startsWith('delete')) return;
        const editor = event.target.closest?.(composerSelector);
        if (!editor || !selectionCoversComposer(editor)) return;
        this.cancelReview(editor);
      },
      onInput(event) {
        const editor = event.target.closest?.(composerSelector);
        if (!editor || composerHasText(editor)) return;
        const inputType = String(event.inputType || '');
        if (inputType && !inputType.startsWith('delete')) return;
        this.cancelReview(editor);
      },
      keydown(event) {
        if (Date.now() - this.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
          this.failsafe();
          return;
        }
        if (!this.enabled) return;
        const pressedShortcut = shortcutFromEvent(event);
        const sendImmediately = sameShortcut(pressedShortcut, this.sendImmediatelyShortcut);
        const reviewBeforeSend = sameShortcut(pressedShortcut, this.reviewBeforeSendShortcut);
        const ordinaryEnter = event.key === 'Enter' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && !event.isComposing;
        if (!ordinaryEnter && !sendImmediately && !reviewBeforeSend) return;
        const editor = event.target.closest?.(composerSelector);
        if (!editor) return;
        if (this.bypass > 0) {
          this.bypass -= 1;
          const activeId = this.activeRequest;
          const activeItem = activeId ? this.pending.get(activeId) : null;
          const keepAfterSend = Boolean(activeItem?.keep_after_send);
          const sentText = activeItem?.prepared_sent_text || composerText(editor);
          if (activeItem && sentText) {
            this.sent.push({
              channel_key: activeItem.channel_key,
              original_text: activeItem.original_text || activeItem.text,
              sent_text: sentText,
              part_number: activeItem.part_number || 1,
              total_parts: activeItem.total_parts || 1,
              existing_message_ids: activeItem.prepared_existing_message_ids || [],
              created_at: Date.now(),
            });
          }
          if (activeItem) {
            activeItem.keep_after_send = false;
            activeItem.prepared_sent_text = '';
            activeItem.prepared_existing_message_ids = null;
          }
          if (activeId && !keepAfterSend) this.pending.delete(activeId);
          this.activeRequest = '';
          if (!keepAfterSend) this.setStatus('');
          return;
        }
        if (hasActiveAutocomplete(editor)) return;
        const review = [...this.pending.entries()].find(([, item]) => item.editor === editor && item.review_ready);
        if (review) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (!ordinaryEnter && !sendImmediately) {
            this.setStatus(copy('reviewHint'));
            return;
          }
          const [id, item] = review;
          const text = composerText(editor);
          if (!text.trim()) return;
          this.queue.push({...item, id, text, action:'send-reviewed', send_immediately:true});
          this.setStatus(copy('sendingOriginal'));
          return;
        }
        const mentionPlan = prefixMentionPlan(editor);
        if (mentionPlan && !mentionPlan.supported) return;
        const text = mentionPlan ? mentionPlan.text : composerText(editor);
        if (!text.trim() || text.startsWith('/')) return;
        const originalText = composerText(editor);
        const key = currentChannelKey();
        if (!key) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const previous = this.pendingForEditor(editor);
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
        const selected = this.oneShotOriginal
          ? 'original'
          : selectedLanguageForChannel(key, this.defaultLanguage, this.channelLanguages);
        this.oneShotOriginal = false;
        const item = {
          id,
          channel_key:key,
          text,
          original_text:originalText,
          preserve_prefix_mentions:Boolean(mentionPlan),
          selected_language:selected,
          recent_messages:recentMessages(),
          action:'translate',
          send_immediately:sendImmediately || (!this.confirmSend && !reviewBeforeSend),
          created_at:Date.now(),
        };
        this.pending.set(id, {...item, editor});
        this.queue.push(item);
        this.setStatus(selected === 'original' ? copy('sendingOriginal') : copy('translating'));
      },
      prepare(id, replace, continuation = false, finalPart = true, partNumber = 1, totalParts = 1, sendAfter = true) {
        const item = this.pending.get(id);
        if (!item) return false;
        let editor = item.editor;
        if (continuation) {
          if (!editor?.isConnected || composerHasText(editor)) {
            const editors = [...document.querySelectorAll(composerSelector)];
            editor = editors.reverse().find(candidate => candidate.isConnected && !composerHasText(candidate));
          }
          if (!editor?.isConnected || composerHasText(editor)) return false;
          item.editor = editor;
        } else {
          editor = currentComposerForItem(item);
          if (!editor) return false;
          item.editor = editor;
        }
        editor.focus();
        if (replace) {
          const range = selectionRangeForItem(editor, item, continuation);
          if (!range) return false;
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
        item.keep_after_send = sendAfter && !finalPart;
        item.part_number = partNumber;
        item.total_parts = totalParts;
        if (sendAfter) {
          this.activeRequest = id;
          this.bypass += 1;
          if (totalParts > 1) this.setStatus(formatCopy('sendingParts', {part:partNumber,total:totalParts}));
        } else {
          item.installing_review = true;
          item.review_ready = true;
          this.setStatus(copy('reviewReady'));
        }
        return true;
      },
      finishReview(id) {
        const item = this.pending.get(id);
        if (!item?.installing_review || !item.editor?.isConnected || !composerHasText(item.editor)) return false;
        item.installing_review = false;
        item.review_ready = true;
        return true;
      },
      captureSend(id) {
        const item = this.pending.get(id);
        const editor = item?.editor;
        const text = editor?.isConnected ? composerText(editor) : '';
        if (!item || !text.trim()) return false;
        item.prepared_sent_text = text;
        item.prepared_existing_message_ids = [...document.querySelectorAll('[id^="message-content-"]')]
          .map(discordMessageId)
          .filter(Boolean);
        return true;
      },
      prepareReviewed(id) {
        const item = this.pending.get(id);
        if (!item?.review_ready || item.installing_review || !item.editor?.isConnected || !composerHasText(item.editor)) return false;
        item.editor.focus();
        item.keep_after_send = false;
        this.activeRequest = id;
        this.bypass += 1;
        return true;
      },
      prepareAttachment(id) {
        const item = this.pending.get(id);
        if (!item) return false;
        const editor = item.editor;
        if (!editor?.isConnected || (!item.review_ready && composerText(editor) !== (item.original_text || item.text))) return false;
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
        if (!item || !editor?.isConnected || !input?.isConnected || (!item.review_ready && sourceTextForItem(editor, item))) {
          if (item && editor?.isConnected && !sourceTextForItem(editor, item)) {
            editor.focus();
            document.execCommand('insertText', false, item.text);
            if (!item.preserve_prefix_mentions && !composerHasText(editor)) editor.textContent = item.text;
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
          if (!item.preserve_prefix_mentions && !composerHasText(editor)) editor.textContent = item.text;
          item.attachment_input = null;
          return false;
        }
      },
    };
    controller.listener = event => controller.keydown(event);
    controller.beforeInputListener = event => controller.onBeforeInput(event);
    controller.inputListener = event => controller.onInput(event);
    controller.pointerDownListener = event => {
      if (!controller.root || event.composedPath().includes(controller.root)) return;
      controller.closeMenus();
    };
    document.addEventListener('keydown', controller.listener, true);
    document.addEventListener('beforeinput', controller.beforeInputListener, true);
    document.addEventListener('input', controller.inputListener, true);
    document.addEventListener('pointerdown', controller.pointerDownListener, true);
    window[GLOBAL] = controller;
    controller.watchdogTimer = setInterval(() => {
      if (Date.now() - controller.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) controller.failsafe();
    }, 1000);
  }
  controller.lastHeartbeat = Date.now();
  controller.defaultLanguage = defaultLanguage;
  const optimisticLanguages = controller.queue
    .filter(item => item.action === 'remember-language' && item.channel_key)
    .map(item => [item.channel_key, item.selected_language]);
  controller.channelLanguages = {...rememberedChannelLanguages};
  for (const [channelKey, language] of optimisticLanguages) {
    controller.channelLanguages[channelKey] = language;
  }
  controller.confirmSend = confirmSend;
  controller.sendImmediatelyShortcut = sendImmediatelyShortcut;
  controller.reviewBeforeSendShortcut = reviewBeforeSendShortcut;
  controller.enabled = enabled;
  controller.displayEnabled = displayEnabled;
  controller.displayLanguage = displayLanguage;
  controller.root = ensureRoot(controller);
  controller.prunePending();
  controller.reconcileSent();
  window.__nudeTranslatorApplyOutgoingOriginals?.();
  controller.updateLabel();
  controller.reposition();
  return enabled || displayEnabled ? controller.queue.splice(0, 8).map(item => {
    const {editor, ...plain} = item;
    return plain;
  }) : [];
})()
"####;

pub const OUTGOING_CLEANUP_SCRIPT: &str = r#"
(() => {
  const controller = window.__nudeTranslatorOutgoing;
  if (controller?.watchdogTimer) clearInterval(controller.watchdogTimer);
  if (controller?.listener) document.removeEventListener('keydown', controller.listener, true);
  if (controller?.beforeInputListener) document.removeEventListener('beforeinput', controller.beforeInputListener, true);
  if (controller?.inputListener) document.removeEventListener('input', controller.inputListener, true);
  if (controller?.pointerDownListener) document.removeEventListener('pointerdown', controller.pointerDownListener, true);
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
  const displayTranslationEnabled = __DISPLAY_TRANSLATION_ENABLED__;
  const systemUiLanguage = (navigator.language || 'en').toLowerCase();
  const supportedUiLanguages = ['ko','en','ja','zh','zh-Hant','pt-BR','hi','es-419','de','ru','id','fr','tr','ar','vi','it','pl','uk','ms','nl'];
  function resolveUiLanguage(value) {
    const normalized = String(value || '').replaceAll('_','-').toLowerCase();
    if (normalized.startsWith('zh')) return /(?:^|-)hant(?:-|$)/.test(normalized) || /^zh-(tw|hk|mo)(?:-|$)/.test(normalized) ? 'zh-Hant' : 'zh';
    if (normalized.startsWith('pt')) return 'pt-BR';
    if (normalized.startsWith('es')) return 'es-419';
    if (normalized === 'in' || normalized.startsWith('in-')) return 'id';
    return supportedUiLanguages.find(code => normalized === code.toLowerCase() || normalized.startsWith(`${code.toLowerCase()}-`)) || 'en';
  }
  const uiLanguage = resolveUiLanguage(requestedUiLanguage === 'auto' ? systemUiLanguage : requestedUiLanguage);
  const copies = Object.assign({
    ko:{showOriginal:'원문 보기',showSent:'전송문 보기'},
    en:{showOriginal:'Show original',showSent:'Show sent message'},
    ja:{showOriginal:'原文を表示',showSent:'送信文を表示'},
    zh:{showOriginal:'查看原文',showSent:'查看发送内容'}
  }, __GENERATED_ORIGINAL_COPIES__);
  const copy = key => copies[uiLanguage]?.[key] || copies.en[key] || key;
  const GLOBAL = '__nudeTranslatorOutgoingOriginalDisplay';
  const STYLE_ID = 'nt-outgoing-original-style';
  const VERSION = __VERSION__;
  const messageId = root => root?.id?.startsWith('message-content-')
    ? root.id.slice('message-content-'.length) : '';
  function messageRow(root) {
    return root?.closest(
      'li[id^="chat-messages-"], [data-list-item-id^="chat-messages___"], [class*="messageListItem"]'
    ) || root?.closest('[role="listitem"]') || root?.parentElement || null;
  }
  function isEditingMessage(root) {
    const row = messageRow(root);
    if (!row) return false;
    const editorSelector = '[role="textbox"][contenteditable="true"], [contenteditable="true"][data-slate-editor="true"], textarea';
    return root.matches?.(editorSelector) || Boolean(row.querySelector(editorSelector));
  }
  function detachView(root) {
    const view = root?.nextElementSibling;
    if (view?.classList?.contains('nt-outgoing-original-view')) view.remove();
    if (!root) return;
    root.style.display = '';
    root.removeAttribute('data-nt-outgoing-original');
    messageRow(root)?.removeAttribute('data-nt-outgoing-message-row');
  }
  function cleanupDetachedViews() {
    document.querySelectorAll('.nt-outgoing-original-view').forEach(view => {
      const root = view.previousElementSibling;
      if (root?.matches?.('[id^="message-content-"]') && !isEditingMessage(root)) return;
      if (root?.matches?.('[id^="message-content-"]')) detachView(root);
      else view.remove();
    });
  }
  const recordKey = record => `${record.channel_key}|${record.message_id}`;
  function ensureStyle() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.append(style);
    }
    if (style.dataset.version === String(VERSION)) return;
    style.dataset.version = String(VERSION);
    style.textContent = `
      [data-nt-outgoing-original="true"]{display:inline}
      .nt-outgoing-original-view{display:inline-flex;flex-direction:row;align-items:baseline;gap:8px;max-width:100%;white-space:pre-wrap;vertical-align:baseline;color:var(--text-normal,#dbdee1)}
      .nt-outgoing-original-copy{display:inline;min-width:0;overflow-wrap:anywhere}
      .nt-outgoing-original-copy::before{content:attr(data-text);white-space:pre-wrap}
      .nt-outgoing-original-copy[hidden]{display:none}
      .nt-outgoing-original-copy[hidden]+.nt-outgoing-original-toggle{margin-inline-start:8px}
      .nt-outgoing-original-toggle{align-self:baseline;flex:none;margin:0;padding:1px 0;border:0;border-radius:4px;background:transparent;color:var(--text-link,#00a8fc);font:inherit;font-size:11px;line-height:1.25;cursor:pointer;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .12s ease,background-color .12s ease}
      .nt-outgoing-original-toggle::before{content:attr(data-label)}
      li[id^="chat-messages-"]:hover .nt-outgoing-original-toggle,
      [id^="chat-messages___chat-messages-"]:hover .nt-outgoing-original-toggle,
      [data-list-item-id^="chat-messages___"]:hover .nt-outgoing-original-toggle,
      [class*="messageListItem"]:hover .nt-outgoing-original-toggle,
      [data-nt-outgoing-message-row="true"]:hover .nt-outgoing-original-toggle,
      .nt-outgoing-original-toggle:focus-visible{opacity:1;pointer-events:auto}
      .nt-outgoing-original-view[data-mode="sent"] .nt-outgoing-original-toggle{color:#f0a15c}
      .nt-outgoing-original-toggle:hover{background:var(--background-modifier-hover,#ffffff0f)}
    `;
  }
  function sentTextForMatching(root) {
    const originals = window.__nudeTranslatorOriginals;
    if (originals instanceof Map) {
      const values = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        values.push(originals.has(node) ? originals.get(node) : node.nodeValue || '');
      }
      return values.join('').replace(/\u00a0/g, ' ').trim();
    }
    return (root.innerText || root.textContent || '').replace(/\u00a0/g, ' ').trim();
  }
  function comparableMessageText(value) {
    const text = String(value || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u00a0\u200b]/g, ' ')
      .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
      .replace(/^\s{0,3}-#\s+/gm, '')
      .replace(/^\s{0,3}#{1,3}\s+/gm, '')
      .replace(/^\s{0,3}>{1,3}\s?/gm, '')
      .replace(/^\s{0,3}(?:[-+*]|\d+[.)])\s+/gm, '')
      .replace(/^[•◦▪‣]\s*/gm, '')
      .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]+\)/g, '$1')
      .replace(/\\([\\`*_{}\[\]()#+\-.!|>])/g, '$1')
      .replace(/[*_~|`]/g, '');
    return text.split('\n').map(line => line.trim()).filter(Boolean).join('\n');
  }
  function ensureView(root, record, defaultMode) {
    let view = root.nextElementSibling;
    if (view?.getAttribute('data-nt-outgoing-original-view') !== record.message_id) {
      view = document.createElement('div');
      view.className = 'nt-outgoing-original-view';
      view.setAttribute('data-nt-outgoing-original-view', record.message_id);
      view.dataset.mode = defaultMode;
      view.innerHTML = '<div class="nt-outgoing-original-copy"></div><button type="button" class="nt-outgoing-original-toggle"></button>';
      root.insertAdjacentElement('afterend', view);
    }
    messageRow(root)?.setAttribute('data-nt-outgoing-message-row', 'true');
    const button = view.querySelector('.nt-outgoing-original-toggle');
    const originalText = view.querySelector('.nt-outgoing-original-copy');
    if (originalText.dataset.text !== record.original_text) originalText.dataset.text = record.original_text;
    const showSent = view.dataset.mode !== 'original';
    root.style.display = showSent ? '' : 'none';
    originalText.hidden = showSent;
    const label = showSent ? copy('showSent') : copy('showOriginal');
    if (button.dataset.label !== label) button.dataset.label = label;
    if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
    if (button.dataset.bound !== 'true') {
      button.dataset.bound = 'true';
      button.addEventListener('click', () => {
        view.dataset.mode = view.dataset.mode === 'sent' ? 'original' : 'sent';
        const sent = view.dataset.mode === 'sent';
        root.style.display = sent ? '' : 'none';
        originalText.hidden = sent;
        const nextLabel = sent ? copy('showSent') : copy('showOriginal');
        button.dataset.label = nextLabel;
        button.setAttribute('aria-label', nextLabel);
      });
    }
  }

  let manager = window[GLOBAL];
  if (!manager || manager.version !== VERSION || manager.uiLanguage !== uiLanguage) {
    manager?.observer?.disconnect();
    document.querySelectorAll('.nt-outgoing-original-view').forEach(view => view.remove());
    manager = {
      version: VERSION,
      uiLanguage,
      translationEnabled: displayTranslationEnabled,
      records: new Map(),
      applyScheduled: false,
      register(record) {
        if (!record?.message_id || !record?.channel_key) return;
        this.records.set(recordKey(record), record);
        this.apply();
      },
      reconcileMessageIds(currentChannel, roots) {
        const used = new Set();
        const rootsById = new Map(roots.map(root => [messageId(root), root]));
        const channelRecords = [...this.records.values()]
          .filter(record => record.channel_key === currentChannel)
          .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
        for (const record of channelRecords) {
          const exact = rootsById.get(record.message_id);
          if (exact) used.add(exact);
        }
        for (const record of channelRecords) {
          if (rootsById.has(record.message_id)) continue;
          const confirmed = roots.slice().reverse().find(root => {
            if (used.has(root)) return false;
            const text = comparableMessageText(root.innerText || root.textContent || '');
            return text === comparableMessageText(record.sent_text);
          });
          if (!confirmed) continue;
          const confirmedId = messageId(confirmed);
          if (!confirmedId) continue;
          const oldKey = recordKey(record);
          const corrected = {...record, message_id:confirmedId};
          this.records.delete(oldKey);
          this.records.set(recordKey(corrected), corrected);
          used.add(confirmed);
          document.querySelector(`[data-nt-outgoing-original-view="${CSS.escape(record.message_id)}"]`)?.remove();
          const bindings = window.__nudeTranslatorOutgoing?.bindings;
          if (Array.isArray(bindings) && !bindings.some(item => item.message_id === confirmedId)) {
            bindings.push(corrected);
          }
        }
      },
      scheduleApply() {
        if (this.applyScheduled) return;
        this.applyScheduled = true;
        requestAnimationFrame(() => {
          this.applyScheduled = false;
          this.apply();
        });
      },
      apply() {
        ensureStyle();
        cleanupDetachedViews();
        const currentChannel = location.pathname.startsWith('/channels/') ? location.pathname : '';
        const roots = [...document.querySelectorAll('[id^="message-content-"]')]
          .filter(root => !root.closest('[id^="message-reply-context-"]'));
        this.reconcileMessageIds(currentChannel, roots);
        for (const root of roots) {
          const record = this.records.get(`${currentChannel}|${messageId(root)}`);
          if (!record) continue;
          if (isEditingMessage(root)) {
            detachView(root);
            continue;
          }
          const currentText = comparableMessageText(sentTextForMatching(root));
          if (currentText !== comparableMessageText(record.sent_text)) {
            detachView(root);
            continue;
          }
          root.setAttribute('data-nt-outgoing-original', 'true');
          ensureView(root, record, this.translationEnabled ? 'original' : 'sent');
        }
      },
    };
    manager.observer = new MutationObserver(() => manager.scheduleApply());
    manager.observer.observe(document.body, {childList:true, subtree:true});
    window[GLOBAL] = manager;
  }
  if (manager.translationEnabled !== displayTranslationEnabled) {
    const bulkMode = displayTranslationEnabled ? 'original' : 'sent';
    document.querySelectorAll('.nt-outgoing-original-view').forEach(view => {
      view.dataset.mode = bulkMode;
      const button = view.querySelector('.nt-outgoing-original-toggle');
      button?.blur();
    });
  }
  manager.translationEnabled = displayTranslationEnabled;
  manager.records.clear();
  for (const record of records) manager.records.set(recordKey(record), record);
  window.__nudeTranslatorRegisterOutgoingOriginal = record => manager.register(record);
  window.__nudeTranslatorApplyOutgoingOriginals = () => manager.apply();
  window.__nudeTranslatorOutgoingOriginalsReady = `${channelKey}|${requestedUiLanguage}|${displayTranslationEnabled}`;
  manager.apply();
  return manager.records.size;
})()
"####;

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct OutgoingRequest {
    pub id: String,
    pub channel_key: String,
    pub text: String,
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub send_immediately: bool,
    pub selected_language: String,
    #[serde(default)]
    pub recent_messages: Vec<String>,
}

pub fn outgoing_ui_script(
    enabled: bool,
    display_enabled: bool,
    display_language: &str,
    default_language: &str,
    ui_language: &str,
    channel_languages: &HashMap<String, String>,
    confirm_send: bool,
    send_immediately_shortcut: &str,
    review_before_send_shortcut: &str,
) -> String {
    let display_language = if is_supported_language_code(display_language) {
        display_language
    } else {
        "ko"
    };
    let default_language =
        if default_language == "auto" || is_supported_language_code(default_language) {
            default_language
        } else {
            "auto"
        };
    let ui_language = if ui_language == "auto" || is_supported_language_code(ui_language) {
        ui_language
    } else {
        "en"
    };
    let language_labels = LANGUAGE_MENU_ORDER
        .into_iter()
        .map(|language| (language.code(), language.native_name()))
        .chain(std::iter::once(("auto", "Auto")))
        .collect::<std::collections::BTreeMap<_, _>>();
    let language_english_names = LANGUAGE_MENU_ORDER
        .into_iter()
        .map(|language| (language.code(), language.english_name()))
        .chain(std::iter::once(("auto", "Automatic language detection")))
        .collect::<std::collections::BTreeMap<_, _>>();
    let compact_labels = LANGUAGE_MENU_ORDER
        .into_iter()
        .map(|language| {
            let compact = match language {
                Language::Japanese => "JP",
                Language::ChineseSimplified => "CN",
                Language::ChineseTraditional => "TW",
                Language::BrazilianPortuguese => "BR",
                Language::LatinAmericanSpanish => "ES",
                _ => language.code(),
            };
            (language.code(), compact.to_ascii_uppercase())
        })
        .chain(std::iter::once(("auto", "AU".to_string())))
        .collect::<std::collections::BTreeMap<_, _>>();
    let language_codes = LANGUAGE_MENU_ORDER
        .into_iter()
        .map(Language::code)
        .collect::<Vec<_>>();
    let localized_copies = generated_copies(&[
        ("auto", "자동 감지"),
        ("outgoingLanguage", "전송"),
        ("selectLanguage", "전송 언어 선택"),
        ("originalOnce", "이번 메시지만 원문으로 전송"),
        ("nextOriginal", "다음 메시지는 번역하지 않고 전송합니다."),
        ("selectLanguageFormal", "전송 언어를 선택하십시오."),
        ("sendingOriginal", "원문을 전송합니다."),
        ("translating", "메시지를 번역하고 있습니다."),
        (
            "detectionFailed",
            "대화 언어를 판단하지 못했습니다. 전송 언어를 선택하십시오.",
        ),
        (
            "detectedLanguage",
            "{language}로 감지했습니다. 전송 언어 메뉴에서 변경할 수 있습니다.",
        ),
        ("sendOriginal", "원문 전송"),
        (
            "translationFailed",
            "메시지를 번역하지 못했습니다. 번역하지 않고 원문을 유지합니다.",
        ),
        (
            "pending",
            "이전 메시지를 처리하고 있습니다. 잠시 후 다시 시도하십시오.",
        ),
        (
            "sendingParts",
            "번역문을 분할 전송하고 있습니다. ({part}/{total})",
        ),
        ("longAttachment", "번역문이 길어 텍스트 파일로 전송합니다."),
        (
            "reviewReady",
            "번역문을 확인하거나 수정한 뒤 Enter로 전송하십시오.",
        ),
        ("reviewHint", "번역문을 수정하거나 Enter로 전송하십시오."),
        ("realTimeOn", "번역 켜짐"),
        ("displayLanguage", "표시"),
        ("selectDisplayLanguage", "표시 언어 선택"),
        ("searchLanguages", "언어 검색"),
        ("noMatchingLanguages", "검색 결과 없음"),
    ]);
    OUTGOING_UI_SCRIPT
        .replace("__ENABLED__", if enabled { "true" } else { "false" })
        .replace(
            "__DISPLAY_ENABLED__",
            if display_enabled { "true" } else { "false" },
        )
        .replace(
            "__DISPLAY_LANGUAGE__",
            &serde_json::to_string(display_language).expect("static display language code"),
        )
        .replace(
            "__DEFAULT_LANGUAGE__",
            &serde_json::to_string(default_language).expect("static language code"),
        )
        .replace(
            "__UI_LANGUAGE__",
            &serde_json::to_string(ui_language).expect("static interface language code"),
        )
        .replace(
            "__CHANNEL_LANGUAGES__",
            &serde_json::to_string(channel_languages).expect("remembered channel languages"),
        )
        .replace(
            "__LANGUAGE_LABELS__",
            &serde_json::to_string(&language_labels).expect("static language labels"),
        )
        .replace(
            "__LANGUAGE_CODES__",
            &serde_json::to_string(&language_codes).expect("static language codes"),
        )
        .replace(
            "__LANGUAGE_ENGLISH_NAMES__",
            &serde_json::to_string(&language_english_names).expect("static English language names"),
        )
        .replace(
            "__COMPACT_LANGUAGE_LABELS__",
            &serde_json::to_string(&compact_labels).expect("static compact language labels"),
        )
        .replace(
            "__GENERATED_OUTGOING_COPIES__",
            &serde_json::to_string(&localized_copies).expect("generated outgoing interface copies"),
        )
        .replace(
            "__CONFIRM_SEND__",
            if confirm_send { "true" } else { "false" },
        )
        .replace(
            "__SEND_IMMEDIATELY_SHORTCUT__",
            &serde_json::to_string(send_immediately_shortcut).expect("configured shortcut"),
        )
        .replace(
            "__REVIEW_BEFORE_SEND_SHORTCUT__",
            &serde_json::to_string(review_before_send_shortcut).expect("configured shortcut"),
        )
}

pub fn parse_outgoing_requests(value: Value) -> Result<Vec<OutgoingRequest>, String> {
    serde_json::from_value(value)
        .map_err(|error| format!("전송 메시지 통역 요청을 읽지 못했습니다: {error}"))
}

pub fn parse_outgoing_bindings(value: Value) -> Result<Vec<OutgoingOriginalRecord>, String> {
    serde_json::from_value(value)
        .map_err(|error| format!("보낸 메시지 원문 연결 정보를 읽지 못했습니다: {error}"))
}

pub fn outgoing_originals_ui_script(
    channel_key: &str,
    records: &[OutgoingOriginalRecord],
    ui_language: &str,
    display_translation_enabled: bool,
) -> Result<String, String> {
    let channel_key = serde_json::to_string(channel_key)
        .map_err(|error| format!("Discord 채널 식별자를 인코딩하지 못했습니다: {error}"))?;
    let records = serde_json::to_string(records)
        .map_err(|error| format!("보낸 메시지 원문 목록을 인코딩하지 못했습니다: {error}"))?;
    let ui_language = if ui_language == "auto" || is_supported_language_code(ui_language) {
        ui_language
    } else {
        "en"
    };
    let localized_copies =
        generated_copies(&[("showOriginal", "원문 보기"), ("showSent", "전송문 보기")]);
    Ok(OUTGOING_ORIGINALS_UI_SCRIPT
        .replace("__VERSION__", &OUTGOING_ORIGINALS_UI_VERSION.to_string())
        .replace("__CHANNEL_KEY__", &channel_key)
        .replace("__RECORDS__", &records)
        .replace(
            "__DISPLAY_TRANSLATION_ENABLED__",
            if display_translation_enabled {
                "true"
            } else {
                "false"
            },
        )
        .replace(
            "__UI_LANGUAGE__",
            &serde_json::to_string(ui_language).expect("static interface language code"),
        )
        .replace(
            "__GENERATED_ORIGINAL_COPIES__",
            &serde_json::to_string(&localized_copies).expect("generated original-view copies"),
        ))
}

pub const OUTGOING_ORIGINALS_UI_VERSION: u64 = 20;

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

pub fn apply_outgoing_detected_script(
    request_id: &str,
    language: Language,
) -> Result<String, String> {
    let id = serde_json::to_string(request_id)
        .map_err(|error| format!("전송 요청 식별자를 인코딩하지 못했습니다: {error}"))?;
    let code = serde_json::to_string(language.code())
        .map_err(|error| format!("감지 언어를 인코딩하지 못했습니다: {error}"))?;
    Ok(format!(
        "window.__nudeTranslatorOutgoing?.detected({id},{code})"
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
        "window.__nudeTranslatorOutgoing?.prepare({id},{replace},{continuation},{final_part},{part_number},{total_parts},true) === true"
    ))
}

pub fn apply_outgoing_review_script(request_id: &str) -> Result<String, String> {
    let id = serde_json::to_string(request_id)
        .map_err(|error| format!("전송 요청 식별자를 인코딩하지 못했습니다: {error}"))?;
    Ok(format!(
        "window.__nudeTranslatorOutgoing?.prepare({id},true,false,true,1,1,false) === true"
    ))
}

pub fn finish_outgoing_review_script(request_id: &str) -> Result<String, String> {
    let id = serde_json::to_string(request_id)
        .map_err(|error| format!("전송 요청 식별자를 인코딩하지 못했습니다: {error}"))?;
    Ok(format!(
        "window.__nudeTranslatorOutgoing?.finishReview({id}) === true"
    ))
}

pub fn prepare_outgoing_reviewed_send_script(request_id: &str) -> Result<String, String> {
    let id = serde_json::to_string(request_id)
        .map_err(|error| format!("전송 요청 식별자를 인코딩하지 못했습니다: {error}"))?;
    Ok(format!(
        "window.__nudeTranslatorOutgoing?.prepareReviewed({id}) === true"
    ))
}

pub fn capture_outgoing_send_script(request_id: &str) -> Result<String, String> {
    let id = serde_json::to_string(request_id)
        .map_err(|error| format!("전송 요청 식별자를 인코딩하지 못했습니다: {error}"))?;
    Ok(format!(
        "window.__nudeTranslatorOutgoing?.captureSend({id}) === true"
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
    use std::collections::HashMap;
    use std::sync::{Mutex, MutexGuard};
    use std::thread;
    use std::time::Duration;

    use serde_json::json;

    use super::{
        apply_outgoing_suggestion_script, attach_outgoing_text_file_script,
        finish_outgoing_review_script, outgoing_originals_ui_script, outgoing_ui_script,
        parse_outgoing_bindings, parse_outgoing_requests, prepare_outgoing_attachment_script,
        prepare_outgoing_reviewed_send_script, prepare_outgoing_send_script,
        suggest_recent_language, OUTGOING_BINDINGS_SCRIPT, OUTGOING_CLEANUP_SCRIPT,
    };
    use crate::cache::OutgoingOriginalRecord;
    use crate::cdp::{discord_target, CdpClient};
    use crate::config::ConfigStore;
    use crate::dom::INSTALL_TEXT_RESTORE_SCRIPT;
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
    fn outgoing_controller_releases_discord_when_the_app_heartbeat_stops() {
        let script = outgoing_ui_script(
            true,
            true,
            "ko",
            "auto",
            "ko",
            &HashMap::new(),
            true,
            "Ctrl+Enter",
            "Alt+Enter",
        );

        assert!(script.contains("lastHeartbeat"));
        assert!(script.contains("watchdogTimer"));
        assert!(script.contains("Date.now() - this.lastHeartbeat"));
        assert!(script.contains("__nudeTranslatorRestoreTranslatedText?.()"));
        assert!(script.contains("document.removeEventListener('keydown', this.listener, true)"));
        assert!(OUTGOING_CLEANUP_SCRIPT.contains("clearInterval(controller.watchdogTimer)"));
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
        assert!(!requests[0].send_immediately);
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
        assert!(script.contains("prepare(\"outgoing-1\",true,true,false,2,3,true)"));
        assert!(prepare_outgoing_reviewed_send_script("outgoing-1")
            .unwrap()
            .contains("prepareReviewed"));
    }

    #[test]
    fn injected_outgoing_controls_receive_the_selected_interface_language() {
        let channel_languages = HashMap::from([("/channels/1/2".to_string(), "ja".to_string())]);
        let script = outgoing_ui_script(
            true,
            true,
            "ko",
            "auto",
            "ja",
            &channel_languages,
            true,
            "Ctrl+Shift+Enter",
            "Alt+J",
        );
        assert!(script.contains("const requestedUiLanguage = \"ja\""));
        assert!(script.contains("const displayEnabled = true"));
        assert!(script.contains("const displayLanguage = \"ko\""));
        assert!(script.contains("action:'display-language'"));
        assert!(script.contains("const sendImmediatelyShortcut = \"Ctrl+Shift+Enter\""));
        assert!(script.contains("const reviewBeforeSendShortcut = \"Alt+J\""));
        assert!(script.contains("\"/channels/1/2\":\"ja\""));
        assert!(script.contains("送信言語"));
        assert!(!script.contains("__UI_LANGUAGE__"));
        assert!(!script.contains("__SEND_IMMEDIATELY_SHORTCUT__"));
        assert!(!script.contains("__REVIEW_BEFORE_SEND_SHORTCUT__"));
        assert!(!script.contains("__CHANNEL_LANGUAGES__"));
        assert!(!script.contains("__DISPLAY_ENABLED__"));
        assert!(!script.contains("__DISPLAY_LANGUAGE__"));

        let arabic = outgoing_ui_script(
            true,
            true,
            "ko",
            "auto",
            "ar",
            &HashMap::new(),
            true,
            "Ctrl+Enter",
            "Alt+Enter",
        );
        assert!(arabic.contains("const requestedUiLanguage = \"ar\""));
        assert!(arabic.contains("\"ar\":{"));
        assert!(arabic.contains("nt-language-search"));
        assert!(arabic.contains("text-align:left"));
        assert!(arabic.contains("button.dir = 'ltr'"));
        assert!(arabic.contains("label.dir = 'auto'"));
        assert!(arabic.contains("max-height:min(58vh,500px)"));
        assert!(arabic.contains("scrollbar-width:none"));
        assert!(arabic.contains("nt-menu-scroll-indicator"));
        assert!(arabic.contains("MENU_SCROLL_REVEAL_DISTANCE"));
        assert!(!arabic.contains("::-webkit-scrollbar-thumb"));
        assert!(arabic.contains("controller.pointerDownListener"));
        assert!(arabic.contains(
            "document.addEventListener('pointerdown', controller.pointerDownListener, true)"
        ));
        assert!(!arabic.contains("__GENERATED_OUTGOING_COPIES__"));
        assert!(!arabic.contains("__LANGUAGE_ENGLISH_NAMES__"));

        let originals = outgoing_originals_ui_script("/channels/1/2", &[], "en", true).unwrap();
        assert!(originals.contains("const requestedUiLanguage = \"en\""));
        assert!(!originals.contains("__GENERATED_ORIGINAL_COPIES__"));
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
        let script = outgoing_originals_ui_script("/channels/1/2", &records, "ko", true).unwrap();

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
        assert!(!script.contains("nt-outgoing-original-label"));
        assert!(script.contains("data-nt-outgoing-original"));
        assert!(OUTGOING_BINDINGS_SCRIPT.contains("bindings"));
    }

    #[test]
    fn outgoing_original_matching_uses_discord_markdown_equivalence() {
        let controller = outgoing_ui_script(
            true,
            true,
            "ko",
            "ja",
            "ko",
            &HashMap::new(),
            true,
            "Ctrl+Enter",
            "Alt+Enter",
        );
        let originals = outgoing_originals_ui_script("/channels/1/2", &[], "ko", true).unwrap();

        assert!(controller.contains("function comparableMessageText(value)"));
        assert!(controller.contains(
            "comparableMessageText(originalText(candidate)) === comparableMessageText(item.sent_text)"
        ));
        assert!(originals.contains("function comparableMessageText(value)"));
        assert!(originals
            .contains("const currentText = comparableMessageText(sentTextForMatching(root))"));
        assert!(!originals.contains("node.nodeValue = originals.get(node)"));
        assert!(originals.contains("comparableMessageText(record.sent_text)"));
    }

    #[test]
    fn outgoing_original_display_tracks_display_translation_state() {
        let script = outgoing_originals_ui_script("/channels/1/2", &[], "ko", true).unwrap();

        assert!(script.contains("const displayTranslationEnabled"));
        assert!(script.contains("manager.translationEnabled !== displayTranslationEnabled"));
        assert!(script.contains("view.dataset.mode = bulkMode"));
        assert!(script.contains("const bulkMode = displayTranslationEnabled ? 'original' : 'sent'"));
        assert!(script.contains("this.translationEnabled ? 'original' : 'sent'"));
        assert!(script.contains("opacity:0;pointer-events:none"));
        assert!(script.contains("function messageRow(root)"));
        assert!(script.contains("data-nt-outgoing-message-row"));
        assert!(script.contains(
            "[data-nt-outgoing-message-row=\"true\"]:hover .nt-outgoing-original-toggle"
        ));
        assert!(script.contains(
            "[data-list-item-id^=\"chat-messages___\"]:hover .nt-outgoing-original-toggle"
        ));
        assert!(script.contains(".nt-outgoing-original-toggle:focus-visible"));
        assert!(script.contains("button?.blur()"));
        assert!(script.contains("const label = showSent ? copy('showSent') : copy('showOriginal')"));
        assert!(script.contains("button.dataset.label = nextLabel"));
        assert!(script.contains("button.setAttribute('aria-label', nextLabel)"));
        assert!(script.contains(".nt-outgoing-original-toggle::before{content:attr(data-label)}"));
        assert!(script.contains(".nt-outgoing-original-copy::before{content:attr(data-text)"));
    }

    #[test]
    fn outgoing_original_display_detaches_while_a_message_is_being_edited() {
        let script = outgoing_originals_ui_script("/channels/1/2", &[], "ko", true).unwrap();

        assert!(script.contains("function isEditingMessage(root)"));
        assert!(script.contains("[role=\"textbox\"][contenteditable=\"true\"]"));
        assert!(script.contains("function detachView(root)"));
        assert!(script.contains("if (isEditingMessage(root))"));
        assert!(script.contains("cleanupDetachedViews()"));
        assert!(script.contains("if (currentText !== comparableMessageText(record.sent_text))"));
        let destructive_replacement = ["root.textContent", " = record.sent_text"].concat();
        assert!(!script.contains(&destructive_replacement));
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러가 필요합니다"]
    fn live_discord_outgoing_original_survives_edit_cancel_without_entering_message_text() {
        let _guard = lock_live_outgoing();
        let target = discord_target(9222).expect("Discord channel target");
        let mut client = CdpClient::new(target.websocket_url);
        let channel = client
            .evaluate(
                "location.pathname.startsWith('/channels/') ? location.pathname : ''",
                false,
            )
            .expect("current Discord channel")
            .as_str()
            .expect("channel path")
            .to_string();
        let records = vec![OutgoingOriginalRecord {
            message_id: "nt-edit-cancel-message".to_string(),
            channel_key: channel.clone(),
            original_text: "편집 취소 원문".to_string(),
            sent_text: "編集キャンセル送信文".to_string(),
            part_number: 1,
            total_parts: 1,
            created_at: 0.0,
        }];
        client
            .evaluate(
                "document.getElementById('nt-outgoing-edit-cancel-test')?.remove(); window.__nudeTranslatorOutgoingOriginalDisplay?.observer?.disconnect(); delete window.__nudeTranslatorOutgoingOriginalDisplay; delete window.__nudeTranslatorOutgoingOriginalsReady",
                false,
            )
            .expect("reset outgoing edit probe");
        client
            .evaluate(
                "(() => { const row=document.createElement('div'); row.id='nt-outgoing-edit-cancel-test'; row.setAttribute('role','listitem'); const root=document.createElement('div'); root.id='message-content-nt-edit-cancel-message'; root.textContent='編集キャンセル送信文'; row.append(root); document.body.append(row); return true; })()",
                false,
            )
            .expect("mount outgoing edit probe");
        client
            .evaluate(
                &outgoing_originals_ui_script(&channel, &records, "ko", true).unwrap(),
                false,
            )
            .expect("mount outgoing original view");
        let result = client
            .evaluate(
                r#"(() => {
                  const row = document.getElementById('nt-outgoing-edit-cancel-test');
                  const root = document.getElementById('message-content-nt-edit-cancel-message');
                  const mounted = Boolean(root.nextElementSibling?.classList.contains('nt-outgoing-original-view'));
                  const uncontaminated = row.textContent.trim() === '編集キャンセル送信文';
                  const editor = document.createElement('div');
                  editor.setAttribute('role', 'textbox');
                  editor.setAttribute('contenteditable', 'true');
                  editor.textContent = '編集キャンセル送信文';
                  row.append(editor);
                  window.__nudeTranslatorApplyOutgoingOriginals?.();
                  const detachedWhileEditing = !row.querySelector('.nt-outgoing-original-view');
                  editor.remove();
                  window.__nudeTranslatorApplyOutgoingOriginals?.();
                  const restoredAfterCancel = Boolean(root.nextElementSibling?.classList.contains('nt-outgoing-original-view'));
                  const cleanAfterCancel = row.textContent.trim() === '編集キャンセル送信文';
                  root.textContent = '編集後の送信文';
                  window.__nudeTranslatorApplyOutgoingOriginals?.();
                  const detachedAfterSave = !row.querySelector('.nt-outgoing-original-view');
                  return {mounted,uncontaminated,detachedWhileEditing,restoredAfterCancel,cleanAfterCancel,detachedAfterSave,text:row.textContent.trim()};
                })()"#,
                true,
            )
            .expect("exercise outgoing edit lifecycle");
        client
            .evaluate(
                "document.getElementById('nt-outgoing-edit-cancel-test')?.remove(); window.__nudeTranslatorOutgoingOriginalDisplay?.observer?.disconnect(); delete window.__nudeTranslatorOutgoingOriginalDisplay; delete window.__nudeTranslatorOutgoingOriginalsReady",
                false,
            )
            .expect("remove outgoing edit probe");

        assert_eq!(result["mounted"].as_bool(), Some(true), "state: {result}");
        assert_eq!(
            result["uncontaminated"].as_bool(),
            Some(true),
            "state: {result}"
        );
        assert_eq!(
            result["detachedWhileEditing"].as_bool(),
            Some(true),
            "state: {result}"
        );
        assert_eq!(
            result["restoredAfterCancel"].as_bool(),
            Some(true),
            "state: {result}"
        );
        assert_eq!(
            result["cleanAfterCancel"].as_bool(),
            Some(true),
            "state: {result}"
        );
        assert_eq!(
            result["detachedAfterSave"].as_bool(),
            Some(true),
            "state: {result}"
        );
        assert_eq!(result["text"].as_str(), Some("編集後の送信文"));
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러와 전송 메시지가 필요합니다"]
    fn live_discord_outgoing_view_toggle_only_appears_on_message_hover() {
        let _guard = lock_live_outgoing();
        let target = discord_target(9222).expect("Discord channel target");
        let mut client = CdpClient::new(target.websocket_url);
        client
            .call(
                "Input.dispatchMouseEvent",
                json!({"type":"mouseMoved","x":1,"y":1}),
            )
            .expect("move pointer away from messages");
        thread::sleep(Duration::from_millis(180));

        let before = client
            .evaluate(
                "(() => { const selector='[data-list-item-id^=\"chat-messages___\"], [id^=\"chat-messages___chat-messages-\"], li[id^=\"chat-messages-\"], [class*=\"messageListItem\"]';const candidates=[...document.querySelectorAll(selector)].map(row=>{const rect=row.getBoundingClientRect();const button=row.querySelector('.nt-outgoing-original-toggle');return {row,rect,button};}).filter(item=>item.button&&item.rect.width>0&&item.rect.height>0&&item.rect.top>=0&&item.rect.bottom<=innerHeight&&item.rect.left>=0&&item.rect.right<=innerWidth);for(const item of candidates){const x=item.rect.right-Math.min(40,item.rect.width/2),y=item.rect.top+item.rect.height/2;const hit=document.elementFromPoint(x,y);if(hit&&(hit===item.row||item.row.contains(hit))){const style=getComputedStyle(item.button);return {x,y,opacity:style.opacity,pointerEvents:style.pointerEvents,rowId:item.row.id||item.row.getAttribute('data-list-item-id')||''};}}return null;})()",
                true,
            )
            .expect("hidden outgoing toggle state");
        if before.is_null() {
            let diagnostics = client
                .evaluate(
                    "(() => ({viewport:{width:innerWidth,height:innerHeight},views:[...document.querySelectorAll('.nt-outgoing-original-view')].slice(0,3).map(view=>{const chain=[];for(let node=view;node&&chain.length<8;node=node.parentElement){const r=node.getBoundingClientRect();chain.push({tag:node.tagName,id:node.id,className:String(node.className),role:node.getAttribute('role'),listId:node.getAttribute('data-list-item-id'),rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}});}return chain;})}))()",
                    true,
                )
                .expect("outgoing row diagnostics");
            panic!("no visible outgoing message row: {diagnostics}");
        }
        assert_eq!(before["opacity"].as_str(), Some("0"), "state: {before}");
        assert_eq!(
            before["pointerEvents"].as_str(),
            Some("none"),
            "state: {before}"
        );
        eprintln!("outgoing hover target: {before}");

        client
            .call(
                "Input.dispatchMouseEvent",
                json!({
                    "type":"mouseMoved",
                    "x":before["x"].as_f64().expect("message x"),
                    "y":before["y"].as_f64().expect("message y")
                }),
            )
            .expect("hover outgoing message");
        thread::sleep(Duration::from_millis(180));
        let hovered = client
            .evaluate(
                "(() => { const selector='[data-list-item-id^=\"chat-messages___\"], [id^=\"chat-messages___chat-messages-\"], li[id^=\"chat-messages-\"], [class*=\"messageListItem\"]';const row=[...document.querySelectorAll(selector)].find(row=>row.matches(':hover')&&row.querySelector('.nt-outgoing-original-toggle'));const button=row?.querySelector('.nt-outgoing-original-toggle');if(!button)return null;const style=getComputedStyle(button);return {opacity:style.opacity,pointerEvents:style.pointerEvents,rowId:row.id||row.getAttribute('data-list-item-id')||''};})()",
                true,
            )
            .expect("hovered outgoing toggle state");
        let opacity = hovered["opacity"]
            .as_str()
            .and_then(|value| value.parse::<f64>().ok())
            .unwrap_or_default();
        assert!(opacity > 0.9, "state: {hovered}");
        assert_eq!(
            hovered["pointerEvents"].as_str(),
            Some("auto"),
            "state: {hovered}"
        );
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러가 필요합니다"]
    fn live_discord_outgoing_original_follows_optimistic_message_id_replacement() {
        let _guard = lock_live_outgoing();
        let target = discord_target(9222).expect("Discord channel target");
        let mut client = CdpClient::new(target.websocket_url);
        let channel = client
            .evaluate(
                "location.pathname.startsWith('/channels/') ? location.pathname : ''",
                false,
            )
            .expect("current Discord channel")
            .as_str()
            .expect("channel path")
            .to_string();
        let records = vec![OutgoingOriginalRecord {
            message_id: "nt-optimistic-message".to_string(),
            channel_key: channel.clone(),
            original_text: "임시 ID 원문".to_string(),
            sent_text: "一時 ID の送信文".to_string(),
            part_number: 1,
            total_parts: 1,
            created_at: 0.0,
        }];
        client
            .evaluate(
                "document.querySelectorAll('[data-nt-id-replacement-test]').forEach(node => node.remove()); document.getElementById('nt-outgoing-original-style')?.remove(); window.__nudeTranslatorOutgoingOriginalDisplay?.observer?.disconnect(); delete window.__nudeTranslatorOutgoingOriginalDisplay; delete window.__nudeTranslatorOutgoingOriginalsReady",
                false,
            )
            .expect("reset outgoing original display probe");
        client
            .evaluate(
                "(() => { const host=document.createElement('div'); host.setAttribute('data-nt-id-replacement-test','host'); const root=document.createElement('div'); root.id='message-content-nt-optimistic-message'; root.textContent='一時 ID の送信文'; host.append(root); document.body.append(host); return true; })()",
                false,
            )
            .expect("mount optimistic message");
        client
            .evaluate(
                &outgoing_originals_ui_script(&channel, &records, "ko", true).unwrap(),
                false,
            )
            .expect("mount outgoing original on optimistic message");
        let result = client
            .evaluate(
                "(() => { const old=document.getElementById('message-content-nt-optimistic-message'); const confirmed=document.createElement('div'); confirmed.id='message-content-nt-confirmed-message'; confirmed.textContent='一時 ID の送信文'; old.replaceWith(confirmed); window.__nudeTranslatorApplyOutgoingOriginals?.(); const manager=window.__nudeTranslatorOutgoingOriginalDisplay; const view=confirmed.nextElementSibling; const button=view?.querySelector('.nt-outgoing-original-toggle'); const copy=view?.querySelector('.nt-outgoing-original-copy'); const overlaps=(a,b)=>{const x=a?.getBoundingClientRect(),y=b?.getBoundingClientRect();return Boolean(x&&y&&Math.min(x.bottom,y.bottom)>Math.max(x.top,y.top));}; const sentInline=overlaps(confirmed,button); const sentCopyHidden=Boolean(copy&&getComputedStyle(copy).display==='none'); button?.click(); const originalInline=overlaps(copy,button); return {viewId:view?.getAttribute('data-nt-outgoing-original-view')||'',marked:confirmed.getAttribute('data-nt-outgoing-original')||'',hasConfirmed:manager?.records?.has(`${location.pathname}|nt-confirmed-message`)||false,hasOptimistic:manager?.records?.has(`${location.pathname}|nt-optimistic-message`)||false,originalInline,sentInline,sentCopyHidden}; })()",
                true,
            )
            .expect("reconcile confirmed message ID");
        client
            .evaluate(
                "document.querySelectorAll('[data-nt-id-replacement-test]').forEach(node => node.remove()); document.getElementById('nt-outgoing-original-style')?.remove(); window.__nudeTranslatorOutgoingOriginalDisplay?.observer?.disconnect(); delete window.__nudeTranslatorOutgoingOriginalDisplay; delete window.__nudeTranslatorOutgoingOriginalsReady",
                false,
            )
            .expect("remove ID replacement probe");
        assert_eq!(result["viewId"].as_str(), Some("nt-confirmed-message"));
        assert_eq!(result["marked"].as_str(), Some("true"));
        assert_eq!(result["hasConfirmed"].as_bool(), Some(true));
        assert_eq!(result["hasOptimistic"].as_bool(), Some(false));
        assert_eq!(result["originalInline"].as_bool(), Some(true));
        assert_eq!(result["sentInline"].as_bool(), Some(true));
        assert_eq!(result["sentCopyHidden"].as_bool(), Some(true));
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러가 필요합니다"]
    fn live_discord_programmatic_review_insertion_keeps_enter_send_state() {
        let _guard = lock_live_outgoing();
        let target = discord_target(9222).expect("Discord channel target");
        let mut client = CdpClient::new(target.websocket_url);
        let controller = outgoing_ui_script(
            true,
            false,
            "ko",
            "ja",
            "ko",
            &HashMap::new(),
            true,
            "Ctrl+Enter",
            "Alt+Enter",
        );
        let prepared = client
            .evaluate(
                &format!(
                    r#"(() => {{
                      ({controller});
                      const active = window.__nudeTranslatorOutgoing;
                      const editor = document.createElement('div');
                      editor.id = 'nt-outgoing-review-insertion-test';
                      editor.setAttribute('role', 'textbox');
                      editor.setAttribute('contenteditable', 'true');
                      editor.textContent = '원문';
                      document.body.append(editor);
                      active.pending.set('review-insertion', {{
                        id:'review-insertion', editor, original_text:'원문', text:'원문',
                        channel_key:location.pathname, selected_language:'ja', created_at:Date.now()
                      }});
                      return active.prepare('review-insertion', true, false, true, 1, 1, false);
                    }})()"#
                ),
                true,
            )
            .expect("prepare review insertion");
        assert_eq!(prepared.as_bool(), Some(true));
        client
            .call("Input.insertText", json!({"text": "翻訳文"}))
            .expect("insert translated review text");
        let finished = client
            .evaluate(
                &finish_outgoing_review_script("review-insertion").unwrap(),
                true,
            )
            .expect("finish review insertion");
        assert_eq!(finished.as_bool(), Some(true));
        let result = client
            .evaluate(
                r#"(() => {
                  const active = window.__nudeTranslatorOutgoing;
                  const editor = document.getElementById('nt-outgoing-review-insertion-test');
                  const item = active.pending.get('review-insertion');
                  const event = {
                    key:'Enter', ctrlKey:false, altKey:false, shiftKey:false, metaKey:false,
                    isComposing:false, target:editor,
                    preventDefault(){this.prevented=true;}, stopImmediatePropagation(){}
                  };
                  active.keydown(event);
                  const request = active.queue.at(-1) || null;
                  return {pending:Boolean(item),reviewReady:Boolean(item?.review_ready),request};
                })()"#,
                true,
            )
            .expect("read review insertion state");
        client
            .evaluate(
                "document.getElementById('nt-outgoing-review-insertion-test')?.remove()",
                false,
            )
            .expect("remove review insertion probe");
        client
            .evaluate(OUTGOING_CLEANUP_SCRIPT, false)
            .expect("cleanup controller");
        assert_eq!(result["pending"].as_bool(), Some(true));
        assert_eq!(result["reviewReady"].as_bool(), Some(true));
        assert_eq!(result["request"]["action"].as_str(), Some("send-reviewed"));
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러가 필요합니다"]
    fn live_discord_send_tracking_survives_composer_clear_before_controller_listener() {
        let _guard = lock_live_outgoing();
        let target = discord_target(9222).expect("Discord channel target");
        let mut client = CdpClient::new(target.websocket_url);
        let controller = outgoing_ui_script(
            true,
            false,
            "ko",
            "ja",
            "ko",
            &HashMap::new(),
            true,
            "Ctrl+Enter",
            "Alt+Enter",
        );
        let result = client
            .evaluate(
                &format!(
                    r#"(() => {{
                      ({controller});
                      const active = window.__nudeTranslatorOutgoing;
                      const editor = document.createElement('div');
                      editor.id = 'nt-outgoing-cleared-before-listener-test';
                      editor.setAttribute('role', 'textbox');
                      editor.setAttribute('contenteditable', 'true');
                      editor.textContent = '送信文';
                      document.body.append(editor);
                      active.pending.set('cleared-before-listener', {{
                        id:'cleared-before-listener', editor, review_ready:true,
                        original_text:'원문', text:'送信文', channel_key:location.pathname,
                        selected_language:'ja', created_at:Date.now()
                      }});
                      const prepared = active.prepareReviewed('cleared-before-listener');
                      const captured = active.captureSend('cleared-before-listener');
                      editor.textContent = '';
                      const event = {{
                        key:'Enter', ctrlKey:false, altKey:false, shiftKey:false, metaKey:false,
                        isComposing:false, target:editor
                      }};
                      active.keydown(event);
                      const tracked = active.sent.at(-1) || null;
                      const message = document.createElement('div');
                      message.id = 'message-content-nt-synthetic-tracked';
                      message.textContent = '送信文';
                      document.body.append(message);
                      active.reconcileSent();
                      const binding = active.bindings.at(-1) || null;
                      message.remove();
                      editor.remove();
                      return {{prepared,captured,tracked,binding}};
                    }})()"#
                ),
                true,
            )
            .expect("composer clear tracking probe");
        client
            .evaluate(OUTGOING_CLEANUP_SCRIPT, false)
            .expect("cleanup controller");
        assert_eq!(result["prepared"].as_bool(), Some(true));
        assert_eq!(result["captured"].as_bool(), Some(true));
        assert_eq!(result["tracked"]["original_text"].as_str(), Some("원문"));
        assert_eq!(result["tracked"]["sent_text"].as_str(), Some("送信文"));
        assert_eq!(result["binding"]["original_text"].as_str(), Some("원문"));
        assert_eq!(result["binding"]["sent_text"].as_str(), Some("送信文"));
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러가 필요합니다"]
    fn live_discord_composer_shortcuts_work_during_ime_composition() {
        let _guard = lock_live_outgoing();
        let target = discord_target(9222).expect("Discord channel target");
        let mut client = CdpClient::new(target.websocket_url);
        let controller = outgoing_ui_script(
            true,
            true,
            "ko",
            "ja",
            "ko",
            &HashMap::new(),
            false,
            "Ctrl+Enter",
            "Alt+Enter",
        );
        let probe = format!(
            r#"(() => {{
              ({controller});
              const active = window.__nudeTranslatorOutgoing;
              const editor = document.createElement('div');
              editor.setAttribute('role', 'textbox');
              editor.setAttribute('contenteditable', 'true');
              document.body.append(editor);
              const results = [];
              for (const modifiers of [{{ctrlKey:true,altKey:false}},{{ctrlKey:false,altKey:true}}]) {{
                active.queue.length = 0;
                active.pending.clear();
                editor.textContent = '한';
                const event = {{
                  key:'Enter', ctrlKey:modifiers.ctrlKey, altKey:modifiers.altKey,
                  shiftKey:false, metaKey:false, isComposing:true, target:editor,
                  preventDefault(){{this.prevented=true;}}, stopImmediatePropagation(){{}}
                }};
                active.keydown(event);
                results.push({{prevented:Boolean(event.prevented),request:active.queue[0] || null}});
              }}
              active.queue.length = 0;
              active.pending.clear();
              editor.textContent = '確認した翻訳文';
              active.pending.set('review-enter', {{editor,review_ready:true,original_text:'원문',text:'確認した翻訳文'}});
              const reviewedEvent = {{
                key:'Enter', ctrlKey:false, altKey:false, shiftKey:false, metaKey:false,
                isComposing:false, target:editor,
                preventDefault(){{this.prevented=true;}}, stopImmediatePropagation(){{}}
              }};
              active.keydown(reviewedEvent);
              results.push({{prevented:Boolean(reviewedEvent.prevented),request:active.queue[0] || null}});
              active.queue.length = 0;
              active.pending.clear();
              editor.remove();
              return results;
            }})()"#
        );
        let results = client.evaluate(&probe, true).expect("IME shortcut probe");
        assert_eq!(results[0]["prevented"].as_bool(), Some(true));
        assert_eq!(
            results[0]["request"]["send_immediately"].as_bool(),
            Some(true)
        );
        assert_eq!(results[1]["prevented"].as_bool(), Some(true));
        assert_eq!(
            results[1]["request"]["send_immediately"].as_bool(),
            Some(false)
        );
        assert_eq!(results[2]["prevented"].as_bool(), Some(true));
        assert_eq!(
            results[2]["request"]["action"].as_str(),
            Some("send-reviewed")
        );
        assert_eq!(
            results[2]["request"]["send_immediately"].as_bool(),
            Some(true)
        );
        client
            .evaluate(OUTGOING_CLEANUP_SCRIPT, false)
            .expect("cleanup controller");
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러가 필요합니다"]
    fn live_discord_cleared_review_is_translated_as_a_new_message() {
        let _guard = lock_live_outgoing();
        let target = discord_target(9222).expect("Discord channel target");
        let mut client = CdpClient::new(target.websocket_url);
        let controller = outgoing_ui_script(
            true,
            true,
            "ko",
            "ja",
            "ko",
            &HashMap::new(),
            true,
            "Ctrl+Enter",
            "Alt+Enter",
        );
        let probe = format!(
            r#"(() => {{
              ({controller});
              const active = window.__nudeTranslatorOutgoing;
              const editor = document.createElement('div');
              editor.setAttribute('role', 'textbox');
              editor.setAttribute('contenteditable', 'true');
              document.body.append(editor);
              editor.textContent = '기존 번역문';
              active.pending.set('review-cleared', {{
                id:'review-cleared', editor, review_ready:true,
                original_text:'기존 원문', text:'기존 번역문',
                channel_key:location.pathname, selected_language:'ja', created_at:Date.now()
              }});

              editor.textContent = '';
              const inputEvent = new Event('input', {{bubbles:true}});
              Object.defineProperty(inputEvent, 'inputType', {{value:'deleteContentBackward'}});
              editor.dispatchEvent(inputEvent);

              editor.textContent = '새로 번역할 원문';
              const event = {{
                key:'Enter', ctrlKey:false, altKey:false, shiftKey:false, metaKey:false,
                isComposing:false, target:editor,
                preventDefault(){{this.prevented=true;}}, stopImmediatePropagation(){{}}
              }};
              active.keydown(event);
              const result = {{
                reviewStillPending:active.pending.has('review-cleared'),
                prevented:Boolean(event.prevented), request:active.queue.at(-1) || null
              }};
              active.queue.length = 0;
              active.pending.clear();
              editor.remove();
              return result;
            }})()"#
        );
        let result = client.evaluate(&probe, true).expect("cleared review probe");
        assert_eq!(result["reviewStillPending"].as_bool(), Some(false));
        assert_eq!(result["prevented"].as_bool(), Some(true));
        assert_eq!(result["request"]["action"].as_str(), Some("translate"));
        assert_eq!(result["request"]["text"].as_str(), Some("새로 번역할 원문"));
        client
            .evaluate(OUTGOING_CLEANUP_SCRIPT, false)
            .expect("cleanup controller");
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러가 필요하며 실제 입력창이 비어 있어야 합니다"]
    fn live_discord_actual_composer_ctrl_a_backspace_starts_new_translation() {
        let _guard = lock_live_outgoing();
        let target = discord_target(9222).expect("Discord channel target");
        let mut client = CdpClient::new(target.websocket_url);
        let controller = outgoing_ui_script(
            true,
            true,
            "ko",
            "ja",
            "ko",
            &HashMap::new(),
            true,
            "Ctrl+Enter",
            "Alt+Enter",
        );
        let prepared = client
            .evaluate(
                &format!(
                    r#"(() => {{
                      ({controller});
                      if (window.__ntBackspaceCapture) {{
                        document.removeEventListener('beforeinput', window.__ntBackspaceCapture, true);
                        document.removeEventListener('input', window.__ntBackspaceCapture, true);
                      }}
                      window.__nudeTranslatorOutgoing.queue.length = 0;
                      window.__nudeTranslatorOutgoing.pending.clear();
                      const editors = [...document.querySelectorAll('[role="textbox"][contenteditable="true"], [contenteditable="true"][data-slate-editor="true"]')]
                        .filter(editor => {{
                          const bounds = editor.getBoundingClientRect();
                          return bounds.width > 120 && bounds.height > 24 && bounds.top > innerHeight * 0.4 && bounds.bottom <= innerHeight + 1;
                        }})
                        .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);
                      const editor = editors.at(-1);
                      let text = (editor?.innerText || editor?.textContent || '').trim();
                      if (editor && ['ABCDE','새로 번역할 원문'].includes(text)) {{
                        editor.focus();
                        const staleRange = document.createRange();
                        staleRange.selectNodeContents(editor);
                        const staleSelection = getSelection();
                        staleSelection.removeAllRanges();
                        staleSelection.addRange(staleRange);
                        document.execCommand('delete', false);
                        text = (editor.innerText || editor.textContent || '').trim();
                      }}
                      if (!editor || text) return {{ready:false,text}};
                      window.__ntBackspaceEditor = editor;
                      window.__ntBackspaceEvents = [];
                      window.__ntBackspaceCapture = event => {{
                        if (event.target !== editor) return;
                        window.__ntBackspaceEvents.push({{
                          phase:event.type, inputType:event.inputType || '',
                          text:(editor.innerText || editor.textContent || '').trim()
                        }});
                      }};
                      document.addEventListener('beforeinput', window.__ntBackspaceCapture, true);
                      document.addEventListener('input', window.__ntBackspaceCapture, true);
                      editor.focus();
                      return {{ready:true,text:''}};
                    }})()"#
                ),
                true,
            )
            .expect("prepare actual Discord composer probe");
        assert_eq!(
            prepared["ready"].as_bool(),
            Some(true),
            "actual Discord composer must be empty before the probe: {prepared}"
        );
        client
            .call("Input.insertText", json!({"text": "ABCDE"}))
            .expect("insert reviewed text into the actual composer");
        client
            .evaluate(
                "window.__nudeTranslatorOutgoing.pending.set('review-backspaced',{id:'review-backspaced',editor:window.__ntBackspaceEditor,review_ready:true,original_text:'기존 원문',text:'ABCDE',channel_key:location.pathname,selected_language:'ja',created_at:Date.now()})",
                false,
            )
            .expect("mark actual composer as review ready");
        for event_type in ["rawKeyDown", "keyUp"] {
            client
                .call(
                    "Input.dispatchKeyEvent",
                    json!({
                        "type": event_type,
                        "key": "a",
                        "code": "KeyA",
                        "modifiers": 2,
                        "windowsVirtualKeyCode": 65,
                        "nativeVirtualKeyCode": 65
                    }),
                )
                .expect("select all reviewed text in the actual composer");
        }
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
                .expect("backspace all reviewed text in the actual composer");
        }
        client
            .call("Input.insertText", json!({"text": "새로 번역할 원문"}))
            .expect("insert a new source message into the actual composer");
        let result = client
            .evaluate(
                r#"(() => {
                  const active = window.__nudeTranslatorOutgoing;
                  const editor = window.__ntBackspaceEditor;
                  const event = {
                    key:'Enter', ctrlKey:false, altKey:false, shiftKey:false, metaKey:false,
                    isComposing:false, target:editor,
                    preventDefault(){this.prevented=true;}, stopImmediatePropagation(){}
                  };
                  active.keydown(event);
                  const queued = active.queue.at(-1);
                  return {
                    reviewStillPending:active.pending.has('review-backspaced'),
                    prevented:Boolean(event.prevented),
                    request:queued ? {action:queued.action,text:queued.text,send_immediately:queued.send_immediately} : null,
                    events:window.__ntBackspaceEvents,
                    text:(editor.innerText || editor.textContent || '').trim()
                  };
                })()"#,
                true,
            )
            .expect("read actual backspace result");
        client
            .evaluate(
                "(() => { document.removeEventListener('beforeinput',window.__ntBackspaceCapture,true);document.removeEventListener('input',window.__ntBackspaceCapture,true);window.__nudeTranslatorOutgoing.queue.length=0;window.__nudeTranslatorOutgoing.pending.clear();const editor=window.__ntBackspaceEditor;editor.focus();const range=document.createRange();range.selectNodeContents(editor);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);delete window.__ntBackspaceCapture;delete window.__ntBackspaceEvents;delete window.__ntBackspaceEditor; })()",
                false,
            )
            .expect("prepare actual composer cleanup");
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
                .expect("clear actual composer probe text");
        }
        client
            .evaluate(OUTGOING_CLEANUP_SCRIPT, false)
            .expect("cleanup controller");
        assert_eq!(
            result["reviewStillPending"].as_bool(),
            Some(false),
            "actual backspace events: {}",
            result["events"]
        );
        assert_eq!(result["prevented"].as_bool(), Some(true));
        assert_eq!(result["request"]["action"].as_str(), Some("translate"));
        assert_eq!(result["request"]["text"].as_str(), Some("새로 번역할 원문"));
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러가 필요합니다"]
    fn live_discord_replaced_review_is_translated_as_a_new_message() {
        let _guard = lock_live_outgoing();
        let target = discord_target(9222).expect("Discord channel target");
        let mut client = CdpClient::new(target.websocket_url);
        let controller = outgoing_ui_script(
            true,
            true,
            "ko",
            "ja",
            "ko",
            &HashMap::new(),
            true,
            "Ctrl+Enter",
            "Alt+Enter",
        );
        client
            .evaluate(
                &format!(
                    r#"(() => {{
                      ({controller});
                      const active = window.__nudeTranslatorOutgoing;
                      const editor = document.createElement('div');
                      editor.id = 'nt-outgoing-replaced-review-test';
                      editor.setAttribute('role', 'textbox');
                      editor.setAttribute('contenteditable', 'true');
                      editor.textContent = '기존 번역문';
                      document.body.append(editor);
                      active.pending.set('review-replaced', {{
                        id:'review-replaced', editor, review_ready:true,
                        original_text:'기존 원문', text:'기존 번역문',
                        channel_key:location.pathname, selected_language:'ja', created_at:Date.now()
                      }});
                      editor.focus();
                      const range = document.createRange();
                      range.selectNodeContents(editor);
                      const selection = getSelection();
                      selection.removeAllRanges();
                      selection.addRange(range);
                    }})()"#
                ),
                false,
            )
            .expect("prepare native replacement probe");
        client
            .call("Input.insertText", json!({"text": "새로 번역할 원문"}))
            .expect("replace the complete reviewed translation");
        let result = client
            .evaluate(
                r#"(() => {
                  const active = window.__nudeTranslatorOutgoing;
                  const editor = document.getElementById('nt-outgoing-replaced-review-test');
                  const event = {
                    key:'Enter', ctrlKey:false, altKey:false, shiftKey:false, metaKey:false,
                    isComposing:false, target:editor,
                    preventDefault(){this.prevented=true;}, stopImmediatePropagation(){}
                  };
                  active.keydown(event);
                  return {
                    reviewStillPending:active.pending.has('review-replaced'),
                    prevented:Boolean(event.prevented), request:active.queue.at(-1) || null
                  };
                })()"#,
                true,
            )
            .expect("read native replacement result");
        assert_eq!(result["reviewStillPending"].as_bool(), Some(false));
        assert_eq!(result["prevented"].as_bool(), Some(true));
        assert_eq!(result["request"]["action"].as_str(), Some("translate"));
        assert_eq!(result["request"]["text"].as_str(), Some("새로 번역할 원문"));
        client
            .evaluate(
                "document.getElementById('nt-outgoing-replaced-review-test')?.remove()",
                false,
            )
            .expect("remove replacement probe editor");
        client
            .evaluate(OUTGOING_CLEANUP_SCRIPT, false)
            .expect("cleanup controller");
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러가 필요합니다"]
    fn live_discord_running_app_mounts_enabled_outgoing_control() {
        let _guard = lock_live_outgoing();
        let config = ConfigStore::load_default()
            .and_then(|store| store.get())
            .expect("saved app config");
        let target = discord_target(9222).expect("Discord channel target");
        let mut client = CdpClient::new(target.websocket_url);
        let state = client
            .evaluate(
                "(() => { const root=document.getElementById('nt-outgoing-translation'); const outgoing=root?.querySelector('.nt-outgoing-control'); const display=root?.querySelector('.nt-display-control'); const outgoingButton=outgoing?.querySelector('.nt-outgoing-trigger'); const displayButton=display?.querySelector('.nt-display-trigger'); const outgoingIcon=outgoing?.querySelector('.nt-role-icon'); const displayIcon=display?.querySelector('.nt-role-icon'); const rect=root?.getBoundingClientRect(); const outgoingRect=outgoing?.getBoundingClientRect(); const displayRect=display?.getBoundingClientRect(); const editors=[...document.querySelectorAll('[role=\"textbox\"][contenteditable=\"true\"], [contenteditable=\"true\"][data-slate-editor=\"true\"]')].map(editor=>{const r=editor.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom}}); const originalToggles=[...document.querySelectorAll('.nt-outgoing-original-toggle')].map(button=>({text:button.textContent||'',messageId:button.closest('.nt-outgoing-original-view')?.previousElementSibling?.id||''})); const styleOf=element=>element?{width:getComputedStyle(element).width,minHeight:getComputedStyle(element).minHeight,backgroundColor:getComputedStyle(element).backgroundColor,color:getComputedStyle(element).color,borderColor:getComputedStyle(element).borderColor,borderRadius:getComputedStyle(element).borderRadius}:null; const codeNode=outgoingButton?.querySelector('b'); const savedCode=codeNode?.textContent||''; if(codeNode)codeNode.textContent='AU'; const autoFits=Boolean(outgoingButton&&outgoingButton.scrollWidth<=outgoingButton.clientWidth); if(codeNode)codeNode.textContent=savedCode; return {root:Boolean(root),version:window.__nudeTranslatorOutgoing?.version??null,originalVersion:window.__nudeTranslatorOutgoingOriginalDisplay?.version??null,originalToggles,rootHidden:root?.hidden??null,rootDisplay:root?getComputedStyle(root).display:null,outgoingHidden:outgoing?.hidden??null,displayHidden:display?.hidden??null,enabled:window.__nudeTranslatorOutgoing?.enabled??null,displayEnabled:window.__nudeTranslatorOutgoing?.displayEnabled??null,autoFits,outgoingCode:savedCode,displayCode:displayButton?.querySelector('b')?.textContent||'',outgoingLabel:outgoingButton?.querySelector('.nt-role-label')?.textContent||'',displayLabel:displayButton?.querySelector('.nt-role-label')?.textContent||'',outgoingIcon:outgoingIcon?.textContent||'',displayIcon:displayIcon?.textContent||'',outgoingStyle:styleOf(outgoingButton),displayStyle:styleOf(displayButton),outgoingIconStyle:styleOf(outgoingIcon),displayIconStyle:styleOf(displayIcon),stacked:Boolean(outgoingRect&&displayRect&&outgoingRect.bottom<=displayRect.top+1),rect:rect?{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height}:null,viewport:{width:innerWidth,height:innerHeight},editors}; })()",
                true,
            )
            .expect("running app control state");
        eprintln!("running app overlay state: {state}");
        let any_enabled = config.enabled || config.outgoing_translation_enabled;
        assert_eq!(state["version"].as_u64(), Some(28), "state: {state}");
        assert_eq!(
            state["originalVersion"].as_u64(),
            Some(16),
            "state: {state}"
        );
        assert_eq!(state["root"].as_bool(), Some(true), "state: {state}");
        assert_eq!(
            state["rootHidden"].as_bool(),
            Some(!any_enabled),
            "state: {state}"
        );
        assert_eq!(
            state["outgoingHidden"].as_bool(),
            Some(!config.outgoing_translation_enabled),
            "state: {state}"
        );
        assert_eq!(
            state["displayHidden"].as_bool(),
            Some(!config.enabled),
            "state: {state}"
        );
        assert_eq!(
            state["enabled"].as_bool(),
            Some(config.outgoing_translation_enabled),
            "state: {state}"
        );
        assert_eq!(
            state["displayEnabled"].as_bool(),
            Some(config.enabled),
            "state: {state}"
        );
        if any_enabled {
            assert!(
                state["rect"]["top"].as_f64().unwrap_or(-1.0) >= 0.0,
                "state: {state}"
            );
            assert!(
                state["rect"]["bottom"].as_f64().unwrap_or(f64::MAX)
                    <= state["viewport"]["height"].as_f64().unwrap_or(0.0),
                "state: {state}"
            );
            assert!(
                state["rect"]["width"].as_f64().unwrap_or(f64::MAX) <= 180.0,
                "compact overlay is too wide: {state}"
            );
        }
        let compact_code = |language: &str| match language {
            "ko" => "KO",
            "ja" => "JP",
            "en" => "EN",
            "zh" => "CN",
            "zh-Hant" => "TW",
            _ => "AU",
        };
        assert_eq!(state["outgoingLabel"].as_str(), Some(""), "state: {state}");
        assert_eq!(state["displayLabel"].as_str(), Some(""), "state: {state}");
        assert_eq!(state["outgoingIcon"].as_str(), Some("↑"), "state: {state}");
        assert_eq!(state["displayIcon"].as_str(), Some("↓"), "state: {state}");
        assert!(
            matches!(
                state["outgoingCode"].as_str(),
                Some("AU" | "KO" | "JP" | "EN" | "CN" | "TW")
            ),
            "state: {state}"
        );
        assert_eq!(
            state["displayCode"].as_str(),
            Some(compact_code(&config.target_language)),
            "state: {state}"
        );
        for (role, hidden) in [
            ("outgoingStyle", "outgoingHidden"),
            ("displayStyle", "displayHidden"),
        ] {
            if state[hidden].as_bool() == Some(true) {
                continue;
            }
            let width = state[role]["width"]
                .as_str()
                .and_then(|value| value.trim_end_matches("px").parse::<f64>().ok())
                .unwrap_or(f64::MAX);
            assert!(
                (56.0..=72.0).contains(&width),
                "{role} is not content-hugging: {state}"
            );
            assert_eq!(state[role]["minHeight"].as_str(), Some("32px"));
        }
        assert_eq!(state["autoFits"].as_bool(), Some(true), "state: {state}");
        assert_eq!(
            state["outgoingStyle"]["backgroundColor"].as_str(),
            Some("rgb(15, 32, 44)")
        );
        assert_eq!(
            state["displayStyle"]["backgroundColor"].as_str(),
            Some("rgb(15, 32, 44)")
        );
        assert_eq!(
            state["outgoingIconStyle"]["color"].as_str(),
            Some("rgb(118, 184, 250)")
        );
        assert_eq!(
            state["displayIconStyle"]["color"].as_str(),
            Some("rgb(240, 161, 92)")
        );
        assert_eq!(
            state["outgoingIconStyle"]["borderRadius"].as_str(),
            Some("50%")
        );
        assert_eq!(
            state["displayIconStyle"]["borderRadius"].as_str(),
            Some("50%")
        );
        if config.enabled && config.outgoing_translation_enabled {
            assert_eq!(state["stacked"].as_bool(), Some(true), "state: {state}");
        }
        for toggle in state["originalToggles"]
            .as_array()
            .expect("original toggle list")
        {
            assert_eq!(
                toggle["text"].as_str(),
                Some(if config.enabled {
                    "원문 보기"
                } else {
                    "전송문 보기"
                }),
                "state: {state}"
            );
            assert!(
                toggle["messageId"]
                    .as_str()
                    .unwrap_or_default()
                    .starts_with("message-content-"),
                "state: {state}"
            );
        }
    }

    #[test]
    #[ignore = "실행 중인 Discord와 NudeNyang Translator가 필요합니다"]
    fn live_running_app_f12_controls_all_outgoing_message_views() {
        let _guard = lock_live_outgoing();
        let config = ConfigStore::load_default()
            .and_then(|store| store.get())
            .expect("saved app config");
        let target = discord_target(9222).expect("Discord channel target");
        let mut client = CdpClient::new(target.websocket_url);
        let state = client
            .evaluate(
                "(() => { const manager=window.__nudeTranslatorOutgoingOriginalDisplay; const views=[...document.querySelectorAll('.nt-outgoing-original-view')].map(view=>({mode:view.dataset.mode||'',button:view.querySelector('.nt-outgoing-original-toggle')?.textContent||'',sentDisplay:view.previousElementSibling?.style.display||'',originalHidden:view.querySelector('.nt-outgoing-original-copy')?.hidden??null})); return {version:manager?.version??null,translationEnabled:manager?.translationEnabled??null,views}; })()",
                true,
            )
            .expect("running app outgoing original state");
        eprintln!("F12 outgoing view state: {state}");

        assert_eq!(state["version"].as_u64(), Some(16), "state: {state}");
        assert_eq!(
            state["translationEnabled"].as_bool(),
            Some(config.enabled),
            "state: {state}"
        );
        let views = state["views"].as_array().expect("outgoing message views");
        assert!(!views.is_empty(), "no outgoing message views: {state}");
        for view in views {
            if config.enabled {
                assert_eq!(view["mode"].as_str(), Some("original"), "state: {state}");
                assert_eq!(view["button"].as_str(), Some("원문 보기"), "state: {state}");
                assert_eq!(view["sentDisplay"].as_str(), Some("none"), "state: {state}");
                assert_eq!(
                    view["originalHidden"].as_bool(),
                    Some(false),
                    "state: {state}"
                );
            } else {
                assert_eq!(view["mode"].as_str(), Some("sent"), "state: {state}");
                assert_eq!(
                    view["button"].as_str(),
                    Some("전송문 보기"),
                    "state: {state}"
                );
                assert_eq!(view["sentDisplay"].as_str(), Some(""), "state: {state}");
                assert_eq!(
                    view["originalHidden"].as_bool(),
                    Some(true),
                    "state: {state}"
                );
            }
        }
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
            .evaluate(
                &outgoing_ui_script(
                    true,
                    true,
                    "ko",
                    "auto",
                    "ko",
                    &HashMap::new(),
                    true,
                    "Ctrl+Enter",
                    "Alt+Enter",
                ),
                false,
            )
            .expect("outgoing script");
        assert!(requests.is_array());
        let mounted = client
            .evaluate(
                "Boolean(document.getElementById('nt-outgoing-translation'))",
                false,
            )
            .expect("mounted state");
        assert_eq!(mounted.as_bool(), Some(true));
        let placement = client
            .evaluate(
                "(() => { const root=document.getElementById('nt-outgoing-translation'); const editors=[...document.querySelectorAll('[role=\"textbox\"][contenteditable=\"true\"], [contenteditable=\"true\"][data-slate-editor=\"true\"]')].filter(editor=>{const r=editor.getBoundingClientRect();return r.width>120&&r.height>24&&r.top>innerHeight*0.4&&r.bottom<=innerHeight+1}); const editor=editors.sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top).at(-1); const composer=editor?.closest('form')||editor?.closest('[class*=\"channelTextArea\"]')||editor?.parentElement; const rootBounds=root?.getBoundingClientRect(); const composerBounds=composer?.getBoundingClientRect(); return {displayIcon:root?.querySelector('.nt-display-icon')?.textContent,rightGap:Math.abs((rootBounds?.right||0)-(composerBounds?.right||0)),aboveComposer:(rootBounds?.bottom||99999)<=(composerBounds?.top||0)+1,insideLeft:(rootBounds?.left||0)>=(composerBounds?.left||0),fitsWidth:(rootBounds?.width||99999)<=(composerBounds?.width||0)}; })()",
                true,
            )
            .expect("chat control placement");
        assert_eq!(placement["displayIcon"].as_str(), Some("↓"));
        assert!(
            placement["rightGap"].as_f64().unwrap_or(999.0) <= 12.5,
            "unexpected placement: {placement}"
        );
        assert_eq!(placement["aboveComposer"].as_bool(), Some(true));
        assert_eq!(placement["insideLeft"].as_bool(), Some(true));
        assert_eq!(placement["fitsWidth"].as_bool(), Some(true));
        let display_requests = client
            .evaluate(
                "document.querySelector('#nt-outgoing-translation .nt-display-trigger')?.click();document.querySelector('#nt-outgoing-translation .nt-display-menu button[data-value=\"ja\"]')?.click();window.__nudeTranslatorOutgoing?.queue?.splice(0,8)||[]",
                true,
            )
            .expect("display language selection");
        let display_requests =
            parse_outgoing_requests(display_requests).expect("display language request payload");
        assert_eq!(display_requests.len(), 1);
        assert_eq!(display_requests[0].action, "display-language");
        assert_eq!(display_requests[0].selected_language, "ja");
        let japanese_controller = outgoing_ui_script(
            true,
            true,
            "ko",
            "ja",
            "ko",
            &HashMap::new(),
            true,
            "Ctrl+Enter",
            "Alt+Enter",
        );
        let request_probe = format!(
            "(() => {{ ({japanese_controller}); const label=document.querySelector('#nt-outgoing-translation .nt-outgoing-trigger b')?.textContent; const editor=document.createElement('div'); editor.id='nt-outgoing-live-test'; editor.setAttribute('role','textbox'); editor.setAttribute('contenteditable','true'); editor.textContent='안녕하세요'; document.body.append(editor); editor.dispatchEvent(new KeyboardEvent('keydown',{{key:'Enter',bubbles:true,cancelable:true}})); const requests=({japanese_controller}); return {{label,requests}}; }})()"
        );
        let probe = client
            .evaluate(&request_probe, true)
            .expect("updated language and synthetic composer event");
        assert_eq!(probe["label"].as_str(), Some("일본어"));
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
    fn live_discord_stale_heartbeat_restores_dom_and_releases_enter() {
        let _guard = lock_live_outgoing();
        let target = discord_target(9222).expect("Discord channel target");
        let mut client = CdpClient::new(target.websocket_url);
        client.connect().expect("connect Discord renderer");
        client
            .evaluate(OUTGOING_CLEANUP_SCRIPT, false)
            .expect("remove existing outgoing controller");
        client
            .evaluate(INSTALL_TEXT_RESTORE_SCRIPT, false)
            .expect("install translated DOM restorer");
        client
            .evaluate(
                &outgoing_ui_script(
                    true,
                    true,
                    "ko",
                    "auto",
                    "ko",
                    &HashMap::new(),
                    true,
                    "Ctrl+Enter",
                    "Alt+Enter",
                ),
                false,
            )
            .expect("install watchdog controller");
        let state = client
            .evaluate(
                r#"(() => {
                  const translated = document.createElement('div');
                  translated.id = 'nt-watchdog-translated-test';
                  translated.textContent = '번역문';
                  document.body.append(translated);
                  window.__nudeTranslatorOriginals = new Map([[translated.firstChild, 'original']]);
                  const editor = document.createElement('div');
                  editor.id = 'nt-watchdog-editor-test';
                  editor.setAttribute('role', 'textbox');
                  editor.setAttribute('contenteditable', 'true');
                  editor.textContent = 'send without translator';
                  document.body.append(editor);
                  window.__nudeTranslatorOutgoing.lastHeartbeat = Date.now() - 6000;
                  const event = new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true});
                  editor.dispatchEvent(event);
                  const result = {
                    defaultPrevented: event.defaultPrevented,
                    controllerPresent: Boolean(window.__nudeTranslatorOutgoing),
                    controlsPresent: Boolean(document.getElementById('nt-outgoing-translation')),
                    restoredText: translated.textContent,
                  };
                  editor.remove();
                  translated.remove();
                  return result;
                })()"#,
                true,
            )
            .expect("trigger stale heartbeat failsafe");
        client
            .evaluate(
                &outgoing_ui_script(
                    true,
                    true,
                    "ko",
                    "auto",
                    "ko",
                    &HashMap::new(),
                    true,
                    "Ctrl+Enter",
                    "Alt+Enter",
                ),
                false,
            )
            .expect("reinstall watchdog controller");
        let automatic = client
            .evaluate(
                r#"(async () => {
                  const translated = document.createElement('div');
                  translated.id = 'nt-watchdog-automatic-test';
                  translated.textContent = '자동 번역문';
                  document.body.append(translated);
                  window.__nudeTranslatorOriginals = new Map([[translated.firstChild, 'automatic original']]);
                  window.__nudeTranslatorOutgoing.lastHeartbeat = Date.now() - 6000;
                  await new Promise(resolve => setTimeout(resolve, 1100));
                  const result = {
                    controllerPresent: Boolean(window.__nudeTranslatorOutgoing),
                    restoredText: translated.textContent,
                  };
                  translated.remove();
                  return result;
                })()"#,
                true,
            )
            .expect("wait for automatic watchdog cleanup");
        client.close();

        assert_eq!(state["defaultPrevented"].as_bool(), Some(false));
        assert_eq!(state["controllerPresent"].as_bool(), Some(false));
        assert_eq!(state["controlsPresent"].as_bool(), Some(false));
        assert_eq!(state["restoredText"].as_str(), Some("original"));
        assert_eq!(automatic["controllerPresent"].as_bool(), Some(false));
        assert_eq!(
            automatic["restoredText"].as_str(),
            Some("automatic original")
        );
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
        let controller = outgoing_ui_script(
            true,
            true,
            "ko",
            "ja",
            "ko",
            &HashMap::new(),
            true,
            "Ctrl+Enter",
            "Alt+Enter",
        );
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
    fn live_discord_channel_language_selection_uses_the_app_queue() {
        let _guard = lock_live_outgoing();
        let target = discord_target(9222).expect("Discord channel target");
        let mut client = CdpClient::new(target.websocket_url);
        client
            .evaluate(OUTGOING_CLEANUP_SCRIPT, false)
            .expect("remove controller from previous build");
        let controller = outgoing_ui_script(
            true,
            true,
            "ko",
            "ja",
            "ko",
            &HashMap::new(),
            true,
            "Ctrl+Enter",
            "Alt+Enter",
        );
        let reinjected = outgoing_ui_script(
            true,
            true,
            "ko",
            "ja",
            "ko",
            &HashMap::new(),
            true,
            "Ctrl+Enter",
            "Alt+Enter",
        );
        let probe = format!(
            r#"(() => {{
              ({controller});
              const active = window.__nudeTranslatorOutgoing;
              const channelKey = location.pathname;
              active.queue.length = 0;
              active.showLanguageMenu();
              active.root.querySelector('.nt-outgoing-menu button[data-value="auto"]').click();
              const requests = ({reinjected});
              return {{
                request: requests[0] || null,
                remembered: active.channelLanguages[channelKey] || '',
                label: active.root.querySelector('.nt-outgoing-trigger b')?.textContent || '',
              }};
            }})()"#
        );
        let result = client
            .evaluate(&probe, true)
            .expect("channel language memory probe");
        assert_eq!(
            result["request"]["action"].as_str(),
            Some("remember-language")
        );
        assert_eq!(
            result["request"]["selected_language"].as_str(),
            Some("auto")
        );
        assert_eq!(result["remembered"].as_str(), Some("auto"));
        assert_eq!(result["label"].as_str(), Some("AU"));
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
        let controller = outgoing_ui_script(
            true,
            true,
            "ko",
            "ja",
            "ko",
            &HashMap::new(),
            true,
            "Ctrl+Enter",
            "Alt+Enter",
        );
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
