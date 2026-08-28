import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { READING_UI_HTML, READING_UI_EXPECTED, ACCOUNT_UI_HTML, ACCOUNT_UI_EXPECTED } from "./fixtures/reading-policy.mjs";
import "../site-adapters.js";
import "../content-helpers.js";
import "../dom-policy.js";

const {
  adapterForLocation, exclusionSelector, protectedExclusionSelector,
} = globalThis.NudeNyangSiteAdapters;
const { createPublicDomPolicy } = globalThis.NudeNyangDomPolicy;

function collectPublicTexts(document, adapter) {
  const policy = createPublicDomPolicy(document, adapter);
  const nodes = [];
  policy.collectBlocks(document, (block) => {
    const eligible = policy.eligibility(block);
    const walker = document.createTreeWalker(block, document.defaultView.NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (eligible(node) && node.nodeValue.trim()) nodes.push(node);
    }
  });
  assert.equal(new Set(nodes).size, nodes.length, "each text node must belong to exactly one collected block");
  return nodes.map((node) => node.nodeValue.trim()).sort();
}

test("읽기 정책: 공개 문서의 경로 단어와 일반 앵커는 계정 화면으로 오인하지 않는다", () => {
  for (const path of ["/help/settings", "/news/orders", "/guide#settings", "/reference/account"]) {
    const adapter = adapterForLocation(new URL(`https://example.test${path}`));
    assert.equal(adapter?.id, "web", path);
    assert.notEqual(adapter.staticUiOnly, true, path);
  }
});

test("읽기 정책: 공통 메뉴·버튼·연결된 설명·쿠키 문구와 가격 설명을 번역한다", () => {
  const url = "https://example.test/catalogue";
  const dom = new JSDOM(READING_UI_HTML, { url });
  try {
    assert.deepEqual(collectPublicTexts(dom.window.document, adapterForLocation(new URL(url))), [...READING_UI_EXPECTED].sort());
  } finally { dom.window.close(); }
});

test("읽기 정책: 계정·주문 화면은 정적 UI만 허용하고 데이터 값은 읽지 않는다", () => {
  for (const path of ["/settings", "/account", "/checkout", "/dashboard", "/ko/orders", "/app/settings", "/shop/account", "/app#/settings"]) {
    const url = `https://example.test${path}`;
    const adapter = adapterForLocation(new URL(url));
    assert.equal(adapter?.staticUiOnly, true, path);
    const dom = new JSDOM(ACCOUNT_UI_HTML, { url });
    try {
      assert.deepEqual(collectPublicTexts(dom.window.document, adapter), [...ACCOUNT_UI_EXPECTED].sort(), path);
    } finally { dom.window.close(); }
  }
});

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

test("DLsite 서클 리포트는 콘텐츠 클래스와 태그가 바뀌어도 공개 본문만 한 번 수집한다", () => {
  const url = "https://www.dlsite.com/maniax/circle/report/=/report/202607202";
  const legacy = `<article class="circle_report">
    <div class="work_name">作品紹介</div><div class="catchphrase">新しい物語</div>
    <div class="report_info"><span class="label">発売日</span><span class="content">初夏発売</span></div>
    <h2 class="report_title">制作について</h2>
    <section class="report_section"><div class="content">説明文<strong>強調部分</strong>続きの説明
      <code>protected_code()</code><span translate="no">保護された原文</span>
      <span class="price">100円</span><span hidden>非表示の説明</span>
    </div></section><a class="btn_report type_cart" href="/cart/">作品を購入する</a>
    <form><p>未送信の入力</p><input value="private input"></form>
    <div contenteditable="true">編集中の文章</div><nav><p>保護するナビゲーション</p></nav>
  </article>`;
  const renamed = legacy.replace(/ class="(?:circle_report|work_name|catchphrase|report_info|label|content|report_title|report_section|btn_report type_cart)"/gu, "")
    .replace("<article>", "<section>").replace("</article>", "</section>");
  const expected = ["作品紹介", "新しい物語", "発売日", "初夏発売", "制作について", "説明文", "強調部分", "続きの説明", "作品を購入する"].sort();
  for (const location of [url, "https://example.org/public/article/"]) {
    const adapter = adapterForLocation(new URL(location));
    for (const html of [legacy, renamed]) {
      const dom = new JSDOM(html, { url: location });
      try {
        assert.deepEqual(collectPublicTexts(dom.window.document, adapter), expected, location);
      } finally {
        dom.window.close();
      }
    }
  }
  assert.equal(
    adapterForLocation(new URL("https://www.dlsite.com/maniax/work/=/product_id/RJ01669233.html")).id,
    "dlsite",
  );
});

test("서클 리포트도 일반 DLsite의 계정·포인트 수치 보호를 유지한다", () => {
  const html = `<div id="header"><div class="login_information"><span class="number">1200 ポイント</span></div></div>
    <article class="circle_report"><div class="work_name">公開商品紹介</div></article>`;
  for (const url of [
    "https://www.dlsite.com/home/work/=/product_id/123.html",
    "https://www.dlsite.com/home/circle/report/=/report/123",
  ]) {
    const dom = new JSDOM(html, { url });
    try {
      assert.deepEqual(collectPublicTexts(dom.window.document, adapterForLocation(new URL(url))), ["公開商品紹介"], url);
    } finally {
      dom.window.close();
    }
  }
});

test("서클 리포트 경로도 계정·장바구니·로그인·결제의 정적 UI 경계를 우회하지 않는다", () => {
  const base = "https://www.dlsite.com/home/circle/report/=/report/123";
  assert.equal(adapterForLocation(new URL(base)).id, "dlsite-report");
  for (const suffix of ["/account", "/cart", "/login", "/%61ccount/", "#/payment"]) {
    assert.equal(adapterForLocation(new URL(base + suffix)).staticUiOnly, true, suffix);
  }
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
    adapterForLocation(new URL("https://www.dlsite.com/maniax/mypage")).staticUiOnly,
    true,
  );
  assert.equal(
    adapterForLocation(new URL("https://www.dlsite.com/maniax/cart")).staticUiOnly,
    true,
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

test("공개 문서는 특정 본문 ID 없이 레이아웃 텍스트 보완 수집을 활성화한다", () => {
  const welcome = adapterForLocation(new URL("https://www.dlsite.com/home/welcome"));
  const generic = adapterForLocation(new URL("https://example.com/landing"));

  assert.equal(welcome.id, "dlsite");
  for (const adapter of [welcome, generic]) {
    assert.equal(adapter.collectLayoutText, true);
    assert.ok(adapter.blocks.includes("body p"));
    assert.ok(adapter.blocks.includes("body table td"));
    assert.ok(adapter.blocks.every((selector) => !selector.includes(":has(")));
  }
});

test("명시적 본문 영역만 읽는 사이트는 레이아웃 보완 수집을 자동 활성화하지 않는다", () => {
  for (const url of [
    "https://github.com/NudeNyang/project",
    "https://x.com/home",
    "https://www.google.com/search?q=translator",
    "https://www.youtube.com/watch?v=abc",
  ]) {
    assert.notEqual(adapterForLocation(new URL(url)).collectLayoutText, true, url);
  }
});

test("Takara Tomy의 공개 본사·상품·카드 검색과 상세 창을 같은 어댑터로 처리한다", () => {
  for (const url of [
    "https://www.takaratomy.co.jp/",
    "https://takaratomy.co.jp/",
    "http://dm.takaratomy.co.jp/card/",
    "https://dm.takaratomy.co.jp/card/detail/?id=dm26ex3-SEC007CHO",
    "https://dm.takaratomy.co.jp/product/dm26ex3/",
    "https://dm.takaratomy.co.jp/card/?v=%7B%22pagenum%22%3A%224%22%7D",
  ]) {
    const adapter = adapterForLocation(new URL(url));
    assert.equal(adapter.id, "takaratomy", url);
    assert.equal(adapter.collectLayoutText, true, url);
    assert.ok(adapter.blocks.includes("body table th"), url);
    assert.ok(adapter.blocks.includes("body table td"), url);
    assert.ok(adapter.blocks.includes("body li"), url);
  }
  for (const url of [
    "https://other.takaratomy.co.jp/",
    "https://dm.takaratomy.co.jp.example.com/",
  ]) {
    assert.notEqual(adapterForLocation(new URL(url)).id, "takaratomy", url);
  }
});

test("Takara Tomy의 공개 메뉴·검색 설명·하단 안내만 정적 UI 수집 대상으로 등록한다", () => {
  const adapter = adapterForLocation(new URL("https://dm.takaratomy.co.jp/card/"));
  const dom = new JSDOM(`
    <header class="l-header">
      <a id="header-link" href="/product/">商品情報</a>
      <button id="header-button">検索</button>
      <label id="header-label">キーワード<input value="個人の検索語"></label>
    </header>
    <nav class="ul_Navi01">
      <a id="navigation-link" href="/card/">カード検索</a>
      <div id="navigation-toggle" class="naviBtn">ルール</div>
      <div id="navigation-title" class="tit">商品情報</div>
    </nav>
    <form id="search_cond">
      <p id="search-description">検索条件</p>
      <label id="search-label">カード名<input value="入力したカード名"></label>
      <button id="search-button">検索する</button>
      <select><option>選択した値</option></select>
    </form>
    <form id="SS_searchForm">
      <label id="site-search-label">サイト内検索</label>
      <button id="site-search-button">検索</button>
    </form>
    <footer class="l-footer">
      <a id="footer-link" href="/company/">会社情報</a>
      <p id="footer-paragraph">ご利用について</p>
      <h2 id="footer-heading">お問い合わせ</h2>
    </footer>
    <form id="private-form"><label>メール<input value="private@example.com"></label></form>
    <nav><a href="/other/">無関係なメニュー</a></nav>
  `);
  try {
    const publicSelector = adapter.publicUiBlocks.join(",");
    const selectedElements = [...dom.window.document.querySelectorAll(publicSelector)];
    const actual = selectedElements.map((element) => element.id);
    assert.deepEqual(actual.sort(), [
      "header-link", "header-button", "header-label",
      "navigation-link", "navigation-toggle", "navigation-title",
      "search-description", "search-label", "search-button",
      "site-search-label", "site-search-button",
      "footer-link", "footer-paragraph", "footer-heading",
    ].sort());
    for (const selector of adapter.publicUiBlocks) {
      assert.ok(adapter.blocks.includes(selector), selector);
    }
  } finally {
    dom.window.close();
  }
});

test("Takara Tomy의 공개 검색 폼 예외는 입력값·임의 폼·보호 텍스트를 허용하지 않는다", () => {
  const adapter = adapterForLocation(new URL("https://dm.takaratomy.co.jp/card/"));
  const dom = new JSDOM(`
    <form id="search_cond">
      <label><span id="public-label">カード名</span><input id="keyword" value="入力内容"></label>
      <button><span id="public-button">検索する</span></button>
      <select id="selection"><option id="selected-value">選択値</option></select>
      <p hidden><span id="hidden-text">非表示</span></p>
      <p contenteditable><span id="editor-text">編集中</span></p>
      <p class="price"><span id="price-text">100円</span></p>
    </form>
    <form id="SS_searchForm"><button>検索</button></form>
    <form id="private-form"><label>メール<input value="private@example.com"></label></form>
  `);
  try {
    const document = dom.window.document;
    const publicFormSelector = adapter.publicForms.join(",");
    assert.ok(document.getElementById("search_cond").matches(publicFormSelector));
    assert.ok(document.getElementById("SS_searchForm").matches(publicFormSelector));
    assert.equal(document.getElementById("private-form").matches(publicFormSelector), false);
    for (const id of ["public-label", "public-button"]) {
      const element = document.getElementById(id);
      assert.ok(element.closest(adapter.publicUiBlocks.join(",")), id);
      assert.ok(element.closest(exclusionSelector(adapter)), id);
      assert.equal(element.closest(protectedExclusionSelector(adapter)), null, id);
    }
    for (const id of ["keyword", "selection", "selected-value", "hidden-text", "editor-text"]) {
      assert.ok(document.getElementById(id).closest(protectedExclusionSelector(adapter)), id);
    }
    assert.equal(createPublicDomPolicy(document, adapter).allowsText(document.getElementById("price-text").firstChild), false);
  } finally {
    dom.window.close();
  }
});

test("Takara Tomy 하단 사이트맵의 접힘·펼침 제목만 공개 버튼으로 등록한다", () => {
  const adapter = adapterForLocation(new URL("https://dm.takaratomy.co.jp/product/dm26ex2/"));
  const dom = new JSDOM(`<footer class="l-footer"><ul>
    <li class="l-footer-sitemap__item" data-group="accordion">
      <button id="collapsed" class="l-footer-sitemap__trigger" data-trigger="accordion"
        aria-expanded="false" aria-controls="first-panel">商品情報</button>
    </li>
    <li class="l-footer-sitemap__item" data-group="accordion">
      <button id="expanded" class="l-footer-sitemap__trigger" data-trigger="accordion"
        aria-expanded="true" aria-controls="second-panel">会社情報</button>
    </li></ul>
    <button id="other-button" aria-expanded="false" aria-controls="other-panel">別の操作</button>
  </footer>
  <button id="outside-footer" class="l-footer-sitemap__trigger">別の場所</button>`);
  try {
    const selected = [...dom.window.document.querySelectorAll(adapter.publicUiBlocks.join(","))];
    assert.deepEqual(selected.map((element) => element.id), ["collapsed", "expanded"]);
    for (const element of selected) {
      assert.ok(element.matches(adapter.blocks.join(",")));
      assert.ok(element.closest(exclusionSelector(adapter)));
      assert.equal(element.closest(protectedExclusionSelector(adapter)), null);
    }
  } finally {
    dom.window.close();
  }
});

test("Takara Tomy 공용 검색 탭은 탭 그룹 안의 탭 버튼만 공개 제목으로 등록한다", () => {
  const adapter = adapterForLocation(new URL("https://www.takaratomy.co.jp/"));
  const dom = new JSDOM(`<div class="c-tab-group _protrude"><div class="c-tab-buttons" role="tablist">
    <button id="search_genre" class="c-tab-button" role="tab" aria-selected="true"
      aria-controls="search_genre_content" data-tab-trigger>ジャンル<small>からさがす</small></button>
    <button id="search_age" class="c-tab-button" role="tab" aria-selected="false"
      aria-controls="search_age_content" data-tab-trigger>対象年齢<small>からさがす</small></button>
    <button id="search_like" class="c-tab-button" role="tab" aria-selected="false"
      aria-controls="search_like_content" data-tab-trigger>「好き」<small>をさがす</small></button>
    <button id="other-button" class="c-tab-button">別の操作</button>
  </div><button id="outside-tablist" class="c-tab-button" role="tab">別のタブ</button></div>
  <div class="c-tab-buttons"><button id="outside-group" class="c-tab-button" role="tab">別の場所</button></div>`);
  try {
    const selected = [...dom.window.document.querySelectorAll(adapter.publicUiBlocks.join(","))];
    assert.deepEqual(selected.map((element) => element.id), ["search_genre", "search_age", "search_like"]);
    for (const element of selected) {
      assert.ok(element.matches(adapter.blocks.join(",")));
      assert.equal(element.querySelector("small").closest(protectedExclusionSelector(adapter)), null);
    }
    assert.equal(adapterForLocation(new URL("https://www.takaratomy.co.jp/account/")).staticUiOnly, true);
    assert.equal(adapterForLocation(new URL("https://example.org/")).publicUiBlocks, undefined);
  } finally {
    dom.window.close();
  }
});

test("Takara Tomy의 민감 경로가 범용 어댑터로 우회되지 않는다", () => {
  for (const url of [
    "https://www.takaratomy.co.jp/account/",
    "https://takaratomy.co.jp/checkout/",
    "https://dm.takaratomy.co.jp/card/#/payment",
    "https://dm.takaratomy.co.jp/card/LOGIN",
    "https://dm.takaratomy.co.jp/card/%6Cogin",
    "https://dm.takaratomy.co.jp/register/",
  ]) {
    assert.equal(adapterForLocation(new URL(url)).staticUiOnly, true, url);
  }
  assert.equal(adapterForLocation(new URL("https://dm.takaratomy.co.jp/messages/123")), null);
  for (const url of [
    "https://dm.takaratomy.co.jp/card/?keyword=account",
    "https://www.takaratomy.co.jp/product/accounting/",
  ]) {
    assert.equal(adapterForLocation(new URL(url)).id, "takaratomy", url);
  }
});

test("ShoPro 공개 애니메이션 어댑터는 호스트·경로를 제한하고 수동 시작과 민감 경로 차단을 유지한다", () => {
  for (const url of [
    "https://www.shopro.co.jp/anime/",
    "https://www.shopro.co.jp/anime/duelmasters_lost/",
    "https://www.shopro.co.jp/anime/duelmasters_lost/news/",
    "https://www.shopro.co.jp/anime/another-series/",
  ]) {
    const adapter = adapterForLocation(new URL(url));
    assert.equal(adapter.id, "shopro-anime", url);
    assert.equal(adapter.manualOnly, true, url);
    assert.equal(adapter.collectLayoutText, true, url);
    for (const selector of ["body p", "body h2", "body li"]) assert.ok(adapter.blocks.includes(selector));
  }
  for (const url of [
    "https://www.shopro.co.jp/", "https://www.shopro.co.jp/company/",
    "https://www.shopro.co.jp/anime-other/", "https://shopro.co.jp/anime/",
    "https://other.shopro.co.jp/anime/", "https://www.shopro.co.jp.example.com/anime/",
  ]) assert.equal(adapterForLocation(new URL(url)).id, "web", url);
  for (const url of [
    "https://www.shopro.co.jp/anime/account/", "https://www.shopro.co.jp/anime/duelmasters_lost/login/",
    "https://www.shopro.co.jp/anime/duelmasters_lost/%6Cogin/",
    "https://www.shopro.co.jp/anime/duelmasters_lost/#/payment",
  ]) assert.equal(adapterForLocation(new URL(url)).staticUiOnly, true, url);
});

test("ShoPro는 실제 헤더 메뉴 목록 링크만 허용하고 로고·SNS·다른 메뉴를 제외한다", () => {
  const adapter = adapterForLocation(new URL("https://www.shopro.co.jp/anime/duelmasters_lost/"));
  const dom = new JSDOM(`<header><div class="headerWrap">
    <div class="header-logo"><a id="logo" href="#top"><img alt="作品名"></a></div>
    <button class="btn">別の操作</button><div class="overray"></div>
    <div class="menu"><ul><li><a id="news" href="news/">最新情報</a></li>
      <li><a id="story" href="#story">物語</a></li><li><a id="no-href">リンクなし</a></li></ul>
      <div class="sns03"><a id="social" href="https://example.org/"><img alt="SNS"></a></div>
    </div><ul class="sns02"><li><a id="other-social" href="https://example.org/">別の案内</a></li></ul>
  </div><div class="menu"><ul><li><a id="other-header" href="other/">別の場所</a></li></ul></div></header>
  <main><div class="headerWrap"><div class="menu"><ul><li><a id="outside-header" href="other/">本文</a></li></ul></div></div></main>`);
  try {
    const selected = [...dom.window.document.querySelectorAll(adapter.publicUiBlocks?.join(",") || ":not(*)")];
    assert.deepEqual(selected.map((element) => element.id), ["news", "story"]);
    for (const element of selected) {
      assert.ok(element.matches(adapter.blocks.join(",")));
      assert.equal(element.closest(protectedExclusionSelector(adapter)), null);
    }
  } finally {
    dom.window.close();
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

test("특집형 상품 페이지의 div 안내는 ID에 의존하지 않고 실제 탐색·폼 영역은 제외한다", () => {
  const url = "https://www.dlsite.com/maniax/circle/report/=/report/202607202";
  const report = adapterForLocation(new URL(url));
  const legacy = `<div id="left">
    <div class="left_module"><h3>カテゴリー一覧</h3></div><div class="list_head"><h4>作品種類</h4></div>
    <div class="list_content_text_item"><a href="/works/">全年齢作品</a></div>
    <div class="list_text_indent"><a href="/news/">新着作品</a></div>
    <div class="link_list_item"><a href="/feature/">特集案内</a></div>
  </div><div id="footer">
    <div class="floor_list_item"><a href="/category/">作品カテゴリ</a></div><span class="label">関連サービス</span>
    <div class="link_list_item"><a href="/help/">ヘルプ情報</a></div><span class="img_list_text">画像の説明</span>
    <div class="footer_sns_item"><a href="/social/">公式のお知らせ</a></div>
    <div class="recruit"><a href="/careers/">採用情報</a></div><div id="system">システム情報</div>
  </div>`;
  const renamed = legacy.replace(/ id="[^"]*"| class="[^"]*"/gu, "");
  const protectedMarkup = `<nav><p>秘密のメニュー</p></nav><header><p>秘密のヘッダー</p></header>
    <footer><p>秘密のフッター</p></footer><aside><p>秘密の補助領域</p></aside>
    <form><p>秘密のフォーム</p><input value="private input"></form><div class="price">100円</div>`;
  const expected = ["カテゴリー一覧", "作品種類", "全年齢作品", "新着作品", "特集案内", "作品カテゴリ", "関連サービス",
    "ヘルプ情報", "画像の説明", "公式のお知らせ", "採用情報", "システム情報"].sort();
  for (const html of [legacy, renamed]) {
    const dom = new JSDOM(html + protectedMarkup, { url });
    try {
      assert.deepEqual(collectPublicTexts(dom.window.document, report), expected);
    } finally {
      dom.window.close();
    }
  }
});

test("범용 어댑터는 일반 HTTP 문서를 지원하고 브라우저 내부 페이지는 건드리지 않는다", () => {
  assert.equal(adapterForLocation(new URL("http://example.com/news/today")).id, "web");
  assert.equal(adapterForLocation(new URL("https://developer.mozilla.org/docs/Web/API")).id, "web");
  assert.equal(adapterForLocation(new URL("chrome://extensions")), null);
  assert.equal(adapterForLocation(new URL("file:///C:/private/document.html")), null);
});

test("범용 어댑터는 계정·결제를 정적 UI로 제한하고 미분류 메시지는 차단한다", () => {
  for (const url of [
    "https://example.com/login",
    "https://example.com/account/settings",
    "https://example.com/cart",
    "https://example.com/checkout/payment",
    "https://example.com/#/checkout",
    "https://example.com/admin/dashboard",
  ]) {
    assert.equal(adapterForLocation(new URL(url)).staticUiOnly, true, url);
  }
  for (const path of ["messages/123", "direct/t/123"]) assert.equal(adapterForLocation(new URL(`https://example.com/${path}`)), null);
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
  assert.equal(web.collectLayoutText, true);
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

test("공개 UI 예외에서도 사이트별 보호 규칙을 제거하지 않는다", () => {
  const dom = new JSDOM(`
    <div class="blob-code"><span id="code">const secret = 1;</span></div>
    <div class="payment"><span id="payment">支払い情報</span></div>
    <div id="header"><div class="login_information"><span id="number" class="number">100</span></div></div>
    <div data-testid="UserName"><span id="username">個人名</span></div>
  `);
  try {
    for (const [url, id] of [
      ["https://github.com/NudeNyang/project", "code"],
      ["https://booth.pm/ko/items/123", "payment"],
      ["https://www.dlsite.com/maniax/", "number"],
      ["https://x.com/home", "username"],
    ]) {
      const adapter = adapterForLocation(new URL(url));
      assert.ok(dom.window.document.getElementById(id).closest(protectedExclusionSelector(adapter)), id);
    }
  } finally {
    dom.window.close();
  }
});

for (const { label, url, container, className, href } of [
  { label: "공개 UI", url: "https://www.takaratomy.co.jp/product/", container: "header", className: "l-header", href: "/product/" },
  { label: "제외 우회 읽기 범위", url: "https://www.eisys.co.jp/company/", container: "nav", className: "header_navi", href: "https://www.eisys.co.jp/company/" },
]) {
  test(`${label}의 중첩 제목은 수집 소유자를 잃지 않고 절대 보호 영역을 제외한다`, () => {
    const dom = new JSDOM(`<${container} class="${className}"><a href="${href}">
      <h2>Allowed nested heading</h2>
      <div contenteditable="true"><h2>Private editable heading</h2></div>
      <h2 translate="no">Protected original heading</h2><h2 hidden>Hidden heading</h2>
      <h2><code>protected_code()</code><span class="price">100円</span><input value="private input"></h2>
      <form><h2>Private form heading</h2></form>
      </a><h2>Unapproved surrounding heading</h2></${container}>`, { url });
    try {
      assert.deepEqual(collectPublicTexts(dom.window.document, adapterForLocation(new URL(url))), ["Allowed nested heading"]);
    } finally {
      dom.window.close();
    }
  });
}

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
  const semanticArticleCard = "article [role='link'] [dir='auto']";
  const articleTitle =
    "[data-testid='twitterArticleReadView'] [data-testid='twitter-article-title']";
  const articleParagraph =
    "[data-testid='twitterArticleReadView'] section[data-block='true']";

  assert.ok(x.blocks.includes(articleCard));
  assert.ok(x.blocks.includes(semanticArticleCard));
  assert.ok(x.blocks.includes(articleTitle));
  assert.ok(x.blocks.includes(articleParagraph));
  assert.ok(x.exclusionBypassBlocks.includes(articleCard));
  assert.ok(x.exclusionBypassBlocks.includes(semanticArticleCard));
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

test("BOOTH의 span·혼합 인라인·중첩 문단은 클래스가 바뀌어도 중복 없이 수집한다", () => {
  const url = "https://shop.booth.pm/items/123";
  const booth = adapterForLocation(new URL(url));
  const legacy = `<div class="description"><span class="autolink">商品説明<strong>強調内容</strong>
    <a href="/detail/">詳しい案内</a><a href="https://example.org/">https://example.org/</a></span>
    <p>独立した段落</p><ul><li>一覧の説明<p>一覧内の段落</p></li></ul></div>
    <div class="public-notice"><p>公開のお知らせ</p></div>`;
  const protectedMarkup = `<div class="price">100円</div><form><p>秘密の入力</p></form>
    <div contenteditable="true">編集中の文章</div><nav><p>秘密のメニュー</p></nav>`;
  for (const html of [legacy, legacy.replace(/ class="[^"]*"/gu, "")]) {
    const dom = new JSDOM(html + protectedMarkup, { url });
    try {
      assert.deepEqual(collectPublicTexts(dom.window.document, booth), [
        "商品説明", "強調内容", "詳しい案内", "独立した段落", "一覧の説明", "一覧内の段落", "公開のお知らせ",
      ].sort());
    } finally {
      dom.window.close();
    }
  }
});

test("BOOTH 판매자 소개의 긴 단일 텍스트를 번역한다", () => {
  const url = "https://shop.booth.pm/";
  const booth = adapterForLocation(new URL(url));
  const original = "長い紹介文です。".repeat(600);
  const legacy = `<div class="booth-description"><span class="autolink"><div>${original}</div></span></div>`;
  for (const html of [legacy, `<section><div><span>${original}</span></div></section>`]) {
    const dom = new JSDOM(html, { url });
    try {
      assert.deepEqual(collectPublicTexts(dom.window.document, booth), [original]);
    } finally {
      dom.window.close();
    }
  }
});

test("BOOTH 공개 안내 페이지의 비시맨틱 텍스트 블록을 범용으로 번역한다", () => {
  for (const url of [
    "https://booth.pm/about",
    "https://booth.pm/customer_guide",
    "https://booth.pm/guide",
  ]) {
    const booth = adapterForLocation(new URL(url));
    assert.equal(booth.id, "booth");
    assert.equal(booth.collectLayoutText, true);
    assert.ok(booth.blocks.includes("body p"));
    assert.ok(booth.blocks.every((selector) => !selector.includes(":has(")));
  }
});

test("레이아웃 보완 수집은 숨김·입력·편집기·명시적 번역 거부를 계속 보호한다", () => {
  const dom = new JSDOM(`
    <input id="input"><textarea id="textarea">入力内容</textarea>
    <div role="textbox"><span id="textbox">入力内容</span></div>
    <div hidden><span id="hidden">非表示</span></div>
    <div inert><span id="inert">操作不可</span></div>
    <div aria-hidden="true"><span id="aria-hidden">非表示</span></div>
    <div contenteditable><span id="editor">編集中</span></div>
    <div translate="no"><span id="translate-no">そのまま</span></div>
    <div class="notranslate"><span id="notranslate">そのまま</span></div>
    <div data-nudenyang-ignore><span id="ignored">そのまま</span></div>
    <div class="price"><span id="price">100円</span></div>
    <div class="cookie-banner"><span id="cookie">同意</span></div>
    <pre><span id="code">code</span></pre>
    <div><span id="public">公開本文</span><br>続きの本文</div>
  `);
  try {
    for (const url of [
      "https://booth.pm/about",
      "https://example.com/articles/hello",
      "https://www.dlsite.com/home/welcome",
      "https://www.eisys.co.jp/",
      "https://www.takaratomy.co.jp/",
    ]) {
      const adapter = adapterForLocation(new URL(url));
      assert.equal(adapter.collectLayoutText, true, url);
      const selector = protectedExclusionSelector(adapter);
      for (const id of [
        "input", "textarea", "textbox", "hidden", "inert", "aria-hidden", "editor",
        "translate-no", "notranslate", "ignored", "code",
      ]) {
        assert.ok(dom.window.document.getElementById(id).closest(selector), `${url}: ${id}`);
      }
      assert.equal(dom.window.document.getElementById("public").closest(selector), null, url);
      const policy = createPublicDomPolicy(dom.window.document, adapter);
      assert.equal(policy.allowsText(dom.window.document.getElementById("price").firstChild), false);
      assert.equal(policy.allowsText(dom.window.document.getElementById("cookie").firstChild), true);
    }
  } finally {
    dom.window.close();
  }
});

test("BOOTH 공개 안내 내비게이션만 공통 nav 제외를 안전하게 우회한다", () => {
  const booth = adapterForLocation(new URL("https://booth.pm/guide"));
  const publicGuideSelector =
    "nav.js-accordion-content a.no-underline[href^='https://booth.pm/']";

  assert.ok(booth.blocks.includes(publicGuideSelector));
  assert.ok(booth.exclusionBypassBlocks.includes(publicGuideSelector));
});

test("BOOTH 상단 약관 안내·공지·일반 summary는 수집하고 동의 버튼은 제외한다", () => {
  const url = "https://booth.pm/ko";
  const booth = adapterForLocation(new URL(url));
  const dom = new JSDOM(`<div class="js-agreement-banner" role="alert">
    <span class="text-white text-14 font-bold">利用規約のお知らせ</span>
    <a href="https://booth.pm/terms/">規約の詳細</a><button>同意する</button>
    </div><div class="booth-message"><a href="https://booth.pm/announcements/one">公開のお知らせ</a></div>
    <details class="booth-messages" open><summary>さらに表示</summary>
      <div class="booth-message"><a href="https://booth.pm/announcements/two">追加のお知らせ</a></div>
    </details><details open><summary>一般の見出し</summary><p>一般の説明</p></details>`, { url });
  try {
    assert.deepEqual(collectPublicTexts(dom.window.document, booth), [
      "利用規約のお知らせ", "規約の詳細", "公開のお知らせ", "さらに表示", "追加のお知らせ", "一般の見出し", "一般の説明",
    ].sort());
  } finally {
    dom.window.close();
  }
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
