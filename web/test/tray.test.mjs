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
const { translateCopy } = await import("../i18n.mjs");
const { LANGUAGE_OPTIONS } = await import("../languages.mjs");

test("confirming waits for real-time settings work before hiding the window", () => {
  const confirmHandler = appScript.match(/elements\.form\.addEventListener\("submit"[\s\S]*?\n\}\);/)?.[0] || "";
  const waitPosition = confirmHandler.indexOf("waitForSettingsUpdates");
  const hidePosition = confirmHandler.indexOf('invoke("main_window_hide")');

  assert.ok(waitPosition >= 0);
  assert.ok(hidePosition > waitPosition);
});

test("custom tray menu exposes the expected actions and current app palette", () => {
  for (const label of ["실시간 번역", "메시지 통역", "표시 언어", "번역 모델", "설정", "종료"]) {
    assert.match(trayMarkup, new RegExp(label));
  }
  for (const command of [
    "tray_open_settings",
    "tray_request_translation_toggle",
    "tray_request_outgoing_translation_toggle",
    "tray_menu_hide",
    "application_exit",
  ]) {
    assert.match(trayScript, new RegExp(command));
  }
  assert.match(trayStyles, /--accent: #347fc7/);
  assert.match(trayStyles, /--accent: #5aa8f5/);
  assert.doesNotMatch(`${trayMarkup}${trayScript}`, /[—–]/);
});

test("primary tray actions use consistent semantic icons", () => {
  for (const icon of ["language", "message-up", "world", "cpu", "adjustments-horizontal", "power"]) {
    assert.match(trayMarkup, new RegExp(`data-icon="${icon}"`));
  }
  assert.match(trayMarkup, /id="toggle-translation"[\s\S]*data-icon="language"[\s\S]*id="translation-indicator"/);
  assert.match(trayMarkup, /id="toggle-outgoing-translation"[\s\S]*data-icon="message-up"[\s\S]*id="outgoing-translation-indicator"/);
  assert.match(trayMarkup, /class="open-label"[\s\S]*class="open-label-icon"/);
  assert.match(trayStyles, /\.menu-icon \{[\s\S]*width: 28px;[\s\S]*flex: 0 0 28px;/);
  assert.match(trayStyles, /\.menu-icon svg \{[\s\S]*width: 20px;[\s\S]*height: 20px;/);
});

test("tray chevrons use fixed icon boxes instead of font glyph baselines", () => {
  assert.equal((trayMarkup.match(/class="menu-chevron"/g) || []).length, 4);
  assert.doesNotMatch(trayMarkup, /<b>›<\/b>/);
  assert.match(trayStyles, /\.menu-chevron \{[\s\S]*width: 16px;[\s\S]*height: 16px;[\s\S]*flex: 0 0 16px;/);
  assert.match(trayStyles, /\.arrow-value \{[\s\S]*align-items: center;[\s\S]*line-height: 1;/);
});

test("tray menu follows the configured interface language", () => {
  assert.match(trayScript, /from "\.\/i18n\.mjs"/);
  assert.match(trayScript, /applyTrayLanguage\(config\.ui_language/);
  assert.match(trayScript, /translateDynamicCopy\(currentUiLanguage/);
  const directKoreanAssignments = trayScript
    .split(/\r?\n/)
    .filter(line => /\.textContent\s*=/.test(line) && /[가-힣]/.test(line))
    .filter(line => !/translate(?:Copy|DynamicCopy)|LANGUAGE_LABELS/.test(line));
  assert.deepEqual(directKoreanAssignments, []);
  const keys = [...trayMarkup.matchAll(/data-i18n-key="([^"]+)"/g)].map(match => match[1]);
  for (const key of keys) assert.notEqual(translateCopy("ja", key), key, key);
});

test("translation state changes are broadcast to the open tray menu", () => {
  assert.match(rustShell, /emit\("translation-state-changed"/);
  assert.match(trayScript, /listen\("translation-state-changed"/);
  assert.match(trayScript, /setInterval\(refresh, 700\)/);
  assert.match(trayScript, /outgoing_translation_enabled/);
});

test("tray actions remain aligned when translated labels are long", () => {
  assert.match(trayStyles, /\.menu-copy strong \{[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(trayStyles, /\.menu-value \{[^}]*max-width:\s*46%;[^}]*text-overflow:\s*ellipsis;/s);
  assert.match(trayScript, /function preferredTrayWidth\(/);
  assert.match(trayScript, /Math\.min\(390, Math\.max\(300,/);
  assert.match(trayScript, /invoke\("tray_menu_set_size", \{ width, height \}\)/);
  assert.match(rustShell, /fn tray_menu_set_size\(app: AppHandle, width: u32, height: u32\)/);
});

test("compact interface languages keep the original narrow tray width", () => {
  assert.match(trayScript, /const COMPACT_TRAY_LANGUAGES = new Set\(\["ko", "ja", "zh", "zh-Hant"\]\)/);
  assert.match(
    trayScript,
    /if \(COMPACT_TRAY_LANGUAGES\.has\(resolveUiLanguage\(selectedUiLanguage\)\)\) return 300;/,
  );
  assert.match(trayScript, /querySelectorAll\("\.menu-row"\)/);
  assert.doesNotMatch(trayScript, /querySelectorAll\("\.brand-row, \.menu-row"\)/);
});

test("display language can be changed inside the tray menu", () => {
  assert.equal(LANGUAGE_OPTIONS.length, 28);
  for (const [language] of LANGUAGE_OPTIONS) {
    assert.match(trayScript, new RegExp(`LANGUAGE_OPTIONS`));
    assert.ok(language.length >= 2);
  }
  assert.match(trayScript, /data-language="\$\{code\}"/);
  assert.match(trayScript, /dir="auto"/);
  assert.match(trayStyles, /button\s*\{[^}]*text-align:\s*start;/s);
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
  assert.match(trayMarkup, /data-translator="chatgpt"[\s\S]*?<strong>ChatGPT<\/strong>/);
  assert.doesNotMatch(trayMarkup, /GPT-5\.6 Luna\/Terra/);
  assert.doesNotMatch(
    trayScript,
    /#open-model-settings"\)\.addEventListener\("click", \(\) => run\("tray_open_settings"\)/,
  );
});

test("tray window size hugs each menu view without clipping option lists", () => {
  const trayWindow = tauriConfig.app.windows.find(window => window.label === "tray-menu");
  assert.equal(trayWindow.height, 390);
  assert.match(trayStyles, /\.language-view \.menu-row\.compact \{\s*min-height: 37px;/);
  assert.match(trayStyles, /\.model-view \.menu-row\.compact \{\s*min-height: 37px;/);
  assert.match(trayStyles, /\.bottom-group \{[^}]*padding-bottom: 4px;/s);
  assert.match(trayScript, /main: 390/);
  assert.match(trayScript, /language: 520/);
  assert.match(trayStyles, /\.language-view \{[^}]*overflow-y: auto;/s);
  assert.match(trayScript, /model: 427/);
  assert.match(trayScript, /function preferredMainTrayHeight\(\)/);
  assert.match(trayScript, /elements\.brandRow\.getBoundingClientRect\(\)\.height/);
  assert.match(trayScript, /elements\.mainMenu\.scrollHeight/);
  assert.match(trayScript, /Math\.ceil\(contentHeight \+ frameHeight \+ 2\)/);
  assert.doesNotMatch(trayScript, /UPDATE_ROW_HEIGHT/);
  assert.match(trayScript, /resizeTray\(preferredMainTrayHeight\(\)\)/);
  assert.match(trayScript, /resizeTray\(VIEW_HEIGHTS\.language\)/);
  assert.match(trayScript, /resizeTray\(VIEW_HEIGHTS\.model\)/);
  assert.match(trayScript, /listen\("tray-menu-opened", \(\) => \{\s*lastTraySize = "";/s);
  assert.match(rustShell, /fn tray_menu_set_size/);
});

test("tray overflow hints use the shared borderless tooltip instead of native titles", () => {
  assert.doesNotMatch(trayScript, /\.title\s*=/);
  assert.match(trayScript, /closest\("button"\)\.dataset\.tooltip/);
  assert.match(trayStyles, /\[data-tooltip\]::after\s*\{[^}]*border:\s*0;[^}]*content:\s*attr\(data-tooltip\)/s);
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
