import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

const packager = fs.readFileSync(
  new URL("../../scripts/package_chromium_extension.ps1", import.meta.url),
  "utf8",
);

function extensionIdFromKey(key) {
  const hash = crypto.createHash("sha256").update(Buffer.from(key, "base64")).digest().subarray(0, 16);
  return [...hash]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
    .join("");
}

test("Chrome 웹 스토어 패키지는 개발용 공개 키를 매니페스트에서 제거한다", () => {
  assert.match(packager, /PSObject\.Properties\.Remove\(['"]key['"]\)/);
  assert.match(packager, /manifest\.json/);
  assert.match(packager, /NudeNyang-Web-Translator-Chromium-/);
  assert.match(packager, /page-connection\.js/);
  assert.doesNotMatch(packager, /Compress-Archive/);
  assert.match(packager, /\.Replace\('\\', '\/'\)/);
});

test("개인용 Chromium 확장은 스토어 제출본과 별도 ID로 패키징한다", () => {
  const identityUrl = new URL("../chromium-identities.json", import.meta.url);
  const personalPackagerUrl = new URL("../../scripts/package_personal_chromium_extension.ps1", import.meta.url);
  assert.equal(fs.existsSync(identityUrl), true);
  assert.equal(fs.existsSync(personalPackagerUrl), true);

  const identities = JSON.parse(fs.readFileSync(identityUrl, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const personalPackager = fs.readFileSync(personalPackagerUrl, "utf8");
  assert.equal(extensionIdFromKey(manifest.key), identities.store.extensionId);
  assert.equal(extensionIdFromKey(identities.personal.publicKey), identities.personal.extensionId);
  assert.notEqual(identities.store.extensionId, identities.personal.extensionId);
  assert.match(personalPackager, /chromium-personal-extension/);
  assert.match(personalPackager, /PersonalIdentity\.publicKey/);
});

test("일반 본문은 최상위 문서에만, 삽입 영상 제목은 허용된 embed 문서에만 주입한다", () => {
  for (const manifestName of ["manifest.json", "manifest.firefox.json"]) {
    const manifest = JSON.parse(fs.readFileSync(new URL(`../${manifestName}`, import.meta.url), "utf8"));
    assert.equal(manifest.content_scripts.length, 2, manifestName);
    assert.deepEqual(manifest.content_scripts[0].matches, ["http://*/*", "https://*/*"]);
    assert.deepEqual(manifest.content_scripts[0].js, ["site-adapters.js", "messenger-adapters.js", "content-helpers.js", "popup-locales.js", "content.js"]);
    assert.notEqual(manifest.content_scripts[0].all_frames, true, manifestName);
    assert.deepEqual(manifest.content_scripts[1], {
      matches: ["https://www.youtube.com/embed/*", "https://www.youtube-nocookie.com/embed/*"],
      js: ["embedded-title.js"],
      run_at: "document_idle",
      all_frames: true,
    }, manifestName);
  }
});

test("개인용과 모든 스토어 패키지에 삽입 영상 제목 스크립트와 브리지를 포함한다", () => {
  for (const scriptName of [
    "package_personal_chromium_extension.ps1",
    "package_chromium_extension.ps1",
    "package_firefox_extension.ps1",
  ]) {
    const script = fs.readFileSync(new URL(`../../scripts/${scriptName}`, import.meta.url), "utf8");
    const sharedFiles = script.match(/\$SharedFiles\s*=\s*@\(([\s\S]*?)\)/)?.[1] ?? "";
    assert.match(sharedFiles, /'embedded-title\.js'/, scriptName);
    assert.match(sharedFiles, /'embedded-bridge\.js'/, scriptName);
  }
});

test("개인용과 모든 스토어 패키지는 메신저 어댑터와 별도 동의 화면의 의존 파일을 빠짐없이 포함한다", () => {
  const messengerFiles = [
    "messenger-adapters.js",
    "messenger-privacy.js",
    "messenger-privacy.html",
    "messenger-privacy-page.js",
    "messenger-privacy.css",
  ];
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const importedScripts = [...background.matchAll(/importScripts\("([^"]+)"\)/g)].map((match) => match[1]);
  const consentPage = fs.readFileSync(new URL("../messenger-privacy.html", import.meta.url), "utf8");
  const consentDependencies = [...consentPage.matchAll(/(?:src|href)="([^"/]+\.(?:js|css))"/g)].map((match) => match[1]);

  for (const scriptName of [
    "package_personal_chromium_extension.ps1",
    "package_chromium_extension.ps1",
    "package_firefox_extension.ps1",
  ]) {
    const script = fs.readFileSync(new URL(`../../scripts/${scriptName}`, import.meta.url), "utf8");
    const sharedSection = script.match(/\$SharedFiles\s*=\s*@\(([\s\S]*?)\)/)?.[1] ?? "";
    const sharedFiles = [...sharedSection.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    for (const fileName of new Set([...messengerFiles, ...importedScripts, ...consentDependencies])) {
      assert.equal(sharedFiles.filter((file) => file === fileName).length, 1, `${scriptName}: ${fileName}`);
      assert.equal(fs.existsSync(new URL(`../${fileName}`, import.meta.url)), true, fileName);
    }
  }
});
