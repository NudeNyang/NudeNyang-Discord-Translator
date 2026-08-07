import numpy as np
import pytest

from discord_translate_overlay.cache import TranslationCache
from discord_translate_overlay.models import Language, Message, RecognitionCandidate, Rect, TextLine
from discord_translate_overlay.ocr.base import OcrEngine
from discord_translate_overlay.pipeline import TranslationPipeline
from discord_translate_overlay.translation.mock import MockTranslator


class FakeOcr(OcrEngine):
    calls = 0

    def recognize(self, image_bgr):
        self.calls += 1
        return [
            TextLine(
                polygon=np.array([[10, 10], [150, 10], [150, 28], [10, 28]], dtype=float),
                bbox=Rect(10, 10, 150, 28),
                text="Hello everyone",
                confidence=0.95,
                language=Language.ENGLISH,
                candidates=(RecognitionCandidate("fake", "Hello everyone", 0.95),),
            ),
            TextLine(
                polygon=np.array([[10, 50], [150, 50], [150, 68], [10, 68]], dtype=float),
                bbox=Rect(10, 50, 150, 68),
                text="안녕하세요",
                confidence=0.97,
                language=Language.KOREAN,
                candidates=(RecognitionCandidate("fake", "안녕하세요", 0.97),),
            ),
        ]


class NoiseOcr(OcrEngine):
    def recognize(self, image_bgr):
        return [
            TextLine(
                polygon=np.array([[10, 10], [40, 10], [40, 28], [10, 28]], dtype=float),
                bbox=Rect(10, 10, 40, 28),
                text="-",
                confidence=0.70,
                language=Language.UNKNOWN,
            ),
            TextLine(
                polygon=np.array([[10, 50], [40, 50], [40, 68], [10, 68]], dtype=float),
                bbox=Rect(10, 50, 40, 68),
                text="O",
                confidence=0.70,
                language=Language.ENGLISH,
            ),
        ]


class CountingTranslator(MockTranslator):
    def __init__(self) -> None:
        self.calls = 0

    def translate(self, text, source, target):
        self.calls += 1
        return super().translate(text, source, target)


class SingleLineOcr(OcrEngine):
    def __init__(self, text: str, reported_language: Language) -> None:
        self.text = text
        self.reported_language = reported_language

    def recognize(self, image_bgr):
        return [
            TextLine(
                polygon=np.array([[10, 10], [180, 10], [180, 30], [10, 30]], dtype=float),
                bbox=Rect(10, 10, 180, 30),
                text=self.text,
                confidence=0.95,
                language=self.reported_language,
            )
        ]


class RecordingTranslator(MockTranslator):
    def __init__(self) -> None:
        self.received: list[str] = []

    def translate(self, text, source, target):
        self.received.append(text)
        return super().translate(text, source, target)


class InlineMediaOcr(OcrEngine):
    def recognize(self, image_bgr):
        return [
            TextLine(
                polygon=np.array([[10, 10], [80, 10], [80, 30], [10, 30]], dtype=float),
                bbox=Rect(10, 10, 80, 30),
                text="ありがとう",
                confidence=0.95,
                language=Language.JAPANESE,
            ),
            TextLine(
                polygon=np.array([[112, 10], [190, 10], [190, 30], [112, 30]], dtype=float),
                bbox=Rect(112, 10, 190, 30),
                text="ございます",
                confidence=0.95,
                language=Language.JAPANESE,
            ),
        ]


def test_pipeline_translates_only_other_language_and_skips_unchanged(tmp_path) -> None:
    ocr = FakeOcr()
    cache = TranslationCache(tmp_path / "cache.db")
    pipeline = TranslationPipeline(ocr, MockTranslator(), cache, Language.KOREAN)
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    try:
        result = pipeline.process(frame)
        assert result is not None
        assert [m.translated_text for m in result.messages] == ["[ko] Hello everyone", ""]
        assert pipeline.process(frame.copy()) is None
        assert ocr.calls == 1
    finally:
        cache.close()


def test_cache_is_used_after_force_refresh(tmp_path) -> None:
    cache = TranslationCache(tmp_path / "cache.db")
    pipeline = TranslationPipeline(FakeOcr(), MockTranslator(), cache, Language.JAPANESE)
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    try:
        first = pipeline.process(frame, force=True)
        second = pipeline.process(frame, force=True)
        assert first is not None and first.translated == 2
        assert second is not None and second.used_cache == 2 and second.translated == 0
    finally:
        cache.close()


def test_pipeline_does_not_send_unknown_or_single_latin_noise(tmp_path) -> None:
    cache = TranslationCache(tmp_path / "cache.db")
    translator = CountingTranslator()
    pipeline = TranslationPipeline(NoiseOcr(), translator, cache, Language.KOREAN)
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    try:
        result = pipeline.process(frame, force=True)
        assert result is not None
        assert translator.calls == 0
        assert result.translated == 0
        assert [message.translated_text for message in result.messages] == ["", ""]
    finally:
        cache.close()


@pytest.mark.parametrize(
    ("text", "reported_language", "target"),
    [
        ("안녕하세요 오늘도 반가워요", Language.ENGLISH, Language.KOREAN),
        ("こんにちは、今日もよろしく", Language.ENGLISH, Language.JAPANESE),
        ("Hello, nice to meet you", Language.JAPANESE, Language.ENGLISH),
    ],
)
def test_pipeline_never_translates_explicit_target_language_even_if_ocr_label_is_wrong(
    tmp_path, text, reported_language, target
) -> None:
    cache = TranslationCache(tmp_path / "cache.db")
    translator = CountingTranslator()
    pipeline = TranslationPipeline(
        SingleLineOcr(text, reported_language), translator, cache, target
    )
    frame = np.zeros((60, 220, 3), dtype=np.uint8)
    try:
        result = pipeline.process(frame, force=True)
        assert result is not None
        assert translator.calls == 0
        assert result.translated == 0
        assert result.messages[0].source_language == target
        assert result.messages[0].translated_text == ""
    finally:
        cache.close()


def test_changing_target_clears_previous_target_overlay_messages(tmp_path) -> None:
    cache = TranslationCache(tmp_path / "cache.db")
    pipeline = TranslationPipeline(FakeOcr(), MockTranslator(), cache, Language.KOREAN)
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    try:
        assert pipeline.process(frame, force=True).messages

        pipeline.set_target(Language.ENGLISH)

        assert pipeline.messages == ()
    finally:
        cache.close()


def test_pipeline_restores_protected_discord_tokens_after_translation(tmp_path) -> None:
    cache = TranslationCache(tmp_path / "cache.db")
    translator = RecordingTranslator()
    source = "Hello @everyone 👋 ^_^"
    pipeline = TranslationPipeline(
        SingleLineOcr(source, Language.ENGLISH), translator, cache, Language.KOREAN
    )
    try:
        result = pipeline.process(np.zeros((60, 220, 3), dtype=np.uint8), force=True)
        assert result is not None
        assert translator.received
        assert all(token not in translator.received[0] for token in ("@everyone", "👋", "^_^"))
        assert result.messages[0].translated_text == f"[ko] {source}"
    finally:
        cache.close()


def test_pipeline_does_not_translate_emoji_only_message(tmp_path) -> None:
    cache = TranslationCache(tmp_path / "cache.db")
    translator = RecordingTranslator()
    pipeline = TranslationPipeline(
        SingleLineOcr("👋 ^_^", Language.ENGLISH),
        translator,
        cache,
        Language.KOREAN,
    )
    try:
        result = pipeline.process(np.zeros((60, 220, 3), dtype=np.uint8), force=True)
        assert result is not None
        assert translator.received == []
        assert result.messages[0].translated_text == ""
    finally:
        cache.close()


def test_pipeline_translates_around_probable_inline_custom_emoji(tmp_path) -> None:
    cache = TranslationCache(tmp_path / "cache.db")
    translator = RecordingTranslator()
    pipeline = TranslationPipeline(InlineMediaOcr(), translator, cache, Language.KOREAN)
    try:
        result = pipeline.process(np.zeros((60, 220, 3), dtype=np.uint8), force=True)
        assert result is not None
        assert translator.received == ["ありがとう ございます"]
        assert result.messages[0].translated_text == "[ko] ありがとう ございます"
    finally:
        cache.close()


def test_pipeline_prefers_accessibility_messages_without_running_ocr(tmp_path) -> None:
    cache = TranslationCache(tmp_path / "cache.db")
    ocr = FakeOcr()
    pipeline = TranslationPipeline(ocr, MockTranslator(), cache, Language.KOREAN)
    exact = Message(
        bbox=Rect(20, 30, 180, 52),
        source_text="明日は集会です",
        source_language=Language.JAPANESE,
        message_id="uia:chat-messages-1-2:body:0",
    )
    try:
        result = pipeline.process(
            np.zeros((100, 220, 3), dtype=np.uint8),
            force=True,
            accessibility_messages=(exact,),
            accessibility_available=True,
        )

        assert result is not None
        assert ocr.calls == 0
        assert [message.source_text for message in result.messages] == ["明日は集会です"]
        assert result.messages[0].translated_text == "[ko] 明日は集会です"
    finally:
        cache.close()
