import { test, expect } from "./harness.mjs";
import {
  CSS_REVEAL_HTML, FRAGMENTED_TEXT_HTML, LONG_TEXT, PUBLIC_DOCUMENT_URL,
  PUBLIC_NODE_CHANGES, REUSED_TEXT_HTML, SHORT_TEXT_HTML,
} from "../test/fixtures/dom-translation.mjs";

// The same minimal HTML used by node:test runs through an actual MV3 extension.
// No service selector, live account, native app, or translation provider is used.
for (const change of ["class", "style"]) {
  test(`범용 DOM: ${change}만 바뀌어 나타난 본문`, async ({ extension }) => {
    const html = change === "class" ? CSS_REVEAL_HTML
      : CSS_REVEAL_HTML.replace('class="concealed"', 'style="visibility:hidden"');
    const p = await extension.open({ html, url: PUBLIC_DOCUMENT_URL });
    await expect(p.page.locator("#control")).toHaveText("번역(Visible control text)");
    expect(await p.sent()).not.toContain("Delayed public text");
    await p.page.locator("#changing").evaluate((element, change) => {
      if (change === "class") element.classList.remove("concealed");
      else element.style.visibility = "visible";
    }, change);
    await expect(p.page.locator("#changing")).toHaveText("번역(Delayed public text)");
    expect((await p.sent()).filter(text => text === "Delayed public text")).toHaveLength(1);
  });
}

for (const { label, attribute, value } of PUBLIC_NODE_CHANGES) {
  test(`범용 DOM: 응답 대기 중 ${label} 전환 보호`, async ({ extension }) => {
    const p = await extension.open({ html: REUSED_TEXT_HTML, url: PUBLIC_DOCUMENT_URL, deferTranslations: true });
    await expect.poll(p.sent).toContain("Original public text");
    await p.page.locator("#changing").evaluate((element, { attribute, value }) => {
      element.setAttribute(attribute, value);
    }, { attribute, value });
    await p.releaseTranslations();
    await expect(p.page.locator("#control")).toHaveText("번역(Visible control text)");
    await expect(p.page.locator("#changing")).toHaveText("Original public text");
  });

  test(`범용 DOM: 원문 비교 중 ${label} 전환 보호`, async ({ extension }) => {
    const p = await extension.open({ html: REUSED_TEXT_HTML, url: PUBLIC_DOCUMENT_URL });
    await expect(p.page.locator("#changing")).toHaveText("번역(Original public text)");
    await p.message({ type: "nudenyang-set-enabled", enabled: false });
    await expect(p.page.locator("#changing")).toHaveText("Original public text");
    await p.page.locator("#changing").evaluate((element, { attribute, value }) => {
      element.setAttribute(attribute, value);
    }, { attribute, value });
    const before = (await p.requests()).length;
    await p.message({ type: "nudenyang-set-enabled", enabled: true });
    await expect(p.page.locator("#control")).toHaveText("번역(Visible control text)");
    await expect(p.page.locator("#changing")).toHaveText("Original public text");
    expect((await p.requests()).length).toBe(before);
  });
}

test("범용 DOM: 긴 단일 텍스트와 한 글자 인라인을 원래 노드에 적용·복구", async ({ extension }) => {
  const p = await extension.open({ html: FRAGMENTED_TEXT_HTML, url: PUBLIC_DOCUMENT_URL });
  const originalNode = await p.page.locator("#long").evaluateHandle(element => element.firstChild);
  await expect(p.page.locator("#long")).toContainText("번역(");
  expect(await originalNode.evaluate(node => node === document.querySelector("#long").firstChild)).toBe(true);
  await p.page.locator("#fragmented").scrollIntoViewIfNeeded();
  await expect(p.page.locator("#fragmented > *")).toHaveText(["번역(夢)", "번역(を)", "번역(見)", "번역(る)"]);
  for (const request of await p.requests()) {
    expect(request.items.length).toBeLessThanOrEqual(32);
    expect(request.items.reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(32000);
    for (const item of request.items) expect(item.text.length).toBeLessThanOrEqual(4000);
  }
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  expect(await originalNode.evaluate(node => node.nodeValue)).toBe(LONG_TEXT);
  await expect(p.page.locator("#fragmented")).toHaveText("夢を見る");
  await expect(p.page.locator("#fragmented em")).toHaveText("を");
  await expect(p.page.locator("#fragmented strong")).toHaveText("る");
});

test("범용 DOM: 한 글자 자연어와 숫자·기호를 구분해 수치를 보존", async ({ extension }) => {
  const p = await extension.open({ html: SHORT_TEXT_HTML, url: PUBLIC_DOCUMENT_URL });
  await expect(p.page.locator("#word")).toHaveText("번역(夢)");
  await expect(p.page.locator("#count")).toHaveText("3");
  await expect(p.page.locator("#punctuation")).toHaveText("...");
  await expect(p.page.locator("#icon")).toHaveText("🐱");
  expect(await p.sent()).toEqual(["夢"]);
});
