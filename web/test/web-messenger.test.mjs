import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { translateCopy } from "../i18n.mjs";
import { DEFAULT_CONFIG, normalizeConfig } from "../state.mjs";

const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("통합 정책: 별도 웹 메신저 토글 없이 공통 웹 번역 설정을 표시한다", () => {
  const dom = new JSDOM(markup);
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelector("#web-messenger-enabled"), null);
    assert.equal(doc.querySelector("#web-messenger-model-note"), null);
    assert.ok(doc.querySelector("#web-translation-enabled"));
    assert.match(doc.querySelector("#web-messenger-description").textContent, /동의.*앱 설정/);
  } finally { dom.window.close(); }
});

test("이전 메신저 스위치 값이 공통 번역기·웹 설정을 변경하지 않는다", () => {
  assert.equal(Object.hasOwn(DEFAULT_CONFIG, "web_messenger_enabled"), false);
  for (const legacy of [true, false]) {
    const config = normalizeConfig({ web_messenger_enabled: legacy, web_translation_enabled: false, translator: "deepl" });
    assert.equal(config.web_translation_enabled, false);
    assert.equal(config.translator, "deepl");
  }
});

test("메신저 동의·상태 안내가 28개 언어에서 본체와 일치하고 변경된 전송·보관을 설명한다", () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(new URL("../../extension/popup-locales.js", import.meta.url), "utf8"), context);
  const popup = context.NudeNyangPopupLocales;
  const keys = Object.keys(popup.COPY.ko).filter(key => key.startsWith("messenger") || key === "privateBrowsingProviderUnsupported");
  assert.equal(popup.SUPPORTED.length, 28);
  for (const language of popup.SUPPORTED) for (const key of keys) {
    const value = popup.COPY[language][key];
    assert.ok(value?.trim(), `${language}: ${key}`);
    assert.equal(value, translateCopy(language, popup.COPY.ko[key]), `${language}: ${key}`);
    if (language !== "ko") assert.doesNotMatch(value, /[가-힣]/u, `${language}: ${key}`);
  }
  assert.match(popup.COPY.en.messengerPrivacyRetention, /encrypted cache/i);
  assert.match(popup.COPY.en.messengerPrivacyRetention, /30 days/i);
  assert.match(popup.COPY.en.messengerPrivacyRetention, /withdrawing consent does not delete/i);
  assert.match(popup.COPY.en.messengerPrivacyRetention, /Private browsing content is not stored/i);
  assert.match(popup.COPY.en.messengerPrivacyExternal, /ChatGPT, Claude, Gemini or DeepL/i);
  assert.match(popup.COPY.en.messengerPrivacyExternal, /sends conversations to that service/i);
});
