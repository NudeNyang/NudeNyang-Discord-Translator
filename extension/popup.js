const api = globalThis.chrome ?? globalThis.browser ?? globalThis.whale;
const { isQuickToggleShortcut } = globalThis.NudeNyangContentHelpers;
const popupLocales = globalThis.NudeNyangPopupLocales;
const FALLBACK_COMMAND_SHORTCUT = "Ctrl+Shift+L";
const enabled = document.querySelector("#enabled");
const site = document.querySelector("#site");
const connection = document.querySelector("#connection");
const connectionText = document.querySelector("#connection-text");
const detail = document.querySelector("#detail");
const commandShortcut = document.querySelector("#command-shortcut");
const quickToggleShortcutElement = document.querySelector("#quick-toggle-shortcut");
const restore = document.querySelector("#restore");
const targetLanguage = document.querySelector("#target-language");
const targetLanguageTrigger = document.querySelector("#target-language-trigger");
const targetLanguageLabel = document.querySelector("#target-language-label");
const targetLanguageMenu = document.querySelector("#target-language-menu");
const targetLanguageSearch = document.querySelector("#target-language-search");
const targetLanguageOptions = document.querySelector("#target-language-options");
const targetLanguageEmpty = document.querySelector("#target-language-empty");
const alwaysTranslateSite = document.querySelector("#always-translate-site");
const usage = document.querySelector("#usage");
const openSettings = document.querySelector("#open-settings");
const LANGUAGE_OPTIONS = [
  ["ko", "한국어"], ["en", "English"], ["ja", "日本語"], ["zh", "简体中文"],
  ["zh-Hant", "繁體中文"], ["pt-BR", "Português (Brasil)"], ["hi", "हिन्दी"],
  ["es-419", "Español (Latinoamérica)"], ["de", "Deutsch"], ["ru", "Русский"],
  ["id", "Bahasa Indonesia"], ["fr", "Français"], ["tr", "Türkçe"], ["ar", "العربية"],
  ["vi", "Tiếng Việt"], ["it", "Italiano"], ["pl", "Polski"], ["uk", "Українська"],
  ["ms", "Bahasa Melayu"], ["nl", "Nederlands"], ["th", "ไทย"], ["fil", "Filipino"],
  ["bn", "বাংলা"], ["ur", "اردو"], ["ta", "தமிழ்"], ["fa", "فارسی"], ["he", "עברית"], ["cs", "Čeština"],
];
let appStatus = null;
let quickToggleShortcut = "F4";
let targetLanguageValue = "";
let uiLanguage = popupLocales.resolve(
  "auto",
  api.i18n?.getUILanguage?.() || globalThis.navigator?.language,
);

function copy(id) {
  return popupLocales.message(uiLanguage, id);
}

function formatNumber(value) {
  return Number(value ?? 0).toLocaleString(uiLanguage);
}

function applyUiLanguage(language) {
  uiLanguage = popupLocales.resolve(language || uiLanguage);
  document.documentElement.lang = uiLanguage;
  document.documentElement.dir = ["ar", "ur", "fa", "he"].includes(uiLanguage) ? "rtl" : "ltr";
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = copy(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
    element.placeholder = copy(element.dataset.i18nPlaceholder);
  }
  for (const element of document.querySelectorAll("[data-i18n-aria-label]")) {
    element.setAttribute("aria-label", copy(element.dataset.i18nAriaLabel));
  }
}

function normalizeLanguageSearch(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

function targetLanguageEntries() {
  return [["", copy("defaultTranslationLanguage")], ...LANGUAGE_OPTIONS];
}

function setTargetLanguageValue(value) {
  targetLanguageValue = LANGUAGE_OPTIONS.some(([code]) => code === value) ? value : "";
  targetLanguageLabel.textContent = targetLanguageEntries().find(([code]) => code === targetLanguageValue)?.[1]
    ?? copy("defaultTranslationLanguage");
  for (const option of targetLanguageOptions.querySelectorAll(".language-option")) {
    option.setAttribute("aria-selected", String(option.dataset.value === targetLanguageValue));
  }
}

function renderTargetLanguageOptions(query = "") {
  const needle = normalizeLanguageSearch(query);
  targetLanguageOptions.replaceChildren();
  let visible = 0;
  for (const [value, label] of targetLanguageEntries()) {
    if (needle && !normalizeLanguageSearch(`${label} ${value}`).includes(needle)) continue;
    const option = document.createElement("button");
    option.type = "button";
    option.className = "language-option";
    option.dataset.value = value;
    option.dataset.rtl = String(["ar", "ur", "fa", "he"].includes(value));
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(value === targetLanguageValue));
    option.textContent = label;
    targetLanguageOptions.append(option);
    visible += 1;
  }
  targetLanguageEmpty.hidden = visible > 0;
}

function closeTargetLanguageMenu() {
  targetLanguage.classList.remove("open");
  targetLanguageTrigger.setAttribute("aria-expanded", "false");
  targetLanguageMenu.hidden = true;
}

function openTargetLanguageMenu() {
  if (targetLanguageTrigger.disabled) return;
  targetLanguage.classList.add("open");
  targetLanguageTrigger.setAttribute("aria-expanded", "true");
  targetLanguageMenu.hidden = false;
  targetLanguageSearch.value = "";
  renderTargetLanguageOptions();
  requestAnimationFrame(() => targetLanguageSearch.focus());
}

function queryTabs(query) {
  return new Promise((resolve) => api.tabs.query(query, resolve));
}

async function activeTab() {
  const [lastFocused] = await queryTabs({ active: true, lastFocusedWindow: true });
  if (lastFocused) return lastFocused;
  const [current] = await queryTabs({ active: true, currentWindow: true });
  return current;
}

function tabMessage(tabId, message) {
  return new Promise((resolve) => api.runtime.sendMessage({
    type: "nudenyang-page-request",
    tabId,
    message,
  }, (response) => {
    if (api.runtime.lastError) resolve(null);
    else resolve(response ?? null);
  }));
}

function nativeRequest(request) {
  return new Promise((resolve) => api.runtime.sendMessage({ type: "nudenyang-native-request", request }, resolve));
}

function extensionCommands() {
  return new Promise((resolve) => {
    if (!api.commands?.getAll) {
      resolve([]);
      return;
    }
    api.commands.getAll((commands) => {
      void api.runtime.lastError;
      resolve(commands ?? []);
    });
  });
}

function renderCommandShortcut(commands) {
  const assignedShortcut = commands.find((command) => command.name === "toggle-page-translation")?.shortcut ?? "";
  const shortcut = assignedShortcut || FALLBACK_COMMAND_SHORTCUT;
  commandShortcut.textContent = shortcut.replaceAll("+", " + ");
  commandShortcut.classList.toggle("unassigned", !assignedShortcut);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function pageStatus(tabId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await tabMessage(tabId, { type: "nudenyang-status" });
    if (response) return response;
    await wait(120);
  }
  return null;
}

function renderPageStatus(status) {
  enabled.checked = status?.enabled ?? false;
  enabled.disabled = !status?.supported;
  restore.disabled = !status?.supported;
  if (!status) {
    site.textContent = copy("unableToProcess");
  } else if (status.supported && status.manualOnly && !status.enabled) {
    site.textContent = quickToggleShortcut
      ? `${copy("manualStart")} · ${quickToggleShortcut}`
      : copy("manualStart");
  } else if (status.supported) {
    site.textContent = `${status.site.toUpperCase()} · ${copy("translation")} ${formatNumber(status.translatedNodes)}`;
  } else {
    site.textContent = copy("unableToProcess");
  }
  if (status?.lastError) detail.textContent = copy("error");
  usage.textContent = `${copy("translation")} ${formatNumber(status?.requestCount)} · ${copy("send")} ${formatNumber(status?.sentChars)}`;
  if (status?.usageLimit) usage.textContent += ` · ${copy("pageLimit")} ${formatNumber(status.usageLimit)}`;
  usage.classList.toggle("warning", Boolean(status?.usageLimited));
  setTargetLanguageValue(status?.targetLanguage && status.targetLanguage !== "display"
    ? status.targetLanguage
    : "");
  alwaysTranslateSite.checked = status?.sitePolicy === "always";
  alwaysTranslateSite.disabled = !status?.supported;
  targetLanguageTrigger.disabled = !status?.supported;
  if (targetLanguageTrigger.disabled) closeTargetLanguageMenu();
}

function renderConnection(response) {
  connection.className = "connection";
  const appConnected = response?.appConnected ?? response?.type === "status";
  if (response?.type === "status" && appConnected) {
    appStatus = response;
    const modelReady = response.modelReady ?? response.ready;
    connection.classList.add(modelReady ? "ready" : "waiting");
    connectionText.textContent = modelReady ? copy("connected") : copy("preparing");
    detail.textContent = `${response.translator} · ${response.targetLanguage.toUpperCase()} · ${copy("translation")}`;
  } else {
    connection.classList.add("error");
    connectionText.textContent = copy("connectionRequired");
    detail.textContent = copy("error");
  }
}

async function initialize() {
  applyUiLanguage(uiLanguage);
  renderTargetLanguageOptions();
  const commandsPromise = extensionCommands();
  const tab = await activeTab();
  let status = tab?.id ? await pageStatus(tab.id) : null;
  const nativeStatus = await nativeRequest({ type: "status", requestId: `popup-${Date.now()}` });
  if (nativeStatus?.type === "status") {
    applyUiLanguage(nativeStatus.resolvedUiLanguage || nativeStatus.uiLanguage);
    renderTargetLanguageOptions();
    quickToggleShortcut = nativeStatus.webSettings?.quickToggleShortcut ?? "F4";
    quickToggleShortcutElement.textContent = quickToggleShortcut || "-";
  }
  renderPageStatus(status);
  renderConnection(nativeStatus);
  renderCommandShortcut(await commandsPromise);

  async function handleQuickToggle(event) {
    if (!isQuickToggleShortcut(event, quickToggleShortcut)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!tab?.id) return;
    const updated = await tabMessage(tab.id, { type: "nudenyang-toggle-enabled" });
    if (updated) {
      status = updated;
      renderPageStatus(status);
    } else {
      site.textContent = copy("unableToProcess");
    }
  }

  document.addEventListener("keydown", handleQuickToggle, true);

  enabled.addEventListener("change", async () => {
    if (!tab?.id) return;
    const previous = status?.enabled ?? false;
    const updated = await tabMessage(tab.id, { type: "nudenyang-set-enabled", enabled: enabled.checked });
    if (updated) {
      status = updated;
      renderPageStatus(status);
    } else {
      enabled.checked = previous;
      site.textContent = copy("unableToProcess");
    }
  });
  restore.addEventListener("click", async () => {
    if (tab?.id) {
      const updated = await tabMessage(tab.id, { type: "nudenyang-restore" });
      if (updated) {
        status = updated;
        renderPageStatus(status);
        site.textContent = `${status.site.toUpperCase()} · ${copy("original")}`;
      } else {
        site.textContent = copy("unableToProcess");
      }
    }
  });
  targetLanguageTrigger.addEventListener("click", () => {
    if (targetLanguage.classList.contains("open")) closeTargetLanguageMenu();
    else openTargetLanguageMenu();
  });
  targetLanguageSearch.addEventListener("input", () => renderTargetLanguageOptions(targetLanguageSearch.value));
  targetLanguageSearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeTargetLanguageMenu();
      targetLanguageTrigger.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      targetLanguageOptions.querySelector(".language-option")?.focus();
    }
  });
  targetLanguageOptions.addEventListener("click", async (event) => {
    const option = event.target.closest(".language-option");
    if (!option || !tab?.id) return;
    const previous = targetLanguageValue;
    setTargetLanguageValue(option.dataset.value);
    closeTargetLanguageMenu();
    if (!tab?.id) return;
    const updated = await tabMessage(tab.id, {
      type: "nudenyang-set-target-language",
      targetLanguage: targetLanguageValue,
    });
    if (updated) {
      status = updated;
      renderPageStatus(status);
    } else {
      setTargetLanguageValue(previous);
      site.textContent = copy("unableToProcess");
    }
  });
  document.addEventListener("click", (event) => {
    if (!targetLanguage.contains(event.target)) closeTargetLanguageMenu();
  });
  alwaysTranslateSite.addEventListener("change", async () => {
    if (!tab?.id || !tab.url || !appStatus?.webSettings) return;
    const hostname = new URL(tab.url).hostname.toLowerCase().replace(/^www\./, "");
    const sitePolicies = { ...(appStatus.webSettings.sitePolicies ?? {}) };
    if (alwaysTranslateSite.checked) sitePolicies[hostname] = "always";
    else delete sitePolicies[hostname];
    const response = await nativeRequest({
      type: "webSettingsUpdate",
      requestId: `site-${Date.now()}`,
      patch: { web_site_policies: sitePolicies },
    });
    if (response?.type !== "webSettings") {
      alwaysTranslateSite.checked = status?.sitePolicy === "always";
      detail.textContent = copy("error");
      return;
    }
    appStatus.webSettings = response.webSettings;
    const updated = await tabMessage(tab.id, {
      type: "nudenyang-apply-web-settings",
      webSettings: response.webSettings,
    });
    if (updated) {
      status = updated;
      if (alwaysTranslateSite.checked && !status.enabled) {
        status = await tabMessage(tab.id, { type: "nudenyang-set-enabled", enabled: true }) ?? status;
      }
      renderPageStatus(status);
    }
  });
  openSettings.addEventListener("click", async () => {
    const response = await nativeRequest({ type: "openWebSettings", requestId: `settings-${Date.now()}` });
    if (response?.type === "opened") {
      window.close();
    } else {
      detail.textContent = copy("error");
    }
  });
}

void initialize();
