import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const outgoing = readFileSync(new URL("../../src-tauri/src/outgoing.rs", import.meta.url), "utf8");
const engine = readFileSync(new URL("../../src-tauri/src/engine.rs", import.meta.url), "utf8");
const dom = readFileSync(new URL("../../src-tauri/src/dom.rs", import.meta.url), "utf8");
const cache = readFileSync(new URL("../../src-tauri/src/cache.rs", import.meta.url), "utf8");
const imageTranslation = readFileSync(new URL("../../src-tauri/src/image_translation.rs", import.meta.url), "utf8");

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
  assert.match(outgoing, /이 채널에 사용/);
  assert.match(outgoing, /번역하지 않고 원문을 유지합니다/);
  assert.match(engine, /TranslateOutgoing/);
  assert.match(engine, /Input\.insertText/);
  assert.match(engine, /Input\.dispatchKeyEvent/);
  assert.match(outgoing, /created_at/);
  assert.match(outgoing, />= 30000/);
  assert.match(outgoing, /CONTROLLER_VERSION/);
  assert.match(outgoing, /controller\.prunePending\(\)/);
});

test("confirming an automatic suggestion remembers it for the channel", () => {
  assert.match(outgoing, /confirmedStorageKey/);
  assert.match(outgoing, /readConfirmedLanguage/);
  assert.match(outgoing, /writeConfirmedLanguage/);
  assert.match(outgoing, /selectedLanguageForChannel/);
  assert.match(outgoing, /이 채널에 사용/);
  assert.doesNotMatch(outgoing, /suggest-once/);
});

test("configured outgoing defaults and confirmation policy reach Discord", () => {
  assert.match(outgoing, /__DEFAULT_LANGUAGE__/);
  assert.match(engine, /outgoing_target_language/);
  assert.match(engine, /outgoing_confirm_language/);
  assert.match(engine, /enqueue_outgoing_translation/);
});

test("long outgoing translations use one text attachment instead of notification spam", () => {
  assert.match(outgoing, /prepareAttachment/);
  assert.match(outgoing, /attachTextFile/);
  assert.match(outgoing, /new File\(\[content\], filename/);
  assert.match(outgoing, /번역문이 길어 텍스트 파일로 전송합니다\./);
  assert.match(engine, /dispatch_outgoing_text_file/);
});

test("sent translations restore the exact typed original instead of translating twice", () => {
  assert.match(outgoing, /original_text/);
  assert.match(outgoing, /sent_text/);
  assert.match(outgoing, /message_id/);
  assert.match(outgoing, /전송문 보기/);
  assert.match(outgoing, /원문 보기/);
  assert.match(outgoing, /parse_outgoing_bindings/);
  assert.match(engine, /put_outgoing_original/);
  assert.match(engine, /outgoing_originals_for_channel/);
  assert.match(dom, /data-nt-outgoing-original/);
  assert.match(cache, /CREATE TABLE IF NOT EXISTS outgoing_originals/);
});

test("outgoing translation preserves Discord Slate mention entities", () => {
  assert.match(outgoing, /const mentionSelector = '\[data-slate-inline="true"\]\[data-slate-void="true"\]\[contenteditable="false"\]'/);
  assert.match(outgoing, /function prefixMentionPlan\(editor\)/);
  assert.match(outgoing, /function visibleComposerText\(root\)/);
  assert.match(outgoing, /preserve_prefix_mentions/);
  assert.match(outgoing, /item\.original_text \|\| item\.text/);
  assert.match(outgoing, /selectionRangeForItem\(editor, item, continuation\)/);
  assert.match(outgoing, /if \(mentionPlan && !mentionPlan\.supported\) return/);
  assert.match(outgoing, /function hasActiveAutocomplete\(editor\)/);
  assert.match(outgoing, /if \(hasActiveAutocomplete\(editor\)\) return/);
});

test("Discord-injected controls follow the settings interface language", () => {
  assert.match(outgoing, /__UI_LANGUAGE__/);
  assert.match(outgoing, /requestedUiLanguage/);
  assert.match(outgoing, /outgoing_ui_script\(enabled: bool, default_language: &str, ui_language: &str\)/);
  assert.match(outgoing, /outgoing_originals_ui_script[\s\S]*ui_language: &str/);
  assert.match(imageTranslation, /pub fn image_ui_script\(ui_language: &str\)/);
  for (const copy of ["Image translation", "画像を翻訳", "翻译图片"]) {
    assert.match(imageTranslation, new RegExp(copy));
  }
});

test("translated outgoing text is sent without an artificial stabilization delay", () => {
  assert.doesNotMatch(outgoing, /verifyInserted/);
  assert.doesNotMatch(outgoing, /stableSince/);
  assert.doesNotMatch(engine, /verify_outgoing_insert_script/);
  assert.doesNotMatch(engine, /composer synchronization timed out/);
});
