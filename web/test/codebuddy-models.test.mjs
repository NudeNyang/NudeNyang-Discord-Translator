// web/test/codebuddy-models.test.mjs
//
// Exercises the REAL model-catalog controller pulled straight out of
// web/app.js: the source slice that starts at
//
//     let codeBuddyModelsLoading = false;
//
// and ends just before
//
//     function revealProviderConnection
//
// The slice (controller flags, renderCodeBuddyModels(), async loadCodeBuddyModels())
// is evaluated inside a vm context whose globals are a small DOM + dependency
// harness. Only the existing widget renderer (renderSelect / setSelectValue / ...)
// is stubbed; the catalog logic under test is the real product code. Nothing from
// app.js is copied into this file.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const START_MARKER = "let codeBuddyModelsLoading = false;";
const END_MARKER = "function revealProviderConnection";
const FIELD = "codebuddy_model";
const REFRESH_ID = "codebuddy-models-refresh";

// ---------------------------------------------------------------------------
// 1. Extract the controller slice from the real product source.
// ---------------------------------------------------------------------------

const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

function extractControllerSlice(source) {
  const start = source.indexOf(START_MARKER);
  assert.notEqual(start, -1, `start marker not found in web/app.js: ${START_MARKER}`);

  const end = source.indexOf(END_MARKER, start + START_MARKER.length);
  assert.notEqual(end, -1, `end marker not found in web/app.js: ${END_MARKER}`);

  return source.slice(start, end);
}

const controllerSlice = extractControllerSlice(appSource);

// Appended to the slice inside the same script scope so the hoisted function
// declarations can be handed back to the test.
const EPILOGUE =
  "\n;globalThis.__codeBuddyModelsExports = {" +
  " renderCodeBuddyModels, loadCodeBuddyModels };\n";

// Catalog entries carry id/value/label/name aliases so the controller may read
// whichever property it prefers; the tests never re-implement that mapping.
function modelEntry(id, label) {
  return id;
}

// ---------------------------------------------------------------------------
// 2. Harness: fresh DOM + dependency stubs per test.
// ---------------------------------------------------------------------------

function createHarness() {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div class="custom-select" data-field="${FIELD}">
      <button class="select-trigger" type="button">Model</button>
    </div>
    <button id="${REFRESH_ID}" type="button">Refresh models</button>
    <span class="save-status"></span>
  </body></html>`);
  const document = dom.window.document;

  const state = {
    config: { [FIELD]: "custom-local:chosen/model" },
    selectValues: { [FIELD]: "custom-local:chosen/model" },
  };

  // Options store. Supports both array-style use (OPTIONS.push/length) and
  // registry-style use (OPTIONS[FIELD] = [...]) without knowing which the
  // controller prefers; both funnel into the same backing array.
  const OPTIONS = [];
  Object.defineProperty(OPTIONS, FIELD, {
    configurable: true,
    get() {
      return OPTIONS;
    },
    set(value) {
      OPTIONS.length = 0;
      if (Array.isArray(value)) OPTIONS.push(...value);
    },
  });

  const elements = { saveStatus: document.querySelector(".save-status") };
  const invokes = [];
  const errors = [];
  const diagnostics = [];

  // invoke: ONLY codebuddy_models_get is allowed; anything else throws.
  let invokeImpl = () => Promise.resolve([]);
  function invoke(command, args) {
    if (command !== "codebuddy_models_get") {
      throw new Error(`unexpected invoke command: ${command}`);
    }
    invokes.push({ command, args });
    return invokeImpl(command, args);
  }

  // --- stubbed existing widget renderer -----------------------------------
  function findContainer() {
    return document.querySelector(`.custom-select[data-field="${FIELD}"]`);
  }

  function optionLabel(value) {
    const found = OPTIONS.find((option) => option && option[0] === value);
    return found ? found[1] : value;
  }

  function closeSelect() {
    /* recorded no-op */
  }

  // renderSelect stub: rebuilds button.select-trigger + .select-option list
  // from the OPTIONS store (or an explicitly passed list).
  function renderSelect(a, b, c) {
    let options = OPTIONS;
    let selected;
    if (Array.isArray(a)) {
      options = a;
      selected = b;
    } else {
      if (Array.isArray(b)) options = b;
      if (c !== undefined) selected = c;
    }
    if (selected === undefined) {
      selected = state.selectValues[FIELD] ?? state.config[FIELD];
    }

    const container = findContainer();
    if (!container) return;
    container.textContent = "";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "select-trigger";
    const triggerLabel = document.createElement("span");
    triggerLabel.className = "select-trigger-label";
    triggerLabel.textContent = optionLabel(selected) ?? selected ?? "";
    trigger.appendChild(triggerLabel);
    container.appendChild(trigger);

    for (const option of options) {
      const el = document.createElement("div");
      el.className = "select-option";
      el.dataset.value = option[0];
      el.textContent = option[1];
      if (option[0] === selected) {
        el.dataset.selected = "true";
        el.classList.add("is-selected");
      }
      container.appendChild(el);
    }
  }

  // setSelectValue stub: updates state and the visible label.
  function setSelectValue(field, value) {
    if (field !== FIELD) {
      if (typeof field === "string" && value !== undefined) state.selectValues[field] = value;
      return;
    }
    state.selectValues[FIELD] = value;
    const label = document.querySelector(
      `.custom-select[data-field="${FIELD}"] .select-trigger-label`,
    );
    if (label) label.textContent = value;
  }

  function setLocalizedError(_element, error) {
    errors.push(error);
  }

  function writeDiagnostic(...args) {
    diagnostics.push(args);
  }

  function t(key) {
    return key;
  }

  // --- evaluate the real slice -------------------------------------------
  const context = {
    document,
    window: dom.window,
    navigator: dom.window.navigator,
    location: dom.window.location,
    state,
    OPTIONS,
    elements,
    closeSelect,
    renderSelect,
    setSelectValue,
    setLocalizedError,
    writeDiagnostic,
    t,
    invoke,
    console,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);

  try {
    vm.runInContext(controllerSlice + EPILOGUE, context, {
      filename: "web/app.js[codebuddy-model-controller]",
    });
  } catch (error) {
    throw new Error(
      `failed to evaluate the extracted controller slice: ${error && error.message}`,
    );
  }

  const exports = context.__codeBuddyModelsExports;
  assert.equal(typeof exports.renderCodeBuddyModels, "function");
  assert.equal(typeof exports.loadCodeBuddyModels, "function");

  return {
    dom,
    document,
    state,
    OPTIONS,
    elements,
    invokes,
    errors,
    diagnostics,
    exports,
    context,
    button: document.getElementById(REFRESH_ID),
    setInvokeImpl(fn) {
      invokeImpl = fn;
    },
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function renderedValues(h) {
  return Array.from(
    h.document.querySelectorAll(`.custom-select[data-field="${FIELD}"] .select-option`),
    (el) => el.dataset.value,
  );
}

function renderedSelected(h) {
  const el = h.document.querySelector(
    `.custom-select[data-field="${FIELD}"] .select-option[data-selected="true"]`,
  );
  return el ? el.dataset.value : null;
}

function buttonBusy(button) {
  if (!button) return false;
  return (
    button.disabled === true ||
    button.getAttribute("aria-busy") === "true" ||
    button.classList.contains("is-loading") ||
    button.classList.contains("loading") ||
    button.classList.contains("busy")
  );
}

// ---------------------------------------------------------------------------
// 3. Tests
// ---------------------------------------------------------------------------

test("automatic optional model probing does not overwrite settings status", async () => {
  const h = createHarness();
  h.setInvokeImpl(async () => {
    throw new Error("CodeBuddy CLI unavailable");
  });

  await h.exports.loadCodeBuddyModels({ silent: true });

  assert.equal(h.errors.length, 0);
  assert.ok(h.diagnostics.length >= 1);
  assert.equal(h.button.disabled, false);

  await h.exports.loadCodeBuddyModels();

  assert.equal(h.errors.length, 1);
});

test("renders the catalog as dynamic options with full ids and keeps the current selection", () => {
  const h = createHarness();
  const catalog = [
    modelEntry("native:gpt-4o", "GPT-4o"),
    modelEntry("custom-local:chosen/model", "Chosen Model"),
    modelEntry("native:future-model", "Future Model"),
    modelEntry("native:gpt-4o", "GPT-4o (duplicate entry)"),
  ];

  h.exports.renderCodeBuddyModels(catalog, "custom-local:chosen/model");

  const values = renderedValues(h);
  // duplicates collapsed, full provider:model ids preserved
  assert.equal(values.length, 3);
  assert.deepEqual(
    [...values].sort(),
    ["custom-local:chosen/model", "native:future-model", "native:gpt-4o"],
  );
  assert.equal(renderedSelected(h), "custom-local:chosen/model");
  assert.equal(h.state.selectValues[FIELD], "custom-local:chosen/model");
  // catalog rendering must not trigger persistence or inference traffic
  assert.equal(h.invokes.length, 0, "renderCodeBuddyModels must not call invoke");
});

test("keeps the selected model when it is missing from the catalog", () => {
  const h = createHarness();

  h.exports.renderCodeBuddyModels(
    [modelEntry("native:gpt-4o", "GPT-4o")],
    "custom-local:chosen/model",
  );

  const values = renderedValues(h);
  assert.ok(values.includes("native:gpt-4o"));
  assert.ok(
    values.includes("custom-local:chosen/model"),
    "the previously chosen model must be retained even when absent from the catalog",
  );
  assert.equal(values.length, 2);
  assert.equal(renderedSelected(h), "custom-local:chosen/model");
});

test("applies the selection made while the catalog request is still pending", async () => {
  const h = createHarness();
  let release;
  h.setInvokeImpl(() => new Promise((resolve) => {
    release = resolve;
  }));

  const pending = h.exports.loadCodeBuddyModels();
  assert.equal(h.invokes.length, 1, "the refresh must issue exactly one request");

  // user changes the picker before the deferred request resolves
  h.state.config[FIELD] = "native:future-model";
  h.state.selectValues[FIELD] = "native:future-model";

  release([
    modelEntry("custom-local:chosen/model", "Chosen Model"),
    modelEntry("native:future-model", "Future Model"),
  ]);
  await pending;

  assert.equal(
    renderedSelected(h),
    "native:future-model",
    "the latest selection must win, not the selection captured before the await",
  );
  assert.ok(renderedValues(h).includes("native:future-model"));
  assert.equal(h.invokes.length, 1);
});

test("collapses concurrent refreshes to one request and toggles the busy state", async () => {
  const h = createHarness();
  let release;
  h.setInvokeImpl(() => new Promise((resolve) => {
    release = resolve;
  }));

  const first = h.exports.loadCodeBuddyModels();
  const second = h.exports.loadCodeBuddyModels();

  assert.equal(h.invokes.length, 1, "a second refresh while pending must not re-invoke");
  assert.ok(buttonBusy(h.button), "the refresh button must be busy while loading");

  release([modelEntry("native:gpt-4o", "GPT-4o")]);
  await first;
  await Promise.resolve(second);

  assert.equal(h.invokes.length, 1, "still exactly one request overall");
  assert.ok(!buttonBusy(h.button), "the refresh button must be re-enabled afterwards");
});

test("keeps previous options and reports failure when the catalog request fails", async () => {
  const h = createHarness();
  h.setInvokeImpl(() =>
    Promise.resolve([
      modelEntry("native:gpt-4o", "GPT-4o"),
      modelEntry("custom-local:chosen/model", "Chosen Model"),
    ]),
  );
  await h.exports.loadCodeBuddyModels();

  const before = renderedValues(h);
  assert.deepEqual(before, ["native:gpt-4o", "custom-local:chosen/model"]);

  h.setInvokeImpl(() => Promise.reject(new Error("network down")));
  await h.exports.loadCodeBuddyModels().catch(() => {});

  assert.deepEqual(renderedValues(h), before, "the previous options must survive a failure");
  assert.equal(renderedSelected(h), "custom-local:chosen/model");
  assert.ok(h.errors.length >= 1, "a failed refresh must be reported to the user");
});

test("keeps previous options and reports failure when the catalog is empty/invalid", async () => {
  const h = createHarness();
  h.setInvokeImpl(() =>
    Promise.resolve([
      modelEntry("native:gpt-4o", "GPT-4o"),
      modelEntry("custom-local:chosen/model", "Chosen Model"),
    ]),
  );
  await h.exports.loadCodeBuddyModels();

  const before = renderedValues(h);
  assert.deepEqual(before, ["native:gpt-4o", "custom-local:chosen/model"]);

  h.setInvokeImpl(() => Promise.resolve([]));
  await h.exports.loadCodeBuddyModels().catch(() => {});

  assert.deepEqual(renderedValues(h), before, "an empty catalog must not wipe the picker");
  assert.equal(renderedSelected(h), "custom-local:chosen/model");
  assert.ok(h.errors.length >= 1, "an invalid catalog must be reported to the user");
});
