import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { createGunzip, gzipSync } from "node:zlib";

import { SUPPORTED_TARGET_LANGUAGES } from "../web/languages.mjs";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    output: { type: "string" },
    language: { type: "string" },
    "source-name": { type: "string" },
    "source-url": { type: "string" },
    license: { type: "string" },
    version: { type: "string" },
    "minimum-entries": { type: "string", default: "100" },
    "gloss-language": { type: "string", default: "en" },
    "source-language": { type: "string" },
    title: { type: "string" },
    compact: { type: "boolean", default: false },
  },
});

for (const required of ["input", "output", "language", "source-name", "source-url", "license", "version"]) {
  if (!values[required]) throw new Error(`--${required} is required`);
}
if (!SUPPORTED_TARGET_LANGUAGES.includes(values.language)) {
  throw new Error(`unsupported language: ${values.language}`);
}
if (values.license === "review-required") {
  throw new Error("a reviewed redistributable data license is required before building a pack");
}

const catalog = JSON.parse(readFileSync(new URL("../src-tauri/dictionary-packs/catalog.json", import.meta.url), "utf8"));
const allowedPartsOfSpeech = new Set(catalog.coveragePolicy.allowedPartsOfSpeech);
const sourceLanguage = values["source-language"] || values.language;
const entries = [];
const definitionsByHeadword = new Map();
const MAX_SENSES_PER_HEADWORD = 12;
let rejected = 0;

function partOfSpeech(value) {
  const normalized = String(value || "other").toLowerCase();
  if (allowedPartsOfSpeech.has(normalized)) return normalized;
  if (normalized === "adj") return "adjective";
  if (normalized === "adv") return "adverb";
  return "other";
}

function firstText(values) {
  if (!Array.isArray(values)) return "";
  return values.map(value => String(value || "").trim()).find(Boolean) || "";
}

const source = createReadStream(values.input);
const input = values.input.toLowerCase().endsWith(".gz") ? source.pipe(createGunzip()) : source;
input.setEncoding("utf8");
const lines = createInterface({
  input,
  crlfDelay: Infinity,
});
for await (const line of lines) {
  if (!line.trim()) continue;
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    rejected += 1;
    continue;
  }
  const rowLanguage = String(row.lang_code || row.language_code || row.lang || "");
  if (rowLanguage && rowLanguage !== sourceLanguage) continue;
  const headword = String(row.word || row.headword || "").normalize("NFKC").trim();
  const normalized = headword.toLocaleLowerCase(values.language);
  if (!headword || headword.length > 120) continue;
  const reading = firstText(row.sounds?.map(sound => sound?.ipa || sound?.zh_pron || sound?.other));
  const senses = Array.isArray(row.senses) && row.senses.length ? row.senses : [{ glosses: row.glosses || [] }];
  const definitions = definitionsByHeadword.get(normalized) || new Set();
  for (const sense of senses) {
    if (definitions.size >= MAX_SENSES_PER_HEADWORD) break;
    const definition = (sense?.glosses || [])
      .map(value => String(value || "").trim())
      .filter(Boolean)
      .slice(0, 3)
      .join("; ");
    if (!definition || definition.length > 600) {
      rejected += 1;
      continue;
    }
    const definitionKey = definition.normalize("NFKC").toLocaleLowerCase(values["gloss-language"]);
    if (definitions.has(definitionKey)) continue;
    entries.push({
      headword,
      reading: reading.slice(0, 160),
      partOfSpeech: partOfSpeech(row.pos),
      senseRank: definitions.size,
      glosses: { [values["gloss-language"]]: definition },
      // Wiktionary examples can quote separately licensed works. Practical packs
      // intentionally keep only headwords, readings, parts of speech, and glosses.
      examples: {},
    });
    definitions.add(definitionKey);
  }
  if (definitions.size) definitionsByHeadword.set(normalized, definitions);
}

const minimumEntries = Number.parseInt(values["minimum-entries"], 10);
if (!Number.isSafeInteger(minimumEntries) || minimumEntries < 1) throw new Error("--minimum-entries must be a positive integer");
if (entries.length < minimumEntries) {
  throw new Error(`quality gate failed: ${entries.length}/${minimumEntries} accepted entries`);
}

const pack = {
  schemaVersion: 1,
  packs: [{
    id: `nudenyang-${values.language}-${values.version}`,
    language: values.language,
    version: values.version,
    title: values.title || `${values.language} practical dictionary`,
    sourceName: values["source-name"],
    sourceUrl: values["source-url"],
    license: values.license,
    edition: "practical",
    entries,
  }],
};
const serialized = `${JSON.stringify(pack, null, values.compact ? 0 : 2)}\n`;
if (values.output.toLowerCase().endsWith(".gz")) {
  writeFileSync(values.output, gzipSync(serialized, { level: 9 }));
} else {
  writeFileSync(values.output, serialized, "utf8");
}
console.log(`Built ${values.output}: ${entries.length} senses across ${definitionsByHeadword.size} headwords accepted · ${rejected} malformed or incomplete senses rejected`);
