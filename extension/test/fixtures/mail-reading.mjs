// Synthetic content only. The reading-document contract is domain independent;
// the Gmail shell maps observed metadata to it without copying any real mail.
export const MAIL_URL = "https://mail.google.com/mail/u/0/#inbox/test-thread-one";
export const MAIL_COPY = ["A neutral mail subject", "The meeting starts tomorrow.", "Read the meeting guide"];
export const MAIL_DOCUMENT = `<section role="main">
  <nav><span>private-folder-sentinel</span></nav>
  <table role="grid"><tr><td>private-inbox-sentinel</td></tr></table>
  <div class="ha"><h2 class="hP" id="mail-subject">${MAIL_COPY[0]}</h2></div>
  <div class="adn ads" data-message-id="synthetic-message-one"><div class="gs">
    <div class="gE"><span email="sender@example.invalid">private-sender-sentinel</span>
      <span email="recipient@example.invalid">private-recipient-sentinel</span></div>
    <div><div class="ii gt"><div class="a3s aiL" id="mail-body">
      <p id="mail-prose">${MAIL_COPY[1]}</p><a id="mail-link" href="https://example.invalid/guide">${MAIL_COPY[2]}</a>
      <a href="https://example.invalid/">https://example.invalid/</a>
      <a href="mailto:private@example.invalid">private@example.invalid</a>
      <p hidden>private-hidden-sentinel</p><code>private-code-sentinel</code>
      <div contenteditable="true">private-draft-sentinel</div>
    </div></div></div></div></div>
  <div contenteditable="true" role="textbox">private-composer-sentinel</div>
  <aside>private-other-mail-sentinel</aside>
</section>`;
export const GENERIC_MAIL = MAIL_DOCUMENT.replace('class="ha"', 'class="subject-container"')
  .replace('class="hP"', 'class="subject"').replace('class="a3s aiL"', 'class="message-body"');
export const GENERIC_READING_SCOPE = { roots: ['[role="main"]'], title: '.subject-container > .subject', body: '.message-body' };

// A synthetic Outlook shell, not a captured or live-verified mailbox.
// Only structural markers are modeled; no real message, account or URL is used.
export const OUTLOOK_URL = "https://outlook.live.com/mail/0/inbox/id/synthetic-message-one";
export const OUTLOOK_DOCUMENT = `<nav>private-folder-sentinel</nav>
  <div data-app-section="MessageList" role="listbox"><div role="option">private-inbox-sentinel</div></div>
  <section role="main" data-app-section="MailReadCompose">
    <div id="ConversationReadingPaneContainer">
      <div role="heading" aria-level="2" class="allowTextSelection" id="mail-subject">${MAIL_COPY[0]}</div>
      <div data-app-section="ConversationContainer">
        <div class="ms-Persona"><span>private-sender-sentinel</span></div>
        <span email="recipient@example.invalid">private-recipient-sentinel</span>
        <div role="document" id="UniqueMessageBody" class="allowTextSelection">
          <p id="mail-prose">${MAIL_COPY[1]}</p><a id="mail-link" href="https://example.invalid/guide">${MAIL_COPY[2]}</a>
          <a href="mailto:private@example.invalid">private@example.invalid</a>
          <p hidden>private-hidden-sentinel</p><code>private-code-sentinel</code>
          <div contenteditable="true">private-draft-sentinel</div>
        </div>
        <div role="document" hidden>private-collapsed-sentinel</div>
        <div role="textbox" contenteditable="true"><div role="document">private-reply-sentinel</div></div>
        <div role="listbox">private-attachment-sentinel</div>
      </div>
    </div>
  </section><aside><div role="document">private-other-mail-sentinel</div></aside>`;
