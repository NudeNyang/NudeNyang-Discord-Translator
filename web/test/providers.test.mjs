import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [markup, script, rustMain, credentials, config] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../../src-tauri/src/main.rs", import.meta.url), "utf8"),
  readFile(new URL("../../src-tauri/src/credentials.rs", import.meta.url), "utf8"),
  readFile(new URL("../../src-tauri/src/config.rs", import.meta.url), "utf8"),
]);

test("provider setup is available without exposing credentials in settings", () => {
  for (const provider of ["chatgpt", "gemini", "deepl"]) {
    assert.match(markup, new RegExp(`data-provider="${provider}"`));
  }
  assert.match(markup, /type="password"/);
  assert.match(script, /invoke\("provider_connect"/);
  assert.match(script, /invoke\("provider_disconnect"/);
  assert.match(rustMain, /provider_connections_get/);
  assert.match(credentials, /keyring::Entry/);
  assert.doesNotMatch(config, /api_key\s*:/i);
});

test("public provider UI excludes Claude subscription credentials", () => {
  assert.doesNotMatch(markup, /data-provider="claude"/);
  assert.doesNotMatch(script, /\["claude",\s*"Claude Pro\/Max/);
  assert.match(config, /"kanana" \| "original" \| "claude"/);
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
});
