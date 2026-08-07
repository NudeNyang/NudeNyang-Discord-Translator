from __future__ import annotations

import ctypes

from PySide6.QtCore import QRect, Qt, QTimer
from PySide6.QtGui import (
    QColor,
    QFont,
    QFontDatabase,
    QFontMetrics,
    QImage,
    QPainter,
    QPaintEvent,
    QRegion,
)
from PySide6.QtWidgets import QWidget

from ..layout import LayoutEngine, RenderMode
from ..models import Message, OverlayStyle, Rect, RenderInlineMedia
from ..ocr.message_grouper import PRESERVED_INLINE_ENGINE

GWL_EXSTYLE = -20
WS_EX_TRANSPARENT = 0x00000020
WS_EX_LAYERED = 0x00080000
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_NOACTIVATE = 0x08000000
WDA_EXCLUDEFROMCAPTURE = 0x00000011
HWND_TOPMOST = -1
SWP_NOACTIVATE = 0x0010
SWP_SHOWWINDOW = 0x0040

user32 = ctypes.windll.user32
user32.SetWindowPos.argtypes = [
    ctypes.c_void_p,
    ctypes.c_void_p,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_uint,
]
user32.SetWindowPos.restype = ctypes.c_int


class TranslationOverlay(QWidget):
    def __init__(
        self,
        *,
        base_font_size: int = 15,
        constrain_to_source_width: bool = False,
        single_line: bool = False,
    ) -> None:
        super().__init__(None)
        self.setWindowTitle("Discord Translation Overlay")
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.Tool
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.WindowDoesNotAcceptFocus
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)
        self._messages: tuple[Message, ...] = ()
        self._style = OverlayStyle((49, 51, 56), (219, 222, 225))
        self._physical_rect = Rect(0, 0, 0, 0)
        self._dpi_scale = 1.0
        self._font_scale = 1.0
        self._show_original = False
        self._base_font_size = base_font_size
        self._constrain_to_source_width = constrain_to_source_width
        self._single_line = single_line
        self._layout = LayoutEngine()

    def showEvent(self, event) -> None:  # noqa: N802
        super().showEvent(event)
        hwnd = int(self.winId())
        style = user32.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)
        user32.SetWindowLongPtrW(
            hwnd,
            GWL_EXSTYLE,
            style | WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
        )
        # Prevent Desktop Duplication from feeding translated pixels back into OCR.
        # Available since Windows 10 2004; failure is handled by the controller fallback.
        user32.SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)
        self._apply_physical_geometry()
        QTimer.singleShot(0, self._apply_physical_geometry)

    def set_target_rect(self, rect: Rect, dpi: int) -> None:
        if rect == self._physical_rect and abs(self._dpi_scale - dpi / 96.0) < 0.01:
            return
        self._physical_rect = rect
        self._dpi_scale = max(1.0, dpi / 96.0)
        self.setGeometry(
            round(rect.left / self._dpi_scale),
            round(rect.top / self._dpi_scale),
            round(rect.width / self._dpi_scale),
            round(rect.height / self._dpi_scale),
        )
        if self.isVisible():
            self._apply_physical_geometry()

    def _apply_physical_geometry(self) -> None:
        if self._physical_rect.area == 0:
            return
        rect = self._physical_rect
        succeeded = user32.SetWindowPos(
            ctypes.c_void_p(int(self.winId())),
            ctypes.c_void_p(HWND_TOPMOST),
            rect.left,
            rect.top,
            rect.width,
            rect.height,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
        if not succeeded:
            raise ctypes.WinError()

    def set_messages(
        self,
        messages: tuple[Message, ...],
        style: OverlayStyle,
        *,
        font_scale: float = 1.0,
        show_original: bool = False,
    ) -> None:
        self._messages = messages
        self._style = style
        self._font_scale = font_scale
        self._show_original = show_original
        self.update()

    @property
    def has_visible_text(self) -> bool:
        return any(
            message.source_text if self._show_original else message.translated_text
            for message in self._messages
        )

    def paintEvent(self, event: QPaintEvent) -> None:  # noqa: N802
        del event
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.TextAntialiasing)
        foreground = QColor(*self._style.foreground_rgb)
        ordered = sorted(self._messages, key=lambda message: message.bbox.top)
        for index, message in enumerate(ordered):
            text = message.source_text if self._show_original else message.translated_text
            if not text:
                continue
            local = _logical_rect(message.bbox, self._dpi_scale)
            media_holes = _inline_media_holes(message, self._dpi_scale)
            clone = Message(
                bbox=local,
                source_text=message.source_text,
                source_language=message.source_language,
                translated_text=text,
                render_font_family=message.render_font_family,
                render_font_size=message.render_font_size,
                render_kind=message.render_kind,
                render_container=(
                    _logical_rect(message.render_container, self._dpi_scale)
                    if message.render_container is not None
                    else None
                ),
                render_background_rgb=message.render_background_rgb,
                render_inline_media=message.render_inline_media,
            )
            obstacles = [_logical_rect(item.bbox, self._dpi_scale) for item in ordered[index + 1 :]]
            base_size = _message_font_size(
                message, self._base_font_size, self._font_scale
            )
            font_family = _message_font_family(message, self._style.font_family)
            font_metrics = QFontMetrics(QFont(font_family, base_size))
            available_right = (
                local.right
                if self._constrain_to_source_width
                else _viewport_content_right(self.width())
            )
            if self._single_line:
                layout = self._layout.layout_single_line(
                    clone,
                    base_size,
                    max(9, base_size - 2),
                )
            else:
                media_width = max(1, available_right - local.left - 8)
                composed_media_height = _inline_media_flow_height(
                    message,
                    self._dpi_scale,
                    media_width,
                    font_metrics.height(),
                )
                reserved_height = max(
                    0,
                    _card_text_top(local, local, 4, media_holes) - (local.top + 4),
                )
                layout = self._layout.layout_hybrid(
                    clone,
                    base_size,
                    available_right,
                    obstacles,
                    force_card=bool(media_holes or message.render_inline_media),
                    reserved_height=reserved_height,
                    trailing_height=composed_media_height,
                    font_family=font_family,
                )
            rect = QRect(
                layout.rect.left,
                layout.rect.top,
                layout.rect.width,
                layout.rect.height,
            )
            clip = QRegion(rect)
            for hole in media_holes:
                logical_hole = QRect(hole.left, hole.top, hole.width, hole.height)
                clip = clip.subtracted(QRegion(logical_hole))
            painter.save()
            painter.setClipRegion(clip)
            background = QColor(
                *(message.render_background_rgb or self._style.background_rgb)
            )
            background.setAlphaF(max(0.0, min(1.0, self._style.opacity)))
            painter.fillRect(rect, background)
            painter.setPen(foreground)
            painter.setFont(
                QFont(
                    font_family,
                    layout.font_size,
                )
            )
            flags = (
                Qt.TextFlag.TextSingleLine
                | Qt.AlignmentFlag.AlignLeft
                | Qt.AlignmentFlag.AlignVCenter
                if self._single_line
                else Qt.TextFlag.TextWordWrap
                | Qt.AlignmentFlag.AlignLeft
                | Qt.AlignmentFlag.AlignTop
            )
            inset = layout.padding if layout.mode is RenderMode.CARD else 1
            text_rect = rect.adjusted(inset, inset, -inset, -inset)
            if layout.mode is RenderMode.CARD:
                text_rect.setTop(
                    _card_text_top(layout.rect, local, layout.padding, media_holes)
                )
            if not self._single_line and message.render_inline_media:
                text_rect.setBottom(
                    max(text_rect.top(), text_rect.bottom() - composed_media_height)
                )
            painter.drawText(text_rect, flags, layout.text)
            if not self._single_line and message.render_inline_media:
                text_bounds = QFontMetrics(painter.font()).boundingRect(
                    QRect(0, 0, max(1, text_rect.width()), 10_000),
                    flags,
                    layout.text,
                )
                media_top = min(
                    text_rect.top() + text_bounds.height() + 2,
                    rect.bottom() - inset - composed_media_height,
                )
                for media, media_rect in _inline_media_positions(
                    message,
                    self._dpi_scale,
                    Rect(
                        text_rect.left(),
                        media_top,
                        text_rect.right(),
                        rect.bottom() - inset,
                    ),
                    QFontMetrics(painter.font()).height(),
                ):
                    source = QImage(
                        media.bgr,
                        media.width,
                        media.height,
                        media.width * 3,
                        QImage.Format.Format_BGR888,
                    ).copy()
                    painter.drawImage(
                        QRect(
                            media_rect.left,
                            media_rect.top,
                            media_rect.width,
                            media_rect.height,
                        ),
                        source,
                    )
            if layout.overflow:
                painter.drawText(
                    rect.adjusted(0, 0, -3, -1),
                    Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignBottom,
                    "…",
                )
            painter.restore()
        painter.end()


def _logical_rect(rect: Rect, scale: float) -> Rect:
    return Rect(
        round(rect.left / scale),
        round(rect.top / scale),
        round(rect.right / scale),
        round(rect.bottom / scale),
    )


def _viewport_content_right(viewport_width: int, margin: int = 6) -> int:
    """Use one stable right edge instead of each OCR fragment's varying width."""
    return max(0, viewport_width - margin)


def _message_font_size(message: Message, default_size: int, scale: float) -> int:
    source_size = message.render_font_size if message.render_font_size > 0 else default_size
    return max(9, int(source_size * scale + 0.5))


def _message_font_family(message: Message, default_family: str) -> str:
    candidate = message.render_font_family.strip()
    installed = {
        family.casefold(): family for family in QFontDatabase.families()
    }
    if not installed:
        return default_family
    if candidate and candidate.casefold() in installed:
        return installed[candidate.casefold()]
    text = message.translated_text or message.source_text
    return _preferred_script_font(text, default_family, installed)


def _preferred_script_font(
    text: str,
    default_family: str,
    installed: dict[str, str],
) -> str:
    if any("\uac00" <= character <= "\ud7a3" for character in text):
        candidates = ("Noto Sans KR", "Malgun Gothic", "맑은 고딕")
    elif any(
        "\u3040" <= character <= "\u30ff" or "\u31f0" <= character <= "\u31ff"
        for character in text
    ):
        candidates = ("Noto Sans JP", "Yu Gothic UI", "Meiryo UI")
    elif any("\u3400" <= character <= "\u9fff" for character in text):
        candidates = (
            "Microsoft YaHei UI",
            "Microsoft JhengHei UI",
            "Noto Sans CJK SC",
            "Noto Sans",
        )
    else:
        candidates = ("Noto Sans",)
    for family in candidates:
        if family.casefold() in installed:
            return installed[family.casefold()]
    return installed.get(default_family.casefold(), default_family)


def _inline_media_holes(message: Message, scale: float) -> list[Rect]:
    holes: list[Rect] = []
    for line in message.lines:
        for candidate in line.candidates:
            if candidate.engine != PRESERVED_INLINE_ENGINE:
                continue
            try:
                left, top, right, bottom = (
                    int(value) for value in candidate.text.split(",", maxsplit=3)
                )
            except (TypeError, ValueError):
                continue
            physical = Rect(left, top, right, bottom).expanded(2)
            holes.append(_logical_rect(physical, scale))
    return holes


def _inline_media_flow_height(
    message: Message,
    scale: float,
    width: int,
    line_height: int,
) -> int:
    if not message.render_inline_media:
        return 0
    positions = _inline_media_positions(
        message,
        scale,
        Rect(0, 0, max(1, width), 10_000),
        line_height,
    )
    return max((rect.bottom for _media, rect in positions), default=0) + 2


def _inline_media_positions(
    message: Message,
    scale: float,
    bounds: Rect,
    line_height: int,
) -> list[tuple[RenderInlineMedia, Rect]]:
    gap = 3
    x = bounds.left
    y = bounds.top
    row_height = 0
    positions = []
    target_height = max(10, line_height)
    for media in message.render_inline_media:
        logical_width = max(1, round(media.width / max(1.0, scale)))
        logical_height = max(1, round(media.height / max(1.0, scale)))
        factor = min(1.0, target_height / logical_height)
        draw_width = max(1, round(logical_width * factor))
        draw_height = max(1, round(logical_height * factor))
        if x > bounds.left and x + draw_width > bounds.right:
            x = bounds.left
            y += row_height + gap
            row_height = 0
        if y + draw_height > bounds.bottom:
            break
        rect = Rect(x, y, min(bounds.right, x + draw_width), y + draw_height)
        positions.append((media, rect))
        x = rect.right + gap
        row_height = max(row_height, draw_height)
    return positions


def _card_text_top(
    card: Rect,
    source: Rect,
    padding: int,
    holes: list[Rect],
) -> int:
    top = card.top + padding
    preserved = [hole.bottom + 2 for hole in holes if hole.intersects(source)]
    return max([top, *preserved])
