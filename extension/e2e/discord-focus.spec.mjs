import { test, expect, chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { discordConnectionLabel, shouldPromptRestart } from "../../web/state.mjs";

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

async function fixture({ delay = 0, text = "This is an English message for the translation test." } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "nudenyang-discord-e2e-"));
  const userData = join(directory, "browser");
  const context = await chromium.launchPersistentContext(userData, { channel: "chromium", headless: true,
    args: ["--remote-debugging-port=0"], viewport: { width: 1000, height: 760 } });
  await context.route("**/*", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html><head><meta charset="utf-8"></head><body>
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

test("recovered connections clear previous errors before Discord becomes active", async () => {
  const app = await fixture();
  try {
    await app.call("clients", { clients: app.clients.map(client => client.variant === "stable"
      ? { ...client, endpoint: "ws://127.0.0.1:1/unavailable" } : client) });
    await app.focus("stable");
    await expect.poll(async () => (await app.call("status")).connectionIssue).not.toBe("");
    await app.focus(null);
    await app.call("clients", { clients: app.clients });
    expect(await app.call("replace", { variant: "stable" })).toEqual({ ok: true });
    await expect.poll(async () => (await app.call("status")).cdpConnected).toBe(true);
    const recovered = await app.call("status");
    expect(recovered.discordWaiting).toBe(true);
    expect(recovered.connectionIssue).toBe("");
    expect(discordConnectionLabel(recovered)).toBe("Discord 창 대기 중");
    await app.focus("stable");
    await expect(app.message("stable")).toContainText("[ko]");
    await app.focus(null);
    // Include a heartbeat and the normal process discovery interval.
    await new Promise(resolve => setTimeout(resolve, 2200));
    const waiting = await app.call("status");
    expect(waiting.cdpConnected).toBe(true);
    expect(waiting.connectionIssue).toBe("");
    expect(discordConnectionLabel(waiting)).toBe("Discord 창 대기 중");
  } finally { await app.close(); }
});

test("failed replacement connections remain visible while Discord is inactive", async () => {
  const app = await fixture();
  try {
    await app.focus("stable");
    await expect.poll(async () => (await app.call("status")).cdpConnected).toBe(true);
    await app.focus(null);
    const result = await app.call("replace", { variant: "stable", endpoint: "ws://127.0.0.1:1/unavailable" });
    expect(result.ok).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 2200));
    const failed = await app.call("status");
    expect(failed.cdpConnected).toBe(false);
    expect(failed.discordWaiting).toBe(true);
    expect(failed.connectionIssue).toBe(result.error);
    expect(discordConnectionLabel(failed)).toBe("연결 확인 필요");
  } finally { await app.close(); }
});

test("invite assist polling distinguishes an emoji picker from the activated invite dialog", async () => {
  const app = await fixture();
  try {
    await app.focus("stable");
    const page = app.pages.stable;
    await expect.poll(() => page.evaluate(() => Boolean(window.__ntInviteAssistState))).toBe(true);
    await page.evaluate(() => {
      const link = document.createElement("a");
      link.href = "https://discord.gg/fixture-code";
      link.textContent = "Server invite";
      link.onclick = event => event.preventDefault();
      document.querySelector("ol").append(link);
      link.click();
      const surface = document.createElement("section");
      surface.id = "invite-fixture";
      surface.setAttribute("role", "dialog");
      surface.innerHTML = '<h2>You have been invited</h2><button>Accept Invite</button>';
      document.body.append(surface);
    });
    await expect(page.locator("#nt-invite-browser-assist")).toBeVisible();
    await page.locator("#invite-fixture").evaluate(node => {
      node.innerHTML = '<h2>Emoji</h2><input type="search"><div role="grid"><button>:invite:</button></div>';
    });
    await expect(page.locator("#nt-invite-browser-assist")).toHaveCount(0);
    expect((await app.call("status")).verificationRequired).toBe(false);
  } finally { await app.close(); }
});

test("outgoing punctuation bypasses Enter interception before draft classification returns", async () => {
  const app = await fixture();
  try {
    await app.call('configure', {patch: {enabled:false, outgoing_translation_enabled:true, outgoing_target_language:'auto'}});
    await app.focus('stable');
    const page = app.pages.stable;
    await expect.poll(() => page.evaluate(() => window.__nudeTranslatorOutgoing?.enabled)).toBe(true);
    const results = await page.evaluate(() => {
      const controller = window.__nudeTranslatorOutgoing;
      const editor = document.querySelector('[role="textbox"]');
      document.querySelector('ol').replaceChildren(); // No language evidence needed for symbols.
      const sources = ['!?', '?!…', '！？', '…', '→ ± ×', '👋🏽 👨‍👩‍👧‍👦', '! 👋 ?', ' \n!?\n '];
      return sources.map(source => {
        controller.queue.length = 0;
        controller.pending.clear();
        controller.draftChecks.clear();
        controller.setStatus('');
        editor.textContent = source;
        editor.focus();
        editor.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:source}));
        // Input and Enter share one JS task: the Rust classification cannot return yet.
        const event = new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true});
        editor.dispatchEvent(event);
        return {source, prevented:event.defaultPrevented, text:editor.textContent,
          queued:controller.queue.map(item => item.action), pending:controller.pending.size};
      });
    });
    for (const result of results) {
      expect(result, result.source).toEqual({source:result.source, prevented:false, text:result.source, queued:[], pending:0});
    }
  } finally {await app.close();}
});

test("outgoing punctuation mixed with words still requests translation before classification returns", async () => {
  const app = await fixture();
  try {
    await app.call('configure', {patch: {enabled:false, outgoing_translation_enabled:true, outgoing_target_language:'auto'}});
    await app.focus('stable');
    const page = app.pages.stable;
    await expect.poll(() => page.evaluate(() => window.__nudeTranslatorOutgoing?.enabled)).toBe(true);
    const results = await page.evaluate(() => {
      const controller = window.__nudeTranslatorOutgoing;
      const editor = document.querySelector('[role="textbox"]');
      return ['왜!?', 'Really!?', '何！？', 'a!', '1?'].map(source => {
        controller.queue.length = 0;
        controller.pending.clear();
        controller.draftChecks.clear();
        editor.textContent = source;
        editor.focus();
        editor.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:source}));
        const event = new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true});
        editor.dispatchEvent(event);
        return {source, prevented:event.defaultPrevented,
          translated:controller.queue.filter(item => item.action === 'translate').map(item => item.text)};
      });
    });
    for (const result of results) {
      expect(result).toEqual({source:result.source, prevented:true, translated:[result.source]});
    }
  } finally {await app.close();}
});

test("outgoing punctuation preserves a native mention and cancels superseded review work", async () => {
  const app = await fixture();
  try {
    await app.call('configure', {patch: {enabled:false, outgoing_translation_enabled:true, outgoing_target_language:'ko'}});
    await app.focus('stable');
    const page = app.pages.stable;
    await expect.poll(() => page.evaluate(() => window.__nudeTranslatorOutgoing?.enabled)).toBe(true);
    const result = await page.evaluate(() => {
      const controller = window.__nudeTranslatorOutgoing;
      const editor = document.querySelector('[role="textbox"]');
      editor.innerHTML = '<span data-slate-inline="true" data-slate-void="true" contenteditable="false"><span role="button">@Fixture</span></span> !?';
      editor.focus();
      const before = editor.innerHTML;
      const old = {id:'old-request', editor, text:'Old text', original_text:'Old text', created_at:Date.now()};
      controller.pending.set(old.id, old);
      controller.queue.push({id:old.id, text:old.text, action:'translate'});
      editor.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:'!?'}));
      let receivedEnter = 0;
      editor.addEventListener('keydown', () => receivedEnter++, {once:true});
      const event = new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true});
      editor.dispatchEvent(event);
      const lateReviewAccepted = controller.prepareReview(old.id);
      controller.fail(old.id, 'Delayed failure for the cancelled synthetic request');
      const lateErrorVisible = !controller.root.querySelector('.nt-outgoing-status').hidden;
      controller.pending.set('active-failure', {editor});
      controller.fail('active-failure', 'Current synthetic request failed');
      const activeErrorVisible = !controller.root.querySelector('.nt-outgoing-status').hidden;
      return {prevented:event.defaultPrevented, receivedEnter, unchanged:before === editor.innerHTML,
        pending:controller.pending.size, queued:controller.queue.length,
        lateReviewAccepted, lateErrorVisible, activeErrorVisible};
    });
    expect(result).toEqual({prevented:false, receivedEnter:1, unchanged:true, pending:0, queued:0,
      lateReviewAccepted:false, lateErrorVisible:false, activeErrorVisible:true});
  } finally {await app.close();}
});

test("scroll replay restores a remounted message while another inference is busy", async () => {
  test.setTimeout(45_000);
  const app = await fixture({delay: 1800, text: 'Please keep @everyone and https://example.test/help unchanged 👋.'});
  try {
    await app.focus('stable');
    await expect(app.message('stable')).toHaveText(`[ko] ${app.text}`);
    const baseline = (await app.call('model')).started;
    await app.pages.stable.evaluate(() => {
      const node = document.createElement('div'); node.id = 'message-content-99';
      node.textContent = 'This separate message keeps the translation model busy.';
      document.querySelector('ol').append(node);
    });
    await expect.poll(async () => (await app.call('model')).started).toBe(baseline + 1);
    await app.message('stable').evaluate((node, text) => {
      const replacement = document.createElement('div'); replacement.id = node.id;
      replacement.textContent = text; node.replaceWith(replacement);
    }, app.text);
    await expect(app.message('stable')).toHaveText(`[ko] ${app.text}`, {timeout: 900});
    expect((await app.call('model')).completed).toBe(baseline);
    await app.call('enabled', {enabled:false});
    await expect(app.message('stable')).toHaveText(app.text);
  } finally {await app.close();}
});

test("scroll work publishes the first complete message before the rest of its batch", async () => {
  test.setTimeout(45_000);
  const app = await fixture({delay: 1200});
  try {
    await app.pages.stable.evaluate(() => {
      for (let id = 10; id < 14; id++) {
        const node = document.createElement('div'); node.id = `message-content-${id}`;
        node.textContent = `Another complete English message number ${id}.`;
        document.querySelector('ol').append(node);
      }
    });
    await app.focus('stable');
    await expect.poll(async () => (await app.call('model')).started).toBeGreaterThan(0);
    await expect(app.message('stable')).toHaveText(`[ko] ${app.text}`, {timeout: 2200});
    expect((await app.call('model')).completed).toBeLessThan(5);
  } finally {await app.close();}
});

test("scroll work discards unstarted messages after they leave the same channel viewport", async () => {
  test.setTimeout(45_000);
  const app = await fixture({delay: 1200});
  try {
    await app.pages.stable.evaluate(() => {
      for (let id = 10; id < 16; id++) {
        const node = document.createElement('div'); node.id = `message-content-${id}`;
        node.textContent = `An old viewport message number ${id}.`;
        document.querySelector('ol').append(node);
      }
    });
    await app.focus('stable');
    await expect.poll(async () => (await app.call('model')).started).toBe(1);
    await app.pages.stable.evaluate(() => {
      document.querySelector('ol').innerHTML = '<div id="message-content-77">The newly visible message should be translated next.</div>';
    });
    await expect(app.pages.stable.locator('#message-content-77')).toHaveText(
      '[ko] The newly visible message should be translated next.', {timeout: 3300});
    expect((await app.call('model')).started).toBe(2);
  } finally {await app.close();}
});

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
