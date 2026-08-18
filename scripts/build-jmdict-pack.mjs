import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    output: { type: "string" },
    version: { type: "string" },
    "source-url": { type: "string" },
  },
});

for (const required of ["input", "output", "version", "source-url"]) {
  if (!values[required]) throw new Error(`--${required} is required`);
}

const document = JSON.parse(readFileSync(values.input, "utf8"));
if (!Array.isArray(document.words) || !document.commonOnly) {
  throw new Error("input must be a jmdict-simplified common-only JSON document");
}

const entries = [];
const seen = new Set();

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

for (const word of document.words) {
  const forms = [...(word.kanji || []), ...(word.kana || [])]
    .filter(form => form?.text)
    .sort((left, right) => Number(right.common) - Number(left.common));
  const reading = String((word.kana || []).find(form => form.common)?.text || word.kana?.[0]?.text || "").trim();
  const sense = (word.sense || []).find(item => item.gloss?.some(gloss => gloss.lang === "eng" && gloss.text));
  if (!sense) continue;
  const definition = sense.gloss
    .filter(gloss => gloss.lang === "eng" && gloss.text)
    .map(gloss => gloss.text.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join("; ")
    .slice(0, 600);
  if (!definition) continue;
  for (const form of forms) {
    const key = normalized(form.text);
    if (!key || key.length > 120 || seen.has(key)) continue;
    entries.push({
      headword: form.text.normalize("NFKC").trim(),
      reading: reading.slice(0, 160),
      partOfSpeech: partOfSpeech(sense.partOfSpeech || []),
      glosses: { en: definition },
      examples: {},
    });
    seen.add(key);
  }
}

if (entries.length < 20_000) {
  throw new Error(`JMdict quality gate failed: ${entries.length}/20000 accepted entries`);
}

const pack = {
  schemaVersion: 1,
  packs: [{
    id: `nudenyang-ja-practical-${values.version}`,
    language: "ja",
    version: values.version,
    title: "日本語実用辞書",
    sourceName: "JMdict by the Electronic Dictionary Research and Development Group",
    sourceUrl: values["source-url"],
    license: "CC-BY-SA-4.0",
    edition: "practical",
    entries,
  }],
};
writeFileSync(values.output, gzipSync(`${JSON.stringify(pack)}\n`, { level: 9 }));
console.log(`Built ${values.output}: ${entries.length} JMdict headwords`);
