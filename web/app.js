import {
  discordConnectionLabel,
  normalizeConfig,
  resolveEnabledState,
  restartCountdownMessage,
  scrollThumbMetrics,
  shortcutFromKeyboardEvent,
  shouldPromptRestart,
  translatorRuntimeLabel,
} from "./state.mjs";
import { LICENSE_DOCUMENTS_TEXT } from "./license.mjs";

const tauriInvoke = window.__TAURI__?.core?.invoke;
const tauriListen = window.__TAURI__?.event?.listen;
const tauriGetVersion = window.__TAURI__?.app?.getVersion;
const tauriOpenUrl = window.__TAURI__?.opener?.openUrl;
const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
const SCROLL_INDICATOR_REVEAL_DISTANCE = 44;
const APP_LINKS = Object.freeze({
  author: "https://x.com/NudeNyang_VRC",
  repository: "https://github.com/NudeNyang/Nude-Translator",
});

const OPTIONS = {
  target_language: [
    ["ko", "한국어"],
    ["ja", "日本語"],
    ["en", "English"],
    ["zh", "简体中文"],
    ["zh-Hant", "繁體中文"],
  ],
  translator: [
    ["hymt_1_8b", "Hy-MT2 1.8B Q4 (로컬·기본)"],
    ["hymt_7b", "Hy-MT2 7B Q4 (로컬·품질 우선)"],
    ["chatgpt", "ChatGPT Plus/Pro (Codex CLI)"],
    ["claude", "Claude Pro/Max (Claude Code)"],
    ["gemini", "Gemini Pro/Ultra (Gemini CLI)"],
    ["deepl", "DeepL (API 키·외부 전송)"],
    ["mock", "Mock 테스트"],
  ],
  speech_style: [
    ["auto", "원문 말투 유지 (자동)"],
    ["polite", "항상 존댓말·격식체"],
    ["casual", "항상 반말·비격식체"],
  ],
  outgoing_target_language: [
    ["auto", "최근 대화에서 자동 감지"],
    ["ko", "한국어"],
    ["ja", "日本語"],
    ["en", "English"],
    ["zh", "简体中文"],
    ["zh-Hant", "繁體中文"],
  ],
  hymt_device: [
    ["auto", "자동 (GPU 우선, CPU 대체)"],
    ["cpu", "CPU"],
  ],
  ui_theme: [
    ["system", "시스템 설정 따르기"],
    ["light", "라이트"],
    ["dark", "다크"],
  ],
};

const state = {
  config: normalizeConfig(),
  saved: normalizeConfig(),
  runtime: null,
  selectValues: {},
  promptActive: false,
  repairActive: false,
  restartAttempted: false,
  polling: false,
  updateCheckActive: false,
  availableUpdateVersion: "",
  updateInstalling: false,
  settingsScrollTimer: 0,
  pendingEnabled: null,
  toggleActive: false,
  providerConnections: new Map(),
  providerLoading: false,
};

const elements = {
  form: document.querySelector("#settings-form"),
  enabled: document.querySelector("#enabled"),
  outgoingTranslation: document.querySelector("#outgoing-translation"),
  outgoingConfirmLanguage: document.querySelector("#outgoing-confirm-language"),
  keepWarm: document.querySelector("#keep-warm"),
  captureFps: document.querySelector("#capture-fps"),
  shortcut: document.querySelector("#toggle-shortcut"),
  cancel: document.querySelector("#cancel"),
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
  viewLicense: document.querySelector("#view-license"),
  providerRows: [...document.querySelectorAll(".provider-row")],
};

const EXTERNAL_PROVIDERS = new Set(["chatgpt", "claude", "gemini", "deepl"]);
const PROVIDER_LOGIN_COPY = Object.freeze({
  chatgpt: { name: "ChatGPT", account: "ChatGPT 계정" },
  claude: { name: "Claude", account: "Claude Pro/Max 계정" },
  gemini: { name: "Google", account: "Google 계정" },
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

function renderProviderConnections(connections) {
  state.providerConnections = new Map(connections.map(connection => [connection.id, connection]));
  for (const row of elements.providerRows) {
    const connection = providerConnection(row.dataset.provider);
    if (!connection) continue;
    const status = row.querySelector(".provider-status");
    const action = row.querySelector(".provider-action");
    const disconnect = row.querySelector(".provider-disconnect");
    status.dataset.state = connection.state;
    status.querySelector("strong").textContent = providerStateLabel(connection);
    status.querySelector("span").textContent = connection.detail;
    if (action) {
      action.hidden = connection.canDisconnect;
      action.disabled = connection.connected;
      action.textContent = connection.connected ? "연결됨" : connection.installed ? "연결" : "설치";
    }
    if (disconnect) disconnect.hidden = !connection.canDisconnect;
    const secret = row.querySelector(".provider-secret");
    if (secret) secret.placeholder = connection.connected ? "새 API 키 입력 시 변경" : "DeepL API 키";
  }
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
      status.querySelector("strong").textContent = "확인 실패";
      status.querySelector("span").textContent = String(error);
    }
  } finally {
    state.providerLoading = false;
  }
}

function revealProviderConnection(provider) {
  const row = document.querySelector(`.provider-row[data-provider="${provider}"]`);
  if (!row) return;
  row.dataset.highlight = "true";
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => delete row.dataset.highlight, 1800);
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
      action.textContent = "설치 중";
      status.dataset.state = "loading";
      status.querySelector("strong").textContent = "설치 중";
      status.querySelector("span").textContent = `${current.name} CLI와 필요한 실행 환경을 자동으로 설치하고 있습니다.`;
      current = await invoke("provider_install", { provider });
      state.providerConnections.set(provider, current);
      renderProviderConnections([...state.providerConnections.values()]);
    }

    action.disabled = true;
    action.textContent = provider === "deepl" ? "확인 중" : "로그인 중";
    status.dataset.state = "loading";
    status.querySelector("strong").textContent = provider === "deepl" ? "확인 중" : "로그인 중";
    status.querySelector("span").textContent = provider === "deepl"
      ? "DeepL API 키의 유효성을 확인하고 있습니다."
      : "계정 로그인 절차를 시작하고 있습니다.";
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
  elements.modalTitle.textContent = `${copy.name} 계정 연결`;
  elements.modalMessage.textContent = `${copy.name} 공식 로그인 페이지를 준비하고 있습니다. 잠시 기다리십시오.`;
  elements.modalCancel.textContent = "취소";
  elements.modalCancel.hidden = false;
  elements.modalCancel.disabled = false;
  elements.modalAccept.textContent = "이동";
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
    elements.modalCancel.textContent = "취소";
    elements.modalCancel.disabled = false;
    elements.modalAccept.disabled = false;
    elements.modalAccept.hidden = false;
  };
  const open = async () => {
    elements.modalAccept.disabled = true;
    try {
      const opened = await invoke("provider_login_open");
      if (!opened) {
        elements.modalMessage.textContent = "로그인 준비가 완료되지 않았습니다. 잠시 후 다시 시도하십시오.";
        elements.modalAccept.disabled = false;
        return;
      }
      elements.modalMessage.textContent = `브라우저에서 ${copy.account} 로그인을 완료하십시오.\n로그인이 완료되면 이 창이 자동으로 닫힙니다.`;
    } catch (error) {
      elements.modalMessage.textContent = `로그인 페이지를 열지 못했습니다. 잠시 후 다시 시도하십시오.\n${String(error)}`;
      elements.modalAccept.disabled = false;
    }
  };
  const cancel = async () => {
    if (cancelled) return;
    cancelled = true;
    elements.modalCancel.disabled = true;
    elements.modalCancel.textContent = "취소 중";
    elements.modalMessage.textContent = `${copy.name} 계정 로그인을 취소하고 있습니다.`;
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
      elements.modalMessage.textContent = `${copy.name} 공식 로그인 페이지로 이동하려면 이동을 선택하십시오.`;
      elements.modalAccept.disabled = false;
      elements.modalAccept.focus();
    });
  } else {
    elements.modalMessage.textContent = `${copy.name} 공식 로그인 페이지로 이동하려면 이동을 선택하십시오.`;
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

  elements.saveStatus.textContent = "DeepL API 키 확인 중";
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
      : "CLI 로그인 정보와 설치 상태는 유지되며 Nude Translator에서만 사용을 중지합니다. 해당 서비스가 선택되어 있으면 로컬 기본 모델로 전환합니다.",
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
  if (!silent) elements.updateStatus.textContent = "비공개 베타 업데이트를 확인하고 있습니다...";
  try {
    const result = await invoke("update_check");
    if (result.available) {
      state.availableUpdateVersion = result.version;
      elements.updateStatus.textContent = `새 버전 ${result.version}을 사용할 수 있습니다.`;
      elements.checkUpdate.textContent = "업데이트 설치";
    } else {
      state.availableUpdateVersion = "";
      elements.updateStatus.textContent = "현재 베타 버전이 최신입니다.";
      elements.checkUpdate.textContent = "지금 확인";
    }
  } catch (error) {
    if (!silent) elements.updateStatus.textContent = `업데이트 확인 실패: ${String(error)}`;
  } finally {
    state.updateCheckActive = false;
    elements.checkUpdate.disabled = false;
  }
}

async function installAvailableUpdate() {
  if (state.updateInstalling) return;
  state.updateInstalling = true;
  elements.checkUpdate.disabled = true;
  elements.updateStatus.textContent = `${state.availableUpdateVersion} 업데이트를 다운로드하고 있습니다...`;
  try {
    await invoke("update_install");
    elements.updateStatus.textContent = "업데이트 설치를 시작했습니다. 앱이 곧 다시 실행됩니다.";
  } catch (error) {
    elements.updateStatus.textContent = `업데이트 설치 실패: ${String(error)}`;
    elements.checkUpdate.disabled = false;
  } finally {
    state.updateInstalling = false;
  }
}

function formatMegabytes(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)}MB`;
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
  button.querySelector("b").textContent = checked ? onLabel : offLabel;
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

function renderSelect(element) {
  const field = element.dataset.field;
  const trigger = document.createElement("button");
  const menu = document.createElement("div");
  trigger.type = "button";
  trigger.className = "select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  menu.className = "select-menu";
  menu.setAttribute("role", "listbox");
  element.append(trigger, menu);

  for (const [value, label] of OPTIONS[field]) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "select-option";
    option.dataset.value = value;
    option.textContent = label;
    option.setAttribute("role", "option");
    option.addEventListener("click", () => {
      setSelectValue(field, value);
      closeSelect(element);
      trigger.focus();
      if (field === "ui_theme") applyTheme(value);
      if (field === "translator" && EXTERNAL_PROVIDERS.has(value) && !providerIsConnected(value)) {
        elements.saveStatus.textContent = "선택한 외부 번역 서비스를 먼저 연결하십시오.";
        revealProviderConnection(value);
      }
    });
    menu.append(option);
  }

  trigger.addEventListener("click", () => {
    const opening = !element.classList.contains("open");
    closeAllSelects();
    if (opening) {
      element.classList.add("open");
      trigger.setAttribute("aria-expanded", "true");
    }
  });
  trigger.addEventListener("keydown", event => {
    if (!["ArrowDown", "ArrowUp", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") {
      closeSelect(element);
      return;
    }
    element.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    const options = [...menu.querySelectorAll(".select-option")];
    const current = options.findIndex(option => option.dataset.value === state.selectValues[field]);
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
  element.querySelector(".select-trigger").textContent = label;
  for (const option of element.querySelectorAll(".select-option")) {
    option.setAttribute("aria-selected", String(option.dataset.value === value));
  }
}

function closeSelect(element) {
  element.classList.remove("open");
  element.querySelector(".select-trigger").setAttribute("aria-expanded", "false");
}

function closeAllSelects() {
  document.querySelectorAll(".custom-select.open").forEach(closeSelect);
}

function renderConfig(config) {
  state.config = normalizeConfig(config);
  state.saved = normalizeConfig(config);
  for (const field of Object.keys(OPTIONS)) setSelectValue(field, state.config[field]);
  setSwitch(elements.enabled, state.config.enabled, "켜짐", "꺼짐");
  setSwitch(
    elements.outgoingTranslation,
    state.config.outgoing_translation_enabled,
    "켜짐",
    "꺼짐",
  );
  setSwitch(
    elements.outgoingConfirmLanguage,
    state.config.outgoing_confirm_language,
    "확인",
    "자동 적용",
  );
  setSwitch(elements.keepWarm, state.config.keep_local_model_warm, "유지", "반환");
  elements.captureFps.value = state.config.capture_fps;
  elements.shortcut.value = state.config.hotkeys.toggle_translation;
  applyTheme(state.config.ui_theme);
}

function collectPatch() {
  return {
    target_language: state.selectValues.target_language,
    translator: state.selectValues.translator,
    speech_style: state.selectValues.speech_style,
    hymt_device: state.selectValues.hymt_device,
    ui_theme: state.selectValues.ui_theme,
    outgoing_translation_enabled:
      elements.outgoingTranslation.getAttribute("aria-checked") === "true",
    outgoing_target_language: state.selectValues.outgoing_target_language,
    outgoing_confirm_language:
      elements.outgoingConfirmLanguage.getAttribute("aria-checked") === "true",
    keep_local_model_warm: elements.keepWarm.getAttribute("aria-checked") === "true",
    capture_fps: Math.max(2, Math.min(20, Number(elements.captureFps.value) || 8)),
    hotkeys: { toggle_translation: elements.shortcut.value.trim() || "F12" },
  };
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
  state.saved = normalizeConfig(state.config);
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
    const updated = await invoke("settings_update", {
      patch: { outgoing_translation_enabled: enabled },
    });
    state.config = normalizeConfig(updated);
    state.saved = normalizeConfig(updated);
  } catch (error) {
    state.config.outgoing_translation_enabled = previous;
    setSwitch(elements.outgoingTranslation, previous, "켜짐", "꺼짐");
    throw error;
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
  const ready = status.cdpConnected;
  const enabledState = resolveEnabledState(status.enabled, state.pendingEnabled);
  state.pendingEnabled = enabledState.pending;
  const modelLabel = translatorRuntimeLabel(status);
  const hasError = Boolean(status.connectionIssue || status.translatorError);
  elements.engineState.dataset.state = ready && !hasError ? "ready" : hasError ? "error" : "loading";
  const connectionLabel = discordConnectionLabel(status);
  elements.engineStateLabel.textContent = ready && modelLabel
    ? `${connectionLabel} · ${modelLabel}`
    : connectionLabel;
  state.config.enabled = enabledState.enabled;
  setSwitch(elements.enabled, state.config.enabled, "켜짐", "꺼짐");
  if (status.notice) elements.saveStatus.textContent = status.notice;
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
    elements.engineStateLabel.textContent = "엔진 연결 실패";
    elements.saveStatus.textContent = String(error);
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
    elements.engineStateLabel.textContent = "Discord 재시작 중";
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
  autoSeconds = 0,
  autoMessage = null,
  cancelVisible = true,
  variant = "",
}) {
  elements.modalTitle.textContent = title;
  elements.modalMessage.textContent = message;
  elements.modalAccept.textContent = acceptText;
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
        else if (autoMessage) elements.modalMessage.textContent = autoMessage(remaining);
      }, 1000);
    }
    (cancelVisible ? elements.modalCancel : elements.modalAccept).focus();
  });
}

async function showError(title, message) {
  await showModal({
    title,
    message,
    acceptText: "확인",
    cancelVisible: false,
  });
}

async function loadSettings() {
  try {
    const config = await invoke("settings_get");
    renderConfig(config);
    elements.saveStatus.textContent = "설정은 이 PC에만 저장됩니다.";
  } catch (error) {
    elements.saveStatus.textContent = String(error);
    elements.engineState.dataset.state = "error";
    elements.engineStateLabel.textContent = "엔진 연결 실패";
  }
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
    await showError("보내는 메시지 번역 상태를 변경하지 못했습니다", String(error));
  }
});
elements.outgoingConfirmLanguage.addEventListener("click", () => {
  const enabled = elements.outgoingConfirmLanguage.getAttribute("aria-checked") !== "true";
  setSwitch(elements.outgoingConfirmLanguage, enabled, "확인", "자동 적용");
});
elements.keepWarm.addEventListener("click", () => {
  const enabled = elements.keepWarm.getAttribute("aria-checked") !== "true";
  setSwitch(elements.keepWarm, enabled, "유지", "반환");
});
elements.captureFps.addEventListener("wheel", event => event.preventDefault(), { passive: false });
elements.shortcut.addEventListener("keydown", event => {
  if (event.key === "Tab") return;
  event.preventDefault();
  event.stopPropagation();
  const help = document.querySelector("#shortcut-help");
  if (event.key === "Escape") {
    elements.shortcut.value = state.saved.hotkeys.toggle_translation;
    elements.shortcut.blur();
    return;
  }
  const shortcut = shortcutFromKeyboardEvent(event);
  if (!shortcut) {
    help.textContent = "F1~F24 또는 Ctrl·Alt·Shift와 일반 키를 함께 입력하십시오.";
    return;
  }
  elements.shortcut.value = shortcut;
  help.textContent = `${shortcut}로 변경됩니다. 저장을 선택하여 적용하십시오.`;
});
elements.shortcut.addEventListener("focus", () => {
  document.querySelector("#shortcut-help").textContent = "새 단축키 조합을 입력하십시오. Esc를 누르면 취소됩니다.";
});
elements.shortcut.addEventListener("blur", () => {
  document.querySelector("#shortcut-help").textContent = "클릭한 뒤 원하는 단축키 조합을 누르면 변경할 수 있습니다.";
});
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
elements.checkUpdate.addEventListener("click", () => {
  checkForUpdates(false).catch(error => showError("업데이트를 확인하지 못했습니다", String(error)));
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
elements.cancel.addEventListener("click", () => {
  renderConfig(state.saved);
  document.querySelectorAll(".provider-secret").forEach(secret => { secret.value = ""; });
});
elements.form.addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await savePendingProviderCredentials();
    const translator = state.selectValues.translator;
    if (EXTERNAL_PROVIDERS.has(translator) && !providerIsConnected(translator)) {
      revealProviderConnection(translator);
      throw new Error("선택한 외부 번역 서비스를 먼저 연결하십시오.");
    }
    elements.saveStatus.textContent = "저장 중";
    const updated = await invoke("settings_update", { patch: collectPatch() });
    renderConfig(updated);
    elements.saveStatus.textContent = "저장되었습니다.";
    await invoke("main_window_hide");
  } catch (error) {
    elements.saveStatus.textContent = String(error);
  }
});

if (tauriListen) {
  tauriListen("request-translation-toggle", toggleTranslation);
  tauriListen("settings-changed", event => renderConfig(event.payload));
  tauriListen("provider-connections-changed", loadProviderConnections);
  tauriListen("focus-provider-connection", event => {
    loadProviderConnections().finally(() => revealProviderConnection(event.payload));
  });
  tauriListen("update-download-progress", event => {
    const downloaded = formatMegabytes(event.payload?.downloaded);
    const total = event.payload?.total ? ` / ${formatMegabytes(event.payload.total)}` : "";
    elements.updateStatus.textContent = `업데이트 다운로드 중 ${downloaded}${total}`;
  });
  tauriListen("update-download-finished", () => {
    elements.updateStatus.textContent = "업데이트 서명을 확인하고 설치하고 있습니다...";
  });
}

bindOverlayScrollIndicator();
new ResizeObserver(updateScrollIndicator).observe(elements.settingsScroll);
window.requestAnimationFrame(updateScrollIndicator);
loadSettings();
loadProviderConnections();
loadAppInformation();
window.setInterval(pollRuntime, 700);
