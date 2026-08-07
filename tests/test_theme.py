import numpy as np

from discord_translate_overlay.theme import detect_theme


def test_detects_discord_modern_near_black_theme_color() -> None:
    image = np.full((120, 240, 3), (20, 18, 17), dtype=np.uint8)

    style = detect_theme(image)

    assert style.background_rgb == (17, 18, 20)
