import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { WIKTIONARY_PACK_LANGUAGES } from "../dictionary-wiktionary-languages.mjs";

test("reviewed Wiktionary pack set maps nine product languages to unique source languages", () => {
  assert.deepEqual(
    WIKTIONARY_PACK_LANGUAGES.map(candidate => candidate.productCode),
    ["pt-BR", "es-419", "de", "ru", "fr", "it", "pl", "nl", "cs"],
  );
  assert.equal(new Set(WIKTIONARY_PACK_LANGUAGES.map(candidate => candidate.sourceCode)).size, 9);
  for (const candidate of WIKTIONARY_PACK_LANGUAGES) {
    assert.ok(candidate.minimumEntries >= 20_000, `${candidate.productCode}: minimum entry gate is too small`);
    assert.ok(candidate.coreWords.length >= 8, `${candidate.productCode}: common-vocabulary review is incomplete`);
    assert.match(candidate.sourceUrl, /^https:\/\/kaikki\.org\/dictionary\//);
  }
});

test("Wiktionary set builder excludes inflected form-of rows before writing packs", () => {
  const source = readFileSync(new URL("../build-wiktionary-pack-set.mjs", import.meta.url), "utf8");
  assert.match(source, /function isFormOfSense\(sense\)/);
  assert.match(source, /Array\.isArray\(sense\?\.form_of\)/);
  assert.match(source, /state\.formOfRejected \+= 1/);
  assert.match(source, /linkedTranslations \* 4/);
  assert.match(source, /missing reviewed core words/);
});
