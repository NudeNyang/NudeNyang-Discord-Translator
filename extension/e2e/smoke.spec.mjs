import { test, expect } from "./harness.mjs";

test("MV3 격리 영역과 실제 브라우저의 DOM 적용·F4 원문 복구", async ({ extension }) => {
  const p = await extension.open({ html: `<main><p id="intro">A short <strong id="emphasis">important</strong> paragraph.</p>
    <p id="address"><a href="https://example.com/">https://example.com/</a></p>
    <p><code id="code">do_not_translate()</code></p>
    <textarea id="draft">Unsent draft</textarea>
    <button id="button" onclick="this.dataset.clicked = 'yes'">Click here</button></main>` });
  await expect(p.page.locator("#emphasis")).toHaveText("번역(important)");
  await expect.poll(p.sent).toEqual(expect.arrayContaining(["A short ", "important", " paragraph."]));
  const requests = await p.requests();
  expect(requests[0].client.extensionVersion).toBeDefined();
  expect(requests[0].client.browser).toBe("chrome");
  expect(await p.page.evaluate(() => "__NudeNyangE2E" in globalThis || "NudeNyangSiteAdapters" in globalThis)).toBe(false);
  const sent = await p.sent();
  for (const protectedText of ["https://example.com/", "do_not_translate()", "Unsent draft", "Click here"]) {
    expect(sent).not.toContain(protectedText);
  }
  await expect(p.page.locator("#address a")).toHaveAttribute("href", "https://example.com/");
  await p.page.locator("#button").click();
  await expect(p.page.locator("#button")).toHaveAttribute("data-clicked", "yes");
  await p.page.keyboard.press("F4");
  await expect(p.page.locator("#intro")).toHaveText("A short important paragraph.");
  expect((await p.status()).enabled).toBe(false);
  await expect(p.page.locator("#emphasis")).toHaveJSProperty("tagName", "STRONG");
});

test("실제 MutationObserver가 늦게 삽입한 문단을 번역하고 끄면 복구한다", async ({ extension }) => {
  const p = await extension.open({ html: `<main id="article"><p>Initial paragraph</p></main>
    <button id="append" onclick="document.querySelector('#article').insertAdjacentHTML('beforeend', '<p id=added>Late paragraph</p>')">Append</button>` });
  await expect(p.page.locator("#article > p")).toHaveText("번역(Initial paragraph)");
  await p.page.locator("#append").click();
  await expect(p.page.locator("#added")).toHaveText("번역(Late paragraph)");
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  await expect(p.page.locator("#added")).toHaveText("Late paragraph");
});

test("번역 응답을 보류한 동안 OFF를 누르면 늦은 응답이 원문을 덮지 않는다", async ({ extension }) => {
  const p = await extension.open({ html: "<main><p id=body>Original paragraph</p></main>", deferTranslations: true });
  await expect.poll(p.pendingTranslations).toBeGreaterThan(0);
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  expect(await p.releaseTranslations()).toBeGreaterThan(0);
  await expect.poll(async () => (await p.status()).enabled).toBe(false);
  // Observe the OFF state across the async runtime reply and animation frames;
  // an immediately passing text assertion could otherwise race the late write.
  await p.page.waitForTimeout(300);
  await expect(p.page.locator("#body")).toHaveText("Original paragraph");
});
