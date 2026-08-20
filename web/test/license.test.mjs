import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  APP_LICENSE_TEXT,
  DICTIONARY_NOTICES_TEXT,
  HYMT_1_8B_LICENSE_TEXT,
  HYMT_7B_LICENSE_TEXT,
  LICENSE_DOCUMENTS,
  LICENSE_DOCUMENTS_TEXT,
  THIRD_PARTY_NOTICES_TEXT,
} from "../license.mjs";

const CASES = [
  [APP_LICENSE_TEXT, "../../LICENSE"],
  [THIRD_PARTY_NOTICES_TEXT, "../../THIRD_PARTY_NOTICES.md"],
  [HYMT_1_8B_LICENSE_TEXT, "../../licenses/Hy-MT2-1.8B-GGUF-LICENSE.txt"],
  [HYMT_7B_LICENSE_TEXT, "../../licenses/Hy-MT2-7B-GGUF-LICENSE.txt"],
];

const normalizeNewlines = value => value.replaceAll("\r\n", "\n").trim();

test("in-app license documents match the repository files", async () => {
  for (const [embeddedText, relativePath] of CASES) {
    const repositoryText = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.equal(normalizeNewlines(embeddedText), normalizeNewlines(repositoryText));
  }
});

test("in-app license view contains the app, notices, and both bundled model licenses", () => {
  assert.equal(LICENSE_DOCUMENTS.length, 4);
  assert.match(LICENSE_DOCUMENTS_TEXT, /NudeNyang Discord Translator \(GPL-3\.0-only\)/);
  assert.match(LICENSE_DOCUMENTS_TEXT, /Hy-MT2 1\.8B GGUF \(Apache-2\.0\)/);
  assert.match(LICENSE_DOCUMENTS_TEXT, /Hy-MT2 7B GGUF \(Apache-2\.0\)/);
});

test("dictionary notices can be opened without the unrelated application licences", () => {
  assert.match(DICTIONARY_NOTICES_TEXT, /한국어·영어·중국어 실용팩/);
  assert.match(DICTIONARY_NOTICES_TEXT, /JMdict/);
  assert.match(DICTIONARY_NOTICES_TEXT, /opencc-js/);
  assert.doesNotMatch(DICTIONARY_NOTICES_TEXT, /Hy-MT2 내장 배포/);
});
