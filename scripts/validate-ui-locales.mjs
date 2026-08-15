import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { COPY, DYNAMIC_TEMPLATE_COPY } from "../web/i18n.mjs";
import { SUPPORTED_TARGET_LANGUAGES } from "../web/languages.mjs";
import { UI_LOCALE_COPY } from "../web/ui-locales.mjs";

const generatedLanguages = SUPPORTED_TARGET_LANGUAGES.filter(
  language => !["ko", "en", "ja", "zh"].includes(language),
);
const sourceCopy = Object.freeze({ ...COPY, ...DYNAMIC_TEMPLATE_COPY });
const expectedKeys = Object.keys(sourceCopy).sort();
const protectedTokens = [
  "NudeNyang Discord Translator", "Discord", "Hy-MT2", "TranslateGemma", "ChatGPT", "Claude",
  "Gemini", "DeepL", "Antigravity", "API", "CLI", "GPU", "CPU", "RAM", "VRAM",
  "F1", "F8", "F12", "F24", "Ctrl", "Alt", "Shift", "Enter", "Esc", "OAuth",
];

const jsonCopy = JSON.parse(readFileSync(new URL("../web/ui-locales.json", import.meta.url), "utf8"));
assert.deepEqual(jsonCopy, UI_LOCALE_COPY, "web module and Rust JSON locale artifacts differ");
assert.deepEqual(Object.keys(UI_LOCALE_COPY).sort(), [...generatedLanguages].sort());

console.log(`Interface source strings: ${expectedKeys.length}`);
for (const language of generatedLanguages) {
  const dictionary = UI_LOCALE_COPY[language];
  assert.deepEqual(Object.keys(dictionary).sort(), expectedKeys, `${language}: incomplete dictionary`);
  let unchangedEnglish = 0;
  for (const key of expectedKeys) {
    const english = sourceCopy[key][0];
    const translated = String(dictionary[key] || "").trim();
    assert.ok(translated, `${language}: empty translation for ${key}`);
    assert.doesNotMatch(translated, /[가-힣]/, `${language}: Korean leaked into ${key}`);
    const sourcePlaceholders = [...english.matchAll(/\{[^}]+\}/g)].map(match => match[0]).sort();
    const targetPlaceholders = [...translated.matchAll(/\{[^}]+\}/g)].map(match => match[0]).sort();
    assert.deepEqual(targetPlaceholders, sourcePlaceholders, `${language}: placeholders changed for ${key}`);
    for (const token of protectedTokens) {
      if (key.includes(token) && english.includes(token)) {
        assert.ok(translated.includes(token), `${language}: ${token} changed in ${key}`);
      }
    }
    if (translated === english && /[A-Za-z]{4}/.test(english)) unchangedEnglish += 1;
    const ratio = [...translated].length / Math.max(1, [...english].length);
    assert.ok(ratio >= 0.12 && ratio <= 6, `${language}: suspicious length ratio ${ratio.toFixed(2)} for ${key}`);
  }
  assert.ok(
    unchangedEnglish <= 10,
    `${language}: too many ordinary English strings were left untranslated (${unchangedEnglish})`,
  );
  console.log(`${language.padEnd(7)} ${expectedKeys.length}/${expectedKeys.length} complete · ${unchangedEnglish} unchanged English strings`);
}

console.log("Interface locale validation passed.");
