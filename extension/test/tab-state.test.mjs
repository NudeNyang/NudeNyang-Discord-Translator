import assert from "node:assert/strict";
import test from "node:test";
import "../tab-state.js";

const { createTabTranslationState } = globalThis.NudeNyangTabTranslationState;

function fakeApi() {
  const values = {};
  return {
    storage: {
      session: {
        get(defaults, callback) {
          callback({ ...defaults, ...values });
        },
        set(update, callback) {
          Object.assign(values, update);
          callback();
        },
        remove(key, callback) {
          delete values[key];
          callback();
        },
      },
    },
  };
}

function withTabs(api, tabs, origins = {}) {
  const reads = [];
  const messages = [];
  api.runtime = {};
  api.tabs = {
    get(tabId, callback) {
      reads.push(tabId);
      const tab = tabs.find((candidate) => candidate.id === tabId);
      if (!tab) api.runtime.lastError = { message: "No tab with this id." };
      callback(tab);
      delete api.runtime.lastError;
    },
    sendMessage(tabId, message, options, callback) {
      messages.push({ tabId, message, options });
      callback(origins[tabId] ? { origin: origins[tabId] } : undefined);
    },
  };
  return { reads, messages };
}

function deferStorageRead(api) {
  const read = api.storage.session.get;
  let release;
  api.storage.session.get = (defaults, callback) => {
    read(defaults, (values) => {
      release = () => callback(values);
    });
  };
  return () => release();
}

test("탭 번역 상태는 백그라운드가 다시 만들어져도 세션 저장소에서 복원된다", async () => {
  const api = fakeApi();
  const first = createTabTranslationState(api);
  assert.equal(await first.get(17), null);
  assert.equal(await first.set(17, true), true);
  assert.equal(await first.set(23, false), false);

  const restored = createTabTranslationState(api);
  assert.equal(await restored.get(17), true);
  assert.equal(await restored.get(23), false);
});

test("탭을 닫으면 저장된 번역 상태를 제거한다", async () => {
  const api = fakeApi();
  const state = createTabTranslationState(api);
  await state.set(31, true);
  await state.clear(31);
  assert.equal(await createTabTranslationState(api).get(31), null);
});

test("이전 세션 읽기가 늦게 끝나도 방금 끈 명시 상태를 덮어쓰지 않는다", async () => {
  const api = fakeApi();
  await createTabTranslationState(api).set(17, true);
  const release = deferStorageRead(api);
  const state = createTabTranslationState(api);
  const pendingRead = state.get(17);
  await state.set(17, false);
  release();
  assert.equal(await pendingRead, false);
  assert.equal(await state.get(17), false);
});

test("닫힌 탭의 이전 세션 읽기가 끝나도 삭제한 상태를 되살리지 않는다", async () => {
  const api = fakeApi();
  await createTabTranslationState(api).set(17, true);
  const release = deferStorageRead(api);
  const state = createTabTranslationState(api);
  const pendingRead = state.get(17);
  await state.clear(17);
  release();
  assert.equal(await pendingRead, null);
});

test("같은 탭의 저장과 삭제는 요청 순서대로 완료되어 닫힌 탭 상태가 남지 않는다", async () => {
  const api = fakeApi();
  const originalSet = api.storage.session.set;
  const writes = [];
  let releaseSet;
  api.storage.session.set = (update, callback) => {
    writes.push("set");
    releaseSet = () => originalSet(update, callback);
  };
  const originalRemove = api.storage.session.remove;
  api.storage.session.remove = (key, callback) => {
    writes.push("remove");
    originalRemove(key, callback);
  };
  const state = createTabTranslationState(api);
  const pendingSet = state.set(17, true);
  await Promise.resolve();
  const pendingClear = state.clear(17);
  await Promise.resolve();
  assert.deepEqual(writes, ["set"]);
  assert.equal(await state.get(17), null);
  releaseSet();
  await Promise.all([pendingSet, pendingClear]);
  assert.deepEqual(writes, ["set", "remove"]);
  assert.equal(await createTabTranslationState(api).get(17), null);
});

test("연속 토글의 세션 저장을 직렬화하여 마지막 토글을 유지한다", async () => {
  const api = fakeApi();
  const originalSet = api.storage.session.set;
  const writes = [];
  const releases = [];
  api.storage.session.set = (update, callback) => {
    writes.push(Object.values(update)[0]);
    releases.push(() => originalSet(update, callback));
  };
  const state = createTabTranslationState(api);
  const first = state.set(17, true);
  await Promise.resolve();
  const second = state.set(17, false);
  await Promise.resolve();
  assert.deepEqual(writes, [true]);
  assert.equal(await state.get(17), false);
  releases.shift()();
  await first;
  await Promise.resolve();
  assert.deepEqual(writes, [true, false]);
  releases.shift()();
  await second;
  assert.equal(await createTabTranslationState(api).get(17), false);
});

for (const enabled of [true, false]) {
  test(`같은 출처의 새 팝업은 부모의 명시 ${enabled ? "켜짐" : "꺼짐"} 상태를 상속한다`, async () => {
    const api = fakeApi();
    const child = { id: 23, openerTabId: 17, url: "https://dm.takaratomy.co.jp/card/detail/?id=example" };
    const calls = withTabs(api, [
      { id: 17, url: "https://dm.takaratomy.co.jp/card/" },
      child,
    ]);
    await createTabTranslationState(api).set(17, enabled);
    const state = createTabTranslationState(api);
    assert.equal(await state.getForTab(child, child.url), enabled);
    assert.equal(await state.get(23), enabled);
    assert.equal(await createTabTranslationState(api).get(23), enabled);
    assert.deepEqual(calls.reads, [17]);
  });
}

test("자식 탭의 명시 상태가 이미 있으면 부모 정보도 조회하지 않는다", async () => {
  const api = fakeApi();
  const calls = withTabs(api, [{ id: 17, url: "https://example.com/" }]);
  const state = createTabTranslationState(api);
  await state.set(17, true);
  await state.set(23, false);
  assert.equal(await state.getForTab({ id: 23, openerTabId: 17, url: "https://example.com/popup" }), false);
  assert.deepEqual(calls.reads, []);
});

test("부모에 명시 상태가 없으면 사이트 기본값을 팝업의 명시 상태로 만들지 않는다", async () => {
  const api = fakeApi();
  withTabs(api, [{ id: 17, url: "https://example.com/" }]);
  const state = createTabTranslationState(api);
  assert.equal(await state.getForTab({ id: 23, openerTabId: 17, url: "https://example.com/popup" }), null);
  assert.equal(await createTabTranslationState(api).get(23), null);
});

for (const [parentUrl, childUrl] of [
  ["https://example.com/", "https://other.example/popup"],
  ["https://example.com/", "http://example.com/popup"],
  ["https://example.com/", "https://example.com:8443/popup"],
  ["about:blank", "https://example.com/popup"],
  ["https://example.com/", "about:blank"],
  ["file:///C:/example.html", "file:///C:/popup.html"],
  [undefined, "https://example.com/popup"],
  ["https://example.com/", undefined],
]) {
  test(`출처를 확인할 수 없거나 다른 출처인 팝업은 상태를 상속하지 않는다: ${parentUrl} → ${childUrl}`, async () => {
    const api = fakeApi();
    withTabs(api, [{ id: 17, url: parentUrl, pendingUrl: "https://example.com/" }]);
    const state = createTabTranslationState(api);
    await state.set(17, true);
    assert.equal(await state.getForTab({ id: 23, openerTabId: 17, url: childUrl }), null);
    assert.equal(await state.get(23), null);
  });
}

test("sender.tab에 opener가 생략된 경우에만 해당 자식 탭을 추가 조회한다", async () => {
  const api = fakeApi();
  const calls = withTabs(api, [
    { id: 17, url: "https://example.com/" },
    { id: 23, openerTabId: 17, url: "https://example.com/popup" },
  ]);
  const state = createTabTranslationState(api);
  await state.set(17, true);
  assert.equal(await state.getForTab({ id: 23 }, "https://example.com/popup"), true);
  assert.deepEqual(calls.reads, [23, 17]);
});

test("sender의 실제 문서 URL을 오래된 tab URL보다 우선하여 출처를 판정한다", async () => {
  const api = fakeApi();
  withTabs(api, [{ id: 17, url: "https://example.com/" }]);
  const state = createTabTranslationState(api);
  await state.set(17, true);
  assert.equal(await state.getForTab(
    { id: 23, openerTabId: 17, url: "https://example.com/popup" },
    "https://other.example/redirected",
  ), null);
});

test("부모 URL 권한이 없는 경우 부모의 최상위 content script에서 현재 출처만 확인한다", async () => {
  const api = fakeApi();
  const calls = withTabs(api, [{ id: 17 }], { 17: "https://example.com" });
  const state = createTabTranslationState(api);
  await state.set(17, true);
  assert.equal(await state.getForTab({ id: 23, openerTabId: 17 }, "https://example.com/popup"), true);
  assert.deepEqual(calls.messages, [{
    tabId: 17,
    message: { type: "nudenyang-status" },
    options: { frameId: 0 },
  }]);
});

test("부모 URL이 다른 출처로 확인된 경우 content 응답으로 우회하지 않는다", async () => {
  const api = fakeApi();
  const calls = withTabs(api, [{ id: 17, url: "https://other.example/" }], { 17: "https://example.com" });
  const state = createTabTranslationState(api);
  await state.set(17, true);
  assert.equal(await state.getForTab({ id: 23, openerTabId: 17 }, "https://example.com/popup"), null);
  assert.deepEqual(calls.messages, []);
});

test("닫힌 부모나 유효하지 않은 opener는 상태를 상속하지 않는다", async () => {
  const api = fakeApi();
  withTabs(api, []);
  const state = createTabTranslationState(api);
  await state.set(17, true);
  assert.equal(await state.getForTab({ id: 23, openerTabId: 17 }, "https://example.com/popup"), null);
  assert.equal(await state.getForTab({ id: 23, openerTabId: 23 }, "https://example.com/popup"), null);
  assert.equal(await state.getForTab({ id: 23, openerTabId: -1 }, "https://example.com/popup"), null);
  assert.equal(await state.getForTab(undefined, "https://example.com/popup"), null);
});

for (const action of ["set", "clear"]) {
  test(`부모 조회 도중 자식의 ${action}가 실행되면 상속으로 덮어쓰거나 되살리지 않는다`, async () => {
    const api = fakeApi();
    withTabs(api, []);
    let entered;
    const lookupStarted = new Promise((resolve) => { entered = resolve; });
    let releaseLookup;
    api.tabs.get = (_tabId, callback) => {
      releaseLookup = () => callback({ id: 17, url: "https://example.com/" });
      entered();
    };
    const state = createTabTranslationState(api);
    await state.set(17, true);
    const inherited = state.getForTab({ id: 23, openerTabId: 17 }, "https://example.com/popup");
    await lookupStarted;
    if (action === "set") await state.set(23, false);
    else await state.clear(23);
    releaseLookup();
    const expected = action === "set" ? false : null;
    assert.equal(await inherited, expected);
    assert.equal(await createTabTranslationState(api).get(23), expected);
  });
}
