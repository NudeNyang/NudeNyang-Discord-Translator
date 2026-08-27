import assert from "node:assert/strict";
import test from "node:test";
import "../embedded-bridge.js";

const { createEmbeddedBridge } = globalThis.NudeNyangEmbeddedBridge;
const FRAME_URL = "https://www.youtube-nocookie.com/embed/eONkwo4B8Ps?rel=0";
const context = { ok: true, enabled: true, epoch: 2, translationKey: "ko:local", targetLanguage: "ko" };

function setup() {
  const sent = [];
  const pending = [];
  const api = {
    runtime: { lastError: null },
    tabs: {
      sendMessage(tabId, message, options, callback) {
        sent.push({ tabId, message, options });
        pending.push(callback);
      },
    },
  };
  const bridge = createEmbeddedBridge(api);
  const sender = { tab: { id: 17 }, frameId: 3, url: FRAME_URL };
  function request(message, source = sender) {
    let returned;
    const response = new Promise((resolve) => { returned = bridge.handle(message, source, resolve); });
    return { returned, response };
  }
  function status(source = sender, token = "frame-document-1") {
    return request({ type: "nudenyang-embed-request", action: "status", documentToken: token }, source);
  }
  return { api, bridge, sender, sent, pending, request, status };
}

test("iframe 상태는 실제 sender의 탭과 최상위 프레임으로만 전달한다", async () => {
  const fake = setup();
  const call = fake.request({
    type: "nudenyang-embed-request", action: "status", documentToken: "document-1",
    tabId: 999, frameId: 999, frameUrl: "https://attacker.example/", title: "보내지 않을 제목",
  });
  assert.equal(call.returned, true);
  assert.deepEqual(fake.sent, [{
    tabId: 17,
    message: {
      type: "nudenyang-embed-parent-request", action: "status", documentToken: "document-1",
      frameId: 3, frameUrl: FRAME_URL,
    },
    options: { frameId: 0 },
  }]);
  fake.pending.shift()(context);
  assert.deepEqual(await call.response, context);
});

test("허용되지 않은 호스트·스킴·경로·최상위 문서는 relay하지 않는다", async () => {
  for (const override of [
    { url: "http://www.youtube.com/embed/video" },
    { url: "https://www.youtube.com.attacker.example/embed/video" },
    { url: "https://www.youtube.com/watch?v=video" },
    { url: "https://www.youtube.com:444/embed/video" },
    { url: "https://user@www.youtube.com/embed/video" },
    { url: "about:blank" },
    { frameId: 0 }, { frameId: -1 }, { frameId: "3" }, { tab: { id: -1 } }, { tab: undefined },
  ]) {
    const fake = setup();
    const call = fake.status({ ...fake.sender, ...override });
    assert.equal((await call.response).ok, false);
    assert.equal(fake.sent.length, 0);
  }
});

test("일반 YouTube embed도 허용하고 상태 승인 후 제목만 전달한다", async () => {
  const fake = setup();
  const sender = { ...fake.sender, url: "https://www.youtube.com/embed/example" };
  const first = fake.status(sender);
  fake.pending.shift()(context);
  await first.response;
  const call = fake.request({
    type: "nudenyang-embed-request", action: "translate", documentToken: "frame-document-1",
    epoch: 2, translationKey: "ko:local", title: "動画のタイトル", html: "<script>bad</script>",
  }, sender);
  assert.equal(call.returned, true);
  assert.deepEqual(fake.sent[1].message, {
    type: "nudenyang-embed-parent-request", action: "translate", documentToken: "frame-document-1",
    frameId: 3, frameUrl: sender.url, epoch: 2, translationKey: "ko:local", title: "動画のタイトル",
  });
  const result = { ...context, translation: "영상 제목" };
  fake.pending.shift()(result);
  assert.deepEqual(await call.response, result);
});

test("부모 상태를 승인받지 않은 제목과 오래된 문맥은 전송하지 않는다", async () => {
  const fake = setup();
  const message = {
    type: "nudenyang-embed-request", action: "translate", documentToken: "frame-document-1",
    epoch: 2, translationKey: "ko:local", title: "動画のタイトル",
  };
  assert.equal((await fake.request(message).response).ok, false);
  assert.equal(fake.sent.length, 0);
  const first = fake.status();
  fake.pending.shift()({ ...context, enabled: false });
  await first.response;
  assert.equal((await fake.request(message).response).code, "disabled");
  assert.equal(fake.sent.length, 1);
  const second = fake.status();
  fake.pending.shift()(context);
  await second.response;
  assert.equal((await fake.request({ ...message, epoch: 1 }).response).code, "stale");
  assert.equal((await fake.request({ ...message, translationKey: "en:local" }).response).code, "stale");
  assert.equal(fake.sent.length, 2);
});

test("문서 토큰·요청 종류·제목 길이를 검증한다", async () => {
  for (const update of [
    { documentToken: "" }, { documentToken: "x".repeat(129) }, { action: "anything" },
    { action: "translate", epoch: 0, translationKey: "ko", title: "x".repeat(1001) },
    { action: "translate", epoch: 0, translationKey: "ko", title: " " },
    { action: "translate", epoch: -1, translationKey: "ko", title: "動画" },
  ]) {
    const fake = setup();
    const call = fake.request({ type: "nudenyang-embed-request", action: "status", documentToken: "one", ...update });
    assert.equal((await call.response).ok, false);
    assert.equal(fake.sent.length, 0);
  }
});

test("새 문서가 등록되거나 탭이 닫히면 이전 relay 응답을 폐기한다", async () => {
  const fake = setup();
  const old = fake.status();
  const current = fake.status(fake.sender, "new-document");
  fake.pending.shift()(context);
  assert.equal((await old.response).code, "stale");
  fake.bridge.clear(17);
  fake.pending.shift()(context);
  assert.equal((await current.response).code, "stale");
});

test("부모 상태 알림은 top-frame에서만 허용하고 실제 탭에 새로 확인 신호만 보낸다", async () => {
  const fake = setup();
  const first = fake.status();
  fake.pending.shift()(context);
  await first.response;
  const rejected = fake.request({ type: "nudenyang-embed-parent-changed" });
  assert.equal((await rejected.response).ok, false);
  assert.equal(fake.sent.length, 1);
  const accepted = fake.request({ type: "nudenyang-embed-parent-changed", tabId: 999 }, {
    tab: { id: 17 }, frameId: 0, url: "https://example.com/article",
  });
  assert.equal((await accepted.response).ok, true);
  assert.deepEqual(fake.sent[1], {
    tabId: 17, message: { type: "nudenyang-embed-refresh" }, options: {},
  });
  fake.pending.shift()();
});

test("부모 변경 중 돌아온 상태도 폐기한다", async () => {
  const fake = setup();
  const pending = fake.status();
  await fake.request({ type: "nudenyang-embed-parent-changed" }, { tab: { id: 17 }, frameId: 0 }).response;
  fake.pending.shift()(context);
  assert.equal((await pending.response).code, "stale");
  fake.pending.shift()();
});

test("부모 변경 후 이전 제목 응답과 승인은 폐기하고 새 상태 승인을 요구한다", async () => {
  const fake = setup();
  const status = fake.status();
  fake.pending.shift()(context);
  await status.response;
  const message = {
    type: "nudenyang-embed-request", action: "translate", documentToken: "frame-document-1",
    epoch: context.epoch, translationKey: context.translationKey, title: "動画のタイトル",
  };
  const oldTranslation = fake.request(message);
  await fake.request({ type: "nudenyang-embed-parent-changed" }, { tab: { id: 17 }, frameId: 0 }).response;
  assert.equal((await fake.request(message).response).code, "stale");
  assert.equal(fake.sent.length, 3);
  fake.pending.shift()({ ...context, translation: "이전 제목" });
  assert.equal((await oldTranslation.response).code, "stale");
  fake.pending.shift()();

  const currentStatus = fake.status();
  fake.pending.shift()({ ...context, epoch: 3, translationKey: "en:local", targetLanguage: "en" });
  await currentStatus.response;
  assert.equal((await fake.request(message).response).code, "stale");
  const currentTranslation = fake.request({ ...message, epoch: 3, translationKey: "en:local" });
  fake.pending.shift()({ ok: true, enabled: true, epoch: 3, translationKey: "en:local", translation: "Video title" });
  assert.equal((await currentTranslation.response).translation, "Video title");
});

test("등록 목록이 없어도 알림을 보내고 수신자 없는 탭의 오류는 조용히 처리한다", async () => {
  const fake = setup();
  const parent = { tab: { id: 17 }, frameId: 0 };
  const changed = { type: "nudenyang-embed-parent-changed" };
  assert.equal((await fake.request(changed, parent).response).ok, true);
  assert.deepEqual(fake.sent, [{ tabId: 17, message: { type: "nudenyang-embed-refresh" }, options: {} }]);
  let errorReads = 0;
  Object.defineProperty(fake.api.runtime, "lastError", {
    get() { errorReads += 1; return { message: "Receiving end does not exist." }; },
  });
  fake.pending.shift()();
  assert.equal(errorReads, 1);
  fake.api.tabs.sendMessage = () => { throw new Error("No tab with id: 17."); };
  assert.equal((await fake.request(changed, parent).response).ok, true);
});

test("한 탭에서 최대 100개 iframe만 등록한다", async () => {
  const fake = setup();
  for (let frameId = 1; frameId <= 100; frameId += 1) {
    const call = fake.status({ ...fake.sender, frameId });
    fake.pending.shift()(context);
    assert.equal((await call.response).ok, true);
  }
  const excess = fake.status({ ...fake.sender, frameId: 101 });
  assert.equal((await excess.response).code, "limited");
  assert.equal(fake.sent.length, 100);
  fake.bridge.clear(17);
  const afterClear = fake.status({ ...fake.sender, frameId: 101 });
  fake.pending.shift()(context);
  assert.equal((await afterClear.response).ok, true);
});

test("부모 새로 확인은 사라진 프레임 등록을 비우고 현재 프레임만 다시 승인한다", async () => {
  const fake = setup();
  for (let frameId = 1; frameId <= 100; frameId += 1) {
    const call = fake.status({ ...fake.sender, frameId });
    fake.pending.shift()(context);
    await call.response;
  }
  await fake.request({ type: "nudenyang-embed-parent-changed" }, { tab: { id: 17 }, frameId: 0 }).response;
  fake.pending.shift()();
  const replacement = fake.status({ ...fake.sender, frameId: 101 });
  assert.equal(fake.sent.at(-1).message.frameId, 101);
  fake.pending.shift()(context);
  assert.equal((await replacement.response).ok, true);
});

test("연결 실패는 조용한 재시도 가능 응답으로 반환한다", async () => {
  const fake = setup();
  const call = fake.status();
  fake.api.runtime.lastError = { message: "Receiving end does not exist." };
  fake.pending.shift()();
  fake.api.runtime.lastError = null;
  assert.deepEqual(await call.response, { ok: false, code: "unavailable", retryable: true });
  assert.equal(fake.bridge.handle({ type: "other-message" }, fake.sender, () => {}), false);
});
