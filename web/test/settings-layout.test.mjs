import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("theme and shortcut settings share one usage environment section", () => {
  const environmentSection = markup.match(
    /<section class="settings-section" aria-labelledby="environment-heading">[\s\S]*?<\/section>/,
  )?.[0] || "";

  assert.match(environmentSection, /<h2 id="environment-heading">사용 환경<\/h2>/);
  assert.match(environmentSection, /<h3>설정창 테마<\/h3>/);
  assert.match(environmentSection, /<h3>번역 켜기·끄기<\/h3>/);
  assert.equal((environmentSection.match(/class="setting-row"/g) || []).length, 2);
  assert.doesNotMatch(markup, /id="appearance-heading"|id="shortcut-heading"/);
});
