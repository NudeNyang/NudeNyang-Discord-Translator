export function normalizeLanguageSearch(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

export function languageSearchText(option) {
  const [code, nativeLabel, , englishName = ""] = option;
  return normalizeLanguageSearch(`${nativeLabel} ${code} ${englishName}`);
}

export function filterLanguageOptions(options, query) {
  const normalizedQuery = normalizeLanguageSearch(query);
  if (!normalizedQuery) return [...options];
  return options.filter(option => languageSearchText(option).includes(normalizedQuery));
}
