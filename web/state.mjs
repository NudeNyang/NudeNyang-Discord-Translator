import { SUPPORTED_TARGET_LANGUAGES } from "./languages.mjs";

export const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  outgoing_translation_enabled: false,
  outgoing_target_language: "auto",
  dictionary_enabled: true,
  dictionary_external_provider: "wiktionary",
  target_language: "ko",
  incoming_language_mode: "all",
  incoming_source_languages: [],
  translate_nicknames: true,
  web_translation_enabled: false,
  web_extension_setup_version: 1,
  disabled_browser_connections: [],
  web_messenger_enabled: false,
  web_target_language: "display",
  web_processing_mode: "balanced",
  web_external_page_char_limit: 25000,
  web_quick_toggle_shortcut: "F4",
  web_site_policies: {},
  translator: "hymt_1_8b",
  outgoing_translator: "hymt_1_8b",
  hymt_device: "auto",
  keep_local_model_warm: true,
  capture_fps: 8,
  image_ocr_quality: "adaptive",
  ui_theme: "system",
  ui_language: "auto",
  discord_variant: "auto",
  discord_auto_restart_consent_granted: false,
  discord_verification_mode: false,
  translation_history_retention_days: 30,
  hotkeys: {
    toggle_translation: "F12",
    toggle_outgoing_translation: "F8",
  },
});

export { SUPPORTED_TARGET_LANGUAGES } from "./languages.mjs";

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

export function normalizeWebQuickToggleShortcut(value, fallback = "F4") {
  const shortcut = String(value ?? fallback).trim();
  if (shortcut === "") return "";
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(shortcut)) return shortcut;
  if (/^(?:(?:Ctrl|Alt|Shift|Super)\+)+(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Space|Enter|Arrow(?:Up|Down|Left|Right)|Home|End|Page(?:Up|Down)|Insert)$/.test(shortcut)) {
    const parts = shortcut.split("+");
    const key = parts.pop();
    const modifiers = parts;
    if (new Set(modifiers).size !== modifiers.length) return fallback;
    const order = ["Ctrl", "Alt", "Shift", "Super"];
    if (modifiers.some((modifier, index) => order.indexOf(modifier) <= order.indexOf(modifiers[index - 1] ?? ""))) {
      return fallback;
    }
    return [...modifiers, key].join("+");
  }
  return fallback;
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
  const incomingLanguageMode = ["all", "selected"].includes(value.incoming_language_mode)
    ? value.incoming_language_mode
    : DEFAULT_CONFIG.incoming_language_mode;
  const incomingSourceLanguages = [...new Set(
    (Array.isArray(value.incoming_source_languages) ? value.incoming_source_languages : [])
      .filter(language => SUPPORTED_TARGET_LANGUAGES.includes(language)),
  )];
  const uiLanguage = ["auto", ...SUPPORTED_TARGET_LANGUAGES].includes(value.ui_language)
    ? value.ui_language
    : DEFAULT_CONFIG.ui_language;
  const retentionDays = [0, 7, 30, 90, 180].includes(
    Number(value.translation_history_retention_days),
  )
    ? Number(value.translation_history_retention_days)
    : DEFAULT_CONFIG.translation_history_retention_days;
  const imageOcrQuality = ["fast", "adaptive", "quality"].includes(value.image_ocr_quality)
    ? value.image_ocr_quality
    : DEFAULT_CONFIG.image_ocr_quality;
  const dictionaryExternalProvider = ["wiktionary", "none"].includes(
    value.dictionary_external_provider,
  )
    ? value.dictionary_external_provider
    : DEFAULT_CONFIG.dictionary_external_provider;
  const discordVariant = ["auto", "stable", "ptb", "canary"].includes(value.discord_variant)
    ? value.discord_variant
    : DEFAULT_CONFIG.discord_variant;
  const webTargetLanguage = ["display", ...SUPPORTED_TARGET_LANGUAGES].includes(
    value.web_target_language,
  )
    ? value.web_target_language
    : DEFAULT_CONFIG.web_target_language;
  const webProcessingMode = ["responsive", "balanced", "economy"].includes(
    value.web_processing_mode,
  )
    ? value.web_processing_mode
    : DEFAULT_CONFIG.web_processing_mode;
  const webExternalPageCharLimit = [0, 10000, 25000, 50000].includes(
    Number(value.web_external_page_char_limit),
  )
    ? Number(value.web_external_page_char_limit)
    : DEFAULT_CONFIG.web_external_page_char_limit;
  const webQuickToggleShortcut = normalizeWebQuickToggleShortcut(
    value.web_quick_toggle_shortcut,
  );
  const webSitePolicies = Object.fromEntries(
    Object.entries(
      value.web_site_policies && !Array.isArray(value.web_site_policies)
        ? value.web_site_policies
        : {},
    )
      .map(([hostname, policy]) => [hostname.trim().replace(/^www\./i, "").toLowerCase(), policy])
      .filter(([hostname, policy]) => {
        if (!/^(?=.{1,253}$)(?!\.)(?!.*\.$)[a-z0-9.-]+$/.test(hostname)) return false;
        return hostname.split(".").every(label => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label))
          && ["always", "manual", "never"].includes(policy);
      }),
  );
  return {
    ...DEFAULT_CONFIG,
    ...value,
    target_language: targetLanguage,
    incoming_language_mode: incomingLanguageMode,
    incoming_source_languages: incomingSourceLanguages,
    outgoing_target_language: outgoingTargetLanguage,
    ui_language: uiLanguage,
    translation_history_retention_days: retentionDays,
    image_ocr_quality: imageOcrQuality,
    dictionary_external_provider: dictionaryExternalProvider,
    discord_variant: discordVariant,
    web_target_language: webTargetLanguage,
    web_messenger_enabled: value.web_messenger_enabled === true,
    web_processing_mode: webProcessingMode,
    web_external_page_char_limit: webExternalPageCharLimit,
    web_quick_toggle_shortcut: webQuickToggleShortcut,
    web_site_policies: webSitePolicies,
    hotkeys: {
      ...DEFAULT_CONFIG.hotkeys,
      ...(value.hotkeys || {}),
    },
  };
}

export function nextIncomingSourceLanguageSelection(mode, languages, value) {
  if (value === "all") {
    return {
      incoming_language_mode: "all",
      incoming_source_languages: [],
    };
  }

  const selected = new Set(
    mode === "selected" && Array.isArray(languages)
      ? languages.filter(language => SUPPORTED_TARGET_LANGUAGES.includes(language))
      : [],
  );
  if (selected.has(value)) selected.delete(value);
  else if (SUPPORTED_TARGET_LANGUAGES.includes(value)) selected.add(value);

  return {
    incoming_language_mode: "selected",
    incoming_source_languages: [...selected],
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
      !status?.verificationRequired &&
      status?.connectionIssue &&
      !status?.cdpConnected &&
      !flags.promptActive &&
      !flags.repairActive &&
      !flags.restartAttempted,
  );
}

export function manualDiscordRestartAvailability(status = {}, flags = {}) {
  const recoveryRequired = Boolean(
    flags.manualRestartRequired ||
      (flags.restartAttempted && status.connectionIssue),
  );
  const visible = Boolean(recoveryRequired && !status.cdpConnected && !status.verificationRequired);
  return {
    visible,
    disabled: visible && Boolean(flags.repairActive || flags.promptActive),
  };
}

export function providerOperationAvailability(activeProvider, requestedProvider) {
  const active = String(activeProvider || "");
  return {
    blocked: Boolean(active),
    active: Boolean(active) && active === String(requestedProvider || ""),
  };
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
  if (status.verificationRequired) return "인증 호환 모드";
  if (status.connectionIssue) return "연결 확인 필요";
  return (status.controllerEnabled ?? status.enabled) ? "Discord 연결 중" : "번역 대기 중";
}

const TRANSLATOR_RUNTIME_NAMES = Object.freeze({
  hymt_1_8b: "Hy-MT2 1.8B",
  hymt_7b: "Hy-MT2 7B",
  translategemma_4b: "TranslateGemma 4B",
  chatgpt: "ChatGPT 품질 우선 (Codex CLI)",
  claude: "Claude 품질 우선 (Claude Code)",
  gemini: "Gemini 품질 우선 (Antigravity CLI)",
  deepl: "DeepL 품질 우선 (API)",
  mock: "Mock 테스트",
  original: "원문",
});

const LOCAL_MODEL_RESOURCE_PROFILES = Object.freeze({
  hymt_1_8b: Object.freeze({
    model: "Hy-MT2 1.8B",
    modelBytes: 1_133_080_448,
    estimatedVramBytes: Math.round(1.7 * 1024 ** 3),
    estimatedRamBytes: 2 * 1024 ** 3,
  }),
  hymt_7b: Object.freeze({
    model: "Hy-MT2 7B",
    modelBytes: 4_624_648_896,
    estimatedVramBytes: Math.round(5.3 * 1024 ** 3),
    estimatedRamBytes: Math.round(5.6 * 1024 ** 3),
  }),
  translategemma_4b: Object.freeze({
    model: "TranslateGemma 4B",
    modelBytes: 2_489_909_312,
    estimatedVramBytes: 3 * 1024 ** 3,
    estimatedRamBytes: Math.round(3.2 * 1024 ** 3),
  }),
});

export function webMessengerNeedsLocalModel(config = {}) {
  return config.web_messenger_enabled === true
    && !Object.hasOwn(LOCAL_MODEL_RESOURCE_PROFILES, config.translator);
}

export function localModelResourceGuidance(config = {}, memory = {}) {
  const modelId = LOCAL_MODEL_RESOURCE_PROFILES[config.translator]
    ? config.translator
    : LOCAL_MODEL_RESOURCE_PROFILES[config.outgoing_translator]
      ? config.outgoing_translator
      : "";
  const profile = LOCAL_MODEL_RESOURCE_PROFILES[modelId];
  if (!profile) return null;

  const totalBytes = Math.max(0, Number(memory.totalBytes) || 0);
  const availableBytes = Math.max(0, Number(memory.availableBytes) || 0);
  const usageKind = config.hymt_device === "cpu" ? "ram" : "vram";
  const estimatedUsageBytes = usageKind === "ram"
    ? profile.estimatedRamBytes
    : profile.estimatedVramBytes;
  const state = usageKind === "ram"
    && availableBytes > 0
    && availableBytes < estimatedUsageBytes
    ? "warning"
    : "ready";
  const lowMemorySystem = totalBytes > 0 && totalBytes < 12 * 1024 ** 3;
  const lowMemoryPresetActive = modelId === "hymt_1_8b"
    && config.hymt_device === "cpu"
    && config.keep_local_model_warm === false;

  return {
    model: profile.model,
    modelBytes: profile.modelBytes,
    estimatedUsageBytes,
    usageKind,
    totalBytes,
    availableBytes,
    state,
    recommendLowMemoryPreset: (state === "warning" || lowMemorySystem)
      && !lowMemoryPresetActive,
  };
}

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
  if (progress.phase === "cpu-fallback") {
    return {
      title: `${model} CPU/RAM 전용 모드로 전환 중`,
      detail: "GPU 실행에 실패해 시스템 RAM을 사용하는 CPU 모드로 다시 준비하고 있습니다.",
      progress: 1,
      indeterminate: true,
    };
  }
  if (progress.phase === "vram-protected") {
    return {
      title: `${model} VRAM 보호 전환 중`,
      detail: "현재 번역을 마쳤습니다. 다른 프로그램을 위해 VRAM을 비우고 CPU/RAM 모드로 다시 준비하고 있습니다.",
      progress: 1,
      indeterminate: true,
    };
  }
  if (progress.phase === "gpu-restored") {
    return {
      title: `${model} GPU 모드 복귀 중`,
      detail: "VRAM 여유가 안정적으로 회복되어 GPU 모드로 다시 준비하고 있습니다.",
      progress: 1,
      indeterminate: true,
    };
  }
  if (progress.phase === "starting") {
    return {
      title: `${model} 모델 준비 시작 중`,
      detail: "모델 파일을 확인하고 필요한 다운로드를 준비하고 있습니다.",
      progress: 0,
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
