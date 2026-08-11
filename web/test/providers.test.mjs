import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [markup, styles, script, rustMain, credentials, config, providers, subscriptionCli, discord, trayMarkup, trayScript] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.css", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../../src-tauri/src/main.rs", import.meta.url), "utf8"),
  readFile(new URL("../../src-tauri/src/credentials.rs", import.meta.url), "utf8"),
  readFile(new URL("../../src-tauri/src/config.rs", import.meta.url), "utf8"),
  readFile(new URL("../../src-tauri/src/providers.rs", import.meta.url), "utf8"),
  readFile(new URL("../../src-tauri/src/translation/subscription_cli.rs", import.meta.url), "utf8"),
  readFile(new URL("../../src-tauri/src/discord.rs", import.meta.url), "utf8"),
  readFile(new URL("../tray.html", import.meta.url), "utf8"),
  readFile(new URL("../tray.js", import.meta.url), "utf8"),
]);

test("provider setup is available without exposing credentials in settings", () => {
  for (const provider of ["chatgpt", "claude", "gemini", "deepl"]) {
    assert.match(markup, new RegExp(`data-provider="${provider}"`));
  }
  assert.match(markup, /type="password"/);
  assert.match(script, /invoke\("provider_connect"/);
  assert.match(script, /invoke\("provider_disconnect"/);
  assert.match(rustMain, /provider_connections_get/);
  assert.match(credentials, /keyring::Entry/);
  assert.doesNotMatch(config, /api_key\s*:/i);
});

test("Claude connects through the official local Claude Code CLI", () => {
  assert.match(markup, /data-provider="claude"/);
  assert.match(script, /\["claude",\s*"Claude Haiku 4\.5 \(품질 최우선\)"\]/);
  assert.match(script, /EXTERNAL_PROVIDERS = new Set\(\["chatgpt", "claude", "gemini", "deepl"\]\)/);
  assert.doesNotMatch(config, /"kanana" \| "original" \| "claude"/);
  assert.match(providers, /cli_status\(\s*"claude",\s*"Claude"/);
  assert.match(subscriptionCli, /Anthropic\.ClaudeCode/);
  assert.match(trayMarkup, /data-translator="claude"/);
  assert.match(trayScript, /claude:\s*"Claude"/);
});

test("an unconnected external model is routed to provider setup", () => {
  assert.match(script, /EXTERNAL_PROVIDERS/);
  assert.match(script, /revealProviderConnection\(translator\)/);
  assert.match(script, /선택한 외부 번역 서비스를 먼저 연결하십시오/);
});

test("missing subscription CLIs use the in-app automatic installer", () => {
  assert.match(script, /invoke\("provider_install", \{ provider \}\)/);
  assert.match(script, /action\.textContent = "설치 중"/);
  assert.doesNotMatch(script, /npm install -g/);
  assert.match(rustMain, /provider_install/);
  assert.match(subscriptionCli, /\["\/d", "\/s", "\/c", "call"\]/);
  assert.match(subscriptionCli, /decode_process_output/);
  assert.match(subscriptionCli, /Google\.AntigravityCLI/);
});

test("Gemini subscriptions use the supported Google Antigravity CLI", () => {
  assert.match(markup, /Gemini 3\.6 Flash \(품질 최우선\)/);
  assert.match(script, /\["gemini",\s*"Gemini 3\.6 Flash \(품질 최우선\)"\]/);
  assert.match(providers, /Google 구독 · Antigravity CLI/);
  assert.match(subscriptionCli, /Self::Gemini => &\["agy"\]/);
  assert.match(subscriptionCli, /\["models"\.to_string\(\)\]/);
  assert.match(subscriptionCli, /"--mode"\.to_string\(\)[\s\S]*?"plan"\.to_string\(\)/);
});

test("subscription translators use a simple quality-first label", () => {
  assert.match(script, /GPT-5\.6 Luna \(품질 최우선\)/);
  assert.match(script, /Claude Haiku 4\.5 \(품질 최우선\)/);
  assert.match(script, /Gemini 3\.6 Flash \(품질 최우선\)/);
  assert.doesNotMatch(`${markup}${script}`, /지속 연결|지속 세션/);
  assert.match(subscriptionCli, /gpt-5\.6-luna/);
  assert.match(subscriptionCli, /claude-haiku-4-5-20251001/);
  assert.match(subscriptionCli, /"flash"/);
  assert.match(subscriptionCli, /ClaudeStreamServer/);
  assert.match(subscriptionCli, /--conversation/);
  for (const tier of [/ChatGPT Plus\/Pro/, /Claude Pro\/Max/, /Gemini Pro\/Ultra/]) {
    assert.doesNotMatch(script, tier);
    assert.doesNotMatch(trayMarkup, tier);
  }
});

test("ChatGPT and Claude sign-ins stay inside the app while official browser flows run", () => {
  assert.match(subscriptionCli, /"--acp"/);
  assert.match(subscriptionCli, /"oauth-personal"/);
  assert.match(subscriptionCli, /Gemini CLI ACP 인증/);
  assert.doesNotMatch(
    subscriptionCli,
    /Implementation::Agy \| Implementation::Gemini\s*=>\s*\{\s*open_cli_login_console/,
  );
  assert.match(rustMain, /provider_login_cancel/);
  assert.match(rustMain, /provider_login_open/);
  assert.match(script, /provider !== "deepl" \? await showProviderLoginProgress\(provider\) : null/);
  assert.match(script, /공식 로그인 페이지로 이동하려면 이동을 선택하십시오/);
  assert.match(script, /modalAccept\.textContent = copy\.terminal \? "터미널 열기" : "이동"/);
  assert.match(script, /invoke\("provider_login_open"\)/);
  assert.match(subscriptionCli, /authenticate_browser_login_cli/);
  assert.match(subscriptionCli, /"auth"\.to_string\(\)[\s\S]*?"login"\.to_string\(\)[\s\S]*?"--claudeai"\.to_string\(\)/);
  assert.doesNotMatch(subscriptionCli, /'codex login'|'claude auth login'/);
});

test("Antigravity first sign-in opens a visible terminal and is detected automatically", () => {
  assert.match(subscriptionCli, /Implementation::Agy\s*=>\s*authenticate_antigravity_with_console/);
  assert.match(subscriptionCli, /CREATE_NEW_CONSOLE/);
  assert.match(subscriptionCli, /wait_for_antigravity_connection/);
  assert.match(script, /gemini:\s*\{[^}]*terminal:\s*true/);
  assert.match(script, /터미널 열기/);
  assert.match(script, /인증 코드를 터미널에 붙여넣/);
});

test("normal child processes stay in the background without console flashes", () => {
  assert.match(subscriptionCli, /fn process_command[\s\S]*?configure_hidden\(&mut command\)/);
  assert.match(subscriptionCli, /const CREATE_NO_WINDOW: u32 = 0x0800_0000/);
  assert.match(discord, /configure_background\(&mut command\)/);
  assert.match(discord, /const CREATE_NO_WINDOW: u32 = 0x0800_0000/);
});

test("DeepL API keys are applied when editing finishes and before confirmation", () => {
  const deeplRow = markup.match(/<article class="provider-row" data-provider="deepl">[\s\S]*?<\/article>/)?.[0] || "";
  assert.match(deeplRow, /provider-secret/);
  assert.match(deeplRow, /provider-disconnect/);
  assert.doesNotMatch(deeplRow, /provider-action/);
  assert.match(script, /async function savePendingProviderCredentials/);

  assert.match(script, /for \(const secret of document\.querySelectorAll\("\.provider-secret"\)\) \{[\s\S]*secret\.addEventListener\("change"/);
  const confirmHandler = script.match(/elements\.form\.addEventListener\("submit"[\s\S]*?\n\}\);/)?.[0] || "";
  assert.match(confirmHandler, /savePendingProviderCredentials/);
  assert.match(confirmHandler, /main_window_hide/);
  assert.match(providers, /API 키가 운영체제 보안 저장소에 저장되어 있습니다/);
});

test("subscription CLI disconnect only disables the provider inside NudeNyang Translator", () => {
  for (const provider of ["chatgpt", "claude", "gemini"]) {
    const row = markup.match(new RegExp(`<article class="provider-row" data-provider="${provider}">[\\s\\S]*?<\\/article>`))?.[0] || "";
    assert.match(row, /provider-disconnect/);
  }
  assert.match(config, /disabled_providers/);
  assert.match(providers, /CLI 로그인 정보는 유지/);
  assert.match(providers, /state:\s*if disabled\s*\{\s*"disabled"/);
  assert.match(script, /NudeNyang Translator에서만 사용을 중지합니다/);
  assert.match(script, /provider === "deepl"/);
  assert.match(rustMain, /"disabled_providers"/);
  assert.match(rustMain, /patch\["translator"\]\s*=\s*json!\("hymt_1_8b"\)/);
});

test("provider action buttons share dimensions and use calm semantic colors", () => {
  assert.match(markup, /button secondary provider-disconnect/);
  assert.match(script, /연결 해제/);
  assert.match(
    styles,
    /\.provider-action,\s*\.provider-disconnect\s*\{[\s\S]*?width:\s*86px[\s\S]*?min-height:\s*40px[\s\S]*?white-space:\s*nowrap/,
  );
  assert.match(
    styles,
    /\.provider-action:not\(:disabled\)\s*\{[\s\S]*?color:\s*var\(--accent-strong\)[\s\S]*?background:\s*var\(--accent-soft\)/,
  );
  assert.match(
    styles,
    /\.button\.provider-disconnect\s*\{[\s\S]*?color:\s*var\(--muted\)[\s\S]*?background:[^;]*var\(--control\)/,
  );
  assert.doesNotMatch(
    styles,
    /\.button\.provider-disconnect\s*\{[\s\S]*?var\(--danger\)/,
  );
});

test("provider status details wrap instead of being clipped", () => {
  const statusDetailRule = styles.match(/\.provider-status span\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.match(statusDetailRule, /white-space:\s*normal/);
  assert.match(statusDetailRule, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(statusDetailRule, /text-overflow:\s*ellipsis/);
});
