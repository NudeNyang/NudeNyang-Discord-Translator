import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../global-state.js", import.meta.url), "utf8");
function setup(saved = {}) {
  const opened = [], writes = [];
  const api = { runtime: { id: "test", getURL: path => `chrome-extension://test/${path}` },
    tabs: { create(details, callback) { opened.push(details); callback({ id: 1 }); } },
    storage: { local: {
      get(defaults, callback) { queueMicrotask(() => callback({ ...defaults, ...saved })); },
      set(patch, callback) { writes.push({ ...patch }); Object.assign(saved, patch); queueMicrotask(callback); },
    } },
  };
  const context = { queueMicrotask }; vm.runInNewContext(source, context);
  const create = () => context.NudeNyangGlobalTranslationState.createGlobalTranslationState(api);
  return { state: create(), create, api, saved, opened, writes,
    sender: { id: "test", url: "chrome-extension://test/messenger-privacy.html?scope=web" } };
}

test("이전 탭·사이트 켜짐과 메신저 동의는 전체 자동 번역 동의로 승격하지 않는다", async () => {
  const p = setup({ enabled: true, messengerConsentVersion: 3, "nudenyang-tab-enabled:7": true, webTranslationEnabled: true });
  assert.equal((await p.state.get()).enabled, false);
  assert.equal((await p.state.set(true)).needsConsent, true);
  assert.equal(p.writes.length, 0);
  assert.equal(p.opened[0].url, "chrome-extension://test/messenger-privacy.html?scope=web");
  assert.equal(p.opened[0].active, true);
});

test("확장 개인정보 페이지의 명시적 동의만 전체 번역을 켠다", async () => {
  const p = setup();
  for (const sender of [{}, { id: "test", url: "https://example.test/" }, { id: "other", url: p.sender.url }]) {
    assert.equal((await p.state.consent(true, sender)).ok, false);
  }
  assert.equal(p.writes.length, 0);
  assert.equal((await p.state.consent(true, p.sender)).enabled, true);
  assert.equal((await p.create().get()).enabled, true, "worker restart reads persistent state");
  assert.equal(p.saved.messengerConsentVersion, undefined, "public consent cannot grant messenger consent");
});

test("여러 탭의 연속 토글을 직렬화하고 마지막 OFF를 재시작에도 보존한다", async () => {
  const p = setup({ webTranslationConsentVersion: 1, webTranslationEnabled: false });
  await Promise.all([p.state.set("toggle"), p.state.set("toggle")]);
  assert.deepEqual(p.writes.map(patch => patch.webTranslationEnabled), [true, false]);
  assert.equal((await p.create().get()).enabled, false);
  assert.ok(p.state.revision >= 2);
});

test("철회는 전체 번역을 끄되 별도 메신저 동의나 본문 캐시는 임의로 변경하지 않는다", async () => {
  const p = setup({ webTranslationConsentVersion: 1, webTranslationEnabled: true, messengerConsentVersion: 3 });
  const before = p.state.revision;
  assert.equal((await p.state.consent(false, p.sender)).enabled, false);
  assert.equal((await p.create().get()).consent, false);
  assert.equal(p.saved.messengerConsentVersion, 3);
  assert.ok(p.state.revision > before);
});

test("저장소 읽기에 실패하면 자동 번역을 허용하지 않는다", async () => {
  const p = setup({ webTranslationEnabled: true, webTranslationConsentVersion: 1 });
  p.api.storage.local.get = () => { throw new Error("unavailable"); };
  assert.equal((await p.state.get()).enabled, false);
});

test("OFF 저장이 실패해도 현재 세션에서는 번역을 중단하고 실패를 보고한다", async () => {
  const p = setup({ webTranslationEnabled: true, webTranslationConsentVersion: 1 });
  p.api.storage.local.set = () => { throw new Error("disk unavailable"); };
  const off = await p.state.set(false);
  assert.equal(off.ok, false);
  assert.equal(off.enabled, false);
  assert.equal((await p.state.get()).enabled, false);
});
