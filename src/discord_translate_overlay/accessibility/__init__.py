"""Windows accessibility readers used before the OCR fallback."""

from .discord_uia import DiscordUiaReader, DiscordUiaSnapshot, UiaElement

__all__ = ["DiscordUiaReader", "DiscordUiaSnapshot", "UiaElement"]
