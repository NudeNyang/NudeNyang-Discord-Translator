from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from enum import StrEnum
from hashlib import blake2b

import numpy as np


class Language(StrEnum):
    KOREAN = "ko"
    ENGLISH = "en"
    JAPANESE = "ja"
    CHINESE_SIMPLIFIED = "zh"
    CHINESE_TRADITIONAL = "zh-Hant"
    UNKNOWN = "und"


@dataclass(frozen=True, slots=True)
class Rect:
    left: int
    top: int
    right: int
    bottom: int

    @property
    def width(self) -> int:
        return max(0, self.right - self.left)

    @property
    def height(self) -> int:
        return max(0, self.bottom - self.top)

    @property
    def area(self) -> int:
        return self.width * self.height

    def translated(self, dx: int, dy: int) -> Rect:
        return Rect(self.left + dx, self.top + dy, self.right + dx, self.bottom + dy)

    def expanded(self, x: int, y: int | None = None) -> Rect:
        y = x if y is None else y
        return Rect(self.left - x, self.top - y, self.right + x, self.bottom + y)

    def clipped(self, width: int, height: int) -> Rect:
        return Rect(
            max(0, self.left),
            max(0, self.top),
            min(width, self.right),
            min(height, self.bottom),
        )

    def intersects(self, other: Rect) -> bool:
        return not (
            self.right <= other.left
            or other.right <= self.left
            or self.bottom <= other.top
            or other.bottom <= self.top
        )


@dataclass(slots=True)
class RecognitionCandidate:
    engine: str
    text: str
    confidence: float


@dataclass(slots=True)
class TextLine:
    polygon: np.ndarray
    bbox: Rect
    text: str
    confidence: float
    language: Language
    candidates: tuple[RecognitionCandidate, ...] = ()


@dataclass(frozen=True, slots=True)
class RenderInlineMedia:
    """A small Discord inline visual captured from the current chat frame."""

    bbox: Rect
    width: int
    height: int
    bgr: bytes
    alt_text: str = ""


@dataclass(slots=True)
class Message:
    bbox: Rect
    source_text: str
    source_language: Language
    translated_text: str = ""
    confidence: float = 0.0
    lines: list[TextLine] = field(default_factory=list)
    message_id: str = ""
    render_font_family: str = ""
    render_font_size: float = 0.0
    render_kind: str = ""
    render_container: Rect | None = None
    render_background_rgb: tuple[int, int, int] | None = None
    render_inline_media: tuple[RenderInlineMedia, ...] = ()

    def ensure_id(self) -> str:
        if not self.message_id:
            normalized = " ".join(self.source_text.split()).casefold()
            spatial_band = f"{self.bbox.left // 24}:{self.bbox.width // 24}"
            self.message_id = blake2b(
                f"{normalized}|{spatial_band}".encode(), digest_size=12
            ).hexdigest()
        return self.message_id


@dataclass(frozen=True, slots=True)
class WindowInfo:
    hwnd: int
    title: str
    window_rect: Rect
    client_rect: Rect
    dpi: int
    visible: bool
    minimized: bool


@dataclass(frozen=True, slots=True)
class OverlayStyle:
    background_rgb: tuple[int, int, int]
    foreground_rgb: tuple[int, int, int]
    opacity: float = 1.0
    font_family: str = "Segoe UI"
    font_scale: float = 1.0


def union_rect(rects: Iterable[Rect]) -> Rect:
    values = list(rects)
    if not values:
        return Rect(0, 0, 0, 0)
    return Rect(
        min(r.left for r in values),
        min(r.top for r in values),
        max(r.right for r in values),
        max(r.bottom for r in values),
    )
