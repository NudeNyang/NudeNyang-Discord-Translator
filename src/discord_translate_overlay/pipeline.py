from __future__ import annotations

import threading
from dataclasses import dataclass
from hashlib import blake2b

import numpy as np

from .cache import TranslationCache
from .capture.change_detector import ChangeDetector, ChangeResult
from .language import detect_explicit_language
from .models import Language, Message, Rect, TextLine
from .ocr.base import OcrEngine
from .ocr.message_grouper import group_message_lines
from .rendering import attach_message_surfaces
from .translation.base import Translator
from .translation.protected_text import ProtectedText, protect_text

PROTECTED_TEXT_CACHE_VERSION = "protected-text-v1"


@dataclass(frozen=True, slots=True)
class PipelineResult:
    messages: tuple[Message, ...]
    change: ChangeResult
    used_cache: int
    translated: int


class TranslationPipeline:
    def __init__(
        self,
        ocr: OcrEngine,
        translator: Translator,
        cache: TranslationCache,
        target: Language,
        change_detector: ChangeDetector | None = None,
    ) -> None:
        self.ocr = ocr
        self.translator = translator
        self.cache = cache
        self.target = target
        self.change_detector = change_detector or ChangeDetector()
        self._messages: list[Message] = []
        self._accessibility_digest = ""
        self._lock = threading.Lock()

    def process(
        self,
        frame_bgr: np.ndarray,
        *,
        force: bool = False,
        accessibility_messages: tuple[Message, ...] | None = None,
        accessibility_available: bool = False,
    ) -> PipelineResult | None:
        with self._lock:
            target = self.target
        change = self.change_detector.compare(frame_bgr)
        accessibility_digest = (
            _message_digest(accessibility_messages or ()) if accessibility_available else ""
        )
        accessibility_changed = (
            accessibility_available and accessibility_digest != self._accessibility_digest
        )
        if not force and not change.changed and not accessibility_changed:
            return None
        height, width = frame_bgr.shape[:2]
        full_refresh = (
            accessibility_available
            or force
            or change.ratio > 0.22
            or not self._messages
        )
        regions = [Rect(0, 0, width, height)] if full_refresh else _merge_regions(change.regions)

        if accessibility_available:
            # Exact Chromium accessibility text wins. OCR is deliberately not
            # run over rows UIA already understands, avoiding duplicate boxes,
            # OCR errors, and needless GPU/CPU work. If UIA exposes no message
            # rows, the controller passes accessibility_available=False and this
            # falls back to the original OCR path.
            found = list(accessibility_messages or ())
        else:
            found = []
            for region in regions:
                expanded = region.expanded(36, 52).clipped(width, height)
                crop = frame_bgr[expanded.top : expanded.bottom, expanded.left : expanded.right]
                lines = self.ocr.recognize(crop)
                adjusted = [_move_line(line, expanded.left, expanded.top) for line in lines]
                found.extend(group_message_lines(adjusted, width, frame_bgr))
        found.sort(key=lambda message: (message.bbox.top, message.bbox.left))
        attach_message_surfaces(frame_bgr, found)

        used_cache = 0
        translated = 0
        pending: list[tuple[Message, str, ProtectedText, str]] = []
        for message in found:
            if not _should_translate(message, target):
                # The original Discord pixels already show same-language text and
                # OCR noise correctly. Leaving this empty makes the overlay skip it.
                message.translated_text = ""
                continue
            protected = protect_text(message.source_text)
            if not protected.has_translatable_text:
                # Keep emoji/emoticon-only Discord pixels completely untouched.
                message.translated_text = ""
                continue
            key = message.ensure_id()
            cache_namespace = _cache_namespace(self.translator, protected)
            cached = self.cache.get_message(
                key,
                message.source_text,
                message.source_language,
                target,
                cache_namespace,
                allow_fuzzy=not protected.tokens,
            )
            cached_keeps_tokens = cached is not None and all(
                token in cached for token in protected.tokens
            )
            if cached_keeps_tokens and self.translator.should_cache(
                message.source_text,
                cached,
                message.source_language,
                target,
            ):
                message.translated_text = cached
                used_cache += 1
                continue
            pending.append((message, key, protected, cache_namespace))

        if pending:
            translated_texts = self.translator.translate_many(
                [
                    (protected.masked, message.source_language)
                    for message, _, protected, _ in pending
                ],
                target,
            )
            if len(translated_texts) != len(pending):
                raise RuntimeError("번역 엔진이 요청한 메시지 수와 다른 결과를 반환했어.")
        else:
            translated_texts = []

        for (message, key, protected, cache_namespace), translated_text in zip(
            pending, translated_texts, strict=True
        ):
            translated_text = protected.restore(translated_text)
            message.translated_text = translated_text
            if self.translator.should_cache(
                message.source_text,
                translated_text,
                message.source_language,
                target,
            ):
                self.cache.put(
                    key,
                    message.source_text,
                    message.source_language,
                    target,
                    translated_text,
                    cache_namespace,
                )
            translated += 1

        with self._lock:
            if target != self.target:
                # A target-language switch happened while OCR/translation was
                # running. Never expose results produced for the previous target.
                return PipelineResult((), change, used_cache, translated)
            if full_refresh:
                self._messages = found
            else:
                self._messages = [
                    old
                    for old in self._messages
                    if not any(old.bbox.intersects(region.expanded(40, 60)) for region in regions)
                ]
                self._messages.extend(found)
                self._messages.sort(key=lambda message: (message.bbox.top, message.bbox.left))
            self._accessibility_digest = accessibility_digest
            snapshot = tuple(self._messages)
        return PipelineResult(snapshot, change, used_cache, translated)

    def set_target(self, language: Language) -> None:
        with self._lock:
            if language == self.target:
                return
            self.target = language
            self._messages = []
            self._accessibility_digest = ""
        self.change_detector.reset()

    @property
    def messages(self) -> tuple[Message, ...]:
        with self._lock:
            return tuple(self._messages)


def _cache_namespace(translator: Translator, protected: ProtectedText) -> str:
    if not protected.tokens:
        return translator.cache_namespace
    return f"{translator.cache_namespace}:{PROTECTED_TEXT_CACHE_VERSION}"


def _move_line(line: TextLine, dx: int, dy: int) -> TextLine:
    polygon = line.polygon.copy()
    polygon[:, 0] += dx
    polygon[:, 1] += dy
    return TextLine(
        polygon=polygon,
        bbox=line.bbox.translated(dx, dy),
        text=line.text,
        confidence=line.confidence,
        language=line.language,
        candidates=line.candidates,
    )


def _should_translate(message: Message, target: Language) -> bool:
    explicit_language = detect_explicit_language(message.source_text)
    if explicit_language is not Language.UNKNOWN:
        # Message grouping and OCR confidence voting are useful for Han-only
        # lines, but explicit Hangul/Kana/Latin must win before any API call.
        message.source_language = explicit_language
    if message.source_language in (target, Language.UNKNOWN):
        return False
    stripped = message.source_text.strip()
    return not (
        message.source_language == Language.ENGLISH
        and len(stripped) == 1
        and stripped.isascii()
        and stripped.isalpha()
    )


def _merge_regions(regions: tuple[Rect, ...]) -> list[Rect]:
    merged: list[Rect] = []
    for candidate in regions:
        match = next((r for r in merged if r.expanded(24).intersects(candidate)), None)
        if match is None:
            merged.append(candidate)
        else:
            merged.remove(match)
            merged.append(
                Rect(
                    min(match.left, candidate.left),
                    min(match.top, candidate.top),
                    max(match.right, candidate.right),
                    max(match.bottom, candidate.bottom),
                )
            )
    return merged


def _message_digest(messages: tuple[Message, ...]) -> str:
    digest = blake2b(digest_size=16)
    for message in messages:
        digest.update(message.message_id.encode("utf-8", errors="replace"))
        digest.update(b"\0")
        digest.update(message.source_text.encode("utf-8", errors="replace"))
        digest.update(
            f"|{message.bbox.left},{message.bbox.top},{message.bbox.right},{message.bbox.bottom}"
            .encode()
        )
    return digest.hexdigest()
