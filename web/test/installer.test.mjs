import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const installerHooks = readFileSync(
  new URL("../../src-tauri/windows/hooks.nsh", import.meta.url),
  "utf8",
);
const tauriConfig = JSON.parse(
  readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);

test("the Windows uninstaller removes every app-owned data store when requested", () => {
  assert.match(installerHooks, /\$DeleteAppDataCheckboxState = 1/);
  assert.match(installerHooks, /\$UpdateMode <> 1/);
  assert.match(
    installerHooks,
    /RMDir \/r "\$LOCALAPPDATA\\LocalTools\\DiscordTranslateOverlay"/,
  );
  assert.match(installerHooks, /RMDir \/r "\$LOCALAPPDATA\\NudeNyang Translator"/);
  assert.match(installerHooks, /cmdkey\.exe[^\r\n]+deepl\.NudeNyang Translator/);
  assert.match(installerHooks, /cmdkey\.exe[^\r\n]+deepl\.Nude Translator/);
});

test("the Windows uninstaller uses the NudeNyang Translator icon", () => {
  assert.equal(
    tauriConfig.bundle.windows.nsis.uninstallerIcon,
    "../assets/nude-translator.ico",
  );
});
