// Opt-in Windows integration check. Uses synthetic fixture copy only: no mail
// access, browser profile access, consent/settings changes, or external tokens.
// The real native host owns its authenticated connection to the running app.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MAIL_COPY } from "../extension/test/fixtures/mail-reading.mjs";

if (process.argv.slice(2).join(" ") !== "--run") {
  console.error("Run explicitly with --run after starting the local app with a local model and web translation enabled. Only synthetic fixture copy is sent. Do not change the provider during this check.");
  process.exit(1);
}
assert.equal(process.platform, "win32", "This check uses the local Windows build");
const executable = fileURLToPath(new URL("../src-tauri/target/release/nude-translator-tauri.exe", import.meta.url));
const { version } = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
await access(executable);
const localModels = new Set(["hymt_1_8b", "hymt_7b", "translategemma_4b"]);
const maxFrame = 1024 * 1024;

function requestNative(payload) {
  return new Promise((resolve, reject) => {
    // Start only our known executable; no registry or native-host registration
    // is altered. Never emit raw status/settings or native stderr.
    const child = spawn(executable, ["--browser-native-host"], {
      windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    const requestId = randomUUID();
    const body = Buffer.from(JSON.stringify({ ...payload, requestId,
      client: { browser: "chrome", extensionVersion: version } }));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    let buffer = Buffer.alloc(0);
    let response;
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { child.kill(); reject(error); }
      else resolve(response);
    };
    const timer = setTimeout(() => finish(new Error("Native host check timed out after 60 seconds")), 60_000);
    child.on("error", () => finish(new Error("Could not launch the local native host")));
    child.stdin.on("error", () => finish(new Error("Native host input closed before request completed")));
    child.stderr.resume();
    child.stdout.on("data", chunk => {
      if (settled) return;
      try {
        buffer = Buffer.concat([buffer, chunk]);
        assert.ok(buffer.length <= maxFrame + 4, "Native response exceeds frame limit");
        if (buffer.length < 4) return;
        const size = buffer.readUInt32LE(0);
        assert.ok(size > 0 && size <= maxFrame, "Invalid native frame length");
        if (buffer.length < size + 4) return;
        assert.equal(buffer.length, size + 4, "Unexpected additional native response");
        response = JSON.parse(buffer.subarray(4).toString("utf8"));
        assert.equal(response.requestId, requestId, "Native response correlation mismatch");
      } catch { finish(new Error("Native response framing or correlation failed")); }
    });
    child.on("close", code => {
      if (code !== 0 || !response) finish(new Error("Native host exited without a complete successful response"));
      else finish();
    });
    child.stdin.end(Buffer.concat([header, body]));
  });
}

const status = await requestNative({ type: "status" });
assert.equal(status.type, "status", `App unavailable or browser disabled: ${status.code ?? "unexpected response"}`);
assert.ok(localModels.has(status.translator), "Select a local translator before running; no provider change is made by this check");
assert.equal(status.modelReady, true, "Wait for the selected local model to become ready");
assert.equal(status.webSettings?.enabled, true, "Web translation is disabled; no setting is changed by this check");
assert.equal(status.webSettings?.messengerPolicyVersion, 4, "Native app must advertise reading policy v4");
const payload = {
  type: "translate", pageId: `messenger:gmail:${randomUUID()}`,
  privateContext: { service: "gmail", consentVersion: 4 },
  targetLanguage: "ko", incognito: true,
  // Match the fixture's subject block and shared body block, not three
  // invented independent paragraphs that make language evidence easier.
  items: MAIL_COPY.map((text, index) => ({ id: `synthetic-mail-${index}`,
    blockId: index === 0 ? "synthetic-subject" : "synthetic-body", text })),
};

const oldConsent = await requestNative({ ...payload, privateContext: { service: "gmail", consentVersion: 3 } });
assert.equal(oldConsent.type, "error");
assert.equal(oldConsent.code, "messenger_consent_required", "Old consent must fail before inference");
const missingConsent = await requestNative({ ...payload, privateContext: undefined });
assert.equal(missingConsent.type, "error");
assert.equal(missingConsent.code, "messenger_consent_required", "Missing private scope must fail before inference");
const invalidContext = await requestNative({ ...payload, pageId: "messenger:gmail:https://example.invalid/private-message" });
assert.equal(invalidContext.type, "error");
assert.equal(invalidContext.code, "messenger_invalid_context", "Mail URL must not be accepted as the opaque page ID");

for (let pass = 1; pass <= 2; pass += 1) {
  const result = await requestNative(payload);
  assert.equal(result.type, "translationResult", `Translation failed: ${result.code ?? "unexpected response"}`);
  assert.equal(result.translator, status.translator, "Provider changed while the live check was running");
  assert.equal(result.items.length, MAIL_COPY.length);
  console.log(JSON.stringify({ pass, syntheticResults: result.items }));
  for (const [index, item] of result.items.entries()) {
    assert.equal(item.id, payload.items[index].id, "Item identity changed");
    assert.ok(typeof item.text === "string" && /[가-힣]/u.test(item.text), "Synthetic result must contain Korean text");
    assert.notEqual(item.text.trim(), MAIL_COPY[index], "Source text is not a translation");
    assert.equal(item.cacheable, true, "Partial/source fallback must not pass as a completed translation");
  }
  console.log(`Synthetic Gmail native round trip ${pass}: ${result.items.length} completed Korean results`);
}
console.log(JSON.stringify({ appVersion: status.appVersion, extensionVersion: version,
  translator: status.translator, readingPolicy: 4, rejected: ["old-consent", "missing-consent", "non-opaque-context"],
  syntheticNativeRoundTrips: 2, itemsPerRoundTrip: MAIL_COPY.length, ephemeral: true,
  actualMailAccessed: false, browserDomIntegrationTested: false }));
