import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { filterLanguageOptions } from "../language-search.mjs";
import { LANGUAGE_OPTIONS } from "../languages.mjs";

const [settingsScript, settingsStyles, trayScript, trayStyles, outgoingSource] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../app.css", import.meta.url), "utf8"),
  readFile(new URL("../tray.js", import.meta.url), "utf8"),
  readFile(new URL("../tray.css", import.meta.url), "utf8"),
  readFile(new URL("../../src-tauri/src/outgoing.rs", import.meta.url), "utf8"),
]);

test("language search matches native names, codes, and English names", () => {
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "Português").map(([code]) => code), ["pt-BR"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "pt-br").map(([code]) => code), ["pt-BR"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "Brazilian Portuguese").map(([code]) => code), ["pt-BR"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "traditional chinese").map(([code]) => code), ["zh-Hant"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "ukrainian").map(([code]) => code), ["uk"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "ไทย").map(([code]) => code), ["th"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "Filipino").map(([code]) => code), ["fil"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "বাংলা").map(([code]) => code), ["bn"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "اردو").map(([code]) => code), ["ur"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "தமிழ்").map(([code]) => code), ["ta"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "فارسی").map(([code]) => code), ["fa"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "עברית").map(([code]) => code), ["he"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "Cestina").map(([code]) => code), ["cs"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "없는 언어"), []);
});

test("language search matches both language and representative country codes", () => {
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "ja").map(([code]) => code), ["ja"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "jp").map(([code]) => code), ["ja"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "hi").map(([code]) => code), ["hi"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "in").map(([code]) => code), ["hi", "ta"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "vi").map(([code]) => code), ["vi"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "vn").map(([code]) => code), ["vi"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "th").map(([code]) => code), ["th"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "ph").map(([code]) => code), ["fil"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "bd").map(([code]) => code), ["bn"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "pk").map(([code]) => code), ["ur"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "ir").map(([code]) => code), ["fa"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "il").map(([code]) => code), ["he"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "cz").map(([code]) => code), ["cs"]);
});

test("Japanese uses the ISO language code JA as its compact label", () => {
  const japanese = LANGUAGE_OPTIONS.find(([code]) => code === "ja");
  assert.equal(japanese?.[2], "JA");
});

test("right-to-left language options align with the right-hand list edge", () => {
  for (const language of ["ar", "ur", "fa", "he"]) {
    assert.match(settingsStyles, new RegExp(`\\.select-option\\[data-value="${language}"\\]`));
    assert.match(trayStyles, new RegExp(`\\.language-option\\[data-language="${language}"\\]`));
    assert.match(outgoingSource, new RegExp(`data-value=\\"${language}\\"`));
  }
  assert.match(settingsStyles, /text-align:\s*right/);
  assert.match(trayStyles, /text-align:\s*right/);
  assert.match(outgoingSource, /justify-content:flex-end[^\n]+text-align:right/);
});

test("language search is accent-insensitive", () => {
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "francais").map(([code]) => code), ["fr"]);
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "turkce").map(([code]) => code), ["tr"]);
});

test("all language menus expose a search box and empty-result state", () => {
  assert.match(settingsScript, /className = "select-search-input"/);
  assert.match(settingsScript, /className = "select-search-empty"/);
  assert.match(trayScript, /id="tray-language-search"/);
  assert.match(trayScript, /id="tray-language-search-empty"/);
  assert.match(outgoingSource, /nt-language-search/);
  assert.match(outgoingSource, /nt-language-search-empty/);
});
