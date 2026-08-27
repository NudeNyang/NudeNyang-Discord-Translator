import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const bridgeSource = fs.readFileSync(new URL("../embedded-bridge.js", import.meta.url), "utf8");

function createBackground(tabState, {
  bridge = { handle: () => false, clear: () => {} },
  nativeClient = { request: async () => ({ ok: true }) },
  pageConnection = { request: async () => ({}), ensure: async () => ({}) },
  loadBridgeThroughImportScripts = false,
  realBridge = false,
  sendTabMessage,
  queryTabs = (_query, callback) => callback([]),
  privacy = { forward: (request, _sender, forward) => forward(request), getConsent: async () => ({ granted: false }), invalidate: () => {} },
} = {}) {
  const listeners = {};
  const imports = [];
  const bridgeApis = [];
  const event = (name) => ({ addListener(listener) { listeners[name] = listener; } });
  const api = {
    runtime: {
      getManifest: () => ({ version: "0.7.4" }),
      onMessage: event("message"),
      onInstalled: event("installed"),
    },
    tabs: {
      onRemoved: event("removed"),
      onActivated: event("activated"),
      query: queryTabs,
      sendMessage: sendTabMessage,
    },
    storage: { onChanged: event("storageChanged") },
    permissions: { onRemoved: event("permissionsRemoved") },
    commands: { onCommand: event("command") },
  };
  const bridgeModule = {
    createEmbeddedBridge(receivedApi) {
      bridgeApis.push(receivedApi);
      return bridge;
    },
  };
  const context = {
    URL,
    chrome: api,
    navigator: { userAgent: "Chrome" },
    NudeNyangNativeClient: { createNativeClient: () => nativeClient },
    NudeNyangTabTranslationState: { createTabTranslationState: () => tabState },
    NudeNyangPageConnection: { createPageConnection: () => pageConnection },
    NudeNyangEmbeddedBridge: loadBridgeThroughImportScripts || realBridge ? undefined : bridgeModule,
    NudeNyangMessengerAdapters: {},
    NudeNyangMessengerPrivacy: { createMessengerPrivacy: () => privacy },
  };
  if (loadBridgeThroughImportScripts || realBridge) {
    context.importScripts = (path) => {
      imports.push(path);
      assert.equal(path, "embedded-bridge.js");
      if (realBridge) vm.runInContext(bridgeSource, context);
      else context.NudeNyangEmbeddedBridge = bridgeModule;
    };
  }
  vm.runInNewContext(source, context);
  return {
    api, listeners, imports, bridgeApis,
    message(message, sender) {
      return new Promise((resolve) => {
        assert.equal(listeners.message(message, sender, resolve), true);
      });
    },
  };
}

test("새 팝업의 초기 상태는 브라우저가 제공한 sender 탭과 문서 URL로 해석한다", async () => {
  const reads = [];
  const background = createBackground({
    get: async () => null,
    getForTab: async (tab, url) => { reads.push({ tab, url }); return true; },
  });
  const tab = { id: 23, openerTabId: 17 };
  const response = await background.message({
    type: "nudenyang-tab-enabled-get",
    tab: { id: 999, openerTabId: 888 },
    url: "https://untrusted.example/",
  }, { tab, url: "https://example.com/popup", frameId: 0 });
  assert.equal(response.enabled, true);
  assert.deepEqual(reads, [{ tab, url: "https://example.com/popup" }]);
});

test("토글 저장과 탭 종료는 요청 본문의 다른 탭 ID를 사용하지 않는다", async () => {
  const writes = [];
  const clears = [];
  const frameClears = [];
  const background = createBackground({
    set: async (tabId, enabled) => { writes.push({ tabId, enabled }); return enabled; },
    clear: async (tabId) => { clears.push(tabId); },
  }, { bridge: { handle: () => false, clear: (tabId) => frameClears.push(tabId) } });
  const response = await background.message({
    type: "nudenyang-tab-enabled-set", enabled: false, tabId: 999,
  }, { tab: { id: 23 } });
  assert.equal(response.enabled, false);
  assert.deepEqual(writes, [{ tabId: 23, enabled: false }]);
  background.listeners.removed(23);
  assert.deepEqual(clears, [23]);
  assert.deepEqual(frameClears, [23]);
});

test("Chromium 서비스 워커는 iframe bridge를 로드하고 같은 브라우저 API로 초기화한다", () => {
  const background = createBackground({}, { loadBridgeThroughImportScripts: true });
  assert.deepEqual(background.imports, ["embedded-bridge.js"]);
  assert.deepEqual(background.bridgeApis, [background.api]);
});

test("서비스 워커가 재생성되어도 기존 iframe 모두가 OFF와 언어 변경 상태를 다시 받는다", async () => {
  const tab = { id: 23 };
  const parentSender = { tab, frameId: 0, url: "https://example.com/article" };
  const children = [3, 4].map((frameId) => ({
    sender: { tab, frameId, url: `https://www.youtube-nocookie.com/embed/video${frameId}` },
    request: { type: "nudenyang-embed-request", action: "status", documentToken: `document-${frameId}` },
    state: null,
  }));
  const refreshed = [];
  const responses = [];
  const broadcasts = [];
  let parentState = { ok: true, enabled: true, epoch: 2, translationKey: "ko:local", targetLanguage: "ko" };
  let worker;
  const sendTabMessage = (tabId, message, options, callback) => {
    assert.equal(tabId, tab.id);
    if (message.type === "nudenyang-embed-parent-request") {
      assert.equal(options.frameId, 0);
      assert.equal(message.action, "status");
      callback({ ...parentState });
      return;
    }
    assert.equal(message.type, "nudenyang-embed-refresh");
    broadcasts.push({ ...message });
    for (const child of children) {
      if (options.frameId !== undefined && options.frameId !== child.sender.frameId) continue;
      refreshed.push(child.sender.frameId);
      responses.push(worker.message(child.request, child.sender).then((state) => { child.state = state; }));
    }
    callback({ ok: true });
  };
  const restartWorker = () => createBackground({}, { realBridge: true, sendTabMessage });
  worker = restartWorker();
  for (const child of children) child.state = await worker.message(child.request, child.sender);
  assert.equal(children.every((child) => child.state.enabled), true);

  // The page and its content scripts survive; only the worker's bridge Map is lost.
  worker = restartWorker();
  parentState = { ...parentState, enabled: false, epoch: 3 };
  assert.equal((await worker.message({ type: "nudenyang-embed-parent-changed" }, children[0].sender)).ok, false);
  assert.deepEqual(refreshed, []);
  await worker.message({ type: "nudenyang-embed-parent-changed", tabId: 999 }, parentSender);
  await Promise.all(responses.splice(0));
  assert.deepEqual(refreshed.splice(0), [3, 4]);
  assert.equal(children.every((child) => child.state.enabled === false && child.state.epoch === 3), true);

  // A partial registry after another restart must not leave the other iframe stale.
  worker = restartWorker();
  children[0].state = await worker.message(children[0].request, children[0].sender);
  parentState = { ok: true, enabled: true, epoch: 4, translationKey: "en:local", targetLanguage: "en" };
  await worker.message({ type: "nudenyang-embed-parent-changed" }, parentSender);
  await Promise.all(responses.splice(0));
  assert.deepEqual(refreshed, [3, 4]);
  assert.equal(children.every((child) => child.state.enabled && child.state.translationKey === "en:local"), true);
  assert.deepEqual(broadcasts, [
    { type: "nudenyang-embed-refresh" },
    { type: "nudenyang-embed-refresh" },
  ]);
});

test("iframe 요청과 부모 변경 알림은 실제 sender와 응답 콜백을 bridge에 전달한다", async () => {
  const calls = [];
  const background = createBackground({}, {
    bridge: {
      handle(message, sender, sendResponse) {
        calls.push({ message, sender });
        queueMicrotask(() => sendResponse({ ok: true, type: message.type }));
        return true;
      },
      clear() {},
    },
  });
  for (const [message, sender] of [
    [
      { type: "nudenyang-embed-request", action: "status", documentToken: "document-1", tabId: 999 },
      { tab: { id: 23 }, frameId: 3, url: "https://www.youtube-nocookie.com/embed/video" },
    ],
    [
      { type: "nudenyang-embed-parent-changed", tabId: 999 },
      { tab: { id: 23 }, frameId: 0, url: "https://example.com/article" },
    ],
  ]) {
    const response = await background.message(message, sender);
    assert.deepEqual(response, { ok: true, type: message.type });
    assert.equal(calls.at(-1).message, message);
    assert.equal(calls.at(-1).sender, sender);
  }
  assert.equal(calls.length, 2);
});

test("bridge가 처리한 메시지는 기존 Native 경로로 중복 전달하지 않는다", async () => {
  const nativeRequests = [];
  const background = createBackground({}, {
    bridge: {
      handle(_message, _sender, sendResponse) {
        sendResponse({ from: "bridge" });
        return true;
      },
      clear() {},
    },
    nativeClient: { request: async (request) => { nativeRequests.push(request); return { from: "native" }; } },
  });
  const response = await background.message({ type: "nudenyang-native-request", request: { type: "status" } }, {});
  assert.deepEqual(response, { from: "bridge" });
  assert.deepEqual(nativeRequests, []);
});

test("bridge가 거절한 일반 Native·페이지 요청은 기존 경로를 유지한다", async () => {
  const checked = [];
  const nativeRequests = [];
  const pageRequests = [];
  const background = createBackground({}, {
    bridge: { handle: (message) => { checked.push(message.type); return false; }, clear() {} },
    nativeClient: { request: async (request) => { nativeRequests.push(request); return { from: "native" }; } },
    pageConnection: {
      request: async (tabId, message) => { pageRequests.push({ tabId, message }); return { from: "page" }; },
      ensure: async () => ({}),
    },
  });
  const nativeRequest = { type: "status" };
  const pageMessage = { type: "nudenyang-status" };
  assert.deepEqual(await background.message({ type: "nudenyang-native-request", request: nativeRequest }, {}), { from: "native" });
  assert.deepEqual(await background.message({ type: "nudenyang-page-request", tabId: 23, message: pageMessage }, {}), { from: "page" });
  assert.deepEqual(checked, ["nudenyang-native-request", "nudenyang-page-request"]);
  assert.deepEqual(nativeRequests, [nativeRequest]);
  assert.deepEqual(pageRequests, [{ tabId: 23, message: pageMessage }]);
  assert.equal(background.listeners.message({ type: "unrelated-message" }, {}, () => assert.fail("unexpected response")), false);
});

test("동의 조회가 늦게 끝난 이전 허용 알림은 최신 철회 알림 뒤에 방송되지 않는다", async () => {
  const consentReads = [];
  const delivered = [];
  let invalidations = 0;
  const background = createBackground({}, {
    privacy: {
      getConsent: () => new Promise((resolve) => consentReads.push(resolve)),
      invalidate: () => { invalidations += 1; },
    },
    queryTabs: (_query, callback) => callback([{ id: 7 }]),
    sendTabMessage: (_tabId, message, _options, callback) => { delivered.push(message.consent.granted); callback(); },
  });
  background.listeners.storageChanged({ messengerConsentVersion: { oldValue: 0, newValue: 1 } }, "local");
  background.listeners.storageChanged({ messengerConsentVersion: { oldValue: 1, newValue: 0 } }, "local");
  consentReads[1]({ granted: false, consentVersion: 0 });
  await Promise.resolve();
  consentReads[0]({ granted: true, consentVersion: 2 });
  await Promise.resolve();
  assert.equal(invalidations, 2);
  assert.deepEqual(delivered, [false]);
});

test("탭 조회가 지연된 허용 알림은 Firefox 권한 철회 뒤에 도착해도 방송되지 않는다", async () => {
  const queries = [];
  const delivered = [];
  let granted = true;
  const background = createBackground({}, {
    privacy: {
      getConsent: async () => ({ granted, consentVersion: granted ? 2 : 0 }),
      invalidate: () => {},
    },
    queryTabs: (_query, callback) => queries.push(callback),
    sendTabMessage: (_tabId, message, _options, callback) => { delivered.push(message.consent.granted); callback(); },
  });
  background.listeners.storageChanged({ messengerConsentVersion: { oldValue: 0, newValue: 1 } }, "local");
  await Promise.resolve();
  granted = false;
  background.listeners.permissionsRemoved({ data_collection: ["personalCommunications"] });
  await Promise.resolve();
  assert.equal(queries.length, 2);
  queries[1]([{ id: 7 }]);
  queries[0]([{ id: 7 }]);
  assert.deepEqual(delivered, [false]);
});
