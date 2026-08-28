# Browser store privacy declarations

This document contains privacy answers for NudeNyang Web Translator 0.7.9 with Windows companion
0.7.3-beta, including optional web-messenger reading. The public policy source is `PRIVACY.md`.

## Submission readiness

This is the unpublished consent-v3 policy on the development branch. Do not submit the old v2 local-only listing or infer support from unchanged app/extension version numbers. Before any future review, publish matching companion builds, extension packages and privacy text together, verify capability `messengerPolicyVersion: 3`, and test consent migration. No release or submission is part of this work.

Fixture E2E is not validation of all eight logged-in services. Store approval is not guaranteed. See `MESSENGER_SHARED_POLICY.md` for the implementation and remaining review checks.

## Single purpose

### Installation and connection guidance added in 0.7.9

After repeated connection failures, the popup offers installation or recovery help without
claiming that the app is uninstalled. Explicit browser disconnection remains a separate state.
Two local preferences remember a successful connection and dismissal of the help card. They
contain no website or conversation information. Existing `storage` permission covers them.

The bundled download guide opens only on a user click. That page alone fetches
`https://raw.githubusercontent.com/NudeNyang/NudeNyang-Discord-Translator/main/updates/beta/latest.json`
without cookies, referrers, webpage addresses, text, or messages. GitHub may receive normal HTTPS
network metadata, such as the source IP. The response is data only, never executable code. The
guide displays the latest published build from that feed, including prereleases, with separate
x64 and ARM64 installer links. A further click starts the download. No new permission, analytics,
background remote polling, automatic download, or automatic installation is added. Existing
HTTP/HTTPS host access covers the feed; denied access yields a manual GitHub Releases fallback.

Connection checks use a separate short-timeout native port so long translations are not cancelled.
Popup status queries retain the existing model-preparation behavior; periodic checks use
`connectionPing` and cannot activate translation, consent, or a disabled browser connection.
See `BROWSER_STORE_SUBMISSION_0.7.9.md` for the new submission notes.

NudeNyang Web Translator uses the translation engine in the separately installed NudeNyang Windows
application to translate eligible visible text on webpages activated by the user while preserving
the existing page layout. An optional, separately consented feature translates only visible
message bodies in the currently open supported web-messenger conversation using the app-selected translator after consent v3, plus
Discord link-preview text in that conversation and visible channel names in the current server.

## Data handled

- Website content / `websiteContent`: eligible visible headings, paragraphs, lists, quotations, and
  image captions selected for translation.
- Web history / `browsingActivity`: the current page protocol, hostname, and path used to separate
  ordinary webpage translation requests and context by page and to apply a user-selected hostname
  policy. Query strings and URL fragments are excluded from these requests.
- Personal communications / `personalCommunications`: visible message bodies in the currently
  open supported conversation, including Discord preview titles, descriptions, and textual fields,
  plus visible channel names in the current Discord server, only after common web controls and
  browser-profile consent v3 permit it. DM contact lists and other servers' channels are excluded.

The extension does not read authentication tokens, cookies, input values, unsent drafts, contact
lists, or attachment contents. It does not monitor browsing history as a list or log user typing.
Account, login, payment, order, administration, and private-message surfaces remain excluded from
generic translation. The messenger feature is a narrow exception, not permission to translate
arbitrary private pages. Message bodies may themselves contain names, contact details, financial,
health, or other sensitive information. Do not describe this feature as handling no personal data
or automatically removing all such information from messages.

## Processing, consent, retention and withdrawal

### Web-messenger reading

After consent in the current browser profile, messengers follow the common web switch, current-tab control and site policy. There is no separate messenger enable switch or separate external-provider/storage toggle. Refusing consent does not prevent ordinary webpage translation. Firefox additionally requires optional `personalCommunications` permission; refusal, cancellation or revocation blocks the private path.

Consent v3 discloses the app's selected translator and shared retention/deletion policy. Earlier v1/v2 local-only, no-disk-storage consent is never upgraded automatically. The extension also requires companion capability `messengerPolicyVersion: 3`. This policy change is an unpublished development change, not a claim that the currently published builds implement it.

Supported surfaces are X DM, web Discord, WhatsApp Web, Telegram Web, Messenger, Slack, Microsoft Teams and Google Messages. Only a safely identified open conversation is read: visible message bodies and link-preview text, plus visible channel names in the current Discord server. The extension does not open other conversations, retrieve hidden history, attachments or linked pages, or translate authors, handles, contact lists, profiles, composers, drafts, send controls or code. Sensitive information present in message bodies is not automatically redacted. Generic account, payment, email and unsupported-messenger blocks remain.

The app's selected translator is shared with desktop Discord. Local models process text on the PC. Selecting ChatGPT, Claude, Gemini or DeepL permits the necessary conversation text to be sent to that provider, including its configured fallback path, under the provider's policies. Requests to the local companion use a random conversation identifier, not a real conversation URL, ID or participant list. Private-browsing state comes from browser-owned tab metadata.

In regular windows the app reuses its shared translation cache. Source text, translations and saved outgoing message bodies are encrypted using Windows user-scoped DPAPI before SQLite storage. Existing plaintext bodies are migrated without discarding their retention timestamps. Metadata such as settings, languages and cache indexes is not whole-database encrypted. This protection does not prevent access by software running as the same Windows user or access to live process memory.

App retention is 30 days by default, with 7/30/90/180-day or unlimited options. Unlimited does not mean storage is disabled. The existing history-deletion action clears this cache. Changing conversations, disabling translation or withdrawing consent does not delete previously stored cache entries. Provider and subscription-CLI records are governed separately and cannot be deleted through the app cache controls.

Private-browsing requests never read or write the app's disk cache and use request-scoped memory. Only local models and DeepL are allowed there because subscription CLI local-content records cannot be controlled. Regular-window messenger translation has no such provider restriction.

The extension persists settings and consent, not message bodies. It discards its current-conversation memory copies on navigation, closure or revocation, blocks new collection and requests, and ignores late responses for an old conversation or revoked consent. Requests already sent externally may not be retractable. This does not delete the messenger service's original messages or server records, or guarantee physical erasure of RAM, VRAM or OS-managed copies. App diagnostics do not record conversation bodies.

### Shared browser connection controls

Browser-specific Disconnect remains separate from consent withdrawal. It blocks requests and pending results for that browser kind without uninstalling the extension, removing browser permissions or affecting other browser kinds or desktop Discord. Connection checks do not reactivate a disabled browser.

The consent page is prominent and bundled with the extension. Accepting it stores v3 only from that extension-owned page and, on Firefox, only after the browser grants personalCommunications. A decline leaves ordinary web translation available. There is no separate main-app messenger switch. A supported originating tab may resume only after rechecking the current conversation nonce, current consent and ordinary translation controls. Hidden tabs do not collect bodies.

The developer operates no relay, analytics or content-storage server and does not receive, sell, use for advertising, or allow human access to user conversations. External transfers only support the disclosed translation chosen by the user.

## Chrome Web Store privacy form

- Single purpose: use the text under **Single purpose**.
- Data types for this change: select **Website content**, **Web history**, and **Personal
  communications**. Optional use still needs disclosure; local processing is not a reason to
  omit the communication category. Review the form against the final data-handling scope rather
  than claiming that messages cannot contain other sensitive information.
- Remote code: No.
- Data sale or transfer: No sale. Transfers are limited to the same-computer companion for
  translation and eligible text sent to the provider selected by the user, including consented
  messenger translation. Provider/CLI retention is disclosed separately.
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
- `alarms`: Periodically checks the same-computer companion connection and reconnects after a
  browser restart. This connection-only request contains no webpage text or address, does not
  initialize a translation model, and does not grant messenger consent or open a tab.
- `http://*/*` and `https://*/*`: Allows eligible visible text to be translated on ordinary
  webpages after the user activates translation or saves an automatic site policy. Browser-internal
  pages and generic sensitive routes remain blocked. Supported messenger conversations have a
  separate HTTPS-only path gated by common web controls, current browser-profile consent and companion capability;
  this does not permit reading composers, attachments, or arbitrary private pages.

Chrome and Whale now explicitly declare these same origins in `host_permissions`, as Firefox
already does. Programmatic recovery of an old tab requires this host access; static content-script
matches alone do not grant it. This removes reliance on the popup's temporary `activeTab` grant.
User-restricted site access is still respected, and no additional URL scheme or text category is added.

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
extension also rechecks current consent, common web controls and companion policy before forwarding a request.
The browser grant does not replace current disclosure acceptance; app settings do not grant browser consent. Same-device Native Messaging still crosses the extension/browser boundary and is
described in the notice. See [Firefox's built-in data-consent documentation](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

## Naver Whale Store disclosure

Use the same single-purpose, data-handling, permission, and privacy-policy statements above,
including optional personal-communications processing, selected external providers and encrypted local retention.
The extension itself contains no adult content. Store screenshots and descriptions should
demonstrate the general webpage translation workflow with neutral content. Do not use private
conversations, names, or account information in submission screenshots.
