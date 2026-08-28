import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { X_CHAT, X_CHAT_PANEL, X_CHAT_URL, xChatMessage } from "./fixtures/x-chat.mjs";
import { DISCORD_WEB, DISCORD_WEB_URL } from "./fixtures/discord-web.mjs";
import {
  CSS_REVEAL_HTML, FRAGMENTED_TEXT_HTML, LONG_TEXT, PUBLIC_DOCUMENT_URL,
  PUBLIC_NODE_CHANGES, REUSED_TEXT_HTML, SHORT_TEXT_HTML, VIRTUAL_LIST_HTML,
  PUBLIC_SURFACES_HTML, PUBLIC_SURFACE_COPY,
} from "./fixtures/dom-translation.mjs";

const sources = ["site-adapters.js", "messenger-adapters.js", "content-helpers.js", "dom-policy.js", "text-segments.js", "popup-locales.js", "content.js"].map((file) => (
  fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
));
const FRAME_URL = "https://www.youtube-nocookie.com/embed/video123?rel=0";

function embedRequest(action, extra = {}) {
  return { type: "nudenyang-embed-parent-request", action, frameId: 2,
    frameUrl: FRAME_URL, documentToken: "document_123", ...extra };
}

async function waitFor(check, message, timeout = 4000) {
  const until = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > until) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

function page(t, html, options = {}) {
  const dom = new JSDOM(html, {
    url: options.url ?? "https://dm.takaratomy.co.jp/product/dm26ex3/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const clickHandlers = new WeakMap();
  const addListener = w.HTMLElement.prototype.addEventListener;
  w.HTMLElement.prototype.addEventListener = function(type, listener, ...args) {
    if (type === "click") clickHandlers.set(this, listener);
    return addListener.call(this, type, listener, ...args);
  };
  const observers = new Set();
  const intersections = new Set();
  const MutationObserver = w.MutationObserver;
  w.MutationObserver = class extends MutationObserver {
    constructor(callback) { super(callback); observers.add(this); }
  };
  t.after(() => {
    for (const observer of observers) observer.disconnect();
    w.close();
  });
  const listeners = new Set();
  const requests = [];
  const runtimeMessages = [];
  const savedStates = [];
  const applicationFrames = new Map();
  let nextApplicationFrame = 0;
  let releaseStatus;
  let releaseTranslation;
  const appStatus = {
    type: "status", translator: options.translator ?? "hymt_1_8b", targetLanguage: "KO", resolvedUiLanguage: "ko",
    webSettings: { enabled: true, messengerPolicyVersion: 3, processingMode: "responsive", ...options.settings },
  };
  w.console.info = () => {};
  if (options.deferApplications) {
    w.requestAnimationFrame = (callback) => {
      const id = ++nextApplicationFrame;
      applicationFrames.set(id, callback);
      return id;
    };
    w.cancelAnimationFrame = (id) => applicationFrames.delete(id);
  }
  w.HTMLElement.prototype.getBoundingClientRect = function rect() {
    const hidden = this.closest(options.renderAriaHidden ? "[hidden]" : "[hidden],[aria-hidden='true']")
      || w.getComputedStyle(this).display === "none";
    const top = this.closest("[data-offscreen]") ? 5000 : 10;
    return { top, bottom: top + (hidden ? 0 : 30), left: 10, right: 210,
      width: hidden ? 0 : 200, height: hidden ? 0 : 30 };
  };
  w.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback; this.active = true; this.targets = new Set();
      intersections.add(this);
    }
    observe(target) {
      this.targets.add(target);
      w.queueMicrotask(() => {
        if (this.active) this.callback([{
          target, isIntersecting: target.getBoundingClientRect().height > 0
            && target.getBoundingClientRect().top < 1000,
        }]);
      });
    }
    disconnect() { this.active = false; }
  };
  w.chrome = {
    storage: { local: { get(_defaults, callback) { callback({ enabled: true }); } } },
    runtime: {
      id: "test-extension", lastError: null,
      getManifest() { return { version: "0.7.4" }; },
      onMessage: {
        addListener(listener) { listeners.add(listener); },
        removeListener(listener) { listeners.delete(listener); },
      },
      sendMessage(message, callback = () => {}) {
        runtimeMessages.push(message);
        if (message.type === "nudenyang-tab-enabled-get") {
          callback({ enabled: options.tabEnabled ?? null });
        } else if (message.type === "nudenyang-tab-enabled-set") {
          savedStates.push(message.enabled);
          callback({ enabled: message.enabled });
        } else if (message.type === "nudenyang-messenger-consent-get") {
          callback({ ok: true, granted: options.consent === true, consentVersion: options.consent ? (options.consentVersion ?? 3) : 0 });
        } else if (message.type === "nudenyang-native-request") {
          if (message.request.type === "status") {
            if (options.deferStatus) releaseStatus = () => callback(appStatus);
            else callback(appStatus);
          } else if (message.request.type === "translate") {
            requests.push(message.request);
            const reply = () => callback({ type: "translationResult", translator: appStatus.translator,
              ...(options.responseSettings ? { webSettings: options.responseSettings } : {}),
              items: message.request.items.map((item) => ({ id: item.id, text: `번역(${item.text})` })) });
            if (options.deferTranslation) releaseTranslation = reply;
            else callback && w.queueMicrotask(reply);
          }
        } else callback({ ok: true });
      },
    },
  };
  function message(value, sender = { id: "test-extension" }) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No response: ${value.type}`)), 4000);
      const reply = (response) => { clearTimeout(timer); resolve(response); };
      for (const listener of listeners) listener(value, sender, reply);
    });
  }
  for (const source of sources) w.eval(source);
  return {
    w, requests, savedStates, message, listeners, runtimeMessages, appStatus,
    trustedClick: (button) => clickHandlers.get(button)({ isTrusted: true }),
    releaseStatus: () => releaseStatus?.(),
    releaseTranslation: () => releaseTranslation?.(),
    pendingApplicationFrames: () => applicationFrames.size,
    releaseApplications() {
      const pending = [...applicationFrames.values()];
      applicationFrames.clear();
      for (const callback of pending) callback(w.performance.now());
    },
    reinject: () => sources.forEach((source) => w.eval(source)),
    sent: () => requests.flatMap((request) => request.items.map((item) => item.text)),
    intersect(target) {
      const active = [...intersections].filter((observer) => observer.active && observer.targets.has(target));
      assert.ok(active.length > 0, "revealed element must already be observed");
      for (const observer of active) observer.callback([{ target, isIntersecting: true }]);
    },
  };
}

const PRIVATE_CHAT = `<nav><span>Private contact list</span></nav>
  <ol data-list-id="chat-messages"><li>
    <span id="message-username-1">Private sender</span>
    <div id="message-content-1">Hello from a private conversation
      <span class="mention_abcd">@Private person</span><code>secret_code()</code>
      <time>Private timestamp</time><a href="https://example.com/">https://example.com/</a>
    </div></li></ol><div role="textbox" contenteditable="true">Unsent private draft</div>`;
const PRIVATE_OPTIONS = { url: "https://discord.com/channels/@me/123456789", consent: true,
  settings: { messengerPolicyVersion: 3 } };

const consentNotice = (p) => p.w.document.getElementById("nudenyang-consent-notice")?.shadowRoot;

test("범용 가상 목록은 같은 본문의 노드 재생성과 원문 덮어쓰기를 재요청 없이 복원한다", async (t) => {
  const p = page(t, VIRTUAL_LIST_HTML, { url: PUBLIC_DOCUMENT_URL, tabEnabled: true });
  await p.message({ type: "nudenyang-ready" });
  const body = p.w.document.querySelector("#changing");
  await waitFor(() => body.textContent === "번역(Reusable list message)", "initial translation");
  const count = p.requests.length;
  for (const rebuild of [false, true]) {
    if (rebuild) body.innerHTML = "<span>Reusable list message</span>";
    else body.firstChild.firstChild.nodeValue = "Reusable list message";
    await waitFor(() => body.textContent === "번역(Reusable list message)", "recycled row should replay immediately", 1000);
    assert.equal(p.requests.length, count, "same source must not reach the native queue again");
  }
});

test("메신저 공통: 첫 메시지 교체가 남은 대화 번역을 초기화하지 않는다", async (t) => {
  const p = page(t, RECLASSIFIED_CHAT, PRIVATE_OPTIONS);
  await p.message({ type: "nudenyang-ready" });
  const first = p.w.document.querySelector("#message-content-anchor");
  const second = p.w.document.querySelector("#message-content-changing");
  await waitFor(() => second.textContent === "번역(Secondary synthetic message)", "initial translation");
  const before = await p.message({ type: "nudenyang-status" });
  const replacement = first.cloneNode(false);
  replacement.textContent = "Stable neutral anchor";
  first.replaceWith(replacement);
  const after = await p.message({ type: "nudenyang-status" });
  assert.equal(after.messengerContextId, before.messengerContextId);
  assert.equal(second.textContent, "번역(Secondary synthetic message)");
  await waitFor(() => replacement.textContent === "번역(Stable neutral anchor)", "recycled first row should replay");
  assert.equal(p.requests.length, before.requestCount);
});

test("재표시 캐시: 바뀐 문장·목표 언어·페이지에는 새 번역을 요청한다", async (t) => {
  const p = page(t, VIRTUAL_LIST_HTML, { url: PUBLIC_DOCUMENT_URL, tabEnabled: true });
  await p.message({ type: "nudenyang-ready" });
  const body = p.w.document.querySelector("#changing");
  await waitFor(() => body.textContent === "번역(Reusable list message)", "initial translation");
  body.innerHTML = "<span>Edited list message</span>";
  await waitFor(() => p.sent().includes("Edited list message") && body.textContent === "번역(Edited list message)", "edits translate afresh");
  body.innerHTML = "<span>Reusable list message</span>";
  await waitFor(() => body.textContent === "번역(Reusable list message)", "known source replays");
  const beforeLanguage = p.requests.length;
  await p.message({ type: "nudenyang-set-target-language", targetLanguage: "EN" });
  await waitFor(() => p.requests.length > beforeLanguage && body.textContent === "번역(Reusable list message)", "new language needs fresh results");
  assert.equal(p.requests.at(-1).targetLanguage, "EN");
  const beforePage = p.requests.length;
  p.w.history.pushState({}, "", "/articles/another");
  await p.message({ type: "nudenyang-status" });
  await waitFor(() => p.requests.length > beforePage, "page transition discards replay cache");
});

test("메신저 공통: 화면 밖 번역도 유지하되 상태 확인은 본문을 읽지 않는다", async (t) => {
  const p = page(t, RECLASSIFIED_CHAT, PRIVATE_OPTIONS);
  await p.message({ type: "nudenyang-ready" });
  const body = p.w.document.querySelector("#message-content-changing");
  await waitFor(() => body.textContent === "번역(Secondary synthetic message)", "initial translation");
  body.setAttribute("data-offscreen", "");
  const reads = watchNodeValueReads(p.w, body.firstChild);
  await p.message({ type: "nudenyang-messenger-refresh", consent: { granted: true, consentVersion: 3 } });
  assert.equal(reads(), 0, "clipped messages must not be re-read or restored");
  assert.equal(body.textContent, "번역(Secondary synthetic message)");
});

test("동의 없는 자동 번역은 본문을 읽지 않고 페이지에 이유와 안내 버튼을 표시한다", async (t) => {
  const p = page(t, X_CHAT, { ...PRIVATE_OPTIONS, url: X_CHAT_URL, consent: false,
    settings: { messengerPolicyVersion: 3, sitePolicies: { "x.com": "always" } } });
  const reads = watchNodeValueReads(p.w, p.w.document.querySelector("#body-one span").firstChild);
  await p.message({ type: "nudenyang-ready" });
  const notice = consentNotice(p);
  assert.ok(notice, "auto start must explain missing consent without opening the popup");
  assert.match(notice.textContent, /개인정보 동의가 필요합니다/);
  assert.equal(notice.querySelector("[data-action=review]").textContent, "개인정보 안내 확인");
  assert.equal(reads(), 0);
  assert.deepEqual(p.sent(), []);
  assert.ok(!p.runtimeMessages.some((m) => m.type === "nudenyang-messenger-privacy-open"));
  notice.querySelector("[data-action=close]").click();
  assert.equal(consentNotice(p), undefined);
  p.w.document.dispatchEvent(new p.w.Event("scroll"));
  await p.message({ type: "nudenyang-status" });
  assert.equal(consentNotice(p), undefined, "dismissed notices must not reappear on scroll");
  p.w.dispatchEvent(new p.w.KeyboardEvent("keydown", { key: "F4", code: "F4", bubbles: true }));
  await waitFor(() => consentNotice(p), "manual retry should explain the gate again");
});

test("수동 메신저의 F4는 안내만 표시하고 실제 클릭만 대화 식별자로 동의 페이지를 연다", async (t) => {
  const options = { ...PRIVATE_OPTIONS, consent: false, tabEnabled: false };
  const p = page(t, PRIVATE_CHAT, options);
  await p.message({ type: "nudenyang-ready" });
  assert.equal(consentNotice(p), undefined);
  await p.message({ type: "nudenyang-toggle-enabled" });
  const review = consentNotice(p).querySelector("[data-action=review]");
  review.click();
  assert.ok(!p.runtimeMessages.some((m) => m.type === "nudenyang-messenger-privacy-open"), "page-script clicks are not user gestures");
  await p.trustedClick(review);
  const opened = p.runtimeMessages.filter((m) => m.type === "nudenyang-messenger-privacy-open");
  assert.equal(opened.length, 1);
  assert.deepEqual(Object.keys(opened[0]).sort(), ["contextId", "type"]);
  assert.equal(opened[0].contextId, (await p.message({ type: "nudenyang-status" })).messengerContextId);
  assert.deepEqual(p.savedStates, []);
  assert.deepEqual(p.sent(), []);
  options.consent = true;
  await p.message({ type: "nudenyang-messenger-start", contextId: opened[0].contextId });
  assert.equal(consentNotice(p), undefined);
  await waitFor(() => p.sent().length > 0, "explicit consent resumes the same conversation");
});

test("동의 안내는 끄기·대화 떠나기·설정 끄기·페이지 숨김 시 제거하고 차단 사이트에는 표시하지 않는다", async (t) => {
  for (const action of ["off", "leave", "settings", "hidden", "dispose"]) {
    const p = page(t, PRIVATE_CHAT, { ...PRIVATE_OPTIONS, consent: false, tabEnabled: true });
    await p.message({ type: "nudenyang-ready" });
    assert.ok(consentNotice(p), action);
    if (action === "off") await p.message({ type: "nudenyang-set-enabled", enabled: false });
    if (action === "leave") {
      p.w.history.pushState({}, "", "/channels/@me");
      p.w.document.querySelector("ol").remove();
      await p.message({ type: "nudenyang-status" });
    }
    if (action === "settings") await p.message({ type: "nudenyang-apply-web-settings", webSettings: { enabled: false, messengerPolicyVersion: 3 } });
    if (action === "hidden") {
      Object.defineProperty(p.w.document, "hidden", { value: true, configurable: true });
      p.w.document.dispatchEvent(new p.w.Event("visibilitychange"));
    }
    if (action === "dispose") p.w.__nudeNyangContentRuntime.dispose();
    assert.equal(consentNotice(p), undefined, action);
  }
  for (const settings of [{ enabled: false }, { enabled: false, messengerPolicyVersion: 3 },
    { messengerPolicyVersion: 3, sitePolicies: { "discord.com": "never" } }]) {
    const p = page(t, PRIVATE_CHAT, { ...PRIVATE_OPTIONS, settings, consent: false });
    await p.message({ type: "nudenyang-ready" });
    await p.message({ type: "nudenyang-toggle-enabled" });
    assert.equal(consentNotice(p), undefined);
  }
});

test("페이지 안내는 본체 언어 변경을 따르며 브라우저 연결 해제 뒤에는 동의가 유일한 원인인 것처럼 남지 않는다", async (t) => {
  const p = page(t, PRIVATE_CHAT, { ...PRIVATE_OPTIONS, consent: false, tabEnabled: true });
  await p.message({ type: "nudenyang-ready" });
  p.appStatus.resolvedUiLanguage = "ar";
  p.w.dispatchEvent(new p.w.Event("focus"));
  await waitFor(() => consentNotice(p)?.querySelector("section").lang === "ar", "notice language should refresh");
  assert.equal(consentNotice(p).querySelector("section").dir, "rtl");
  p.appStatus.type = "error";
  p.appStatus.code = "browser_connection_disabled";
  p.w.dispatchEvent(new p.w.Event("focus"));
  await waitFor(() => !consentNotice(p), "disabled connection must remove the consent prompt");
  assert.deepEqual(p.sent(), []);
});

const DISCORD_WEB_OPTIONS = { ...PRIVATE_OPTIONS, url: DISCORD_WEB_URL, renderAriaHidden: true };
const DISCORD_WEB_TEXT = ["General room", "Help desk", "General room", "A neutral message.",
  "A neutral preview title", "A neutral preview description.", "A field label", "A field value"];

test("웹 Discord 채널명과 링크 미리보기는 현재 서버의 허용된 텍스트만 번역한다", async (t) => {
  const p = page(t, DISCORD_WEB, DISCORD_WEB_OPTIONS);
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.sent().length === DISCORD_WEB_TEXT.length, "Discord channel names and previews are extracted");
  assert.deepEqual(p.sent().sort(), [...DISCORD_WEB_TEXT].sort());
  await waitFor(() => p.w.document.getElementById("channel-current").textContent.startsWith("번역("), "channel name is applied");
  assert.ok(p.requests.every((r) => r.privateContext.service === "discord"));
  assert.ok(!JSON.stringify(p.requests).includes("/channels/100/200"));
  assert.equal(p.w.document.getElementById("embed-title").getAttribute("href"), "https://example.invalid/page");
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  assert.equal(p.w.document.getElementById("channel-current").textContent, "General room");
  assert.equal(p.w.document.getElementById("embed-title").textContent, "A neutral preview title");
});

test("웹 Discord 채널명·미리보기도 동의·최신 정책·본체 허용 없이 읽지 않는다", async (t) => {
  for (const extra of [{ consent: false }, { consentVersion: 1 }, { settings: { messengerPolicyVersion: 0 } }, { settings: { enabled: false } }]) {
    const p = page(t, DISCORD_WEB, { ...DISCORD_WEB_OPTIONS, ...extra });
    const reads = ["channel-current", "channel-title", "embed-title"].map((id) => watchNodeValueReads(p.w, p.w.document.getElementById(id).firstChild));
    await p.message({ type: "nudenyang-ready" });
    await p.message({ type: "nudenyang-set-enabled", enabled: true });
    assert.equal(p.requests.length, 0);
    assert.ok(reads.every((read) => read() === 0));
  }
});

test("웹 Discord DM에서는 서버 채널명·상대 이름을 수집하지 않는다", async (t) => {
  const p = page(t, DISCORD_WEB, { ...DISCORD_WEB_OPTIONS, url: "https://discord.com/channels/@me/300" });
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.sent().length >= 5, "DM message and preview bodies translate");
  assert.deepEqual(p.sent().sort(), DISCORD_WEB_TEXT.slice(3).sort());
  assert.equal(p.w.document.getElementById("channel-title").textContent, "General room");
});

test("메시지가 없는 열린 Discord 서버 채널도 보이는 채널명은 번역한다", async (t) => {
  const p = page(t, DISCORD_WEB.replace(/<ol[\s\S]*?<\/ol>/, '<ol data-list-id="chat-messages"></ol>'), DISCORD_WEB_OPTIONS);
  await p.message({ type: "nudenyang-ready" });
  assert.equal((await p.message({ type: "nudenyang-status" })).messengerGate, "");
  await waitFor(() => p.sent().length === 3, "empty server channel labels translate");
  assert.deepEqual(p.sent().sort(), DISCORD_WEB_TEXT.slice(0, 3).sort());
});

test("하이픈 채널명도 번역하고 화면 밖 이름은 스크롤로 표시된 뒤 처리한다", async (t) => {
  const p = page(t, DISCORD_WEB.replaceAll("General room", "general-room").replace("Help desk", "help-desk"), DISCORD_WEB_OPTIONS);
  const label = p.w.document.getElementById("channel-other");
  label.setAttribute("data-offscreen", "");
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.sent().includes("general-room"), "hyphenated channel name translates");
  assert.equal(p.sent().includes("help-desk"), false);
  label.removeAttribute("data-offscreen");
  p.w.document.dispatchEvent(new p.w.Event("scroll"));
  // JSDOM has no layout engine: deliver the observer notification a real
  // browser emits when this already-observed label enters the viewport.
  p.intersect(label);
  await waitFor(() => p.sent().includes("help-desk"), "visible channel name translates after scroll");
  assert.equal(label.closest("a").getAttribute("href"), "/channels/100/201");
});

test("나중에 표시된 Discord 링크 미리보기도 현재 대화에서만 한 번 번역한다", async (t) => {
  const p = page(t, DISCORD_WEB, DISCORD_WEB_OPTIONS);
  const preview = p.w.document.querySelector("article");
  preview.hidden = true;
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.sent().length === 4, "initial message and labels translate");
  preview.hidden = false;
  await waitFor(() => p.sent().length === DISCORD_WEB_TEXT.length, "revealed preview translates");
  assert.deepEqual(p.sent().sort(), [...DISCORD_WEB_TEXT].sort());
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  assert.equal(p.w.document.getElementById("embed-description").textContent, "A neutral preview description.");
});

test("웹 Discord 채널명이 숨김·입력·다른 서버 링크로 바뀌면 늦은 번역을 적용하지 않는다", async (t) => {
  for (const action of ["hidden", "editor", "other-server", "revoke", "navigate"]) {
    const p = page(t, DISCORD_WEB, { ...DISCORD_WEB_OPTIONS, deferTranslation: true });
    await p.message({ type: "nudenyang-ready" });
    await waitFor(() => p.sent().includes("General room"), "channel translation in flight");
    const label = p.w.document.getElementById("channel-current");
    if (action === "hidden") label.hidden = true;
    if (action === "editor") label.setAttribute("contenteditable", "true");
    if (action === "other-server") label.closest("a").setAttribute("href", "/channels/900/200");
    if (action === "revoke") await p.message({ type: "nudenyang-messenger-refresh", consent: { granted: false, consentVersion: 0 } });
    if (action === "navigate") p.w.history.pushState({}, "", "/channels/@me/300");
    await p.message({ type: "nudenyang-status" });
    const reads = watchNodeValueReads(p.w, label.firstChild);
    p.releaseTranslation();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(label.textContent, "General room", action);
    assert.equal(reads(), 0, action);
  }
});

test("새 X 채팅은 기존 동의와 자동 번역 설정으로 본문만 추출한다", async (t) => {
  const p = page(t, X_CHAT, { ...PRIVATE_OPTIONS, url: X_CHAT_URL,
    settings: { messengerPolicyVersion: 3, sitePolicies: { "x.com": "always" } } });
  await p.message({ type: "nudenyang-ready" });
  const state = await p.message({ type: "nudenyang-status" });
  assert.equal(state.messengerGate, "");
  assert.equal(state.enabled, true);
  await waitFor(() => ["body-one", "body-two"].every((id) => p.w.document.getElementById(id).textContent.startsWith("번역(")), "modern X bodies should translate");
  assert.deepEqual(p.sent().sort(), ["A neutral incoming message.", "A neutral outgoing message."].sort());
  assert.ok(p.requests.every((r) => r.privateContext.service === "x" && r.pageId.startsWith("messenger:x:")));
  assert.ok(!JSON.stringify(p.requests).includes("synthetic-conversation"));
  for (const selector of ['[data-testid="dm-inbox-panel"]', '[role="textbox"]', '#send', '[role="status"]']) {
    assert.ok(!p.w.document.querySelector(selector).textContent.includes("번역("), selector);
  }
  assert.ok((await p.message({ type: "nudenyang-status" })).sentChars > 0);
});

test("새 X 채팅도 동의 전에는 본문을 읽지 않고 동의 후 같은 대화만 재개한다", async (t) => {
  const options = { ...PRIVATE_OPTIONS, url: X_CHAT_URL, consent: false, tabEnabled: false };
  const p = page(t, X_CHAT, options);
  const reads = watchNodeValueReads(p.w, p.w.document.querySelector("#body-one span").firstChild);
  await p.message({ type: "nudenyang-ready" });
  const state = await p.message({ type: "nudenyang-status" });
  assert.equal(state.messengerGate, "messenger_consent_required");
  assert.equal(reads(), 0);
  assert.equal(p.requests.length, 0);
  options.consent = true;
  assert.equal((await p.message({ type: "nudenyang-messenger-start", contextId: state.messengerContextId })).enabled, true);
  await waitFor(() => p.sent().length === 2, "consented X conversation resumes");
  assert.deepEqual(p.savedStates, []);
});

test("새 X 채팅의 스크롤러 밖으로 잘린 본문은 수집하지 않는다", async (t) => {
  const p = page(t, X_CHAT, { ...PRIVATE_OPTIONS, url: X_CHAT_URL, tabEnabled: false });
  await p.message({ type: "nudenyang-ready" });
  const clipped = p.w.document.querySelector("#body-two");
  // Model the site's overflow-y-auto utility without loading remote CSS.
  p.w.document.querySelector('[data-testid="dm-message-scroller"]').style.overflowY = "auto";
  clipped.getBoundingClientRect = () => ({ top: 100, bottom: 130, left: 10, right: 210, width: 200, height: 30 });
  const reads = watchNodeValueReads(p.w, clipped.firstChild.firstChild);
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  await waitFor(() => p.w.document.querySelector("#body-one").textContent.startsWith("번역("), "visible body translates");
  assert.deepEqual(p.sent(), ["A neutral incoming message."]);
  assert.equal(reads(), 0);
});

test("X 가상 스크롤의 첫 메시지 추가·제거는 같은 대화의 번역을 초기화하지 않는다", async (t) => {
  const p = page(t, X_CHAT, { ...PRIVATE_OPTIONS, url: X_CHAT_URL, tabEnabled: false });
  await p.message({ type: "nudenyang-ready" });
  const before = await p.message({ type: "nudenyang-status" });
  await p.message({ type: "nudenyang-messenger-start", contextId: before.messengerContextId });
  const body = p.w.document.querySelector("#body-two");
  await waitFor(() => body.textContent.startsWith("번역("), "X message initially translated");
  const translated = body.textContent;
  const firstRow = p.w.document.querySelector("#body-one").closest("[data-index]");
  firstRow.insertAdjacentHTML("beforebegin", xChatMessage("older-body", "An older synthetic message."));
  const older = p.w.document.querySelector("#older-body").closest("[data-index]");
  older.setAttribute("data-offscreen", "");
  let after = await p.message({ type: "nudenyang-status" });
  assert.equal(after.messengerContextId, before.messengerContextId, "prepending history must not change the conversation nonce");
  assert.equal(after.enabled, true, "conversation-only consent start survives scroll");
  assert.equal(body.textContent, translated);
  older.remove();
  firstRow.remove();
  after = await p.message({ type: "nudenyang-status" });
  assert.equal(after.messengerContextId, before.messengerContextId, "unmounting the first row must not reset the conversation");
  assert.equal(body.textContent, translated);
  assert.equal(p.requests.length, 1, "unchanged messages are not retransmitted");
});

test("X 스크롤 중 잠시 비는 메시지 목록은 대화 전환으로 처리하지 않는다", async (t) => {
  const p = page(t, X_CHAT, { ...PRIVATE_OPTIONS, url: X_CHAT_URL, tabEnabled: false, deferTranslation: true });
  await p.message({ type: "nudenyang-ready" });
  const before = await p.message({ type: "nudenyang-status" });
  await p.message({ type: "nudenyang-messenger-start", contextId: before.messengerContextId });
  await waitFor(() => p.requests.length === 1, "X translation started");
  const root = p.w.document.querySelector('[data-testid="dm-message-scroller"]');
  const rows = [...root.querySelectorAll("[data-index]")];
  const parent = rows[0].parentElement;
  rows.forEach((row) => row.remove());
  const empty = await p.message({ type: "nudenyang-status" });
  assert.equal(empty.messengerContextId, before.messengerContextId);
  assert.equal(empty.enabled, true);
  parent.append(...rows);
  p.releaseTranslation();
  await waitFor(() => p.w.document.querySelector("#body-two").textContent.startsWith("번역("), "pending translation survives transient empty list");
  assert.equal(p.requests.length, 1);
});

test("X 스크롤로 가려진 번역은 상태 갱신에도 보존하고 새 본문은 읽지 않는다", async (t) => {
  const p = page(t, X_CHAT, { ...PRIVATE_OPTIONS, url: X_CHAT_URL });
  await p.message({ type: "nudenyang-ready" });
  const body = p.w.document.querySelector("#body-two");
  await waitFor(() => body.textContent.startsWith("번역("), "initial X translation applied");
  const translated = body.textContent;
  body.setAttribute("data-offscreen", "");
  const reads = watchNodeValueReads(p.w, body.firstChild.firstChild);
  await p.message({ type: "nudenyang-messenger-refresh", consent: { granted: true, consentVersion: 3 } });
  assert.equal(body.textContent, translated, "permission refresh must not restore clipped translations");
  assert.equal(reads(), 0, "retaining an existing result must not reread offscreen text");
  body.removeAttribute("data-offscreen");
  p.intersect(body);
  await p.message({ type: "nudenyang-status" });
  assert.equal(body.textContent, translated);
  assert.equal(p.requests.length, 1);
  await p.message({ type: "nudenyang-messenger-refresh", consent: { granted: false, consentVersion: 0 } });
  assert.equal(body.textContent, "A neutral outgoing message.");
});

test("새 X 채팅의 대화 이동·동의 철회는 진행 중 결과와 사본을 폐기한다", async (t) => {
  for (const action of ["navigate", "revoke"]) {
    const options = { ...PRIVATE_OPTIONS, url: X_CHAT_URL, tabEnabled: false, deferTranslation: true };
    const p = page(t, X_CHAT, options);
    await p.message({ type: "nudenyang-ready" });
    const before = await p.message({ type: "nudenyang-status" });
    await p.message({ type: "nudenyang-messenger-start", contextId: before.messengerContextId });
    await waitFor(() => p.requests.length > 0, "X translation is in flight");
    const count = p.requests.length;
    if (action === "navigate") {
      p.w.history.pushState({}, "", "/i/chat/another-synthetic-conversation");
      p.w.document.querySelector('[data-testid="dm-message-scroller"]').innerHTML = xChatMessage("new-body", "Another neutral conversation.");
    } else {
      options.consent = false;
      await p.message({ type: "nudenyang-messenger-refresh", consent: { granted: false, consentVersion: 0 } });
    }
    const after = await p.message({ type: "nudenyang-status" });
    assert.equal(after.enabled, false, action);
    assert.equal(after.translatedNodes, 0, action);
    p.releaseTranslation();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(p.requests.length, count, action);
    assert.ok(!p.w.document.querySelector('[data-testid="dm-message-scroller"]').textContent.includes("번역("), action);
  }
});

test("X 스크롤 보존 중에도 패널 교체·대화 이동·철회·OFF는 사본을 정리한다", async (t) => {
  for (const action of ["panel", "navigate", "revoke", "off"]) {
    const p = page(t, X_CHAT, { ...PRIVATE_OPTIONS, url: X_CHAT_URL, tabEnabled: false });
    await p.message({ type: "nudenyang-ready" });
    const before = await p.message({ type: "nudenyang-status" });
    await p.message({ type: "nudenyang-messenger-start", contextId: before.messengerContextId });
    const body = p.w.document.querySelector("#body-two");
    await waitFor(() => body.textContent.startsWith("번역("), "X translation applied");
    body.setAttribute("data-offscreen", "");
    if (action === "panel") {
      p.w.document.querySelector('[data-testid="dm-conversation-panel"]').outerHTML = X_CHAT_PANEL;
    } else if (action === "navigate") {
      p.w.history.pushState({}, "", "/i/chat/next-synthetic-conversation");
    } else if (action === "revoke") {
      await p.message({ type: "nudenyang-messenger-refresh", consent: { granted: false, consentVersion: 0 } });
    } else {
      await p.message({ type: "nudenyang-set-enabled", enabled: false });
    }
    const after = await p.message({ type: "nudenyang-status" });
    assert.equal(after.enabled, false, action);
    assert.equal(after.translatedNodes, 0, action);
    assert.equal(p.w.document.querySelector("#body-two").textContent, "A neutral outgoing message.", action);
    assert.equal(p.requests.length, 1, action);
  }
});

test("X 화면 밖 노드가 입력·작성자·숨김 영역으로 바뀌면 스크롤 보존 예외를 적용하지 않는다", async (t) => {
  for (const action of ["editor", "author", "hidden"]) {
    const p = page(t, X_CHAT, { ...PRIVATE_OPTIONS, url: X_CHAT_URL });
    await p.message({ type: "nudenyang-ready" });
    const body = p.w.document.querySelector("#body-two");
    await waitFor(() => body.textContent.startsWith("번역("), "initial result applied");
    body.setAttribute("data-offscreen", "");
    if (action === "editor") body.setAttribute("contenteditable", "true");
    if (action === "author") body.setAttribute("data-testid", "messageSender");
    if (action === "hidden") body.hidden = true;
    body.firstChild.firstChild.nodeValue = "A repurposed synthetic value.";
    const reads = watchNodeValueReads(p.w, body.firstChild.firstChild);
    await p.message({ type: "nudenyang-messenger-refresh", consent: { granted: true, consentVersion: 3 } });
    assert.equal(reads(), 0, action);
    assert.equal(body.textContent, "A repurposed synthetic value.", action);
    assert.equal(p.requests.length, 1, action);
  }
});

test("동의 후 시작은 새 동의 상태를 확인하여 새로고침 없이 기존 대화를 번역한다", async (t) => {
  const options = { ...PRIVATE_OPTIONS, consent: false, tabEnabled: false };
  const p = page(t, PRIVATE_CHAT, options);
  await p.message({ type: "nudenyang-ready" });
  const before = await p.message({ type: "nudenyang-status" });
  assert.equal(before.enabled, false);
  assert.match(before.messengerContextId, /^messenger:discord:/);
  assert.equal(p.requests.length, 0);
  options.consent = true;
  const after = await p.message({ type: "nudenyang-messenger-start", contextId: before.messengerContextId });
  assert.equal(after.enabled, true);
  await waitFor(() => p.sent().length > 0, "consented conversation resumes without navigation");
  assert.ok(!p.sent().some((text) => /draft|sender|timestamp/.test(text)));
});

test("동의 후 시작도 본체 OFF·외부 AI·동의 미완료·다른 대화에는 적용되지 않는다", async (t) => {
  for (const extra of [{ consent: false }, { settings: { enabled: false } }, { settings: { messengerPolicyVersion: 0 } }, { changed: true }]) {
    const p = page(t, PRIVATE_CHAT, { ...PRIVATE_OPTIONS, tabEnabled: false, ...extra });
    await p.message({ type: "nudenyang-ready" });
    const before = await p.message({ type: "nudenyang-status" });
    if (extra.changed) p.w.history.pushState({}, "", "/channels/@me/987654321");
    const after = await p.message({ type: "nudenyang-messenger-start", contextId: before.messengerContextId });
    assert.equal(after.enabled, false);
    assert.equal(p.requests.length, 0);
    assert.equal(p.savedStates.length, 0);
  }
});

test("X DM 동의 후 받은·보낸 메시지만 번역하고 작성창과 전송 버튼은 그대로 둔다", async (t) => {
  const options = { ...PRIVATE_OPTIONS, url: "https://x.com/messages/101-202", consent: false, tabEnabled: false };
  const p = page(t, `<div data-testid="DmActivityViewport">
    <div data-testid="messageEntry"><span data-testid="messageSender">Example Sender</span>
      <span dir="auto" id="incoming">A neutral incoming message.</span><time>12:01</time></div>
    <button data-testid="messageEntry"><span dir="auto" id="outgoing">A neutral reply.</span></button>
    </div><div contenteditable="true" role="textbox">Unsent private draft</div><button id="send">Send</button>`, options);
  await p.message({ type: "nudenyang-ready" });
  const before = await p.message({ type: "nudenyang-status" });
  assert.equal(before.messengerGate, "messenger_consent_required");
  options.consent = true;
  // The consent page has focus: accepting must not read a background conversation.
  let hidden = true;
  Object.defineProperty(p.w.document, "hidden", { configurable: true, get: () => hidden });
  const after = await p.message({ type: "nudenyang-messenger-start", contextId: before.messengerContextId });
  assert.equal(after.enabled, true);
  assert.equal(p.requests.length, 0);
  hidden = false;
  p.w.document.dispatchEvent(new p.w.Event("visibilitychange"));
  p.w.dispatchEvent(new p.w.FocusEvent("focus"));
  await waitFor(() => ["incoming", "outgoing"].every((id) => p.w.document.getElementById(id).textContent.startsWith("번역(")), "both X message directions resume on returning to the tab");
  assert.deepEqual(p.sent().sort(), ["A neutral incoming message.", "A neutral reply."].sort());
  assert.ok(p.requests.every((request) => request.privateContext.service === "x"));
  assert.equal(p.w.document.querySelector("[contenteditable]").textContent, "Unsent private draft");
  assert.equal(p.w.document.getElementById("send").textContent, "Send");
});

test("동의로 시작한 임시 상태는 다른 대화로 따라가지 않고 탭 상태도 저장하지 않는다", async (t) => {
  const p = page(t, PRIVATE_CHAT, { ...PRIVATE_OPTIONS, tabEnabled: false });
  await p.message({ type: "nudenyang-ready" });
  const before = await p.message({ type: "nudenyang-status" });
  await p.message({ type: "nudenyang-messenger-start", contextId: before.messengerContextId });
  await waitFor(() => p.sent().length > 0, "source conversation translates");
  const count = p.requests.length;
  p.w.history.pushState({}, "", "/channels/@me/987654321");
  p.w.document.querySelector("[data-list-id]").innerHTML = '<li><div id="message-content-2">Another conversation</div></li>';
  const after = await p.message({ type: "nudenyang-status" });
  assert.equal(after.enabled, false);
  assert.notEqual(after.messengerContextId, before.messengerContextId);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(p.requests.length, count);
  assert.deepEqual(p.savedStates, []);
});

test("동의 후 시작의 느린 상태 응답보다 최신 OFF·철회·대화 이동이 우선한다", async (t) => {
  for (const action of ["off", "revoke", "navigate", "main-off"]) {
    const options = { ...PRIVATE_OPTIONS, tabEnabled: false };
    const p = page(t, PRIVATE_CHAT, options);
    await p.message({ type: "nudenyang-ready" });
    const before = await p.message({ type: "nudenyang-status" });
    options.deferStatus = true;
    const pending = p.message({ type: "nudenyang-messenger-start", contextId: before.messengerContextId });
    await waitFor(() => p.runtimeMessages.some((m) => m.request?.requestId?.startsWith("messenger-start-")), "resume status lookup pending");
    if (action === "off") await p.message({ type: "nudenyang-set-enabled", enabled: false });
    if (action === "revoke") {
      options.consent = false;
      await p.message({ type: "nudenyang-messenger-refresh", consent: { granted: false, consentVersion: 0 } });
    }
    if (action === "navigate") p.w.history.pushState({}, "", "/channels/@me/987654321");
    if (action === "main-off") {
      p.appStatus.webSettings.enabled = false;
      await p.message({ type: "nudenyang-apply-web-settings", webSettings: p.appStatus.webSettings });
    }
    options.deferStatus = false;
    p.releaseStatus();
    assert.equal((await pending).enabled, false, action);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(p.requests.length, 0, action);
  }
});

test("웹 메신저는 공통 웹 설정·브라우저 동의·최신 정책이 있어야 본문을 읽는다", async (t) => {
  for (const extra of [{ settings: { enabled: false } }, { consent: false }, { consentVersion: 2 }, { settings: { messengerPolicyVersion: 0 } }]) {
    const p = page(t, PRIVATE_CHAT, { ...PRIVATE_OPTIONS, ...extra });
    await p.message({ type: "nudenyang-ready" });
    await p.message({ type: "nudenyang-set-enabled", enabled: true });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(p.requests.length, 0);
    const state = await p.message({ type: "nudenyang-status" });
    assert.equal(state.messengerService, "discord");
    assert.ok(state.messengerGate);
    assert.ok(p.w.document.querySelector("#message-content-1").textContent.includes("Hello"));
  }
});

test("동의한 웹 Discord는 본문만 사적 컨텍스트로 보내고 원문 비교에 재요청하지 않는다", async (t) => {
  const p = page(t, PRIVATE_CHAT, PRIVATE_OPTIONS);
  await p.message({ type: "nudenyang-ready" });
  const body = p.w.document.querySelector("#message-content-1");
  const original = body.innerHTML;
  await waitFor(() => body.textContent.includes("번역(Hello"), "opted-in message should translate");
  assert.equal(p.sent().length, 1);
  assert.ok(!p.sent().some((text) => /sender|draft|timestamp|person|secret_code|https:/.test(text)));
  for (const request of p.requests) {
    assert.deepEqual(JSON.parse(JSON.stringify(request.privateContext)), { service: "discord", consentVersion: 3 });
    assert.match(request.pageId, /^messenger:discord:[a-zA-Z0-9_-]{16,128}$/);
    assert.ok(!JSON.stringify(request).includes("123456789"));
  }
  const count = p.requests.length;
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  assert.equal(body.innerHTML, original);
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  assert.ok(body.textContent.includes("번역(Hello"));
  assert.equal(p.requests.length, count);
  assert.equal(p.w.document.querySelector("[contenteditable]").textContent, "Unsent private draft");
});

test("메신저 동의 철회와 외부 모델 전환은 원문을 복원하고 사적 캐시를 폐기한다", async (t) => {
  const p = page(t, PRIVATE_CHAT, PRIVATE_OPTIONS);
  await p.message({ type: "nudenyang-ready" });
  const body = p.w.document.querySelector("#message-content-1");
  await waitFor(() => body.textContent.includes("번역(Hello"), "initial translation");
  await p.message({ type: "nudenyang-messenger-refresh", consent: { granted: false, consentVersion: 0 } });
  assert.ok(!body.textContent.includes("번역("));
  assert.equal((await p.message({ type: "nudenyang-status" })).translatedNodes, 0);
  await p.message({ type: "nudenyang-messenger-refresh", consent: { granted: true, consentVersion: 3 } });
  await waitFor(() => p.requests.length >= 2 && body.textContent.includes("번역("), "re-consent starts fresh");
  p.appStatus.webSettings.messengerPolicyVersion = 0;
  p.w.dispatchEvent(new p.w.FocusEvent("focus"));
  await waitFor(() => !body.textContent.includes("번역("), "old companion must discard private display");
  const state = await p.message({ type: "nudenyang-status" });
  assert.equal(state.messengerGate, "messenger_update_required");
});

for (const { label, update, gate } of [
  { label: "동의 철회", update: { type: "nudenyang-messenger-refresh",
    consent: { granted: false, consentVersion: 0 } }, gate: "messenger_consent_required" },
  { label: "본체 설정 끄기", update: { type: "nudenyang-apply-web-settings",
    webSettings: { enabled: false, messengerPolicyVersion: 3 } }, gate: "web_translation_disabled" },
]) {
  test(`늦게 도착한 상태 조회는 최신 ${label}를 덮어쓰지 않는다`, async (t) => {
    const options = { ...PRIVATE_OPTIONS };
    const p = page(t, PRIVATE_CHAT, options);
    await p.message({ type: "nudenyang-ready" });
    const body = p.w.document.querySelector("#message-content-1");
    await waitFor(() => body.textContent.includes("번역("), "initial private translation");
    options.deferStatus = true;
    p.w.dispatchEvent(new p.w.FocusEvent("focus"));
    await p.message(update);
    const requestCount = p.requests.length;
    p.releaseStatus();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const state = await p.message({ type: "nudenyang-status" });
    assert.equal(state.enabled, false);
    assert.equal(state.messengerGate, gate);
    assert.equal(p.requests.length, requestCount, "stale permission must not enqueue private text again");
    assert.ok(!body.textContent.includes("번역("));
  });
}

test("시작 상태 조회 중 철회한 메신저 동의는 본문을 읽기 전에 적용한다", async (t) => {
  const p = page(t, PRIVATE_CHAT, { ...PRIVATE_OPTIONS, deferStatus: true });
  const body = p.w.document.querySelector("#message-content-1");
  const reads = watchNodeValueReads(p.w, body.firstChild);
  const revoked = p.message({ type: "nudenyang-messenger-refresh",
    consent: { granted: false, consentVersion: 0 } });
  p.releaseStatus();
  await revoked;
  assert.equal(reads(), 0, "startup must not briefly read text with a revoked consent snapshot");
  assert.equal(p.requests.length, 0);
  assert.equal((await p.message({ type: "nudenyang-status" })).enabled, false);
});

test("대화 전환 중 늦은 번역은 다른 대화에 적용하지 않고 대화 ID를 전송하지 않는다", async (t) => {
  const p = page(t, PRIVATE_CHAT, { ...PRIVATE_OPTIONS, deferTranslation: true });
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.requests.length === 1, "first conversation in flight");
  const firstPageId = p.requests[0].pageId;
  const root = p.w.document.querySelector("[data-list-id]");
  p.w.history.pushState(null, "", "/channels/@me/987654321");
  root.innerHTML = '<li><div id="message-content-2">A different private conversation</div></li>';
  p.releaseTranslation();
  await waitFor(() => p.requests.length === 2, "second conversation starts");
  assert.notEqual(p.requests[1].pageId, firstPageId);
  assert.ok(!root.textContent.includes("번역("));
  p.releaseTranslation();
  await waitFor(() => root.textContent.includes("번역(A different"), "second conversation translated");
  assert.ok(!JSON.stringify(p.requests).includes("987654321"));
});

// Keep the first message stable so these changes exercise per-node privacy,
// rather than passing because the conversation-identity guard discarded it all.
const RECLASSIFIED_CHAT = `<ol data-list-id="chat-messages">
  <li><div id="message-content-anchor">Stable neutral anchor</div></li>
  <li><div id="message-content-changing">Secondary synthetic message</div></li>
</ol>`;
const PRIVATE_NODE_CHANGES = [
  { label: "숨김", attribute: "hidden", value: "" },
  { label: "작성창", attribute: "contenteditable", value: "true" },
  { label: "작성자 영역", attribute: "class", value: "message-author" },
];

function watchNodeValueReads(w, node) {
  const descriptor = Object.getOwnPropertyDescriptor(w.Node.prototype, "nodeValue");
  let reads = 0;
  Object.defineProperty(node, "nodeValue", {
    configurable: true,
    get() { reads += 1; return descriptor.get.call(this); },
    set(value) { descriptor.set.call(this, value); },
  });
  return () => reads;
}

for (const { label, attributes } of [
  { label: "작성창", attributes: 'contenteditable="true"' },
  { label: "작성자", attributes: 'class="message-author"' },
  { label: "숨김 속성", attributes: "hidden" },
  { label: "CSS 숨김", attributes: 'style="display:none"' },
  { label: "투명 요소", attributes: 'style="opacity:0"' },
]) {
  test(`메신저 링크 안의 ${label} 텍스트는 링크 판별을 위해서도 읽지 않는다`, async (t) => {
    const html = RECLASSIFIED_CHAT.replace("Secondary synthetic message", `Visible surrounding message
      <a id="mixed-private-link" href="https://example.com/article">Visible link label
        <span ${attributes}>Protected synthetic text</span>
      </a>`);
    const p = page(t, html, PRIVATE_OPTIONS);
    const anchor = p.w.document.querySelector("#mixed-private-link");
    const descriptor = Object.getOwnPropertyDescriptor(p.w.Node.prototype, "textContent");
    let aggregateReads = 0;
    Object.defineProperty(anchor, "textContent", {
      configurable: true,
      get() { aggregateReads += 1; return descriptor.get.call(this); },
      set(value) { descriptor.set.call(this, value); },
    });
    const protectedReads = watchNodeValueReads(p.w, anchor.querySelector("span").firstChild);
    await p.message({ type: "nudenyang-ready" });
    await waitFor(() => p.w.document.querySelector("#message-content-anchor").textContent.includes("번역("),
      "the same conversation should still translate its ordinary message");
    assert.ok(p.sent().some((text) => text.includes("Visible surrounding message")));
    assert.ok(!p.sent().some((text) => text.includes("Protected synthetic text")));
    assert.equal(aggregateReads, 0, "link classification must not read a protected descendant through textContent");
    assert.equal(protectedReads(), 0, "protected descendant nodeValue must remain unread");
  });
}

test("메신저의 일반 설명 링크는 번역하고 URL 형태의 링크는 보존한다", async (t) => {
  const html = RECLASSIFIED_CHAT.replace("Secondary synthetic message", `
    <a id="ordinary-private-link" href="https://example.com/article">Read the <strong>article</strong></a>
    <a id="url-private-link" href="https://example.com/article"><span>https://example.com/article</span></a>`);
  const p = page(t, html, PRIVATE_OPTIONS);
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.w.document.querySelector("#ordinary-private-link").textContent.includes("번역("),
    "ordinary link labels inside a message should remain translatable");
  assert.ok(p.sent().some((text) => text.includes("Read the")));
  assert.ok(!p.sent().some((text) => text.includes("https://example.com/article")));
  assert.equal(p.w.document.querySelector("#url-private-link").textContent, "https://example.com/article");
});

for (const { label, attribute, value } of PRIVATE_NODE_CHANGES) {
  test(`전송 직전에 ${label}으로 바뀐 메신저 노드는 현재 텍스트 자체도 읽지 않는다`, async (t) => {
    const p = page(t, RECLASSIFIED_CHAT, PRIVATE_OPTIONS);
    await p.message({ type: "nudenyang-ready" });
    assert.equal(p.requests.length, 0, "messages should still be queued");
    const node = p.w.document.querySelector("#message-content-changing");
    node.setAttribute(attribute, value);
    const reads = watchNodeValueReads(p.w, node.firstChild);
    await waitFor(() => p.w.document.querySelector("#message-content-anchor").textContent.includes("번역("),
      "the unchanged message should pass through the same queue");
    assert.ok(!p.sent().includes("Secondary synthetic message"));
    assert.equal(reads(), 0, "private eligibility must be checked before accessing nodeValue");
  });

  test(`대기 중 ${label}으로 바뀌어 제외된 메신저 노드는 원문 추적도 폐기한다`, async (t) => {
    const p = page(t, RECLASSIFIED_CHAT, PRIVATE_OPTIONS);
    await p.message({ type: "nudenyang-ready" });
    const node = p.w.document.querySelector("#message-content-changing");
    node.setAttribute(attribute, value);
    await waitFor(() => p.w.document.querySelector("#message-content-anchor").textContent.includes("번역("),
      "the queue should discard the ineligible message");
    const reads = watchNodeValueReads(p.w, node.firstChild);
    node.removeAttribute(attribute);
    await p.message({ type: "nudenyang-set-enabled", enabled: false });
    assert.equal(reads(), 0, "a discarded node must no longer participate in original/cache restoration");
  });

  test(`메신저 상태 조회는 ${label}으로 바뀐 노드의 값이나 번역 개수를 읽지 않는다`, async (t) => {
    const p = page(t, RECLASSIFIED_CHAT, PRIVATE_OPTIONS);
    await p.message({ type: "nudenyang-ready" });
    const node = p.w.document.querySelector("#message-content-changing");
    await waitFor(() => node.textContent.includes("번역("), "initial translation");
    node.setAttribute(attribute, value);
    const reads = watchNodeValueReads(p.w, node.firstChild);
    const state = await p.message({ type: "nudenyang-status" });
    assert.equal(reads(), 0, "status must not inspect a private editor, author, or hidden message");
    assert.equal(state.translatedNodes, 1, "only the still-visible read-only message should be counted");
  });

  test(`메신저 변경 감시는 ${label}으로 바뀐 노드에 입력된 값을 읽지 않는다`, async (t) => {
    const p = page(t, RECLASSIFIED_CHAT, PRIVATE_OPTIONS);
    await p.message({ type: "nudenyang-ready" });
    const node = p.w.document.querySelector("#message-content-changing");
    await waitFor(() => node.textContent.includes("번역("), "initial translation");
    node.setAttribute(attribute, value);
    const reads = watchNodeValueReads(p.w, node.firstChild);
    const count = p.requests.length;
    node.firstChild.nodeValue = "New protected synthetic text";
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(reads(), 0, "a characterData event must not read newly protected text");
    assert.equal(p.requests.length, count);
  });

  test(`메신저 응답 대기 중 ${label}으로 바뀐 본문에는 늦은 결과를 쓰거나 보관하지 않는다`, async (t) => {
    const p = page(t, RECLASSIFIED_CHAT, { ...PRIVATE_OPTIONS, deferTranslation: true });
    await p.message({ type: "nudenyang-ready" });
    await waitFor(() => p.sent().includes("Secondary synthetic message"), "both messages in flight");
    const node = p.w.document.querySelector("#message-content-changing");
    node.setAttribute(attribute, value);
    p.releaseTranslation();
    await waitFor(() => p.w.document.querySelector("#message-content-anchor").textContent.includes("번역("),
      "the unchanged message should still translate");
    assert.equal(node.textContent, "Secondary synthetic message", "excluded node must remain untouched");
    const count = p.requests.length;
    node.removeAttribute(attribute);
    await p.message({ type: "nudenyang-set-enabled", enabled: true });
    await waitFor(() => p.requests.length > count, "discarded private result must be requested again");
    assert.equal(node.textContent, "Secondary synthetic message", "discarded result must not replay");
    p.releaseTranslation();
    await waitFor(() => node.textContent.includes("번역("), "newly eligible message should translate again");
  });

  test(`메신저 원문 비교 중 ${label}으로 바뀐 본문은 번역 캐시를 재적용하지 않는다`, async (t) => {
    const p = page(t, RECLASSIFIED_CHAT, PRIVATE_OPTIONS);
    await p.message({ type: "nudenyang-ready" });
    const node = p.w.document.querySelector("#message-content-changing");
    await waitFor(() => node.textContent.includes("번역("), "initial translation");
    await p.message({ type: "nudenyang-set-enabled", enabled: false });
    assert.equal(node.textContent, "Secondary synthetic message");
    node.setAttribute(attribute, value);
    const count = p.requests.length;
    await p.message({ type: "nudenyang-set-enabled", enabled: true });
    assert.equal(node.textContent, "Secondary synthetic message", "excluded node must not receive a cached translation");
    assert.equal(p.requests.length, count, "excluded node must not be re-requested either");
    node.removeAttribute(attribute);
    await p.message({ type: "nudenyang-set-enabled", enabled: true });
    await waitFor(() => p.requests.length > count, "excluded node's cached text must be discarded");
    await waitFor(() => node.textContent.includes("번역("), "eligible message should translate after a fresh request");
  });

  test(`메신저 표시 대기 중 ${label}으로 바뀐 결과는 끄는 순간에도 캐시로 보관하지 않는다`, async (t) => {
    const p = page(t, RECLASSIFIED_CHAT, { ...PRIVATE_OPTIONS, deferApplications: true });
    await p.message({ type: "nudenyang-ready" });
    await waitFor(() => p.pendingApplicationFrames() > 0, "translation is waiting for a display frame");
    const node = p.w.document.querySelector("#message-content-changing");
    node.setAttribute(attribute, value);
    await p.message({ type: "nudenyang-set-enabled", enabled: false });
    assert.equal(node.textContent, "Secondary synthetic message");
    const count = p.requests.length;
    node.removeAttribute(attribute);
    await p.message({ type: "nudenyang-set-enabled", enabled: true });
    assert.equal(node.textContent, "Secondary synthetic message", "settled private result must not survive exclusion");
    await waitFor(() => p.requests.length > count, "excluded pending result must start a fresh request");
    await waitFor(() => p.pendingApplicationFrames() > 0, "fresh result should be pending");
    p.releaseApplications();
    await waitFor(() => node.textContent.includes("번역("), "fresh result should be eligible to display");
  });
}

test("메신저 원문 복원은 숨긴 본문만 정리하고 작성창·작성자로 재사용된 노드는 쓰지 않는다", async (t) => {
  for (const { attribute, value } of PRIVATE_NODE_CHANGES) {
    const p = page(t, RECLASSIFIED_CHAT, PRIVATE_OPTIONS);
    await p.message({ type: "nudenyang-ready" });
    const node = p.w.document.querySelector("#message-content-changing");
    await waitFor(() => node.textContent.includes("번역("), "initial translation");
    node.setAttribute(attribute, value);
    await p.message({ type: "nudenyang-set-enabled", enabled: false });
    assert.equal(node.textContent, attribute === "hidden"
      ? "Secondary synthetic message" : "번역(Secondary synthetic message)",
    "only an unchanged read-only message may be restored; editor/author text is no longer ours to write");
    if (attribute !== "hidden") {
      await p.message({ type: "nudenyang-set-enabled", enabled: true });
      const state = await p.message({ type: "nudenyang-status" });
      assert.equal(state.translatedNodes, 1, "repurposed node must no longer be tracked as translated");
    }
  }
});

test("X 공개 타임라인의 DM 서랍도 별도 동의가 없으면 절대 번역하지 않는다", async (t) => {
  const p = page(t, `<main><article><div data-testid="tweetText">Public timeline message</div></article></main>
    <div data-testid="DMDrawer"><div data-testid="DmActivityViewport">
      <div data-testid="messageEntry"><span dir="auto">Private drawer conversation</span></div>
    </div></div>`, { url: "https://x.com/home", settings: { messengerPolicyVersion: 3 }, consent: false });
  await p.message({ type: "nudenyang-ready" });
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  assert.equal(p.requests.length, 0);
  await p.message({ type: "nudenyang-messenger-refresh", consent: { granted: true, consentVersion: 3 } });
  await waitFor(() => p.sent().includes("Private drawer conversation"), "consented drawer translates");
  assert.ok(!p.sent().includes("Public timeline message"));
  assert.equal(p.requests[0].privateContext.service, "x");
});

test("메신저 미지원 화면·메일·비공개 경로는 일반 본문 수집으로 우회하지 않는다", async (t) => {
  for (const url of ["https://x.com/i/chat/compose", "https://discord.com/channels/@me",
    "https://mail.google.com/mail/u/0/", "https://app.slack.com/client/TABC/search"]) {
    const p = page(t, '<main><p>Private fallback must not translate</p></main>', { ...PRIVATE_OPTIONS, url });
    await p.message({ type: "nudenyang-ready" });
    await p.message({ type: "nudenyang-set-enabled", enabled: true });
    assert.equal(p.requests.length, 0);
  }
});

test("상품 설명은 임의의 본문 ID와 혼합 인라인 구조에서도 빠짐없이 한 번 수집한다", async (t) => {
  const p = page(t, `<section id="mainContent">
    <div class="point3Txt">商品を紹介します<br><br>便利な<strong>新しい機能</strong>です。</div>
    <div class="card-specs_newTxt">発売日について<hr>詳しい説明です。<a href="/product/">製品情報</a></div>
    <p>本文の<strong>強調した言葉</strong>です。</p>
    <div><span><b>別の案内文</b></span></div>
    <div>見出し以外の文章<p>独立した段落</p>段落の後の文章</div>
  </section>`);
  await p.message({ type: "nudenyang-ready" });
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  await waitFor(() => p.sent().includes("別の案内文"), "nested public copy should translate");
  for (const text of ["商品を紹介します", "便利な", "新しい機能", "です。", "発売日について",
    "詳しい説明です。", "製品情報", "本文の", "強調した言葉", "別の案内文",
    "見出し以外の文章", "独立した段落", "段落の後の文章"]) {
    assert.ok(p.sent().includes(text), `missing: ${text}`);
  }
  assert.equal(p.sent().filter((text) => text === "商品を紹介します").length, 1);
  assert.equal(p.sent().filter((text) => text === "別の案内文").length, 1);
  assert.equal(p.w.document.querySelector("a").getAttribute("href"), "/product/");
});

test("공개 검색 조건과 탐색 문구만 번역하고 값·개인 입력·코드는 보존한다", async (t) => {
  const p = page(t, `<header class="l-header"><a href="/company/">会社情報</a>
    <button type="button"><span>検索</span></button></header>
    <nav><ul class="ul_Navi01"><li><span class="naviBtn accBtn01">はじめての方へ</span></li></ul></nav>
    <form id="search_cond"><p class="point">フリーワード検索</p>
      <input type="text" name="keyword" value="秘密の検索語">
      <input id="field1" type="checkbox" name="keyword_type[]" value="card_name">
      <label for="field1">カード名</label><button type="button">リセット</button>
      <label>種族<input value="private-input"></label>
    </form>
    <footer class="l-footer"><a href="/support/">お問い合わせ</a></footer>
    <form id="private-form"><p>秘密の内容</p><input value="private"></form>
    <pre><code>private_code();</code></pre><div contenteditable="true">編集中の内容</div>
    <p hidden>秘密の非表示文</p>`);
  await p.message({ type: "nudenyang-ready" });
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  await waitFor(() => p.sent().includes("カード名"), "public search labels should translate");
  for (const text of ["会社情報", "検索", "はじめての方へ", "フリーワード検索", "リセット", "種族", "お問い合わせ"]) {
    assert.ok(p.sent().includes(text), `missing: ${text}`);
  }
  assert.ok(!p.sent().some((text) => /秘密|private|編集中/.test(text)));
  assert.equal(p.w.document.querySelector("[name=keyword]").value, "秘密の検索語");
  assert.equal(p.w.document.querySelector("#field1").value, "card_name");
});

test("메뉴가 표시된 뒤 속성만 바뀌어도 재수집하고 다시 가린 문구는 전송하지 않는다", async (t) => {
  const p = page(t, `<header class="l-header">
    <div id="search-dialog" aria-hidden="true"><a href="/product/">展開したメニュー</a></div>
  </header>`);
  await p.message({ type: "nudenyang-ready" });
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  assert.equal(p.sent().length, 0);
  p.w.document.querySelector("#search-dialog").setAttribute("aria-hidden", "false");
  await waitFor(() => p.sent().includes("展開したメニュー"), "shown menu should be rediscovered");
});

test("하단 사이트맵의 모든 펼침 제목은 접힌 상태에서도 번역하고 버튼 구조를 보존한다", async (t) => {
  const titles = ["商品情報", "シーズンサイト", "ブランドからさがす", "ジャンルからさがす",
    "対象年齢からさがす", "50音順からさがす", "会社情報", "投資家情報", "お客様相談室"];
  const p = page(t, `<footer class="l-footer"><ul>${titles.map((title, index) => `
    <li class="l-footer-sitemap__item" data-group="accordion">
      <button class="l-footer-sitemap__trigger" id="footer-tab-${index}" aria-expanded="false"
        aria-controls="footer-panel-${index}" data-trigger="accordion">${title}</button>
      <div class="l-footer-sitemap__lower" aria-hidden="true" role="region"
        id="footer-panel-${index}" aria-labelledby="footer-tab-${index}">
        <ul><li><a class="l-footer-sitemap__lower-link" href="/products/${index}/">${title}の一覧</a></li></ul>
      </div>
    </li>`).join("")}</ul><a href="/company/">企業のご案内</a></footer>`, {
    url: "https://dm.takaratomy.co.jp/product/dm26ex2/",
  });
  const buttons = [...p.w.document.querySelectorAll("button")];
  const textNodes = buttons.map((button) => button.firstChild);
  const attributes = buttons.map((button) => [...button.attributes].map(({ name, value }) => [name, value]));
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => buttons.every((button, index) => button.textContent === `번역(${titles[index]})`),
    "all collapsed sitemap headings should translate");
  for (let index = 0; index < buttons.length; index += 1) {
    assert.equal(p.w.document.getElementById(`footer-tab-${index}`), buttons[index]);
    assert.equal(buttons[index].firstChild, textNodes[index]);
    assert.deepEqual([...buttons[index].attributes].map(({ name, value }) => [name, value]), attributes[index]);
    assert.equal(p.sent().filter((text) => text === titles[index]).length, 1);
    assert.equal(p.sent().includes(`${titles[index]}の一覧`), false);
  }
});

test("하단 펼침 버튼의 클릭·접힘 속성과 펼친 링크는 번역 및 OFF·ON 뒤에도 유지한다", async (t) => {
  const p = page(t, `<footer class="l-footer"><ul><li class="l-footer-sitemap__item" data-group="accordion">
    <button class="l-footer-sitemap__trigger" id="footer_tab_shouhin" aria-expanded="false"
      aria-controls="footer_panel_shouhin" data-trigger="accordion"><span>商品情報</span></button>
    <div class="l-footer-sitemap__lower" aria-hidden="true" role="region" id="footer_panel_shouhin"
      aria-labelledby="footer_tab_shouhin"><ul><li>
      <a class="l-footer-sitemap__lower-link" href="https://www.takaratomy.co.jp/products/">商品情報トップ</a>
    </li></ul></div>
  </li></ul></footer>`);
  const button = p.w.document.querySelector("button");
  const label = button.querySelector("span");
  const panel = p.w.document.getElementById("footer_panel_shouhin");
  const link = panel.querySelector("a");
  let clicks = 0;
  button.addEventListener("click", () => {
    clicks += 1;
    const expanded = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(expanded));
    panel.setAttribute("aria-hidden", String(!expanded));
  });
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => label.textContent === "번역(商品情報)", "sitemap button label should translate");
  assert.equal(link.textContent, "商品情報トップ");
  assert.equal(p.sent().includes("商品情報トップ"), false);
  button.click();
  await waitFor(() => link.textContent === "번역(商品情報トップ)", "newly expanded footer link should translate");
  assert.equal(clicks, 1);
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(panel.getAttribute("aria-hidden"), "false");
  assert.equal(button.getAttribute("aria-controls"), panel.id);
  assert.equal(panel.getAttribute("aria-labelledby"), button.id);
  assert.equal(link.href, "https://www.takaratomy.co.jp/products/");
  const before = p.requests.length;

  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  assert.equal(label.textContent, "商品情報");
  assert.equal(link.textContent, "商品情報トップ");
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(panel.getAttribute("aria-hidden"), "false");
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  assert.equal(label.textContent, "번역(商品情報)");
  assert.equal(link.textContent, "번역(商品情報トップ)");
  assert.equal(button.querySelector("span"), label);
  assert.equal(p.w.document.getElementById(button.id), button);
  assert.equal(p.requests.length, before);

  button.click();
  assert.equal(clicks, 2);
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(panel.getAttribute("aria-hidden"), "true");
  link.firstChild.nodeValue = "新しい商品案内";
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(p.requests.length, before);
  button.click();
  await waitFor(() => link.textContent === "번역(新しい商品案内)", "reopened link should translate its new source text");
  assert.equal(clicks, 3);
  assert.equal(p.sent().filter((text) => text === "商品情報").length, 1);
});

test("하단 펼침 제목 예외도 계정 폼·입력값·숨김·보호 문구와 임의 버튼을 제외한다", async (t) => {
  const p = page(t, `<footer class="l-footer">
    <button class="l-footer-sitemap__trigger"><span id="public-footer-title">公開の商品案内</span>
      <span hidden>秘密の非表示</span><span style="display:none">秘密の補足</span>
      <span translate="no">秘密の原文</span><span class="price">秘密の価格</span>
    </button>
    <button class="l-footer-sitemap__trigger" hidden>秘密の隠したボタン</button>
    <button class="l-footer-sitemap__trigger" aria-hidden="true">秘密の非表示ボタン</button>
    <button class="l-footer-sitemap__trigger" style="visibility:hidden">秘密の不可視ボタン</button>
    <form id="private-account"><button class="l-footer-sitemap__trigger">秘密のアカウント</button>
      <input id="private-value" value="秘密の入力値"><input id="private-check" type="checkbox" checked>
      <select><option selected>秘密の選択値</option></select>
    </form>
    <div contenteditable="true"><button class="l-footer-sitemap__trigger">秘密の編集中</button></div>
    <div data-nudenyang-ignore><button class="l-footer-sitemap__trigger">秘密の保護領域</button></div>
    <button aria-expanded="false" aria-controls="other-panel">秘密の別操作</button>
  </footer><button class="l-footer-sitemap__trigger">秘密の本文外操作</button>`);
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.w.document.getElementById("public-footer-title").textContent === "번역(公開の商品案内)",
    "only the visible public sitemap title should translate");
  assert.deepEqual(p.sent(), ["公開の商品案内"]);
  assert.equal(p.w.document.getElementById("private-value").value, "秘密の入力値");
  assert.equal(p.w.document.getElementById("private-check").checked, true);
  assert.equal(p.w.document.querySelector("option").selected, true);
  assert.equal(p.w.document.querySelector("[translate=no]").textContent, "秘密の原文");
});

test("공용 검색 탭의 제목·small을 번역해도 선택 상태와 숨긴 패널 전환을 유지한다", async (t) => {
  const tabs = [
    { name: "genre", title: "ジャンル", detail: "からさがす" },
    { name: "age", title: "対象年齢", detail: "からさがす" },
    { name: "like", title: "「好き」", detail: "をさがす" },
  ];
  const p = page(t, `<style>.c-tab-panel[aria-hidden="true"] { visibility: hidden; }</style>
    <div class="c-tab-group _protrude"><div class="c-tab-buttons" role="tablist">
      ${tabs.map((tab, index) => `<button class="c-tab-button" id="search_${tab.name}" type="button"
        role="tab" aria-controls="search_${tab.name}_content" aria-selected="${index === 0}"
        data-tab-trigger>${tab.title}<small>${tab.detail}</small></button>`).join("")}
    </div>
    <div class="c-tab-panel" role="tabpanel" id="search_genre_content" aria-labelledby="search_genre"
      aria-hidden="false" data-tab-target><a href="/products/genre/">ジャンル別の商品</a></div>
    <div class="c-tab-panel" role="tabpanel" id="search_age_content" aria-labelledby="search_age"
      aria-hidden="true" data-tab-target><a class="c-card-search-age" href="/products/age/">
      <span class="c-card-search-age__title">3</span><span class="c-card-search-age__unit">歳以上</span></a></div>
    <div class="c-tab-panel" role="tabpanel" id="search_like_content" aria-labelledby="search_like"
      aria-hidden="true" data-tab-target><p>好きな商品を探す</p>
      <form class="p-favorite-block__form" method="get" action="/products/favorite/result.html">
        <label class="c-card-favorite"><input type="checkbox" value="private-choice" checked>
        <span class="hiragana">秘密の選択ラベル</span><span class="title">秘密のフォーム項目</span></label>
      </form></div>
    </div>`, { url: "https://www.takaratomy.co.jp/" });
  const buttons = [...p.w.document.querySelectorAll(".c-tab-button")];
  const smallNodes = buttons.map((button) => button.querySelector("small"));
  const titleNodes = buttons.map((button) => button.firstChild);
  const panels = [...p.w.document.querySelectorAll(".c-tab-panel")];
  const initialAttributes = buttons.map((button) => [...button.attributes].map(({ name, value }) => [name, value]));
  const ageUnit = p.w.document.querySelector(".c-card-search-age__unit");
  const likeCopy = panels[2].querySelector("p");
  let clicks = 0;
  for (const button of buttons) button.addEventListener("click", () => {
    clicks += 1;
    buttons.forEach((candidate, index) => {
      candidate.setAttribute("aria-selected", String(candidate === button));
      panels[index].setAttribute("aria-hidden", String(candidate !== button));
    });
  });
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => buttons.every((button, index) => (
    button.firstChild.nodeValue === `번역(${tabs[index].title})`
      && button.querySelector("small").textContent === `번역(${tabs[index].detail})`
  )), "all search tab titles and their small suffixes should translate");
  for (let index = 0; index < buttons.length; index += 1) {
    assert.equal(buttons[index].firstChild, titleNodes[index]);
    assert.equal(buttons[index].querySelector("small"), smallNodes[index]);
    assert.deepEqual([...buttons[index].attributes].map(({ name, value }) => [name, value]), initialAttributes[index]);
  }
  assert.equal(p.sent().includes("歳以上"), false);
  assert.equal(p.sent().includes("好きな商品を探す"), false);
  buttons[1].click();
  await waitFor(() => ageUnit.textContent === "번역(歳以上)", "the selected age panel should become eligible");
  assert.deepEqual(buttons.map((button) => button.getAttribute("aria-selected")), ["false", "true", "false"]);
  assert.deepEqual(panels.map((panel) => panel.getAttribute("aria-hidden")), ["true", "false", "true"]);
  assert.equal(p.w.document.querySelector(".c-card-search-age__title").textContent, "3");
  const before = p.requests.length;
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  buttons.forEach((button, index) => {
    assert.equal(button.firstChild.nodeValue, tabs[index].title);
    assert.equal(smallNodes[index].textContent, tabs[index].detail);
  });
  assert.equal(ageUnit.textContent, "歳以上");
  assert.equal(buttons[1].getAttribute("aria-selected"), "true");
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  assert.equal(buttons[1].firstChild.nodeValue, "번역(対象年齢)");
  assert.equal(smallNodes[1].textContent, "번역(からさがす)");
  assert.equal(ageUnit.textContent, "번역(歳以上)");
  assert.equal(p.requests.length, before);

  buttons[2].click();
  await waitFor(() => likeCopy.textContent === "번역(好きな商品を探す)", "the next selected panel should be rescanned");
  assert.equal(clicks, 2);
  assert.equal(buttons[2].getAttribute("aria-controls"), panels[2].id);
  assert.equal(panels[2].getAttribute("aria-labelledby"), buttons[2].id);
  assert.equal(p.w.document.getElementById(buttons[2].id), buttons[2]);
  assert.equal(buttons[2].querySelector("small"), smallNodes[2]);
  assert.equal(p.sent().some((text) => /秘密|private-choice/.test(text)), false);
  assert.equal(p.w.document.querySelector(".p-favorite-block__form input").checked, true);
  assert.equal(p.w.document.querySelector(".p-favorite-block__form input").value, "private-choice");
});

test("공용 검색 탭 예외도 임의 폼·보호 텍스트를 제외하고 다른 사이트와 민감 경로에 적용하지 않는다", async (t) => {
  const html = `<div class="c-tab-group"><div class="c-tab-buttons" role="tablist">
    <button role="tab" id="public-tab">公開の分類<small>から探す</small>
      <span hidden>秘密の非表示</span><span translate="no">秘密の原文</span>
      <span style="display:none">秘密の補足</span><span class="price">秘密の価格</span></button>
    <button role="tab" aria-hidden="true">秘密の隠したタブ</button>
    <button>秘密の別操作</button>
  </div></div>
  <form id="private-account"><div class="c-tab-group"><div class="c-tab-buttons">
    <button role="tab">秘密のアカウント</button><input value="秘密の入力値">
  </div></div></form>
  <div data-nudenyang-ignore><div class="c-tab-group"><div class="c-tab-buttons">
    <button role="tab">秘密の保護されたタブ</button></div></div></div>
  <div class="c-tab-buttons"><button role="tab">秘密の別タブ</button></div>`;
  const publicPage = page(t, html, { url: "https://www.takaratomy.co.jp/" });
  await publicPage.message({ type: "nudenyang-ready" });
  await waitFor(() => publicPage.w.document.querySelector("#public-tab small").textContent === "번역(から探す)",
    "only the public tab title should translate");
  assert.deepEqual(publicPage.sent(), ["公開の分類", "から探す"]);
  assert.equal(publicPage.w.document.querySelector("input").value, "秘密の入力値");
  for (const url of ["https://example.org/", "https://www.takaratomy.co.jp/account/"]) {
    const p = page(t, html, { url });
    await p.message({ type: "nudenyang-ready" });
    await p.message({ type: "nudenyang-set-enabled", enabled: true });
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.deepEqual(p.sent(), [], url);
  }
});

test("ShoPro의 헤더 메뉴는 직접 켠 뒤 본문과 함께 번역하며 링크·DOM·OFF·ON 캐시를 보존한다", async (t) => {
  const menuItems = [
    ["news/", "最新情報"], ["#stream", "配信情報"], ["#story", "物語"], ["#chara", "登場人物"],
    ["#staff", "スタッフ・キャスト"], ["music/", "音楽情報"], ["special/", "スペシャル"], ["#gensaku", "原作情報"],
  ];
  const p = page(t, `<header><div class="headerWrap">
    <div class="header-logo"><a href="#top"><img alt="作品のロゴ"></a></div>
    <button type="button" class="btn"><span class="btn-line"></span></button><div class="overray"></div>
    <div class="menu"><ul>${menuItems.map(([href, title]) => `<li><a href="${href}">${title}</a></li>`).join("")}</ul>
      <div class="sns03"><a href="https://example.org/"><img alt="画像のSNS案内"></a></div></div>
    <ul class="sns02"><li><a href="https://example.org/"><img alt="別のSNS画像"></a></li></ul>
  </div></header><main><h2>作品の紹介</h2><p>物語を紹介する文章です。</p>
    <div class="main_top mainBox"><div class="main_left"><ul class="contentsList">
      <li><a href="special/">作品の詳細</a></li></ul></div></div></main>`, {
    url: "https://www.shopro.co.jp/anime/duelmasters_lost/",
  });
  const links = [...p.w.document.querySelectorAll("header .menu > ul > li > a")];
  const originalNodes = links.map((link) => link.firstChild);
  const attributes = links.map((link) => [...link.attributes].map(({ name, value }) => [name, value]));
  const mainLink = p.w.document.querySelector("main .contentsList a");
  let clicks = 0;
  links[0].addEventListener("click", (event) => { event.preventDefault(); clicks += 1; });
  await p.message({ type: "nudenyang-ready" });
  assert.equal((await p.message({ type: "nudenyang-status" })).enabled, false);
  assert.deepEqual(p.sent(), []);
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  await waitFor(() => links.every((link, index) => link.textContent === `번역(${menuItems[index][1]})`)
    && mainLink.textContent === "번역(作品の詳細)"
    && p.w.document.querySelector("main p").textContent === "번역(物語を紹介する文章です。)",
  "the public header and existing body copy should both translate");
  links.forEach((link, index) => {
    assert.equal(link.firstChild, originalNodes[index]);
    assert.deepEqual([...link.attributes].map(({ name, value }) => [name, value]), attributes[index]);
    assert.equal(p.sent().filter((text) => text === menuItems[index][1]).length, 1);
  });
  assert.equal(p.w.document.querySelector("header img").alt, "作品のロゴ");
  assert.equal(p.sent().some((text) => /画像|ロゴ/.test(text)), false);
  links[0].click();
  assert.equal(clicks, 1);
  const before = p.requests.length;
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  links.forEach((link, index) => assert.equal(link.textContent, menuItems[index][1]));
  assert.equal(mainLink.textContent, "作品の詳細");
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  links.forEach((link, index) => assert.equal(link.textContent, `번역(${menuItems[index][1]})`));
  assert.equal(mainLink.textContent, "번역(作品の詳細)");
  links[0].click();
  assert.equal(clicks, 2);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(p.requests.length, before);
});

test("ShoPro 모바일 메뉴는 CSS로 펼친 뒤 수집하고 다시 숨긴 새 문구는 보내지 않는다", async (t) => {
  const p = page(t, `<style>
    header .headerWrap .menu { display: none; }
    header .headerWrap.mobile-open .menu { display: block; }
  </style><header><div class="headerWrap"><button class="btn" type="button" aria-expanded="false">
    <span class="btn-line"></span></button><div class="overray"></div>
    <div class="menu"><ul><li><a href="news/">公開の最新情報</a></li></ul></div></div></header>`, {
    url: "https://www.shopro.co.jp/anime/duelmasters_lost/", tabEnabled: true,
  });
  const wrapper = p.w.document.querySelector(".headerWrap");
  // jsdom 30 drops this ancestor-qualified child selector in scoped queries.
  // On the live ShoPro page, Whale's document/header/.headerWrap queries each returned 8.
  // Use wildcard descendants + matches() only for this root, without fixture-specific IDs.
  const queryDescendants = wrapper.querySelectorAll.bind(wrapper);
  wrapper.querySelectorAll = (selector) => [...queryDescendants("*")].filter((element) => element.matches(selector));
  const button = wrapper.querySelector("button");
  const link = wrapper.querySelector(".menu a");
  let clicks = 0;
  button.addEventListener("click", () => {
    clicks += 1;
    button.setAttribute("aria-expanded", String(wrapper.classList.toggle("mobile-open")));
  });
  await p.message({ type: "nudenyang-ready" });
  assert.deepEqual(p.sent(), []);
  button.click();
  await waitFor(() => link.textContent === "번역(公開の最新情報)", "a CSS-only opened mobile menu should translate");
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(link.getAttribute("href"), "news/");
  button.click();
  link.firstChild.nodeValue = "公開の新しい案内";
  const before = p.requests.length;
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(p.requests.length, before);
  assert.equal(p.sent().includes("公開の新しい案内"), false);
  button.click();
  await waitFor(() => link.textContent === "번역(公開の新しい案内)", "reopened menu should collect its new visible copy");
  assert.equal(clicks, 3);
  assert.equal(wrapper.querySelector("button"), button);
});

test("ShoPro의 기존 범위와 범용 공개 메뉴 모두 숨김·편집·개인 폼·계정 경로를 보호한다", async (t) => {
  const html = `<header><div class="headerWrap"><div class="menu"><ul>
    <li><a id="public-menu" href="news/"><span>公開の作品案内</span><span hidden>秘密の非表示</span>
      <span style="display:none">秘密の補足</span><span translate="no">秘密の原文</span></a></li>
    <li hidden><a href="#hidden">秘密の隠した項目</a></li>
    <li inert><a href="#inert">秘密の操作不可項目</a></li>
    <li aria-hidden="true"><a href="#aria-hidden">秘密の隠したリンク</a></li>
    <li contenteditable="true"><a href="#editor">秘密の編集中</a></li>
    <li data-nudenyang-ignore><a href="#protected">秘密の保護項目</a></li>
    <li><a href="#button" role="button">秘密のボタン操作</a></li>
  </ul><button>秘密の無関係操作</button><div class="sns03"><a href="https://example.org/">秘密の別リンク</a></div></div>
  <form id="private-account"><div class="menu"><ul><li><a href="#account">秘密のアカウント内容</a></li></ul></div>
    <input value="秘密の入力値"><textarea>秘密の編集中の値</textarea></form>
  <div class="header-logo"><a href="#logo">秘密の別案内</a></div><button class="btn">秘密の操作文</button>
  </div></header>`;
  const publicPage = page(t, html, {
    url: "https://www.shopro.co.jp/anime/duelmasters_lost/", tabEnabled: true,
  });
  await publicPage.message({ type: "nudenyang-ready" });
  await waitFor(() => publicPage.w.document.querySelector("#public-menu > span").textContent === "번역(公開の作品案内)",
    "the visible menu copy should translate without private controls");
  assert.deepEqual(publicPage.sent(), ["公開の作品案内"]);
  assert.equal(publicPage.w.document.querySelector("input").value, "秘密の入力値");
  assert.equal(publicPage.w.document.querySelector("textarea").value, "秘密の編集中の値");
  for (const url of [
    "https://www.shopro.co.jp/company/", "https://other.shopro.co.jp/anime/duelmasters_lost/",
    "https://www.shopro.co.jp/anime/duelmasters_lost/account/",
  ]) {
    const p = page(t, html, { url, tabEnabled: true });
    await p.message({ type: "nudenyang-ready" });
    await new Promise((resolve) => setTimeout(resolve, 350));
    // Outside the scoped adapter, ordinary navigation now uses the common
    // public-link policy; protected descendants and sensitive routes stay out.
    assert.deepEqual(p.sent().sort(), url.endsWith("/account/") ? []
      : ["公開の作品案内", "秘密の別リンク", "秘密の別案内"].sort(), url);
  }
});

for (const change of ["class", "style"]) {
  test(`범용 DOM: ${change}만 바뀌어 나타난 본문을 사이트 설정 없이 수집한다`, async (t) => {
    const html = change === "class" ? CSS_REVEAL_HTML
      : CSS_REVEAL_HTML.replace('class="concealed"', 'style="visibility:hidden"');
    const p = page(t, html, { url: PUBLIC_DOCUMENT_URL, tabEnabled: true });
    await p.message({ type: "nudenyang-ready" });
    await waitFor(() => p.w.document.querySelector("#control").textContent.includes("번역("), "visible control");
    assert.ok(!p.sent().includes("Delayed public text"));
    const element = p.w.document.querySelector("#changing");
    if (change === "class") element.classList.remove("concealed");
    else element.style.visibility = "visible";
    await waitFor(() => element.textContent === "번역(Delayed public text)", "CSS reveal must trigger collection", 1200);
    assert.equal(p.sent().filter((text) => text === "Delayed public text").length, 1);
  });
}

for (const { label, attribute, value } of PUBLIC_NODE_CHANGES) {
  test(`범용 DOM: 응답 대기 중 ${label}으로 바뀐 노드에 늦은 결과를 쓰지 않는다`, async (t) => {
    const p = page(t, REUSED_TEXT_HTML, { url: PUBLIC_DOCUMENT_URL, tabEnabled: true, deferTranslation: true });
    await p.message({ type: "nudenyang-ready" });
    await waitFor(() => p.sent().includes("Original public text"), "request must be in flight");
    const element = p.w.document.querySelector("#changing");
    element.setAttribute(attribute, value);
    p.releaseTranslation();
    await waitFor(() => p.w.document.querySelector("#control").textContent.includes("번역("), "unchanged control applies");
    assert.equal(element.textContent, "Original public text");
  });

  test(`범용 DOM: 원문 비교 중 ${label}으로 바뀐 노드에 캐시를 재적용하지 않는다`, async (t) => {
    const p = page(t, REUSED_TEXT_HTML, { url: PUBLIC_DOCUMENT_URL, tabEnabled: true });
    await p.message({ type: "nudenyang-ready" });
    const element = p.w.document.querySelector("#changing");
    await waitFor(() => element.textContent.includes("번역("), "initial translation");
    await p.message({ type: "nudenyang-set-enabled", enabled: false });
    element.setAttribute(attribute, value);
    const before = p.requests.length;
    await p.message({ type: "nudenyang-set-enabled", enabled: true });
    assert.equal(element.textContent, "Original public text");
    assert.equal(p.requests.length, before);
  });
}

test("범용 DOM: 긴 단일 노드와 한 글자 인라인도 전송 한도 안에서 수집하고 복원한다", async (t) => {
  const p = page(t, FRAGMENTED_TEXT_HTML, { url: PUBLIC_DOCUMENT_URL, tabEnabled: true });
  const longNode = p.w.document.querySelector("#long").firstChild;
  const fragments = [...p.w.document.querySelector("#fragmented").children];
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => longNode.nodeValue.includes("번역("), "long text must not be silently discarded", 1500);
  await waitFor(() => fragments.every((node) => node.textContent.includes("번역(")), "single-character inline text must not disappear");
  assert.ok(p.requests.every((request) => request.items.length <= 32
    && request.items.every((item) => item.text.length <= 4000)
    && request.items.reduce((sum, item) => sum + item.text.length, 0) <= 32000));
  assert.equal(p.w.document.querySelector("#long").firstChild, longNode);
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  assert.equal(longNode.nodeValue, LONG_TEXT);
  assert.equal(p.w.document.querySelector("#fragmented").textContent, "夢を見る");
  fragments.forEach((node, index) => assert.equal(p.w.document.querySelector("#fragmented").children[index], node));
});

test("범용 DOM: 표시 프레임 직전 민감한 경로로 이동하면 이전 결과를 쓰지 않는다", async (t) => {
  const p = page(t, REUSED_TEXT_HTML, { url: PUBLIC_DOCUMENT_URL, tabEnabled: true, deferApplications: true });
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.pendingApplicationFrames() > 0, "response should be waiting for its display frame");
  p.w.history.pushState({}, "", "/account");
  p.releaseApplications();
  assert.equal(p.w.document.querySelector("#changing").textContent, "Original public text");
});

test("범용 DOM: 한 글자 자연어를 허용해도 숫자·기호·그림문자는 원문으로 유지한다", async (t) => {
  const p = page(t, SHORT_TEXT_HTML, { url: PUBLIC_DOCUMENT_URL, tabEnabled: true });
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.w.document.querySelector("#word").textContent === "번역(夢)", "single letter word");
  assert.equal(p.w.document.querySelector("#count").textContent, "3");
  assert.equal(p.w.document.querySelector("#punctuation").textContent, "...");
  assert.equal(p.w.document.querySelector("#icon").textContent, "🐱");
  assert.deepEqual(p.sent(), ["夢"]);
});

test("범용 공개 UI: 게시물 팝업과 분류 링크를 보호 영역 없이 수집하고 복원한다", async (t) => {
  const p = page(t, PUBLIC_SURFACES_HTML, { url: PUBLIC_DOCUMENT_URL, tabEnabled: true });
  await p.message({ type: "nudenyang-ready" });
  const doc = p.w.document;
  await waitFor(() => doc.querySelector("#control").textContent.includes("번역("), "control translates");
  await waitFor(() => PUBLIC_SURFACE_COPY.every(([id, text]) => doc.getElementById(id).textContent === `번역(${text})`)
    && doc.querySelector("#caption").textContent === "번역(A public post caption)번역(Another caption line)", "public surfaces translate");
  assert.ok(!p.sent().some(text => /Secret|Alice Author|alice_42|@alice|https:\/\/example.org\//u.test(text)));
  assert.equal(doc.querySelector("#category").href, "https://catalog.example.org/browse");
  assert.equal(doc.querySelectorAll("#caption br").length, 1);
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  for (const [id, text] of PUBLIC_SURFACE_COPY) assert.equal(doc.getElementById(id).textContent, text);
  assert.equal(doc.querySelector("#caption").textContent, "A public post captionAnother caption line");
});

test("범용 공개 UI: 링크 판별도 숨긴·편집·작성자 자식을 읽지 않는다", async (t) => {
  const p = page(t, `<nav><a id="mixed" href="/guide"><span id="copy">Public guide</span>
    <span id="hidden" hidden>Secret hidden</span><span id="editor" contenteditable>Secret draft</span>
    <span id="author" itemprop="author">Secret author</span></a></nav>`, { url: PUBLIC_DOCUMENT_URL, tabEnabled: true });
  const anchor = p.w.document.querySelector("#mixed");
  const readText = Object.getOwnPropertyDescriptor(p.w.Node.prototype, "textContent").get;
  let aggregateReads = 0;
  Object.defineProperty(anchor, "textContent", { get() { aggregateReads++; return readText.call(this); } });
  const reads = ["hidden", "editor", "author"].map(id => watchNodeValueReads(p.w, p.w.document.getElementById(id).firstChild));
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.sent().includes("Public guide"), "visible label translates");
  assert.equal(aggregateReads, 0);
  assert.deepEqual(reads.map(read => read()), [0, 0, 0]);
});

for (const mode of ["pending", "replay"]) {
  test(`범용 공개 UI: ${mode} 중 계정 링크·작성자·편집 역할로 바뀐 영역은 보호한다`, async (t) => {
    const options = { url: PUBLIC_DOCUMENT_URL, tabEnabled: true, deferTranslation: mode === "pending" };
    const p = page(t, PUBLIC_SURFACES_HTML, options);
    await p.message({ type: "nudenyang-ready" });
    await waitFor(() => mode === "pending" ? p.requests.length > 0
      : p.w.document.querySelector("#caption").textContent.includes("번역("), "initial processing");
    if (mode === "replay") await p.message({ type: "nudenyang-set-enabled", enabled: false });
    p.w.document.querySelector("#category").setAttribute("href", "/account");
    p.w.document.querySelector("#caption").setAttribute("contenteditable", "true");
    p.w.document.querySelector("#post-layout").setAttribute("itemprop", "author");
    if (mode === "pending") p.releaseTranslation();
    else await p.message({ type: "nudenyang-set-enabled", enabled: true });
    await waitFor(() => p.w.document.querySelector("#control").textContent.includes("번역("), "safe control still translates");
    assert.equal(p.w.document.querySelector("#category").textContent, "Shopping categories");
    assert.equal(p.w.document.querySelector("#caption").textContent, "A public post captionAnother caption line");
    assert.equal(p.w.document.querySelector("#post-layout").textContent, "More public details");
  });
}

test("범용 본문 수집 범위가 넓어져도 임의의 폼·메뉴·숨긴 텍스트는 번역하지 않는다", async (t) => {
  const p = page(t, `<div id="unrecognized-root">通常の<strong>説明です</strong></div>
    <nav><span>秘密のメニュー</span></nav><form><label>秘密のラベル</label></form>
    <div hidden>秘密の非表示文</div><div translate="no">秘密の原文</div>`, {
    url: "https://example.org/articles/one",
  });
  await p.message({ type: "nudenyang-ready" });
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  await waitFor(() => p.sent().includes("通常の"), "generic layout prose should translate");
  assert.ok(!p.sent().some((text) => text.includes("秘密")));
});

test("시작 중의 연속 토글은 초기 상태 조회에 덮어써지지 않는다", async (t) => {
  const p = page(t, "<p>通常の文章</p>", { deferStatus: true, tabEnabled: false });
  const first = p.message({ type: "nudenyang-toggle-enabled" });
  const second = p.message({ type: "nudenyang-toggle-enabled" });
  p.releaseStatus();
  await Promise.all([first, second]);
  assert.deepEqual(p.savedStates, [false], "an ON cancelled during startup must not be persisted");
  assert.equal((await p.message({ type: "nudenyang-status" })).enabled, false);
});

test("일반 페이지 F4는 팝업이나 포커스 이동 없이 번역을 시작한다", async (t) => {
  const p = page(t, "<p>通常の文章</p>", { tabEnabled: false });
  await p.message({ type: "nudenyang-ready" });
  p.w.dispatchEvent(new p.w.KeyboardEvent("keydown", { key: "F4", code: "F4", bubbles: true }));
  await waitFor(() => p.w.document.body.textContent === "번역(通常の文章)", "F4 alone must translate");
  assert.deepEqual(p.savedStates, [true]);
});

test("본체 설정이 바뀐 일반 페이지도 F4 시작 전에 최신 상태를 확인한다", async (t) => {
  const p = page(t, "<p>通常の文章</p>", { tabEnabled: false, settings: { enabled: false } });
  await p.message({ type: "nudenyang-ready" });
  p.appStatus.webSettings.enabled = true;
  p.w.dispatchEvent(new p.w.KeyboardEvent("keydown", { key: "F4", code: "F4", bubbles: true }));
  await waitFor(() => p.w.document.body.textContent === "번역(通常の文章)", "F4 must not need the popup/focus to refresh settings");
  assert.deepEqual(p.savedStates, [true]);
});

test("F4 시작 전 확인은 새로 꺼진 본체·사이트 차단·연결 해제를 우회하지 않는다", async (t) => {
  for (const blocked of ['disabled', 'never', 'disconnected']) {
    const p = page(t, '<p>通常の文章</p>', { tabEnabled: false });
    await p.message({ type: 'nudenyang-ready' });
    if (blocked === 'disabled') p.appStatus.webSettings.enabled = false;
    if (blocked === 'never') p.appStatus.webSettings.sitePolicies = { 'dm.takaratomy.co.jp': 'never' };
    if (blocked === 'disconnected') Object.assign(p.appStatus, { type: 'error', code: 'browser_connection_disabled' });
    assert.equal((await p.message({ type: 'nudenyang-toggle-enabled' })).enabled, false, blocked);
    assert.deepEqual(p.savedStates, [], blocked);
    assert.deepEqual(p.sent(), [], blocked);
  }
});

test("본체 응답 대기 중 다시 F4를 누르면 즉시 끄고 늦은 시작 응답을 버린다", async (t) => {
  const options = { tabEnabled: false };
  const p = page(t, '<p>通常の文章</p>', options);
  await p.message({ type: 'nudenyang-ready' });
  options.deferStatus = true;
  const pending = p.message({ type: 'nudenyang-toggle-enabled' });
  await waitFor(() => p.runtimeMessages.some(m => m.request?.requestId.startsWith('content-toggle-')), 'ON must check the app');
  const off = await p.message({ type: 'nudenyang-toggle-enabled' });
  assert.equal(off.enabled, false, 'OFF must not wait for the deferred native response');
  p.releaseStatus();
  assert.equal((await pending).enabled, false);
  assert.deepEqual(p.savedStates, [false]);
  assert.deepEqual(p.sent(), []);
});

test("늦은 F4 시작 응답은 다른 페이지·대화 이동 또는 동의 철회 뒤 적용하지 않는다", async (t) => {
  for (const action of ['navigate', 'revoke']) {
    const options = { ...PRIVATE_OPTIONS, tabEnabled: false };
    const p = page(t, PRIVATE_CHAT, options);
    await p.message({ type: 'nudenyang-ready' });
    options.deferStatus = true;
    const pending = p.message({ type: 'nudenyang-toggle-enabled' });
    await waitFor(() => p.runtimeMessages.some(m => m.request?.requestId.startsWith('content-toggle-')), 'ON must check the app');
    if (action === 'navigate') {
      p.w.history.pushState({}, '', '/channels/@me/987654321');
      await p.message({ type: 'nudenyang-status' });
    } else {
      options.consent = false;
      await p.message({ type: 'nudenyang-messenger-refresh', consent: { granted: false } });
    }
    p.releaseStatus();
    assert.equal((await pending).enabled, false, action);
    assert.deepEqual(p.savedStates, [], action);
    assert.deepEqual(p.sent(), [], action);
  }
});

test("복구 주입과 정적 주입이 겹쳐도 페이지 실행기는 하나만 유지한다", async (t) => {
  const p = page(t, "<p>通常の文章</p>");
  await p.message({ type: "nudenyang-ready" });
  const before = p.listeners.size;
  p.reinject();
  await p.message({ type: "nudenyang-ready" });
  assert.equal(p.listeners.size, before);
  assert.equal((await p.message({ type: "nudenyang-status" })).origin, "https://dm.takaratomy.co.jp");
});

test("공개 메뉴 안에서도 숨긴 문구와 별도 개인정보 폼은 전송하지 않는다", async (t) => {
  const p = page(t, `<header class="l-header"><a href="/product/">公開案内
    <span style="display:none">秘密の文章</span><span translate="no">秘密の原文</span></a>
    <form id="private-account"><label>秘密のログイン</label><button>秘密の送信</button></form>
    </header><p>公開本文<span style="visibility:hidden">秘密の補足</span></p>`);
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.sent().includes("公開本文"), "visible prose should translate");
  assert.ok(p.sent().some((text) => text.includes("公開案内")));
  assert.ok(!p.sent().some((text) => text.includes("秘密")));
});

test("CSS만 바뀌는 공개 메뉴를 표시하면 새로 수집한다", async (t) => {
  const p = page(t, `<header class="l-header"><a id="menu" href="/product/"
    style="display:none">開いたメニュー</a></header>`);
  await p.message({ type: "nudenyang-ready" });
  assert.equal(p.sent().length, 0);
  p.w.document.querySelector("#menu").style.display = "block";
  await waitFor(() => p.sent().includes("開いたメニュー"), "CSS-only visibility change should rescan");
});

test("번역을 껐다 켜면 저장된 문단을 즉시 재사용하고 다시 요청하지 않는다", async (t) => {
  const p = page(t, "<div>原文の説明</div>");
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.w.document.body.textContent === "번역(原文の説明)", "first translation should apply");
  const before = p.requests.length;
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  assert.equal(p.w.document.body.textContent, "原文の説明");
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  assert.equal(p.w.document.body.textContent, "번역(原文の説明)");
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(p.requests.length, before);
});

test("수집 후 전송 직전에 숨긴 메뉴는 보내지 않고 다시 표시하면 번역한다", async (t) => {
  const p = page(t, '<header class="l-header"><a id="menu" href="/product/">公開メニュー</a></header>');
  await p.message({ type: "nudenyang-ready" });
  const menu = p.w.document.querySelector("#menu");
  menu.style.visibility = "hidden";
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(p.requests.length, 0);
  menu.style.visibility = "visible";
  await waitFor(() => p.sent().includes("公開メニュー"), "shown menu should be queued again");
});

test("수집 후 보호 속성이나 개인정보 폼으로 바뀐 텍스트는 전송하지 않는다", async (t) => {
  for (const protect of [
    (element) => element.setAttribute("translate", "no"),
    (element) => element.setAttribute("contenteditable", "true"),
    (element) => {
      const form = element.ownerDocument.createElement("form");
      element.replaceWith(form);
      form.append(element);
    },
  ]) {
    const p = page(t, '<p id="pending">保護する文章</p>');
    await p.message({ type: "nudenyang-ready" });
    protect(p.w.document.querySelector("#pending"));
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(p.requests.length, 0);
  }
});

test("큰 설명란을 통째로 버리지 않고 문서 구조와 외부 전송 한도를 지키며 처리한다", async (t) => {
  const parts = Array.from({ length: 10 }, (_, index) => `${index}${"文".repeat(2998)}`);
  const p = page(t, `<main><div>${parts.map((part) => `<span>${part}</span>`).join("<br>")}</div></main>`, {
    translator: "deepl", settings: { externalPageCharLimit: 25000 },
  });
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.requests.length > 0, "oversize prose should not silently disappear");
  await waitFor(() => p.w.document.querySelector("span").textContent.startsWith("번역("), "first part should apply");
  assert.ok(p.sent().reduce((total, text) => total + text.length, 0) <= 25000);
  assert.deepEqual(p.sent(), parts.slice(0, p.sent().length));
  assert.equal(p.w.document.querySelectorAll("span").length, 10);
  assert.equal(p.w.document.querySelectorAll("br").length, 9);
});

test("반복 스크롤은 전체 DOM 수집을 다시 실행하지 않는다", async (t) => {
  const p = page(t, "<div>原文の説明</div>");
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.w.document.body.textContent === "번역(原文の説明)", "first translation should apply");
  let walks = 0;
  const originalWalk = p.w.document.createTreeWalker.bind(p.w.document);
  p.w.document.createTreeWalker = (...args) => { walks += 1; return originalWalk(...args); };
  for (let i = 0; i < 20; i += 1) p.w.document.dispatchEvent(new p.w.Event("scroll"));
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(walks, 0);
  assert.equal(p.requests.length, 1);
});

test("보이는 YouTube 제목은 본문과 같은 요청·언어·전송량 집계로 번역한다", async (t) => {
  const p = page(t, `<p>製品の説明</p><iframe src="${FRAME_URL}"></iframe>`);
  const context = await p.message(embedRequest("status"));
  assert.equal(context.enabled, true);
  const result = await p.message(embedRequest("translate", {
    title: "最新の製品紹介", epoch: context.epoch, translationKey: context.translationKey,
  }));
  assert.equal(result.translation, "번역(最新の製品紹介)");
  assert.equal(result.targetLanguage, "KO");
  assert.equal(result.translationKey, context.translationKey);
  assert.equal(p.requests.length, 1);
  assert.deepEqual(p.sent().sort(), ["最新の製品紹介", "製品の説明"].sort());
  const status = await p.message({ type: "nudenyang-status" });
  assert.equal(status.requestCount, 1);
  assert.equal(status.sentChars, "最新の製品紹介製品の説明".length);
  assert.equal(p.w.document.querySelector("iframe").src, FRAME_URL);
});

test("부모 정책이 꺼져 있으면 영상 프레임은 스스로 번역을 시작하지 못한다", async (t) => {
  for (const options of [
    { tabEnabled: false },
    { settings: { enabled: false } },
    { settings: { sitePolicies: { "dm.takaratomy.co.jp": "never" } } },
    { url: "https://dm.takaratomy.co.jp/account/settings/" },
  ]) {
    const p = page(t, `<iframe src="${FRAME_URL}"></iframe>`, options);
    const context = await p.message(embedRequest("status"));
    assert.equal(context.enabled, false);
    const reply = await p.message(embedRequest("translate", {
      title: "動画タイトル", epoch: context.epoch, translationKey: context.translationKey,
    }));
    assert.equal(reply.ok, false);
    assert.equal(p.requests.length, 0);
  }
});

test("숨긴·화면 밖·존재하지 않는 영상이나 위조된 프레임은 승인하지 않는다", async (t) => {
  for (const markup of [
    `<iframe hidden src="${FRAME_URL}"></iframe>`,
    `<iframe data-offscreen src="${FRAME_URL}"></iframe>`,
    `<div style="display:none"><iframe src="${FRAME_URL}"></iframe></div>`,
    `<div data-nudenyang-ignore><iframe src="${FRAME_URL}"></iframe></div>`,
    `<form><iframe src="${FRAME_URL}"></iframe></form>`,
    `<div class="cookie-banner"><iframe src="${FRAME_URL}"></iframe></div>`,
    "<div></div>",
  ]) {
    const p = page(t, markup);
    const context = await p.message(embedRequest("status"));
    assert.equal(context.enabled, false, markup);
    assert.equal(p.requests.length, 0);
  }
  const p = page(t, `<iframe src="${FRAME_URL}"></iframe>`);
  for (const extra of [
    { frameId: 0 }, { frameId: -1 }, { documentToken: "invalid token" },
    { frameUrl: "https://www.youtube.com.evil.test/embed/video123" },
  ]) {
    const reply = await p.message(embedRequest("status", extra));
    assert.ok(reply.ok === false || reply.enabled === false);
  }
  assert.equal((await p.message(embedRequest("status"), { id: "another-extension" })).ok, false);
});

test("영상 문서가 다시 연결되어도 진행 중인 같은 제목 번역을 이어받는다", async (t) => {
  const p = page(t, `<iframe src="${FRAME_URL}"></iframe>`, { deferTranslation: true });
  const context = await p.message(embedRequest("status"));
  const request = embedRequest("translate", {
    title: "動画タイトル", epoch: context.epoch, translationKey: context.translationKey,
  });
  const pending = p.message(request);
  await waitFor(() => p.requests.length === 1, "native request should begin");
  await p.message(embedRequest("status", { documentToken: "replacement_document" }));
  const replacement = p.message({ ...request, documentToken: "replacement_document" });
  assert.equal((await pending).code, "stale");
  assert.equal(p.requests.length, 1);
  p.releaseTranslation();
  assert.equal((await replacement).translation, "번역(動画タイトル)");
});

test("같은 영상 문서의 포커스 재확인도 진행 중인 제목 번역을 이어받는다", async (t) => {
  const p = page(t, `<iframe src="${FRAME_URL}"></iframe>`, { deferTranslation: true });
  const context = await p.message(embedRequest("status"));
  const request = embedRequest("translate", {
    title: "動画タイトル", epoch: context.epoch, translationKey: context.translationKey,
  });
  const first = p.message(request);
  await waitFor(() => p.requests.length === 1, "native request should begin");
  await p.message(embedRequest("status"));
  const next = p.message(request);
  assert.equal((await first).code, "stale");
  p.releaseTranslation();
  assert.equal((await next).translation, "번역(動画タイトル)");
  assert.equal(p.requests.length, 1);
});

test("부모 OFF는 진행 중인 영상 요청을 즉시 해제하고 늦은 결과를 버린다", async (t) => {
  const p = page(t, `<iframe src="${FRAME_URL}"></iframe>`, { deferTranslation: true });
  const context = await p.message(embedRequest("status"));
  const pending = p.message(embedRequest("translate", {
    title: "動画タイトル", epoch: context.epoch, translationKey: context.translationKey,
  }));
  await waitFor(() => p.requests.length === 1, "native request should begin");
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  const cancelled = await pending;
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.code, "disabled");
  p.releaseTranslation();
  assert.equal((await p.message(embedRequest("status"))).enabled, false);
  assert.ok(p.runtimeMessages.some((message) => message.type === "nudenyang-embed-parent-changed"));
});

test("전송 한도를 이미 사용했어도 진행 중인 제목은 추가 전송 없이 이어받는다", async (t) => {
  const p = page(t, `${["文", "章", "字"].map((char) => `<p>${char.repeat(3000)}</p>`).join("")}
    <iframe src="${FRAME_URL}"></iframe>`, {
    deferTranslation: true, translator: "deepl", settings: { externalPageCharLimit: 10000 },
  });
  const context = await p.message(embedRequest("status"));
  const request = embedRequest("translate", {
    title: "題".repeat(1000), epoch: context.epoch, translationKey: context.translationKey,
  });
  const first = p.message(request);
  await waitFor(() => p.requests.length === 1, "one shared request should use the budget");
  assert.equal((await p.message({ type: "nudenyang-status" })).sentChars, 10000);
  await p.message(embedRequest("status"));
  const next = p.message(request);
  assert.equal((await first).code, "stale");
  p.releaseTranslation();
  assert.equal((await next).translation, `번역(${request.title})`);
  assert.equal(p.requests.length, 1);
});

test("재연결된 영상의 제목이 바뀌면 이전 결과를 버리고 새 제목만 순서대로 처리한다", async (t) => {
  const p = page(t, `<iframe src="${FRAME_URL}"></iframe>`, { deferTranslation: true });
  const context = await p.message(embedRequest("status"));
  const request = embedRequest("translate", {
    title: "前の動画", epoch: context.epoch, translationKey: context.translationKey,
  });
  const first = p.message(request);
  await waitFor(() => p.requests.length === 1, "first request should begin");
  const next = p.message({ ...request, title: "次の動画", documentToken: "next_document" });
  assert.equal((await first).code, "stale");
  assert.equal(p.requests.length, 1);
  p.releaseTranslation();
  await waitFor(() => p.requests.length === 2, "next title should follow the previous native request");
  p.releaseTranslation();
  assert.equal((await next).translation, "번역(次の動画)");
  assert.deepEqual(p.sent(), ["前の動画", "次の動画"]);
});

test("언어 변경 후 이전 영상 결과는 적용하지 않고 새 언어만 허용한다", async (t) => {
  const p = page(t, `<iframe src="${FRAME_URL}"></iframe>`, { deferTranslation: true });
  const before = await p.message(embedRequest("status"));
  const pending = p.message(embedRequest("translate", {
    title: "動画タイトル", epoch: before.epoch, translationKey: before.translationKey,
  }));
  await waitFor(() => p.requests.length === 1, "native request should begin");
  await p.message({ type: "nudenyang-set-target-language", targetLanguage: "EN" });
  assert.equal((await pending).code, "stale");
  p.releaseTranslation();
  const after = await p.message(embedRequest("status"));
  assert.notEqual(after.translationKey, before.translationKey);
  assert.ok(after.epoch > before.epoch);
  const stale = await p.message(embedRequest("translate", {
    title: "動画タイトル", epoch: before.epoch, translationKey: before.translationKey,
  }));
  assert.equal(stale.code, "stale");
  const next = p.message(embedRequest("translate", {
    title: "動画タイトル", epoch: after.epoch, translationKey: after.translationKey,
  }));
  await waitFor(() => p.requests.length === 2, "new target should get a fresh request");
  assert.equal(p.requests[1].targetLanguage, "EN");
  p.releaseTranslation();
  assert.equal((await next).targetLanguage, "EN");
});

test("영상 제목도 부모 페이지의 외부 전송 한도를 소비하고 초과 시 보내지 않는다", async (t) => {
  const prose = ["文".repeat(3999), "章".repeat(3999), "字".repeat(1990)];
  const p = page(t, `${prose.map((text) => `<p>${text}</p>`).join("")}
    <iframe src="${FRAME_URL}"></iframe>`, {
    translator: "deepl", settings: { externalPageCharLimit: 10000 },
  });
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.requests.length === 1, "prose should consume the budget");
  const context = await p.message(embedRequest("status"));
  const reply = await p.message(embedRequest("translate", {
    title: "題".repeat(20), epoch: context.epoch, translationKey: context.translationKey,
  }));
  assert.equal(reply.code, "limited");
  assert.equal(p.requests.length, 1);
  assert.equal((await p.message({ type: "nudenyang-status" })).sentChars, 9988);
});

test("다른 탭으로 넘어간 뒤 아직 전송하지 않은 영상 제목은 보내지 않는다", async (t) => {
  const p = page(t, `<iframe src="${FRAME_URL}"></iframe>`);
  const context = await p.message(embedRequest("status"));
  const pending = p.message(embedRequest("translate", {
    title: "動画タイトル", epoch: context.epoch, translationKey: context.translationKey,
  }));
  // Allow request validation to finish, but hide the parent before the shared queue flush.
  await Promise.resolve();
  await Promise.resolve();
  Object.defineProperty(p.w.document, "hidden", { value: true, configurable: true });
  p.w.document.dispatchEvent(new p.w.Event("visibilitychange"));
  assert.equal((await pending).ok, false);
  assert.equal(p.requests.length, 0);
  assert.equal((await p.message(embedRequest("status"))).enabled, false);
});

test("SPA가 민감한 경로로 이동하면 주기 검사 전에도 영상 제목을 차단한다", async (t) => {
  const p = page(t, `<iframe src="${FRAME_URL}"></iframe>`, { url: "https://example.org/articles/one" });
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  const before = await p.message(embedRequest("status"));
  assert.equal(before.enabled, true);
  p.w.history.pushState({}, "", "/account");
  const after = await p.message(embedRequest("status"));
  assert.equal(after.enabled, false);
  assert.ok(after.epoch > before.epoch);
  const reply = await p.message(embedRequest("translate", {
    title: "動画タイトル", epoch: before.epoch, translationKey: before.translationKey,
  }));
  assert.equal(reply.ok, false);
  assert.equal(p.requests.length, 0);
});

test("번역 응답에 포함된 최신 사용 중지 설정도 영상 응답 전에 적용한다", async (t) => {
  const p = page(t, `<iframe src="${FRAME_URL}"></iframe>`, { responseSettings: { enabled: false } });
  const before = await p.message(embedRequest("status"));
  const reply = await p.message(embedRequest("translate", {
    title: "動画タイトル", epoch: before.epoch, translationKey: before.translationKey,
  }));
  assert.equal(reply.ok, false);
  assert.equal((await p.message(embedRequest("status"))).enabled, false);
});
