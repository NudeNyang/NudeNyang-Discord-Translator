from __future__ import annotations

import os

import httpx

from ..models import Language
from .base import Translator

DEEPL_LANGUAGE = {
    Language.KOREAN: "KO",
    Language.ENGLISH: "EN",
    Language.JAPANESE: "JA",
    Language.CHINESE_SIMPLIFIED: "ZH-HANS",
    Language.CHINESE_TRADITIONAL: "ZH-HANT",
}

DEEPL_SOURCE_LANGUAGE = {
    **DEEPL_LANGUAGE,
    Language.CHINESE_SIMPLIFIED: "ZH",
    Language.CHINESE_TRADITIONAL: "ZH",
}


class DeepLTranslator(Translator):
    sends_text_externally = True
    display_name = "DeepL"
    cache_namespace = "deepl:v1"

    def __init__(self, api_key: str | None = None, timeout: float = 8.0) -> None:
        self.api_key = api_key or os.getenv("DEEPL_API_KEY", "")
        if not self.api_key:
            raise RuntimeError("DEEPL_API_KEY가 없어 DeepL 번역을 시작할 수 없어.")
        is_free = self.api_key.endswith(":fx")
        self.endpoint = (
            "https://api-free.deepl.com/v2/translate"
            if is_free
            else "https://api.deepl.com/v2/translate"
        )
        self.timeout = timeout

    def translate(self, text: str, source: Language, target: Language) -> str:
        if source == target or not text.strip():
            return text
        data: dict[str, str] = {
            "text": text,
            "target_lang": DEEPL_LANGUAGE[target],
            "preserve_formatting": "1",
        }
        if source in DEEPL_SOURCE_LANGUAGE:
            data["source_lang"] = DEEPL_SOURCE_LANGUAGE[source]
        response = httpx.post(
            self.endpoint,
            headers={"Authorization": f"DeepL-Auth-Key {self.api_key}"},
            data=data,
            timeout=self.timeout,
        )
        response.raise_for_status()
        payload = response.json()
        return str(payload["translations"][0]["text"])
