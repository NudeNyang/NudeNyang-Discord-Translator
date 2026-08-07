from concurrent.futures import Future
from types import SimpleNamespace

from discord_translate_overlay import app as app_module
from discord_translate_overlay.app import OverlayController, _frame_geometry_signature
from discord_translate_overlay.models import Rect


class _Overlay:
    def __init__(self) -> None:
        self.hidden = False

    def hide(self) -> None:
        self.hidden = True


def test_tick_never_captures_when_discord_is_not_foreground(monkeypatch) -> None:
    window = SimpleNamespace(
        hwnd=123,
        client_rect=Rect(0, 0, 1920, 1080),
        dpi=96,
    )
    monkeypatch.setattr(
        app_module.DiscordWindowLocator,
        "find",
        staticmethod(lambda: window),
    )
    monkeypatch.setattr(app_module, "is_foreground_or_related", lambda hwnd: False)

    controller = OverlayController.__new__(OverlayController)
    controller._finish_processing = lambda: None
    controller._resolve_chat_region = lambda client, hwnd: (_ for _ in ()).throw(
        AssertionError("background Discord must not be captured")
    )
    controller.overlay = _Overlay()
    controller.config = SimpleNamespace(enabled=True)
    controller._manual_hidden = False
    controller.current_region = Rect(1, 1, 2, 2)

    controller.tick()

    assert controller.overlay.hidden
    assert controller.current_region is None


def test_geometry_signature_follows_size_and_dpi_but_not_screen_position() -> None:
    first = _frame_geometry_signature(123, Rect(100, 200, 900, 800), 96)
    moved = _frame_geometry_signature(123, Rect(-1800, 20, -1000, 620), 96)
    resized = _frame_geometry_signature(123, Rect(100, 200, 1000, 800), 96)
    scaled = _frame_geometry_signature(123, Rect(100, 200, 900, 800), 144)

    assert moved == first
    assert resized != first
    assert scaled != first


def test_finished_ocr_from_previous_window_size_is_not_drawn() -> None:
    future = Future()
    future.set_result(SimpleNamespace(messages=(object(),), used_cache=0, translated=1))

    class RejectingOverlay:
        def set_messages(self, *args, **kwargs) -> None:
            raise AssertionError("stale OCR coordinates must not be painted")

        def show(self) -> None:
            raise AssertionError("stale OCR coordinates must not be shown")

    controller = OverlayController.__new__(OverlayController)
    controller.future = future
    controller._future_geometry_signature = (123, 800, 600, 96)
    controller._current_geometry_signature = (123, 900, 600, 96)
    controller._force_next_frame = False
    controller.overlay = RejectingOverlay()

    controller._finish_processing()

    assert controller.future is None
    assert controller._force_next_frame


def test_failed_first_ocr_forces_a_full_retry_without_waiting_for_scroll() -> None:
    future = Future()
    future.set_exception(RuntimeError("temporary OCR startup failure"))

    class ResettableDetector:
        def __init__(self) -> None:
            self.reset_called = False

        def reset(self) -> None:
            self.reset_called = True

    detector = ResettableDetector()
    controller = OverlayController.__new__(OverlayController)
    controller.future = future
    controller._future_geometry_signature = (123, 800, 600, 96)
    controller._current_geometry_signature = (123, 800, 600, 96)
    controller._force_next_frame = False
    controller.pipeline = SimpleNamespace(change_detector=detector)
    controller._report_error = lambda message: None

    controller._finish_processing()

    assert controller._force_next_frame
    assert detector.reset_called
