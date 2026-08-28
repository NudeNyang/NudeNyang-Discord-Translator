// No production selector or service domain is needed to reproduce these cases.
export const PUBLIC_DOCUMENT_URL = "https://example.org/articles/fixture";

export const CSS_REVEAL_HTML = `<style>.concealed { visibility: hidden; }</style>
  <main><p id="control">Visible control text</p>
  <p id="changing" class="concealed">Delayed public text</p></main>`;

export const REUSED_TEXT_HTML = `<main><p id="control">Visible control text</p>
  <p id="changing">Original public text</p></main>`;

// A virtual list may replace a text node or rebuild a row from the same source.
// No messenger domain, selector or account is required to exercise that lifecycle.
export const VIRTUAL_LIST_HTML = `<main><p id="control">Stable list message</p>
  <p id="changing"><span>Reusable list message</span></p></main>`;

// Only semantic structure observed in public navigation and post viewers remains.
export const PUBLIC_SURFACES_HTML = `<main><p id="control">Visible control text</p></main>
  <header><div><ul><li><a id="category" href="https://catalog.example.org/browse"><p><span>Shopping categories</span></p></a></li>
    <li><a id="video-menu" href="/videos"><span><span>Latest videos</span></span></a></li></ul></div></header>
  <aside><nav><a id="sidebar-link" href="/science">Science and nature</a></nav></aside>
  <div role="menu"><a id="menu-link" role="menuitem" href="/travel">Travel guides</a></div>
  <footer><a id="footer-link" href="/help">Help and support</a></footer>
  <div role="dialog" aria-modal="true"><article role="presentation">
    <header><a id="author" rel="author" href="/alice">Alice Author</a>
      <a id="byline" href="/people/alice">Secret byline</a></header>
    <ul><div role="button"><li><a id="handle" role="link" href="/alice_42/">alice_42</a>
      <div><h1 id="caption" dir="auto">A public post caption<br>Another caption line</h1></div></li></div></ul>
    <div id="post-layout"><span>More public details</span></div>
    <form><label id="reply-label">Reply message</label><textarea>Secret input</textarea></form>
    <button id="post-action">Send reply</button><div role="button" id="post-control">Reply options</div>
  </article></div>
  <nav><a id="account-link" href="/account/summary">Secret account name</a>
    <a id="private-host-link" href="https://mail.google.com/">Secret mailbox name</a>
    <a id="url-link" href="https://example.org/">https://example.org/</a>
    <a id="mention" href="/people/alice">@alice</a><span id="nav-value">Secret account value</span>
    <form><a id="form-link" href="/browse">Secret form value</a></form>
    <a id="hidden-link" href="/hidden" hidden>Secret hidden label</a>
    <a id="editable-link" href="/edit" contenteditable="true">Secret editor text</a>
    <a id="no-translate" href="/raw" translate="no">Secret original text</a></nav>
  <div role="dialog"><p id="private-dialog">Secret unclassified dialog</p></div>
  <div role="log"><article><p id="private-log">Secret conversation</p></article></div>`;

export const PUBLIC_SURFACE_COPY = [
  ["category", "Shopping categories"], ["video-menu", "Latest videos"],
  ["sidebar-link", "Science and nature"], ["menu-link", "Travel guides"],
  ["footer-link", "Help and support"], ["post-layout", "More public details"],
  ["reply-label", "Reply message"], ["post-action", "Send reply"], ["post-control", "Reply options"],
];

export const SHORT_TEXT_HTML = `<main><p><span id="word">夢</span>
  <span id="count">3</span><span id="punctuation">...</span><span id="icon">🐱</span></p></main>`;

export const PUBLIC_NODE_CHANGES = [
  { label: "편집 영역", attribute: "contenteditable", value: "true" },
  { label: "입력 역할", attribute: "role", value: "textbox" },
  { label: "번역 금지", attribute: "translate", value: "no" },
  { label: "보호 클래스", attribute: "class", value: "notranslate" },
  { label: "비활성 영역", attribute: "inert", value: "" },
  { label: "숨긴 영역", attribute: "hidden", value: "" },
];

export const LONG_TEXT = "A long paragraph keeps its original text node. ".repeat(220);
export const FRAGMENTED_TEXT_HTML = `<main><p id="control">Visible control text</p>
  <p id="long">${LONG_TEXT}</p>
  <p id="fragmented"><span>夢</span><em>を</em><span>見</span><strong>る</strong></p></main>`;
