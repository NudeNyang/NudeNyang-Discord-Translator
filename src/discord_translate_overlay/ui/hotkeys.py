from __future__ import annotations

import ctypes
from collections.abc import Callable

from PySide6.QtCore import QAbstractNativeEventFilter, QByteArray

WM_HOTKEY = 0x0312
MOD_ALT = 0x0001
MOD_CONTROL = 0x0002
MOD_SHIFT = 0x0004
MOD_WIN = 0x0008
MOD_NOREPEAT = 0x4000

user32 = ctypes.windll.user32


class _Message(ctypes.Structure):
    _fields_ = [
        ("hwnd", ctypes.c_void_p),
        ("message", ctypes.c_uint),
        ("wParam", ctypes.c_size_t),
        ("lParam", ctypes.c_ssize_t),
        ("time", ctypes.c_uint),
        ("pt_x", ctypes.c_long),
        ("pt_y", ctypes.c_long),
    ]


class GlobalHotkeys(QAbstractNativeEventFilter):
    def __init__(self) -> None:
        super().__init__()
        self._next_id = 0xD150
        self._callbacks: dict[int, Callable[[], None]] = {}
        self._polled_callbacks: dict[int, Callable[[], None]] = {}
        self._polled_down: set[int] = set()

    def register(self, shortcut: str, callback: Callable[[], None]) -> bool:
        modifiers, key = _parse(normalize_shortcut(shortcut))
        hotkey_id = self._next_id
        self._next_id += 1
        if not user32.RegisterHotKey(None, hotkey_id, modifiers | MOD_NOREPEAT, key):
            # Windows reserves F12 for debuggers, so RegisterHotKey rejects it.
            # Unmodified function keys can still be observed safely through
            # GetAsyncKeyState. Edge tracking keeps one press to one callback.
            if modifiers == 0 and 0x70 <= key <= 0x87:
                self._polled_callbacks[key] = callback
                return True
            return False
        self._callbacks[hotkey_id] = callback
        return True

    def poll(self) -> None:
        for key, callback in self._polled_callbacks.items():
            down = bool(user32.GetAsyncKeyState(key) & 0x8000)
            if down and key not in self._polled_down:
                self._polled_down.add(key)
                callback()
            elif not down:
                self._polled_down.discard(key)

    def nativeEventFilter(self, event_type: QByteArray, message: int):  # noqa: N802
        if bytes(event_type) not in (b"windows_generic_MSG", b"windows_dispatcher_MSG"):
            return False, 0
        # PySide 6.11 passes shiboken6.VoidPtr, while older versions exposed an
        # integer-like address directly. Converting to int handles both forms.
        address = int(message)
        msg = ctypes.cast(ctypes.c_void_p(address), ctypes.POINTER(_Message)).contents
        if msg.message == WM_HOTKEY and msg.wParam in self._callbacks:
            self._callbacks[msg.wParam]()
            return True, 0
        return False, 0

    def close(self) -> None:
        self.clear()

    def clear(self) -> None:
        for hotkey_id in self._callbacks:
            user32.UnregisterHotKey(None, hotkey_id)
        self._callbacks.clear()
        self._polled_callbacks.clear()
        self._polled_down.clear()

    @property
    def binding_count(self) -> int:
        return len(self._callbacks) + len(self._polled_callbacks)


def normalize_shortcut(shortcut: str) -> str:
    raw_parts = [part.strip() for part in shortcut.split("+") if part.strip()]
    if not raw_parts:
        raise ValueError("단축키가 비어 있어.")
    folded = [part.casefold() for part in raw_parts]
    modifier_order = ("ctrl", "alt", "shift", "win")
    modifiers = folded[:-1]
    if len(set(modifiers)) != len(modifiers):
        raise ValueError(f"중복된 보조 키가 있어: {shortcut}")
    if any(modifier not in modifier_order for modifier in modifiers):
        raise ValueError(f"지원하지 않는 보조 키가 있어: {shortcut}")
    key_name = folded[-1]
    if len(key_name) == 1 and key_name.isalnum():
        display_key = key_name.upper()
    elif key_name.startswith("f") and key_name[1:].isdigit():
        number = int(key_name[1:])
        if not 1 <= number <= 24:
            raise ValueError(f"기능 키는 F1부터 F24까지만 지원해: {shortcut}")
        display_key = f"F{number}"
    else:
        raise ValueError(f"지원하지 않는 단축키야: {shortcut}")
    canonical_modifiers = [
        label.title() if label != "ctrl" else "Ctrl"
        for label in modifier_order
        if label in modifiers
    ]
    return "+".join([*canonical_modifiers, display_key])


def _parse(shortcut: str) -> tuple[int, int]:
    normalized = normalize_shortcut(shortcut)
    parts = [part.strip().casefold() for part in normalized.split("+")]
    modifiers = 0
    mapping = {"ctrl": MOD_CONTROL, "alt": MOD_ALT, "shift": MOD_SHIFT, "win": MOD_WIN}
    for part in parts[:-1]:
        modifiers |= mapping[part]
    key_name = parts[-1]
    if len(key_name) == 1:
        return modifiers, ord(key_name.upper())
    if key_name.startswith("f") and key_name[1:].isdigit():
        return modifiers, 0x70 + int(key_name[1:]) - 1
    raise ValueError(f"지원하지 않는 단축키야: {shortcut}")
