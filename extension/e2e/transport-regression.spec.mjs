import { test, expect } from "./harness.mjs";

const PARTS = ["A", "B", "C", "D", "E"].map(letter => letter.repeat(4000));
const ORIGINAL = PARTS.join("");
const TRANSLATED = PARTS.map(part => `번역(${part})`).join("");
const URL = "https://fixture.example.test/long-article/";

test("일반 BR 본문: 품질 실패 원문은 완료 캐시에서 제외하고 수동 재시도는 실패한 노드만 전송", async ({ extension }) => {
  const lines = ["新しいお知らせを皆様に紹介いたします。", "そのようなお言葉をいただき嬉しく思います。", "もちろん結果には個人差がありますが、その時々の状態を確認しております。"];
  const p = await extension.open({
    html: `<main><article><span id="caption">${lines.join("<br><br>")}</span></article></main>`,
    deferTranslations: true,
  });
  await expect.poll(p.sent).toEqual(lines);
  const items = (await p.requests()).flatMap(request => request.items);
  const incomplete = items.find(item => item.text === lines[2]);
  await p.releaseTranslations({ itemOverrides: { [incomplete.id]: { text: lines[2], cacheable: false } } });
  await expect(p.page.locator("#caption")).toHaveText(`번역(${lines[0]})번역(${lines[1]})${lines[2]}`);
  // Failed results stay stable while viewing, without a mutation/scroll retry loop.
  await p.page.evaluate(() => document.querySelector("#caption").setAttribute("data-render", "tick"));
  await p.page.waitForTimeout(350);
  expect(await p.sent()).toEqual(lines);
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  await expect(p.page.locator("#caption")).toHaveText(lines.join(""));
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  await expect.poll(p.sent).toEqual([...lines, lines[2]]);
  await expect(p.page.locator("#caption")).toHaveText(lines.map(line => `번역(${line})`).join(""));
  await expect(p.page.locator("#caption br")).toHaveCount(4);
});

function fixture({ control = false } = {}) {
  return `<style>#long { max-height: 80px; overflow: auto; overflow-wrap: anywhere; }</style>
    <main>${control ? "<p id=control>Budget control</p>" : ""}<p id="long">${ORIGINAL}</p></main>
    <script>
      const source = document.getElementById('long');
      // A fixture-owned observer records every write, including transient text
      // reverted before the next assertion. No extension internals are exposed.
      source.fixtureWrites = [];
      new MutationObserver(records => {
        for (const record of records) {
          if (record.type === 'characterData') source.fixtureWrites.push(record.oldValue, record.target.nodeValue);
          else source.fixtureWrites.push(source.textContent);
        }
      }).observe(source, { subtree: true, childList: true, characterData: true, characterDataOldValue: true });
    </script>`;
}

async function pendingPage(extension) {
  const p = await extension.open({ html: fixture(), url: URL, deferTranslations: true });
  await expect.poll(p.pendingTranslations, { message: "A 20,000-character Text node must reach the native transport as bounded items" }).toBe(1);
  return p;
}

async function advanceToSecondRequest(p) {
  expect(await p.releaseTranslations({ count: 1, keepDeferred: true })).toBe(1);
  await expect.poll(async () => (await p.requests()).length).toBe(2);
  await expect.poll(p.pendingTranslations).toBe(1);
  await expectOriginal(p);
}

async function expectOriginal(p) {
  await expect(p.page.locator("#long")).toHaveText(ORIGINAL);
  expect(await p.page.locator("#long").evaluate(element => element.fixtureWrites.every(value => value === element.textContent))).toBe(true);
}

test("장문 전송: 모든 요청 완료 뒤 한 번만 원래 Text 노드에 적용하고 OFF로 복구", async ({ extension }) => {
  const p = await pendingPage(extension);
  const originalNode = await p.page.locator("#long").evaluateHandle(element => element.firstChild);
  await advanceToSecondRequest(p);
  expect((await p.status()).translatedNodes).toBe(0);
  expect(await p.releaseTranslations({ count: 1, keepDeferred: true })).toBe(1);
  await expect.poll(async () => (await p.requests()).length).toBe(3);
  await expect.poll(p.pendingTranslations).toBe(1);
  await expectOriginal(p);
  await p.releaseTranslations();
  await expect(p.page.locator("#long")).toHaveText(TRANSLATED);
  expect(await originalNode.evaluate(node => node === document.querySelector("#long").firstChild)).toBe(true);
  const requests = await p.requests();
  const items = requests.flatMap(request => request.items);
  expect(items.map(item => item.text).join("")).toBe(ORIGINAL);
  expect(new Set(items.map(item => item.id)).size).toBe(items.length);
  expect(new Set(items.map(item => item.blockId)).size).toBe(1);
  for (const request of requests) {
    expect(request.items.reduce((chars, item) => chars + item.text.length, 0)).toBeLessThanOrEqual(32000);
    expect(request.items.length).toBeLessThanOrEqual(32);
    for (const item of request.items) expect(item.text.length).toBeLessThanOrEqual(4000);
  }
  expect(await p.page.locator("#long").evaluate(element => element.fixtureWrites.filter(value => value.startsWith("번역(")).length)).toBe(1);
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  expect(await originalNode.evaluate(node => node.nodeValue)).toBe(ORIGINAL);
  expect(await originalNode.evaluate(node => node === document.querySelector("#long").firstChild)).toBe(true);
});

test("장문 전송: 중간 OFF는 부분 응답과 남은 조각을 모두 폐기", async ({ extension }) => {
  const p = await pendingPage(extension);
  await advanceToSecondRequest(p);
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  await p.releaseTranslations();
  await p.page.waitForTimeout(400);
  await expectOriginal(p);
  expect((await p.status()).enabled).toBe(false);
  expect((await p.requests()).length).toBe(2);
});

test("장문 전송: 편집기로 재사용된 노드는 늦은 조각으로 덮어쓰지 않음", async ({ extension }) => {
  const p = await pendingPage(extension);
  await advanceToSecondRequest(p);
  await p.page.locator("#long").evaluate(element => {
    element.contentEditable = "true";
    element.firstChild.nodeValue = "An unsent replacement draft";
  });
  await p.releaseTranslations();
  await p.page.waitForTimeout(400);
  await expect(p.page.locator("#long")).toHaveText("An unsent replacement draft");
  expect(await p.page.locator("#long").evaluate(element => element.fixtureWrites.some(value => value.startsWith("번역(")))).toBe(false);
  expect((await p.requests()).length).toBe(2);
});

test("장문 전송: SPA 페이지 이동 뒤 같은 노드에 예전 페이지 조각을 적용하지 않음", async ({ extension }) => {
  const p = await pendingPage(extension);
  await advanceToSecondRequest(p);
  const replacement = "A different page with new text";
  await p.page.locator("#long").evaluate((element, value) => {
    history.pushState({}, "", "/replacement-article/");
    element.firstChild.nodeValue = value;
  }, replacement);
  await p.status();
  await p.releaseTranslations();
  await expect(p.page.locator("#long")).toHaveText(`번역(${replacement})`);
  expect(await p.page.locator("#long").evaluate(element => element.fixtureWrites.filter(value => value.startsWith("번역(")).every(value => value === element.textContent))).toBe(true);
  expect((await p.requests()).slice(2).flatMap(request => request.items.map(item => item.text))).toEqual([replacement]);
});

test("장문 전송: 누락·빈 결과·실패는 부분 표시와 나머지 조각의 추가 전송을 막음", async ({ extension }) => {
  for (const failure of ["missing", "empty", "error"]) {
    const p = await pendingPage(extension);
    const [request] = await p.requests();
    expect(request.items.length).toBeGreaterThan(1);
    const itemId = request.items[0].id;
    const options = failure === "missing" ? { omitItemIds: [itemId] }
      : failure === "empty" ? { emptyItemIds: [itemId] } : { errorCode: "synthetic_translation_error" };
    await p.releaseTranslations(options);
    await p.page.waitForTimeout(500);
    await expectOriginal(p);
    expect((await p.requests()).length, `${failure}: same-node sibling segments must not be sent after invalidation`).toBe(1);
    await p.page.close();
  }
});

test("장문 전송: 외부 번역 한도보다 긴 노드의 부분 번역을 표시하지 않음", async ({ extension }) => {
  const p = await extension.open({ html: fixture({ control: true }), url: URL,
    translator: "deepl", settings: { externalPageCharLimit: 10000 } });
  await expect(p.page.locator("#control")).toHaveText("번역(Budget control)");
  // The control proves that the pipeline ran; watch across collection/application
  // rounds so a prefix response cannot briefly replace the long original.
  await p.page.waitForTimeout(1200);
  await expectOriginal(p);
  const sent = await p.sent();
  expect(sent.reduce((chars, text) => chars + text.length, 0)).toBeLessThanOrEqual(10000);
  expect((await p.status()).sentChars).toBeLessThanOrEqual(10000);
});
