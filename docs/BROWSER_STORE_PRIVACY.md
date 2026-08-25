# Browser store privacy declarations

This document contains the privacy answers to use when submitting NudeNyang Web Translator to the
Chrome Web Store, Naver Whale Store, and Firefox AMO. The public policy is `PRIVACY.md`.

## Single purpose

NudeNyang Web Translator uses the translation engine in the separately installed NudeNyang Windows
application to translate eligible visible text on webpages activated by the user while preserving
the existing page layout.

## Data handled

- Website content / `websiteContent`: eligible visible headings, paragraphs, lists, quotations, and
  image captions selected for translation.
- Web history / `browsingActivity`: the current page protocol, hostname, and path used to separate
  translation requests and context by page and to apply a user-selected hostname policy. Query
  strings and URL fragments are excluded.

The extension does not handle authentication information, financial information, health
information, location, personal communications, search terms, form contents, cookies, or login
tokens. Account, login, payment, order, administration, and private-message surfaces are excluded
from generic translation.

## Processing and transmission

Eligible text and the page identifier are sent through Native Messaging to the NudeNyang Windows
application on the same computer. With a local model, they remain on the device. If the user
explicitly selects an external translation provider in the Windows application, only eligible text
required for translation can be sent directly to that provider under its terms. The page identifier
is not sent to the external translation provider.

The project does not operate a relay, analytics, or storage server. The developer does not receive
or retain webpage text, page addresses, browsing history, credentials, cookies, or translation
history. Data is not sold or used for advertising, tracking, analytics, credit assessment, or any
purpose unrelated to the user-requested translation. No person acting for the developer can read
the data.

## Chrome Web Store privacy form

- Single purpose: use the text under **Single purpose**.
- Data types: select **Website content** and **Web history**.
- Remote code: No.
- Data sale or transfer: No, except eligible text sent directly to a translation provider selected
  by the user to provide the extension's single purpose.
- Advertising, credit assessment, and unrelated use: No.
- Privacy policy URL:
  `https://github.com/NudeNyang/NudeNyang-Discord-Translator/blob/main/PRIVACY.md`

### Permission justification

- `nativeMessaging`: Communicates with the separately installed NudeNyang Windows translation
  engine on the same computer.
- `storage`: Stores non-sensitive extension preferences and the explicit translation state for the
  current browser tab. The tab state is removed when the tab closes.
- `activeTab`: Lets the popup and keyboard command control translation in the active tab.
- `http://*/*` and `https://*/*`: Allows eligible visible text to be translated on ordinary
  webpages after the user activates translation or saves an automatic site policy. Browser-internal
  pages and sensitive routes are blocked.

## Firefox AMO manifest declarations

- Required data types: `websiteContent`, `browsingActivity`.
- Supported platform: Firefox desktop on Windows only.
- Distribution channel: public AMO listing (`On this site`).
- Firefox for Android: not supported because the Windows Native Messaging companion is required.

## Naver Whale Store disclosure

Use the same single-purpose, data-handling, permission, and privacy-policy statements above. The
extension itself contains no adult content. Store screenshots and descriptions should demonstrate
the general webpage translation workflow with neutral content.
