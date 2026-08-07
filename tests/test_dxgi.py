import threading

import numpy as np

from discord_translate_overlay.capture.dxgi import DxgiCapture, _camera_matches_output
from discord_translate_overlay.models import Rect


class FakeCamera:
    def __init__(self, width: int, height: int) -> None:
        self.width = width
        self.height = height


def test_rejects_camera_recovered_for_the_wrong_output_size() -> None:
    output = Rect(0, 0, 5120, 2160)

    assert _camera_matches_output(FakeCamera(5120, 2160), output)
    assert not _camera_matches_output(FakeCamera(1920, 1080), output)


class GrabCamera(FakeCamera):
    def __init__(self, frame) -> None:
        super().__init__(100, 100)
        self.frame = frame

    def grab(self, **kwargs):
        return self.frame

    def release(self) -> None:
        pass


class BrokenCamera(FakeCamera):
    def __init__(self) -> None:
        super().__init__(100, 100)

    def grab(self, **kwargs):
        raise RuntimeError("GPU device instance suspended")

    def release(self) -> None:
        raise RuntimeError("device already removed")


class FakeDxcam:
    def __init__(self, replacement: GrabCamera) -> None:
        self.replacement = replacement
        self.create_calls = 0

    def create(self, **kwargs):
        self.create_calls += 1
        return self.replacement


class ColorCamera(FakeCamera):
    def __init__(self, width: int, height: int, value: int) -> None:
        super().__init__(width, height)
        self.value = value
        self.regions: list[tuple[int, int, int, int]] = []

    def grab(self, *, region, **kwargs):
        self.regions.append(region)
        left, top, right, bottom = region
        return np.full((bottom - top, right - left, 3), self.value, dtype=np.uint8)

    def release(self) -> None:
        pass


class MultiOutputDxcam:
    def __init__(self, cameras: dict[int, ColorCamera]) -> None:
        self.cameras = cameras
        self.create_calls: list[int] = []

    def create(self, *, output_idx: int, **kwargs):
        self.create_calls.append(output_idx)
        return self.cameras[output_idx]


def test_recreates_matching_camera_when_grab_returns_none() -> None:
    expected = np.zeros((100, 100, 3), dtype=np.uint8)
    capture = DxgiCapture.__new__(DxgiCapture)
    capture._camera = GrabCamera(None)
    capture._dxcam = FakeDxcam(GrabCamera(expected))
    capture._output_index = 0
    capture._outputs = [Rect(0, 0, 100, 100)]
    capture._lock = threading.Lock()

    frame = capture.capture(Rect(0, 0, 100, 100))

    assert frame is not None
    assert np.array_equal(frame, expected)
    assert capture._dxcam.create_calls == 1


def test_uses_local_screen_fallback_when_recreated_camera_is_still_empty() -> None:
    expected = np.full((100, 100, 3), 7, dtype=np.uint8)
    capture = DxgiCapture.__new__(DxgiCapture)
    capture._camera = GrabCamera(None)
    capture._dxcam = FakeDxcam(GrabCamera(None))
    capture._output_index = 0
    capture._outputs = [Rect(0, 0, 100, 100)]
    capture._lock = threading.Lock()
    capture._fallback_capture = lambda region: expected

    frame = capture.capture(Rect(0, 0, 100, 100))

    assert frame is not None
    assert np.array_equal(frame, expected)


def test_uses_fallback_when_dxgi_device_is_removed() -> None:
    expected = np.full((100, 100, 3), 9, dtype=np.uint8)
    capture = DxgiCapture.__new__(DxgiCapture)
    capture._camera = BrokenCamera()
    capture._cameras = {0: capture._camera}
    capture._dxcam = FakeDxcam(BrokenCamera())
    capture._output_index = 0
    capture._outputs = [Rect(0, 0, 100, 100)]
    capture._lock = threading.Lock()
    capture._fallback_until = 0.0
    capture._using_fallback = False
    capture._fallback_capture = lambda region: expected

    frame = capture.capture(Rect(0, 0, 100, 100))

    assert np.array_equal(frame, expected)
    assert capture._using_fallback


def test_stitches_capture_when_discord_spans_two_monitors() -> None:
    left_camera = ColorCamera(100, 100, 11)
    right_camera = ColorCamera(100, 100, 22)
    capture = DxgiCapture.__new__(DxgiCapture)
    capture._camera = None
    capture._cameras = {}
    capture._dxcam = MultiOutputDxcam({0: left_camera, 1: right_camera})
    capture._output_index = None
    capture._outputs = [Rect(-100, 0, 0, 100), Rect(0, 0, 100, 100)]
    capture._lock = threading.Lock()

    frame = capture.capture(Rect(-50, 10, 50, 40))

    assert frame is not None
    assert frame.shape == (30, 100, 3)
    assert np.all(frame[:, :50] == 11)
    assert np.all(frame[:, 50:] == 22)
    assert left_camera.regions == [(50, 10, 100, 40)]
    assert right_camera.regions == [(0, 10, 50, 40)]
