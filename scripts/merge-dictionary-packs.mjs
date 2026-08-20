import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";

const { values } = parseArgs({
  options: {
    input: { type: "string", multiple: true },
    output: { type: "string" },
    language: { type: "string" },
    version: { type: "string" },
    title: { type: "string" },
    "source-name": { type: "string" },
    "source-url": { type: "string" },
    license: { type: "string" },
    "minimum-entries": { type: "string", default: "1" },
    compact: { type: "boolean", default: false },
  },
});

for (const required of ["output", "language", "version", "title", "source-name", "source-url", "license"]) {
  if (!values[required]) throw new Error(`--${required} is required`);
}
if (!Array.isArray(values.input) || values.input.length < 2) {
  throw new Error("at least two --input packs are required in primary-to-expanded order");
}

function readDocument(path) {
  const bytes = readFileSync(path);
  const serialized = path.toLowerCase().endsWith(".gz") ? gunzipSync(bytes) : bytes;
  return JSON.parse(serialized.toString("utf8"));
}

function normalizedHeadword(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase(values.language).trim();
}

function definitionKey(entry) {
  const definitions = Object.entries(entry.glosses || {})
    .map(([locale, text]) => [locale, String(text || "").normalize("NFKC").trim()])
    .filter(([, text]) => text)
    .sort(([left], [right]) => left.localeCompare(right));
  const preferred = definitions.find(([locale]) => locale === values.language)
    || definitions.find(([locale]) => locale === "en")
    || definitions[0];
  return preferred ? `${preferred[0]}\u0000${preferred[1]}` : "";
}

const entries = [];
const seenGlossesByHeadword = new Map();
const nextSenseRankByHeadword = new Map();
const sourceSummaries = [];
let sourcePriorityOffset = 0;

for (const inputPath of values.input) {
  const document = readDocument(inputPath);
  if (document.schemaVersion !== 1 || !Array.isArray(document.packs) || document.packs.length !== 1) {
    throw new Error(`${inputPath}: expected one schema-version-1 dictionary pack`);
  }
  const [pack] = document.packs;
  if (pack.language !== values.language) {
    throw new Error(`${inputPath}: expected ${values.language}, received ${pack.language}`);
  }
  if (!pack.sourceName || !pack.sourceUrl || !pack.license) {
    throw new Error(`${inputPath}: pack attribution is incomplete`);
  }
  sourceSummaries.push(pack.sourceName);
  let highestLocalPriority = 0;

  for (const entry of pack.entries || []) {
    const headwordKey = normalizedHeadword(entry.headword);
    const definition = definitionKey(entry);
    if (!headwordKey || !definition) continue;
    const knownGlosses = seenGlossesByHeadword.get(headwordKey) || new Set();
    if (knownGlosses.has(definition)) continue;

    const senseRank = nextSenseRankByHeadword.get(headwordKey) || 0;
    const localSourcePriority = Number.isSafeInteger(entry.sourcePriority)
      ? Math.max(0, entry.sourcePriority)
      : 0;
    highestLocalPriority = Math.max(highestLocalPriority, localSourcePriority);
    const sourceName = entry.sourceName || pack.sourceName;
    const sourceUrl = entry.sourceUrl || pack.sourceUrl;
    const license = entry.license || pack.license;
    const attributionOverride = sourceName !== values["source-name"]
      || sourceUrl !== values["source-url"]
      || license !== values.license;
    entries.push({
      headword: entry.headword,
      reading: String(entry.reading || ""),
      partOfSpeech: entry.partOfSpeech || "other",
      senseRank,
      sourcePriority: sourcePriorityOffset + localSourcePriority,
      ...(attributionOverride ? { sourceName, sourceUrl, license } : {}),
      glosses: entry.glosses,
      examples: entry.examples || {},
    });
    knownGlosses.add(definition);
    seenGlossesByHeadword.set(headwordKey, knownGlosses);
    nextSenseRankByHeadword.set(headwordKey, senseRank + 1);
  }
  sourcePriorityOffset += highestLocalPriority + 1;
}

const minimumEntries = Number.parseInt(values["minimum-entries"], 10);
if (!Number.isSafeInteger(minimumEntries) || minimumEntries < 1) {
  throw new Error("--minimum-entries must be a positive integer");
}
if (entries.length < minimumEntries) {
  throw new Error(`quality gate failed: ${entries.length}/${minimumEntries} merged entries`);
}

const document = {
  schemaVersion: 1,
  packs: [{
    id: `nudenyang-${values.language}-${values.version}`,
    language: values.language,
    version: values.version,
    title: values.title,
    sourceName: values["source-name"],
    sourceUrl: values["source-url"],
    license: values.license,
    edition: "practical",
    entries,
  }],
};
const serialized = `${JSON.stringify(document, null, values.compact ? 0 : 2)}\n`;
if (values.output.toLowerCase().endsWith(".gz")) {
  writeFileSync(values.output, gzipSync(serialized, { level: 9 }));
} else {
  writeFileSync(values.output, serialized, "utf8");
}
console.log(`Merged ${sourceSummaries.join(" + ")}: ${entries.length} senses across ${nextSenseRankByHeadword.size} headwords`);
