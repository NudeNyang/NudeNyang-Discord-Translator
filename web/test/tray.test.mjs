import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [appScript, trayMarkup, trayStyles, trayScript] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../tray.html", import.meta.url), "utf8"),
  readFile(new URL("../tray.css", import.meta.url), "utf8"),
  readFile(new URL("../tray.js", import.meta.url), "utf8"),
]);

const rustShell = await readFile(
  new URL("../../src-tauri/src/main.rs", import.meta.url),
  "utf8",
);
const tauriConfig = JSON.parse(
  await readFile(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);

test("confirming waits for real-time settings work before hiding the window", () => {
  const confirmHandler = appScript.match(/elements\.form\.addEventListener\("submit"[\s\S]*?\n\}\);/)?.[0] || "";
  const waitPosition = confirmHandler.indexOf("waitForSettingsUpdates");
  const hidePosition = confirmHandler.indexOf('invoke("main_window_hide")');

  assert.ok(waitPosition >= 0);
  assert.ok(hidePosition > waitPosition);
});

test("custom tray menu exposes the expected actions and current app palette", () => {
  for (const label of ["실시간 번역", "표시 언어", "번역 모델", "설정", "종료"]) {
    assert.match(trayMarkup, new RegExp(label));
  }
  for (const command of [
    "tray_open_settings",
    "tray_request_translation_toggle",
    "tray_menu_hide",
    "application_exit",
  ]) {
    assert.match(trayScript, new RegExp(command));
  }
  assert.match(trayStyles, /--accent: #347fc7/);
  assert.match(trayStyles, /--accent: #5aa8f5/);
  assert.doesNotMatch(`${trayMarkup}${trayScript}`, /[—–]/);
});

test("translation state changes are broadcast to the open tray menu", () => {
  assert.match(rustShell, /emit\("translation-state-changed"/);
  assert.match(trayScript, /listen\("translation-state-changed"/);
  assert.match(trayScript, /setInterval\(refresh, 700\)/);
});

test("display language can be changed inside the tray menu", () => {
  for (const language of ["ko", "ja", "en", "zh", "zh-Hant"]) {
    assert.match(trayMarkup, new RegExp(`data-language="${language}"`));
  }
  assert.match(trayScript, /invoke\("settings_update", \{ patch: \{ target_language: language \} \}\)/);
  assert.doesNotMatch(
    trayScript,
    /#open-language-settings"\)\.addEventListener\("click", \(\) => run\("tray_open_settings"\)/,
  );
});

test("translation model can be changed inside the tray menu", () => {
  for (const translator of [
    "hymt_1_8b",
    "hymt_7b",
    "translategemma_4b",
    "milmmt_4b",
    "chatgpt",
    "gemini",
    "deepl",
    "mock",
  ]) {
    assert.match(trayMarkup, new RegExp(`data-translator="${translator}"`));
  }
  assert.match(
    trayScript,
    /invoke\("settings_update", \{ patch: \{ translator \} \}\)/,
  );
  assert.match(trayScript, /invoke\("provider_connections_get"\)/);
  assert.match(trayScript, /invoke\("tray_open_provider_settings", \{ provider: translator \}\)/);
  assert.match(trayMarkup, /data-translator="claude"/);
  assert.match(trayMarkup, /<strong>GPT-5\.6<\/strong>/);
  assert.doesNotMatch(trayMarkup, /GPT-5\.6 Luna/);
  assert.doesNotMatch(
    trayScript,
    /#open-model-settings"\)\.addEventListener\("click", \(\) => run\("tray_open_settings"\)/,
  );
});

test("tray window height hugs each menu view without clipping option lists", () => {
  const trayWindow = tauriConfig.app.windows.find(window => window.label === "tray-menu");
  assert.equal(trayWindow.height, 318);
  assert.match(trayStyles, /\.language-view \.menu-row\.compact \{\s*min-height: 37px;/);
  assert.match(trayStyles, /\.model-view \.menu-row\.compact \{\s*min-height: 37px;/);
  assert.match(trayStyles, /\.bottom-group \{[^}]*padding-bottom: 0;/s);
  assert.match(trayScript, /main: 318/);
  assert.match(trayScript, /language: 274/);
  assert.match(trayScript, /model: 427/);
  assert.match(trayScript, /VIEW_HEIGHTS\.main \+ \(availableUpdateVersion \? UPDATE_ROW_HEIGHT : 0\)/);
  assert.match(trayScript, /resizeTray\(VIEW_HEIGHTS\.language\)/);
  assert.match(trayScript, /resizeTray\(VIEW_HEIGHTS\.model\)/);
  assert.match(rustShell, /fn tray_menu_set_height/);
});

test("tray panel keeps a crisp border without a blurred outer shadow", () => {
  assert.match(trayStyles, /\.tray-panel \{[^}]*box-shadow: none;/s);
});

test("a deferred update remains available from the tray menu", () => {
  assert.match(trayMarkup, /id="install-update"[^>]*hidden/);
  assert.match(trayMarkup, /id="tray-update-version"/);
  assert.match(trayScript, /invoke\("update_availability_get"\)/);
  assert.match(trayScript, /listen\("update-availability-changed"/);
  assert.match(trayScript, /run\("tray_request_update_install"\)/);
  assert.match(rustShell, /emit\("update-availability-changed"/);
  assert.match(rustShell, /fn update_availability_get/);
});
