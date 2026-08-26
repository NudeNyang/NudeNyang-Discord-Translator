import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const browserExtensionGuide = fs.readFileSync(
  new URL("../../docs/BROWSER_EXTENSION.md", import.meta.url),
  "utf8",
);

test("Windows 앱과 확장은 Major·Minor만 맞추고 Patch는 독립적으로 배포한다", () => {
  assert.match(browserExtensionGuide, /Major·Minor 버전만 맞춘다/);
  assert.match(browserExtensionGuide, /Patch 버전은[^\n]+독립적으로 올린다/);
  assert.match(browserExtensionGuide, /0\.7\.x/);
  assert.doesNotMatch(browserExtensionGuide, /Major·Minor·Patch 버전을 맞춘다/);
});
