import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

test("JMdict builder preserves distinct applicable senses per headword", () => {
  const directory = mkdtempSync(join(tmpdir(), "nudenyang-jmdict-test-"));
  try {
    const input = join(directory, "input.json");
    const output = join(directory, "output.json.gz");
    writeFileSync(input, JSON.stringify({
      commonOnly: true,
      words: [{
        kanji: [{ text: "時間", common: true }],
        kana: [{ text: "じかん", common: true, appliesToKanji: ["*"] }],
        sense: [
          { partOfSpeech: ["n"], appliesToKanji: ["*"], appliesToKana: ["*"], gloss: [{ lang: "eng", text: "time" }] },
          { partOfSpeech: ["n"], appliesToKanji: ["*"], appliesToKana: ["*"], gloss: [{ lang: "eng", text: "hour" }] },
          { partOfSpeech: ["n"], appliesToKanji: ["別"], appliesToKana: ["べつ"], gloss: [{ lang: "eng", text: "unrelated restricted sense" }] },
        ],
      }],
    }));

    execFileSync(process.execPath, [
      fileURLToPath(new URL("../build-jmdict-pack.mjs", import.meta.url)),
      "--input", input,
      "--output", output,
      "--version", "2026.08.20.1",
      "--source-url", "https://example.com/jmdict",
      "--minimum-entries", "1",
    ], { stdio: "pipe" });

    const document = JSON.parse(gunzipSync(readFileSync(output)));
    const senses = document.packs[0].entries.filter(entry => entry.headword === "時間");
    assert.deepEqual(senses.map(entry => entry.glosses.en), ["time", "hour"]);
    assert.deepEqual(senses.map(entry => entry.senseRank), [0, 1]);
    assert.ok(senses.every(entry => entry.reading === "じかん"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
