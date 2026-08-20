import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    output: { type: "string" },
    version: { type: "string" },
    "minimum-entries": { type: "string", default: "100000" },
  },
});

for (const required of ["input", "output", "version"]) {
  if (!values[required]) throw new Error(`--${required} is required`);
}

const minimumEntries = Number.parseInt(values["minimum-entries"], 10);
if (!Number.isSafeInteger(minimumEntries) || minimumEntries < 1) {
  throw new Error("--minimum-entries must be a positive integer");
}

const sourceFiles = readdirSync(values.input);
const synsets = new Map();
for (const file of sourceFiles.filter(name => /^(noun|verb|adj|adv)\..+\.json$/.test(name)).sort()) {
  const document = JSON.parse(readFileSync(join(values.input, file), "utf8"));
  for (const [id, synset] of Object.entries(document)) {
    const definition = (synset.definition || [])
      .map(value => String(value || "").trim())
      .filter(Boolean)
      .slice(0, 3)
      .join("; ")
      .slice(0, 600);
    if (definition) synsets.set(id, { definition, partOfSpeech: synset.partOfSpeech || "" });
  }
}

function normalizedHeadword(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .normalize("NFKC")
    .trim();
}

function partOfSpeech(value) {
  if (value === "n") return "noun";
  if (value === "v") return "verb";
  if (value === "a" || value === "s") return "adjective";
  if (value === "r") return "adverb";
  return "other";
}

const entries = [];
const definitionsByHeadword = new Map();
for (const file of sourceFiles.filter(name => /^entries-.+\.json$/.test(name)).sort()) {
  const document = JSON.parse(readFileSync(join(values.input, file), "utf8"));
  for (const [rawHeadword, lexicalForms] of Object.entries(document)) {
    const headword = normalizedHeadword(rawHeadword);
    const key = headword.toLocaleLowerCase("en");
    if (!headword || headword.length > 120) continue;
    const knownDefinitions = definitionsByHeadword.get(key) || new Set();
    for (const lexicalForm of Object.values(lexicalForms || {})) {
      const reading = String(lexicalForm?.pronunciation?.[0]?.value || "").trim().slice(0, 160);
      for (const sense of lexicalForm?.sense || []) {
        if (knownDefinitions.size >= 12) break;
        const synset = synsets.get(sense?.synset);
        if (!synset || knownDefinitions.has(synset.definition)) continue;
        entries.push({
          headword,
          reading,
          partOfSpeech: partOfSpeech(synset.partOfSpeech),
          senseRank: knownDefinitions.size,
          glosses: { en: synset.definition },
          examples: {},
        });
        knownDefinitions.add(synset.definition);
      }
    }
    if (knownDefinitions.size) definitionsByHeadword.set(key, knownDefinitions);
  }
}

if (entries.length < minimumEntries) {
  throw new Error(`Open English WordNet quality gate failed: ${entries.length}/${minimumEntries} accepted entries`);
}

const pack = {
  schemaVersion: 1,
  packs: [{
    id: `nudenyang-en-expanded-${values.version}`,
    language: "en",
    version: values.version,
    title: "English expanded dictionary",
    sourceName: "Open English WordNet 2025",
    sourceUrl: "https://en-word.net/",
    license: "CC-BY-4.0",
    edition: "practical",
    entries,
  }],
};

writeFileSync(values.output, gzipSync(`${JSON.stringify(pack)}\n`, { level: 9 }));
console.log(`Built ${values.output}: ${entries.length} senses across ${definitionsByHeadword.size} headwords`);
