import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

// Exercise the production HTML, CSS and app.js, with only the Tauri boundary mocked.
// No live credentials, provider authentication or external network requests are used.
test.beforeEach(async ({ page }) => {
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://settings.test") return route.abort();
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (file.includes("..")) return route.abort();
    try {
      const body = await readFile(new URL(`../${file}`, import.meta.url));
      const type = file.endsWith(".html") ? "text/html" : file.endsWith(".css") ? "text/css" : /\.m?js$/.test(file) ? "text/javascript" : file.endsWith(".svg") ? "image/svg+xml" : "image/png";
      await route.fulfill({ contentType: type, body });
    } catch { await route.fulfill({ status: 404 }); }
  });
  await page.addInitScript(() => {
    window.testCalls = [];
    window.testEvents = {};
    window.testConfig = { ui_language: "ko", ui_theme: "dark", outgoing_translator: "openai_compat" };
    const providers = ["chatgpt", "claude", "gemini", "deepl", "openai_compat"].map(id => ({
      id, name: id, installed: true, connected: id === "deepl", canDisconnect: id === "deepl",
      state: id === "deepl" ? "connected" : "not-connected",
      detail: id === "deepl" ? "API 키가 운영체제 보안 저장소에 저장되어 있습니다." : "연결 정보를 확인하십시오.",
    }));
    window.__TAURI__ = {
      core: { invoke: async (command, payload) => {
        window.testCalls.push({ command, payload });
        if (command === "settings_get") return window.testConfig;
        if (command === "provider_connections_get") return providers;
        if (command === "autostart_get") return false;
        if (command === "storage_status_get") return { models: [], cache: {} };
        if (command === "runtime_status") return { discordConnected: false };
        if (command === "provider_openai_compat_connect") {
          if (window.testDelayConnection) await new Promise(resolve => { window.testFinishConnection = resolve; });
          if (window.testFailConnection) throw new Error("테스트 연결 실패");
          Object.assign(window.testConfig, { openai_compat_base_url: payload.baseUrl, openai_compat_model: payload.model });
          const connection = providers.find(p => p.id === "openai_compat");
          Object.assign(connection, { connected: true, canDisconnect: true, state: "connected" });
          return connection;
        }
        return null;
      } },
      event: { listen: async (name, callback) => { window.testEvents[name] = callback; return () => {}; } },
      app: { getVersion: async () => "0.7.7-beta" },
    };
  });
  await page.goto("http://settings.test/");
  await expect(page.locator('[data-provider="deepl"] .provider-status')).toHaveAttribute("data-state", "connected");
  await page.locator('[data-settings-panel="engine"]').click();
});

test("keyboard accordion preserves drafts and advanced options across status refreshes", async ({ page }) => {
  const summaries = page.locator(".provider-summary");
  await expect(page.locator(".provider-panel:visible")).toHaveCount(0);
  await page.locator("#provider-openai_compat-summary").focus();
  await page.keyboard.press("Enter");
  await page.locator("#openai-compat-model").fill("draft-model");
  await page.locator("#openai-compat-key").fill("test-draft-only");
  await page.locator(".provider-advanced summary").focus();
  await page.keyboard.press("Space");
  await page.locator("#openai-compat-concurrency").fill("7");
  await page.locator("#provider-openai_compat-summary").click();
  await expect(page.locator(".provider-panel:visible")).toHaveCount(0);
  await page.evaluate(() => window.testEvents["provider-connections-changed"]({}));
  await expect(page.locator("#provider-openai_compat-summary")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('[data-provider="deepl"] .provider-disconnect')).toBeVisible();
  await expect(page.locator('[data-provider="deepl"] .provider-secret')).toBeVisible();
  for (const provider of ["chatgpt", "claude", "gemini"]) {
    await expect(page.locator(`[data-provider="${provider}"] .provider-action`)).toBeVisible();
  }
  await summaries.last().focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#openai-compat-key")).toHaveValue("test-draft-only");
  await expect(page.locator("#openai-compat-model")).toHaveValue("draft-model");
  await expect(page.locator("#openai-compat-concurrency")).toHaveValue("7");
  await page.locator("#provider-openai_compat-summary").click();
  await expect(page.locator(".provider-panel:visible")).toHaveCount(0);
});

test("service guidance reveals setup and failed connections reopen the intact draft", async ({ page }) => {
  await page.locator("#outgoing-model-guidance-action").click();
  await expect(page.locator("#provider-openai_compat-summary")).toHaveAttribute("aria-expanded", "true");
  await page.locator("#openai-compat-base-url").fill("https://example.invalid/v1");
  await page.locator("#openai-compat-model").fill("test-model");
  await page.locator("#openai-compat-key").fill("test-draft-only");
  await page.evaluate(() => { window.testDelayConnection = true; window.testFailConnection = true; });
  await page.locator("#openai-compat-connect").click();
  await expect.poll(() => page.evaluate(() => Boolean(window.testFinishConnection))).toBe(true);
  await page.locator("#provider-openai_compat-summary").click();
  await page.evaluate(() => window.testFinishConnection());
  await expect(page.locator("#modal-layer")).toBeVisible();
  await page.locator("#modal-accept").click();
  await expect(page.locator("#provider-openai_compat-summary")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#openai-compat-key")).toHaveValue("test-draft-only");
  await page.evaluate(() => { window.testDelayConnection = false; window.testFailConnection = false; });
  await page.locator("#openai-compat-connect").click();
  await expect(page.locator('[data-provider="openai_compat"] .provider-status')).toHaveAttribute("data-state", "connected");
  await expect(page.locator("#openai-compat-key")).toHaveValue("");
  await page.locator("#provider-openai_compat-summary").click();
  await expect(page.locator('[data-provider="openai_compat"] .provider-disconnect')).toBeVisible();
});

test("disclosure arrow remains geometrically centered when opened, closed and scaled", async ({ page }) => {
  const button = page.locator("#provider-openai_compat-summary");
  for (const zoom of [1, 1.25, 1.5, 2]) {
    await page.evaluate(zoom => { document.documentElement.style.zoom = zoom; }, zoom);
    for (const expanded of [false, true]) {
      if ((await button.getAttribute("aria-expanded")) !== String(expanded)) await button.click();
      const delta = await button.evaluate(button => {
        const bounds = button.getBoundingClientRect();
        const arrow = button.querySelector(".provider-chevron");
        const box = arrow.getBoundingClientRect();
        const shape = arrow.querySelector("path")?.getBoundingClientRect() || box;
        const center = rect => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
        const target = center(bounds);
        return [box, shape].map(rect => ({ x: Math.abs(center(rect).x - target.x), y: Math.abs(center(rect).y - target.y) }));
      });
      for (const offset of delta) {
        expect(offset.x).toBeLessThan(0.1);
        expect(offset.y).toBeLessThan(0.1);
      }
    }
  }
});

for (const theme of ["dark", "light"]) {
  test(`${theme} provider layouts fit narrow screens and preserve localized labels`, async ({ page }, testInfo) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.locator("#provider-openai_compat-summary").click();
    await page.locator(".provider-advanced summary").click();
    for (const width of [1100, 760, 420, 320]) {
      await page.setViewportSize({ width, height: 1100 });
      const overflow = await page.locator("#provider-connections").evaluate(root => {
        const bounds = root.getBoundingClientRect();
        return [...root.querySelectorAll("button,input,.provider-name,.provider-status,.provider-detail")].filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && (rect.right > bounds.right + 1 || rect.left < bounds.left - 1);
        }).map(el => el.id || el.className);
      });
      expect(overflow).toEqual([]);
    }
    await page.setViewportSize({ width: 1100, height: 1300 });
    await page.locator(".provider-advanced summary").click();
    await page.locator("#provider-connections").screenshot({ path: testInfo.outputPath(`${theme}-providers.png`) });
    await page.evaluate(() => {
      window.testConfig.ui_language = "de";
      window.testEvents["settings-changed"]({ payload: window.testConfig });
    });
    await expect(page.locator(".provider-advanced summary")).toContainText("Erweiterte Einstellungen");
    await page.setViewportSize({ width: 420, height: 1100 });
    for (const language of ["de", "ar"]) {
      await page.evaluate(language => {
        window.testConfig.ui_language = language;
        window.testEvents["settings-changed"]({ payload: window.testConfig });
      }, language);
      const fits = await page.locator(".provider-list").evaluate(root => {
        const bounds = root.getBoundingClientRect();
        return [...root.querySelectorAll(".provider-name,.provider-status,.provider-use-badge")].every(el => {
          const rect = el.getBoundingClientRect();
          return !rect.width || (rect.left >= bounds.left && rect.right <= bounds.right);
        });
      });
      expect(fits).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}
