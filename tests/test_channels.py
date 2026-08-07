import numpy as np

from discord_translate_overlay.cache import TranslationCache
from discord_translate_overlay.channels import (
    ChannelNameProcessor,
    _channel_body_line,
    detect_channel_regions,
)
from discord_translate_overlay.models import Language, Rect, TextLine
from discord_translate_overlay.ocr.base import OcrEngine
from discord_translate_overlay.translation.mock import MockTranslator


def _line(left: int, top: int, right: int, text: str, language: Language) -> TextLine:
    return TextLine(
        polygon=np.array([[left, top], [right, top], [right, top + 18], [left, top + 18]]),
        bbox=Rect(left, top, right, top + 18),
        text=text,
        confidence=0.9,
        language=language,
    )


class ChannelOcr(OcrEngine):
    def __init__(self) -> None:
        self.calls = 0

    def recognize(self, image_bgr):
        self.calls += 1
        if self.calls == 1:
            return [
                _line(40, 20, 115, "お知らせ", Language.JAPANESE),
                _line(40, 55, 105, "撮影依頼", Language.KOREAN),
                _line(158, 56, 225, "새 메시지 2개", Language.KOREAN),
                _line(14, 90, 30, "D", Language.ENGLISH),
            ]
        return [
            _line(39, 10, 125, "お知らせ", Language.JAPANESE),
            _line(146, 10, 190, "팔로우", Language.KOREAN),
        ]


class NaturalChannelOcr(OcrEngine):
    def recognize(self, image_bgr):
        if image_bgr.shape[1] > 250:
            return [_line(30, 10, 105, "お知らせ", Language.JAPANESE)]
        return [
            _line(35, 20, 125, "4k動画展示場", Language.JAPANESE),
            _line(35, 55, 90, "部署", Language.JAPANESE),
            _line(0, 650, 90, "1440p 60FPS", Language.ENGLISH),
            _line(0, 680, 55, "DANA", Language.ENGLISH),
        ]


class EmojiChannelOcr(OcrEngine):
    def recognize(self, image_bgr):
        return [_line(35, 20, 130, "📢お知らせ", Language.JAPANESE)]


class CountingTranslator(MockTranslator):
    def __init__(self) -> None:
        self.calls = 0

    def translate(self, text, source, target):
        self.calls += 1
        return super().translate(text, source, target)


def test_detects_sidebar_and_current_channel_header_at_100_percent_dpi() -> None:
    frame = np.zeros((1920, 1080, 3), dtype=np.uint8)
    regions = detect_channel_regions(frame, Rect(312, 85, 808, 1853), 96)

    assert regions.sidebar == Rect(72, 88, 312, 1796)
    assert regions.header == Rect(312, 32, 732, 82)


def test_does_not_treat_wide_stream_content_as_a_channel_sidebar() -> None:
    frame = np.zeros((1233, 2925, 3), dtype=np.uint8)

    regions = detect_channel_regions(frame, Rect(848, 54, 2091, 1190), 168)

    assert regions.sidebar.area == 0
    assert regions.header.area == 0


def test_translates_only_channel_name_column_and_current_header(tmp_path) -> None:
    cache = TranslationCache(tmp_path / "cache.db")
    translator = CountingTranslator()
    processor = ChannelNameProcessor(ChannelOcr(), translator, cache, Language.KOREAN)
    frame = np.zeros((1920, 1080, 3), dtype=np.uint8)
    try:
        result = processor.process(frame, Rect(312, 85, 808, 1853), 96, force=True)
        assert result is not None
        assert [item.source_text for item in result.sidebar_messages] == [
            "お知らせ",
            "撮影依頼",
        ]
        assert [item.source_text for item in result.header_messages] == ["お知らせ"]
        assert result.sidebar_messages[0].translated_text == "공지"
        assert result.sidebar_messages[1].translated_text == "촬영 의뢰"
        assert result.header_messages[0].translated_text == "공지"
        assert translator.calls == 0
        assert result.sidebar_messages[0].render_background_rgb == (0, 0, 0)
        assert result.header_messages[0].render_background_rgb == (0, 0, 0)
        assert all("새 메시지" not in item.source_text for item in result.sidebar_messages)
        assert all(item.source_text != "팔로우" for item in result.header_messages)
    finally:
        cache.close()


def test_uses_natural_discord_channel_names_and_skips_bottom_controls(tmp_path) -> None:
    cache = TranslationCache(tmp_path / "cache.db")
    translator = CountingTranslator()
    processor = ChannelNameProcessor(
        NaturalChannelOcr(), translator, cache, Language.KOREAN
    )
    frame = np.zeros((900, 1080, 3), dtype=np.uint8)
    try:
        result = processor.process(frame, Rect(312, 85, 808, 850), 96, force=True)
        assert result is not None
        assert [item.source_text for item in result.sidebar_messages] == [
            "4k動画展示場",
            "部署",
        ]
        assert [item.translated_text for item in result.sidebar_messages] == [
            "4K 영상 전시관",
            "부서",
        ]
        assert result.header_messages[0].translated_text == "공지"
        assert translator.calls == 0
    finally:
        cache.close()


def test_channel_glossary_preserves_leading_emoji(tmp_path) -> None:
    cache = TranslationCache(tmp_path / "cache.db")
    translator = CountingTranslator()
    processor = ChannelNameProcessor(
        EmojiChannelOcr(), translator, cache, Language.KOREAN
    )
    frame = np.zeros((900, 1080, 3), dtype=np.uint8)
    try:
        result = processor.process(frame, Rect(312, 85, 808, 850), 96, force=True)
        assert result is not None
        assert result.sidebar_messages[0].source_text == "お知らせ"
        assert result.sidebar_messages[0].translated_text == "공지"
        assert result.header_messages[0].source_text == "お知らせ"
        assert result.header_messages[0].translated_text == "공지"
        assert translator.calls == 0
    finally:
        cache.close()


def test_channel_body_starts_after_visual_icon_prefix() -> None:
    original = _line(18, 20, 190, "# 📣 | お知らせ", Language.JAPANESE)

    body = _channel_body_line(original)

    assert body.text == "お知らせ"
    assert body.bbox.left > original.bbox.left + 60
