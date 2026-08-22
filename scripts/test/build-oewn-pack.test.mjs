import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

test("Open English WordNet builder joins lexemes to distinct synset definitions", () => {
  const directory = mkdtempSync(join(tmpdir(), "nudenyang-oewn-test-"));
  try {
    const input = join(directory, "source");
    const output = join(directory, "output.json.gz");
    mkdirSync(input);
    writeFileSync(join(input, "entries-t.json"), JSON.stringify({
      test: { n: { pronunciation: [{ value: "test" }], sense: [
        { synset: "0001-n" },
        { synset: "0002-n" },
      ] } },
    }));
    writeFileSync(join(input, "noun.act.json"), JSON.stringify({
      "0001-n": { definition: ["a procedure for measuring"], members: ["test"], partOfSpeech: "n" },
      "0002-n": { definition: ["an examination"], members: ["test"], partOfSpeech: "n" },
    }));

    execFileSync(process.execPath, [
      fileURLToPath(new URL("../build-oewn-pack.mjs", import.meta.url)),
      "--input", input,
      "--output", output,
      "--version", "2025.1",
      "--minimum-entries", "1",
    ], { stdio: "pipe" });

    const document = JSON.parse(gunzipSync(readFileSync(output)));
    assert.equal(document.packs[0].sourceName, "Open English WordNet 2025");
    assert.deepEqual(
      document.packs[0].entries.map(entry => entry.glosses.en),
      ["a procedure for measuring", "an examination"],
    );
    assert.ok(document.packs[0].entries.every(entry => entry.reading === "test"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
