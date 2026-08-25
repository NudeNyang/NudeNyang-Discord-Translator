import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const i18nSource = readFileSync(new URL("../i18n.mjs", import.meta.url), "utf8");
const rustMain = readFileSync(new URL("../../src-tauri/src/main.rs", import.meta.url), "utf8");
const tauriConfig = readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8");
const packageManifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const cargoManifest = readFileSync(new URL("../../src-tauri/Cargo.toml", import.meta.url), "utf8");
const capabilities = readFileSync(new URL("../../src-tauri/capabilities/default.json", import.meta.url), "utf8");
const installerHooks = readFileSync(new URL("../../src-tauri/windows/hooks.nsh", import.meta.url), "utf8");
const discordStartup = readFileSync(new URL("../../src-tauri/src/discord_startup.rs", import.meta.url), "utf8");
const discord = readFileSync(new URL("../../src-tauri/src/discord.rs", import.meta.url), "utf8");
const rustEngine = readFileSync(new URL("../../src-tauri/src/engine.rs", import.meta.url), "utf8");
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

test("cancelled or failed automatic recovery exposes a quiet manual Discord restart action", () => {
  assert.match(markup, /id="discord-restart-manual"[^>]*hidden[^>]*>[\s\S]*?class="engine-restart-icon"[\s\S]*?<span>Discord 재시작<\/span>[\s\S]*?<\/button>/);
  assert.match(markup, /class="engine-restart-icon"[^>]*data-icon="rotate-ccw"[^>]*>[\s\S]*?M3 12a9 9 0 1 0 9-9[\s\S]*?M3 3v5h5/);
  assert.match(script, /manualDiscordRestartAvailability/);
  assert.match(script, /invoke\("discord_restart", \{[\s\S]*?expectedProcessId:/);
  assert.match(script, /title: "Discord를 다시 시작하시겠습니까\?"/);
  assert.match(script, /dataset\.state = state\.repairActive \? "working" : "idle"/);
  assert.match(script, /setAttribute\("aria-busy", String\(state\.repairActive\)\)/);
  assert.match(script, /if \(!confirmed\) \{\s*state\.restartAttempted = true;\s*state\.manualRestartRequired = true;/);
  assert.match(script, /catch \(error\) \{[\s\S]*?state\.manualRestartRequired = true;[\s\S]*?Discord 자동 재시작 실패/);
  assert.match(styles, /\.engine-actions\s*\{[^}]*display:\s*flex;[^}]*gap:\s*7px;/s);
  assert.match(styles, /\.engine-state\s*\{[^}]*gap:\s*9px;[^}]*min-height:\s*38px;[^}]*padding:\s*0 15px;[^}]*border-radius:\s*999px;[^}]*font-size:\s*13px;/s);
  assert.match(styles, /\.button\.secondary\.engine-restart-button\s*\{[^}]*min-height:\s*38px;[^}]*gap:\s*7px;[^}]*padding:\s*0 12px;[^}]*border-radius:\s*999px;[^}]*border-color:\s*var\(--border\);[^}]*color:\s*var\(--muted\);[^}]*font-size:\s*13px;/s);
  assert.match(styles, /\.button\.secondary\.engine-restart-button\[hidden\]\s*\{[^}]*display:\s*none;/s);
  assert.match(styles, /\.engine-restart-icon\s*\{[^}]*width:\s*16px;[^}]*stroke-width:\s*2;/s);
  assert.match(styles, /\.engine-restart-button\[data-state="working"\] \.engine-restart-icon\s*\{[^}]*animation:\s*engine-restart-spin/s);
  assert.match(rustMain, /let display_was_enabled = client\.status\(\)\?\.enabled;/);
  assert.match(rustMain, /client\.set_enabled\(display_was_enabled\)/);
  const restartCommand = rustMain.match(/async fn discord_restart\([\s\S]*?\n\}/)?.[0] || "";
  assert.match(restartCommand, /discord::restart_pipe\(expected_process_id, discord_variant\)/);
  assert.doesNotMatch(restartCommand, /connect_or_restart_pipe/);
  assert.match(rustEngine, /ReplaceCdp\(CdpClient, mpsc::Sender<Result<\(\), String>>\)/);
  assert.match(rustEngine, /recv_timeout\(Duration::from_secs\(30\)\)/);
});

test("the manual Discord restart label uses one language-appropriate typeface", () => {
  assert.match(styles, /--engine-action-font:\s*"Segoe UI Variable", "Segoe UI", sans-serif;/);
  assert.match(styles, /:root:lang\(ko\)\s*\{[^}]*--engine-action-font:\s*"Noto Sans KR", "Malgun Gothic", sans-serif;/s);
  assert.match(styles, /:root:lang\(ja\)\s*\{[^}]*--engine-action-font:\s*"Noto Sans JP", "Yu Gothic UI", "Meiryo UI", sans-serif;/s);
  assert.match(styles, /:root:lang\(zh-CN\)\s*\{[^}]*--engine-action-font:\s*"Microsoft YaHei UI", "Microsoft YaHei", sans-serif;/s);
  assert.match(styles, /:root:lang\(zh-TW\)\s*\{[^}]*--engine-action-font:\s*"Microsoft JhengHei UI", "Microsoft JhengHei", sans-serif;/s);
  assert.match(styles, /:root:is\(:lang\(hi\), :lang\(bn\), :lang\(ta\), :lang\(ur\)\)\s*\{[^}]*--engine-action-font:\s*"Nirmala UI", "Segoe UI", sans-serif;/s);
  assert.match(styles, /:root:lang\(th\)\s*\{[^}]*--engine-action-font:\s*"Leelawadee UI", "Segoe UI", sans-serif;/s);
  assert.match(styles, /:root:is\(:lang\(ar\), :lang\(fa\), :lang\(he\)\)\s*\{[^}]*--engine-action-font:\s*"Segoe UI", Tahoma, sans-serif;/s);
  assert.match(styles, /\.engine-state\s*\{[^}]*font-family:\s*var\(--engine-action-font\);[^}]*font-weight:\s*500;/s);
  assert.match(styles, /\.button\.secondary\.engine-restart-button\s*\{[^}]*font-family:\s*var\(--engine-action-font\);[^}]*font-weight:\s*500;/s);
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
  assert.equal(packageManifest.version, "0.7.1-beta");
  assert.match(tauriConfig, /"version": "0\.7\.1-beta"/);
  assert.match(cargoManifest, /^version = "0\.7\.1-beta"$/m);
  assert.match(markup, /<span id="app-version">0\.7\.1 Beta<\/span>/);
  assert.match(script, /replace\(\/-beta\$\/i, " Beta"\)/);
});

test("the installer migrates legacy shortcuts to the NudeNyang Discord Translator name", () => {
  assert.match(tauriConfig, /"installerHooks": "\.\/windows\/hooks\.nsh"/);
  assert.match(installerHooks, /NudeNyang Discord Translator\.lnk/);
  assert.match(installerHooks, /Delete "\$DESKTOP\\NudeNyang Discord Translator\.lnk"/);
  assert.match(installerHooks, /Delete "\$DESKTOP\\Nude Translator\.lnk"/);
  assert.match(installerHooks, /Delete "\$SMPROGRAMS\\Nude Translator\.lnk"/);
});

test("settings use eight uniform navigation categories including web translation", () => {
  for (const panel of ["translation", "engine", "web", "storage", "image", "dictionary", "convenience", "about"]) {
    assert.match(markup, new RegExp(`data-settings-panel="${panel}"`));
    assert.match(markup, new RegExp(`data-settings-view="${panel}"`));
  }
  assert.match(markup, /<span>번역<\/span>/);
  assert.match(markup, /<span>번역 엔진<\/span>/);
  assert.match(markup, /<span>웹 번역<\/span>/);
  assert.match(markup, /<span>저장 공간<\/span>/);
  assert.match(markup, /<span>이미지 번역<\/span>/);
  assert.match(markup, /<span>사전<\/span>/);
  assert.match(markup, /<span>편의 기능<\/span>/);
  assert.match(markup, /<span>앱 정보<\/span>/);
  for (const icon of ["language", "cpu", "world", "photo", "book", "adjustments-horizontal", "database", "info-circle"]) {
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
  assert.equal(windowConfig.width, 1180);
  assert.equal(windowConfig.height, 780);
  assert.equal(windowConfig.minWidth, 900);
  assert.equal(windowConfig.minHeight, 560);
  assert.ok(windowConfig.minWidth > 760);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.settings-navigation\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(styles, /\.settings-navigation\s*\{[^}]*overflow-x:\s*auto/);
});

test("wider settings window lets localized descriptions use the available width", () => {
  assert.match(styles, /\.app-shell\s*\{[^}]*width:\s*min\(100%,\s*1120px\)/s);
  assert.match(styles, /\.setting-copy p\s*\{[^}]*max-width:\s*68ch;/s);
  assert.match(styles, /\.feature-copy p\s*\{[^}]*max-width:\s*72ch;/s);
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
  assert.doesNotMatch(script, /outgoing_confirm_send/);
  assert.match(script, /keep_local_model_warm: enabled/);
  assert.match(script, /scheduleCaptureFpsUpdate/);
  assert.match(script, /applyShortcutImmediately/);
});

test("web translation panel owns browser batching, usage protection, and site policies", () => {
  const webPanel = markup.match(/data-settings-view="web"[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(markup, /Chrome, Whale과 Firefox/);
  assert.match(script, /firefox:\s*"Mozilla Firefox"/);
  assert.match(markup, /id="web-translation-enabled"/);
  assert.match(markup, /data-field="web_target_language"/);
  assert.match(markup, /data-field="web_processing_mode"/);
  assert.match(markup, /data-field="web_external_page_char_limit"/);
  assert.doesNotMatch(webPanel, /id="web-quick-toggle-shortcut"/);
  assert.match(markup, /id="web-browser-clients"/);
  assert.match(markup, /id="web-site-policies"/);
  assert.match(script, /browser_clients_status/);
  assert.doesNotMatch(script, /browser_shortcut_settings_open/);
  assert.match(script, /web_quick_toggle_shortcut/);
  assert.match(script, /web_site_policies/);
  assert.match(script, /web_target_language: \[\["display", "언어 감지"\]/);
});

test("사이트별 동작은 제품형 셀렉트와 대량 목록 검색을 사용한다", () => {
  const renderPolicies = script.match(/function renderWebSitePolicies\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(script, /function createWebPolicySelect\(/);
  assert.match(script, /className = "custom-select web-policy-select"/);
  assert.doesNotMatch(renderPolicies, /createElement\("select"\)/);
  assert.match(script, /WEB_SITE_POLICY_SEARCH_THRESHOLD\s*=\s*6/);
  assert.match(script, /web-site-policy-search/);
  assert.match(script, /web-site-policy-list/);
  assert.match(script, /web-site-policy-empty-search/);
  assert.match(script, /closest\("\.web-site-policy-list\.is-scrollable/);
  assert.match(styles, /\.web-site-policy-list\.is-scrollable\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /\.web-site-policy-list::-webkit-scrollbar-thumb/);
});

test("received message nickname translation defaults on and saves immediately", () => {
  const incomingCard = markup.match(/<article class="settings-card">[\s\S]*?<h3>받는 메시지<\/h3>[\s\S]*?<\/article>/)?.[0] || "";
  assert.match(incomingCard, /id="translate-nicknames"/);
  assert.match(incomingCard, /닉네임 번역하기/);
  assert.match(incomingCard, /id="translate-nicknames"[^>]*aria-checked="true"/);
  assert.ok(incomingCard.indexOf("source-language-select") < incomingCard.indexOf("translate-nicknames"));
  assert.match(script, /applySettingsPatch\(\{ translate_nicknames: enabled \}\)/);
  assert.match(rustEngine, /translate_nicknames/);
});

test("outgoing interpretation asks only when automatic language detection is uncertain", () => {
  assert.match(
    styles,
    /\.settings-grid\.two-column\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[^}]*align-items:\s*start;/s,
  );
  assert.match(markup, /class="card-index message-direction-icon message-direction-icon--incoming" aria-hidden="true">↓<\/span>[\s\S]*?<h3>받는 메시지<\/h3>/);
  assert.match(markup, /class="card-index message-direction-icon message-direction-icon--outgoing" aria-hidden="true">↑<\/span>[\s\S]*?<h3>보내는 메시지<\/h3>/);
  assert.doesNotMatch(markup, /class="card-index" aria-hidden="true">0[123]<\/span>/);
  assert.match(markup, /<h3>전송 메시지 통역<\/h3>/);
  assert.match(markup, /id="outgoing-translation"/);
  assert.match(markup, /<h3>기본 전송 언어<\/h3>/);
  assert.match(markup, /data-field="outgoing_target_language"/);
  assert.doesNotMatch(markup, /채널별 첫 감지 확인/);
  assert.doesNotMatch(markup, /id="outgoing-confirm-language"/);
  assert.doesNotMatch(markup, /id="outgoing-confirm-send"/);
  assert.doesNotMatch(markup, /사용자 전송|첫 Enter로 번역문을 입력창에 준비하고/);
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
  assert.doesNotMatch(script, /outgoing_confirm_send/);
  assert.match(markup, /id="translation-shortcut-hint">F12<\/kbd>/);
  assert.match(markup, /id="outgoing-shortcut-hint">F8<\/kbd>/);
  assert.match(script, /elements\.translationShortcutHint\.textContent = state\.config\.hotkeys\.toggle_translation/);
  assert.match(script, /elements\.outgoingShortcutHint\.textContent = state\.config\.hotkeys\.toggle_outgoing_translation/);
  assert.doesNotMatch(markup, /공통 번역 규칙|번역 말투|data-field="speech_style"/);
  assert.doesNotMatch(script, /speech_style/);
});

test("textareas inherit the same interface font as other form controls", () => {
  assert.match(styles, /button,\s*input,\s*select,\s*textarea\s*\{[^}]*font:\s*inherit;/s);
});

test("incoming translation can be limited to selected source languages", () => {
  assert.match(markup, /<h3>번역할 원문 언어<\/h3>/);
  assert.match(markup, /id="source-language-select"/);
  assert.match(markup, /id="source-language-options"[^>]*aria-multiselectable="true"/);
  assert.match(markup, /모든 언어를 번역하거나 선택한 언어만 번역합니다/);
  assert.doesNotMatch(markup, /source-language-cancel|source-language-apply/);
  assert.doesNotMatch(styles, /source-language-actions/);
  assert.doesNotMatch(script, /sourceLanguageDraft/);
  assert.match(script, /nextIncomingSourceLanguageSelection/);
  assert.match(script, /await applySettingsPatch\(patch\)/);
  assert.match(script, /filterLanguageOptions\(LANGUAGE_OPTIONS, elements\.sourceLanguageSearch\.value\)/);
  assert.match(styles, /\.source-language-option\[aria-selected="true"\]::after/);
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
  assert.match(
    markup,
    /받은 메시지는 빠른 로컬 모델로, 보낼 메시지는 문맥과 말투에 강한 CLI 모델로 번역하는 구성을 권장합니다\./,
  );
  assert.match(markup, /<h3>표시 언어 번역 모델<\/h3>/);
  assert.match(markup, /많은 메시지와 이미지를 계속 처리하므로 빠른 로컬 모델 사용을 권장합니다\./);
  assert.match(markup, /data-field="translator"/);
  assert.match(markup, /<h3>보내는 메시지 통역 모델<\/h3>/);
  assert.match(markup, /의미와 말투를 자연스럽게 전달하도록 품질 우선 CLI 모델 사용을 권장합니다\./);
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
  assert.match(markup, /권장 품질을 사용하려면 CLI 모델 연결이 필요합니다/);
  assert.match(styles, /\.outgoing-model-guidance\s*\{[\s\S]*?margin:\s*16px 18px 18px/);
  assert.match(
    markup,
    /위에서 선택한 서비스 하나만 연결하면 됩니다\. 다른 서비스는 필요할 때 연결할 수 있습니다\./,
  );
  assert.match(markup, /class="provider-use-badge" hidden>현재 사용<\/span>/);
  assert.match(styles, /\.provider-row\[data-current="true"\]/);
  assert.match(script, /badge\.hidden = !current/);
  assert.match(script, /setLocalizedText\(badge, connected \? "현재 사용" : "선택됨"\)/);
  assert.match(script, /action\.dataset\.mode = "connect"/);
  assert.match(script, /connectedRecommendedProvider/);
  assert.match(script, /applySettingsPatch\(\{ outgoing_translator: provider \}\)/);
  assert.ok(markup.indexOf('id="provider-connections"') < markup.indexOf('id="local-engine-settings"'));
  assert.match(markup, /id="local-engine-settings" aria-labelledby="local-engine-heading"/);
  assert.match(markup, /<div class="panel-subheading"><h3 id="local-engine-heading">로컬 엔진<\/h3>/);
  assert.doesNotMatch(markup, /<div class="card-heading">\s*<span class="card-index" aria-hidden="true">L<\/span>\s*<div><h3>로컬 엔진<\/h3>/);
  assert.doesNotMatch(script, /milmmt_4b|MiLMMT/);
});

test("convenience panel exposes the Discord target and global translation toggles", () => {
  const uiLanguageIndex = markup.indexOf("<h3>UI Language</h3>");
  const settingsThemeIndex = markup.indexOf("<h3>설정창 테마</h3>");
  const discordSelectionIndex = markup.indexOf("<h3>Discord 선택</h3>");

  assert.ok(uiLanguageIndex < settingsThemeIndex);
  assert.ok(settingsThemeIndex < discordSelectionIndex);
  assert.match(markup, /<h3>Discord 선택<\/h3>/);
  assert.match(markup, /번역을 적용할 Discord 앱을 선택합니다\./);
  assert.match(markup, /data-field="discord_variant"/);
  assert.match(script, /\["stable", "Discord"\]/);
  assert.match(script, /\["ptb", "Discord PTB"\]/);
  assert.match(script, /\["canary", "Discord Canary"\]/);
  assert.match(script, /invoke\("discord_target_switch"\)/);
  assert.match(script, /applySettingsPatch\(\{ discord_variant: value \}\)/);
  assert.match(rustMain, /async fn discord_target_switch\(/);
  assert.match(markup, /<h3>UI Language<\/h3>/);
  assert.match(script, /\["auto", "Auto \(System\)", "", "System language"\]/);
  assert.match(markup, /data-field="ui_language"/);
  assert.match(markup, /id="toggle-shortcut"/);
  assert.match(markup, /id="toggle-outgoing-shortcut"/);
  assert.doesNotMatch(markup, /id="send-immediately-shortcut"/);
  assert.doesNotMatch(markup, /id="review-before-send-shortcut"/);
  assert.match(markup, /<h3>실시간 번역 켜기·끄기<\/h3>/);
  assert.match(markup, /<h3>전송 메시지 통역 켜기·끄기<\/h3>/);
  assert.doesNotMatch(markup, /<h3>즉시 전송<\/h3>/);
  assert.doesNotMatch(markup, /<h3>항상 첨삭<\/h3>/);
  assert.match(markup, /data-icon="keyboard" aria-hidden="true"><svg[^>]*>[\s\S]*?<\/svg><\/span><div><h3>전역 단축키<\/h3>/);
  assert.doesNotMatch(markup, /<h3>메시지 입력 단축키<\/h3>/);
  assert.doesNotMatch(markup, /<span class="card-index" aria-hidden="true">(?:K|↵)<\/span>/);
  assert.match(styles, /\.card-index-icon svg\s*\{[\s\S]*?stroke-width:\s*2/);
  assert.match(script, /toggle_outgoing_translation/);
  assert.doesNotMatch(script, /send_outgoing_immediately/);
  assert.doesNotMatch(script, /review_outgoing_before_send/);
  assert.match(script, /request-outgoing-translation-toggle/);
  assert.match(
    rustMain,
    /ShortcutAction::OutgoingTranslation => toggle_outgoing_translation_from_shortcut\(app\)/,
  );
  assert.match(rustMain, /engine\.set_enabled_from_shortcut\(enabled\)/);
  assert.match(rustEngine, /Control::SetOutgoingControlVisible\(visible\)/);
});

test("웹 번역 전환키는 편의 기능의 단축키 카드에서 관리한다", () => {
  const conveniencePanel = markup.match(/data-settings-view="convenience"[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(conveniencePanel, /class="settings-card shortcut-card"/);
  assert.match(conveniencePanel, /<h3>웹 번역 전환키<\/h3>/);
  assert.match(conveniencePanel, /id="web-quick-toggle-shortcut"/);
  assert.match(conveniencePanel, /id="web-quick-toggle-shortcut-help"/);
  assert.doesNotMatch(conveniencePanel, /Delete를 누르면 사용하지 않습니다/);
});

test("브라우저 연결 목록은 상태와 버전만 표시한다", () => {
  assert.match(markup, /확장 프로그램이 연결되면 브라우저와 버전을 여기에 표시합니다\./);
  assert.doesNotMatch(markup, /브라우저 단축키 변경/);
  assert.doesNotMatch(script, /web-client-shortcut-button/);
});

test("convenience controls stay compact in wider settings windows", () => {
  assert.match(
    styles,
    /\.settings-view\[data-settings-view="convenience"\] \.setting-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(210px,\s*250px\);/s,
  );
  assert.match(
    styles,
    /\.settings-view\[data-settings-view="convenience"\] \.setting-row\s*>\s*:\s*last-child\s*\{[^}]*justify-self:\s*end;/s,
  );
  assert.doesNotMatch(
    styles,
    /\.settings-view\[data-settings-view="convenience"\] \.setting-row\s*>\s*:\s*last-child\s*\{[^}]*width:\s*100%/s,
  );
  assert.match(
    styles,
    /\.settings-view\[data-settings-view="convenience"\] \.setting-row\s*>\s*\.custom-select,\s*\.settings-view\[data-settings-view="convenience"\] \.setting-row\s*>\s*\.shortcut-editor\s*\{[^}]*width:\s*100%;/s,
  );
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
  assert.match(styles, /grid-template-areas:\s*"update"\s*"verification"\s*"workspace"\s*"footer"/);
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

test("dictionary settings expose local packs, personal terms, and an optional external handoff", () => {
  assert.match(markup, /id="dictionary-enabled"/);
  assert.match(markup, /data-field="dictionary_external_provider"/);
  assert.match(markup, /id="dictionary-personal-list"/);
  assert.match(markup, /id="dictionary-pack-list"/);
  assert.match(script, /dictionary_personal_upsert/);
  assert.match(script, /dictionary_pack_install/);
  assert.match(script, /dictionary_storage_folder_open/);
});

test("personal dictionary management scales to searchable and portable collections", () => {
  assert.match(markup, /id="dictionary-personal-manager"[^>]*hidden/);
  assert.match(markup, /id="dictionary-personal-search"/);
  assert.match(markup, /id="dictionary-filter-source"/);
  assert.doesNotMatch(markup, /id="dictionary-filter-target"/);
  assert.match(markup, /id="dictionary-selection-bar"[^>]*hidden/);
  assert.match(markup, /id="dictionary-editor-layer"[^>]*hidden/);
  assert.doesNotMatch(markup, /id="dictionary-editor-close"/);
  assert.match(markup, /id="dictionary-import-layer"[^>]*hidden/);
  assert.match(markup, /id="dictionary-tags"/);
  assert.doesNotMatch(markup, /id="dictionary-(?:pinned|case-sensitive|whole-word)"/);
  assert.doesNotMatch(markup, /class="dictionary-editor-options"/);
  assert.doesNotMatch(styles, /\.dictionary-editor-options/);
  assert.doesNotMatch(script, /elements\.dictionary(?:Pinned|CaseSensitive|WholeWord)/);
  assert.doesNotMatch(script, /elements\.dictionaryEditorClose/);
  assert.match(script, /\.\.\.\(state\.dictionaryEditingEntry \|\| \{\}\)/);
  assert.match(script, /invoke\("dictionary_personal_query"/);
  assert.match(script, /invoke\("dictionary_personal_batch_upsert"/);
  assert.match(script, /invoke\("dictionary_personal_batch_delete"/);
  assert.match(script, /schemaVersion:\s*1/);
  assert.match(script, /dictionaryImportValue\(raw, "scope"/);
  assert.match(script, /dictionaryImportValue\(raw, "scopeValue"/);
  assert.match(script, /page\.offset >= page\.total/);
  assert.match(script, /const currentPage = page\.total \? Math\.floor\(page\.offset \/ page\.limit\) \+ 1 : 0;/);
  assert.match(script, /const totalPages = page\.total \? Math\.ceil\(page\.total \/ page\.limit\) : 0;/);
  assert.match(script, /dictionaryPageSummary\.textContent = `\$\{currentPage\.toLocaleString\(\)\} \/ \$\{totalPages\.toLocaleString\(\)\}`/);
  assert.doesNotMatch(script, /dictionaryPageSummary\.textContent = `\$\{first\.toLocaleString\(\)\}–\$\{last\.toLocaleString\(\)\}/);
  assert.match(script, /navigator\.clipboard\.writeText/);
  assert.match(styles, /\.dictionary-manager-toolbar\s*\{/);
  assert.match(styles, /\.dictionary-row-actions\s*\{[^}]*opacity:\s*1;/s);
  assert.doesNotMatch(styles, /\.dictionary-row-actions\s*\{[^}]*opacity:\s*0\.42;/s);
  assert.doesNotMatch(styles, /\.dictionary-manager-row:hover \.dictionary-row-actions/);
});

test("editing a personal term replaces cancel with delete", () => {
  assert.match(markup, /class="button secondary"[^>]*id="dictionary-editor-cancel"[^>]*>취소<\/button>/);
  assert.match(
    script,
    /function updateDictionaryEditorSecondaryAction\(\)\s*\{[\s\S]*?Boolean\(state\.dictionaryEditingEntry\)[\s\S]*?classList\.toggle\("secondary", !editing\)[\s\S]*?classList\.toggle\("danger", editing\)[\s\S]*?editing \? "삭제" : "취소"/,
  );
  assert.match(
    script,
    /async function deleteDictionaryEditingEntry\(\)[\s\S]*?invoke\("dictionary_personal_delete", \{ id: entry\.id \}\)[\s\S]*?reloadDictionaryPersonalData\(\)[\s\S]*?"개인 사전 용어를 삭제했습니다\."/,
  );
  assert.match(
    script,
    /dictionaryEditorCancel\.addEventListener\("click", \(\) => \{[\s\S]*?state\.dictionaryEditingEntry[\s\S]*?deleteDictionaryEditingEntry\(\)/,
  );
  assert.match(
    styles,
    /#dictionary-editor-cancel\.button\.danger\s*\{[\s\S]*?border-color:\s*var\(--danger\);[\s\S]*?color:\s*#ffffff;[\s\S]*?background:\s*var\(--danger\);/,
  );
});

test("dictionary popup saves refresh the open settings dictionary immediately", () => {
  assert.match(
    rustEngine,
    /store\.upsert_personal\([\s\S]*?app\.emit_to\("main", "dictionary-personal-changed"/,
  );
  assert.match(rustMain, /dictionary_personal_upsert\([\s\S]*?AppHandle[\s\S]*?emit_to\("main", "dictionary-personal-changed"/);
  assert.match(
    script,
    /function applyDictionaryPersonalOverviewChange\(entry\)[\s\S]*?state\.dictionaryPersonalEntries[\s\S]*?slice\(0, 3\)[\s\S]*?renderDictionaryPersonalEntries\(\)/,
  );
  assert.match(
    script,
    /const saved = await invoke\("dictionary_personal_upsert", \{ entry \}\);[\s\S]*?applyDictionaryPersonalOverviewChange\(saved\)[\s\S]*?reloadDictionaryPersonalData\(\)/,
  );
  assert.match(
    script,
    /tauriListen\("dictionary-personal-changed", event => \{[\s\S]*?applyDictionaryPersonalOverviewChange\(event\.payload\)[\s\S]*?reloadDictionaryPersonalData\(\)/,
  );
  assert.match(
    script,
    /if \(panel === "dictionary"\) loadDictionaryData\(true\)/,
  );
  assert.match(script, /dictionaryOverviewRequests\.begin\(\)[\s\S]*?dictionaryOverviewRequests\.isCurrent/);
  assert.match(script, /window\.addEventListener\("focus", syncVisibleDictionaryPersonalData\)/);
  assert.match(script, /setInterval\([\s\S]*?syncVisibleDictionaryPersonalData[\s\S]*?1500/);
});

test("personal term deletion confirmation opens above the editor", () => {
  assert.match(
    script,
    /async function deleteDictionaryEditingEntry\(\)[\s\S]*?showModal\(\{[\s\S]*?variant:\s*"dictionary-action"/,
  );
  assert.match(
    styles,
    /\.modal-layer\[data-variant="dictionary-action"\]\s*\{\s*z-index:\s*1200;/,
  );
  assert.match(
    styles,
    /\.modal-layer\[data-variant="dictionary-action"\]\s+#modal-accept\s*\{[\s\S]*?border-color:\s*var\(--danger\);[\s\S]*?color:\s*#ffffff;[\s\S]*?background:\s*var\(--danger\);/,
  );
});

test("personal dictionary selection uses a bottom action dock and clean row toggles", () => {
  const searchIndex = markup.indexOf('id="dictionary-personal-search"');
  const favoriteIndex = markup.indexOf('id="dictionary-filter-pinned"');
  const sourceIndex = markup.indexOf('id="dictionary-filter-source"');
  const sortIndex = markup.indexOf('id="dictionary-sort"');
  assert.ok(favoriteIndex > -1 && favoriteIndex < searchIndex && searchIndex < sourceIndex && sourceIndex < sortIndex);
  assert.match(markup, /id="dictionary-selection-all"[^>]*>전체 선택<\/button>/);
  assert.match(markup, /id="dictionary-selection-clear"[^>]*>선택 취소<\/button>/);
  assert.match(markup, /id="dictionary-selection-delete"[^>]*>선택 항목 삭제<\/button>/);
  assert.doesNotMatch(markup, /id="dictionary-selection-pin"/);
  assert.doesNotMatch(markup, /id="dictionary-selection-unpin"/);
  assert.match(script, /selector\.className = "dictionary-row-selector"/);
  assert.match(script, /selector\.setAttribute\("aria-pressed", String\(selected\)\)/);
  assert.doesNotMatch(script, /check\.type = "checkbox"/);
  assert.match(script, /dictionaryPersonalPage\.entries\.forEach\(entry => state\.dictionarySelectedIds\.add\(entry\.id\)\)/);
  assert.match(script, /dictionarySelectedIds\.clear\(\);[\s\S]*?renderDictionaryManagerEntries\(\)/);
  assert.match(styles, /\.dictionary-selection-bar\s*\{[^}]*position:\s*fixed;[^}]*left:\s*50%;[^}]*bottom:/s);
  assert.match(styles, /\.dictionary-row-selector\s*\{[^}]*border-radius:\s*50%;/s);
});

test("personal dictionary management uses the full settings workspace", () => {
  assert.match(markup, /id="settings-workspace"[^>]*class="settings-workspace"/);
  assert.match(markup, /id="settings-navigation"[^>]*class="settings-navigation"/);
  assert.match(script, /settingsWorkspace\.dataset\.focusView = "dictionary-manager"/);
  assert.match(script, /delete elements\.settingsWorkspace\.dataset\.focusView/);
  assert.match(script, /settingsNavigation\.hidden = true/);
  assert.match(script, /settingsNavigation\.hidden = false/);
  assert.match(styles, /\.settings-workspace\[data-focus-view="dictionary-manager"\]\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(styles, /\.settings-navigation\[hidden\]\s*\{[^}]*display:\s*none/s);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.dictionary-manager-header\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.dictionary-manager-toolbar\s*\{[^}]*grid-template-columns:\s*42px minmax\(180px, 1fr\)/s);
});

test("personal dictionary controls use localized custom selects and center the back icon", () => {
  assert.match(
    markup,
    /id="dictionary-personal-back"[^>]*>[\s\S]*?class="dictionary-back-icon"[\s\S]*?<path d="M15 6l-6 6l6 6"\/>[\s\S]*?<\/button>/,
  );
  assert.match(
    styles,
    /\.dictionary-back-button\s*\{[^}]*padding:\s*0;[^}]*font-size:\s*0;/s,
  );
  assert.match(
    styles,
    /\.dictionary-back-icon\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*margin:\s*auto;[^}]*width:\s*18px;[^}]*height:\s*18px;/s,
  );
  assert.match(
    markup,
    /class="dictionary-manager-title">[\s\S]*?id="dictionary-personal-back"[\s\S]*?<span class="feature-badge">개인 사전<\/span>[\s\S]*?<h2 id="dictionary-manager-heading">저장한 용어 관리<\/h2>/,
  );
  assert.match(
    styles,
    /\.dictionary-manager-title\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*38px minmax\(0, 1fr\);/s,
  );
  assert.match(
    styles,
    /\.dictionary-back-button\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*2;[^}]*align-self:\s*center;/s,
  );
  assert.match(
    markup,
    /id="dictionary-sort"[^>]*data-custom-select[^>]*>[\s\S]*?data-i18n-key="최근 수정순"[\s\S]*?data-i18n-key="오래된 수정순"[\s\S]*?data-i18n-key="원문 오름차순"[\s\S]*?data-i18n-key="표시어 오름차순"/,
  );
  assert.match(script, /function initializeDictionaryCustomSelect\(select, \{ searchable = false \} = \{\}\)/);
  assert.match(script, /function refreshDictionaryCustomSelects\(\{ rebuild = false \} = \{\}\)/);
  assert.match(script, /refreshDictionaryCustomSelects\(\{ rebuild: true \}\)/);
  assert.match(script, /select\.dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/);
  assert.match(styles, /\.dictionary-native-select\s*\{[^}]*position:\s*absolute;[^}]*width:\s*1px;[^}]*height:\s*1px;/s);
  assert.match(styles, /\.dictionary-custom-select \.select-trigger\s*\{[^}]*min-height:\s*42px;/s);
  assert.match(styles, /\.select-menu\s*\{[^}]*scrollbar-color:\s*transparent transparent;/s);
  assert.match(styles, /\.select-menu:hover\s*\{[^}]*scrollbar-color:\s*var\(--scroll\) transparent;/s);
  assert.match(styles, /\.select-menu::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*transparent;/s);
  assert.match(styles, /\.select-menu:hover::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--scroll\);/s);
});

test("personal dictionary editor shares searchable language selects and icon pagination", () => {
  for (const id of ["dictionary-source-language", "dictionary-target-language"]) {
    assert.match(
      markup,
      new RegExp(`id="${id}"[^>]*data-custom-select[^>]*data-searchable`),
    );
  }
  assert.match(
    script,
    /refreshDictionaryCustomSelect\(elements\.dictionarySourceLanguage\);[\s\S]*?refreshDictionaryCustomSelect\(elements\.dictionaryTargetLanguage\);/,
  );
  assert.match(
    script,
    /element\.closest\("\.dictionary-editor-modal, \.dictionary-import-modal"\);[\s\S]*?selectViewport\.getBoundingClientRect\(\)[\s\S]*?elements\.settingsScroll\.getBoundingClientRect\(\)/,
  );
  assert.match(
    markup,
    /id="dictionary-page-prev"[^>]*aria-label="이전"[^>]*>[\s\S]*?class="dictionary-page-icon"[\s\S]*?<path d="M15 6l-6 6l6 6"\/>[\s\S]*?<\/button>/,
  );
  assert.match(
    markup,
    /id="dictionary-page-next"[^>]*aria-label="다음"[^>]*>[\s\S]*?class="dictionary-page-icon"[\s\S]*?<path d="M9 6l6 6l-6 6"\/>[\s\S]*?<\/button>/,
  );
  assert.match(styles, /\.button\.dictionary-page-button\s*\{[^}]*width:\s*40px;[^}]*min-width:\s*40px;[^}]*padding:\s*0;/s);
  assert.match(styles, /\.dictionary-page-icon\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/s);
});

test("personal dictionary toolbar prioritizes export format, source language, and favorites", () => {
  const formatIndex = markup.indexOf('id="dictionary-export-format"');
  const importIndex = markup.indexOf('id="dictionary-manager-import"');
  const exportIndex = markup.indexOf('id="dictionary-manager-export"');
  assert.ok(formatIndex > -1 && formatIndex < importIndex && importIndex < exportIndex);
  assert.match(
    markup,
    /id="dictionary-filter-pinned"[^>]*class="dictionary-favorite-filter"[^>]*aria-label="즐겨찾기"[^>]*aria-pressed="false"[^>]*>[\s\S]*?dictionary-favorite-filter-star[^>]*>☆<\/span><\/button>/,
  );
  assert.doesNotMatch(markup, /dictionary-filter-check/);
  assert.doesNotMatch(script, /dictionaryFilterTarget/);
  assert.match(script, /dictionaryFilterPinned\.getAttribute\("aria-pressed"\) !== "true"/);
  assert.match(script, /dictionaryFilterPinned\.setAttribute\("aria-pressed", String\(enabled\)\)/);
  assert.match(script, /dictionary-favorite-filter-star"\)\.textContent = enabled \? "★" : "☆"/);
  assert.match(styles, /\.dictionary-manager-actions \.dictionary-custom-select \.select-trigger\s*\{[^}]*font-size:\s*13px;[^}]*font-weight:\s*650;/s);
  assert.match(styles, /\.dictionary-manager-toolbar\s*\{[^}]*grid-template-columns:\s*42px minmax\(240px, 1\.3fr\)/s);
  assert.doesNotMatch(styles, /\.dictionary-favorite-filter\s*\{[^}]*margin-inline-start:\s*auto;/s);
  assert.match(styles, /\.dictionary-favorite-filter\[aria-pressed="true"\]/);
});

test("personal dictionary copies source terms and uses the shared borderless tooltip", () => {
  assert.match(script, /entry\.pinned \? "즐겨찾기 해제" : "즐겨찾기에 추가"/);
  assert.match(script, /dictionaryIconButton\("⧉", "원문 용어 복사"\)/);
  assert.match(script, /navigator\.clipboard\.writeText\(entry\.sourceTerm\)/);
  assert.match(script, /setLocalizedText\(elements\.saveStatus, "원문 용어를 복사했습니다\."\)/);
  assert.doesNotMatch(script, /button\.title = translateCopy/);
  assert.match(script, /button\.dataset\.tooltip = translated/);
  assert.match(styles, /\[data-tooltip\]::after\s*\{[^}]*border:\s*0;[^}]*content:\s*attr\(data-tooltip\)/s);
  assert.match(styles, /\[data-tooltip\]:is\(:hover, :focus-visible\)::after/);
  assert.match(styles, /\.dictionary-manager-list\s*\{[^}]*overflow:\s*visible;/s);
  assert.match(styles, /\.dictionary-manager-row:first-child\s*\{[^}]*border-start-start-radius:/s);
  assert.match(styles, /\.dictionary-manager-row:last-child\s*\{[^}]*border-end-start-radius:/s);
});

test("dictionary pack cards keep compact metadata and open consolidated source notices", () => {
  assert.match(markup, /id="dictionary-pack-licenses"[^>]*>[\s\S]*?출처 및 라이선스[\s\S]*?<\/button>/);
  assert.match(script, /dictionaryPackLicenses:\s*document\.querySelector\("#dictionary-pack-licenses"\)/);
  assert.match(script, /message:\s*DICTIONARY_NOTICES_TEXT/);
  const renderer = script.match(/function renderDictionaryPacks\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(renderer, /"압축 용량"[\s\S]*?formatStorageSize\(pack\.compressedBytes\)/);
  assert.match(renderer, /"디스크 사용량"[\s\S]*?formatStorageSize\(status\.databaseBytes\)/);
  assert.doesNotMatch(renderer, /pack\.sourceName/);
});

test("offline dictionaries use an uncluttered installed summary and a full-width pack manager", () => {
  assert.match(markup, /id="dictionary-pack-manager-open"[^>]*>언어팩 관리<\/button>/);
  assert.match(markup, /id="dictionary-pack-manager"[^>]*class="dictionary-manager dictionary-pack-manager"[^>]*hidden/);
  assert.match(markup, /id="dictionary-pack-search"[^>]*placeholder="설치할 언어 검색"/);
  assert.match(markup, /id="dictionary-pack-filter"[^>]*data-custom-select/);
  assert.match(script, /function openDictionaryPackManager\(\)/);
  assert.match(script, /elements\.settingsNavigation\.hidden = true/);
  assert.match(script, /const installed = practical\.filter\(pack => pack\.installed && pack\.edition === "practical"\)/);
  assert.doesNotMatch(script, /setLocalizedText\(title, "다음 언어팩"\)/);
  assert.match(styles, /\.dictionary-pack-list\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /\.dictionary-pack-manager-list\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
});

test("dictionary pack sorting resolves the automatic UI language before using locale APIs", () => {
  assert.match(script, /resolveUiLanguage,/);
  assert.match(script, /const language = resolveUiLanguage\(currentUiLanguage\(\)\);/);
});

test("mouse back closes either full-width dictionary manager", () => {
  assert.match(script, /function handleDictionaryMouseBack\(event\)/);
  assert.match(script, /if \(event\.button !== 3\) return;/);
  assert.match(script, /state\.dictionaryPackManagerOpen[\s\S]*?closeDictionaryPackManager\(\)/);
  assert.match(script, /state\.dictionaryPersonalManagerOpen[\s\S]*?closeDictionaryManager\(\)/);
  assert.match(script, /document\.addEventListener\("mousedown", handleDictionaryMouseBack, true\)/);
});

test("dictionary packs expose only installed and not-installed states with comfortable note spacing", () => {
  assert.match(markup, /class="section-note dictionary-localization-note"/);
  assert.match(markup, /id="dictionary-external-model-note"[^>]*hidden/);
  assert.match(markup, /사전 뜻이 없으면 설정된 번역 모델로 보완합니다\./);
  assert.match(markup, /선택한 텍스트가 해당 서비스로 전송될 수 있습니다\./);
  assert.match(markup, /data-tooltip="주변 문맥은 PC 안에서만 처리됩니다\."/);
  assert.doesNotMatch(markup, /선택한 구절 전체와 인터페이스 언어에 없는 사전 뜻은/);
  assert.match(markup, /<h3 id="dictionary-packs-heading">오프라인 사전<\/h3><p>확장 사전을 설치하면 더 많은 단어와 표현을 찾을 수 있습니다\.<\/p>/);
  const renderer = script.match(/function renderDictionaryPacks\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(renderer, /installedPractical \? "설치됨" : "미설치"/);
  assert.match(renderer, /installedPractical \? "삭제" : "설치"/);
  assert.match(renderer, /filter\(pack => pack\.installed && pack\.edition === "practical"\)\.length/);
  assert.doesNotMatch(renderer, /"실용팩"|"미니팩"|"실용팩 설치"|status\.installedPackCount/);
  assert.match(script, /function renderDictionaryLocalizationNotice\(\)/);
  assert.match(script, /dictionaryExternalModelNote\.hidden = !EXTERNAL_PROVIDERS\.has\(selected\)/);
  assert.match(script, /if \(field === "translator"\) renderDictionaryLocalizationNotice\(\)/);
  assert.match(styles, /\.section-note\.dictionary-localization-note\s*\{[^}]*margin-bottom:\s*28px;/s);
});

test("the settings window title shows only the product name", () => {
  assert.match(markup, /<title>NudeNyang Discord Translator<\/title>/);
  assert.doesNotMatch(tauriConfig, /NudeNyang Discord Translator 설정/);
  assert.match(i18nSource, /document\.title = "NudeNyang Discord Translator"/);
  assert.doesNotMatch(i18nSource, /document\.title = language === "ko"/);
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
