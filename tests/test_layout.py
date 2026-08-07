import numpy as np
from PySide6.QtCore import QRect, Qt
from PySide6.QtGui import QFont, QFontMetrics
from PySide6.QtWidgets import QApplication

from discord_translate_overlay.layout import LayoutEngine, RenderMode
from discord_translate_overlay.models import (
    Language,
    Message,
    RecognitionCandidate,
    Rect,
    RenderInlineMedia,
    TextLine,
)
from discord_translate_overlay.ui.overlay import (
    TranslationOverlay,
    _card_text_top,
    _inline_media_holes,
    _message_font_family,
    _message_font_size,
    _preferred_script_font,
    _viewport_content_right,
)


def test_layout_wraps_without_qt_flag_errors() -> None:
    app = QApplication.instance() or QApplication([])
    assert app is not None
    message = Message(
        bbox=Rect(10, 10, 180, 36),
        source_text="A much longer translated Discord message",
        source_language=Language.ENGLISH,
        translated_text="더 길어진 디스코드 번역 메시지입니다",
    )
    layout = LayoutEngine().layout(message, 15, 250)
    assert layout.rect.width >= message.bbox.width
    assert layout.font_size >= 10


def test_overlay_uses_stable_viewport_right_edge_for_fragmented_messages() -> None:
    assert _viewport_content_right(600) == 594
    assert _viewport_content_right(120) == 114


def test_short_translation_does_not_paint_to_the_viewport_edge() -> None:
    app = QApplication.instance() or QApplication([])
    assert app is not None
    message = Message(
        bbox=Rect(10, 10, 120, 36),
        source_text="短い文章です",
        source_language=Language.JAPANESE,
        translated_text="짧은 문장이야",
    )

    layout = LayoutEngine().layout(message, 15, 594)

    assert layout.rect.right < 250
    assert layout.rect.right >= message.bbox.right


def test_channel_overlay_can_use_a_smaller_discord_ui_font() -> None:
    overlay = TranslationOverlay(base_font_size=12, single_line=True)

    assert overlay._base_font_size == 12
    assert overlay._single_line


def test_uia_font_size_wins_over_global_default() -> None:
    app = QApplication.instance() or QApplication([])
    assert app is not None
    message = Message(
        bbox=Rect(10, 10, 180, 32),
        source_text="明日は集会です",
        source_language=Language.JAPANESE,
        render_font_family="gg sans",
        render_font_size=12.0,
    )

    assert _message_font_size(message, 15, 1.0) == 12
    # Discord's gg sans is a Chromium web font. The overlay should choose an
    # installed Japanese fallback explicitly instead of letting Qt pick Tahoma.
    assert _message_font_family(message, "Segoe UI") == "Noto Sans JP"


def test_script_font_is_used_when_uia_has_no_font_name() -> None:
    message = Message(
        bbox=Rect(10, 10, 180, 32),
        source_text="fallback",
        source_language=Language.ENGLISH,
    )

    assert _message_font_family(message, "Segoe UI") == "Noto Sans"


def test_installed_uia_font_family_is_used() -> None:
    app = QApplication.instance() or QApplication([])
    assert app is not None
    message = Message(
        bbox=Rect(10, 10, 180, 32),
        source_text="installed font",
        source_language=Language.ENGLISH,
        render_font_family="Segoe UI",
    )

    assert _message_font_family(message, "Arial") == "Segoe UI"


def test_translation_script_selects_deterministic_cjk_fallback_font() -> None:
    installed = {
        "noto sans kr": "Noto Sans KR",
        "noto sans jp": "Noto Sans JP",
        "microsoft yahei ui": "Microsoft YaHei UI",
    }

    assert _preferred_script_font("한국어 번역", "Segoe UI", installed) == "Noto Sans KR"
    assert _preferred_script_font("日本語の訳", "Segoe UI", installed) == "Noto Sans JP"
    assert _preferred_script_font("中文翻译", "Segoe UI", installed) == "Microsoft YaHei UI"


def test_single_line_channel_layout_never_expands_into_next_row() -> None:
    app = QApplication.instance() or QApplication([])
    assert app is not None
    message = Message(
        bbox=Rect(10, 20, 130, 44),
        source_text="かぷちやにようこそ",
        source_language=Language.JAPANESE,
        translated_text="카푸치야에 오신 여러분, 안녕하세요!",
    )

    layout = LayoutEngine().layout_single_line(message, 12, 10)

    assert layout.rect == message.bbox
    assert layout.font_size >= 10
    assert "\n" not in layout.text
    assert layout.text.endswith("…")


def test_message_layout_limits_shrink_before_vertical_expansion() -> None:
    app = QApplication.instance() or QApplication([])
    assert app is not None
    message = Message(
        bbox=Rect(10, 10, 130, 32),
        source_text="長い文章",
        source_language=Language.JAPANESE,
        translated_text="이 번역문은 원문보다 훨씬 길어서 두 줄 이상 필요합니다",
    )

    layout = LayoutEngine().layout(
        message,
        12,
        130,
        minimum_font_size=10,
    )

    assert layout.font_size >= 10
    assert layout.rect.height >= message.bbox.height


def test_ocr_spacing_gap_does_not_become_a_transparent_hole() -> None:
    line = TextLine(
        polygon=np.zeros((4, 2)),
        bbox=Rect(10, 20, 190, 40),
        text="前 後",
        confidence=0.9,
        language=Language.JAPANESE,
        candidates=(RecognitionCandidate("layout-inline-media", "80,20,112,40", 1.0),),
    )
    message = Message(
        bbox=Rect(10, 18, 190, 42),
        source_text="前 後",
        source_language=Language.JAPANESE,
        lines=[line],
    )

    assert _inline_media_holes(message, 1.0) == []


def test_composed_uia_emoji_does_not_leave_a_transparent_source_hole() -> None:
    line = TextLine(
        polygon=np.zeros((4, 2)),
        bbox=Rect(10, 20, 190, 40),
        text="絵文字つき",
        confidence=1.0,
        language=Language.JAPANESE,
        candidates=(
            RecognitionCandidate(
                "layout-inline-media:emoji",
                "80,20,112,40|party-monkey",
                1.0,
            ),
        ),
    )
    message = Message(
        bbox=Rect(10, 18, 190, 42),
        source_text=line.text,
        source_language=Language.JAPANESE,
        lines=[line],
    )

    assert _inline_media_holes(message, 1.0) == []


def test_structured_mention_can_still_be_preserved_as_a_small_hole() -> None:
    line = TextLine(
        polygon=np.zeros((4, 2)),
        bbox=Rect(10, 20, 190, 40),
        text="本文",
        confidence=1.0,
        language=Language.JAPANESE,
        candidates=(
            RecognitionCandidate(
                "layout-preserved-inline",
                "80,20,112,40",
                1.0,
            ),
        ),
    )
    message = Message(
        bbox=Rect(10, 18, 190, 42),
        source_text=line.text,
        source_language=Language.JAPANESE,
        lines=[line],
    )

    assert _inline_media_holes(message, 1.0) == [Rect(78, 18, 114, 42)]


def test_hybrid_layout_keeps_short_translation_in_exact_source_box() -> None:
    app = QApplication.instance() or QApplication([])
    assert app is not None
    message = Message(
        bbox=Rect(20, 30, 180, 54),
        source_text="明日は集会です",
        source_language=Language.JAPANESE,
        translated_text="내일은 모임이야",
        render_container=Rect(20, 30, 360, 100),
    )

    layout = LayoutEngine().layout_hybrid(message, 12, 394)

    assert layout.mode is RenderMode.REPLACE
    assert layout.rect == message.bbox
    assert layout.font_size == 12


def test_hybrid_layout_uses_one_wide_card_for_translation_that_does_not_fit() -> None:
    app = QApplication.instance() or QApplication([])
    assert app is not None
    message = Message(
        bbox=Rect(20, 30, 125, 52),
        source_text="短い原文",
        source_language=Language.JAPANESE,
        translated_text="이 번역문은 원문보다 길지만 읽을 수 있는 크기를 유지해야 합니다",
        render_container=Rect(20, 30, 360, 104),
    )

    layout = LayoutEngine().layout_hybrid(message, 12, 394)

    assert layout.mode is RenderMode.CARD
    assert layout.rect.left == message.bbox.left
    assert layout.rect.right == message.render_container.right
    assert layout.rect.bottom <= message.render_container.bottom
    assert layout.font_size >= 11


def test_hybrid_card_never_crosses_its_safe_container() -> None:
    app = QApplication.instance() or QApplication([])
    assert app is not None
    message = Message(
        bbox=Rect(20, 30, 115, 52),
        source_text="短文",
        source_language=Language.JAPANESE,
        translated_text="아주 긴 번역문 " * 20,
        render_container=Rect(20, 30, 300, 76),
    )

    layout = LayoutEngine().layout_hybrid(message, 12, 394)

    assert layout.mode is RenderMode.CARD
    assert layout.rect.bottom == 76
    assert layout.overflow


def test_overlay_paints_message_specific_discord_surface() -> None:
    app = QApplication.instance() or QApplication([])
    assert app is not None
    overlay = TranslationOverlay(base_font_size=12)
    overlay.resize(220, 100)
    message = Message(
        bbox=Rect(10, 10, 180, 48),
        source_text="原文",
        source_language=Language.JAPANESE,
        translated_text="번역문",
        render_background_rgb=(78, 69, 62),
    )
    overlay.set_messages(
        (message,),
        style=overlay._style,
    )

    image = overlay.grab().toImage()

    assert image.pixelColor(175, 44).getRgb()[:3] == (78, 69, 62)


def test_card_text_starts_below_preserved_inline_media() -> None:
    card = Rect(70, 100, 590, 190)
    source = Rect(70, 104, 260, 132)
    emoji = Rect(220, 106, 248, 134)

    assert _card_text_top(card, source, 4, [emoji]) == 136
    assert _card_text_top(card, source, 4, []) == 104


def test_inline_media_forces_card_even_when_translation_is_short() -> None:
    app = QApplication.instance() or QApplication([])
    assert app is not None
    message = Message(
        bbox=Rect(70, 100, 260, 132),
        source_text="絵文字つき",
        source_language=Language.JAPANESE,
        translated_text="이모지 포함",
        render_container=Rect(70, 100, 590, 180),
    )

    layout = LayoutEngine().layout_hybrid(
        message,
        12,
        594,
        force_card=True,
        reserved_height=30,
    )

    assert layout.mode is RenderMode.CARD
    assert layout.rect.height > message.bbox.height


def test_trailing_composed_emoji_space_is_included_in_card_height() -> None:
    app = QApplication.instance() or QApplication([])
    assert app is not None
    message = Message(
        bbox=Rect(10, 10, 120, 34),
        source_text="絵文字つき",
        source_language=Language.JAPANESE,
        translated_text="이모지 포함 번역",
        render_container=Rect(10, 10, 210, 80),
    )

    layout = LayoutEngine().layout_hybrid(
        message,
        12,
        214,
        force_card=True,
        trailing_height=22,
        font_family="Noto Sans KR",
    )

    assert not layout.overflow
    assert layout.rect.height >= 22 + layout.padding * 2


def test_overlay_reflows_captured_emoji_instead_of_leaving_source_hole() -> None:
    app = QApplication.instance() or QApplication([])
    assert app is not None
    overlay = TranslationOverlay(base_font_size=12)
    overlay.resize(220, 100)
    message = Message(
        bbox=Rect(10, 10, 120, 34),
        source_text="絵文字つき",
        source_language=Language.JAPANESE,
        translated_text="이모지 포함 번역",
        render_container=Rect(10, 10, 210, 80),
        render_background_rgb=(49, 51, 56),
        render_inline_media=(
            RenderInlineMedia(
                bbox=Rect(82, 12, 90, 20),
                width=8,
                height=8,
                bgr=bytes((0, 0, 255)) * 64,
                alt_text="party-monkey",
            ),
        ),
    )
    overlay.set_messages((message,), overlay._style)

    image = overlay.grab().toImage()
    device_scale = image.devicePixelRatio()
    red_pixels = [
        (x, y)
        for y in range(round(10 * device_scale), round(80 * device_scale))
        for x in range(round(10 * device_scale), round(210 * device_scale))
        if image.pixelColor(x, y).red() > 240
        and image.pixelColor(x, y).green() < 20
        and image.pixelColor(x, y).blue() < 20
    ]

    assert red_pixels
    assert max(x for x, _y in red_pixels) < round(60 * device_scale)
    assert image.pixelColor(
        round(86 * device_scale), round(16 * device_scale)
    ).getRgb()[:3] == (49, 51, 56)


def test_wide_one_line_card_keeps_original_row_height_without_overflow() -> None:
    app = QApplication.instance() or QApplication([])
    assert app is not None
    message = Message(
        bbox=Rect(20, 30, 120, 54),
        source_text="短い原文",
        source_language=Language.JAPANESE,
        translated_text="넓은 카드에서는 한 줄로 들어가는 번역문",
        render_container=Rect(20, 30, 390, 54),
    )

    layout = LayoutEngine().layout_hybrid(message, 12, 394)

    assert layout.mode is RenderMode.CARD
    assert layout.rect == Rect(20, 30, 390, 54)
    assert layout.padding == 1
    assert not layout.overflow


def test_hybrid_layout_measures_with_the_same_cjk_font_that_is_painted() -> None:
    app = QApplication.instance() or QApplication([])
    assert app is not None
    text = (
        "카푸치야 포토콘이 시작되었습니다.\n"
        "확인해 주셨나요?\n"
        "5/14(목)까지라서 많은 분들의 사진을 기다리고 있어요!!!\n"
        "확산도 부탁드려요, 정말 기쁩니다.☺！"
    )
    message = Message(
        bbox=Rect(20, 30, 300, 118),
        source_text="かぷちやフォトコンが始まってます",
        source_language=Language.JAPANESE,
        translated_text=text,
        render_container=Rect(20, 30, 520, 118),
    )

    layout = LayoutEngine().layout_hybrid(
        message,
        12,
        594,
        font_family="Noto Sans KR",
    )
    metrics = QFontMetrics(QFont("Noto Sans KR", layout.font_size))
    text_bounds = metrics.boundingRect(
        QRect(0, 0, layout.rect.width - layout.padding * 2, 10_000),
        Qt.TextFlag.TextWordWrap
        | Qt.AlignmentFlag.AlignLeft
        | Qt.AlignmentFlag.AlignTop,
        layout.text,
    )

    assert not layout.overflow
    assert text_bounds.height() + layout.padding * 2 <= layout.rect.height
