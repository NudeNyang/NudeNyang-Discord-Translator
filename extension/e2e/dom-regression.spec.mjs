import { test, expect } from "./harness.mjs";
import {
  CSS_REVEAL_HTML, FRAGMENTED_TEXT_HTML, LONG_TEXT, PUBLIC_DOCUMENT_URL,
  PUBLIC_NODE_CHANGES, REUSED_TEXT_HTML, SHORT_TEXT_HTML, VIRTUAL_LIST_HTML,
  PUBLIC_SURFACES_HTML, PUBLIC_SURFACE_COPY,
} from "../test/fixtures/dom-translation.mjs";

// The same minimal HTML used by node:test runs through an actual MV3 extension.
// No service selector, live account, native app, or translation provider is used.
test("범용 공개 UI: 게시물 팝업·분류 메뉴와 작성자·입력 보호", async ({ extension }) => {
  const p = await extension.open({ html: PUBLIC_SURFACES_HTML, url: PUBLIC_DOCUMENT_URL });
  for (const [id, text] of PUBLIC_SURFACE_COPY) await expect(p.page.locator(`#${id}`)).toHaveText(`번역(${text})`);
  await expect(p.page.locator("#caption")).toHaveText("번역(A public post caption)번역(Another caption line)");
  expect((await p.sent()).some(text => /Secret|Alice Author|alice_42|@alice|https:\/\/example.org\//u.test(text))).toBe(false);
  await expect(p.page.locator("#category")).toHaveAttribute("href", "https://catalog.example.org/browse");
  await expect(p.page.locator("#caption br")).toHaveCount(1);
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  for (const [id, text] of PUBLIC_SURFACE_COPY) await expect(p.page.locator(`#${id}`)).toHaveText(text);
});

for (const pending of [true, false]) {
  test(`범용 공개 UI: ${pending ? "응답" : "캐시"} 대기 중 의미가 바뀐 영역 보호`, async ({ extension }) => {
    const p = await extension.open({ html: PUBLIC_SURFACES_HTML, url: PUBLIC_DOCUMENT_URL, deferTranslations: pending });
    if (pending) await expect.poll(p.sent).toContain("Shopping categories");
    else {
      await expect(p.page.locator("#category")).toHaveText("번역(Shopping categories)");
      await p.message({ type: "nudenyang-set-enabled", enabled: false });
    }
    await p.page.evaluate(() => {
      document.querySelector("#category").setAttribute("href", "/account");
      document.querySelector("#caption").setAttribute("contenteditable", "true");
      document.querySelector("#post-layout").setAttribute("itemprop", "author");
    });
    if (pending) await p.releaseTranslations();
    else await p.message({ type: "nudenyang-set-enabled", enabled: true });
    await expect(p.page.locator("#control")).toHaveText("번역(Visible control text)");
    await expect(p.page.locator("#category")).toHaveText("Shopping categories");
    await expect(p.page.locator("#caption")).toHaveText("A public post captionAnother caption line");
    await expect(p.page.locator("#post-layout")).toHaveText("More public details");
  });
}

test("범용 가상 목록: 재생성된 본문은 새 전송 없이 번역을 재사용한다", async ({ extension }) => {
  const p = await extension.open({ html: VIRTUAL_LIST_HTML, url: PUBLIC_DOCUMENT_URL });
  const body = p.page.locator("#changing");
  await expect(body).toHaveText("번역(Reusable list message)");
  const count = (await p.requests()).length;
  await body.evaluate(element => { element.innerHTML = "<span>Reusable list message</span>"; });
  await expect(body).toHaveText("번역(Reusable list message)");
  expect((await p.requests()).length).toBe(count);
  await body.evaluate(element => {
    const spacer = document.createElement("div");
    spacer.style.height = "2400px";
    element.before(spacer);
    element.innerHTML = "<span>Reusable list message</span>";
  });
  await body.scrollIntoViewIfNeeded();
  await expect(body).toHaveText("번역(Reusable list message)");
  expect((await p.requests()).length).toBe(count);
});

test("재표시 캐시: 내용 수정과 목표 언어 변경은 새 요청을 만든다", async ({ extension }) => {
  const p = await extension.open({ html: VIRTUAL_LIST_HTML, url: PUBLIC_DOCUMENT_URL });
  const body = p.page.locator("#changing");
  await expect(body).toHaveText("번역(Reusable list message)");
  await body.evaluate(element => { element.innerHTML = "<span>Edited list message</span>"; });
  await expect(body).toHaveText("번역(Edited list message)");
  expect(await p.sent()).toContain("Edited list message");
  const before = (await p.requests()).length;
  await p.message({ type: "nudenyang-set-target-language", targetLanguage: "EN" });
  await expect.poll(async () => (await p.requests()).length).toBeGreaterThan(before);
  expect((await p.requests()).at(-1).targetLanguage).toBe("EN");
  await expect(body).toHaveText("번역(Edited list message)");
});

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
