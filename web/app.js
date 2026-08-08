import {
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
    ["gemini", "Gemini Pro/Ultra (Antigravity CLI)"],
    ["deepl", "DeepL (API 키·외부 전송)"],
    ["mock", "Mock 테스트"],
  ],
  speech_style: [
    ["auto", "원문 말투 유지 (자동)"],
    ["polite", "항상 존댓말·격식체"],
    ["casual", "항상 반말·비격식체"],
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
  availableReleaseUrl: "",
  settingsScrollTimer: 0,
  pendingEnabled: null,
  toggleActive: false,
};

const elements = {
  form: document.querySelector("#settings-form"),
  enabled: document.querySelector("#enabled"),
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
};

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

async function checkForUpdates(silent = false) {
  if (state.updateCheckActive) return;
  if (state.availableReleaseUrl && !silent) {
    await openExternalUrl(state.availableReleaseUrl);
    return;
  }
  state.updateCheckActive = true;
  elements.checkUpdate.disabled = true;
  if (!silent) elements.updateStatus.textContent = "GitHub에서 최신 릴리스를 확인하고 있습니다...";
  try {
    const result = await invoke("update_check", {
      currentVersion: elements.appVersion.textContent.trim(),
    });
    if (result.available) {
      state.availableReleaseUrl = result.pageUrl;
      elements.updateStatus.textContent = `새 버전 ${result.version}을 사용할 수 있습니다.`;
      elements.checkUpdate.textContent = "릴리스 열기";
    } else {
      elements.updateStatus.textContent = "현재 버전이 최신이거나 공개된 릴리스가 없습니다.";
      elements.checkUpdate.textContent = "지금 확인";
    }
  } catch (error) {
    if (!silent) elements.updateStatus.textContent = `업데이트 확인 실패: ${String(error)}`;
  } finally {
    state.updateCheckActive = false;
    elements.checkUpdate.disabled = false;
  }
}

async function loadAppInformation() {
  if (tauriGetVersion) {
    try {
      elements.appVersion.textContent = await tauriGetVersion();
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
}

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
    keep_local_model_warm: elements.keepWarm.getAttribute("aria-checked") === "true",
    capture_fps: Math.max(2, Math.min(20, Number(elements.captureFps.value) || 8)),
    hotkeys: { toggle_translation: elements.shortcut.value.trim() || "F12" },
  };
}

async function ensureRestartConsent() {
  if (state.config.discord_auto_restart_consent_granted) return true;
  const confirmed = await showModal({
    title: "Discord 자동 재시작을 허용할까요?",
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
    await showError("번역 상태를 바꾸지 못했어요", String(error));
  } finally {
    state.toggleActive = false;
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
  const connectionLabel = ready
    ? "Discord 연결됨"
    : status.connectionIssue
      ? "연결 확인 필요"
      : "Discord 연결 중";
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
      await setTranslationEnabled(false, false);
      return;
    }
    if (state.restartAttempted) {
      await setTranslationEnabled(false, false);
      await showError(
        "Discord 연결 실패",
        "이번 번역 실행에서 자동 재시작을 이미 한 번 시도했어요. Discord를 직접 종료한 뒤 다시 켜 주세요.",
      );
      return;
    }
    const confirmed = await showModal({
      title: "Discord 번역 연결을 준비할게요",
      message: restartCountdownMessage(15),
      acceptText: "지금 재시작",
      autoSeconds: 15,
      autoMessage: restartCountdownMessage,
    });
    if (!confirmed) {
      await setTranslationEnabled(false, false);
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
    state.config.enabled = true;
    setSwitch(elements.enabled, true, "켜짐", "꺼짐");
  } catch (error) {
    try {
      await setTranslationEnabled(false, false);
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
    help.textContent = "F1~F24 또는 Ctrl·Alt·Shift와 일반 키를 함께 눌러 주세요.";
    return;
  }
  elements.shortcut.value = shortcut;
  help.textContent = `${shortcut}로 변경됩니다. 저장을 눌러 적용해 주세요.`;
});
elements.shortcut.addEventListener("focus", () => {
  document.querySelector("#shortcut-help").textContent = "새 단축키 조합을 눌러 주세요. Esc를 누르면 취소됩니다.";
});
elements.shortcut.addEventListener("blur", () => {
  document.querySelector("#shortcut-help").textContent = "클릭한 뒤 원하는 단축키 조합을 누르면 변경할 수 있습니다.";
});
elements.authorLink.addEventListener("click", () => {
  openExternalUrl(APP_LINKS.author).catch(error => showError("링크를 열지 못했어요", String(error)));
});
elements.githubLink.addEventListener("click", () => {
  openExternalUrl(APP_LINKS.repository).catch(error => showError("링크를 열지 못했어요", String(error)));
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
elements.checkUpdate.addEventListener("click", () => {
  checkForUpdates(false).catch(error => showError("업데이트를 확인하지 못했어요", String(error)));
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
elements.cancel.addEventListener("click", () => renderConfig(state.saved));
elements.form.addEventListener("submit", async event => {
  event.preventDefault();
  try {
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
}

bindOverlayScrollIndicator();
new ResizeObserver(updateScrollIndicator).observe(elements.settingsScroll);
window.requestAnimationFrame(updateScrollIndicator);
loadSettings();
loadAppInformation();
window.setInterval(pollRuntime, 700);
