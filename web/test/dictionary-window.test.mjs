import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

test("dictionary result localization refresh keeps an active pronunciation request", () => {
  assert.match(windowScript, /nextPayload\.phase === "ready"/);
  assert.match(windowScript, /nextPayload\.requestId === currentRequestId/);
  assert.match(windowScript, /if \(!preserveSpeech\) cancelSpeech\(\)/);
  assert.match(windowScript, /if \(preserveSpeech\) rebindActiveSpeechButton\(\)/);
  assert.match(windowScript, /activeSpeech\.button = replacement/);
});
