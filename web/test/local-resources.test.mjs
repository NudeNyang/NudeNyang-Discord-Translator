import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { localModelResourceGuidance } from "../state.mjs";

const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const rustMain = readFileSync(new URL("../../src-tauri/src/main.rs", import.meta.url), "utf8");
const engine = readFileSync(new URL("../../src-tauri/src/engine.rs", import.meta.url), "utf8");
const hymt = readFileSync(
  new URL("../../src-tauri/src/translation/hymt.rs", import.meta.url),
  "utf8",
);

const GiB = 1024 ** 3;

test("local model guidance warns when the selected model exceeds available RAM", () => {
  assert.deepEqual(
    localModelResourceGuidance(
      { translator: "hymt_7b", outgoing_translator: "hymt_7b", hymt_device: "auto" },
      { totalBytes: 8 * GiB, availableBytes: 4 * GiB },
    ),
    {
      model: "Hy-MT2 7B",
      modelBytes: 4_624_648_896,
      recommendedAvailableBytes: 8 * GiB,
      totalBytes: 8 * GiB,
      availableBytes: 4 * GiB,
      state: "warning",
      recommendLowMemoryPreset: true,
    },
  );
});

test("the 1.8B CPU preset is accepted when enough RAM is available", () => {
  assert.equal(
    localModelResourceGuidance(
      {
        translator: "hymt_1_8b",
        outgoing_translator: "hymt_1_8b",
        hymt_device: "cpu",
      },
      { totalBytes: 16 * GiB, availableBytes: 6 * GiB },
    ).state,
    "ready",
  );
});

test("settings expose CPU and RAM-only execution with a low-memory preset", () => {
  assert.match(script, /\["cpu", "CPU\/RAM 전용"\]/);
  assert.match(markup, /id="local-resource-guidance"/);
  assert.match(markup, /id="apply-low-memory-preset"/);
  assert.match(script, /invoke\("system_memory_status_get"\)/);
  assert.match(script, /hymt_device: "cpu"/);
  assert.match(script, /keep_local_model_warm: false/);
  assert.match(rustMain, /fn system_memory_status_get\(/);
});

test("automatic GPU failure reports CPU fallback and uses the low-memory context", () => {
  assert.match(hymt, /report_progress\("cpu-fallback"/);
  assert.match(engine, /CPU\/RAM 전용 모드로 전환했습니다/);
  assert.match(hymt, /fn context_size_for_attempt\(/);
  assert.match(hymt, /\("cpu", _\) => "2048"/);
});
