from types import SimpleNamespace

import pytest

from discord_translate_overlay.models import Language
from discord_translate_overlay.translation.deepl import DeepLTranslator


def test_deepl_sends_only_extracted_text(monkeypatch) -> None:
    captured = {}

    def fake_post(url, *, headers, data, timeout):
        captured.update(url=url, headers=headers, data=data, timeout=timeout)
        return SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {"translations": [{"text": "안녕하세요"}]},
        )

    monkeypatch.setattr("httpx.post", fake_post)
    translator = DeepLTranslator("secret:fx")
    result = translator.translate("Hello", Language.ENGLISH, Language.KOREAN)
    assert result == "안녕하세요"
    assert captured["data"] == {
        "text": "Hello",
        "target_lang": "KO",
        "preserve_formatting": "1",
        "source_lang": "EN",
    }
    assert "image" not in captured["data"]


def test_deepl_requires_key(monkeypatch) -> None:
    monkeypatch.delenv("DEEPL_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="DEEPL_API_KEY"):
        DeepLTranslator()


def test_deepl_uses_distinct_simplified_and_traditional_targets(monkeypatch) -> None:
    targets = []

    def fake_post(url, *, headers, data, timeout):
        targets.append((data["source_lang"], data["target_lang"]))
        return SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {"translations": [{"text": "結果"}]},
        )

    monkeypatch.setattr("httpx.post", fake_post)
    translator = DeepLTranslator("secret:fx")
    translator.translate("Hello", Language.ENGLISH, Language.CHINESE_SIMPLIFIED)
    translator.translate("Hello", Language.ENGLISH, Language.CHINESE_TRADITIONAL)

    assert targets == [("EN", "ZH-HANS"), ("EN", "ZH-HANT")]
