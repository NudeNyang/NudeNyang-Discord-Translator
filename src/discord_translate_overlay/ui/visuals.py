from __future__ import annotations

import ctypes
import sys

from PySide6.QtCore import QRectF, Qt, QTimer
from PySide6.QtGui import QColor, QCursor, QIcon, QPainter, QPainterPath, QPen, QPixmap
from PySide6.QtWidgets import QApplication

LIGHT = {
    "window": "#F7FAFB",
    "surface": "#FFFFFF",
    "surface_alt": "#EEF5F6",
    "popup_hover": "#E3F1F2",
    "control_hover": "#D3EEEB",
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
    "control_hover": "#214548",
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
    QLabel#appProductName {{ font-size: 15px; font-weight: 650; color: {c['text']}; }}
    QLabel#appVersion, QLabel#appMeta, QLabel#appCopyright {{
        font-size: 11px; color: {c['muted']};
    }}
    QLabel#appLicenseSummary {{ font-size: 11px; color: {c['text']}; }}
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
    QPushButton:hover, QComboBox:hover, QLineEdit:hover, QSpinBox:hover,
    QDoubleSpinBox:hover, QKeySequenceEdit:hover {{
        border-color: {c['accent']};
        background: {c['popup_hover']};
    }}
    QComboBox:hover {{
        border: 2px solid {c['accent']};
        background: {c['control_hover']};
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
    }}
    QPushButton[primary="true"]:hover {{ background: {c['accent_hover']}; }}
    QPushButton[link="true"] {{
        min-height: 0;
        max-height: 24px;
        border: 0;
        border-radius: 0;
        padding: 0;
        background: transparent;
        color: {c['accent']};
    }}
    QPushButton#appAuthorLink {{ color: {c['text']}; font-weight: 650; }}
    QPushButton[link="true"]:hover {{ color: {c['accent_hover']}; }}
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
    QComboBox::drop-down {{
        border: 0;
        border-left: 1px solid transparent;
        border-top-right-radius: 7px;
        border-bottom-right-radius: 7px;
        width: 30px;
    }}
    QComboBox::drop-down:hover {{
        background: {c['accent_soft']};
        border-left-color: {c['accent']};
    }}
    QComboBox QAbstractItemView {{
        background: {c['surface']}; color: {c['text']};
        border: 1px solid {c['border']}; selection-background-color: {c['popup_hover']};
        selection-color: {c['text']}; padding: 4px; outline: none;
    }}
    QComboBox QAbstractItemView::item {{
        min-height: 34px;
        padding: 0 10px;
        border: 0;
        border-radius: 6px;
    }}
    QComboBox QAbstractItemView::item:hover,
    QComboBox QAbstractItemView::item:selected {{
        background: {c['control_hover']};
        color: {c['text']};
    }}
    QScrollArea, QWidget#scrollBody {{ border: 0; background: transparent; }}
    QPlainTextEdit#licenseText {{
        border: 1px solid {c['border']};
        border-radius: 10px;
        padding: 10px;
        background: {c['surface']};
        color: {c['text']};
        font-family: "Cascadia Mono", "Consolas";
        font-size: 10px;
    }}
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
    QMenu::icon {{ margin-left: 9px; }}
    QMenu::separator {{ height: 1px; background: {c['border']}; margin: 5px 8px; }}
    QMenu::indicator:checked {{ background: {c['accent']}; border-radius: 5px; }}
    """


def configure_tray_menu(menu, preference: str) -> None:
    """Keep the Qt tray menu above Windows' hidden-icon flyout."""
    menu.setStyleSheet(menu_stylesheet(preference))
    menu.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, True)
    menu.aboutToShow.connect(
        lambda: QTimer.singleShot(0, lambda: _position_tray_menu_above(menu))
    )


def tray_menu_y_above(
    *,
    anchor_y: int,
    menu_height: int,
    available_top: int,
    available_bottom: int,
    gap: int = 8,
) -> int:
    preferred = anchor_y - menu_height - gap
    minimum = available_top + gap
    maximum = available_bottom - menu_height - gap
    return max(minimum, min(preferred, maximum))


def _position_tray_menu_above(menu) -> None:
    if not menu.isVisible():
        return
    anchor = QCursor.pos()
    screen = QApplication.screenAt(anchor) or QApplication.primaryScreen()
    if screen is None:
        return
    available = screen.availableGeometry()
    menu_height = max(menu.height(), menu.sizeHint().height())
    menu.move(
        menu.x(),
        tray_menu_y_above(
            anchor_y=anchor.y(),
            menu_height=menu_height,
            available_top=available.top(),
            available_bottom=available.bottom() + 1,
        ),
    )


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

    painter.setBrush(QColor("white"))
    painter.drawEllipse(QRectF(12 * scale, 18 * scale, 12 * scale, 15 * scale))
    painter.drawEllipse(QRectF(21 * scale, 10 * scale, 12 * scale, 16 * scale))
    painter.drawEllipse(QRectF(31 * scale, 10 * scale, 12 * scale, 16 * scale))
    painter.drawEllipse(QRectF(40 * scale, 18 * scale, 12 * scale, 15 * scale))

    pad = QPainterPath()
    pad.moveTo(32 * scale, 27 * scale)
    pad.cubicTo(37 * scale, 27 * scale, 39 * scale, 31 * scale, 42 * scale, 35 * scale)
    pad.cubicTo(48 * scale, 41 * scale, 45 * scale, 52 * scale, 37 * scale, 53 * scale)
    pad.cubicTo(35 * scale, 53 * scale, 33 * scale, 51 * scale, 32 * scale, 49 * scale)
    pad.cubicTo(30 * scale, 51 * scale, 28 * scale, 53 * scale, 25 * scale, 53 * scale)
    pad.cubicTo(17 * scale, 52 * scale, 15 * scale, 41 * scale, 22 * scale, 35 * scale)
    pad.cubicTo(25 * scale, 31 * scale, 27 * scale, 27 * scale, 32 * scale, 27 * scale)
    pad.closeSubpath()
    painter.drawPath(pad)
    painter.end()
    return QIcon(pixmap)


def translation_status_icon(*, enabled: bool = True, size: int = 18) -> QIcon:
    pixmap = QPixmap(size, size)
    pixmap.fill(Qt.GlobalColor.transparent)
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    scale = size / 18.0
    color = QColor("#159B94" if enabled else "#7F9096")
    pen = QPen(color, 1.8 * scale)
    pen.setCapStyle(Qt.PenCapStyle.RoundCap)
    pen.setJoinStyle(Qt.PenJoinStyle.RoundJoin)
    painter.setPen(pen)
    painter.setBrush(Qt.BrushStyle.NoBrush)
    painter.drawEllipse(QRectF(2 * scale, 2 * scale, 14 * scale, 14 * scale))

    if enabled:
        check = QPainterPath()
        check.moveTo(5.2 * scale, 9.2 * scale)
        check.lineTo(8.0 * scale, 12.0 * scale)
        check.lineTo(13.0 * scale, 6.5 * scale)
        painter.drawPath(check)
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
