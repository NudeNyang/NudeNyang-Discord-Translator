from __future__ import annotations

import ctypes

from PySide6.QtCore import QPoint, QRect, Qt, Signal
from PySide6.QtGui import QColor, QMouseEvent, QPainter, QPen
from PySide6.QtWidgets import QWidget

from ..models import Rect


class RegionSelector(QWidget):
    selected = Signal(object)

    def __init__(self, bounds: Rect, dpi: int = 96) -> None:
        super().__init__(None)
        self.bounds = bounds
        self.dpi_scale = max(1.0, dpi / 96.0)
        self.origin: QPoint | None = None
        self.current: QPoint | None = None
        self.setWindowFlags(Qt.WindowType.FramelessWindowHint | Qt.WindowType.WindowStaysOnTopHint)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setCursor(Qt.CursorShape.CrossCursor)
        self.setGeometry(
            round(bounds.left / self.dpi_scale),
            round(bounds.top / self.dpi_scale),
            round(bounds.width / self.dpi_scale),
            round(bounds.height / self.dpi_scale),
        )

    def showEvent(self, event) -> None:  # noqa: N802
        super().showEvent(event)
        bounds = self.bounds
        ctypes.windll.user32.SetWindowPos(
            ctypes.c_void_p(int(self.winId())),
            ctypes.c_void_p(-1),
            bounds.left,
            bounds.top,
            bounds.width,
            bounds.height,
            0x0010 | 0x0040,
        )

    def mousePressEvent(self, event: QMouseEvent) -> None:  # noqa: N802
        if event.button() == Qt.MouseButton.LeftButton:
            self.origin = event.position().toPoint()
            self.current = self.origin
            self.update()

    def mouseMoveEvent(self, event: QMouseEvent) -> None:  # noqa: N802
        if self.origin is not None:
            self.current = event.position().toPoint()
            self.update()

    def mouseReleaseEvent(self, event: QMouseEvent) -> None:  # noqa: N802
        if self.origin is None or self.current is None:
            return
        logical = QRect(self.origin, self.current).normalized()
        selection = _logical_to_physical_rect(
            Rect(
                logical.left(),
                logical.top(),
                logical.right() + 1,
                logical.bottom() + 1,
            ),
            self.dpi_scale,
        )
        if selection.width >= 100 and selection.height >= 100:
            self.selected.emit(selection)
        self.close()

    def keyPressEvent(self, event) -> None:  # noqa: N802
        if event.key() == Qt.Key.Key_Escape:
            self.close()

    def paintEvent(self, event) -> None:  # noqa: N802
        del event
        painter = QPainter(self)
        painter.fillRect(self.rect(), QColor(0, 0, 0, 90))
        if self.origin is not None and self.current is not None:
            selection = QRect(self.origin, self.current).normalized()
            painter.setCompositionMode(QPainter.CompositionMode.CompositionMode_Clear)
            painter.fillRect(selection, Qt.GlobalColor.transparent)
            painter.setCompositionMode(QPainter.CompositionMode.CompositionMode_SourceOver)
            painter.setPen(QPen(QColor(88, 166, 255), 2))
            painter.drawRect(selection)


def _logical_to_physical_rect(rect: Rect, scale: float) -> Rect:
    return Rect(
        round(rect.left * scale),
        round(rect.top * scale),
        round(rect.right * scale),
        round(rect.bottom * scale),
    )
