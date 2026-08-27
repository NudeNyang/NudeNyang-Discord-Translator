// Synthetic web Discord fixture using the channel/heading/embed selectors
// already supported by src-tauri/src/dom.rs. No account or message data.
export const DISCORD_WEB_URL = "https://discord.com/channels/100/200";
export const DISCORD_WEB = `<nav data-list-id="channels">
  <a data-list-item-id="channels___200" href="/channels/100/200">
    <div class="name__test" aria-hidden="true"><div id="channel-current">General room</div></div>
  </a>
  <a data-list-item-id="channels___201" href="/channels/100/201">
    <div aria-hidden="true"><span id="channel-other">Help desk</span></div>
  </a>
  <a data-list-item-id="channels___999" href="/channels/999/999">
    <div aria-hidden="true"><span>Another server channel</span></div>
  </a>
  <a data-list-item-id="private-channels-300" href="/channels/@me/300"><span>Private contact</span></a>
  <div data-list-item-id="channels___400" role="button"><h3><div>Category heading</div></h3></div>
</nav>
<section class="chat_test">
  <header><h1 class="title__test" id="channel-title">General room</h1><button>Channel settings</button></header>
  <ol data-list-id="chat-messages"><li id="chat-messages-200-500">
    <span class="username_test">Synthetic author</span>
    <div id="message-content-500">A neutral message.</div>
    <article class="embedFull_test embed_test">
      <span class="embedProvider_test">Example provider</span>
      <span class="embedAuthorName_test">Synthetic embed author</span>
      <a href="https://example.invalid/page" class="embedTitle_test" id="embed-title">A neutral preview title</a>
      <div class="embedDescription_test" id="embed-description">A neutral preview description.</div>
      <div class="embedFieldName_test" id="embed-field-name">A field label</div>
      <div class="embedFieldValue_test" id="embed-field-value">A field value</div>
      <div class="embedFooter_test">A provider footer</div>
      <a href="https://example.invalid/image"><img alt="Synthetic image text"></a>
    </article>
  </li></ol>
  <div contenteditable="true" role="textbox">Unsent draft</div>
</section>`;
