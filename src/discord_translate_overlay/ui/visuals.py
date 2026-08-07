from __future__ import annotations

import ctypes
import sys

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import QColor, QIcon, QPainter, QPainterPath, QPen, QPixmap, QPolygonF
from PySide6.QtWidgets import QApplication

LIGHT = {
    "window": "#F7FAFB",
    "surface": "#FFFFFF",
    "surface_alt": "#EEF5F6",
    "popup_hover": "#E3F1F2",
    "border": "#CFDDE1",
    "text": "#172D35",
    "muted": "#647A82",
    "soft": "#83949A",
    "accent": "#0D7F7A",
    "accent_hover": "#0A716D",
    "accent_soft": "#DDF2EF",
    "accent_text": "#FFFFFF",
    "danger": "#C44747",
    "notice": "#EAF6F5",
    "notice_border": "#B8DAD7",
}

DARK = {
    "window": "#091319",
    "surface": "#101D23",
    "surface_alt": "#14242B",
    "popup_hover": "#1A3037",
    "border": "#2C3D44",
    "text": "#E8EFF2",
    "muted": "#98AAB1",
    "soft": "#71868E",
    "accent": "#48C5C1",
    "accent_hover": "#61D5D1",
    "accent_soft": "#173A3D",
    "accent_text": "#071719",
    "danger": "#F08A8A",
    "notice": "#102A2D",
    "notice_border": "#28575A",
}


def resolved_theme(preference: str) -> str:
    if preference in {"light", "dark"}:
        return preference
    app = QApplication.instance()
    if app is not None:
        try:
            if app.styleHints().colorScheme() == Qt.ColorScheme.Dark:
                return "dark"
        except AttributeError:
            pass
    return "light"


def palette_for(preference: str) -> dict[str, str]:
    return DARK if resolved_theme(preference) == "dark" else LIGHT


def settings_stylesheet(preference: str) -> str:
    c = palette_for(preference)
    return f"""
    QDialog, QWidget#settingsRoot {{
        background: {c['window']};
        color: {c['text']};
        font-family: "Segoe UI Variable", "Malgun Gothic";
        font-size: 13px;
    }}
    QLabel {{ color: {c['text']}; }}
    QLabel#pageTitle {{ font-size: 24px; font-weight: 650; color: {c['text']}; }}
    QLabel#pageDescription {{ font-size: 12px; color: {c['muted']}; }}
    QLabel#sectionLabel {{ font-size: 12px; font-weight: 650; color: {c['muted']}; }}
    QLabel#settingTitle {{ font-size: 13px; font-weight: 650; color: {c['text']}; }}
    QLabel#settingDescription, QLabel#footerNote {{ font-size: 11px; color: {c['muted']}; }}
    QLabel#privacyWarning {{ font-size: 11px; color: {c['danger']}; }}
    QLabel#versionBadge {{
        color: {c['muted']};
        background: {c['surface_alt']};
        border: 1px solid {c['border']};
        border-radius: 8px;
        padding: 4px 8px;
    }}
    QLabel#inlineNotice {{
        color: {c['muted']};
        background: {c['notice']};
        border: 1px solid {c['notice_border']};
        border-radius: 8px;
        padding: 10px 12px;
        font-size: 11px;
    }}
    QFrame#card {{
        background: {c['surface']};
        border: 1px solid {c['border']};
        border-radius: 14px;
    }}
    QFrame#separator {{
        border: 0;
        background: {c['border']};
        min-height: 1px;
        max-height: 1px;
    }}
    QPushButton, QComboBox, QLineEdit, QSpinBox, QDoubleSpinBox, QKeySequenceEdit {{
        min-height: 36px;
        border: 1px solid {c['border']};
        border-radius: 8px;
        padding: 0 10px;
        background: {c['surface_alt']};
        color: {c['text']};
        selection-background-color: {c['accent']};
    }}
    QPushButton:hover, QComboBox:hover, QLineEdit:hover, QKeySequenceEdit:hover {{
        border-color: {c['accent']};
    }}
    QComboBox:focus, QLineEdit:focus, QSpinBox:focus,
    QDoubleSpinBox:focus, QKeySequenceEdit:focus {{
        border-color: {c['accent']};
    }}
    QPushButton:pressed {{ background: {c['accent_soft']}; }}
    QPushButton[primary="true"] {{
        background: {c['accent']};
        border-color: {c['accent']};
        color: {c['accent_text']};
        font-weight: 650;
        padding: 0 18px;
    }}
    QPushButton[primary="true"]:hover {{ background: {c['accent_hover']}; }}
    QCheckBox {{ spacing: 9px; color: {c['text']}; }}
    QCheckBox::indicator {{
        width: 18px;
        height: 18px;
        border: 1px solid {c['border']};
        border-radius: 5px;
        background: {c['surface_alt']};
    }}
    QCheckBox::indicator:hover {{ border-color: {c['accent']}; }}
    QCheckBox::indicator:checked {{
        background: {c['accent']};
        border-color: {c['accent']};
    }}
    QComboBox::drop-down {{ border: 0; width: 28px; }}
    QComboBox QAbstractItemView {{
        background: {c['surface']}; color: {c['text']};
        border: 1px solid {c['border']}; selection-background-color: {c['popup_hover']};
        selection-color: {c['text']}; padding: 4px;
    }}
    QScrollArea, QWidget#scrollBody {{ border: 0; background: transparent; }}
    QScrollArea > QWidget > QWidget {{ background: transparent; }}
    QScrollBar:vertical {{
        background: transparent;
        width: 8px;
        margin: 2px 0 2px 2px;
    }}
    QScrollBar::handle:vertical {{
        background: {c['accent']};
        min-height: 48px;
        border-radius: 3px;
    }}
    QScrollBar::handle:vertical:hover {{ background: {c['accent_hover']}; }}
    QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0; }}
    QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {{ background: transparent; }}
    """


def menu_stylesheet(preference: str) -> str:
    c = palette_for(preference)
    return f"""
    QMenu {{
        background: {c['surface']}; color: {c['text']};
        border: 1px solid {c['border']}; border-radius: 9px;
        padding: 6px;
        font-family: "Segoe UI Variable", "Malgun Gothic";
        font-size: 13px;
    }}
    QMenu::item {{ padding: 8px 30px 8px 12px; border-radius: 6px; }}
    QMenu::item:selected {{ background: {c['accent_soft']}; color: {c['accent']}; }}
    QMenu::separator {{ height: 1px; background: {c['border']}; margin: 5px 8px; }}
    QMenu::indicator:checked {{ background: {c['accent']}; border-radius: 5px; }}
    """


def app_icon(*, enabled: bool = True, size: int = 64) -> QIcon:
    pixmap = QPixmap(size, size)
    pixmap.fill(Qt.GlobalColor.transparent)
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    scale = size / 64.0
    accent = QColor("#159B94" if enabled else "#7F9096")
    painter.setBrush(accent)
    painter.setPen(Qt.PenStyle.NoPen)
    painter.drawRoundedRect(
        QRectF(5 * scale, 5 * scale, 54 * scale, 54 * scale),
        17 * scale,
        17 * scale,
    )

    pen = QPen(QColor("white"), 3.2 * scale, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap)
    painter.setPen(pen)
    painter.setBrush(Qt.BrushStyle.NoBrush)
    upper = QPainterPath()
    upper.moveTo(17 * scale, 22 * scale)
    upper.lineTo(32 * scale, 14 * scale)
    upper.lineTo(47 * scale, 22 * scale)
    upper.lineTo(32 * scale, 30 * scale)
    upper.closeSubpath()
    painter.drawPath(upper)
    painter.drawPolyline(
        QPolygonF(
            [
                QPointF(17 * scale, 31 * scale),
                QPointF(32 * scale, 39 * scale),
                QPointF(47 * scale, 31 * scale),
            ]
        )
    )
    painter.drawPolyline(
        QPolygonF(
            [
                QPointF(17 * scale, 40 * scale),
                QPointF(32 * scale, 48 * scale),
                QPointF(47 * scale, 40 * scale),
            ]
        )
    )
    painter.end()
    return QIcon(pixmap)


def apply_window_theme(window, preference: str) -> None:
    """Match the native Windows title bar to the Sentory-inspired palette."""
    if sys.platform != "win32":
        return
    dark = resolved_theme(preference) == "dark"
    try:
        hwnd = int(window.winId())
        dwm = ctypes.windll.dwmapi
        immersive = ctypes.c_int(1 if dark else 0)
        dwm.DwmSetWindowAttribute(hwnd, 20, ctypes.byref(immersive), ctypes.sizeof(immersive))

        def color_ref(value: str) -> ctypes.c_int:
            color = QColor(value)
            return ctypes.c_int(color.red() | (color.green() << 8) | (color.blue() << 16))

        caption = color_ref("#071117" if dark else "#EAF6F6")
        text = color_ref("#E8EFF2" if dark else "#172D35")
        dwm.DwmSetWindowAttribute(hwnd, 35, ctypes.byref(caption), ctypes.sizeof(caption))
        dwm.DwmSetWindowAttribute(hwnd, 36, ctypes.byref(text), ctypes.sizeof(text))
    except (AttributeError, OSError, TypeError, ValueError):
        pass
