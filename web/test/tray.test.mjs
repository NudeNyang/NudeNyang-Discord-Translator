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

test("saving settings hides the main window only after a successful update", () => {
  const updatePosition = appScript.indexOf('invoke("settings_update"');
  const hidePosition = appScript.indexOf('invoke("main_window_hide")');

  assert.ok(updatePosition >= 0);
  assert.ok(hidePosition > updatePosition);
});

test("custom tray menu exposes the expected actions and current app palette", () => {
  for (const label of ["실시간 번역", "표시 언어", "설정", "종료"]) {
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

test("tray window height hugs the menu without clipping the language list", () => {
  const trayWindow = tauriConfig.app.windows.find(window => window.label === "tray-menu");
  assert.equal(trayWindow.height, 274);
  assert.match(trayStyles, /\.language-view \.menu-row\.compact \{\s*min-height: 37px;/);
  assert.match(trayStyles, /\.bottom-group \{[^}]*padding-bottom: 0;/s);
});

test("tray panel keeps a crisp border without a blurred outer shadow", () => {
  assert.match(trayStyles, /\.tray-panel \{[^}]*box-shadow: none;/s);
});
