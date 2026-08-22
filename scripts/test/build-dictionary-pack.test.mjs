import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

test("generic dictionary builder uses source evidence for a safe default sense order", () => {
  const directory = mkdtempSync(join(tmpdir(), "nudenyang-dictionary-test-"));
  try {
    const input = join(directory, "source.jsonl");
    const output = join(directory, "output.json.gz");
    const rows = [{
      lang_code: "ko",
      word: "잠들다",
      pos: "verb",
      senses: [
        {
          glosses: ["(비유) 무엇이 움직이지 않고 있다. 또는 죽어 있다."],
          examples: [{ text: "도시가 잠들었다." }, { text: "역사가 잠들었다." }],
        },
        {
          glosses: ["잠을 자고 있다."],
          examples: [{ text: "아이가 잠들었다." }],
        },
      ],
      translations: [
        { sense: "잠을 자고 있다.", word: "fall asleep", lang_code: "en" },
        { sense: "잠을 자고 있다.", word: "dormir", lang_code: "fr" },
        { sense: "잠을 자고 있다.", word: "眠る", lang_code: "ja" },
        { sense: "(비유) 무엇이 움직이지 않고 있다. 또는 죽어 있다.", word: "lie dormant", lang_code: "en" },
      ],
    }, {
      lang_code: "ko",
      word: "역사학",
      pos: "noun",
      senses: [
        { glosses: ["역사를 연구하는 학문."] },
        { glosses: ["별개의 두 번째 뜻."] },
      ],
    }];
    writeFileSync(input, `${rows.map(row => JSON.stringify(row)).join("\n")}\n`, "utf8");

    execFileSync(process.execPath, [
      fileURLToPath(new URL("../build-dictionary-pack.mjs", import.meta.url)),
      "--input", input,
      "--output", output,
      "--language", "ko",
      "--source-language", "ko",
      "--gloss-language", "ko",
      "--source-name", "Korean Wiktionary test fixture",
      "--source-url", "https://example.invalid/dictionary",
      "--license", "CC-BY-SA-4.0",
      "--version", "test",
      "--minimum-entries", "1",
      "--compact",
    ], { stdio: "pipe" });

    const document = JSON.parse(gunzipSync(readFileSync(output)));
    const entries = document.packs[0].entries.filter(entry => entry.headword === "잠들다");
    assert.deepEqual(
      entries.map(entry => [entry.senseRank, entry.glosses.ko]),
      [
        [0, "잠을 자고 있다."],
        [1, "(비유) 무엇이 움직이지 않고 있다. 또는 죽어 있다."],
      ],
    );
    assert.deepEqual(
      document.packs[0].entries
        .filter(entry => entry.headword === "역사학")
        .map(entry => entry.glosses.ko),
      ["역사를 연구하는 학문.", "별개의 두 번째 뜻."],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
