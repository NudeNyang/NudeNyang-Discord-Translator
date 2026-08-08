from discord_translate_overlay.models import Language
from discord_translate_overlay.translation.base import Translator
from discord_translate_overlay.translation.resilient import (
    ResilientTranslator,
    translation_needs_repair,
)


class _PartialLocalTranslator(Translator):
    cache_namespace = "local:test"

    def __init__(self) -> None:
        self.calls: list[list[tuple[str, Language]]] = []

    def translate(self, text: str, source: Language, target: Language) -> str:
        return self.translate_many([(text, source)], target)[0]

    def translate_many(
        self, items: list[tuple[str, Language]], target: Language
    ) -> list[str]:
        self.calls.append(items)
        results = []
        for text, _ in items:
            if "\n" in text:
                results.append(
                    "이번에는 실제로 춤추는 사람을 촬영해 봅시다!\n"
                    "Join先はポスター記載の4KVRCグループインスタンスです！"
                )
            elif text.startswith("今回は"):
                results.append("이번에는 실제로 춤추는 사람을 촬영해 봅시다!")
            else:
                results.append(text)
        return results


class _RecordingDeepL(Translator):
    sends_text_externally = True
    cache_namespace = "deepl:test"

    def __init__(self) -> None:
        self.calls: list[tuple[str, Language, Language]] = []

    def translate(self, text: str, source: Language, target: Language) -> str:
        self.calls.append((text, source, target))
        return "참가 장소는 포스터에 적힌 4KVRC 그룹 인스턴스입니다!"


class _HallucinatingTranslator(Translator):
    def translate(self, text: str, source: Language, target: Language) -> str:
        return (
            "죄송합니다. 해당 문구는 번역이 어려운 특수문자로 구성되어 있습니다. "
            "정확한 상황을 알려주시면 추가 정보를 제공하겠습니다."
        )


def test_repairs_partial_japanese_with_line_retry_then_deepl_fallback() -> None:
    primary = _PartialLocalTranslator()
    fallback = _RecordingDeepL()
    translator = ResilientTranslator(primary, fallback)
    source = (
        "今回は実際に踊ってる人を撮ってみましょう！\n"
        "Join先はポスター記載の4KVRCグループインスタンスです！"
    )

    translated = translator.translate(source, Language.JAPANESE, Language.KOREAN)

    assert translated == (
        "이번에는 실제로 춤추는 사람을 촬영해 봅시다!\n"
        "참가 장소는 포스터에 적힌 4KVRC 그룹 인스턴스입니다!"
    )
    assert len(primary.calls) == 2
    assert primary.calls[1] == [
        ("今回は実際に踊ってる人を撮ってみましょう！", Language.JAPANESE),
        ("Join先はポスター記載の4KVRCグループインスタンスです！", Language.JAPANESE),
    ]
    assert fallback.calls == [
        (
            "Join先はポスター記載の4KVRCグループインスタンスです！",
            Language.JAPANESE,
            Language.KOREAN,
        )
    ]


def test_quality_check_allows_a_preserved_japanese_proper_name() -> None:
    source = "第4回すてらダンス部コラボ授業です！"
    translated = "제4회 すてらダンス部 컬래버레이션 수업입니다!"

    assert not translation_needs_repair(
        source, translated, Language.JAPANESE, Language.KOREAN
    )


def test_unresolved_local_echo_is_not_cacheable() -> None:
    primary = _PartialLocalTranslator()
    translator = ResilientTranslator(primary)
    source = "Join先はポスター記載の4KVRCグループインスタンスです！"

    translated = translator.translate(source, Language.JAPANESE, Language.KOREAN)

    assert translated == source
    assert not translator.should_cache(
        source,
        translated,
        Language.JAPANESE,
        Language.KOREAN,
    )


def test_short_japanese_channel_label_echo_needs_repair() -> None:
    assert translation_needs_repair(
        "4k動画設定",
        "4K動画設定",
        Language.JAPANESE,
        Language.KOREAN,
    )


def test_long_explanation_hallucination_needs_repair() -> None:
    translated = (
        "죄송합니다. 해당 문구는 번역이 어려운 특수문자 및 코드로 구성되어 있습니다. "
        "정확한 상황을 알려주시면 추가 정보를 제공하겠습니다."
    )

    assert translation_needs_repair(
        "ZXQKEEP000QXZつス.....",
        translated,
        Language.JAPANESE,
        Language.KOREAN,
    )


def test_untranslated_single_japanese_han_character_needs_repair() -> None:
    assert translation_needs_repair(
        "さち試着用アバター",
        "시험용 아웃도어服",
        Language.JAPANESE,
        Language.KOREAN,
    )


def test_unrepairable_hallucination_is_hidden_instead_of_displayed() -> None:
    translator = ResilientTranslator(_HallucinatingTranslator())
    source = "ハブ"

    assert translator.translate(source, Language.JAPANESE, Language.KOREAN) == source
