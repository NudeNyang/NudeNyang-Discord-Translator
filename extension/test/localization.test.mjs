import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

await import(`../popup-locales.js?t=${Date.now()}`);

const locales = globalThis.NudeNyangPopupLocales;
const popupHtml = fs.readFileSync(new URL("../popup.html", import.meta.url), "utf8");
const popupJs = fs.readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const chromiumManifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const firefoxManifest = JSON.parse(fs.readFileSync(new URL("../manifest.firefox.json", import.meta.url), "utf8"));
const localeRoot = new URL("../_locales/", import.meta.url);

test("Chromium과 Firefox 패키지는 같은 확장 릴리스 버전을 사용한다", () => {
  assert.equal(chromiumManifest.version, "0.7.6");
  assert.equal(firefoxManifest.version, chromiumManifest.version);
});

test("확장 팝업은 메인 앱과 같은 28개 인터페이스 언어를 제공한다", () => {
  assert.equal(locales.SUPPORTED.length, 28);
  const expectedKeys = Object.keys(locales.COPY.ko).sort();
  for (const language of locales.SUPPORTED) {
    assert.deepEqual(Object.keys(locales.COPY[language]).sort(), expectedKeys, language);
    for (const key of expectedKeys) assert.ok(locales.COPY[language][key], `${language}: ${key}`);
  }
});

test("자동 및 지역별 언어 코드는 메인 앱 규칙과 같은 코드로 정규화한다", () => {
  assert.equal(locales.resolve("auto", "ko-KR"), "ko");
  assert.equal(locales.resolve("auto", "zh-TW"), "zh-Hant");
  assert.equal(locales.resolve("auto", "pt-PT"), "pt-BR");
  assert.equal(locales.resolve("auto", "es-MX"), "es-419");
  assert.equal(locales.resolve("unsupported"), "en");
});

test("팝업은 앱이 전달한 실제 인터페이스 언어를 우선 적용한다", () => {
  assert.match(popupHtml, /popup-locales\.js/);
  assert.match(popupHtml, /data-i18n="webTranslation"/);
  assert.match(popupJs, /nativeStatus\.resolvedUiLanguage \|\| nativeStatus\.uiLanguage/);
  assert.match(popupJs, /document\.documentElement\.lang = uiLanguage/);
  assert.match(popupJs, /document\.documentElement\.dir = \["ar", "ur", "fa", "he"\]/);
});

test("브라우저 관리 화면은 표준 _locales 메타데이터를 사용한다", () => {
  for (const manifest of [chromiumManifest, firefoxManifest]) {
    assert.equal(manifest.default_locale, "en");
    assert.equal(manifest.name, "__MSG_extensionName__");
    assert.equal(manifest.description, "__MSG_extensionDescription__");
    assert.equal(manifest.action.default_title, "__MSG_extensionName__");
  }
  const directories = fs.readdirSync(localeRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory());
  assert.equal(directories.length, 28);
  for (const directory of directories) {
    const messages = JSON.parse(fs.readFileSync(new URL(`${directory.name}/messages.json`, localeRoot), "utf8"));
    assert.equal(messages.extensionName.message, "NudeNyang Web Translator");
    assert.ok(messages.extensionDescription.message);
    assert.ok(messages.togglePageTranslation.message);
  }
});
