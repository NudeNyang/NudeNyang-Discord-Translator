// Runs only in the bundled download page opened explicitly by the user.
const locales = globalThis.NudeNyangPopupLocales;
const { FEED_URL, RELEASES_URL, parseRelease } = globalThis.NudeNyangDownloadFeed;
const language = locales.resolve(new URL(location.href).searchParams.get("lang") || "auto", navigator.language);
const copy = key => locales.message(language, key);
document.documentElement.lang = language;
document.documentElement.dir = ["ar", "ur", "fa", "he"].includes(language) ? "rtl" : "ltr";
for (const element of document.querySelectorAll("[data-i18n]")) element.textContent = copy(element.dataset.i18n);
const get = id => document.getElementById(id);
let activeRequest;
async function loadDownloads() {
  if (activeRequest) return;
  const controller = new AbortController();
  activeRequest = controller;
  const timeout = setTimeout(() => controller.abort(), 10000);
  get("download-status").textContent = copy("checking");
  get("download-status").hidden = false;
  get("download-retry").hidden = true;
  get("download-options").hidden = true;
  get("download-x64").removeAttribute("href");
  get("download-arm64").removeAttribute("href");
  get("release-page").href = RELEASES_URL;
  try {
    const response = await fetch(FEED_URL, {
      signal: controller.signal, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
      redirect: "error",
    });
    if (!response.ok) throw new Error("Release list unavailable");
    const release = parseRelease(await response.json());
    get("release-version").textContent = release.version;
    get("download-x64").href = release.x64;
    get("download-arm64").href = release.arm64;
    get("release-page").href = release.page;
    get("download-status").hidden = true;
    get("download-options").hidden = false;
  } catch {
    get("download-status").textContent = copy("downloadUnavailable");
    get("download-retry").hidden = false;
  } finally {
    clearTimeout(timeout);
    activeRequest = null;
  }
}
get("download-retry").addEventListener("click", () => { void loadDownloads(); });
window.addEventListener("pagehide", () => activeRequest?.abort(), { once: true });
void loadDownloads();
