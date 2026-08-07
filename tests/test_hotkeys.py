import pytest

import discord_translate_overlay.ui.hotkeys as hotkeys
from discord_translate_overlay.ui.hotkeys import (
    MOD_ALT,
    MOD_CONTROL,
    GlobalHotkeys,
    _parse,
    normalize_shortcut,
)


def test_parses_global_hotkey() -> None:
    modifiers, key = _parse("Ctrl+Alt+T")
    assert modifiers == MOD_CONTROL | MOD_ALT
    assert key == ord("T")


def test_parses_f12_without_modifiers() -> None:
    modifiers, key = _parse("F12")
    assert modifiers == 0
    assert key == 0x7B


def test_normalizes_user_editable_shortcuts() -> None:
    assert normalize_shortcut("alt + ctrl + t") == "Ctrl+Alt+T"
    assert normalize_shortcut("f12") == "F12"


@pytest.mark.parametrize("shortcut", ["", "F0", "F25", "Ctrl+NoSuchKey", "Ctrl+Ctrl+T"])
def test_rejects_invalid_user_shortcuts(shortcut: str) -> None:
    with pytest.raises(ValueError):
        normalize_shortcut(shortcut)


def test_reserved_f12_uses_edge_triggered_polling(monkeypatch) -> None:
    class FakeUser32:
        down = False

        @staticmethod
        def RegisterHotKey(*_args):
            return 0

        @staticmethod
        def GetAsyncKeyState(_key):
            return 0x8000 if FakeUser32.down else 0

        @staticmethod
        def UnregisterHotKey(*_args):
            return 1

    monkeypatch.setattr(hotkeys, "user32", FakeUser32())
    calls: list[str] = []
    manager = GlobalHotkeys()
    try:
        assert manager.register("F12", lambda: calls.append("toggle"))
        FakeUser32.down = True
        manager.poll()
        manager.poll()
        FakeUser32.down = False
        manager.poll()
        FakeUser32.down = True
        manager.poll()
        assert calls == ["toggle", "toggle"]
    finally:
        manager.close()


def test_clear_unregisters_native_and_polled_bindings(monkeypatch) -> None:
    class FakeUser32:
        unregistered: list[int] = []

        @staticmethod
        def RegisterHotKey(_window, hotkey_id, _modifiers, _key):
            return 1

        @staticmethod
        def GetAsyncKeyState(_key):
            return 0

        @staticmethod
        def UnregisterHotKey(_window, hotkey_id):
            FakeUser32.unregistered.append(hotkey_id)
            return 1

    monkeypatch.setattr(hotkeys, "user32", FakeUser32())
    manager = GlobalHotkeys()
    assert manager.register("Ctrl+Alt+T", lambda: None)
    manager.clear()

    assert FakeUser32.unregistered
    assert manager.binding_count == 0
