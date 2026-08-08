const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;

const LANGUAGE_LABELS = Object.freeze({
  ko: "한국어",
  ja: "日本語",
  en: "English",
  zh: "简体中文",
  "zh-Hant": "繁體中文",
});

const elements = {
  engineSummary: document.querySelector("#engine-summary"),
  translationIndicator: document.querySelector("#translation-indicator"),
  translationState: document.querySelector("#translation-state"),
  targetLanguage: document.querySelector("#target-language"),
  mainMenu: document.querySelector("#main-menu"),
  languageView: document.querySelector("#language-view"),
  openLabel: document.querySelector("#open-label"),
  languageOptions: [...document.querySelectorAll("[data-language]")],
};
let currentConfig = null;
let refreshing = false;

function showMainView() {
  elements.mainMenu.hidden = false;
  elements.languageView.hidden = true;
  elements.openLabel.textContent = "열기";
}

function showLanguageView() {
  elements.mainMenu.hidden = true;
  elements.languageView.hidden = false;
  elements.openLabel.textContent = "뒤로";
  elements.languageOptions.find(option => option.getAttribute("aria-pressed") === "true")?.focus();
}

function updateLanguageSelection(language) {
  elements.languageOptions.forEach(option => {
    option.setAttribute("aria-pressed", String(option.dataset.language === language));
  });
}

function applyTheme(theme) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
}

function renderStatus(status, config) {
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

async function selectLanguage(language) {
  if (!invoke || !LANGUAGE_LABELS[language]) return;
  try {
    const updated = await invoke("settings_update", { patch: { target_language: language } });
    currentConfig = updated;
    renderStatus(null, updated);
    showMainView();
  } catch {
    elements.engineSummary.textContent = "표시 언어를 바꾸지 못함";
  }
}

document.querySelector("#open-settings").addEventListener("click", () => {
  if (!elements.languageView.hidden) showMainView();
  else run("tray_open_settings");
});
document.querySelector("#open-language-settings").addEventListener("click", showLanguageView);
document.querySelector("#open-settings-secondary").addEventListener("click", () => run("tray_open_settings"));
document.querySelector("#toggle-translation").addEventListener("click", () => run("tray_request_translation_toggle"));
document.querySelector("#quit-app").addEventListener("click", () => run("application_exit"));
elements.languageOptions.forEach(option => {
  option.addEventListener("click", () => selectLanguage(option.dataset.language));
});

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (!elements.languageView.hidden) showMainView();
  else run("tray_menu_hide");
});

if (listen) {
  listen("tray-menu-opened", () => {
    showMainView();
    refresh();
  });
  listen("translation-state-changed", event => renderStatus(event.payload, currentConfig));
  listen("settings-changed", event => {
    currentConfig = event.payload;
    applyTheme(currentConfig.ui_theme || "system");
    renderStatus(null, currentConfig);
  });
}
showMainView();
refresh();
window.setInterval(refresh, 700);
