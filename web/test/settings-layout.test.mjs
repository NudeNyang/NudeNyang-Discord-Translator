import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const rustMain = readFileSync(new URL("../../src-tauri/src/main.rs", import.meta.url), "utf8");
const tauriConfig = readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8");
const packageManifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const cargoManifest = readFileSync(new URL("../../src-tauri/Cargo.toml", import.meta.url), "utf8");
const capabilities = readFileSync(new URL("../../src-tauri/capabilities/default.json", import.meta.url), "utf8");
const installerHooks = readFileSync(new URL("../../src-tauri/windows/hooks.nsh", import.meta.url), "utf8");
const discordStartup = readFileSync(new URL("../../src-tauri/src/discord_startup.rs", import.meta.url), "utf8");
const discord = readFileSync(new URL("../../src-tauri/src/discord.rs", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app.css", import.meta.url), "utf8");

test("the user-facing product name is NudeNyang Discord Translator", () => {
  assert.match(markup, /NudeNyang Discord Translator/);
  assert.match(tauriConfig, /"productName": "NudeNyang Discord Translator"/);
  assert.match(script, /https:\/\/github\.com\/NudeNyang\/NudeNyang-Discord-Translator/);
  assert.match(markup, /class="app-info-product-brand"><img class="app-info-product-icon" src="\.\/app-icon\.png" alt="" width="34" height="34" \/><div><h3>NudeNyang Discord Translator<\/h3>/);
  assert.match(styles, /\.app-info-product-brand\s*\{[\s\S]*?display:\s*flex;[\s\S]*?gap:\s*10px;/);
  assert.doesNotMatch(markup, /Nude Translator/);
  assert.doesNotMatch(tauriConfig, /Nude Translator/);
});

test("translation language options keep the shared layout while RTL entries align right", () => {
  assert.match(styles, /\.select-option\s*\{[^}]*text-align:\s*start;/s);
  for (const language of ["ar", "ur", "fa", "he"]) {
    assert.match(styles, new RegExp(`\\.select-option\\[data-value="${language}"\\]`));
  }
  assert.match(styles, /\.select-option\[data-value="he"\]\s*\{[^}]*text-align:\s*right;/s);
  assert.match(script, /trigger\.dir = "ltr"/);
  assert.match(script, /triggerLabel\.dir = languageField \? "auto" : "ltr"/);
  assert.match(styles, /\.select-trigger\s*\{[^}]*direction:\s*ltr;/s);
});

test("language compact codes are not rendered as select group headings", () => {
  assert.match(script, /if \(!languageField && group && group !== previousGroup\)/);
});

test("the application version is consistent across the application manifests", () => {
  assert.equal(packageManifest.version, "0.5.13-beta");
  assert.match(tauriConfig, /"version": "0\.5\.13-beta"/);
  assert.match(cargoManifest, /^version = "0\.5\.13-beta"$/m);
  assert.match(markup, /<span id="app-version">0\.5\.13 Beta<\/span>/);
  assert.match(script, /replace\(\/-beta\$\/i, " Beta"\)/);
});

test("the installer migrates legacy shortcuts to the NudeNyang Discord Translator name", () => {
  assert.match(tauriConfig, /"installerHooks": "\.\/windows\/hooks\.nsh"/);
  assert.match(installerHooks, /NudeNyang Discord Translator\.lnk/);
  assert.match(installerHooks, /Delete "\$DESKTOP\\NudeNyang Discord Translator\.lnk"/);
  assert.match(installerHooks, /Delete "\$DESKTOP\\Nude Translator\.lnk"/);
  assert.match(installerHooks, /Delete "\$SMPROGRAMS\\Nude Translator\.lnk"/);
});

test("settings use six uniform navigation categories", () => {
  for (const panel of ["translation", "engine", "storage", "image", "convenience", "about"]) {
    assert.match(markup, new RegExp(`data-settings-panel="${panel}"`));
    assert.match(markup, new RegExp(`data-settings-view="${panel}"`));
  }
  assert.match(markup, /<span>번역<\/span>/);
  assert.match(markup, /<span>번역 엔진<\/span>/);
  assert.match(markup, /<span>저장 공간<\/span>/);
  assert.match(markup, /<span>이미지 번역<\/span>/);
  assert.match(markup, /<span>편의 기능<\/span>/);
  assert.match(markup, /<span>앱 정보<\/span>/);
  for (const icon of ["language", "cpu", "photo", "adjustments-horizontal", "database", "info-circle"]) {
    assert.match(markup, new RegExp(`class="settings-nav-icon" data-icon="${icon}" aria-hidden="true"`));
  }
  assert.match(styles, /\.settings-nav-item\.active \.settings-nav-icon\s*\{[\s\S]*?background:\s*var\(--accent\)/);
  assert.doesNotMatch(markup, /<i aria-hidden="true"><\/i>/);
  assert.ok(
    markup.indexOf('data-settings-panel="storage"') < markup.indexOf('data-settings-panel="about"'),
  );
});

test("image translation exposes adaptive local OCR quality controls", () => {
  assert.match(markup, /data-field="image_ocr_quality"/);
  assert.match(markup, /빠른 모델로 먼저 인식하고 불확실한 영역만 고품질 모델로 다시 확인합니다/);
  assert.match(markup, /약 70MB이며 처음 필요할 때 다운로드합니다/);
  assert.match(script, /image_ocr_quality:\s*\[/);
  assert.match(script, /\["adaptive", "자동 \(권장\)"\]/);
});

test("settings window keeps a readable minimum width without horizontal navigation scrolling", () => {
  const windowConfig = JSON.parse(tauriConfig).app.windows.find(window => window.label === "main");
  assert.ok(windowConfig.minWidth >= 760);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.settings-navigation\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(styles, /\.settings-navigation\s*\{[^}]*overflow-x:\s*auto/);
});

test("settings navigation adapts to long localized labels", () => {
  assert.match(
    styles,
    /\.settings-workspace\s*\{[^}]*grid-template-columns:\s*clamp\(168px,\s*22%,\s*236px\)\s+minmax\(0,\s*1fr\)/s,
  );
  assert.match(styles, /\.settings-nav-item\s*\{[^}]*padding:\s*8px 11px;[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(styles, /\.settings-nav-item\s*\{[^}]*line-height:\s*1\.3;/s);
});

test("settings reset is separated from the confirmation footer and native window chrome follows the selected theme", () => {
  assert.doesNotMatch(markup, /id="cancel"/);
  assert.match(markup, /id="reset-settings"[^>]*>초기화<\/button>/);
  assert.doesNotMatch(styles, /\.button\.danger\s*\{[^}]*font-size:/);
  assert.match(script, /invoke\("settings_reset"\)/);
  assert.match(rustMain, /fn settings_reset\(/);
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
  assert.match(markup, /class="card-index message-direction-icon message-direction-icon--incoming" aria-hidden="true">↓<\/span>[\s\S]*?<h3>받는 메시지<\/h3>/);
  assert.match(markup, /class="card-index message-direction-icon message-direction-icon--outgoing" aria-hidden="true">↑<\/span>[\s\S]*?<h3>보내는 메시지<\/h3>/);
  assert.doesNotMatch(markup, /class="card-index" aria-hidden="true">0[123]<\/span>/);
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
  assert.match(markup, /id="translation-shortcut-hint">F12<\/kbd>/);
  assert.match(markup, /id="outgoing-shortcut-hint">F8<\/kbd>/);
  assert.match(script, /elements\.translationShortcutHint\.textContent = state\.config\.hotkeys\.toggle_translation/);
  assert.match(script, /elements\.outgoingShortcutHint\.textContent = state\.config\.hotkeys\.toggle_outgoing_translation/);
  assert.doesNotMatch(markup, /공통 번역 규칙|번역 말투|data-field="speech_style"/);
  assert.doesNotMatch(script, /speech_style/);
});

test("only the incoming and outgoing direction icons use distinct semantic accents", () => {
  assert.doesNotMatch(markup, /message-settings-card/);
  assert.match(markup, /class="card-index message-direction-icon message-direction-icon--incoming" aria-hidden="true">↓<\/span>/);
  assert.match(markup, /class="card-index message-direction-icon message-direction-icon--outgoing" aria-hidden="true">↑<\/span>/);
  assert.match(styles, /\.message-direction-icon--incoming\s*\{[^}]*--message-direction-accent:\s*#d4a24a;[^}]*border-color:[^}]*--message-direction-accent/s);
  assert.doesNotMatch(styles, /\.message-settings-card/);
});

test("outgoing automatic-language help reserves its card height", () => {
  assert.match(
    styles,
    /\.select-help\[hidden\]\s*\{[^}]*display:\s*block;[^}]*visibility:\s*hidden;/s,
  );
});

test("language select options relocalize after the saved interface language loads", () => {
  assert.match(script, /option\.dataset\.i18nKey = label/);
  assert.match(script, /groupLabel\.dataset\.i18nKey = SELECT_GROUP_LABELS\[group\]/);
});

test("display translation and outgoing interpretation present role-appropriate model choices", () => {
  assert.match(markup, /<h3>표시 언어 번역 모델<\/h3>/);
  assert.match(markup, /data-field="translator"/);
  assert.match(markup, /<h3>보내는 메시지 통역 모델<\/h3>/);
  assert.match(markup, /data-field="outgoing_translator"/);
  assert.match(markup, /id="vram-protection-note" hidden/);
  assert.match(markup, /로컬 모델은 하나만 실행됩니다\. 표시 번역과 보내는 메시지 통역의 로컬 모델 선택은 함께 변경됩니다\./);
  assert.match(script, /elements\.vramProtectionNote\.hidden = !LOCAL_TRANSLATORS\.has\(selected\)/);
  assert.doesNotMatch(markup, /1\.8B와 7B 중 하나의 로컬 모델만 사용합니다/);
  assert.doesNotMatch(markup, /처리 위치 안내/);
  assert.doesNotMatch(markup, /OCR은 PC에서 실행됩니다/);
  assert.doesNotMatch(markup, /번역 메뉴의 표시 언어 설정을 따릅니다/);
  assert.doesNotMatch(markup, /실시간 번역이 켜져 있을 때만 활성화됩니다/);
  assert.doesNotMatch(markup, /로컬 번역 모델과 이미지 OCR은 이 PC에서 처리됩니다/);
  assert.doesNotMatch(markup, /Hy-MT2와 이미지 OCR은 PC에서 실행됩니다/);
  assert.match(markup, /로컬 번역 모델의 실행 장치와 자원 사용 방식을 설정합니다/);
  assert.match(markup, /로컬 모델 실행 장치/);
  assert.match(markup, /로컬 모델 예열 유지/);
  assert.match(
    markup,
    /켜두면 다시 번역할 때 빠르게 반응하지만 RAM\/VRAM을 계속 사용합니다\. 게임이 느려지거나 메모리가 부족하다면 꺼주세요\./,
  );
  assert.match(script, /setSwitch\(elements\.keepWarm, state\.config\.keep_local_model_warm, "켜짐", "꺼짐"\)/);
  assert.doesNotMatch(markup, /Hy-MT2 실행 장치/);
  assert.match(script, /translator: DISPLAY_TRANSLATOR_OPTIONS/);
  assert.match(script, /outgoing_translator: OUTGOING_TRANSLATOR_OPTIONS/);
  assert.match(script, /const OUTGOING_TRANSLATOR_OPTIONS = \[\s*\["chatgpt", "ChatGPT CLI \(권장·품질 우선\)"/);
  assert.match(script, /Hy-MT2 1\.8B Q4 \(로컬·속도 우선\)/);
  assert.match(script, /Hy-MT2 7B Q4 \(로컬·속도 우선\)/);
  assert.match(script, /TranslateGemma 4B Q4 \(실험·속도 우선\)/);
  assert.doesNotMatch(script, /로컬·간단한 문장|실험·간단한 문장/);
  assert.match(markup, /id="outgoing-model-guidance"/);
  assert.match(markup, /보내는 메시지에는 CLI 모델을 권장합니다/);
  assert.match(styles, /\.outgoing-model-guidance\s*\{[\s\S]*?margin:\s*16px 18px 18px/);
  assert.match(script, /connectedRecommendedProvider/);
  assert.match(script, /applySettingsPatch\(\{ outgoing_translator: provider \}\)/);
  assert.ok(markup.indexOf('id="provider-connections"') < markup.indexOf('id="local-engine-settings"'));
  assert.match(markup, /id="local-engine-settings" aria-labelledby="local-engine-heading"/);
  assert.match(markup, /<div class="panel-subheading"><h3 id="local-engine-heading">로컬 엔진<\/h3>/);
  assert.doesNotMatch(markup, /<div class="card-heading">\s*<span class="card-index" aria-hidden="true">L<\/span>\s*<div><h3>로컬 엔진<\/h3>/);
  assert.doesNotMatch(script, /milmmt_4b|MiLMMT/);
});

test("convenience panel exposes global toggles and editable composer shortcuts", () => {
  assert.match(markup, /<h3>UI Language<\/h3>/);
  assert.match(script, /\["auto", "Auto \(System\)", "", "System language"\]/);
  assert.match(markup, /data-field="ui_language"/);
  assert.match(markup, /id="toggle-shortcut"/);
  assert.match(markup, /id="toggle-outgoing-shortcut"/);
  assert.match(markup, /id="send-immediately-shortcut"/);
  assert.match(markup, /id="review-before-send-shortcut"/);
  assert.match(markup, /<h3>실시간 번역 켜기·끄기<\/h3>/);
  assert.match(markup, /<h3>전송 메시지 통역 켜기·끄기<\/h3>/);
  assert.match(markup, /<h3>즉시 전송<\/h3>/);
  assert.match(markup, /<h3>항상 첨삭<\/h3>/);
  assert.match(markup, /data-icon="keyboard" aria-hidden="true"><svg[^>]*>[\s\S]*?<\/svg><\/span><div><h3>전역 단축키<\/h3>/);
  assert.match(markup, /data-icon="send" aria-hidden="true"><svg[^>]*>[\s\S]*?<\/svg><\/span><div><h3>메시지 입력 단축키<\/h3>/);
  assert.doesNotMatch(markup, /<span class="card-index" aria-hidden="true">(?:K|↵)<\/span>/);
  assert.match(styles, /\.card-index-icon svg\s*\{[\s\S]*?stroke-width:\s*2/);
  assert.match(script, /toggle_outgoing_translation/);
  assert.match(script, /send_outgoing_immediately/);
  assert.match(script, /review_outgoing_before_send/);
  assert.match(script, /request-outgoing-translation-toggle/);
});

test("system autostart is a cross-platform convenience setting that defaults to off", () => {
  assert.match(markup, /<h3>시스템 시작 시 자동 실행<\/h3>/);
  assert.match(markup, /컴퓨터에 로그인하면 앱을 실행하고 Discord 번역 연결을 자동으로 준비합니다/);
  assert.match(markup, /id="autostart"[^>]*aria-checked="false"/);
  assert.doesNotMatch(markup, /Windows 시작 시 자동 실행/);
  assert.match(script, /invoke\("autostart_get"\)/);
  assert.match(script, /invoke\("autostart_set", \{ enabled \}\)/);
  assert.match(script, /autostartEnabled:\s*false/);
  assert.match(rustMain, /fn autostart_get\(/);
  assert.match(rustMain, /fn autostart_set\(/);
  assert.match(rustMain, /autolaunch\(\)\s*\.is_enabled\(\)/);
  assert.match(cargoManifest, /tauri-plugin-autostart = "2"/);
  assert.match(rustMain, /tauri_plugin_autostart::init/);
  assert.doesNotMatch(capabilities, /autostart:allow-/);
});

test("system autostart initialization and registry work stay off the setup thread", () => {
  assert.match(rustMain, /async fn autostart_get\(/);
  assert.match(rustMain, /async fn autostart_set\(/);
  assert.match(rustMain, /fn initialize_autostart_in_background\(/);
  assert.match(rustMain, /spawn_blocking\(move \|\| initialize_autostart/);
  const setup = rustMain.slice(rustMain.indexOf(".setup(|app|"), rustMain.indexOf(".invoke_handler"));
  assert.match(setup, /initialize_autostart_in_background\(app\.handle\(\)\.clone\(\)\)/);
  assert.doesNotMatch(setup, /app\.autolaunch\(\)\.is_enabled\(\)/);
  assert.doesNotMatch(setup, /synchronize_discord_startup\(/);
});

test("Windows autostart owns one private Discord pipe and safely migrates old registrations", () => {
  const startupRuntime = discordStartup.split("#[cfg(test)]")[0];
  assert.doesNotMatch(startupRuntime, /--remote-debugging-port=9222/);
  assert.match(discord, /"--force-renderer-accessibility"/);
  assert.doesNotMatch(discord, /--force-renderer-accessibility=/);
  assert.match(discord, /--remote-debugging-pipe/);
  assert.match(discordStartup, /DiscordStartupBackup/);
  assert.match(discordStartup, /fn suppress_registration/);
  assert.match(discordStartup, /managed:\s*None/);
  assert.match(rustMain, /start_pipe_discord_for_autostart/);
  assert.match(rustMain, /discord_startup::suppress\(\)/);
  assert.match(rustMain, /discord_startup::restore\(\)/);
  assert.match(rustMain, /--restore-discord-startup/);
  assert.match(installerHooks, /NSIS_HOOK_PREUNINSTALL/);
  assert.match(installerHooks, /--restore-discord-startup/);
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
  assert.doesNotMatch(markup, /id="cancel"/);
  assert.match(markup, /<div class="footer-actions"><button class="button primary" id="confirm"/);
  assert.match(styles, /\.footer-actions \.button[\s\S]*white-space:\s*nowrap/);
  assert.match(styles, /\.form-footer\s*\{[\s\S]*position:\s*sticky[\s\S]*bottom:\s*0/);
  assert.match(styles, /\.form-footer\s*\{[\s\S]*min-height:\s*68px/);
  assert.match(styles, /grid-template-areas:\s*"update"\s*"workspace"\s*"footer"/);
  assert.match(styles, /\.settings-workspace\s*\{\s*grid-area:\s*workspace/);
});

test("friends can reveal one privacy-safe diagnostic log file", () => {
  const diagnostics = readFileSync(new URL("../../src-tauri/src/diagnostics.rs", import.meta.url), "utf8");
  const hymt = readFileSync(new URL("../../src-tauri/src/translation/hymt.rs", import.meta.url), "utf8");
  assert.match(diagnostics, /NudeNyangDiscordTranslator\.log/);
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

test("local model preparation can be cancelled without discarding resumable data", () => {
  assert.match(markup, /id="model-banner-cancel"[^>]*hidden/);
  assert.match(script, /invoke\("model_preparation_cancel"\)/);
  assert.match(rustMain, /fn model_preparation_cancel\(/);
  assert.match(rustMain, /engine\.cancel_model_preparation\(\)/);
});

test("dynamic app information and runtime notices follow the interface language", () => {
  assert.match(markup, /data-i18n-key="버전"/);
  assert.match(markup, /data-i18n-key="버전을 설치할 수 있습니다/);
  assert.match(script, /setLocalizedText\(elements\.updateStatus/);
  assert.match(script, /setLocalizedBackendText\(elements\.saveStatus, status\.notice\)/);
  assert.match(script, /translateDynamicCopy\(currentUiLanguage\(\), title\)/);
});
