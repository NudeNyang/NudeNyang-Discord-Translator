import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

test("CC-CEDICT builder emits matching Simplified and Traditional packs", () => {
  const directory = mkdtempSync(join(tmpdir(), "nudenyang-cedict-test-"));
  try {
    const input = join(directory, "cedict.txt.gz");
    const simplified = join(directory, "zh.json.gz");
    const traditional = join(directory, "zh-Hant.json.gz");
    writeFileSync(input, gzipSync([
      "# fixture",
      "傳統 传统 [chuan2 tong3] /tradition/convention/",
      "測試 测试 [ce4 shi4] /to test/test/",
    ].join("\n")));

    execFileSync(process.execPath, [
      fileURLToPath(new URL("../build-cedict-pack.mjs", import.meta.url)),
      "--input", input,
      "--simplified-output", simplified,
      "--traditional-output", traditional,
      "--version", "2026.08.20.1",
      "--minimum-entries", "2",
    ], { stdio: "pipe" });

    const zh = JSON.parse(gunzipSync(readFileSync(simplified))).packs[0];
    const zhHant = JSON.parse(gunzipSync(readFileSync(traditional))).packs[0];
    assert.deepEqual(zh.entries.map(entry => entry.headword), ["传统", "测试"]);
    assert.deepEqual(zhHant.entries.map(entry => entry.headword), ["傳統", "測試"]);
    assert.equal(zh.entries[0].reading, "chuan2 tong3");
    assert.equal(zh.entries[0].glosses.en, "tradition; convention");
    assert.equal(zh.sourceName, "CC-CEDICT via MDBG");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
