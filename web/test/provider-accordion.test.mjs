import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createProviderAccordion } from "../provider-accordion.mjs";

function setup() {
  const dom = new JSDOM(readFileSync(new URL("../index.html", import.meta.url), "utf8"));
  const document = dom.window.document;
  const root = document.querySelector("#provider-connections");
  const controller = createProviderAccordion(root);
  const row = root.querySelector('[data-provider="openai_compat"]');
  const button = row.querySelector(".provider-summary");
  return { document, root, controller, row, button };
}

test("only OpenAI details collapse; all existing status, connect and disconnect controls remain outside", () => {
  const { root, row, button } = setup();
  assert.equal(root.querySelectorAll(".provider-summary").length, 1);
  assert.equal(root.querySelectorAll(".provider-status").length, 5);
  const panel = row.querySelector(".provider-panel");
  assert.ok(panel.hidden);
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(button.getAttribute("aria-controls"), panel.id);
  assert.equal(panel.getAttribute("aria-labelledby"), button.id);
  for (const control of root.querySelectorAll(".provider-status,.provider-action,.provider-disconnect,.provider-secret")) {
    assert.equal(control.closest(".provider-panel"), null);
  }
  for (const provider of ["chatgpt", "claude", "gemini", "deepl"]) {
    assert.equal(root.querySelector(`[data-provider="${provider}"] .provider-summary`), null);
  }
});

test("closing and reopening preserves API drafts and advanced choices without rebuilding fields", () => {
  const { document, button } = setup();
  button.click();
  const secret = document.querySelector("#openai-compat-key");
  secret.value = "test-draft-only";
  document.querySelector("#openai-compat-model").value = "draft-model";
  document.querySelector("#openai-compat-concurrency").value = "7";
  button.click();
  assert.ok(document.querySelector("#openai-compat-form").hidden);
  button.click();
  assert.equal(document.querySelector("#openai-compat-key"), secret);
  assert.equal(secret.value, "test-draft-only");
  assert.equal(document.querySelector("#openai-compat-model").value, "draft-model");
  assert.equal(document.querySelector("#openai-compat-concurrency").value, "7");
});

test("programmatic setup navigation opens details and returns focus before hiding inputs", () => {
  const { document, controller, button } = setup();
  controller.open("openai_compat", { focus: true });
  assert.equal(document.activeElement, button);
  assert.equal(document.querySelector("#openai-compat-form").hidden, false);
  document.querySelector("#openai-compat-model").focus();
  controller.open("deepl");
  assert.equal(document.activeElement, button);
  assert.equal(document.querySelector("#openai-compat-form").hidden, true);
});

test("advanced tuning is a static labeled section without a second disclosure", () => {
  const { document, row } = setup();
  const advanced = document.querySelector(".provider-advanced");
  assert.equal(advanced.tagName, "SECTION");
  assert.equal(advanced.hidden, false);
  assert.equal(advanced.querySelector("summary,details,.provider-chevron"), null);
  assert.equal(document.getElementById(advanced.getAttribute("aria-labelledby")).textContent, "고급 설정");
  for (const id of ["batch-size", "concurrency", "shared-context"]) {
    assert.ok(advanced.querySelector(`#openai-compat-${id}`));
  }
  assert.equal(advanced.querySelector("#openai-compat-connect"), null);
  assert.equal(advanced.querySelector(".provider-form-note"), null);
  assert.match(row.querySelector(".provider-form-note").textContent, /선택한 서버로 번역할 텍스트가 전송됩니다/);
});
