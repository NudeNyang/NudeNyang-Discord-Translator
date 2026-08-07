from __future__ import annotations

import argparse
import os
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication

from discord_translate_overlay.config import AppConfig
from discord_translate_overlay.ui.settings_dialog import SettingsDialog


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("theme", choices=("light", "dark"))
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    app = QApplication.instance() or QApplication([])
    config = AppConfig(ui_theme=args.theme)
    dialog = SettingsDialog(config)
    dialog.show()
    app.processEvents()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if not dialog.grab().save(str(args.output), "PNG"):
        raise RuntimeError("설정창 미리보기를 저장하지 못했어.")
    dialog.close()


if __name__ == "__main__":
    main()
