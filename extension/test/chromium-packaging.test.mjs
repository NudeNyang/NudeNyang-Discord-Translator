import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const packager = fs.readFileSync(
  new URL("../../scripts/package_chromium_extension.ps1", import.meta.url),
  "utf8",
);

test("Chrome 웹 스토어 패키지는 개발용 공개 키를 매니페스트에서 제거한다", () => {
  assert.match(packager, /PSObject\.Properties\.Remove\(['"]key['"]\)/);
  assert.match(packager, /manifest\.json/);
  assert.match(packager, /NudeNyang-Web-Translator-Chromium-/);
  assert.doesNotMatch(packager, /Compress-Archive/);
  assert.match(packager, /\.Replace\('\\', '\/'\)/);
});
