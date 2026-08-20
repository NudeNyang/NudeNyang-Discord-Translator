import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

function pack(id, sourceName, sourceUrl, license, entries) {
  return {
    schemaVersion: 1,
    packs: [{
      id,
      language: "ko",
      version: "fixture",
      title: "fixture",
      sourceName,
      sourceUrl,
      license,
      edition: "practical",
      entries,
    }],
  };
}

test("dictionary pack merger keeps primary meanings first and preserves per-entry attribution", () => {
  const directory = mkdtempSync(join(tmpdir(), "nudenyang-merge-test-"));
  try {
    const primaryPath = join(directory, "primary.json.gz");
    const expandedPath = join(directory, "expanded.json.gz");
    const outputPath = join(directory, "merged.json.gz");
    writeFileSync(primaryPath, gzipSync(JSON.stringify(pack(
      "primary",
      "Official learner dictionary",
      "https://example.com/primary",
      "CC-BY-SA-2.0-KR",
      [{
        headword: "퇴근",
        reading: "퇴ː근",
        partOfSpeech: "noun",
        senseRank: 0,
        glosses: {
          ko: "직장에서 일을 끝내고 집으로 돌아가거나 돌아옴.",
          en: "Leaving work and returning home.",
        },
        examples: {},
      }],
    ))));
    writeFileSync(expandedPath, gzipSync(JSON.stringify(pack(
      "expanded",
      "Community dictionary",
      "https://example.com/expanded",
      "CC-BY-SA-4.0",
      [{
        headword: "퇴근",
        reading: "",
        partOfSpeech: "noun",
        senseRank: 0,
        glosses: { ko: "직장에서 일을 끝내고 집으로 돌아가거나 돌아옴." },
        examples: {},
      }, {
        headword: "퇴근",
        reading: "",
        partOfSpeech: "noun",
        senseRank: 1,
        glosses: { ko: "다른 자료에만 있는 뜻." },
        examples: {},
      }],
    ))));

    execFileSync(process.execPath, [
      fileURLToPath(new URL("../merge-dictionary-packs.mjs", import.meta.url)),
      "--input", primaryPath,
      "--input", expandedPath,
      "--output", outputPath,
      "--language", "ko",
      "--version", "2026.08.20.5",
      "--title", "한국어 확장 사전",
      "--source-name", "Community dictionary",
      "--source-url", "https://example.com/expanded",
      "--license", "CC-BY-SA-4.0",
      "--minimum-entries", "2",
      "--compact",
    ], { stdio: "pipe" });

    const document = JSON.parse(gunzipSync(readFileSync(outputPath)));
    const entries = document.packs[0].entries;
    assert.equal(entries.length, 2, "the lower-priority duplicate should be removed");
    assert.deepEqual(entries.map(entry => entry.sourcePriority), [0, 1]);
    assert.deepEqual(entries.map(entry => entry.senseRank), [0, 1]);
    assert.equal(entries[0].sourceName, "Official learner dictionary");
    assert.equal(entries[0].sourceUrl, "https://example.com/primary");
    assert.equal(entries[0].license, "CC-BY-SA-2.0-KR");
    assert.equal(entries[1].sourceName, undefined, "the pack-level fallback should not be repeated");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
