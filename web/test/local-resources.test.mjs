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
const localModels = readFileSync(
  new URL("../../src-tauri/src/translation/local_model.rs", import.meta.url),
  "utf8",
);

const GiB = 1024 ** 3;

test("local model guidance reports approximate GPU usage instead of safety headroom", () => {
  assert.deepEqual(
    localModelResourceGuidance(
      { translator: "hymt_7b", outgoing_translator: "hymt_7b", hymt_device: "auto" },
      { totalBytes: 8 * GiB, availableBytes: 4 * GiB },
    ),
    {
      model: "Hy-MT2 7B",
      modelBytes: 4_624_648_896,
      estimatedUsageBytes: Math.round(5.3 * GiB),
      usageKind: "vram",
      totalBytes: 8 * GiB,
      availableBytes: 4 * GiB,
      state: "ready",
      recommendLowMemoryPreset: true,
    },
  );
});

test("the 1.8B guidance distinguishes estimated CPU RAM usage", () => {
  assert.deepEqual(
    localModelResourceGuidance(
      {
        translator: "hymt_1_8b",
        outgoing_translator: "hymt_1_8b",
        hymt_device: "cpu",
      },
      { totalBytes: 16 * GiB, availableBytes: 6 * GiB },
    ),
    {
      model: "Hy-MT2 1.8B",
      modelBytes: 1_133_080_448,
      estimatedUsageBytes: 2 * GiB,
      usageKind: "ram",
      totalBytes: 16 * GiB,
      availableBytes: 6 * GiB,
      state: "ready",
      recommendLowMemoryPreset: false,
    },
  );
});

test("the measured 1.8B automatic profile is shown as about 1.7GB of VRAM", () => {
  const guidance = localModelResourceGuidance(
    { translator: "hymt_1_8b", hymt_device: "auto" },
    { totalBytes: 64 * GiB, availableBytes: 30 * GiB },
  );
  assert.equal(guidance.usageKind, "vram");
  assert.equal((guidance.estimatedUsageBytes / GiB).toFixed(1), "1.7");
});

test("settings expose automatic VRAM protection, GPU priority, and CPU-only execution", () => {
  assert.match(script, /\["auto", "자동 보호 \(권장\)"\]/);
  assert.match(script, /\["gpu", "GPU 우선"\]/);
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
  assert.match(hymt, /self\.profile\.context_size\(attempt\)/);
  assert.match(localModels, /cpu_context_size: "2048"/);
  assert.match(localModels, /if attempt == "cpu"/);
});
