from __future__ import annotations

from collections.abc import Callable

from PySide6.QtCore import QRectF, QSize, Qt
from PySide6.QtGui import QColor, QPainter, QPen
from PySide6.QtWidgets import QCheckBox

from .visuals import palette_for


class ToggleSwitch(QCheckBox):
    """Compact theme-aware toggle used by the settings window."""

    def __init__(self, text: str, theme_provider: Callable[[], str]) -> None:
        super().__init__(text)
        self._theme_provider = theme_provider
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setMinimumHeight(28)
        self.toggled.connect(lambda _checked: self.update())

    def sizeHint(self) -> QSize:
        label_width = self.fontMetrics().horizontalAdvance(self.text())
        return QSize(52 + label_width, 28)

    def paintEvent(self, _event) -> None:
        colors = palette_for(self._theme_provider())
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        opacity = 1.0 if self.isEnabled() else 0.45
        painter.setOpacity(opacity)

        track = QRectF(0.5, (self.height() - 22) / 2, 42, 22)
        checked = self.isChecked()
        fill = QColor(colors["accent"] if checked else colors["surface_alt"])
        border = QColor(colors["accent"] if checked else colors["border"])
        if self.underMouse() and self.isEnabled():
            border = QColor(colors["accent_hover"])
        painter.setPen(QPen(border, 1))
        painter.setBrush(fill)
        painter.drawRoundedRect(track, 11, 11)

        knob_x = 23.5 if checked else 3.5
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(QColor("#F7FCFC" if checked else colors["muted"]))
        painter.drawEllipse(QRectF(knob_x, (self.height() - 16) / 2, 16, 16))

        painter.setPen(QColor(colors["text"]))
        label_rect = QRectF(52, 0, max(0, self.width() - 52), self.height())
        painter.drawText(
            label_rect,
            Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
            self.text(),
        )

    def enterEvent(self, event) -> None:
        self.update()
        super().enterEvent(event)

    def leaveEvent(self, event) -> None:
        self.update()
        super().leaveEvent(event)
