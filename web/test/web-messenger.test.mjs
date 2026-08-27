import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { translateCopy } from "../i18n.mjs";
import * as stateUtils from "../state.mjs";

const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("web messenger permission defaults off and accepts only an explicit boolean opt-in", () => {
  assert.equal(stateUtils.DEFAULT_CONFIG.web_messenger_enabled, false);
  assert.equal(stateUtils.normalizeConfig().web_messenger_enabled, false);
  assert.equal(stateUtils.normalizeConfig({ web_messenger_enabled: true }).web_messenger_enabled, true);
  for (const value of [false, null, undefined, 0, 1, "true", "false", [], {}]) {
    assert.equal(stateUtils.normalizeConfig({ web_messenger_enabled: value }).web_messenger_enabled, false);
  }
  const config = stateUtils.normalizeConfig({ enabled: true, outgoing_translation_enabled: true });
  assert.equal(config.web_messenger_enabled, false, "desktop translation must not opt in web conversations");
});

test("web messenger guidance uses the display provider only and fails closed for unknown providers", () => {
  assert.equal(typeof stateUtils.webMessengerNeedsLocalModel, "function");
  for (const translator of ["hymt_1_8b", "hymt_7b", "translategemma_4b"]) {
    assert.equal(stateUtils.webMessengerNeedsLocalModel({ web_messenger_enabled: true, translator }), false);
  }
  for (const translator of ["chatgpt", "claude", "gemini", "deepl", "mock", "original", "unknown", "constructor", undefined]) {
    assert.equal(stateUtils.webMessengerNeedsLocalModel({
      web_messenger_enabled: true,
      translator,
      outgoing_translator: "hymt_1_8b",
    }), true);
    assert.equal(stateUtils.webMessengerNeedsLocalModel({ web_messenger_enabled: false, translator }), false);
  }
});

function createSettingsHarness(config = {}) {
  const dom = new JSDOM(markup);
  const button = dom.window.document.querySelector("#web-messenger-enabled");
  const note = dom.window.document.querySelector("#web-messenger-model-note");
  assert.ok(button, "the messenger opt-in switch must be present");
  assert.ok(note, "the local-model requirement must be visible in the web settings");
  const state = { config: stateUtils.normalizeConfig(config) };
  const patches = [];
  const errors = [];
  let handler;
  const context = vm.createContext({
    state,
    elements: { webMessengerEnabled: button, webMessengerModelNote: note },
    webMessengerNeedsLocalModel: stateUtils.webMessengerNeedsLocalModel,
    setSwitch(element, enabled, onLabel, offLabel) {
      element.setAttribute("aria-checked", String(Boolean(enabled)));
      element.querySelector("b").textContent = enabled ? onLabel : offLabel;
    },
    async applySettingsPatch(patch) {
      patches.push(JSON.parse(JSON.stringify(patch)));
      state.config = stateUtils.normalizeConfig({ ...state.config, ...patch });
      vm.runInContext("renderWebMessengerSettings()", context);
    },
    async showError(...args) { errors.push(args); },
  });
  const render = script.match(/function renderWebMessengerSettings\(\) \{[\s\S]*?\n\}/)?.[0];
  const bind = script.match(/elements\.webMessengerEnabled\.addEventListener\("click", async \(\) => \{[\s\S]*?\n\}\);/)?.[0];
  assert.ok(render, "config refresh must re-render messenger state");
  assert.ok(bind, "the switch must persist its permission");
  button.addEventListener = (type, callback) => { if (type === "click") handler = callback; };
  vm.runInContext(`${render}\n${bind}\nrenderWebMessengerSettings();`, context);
  return { dom, button, note, state, patches, errors, context, click: () => handler() };
}

test("web settings explain read-only local processing and separate browser consent before opting in", async () => {
  const harness = createSettingsHarness();
  const { dom, button, note } = harness;
  assert.equal(button.getAttribute("role"), "switch");
  assert.equal(button.getAttribute("aria-checked"), "false");
  assert.ok(button.closest('[data-settings-view="web"]'));
  const label = dom.window.document.getElementById(button.getAttribute("aria-labelledby"));
  assert.equal(label.textContent, "웹 메신저 읽기 번역");
  const description = dom.window.document.getElementById(button.getAttribute("aria-describedby"));
  assert.match(description.textContent, /로컬 AI/);
  assert.match(description.textContent, /현재 열린 대화/);
  assert.match(description.textContent, /입력 및 전송 기능을 사용하지 않으며/);
  assert.match(description.textContent, /개인정보 동의가 필요/);
  assert.equal(note.hidden, true);
  await harness.click();
  assert.deepEqual(harness.patches, [{ web_messenger_enabled: true }]);
  assert.equal(button.getAttribute("aria-checked"), "true");
  await harness.click();
  assert.deepEqual(harness.patches.at(-1), { web_messenger_enabled: false });
  assert.equal(button.getAttribute("aria-checked"), "false");
  assert.equal(button.disabled, false);
  assert.deepEqual(harness.errors, []);
});

test("web messenger provider warning follows settings changes without silently changing consent", () => {
  const harness = createSettingsHarness({ web_messenger_enabled: true, translator: "deepl" });
  assert.equal(harness.note.hidden, false);
  assert.equal(harness.button.getAttribute("aria-checked"), "true");
  harness.state.config.translator = "hymt_7b";
  vm.runInContext("renderWebMessengerSettings()", harness.context);
  assert.equal(harness.note.hidden, true);
  assert.deepEqual(harness.patches, []);
  assert.match(script.match(/function renderConfig\([\s\S]*?\n\}/)?.[0] || "", /renderWebMessengerSettings\(\)/);
});

test("failed web messenger updates restore the confirmed state and prevent duplicate pending changes", async () => {
  const harness = createSettingsHarness();
  let rejectUpdate;
  let calls = 0;
  harness.context.applySettingsPatch = () => {
    calls += 1;
    return new Promise((_, reject) => { rejectUpdate = reject; });
  };
  const first = harness.click();
  assert.equal(harness.button.disabled, true);
  await harness.click();
  assert.equal(calls, 1);
  rejectUpdate(new Error("test settings failure"));
  await first;
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.getAttribute("aria-checked"), "false");
  assert.equal(harness.state.config.web_messenger_enabled, false);
  assert.equal(harness.errors.length, 1);
});
test("messenger consent and status copy follow the main app language in all twenty-eight locales", () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(new URL("../../extension/popup-locales.js", import.meta.url), "utf8"), context);
  const popup = context.NudeNyangPopupLocales;
  const sources = {
    messengerReadTranslation: "웹 메신저 읽기 번역",
    messengerPrivacyConsent: "웹 메신저 개인정보 동의",
    messengerConsentRequired: "웹 메신저 읽기 번역에 대한 개인정보 동의가 필요합니다.",
    messengerDisabled: "메인 앱에서 웹 메신저 읽기 번역을 켜십시오.",
    messengerLocalOnly: "웹 메신저 읽기 번역은 로컬 AI에서만 사용할 수 있습니다.",
    messengerNoConversation: "현재 열린 대화가 없습니다.",
    messengerWaiting: "번역할 메시지를 기다리고 있습니다.",
    reviewMessengerPrivacy: "개인정보 안내 확인",
    messengerPrivacyTitle: "웹 메신저 읽기 번역 개인정보 안내",
    messengerPrivacyIntro: "웹 메신저 읽기 번역은 기본적으로 꺼져 있습니다. 동의한 브라우저에서만 사용할 수 있습니다.",
    messengerPrivacyData: "현재 열린 대화의 메시지 본문·링크 미리보기 텍스트와 현재 Discord 서버의 보이는 채널 이름만 별도로 설치한 NudeNyang Windows 앱에서 로컬 AI로 번역합니다.",
    messengerPrivacyRetention: "확장 프로그램이 보관하는 대화 내용과 번역문은 메모리에서만 처리하며, 대화 전환 또는 종료 시 삭제합니다. 디스크 캐시, 번역 기록 또는 본문 로그에 저장하지 않습니다.",
    messengerPrivacyExternal: "외부 번역 서비스로 대화 내용을 전송하지 않습니다.",
    messengerPrivacyNoSending: "입력 및 전송 기능을 사용하지 않으며, 사용자 이름과 연락처를 번역하지 않습니다.",
    messengerPrivacyConfirm: "이 브라우저에는 동의 기록과 설정만 저장됩니다. 위 내용을 확인하고 웹 메신저 읽기 번역에 동의합니다.",
    messengerPrivacyAccept: "동의하고 사용",
    messengerPrivacyRevoke: "동의 철회",
    messengerPrivacySaved: "이 브라우저에 웹 메신저 읽기 번역 동의가 저장되었습니다.",
    messengerPrivacyPermissionDenied: "선택 권한이 허용되지 않아 동의를 저장하지 않았습니다.",
    messengerPrivacyRevoked: "동의를 철회했습니다.",
    messengerPrivacySaveFailed: "동의를 저장하지 못했습니다. 다시 시도해 주십시오.",
    messengerPrivacyCancel: "취소",
  };
  assert.equal(popup.SUPPORTED.length, 28);
  for (const language of popup.SUPPORTED) {
    for (const [id, source] of Object.entries(sources)) {
      const value = popup.COPY[language][id];
      assert.ok(typeof value === "string" && value.trim(), `${language}: ${id}`);
      assert.equal(value, translateCopy(language, source), `${language}: ${id}`);
      if (language !== "ko") assert.doesNotMatch(value, /[가-힣]/, `${language}: ${id}`);
    }
  }
  assert.match(popup.COPY.en.messengerPrivacyRetention, /held by the extension/i);
  assert.match(popup.COPY.en.messengerPrivacyRetention, /memory/i);
  assert.match(popup.COPY.en.messengerPrivacyRetention, /disk cache|disk caches/i);
  assert.match(popup.COPY.en.messengerPrivacyExternal, /not sent|do not send/i);
});
