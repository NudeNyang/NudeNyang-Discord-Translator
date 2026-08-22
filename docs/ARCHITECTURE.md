# Architecture and security boundaries

NudeNyang Discord Translator is a Tauri 2 desktop application with a Rust core. The WebView renders the settings and tray interfaces; process control, translation, language detection, caching, OCR, and Discord integration remain in Rust.

## Runtime ownership

| Area | Rust module |
|---|---|
| Settings and migration | `src-tauri/src/config.rs` |
| Tray, windows, and shortcuts | `src-tauri/src/main.rs` |
| Discord process lifecycle | `src-tauri/src/discord.rs` |
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

## Discord connection

On Windows, NudeNyang starts Discord with `--remote-debugging-pipe`. Communication uses inherited anonymous pipe handles rather than a TCP debugging port.

Before attaching, the app checks:

- the normalized Discord executable path;
- the original process and any same-install PID handoff;
- the local guardian process and its startup arguments;
- that the selected renderer belongs to `https://discord.com`.

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

Translation results are cached in memory and SQLite. Cache namespaces include the engine, target language, prompt/register version, and relevant renderer version so incompatible results are not reused.

## Image translation

Image translation stays local until the extracted text reaches the selected translator:

1. Rust reads the source image or captures the visible Discord image when direct access is unavailable.
2. A pinned PP-OCR model detects and recognizes text.
3. The selected translator processes the extracted strings.
4. Rust composes a replacement PNG and swaps the displayed image source.

Downloaded OCR assets are checked against their expected size and SHA-256. GIFs, videos, stickers, and profile images are outside the image-translation scope.

## Platform boundary

Windows 10/11 x64 is the current supported platform. Platform-specific code is isolated around Discord discovery and restart behavior, native shortcuts, runtime resource paths, signing, and update installation. The shared translation, CDP, DOM, and OCR core does not depend on Python or PySide.
