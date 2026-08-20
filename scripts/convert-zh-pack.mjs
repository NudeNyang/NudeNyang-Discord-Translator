import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { gzipSync, gunzipSync } from "node:zlib";

import OpenCC from "opencc-js";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    output: { type: "string" },
    version: { type: "string" },
  },
});

for (const required of ["input", "output", "version"]) {
  if (!values[required]) throw new Error(`--${required} is required`);
}

const document = JSON.parse(gunzipSync(readFileSync(values.input)));
if (document.schemaVersion !== 1 || document.packs?.length !== 1) {
  throw new Error("input must contain one schemaVersion 1 practical pack");
}
const [sourcePack] = document.packs;
if (sourcePack.language !== "zh-Hant" || sourcePack.edition !== "practical") {
  throw new Error("input must be a Traditional Chinese practical pack");
}

const toSimplified = OpenCC.Converter({ from: "tw", to: "cn" });
const entries = [];
const definitionsByHeadword = new Map();
let duplicates = 0;

for (const entry of sourcePack.entries || []) {
  const headword = toSimplified(String(entry.headword || "")).normalize("NFKC").trim();
  if (!headword) continue;
  const key = headword.toLocaleLowerCase("zh");
  const knownDefinitions = definitionsByHeadword.get(key) || new Set();
  const definitionKey = JSON.stringify(entry.glosses || {});
  if (knownDefinitions.has(definitionKey)) {
    duplicates += 1;
    continue;
  }
  entries.push({
    ...entry,
    headword,
    senseRank: knownDefinitions.size,
  });
  knownDefinitions.add(definitionKey);
  definitionsByHeadword.set(key, knownDefinitions);
}

const pack = {
  schemaVersion: 1,
  packs: [{
    ...sourcePack,
    id: `nudenyang-zh-${values.version}`,
    language: "zh",
    version: values.version,
    title: "简体中文实用词典",
    sourceName: `${sourcePack.sourceName}; headwords converted with OpenCC`,
    license: `${sourcePack.license} AND Apache-2.0`,
    entries,
  }],
};

writeFileSync(values.output, gzipSync(`${JSON.stringify(pack)}\n`, { level: 9 }));
console.log(
  `Built ${values.output}: ${entries.length} meanings across ${definitionsByHeadword.size} Simplified Chinese headwords · ${duplicates} converted duplicates removed`,
);
