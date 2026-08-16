import { normalizeLocale } from "./locale-utils.mjs";

export const GREETING_TEXT = Object.freeze({
  ko: "안녕하세요",
  en: "Hello",
  ja: "こんにちは",
  zh: "你好",
  "zh-Hant": "你好",
  "pt-BR": "Olá",
  hi: "नमस्ते",
  "es-419": "Hola",
  de: "Hallo",
  ru: "Привет",
  id: "Halo",
  fr: "Bonjour",
  tr: "Merhaba",
  ar: "مرحبًا",
  vi: "Xin chào",
  it: "Ciao",
  pl: "Cześć",
  uk: "Привіт",
  ms: "Helo",
  nl: "Hallo",
  th: "สวัสดี",
  fil: "Kumusta",
  bn: "নমস্কার",
  ur: "سلام",
  ta: "வணக்கம்",
  fa: "سلام",
  he: "שלום",
  cs: "Ahoj",
});

const DEFAULT_GREETING_ORDER = Object.freeze([
  "ko", "en", "ja", "zh", "zh-Hant", "pt-BR", "hi", "es-419", "de", "ru", "id", "fr", "tr", "ar",
  "vi", "it", "pl", "uk", "ms", "nl", "th", "fil", "bn", "ur", "ta", "fa", "he", "cs",
]);

export function buildGreetingCycle(locale) {
  const selectedLocale = normalizeLocale(locale) || "ko";
  const order = [selectedLocale, ...DEFAULT_GREETING_ORDER];
  return order
    .filter((code, index) => order.indexOf(code) === index)
    .map((code) => Object.freeze({ locale: code, text: GREETING_TEXT[code] }));
}
