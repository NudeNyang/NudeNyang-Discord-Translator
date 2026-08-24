import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const manifest = JSON.parse(
  fs.readFileSync(new URL("../manifest.firefox.json", import.meta.url), "utf8"),
);
const backgroundJs = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const contentJs = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
const popupJs = fs.readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const packager = fs.readFileSync(
  new URL("../../scripts/package_firefox_extension.ps1", import.meta.url),
  "utf8",
);

test("Firefox Manifest V3는 고정 Add-on ID와 이벤트 백그라운드를 사용한다", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.browser_specific_settings.gecko.id, "web-translator@nudenyang.github.io");
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, "142.0");
  assert.deepEqual(manifest.background, {
    scripts: ["native-client.js", "tab-state.js", "background.js"],
  });
  assert.equal(manifest.key, undefined);
});

test("Firefox 패키지는 Native Messaging과 웹 본문 처리 범위를 명시한다", () => {
  assert.ok(manifest.permissions.includes("nativeMessaging"));
  assert.deepEqual(manifest.host_permissions, ["http://*/*", "https://*/*"]);
  assert.deepEqual(
    manifest.browser_specific_settings.gecko.data_collection_permissions.required,
    ["websiteContent"],
  );
  assert.deepEqual(manifest.content_scripts[0].matches, ["http://*/*", "https://*/*"]);
});

test("공용 스크립트는 Firefox API와 Firefox 클라이언트 식별을 지원한다", () => {
  assert.match(backgroundJs, /globalThis\.chrome \?\? globalThis\.browser \?\? globalThis\.whale/);
  assert.match(backgroundJs, /userAgent\.includes\("Firefox"\)/);
  assert.match(contentJs, /globalThis\.chrome \?\? globalThis\.browser \?\? globalThis\.whale/);
  assert.match(popupJs, /globalThis\.chrome \?\? globalThis\.browser \?\? globalThis\.whale/);
});

test("Firefox 패키지는 전용 매니페스트와 라이선스를 XPI 루트에 배치한다", () => {
  assert.match(packager, /manifest\.firefox\.json[^\n]+manifest\.json/);
  assert.match(packager, /LICENSE[^\n]+LICENSE\.txt/);
  assert.match(packager, /NudeNyang-Web-Translator-Firefox-/);
  assert.match(packager, /popup-locales\.js/);
  assert.match(packager, /tab-state\.js/);
  assert.match(packager, /'_locales'/);
  assert.doesNotMatch(packager, /Compress-Archive/);
  assert.match(packager, /\.Replace\('\\', '\/'\)/);
});

test("AMO 비공개 서명 패키지는 생성 코드 원본과 검토자 안내를 함께 제공한다", () => {
  const amoScript = fs.readFileSync(new URL("../../scripts/package_firefox_amo.ps1", import.meta.url), "utf8");
  const reviewerNotes = fs.readFileSync(new URL("../../docs/FIREFOX_AMO_REVIEW.md", import.meta.url), "utf8");

  assert.match(amoScript, /\$BaseName-source\.zip/);
  assert.match(amoScript, /Get-ChildItem.+extension/);
  assert.match(amoScript, /generate-extension-locales\.mjs/);
  assert.match(amoScript, /ui-locales\.mjs/);
  assert.match(amoScript, /FIREFOX_AMO_REVIEW\.md/);
  assert.doesNotMatch(amoScript, /Compress-Archive/);
  assert.match(amoScript, /\.Replace\('\\', '\/'\)/);
  assert.match(reviewerNotes, /self-distributed/i);
  assert.match(reviewerNotes, /web-translator@nudenyang\.github\.io/);
  assert.match(reviewerNotes, /nativeMessaging/);
  assert.match(reviewerNotes, /npm run extension:locales/);
});
