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
const privacyPolicy = fs.readFileSync(new URL("../../PRIVACY.md", import.meta.url), "utf8");
const storePrivacyNotes = fs.readFileSync(
  new URL("../../docs/BROWSER_STORE_PRIVACY.md", import.meta.url),
  "utf8",
);

test("Firefox Manifest V3는 고정 Add-on ID와 이벤트 백그라운드를 사용한다", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.browser_specific_settings.gecko.id, "web-translator@nudenyang.github.io");
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, "142.0");
  assert.deepEqual(manifest.background, {
    scripts: ["native-client.js", "global-state.js", "page-connection.js", "embedded-bridge.js", "messenger-adapters.js", "messenger-privacy.js", "background.js"],
  });
  assert.equal(manifest.key, undefined);
});

test("Firefox 패키지는 Native Messaging과 웹 본문 처리 범위를 명시한다", () => {
  assert.ok(manifest.permissions.includes("nativeMessaging"));
  assert.ok(manifest.permissions.includes("scripting"));
  assert.deepEqual(manifest.host_permissions, ["http://*/*", "https://*/*"]);
  assert.deepEqual(
    manifest.browser_specific_settings.gecko.data_collection_permissions.required,
    ["websiteContent", "browsingActivity"],
  );
  assert.deepEqual(manifest.content_scripts[0].matches, ["http://*/*", "https://*/*"]);
});

test("Firefox의 개인 대화 데이터 권한은 필수가 아닌 별도 동의 항목이다", () => {
  const permissions = manifest.browser_specific_settings.gecko.data_collection_permissions;
  assert.deepEqual(permissions.optional, ["personalCommunications"]);
  assert.equal(permissions.required.includes("personalCommunications"), false);
  assert.ok(manifest.background.scripts.indexOf("messenger-adapters.js") < manifest.background.scripts.indexOf("messenger-privacy.js"));
  assert.ok(manifest.background.scripts.indexOf("messenger-privacy.js") < manifest.background.scripts.indexOf("background.js"));
});

test("브라우저 심사 고지는 전체 탭 상태·메일 범위와 주소 처리를 설명한다", () => {
  assert.match(privacyPolicy, /모든 탭과 새 탭/);
  assert.match(privacyPolicy, /Gmail/);
  assert.match(privacyPolicy, /이전 웹 v1 및 메신저 v1\/v2\/v3\/v4 동의는 자동 승격하지 않습니다/);
  assert.match(privacyPolicy, /쿼리 문자열과 해시/);
  assert.doesNotMatch(privacyPolicy, /새 페이지를 열거나 새로 고치면 다시 꺼진 상태로 시작합니다/);
  assert.doesNotMatch(privacyPolicy, /it resets to off on each page load/i);
  assert.match(storePrivacyNotes, /websiteContent/);
  assert.match(storePrivacyNotes, /browsingActivity/);
  assert.match(storePrivacyNotes, /Remote code:\s*No/i);
  assert.match(storePrivacyNotes, /Web history/i);
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
  assert.match(packager, /page-connection\.js/);
  assert.match(packager, /global-state\.js/);
  assert.match(packager, /'_locales'/);
  assert.doesNotMatch(packager, /Compress-Archive/);
  assert.match(packager, /\.Replace\('\\', '\/'\)/);
});

test("AMO 공개 심사 패키지는 생성 코드 원본과 검토자 안내를 함께 제공한다", () => {
  const amoScript = fs.readFileSync(new URL("../../scripts/package_firefox_amo.ps1", import.meta.url), "utf8");
  const reviewerNotes = fs.readFileSync(new URL("../../docs/FIREFOX_AMO_REVIEW.md", import.meta.url), "utf8");

  assert.match(amoScript, /\$BaseName-source\.zip/);
  assert.match(amoScript, /Get-ChildItem.+extension/);
  assert.match(amoScript, /generate-extension-locales\.mjs/);
  assert.match(amoScript, /package_personal_chromium_extension\.ps1/);
  assert.match(amoScript, /ui-locales\.mjs/);
  assert.match(amoScript, /FIREFOX_AMO_REVIEW\.md/);
  assert.match(amoScript, /PRIVACY\.md/);
  assert.match(amoScript, /\$RootFiles\s*=\s*@\([^\n]*'package-lock\.json'/);
  assert.match(amoScript, /'THIRD_PARTY_NOTICES\.md'/);
  assert.match(amoScript, /'BROWSER_EXTENSION\.md'/);
  assert.match(amoScript, /'BROWSER_STORE_PRIVACY\.md'/);
  assert.match(amoScript, /src-tauri[\\/]+src[\\/]+browser_bridge\.rs/);
  assert.doesNotMatch(amoScript, /Compress-Archive/);
  assert.match(amoScript, /\.Replace\('\\', '\/'\)/);
  assert.match(reviewerNotes, /public listing/i);
  assert.match(reviewerNotes, /On this site/i);
  assert.match(reviewerNotes, /web-translator@nudenyang\.github\.io/);
  assert.match(reviewerNotes, /nativeMessaging/);
  assert.match(reviewerNotes, /scripting/);
  assert.match(reviewerNotes, /websiteContent/);
  assert.match(reviewerNotes, /browsingActivity/);
  assert.match(reviewerNotes, /npm run extension:locales/);
});
