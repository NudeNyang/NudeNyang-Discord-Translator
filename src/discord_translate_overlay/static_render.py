from __future__ import annotations

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .models import Message, OverlayStyle


def _font(size: int, text: str = "") -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if any("\u3040" <= char <= "\u30ff" for char in text):
        candidates = (
            "C:/Windows/Fonts/NotoSansJP-VF.ttf",
            "C:/Windows/Fonts/meiryo.ttc",
        )
    else:
        candidates = (
            "C:/Windows/Fonts/NotoSansKR-VF.ttf",
            "C:/Windows/Fonts/malgun.ttf",
            "C:/Windows/Fonts/segoeui.ttf",
        )
    for path in candidates:
        try:
            return ImageFont.truetype(path, size=size)
        except OSError:
            pass
    return ImageFont.load_default()


def _wrapped(draw: ImageDraw.ImageDraw, text: str, width: int, font: ImageFont.ImageFont) -> str:
    output: list[str] = []
    for paragraph in text.splitlines() or [text]:
        current = ""
        for char in paragraph:
            candidate = current + char
            if current and draw.textbbox((0, 0), candidate, font=font)[2] > width:
                output.append(current)
                current = char
            else:
                current = candidate
        output.append(current)
    return "\n".join(output)


def render_messages(
    image_bgr: np.ndarray,
    messages: list[Message],
    style: OverlayStyle,
    font_size: int = 16,
) -> np.ndarray:
    image = Image.fromarray(cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(image, "RGBA")
    background = (*style.background_rgb, round(255 * style.opacity))
    foreground = (*style.foreground_rgb, 255)
    for message in messages:
        rect = message.bbox
        text = message.translated_text or message.source_text
        font = _font(font_size, text)
        wrapped = _wrapped(draw, text, rect.width, font)
        bounds = draw.multiline_textbbox((0, 0), wrapped, font=font, spacing=2)
        while font_size > 10 and bounds[3] - bounds[1] > rect.height:
            font_size -= 1
            font = _font(font_size, text)
            wrapped = _wrapped(draw, text, rect.width, font)
            bounds = draw.multiline_textbbox((0, 0), wrapped, font=font, spacing=2)
        height = max(rect.height, bounds[3] - bounds[1] + 4)
        draw.rectangle((rect.left, rect.top, rect.right, rect.top + height), fill=background)
        draw.multiline_text(
            (rect.left + 1, rect.top), wrapped, font=font, fill=foreground, spacing=2
        )
    return cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
