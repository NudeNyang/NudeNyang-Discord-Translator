const SPEECH_LOCALES = Object.freeze({
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
  zh: "zh-CN",
  "zh-hans": "zh-CN",
  "zh-hant": "zh-TW",
  "pt-br": "pt-BR",
  hi: "hi-IN",
  "es-419": "es-MX",
  de: "de-DE",
  ru: "ru-RU",
  id: "id-ID",
  fr: "fr-FR",
  tr: "tr-TR",
  ar: "ar-SA",
  vi: "vi-VN",
  it: "it-IT",
  pl: "pl-PL",
  uk: "uk-UA",
  ms: "ms-MY",
  nl: "nl-NL",
  th: "th-TH",
  fil: "fil-PH",
  bn: "bn-BD",
  ur: "ur-PK",
  ta: "ta-IN",
  fa: "fa-IR",
  he: "he-IL",
  cs: "cs-CZ",
});

function canonicalize(tag) {
  const normalized = String(tag || "").trim().replaceAll("_", "-");
  if (!normalized) return "";
  try { return Intl.getCanonicalLocales(normalized)[0] || normalized; }
  catch { return normalized; }
}

export function canonicalSpeechLanguage(language) {
  const normalized = canonicalize(language);
  const key = normalized.toLowerCase();
  if (SPEECH_LOCALES[key]) return SPEECH_LOCALES[key];
  if (key.startsWith("zh-hant") || key.startsWith("zh-tw") || key.startsWith("zh-hk")) return "zh-TW";
  if (key.startsWith("zh")) return "zh-CN";
  if (normalized.includes("-")) return normalized;
  return SPEECH_LOCALES[key] || normalized;
}

function languageBase(language) {
  return canonicalSpeechLanguage(language).split("-")[0]?.toLowerCase() || "";
}

export function selectSpeechVoice(voices, language) {
  const requested = canonicalSpeechLanguage(language);
  const requestedLower = requested.toLowerCase();
  const requestedBase = languageBase(requested);
  let best = null;
  let bestScore = 0;

  for (const voice of voices || []) {
    const candidate = canonicalSpeechLanguage(voice?.lang);
    const candidateLower = candidate.toLowerCase();
    if (!candidate || languageBase(candidate) !== requestedBase) continue;

    let score = candidateLower === requestedLower ? 100 : 60;
    if (voice.localService) score += 4;
    if (voice.default) score += 1;
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }

  return best;
}

export function waitForSpeechVoice(synthesis, language, { timeoutMs = 1500 } = {}) {
  if (!synthesis?.getVoices) return Promise.resolve(null);

  const findVoice = () => selectSpeechVoice(synthesis.getVoices(), language);
  const readyVoice = findVoice();
  if (readyVoice) return Promise.resolve(readyVoice);

  return new Promise(resolve => {
    let settled = false;
    let timer = 0;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      synthesis.removeEventListener?.("voiceschanged", handleVoicesChanged);
    };
    const finish = voice => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(voice || null);
    };
    const handleVoicesChanged = () => {
      const voice = findVoice();
      if (voice) finish(voice);
    };

    synthesis.addEventListener?.("voiceschanged", handleVoicesChanged);
    const voiceAfterListening = findVoice();
    if (voiceAfterListening) {
      finish(voiceAfterListening);
      return;
    }
    timer = setTimeout(() => finish(findVoice()), timeoutMs);
  });
}
