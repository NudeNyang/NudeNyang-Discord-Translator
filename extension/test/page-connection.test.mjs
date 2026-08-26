import assert from "node:assert/strict";
import test from "node:test";
import "../page-connection.js";

const { createPageConnection } = globalThis.NudeNyangPageConnection;

function fakeApi({
  url = "https://example.com/article",
  receiverReady = false,
  receiverError = "Could not establish connection. Receiving end does not exist.",
} = {}) {
  let ready = receiverReady;
  let injectionCount = 0;
  const sent = [];
  const runtime = { lastError: null };
  const api = {
    runtime,
    tabs: {
      get(_tabId, callback) {
        callback({ id: 17, url });
      },
      sendMessage(_tabId, message, callback) {
        sent.push(message.type);
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
        injectionCount += 1;
        assert.deepEqual(options.target, { tabId: 17 });
        assert.deepEqual(options.files, ["site-adapters.js", "content-helpers.js", "content.js"]);
        ready = true;
        callback([]);
      },
    },
  };
  return {
    api,
    injectionCount: () => injectionCount,
    sent,
  };
}

test("수신자가 사라진 일반 웹 탭은 콘텐츠 스크립트를 다시 넣고 요청을 재시도한다", async () => {
  const fake = fakeApi();
  const connection = createPageConnection(fake.api);

  const response = await connection.request(17, { type: "nudenyang-status" });

  assert.equal(response?.supported, true);
  assert.equal(fake.injectionCount(), 1);
  assert.deepEqual(fake.sent, ["nudenyang-status", "nudenyang-ready", "nudenyang-status"]);
});

test("이미 연결된 탭은 스크립트를 중복 삽입하지 않는다", async () => {
  const fake = fakeApi({ receiverReady: true });
  const connection = createPageConnection(fake.api);

  const response = await connection.request(17, { type: "nudenyang-status" });

  assert.equal(response?.enabled, true);
  assert.equal(fake.injectionCount(), 0);
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

test("같은 탭의 동시 복구 요청은 스크립트 삽입 한 번을 공유한다", async () => {
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
  assert.equal(fake.injectionCount(), 1);
});
