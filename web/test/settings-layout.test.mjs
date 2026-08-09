import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const rustMain = readFileSync(new URL("../../src-tauri/src/main.rs", import.meta.url), "utf8");

test("theme and shortcut settings share one usage environment section", () => {
  const environmentSection = markup.match(
    /<section class="settings-section" aria-labelledby="environment-heading">[\s\S]*?<\/section>/,
  )?.[0] || "";

  assert.match(environmentSection, /<h2 id="environment-heading">사용 환경<\/h2>/);
  assert.match(environmentSection, /<h3>설정창 테마<\/h3>/);
  assert.match(environmentSection, /<h3>번역 켜기·끄기<\/h3>/);
  assert.equal((environmentSection.match(/class="setting-row"/g) || []).length, 2);
  assert.doesNotMatch(markup, /id="appearance-heading"|id="shortcut-heading"/);
});

test("settings can be reverted and native window chrome follows the selected theme", () => {
  assert.match(markup, /<button class="button secondary" id="cancel" type="button">되돌리기<\/button>/);
  assert.match(script, /invoke\("main_window_set_theme", \{ theme, resolvedTheme \}\)/);
  assert.match(rustMain, /DWMWA_CAPTION_COLOR/);
  assert.match(rustMain, /DWMWA_TEXT_COLOR/);
  assert.match(rustMain, /DWMWA_BORDER_COLOR/);
});

test("outgoing message translation is an explicit basic translation setting", () => {
  assert.match(markup, /<h3>보내는 메시지 번역<\/h3>/);
  assert.match(markup, /id="outgoing-translation"/);
  assert.match(markup, /<h3>기본 전송 언어<\/h3>/);
  assert.match(markup, /data-field="outgoing_target_language"/);
  assert.match(markup, /<h3>자동 감지 결과 확인<\/h3>/);
  assert.match(markup, /id="outgoing-confirm-language"/);
  assert.match(script, /outgoing_translation_enabled/);
  assert.match(script, /outgoing_target_language/);
  assert.match(script, /outgoing_confirm_language/);
});

test("footer action labels stay on one line", () => {
  assert.match(markup, /id="cancel"[^>]*>되돌리기<\/button>/);
  assert.match(readFileSync(new URL("../app.css", import.meta.url), "utf8"), /\.footer-actions \.button[\s\S]*white-space:\s*nowrap/);
});
