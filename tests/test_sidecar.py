from __future__ import annotations

import io
import json
import queue

from discord_translate_overlay import sidecar
from discord_translate_overlay.config import AppConfig
from discord_translate_overlay.models import Language


class _NoDiscordProcessLauncher:
    def current_process(self):
        return None


class _DeferredToggleController:
    def __init__(self) -> None:
        self.enabled = True
        self.client = object()
        self.connection_issues: queue.Queue[str] = queue.Queue()
        self.notices: queue.Queue[str] = queue.Queue()
        self.active_translator_name = "hymt_1_8b"
        self.preparing_translator_name = None
        self.translator_error = ""
        self.requested_enabled = None

    def request_enabled(self, enabled: bool) -> None:
        self.requested_enabled = enabled


def test_translation_toggle_reports_requested_state_without_waiting_for_controller(
    monkeypatch,
) -> None:
    runtime = sidecar.EngineRuntime.__new__(sidecar.EngineRuntime)
    runtime.config = AppConfig(enabled=True, translator="hymt_1_8b")
    runtime.controller = _DeferredToggleController()
    runtime.discord_launcher = _NoDiscordProcessLauncher()
    runtime._closed = False
    monkeypatch.setattr(sidecar, "save_config", lambda _config: None)

    result = runtime.dispatch("translation-set-enabled", {"enabled": False})

    assert runtime.controller.requested_enabled is False
    assert result["enabled"] is False
    assert result["controllerEnabled"] is True


def test_runtime_status_exposes_active_and_preparing_translator() -> None:
    runtime = sidecar.EngineRuntime.__new__(sidecar.EngineRuntime)
    runtime.config = AppConfig(translator="hymt_7b")
    runtime.controller = _DeferredToggleController()
    runtime.controller.preparing_translator_name = "hymt_7b"
    runtime.discord_launcher = _NoDiscordProcessLauncher()
    runtime._closed = False

    result = runtime.status()

    assert result["configuredTranslator"] == "hymt_7b"
    assert result["activeTranslator"] == "hymt_1_8b"
    assert result["translatorState"] == "preparing"


def test_runtime_status_exposes_selected_display_language() -> None:
    runtime = sidecar.EngineRuntime.__new__(sidecar.EngineRuntime)
    runtime.config = AppConfig(target_language=Language.CHINESE_TRADITIONAL)
    runtime.controller = _DeferredToggleController()
    runtime.discord_launcher = _NoDiscordProcessLauncher()
    runtime._closed = False

    result = runtime.status()

    assert result["targetLanguage"] == "zh-Hant"


def test_patched_config_preserves_ocr_defaults_and_updates_nested_hotkey() -> None:
    current = AppConfig(
        target_language=Language.JAPANESE,
        ocr_device="auto",
        capture_fps=8,
    )

    updated = sidecar._patched_config(
        current,
        {
            "capture_fps": 12,
            "hotkeys": {"toggle_translation": "Ctrl+Alt+T"},
            "unknown": "ignored",
        },
    )

    assert updated.capture_fps == 12
    assert updated.ocr_device == "auto"
    assert updated.target_language is Language.JAPANESE
    assert updated.hotkeys.toggle_translation == "Ctrl+Alt+T"
    assert updated.hotkeys.toggle_original == current.hotkeys.toggle_original


def test_json_lines_protocol_returns_result_and_error(monkeypatch) -> None:
    class FakeRuntime:
        def dispatch(self, command: str, payload: object) -> object:
            if command == "health":
                return {"status": "ready", "ocrMode": "built-in"}
            raise ValueError("unsupported")

        def close(self) -> None:
            return None

    monkeypatch.setattr(sidecar, "EngineRuntime", FakeRuntime)
    input_stream = io.StringIO(
        '\n'.join(
            (
                json.dumps({"id": 1, "command": "health", "payload": None}),
                json.dumps({"id": 2, "command": "missing", "payload": None}),
                "",
            )
        )
    )
    output_stream = io.StringIO()

    assert sidecar.serve(input_stream, output_stream) == 0
    responses = [json.loads(line) for line in output_stream.getvalue().splitlines()]

    assert responses[0] == {
        "id": 1,
        "ok": True,
        "result": {"status": "ready", "ocrMode": "built-in"},
    }
    assert responses[1]["id"] == 2
    assert responses[1]["ok"] is False
    assert responses[1]["error"] == "unsupported"


def test_update_check_returns_release_link_and_closes_client(monkeypatch) -> None:
    calls: dict[str, object] = {}

    class FakeRelease:
        version = "0.3.0"
        page_url = "https://github.com/NudeNyang/Nude-Translator/releases/tag/v0.3.0"

    class FakeClient:
        def __init__(self, repository: str) -> None:
            calls["repository"] = repository

        def check_for_update(self, current_version: str) -> FakeRelease:
            calls["current_version"] = current_version
            return FakeRelease()

        def close(self) -> None:
            calls["closed"] = True

    monkeypatch.setattr(sidecar, "GitHubReleaseClient", FakeClient)

    result = sidecar._check_for_update("NudeNyang/Nude-Translator", "0.2.0")

    assert result == {
        "available": True,
        "version": "0.3.0",
        "pageUrl": "https://github.com/NudeNyang/Nude-Translator/releases/tag/v0.3.0",
    }
    assert calls == {
        "repository": "NudeNyang/Nude-Translator",
        "current_version": "0.2.0",
        "closed": True,
    }
