(function exposeTextSegments(root) {
  "use strict";

  // A transport segment is not a new DOM node. All segments of a node share one
  // record and may be displayed only after that entire record has completed.
  function splitTranslationText(text, maxChars = 4000) {
    if (typeof text !== "string") {
      throw new TypeError("분할할 텍스트는 문자열이어야 합니다.");
    }
    if (!Number.isSafeInteger(maxChars) || maxChars < 1) {
      throw new RangeError("항목별 문자 한도는 1 이상의 안전한 정수여야 합니다.");
    }
    if (!text.trim()) return [];
    const segments = [];
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + maxChars, text.length);
      // The wire limit is measured conservatively in UTF-16 code units here.
      // Rust counts Unicode scalar values, so this also fits the native limit.
      if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])
        && /[\uDC00-\uDFFF]/u.test(text[end])) end -= 1;
      if (end === start) {
        throw new RangeError("문자 한도가 하나의 유니코드 문자를 담기에 부족합니다.");
      }
      if (end < text.length) {
        const window = text.slice(start, end);
        const minimum = Math.ceil(window.length / 2);
        const sentence = /(?:[。！？]["'”’»)\]}」』】）]*|[.!?]["'”’»)\]}」』】）]*(?=\s|$))\s*/gu;
        let boundary = 0;
        for (const match of window.matchAll(sentence)) {
          const candidate = match.index + match[0].length;
          if (candidate >= minimum) boundary = candidate;
        }
        if (!boundary) {
          for (const match of window.matchAll(/\s+/gu)) {
            const candidate = match.index + match[0].length;
            if (candidate >= minimum) boundary = candidate;
          }
        }
        if (boundary) end = start + boundary;
      }
      segments.push(text.slice(start, end));
      start = end;
    }
    return segments;
  }

  function createTextRecord(original, itemId, epoch, maxChars = 4000) {
    const segments = splitTranslationText(original, maxChars);
    const partial = new Map();
    for (const [index, segment] of segments.entries()) {
      // Long whitespace runs can require their own bounded segment. Preserve
      // them locally; callers must not enqueue a segment whose trim() is empty.
      if (!segment.trim()) partial.set(index, segment);
    }
    return {
      original, itemId, epoch, segments, partial,
      pending: partial.size < segments.length,
      translated: null,
      invalid: false,
    };
  }

  // Identity matching deliberately remains true after completion. Queueing and
  // response acceptance also check pending/partial to reject duplicate work.
  function recordMatchesItem(record, item) {
    return Boolean(record && item && !record.invalid
      && item.recordId === record.itemId && item.epoch === record.epoch
      && Number.isInteger(item.segmentIndex) && item.segmentIndex >= 0
      && item.segmentIndex < record.segments.length
      && item.id === `${record.itemId}:${item.segmentIndex}`
      && item.text === record.segments[item.segmentIndex]);
  }

  function cancelTextRecord(record) {
    if (!record || record.invalid) return false;
    record.invalid = true;
    record.pending = false;
    record.translated = null;
    record.partial.clear();
    return true;
  }

  function acceptTextSegment(record, item, translated) {
    if (!recordMatchesItem(record, item) || !record.pending || record.partial.has(item.segmentIndex)) return false;
    if (typeof translated !== "string" || !translated.trim()) {
      cancelTextRecord(record);
      return false;
    }
    const source = record.segments[item.segmentIndex];
    // Preserve the established display behavior for an unsplit node. At newly
    // introduced transport boundaries, restore source whitespace exactly so a
    // provider trimming a segment cannot join words or discard line breaks.
    const value = record.segments.length === 1 ? translated
      : source.match(/^\s*/u)[0] + translated.trim() + source.match(/\s*$/u)[0];
    record.partial.set(item.segmentIndex, value);
    if (record.partial.size === record.segments.length) {
      record.translated = record.segments.map((_, index) => record.partial.get(index)).join("");
      record.pending = false;
    }
    return true;
  }

  const api = Object.freeze({
    splitTranslationText, createTextRecord, recordMatchesItem, acceptTextSegment, cancelTextRecord,
  });
  root.NudeNyangTextSegments = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
