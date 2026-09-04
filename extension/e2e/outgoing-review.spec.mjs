import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test.use({ channel: "chromium" });
const outgoing = readFileSync(new URL("../../src-tauri/src/outgoing.rs", import.meta.url), "utf8");
const engine = readFileSync(new URL("../../src-tauri/src/engine.rs", import.meta.url), "utf8");
const collector = outgoing.slice(outgoing.indexOf("  function mentionText("), outgoing.indexOf("  function composerHasText("));
const methods = outgoing.match(/      prepareReview\(id\) \{[\s\S]*?\n    \};/)[0].replace(/\n    \};$/, "");

// Model the observed editor contract, not a website-specific selector: native
// insertText sanitizes line breaks, while text/plain paste creates line blocks.
// The collector and review methods under test are the actual injected code.
async function setup(page, source, { paste = "accept", prefix = "" } = {}) {
  await page.setContent('<div contenteditable="true" role="textbox" style="white-space:break-spaces"></div>');
  await page.evaluate(({ collector, methods, source, paste, prefix }) => {
    const editor = document.querySelector('[role="textbox"]');
    const render = text => {
      editor.replaceChildren(...text.split("\n").map((line, index) => {
        const block = document.createElement("div");
        block.dataset.slateNode = "element";
        if (index === 0 && prefix) {
          const mention = document.createElement("span");
          Object.assign(mention.dataset, { slateNode: "element", slateInline: "true", slateVoid: "true" });
          mention.contentEditable = "false";
          mention.innerHTML = '<span role="button"></span>';
          mention.firstChild.textContent = prefix;
          block.append(mention);
        }
        const leaf = document.createElement("span");
        if (line) { leaf.dataset.slateString = "true"; leaf.textContent = line; }
        else { leaf.dataset.slateZeroWidth = "n"; leaf.append("\uFEFF", document.createElement("br")); }
        block.append(leaf);
        return block;
      }));
    };
    render(source);
    window.events = [];
    editor.addEventListener("beforeinput", event => {
      if (event.inputType !== "insertText") return;
      event.preventDefault();
      render((event.data || "").replace(/[\r\n]/g, " "));
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    editor.addEventListener("beforeinput", event => {
      if (event.inputType !== "insertFromPaste") return;
      window.events.push({ type: "insertFromPaste", types: [...event.dataTransfer.types] });
      if (paste === "ignore") return;
      event.preventDefault();
      const value = event.dataTransfer.getData("text/plain");
      render(paste === "flatten" ? value.replace(/\n/g, " ") : value);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    editor.addEventListener("keydown", event => window.events.push({ type: "keydown", key: event.key }));
    editor.addEventListener("paste", () => window.events.push({ type: "clipboard-upload-handler" }));
    window.controller = Function("editor", "source", "prefix", `
      const mentionSelector = '[data-slate-inline="true"][data-slate-void="true"][contenteditable="false"]';
      ${collector}
      const copy = key => key;
      const MESSAGE_UTF16_LIMIT = 1900;
      const composerHasText = node => Boolean(composerText(node).trim());
      const currentComposerForItem = item => item.editor?.isConnected && composerText(item.editor) === item.original_text ? item.editor : null;
      const sourceTextForItem = node => composerText(node).slice(prefix.length);
      const selectionRangeForItem = node => {
        const range = document.createRange(); range.selectNodeContents(node);
        if (prefix) range.setStartAfter(node.querySelector(mentionSelector));
        return range;
      };
      const controller = {
        pending: new Map([['review', { editor, text:source, original_text:prefix+source, preserve_prefix_mentions:Boolean(prefix) }]]),
        setStatus(message) { this.status = message; },
        ${methods}
      };
      window.readDraft = () => composerText(editor);
      return controller;
    `)(editor, source, prefix);
  }, { collector, methods, source, paste, prefix });
}

async function deliver(page, text) {
  // Mirror the Rust transport branch, retaining the old path for the red test.
  if (/[\r\n]/.test(text) && engine.includes("paste_outgoing_review_script(request_id, translated)")) {
    return page.evaluate(text => window.controller.pasteReview("review", text), text);
  }
  expect(await page.evaluate(() => window.controller.prepareReview("review"))).toBe(true);
  const client = await page.context().newCDPSession(page);
  try { await client.send("Input.insertText", { text }); }
  finally { await client.detach(); }
  return page.evaluate(() => window.controller.finishReview("review"));
}

test("전송 번역 교체가 문단·빈 줄·들여쓰기·탭을 보존한다", async ({ page }) => {
  await setup(page, "원문 제목\n\n첫 문단\n\n둘째 문단\n");
  const translated = "Title\n\nFirst paragraph\n\n  - Second item\n\tColumn A\tColumn B\n\n";
  expect(await deliver(page, translated)).toBe(true);
  expect(await page.evaluate(() => window.readDraft())).toBe(translated);
  expect(await page.evaluate(() => window.controller.pending.get("review").review_ready)).toBe(true);
  expect(await page.evaluate(() => window.events)).toEqual([{ type: "insertFromPaste", types: ["text/plain"] }]);
});

test("한 줄 전송 번역은 기존 입력 경로를 유지한다", async ({ page }) => {
  await setup(page, "원문");
  expect(await deliver(page, "Translation")).toBe(true);
  expect(await page.evaluate(() => window.readDraft())).toBe("Translation");
  expect(await page.evaluate(() => window.events)).toEqual([]);
});

test("붙여넣기를 받지 않는 편집기는 원문을 유지한다", async ({ page }) => {
  const source = "첫째\n\n둘째";
  await setup(page, source, { paste: "ignore" });
  expect(await deliver(page, "First\n\nSecond")).toBe(false);
  expect(await page.evaluate(() => window.readDraft())).toBe(source);
  expect(await page.evaluate(() => Boolean(window.controller.pending.get("review").review_ready))).toBe(false);
});

test("편집기가 붙여넣기를 변형하면 검토 완료로 처리하지 않는다", async ({ page }) => {
  await setup(page, "첫째\n\n둘째", { paste: "flatten" });
  expect(await deliver(page, "First\n\nSecond")).toBe(false);
  expect(await page.evaluate(() => Boolean(window.controller.pending.get("review").review_ready))).toBe(false);
});

test("접두 멘션을 포함한 여러 줄 번역은 멘션을 보존한다", async ({ page }) => {
  await setup(page, "첫째\n\n둘째", { prefix: "@Example" });
  expect(await deliver(page, "First\n\nSecond")).toBe(true);
  expect(await page.evaluate(() => window.readDraft())).toBe("@ExampleFirst\n\nSecond");
  expect(await page.locator('[data-slate-void="true"]').count()).toBe(1);
});

test("긴 번역문도 파일 붙여넣기나 전송 이벤트 없이 검토 초안으로 남는다", async ({ page }) => {
  await setup(page, "첫째\n\n둘째");
  const translated = ("Long translated paragraph. ".repeat(90) + "\n\n").repeat(2);
  expect(await deliver(page, translated)).toBe(true);
  expect(await page.evaluate(() => window.readDraft())).toBe(translated);
  expect(await page.evaluate(() => window.controller.status)).toBe("reviewReadyLong");
  expect(await page.evaluate(() => window.events)).toEqual([{ type: "insertFromPaste", types: ["text/plain"] }]);
});

for (const change of ["focus", "text", "selection"]) {
  test(`삽입 대기 중 ${change} 변경 시 작성창을 덮어쓰지 않는다`, async ({ page }) => {
    const source = "첫째\n\n둘째";
    await setup(page, source);
    const result = await page.evaluate(async change => {
      const promise = window.controller.pasteReview("review", "First\n\nSecond");
      const editor = document.querySelector('[role="textbox"]');
      if (change === "focus") editor.blur();
      if (change === "text") editor.querySelector('[data-slate-string]').textContent = "편집한 원문";
      if (change === "selection") getSelection().collapseToEnd();
      return promise;
    }, change);
    expect(result).toBe(false);
    expect(await page.evaluate(() => window.events)).toEqual([]);
    expect(await page.evaluate(() => window.readDraft())).toBe(change === "text" ? "편집한 원문\n\n둘째" : source);
  });
}
