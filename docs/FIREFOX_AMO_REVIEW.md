# Firefox AMO reviewer notes

## Distribution

- Channel: public listing (`On this site` / listed)
- Add-on ID: `web-translator@nudenyang.github.io`
- Add-on version: `0.7.9`
- Supported platform: Firefox desktop on Windows 10 and Windows 11
- Companion application: NudeNyang Windows 0.7.3-beta with the web-messenger opt-in setting
  and private, local-only translation path described below
- Reviewer download: https://github.com/NudeNyang/NudeNyang-Discord-Translator/releases/tag/v0.7.3-beta

Before requesting review, verify that the download above provides both x64 and ARM64 installers
and that the linked privacy policy matches this revision. The earlier `0.7.2-beta` companion does
not implement the web-messenger setting or private translation path and must not be used to test
this feature. A prepared package or this URL alone is not evidence of publication.

The add-on is not useful on its own. It sends translation requests to the separately installed
NudeNyang Windows application through Firefox Native Messaging. If the companion application is
not running or its native host is not registered, the popup reports that the Windows application
must be connected and no webpage text is translated.

Major and minor versions identify the product generation; patch versions are independent. A
matching generation alone does not establish support for the new privacy contract. The extension
must receive `webSettings.messengerEnabled: true` from the compatible companion and otherwise
keeps web-messenger reading disabled.

## Changes in 0.7.8

The following section records the previous release. Version 0.7.9 keeps those translation and
consent behaviors and adds the installation/recovery guide described below.

### Additional changes in 0.7.9

- Repeated native-connection failures expose a dismissible installation/recovery card. A saved
  success flag prioritizes recovery; `browser_connection_disabled` never becomes an install prompt.
- A user click opens bundled `download.html`, which retrieves the existing public GitHub update
  feed without cookies, referrers, page text, page addresses, or messages. It displays the latest
  published build including prereleases and both Windows architectures. The user must separately
  click an installer to download it. Network failure leaves retry and GitHub Releases links.
- Only release data is fetched. There is no remote executable code, analytics, new permission,
  automatic download, or change to messenger consent. Connection-success and help-dismissal flags
  are local preferences. The public privacy policy must include this addition before submission.
- The generator additionally imports `scripts/extension-setup-copy.mjs` (28 interface languages);
  this input is included in the source archive. Reproduction commands below are unchanged.
- Test first-use failure, transient failure, previous connection, dismissal, reconnect, and
  explicit browser disable. Check that the download guide uses the published feed rather than a
  hardcoded companion version and does not open without a user click.

### Previous 0.7.8 changes

- Check fresh companion settings and browser consent before a manual translation start, including
  F4. OFF cancels a pending ON without waiting for the native lookup; stale replies after navigation
  or consent withdrawal cannot restart translation. The user confirmed the old-tab F4 fix in Whale;
  this is not a claim of equivalent live Firefox testing.
- Show a page-level consent explanation when a supported open conversation cannot translate due
  to missing consent, without collecting its body. Only a real user click opens the notice. Dismissal
  prevents scroll/polling from repeatedly showing it; a new manual attempt can show it again.
- Check the companion immediately when the extension background starts and when browser focus
  moves to another app. Retry temporary connection failures after 1, 2, 4, and 8 seconds at most,
  stopping on success or explicit browser disconnection; retain the one-minute alarm. These
  signals contain only browser kind/version and request metadata, not page or profile data.
- Simplify the popup: use the toggle or F4 to restore originals, highlight missing messenger
  consent in a dedicated card, and retain a separate non-starting privacy-management action.
  A companion `browser_connection_disabled` response disables translation controls while
  preserving access to companion settings and privacy/withdrawal. This is an app-level switch,
  not extension uninstall or browser-permission revocation.

- Add the `alarms` permission for connection-only checks at install, browser startup, and periodic
  intervals. These checks contain no webpage body or address, do not initialize a model, and do
  not enable translation, open a tab, or grant messenger consent. The companion distinguishes
  connection checks from model-preparation requests.

- Keep X Chat conversation identity stable when virtual scrolling replaces the first message
  or temporarily empties the list. Only the modern panel/scroller on an explicit conversation
  route uses this identity; route/panel changes and unsupported public drawers remain guarded.
- Keep already translated, connected X messages in the current conversation's memory when
  scrolling clips them from view. Permission refresh does not restore these nodes to the original
  text, reread them, or submit new offscreen content. Detached, hidden or repurposed nodes do not
  receive this retention exception. Navigation, revocation and explicit OFF still clear state.
- Add synthetic scroll/lifecycle regressions. The user confirmed that the Whale X scroll fix
  works after updating to 0.7.8. This does not establish live testing in Firefox or every messenger.
  Consent remains version 2; the connection alarm does not expand message-processing scope.

## Changes in 0.7.7

- Translate visible channel names in the current Discord server and the current channel title;
  exclude DM contact names, categories, other servers, editors and hidden content.
- Translate textual Discord link-preview titles, descriptions and fields within the current
  transcript. Do not follow links, fetch attachments, translate provider/author metadata or OCR
  images. These texts use the same local-only, temporary-memory private path as messages.
- Require consent version 2 in the extension and compatible companion, with updated notices in
  all 28 interface languages. Existing version-1 consent is not automatically expanded. The user
  must review and explicitly accept the new scope; Firefox's optional grant remains required.
- Add synthetic extraction, consent and lifecycle regressions. This is not a claim of completed
  signed-in testing in web Discord. No additional browser permission category is introduced.

## Changes in 0.7.6

- Recognize the current X conversation-panel/message-scroller structure and its dynamic
  `message-text-*` body spans, based on user-provided Whale Elements screenshots. Retain the
  legacy X DM selectors without broadening collection to the inbox or arbitrary log elements.
- Exclude timestamps, status controls, drafts and clipped messages. Reject distinct visible
  transcripts even when they use different X layouts. Consent, local-only processing and
  private-data retention rules are unchanged; no new permissions are introduced.
- Add synthetic structure and content-runtime regressions. No real DM text or identifiers are
  included in fixtures, and these tests do not claim live translation success in Whale or Firefox.

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

This optional feature covers X DM, Discord web, WhatsApp Web, Telegram Web, Messenger, Slack,
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

After these gates pass, message-body text currently visible in the open conversation is eligible.
For Discord, this also includes link-preview titles, descriptions and textual fields in the same
transcript, and visible channel names in the current server (not DM contact lists or other servers).
Consent version 2 is mandatory; the user must accept the updated notice to replace a version-1
grant. Existing consent is not automatically upgraded. The extension does not open other conversations, collect hidden history, translate
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

Eligible messenger text and translations, including Discord channel names and link-preview text,
are kept in memory only. Changing or
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
- `alarms`: schedules connection-only checks with the local companion. No webpage content or
  address is included; these checks do not initialize a model or enable messenger reading.
- `http://*/*` and `https://*/*`: allows the user to translate ordinary webpages. Sensitive routes
  and browser-internal pages remain blocked in the ordinary collector. Only the separately gated,
  supported HTTPS conversation views can use the optional private collector.
- Required `websiteContent`: declares the visible webpage text processed for Firefox users.
- Required `browsingActivity`: declares the current page protocol, hostname, and path used locally to keep
  translation requests and context separated by page. Query strings and URL fragments are excluded.
- Optional `personalCommunications`: declares eligible messenger text, including the disclosed
  Discord channel names and link-preview text, sent outside the add-on to the
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
implementation requires the matching companion source and release linked above. Confirm that
both are accessible before requesting review.

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
npx --yes web-ext@10.6.0 lint --source-dir dist/firefox-extension --warnings-as-errors
```

## Functional test outline

The companion-download prerequisite above must be resolved before presenting this outline as a
ready-to-run submission. Use only test conversations the reviewer is authorized to access.

1. Install and run NudeNyang Windows `0.7.3-beta` from the download above, not `0.7.2-beta` for
   the messenger tests. Download a local Hy-MT2 model in the app before testing translation.
2. Register its Native Messaging host by running the installed executable once with
   `--register-browser-native-host`. The installer performs this automatically.
3. Install the XPI through the review environment and open an ordinary HTTP/HTTPS page. For local
   pre-submission testing of an unsigned build, use Firefox's temporary add-on loading in
   `about:debugging`; do not disable Firefox's signature protection. Public permanent installs
   require the AMO-signed add-on.
4. Press the quick toggle shortcut configured in the Windows app (`F4` by default), use the registered Firefox command (`Ctrl+Shift+L` by default), or use the popup switch to translate the current page.
5. Turn off the popup translation toggle or press F4 and verify that the original text returns.
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
