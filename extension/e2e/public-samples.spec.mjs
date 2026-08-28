import { test, expect } from "./harness.mjs";
import { writeFile } from "node:fs/promises";

// This explicit corpus is input data for testing, never production selectors or
// runtime exceptions. Add a diverse public page here, not a private/login page.
const samples = [
  { id: "news-home", url: "https://news.yahoo.co.jp/", assetHosts: ["news.yahoo.co.jp", "s.yimg.jp"] },
  { id: "news-article", url: "https://news.yahoo.co.jp/articles/6c2cc346b98f48095e2640e35b34269890c6a236", assetHosts: ["news.yahoo.co.jp", "s.yimg.jp"] },
  { id: "technical-document", url: "https://developer.mozilla.org/ja/docs/Web/HTML", assetHosts: ["developer.mozilla.org"] },
  { id: "public-discussion", url: "https://news.ycombinator.com/", assetHosts: ["news.ycombinator.com"] },
  { id: "language-portal", url: "https://www.wikipedia.org/", assetHosts: ["www.wikipedia.org", "www.wikimedia.org", "upload.wikimedia.org"] },
  { id: "demo-catalogue", url: "https://books.toscrape.com/", assetHosts: ["books.toscrape.com"] },
];

if (process.env.NUDENYANG_PUBLIC_CHECK === "1") for (const sample of samples) {
  test(`공개 페이지 표본: ${sample.id}`, async ({ extension }, testInfo) => {
    test.setTimeout(90_000);
    const reports = [];
    const p = await extension.open({ html: "", url: sample.url, publicSample: sample });
    try {
      for (const fraction of [0, 0.33, 0.66, 1]) {
        await p.page.evaluate(fraction => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * fraction), fraction);
        let latest;
        try {
          await expect.poll(async () => {
            latest = await p.message({ type: "nudenyang-audit" });
            const pending = ["queued", "requesting", "response_received", "not_queued"].reduce((n, key) => n + (latest.counts?.[key] ?? 0), 0);
            return latest.status !== "cancelled" && pending === 0;
          }, { timeout: 20_000 }).toBe(true);
        } finally { reports.push({ fraction, ...latest }); }
      }
      expect(reports.some(report => report.candidates > 0), "No readable public DOM: blocked, unavailable, or changed sample").toBe(true);
      expect(reports.every(report => report.status === "complete"), "A partial scan is not a complete check").toBe(true);
      expect(reports.flatMap(report => report.suspects)).toEqual([]);
    } finally {
      const output = testInfo.outputPath("coverage.json");
      await writeFile(output, JSON.stringify({ sample: sample.id, mode: "public-get-only-native-stub", reports }, null, 2));
      await testInfo.attach(`coverage-${sample.id}`, { path: output, contentType: "application/json" });
    }
  });
}
