import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const rustMain = readFileSync(new URL("../../src-tauri/src/main.rs", import.meta.url), "utf8");

test("settings use five uniform navigation categories", () => {
  for (const panel of ["translation", "engine", "image", "convenience", "about"]) {
    assert.match(markup, new RegExp(`data-settings-panel="${panel}"`));
    assert.match(markup, new RegExp(`data-settings-view="${panel}"`));
  }
  assert.match(markup, /<span>번역<\/span>/);
  assert.match(markup, /<span>번역 엔진<\/span>/);
  assert.match(markup, /<span>이미지 번역<\/span>/);
  assert.match(markup, /<span>편의 기능<\/span>/);
  assert.match(markup, /<span>앱 정보<\/span>/);
});

test("settings can be reverted and native window chrome follows the selected theme", () => {
  assert.match(markup, /<button class="button secondary" id="cancel" type="button">되돌리기<\/button>/);
  assert.match(script, /invoke\("main_window_set_theme", \{ theme, resolvedTheme \}\)/);
  assert.match(rustMain, /DWMWA_CAPTION_COLOR/);
  assert.match(rustMain, /DWMWA_TEXT_COLOR/);
  assert.match(rustMain, /DWMWA_BORDER_COLOR/);
});

test("outgoing translation and its first-use confirmation are grouped together", () => {
  assert.match(markup, /<h3>보내는 메시지 번역<\/h3>/);
  assert.match(markup, /id="outgoing-translation"/);
  assert.match(markup, /<h3>기본 전송 언어<\/h3>/);
  assert.match(markup, /data-field="outgoing_target_language"/);
  assert.match(markup, /<h3>채널별 첫 감지 확인<\/h3>/);
  assert.match(markup, /id="outgoing-confirm-language"/);
  assert.match(markup, /채널별로 처음 사용할 때 한 번만 확인합니다/);
  assert.match(script, /outgoing_translation_enabled/);
  assert.match(script, /outgoing_target_language/);
  assert.match(script, /outgoing_confirm_language/);
});

test("convenience panel exposes separate incoming and outgoing shortcuts", () => {
  assert.match(markup, /<h3>Language<\/h3>/);
  assert.match(script, /\["auto", "자동 \(시스템 언어\)"\]/);
  assert.match(markup, /data-field="ui_language"/);
  assert.match(markup, /id="toggle-shortcut"/);
  assert.match(markup, /id="toggle-outgoing-shortcut"/);
  assert.match(markup, /<h3>실시간 번역 켜기·끄기<\/h3>/);
  assert.match(markup, /<h3>보내는 메시지 번역 켜기·끄기<\/h3>/);
  assert.match(script, /toggle_outgoing_translation/);
  assert.match(script, /request-outgoing-translation-toggle/);
});

test("footer action labels stay on one line", () => {
  assert.match(markup, /id="cancel"[^>]*>되돌리기<\/button>/);
  assert.match(readFileSync(new URL("../app.css", import.meta.url), "utf8"), /\.footer-actions \.button[\s\S]*white-space:\s*nowrap/);
});
