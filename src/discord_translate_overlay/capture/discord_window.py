from __future__ import annotations

import ctypes
from ctypes import wintypes

import psutil
import win32con
import win32gui
import win32process

from ..models import Rect, WindowInfo

user32 = ctypes.windll.user32


class DiscordWindowLocator:
    """Find Discord by executable identity; never reads Discord APIs or client data."""

    @staticmethod
    def find() -> WindowInfo | None:
        candidates: list[WindowInfo] = []

        def visit(hwnd: int, _: object) -> bool:
            if not win32gui.IsWindowVisible(hwnd):
                return True
            title = win32gui.GetWindowText(hwnd)
            if not title or "Discord" not in title:
                return True
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            try:
                executable = psutil.Process(pid).name().casefold()
            except (psutil.Error, OSError):
                return True
            if executable != "discord.exe":
                return True
            candidates.append(_window_info(hwnd, title))
            return True

        win32gui.EnumWindows(visit, None)
        visible = [
            c for c in candidates if c.visible and not c.minimized and c.client_rect.area > 0
        ]
        foreground = win32gui.GetForegroundWindow()
        foreground_root = (
            win32gui.GetAncestor(foreground, win32con.GA_ROOT) if foreground else 0
        )
        return _select_candidate(visible, foreground_root)


def _select_candidate(
    candidates: list[WindowInfo], foreground_root: int
) -> WindowInfo | None:
    foreground = next((item for item in candidates if item.hwnd == foreground_root), None)
    if foreground is not None:
        return foreground
    return max(candidates, key=lambda item: item.client_rect.area, default=None)


def _window_info(hwnd: int, title: str) -> WindowInfo:
    window = Rect(*win32gui.GetWindowRect(hwnd))
    client_local = win32gui.GetClientRect(hwnd)
    client_origin = win32gui.ClientToScreen(hwnd, (0, 0))
    client = Rect(
        client_origin[0],
        client_origin[1],
        client_origin[0] + client_local[2],
        client_origin[1] + client_local[3],
    )
    dpi = int(user32.GetDpiForWindow(wintypes.HWND(hwnd))) if hwnd else 96
    return WindowInfo(
        hwnd=hwnd,
        title=title,
        window_rect=window,
        client_rect=client,
        dpi=dpi,
        visible=bool(win32gui.IsWindowVisible(hwnd)),
        minimized=bool(win32gui.IsIconic(hwnd)),
    )


def is_foreground_or_related(hwnd: int) -> bool:
    foreground = win32gui.GetForegroundWindow()
    return foreground == hwnd or win32gui.GetAncestor(foreground, win32con.GA_ROOT) == hwnd
