use serde::Deserialize;
use serde_json::Value;

use crate::dictionary::DictionaryLookupResult;
use crate::language::is_supported_language_code;
use crate::ui_locale::generated_copies;

pub const DICTIONARY_CLEANUP_SCRIPT: &str = r#"
(() => {
  window.__ntDictionaryAbort?.abort();
  document.getElementById('nt-dictionary-selection')?.remove();
  document.getElementById('nt-dictionary-panel')?.remove();
  document.getElementById('nt-dictionary-style')?.remove();
  delete window.__ntDictionaryApply;
  delete window.__ntDictionaryUiVersion;
  return true;
})()
"#;

const DICTIONARY_UI_SCRIPT: &str = r####"
(() => {
  const enabled = __ENABLED__;
  const requestedUiLanguage = __UI_LANGUAGE__;
  const targetLanguage = __TARGET_LANGUAGE__;
  const externalEnabled = __EXTERNAL_ENABLED__;
  const systemUiLanguage = (navigator.language || 'en').toLowerCase();
  const supportedUiLanguages = ['ko','en','ja','zh','zh-Hant','pt-BR','hi','es-419','de','ru','id','fr','tr','ar','vi','it','pl','uk','ms','nl','th','fil','bn','ur','ta','fa','he','cs'];
  function resolveUiLanguage(value) {
    const normalized = String(value || '').replaceAll('_','-').toLowerCase();
    if (normalized.startsWith('zh')) return /(?:^|-)hant(?:-|$)/.test(normalized) || /^zh-(tw|hk|mo)(?:-|$)/.test(normalized) ? 'zh-Hant' : 'zh';
    if (normalized.startsWith('pt')) return 'pt-BR';
    if (normalized.startsWith('es')) return 'es-419';
    if (normalized === 'in' || normalized.startsWith('in-')) return 'id';
    return supportedUiLanguages.find(code => normalized === code.toLowerCase() || normalized.startsWith(`${code.toLowerCase()}-`)) || 'en';
  }
  const uiLanguage = resolveUiLanguage(requestedUiLanguage === 'auto' ? systemUiLanguage : requestedUiLanguage);
  const definitionLanguage = uiLanguage;
  const copies = Object.assign({
    ko:{lookup:'사전에서 찾기',dictionary:'사전',close:'닫기',loading:'선택한 범위의 뜻을 찾고 있습니다.',empty:'설치된 사전에서 일치하는 표현을 찾지 못했습니다.',segmentedMatches:'선택한 범위에서 찾은 표현',failed:'사전을 조회하지 못했습니다.',pronounce:'발음 듣기',external:'Wiktionary에서 더 보기',personal:'개인 사전',addPersonal:'개인 사전에 추가',targetTerm:'표시할 뜻 또는 번역어',note:'메모 (선택)',save:'저장',saved:'개인 사전에 저장했습니다.',cancel:'취소',source:'출처',automaticTranslation:'자동 번역',originalMeaning:'원문 뜻',noun:'명사',verb:'동사',adjective:'형용사',adverb:'부사',other:'기타'},
    en:{lookup:'Look up in dictionary',dictionary:'Dictionary',close:'Close',loading:'Looking up the selection.',empty:'No matching expression was found in installed dictionaries.',segmentedMatches:'Expressions found in the selection',failed:'The dictionary could not be searched.',pronounce:'Listen to pronunciation',external:'View more on Wiktionary',personal:'Personal dictionary',addPersonal:'Add to personal dictionary',targetTerm:'Meaning or translation to display',note:'Note (optional)',save:'Save',saved:'Saved to the personal dictionary.',cancel:'Cancel',source:'Source',automaticTranslation:'Automatic translation',originalMeaning:'Original meaning',noun:'Noun',verb:'Verb',adjective:'Adjective',adverb:'Adverb',other:'Other'},
    ja:{lookup:'辞書で調べる',dictionary:'辞書',close:'閉じる',loading:'選択範囲の意味を調べています。',empty:'インストール済みの辞書に一致する表現はありません。',segmentedMatches:'選択範囲で見つかった表現',failed:'辞書を検索できませんでした。',pronounce:'発音を聞く',external:'Wiktionaryで詳しく見る',personal:'個人辞書',addPersonal:'個人辞書に追加',targetTerm:'表示する意味または訳語',note:'メモ（任意）',save:'保存',saved:'個人辞書に保存しました。',cancel:'キャンセル',source:'出典',automaticTranslation:'自動翻訳',originalMeaning:'原文の意味',noun:'名詞',verb:'動詞',adjective:'形容詞',adverb:'副詞',other:'その他'},
    zh:{lookup:'在词典中查找',dictionary:'词典',close:'关闭',loading:'正在查询所选内容。',empty:'已安装的词典中没有匹配的词语。',segmentedMatches:'在所选范围内找到的词语',failed:'无法查询词典。',pronounce:'听发音',external:'在 Wiktionary 中查看更多',personal:'个人词典',addPersonal:'添加到个人词典',targetTerm:'要显示的释义或译词',note:'备注（可选）',save:'保存',saved:'已保存到个人词典。',cancel:'取消',source:'来源',automaticTranslation:'自动翻译',originalMeaning:'原文释义',noun:'名词',verb:'动词',adjective:'形容词',adverb:'副词',other:'其他'}
  }, __GENERATED_COPIES__);
  const copy = key => copies[uiLanguage]?.[key] || copies.en[key] || key;
  const languageName = code => {
    try { return new Intl.DisplayNames([uiLanguage],{type:'language'}).of(code) || code; }
    catch { return code || ''; }
  };
  const version = __CONTROLLER_VERSION__;
  if (!enabled) {
    window.__ntDictionaryAbort?.abort();
    document.getElementById('nt-dictionary-selection')?.remove();
    document.getElementById('nt-dictionary-panel')?.remove();
    document.getElementById('nt-dictionary-style')?.remove();
    delete window.__ntDictionaryApply;
    delete window.__ntDictionaryUiVersion;
    return [];
  }
  if (window.__ntDictionaryUiVersion !== version || window.__ntDictionaryUiLanguage !== uiLanguage || window.__ntDictionaryTargetLanguage !== targetLanguage) {
    window.__ntDictionaryAbort?.abort();
    document.getElementById('nt-dictionary-selection')?.remove();
    document.getElementById('nt-dictionary-panel')?.remove();
    document.getElementById('nt-dictionary-style')?.remove();
    window.__ntDictionaryAbort = new AbortController();
    window.__ntDictionaryUiVersion = version;
    window.__ntDictionaryUiLanguage = uiLanguage;
    window.__ntDictionaryTargetLanguage = targetLanguage;
    window.__ntDictionaryInstalled = false;
  }
  if (!window.__ntDictionaryAbort || window.__ntDictionaryAbort.signal.aborted) {
    window.__ntDictionaryAbort = new AbortController();
    window.__ntDictionaryInstalled = false;
  }
  window.__ntDictionaryRequests ||= [];
  window.__ntDictionarySequence ||= 0;

  const style = document.getElementById('nt-dictionary-style') || document.createElement('style');
  if (!style.id) {
    style.id = 'nt-dictionary-style';
    style.textContent = `
      #nt-dictionary-selection{position:fixed;z-index:2147483646;display:none;min-width:38px;height:32px;padding:0 9px;border:1px solid color-mix(in srgb,var(--brand-500,#5865f2) 54%,transparent);border-radius:11px;background:color-mix(in srgb,var(--background-floating,#1e2329) 96%,transparent);box-shadow:0 10px 28px rgba(0,0,0,.32),inset 0 1px rgba(255,255,255,.08);color:var(--text-normal,#f2f3f5);font:700 12px/1 var(--font-primary,"Segoe UI",sans-serif);letter-spacing:-.02em;cursor:pointer;backdrop-filter:blur(16px) saturate(120%);transition:transform 120ms ease,border-color 120ms ease}
      #nt-dictionary-selection:hover{border-color:var(--brand-500,#5865f2);transform:translateY(-1px)}
      #nt-dictionary-selection:active{transform:scale(.97)}
      #nt-dictionary-selection:focus-visible,#nt-dictionary-panel button:focus-visible,#nt-dictionary-panel input:focus-visible{outline:2px solid var(--brand-500,#5865f2);outline-offset:2px}
      #nt-dictionary-panel{position:fixed;z-index:2147483645;display:none;width:min(420px,calc(100vw - 24px));max-height:min(610px,calc(100vh - 24px));overflow:auto;border:1px solid color-mix(in srgb,var(--background-modifier-accent,#ffffff1a) 88%,transparent);border-radius:16px;background:color-mix(in srgb,var(--background-floating,#1e2329) 97%,transparent);box-shadow:0 24px 70px rgba(0,0,0,.44),inset 0 1px rgba(255,255,255,.08);color:var(--text-normal,#f2f3f5);font:400 14px/1.5 var(--font-primary,"Segoe UI",sans-serif);overscroll-behavior:contain;backdrop-filter:blur(22px) saturate(125%)}
      #nt-dictionary-panel *{box-sizing:border-box}
      #nt-dictionary-panel .nt-dict-head{position:sticky;top:0;z-index:2;display:flex;align-items:flex-start;gap:10px;padding:17px 18px 13px;background:linear-gradient(180deg,color-mix(in srgb,var(--background-floating,#1e2329) 100%,transparent) 76%,color-mix(in srgb,var(--background-floating,#1e2329) 88%,transparent));border-bottom:1px solid var(--background-modifier-accent,#ffffff14)}
      #nt-dictionary-panel .nt-dict-title{min-width:0;flex:1}
      #nt-dictionary-panel .nt-dict-title small{display:block;color:var(--text-muted,#949ba4);font-size:11px;font-weight:650;letter-spacing:.04em}
      #nt-dictionary-panel .nt-dict-title strong{display:block;overflow-wrap:anywhere;color:var(--text-normal,#f2f3f5);font-size:22px;font-weight:720;letter-spacing:-.025em;line-height:1.2}
      #nt-dictionary-panel .nt-dict-reading{margin-left:7px;color:var(--text-muted,#949ba4);font-size:13px;font-weight:500}
      #nt-dictionary-panel button{border:0;color:inherit;font:inherit;cursor:pointer}
      #nt-dictionary-panel .nt-dict-icon-button{display:inline-flex;width:32px;height:32px;flex:none;align-items:center;justify-content:center;border:1px solid var(--background-modifier-accent,#ffffff18);border-radius:10px;background:var(--background-modifier-hover,#ffffff0b);color:var(--text-muted,#b5bac1);font-size:15px;font-weight:700}
      #nt-dictionary-panel .nt-dict-icon-button:hover{background:var(--background-modifier-selected,#ffffff14);color:var(--text-normal,#f2f3f5)}
      #nt-dictionary-panel .nt-dict-body{padding:4px 18px 18px}
      #nt-dictionary-panel .nt-dict-state{padding:28px 4px;text-align:center;color:var(--text-muted,#949ba4)}
      #nt-dictionary-panel .nt-dict-skeleton{display:grid;gap:10px;padding:22px 4px}
      #nt-dictionary-panel .nt-dict-skeleton i{height:12px;border-radius:6px;background:var(--background-modifier-accent,#ffffff12);animation:nt-dictionary-pulse 1.1s ease-in-out infinite alternate}
      #nt-dictionary-panel .nt-dict-skeleton i:nth-child(2){width:72%}#nt-dictionary-panel .nt-dict-skeleton i:nth-child(3){width:88%}
      @keyframes nt-dictionary-pulse{to{opacity:.42}}
      #nt-dictionary-panel .nt-dict-personal{margin:14px 0 4px;padding:13px 14px;border-left:3px solid var(--brand-500,#5865f2);border-radius:0 12px 12px 0;background:color-mix(in srgb,var(--brand-500,#5865f2) 9%,var(--background-secondary,#2b2d31))}
      #nt-dictionary-panel .nt-dict-personal small,#nt-dictionary-panel .nt-dict-source{color:var(--text-muted,#949ba4);font-size:11px;font-weight:650}
      #nt-dictionary-panel .nt-dict-personal strong{display:block;margin-top:3px;font-size:16px}
      #nt-dictionary-panel .nt-dict-segment-note{margin:10px 0 0;color:var(--text-muted,#949ba4);font-size:12px;font-weight:650}
      #nt-dictionary-panel .nt-dict-entry{padding:15px 0;border-bottom:1px solid var(--background-modifier-accent,#ffffff12)}
      #nt-dictionary-panel .nt-dict-entry:last-of-type{border-bottom:0}
      #nt-dictionary-panel .nt-dict-entry-title{display:flex;flex-wrap:wrap;align-items:baseline;gap:7px;margin-bottom:6px}
      #nt-dictionary-panel .nt-dict-entry-title strong{font-size:17px;line-height:1.3;letter-spacing:-.015em}
      #nt-dictionary-panel .nt-dict-entry-title span{color:var(--text-muted,#949ba4);font-size:12px}
      #nt-dictionary-panel .nt-dict-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:7px}
      #nt-dictionary-panel .nt-dict-pos,#nt-dictionary-panel .nt-dict-origin{display:inline-flex;padding:2px 7px;border-radius:6px;background:var(--background-modifier-accent,#ffffff12);color:var(--text-muted,#b5bac1);font-size:11px;font-weight:700}
      #nt-dictionary-panel .nt-dict-origin.automatic{background:color-mix(in srgb,var(--brand-500,#5865f2) 14%,var(--background-modifier-accent,#ffffff12));color:color-mix(in srgb,var(--brand-300,#949cf7) 84%,var(--text-normal,#f2f3f5))}
      #nt-dictionary-panel .nt-dict-definition{margin:0;color:var(--text-normal,#f2f3f5);font-size:14px;line-height:1.58}
      #nt-dictionary-panel .nt-dict-original{margin-top:9px;color:var(--text-muted,#949ba4);font-size:12px}
      #nt-dictionary-panel .nt-dict-original summary{width:max-content;max-width:100%;cursor:pointer;font-weight:650}
      #nt-dictionary-panel .nt-dict-original p{margin:6px 0 0;padding-left:11px;border-left:2px solid var(--background-modifier-accent,#ffffff1f);line-height:1.55}
      #nt-dictionary-panel .nt-dict-example{margin:9px 0 0;padding-left:11px;border-left:2px solid var(--background-modifier-accent,#ffffff1f);color:var(--text-muted,#b5bac1);font-size:13px}
      #nt-dictionary-panel .nt-dict-source{display:block;margin-top:9px}
      #nt-dictionary-panel .nt-dict-actions{display:flex;flex-wrap:wrap;gap:7px;padding-top:14px}
      #nt-dictionary-panel .nt-dict-action{min-height:32px;padding:0 11px;border:1px solid var(--background-modifier-accent,#ffffff18);border-radius:9px;background:var(--background-modifier-hover,#ffffff0b);color:var(--text-normal,#f2f3f5);font-size:12px;font-weight:650}
      #nt-dictionary-panel .nt-dict-action:hover{background:var(--background-modifier-selected,#ffffff14)}
      #nt-dictionary-panel .nt-dict-action.primary{border-color:color-mix(in srgb,var(--brand-500,#5865f2) 62%,transparent);background:color-mix(in srgb,var(--brand-500,#5865f2) 20%,var(--background-secondary,#2b2d31))}
      #nt-dictionary-panel .nt-dict-form{display:grid;gap:9px;margin-top:13px;padding:13px;border-radius:12px;background:var(--background-secondary,#2b2d31)}
      #nt-dictionary-panel .nt-dict-form input{width:100%;height:36px;padding:0 10px;border:1px solid var(--background-modifier-accent,#ffffff20);border-radius:8px;background:var(--input-background,#111214);color:var(--text-normal,#f2f3f5);font:400 13px var(--font-primary,"Segoe UI",sans-serif)}
      #nt-dictionary-panel .nt-dict-form input::placeholder{color:var(--text-muted,#737b86)}
      #nt-dictionary-panel .nt-dict-form-actions{display:flex;justify-content:flex-end;gap:7px}
      #nt-dictionary-panel .nt-dict-saved{margin:11px 0 0;color:var(--status-positive-text,#57f287);font-size:12px}
      @media(prefers-reduced-motion:reduce){#nt-dictionary-selection{transition:none}#nt-dictionary-panel .nt-dict-skeleton i{animation:none}}
      @media(prefers-reduced-transparency:reduce){#nt-dictionary-selection,#nt-dictionary-panel{backdrop-filter:none}}
    `;
    document.head.appendChild(style);
  }

  const make = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const selectionButton = document.getElementById('nt-dictionary-selection') || make('button');
  if (!selectionButton.id) {
    selectionButton.id = 'nt-dictionary-selection';
    selectionButton.type = 'button';
    selectionButton.textContent = 'Aa';
    selectionButton.setAttribute('aria-label', copy('lookup'));
    selectionButton.title = copy('lookup');
    document.body.appendChild(selectionButton);
  }
  const panel = document.getElementById('nt-dictionary-panel') || make('section');
  if (!panel.id) {
    panel.id = 'nt-dictionary-panel';
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-label',copy('dictionary'));
    document.body.appendChild(panel);
  }

  const queue = request => {
    const id = `dictionary-${Date.now()}-${++window.__ntDictionarySequence}`;
    window.__ntDictionaryRequests.push({id,...request});
    return id;
  };
  const closePanel = () => { panel.style.display = 'none'; panel.replaceChildren(); };
  const closeSelection = () => { selectionButton.style.display = 'none'; };
  const positionPanel = rect => {
    panel.style.display = 'block';
    const inset = 12;
    const width = Math.min(420, innerWidth - inset * 2);
    const height = Math.min(panel.scrollHeight || 420, innerHeight - inset * 2);
    let left = Math.max(inset, Math.min(innerWidth - width - inset, rect.left + rect.width / 2 - width / 2));
    let top = rect.bottom + 10;
    if (top + height > innerHeight - inset) top = Math.max(inset, rect.top - height - 10);
    panel.style.left = `${left}px`; panel.style.top = `${top}px`;
  };
  const activeSelection = () => {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const root = node?.closest?.('[id^="message-content-"]') || node?.closest?.('[data-dto-message-id]') || node?.closest?.('[data-dto-root-id]');
    if (!root || root.closest('[contenteditable="true"]') || root.closest('#nt-dictionary-panel')) return null;
    const query = selection.toString().trim().replace(/\s+/g,' ');
    if (!query || [...query].length > 120) return null;
    const rect = range.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const beforeRange=range.cloneRange(); beforeRange.selectNodeContents(root); beforeRange.setEnd(range.startContainer,range.startOffset);
    const afterRange=range.cloneRange(); afterRange.selectNodeContents(root); afterRange.setStart(range.endContainer,range.endOffset);
    const beforeText=beforeRange.toString(); const afterText=afterRange.toString();
    const context=`${[...beforeText].slice(-60).join('')} ${query} ${[...afterText].slice(0,60).join('')}`.trim().replace(/\s+/g,' ').slice(0,240);
    return {query,rect,context};
  };
  const showSelection = () => {
    const selected = activeSelection();
    if (!selected) { closeSelection(); return; }
    selectionButton.dataset.query = selected.query;
    selectionButton.dataset.context = selected.context;
    selectionButton.style.display = 'block';
    const left = Math.max(8,Math.min(innerWidth-selectionButton.offsetWidth-8,selected.rect.right-selectionButton.offsetWidth));
    const top = Math.max(8,Math.min(innerHeight-selectionButton.offsetHeight-8,selected.rect.top-selectionButton.offsetHeight-7));
    selectionButton.style.left = `${left}px`; selectionButton.style.top = `${top}px`;
  };
  const loadingBody = query => {
    panel.replaceChildren();
    const head = make('header','nt-dict-head');
    const title = make('div','nt-dict-title');
    title.append(make('small','',copy('dictionary')),make('strong','',query));
    const close = make('button','nt-dict-icon-button','×'); close.type='button'; close.setAttribute('aria-label',copy('close')); close.addEventListener('click',closePanel);
    head.append(title,close);
    const body = make('div','nt-dict-body');
    const skeleton = make('div','nt-dict-skeleton'); skeleton.setAttribute('aria-label',copy('loading'));
    skeleton.append(make('i'),make('i'),make('i'));
    body.append(skeleton); panel.append(head,body);
  };
  const speak = (text, language) => {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text); utterance.lang = language || uiLanguage; speechSynthesis.speak(utterance);
  };
  const renderResult = (requestId, result, error = '') => {
    if (panel.dataset.requestId !== requestId) return;
    panel.replaceChildren();
    const head = make('header','nt-dict-head');
    const title = make('div','nt-dict-title');
    title.append(make('small','',copy('dictionary')),make('strong','',result?.query || panel.dataset.query || ''));
    const firstReading = result?.segmented ? '' : result?.entries?.find(entry => entry.reading)?.reading || '';
    if (firstReading) title.querySelector('strong').append(make('span','nt-dict-reading',firstReading));
    const listen = make('button','nt-dict-icon-button','▶'); listen.type='button'; listen.setAttribute('aria-label',copy('pronounce')); listen.title=copy('pronounce'); listen.addEventListener('click',()=>speak(result?.query || '',result?.sourceLanguage));
    const close = make('button','nt-dict-icon-button','×'); close.type='button'; close.setAttribute('aria-label',copy('close')); close.addEventListener('click',closePanel);
    head.append(title,listen,close);
    const body = make('div','nt-dict-body');
    if (error) body.append(make('p','nt-dict-state',error || copy('failed')));
    if (!error && result?.segmented) body.append(make('p','nt-dict-segment-note',copy('segmentedMatches')));
    for (const personal of result?.personalEntries || []) {
      const personalLabel = result?.segmented ? `${copy('personal')} · ${personal.sourceTerm}` : copy('personal');
      const item = make('div','nt-dict-personal'); item.append(make('small','',personalLabel),make('strong','',personal.targetTerm));
      if (personal.note) item.append(make('span','',personal.note)); body.append(item);
    }
    for (const entry of result?.entries || []) {
      const item = make('article','nt-dict-entry');
      if (result?.segmented) {
        const entryTitle = make('div','nt-dict-entry-title');
        entryTitle.append(make('strong','',entry.headword));
        if (entry.reading) entryTitle.append(make('span','',entry.reading));
        item.append(entryTitle);
      }
      const meta = make('div','nt-dict-meta');
      meta.append(make('span','nt-dict-pos',copy(entry.partOfSpeech || 'other')));
      if (entry.definitionOrigin === 'automatic') meta.append(make('span','nt-dict-origin automatic',copy('automaticTranslation')));
      else if (entry.definitionLanguage && entry.definitionLanguage !== definitionLanguage) meta.append(make('span','nt-dict-origin',`${languageName(entry.definitionLanguage)} · ${copy('originalMeaning')}`));
      item.append(meta,make('p','nt-dict-definition',entry.definition));
      if (entry.definitionOrigin === 'automatic' && entry.originalDefinition && entry.originalDefinition !== entry.definition) {
        const original = make('details','nt-dict-original');
        original.append(make('summary','',`${languageName(entry.originalDefinitionLanguage)} · ${copy('originalMeaning')}`),make('p','',entry.originalDefinition));
        item.append(original);
      }
      if (entry.example) item.append(make('p','nt-dict-example',entry.example));
      item.append(make('small','nt-dict-source',`${copy('source')}: ${entry.sourceName} (${entry.license})`)); body.append(item);
    }
    if (!error && !(result?.entries?.length || result?.personalEntries?.length)) body.append(make('p','nt-dict-state',copy('empty')));
    const actions = make('div','nt-dict-actions');
    const external = make('button','nt-dict-action',copy('external')); external.type='button'; external.addEventListener('click',()=>queue({action:'open',query:result?.query || '',sourceLanguage:result?.sourceLanguage || ''}));
    const add = make('button','nt-dict-action primary',copy('addPersonal')); add.type='button';
    add.addEventListener('click',()=>{
      add.disabled=true;
      const form = make('form','nt-dict-form');
      const target = make('input'); target.placeholder=copy('targetTerm'); target.required=true; target.maxLength=120;
      const note = make('input'); note.placeholder=copy('note'); note.maxLength=500;
      const formActions = make('div','nt-dict-form-actions');
      const cancel = make('button','nt-dict-action',copy('cancel')); cancel.type='button'; cancel.addEventListener('click',()=>{form.remove();add.disabled=false;});
      const save = make('button','nt-dict-action primary',copy('save')); save.type='submit';
      formActions.append(cancel,save); form.append(target,note,formActions);
      form.addEventListener('submit',event=>{
        event.preventDefault();
        if (!target.value.trim()) return;
        save.disabled=true;
        const saveId=queue({action:'save',query:result?.query || '',sourceLanguage:result?.sourceLanguage || '',targetLanguage:definitionLanguage,targetTerm:target.value.trim(),note:note.value.trim()});
        form.dataset.saveId=saveId;
      });
      actions.after(form); target.focus();
    });
    if (externalEnabled) actions.append(external);
    actions.append(add); body.append(actions); panel.append(head,body);
    positionPanel(JSON.parse(panel.dataset.anchor || '{"left":12,"right":12,"top":12,"bottom":12,"width":0,"height":0}'));
  };
  window.__ntDictionaryApply = (requestId,payload,error='') => {
    const form = panel.querySelector(`.nt-dict-form[data-save-id="${CSS.escape(requestId)}"]`);
    if (form) {
      if (error) { const button=form.querySelector('[type="submit"]'); if(button) button.disabled=false; form.append(make('p','nt-dict-state',error)); }
      else { form.replaceWith(make('p','nt-dict-saved',copy('saved'))); }
      return;
    }
    renderResult(requestId,payload,error);
  };

  if (!window.__ntDictionaryInstalled) {
    window.__ntDictionaryInstalled = true;
    const signal = window.__ntDictionaryAbort.signal;
    document.addEventListener('pointerup',event=>{ if(event.button===0 && !event.target.closest?.('#nt-dictionary-selection,#nt-dictionary-panel')) setTimeout(showSelection,0); },{capture:true,signal});
    document.addEventListener('keyup',event=>{ if(event.key.startsWith('Arrow') || event.key==='Shift') setTimeout(showSelection,0); },{signal});
    document.addEventListener('pointerdown',event=>{ if(!event.target.closest?.('#nt-dictionary-selection,#nt-dictionary-panel')) closePanel(); },{capture:true,signal});
    document.addEventListener('scroll',()=>{closeSelection();closePanel();},{capture:true,passive:true,signal});
    window.addEventListener('resize',()=>{closeSelection();closePanel();},{signal});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeSelection();closePanel();}},{signal});
    selectionButton.addEventListener('pointerdown',event=>event.preventDefault(),{signal});
    selectionButton.addEventListener('click',event=>{
      event.preventDefault(); event.stopPropagation();
      const selection=getSelection(); const rect=selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : selectionButton.getBoundingClientRect();
      const query=selectionButton.dataset.query || ''; if(!query) return;
      const anchor={left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height};
      loadingBody(query); panel.dataset.query=query; panel.dataset.anchor=JSON.stringify(anchor); positionPanel(anchor);
      panel.dataset.requestId=queue({action:'lookup',query,context:selectionButton.dataset.context || '',sourceLanguage:'',targetLanguage:definitionLanguage}); closeSelection();
    },{signal});
  }
  return window.__ntDictionaryRequests.splice(0);
})()
"####;

pub fn dictionary_ui_script(
    enabled: bool,
    ui_language: &str,
    target_language: &str,
    external_enabled: bool,
) -> String {
    let ui_language = if ui_language == "auto" || is_supported_language_code(ui_language) {
        ui_language
    } else {
        "en"
    };
    let target_language = if is_supported_language_code(target_language) {
        target_language
    } else {
        "en"
    };
    let copies = generated_copies(&[
        ("lookup", "사전에서 찾기"),
        ("dictionary", "사전"),
        ("close", "닫기"),
        ("loading", "선택한 범위의 뜻을 찾고 있습니다."),
        ("empty", "설치된 사전에서 일치하는 표현을 찾지 못했습니다."),
        ("segmentedMatches", "선택한 범위에서 찾은 표현"),
        ("failed", "사전을 조회하지 못했습니다."),
        ("pronounce", "발음 듣기"),
        ("external", "Wiktionary에서 더 보기"),
        ("personal", "개인 사전"),
        ("addPersonal", "개인 사전에 추가"),
        ("targetTerm", "표시할 뜻 또는 번역어"),
        ("note", "메모 (선택)"),
        ("save", "저장"),
        ("saved", "개인 사전에 저장했습니다."),
        ("cancel", "취소"),
        ("source", "출처"),
        ("automaticTranslation", "자동 번역"),
        ("originalMeaning", "원문 뜻"),
        ("noun", "명사"),
        ("verb", "동사"),
        ("adjective", "형용사"),
        ("adverb", "부사"),
        ("other", "기타"),
    ]);
    let script = DICTIONARY_UI_SCRIPT
        .replace("__ENABLED__", if enabled { "true" } else { "false" })
        .replace(
            "__EXTERNAL_ENABLED__",
            if external_enabled { "true" } else { "false" },
        )
        .replace(
            "__UI_LANGUAGE__",
            &serde_json::to_string(ui_language).unwrap(),
        )
        .replace(
            "__TARGET_LANGUAGE__",
            &serde_json::to_string(target_language).unwrap(),
        )
        .replace(
            "__GENERATED_COPIES__",
            &serde_json::to_string(&copies).unwrap(),
        );
    let version = serde_json::to_string(&dictionary_ui_version(&script)).unwrap();
    script.replace("__CONTROLLER_VERSION__", &version)
}

fn dictionary_ui_version(script: &str) -> String {
    const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;

    let fingerprint = script.bytes().fold(FNV_OFFSET_BASIS, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(FNV_PRIME)
    });
    format!("rust-dictionary-ui-{fingerprint:016x}")
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryRequest {
    pub id: String,
    pub action: String,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub context: String,
    #[serde(default)]
    pub source_language: String,
    #[serde(default)]
    pub target_language: String,
    #[serde(default)]
    pub target_term: String,
    #[serde(default)]
    pub note: String,
}

pub fn parse_dictionary_requests(value: Value) -> Result<Vec<DictionaryRequest>, String> {
    serde_json::from_value(value).map_err(|error| format!("사전 요청을 읽지 못했습니다: {error}"))
}

pub fn apply_dictionary_result_script(
    request_id: &str,
    result: &DictionaryLookupResult,
) -> Result<String, String> {
    let request_id = serde_json::to_string(request_id)
        .map_err(|error| format!("사전 요청 ID를 변환하지 못했습니다: {error}"))?;
    let result = serde_json::to_string(result)
        .map_err(|error| format!("사전 결과를 변환하지 못했습니다: {error}"))?;
    Ok(format!(
        "window.__ntDictionaryApply?.({request_id},{result},'')"
    ))
}

pub fn apply_dictionary_saved_script(request_id: &str) -> Result<String, String> {
    let request_id = serde_json::to_string(request_id)
        .map_err(|error| format!("사전 요청 ID를 변환하지 못했습니다: {error}"))?;
    Ok(format!(
        "window.__ntDictionaryApply?.({request_id},null,'')"
    ))
}

pub fn apply_dictionary_error_script(request_id: &str, error: &str) -> Result<String, String> {
    let request_id = serde_json::to_string(request_id)
        .map_err(|value| format!("사전 요청 ID를 변환하지 못했습니다: {value}"))?;
    let error = serde_json::to_string(error)
        .map_err(|value| format!("사전 오류를 변환하지 못했습니다: {value}"))?;
    Ok(format!(
        "window.__ntDictionaryApply?.({request_id},null,{error})"
    ))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{dictionary_ui_script, dictionary_ui_version, parse_dictionary_requests};

    #[test]
    fn controller_uses_selection_toolbar_and_safe_text_content() {
        let script = dictionary_ui_script(true, "ko", "ko", true);
        assert!(script.contains("nt-dictionary-selection"));
        assert!(script.contains("speechSynthesis"));
        assert!(script.contains("textContent"));
        assert!(script.contains("targetLanguage:definitionLanguage"));
        assert!(script.contains("entry.definitionOrigin === 'automatic'"));
        assert!(script.contains("nt-dict-original"));
        assert!(script.contains("result?.segmented"));
        assert!(script.contains("context:selectionButton.dataset.context"));
        assert!(script.contains("[...beforeText].slice(-60)"));
        assert!(script.contains("[...afterText].slice(0,60)"));
        assert!(!script.contains("__CONTROLLER_VERSION__"));
        assert!(!script.contains("rust-dictionary-ui-v3"));
        assert!(!script.contains("innerHTML"));
    }

    #[test]
    fn controller_version_changes_with_injected_script_content() {
        assert_ne!(
            dictionary_ui_version("const context = 'old';"),
            dictionary_ui_version("const context = 'selection-local';")
        );
    }

    #[test]
    fn request_parser_accepts_lookup_and_save_fields() {
        let requests = parse_dictionary_requests(json!([{
            "id":"dictionary-1","action":"save","query":"future","sourceLanguage":"en",
            "targetLanguage":"ko","targetTerm":"미래","note":"명사"
        }]))
        .unwrap();
        assert_eq!(requests[0].target_term, "미래");
    }
}
