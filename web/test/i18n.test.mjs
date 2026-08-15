import assert from "node:assert/strict";
import test from "node:test";

import {
  COPY,
  DYNAMIC_COPY,
  DYNAMIC_TEMPLATE_COPY,
  resolveUiLanguage,
  translateCopy,
  translateDynamicCopy,
  translateUserFacingError,
} from "../i18n.mjs";
import { UI_LOCALE_COPY } from "../ui-locales.mjs";
import { SUPPORTED_TARGET_LANGUAGES } from "../languages.mjs";
import { readFile } from "node:fs/promises";

const appScript = await readFile(new URL("../app.js", import.meta.url), "utf8");
const settingsMarkup = await readFile(new URL("../index.html", import.meta.url), "utf8");
const i18nSource = await readFile(new URL("../i18n.mjs", import.meta.url), "utf8");

test("automatic settings language follows supported system locales", () => {
  assert.equal(resolveUiLanguage("auto", "ko-KR"), "ko");
  assert.equal(resolveUiLanguage("auto", "en-US"), "en");
  assert.equal(resolveUiLanguage("auto", "ja-JP"), "ja");
  assert.equal(resolveUiLanguage("auto", "zh-TW"), "zh-Hant");
  assert.equal(resolveUiLanguage("auto", "zh-CN"), "zh");
  assert.equal(resolveUiLanguage("auto", "pt-PT"), "pt-BR");
  assert.equal(resolveUiLanguage("auto", "es-MX"), "es-419");
  assert.equal(resolveUiLanguage("auto", "th-TH"), "th");
  assert.equal(resolveUiLanguage("auto", "fil-PH"), "fil");
  assert.equal(resolveUiLanguage("auto", "bn-BD"), "bn");
  assert.equal(resolveUiLanguage("auto", "ur-PK"), "ur");
  assert.equal(resolveUiLanguage("auto", "ta-IN"), "ta");
  assert.equal(resolveUiLanguage("auto", "fa-IR"), "fa");
  assert.equal(resolveUiLanguage("auto", "he-IL"), "he");
  assert.equal(resolveUiLanguage("auto", "cs-CZ"), "cs");
});

test("automatic settings language falls back to English", () => {
  assert.equal(resolveUiLanguage("auto", "fr-FR"), "fr");
  assert.equal(resolveUiLanguage("auto", "de-DE"), "de");
  assert.equal(resolveUiLanguage("auto", ""), "en");
});

test("Arabic interface copy keeps the shared left-to-right settings layout", () => {
  assert.match(i18nSource, /document\.documentElement\.dir = "ltr"/);
  assert.doesNotMatch(i18nSource, /document\.documentElement\.dir = language === "ar" \? "rtl" : "ltr"/);
});

test("all twenty-eight interface languages have complete static dictionaries", () => {
  const generatedLanguages = SUPPORTED_TARGET_LANGUAGES.filter(language => !["ko", "en", "ja", "zh"].includes(language));
  const sourceCopy = { ...COPY, ...DYNAMIC_TEMPLATE_COPY };
  const expectedKeys = Object.keys(sourceCopy).sort();
  assert.deepEqual(Object.keys(UI_LOCALE_COPY).sort(), generatedLanguages.sort());
  for (const language of generatedLanguages) {
    const dictionary = UI_LOCALE_COPY[language];
    let unchangedEnglish = 0;
    assert.deepEqual(Object.keys(dictionary).sort(), expectedKeys, language);
    for (const [key, value] of Object.entries(dictionary)) {
      assert.ok(value.trim(), `${language}: ${key}`);
      assert.doesNotMatch(value, /[가-힣]/, `${language}: ${key}`);
      const sourcePlaceholders = [...sourceCopy[key][0].matchAll(/\{[^}]+\}/g)].map(match => match[0]).sort();
      const targetPlaceholders = [...value.matchAll(/\{[^}]+\}/g)].map(match => match[0]).sort();
      assert.deepEqual(targetPlaceholders, sourcePlaceholders, `${language}: ${key}`);
      if (value === sourceCopy[key][0] && /[A-Za-z]{4}/.test(sourceCopy[key][0])) unchangedEnglish += 1;
    }
    assert.ok(unchangedEnglish <= 10, `${language}: ${unchangedEnglish} ordinary English strings remain`);
  }
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

test("UI Language and Auto (System) stay universal", () => {
  for (const language of SUPPORTED_TARGET_LANGUAGES) {
    assert.equal(translateCopy(language, "UI Language"), "UI Language");
    assert.equal(translateCopy(language, "Auto (System)"), "Auto (System)");
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
    for (const language of SUPPORTED_TARGET_LANGUAGES.filter(language => language !== "ko")) {
      assert.notEqual(translateDynamicCopy(language, title), title, `${language}: ${title}`);
    }
  }
});

test("unknown backend errors use a localized safe fallback instead of leaking another UI language", () => {
  for (const language of SUPPORTED_TARGET_LANGUAGES.filter(language => language !== "ko")) {
    const translated = translateUserFacingError(language, "내부 저장소의 알 수 없는 오류입니다: opaque detail");
    assert.doesNotMatch(translated, /[가-힣]/);
    assert.match(translated, /opaque detail/);
  }
});

test("provider connection and CLI installer failures remain actionable in every UI language", () => {
  const samples = [
    "다른 번역 서비스 연결이 진행 중입니다. 현재 연결이 끝난 후 다시 시도하십시오.",
    "다른 계정 로그인이 이미 진행 중입니다.",
    "Windows 앱 설치 관리자가 CLI 설치를 완료하지 못했습니다. 진단 로그에서 설치 관리자 메시지를 확인한 후 다시 시도하십시오.",
  ];
  for (const language of SUPPORTED_TARGET_LANGUAGES.filter(language => language !== "ko")) {
    for (const sample of samples) {
      const translated = translateUserFacingError(language, sample);
      assert.doesNotMatch(translated, /[가-힣]/, `${language}: ${sample}`);
      assert.notEqual(
        translated,
        translateCopy(language, "예기치 않은 오류가 발생했습니다. 자세한 내용은 진단 로그를 확인하십시오."),
        `${language}: actionable error fell back to the generic message`,
      );
    }
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
  const attributes = [...settingsMarkup.matchAll(/(?:aria-label|placeholder|title|data-tooltip)="([^"]*[가-힣][^"]*)"/g)]
    .map(match => match[1].trim());
  for (const value of [...new Set([...leafText, ...attributes])]) {
    for (const language of SUPPORTED_TARGET_LANGUAGES.filter(language => language !== "ko")) {
      assert.notEqual(translateCopy(language, value), value, `${language}: ${value}`);
    }
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
  for (const language of SUPPORTED_TARGET_LANGUAGES.filter(language => language !== "ko")) {
    for (const sample of samples) {
      assert.doesNotMatch(translateDynamicCopy(language, sample), /[가-힣]/, sample);
    }
  }
});

test("restart countdown and generic errors stay in every selected interface language", () => {
  const restart = [
    "Discord가 아직 접근성 호환 모드로 실행되지 않았습니다.",
    "작성 중인 메시지가 사라지거나 통화가 종료될 수 있습니다.",
    "",
    "15초 후 최초 전환을 위해 Discord를 한 번 다시 시작합니다.",
  ].join("\n");
  const englishRestart = translateDynamicCopy("en", restart);
  const englishError = translateUserFacingError("en", "내부 저장소의 알 수 없는 오류입니다");
  for (const language of SUPPORTED_TARGET_LANGUAGES.filter(language => !["ko", "en"].includes(language))) {
    const localizedRestart = translateDynamicCopy(language, restart);
    const localizedError = translateUserFacingError(language, "내부 저장소의 알 수 없는 오류입니다");
    assert.notEqual(localizedRestart, englishRestart, `${language}: restart countdown fell back to English`);
    assert.notEqual(localizedError, englishError, `${language}: generic error fell back to English`);
    assert.doesNotMatch(localizedRestart, /[가-힣]/, language);
    assert.doesNotMatch(localizedError, /[가-힣]/, language);
  }
});

test("every dynamic runtime message has a non-English generated-locale rendering", () => {
  const samples = [
    "7초 후 Discord를 자동으로 다시 시작합니다.",
    "이미지에서 3개 글자 영역을 번역했습니다.",
    "표시 번역은 Hy-MT2 1.8B, 실시간 통역은 Claude을 사용합니다.",
    "Hy-MT2 7B 준비를 백그라운드에서 시작했습니다. 완료 전까지 현재 모델로 계속 번역합니다.",
    "번역 모델 준비 실패: 내부 오류",
    "이미지를 읽지 못했습니다: 내부 오류",
    "이미지 번역에 실패했습니다: 내부 오류",
    "로컬 모델 예열에 실패했습니다: 내부 오류",
    [
      "Discord가 아직 접근성 호환 모드로 실행되지 않았습니다.",
      "작성 중인 메시지가 사라지거나 통화가 종료될 수 있습니다.",
      "",
      "9초 후 최초 전환을 위해 Discord를 한 번 다시 시작합니다.",
    ].join("\n"),
    "Claude CLI와 필요한 실행 환경을 자동으로 설치하고 있습니다.",
    "ChatGPT 계정 연결",
    "Claude CLI 로그인 정보는 유지되며 NudeNyang Discord Translator에서만 사용을 중지했습니다.",
    "ChatGPT 공식 로그인 페이지를 준비하고 있습니다. 잠시 기다리십시오.",
    "Claude 계정 로그인을 취소하고 있습니다.",
    "ChatGPT 공식 로그인 페이지로 이동하려면 이동을 선택하십시오.",
    "브라우저에서 ChatGPT 로그인을 완료하십시오.\n로그인이 완료되면 이 창이 자동으로 닫힙니다.",
    "Claude 연결을 해제하시겠습니까?",
    "F12로 적용되었습니다.",
    "F12 적용 중",
    "로컬 모델 파일 1.2GB를 삭제했습니다.",
    "번역 기록 12건을 정리했습니다.",
    "Hy-MT2 7B 모델 다운로드 중",
    "Hy-MT2 7B 모델 파일 확인 중",
    "Hy-MT2 7B 모델 불러오는 중",
    "Hy-MT2 7B 모델 준비 대기 중",
    "Hy-MT2 7B CPU/RAM 전용 모드로 전환 중",
    "1.2GB / 4.6GB 다운로드됨",
    "4.6GB 다운로드 완료 · 파일 무결성을 확인하고 있습니다.",
    "4.6GB 다운로드 완료 · 번역 엔진을 준비하고 있습니다.",
    "같은 로컬 모델 준비 작업이 끝나기를 기다리고 있습니다.",
    "선택한 번역 모델: Hy-MT2 7B. 번역 준비가 완료되었습니다.",
    "선택한 번역 모델: Hy-MT2 7B. 번역을 켜면 모델을 준비합니다.",
    "새 버전 0.5.2을 사용할 수 있습니다.",
    "0.5.2 버전을 설치할 수 있습니다. 지금 설치하면 앱이 다시 실행됩니다. 작업 중이라면 나중에 설치해도 됩니다.",
    "0.5.2 업데이트를 다운로드하고 있습니다...",
    "업데이트 다운로드 중 52%",
    "업데이트 확인 실패: 내부 오류",
    "업데이트 설치 실패: 내부 오류",
  ];
  for (const entry of DYNAMIC_COPY) {
    assert.ok(samples.some(sample => entry.pattern.test(sample)), `missing sample for ${entry.pattern}`);
  }
  for (const language of SUPPORTED_TARGET_LANGUAGES.filter(language => !["ko", "en", "ja", "zh"].includes(language))) {
    for (const sample of samples) {
      const english = translateDynamicCopy("en", sample);
      const localized = translateDynamicCopy(language, sample);
      assert.notEqual(localized, english, `${language}: ${sample}`);
      assert.doesNotMatch(localized, /[가-힣]/, `${language}: ${sample}`);
    }
  }
});

test("the original-message runtime name is localized in every interface language", () => {
  for (const language of SUPPORTED_TARGET_LANGUAGES.filter(language => language !== "ko")) {
    const localized = translateCopy(language, "원문");
    assert.notEqual(localized, "원문", language);
    assert.doesNotMatch(localized, /[가-힣]/, language);
  }
  assert.match(appScript, /translateCopy\(language, runtimeName\)/);
});

test("every literal localized status assignment has translations", () => {
  const values = [...appScript.matchAll(/setLocalizedText\([^,\n]+,\s*"([^"]*[가-힣][^"]*)"/g)]
    .map(match => match[1]);
  for (const value of [...new Set(values)]) {
    for (const language of SUPPORTED_TARGET_LANGUAGES.filter(language => language !== "ko")) {
      assert.notEqual(translateDynamicCopy(language, value), value, `${language}: ${value}`);
    }
  }
});

test("Discord connection warning follows every selected interface language", () => {
  for (const language of SUPPORTED_TARGET_LANGUAGES.filter(language => language !== "ko")) {
    const localized = translateCopy(language, "연결 확인 필요");
    assert.notEqual(localized, "연결 확인 필요", language);
    assert.doesNotMatch(localized, /[가-힣]/, language);
  }
});
