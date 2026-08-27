import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { browserConnectionState, createBrowserConnections } from "../browser-connections.mjs";

const flush = () => new Promise(resolve => setImmediate(resolve));

const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const appScript = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("연결 신호를 받으면 버튼 클릭 없이 즉시 갱신하고 명시적 해제는 유지한다", async () => {
  const h = harness();
  await h.view.refresh();
  let listener;
  let visible = true;
  const source = appScript.match(/tauriListen\("browser-clients-changed", \(\) => \{[\s\S]*?\n  \}\);/);
  assert.ok(source, "listen to native connection changes instead of waiting for a button");
  vm.runInNewContext(source[0], {
    tauriListen(_name, callback) { listener = callback; },
    webSettingsPanelIsVisible: () => visible,
    loadBrowserClients: () => h.view.refresh(),
  });
  h.setClients([{ browser: "chrome", lastSeenAt: 999_999 }]);
  await listener();
  assert.equal(h.row("chrome").dataset.state, "connected");
  h.setInstallations([{ browser: "chrome", installed: true, storeAvailable: true, connectionEnabled: false }]);
  await listener();
  assert.equal(h.row("chrome").dataset.state, "disabled");
  assert.ok(h.calls.every(call => ["browser_clients_status", "browser_installations"].includes(call.command)));
  const before = h.calls.length;
  visible = false;
  await listener();
  assert.equal(h.calls.length, before);
});

test("브라우저마다 연결 또는 해제 버튼 하나만 표시한다", async () => {
  const h = harness();
  await h.view.refresh();
  for (const browser of ["chrome", "whale", "firefox"]) {
    assert.equal(h.row(browser).querySelectorAll("button").length, 1);
  }
  const action = h.row("chrome").querySelector("button");
  assert.equal(action.dataset.action, "connect");
  assert.ok(action.classList.contains("provider-action"));
  h.setClients([{ browser: "chrome", extensionVersion: "0.7.8", lastSeenAt: 999_999 }]);
  await h.view.refresh();
  assert.equal(h.row("chrome").querySelector("button"), action);
  assert.equal(action.dataset.action, "disconnect");
  assert.ok(action.classList.contains("provider-disconnect"));
  action.click();
  await flush();
  assert.ok(h.calls.some(call => call.command === "browser_disconnect" && call.payload.browser === "chrome"));
});

test("웹 설정, 브라우저 연결, 사이트별 동작 순서이며 메신저 설명은 짧게 유지한다", () => {
  const document = new JSDOM(markup).window.document;
  const panel = document.querySelector('[data-settings-view="web"]');
  const content = [...panel.children].filter(element => !element.classList.contains("panel-heading"));
  assert.ok(content[0].classList.contains("web-settings-card"));
  assert.ok(content[1].classList.contains("web-browser-setup"));
  assert.equal(content[2].getAttribute("aria-labelledby"), "web-sites-heading");
  assert.equal(document.querySelector("#web-translation-enabled").getAttribute("aria-checked"), "false");
  assert.ok(document.querySelector("#web-messenger-description").textContent.length < 40);
});

test("웹 번역을 켜면 설치 안내를 표시하고 중복 클릭·끄기·저장 실패에는 안내하지 않는다", async () => {
  const document = new JSDOM(markup).window.document;
  const button = document.querySelector("#web-translation-enabled");
  const state = { config: { web_translation_enabled: false } };
  let listener;
  const patches = [];
  const dialogs = [];
  const errors = [];
  let resolveDialog;
  let rejectSave = false;
  let scrolled = 0;
  const context = vm.createContext({
    elements: {
      webTranslationEnabled: button,
      webBrowserClients: { scrollIntoView() { scrolled++; } },
    },
    state,
    setSwitch(element, value) { element.setAttribute("aria-checked", String(value)); },
    async applySettingsPatch(patch) {
      if (rejectSave) throw new Error("save failed");
      patches.push({ ...patch });
      Object.assign(state.config, patch);
    },
    showModal(options) { dialogs.push(options); return new Promise(resolve => { resolveDialog = resolve; }); },
    async showError(...args) { errors.push(args); },
    async loadBrowserClients() {},
    browserConnections: { needsSetup: () => true },
  });
  button.addEventListener = (_type, callback) => { listener = callback; };
  vm.runInContext(appScript.match(/elements\.webTranslationEnabled\.addEventListener\("click", async \(\) => \{[\s\S]*?\n\}\);/)[0], context);
  const enabling = listener();
  await flush();
  assert.equal(button.disabled, true);
  await listener();
  assert.equal(patches.length, 1);
  assert.equal(dialogs.length, 1);
  assert.match(dialogs[0].title, /확장 프로그램 설치/);
  assert.equal(dialogs[0].cancelVisible, false);
  resolveDialog(true);
  await enabling;
  assert.equal(scrolled, 1);
  assert.equal(button.disabled, false);
  await listener();
  assert.equal(dialogs.length, 1, "turning off does not prompt");
  rejectSave = true;
  await listener();
  assert.equal(dialogs.length, 1, "failed saves do not claim setup is enabled");
  assert.equal(errors.length, 1);
  assert.equal(button.getAttribute("aria-checked"), "false");
  assert.equal(button.disabled, false);
});

test("이미 연결된 브라우저가 있으면 웹 번역을 다시 켜도 설치 안내나 화면 이동을 하지 않는다", async () => {
  const document = new JSDOM(markup).window.document;
  const button = document.querySelector("#web-translation-enabled");
  const state = { config: { web_translation_enabled: false } };
  let listener;
  let refreshed = false;
  let dialogs = 0;
  let scrolled = 0;
  const context = vm.createContext({
    elements: {
      webTranslationEnabled: button,
      webBrowserClients: { scrollIntoView() { scrolled++; } },
    },
    state,
    setSwitch(element, value) { element.setAttribute("aria-checked", String(value)); },
    async applySettingsPatch(patch) { Object.assign(state.config, patch); },
    async loadBrowserClients() { refreshed = true; },
    browserConnections: { needsSetup() { assert.ok(refreshed); return false; } },
    async showModal() { dialogs++; },
    async showError(...args) { assert.fail(String(args)); },
  });
  button.addEventListener = (_type, callback) => { listener = callback; };
  vm.runInContext(appScript.match(/elements\.webTranslationEnabled\.addEventListener\("click", async \(\) => \{[\s\S]*?\n\}\);/)[0], context);
  await listener();
  assert.equal(state.config.web_translation_enabled, true);
  assert.equal(refreshed, true);
  assert.equal(dialogs, 0);
  assert.equal(scrolled, 0);
  assert.equal(button.disabled, false);
});

test("설치 안내는 허용된 브라우저의 연결을 확인한 뒤에만 판단한다", async () => {
  const h = harness();
  assert.equal(h.view.needsSetup(), false, "loading is not evidence of a missing extension");
  await h.view.refresh();
  assert.equal(h.view.needsSetup(), true);
  for (const browser of ["chrome", "whale", "firefox"]) {
    h.setClients([{ browser, lastSeenAt: 999_999 }]);
    await h.view.refresh();
    assert.equal(h.view.needsSetup(), false, `${browser} alone is enough`);
  }
  h.setInstallations([
    { browser: "firefox", installed: true, storeAvailable: false, connectionEnabled: false },
    { browser: "whale", installed: true, storeAvailable: true, connectionEnabled: true },
  ]);
  await h.view.refresh();
  assert.equal(h.view.needsSetup(), true, "a disabled browser's ping is not a connection");
  h.setClients([{ browser: "firefox", lastSeenAt: 999_999 }, { browser: "whale", lastSeenAt: 999_999 }]);
  await h.view.refresh();
  assert.equal(h.view.needsSetup(), false, "another enabled browser remains usable");
  h.setFailure(true);
  await h.view.refresh();
  assert.equal(h.view.needsSetup(), false, "failed status reads must not claim installation is required");
});

function harness() {
  const dom = new JSDOM('<div id="connections"></div>');
  const root = dom.window.document.querySelector("#connections");
  let time = 1_000_000;
  let clients = [];
  let installations = ["chrome", "whale", "firefox"].map(browser => ({ browser, installed: true, storeAvailable: true }));
  const calls = [];
  let action = async () => {};
  let failure = false;
  let installationRead = null;
  let prefix = "";
  const view = createBrowserConnections({
    root, now: () => time, translate: text => prefix + text,
    invoke: async (command, payload) => {
      calls.push({ command, payload });
      if (command === "browser_clients_status") {
        if (failure) throw new Error("offline");
        return clients;
      }
      if (command === "browser_installations") return installationRead ? installationRead(installations) : installations;
      const result = await action(command, payload);
      if (["browser_connect", "browser_disconnect"].includes(command)) {
        installations = installations.map(item => item.browser === payload.browser
          ? { ...item, connectionEnabled: command === "browser_connect" } : item);
      }
      return result;
    },
  });
  return {
    dom, root, view, calls,
    row: browser => root.querySelector(`[data-browser="${browser}"]`),
    button: (browser, action) => root.querySelector(`[data-browser="${browser}"] [data-action="${action}"]`),
    setClients: value => { clients = value; },
    setInstallations: value => { installations = value; },
    setTime: value => { time = value; },
    setAction: value => { action = value; },
    setFailure: value => { failure = value; },
    setInstallationRead: value => { installationRead = value; },
    setPrefix: value => { prefix = value; },
  };
}

test("세 브라우저는 연결 전후 모두 유지되고 화면 갱신으로 버튼 포커스를 잃지 않는다", async () => {
  const h = harness();
  await h.view.refresh();
  assert.equal(h.root.children.length, 3);
  assert.ok([...h.root.children].every(row => row.dataset.state === "unconfirmed"));
  const whale = h.button("whale", "connect");
  whale.focus();
  h.setClients([{ browser: "chrome", extensionVersion: "0.7.8", lastSeenAt: 999_999 }]);
  await h.view.refresh();
  assert.equal(h.row("chrome").dataset.state, "connected");
  assert.equal(h.button("chrome", "disconnect").dataset.tooltip, "연결 해제");
  assert.equal(h.button("whale", "connect"), whale);
  assert.equal(h.dom.window.document.activeElement, whale);
  assert.equal(h.root.children.length, 3);
  assert.ok(h.calls.every(call => ["browser_clients_status", "browser_installations"].includes(call.command)));
});

test("한 브라우저의 설치 작업은 다른 브라우저 연결을 막지 않고 정확한 브라우저만 연다", async () => {
  const h = harness();
  await h.view.refresh();
  let resolveChrome;
  h.setAction((_command, { browser }) => browser === "chrome" ? new Promise(resolve => { resolveChrome = resolve; }) : Promise.resolve());
  h.button("chrome", "connect").click();
  h.button("chrome", "connect").click();
  assert.equal(h.button("chrome", "connect").disabled, true);
  assert.equal(h.button("whale", "connect").disabled, false);
  h.button("whale", "connect").click();
  await flush();
  const opened = h.calls.filter(call => call.command === "browser_connect");
  assert.deepEqual(opened.map(call => call.payload), [{ browser: "chrome" }, { browser: "whale" }]);
  resolveChrome();
  await flush();
  h.setTime(1_001_000);
  h.setClients([{ browser: "whale", lastSeenAt: 1_000_500 }]);
  await h.view.refresh();
  assert.equal(h.row("whale").dataset.state, "connected");
  assert.equal(h.row("chrome").dataset.state, "checking");
  assert.equal(h.row("firefox").dataset.state, "unconfirmed");
});

test("재연결은 오래된 기록을 성공으로 쓰지 않고 새 자동 응답이나 제한 시간을 기다린다", async () => {
  const h = harness();
  h.setInstallations([{ browser: "chrome", installed: true, storeAvailable: true, connectionEnabled: false }]);
  h.setClients([{ browser: "chrome", lastSeenAt: 999_900 }]);
  await h.view.refresh();
  h.button("chrome", "connect").click();
  await flush();
  assert.equal(h.row("chrome").dataset.state, "checking");
  assert.ok(h.calls.some(call => call.command === "browser_connect"));
  assert.equal(h.row("chrome").querySelectorAll("button").length, 1);
  h.setTime(1_100_000);
  h.view.render();
  assert.equal(h.row("chrome").dataset.state, "unconfirmed");
  assert.match(h.row("chrome").textContent, /확장 프로그램을 열어/);
  h.setClients([{ browser: "chrome", lastSeenAt: 1_100_000 }]);
  await h.view.refresh();
  assert.equal(h.row("chrome").dataset.state, "connected");
});

test("오래된 연결 기록이나 미래 시간은 현재 연결로 표시하지 않는다", () => {
  assert.equal(browserConnectionState({ lastSeenAt: 1_000 }, 240_999), "connected");
  for (const lastSeenAt of [1_000, 0, -1, undefined, "invalid", 242_000]) {
    assert.equal(browserConnectionState({ lastSeenAt }, 241_000), "unconfirmed");
  }
});

test("없는 브라우저와 미공개 스토어는 구분하고 Firefox 기존 확장의 해제·재연결은 허용한다", async () => {
  const h = harness();
  h.setInstallations([
    { browser: "chrome", installed: true, storeAvailable: true },
    { browser: "whale", installed: false, storeAvailable: true },
    { browser: "firefox", installed: true, storeAvailable: false },
  ]);
  await h.view.refresh();
  assert.equal(h.button("chrome", "connect").disabled, false);
  assert.equal(h.button("whale", "connect").disabled, true);
  assert.equal(h.button("firefox", "connect").disabled, true);
  assert.match(h.row("whale").textContent, /브라우저 설치를 찾지/);
  assert.match(h.row("firefox").textContent, /스토어 심사 중/);
  h.setClients([{ browser: "firefox", lastSeenAt: 999_999 }]);
  await h.view.refresh();
  assert.equal(h.button("firefox", "disconnect").disabled, false);
  h.button("firefox", "disconnect").click();
  await flush();
  assert.equal(h.button("firefox", "connect").disabled, false);
  assert.match(h.row("firefox").textContent, /사용 중지됨/);
});

test("실패한 작업은 다른 브라우저에 번지지 않고 다시 시도할 수 있다", async () => {
  const h = harness();
  await h.view.refresh();
  h.setAction(async () => { throw new Error("browser_launch_failed"); });
  h.button("chrome", "connect").click();
  await flush();
  assert.match(h.row("chrome").textContent, /다시 시도하십시오/);
  assert.doesNotMatch(h.row("whale").textContent, /다시 시도하십시오/);
  assert.equal(h.button("chrome", "connect").disabled, false);
  h.setPrefix("translated:");
  h.view.render();
  assert.match(h.button("chrome", "connect").dataset.tooltip, /^translated:/);
  h.setFailure(true);
  await h.view.refresh();
  assert.match(h.row("whale").textContent, /다시 시도하십시오/);
});

test("공식 브라우저 아이콘과 접근 가능한 아이콘 버튼으로 반복 안내를 줄인다", async () => {
  const h = harness();
  await h.view.refresh();
  for (const browser of ["chrome", "whale", "firefox"]) {
    const row = h.row(browser);
    assert.ok(row.classList.contains("provider-row"));
    assert.equal(row.querySelector("img").getAttribute("src"), `./assets/browser-${browser}.png`);
    assert.equal(row.querySelector("img").alt, "");
    for (const action of ["connect"]) {
      const button = h.button(browser, action);
      assert.ok(button.querySelector("svg[aria-hidden='true']"));
      assert.ok(button.getAttribute("aria-label"));
      assert.equal(button.textContent, "");
    }
    assert.doesNotMatch(row.textContent, /설치를 승인한 뒤|번역할 사이트에서/);
  }
});

test("해제한 브라우저는 새 자동 응답에도 켜지지 않고 다른 브라우저는 유지한다", async () => {
  const h = harness();
  h.setClients(["chrome", "whale"].map(browser => ({browser, lastSeenAt: 999_999})));
  await h.view.refresh();
  h.button("chrome", "disconnect").click();
  await flush();
  h.setTime(1_001_000);
  h.setClients(["chrome", "whale"].map(browser => ({browser, lastSeenAt: 1_001_000})));
  await h.view.refresh();
  assert.equal(h.row("chrome").dataset.state, "disabled");
  assert.equal(h.row("whale").dataset.state, "connected");
  assert.ok(h.button("chrome", "connect").classList.contains("provider-action"));
  assert.ok(h.button("whale", "disconnect").classList.contains("provider-disconnect"));
  h.setAction(async () => { throw new Error("save failed"); });
  h.button("whale", "disconnect").click();
  await flush();
  assert.equal(h.row("whale").dataset.state, "connected");
  assert.equal(h.button("whale", "disconnect").disabled, false);
});

test("해제 직전 시작한 자동 조회가 늦게 끝나도 저장된 해제 상태를 다시 확인한다", async () => {
  const h = harness();
  h.setClients([{ browser: "chrome", lastSeenAt: 999_999 }]);
  await h.view.refresh();
  let finishOldRead;
  h.setInstallationRead(snapshot => new Promise(resolve => { finishOldRead = () => resolve(snapshot); }));
  const oldPoll = h.view.refresh();
  h.setInstallationRead(null);
  h.button("chrome", "disconnect").click();
  await flush();
  finishOldRead();
  await oldPoll;
  await flush();
  assert.equal(h.row("chrome").dataset.state, "disabled");
  assert.equal(h.button("chrome", "connect").disabled, false);
});
