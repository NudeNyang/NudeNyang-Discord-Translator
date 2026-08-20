# Selection dictionary

The dictionary can be enabled independently from message translation. Selecting up to 120 characters in a Discord message reveals an `Aa` action. Lookup starts only after the user activates it. Results may include a headword, reading, part of speech, definition, example, source, license, and operating-system speech synthesis.

Installed packs and personal terms stay on the device in a dedicated `dictionary.db` SQLite file. Nearby message context is used only on the device and is never included in translation or external-dictionary requests. When the configured translation model is ready, the app may send the selected phrase and pack definitions that are unavailable in the interface language to that model. If the configured model is external, those texts leave the device; this transfer is disclosed in settings. Choosing the optional Wiktionary action also sends the selected phrase to the external site. Reference translations never replace source-authored dictionary rows.

## Definition locale and fallback order

The interface language, not the message display-translation language, selects the preferred definition locale. This means a Korean interface requests Korean definitions, a Japanese interface requests Japanese definitions, and a Chinese interface requests Chinese definitions regardless of the current Discord translation direction.

Lookup uses the following order for each entry:

1. A human-authored definition in the interface language from the installed pack.
2. A previously cached automatic translation that passed the current structural quality gate for that entry and interface language.
3. The pack's English definition, or its first available original definition.

When only step 3 is available and the configured translation model is ready, the definition is translated in the existing translation worker. A translated gloss is accepted only when its length is bounded, it uses the expected writing system for the interface language, and it does not contain common model-answer wrappers or control markers. Accepted results are stored as a versioned localized overlay in `dictionary_localized_text`, while the source dictionary rows remain unchanged. Overlays created before the current quality version are ignored and regenerated on demand. The popup labels the result as a reference translation and expands the source dictionary definition by default. If translation is unavailable, rejected, or fails, the popup displays the original definition with its language instead of failing the lookup.

This gate catches malformed or clearly wrong-language output; it is not a semantic proof and is not presented as human review. Human-authored interface-language glosses from a pack remain the trusted first choice. Automatic localization is always secondary evidence alongside the immutable source gloss.

## Rough selection and phrase segmentation

Users do not need to know the exact dictionary boundary before selecting text. The app first attempts an exact lookup. When that misses, it checks shorter expressions inside the selection and returns a left-to-right, longest-match segmentation with up to eight distinct terms. Space-delimited languages keep word boundaries, while Korean, Japanese, Chinese, and Thai also support compact expressions without spaces. For example, a rough selection of `非難禁止` can resolve to separate `非難` and `禁止` entries when the combined expression is not a headword.

Before a segmented candidate is accepted, a language-specific plausibility check can reject a dictionary spelling that is acting only as grammar in the selected context. The initial Korean rule rejects attached `거지` after a modifier ending, such as the contraction in `많다는거지`, while preserving an exact lookup of `거지` and the space-delimited noun in `가난한 거지`. Rejected candidates are hidden rather than assigned a generated meaning; the source dictionary definition remains unchanged.

If an exact lookup misses, the installed practical languages can try a bounded local base-form fallback before phrase segmentation. Japanese covers common godan, ichidan, irregular, polite, negative, continuative, past, and adjective endings; Korean covers common particles, regular speech endings, and a small reviewed irregular set; English covers common plural, progressive, past, and high-frequency irregular forms. For example, `巡り`, `食べた`, `遊んで`, `먹어요`, `했어요`, `experiences`, and `running` can resolve to `巡る`, `食べる`, `遊ぶ`, `먹다`, `하다`, `experience`, and `run`. Exact dictionary and personal entries always win, generated candidates are bounded, and a candidate is shown only when it actually exists in an installed pack. Chinese does not use inflection fallback; its Simplified and Traditional packs keep separate script-correct headwords.

The popup keeps the original selection as its title and, when the source and interface languages differ, places a translation of the full selection directly beneath it. It does not add a separate sentence-analysis or grammar section. Segmented results remain dictionary headwords with source-authored meanings, and each matched headword and reading keeps its own heading. The header can speak the full selection, while every segmented headword has its own operating-system speech-synthesis control using that entry's source language.

Source-language detection prefers a reliable signal in the selected text itself. For ambiguous Han-only selections, up to 240 characters immediately around the selection are used locally so Japanese or Chinese packs can still be chosen from nearby context without an unrelated language elsewhere in a multilingual message overriding the result. During segmentation, installed base-form candidates are also checked for each bounded surface span, so a polite phrase such as `お世話になります` can resolve to `お世話になる` instead of unrelated shorter headwords. Nearby source context remains local. The accepted full-selection translation is used only to rerank matching senses after dictionary definitions are localized; it does not generate headwords or overwrite dictionary meanings.

When a matched headword has several distinct senses, the lookup keeps every source-authored definition instead of collapsing the headword to its first sense. The surrounding selection context is scored locally against those immutable definitions. Lexical overlap and unrestricted general definitions are preferred; historical and archaic senses are demoted unless the context contains matching domain cues. The highest-scoring sense is labelled as shown first for the context, while the remaining source senses stay available under **Other meanings**. The ranker never generates or rewrites a definition, so a ranking error cannot replace the dictionary source text with a model-created meaning.

## Pack policy

The app keeps a four-entry project-authored mini pack for each core language so a first lookup can explain the feature without a setup step. Five practical packs are bundled as gzip resources and expanded into SQLite only when the user selects **Install practical pack**:

| Language | Headwords | Meaning entries | Compressed | Definitions |
|---|---:|---:|---:|---|
| Korean | 68,220 | 77,269 | 1,911,630 bytes | Korean |
| English | 15,288 | 15,288 | 405,918 bytes | Korean |
| Japanese | 50,640 | 91,031 | 1,303,739 bytes | English |
| Simplified Chinese | 12,846 | 13,167 | 222,489 bytes | Korean |
| Traditional Chinese | 15,916 | 15,916 | 244,672 bytes | Korean |

The five compressed resources total 4,088,448 bytes. Installation verifies the catalog size and SHA-256 digest before decompression, replaces only the selected language pack in a transaction, and reports progress to the settings UI. Removing a practical pack reclaims its SQLite entries; the mini pack can be installed lazily again on the next lookup.

The shared catalog still covers all 28 product languages. The remaining 23 languages stay marked as planned until their source, attribution, pack size, and human quality review are complete. A future remote catalog can use the same metadata and pack format without changing lookup storage.

## Sources and updates

Korean, English, and Chinese practical packs are filtered and normalized from the Korean-language Wiktionary dump dated 2026-08-04, extracted by Wiktextract/kaikki.org in August 2026. Examples, audio, and separately licensed media are excluded. The Simplified Chinese headwords are generated from the reviewed Traditional source rows with `opencc-js` 1.4.1 and its Apache-2.0 OpenCC dictionary data; duplicate rows created by many-to-one script conversion are removed without rewriting their Korean definitions. The Japanese practical pack is filtered from the English common-word JMdict simplified release `3.6.2+20260817122448`; all available written and reading forms are indexed. Up to twelve distinct, form-applicable JMdict senses are preserved per normalized headword. For example, `時間` keeps `time`, `hour`, and `period; class; lesson` as separate source senses instead of collapsing to the first gloss.

JMdict's licence requires a regular update procedure, with monthly updates given as the example for dictionary services. Practical packs therefore carry a dated version and source digest and must be reviewed and rebuilt at least monthly while they are distributed. Source and licence acknowledgements are deduplicated in a single collapsed section at the bottom of each lookup result and are also shown in the app's licence screen and `THIRD_PARTY_NOTICES.md`. When one result combines entries from different sources, each sense keeps a short source label so its provenance remains identifiable without repeating the full licence text.

Run `npm run test:dictionaries` to validate catalog ordering, compressed sizes and hashes, pack metadata, distinct senses per headword, supported parts of speech, definition limits, script-correct Chinese entries, practical coverage, and the reported `調べ` and `정신` regressions. `npm run dictionary:build -- ...` converts reviewed Wiktextract-style JSONL and preserves up to twelve distinct senses per normalized headword. `node scripts/build-jmdict-pack.mjs -- ...` converts the JMdict simplified common-word JSON. `npm run dictionary:convert-zh -- --input <zh-Hant.json.gz> --output <zh.json.gz> --version <version>` reproducibly generates the Simplified Chinese pack without adding OpenCC to the desktop runtime.
