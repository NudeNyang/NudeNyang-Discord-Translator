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
  assert.deepEqual(filterLanguageOptions(LANGUAGE_OPTIONS, "없는 언어"), []);
});

test("Arabic language names keep RTL glyph order while aligning with the left-hand list edge", () => {
  assert.match(settingsStyles, /\.select-option:dir\(rtl\)\s*\{\s*text-align:\s*left;/);
  assert.match(trayStyles, /\.language-option\s*\{[^}]*direction:\s*ltr;[^}]*text-align:\s*left;/s);
  assert.match(outgoingSource, /nt-outgoing-menu button[^\n]+text-align:left/);
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
