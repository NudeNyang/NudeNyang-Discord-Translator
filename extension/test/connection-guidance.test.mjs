import assert from "node:assert/strict";
import test from "node:test";
await import("../connection-guidance.js");
const { createGuidance } = globalThis.NudeNyangConnectionGuidance;
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup(responses, preferences = {}) {
  const timers = new Map();
  const states = [];
  const requests = [];
  let id = 0;
  const guidance = createGuidance({
    request: async type => { requests.push(type); return responses.shift(); },
    read: async () => preferences,
    save: async patch => Object.assign(preferences, patch),
    render: state => states.push({ ...state }),
    schedule: (fn, ms) => { timers.set(++id, { fn, ms }); return id; },
    unschedule: key => timers.delete(key),
  });
  return { guidance, states, requests, preferences, timers,
    async tick() { const [key, timer] = timers.entries().next().value; timers.delete(key); timer.fn(); await flush(); },
    state() { return states.at(-1); },
  };
}
const unavailable = { type: "error", code: "native_host_unavailable" };
const connected = { type: "status", appConnected: true, modelReady: false };

test("일시 실패는 재시도하고 세 번 실패한 뒤에만 설치·복구 안내를 표시한다", async () => {
  const s = setup([unavailable, unavailable, unavailable]);
  await s.guidance.start();
  assert.equal(s.state().phase, "checking");
  await s.tick();
  assert.equal(s.state().phase, "checking");
  await s.tick();
  assert.equal(s.state().phase, "unavailable");
  assert.equal(s.state().everConnected, false);
  assert.deepEqual(s.requests, ["status", "status", "status"]);
});
test("모델 준비 중이어도 앱 연결 성공이며 자동 확인은 이후 ping만 보낸다", async () => {
  const s = setup([unavailable, connected, { type: "connection", appConnected: true }]);
  await s.guidance.start(); await s.tick();
  assert.equal(s.state().phase, "connected");
  assert.equal(s.preferences.companionConnected, true);
  await s.tick();
  assert.deepEqual(s.requests, ["status", "status", "connectionPing"]);
});
test("명시적 해제는 설치 실패가 아니며 빠른 재시도로 다시 켜지 않는다", async () => {
  const s = setup([{ type: "error", code: "browser_connection_disabled", appConnected: false }]);
  await s.guidance.start();
  assert.equal(s.state().phase, "disabled");
  assert.equal(s.preferences.companionConnected, undefined);
  assert.equal([...s.timers.values()][0].ms, 5000);
});
test("연결 이력과 안내 닫기는 재시작 뒤에도 유지되며 성공하면 안내를 숨긴다", async () => {
  const s = setup([unavailable, unavailable, unavailable, connected], { companionConnected: true });
  await s.guidance.start(); await s.tick(); await s.tick();
  assert.equal(s.state().everConnected, true);
  s.guidance.dismiss();
  assert.equal(s.preferences.companionHelpDismissed, true);
  assert.equal(s.state().dismissed, true);
  await s.tick();
  assert.equal(s.state().phase, "connected");
  const next = setup([unavailable], s.preferences);
  await next.guidance.start();
  assert.equal(next.state().dismissed, true);
});
test("수동 재확인과 타이머는 중첩하지 않고 종료 후 늦은 응답도 무시한다", async () => {
  let resolve;
  let calls = 0;
  const states = [];
  const g = createGuidance({ request: () => { calls++; return new Promise(r => { resolve = r; }); },
    read: async () => ({}), save: async () => {}, render: s => states.push(s),
  });
  const starting = g.start(); await flush();
  void g.retry(); void g.retry();
  assert.equal(calls, 1);
  g.stop(); const before = states.length;
  resolve(connected); await starting;
  assert.equal(states.length, before);
});
