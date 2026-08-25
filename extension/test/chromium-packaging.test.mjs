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
