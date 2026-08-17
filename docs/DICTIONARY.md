# Selection dictionary

The dictionary is a local feature independent from message translation. Selecting up to 120 characters in a Discord message reveals an `Aa` action. Lookup starts only after the user activates it. Results may include a headword, reading, part of speech, definition, example, source, license, and operating-system speech synthesis.

Installed packs and personal terms stay on the device in a dedicated `dictionary.db` SQLite file. The selected word leaves the device only when the user chooses the external Wiktionary action, which can be disabled in settings.

The first tier implements selection lookup, speech, personal terms, and external handoff. The second tier includes project-authored Korean, English, Japanese, Simplified Chinese, and Traditional Chinese starter packs. The third tier defines a shared 28-language catalog and a JSONL conversion and validation pipeline. The remaining 23 languages stay marked as planned until their data license, attribution, and human quality review are complete.

Run `npm run test:dictionaries` to validate catalog ordering, pack metadata, unique headwords, supported parts of speech, required English definitions, length limits, and starter coverage. `npm run dictionary:build -- ...` converts reviewed Wiktextract-style JSONL while requiring explicit source and license metadata.

No third-party dictionary data is bundled in the starter packs. Future Wiktionary-derived distributions must preserve attribution, source access, change notices, and the applicable CC BY-SA 4.0 and GFDL obligations, and must exclude separately licensed examples or media unless those terms are handled.
