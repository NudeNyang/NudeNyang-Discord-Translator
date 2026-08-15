import { LANGUAGE_OPTIONS } from "./locales.generated.mjs";

export function normalizeLocale(locale) {
  if (!locale) return null;
  const normalized = locale.replaceAll("_", "-");
  const lowerLocale = normalized.toLowerCase();
  const exact = LANGUAGE_OPTIONS.find(([code]) => code.toLowerCase() === lowerLocale);
  if (exact) return exact[0];

  const localeParts = lowerLocale.split("-");
  if (localeParts[0] === "zh") {
    const usesTraditionalChinese = ["hant", "tw", "hk", "mo"].some((part) => localeParts.includes(part));
    return usesTraditionalChinese ? "zh-Hant" : "zh";
  }
  if (localeParts[0] === "pt") return "pt-BR";
  if (localeParts[0] === "es") return "es-419";

  const base = localeParts[0];
  return LANGUAGE_OPTIONS.find(([code]) => code.split("-")[0].toLowerCase() === base)?.[0] || null;
}
