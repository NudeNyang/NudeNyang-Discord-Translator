import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const betaPackaging = readFileSync(
  new URL("../../scripts/package_beta.ps1", import.meta.url),
  "utf8",
);

test("beta packaging updates both current and legacy developer executables", () => {
  assert.match(betaPackaging, /Sync-DeveloperBuild/);
  assert.match(betaPackaging, /dist\\NudeNyangTranslator\\NudeNyangTranslator\.exe/);
  assert.match(betaPackaging, /dist\\NudeTranslator\\NudeTranslator\.exe/);
  assert.match(betaPackaging, /개발자 실행본이 열려 있습니다/);
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
    "Discord 긴 메시지와 보조 화면 번역 누락을 줄이고, 이미지 확대와 다국어 UI를 개선한 0.5.5 베타",
  );
});
