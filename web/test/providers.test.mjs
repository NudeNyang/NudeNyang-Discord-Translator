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
  assert.match(providers, /cli_status\("claude", "Claude"/);
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

test("provider action buttons keep labels on one line", () => {
  assert.match(markup, /button danger provider-disconnect/);
  assert.match(script, /연결 해제/);
  assert.match(styles, /\.button\.danger[\s\S]*?background:\s*var\(--danger\)/);
  assert.match(styles, /\.button\.danger[\s\S]*?white-space:\s*nowrap/);
});

test("provider status details wrap instead of being clipped", () => {
  const statusDetailRule = styles.match(/\.provider-status span\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.match(statusDetailRule, /white-space:\s*normal/);
  assert.match(statusDetailRule, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(statusDetailRule, /text-overflow:\s*ellipsis/);
});
