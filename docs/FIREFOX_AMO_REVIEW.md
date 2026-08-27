# Firefox AMO reviewer notes

## Distribution

- Channel: public listing (`On this site` / listed)
- Add-on ID: `web-translator@nudenyang.github.io`
- Add-on version: `0.7.5`
- Supported platform: Firefox desktop on Windows 10 and Windows 11
- Companion application: a compatible NudeNyang Windows application with the web-messenger
  opt-in setting and private, local-only translation path described below
- Reviewer download: pending publication of that compatible companion application

These notes describe unreleased development changes. The currently published `0.7.2-beta`
companion does not implement the new web-messenger setting or private translation path and must
not be used as the test download for this feature. Before submitting this revision for review,
publish the compatible companion and matching privacy documentation, then replace the pending
download entry with its actual public release URL. No new companion release is claimed here.

The add-on is not useful on its own. It sends translation requests to the separately installed
NudeNyang Windows application through Firefox Native Messaging. If the companion application is
not running or its native host is not registered, the popup reports that the Windows application
must be connected and no webpage text is translated.

Major and minor versions identify the product generation; patch versions are independent. A
matching generation alone does not establish support for the new privacy contract. The extension
must receive `webSettings.messengerEnabled: true` from the compatible companion and otherwise
keeps web-messenger reading disabled.

## Changes in 0.7.5

- Place a privacy-review action directly beside the missing-consent explanation. Turning on the
  companion setting or a site policy still does not grant browser-profile consent.
- After the user checks the notice and explicitly accepts, recheck the local companion and
  browser consent, resume only the originating conversation, and return to its tab without a
  webpage reload. Firefox's optional personal-communications permission remains mandatory.
- Pass only a tab handle and random conversation nonce to the notice page, never a conversation
  URL or message content. Do not resume a different conversation, overwrite an explicit OFF
  action, or collect messages from a hidden tab. The consent-management link alone does not start
  translation. Existing site and tab policies remain unchanged.
- Add synthetic DOM and consent-flow regressions, including X incoming/outgoing message bodies,
  excluded composers, visibility, conversation changes, and cancellation races. These tests are
  not a claim of live validation on every supported messenger.
- No additional permissions or data-processing scope are introduced by this UX revision.

## Changes in 0.7.4

- Improve extraction of public copy that mixes layout elements, line breaks, emphasis, and links,
  without translating the same inline text twice.
- Support public catalogue navigation, footer accordion headings, search-tab labels, and fixed
  card-search labels, including permitted menus revealed by CSS or visibility attributes. Public
  ShoPro anime pages also support their fixed navigation links without changing the default
  manual activation policy. Form values, account data, prices, hidden content, and editable
  content remain excluded.
- Let a new same-origin HTTP/HTTPS tab or popup inherit its opener's explicit translation on/off
  selection only when it has no selection of its own. No state is inherited across different or
  unverified origins. Sensitive-page blocks and site opt-out policies still take precedence.
- Keep page-state, settings, and toggle messages on the top frame. Prevent duplicate page runtimes
  when automatic recovery and normal script injection overlap, and preserve user toggles while
  initial state is being loaded.
- Split intrinsically oversized paragraphs at existing text-node boundaries instead of silently
  omitting them. Normal paragraphs keep the existing batching behavior.
- Add a restricted content script for visible YouTube embed titles, as described below.
- Add default-off web-messenger reading for the eight services listed below. The feature requires
  both the companion setting and explicit consent in each browser profile, and uses local AI
  only. It does not read composers or send messages.
- Keep the existing add-on identity and required `websiteContent` / `browsingActivity` declarations.
  Add optional `personalCommunications`, requested only from the consent page after an explicit
  user action. Private translations use temporary memory rather than the ordinary disk cache
  and translation history.

## Single purpose and data flow

The add-on translates visible webpage paragraphs while preserving the existing DOM layout. It
reads only eligible text nodes from explicitly supported content areas or ordinary HTTP/HTTPS pages
that the user activates. The ordinary page translator excludes input values, editable content,
private-message routes, account and payment routes, code blocks, prices, URL-like link labels, and
browser-internal pages. The separate, default-off web-messenger exception is described below. Fixed
public search labels and navigation text are allowed only in explicitly supported areas; arbitrary
forms are not translated.

The general page translator runs in the top document only. A separate bundled script runs in
`https://www.youtube.com/embed/*` and `https://www.youtube-nocookie.com/embed/*` child frames and
reads only the visible video-title text. It requests approval from the top document and shares
that page's translation state, target language, visibility checks, and transmission limit. It does
not translate independently while the parent page is disabled or blocked. Other iframe content,
channel names, player controls, video subtitles, audio, and text in images are not collected by this
script. It does not perform OCR.

Automatic recovery may reinject the restricted title script into an already-open tab's frames.
It immediately exits outside the exact allowed YouTube embed subframes before collecting DOM text
or sending a request. An existing healthy same-version controller is reused. Parent state changes
also reach existing child frames after a background worker restart; old approvals are discarded
and each child must obtain approval again. Reconnecting the same pending title does not create a
second native translation request.

Eligible text is sent through Native Messaging to the companion application on the same computer.
Ordinary webpage requests also include a page identifier made from the current protocol, hostname,
and path so that requests and translation context remain separated by page. Query strings and URL
fragments are not included. Private messenger requests instead use the opaque identifier described
below. A saved site policy contains only the hostname and the behavior selected by the user.
With a local model selected, the text remains on the device. For ordinary webpage translation, if
the user explicitly selects an external translation provider in the companion application, the
text required for translation can be sent directly to that provider under the provider's terms.
Web-messenger reading never uses that external-provider path. The project does not operate a relay
or storage server. The developer does not receive or retain webpage text, current page addresses,
browsing history, translation history, credentials, cookies, or analytics. The page identifier and
site policies are processed locally only to provide the requested translation.

The public privacy explanation is available at:

`https://github.com/NudeNyang/NudeNyang-Discord-Translator/blob/main/PRIVACY.md`

## Optional web-messenger reading

This development feature covers X DM, Discord web, WhatsApp Web, Telegram Web, Messenger, Slack,
Microsoft Teams, and Google Messages. A service name is not permission to scan the entire service:
only supported HTTPS conversation views with an unambiguously identified, currently open
conversation are eligible. Login, account, payment, unsupported private-message, and webmail pages
remain blocked. If a conversation cannot be identified safely, the extension does not fall back
to the ordinary page collector. Actual signed-in use on all eight services has not been verified;
the checks below are a review/test plan, not a claim of completed live-service testing.

The main application setting defaults to off. In addition to that setting, the user must open the
extension's privacy page, read the explanation, select its consent checkbox, and explicitly accept
for the current browser profile. Firefox's optional `personalCommunications` permission is
requested from that user action. Denying or cancelling it does not save usable consent. The
extension checks both its consent version and the currently granted Firefox permission before
private translation; removing either stops the feature. Consent is not shared through the main
application with other browsers or profiles.

After these gates pass, only message-body text currently visible in the open conversation is
eligible. The extension does not open other conversations, collect hidden history, translate
author names or contact lists, read drafts or composer values, download attachments, perform OCR,
or invoke sending controls. Message bodies can themselves contain names or other sensitive
personal information; they are not guaranteed to be anonymized or automatically redacted.

Requests carry the eligible text and necessary translation settings, a service identifier, consent
version, and an opaque temporary conversation identifier. They do not carry the real conversation
URL, its conversation ID, or a participant list to the native host. Route and DOM information used
to notice a conversation change stays within the content script. Both the extension and companion
require a supported local AI engine. Selecting an external provider, including an external
fallback, blocks this private path instead of sending the message body to that provider. Embedded
video-title translation is not enabled within this private path.

Conversation text and translations retained by the extension are kept in memory only. Changing or
closing the conversation discards those retained copies; revoking consent or disabling the feature
also clears pending private work and retained results. Late results from a previous conversation
or consent state are ignored. This does not delete messages from the website itself. An already
running native inference may need time to finish before its request-local resources are released.

The native private path uses a request-scoped memory cache and separates private translation
context from the ordinary memory/SQLite cache, translation history, and message-body logs.
The browser persists the consent record and settings, not conversation bodies or translations.
Private model requests use `cache_prompt=false`, but the shared model runtime is not a separate
isolated process. This setting does not guarantee immediate physical erasure of RAM, VRAM, or
model KV-cache contents, and these notes do not make that guarantee.

## Permission rationale

- `nativeMessaging`: communicates with the installed Windows translation engine.
- `storage`: retains extension preferences and the browser-profile consent version. It is not used
  to persist private message bodies or their translations.
- `activeTab`: reads and controls the current page from the popup and keyboard command.
- `scripting`: reinjects only the add-on's bundled content scripts when an already-open HTTP/HTTPS
  tab has lost its receiver after the add-on was installed, updated, or reloaded. It does not fetch
  or execute remote code.
- `http://*/*` and `https://*/*`: allows the user to translate ordinary webpages. Sensitive routes
  and browser-internal pages remain blocked in the ordinary collector. Only the separately gated,
  supported HTTPS conversation views can use the optional private collector.
- Required `websiteContent`: declares the visible webpage text processed for Firefox users.
- Required `browsingActivity`: declares the current page protocol, hostname, and path used locally to keep
  translation requests and context separated by page. Query strings and URL fragments are excluded.
- Optional `personalCommunications`: declares the message-body text sent outside the add-on to the
  local Windows companion for the explicitly enabled web-messenger feature. Local processing does
  not remove the need for this Firefox declaration. It is requested with
  `permissions.request({ data_collection: ["personalCommunications"] })` from the consent action,
  checked with `permissions.getAll()`, and removed or treated as revoked when the user withdraws it.

## Source and reproducible packaging

No runtime code is minified, obfuscated, transpiled, or downloaded. `popup-locales.js` and the
`extension/_locales` message files are generated from the desktop application's translation
catalog. The source archive includes the generator and its inputs, the ordinary and restricted
embed scripts, the messenger adapter and privacy controller, the consent-page assets, the
regression tests and their documentation/companion-source fixtures,
`package.json`, `package-lock.json`, and `THIRD_PARTY_NOTICES.md`. The included companion bridge
source is inspected by contract tests; it is not compiled or bundled into the XPI. This archive
does not contain the complete Windows model engine. Review of the native private-processing
implementation requires the matching companion source and release, to be made available with the
compatible companion before submission.

`jsdom 30.0.1` (MIT) is a pinned development dependency used for DOM-based regression tests. It and
its dependencies are installed by `npm ci` for development and verification, not bundled into the
submitted XPI or used as remotely loaded extension code.

Requirements:

- A Node.js version supported by jsdom 30.0.1: `^22.22.2`, `^24.15.0`, or `>=26.0.0`
- PowerShell 7 or Windows PowerShell 5.1

From the source archive root, run:

```powershell
npm ci
npm run extension:locales
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package_firefox_extension.ps1
```

The resulting package is written to
`release/browser-extension/NudeNyang-Web-Translator-Firefox-<version>.xpi`.

Validation commands:

```powershell
npm run test:extension
npx --yes web-ext lint --source-dir dist/firefox-extension --warnings-as-errors
```

## Functional test outline

The companion-download prerequisite above must be resolved before presenting this outline as a
ready-to-run submission. Use only test conversations the reviewer is authorized to access.

1. Install and run the compatible NudeNyang Windows companion application described above, not
   the currently published `0.7.2-beta` for the new messenger tests.
2. Register its Native Messaging host by running the installed executable once with
   `--register-browser-native-host`. The installer performs this automatically.
3. Install the signed XPI and open an ordinary HTTP/HTTPS page.
4. Press the quick toggle shortcut configured in the Windows app (`F4` by default), use the registered Firefox command (`Ctrl+Shift+L` by default), or use the popup switch to translate the current page.
5. Use `Restore this page to the original` in the popup and verify that the original text returns.
6. Stop the companion application and verify that the add-on reports the connection requirement
   without translating or transmitting page content.
7. With the companion running, explicitly enable or disable translation in a public page and open
   a same-origin link in a separate tab or popup. Verify inheritance only when the child has no
   explicit state. A different origin, child-specific selection, sensitive route, or site opt-out
   must not be overridden.
8. On a supported public catalogue page, reveal a navigation menu or public search panel. Verify
   that visible fixed labels translate while search input values, checkbox state, private forms,
   hidden text, and prices remain unchanged.
9. On an enabled ordinary page containing an allowed YouTube embed, verify that only its visible
   title translates. Disable the parent page or change its target language and verify that the
   embedded title follows the parent. It must also obey the parent's transmission limit; channel
   names, player controls, video subtitles, and image text must not be translated.
10. Reload the extension and return to an already-open eligible page. Verify automatic receiver
    recovery without duplicate listeners or translation work, and verify that toggles made during
    initialization retain their final state.
11. Verify that web-messenger reading is off by default. Neither the ordinary translation toggle
    nor a site auto-translation policy may bypass the main-app opt-in, browser-profile consent,
    Firefox optional permission, local-engine, and open-conversation checks. An older companion
    that lacks `webSettings.messengerEnabled` must leave the feature disabled.
12. On the privacy page, deny or cancel Firefox's permission request and verify that private
    translation remains disabled. Accept explicitly, enable the main-app setting, and select a
    local model. On each supported test conversation, verify that only visible message bodies
    translate; names, contact lists, drafts, attachments, hidden content, and send controls must
    remain untouched.
13. Switch conversations or close the conversation while a request is pending. Verify that old
    results are discarded and do not appear in the new conversation. Revoke consent either from
    the extension privacy page or Firefox's add-on controls and verify that new private requests
    stop and retained extension copies are discarded.
14. Select an external translation engine or fallback and verify that private message translation
    is blocked, with no automatic external fallback. Confirm that private bodies and translations
    do not enter the ordinary disk cache, translation history, or message-body logs. This test is
    not evidence of immediate physical model-memory erasure.
