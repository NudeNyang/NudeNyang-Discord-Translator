export const LANGUAGE_OPTIONS = Object.freeze([
  Object.freeze(["ko", "한국어", "KO"]),
  Object.freeze(["en", "English", "EN"]),
  Object.freeze(["ja", "日本語", "JP"]),
  Object.freeze(["zh", "简体中文", "CN"]),
  Object.freeze(["zh-Hant", "繁體中文", "TW"]),
  Object.freeze(["pt-BR", "Português (Brasil)", "BR"]),
  Object.freeze(["es-419", "Español (Latinoamérica)", "ES"]),
  Object.freeze(["de", "Deutsch", "DE"]),
  Object.freeze(["fr", "Français", "FR"]),
  Object.freeze(["id", "Bahasa Indonesia", "ID"]),
  Object.freeze(["hi", "हिन्दी", "HI"]),
  Object.freeze(["vi", "Tiếng Việt", "VI"]),
  Object.freeze(["pl", "Polski", "PL"]),
  Object.freeze(["ru", "Русский", "RU"]),
  Object.freeze(["uk", "Українська", "UK"]),
  Object.freeze(["tr", "Türkçe", "TR"]),
  Object.freeze(["ar", "العربية", "AR"]),
  Object.freeze(["it", "Italiano", "IT"]),
  Object.freeze(["nl", "Nederlands", "NL"]),
  Object.freeze(["ms", "Bahasa Melayu", "MS"]),
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
