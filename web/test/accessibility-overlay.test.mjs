import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const overlayScript = readFileSync(new URL("../overlay.js", import.meta.url), "utf8");
const overlayCss = readFileSync(new URL("../overlay.css", import.meta.url), "utf8");
const tauriConfig = readFileSync(
  new URL("../../src-tauri/tauri.conf.json", import.meta.url),
  "utf8",
);
const discordRuntime = readFileSync(
  new URL("../../src-tauri/src/discord.rs", import.meta.url),
  "utf8",
);

test("accessibility translations use a non-interactive text-only overlay", () => {
  assert.match(overlayScript, /element\.textContent = item\.text/);
  assert.doesNotMatch(overlayScript, /innerHTML|insertAdjacentHTML|document\.write/);
  assert.match(overlayCss, /pointer-events:\s*none/);
  assert.match(tauriConfig, /"label": "translation-overlay"/);
  assert.match(tauriConfig, /"focusable": false/);
  assert.match(tauriConfig, /"transparent": true/);
});

test("Discord accessibility launch never creates a remote debugging transport", () => {
  assert.match(discordRuntime, /fn accessibility_arguments/);
  assert.match(discordRuntime, /\["--force-renderer-accessibility"\]/);
  assert.doesNotMatch(discordRuntime, /fn restart_pipe|fn run_pipe_helper/);
  assert.doesNotMatch(discordRuntime, /remote-debugging-io-pipes/);
  assert.match(discordRuntime, /accessibility-restart\.lock/);
});
