export function createLatestDictionaryRequestGate() {
  let revision = 0;
  return {
    begin() {
      revision += 1;
      return revision;
    },
    invalidate() {
      revision += 1;
      return revision;
    },
    isCurrent(requestRevision) {
      return requestRevision === revision;
    },
  };
}

export function dictionaryOverviewFingerprint(entries = []) {
  return entries.map(entry => [
    entry.id,
    entry.sourceLanguage,
    entry.targetLanguage,
    entry.sourceTerm,
    entry.targetTerm,
    entry.note,
    entry.tags,
    entry.pinned,
    entry.updatedAt,
  ].join("\u0001")).join("\u0002");
}
