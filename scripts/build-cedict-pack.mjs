import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    "simplified-output": { type: "string" },
    "traditional-output": { type: "string" },
    version: { type: "string" },
    "minimum-entries": { type: "string", default: "100000" },
  },
});

for (const required of ["input", "simplified-output", "traditional-output", "version"]) {
  if (!values[required]) throw new Error(`--${required} is required`);
}

const minimumEntries = Number.parseInt(values["minimum-entries"], 10);
if (!Number.isSafeInteger(minimumEntries) || minimumEntries < 1) {
  throw new Error("--minimum-entries must be a positive integer");
}

function partOfSpeech(definition) {
  if (/^(to |to be |to make |to become )/i.test(definition)) return "verb";
  if (/^(very |in a .* manner|adverb)/i.test(definition)) return "adverb";
  if (/^(adj\.|adjective|of or relating to )/i.test(definition)) return "adjective";
  return "other";
}

const simplifiedEntries = [];
const traditionalEntries = [];
const knownSimplified = new Map();
const knownTraditional = new Map();
const lines = gunzipSync(readFileSync(values.input)).toString("utf8").split(/\r?\n/);

function append(entries, knownByHeadword, headword, reading, definition) {
  const key = headword.normalize("NFKC").trim();
  if (!key || key.length > 120) return;
  const knownDefinitions = knownByHeadword.get(key) || new Set();
  if (knownDefinitions.size >= 12 || knownDefinitions.has(definition)) return;
  entries.push({
    headword: key,
    reading: reading.slice(0, 160),
    partOfSpeech: partOfSpeech(definition),
    senseRank: knownDefinitions.size,
    glosses: { en: definition },
    examples: {},
  });
  knownDefinitions.add(definition);
  knownByHeadword.set(key, knownDefinitions);
}

for (const line of lines) {
  if (!line || line.startsWith("#")) continue;
  const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)]\s+\/(.+)\/$/);
  if (!match) continue;
  const [, traditional, simplified, reading, rawDefinition] = match;
  const definition = rawDefinition
    .split("/")
    .map(value => value.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join("; ")
    .slice(0, 600);
  if (!definition) continue;
  append(simplifiedEntries, knownSimplified, simplified, reading, definition);
  append(traditionalEntries, knownTraditional, traditional, reading, definition);
}

if (simplifiedEntries.length < minimumEntries || traditionalEntries.length < minimumEntries) {
  throw new Error(
    `CC-CEDICT quality gate failed: zh ${simplifiedEntries.length}, zh-Hant ${traditionalEntries.length}/${minimumEntries}`,
  );
}

function writePack(output, language, title, entries) {
  const pack = {
    schemaVersion: 1,
    packs: [{
      id: `nudenyang-${language}-expanded-${values.version}`,
      language,
      version: values.version,
      title,
      sourceName: "CC-CEDICT via MDBG",
      sourceUrl: "https://www.mdbg.net/chinese/dictionary?page=cc-cedict",
      license: "CC-BY-SA-4.0",
      edition: "practical",
      entries,
    }],
  };
  writeFileSync(output, gzipSync(`${JSON.stringify(pack)}\n`, { level: 9 }));
}

writePack(values["simplified-output"], "zh", "简体中文扩展词典", simplifiedEntries);
writePack(values["traditional-output"], "zh-Hant", "繁體中文擴充詞典", traditionalEntries);
console.log(`Built CC-CEDICT packs: zh ${simplifiedEntries.length}, zh-Hant ${traditionalEntries.length}`);
