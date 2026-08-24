import assert from "node:assert/strict";
import test from "node:test";
import "../native-client.js";

const { createNativeClient } = globalThis.NudeNyangNativeClient;

function fakeRuntime() {
  const ports = [];
  const runtime = {
    lastError: null,
    connectNative(hostName) {
      const messageListeners = [];
      const disconnectListeners = [];
      const port = {
        hostName,
        posted: [],
        onMessage: { addListener(listener) { messageListeners.push(listener); } },
        onDisconnect: { addListener(listener) { disconnectListeners.push(listener); } },
        postMessage(message) { this.posted.push(message); },
        disconnect() {},
        emitMessage(message) { for (const listener of messageListeners) listener(message); },
        emitDisconnect(detail = "연결 종료") {
          runtime.lastError = { message: detail };
          for (const listener of disconnectListeners) listener();
          runtime.lastError = null;
        },
      };
      ports.push(port);
      return port;
    },
  };
  return { api: { runtime }, ports };
}

test("여러 브라우저 요청은 Native Messaging 호스트 연결 하나를 재사용한다", async () => {
  const fake = fakeRuntime();
  const client = createNativeClient(fake.api, "com.nudenyang.translator", { browser: "chrome" });

  const first = client.request({ type: "status", requestId: "first" });
  const second = client.request({ type: "status", requestId: "second" });

  assert.equal(fake.ports.length, 1);
  assert.equal(fake.ports[0].posted.length, 2);
  fake.ports[0].emitMessage({ type: "status", requestId: "first" });
  fake.ports[0].emitMessage({ type: "status", requestId: "second" });
  assert.equal((await first).requestId, "first");
  assert.equal((await second).requestId, "second");
});

test("지속 연결이 끊기면 대기 요청을 오류로 끝내고 다음 요청에서 다시 연결한다", async () => {
  const fake = fakeRuntime();
  const client = createNativeClient(fake.api, "com.nudenyang.translator", { browser: "chrome" });

  const pending = client.request({ type: "translate", requestId: "pending" });
  fake.ports[0].emitDisconnect("Native host has exited.");
  const failed = await pending;
  assert.equal(failed.code, "native_host_unavailable");
  assert.equal(failed.retryable, true);

  const retried = client.request({ type: "status", requestId: "retry" });
  assert.equal(fake.ports.length, 2);
  fake.ports[1].emitMessage({ type: "status", requestId: "retry" });
  assert.equal((await retried).requestId, "retry");
});
