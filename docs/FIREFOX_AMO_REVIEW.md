# Firefox AMO reviewer notes

## Distribution

- Channel: public listing (`On this site` / listed)
- Add-on ID: `web-translator@nudenyang.github.io`
- Add-on version: `0.7.4`
- Supported platform: Firefox desktop on Windows 10 and Windows 11
- Companion application: NudeNyang Translator `0.7.2-beta` or later
- Reviewer download: <https://github.com/NudeNyang/NudeNyang-Discord-Translator/releases/tag/v0.7.2-beta>

The add-on is not useful on its own. It sends translation requests to the separately installed
NudeNyang Windows application through Firefox Native Messaging. If the companion application is
not running or its native host is not registered, the popup reports that the Windows application
must be connected and no webpage text is translated.

The desktop application remains at `0.7.2-beta`; only the add-on patch version changes in this
submission. Major and minor versions identify the compatible product generation.

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
- Add a restricted content script for visible YouTube embed titles, as described below. Existing
  permissions, add-on identity, and declared data categories are unchanged.

## Single purpose and data flow

The add-on translates visible webpage paragraphs while preserving the existing DOM layout. It
reads only eligible text nodes from explicitly supported content areas or ordinary HTTP/HTTPS pages
that the user activates. It excludes input values, editable content, private-message routes, account
and payment routes, code blocks, prices, URL-like link labels, and browser-internal pages. Fixed
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
Each translation request also includes a page identifier made from the current protocol, hostname,
and path so that requests and translation context remain separated by page. Query strings and URL
fragments are not included. A saved site policy contains only the hostname and the behavior selected
by the user.
With a local model selected, the text remains on the device. If the user explicitly selects an
external translation provider in the companion application, the text required for translation can
be sent directly to that provider under the provider's terms. The project does not operate a relay
or storage server. The developer does not receive or retain webpage text, current page addresses,
browsing history, translation history, credentials, cookies, or analytics. The page identifier and
site policies are processed locally only to provide the requested translation.

The public privacy explanation is available at:

`https://github.com/NudeNyang/NudeNyang-Discord-Translator/blob/main/PRIVACY.md`

## Permission rationale

- `nativeMessaging`: communicates with the installed Windows translation engine.
- `storage`: retains non-sensitive extension preferences.
- `activeTab`: reads and controls the current page from the popup and keyboard command.
- `scripting`: reinjects only the add-on's bundled content scripts when an already-open HTTP/HTTPS
  tab has lost its receiver after the add-on was installed, updated, or reloaded. It does not fetch
  or execute remote code.
- `http://*/*` and `https://*/*`: allows the user to translate ordinary webpages. Sensitive routes
  and browser-internal pages are blocked in code.
- `websiteContent`: declares the visible webpage text processed for Firefox users.
- `browsingActivity`: declares the current page protocol, hostname, and path used locally to keep
  translation requests and context separated by page. Query strings and URL fragments are excluded.

## Source and reproducible packaging

No runtime code is minified, obfuscated, transpiled, or downloaded. `popup-locales.js` and the
`extension/_locales` message files are generated from the desktop application's translation
catalog. The source archive includes the generator and its inputs, the ordinary and restricted
embed scripts, the regression tests and their documentation/companion-source fixtures,
`package.json`, `package-lock.json`, and `THIRD_PARTY_NOTICES.md`. The included companion bridge
source is inspected by contract tests; it is not compiled or bundled into the XPI.

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

1. Install and run the NudeNyang Windows companion application.
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
