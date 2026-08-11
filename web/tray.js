const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;

const LANGUAGE_LABELS = Object.freeze({
  ko: "한국어",
  ja: "日本語",
  en: "English",
  zh: "简体中文",
  "zh-Hant": "繁體中文",
});

const TRANSLATOR_LABELS = Object.freeze({
  hymt_1_8b: "Hy-MT2 1.8B",
  hymt_7b: "Hy-MT2 7B",
  translategemma_4b: "TranslateGemma 4B",
  milmmt_4b: "MiLMMT 4B",
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  deepl: "DeepL",
  mock: "Mock 테스트",
});

const VIEW_HEIGHTS = Object.freeze({
  main: 318,
  language: 274,
  model: 427,
});
const UPDATE_ROW_HEIGHT = 58;

const elements = {
  engineSummary: document.querySelector("#engine-summary"),
  translationIndicator: document.querySelector("#translation-indicator"),
  translationState: document.querySelector("#translation-state"),
  targetLanguage: document.querySelector("#target-language"),
  translatorName: document.querySelector("#translator-name"),
  mainMenu: document.querySelector("#main-menu"),
  languageView: document.querySelector("#language-view"),
  modelView: document.querySelector("#model-view"),
  openLabel: document.querySelector("#open-label"),
  updateGroup: document.querySelector("#tray-update-group"),
  installUpdate: document.querySelector("#install-update"),
  updateVersion: document.querySelector("#tray-update-version"),
  languageOptions: [...document.querySelectorAll("[data-language]")],
  translatorOptions: [...document.querySelectorAll("[data-translator]")],
};
let currentConfig = null;
let currentStatus = null;
let refreshing = false;
let providerConnections = new Map();
let availableUpdateVersion = "";

function showMainView() {
  elements.mainMenu.hidden = false;
  elements.languageView.hidden = true;
  elements.modelView.hidden = true;
  elements.openLabel.textContent = "열기";
  resizeTray(VIEW_HEIGHTS.main + (availableUpdateVersion ? UPDATE_ROW_HEIGHT : 0));
}

function renderUpdateAvailability(update) {
  availableUpdateVersion = update?.available ? String(update.version || "") : "";
  const available = Boolean(availableUpdateVersion);
  elements.updateGroup.hidden = !available;
  elements.installUpdate.hidden = !available;
  elements.updateVersion.textContent = availableUpdateVersion;
  if (!elements.mainMenu.hidden) {
    resizeTray(VIEW_HEIGHTS.main + (available ? UPDATE_ROW_HEIGHT : 0));
  }
}

async function refreshUpdateAvailability() {
  if (!invoke) return;
  try {
    renderUpdateAvailability(await invoke("update_availability_get"));
  } catch {
    renderUpdateAvailability(null);
  }
}

function showLanguageView() {
  elements.mainMenu.hidden = true;
  elements.languageView.hidden = false;
  elements.modelView.hidden = true;
  elements.openLabel.textContent = "뒤로";
  resizeTray(VIEW_HEIGHTS.language);
  elements.languageOptions.find(option => option.getAttribute("aria-pressed") === "true")?.focus();
}

function showModelView() {
  elements.mainMenu.hidden = true;
  elements.languageView.hidden = true;
  elements.modelView.hidden = false;
  elements.openLabel.textContent = "뒤로";
  resizeTray(VIEW_HEIGHTS.model);
  elements.translatorOptions.find(option => option.getAttribute("aria-pressed") === "true")?.focus();
  void refreshProviderConnections();
}

async function refreshProviderConnections() {
  if (!invoke) return;
  try {
    const connections = await invoke("provider_connections_get");
    providerConnections = new Map(connections.map(connection => [connection.id, connection]));
    elements.translatorOptions.forEach(option => {
      const connection = providerConnections.get(option.dataset.translator);
      const label = option.querySelector(".model-connection");
      if (!connection || !label) return;
      option.classList.toggle("needs-connection", !connection.connected);
      label.textContent = connection.connected ? "" : "연결 필요";
    });
  } catch {
    providerConnections = new Map();
  }
}

function updateLanguageSelection(language) {
  elements.languageOptions.forEach(option => {
    option.setAttribute("aria-pressed", String(option.dataset.language === language));
  });
}

function updateTranslatorSelection(translator) {
  elements.translatorOptions.forEach(option => {
    option.setAttribute("aria-pressed", String(option.dataset.translator === translator));
  });
}

function applyTheme(theme) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
}

function renderStatus(status, config) {
  if (status) currentStatus = status;
  status ||= currentStatus;
  const enabled = Boolean(status?.enabled ?? config?.enabled);
  const connected = Boolean(status?.cdpConnected);
  elements.translationIndicator.classList.toggle("enabled", enabled);
  elements.translationState.textContent = enabled ? "켜짐" : "꺼짐";
  elements.engineSummary.textContent = connected
    ? "Discord 연결됨"
    : enabled ? "Discord 연결 중" : "번역 대기 중";
  const targetLanguage = config?.target_language || status?.targetLanguage || "ko";
  elements.targetLanguage.textContent = LANGUAGE_LABELS[targetLanguage] || "한국어";
  updateLanguageSelection(targetLanguage);
  const translator = config?.translator || status?.configuredTranslator || "hymt_1_8b";
  const translatorLabel = TRANSLATOR_LABELS[translator] || translator;
  const translatorPending = status?.configuredTranslator === translator
    && ["queued", "preparing"].includes(status?.translatorState);
  const translatorFailed = status?.configuredTranslator === translator
    && status?.translatorState === "error";
  elements.translatorName.textContent = translatorPending
    ? `${translatorLabel} 준비 중`
    : translatorFailed ? `${translatorLabel} 오류` : translatorLabel;
  elements.translatorName.title = translatorLabel;
  updateTranslatorSelection(translator);
}

async function refresh() {
  if (!invoke || refreshing) return;
  refreshing = true;
  try {
    const [config, status] = await Promise.all([
      invoke("settings_get"),
      invoke("runtime_status"),
    ]);
    currentConfig = config;
    applyTheme(config.ui_theme || "system");
    renderStatus(status, config);
  } catch {
    elements.engineSummary.textContent = "상태를 확인할 수 없음";
  } finally {
    refreshing = false;
  }
}

async function run(command) {
  if (!invoke) return;
  try {
    await invoke(command);
  } catch {
    elements.engineSummary.textContent = "요청을 처리할 수 없음";
  }
}

function resizeTray(height) {
  if (invoke) void invoke("tray_menu_set_height", { height });
}

async function selectLanguage(language) {
  if (!invoke || !LANGUAGE_LABELS[language]) return;
  try {
    const updated = await invoke("settings_update", { patch: { target_language: language } });
    currentConfig = updated;
    renderStatus(currentStatus, updated);
    showMainView();
  } catch {
    elements.engineSummary.textContent = "표시 언어를 바꾸지 못함";
  }
}

async function selectTranslator(translator) {
  if (!invoke || !TRANSLATOR_LABELS[translator]) return;
  try {
    if (["chatgpt", "claude", "gemini", "deepl"].includes(translator)) {
      if (!providerConnections.has(translator)) await refreshProviderConnections();
      if (!providerConnections.get(translator)?.connected) {
        await invoke("tray_open_provider_settings", { provider: translator });
        await invoke("tray_menu_hide");
        return;
      }
    }
    const updated = await invoke("settings_update", { patch: { translator } });
    currentConfig = updated;
    renderStatus(currentStatus, updated);
    showMainView();
    await refresh();
  } catch {
    elements.engineSummary.textContent = "번역 모델을 바꾸지 못함";
  }
}

document.querySelector("#open-settings").addEventListener("click", () => {
  if (!elements.languageView.hidden || !elements.modelView.hidden) showMainView();
  else run("tray_open_settings");
});
document.querySelector("#open-language-settings").addEventListener("click", showLanguageView);
document.querySelector("#open-model-settings").addEventListener("click", showModelView);
document.querySelector("#open-settings-secondary").addEventListener("click", () => run("tray_open_settings"));
document.querySelector("#toggle-translation").addEventListener("click", () => run("tray_request_translation_toggle"));
document.querySelector("#quit-app").addEventListener("click", () => run("application_exit"));
elements.installUpdate.addEventListener("click", () => run("tray_request_update_install"));
elements.languageOptions.forEach(option => {
  option.addEventListener("click", () => selectLanguage(option.dataset.language));
});
elements.translatorOptions.forEach(option => {
  option.addEventListener("click", () => selectTranslator(option.dataset.translator));
});

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (!elements.languageView.hidden || !elements.modelView.hidden) showMainView();
  else run("tray_menu_hide");
});

if (listen) {
  listen("tray-menu-opened", () => {
    showMainView();
    refresh();
    refreshUpdateAvailability();
  });
  listen("update-availability-changed", event => renderUpdateAvailability(event.payload));
  listen("translation-state-changed", event => renderStatus(event.payload, currentConfig));
  listen("settings-changed", event => {
    currentConfig = event.payload;
    applyTheme(currentConfig.ui_theme || "system");
    renderStatus(currentStatus, currentConfig);
  });
}
showMainView();
refresh();
refreshUpdateAvailability();
window.setInterval(refresh, 700);
