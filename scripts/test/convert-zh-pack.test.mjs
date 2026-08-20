import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

test("Traditional Chinese practical entries are converted and deduplicated for Simplified Chinese", () => {
  const root = mkdtempSync(join(tmpdir(), "nudenyang-zh-pack-"));
  const input = join(root, "zh-Hant.json.gz");
  const output = join(root, "zh.json.gz");
  try {
    writeFileSync(input, gzipSync(JSON.stringify({
      schemaVersion: 1,
      packs: [{
        id: "test-zh-Hant",
        language: "zh-Hant",
        version: "2026.08.20.1",
        title: "繁體中文實用詞典",
        sourceName: "Test Wiktionary",
        sourceUrl: "https://example.com",
        license: "CC-BY-SA-4.0",
        edition: "practical",
        entries: [
          { headword: "喜歡", reading: "", partOfSpeech: "verb", senseRank: 0, glosses: { ko: "좋아하다." }, examples: {} },
          { headword: "時間", reading: "", partOfSpeech: "noun", senseRank: 0, glosses: { ko: "시간." }, examples: {} },
          { headword: "時閒", reading: "", partOfSpeech: "noun", senseRank: 1, glosses: { ko: "시간." }, examples: {} },
        ],
      }],
    })));

    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("../convert-zh-pack.mjs", import.meta.url)),
      "--input", input,
      "--output", output,
      "--version", "2026.08.20.2",
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const pack = JSON.parse(gunzipSync(readFileSync(output))).packs[0];
    assert.equal(pack.language, "zh");
    assert.equal(pack.version, "2026.08.20.2");
    assert.ok(pack.entries.some(entry => entry.headword === "喜欢"));
    assert.ok(pack.entries.some(entry => entry.headword === "时间"));
    assert.equal(
      pack.entries.filter(entry => entry.headword === "时间" && entry.glosses.ko === "시간.").length,
      1,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
