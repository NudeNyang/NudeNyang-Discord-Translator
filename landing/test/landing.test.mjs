import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { LANDING_LOCALES, LANGUAGE_OPTIONS, RTL_LOCALES } from "../locales.generated.mjs";
import { normalizeLocale } from "../locale-utils.mjs";
import { pageScrollThumbMetrics, pageScrollTopFromPointer } from "../scrollbar-utils.mjs";

const baseUrl = new URL("../", import.meta.url);
const [html, css, script] = await Promise.all([
  readFile(new URL("index.html", baseUrl), "utf8"),
  readFile(new URL("styles.css", baseUrl), "utf8"),
  readFile(new URL("script.js", baseUrl), "utf8"),
]);

test("랜딩 페이지의 핵심 구간과 미디어 슬롯이 존재한다", () => {
  for (const id of ["main-content", "how-it-works", "features", "privacy", "discord-notice", "faq", "download"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  const slots = [...html.matchAll(/data-media-slot="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(slots, ["hero", "workflow", "image-translation", "settings"]);
});

test("핵심 사용 흐름과 번역 방식의 장점을 명확히 설명한다", () => {
  for (const copy of [
    "언어 자동 감지",
    "실시간 화면 번역",
    "전송 메시지 통역",
    "쓰던 Discord를 그대로 사용합니다.",
    "로컬 AI 모델로 번역 비용을 줄일 수 있습니다.",
  ]) {
    assert.ok(html.includes(copy), `\"${copy}\" 문구가 필요합니다.`);
  }
  assert.match(html, /로컬 AI를 사용하면 별도의 번역 API 비용 없이 PC에서 번역할 수 있습니다\./);
  assert.match(html, /여러 언어가 동시에 표시되는 Discord 화면에서도 메시지별 언어를 자동으로 감지해 번역합니다\./);
  assert.doesNotMatch(html, /최근 대화 언어를 감지하여 답장에 맞는 번역 방향을 제안합니다\./);
  assert.doesNotMatch(html, /Hy-MT2/);
});

test("파란 기능 카드의 인사말은 모든 UI 언어에서 한글로 고정한다", () => {
  assert.match(html, /class="feature-word" aria-hidden="true">안녕하세요<\/span>/);
  assert.doesNotMatch(html, /class="feature-word"[^>]*data-i18n/);
});

test("Discord 이용 안내와 공식 정책 링크를 FAQ 앞에 제공한다", () => {
  const noticeIndex = html.indexOf('id="discord-notice"');
  const faqIndex = html.indexOf('id="faq"');

  assert.ok(noticeIndex > 0, "Discord 이용 안내 구간이 필요합니다.");
  assert.ok(noticeIndex < faqIndex, "Discord 이용 안내는 FAQ 앞에 배치해야 합니다.");
  assert.match(html, /href="https:\/\/discord\.com\/terms"/);
  assert.match(html, /href="https:\/\/discord\.com\/safety\/platform-manipulation-policy-explainer-oct-2023"/);
  assert.match(html, />Discord 이용 약관</);
  assert.match(html, />플랫폼 조작 정책</);
  assert.match(html, />Discord 이용 약관에 위배될 수 있나요\?</);
  assert.match(html, /사용 여부와 결과에 대한 책임은 사용자에게 있습니다\./);
  assert.doesNotMatch(css, /\.discord-notice[^}]*#[0-9a-f]{3,8}/i);
});

test("히어로에는 다운로드 CTA만 노출한다", () => {
  assert.match(html, /class="button primary"[^>]*>Windows 베타 다운로드<\/a>/);
  assert.doesNotMatch(html, /class="button secondary"[^>]*href="#how-it-works"/);
  assert.doesNotMatch(html, />작동 방식 보기<\/a>/);
});

test("히어로에서 실제 번역 영상을 재생한다", async () => {
  assert.match(html, /<video\b[^>]*class="media-stage hero-media reveal"[^>]*data-media-slot="hero"[^>]*data-hero-video/s);
  assert.match(html, /<source src="\.\/assets\/hero-discord-translation\.mp4" type="video\/mp4"\s*\/>/);
  assert.match(html, /<video\b[^>]*muted[^>]*loop[^>]*playsinline/s);
  assert.doesNotMatch(html, /<video\b[^>]*\scontrols(?:\s|>|=)/s);
  assert.doesNotMatch(html, /<video\b[^>]*\scontrolslist=/s);
  assert.match(html, /<video\b[^>]*preload="metadata"/s);
  assert.match(html, /<video\b[^>]*poster="\.\/assets\/hero-discord-translation-poster\.jpg"/s);
  assert.match(css, /\.hero-media\s*\{[^}]*object-fit:\s*cover[^}]*pointer-events:\s*none/s);
  assert.match(script, /prefers-reduced-motion:\s*reduce/);
  assert.match(script, /heroVideo\.play\(\)/);

  const [video, poster] = await Promise.all([
    stat(new URL("../assets/hero-discord-translation.mp4", import.meta.url)),
    stat(new URL("../assets/hero-discord-translation-poster.jpg", import.meta.url)),
  ]);
  assert.ok(video.size > 1_000_000, "히어로 MP4 파일이 필요합니다.");
  assert.ok(poster.size > 10_000, "히어로 포스터 이미지가 필요합니다.");
});

test("기능 소개 영상은 화면에 들어온 뒤 조작부 없이 자동 재생한다", async () => {
  const workflowOpenTag = html.match(/<video\b[^>]*class="media-stage workflow-media reveal"[^>]*data-media-slot="workflow"[^>]*data-scroll-autoplay[^>]*>/s)?.[0];
  assert.ok(workflowOpenTag, "기능 소개 video 요소가 필요합니다.");
  assert.match(html, /<source src="\.\/assets\/workflow-discord-translation\.mp4" type="video\/mp4"\s*\/>/);
  assert.match(workflowOpenTag, /muted[\s\S]*playsinline[\s\S]*disablepictureinpicture/);
  assert.match(workflowOpenTag, /preload="metadata"[\s\S]*poster="\.\/assets\/workflow-discord-translation-poster\.jpg"/);
  assert.match(workflowOpenTag, /tabindex="0"/);
  assert.doesNotMatch(workflowOpenTag, /\scontrols(?:\s|>|=)/);
  assert.doesNotMatch(workflowOpenTag, /\sloop(?:\s|>|=)/);
  assert.match(script, /const workflowVideo = document\.querySelector\("\[data-scroll-autoplay\]"\)/);
  assert.match(script, /window\.setTimeout\([\s\S]*?300\)/);
  assert.match(script, /threshold:\s*\[0,\s*0\.12\]/);
  assert.match(script, /rootMargin:\s*"0px 0px -20% 0px"/);
  assert.match(script, /reduceMotionPreference\.matches/);
  assert.match(css, /\.workflow-media\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9[^}]*height:\s*auto[^}]*object-fit:\s*contain/s);

  const [video, poster] = await Promise.all([
    stat(new URL("../assets/workflow-discord-translation.mp4", import.meta.url)),
    stat(new URL("../assets/workflow-discord-translation-poster.jpg", import.meta.url)),
  ]);
  assert.ok(video.size > 1_000_000, "기능 소개 MP4 파일이 필요합니다.");
  assert.ok(video.size < 30_000_000, "기능 소개 MP4는 웹 전송에 맞게 최적화해야 합니다.");
  assert.ok(poster.size > 10_000, "기능 소개 포스터 이미지가 필요합니다.");
});

test("기존 앱의 색상 토큰과 반응형 규칙을 사용한다", () => {
  for (const token of ["#f1f6fa", "#fbfdff", "#12283a", "#347fc7"]) {
    assert.ok(css.includes(token), `${token} 색상 토큰이 필요합니다.`);
  }

  assert.match(css, /min-height:\s*calc\(100dvh/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /:lang\(ko\)[^{]*h2[^}]*word-break:\s*keep-all/s);
  assert.match(css, /:lang\(ja\)[^{]*\{[^}]*word-break:\s*auto-phrase/s);
});

test("테마, 모바일 메뉴와 스크롤 공개 동작을 제공한다", () => {
  assert.match(script, /landing-theme/);
  assert.match(script, /landing-locale/);
  assert.match(script, /IntersectionObserver/);
  assert.match(script, /aria-expanded/);
});

test("페이지 스크롤바가 화면 비율과 위치를 정확히 반영한다", () => {
  assert.deepEqual(pageScrollThumbMetrics(800, 400, 1600, 600), {
    scrollable: true,
    height: 200,
    top: 300,
  });
  assert.deepEqual(pageScrollThumbMetrics(800, 900, 800, 0), {
    scrollable: false,
    height: 0,
    top: 0,
  });
  assert.equal(pageScrollTopFromPointer(600, 100, 1000, 200, 1000), 500);
  assert.equal(pageScrollTopFromPointer(-100, 100, 1000, 200, 1000), 0);
  assert.equal(pageScrollTopFromPointer(2000, 100, 1000, 200, 1000), 1000);
});

test("오른쪽 끝에서만 나타나는 얇은 페이지 스크롤바를 제공한다", () => {
  assert.match(html, /data-page-scroll-indicator/);
  assert.match(html, /class="page-scroll-indicator-thumb"/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\) and \(min-width: 721px\)/);
  assert.match(css, /html::-webkit-scrollbar,[^}]*body::-webkit-scrollbar\s*\{[^}]*width:\s*0/s);
  assert.match(css, /\.page-scroll-indicator-thumb\s*\{[^}]*width:\s*3px/s);
  assert.match(css, /\.page-scroll-indicator:hover \.page-scroll-indicator-thumb,[^}]*width:\s*6px/s);
  assert.match(css, /\.page-scroll-indicator\.is-scroll-active/);
  assert.match(script, /PAGE_SCROLL_REVEAL_DISTANCE\s*=\s*42/);
  assert.match(script, /PAGE_SCROLL_IDLE_DELAY\s*=\s*700/);
  assert.match(script, /classList\.add\("is-scroll-active"\)/);
  assert.match(script, /clearTimeout\(scrollIdleTimer\)/);
  assert.match(script, /document\.addEventListener\("pointermove"/);
  assert.match(script, /document\.addEventListener\("wheel", showIndicatorWhileScrolling/);
  assert.match(script, /document\.addEventListener\("scroll"/);
  assert.doesNotMatch(script, /window\.addEventListener\("scroll"/);
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

test("별도 번역기를 사용하지 않아도 된다는 제목을 언어별로 자연스럽게 표시한다", () => {
  const workflowTitle = "번역하려고 별도의 번역기를 켤 필요가 없습니다.";
  const japaneseTitle = LANDING_LOCALES.ja[workflowTitle];

  assert.equal(LANDING_LOCALES.ko[workflowTitle], workflowTitle);
  assert.equal(japaneseTitle.replaceAll("\u2060", ""), "翻訳のために別の翻訳アプリを開く必要はありません。");
  assert.match(japaneseTitle, /翻\u2060訳\u2060ア\u2060プ\u2060リ\u2060を/u);
  for (const [locale] of LANGUAGE_OPTIONS) {
    assert.doesNotMatch(LANDING_LOCALES[locale][workflowTitle], /Discord/u);
  }
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
