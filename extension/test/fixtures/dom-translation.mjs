// No production selector or service domain is needed to reproduce these cases.
export const PUBLIC_DOCUMENT_URL = "https://example.org/articles/fixture";

export const CSS_REVEAL_HTML = `<style>.concealed { visibility: hidden; }</style>
  <main><p id="control">Visible control text</p>
  <p id="changing" class="concealed">Delayed public text</p></main>`;

export const REUSED_TEXT_HTML = `<main><p id="control">Visible control text</p>
  <p id="changing">Original public text</p></main>`;

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
