import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const betaPackaging = readFileSync(
  new URL("../../scripts/package_beta.ps1", import.meta.url),
  "utf8",
);
const releasePaths = readFileSync(
  new URL("../../scripts/release_paths.ps1", import.meta.url),
  "utf8",
);
const portablePackaging = readFileSync(
  new URL("../../scripts/package.ps1", import.meta.url),
  "utf8",
);
const vcRuntimeScriptUrl = new URL("../../scripts/stage_vc_runtime.ps1", import.meta.url);
const tauriConfig = JSON.parse(
  readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);

test("beta packaging updates the renamed developer executable", () => {
  assert.match(betaPackaging, /Sync-DeveloperBuild/);
  assert.match(betaPackaging, /dist\\NudeNyangDiscordTranslator\\NudeNyangDiscordTranslator\.exe/);
  assert.doesNotMatch(betaPackaging, /dist\\NudeTranslator\\NudeTranslator\.exe/);
  assert.match(betaPackaging, /개발자 실행본이 열려 있습니다/);
});

test("release credentials migrate into the renamed application folder", () => {
  assert.match(releasePaths, /NudeNyang Discord Translator\\secrets/);
  assert.match(releasePaths, /NudeTranslator\\secrets/);
  assert.match(releasePaths, /Move-Item -LiteralPath \$legacy -Destination \$current/);
});

test("beta manifest is written as UTF-8 without a BOM on Windows PowerShell", () => {
  assert.match(betaPackaging, /\[IO\.File\]::WriteAllText/);
  assert.match(betaPackaging, /UTF8Encoding\]\::new\(\$false\)/);
  assert.doesNotMatch(betaPackaging, /Set-Content[^\r\n]+-Encoding utf8NoBOM/);
});

test("default beta release notes survive Windows PowerShell source decoding", () => {
  const encoded = betaPackaging.match(/\$ReleaseNotes\s*=\s*\[Text\.Encoding\]::UTF8\.GetString\(\[Convert\]::FromBase64String\('([^']+)'\)\)/)?.[1];
  assert.ok(encoded, "release notes must use an ASCII-safe UTF-8 representation");
  assert.equal(
    Buffer.from(encoded, "base64").toString("utf8"),
    "Discord 연결 상태 안내와 Windows 필수 런타임을 보강한 0.5.8 베타",
  );
});

test("all Windows packages stage an app-local Visual C++ runtime for llama-server", () => {
  assert.ok(existsSync(vcRuntimeScriptUrl), "Visual C++ runtime staging helper is required");
  const vcRuntimeScript = readFileSync(vcRuntimeScriptUrl, "utf8");
  for (const packagingScript of [betaPackaging, portablePackaging]) {
    assert.match(packagingScript, /stage_vc_runtime\.ps1/);
    assert.match(packagingScript, /Copy-VcRuntimeFiles/);
  }
  for (const dependency of ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"]) {
    assert.match(vcRuntimeScript, new RegExp(dependency.replace(".", "\\."), "i"));
  }
});

test("the Windows installer carries the WebView2 bootstrapper for clean PCs", () => {
  assert.deepEqual(tauriConfig.bundle.windows.webviewInstallMode, {
    type: "embedBootstrapper",
    silent: true,
  });
});
