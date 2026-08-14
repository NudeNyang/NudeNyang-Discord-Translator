import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const outgoing = readFileSync(new URL("../../src-tauri/src/outgoing.rs", import.meta.url), "utf8");
const engine = readFileSync(new URL("../../src-tauri/src/engine.rs", import.meta.url), "utf8");
const dom = readFileSync(new URL("../../src-tauri/src/dom.rs", import.meta.url), "utf8");
const cache = readFileSync(new URL("../../src-tauri/src/cache.rs", import.meta.url), "utf8");
const imageTranslation = readFileSync(new URL("../../src-tauri/src/image_translation.rs", import.meta.url), "utf8");

function outgoingComparableMessageText() {
  const match = outgoing.match(/function comparableMessageText\(value\) \{([\s\S]*?)\n  \}/);
  assert.ok(match, "Discord message comparison normalizer must exist");
  return Function("value", match[1]);
}

test("outgoing translation gives Enter and configurable action shortcuts stable meanings", () => {
  assert.match(outgoing, /__SEND_IMMEDIATELY_SHORTCUT__/);
  assert.match(outgoing, /__REVIEW_BEFORE_SEND_SHORTCUT__/);
  assert.match(outgoing, /const ordinaryEnter = event\.key === 'Enter'/);
  assert.match(outgoing, /const sendImmediately = sameShortcut/);
  assert.match(outgoing, /const reviewBeforeSend = sameShortcut/);
  assert.match(outgoing, /!event\.isComposing/);
  assert.doesNotMatch(outgoing, /if \(!this\.enabled \|\| event\.isComposing\)/);
  assert.match(outgoing, /sendImmediately \|\| \(!this\.confirmSend && !reviewBeforeSend\)/);
  assert.match(outgoing, /if \(!ordinaryEnter && !sendImmediately\)/);
  assert.match(outgoing, /action:'send-reviewed'/);
  assert.match(outgoing, /review_ready/);
  assert.match(outgoing, /reviewHint:'번역문을 수정하거나 Enter로 전송하십시오\.'/);
  assert.doesNotMatch(outgoing, /reviewHint:[^\n]*\{shortcut\}/);
  assert.match(outgoing, /startsWith\('\/'\)/);
  assert.doesNotMatch(outgoing, /text\.includes\('```'\)/);
});

test("language suggestions use recent message contents and never channel names", () => {
  assert.match(outgoing, /recentMessages/);
  assert.match(outgoing, /__nudeTranslatorOriginals/);
  assert.doesNotMatch(outgoing, /channelName|channelTitle/);
  assert.match(engine, /suggest_recent_language/);
  assert.match(engine, /if let Some\(target\) = suggestion/);
  assert.match(engine, /apply_outgoing_detected_script/);
});

test("channel memory, one-message overrides, and safe failures are represented", () => {
  assert.match(outgoing, /channelLanguages/);
  assert.match(outgoing, /이번 메시지만 원문으로 전송/);
  assert.match(cache, /outgoing_channel_languages/);
  assert.match(outgoing, /번역하지 않고 원문을 유지합니다/);
  assert.match(engine, /OutgoingWorkerCommand::Translate/);
  assert.match(engine, /rust-outgoing-translation-worker/);
  assert.match(engine, /Input\.insertText/);
  assert.match(engine, /Input\.dispatchKeyEvent/);
  assert.match(outgoing, /created_at/);
  assert.match(outgoing, />= 30000/);
  assert.match(outgoing, /CONTROLLER_VERSION/);
  assert.match(outgoing, /controller\.prunePending\(\)/);
});

test("confirming an automatic suggestion remembers it for the channel", () => {
  assert.doesNotMatch(outgoing, /localStorage/);
  assert.match(outgoing, /__CHANNEL_LANGUAGES__/);
  assert.match(outgoing, /remember-language/);
  assert.match(outgoing, /selectedLanguageForChannel/);
  assert.match(engine, /set_outgoing_channel_language/);
  assert.match(cache, /outgoing_channel_languages/);
});

test("configured outgoing defaults and confirmation policy reach Discord", () => {
  assert.match(outgoing, /__DEFAULT_LANGUAGE__/);
  assert.match(engine, /outgoing_target_language/);
  assert.doesNotMatch(engine, /outgoing_confirm_language/);
  assert.match(engine, /outgoing_confirm_send/);
  assert.match(engine, /send_outgoing_immediately/);
  assert.match(engine, /review_outgoing_before_send/);
  assert.match(engine, /outgoing_translator/);
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
  assert.match(outgoing, /reconcileMessageIds/);
  assert.match(outgoing, /new MutationObserver/);
  assert.match(outgoing, /\[data-nt-outgoing-original="true"\]\{display:inline/);
  assert.match(outgoing, /\.nt-outgoing-original-view\{[^}]*display:inline-flex[^}]*flex-direction:row/);
  assert.match(outgoing, /\.nt-outgoing-original-copy\[hidden\]\{display:none\}/);
  assert.match(outgoing, /\.nt-outgoing-original-copy\[hidden\]\+\.nt-outgoing-original-toggle\{margin-inline-start:8px\}/);
  assert.match(outgoing, /\.nt-outgoing-original-view\[data-mode="sent"\] \.nt-outgoing-original-toggle\{color:#f0a15c\}/);
  assert.match(outgoing, /view\.dataset\.mode = defaultMode/);
  assert.match(outgoing, /const displayTranslationEnabled = __DISPLAY_TRANSLATION_ENABLED__/);
  assert.match(outgoing, /manager\.translationEnabled !== displayTranslationEnabled/);
  assert.match(outgoing, /const bulkMode = displayTranslationEnabled \? 'original' : 'sent'/);
  assert.match(outgoing, /view\.dataset\.mode = bulkMode/);
  assert.match(outgoing, /this\.translationEnabled \? 'original' : 'sent'/);
  assert.match(outgoing, /const showSent = view\.dataset\.mode !== 'original'/);
  assert.match(outgoing, /const label = showSent \? copy\('showSent'\) : copy\('showOriginal'\)/);
  assert.match(outgoing, /button\.dataset\.label = nextLabel/);
  assert.match(outgoing, /button\.setAttribute\('aria-label', nextLabel\)/);
  assert.match(outgoing, /\.nt-outgoing-original-toggle::before\{content:attr\(data-label\)\}/);
  assert.match(outgoing, /\.nt-outgoing-original-copy::before\{content:attr\(data-text\)/);
  assert.match(outgoing, /function isEditingMessage\(root\)/);
  assert.match(outgoing, /if \(isEditingMessage\(root\)\)/);
  assert.match(outgoing, /if \(currentText !== comparableMessageText\(record\.sent_text\)\)/);
  assert.doesNotMatch(outgoing, /root\.textContent = record\.sent_text/);
  assert.match(outgoing, /\.nt-outgoing-original-toggle\{[^}]*font-size:11px/);
  assert.doesNotMatch(outgoing, /view\.innerHTML = '[^']*nt-outgoing-original-label/);
  assert.match(outgoing, /\.nt-outgoing-original-toggle\{[^}]*align-self:baseline/);
  assert.match(outgoing, /\.nt-outgoing-original-toggle\{[^}]*opacity:0;pointer-events:none/);
  assert.match(outgoing, /function messageRow\(root\)/);
  assert.match(outgoing, /data-nt-outgoing-message-row/);
  assert.match(outgoing, /\[data-nt-outgoing-message-row="true"\]:hover \.nt-outgoing-original-toggle/);
  assert.match(outgoing, /\[data-list-item-id\^="chat-messages___"\]:hover \.nt-outgoing-original-toggle/);
  assert.match(outgoing, /\.nt-outgoing-original-toggle:focus-visible/);
  assert.match(outgoing, /button\?\.blur\(\)/);
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

test("slow CLI replies survive Discord replacing the composer", () => {
  assert.match(outgoing, /function currentComposerForItem\(item\)/);
  assert.match(outgoing, /editor = currentComposerForItem\(item\)/);
  assert.match(outgoing, /item\.editor = editor/);
  assert.match(outgoing, /const previous = this\.pendingForEditor\(editor\)/);
});

test("outgoing original matching never rewrites translated message DOM", () => {
  assert.match(outgoing, /function sentTextForMatching\(root\)/);
  assert.match(outgoing, /comparableMessageText\(sentTextForMatching\(root\)\)/);
  const matcher = outgoing.match(/function sentTextForMatching\(root\) \{([\s\S]*?)\n  \}/);
  assert.ok(matcher, "non-mutating sent text matcher must exist");
  assert.doesNotMatch(matcher[1], /node\.nodeValue = originals\.get\(node\)/);
});

test("outgoing original matching treats rendered Discord markdown as the same message", () => {
  const comparableMessageText = outgoingComparableMessageText();

  assert.equal(
    comparableMessageText("# 안내\n- 첫 번째 항목\n- 두 번째 항목"),
    comparableMessageText("안내\n첫 번째 항목\n두 번째 항목"),
  );
  assert.equal(
    comparableMessageText("> **중요**\n1. [문서](https://example.com) 확인"),
    comparableMessageText("중요\n문서 확인"),
  );
});

test("outgoing translation retains exact composer line breaks and Discord formatting", () => {
  assert.match(outgoing, /function composerText\(editor\)\s*\{\s*return visibleComposerText\(editor\);/);
  assert.match(outgoing, /function composerHasText\(editor\)/);
  assert.match(outgoing, /blocks\.map\(visibleSlateNodeText\)\.join\('\\n'\)/);
  assert.match(engine, /translate_for_discord\(&batch\.text, batch\.target\)/);
  assert.doesNotMatch(outgoing, /visibleComposerText\(editor\)\.trim\(\)/);
});

test("Discord chat controls stay aligned to the composer and expose display translation settings", () => {
  assert.match(outgoing, /__DISPLAY_ENABLED__/);
  assert.match(outgoing, /__DISPLAY_LANGUAGE__/);
  assert.match(outgoing, /번역 켜짐/);
  assert.match(outgoing, /표시 언어/);
  assert.match(outgoing, /action:'display-language'/);
  assert.match(outgoing, /getBoundingClientRect\(\)/);
  assert.match(outgoing, /window\.innerWidth - anchorBounds\.right/);
  assert.match(outgoing, /window\.innerHeight - anchorBounds\.top/);
  assert.match(outgoing, /function bottomObstacleTop\(anchorBounds\)/);
  assert.match(outgoing, /\[class\*="channelBottomBar"\], \[class\*="followButton"\], button, \[role="button"\]/);
  assert.match(outgoing, /window\.innerHeight - obstacleTop \+ 12/);
  assert.match(outgoing, /bounds\.height > 20/);
  assert.match(outgoing, /bounds\.top > window\.innerHeight \* 0\.4/);
  assert.match(outgoing, /\[hidden\]\{display:none!important\}/);
  assert.match(outgoing, /CONTROLLER_VERSION = 39/);
  assert.match(outgoing, /HEARTBEAT_TIMEOUT_MS = 5000/);
  assert.match(outgoing, /document\.addEventListener\('beforeinput', controller\.beforeInputListener, true\)/);
  assert.match(outgoing, /document\.removeEventListener\('beforeinput', controller\.beforeInputListener, true\)/);
  assert.match(outgoing, /document\.addEventListener\('input', controller\.inputListener, true\)/);
  assert.match(outgoing, /document\.removeEventListener\('input', controller\.inputListener, true\)/);
  assert.match(outgoing, /max-height:min\(58vh,500px\)/);
  assert.match(outgoing, /scrollbar-width:none/);
  assert.match(outgoing, /\.nt-menu-scroll-indicator/);
  assert.match(outgoing, /Math\.hypot\(distanceX, distanceY\) <= MENU_SCROLL_REVEAL_DISTANCE/);
  assert.match(outgoing, /menu\.addEventListener\('scroll'/);
  assert.doesNotMatch(outgoing, /\.nt-outgoing-menu::-webkit-scrollbar-thumb/);
  assert.match(outgoing, /document\.addEventListener\('pointerdown', controller\.pointerDownListener, true\)/);
  assert.match(outgoing, /document\.removeEventListener\('pointerdown', controller\.pointerDownListener, true\)/);
  assert.match(outgoing, /event\.composedPath\(\)\.includes\(controller\.root\)/);
  assert.match(outgoing, /selectionCoversComposer\(editor\)/);
  assert.match(outgoing, /inputType && !inputType\.startsWith\('delete'\)/);
  assert.match(outgoing, /nt-outgoing-control[\s\S]*nt-display-control/);
  assert.match(outgoing, /\.nt-controls-row\{[^}]*flex-direction:column/);
  assert.match(outgoing, /\.nt-outgoing-status\{[^}]*order:-1/);
  assert.match(outgoing, /outgoingLanguage:'전송'/);
  assert.match(outgoing, /displayLanguage:'표시'/);
  assert.match(outgoing, /const languageLabels = __LANGUAGE_LABELS__/);
  assert.match(outgoing, /const languageCodes = __LANGUAGE_CODES__/);
  assert.match(outgoing, /const compactLanguageLabels = __COMPACT_LANGUAGE_LABELS__/);
  assert.match(outgoing, /button\.dir = 'ltr'/);
  assert.match(outgoing, /label\.dir = 'auto'/);
  assert.match(outgoing, /text-align:left/);
  assert.match(outgoing, /class="nt-role-icon nt-outgoing-icon" aria-hidden="true">↑/);
  assert.match(outgoing, /class="nt-role-icon nt-display-icon" aria-hidden="true">↓/);
  assert.match(outgoing, /\.nt-outgoing-control\{--nt-role-accent:#8ab7df[^}]*--nt-icon-surface:#313842[^}]*--nt-icon-text:#8ab7df/);
  assert.match(outgoing, /\.nt-display-control\{--nt-role-accent:#d7a47e[^}]*--nt-icon-surface:#3d342f[^}]*--nt-icon-text:#d7a47e/);
  assert.match(outgoing, /\.nt-outgoing-trigger,#\$\{ROOT_ID\} \.nt-display-trigger\{[^}]*width:68px[^}]*height:32px[^}]*gap:7px[^}]*padding:0 7px 0 4px[^}]*border-radius:10px[^}]*background:#25272cf2/);
  assert.match(outgoing, /\.nt-role-icon\{[^}]*width:22px[^}]*height:22px[^}]*border-radius:7px[^}]*background:var\(--nt-icon-surface\)[^}]*font-size:11px/);
  assert.doesNotMatch(outgoing, /\.nt-(?:outgoing|display)-trigger::after/);
  assert.match(outgoing, /\.nt-outgoing-trigger\[aria-expanded="true"\],[\s\S]*?\.nt-display-trigger\[aria-expanded="true"\]\{[^}]*filter:none[^}]*transform:none/);
  assert.doesNotMatch(outgoing, /\.nt-outgoing-trigger\[aria-expanded="true"\][^}]*width:/);
  assert.match(outgoing, /\.nt-outgoing-menu,#\$\{ROOT_ID\} \.nt-display-menu\{[^}]*right:0[^}]*bottom:0[^}]*width:274px[^}]*padding:8px 8px 48px[^}]*border-radius:34px/);
  assert.match(outgoing, /\.nt-language-grid\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(outgoing, /\.nt-language-check\{/);
  assert.match(outgoing, /button\.setAttribute\('aria-pressed', String\(code === selectedValue\)\)/);
  assert.match(outgoing, /root\.dataset\.openMenu = 'outgoing'/);
  assert.match(outgoing, /root\.dataset\.openMenu = 'display'/);
  assert.match(outgoing, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(outgoing, /@media \(prefers-reduced-transparency:reduce\)/);
  assert.doesNotMatch(outgoing, /nt-heading-collapse/);
  assert.match(outgoing, /aria-label="\$\{copy\('selectDisplayLanguage'\)\}"/);
  assert.doesNotMatch(outgoing, /class="nt-role-label"/);
  assert.doesNotMatch(outgoing, /<i>⌄<\/i>/);
  assert.match(outgoing, /this\.channelLanguages\[key\] = language/);
  assert.match(outgoing, /item\.action === 'remember-language'/);
  assert.match(outgoing, /controller\.channelLanguages = \{\.\.\.rememberedChannelLanguages\}/);
  assert.doesNotMatch(outgoing, /class="nt-display-control"><strong>/);
  assert.match(engine, /request\.action == "display-language"/);
  assert.match(engine, /target_language/);
  assert.match(engine, /settings-changed/);
});

test("Discord-injected controls follow the settings interface language", () => {
  assert.match(outgoing, /__UI_LANGUAGE__/);
  assert.match(outgoing, /requestedUiLanguage/);
  assert.match(outgoing, /pub fn outgoing_ui_script\([\s\S]*confirm_send: bool/);
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
