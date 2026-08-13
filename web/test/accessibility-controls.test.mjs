import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const controlsHtml = await readFile(new URL("../accessibility-controls.html", import.meta.url), "utf8");
const controlsJs = await readFile(new URL("../accessibility-controls.js", import.meta.url), "utf8");
const tauriConfig = JSON.parse(
  await readFile(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);

test("accessibility mode keeps a compact display-language control over Discord", () => {
  assert.match(controlsHtml, /id="language-trigger"/);
  assert.match(controlsHtml, /id="language-menu"/);
  assert.match(controlsJs, /target_language/);
  assert.match(controlsJs, /accessibility_controls_resize/);

  const window = tauriConfig.app.windows.find(
    (candidate) => candidate.label === "accessibility-controls",
  );
  assert.ok(window);
  assert.equal(window.visible, false);
  assert.equal(window.skipTaskbar, true);
  assert.equal(window.width, 72);
});
