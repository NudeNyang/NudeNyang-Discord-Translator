import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test.use({ channel: "chromium" });
const source = readFileSync(new URL("../../src-tauri/src/invite_assist.rs", import.meta.url), "utf8");
const keys = [...source.match(/const INVITE_COPY_KEYS:[\s\S]*?\];/)[0].matchAll(/"([^"]+)"/g)].map(match => match[1]);
// Execute the complete production template; only Rust's locale substitutions are supplied here.
const script = source.match(/r#"(\(\(\) => [\s\S]*?)"#/)[1]
  .replaceAll("{{", "{").replaceAll("}}", "}")
  .replace("{encoded_ui_language}", '"ko"')
  .replace("{copy_catalog}", JSON.stringify({ ko: Object.fromEntries(keys.map(key => [key, key])) }));
const run = page => page.evaluate(script);
const helper = page => page.locator("#nt-invite-browser-assist");
async function setup(page) {
  await page.route("**/*", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html><body>
    <article id="chat-messages-1-2"><a id="invite" href="https://discord.gg/fixture-code">Server invite</a>
    <button id="reaction">Add reaction</button><button id="join">Join Server</button></article>
    <div id="surface"></div></body></html>` }));
  await page.goto("https://discord.com/channels/1/2");
  await page.evaluate(() => document.addEventListener("click", event => {
    if (event.target.closest("a")) event.preventDefault();
  }));
  await run(page);
}
const dialog = (page, html) => page.locator("#surface").evaluate((node, html) => node.innerHTML = html, html);
const realDialog = '<section role="dialog" aria-labelledby="invite-title"><h2 id="invite-title">You have been invited</h2><button>Accept Invite</button></section>';
const picker = '<section role="dialog" aria-label="Emoji"><input type="search"><h2>Frequently used</h2><div role="grid"><button>:invite:</button><span>Invitation fan server</span></div></section>';

test("invite helper ignores an emoji picker after an invite click", async ({ page }) => {
  await setup(page);
  await page.locator("#invite").click();
  await dialog(page, picker);
  await run(page);
  await expect(helper(page)).toHaveCount(0);
});

test("reaction on a message containing an invite does not arm invite assistance", async ({ page }) => {
  await setup(page);
  await page.locator("#reaction").click();
  await dialog(page, realDialog);
  await run(page);
  await expect(helper(page)).toHaveCount(0);
});

test("invite context ends when its dialog closes and cannot reopen on a picker", async ({ page }) => {
  await setup(page);
  await page.locator("#invite").click();
  await dialog(page, realDialog);
  await run(page);
  await expect(helper(page)).toBeVisible();
  await dialog(page, "");
  await run(page);
  await dialog(page, picker);
  await run(page);
  await expect(helper(page)).toHaveCount(0);
});

test("invite helper keeps the actual invite dialog and requires an explicit browser action", async ({ page }) => {
  await setup(page);
  await page.locator("#join").click();
  await dialog(page, realDialog);
  expect(await run(page)).toBe("");
  await expect(helper(page)).toBeVisible();
  await page.clock.install();
  await page.clock.fastForward(180_000);
  expect(await run(page)).toBe("");
  await expect(helper(page)).toBeVisible();
  await helper(page).getByRole("button").click();
  expect(await run(page)).toBe("fixture-code");
  expect(await run(page)).toBe("");
});

test("unused invite context expires and is cleared on a channel change", async ({ page }) => {
  await setup(page);
  await page.clock.install();
  await page.locator("#invite").click();
  await page.clock.fastForward(180_000);
  await dialog(page, realDialog);
  await run(page);
  await expect(helper(page)).toHaveCount(0);
  await dialog(page, "");
  await page.locator("#invite").click();
  await page.evaluate(() => history.pushState({}, "", "/channels/3/4"));
  await dialog(page, realDialog);
  await run(page);
  await expect(helper(page)).toHaveCount(0);
});

test("hidden invite structure inside another dialog cannot trigger the helper", async ({ page }) => {
  await setup(page);
  await page.locator("#invite").click();
  await dialog(page, '<section role="dialog"><h2>Emoji</h2><div style="visibility:hidden" class="inviteContent_fixture">Invite</div><button>Choose</button></section>');
  await run(page);
  await expect(helper(page)).toHaveCount(0);
});

test("structural invite dialogs survive localization without searching emoji content", async ({ page }) => {
  await setup(page);
  await page.locator("#invite").click();
  await dialog(page, '<section role="dialog"><div class="inviteContent_fixture">서버 이름</div><button>가입하기</button></section>');
  await run(page);
  await expect(helper(page)).toBeVisible();
});

test("invite route and invalid invite card retain explicit browser assistance", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => history.pushState({}, "", "/invite/route-code"));
  expect(await run(page)).toBe("");
  await helper(page).getByRole("button").click();
  expect(await run(page)).toBe("route-code");
  await page.evaluate(() => history.pushState({}, "", "/channels/1/2"));
  await page.locator("article").evaluate(node => node.append("Invalid Invite"));
  await run(page);
  await expect(helper(page)).toHaveCount(0);
  const inline = page.locator("[data-nt-invite-inline-assist]");
  await expect(inline).toBeVisible();
  await inline.getByRole("button").click();
  expect(await run(page)).toBe("fixture-code");
});

test("legacy invite attributes and reinjection cannot revive stale invite state", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-nt-active-invite-code", "old-code");
    window.__ntActiveInvite = { code: "old-code", observedAt: Date.now() };
    window.__ntInviteAssistClickCaptureInstalled = true;
  });
  await dialog(page, realDialog);
  await run(page);
  await expect(helper(page)).toHaveCount(0);
  await page.locator("#invite").click();
  await run(page);
  await run(page);
  await expect(helper(page)).toHaveCount(1);
  await helper(page).getByRole("button").click();
  expect(await run(page)).toBe("fixture-code");
});
