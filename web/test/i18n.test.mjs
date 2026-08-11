import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveUiLanguage,
  translateCopy,
  translateDynamicCopy,
} from "../i18n.mjs";

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

test("app information copy is translated completely", () => {
  assert.equal(translateCopy("ja", "버전"), "バージョン");
  assert.equal(
    translateCopy("ja", "GNU GPL v3에 따라 이용 가능하며 별도 보증은 제공되지 않습니다."),
    "GNU GPL v3に基づいて利用でき、保証はありません。",
  );
  assert.equal(
    translateDynamicCopy("ja", "현재 베타 버전이 최신입니다."),
    "現在のベータ版は最新です。",
  );
});

test("runtime notices keep model details while following the interface language", () => {
  assert.equal(
    translateDynamicCopy(
      "ja",
      "선택한 번역 모델: Hy-MT2 7B Q4 (품질·약 4.6GB). 번역 준비가 완료되었습니다.",
    ),
    "選択した翻訳モデル: Hy-MT2 7B Q4（品質・約4.6GB）。翻訳の準備が完了しました。",
  );
});

test("quality-first Codex model labels are translated", () => {
  assert.equal(
    translateCopy("en", "GPT-5.6 (품질 최우선)"),
    "GPT-5.6 (quality first)",
  );
  assert.equal(
    translateCopy("ja", "GPT-5.6 (품질 최우선)"),
    "GPT-5.6（品質最優先）",
  );
});

test("update prompts preserve the version while following the interface language", () => {
  assert.equal(
    translateDynamicCopy(
      "en",
      "0.3.6-beta 버전을 설치할 수 있습니다. 지금 설치하면 앱이 다시 실행됩니다. 작업 중이라면 나중에 설치해도 됩니다.",
    ),
    "Version 0.3.6-beta is available. Installing it now will restart the app. You can install it later if you are working.",
  );
});
