import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [markup, styles, script, rustMain, credentials, config, providers, subscriptionCli, trayMarkup, trayScript] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.css", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../../src-tauri/src/main.rs", import.meta.url), "utf8"),
  readFile(new URL("../../src-tauri/src/credentials.rs", import.meta.url), "utf8"),
  readFile(new URL("../../src-tauri/src/config.rs", import.meta.url), "utf8"),
  readFile(new URL("../../src-tauri/src/providers.rs", import.meta.url), "utf8"),
  readFile(new URL("../../src-tauri/src/translation/subscription_cli.rs", import.meta.url), "utf8"),
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

test("Claude Pro and Max connect through the official local Claude Code CLI", () => {
  assert.match(markup, /data-provider="claude"/);
  assert.match(script, /\["claude",\s*"Claude Pro\/Max/);
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
});

test("DeepL API keys are replaced through the main save action", () => {
  const deeplRow = markup.match(/<article class="provider-row" data-provider="deepl">[\s\S]*?<\/article>/)?.[0] || "";
  assert.match(deeplRow, /provider-secret/);
  assert.match(deeplRow, /provider-disconnect/);
  assert.doesNotMatch(deeplRow, /provider-action/);
  assert.match(script, /async function savePendingProviderCredentials/);

  const saveHandler = script.match(/elements\.form\.addEventListener\("submit"[\s\S]*?\n\}\);/)?.[0] || "";
  assert.ok(saveHandler.indexOf("savePendingProviderCredentials") < saveHandler.indexOf("EXTERNAL_PROVIDERS"));
  assert.match(providers, /API 키가 운영체제 보안 저장소에 저장되어 있습니다/);
});

test("subscription CLI disconnect only disables the provider inside Nude Translator", () => {
  for (const provider of ["chatgpt", "claude", "gemini"]) {
    const row = markup.match(new RegExp(`<article class="provider-row" data-provider="${provider}">[\\s\\S]*?<\\/article>`))?.[0] || "";
    assert.match(row, /provider-disconnect/);
  }
  assert.match(config, /disabled_providers/);
  assert.match(providers, /CLI 로그인 정보는 유지/);
  assert.match(providers, /state:\s*if disabled\s*\{\s*"disabled"/);
  assert.match(script, /Nude Translator에서만 사용을 중지합니다/);
  assert.match(script, /provider === "deepl"/);
  assert.match(rustMain, /"disabled_providers"/);
  assert.match(rustMain, /patch\["translator"\]\s*=\s*json!\("hymt_1_8b"\)/);
});

test("provider action buttons share dimensions and semantic colors", () => {
  assert.match(markup, /button danger provider-disconnect/);
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
    /\.button\.danger\s*\{[\s\S]*?color:\s*var\(--danger\)[\s\S]*?background:\s*var\(--danger-soft\)/,
  );
  assert.match(styles, /--danger-soft:\s*#f4e6e9/);
  assert.match(styles, /--danger-soft:\s*#402a34/);
});

test("provider status details wrap instead of being clipped", () => {
  const statusDetailRule = styles.match(/\.provider-status span\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.match(statusDetailRule, /white-space:\s*normal/);
  assert.match(statusDetailRule, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(statusDetailRule, /text-overflow:\s*ellipsis/);
});
