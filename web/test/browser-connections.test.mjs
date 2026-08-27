import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { browserConnectionState, createBrowserConnections } from "../browser-connections.mjs";

const flush = () => new Promise(resolve => setImmediate(resolve));

const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const appScript = readFileSync(new URL("../app.js", import.meta.url), "utf8");

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

function harness() {
  const dom = new JSDOM('<div id="connections"></div>');
  const root = dom.window.document.querySelector("#connections");
  let time = 1_000_000;
  let clients = [];
  let installations = ["chrome", "whale", "firefox"].map(browser => ({ browser, installed: true, storeAvailable: true }));
  const calls = [];
  let action = async () => {};
  let failure = false;
  let prefix = "";
  const view = createBrowserConnections({
    root, now: () => time, translate: text => prefix + text,
    invoke: async (command, payload) => {
      calls.push({ command, payload });
      if (command === "browser_clients_status") {
        if (failure) throw new Error("offline");
        return clients;
      }
      if (command === "browser_installations") return installations;
      return action(command, payload);
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
  assert.equal(h.button("chrome", "connect").dataset.tooltip, "스토어 열기");
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
  const opened = h.calls.filter(call => call.command === "browser_open_extension_store");
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

test("연결 확인은 오래된 기록을 성공으로 쓰지 않고 새 응답이나 제한 시간을 기다린다", async () => {
  const h = harness();
  h.setClients([{ browser: "chrome", lastSeenAt: 999_900 }]);
  await h.view.refresh();
  h.button("chrome", "check").click();
  await flush();
  assert.equal(h.row("chrome").dataset.state, "checking");
  assert.ok(h.calls.some(call => call.command === "browser_repair_connection"));
  assert.ok(!h.calls.some(call => call.command === "browser_open_extension_store"));
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

test("없는 브라우저와 미공개 스토어는 구분하고 기존 연결 확인은 계속 허용한다", async () => {
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
  assert.equal(h.button("firefox", "check").disabled, false);
  assert.match(h.row("whale").textContent, /브라우저 설치를 찾지/);
  assert.match(h.row("firefox").textContent, /스토어 심사 중/);
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
  assert.match(h.button("chrome", "check").dataset.tooltip, /^translated:/);
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
    for (const action of ["connect", "check"]) {
      const button = h.button(browser, action);
      assert.ok(button.querySelector("svg[aria-hidden='true']"));
      assert.ok(button.getAttribute("aria-label"));
      assert.equal(button.textContent, "");
    }
    assert.doesNotMatch(row.textContent, /설치를 승인한 뒤|번역할 사이트에서/);
  }
});
