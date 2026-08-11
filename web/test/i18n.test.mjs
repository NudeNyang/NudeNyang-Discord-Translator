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
  assert.equal(resolveUiLanguage("auto", "de-DE"), "en");
  assert.equal(resolveUiLanguage("auto", "es-MX"), "en");
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

test("experimental MiLMMT model labels are translated", () => {
  assert.equal(
    translateCopy("en", "MiLMMT 4B Q4 (실험·약 2.9GB)"),
    "MiLMMT 4B Q4 (experimental · about 2.9GB)",
  );
});

test("local engine notices describe every selectable local model", () => {
  assert.equal(translateCopy("en", "VRAM 보호"), "VRAM protection");
  assert.equal(
    translateCopy(
      "ja",
      "로컬 번역 모델과 이미지 OCR은 이 PC에서 처리됩니다. 외부 서비스를 선택하면 번역할 텍스트만 해당 서비스로 전송됩니다.",
    ),
    "ローカル翻訳モデルと画像OCRはこのPC上で処理されます。外部サービスを選択した場合のみ、翻訳するテキストがそのサービスへ送信されます。",
  );
});

test("image translation explanations are translated completely", () => {
  assert.equal(
    translateCopy("ja", "Discord 이미지에서 글자를 감지하고 번역하여 표시합니다."),
    "Discord画像内の文字を検出し、翻訳して表示します。",
  );
  assert.equal(
    translateCopy(
      "ja",
      "실시간 번역이 켜져 있을 때 Discord 이미지의 글자를 PC에서 감지하여 표시 언어로 번역합니다. 번역이 꺼져 있으면 이미지에 별도 버튼이나 안내 문구를 표시하지 않습니다.",
    ),
    "リアルタイム翻訳がオンのとき、Discord画像内の文字をPC上で検出し、表示言語へ翻訳します。翻訳がオフのときは、画像にボタンや案内を表示しません。",
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
