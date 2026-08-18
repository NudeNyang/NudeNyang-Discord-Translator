# Selection dictionary

The dictionary is a local feature independent from message translation. Selecting up to 120 characters in a Discord message reveals an `Aa` action. Lookup starts only after the user activates it. Results may include a headword, reading, part of speech, definition, example, source, license, and operating-system speech synthesis.

Installed packs and personal terms stay on the device in a dedicated `dictionary.db` SQLite file. The selected word leaves the device only when the user chooses the external Wiktionary action, which can be disabled in settings.

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
