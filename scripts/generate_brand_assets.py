from __future__ import annotations

from pathlib import Path

from PIL import Image
from PySide6.QtWidgets import QApplication

from discord_translate_overlay.ui.visuals import app_icon


def main() -> None:
    QApplication.instance() or QApplication([])
    root = Path(__file__).resolve().parents[1]
    assets = root / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    png_path = assets / "nude-translator.png"
    app_icon(size=256).pixmap(256, 256).save(str(png_path), "PNG")
    with Image.open(png_path) as image:
        image.save(
            assets / "nude-translator.ico",
            format="ICO",
            sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
        )


if __name__ == "__main__":
    main()
