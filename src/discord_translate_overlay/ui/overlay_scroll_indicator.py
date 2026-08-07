from __future__ import annotations

import math

from PySide6.QtCore import (
    Property,
    QEasingCurve,
    QEvent,
    QObject,
    QPoint,
    QPropertyAnimation,
    QRect,
    Qt,
    QTimer,
)
from PySide6.QtGui import QColor, QCursor, QMouseEvent, QPainter, QWheelEvent
from PySide6.QtWidgets import QApplication, QScrollArea, QWidget


class _IndicatorTrack(QWidget):
    def __init__(self, controller: OverlayScrollIndicatorController, parent: QWidget) -> None:
        super().__init__(parent)
        self._controller = controller
        self._opacity = 0.0
        self._thumb_width = 3.0
        self._thumb_alpha = 0.46
        self.setCursor(Qt.CursorShape.ArrowCursor)
        self.setMouseTracking(True)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)

    def _get_opacity(self) -> float:
        return self._opacity

    def _set_opacity(self, value: float) -> None:
        self._opacity = value
        self.update()

    opacity = Property(float, _get_opacity, _set_opacity)

    def _get_thumb_width(self) -> float:
        return self._thumb_width

    def _set_thumb_width(self, value: float) -> None:
        self._thumb_width = value
        self.update()

    thumbWidth = Property(float, _get_thumb_width, _set_thumb_width)

    def _get_thumb_alpha(self) -> float:
        return self._thumb_alpha

    def _set_thumb_alpha(self, value: float) -> None:
        self._thumb_alpha = value
        self.update()

    thumbAlpha = Property(float, _get_thumb_alpha, _set_thumb_alpha)

    def paintEvent(self, _event) -> None:
        metrics = self._controller.metrics()
        if not metrics[0] or self._opacity <= 0.001:
            return
        _, thumb_height, thumb_top, _travel = metrics
        color = QColor(self._controller.accent_color())
        color.setAlphaF(max(0.0, min(1.0, self._opacity * self._thumb_alpha)))
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(color)
        right_margin = 2.0 if self._thumb_width > 4.0 else 3.0
        x = self.width() - right_margin - self._thumb_width
        painter.drawRoundedRect(
            x,
            thumb_top,
            self._thumb_width,
            thumb_height,
            min(3.0, self._thumb_width / 2.0),
            min(3.0, self._thumb_width / 2.0),
        )

    def enterEvent(self, _event) -> None:
        self._controller.set_near(True)
        self._controller.set_emphasis(True)

    def leaveEvent(self, _event) -> None:
        self._controller.set_emphasis(self._controller.dragging)
        if not self._controller.dragging:
            self._controller.update_proximity(QCursor.pos())

    def mousePressEvent(self, event: QMouseEvent) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self._controller.start_drag(event.position().y())
            event.accept()
            return
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event: QMouseEvent) -> None:
        if self._controller.dragging and event.buttons() & Qt.MouseButton.LeftButton:
            self._controller.scroll_to_pointer(event.position().y())
            event.accept()
            return
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event: QMouseEvent) -> None:
        if self._controller.dragging and event.button() == Qt.MouseButton.LeftButton:
            self._controller.finish_drag()
            event.accept()
            return
        super().mouseReleaseEvent(event)

    def wheelEvent(self, event: QWheelEvent) -> None:
        self._controller.forward_wheel(event)


class OverlayScrollIndicatorController(QObject):
    """A PySide port of Sentory's proximity-revealed overlay scroll indicator."""

    REVEAL_DISTANCE = 44.0
    ACTIVE_MILLISECONDS = 1200

    def __init__(self, scroll_area: QScrollArea, surface: QWidget, color_provider) -> None:
        super().__init__(surface)
        self.scroll_area = scroll_area
        self.surface = surface
        self._color_provider = color_provider
        self.dragging = False
        self._near = False
        self._active = False
        self._shown = False
        self._emphasized = False
        self._disposed = False

        self.track = _IndicatorTrack(self, scroll_area.viewport())
        self.track.raise_()
        self._hide_timer = QTimer(self)
        self._hide_timer.setSingleShot(True)
        self._hide_timer.setInterval(self.ACTIVE_MILLISECONDS)
        self._hide_timer.timeout.connect(self._hide_after_activity)

        self._opacity_animation = self._animation(b"opacity", 160)
        self._width_animation = self._animation(b"thumbWidth", 140)
        self._alpha_animation = self._animation(b"thumbAlpha", 140)

        bar = self.scroll_area.verticalScrollBar()
        bar.valueChanged.connect(self._scroll_changed)
        bar.rangeChanged.connect(lambda _minimum, _maximum: self.update())
        self.scroll_area.viewport().installEventFilter(self)
        app = QApplication.instance()
        if app is not None:
            app.installEventFilter(self)
        surface.destroyed.connect(self.dispose)
        QTimer.singleShot(0, self.update)

    def _animation(self, property_name: bytes, duration: int) -> QPropertyAnimation:
        animation = QPropertyAnimation(self.track, property_name, self)
        animation.setDuration(duration)
        animation.setEasingCurve(QEasingCurve.Type.OutCubic)
        return animation

    def accent_color(self) -> str:
        return self._color_provider()

    def metrics(self) -> tuple[bool, float, float, float]:
        bar = self.scroll_area.verticalScrollBar()
        track_height = max(0.0, float(self.track.height()))
        viewport_height = max(0.0, float(self.scroll_area.viewport().height()))
        scrollable = bar.maximum() > bar.minimum() and track_height > 0 and viewport_height > 0
        if not scrollable:
            return False, 0.0, 0.0, 0.0
        extent_height = viewport_height + float(bar.maximum() - bar.minimum())
        thumb_height = max(32.0, track_height * viewport_height / max(extent_height, 1.0))
        thumb_height = min(track_height, thumb_height)
        travel = max(0.0, track_height - thumb_height)
        ratio = (bar.value() - bar.minimum()) / max(1, bar.maximum() - bar.minimum())
        return True, thumb_height, travel * ratio, travel

    def eventFilter(self, watched: QObject, event: QEvent) -> bool:
        if self._disposed:
            return False
        event_type = event.type()
        if watched is self.scroll_area.viewport() and event_type in {
            QEvent.Type.Resize,
            QEvent.Type.Show,
        }:
            QTimer.singleShot(0, self.update)
        if event_type == QEvent.Type.MouseMove and self.surface.isVisible():
            self.update_proximity(QCursor.pos())
        elif event_type == QEvent.Type.Leave and watched is self.surface and not self.dragging:
            self.set_near(False)
        return False

    def update(self) -> None:
        viewport = self.scroll_area.viewport()
        self.track.setGeometry(max(0, viewport.width() - 10), 0, 10, viewport.height())
        self.track.raise_()
        scrollable = self.metrics()[0]
        self.track.setEnabled(scrollable)
        if not scrollable:
            self._hide_timer.stop()
            self._near = False
            self._active = False
            self.set_emphasis(False)
            self._set_shown(False)
        else:
            self._update_visibility()
        self.track.update()

    def _scroll_changed(self, _value: int) -> None:
        self.update()
        if not self.metrics()[0]:
            return
        self._active = True
        self._hide_timer.start()
        self._update_visibility()

    def _hide_after_activity(self) -> None:
        self._active = False
        self._update_visibility()

    def update_proximity(self, global_position: QPoint) -> None:
        if self.dragging:
            self.set_near(True)
            return
        if not self.metrics()[0]:
            self.set_near(False)
            return
        top_left = self.track.mapToGlobal(QPoint(0, 0))
        bounds = QRect(top_left, self.track.size())
        x = global_position.x()
        y = global_position.y()
        dx = max(bounds.left() - x, 0, x - bounds.right())
        dy = max(bounds.top() - y, 0, y - bounds.bottom())
        self.set_near(math.hypot(dx, dy) <= self.REVEAL_DISTANCE)

    def set_near(self, value: bool) -> None:
        if self._near == value:
            return
        self._near = value
        self._update_visibility()

    def _update_visibility(self) -> None:
        self._set_shown(self.metrics()[0] and (self._near or self._active or self.dragging))

    def _set_shown(self, value: bool) -> None:
        if self._shown == value:
            return
        self._shown = value
        self._animate(self._opacity_animation, 1.0 if value else 0.0)

    def set_emphasis(self, value: bool) -> None:
        if self._emphasized == value:
            return
        self._emphasized = value
        self._animate(self._width_animation, 6.0 if value else 3.0)
        self._animate(self._alpha_animation, 0.95 if value else 0.46)

    @staticmethod
    def _animate(animation: QPropertyAnimation, value: float) -> None:
        animation.stop()
        animation.setEndValue(value)
        animation.start()

    def start_drag(self, y: float) -> None:
        if not self.metrics()[0]:
            return
        self.dragging = True
        self._active = True
        self._hide_timer.stop()
        self.set_near(True)
        self.set_emphasis(True)
        self.track.grabMouse()
        self.scroll_to_pointer(y)

    def scroll_to_pointer(self, y: float) -> None:
        scrollable, thumb_height, _thumb_top, travel = self.metrics()
        if not scrollable or travel <= 0:
            return
        top = max(0.0, min(travel, y - thumb_height / 2.0))
        bar = self.scroll_area.verticalScrollBar()
        value = bar.minimum() + round(top / travel * (bar.maximum() - bar.minimum()))
        bar.setValue(value)

    def finish_drag(self) -> None:
        self.dragging = False
        self.track.releaseMouse()
        self.set_emphasis(self.track.underMouse())
        self.update_proximity(QCursor.pos())
        self._update_visibility()

    def forward_wheel(self, event: QWheelEvent) -> None:
        bar = self.scroll_area.verticalScrollBar()
        delta = event.angleDelta().y()
        if delta == 0:
            event.ignore()
            return
        steps = max(1, abs(delta) // 120)
        direction = -1 if delta > 0 else 1
        bar.setValue(bar.value() + direction * steps * max(20, bar.singleStep() * 3))
        event.accept()

    def dispose(self, *_args) -> None:
        if self._disposed:
            return
        self._disposed = True
        self._hide_timer.stop()
        app = QApplication.instance()
        if app is not None:
            app.removeEventFilter(self)
