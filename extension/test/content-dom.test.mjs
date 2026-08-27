import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const sources = ["site-adapters.js", "content-helpers.js", "content.js"].map((file) => (
  fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
));
const FRAME_URL = "https://www.youtube-nocookie.com/embed/video123?rel=0";

function embedRequest(action, extra = {}) {
  return { type: "nudenyang-embed-parent-request", action, frameId: 2,
    frameUrl: FRAME_URL, documentToken: "document_123", ...extra };
}

async function waitFor(check, message, timeout = 4000) {
  const until = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > until) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

function page(t, html, options = {}) {
  const dom = new JSDOM(html, {
    url: options.url ?? "https://dm.takaratomy.co.jp/product/dm26ex3/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const observers = new Set();
  const MutationObserver = w.MutationObserver;
  w.MutationObserver = class extends MutationObserver {
    constructor(callback) { super(callback); observers.add(this); }
  };
  t.after(() => {
    for (const observer of observers) observer.disconnect();
    w.close();
  });
  const listeners = new Set();
  const requests = [];
  const runtimeMessages = [];
  const savedStates = [];
  let releaseStatus;
  let releaseTranslation;
  const appStatus = {
    type: "status", translator: options.translator ?? "hymt_1_8b", targetLanguage: "KO",
    webSettings: { enabled: true, processingMode: "responsive", ...options.settings },
  };
  w.console.info = () => {};
  w.HTMLElement.prototype.getBoundingClientRect = function rect() {
    const hidden = this.closest("[hidden],[aria-hidden='true']")
      || w.getComputedStyle(this).display === "none";
    const top = this.closest("[data-offscreen]") ? 5000 : 10;
    return { top, bottom: top + (hidden ? 0 : 30), left: 10, right: 210,
      width: hidden ? 0 : 200, height: hidden ? 0 : 30 };
  };
  w.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.active = true; }
    observe(target) {
      w.queueMicrotask(() => {
        if (this.active) this.callback([{
          target, isIntersecting: target.getBoundingClientRect().height > 0
            && target.getBoundingClientRect().top < 1000,
        }]);
      });
    }
    disconnect() { this.active = false; }
  };
  w.chrome = {
    storage: { local: { get(_defaults, callback) { callback({ enabled: true }); } } },
    runtime: {
      id: "test-extension", lastError: null,
      getManifest() { return { version: "0.7.4" }; },
      onMessage: {
        addListener(listener) { listeners.add(listener); },
        removeListener(listener) { listeners.delete(listener); },
      },
      sendMessage(message, callback = () => {}) {
        runtimeMessages.push(message);
        if (message.type === "nudenyang-tab-enabled-get") {
          callback({ enabled: options.tabEnabled ?? null });
        } else if (message.type === "nudenyang-tab-enabled-set") {
          savedStates.push(message.enabled);
          callback({ enabled: message.enabled });
        } else if (message.type === "nudenyang-native-request") {
          if (message.request.type === "status") {
            if (options.deferStatus) releaseStatus = () => callback(appStatus);
            else callback(appStatus);
          } else if (message.request.type === "translate") {
            requests.push(message.request);
            const reply = () => callback({ type: "translationResult", translator: appStatus.translator,
              ...(options.responseSettings ? { webSettings: options.responseSettings } : {}),
              items: message.request.items.map((item) => ({ id: item.id, text: `번역(${item.text})` })) });
            if (options.deferTranslation) releaseTranslation = reply;
            else callback && w.queueMicrotask(reply);
          }
        } else callback({ ok: true });
      },
    },
  };
  function message(value, sender = { id: "test-extension" }) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No response: ${value.type}`)), 4000);
      const reply = (response) => { clearTimeout(timer); resolve(response); };
      for (const listener of listeners) listener(value, sender, reply);
    });
  }
  for (const source of sources) w.eval(source);
  return {
    w, requests, savedStates, message, listeners, runtimeMessages,
    releaseStatus: () => releaseStatus?.(),
    releaseTranslation: () => releaseTranslation?.(),
    reinject: () => sources.forEach((source) => w.eval(source)),
    sent: () => requests.flatMap((request) => request.items.map((item) => item.text)),
  };
}

test("상품 설명은 임의의 본문 ID와 혼합 인라인 구조에서도 빠짐없이 한 번 수집한다", async (t) => {
  const p = page(t, `<section id="mainContent">
    <div class="point3Txt">商品を紹介します<br><br>便利な<strong>新しい機能</strong>です。</div>
    <div class="card-specs_newTxt">発売日について<hr>詳しい説明です。<a href="/product/">製品情報</a></div>
    <p>本文の<strong>強調した言葉</strong>です。</p>
    <div><span><b>別の案内文</b></span></div>
    <div>見出し以外の文章<p>独立した段落</p>段落の後の文章</div>
  </section>`);
  await p.message({ type: "nudenyang-ready" });
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  await waitFor(() => p.sent().includes("別の案内文"), "nested public copy should translate");
  for (const text of ["商品を紹介します", "便利な", "新しい機能", "です。", "発売日について",
    "詳しい説明です。", "製品情報", "本文の", "強調した言葉", "別の案内文",
    "見出し以外の文章", "独立した段落", "段落の後の文章"]) {
    assert.ok(p.sent().includes(text), `missing: ${text}`);
  }
  assert.equal(p.sent().filter((text) => text === "商品を紹介します").length, 1);
  assert.equal(p.sent().filter((text) => text === "別の案内文").length, 1);
  assert.equal(p.w.document.querySelector("a").getAttribute("href"), "/product/");
});

test("공개 검색 조건과 탐색 문구만 번역하고 값·개인 입력·코드는 보존한다", async (t) => {
  const p = page(t, `<header class="l-header"><a href="/company/">会社情報</a>
    <button type="button"><span>検索</span></button></header>
    <nav><ul class="ul_Navi01"><li><span class="naviBtn accBtn01">はじめての方へ</span></li></ul></nav>
    <form id="search_cond"><p class="point">フリーワード検索</p>
      <input type="text" name="keyword" value="秘密の検索語">
      <input id="field1" type="checkbox" name="keyword_type[]" value="card_name">
      <label for="field1">カード名</label><button type="button">リセット</button>
      <label>種族<input value="private-input"></label>
    </form>
    <footer class="l-footer"><a href="/support/">お問い合わせ</a></footer>
    <form id="private-form"><p>秘密の内容</p><input value="private"></form>
    <pre><code>private_code();</code></pre><div contenteditable="true">編集中の内容</div>
    <p hidden>秘密の非表示文</p>`);
  await p.message({ type: "nudenyang-ready" });
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  await waitFor(() => p.sent().includes("カード名"), "public search labels should translate");
  for (const text of ["会社情報", "検索", "はじめての方へ", "フリーワード検索", "リセット", "種族", "お問い合わせ"]) {
    assert.ok(p.sent().includes(text), `missing: ${text}`);
  }
  assert.ok(!p.sent().some((text) => /秘密|private|編集中/.test(text)));
  assert.equal(p.w.document.querySelector("[name=keyword]").value, "秘密の検索語");
  assert.equal(p.w.document.querySelector("#field1").value, "card_name");
});

test("메뉴가 표시된 뒤 속성만 바뀌어도 재수집하고 다시 가린 문구는 전송하지 않는다", async (t) => {
  const p = page(t, `<header class="l-header">
    <div id="search-dialog" aria-hidden="true"><a href="/product/">展開したメニュー</a></div>
  </header>`);
  await p.message({ type: "nudenyang-ready" });
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  assert.equal(p.sent().length, 0);
  p.w.document.querySelector("#search-dialog").setAttribute("aria-hidden", "false");
  await waitFor(() => p.sent().includes("展開したメニュー"), "shown menu should be rediscovered");
});

test("하단 사이트맵의 모든 펼침 제목은 접힌 상태에서도 번역하고 버튼 구조를 보존한다", async (t) => {
  const titles = ["商品情報", "シーズンサイト", "ブランドからさがす", "ジャンルからさがす",
    "対象年齢からさがす", "50音順からさがす", "会社情報", "投資家情報", "お客様相談室"];
  const p = page(t, `<footer class="l-footer"><ul>${titles.map((title, index) => `
    <li class="l-footer-sitemap__item" data-group="accordion">
      <button class="l-footer-sitemap__trigger" id="footer-tab-${index}" aria-expanded="false"
        aria-controls="footer-panel-${index}" data-trigger="accordion">${title}</button>
      <div class="l-footer-sitemap__lower" aria-hidden="true" role="region"
        id="footer-panel-${index}" aria-labelledby="footer-tab-${index}">
        <ul><li><a class="l-footer-sitemap__lower-link" href="/products/${index}/">${title}の一覧</a></li></ul>
      </div>
    </li>`).join("")}</ul><a href="/company/">企業のご案内</a></footer>`, {
    url: "https://dm.takaratomy.co.jp/product/dm26ex2/",
  });
  const buttons = [...p.w.document.querySelectorAll("button")];
  const textNodes = buttons.map((button) => button.firstChild);
  const attributes = buttons.map((button) => [...button.attributes].map(({ name, value }) => [name, value]));
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => buttons.every((button, index) => button.textContent === `번역(${titles[index]})`),
    "all collapsed sitemap headings should translate");
  for (let index = 0; index < buttons.length; index += 1) {
    assert.equal(p.w.document.getElementById(`footer-tab-${index}`), buttons[index]);
    assert.equal(buttons[index].firstChild, textNodes[index]);
    assert.deepEqual([...buttons[index].attributes].map(({ name, value }) => [name, value]), attributes[index]);
    assert.equal(p.sent().filter((text) => text === titles[index]).length, 1);
    assert.equal(p.sent().includes(`${titles[index]}の一覧`), false);
  }
});

test("하단 펼침 버튼의 클릭·접힘 속성과 펼친 링크는 번역 및 OFF·ON 뒤에도 유지한다", async (t) => {
  const p = page(t, `<footer class="l-footer"><ul><li class="l-footer-sitemap__item" data-group="accordion">
    <button class="l-footer-sitemap__trigger" id="footer_tab_shouhin" aria-expanded="false"
      aria-controls="footer_panel_shouhin" data-trigger="accordion"><span>商品情報</span></button>
    <div class="l-footer-sitemap__lower" aria-hidden="true" role="region" id="footer_panel_shouhin"
      aria-labelledby="footer_tab_shouhin"><ul><li>
      <a class="l-footer-sitemap__lower-link" href="https://www.takaratomy.co.jp/products/">商品情報トップ</a>
    </li></ul></div>
  </li></ul></footer>`);
  const button = p.w.document.querySelector("button");
  const label = button.querySelector("span");
  const panel = p.w.document.getElementById("footer_panel_shouhin");
  const link = panel.querySelector("a");
  let clicks = 0;
  button.addEventListener("click", () => {
    clicks += 1;
    const expanded = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(expanded));
    panel.setAttribute("aria-hidden", String(!expanded));
  });
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => label.textContent === "번역(商品情報)", "sitemap button label should translate");
  assert.equal(link.textContent, "商品情報トップ");
  assert.equal(p.sent().includes("商品情報トップ"), false);
  button.click();
  await waitFor(() => link.textContent === "번역(商品情報トップ)", "newly expanded footer link should translate");
  assert.equal(clicks, 1);
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(panel.getAttribute("aria-hidden"), "false");
  assert.equal(button.getAttribute("aria-controls"), panel.id);
  assert.equal(panel.getAttribute("aria-labelledby"), button.id);
  assert.equal(link.href, "https://www.takaratomy.co.jp/products/");
  const before = p.requests.length;

  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  assert.equal(label.textContent, "商品情報");
  assert.equal(link.textContent, "商品情報トップ");
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(panel.getAttribute("aria-hidden"), "false");
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  assert.equal(label.textContent, "번역(商品情報)");
  assert.equal(link.textContent, "번역(商品情報トップ)");
  assert.equal(button.querySelector("span"), label);
  assert.equal(p.w.document.getElementById(button.id), button);
  assert.equal(p.requests.length, before);

  button.click();
  assert.equal(clicks, 2);
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(panel.getAttribute("aria-hidden"), "true");
  link.firstChild.nodeValue = "新しい商品案内";
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(p.requests.length, before);
  button.click();
  await waitFor(() => link.textContent === "번역(新しい商品案内)", "reopened link should translate its new source text");
  assert.equal(clicks, 3);
  assert.equal(p.sent().filter((text) => text === "商品情報").length, 1);
});

test("하단 펼침 제목 예외도 계정 폼·입력값·숨김·보호 문구와 임의 버튼을 제외한다", async (t) => {
  const p = page(t, `<footer class="l-footer">
    <button class="l-footer-sitemap__trigger"><span id="public-footer-title">公開の商品案内</span>
      <span hidden>秘密の非表示</span><span style="display:none">秘密の補足</span>
      <span translate="no">秘密の原文</span><span class="price">秘密の価格</span>
    </button>
    <button class="l-footer-sitemap__trigger" hidden>秘密の隠したボタン</button>
    <button class="l-footer-sitemap__trigger" aria-hidden="true">秘密の非表示ボタン</button>
    <button class="l-footer-sitemap__trigger" style="visibility:hidden">秘密の不可視ボタン</button>
    <form id="private-account"><button class="l-footer-sitemap__trigger">秘密のアカウント</button>
      <input id="private-value" value="秘密の入力値"><input id="private-check" type="checkbox" checked>
      <select><option selected>秘密の選択値</option></select>
    </form>
    <div contenteditable="true"><button class="l-footer-sitemap__trigger">秘密の編集中</button></div>
    <div data-nudenyang-ignore><button class="l-footer-sitemap__trigger">秘密の保護領域</button></div>
    <button aria-expanded="false" aria-controls="other-panel">秘密の別操作</button>
  </footer><button class="l-footer-sitemap__trigger">秘密の本文外操作</button>`);
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.w.document.getElementById("public-footer-title").textContent === "번역(公開の商品案内)",
    "only the visible public sitemap title should translate");
  assert.deepEqual(p.sent(), ["公開の商品案内"]);
  assert.equal(p.w.document.getElementById("private-value").value, "秘密の入力値");
  assert.equal(p.w.document.getElementById("private-check").checked, true);
  assert.equal(p.w.document.querySelector("option").selected, true);
  assert.equal(p.w.document.querySelector("[translate=no]").textContent, "秘密の原文");
});

test("공용 검색 탭의 제목·small을 번역해도 선택 상태와 숨긴 패널 전환을 유지한다", async (t) => {
  const tabs = [
    { name: "genre", title: "ジャンル", detail: "からさがす" },
    { name: "age", title: "対象年齢", detail: "からさがす" },
    { name: "like", title: "「好き」", detail: "をさがす" },
  ];
  const p = page(t, `<style>.c-tab-panel[aria-hidden="true"] { visibility: hidden; }</style>
    <div class="c-tab-group _protrude"><div class="c-tab-buttons" role="tablist">
      ${tabs.map((tab, index) => `<button class="c-tab-button" id="search_${tab.name}" type="button"
        role="tab" aria-controls="search_${tab.name}_content" aria-selected="${index === 0}"
        data-tab-trigger>${tab.title}<small>${tab.detail}</small></button>`).join("")}
    </div>
    <div class="c-tab-panel" role="tabpanel" id="search_genre_content" aria-labelledby="search_genre"
      aria-hidden="false" data-tab-target><a href="/products/genre/">ジャンル別の商品</a></div>
    <div class="c-tab-panel" role="tabpanel" id="search_age_content" aria-labelledby="search_age"
      aria-hidden="true" data-tab-target><a class="c-card-search-age" href="/products/age/">
      <span class="c-card-search-age__title">3</span><span class="c-card-search-age__unit">歳以上</span></a></div>
    <div class="c-tab-panel" role="tabpanel" id="search_like_content" aria-labelledby="search_like"
      aria-hidden="true" data-tab-target><p>好きな商品を探す</p>
      <form class="p-favorite-block__form" method="get" action="/products/favorite/result.html">
        <label class="c-card-favorite"><input type="checkbox" value="private-choice" checked>
        <span class="hiragana">秘密の選択ラベル</span><span class="title">秘密のフォーム項目</span></label>
      </form></div>
    </div>`, { url: "https://www.takaratomy.co.jp/" });
  const buttons = [...p.w.document.querySelectorAll(".c-tab-button")];
  const smallNodes = buttons.map((button) => button.querySelector("small"));
  const titleNodes = buttons.map((button) => button.firstChild);
  const panels = [...p.w.document.querySelectorAll(".c-tab-panel")];
  const initialAttributes = buttons.map((button) => [...button.attributes].map(({ name, value }) => [name, value]));
  const ageUnit = p.w.document.querySelector(".c-card-search-age__unit");
  const likeCopy = panels[2].querySelector("p");
  let clicks = 0;
  for (const button of buttons) button.addEventListener("click", () => {
    clicks += 1;
    buttons.forEach((candidate, index) => {
      candidate.setAttribute("aria-selected", String(candidate === button));
      panels[index].setAttribute("aria-hidden", String(candidate !== button));
    });
  });
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => buttons.every((button, index) => (
    button.firstChild.nodeValue === `번역(${tabs[index].title})`
      && button.querySelector("small").textContent === `번역(${tabs[index].detail})`
  )), "all search tab titles and their small suffixes should translate");
  for (let index = 0; index < buttons.length; index += 1) {
    assert.equal(buttons[index].firstChild, titleNodes[index]);
    assert.equal(buttons[index].querySelector("small"), smallNodes[index]);
    assert.deepEqual([...buttons[index].attributes].map(({ name, value }) => [name, value]), initialAttributes[index]);
  }
  assert.equal(p.sent().includes("歳以上"), false);
  assert.equal(p.sent().includes("好きな商品を探す"), false);
  buttons[1].click();
  await waitFor(() => ageUnit.textContent === "번역(歳以上)", "the selected age panel should become eligible");
  assert.deepEqual(buttons.map((button) => button.getAttribute("aria-selected")), ["false", "true", "false"]);
  assert.deepEqual(panels.map((panel) => panel.getAttribute("aria-hidden")), ["true", "false", "true"]);
  assert.equal(p.w.document.querySelector(".c-card-search-age__title").textContent, "3");
  const before = p.requests.length;
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  buttons.forEach((button, index) => {
    assert.equal(button.firstChild.nodeValue, tabs[index].title);
    assert.equal(smallNodes[index].textContent, tabs[index].detail);
  });
  assert.equal(ageUnit.textContent, "歳以上");
  assert.equal(buttons[1].getAttribute("aria-selected"), "true");
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  assert.equal(buttons[1].firstChild.nodeValue, "번역(対象年齢)");
  assert.equal(smallNodes[1].textContent, "번역(からさがす)");
  assert.equal(ageUnit.textContent, "번역(歳以上)");
  assert.equal(p.requests.length, before);

  buttons[2].click();
  await waitFor(() => likeCopy.textContent === "번역(好きな商品を探す)", "the next selected panel should be rescanned");
  assert.equal(clicks, 2);
  assert.equal(buttons[2].getAttribute("aria-controls"), panels[2].id);
  assert.equal(panels[2].getAttribute("aria-labelledby"), buttons[2].id);
  assert.equal(p.w.document.getElementById(buttons[2].id), buttons[2]);
  assert.equal(buttons[2].querySelector("small"), smallNodes[2]);
  assert.equal(p.sent().some((text) => /秘密|private-choice/.test(text)), false);
  assert.equal(p.w.document.querySelector(".p-favorite-block__form input").checked, true);
  assert.equal(p.w.document.querySelector(".p-favorite-block__form input").value, "private-choice");
});

test("공용 검색 탭 예외도 임의 폼·보호 텍스트를 제외하고 다른 사이트와 민감 경로에 적용하지 않는다", async (t) => {
  const html = `<div class="c-tab-group"><div class="c-tab-buttons" role="tablist">
    <button role="tab" id="public-tab">公開の分類<small>から探す</small>
      <span hidden>秘密の非表示</span><span translate="no">秘密の原文</span>
      <span style="display:none">秘密の補足</span><span class="price">秘密の価格</span></button>
    <button role="tab" aria-hidden="true">秘密の隠したタブ</button>
    <button>秘密の別操作</button>
  </div></div>
  <form id="private-account"><div class="c-tab-group"><div class="c-tab-buttons">
    <button role="tab">秘密のアカウント</button><input value="秘密の入力値">
  </div></div></form>
  <div data-nudenyang-ignore><div class="c-tab-group"><div class="c-tab-buttons">
    <button role="tab">秘密の保護されたタブ</button></div></div></div>
  <div class="c-tab-buttons"><button role="tab">秘密の別タブ</button></div>`;
  const publicPage = page(t, html, { url: "https://www.takaratomy.co.jp/" });
  await publicPage.message({ type: "nudenyang-ready" });
  await waitFor(() => publicPage.w.document.querySelector("#public-tab small").textContent === "번역(から探す)",
    "only the public tab title should translate");
  assert.deepEqual(publicPage.sent(), ["公開の分類", "から探す"]);
  assert.equal(publicPage.w.document.querySelector("input").value, "秘密の入力値");
  for (const url of ["https://example.org/", "https://www.takaratomy.co.jp/account/"]) {
    const p = page(t, html, { url });
    await p.message({ type: "nudenyang-ready" });
    await p.message({ type: "nudenyang-set-enabled", enabled: true });
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.deepEqual(p.sent(), [], url);
  }
});

test("ShoPro의 헤더 메뉴는 직접 켠 뒤 본문과 함께 번역하며 링크·DOM·OFF·ON 캐시를 보존한다", async (t) => {
  const menuItems = [
    ["news/", "最新情報"], ["#stream", "配信情報"], ["#story", "物語"], ["#chara", "登場人物"],
    ["#staff", "スタッフ・キャスト"], ["music/", "音楽情報"], ["special/", "スペシャル"], ["#gensaku", "原作情報"],
  ];
  const p = page(t, `<header><div class="headerWrap">
    <div class="header-logo"><a href="#top"><img alt="作品のロゴ"></a></div>
    <button type="button" class="btn"><span class="btn-line"></span></button><div class="overray"></div>
    <div class="menu"><ul>${menuItems.map(([href, title]) => `<li><a href="${href}">${title}</a></li>`).join("")}</ul>
      <div class="sns03"><a href="https://example.org/"><img alt="画像のSNS案内"></a></div></div>
    <ul class="sns02"><li><a href="https://example.org/"><img alt="別のSNS画像"></a></li></ul>
  </div></header><main><h2>作品の紹介</h2><p>物語を紹介する文章です。</p>
    <div class="main_top mainBox"><div class="main_left"><ul class="contentsList">
      <li><a href="special/">作品の詳細</a></li></ul></div></div></main>`, {
    url: "https://www.shopro.co.jp/anime/duelmasters_lost/",
  });
  const links = [...p.w.document.querySelectorAll("header .menu > ul > li > a")];
  const originalNodes = links.map((link) => link.firstChild);
  const attributes = links.map((link) => [...link.attributes].map(({ name, value }) => [name, value]));
  const mainLink = p.w.document.querySelector("main .contentsList a");
  let clicks = 0;
  links[0].addEventListener("click", (event) => { event.preventDefault(); clicks += 1; });
  await p.message({ type: "nudenyang-ready" });
  assert.equal((await p.message({ type: "nudenyang-status" })).enabled, false);
  assert.deepEqual(p.sent(), []);
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  await waitFor(() => links.every((link, index) => link.textContent === `번역(${menuItems[index][1]})`)
    && mainLink.textContent === "번역(作品の詳細)"
    && p.w.document.querySelector("main p").textContent === "번역(物語を紹介する文章です。)",
  "the public header and existing body copy should both translate");
  links.forEach((link, index) => {
    assert.equal(link.firstChild, originalNodes[index]);
    assert.deepEqual([...link.attributes].map(({ name, value }) => [name, value]), attributes[index]);
    assert.equal(p.sent().filter((text) => text === menuItems[index][1]).length, 1);
  });
  assert.equal(p.w.document.querySelector("header img").alt, "作品のロゴ");
  assert.equal(p.sent().some((text) => /画像|ロゴ/.test(text)), false);
  links[0].click();
  assert.equal(clicks, 1);
  const before = p.requests.length;
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  links.forEach((link, index) => assert.equal(link.textContent, menuItems[index][1]));
  assert.equal(mainLink.textContent, "作品の詳細");
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  links.forEach((link, index) => assert.equal(link.textContent, `번역(${menuItems[index][1]})`));
  assert.equal(mainLink.textContent, "번역(作品の詳細)");
  links[0].click();
  assert.equal(clicks, 2);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(p.requests.length, before);
});

test("ShoPro 모바일 메뉴는 CSS로 펼친 뒤 수집하고 다시 숨긴 새 문구는 보내지 않는다", async (t) => {
  const p = page(t, `<style>
    header .headerWrap .menu { display: none; }
    header .headerWrap.mobile-open .menu { display: block; }
  </style><header><div class="headerWrap"><button class="btn" type="button" aria-expanded="false">
    <span class="btn-line"></span></button><div class="overray"></div>
    <div class="menu"><ul><li><a href="news/">公開の最新情報</a></li></ul></div></div></header>`, {
    url: "https://www.shopro.co.jp/anime/duelmasters_lost/", tabEnabled: true,
  });
  const wrapper = p.w.document.querySelector(".headerWrap");
  // jsdom 30 drops this ancestor-qualified child selector in scoped queries.
  // On the live ShoPro page, Whale's document/header/.headerWrap queries each returned 8.
  // Use wildcard descendants + matches() only for this root, without fixture-specific IDs.
  const queryDescendants = wrapper.querySelectorAll.bind(wrapper);
  wrapper.querySelectorAll = (selector) => [...queryDescendants("*")].filter((element) => element.matches(selector));
  const button = wrapper.querySelector("button");
  const link = wrapper.querySelector(".menu a");
  let clicks = 0;
  button.addEventListener("click", () => {
    clicks += 1;
    button.setAttribute("aria-expanded", String(wrapper.classList.toggle("mobile-open")));
  });
  await p.message({ type: "nudenyang-ready" });
  assert.deepEqual(p.sent(), []);
  button.click();
  await waitFor(() => link.textContent === "번역(公開の最新情報)", "a CSS-only opened mobile menu should translate");
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(link.getAttribute("href"), "news/");
  button.click();
  link.firstChild.nodeValue = "公開の新しい案内";
  const before = p.requests.length;
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(p.requests.length, before);
  assert.equal(p.sent().includes("公開の新しい案内"), false);
  button.click();
  await waitFor(() => link.textContent === "번역(公開の新しい案内)", "reopened menu should collect its new visible copy");
  assert.equal(clicks, 3);
  assert.equal(wrapper.querySelector("button"), button);
});

test("ShoPro 메뉴 예외도 숨김·inert·편집·개인 폼·무관 버튼과 영역 밖 페이지를 제외한다", async (t) => {
  const html = `<header><div class="headerWrap"><div class="menu"><ul>
    <li><a id="public-menu" href="news/"><span>公開の作品案内</span><span hidden>秘密の非表示</span>
      <span style="display:none">秘密の補足</span><span translate="no">秘密の原文</span></a></li>
    <li hidden><a href="#hidden">秘密の隠した項目</a></li>
    <li inert><a href="#inert">秘密の操作不可項目</a></li>
    <li aria-hidden="true"><a href="#aria-hidden">秘密の隠したリンク</a></li>
    <li contenteditable="true"><a href="#editor">秘密の編集中</a></li>
    <li data-nudenyang-ignore><a href="#protected">秘密の保護項目</a></li>
    <li><a href="#button" role="button">秘密のボタン操作</a></li>
  </ul><button>秘密の無関係操作</button><div class="sns03"><a href="https://example.org/">秘密の別リンク</a></div></div>
  <form id="private-account"><div class="menu"><ul><li><a href="#account">秘密のアカウント内容</a></li></ul></div>
    <input value="秘密の入力値"><textarea>秘密の編集中の値</textarea></form>
  <div class="header-logo"><a href="#logo">秘密の別案内</a></div><button class="btn">秘密の操作文</button>
  </div></header>`;
  const publicPage = page(t, html, {
    url: "https://www.shopro.co.jp/anime/duelmasters_lost/", tabEnabled: true,
  });
  await publicPage.message({ type: "nudenyang-ready" });
  await waitFor(() => publicPage.w.document.querySelector("#public-menu > span").textContent === "번역(公開の作品案内)",
    "the visible menu copy should translate without private controls");
  assert.deepEqual(publicPage.sent(), ["公開の作品案内"]);
  assert.equal(publicPage.w.document.querySelector("input").value, "秘密の入力値");
  assert.equal(publicPage.w.document.querySelector("textarea").value, "秘密の編集中の値");
  for (const url of [
    "https://www.shopro.co.jp/company/", "https://other.shopro.co.jp/anime/duelmasters_lost/",
    "https://www.shopro.co.jp/anime/duelmasters_lost/account/",
  ]) {
    const p = page(t, html, { url, tabEnabled: true });
    await p.message({ type: "nudenyang-ready" });
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.deepEqual(p.sent(), [], url);
  }
});

test("범용 본문 수집 범위가 넓어져도 임의의 폼·메뉴·숨긴 텍스트는 번역하지 않는다", async (t) => {
  const p = page(t, `<div id="unrecognized-root">通常の<strong>説明です</strong></div>
    <nav><span>秘密のメニュー</span></nav><form><label>秘密のラベル</label></form>
    <div hidden>秘密の非表示文</div><div translate="no">秘密の原文</div>`, {
    url: "https://example.org/articles/one",
  });
  await p.message({ type: "nudenyang-ready" });
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  await waitFor(() => p.sent().includes("通常の"), "generic layout prose should translate");
  assert.ok(!p.sent().some((text) => text.includes("秘密")));
});

test("시작 중의 연속 토글은 초기 상태 조회에 덮어써지지 않는다", async (t) => {
  const p = page(t, "<p>通常の文章</p>", { deferStatus: true, tabEnabled: false });
  const first = p.message({ type: "nudenyang-toggle-enabled" });
  const second = p.message({ type: "nudenyang-toggle-enabled" });
  p.releaseStatus();
  await Promise.all([first, second]);
  assert.deepEqual(p.savedStates, [true, false]);
  assert.equal((await p.message({ type: "nudenyang-status" })).enabled, false);
});

test("복구 주입과 정적 주입이 겹쳐도 페이지 실행기는 하나만 유지한다", async (t) => {
  const p = page(t, "<p>通常の文章</p>");
  await p.message({ type: "nudenyang-ready" });
  const before = p.listeners.size;
  p.reinject();
  await p.message({ type: "nudenyang-ready" });
  assert.equal(p.listeners.size, before);
  assert.equal((await p.message({ type: "nudenyang-status" })).origin, "https://dm.takaratomy.co.jp");
});

test("공개 메뉴 안에서도 숨긴 문구와 별도 개인정보 폼은 전송하지 않는다", async (t) => {
  const p = page(t, `<header class="l-header"><a href="/product/">公開案内
    <span style="display:none">秘密の文章</span><span translate="no">秘密の原文</span></a>
    <form id="private-account"><label>秘密のログイン</label><button>秘密の送信</button></form>
    </header><p>公開本文<span style="visibility:hidden">秘密の補足</span></p>`);
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.sent().includes("公開本文"), "visible prose should translate");
  assert.ok(p.sent().some((text) => text.includes("公開案内")));
  assert.ok(!p.sent().some((text) => text.includes("秘密")));
});

test("CSS만 바뀌는 공개 메뉴를 표시하면 새로 수집한다", async (t) => {
  const p = page(t, `<header class="l-header"><a id="menu" href="/product/"
    style="display:none">開いたメニュー</a></header>`);
  await p.message({ type: "nudenyang-ready" });
  assert.equal(p.sent().length, 0);
  p.w.document.querySelector("#menu").style.display = "block";
  await waitFor(() => p.sent().includes("開いたメニュー"), "CSS-only visibility change should rescan");
});

test("번역을 껐다 켜면 저장된 문단을 즉시 재사용하고 다시 요청하지 않는다", async (t) => {
  const p = page(t, "<div>原文の説明</div>");
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.w.document.body.textContent === "번역(原文の説明)", "first translation should apply");
  const before = p.requests.length;
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  assert.equal(p.w.document.body.textContent, "原文の説明");
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  assert.equal(p.w.document.body.textContent, "번역(原文の説明)");
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(p.requests.length, before);
});

test("수집 후 전송 직전에 숨긴 메뉴는 보내지 않고 다시 표시하면 번역한다", async (t) => {
  const p = page(t, '<header class="l-header"><a id="menu" href="/product/">公開メニュー</a></header>');
  await p.message({ type: "nudenyang-ready" });
  const menu = p.w.document.querySelector("#menu");
  menu.style.visibility = "hidden";
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(p.requests.length, 0);
  menu.style.visibility = "visible";
  await waitFor(() => p.sent().includes("公開メニュー"), "shown menu should be queued again");
});

test("수집 후 보호 속성이나 개인정보 폼으로 바뀐 텍스트는 전송하지 않는다", async (t) => {
  for (const protect of [
    (element) => element.setAttribute("translate", "no"),
    (element) => element.setAttribute("contenteditable", "true"),
    (element) => {
      const form = element.ownerDocument.createElement("form");
      element.replaceWith(form);
      form.append(element);
    },
  ]) {
    const p = page(t, '<p id="pending">保護する文章</p>');
    await p.message({ type: "nudenyang-ready" });
    protect(p.w.document.querySelector("#pending"));
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(p.requests.length, 0);
  }
});

test("큰 설명란을 통째로 버리지 않고 문서 구조와 외부 전송 한도를 지키며 처리한다", async (t) => {
  const parts = Array.from({ length: 10 }, (_, index) => `${index}${"文".repeat(2998)}`);
  const p = page(t, `<main><div>${parts.map((part) => `<span>${part}</span>`).join("<br>")}</div></main>`, {
    translator: "deepl", settings: { externalPageCharLimit: 25000 },
  });
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.requests.length > 0, "oversize prose should not silently disappear");
  await waitFor(() => p.w.document.querySelector("span").textContent.startsWith("번역("), "first part should apply");
  assert.ok(p.sent().reduce((total, text) => total + text.length, 0) <= 25000);
  assert.deepEqual(p.sent(), parts.slice(0, p.sent().length));
  assert.equal(p.w.document.querySelectorAll("span").length, 10);
  assert.equal(p.w.document.querySelectorAll("br").length, 9);
});

test("반복 스크롤은 전체 DOM 수집을 다시 실행하지 않는다", async (t) => {
  const p = page(t, "<div>原文の説明</div>");
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.w.document.body.textContent === "번역(原文の説明)", "first translation should apply");
  let walks = 0;
  const originalWalk = p.w.document.createTreeWalker.bind(p.w.document);
  p.w.document.createTreeWalker = (...args) => { walks += 1; return originalWalk(...args); };
  for (let i = 0; i < 20; i += 1) p.w.document.dispatchEvent(new p.w.Event("scroll"));
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(walks, 0);
  assert.equal(p.requests.length, 1);
});

test("보이는 YouTube 제목은 본문과 같은 요청·언어·전송량 집계로 번역한다", async (t) => {
  const p = page(t, `<p>製品の説明</p><iframe src="${FRAME_URL}"></iframe>`);
  const context = await p.message(embedRequest("status"));
  assert.equal(context.enabled, true);
  const result = await p.message(embedRequest("translate", {
    title: "最新の製品紹介", epoch: context.epoch, translationKey: context.translationKey,
  }));
  assert.equal(result.translation, "번역(最新の製品紹介)");
  assert.equal(result.targetLanguage, "KO");
  assert.equal(result.translationKey, context.translationKey);
  assert.equal(p.requests.length, 1);
  assert.deepEqual(p.sent().sort(), ["最新の製品紹介", "製品の説明"].sort());
  const status = await p.message({ type: "nudenyang-status" });
  assert.equal(status.requestCount, 1);
  assert.equal(status.sentChars, "最新の製品紹介製品の説明".length);
  assert.equal(p.w.document.querySelector("iframe").src, FRAME_URL);
});

test("부모 정책이 꺼져 있으면 영상 프레임은 스스로 번역을 시작하지 못한다", async (t) => {
  for (const options of [
    { tabEnabled: false },
    { settings: { enabled: false } },
    { settings: { sitePolicies: { "dm.takaratomy.co.jp": "never" } } },
    { url: "https://dm.takaratomy.co.jp/account/settings/" },
  ]) {
    const p = page(t, `<iframe src="${FRAME_URL}"></iframe>`, options);
    const context = await p.message(embedRequest("status"));
    assert.equal(context.enabled, false);
    const reply = await p.message(embedRequest("translate", {
      title: "動画タイトル", epoch: context.epoch, translationKey: context.translationKey,
    }));
    assert.equal(reply.ok, false);
    assert.equal(p.requests.length, 0);
  }
});

test("숨긴·화면 밖·존재하지 않는 영상이나 위조된 프레임은 승인하지 않는다", async (t) => {
  for (const markup of [
    `<iframe hidden src="${FRAME_URL}"></iframe>`,
    `<iframe data-offscreen src="${FRAME_URL}"></iframe>`,
    `<div style="display:none"><iframe src="${FRAME_URL}"></iframe></div>`,
    `<div data-nudenyang-ignore><iframe src="${FRAME_URL}"></iframe></div>`,
    `<form><iframe src="${FRAME_URL}"></iframe></form>`,
    `<div class="cookie-banner"><iframe src="${FRAME_URL}"></iframe></div>`,
    "<div></div>",
  ]) {
    const p = page(t, markup);
    const context = await p.message(embedRequest("status"));
    assert.equal(context.enabled, false, markup);
    assert.equal(p.requests.length, 0);
  }
  const p = page(t, `<iframe src="${FRAME_URL}"></iframe>`);
  for (const extra of [
    { frameId: 0 }, { frameId: -1 }, { documentToken: "invalid token" },
    { frameUrl: "https://www.youtube.com.evil.test/embed/video123" },
  ]) {
    const reply = await p.message(embedRequest("status", extra));
    assert.ok(reply.ok === false || reply.enabled === false);
  }
  assert.equal((await p.message(embedRequest("status"), { id: "another-extension" })).ok, false);
});

test("영상 문서가 다시 연결되어도 진행 중인 같은 제목 번역을 이어받는다", async (t) => {
  const p = page(t, `<iframe src="${FRAME_URL}"></iframe>`, { deferTranslation: true });
  const context = await p.message(embedRequest("status"));
  const request = embedRequest("translate", {
    title: "動画タイトル", epoch: context.epoch, translationKey: context.translationKey,
  });
  const pending = p.message(request);
  await waitFor(() => p.requests.length === 1, "native request should begin");
  await p.message(embedRequest("status", { documentToken: "replacement_document" }));
  const replacement = p.message({ ...request, documentToken: "replacement_document" });
  assert.equal((await pending).code, "stale");
  assert.equal(p.requests.length, 1);
  p.releaseTranslation();
  assert.equal((await replacement).translation, "번역(動画タイトル)");
});

test("같은 영상 문서의 포커스 재확인도 진행 중인 제목 번역을 이어받는다", async (t) => {
  const p = page(t, `<iframe src="${FRAME_URL}"></iframe>`, { deferTranslation: true });
  const context = await p.message(embedRequest("status"));
  const request = embedRequest("translate", {
    title: "動画タイトル", epoch: context.epoch, translationKey: context.translationKey,
  });
  const first = p.message(request);
  await waitFor(() => p.requests.length === 1, "native request should begin");
  await p.message(embedRequest("status"));
  const next = p.message(request);
  assert.equal((await first).code, "stale");
  p.releaseTranslation();
  assert.equal((await next).translation, "번역(動画タイトル)");
  assert.equal(p.requests.length, 1);
});

test("부모 OFF는 진행 중인 영상 요청을 즉시 해제하고 늦은 결과를 버린다", async (t) => {
  const p = page(t, `<iframe src="${FRAME_URL}"></iframe>`, { deferTranslation: true });
  const context = await p.message(embedRequest("status"));
  const pending = p.message(embedRequest("translate", {
    title: "動画タイトル", epoch: context.epoch, translationKey: context.translationKey,
  }));
  await waitFor(() => p.requests.length === 1, "native request should begin");
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  const cancelled = await pending;
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.code, "disabled");
  p.releaseTranslation();
  assert.equal((await p.message(embedRequest("status"))).enabled, false);
  assert.ok(p.runtimeMessages.some((message) => message.type === "nudenyang-embed-parent-changed"));
});

test("전송 한도를 이미 사용했어도 진행 중인 제목은 추가 전송 없이 이어받는다", async (t) => {
  const p = page(t, `${["文", "章", "字"].map((char) => `<p>${char.repeat(3000)}</p>`).join("")}
    <iframe src="${FRAME_URL}"></iframe>`, {
    deferTranslation: true, translator: "deepl", settings: { externalPageCharLimit: 10000 },
  });
  const context = await p.message(embedRequest("status"));
  const request = embedRequest("translate", {
    title: "題".repeat(1000), epoch: context.epoch, translationKey: context.translationKey,
  });
  const first = p.message(request);
  await waitFor(() => p.requests.length === 1, "one shared request should use the budget");
  assert.equal((await p.message({ type: "nudenyang-status" })).sentChars, 10000);
  await p.message(embedRequest("status"));
  const next = p.message(request);
  assert.equal((await first).code, "stale");
  p.releaseTranslation();
  assert.equal((await next).translation, `번역(${request.title})`);
  assert.equal(p.requests.length, 1);
});

test("재연결된 영상의 제목이 바뀌면 이전 결과를 버리고 새 제목만 순서대로 처리한다", async (t) => {
  const p = page(t, `<iframe src="${FRAME_URL}"></iframe>`, { deferTranslation: true });
  const context = await p.message(embedRequest("status"));
  const request = embedRequest("translate", {
    title: "前の動画", epoch: context.epoch, translationKey: context.translationKey,
  });
  const first = p.message(request);
  await waitFor(() => p.requests.length === 1, "first request should begin");
  const next = p.message({ ...request, title: "次の動画", documentToken: "next_document" });
  assert.equal((await first).code, "stale");
  assert.equal(p.requests.length, 1);
  p.releaseTranslation();
  await waitFor(() => p.requests.length === 2, "next title should follow the previous native request");
  p.releaseTranslation();
  assert.equal((await next).translation, "번역(次の動画)");
  assert.deepEqual(p.sent(), ["前の動画", "次の動画"]);
});

test("언어 변경 후 이전 영상 결과는 적용하지 않고 새 언어만 허용한다", async (t) => {
  const p = page(t, `<iframe src="${FRAME_URL}"></iframe>`, { deferTranslation: true });
  const before = await p.message(embedRequest("status"));
  const pending = p.message(embedRequest("translate", {
    title: "動画タイトル", epoch: before.epoch, translationKey: before.translationKey,
  }));
  await waitFor(() => p.requests.length === 1, "native request should begin");
  await p.message({ type: "nudenyang-set-target-language", targetLanguage: "EN" });
  assert.equal((await pending).code, "stale");
  p.releaseTranslation();
  const after = await p.message(embedRequest("status"));
  assert.notEqual(after.translationKey, before.translationKey);
  assert.ok(after.epoch > before.epoch);
  const stale = await p.message(embedRequest("translate", {
    title: "動画タイトル", epoch: before.epoch, translationKey: before.translationKey,
  }));
  assert.equal(stale.code, "stale");
  const next = p.message(embedRequest("translate", {
    title: "動画タイトル", epoch: after.epoch, translationKey: after.translationKey,
  }));
  await waitFor(() => p.requests.length === 2, "new target should get a fresh request");
  assert.equal(p.requests[1].targetLanguage, "EN");
  p.releaseTranslation();
  assert.equal((await next).targetLanguage, "EN");
});

test("영상 제목도 부모 페이지의 외부 전송 한도를 소비하고 초과 시 보내지 않는다", async (t) => {
  const prose = ["文".repeat(3999), "章".repeat(3999), "字".repeat(1990)];
  const p = page(t, `${prose.map((text) => `<p>${text}</p>`).join("")}
    <iframe src="${FRAME_URL}"></iframe>`, {
    translator: "deepl", settings: { externalPageCharLimit: 10000 },
  });
  await p.message({ type: "nudenyang-ready" });
  await waitFor(() => p.requests.length === 1, "prose should consume the budget");
  const context = await p.message(embedRequest("status"));
  const reply = await p.message(embedRequest("translate", {
    title: "題".repeat(20), epoch: context.epoch, translationKey: context.translationKey,
  }));
  assert.equal(reply.code, "limited");
  assert.equal(p.requests.length, 1);
  assert.equal((await p.message({ type: "nudenyang-status" })).sentChars, 9988);
});

test("다른 탭으로 넘어간 뒤 아직 전송하지 않은 영상 제목은 보내지 않는다", async (t) => {
  const p = page(t, `<iframe src="${FRAME_URL}"></iframe>`);
  const context = await p.message(embedRequest("status"));
  const pending = p.message(embedRequest("translate", {
    title: "動画タイトル", epoch: context.epoch, translationKey: context.translationKey,
  }));
  // Allow request validation to finish, but hide the parent before the shared queue flush.
  await Promise.resolve();
  await Promise.resolve();
  Object.defineProperty(p.w.document, "hidden", { value: true, configurable: true });
  p.w.document.dispatchEvent(new p.w.Event("visibilitychange"));
  assert.equal((await pending).ok, false);
  assert.equal(p.requests.length, 0);
  assert.equal((await p.message(embedRequest("status"))).enabled, false);
});

test("SPA가 민감한 경로로 이동하면 주기 검사 전에도 영상 제목을 차단한다", async (t) => {
  const p = page(t, `<iframe src="${FRAME_URL}"></iframe>`, { url: "https://example.org/articles/one" });
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  const before = await p.message(embedRequest("status"));
  assert.equal(before.enabled, true);
  p.w.history.pushState({}, "", "/account");
  const after = await p.message(embedRequest("status"));
  assert.equal(after.enabled, false);
  assert.ok(after.epoch > before.epoch);
  const reply = await p.message(embedRequest("translate", {
    title: "動画タイトル", epoch: before.epoch, translationKey: before.translationKey,
  }));
  assert.equal(reply.ok, false);
  assert.equal(p.requests.length, 0);
});

test("번역 응답에 포함된 최신 사용 중지 설정도 영상 응답 전에 적용한다", async (t) => {
  const p = page(t, `<iframe src="${FRAME_URL}"></iframe>`, { responseSettings: { enabled: false } });
  const before = await p.message(embedRequest("status"));
  const reply = await p.message(embedRequest("translate", {
    title: "動画タイトル", epoch: before.epoch, translationKey: before.translationKey,
  }));
  assert.equal(reply.ok, false);
  assert.equal((await p.message(embedRequest("status"))).enabled, false);
});
