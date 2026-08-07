from PySide6.QtWidgets import QApplication

from discord_translate_overlay.config import AppConfig
from discord_translate_overlay.ui.settings_dialog import SettingsDialog


def test_settings_window_uses_product_name_and_saves_new_controls() -> None:
    app = QApplication.instance() or QApplication([])
    config = AppConfig()
    dialog = SettingsDialog(config)
    try:
        assert dialog.windowTitle() == "Nude Translator 설정"
        dialog.toggle_shortcut.setKeySequence("Ctrl+Alt+T")
        dialog.ui_theme.setCurrentIndex(dialog.ui_theme.findData("dark"))
        dialog.auto_update.setChecked(False)
        dialog.apply()

        assert config.hotkeys.toggle_translation == "Ctrl+Alt+T"
        assert config.ui_theme == "dark"
        assert not config.auto_update
    finally:
        dialog.close()
        app.processEvents()
