from discord_translate_overlay.capture.discord_window import _select_candidate
from discord_translate_overlay.models import Rect, WindowInfo


def _window(hwnd: int, width: int, height: int) -> WindowInfo:
    rect = Rect(0, 0, width, height)
    return WindowInfo(hwnd, "Discord", rect, rect, 96, True, False)


def test_prefers_foreground_discord_over_larger_background_window() -> None:
    large = _window(10, 1920, 1080)
    foreground = _window(20, 1000, 700)

    selected = _select_candidate([large, foreground], foreground_root=20)

    assert selected == foreground


def test_uses_largest_window_when_no_discord_is_foreground() -> None:
    large = _window(10, 1920, 1080)
    small = _window(20, 1000, 700)

    selected = _select_candidate([small, large], foreground_root=999)

    assert selected == large
