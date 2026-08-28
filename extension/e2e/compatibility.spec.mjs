import { test, expect } from "./harness.mjs";
import { MESSENGER_CASES, PUBLIC_CASES } from "./fixtures/compatibility.mjs";
import { MAIL_DOCUMENT, MAIL_URL, MAIL_COPY, OUTLOOK_DOCUMENT, OUTLOOK_URL } from "../test/fixtures/mail-reading.mjs";

for (const mail of [
  { id: "gmail", html: MAIL_DOCUMENT, url: MAIL_URL, body: "#mail-body", next: "#inbox/test-thread-two" },
  { id: "outlook", html: OUTLOOK_DOCUMENT, url: OUTLOOK_URL, body: "#UniqueMessageBody", next: "/mail/0/inbox/id/synthetic-message-two" },
]) {
test(`메일 읽기 ${mail.id}: 열린 제목·본문만 번역하고 OFF·재표시와 보호 영역을 보존한다`, async ({ extension }) => {
  const p = await extension.open({ html: mail.html, url: mail.url, consent: true });
  await expect.poll(async () => (await p.sent()).sort()).toEqual([...MAIL_COPY].sort());
  const requests = await p.requests();
  expect(requests.every(request => request.privateContext?.service === mail.id)).toBe(true);
  expect(JSON.stringify(requests)).not.toMatch(/private-|mail\.google|outlook\.live|test-thread|synthetic-message/);
  await expect(p.page.locator('[email="recipient@example.invalid"]')).toHaveText("private-recipient-sentinel");
  await expect(p.page.locator("#mail-link")).toHaveAttribute("href", "https://example.invalid/guide");
  const count = requests.length;
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  await expect(p.page.locator("#mail-prose")).toHaveText(MAIL_COPY[1]);
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  await expect(p.page.locator("#mail-prose")).toHaveText(`번역(${MAIL_COPY[1]})`);
  expect((await p.requests()).length).toBe(count);
  expect((await p.message({ type: "nudenyang-audit" })).status).toBe("unavailable");
  const scope = (await p.status()).messengerContextId;
  await p.page.locator(mail.body).evaluate(element => {
    element.replaceWith(element.cloneNode(true));
    document.querySelector("#mail-prose").textContent = "The meeting starts tomorrow.";
    document.querySelector("#mail-link").textContent = "Read the meeting guide";
  });
  await expect(p.page.locator("#mail-prose")).toHaveText(`번역(${MAIL_COPY[1]})`);
  expect((await p.requests()).length).toBe(count);
  expect((await p.status()).messengerContextId).toBe(scope);
});

test(`메일 읽기 ${mail.id}: 동의 전에는 본문을 읽지 않고 철회 후 모든 결과를 복원한다`, async ({ extension }) => {
  const p = await extension.open({ html: mail.html, url: mail.url, consent: false });
  await expect(p.page.locator("#mail-prose")).toHaveText(MAIL_COPY[1]);
  expect(await p.sent()).toEqual([]);
  await p.setConsent(true);
  await expect(p.page.locator("#mail-prose")).toHaveText(`번역(${MAIL_COPY[1]})`);
  await p.setConsent(false);
  await expect(p.page.locator("#mail-prose")).toHaveText(MAIL_COPY[1]);
});

test(`메일 읽기 ${mail.id}: 다른 메일 전환 중 늦은 응답을 적용하지 않는다`, async ({ extension }) => {
  const p = await extension.open({ html: mail.html, url: mail.url, consent: true, deferTranslations: true });
  await expect.poll(p.sent).toContain(MAIL_COPY[1]);
  await p.page.evaluate(next => { history.pushState({}, "", next); document.querySelector("#mail-prose").textContent = "A different mail body."; }, mail.next);
  await p.releaseTranslations();
  await expect(p.page.locator("#mail-prose")).not.toContainText(MAIL_COPY[1]);
  await expect(p.page.locator("#mail-prose")).toHaveText("번역(A different mail body.)");
});
}

// These run the production MV3 content/background/native-client path in Chromium.
// Only the native port/model response is deterministic. Site HTML is synthetic;
// passing this suite does not certify current authenticated production websites.
const translated = (text) => `번역(${text})`;
const sortedSources = (entry) => entry.copies.map(([, text]) => text).sort();

async function expectCopies(page, copies, transform = translated) {
  for (const [selector, source] of copies) {
    await expect(page.locator(selector), selector).toHaveText(transform(source));
  }
}

async function expectGuards(page, guards) {
  await expectCopies(page, guards, (source) => source);
}

for (const entry of PUBLIC_CASES) {
  test(`공개 사이트 계약 fixture: ${entry.id} 본문·보호 규칙·원문 복원`, async ({ extension }) => {
    const p = await extension.open({ html: entry.html, url: entry.url });
    await expectCopies(p.page, entry.copies);
    await expect.poll(async () => (await p.sent()).sort()).toEqual(sortedSources(entry));
    await expectGuards(p.page, entry.guards);
    await expect(p.page.locator("#private-input")).toHaveValue("Synthetic private input");
    await expect(p.page.locator("#word-link")).toHaveAttribute("href", "/reference/");
    await p.page.locator("#word-link").click();
    await expect(p.page.locator("#word-link")).toHaveAttribute("data-clicks", "1");
    const requestCount = (await p.requests()).length;

    await p.message({ type: "nudenyang-set-enabled", enabled: false });
    await expectCopies(p.page, entry.copies, (source) => source);
    await p.message({ type: "nudenyang-set-enabled", enabled: true });
    await expectCopies(p.page, entry.copies);
    await p.page.locator("#word-link").click();
    await expect(p.page.locator("#word-link")).toHaveAttribute("data-clicks", "2");
    expect(await p.page.evaluate(() => [...globalThis.fixtureNodes].every(([id, element]) => (
      document.getElementById(id) === element
    )))).toBe(true);
    await expectGuards(p.page, entry.guards);
    expect((await p.requests()).length).toBe(requestCount);
    expect((await p.sent()).sort()).toEqual(sortedSources(entry));

    if (entry.id === "takaratomy") {
      await expect(p.page.locator("#public-query")).toHaveValue("Synthetic search input");
      await expect(p.page.locator("#search-tab")).toHaveAttribute("aria-selected", "true");
      await expect(p.page.locator("#sitemap")).toHaveAttribute("aria-expanded", "false");
    }
  });
}

for (const entry of MESSENGER_CASES) {
  test(`메신저 계약 fixture: ${entry.id}${entry.variant ? ` ${entry.variant}` : ""} 현재 대화만 번역`, async ({ extension }) => {
    const p = await extension.open({ html: entry.html, url: entry.url, consent: true, settings: { messengerPolicyVersion: 5 } });
    await expectCopies(p.page, entry.copies);
    await expect.poll(async () => (await p.sent()).sort()).toEqual(sortedSources(entry));
    await expectGuards(p.page, entry.guards);
    const requests = await p.requests();
    for (const request of requests) {
      expect(request.privateContext).toEqual({ service: entry.id, consentVersion: 5 });
      expect(request.pageId).toMatch(new RegExp(`^messenger:${entry.id}:[a-zA-Z0-9_-]{16,128}$`));
      expect(JSON.stringify(request)).not.toContain(new URL(entry.url).hostname);
      if (new URL(entry.url).pathname !== "/") {
        expect(JSON.stringify(request)).not.toContain(new URL(entry.url).pathname);
      }
    }
    if (entry.id === "discord" && entry.variant === "server") {
      await expect(p.page.locator("#embed-title")).toHaveAttribute("href", "https://example.invalid/page");
      await expect(p.page.locator('[data-list-item-id="channels___200"]')).toHaveAttribute("href", "/channels/100/200");
    }

    await p.message({ type: "nudenyang-set-enabled", enabled: false });
    await expectCopies(p.page, entry.copies, (source) => source);
    await p.message({ type: "nudenyang-set-enabled", enabled: true });
    await expectCopies(p.page, entry.copies);
    expect((await p.requests()).length).toBe(requests.length);
    await expectGuards(p.page, entry.guards);
  });
}

test("공개 UI 계약 fixture: Takara 사이트맵 펼침·접힘과 번역 토글 뒤에도 링크가 동작", async ({ extension }) => {
  const html = `<style>[aria-hidden="true"] { display: none; }</style>
    <footer class="l-footer"><button class="l-footer-sitemap__trigger" id="expand" aria-controls="panel" aria-expanded="false">
      <span id="sitemap-title">Product information</span></button>
      <div id="panel" role="region" aria-labelledby="expand" aria-hidden="true"><a href="/products/" id="sitemap-link">Product catalogue</a></div>
    </footer><script>
      document.getElementById('expand').addEventListener('click', (event) => {
        const button = event.currentTarget;
        const expanded = button.getAttribute('aria-expanded') !== 'true';
        button.setAttribute('aria-expanded', String(expanded));
        document.getElementById('panel').setAttribute('aria-hidden', String(!expanded));
      });
    </script>`;
  const p = await extension.open({ html, url: "https://dm.takaratomy.co.jp/product/synthetic/" });
  await expect(p.page.locator("#sitemap-title")).toHaveText(translated("Product information"));
  expect(await p.sent()).toEqual(["Product information"]);
  await p.page.locator("#expand").click();
  await expect(p.page.locator("#sitemap-link")).toHaveText(translated("Product catalogue"));
  await expect(p.page.locator("#expand")).toHaveAttribute("aria-expanded", "true");
  await expect(p.page.locator("#panel")).toHaveAttribute("aria-labelledby", "expand");
  await expect(p.page.locator("#sitemap-link")).toHaveAttribute("href", "/products/");
  const requestCount = (await p.requests()).length;
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  await expect(p.page.locator("#sitemap-link")).toHaveText("Product catalogue");
  await expect(p.page.locator("#expand")).toHaveAttribute("aria-expanded", "true");
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  await expect(p.page.locator("#sitemap-link")).toHaveText(translated("Product catalogue"));
  expect((await p.requests()).length).toBe(requestCount);
  await p.page.locator("#expand").click();
  await expect(p.page.locator("#sitemap-link")).toBeHidden();
});

test("공개 UI 계약 fixture: ShoPro 메뉴의 CSS 펼침을 실제 브라우저에서 다시 수집", async ({ extension }) => {
  const html = `<style>.headerWrap .menu { display: none; }.headerWrap.mobile-open .menu { display: block; }</style>
    <header><div class="headerWrap"><button id="open-menu" aria-expanded="false">Open menu</button>
      <div class="menu"><ul><li><a href="news/" id="menu-link">Latest public news</a></li></ul></div>
    </div></header><script>
      document.getElementById('open-menu').addEventListener('click', (event) => {
        const expanded = document.querySelector('.headerWrap').classList.toggle('mobile-open');
        event.currentTarget.setAttribute('aria-expanded', String(expanded));
      });
    </script>`;
  const p = await extension.open({ html, url: "https://www.shopro.co.jp/anime/synthetic/" });
  await expect(p.page.locator("#menu-link")).toBeHidden();
  expect(await p.sent()).toEqual([]);
  await p.page.locator("#open-menu").click();
  await expect(p.page.locator("#menu-link")).toHaveText(translated("Latest public news"));
  await expect(p.page.locator("#menu-link")).toHaveAttribute("href", "news/");
  await p.page.locator("#open-menu").click();
  await expect(p.page.locator("#menu-link")).toBeHidden();
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  await p.page.locator("#open-menu").click();
  await expect(p.page.locator("#menu-link")).toHaveText("Latest public news");
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  await expect(p.page.locator("#menu-link")).toHaveText(translated("Latest public news"));
  expect(await p.sent()).toEqual(["Latest public news"]);
});

const services = MESSENGER_CASES.filter((entry, index, all) => all.findIndex((item) => item.id === entry.id) === index);
for (const entry of MESSENGER_CASES.filter(item => item.variant !== "server")) {
  test(`메신저 재사용 fixture: ${entry.id} ${entry.variant ?? "default"} 본문 노드 교체`, async ({ extension }) => {
    const p = await extension.open({ html: entry.html, url: entry.url, consent: true });
    const [selector, source] = entry.copies[0];
    const body = p.page.locator(selector);
    await expectCopies(p.page, entry.copies);
    const count = (await p.requests()).length;
    const scope = (await p.status()).messengerContextId;
    await body.evaluate(element => { element.style.transform = "translateY(2400px)"; });
    await p.status();
    await expect(body).toHaveText(translated(source));
    await body.evaluate(element => { element.style.removeProperty("transform"); });
    for (let repeat = 0; repeat < 3; repeat += 1) {
      await body.evaluate(element => {
        const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walk.nextNode()) {
          const node = walk.currentNode;
          if (node.nodeValue.startsWith("번역(") && node.nodeValue.endsWith(")")) {
            node.replaceWith(document.createTextNode(node.nodeValue.slice(3, -1)));
          }
        }
      });
      await expect(body).toHaveText(translated(source));
      expect((await p.requests()).length).toBe(count);
      expect((await p.status()).messengerContextId).toBe(scope);
    }
    await expectGuards(p.page, entry.guards);
  });
}
for (const policy of [
  { label: "이전 v2 동의", consentVersion: 2, settings: {}, gate: "messenger_consent_required" },
  { label: "이전 v3 동의", consentVersion: 3, settings: {}, gate: "messenger_consent_required" },
  { label: "이전 Gmail 전용 v4 동의", consentVersion: 4, settings: {}, gate: "messenger_consent_required" },
  { label: "이전 v4 본체", consentVersion: 5, settings: { messengerPolicyVersion: 4 }, gate: "messenger_update_required" },
  { label: "이전 v3 본체", consentVersion: 5, settings: { messengerPolicyVersion: 3 }, gate: "messenger_update_required" },
  { label: "구형 본체 정책", consentVersion: 5, settings: { messengerPolicyVersion: 2 }, gate: "messenger_update_required" },
]) {
  test(`통합 정책 fixture: ${policy.label}는 자동 확대하지 않음`, async ({ extension }) => {
    const entry = MESSENGER_CASES.find(item => item.id === "discord" && item.variant === "direct");
    const p = await extension.open({ html: entry.html, url: entry.url, consent: true, translator: "deepl", ...policy });
    expect(await p.status()).toMatchObject({ enabled: false, messengerGate: policy.gate });
    await expectCopies(p.page, entry.copies, source => source);
    expect(await p.requests()).toEqual([]);
  });
}

test("통합 정책 fixture: 실제 동의 화면의 승인 후 v5를 저장하고 대화 번역을 시작", async ({ extension }) => {
  const entry = MESSENGER_CASES.find(item => item.id === "discord" && item.variant === "direct");
  const p = await extension.open({ html: entry.html, url: entry.url, consent: true, consentVersion: 2, translator: "chatgpt" });
  expect(await p.requests()).toEqual([]);
  const notice = await extension.context.newPage();
  await notice.goto(`chrome-extension://${extension.extensionId}/messenger-privacy.html`);
  await expect(notice.locator("#privacy-confirm")).toBeEnabled();
  await expect(notice.locator('[data-i18n="messengerPrivacyExternal"]')).toContainText("ChatGPT");
  await expect(notice.locator('[data-i18n="webPrivacyExpandedScope"]')).toContainText("Outlook");
  await notice.locator("#privacy-confirm").check();
  await notice.locator("#privacy-accept").click();
  await expect(notice.locator("#privacy-revoke")).toBeVisible();
  expect(await extension.worker.evaluate(async () => (await chrome.storage.local.get("messengerConsentVersion")).messengerConsentVersion)).toBe(5);
  await notice.close();
  await p.page.bringToFront();
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  await expectCopies(p.page, entry.copies);
  expect((await p.requests())[0]).toMatchObject({ incognito: false, privateContext: { consentVersion: 5 } });
  await expectGuards(p.page, entry.guards);
});
test("통합 정책 fixture: 새 동의 후 별도 토글 없이 외부 번역기 사용", async ({ extension }) => {
  const entry = MESSENGER_CASES.find(item => item.id === "discord" && item.variant === "direct");
  const p = await extension.open({ html: entry.html, url: entry.url, consent: true, consentVersion: 5,
    translator: "deepl", settings: { messengerPolicyVersion: 5, messengerEnabled: false } });
  await expectCopies(p.page, entry.copies);
  await expect.poll(async () => (await p.sent()).sort()).toEqual(sortedSources(entry));
  await expectGuards(p.page, entry.guards);
});
for (const entry of services) {
  test(`개인정보 계약 fixture: ${entry.id} 동의 없으면 전송하지 않고 동의 후에만 시작`, async ({ extension }) => {
    const p = await extension.open({ html: entry.html, url: entry.url, consent: false, settings: { messengerPolicyVersion: 5 } });
    expect(await p.status()).toMatchObject({ enabled: false, messengerGate: "messenger_consent_required" });
    await expectCopies(p.page, entry.copies, (source) => source);
    expect(await p.requests()).toEqual([]);
    await p.setConsent(true);
    await expect.poll(async () => (await p.status()).messengerGate).toBe("");
    await p.message({ type: "nudenyang-set-enabled", enabled: true });
    await expectCopies(p.page, entry.copies);
    await expect.poll(async () => (await p.sent()).sort()).toEqual(sortedSources(entry));
    await expectGuards(p.page, entry.guards);
  });

  test(`개인정보 계약 fixture: ${entry.id} 동의 후 앱의 외부 번역기를 사용`, async ({ extension }) => {
    const p = await extension.open({ html: entry.html, url: entry.url, consent: true,
      settings: { messengerPolicyVersion: 5 }, translator: "deepl" });
    await expectCopies(p.page, entry.copies);
    await expect.poll(async () => (await p.sent()).sort()).toEqual(sortedSources(entry));
    await expectGuards(p.page, entry.guards);
  });
}

test("개인정보 계약 fixture: 본체 기능 OFF와 사이트 차단은 동의로 우회하지 않음", async ({ extension }) => {
  const entry = MESSENGER_CASES.find((item) => item.id === "discord" && item.variant === "direct");
  for (const settings of [
    { enabled: false },
    { messengerPolicyVersion: 5, sitePolicies: { "discord.com": "never" } },
  ]) {
    const p = await extension.open({ html: entry.html, url: entry.url, consent: true, settings });
    expect((await p.status()).enabled).toBe(false);
    await expectCopies(p.page, entry.copies, (source) => source);
    expect(await p.requests()).toEqual([]);
    await p.page.close();
  }
});

test("개인정보 계약 fixture: X 공개 타임라인의 DM 서랍은 공개 수집으로 우회하지 않음", async ({ extension }) => {
  const html = `<main><article><div data-testid="tweetText" id="public-post">A public timeline post.</div></article></main>
    <aside data-testid="DMDrawer"><div data-testid="DmActivityViewport"><div data-testid="messageEntry">
      <span data-testid="messageSender" id="sender">Synthetic Private Sender</span>
      <span dir="auto" id="private-body">A private drawer conversation.</span></div></div></aside>`;
  const p = await extension.open({ html, url: "https://x.com/home", consent: false, settings: { messengerPolicyVersion: 5 } });
  expect(await p.status()).toMatchObject({ enabled: false, messengerGate: "messenger_consent_required" });
  expect(await p.requests()).toEqual([]);
  await expect(p.page.locator("#public-post")).toHaveText("A public timeline post.");
  await expect(p.page.locator("#private-body")).toHaveText("A private drawer conversation.");
  await p.setConsent(true);
  await expect.poll(async () => (await p.status()).messengerGate).toBe("");
  await p.message({ type: "nudenyang-set-enabled", enabled: true });
  await expect(p.page.locator("#private-body")).toHaveText(translated("A private drawer conversation."));
  expect(await p.sent()).toEqual(["A private drawer conversation."]);
  expect((await p.requests())[0].privateContext).toEqual({ service: "x", consentVersion: 5 });
  await expect(p.page.locator("#public-post")).toHaveText("A public timeline post.");
  await expect(p.page.locator("#sender")).toHaveText("Synthetic Private Sender");
});

test("메신저 계약 fixture: 닉네임·멘션·URL·코드·작성창 보호와 일반 링크 이벤트 유지", async ({ extension }) => {
  const html = `<ol data-list-id="chat-messages"><li><span id="message-username-1">Synthetic Sender</span>
    <div id="message-content-1"><span id="message-copy">A neutral private message.</span>
      <span class="mention_test" id="mention">@Synthetic Recipient</span>
      <a href="https://example.invalid/article" id="plain-link">https://example.invalid/article</a>
      <a href="https://example.invalid/article" id="word-link">Read this article</a>
      <code id="inline-code">private_code()</code><time id="timestamp">12:34</time>
    </div></li></ol><div id="composer" role="textbox" contenteditable="true">An unsent draft.</div>
    <script>document.getElementById('word-link').addEventListener('click', (event) => {
      event.preventDefault(); event.currentTarget.dataset.clicked = 'yes';
    });</script>`;
  const p = await extension.open({ html, url: "https://discord.com/channels/@me/200", consent: true, settings: { messengerPolicyVersion: 5 } });
  const copies = [["#message-copy", "A neutral private message."], ["#word-link", "Read this article"]];
  await expectCopies(p.page, copies);
  await expect.poll(async () => (await p.sent()).sort()).toEqual(copies.map(([, text]) => text).sort());
  await expectGuards(p.page, [["#message-username-1", "Synthetic Sender"], ["#mention", "@Synthetic Recipient"],
    ["#plain-link", "https://example.invalid/article"], ["#inline-code", "private_code()"], ["#timestamp", "12:34"], ["#composer", "An unsent draft."]]);
  await p.page.locator("#word-link").click();
  await expect(p.page.locator("#word-link")).toHaveAttribute("data-clicked", "yes");
  await expect(p.page.locator("#word-link")).toHaveAttribute("href", "https://example.invalid/article");
  await p.setConsent(false);
  await expect.poll(async () => (await p.status()).messengerGate).toBe("messenger_consent_required");
  await expectCopies(p.page, copies, (source) => source);
  expect(await p.status()).toMatchObject({ enabled: false, messengerGate: "messenger_consent_required", translatedNodes: 0 });
});
