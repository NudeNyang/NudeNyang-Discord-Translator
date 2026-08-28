const api = globalThis.chrome ?? globalThis.browser ?? globalThis.whale;
const { isQuickToggleShortcut } = globalThis.NudeNyangContentHelpers;
const popupLocales = globalThis.NudeNyangPopupLocales;
const FALLBACK_COMMAND_SHORTCUT = "Ctrl+Shift+L";
const enabled = document.querySelector("#enabled");
const site = document.querySelector("#site");
const connection = document.querySelector("#connection");
const connectionText = document.querySelector("#connection-text");
const detail = document.querySelector("#detail");
const messengerPanel = document.querySelector("#messenger-panel");
const messengerTitle = document.querySelector("#messenger-title");
const messengerNotice = document.querySelector("#messenger-notice");
const messengerConsentStart = document.querySelector("#messenger-consent-start");
const messengerPrivacy = document.querySelector("#messenger-privacy");
const commandShortcut = document.querySelector("#command-shortcut");
const quickToggleShortcutElement = document.querySelector("#quick-toggle-shortcut");
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
let browserConnectionDisabled = false;
let connectionAvailable = false;
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
  messengerPrivacy.title = copy("messengerPrivacyConsent");
  messengerPrivacy.setAttribute("aria-label", `${copy("reviewMessengerPrivacy")} · ${copy("messengerPrivacyConsent")}`);
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
  const messengerGate = status?.messengerService ? status.messengerGate : "";
  const needsConsent = connectionAvailable && !browserConnectionDisabled && messengerGate === "messenger_consent_required";
  enabled.checked = !browserConnectionDisabled && (status?.enabled ?? false);
  // Losing the engine must not prevent an already translated page going OFF.
  enabled.disabled = (!connectionAvailable && !status?.enabled) || browserConnectionDisabled || !status?.supported || Boolean(messengerGate);
  messengerPanel.hidden = !connectionAvailable || browserConnectionDisabled || !status?.messengerService;
  messengerPanel.classList.toggle("consent-required", needsConsent);
  messengerTitle.hidden = !needsConsent;
  messengerNotice.hidden = messengerPanel.hidden;
  const messengerCopy = {
    messenger_consent_required: "messengerConsentRequired",
    messenger_update_required: "messengerUpdateRequired",
    private_browsing_provider_unsupported: "privateBrowsingProviderUnsupported",
    messenger_no_conversation: "messengerNoConversation",
    messenger_request_cancelled: "messengerWaiting",
    messenger_invalid_context: "unableToProcess",
  };
  messengerNotice.textContent = messengerGate === "web_translation_disabled"
    ? `${copy("enableWebTranslation")} · ${copy("settings")}`
    : copy(messengerCopy[messengerGate] ?? (messengerGate ? "unableToProcess" : "messengerReadTranslation"));
  messengerPrivacy.hidden = needsConsent || status?.privacyPage === true;
  messengerConsentStart.hidden = !needsConsent;
  messengerConsentStart.textContent = copy("reviewMessengerPrivacy");
  if (browserConnectionDisabled) {
    site.textContent = copy("disabled");
  } else if (status?.privacyPage) {
    site.textContent = copy("messengerPrivacyTitle");
  } else if (!status) {
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
  alwaysTranslateSite.disabled = !connectionAvailable || browserConnectionDisabled || !status?.supported || Boolean(messengerGate);
  targetLanguageTrigger.disabled = !connectionAvailable || browserConnectionDisabled || !status?.supported;
  if (targetLanguageTrigger.disabled) closeTargetLanguageMenu();
}

function renderConnection(response) {
  connection.className = "connection";
  const appConnected = response?.appConnected ?? response?.type === "status";
  if (browserConnectionDisabled) {
    appStatus = null;
    connection.classList.add("disabled");
    connectionText.textContent = copy("disabled");
    detail.textContent = `${copy("webTranslation")} · ${copy("settings")}`;
  } else if (response?.type === "status" && appConnected) {
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
  const privacyPage = tab?.url?.split(/[?#]/u)[0] === api.runtime.getURL("messenger-privacy.html");
  let status = privacyPage ? { privacyPage: true, supported: false } : null;
  let pageRevision = 0;
  function refreshPageStatus() {
    if (!tab?.id || privacyPage) return;
    const revision = ++pageRevision;
    void pageStatus(tab.id).then(updated => {
      if (revision === pageRevision && updated) { status = updated; renderPageStatus(status); }
    });
  }
  // A discarded or stalled page must never hold the installation guide hostage.
  refreshPageStatus();
  renderPageStatus(status);
  const get = id => document.getElementById(id);
  const guidance = globalThis.NudeNyangConnectionGuidance.createGuidance({
    read: () => new Promise(resolve => {
      if (!api.storage?.local) return resolve({});
      api.storage.local.get(["companionConnected", "companionHelpDismissed"], result => {
        void api.runtime.lastError; resolve(result ?? {});
      });
    }),
    save: patch => new Promise(resolve => {
      if (!api.storage?.local) return resolve();
      api.storage.local.set(patch, () => { void api.runtime.lastError; resolve(); });
    }),
    request: type => new Promise(resolve => {
      // Also bound a missing extension worker; never wait indefinitely for UI.
      const timer = setTimeout(() => resolve(null), 7000);
      try {
        api.runtime.sendMessage({ type: "nudenyang-setup-status", checkOnly: type === "connectionPing" }, response => {
          clearTimeout(timer); void api.runtime.lastError; resolve(response ?? null);
        });
      } catch { clearTimeout(timer); resolve(null); }
    }),
    render(state) {
      const nativeStatus = state.response;
      const wasConnected = connectionAvailable;
      connectionAvailable = state.phase === "connected";
      browserConnectionDisabled = state.phase === "disabled";
      if (nativeStatus?.type === "status" || browserConnectionDisabled) {
        applyUiLanguage(nativeStatus.resolvedUiLanguage || nativeStatus.uiLanguage);
        renderTargetLanguageOptions();
      }
      if (nativeStatus?.type === "status") {
        quickToggleShortcut = nativeStatus.webSettings?.quickToggleShortcut ?? "F4";
        quickToggleShortcutElement.textContent = quickToggleShortcut || "-";
      }
      renderPageStatus(status);
      renderConnection(nativeStatus?.type === "connection" && connectionAvailable ? appStatus : nativeStatus);
      if (state.phase === "checking") {
        connection.className = "connection waiting";
        connectionText.textContent = copy("checking");
        detail.textContent = "";
      } else if (state.phase === "unavailable") {
        appStatus = null;
        detail.textContent = copy("connectionHelp");
      }
      const unavailable = state.phase === "unavailable";
      const recovery = state.everConnected || ["app_unavailable", "app_state_unavailable", "native_host_timeout"].includes(nativeStatus?.code);
      get("companion-panel").hidden = !unavailable || state.dismissed;
      get("companion-help").hidden = !unavailable || !state.dismissed;
      get("companion-description").textContent = copy(recovery ? "companionRecovery" : "companionIntro");
      get("companion-download").classList.toggle("messenger-consent-action", !recovery);
      get("companion-retry").classList.toggle("messenger-consent-action", recovery);
      get("companion-troubleshooting").hidden = recovery;
      // Consent and translation remain untouched. Only refresh visible status.
      if (connectionAvailable && !wasConnected && tab?.id && !privacyPage) {
        refreshPageStatus();
      }
    },
  });
  get("companion-dismiss").addEventListener("click", () => guidance.dismiss());
  get("companion-help").addEventListener("click", () => guidance.expand());
  get("companion-retry").addEventListener("click", () => { void guidance.retry(); });
  get("companion-download").addEventListener("click", () => {
    api.tabs.create({ url: `${api.runtime.getURL("download.html")}?lang=${encodeURIComponent(uiLanguage)}` }, () => {
      if (api.runtime.lastError) detail.textContent = copy("unableToProcess");
    });
  });
  window.addEventListener("pagehide", () => guidance.stop(), { once: true });
  void guidance.start();
  void commandsPromise.then(renderCommandShortcut);

  async function handleQuickToggle(event) {
    if (!isQuickToggleShortcut(event, quickToggleShortcut)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!tab?.id || enabled.disabled) return;
    pageRevision++;
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
    if (!tab?.id || enabled.disabled) return;
    pageRevision++;
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
    if (!option || !tab?.id || targetLanguageTrigger.disabled) return;
    pageRevision++;
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
    if (!tab?.id || !tab.url || !appStatus?.webSettings || alwaysTranslateSite.disabled) return;
    pageRevision++;
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
      if (response?.code === "browser_connection_disabled") {
        browserConnectionDisabled = true;
        applyUiLanguage(response.resolvedUiLanguage || response.uiLanguage);
        renderPageStatus(status);
        renderConnection(response);
        return;
      }
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
  function openMessengerPrivacy(resumeConversation = false) {
    try {
      const url = new URL(api.runtime.getURL("messenger-privacy.html"));
      if (resumeConversation && Number.isInteger(tab?.id) && status?.messengerContextId) {
        // Carry only a tab handle and an opaque document/conversation nonce.
        url.searchParams.set("tab", String(tab.id));
        url.searchParams.set("context", status.messengerContextId);
      }
      api.tabs.create({ url: url.href }, () => {
        if (api.runtime.lastError) {
          messengerPanel.hidden = false;
          messengerNotice.hidden = false;
          messengerNotice.textContent = copy("unableToProcess");
        }
      });
    } catch {
      messengerPanel.hidden = false;
      messengerNotice.hidden = false;
      messengerNotice.textContent = copy("unableToProcess");
    }
  }
  messengerPrivacy.addEventListener("click", () => openMessengerPrivacy());
  messengerConsentStart.addEventListener("click", () => openMessengerPrivacy(true));
}

void initialize();
