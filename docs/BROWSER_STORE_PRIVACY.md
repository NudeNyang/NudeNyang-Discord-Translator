# Browser store privacy declarations

This document contains draft privacy answers for the current NudeNyang Web Translator development
change, including optional web-messenger reading. The public policy source is `PRIVACY.md`.

## Submission readiness

The messenger feature has not been publicly released. The published Windows companion
`0.7.2-beta` does not implement its setting or private-message processing path and must not be
presented as a working reviewer download for this feature. Before submission, publish a compatible
companion, update the reviewer download link in the submission materials, and publish the matching
privacy policy. This document does not assert that a new companion version or download already
exists. Logged-in, real-account validation of all eight messenger services has not been completed;
fixture tests are not a substitute for that validation.

## Single purpose

NudeNyang Web Translator uses the translation engine in the separately installed NudeNyang Windows
application to translate eligible visible text on webpages activated by the user while preserving
the existing page layout. An optional, separately consented feature translates only visible
message bodies in the currently open supported web-messenger conversation using local AI, plus
Discord link-preview text in that conversation and visible channel names in the current server.

## Data handled

- Website content / `websiteContent`: eligible visible headings, paragraphs, lists, quotations, and
  image captions selected for translation.
- Web history / `browsingActivity`: the current page protocol, hostname, and path used to separate
  ordinary webpage translation requests and context by page and to apply a user-selected hostname
  policy. Query strings and URL fragments are excluded from these requests.
- Personal communications / `personalCommunications`: visible message bodies in the currently
  open supported conversation, including Discord preview titles, descriptions, and textual fields,
  plus visible channel names in the current Discord server, only after the app setting and
  browser-profile consent permit it. DM contact lists and other servers' channels are excluded.

The extension does not read authentication tokens, cookies, input values, unsent drafts, contact
lists, or attachment contents. It does not monitor browsing history as a list or log user typing.
Account, login, payment, order, administration, and private-message surfaces remain excluded from
generic translation. The messenger feature is a narrow exception, not permission to translate
arbitrary private pages. Message bodies may themselves contain names, contact details, financial,
health, or other sensitive information. Do not describe this feature as handling no personal data
or automatically removing all such information from messages.

## Processing and transmission

Ordinary eligible webpage text and its page identifier are sent through Native Messaging to the
NudeNyang Windows application on the same computer. With a local model, they remain on the device.
If the user explicitly selects an external translation provider in the Windows application, only
ordinary eligible text required for translation can be sent directly to that provider under its
terms. The page identifier is not sent to the external translation provider.

Web-messenger reading is off by default and requires the app's `web_messenger_enabled` setting,
explicit consent in the current browser profile, an enabled translation state, and a local Hy-MT2
or TranslateGemma model. The app setting alone is not consent. Consent is not shared between
browser profiles. The feature covers X DM, web Discord, WhatsApp Web, Telegram Web, Messenger,
Slack, Microsoft Teams, and Google Messages only where the current visible conversation is safely
identified. No background opening of other conversations is performed.

All eligible messenger text, including Discord channel names and link previews, goes only to the same-computer companion. Their request includes translation
settings, service identifier, consent version, and a random temporary conversation identifier;
it does not use the real conversation URL, conversation ID, or participants as that identifier.
Route information used for conversation-change detection stays within the extension. Author
names, contact lists, profiles, composers, drafts, send actions, attachments, and media are not
translation targets. Selecting an external provider blocks messenger translation, including
external fallback paths. It does not authorize sending the conversation to that provider.

## Consent experience

If browser-profile consent is missing, the popup places a privacy-review action immediately below
the explanation. This opens the bundled notice; it does not grant consent. The user must check
the acknowledgement and explicitly accept, including Firefox's optional permission prompt. Only
then may the extension resume the originating conversation and return to its tab without a
reload, after rechecking the app setting, local model, and browser consent. The handoff uses a
tab handle and random conversation nonce, not a real conversation URL or message body. A changed
conversation, revoked consent, or explicit OFF action cancels the pending start. Hidden tabs do
not collect message bodies. The standalone consent-management link has no automatic-start action.

Consent version 2 discloses the added Discord channel names and link-preview text. A previous
version-1 message-only grant does not authorize this scope; it is not automatically upgraded.
The user must explicitly accept the updated notice. No linked pages are fetched and no image
text is read. No additional browser permission category is introduced.

## Messenger retention and withdrawal

The extension holds eligible messenger text and translations only in memory for the current
conversation, including the added Discord channel names and link-preview text.
It discards its copies when the conversation changes or ends, or consent is revoked. The companion
uses a request-scoped in-memory translation cache and context separated from ordinary caches.
Private bodies and translations are not written to disk caches, translation history, or body logs.
Browser storage retains the consent version and preferences, not message bodies. Disabling the
app setting also stops new work; results belonging to an old conversation or revoked consent are
not applied. This does not delete messages from the messenger service.

An already running inference may take time to finish and release its data. `cache_prompt=false`
restricts model prompt-cache reuse, but the model runtime is shared with other translations. It
does not provide a dedicated isolated model process or guarantee immediate physical erasure of
RAM, VRAM, model KV caches, or copies managed by the operating system or runtime.

The project does not operate a relay, analytics, or storage server. The developer does not receive
or retain webpage text, page addresses, browsing history, credentials, cookies, or translation
history. Data is not sold or used for advertising, tracking, analytics, credit assessment, or any
purpose unrelated to the user-requested translation. No person acting for the developer can read
the data.

## Chrome Web Store privacy form

- Single purpose: use the text under **Single purpose**.
- Data types for this change: select **Website content**, **Web history**, and **Personal
  communications**. Optional use still needs disclosure; local processing is not a reason to
  omit the communication category. Review the form against the final data-handling scope rather
  than claiming that messages cannot contain other sensitive information.
- Remote code: No.
- Data sale or transfer: No sale. Transfers are limited to the same-computer companion for
  translation and, for ordinary translation only, eligible text sent directly to a provider
  selected by the user for that purpose. Messenger bodies never use an external provider.
- Advertising, credit assessment, and unrelated use: No.
- Privacy policy URL:
  `https://github.com/NudeNyang/NudeNyang-Discord-Translator/blob/main/PRIVACY.md`

The public policy, data-type selections, and purpose/permission explanations must describe the
same behavior. See [Chrome's privacy-practices form guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy).

### Permission justification

- `nativeMessaging`: Communicates with the separately installed NudeNyang Windows translation
  engine on the same computer.
- `storage`: Stores extension preferences, the browser-profile messenger consent version, and the
  explicit translation state for the current browser tab. The tab state is removed when the tab
  closes. Conversation bodies and their translations are not stored here.
- `activeTab`: Lets the popup and keyboard command control translation in the active tab.
- `scripting`: Reconnects the extension's bundled content scripts to an already-open HTTP/HTTPS
  tab after an extension install, update, or reload invalidates the old script. Injection occurs only
  when the bundled receiver is missing; no remote code is executed.
- `http://*/*` and `https://*/*`: Allows eligible visible text to be translated on ordinary
  webpages after the user activates translation or saves an automatic site policy. Browser-internal
  pages and generic sensitive routes remain blocked. Supported messenger conversations have a
  separate HTTPS-only, local-AI-only path gated by the app setting and browser-profile consent;
  this does not permit reading composers, attachments, or arbitrary private pages.

## Firefox AMO manifest declarations

- Required data types: `websiteContent`, `browsingActivity`.
- Optional data type: `personalCommunications`. Do not move it into `required` or silently grant it
  with the main app setting.
- Supported platform: Firefox desktop on Windows only.
- Distribution channel: public AMO listing (`On this site`).
- Firefox for Android: not supported because the Windows Native Messaging companion is required.

The consent page calls `permissions.request({ data_collection: ["personalCommunications"] })`
from the user's affirmative action. It stores consent only when permission is granted. Refusal,
cancellation, or subsequent permission removal prevents the private path from operating. The
extension also rechecks its own consent and local-model/app settings before forwarding a request.
The browser grant does not replace the app setting, and the app setting does not replace the
browser grant. Same-device Native Messaging still crosses the extension/browser boundary and is
described in the notice. See [Firefox's built-in data-consent documentation](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

## Naver Whale Store disclosure

Use the same single-purpose, data-handling, permission, and privacy-policy statements above,
including the optional personal-communications processing and its local-only retention limits.
The extension itself contains no adult content. Store screenshots and descriptions should
demonstrate the general webpage translation workflow with neutral content. Do not use private
conversations, names, or account information in submission screenshots.
