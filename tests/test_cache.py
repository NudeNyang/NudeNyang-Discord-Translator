from discord_translate_overlay.cache import TranslationCache
from discord_translate_overlay.models import Language


def test_translation_cache_round_trip(tmp_path) -> None:
    cache = TranslationCache(tmp_path / "cache.db")
    try:
        assert cache.get("abc", Language.KOREAN) is None
        cache.put("abc", "hello", Language.ENGLISH, Language.KOREAN, "안녕")
        assert cache.get("abc", Language.KOREAN) == "안녕"
        assert cache.get("abc", Language.JAPANESE) is None
    finally:
        cache.close()


def test_message_lookup_reuses_translation_at_a_different_position(tmp_path) -> None:
    cache = TranslationCache(tmp_path / "cache.db")
    try:
        cache.put(
            "old-position",
            "韓国より安いね",
            Language.JAPANESE,
            Language.KOREAN,
            "한국보다 싸네",
        )

        assert (
            cache.get_message(
                "new-position", "  韓国より安いね  ", Language.JAPANESE, Language.KOREAN
            )
            == "한국보다 싸네"
        )
    finally:
        cache.close()


def test_message_lookup_reuses_one_character_ocr_variation(tmp_path) -> None:
    cache = TranslationCache(tmp_path / "cache.db")
    try:
        cache.put(
            "first",
            "3歳だから仕方ないね",
            Language.JAPANESE,
            Language.KOREAN,
            "3살이니까 어쩔 수 없네",
        )

        assert (
            cache.get_message(
                "second", "3歳だから仕方ないれ", Language.JAPANESE, Language.KOREAN
            )
            == "3살이니까 어쩔 수 없네"
        )
        assert (
            cache.get_message("other", "今日は雨です", Language.JAPANESE, Language.KOREAN)
            is None
        )
    finally:
        cache.close()


def test_message_lookup_does_not_fuzzy_match_protected_emoticons(tmp_path) -> None:
    cache = TranslationCache(tmp_path / "cache.db")
    try:
        cache.put(
            "first-face",
            "(•ω・)つス.....",
            Language.JAPANESE,
            Language.KOREAN,
            "(•ω・)",
            "kanana:test:protected",
        )

        assert (
            cache.get_message(
                "second-face",
                "(•ω•)つス.....",
                Language.JAPANESE,
                Language.KOREAN,
                "kanana:test:protected",
                allow_fuzzy=False,
            )
            is None
        )
    finally:
        cache.close()


def test_translation_cache_is_separated_by_engine(tmp_path) -> None:
    cache = TranslationCache(tmp_path / "cache.db")
    try:
        cache.put(
            "same-message",
            "hello",
            Language.ENGLISH,
            Language.KOREAN,
            "DeepL 결과",
            "deepl:v1",
        )
        cache.put(
            "same-message",
            "hello",
            Language.ENGLISH,
            Language.KOREAN,
            "Kanana 결과",
            "kanana:test",
        )

        assert cache.get("same-message", Language.KOREAN, "deepl:v1") == "DeepL 결과"
        assert cache.get("same-message", Language.KOREAN, "kanana:test") == "Kanana 결과"
    finally:
        cache.close()


def test_memory_lru_is_bounded_and_promotes_recent_hits(tmp_path) -> None:
    cache = TranslationCache(tmp_path / "cache.db", memory_capacity=2)
    try:
        cache.put("a", "a", Language.ENGLISH, Language.KOREAN, "A", "test:v1")
        cache.put("b", "b", Language.ENGLISH, Language.KOREAN, "B", "test:v1")
        assert cache.get("a", Language.KOREAN, "test:v1") == "A"
        cache.put("c", "c", Language.ENGLISH, Language.KOREAN, "C", "test:v1")

        assert cache.memory_size == 2
        assert cache.memory_contains("a", Language.KOREAN, "test:v1")
        assert cache.memory_contains("c", Language.KOREAN, "test:v1")
        assert not cache.memory_contains("b", Language.KOREAN, "test:v1")
    finally:
        cache.close()


def test_async_write_is_flushed_on_close_and_survives_restart(tmp_path) -> None:
    path = tmp_path / "cache.db"
    cache = TranslationCache(path)
    cache.put(
        "restart-key",
        "hello",
        Language.ENGLISH,
        Language.KOREAN,
        "안녕하세요",
        "hy:test",
    )
    assert cache.get("restart-key", Language.KOREAN, "hy:test") == "안녕하세요"
    cache.close()

    reopened = TranslationCache(path)
    try:
        assert (
            reopened.get("restart-key", Language.KOREAN, "hy:test") == "안녕하세요"
        )
    finally:
        reopened.close()


def test_fuzzy_lookup_sees_pending_memory_write_without_waiting_for_sqlite(tmp_path) -> None:
    cache = TranslationCache(tmp_path / "cache.db")
    try:
        cache.put(
            "first",
            "3歳だから仕方ないね",
            Language.JAPANESE,
            Language.KOREAN,
            "3살이니까 어쩔 수 없네",
            "hy:test",
        )
        assert (
            cache.get_message(
                "second",
                "3歳だから仕方ないれ",
                Language.JAPANESE,
                Language.KOREAN,
                "hy:test",
            )
            == "3살이니까 어쩔 수 없네"
        )
    finally:
        cache.close()
