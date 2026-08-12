import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveUiLanguage,
  translateCopy,
  translateDynamicCopy,
  translateUserFacingError,
} from "../i18n.mjs";
import { readFile } from "node:fs/promises";

const appScript = await readFile(new URL("../app.js", import.meta.url), "utf8");
const settingsMarkup = await readFile(new URL("../index.html", import.meta.url), "utf8");

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

test("settings header describes message, image, and app behavior configuration", () => {
  assert.equal(
    translateCopy("en", "Discord 메시지·이미지 번역과 앱 동작을 설정합니다."),
    "Configure Discord message and image translation, and app behavior.",
  );
  assert.equal(
    translateCopy("ja", "Discord 메시지·이미지 번역과 앱 동작을 설정합니다."),
    "Discordのメッセージ・画像翻訳とアプリの動作を設定します。",
  );
});

test("automatic language option uses one universal label", () => {
  for (const language of ["ko", "en", "ja", "zh"]) {
    assert.equal(translateCopy(language, "Auto(System)"), "Auto(System)");
  }
});

test("app information copy is translated completely", () => {
  assert.equal(translateCopy("ja", "버전"), "バージョン");
  assert.equal(
    translateCopy("en", "앱 버전과 업데이트를 확인하고, 진단 로그·초기화·라이선스를 관리합니다."),
    "Check the app version and updates, and manage diagnostic logs, reset options, and licenses.",
  );
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

test("outgoing local model speed labels follow the interface language", () => {
  assert.equal(
    translateCopy("en", "Hy-MT2 1.8B Q4 (로컬·속도 우선)"),
    "Hy-MT2 1.8B Q4 (local · speed first)",
  );
  assert.equal(
    translateCopy("ja", "TranslateGemma 4B Q4 (실험·속도 우선)"),
    "TranslateGemma 4B Q4（実験・速度優先）",
  );
});

test("local engine notices describe every selectable local model", () => {
  assert.equal(translateCopy("en", "VRAM 보호"), "VRAM protection");
  assert.equal(
    translateCopy(
      "ja",
      "로컬 모델은 하나만 실행됩니다. 표시 번역과 보내는 메시지 통역의 로컬 모델 선택은 함께 변경됩니다.",
    ),
    "ローカルモデルは一つだけ実行されます。表示翻訳と送信メッセージ通訳のローカルモデル選択は連動して変更されます。",
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

test("global shortcut registration errors are localized without raw platform diagnostics", () => {
  const source = "Shift+F12 전역 단축키를 등록하지 못했습니다: HotKey already registered: HotKey { mods: Modifiers(SHIFT), key: F12, id: 33554603 }";
  assert.equal(
    translateUserFacingError("ja", source),
    "Shift+F12 グローバルショートカットを登録できませんでした。このショートカットは別のアプリですでに使用されています。別の組み合わせを選択してください。",
  );
  assert.equal(
    translateUserFacingError("en", source),
    "Could not register the Shift+F12 global shortcut. Another app is already using this shortcut. Choose a different combination.",
  );
  assert.doesNotMatch(translateUserFacingError("zh", source), /[가-힣]|HotKey \{/);
});

test("every literal settings error title has translations", () => {
  const titles = [...appScript.matchAll(/showError\(\s*"([^"]+)"/g)].map(match => match[1]);
  assert.ok(titles.length >= 15);
  for (const title of titles) {
    assert.notEqual(translateDynamicCopy("ja", title), title, title);
    assert.notEqual(translateDynamicCopy("en", title), title, title);
    assert.notEqual(translateDynamicCopy("zh", title), title, title);
  }
});

test("unknown backend errors use a localized safe fallback instead of leaking another UI language", () => {
  for (const language of ["en", "ja", "zh"]) {
    const translated = translateUserFacingError(language, "내부 저장소의 알 수 없는 오류입니다: opaque detail");
    assert.doesNotMatch(translated, /[가-힣]/);
    assert.match(translated, /opaque detail/);
  }
});

test("settings script routes backend errors and direct status copy through localization", () => {
  assert.match(appScript, /translateUserFacingError\(currentUiLanguage\(\), message\)/);
  assert.match(appScript, /setLocalizedBackendText\(status\.querySelector\("span"\), connection\.detail\)/);
  assert.match(appScript, /setLocalizedBackendText\(elements\.saveStatus, status\.notice\)/);
  const directKoreanAssignments = appScript
    .split(/\r?\n/)
    .filter(line => /\.textContent\s*=/.test(line) && /[가-힣]/.test(line))
    .filter(line => !/translate(?:Copy|DynamicCopy)/.test(line));
  assert.deepEqual(directKoreanAssignments, []);
});

test("every static Korean settings label and accessibility attribute has translations", () => {
  const leafText = [...settingsMarkup.matchAll(/<(?:h1|h2|h3|p|span|strong|b|button|small)[^>]*>([^<>]*[가-힣][^<>]*)<\//g)]
    .map(match => match[1].trim())
    .filter(Boolean);
  const attributes = [...settingsMarkup.matchAll(/(?:aria-label|placeholder)="([^"]*[가-힣][^"]*)"/g)]
    .map(match => match[1].trim());
  for (const value of [...new Set([...leafText, ...attributes])]) {
    assert.notEqual(translateCopy("ja", value), value, value);
    assert.notEqual(translateCopy("en", value), value, value);
    assert.notEqual(translateCopy("zh", value), value, value);
  }
});

test("backend runtime notices and provider details do not leak Korean into other UI languages", () => {
  const samples = [
    "로컬 모델은 번역 기능을 켤 때 준비합니다.",
    "표시 언어를 변경했습니다.",
    "이미지 OCR과 번역을 처리하고 있습니다. 최초 실행 시에는 모델 준비에 시간이 걸릴 수 있습니다.",
    "번역 서비스가 요청한 메시지 수와 다른 결과를 반환했습니다.",
    "캐시된 이미지 번역을 적용했습니다.",
    "번역할 이미지 텍스트를 찾지 못했습니다.",
    "이미지에서 3개 글자 영역을 번역했습니다.",
    "표시 번역은 Hy-MT2 1.8B Q4 (경량·기본), 실시간 통역은 Claude (품질 최우선)을 사용합니다.",
    "ChatGPT 계정으로 연결되어 있습니다.",
    "Codex CLI는 설치되어 있지만 ChatGPT 로그인이 필요합니다.",
    "Gemini가 Google Antigravity 플랜 계정으로 연결되어 있습니다.",
    "Google Antigravity CLI는 설치되어 있지만 로그인이 필요합니다.",
    "Claude 계정으로 연결되어 있습니다.",
    "Claude Code는 설치되어 있지만 Claude 로그인이 필요합니다.",
    "API 키가 운영체제 보안 저장소에 저장되어 있습니다.",
    "DeepL API Free 또는 Pro 키를 입력하여 연결하십시오.",
  ];
  for (const language of ["en", "ja", "zh"]) {
    for (const sample of samples) {
      assert.doesNotMatch(translateDynamicCopy(language, sample), /[가-힣]/, sample);
    }
  }
});

test("every literal localized status assignment has translations", () => {
  const values = [...appScript.matchAll(/setLocalizedText\([^,\n]+,\s*"([^"]*[가-힣][^"]*)"/g)]
    .map(match => match[1]);
  for (const value of [...new Set(values)]) {
    assert.notEqual(translateDynamicCopy("ja", value), value, value);
    assert.notEqual(translateDynamicCopy("en", value), value, value);
    assert.notEqual(translateDynamicCopy("zh", value), value, value);
  }
});
