import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import {
  WIKTIONARY_PACK_LANGUAGES,
  WIKTIONARY_PACK_LICENSE,
  WIKTIONARY_PACK_VERSION,
} from "./dictionary-wiktionary-languages.mjs";

const catalogUrl = new URL("../src-tauri/dictionary-packs/catalog.json", import.meta.url);
const starterUrl = new URL("../src-tauri/dictionary-packs/starter.json", import.meta.url);
const coreVocabularyUrl = new URL("../src-tauri/dictionary-packs/core-vocabulary.json", import.meta.url);
const practicalDirectoryUrl = new URL("../src-tauri/dictionary-packs/practical/", import.meta.url);
const catalog = JSON.parse(readFileSync(catalogUrl, "utf8"));
const starter = JSON.parse(readFileSync(starterUrl, "utf8"));
const coreVocabulary = JSON.parse(readFileSync(coreVocabularyUrl, "utf8"));

for (const candidate of WIKTIONARY_PACK_LANGUAGES) {
  const archive = readFileSync(new URL(`${candidate.productCode}.json.gz`, practicalDirectoryUrl));
  const document = JSON.parse(gunzipSync(archive));
  const [pack] = document.packs || [];
  if (!pack || pack.language !== candidate.productCode || pack.edition !== "practical") {
    throw new Error(`${candidate.productCode}: practical archive metadata is invalid`);
  }
  const profile = coreVocabulary.profiles[candidate.productCode];
  if (JSON.stringify(profile) !== JSON.stringify(candidate.coreWords)) {
    throw new Error(`${candidate.productCode}: common-vocabulary profile and builder config differ`);
  }
  const catalogIndex = catalog.languages.findIndex(item => item.code === candidate.productCode);
  if (catalogIndex < 0) throw new Error(`${candidate.productCode}: language is missing from catalog`);
  catalog.languages[catalogIndex] = {
    code: candidate.productCode,
    tier: 2,
    availability: "practical",
    version: WIKTIONARY_PACK_VERSION,
    title: candidate.title,
    entryCount: pack.entries.length,
    compressedBytes: archive.byteLength,
    sha256: createHash("sha256").update(archive).digest("hex"),
    source: candidate.sourceName,
    sourceUrl: candidate.sourceUrl,
    license: WIKTIONARY_PACK_LICENSE,
    sources: [{
      role: "primary",
      name: candidate.sourceName,
      url: candidate.sourceUrl,
      license: WIKTIONARY_PACK_LICENSE,
    }],
  };

  const firstEntries = candidate.coreWords.slice(0, 4).map(word => {
    const normalized = word.normalize("NFKC").toLocaleLowerCase(candidate.productCode);
    const sourceEntry = pack.entries.find(entry =>
      String(entry.headword || "").normalize("NFKC").toLocaleLowerCase(candidate.productCode) === normalized,
    );
    if (!sourceEntry) throw new Error(`${candidate.productCode}: starter word is missing: ${word}`);
    return { ...sourceEntry, examples: {} };
  });
  const starterPack = {
    id: `nudenyang-starter-${candidate.productCode}`,
    language: candidate.productCode,
    version: WIKTIONARY_PACK_VERSION,
    title: `${candidate.title} starter`,
    sourceName: candidate.sourceName,
    sourceUrl: candidate.sourceUrl,
    license: WIKTIONARY_PACK_LICENSE,
    entries: firstEntries,
  };
  const starterIndex = starter.packs.findIndex(item => item.language === candidate.productCode);
  if (starterIndex >= 0) starter.packs[starterIndex] = starterPack;
  else starter.packs.push(starterPack);
}

writeFileSync(catalogUrl, `${JSON.stringify(catalog, null, 2)}\n`);
writeFileSync(starterUrl, `${JSON.stringify(starter, null, 2)}\n`);
process.stdout.write(`Synchronized ${WIKTIONARY_PACK_LANGUAGES.length} Wiktionary packs.\n`);
