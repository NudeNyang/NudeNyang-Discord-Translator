export function normalizeLanguageSearch(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

export function languageSearchText(option) {
  const [code, nativeLabel, , englishName = "", countryCode = ""] = option;
  return normalizeLanguageSearch(`${nativeLabel} ${code} ${countryCode} ${englishName}`);
}

export function filterLanguageOptions(options, query) {
  const normalizedQuery = normalizeLanguageSearch(query);
  if (!normalizedQuery) return [...options];
  const exactCodeMatches = options.filter(option => {
    const [languageCode, , , , countryCode = ""] = option;
    return [languageCode, countryCode]
      .map(normalizeLanguageSearch)
      .includes(normalizedQuery);
  });
  if (exactCodeMatches.length) return exactCodeMatches;
  return options.filter(option => languageSearchText(option).includes(normalizedQuery));
}
