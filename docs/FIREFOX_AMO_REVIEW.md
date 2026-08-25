# Firefox AMO reviewer notes

## Distribution

- Channel: public listing (`On this site` / listed)
- Add-on ID: `web-translator@nudenyang.github.io`
- Supported platform: Firefox desktop on Windows 10 and Windows 11
- Companion application: NudeNyang Translator `0.7.1-beta` or later
- Reviewer download: <https://github.com/NudeNyang/NudeNyang-Discord-Translator/releases/tag/v0.7.1-beta>

The add-on is not useful on its own. It sends translation requests to the separately installed
NudeNyang Windows application through Firefox Native Messaging. If the companion application is
not running or its native host is not registered, the popup reports that the Windows application
must be connected and no webpage text is translated.

## Single purpose and data flow

The add-on translates visible webpage paragraphs while preserving the existing DOM layout. It
reads only eligible text nodes from explicitly supported content areas or ordinary HTTP/HTTPS pages
that the user activates. It excludes form controls, private-message routes, account and payment
routes, code blocks, prices, URL-like link labels, and browser-internal pages.

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
- `http://*/*` and `https://*/*`: allows the user to translate ordinary webpages. Sensitive routes
  and browser-internal pages are blocked in code.
- `websiteContent`: declares the visible webpage text processed for Firefox users.
- `browsingActivity`: declares the current page protocol, hostname, and path used locally to keep
  translation requests and context separated by page. Query strings and URL fragments are excluded.

## Source and reproducible packaging

No runtime code is minified, obfuscated, transpiled, or downloaded. `popup-locales.js` and the
`extension/_locales` message files are generated from the desktop application's translation
catalog. The source archive includes the generator and its inputs.

Requirements:

- Node.js 22 or newer
- PowerShell 7 or Windows PowerShell 5.1

From the source archive root, run:

```powershell
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
4. Press `F4` or use the popup switch to translate the current page.
5. Use `Restore this page to the original` in the popup and verify that the original text returns.
6. Stop the companion application and verify that the add-on reports the connection requirement
   without translating or transmitting page content.
