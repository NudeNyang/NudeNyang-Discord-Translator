import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const html = fs.readFileSync(new URL("../popup.html", import.meta.url), "utf8");
const scripts = ["content-helpers.js", "popup-locales.js", "popup.js"]
  .map((name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function popup(options = {}) {
  const dom = new JSDOM(html, {
    url: "https://extension.invalid/popup.html", runScripts: "outside-only", pretendToBeVisual: true,
  });
  const messages = [];
  const tabs = [];
  let state = {
    supported: true, enabled: false, site: "discord", translatedNodes: 0,
    messengerService: "discord", messengerGate: "messenger_consent_required",
    requestCount: 0, sentChars: 0, targetLanguage: "ko", ...options.status,
  };
  dom.window.chrome = {
    i18n: { getUILanguage: () => "en-US" },
    tabs: {
      query(_query, callback) { callback([{ id: 7, url: "https://discord.com/channels/@me/12345" }]); },
      create(details, callback) { tabs.push({ ...details }); callback?.({ id: 8, ...details }); },
    },
    commands: { getAll(callback) { callback([]); } },
    runtime: {
      getURL(path) { return `chrome-extension://test/${path}`; },
      sendMessage(message, callback) {
        messages.push(JSON.parse(JSON.stringify(message)));
        if (message.type === "nudenyang-page-request") {
          if (message.message.type === "nudenyang-toggle-enabled") state = { ...state, enabled: !state.enabled };
          callback({ ...state });
        } else if (message.type === "nudenyang-native-request") {
          callback({
            type: "status", appConnected: true, modelReady: true,
            translator: "hymt_1_8b", targetLanguage: "ko", resolvedUiLanguage: options.language ?? "en",
            webSettings: { messengerEnabled: true, quickToggleShortcut: "F4" },
          });
        } else throw new Error(`Unexpected message: ${message.type}`);
      },
    },
  };
  for (const script of scripts) dom.window.eval(script);
  await settle();
  await settle();
  return {
    dom, messages, tabs,
    get(id) { return dom.window.document.getElementById(id); },
    toggleCalls() { return messages.filter((message) => message.message?.type === "nudenyang-toggle-enabled"); },
    pressF4() { dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "F4", code: "F4", bubbles: true, cancelable: true })); },
    dispose() { dom.window.close(); },
  };
}

test("메신저 동의는 팝업 열기로 자동 표시·저장하지 않고 명시적인 클릭으로만 안내 탭을 연다", async () => {
  const p = await popup();
  try {
    assert.deepEqual(p.tabs, []);
    assert.ok(p.messages.every((message) => !message.type.includes("consent-set")));
    assert.equal(p.get("messenger-privacy").textContent, "Review privacy notice");
    p.get("messenger-privacy").click();
    assert.deepEqual(p.tabs, [{ url: "chrome-extension://test/messenger-privacy.html" }]);
    assert.ok(p.messages.every((message) => !message.type.includes("consent-set")));
  } finally { p.dispose(); }
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
    ["messenger_disabled", "Enable web messenger reading translation in the main app."],
    ["messenger_local_only", "Web messenger reading translation is available only with local AI."],
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
    assert.equal(p.get("messenger-privacy").textContent, "Web messenger privacy consent");
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
