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
  const timers = new Map();
  let timerId = 0;
  const event = (name) => ({ addListener(listener) { listeners[name] = listener; } });
  const api = {
    runtime: {
      getManifest: () => ({ version: "0.7.4" }),
      onMessage: event("message"),
      onInstalled: event("installed"),
      onStartup: event("startup"),
    },
    tabs: {
      onRemoved: event("removed"),
      onActivated: event("activated"),
      query: queryTabs,
      sendMessage: sendTabMessage,
    },
    storage: { onChanged: event("storageChanged") },
    permissions: { onRemoved: event("permissionsRemoved") },
    alarms: { create() {}, onAlarm: event("alarm") },
    windows: { WINDOW_ID_NONE: -1, onFocusChanged: event("focusChanged") },
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
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
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
    api, listeners, imports, bridgeApis, timers,
    message(message, sender) {
      return new Promise((resolve) => {
        assert.equal(listeners.message(message, sender, resolve), true);
      });
    },
  };
}

const flushConnection = () => new Promise(resolve => setImmediate(resolve));

test("페이지 동의 안내 열기는 발신자 검증과 최신 대화 상태 확인을 개인정보 모듈에 위임한다", async () => {
  const sender = { tab: { id: 23 }, frameId: 0 };
  const calls = [];
  const background = createBackground({}, {
    pageConnection: { async request(tabId, message) { calls.push({ tabId, message }); return { messengerContextId: "opaque" }; } },
    privacy: { async openNotice(contextId, source, currentStatus) {
      assert.equal(contextId, "opaque");
      assert.equal(source, sender);
      assert.equal((await currentStatus(source.tab.id)).messengerContextId, "opaque");
      return { ok: true };
    } },
  });
  assert.equal((await background.message({ type: "nudenyang-messenger-privacy-open", contextId: "opaque", tabId: 999 }, sender)).ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tabId, 23);
  assert.equal(calls[0].message.type, "nudenyang-status");
});

test("백그라운드가 다시 시작되면 별도 버튼이나 브라우저 재시작 없이 연결 신호를 보낸다", async () => {
  const requests = [];
  createBackground({}, {
    nativeClient: { request: async request => { requests.push(request); return { type: "connection", appConnected: true }; } },
  });
  await flushConnection();
  assert.deepEqual(requests.map(request => request.type), ["connectionPing"]);
});

test("브라우저에서 본체로 돌아오면 페이지를 조회하지 않고 연결만 확인한다", async () => {
  const requests = [];
  const queries = [];
  const background = createBackground({}, {
    nativeClient: { request: async request => { requests.push(request); return { type: "connection", appConnected: true }; } },
    queryTabs(query, callback) { queries.push(query); callback([]); },
  });
  await flushConnection();
  requests.length = 0;
  background.listeners.focusChanged(-1);
  await flushConnection();
  assert.deepEqual(requests.map(request => request.type), ["connectionPing"]);
  assert.deepEqual(queries, []);
});

test("본체가 켜지는 중이면 짧게 재시도하고 성공·명시적 해제 후에는 재시도를 멈춘다", async () => {
  const requests = [];
  let response = { type: "error", code: "app_unavailable", retryable: true };
  const background = createBackground({}, {
    nativeClient: { request: async request => { requests.push(request); return response; } },
  });
  await background.listeners.startup();
  assert.equal(background.timers.size, 1);
  const [id, timer] = [...background.timers][0];
  assert.ok(timer.delay <= 2000);
  background.timers.delete(id);
  response = { type: "connection", appConnected: true };
  timer.callback();
  await flushConnection();
  assert.equal(requests.length, 2);
  assert.equal(background.timers.size, 0);
  response = { type: "error", code: "browser_connection_disabled", retryable: false };
  await background.listeners.alarm({ name: "nudenyang-connection" });
  assert.equal(background.timers.size, 0);
  assert.ok(requests.every(request => Object.keys(request).sort().join() === "requestId,type"));
});

test("본체가 계속 꺼져 있으면 짧은 재시도 횟수를 제한하고 다음 알람을 기다린다", async () => {
  let requests = 0;
  const background = createBackground({}, {
    nativeClient: { request: async () => { requests++; return { type: "error", code: "app_unavailable", retryable: true }; } },
  });
  await background.listeners.startup();
  while (background.timers.size && requests < 10) {
    const [id, timer] = [...background.timers][0];
    background.timers.delete(id);
    timer.callback();
    await flushConnection();
  }
  assert.equal(requests, 5);
  assert.equal(background.timers.size, 0);
});

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

test("설치와 브라우저 시작은 번역이나 탭 이동 없이 앱 연결만 확인한다", async () => {
  const requests = [];
  const background = createBackground({}, {
    nativeClient: { request: async (request) => { requests.push(request); return { type: "connection", appConnected: true }; } },
  });
  await background.listeners.installed({ reason: "install" });
  await background.listeners.startup();
  assert.deepEqual(requests.map(request => request.type), ["connectionPing", "connectionPing"]);
  assert.ok(requests.every(request => !request.pageUrl && !request.items));
});

test("연결 확인은 중복 실행하지 않고 실패 후 다음 알람에서 재시도한다", async () => {
  const requests = [];
  let settle;
  const background = createBackground({}, {
    nativeClient: { request: (request) => {
      requests.push(request);
      return new Promise(resolve => { settle = resolve; });
    } },
  });
  const pending = background.listeners.startup();
  const duplicate = background.listeners.alarm({ name: "nudenyang-connection" });
  assert.equal(requests.length, 1);
  settle({ type: "error", code: "app_unavailable" });
  await pending;
  await duplicate;
  await background.listeners.alarm({ name: "unrelated" });
  assert.equal(requests.length, 1);
  const retry = background.listeners.alarm({ name: "nudenyang-connection" });
  assert.equal(requests.length, 2);
  settle({ type: "connection", appConnected: true });
  await retry;
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
  assert.deepEqual(nativeRequests.filter(request => request.type !== "connectionPing"), []);
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
  assert.deepEqual(nativeRequests.filter(request => request.type !== "connectionPing"), [nativeRequest]);
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
