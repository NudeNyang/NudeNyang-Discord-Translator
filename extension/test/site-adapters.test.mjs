import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import "../site-adapters.js";

const { adapterForLocation, exclusionSelector } = globalThis.NudeNyangSiteAdapters;

test("지원 사이트와 차단 경로를 구분한다", () => {
  assert.equal(adapterForLocation(new URL("https://github.com/NudeNyang/project/issues/1")).id, "github");
  assert.equal(adapterForLocation(new URL("https://booth.pm/ko/items/123")).id, "booth");
  assert.equal(adapterForLocation(new URL("https://nudenyang.booth.pm/items/123")).id, "booth");
  assert.equal(adapterForLocation(new URL("https://www.google.co.kr/search?q=test")).id, "google");
  assert.equal(adapterForLocation(new URL("https://www.youtube.com/watch?v=abc")).id, "youtube");
  assert.equal(adapterForLocation(new URL("https://x.com/home")).id, "x");
  assert.equal(adapterForLocation(new URL("https://x.com/messages")), null);
  assert.equal(adapterForLocation(new URL("https://example.com")), null);
});

test("공통 입력·코드 제외 규칙과 사이트별 개인정보 제외 규칙을 합친다", () => {
  const github = adapterForLocation(new URL("https://github.com/NudeNyang/project"));
  const selector = exclusionSelector(github);
  assert.match(selector, /textarea/);
  assert.match(selector, /pre/);
  assert.match(selector, /\.blob-code/);
});

test("GitHub Markdown 표의 셀도 번역 블록에 포함한다", () => {
  const github = adapterForLocation(new URL("https://github.com/NudeNyang/project"));
  assert.ok(github.blocks.includes(".markdown-body table th"));
  assert.ok(github.blocks.includes(".markdown-body table td"));
});

test("BOOTH Tailwind order 레이아웃 클래스는 주문 영역으로 오인하지 않는다", () => {
  const booth = adapterForLocation(new URL("https://booth.pm/ko/items/123"));
  const selector = exclusionSelector(booth);
  assert.doesNotMatch(selector, /\[class\*='order'\]/);
  assert.match(selector, /form\[action\*='order'\]/);
});

test("manifest 공개 키가 Native Messaging 허용 ID를 안정적으로 만든다", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const publicKey = Buffer.from(manifest.key, "base64");
  const hash = crypto.createHash("sha256").update(publicKey).digest().subarray(0, 16);
  const extensionId = [...hash]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
    .join("");
  assert.equal(extensionId, "bdkkgjjmocmdknffadjgbljmnhdcchjl");
  assert.ok(manifest.permissions.includes("nativeMessaging"));
});
