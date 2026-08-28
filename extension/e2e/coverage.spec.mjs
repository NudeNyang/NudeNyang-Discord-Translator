import { test, expect } from "./harness.mjs";
import { structureCase, STRUCTURE_CASE_COUNT } from "../test/fixtures/generated-structures.mjs";

for (let index = 0; index < 32; index++) {
  const caseId = (index * 73) % STRUCTURE_CASE_COUNT;
  test(`구조 조합 ${caseId}: 동적 생성·재생성·내용 수정·원문 복원`, async ({ extension }, testInfo) => {
    const entry = structureCase(caseId);
    const p = await extension.open({ html: "<main></main>" });
    try {
      await p.page.evaluate(html => { document.body.innerHTML = html; }, entry.html);
      await expect(p.page.locator("#subject")).toHaveText(entry.expected.map(text => `번역(${text})`).join(""));
      const firstCount = (await p.sent()).length;
      await p.page.evaluate(html => { document.body.innerHTML = html; }, entry.html);
      await expect(p.page.locator("#subject")).toHaveText(entry.expected.map(text => `번역(${text})`).join(""));
      expect(await p.sent()).toHaveLength(firstCount);
      await p.page.locator("#subject").evaluate(e => { e.textContent = "変更後の文章です。"; });
      await expect(p.page.locator("#subject")).toHaveText("번역(変更後の文章です。)");
      await p.message({ type: "nudenyang-set-enabled", enabled: false });
      await expect(p.page.locator("#subject")).toHaveText("変更後の文章です。");
      expect((await p.sent()).some(text => /private-sentinel|https:/.test(text))).toBe(false);
    } catch (error) {
      await testInfo.attach("generated-case", { body: JSON.stringify(entry), contentType: "application/json" });
      throw error;
    }
  });
}

test("자동 생성 구조: display contents 문단도 화면의 자식 텍스트를 번역한다", async ({ extension }) => {
  const entry = structureCase(192);
  const p = await extension.open({ html: entry.html });
  await expect(p.page.locator("#subject")).toHaveText(entry.expected.map(text => `번역(${text})`).join(""));
  expect(await p.sent()).toEqual(entry.expected);
});

test("범용 떠 있는 링크: 너비 없는 inline 부모도 스크롤 후 번역한다", async ({ extension }) => {
  const p = await extension.open({ html: `<main><p>Top paragraph</p><div style="height:2000px"></div>
    <ul><li style="display:inline"><a id="next" style="float:right" href="/page-2">Next page</a></li></ul></main>` });
  await p.page.locator("#next").scrollIntoViewIfNeeded();
  await expect(p.page.locator("#next")).toHaveText("번역(Next page)");
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  await expect(p.page.locator("#next")).toHaveText("Next page");
});

test("범용 구역 제목: section header의 제목은 번역하고 작성자·입력·전역 머리말은 보호한다", async ({ extension }) => {
  const p = await extension.open({ html: `<header><h2>Global account heading</h2></header>
    <main><section><header><div><h2 id="heading">Related public articles</h2></div>
      <a rel="author" href="/person">Author sentinel</a><input value="draft sentinel"></header>
      <p>Public paragraph</p></section><article><header><h3>Author heading sentinel</h3></header></article></main>` });
  await expect(p.page.locator("#heading")).toHaveText("번역(Related public articles)");
  expect((await p.sent()).sort()).toEqual(["Public paragraph", "Related public articles"].sort());
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  await expect(p.page.locator("#heading")).toHaveText("Related public articles");
});

test("독립 진단은 요청 중·결과 누락·품질 실패를 구분하고 원문을 내보내지 않는다", async ({ extension }) => {
  const p = await extension.open({ html: `<main><p id="a">公開の文章です。</p><p id="b">新しいお知らせです。</p>
    <p id="c">説明を詳しく紹介します。</p><div contenteditable>private draft sentinel</div></main>`, deferTranslations: true });
  await expect.poll(p.sent).toHaveLength(3);
  const audit = () => p.message({ type: "nudenyang-audit" });
  await expect.poll(async () => (await audit()).counts?.requesting).toBe(3);
  const items = (await p.requests()).flatMap(request => request.items);
  await p.releaseTranslations({ omitItemIds: [items[1].id], itemOverrides: { [items[2].id]: { text: items[2].text, cacheable: false } } });
  await expect(p.page.locator("#a")).toHaveText(`번역(${items[0].text})`);
  await expect.poll(async () => (await audit()).counts).toEqual({ applied: 1, missing_result: 1, quality_failed: 1 });
  const report = await audit();
  expect(report.excluded.protected).toBe(1);
  expect(JSON.stringify(report)).not.toMatch(/公開|お知らせ|説明|private|https:/);
  // Auditing never retries a failed translation or changes the DOM.
  await audit();
  expect(await p.sent()).toHaveLength(3);
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  expect((await audit()).status).toBe("unavailable");
});

test("독립 진단은 수집기 누락을 실제 페이지에서 찾아내고 자동 집계도 제공한다", async ({ extension }) => {
  const p = await extension.open({ enabled: false, html: `<main><p id="known">Existing paragraph</p><div id="miss">Missed paragraph</div></main>` });
  // Deliberately fault the collector only. The independent walker is unchanged.
  await extension.worker.evaluate(async id => {
    await chrome.scripting.executeScript({ target: { tabId: id }, func: () => {
      const original = globalThis.NudeNyangDomPolicy;
      globalThis.NudeNyangDomPolicy = { ...original, createPublicDomPolicy(document, adapter) {
        const policy = original.createPublicDomPolicy(document, adapter);
        return { ...policy, collectBlocks(root, visit) {
          return policy.collectBlocks(root, block => { if (block.id !== "miss") visit(block); });
        } };
      } };
      globalThis.__nudeNyangContentRuntime.dispose();
    } });
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ["content.js"] });
  }, p.tabId);
  await expect.poll(async () => (await p.message({ type: "nudenyang-ready" })).ready).toBe(true);
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  await expect(p.page.locator("#known")).toHaveText("번역(Existing paragraph)");
  // Observe the scheduled audit BEFORE ever sending the explicit audit command.
  await expect.poll(async () => (await p.status()).coverage?.counts?.undiscovered).toBe(1);
  await expect.poll(async () => (await p.message({ type: "nudenyang-audit" })).counts?.undiscovered).toBe(1);
  expect(await p.sent()).toEqual(["Existing paragraph"]);
});

test("진단은 비활성·민감 페이지와 메신저의 독립 수집을 허용하지 않는다", async ({ extension }) => {
  for (const url of ["https://fixture.example.test/account/", "https://x.com/messages/123"]) {
    const p = await extension.open({ url, html: "<main><p>private sentinel</p></main>" });
    expect((await p.message({ type: "nudenyang-audit" })).status).toBe("unavailable");
    expect(await p.sent()).toEqual([]);
    await p.page.close();
  }
});
