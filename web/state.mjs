export const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  outgoing_translation_enabled: false,
  outgoing_target_language: "auto",
  outgoing_confirm_language: true,
  target_language: "ko",
  translator: "hymt_1_8b",
  speech_style: "auto",
  hymt_device: "auto",
  keep_local_model_warm: true,
  capture_fps: 8,
  ui_theme: "system",
  discord_auto_restart_consent_granted: false,
  hotkeys: { toggle_translation: "F12" },
});

export const SUPPORTED_TARGET_LANGUAGES = Object.freeze([
  "ko",
  "ja",
  "en",
  "zh",
  "zh-Hant",
]);

const SHORTCUT_KEY_NAMES = Object.freeze({
  " ": "Space",
  Spacebar: "Space",
  Enter: "Enter",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Insert: "Insert",
});

export function shortcutFromKeyboardEvent(event = {}) {
  const rawKey = String(event.key || "");
  if (["Control", "Alt", "Shift", "Meta", "Tab", "Escape"].includes(rawKey)) return "";
  let key = "";
  if (/^F(?:[1-9]|1\d|2[0-4])$/i.test(rawKey)) key = rawKey.toUpperCase();
  else if (/^[a-z0-9]$/i.test(rawKey)) key = rawKey.toUpperCase();
  else key = SHORTCUT_KEY_NAMES[rawKey] || "";
  if (!key) return "";

  const modifiers = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Super");
  if (modifiers.length === 0 && !/^F\d+$/.test(key)) return "";
  return [...modifiers, key].join("+");
}

export function normalizeConfig(value = {}) {
  const targetLanguage = SUPPORTED_TARGET_LANGUAGES.includes(value.target_language)
    ? value.target_language
    : DEFAULT_CONFIG.target_language;
  const outgoingTargetLanguage = ["auto", ...SUPPORTED_TARGET_LANGUAGES].includes(
    value.outgoing_target_language,
  )
    ? value.outgoing_target_language
    : DEFAULT_CONFIG.outgoing_target_language;
  return {
    ...DEFAULT_CONFIG,
    ...value,
    target_language: targetLanguage,
    outgoing_target_language: outgoingTargetLanguage,
    hotkeys: {
      ...DEFAULT_CONFIG.hotkeys,
      ...(value.hotkeys || {}),
    },
  };
}

export function restartCountdownMessage(seconds) {
  return [
    "Discord 디버그 렌더러에 연결할 수 없습니다.",
    "작성 중인 메시지가 사라지거나 통화가 종료될 수 있습니다.",
    "",
    `${Math.max(1, Number(seconds) || 1)}초 후 Discord를 자동으로 다시 시작합니다.`,
  ].join("\n");
}

export function shouldPromptRestart(status, flags) {
  return Boolean(
    (status?.controllerEnabled ?? status?.enabled) &&
      status?.connectionIssue &&
      !status?.cdpConnected &&
      !flags.promptActive &&
      !flags.repairActive,
  );
}

export function resolveEnabledState(reportedEnabled, pendingEnabled) {
  const reported = Boolean(reportedEnabled);
  if (pendingEnabled === null || pendingEnabled === undefined) {
    return { enabled: reported, pending: null };
  }
  const pending = Boolean(pendingEnabled);
  if (reported === pending) return { enabled: reported, pending: null };
  return { enabled: pending, pending };
}

export function discordConnectionLabel(status = {}) {
  if (status.cdpConnected) return "Discord 연결됨";
  if (status.connectionIssue) return "연결 확인 필요";
  return (status.controllerEnabled ?? status.enabled) ? "Discord 연결 중" : "번역 대기 중";
}

const TRANSLATOR_RUNTIME_NAMES = Object.freeze({
  hymt_1_8b: "Hy-MT2 1.8B",
  hymt_7b: "Hy-MT2 7B",
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  deepl: "DeepL",
  mock: "Mock 테스트",
  original: "원문",
});

export function translatorRuntimeLabel(status) {
  if (!status) return "";
  const configured = TRANSLATOR_RUNTIME_NAMES[status.configuredTranslator]
    || status.configuredTranslator
    || "번역 모델";
  const active = TRANSLATOR_RUNTIME_NAMES[status.activeTranslator]
    || status.activeTranslator
    || configured;
  if (status.translatorState === "error") return `${configured} 준비 실패`;
  if (["preparing", "queued"].includes(status.translatorState)) {
    return `${configured} 준비 중`;
  }
  return `${active} 사용 중`;
}

export function scrollThumbMetrics(trackHeight, scrollHeight, scrollTop) {
  const viewport = Math.max(0, Number(trackHeight) || 0);
  const content = Math.max(0, Number(scrollHeight) || 0);
  const maxScroll = Math.max(0, content - viewport);
  if (viewport <= 0 || maxScroll <= 0) {
    return { scrollable: false, height: 0, top: 0 };
  }
  const height = Math.min(viewport, Math.max(32, (viewport * viewport) / content));
  const progress = Math.min(1, Math.max(0, (Number(scrollTop) || 0) / maxScroll));
  return {
    scrollable: true,
    height,
    top: progress * (viewport - height),
  };
}
