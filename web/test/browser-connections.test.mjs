import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { browserConnectionState, createBrowserConnections } from "../browser-connections.mjs";

const flush = () => new Promise(resolve => setImmediate(resolve));

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
  assert.equal(h.button("chrome", "connect").textContent, "스토어 열기");
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
  assert.match(h.button("chrome", "check").textContent, /^translated:/);
  h.setFailure(true);
  await h.view.refresh();
  assert.match(h.row("whale").textContent, /다시 시도하십시오/);
});
