from discord_translate_overlay.language import CandidateSelector, LanguageDetector
from discord_translate_overlay.models import Language, RecognitionCandidate


def test_detects_three_languages_per_message() -> None:
    detector = LanguageDetector()
    assert detector.detect("Hello from Discord") == Language.ENGLISH
    assert detector.detect("こんにちは、元気ですか") == Language.JAPANESE
    assert detector.detect("안녕하세요, 반가워요") == Language.KOREAN


def test_detects_simplified_and_traditional_chinese_per_message() -> None:
    detector = LanguageDetector()
    assert detector.detect("这是中文消息") == Language.CHINESE_SIMPLIFIED
    assert detector.detect("這是繁體中文訊息") == Language.CHINESE_TRADITIONAL


def test_han_only_uses_recent_chinese_context() -> None:
    detector = LanguageDetector()
    detector.detect("这是中文消息")
    assert detector.detect("北京站") == Language.CHINESE_SIMPLIFIED


def test_han_only_uses_recent_japanese_context() -> None:
    detector = LanguageDetector()
    detector.detect("これは日本語です")
    assert detector.detect("東京駅") == Language.JAPANESE


def test_han_only_uses_recent_korean_context() -> None:
    detector = LanguageDetector()
    detector.detect("한국어 문맥이야")
    assert detector.detect("大韓民國") == Language.KOREAN


def test_candidate_selector_prefers_korean_model_for_hangul() -> None:
    selector = CandidateSelector()
    best, language = selector.choose(
        [
            RecognitionCandidate("PP-OCRv6-small", "OfL하세요", 0.91),
            RecognitionCandidate("korean_PP-OCRv5-mobile", "안녕하세요", 0.83),
        ]
    )
    assert best.text == "안녕하세요"
    assert language == Language.KOREAN


def test_candidate_selector_rejects_truncated_korean_candidate_for_japanese_name() -> None:
    selector = CandidateSelector()
    best, _ = selector.choose(
        [
            RecognitionCandidate("PP-OCRv6-small", "4k動画設定", 0.999),
            RecognitionCandidate("korean_PP-OCRv5-mobile", "4k", 0.994),
        ]
    )

    assert best.text == "4k動画設定"


def test_same_language_is_detected_without_cross_message_state() -> None:
    detector = LanguageDetector()
    values = [
        detector.detect("English line"),
        detector.detect("日本語の行"),
        detector.detect("한국어 줄"),
    ]
    assert values == [Language.ENGLISH, Language.JAPANESE, Language.KOREAN]
