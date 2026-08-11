export const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  outgoing_translation_enabled: false,
  outgoing_target_language: "auto",
  outgoing_confirm_send: true,
  target_language: "ko",
  translator: "hymt_1_8b",
  outgoing_translator: "hymt_1_8b",
  hymt_device: "auto",
  keep_local_model_warm: true,
  capture_fps: 8,
  ui_theme: "system",
  ui_language: "auto",
  discord_auto_restart_consent_granted: false,
  hotkeys: {
    toggle_translation: "F12",
    toggle_outgoing_translation: "F8",
    send_outgoing_immediately: "Ctrl+Enter",
    review_outgoing_before_send: "Alt+Enter",
  },
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
  const uiLanguage = ["auto", "ko", "en", "ja", "zh"].includes(value.ui_language)
    ? value.ui_language
    : DEFAULT_CONFIG.ui_language;
  return {
    ...DEFAULT_CONFIG,
    ...value,
    target_language: targetLanguage,
    outgoing_target_language: outgoingTargetLanguage,
    ui_language: uiLanguage,
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
  translategemma_4b: "TranslateGemma 4B",
  chatgpt: "GPT-5.6",
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

function formatGigabytes(bytes) {
  return `${(Math.max(0, Number(bytes) || 0) / 1024 ** 3).toFixed(1)}GB`;
}

export function modelPreparationBanner(progress) {
  if (!progress || progress.phase === "ready") return null;
  const model = progress.model || "로컬 번역";
  const downloaded = Math.max(0, Number(progress.downloaded) || 0);
  const total = Math.max(0, Number(progress.total) || 0);
  const ratio = total > 0 ? Math.min(1, downloaded / total) : 0;

  if (progress.phase === "downloading") {
    return {
      title: `${model} 모델 다운로드 중`,
      detail: `${formatGigabytes(downloaded)} / ${formatGigabytes(total)} 다운로드됨`,
      progress: ratio,
      indeterminate: false,
    };
  }
  if (progress.phase === "verifying") {
    return {
      title: `${model} 모델 파일 확인 중`,
      detail: `${formatGigabytes(total)} 다운로드 완료 · 파일 무결성을 확인하고 있습니다.`,
      progress: 1,
      indeterminate: true,
    };
  }
  if (progress.phase === "loading") {
    return {
      title: `${model} 모델 불러오는 중`,
      detail: `${formatGigabytes(total)} 다운로드 완료 · 번역 엔진을 준비하고 있습니다.`,
      progress: 1,
      indeterminate: true,
    };
  }
  return {
    title: `${model} 모델 준비 대기 중`,
    detail: "같은 로컬 모델 준비 작업이 끝나기를 기다리고 있습니다.",
    progress: 0,
    indeterminate: true,
  };
}

export function localModelStorageDisplay(model, progress) {
  const expectedBytes = Math.max(0, Number(model?.expectedBytes) || 0);
  const storedBytes = Math.max(0, Number(model?.storedBytes) || 0);
  if (model?.bundled) {
    return { state: "bundled", currentBytes: expectedBytes, totalBytes: expectedBytes };
  }

  const matchesActiveModel = Boolean(
    progress?.model
      && model?.label
      && progress.model === model.label,
  );
  if (matchesActiveModel && progress.phase === "downloading") {
    return {
      state: "downloading",
      currentBytes: Math.max(0, Number(progress.downloaded) || 0),
      totalBytes: Math.max(0, Number(progress.total) || expectedBytes),
    };
  }
  if (matchesActiveModel && ["verifying", "loading"].includes(progress.phase)) {
    return {
      state: progress.phase,
      currentBytes: Math.max(0, Number(progress.total) || expectedBytes),
      totalBytes: Math.max(0, Number(progress.total) || expectedBytes),
    };
  }
  if (matchesActiveModel && progress.phase === "ready") {
    return { state: "downloaded", currentBytes: expectedBytes, totalBytes: expectedBytes };
  }
  if (model?.installed) {
    return { state: "downloaded", currentBytes: storedBytes, totalBytes: expectedBytes };
  }
  if (model?.deletable) {
    return { state: "partial", currentBytes: storedBytes, totalBytes: expectedBytes };
  }
  return { state: "missing", currentBytes: 0, totalBytes: expectedBytes };
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
