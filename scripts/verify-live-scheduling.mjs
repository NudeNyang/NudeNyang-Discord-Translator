// Opt-in actual-app check using synthetic text only. Does not access browser
// pages/Discord messages, change settings, or send a Discord message.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

assert.equal(process.argv.slice(2).join(" "), "--run", "Run explicitly with --run and a ready local model");
assert.equal(process.platform, "win32");
const executable = fileURLToPath(new URL("../src-tauri/target/release/nude-translator-tauri.exe", import.meta.url));
const { version } = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));

function requestNative(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--browser-native-host"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const requestId = randomUUID();
    const body = Buffer.from(JSON.stringify({ ...payload, requestId, client: { browser: "chrome", extensionVersion: version } }));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    let buffer = Buffer.alloc(0);
    let settled = false;
    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { child.kill(); reject(error); }
      else resolve(response);
    };
    const timer = setTimeout(() => finish(new Error("Native scheduling check exceeded 180 seconds")), 180_000);
    child.on("error", () => finish(new Error("Could not start the native host")));
    child.stdin.on("error", () => finish(new Error("Native host input closed")));
    child.stderr.resume();
    child.stdout.on("data", chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 1024 * 1024 + 4) finish(new Error("Oversized native response"));
    });
    child.on("close", code => {
      try {
        assert.equal(code, 0);
        assert.ok(buffer.length >= 4);
        assert.equal(buffer.readUInt32LE(0), buffer.length - 4);
        const response = JSON.parse(buffer.subarray(4).toString("utf8"));
        assert.equal(response.requestId, requestId);
        finish(null, response);
      } catch { finish(new Error("Invalid native response framing or exit status")); }
    });
    child.stdin.end(Buffer.concat([header, body]));
  });
}

const status = await requestNative({ type: "status" });
assert.equal(status.type, "status", "Application or browser connection unavailable");
assert.ok(["hymt_1_8b", "hymt_7b", "translategemma_4b"].includes(status.translator), "This test must not use an external provider");
assert.equal(status.modelReady, true);
assert.equal(status.webSettings?.enabled, true);
const sources = [
  "The game is loading, and our team will meet near the main entrance tonight. Please check your microphone before joining the group. We will explore the northern area together and return to the village before midnight.",
  "We finished testing the new update this morning. Most features worked correctly, but voice chat became quiet after changing channels. Open the audio settings, select the correct microphone, and reconnect if necessary.",
  "Before leaving the village, bring enough food and water for everyone. Save your progress after completing each mission. If you arrive late, send the group a message and wait near the bridge until someone comes to meet you.",
  "The next meeting is scheduled for tomorrow evening. We will review the test results and discuss improvements to the application. Please write down any problems you notice while playing, including delays and unexpected errors.",
];
const report = { appVersion: status.appVersion, translator: status.translator, actualPagesRead: false, discordMessagesSent: false, runs: [] };
for (let pass = 1; pass <= 2; pass++) {
  const started = performance.now();
  const result = await requestNative({ type: "translate", pageId: `generic:scheduling-fixture-${randomUUID()}`, targetLanguage: "ko", incognito: true,
    items: sources.map((text, index) => ({ id: `item-${index}`, blockId: `paragraph-${index}`, text })) });
  const seconds = (performance.now() - started) / 1000;
  assert.equal(result.type, "translationResult", `Translation failed: ${result.code ?? "unexpected response"}`);
  assert.equal(result.translator, status.translator);
  assert.equal(result.items.length, sources.length);
  for (const [index, item] of result.items.entries()) {
    assert.equal(item.id, `item-${index}`);
    assert.ok(item.cacheable && item.replayable && /[가-힣]/u.test(item.text), "Incomplete synthetic translation");
  }
  if (pass === 2) assert.deepEqual(result.items, report.runs[0].items, "Synthetic outputs changed between passes");
  report.runs.push({ pass, seconds, items: result.items });
  console.log(JSON.stringify({ pass, seconds, completedItems: result.items.length, outputEqual: pass === 2 ? true : null }));
}
await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/scheduling-live-app.json", import.meta.url), JSON.stringify(report, null, 2));
