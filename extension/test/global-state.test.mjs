import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../global-state.js", import.meta.url), "utf8");
function setup(saved = {}, permission = true) {
  const opened = [], writes = [];
  const api = { runtime: { id: "test", getURL: path => `chrome-extension://test/${path}` },
    tabs: { create(details, callback) { opened.push(details); callback({ id: 1 }); } },
    storage: { local: {
      get(defaults, callback) { queueMicrotask(() => callback({ ...defaults, ...saved })); },
      set(patch, callback) { writes.push({ ...patch }); Object.assign(saved, patch); queueMicrotask(callback); },
    } },
  };
  const context = { queueMicrotask }; vm.runInNewContext(source, context);
  const messengerPrivacy = {
    dataPermissionGranted: async () => permission,
    getConsent: async () => ({ ok: true, granted: permission && saved.messengerConsentVersion === 3 }),
  };
  const create = () => context.NudeNyangGlobalTranslationState.createGlobalTranslationState(api, { messengerPrivacy });
  return { state: create(), create, api, saved, opened, writes,
    sender: { id: "test", url: "chrome-extension://test/messenger-privacy.html?scope=web" } };
}

test("이전 탭·사이트 켜짐과 메신저 동의는 전체 자동 번역 동의로 승격하지 않는다", async () => {
  const p = setup({ enabled: true, messengerConsentVersion: 3, "nudenyang-tab-enabled:7": true, webTranslationEnabled: true });
  assert.equal((await p.state.get()).enabled, false);
  assert.equal((await p.state.set(true)).needsConsent, true);
  assert.equal(p.writes.length, 0);
  assert.equal(p.opened[0].url, "chrome-extension://test/messenger-privacy.html");
  assert.equal(p.opened[0].active, true);
});

test("통합 동의는 웹·메신저 범위를 한 번에 저장하고 철회는 모두 끈다", async () => {
  const p = setup();
  assert.equal((await p.state.privacyConsent(true, p.sender)).granted, true);
  assert.deepEqual(p.writes, [{ webTranslationConsentVersion: 1, webTranslationEnabled: true, messengerConsentVersion: 3 }]);
  assert.equal((await p.create().privacyState()).granted, true);
  assert.equal((await p.state.privacyConsent(false, p.sender)).anyGranted, false);
  assert.equal(p.saved.messengerConsentVersion, 0);
  assert.equal((await p.create().get()).enabled, false);
});

test("통합 화면은 기존 부분 동의를 확대하지 않고 양쪽 동의가 있으면 재승인하지 않는다", async () => {
  for (const saved of [{ messengerConsentVersion: 3 }, { webTranslationConsentVersion: 1 }]) {
    const p = setup(saved);
    const state = await p.state.privacyState();
    assert.equal(state.granted, false);
    assert.equal(state.anyGranted, true);
    assert.equal(p.writes.length, 0);
  }
  const p = setup({ messengerConsentVersion: 3, webTranslationConsentVersion: 1, webTranslationEnabled: false });
  assert.equal((await p.state.privacyState()).granted, true);
  assert.equal((await p.state.get()).enabled, false);
  assert.equal(p.writes.length, 0);
});

test("Firefox 메신저 권한이 없으면 통합 승인 뒤에도 메신저만 차단하고 웹 동의는 저장한다", async () => {
  const p = setup({}, false);
  const result = await p.state.privacyConsent(true, p.sender);
  assert.equal(result.ok, true);
  assert.equal(result.webGranted, true);
  assert.equal(result.messengerGranted, false);
  assert.equal(result.granted, false);
  assert.equal((await p.state.get()).enabled, true);
  assert.equal(p.saved.messengerConsentVersion, 0);
});

test("Firefox 권한을 잃어도 기존 메신저 동의 기록은 통합 화면에서 철회할 수 있다", async () => {
  const p = setup({ messengerConsentVersion: 3 }, false);
  const state = await p.state.privacyState();
  assert.equal(state.granted, false);
  assert.equal(state.anyGranted, true);
  assert.equal((await p.state.privacyConsent(false, p.sender)).anyGranted, false);
  assert.equal(p.saved.messengerConsentVersion, 0);
});

test("통합 동의는 웹페이지 발신자를 거절하고 저장 실패 시 성공을 보고하지 않는다", async () => {
  const p = setup();
  assert.equal((await p.state.privacyConsent(true, { id: "test", url: "https://example.test/" })).ok, false);
  assert.equal(p.writes.length, 0);
  p.api.storage.local.set = () => { throw new Error("disk unavailable"); };
  assert.equal((await p.state.privacyConsent(true, p.sender)).ok, false);
  assert.equal((await p.state.get()).enabled, false);
});

test("통합 철회 저장 실패도 현재 세션의 전체 전송을 막는다", async () => {
  const p = setup({ webTranslationConsentVersion: 1, webTranslationEnabled: true, messengerConsentVersion: 3 });
  p.api.storage.local.set = () => { throw new Error("disk unavailable"); };
  assert.equal((await p.state.privacyConsent(false, p.sender)).ok, false);
  assert.equal((await p.state.get()).enabled, false);
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
