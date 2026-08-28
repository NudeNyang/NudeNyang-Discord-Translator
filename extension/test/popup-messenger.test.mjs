import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const html = fs.readFileSync(new URL("../popup.html", import.meta.url), "utf8");
const scripts = ["content-helpers.js", "popup-locales.js", "connection-guidance.js", "popup.js"]
  .map((name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function popup(options = {}) {
  const dom = new JSDOM(html, {
    url: "https://extension.invalid/popup.html", runScripts: "outside-only", pretendToBeVisual: true,
  });
  const messages = [];
  const tabs = [];
  const timers = new Map();
  let timerId = 0;
  if (options.fakeTime) {
    dom.window.setTimeout = (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; };
    dom.window.clearTimeout = id => timers.delete(id);
  }
  const preferences = { ...options.preferences };
  let state = {
    supported: true, enabled: false, site: "discord", translatedNodes: 0,
    messengerService: "discord", messengerGate: "messenger_consent_required",
    messengerContextId: "messenger:discord:opaque-conversation-token",
    requestCount: 0, sentChars: 0, targetLanguage: "ko", ...options.status,
  };
  dom.window.chrome = {
    i18n: { getUILanguage: () => "en-US" },
    tabs: {
      query(_query, callback) { callback([{ id: 7, url: options.tabUrl ?? "https://discord.com/channels/@me/12345" }]); },
      create(details, callback) {
        if (options.privacyOpenFails) {
          dom.window.chrome.runtime.lastError = { message: "Test: tab creation denied" };
          callback?.();
          delete dom.window.chrome.runtime.lastError;
          return;
        }
        tabs.push({ ...details }); callback?.({ id: 8, ...details });
      },
    },
    commands: { getAll(callback) { callback([]); } },
    storage: { local: {
      get(_keys, callback) { callback(preferences); },
      set(patch, callback) { Object.assign(preferences, patch); callback?.(); },
    } },
    runtime: {
      getURL(path) { return `chrome-extension://test/${path}`; },
      sendMessage(message, callback) {
        messages.push(JSON.parse(JSON.stringify(message)));
        if (message.type === "nudenyang-page-request") {
          if (options.pageUnresponsive) return;
          if (message.message.type === "nudenyang-toggle-enabled") state = { ...state, enabled: !state.enabled };
          if (message.message.type === "nudenyang-set-enabled") state = { ...state, enabled: message.message.enabled };
          callback({ ...state });
        } else if (message.type === "nudenyang-native-request" || message.type === "nudenyang-setup-status") {
          if (message.type === "nudenyang-setup-status") message = { ...message, request: { type: "status" } };
          if (message.request.type === "openWebSettings") { callback({ type: "opened" }); return; }
          if (message.request.type === "webSettingsUpdate" && options.webSettingsResponse) { callback(options.webSettingsResponse); return; }
          callback({
            type: "status", appConnected: true, modelReady: true,
            translator: "hymt_1_8b", targetLanguage: "ko", resolvedUiLanguage: options.language ?? "en",
            webSettings: { messengerPolicyVersion: 3, quickToggleShortcut: "F4" },
            ...options.nativeStatus,
          });
        } else throw new Error(`Unexpected message: ${message.type}`);
      },
    },
  };
  for (const script of scripts) dom.window.eval(script);
  await settle();
  await settle();
  return {
    dom, messages, tabs, preferences,
    async tick() {
      const [key, timer] = [...timers].sort((a, b) => a[1].ms - b[1].ms)[0];
      timers.delete(key); timer.fn(); await settle(); await settle();
    },
    get(id) { return dom.window.document.getElementById(id); },
    toggleCalls() { return messages.filter((message) => message.message?.type === "nudenyang-toggle-enabled"); },
    pressF4() { dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "F4", code: "F4", bubbles: true, cancelable: true })); },
    dispose() { dom.window.close(); },
  };
}

test("개인정보 버튼은 기본 title 대신 번역된 제품 툴팁과 접근성 이름을 사용한다", async () => {
  const p = await popup({ language: "ko" });
  try {
    const button = p.get("messenger-privacy");
    assert.equal(button.hasAttribute("title"), false);
    assert.equal(button.dataset.tooltip, "웹 메신저 개인정보 동의");
    assert.ok(button.getAttribute("aria-label").includes(button.dataset.tooltip));
  } finally { p.dispose(); }
});

test("개인정보 페이지의 팝업은 오류 대신 안내 페이지임을 표시하고 중복 진입을 숨긴다", async () => {
  const p = await popup({ language: "ko", tabUrl: "chrome-extension://test/messenger-privacy.html?tab=7&context=opaque" });
  try {
    assert.equal(p.get("site").textContent, "웹 메신저 읽기 번역 개인정보 안내");
    assert.equal(p.get("enabled").disabled, true);
    assert.equal(p.get("messenger-privacy").hidden, true);
    assert.equal(p.get("messenger-panel").hidden, true);
    assert.equal(p.get("open-settings").disabled, false);
    assert.ok(!p.messages.some((m) => m.type === "nudenyang-page-request"));
  } finally { p.dispose(); }
});

test("미연결 팝업은 재확인 뒤에만 안내하며 다운로드는 클릭할 때만 열고 개인정보를 URL에 넣지 않는다", async () => {
  const options = { fakeTime: true, language: "ko", nativeStatus: { type: "error", code: "native_host_unavailable", appConnected: false } };
  const p = await popup(options);
  try {
    assert.equal(p.get("companion-panel").hidden, true);
    assert.deepEqual(p.tabs, []);
    await p.tick();
    assert.equal(p.get("companion-panel").hidden, true);
    await p.tick();
    assert.equal(p.get("companion-panel").hidden, false);
    assert.equal(p.get("enabled").disabled, true);
    assert.equal(p.get("messenger-panel").hidden, true);
    assert.equal(p.get("companion-download").classList.contains("messenger-consent-action"), true);
    p.get("companion-download").click();
    assert.deepEqual(p.tabs, [{ url: "chrome-extension://test/download.html?lang=en" }]);
    p.get("companion-dismiss").click();
    assert.equal(p.get("companion-panel").hidden, true);
    assert.equal(p.get("companion-help").hidden, false);
    assert.equal(p.preferences.companionHelpDismissed, true);
    await p.tick();
    assert.equal(p.get("companion-panel").hidden, true);
    p.get("companion-help").click();
    assert.equal(p.get("companion-panel").hidden, false);
    options.nativeStatus = {};
    p.get("companion-retry").click(); await settle(); await settle();
    assert.equal(p.get("companion-panel").hidden, true);
    assert.equal(p.get("companion-help").hidden, true);
    assert.equal(p.get("messenger-panel").hidden, false, "본체 연결 후에도 기존 메신저 동의를 요구한다");
    assert.equal(p.preferences.companionConnected, true);
    assert.ok(p.messages.every(m => !m.type.includes("consent-set") && !m.message?.type.includes("set-enabled")));
  } finally { p.dispose(); }
});

test("오래 열린 탭이 응답하지 않아도 본체 설치·연결 안내는 독립적으로 동작한다", async () => {
  const p = await popup({ fakeTime: true, pageUnresponsive: true, nativeStatus: { type: "error", code: "native_host_unavailable", appConnected: false } });
  try {
    assert.ok(p.messages.some(m => m.type === "nudenyang-setup-status"));
    await p.tick(); await p.tick();
    assert.equal(p.get("companion-panel").hidden, false);
    p.get("companion-download").click();
    assert.equal(p.tabs.length, 1);
  } finally { p.dispose(); }
});

test("본체 연결이 끊겨도 이미 번역 중인 페이지는 팝업에서 원문으로 끌 수 있다", async () => {
  const p = await popup({ fakeTime: true, status: { messengerService: "", messengerGate: "", enabled: true },
    nativeStatus: { type: "error", code: "app_unavailable", appConnected: false } });
  try {
    assert.equal(p.get("enabled").checked, true);
    assert.equal(p.get("enabled").disabled, false);
    p.get("enabled").click(); await settle();
    assert.equal(p.get("enabled").checked, false);
    assert.equal(p.get("enabled").disabled, true, "연결이 없을 때 새 번역을 켜지는 않는다");
  } finally { p.dispose(); }
});

test("연결 이력·등록된 본체 오류는 재설치보다 복구를 우선하고 명시적 해제는 다운로드를 숨긴다", async () => {
  for (const variant of [{ preferences: { companionConnected: true }, code: "native_host_unavailable" }, { code: "app_unavailable" }]) {
    const p = await popup({ fakeTime: true, preferences: variant.preferences, nativeStatus: { type: "error", code: variant.code, appConnected: false } });
    try {
      await p.tick(); await p.tick();
      assert.equal(p.get("companion-download").classList.contains("messenger-consent-action"), false);
      assert.equal(p.get("companion-retry").classList.contains("messenger-consent-action"), true);
    } finally { p.dispose(); }
  }
  const p = await popup({ fakeTime: true, nativeStatus: { type: "error", code: "browser_connection_disabled", appConnected: false } });
  try {
    await p.tick();
    assert.equal(p.get("companion-panel").hidden, true);
    assert.equal(p.get("companion-help").hidden, true);
    assert.equal(p.get("open-settings").disabled, false);
    assert.deepEqual(p.tabs, []);
  } finally { p.dispose(); }
});

test("메신저 동의는 팝업 열기로 자동 표시·저장하지 않고 명시적인 클릭으로만 안내 탭을 연다", async () => {
  const p = await popup();
  try {
    assert.deepEqual(p.tabs, []);
    assert.ok(p.messages.every((message) => !message.type.includes("consent-set")));
    assert.equal(p.get("messenger-privacy").hidden, true, "동의 카드와 하단에 같은 진입을 중복 표시하지 않는다");
    p.get("messenger-consent-start").click();
    assert.equal(p.tabs.length, 1);
    assert.ok(p.messages.every((message) => !message.type.includes("consent-set")));
  } finally { p.dispose(); }
});

test("동의 차단 안내 옆 버튼은 원래 대화의 임시 식별자만 전달한다", async () => {
  const p = await popup();
  try {
    const button = p.get("messenger-consent-start");
    assert.equal(button.hidden, false);
    assert.equal(p.get("messenger-panel").hidden, false);
    assert.ok(p.get("messenger-panel").classList.contains("consent-required"));
    assert.equal(p.get("messenger-title").hidden, false);
    assert.equal(p.get("messenger-title").textContent, "Web messenger privacy consent");
    button.click();
    const url = new URL(p.tabs[0].url);
    assert.equal(url.pathname, "/messenger-privacy.html");
    assert.equal(url.searchParams.get("tab"), "7");
    assert.equal(url.searchParams.get("context"), "messenger:discord:opaque-conversation-token");
    assert.ok(!url.href.includes("12345"));
    assert.ok(p.messages.every((message) => !message.type.includes("consent-set")));
  } finally { p.dispose(); }
  for (const messengerGate of ["", "messenger_update_required", "private_browsing_provider_unsupported"]) {
    const other = await popup({ status: { messengerGate } });
    try { assert.equal(other.get("messenger-consent-start").hidden, true); }
    finally { other.dispose(); }
  }
});

test("메신저 차단 원인을 엔진 연결 상태와 별도로 표시하고 F4로 동의를 우회하지 않는다", async () => {
  const p = await popup();
  try {
    assert.equal(p.get("connection-text").textContent, "Connected");
    assert.match(p.get("detail").textContent, /hymt_1_8b/);
    assert.equal(p.get("messenger-notice").textContent, "Privacy consent is required for web messenger reading translation.");
    assert.equal(p.get("messenger-notice").hidden, false);
    assert.equal(p.get("messenger-notice").getAttribute("role"), "status");
    assert.equal(p.get("enabled").disabled, true);
    p.pressF4();
    await settle();
    assert.deepEqual(p.toggleCalls(), []);
  } finally { p.dispose(); }
});

test("메인 OFF·외부 AI·열린 대화 없음은 각각 올바른 메신저 안내를 표시한다", async () => {
  for (const [gate, expected] of [
    ["messenger_update_required", "Update both the companion app and the extension to use web messengers."],
    ["private_browsing_provider_unsupported", "In private browsing, use a local model or DeepL. Local records created by subscription CLIs cannot be controlled."],
    ["messenger_no_conversation", "No conversation is currently open."],
  ]) {
    const p = await popup({ status: { messengerGate: gate } });
    try {
      assert.equal(p.get("messenger-notice").textContent, expected, gate);
      assert.equal(p.get("enabled").disabled, true, gate);
    } finally { p.dispose(); }
  }
});

test("동의한 메신저는 팝업 F4로 원문·번역을 전환한다", async () => {
  const p = await popup({ status: { messengerGate: "" } });
  try {
    assert.equal(p.get("enabled").disabled, false);
    assert.equal(p.get("messenger-notice").textContent, "Web messenger reading translation");
    p.pressF4();
    await settle();
    assert.equal(p.toggleCalls().length, 1);
    assert.equal(p.get("enabled").checked, true);
  } finally { p.dispose(); }
});

test("일반 페이지에서는 메신저 안내를 숨기고 기존 전환을 유지하되 동의 철회 경로는 제공한다", async () => {
  const p = await popup({ status: { messengerService: "", messengerGate: "", site: "github" } });
  try {
    assert.equal(p.get("messenger-notice").hidden, true);
    assert.equal(p.get("messenger-panel").hidden, true);
    assert.equal(p.get("messenger-privacy").hidden, false);
    assert.equal(p.get("messenger-privacy").textContent, "Review privacy notice");
    assert.equal(p.get("messenger-privacy").getAttribute("aria-label"), "Review privacy notice · Web messenger privacy consent");
    p.pressF4();
    await settle();
    assert.equal(p.toggleCalls().length, 1);
    assert.deepEqual(p.tabs, []);
  } finally { p.dispose(); }
});

test("미지원 페이지에서도 개인정보 동의 설정에 접근할 수 있다", async () => {
  const p = await popup({ status: { supported: false, messengerService: "", messengerGate: "", site: "" } });
  try {
    assert.equal(p.get("enabled").disabled, true);
    assert.equal(p.get("messenger-privacy").disabled, false);
    p.get("messenger-privacy").click();
    assert.equal(p.tabs.length, 1);
  } finally { p.dispose(); }
});

test("메신저 안내와 개인정보 버튼도 본체 UI 언어를 따른다", async () => {
  const p = await popup({ language: "ko" });
  try {
    assert.equal(p.dom.window.document.documentElement.lang, "ko");
    assert.equal(p.get("messenger-privacy").textContent, "개인정보 안내 확인");
    assert.equal(p.get("messenger-notice").textContent, "웹 메신저 읽기 번역에 대한 개인정보 동의가 필요합니다.");
  } finally { p.dispose(); }
});

test("원문 버튼을 없애도 상단 토글과 F4로 번역을 끄고 다시 켤 수 있다", async () => {
  const p = await popup({ status: { messengerGate: "", enabled: true } });
  try {
    assert.equal(p.get("restore"), null);
    p.get("enabled").click();
    await settle();
    assert.equal(p.get("enabled").checked, false);
    assert.ok(p.messages.some((message) => message.message?.type === "nudenyang-set-enabled" && !message.message.enabled));
    p.pressF4();
    await settle();
    assert.equal(p.get("enabled").checked, true);
    assert.ok(p.messages.every((message) => message.message?.type !== "nudenyang-restore"));
    p.get("messenger-privacy").click();
    assert.deepEqual(p.tabs, [{ url: "chrome-extension://test/messenger-privacy.html" }], "관리 진입은 번역 재개 문맥을 전달하지 않는다");
  } finally { p.dispose(); }
});

test("브라우저 연결 해제는 응답 언어로 사용 중지를 안내하고 설정·동의 관리만 허용한다", async () => {
  for (const language of ["ko", "en", "ar"]) {
    const p = await popup({
      status: { enabled: true },
      nativeStatus: { type: "error", code: "browser_connection_disabled", appConnected: false, resolvedUiLanguage: language },
    });
    try {
      const copy = (id) => p.dom.window.NudeNyangPopupLocales.message(language, id);
      assert.equal(p.dom.window.document.documentElement.lang, language);
      assert.equal(p.get("connection-text").textContent, copy("disabled"));
      assert.equal(p.get("detail").textContent, `${copy("webTranslation")} · ${copy("settings")}`);
      assert.ok(p.get("connection").classList.contains("disabled"));
      assert.equal(p.get("enabled").checked, false);
      assert.equal(p.get("enabled").disabled, true);
      assert.equal(p.get("target-language-trigger").disabled, true);
      assert.equal(p.get("always-translate-site").disabled, true);
      assert.equal(p.get("messenger-panel").hidden, true);
      assert.equal(p.get("messenger-consent-start").hidden, true);
      p.pressF4();
      await settle();
      assert.equal(p.toggleCalls().length, 0);
      assert.equal(p.get("messenger-privacy").hidden, false);
      assert.equal(p.get("open-settings").disabled, false);
      p.get("open-settings").click();
      await settle();
      assert.ok(p.messages.some((message) => message.request?.type === "openWebSettings"));
    } finally { p.dispose(); }
  }
});

test("일반 페이지에서 개인정보 안내 열기에 실패하면 숨긴 안내 영역을 다시 표시한다", async () => {
  const p = await popup({ privacyOpenFails: true, status: { messengerService: "", messengerGate: "" } });
  try {
    assert.equal(p.get("messenger-panel").hidden, true);
    p.get("messenger-privacy").click();
    assert.equal(p.get("messenger-panel").hidden, false);
    assert.equal(p.get("messenger-notice").hidden, false);
    assert.equal(p.get("messenger-notice").textContent, p.dom.window.NudeNyangPopupLocales.message("en", "unableToProcess"));
    assert.deepEqual(p.tabs, []);
  } finally { p.dispose(); }
});

test("팝업을 연 뒤 사이트 설정 요청 중 연결이 해제되어도 안내와 잠금 상태를 갱신한다", async () => {
  const p = await popup({
    status: { messengerService: "", messengerGate: "" },
    webSettingsResponse: { type: "error", code: "browser_connection_disabled", appConnected: false, uiLanguage: "ko" },
  });
  try {
    p.get("always-translate-site").click();
    await settle();
    assert.equal(p.get("connection-text").textContent, "사용 중지됨");
    assert.equal(p.get("enabled").disabled, true);
    assert.equal(p.get("always-translate-site").checked, false);
    assert.equal(p.get("always-translate-site").disabled, true);
    assert.equal(p.get("target-language-trigger").disabled, true);
    p.pressF4();
    await settle();
    assert.equal(p.toggleCalls().length, 0);
    assert.equal(p.get("open-settings").disabled, false);
  } finally { p.dispose(); }
});
