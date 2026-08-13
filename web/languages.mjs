export const LANGUAGE_OPTIONS = Object.freeze([
  Object.freeze(["ko", "한국어", "KO", "Korean", "KR"]),
  Object.freeze(["en", "English", "EN", "English", "US"]),
  Object.freeze(["ja", "日本語", "JA", "Japanese", "JP"]),
  Object.freeze(["zh", "简体中文", "CN", "Simplified Chinese", "CN"]),
  Object.freeze(["zh-Hant", "繁體中文", "TW", "Traditional Chinese", "TW"]),
  Object.freeze(["pt-BR", "Português (Brasil)", "BR", "Brazilian Portuguese", "BR"]),
  Object.freeze(["hi", "हिन्दी", "HI", "Hindi", "IN"]),
  Object.freeze(["es-419", "Español (Latinoamérica)", "ES", "Latin American Spanish", "MX"]),
  Object.freeze(["de", "Deutsch", "DE", "German", "DE"]),
  Object.freeze(["ru", "Русский", "RU", "Russian", "RU"]),
  Object.freeze(["id", "Bahasa Indonesia", "ID", "Indonesian", "ID"]),
  Object.freeze(["fr", "Français", "FR", "French", "FR"]),
  Object.freeze(["tr", "Türkçe", "TR", "Turkish", "TR"]),
  Object.freeze(["ar", "العربية", "AR", "Arabic", "SA"]),
  Object.freeze(["vi", "Tiếng Việt", "VI", "Vietnamese", "VN"]),
  Object.freeze(["it", "Italiano", "IT", "Italian", "IT"]),
  Object.freeze(["pl", "Polski", "PL", "Polish", "PL"]),
  Object.freeze(["uk", "Українська", "UK", "Ukrainian", "UA"]),
  Object.freeze(["ms", "Bahasa Melayu", "MS", "Malay", "MY"]),
  Object.freeze(["nl", "Nederlands", "NL", "Dutch", "NL"]),
  Object.freeze(["th", "ไทย", "TH", "Thai", "TH"]),
  Object.freeze(["fil", "Filipino", "FIL", "Filipino", "PH"]),
  Object.freeze(["bn", "বাংলা", "BN", "Bengali", "BD"]),
  Object.freeze(["ur", "اردو", "UR", "Urdu", "PK"]),
  Object.freeze(["ta", "தமிழ்", "TA", "Tamil", "IN"]),
  Object.freeze(["fa", "فارسی", "FA", "Persian", "IR"]),
  Object.freeze(["he", "עברית", "HE", "Hebrew", "IL"]),
  Object.freeze(["cs", "Čeština", "CS", "Czech", "CZ"]),
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
