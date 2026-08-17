import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const installerHooks = readFileSync(
  new URL("../../src-tauri/windows/hooks.nsh", import.meta.url),
  "utf8",
);
const installerTemplate = readFileSync(
  new URL("../../src-tauri/windows/installer.nsi", import.meta.url),
  "utf8",
);
const tauriConfig = JSON.parse(
  readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);
const betaPackager = readFileSync(
  new URL("../../scripts/package_beta.ps1", import.meta.url),
  "utf8",
);
const portablePackager = readFileSync(
  new URL("../../scripts/package.ps1", import.meta.url),
  "utf8",
);
const msvcRuntimeStager = readFileSync(
  new URL("../../scripts/stage_msvc_runtime.ps1", import.meta.url),
  "utf8",
);

test("the Windows uninstaller separates application data from downloaded local AI models", () => {
  assert.equal(
    tauriConfig.bundle.windows.nsis.template,
    "./windows/installer.nsi",
  );
  assert.match(installerTemplate, /Var DeleteLocalModelsCheckbox/);
  assert.match(installerTemplate, /Var DeleteLocalModelsCheckboxState/);
  assert.match(installerTemplate, /\$\(deleteLocalModels\)/);
  assert.doesNotMatch(installerTemplate, /\$\(un\.deleteLocalModels\)/);
  assert.match(
    installerHooks,
    /LangString un\.deleteLocalModels \$\{LANG_KOREAN\} "다운로드한 로컬 AI 모델 삭제하기"/,
  );
  assert.match(
    installerTemplate,
    /SendMessage \$DeleteLocalModelsCheckbox \$\{BM_GETCHECK\} 0 0 \$DeleteLocalModelsCheckboxState/,
  );
  assert.match(installerHooks, /\$DeleteAppDataCheckboxState = 1/);
  assert.match(installerHooks, /\$DeleteLocalModelsCheckboxState = 1/);
  assert.match(installerHooks, /\$UpdateMode <> 1/);
  assert.match(
    installerHooks,
    /RMDir \/r "\$LOCALAPPDATA\\LocalTools\\NudeNyang Discord Translator\\Cache\\models"/,
  );
  assert.match(
    installerHooks,
    /RMDir \/r "\$LOCALAPPDATA\\LocalTools\\NudeNyang Discord Translator\\Cache\\ocr-rust"/,
  );
  assert.doesNotMatch(
    installerHooks,
    /RMDir \/r "\$LOCALAPPDATA\\LocalTools\\NudeNyang Discord Translator"/,
  );
  assert.match(installerHooks, /Delete "\$LOCALAPPDATA\\LocalTools\\NudeNyang Discord Translator\\settings\.json"/);
  assert.match(installerHooks, /RMDir \/r "\$LOCALAPPDATA\\NudeNyang Discord Translator"/);
  assert.match(installerHooks, /cmdkey\.exe[^\r\n]+deepl\.NudeNyang Discord Translator/);
  assert.match(installerHooks, /cmdkey\.exe[^\r\n]+deepl\.NudeNyang Translator/);
  assert.match(installerHooks, /cmdkey\.exe[^\r\n]+deepl\.Nude Translator/);
});

test("the Windows uninstaller uses the NudeNyang Discord Translator icon", () => {
  assert.equal(
    tauriConfig.bundle.windows.nsis.uninstallerIcon,
    "../assets/nude-translator.ico",
  );
});

test("the Windows installer follows the system language and allows a manual choice", () => {
  const nsis = tauriConfig.bundle.windows.nsis;

  assert.equal(nsis.displayLanguageSelector, true);
  assert.match(installerTemplate, /!define MUI_LANGDLL_ALWAYSSHOW/);
  assert.ok(
    installerTemplate.indexOf("!define MUI_LANGDLL_ALWAYSSHOW") <
      installerTemplate.indexOf("!insertmacro MUI_LANGDLL_DISPLAY"),
    "the always-show option must be defined before opening the language selector",
  );
  assert.equal(nsis.languages[0], "English");
  for (const language of [
    "Korean",
    "Japanese",
    "SimpChinese",
    "TradChinese",
    "PortugueseBR",
    "SpanishInternational",
    "German",
    "Russian",
    "French",
  ]) {
    assert.ok(nsis.languages.includes(language), `${language} must be selectable`);
  }
});

test("the Windows installer uses the light NudeNyang artwork", () => {
  const nsis = tauriConfig.bundle.windows.nsis;

  assert.equal(nsis.installerIcon, "../assets/nude-translator.ico");
  assert.equal(nsis.headerImage, "../assets/installer/header-light.bmp");
  assert.equal(nsis.sidebarImage, "../assets/installer/sidebar-light.bmp");
  assert.equal(
    nsis.uninstallerHeaderImage,
    "../assets/installer/header-light.bmp",
  );

  const readBitmapSize = (relativePath) => {
    const bitmap = readFileSync(new URL(relativePath, import.meta.url));
    assert.equal(bitmap.subarray(0, 2).toString("ascii"), "BM");
    return {
      width: bitmap.readInt32LE(18),
      height: bitmap.readInt32LE(22),
      bitsPerPixel: bitmap.readUInt16LE(28),
    };
  };

  assert.deepEqual(
    readBitmapSize("../../assets/installer/header-light.bmp"),
    { width: 150, height: 57, bitsPerPixel: 24 },
  );
  assert.deepEqual(
    readBitmapSize("../../assets/installer/sidebar-light.bmp"),
    { width: 164, height: 314, bitsPerPixel: 24 },
  );
});

test("Windows packages carry the complete signed MSVC runtime beside llama-server", () => {
  for (const packager of [betaPackager, portablePackager]) {
    assert.match(packager, /stage_msvc_runtime\.ps1/);
    assert.match(
      packager,
      /Copy-MsvcRuntime\s+-DestinationDirectory\s+\$[A-Za-z]+Destination/,
    );
  }

  for (const file of [
    "concrt140.dll",
    "msvcp140.dll",
    "msvcp140_1.dll",
    "msvcp140_2.dll",
    "msvcp140_atomic_wait.dll",
    "msvcp140_codecvt_ids.dll",
    "vccorlib140.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
    "vcruntime140_threads.dll",
  ]) {
    assert.ok(msvcRuntimeStager.includes(file), `${file} must be staged`);
  }
  assert.match(msvcRuntimeStager, /Get-AuthenticodeSignature/);
  assert.match(msvcRuntimeStager, /Microsoft Corporation/);
});
