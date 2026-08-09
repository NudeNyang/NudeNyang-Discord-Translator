import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const outgoing = readFileSync(new URL("../../src-tauri/src/outgoing.rs", import.meta.url), "utf8");
const engine = readFileSync(new URL("../../src-tauri/src/engine.rs", import.meta.url), "utf8");

test("outgoing translation intercepts only normal Enter sends", () => {
  assert.match(outgoing, /event\.key !== 'Enter'/);
  assert.match(outgoing, /event\.shiftKey/);
  assert.match(outgoing, /event\.isComposing/);
  assert.match(outgoing, /startsWith\('\/'\)/);
  assert.match(outgoing, /includes\('```'\)/);
});

test("language suggestions use recent message contents and never channel names", () => {
  assert.match(outgoing, /recentMessages/);
  assert.match(outgoing, /__nudeTranslatorOriginals/);
  assert.doesNotMatch(outgoing, /channelName|channelTitle/);
  assert.match(engine, /suggest_recent_language/);
});

test("channel memory, one-message overrides, and safe failures are represented", () => {
  assert.match(outgoing, /localStorage/);
  assert.match(outgoing, /이번 메시지만 원문으로 전송/);
  assert.match(outgoing, /채널에 적용/);
  assert.match(outgoing, /번역하지 않고 원문을 유지합니다/);
  assert.match(engine, /TranslateOutgoing/);
  assert.match(engine, /Input\.insertText/);
  assert.match(engine, /Input\.dispatchKeyEvent/);
});
