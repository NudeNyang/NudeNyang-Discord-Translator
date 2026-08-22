import assert from "node:assert/strict";
import test from "node:test";

import { canonicalSpeechLanguage, selectSpeechVoice } from "../dictionary-speech.mjs";

const voice = (lang, name, localService = true, isDefault = false) => ({
  lang,
  name,
  localService,
  default: isDefault,
});

test("dictionary speech maps every supported source language to a regional voice locale", () => {
  const expected = {
    ko: "ko-KR", en: "en-US", ja: "ja-JP", zh: "zh-CN", "zh-Hant": "zh-TW",
    "pt-BR": "pt-BR", hi: "hi-IN", "es-419": "es-MX", de: "de-DE", ru: "ru-RU",
    id: "id-ID", fr: "fr-FR", tr: "tr-TR", ar: "ar-SA", vi: "vi-VN", it: "it-IT",
    pl: "pl-PL", uk: "uk-UA", ms: "ms-MY", nl: "nl-NL", th: "th-TH", fil: "fil-PH",
    bn: "bn-BD", ur: "ur-PK", ta: "ta-IN", fa: "fa-IR", he: "he-IL", cs: "cs-CZ",
  };

  for (const [language, locale] of Object.entries(expected)) {
    assert.equal(canonicalSpeechLanguage(language), locale, language);
  }
});

test("dictionary speech selects a voice from the source language instead of the UI language", () => {
  const voices = [
    voice("ko-KR", "Korean announcer"),
    voice("en-GB", "British announcer"),
    voice("en-US", "American announcer"),
    voice("ja-JP", "Japanese announcer"),
    voice("zh-CN", "Chinese mainland announcer"),
    voice("zh-TW", "Chinese Taiwan announcer"),
  ];

  assert.equal(selectSpeechVoice(voices, "en")?.name, "American announcer");
  assert.equal(selectSpeechVoice(voices, "ko")?.name, "Korean announcer");
  assert.equal(selectSpeechVoice(voices, "ja")?.name, "Japanese announcer");
  assert.equal(selectSpeechVoice(voices, "zh")?.name, "Chinese mainland announcer");
  assert.equal(selectSpeechVoice(voices, "zh-Hant")?.name, "Chinese Taiwan announcer");
});

test("dictionary speech does not force an unrelated installed voice", () => {
  assert.equal(selectSpeechVoice([voice("en-US", "English")], "ko"), null);
});
