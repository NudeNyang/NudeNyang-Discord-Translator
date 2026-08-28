import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import "../site-adapters.js";
import "../content-helpers.js";
import "../dom-policy.js";
import "../translation-audit.js";
import { structureCase, STRUCTURE_CASE_COUNT, minimizeStructure } from "./fixtures/generated-structures.mjs";

function fixture(t, html) {
  const dom = new JSDOM(html, { url: "https://example.org/article/" });
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const policy = globalThis.NudeNyangDomPolicy.createPublicDomPolicy(document,
    globalThis.NudeNyangSiteAdapters.UNIVERSAL_ADAPTER);
  return { document, policy };
}

test("DOM 진단은 보호·비가시성·링크 식별자·허용 본문을 이유로 구분한다", t => {
  const { document, policy } = fixture(t, `<main><p id="body">公開本文</p>
    <p contenteditable id="editor">private draft</p><p hidden id="hidden">hidden</p>
    <p><a id="url" href="https://example.org">https://example.org</a></p>
    <form><p id="form">private form</p></form><button id="control">Action</button></main>`);
  for (const [id, reason] of Object.entries({ body: "eligible", editor: "protected", hidden: "hidden", url: "identity_link", form: "private_scope", control: "excluded_scope" })) {
    assert.equal(policy.explain(document.getElementById(id).firstChild).reason, reason, id);
  }
});

test("독립 검사는 수집기를 호출하지 않고 누락을 발견하며 보호 본문을 읽지 않는다", async t => {
  const { document, policy } = fixture(t, `<main><p id="good">公開済み</p><div id="miss">未発見の本文</div>
    <div contenteditable id="secret">secret</div><iframe src="https://other.example/"></iframe></main>`);
  Object.defineProperty(document.getElementById("secret").firstChild, "nodeValue", { get() { throw new Error("private text read"); } });
  // No collector or block selector is passed to the independent walker.
  const audit = globalThis.NudeNyangTranslationAudit;
  assert.ok(audit, "independent audit module must exist");
  const report = await audit.inspect(document, {
    boundary: policy.auditBoundary, explain: policy.explain, visible: () => true,
    stage: node => node.parentElement.id === "good" ? "applied" : "undiscovered",
  });
  assert.equal(report.counts.applied, 1);
  assert.equal(report.counts.undiscovered, 1);
  assert.equal(report.excluded.protected, 1);
  assert.equal(report.unsupported.frame, 1);
  assert.equal(report.suspects.length, 1);
  assert.doesNotMatch(JSON.stringify(report), /secret|公開|未発見|https:|other\.example/);
});

test("독립 검사는 작업량 제한과 취소를 완료로 위장하지 않는다", async t => {
  const { document, policy } = fixture(t, `<main>${"<p>public text</p>".repeat(100)}</main>`);
  const audit = globalThis.NudeNyangTranslationAudit;
  assert.ok(audit, "independent audit module must exist");
  const options = { boundary: policy.auditBoundary, explain: policy.explain, visible: () => true, stage: () => "undiscovered" };
  const limited = await audit.inspect(document, { ...options, maxNodes: 12 });
  assert.equal(limited.status, "limited");
  assert.equal(limited.visited, 12);
  const cancelled = await audit.inspect(document, { ...options, isCurrent: () => false });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.visited, 0);
  const timeLimited = await audit.inspect(document, { ...options, maxDurationMs: 0 });
  assert.equal(timeLimited.status, "limited");
  assert.equal(timeLimited.visited, 0);
});

test("자동 생성한 2048개 구조는 본문을 중복·누락 없이 수집하며 보호 텍스트를 제외한다", async t => {
  const { document, policy } = fixture(t, "<main></main>");
  const collect = entry => {
    document.body.innerHTML = entry.html;
    const found = [];
    policy.collectBlocks(document, block => {
      const allowed = policy.eligibility(block);
      const walker = document.createTreeWalker(block, 4);
      while (walker.nextNode()) if (allowed(walker.currentNode)) found.push(walker.currentNode.nodeValue);
    });
    return found;
  };
  for (let index = 0; index < STRUCTURE_CASE_COUNT; index++) {
    const entry = structureCase(index);
    const found = collect(entry);
    if (JSON.stringify(found) !== JSON.stringify(entry.expected)) {
      const minimal = await minimizeStructure(entry, candidate => JSON.stringify(collect(candidate)) !== JSON.stringify(candidate.expected));
      assert.deepEqual(found, entry.expected, `case ${index}: ${JSON.stringify(minimal.dimensions)}\n${minimal.html}`);
    }
  }
});

test("실패 구조 축소는 실패 조건과 원문 정답을 보존한다", async () => {
  const entry = structureCase(511);
  const minimal = await minimizeStructure(entry, candidate => candidate.dimensions.layout === "contents");
  assert.equal(minimal.dimensions.layout, "contents");
  assert.equal(minimal.dimensions.wrappers, 0);
  assert.deepEqual(minimal.expected, entry.expected);
});

test("독립 검사는 약한 제외 규칙을 검토 대상으로 남기고 프레임·Shadow DOM은 완료 대상에 섞지 않는다", async t => {
  const { document, policy } = fixture(t, '<header><h2>Unclassified heading</h2></header><div id="host"></div><canvas></canvas>');
  document.getElementById("host").attachShadow({ mode: "open" }).innerHTML = "<p>shadow sentinel</p>";
  const report = await globalThis.NudeNyangTranslationAudit.inspect(document, {
    boundary: policy.auditBoundary, explain: policy.explain, visible: () => true, stage: () => "applied",
  });
  assert.equal(report.candidates, 0);
  assert.equal(report.review[0].reason, "excluded_scope");
  assert.equal(report.unsupported.shadow_root, 1);
  assert.equal(report.unsupported.drawing, 1);
  assert.doesNotMatch(JSON.stringify(report), /sentinel|Unclassified/);
});
