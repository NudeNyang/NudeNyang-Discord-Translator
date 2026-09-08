import { test, expect, chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { shouldPromptRestart } from "../../web/state.mjs";

test.describe.configure({ mode: "serial" });
test.use({ channel: "chromium" });
test.skip(process.platform !== "win32", "Windows Discord controller integration");
let binary;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  binary = await new Promise((resolveBinary, reject) => {
    const child = spawn("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "--no-run", "--message-format=json"], { windowsHide: true });
    let executable, errors = "";
    createInterface({ input: child.stdout }).on("line", line => {
      try { const value = JSON.parse(line); if (value.reason === "compiler-artifact" && value.executable && value.profile.test) executable = value.executable; } catch {}
    });
    child.stderr.on("data", data => errors += data);
    child.on("error", reject);
    child.on("exit", code => code === 0 && executable ? resolveBinary(executable) : reject(new Error(errors)));
  });
});

async function fixture({ delay = 0 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "nudenyang-discord-e2e-"));
  const userData = join(directory, "browser");
  const context = await chromium.launchPersistentContext(userData, { channel: "chromium", headless: true,
    args: ["--remote-debugging-port=0"], viewport: { width: 1000, height: 760 } });
  const text = "This is an English message for the translation test.";
  await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body>
    <div id="app-mount"><main><ol><li id="chat-messages-1-2"><div id="message-content-2">${text}</div></li></ol>
    <div class="channelTextArea_fixture" style="position:fixed;left:30px;right:30px;bottom:30px"><div role="textbox" contenteditable="true" data-slate-editor="true" style="white-space:pre-wrap; min-height:80px"></div></div>
    </main></div></body></html>` }));
  const pages = {};
  const urls = { stable: "discord.com", ptb: "ptb.discord.com", canary: "canary.discord.com" };
  for (const [variant, host] of Object.entries(urls)) {
    pages[variant] = await context.newPage();
    await pages[variant].goto(`https://${host}/channels/1/2`);
  }
  const port = Number((await readFile(join(userData, "DevToolsActivePort"), "utf8")).split("\n")[0]);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const clients = Object.entries(urls).map(([variant, host], index) => ({ variant, pid: index + 10,
    endpoint: targets.find(target => target.url === `https://${host}/channels/1/2`).webSocketDebuggerUrl }));
  const localData = join(directory, "appdata");
  await mkdir(localData);
  const child = spawn(binary, ["--exact", "engine::discord_e2e::discord_focus_e2e_driver", "--ignored", "--nocapture"], {
    windowsHide: true, env: { ...process.env, NUDENYANG_DISCORD_E2E: "1", LOCALAPPDATA: localData,
      NUDENYANG_MOCK_DELAY_MS: String(delay),
      DISCORD_TRANSLATE_CONFIG: join(localData, "settings.json") },
  });
  let sequence = 0, errors = "";
  const pending = new Map();
  createInterface({ input: child.stdout }).on("line", line => {
    const marker = line.indexOf("NT_DISCORD_E2E:");
    if (marker < 0) return;
    const reply = JSON.parse(line.slice(marker + "NT_DISCORD_E2E:".length));
    pending.get(reply.id)?.resolve(reply.result); pending.delete(reply.id);
  });
  child.stderr.on("data", data => errors += data);
  child.on("exit", code => { for (const request of pending.values()) request.reject(new Error(`Driver exited ${code}: ${errors}`)); pending.clear(); });
  const call = (operation, args = {}) => new Promise((resolveReply, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Driver timeout: ${operation}\n${errors}`)); }, 15_000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolveReply(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    child.stdin.write(`${JSON.stringify({ id, operation, ...args })}\n`);
  });
  await call("clients", { clients });
  const focus = async variant => {
    if (variant) await pages[variant].bringToFront();
    await call("focus", { variant });
    await expect.poll(async () => (await call("status")).discordFocusActive).toBe(Boolean(variant));
    if (variant) await expect.poll(async () => (await call("status")).discordTarget).toBe(variant);
  };
  const message = variant => pages[variant].locator("#message-content-2");
  const close = async () => {
    try { await call("stop"); } finally { child.kill(); await context.close(); }
  };
  return { pages, clients, context, text, call, focus, message, close, directory };
}

test("edited outgoing messages return to translation while editing, cancel and remount preserve saved originals", async () => {
  test.setTimeout(60_000);
  const app = await fixture();
  try {
    await app.focus("stable");
    const originalScript = await app.call("outgoingOriginal", { record: { message_id: "2", channel_key: "/channels/1/2",
      original_text: "처음 작성한 원문입니다.", sent_text: app.text, part_number: 1, total_parts: 1, created_at: Date.now() / 1000 } });
    const page = app.pages.stable;
    await page.evaluate(originalScript);
    const view = page.locator('.nt-outgoing-original-view');
    await expect(view).toHaveCount(1);
    await expect(app.message("stable")).toBeHidden();
    // Discord remounts a message during scrolling without changing its ID.
    await page.evaluate(text => { const old = document.querySelector('#message-content-2'); const node = old.cloneNode(false); node.textContent = text; old.replaceWith(node); }, app.text);
    await expect(view).toHaveCount(1);
    await expect(app.message("stable")).toHaveText(app.text);
    await page.evaluate(() => {
      const editor = document.createElement('div'); editor.role = 'textbox'; editor.contentEditable = 'true';
      editor.textContent = 'An unfinished edit must remain untouched.';
      document.querySelector('#chat-messages-1-2').append(editor);
    });
    await expect(view).toHaveCount(0);
    await expect(page.locator('#chat-messages-1-2 [role=textbox]')).toHaveText('An unfinished edit must remain untouched.');
    await page.locator('#chat-messages-1-2 [role=textbox]').evaluate(node => node.remove());
    await expect(view).toHaveCount(1);
    const edited = 'The updated message asks about reference pictures.';
    await app.message('stable').evaluate((node, text) => { node.textContent = text; }, edited);
    await expect(view).toHaveCount(0);
    await expect(app.message('stable')).toHaveText(`[ko] ${edited}`);
    await app.call('enabled', {enabled:false});
    await expect(app.message('stable')).toHaveText(edited);
    await app.call('enabled', {enabled:true});
    await expect(app.message('stable')).toHaveText(`[ko] ${edited}`);
    const editedAgain = 'The second edit also asks about the number of guests.';
    await app.message('stable').evaluate((node, text) => { node.firstChild.nodeValue = text; }, editedAgain);
    await expect(app.message('stable')).toHaveText(`[ko] ${editedAgain}`);
    await app.call('enabled', {enabled:false});
    await expect(app.message('stable')).toHaveText(editedAgain);
  } finally { await app.close(); }
});

test("edited timestamp stays visible and unchanged through translation, saved originals and remount", async () => {
  test.setTimeout(60_000);
  const app = await fixture();
  try {
    const page = app.pages.stable;
    const body = app.message('stable');
    await body.evaluate(node => node.insertAdjacentHTML('beforeend', '<time datetime="2026-09-08T00:00:00Z"><span>(edited)</span></time>'));
    await app.focus('stable');
    await expect(body).toContainText(`[ko] ${app.text}`);
    await expect(body.locator('time')).toHaveText('(edited)');
    await app.call('enabled', {enabled:false});
    await expect(body).toHaveText(`${app.text}(edited)`);
    await app.call('enabled', {enabled:true});
    const script = await app.call('outgoingOriginal', {record: {message_id:'2', channel_key:'/channels/1/2',
      original_text:'저장된 원문입니다.', sent_text:app.text, part_number:1, total_parts:1, created_at:Date.now()/1000}});
    await page.evaluate(script);
    const view = page.locator('.nt-outgoing-original-view');
    await expect(view).toHaveCount(1);
    await expect(view.locator('time')).toBeVisible();
    await expect(view.locator('time')).toHaveText('(edited)');
    await page.locator('#chat-messages-1-2').hover();
    await view.locator('button').click();
    await expect(body.locator('time')).toBeVisible();
    await expect(view.locator('time')).toBeHidden();
    await view.locator('button').click();
    await body.locator('time span').evaluate(node => {node.firstChild.nodeValue = '(수정됨)';});
    await expect(view.locator('time')).toHaveText('(수정됨)');
    await body.locator('time').evaluate(node => node.setAttribute('datetime', '2026-09-08T01:00:00Z'));
    await expect(view.locator('time')).toHaveAttribute('datetime', '2026-09-08T01:00:00Z');
    await body.evaluate((node, text) => {
      const replacement = node.cloneNode(true); replacement.firstChild.nodeValue = text; node.replaceWith(replacement);
    }, app.text);
    await expect(view.locator('time')).toHaveCount(1);
    await expect(view.locator('time')).toBeVisible();
    await body.locator('time').evaluate(node => node.remove());
    await expect(view.locator('time')).toHaveCount(0);
    await body.evaluate(node => {node.innerHTML = 'The edited body has changed.<time datetime="2026-09-08T01:00:00Z">(edited)</time>';});
    await expect(view).toHaveCount(0);
    await expect(body).toHaveText('[ko] The edited body has changed.(edited)');
    await expect(body.locator('time')).toBeVisible();
    await app.call('enabled', {enabled:false});
    await expect(body).toHaveText('The edited body has changed.(edited)');
  } finally {await app.close();}
});

test("a newer Discord edit survives a translation already in flight", async () => {
  test.setTimeout(45_000);
  const app = await fixture({delay:1000});
  try {
    await app.focus('stable');
    await expect(app.message('stable')).toHaveText(`[ko] ${app.text}`);
    await app.message('stable').evaluate(node => { node.textContent = 'The first edited sentence is waiting for translation.'; });
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
    const latest = 'The latest edit must be kept instead of the previous request.';
    await app.message('stable').evaluate((node, text) => { node.textContent = text; }, latest);
    await expect(app.message('stable')).toHaveText(`[ko] ${latest}`);
    await app.call('enabled', {enabled:false});
    await expect(app.message('stable')).toHaveText(latest);
  } finally { await app.close(); }
});

test("three releases follow focus; inactive windows retain text; the global switch restores every window", async () => {
  test.setTimeout(60_000);
  const app = await fixture();
  try {
    await expect(app.message("canary")).toHaveText(app.text);
    for (const variant of ["stable", "ptb", "canary"]) {
      await app.focus(variant);
      await expect(app.message(variant)).toContainText("[ko]");
    }
    await app.focus(null);
    await app.pages.stable.evaluate(() => {
      const root = document.createElement("div"); root.id = "message-content-3";
      root.textContent = "Another English message received while the window is inactive.";
      document.querySelector("main").append(root);
    });
    // Exceeds the existing five-second renderer watchdog: parked sessions
    // must keep their translations without collecting new content.
    await new Promise(resolveWait => setTimeout(resolveWait, 6200));
    for (const variant of ["stable", "ptb", "canary"]) await expect(app.message(variant)).toContainText("[ko]");
    await expect(app.pages.stable.locator("#message-content-3")).not.toContainText("[ko]");
    await app.call("enabled", { enabled: false });
    for (const variant of ["stable", "ptb", "canary"]) await expect(app.message(variant)).toHaveText(app.text);
    await app.call("enabled", { enabled: true });
    await app.focus("stable");
    await expect(app.pages.stable.locator("#message-content-3")).toContainText("[ko]");
    await expect(app.message("ptb")).toHaveText(app.text);
    await expect(app.message("canary")).toHaveText(app.text);
  } finally { await app.close(); }
});

test("verification in one release and a disconnected renderer do not disable other releases", async () => {
  test.setTimeout(60_000);
  const app = await fixture();
  try {
    await app.focus("canary");
    await expect(app.message("canary")).toContainText("[ko]");
    await app.pages.canary.evaluate(() => { const modal = document.createElement("div"); modal.role = "dialog"; modal.textContent = "Verification required"; document.body.append(modal); });
    await expect.poll(async () => (await app.call("status")).verificationRequired).toBe(true);
    await app.focus("stable");
    await expect(app.message("stable")).toContainText("[ko]");
    expect((await app.call("status")).verificationRequired).toBe(false);
    expect((await app.call("status")).enabled).toBe(true);
    await app.focus("ptb");
    await expect(app.message("ptb")).toContainText("[ko]");
    await app.pages.ptb.close();
    await app.focus("stable");
    await expect.poll(async () => (await app.call("status")).cdpConnected).toBe(true);
    expect((await app.call("status")).enabled).toBe(true);
    await app.focus("canary");
    await expect.poll(async () => (await app.call("status")).verificationRequired).toBe(true);
  } finally { await app.close(); }
});

test("explicit release selection ignores other windows and automatic mode resumes following focus", async () => {
  test.setTimeout(45_000);
  const app = await fixture();
  try {
    await app.call("configure", { patch: { discord_variant: "stable" } });
    await app.call("focus", { variant: "canary" });
    await expect.poll(async () => (await app.call("status")).discordTarget).toBe("stable");
    expect((await app.call("status")).discordFocusActive).toBe(false);
    await expect(app.message("canary")).toHaveText(app.text);
    await app.focus("stable");
    await expect(app.message("stable")).toContainText("[ko]");
    await app.call("configure", { patch: { discord_variant: "auto" } });
    await app.focus("canary");
    await expect(app.message("canary")).toContainText("[ko]");
  } finally { await app.close(); }
});

test("an outgoing result waits for its originating window and never changes another composer", async () => {
  test.setTimeout(60_000);
  const app = await fixture({ delay: 1000 });
  try {
    await app.call("configure", { patch: { enabled: false, outgoing_translation_enabled: true, outgoing_target_language: "ko" } });
    await app.focus("stable");
    const editor = app.pages.stable.locator('[role="textbox"]');
    await expect.poll(() => app.pages.stable.evaluate(() => Boolean(window.__nudeTranslatorOutgoing?.enabled))).toBe(true);
    await editor.fill("Please translate this outgoing message for the fixture.");
    await editor.press("Enter");
    await expect.poll(() => app.pages.stable.evaluate(() => {
      const controller = window.__nudeTranslatorOutgoing;
      return [...controller.pending.values()].some(item => !item.classifying && !item.review_ready) && controller.queue.length === 0;
    })).toBe(true);
    await app.focus("canary");
    await app.pages.canary.locator('[role="textbox"]').fill("Keep this separate draft unchanged.");
    await new Promise(resolveWait => setTimeout(resolveWait, 1800));
    await expect(app.pages.canary.locator('[role="textbox"]')).toHaveText("Keep this separate draft unchanged.");
    await expect(editor).toHaveText("Please translate this outgoing message for the fixture.");
    await app.focus("stable");
    await expect(editor).toContainText("[ko]");
    await expect(app.pages.canary.locator('[role="textbox"]')).toHaveText("Keep this separate draft unchanged.");
  } finally { await app.close(); }
});


test("verification restart stays on its requested release after focus changes", async () => {
  const app = await fixture();
  try {
    await app.focus("canary");
    await expect(app.message("canary")).toContainText("[ko]");
    await app.focus("stable");
    await expect(app.message("stable")).toContainText("[ko]");
    await app.call("pause", { variant: "canary", pid: 12 });
    await expect(app.message("canary")).toHaveText(app.text);
    await expect(app.message("stable")).toContainText("[ko]");
    expect((await app.call("status")).verificationRequired).toBe(false);
    await app.focus("canary");
    await expect.poll(async () => (await app.call("status")).verificationRequired).toBe(true);
  } finally { await app.close(); }
});

test("background heartbeats never reveal the outgoing button in a read-only channel", async () => {
  const app = await fixture();
  try {
    await app.pages.stable.evaluate(() => {
      document.querySelector('[role="textbox"]').remove();
      document.querySelector('.channelTextArea_fixture').style.height = '80px';
    });
    await app.focus("stable");
    const outgoing = app.pages.stable.locator('.nt-outgoing-control');
    await expect(app.pages.stable.locator('.nt-display-control')).toBeVisible();
    await expect(outgoing).toBeHidden();
    await app.focus("canary");
    await app.pages.stable.evaluate(() => {
      window.buttonVisibilitySamples = [];
      window.buttonVisibilityTimer = setInterval(() => {
        const root = document.querySelector('#nt-outgoing-translation');
        const button = root?.querySelector('.nt-outgoing-control');
        if (button && !button.hidden && !root.hidden && getComputedStyle(root).visibility !== 'hidden') {
          window.buttonVisibilitySamples.push(window.__nudeTranslatorOutgoing.lastHeartbeat);
        }
      }, 20);
    });
    const heartbeat = await app.pages.stable.evaluate(() => window.__nudeTranslatorOutgoing.lastHeartbeat);
    await expect.poll(() => app.pages.stable.evaluate(() => window.__nudeTranslatorOutgoing.lastHeartbeat)).toBeGreaterThan(heartbeat + 2200);
    expect(await app.pages.stable.evaluate(() => {
      clearInterval(window.buttonVisibilityTimer);
      return window.buttonVisibilitySamples;
    })).toEqual([]);
    await expect(outgoing).toBeHidden();
    await expect(app.pages.canary.locator('.nt-outgoing-control')).toBeVisible();
    // Layout changes in the parked window still update control visibility,
    // without collecting its messages or submitting a draft.
    await app.pages.stable.evaluate(() => {
      const editor = document.createElement('div');
      editor.setAttribute('role', 'textbox');
      editor.contentEditable = 'true';
      editor.style.minHeight = '80px';
      document.querySelector('.channelTextArea_fixture').append(editor);
    });
    await expect(outgoing).toBeVisible();
    await app.pages.stable.evaluate(() => document.querySelector('[role="textbox"]').remove());
    await expect(outgoing).toBeHidden();
  } finally { await app.close(); }
});

test("a normal PTB or Canary still requests recovery while Stable remains connected", async () => {
  const app = await fixture();
  try {
    await app.call("clients", { clients: app.clients.map(client => client.variant === "stable" ? client : { ...client, endpoint: "ws://127.0.0.1:1/unavailable" }) });
    await app.focus("stable");
    await expect(app.message("stable")).toContainText("[ko]");
    for (const variant of ["ptb", "canary"]) {
      await app.focus(variant);
      await expect.poll(async () => shouldPromptRestart(await app.call("status"), {})).toBe(true);
      const status = await app.call("status");
      expect(status.discordProcessId).toBe(app.clients.find(client => client.variant === variant).pid);
      await expect(app.message("stable")).toContainText("[ko]");
    }
  } finally { await app.close(); }
});

test("automatic recovery reveals the native settings window before asking for consent", async ({ page }) => {
  const source = await readFile(new URL("../../web/app.js", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("async function handleRestartRequired("), source.indexOf("async function restartDiscordManually("));
  const events = await page.evaluate(async handler => {
    const events = [];
    const state = {};
    const invoke = async command => { events.push(command); };
    const ensureRestartConsent = async () => { events.push("consent"); return false; };
    const renderManualDiscordRestart = () => {};
    const showError = async () => { events.push("error"); };
    await eval(`(${handler})`)({ discordProcessId: 11 });
    return events;
  }, handler);
  expect(events).toEqual(["main_window_show", "consent"]);
});
