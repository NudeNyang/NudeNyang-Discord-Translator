import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const state = readFileSync(new URL("../state.mjs", import.meta.url), "utf8");
const engine = readFileSync(new URL("../../src-tauri/src/engine.rs", import.meta.url), "utf8");
const verification = readFileSync(
  new URL("../../src-tauri/src/discord_verification.rs", import.meta.url),
  "utf8",
);
const verificationProduction = verification.split("#[cfg(test)]")[0];
const cdp = readFileSync(new URL("../../src-tauri/src/cdp.rs", import.meta.url), "utf8");
const i18n = readFileSync(new URL("../i18n.mjs", import.meta.url), "utf8");
const generatedLocales = readFileSync(new URL("../ui-locales.json", import.meta.url), "utf8");

test("Discord verification pauses the pipe and offers a neutral compatibility flow", () => {
  assert.match(markup, /id="verification-banner"/);
  assert.match(markup, /Discord 인증을 완료한 후 NudeNyang을 다시 연결할 수 있습니다/);
  assert.match(markup, /id="verification-continue-vanilla"[^>]*>현재 Discord에서 인증 계속/);
  assert.match(markup, /id="verification-reconnect"[^>]*>NudeNyang 다시 연결/);
  assert.match(script, /invoke\("discord_restart_vanilla"/);
  assert.match(script, /invoke\("discord_restart"/);
  assert.match(script, /tauriListen\("discord-verification-required"/);
  assert.match(state, /verificationRequired/);
  assert.match(engine, /disconnect_current_guardian\(\)/);
  assert.match(engine, /discord_verification_mode/);
  assert.doesNotMatch(`${markup}\n${script}\n${i18n}\n${generatedLocales}`, /누드냥/);
});

test("continuing verification reveals one persistent reconnect action", () => {
  assert.match(markup, /id="verification-reconnect-header"[^>]*hidden/);
  assert.match(script, /verificationReconnectHeader: document\.querySelector\("#verification-reconnect-header"\)/);
  assert.match(script, /verificationReconnect: document\.querySelector\("#verification-reconnect"\)/);
  assert.match(
    script,
    /elements\.verificationReconnectHeader\.hidden = !active \|\| !state\.verificationBannerDismissed/,
  );
  assert.match(script, /elements\.verificationReconnectHeader\.disabled = disabled/);
  assert.match(script, /elements\.verificationReconnectHeader\.addEventListener\("click", requestVerificationReconnect\)/);
  assert.match(script, /elements\.verificationReconnect\.addEventListener\("click", requestVerificationReconnect\)/);
  assert.match(
    script,
    /state\.verificationBannerDismissed = true;[\s\S]*?renderVerificationMode\(\);/,
  );
});

test("verification detection is read-only and CDP cannot synthesize account actions", () => {
  assert.match(verificationProduction, /hcaptcha\.com/);
  assert.match(verificationProduction, /one-time-code/);
  assert.doesNotMatch(verificationProduction, /dispatchEvent|\.click\(/);
  assert.match(cdp, /method == "Input\.insertText"/);
  assert.match(cdp, /Input\.dispatchKeyEvent/);
  assert.match(cdp, /assert!\(!is_allowed_cdp_method\("Input\.dispatchKeyEvent"\)\)/);
});
