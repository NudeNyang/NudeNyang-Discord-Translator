import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../messenger-privacy.js", import.meta.url), "utf8");
const adapterSource = fs.readFileSync(new URL("../messenger-adapters.js", import.meta.url), "utf8");

function setup({ consent = 0, firefox = false, permission = false, settings = {}, translator = "hymt_1_8b" } = {}) {
  const storage = { messengerConsentVersion: consent };
  const calls = [];
  const state = { permission, settings, translator };
  const api = {
    runtime: { id: "test-extension", getURL: (path) => `chrome-extension://test-extension/${path}` },
    storage: { local: {
      get(defaults, callback) { callback({ ...defaults, ...storage }); },
      set(value, callback) { Object.assign(storage, value); callback?.(); },
    } },
    permissions: { async getAll() { return { data_collection: state.permission ? ["personalCommunications"] : [] }; } },
  };
  const context = { URL, Set, chrome: api };
  vm.runInNewContext(adapterSource, context);
  vm.runInNewContext(source, context);
  const privacy = context.NudeNyangMessengerPrivacy.createMessengerPrivacy(api, { firefox });
  const native = async (request) => {
    calls.push(request);
    if (request.type === "status") return { type: "status", translator: state.translator,
      webSettings: { enabled: true, messengerEnabled: true, ...state.settings } };
    return { type: "translated", items: [{ id: "body", text: "번역문" }] };
  };
  const sender = { id: api.runtime.id, tab: { id: 8 }, frameId: 0, url: "https://discord.com/channels/@me/123456789" };
  const owner = { id: api.runtime.id, url: api.runtime.getURL("messenger-privacy.html") };
  const request = { type: "translate", requestId: "private-test", pageId: "messenger:discord:0123456789abcdef",
    privateContext: { service: "discord", consentVersion: 1 }, items: [{ id: "body", text: "Private example" }] };
  return { privacy, storage, calls, state, native, sender, owner, request, api };
}

function pauseConsentRead(s, targetRead) {
  const read = s.api.storage.local.get;
  let reads = 0;
  let resume;
  const paused = new Promise((resolve) => {
    s.api.storage.local.get = (defaults, callback) => {
      reads += 1;
      if (reads !== targetRead) return read(defaults, callback);
      resume = () => read(defaults, callback);
      resolve();
    };
  });
  return { paused, resume: () => resume() };
}

test("메신저 동의는 기본 꺼짐이며 웹 페이지 메시지로 켤 수 없다", async () => {
  const s = setup();
  assert.equal((await s.privacy.getConsent()).granted, false);
  assert.equal((await s.privacy.setConsent(true, s.sender)).ok, false);
  assert.equal(s.storage.messengerConsentVersion, 0);
  assert.equal((await s.privacy.forward(s.request, s.sender, s.native)).code, "messenger_consent_required");
  assert.equal(s.calls.length, 0);
});

test("동의 페이지에서만 브라우저 설정을 기록하고 메시지는 저장하지 않는다", async () => {
  const s = setup();
  assert.equal((await s.privacy.setConsent(true, s.owner)).granted, true);
  const result = await s.privacy.forward(s.request, s.sender, s.native);
  assert.equal(result.type, "translated");
  assert.deepEqual(s.calls.map((r) => r.type), ["status", "translate"]);
  assert.deepEqual(s.storage, { messengerConsentVersion: 1 });
  assert.equal(s.calls[1].pageId.includes("conversation"), false);
});

test("메인 권한·로컬 엔진·최신 브리지 모두 확인하기 전에는 본문을 전달하지 않는다", async () => {
  for (const options of [
    { settings: { messengerEnabled: false }, code: "messenger_disabled" },
    { settings: { messengerEnabled: undefined }, code: "messenger_disabled" },
    { settings: { enabled: false }, code: "web_translation_disabled" },
    { translator: "deepl", code: "messenger_local_only" },
    { translator: "unknown-provider", code: "messenger_local_only" },
  ]) {
    const s = setup({ consent: 1, ...options });
    assert.equal((await s.privacy.forward(s.request, s.sender, s.native)).code, options.code);
    assert.deepEqual(s.calls.map((r) => r.type), ["status"]);
  }
});

test("개인 경로를 일반 번역으로 우회하거나 URL·서비스·프레임을 위조할 수 없다", async () => {
  const s = setup({ consent: 1 });
  for (const [request, sender] of [
    [{ ...s.request, privateContext: undefined }, s.sender],
    [{ ...s.request, pageId: "discord:https://discord.com/channels/@me/123" }, s.sender],
    [{ ...s.request, privateContext: { service: "x", consentVersion: 1 } }, s.sender],
    [{ ...s.request, privateContext: { service: "discord", consentVersion: "1" } }, s.sender],
    [s.request, { ...s.sender, frameId: 3 }],
    [s.request, { ...s.sender, url: "https://discord.com.attacker.example/channels/123" }],
    [s.request, { ...s.sender, url: "http://discord.com/channels/123" }],
    [s.request, { ...s.sender, url: "https://user:password@discord.com/channels/123" }],
  ]) assert.equal((await s.privacy.forward(request, sender, s.native)).code, "messenger_invalid_context");
  assert.equal(s.calls.length, 0);
});

test("공개 페이지는 기존 경로를 유지하며 X의 공개 페이지 위 DMDrawer는 사적 경로로 처리한다", async () => {
  const s = setup({ consent: 1 });
  const publicRequest = { type: "translate", items: [] };
  assert.equal((await s.privacy.forward(publicRequest, { ...s.sender, url: "https://example.com/article" }, s.native)).type, "translated");
  assert.equal(s.calls.length, 1);
  const request = { ...s.request, privateContext: { service: "x", consentVersion: 1 }, pageId: "messenger:x:0123456789abcdef" };
  assert.equal((await s.privacy.forward(request, { ...s.sender, url: "https://x.com/home" }, s.native)).type, "translated");
});

test("메신저의 로그인·목록·검색·미지원 경로는 일반 웹 번역으로 우회하지 않는다", async () => {
  const routes = [
    ["discord", "https://discord.com/login"],
    ["discord", "https://discord.com/channels/@me"],
    ["x", "https://x.com/i/chat/compose"],
    ["x", "https://x.com/messages/123/unsupported"],
    ["slack", "https://app.slack.com/client/TABC/search"],
    ["whatsapp", "https://web.whatsapp.com/login"],
    ["telegram", "https://web.telegram.org/k/#/settings"],
    ["messenger", "https://www.messenger.com/requests"],
    ["teams", "https://teams.microsoft.com/v2/#/calendar"],
    ["google-messages", "https://messages.google.com/web/authentication"],
  ];
  for (const [service, url] of routes) {
    for (const consent of [0, 1]) {
      const s = setup({ consent });
      const sender = { ...s.sender, url };
      const publicRequest = { type: "translate", pageId: url, items: s.request.items };
      assert.equal((await s.privacy.forward(publicRequest, sender, s.native)).code, "messenger_invalid_context", url);
      const privateRequest = { ...s.request, pageId: `messenger:${service}:0123456789abcdef`,
        privateContext: { service, consentVersion: 1 } };
      assert.equal((await s.privacy.forward(privateRequest, sender, s.native)).code, "messenger_invalid_context", url);
      assert.equal(s.calls.length, 0, url);
    }
  }
});

test("X 설정 화면은 공개 타임라인의 DMDrawer 예외를 이용할 수 없다", async () => {
  const s = setup({ consent: 1 });
  const request = { ...s.request, pageId: "messenger:x:0123456789abcdef", privateContext: { service: "x", consentVersion: 1 } };
  for (const url of ["https://x.com/settings/account", "https://x.com/i/flow/login", "https://twitter.com/search?q=test"]) {
    assert.equal((await s.privacy.forward(request, { ...s.sender, url }, s.native)).code, "messenger_invalid_context");
  }
  assert.equal(s.calls.length, 0);
});

test("Firefox의 personalCommunications 권한이 없거나 철회되면 저장된 동의로 우회하지 않는다", async () => {
  const s = setup({ consent: 1, firefox: true });
  assert.equal((await s.privacy.getConsent()).granted, false);
  assert.equal((await s.privacy.setConsent(true, s.owner)).granted, false);
  s.state.permission = true;
  assert.equal((await s.privacy.setConsent(true, s.owner)).granted, true);
  s.state.permission = false;
  assert.equal((await s.privacy.forward(s.request, s.sender, s.native)).code, "messenger_consent_required");
});

test("전송 대기 및 번역 중 동의 철회는 늦은 결과도 폐기한다", async () => {
  const s = setup({ consent: 1 });
  let resume;
  const pending = s.privacy.forward(s.request, s.sender, async (request) => {
    const result = await s.native(request);
    if (request.type === "translate") await new Promise((resolve) => { resume = resolve; });
    return result;
  });
  for (let i = 0; i < 10 && !resume; i += 1) await Promise.resolve();
  assert.ok(resume);
  await s.privacy.setConsent(false, s.owner);
  await s.privacy.setConsent(true, s.owner);
  resume();
  assert.equal((await pending).code, "messenger_request_cancelled");
});

test("본문 전송 직전 동의 조회 중 OFF→ON으로 바뀌면 이전 요청을 전달하지 않는다", { timeout: 2000 }, async () => {
  const s = setup({ consent: 1 });
  const read = pauseConsentRead(s, 2);
  const pending = s.privacy.forward(s.request, s.sender, s.native);
  await read.paused;
  await s.privacy.setConsent(false, s.owner);
  await s.privacy.setConsent(true, s.owner);
  read.resume();
  assert.equal((await pending).code, "messenger_consent_required");
  assert.deepEqual(s.calls.map((request) => request.type), ["status"]);
});

test("결과 반환 직전 동의 조회 중 OFF→ON으로 바뀌면 이전 번역문을 반환하지 않는다", { timeout: 2000 }, async () => {
  const s = setup({ consent: 1 });
  const read = pauseConsentRead(s, 3);
  const pending = s.privacy.forward(s.request, s.sender, s.native);
  await read.paused;
  await s.privacy.setConsent(false, s.owner);
  await s.privacy.setConsent(true, s.owner);
  read.resume();
  const result = await pending;
  assert.equal(result.code, "messenger_request_cancelled");
  assert.equal(result.items, undefined);
  assert.deepEqual(s.calls.map((request) => request.type), ["status", "translate"]);
});
