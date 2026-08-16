import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { buildGreetingCycle, GREETING_TEXT } from "../greetings.mjs";
import { LANDING_LOCALES, LANGUAGE_OPTIONS, RTL_LOCALES } from "../locales.generated.mjs";
import { detectPreferredLocale, normalizeLocale } from "../locale-utils.mjs";
import { pageScrollThumbMetrics, pageScrollTopFromPointer } from "../scrollbar-utils.mjs";

const baseUrl = new URL("../", import.meta.url);
const [html, css, script] = await Promise.all([
  readFile(new URL("index.html", baseUrl), "utf8"),
  readFile(new URL("styles.css", baseUrl), "utf8"),
  readFile(new URL("script.js", baseUrl), "utf8"),
]);

test("랜딩 페이지의 핵심 구간과 미디어 슬롯이 존재한다", () => {
  for (const id of ["main-content", "how-it-works", "features", "privacy", "discord-notice", "faq"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  const slots = [...html.matchAll(/data-media-slot="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(slots, ["hero", "workflow", "image-translation", "settings"]);
  assert.match(html, /<a href="#how-it-works" data-i18n>기능<\/a>/);
  assert.doesNotMatch(html, /<a href="#features" data-i18n>기능<\/a>/);
});

test("브랜드 아이콘은 기존 표시 방식과 크기를 유지한다", () => {
  assert.doesNotMatch(html, /class="brand-icon"/);
  assert.equal((html.match(/src="\.\.\/assets\/nude-translator\.png"/g) ?? []).length, 2);
  assert.match(css, /\.brand img\s*\{[^}]*border-radius:\s*10px;[^}]*box-shadow:\s*0 8px 22px/s);
  assert.match(css, /@media[^]*\.brand img\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px/s);
});

test("설정 화면 6장을 한 장씩 순서대로 넘긴다", async () => {
  const settingsImages = [
    "settings-01-translation.png",
    "settings-02-engines.png",
    "settings-03-image-translation.png",
    "settings-04-storage.png",
    "settings-05-convenience.png",
    "settings-06-about.png",
  ];

  assert.match(html, /data-settings-carousel/);
  assert.equal((html.match(/data-settings-card/g) ?? []).length, 6);
  assert.equal((html.match(/data-settings-dot=/g) ?? []).length, 6);
  assert.doesNotMatch(html, /data-settings-previous|data-settings-forward/);
  assert.doesNotMatch(html, /data-settings-status|>1<.*>6</s);
  assert.doesNotMatch(html, /설정 화면 사진|라이트 모드 전체 화면|권장 1600 × 1000/);

  let previousPosition = -1;
  for (const imageName of settingsImages) {
    const imagePosition = html.indexOf(`./assets/${imageName}`);
    assert.ok(imagePosition > previousPosition, `${imageName}이 지정한 순서로 배치되어야 합니다.`);
    previousPosition = imagePosition;
    const image = await stat(new URL(`../assets/${imageName}`, import.meta.url));
    assert.ok(image.size > 100_000, `${imageName} 원본 이미지가 필요합니다.`);
  }

  assert.match(css, /\.settings-card-stack\s*\{[^}]*aspect-ratio:\s*1497\s*\/\s*1410/s);
  assert.match(css, /\.showcase\s*\{[^}]*grid-template-columns:\s*minmax\(320px, 0\.9fr\) minmax\(0, 1\.1fr\)/s);
  assert.match(css, /:lang\(ko\) \.showcase-copy h2\s*\{[^}]*overflow-wrap:\s*normal;[^}]*word-break:\s*keep-all/s);
  assert.match(css, /\.settings-card-stack\s*\{[^}]*width:\s*min\(86%, 640px\)/s);
  assert.match(css, /\.settings-card-stack\s*\{[^}]*margin:\s*0 auto clamp\(12px, 2vw, 20px\)/s);
  assert.match(css, /\.settings-card\s*\{[^}]*object-fit:\s*contain/s);
  assert.match(css, /\.settings-card\s*\{[^}]*opacity:\s*0;[^}]*visibility:\s*hidden/s);
  assert.match(css, /\.settings-card\.is-active\s*\{[^}]*opacity:\s*1;[^}]*visibility:\s*visible/s);
  assert.match(script, /function bindSettingsCarousel\(\)/);
  assert.match(script, /nextCardButton\?\.addEventListener\("click", \(\) => show\(activeIndex \+ 1\)\)/);
  assert.match(script, /event\.key === "ArrowLeft"/);
  assert.match(script, /event\.key === "ArrowRight"/);
  assert.match(script, /bindSettingsCarousel\(\)/);
});

test("핵심 사용 흐름과 번역 방식의 장점을 명확히 설명한다", () => {
  for (const copy of [
    "언어 자동 감지",
    "실시간 화면 번역",
    "전송 메시지 통역",
    "메시지부터 이미지까지, 원하는 방식으로 번역합니다.",
    "쓰던 Discord를 그대로 사용합니다.",
    "로컬 AI 모델로 번역 비용을 줄일 수 있습니다.",
  ]) {
    assert.ok(html.includes(copy), `\"${copy}\" 문구가 필요합니다.`);
  }
  assert.match(css, /\.workflow-list\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(css, /:lang\(ko\) \.workflow-list span\s*\{[^}]*word-break:\s*keep-all;[^}]*overflow-wrap:\s*break-word;/s);
  assert.match(html, /로컬 AI를 사용하면 별도의 번역 API 비용 없이 PC에서 번역할 수 있습니다\./);
  assert.match(html, /메시지와 답장은 물론, 이미지 속 글자까지 Discord 안에서 바로 번역합니다\./);
  assert.doesNotMatch(html, /메시지와 답장은 물론, 이미지 속 글자까지 Discord 화면에서 바로 번역합니다\./);
  assert.match(html, /여러 언어가 동시에 표시되어도 메세지별 언어를 자동으로 감지해 번역합니다\./);
  assert.doesNotMatch(html, /여러 언어가 동시에 표시되는 Discord 화면에서도 메시지별 언어를 자동으로 감지해 번역합니다\./);
  assert.doesNotMatch(html, /최근 대화 언어를 감지하여 답장에 맞는 번역 방향을 제안합니다\./);
  assert.doesNotMatch(html, /대화에 필요한 번역을 한곳에 모았습니다\./);
  assert.doesNotMatch(html, /Hy-MT2/);
});

test("설정 소개 제목은 28개 언어로 제공한다", () => {
  const title = "번역 방식부터 언어까지 원하는 대로 설정하세요.";
  assert.ok(html.includes(title));
  assert.doesNotMatch(html, /설정은 단순하게, 선택지는 분명하게 구성했습니다\./);
  for (const [locale] of LANGUAGE_OPTIONS) {
    assert.ok(LANDING_LOCALES[locale]?.[title], `${locale} 설정 소개 제목이 필요합니다.`);
  }
});

test("파란 기능 카드는 선택 언어와 나머지 27개 언어의 인사말을 동시에 보여준다", () => {
  assert.match(html, /class="feature-greetings"[^>]*data-feature-greetings/);
  for (const greeting of ["안녕하세요", "Hello", "こんにちは", "你好"]) assert.ok(html.includes(greeting));
  assert.match(script, /buildGreetingCycle\(locale\)/);
  assert.match(script, /updateGreetingLocale\(currentLocale\)/);
  assert.match(script, /featureGreetings\.replaceChildren/);
  assert.match(script, /function bindGreetingReveal\(\)/);
  assert.match(script, /threshold:\s*0\.38/);
  assert.match(script, /featureGreetings\.classList\.add\("is-typing"\)/);
  assert.doesNotMatch(script, /GREETING_INTERVAL|greetingTimer/);
  assert.match(css, /\.feature-greetings\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/s);
  assert.match(css, /\.feature-greeting\.is-selected\s*\{[^}]*font-size:\s*clamp\(26px, 3vw, 44px\)/s);
  assert.match(css, /\.feature-greetings\.is-typing \.feature-greeting\s*\{[^}]*animation-delay:\s*calc\(var\(--greeting-index, 0\) \* 54ms\)/s);
  assert.match(css, /\.feature-greetings\.is-typing \.feature-greeting\.is-selected\s*\{[^}]*animation:\s*greeting-pop 520ms[^;]* both;/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.feature-greeting\s*\{[^}]*opacity:\s*1/s);
  assert.match(css, /@keyframes greeting-pop/);
  assert.doesNotMatch(script, /buildGreetingCycle\(locale\)\.slice/);
  assert.doesNotMatch(css, /\.feature-greeting:nth-child\(n \+ 7\)/);
  assert.doesNotMatch(html, /data-feature-greetings[^>]*data-i18n/);

  for (const locale of ["ko", "en", "ja", "zh"]) {
    assert.ok(buildGreetingCycle("fr").some((greeting) => greeting.locale === locale));
  }
  for (const [locale] of LANGUAGE_OPTIONS) {
    assert.equal(GREETING_TEXT[locale] !== undefined, true, `${locale} 인사말이 필요합니다.`);
    assert.equal(buildGreetingCycle(locale).length, 28, `${locale} 선택 시 28개 인사말이 모두 필요합니다.`);
    assert.deepEqual(buildGreetingCycle(locale)[0], { locale, text: GREETING_TEXT[locale] });
  }
});

test("로컬 AI 카드는 원래 높이를 유지하고 한국어 제목을 단어 단위로 줄바꿈한다", () => {
  assert.match(css, /:lang\(ko\) \.feature-card h3,[\s\S]*:lang\(ko\) \.feature-card p\s*\{[^}]*word-break:\s*keep-all/s);
  assert.doesNotMatch(css, /\.feature-outgoing\s*\{[^}]*grid-row:\s*span 2/s);
  assert.doesNotMatch(css, /\.feature-outgoing\s*\{[^}]*min-height:\s*558px/s);
});

test("이미지 번역 기능에 실제 번역 전후 화면을 함께 보여준다", async () => {
  const imageTitle = "이미지 속 글자까지 번역합니다.";
  const imageDescription = "사진과 스크린샷의 글자를 자동으로 인식해 선택한 언어로 번역합니다.";
  assert.ok(html.includes(imageTitle));
  assert.ok(html.includes(imageDescription));
  assert.doesNotMatch(html, /이미지 속 글자까지 확인합니다\./);
  assert.doesNotMatch(html, /이미지 원본은 외부 번역 서비스로 보내지 않습니다\./);
  for (const [locale] of LANGUAGE_OPTIONS) {
    assert.ok(LANDING_LOCALES[locale]?.[imageTitle], `${locale} 이미지 번역 제목이 필요합니다.`);
    assert.ok(LANDING_LOCALES[locale]?.[imageDescription], `${locale} 이미지 번역 설명이 필요합니다.`);
  }
  assert.match(html, /src="\.\/assets\/image-translation-original\.png"/);
  assert.match(html, /src="\.\/assets\/image-translation-result\.png"/);
  assert.match(html, /class="translation-preview-image translation-preview-original"/);
  assert.match(html, /class="translation-preview-image translation-preview-result"/);
  assert.doesNotMatch(html, /class="translation-preview-divider"/);
  assert.doesNotMatch(html, /class="translation-preview-main"/);
  assert.doesNotMatch(html, /class="translation-preview-inset"/);
  assert.doesNotMatch(html, />권장 1200 × 900</);
  assert.match(css, /\.translation-preview\s*\{[\s\S]*?border:\s*0[\s\S]*?background:\s*transparent/);
  assert.match(css, /\.translation-preview-image[\s\S]*?padding:\s*8px[\s\S]*?border:\s*1px solid color-mix\(in srgb, var\(--accent\) 18%, var\(--border\)\)/);
  assert.doesNotMatch(css, /\.translation-preview\s*\{[\s\S]*?#fbf5ec/);
  assert.match(css, /\.translation-preview-original[\s\S]*?top:\s*5%[\s\S]*?left:\s*7%[\s\S]*?width:\s*44%/);
  assert.match(css, /\.translation-preview-result[\s\S]*?right:\s*7%[\s\S]*?bottom:\s*5%[\s\S]*?width:\s*44%/);
  assert.doesNotMatch(css, /\.translation-preview-result[\s\S]*?clip-path:/);

  const [original, result] = await Promise.all([
    stat(new URL("../assets/image-translation-original.png", import.meta.url)),
    stat(new URL("../assets/image-translation-result.png", import.meta.url)),
  ]);
  assert.ok(original.size > 0);
  assert.ok(result.size > 0);
});

test("개인정보 구간은 자체 서버와 수집 여부를 명확히 설명한다", () => {
  for (const copy of [
    "개인정보 보호",
    "별도의 운영 서버 없이, 내 PC에서 동작합니다.",
    "NudeNyang Translator는 별도의 중계·저장 서버를 운영하지 않으며, 대화 내역과 개인정보를 자체 서버로 전송하거나 보관하지 않습니다.",
    "자체 서버 없음",
    "대화 내역을 수집하지 않음",
    "Discord 데이터 그대로 유지",
    "Discord 사용자 토큰과 self-bot을 사용하지 않으며 설치 파일과 서버 데이터를 수정하지 않습니다.",
    "온라인 번역 엔진을 선택하면 번역에 필요한 텍스트가 해당 서비스로 직접 전달될 수는 있습니다.",
  ]) {
    assert.ok(html.includes(copy), `\"${copy}\" 문구가 필요합니다.`);
  }
  assert.ok(html.includes("회원가입이나 서버 연결 없이 앱이 PC에서 직접 동작합니다."));
  assert.ok(html.includes("대화 내용, 이미지와 번역 기록을 수집하거나 보관하지 않습니다."));
  assert.equal(html.includes("번역 기록을 NudeNyang"), false);
  assert.equal(html.includes("NudeNyang 서버 연결"), false);
  for (const removed of ["작동 방식과 개인정보", "필요한 범위만 연결하고", "로컬 번역", "온라인 번역", "이미지 처리"]) {
    assert.doesNotMatch(html, new RegExp(`>${removed}<`), `\"${removed}\" 항목은 제거해야 합니다.`);
  }
  assert.match(css, /\.privacy-points \.privacy-note\s*\{[^}]*border-left:\s*3px solid/s);
  assert.match(css, /\.privacy-copy\s*\{[^}]*position:\s*static/s);
  assert.doesNotMatch(css, /\.privacy-copy\s*\{[^}]*position:\s*sticky/s);
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
  assert.doesNotMatch(css, /\.discord-policy-links a\s*\{[^}]*border-bottom:/s);
  assert.doesNotMatch(css, /\.discord-policy-links a:hover\s*\{[^}]*border-bottom/s);
});

test("히어로에는 다운로드 CTA만 노출한다", () => {
  assert.match(html, /class="button primary"[^>]*>Windows Beta 다운로드<\/a>/);
  assert.doesNotMatch(html, /class="button secondary"[^>]*href="#how-it-works"/);
  assert.doesNotMatch(html, />작동 방식 보기<\/a>/);
  assert.doesNotMatch(html, /class="download-section"/);
  assert.doesNotMatch(html, />Discord 대화를 원하는 언어로 확인해 보십시오\.<\/h2>/);
});

test("번역 엔진 아이콘은 각 공식 사이트로 연결한다", () => {
  for (const href of [
    "https://openai.com/",
    "https://www.anthropic.com/",
    "https://gemini.google.com/",
    "https://www.deepl.com/",
  ]) {
    assert.match(html, new RegExp(`<a href="${href.replaceAll(".", "\\.")}" target="_blank" rel="noopener noreferrer"`));
  }
  assert.equal((html.match(/aria-label="(?:OpenAI|Anthropic|Google Gemini|DeepL) 공식 사이트"/g) ?? []).length, 4);
  assert.match(css, /\.provider-list a:hover,[\s\S]*?transform:\s*translateY\(-3px\)/);
});

test("Beta 표기는 모든 UI 언어에서 영문으로 유지한다", () => {
  assert.match(html, /data-i18n>Beta 다운로드<\/a>/);
  assert.match(html, /data-i18n>Windows Beta 다운로드<\/a>/);
  assert.doesNotMatch(html, /베타/);

  for (const [locale] of LANGUAGE_OPTIONS) {
    const navDownload = LANDING_LOCALES[locale]?.["Beta 다운로드"];
    const windowsDownload = LANDING_LOCALES[locale]?.["Windows Beta 다운로드"];
    assert.ok(navDownload?.includes("Beta"), `${locale} 내비게이션에 영문 Beta 표기가 필요합니다.`);
    assert.ok(windowsDownload?.includes("Beta"), `${locale} 다운로드 CTA에 영문 Beta 표기가 필요합니다.`);
  }
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
  assert.match(css, /:lang\(ko\) \.feature-card p\s*\{[^}]*word-break:\s*keep-all/s);
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

test("중복 제품 지원 범위를 제거하고 지원 언어 구분선만 남긴다", () => {
  assert.doesNotMatch(html, /class="fact-band"/);
  assert.doesNotMatch(css, /\.fact-band|\.fact-grid/);
  assert.match(css, /\.supported-languages\s*\{[^}]*border-top:\s*1px solid var\(--border\)/s);
  assert.match(css, /\.supported-languages\s*\{[^}]*border-bottom:\s*1px solid var\(--border\)/s);
});

test("메인 화면에서 28개 지원 언어를 선택해 UI 언어를 바꿀 수 있다", () => {
  assert.match(html, /id="supported-languages"/);
  assert.match(html, /class="[^"]*supported-language-grid[^"]*"/);
  assert.doesNotMatch(html, /28개 UI 언어를 지원합니다/);
  assert.doesNotMatch(html, /언어를 선택하면 페이지 전체/);
  assert.match(css, /\.supported-languages\s*\{[^}]*padding-block:\s*48px 88px/s);
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

test("첫 방문에는 브라우저와 시스템 언어에서 가장 가까운 UI 언어를 자동 선택한다", () => {
  assert.equal(detectPreferredLocale(["fr-CA", "en-US"]), "fr");
  assert.equal(detectPreferredLocale(["xx-YY", "ja-JP"]), "ja");
  assert.equal(detectPreferredLocale(["zh-HK", "en-US"]), "zh-Hant");
  assert.equal(detectPreferredLocale([], "ko"), "ko");
  assert.match(script, /window\.localStorage\.getItem\("landing-locale"\)/);
  assert.match(script, /navigator\.languages/);
  assert.match(script, /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.locale/);
  assert.match(script, /detectPreferredLocale\(browserLocales\)/);
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
