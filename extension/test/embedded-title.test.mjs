import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createContext, runInContext } from "node:vm";
import { JSDOM } from "jsdom";
import "../embedded-title.js";

const { createEmbeddedTitleController } = globalThis.NudeNyangEmbeddedTitle;
const EMBEDDED_SOURCE = readFileSync(new URL("../embedded-title.js", import.meta.url), "utf8");
const INITIAL = "【デュエマ】新しいカードを紹介！";
const TRANSLATED = "【듀얼 마스터즈】새로운 카드를 소개합니다!";
const CONTEXT = { ok: true, enabled: true, epoch: 2, translationKey: "ko:local", targetLanguage: "ko" };

async function microtasks() {
  for (let count = 0; count < 8; count += 1) await Promise.resolve();
}

function createClock() {
  let now = 0;
  let nextId = 0;
  const scheduled = new Map();
  return {
    setTimeout(callback, delay = 0) {
      const id = ++nextId;
      scheduled.set(id, { callback, due: now + delay });
      return id;
    },
    clearTimeout(id) { scheduled.delete(id); },
    async advance(milliseconds) {
      await microtasks();
      const until = now + milliseconds;
      for (let count = 0; count < 1000; count += 1) {
        const next = [...scheduled].filter(([, entry]) => entry.due <= until)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        now = next[1].due;
        scheduled.delete(next[0]);
        next[1].callback();
        await microtasks();
      }
      now = until;
      await microtasks();
    },
  };
}

function setup(t, {
  hidden = false, topFrame = false, html, observeIntersections = false, autoInstall = false,
  url = "https://www.youtube-nocookie.com/embed/eONkwo4B8Ps?rel=0",
} = {}) {
  const dom = new JSDOM(html ?? `<div class="player">
    <a class="ytmVideoInfoVideoTitle" href="https://www.youtube.com/watch?v=eONkwo4B8Ps"><span class="ytAttributedStringHost">${INITIAL}</span></a>
    <a class="ytmVideoInfoChannelName">デュエル・マスターズ公式</a>
    <button>再生</button><img alt="カード画像"><video></video>
  </div>`, { url, pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window.document, "hidden", { configurable: true, get: () => hidden });
  window.Element.prototype.getClientRects = () => [{ width: 400, height: 32 }];
  const messages = [];
  const listeners = new Set();
  const clock = createClock();
  let throwMessage = null;
  let version = "0.7.4";
  let documentScans = 0;
  const querySelectorAll = window.document.querySelectorAll.bind(window.document);
  window.document.querySelectorAll = (...args) => {
    documentScans += 1;
    return querySelectorAll(...args);
  };
  const api = {
    runtime: {
      id: "nudenyang-test-extension",
      getManifest: () => ({ version }),
      lastError: null,
      onMessage: {
        addListener(listener) { listeners.add(listener); },
        removeListener(listener) { listeners.delete(listener); },
      },
      sendMessage(message, callback) {
        if (throwMessage) throw new Error(throwMessage);
        messages.push({ message, callback, answered: false });
      },
    },
  };
  const frameWindow = {
    top: {},
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
  };
  if (topFrame) frameWindow.top = frameWindow;
  const environment = {
    URL, chrome: api,
    window: frameWindow, document: window.document, location: window.location,
    MutationObserver: window.MutationObserver, NodeFilter: window.NodeFilter,
    getComputedStyle: window.getComputedStyle.bind(window),
    crypto: { randomUUID: () => "test-frame-document" },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  };
  let intersectionCallback;
  const observed = new Set();
  if (observeIntersections) {
    environment.IntersectionObserver = class {
      constructor(callback) { intersectionCallback = callback; }
      observe(element) { observed.add(element); }
      disconnect() { observed.clear(); }
    };
  }
  const context = autoInstall ? createContext(environment) : null;
  function reinject() {
    runInContext(EMBEDDED_SOURCE, context);
    return environment.__NudeNyangEmbeddedTitleController ?? null;
  }
  const controller = autoInstall ? reinject() : createEmbeddedTitleController(api, environment);
  t.after(() => {
    (environment.__NudeNyangEmbeddedTitleController ?? controller)?.stop();
    window.close();
  });
  const title = () => window.document.querySelector("a.ytmVideoInfoVideoTitle > span.ytAttributedStringHost, a.ytp-title-link");
  const requests = (action) => messages.filter((entry) => entry.message.action === action);
  async function respond(action, response, index = 0) {
    const entry = requests(action).filter((item) => !item.answered)[index];
    assert.ok(entry, `pending ${action} request`);
    entry.answered = true;
    entry.callback(response);
    await microtasks();
  }
  async function refresh() {
    for (const listener of listeners) listener({ type: "nudenyang-embed-refresh" }, {}, () => {});
    await microtasks();
  }
  return {
    window, api, controller, messages, listeners, clock, title, requests, respond, refresh,
    environment, reinject, documentScans: () => documentScans,
    setVersion(value) { version = value; },
    replaceRuntime({ invalidatePrevious = false } = {}) {
      const previous = api.runtime;
      api.runtime = { ...previous };
      if (invalidatePrevious) Object.defineProperty(previous, "id", {
        get() { throw new Error("Extension context invalidated."); },
      });
    },
    setHidden(value) {
      hidden = value;
      window.document.dispatchEvent(new window.Event("visibilitychange"));
    },
    throwRequests(value) { throwMessage = value; },
    intersect(isIntersecting) {
      intersectionCallback([...observed].map((target) => ({ target, isIntersecting })));
    },
  };
}

test("최상위 문서에서는 관찰자와 요청을 시작하지 않는다", (t) => {
  const fake = setup(t, { topFrame: true });
  assert.equal(fake.controller, null);
  assert.equal(fake.messages.length, 0);
  assert.equal(fake.listeners.size, 0);
});

test("allFrames 재주입은 정확한 HTTPS YouTube embed 하위 문서 밖에서 아무 작업도 하지 않는다", (t) => {
  for (const options of [
    { topFrame: true },
    { url: "https://www.youtube.com/watch?v=eONkwo4B8Ps" },
    { url: "https://www.youtube-nocookie.com/" },
    { url: "https://www.youtube.com/embed/" },
    { url: "http://www.youtube.com/embed/eONkwo4B8Ps" },
    { url: "https://youtube.com/embed/eONkwo4B8Ps" },
    { url: "https://www.youtube.com.evil.example/embed/eONkwo4B8Ps" },
    { url: "https://www.youtube.com:444/embed/eONkwo4B8Ps" },
    { url: "https://user@www.youtube.com/embed/eONkwo4B8Ps" },
    { url: "https://example.com/embed/eONkwo4B8Ps" },
  ]) {
    const fake = setup(t, { ...options, autoInstall: true });
    let stops = 0;
    fake.environment.__NudeNyangEmbeddedTitleController = { stop() { stops += 1; } };
    fake.reinject();
    assert.equal(fake.controller, null);
    assert.equal(fake.documentScans(), 0, options.url);
    assert.equal(fake.messages.length, 0, options.url);
    assert.equal(fake.listeners.size, 0, options.url);
    assert.equal(stops, 0, "out-of-scope reinjection must not inspect or stop another controller");
  }
});

test("살아 있는 동일 runtime·버전 재주입은 제목 DOM과 캐시를 그대로 유지한다", async (t) => {
  for (const host of ["www.youtube.com", "www.youtube-nocookie.com"]) {
    const fake = setup(t, { autoInstall: true, url: `https://${host}/embed/eONkwo4B8Ps` });
    await fake.respond("status", CONTEXT);
    await fake.respond("translate", { ...CONTEXT, translation: TRANSLATED });
    const node = fake.title().firstChild;
    const scans = fake.documentScans();

    assert.equal(fake.reinject(), fake.controller);
    assert.equal(fake.title().textContent, TRANSLATED);
    assert.equal(fake.title().firstChild, node);
    assert.equal(fake.documentScans(), scans, "live reinjection must not re-scan the DOM");
    assert.equal(fake.messages.length, 2);
    assert.equal(fake.listeners.size, 1);
    await fake.refresh();
    await fake.respond("status", CONTEXT);
    assert.equal(fake.title().textContent, TRANSLATED);
    assert.equal(fake.requests("translate").length, 1);
  }
});

test("동일 runtime·버전 재주입은 진행 중인 상태 확인과 번역 요청을 취소하거나 복제하지 않는다", async (t) => {
  const fake = setup(t, { autoInstall: true });
  assert.equal(fake.reinject(), fake.controller);
  assert.equal(fake.requests("status").length, 1);
  await fake.respond("status", CONTEXT);
  assert.equal(fake.reinject(), fake.controller);
  assert.equal(fake.requests("translate").length, 1);
  await fake.respond("translate", { ...CONTEXT, translation: TRANSLATED });
  assert.equal(fake.title().textContent, TRANSLATED);
  assert.equal(fake.messages.length, 2);
});

test("새 버전은 기존 컨트롤러를 교체하고 원문으로 복원한 뒤 부모 상태를 다시 확인한다", async (t) => {
  const fake = setup(t, { autoInstall: true });
  await fake.respond("status", CONTEXT);
  await fake.respond("translate", { ...CONTEXT, translation: TRANSLATED });
  fake.setVersion("0.7.5");
  const replacement = fake.reinject();
  assert.notEqual(replacement, fake.controller);
  assert.equal(fake.title().textContent, INITIAL);
  assert.equal(fake.listeners.size, 1);
  assert.equal(fake.requests("status").length, 2);
  await fake.respond("status", CONTEXT);
  assert.equal(fake.requests("translate")[1].message.title, INITIAL);
});

test("같은 버전이라도 runtime이 달라지거나 기존 컨텍스트가 무효화되면 안전하게 교체한다", async (t) => {
  for (const invalidatePrevious of [false, true]) {
    const fake = setup(t, { autoInstall: true });
    await fake.respond("status", CONTEXT);
    fake.replaceRuntime({ invalidatePrevious });
    const replacement = fake.reinject();
    assert.notEqual(replacement, fake.controller);
    assert.equal(fake.listeners.size, 1);
    await fake.respond("translate", { ...CONTEXT, translation: "오래된 결과" });
    assert.equal(fake.title().textContent, INITIAL);
    await fake.respond("status", CONTEXT);
    await fake.respond("translate", { ...CONTEXT, translation: TRANSLATED });
    assert.equal(fake.title().textContent, TRANSLATED);
  }
});

test("중지된 동일 runtime·버전 컨트롤러는 재주입으로 새로 시작할 수 있다", async (t) => {
  const fake = setup(t, { autoInstall: true });
  await fake.respond("status", CONTEXT);
  await fake.respond("translate", { ...CONTEXT, translation: TRANSLATED });
  fake.controller.stop();
  assert.equal(fake.listeners.size, 0);
  assert.notEqual(fake.reinject(), fake.controller);
  assert.equal(fake.title().textContent, INITIAL);
  assert.equal(fake.listeners.size, 1);
  assert.equal(fake.requests("status").length, 2);
});

test("부모가 켜졌음을 확인하기 전에는 원문을 보내지 않는다", async (t) => {
  const fake = setup(t);
  assert.deepEqual(fake.messages.map(({ message }) => message), [{
    type: "nudenyang-embed-request", action: "status", documentToken: "test-frame-document",
  }]);
  await fake.respond("status", { ...CONTEXT, enabled: false });
  await fake.clock.advance(10000);
  assert.equal(fake.requests("translate").length, 0);
  assert.equal(fake.title().textContent, INITIAL);
});

test("현대 YouTube 플레이어의 제목 텍스트만 번역하고 링크와 채널·버튼은 보존한다", async (t) => {
  const fake = setup(t);
  const node = fake.title().firstChild;
  const anchor = fake.title().parentElement;
  const href = anchor.href;
  await fake.respond("status", CONTEXT);
  assert.deepEqual(fake.requests("translate")[0].message, {
    type: "nudenyang-embed-request", action: "translate", documentToken: "test-frame-document",
    epoch: 2, translationKey: "ko:local", title: INITIAL,
  });
  await fake.respond("translate", { ...CONTEXT, translation: TRANSLATED });
  assert.equal(fake.title().textContent, TRANSLATED);
  assert.equal(fake.title().firstChild, node);
  assert.equal(anchor.href, href);
  assert.equal(fake.window.document.querySelector(".ytmVideoInfoChannelName").textContent, "デュエル・マスターズ公式");
  assert.equal(fake.window.document.querySelector("button").textContent, "再生");
  assert.equal(fake.window.document.querySelector("img").alt, "カード画像");
  await fake.clock.advance(1000);
  assert.equal(fake.requests("translate").length, 1, "our own text mutation must not request another translation");
});

test("기존 ytp-title-link와 인라인 제목 구조도 보존한다", async (t) => {
  const fake = setup(t, { html: '<a class="ytp-title-link" href="/watch?v=test">新しい<span>動画の紹介</span></a>' });
  const span = fake.title().querySelector("span");
  await fake.respond("status", CONTEXT);
  assert.equal(fake.requests("translate")[0].message.title, "新しい動画の紹介");
  await fake.respond("translate", { ...CONTEXT, translation: "새로운 영상 소개" });
  assert.equal(fake.title().querySelector("span"), span);
  assert.equal(fake.title().textContent, "새로운 영상 소개");
  fake.controller.stop();
  assert.equal(fake.title().textContent, "新しい動画の紹介");
  assert.equal(span.textContent, "動画の紹介");
});

test("부모 변경 알림에 즉시 원문을 복원하고 같은 번역 키는 다시 요청하지 않는다", async (t) => {
  const fake = setup(t);
  await fake.respond("status", CONTEXT);
  await fake.respond("translate", { ...CONTEXT, translation: TRANSLATED });
  await fake.refresh();
  assert.equal(fake.title().textContent, INITIAL);
  await fake.respond("status", { ...CONTEXT, enabled: false });
  await fake.refresh();
  await fake.respond("status", CONTEXT);
  assert.equal(fake.title().textContent, TRANSLATED);
  assert.equal(fake.requests("translate").length, 1);
});

test("목표 언어·엔진 키별 캐시를 분리하고 이전 키로 돌아가면 즉시 재사용한다", async (t) => {
  const fake = setup(t);
  await fake.respond("status", CONTEXT);
  await fake.respond("translate", { ...CONTEXT, translation: TRANSLATED });
  await fake.refresh();
  const english = { ...CONTEXT, epoch: 3, translationKey: "en:other-engine", targetLanguage: "en" };
  await fake.respond("status", english);
  assert.equal(fake.requests("translate")[1].message.title, INITIAL);
  await fake.respond("translate", { ...english, translation: "Introducing a new card!" });
  assert.equal(fake.title().textContent, "Introducing a new card!");
  await fake.refresh();
  await fake.respond("status", { ...CONTEXT, epoch: 4 });
  assert.equal(fake.title().textContent, TRANSLATED);
  assert.equal(fake.requests("translate").length, 2);
});

test("OFF와 겹친 늦은 번역 응답을 적용하거나 캐시에 보존하지 않는다", async (t) => {
  const fake = setup(t);
  await fake.respond("status", CONTEXT);
  await fake.refresh();
  await fake.respond("status", { ...CONTEXT, enabled: false });
  await fake.respond("translate", { ...CONTEXT, translation: TRANSLATED });
  assert.equal(fake.title().textContent, INITIAL);
  await fake.refresh();
  await fake.respond("status", CONTEXT);
  assert.equal(fake.requests("translate").length, 2);
});

test("오래된 상태 조회 응답이 최신 OFF 상태를 되돌리지 않는다", async (t) => {
  const fake = setup(t);
  await fake.refresh();
  await fake.respond("status", { ...CONTEXT, enabled: false }, 1);
  await fake.respond("status", CONTEXT);
  assert.equal(fake.requests("translate").length, 0);
});

test("번역 중에도 새 언어 상태를 확인하며 이전 언어 결과는 폐기한다", async (t) => {
  const fake = setup(t);
  await fake.respond("status", CONTEXT);
  await fake.refresh();
  const english = { ...CONTEXT, epoch: 3, translationKey: "en:local", targetLanguage: "en" };
  await fake.respond("status", english);
  assert.equal(fake.requests("translate").length, 2);
  await fake.respond("translate", { ...CONTEXT, translation: TRANSLATED });
  assert.equal(fake.title().textContent, INITIAL);
  await fake.respond("translate", { ...english, translation: "New video" });
  assert.equal(fake.title().textContent, "New video");
});

test("사이트가 제목 노드를 교체하면 새 원문만 번역하고 복원한다", async (t) => {
  const fake = setup(t);
  await fake.respond("status", CONTEXT);
  await fake.respond("translate", { ...CONTEXT, translation: TRANSLATED });
  fake.title().textContent = "次の動画タイトル";
  await fake.clock.advance(200);
  assert.equal(fake.requests("translate")[1].message.title, "次の動画タイトル");
  await fake.respond("translate", { ...CONTEXT, translation: "다음 영상 제목" });
  fake.controller.stop();
  assert.equal(fake.title().textContent, "次の動画タイトル");
});

test("숨긴 문서는 요청하지 않고 보일 때 재확인하며 숨긴 뒤의 응답도 폐기한다", async (t) => {
  const fake = setup(t, { hidden: true });
  assert.equal(fake.messages.length, 0);
  fake.setHidden(false);
  await fake.respond("status", CONTEXT);
  fake.setHidden(true);
  await fake.respond("translate", { ...CONTEXT, translation: TRANSLATED });
  await fake.clock.advance(10000);
  assert.equal(fake.title().textContent, INITIAL);
  assert.equal(fake.messages.length, 2);
  fake.setHidden(false);
  assert.equal(fake.requests("status").length, 2);
});

test("제목이 없거나 1000자를 넘거나 숨겨져 있으면 원문을 전송하지 않는다", async (t) => {
  for (const html of [
    '<div class="ytmVideoInfoChannelName">チャンネル名</div><button>再生</button>',
    `<a class="ytp-title-link">${"字".repeat(1001)}</a>`,
    '<div style="display:none"><a class="ytp-title-link">動画タイトル</a></div>',
  ]) {
    const fake = setup(t, { html });
    await fake.respond("status", CONTEXT);
    await fake.clock.advance(1000);
    assert.equal(fake.requests("translate").length, 0);
  }
});

test("일시적 상태 연결 실패에는 최대 세 번의 backoff만 사용한다", async (t) => {
  const fake = setup(t);
  for (const delay of [300, 1000, 3000]) {
    await fake.respond("status", { ok: false, code: "unavailable", retryable: true });
    await fake.clock.advance(delay);
  }
  await fake.respond("status", { ok: false, code: "unavailable", retryable: true });
  await fake.clock.advance(60000);
  assert.equal(fake.requests("status").length, 4);
  assert.equal(fake.requests("translate").length, 0);
});

test("상태 조회가 성공해도 반복 번역 실패의 backoff 횟수를 무한 초기화하지 않는다", async (t) => {
  const fake = setup(t);
  for (const delay of [300, 1000, 3000]) {
    await fake.respond("status", CONTEXT);
    await fake.respond("translate", { ok: false, code: "unavailable", retryable: true });
    await fake.clock.advance(delay);
  }
  await fake.respond("status", CONTEXT);
  await fake.respond("translate", { ok: false, code: "unavailable", retryable: true });
  await fake.clock.advance(60000);
  assert.equal(fake.requests("status").length, 4);
  assert.equal(fake.requests("translate").length, 4);
});

test("확장 컨텍스트가 무효화되면 원문을 복원하고 관찰과 재시도를 종료한다", async (t) => {
  const fake = setup(t);
  await fake.respond("status", CONTEXT);
  await fake.respond("translate", { ...CONTEXT, translation: TRANSLATED });
  fake.throwRequests("Extension context invalidated.");
  await fake.refresh();
  await fake.clock.advance(60000);
  assert.equal(fake.title().textContent, INITIAL);
  assert.equal(fake.listeners.size, 0);
  assert.equal(fake.messages.length, 2);
});

test("숨겨진 제목이 DOM 변경으로 나타나면 현재 부모 문맥으로 번역한다", async (t) => {
  const fake = setup(t, { html: '<div style="display:none"><a class="ytp-title-link">動画タイトル</a></div>' });
  await fake.respond("status", CONTEXT);
  assert.equal(fake.requests("translate").length, 0);
  fake.title().parentElement.style.display = "block";
  await fake.clock.advance(200);
  assert.equal(fake.requests("translate").length, 1);
});

test("실제 화면 진입을 확인한 제목만 전송하고 프레임 밖으로 나간 결과는 폐기한다", async (t) => {
  const fake = setup(t, { observeIntersections: true });
  await fake.respond("status", CONTEXT);
  assert.equal(fake.requests("translate").length, 0);
  fake.intersect(true);
  await fake.respond("status", CONTEXT);
  assert.equal(fake.requests("translate").length, 1);
  fake.intersect(false);
  await fake.respond("translate", { ...CONTEXT, translation: TRANSLATED });
  assert.equal(fake.title().textContent, INITIAL);
  fake.intersect(true);
  await fake.respond("status", CONTEXT);
  assert.equal(fake.requests("translate").length, 2);
});

test("제목에 섞인 숨김 텍스트와 버튼·입력 값은 제외한다", async (t) => {
  const fake = setup(t, { html: '<a class="ytp-title-link">動画<span hidden>秘密</span><span style="display:none">隠した文字</span><button>再生</button><input value="秘密入力"></a>' });
  await fake.respond("status", CONTEXT);
  assert.equal(fake.requests("translate")[0].message.title, "動画");
  await fake.respond("translate", { ...CONTEXT, translation: "영상" });
  assert.equal(fake.title().querySelector("[hidden]").textContent, "秘密");
  assert.equal(fake.title().querySelector("button").textContent, "再生");
  assert.equal(fake.title().querySelector("input").value, "秘密入力");
});

test("부모 알림 수신에 응답해 정상 프레임이 연결 끊김으로 오인되지 않게 한다", async (t) => {
  const fake = setup(t);
  let response;
  for (const listener of fake.listeners) {
    listener({ type: "nudenyang-embed-refresh" }, {}, (value) => { response = value; });
  }
  assert.deepEqual(response, { ok: true });
});

test("제목 번역을 마친 뒤에는 상태를 주기적으로 재조회하지 않는다", async (t) => {
  const fake = setup(t);
  await fake.respond("status", CONTEXT);
  await fake.respond("translate", { ...CONTEXT, translation: TRANSLATED });
  await fake.clock.advance(300000);
  assert.equal(fake.requests("status").length, 1);
  assert.equal(fake.requests("translate").length, 1);
  assert.equal(fake.title().textContent, TRANSLATED);
  await fake.refresh();
  await fake.respond("status", CONTEXT);
  await fake.clock.advance(300000);
  assert.equal(fake.requests("status").length, 2, "only the explicit parent event should refresh status");
  assert.equal(fake.requests("translate").length, 1, "the cached title must not be retransmitted");
});

test("긴 제목 번역을 기다리는 중에도 5초 상태 폴링을 시작하지 않는다", async (t) => {
  const fake = setup(t);
  await fake.respond("status", CONTEXT);
  await fake.clock.advance(60000);
  assert.equal(fake.requests("status").length, 1);
  assert.equal(fake.requests("translate").length, 1);
  assert.equal(fake.title().textContent, INITIAL);
  await fake.respond("translate", { ...CONTEXT, translation: TRANSLATED });
  await fake.clock.advance(60000);
  assert.equal(fake.requests("status").length, 1);
  assert.equal(fake.requests("translate").length, 1);
  assert.equal(fake.title().textContent, TRANSLATED);
});
