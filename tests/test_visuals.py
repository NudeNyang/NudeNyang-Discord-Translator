from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication, QMenu

from discord_translate_overlay.ui.visuals import configure_tray_menu, tray_menu_y_above


def test_tray_menu_stays_above_the_windows_hidden_icon_panel() -> None:
    app = QApplication.instance() or QApplication([])
    menu = QMenu()
    try:
        configure_tray_menu(menu, "dark")

        assert menu.windowFlags() & Qt.WindowType.WindowStaysOnTopHint
    finally:
        menu.close()
        app.processEvents()


def test_tray_menu_opens_above_the_clicked_hidden_tray_icon() -> None:
    assert (
        tray_menu_y_above(
            anchor_y=1650,
            menu_height=410,
            available_top=0,
            available_bottom=2076,
        )
        == 1232
    )


def test_tray_menu_upward_position_stays_inside_the_monitor() -> None:
    assert (
        tray_menu_y_above(
            anchor_y=200,
            menu_height=410,
            available_top=0,
            available_bottom=2076,
        )
        == 8
    )
