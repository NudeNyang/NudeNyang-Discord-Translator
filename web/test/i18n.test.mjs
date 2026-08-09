import assert from "node:assert/strict";
import test from "node:test";

import { resolveUiLanguage, translateCopy } from "../i18n.mjs";

test("automatic settings language follows supported system locales", () => {
  assert.equal(resolveUiLanguage("auto", "ko-KR"), "ko");
  assert.equal(resolveUiLanguage("auto", "en-US"), "en");
  assert.equal(resolveUiLanguage("auto", "ja-JP"), "ja");
  assert.equal(resolveUiLanguage("auto", "zh-TW"), "zh");
});

test("automatic settings language falls back to English", () => {
  assert.equal(resolveUiLanguage("auto", "fr-FR"), "en");
  assert.equal(resolveUiLanguage("auto", ""), "en");
});

test("automatic language option uses one universal label", () => {
  for (const language of ["ko", "en", "ja", "zh"]) {
    assert.equal(translateCopy(language, "Auto(System)"), "Auto(System)");
  }
});
