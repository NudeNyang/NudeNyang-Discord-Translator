import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    output: { type: "string" },
    version: { type: "string" },
    "source-url": { type: "string" },
    "minimum-entries": { type: "string", default: "150000" },
  },
});

for (const required of ["input", "output", "version", "source-url"]) {
  if (!values[required]) throw new Error(`--${required} is required`);
}

const document = JSON.parse(readFileSync(values.input, "utf8"));
if (!Array.isArray(document.words) || document.commonOnly !== false) {
  throw new Error("input must be a full jmdict-simplified JSON document");
}

const entries = [];
const definitionsByHeadword = new Map();
const maximumSensesPerHeadword = 12;
const minimumEntries = Number.parseInt(values["minimum-entries"], 10);
if (!Number.isSafeInteger(minimumEntries) || minimumEntries < 1) {
  throw new Error("--minimum-entries must be a positive integer");
}

function normalized(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("ja").trim();
}

function partOfSpeech(tags) {
  const joined = tags.join(" ");
  if (/\b(v|vs|vz)/.test(joined)) return "verb";
  if (/\b(adj|cop)/.test(joined)) return "adjective";
  if (/\badv/.test(joined)) return "adverb";
  if (/\bn/.test(joined)) return "noun";
  return "other";
}

function appliesToForm(values, text) {
  return !Array.isArray(values) || values.length === 0 || values.includes("*") || values.includes(text);
}

function readingFor(word, form) {
  if (form.kind === "kana") return form.text;
  return String(
    (word.kana || [])
      .filter(kana => kana?.text && appliesToForm(kana.appliesToKanji, form.text))
      .sort((left, right) => Number(right.common) - Number(left.common))[0]?.text || "",
  ).trim();
}

function englishDefinition(sense) {
  return (sense.gloss || [])
    .filter(gloss => gloss.lang === "eng" && gloss.text)
    .map(gloss => gloss.text.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join("; ")
    .slice(0, 600);
}

for (const word of document.words) {
  const forms = [
    ...(word.kanji || []).map(form => ({ ...form, kind: "kanji" })),
    ...(word.kana || []).map(form => ({ ...form, kind: "kana" })),
  ]
    .filter(form => form?.text)
    .sort((left, right) => Number(right.common) - Number(left.common));
  for (const form of forms) {
    const key = normalized(form.text);
    if (!key || key.length > 120) continue;
    const knownDefinitions = definitionsByHeadword.get(key) || new Set();
    for (const sense of word.sense || []) {
      if (knownDefinitions.size >= maximumSensesPerHeadword) break;
      const applies = form.kind === "kanji"
        ? appliesToForm(sense.appliesToKanji, form.text)
        : appliesToForm(sense.appliesToKana, form.text);
      if (!applies) continue;
      const definition = englishDefinition(sense);
      if (!definition || knownDefinitions.has(definition)) continue;
      entries.push({
        headword: form.text.normalize("NFKC").trim(),
        reading: readingFor(word, form).slice(0, 160),
        partOfSpeech: partOfSpeech(sense.partOfSpeech || []),
        senseRank: knownDefinitions.size,
        glosses: { en: definition },
        examples: {},
      });
      knownDefinitions.add(definition);
    }
    if (knownDefinitions.size) definitionsByHeadword.set(key, knownDefinitions);
  }
}

if (entries.length < minimumEntries) {
  throw new Error(`JMdict quality gate failed: ${entries.length}/${minimumEntries} accepted entries`);
}

const pack = {
  schemaVersion: 1,
  packs: [{
    id: `nudenyang-ja-expanded-${values.version}`,
    language: "ja",
    version: values.version,
    title: "日本語拡張辞書",
    sourceName: "JMdict by the Electronic Dictionary Research and Development Group",
    sourceUrl: values["source-url"],
    license: "CC-BY-SA-4.0",
    edition: "practical",
    entries,
  }],
};
writeFileSync(values.output, gzipSync(`${JSON.stringify(pack)}\n`, { level: 9 }));
console.log(`Built ${values.output}: ${entries.length} JMdict meaning entries`);
