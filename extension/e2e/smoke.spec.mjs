import { test, expect } from "./harness.mjs";
import { MESSENGER_CASES } from "./fixtures/compatibility.mjs";

test("메신저 번역 대기 중 빠른 전체 OFF·ON은 이전 응답을 버리고 새 번역을 계속한다", async ({ extension }) => {
  const entry = MESSENGER_CASES.find(item => item.id === "discord");
  const p = await extension.open({ html: entry.html, url: entry.url, consent: true, deferTranslations: true });
  await expect.poll(p.pendingTranslations).toBeGreaterThan(0);
  await extension.worker.evaluate(async tabId => {
    let sawOff = false;
    const writes = new Promise(resolve => {
      function changed(values, area) {
        if (area !== "local" || !values.webTranslationEnabled) return;
        if (values.webTranslationEnabled.newValue === false) sawOff = true;
        else if (sawOff && values.webTranslationEnabled.newValue === true) {
          chrome.storage.onChanged.removeListener(changed);
          resolve();
        }
      }
      chrome.storage.onChanged.addListener(changed);
    });
    await globalThis.__NudeNyangE2E.dispatchCommand(tabId);
    await globalThis.__NudeNyangE2E.dispatchCommand(tabId);
    await writes;
  }, p.tabId);
  const oldItems = (await p.requests()).flatMap(request => request.items);
  await p.releaseTranslations({ itemOverrides: Object.fromEntries(oldItems.map(item => [item.id, { text: "STALE RESULT" }])) });
  for (const [selector, source] of entry.copies) {
    await expect(p.page.locator(selector)).toHaveText(`번역(${source})`);
  }
  for (const [selector, source] of entry.guards) await expect(p.page.locator(selector)).toHaveText(source);
  expect((await p.status()).enabled).toBe(true);
});

test("전체 F4 상태는 다른 사이트의 독립 새 탭에도 유지되고 모든 탭을 끈다", async ({ extension }) => {
  const first = await extension.open({ html: "<main><p id=body>First public page</p></main>", enabled: false });
  await first.page.keyboard.press("F4");
  await expect(first.page.locator("#body")).toHaveText("번역(First public page)");
  const second = await extension.context.newPage();
  await second.route("https://another.example.test/**", route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><main><p id=body>Second public page</p></main>",
  }));
  await second.goto("https://another.example.test/");
  await expect(second.locator("#body")).toHaveText("번역(Second public page)");
  await second.keyboard.press("F4");
  await expect(second.locator("#body")).toHaveText("Second public page");
  await expect(first.page.locator("#body")).toHaveText("First public page");
  await second.reload();
  await expect(second.locator("#body")).toHaveText("Second public page");
  await second.close();
});

test("전체 번역은 이전 동의를 승격하지 않고 기존 개인정보 화면에서 확인한 뒤에만 시작한다", async ({ extension }) => {
  const p = await extension.open({ html: "<main><p id=body>Consent protected public text</p></main>", enabled: null, globalConsent: false, consent: true });
  expect((await p.status()).enabled).toBe(false);
  expect(await p.sent()).toEqual([]);
  const opened = extension.context.waitForEvent("page");
  await p.page.keyboard.press("F4");
  const notice = await opened;
  await notice.waitForURL(/messenger-privacy\.html\?scope=web$/u);
  await expect(notice.locator("#privacy-confirm")).toBeEnabled();
  await expect(notice.locator("#privacy-accept")).toBeDisabled();
  expect(await p.sent()).toEqual([]);
  await notice.locator("#privacy-confirm").check();
  await notice.locator("#privacy-accept").click();
  await expect(notice.locator("#privacy-revoke")).toBeVisible();
  await p.page.bringToFront();
  await expect(p.page.locator("#body")).toHaveText("번역(Consent protected public text)");
  await notice.locator("#privacy-revoke").click();
  await expect(p.page.locator("#body")).toHaveText("Consent protected public text");
  await p.page.reload();
  await expect.poll(async () => (await p.status()).enabled).toBe(false);
  await notice.close();
});

test("실제 팝업의 전체 OFF는 다른 탭의 지연 응답을 버리고 F4와 같은 상태를 쓴다", async ({ extension }) => {
  const p = await extension.open({ html: "<main><p id=body>Delayed global response</p></main>", deferTranslations: true });
  await expect.poll(p.pendingTranslations).toBeGreaterThan(0);
  const popup = await extension.context.newPage();
  await popup.goto(`chrome-extension://${extension.extensionId}/popup.html`);
  await expect(popup.locator("#enabled")).toBeChecked();
  await popup.locator(".heading > label.switch").click();
  await expect.poll(async () => (await p.status()).globalEnabled).toBe(false);
  await p.releaseTranslations();
  await p.page.waitForTimeout(300);
  await expect(p.page.locator("#body")).toHaveText("Delayed global response");
  await expect(popup.locator("#always-translate-site")).toHaveCount(0);
  await p.page.bringToFront();
  await p.page.keyboard.press("F4");
  await expect(popup.locator("#enabled")).toBeChecked();
  await p.page.bringToFront();
  await expect(p.page.locator("#body")).toHaveText("번역(Delayed global response)");
  await popup.close();
});

test("민감 경로에서도 F4는 전체 OFF만 수행하고 그 페이지 본문은 읽지 않는다", async ({ extension }) => {
  const p = await extension.open({ html: "<main><p id=body>Public page before private route</p></main>" });
  await expect(p.page.locator("#body")).toHaveText("번역(Public page before private route)");
  const privatePage = await extension.context.newPage();
  await privatePage.route("https://sensitive.example.test/**", route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><main><p id=body>Private account text</p><input value='Private draft'></main>",
  }));
  await privatePage.goto("https://sensitive.example.test/account/");
  await privatePage.keyboard.press("F4");
  await expect(p.page.locator("#body")).toHaveText("Public page before private route");
  await expect(privatePage.locator("#body")).toHaveText("Private account text");
  expect(await p.sent()).not.toContain("Private account text");
  expect(await p.sent()).not.toContain("Private draft");
  await privatePage.close();
});

test("팝업을 한 번도 열지 않은 페이지에서 실제 F4로 번역을 켜고 끈다", async ({ extension }) => {
  const p = await extension.open({ html: "<main><p id=body>Public shortcut paragraph</p></main>", enabled: false });
  expect((await p.status()).enabled).toBe(false);
  await p.page.keyboard.press("F4");
  await expect(p.page.locator("#body")).toHaveText("번역(Public shortcut paragraph)");
  await p.page.keyboard.press("F4");
  await expect(p.page.locator("#body")).toHaveText("Public shortcut paragraph");
});

test("팝업 없는 F4는 사이트의 선행 키보드 처리에도 한 번만 전환한다", async ({ extension }) => {
  const p = await extension.open({ enabled: false, html: `<script>
    window.addEventListener('keydown', event => {
      if (event.key === 'F4') { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  </script><main><p id=body>Keyboard-handled public paragraph</p></main>` });
  await p.page.keyboard.press("F4");
  await expect(p.page.locator("#body")).toHaveText("번역(Keyboard-handled public paragraph)");
  await p.page.keyboard.press("F4");
  await expect(p.page.locator("#body")).toHaveText("Keyboard-handled public paragraph");
});

test("팝업 없이 보조 단축키 명령 이벤트로 번역을 켜고 끈다", async ({ extension }) => {
  const p = await extension.open({ html: "<main><p id=body>Command shortcut paragraph</p></main>", enabled: false });
  await extension.command(p.tabId);
  await expect(p.page.locator("#body")).toHaveText("번역(Command shortcut paragraph)");
  await extension.command(p.tabId);
  await expect(p.page.locator("#body")).toHaveText("Command shortcut paragraph");
});

test("수신자가 사라진 탭은 팝업 없이 활성화 복구 후 실제 F4가 작동한다", async ({ extension }) => {
  const p = await extension.open({ html: "<main><p id=body>Recovered shortcut paragraph</p></main>", enabled: false });
  // Fault-inject the same disposed content state as an invalidated extension.
  // This verifies recovery; it is not an end-to-end browser extension reload.
  await extension.worker.evaluate(id => chrome.scripting.executeScript({
    target: { tabId: id, frameIds: [0] },
    func: () => globalThis.__nudeNyangContentRuntime.dispose(),
  }), p.tabId);
  const other = await extension.context.newPage();
  await extension.worker.evaluate(id => chrome.tabs.update(id, { active: true }), p.tabId);
  await expect.poll(async () => {
    try { return (await p.status()).supported; } catch { return false; }
  }).toBe(true);
  expect(await p.sent()).toEqual([]);
  await p.page.keyboard.press("F4");
  await expect(p.page.locator("#body")).toHaveText("번역(Recovered shortcut paragraph)");
  await p.page.keyboard.press("F4");
  await expect(p.page.locator("#body")).toHaveText("Recovered shortcut paragraph");
  await other.close();
});

for (const shortcut of ["F8", ""]) {
  test("초기 주입은 변경·해제한 F4 설정을 보존한다: " + (shortcut || "off"), async ({ extension }) => {
    const p = await extension.open({
      html: "<main><p id=body>Configured shortcut paragraph</p><input id=draft value='Unsent draft'></main>",
      enabled: false, settings: { quickToggleShortcut: shortcut },
    });
    await p.page.keyboard.press("F4");
    await p.page.waitForTimeout(250);
    expect(await p.sent()).toEqual([]);
    expect((await p.status()).enabled).toBe(false);
    if (shortcut) {
      await p.page.locator("#draft").focus();
      await p.page.keyboard.press(shortcut);
      await expect(p.page.locator("#body")).toHaveText("번역(Configured shortcut paragraph)");
      await expect(p.page.locator("#draft")).toHaveValue("Unsent draft");
      expect(await p.sent()).not.toContain("Unsent draft");
    }
  });
}
test("팝업 개인정보 툴팁은 제품 스타일로 호버·키보드에 표시되고 화면 안에 배치된다", async ({ extension }, testInfo) => {
  await extension.open({ html: "<main><p>Public paragraph</p></main>" });
  const popup = await extension.context.newPage();
  await popup.setViewportSize({ width: 360, height: 720 });
  await popup.goto(`chrome-extension://${extension.extensionId}/popup.html`);
  const button = popup.locator("#messenger-privacy");
  await expect(button).toBeVisible();
  await expect(button).not.toHaveAttribute("title");
  // An extension-owned tab uses the browser's fallback UI locale. The JSDOM
  // popup test separately verifies the Korean language supplied by the app.
  await expect(button).toHaveAttribute("data-tooltip", "All-tab web translation");
  for (const colorScheme of ["light", "dark"]) {
    await popup.emulateMedia({ colorScheme });
    await button.hover();
    await expect.poll(() => button.evaluate(el => getComputedStyle(el, "::after").opacity)).toBe("1");
    const box = await button.evaluate(el => {
      const style = getComputedStyle(el, "::after"), rect = el.getBoundingClientRect();
      return { left: rect.right - parseFloat(style.width), top: rect.top - parseFloat(style.height) - 7,
        border: style.borderTopWidth, background: style.backgroundColor, visibility: style.visibility };
    });
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.border).toBe("0px");
    expect(box.visibility).toBe("visible");
    const screenshot = testInfo.outputPath(`popup-tooltip-${colorScheme}.png`);
    await popup.screenshot({ path: screenshot });
    await testInfo.attach(`popup-tooltip-${colorScheme}`, { path: screenshot, contentType: "image/png" });
  }
  await popup.mouse.move(0, 0);
  await popup.keyboard.press("Tab");
  await button.focus();
  await expect.poll(() => button.evaluate(el => el.matches(":focus-visible") && getComputedStyle(el, "::after").opacity === "1")).toBe(true);
  await popup.close();
});

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
