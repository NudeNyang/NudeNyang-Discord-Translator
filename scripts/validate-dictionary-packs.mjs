import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SUPPORTED_TARGET_LANGUAGES } from "../web/languages.mjs";

const catalog = JSON.parse(readFileSync(new URL("../src-tauri/dictionary-packs/catalog.json", import.meta.url), "utf8"));
const starter = JSON.parse(readFileSync(new URL("../src-tauri/dictionary-packs/starter.json", import.meta.url), "utf8"));

assert.equal(catalog.schemaVersion, 1, "unsupported dictionary catalog schema");
assert.equal(starter.schemaVersion, 1, "unsupported starter pack schema");
assert.deepEqual(
  catalog.languages.map(language => language.code),
  SUPPORTED_TARGET_LANGUAGES,
  "dictionary catalog must follow the shared 28-language order",
);

const catalogCodes = new Set(catalog.languages.map(language => language.code));
assert.equal(catalogCodes.size, 28, "dictionary catalog language codes must be unique");
const bundledCodes = new Set(
  catalog.languages.filter(language => language.availability === "bundled").map(language => language.code),
);
assert.deepEqual([...bundledCodes].sort(), ["en", "ja", "ko", "zh", "zh-Hant"].sort());

const ids = new Set();
for (const pack of starter.packs) {
  assert.ok(bundledCodes.has(pack.language), `${pack.language}: starter pack is not catalogued as bundled`);
  assert.ok(!ids.has(pack.id), `${pack.id}: duplicate pack id`);
  ids.add(pack.id);
  assert.match(pack.version, /^\d{4}\.\d{2}\.\d{2}\.\d+$/, `${pack.id}: invalid version`);
  assert.ok(pack.sourceName && pack.sourceUrl && pack.license, `${pack.id}: attribution is incomplete`);
  assert.ok(
    pack.entries.length >= catalog.coveragePolicy.bundledMinimumEntries,
    `${pack.id}: too few starter entries`,
  );
  const normalizedHeadwords = new Set();
  for (const entry of pack.entries) {
    const normalized = entry.headword.normalize("NFKC").toLocaleLowerCase(pack.language);
    assert.ok(normalized && !normalizedHeadwords.has(normalized), `${pack.id}: duplicate or empty headword`);
    normalizedHeadwords.add(normalized);
    assert.ok(
      catalog.coveragePolicy.allowedPartsOfSpeech.includes(entry.partOfSpeech),
      `${pack.id}/${entry.headword}: unsupported part of speech`,
    );
    for (const language of catalog.coveragePolicy.requiredGlossLanguages) {
      assert.ok(entry.glosses?.[language]?.trim(), `${pack.id}/${entry.headword}: missing ${language} gloss`);
    }
    assert.ok(Object.values(entry.glosses || {}).every(value => String(value).trim().length <= 600));
    assert.ok(Object.values(entry.examples || {}).every(value => String(value).trim().length <= 600));
  }
}

assert.deepEqual(
  starter.packs.map(pack => pack.language).sort(),
  [...bundledCodes].sort(),
  "every bundled catalog language must have one starter pack",
);

console.log(`Dictionary catalog: ${catalog.languages.length}/28 languages`);
console.log(`Bundled starter packs: ${starter.packs.length} packs · ${starter.packs.reduce((sum, pack) => sum + pack.entries.length, 0)} entries`);
console.log("Dictionary pack validation passed.");
