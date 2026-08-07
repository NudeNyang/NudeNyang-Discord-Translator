from __future__ import annotations

import re
import unicodedata
from collections import deque

from .models import Language, RecognitionCandidate

HANGUL_RE = re.compile(r"[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]")
KANA_RE = re.compile(r"[\u3040-\u30ff\u31f0-\u31ff]")
HAN_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
LATIN_RE = re.compile(r"[A-Za-z]")

# Han characters are shared by Chinese and Japanese, so a perfect decision is
# impossible from a one- or two-character label. These high-frequency variant
# characters provide a strong per-message signal; genuinely ambiguous lines
# continue to use the recent author/channel context below.
SIMPLIFIED_HINTS = frozenset(
    "这们为时发后说对过从还实见长门问间书车马风云龙习"
)
TRADITIONAL_HINTS = frozenset(
    "這們麼嗎裡說對從還"
)


def _script_counts(text: str) -> dict[str, int]:
    return {
        "hangul": len(HANGUL_RE.findall(text)),
        "kana": len(KANA_RE.findall(text)),
        "han": len(HAN_RE.findall(text)),
        "latin": len(LATIN_RE.findall(text)),
        "letters": sum(unicodedata.category(ch).startswith("L") for ch in text),
    }


def detect_explicit_language(text: str) -> Language:
    """Return a language only when the visible script makes it unambiguous."""
    counts = _script_counts(text)
    if counts["hangul"]:
        return Language.KOREAN
    if counts["kana"]:
        return Language.JAPANESE
    simplified = sum(character in SIMPLIFIED_HINTS for character in text)
    traditional = sum(character in TRADITIONAL_HINTS for character in text)
    if simplified > traditional:
        return Language.CHINESE_SIMPLIFIED
    if traditional > simplified:
        return Language.CHINESE_TRADITIONAL
    if counts["latin"] and counts["latin"] >= max(1, counts["letters"] * 0.55):
        return Language.ENGLISH
    return Language.UNKNOWN


class LanguageDetector:
    """Script-first EN/JA/KO detector with a short context for Han-only lines."""

    def __init__(self, context_size: int = 8) -> None:
        self._context: deque[Language] = deque(maxlen=context_size)

    def detect(self, text: str, *, remember: bool = True) -> Language:
        counts = _script_counts(text)
        result = detect_explicit_language(text)
        if result is not Language.UNKNOWN:
            pass
        elif counts["han"]:
            result = self._context_language() or Language.JAPANESE
        else:
            result = Language.UNKNOWN
        if remember and result is not Language.UNKNOWN:
            self._context.append(result)
        return result

    def _context_language(self) -> Language | None:
        # Korean/Japanese can both contain Han. Recent non-English context is the best
        # signal available without sending the text to a language service.
        for language in reversed(self._context):
            if language in (
                Language.JAPANESE,
                Language.KOREAN,
                Language.CHINESE_SIMPLIFIED,
                Language.CHINESE_TRADITIONAL,
            ):
                return language
        return None


class CandidateSelector:
    """Choose between PP-OCRv6 and Korean-v5 output for the same text crop."""

    def __init__(self, detector: LanguageDetector | None = None) -> None:
        self.detector = detector or LanguageDetector()

    def choose(
        self, candidates: list[RecognitionCandidate]
    ) -> tuple[RecognitionCandidate, Language]:
        useful = [c for c in candidates if c.text.strip()]
        if not useful:
            return RecognitionCandidate("none", "", 0.0), Language.UNKNOWN

        scored: list[tuple[float, RecognitionCandidate, Language]] = []
        for candidate in useful:
            language = self.detector.detect(candidate.text, remember=False)
            counts = _script_counts(candidate.text)
            bonus = 0.0
            if counts["hangul"] and "korean" in candidate.engine.casefold():
                bonus += 0.22
            if counts["kana"] and "v6" in candidate.engine.casefold():
                bonus += 0.16
            if language is Language.ENGLISH:
                bonus += 0.04
            if _is_complete_v6_candidate(candidate, useful):
                # The Korean recognizer can confidently return only the Latin
                # prefix of a Japanese channel name (for example 4k動画設定 ->
                # 4k). Prefer the equally confident v6 candidate that preserves
                # the Japanese suffix instead of treating the prefix as English.
                bonus += 0.14
            if candidate.text.count("�") or candidate.text.count("?") > len(candidate.text) / 3:
                bonus -= 0.25
            scored.append((candidate.confidence + bonus, candidate, language))

        _, best, language = max(scored, key=lambda item: item[0])
        language = self.detector.detect(best.text, remember=True)
        return best, language


def _is_complete_v6_candidate(
    candidate: RecognitionCandidate, candidates: list[RecognitionCandidate]
) -> bool:
    if "v6" not in candidate.engine.casefold():
        return False
    counts = _script_counts(candidate.text)
    if not (counts["han"] or counts["kana"]):
        return False
    normalized = "".join(character for character in candidate.text if character.isalnum())
    if len(normalized) < 4:
        return False
    for other in candidates:
        wrong_engine = "korean" not in other.engine.casefold()
        much_less_confident = candidate.confidence < other.confidence - 0.06
        if wrong_engine or much_less_confident:
            continue
        other_normalized = "".join(character for character in other.text if character.isalnum())
        if (
            other_normalized
            and len(other_normalized) <= len(normalized) * 0.6
            and normalized.casefold().startswith(other_normalized.casefold())
        ):
            return True
    return False
