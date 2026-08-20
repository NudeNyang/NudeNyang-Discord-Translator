import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const fixture = `<?xml version="1.0" encoding="UTF-8"?>
<LexicalResource><Lexicon>
  <LexicalEntry att="id" val="49299">
    <feat att="partOfSpeech" val="명사" />
    <Lemma><feat att="writtenForm" val="이미지" /></Lemma>
    <Sense att="id" val="1">
      <feat att="definition" val="마음속에 떠오르는 사물에 대한 생각이나 느낌." />
      <SenseExample><feat att="example" val="이 예문은 포함하면 안 된다." /></SenseExample>
      <Equivalent><feat att="language" val="영어" /><feat att="definition" val="An impression of something." /></Equivalent>
      <Equivalent><feat att="language" val="일본어" /><feat att="definition" val="事物に対する考えや感じ。" /></Equivalent>
      <Equivalent><feat att="language" val="중국어" /><feat att="definition" val="对事物的想法或感觉。" /></Equivalent>
    </Sense>
  </LexicalEntry>
  <LexicalEntry att="id" val="70211">
    <feat att="partOfSpeech" val="명사" />
    <Lemma><feat att="writtenForm" val="유출" /></Lemma>
    <WordForm><feat att="pronunciation" val="유출" /><feat att="sound" val="https://example.com/not-redistributable.wav" /></WordForm>
    <Sense att="id" val="1"><feat att="definition" val="귀한 물건이나 정보 등이 불법적으로 외부로 나가 버림." /></Sense>
  </LexicalEntry>
</Lexicon></LexicalResource>`;

test("Korean Basic Dictionary builder keeps multilingual definitions and excludes examples and media", () => {
  const directory = mkdtempSync(join(tmpdir(), "nudenyang-krdict-test-"));
  try {
    const inputDirectory = join(directory, "input");
    const outputPath = join(directory, "ko-basic.json.gz");
    mkdirSync(inputDirectory);
    writeFileSync(join(inputDirectory, "001.xml"), fixture, "utf8");

    execFileSync(process.execPath, [
      fileURLToPath(new URL("../build-krdict-pack.mjs", import.meta.url)),
      "--input", inputDirectory,
      "--output", outputPath,
      "--version", "2026.06.19.1",
      "--minimum-entries", "2",
      "--compact",
    ], { stdio: "pipe" });

    const document = JSON.parse(gunzipSync(readFileSync(outputPath)));
    const [pack] = document.packs;
    assert.equal(pack.language, "ko");
    assert.equal(pack.sourceName, "한국어기초사전, 국립국어원");
    assert.equal(pack.entries.length, 2);
    const image = pack.entries.find(entry => entry.headword === "이미지");
    assert.deepEqual(image.glosses, {
      ko: "마음속에 떠오르는 사물에 대한 생각이나 느낌.",
      en: "An impression of something.",
      ja: "事物に対する考えや感じ。",
      zh: "对事物的想法或感觉。",
    });
    assert.deepEqual(image.examples, {});
    const leak = pack.entries.find(entry => entry.headword === "유출");
    assert.equal(leak.reading, "유출");
    assert.ok(!JSON.stringify(document).includes("not-redistributable.wav"));
    assert.ok(!JSON.stringify(document).includes("이 예문은 포함하면 안 된다."));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
