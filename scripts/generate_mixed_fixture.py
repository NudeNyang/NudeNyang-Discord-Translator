from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def main() -> None:
    output = Path("artifacts/mixed-discord-fixture.png")
    output.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (760, 520), (30, 31, 34))
    draw = ImageDraw.Draw(image)
    fonts = {
        "en": font("C:/Windows/Fonts/segoeui.ttf", 22),
        "ja": font("C:/Windows/Fonts/NotoSansJP-VF.ttf", 22),
        "ko": font("C:/Windows/Fonts/NotoSansKR-VF.ttf", 22),
        "meta": font("C:/Windows/Fonts/segoeui.ttf", 16),
    }
    messages = [
        ("Alice", "Today at 12:01", "Hello! Are we playing tonight?", "en"),
        ("Haru", "Today at 12:02", "今日はとても楽しかったです", "ja"),
        ("Haru", "Today at 12:03", "東京駅", "ja"),
        ("민수", "Today at 12:04", "오늘 정말 즐거웠어요", "ko"),
        ("민수", "Today at 12:05", "大韓民國", "ko"),
    ]
    y = 24
    for index, (name, timestamp, body, language) in enumerate(messages):
        avatar_color = ((80 + index * 30) % 255, 120, 180)
        draw.ellipse((18, y, 62, y + 44), fill=avatar_color)
        draw.text((78, y), name, font=fonts[language], fill=(72, 210, 160))
        name_width = draw.textbbox((0, 0), name, font=fonts[language])[2]
        draw.text(
            (88 + name_width, y + 4),
            timestamp,
            font=fonts["meta"],
            fill=(145, 145, 150),
        )
        draw.text((78, y + 34), body, font=fonts[language], fill=(219, 222, 225))
        y += 94
    image.save(output)
    print(output)


if __name__ == "__main__":
    main()
