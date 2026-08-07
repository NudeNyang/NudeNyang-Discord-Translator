from __future__ import annotations

import numpy as np

from .models import OverlayStyle

DISCORD_DARK = OverlayStyle((49, 51, 56), (219, 222, 225))
DISCORD_LIGHT = OverlayStyle((255, 255, 255), (49, 51, 56))


def detect_theme(image_bgr: np.ndarray, preference: str = "auto") -> OverlayStyle:
    if preference == "dark":
        return DISCORD_DARK
    if preference == "light":
        return DISCORD_LIGHT
    # Use low-saturation pixels because the chat canvas is the largest neutral surface.
    sample = image_bgr[::8, ::8, ::-1].reshape(-1, 3).astype(np.int16)
    neutral = sample[(sample.max(axis=1) - sample.min(axis=1)) < 18]
    if len(neutral) < 10:
        neutral = sample
    luminance = float(np.median(neutral.mean(axis=1)))
    if luminance < 128:
        background = tuple(int(x) for x in np.median(neutral, axis=0))
        # Discord's newer dark themes can be almost black (about 17, 18, 20).
        # Treat those as valid sampled canvas colors instead of falling back to
        # the much lighter legacy 49/51/56 gray.
        if not all(8 <= value <= 100 for value in background):
            return DISCORD_DARK
        return OverlayStyle(background, DISCORD_DARK.foreground_rgb)
    return DISCORD_LIGHT
