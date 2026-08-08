import assert from "node:assert/strict";
import test from "node:test";

import {
  discordConnectionLabel,
  normalizeConfig,
  resolveEnabledState,
  restartCountdownMessage,
  shortcutFromKeyboardEvent,
  scrollThumbMetrics,
  shouldPromptRestart,
  SUPPORTED_TARGET_LANGUAGES,
  translatorRuntimeLabel,
} from "../state.mjs";

test("disabled translation is shown as waiting instead of connecting", () => {
  assert.equal(
    discordConnectionLabel({ enabled: false, cdpConnected: false, connectionIssue: null }),
    "번역 대기 중",
  );
  assert.equal(
    discordConnectionLabel({ enabled: true, cdpConnected: false, connectionIssue: null }),
    "Discord 연결 중",
  );
});

test("shortcut capture accepts function keys and modified key combinations", () => {
  assert.equal(shortcutFromKeyboardEvent({ key: "F9" }), "F9");
  assert.equal(
    shortcutFromKeyboardEvent({ key: "t", ctrlKey: true, altKey: true }),
    "Ctrl+Alt+T",
  );
  assert.equal(shortcutFromKeyboardEvent({ key: "Control", ctrlKey: true }), "");
  assert.equal(shortcutFromKeyboardEvent({ key: "t" }), "");
});

test("old settings receive safe Tauri defaults", () => {
  const config = normalizeConfig({ enabled: true });

  assert.equal(config.enabled, true);
  assert.equal(config.translator, "hymt_1_8b");
  assert.equal(config.discord_auto_restart_consent_granted, false);
  assert.equal(config.hotkeys.toggle_translation, "F12");
});

test("all supported display languages survive settings normalization", () => {
  assert.deepEqual(SUPPORTED_TARGET_LANGUAGES, ["ko", "ja", "en", "zh", "zh-Hant"]);
  for (const targetLanguage of SUPPORTED_TARGET_LANGUAGES) {
    assert.equal(normalizeConfig({ target_language: targetLanguage }).target_language, targetLanguage);
  }
  assert.equal(normalizeConfig({ target_language: "unsupported" }).target_language, "ko");
});

test("restart message contains countdown and data-loss warning", () => {
  const message = restartCountdownMessage(15);

  assert.match(message, /15초/);
  assert.match(message, /작성 중인 메시지/);
  assert.match(message, /통화/);
});

test("restart prompt only opens for an enabled failed CDP connection", () => {
  assert.equal(
    shouldPromptRestart(
      { enabled: true, connectionIssue: "port closed", cdpConnected: false },
      { promptActive: false, repairActive: false },
    ),
    true,
  );
  assert.equal(
    shouldPromptRestart(
      { enabled: true, connectionIssue: "port closed", cdpConnected: true },
      { promptActive: false, repairActive: false },
    ),
    false,
  );
});

test("Sentory overlay scroll thumb follows viewport and scroll position", () => {
  assert.deepEqual(scrollThumbMetrics(500, 1000, 250), {
    scrollable: true,
    height: 250,
    top: 125,
  });
  assert.deepEqual(scrollThumbMetrics(500, 400, 0), {
    scrollable: false,
    height: 0,
    top: 0,
  });
});

test("pending translation toggle stays visible until the engine acknowledges it", () => {
  assert.deepEqual(resolveEnabledState(true, false), { enabled: false, pending: false });
  assert.deepEqual(resolveEnabledState(false, false), { enabled: false, pending: null });
  assert.deepEqual(resolveEnabledState(true, null), { enabled: true, pending: null });
});

test("translator runtime label distinguishes preparation from the active model", () => {
  assert.equal(
    translatorRuntimeLabel({
      configuredTranslator: "hymt_7b",
      activeTranslator: "hymt_1_8b",
      translatorState: "preparing",
    }),
    "Hy-MT2 7B 준비 중",
  );
  assert.equal(
    translatorRuntimeLabel({
      configuredTranslator: "hymt_7b",
      activeTranslator: "hymt_7b",
      translatorState: "ready",
    }),
    "Hy-MT2 7B 사용 중",
  );
});
