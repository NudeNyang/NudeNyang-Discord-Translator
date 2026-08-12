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
const providerIcons = await Promise.all(
  ["openai", "claude", "gemini", "deepl"].map(name =>
    readFile(new URL(`../assets/provider-${name}.svg`, import.meta.url), "utf8"),
  ),
);

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
  assert.match(script, /\["claude",\s*"Claude CLI \(권장·품질 우선\)"/);
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
  assert.match(script, /setProviderActionLabel\(action, "설치 중"\)/);
  assert.doesNotMatch(script, /npm install -g/);
  assert.match(rustMain, /provider_install/);
  assert.match(subscriptionCli, /\["\/d", "\/s", "\/c", "call"\]/);
  assert.match(subscriptionCli, /decode_process_output/);
  assert.match(subscriptionCli, /Google\.AntigravityCLI/);
});

test("Gemini subscriptions use the supported Google Antigravity CLI", () => {
  assert.match(markup, /<h3>Gemini<\/h3><p>Gemini 3\.6 Flash<\/p>/);
  assert.match(script, /\["gemini",\s*"Gemini CLI \(권장·품질 우선\)"/);
  assert.match(providers, /Google 구독 · Antigravity CLI/);
  assert.match(subscriptionCli, /Self::Gemini => &\["agy"\]/);
  assert.match(subscriptionCli, /\["models"\.to_string\(\)\]/);
  assert.match(subscriptionCli, /"--mode"\.to_string\(\)[\s\S]*?"plan"\.to_string\(\)/);
});

test("provider cards show the concrete model or API product without quality badges", () => {
  assert.match(markup, /<h3>ChatGPT<\/h3><p>GPT-5\.6 Luna\/Terra<\/p>/);
  assert.match(markup, /<h3>Claude<\/h3><p>Claude Haiku 4\.5<\/p>/);
  assert.match(markup, /<h3>Gemini<\/h3><p>Gemini 3\.6 Flash<\/p>/);
  assert.match(markup, /<h3>DeepL<\/h3><p>DeepL API Free \/ Pro<\/p>/);
  assert.doesNotMatch(markup, /품질 최우선/);
  assert.match(script, /ChatGPT CLI \(권장·품질 우선\)/);
  assert.match(providers, /ChatGPT 무료 플랜 이상 · Codex CLI/);
  assert.match(providers, /Claude 유료 플랜 · Claude Code/);
  assert.match(script, /Claude CLI \(권장·품질 우선\)/);
  assert.match(script, /Gemini CLI \(권장·품질 우선\)/);
  assert.doesNotMatch(`${markup}${script}`, /지속 연결|지속 세션/);
  assert.match(subscriptionCli, /gpt-5\.6-luna/);
  assert.match(subscriptionCli, /gpt-5\.6-terra/);
  assert.match(subscriptionCli, /"method": "model\/list"/);
  assert.match(subscriptionCli, /claude-haiku-4-5-20251001/);
  assert.match(subscriptionCli, /"flash"/);
  assert.match(subscriptionCli, /ClaudeStreamServer/);
  assert.match(subscriptionCli, /--conversation/);
  for (const tier of [/ChatGPT Plus\/Pro/, /Claude Pro\/Max/, /Gemini Pro\/Ultra/]) {
    assert.doesNotMatch(script, tier);
    assert.doesNotMatch(trayMarkup, tier);
  }
});

test("provider cards use bundled brand icons instead of letter placeholders", () => {
  for (const provider of ["openai", "claude", "gemini", "deepl"]) {
    assert.match(markup, new RegExp(`src="\\./assets/provider-${provider}\\.svg"`));
  }
  assert.equal(providerIcons.length, 4);
  for (const icon of providerIcons) {
    assert.match(icon, /<svg[\s\S]*<path/);
  }
  assert.doesNotMatch(markup, /<span class="provider-mark"[^>]*>[GCD]<\/span>/);
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
  assert.match(script, /setLocalizedText\(elements\.modalAccept, copy\.terminal \? "터미널 열기" : "이동"\)/);
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
  assert.match(discord, /EXTENDED_STARTUPINFO_PRESENT \| super::CREATE_NO_WINDOW/);
});

test("DeepL API keys are applied when editing finishes and before confirmation", () => {
  const deeplRow = markup.match(/<article class="provider-row" data-provider="deepl">[\s\S]*?<\/article>/)?.[0] || "";
  assert.match(deeplRow, /provider-secret/);
  assert.match(deeplRow, /provider-disconnect/);
  assert.doesNotMatch(deeplRow, /provider-key-action/);
  assert.doesNotMatch(deeplRow, /class="[^"]*\bprovider-action(?:\s|")/);
  assert.match(script, /async function savePendingProviderCredentials/);

  assert.match(script, /for \(const secret of document\.querySelectorAll\("\.provider-secret"\)\) \{[\s\S]*secret\.addEventListener\("change"/);
  const confirmHandler = script.match(/elements\.form\.addEventListener\("submit"[\s\S]*?\n\}\);/)?.[0] || "";
  assert.match(confirmHandler, /savePendingProviderCredentials/);
  assert.match(confirmHandler, /main_window_hide/);
  assert.match(providers, /API 키가 운영체제 보안 저장소에 저장되어 있습니다/);
  assert.match(
    styles,
    /\.provider-credential-connection\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 230px/,
  );
  assert.match(
    styles,
    /\.provider-credential\s*\{[\s\S]*?width:\s*min\(100%, 230px\)/,
  );
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

test("provider actions use fixed icon buttons with localized accessible labels", () => {
  assert.match(markup, /button secondary provider-action provider-icon-button/);
  assert.match(markup, /button secondary provider-disconnect provider-icon-button/);
  assert.match(markup, /class="provider-action-icon"/);
  assert.match(markup, /aria-label="연결" data-tooltip="연결"/);
  assert.match(markup, /aria-label="연결 해제" data-tooltip="연결 해제"/);
  assert.doesNotMatch(markup, /provider-icon-button[^>]*\stitle=/);
  assert.match(script, /function setProviderActionLabel/);
  assert.match(script, /action\.dataset\.i18nAriaLabel = key/);
  assert.match(script, /action\.dataset\.i18nTooltip = key/);
  assert.match(script, /action\.dataset\.tooltip = translated/);
  assert.match(
    styles,
    /\.button\.provider-icon-button\s*\{[\s\S]*?flex:\s*0 0 36px[\s\S]*?width:\s*36px[\s\S]*?min-width:\s*36px[\s\S]*?height:\s*36px[\s\S]*?min-height:\s*36px[\s\S]*?place-items:\s*center/,
  );
  assert.match(
    styles,
    /\.provider-icon-button\[hidden\]\s*\{[\s\S]*?display:\s*none/,
  );
  assert.match(
    styles,
    /\.provider-action-icon\s*\{[\s\S]*?width:\s*18px[\s\S]*?stroke:\s*currentColor[\s\S]*?stroke-width:\s*2/,
  );
  const tooltipRule = styles.match(/\.provider-icon-button::after\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.match(tooltipRule, /content:\s*attr\(data-tooltip\)/);
  assert.match(tooltipRule, /right:\s*calc\(100% \+ 8px\)/);
  assert.match(
    styles,
    /\.provider-icon-button:is\(:hover, :focus-visible\)::after\s*\{[\s\S]*?opacity:\s*1[\s\S]*?visibility:\s*visible/,
  );
  assert.match(
    styles,
    /\.provider-action:not\(:disabled\)\s*\{[\s\S]*?color:\s*var\(--accent-strong\)[\s\S]*?background:\s*var\(--accent-soft\)/,
  );
  assert.match(
    styles,
    /\.button\.provider-disconnect\s*\{[\s\S]*?border-color:[^;]*var\(--danger\)[\s\S]*?color:\s*var\(--danger\)[\s\S]*?background:\s*var\(--danger-soft\)/,
  );
  assert.match(
    styles,
    /\.button\.provider-disconnect:hover\s*\{[\s\S]*?border-color:\s*var\(--danger\)[\s\S]*?background:[^;]*var\(--danger\)/,
  );
});

test("provider status details wrap instead of being clipped", () => {
  const statusDetailRule = styles.match(/\.provider-status span\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.match(statusDetailRule, /white-space:\s*normal/);
  assert.match(statusDetailRule, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(statusDetailRule, /text-overflow:\s*ellipsis/);
});
