from __future__ import annotations

import os
import warnings
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from discord_translate_overlay.experimental_dom.image_translation import (
    ImageTextStyle,
    _estimate_text_style,
    _fit_text,
    _font,
    _group_dense_text_lines,
    _line_geometry,
    _wrap_text,
)
from discord_translate_overlay.models import Language, Rect, TextLine


def _font_path(name: str) -> Path:
    return Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / name


def _styled_line(
    *,
    text: str,
    font_name: str,
    font_size: int,
    background: tuple[int, int, int],
    foreground: tuple[int, int, int],
    centered: bool,
) -> tuple[np.ndarray, TextLine]:
    image = Image.new("RGB", (720, 120), background)
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(_font_path(font_name)), font_size)
    measured = draw.textbbox((0, 0), text, font=font)
    width = measured[2] - measured[0]
    x = (image.width - width) // 2 if centered else 14
    y = 18
    draw.text((x, y), text, font=font, fill=foreground)
    bbox = draw.textbbox((x, y), text, font=font)
    rect = Rect(*bbox)
    polygon = np.array(
        [
            [rect.left, rect.top],
            [rect.right, rect.top],
            [rect.right, rect.bottom],
            [rect.left, rect.bottom],
        ],
        dtype=np.float32,
    )
    line = TextLine(
        polygon=polygon,
        bbox=rect,
        text=text,
        confidence=0.99,
        language=Language.ENGLISH,
    )
    bgr = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
    return bgr, line


def _rotated_styled_line(
    *,
    text: str,
    angle: float,
    background: tuple[int, int, int],
    foreground: tuple[int, int, int],
) -> tuple[np.ndarray, TextLine]:
    image = np.full((360, 720, 3), background[::-1], dtype=np.uint8)
    width, height = 420, 64
    patch = Image.new("RGB", (width, height), background)
    draw = ImageDraw.Draw(patch)
    font = ImageFont.truetype(str(_font_path("segoeuib.ttf")), 42)
    draw.text((12, 2), text, font=font, fill=foreground)
    patch_bgr = cv2.cvtColor(np.asarray(patch), cv2.COLOR_RGB2BGR)

    center = np.array([360.0, 180.0], dtype=np.float32)
    radians = np.deg2rad(angle)
    rotation = np.array(
        [[np.cos(radians), -np.sin(radians)], [np.sin(radians), np.cos(radians)]],
        dtype=np.float32,
    )
    local = np.array(
        [
            [-width / 2, -height / 2],
            [width / 2, -height / 2],
            [width / 2, height / 2],
            [-width / 2, height / 2],
        ],
        dtype=np.float32,
    )
    polygon = local @ rotation.T + center
    source_quad = np.array(
        [[0, 0], [width, 0], [width, height], [0, height]],
        dtype=np.float32,
    )
    transform = cv2.getPerspectiveTransform(source_quad, polygon.astype(np.float32))
    warped = cv2.warpPerspective(
        patch_bgr,
        transform,
        (image.shape[1], image.shape[0]),
        borderValue=background[::-1],
    )
    mask = cv2.warpPerspective(
        np.full((height, width), 255, dtype=np.uint8),
        transform,
        (image.shape[1], image.shape[0]),
    )
    image[mask > 0] = warped[mask > 0]
    xs, ys = polygon[:, 0], polygon[:, 1]
    line = TextLine(
        polygon=polygon,
        bbox=Rect(int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())),
        text=text,
        confidence=0.99,
        language=Language.JAPANESE,
    )
    return image, line


def test_style_estimator_detects_centered_bold_serif_and_source_color() -> None:
    image, line = _styled_line(
        text="Ticket Sales Period",
        font_name="timesbd.ttf",
        font_size=48,
        background=(235, 241, 239),
        foreground=(78, 83, 82),
        centered=True,
    )

    style = _estimate_text_style(image, line)

    assert style.family == "serif"
    assert style.bold is True
    assert style.alignment == "center"
    assert (
        max(
            abs(a - b)
            for a, b in zip(style.foreground_rgb, (78, 83, 82), strict=True)
        )
        <= 28
    )


def test_style_estimator_detects_left_aligned_bold_sans_white_text() -> None:
    image, line = _styled_line(
        text="FIRST SALE",
        font_name="segoeuib.ttf",
        font_size=42,
        background=(76, 170, 104),
        foreground=(248, 250, 247),
        centered=False,
    )

    style = _estimate_text_style(image, line)

    assert style.family == "sans"
    assert style.bold is True
    assert style.alignment == "left"
    assert min(style.foreground_rgb) >= 220


def test_target_font_follows_detected_family_and_weight() -> None:
    serif = ImageTextStyle(family="serif", bold=True)
    sans = ImageTextStyle(family="sans", bold=True)

    serif_font = _font(Language.KOREAN, 32, serif)
    sans_font = _font(Language.KOREAN, 32, sans)

    assert Path(serif_font.path).name.casefold() == "batang.ttc"
    assert Path(sans_font.path).name.casefold() == "malgunbd.ttf"


def test_numeric_schedule_stays_on_one_line_by_shrinking_first() -> None:
    canvas = Image.new("RGB", (320, 80), (255, 255, 255))
    draw = ImageDraw.Draw(canvas)
    rect = Rect(0, 0, 300, 40)

    font, lines = _fit_text(
        draw,
        "2025년 12월 8일(월) 20:00~2025년 12월 14일(일) 23:59",
        rect,
        Language.KOREAN,
        ImageTextStyle(family="sans"),
    )

    assert lines == ["2025년 12월 8일(월) 20:00~2025년 12월 14일(일) 23:59"]
    assert font.size < rect.height


def test_style_estimator_handles_fully_filled_ocr_box_without_numeric_warning() -> None:
    image = np.full((80, 160, 3), 232, dtype=np.uint8)
    cv2.rectangle(image, (10, 8), (118, 38), (30, 30, 30), thickness=-1)
    rect = Rect(10, 8, 118, 38)
    polygon = np.array(
        [[10, 8], [118, 8], [118, 38], [10, 38]],
        dtype=np.float32,
    )
    line = TextLine(polygon, rect, "こんにちは", 0.94, Language.JAPANESE)

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        style = _estimate_text_style(image, line)

    assert caught == []
    assert style.bold is True


def test_rotated_style_uses_oriented_height_and_saturated_text_color() -> None:
    image, line = _rotated_styled_line(
        text="VR IDOL!",
        angle=-23.0,
        background=(254, 243, 253),
        foreground=(223, 75, 207),
    )

    geometry = _line_geometry(line)
    style = _estimate_text_style(image, line)

    assert abs(geometry.angle_degrees - (-23.0)) <= 1.0
    assert abs(geometry.height - 64) <= 2
    assert line.bbox.height > geometry.height * 2
    assert max(
        abs(actual - expected)
        for actual, expected in zip(
            style.foreground_rgb,
            (223, 75, 207),
            strict=True,
        )
    ) <= 35
    assert abs(style.rotation_degrees - (-23.0)) <= 1.0


def _plain_line(left: int, top: int, right: int, bottom: int, text: str) -> TextLine:
    polygon = np.array(
        [[left, top], [right, top], [right, bottom], [left, bottom]],
        dtype=np.float32,
    )
    return TextLine(
        polygon,
        Rect(left, top, right, bottom),
        text,
        0.9,
        Language.JAPANESE,
    )


def test_dense_small_rows_are_grouped_per_column_but_headings_stay_separate() -> None:
    heading = _plain_line(220, 700, 500, 746, "メンバーカクテル")
    left_rows = [
        _plain_line(240, 760, 500, 788, "メンバーをイメージした"),
        _plain_line(240, 789, 510, 817, "特別なカクテルを提供"),
        _plain_line(240, 839, 508, 868, "参加者と一緒に語らう"),
    ]
    right_rows = [
        _plain_line(650, 758, 925, 786, "広いスペースがあります"),
        _plain_line(650, 788, 930, 816, "過去の受賞作があります"),
        _plain_line(650, 838, 920, 866, "発表も予定しています"),
    ]

    grouped = _group_dense_text_lines(
        [heading, *left_rows, *right_rows],
        image_width=1200,
        image_height=1600,
    )

    assert len(grouped) == 3
    assert heading in grouped
    paragraphs = sorted(
        (line for line in grouped if "\n" in line.text),
        key=lambda line: line.bbox.left,
    )
    assert len(paragraphs) == 2
    assert paragraphs[0].text.splitlines() == [line.text for line in left_rows]
    assert paragraphs[1].text.splitlines() == [line.text for line in right_rows]
    assert paragraphs[0].bbox == Rect(240, 760, 510, 868)


def test_wrap_text_preserves_explicit_paragraph_rows() -> None:
    canvas = Image.new("RGB", (400, 200), (0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    font = _font(Language.KOREAN, 22, ImageTextStyle())

    lines = _wrap_text(
        draw,
        "첫 번째 문장\n두 번째 문장\n세 번째 문장",
        font,
        maximum_width=300,
    )

    assert lines == ["첫 번째 문장", "두 번째 문장", "세 번째 문장"]
