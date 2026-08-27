import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
await import("../download-feed.js");
const { parseRelease, FEED_URL, RELEASES_URL } = globalThis.NudeNyangDownloadFeed;
function feed(version = "0.8.1-beta") {
  return { version, platforms: Object.fromEntries([["windows-x86_64", "x64"], ["windows-aarch64", "ARM64"]].map(([key, arch]) => [key, {
    url: `${RELEASES_URL}/download/v${version}/NudeNyang-Translator-${version}-${arch}-Setup.exe`,
    signature: "test-signature", sha256: "a".repeat(64),
  }])) };
}
test("고정된 공개 업데이트 주소에서 프리릴리스와 두 설치형을 읽고 특정 버전에 고정하지 않는다", () => {
  assert.equal(FEED_URL, "https://raw.githubusercontent.com/NudeNyang/NudeNyang-Discord-Translator/main/updates/beta/latest.json");
  for (const version of ["0.7.3-beta", "0.8.1-beta", "1.0.0"]) {
    const release = parseRelease(feed(version));
    assert.equal(release.version, version);
    assert.match(release.x64, /-x64-Setup\.exe$/);
    assert.match(release.arm64, /-ARM64-Setup\.exe$/);
  }
});
test("한 아키텍처 누락·외부 URL·다른 저장소·버전 불일치·서명 누락은 다운로드에 사용하지 않는다", () => {
  for (const mutate of [
    f => { delete f.platforms["windows-aarch64"]; },
    f => { f.platforms["windows-x86_64"].url = "https://evil.invalid/setup.exe"; },
    f => { f.platforms["windows-x86_64"].url += "?redirect=evil"; },
    f => { f.platforms["windows-x86_64"].url = f.platforms["windows-x86_64"].url.replace("NudeNyang/NudeNyang", "another/NudeNyang"); },
    f => { f.version = "0.9.0"; },
    f => { f.version = "<img src=x>"; },
    f => { f.platforms["windows-x86_64"].signature = ""; },
    f => { f.platforms["windows-x86_64"].sha256 = "bad"; },
  ]) {
    const value = feed(); mutate(value);
    assert.throws(() => parseRelease(value));
  }
});
const flush = () => new Promise(resolve => setImmediate(resolve));
async function page(response) {
  const dom = new JSDOM(fs.readFileSync(new URL("../download.html", import.meta.url), "utf8"), {
    url: "https://extension.invalid/download.html?lang=ko", runScripts: "outside-only",
  });
  const requests = [];
  dom.window.fetch = async (...args) => { requests.push(args); if (response instanceof Error) throw response; return response; };
  for (const file of ["popup-locales.js", "download-feed.js", "download.js"]) {
    dom.window.eval(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
  }
  await flush();
  return { dom, requests, get: id => dom.window.document.getElementById(id) };
}
test("다운로드 안내만 공개 목록을 조회하고 쿠키·리퍼러 없이 최신 링크를 표시한다", async () => {
  const p = await page({ ok: true, json: async () => feed() });
  try {
    assert.equal(p.requests.length, 1);
    assert.equal(p.requests[0][0], FEED_URL);
    assert.equal(p.requests[0][1].credentials, "omit");
    assert.equal(p.requests[0][1].referrerPolicy, "no-referrer");
    assert.equal(p.requests[0][1].cache, "no-store");
    assert.equal(p.get("download-options").hidden, false);
    assert.equal(p.get("release-version").textContent, "0.8.1-beta");
    assert.match(p.get("download-x64").href, /0\.8\.1-beta-x64-Setup\.exe$/);
    assert.equal(p.get("download-retry").hidden, true);
  } finally { p.dom.window.close(); }
});
test("조회 실패·잘못된 목록에서는 오래된 설치 링크를 내놓지 않고 GitHub와 재시도를 제공한다", async () => {
  for (const response of [new Error("offline"), { ok: false }, { ok: true, json: async () => ({}) }]) {
    const p = await page(response);
    try {
      assert.equal(p.get("download-options").hidden, true);
      assert.equal(p.get("download-x64").hasAttribute("href"), false);
      assert.equal(p.get("release-page").href, RELEASES_URL);
      assert.equal(p.get("download-retry").hidden, false);
    } finally { p.dom.window.close(); }
  }
});
