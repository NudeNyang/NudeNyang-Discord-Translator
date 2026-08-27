import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const html = fs.readFileSync(new URL("../messenger-privacy.html", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../messenger-privacy-page.js", import.meta.url), "utf8");
const locales = fs.readFileSync(new URL("../popup-locales.js", import.meta.url), "utf8");
const settle = () => new Promise((resolve) => setImmediate(resolve));

function page(options = {}) {
  const dom = new JSDOM(html, {
    url: options.url ?? "https://extension.invalid/messenger-privacy.html",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const messages = [];
  const requests = [];
  const removals = [];
  const focused = [];
  let inClick = false;
  let closed = false;
  const permissions = {
    request(permission) {
      requests.push({ permission: JSON.parse(JSON.stringify(permission)), inClick });
      return options.permissionRequest?.() ?? Promise.resolve(options.permissionGranted !== false);
    },
    remove(permission) {
      removals.push(JSON.parse(JSON.stringify(permission)));
      return Promise.resolve(true);
    },
  };
  function responseFor(message) {
    if (message.type === "nudenyang-page-request") {
      return options.startResponse ?? { enabled: true, messengerContextId: "messenger:discord:opaque-conversation-token" };
    }
    if (message.type === "nudenyang-messenger-consent-get") {
      return options.getConsent?.() ?? { ok: true, granted: options.granted === true };
    }
    if (message.type === "nudenyang-messenger-consent-set") {
      return options.setConsent?.(message.granted) ?? { ok: true, granted: message.granted };
    }
    if (message.type === "nudenyang-native-request") {
      return options.nativeStatus?.() ?? {
        type: "status", uiLanguage: "auto", resolvedUiLanguage: options.language ?? "en",
        webSettings: { messengerEnabled: options.messengerEnabled === true },
      };
    }
    throw new Error(`Unexpected message: ${message.type}`);
  }
  const api = {
    tabs: { update(id, details, callback) { focused.push({ id, ...details }); callback?.({ id }); return Promise.resolve({ id }); } },
    i18n: { getUILanguage: () => "en-US" },
    permissions,
    runtime: {
      sendMessage(message, callback) {
        messages.push(JSON.parse(JSON.stringify(message)));
        const reply = Promise.resolve().then(() => responseFor(message));
        if (!callback) return reply;
        reply.then(callback);
      },
    },
  };
  if (options.firefox) {
    api.runtime.getBrowserInfo = () => Promise.resolve({ name: "Firefox" });
    dom.window.browser = api;
    // Firefox can expose chrome too; use its promise-based browser permission API.
    dom.window.chrome = { runtime: { sendMessage() { throw new Error("Wrong API"); } } };
  } else dom.window.chrome = api;
  const closeWindow = dom.window.close.bind(dom.window);
  dom.window.close = () => { closed = true; };
  dom.window.eval(locales);
  dom.window.eval(script);
  const get = (id) => dom.window.document.getElementById(id);
  return {
    dom, get, messages, requests, removals, focused,
    get closed() { return closed; },
    consentChanges() { return messages.filter((message) => message.type === "nudenyang-messenger-consent-set"); },
    click(id) {
      inClick = true;
      get(id).click();
      inClick = false;
    },
    check(value = true) {
      get("privacy-confirm").checked = value;
      get("privacy-confirm").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    },
    dispose() { dom.window.dispatchEvent(new dom.window.Event("pagehide")); closeWindow(); },
  };
}

test("동의 페이지는 지역화한 안내와 접근성 구조를 사용하고 자동 동의하지 않는다", async () => {
  const p = page();
  try {
    assert.equal(p.get("privacy-confirm").checked, false);
    assert.equal(p.get("privacy-accept").disabled, true);
    await settle();
    assert.equal(p.get("privacy-confirm").checked, false);
    assert.equal(p.get("privacy-accept").disabled, true);
    assert.equal(p.get("privacy-status").getAttribute("role"), "status");
    assert.deepEqual(p.consentChanges(), []);
    assert.deepEqual(p.requests, []);
    const copy = p.dom.window.NudeNyangPopupLocales;
    for (const element of p.dom.window.document.querySelectorAll("[data-i18n]")) {
      for (const language of copy.SUPPORTED) {
        assert.notEqual(copy.message(language, element.dataset.i18n), element.dataset.i18n);
      }
    }
    assert.doesNotMatch(html, /\schecked(?:\s|=|>)/);
    assert.doesNotMatch(html, /<script[^>]+src=["']https?:/);
    assert.doesNotMatch(script, /localStorage|sessionStorage|fetch\(|XMLHttpRequest|console\./);
  } finally { p.dispose(); }
});

const HANDOFF_URL = "https://extension.invalid/messenger-privacy.html?tab=7&context=messenger%3Adiscord%3Aopaque-conversation-token";

test("명시적으로 동의한 뒤에만 원래 대화의 번역을 시작하고 탭으로 돌아간다", async () => {
  for (const firefox of [false, true]) {
    const p = page({ url: HANDOFF_URL, firefox });
    try {
      await settle();
      assert.deepEqual(p.focused, []);
      p.check(); p.click("privacy-accept");
      await settle();
      const writes = p.messages.filter((m) => m.type === "nudenyang-messenger-consent-set" || m.type === "nudenyang-page-request");
      assert.deepEqual(writes, [
        { type: "nudenyang-messenger-consent-set", granted: true },
        { type: "nudenyang-page-request", tabId: 7, message: { type: "nudenyang-messenger-start", contextId: "messenger:discord:opaque-conversation-token" } },
      ]);
      assert.deepEqual(p.focused, [{ id: 7, active: true }]);
    } finally { p.dispose(); }
  }
});

test("동의 거절·관리 페이지·잘못된 출처 정보는 대화를 시작하지 않는다", async () => {
  for (const options of [
    {}, { url: HANDOFF_URL.replace("tab=7", "tab=-1") },
    { url: HANDOFF_URL.replace("messenger%3Adiscord%3Aopaque-conversation-token", "https://private.invalid/chat") },
    { url: HANDOFF_URL, firefox: true, permissionGranted: false },
    { url: HANDOFF_URL, granted: true },
  ]) {
    const p = page(options);
    try {
      await settle(); p.check(); p.click("privacy-accept"); await settle();
      assert.equal(p.messages.some((m) => m.type === "nudenyang-page-request"), false);
      assert.deepEqual(p.focused, []);
    } finally { p.dispose(); }
  }
});

test("원래 대화가 바뀌거나 시작할 수 없어도 동의만 저장하고 다른 탭으로 이동하지 않는다", async () => {
  for (const startResponse of [{ enabled: false }, { enabled: true, messengerContextId: "different" }]) {
    const p = page({ url: HANDOFF_URL, startResponse });
    try {
      await settle(); p.check(); p.click("privacy-accept"); await settle();
      assert.equal(p.get("privacy-status").dataset.message, "messengerPrivacySaved");
      assert.deepEqual(p.focused, []);
    } finally { p.dispose(); }
  }
});

test("체크박스 변경만으로는 저장하지 않고 승인 클릭에서만 저장한다", async () => {
  const p = page();
  try {
    await settle();
    p.click("privacy-accept");
    assert.deepEqual(p.consentChanges(), []);
    p.check();
    assert.equal(p.get("privacy-accept").disabled, false);
    assert.deepEqual(p.consentChanges(), []);
    p.check(false);
    assert.equal(p.get("privacy-accept").disabled, true);
    p.check();
    p.click("privacy-accept");
    p.click("privacy-accept");
    await settle();
    assert.deepEqual(p.consentChanges(), [{ type: "nudenyang-messenger-consent-set", granted: true }]);
    assert.equal(p.get("privacy-status").dataset.message, "messengerPrivacySaved");
    assert.equal(p.get("privacy-confirm").checked, false);
    assert.equal(p.get("privacy-revoke").hidden, false);
    assert.deepEqual(p.requests, []);
  } finally { p.dispose(); }
});

test("이미 저장된 동의를 조회해도 체크박스를 자동 선택하거나 다시 승인하지 않는다", async () => {
  const p = page({ granted: true });
  try {
    await settle();
    assert.equal(p.get("privacy-confirm").checked, false);
    assert.equal(p.get("privacy-accept").hidden, true);
    assert.equal(p.get("privacy-revoke").hidden, false);
    assert.deepEqual(p.consentChanges(), []);
    assert.deepEqual(p.requests, []);
  } finally { p.dispose(); }
});

test("Firefox 추가 권한은 실제 클릭 스택에서 요청하고 허용 후에만 저장한다", async () => {
  let grantPermission;
  const permission = new Promise((resolve) => { grantPermission = resolve; });
  const p = page({ firefox: true, permissionRequest: () => permission });
  try {
    await settle();
    p.check();
    p.click("privacy-accept");
    assert.deepEqual(p.requests, [{ permission: { data_collection: ["personalCommunications"] }, inClick: true }]);
    assert.deepEqual(p.consentChanges(), []);
    grantPermission(true);
    await settle();
    assert.equal(p.consentChanges()[0]?.granted, true);
    assert.equal(p.get("privacy-status").dataset.message, "messengerPrivacySaved");
  } finally { p.dispose(); }
});

test("Firefox 권한을 거절하면 동의를 저장하지 않는다", async () => {
  const p = page({ firefox: true, permissionGranted: false });
  try {
    await settle();
    p.check();
    p.click("privacy-accept");
    await settle();
    assert.deepEqual(p.consentChanges(), []);
    assert.equal(p.get("privacy-status").dataset.message, "messengerPrivacyPermissionDenied");
    assert.equal(p.get("privacy-accept").disabled, false);
  } finally { p.dispose(); }
});

test("Firefox 추가 권한 API가 실패해도 동의를 저장하지 않는다", async () => {
  const p = page({ firefox: true, permissionRequest: () => Promise.reject(new Error("Not available")) });
  try {
    await settle();
    p.check();
    p.click("privacy-accept");
    await settle();
    assert.deepEqual(p.consentChanges(), []);
    assert.equal(p.get("privacy-status").dataset.message, "messengerPrivacyPermissionDenied");
  } finally { p.dispose(); }
});

test("동의 철회는 기록을 끄고 Firefox 선택 권한도 제거한다", async () => {
  const p = page({ firefox: true, granted: true });
  try {
    await settle();
    p.click("privacy-revoke");
    await settle();
    assert.deepEqual(p.consentChanges(), [{ type: "nudenyang-messenger-consent-set", granted: false }]);
    assert.deepEqual(p.removals, [{ data_collection: ["personalCommunications"] }]);
    assert.equal(p.get("privacy-status").dataset.message, "messengerPrivacyRevoked");
    assert.equal(p.get("privacy-confirm").checked, false);
    assert.equal(p.get("privacy-accept").disabled, true);
  } finally { p.dispose(); }
});

test("저장 실패는 성공으로 표시하지 않고 새 Firefox 선택 권한을 정리한다", async () => {
  const p = page({ firefox: true, setConsent: () => ({ ok: false, granted: false }) });
  try {
    await settle();
    p.check();
    p.click("privacy-accept");
    await settle();
    assert.equal(p.get("privacy-status").dataset.message, "messengerPrivacySaveFailed");
    assert.equal(p.get("privacy-revoke").hidden, true);
    assert.deepEqual(p.removals, [{ data_collection: ["personalCommunications"] }]);
  } finally { p.dispose(); }
});

test("취소는 창만 닫으며 진행 중인 권한 응답이 와도 동의를 저장하지 않는다", async () => {
  let grantPermission;
  const p = page({ firefox: true, permissionRequest: () => new Promise((resolve) => { grantPermission = resolve; }) });
  try {
    await settle();
    p.check();
    p.click("privacy-accept");
    p.click("privacy-cancel");
    assert.equal(p.closed, true);
    grantPermission(true);
    await settle();
    assert.deepEqual(p.consentChanges(), []);
  } finally { p.dispose(); }
});

test("메인 앱의 UI 언어와 RTL 방향을 재사용한다", async () => {
  const p = page({ language: "ar" });
  try {
    await settle();
    const { document, NudeNyangPopupLocales } = p.dom.window;
    assert.equal(document.documentElement.lang, "ar");
    assert.equal(document.documentElement.dir, "rtl");
    assert.equal(document.title, NudeNyangPopupLocales.message("ar", "messengerPrivacyTitle"));
    assert.equal(p.get("privacy-accept").textContent, NudeNyangPopupLocales.message("ar", "messengerPrivacyAccept"));
  } finally { p.dispose(); }
});

test("메인 앱 상태 응답이 늦어도 브라우저 동의 처리는 독립적으로 사용할 수 있다", async () => {
  const p = page({ nativeStatus: () => new Promise(() => {}) });
  try {
    await settle();
    p.check();
    assert.equal(p.get("privacy-accept").disabled, false);
    p.click("privacy-accept");
    await settle();
    assert.equal(p.consentChanges()[0]?.granted, true);
  } finally { p.dispose(); }
});
