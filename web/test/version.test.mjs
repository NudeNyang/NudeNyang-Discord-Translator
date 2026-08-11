import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"));
const tauriConfig = JSON.parse(readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const cargoToml = readFileSync(new URL("../../src-tauri/Cargo.toml", import.meta.url), "utf8");
const cargoLock = readFileSync(new URL("../../src-tauri/Cargo.lock", import.meta.url), "utf8");

test("application version is consistently set to 0.4.7 beta", () => {
  const expected = "0.4.7-beta";
  assert.equal(packageJson.version, expected);
  assert.equal(packageLock.version, expected);
  assert.equal(packageLock.packages[""].version, expected);
  assert.equal(tauriConfig.version, expected);
  assert.match(cargoToml, /version = "0\.4\.7-beta"/);
  assert.match(cargoLock, /name = "nude-translator-tauri"\s+version = "0\.4\.7-beta"/);
});
