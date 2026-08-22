import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { createGunzip, gzipSync } from "node:zlib";

import {
  WIKTIONARY_PACK_LANGUAGES,
  WIKTIONARY_PACK_LICENSE,
  WIKTIONARY_PACK_VERSION,
} from "./dictionary-wiktionary-languages.mjs";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    "output-directory": { type: "string", default: "src-tauri/dictionary-packs/practical" },
    compact: { type: "boolean", default: true },
  },
});

if (!values.input) throw new Error("--input is required");

const candidatesBySourceCode = new Map(
  WIKTIONARY_PACK_LANGUAGES.map(candidate => [candidate.sourceCode, candidate]),
);
const states = new Map(WIKTIONARY_PACK_LANGUAGES.map(candidate => [candidate.productCode, {
  candidate,
  entries: [],
  definitionsByHeadword: new Map(),
  rejected: 0,
  formOfRejected: 0,
}]));
const MAX_SENSES_PER_HEADWORD = 10;

function partOfSpeech(value) {
  const normalized = String(value || "").toLowerCase();
  if (["noun", "verb", "adjective", "adverb"].includes(normalized)) return normalized;
  if (normalized === "adj") return "adjective";
  if (normalized === "adv") return "adverb";
  return "other";
}

function firstReading(row) {
  if (!Array.isArray(row.sounds)) return "";
  return row.sounds
    .map(sound => sound?.ipa || sound?.other || "")
    .map(value => String(value).trim())
    .find(Boolean) || "";
}

function isFormOfSense(sense) {
  if (Array.isArray(sense?.form_of) && sense.form_of.length) return true;
  if (Array.isArray(sense?.alt_of) && sense.alt_of.length) return true;
  const tags = [...(sense?.tags || []), ...(sense?.raw_tags || [])]
    .map(tag => String(tag).toLowerCase());
  return tags.some(tag => tag === "form-of" || tag === "alt-of" || tag.includes("inflection"));
}

function normalizedDefinition(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function senseScore(sense, originalIndex, rowTranslations) {
  const normalizedGlosses = new Set(
    (sense?.glosses || []).map(normalizedDefinition).filter(Boolean),
  );
  const linkedTranslations = rowTranslations.filter(translation =>
    normalizedGlosses.has(normalizedDefinition(translation?.sense)),
  ).length;
  const tags = [...(sense?.tags || []), ...(sense?.raw_tags || [])]
    .map(tag => String(tag).toLowerCase());
  let score = linkedTranslations * 4;
  if (tags.some(tag => ["archaic", "obsolete", "dated", "historical", "rare"].includes(tag))) score -= 80;
  if (tags.some(tag => ["figurative", "metaphorical"].includes(tag))) score -= 30;
  return { sense, score, originalIndex };
}

const source = createReadStream(values.input);
const input = values.input.toLowerCase().endsWith(".gz") ? source.pipe(createGunzip()) : source;
input.setEncoding("utf8");
const lines = createInterface({ input, crlfDelay: Infinity });
let processed = 0;

for await (const line of lines) {
  if (!line.trim()) continue;
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    continue;
  }
  const candidate = candidatesBySourceCode.get(String(row.lang_code || row.language_code || row.lang || ""));
  if (!candidate) continue;
  const state = states.get(candidate.productCode);
  const headword = String(row.word || row.headword || "").normalize("NFKC").trim();
  if (!headword || headword.length > 120) {
    state.rejected += 1;
    continue;
  }
  const normalizedHeadword = headword.toLocaleLowerCase(candidate.productCode);
  const knownDefinitions = state.definitionsByHeadword.get(normalizedHeadword) || new Set();
  const rowTranslations = Array.isArray(row.translations) ? row.translations : [];
  const senses = (Array.isArray(row.senses) ? row.senses : [])
    .map((sense, originalIndex) => senseScore(sense, originalIndex, rowTranslations))
    .sort((left, right) => right.score - left.score || left.originalIndex - right.originalIndex);
  const reading = firstReading(row).slice(0, 160);
  for (const { sense } of senses) {
    if (knownDefinitions.size >= MAX_SENSES_PER_HEADWORD) break;
    if (isFormOfSense(sense)) {
      state.formOfRejected += 1;
      continue;
    }
    const definition = (sense?.glosses || [])
      .map(value => String(value || "").trim())
      .filter(Boolean)
      .slice(0, 3)
      .join("; ");
    if (!definition || definition.length > 600) {
      state.rejected += 1;
      continue;
    }
    const definitionKey = normalizedDefinition(definition);
    if (knownDefinitions.has(definitionKey)) continue;
    state.entries.push({
      headword,
      reading,
      partOfSpeech: partOfSpeech(row.pos),
      senseRank: knownDefinitions.size,
      glosses: { en: definition },
      examples: {},
    });
    knownDefinitions.add(definitionKey);
  }
  if (knownDefinitions.size) state.definitionsByHeadword.set(normalizedHeadword, knownDefinitions);
  processed += 1;
  if (processed % 250_000 === 0) process.stdout.write(`Scanned ${processed.toLocaleString()} matching rows...\n`);
}

mkdirSync(values["output-directory"], { recursive: true });
for (const state of states.values()) {
  const { candidate, entries, definitionsByHeadword } = state;
  if (entries.length < candidate.minimumEntries) {
    throw new Error(`${candidate.productCode}: quality gate failed (${entries.length}/${candidate.minimumEntries} senses)`);
  }
  const normalizedHeadwords = new Set(definitionsByHeadword.keys());
  const missingCoreWords = candidate.coreWords.filter(word =>
    !normalizedHeadwords.has(word.normalize("NFKC").toLocaleLowerCase(candidate.productCode)),
  );
  if (missingCoreWords.length) {
    throw new Error(`${candidate.productCode}: missing reviewed core words: ${missingCoreWords.join(", ")}`);
  }
  const pack = {
    schemaVersion: 1,
    packs: [{
      id: `nudenyang-${candidate.productCode}-${WIKTIONARY_PACK_VERSION}`,
      language: candidate.productCode,
      version: WIKTIONARY_PACK_VERSION,
      title: candidate.title,
      sourceName: candidate.sourceName,
      sourceUrl: candidate.sourceUrl,
      license: WIKTIONARY_PACK_LICENSE,
      edition: "practical",
      entries,
    }],
  };
  const output = `${values["output-directory"]}/${candidate.productCode}.json.gz`;
  const serialized = `${JSON.stringify(pack, null, values.compact ? 0 : 2)}\n`;
  writeFileSync(output, gzipSync(serialized, { level: 9 }));
  process.stdout.write(
    `${candidate.productCode}: ${entries.length.toLocaleString()} senses / ` +
    `${definitionsByHeadword.size.toLocaleString()} headwords · ` +
    `${state.formOfRejected.toLocaleString()} form-of senses excluded -> ${output}\n`,
  );
}
