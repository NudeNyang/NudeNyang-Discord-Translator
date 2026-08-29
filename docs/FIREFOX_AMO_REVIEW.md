# Firefox AMO reviewer notes — 0.7.11

## Distribution and prerequisite

- Channel: public listing (`On this site` / listed)
- Add-on ID: `web-translator@nudenyang.github.io`
- Add-on version: `0.7.11`
- Platform: Firefox desktop 142+ on Windows 10/11
- Companion: a matching NudeNyang Windows release that reports `messengerPolicyVersion: 5`
- Companion download: `https://github.com/NudeNyang/NudeNyang-Discord-Translator/releases`

This local package is a submission draft. Do not request review until the public companion offers
the v5 capability and the public privacy-policy URL matches the bundled `PRIVACY.md`. The currently
published 0.7.3-beta update feed still describes the older v2 local-only messenger policy. Reusing
the same application version label does not make that binary compatible; publish an incremented
companion build first.

## Purpose and user flow

The add-on has one purpose: translate eligible visible text in webpages through the separately
installed NudeNyang Windows translation engine. It contains no translation model. Native Messaging
connects the add-on to the companion on the same computer. If the companion is unavailable, no page
text is translated and the popup offers connection or installation guidance.

Users review one bundled disclosure before enabling browser-wide translation. F4 or the popup
switch then controls all current and new tabs; site blocks and companion disconnect remain effective.
Earlier web consent v1 and private-reading consent v1-v4 are not upgraded automatically.

Ordinary translation covers eligible visible headings, paragraphs, lists, quotations, image
captions and identifiable read-only interface labels. Input values, editable content, code, prices,
marked identifiers and arbitrary sensitive values remain excluded. The add-on never injects into
browser-internal pages or local files.

## Private reading

Consent v5 additionally permits only safely identified current reading surfaces:

- visible bodies in the open X DM, Discord web, WhatsApp Web, Telegram Web, Messenger, Slack,
  Microsoft Teams or Google Messages conversation;
- Discord link-preview text and visible channel names in the current server; and
- the subject and visible body in the currently opened Gmail and Outlook reading panes.

Lists, contacts, authors, handles, sender/recipient UI, drafts, composers, attachments, linked pages,
hidden history and send controls are excluded. The add-on does not open another conversation or mail.
Outlook has synthetic automated coverage only; live Outlook validation is not claimed.

Firefox declares `personalCommunications` as optional. It is requested only from an explicit click
on the bundled consent page. Denial, cancellation, removal, missing v5 consent or missing companion
capability blocks private reading while leaving approved ordinary translation available.

## Processing and retention

Eligible ordinary text, the current protocol/hostname/path identifier and private-reading text are
sent through Native Messaging to the companion. Query strings, URL fragments, real conversation/mail
IDs, participant lists, cookies, authentication tokens and full HTML are not sent. The developer
operates no relay, analytics or content-storage server.

Local models keep translation processing on the PC. In a regular window, explicitly selecting
ChatGPT, Claude, Gemini or DeepL permits necessary eligible text, including consented private-reading
text, to be sent to that provider under its policies. The companion's regular cache stores source
and translation bodies encrypted with Windows user-scoped DPAPI and follows its 7/30/90/180-day or
unlimited retention setting and history deletion. Changing pages or withdrawing consent does not
retroactively delete cache entries. Provider-side records are separate.

Private windows never read or write the disk cache. They use request memory and allow only local
models or DeepL because subscription-CLI local records cannot be controlled. The extension storage
contains preferences and consent, not page, conversation or mail bodies.

## Permission rationale

- `nativeMessaging`: sends translation requests to the installed same-computer companion.
- `storage`: stores preferences, all-tab state and consent versions, never content bodies.
- `activeTab`: addresses the active tab from the popup.
- `scripting`: restores bundled receivers in already-open eligible tabs after install/update/reload;
  it never downloads or executes remote code.
- `alarms`: performs content-free companion connection checks.
- `http://*/*`, `https://*/*`: supports ordinary webpages and separately gated HTTPS private-reading
  surfaces. No other URL scheme is included.
- required `websiteContent`: eligible visible text passed to the companion.
- required `browsingActivity`: current protocol, hostname and path used locally to separate context.
- optional `personalCommunications`: the disclosed current conversation or opened-mail text.

## Source and reproducible build

Runtime code is not minified, obfuscated or remotely loaded. Generated locale files are made from
the included translation catalog and generator. `jsdom` and Playwright are test-only dependencies
and are not bundled in the XPI.

Requirements: Windows PowerShell 5.1+, and a Node.js version accepted by the included package lock.
From the source ZIP root:

```powershell
npm ci
npm run extension:locales
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package_firefox_extension.ps1
npm run test:extension
npx --yes web-ext@10.6.0 lint --source-dir dist/firefox-extension --warnings-as-errors
```

Output: `release/browser-extension/NudeNyang-Web-Translator-Firefox-0.7.11.xpi`.
The source package includes implementation tests, packaging scripts, privacy/scope documents and the
native bridge contract source. The complete companion source is in the linked public repository.

## Functional review outline

Use only pages and test conversations/mail the reviewer is authorized to access.

1. Install and run the matching companion, prepare a translation model, then install the XPI.
2. Review the bundled notice. On an ordinary page, enable translation with the popup or F4; disable
   it and confirm the original text returns. New tabs follow the saved global state.
3. Stop the companion and confirm the add-on reports disconnection without translating page text.
4. Decline optional `personalCommunications`; ordinary translation remains available and private
   surfaces remain unchanged. Accept consent v5 and permission, then confirm only the current allowed
   body is translated. Lists, drafts, input, authors and attachments remain unchanged.
5. Switch conversation/mail or withdraw consent while work is pending and confirm stale results are
   not applied. Check that private windows do not create disk-cache records.

Automated E2E uses synthetic pages and a mock Native Messaging translation response. It does not
claim live validation of every service, Firefox/Whale integration, external-provider accounts or
translation quality. See `WEB_READING_SCOPE.md` and `BROWSER_STORE_SUBMISSION_0.7.11.md`.
