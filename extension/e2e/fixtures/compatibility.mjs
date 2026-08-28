// Contract fixtures for already-supported structures. The URLs choose an adapter;
// the E2E harness serves these synthetic documents without contacting the sites.
// They are not archived pages or evidence of signed-in live-site verification.
import { X_CHAT, X_CHAT_URL } from "../../test/fixtures/x-chat.mjs";
import { DISCORD_WEB, DISCORD_WEB_URL } from "../../test/fixtures/discord-web.mjs";

const publicCopy = `<span id="public-copy">A neutral public passage.</span>
  <a id="plain-link" href="https://example.invalid/reference">https://example.invalid/reference</a>
  <a id="word-link" href="/reference/">Reference details</a>
  <code id="inline-code">synthetic_code()</code><span id="notranslate" translate="no">Keep these words</span>`;

const publicGuards = `<form><p id="private-form">An unsent private form.</p>
  <input id="private-input" value="Synthetic private input"></form>
  <div id="editor" contenteditable="true">Synthetic editable text</div>
  <p id="hidden-copy" hidden>A hidden passage.</p><p id="price" itemprop="price">USD 42.00</p>
  <pre id="code-block">const synthetic = true;</pre>`;

export const PUBLIC_GUARDS = [
  ["#plain-link", "https://example.invalid/reference"], ["#inline-code", "synthetic_code()"],
  ["#notranslate", "Keep these words"], ["#private-form", "An unsent private form."],
  ["#editor", "Synthetic editable text"], ["#hidden-copy", "A hidden passage."],
  ["#price", "USD 42.00"], ["#code-block", "const synthetic = true;"],
];

function publicFixture(entry) {
  return {
    ...entry,
    copies: [["#public-copy", "A neutral public passage."], ["#word-link", "Reference details"], ...(entry.copies ?? [])],
    guards: [...PUBLIC_GUARDS, ...(entry.guards ?? [])],
    html: `${entry.html}${publicGuards}<script>
      // Install an ordinary page listener before document_idle injection. Replacing
      // its parent innerHTML would lose this listener and the saved DOM identity.
      globalThis.fixtureNodes = new Map([...document.querySelectorAll('[id]')].map((element) => [element.id, element]));
      document.getElementById('word-link').addEventListener('click', (event) => {
        event.preventDefault();
        event.currentTarget.dataset.clicks = String(Number(event.currentTarget.dataset.clicks || 0) + 1);
      });
    </script>`,
  };
}

export const PUBLIC_CASES = [
  {
    id: "generic", url: "https://fixture.example.test/article/",
    html: `<main><div>${publicCopy}</div><h2 id="heading">An ordinary heading</h2></main>`,
    copies: [["#heading", "An ordinary heading"]],
  },
  {
    id: "x", url: "https://x.com/reviewer/status/123",
    html: `<main><article role="button"><div data-testid="UserName" id="nickname">Example Author @synthetic</div>
      <div data-testid="tweetText">${publicCopy}<a href="/hashtag/synthetic" id="hashtag">#synthetic</a></div>
      <div role="link"><span dir="auto" id="preview-title">A public article preview</span></div></article>
      <div data-testid="UserDescription" id="biography">A public profile description.</div></main>
      <div role="dialog"><article><div data-testid="UserName" id="photo-nickname">Synthetic Photo Author</div>
      <div data-testid="tweetText" id="photo-copy">A public photo caption.</div></article>
      <div data-testid="twitterArticleReadView"><h2 data-testid="twitter-article-title" id="long-title">A long article title</h2>
      <section data-block="true" id="long-copy">A long article paragraph.</section></div>
      <p id="dialog-copy">An unrelated dialog message.</p>
      <div data-testid="tweetTextarea_0" contenteditable="true" id="x-composer">An unsent post.</div></div>`,
    copies: [["#preview-title", "A public article preview"], ["#biography", "A public profile description."],
      ["#photo-copy", "A public photo caption."], ["#long-title", "A long article title"], ["#long-copy", "A long article paragraph."]],
    guards: [["#nickname", "Example Author @synthetic"], ["#hashtag", "#synthetic"], ["#photo-nickname", "Synthetic Photo Author"],
      ["#dialog-copy", "An unrelated dialog message."], ["#x-composer", "An unsent post."]],
  },
  {
    id: "github", url: "https://github.com/example/project/issues/1",
    html: `<main><article class="markdown-body"><p>${publicCopy}</p>
      <ul><li id="issue-list">A documented issue detail.</li></ul>
      <div class="react-code-text" id="source-code">const repositorySource = true;</div></article></main>`,
    copies: [["#issue-list", "A documented issue detail."]],
    guards: [["#source-code", "const repositorySource = true;"]],
  },
  {
    id: "google", url: "https://www.google.com/search?q=synthetic",
    html: `<main id="search"><h3>${publicCopy}</h3><div data-sncf="1" id="snippet">A public result snippet.</div></main>
      <form role="search"><textarea id="search-query">An unsubmitted query.</textarea></form>`,
    copies: [["#snippet", "A public result snippet."]], guards: [["#search-query", "An unsubmitted query."]],
  },
  {
    id: "youtube", url: "https://www.youtube.com/watch?v=synthetic",
    html: `<ytd-watch-metadata><h1>${publicCopy}</h1><span id="channel-name">Synthetic Channel</span></ytd-watch-metadata>
      <ytd-comment-thread-renderer><span id="author-text">Synthetic Commenter</span>
      <div id="content-text">A public comment body.</div></ytd-comment-thread-renderer>
      <ytd-text-inline-expander><div id="plain-snippet-text">A video description.</div></ytd-text-inline-expander>`,
    copies: [["#content-text", "A public comment body."], ["#plain-snippet-text", "A video description."]],
    guards: [["#channel-name", "Synthetic Channel"], ["#author-text", "Synthetic Commenter"]],
  },
  {
    id: "booth", url: "https://synthetic.booth.pm/items/12345",
    html: `<main><div class="description"><span class="autolink">${publicCopy}</span></div></main>
      <nav class="js-accordion-content"><a class="no-underline" href="https://booth.pm/announcements/" id="catalogue">Public catalogue information</a></nav>
      <div class="item-order"><p id="order-data">Synthetic order details.</p></div>`,
    copies: [["#catalogue", "Public catalogue information"]], guards: [["#order-data", "Synthetic order details."]],
  },
  {
    id: "dlsite", url: "https://www.dlsite.com/home/work/=/product_id/RJ123456.html",
    html: `<header id="header"><a id="catalogue" href="/home/works/">Public catalogue information</a>
      <a id="account-link" href="/home/mypage/">Synthetic account details</a></header>
      <main><div>${publicCopy}</div></main>`,
    copies: [["#catalogue", "Public catalogue information"]], guards: [["#account-link", "Synthetic account details"]],
  },
  {
    id: "dlsite-report", url: "https://www.dlsite.com/home/circle/report/=/report_id/123.html",
    html: `<article class="circle_report"><div class="work_name">${publicCopy}</div>
      <section class="report_section"><div class="content" id="report-copy">A public creator report.</div></section></article>`,
    copies: [["#report-copy", "A public creator report."]],
  },
  {
    id: "eisys", url: "https://www.eisys.co.jp/company/",
    html: `<nav class="header_navi"><a href="https://www.eisys.co.jp/company/" id="catalogue">Public company information</a></nav>
      <main><div>${publicCopy}</div></main>
      <footer class="l-footer"><div class="footer_sitemap"><a href="/service/" id="sitemap">Service information</a></div></footer>`,
    copies: [["#catalogue", "Public company information"], ["#sitemap", "Service information"]],
  },
  {
    id: "takaratomy", url: "https://dm.takaratomy.co.jp/product/synthetic/",
    html: `<header class="l-header"><a href="/company/" id="catalogue">Public company information</a></header>
      <main><div>${publicCopy}</div></main>
      <form id="search_cond"><label for="public-query" id="search-label">Card name</label>
      <input id="public-query" value="Synthetic search input"><button type="button" id="search-action">Reset search</button></form>
      <div class="c-tab-group"><div class="c-tab-buttons"><button role="tab" aria-selected="true" id="search-tab">Product category</button></div></div>
      <footer class="l-footer"><button class="l-footer-sitemap__trigger" aria-expanded="false" id="sitemap">Product information</button></footer>`,
    copies: [["#catalogue", "Public company information"], ["#search-label", "Card name"], ["#search-action", "Reset search"],
      ["#search-tab", "Product category"], ["#sitemap", "Product information"]],
  },
  {
    id: "shopro-anime", url: "https://www.shopro.co.jp/anime/synthetic/",
    html: `<header><div class="headerWrap"><div class="menu"><ul>
      <li><a href="news/" id="catalogue">Latest public news</a></li><li><a href="#story" id="story">Story information</a></li>
      </ul></div></div></header><main><p>${publicCopy}</p></main>`,
    copies: [["#catalogue", "Latest public news"], ["#story", "Story information"]],
  },
].map(publicFixture);

const first = "A neutral first message.";
const second = "A neutral reply.";
const commonBodies = [["#body-one", first], ["#body-two", second]];
const privateGuards = `<aside><span id="contact-preview">Synthetic contact and preview</span></aside>
  <textarea id="unsent-draft">An unsent synthetic draft.</textarea>`;

function privateFixture(entry) {
  return {
    ...entry,
    copies: entry.copies ?? commonBodies,
    guards: [["#contact-preview", "Synthetic contact and preview"], ["#unsent-draft", "An unsent synthetic draft."], ...(entry.guards ?? [])],
    html: `${entry.html}${privateGuards}`,
  };
}

// Other messenger structures match the existing synthetic cases in
// test/messenger-adapters.test.mjs. X and Discord reuse their shared fixtures.
export const MESSENGER_CASES = [
  {
    id: "x", variant: "current", url: X_CHAT_URL, html: X_CHAT,
    copies: [["#body-one", "A neutral incoming message."], ["#body-two", "A neutral outgoing message."]],
    guards: [['[data-testid="dm-inbox-panel"]', "Synthetic contact and preview"], ['[role="textbox"]', "Unsent synthetic draft"]],
  },
  {
    id: "x", variant: "legacy", url: "https://x.com/messages/101-202",
    html: `<div data-testid="DmActivityViewport"><div data-testid="messageEntry"><span data-testid="messageSender" id="sender">Example Sender</span>
      <span dir="auto" id="body-one">${first}</span><time>12:01</time></div>
      <button data-testid="messageEntry"><span dir="auto" id="body-two">${second}</span></button></div>`,
    guards: [["#sender", "Example Sender"]],
  },
  {
    id: "discord", variant: "server", url: DISCORD_WEB_URL, html: DISCORD_WEB,
    copies: [["#channel-current", "General room"], ["#channel-other", "Help desk"], ["#channel-title", "General room"],
      ["#message-content-500", "A neutral message."], ["#embed-title", "A neutral preview title"],
      ["#embed-description", "A neutral preview description."], ["#embed-field-name", "A field label"], ["#embed-field-value", "A field value"]],
    guards: [[".username_test", "Synthetic author"], [".embedProvider_test", "Example provider"],
      [".embedAuthorName_test", "Synthetic embed author"], [".embedFooter_test", "A provider footer"],
      ['[data-list-item-id="channels___999"]', "Another server channel"], ['[data-list-item-id="private-channels-300"]', "Private contact"]],
  },
  {
    id: "discord", variant: "direct", url: "https://discord.com/channels/@me/200",
    html: `<ol data-list-id="chat-messages"><li><h3><span class="username" id="sender">Example Sender</span></h3>
      <div id="message-content-100">${first}</div><time>12:01</time></li><li><div id="message-content-101">${second}</div></li></ol>`,
    copies: [["#message-content-100", first], ["#message-content-101", second]], guards: [["#sender", "Example Sender"]],
  },
  {
    id: "whatsapp", url: "https://web.whatsapp.com/",
    html: `<div id="main"><header id="sender">Example Sender</header><div data-testid="conversation-panel-messages">
      <div class="message-in"><div data-pre-plain-text="Example Sender"><span class="selectable-text" id="body-one">${first}</span></div></div>
      <div class="message-out"><span class="selectable-text" id="body-two">${second}</span></div></div>
      <footer><div contenteditable="true" id="composer">A private unsent draft.</div></footer></div>`,
    guards: [["#sender", "Example Sender"], ["#composer", "A private unsent draft."]],
  },
  {
    id: "telegram", variant: "k", url: "https://web.telegram.org/k/#12345",
    html: `<div class="chat"><div class="chat-info"><span class="peer-title" id="sender">Example Sender</span></div><div class="bubbles-inner">
      <div class="bubble"><div class="message"><span id="body-one">${first}</span><span class="time" id="timestamp">12:01</span></div></div>
      <div class="bubble"><div class="message"><span id="body-two">${second}</span><div class="reactions-element" id="reaction">Like</div></div></div>
      <div class="bubble service"><div class="message" id="system-message">A member joined.</div></div></div></div>`,
    guards: [["#sender", "Example Sender"], ["#timestamp", "12:01"], ["#reaction", "Like"], ["#system-message", "A member joined."]],
  },
  {
    id: "telegram", variant: "a", url: "https://web.telegram.org/a/#12345",
    html: `<div id="MiddleColumn"><div class="MiddleHeader" id="sender">Example Sender</div><div class="MessageList">
      <div class="Message"><div class="text-content"><span id="body-one">${first}</span><span class="MessageMeta" id="timestamp">12:01</span></div></div>
      <div class="Message"><div class="text-content" id="body-two">${second}</div></div>
      <div class="Message ActionMessage"><div class="text-content" id="system-message">A member joined.</div></div></div></div>`,
    guards: [["#sender", "Example Sender"], ["#timestamp", "12:01"], ["#system-message", "A member joined."]],
  },
  {
    id: "messenger", url: "https://www.messenger.com/e2ee/t/12345/",
    html: `<div role="main"><header id="sender">Example Sender</header><div data-scope="messages_table">
      <div><a href="https://www.facebook.com/example"><span dir="auto" id="profile-name">Example Sender</span></a>
      <div dir="auto" id="body-one">${first}</div><time>12:01</time></div><div><span dir="auto" id="body-two">${second}</span>
      <div role="button"><span dir="auto" id="reply-control">Reply</span></div></div></div></div>`,
    guards: [["#sender", "Example Sender"], ["#profile-name", "Example Sender"], ["#reply-control", "Reply"]],
  },
  {
    id: "slack", url: "https://app.slack.com/client/T123/C456",
    html: `<div data-qa="message_pane"><div data-qa="message_list"><div class="c-message_kit__message">
      <span class="c-message__sender" id="sender">Example Sender</span><div class="c-message_kit__blocks"><div class="p-rich_text_block" id="body-one">${first}</div></div></div>
      <div class="c-message_kit__message"><div class="c-message_kit__blocks"><div class="p-rich_text_block" id="body-two">${second}</div></div></div></div></div>`,
    guards: [["#sender", "Example Sender"]],
  },
  {
    id: "teams", url: "https://teams.microsoft.com/v2/",
    html: `<div id="chat-pane-list"><div id="message-body-100"><span data-tid="message-author-name" id="sender">Example Sender</span>
      <div id="content-100">${first}</div><time>12:01</time></div><div id="message-body-101"><div id="content-101">${second}</div></div></div>`,
    copies: [["#content-100", first], ["#content-101", second]], guards: [["#sender", "Example Sender"]],
  },
  {
    id: "google-messages", url: "https://messages.google.com/web/conversations/100",
    html: `<mws-conversation-container><mws-conversation-header id="sender">Example Sender</mws-conversation-header><mws-messages-list>
      <mws-message-wrapper><mws-text-message-part id="body-one">${first}</mws-text-message-part><mws-message-timestamp id="timestamp">12:01</mws-message-timestamp></mws-message-wrapper>
      <mws-message-wrapper><mws-text-message-part id="body-two">${second}</mws-text-message-part></mws-message-wrapper>
      </mws-messages-list></mws-conversation-container>`,
    guards: [["#sender", "Example Sender"], ["#timestamp", "12:01"]],
  },
].map(privateFixture);
