import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateCopy, translateDynamicCopy } from "../i18n.mjs";

const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const rustMain = readFileSync(new URL("../../src-tauri/src/main.rs", import.meta.url), "utf8");
const cache = readFileSync(new URL("../../src-tauri/src/cache.rs", import.meta.url), "utf8");
const model = readFileSync(new URL("../../src-tauri/src/translation/hymt.rs", import.meta.url), "utf8");

test("storage management exposes downloaded models and SQLite history cleanup", () => {
  assert.match(markup, /id="storage-management"/);
  assert.match(markup, /data-settings-panel="storage"/);
  assert.match(markup, /data-settings-view="storage"/);
  assert.match(markup, /id="local-model-storage-list"/);
  assert.match(markup, /id="clear-translation-cache"/);
  assert.match(markup, /class="storage-group-heading"><span class="card-index" aria-hidden="true">L<\/span>/);
  assert.match(markup, /class="storage-history-section"[\s\S]*id="storage-history-heading">번역 기록<\/h3>[\s\S]*class="settings-card storage-history-card"/);
  assert.match(script, /invoke\("storage_status_get"\)/);
  assert.match(script, /invoke\("local_model_delete", \{ modelId: model\.id \}\)/);
  assert.match(script, /invoke\("translation_cache_clear"\)/);
  assert.match(rustMain, /storage_status_get/);
  assert.match(rustMain, /local_model_delete/);
  assert.match(rustMain, /translation_cache_clear/);
  assert.match(script, /\["milmmt_4b", "MiLMMT 4B Q4 \(실험·약 2\.9GB\)"\]/);
});

test("storage navigation sits immediately above app information", () => {
  const storagePosition = markup.indexOf('data-settings-panel="storage"');
  const aboutPosition = markup.indexOf('data-settings-panel="about"');
  const conveniencePosition = markup.indexOf('data-settings-panel="convenience"');

  assert.ok(conveniencePosition < storagePosition);
  assert.ok(storagePosition < aboutPosition);
});

test("SQLite cleanup preserves channel language preferences", () => {
  assert.match(cache, /DELETE FROM translations/);
  assert.match(cache, /DELETE FROM outgoing_originals/);
  assert.doesNotMatch(cache, /DELETE FROM outgoing_channel_languages/);
  assert.match(cache, /cleanup_removes_translation_history_but_preserves_channel_preferences/);
});

test("local model deletion removes only cache artifacts and blocks selected models", () => {
  assert.match(model, /remove_cached_model_files/);
  assert.match(model, /cached_model_cleanup_removes_model_partial_and_hash_files_only/);
  assert.match(rustMain, /현재 사용 중인 모델입니다\. 다른 번역 모델을 선택한 후 삭제하십시오\./);
});

test("storage management copy follows the selected interface language", () => {
  assert.equal(translateCopy("en", "저장 공간 관리"), "Storage management");
  assert.equal(translateCopy("ja", "기록 정리"), "履歴を消去");
  assert.equal(
    translateDynamicCopy("zh", "번역 기록 12건을 정리했습니다."),
    "已清理 12 条翻译记录。",
  );
});
