import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { SUPPORTED_TARGET_LANGUAGES } from "../web/languages.mjs";

const catalog = JSON.parse(readFileSync(new URL("../src-tauri/dictionary-packs/catalog.json", import.meta.url), "utf8"));
const starter = JSON.parse(readFileSync(new URL("../src-tauri/dictionary-packs/starter.json", import.meta.url), "utf8"));

assert.equal(catalog.schemaVersion, 2, "unsupported dictionary catalog schema");
assert.equal(starter.schemaVersion, 1, "unsupported starter pack schema");
assert.deepEqual(
  catalog.languages.map(language => language.code),
  SUPPORTED_TARGET_LANGUAGES,
  "dictionary catalog must follow the shared 28-language order",
);

const catalogCodes = new Set(catalog.languages.map(language => language.code));
assert.equal(catalogCodes.size, 28, "dictionary catalog language codes must be unique");
const practicalCodes = new Set(
  catalog.languages.filter(language => language.availability === "practical").map(language => language.code),
);
assert.deepEqual([...practicalCodes].sort(), ["en", "ja", "ko", "zh", "zh-Hant"].sort());

const ids = new Set();
for (const pack of starter.packs) {
  assert.ok(practicalCodes.has(pack.language), `${pack.language}: starter pack has no practical upgrade`);
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
  [...practicalCodes].sort(),
  "every practical catalog language must have one starter pack",
);

for (const metadata of catalog.languages.filter(language => language.availability === "practical")) {
  const file = readFileSync(new URL(`../src-tauri/dictionary-packs/practical/${metadata.code}.json.gz`, import.meta.url));
  assert.equal(file.byteLength, metadata.compressedBytes, `${metadata.code}: compressed size mismatch`);
  assert.equal(createHash("sha256").update(file).digest("hex"), metadata.sha256, `${metadata.code}: SHA-256 mismatch`);
  const document = JSON.parse(gunzipSync(file));
  assert.equal(document.schemaVersion, 1, `${metadata.code}: unsupported practical pack schema`);
  assert.equal(document.packs.length, 1, `${metadata.code}: practical archive must contain one pack`);
  const [pack] = document.packs;
  assert.equal(pack.language, metadata.code, `${metadata.code}: language mismatch`);
  assert.equal(pack.edition, "practical", `${metadata.code}: practical edition marker missing`);
  assert.equal(pack.entries.length, metadata.entryCount, `${metadata.code}: entry count mismatch`);
  assert.ok(metadata.title && metadata.source && metadata.sourceUrl && metadata.license, `${metadata.code}: catalog attribution is incomplete`);
  assert.match(metadata.version, /^\d{4}\.\d{2}\.\d{2}\.\d+$/, `${metadata.code}: invalid practical version`);
  const glossesByHeadword = new Map();
  for (const entry of pack.entries) {
    const normalized = String(entry.headword || "").normalize("NFKC").toLocaleLowerCase(metadata.code);
    assert.ok(normalized && normalized.length <= 120, `${metadata.code}: invalid practical headword`);
    const glossKey = JSON.stringify(entry.glosses || {});
    const knownGlosses = glossesByHeadword.get(normalized) || new Set();
    assert.ok(!knownGlosses.has(glossKey), `${metadata.code}/${entry.headword}: duplicate practical sense`);
    knownGlosses.add(glossKey);
    glossesByHeadword.set(normalized, knownGlosses);
    if (entry.senseRank !== undefined) {
      assert.ok(Number.isSafeInteger(entry.senseRank) && entry.senseRank >= 0, `${metadata.code}/${entry.headword}: invalid sense rank`);
    }
    assert.ok(
      catalog.coveragePolicy.allowedPartsOfSpeech.includes(entry.partOfSpeech),
      `${metadata.code}/${entry.headword}: unsupported practical part of speech`,
    );
    assert.ok(Object.values(entry.glosses || {}).some(value => String(value).trim()), `${metadata.code}/${entry.headword}: missing practical gloss`);
    assert.ok(Object.values(entry.glosses || {}).every(value => String(value).trim().length <= 600));
  }
  assert.ok(
    pack.entries.every(entry => Object.keys(entry.examples || {}).length === 0),
    `${metadata.code}: separately licensed examples must not be bundled`,
  );
}

const japanese = JSON.parse(gunzipSync(readFileSync(new URL("../src-tauri/dictionary-packs/practical/ja.json.gz", import.meta.url))));
assert.ok(japanese.packs[0].entries.some(entry => entry.headword === "調べ"), "Japanese practical pack must cover 調べ");

const korean = JSON.parse(gunzipSync(readFileSync(new URL("../src-tauri/dictionary-packs/practical/ko.json.gz", import.meta.url))));
const mindSenses = korean.packs[0].entries.filter(entry => entry.headword === "정신");
assert.ok(mindSenses.length >= 5, "Korean practical pack must preserve homonymous 정신 senses");
assert.ok(mindSenses.some(entry => entry.glosses.ko?.includes("마음")), "정신 must preserve its common mind sense");
assert.ok(mindSenses.some(entry => entry.glosses.ko?.includes("(역사)")), "정신 must preserve its historical senses as alternatives");

console.log(`Dictionary catalog: ${catalog.languages.length}/28 languages`);
console.log(`Bundled starter packs: ${starter.packs.length} packs · ${starter.packs.reduce((sum, pack) => sum + pack.entries.length, 0)} entries`);
console.log(`Practical packs: ${practicalCodes.size} packs · ${catalog.languages.filter(item => item.availability === "practical").reduce((sum, item) => sum + item.entryCount, 0)} entries`);
console.log("Dictionary pack validation passed.");
