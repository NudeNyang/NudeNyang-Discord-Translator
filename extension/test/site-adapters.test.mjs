import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import "../site-adapters.js";

const { adapterForLocation, exclusionSelector } = globalThis.NudeNyangSiteAdapters;

test("지원 사이트와 차단 경로를 구분한다", () => {
  assert.equal(adapterForLocation(new URL("https://github.com/NudeNyang/project/issues/1")).id, "github");
  assert.equal(adapterForLocation(new URL("https://booth.pm/ko/items/123")).id, "booth");
  assert.equal(adapterForLocation(new URL("https://nudenyang.booth.pm/items/123")).id, "booth");
  assert.equal(adapterForLocation(new URL("https://www.google.co.kr/search?q=test")).id, "google");
  assert.equal(adapterForLocation(new URL("https://www.youtube.com/watch?v=abc")).id, "youtube");
  assert.equal(adapterForLocation(new URL("https://x.com/home")).id, "x");
  assert.equal(adapterForLocation(new URL("https://x.com/messages")), null);
  assert.equal(adapterForLocation(new URL("https://example.com/articles/hello")).id, "web");
});

test("DLsite 서클 리포트의 div 기반 작품 소개와 구매 버튼 문구를 번역한다", () => {
  const report = adapterForLocation(new URL(
    "https://www.dlsite.com/maniax/circle/report/=/report/202607202",
  ));

  assert.equal(report.id, "dlsite-report");
  assert.ok(report.blocks.includes("article.circle_report .work_name"));
  assert.ok(report.blocks.includes("article.circle_report .catchphrase"));
  assert.ok(report.blocks.includes("article.circle_report .report_section .content"));
  assert.ok(report.blocks.includes("article.circle_report .btn_report.type_cart"));
  assert.equal(
    adapterForLocation(new URL("https://www.dlsite.com/maniax/work/=/product_id/RJ01669233.html")).id,
    "dlsite",
  );
});

test("DLsite 공개 페이지의 상단 카테고리와 탐색 링크를 번역한다", () => {
  const dlsite = adapterForLocation(new URL("https://www.dlsite.com/maniax/"));
  const publicNavigationLinks = dlsite.blocks.filter((selector) => (
    selector.includes("a[href]") && selector.includes("/mypage")
  ));
  const staticHeaderLabels = [
    "#header .login_information_item.type_point > .coupon_text",
    "#header .login_information_item.type_coupon > .coupon_text",
    "#header .header_dropdown_nav.type_language .header_dropdown_nav_Link",
    "#header .header_dropdown_nav.type_service .header_dropdown_nav_Link",
    "#header .globalNav > .globalNav-item.type-favorite > a > i",
    "#header .globalNav > .globalNav-item.type-cart > a > i",
    "#header .globalNav > .globalNav-item.type-play > a > i",
    "#header .globalNav > .globalNav-item.type-circle > a > i",
    "#header .globalNav > .globalNav-item.type-guide > a > i",
  ];

  assert.equal(dlsite.id, "dlsite");
  assert.ok(publicNavigationLinks.some((selector) => selector.startsWith("#header a[href]")));
  assert.ok(publicNavigationLinks.some((selector) => selector.startsWith("header a[href]")));
  assert.ok(publicNavigationLinks.some((selector) => selector.startsWith("nav a[href]")));
  assert.ok(publicNavigationLinks.some((selector) => selector.startsWith("#left a[href]")));
  assert.ok(dlsite.blocks.includes("#header .header_description"));
  assert.ok(dlsite.exclusionBypassBlocks.includes("#header .header_description"));
  for (const staticHeaderLabel of staticHeaderLabels) {
    assert.ok(dlsite.blocks.includes(staticHeaderLabel));
    assert.ok(dlsite.exclusionBypassBlocks.includes(staticHeaderLabel));
  }
  assert.ok(dlsite.excludes.includes("#header .login_information .number"));
  for (const publicNavigationLink of publicNavigationLinks) {
    assert.match(publicNavigationLink, /cart/);
    assert.ok(dlsite.exclusionBypassBlocks.includes(publicNavigationLink));
  }
  assert.equal(
    adapterForLocation(new URL("https://www.dlsite.com/maniax/mypage")),
    null,
  );
  assert.equal(
    adapterForLocation(new URL("https://www.dlsite.com/maniax/cart")),
    null,
  );
});

test("DLsite 공개 페이지는 범용 문서와 왼쪽 카테고리 목록을 계속 번역한다", () => {
  const dlsite = adapterForLocation(new URL(
    "https://www.dlsite.com/maniax/circle/profile/=/maker_id/RG12345.html",
  ));

  assert.equal(dlsite.id, "dlsite");
  assert.ok(dlsite.blocks.includes("body p"));
  assert.ok(dlsite.blocks.includes("body li"));
  assert.ok(dlsite.blocks.includes("body table td"));
});

test("공개 본문 루트의 비시맨틱 읽기 블록과 CTA를 범용으로 번역한다", () => {
  const welcome = adapterForLocation(new URL("https://www.dlsite.com/home/welcome"));
  const generic = adapterForLocation(new URL("https://example.com/landing"));

  assert.equal(welcome.id, "dlsite");
  for (const adapter of [welcome, generic]) {
    assert.ok(adapter.blocks.some((selector) => selector.startsWith("#main ")));
    assert.ok(adapter.blocks.some((selector) => selector.startsWith("main ")));
    assert.ok(adapter.blocks.some((selector) => selector.includes("[role='main'] ")));
    assert.ok(adapter.blocks.some((selector) => selector.includes(":is(div,section,span,a,")));
    assert.ok(adapter.blocks.some((selector) => selector.includes(":not(:has(*:not(br)))")));
    assert.ok(adapter.blocks.some((selector) => selector.includes("p *")));
  }
});

test("EISYS 공개 기업 페이지의 상단 메뉴와 하단 안내를 번역한다", () => {
  const eisys = adapterForLocation(new URL("https://www.eisys.co.jp/company/information"));
  const publicNavigationBlocks = [
    "nav.header_navi a[href^='https://www.eisys.co.jp/']",
    "footer.l-footer .footer_sitemap a[href]",
    "footer.l-footer .corp_navi a[href]",
    "footer.l-footer .footer_parent_text",
    "footer.l-footer .corp_support",
  ];

  assert.equal(eisys.id, "eisys");
  assert.ok(eisys.blocks.includes("body table td"));
  for (const selector of publicNavigationBlocks) {
    assert.ok(eisys.blocks.includes(selector));
    assert.ok(eisys.exclusionBypassBlocks.includes(selector));
  }
});

test("특집형 상품 페이지의 카테고리와 정적 하단 안내를 번역한다", () => {
  const report = adapterForLocation(new URL(
    "https://www.dlsite.com/maniax/circle/report/=/report/202607202",
  ));

  assert.ok(report.blocks.includes("#left .left_module h3"));
  assert.ok(report.blocks.includes("#left .list_head h4"));
  assert.ok(report.blocks.includes("#left .list_content_text_item > a"));
  assert.ok(report.blocks.includes("#left .list_text_indent > a"));
  assert.ok(report.blocks.includes("#footer .floor_list_item > a"));
  assert.ok(report.blocks.includes("#footer .label"));
  assert.ok(report.blocks.includes("#footer .link_list_item > a"));
  assert.ok(report.blocks.includes("#footer .img_list_text"));
  assert.ok(report.blocks.includes("#footer .recruit a"));
});

test("범용 어댑터는 일반 HTTP 문서를 지원하고 브라우저 내부 페이지는 건드리지 않는다", () => {
  assert.equal(adapterForLocation(new URL("http://example.com/news/today")).id, "web");
  assert.equal(adapterForLocation(new URL("https://developer.mozilla.org/docs/Web/API")).id, "web");
  assert.equal(adapterForLocation(new URL("chrome://extensions")), null);
  assert.equal(adapterForLocation(new URL("file:///C:/private/document.html")), null);
});

test("범용 어댑터는 민감한 계정·결제·메시지 경로를 차단한다", () => {
  for (const url of [
    "https://example.com/login",
    "https://example.com/account/settings",
    "https://example.com/cart",
    "https://example.com/checkout/payment",
    "https://example.com/#/checkout",
    "https://example.com/messages/123",
    "https://example.com/admin/dashboard",
  ]) {
    assert.equal(adapterForLocation(new URL(url)), null, url);
  }
  assert.equal(adapterForLocation(new URL("https://discord.com/channels/123/456")), null);
  assert.equal(adapterForLocation(new URL("https://example.com/articles/orders-of-magnitude")).id, "web");
});

test("전용 사이트의 차단 경로가 범용 어댑터로 우회되지 않는다", () => {
  assert.equal(adapterForLocation(new URL("https://x.com/messages/123")), null);
  assert.equal(adapterForLocation(new URL("https://www.youtube.com/studio")), null);
});

test("범용 어댑터는 문단 구조를 허용하고 입력·탐색·민감 UI를 제외한다", () => {
  const web = adapterForLocation(new URL("https://example.com/articles/hello"));
  const selector = exclusionSelector(web);

  assert.equal(web.manualOnly, true);
  assert.ok(web.blocks.includes("body p"));
  assert.ok(web.blocks.includes("body blockquote"));
  assert.ok(web.blocks.includes("body figcaption"));
  assert.ok(web.blocks.some((value) => value.startsWith("main ")));
  assert.match(selector, /form/);
  assert.match(selector, /nav/);
  assert.match(selector, /button/);
  assert.match(selector, /\[role='button'\]/);
  assert.match(selector, /\[role='dialog'\]/);
  assert.match(selector, /\[aria-live\]/);
  assert.match(selector, /\[contenteditable\]/);
});

test("공통 입력·코드 제외 규칙과 사이트별 개인정보 제외 규칙을 합친다", () => {
  const github = adapterForLocation(new URL("https://github.com/NudeNyang/project"));
  const selector = exclusionSelector(github);
  assert.match(selector, /textarea/);
  assert.match(selector, /pre/);
  assert.match(selector, /\.blob-code/);
});

test("GitHub Markdown 표의 셀도 번역 블록에 포함한다", () => {
  const github = adapterForLocation(new URL("https://github.com/NudeNyang/project"));
  assert.ok(github.blocks.includes(".markdown-body table th"));
  assert.ok(github.blocks.includes(".markdown-body table td"));
});

test("GitHub Markdown의 하위 제목과 접이식 요약도 번역한다", () => {
  const github = adapterForLocation(new URL("https://github.com/NudeNyang/project"));

  assert.ok(github.blocks.includes(".markdown-body h4"));
  assert.ok(github.blocks.includes(".markdown-body h6"));
  assert.ok(github.blocks.includes(".markdown-body details > summary"));
});

test("Google의 최신 카드형 검색 결과 제목도 번역한다", () => {
  const google = adapterForLocation(new URL("https://www.google.com/search?q=translator"));

  assert.ok(google.blocks.includes("#search h1"));
  assert.ok(google.blocks.includes("#search h2"));
  assert.ok(google.blocks.includes("#search [role='heading']"));
});

test("YouTube의 새 설명과 추천 영상 ViewModel도 번역한다", () => {
  const youtube = adapterForLocation(new URL("https://www.youtube.com/watch?v=abc"));

  assert.ok(youtube.blocks.includes("ytd-text-inline-expander #attributed-snippet-text"));
  assert.ok(youtube.blocks.includes(".ytLockupMetadataViewModelTitle"));
  assert.ok(youtube.blocks.includes("ytd-media-lockup-renderer #title"));
});

test("X 프로필은 소개만 번역하고 표시 이름과 핸들은 제외한다", () => {
  const x = adapterForLocation(new URL("https://x.com/nudenyang"));
  const selector = exclusionSelector(x);

  assert.ok(x.blocks.includes("[data-testid='UserDescription']"));
  assert.match(selector, /\[data-testid='UserName'\]/);
});

test("X 사진 뷰어 대화상자에서도 게시물과 기사 카드 본문을 번역한다", () => {
  const x = adapterForLocation(new URL("https://x.com/nudenyang/status/123/photo/1"));
  const tweetText = "article [data-testid='tweetText']";
  const largeCard = "article [data-testid='card.layoutLarge.detail']";
  const smallCard = "article [data-testid='card.layoutSmall.detail']";

  assert.match(exclusionSelector(x), /\[role='dialog'\]/);
  assert.ok(x.blocks.includes(tweetText));
  assert.ok(x.blocks.includes(largeCard));
  assert.ok(x.blocks.includes(smallCard));
  assert.ok(x.exclusionBypassBlocks.includes(tweetText));
  assert.ok(x.exclusionBypassBlocks.includes(largeCard));
  assert.ok(x.exclusionBypassBlocks.includes(smallCard));
});

test("X 기사 카드와 긴 형식 기사 본문을 번역 대상으로 포함한다", () => {
  const x = adapterForLocation(new URL("https://x.com/nudenyang/article/123"));
  const articleCard = "article [data-testid='card.wrapper'] [dir='auto']";
  const articleTitle =
    "[data-testid='twitterArticleReadView'] [data-testid='twitter-article-title']";
  const articleParagraph =
    "[data-testid='twitterArticleReadView'] section[data-block='true']";

  assert.ok(x.blocks.includes(articleCard));
  assert.ok(x.blocks.includes(articleTitle));
  assert.ok(x.blocks.includes(articleParagraph));
  assert.ok(x.exclusionBypassBlocks.includes(articleCard));
  assert.ok(x.exclusionBypassBlocks.includes(articleTitle));
  assert.ok(x.exclusionBypassBlocks.includes(articleParagraph));
  assert.ok(!x.blocks.some((selector) => selector.includes("markdown-code-block")));
});

test("BOOTH Tailwind order 레이아웃 클래스는 주문 영역으로 오인하지 않는다", () => {
  const booth = adapterForLocation(new URL("https://booth.pm/ko/items/123"));
  const selector = exclusionSelector(booth);
  assert.doesNotMatch(selector, /\[class\*='order'\]/);
  assert.match(selector, /form\[action\*='order'\]/);
});

test("BOOTH 판매자 페이지의 span 기반 데스크톱 상품 설명을 번역한다", () => {
  const booth = adapterForLocation(new URL("https://shop.booth.pm/items/123"));

  assert.ok(booth.blocks.includes("[class~='description'] > span.autolink"));
});

test("BOOTH 판매자 소개의 긴 단일 텍스트를 번역한다", () => {
  const booth = adapterForLocation(new URL("https://shop.booth.pm/"));

  assert.ok(booth.blocks.includes(".booth-description > .autolink > div"));
});

test("BOOTH 공개 안내 페이지의 비시맨틱 텍스트 블록을 범용으로 번역한다", () => {
  for (const url of [
    "https://booth.pm/about",
    "https://booth.pm/customer_guide",
    "https://booth.pm/guide",
  ]) {
    const booth = adapterForLocation(new URL(url));
    assert.equal(booth.id, "booth");
    assert.ok(booth.blocks.some((selector) => (
      selector.startsWith("main :is(div,section,span,a,b,")
      && selector.includes(":not(:has(*:not(br)))")
    )));
  }
});

test("BOOTH 공개 안내의 br 줄바꿈 문단을 하나의 번역 블록으로 포함한다", () => {
  const booth = adapterForLocation(new URL("https://booth.pm/about"));
  const selector = booth.blocks.find((value) => value.includes(":not(:has(*:not(br)))"));

  assert.ok(selector);
  assert.doesNotMatch(selector, /:not\(:has\(\*\)\)/);
});

test("BOOTH 공개 안내 내비게이션만 공통 nav 제외를 안전하게 우회한다", () => {
  const booth = adapterForLocation(new URL("https://booth.pm/guide"));
  const publicGuideSelector =
    "nav.js-accordion-content a.no-underline[href^='https://booth.pm/']";

  assert.ok(booth.blocks.includes(publicGuideSelector));
  assert.ok(booth.exclusionBypassBlocks.includes(publicGuideSelector));
});

test("BOOTH 상단 약관 안내와 공개 공지 링크를 번역한다", () => {
  const booth = adapterForLocation(new URL("https://booth.pm/ko"));
  const bannerText = ".js-agreement-banner .text-white.text-14.font-bold";
  const bannerLink = ".js-agreement-banner a[href^='https://booth.pm/']";
  const announcementLink = ".booth-message > a[href^='https://booth.pm/announcements/']";
  const moreAnnouncements = "details.booth-messages > summary";

  assert.ok(booth.blocks.includes(bannerText));
  assert.ok(booth.blocks.includes(bannerLink));
  assert.ok(booth.blocks.includes(announcementLink));
  assert.ok(booth.blocks.includes(moreAnnouncements));
  assert.ok(booth.exclusionBypassBlocks.includes(bannerText));
  assert.ok(booth.exclusionBypassBlocks.includes(bannerLink));
  assert.ok(!booth.blocks.includes(".js-agreement-banner button"));
});

test("BOOTH 다운로드 파일명은 버전과 확장자를 유지하며 번역 대상으로 포함한다", () => {
  const booth = adapterForLocation(new URL("https://booth.pm/ko/items/123"));
  const selector = exclusionSelector(booth);

  assert.ok(booth.blocks.includes("a[href*='/downloadables/'] [class~='text-ellipsis']"));
  assert.ok(booth.blocks.includes(".cart-button-wrap [class~='text-left'][class~='mb-8']"));
  assert.doesNotMatch(selector, /\[class\*='cart'\]/);
  assert.match(selector, /form\[action\*='cart'\]/);
});

test("manifest 공개 키가 Native Messaging 허용 ID를 안정적으로 만든다", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const publicKey = Buffer.from(manifest.key, "base64");
  const hash = crypto.createHash("sha256").update(publicKey).digest().subarray(0, 16);
  const extensionId = [...hash]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
    .join("");
  assert.equal(extensionId, "kpagdcdgomdlnnphakjakpodmgnhgaia");
  assert.ok(manifest.permissions.includes("nativeMessaging"));
  assert.deepEqual(manifest.content_scripts[0].matches, ["http://*/*", "https://*/*"]);
});
