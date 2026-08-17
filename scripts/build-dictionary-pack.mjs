import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

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
const entries = [];
const seen = new Set();
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

const lines = createInterface({
  input: createReadStream(values.input, { encoding: "utf8" }),
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
  if (rowLanguage && rowLanguage !== values.language) continue;
  const headword = String(row.word || row.headword || "").normalize("NFKC").trim();
  const normalized = headword.toLocaleLowerCase(values.language);
  if (!headword || headword.length > 120 || seen.has(normalized)) continue;
  const sense = Array.isArray(row.senses) ? row.senses.find(item => firstText(item?.glosses)) : null;
  const definition = firstText(sense?.glosses || row.glosses);
  if (!definition || definition.length > 600) {
    rejected += 1;
    continue;
  }
  const example = firstText(sense?.examples?.map(item => item?.text) || row.examples);
  const reading = firstText(row.sounds?.map(sound => sound?.ipa || sound?.zh_pron || sound?.other));
  entries.push({
    headword,
    reading: reading.slice(0, 160),
    partOfSpeech: partOfSpeech(row.pos),
    glosses: { en: definition },
    examples: example ? { en: example.slice(0, 600) } : {},
  });
  seen.add(normalized);
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
    title: `${values.language} offline dictionary`,
    sourceName: values["source-name"],
    sourceUrl: values["source-url"],
    license: values.license,
    entries,
  }],
};
writeFileSync(values.output, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
console.log(`Built ${values.output}: ${entries.length} entries accepted · ${rejected} malformed or incomplete rows rejected`);
