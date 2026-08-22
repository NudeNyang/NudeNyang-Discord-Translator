import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    output: { type: "string" },
    version: { type: "string" },
    "minimum-entries": { type: "string", default: "50000" },
    compact: { type: "boolean", default: false },
  },
});

for (const required of ["input", "output", "version"]) {
  if (!values[required]) throw new Error(`--${required} is required`);
}

const localeByKoreanName = new Map([
  ["영어", "en"],
  ["일본어", "ja"],
  ["중국어", "zh"],
  ["스페인어", "es-419"],
  ["프랑스어", "fr"],
  ["러시아어", "ru"],
  ["인도네시아어", "id"],
  ["아랍어", "ar"],
  ["베트남어", "vi"],
  ["타이어", "th"],
]);

function decodeXml(value) {
  return String(value || "").replace(
    /&(?:#(\d+)|#x([\da-f]+)|amp|lt|gt|quot|apos);/giu,
    (entity, decimal, hexadecimal) => {
      if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
      if (hexadecimal) return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
      return { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'" }[entity.toLowerCase()] || entity;
    },
  ).normalize("NFKC").trim();
}

function feature(block, attribute) {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = block.match(new RegExp(`<feat\\s+att="${escaped}"\\s+val="([^"]*)"\\s*/>`, "u"));
  return decodeXml(match?.[1]);
}

function partOfSpeech(value) {
  if (["명사", "대명사", "의존 명사"].includes(value)) return "noun";
  if (["동사", "보조 동사"].includes(value)) return "verb";
  if (["형용사", "보조 형용사"].includes(value)) return "adjective";
  if (value === "부사") return "adverb";
  return "other";
}

const files = readdirSync(values.input)
  .filter(name => /^\d+\.xml$/u.test(name))
  .sort((left, right) => left.localeCompare(right, "en"));
if (!files.length) throw new Error("--input must contain numbered Korean Basic Dictionary XML files");

const entries = [];
const definitionsByHeadword = new Map();
let lexicalEntryCount = 0;
let rejectedSenseCount = 0;

for (const fileName of files) {
  const xml = readFileSync(join(values.input, fileName), "utf8");
  for (const entryMatch of xml.matchAll(/<LexicalEntry\b[\s\S]*?<\/LexicalEntry>/gu)) {
    lexicalEntryCount += 1;
    const block = entryMatch[0];
    const entryHeader = block.split("<Sense", 1)[0];
    const headword = feature(entryHeader, "writtenForm");
    if (!headword || headword.length > 120) continue;
    const reading = feature(entryHeader, "pronunciation").slice(0, 160);
    const pos = partOfSpeech(feature(entryHeader, "partOfSpeech"));
    const normalizedHeadword = headword.toLocaleLowerCase("ko");
    const knownDefinitions = definitionsByHeadword.get(normalizedHeadword) || new Set();

    for (const senseMatch of block.matchAll(/<Sense\b[\s\S]*?<\/Sense>/gu)) {
      const sense = senseMatch[0];
      const koreanDefinition = feature(sense, "definition");
      if (!koreanDefinition || koreanDefinition.length > 600) {
        rejectedSenseCount += 1;
        continue;
      }
      const glosses = { ko: koreanDefinition };
      for (const equivalentMatch of sense.matchAll(/<Equivalent>[\s\S]*?<\/Equivalent>/gu)) {
        const equivalent = equivalentMatch[0];
        const locale = localeByKoreanName.get(feature(equivalent, "language"));
        const definition = feature(equivalent, "definition");
        if (locale && definition && definition.length <= 600 && !glosses[locale]) {
          glosses[locale] = definition;
        }
      }
      const definitionKey = JSON.stringify(glosses);
      if (knownDefinitions.has(definitionKey)) continue;
      entries.push({
        headword,
        reading,
        partOfSpeech: pos,
        senseRank: knownDefinitions.size,
        glosses,
        // Examples and linked media have separate redistribution constraints.
        // Only dictionary-authored definitions and textual pronunciation are retained.
        examples: {},
      });
      knownDefinitions.add(definitionKey);
    }
    if (knownDefinitions.size) definitionsByHeadword.set(normalizedHeadword, knownDefinitions);
  }
}

const minimumEntries = Number.parseInt(values["minimum-entries"], 10);
if (!Number.isSafeInteger(minimumEntries) || minimumEntries < 1) {
  throw new Error("--minimum-entries must be a positive integer");
}
if (entries.length < minimumEntries) {
  throw new Error(`quality gate failed: ${entries.length}/${minimumEntries} accepted entries`);
}

const document = {
  schemaVersion: 1,
  packs: [{
    id: `nudenyang-ko-krdict-${values.version}`,
    language: "ko",
    version: values.version,
    title: "한국어기초사전 전체 기본층",
    sourceName: "한국어기초사전, 국립국어원",
    sourceUrl: "https://krdict.korean.go.kr/kor/mainAction",
    license: "CC-BY-SA-2.0-KR",
    edition: "practical",
    entries,
  }],
};
const serialized = `${JSON.stringify(document, null, values.compact ? 0 : 2)}\n`;
writeFileSync(values.output, values.output.toLowerCase().endsWith(".gz")
  ? gzipSync(serialized, { level: 9 })
  : serialized);
console.log(
  `Built Korean Basic Dictionary: ${entries.length} senses across ${definitionsByHeadword.size} headwords `
  + `from ${lexicalEntryCount} lexical entries · ${rejectedSenseCount} incomplete senses rejected`,
);
