import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const config = JSON.parse(readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const controller = readFileSync(new URL("../../src-tauri/src/dictionary_ui.rs", import.meta.url), "utf8");
const controllerRuntime = controller.split("#[cfg(test)]")[0];
const windowScript = readFileSync(new URL("../dictionary.js", import.meta.url), "utf8");
const windowStyle = readFileSync(new URL("../dictionary.css", import.meta.url), "utf8");

const compact = value => value.replace(/\s+/g, "");

test("dictionary results use a frameless native tool window outside Discord", () => {
  const dictionary = config.app.windows.find(window => window.label === "dictionary");
  assert.deepEqual(
    {
      url: dictionary?.url,
      visible: dictionary?.visible,
      decorations: dictionary?.decorations,
      alwaysOnTop: dictionary?.alwaysOnTop,
      skipTaskbar: dictionary?.skipTaskbar,
      width: dictionary?.width,
      height: dictionary?.height,
      resizable: dictionary?.resizable,
    },
    {
      url: "dictionary.html",
      visible: false,
      decorations: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      width: 440,
      height: 480,
      resizable: false,
    },
  );
  assert.match(controllerRuntime, /queue\(\{action:'lookup'/);
  assert.doesNotMatch(controllerRuntime, /loadingBody\(query\); panel\.dataset\.query=query/);
  assert.match(windowScript, /listen\("dictionary-window-state"/);
  assert.match(windowScript, /invoke\("dictionary_window_state_get"\)/);
  assert.match(windowScript, /UI_LOCALE_COPY\[uiLanguage\]/);
  assert.match(windowScript, /document\.documentElement\.dir = "ltr"/);
});

test("native dictionary window preserves the previous popup design language", () => {
  const previous = compact(controller);
  const current = compact(windowStyle);
  for (const token of [
    "border-radius:16px",
    "padding:17px18px13px",
    "font-size:22px",
    "padding:4px18px18px",
    "padding:11px18px14px",
    "width:3px",
    "width:6px",
  ]) {
    assert.match(previous, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(current, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(current, /grid-template-rows:autominmax\(0,1fr\)auto/);
  assert.match(windowStyle, /\.nt-dict-footer/);
});

test("dictionary header omits the redundant close button and keeps Escape dismissal", () => {
  assert.doesNotMatch(windowScript, /const closeButton = make\("button"/);
  assert.match(windowScript, /event\.key === "Escape"/);
});

test("dictionary pronunciation stops immediately and restarts from the beginning", () => {
  assert.match(windowScript, /createSpeechButton\(/);
  assert.match(windowScript, /invoke\("dictionary_speech_play"/);
  assert.match(windowScript, /await invoke\("dictionary_speech_stop"/);
  assert.match(windowScript, /speechSynthesis\.cancel\(\)/);
  assert.doesNotMatch(windowScript, /dictionary_speech_pause/);
  assert.doesNotMatch(windowScript, /dictionary_speech_resume/);
  assert.doesNotMatch(windowScript, /speechSynthesis\.pause\(\)/);
  assert.doesNotMatch(windowScript, /speechSynthesis\.resume\(\)/);
  assert.match(windowScript, /listen\("dictionary-speech-ended"/);
  assert.match(windowScript, /copy\("pausePronunciation"\)/);
  assert.match(windowScript, /copy\("restartPronunciation"\)/);
});

test("dictionary pronunciation uses the borderless product tooltip", () => {
  assert.match(windowScript, /button\.dataset\.tooltip = label/);
  assert.doesNotMatch(windowScript, /button\.title = label/);
  assert.match(windowStyle, /\.nt-dict-icon-button\[data-tooltip\]::after\s*\{[^}]*border:\s*0;[^}]*content:\s*attr\(data-tooltip\);/s);
  assert.match(windowStyle, /\.nt-dict-icon-button\[data-tooltip\]:is\(:hover, :focus-visible\)::after/);
});

test("dictionary result localization refresh keeps an active pronunciation request", () => {
  assert.match(windowScript, /nextPayload\.phase === "ready"/);
  assert.match(windowScript, /nextPayload\.requestId === currentRequestId/);
  assert.match(windowScript, /if \(!preserveSpeech\) cancelSpeech\(\)/);
  assert.match(windowScript, /if \(preserveSpeech\) rebindActiveSpeechButton\(\)/);
  assert.match(windowScript, /activeSpeech\.button = replacement/);
});

test("missing offline dictionary packs install inline and retry the same lookup", () => {
  assert.match(windowScript, /result\?\.availablePack/);
  assert.match(windowScript, /invoke\("dictionary_pack_install", \{ language: pack\.language \}\)/);
  assert.match(windowScript, /invoke\("dictionary_window_lookup_retry"\)/);
  assert.match(windowScript, /listen\("dictionary-pack-progress"/);
  assert.match(windowScript, /copy\("installPack"\)/);
  assert.match(windowStyle, /\.nt-dict-pack-install/);
  assert.match(windowStyle, /\.nt-dict-progress/);
});

test("installed dictionaries with no match keep the ordinary empty state", () => {
  assert.match(windowScript, /if \(result\?\.availablePack\)/);
  assert.match(windowScript, /else body\.append\(make\("p", "nt-dict-state", copy\("empty"\)\)\)/);
});

test("dictionary pack install card runs installation and automatic lookup retry", async () => {
  const dom = new JSDOM('<section id="dictionary-shell"></section>', { url: "https://dictionary.local" });
  const listeners = new Map();
  const calls = [];
  const result = {
    query: "調べ",
    sourceLanguage: "ja",
    targetLanguage: "ko",
    selectionTranslation: "조사",
    localizationPending: false,
    availablePack: { language: "ja", entryCount: 584460, compressedBytes: 10220505 },
    segmented: false,
    entries: [],
    personalEntries: [],
  };
  const payload = {
    requestId: "dictionary-test",
    phase: "ready",
    query: result.query,
    uiLanguage: "ko",
    targetLanguage: "ko",
    externalEnabled: true,
    result,
    error: "",
  };
  dom.window.requestAnimationFrame = callback => { callback(); return 1; };
  dom.window.cancelAnimationFrame = () => {};
  dom.window.CSS.escape = value => String(value).replaceAll('"', '\\"');
  dom.window.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        calls.push([command, args]);
        if (command === "dictionary_window_state_get") return payload;
        if (command === "dictionary_pack_install") {
          listeners.get("dictionary-pack-progress")?.({
            payload: { language: "ja", phase: "installing", processed: 50, total: 100 },
          });
          listeners.get("dictionary-pack-progress")?.({
            payload: { language: "ja", phase: "complete", processed: 100, total: 100 },
          });
        }
        return null;
      },
    },
    event: {
      listen: async (name, listener) => { listeners.set(name, listener); return () => {}; },
    },
  };
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    CSS: globalThis.CSS,
    AbortController: globalThis.AbortController,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.CSS = dom.window.CSS;
  globalThis.AbortController = dom.window.AbortController;
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame;
  try {
    await import(`${new URL("../dictionary.js", import.meta.url).href}?test=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 0));
    const card = dom.window.document.querySelector('.nt-dict-pack-install[data-language="ja"]');
    assert.ok(card);
    assert.match(card.textContent, /일본어 · 오프라인 사전/);
    assert.match(card.textContent, /584,460 항목/);

    card.querySelector(".nt-dict-pack-button").click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(
      calls.filter(([command]) => command !== "dictionary_window_state_get"),
      [
        ["dictionary_pack_install", { language: "ja" }],
        ["dictionary_window_lookup_retry", undefined],
      ],
    );
    assert.equal(card.querySelector(".nt-dict-progress").getAttribute("aria-valuenow"), "100");
    assert.equal(card.querySelector(".nt-dict-pack-button").disabled, true);

    listeners.get("dictionary-window-state")({
      payload: { ...payload, result: { ...result, availablePack: null } },
    });
    assert.equal(dom.window.document.querySelector(".nt-dict-pack-install"), null);
    assert.match(dom.window.document.querySelector(".nt-dict-state").textContent, /일치하는 표현/);
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.CSS = previous.CSS;
    globalThis.AbortController = previous.AbortController;
    globalThis.requestAnimationFrame = previous.requestAnimationFrame;
    globalThis.cancelAnimationFrame = previous.cancelAnimationFrame;
    dom.window.close();
  }
});
