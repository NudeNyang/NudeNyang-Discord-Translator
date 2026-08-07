from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from PySide6.QtCore import QRect, Qt
from PySide6.QtGui import QFont, QFontMetrics

from .models import Message, Rect


class RenderMode(StrEnum):
    REPLACE = "replace"
    CARD = "card"
    SINGLE_LINE = "single-line"


@dataclass(frozen=True, slots=True)
class TextLayout:
    rect: Rect
    font_size: int
    text: str
    mode: RenderMode = RenderMode.REPLACE
    overflow: bool = False
    padding: int = 0


class LayoutEngine:
    """Wrap, then shrink, then expand vertically, in that order."""

    def __init__(self, font_family: str = "Segoe UI", min_font_size: int = 10) -> None:
        self.font_family = font_family
        self.min_font_size = min_font_size

    def layout(
        self,
        message: Message,
        base_font_size: int,
        available_width: int,
        obstacles: list[Rect] | None = None,
        minimum_font_size: int | None = None,
    ) -> TextLayout:
        text = message.translated_text or message.source_text
        natural_right = message.bbox.left + self._natural_width(
            text, base_font_size
        )
        initial = Rect(
            message.bbox.left,
            message.bbox.top,
            min(available_width, max(message.bbox.right, natural_right)),
            message.bbox.bottom,
        )
        obstacles = obstacles or []
        minimum = self.min_font_size if minimum_font_size is None else minimum_font_size
        minimum = min(base_font_size, max(1, minimum))
        for size in range(base_font_size, minimum - 1, -1):
            needed = self._height(text, initial.width, size)
            if needed <= initial.height:
                return TextLayout(initial, size, text)

        needed = self._height(text, initial.width, minimum)
        expanded = Rect(initial.left, initial.top, initial.right, initial.top + needed)
        collision = next(
            (o for o in obstacles if expanded.intersects(o) and o.top > initial.top), None
        )
        if collision:
            expanded = Rect(
                expanded.left, expanded.top, expanded.right, max(initial.bottom, collision.top - 2)
            )
        return TextLayout(expanded, minimum, text)

    def layout_single_line(
        self,
        message: Message,
        base_font_size: int,
        minimum_font_size: int,
    ) -> TextLayout:
        text = " ".join((message.translated_text or message.source_text).splitlines())
        minimum = min(base_font_size, max(1, minimum_font_size))
        for size in range(base_font_size, minimum - 1, -1):
            metrics = QFontMetrics(QFont(self.font_family, size))
            if metrics.horizontalAdvance(text) + 2 <= message.bbox.width:
                return TextLayout(
                    message.bbox, size, text, mode=RenderMode.SINGLE_LINE
                )
        metrics = QFontMetrics(QFont(self.font_family, minimum))
        elided = metrics.elidedText(
            text,
            Qt.TextElideMode.ElideRight,
            max(1, message.bbox.width - 2),
        )
        return TextLayout(
            message.bbox, minimum, elided, mode=RenderMode.SINGLE_LINE
        )

    def layout_hybrid(
        self,
        message: Message,
        base_font_size: int,
        available_right: int,
        obstacles: list[Rect] | None = None,
        *,
        force_card: bool = False,
        reserved_height: int = 0,
        trailing_height: int = 0,
        font_family: str | None = None,
    ) -> TextLayout:
        """Replace text in-place when it fits, otherwise use one stable card.

        The card keeps a readable font and a single surface instead of allowing
        independently detected fragments to grow into differently sized patches.
        UI Automation supplies ``render_container`` so rich content below the
        text remains outside the card.
        """

        text = message.translated_text or message.source_text
        source = message.bbox
        measuring_family = font_family or self.font_family
        if (
            not force_card
            and self._height(
                text,
                max(1, source.width - 2),
                base_font_size,
                measuring_family,
            )
            <= source.height + 2
        ):
            return TextLayout(source, base_font_size, text)

        obstacles = obstacles or []
        padding = 4
        container = message.render_container
        right = min(
            available_right,
            max(source.right, container.right if container is not None else available_right),
        )
        right = max(source.right, right)
        card_width = max(1, right - source.left - padding * 2)
        # Discord's Chromium font size is reported in CSS points. A translated
        # CJK fallback can be several pixels taller than gg sans/Segoe UI at the
        # same nominal size, so allow a readable 25% reduction before clipping.
        minimum = max(8, round(base_font_size * 0.75))

        natural_bottom = (
            source.top
            + reserved_height
            + self._height(text, card_width, base_font_size, measuring_family)
            + trailing_height
            + padding * 2
        )
        if container is not None:
            bottom_limit = max(source.bottom, container.bottom)
        else:
            collision_top = min(
                (
                    obstacle.top - 2
                    for obstacle in obstacles
                    if obstacle.top > source.top and obstacle.left < right
                ),
                default=natural_bottom,
            )
            bottom_limit = max(source.bottom, collision_top)

        compact_width = max(1, right - source.left - 2)
        if (
            reserved_height == 0
            and trailing_height == 0
            and self._height(
                text,
                compact_width,
                base_font_size,
                measuring_family,
            )
            <= source.height + 2
        ):
            return TextLayout(
                Rect(source.left, source.top, right, source.bottom),
                base_font_size,
                text,
                mode=RenderMode.CARD,
                padding=1,
            )

        for size in range(base_font_size, minimum - 1, -1):
            needed = (
                reserved_height
                + self._height(text, card_width, size, measuring_family)
                + trailing_height
                + padding * 2
            )
            if source.top + needed <= bottom_limit:
                return TextLayout(
                    Rect(source.left, source.top, right, max(source.bottom, source.top + needed)),
                    size,
                    text,
                    mode=RenderMode.CARD,
                    padding=padding,
                )

        return TextLayout(
            Rect(source.left, source.top, right, bottom_limit),
            minimum,
            text,
            mode=RenderMode.CARD,
            overflow=True,
            padding=padding,
        )

    def _height(
        self,
        text: str,
        width: int,
        size: int,
        font_family: str | None = None,
    ) -> int:
        font = QFont(font_family or self.font_family, size)
        metrics = QFontMetrics(font)
        bounds = metrics.boundingRect(
            QRect(0, 0, max(1, width), 10_000),
            Qt.TextFlag.TextWordWrap | Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignTop,
            text,
        )
        return max(metrics.height(), bounds.height()) + 2

    def _natural_width(self, text: str, size: int) -> int:
        metrics = QFontMetrics(QFont(self.font_family, size))
        longest = max((metrics.horizontalAdvance(line) for line in text.splitlines()), default=1)
        return max(1, longest + 6)
