import { test as base, expect, chromium } from "@playwright/test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionSource = fileURLToPath(new URL("../", import.meta.url));
const portStub = new URL("native-port-stub.js", import.meta.url);

async function stageExtension(target) {
  await cp(extensionSource, target, {
    recursive: true,
    filter: source => !["test", "e2e"].includes(path.basename(source)),
  });
  const manifest = JSON.parse(await readFile(path.join(target, "manifest.json"), "utf8"));
  const productionWorker = manifest.background.service_worker;
  // Keep the actual content script order and all production background modules.
  // Only the native transport and test control entry point differ from the app.
  manifest.background.service_worker = "e2e-background.js";
  manifest.permissions = manifest.permissions.filter(permission => permission !== "nativeMessaging");
  delete manifest.key;
  delete manifest.update_url;
  await writeFile(path.join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await cp(portStub, path.join(target, "e2e-native-port-stub.js"));
  await writeFile(path.join(target, "e2e-background.js"),
    `importScripts("e2e-native-port-stub.js");\nimportScripts(${JSON.stringify(productionWorker)});\n`);
  await writeFile(path.join(target, "e2e-control.html"), "<!doctype html><title>E2E test controller</title>");
}

function htmlDocument(html) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;
}

function requestKey(value) {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

export const test = base.extend({
  extension: async ({}, use, testInfo) => {
    const root = await mkdtemp(path.join(tmpdir(), "nudenyang-extension-e2e-"));
    const stagedExtension = path.join(root, "extension");
    const profile = path.join(root, "profile");
    let context;
    try {
      await stageExtension(stagedExtension);
      await mkdir(profile);
      context = await chromium.launchPersistentContext(profile, {
        channel: "chromium",
        headless: true,
        viewport: { width: 1280, height: 900 },
        args: [
          `--disable-extensions-except=${stagedExtension}`,
          `--load-extension=${stagedExtension}`,
        ],
      });
      // No fixture makes network contact with a real website. page.route below
      // serves the requested HTML; all other HTTP requests are denied here.
      await context.route(/^https?:\/\//u, route => route.abort("blockedbyclient"));
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      let [worker] = context.serviceWorkers();
      worker ??= await context.waitForEvent("serviceworker");
      const extensionId = new URL(worker.url()).host;
      await expect.poll(() => worker.evaluate(() => Boolean(globalThis.__NudeNyangE2E))).toBe(true);
      const errors = [];
      const pages = [];
      const controller = {
        context, worker, extensionId,
        publicCheck: false,
        command(tabId) {
          return worker.evaluate(id => globalThis.__NudeNyangE2E.dispatchCommand(id), tabId);
        },
        async open({ html, url = "https://fixture.example.test/article/", settings = {}, publicSample = null,
          consent = false, consentVersion = 5, enabled = true, globalConsent = true, deferTranslations = false,
          translator = "hymt_1_8b", documents = {} } = {}) {
          if (typeof html !== "string") throw new TypeError("extension.open requires an HTML fixture string");
          const destination = new URL(url);
          if (!["http:", "https:"].includes(destination.protocol)) throw new Error("E2E fixtures require HTTP(S) URLs");
          await worker.evaluate(async options => {
            globalThis.__NudeNyangE2E.configure(options);
            await chrome.storage.local.set({ enabled: true, messengerConsentVersion: options.consent ? options.consentVersion : 0,
              webTranslationConsentVersion: options.globalConsent ? 2 : 0, webTranslationEnabled: options.enabled === null });
          }, { settings, consent, consentVersion, deferTranslations, translator, globalConsent, enabled });
          const page = await context.newPage();
          if (publicSample) {
            if (process.env.NUDENYANG_PUBLIC_CHECK !== "1" || publicSample.url !== url) throw new Error("Public checks require explicit opt-in and a matching sample URL");
            controller.publicCheck = true;
          }
          pages.push(page);
          page.on("pageerror", error => errors.push(error.message));
          const fixtures = new Map(Object.entries(documents).map(([address, fixture]) => [requestKey(address), fixture]));
          fixtures.set(requestKey(url), html);
          await page.route(/^https?:\/\//u, async route => {
            if (publicSample) {
              const request = route.request();
              const address = new URL(request.url());
              const sameDocument = address.origin === destination.origin && address.pathname === destination.pathname;
              const permittedAsset = ["stylesheet", "script", "image", "font"].includes(request.resourceType())
                && publicSample.assetHosts.includes(address.hostname);
              // Fresh test profile, GET-only public documents/assets. No login,
              // forms, telemetry, API POSTs or native/external translator calls.
              if (address.protocol === "https:" && request.method() === "GET" && (sameDocument || permittedAsset)) return route.continue();
              return route.abort("blockedbyclient");
            }
            const requestUrl = route.request().url();
            const fixture = fixtures.get(requestUrl);
            if (fixture === undefined) return route.abort("blockedbyclient");
            return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: htmlDocument(fixture) });
          });
          await page.goto(`chrome-extension://${extensionId}/e2e-control.html`);
          const tabId = await page.evaluate(() => new Promise(resolve => chrome.tabs.getCurrent(tab => resolve(tab.id))));
          const message = value => worker.evaluate(({ id, value: payload }) => new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(id, payload, { frameId: 0 }, response => {
              const error = chrome.runtime.lastError;
              if (error) reject(new Error(error.message));
              else resolve(response);
            });
          }), { id: tabId, value });
          const navigation = await page.goto(url, { waitUntil: "domcontentloaded" });
          if (publicSample && (!navigation || navigation.status() !== 200)) {
            throw new Error(`Public sample unavailable: HTTP ${navigation?.status() ?? "none"}`);
          }
          await expect.poll(async () => {
            try { return (await message({ type: "nudenyang-ready" }))?.ready; }
            catch { return false; }
          }, { message: "MV3 content script must finish startup through the real runtime message bridge" }).toBe(true);
          if (enabled === true) await message({ type: "nudenyang-set-enabled", enabled: true });
          const requests = () => worker.evaluate(() => globalThis.__NudeNyangE2E.requests().filter(request => request.type === "translate"));
          return {
            page, tabId, extensionId, message,
            status: () => message({ type: "nudenyang-status" }),
            requests,
            sent: async () => (await requests()).flatMap(request => request.items.map(item => item.text)),
            pendingTranslations: () => worker.evaluate(() => globalThis.__NudeNyangE2E.pending()),
            releaseTranslations: options => worker.evaluate(value => globalThis.__NudeNyangE2E.releaseTranslations(value), options),
            setConsent: granted => worker.evaluate(async value => {
              await chrome.storage.local.set({ messengerConsentVersion: value ? 5 : 0 });
            }, granted),
          };
        },
      };
      await use(controller);
      if (controller.publicCheck) {
        // Real public HTML is not a redistributable fixture. Never persist raw
        // text, screenshots, native payloads or traces from these checks.
        await context.tracing.stop();
      } else if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("native-requests", {
          body: JSON.stringify(await worker.evaluate(() => globalThis.__NudeNyangE2E.requests()), null, 2),
          contentType: "application/json",
        });
        for (const [index, page] of pages.entries()) if (!page.isClosed()) {
          await testInfo.attach(`page-${index}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
        }
        const trace = testInfo.outputPath("trace.zip");
        await context.tracing.stop({ path: trace });
        await testInfo.attach("trace", { path: trace, contentType: "application/zip" });
      } else {
        await context.tracing.stop();
        expect(errors, "Uncaught JavaScript errors in real fixture pages").toEqual([]);
      }
    } finally {
      await context?.close();
      // root is the exact mkdtemp result, never a computed workspace or user
      // browser path. Safety check precedes recursive cleanup on Windows.
      const absoluteRoot = path.resolve(root);
      const temporaryParent = path.resolve(tmpdir());
      if (path.dirname(absoluteRoot) !== temporaryParent || !path.basename(absoluteRoot).startsWith("nudenyang-extension-e2e-")) {
        throw new Error(`Refusing to remove an unexpected E2E directory: ${absoluteRoot}`);
      }
      await rm(absoluteRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  },
});

export { expect };
