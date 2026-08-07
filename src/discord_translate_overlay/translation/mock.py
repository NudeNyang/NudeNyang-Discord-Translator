from __future__ import annotations

from ..models import Language
from .base import Translator


class OriginalTranslator(Translator):
    display_name = "원문 표시"
    cache_namespace = "original:v1"

    def translate(self, text: str, source: Language, target: Language) -> str:
        return text


class MockTranslator(Translator):
    display_name = "Mock (테스트)"
    cache_namespace = "mock:v1"

    def translate(self, text: str, source: Language, target: Language) -> str:
        if source == target:
            return text
        return f"[{target.value}] {text}"
