import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import "../page-connection.js";

const { createPageConnection } = globalThis.NudeNyangPageConnection;

function fakeApi({
  url = "https://example.com/article",
  receiverReady = false,
  iframeReceiverReady = false,
  receiverError = "Could not establish connection. Receiving end does not exist.",
  topInjectionError = "",
  embeddedInjectionError = "",
  throwEmbeddedInjection = false,
} = {}) {
  let ready = receiverReady;
  const injections = [];
  const sent = [];
  const destinations = [];
  const runtime = { lastError: null };
  const api = {
    runtime,
    tabs: {
      get(_tabId, callback) {
        callback({ id: 17, url });
      },
      sendMessage(tabId, message, options, callback) {
        if (typeof options === "function") {
          callback = options;
          options = undefined;
        }
        sent.push(message.type);
        destinations.push({ tabId, options });
        if (iframeReceiverReady && options?.frameId !== 0) {
          callback({ type: message.type, supported: false, enabled: false, embedded: true });
          return;
        }
        if (!ready) {
          runtime.lastError = { message: receiverError };
          callback(undefined);
          runtime.lastError = null;
          return;
        }
        callback({ type: message.type, supported: true, enabled: true });
      },
    },
    scripting: {
      executeScript(options, callback) {
        injections.push(options);
        const embedded = options.files.includes("embedded-title.js");
        if (embedded && throwEmbeddedInjection) throw new Error("Frame access denied.");
        const error = embedded ? embeddedInjectionError : topInjectionError;
        if (error) {
          runtime.lastError = { message: error };
          callback(undefined);
          runtime.lastError = null;
          return;
        }
        if (!embedded) ready = true;
        callback([]);
      },
    },
  };
  return {
    api,
    injectionCount: () => injections.length,
    injections,
    sent,
    destinations,
  };
}

test("수신자가 사라진 일반 웹 탭은 콘텐츠 스크립트를 다시 넣고 요청을 재시도한다", async () => {
  const fake = fakeApi();
  const connection = createPageConnection(fake.api);

  const response = await connection.request(17, { type: "nudenyang-status" });

  assert.equal(response?.supported, true);
  assert.equal(fake.injectionCount(), 2);
  assert.deepEqual(fake.injections, [
    { target: { tabId: 17, frameIds: [0] }, files: ["site-adapters.js", "messenger-adapters.js", "content-helpers.js", "popup-locales.js", "content.js"] },
    { target: { tabId: 17, allFrames: true }, files: ["embedded-title.js"] },
  ]);
  assert.deepEqual(fake.sent, ["nudenyang-status", "nudenyang-ready", "nudenyang-status"]);
});

test("자동 복구는 두 브라우저의 최초 주입과 같은 순서로 메신저 어댑터까지 로드한다", async () => {
  const fake = fakeApi();
  await createPageConnection(fake.api).ensure(17);

  for (const manifestName of ["manifest.json", "manifest.firefox.json"]) {
    const manifest = JSON.parse(fs.readFileSync(new URL(`../${manifestName}`, import.meta.url), "utf8"));
    assert.deepEqual(fake.injections[0].files, manifest.content_scripts[0].js, manifestName);
    assert.deepEqual(fake.injections[0].target, { tabId: 17, frameIds: [0] });
  }
});

test("이미 연결된 탭은 스크립트를 중복 삽입하지 않는다", async () => {
  const fake = fakeApi({ receiverReady: true });
  const connection = createPageConnection(fake.api);

  const response = await connection.request(17, { type: "nudenyang-status" });

  assert.equal(response?.enabled, true);
  assert.equal(fake.injectionCount(), 0);
});

test("상태·언어·설정·전환 요청은 iframe 응답과 섞이지 않도록 최상위 문서에만 보낸다", async () => {
  const fake = fakeApi({ receiverReady: true, iframeReceiverReady: true });
  const connection = createPageConnection(fake.api);
  const messages = [
    { type: "nudenyang-status" },
    { type: "nudenyang-toggle-enabled" },
    { type: "nudenyang-set-enabled", enabled: true },
    { type: "nudenyang-restore" },
    { type: "nudenyang-set-target-language", language: "ko" },
    { type: "nudenyang-apply-web-settings", settings: {} },
  ];

  for (const message of messages) {
    const response = await connection.request(17, message);
    assert.equal(response?.supported, true, message.type);
    assert.equal(response?.embedded, undefined, message.type);
  }
  assert.deepEqual(fake.destinations, messages.map(() => ({ tabId: 17, options: { frameId: 0 } })));
  assert.equal(fake.injectionCount(), 0);
});

test("iframe 수신자만 살아 있어도 최상위 문서의 연결을 복구하고 준비 확인과 재시도를 고정한다", async () => {
  const fake = fakeApi({ iframeReceiverReady: true });
  const connection = createPageConnection(fake.api);

  const response = await connection.ensure(17);

  assert.equal(response?.supported, true);
  assert.equal(response?.embedded, undefined);
  assert.equal(fake.injectionCount(), 2);
  assert.deepEqual(fake.sent, ["nudenyang-status", "nudenyang-ready", "nudenyang-status"]);
  assert.deepEqual(fake.destinations, fake.sent.map(() => ({ tabId: 17, options: { frameId: 0 } })));
});

test("브라우저 내부 페이지에는 복구 스크립트를 삽입하지 않는다", async () => {
  const fake = fakeApi({ url: "chrome://extensions" });
  const connection = createPageConnection(fake.api);

  const response = await connection.request(17, { type: "nudenyang-status" });

  assert.equal(response, null);
  assert.equal(fake.injectionCount(), 0);
});

test("수신기 단절이 아닌 메시지 오류에는 스크립트를 다시 넣지 않는다", async () => {
  const fake = fakeApi({ receiverError: "The message port closed before a response was received." });
  const connection = createPageConnection(fake.api);

  const response = await connection.request(17, { type: "nudenyang-status" });

  assert.equal(response, null);
  assert.equal(fake.injectionCount(), 0);
});

test("같은 탭의 동시 복구 요청은 top과 제한된 embed 스크립트 삽입을 각각 한 번만 공유한다", async () => {
  const fake = fakeApi();
  const originalExecute = fake.api.scripting.executeScript;
  fake.api.scripting.executeScript = (options, callback) => {
    setTimeout(() => originalExecute(options, callback), 5);
  };
  const connection = createPageConnection(fake.api);

  const [first, second] = await Promise.all([
    connection.ensure(17),
    connection.ensure(17),
  ]);

  assert.equal(first?.supported, true);
  assert.equal(second?.supported, true);
  assert.equal(fake.injectionCount(), 2);
  assert.equal(fake.injections.filter(({ files }) => files.includes("content.js")).length, 1);
  assert.equal(fake.injections.filter(({ files }) => files.includes("embedded-title.js")).length, 1);
});

test("일부 하위 프레임 주입이 거부되어도 정상 top 복구와 요청 재시도는 유지한다", async () => {
  for (const options of [
    { embeddedInjectionError: "Cannot access contents of the frame." },
    { throwEmbeddedInjection: true },
  ]) {
    const fake = fakeApi(options);
    const connection = createPageConnection(fake.api);

    const response = await connection.ensure(17);

    assert.equal(fake.injectionCount(), 2);
    assert.equal(response?.supported, true);
    assert.deepEqual(fake.sent, ["nudenyang-status", "nudenyang-ready", "nudenyang-status"]);
    assert.equal(fake.api.runtime.lastError, null);
  }
});

test("top 복구가 실패하면 embed를 따로 시작하거나 준비 완료를 가장하지 않는다", async () => {
  const fake = fakeApi({ topInjectionError: "Cannot access contents of the page." });
  const connection = createPageConnection(fake.api);

  const response = await connection.ensure(17);

  assert.equal(response, null);
  assert.equal(fake.injectionCount(), 1);
  assert.equal(fake.injections[0].files.includes("embedded-title.js"), false);
  assert.deepEqual(fake.sent, ["nudenyang-status"]);
});
