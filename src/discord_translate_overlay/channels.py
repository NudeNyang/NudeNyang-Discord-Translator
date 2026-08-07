from __future__ import annotations

import hashlib
import re
import threading
import unicodedata
from dataclasses import dataclass

import cv2
import numpy as np

from .cache import TranslationCache
from .language import LanguageDetector, detect_explicit_language
from .models import Language, Message, OverlayStyle, Rect, TextLine
from .ocr.base import OcrEngine
from .rendering import attach_message_surfaces
from .theme import DISCORD_DARK, detect_theme
from .translation.base import Translator
from .translation.protected_text import ProtectedText, protect_text

BADGE_RE = re.compile(
    r"(?:새\s*메시지|new\s+messages?|新着メッセージ|읽지\s*않은|unread)",
    re.IGNORECASE,
)
CHROME_RE = re.compile(
    r"^(?:부스트\s*(?:목표|\d.*)|boost\s*goal.*|채널\s*(?:훑어|둘러).*|browse\s*channels?.*"
    r"|팔로우|follow)$",
    re.IGNORECASE,
)
SYSTEM_STATUS_RE = re.compile(
    r"^(?:\d{3,4}p\s+\d{2,3}\s*fps|음성\s*연결됨|voice\s*connected)$",
    re.IGNORECASE,
)
CHANNEL_CACHE_VERSION = "channel-names-v2"

# Short channel labels have too little sentence context for a general translator.
# These are Discord/community terms, not server-specific private data, so a small
# local glossary is both more natural and cheaper than repeatedly calling an API.
KOREAN_CHANNEL_GLOSSARY = {
    "お知らせ": "공지",
    "ルール": "규칙",
    "玄関": "입구",
    "自己紹介用": "자기소개",
    "通知設定": "알림 설정",
    "4kvrc": "",
    "4kvrc v": "",
    "4k動画設定": "4K 영상 설정",
    "設定質問相談総合": "설정 질문·상담",
    "4k動画展示場": "4K 영상 전시관",
    "vrchat": "",
    "その他雑談": "기타 잡담",
    "雑談総合": "자유 잡담",
    "部署": "부서",
    "録画部": "녹화팀",
    "錄画部": "녹화팀",
    "録画部総合": "녹화팀 종합",
    "錄画部総合": "녹화팀 종합",
    "編集部": "편집팀",
    "撮影用": "촬영",
    "影用": "촬영",
    "撮影依頼": "촬영 의뢰",
    "撮影練習": "촬영 연습",
    "voice": "음성",
}


@dataclass(frozen=True, slots=True)
class ChannelRegions:
    sidebar: Rect
    header: Rect


@dataclass(frozen=True, slots=True)
class ChannelNameResult:
    regions: ChannelRegions
    sidebar_messages: tuple[Message, ...]
    header_messages: tuple[Message, ...]
    sidebar_style: OverlayStyle
    header_style: OverlayStyle
    used_cache: int
    translated: int


def detect_channel_regions(frame_bgr: np.ndarray, chat_region: Rect, dpi: int) -> ChannelRegions:
    """Locate Discord's channel list and current-channel header in client coordinates."""
    height, width = frame_bgr.shape[:2]
    scale = max(1.0, dpi / 96.0)
    rail_right = min(chat_region.left, round(72 * scale))
    panel_width = chat_region.left - rail_right
    has_channel_panel = round(100 * scale) <= panel_width <= round(300 * scale)
    sidebar_top = min(height, round(88 * scale))
    sidebar_bottom = max(sidebar_top, height - round(124 * scale))
    # The overlay window may span the whole channel panel because it is
    # transparent outside each painted text box. Clipping it early leaves the
    # untranslated tail visible on longer channel names.
    sidebar_right = chat_region.left
    sidebar = Rect(rail_right, sidebar_top, sidebar_right, sidebar_bottom)
    if not has_channel_panel or sidebar.width < round(100 * scale):
        sidebar = Rect(0, 0, 0, 0)

    header_top = min(height, round(32 * scale))
    header_bottom = min(height, round(82 * scale))
    header_right = min(chat_region.right, chat_region.left + round(420 * scale), width)
    header = Rect(chat_region.left, header_top, header_right, header_bottom)
    if (
        not has_channel_panel
        or header.width < round(80 * scale)
        or header.height < round(20 * scale)
    ):
        header = Rect(0, 0, 0, 0)
    return ChannelRegions(sidebar, header)


class ChannelNameProcessor:
    """OCR and translate Discord channel labels without touching message content."""

    def __init__(
        self,
        ocr: OcrEngine,
        translator: Translator,
        cache: TranslationCache,
        target: Language,
    ) -> None:
        self.ocr = ocr
        self.translator = translator
        self.cache = cache
        self.target = target
        self._digest = ""
        self._sidebar_messages: tuple[Message, ...] = ()
        self._header_messages: tuple[Message, ...] = ()
        self._lock = threading.Lock()

    def process(
        self,
        client_frame: np.ndarray,
        chat_region: Rect,
        dpi: int,
        *,
        force: bool = False,
        accessibility_sidebar: tuple[Message, ...] | None = None,
        accessibility_header: tuple[Message, ...] | None = None,
        accessibility_available: bool = False,
    ) -> ChannelNameResult | None:
        regions = detect_channel_regions(client_frame, chat_region, dpi)
        scale = max(1.0, dpi / 96.0)
        sidebar_scan = Rect(
            regions.sidebar.left,
            regions.sidebar.top,
            chat_region.left,
            regions.sidebar.bottom,
        )
        header_scan = Rect(
            regions.header.left,
            regions.header.top,
            min(chat_region.right, chat_region.left + round(420 * scale)),
            regions.header.bottom,
        )
        # Recognition benefits from surrounding pixels and complete rows, while
        # rendering must stop before unread badges and header action buttons.
        sidebar_crop = _crop(client_frame, sidebar_scan)
        header_crop = _crop(client_frame, header_scan)
        sidebar_style = detect_theme(sidebar_crop) if sidebar_crop.size else DISCORD_DARK
        header_style = detect_theme(header_crop) if header_crop.size else DISCORD_DARK
        semantic_messages = (
            *(accessibility_sidebar or ()),
            *(accessibility_header or ()),
        )
        digest = _image_digest(sidebar_crop, header_crop)
        if accessibility_available:
            digest += _semantic_digest(semantic_messages)
        with self._lock:
            target = self.target
            if not force and digest == self._digest:
                return None

        if accessibility_available and accessibility_sidebar:
            sidebar_messages = list(accessibility_sidebar)
        else:
            sidebar_lines = self.ocr.recognize(sidebar_crop) if sidebar_crop.size else []
            sidebar_messages = _sidebar_messages(
                sidebar_lines, regions.sidebar.width, regions.sidebar.height
            )
        if accessibility_available and accessibility_header:
            header_messages = list(accessibility_header)
        else:
            header_lines = self.ocr.recognize(header_crop) if header_crop.size else []
            header_messages = _header_messages(header_lines)
        attach_message_surfaces(sidebar_crop, sidebar_messages)
        attach_message_surfaces(header_crop, header_messages)
        used_cache, translated = self._translate(
            [*sidebar_messages, *header_messages], target
        )

        with self._lock:
            if target != self.target:
                return ChannelNameResult(
                    regions,
                    (),
                    (),
                    sidebar_style,
                    header_style,
                    used_cache,
                    translated,
                )
            self._digest = digest
            self._sidebar_messages = tuple(sidebar_messages)
            self._header_messages = tuple(header_messages)
            return ChannelNameResult(
                regions,
                self._sidebar_messages,
                self._header_messages,
                sidebar_style,
                header_style,
                used_cache,
                translated,
            )

    def _translate(self, messages: list[Message], target: Language) -> tuple[int, int]:
        used_cache = 0
        cache_namespace = f"{self.translator.cache_namespace}:{CHANNEL_CACHE_VERSION}"
        pending: dict[
            tuple[str, Language], list[tuple[Message, str, ProtectedText]]
        ] = {}
        for message in messages:
            if message.source_language in (target, Language.UNKNOWN):
                message.translated_text = ""
                continue
            protected = protect_text(message.source_text)
            if not protected.has_translatable_text:
                message.translated_text = ""
                continue
            glossary_translation = _protected_glossary_translation(protected, target)
            if glossary_translation is not None:
                message.translated_text = glossary_translation
                continue
            key = message.ensure_id()
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
            identity = (protected.masked, message.source_language)
            pending.setdefault(identity, []).append((message, key, protected))

        identities = list(pending)
        translated_texts = self.translator.translate_many(identities, target) if identities else []
        if len(translated_texts) != len(identities):
            raise RuntimeError("채널명 번역 결과 수가 요청 수와 달라.")

        for identity, translated_text in zip(identities, translated_texts, strict=True):
            _masked_text, source_language = identity
            for message, key, protected in pending[identity]:
                restored_text = protected.restore(translated_text)
                message.translated_text = restored_text
                if self.translator.should_cache(
                    message.source_text, restored_text, source_language, target
                ):
                    self.cache.put(
                        key,
                        message.source_text,
                        source_language,
                        target,
                        restored_text,
                        cache_namespace,
                    )
        return used_cache, len(identities)

    def set_target(self, language: Language) -> None:
        with self._lock:
            if language == self.target:
                return
            self.target = language
            self._digest = ""
            self._sidebar_messages = ()
            self._header_messages = ()


def _sidebar_messages(lines: list[TextLine], width: int, height: int) -> list[Message]:
    detector = LanguageDetector()
    right_limit = width * 0.68
    messages: list[Message] = []
    for original_line in sorted(lines, key=lambda item: (item.bbox.top, item.bbox.left)):
        line = _channel_body_line(original_line)
        text = line.text.strip()
        if (
            line.confidence < 0.50
            or line.bbox.left >= right_limit
            or (line.bbox.left <= 4 and line.bbox.top >= height * 0.75)
            or BADGE_RE.search(text)
            or CHROME_RE.fullmatch(" ".join(text.split()))
            or SYSTEM_STATUS_RE.fullmatch(" ".join(text.split()))
            or _letter_count(text) < 2
        ):
            continue
        language = _resolved_language(text, line.language, detector)
        message = Message(
            bbox=line.bbox.expanded(2, 1).clipped(width, max(line.bbox.bottom + 2, 1)),
            source_text=text,
            source_language=language,
            confidence=line.confidence,
            lines=[line],
        )
        message.ensure_id()
        messages.append(message)
    return messages


def _channel_glossary_translation(text: str, target: Language) -> str | None:
    if target is not Language.KOREAN:
        return None
    normalized = (
        unicodedata.normalize("NFKC", text)
        .strip()
        .lstrip("#|│┃┊┆・･-— ")
        .strip()
    )
    important = re.fullmatch(r"([1-3])大事なお話\1", normalized)
    if important:
        return f"중요 공지 {important.group(1)}"
    return KOREAN_CHANNEL_GLOSSARY.get(normalized.casefold())


def _protected_glossary_translation(
    protected: ProtectedText, target: Language
) -> str | None:
    core = protected.masked
    for index in range(len(protected.tokens)):
        core = core.replace(f"ZXQKEEP{index:03d}QXZ", "")
    core = core.strip()
    translated = _channel_glossary_translation(core, target)
    if translated is None:
        return None
    masked_translation = protected.masked.replace(core, translated, 1)
    return protected.restore(masked_translation)


def _header_messages(lines: list[TextLine]) -> list[Message]:
    lines = [_channel_body_line(line) for line in lines]
    candidates = [
        line
        for line in lines
        if line.confidence >= 0.50 and _letter_count(line.text.strip()) >= 2
    ]
    if not candidates:
        return []
    line = min(candidates, key=lambda item: item.bbox.left)
    text = line.text.strip()
    detector = LanguageDetector()
    language = _resolved_language(text, line.language, detector)
    message = Message(
        bbox=line.bbox.expanded(2, 1),
        source_text=text,
        source_language=language,
        confidence=line.confidence,
        lines=[line],
    )
    message.ensure_id()
    return [message]


def _channel_body_line(line: TextLine) -> TextLine:
    """Keep Discord's leading #/speaker/custom-emoji pixels out of the paint box."""
    text = line.text.strip()
    body_start = next(
        (
            index
            for index, character in enumerate(text)
            if character.isalpha() or character.isdigit()
        ),
        0,
    )
    if body_start <= 0:
        return line
    body = text[body_start:].strip()
    if _letter_count(body) < 2:
        return line
    total_units = max(1, _visual_units(text))
    prefix_units = _visual_units(text[:body_start])
    left = min(
        line.bbox.right - 1,
        line.bbox.left + max(1, round(line.bbox.width * prefix_units / total_units)),
    )
    bbox = Rect(left, line.bbox.top, line.bbox.right, line.bbox.bottom)
    polygon = np.array(
        [
            [bbox.left, bbox.top],
            [bbox.right, bbox.top],
            [bbox.right, bbox.bottom],
            [bbox.left, bbox.bottom],
        ]
    )
    return TextLine(
        polygon=polygon,
        bbox=bbox,
        text=body,
        confidence=line.confidence,
        language=line.language,
        candidates=line.candidates,
    )


def _visual_units(text: str) -> int:
    return sum(
        2 if unicodedata.east_asian_width(character) in {"W", "F"} else 1
        for character in text
    )


def _resolved_language(
    text: str, reported: Language, detector: LanguageDetector
) -> Language:
    explicit = detect_explicit_language(text)
    if explicit is not Language.UNKNOWN:
        detector.detect(text)
        return explicit
    contextual = detector.detect(text)
    return reported if contextual is Language.UNKNOWN else contextual


def _letter_count(text: str) -> int:
    return sum(unicodedata.category(character).startswith("L") for character in text)


def _crop(frame: np.ndarray, rect: Rect) -> np.ndarray:
    if rect.area == 0:
        return np.empty((0, 0, 3), dtype=frame.dtype)
    return frame[rect.top : rect.bottom, rect.left : rect.right]


def _image_digest(*images: np.ndarray) -> str:
    digest = hashlib.blake2b(digest_size=16)
    for image in images:
        if not image.size:
            digest.update(b"empty")
            continue
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        sample = cv2.resize(gray, (64, 64), interpolation=cv2.INTER_AREA)
        digest.update(sample.tobytes())
    return digest.hexdigest()


def _semantic_digest(messages: tuple[Message, ...]) -> str:
    digest = hashlib.blake2b(digest_size=16)
    for message in messages:
        digest.update(message.message_id.encode("utf-8", errors="replace"))
        digest.update(b"\0")
        digest.update(message.source_text.encode("utf-8", errors="replace"))
        digest.update(
            f"|{message.bbox.left},{message.bbox.top},{message.bbox.right},{message.bbox.bottom}"
            .encode()
        )
    return digest.hexdigest()
