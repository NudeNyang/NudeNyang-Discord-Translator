from .change_detector import ChangeDetector
from .chat_region import detect_chat_region
from .discord_window import DiscordWindowLocator
from .dxgi import DxgiCapture

__all__ = ["ChangeDetector", "DiscordWindowLocator", "DxgiCapture", "detect_chat_region"]
