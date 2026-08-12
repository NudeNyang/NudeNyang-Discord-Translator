export const LANGUAGE_OPTIONS = Object.freeze([
  Object.freeze(["ko", "한국어", "KO", "Korean"]),
  Object.freeze(["en", "English", "EN", "English"]),
  Object.freeze(["ja", "日本語", "JP", "Japanese"]),
  Object.freeze(["zh", "简体中文", "CN", "Simplified Chinese"]),
  Object.freeze(["zh-Hant", "繁體中文", "TW", "Traditional Chinese"]),
  Object.freeze(["pt-BR", "Português (Brasil)", "BR", "Brazilian Portuguese"]),
  Object.freeze(["hi", "हिन्दी", "HI", "Hindi"]),
  Object.freeze(["es-419", "Español (Latinoamérica)", "ES", "Latin American Spanish"]),
  Object.freeze(["de", "Deutsch", "DE", "German"]),
  Object.freeze(["ru", "Русский", "RU", "Russian"]),
  Object.freeze(["id", "Bahasa Indonesia", "ID", "Indonesian"]),
  Object.freeze(["fr", "Français", "FR", "French"]),
  Object.freeze(["tr", "Türkçe", "TR", "Turkish"]),
  Object.freeze(["ar", "العربية", "AR", "Arabic"]),
  Object.freeze(["vi", "Tiếng Việt", "VI", "Vietnamese"]),
  Object.freeze(["it", "Italiano", "IT", "Italian"]),
  Object.freeze(["pl", "Polski", "PL", "Polish"]),
  Object.freeze(["uk", "Українська", "UK", "Ukrainian"]),
  Object.freeze(["ms", "Bahasa Melayu", "MS", "Malay"]),
  Object.freeze(["nl", "Nederlands", "NL", "Dutch"]),
]);

export const SUPPORTED_TARGET_LANGUAGES = Object.freeze(
  LANGUAGE_OPTIONS.map(([code]) => code),
);

export const LANGUAGE_LABELS = Object.freeze(Object.fromEntries(
  LANGUAGE_OPTIONS.map(([code, label]) => [code, label]),
));

export const COMPACT_LANGUAGE_LABELS = Object.freeze(Object.fromEntries(
  LANGUAGE_OPTIONS.map(([code, , compact]) => [code, compact]),
));
