import assert from "node:assert/strict";
import test from "node:test";

import {
  discordConnectionLabel,
  localModelStorageDisplay,
  manualDiscordRestartAvailability,
  modelPreparationBanner,
  nextIncomingSourceLanguageSelection,
  normalizeConfig,
  providerOperationAvailability,
  resolveEnabledState,
  restartCountdownMessage,
  shortcutFromKeyboardEvent,
  scrollThumbMetrics,
  shouldPromptRestart,
  SUPPORTED_TARGET_LANGUAGES,
  translatorRuntimeLabel,
} from "../state.mjs";

test("manual Discord restart appears only after automatic recovery is cancelled or fails", () => {
  assert.deepEqual(
    manualDiscordRestartAvailability(
      { controllerEnabled: true, cdpConnected: false },
      { repairActive: false, promptActive: false, manualRestartRequired: false },
    ),
    { visible: false, disabled: false },
  );
  assert.deepEqual(
    manualDiscordRestartAvailability(
      { controllerEnabled: true, cdpConnected: false },
      { repairActive: false, promptActive: false, manualRestartRequired: true },
    ),
    { visible: true, disabled: false },
  );
  assert.deepEqual(
    manualDiscordRestartAvailability(
      { controllerEnabled: false, cdpConnected: false },
      { repairActive: true, promptActive: false, manualRestartRequired: true },
    ),
    { visible: true, disabled: true },
  );
  assert.deepEqual(
    manualDiscordRestartAvailability(
      { controllerEnabled: true, cdpConnected: false, connectionIssue: "restart failed" },
      { repairActive: false, promptActive: false, restartAttempted: true },
    ),
    { visible: true, disabled: false },
  );
  assert.deepEqual(
    manualDiscordRestartAvailability(
      { controllerEnabled: true, cdpConnected: true, connectionIssue: "stale" },
      { repairActive: false, promptActive: false, manualRestartRequired: true },
    ),
    { visible: false, disabled: false },
  );
});

test("provider connection operations lock every provider row until completion", () => {
  assert.deepEqual(providerOperationAvailability("", "chatgpt"), {
    blocked: false,
    active: false,
  });
  assert.deepEqual(providerOperationAvailability("claude", "claude"), {
    blocked: true,
    active: true,
  });
  assert.deepEqual(providerOperationAvailability("claude", "gemini"), {
    blocked: true,
    active: false,
  });
});

test("an active partial model download is labelled as downloading in storage", () => {
  assert.deepEqual(
    localModelStorageDisplay(
      {
        label: "TranslateGemma 4B Q4_K_M",
        bundled: false,
        deletable: true,
        storedBytes: 1_147_489_151,
        expectedBytes: 2_867_472_896,
      },
      {
        model: "TranslateGemma 4B Q4_K_M",
        phase: "downloading",
        downloaded: 1_512_148_426,
        total: 2_867_472_896,
      },
    ),
    {
      state: "downloading",
      currentBytes: 1_512_148_426,
      totalBytes: 2_867_472_896,
    },
  );
});

test("disabled translation is shown as waiting instead of connecting", () => {
  assert.equal(
    discordConnectionLabel({ enabled: false, cdpConnected: false, connectionIssue: null }),
    "번역 대기 중",
  );
  assert.equal(
    discordConnectionLabel({ enabled: true, cdpConnected: false, connectionIssue: null }),
    "Discord 연결 중",
  );
});

test("shortcut capture accepts function keys and modified key combinations", () => {
  assert.equal(shortcutFromKeyboardEvent({ key: "F9" }), "F9");
  assert.equal(
    shortcutFromKeyboardEvent({ key: "t", ctrlKey: true, altKey: true }),
    "Ctrl+Alt+T",
  );
  assert.equal(shortcutFromKeyboardEvent({ key: "Control", ctrlKey: true }), "");
  assert.equal(shortcutFromKeyboardEvent({ key: "t" }), "");
});

test("old settings receive safe Tauri defaults", () => {
  const config = normalizeConfig({ enabled: true });

  assert.equal(config.enabled, true);
  assert.equal(config.translator, "hymt_1_8b");
  assert.equal(config.outgoing_translator, "hymt_1_8b");
  assert.equal(config.discord_verification_mode, false);
  assert.equal(config.discord_auto_restart_consent_granted, false);
  assert.equal(config.translation_history_retention_days, 30);
  assert.equal(config.hotkeys.toggle_translation, "F12");
  assert.equal(config.hotkeys.toggle_outgoing_translation, "F8");
  assert.equal(config.hotkeys.send_outgoing_immediately, undefined);
  assert.equal(config.hotkeys.review_outgoing_before_send, undefined);
  assert.equal(config.ui_language, "auto");
  assert.equal(config.image_ocr_quality, "adaptive");
  assert.equal(config.dictionary_enabled, true);
  assert.equal(config.dictionary_external_provider, "wiktionary");
  assert.equal(config.discord_variant, "auto");
  assert.equal(config.preserve_nicknames, true);
});

test("Discord variant selection accepts stable, PTB, and Canary", () => {
  for (const variant of ["auto", "stable", "ptb", "canary"]) {
    assert.equal(normalizeConfig({ discord_variant: variant }).discord_variant, variant);
  }
  assert.equal(normalizeConfig({ discord_variant: "development" }).discord_variant, "auto");
});

test("dictionary external lookup accepts only the supported privacy choices", () => {
  for (const provider of ["wiktionary", "none"]) {
    assert.equal(normalizeConfig({ dictionary_external_provider: provider }).dictionary_external_provider, provider);
  }
  assert.equal(normalizeConfig({ dictionary_external_provider: "unknown" }).dictionary_external_provider, "wiktionary");
});

test("image OCR quality keeps only supported execution policies", () => {
  for (const mode of ["fast", "adaptive", "quality"]) {
    assert.equal(normalizeConfig({ image_ocr_quality: mode }).image_ocr_quality, mode);
  }
  assert.equal(normalizeConfig({ image_ocr_quality: "maximum" }).image_ocr_quality, "adaptive");
});

test("translation history retention accepts supported periods and rejects other values", () => {
  for (const days of [0, 7, 30, 90, 180]) {
    assert.equal(normalizeConfig({ translation_history_retention_days: days }).translation_history_retention_days, days);
  }
  assert.equal(normalizeConfig({ translation_history_retention_days: 14 }).translation_history_retention_days, 30);
});

test("settings language defaults to automatic and accepts every explicit language", () => {
  for (const language of ["auto", ...SUPPORTED_TARGET_LANGUAGES]) {
    assert.equal(normalizeConfig({ ui_language: language }).ui_language, language);
  }
  assert.equal(normalizeConfig({ ui_language: "unsupported" }).ui_language, "auto");
});

test("all supported display languages survive settings normalization", () => {
  assert.deepEqual(SUPPORTED_TARGET_LANGUAGES, [
    "ko", "en", "ja", "zh", "zh-Hant", "pt-BR", "hi", "es-419", "de", "ru",
    "id", "fr", "tr", "ar", "vi", "it", "pl", "uk", "ms", "nl",
    "th", "fil", "bn", "ur", "ta", "fa", "he", "cs",
  ]);
  for (const targetLanguage of SUPPORTED_TARGET_LANGUAGES) {
    assert.equal(normalizeConfig({ target_language: targetLanguage }).target_language, targetLanguage);
  }
  assert.equal(normalizeConfig({ target_language: "unsupported" }).target_language, "ko");
});

test("incoming source language filter defaults to all and normalizes selected languages", () => {
  const defaults = normalizeConfig({});
  assert.equal(defaults.incoming_language_mode, "all");
  assert.deepEqual(defaults.incoming_source_languages, []);

  const selected = normalizeConfig({
    incoming_language_mode: "selected",
    incoming_source_languages: ["ja", "invalid", "en", "ja"],
  });
  assert.equal(selected.incoming_language_mode, "selected");
  assert.deepEqual(selected.incoming_source_languages, ["ja", "en"]);

  const invalid = normalizeConfig({
    incoming_language_mode: "exclude",
    incoming_source_languages: "ja",
  });
  assert.equal(invalid.incoming_language_mode, "all");
  assert.deepEqual(invalid.incoming_source_languages, []);
});

test("incoming source language selection changes only through explicit option clicks", () => {
  const japanese = nextIncomingSourceLanguageSelection("all", [], "ja");
  assert.deepEqual(japanese, {
    incoming_language_mode: "selected",
    incoming_source_languages: ["ja"],
  });

  const none = nextIncomingSourceLanguageSelection(
    japanese.incoming_language_mode,
    japanese.incoming_source_languages,
    "ja",
  );
  assert.deepEqual(none, {
    incoming_language_mode: "selected",
    incoming_source_languages: [],
  });

  assert.deepEqual(
    nextIncomingSourceLanguageSelection(
      none.incoming_language_mode,
      none.incoming_source_languages,
      "all",
    ),
    {
      incoming_language_mode: "all",
      incoming_source_languages: [],
    },
  );
});

test("restart message contains countdown and data-loss warning", () => {
  const message = restartCountdownMessage(15);

  assert.match(message, /15초/);
  assert.match(message, /작성 중인 메시지/);
  assert.match(message, /통화/);
  assert.match(message, /디버그/);
});

test("restart prompt only opens for an enabled failed CDP connection", () => {
  assert.equal(
    shouldPromptRestart(
      {
        enabled: false,
        controllerEnabled: true,
        connectionIssue: "port closed",
        cdpConnected: false,
      },
      { promptActive: false, repairActive: false },
    ),
    true,
  );
  assert.equal(
    shouldPromptRestart(
      { enabled: true, connectionIssue: "port closed", cdpConnected: false },
      { promptActive: false, repairActive: false },
    ),
    true,
  );
  assert.equal(
    shouldPromptRestart(
      { enabled: true, connectionIssue: "port closed", cdpConnected: true },
      { promptActive: false, repairActive: false },
    ),
    false,
  );
  assert.equal(
    shouldPromptRestart(
      { enabled: true, connectionIssue: "pipe delayed", cdpConnected: false },
      { promptActive: false, repairActive: false, restartAttempted: true },
    ),
    false,
  );
});

test("Sentory overlay scroll thumb follows viewport and scroll position", () => {
  assert.deepEqual(scrollThumbMetrics(500, 1000, 250), {
    scrollable: true,
    height: 250,
    top: 125,
  });
  assert.deepEqual(scrollThumbMetrics(500, 400, 0), {
    scrollable: false,
    height: 0,
    top: 0,
  });
});

test("pending translation toggle stays visible until the engine acknowledges it", () => {
  assert.deepEqual(resolveEnabledState(true, false), { enabled: false, pending: false });
  assert.deepEqual(resolveEnabledState(false, false), { enabled: false, pending: null });
  assert.deepEqual(resolveEnabledState(true, null), { enabled: true, pending: null });
});

test("translator runtime label distinguishes preparation from the active model", () => {
  assert.equal(
    translatorRuntimeLabel({
      configuredTranslator: "hymt_7b",
      activeTranslator: "hymt_1_8b",
      translatorState: "preparing",
    }),
    "Hy-MT2 7B 준비 중",
  );
  assert.equal(
    translatorRuntimeLabel({
      configuredTranslator: "hymt_7b",
      activeTranslator: "hymt_7b",
      translatorState: "ready",
    }),
    "Hy-MT2 7B 사용 중",
  );
  assert.equal(
    translatorRuntimeLabel({
      configuredTranslator: "chatgpt",
      activeTranslator: "chatgpt",
      translatorState: "ready",
    }),
    "ChatGPT 품질 우선 (Codex CLI) 사용 중",
  );
  assert.equal(
    translatorRuntimeLabel({
      configuredTranslator: "claude",
      activeTranslator: "claude",
      translatorState: "ready",
    }),
    "Claude 품질 우선 (Claude Code) 사용 중",
  );
  assert.equal(
    translatorRuntimeLabel({
      configuredTranslator: "gemini",
      activeTranslator: "gemini",
      translatorState: "ready",
    }),
    "Gemini 품질 우선 (Antigravity CLI) 사용 중",
  );
  assert.equal(
    translatorRuntimeLabel({
      configuredTranslator: "deepl",
      activeTranslator: "deepl",
      translatorState: "ready",
    }),
    "DeepL 품질 우선 (API) 사용 중",
  );
});

test("local model preparation reports downloaded gigabytes and progress", () => {
  assert.deepEqual(
    modelPreparationBanner({
      model: "Hy-MT2 1.8B Q4_K_M",
      phase: "starting",
      downloaded: 0,
      total: 1_133_080_448,
    }),
    {
      title: "Hy-MT2 1.8B Q4_K_M 모델 준비 시작 중",
      detail: "모델 파일을 확인하고 필요한 다운로드를 준비하고 있습니다.",
      progress: 0,
      indeterminate: true,
    },
  );
  assert.deepEqual(
    modelPreparationBanner({
      model: "Hy-MT2 1.8B Q4_K_M",
      phase: "vram-protected",
      downloaded: 1_133_080_448,
      total: 1_133_080_448,
    }),
    {
      title: "Hy-MT2 1.8B Q4_K_M VRAM 보호 전환 중",
      detail: "현재 번역을 마쳤습니다. 다른 프로그램을 위해 VRAM을 비우고 CPU/RAM 모드로 다시 준비하고 있습니다.",
      progress: 1,
      indeterminate: true,
    },
  );
  assert.deepEqual(
    modelPreparationBanner({
      model: "Hy-MT2 1.8B Q4_K_M",
      phase: "gpu-restored",
      downloaded: 1_133_080_448,
      total: 1_133_080_448,
    }),
    {
      title: "Hy-MT2 1.8B Q4_K_M GPU 모드 복귀 중",
      detail: "VRAM 여유가 안정적으로 회복되어 GPU 모드로 다시 준비하고 있습니다.",
      progress: 1,
      indeterminate: true,
    },
  );

  assert.deepEqual(
    modelPreparationBanner({
      model: "Hy-MT2 1.8B Q4_K_M",
      phase: "downloading",
      downloaded: 536_870_912,
      total: 1_133_080_448,
    }),
    {
      title: "Hy-MT2 1.8B Q4_K_M 모델 다운로드 중",
      detail: "0.5GB / 1.1GB 다운로드됨",
      progress: 536_870_912 / 1_133_080_448,
      indeterminate: false,
    },
  );

  assert.deepEqual(
    modelPreparationBanner({
      model: "Hy-MT2 1.8B Q4_K_M",
      phase: "loading",
      downloaded: 1_133_080_448,
      total: 1_133_080_448,
    }),
    {
      title: "Hy-MT2 1.8B Q4_K_M 모델 불러오는 중",
      detail: "1.1GB 다운로드 완료 · 번역 엔진을 준비하고 있습니다.",
      progress: 1,
      indeterminate: true,
    },
  );
  assert.deepEqual(
    modelPreparationBanner({
      model: "Hy-MT2 1.8B Q4_K_M",
      phase: "cpu-fallback",
      downloaded: 1_133_080_448,
      total: 1_133_080_448,
    }),
    {
      title: "Hy-MT2 1.8B Q4_K_M CPU/RAM 전용 모드로 전환 중",
      detail: "GPU 실행에 실패해 시스템 RAM을 사용하는 CPU 모드로 다시 준비하고 있습니다.",
      progress: 1,
      indeterminate: true,
    },
  );
  assert.equal(modelPreparationBanner(null), null);
  assert.equal(modelPreparationBanner({ phase: "ready" }), null);
});
