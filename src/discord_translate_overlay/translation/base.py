from __future__ import annotations

from abc import ABC, abstractmethod

from ..models import Language


class Translator(ABC):
    sends_text_externally: bool = False
    display_name: str = "Unknown"
    cache_namespace: str = "unknown"

    @abstractmethod
    def translate(self, text: str, source: Language, target: Language) -> str:
        """Translate OCR-extracted text only."""

    def translate_many(
        self,
        items: list[tuple[str, Language]],
        target: Language,
    ) -> list[str]:
        """Translate in display order. Engines may override this for batching."""
        return [self.translate(text, source, target) for text, source in items]

    def should_cache(
        self,
        source_text: str,
        translated_text: str,
        source: Language,
        target: Language,
    ) -> bool:
        """Return False when an engine knows the result is incomplete or invalid."""
        return True

    def close(self) -> None:
        """Release optional runtime resources."""
        return None
