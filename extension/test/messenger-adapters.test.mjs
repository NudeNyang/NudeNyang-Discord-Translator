import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import "../messenger-adapters.js";

const {
  siteForLocation,
  privateSiteForLocation,
  contextForDocument,
  isEligibleMessageBlock,
  selectMessageBlocks,
  isVisibleElement,
} = globalThis.NudeNyangMessengerAdapters;

const cases = [
  {
    id: "x", url: "https://x.com/messages/101-202",
    html: `<div data-testid="DmActivityViewport"><div data-testid="messageEntry"><span data-testid="messageSender">Example Sender</span><span dir="auto" id="body-one">A neutral first message.</span><time>12:01</time></div><button data-testid="messageEntry"><span dir="auto" id="body-two">A neutral reply.</span></button></div>`,
  },
  {
    id: "discord", url: "https://discord.com/channels/@me/200",
    html: `<ol data-list-id="chat-messages"><li><h3><span class="username">Example Sender</span></h3><div id="message-content-100">A neutral first message.</div><time>12:01</time></li><li><div id="message-content-101">A neutral reply.</div></li></ol>`,
    bodies: ["message-content-100", "message-content-101"],
  },
  {
    id: "whatsapp", url: "https://web.whatsapp.com/",
    html: `<div id="main"><header>Example Sender</header><div data-testid="conversation-panel-messages"><div class="message-in"><div data-pre-plain-text="Example Sender"><span class="selectable-text" id="body-one">A neutral first message.</span></div></div><div class="message-out"><span class="selectable-text" id="body-two">A neutral reply.</span></div></div><footer><div contenteditable="true">A private unsent draft.</div></footer></div>`,
  },
  {
    id: "telegram", url: "https://web.telegram.org/k/#12345",
    html: `<div class="chat"><div class="chat-info"><span class="peer-title">Example Sender</span></div><div class="bubbles-inner"><div class="bubble"><div class="message" id="body-one">A neutral first message.<span class="time">12:01</span></div></div><div class="bubble"><div class="message" id="body-two">A neutral reply.<div class="reactions-element">Like</div></div></div><div class="bubble service"><div class="message">A member joined.</div></div></div></div>`,
  },
  {
    id: "telegram", url: "https://web.telegram.org/a/#12345",
    html: `<div id="MiddleColumn"><div class="MiddleHeader">Example Sender</div><div class="MessageList"><div class="Message"><div class="text-content" id="body-one">A neutral first message.<span class="MessageMeta">12:01</span></div></div><div class="Message"><div class="text-content" id="body-two">A neutral reply.</div></div><div class="Message ActionMessage"><div class="text-content">A member joined.</div></div></div></div>`,
  },
  {
    id: "messenger", url: "https://www.messenger.com/e2ee/t/12345/",
    html: `<div role="main"><header>Example Sender</header><div data-scope="messages_table"><div><a href="https://www.facebook.com/example"><span dir="auto">Example Sender</span></a><div dir="auto" id="body-one">A neutral first message.</div><time>12:01</time></div><div><span dir="auto" id="body-two">A neutral reply.</span><div role="button"><span dir="auto">Reply</span></div></div></div><div contenteditable="true" role="textbox">A private unsent draft.</div></div>`,
  },
  {
    id: "slack", url: "https://app.slack.com/client/T123/C456",
    html: `<div data-qa="message_pane"><div data-qa="message_list"><div class="c-message_kit__message"><span class="c-message__sender">Example Sender</span><div class="c-message_kit__blocks"><div class="p-rich_text_block" id="body-one">A neutral first message.</div></div></div><div class="c-message_kit__message"><div class="c-message_kit__blocks"><div class="p-rich_text_block" id="body-two">A neutral reply.</div></div></div></div></div>`,
  },
  {
    id: "teams", url: "https://teams.microsoft.com/v2/",
    html: `<div id="chat-pane-list"><div id="message-body-100"><span data-tid="message-author-name">Example Sender</span><div id="content-100">A neutral first message.</div><time>12:01</time></div><div id="message-body-101"><div id="content-101">A neutral reply.</div></div></div>`,
    bodies: ["content-100", "content-101"],
  },
  {
    id: "google-messages", url: "https://messages.google.com/web/conversations/123",
    html: `<mws-conversation-container><header>Example Sender</header><mws-messages-list><mws-message-wrapper><mws-text-message-part id="body-one">A neutral first message.</mws-text-message-part></mws-message-wrapper><mws-message-wrapper><mws-text-message-part id="body-two">A neutral reply.</mws-text-message-part></mws-message-wrapper></mws-messages-list><textarea>A private unsent draft.</textarea></mws-conversation-container>`,
  },
];

function fixture(entry, before = "", after = "") {
  return new JSDOM(`<aside><p id="contact">Contact and conversation preview.</p></aside>${before}${entry.html}${after}<input value="private search query"><textarea>A private unsent draft.</textarea>`, { url: entry.url, pretendToBeVisual: true });
}

for (const entry of cases) {
  test(`${entry.id} ${new URL(entry.url).pathname}: 대화 본문만 선택하고 문서를 변경하지 않는다`, () => {
    const dom = fixture(entry);
    try {
      const { document, location } = dom.window;
      const before = document.documentElement.outerHTML;
      assert.equal(siteForLocation(location)?.id, entry.id);
      const context = contextForDocument(location, document);
      assert.equal(context?.id, entry.id);
      assert.deepEqual(selectMessageBlocks(context).map((element) => element.id), entry.bodies ?? ["body-one", "body-two"]);
      assert.equal(isEligibleMessageBlock(document.querySelector("#contact"), context), false);
      assert.equal(isEligibleMessageBlock(document.querySelector("textarea"), context), false);
      assert.equal(document.documentElement.outerHTML, before);
      assert.ok(Array.isArray(context.blocks));
      assert.ok(Array.isArray(context.excludes));
      assert.equal(context.identityNodes[0], context.root);
      assert.equal(context.identityNodes[1], selectMessageBlocks(context)[0]);
    } finally { dom.window.close(); }
  });
}

test("정확한 HTTPS 서비스와 읽기 경로만 식별한다", () => {
  const accepted = [
    ["https://twitter.com/i/chat/123", "x"],
    ["https://www.x.com/messages", "x"],
    ["https://ptb.discord.com/channels/100/200", "discord"],
    ["https://canary.discord.com/channels/@me/200", "discord"],
    ["https://messenger.com/t/123", "messenger"],
    ["https://teams.live.com/v2/#/chat", "teams"],
    ["https://teams.cloud.microsoft/v2/", "teams"],
    ["https://messages.google.com/web/u/0/conversations/100", "google-messages"],
  ];
  for (const [url, id] of accepted) assert.equal(siteForLocation(new URL(url))?.id, id, url);
  const rejected = [
    "https://x.com/home", "https://x.com/anyone/status/123", "https://x.com/messages/compose",
    "https://x.com/messages/requests", "https://x.com/messages/search", "https://x.com/i/chat/settings",
    "https://discord.com/channels/@me", "https://discord.com/login", "https://discord.com/settings",
    "https://web.whatsapp.com/send?phone=1234", "https://web.whatsapp.com/settings",
    "https://web.telegram.org/k/#settings", "https://web.telegram.org/k/#/search",
    "https://messenger.com/", "https://messenger.com/t/new", "https://messenger.com/t/123/search",
    "https://app.slack.com/client/T123/search", "https://app.slack.com/client/T123/settings",
    "https://teams.microsoft.com/v2/#/calendar", "https://teams.microsoft.com/l/chat/0/0?users=person",
    "https://messages.google.com/web/authentication", "https://messages.google.com/web/conversations/new",
    "https://discord.com.attacker.invalid/channels/@me/200", "https://x.com.attacker.invalid/messages/123",
    "https://user:password@x.com/messages/123", "https://x.com@attacker.invalid/messages/123",
    "http://x.com/messages/123", "https://x.com:8443/messages/123", "https://example.invalid/messages/123",
    "not a url", "about:blank",
  ];
  for (const url of rejected) assert.equal(siteForLocation(url), null, url);
});

test("서비스 경로여도 실제 대화가 없으면 일반 본문을 메신저로 취급하지 않는다", () => {
  for (const entry of cases) {
    const dom = new JSDOM(`<main><div role="log"><p>Hello</p></div><div contenteditable="true">Draft</div></main>`, { url: entry.url });
    try { assert.equal(contextForDocument(dom.window.location, dom.window.document), null, entry.id); }
    finally { dom.window.close(); }
  }
});

test("비공개 페이지 경계는 지원하지 않는 설정·로그인·작성 화면까지 포함한다", () => {
  const privatePages = [
    ["https://x.com/i/chat/compose", "x"],
    ["https://twitter.com/messages/thread/settings", "x"],
    ["https://discord.com/login", "discord"],
    ["https://ptb.discord.com/channels/@me", "discord"],
    ["https://web.whatsapp.com/send?phone=123", "whatsapp"],
    ["https://web.telegram.org/k/#settings", "telegram"],
    ["https://www.messenger.com/login", "messenger"],
    ["https://app.slack.com/client/T123/search", "slack"],
    ["https://teams.microsoft.com/v2/#/calendar", "teams"],
    ["https://messages.google.com/web/authentication", "google-messages"],
  ];
  for (const [url, id] of privatePages) {
    assert.equal(privateSiteForLocation(url)?.id, id, url);
    assert.equal(siteForLocation(url), null, url);
    const entry = cases.find((item) => item.id === id);
    const dom = fixture({ ...entry, url });
    try { assert.equal(contextForDocument(dom.window.location, dom.window.document), null, url); }
    finally { dom.window.close(); }
  }
  for (const entry of cases) assert.equal(privateSiteForLocation(entry.url)?.id, entry.id);
  for (const url of [
    "https://x.com/home", "https://x.com/messages-anywhere", "https://x.com/i/chatty/123",
    "https://www.takaratomy.co.jp/", "https://discord.com.attacker.invalid/login",
    "https://user:password@discord.com/login", "https://discord.com:8443/login",
    "http://discord.com/login", "about:blank", "not a url",
  ]) assert.equal(privateSiteForLocation(url), null, url);
});

test("X 공개 피드의 DM 서랍은 공개 게시물과 분리한다", () => {
  const dom = new JSDOM(`<main><div data-testid="tweetText" id="public-post">Public post.</div></main><aside data-testid="DMDrawer"><div data-testid="DmActivityViewport"><div data-testid="messageEntry"><span dir="auto" id="private-body">A neutral message.</span></div></div></aside>`, { url: "https://x.com/home", pretendToBeVisual: true });
  try {
    const { document, location } = dom.window;
    assert.equal(siteForLocation(location), null);
    const context = contextForDocument(location, document);
    assert.equal(context?.id, "x");
    assert.deepEqual(selectMessageBlocks(context).map((element) => element.id), ["private-body"]);
    assert.equal(isEligibleMessageBlock(document.querySelector("#public-post"), context), false);
    document.querySelector('[data-testid="DMDrawer"]').hidden = true;
    assert.equal(contextForDocument(location, document), null);
    document.querySelector('[data-testid="DMDrawer"]').hidden = false;
    document.querySelector('[data-testid="DMDrawer"]').removeAttribute("data-testid");
    assert.equal(contextForDocument(location, document), null);
  } finally { dom.window.close(); }
});

test("숨김·접힌·비활성 대화와 입력 영역은 본문 선택자를 복제해도 제외한다", () => {
  const entry = cases.find((item) => item.id === "discord");
  const dom = fixture(entry);
  try {
    const { document, location } = dom.window;
    const context = contextForDocument(location, document);
    for (const wrap of [
      `<div hidden>`, `<div aria-hidden="true">`, `<div inert>`, `<div style="display:none">`,
      `<div style="visibility:hidden">`, `<div style="opacity:0">`, `<div contenteditable="plaintext-only">`,
      `<div role="textbox">`, `<div role="search">`, `<div data-testid="search-results">`,
      `<div data-testid="message-reactions">`, `<div data-testid="message-attachment">`,
      `<div class="username">`,
    ]) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = `${wrap}<div id="message-content-private">Must stay unchanged.</div></div>`;
      context.root.append(wrapper);
      assert.equal(isEligibleMessageBlock(wrapper.querySelector('[id^="message-content-"]'), context), false, wrap);
      wrapper.remove();
    }
    const details = document.createElement("details");
    details.innerHTML = `<summary>Closed</summary><div id="message-content-closed">Hidden message.</div>`;
    context.root.append(details);
    assert.equal(isEligibleMessageBlock(details.lastElementChild, context), false);
    context.root.setAttribute("aria-hidden", "true");
    assert.equal(contextForDocument(location, document), null);
    assert.deepEqual(selectMessageBlocks(context), []);
  } finally { dom.window.close(); }
});

test("본문 내부 시간·작성자·반응·입력은 excludes로 보호한다", () => {
  const entry = cases.find((item) => item.id === "telegram" && item.url.includes("/k/"));
  const dom = fixture(entry);
  try {
    const context = contextForDocument(dom.window.location, dom.window.document);
    const selectors = context.excludes.join(",");
    assert.equal(dom.window.document.querySelector(".time").matches(selectors), true);
    assert.equal(dom.window.document.querySelector(".reactions-element").matches(selectors), true);
    assert.equal(dom.window.document.querySelector("textarea").matches(selectors), true);
    assert.equal(dom.window.document.querySelector(".peer-title").matches(selectors), true);
  } finally { dom.window.close(); }
});

test("동일 주소의 대화 전환을 DOM 객체로 구분하고 새 메시지 추가는 같은 대화로 유지한다", () => {
  const entry = cases.find((item) => item.id === "whatsapp");
  const dom = fixture(entry);
  try {
    const { document, location } = dom.window;
    const first = contextForDocument(location, document);
    const next = document.createElement("div");
    next.className = "message-in";
    next.innerHTML = `<span class="selectable-text">A new neutral message.</span>`;
    first.root.append(next);
    const appended = contextForDocument(location, document);
    assert.deepEqual(appended.identityNodes, first.identityNodes);
    const replacement = first.root.cloneNode(true);
    first.root.replaceWith(replacement);
    const replaced = contextForDocument(location, document);
    assert.equal(replaced.routeKey, first.routeKey);
    assert.notEqual(replaced.identityNodes[0], first.identityNodes[0]);
    replaced.root.replaceChildren(next);
    const switched = contextForDocument(location, document);
    assert.equal(switched.identityNodes[0], replaced.identityNodes[0]);
    assert.notEqual(switched.identityNodes[1], replaced.identityNodes[1]);
    switched.root.replaceChildren();
    assert.equal(contextForDocument(location, document), null);
  } finally { dom.window.close(); }
});

test("분류와 context 탐색은 메시지 본문·이름·입력값 getter를 읽지 않는다", () => {
  for (const entry of cases) {
    const dom = fixture(entry);
    try {
      const fail = () => { throw new Error("Private content was read before consent"); };
      Object.defineProperty(dom.window.Node.prototype, "textContent", { get: fail, configurable: true });
      Object.defineProperty(dom.window.HTMLElement.prototype, "innerText", { get: fail, configurable: true });
      Object.defineProperty(dom.window.HTMLInputElement.prototype, "value", { get: fail, configurable: true });
      const context = contextForDocument(dom.window.location, dom.window.document);
      assert.equal(context?.id, entry.id);
      assert.equal(selectMessageBlocks(context).length, 2);
    } finally { dom.window.close(); }
  }
});

test("같은 본문에 중첩된 선택자는 중복 블록을 만들지 않는다", () => {
  const dom = new JSDOM(`<div role="main"><div data-scope="messages_table"><div dir="auto" id="outer"><span dir="auto" id="inner">A neutral message.</span></div></div></div>`, { url: "https://messenger.com/t/123" });
  try {
    const context = contextForDocument(dom.window.location, dom.window.document);
    assert.deepEqual(selectMessageBlocks(context).map((element) => element.id), ["outer"]);
  } finally { dom.window.close(); }
});

test("인박스·검색·로그인 경로는 대화 DOM이 남아 있어도 거부한다", () => {
  const entry = cases.find((item) => item.id === "discord");
  const dom = fixture(entry);
  try {
    for (const url of ["https://discord.com/channels/@me", "https://discord.com/login", "https://discord.com/channels/@me/200/search"]) {
      assert.equal(contextForDocument(new URL(url), dom.window.document), null, url);
    }
  } finally { dom.window.close(); }
});

test("화면 밖 위치는 수집 단계가 판단하며 DOM 탐색은 레이아웃 측정을 하지 않는다", () => {
  const dom = fixture(cases[0]);
  try {
    dom.window.Element.prototype.getBoundingClientRect = () => { throw new Error("Unexpected synchronous layout"); };
    const context = contextForDocument(dom.window.location, dom.window.document);
    assert.equal(context?.id, "x");
    assert.equal(isVisibleElement(context.root), true);
    context.root.remove();
    assert.equal(isVisibleElement(context.root), false);
  } finally { dom.window.close(); }
});

test("두 대화가 동시에 표시되는 전환 중에는 현재 대화를 추측하지 않는다", () => {
  const entry = cases.find((item) => item.id === "discord");
  const dom = fixture(entry, "", entry.html.replaceAll("message-content-", "message-content-other-"));
  try {
    const { document, location } = dom.window;
    assert.equal(contextForDocument(location, document), null);
    const roots = document.querySelectorAll('[data-list-id="chat-messages"]');
    roots[1].hidden = true;
    const context = contextForDocument(location, document);
    assert.equal(context.root, roots[0]);
    assert.deepEqual(selectMessageBlocks(context).map((element) => element.id), entry.bodies);
  } finally { dom.window.close(); }
});

test("대화 식별은 첫 본문 이후 메시지들의 스타일을 반복 검사하지 않는다", () => {
  const entry = cases.find((item) => item.id === "discord");
  const dom = fixture(entry);
  try {
    const { document, location } = dom.window;
    const original = dom.window.getComputedStyle.bind(dom.window);
    dom.window.getComputedStyle = (element, ...args) => {
      assert.notEqual(element.id, "message-content-101", "Identity lookup should stop after the first message");
      return original(element, ...args);
    };
    assert.equal(contextForDocument(location, document)?.identityNodes[1].id, "message-content-100");
  } finally { dom.window.close(); }
});
