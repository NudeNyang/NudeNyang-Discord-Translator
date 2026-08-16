import {
  discordConnectionLabel,
  localModelResourceGuidance,
  localModelStorageDisplay,
  modelPreparationBanner,
  normalizeConfig,
  resolveEnabledState,
  restartCountdownMessage,
  scrollThumbMetrics,
  shortcutFromKeyboardEvent,
  shouldPromptRestart,
  translatorRuntimeLabel,
} from "./state.mjs";
import { LICENSE_DOCUMENTS_TEXT } from "./license.mjs";
import { LANGUAGE_OPTIONS } from "./languages.mjs";
import { filterLanguageOptions } from "./language-search.mjs";
import {
  applyStaticTranslations,
  translateCopy,
  translateDynamicCopy,
  translateUserFacingError,
} from "./i18n.mjs";

const tauriInvoke = window.__TAURI__?.core?.invoke;
const tauriListen = window.__TAURI__?.event?.listen;
const tauriGetVersion = window.__TAURI__?.app?.getVersion;
const tauriOpenUrl = window.__TAURI__?.opener?.openUrl;
const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
const SCROLL_INDICATOR_REVEAL_DISTANCE = 44;
const APP_LINKS = Object.freeze({
  author: "https://x.com/NudeNyang_VRC",
  repository: "https://github.com/NudeNyang/NudeNyang-Discord-Translator",
});

const DISPLAY_TRANSLATOR_OPTIONS = [
  ["hymt_1_8b", "Hy-MT2 1.8B Q4 (로컬·기본)", "local"],
  ["hymt_7b", "Hy-MT2 7B Q4 (로컬·품질 우선)", "local"],
  ["translategemma_4b", "TranslateGemma 4B Q4 (실험·약 2.5GB)", "local"],
  ["chatgpt", "ChatGPT CLI (외부·품질 우선)", "external"],
  ["claude", "Claude CLI (외부·품질 우선)", "external"],
  ["gemini", "Gemini CLI (외부·품질 우선)", "external"],
  ["deepl", "DeepL (API 키·외부 전송)", "external"],
  ["mock", "Mock 테스트", "testing"],
];

const OUTGOING_TRANSLATOR_OPTIONS = [
  ["chatgpt", "ChatGPT CLI (권장·품질 우선)", "recommended"],
  ["claude", "Claude CLI (권장·품질 우선)", "recommended"],
  ["gemini", "Gemini CLI (권장·품질 우선)", "recommended"],
  ["deepl", "DeepL (API 키·외부 전송)", "recommended"],
  ["hymt_1_8b", "Hy-MT2 1.8B Q4 (로컬·속도 우선)", "local-limited"],
  ["hymt_7b", "Hy-MT2 7B Q4 (로컬·속도 우선)", "local-limited"],
  ["translategemma_4b", "TranslateGemma 4B Q4 (실험·속도 우선)", "local-limited"],
  ["mock", "Mock 테스트", "testing"],
];

const SELECT_GROUP_LABELS = Object.freeze({
  local: "로컬 모델",
  external: "외부 번역 서비스",
  recommended: "권장 CLI 및 번역 서비스",
  "local-limited": "로컬 및 실험 모델",
  testing: "테스트 모델",
});

const OPTIONS = {
  target_language: LANGUAGE_OPTIONS,
  translator: DISPLAY_TRANSLATOR_OPTIONS,
  outgoing_translator: OUTGOING_TRANSLATOR_OPTIONS,
  outgoing_target_language: [["auto", "최근 대화에서 자동 감지"], ...LANGUAGE_OPTIONS],
  hymt_device: [
    ["auto", "자동 보호 (권장)"],
    ["gpu", "GPU 우선"],
    ["cpu", "CPU/RAM 전용"],
  ],
  image_ocr_quality: [
    ["adaptive", "자동 (권장)"],
    ["fast", "빠른 처리"],
    ["quality", "고품질 우선"],
  ],
  ui_theme: [
    ["system", "시스템 설정 따르기"],
    ["light", "라이트"],
    ["dark", "다크"],
  ],
  ui_language: [["auto", "Auto (System)", "", "System language"], ...LANGUAGE_OPTIONS],
  translation_history_retention_days: [
    [0, "사용 안 함"],
    [7, "7일 보관"],
    [30, "30일 보관"],
    [90, "90일 보관"],
    [180, "180일 보관"],
  ],
};

const state = {
  config: normalizeConfig(),
  runtime: null,
  selectValues: {},
  promptActive: false,
  repairActive: false,
  restartAttempted: false,
  polling: false,
  updateCheckActive: false,
  availableUpdateVersion: "",
  updatePromptedVersion: "",
  updateInstalling: false,
  modelPreparationActive: false,
  modelPreparationCancelling: false,
  settingsScrollTimer: 0,
  captureFpsTimer: 0,
  settingsApplyRevision: 0,
  settingsUpdatesPending: 0,
  settingsUpdateQueue: Promise.resolve(),
  pendingEnabled: null,
  toggleActive: false,
  outgoingToggleActive: false,
  autostartEnabled: false,
  autostartLoading: false,
  providerConnections: new Map(),
  providerLoading: false,
  storageStatus: null,
  systemMemory: null,
};
const localizedText = new Map();
const localizedErrors = new Map();
const localizedBackendText = new Map();

const elements = {
  form: document.querySelector("#settings-form"),
  enabled: document.querySelector("#enabled"),
  outgoingTranslation: document.querySelector("#outgoing-translation"),
  outgoingConfirmSend: document.querySelector("#outgoing-confirm-send"),
  autostart: document.querySelector("#autostart"),
  outgoingAutoHelp: document.querySelector("#outgoing-auto-help"),
  translationShortcutHint: document.querySelector("#translation-shortcut-hint"),
  outgoingShortcutHint: document.querySelector("#outgoing-shortcut-hint"),
  keepWarm: document.querySelector("#keep-warm"),
  captureFps: document.querySelector("#capture-fps"),
  shortcut: document.querySelector("#toggle-shortcut"),
  outgoingShortcut: document.querySelector("#toggle-outgoing-shortcut"),
  sendImmediatelyShortcut: document.querySelector("#send-immediately-shortcut"),
  reviewBeforeSendShortcut: document.querySelector("#review-before-send-shortcut"),
  resetSettings: document.querySelector("#reset-settings"),
  saveStatus: document.querySelector("#save-status"),
  engineState: document.querySelector("#engine-state"),
  engineStateLabel: document.querySelector("#engine-state-label"),
  modalLayer: document.querySelector("#modal-layer"),
  modalTitle: document.querySelector("#modal-title"),
  modalMessage: document.querySelector("#modal-message"),
  modalCancel: document.querySelector("#modal-cancel"),
  modalAccept: document.querySelector("#modal-accept"),
  settingsScrollRegion: document.querySelector(".settings-scroll-region"),
  settingsScroll: document.querySelector("#settings-scroll"),
  settingsScrollIndicator: document.querySelector("#settings-scroll-indicator"),
  settingsScrollThumb: document.querySelector("#settings-scroll-indicator .scroll-indicator-thumb"),
  appVersion: document.querySelector("#app-version"),
  authorLink: document.querySelector("#author-link"),
  githubLink: document.querySelector("#github-link"),
  updateStatus: document.querySelector("#update-status"),
  checkUpdate: document.querySelector("#check-update"),
  updateBanner: document.querySelector("#update-banner"),
  activityBannerMark: document.querySelector("#activity-banner-mark"),
  activityBannerTitle: document.querySelector("#activity-banner-title"),
  updateBannerVersion: document.querySelector("#update-banner-version"),
  updateBannerDetail: document.querySelector("#update-banner-detail"),
  modelBannerDetail: document.querySelector("#model-banner-detail"),
  activityProgress: document.querySelector("#activity-progress"),
  activityProgressBar: document.querySelector("#activity-progress-bar"),
  modelBannerCancel: document.querySelector("#model-banner-cancel"),
  updateBannerInstall: document.querySelector("#update-banner-install"),
  openDiagnosticLog: document.querySelector("#open-diagnostic-log"),
  viewLicense: document.querySelector("#view-license"),
  localModelStorageList: document.querySelector("#local-model-storage-list"),
  localResourceGuidance: document.querySelector("#local-resource-guidance"),
  localResourceTitle: document.querySelector("#local-resource-title"),
  localResourceDetail: document.querySelector("#local-resource-detail"),
  applyLowMemoryPreset: document.querySelector("#apply-low-memory-preset"),
  openLocalModelFolder: document.querySelector("#open-local-model-folder"),
  translationCacheSummary: document.querySelector("#translation-cache-summary"),
  clearTranslationCache: document.querySelector("#clear-translation-cache"),
  outgoingModelGuidance: document.querySelector("#outgoing-model-guidance"),
  outgoingModelGuidanceTitle: document.querySelector("#outgoing-model-guidance-title"),
  outgoingModelGuidanceDetail: document.querySelector("#outgoing-model-guidance-detail"),
  outgoingModelGuidanceAction: document.querySelector("#outgoing-model-guidance-action"),
  vramProtectionNote: document.querySelector("#vram-protection-note"),
  providerRows: [...document.querySelectorAll(".provider-row")],
};

const EXTERNAL_PROVIDERS = new Set(["chatgpt", "claude", "gemini", "deepl"]);
const CLI_PROVIDERS = new Set(["chatgpt", "claude", "gemini"]);
const LOCAL_TRANSLATORS = new Set(
  DISPLAY_TRANSLATOR_OPTIONS
    .filter(([, , group]) => group === "local")
    .map(([value]) => value),
);
const RECOMMENDED_PROVIDER_ORDER = ["chatgpt", "claude", "gemini"];
const PROVIDER_LOGIN_COPY = Object.freeze({
  chatgpt: { name: "ChatGPT", account: "ChatGPT 계정" },
  claude: { name: "Claude", account: "Claude 계정" },
  gemini: { name: "Google", account: "Google 계정", terminal: true },
});

function updateScrollIndicator() {
  const metrics = scrollThumbMetrics(
    elements.settingsScroll.clientHeight,
    elements.settingsScroll.scrollHeight,
    elements.settingsScroll.scrollTop,
  );
  elements.settingsScrollIndicator.classList.toggle("scrollable", metrics.scrollable);
  elements.settingsScrollThumb.style.height = `${metrics.height}px`;
  elements.settingsScrollThumb.style.transform = `translateY(${metrics.top}px)`;
  if (!metrics.scrollable) {
    elements.settingsScrollRegion.classList.remove("scroll-near", "scroll-dragging");
  }
}

function bindOverlayScrollIndicator() {
  const region = elements.settingsScrollRegion;
  const target = elements.settingsScroll;
  const indicator = elements.settingsScrollIndicator;
  const thumb = elements.settingsScrollThumb;
  let draggingPointer = null;

  const updateProximity = event => {
    if (draggingPointer !== null) return;
    if (!indicator.classList.contains("scrollable")) {
      region.classList.remove("scroll-near");
      return;
    }
    const bounds = indicator.getBoundingClientRect();
    const distanceX = Math.max(bounds.left - event.clientX, 0, event.clientX - bounds.right);
    const distanceY = Math.max(bounds.top - event.clientY, 0, event.clientY - bounds.bottom);
    const isNear = Math.hypot(distanceX, distanceY) <= SCROLL_INDICATOR_REVEAL_DISTANCE;
    region.classList.toggle("scroll-near", isNear);
  };

  const scrollToPointer = clientY => {
    const track = indicator.getBoundingClientRect();
    const thumbHeight = thumb.getBoundingClientRect().height;
    const thumbTravel = Math.max(0, track.height - thumbHeight);
    const maxScroll = Math.max(0, target.scrollHeight - target.clientHeight);
    if (thumbTravel <= 0 || maxScroll <= 0) return;
    const thumbTop = Math.min(thumbTravel, Math.max(0, clientY - track.top - thumbHeight / 2));
    target.scrollTop = (thumbTop / thumbTravel) * maxScroll;
  };

  const finishDrag = event => {
    if (draggingPointer !== event.pointerId) return;
    draggingPointer = null;
    region.classList.remove("scroll-dragging");
    if (indicator.hasPointerCapture(event.pointerId)) {
      indicator.releasePointerCapture(event.pointerId);
    }
    updateProximity(event);
  };

  region.addEventListener("pointermove", updateProximity);
  region.addEventListener("pointerleave", () => {
    if (draggingPointer === null) region.classList.remove("scroll-near");
  });
  indicator.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !indicator.classList.contains("scrollable")) return;
    draggingPointer = event.pointerId;
    region.classList.add("scroll-near", "scroll-dragging");
    indicator.setPointerCapture(event.pointerId);
    scrollToPointer(event.clientY);
    event.preventDefault();
    event.stopPropagation();
  });
  indicator.addEventListener("pointermove", event => {
    if (draggingPointer === event.pointerId) scrollToPointer(event.clientY);
  });
  indicator.addEventListener("pointerup", finishDrag);
  indicator.addEventListener("pointercancel", finishDrag);
  indicator.addEventListener("wheel", event => {
    if (!indicator.classList.contains("scrollable")) return;
    target.scrollTop += event.deltaY;
    event.preventDefault();
    event.stopPropagation();
  }, { passive: false });
}

async function invoke(command, payload = {}) {
  if (!tauriInvoke) throw new Error("Tauri 앱에서만 사용할 수 있는 기능입니다.");
  return tauriInvoke(command, payload);
}

function writeDiagnostic(level, message) {
  if (!tauriInvoke) return;
  tauriInvoke("diagnostic_log_write", {
    level,
    component: "webview",
    message: String(message || "unknown webview error"),
  }).catch(() => {});
}

window.addEventListener("error", event => {
  writeDiagnostic("error", `${event.message || "JavaScript error"} at ${event.filename || "unknown"}:${event.lineno || 0}`);
});
window.addEventListener("unhandledrejection", event => {
  const reason = event.reason?.stack || event.reason?.message || event.reason;
  writeDiagnostic("error", `Unhandled promise rejection: ${String(reason || "unknown")}`);
});

function isAllowedExternalUrl(url) {
  return Object.values(APP_LINKS).includes(url)
    || url.startsWith(`${APP_LINKS.repository}/releases/`);
}

async function openExternalUrl(url) {
  if (!isAllowedExternalUrl(url)) throw new Error("허용되지 않은 외부 주소입니다.");
  if (tauriOpenUrl) {
    await tauriOpenUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function providerConnection(provider) {
  return state.providerConnections.get(provider) || null;
}

function providerIsConnected(provider) {
  return Boolean(providerConnection(provider)?.connected);
}

function providerStateLabel(connection) {
  if (connection.connected) return "연결됨";
  if (connection.state === "disabled") return "사용 중지됨";
  if (connection.state === "not-installed") return "설치 필요";
  if (connection.state === "credential-required") return "API 키 필요";
  if (connection.state === "login-required") return "로그인 필요";
  return "확인 필요";
}

function setProviderActionLabel(action, korean) {
  if (!action) return;
  const key = String(korean ?? "");
  const translated = translateDynamicCopy(currentUiLanguage(), key);
  action.dataset.i18nAriaLabel = key;
  action.dataset.i18nTooltip = key;
  action.dataset.tooltip = translated;
  action.setAttribute("aria-label", translated);
  action.removeAttribute("title");
}

function connectedRecommendedProvider() {
  return RECOMMENDED_PROVIDER_ORDER.find(providerIsConnected) || "";
}

function renderOutgoingModelGuidance() {
  const selected = state.selectValues.outgoing_translator || state.config.outgoing_translator;
  const action = elements.outgoingModelGuidanceAction;
  if (!selected || !elements.outgoingModelGuidance || !action) return;

  if (elements.vramProtectionNote) {
    elements.vramProtectionNote.hidden = !LOCAL_TRANSLATORS.has(selected);
  }
  action.hidden = false;
  action.disabled = false;
  delete action.dataset.provider;
  if (CLI_PROVIDERS.has(selected)) {
    elements.outgoingModelGuidance.dataset.state = "external";
    setLocalizedText(elements.outgoingModelGuidanceTitle, "CLI 모델로 보내는 메시지를 통역합니다.");
    setLocalizedText(elements.outgoingModelGuidanceDetail, "번역할 텍스트만 선택한 서비스로 전송됩니다. 로컬 모델보다 의미와 말투를 안정적으로 보존하는 데 적합합니다.");
    action.hidden = true;
    return;
  }
  if (selected === "deepl") {
    elements.outgoingModelGuidance.dataset.state = "external";
    setLocalizedText(elements.outgoingModelGuidanceTitle, "외부 번역 서비스로 보내는 메시지를 통역합니다.");
    setLocalizedText(elements.outgoingModelGuidanceDetail, "번역할 텍스트만 DeepL로 전송됩니다.");
    action.hidden = true;
    return;
  }

  elements.outgoingModelGuidance.dataset.state = "local";
  setLocalizedText(elements.outgoingModelGuidanceTitle, "보내는 메시지에는 CLI 모델을 권장합니다.");
  const connectedProvider = connectedRecommendedProvider();
  if (connectedProvider) {
    setLocalizedText(elements.outgoingModelGuidanceDetail, "연결된 CLI 모델을 사용하면 의미와 말투를 더 안정적으로 보존할 수 있습니다.");
    setLocalizedText(action, "권장 모델 사용");
    action.dataset.provider = connectedProvider;
  } else {
    setLocalizedText(elements.outgoingModelGuidanceDetail, "로컬 모델은 짧고 단순한 문장에 적합합니다. 문맥과 말투가 중요한 메시지는 CLI 모델 사용을 권장합니다.");
    setLocalizedText(action, "CLI 모델 연결");
  }
}

function renderProviderConnections(connections) {
  state.providerConnections = new Map(connections.map(connection => [connection.id, connection]));
  for (const row of elements.providerRows) {
    const connection = providerConnection(row.dataset.provider);
    if (!connection) continue;
    const status = row.querySelector(".provider-status");
    const action = row.querySelector(".provider-action");
    const disconnect = row.querySelector(".provider-disconnect");
    status.dataset.state = connection.state;
    setLocalizedText(status.querySelector("strong"), providerStateLabel(connection));
    setLocalizedBackendText(status.querySelector("span"), connection.detail);
    if (action) {
      action.hidden = connection.canDisconnect;
      action.disabled = connection.connected;
      setProviderActionLabel(action, connection.connected ? "연결됨" : connection.installed ? "연결" : "설치");
    }
    if (disconnect) {
      disconnect.hidden = !connection.canDisconnect;
      setProviderActionLabel(disconnect, "연결 해제");
    }
    const secret = row.querySelector(".provider-secret");
    if (secret) secret.placeholder = translateCopy(
      currentUiLanguage(),
      connection.connected ? "새 API 키 입력 시 변경" : "DeepL API 키",
    );
  }
  applyUiLanguage(state.selectValues.ui_language || state.config.ui_language);
  renderOutgoingModelGuidance();
}

async function loadProviderConnections() {
  if (state.providerLoading) return;
  state.providerLoading = true;
  try {
    renderProviderConnections(await invoke("provider_connections_get"));
  } catch (error) {
    for (const row of elements.providerRows) {
      const status = row.querySelector(".provider-status");
      status.dataset.state = "error";
      setLocalizedText(status.querySelector("strong"), "확인 실패");
      setLocalizedError(status.querySelector("span"), error);
    }
  } finally {
    state.providerLoading = false;
    renderOutgoingModelGuidance();
  }
}

function revealProviderConnection(provider) {
  activateSettingsPanel("engine");
  const row = document.querySelector(`.provider-row[data-provider="${provider}"]`);
  if (!row) return;
  row.dataset.highlight = "true";
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => delete row.dataset.highlight, 1800);
}

function activateSettingsPanel(panel) {
  const target = document.querySelector(`[data-settings-view="${panel}"]`);
  if (!target) return;
  for (const view of document.querySelectorAll("[data-settings-view]")) {
    const active = view === target;
    view.hidden = !active;
    view.classList.toggle("active", active);
  }
  for (const item of document.querySelectorAll("[data-settings-panel]")) {
    const active = item.dataset.settingsPanel === panel;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  }
  elements.settingsScroll.scrollTop = 0;
  closeAllSelects();
  window.requestAnimationFrame(updateScrollIndicator);
}

async function connectProvider(row) {
  const provider = row.dataset.provider;
  const action = row.querySelector(".provider-action");
  if (!action) return;
  const status = row.querySelector(".provider-status");
  const secret = row.querySelector(".provider-secret");
  const credential = secret?.value.trim() || null;
  if (provider === "deepl" && !credential) {
    secret.focus();
    throw new Error("DeepL API 키를 입력하십시오.");
  }
  action.disabled = true;
  try {
    let current = providerConnection(provider);
    if (current && !current.installed) {
      setProviderActionLabel(action, "설치 중");
      status.dataset.state = "loading";
      setLocalizedText(status.querySelector("strong"), "설치 중");
      setLocalizedText(
        status.querySelector("span"),
        `${current.name} CLI와 필요한 실행 환경을 자동으로 설치하고 있습니다.`,
      );
      current = await invoke("provider_install", { provider });
      state.providerConnections.set(provider, current);
      renderProviderConnections([...state.providerConnections.values()]);
    }

    action.disabled = true;
    setProviderActionLabel(action, provider === "deepl" ? "확인 중" : "로그인 중");
    status.dataset.state = "loading";
    setLocalizedText(
      status.querySelector("strong"),
      provider === "deepl" ? "확인 중" : "로그인 중",
    );
    setLocalizedText(
      status.querySelector("span"),
      provider === "deepl"
        ? "DeepL API 키의 유효성을 확인하고 있습니다."
        : "계정 로그인 절차를 시작하고 있습니다.",
    );
    const loginProgress = provider !== "deepl" ? await showProviderLoginProgress(provider) : null;
    let connection;
    try {
      connection = await invoke("provider_connect", { provider, credential });
    } catch (error) {
      if (loginProgress?.wasCancelled()) {
        await loadProviderConnections();
        return;
      }
      throw error;
    } finally {
      loginProgress?.close();
    }
    state.providerConnections.set(provider, connection);
    renderProviderConnections([...state.providerConnections.values()]);
    if (secret && connection.connected) secret.value = "";
  } finally {
    if (providerConnection(provider)) {
      renderProviderConnections([...state.providerConnections.values()]);
    } else {
      action.disabled = false;
    }
  }
}

async function showProviderLoginProgress(provider) {
  const copy = PROVIDER_LOGIN_COPY[provider];
  if (!copy) throw new Error("지원하지 않는 계정 로그인 방식입니다.");
  let cancelled = false;
  let closed = false;
  let unlistenReady = null;
  setLocalizedText(elements.modalTitle, `${copy.name} 계정 연결`);
  setLocalizedText(
    elements.modalMessage,
    copy.terminal
      ? "Antigravity 로그인 터미널을 준비하고 있습니다. 잠시 기다리십시오."
      : `${copy.name} 공식 로그인 페이지를 준비하고 있습니다. 잠시 기다리십시오.`,
  );
  setLocalizedText(elements.modalCancel, "취소");
  elements.modalCancel.hidden = false;
  elements.modalCancel.disabled = false;
  setLocalizedText(elements.modalAccept, copy.terminal ? "터미널 열기" : "이동");
  elements.modalAccept.hidden = false;
  elements.modalAccept.disabled = true;
  elements.modalLayer.dataset.variant = "provider-login";
  elements.modalLayer.hidden = false;

  const close = () => {
    if (closed) return;
    closed = true;
    elements.modalLayer.hidden = true;
    delete elements.modalLayer.dataset.variant;
    elements.modalCancel.removeEventListener("click", cancel);
    elements.modalAccept.removeEventListener("click", open);
    unlistenReady?.();
    setLocalizedText(elements.modalCancel, "취소");
    elements.modalCancel.disabled = false;
    elements.modalAccept.disabled = false;
    elements.modalAccept.hidden = false;
  };
  const open = async () => {
    elements.modalAccept.disabled = true;
    try {
      const opened = await invoke("provider_login_open");
      if (!opened) {
        setLocalizedText(
          elements.modalMessage,
          "로그인 준비가 완료되지 않았습니다. 잠시 후 다시 시도하십시오.",
        );
        elements.modalAccept.disabled = false;
        return;
      }
      setLocalizedText(
        elements.modalMessage,
        copy.terminal
          ? `열린 터미널에서 Google OAuth를 선택하십시오.\n브라우저 로그인 후 인증 코드를 터미널에 붙여넣으면 앱이 완료를 자동으로 감지합니다.`
          : `브라우저에서 ${copy.account} 로그인을 완료하십시오.\n로그인이 완료되면 이 창이 자동으로 닫힙니다.`,
      );
    } catch (error) {
      setLocalizedError(elements.modalMessage, error);
      elements.modalAccept.disabled = false;
    }
  };
  const cancel = async () => {
    if (cancelled) return;
    cancelled = true;
    elements.modalCancel.disabled = true;
    setLocalizedText(elements.modalCancel, "취소 중");
    setLocalizedText(elements.modalMessage, `${copy.name} 계정 로그인을 취소하고 있습니다.`);
    try {
      await invoke("provider_login_cancel");
    } finally {
      close();
    }
  };
  elements.modalCancel.addEventListener("click", cancel);
  elements.modalAccept.addEventListener("click", open);
  if (tauriListen) {
    unlistenReady = await tauriListen("provider-login-ready", () => {
      setLocalizedText(
        elements.modalMessage,
        copy.terminal
          ? "Antigravity 최초 로그인을 진행하려면 터미널 열기를 선택하십시오."
          : `${copy.name} 공식 로그인 페이지로 이동하려면 이동을 선택하십시오.`,
      );
      elements.modalAccept.disabled = false;
      elements.modalAccept.focus();
    });
  } else {
    setLocalizedText(
      elements.modalMessage,
      copy.terminal
        ? "Antigravity 최초 로그인을 진행하려면 터미널 열기를 선택하십시오."
        : `${copy.name} 공식 로그인 페이지로 이동하려면 이동을 선택하십시오.`,
    );
    elements.modalAccept.disabled = false;
  }
  elements.modalCancel.focus();
  return { close, wasCancelled: () => cancelled };
}

async function savePendingProviderCredentials() {
  const row = document.querySelector('.provider-row[data-provider="deepl"]');
  const secret = row?.querySelector(".provider-secret");
  const credential = secret?.value.trim() || "";
  if (!credential) return;

  setLocalizedText(elements.saveStatus, "DeepL API 키 확인 중");
  const connection = await invoke("provider_connect", { provider: "deepl", credential });
  if (!connection.connected) throw new Error("DeepL API 키를 저장하지 못했습니다.");
  state.providerConnections.set("deepl", connection);
  renderProviderConnections([...state.providerConnections.values()]);
  secret.value = "";
}

async function disconnectProvider(row) {
  const provider = row.dataset.provider;
  const currentConnection = providerConnection(provider);
  const isDeepL = provider === "deepl";
  const confirmed = await showModal({
    title: `${currentConnection?.name || "번역 서비스"} 연결을 해제하시겠습니까?`,
    message: isDeepL
      ? "운영체제 보안 저장소에서 DeepL API 키를 삭제합니다. DeepL이 선택되어 있으면 로컬 기본 모델로 전환합니다."
      : "CLI 로그인 정보와 설치 상태는 유지되며 NudeNyang Discord Translator에서만 사용을 중지합니다. 해당 서비스가 선택되어 있으면 로컬 기본 모델로 전환합니다.",
    acceptText: "연결 해제",
  });
  if (!confirmed) return;
  const connection = await invoke("provider_disconnect", { provider });
  state.providerConnections.set(provider, connection);
  renderProviderConnections([...state.providerConnections.values()]);
}

async function checkForUpdates(silent = false) {
  if (state.updateCheckActive) return;
  if (state.availableUpdateVersion && !silent) {
    await installAvailableUpdate();
    return;
  }
  state.updateCheckActive = true;
  elements.checkUpdate.disabled = true;
  if (!silent) setLocalizedText(elements.updateStatus, "비공개 베타 업데이트를 확인하고 있습니다...");
  try {
    const result = await invoke("update_check");
    if (result.available) {
      await showAvailableUpdate(result.version, { prompt: silent });
    } else {
      renderAvailableUpdate("");
      setLocalizedText(elements.updateStatus, "현재 베타 버전이 최신입니다.");
      setLocalizedText(elements.checkUpdate, "지금 확인");
    }
  } catch (error) {
    if (!silent) setLocalizedText(elements.updateStatus, `업데이트 확인 실패: ${String(error)}`);
  } finally {
    state.updateCheckActive = false;
    elements.checkUpdate.disabled = false;
  }
}

function renderAvailableUpdate(version) {
  state.availableUpdateVersion = version || "";
  const available = Boolean(state.availableUpdateVersion);
  setLocalizedText(elements.checkUpdate, available ? "업데이트 설치" : "지금 확인");
  if (state.modelPreparationActive) return;

  elements.updateBanner.hidden = !available;
  elements.activityBannerMark.textContent = "↻";
  setLocalizedText(elements.activityBannerTitle, "새 업데이트가 있습니다");
  elements.updateBannerVersion.textContent = state.availableUpdateVersion;
  elements.updateBannerDetail.hidden = false;
  elements.modelBannerDetail.hidden = true;
  elements.activityProgress.hidden = true;
  elements.updateBannerInstall.hidden = false;
  elements.modelBannerCancel.hidden = true;
  elements.updateBannerInstall.disabled = state.updateInstalling;
  setLocalizedText(elements.updateBannerInstall, state.updateInstalling ? "설치 준비 중" : "업데이트 설치");
}

function renderModelPreparation(progress) {
  const banner = modelPreparationBanner(progress);
  state.modelPreparationActive = Boolean(banner);
  if (!banner) {
    renderAvailableUpdate(state.availableUpdateVersion);
    return;
  }

  elements.updateBanner.hidden = false;
  elements.activityBannerMark.textContent = progress.phase === "downloading" ? "↓" : "◌";
  setLocalizedText(elements.activityBannerTitle, banner.title);
  setLocalizedText(elements.modelBannerDetail, banner.detail);
  elements.updateBannerDetail.hidden = true;
  elements.modelBannerDetail.hidden = false;
  elements.updateBannerInstall.hidden = true;
  elements.modelBannerCancel.hidden = false;
  elements.modelBannerCancel.disabled = state.modelPreparationCancelling;
  elements.activityProgress.hidden = false;
  elements.activityProgress.dataset.indeterminate = String(banner.indeterminate);
  const percentage = Math.round(Math.min(1, Math.max(0, banner.progress)) * 100);
  elements.activityProgressBar.style.width = `${percentage}%`;
  if (banner.indeterminate) {
    elements.activityProgress.removeAttribute("aria-valuenow");
  } else {
    elements.activityProgress.setAttribute("aria-valuenow", String(percentage));
  }
}

async function cancelModelPreparation() {
  if (state.modelPreparationCancelling || !state.modelPreparationActive) return;
  state.modelPreparationCancelling = true;
  elements.modelBannerCancel.disabled = true;
  try {
    const updated = await invoke("model_preparation_cancel");
    state.config = normalizeConfig(updated);
    state.pendingEnabled = null;
    renderConfig(state.config);
    renderModelPreparation(null);
  } catch (error) {
    await showError("오류", String(error));
  } finally {
    state.modelPreparationCancelling = false;
    elements.modelBannerCancel.disabled = false;
  }
}

async function showAvailableUpdate(version, { prompt = false } = {}) {
  renderAvailableUpdate(version);
  setLocalizedText(elements.updateStatus, `새 버전 ${version}을 사용할 수 있습니다.`);
  if (!prompt || state.updatePromptedVersion === version) return;

  state.updatePromptedVersion = version;
  while (state.promptActive || !elements.modalLayer.hidden) {
    await new Promise(resolve => window.setTimeout(resolve, 200));
  }
  state.promptActive = true;
  let accepted = false;
  try {
    accepted = await showModal({
      title: "새 업데이트가 있습니다",
      message: `${version} 버전을 설치할 수 있습니다. 지금 설치하면 앱이 다시 실행됩니다. 작업 중이라면 나중에 설치해도 됩니다.`,
      acceptText: "업데이트 설치",
      cancelText: "나중에",
    });
  } finally {
    state.promptActive = false;
  }
  if (accepted) await installAvailableUpdate();
}

async function installAvailableUpdate() {
  if (state.updateInstalling || !state.availableUpdateVersion) return;
  state.updateInstalling = true;
  elements.checkUpdate.disabled = true;
  renderAvailableUpdate(state.availableUpdateVersion);
  setLocalizedText(elements.updateStatus, `${state.availableUpdateVersion} 업데이트를 다운로드하고 있습니다...`);
  try {
    await invoke("update_install");
    setLocalizedText(elements.updateStatus, "업데이트 설치를 시작했습니다. 앱이 곧 다시 실행됩니다.");
  } catch (error) {
    setLocalizedText(elements.updateStatus, `업데이트 설치 실패: ${String(error)}`);
    elements.checkUpdate.disabled = false;
  } finally {
    state.updateInstalling = false;
    renderAvailableUpdate(state.availableUpdateVersion);
  }
}

function formatMegabytes(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)}MB`;
}

function formatStorageSize(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)}GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)}MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${value}B`;
}

function renderLocalResourceGuidance() {
  if (!elements.localResourceGuidance) return;
  const language = currentUiLanguage();
  const guidance = localModelResourceGuidance(state.config, state.systemMemory || {});
  elements.applyLowMemoryPreset.hidden = !guidance?.recommendLowMemoryPreset;

  if (!guidance) {
    elements.localResourceGuidance.dataset.state = "ready";
    elements.localResourceTitle.textContent = translateCopy(
      language,
      "로컬 모델을 선택하면 메모리 사용량을 안내합니다.",
    );
    elements.localResourceDetail.textContent = translateCopy(
      language,
      "외부 번역 서비스는 로컬 모델 메모리를 사용하지 않습니다.",
    );
    return;
  }

  elements.localResourceGuidance.dataset.state = guidance.state;
  const usageLabel = guidance.usageKind === "ram"
    ? "예상 RAM 사용량"
    : "예상 VRAM 사용량";
  elements.localResourceTitle.textContent = `${translateCopy(language, usageLabel)} ${translateCopy(language, "약")} ${formatStorageSize(guidance.estimatedUsageBytes)}`;

  const resourceParts = [
    guidance.model,
    `${translateCopy(language, "모델 파일")} ${formatStorageSize(guidance.modelBytes)}`,
    translateCopy(
      language,
      guidance.usageKind === "ram"
        ? "CPU 실행 기준이며 환경에 따라 달라질 수 있습니다."
        : "GPU 실행 기준이며 환경에 따라 달라질 수 있습니다.",
    ),
  ];
  if (guidance.usageKind === "ram" && guidance.availableBytes > 0) {
    resourceParts.push(
      `${translateCopy(language, "현재 사용 가능")} ${formatStorageSize(guidance.availableBytes)}`,
    );
  }
  if (guidance.state === "warning") {
    resourceParts.push(translateCopy(language, "현재 여유 RAM이 예상 사용량보다 적습니다."));
  }
  elements.localResourceDetail.textContent = resourceParts.join(" · ");
}

async function loadSystemMemoryStatus() {
  state.systemMemory = await invoke("system_memory_status_get");
  renderLocalResourceGuidance();
}

async function applyLowMemoryPreset() {
  elements.applyLowMemoryPreset.disabled = true;
  try {
    const patch = {
      translator: "hymt_1_8b",
      hymt_device: "cpu",
      keep_local_model_warm: false,
    };
    if (LOCAL_TRANSLATORS.has(state.config.outgoing_translator)) {
      patch.outgoing_translator = "hymt_1_8b";
    }
    await applySettingsPatch(patch);
    setLocalizedText(elements.saveStatus, "저사양 권장 설정을 적용했습니다.");
  } finally {
    elements.applyLowMemoryPreset.disabled = false;
    renderLocalResourceGuidance();
  }
}

function renderStorageStatus() {
  if (!state.storageStatus || !elements.localModelStorageList) return;
  const language = currentUiLanguage();
  const selected = new Set([state.config.translator, state.config.outgoing_translator]);
  elements.localModelStorageList.replaceChildren();
  for (const model of state.storageStatus.models || []) {
    const row = document.createElement("article");
    row.className = "storage-model-row";
    row.dataset.modelId = model.id;
    const copy = document.createElement("div");
    const title = document.createElement("h3");
    const detail = document.createElement("p");
    const action = document.createElement("button");
    title.textContent = model.label;
    const display = localModelStorageDisplay(model, state.runtime?.modelProgress);
    if (display.state === "bundled") {
      detail.textContent = `${translateCopy(language, "앱에 포함됨")} · ${formatStorageSize(model.expectedBytes)}`;
    } else if (display.state === "downloading") {
      detail.textContent = `${translateCopy(language, "다운로드 중")} · ${formatStorageSize(display.currentBytes)} / ${formatStorageSize(display.totalBytes)}`;
    } else if (display.state === "verifying") {
      detail.textContent = `${translateCopy(language, "확인 중")} · ${formatStorageSize(display.totalBytes)}`;
    } else if (display.state === "loading") {
      detail.textContent = `${translateCopy(language, "준비 중")} · ${formatStorageSize(display.totalBytes)}`;
    } else if (display.state === "partial") {
      detail.textContent = `${translateCopy(language, "일부 다운로드됨")} · ${formatStorageSize(display.currentBytes)} / ${formatStorageSize(display.totalBytes)}`;
    } else if (display.state === "downloaded") {
      detail.textContent = `${translateCopy(language, "다운로드됨")} · ${formatStorageSize(display.currentBytes)}`;
    } else {
      detail.textContent = translateCopy(language, "설치되지 않음 · 필요할 때 자동으로 다운로드됩니다.");
    }
    copy.append(title, detail);
    action.type = "button";
    action.className = "button secondary storage-action";
    const inUse = selected.has(model.id);
    action.disabled = !model.deletable || inUse;
    action.textContent = translateCopy(
      language,
      inUse ? "사용 중" : model.deletable ? "삭제" : model.bundled ? "앱 포함" : "미설치",
    );
    if (model.deletable && !inUse) {
      action.addEventListener("click", () => {
        deleteLocalModel(model).catch(error => showError("로컬 모델을 삭제하지 못했습니다", String(error)));
      });
    }
    row.append(copy, action);
    elements.localModelStorageList.append(row);
  }
  const cache = state.storageStatus.cache || {};
  const recordCount = Number(cache.translationRecords || 0) + Number(cache.outgoingOriginalRecords || 0);
  elements.translationCacheSummary.textContent = `${translateCopy(language, "정리 가능한 기록")} ${recordCount}${translateCopy(language, "건")} · ${formatStorageSize(cache.databaseBytes)}`;
  elements.clearTranslationCache.disabled = recordCount === 0;
}

async function loadStorageStatus() {
  state.storageStatus = await invoke("storage_status_get");
  renderStorageStatus();
}

async function openLocalModelFolder() {
  elements.openLocalModelFolder.disabled = true;
  elements.openLocalModelFolder.setAttribute("aria-busy", "true");
  setLocalizedText(elements.openLocalModelFolder, "여는 중");
  try {
    await invoke("local_model_storage_folder_open");
    setLocalizedText(elements.saveStatus, "로컬 모델 데이터 폴더를 열었습니다.");
  } finally {
    elements.openLocalModelFolder.disabled = false;
    elements.openLocalModelFolder.removeAttribute("aria-busy");
    setLocalizedText(elements.openLocalModelFolder, "폴더 열기");
  }
}

async function deleteLocalModel(model) {
  const confirmed = await showModal({
    title: "로컬 모델 삭제",
    message: `${model.label}\n${translateCopy(currentUiLanguage(), "다운로드 파일을 삭제합니다. 이 모델을 다시 선택하면 파일을 다시 다운로드합니다.")}`,
    acceptText: "삭제",
    cancelText: "취소",
  });
  if (!confirmed) return;
  const result = await invoke("local_model_delete", { modelId: model.id });
  await loadStorageStatus();
  setLocalizedText(elements.saveStatus, `로컬 모델 파일 ${formatStorageSize(result.removedBytes)}를 삭제했습니다.`);
}

async function clearTranslationCache() {
  const confirmed = await showModal({
    title: "번역 기록 정리",
    message: "저장된 번역 결과와 보낸 메시지 원문을 삭제합니다. 설정, 채널별 언어 및 번역 서비스 인증 정보는 유지됩니다.",
    acceptText: "기록 정리",
    cancelText: "취소",
  });
  if (!confirmed) return;
  elements.clearTranslationCache.disabled = true;
  try {
    const result = await invoke("translation_cache_clear");
    await loadStorageStatus();
    setLocalizedText(elements.saveStatus, `번역 기록 ${result.removedRecords}건을 정리했습니다.`);
  } finally {
    renderStorageStatus();
  }
}

async function resetSettings() {
  const confirmed = await showModal({
    title: "설정 초기화",
    message: "앱 설정과 단축키를 기본값으로 초기화합니다. 번역 기록, 다운로드한 모델 및 번역 서비스 인증 정보는 유지됩니다.",
    acceptText: "초기화",
    cancelText: "취소",
  });
  if (!confirmed) return;
  elements.resetSettings.disabled = true;
  try {
    await waitForSettingsUpdates();
    setLocalizedText(elements.saveStatus, "초기화 중");
    const reset = await invoke("settings_reset");
    if (state.autostartEnabled) await setAutostartEnabled(false);
    renderConfig(reset);
    document.querySelectorAll(".provider-secret").forEach(secret => { secret.value = ""; });
    setLocalizedText(elements.saveStatus, "설정을 초기화했습니다.");
  } finally {
    elements.resetSettings.disabled = false;
  }
}

async function loadAppInformation() {
  if (tauriGetVersion) {
    try {
      elements.appVersion.textContent = (await tauriGetVersion()).replace(/-beta$/i, " Beta");
    } catch {
      // The build-time version in the markup remains as a safe fallback.
    }
  }
  await checkForUpdates(true);
}

function setSwitch(button, checked, onLabel, offLabel) {
  button.setAttribute("aria-checked", String(Boolean(checked)));
  const language = state.selectValues.ui_language || state.config.ui_language;
  button.querySelector("b").textContent = translateCopy(language, checked ? onLabel : offLabel);
}

function currentUiLanguage() {
  return state.selectValues.ui_language || state.config.ui_language;
}

function setLocalizedText(element, korean) {
  if (!element) return;
  localizedErrors.delete(element);
  localizedBackendText.delete(element);
  localizedText.set(element, String(korean ?? ""));
  element.textContent = translateDynamicCopy(currentUiLanguage(), korean);
}

function renderAutostart() {
  setSwitch(elements.autostart, state.autostartEnabled, "켜짐", "꺼짐");
  const unavailable = !tauriInvoke;
  elements.autostart.disabled = unavailable || state.autostartLoading;
  elements.autostart.setAttribute("aria-busy", String(state.autostartLoading));
}

async function loadAutostartState() {
  if (!tauriInvoke) {
    state.autostartEnabled = false;
    renderAutostart();
    return;
  }
  state.autostartEnabled = Boolean(await invoke("autostart_get"));
  renderAutostart();
}

async function setAutostartEnabled(enabled) {
  if (!tauriInvoke) {
    throw new Error("Tauri 앱에서만 사용할 수 있는 기능입니다.");
  }
  state.autostartLoading = true;
  renderAutostart();
  try {
    state.autostartEnabled = Boolean(await invoke("autostart_set", { enabled }));
  } finally {
    state.autostartLoading = false;
    renderAutostart();
  }
}

function setLocalizedError(element, error) {
  if (!element) return;
  localizedText.delete(element);
  localizedBackendText.delete(element);
  localizedErrors.set(element, String(error ?? ""));
  element.textContent = translateUserFacingError(currentUiLanguage(), error);
}

function translateBackendText(language, value) {
  const source = String(value ?? "");
  const translated = translateDynamicCopy(language, source);
  if (translated !== source || !/[가-힣]/.test(source)) return translated;
  return translateUserFacingError(language, source);
}

function setLocalizedBackendText(element, value) {
  if (!element) return;
  localizedText.delete(element);
  localizedErrors.delete(element);
  localizedBackendText.set(element, String(value ?? ""));
  element.textContent = translateBackendText(currentUiLanguage(), value);
}

function applyUiLanguage(language) {
  applyStaticTranslations(document, language);
  for (const [element, korean] of localizedText) {
    element.textContent = translateDynamicCopy(language, korean);
  }
  for (const [element, error] of localizedErrors) {
    element.textContent = translateUserFacingError(language, error);
  }
  for (const [element, value] of localizedBackendText) {
    element.textContent = translateBackendText(language, value);
  }
  renderAutostart();
  renderStorageStatus();
  renderLocalResourceGuidance();
  window.requestAnimationFrame(updateScrollIndicator);
}

function applyTheme(theme) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
  const resolvedTheme = theme === "system"
    ? (systemThemeQuery.matches ? "dark" : "light")
    : theme;
  invoke("main_window_set_theme", { theme, resolvedTheme }).catch(() => {
    // 웹 테마는 이미 적용되었으므로 네이티브 제목 표시줄 실패만 무시합니다.
  });
}

systemThemeQuery.addEventListener("change", () => {
  const selectedTheme = state.selectValues.ui_theme || state.config.ui_theme;
  if (selectedTheme === "system") applyTheme("system");
});

window.addEventListener("languagechange", () => {
  const selectedLanguage = state.selectValues.ui_language || state.config.ui_language;
  if (selectedLanguage === "auto") applyUiLanguage("auto");
});

function openSelect(element) {
  const trigger = element.querySelector(".select-trigger");
  const menu = element.querySelector(".select-menu");
  element.classList.remove("drop-up");
  element.classList.add("open");
  trigger.setAttribute("aria-expanded", "true");

  const viewportBounds = elements.settingsScroll.getBoundingClientRect();
  const triggerBounds = trigger.getBoundingClientRect();
  const menuHeight = menu.getBoundingClientRect().height;
  const spaceBelow = viewportBounds.bottom - triggerBounds.bottom - 8;
  const spaceAbove = triggerBounds.top - viewportBounds.top - 8;
  if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
    element.classList.add("drop-up");
  }
  const searchInput = element.querySelector(".select-search-input");
  if (searchInput) {
    searchInput.value = "";
    searchInput.dispatchEvent(new Event("input"));
    searchInput.focus();
  }
}

function renderSelect(element) {
  const field = element.dataset.field;
  const languageField = ["target_language", "outgoing_target_language", "ui_language"].includes(field);
  const trigger = document.createElement("button");
  const triggerLabel = document.createElement("span");
  const menu = document.createElement("div");
  trigger.type = "button";
  trigger.className = "select-trigger";
  trigger.dir = "ltr";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  triggerLabel.className = "select-trigger-label";
  triggerLabel.dir = languageField ? "auto" : "ltr";
  trigger.append(triggerLabel);
  menu.className = "select-menu";
  element.append(trigger, menu);

  let optionContainer = menu;
  let searchEmpty = null;
  if (languageField) {
    const search = document.createElement("div");
    const searchInput = document.createElement("input");
    optionContainer = document.createElement("div");
    searchEmpty = document.createElement("div");
    search.className = "select-search";
    searchInput.className = "select-search-input";
    searchInput.type = "search";
    searchInput.autocomplete = "off";
    searchInput.spellcheck = false;
    searchInput.placeholder = translateCopy(currentUiLanguage(), "언어 검색");
    searchInput.setAttribute("aria-label", translateCopy(currentUiLanguage(), "언어 검색"));
    searchInput.dataset.i18nPlaceholder = "언어 검색";
    searchInput.dataset.i18nAriaLabel = "언어 검색";
    optionContainer.className = "select-options";
    optionContainer.setAttribute("role", "listbox");
    searchEmpty.className = "select-search-empty";
    searchEmpty.textContent = translateCopy(currentUiLanguage(), "검색 결과 없음");
    searchEmpty.dataset.i18nKey = "검색 결과 없음";
    searchEmpty.hidden = true;
    search.append(searchInput);
    menu.append(search, optionContainer, searchEmpty);

    searchInput.addEventListener("input", () => {
      const matches = new Set(filterLanguageOptions(OPTIONS[field], searchInput.value).map(([value]) => String(value)));
      for (const option of optionContainer.querySelectorAll(".select-option")) {
        option.hidden = !matches.has(option.dataset.value);
      }
      searchEmpty.hidden = matches.size > 0;
    });
    searchInput.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSelect(element);
        trigger.focus();
        return;
      }
      if (event.key !== "ArrowDown") return;
      const first = optionContainer.querySelector(".select-option:not([hidden])");
      if (first) {
        event.preventDefault();
        first.focus();
      }
    });
  } else {
    menu.setAttribute("role", "listbox");
  }

  let previousGroup = "";
  for (const [value, label, group] of OPTIONS[field]) {
    if (!languageField && group && group !== previousGroup) {
      const groupLabel = document.createElement("span");
      groupLabel.className = "select-group-label";
      groupLabel.dataset.i18nKey = SELECT_GROUP_LABELS[group];
      groupLabel.textContent = translateCopy(currentUiLanguage(), SELECT_GROUP_LABELS[group]);
      optionContainer.append(groupLabel);
      previousGroup = group;
    }
    const option = document.createElement("button");
    option.type = "button";
    option.className = "select-option";
    option.dataset.value = value;
    option.dataset.i18nKey = label;
    option.textContent = translateCopy(currentUiLanguage(), label);
    if (languageField) option.dir = "auto";
    option.setAttribute("role", "option");
    option.addEventListener("click", async () => {
      const previous = state.selectValues[field];
      if (previous === value) {
        closeSelect(element);
        trigger.focus();
        return;
      }
      setSelectValue(field, value);
      closeSelect(element);
      trigger.focus();
      if (field === "ui_theme") applyTheme(value);
      if (field === "ui_language") applyUiLanguage(value);
      try {
        if (["translator", "outgoing_translator"].includes(field) && EXTERNAL_PROVIDERS.has(value) && !providerIsConnected(value)) {
          if (value === "deepl") await savePendingProviderCredentials();
          if (!providerIsConnected(value)) {
            setLocalizedText(elements.saveStatus, "선택한 외부 번역 서비스를 먼저 연결하십시오.");
            revealProviderConnection(value);
            throw new Error("선택한 외부 번역 서비스를 먼저 연결하십시오.");
          }
        }
        await applySettingsPatch({ [field]: value });
        if (field === "translation_history_retention_days") {
          window.setTimeout(() => loadStorageStatus().catch(() => {}), 250);
        }
      } catch (error) {
        setSelectValue(field, previous);
        if (field === "ui_theme") applyTheme(previous);
        if (field === "ui_language") applyUiLanguage(previous);
        await showError("설정을 적용하지 못했습니다", String(error));
      }
    });
    optionContainer.append(option);
  }

  trigger.addEventListener("click", () => {
    const opening = !element.classList.contains("open");
    closeAllSelects();
    if (opening) {
      openSelect(element);
    }
  });
  trigger.addEventListener("keydown", event => {
    if (!["ArrowDown", "ArrowUp", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") {
      closeSelect(element);
      return;
    }
    openSelect(element);
    const options = [...menu.querySelectorAll(".select-option")];
    const current = options.findIndex(option => option.dataset.value === String(state.selectValues[field]));
    const next = event.key === "ArrowDown"
      ? (current + 1) % options.length
      : (current - 1 + options.length) % options.length;
    options[next].focus();
  });
}

function setSelectValue(field, value) {
  state.selectValues[field] = value;
  const element = document.querySelector(`.custom-select[data-field="${field}"]`);
  const label = OPTIONS[field].find(item => item[0] === value)?.[1] || value;
  const trigger = element.querySelector(".select-trigger");
  trigger.querySelector(".select-trigger-label").textContent = translateCopy(currentUiLanguage(), label);
  for (const option of element.querySelectorAll(".select-option")) {
    option.setAttribute("aria-selected", String(option.dataset.value === String(value)));
  }
  if (field === "outgoing_translator") renderOutgoingModelGuidance();
}

function closeSelect(element) {
  element.classList.remove("open", "drop-up");
  element.querySelector(".select-trigger").setAttribute("aria-expanded", "false");
}

function closeAllSelects() {
  document.querySelectorAll(".custom-select.open").forEach(closeSelect);
}

function renderConfig(config) {
  state.config = normalizeConfig(config);
  for (const field of Object.keys(OPTIONS)) setSelectValue(field, state.config[field]);
  elements.outgoingAutoHelp.hidden = state.config.outgoing_target_language !== "auto";
  setSwitch(elements.enabled, state.config.enabled, "켜짐", "꺼짐");
  setSwitch(
    elements.outgoingTranslation,
    state.config.outgoing_translation_enabled,
    "켜짐",
    "꺼짐",
  );
  setSwitch(
    elements.outgoingConfirmSend,
    state.config.outgoing_confirm_send,
    "확인",
    "즉시",
  );
  setSwitch(elements.keepWarm, state.config.keep_local_model_warm, "켜짐", "꺼짐");
  elements.captureFps.value = state.config.capture_fps;
  elements.shortcut.value = state.config.hotkeys.toggle_translation;
  elements.outgoingShortcut.value = state.config.hotkeys.toggle_outgoing_translation;
  elements.translationShortcutHint.textContent = state.config.hotkeys.toggle_translation;
  elements.outgoingShortcutHint.textContent = state.config.hotkeys.toggle_outgoing_translation;
  elements.sendImmediatelyShortcut.value = state.config.hotkeys.send_outgoing_immediately;
  elements.reviewBeforeSendShortcut.value = state.config.hotkeys.review_outgoing_before_send;
  applyTheme(state.config.ui_theme);
  applyUiLanguage(state.config.ui_language);
}

async function applySettingsPatch(patch, { status = true } = {}) {
  const revision = ++state.settingsApplyRevision;
  state.settingsUpdatesPending += 1;
  if (status) setLocalizedText(elements.saveStatus, "적용 중");
  const update = state.settingsUpdateQueue.then(() => invoke("settings_update", { patch }));
  state.settingsUpdateQueue = update.then(() => undefined, () => undefined);
  try {
    const updated = normalizeConfig(await update);
    state.config = updated;
    if (revision === state.settingsApplyRevision) {
      renderConfig(updated);
      if (status) setLocalizedText(elements.saveStatus, "적용되었습니다.");
    }
    return updated;
  } catch (error) {
    if (revision === state.settingsApplyRevision) {
      const current = await invoke("settings_get").catch(() => null);
      if (current) renderConfig(current);
    }
    throw error;
  } finally {
    state.settingsUpdatesPending = Math.max(0, state.settingsUpdatesPending - 1);
  }
}

function captureFpsValue() {
  const value = Math.max(2, Math.min(20, Number(elements.captureFps.value) || 8));
  elements.captureFps.value = String(value);
  return value;
}

async function applyCaptureFps() {
  window.clearTimeout(state.captureFpsTimer);
  state.captureFpsTimer = 0;
  const value = captureFpsValue();
  if (value === state.config.capture_fps) return;
  try {
    await applySettingsPatch({ capture_fps: value });
  } catch (error) {
    elements.captureFps.value = String(state.config.capture_fps);
    await showError("화면 확인 빈도를 적용하지 못했습니다", String(error));
  }
}

function scheduleCaptureFpsUpdate() {
  window.clearTimeout(state.captureFpsTimer);
  state.captureFpsTimer = window.setTimeout(() => {
    applyCaptureFps();
  }, 180);
}

async function waitForSettingsUpdates() {
  if (state.captureFpsTimer) await applyCaptureFps();
  await state.settingsUpdateQueue;
}

async function ensureRestartConsent() {
  if (state.config.discord_auto_restart_consent_granted) return true;
  const confirmed = await showModal({
    title: "Discord 자동 재시작을 허용하시겠습니까?",
    message:
      "실시간 번역을 켜면 Discord가 디버그 렌더러 모드로 실행되지 않았을 때 15초 안내 후 자동으로 다시 시작합니다.\n\n재시작하면 작성 중인 메시지가 사라지거나 통화가 종료될 수 있습니다.",
    acceptText: "동의하고 켜기",
  });
  if (!confirmed) return false;
  state.config = normalizeConfig(
    await invoke("settings_update", {
      patch: { discord_auto_restart_consent_granted: true },
    }),
  );
  return true;
}

async function setTranslationEnabled(enabled, userInitiated = true) {
  if (enabled && !(await ensureRestartConsent())) return;
  if (enabled && userInitiated) state.restartAttempted = false;
  const previous = state.config.enabled;
  state.pendingEnabled = enabled;
  state.config.enabled = enabled;
  setSwitch(elements.enabled, enabled, "켜짐", "꺼짐");
  try {
    const status = await invoke("translation_set_enabled", { enabled });
    state.runtime = status;
    updateEngineState(status);
  } catch (error) {
    state.pendingEnabled = null;
    state.config.enabled = previous;
    setSwitch(elements.enabled, previous, "켜짐", "꺼짐");
    throw error;
  }
}

async function toggleTranslation() {
  if (state.repairActive || state.toggleActive) return;
  state.toggleActive = true;
  try {
    await setTranslationEnabled(!state.config.enabled, true);
  } catch (error) {
    await showError("번역 상태를 변경하지 못했습니다", String(error));
  } finally {
    state.toggleActive = false;
  }
}

async function setOutgoingTranslationEnabled(enabled) {
  if (enabled && !(await ensureRestartConsent())) return;
  if (enabled) state.restartAttempted = false;
  const previous = state.config.outgoing_translation_enabled;
  state.config.outgoing_translation_enabled = enabled;
  setSwitch(elements.outgoingTranslation, enabled, "켜짐", "꺼짐");
  try {
    const updated = await applySettingsPatch(
      { outgoing_translation_enabled: enabled },
      { status: false },
    );
    state.config = normalizeConfig(updated);
    setLocalizedText(elements.saveStatus, "적용되었습니다.");
  } catch (error) {
    state.config.outgoing_translation_enabled = previous;
    setSwitch(elements.outgoingTranslation, previous, "켜짐", "꺼짐");
    throw error;
  }
}

async function toggleOutgoingTranslation() {
  if (state.repairActive || state.outgoingToggleActive) return;
  state.outgoingToggleActive = true;
  try {
    await setOutgoingTranslationEnabled(!state.config.outgoing_translation_enabled);
  } catch (error) {
    await showError("전송 메시지 통역 상태를 변경하지 못했습니다", String(error));
  } finally {
    state.outgoingToggleActive = false;
  }
}

async function disableTranslationFeaturesForConnectionFailure() {
  if (state.config.enabled) await setTranslationEnabled(false, false);
  if (state.config.outgoing_translation_enabled) {
    const updated = await invoke("settings_update", {
      patch: { outgoing_translation_enabled: false },
    });
    renderConfig(updated);
  }
}

function updateEngineState(status) {
  if (!status) return;
  renderModelPreparation(status.modelProgress);
  renderStorageStatus();
  const ready = status.cdpConnected;
  const enabledState = resolveEnabledState(status.enabled, state.pendingEnabled);
  state.pendingEnabled = enabledState.pending;
  const language = state.selectValues.ui_language || state.config.ui_language;
  const modelLabel = localizeRuntimeLabel(translatorRuntimeLabel(status), language);
  const hasError = Boolean(status.connectionIssue || status.translatorError);
  elements.engineState.dataset.state = ready && !hasError ? "ready" : hasError ? "error" : "loading";
  const connectionLabel = translateCopy(language, discordConnectionLabel(status));
  elements.engineStateLabel.textContent = ready && modelLabel
    ? `${connectionLabel} · ${modelLabel}`
    : connectionLabel;
  state.config.enabled = enabledState.enabled;
  setSwitch(elements.enabled, state.config.enabled, "켜짐", "꺼짐");
  if (status.notice) setLocalizedBackendText(elements.saveStatus, status.notice);
}

function localizeRuntimeLabel(label, language) {
  if (!label || language === "ko") return label;
  for (const suffix of ["준비 중", "사용 중", "준비 실패"]) {
    if (label.endsWith(suffix)) {
      const runtimeName = label.slice(0, -suffix.length).trim();
      return `${translateCopy(language, runtimeName)} ${translateCopy(language, suffix)}`;
    }
  }
  return translateCopy(language, label);
}

async function pollRuntime() {
  if (state.polling) return;
  state.polling = true;
  try {
    const status = await invoke("runtime_status");
    state.runtime = status;
    updateEngineState(status);
    if (shouldPromptRestart(status, state)) await handleRestartRequired(status);
  } catch (error) {
    elements.engineState.dataset.state = "error";
    setLocalizedText(elements.engineStateLabel, "엔진 연결 실패");
    setLocalizedError(elements.saveStatus, error);
  } finally {
    state.polling = false;
  }
}

async function handleRestartRequired(status) {
  state.promptActive = true;
  try {
    if (!(await ensureRestartConsent())) {
      await disableTranslationFeaturesForConnectionFailure();
      return;
    }
    if (state.restartAttempted) {
      await disableTranslationFeaturesForConnectionFailure();
      await showError(
        "Discord 연결 실패",
        "이번 번역 실행에서 자동 재시작을 이미 한 번 시도했습니다. Discord를 직접 종료한 후 다시 실행하십시오.",
      );
      return;
    }
    const confirmed = await showModal({
      title: "Discord 번역 연결을 준비합니다",
      message: restartCountdownMessage(15),
      acceptText: "지금 재시작",
      autoSeconds: 15,
      autoMessage: restartCountdownMessage,
    });
    if (!confirmed) {
      await disableTranslationFeaturesForConnectionFailure();
      return;
    }
    if (state.runtime?.cdpConnected) return;
    state.restartAttempted = true;
    state.repairActive = true;
    elements.engineState.dataset.state = "loading";
    setLocalizedText(elements.engineStateLabel, "Discord 재시작 중");
    await invoke("discord_restart", {
      expectedProcessId: status.discordProcessId,
    });
    setSwitch(elements.enabled, state.config.enabled, "켜짐", "꺼짐");
  } catch (error) {
    try {
      await disableTranslationFeaturesForConnectionFailure();
    } catch {
      state.config.enabled = false;
    }
    await showError("Discord 자동 재시작 실패", String(error));
  } finally {
    state.repairActive = false;
    state.promptActive = false;
  }
}

function showModal({
  title,
  message,
  acceptText,
  cancelText = "취소",
  autoSeconds = 0,
  autoMessage = null,
  cancelVisible = true,
  variant = "",
}) {
  elements.modalTitle.textContent = translateDynamicCopy(currentUiLanguage(), title);
  elements.modalMessage.textContent = translateDynamicCopy(currentUiLanguage(), message);
  elements.modalAccept.textContent = translateDynamicCopy(currentUiLanguage(), acceptText);
  elements.modalCancel.textContent = translateDynamicCopy(currentUiLanguage(), cancelText);
  elements.modalCancel.hidden = !cancelVisible;
  if (variant) elements.modalLayer.dataset.variant = variant;
  else delete elements.modalLayer.dataset.variant;
  elements.modalLayer.hidden = false;
  return new Promise(resolve => {
    let remaining = autoSeconds;
    let timer = 0;
    const finish = value => {
      window.clearInterval(timer);
      elements.modalLayer.hidden = true;
      delete elements.modalLayer.dataset.variant;
      elements.modalCancel.removeEventListener("click", cancel);
      elements.modalAccept.removeEventListener("click", accept);
      resolve(value);
    };
    const cancel = () => finish(false);
    const accept = () => finish(true);
    elements.modalCancel.addEventListener("click", cancel);
    elements.modalAccept.addEventListener("click", accept);
    if (remaining > 0) {
      timer = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) finish(true);
        else if (autoMessage) {
          elements.modalMessage.textContent = translateDynamicCopy(
            currentUiLanguage(),
            autoMessage(remaining),
          );
        }
      }, 1000);
    }
    (cancelVisible ? elements.modalCancel : elements.modalAccept).focus();
  });
}

async function showError(title, message) {
  writeDiagnostic("error", `${title}: ${message}`);
  await showModal({
    title,
    message: translateUserFacingError(currentUiLanguage(), message),
    acceptText: "확인",
    cancelVisible: false,
  });
}

async function loadSettings() {
  try {
    const config = await invoke("settings_get");
    renderConfig(config);
    setLocalizedText(elements.saveStatus, "변경 사항은 즉시 적용됩니다.");
  } catch (error) {
    setLocalizedError(elements.saveStatus, error);
    elements.engineState.dataset.state = "error";
    setLocalizedText(elements.engineStateLabel, "엔진 연결 실패");
  }
}

function waitForStableUiFrame() {
  return new Promise(resolve => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  });
}

async function initializeSettingsUi() {
  await loadSettings();
  try {
    await loadAutostartState();
  } catch (error) {
    state.autostartEnabled = false;
    renderAutostart();
    writeDiagnostic("warn", `autostart-state: ${String(error)}`);
  }
  await waitForStableUiFrame();
  await invoke("engine_ui_ready");
}

document.querySelectorAll(".custom-select").forEach(renderSelect);
document.addEventListener("click", event => {
  if (!event.target.closest(".custom-select")) closeAllSelects();
});
elements.enabled.addEventListener("click", toggleTranslation);
elements.outgoingTranslation.addEventListener("click", async () => {
  const enabled = elements.outgoingTranslation.getAttribute("aria-checked") !== "true";
  try {
    await setOutgoingTranslationEnabled(enabled);
  } catch (error) {
    await showError("전송 메시지 통역 상태를 변경하지 못했습니다", String(error));
  }
});
elements.outgoingConfirmSend.addEventListener("click", () => {
  const enabled = elements.outgoingConfirmSend.getAttribute("aria-checked") !== "true";
  setSwitch(elements.outgoingConfirmSend, enabled, "확인", "즉시");
  applySettingsPatch({ outgoing_confirm_send: enabled }).catch(async error => {
    setSwitch(elements.outgoingConfirmSend, !enabled, "확인", "즉시");
    await showError("전송 전 확인 설정을 적용하지 못했습니다", String(error));
  });
});
elements.keepWarm.addEventListener("click", () => {
  const enabled = elements.keepWarm.getAttribute("aria-checked") !== "true";
  setSwitch(elements.keepWarm, enabled, "켜짐", "꺼짐");
  applySettingsPatch({ keep_local_model_warm: enabled }).catch(async error => {
    setSwitch(elements.keepWarm, !enabled, "켜짐", "꺼짐");
    await showError("로컬 모델 예열 설정을 적용하지 못했습니다", String(error));
  });
});
elements.captureFps.addEventListener("wheel", event => event.preventDefault(), { passive: false });
elements.captureFps.addEventListener("input", scheduleCaptureFpsUpdate);
elements.captureFps.addEventListener("change", applyCaptureFps);

async function applyShortcutImmediately(element, configKey, shortcut, help, fallback) {
  const previous = state.config.hotkeys[configKey] || fallback;
  const hotkeys = {
    toggle_translation: elements.shortcut.value.trim() || "F12",
    toggle_outgoing_translation: elements.outgoingShortcut.value.trim() || "F8",
    send_outgoing_immediately: elements.sendImmediatelyShortcut.value.trim() || "Ctrl+Enter",
    review_outgoing_before_send: elements.reviewBeforeSendShortcut.value.trim() || "Alt+Enter",
    [configKey]: shortcut,
  };
  try {
    await applySettingsPatch({ hotkeys });
    setLocalizedText(help, `${shortcut}로 적용되었습니다.`);
  } catch (error) {
    element.value = previous;
    setLocalizedText(help, "단축키를 적용하지 못했습니다.");
    await showError("단축키를 적용하지 못했습니다", String(error));
  }
}

function bindShortcutEditor(element, configKey, helpId, fallback) {
  const help = document.querySelector(`#${helpId}`);
  element.addEventListener("keydown", async event => {
    if (event.key === "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      element.value = state.config.hotkeys[configKey] || fallback;
      element.blur();
      return;
    }
    const shortcut = shortcutFromKeyboardEvent(event);
    if (!shortcut) {
      setLocalizedText(help, "F1~F24 또는 Ctrl·Alt·Shift와 일반 키를 함께 입력하십시오.");
      return;
    }
    element.value = shortcut;
    setLocalizedText(help, `${shortcut} 적용 중`);
    await applyShortcutImmediately(element, configKey, shortcut, help, fallback);
  });
  element.addEventListener("focus", () => {
    invoke("shortcut_capture_set_active", { active: true }).catch(() => {});
    setLocalizedText(help, "새 단축키 조합을 입력하십시오. Esc를 누르면 취소됩니다.");
  });
  element.addEventListener("blur", () => {
    invoke("shortcut_capture_set_active", { active: false }).catch(() => {});
    setLocalizedText(help, "입력란을 선택한 뒤 원하는 단축키를 누르십시오.");
  });
}

bindShortcutEditor(elements.shortcut, "toggle_translation", "shortcut-help", "F12");
bindShortcutEditor(
  elements.outgoingShortcut,
  "toggle_outgoing_translation",
  "outgoing-shortcut-help",
  "F8",
);
bindShortcutEditor(
  elements.sendImmediatelyShortcut,
  "send_outgoing_immediately",
  "send-immediately-shortcut-help",
  "Ctrl+Enter",
);
bindShortcutEditor(
  elements.reviewBeforeSendShortcut,
  "review_outgoing_before_send",
  "review-before-send-shortcut-help",
  "Alt+Enter",
);

for (const item of document.querySelectorAll("[data-settings-panel]")) {
  item.addEventListener("click", () => activateSettingsPanel(item.dataset.settingsPanel));
}
elements.authorLink.addEventListener("click", () => {
  openExternalUrl(APP_LINKS.author).catch(error => showError("링크를 열지 못했습니다", String(error)));
});
elements.githubLink.addEventListener("click", () => {
  openExternalUrl(APP_LINKS.repository).catch(error => showError("링크를 열지 못했습니다", String(error)));
});
elements.viewLicense.addEventListener("click", () => {
  showModal({
    title: "라이선스 및 제3자 고지",
    message: LICENSE_DOCUMENTS_TEXT,
    acceptText: "닫기",
    cancelVisible: false,
    variant: "license",
  });
});
for (const row of elements.providerRows) {
  row.querySelector(".provider-action")?.addEventListener("click", () => {
    connectProvider(row).catch(error => showError("번역 서비스를 연결하지 못했습니다", String(error)));
  });
  row.querySelector(".provider-disconnect")?.addEventListener("click", () => {
    disconnectProvider(row).catch(error => showError("연결을 해제하지 못했습니다", String(error)));
  });
}
elements.outgoingModelGuidanceAction.addEventListener("click", async () => {
  const provider = elements.outgoingModelGuidanceAction.dataset.provider;
  if (!provider) {
    revealProviderConnection("chatgpt");
    return;
  }
  elements.outgoingModelGuidanceAction.disabled = true;
  try {
    setSelectValue("outgoing_translator", provider);
    await applySettingsPatch({ outgoing_translator: provider });
  } catch (error) {
    await showError("권장 모델을 적용하지 못했습니다", String(error));
  } finally {
    renderOutgoingModelGuidance();
  }
});
for (const secret of document.querySelectorAll(".provider-secret")) {
  secret.addEventListener("change", () => {
    savePendingProviderCredentials()
      .then(() => setLocalizedText(elements.saveStatus, "적용되었습니다."))
      .catch(error => showError("API 키를 적용하지 못했습니다", String(error)));
  });
}
elements.checkUpdate.addEventListener("click", () => {
  checkForUpdates(false).catch(error => showError("업데이트를 확인하지 못했습니다", String(error)));
});
elements.updateBannerInstall.addEventListener("click", () => {
  installAvailableUpdate().catch(error => showError("업데이트를 설치하지 못했습니다", String(error)));
});
elements.modelBannerCancel.addEventListener("click", () => {
  cancelModelPreparation().catch(error => showError("오류", String(error)));
});
elements.openDiagnosticLog.addEventListener("click", () => {
  invoke("diagnostic_log_reveal").catch(error => showError("로그 파일을 열지 못했습니다", String(error)));
});
elements.autostart.addEventListener("click", async () => {
  const previous = state.autostartEnabled;
  try {
    await setAutostartEnabled(!previous);
  } catch (error) {
    state.autostartEnabled = previous;
    renderAutostart();
    await showError("자동 시작 설정을 변경하지 못했습니다", String(error));
  }
});
elements.clearTranslationCache.addEventListener("click", () => {
  clearTranslationCache().catch(error => showError("번역 기록을 정리하지 못했습니다", String(error)));
});
elements.openLocalModelFolder.addEventListener("click", () => {
  openLocalModelFolder().catch(error => showError("모델 폴더를 열지 못했습니다", String(error)));
});
elements.applyLowMemoryPreset.addEventListener("click", () => {
  applyLowMemoryPreset().catch(error => showError("저사양 권장 설정을 적용하지 못했습니다", String(error)));
});
elements.resetSettings.addEventListener("click", () => {
  resetSettings().catch(error => showError("설정을 초기화하지 못했습니다", String(error)));
});
elements.settingsScroll.addEventListener("scroll", () => {
  updateScrollIndicator();
  elements.settingsScrollRegion.classList.add("scrolling");
  window.clearTimeout(state.settingsScrollTimer);
  state.settingsScrollTimer = window.setTimeout(
    () => elements.settingsScrollRegion.classList.remove("scrolling"),
    550,
  );
}, { passive: true });
elements.form.addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await waitForSettingsUpdates();
    await savePendingProviderCredentials();
    const translator = state.selectValues.translator;
    if (EXTERNAL_PROVIDERS.has(translator) && !providerIsConnected(translator)) {
      revealProviderConnection(translator);
      throw new Error("선택한 외부 번역 서비스를 먼저 연결하십시오.");
    }
    await invoke("main_window_hide");
  } catch (error) {
    setLocalizedError(elements.saveStatus, error);
  }
});

if (tauriListen) {
  tauriListen("request-translation-toggle", toggleTranslation);
  tauriListen("request-outgoing-translation-toggle", toggleOutgoingTranslation);
  tauriListen("translation-state-changed", event => {
    state.runtime = event.payload;
    updateEngineState(event.payload);
  });
  tauriListen("settings-changed", event => {
    if (state.settingsUpdatesPending === 0) renderConfig(event.payload);
  });
  tauriListen("provider-connections-changed", loadProviderConnections);
  tauriListen("request-update-install", () => {
    installAvailableUpdate().catch(error => showError("업데이트를 설치하지 못했습니다", String(error)));
  });
  tauriListen("focus-provider-connection", event => {
    loadProviderConnections().finally(() => revealProviderConnection(event.payload));
  });
  tauriListen("update-download-progress", event => {
    const downloaded = formatMegabytes(event.payload?.downloaded);
    const total = event.payload?.total ? ` / ${formatMegabytes(event.payload.total)}` : "";
    setLocalizedText(elements.updateStatus, `업데이트 다운로드 중 ${downloaded}${total}`);
  });
  tauriListen("update-download-finished", () => {
    setLocalizedText(elements.updateStatus, "업데이트 서명을 확인하고 설치하고 있습니다...");
  });
}

bindOverlayScrollIndicator();
new ResizeObserver(updateScrollIndicator).observe(elements.settingsScroll);
window.requestAnimationFrame(updateScrollIndicator);
initializeSettingsUi().catch(error => {
  setLocalizedError(elements.saveStatus, error);
  elements.engineState.dataset.state = "error";
  setLocalizedText(elements.engineStateLabel, "엔진 연결 실패");
});
loadProviderConnections();
loadStorageStatus().catch(error => showError("저장 공간 정보를 확인하지 못했습니다", String(error)));
loadSystemMemoryStatus().catch(error => {
  writeDiagnostic("warn", `system-memory-status: ${String(error)}`);
  renderLocalResourceGuidance();
});
loadAppInformation();
window.setInterval(pollRuntime, 700);
