from __future__ import annotations

import logging
import re
import unicodedata

from ..models import Language
from .base import Translator

LOGGER = logging.getLogger("discord_translate_overlay")

HANGUL_RE = re.compile(r"[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]")
KANA_RE = re.compile(r"[\u3040-\u30ff\u31f0-\u31ff]")
HAN_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
LATIN_RE = re.compile(r"[A-Za-z]")
HALLUCINATION_PHRASES = (
    "번역이 어렵",
    "번역할 수 없",
    "해당 문구",
    "정확한 상황",
    "추가 정보를 제공",
    "원문 내용을 직접",
)


class ResilientTranslator(Translator):
    """Repair small-model echoes locally, then fall back only for failed lines."""

    def __init__(self, primary: Translator, fallback: Translator | None = None) -> None:
        self.primary = primary
        self.fallback = fallback
        self.sends_text_externally = fallback is not None and fallback.sends_text_externally
        self.display_name = (
            f"{primary.display_name} + {fallback.display_name} 보완"
            if fallback is not None
            else primary.display_name
        )
        fallback_namespace = fallback.cache_namespace if fallback is not None else "local-only"
        self.cache_namespace = (
            f"{primary.cache_namespace}:quality-repair-v1:{fallback_namespace}"
        )

    def translate(self, text: str, source: Language, target: Language) -> str:
        return self.translate_many([(text, source)], target)[0]

    def translate_many(
        self,
        items: list[tuple[str, Language]],
        target: Language,
    ) -> list[str]:
        if not items:
            return []
        results = self.primary.translate_many(items, target)
        if len(results) != len(items):
            raise RuntimeError("주 번역 엔진이 요청 수와 다른 결과를 반환했어.")

        failed = [
            index
            for index, ((source_text, source), translated) in enumerate(
                zip(items, results, strict=True)
            )
            if translation_needs_repair(source_text, translated, source, target)
        ]
        if not failed:
            return results

        line_items: list[tuple[str, Language]] = []
        line_maps: dict[int, tuple[list[str], list[int]]] = {}
        for index in failed:
            source_text, source = items[index]
            lines = source_text.splitlines()
            nonempty = [line_index for line_index, line in enumerate(lines) if line.strip()]
            if len(nonempty) <= 1:
                line_maps[index] = (lines or [source_text], nonempty or [0])
                continue
            line_maps[index] = (lines, nonempty)
            line_items.extend((lines[line_index], source) for line_index in nonempty)

        repaired_lines: dict[int, list[str]] = {}
        if line_items:
            local_results = self.primary.translate_many(line_items, target)
            if len(local_results) != len(line_items):
                raise RuntimeError("줄 단위 재번역 결과 수가 요청 수와 달라.")
            cursor = 0
            for index in failed:
                lines, nonempty = line_maps[index]
                if len(nonempty) <= 1:
                    continue
                values = list(lines)
                for line_index in nonempty:
                    values[line_index] = local_results[cursor]
                    cursor += 1
                repaired_lines[index] = values

        fallback_items: list[tuple[str, Language]] = []
        fallback_slots: list[tuple[int, int]] = []
        for index in failed:
            source_text, source = items[index]
            source_lines, nonempty = line_maps[index]
            candidate_lines = repaired_lines.get(index)
            if candidate_lines is None:
                candidate_lines = list(source_lines)
                if len(nonempty) == 1:
                    candidate_lines[nonempty[0]] = results[index]
            for line_index in nonempty:
                if translation_needs_repair(
                    source_lines[line_index], candidate_lines[line_index], source, target
                ):
                    fallback_items.append((source_lines[line_index], source))
                    fallback_slots.append((index, line_index))
            repaired_lines[index] = candidate_lines

        if fallback_items and self.fallback is not None:
            try:
                fallback_results = self.fallback.translate_many(fallback_items, target)
                if len(fallback_results) != len(fallback_items):
                    raise RuntimeError("보완 번역 결과 수가 요청 수와 달라.")
                for (index, line_index), translated in zip(
                    fallback_slots, fallback_results, strict=True
                ):
                    repaired_lines[index][line_index] = translated
            except Exception:
                LOGGER.exception("DeepL 보완 번역 실패; 로컬 결과를 유지해.")

        for index in failed:
            source_text, source = items[index]
            source_lines = source_text.splitlines() or [source_text]
            for line_index, candidate in enumerate(repaired_lines[index]):
                if line_index < len(source_lines) and translation_needs_repair(
                    source_lines[line_index], candidate, source, target
                ):
                    # A small local model can turn emoji/OCR noise into a long
                    # apology. Showing the original is safer than covering it
                    # with a fabricated explanation when fallback also fails.
                    repaired_lines[index][line_index] = source_lines[line_index]
            results[index] = "\n".join(repaired_lines[index])
        return results

    def should_cache(
        self,
        source_text: str,
        translated_text: str,
        source: Language,
        target: Language,
    ) -> bool:
        return not translation_needs_repair(source_text, translated_text, source, target)

    def close(self) -> None:
        self.primary.close()
        if self.fallback is not None:
            self.fallback.close()


def translation_needs_repair(
    source_text: str,
    translated_text: str,
    source: Language,
    target: Language,
) -> bool:
    source_normalized = _normalize(source_text)
    translated_normalized = _normalize(translated_text)
    if not source_normalized:
        return False
    source_alnum = sum(character.isalnum() for character in source_normalized)
    translated_alnum = sum(character.isalnum() for character in translated_normalized)
    if target is not source and (
        any(phrase in translated_text for phrase in HALLUCINATION_PHRASES)
        or (
            source_alnum >= 2
            and translated_alnum > max(48, source_alnum * 5)
        )
    ):
        return True
    meaningful = sum(character.isalpha() for character in source_normalized) >= 4
    if source_normalized == translated_normalized:
        if source is Language.JAPANESE and target is not source:
            japanese_letters = len(KANA_RE.findall(source_text)) + len(
                HAN_RE.findall(source_text)
            )
            if japanese_letters >= 2:
                return True
        if source is Language.KOREAN and target is not source:
            if len(HANGUL_RE.findall(source_text)) >= 2:
                return True
        if source is Language.ENGLISH and target is not source:
            latin_text = "".join(LATIN_RE.findall(source_text))
            interior_uppercase = any(character.isupper() for character in latin_text[1:])
            if len(latin_text) >= 4 and not latin_text.isupper() and not interior_uppercase:
                return True
        return meaningful and (len(source_normalized) >= 10 or " " in source_normalized)

    if target is Language.KOREAN:
        hangul = len(HANGUL_RE.findall(translated_text))
        if source is Language.JAPANESE:
            source_kana = len(KANA_RE.findall(source_text))
            source_han = len(HAN_RE.findall(source_text))
            remaining_kana = len(KANA_RE.findall(translated_text))
            remaining_han = len(HAN_RE.findall(translated_text))
            if hangul == 0 and (source_kana >= 2 or source_han >= 4):
                return True
            if hangul >= 2 and remaining_han and remaining_kana == 0:
                return True
            return remaining_kana >= max(5, round(hangul * 0.55))
        if source is Language.ENGLISH:
            source_latin = len(LATIN_RE.findall(source_text))
            remaining_latin = len(LATIN_RE.findall(translated_text))
            return (
                hangul == 0
                and source_latin >= 6
                and remaining_latin >= round(source_latin * 0.8)
                and (" " in source_text or len(source_text) >= 14)
            )

    if target is Language.ENGLISH and source is Language.JAPANESE:
        latin = len(LATIN_RE.findall(translated_text))
        remaining_kana = len(KANA_RE.findall(translated_text))
        return latin == 0 and remaining_kana >= 2

    if target is Language.JAPANESE and source in (Language.KOREAN, Language.ENGLISH):
        japanese = len(KANA_RE.findall(translated_text)) + len(HAN_RE.findall(translated_text))
        source_letters = sum(character.isalpha() for character in source_text)
        return japanese == 0 and source_letters >= 6 and " " in source_text

    return False


def _normalize(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())
