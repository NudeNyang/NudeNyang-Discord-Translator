import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const rustMain = readFileSync(new URL("../../src-tauri/src/main.rs", import.meta.url), "utf8");
const tauriConfig = readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8");
const packageManifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const cargoManifest = readFileSync(new URL("../../src-tauri/Cargo.toml", import.meta.url), "utf8");
const installerHooks = readFileSync(new URL("../../src-tauri/windows/hooks.nsh", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app.css", import.meta.url), "utf8");

test("the user-facing product name is NudeNyang Translator", () => {
  assert.match(markup, /NudeNyang Translator/);
  assert.match(tauriConfig, /"productName": "NudeNyang Translator"/);
  assert.match(script, /https:\/\/github\.com\/NudeNyang\/NudeNyang-Translator/);
  assert.doesNotMatch(markup, /Nude Translator/);
  assert.doesNotMatch(tauriConfig, /Nude Translator/);
});

test("the beta version is consistent across the application manifests", () => {
  assert.equal(packageManifest.version, "0.4.1-beta");
  assert.match(tauriConfig, /"version": "0\.4\.1-beta"/);
  assert.match(cargoManifest, /^version = "0\.4\.1-beta"$/m);
  assert.match(markup, /<span id="app-version">0\.4\.1 Beta<\/span>/);
});

test("the installer migrates legacy shortcuts to the NudeNyang Translator name", () => {
  assert.match(tauriConfig, /"installerHooks": "\.\/windows\/hooks\.nsh"/);
  assert.match(installerHooks, /NudeNyang Translator\.lnk/);
  assert.match(installerHooks, /Delete "\$DESKTOP\\Nude Translator\.lnk"/);
  assert.match(installerHooks, /Delete "\$SMPROGRAMS\\Nude Translator\.lnk"/);
});

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

test("settings apply immediately and the primary footer action only confirms", () => {
  assert.match(markup, /<button class="button primary" id="confirm" type="submit">확인<\/button>/);
  assert.doesNotMatch(markup, /type="submit">저장<\/button>/);
  assert.match(markup, /변경 사항은 즉시 적용됩니다/);
  assert.match(script, /async function applySettingsPatch\(patch/);
  assert.match(script, /applySettingsPatch\(\{ \[field\]: value \}\)/);
  assert.doesNotMatch(script, /outgoing_confirm_language/);
  assert.match(script, /outgoing_confirm_send: enabled/);
  assert.match(
    script,
    /function renderConfig[\s\S]*?elements\.outgoingConfirmSend[\s\S]*?state\.config\.outgoing_confirm_send[\s\S]*?async function applySettingsPatch/,
  );
  assert.match(script, /keep_local_model_warm: enabled/);
  assert.match(script, /scheduleCaptureFpsUpdate/);
  assert.match(script, /applyShortcutImmediately/);
});

test("outgoing interpretation asks only when automatic language detection is uncertain", () => {
  assert.match(markup, /<h3>전송 메시지 통역<\/h3>/);
  assert.match(markup, /id="outgoing-translation"/);
  assert.match(markup, /<h3>기본 전송 언어<\/h3>/);
  assert.match(markup, /data-field="outgoing_target_language"/);
  assert.doesNotMatch(markup, /채널별 첫 감지 확인/);
  assert.doesNotMatch(markup, /id="outgoing-confirm-language"/);
  assert.match(markup, /<h3>전송 전 확인<\/h3>/);
  assert.match(markup, /id="outgoing-confirm-send"/);
  assert.match(markup, /켜면 번역문을 입력창에 남겨 확인하거나 수정할 수 있습니다/);
  assert.doesNotMatch(markup, /<div class="privacy-note"><strong>자동 감지<\/strong>/);
  assert.match(markup, /id="outgoing-auto-help"/);
  assert.match(markup, /언어를 판단하기 어려울 때만 전송 언어를 확인합니다/);
  assert.match(script, /outgoing_translation_enabled/);
  assert.match(script, /outgoing_target_language/);
  assert.match(
    script,
    /elements\.outgoingAutoHelp\.hidden = state\.config\.outgoing_target_language !== "auto"/,
  );
  assert.doesNotMatch(script, /outgoing_confirm_language/);
  assert.match(script, /outgoing_confirm_send/);
});

test("display translation and real-time interpretation choose models independently", () => {
  assert.match(markup, /<h3>표시 언어 번역 모델<\/h3>/);
  assert.match(markup, /data-field="translator"/);
  assert.match(markup, /<h3>실시간 통역 모델<\/h3>/);
  assert.match(markup, /data-field="outgoing_translator"/);
  assert.match(markup, /1\.8B와 7B 중 하나의 로컬 모델만 사용합니다/);
  assert.match(script, /outgoing_translator: TRANSLATOR_OPTIONS/);
});

test("convenience panel exposes global toggles and editable composer shortcuts", () => {
  assert.match(markup, /<h3>Language<\/h3>/);
  assert.match(script, /\["auto", "Auto\(System\)"\]/);
  assert.match(markup, /data-field="ui_language"/);
  assert.match(markup, /id="toggle-shortcut"/);
  assert.match(markup, /id="toggle-outgoing-shortcut"/);
  assert.match(markup, /id="send-immediately-shortcut"/);
  assert.match(markup, /id="review-before-send-shortcut"/);
  assert.match(markup, /<h3>실시간 번역 켜기·끄기<\/h3>/);
  assert.match(markup, /<h3>전송 메시지 통역 켜기·끄기<\/h3>/);
  assert.match(markup, /<h3>즉시 전송<\/h3>/);
  assert.match(markup, /<h3>항상 첨삭<\/h3>/);
  assert.match(script, /toggle_outgoing_translation/);
  assert.match(script, /send_outgoing_immediately/);
  assert.match(script, /review_outgoing_before_send/);
  assert.match(script, /request-outgoing-translation-toggle/);
});

test("the incoming shortcut toggles the native engine without waiting for the settings webview", () => {
  assert.match(rustMain, /fn toggle_translation_from_app\(/);
  assert.match(
    rustMain,
    /ShortcutAction::Translation\s*=>\s*toggle_translation_from_app\(app\)/,
  );
  assert.match(rustMain, /discord_auto_restart_consent_granted/);
});

test("footer action labels stay on one line", () => {
  assert.match(markup, /id="cancel"[^>]*>되돌리기<\/button>/);
  assert.match(styles, /\.footer-actions \.button[\s\S]*white-space:\s*nowrap/);
  assert.match(styles, /\.form-footer\s*\{[\s\S]*position:\s*sticky[\s\S]*bottom:\s*0/);
  assert.match(styles, /\.form-footer\s*\{[\s\S]*min-height:\s*68px/);
  assert.match(styles, /grid-template-areas:\s*"update"\s*"workspace"\s*"footer"/);
  assert.match(styles, /\.settings-workspace\s*\{\s*grid-area:\s*workspace/);
});

test("friends can reveal one privacy-safe diagnostic log file", () => {
  const diagnostics = readFileSync(new URL("../../src-tauri/src/diagnostics.rs", import.meta.url), "utf8");
  const hymt = readFileSync(new URL("../../src-tauri/src/translation/hymt.rs", import.meta.url), "utf8");
  assert.match(diagnostics, /NudeNyangTranslator\.log/);
  assert.match(diagnostics, /MAX_LOG_BYTES/);
  assert.match(diagnostics, /redact_sensitive/);
  assert.match(hymt, /pipe_external_output/);
  assert.doesNotMatch(hymt, /default_server_log_path/);
  assert.match(rustMain, /diagnostic_log_reveal/);
  assert.match(markup, /id="open-diagnostic-log"/);
  assert.match(script, /invoke\("diagnostic_log_reveal"\)/);
});

test("automatic updates are announced outside the app information panel", () => {
  assert.match(markup, /id="update-banner"[^>]*hidden/);
  assert.match(markup, /id="update-banner-version"/);
  assert.match(markup, /id="update-banner-install"/);
  assert.ok(
    markup.indexOf('id="update-banner"') < markup.indexOf('class="settings-workspace"'),
  );
  assert.match(script, /showAvailableUpdate\(result\.version, \{ prompt: silent \}\)/);
  assert.match(script, /title: "새 업데이트가 있습니다"/);
  assert.match(script, /cancelText: "나중에"/);
});

test("dynamic app information and runtime notices follow the interface language", () => {
  assert.match(markup, /data-i18n-key="버전"/);
  assert.match(markup, /data-i18n-key="버전을 설치할 수 있습니다/);
  assert.match(script, /setLocalizedText\(elements\.updateStatus/);
  assert.match(script, /setLocalizedText\(elements\.saveStatus, status\.notice\)/);
  assert.match(script, /translateDynamicCopy\(currentUiLanguage\(\), title\)/);
});
