# Architecture and security boundaries

NudeNyang Discord Translator is a Tauri 2 desktop application with a Rust core. The WebView renders the settings and tray interfaces; process control, translation, language detection, caching, OCR, and Discord integration remain in Rust.

## Runtime ownership

| Area | Rust module |
|---|---|
| Settings and migration | `src-tauri/src/config.rs` |
| Tray, windows, and shortcuts | `src-tauri/src/main.rs` |
| Discord process lifecycle | `src-tauri/src/discord.rs` |
| Browser Native Messaging and loopback bridge | `src-tauri/src/browser_bridge.rs` |
| CDP transport | `src-tauri/src/cdp.rs` |
| DOM snapshots, updates, and restoration | `src-tauri/src/dom.rs`, `engine.rs` |
| Outgoing translation | `src-tauri/src/outgoing.rs`, `engine.rs` |
| Language detection | `src-tauri/src/language.rs` |
| Translation providers | `src-tauri/src/translation/`, `providers.rs` |
| Credentials | `src-tauri/src/credentials.rs` |
| Memory and SQLite caches | `src-tauri/src/cache.rs` |
| OCR and image composition | `src-tauri/src/ocr.rs`, `image_translation.rs` |
| Selection dictionary UI and requests | `src-tauri/src/dictionary_ui.rs`, `engine.rs` |
| Offline packs and personal dictionary SQLite | `src-tauri/src/dictionary.rs` |
| Updates | `src-tauri/src/updater.rs` |

Engine work runs outside the UI thread. Incoming and outgoing translation can use different providers. When a provider changes, the engine advances its generation and ignores late results from the previous generation.

Only one local GGUF model is active at a time. If GPU startup fails in automatic mode, the engine retries with a memory-conscious CPU configuration.

Browser translation requests enter the same display translation worker as Discord DOM requests, so the browser path does not create a second local model runtime or provider session. Web source detection and paragraph context are separate from Discord channel memory, however, so browser navigation and batching cannot change Discord language preferences or conversation context.

## Browser extension connection

The optional Manifest V3 extension supports Chrome, Naver Whale, and Firefox from one shared source tree. Chromium uses a service worker manifest, while Firefox uses an event-background manifest with a fixed Gecko add-on ID. It extracts only eligible visible text nodes from supported sites and user-activated ordinary HTTP/HTTPS pages, then sends bounded batches through the browser's Native Messaging API. Generic pages start inert on every load and require an explicit F4 or popup-toggle action before extraction begins.

The installed Tauri executable also serves as the native host when Chromium launches it with an extension origin or Firefox launches it with the registered native-manifest path and Gecko add-on ID. Chrome and Whale share an `allowed_origins` host manifest; Firefox has a separate `allowed_extensions` host manifest registered under Mozilla's per-user registry path. That short-lived host reads an ephemeral descriptor created by the running desktop app and forwards the request to an authenticated `127.0.0.1` listener. The listener binds to an operating-system-selected port and uses a new random 256-bit token on every app start. The descriptor stays in the user's local application-data directory and is removed on a normal shutdown.

The extension never replaces a content container's `innerHTML` or `textContent`. It records each exact text-node value, groups sibling nodes under a paragraph context key for translation, and changes only the corresponding node value. Turning the site toggle off restores the recorded originals. Mutation and intersection observers handle virtualized feeds and single-page navigation without scanning hidden or unrelated page areas. Translation work is viewport-first and scroll-idle: the selected web mode controls a 120-240 pixel observation margin, 140-700 millisecond collection delay, and batch size. Nested mutation roots are coalesced, disconnected or newly offscreen queue entries are discarded, and translated DOM writes are frame-budgeted after scrolling becomes quiet.

The Windows app is the canonical owner of persistent web settings and the extension popup's interface language. It stores the global web switch, default target language, scheduling mode, external-provider character guard, per-host policies, and configured UI language. Native Messaging status responses expose both `uiLanguage` and the system-resolved `resolvedUiLanguage`, using the same 28 supported locale codes as the desktop UI. The popup prioritizes that resolved value, while browser-management metadata uses standard `_locales` generated from the same desktop translation catalog. Chrome, Whale, and Firefox report their browser family and extension version through each Native Messaging request. The extension popup owns only current-page controls and diagnostics, while forwarding persistent site-policy changes to the running app.

Site adapters apply conservative allowlists:

- GitHub prose in Markdown, issue, pull-request, comment, and release areas; code and diffs are excluded.
- BOOTH product descriptions and notices; price, cart, order, account, and payment areas are excluded.
- Google Search result titles, snippets, and information panels; query forms and account UI are excluded.
- YouTube titles, descriptions, comments, and opened transcript segments; inputs, channel identities, and Studio are excluded.
- X post and quote text; compose surfaces, direct messages, handles, and hashtag links are excluded.
- Generic HTTP/HTTPS pages use semantic headings, paragraphs, lists, quotations, and captions. Forms, navigation, dialogs, live regions, editable surfaces, code, prices, cookie consent UI, and sensitive account, payment, order, administration, and private-message routes are excluded.

The manifest injects an isolated, initially inert content script into ordinary HTTP and HTTPS pages so the direct F4 shortcut works without a prior extension-popup gesture. Browser-internal URLs, local files, and non-HTTP schemes are outside the match patterns. This broad match scope can produce a browser host-access warning even though generic text extraction remains opt-in and route-filtered.

The native host manifest limits access to the extension's stable ID. Requests are limited to 32 nodes, 4,000 characters per node, 32,000 characters per batch, and the browser protocol's one-megabyte envelope. When an external provider is active, a configurable per-page source-character guard stops additional sends before unbounded scrolling can create unexpected usage. Local-model requests are not subject to that guard.

## Discord connection

On Windows, NudeNyang starts Discord with `--remote-debugging-pipe`. Communication uses inherited anonymous pipe handles rather than a TCP debugging port.

Before attaching, the app checks:

- the normalized Discord executable path;
- the original process and any same-install PID handoff;
- the local guardian process and its startup arguments;
- that the selected renderer belongs to `https://discord.com`, `https://ptb.discord.com`, or
  `https://canary.discord.com`.

The saved connection target can be automatic, Discord, Discord PTB, or Discord Canary. When
multiple release variants are running, NudeNyang connects to and restarts only the explicitly
selected installation. Other Discord processes remain untouched.

A small local guardian retains the app-side pipe handles when NudeNyang closes. Reopening the app can reconnect to the same Discord process without interrupting a call or chat session. The guardian exits after the matching Discord process is gone.

The integration is deliberately limited:

- no Discord user token, unofficial API call, or self-bot;
- no modification of Discord installation files or server-side data;
- changes are limited to the currently rendered DOM;
- saved original DOM content is restored when translation is disabled or the app shuts down normally;
- live translation remains off until the user accepts the integration notice;
- additional verification switches the app to verification compatibility mode, detaches the translation pipe, and waits for the user to reconnect after verification.

This is not an officially supported Discord extension interface. Discord updates can change the renderer and temporarily break the integration.

## Translation and data

Local Hy-MT2 and TranslateGemma requests are handled on the user's computer through a Rust-managed llama.cpp runtime. Optional external providers receive only the extracted text selected for translation.

NudeNyang does not send these items to external translation providers:

- Discord image pixels;
- authentication tokens;
- the local cache database;
- diagnostic logs.

DeepL credentials are stored in Windows Credential Manager. Subscription providers use their official local CLI authentication. Diagnostic logs redact home paths and secret values and do not include message bodies or local-model prompts.

Translation results are cached in memory and SQLite. Cache namespaces include the engine, target language, prompt/register version, and relevant renderer version so incompatible results are not reused. Within one uncached batch, identical source text resolved to the same source language is translated once and fanned out to every matching result slot. This reduces cold-cache work without sharing results across incompatible target languages or engine namespaces.

## Image translation

Image translation stays local until the extracted text reaches the selected translator:

1. Rust reads the source image or captures the visible Discord image when direct access is unavailable.
2. A pinned PP-OCR model detects and recognizes text.
3. The selected translator processes the extracted strings.
4. Rust composes a replacement PNG and swaps the displayed image source.

Downloaded OCR assets are checked against their expected size and SHA-256. GIFs, videos, stickers, and profile images are outside the image-translation scope.

## Platform boundary

Windows 10/11 x64 is the current supported platform. Platform-specific code is isolated around Discord discovery and restart behavior, native shortcuts, runtime resource paths, signing, and update installation. The shared translation, CDP, DOM, and OCR core does not depend on Python or PySide.
