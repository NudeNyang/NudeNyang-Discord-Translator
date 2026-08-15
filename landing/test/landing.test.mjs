import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { LANDING_LOCALES, LANGUAGE_OPTIONS, RTL_LOCALES } from "../locales.generated.mjs";
import { normalizeLocale } from "../locale-utils.mjs";

const baseUrl = new URL("../", import.meta.url);
const [html, css, script] = await Promise.all([
  readFile(new URL("index.html", baseUrl), "utf8"),
  readFile(new URL("styles.css", baseUrl), "utf8"),
  readFile(new URL("script.js", baseUrl), "utf8"),
]);

test("랜딩 페이지의 핵심 구간과 미디어 슬롯이 존재한다", () => {
  for (const id of ["main-content", "how-it-works", "features", "privacy", "faq", "download"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  const slots = [...html.matchAll(/data-media-slot="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(slots, ["hero", "workflow", "image-translation", "settings"]);
});

test("히어로에는 다운로드 CTA만 노출한다", () => {
  assert.match(html, /class="button primary"[^>]*>Windows 베타 다운로드<\/a>/);
  assert.doesNotMatch(html, /class="button secondary"[^>]*href="#how-it-works"/);
  assert.doesNotMatch(html, />작동 방식 보기<\/a>/);
});

test("기존 앱의 색상 토큰과 반응형 규칙을 사용한다", () => {
  for (const token of ["#f1f6fa", "#fbfdff", "#12283a", "#347fc7"]) {
    assert.ok(css.includes(token), `${token} 색상 토큰이 필요합니다.`);
  }

  assert.match(css, /min-height:\s*calc\(100dvh/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("테마, 모바일 메뉴와 스크롤 공개 동작을 제공한다", () => {
  assert.match(script, /landing-theme/);
  assert.match(script, /landing-locale/);
  assert.match(script, /IntersectionObserver/);
  assert.match(script, /aria-expanded/);
});

test("헤더 언어 선택창의 V 아이콘이 버튼 중앙에 정렬된다", () => {
  assert.match(html, /class="language-trigger-chevron"/);
  assert.doesNotMatch(html, />⌄</);
  assert.match(css, /\.language-trigger\s*\{[^}]*align-items:\s*center[^}]*min-height:\s*48px/s);
  assert.match(css, /\.language-trigger-chevron\s*\{[^}]*width:\s*14px[^}]*height:\s*14px/s);
  assert.match(css, /\.language-trigger-chevron::before\s*\{[^}]*top:\s*50%[^}]*left:\s*50%/s);
  assert.match(css, /\.language-trigger\[aria-expanded="true"\] \.language-trigger-chevron/);
});

test("제품 지원 범위의 위 구분선만 콘텐츠 너비 안에서 끝난다", () => {
  assert.match(css, /\.fact-band\s*\{[^}]*border-bottom:\s*1px solid var\(--border\)/s);
  assert.doesNotMatch(css, /\.fact-band\s*\{[^}]*border-top:/s);
  assert.match(css, /\.fact-grid\s*\{[^}]*border-top:\s*1px solid var\(--border\)/s);
  assert.doesNotMatch(css, /\.fact-grid\s*\{[^}]*border-bottom:/s);
  assert.match(css, /\.supported-languages\s*\{[^}]*border-top:\s*1px solid var\(--border\)/s);
});

test("메인 화면에서 28개 지원 언어를 선택해 UI 언어를 바꿀 수 있다", () => {
  assert.match(html, /id="supported-languages"/);
  assert.match(html, /class="[^"]*supported-language-grid[^"]*"/);
  assert.doesNotMatch(html, /28개 UI 언어를 지원합니다/);
  assert.doesNotMatch(html, /언어를 선택하면 페이지 전체/);
  assert.match(css, /\.supported-languages-layout\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(script, /renderSupportedLanguages/);
  assert.match(script, /supportedLanguageGrid\.addEventListener\("click"/);
  assert.match(script, /applyLocale\(option\.dataset\.locale\)/);
  assert.doesNotMatch(script, /compactNode/);
});

test("중국어 간체와 번체 선택값이 서로 섞이지 않는다", () => {
  const simplifiedChinese = LANGUAGE_OPTIONS.find(([code]) => code === "zh");
  assert.equal(simplifiedChinese[1], "简体中文");
  assert.equal(simplifiedChinese[3], "Simplified Chinese");
  assert.notEqual(LANDING_LOCALES.zh["Discord는 그대로,"], LANDING_LOCALES.ko["Discord는 그대로,"]);
  assert.equal(normalizeLocale("zh"), "zh");
  assert.equal(normalizeLocale("zh-CN"), "zh");
  assert.equal(normalizeLocale("zh-Hans"), "zh");
  assert.equal(normalizeLocale("zh-Hant"), "zh-Hant");
  assert.equal(normalizeLocale("zh-TW"), "zh-Hant");
  assert.equal(normalizeLocale("zh-HK"), "zh-Hant");
});

test("사용자 노출 문구에 금지된 대시 문자가 없다", () => {
  assert.equal(/[—–]/u.test(html), false);
  assert.equal(/[—–]/u.test(JSON.stringify(LANDING_LOCALES)), false);
});

test("페이지 UI 번역이 28개 언어에 빠짐없이 제공된다", () => {
  assert.equal(LANGUAGE_OPTIONS.length, 28);
  assert.deepEqual(RTL_LOCALES, ["ar", "fa", "he", "ur"]);

  const sourcePattern = /<([a-z][\w-]*)\b[^>]*\sdata-i18n(?=\s|>)[^>]*>([^<]+)<\/\1>/giu;
  const sources = new Set(["밝게", "인터페이스 언어", "어두운 테마로 전환", "밝은 테마로 전환"]);
  for (const match of html.matchAll(sourcePattern)) sources.add(match[2].trim());
  for (const match of html.matchAll(/data-i18n-placeholder="([^"]+)"/gu)) sources.add(match[1].trim());

  for (const [locale] of LANGUAGE_OPTIONS) {
    assert.ok(LANDING_LOCALES[locale], `${locale} 번역이 필요합니다.`);
    for (const source of sources) {
      assert.ok(LANDING_LOCALES[locale][source], `${locale}의 "${source}" 번역이 필요합니다.`);
    }
  }
});
