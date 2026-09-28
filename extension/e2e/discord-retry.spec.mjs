// Regression coverage for the display polling loop and its provider request budget.
// Uses synthetic Discord pages, separate app/browser profiles and a loopback echo API only.
import { createServer } from "node:http";
import { test, expect, chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

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


test("unchanged output stops after quality repair across nine synthetic Discord samples", async () => {
  test.setTimeout(90_000);
  const reports = [];
  for (const sample of [
    {name:"shortcut", text:"Ctrl + Alt + Del"},
    {name:"include", text:"#include &lt;stdio.h&gt;"},
    {name:"print", text:'print("1")'},
    {name:"while", text:"while(true)"},
    {name:"code-block", text:'<pre><code>print("1")\nwhile(true)</code></pre>'},
    {name:"natural-language", text:"This sentence should be translated into Korean."},
    {name:"shortcut-in-English-context", text:"Ctrl + Alt + Del", seed:true},
    {name:"include-in-English-context", text:"#include &lt;stdio.h&gt;", seed:true},
    {name:"print-in-English-context", text:'print("1")', seed:true},
  ]) {
    let calls = 0, authenticated = false;
    const server = createServer(async (req, res) => {
      authenticated ||= Boolean(req.headers.authorization);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const payload = JSON.parse(body.messages.find(message => message.role === "user").content);
      const items = payload.items || payload.context.filter(item => payload.translate_ids.includes(item.id));
      calls++;
      await new Promise(resolve => setTimeout(resolve, 40));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({translations:items.map(item => ({id:item.id,text:sample.seed && item.text === "This is an English message for the translation test." ? "영어 안내 문장입니다." : item.text}))})}}]}));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const app = await fixture(sample.seed ? {} : {text:sample.text});
    try {
      await app.call("configure", {patch:{translator:"openai_compat", openai_compat_base_url:`http://127.0.0.1:${server.address().port}/retry-probe/v1`,openai_compat_model:"echo-probe",openai_compat_batch_size:8,openai_compat_concurrency:1}});
      await app.focus("stable");
      if (sample.seed) {
        await expect(app.message("stable")).toHaveText("영어 안내 문장입니다.");
        calls = 0;
        await app.message("stable").evaluate((element, html) => { element.innerHTML = html; }, sample.text);
      }
      await new Promise(resolve => setTimeout(resolve, 1800));
      const first = calls;
      await new Promise(resolve => setTimeout(resolve, 1800));
      reports.push({sample:sample.name, firstWindow:first, secondWindow: calls-first, total:calls, notice:(await app.call("status")).notice});
      expect(authenticated).toBe(false);
      expect(calls, `${sample.name}: bounded quality repair`).toBeLessThanOrEqual(2);
      expect(calls - first, `${sample.name}: polling must not restart failed translations`).toBe(0);
      if (["while", "natural-language"].includes(sample.name)) expect(calls).toBe(2);
    } finally {
      await app.close();
      await new Promise(resolve => server.close(resolve));
    }
  }
  console.log("UNCHANGED_RETRY_PROBE="+JSON.stringify(reports));
});

async function withApi(respond, run) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const payload = JSON.parse(body.messages.find(message => message.role === "user").content);
    const items = payload.items || payload.context.filter(item => payload.translate_ids.includes(item.id));
    requests.push({ time: Date.now(), items, authenticated: Boolean(req.headers.authorization) });
    res.setHeader("Content-Type", "application/json");
    const response = respond(items, requests.length);
    res.statusCode = response.status || 200;
    res.end(JSON.stringify(response.error || {choices:[{message:{content:JSON.stringify({translations:response.items})}}]}));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const app = await fixture({ text: "while(true)" });
  try {
    await app.call("configure", {patch:{translator:"openai_compat", openai_compat_base_url:`http://127.0.0.1:${server.address().port}/retry-regression/v1`,openai_compat_model:"echo-probe",openai_compat_batch_size:8,openai_compat_concurrency:1}});
    await app.focus("stable");
    await run(app, requests);
    expect(requests.every(request => !request.authenticated)).toBe(true);
  } finally {
    await app.close();
    await new Promise(resolve => server.close(resolve));
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 1800));

test("failed message survives remount, edits and explicit retry work, other messages still translate", async () => {
  test.setTimeout(40_000);
  await withApi(items => ({items:items.map(item => ({id:item.id,text:item.text.startsWith("This neighbor") ? "옆 메시지의 번역입니다." : item.text}))}), async (app, requests) => {
    await expect.poll(() => requests.length).toBe(2);
    await settle();
    await app.message("stable").evaluate(element => { element.parentElement.innerHTML = '<div id="message-content-2">while(true)</div>'; });
    await settle();
    expect(requests.length).toBe(2);
    await app.pages.stable.locator("ol").evaluate(element => { element.insertAdjacentHTML("beforeend", '<li id="chat-messages-1-3"><div id="message-content-3">This neighbor should still be translated.</div></li>'); });
    await expect(app.pages.stable.locator("#message-content-3")).toHaveText("옆 메시지의 번역입니다.");
    expect(requests.filter(request => request.items.some(item => item.text === "while(true)")).length).toBe(2);
    await app.message("stable").evaluate(element => { element.textContent = "while(false)"; });
    await expect.poll(() => requests.filter(request => request.items.some(item => item.text === "while(false)")).length).toBe(2);
    await settle();
    const beforeRetry = requests.length;
    await app.call("enabled", { enabled:false });
    await expect.poll(async () => (await app.call("status")).enabled).toBe(false);
    await app.call("enabled", { enabled:true });
    await expect.poll(() => requests.length).toBe(beforeRetry + 2);
    await settle();
    expect(requests.length).toBe(beforeRetry + 2);
    await expect(app.message("stable")).toHaveText("while(false)");
  });
});

test("server errors back off and stop after three pipeline attempts", async () => {
  test.setTimeout(30_000);
  await withApi(() => ({status:500,error:{error:{message:"temporary test failure"}}}), async (app, requests) => {
    await expect.poll(() => requests.length, { timeout:15_000 }).toBe(3);
    await new Promise(resolve => setTimeout(resolve, 4500));
    expect(requests.length).toBe(3);
    expect(requests[1].time - requests[0].time).toBeGreaterThanOrEqual(1900);
    expect(requests[2].time - requests[1].time).toBeGreaterThanOrEqual(3900);
    await expect(app.message("stable")).toHaveText("while(true)");
  });
});

test("a transient server error can recover before exhausting the budget", async () => {
  await withApi((items, count) => count === 1 ? {status:500,error:{error:{message:"temporary"}}} : {items:items.map(item => ({id:item.id,text:"반복 조건입니다."}))}, async (app, requests) => {
    // Existing punctuation restoration follows the source, which has no final period.
    await expect(app.message("stable")).toHaveText("반복 조건입니다", { timeout:10_000 });
    await settle();
    expect(requests.length).toBe(2);
  });
});
