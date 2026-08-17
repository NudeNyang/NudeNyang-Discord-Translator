import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const betaPackaging = readFileSync(
  new URL("../../scripts/package_beta.ps1", import.meta.url),
  "utf8",
);
const releasePaths = readFileSync(
  new URL("../../scripts/release_paths.ps1", import.meta.url),
  "utf8",
);
const githubPackaging = readFileSync(
  new URL("../../scripts/package_github_release.ps1", import.meta.url),
  "utf8",
);
const githubDeployment = readFileSync(
  new URL("../../scripts/deploy_github_release.ps1", import.meta.url),
  "utf8",
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
    "기존 비공개 베타 사용자를 GitHub 오픈 베타 업데이트 채널로 안전하게 연결하는 0.5.14 전환 버전",
  );
});

test("R2 bridge builds a public updater without embedding the private beta token", () => {
  assert.match(betaPackaging, /\[switch\]\$PublicUpdater/);
  assert.match(betaPackaging, /if \(\$PublicUpdater\)[\s\S]*Remove-Item Env:NUDE_TRANSLATOR_BETA_TOKEN/);
  assert.match(githubPackaging, /raw\.githubusercontent\.com\/\$Repository\/main\/updates\/beta\/latest\.json/);
  assert.match(githubPackaging, /'-PublicUpdater'/);
});

test("GitHub Open Beta artifacts include a signed manifest and become the latest release", () => {
  assert.match(githubPackaging, /SHA256SUMS\.txt/);
  assert.match(githubPackaging, /Get-FileHash[^\r\n]+SHA256/);
  assert.match(githubDeployment, /gh release create/);
  assert.match(githubDeployment, /--latest/);
  assert.doesNotMatch(githubDeployment, /--prerelease/);
  assert.match(githubDeployment, /SHA256SUMS\.txt/);
  assert.doesNotMatch(githubDeployment, /--verify-tag/);
});

test("GitHub release packaging reads Korean metadata explicitly as UTF-8", () => {
  assert.match(githubPackaging, /ReadAllText\(\$ReleaseNotesPath, \[Text\.Encoding\]::UTF8\)/);
  assert.match(githubPackaging, /ReadAllText\(\$TauriConfigPath, \[Text\.Encoding\]::UTF8\)/);
  assert.match(githubDeployment, /ReadAllText\(\$TauriConfigPath, \[Text\.Encoding\]::UTF8\)/);
  assert.doesNotMatch(githubPackaging, /Get-Content -Raw -LiteralPath \$ReleaseNotesPath/);
});
