# Selection dictionary

The dictionary can be enabled independently from message translation. Selecting up to 120 characters in a Discord message reveals an `Aa` action. Lookup starts only after the user activates it. Results may include a headword, reading, part of speech, definition, example, source, license, and operating-system speech synthesis.

Installed packs and personal terms stay on the device in a dedicated `dictionary.db` SQLite file. The selected word leaves the device only when the user chooses the external Wiktionary action, which can be disabled in settings. When a pack has no definition in the interface language, the app may send the pack's original definition to the configured translation model. This transfer is disclosed in settings and the result is marked as an automatic translation.

## Definition locale and fallback order

The interface language, not the message display-translation language, selects the preferred definition locale. This means a Korean interface requests Korean definitions, a Japanese interface requests Japanese definitions, and a Chinese interface requests Chinese definitions regardless of the current Discord translation direction.

Lookup uses the following order for each entry:

1. A human-authored definition in the interface language from the installed pack.
2. A previously cached automatic translation for that entry and interface language.
3. The pack's English definition, or its first available original definition.

When only step 3 is available and the configured translation model is ready, the definition is translated in the existing translation worker. Successful results are stored as a localized overlay in `dictionary_localized_text`, while the source dictionary rows remain unchanged. The popup labels the result as an automatic translation and keeps the original definition behind an expandable disclosure. If translation is unavailable or fails, the popup displays the original definition with its language instead of failing the lookup.

## Rough selection and phrase segmentation

Users do not need to know the exact dictionary boundary before selecting text. The app first attempts an exact lookup. When that misses, it checks shorter expressions inside the selection and returns a left-to-right, longest-match segmentation with up to eight distinct terms. Space-delimited languages keep word boundaries, while Korean, Japanese, Chinese, and Thai also support compact expressions without spaces. For example, a rough selection of `非難禁止` can resolve to separate `非難` and `禁止` entries when the combined expression is not a headword.

The popup keeps the original selection as its title, labels segmented results as expressions found inside the selection, and gives each matched headword and reading its own heading. Source-language detection prefers a reliable signal in the selected text itself. For ambiguous Han-only selections, up to 240 characters immediately around the selection are used locally so Japanese or Chinese packs can still be chosen from nearby context without an unrelated language elsewhere in a multilingual message overriding the result. This context is not included in external dictionary or definition-translation requests.

## Pack policy

The app keeps a four-entry project-authored mini pack for each core language so a first lookup can explain the feature without a setup step. Five practical packs are bundled as gzip resources and expanded into SQLite only when the user selects **Install practical pack**:

| Language | Headwords | Compressed | Definitions |
|---|---:|---:|---|
| Korean | 68,220 | 1,618,273 bytes | Korean |
| English | 15,288 | 405,918 bytes | Korean |
| Japanese | 50,638 | 791,235 bytes | English |
| Simplified Chinese | 15,916 | 244,665 bytes | Korean |
| Traditional Chinese | 15,916 | 244,672 bytes | Korean |

The five compressed resources total 3,304,763 bytes. Installation verifies the catalog size and SHA-256 digest before decompression, replaces only the selected language pack in a transaction, and reports progress to the settings UI. Removing a practical pack reclaims its SQLite entries; the mini pack can be installed lazily again on the next lookup.

The shared catalog still covers all 28 product languages. The remaining 23 languages stay marked as planned until their source, attribution, pack size, and human quality review are complete. A future remote catalog can use the same metadata and pack format without changing lookup storage.

## Sources and updates

Korean, English, and Chinese practical packs are filtered and normalized from the Korean-language Wiktionary dump dated 2026-08-04, extracted by Wiktextract/kaikki.org in August 2026. Examples, audio, and separately licensed media are excluded. The Japanese practical pack is filtered from the English common-word JMdict simplified release `3.6.2+20260817122448`; all available written and reading forms are indexed.

JMdict's licence requires a regular update procedure, with monthly updates given as the example for dictionary services. Practical packs therefore carry a dated version and source digest and must be reviewed and rebuilt at least monthly while they are distributed. Source and licence acknowledgements are shown in lookup results and the app's licence screen and are also included in `THIRD_PARTY_NOTICES.md`.

Run `npm run test:dictionaries` to validate catalog ordering, compressed sizes and hashes, pack metadata, unique headwords, supported parts of speech, definition limits, practical coverage, and the reported `調べ` regression. `npm run dictionary:build -- ...` converts reviewed Wiktextract-style JSONL. `node scripts/build-jmdict-pack.mjs -- ...` converts the JMdict simplified common-word JSON.
