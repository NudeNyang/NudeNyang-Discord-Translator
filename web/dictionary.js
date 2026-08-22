import { resolveUiLanguage } from "./i18n.mjs";
import { canonicalSpeechLanguage, waitForSpeechVoice } from "./dictionary-speech.mjs";
import { UI_LOCALE_COPY } from "./ui-locales.mjs";

const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;
const shell = document.querySelector("#dictionary-shell");
const SCROLL_REVEAL_DISTANCE = 24;

const BASE_COPIES = Object.freeze({
  ko: { dictionary: "사전", close: "닫기", loading: "선택한 범위의 뜻을 찾고 있습니다.", empty: "설치된 사전에서 일치하는 표현을 찾지 못했습니다.", segmentedMatches: "선택한 범위에서 찾은 표현", contextMeaning: "문맥상 우선 표시", otherMeanings: "다른 뜻", failed: "사전을 조회하지 못했습니다.", pronounce: "발음 듣기", pausePronunciation: "발음 일시정지", resumePronunciation: "발음 계속 듣기", external: "Wiktionary에서 더 보기", personal: "개인 사전", addPersonal: "개인 사전에 추가", targetTerm: "표시할 뜻 또는 번역어", note: "메모 (선택)", save: "저장", saved: "개인 사전에 저장했습니다.", cancel: "취소", source: "출처", sourceAndLicense: "출처 및 라이선스", automaticTranslation: "참고용 자동 번역", originalMeaning: "사전 원문", noun: "명사", verb: "동사", adjective: "형용사", adverb: "부사", other: "기타" },
  en: { dictionary: "Dictionary", close: "Close", loading: "Looking up the selection.", empty: "No matching expression was found in installed dictionaries.", segmentedMatches: "Expressions found in the selection", contextMeaning: "Shown first for this context", otherMeanings: "Other meanings", failed: "The dictionary could not be searched.", pronounce: "Listen to pronunciation", pausePronunciation: "Pause pronunciation", resumePronunciation: "Resume pronunciation", external: "View more on Wiktionary", personal: "Personal dictionary", addPersonal: "Add to personal dictionary", targetTerm: "Meaning or translation to display", note: "Note (optional)", save: "Save", saved: "Saved to the personal dictionary.", cancel: "Cancel", source: "Source", sourceAndLicense: "Sources and licenses", automaticTranslation: "Reference translation", originalMeaning: "Dictionary source", noun: "Noun", verb: "Verb", adjective: "Adjective", adverb: "Adverb", other: "Other" },
  ja: { dictionary: "辞書", close: "閉じる", loading: "選択範囲の意味を調べています。", empty: "インストール済みの辞書に一致する表現はありません。", segmentedMatches: "選択範囲で見つかった表現", contextMeaning: "文脈に合わせて優先表示", otherMeanings: "別の意味", failed: "辞書を検索できませんでした。", pronounce: "発音を聞く", pausePronunciation: "発音を一時停止", resumePronunciation: "発音を再開", external: "Wiktionaryで詳しく見る", personal: "個人辞書", addPersonal: "個人辞書に追加", targetTerm: "表示する意味または訳語", note: "メモ（任意）", save: "保存", saved: "個人辞書に保存しました。", cancel: "キャンセル", source: "出典", sourceAndLicense: "出典とライセンス", automaticTranslation: "参考用の自動翻訳", originalMeaning: "辞書の原文", noun: "名詞", verb: "動詞", adjective: "形容詞", adverb: "副詞", other: "その他" },
  zh: { dictionary: "词典", close: "关闭", loading: "正在查询所选内容。", empty: "已安装的词典中没有匹配的词语。", segmentedMatches: "在所选范围内找到的词语", contextMeaning: "按当前语境优先显示", otherMeanings: "其他释义", failed: "无法查询词典。", pronounce: "听发音", pausePronunciation: "暂停发音", resumePronunciation: "继续发音", external: "在 Wiktionary 中查看更多", personal: "个人词典", addPersonal: "添加到个人词典", targetTerm: "要显示的释义或译词", note: "备注（可选）", save: "保存", saved: "已保存到个人词典。", cancel: "取消", source: "来源", sourceAndLicense: "来源与许可", automaticTranslation: "仅供参考的自动翻译", originalMeaning: "词典原文", noun: "名词", verb: "动词", adjective: "形容词", adverb: "副词", other: "其他" },
});

const KOREAN_COPIES = Object.freeze({
  dictionary: "사전", close: "닫기", loading: "선택한 범위의 뜻을 찾고 있습니다.",
  empty: "설치된 사전에서 일치하는 표현을 찾지 못했습니다.", segmentedMatches: "선택한 범위에서 찾은 표현",
  contextMeaning: "문맥상 우선 표시", otherMeanings: "다른 뜻", failed: "사전을 조회하지 못했습니다.",
  pronounce: "발음 듣기", pausePronunciation: "발음 일시정지", resumePronunciation: "발음 계속 듣기",
  external: "Wiktionary에서 더 보기", personal: "개인 사전",
  addPersonal: "개인 사전에 추가", targetTerm: "표시할 뜻 또는 번역어", note: "메모 (선택)",
  save: "저장", saved: "개인 사전에 저장했습니다.", cancel: "취소", source: "출처",
  sourceAndLicense: "출처 및 라이선스", automaticTranslation: "참고용 자동 번역", originalMeaning: "사전 원문",
  noun: "명사", verb: "동사", adjective: "형용사", adverb: "부사", other: "기타",
});

let payload = null;
let uiLanguage = "en";
let currentRequestId = "";
let cleanupScroll = () => {};
let activeSpeech = null;
let speechGeneration = 0;

function copy(key) {
  const korean = KOREAN_COPIES[key];
  if (uiLanguage === "ko") return korean || key;
  return BASE_COPIES[uiLanguage]?.[key]
    || UI_LOCALE_COPY[uiLanguage]?.[korean]
    || BASE_COPIES.en[key]
    || korean
    || key;
}

function make(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function languageName(code) {
  try { return new Intl.DisplayNames([uiLanguage], { type: "language" }).of(code) || code; }
  catch { return code || ""; }
}

function setSpeechButtonState(button, state, playLabel) {
  const playing = state === "playing";
  const paused = state === "paused";
  button.textContent = playing ? "Ⅱ" : "▶";
  button.classList.toggle("is-playing", playing);
  button.dataset.speechState = state;
  const label = playing ? copy("pausePronunciation") : paused ? copy("resumePronunciation") : playLabel;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.setAttribute("aria-pressed", String(playing || paused));
}

function cancelSpeech() {
  speechGeneration += 1;
  const previous = activeSpeech;
  activeSpeech = null;
  window.speechSynthesis?.cancel?.();
  if (previous?.button?.isConnected) setSpeechButtonState(previous.button, "idle", previous.playLabel);
}

function finishSpeech(utterance) {
  if (activeSpeech?.utterance !== utterance) return;
  const finished = activeSpeech;
  activeSpeech = null;
  if (finished.button.isConnected) setSpeechButtonState(finished.button, "idle", finished.playLabel);
}

function createSpeechButton(text, language, className, playLabel = copy("pronounce")) {
  const button = make("button", className, "▶");
  button.type = "button";
  setSpeechButtonState(button, "idle", playLabel);
  button.addEventListener("click", async () => {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window) || !text) return;
    if (activeSpeech?.button === button) {
      if (activeSpeech.state === "paused") {
        speechSynthesis.resume();
        activeSpeech.state = "playing";
        setSpeechButtonState(button, "playing", playLabel);
      } else {
        speechSynthesis.pause();
        activeSpeech.state = "paused";
        setSpeechButtonState(button, "paused", playLabel);
      }
      return;
    }

    cancelSpeech();
    const requestGeneration = speechGeneration;
    const requestedLanguage = canonicalSpeechLanguage(language || uiLanguage);
    const voice = await waitForSpeechVoice(speechSynthesis, requestedLanguage);
    if (requestGeneration !== speechGeneration || !button.isConnected) return;
    if (!voice) {
      setSpeechButtonState(button, "idle", playLabel);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = requestedLanguage;
    utterance.voice = voice;
    utterance.addEventListener("end", () => finishSpeech(utterance));
    utterance.addEventListener("error", () => finishSpeech(utterance));
    activeSpeech = { button, utterance, state: "playing", playLabel };
    setSpeechButtonState(button, "playing", playLabel);
    speechSynthesis.speak(utterance);
  });
  return button;
}

function closeWindow() {
  cancelSpeech();
  invoke?.("dictionary_window_hide").catch(() => {});
}

function makeHeader(query, result = null) {
  const head = make("header", "nt-dict-head");
  head.setAttribute("data-tauri-drag-region", "");
  const title = make("div", "nt-dict-title");
  title.setAttribute("data-tauri-drag-region", "");
  const label = make("small", "", copy("dictionary"));
  label.setAttribute("data-tauri-drag-region", "");
  const strong = make("strong", "", query);
  const firstReading = result?.segmented ? "" : result?.entries?.find(entry => entry.reading)?.reading || "";
  if (firstReading) strong.append(make("span", "nt-dict-reading", firstReading));
  title.append(label, strong);
  if (result?.selectionTranslation) title.append(make("p", "nt-dict-selection-meaning", result.selectionTranslation));
  else if (result?.localizationPending && result?.sourceLanguage !== result?.targetLanguage) {
    const pending = make("i", "nt-dict-selection-pending");
    pending.setAttribute("aria-label", copy("loading"));
    title.append(pending);
  }
  head.append(title);
  if (result) {
    const listenButton = createSpeechButton(result.query, result.sourceLanguage, "nt-dict-icon-button");
    head.append(listenButton);
  }
  return head;
}

function bindScrollIndicator(scroll, indicator, thumb) {
  const controller = new AbortController();
  const signal = controller.signal;
  let hideTimer = 0;
  let draggingPointer = null;
  let frame = 0;
  const update = () => {
    frame = 0;
    const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    indicator.classList.toggle("scrollable", maxScroll > 1);
    if (maxScroll <= 1) {
      thumb.style.height = "0px";
      thumb.style.transform = "translateY(0)";
      return;
    }
    const trackHeight = indicator.clientHeight;
    const thumbHeight = Math.max(32, trackHeight * scroll.clientHeight / scroll.scrollHeight);
    const travel = Math.max(0, trackHeight - thumbHeight);
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${travel * scroll.scrollTop / maxScroll}px)`;
  };
  const scheduleUpdate = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const reveal = () => {
    indicator.classList.add("nt-scrolling");
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => indicator.classList.remove("nt-scrolling"), 650);
    scheduleUpdate();
  };
  const proximity = event => {
    const rect = scroll.getBoundingClientRect();
    indicator.classList.toggle("nt-scroll-near", rect.right - event.clientX <= SCROLL_REVEAL_DISTANCE);
  };
  const scrollToPointer = clientY => {
    const track = indicator.getBoundingClientRect();
    const thumbHeight = thumb.getBoundingClientRect().height;
    const travel = Math.max(1, track.height - thumbHeight);
    const top = Math.min(travel, Math.max(0, clientY - track.top - thumbHeight / 2));
    scroll.scrollTop = top / travel * Math.max(0, scroll.scrollHeight - scroll.clientHeight);
  };
  const finishDrag = event => {
    if (draggingPointer !== event.pointerId) return;
    draggingPointer = null;
    indicator.classList.remove("nt-scroll-dragging");
    if (indicator.hasPointerCapture(event.pointerId)) indicator.releasePointerCapture(event.pointerId);
    proximity(event);
  };
  scroll.addEventListener("scroll", reveal, { passive: true, signal });
  scroll.addEventListener("pointermove", proximity, { signal });
  scroll.addEventListener("pointerleave", () => {
    if (draggingPointer === null) indicator.classList.remove("nt-scroll-near");
  }, { signal });
  indicator.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !indicator.classList.contains("scrollable")) return;
    draggingPointer = event.pointerId;
    indicator.classList.add("nt-scroll-near", "nt-scroll-dragging");
    indicator.setPointerCapture(event.pointerId);
    scrollToPointer(event.clientY);
    event.preventDefault();
  }, { signal });
  indicator.addEventListener("pointermove", event => {
    if (draggingPointer === event.pointerId) scrollToPointer(event.clientY);
  }, { signal });
  indicator.addEventListener("pointerup", finishDrag, { signal });
  indicator.addEventListener("pointercancel", finishDrag, { signal });
  indicator.addEventListener("wheel", event => {
    if (!indicator.classList.contains("scrollable")) return;
    scroll.scrollTop += event.deltaY;
    event.preventDefault();
  }, { passive: false, signal });
  const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(scheduleUpdate) : null;
  resizeObserver?.observe(scroll);
  for (const child of scroll.children) resizeObserver?.observe(child);
  scheduleUpdate();
  return () => {
    controller.abort();
    resizeObserver?.disconnect();
    clearTimeout(hideTimer);
    if (frame) cancelAnimationFrame(frame);
  };
}

function mount(head, body, footer = null, scrollTop = 0) {
  cleanupScroll();
  const scrollFrame = make("div", "nt-dict-scroll-frame");
  const scroll = make("div", "nt-dict-scroll");
  scroll.append(body);
  const indicator = make("div", "nt-dict-scroll-indicator");
  indicator.setAttribute("aria-hidden", "true");
  const thumb = make("span", "nt-dict-scroll-thumb");
  indicator.append(thumb);
  scrollFrame.append(scroll, indicator);
  shell.replaceChildren(head, scrollFrame);
  if (footer) shell.append(footer);
  cleanupScroll = bindScrollIndicator(scroll, indicator, thumb);
  scroll.scrollTop = scrollTop;
}

function renderLoading(nextPayload) {
  const head = makeHeader(nextPayload.query);
  const body = make("div", "nt-dict-body");
  const skeleton = make("div", "nt-dict-skeleton");
  skeleton.setAttribute("aria-label", copy("loading"));
  skeleton.append(make("i"), make("i"), make("i"));
  body.append(skeleton);
  mount(head, body);
}

function appendSense(container, entry, showSourceName, definitionLanguage) {
  const meta = make("div", "nt-dict-meta");
  meta.append(make("span", "nt-dict-pos", copy(entry.partOfSpeech || "other")));
  if (entry.contextRecommended) meta.append(make("span", "nt-dict-origin contextual", copy("contextMeaning")));
  if (entry.definitionOrigin === "automatic") meta.append(make("span", "nt-dict-origin automatic", copy("automaticTranslation")));
  else if (entry.definitionLanguage && entry.definitionLanguage !== definitionLanguage) {
    meta.append(make("span", "nt-dict-origin", `${languageName(entry.definitionLanguage)} · ${copy("originalMeaning")}`));
  }
  container.append(meta, make("p", "nt-dict-definition", entry.definition));
  if (entry.definitionOrigin === "automatic" && entry.originalDefinition && entry.originalDefinition !== entry.definition) {
    const original = make("details", "nt-dict-original");
    original.open = true;
    original.append(
      make("summary", "", `${languageName(entry.originalDefinitionLanguage)} · ${copy("originalMeaning")}`),
      make("p", "", entry.originalDefinition),
    );
    container.append(original);
  }
  if (entry.example) container.append(make("p", "nt-dict-example", entry.example));
  if (showSourceName && entry.sourceName) container.append(make("small", "nt-dict-source", `${copy("source")}: ${entry.sourceName}`));
}

function personalEntryPayload(result, targetTerm, note) {
  return {
    id: 0,
    sourceLanguage: result.sourceLanguage,
    targetLanguage: result.targetLanguage,
    sourceTerm: result.query,
    targetTerm,
    note,
    tags: "",
    pinned: false,
    scope: "global",
    scopeValue: "",
    caseSensitive: false,
    wholeWord: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeFooter(result) {
  const footer = make("footer", "nt-dict-footer");
  const actions = make("div", "nt-dict-actions");
  if (payload.externalEnabled) {
    const external = make("button", "nt-dict-action", copy("external"));
    external.type = "button";
    external.addEventListener("click", () => invoke?.("dictionary_external_open", { query: result.query }).catch(() => {}));
    actions.append(external);
  }
  const add = make("button", "nt-dict-action primary", copy("addPersonal"));
  add.type = "button";
  add.addEventListener("click", () => {
    add.disabled = true;
    const form = make("form", "nt-dict-form");
    const target = make("input");
    target.placeholder = copy("targetTerm");
    target.required = true;
    target.maxLength = 120;
    const note = make("input");
    note.placeholder = copy("note");
    note.maxLength = 500;
    const formActions = make("div", "nt-dict-form-actions");
    const cancel = make("button", "nt-dict-action", copy("cancel"));
    cancel.type = "button";
    cancel.addEventListener("click", () => { form.remove(); add.disabled = false; });
    const save = make("button", "nt-dict-action primary", copy("save"));
    save.type = "submit";
    formActions.append(cancel, save);
    form.append(target, note, formActions);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!target.value.trim()) return;
      save.disabled = true;
      try {
        await invoke("dictionary_personal_upsert", { entry: personalEntryPayload(result, target.value.trim(), note.value.trim()) });
        form.replaceWith(make("p", "nt-dict-saved", copy("saved")));
      } catch (error) {
        save.disabled = false;
        form.append(make("p", "nt-dict-state", String(error || copy("failed"))));
      }
    });
    actions.after(form);
    target.focus();
  });
  actions.append(add);
  footer.append(actions);
  return footer;
}

function renderResult(result, error = "") {
  const previousScrollTop = shell.querySelector(".nt-dict-scroll")?.scrollTop || 0;
  const head = makeHeader(result?.query || payload.query, result);
  const body = make("div", "nt-dict-body");
  if (error) body.append(make("p", "nt-dict-state", error || copy("failed")));
  if (!error && result?.segmented) body.append(make("p", "nt-dict-segment-note", copy("segmentedMatches")));
  for (const personal of result?.personalEntries || []) {
    const label = result.segmented ? `${copy("personal")} · ${personal.sourceTerm}` : copy("personal");
    const item = make("div", "nt-dict-personal");
    item.append(make("small", "", label), make("strong", "", personal.targetTerm));
    if (personal.note) item.append(make("span", "", personal.note));
    body.append(item);
  }

  const entryGroups = [];
  const entryGroupsByKey = new Map();
  const sourceAttributions = new Map();
  for (const entry of result?.entries || []) {
    if (entry.sourceName || entry.license) {
      const sourceKey = `${entry.sourceName || ""}\u0000${entry.license || ""}`;
      if (!sourceAttributions.has(sourceKey)) sourceAttributions.set(sourceKey, { sourceName: entry.sourceName || "", license: entry.license || "" });
    }
    const key = `${entry.language || ""}\u0000${entry.headword || ""}`;
    let group = entryGroupsByKey.get(key);
    if (!group) {
      group = [];
      entryGroupsByKey.set(key, group);
      entryGroups.push(group);
    }
    group.push(entry);
  }

  const showSourceName = sourceAttributions.size > 1;
  for (const group of entryGroups) {
    const entry = group[0];
    const item = make("article", "nt-dict-entry");
    if (result.segmented) {
      const entryTitle = make("div", "nt-dict-entry-title");
      entryTitle.append(make("strong", "", entry.headword));
      if (entry.reading) entryTitle.append(make("span", "", entry.reading));
      const label = `${copy("pronounce")}: ${entry.headword}`;
      const listenButton = createSpeechButton(
        entry.headword,
        entry.language || result.sourceLanguage,
        "nt-dict-icon-button nt-dict-entry-listen",
        label,
      );
      entryTitle.append(listenButton);
      item.append(entryTitle);
    }
    appendSense(item, entry, showSourceName, result.targetLanguage);
    if (group.length > 1) {
      const alternatives = make("details", "nt-dict-other");
      alternatives.append(make("summary", "", `${copy("otherMeanings")} · ${group.length - 1}`));
      for (const alternative of group.slice(1)) {
        const sense = make("div", "nt-dict-other-sense");
        appendSense(sense, alternative, showSourceName, result.targetLanguage);
        alternatives.append(sense);
      }
      item.append(alternatives);
    }
    body.append(item);
  }

  if (!error && !(result?.entries?.length || result?.personalEntries?.length)) body.append(make("p", "nt-dict-state", copy("empty")));
  if (sourceAttributions.size) {
    const attribution = make("details", "nt-dict-attribution");
    const list = make("div", "nt-dict-attribution-list");
    attribution.append(make("summary", "", copy("sourceAndLicense")));
    for (const source of sourceAttributions.values()) {
      const label = [source.sourceName, source.license && `(${source.license})`].filter(Boolean).join(" ");
      list.append(make("small", "", label));
    }
    attribution.append(list);
    body.append(attribution);
  }
  mount(head, body, result ? makeFooter(result) : null, previousScrollTop);
}

function applyPayload(nextPayload) {
  if (!nextPayload) return;
  if (nextPayload.phase !== "loading" && currentRequestId && nextPayload.requestId !== currentRequestId) return;
  cancelSpeech();
  payload = nextPayload;
  uiLanguage = resolveUiLanguage(nextPayload.uiLanguage);
  document.documentElement.lang = uiLanguage === "zh" ? "zh-CN" : uiLanguage === "zh-Hant" ? "zh-TW" : uiLanguage;
  document.documentElement.dir = "ltr";
  shell.setAttribute("aria-label", copy("dictionary"));
  if (nextPayload.phase === "loading") {
    currentRequestId = nextPayload.requestId;
    renderLoading(nextPayload);
  } else if (nextPayload.phase === "ready") {
    renderResult(nextPayload.result);
  } else {
    renderResult({ query: nextPayload.query, entries: [], personalEntries: [], sourceLanguage: "", targetLanguage: nextPayload.targetLanguage }, nextPayload.error || copy("failed"));
  }
}

async function initialize() {
  if (!invoke || !listen) return;
  await listen("dictionary-window-state", event => applyPayload(event.payload));
  const initial = await invoke("dictionary_window_state_get").catch(() => null);
  if (initial) applyPayload(initial);
}

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeWindow();
});
window.addEventListener("beforeunload", () => { cleanupScroll(); cancelSpeech(); });
initialize();
