import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, dom, engine] = await Promise.all([
  readFile(new URL("../../src-tauri/src/main.rs", import.meta.url), "utf8"),
  readFile(new URL("../../src-tauri/src/dom.rs", import.meta.url), "utf8"),
  readFile(new URL("../../src-tauri/src/engine.rs", import.meta.url), "utf8"),
]);

test("application exit disables translation and waits for the engine restore", () => {
  const shutdown = main.slice(
    main.indexOf("fn shutdown_translation"),
    main.indexOf("fn hide_tray_menu"),
  );
  assert.match(shutdown, /engine\.set_enabled\(false\)/);
  assert.doesNotMatch(shutdown, /config\.update/);
  assert.doesNotMatch(shutdown, /restart_accessibly_after_pipe/);
  assert.ok(shutdown.indexOf("engine.set_enabled(false)") < shutdown.indexOf("engine.stop()"));
  assert.match(main, /shutdown_translation\(&app\);\s*app\.exit\(0\)/);
});

test("the private DOM pipe survives the UI process and can be reclaimed", () => {
  assert.match(main, /connect_guarded_pipe/);
  assert.match(main, /--discord-cdp-pipe-guardian/);
});

test("translated Discord nodes retain an exact original-text restore registry", () => {
  assert.match(dom, /window\.__nudeTranslatorOriginals/);
  assert.match(dom, /originals\.set/);
  assert.match(dom, /originals\.clear/);
  assert.match(engine, /client\.evaluate\(RESTORE_TEXT_SCRIPT, false\)/);
});
